# 【AI Agent × Multimodal Research Report】

時間：2026-09-22 02:52（Asia/Taipei）

主題：Blackwell TMEM Accumulator Stage × Epilogue Handoff × Reuse Contract

## 本小時新發現

本輪承接上一輪 `TMEM Lifecycle × TCMMA Guardrails`，不重複 allocation/OOB safety；改追 TMEM 被合法配置之後，**同一塊 TMEM accumulator 如何被 mainloop producer 寫入、由 pipeline commit 宣告完成、被 epilogue consumer 讀成 RMEM，最後 release/reuse**。

新增 system architecture：`TMEM Accumulator Producer–Consumer Runtime`。

新增 bottom-level mechanism：`AccumulatorStageIdentity → MMA write → acc_empty.commit → acc_full.wait → tcgen05.ld TMEM→RMEM → acc_full.release → stage reuse`。

## 本小時最重要 5 個發現

### 1. TMEM allocation generation 不等於 accumulator stage generation

**已確認事實 / CUTLASS source**：current CuTe DSL Blackwell GEMM 可一次配置 512 TMEM columns，之後以 `tCtAcc_base[..., stage]` 在同一 allocation 中切出多個 accumulator stages。MMA warp 透過 `acc_producer.acquire_and_advance()` 取得 empty stage；epilogue warps 則透過 `acc_consumer.wait_and_advance()` 取得 full stage。

來源：https://github.com/NVIDIA/cutlass/blob/main/examples/python/CuTeDSL/cute/blackwell/tutorial/tutorial_gemm/fp16_gemm_3_1.py

因此必須拆成：

`TMEMAllocationGeneration → contains → AccumulatorStageGeneration[n]`

而不能用一個 TMEM pointer/generation 代表 tile-level accumulator ownership。

### 2. `acc_empty.commit()` 是 mainloop→epilogue 的語義交接點，不是單純「MMA 已執行」

**工程實作 / CUTLASS source**：MMA warp先等待每個 A/B TMA stage，對當前 `tCtAcc` 執行 `cute.gemm`；所有 K tiles完成後才 `acc_empty.commit()`。因此 accumulator full witness應建立在「整個 tile 的 K reduction frontier」之後。

底層鏈：

`AB TMA ready → K0 MMA → K1 MMA → ... → KN MMA → AccumulatorCommitFrontier → ACC_FULL`

新增否定 edge：

`AnySingleMMAIssue --does_not_prove→ AccumulatorTileComplete`

### 3. Epilogue 必須 wait full stage 後才能 tcgen05.ld，讀取權與 allocation ownership不同

**已確認事實 / CUTLASS source + tutorial**：Blackwell accumulator存在 TMEM；完成後使用 TMEM→RMEM copy（tcgen05.ld family）把 accumulator搬到 registers，再做 conversion/epilogue/store。current CuTe DSL pipeline在 epilogue先 `acc_consumer.wait_and_advance()`，再以對應 `acc_full.index` 選取 `tCtAcc`。

來源：https://github.com/NVIDIA/cutlass/blob/main/examples/cute/tutorial/blackwell/01_mma_sm100.cu

因此：

`TMEMAllocationIsLive --does_not_prove→ AccumulatorStageReadable`

合法讀取需要：

`AllocationLive ∧ StageGenerationFull ∧ ConsumerOwnsStage ∧ Layout/ColumnRangeValid`。

### 4. `release()` 才關閉 epilogue ownership；過早 reuse 可能不是 guardrail 能抓到的 OOB

**工程建模 / 由 CUTLASS pipeline 合理推導**：epilogue讀取 accumulator後才 release full stage，讓 producer下一輪重新取得該stage。若 producer在 consumer完成 TMEM→RMEM之前重用同一合法 column range，地址仍可能完全合法，因此 `-g-tmem-access-check` 不一定能把它分類成 OOB/misalignment。

這形成新的 correctness 軸：

`TMEMSpatialSafety ≠ AccumulatorTemporalOwnershipSafety`

新增 failure：`ACC_STAGE_REUSE_BEFORE_EPILOGUE_RELEASE`。

### 5. Blackwell 的真正 bottleneck 已從「MMA 算多快」延伸到 accumulator handoff / epilogue on-chip dataflow

**論文結果**：FlashAttention-4 在 B200利用 fully asynchronous MMA、TMEM與重新設計 pipeline，報告最高 1613 TFLOP/s（71% utilization）；其核心動機是 Tensor Core吞吐成長快於 shared-memory/exp等非matmul單元。CODA 2026則把 Transformer block重新表達為 GEMM+epilogue programs，核心也是避免中間結果反覆落到 global memory。兩者共同支持：Hermes應把 `Accumulator→Epilogue handoff` 建成一級 architecture node，而非把 epilogue當 kernel尾端細節。

