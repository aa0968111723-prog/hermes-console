# 【AI Agent × Multimodal Research Report】

時間：2026-09-22 03:51（Asia/Taipei）

主題：Blackwell `tcgen05.ld` Completion × Warp TMEM Partition × Epilogue Readiness Contract

## 與歷史研究比較

本輪刻意不重複 2026-09-22 前一輪的 `TMEM AllocationGeneration → AccumulatorStageGeneration → Epilogue handoff`，也不重複 2026-09-16 已研究的 generic TMEM→register epilogue。前一輪最淺節點是 `TMEMToRMEMLoadWitness`；本輪把它拆成真正的 instruction-level protocol：`AccumulatorReady → tcgen05.ld issue → asynchronous TMEM→RMEM transfer → tcgen05.wait::ld → RegisterReadable → Epilogue math/store`，並加入 warp-local TMEM row partition identity。

## 本小時新發現

1. NVIDIA current CUTLASS primitives 明確定義 `tcgen05.ld` 為 TMEM→register 的 collective load；它不是「呼叫後 registers 立即可讀」。必須配對 `tcgen05_wait(LOAD)` 後才可消費結果。
2. `tcgen05.ld.sync.aligned` 的 `sync` 只保證 issuing warp 對同一 load instruction 的 collective participation；PTX 仍明確將 load 定義為 asynchronous。故 `sync` 不等於 load completion。
3. TMEM row access 有 warp partition：128-row accumulator 的 rows 被四個 warp positions 分成 0–31、32–63、64–95、96–127；所有 warps 可見 columns，但不能藉由改 row address 任意讀另一 warp 的 row chunk。
4. CUTLASS 2026 `1cta_mma_pipeline.py` 直接展示完整 lifecycle：MMA K-loop → `tcgen05_commit(acc_mbar)` → wait accumulator barrier → 每個 warp 建立自己的 TMEM row pointer → `tcgen05_ld` → `tcgen05_wait(LOAD)` → register vector store → `tcgen05_fence(BEFORE_THREAD_SYNC)` → CTA barrier → TMEM dealloc。
5. 因此「accumulator full」與「register data ready」是兩個不同 readiness frontier；前者證明 MMA output 可交給 epilogue，後者才證明特定 warp 的 TMEM load 結果可以被 register-side epilogue 使用。

## 本小時最重要 5 個發現

### 1. `tcgen05.ld` 有獨立 completion frontier

**已確認事實（NVIDIA PTX/CUTLASS）**：`tcgen05.ld` 是 asynchronous collective TMEM load。CUTLASS primitives 要求在讀取 result 前呼叫 `tcgen05_wait(LOAD)`。

底層：

`AccumulatorFull → LdIssue → TMEMReadInFlight → WaitLd → RegisterReadable`

重要性：如果 Hermes 把 `tcgen05.ld issue` 當成 register readiness，會錯誤允許 epilogue 提前讀未完成資料。

限制：目前仍缺 production B200 runtime event 來直接觀察 load issue/wait completion。

### 2. `.sync` 不等於 async operation completion

**已確認事實（PTX ISA）**：`tcgen05.ld.sync.aligned` 要求 warp threads collective 執行相同 instruction，但 instruction 本身仍是 asynchronous。

因此新增否定 edge：

`Tcgen05LdSyncParticipation --does_not_prove→ Tcgen05LdCompletion`

這是重要的 model correction：thread convergence/synchronization 與 memory-operation completion 是兩個不同維度。

### 3. TMEM accumulator 必須帶 WarpPartitionIdentity

**已確認事實（CUTLASS primitives）**：TMEM 有四個 32-lane row chunks；warpgroup 中 `warp_idx % 4` 決定該 warp 可讀哪個 chunk。對 M=128 epilogue，需要四個 warp positions 才能覆蓋完整 128 rows。

新增：

`WarpTMEMPartitionIdentity = WarpGroup + WarpPositionMod4 + RowChunk + ColumnRange + AccumulatorStageGeneration`

以及：

`SameTMEMColumnRange --does_not_prove→ SameReadableAccumulatorRows`

### 4. Accumulator readiness 與 epilogue register readiness不可合併

**工程實作證據（CUTLASS current source）**：`1cta_mma_pipeline.py` 在 K-loop 後先 `tcgen05_commit(acc_mbar)`；所有 threads 等待 `acc_mbar` ready 後才進 epilogue。epilogue 每個 warp執行 `tcgen05_ld`，緊接 `tcgen05_wait(LOAD)`，之後才使用 `c_vec` store。

因此完整 handoff：

`MMASet → AccCommit → AccBarrierReady → WarpTMEMPointer → LdIssue → LdWait → RMEMVectorReady → Store`

### 5. TMEM deallocation還需要跨 warp load completion/order contract

