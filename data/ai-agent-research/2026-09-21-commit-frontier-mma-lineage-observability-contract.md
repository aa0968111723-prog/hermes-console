# 【AI Agent × Multimodal Research Report】

時間：2026-09-21 23:54（Asia/Taipei）

主題：TCGen05 Commit Frontier × MMA Lineage Reconstruction × Observability Boundary

## 本小時新發現

本輪延續上一輪 `Runtime Launch Attribution × Tensor-Core Barrier Trace`，但避免重複 launch/graph identity。本輪聚焦一個更窄、也更關鍵的缺口：**看到 `tcgen05.commit` runtime callback 後，究竟能不能證明它完成的是哪一組 tcgen05 MMA？**

結論：目前 NVIDIA Compute Sanitizer 的 `SanitizerCallbackTensorCoreBarrier` 能提供 commit instruction PC、DSMEM barrier address、是否 multicast、multicast mask；但 callback 本身沒有直接提供「被此 commit 納入追蹤的 exact tcgen05.mma PC set」。PTX 的語義則明確指出：commit 追蹤的是 **executing thread 在 commit 之前發出的、相同 CTA group 的 prior asynchronous tcgen05 operations**。因此 exact MMA lineage 必須由 `issuer lineage + dynamic program order + CTA group + commit frontier` 重建，而不能只靠 barrier callback 單點事件。

本輪新增 system architecture：CUTLASS CuTeDSL `mcast_clusterMxN_2cta_mma.py` 的 CTA_2 multicast producer/consumer pipeline。

本輪新增 bottom-level mechanism：`TCGen05 Commit Frontier` —— 把 commit 視為一個「動態 operation-set 邊界」，而不是單純 barrier signal。

## 本小時最重要 5 個發現

### 1. tcgen05.commit 是 operation-set frontier，不是單一 MMA completion

**已確認事實 / 官方 PTX**：`tcgen05.commit.cta_group::N` 讓 mbarrier 追蹤 executing thread 先前發出的、相同 CTA group 的 asynchronous tcgen05 operations；完成後系統才執行 `mbarrier::arrive::one`。

因此建立：

`CommitTrackedOperationSet = PriorAsyncTcgen05Ops(issuer_thread_lineage, same_cta_group, since_previous_frontier)`

注意 `since_previous_frontier` 是 Hermes 的建模欄位；PTX 的核心保證是 prior operations + current thread + same CTA group。是否以哪個前一 frontier 切段，必須由實際 kernel program order 驗證。

新增否定 edge：

`ObservedTensorCoreBarrierEvent --does_not_prove→ ExactTrackedMMASet`

### 2. Compute Sanitizer callback 的 observability boundary 已可精確定義

**已確認事實 / 官方 API**：`SanitizerCallbackTensorCoreBarrier(userdata, pc, barrier, isMulticast, multicastMask)` 可由 `tcgen05.commit` 產生；文件並指出 active warp threads 看到相同 callback parameter values。

所以 callback 可直接證明：

`CommitPC + BarrierDSMEMAddress + MulticastMode + CompletionRoutingMask`

但 callback signature 沒有直接攜帶：

`tcgen05.mma PC list / CTA rank / cluster rank / pipeline stage / request_id / layer_id / exact issuer-thread lineage`

request/forward/layer 可以透過上一輪的 per-launch userdata envelope 補上；CTA/cluster/issuer identity則需要額外 instrumentation 或由 kernel topology + dynamic execution context重建。

新增 node：`TensorCoreBarrierCallbackEvidenceBoundary`。

### 3. CUTLASS production-like CTA_2 kernel證明「一個 commit 前可有多個 MMA」

**工程實作 / CUTLASS source**：`mcast_clusterMxN_2cta_mma.py` 中，group leader在每個 K tile 內迴圈跑多個 `k_block_idx`，每一個 block都發出 `tcgen05_mma(...)`；迴圈結束後才執行一次 `tcgen05_commit(ab_empty_mbar, multicast_mask=..., group=CTA_2)`。

所以實際形態是：

`MMA(k0) → MMA(k1) → ... → MMA(kN) → COMMIT`

而不是：

`MMA → COMMIT → MMA → COMMIT`

這證明 `MMASetScopedCompletionWitness` 必須是一級節點。