來源：https://proceedings.mlsys.org/paper_files/paper/2026/hash/ae8b0b5838ba510daff1198474e7b984-Abstract-Conference.html
來源：https://arxiv.org/abs/2605.19269

## Architecture Breakdown

### TMEM Accumulator Producer–Consumer Runtime

```text
Request / Layer / KernelLaunch
  ↓
TMEMAllocationGeneration
  ↓
TMEM Accumulator Base
  ↓
AccumulatorStageGeneration[s]
  ↓
acc_producer.acquire
  ↓
A/B TMA stages
  ↓
K0 MMA → K1 MMA → ... → KN MMA
  ↓
AccumulatorCommitFrontier
  ↓
ACC_FULL(s,generation)
  ↓
acc_consumer.wait
  ↓
TMEM → RMEM (tcgen05.ld)
  ↓
Epilogue transform / convert / store
  ↓
acc_consumer.release
  ↓
ACC_EMPTY(s,next_generation)
  ↓
producer reuse
```

這條鏈把上一輪的 spatial allocation safety 與本輪 temporal stage ownership接起來。

## Bottom-Level Logic

### Accumulator stage identity

```text
AccumulatorStageIdentity =
  KernelLaunchIdentity
  + TMEMAllocationGeneration
  + StageIndex
  + StageGeneration
  + BaseColumn/ColumnRange
  + CTAGroupIdentity
  + AccumulatorLayoutIdentity
```

### 合法 epilogue read contract

```text
EpilogueReadLegal =
  TMEMAllocationLive
  ∧ AccumulatorStageState == FULL
  ∧ ConsumerStageGeneration == ProducerCommittedGeneration
  ∧ ConsumerOwnershipValid
  ∧ TMEMColumnRangeValid
  ∧ AccumulatorLayoutCompatible
```

### State machine

```text
EMPTY(g)
 → PRODUCER_OWNED(g)
 → MMA_IN_FLIGHT(g)
 → COMMIT_FRONTIER(g)
 → FULL(g)
 → CONSUMER_OWNED(g)
 → TMEM_TO_RMEM(g)
 → EPILOGUE_DONE(g)
 → RELEASED(g)
 → EMPTY(g+1)
```

新增 failure states：
- `ACC_STAGE_READ_BEFORE_FULL`
- `ACC_STAGE_GENERATION_MISMATCH`
- `ACC_STAGE_REUSE_BEFORE_EPILOGUE_RELEASE`
- `ACC_STAGE_RELEASE_BEFORE_TMEM_LOAD_COMPLETE`
- `ACC_LAYOUT_GENERATION_MISMATCH`
- `ACC_TMEM_POINTER_VALID_BUT_STAGE_STALE`

## Visual Simulation Idea

### TMEM Accumulator Handoff Microscope

四條同步 timeline：

```text
A/B:      TMA0 ─ TMA1 ─ TMA2 ─ TMA3
MMA:      K0   ─ K1   ─ K2   ─ K3 ─ COMMIT
TMEM S0:  EMPTY → PRODUCER → FULL → CONSUMER → RELEASE
Epilogue:                    WAIT → LD → CONVERT → STORE
```

互動控制：提前 epilogue read、延遲 commit、提前 release、producer搶先 reuse、stage index/generation錯配。Console 同時顯示 `SPATIAL SAFETY`、`TEMPORAL OWNERSHIP`、`LINEAGE`、`CAUSAL OUTPUT` 四個 evidence badges。

## Code / GitHub

### NVIDIA CUTLASS

值得看的 current 檔案：
- `examples/python/CuTeDSL/cute/blackwell/tutorial/tutorial_gemm/fp16_gemm_3_1.py`
  - `acc_producer.acquire_and_advance()`
  - stage-indexed `tCtAcc`
  - K-tile `cute.gemm`
  - `acc_empty.commit()`
  - epilogue `acc_consumer.wait_and_advance()`
- `examples/cute/tutorial/blackwell/01_mma_sm100.cu`
  - tcgen05.mma → TMEM accumulator → tcgen05.ld → RMEM → GMEM
- `python/CuTeDSL/cutlass/cute/arch/tmem.py`
  - allocation/pointer lifecycle（上一輪基礎）

Repository：https://github.com/NVIDIA/cutlass

## Papers

### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling
- Authors：Ted Zadouri, Markus Hoehnerbach, Jay Shah, Timmy Liu, Vijay Thakkar, Tri Dao
- Institutions：Princeton / Meta / Colfax Research / NVIDIA / Georgia Tech / Together AI（依作者版本）
- Year：2026
- URL：https://proceedings.mlsys.org/paper_files/paper/2026/hash/ae8b0b5838ba510daff1198474e7b984-Abstract-Conference.html
- Architecture：Blackwell asynchronous attention pipeline + TMEM + 2-CTA MMA
- Contribution：重設 attention pipeline以適應 Blackwell asymmetric scaling；B200 BF16最高1613 TFLOP/s、71% utilization
- Limitations：attention-specific；不直接提供 Hermes 所需的 request-scoped TMEM stage runtime trace
- 改變了什麼：證明 TMEM與 asynchronous producer/consumer pipeline已是 attention architecture本體。