**工程實作 + 合理推論**：CUTLASS example 在所有 epilogue loads/stores 後使用 `tcgen05_fence(BEFORE_THREAD_SYNC)`，再 CTA barrier，最後由 warp0 deallocate TMEM。這說明 allocation lifetime不能只綁 producer commit；還必須涵蓋所有 consumer TMEM accesses 的完成/ordering boundary。

新增 failure：

`TMEM_DEALLOC_BEFORE_EPILOGUE_LOAD_QUIESCENCE`

此 failure 的 exact hardware violation形式仍需 runtime guardrail/trace驗證，故標為「由官方實作模式支持的工程推論」，不提升成硬體已實測事實。

## Architecture Breakdown

本輪 system architecture：Blackwell SM100 TCGen05 GEMM epilogue handoff。

`TMA A/B → SMEM stage → tcgen05.mma K-loop → tcgen05.commit(acc_mbar) → accumulator-ready mbarrier → TMEM accumulator → per-warp tcgen05.ld → tcgen05.wait::ld → RMEM fragments → epilogue/store → tcgen05 fence → CTA sync → TMEM dealloc`

FlashAttention-4 的架構背景仍高度相關：它針對 Blackwell asymmetric scaling，使用 fully asynchronous MMA、larger tiles、TMEM 與 2-CTA MMA；因此 attention kernel 的 correctness/performance 都依賴這類 on-chip handoff，而不只是 GEMM FLOPS。

## Bottom-Level Logic

### `tcgen05.ld` protocol

1. producer MMA set完成並透過 commit/barrier publication accumulator readiness。
2. epilogue consumer等待 accumulator-ready frontier。
3. consumer根據 warp position與 accumulator layout計算 TMEM row/column address。
4. warp collective issue `tcgen05.ld.sync.aligned.*`。
5. hardware執行 asynchronous TMEM→register transfer。
6. `tcgen05.wait::ld` 建立 dependent register consumption所需的 completion boundary。
7. registers 才能安全參與 conversion / activation / scale / store。
8. 所有 TMEM consumer access完成並經 ordering/synchronization後，allocation才可 deallocate/reuse。

新的 readiness lattice：

`AccumulatorFullWitness`
`→ TMEMLoadIssueWitness`
`→ TMEMLoadCompletionWitness`
`→ RegisterFragmentReadableWitness`
`→ EpilogueComputationWitness`
`→ TMEMConsumerQuiescenceWitness`
`→ TMEMDeallocationSafeWitness`

## Visual Simulation Idea

### TMEM Warp Partition & Load Completion Microscope

畫面左側顯示 128-row TMEM accumulator，切成四個 row chunks：

- Warp position 0 → rows 0–31
- Warp position 1 → rows 32–63
- Warp position 2 → rows 64–95
- Warp position 3 → rows 96–127

右側每個 warp 有 timeline：

`ACC READY → LD ISSUE → IN FLIGHT → WAIT::LD → RMEM READY → EPILOGUE`

互動 fault injection：

- 移除 `wait::ld` → `RMEM_READ_BEFORE_TMEM_LOAD_COMPLETE`
- warp0 嘗試代表完整 M=128 accumulator → `TMEM_WARP_PARTITION_COVERAGE_GAP`
- stage generation mismatch → `TMEM_LOAD_WRONG_ACC_GENERATION`
- load未quiescent即dealloc → `TMEM_DEALLOC_BEFORE_EPILOGUE_LOAD_QUIESCENCE`
- 把 `.sync` 誤當 completion → `SYNC_COMPLETION_SEMANTIC_CONFLATION`

## Code / GitHub

值得持續讀：

- NVIDIA CUTLASS `examples/python/CuTeDSL/experimental/primitives/tcgen05/1cta_mma_pipeline.py`：完整 alloc/TMA/MMA/commit/ld/wait/fence/dealloc lifecycle。
- NVIDIA CUTLASS `examples/python/CuTeDSL/experimental/primitives/tcgen05/tmem_ld_st.py`：最小化 TMEM ld/st/wait 行為。
- NVIDIA CUTLASS `examples/python/CuTeDSL/experimental/primitives/tcgen05/2cta_mma_basic.py`：CTA_2 下的 TMEM→RMEM load。
- CUTLASS primitives `tcgen05_ld` / `tcgen05_wait` implementation與 lowering。
- FlashAttention-4 CuTe DSL：追 QK/PV accumulator與 softmax warp handoff是否使用相同或不同 TMEM partition/readiness contract。

## Papers

### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling

- Authors: Ted Zadouri, Markus Hoehnerbach, Jay Shah, Timmy Liu, Vijay Thakkar, Tri Dao
- Year: 2026
- URL: https://arxiv.org/abs/2603.05451
- Architecture: Blackwell fully asynchronous attention pipeline, larger tiles, TMEM, 2-CTA MMA, software-emulated exponential / conditional rescaling
- Contribution: 針對 Blackwell Tensor Core throughput 與 shared-memory/exponential unit scaling不對稱重新設計 attention；B200 BF16最高報告1613 TFLOP/s、71% utilization。
- Limitation: performance paper不等於 runtime provenance instrumentation；不能用 benchmark結果證明某個 request 的 TMEM load/wait因果鏈。
- Code: FlashAttention repository / CuTe DSL implementation
- Dataset: synthetic/model attention workload shapes，非一般資料集型研究。
- 改變了什麼：把 attention optimization從單純 memory-IO reduction推向 asynchronous pipeline + hardware-specific on-chip resource orchestration。

## Unknown / Open Questions

1. Compute Sanitizer / Patching API 是否存在可直接觀察 `tcgen05.ld` issue/wait 的公開 callback，或仍需 binary instrumentation？
2. FlashAttention-4 的 QK/PV/softmax handoff中，哪一些 TMEM regions由哪個 warp partition讀取，是否存在跨warp redistribution？
3. `tcgen05_fence(BEFORE_THREAD_SYNC) + CTA barrier` 到 TMEM deallocation的最小必要 ordering contract，能否在 PTX memory model中形式化成可驗證 edge？

## 下一輪研究

`tcgen05.ld source callsite → CuTe lowering → PTX tcgen05.ld → wait::ld → fence::before_thread_sync → SASS → runtime observability capability → FlashAttention-4 accumulator/softmax handoff → warp partition mapping → TMEM consumer quiescence → dealloc/reuse → request/layer/head attribution`

優先不再泛讀 GPU 名詞，而是回答：「哪個 warp、哪個 accumulator generation、哪一次 TMEM load，在什麼 completion boundary後，才真的產生可被 softmax/epilogue使用的 register fragment？」

## Knowledge Graph 新增 Node / Edge

### Nodes

- `TMEMLoadIssueWitness`
- `TMEMLoadCompletionWitness`
- `RegisterFragmentReadableWitness`
- `WarpTMEMPartitionIdentity`
- `TMEMRowChunkIdentity`
- `TMEMLoadWaitWitness`
- `TMEMConsumerQuiescenceWitness`
- `TMEMDeallocationSafeWitness`
- `EpilogueWarpCoverageContract`
- `AccumulatorToRegisterHandoffContract`

### Edges

- `AccumulatorFullWitness --enables→ TMEMLoadIssueWitness`
- `TMEMLoadIssueWitness --requires→ TMEMLoadWaitWitness`
- `TMEMLoadWaitWitness --establishes→ TMEMLoadCompletionWitness`
- `TMEMLoadCompletionWitness --enables→ RegisterFragmentReadableWitness`
- `WarpTMEMPartitionIdentity --constrains→ TMEMRowChunkIdentity`
- `RegisterFragmentReadableWitness --feeds→ EpilogueComputationWitness`
- `TMEMConsumerQuiescenceWitness --precedes→ TMEMDeallocationSafeWitness`
- `Tcgen05LdSyncParticipation --does_not_prove→ TMEMLoadCompletionWitness`
- `SameTMEMColumnRange --does_not_prove→ SameReadableAccumulatorRows`
- `AccumulatorFullWitness --does_not_prove→ RegisterFragmentReadableWitness`

## 本輪結束檢查

- 缺哪一層：`tcgen05.ld / wait::ld` generated instruction到 production runtime trace的直接 observability。
- 哪個節點最淺：`TMEMLoadCompletionWitness` 的 request-scoped runtime instance。
- 哪個概念仍只是名詞：`TMEMConsumerQuiescenceWitness` 的 production attribution。
- 哪個系統值得讀原始碼：FlashAttention-4 CuTe DSL accumulator→softmax/PV handoff + CUTLASS tcgen05 load/wait lowering。
- 哪篇論文需追引用：FlashAttention-4，尤其後續 Blackwell kernel/profiling與CuTe DSL implementation研究。
- 哪個概念最適合視覺模擬：TMEM Warp Partition & Load Completion Microscope。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + GPU Capability Router + Accumulator Ownership Verifier + TMEM Warp-Partition Verifier + Load/Wait/Fence Trace Joiner + Launch Attribution Joiner + Causal Evidence Gate + Tool Executor`。

## Evidence labels

- 官方已確認：NVIDIA PTX ISA / CUTLASS docs 對 `tcgen05.ld` async semantics、`wait::ld`、warp TMEM partition與supported architectures的描述。
- 工程實作已確認：CUTLASS 2026 `1cta_mma_pipeline.py` 的 commit→barrier→ld→wait→store→fence→sync→dealloc sequence。
- 論文結果：FlashAttention-4 的 B200 performance與Blackwell pipeline design。
- 合理推論：`TMEMConsumerQuiescenceWitness` 作為 deallocation/reuse correctness node；需要下一輪用 PTX memory model與 runtime tooling繼續驗證。
- 尚未驗證：production B200 request-scoped `tcgen05.ld` dynamic issue/completion trace。