### 4. 同一 kernel 裡至少存在兩種 commit frontier

CUTLASS source 在 K tile pipeline中以 `ab_empty_mbar` commit，表示前述 MMA consumer已完成對 staging buffer 的使用；整個 K loop之後又對 `acc_done_mbar` 發出 commit，表示 accumulator/TMEM相關 work 的完成邊界。

因此：

`CommitPC + BarrierRole` 才能定義 frontier semantic role。

新增：

- `CommitFrontierRole = STAGING_BUFFER_RELEASE | ACCUMULATOR_DONE | OTHER`
- `StagingBufferReleaseFrontier`
- `AccumulatorCompletionFrontier`

否定 edge：

`SameTcgen05CommitOpcode --does_not_imply→ SamePipelineSemanticRole`

### 5. TMA data readiness與tcgen05 completion形成雙向 stage protocol

CUTLASS source顯示 group leader先等待 `ab_full_mbar`，取得 TMA 已填好的 A/B shared-memory tile；之後發出多個 tcgen05 MMA；最後 tcgen05 commit 到 `ab_empty_mbar`，允許 producer下一輪重用 staging buffer。

所以完整 stage state machine為：

`EMPTY → TMA_EXPECT_TX → TMA_IN_FLIGHT → FULL → MMA_CONSUMING → TCGEN05_COMMIT_FRONTIER → EMPTY_RELEASED → REUSE`

這比單獨研究 TMA barrier 或 tcgen05 completion 更完整：它把 producer readiness 與 consumer release接成同一個 cyclic ownership protocol。

## Architecture Breakdown

### CUTLASS CTA_2 Multicast Pipeline

1. Cluster建立 CTA pair/group identity。
2. 計算 A/B TMA multicast masks。
3. 計算 `ab_empty_mcast_mask`，其語義與 A/B data multicast mask不同。
4. pair leader註冊 `mbarrier_arrive_expect_tx(ab_full_mbar, pair_leader_txcount)`。
5. TMA A/B multicast進 cluster SMEM replicas。
6. group leader等待 `ab_full_mbar` phase ready。
7. K tile被拆成多個 MMA_K granules。
8. 每個 granule發出 asynchronous `tcgen05_mma`。
9. 一次 `tcgen05_commit(ab_empty_mbar, ...)` 將 prior MMA set掛到 empty barrier completion。
10. 下一個 pipeline iteration等待 empty barrier，再重用 staging buffer。
11. K loop完成後，另一個 `tcgen05_commit(acc_done_mbar, pair_mcast_mask, CTA_2)`建立 accumulator-done frontier。
12. output path等待 `acc_done_mbar`，再執行 TMEM load與global store。

## Bottom-Level Logic

新的可驗證 provenance chain：

`RequestID`
`→ ForwardEpoch`
`→ KernelLaunchIdentity`
`→ CTAGroupTopology`
`→ DynamicIssuerLineage`
`→ tcgen05.mma issue events[]`
`→ CommitFrontierPC`
`→ CommitTrackedOperationSet`
`→ tcgen05.commit`
`→ TensorCoreBarrierCallback`
`→ BarrierReplicaRouting`
`→ StageReleaseWitness`
`→ Next TMA Reuse`

要把 `MMASetScopedCompletionWitness` 從推論升級成 runtime evidence，Hermes至少需要兩種事件流：

A. commit event：`launch + commit_pc + barrier + multicast_mask`

B. MMA issue event：`launch + mma_pc + dynamic issuer identity + CTA group + sequence/epoch`

再以 dynamic program order建立：

`MMAIssueEvent --belongs_to→ NextCompatibleCommitFrontier`

其中 compatible至少要求相同 launch、issuer lineage與CTA group。

## Visual Simulation Idea

### TCGen05 Commit Frontier & Stage-Reuse Microscope

UI 分四條同步時間軸：

1. **TMA Producer**：A/B load、expected bytes、full barrier phase。
2. **MMA Issue Stream**：MMA#0、#1、#2…，每個顯示 PC、CTA group、K block。
3. **Commit Frontier**：commit PC、barrier role、multicast mask，並以括號視覺化它「收攏」哪些 prior MMA。
4. **Stage Ownership**：EMPTY → FULL → CONSUMING → RELEASED → REUSED。

互動故障注入：