### CODA: Rewriting Transformer Blocks as GEMM-Epilogue Programs
- Authors：Han Guo, Jack Zhang, Arjun Menon, Driss Guessous, Vijay Thakkar, Yoon Kim, Tri Dao
- Year：2026
- URL：https://arxiv.org/abs/2605.19269
- Architecture：GEMM mainloop + composable on-chip epilogue primitives
- Contribution：把 normalization/activation/residual/reduction等記憶體受限操作重寫到 GEMM epilogue，減少中間 tensor global-memory round trips
- Limitations：是高階 kernel abstraction，不是 Blackwell TMEM ownership verifier
- 改變了什麼：把 accumulator→epilogue dataflow提升成 Transformer kernel設計的一級問題。

## Unknown / Open Questions 1-3

1. `PipelineUmmaAsync` 的 commit/release 最終如何 lower 成 exact `tcgen05.commit / mbarrier` PTX sequence，stage generation如何映射到 phase/parity？
2. `tcgen05.ld` 是否有官方可直接取得的 runtime event/guardrail PC，使 Hermes 能把 `ACC_FULL → TMEM_LOAD` 動態 join？
3. 如何在 FlashAttention-4 中把 QK/PV accumulator stage、softmax warps與 TMEM generation join到 request/layer/head，而不是只在 GEMM tutorial證明此模型？

## 下一輪研究

只追：

```text
PipelineUmmaAsync
→ acc_empty.commit / acc_full.wait / release
→ generated tcgen05.commit + mbarrier protocol
→ StageIndex + Phase + Generation
→ tcgen05.ld accumulator read
→ epilogue completion
→ stage release
→ reuse
→ FlashAttention-4 QK/PV TMEM handoff
→ request/layer/head attribution
```

優先把 tutorial-level stage contract移植到真實 attention kernel，不再增加新的 GPU 名詞。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `AccumulatorStageIdentity`
- `AccumulatorStageGeneration`
- `AccumulatorLayoutIdentity`
- `AccumulatorCommitFrontier`
- `AccumulatorFullWitness`
- `EpilogueConsumerOwnershipWitness`
- `TMEMToRMEMLoadWitness`
- `AccumulatorReleaseWitness`
- `AccumulatorReuseWitness`
- `TMEMSpatialSafetyAxis`
- `AccumulatorTemporalOwnershipAxis`

### Edges
```text
TMEMAllocationGeneration --contains→ AccumulatorStageGeneration
AccumulatorStageGeneration --written_by→ MMAOperationSet
MMAOperationSet --closed_by→ AccumulatorCommitFrontier
AccumulatorCommitFrontier --publishes→ AccumulatorFullWitness
AccumulatorFullWitness --authorizes→ EpilogueConsumerOwnershipWitness
EpilogueConsumerOwnershipWitness --authorizes→ TMEMToRMEMLoadWitness
AccumulatorReleaseWitness --permits→ NextAccumulatorStageGeneration
AnySingleMMAIssue --does_not_prove→ AccumulatorTileComplete
TMEMAllocationIsLive --does_not_prove→ AccumulatorStageReadable
TMEMSpatialSafetyAxis --orthogonal_to→ AccumulatorTemporalOwnershipAxis
SameTMEMPointerValue --does_not_prove→ SameAccumulatorStageGeneration
```

## 本輪結束判斷

- **缺哪一層：** `PipelineUmmaAsync` source abstraction → generated `tcgen05.commit/mbarrier` → `tcgen05.ld` → runtime stage-generation trace。
- **哪個節點最淺：** production `TMEMToRMEMLoadWitness`。
- **哪個概念仍只是名詞：** request/layer/head-scoped `AccumulatorStageGeneration`；source contract已成立，serving runtime join尚未完成。
- **哪個系統值得讀原始碼：** CUTLASS `PipelineUmmaAsync` 與 FlashAttention-4 CuTe DSL forward/backward accumulator/softmax handoff。
- **哪篇論文需追引用：** FlashAttention-4；另外追 CODA 對 on-chip epilogue fusion 的後續 kernel實作。
- **哪個概念最適合視覺模擬：** `TMEM Accumulator Handoff Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + GPU Capability Router + TMEM Lifecycle Verifier + Accumulator Stage Ownership Verifier + Commit/Load/Release Trace Joiner + Launch Attribution Joiner + Causal Evidence Gate + Tool Executor`。

本輪最大推進：Hermes 不再只知道「這塊 TMEM 合不合法」，而開始建模「這個 accumulator stage 在哪一代、由哪組 MMA 寫完、何時交給 epilogue、何時才允許下一輪重用」。這補上 spatial memory safety 與真正 temporal pipeline correctness 之間的缺口。