- 把一個 MMA event錯誤歸到下一個 commit。
- 漏掉一個 MMA issue trace。
- commit使用錯 CTA group。
- commit routing mask少一個CTA replica。
- stage在commit completion前被TMA producer重用。
- `ab_empty_mbar`與`acc_done_mbar`語義角色互換。

對應 failure states：

- `MMA_COMMIT_FRONTIER_MISATTRIBUTION`
- `MMA_ISSUE_TRACE_GAP`
- `CTA_GROUP_LINEAGE_MISMATCH`
- `COMPLETION_REPLICA_OMISSION`
- `STAGE_REUSE_BEFORE_CONSUMER_RELEASE`
- `COMMIT_FRONTIER_ROLE_MISMATCH`

## Code / GitHub

### NVIDIA CUTLASS

值得持續閱讀：

- `examples/python/CuTeDSL/experimental/primitives/tcgen05/mcast_clusterMxN_2cta_mma.py`
  - `pair_leader_txcount`
  - `a_mcast_mask / b_mcast_mask`
  - `ab_empty_mcast_mask`
  - `mbarrier_arrive_expect_tx`
  - `tcgen05_mma`
  - `tcgen05_commit(ab_empty_mbar)`
  - `tcgen05_commit(acc_done_mbar)`
- `examples/python/CuTeDSL/experimental/primitives/tcgen05/clusterMxN_2cta_mma.py`
- CUTLASS CuTeDSL `tcgen05.commit` primitive
- CUTLASS pipeline MbarrierArray / TCGen05Mma operation path

重要工程觀察：`tcgen05.mma` 在DSL使用層可以warp-uniform表達，而compiler處理其single-thread issue規則；`tcgen05.commit`則要求single-thread execution，CuTe API文件要求使用 `elect_one()`。因此 source-level thread structure不能直接等同 generated PTX issuer identity。

## Papers / Technical Sources

### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling

- Authors: Jay Shah et al. / FlashAttention team（作者清單應以下一輪正式論文metadata再鎖定）
- Institution: research/industry collaboration（下一輪補完整 affiliation）
- Year: 2026
- Architecture: Hopper/Blackwell CuTeDSL attention pipeline，Blackwell使用fully asynchronous MMA、TMEM、2-CTA MMA等機制。
- Contribution: attention algorithm與kernel pipeline共同設計，處理新GPU compute/memory scaling的不對稱。
- Limitation for Hermes: 論文描述performance architecture，但不直接提供 request-scoped runtime provenance。
- Code: `Dao-AILab/flash-attention`, `flash_attn/cute/`

### PTX ISA — tcgen05.commit

- Type: NVIDIA official ISA specification
- Key contribution to this round: 定義 commit的tracked operation set是executing thread prior async tcgen05 operations，並依CTA group分流；multicast mask按cluster CTA rank路由mbarrier signal。

### Compute Sanitizer Patching API

- Type: NVIDIA official runtime instrumentation API
- Key contribution: `SANITIZER_INSTRUCTION_TENSOR_CORE_BARRIER` / `SanitizerCallbackTensorCoreBarrier`提供 tcgen05.commit runtime PC、barrier與multicast routing evidence；launch-scoped userdata可將事件接回request/forward/layer envelope。

## 已確認 / 推論 / 尚未驗證

**已確認**：PTX commit tracks prior async tcgen05 operations initiated by executing thread and same CTA group；CUTLASS CTA_2 example在多個 MMA後才commit；Compute Sanitizer可patch Tensor Core barrier event。

**工程推論**：以 launch + dynamic issuer lineage + CTA group + program order，可建立 `CommitTrackedOperationSet` reconstruction algorithm。

**尚未驗證**：Compute Sanitizer是否存在可直接patch Blackwell `tcgen05.mma` 本身、且提供足夠欄位建立 exact MMA issue event。現有官方 Patching API頁面明列 Tensor Core barrier callback，但本輪尚未找到對等的 tcgen05 MMA issue callback signature，因此不能聲稱 exact MMA set已可直接觀測。

## Unknown / Open Questions

1. Compute Sanitizer目前是否有未被一般Patching API文件明列的 tcgen05 MMA issue instrumentation point？若沒有，需要NVBit/SASS patch或debug kernel自建trace。
2. CuTeDSL warp-uniform `cute.gemm` lower成PTX後，CTA_GROUP::2的exact issuer thread如何選定？這個issuer identity能否穩定跨compiler版本作為provenance key？
3. CUDA Graph replay下，同一commit PC反覆出現時，如何低成本建立 per-stage `CommitEpoch`，避免把不同pipeline iteration的 MMA set合併？

## 下一輪研究

優先停止擴張新GPU名詞，直接追 `tcgen05.mma issue observability`：

`CuTeDSL cute.gemm`
`→ generated PTX tcgen05.mma`
`→ generated SASS`
`→ compiler elect/issuer rule`
`→ 是否有 Compute Sanitizer direct MMA patch point`
`→ 若無：NVBit/CUTracer可否patch Blackwell tcgen05 opcode`
`→ MMAIssueEvent schema`
`→ dynamic issuer lineage`
`→ NextCompatibleCommitFrontier join`
`→ MMASetScopedCompletionWitness`
`→ StageReleaseWitness`
`→ Attention output causal probe`

同時把此GPU證據鏈往Hermes Agent上層接回：

`AgentRequest → ModelCall → ForwardEpoch → Layer → KernelLaunch → MMAIssueSet → CommitFrontier → AttentionOutput → Residual → Logits → SampledToken → ToolDecision/AgentAction`

## Knowledge Graph 新增 Node / Edge

### Nodes

- `TCGen05CommitFrontier`
- `CommitTrackedOperationSet`
- `DynamicIssuerLineage`
- `MMAIssueEvent`
- `MMAIssueSequence`
- `TensorCoreBarrierCallbackEvidenceBoundary`
- `CommitFrontierRole`
- `StagingBufferReleaseFrontier`
- `AccumulatorCompletionFrontier`
- `StageReuseAuthorizationWitness`
- `MMASetScopedCompletionWitness`

### Edges

- `MMAIssueEvent --precedes→ TCGen05CommitFrontier`
- `MMAIssueEvent --candidate_member_of→ CommitTrackedOperationSet`
- `TCGen05CommitFrontier --tracks→ CommitTrackedOperationSet`
- `TCGen05CommitFrontier --signals_on_completion→ BarrierReplicaSet`
- `StagingBufferReleaseFrontier --authorizes→ StageReuse`
- `AccumulatorCompletionFrontier --authorizes→ TMEMOutputConsumption`
- `ObservedTensorCoreBarrierEvent --does_not_prove→ ExactTrackedMMASet`
- `SameTcgen05CommitOpcode --does_not_imply→ SamePipelineSemanticRole`
- `SourceWarpUniformGemm --does_not_uniquely_identify→ GeneratedIssuerThread`

## 本輪結束檢查

- **缺哪一層？** `tcgen05.mma runtime issue event → commit frontier` 的直接動態join。
- **哪個節點最淺？** `MMAIssueEvent` production witness。
- **哪個概念仍只是名詞？** `MMASetScopedCompletionWitness`；目前有PTX語義與source reconstruction，但還沒有真實Blackwell runtime trace。
- **哪個系統值得讀原始碼？** CUTLASS CuTeDSL tcgen05 lowering + FlashAttention-4 `flash_attn/cute/` Blackwell kernel。
- **哪篇論文需追引用？** FlashAttention-4，特別是2-CTA MMA / TMEM / asynchronous pipeline後續實作與production integration。
- **哪個概念最適合視覺模擬？** `TCGen05 Commit Frontier & Stage-Reuse Microscope`。
- **哪個 Agent 架構最值得實作？** `State-grounded Planner + Runtime Provenance Verifier + MMA/Commit Frontier Reconstructor + CTA Topology Verifier + Launch Attribution Joiner + Causal Evidence Gate + Tool Executor`。

## 本輪核心結論

上一輪已能把 runtime `tcgen05.commit` callback 接回 inference launch；本輪再確認一個重要邊界：**commit callback本身只證明 completion frontier及其barrier routing，不等於證明 exact MMA set。** 真正要回答「哪一組Tensor Core計算完成後釋放了這個stage」，Hermes必須新增 MMA issue event stream，並以 dynamic issuer lineage、CTA group與program order把 MMA events join到下一個compatible commit frontier。這是把 `MMASetScopedCompletionWitness` 從靜態推論升級為runtime evidence的下一個必要步驟。