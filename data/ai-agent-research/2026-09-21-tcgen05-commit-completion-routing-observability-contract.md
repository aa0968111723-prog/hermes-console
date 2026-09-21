# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 21:54 Asia/Taipei

## 本小時新發現
本輪延續前一輪 Cluster Multicast TMA × Barrier Replica Topology，但避免重複 TMA load fanout；改追 Blackwell Tensor Core 的另一條 completion path：`tcgen05.mma/cp → tcgen05.commit → mbarrier arrive → consumer reuse`，並找到 NVIDIA Compute Sanitizer Patching API 已提供 Blackwell tensor-core barrier callback，可直接觀察 `pc + barrier DSMEM address + isMulticast + multicastMask`。這使先前仍只是概念的 `CompletionDestinationReplicaSet` 開始具有可實作 runtime witness。

新架構/機制：
- Blackwell `tcgen05.commit.cta_group::{1|2}.mbarrier::arrive::one[.multicast::cluster]` completion routing。
- CUTLASS `tcgen05_commit` 對 CTA_2 multi-group cluster 的 per-group multicast mask 規則。
- Compute Sanitizer Patching API 的 `SanitizerCallbackTensorCoreBarrier` runtime observation surface。
- Task-scheduling PipelineTmaUmma 中「TMA producer mask」與「tcgen05 empty-barrier consumer mask」可能必須不同。

## 本小時最重要 5 個發現

### 1. tcgen05.commit 不是一般 software arrive，而是 Tensor Core async completion witness
**已確認事實 / 官方資訊。** PTX ISA 定義 `tcgen05.commit`：它令指定 mbarrier 追蹤「由 executing thread 發起的、同 CTA group 的 prior asynchronous tcgen05 operations」；等這些 operation 完成後，系統才對 mbarrier 觸發 `.arrive::one`。CTA group 1 與 group 2 分開追蹤。

底層：
`tcgen05.mma/cp issue → async tcgen05 in-flight set(thread, CTAGroup) → tcgen05.commit → hardware tracks prior set → completion → mbarrier arrive::one`

因此：
`tcgen05.commit issued --does_not_imply→ TensorCoreWorkCompleted`
而是 commit 建立一個 completion subscription / tracking relation。

### 2. CTA_2 multicast mask 是 completion routing contract，不是 TMA byte-delivery mask
**已確認事實 / 官方工程文件。** CUTLASS primitives 說明 `tcgen05_commit(..., group=CTA_2, multicast_mask=...)` 的 mask 是 cluster-rank bitmask；bit i 代表 arrive 落到 cluster rank i 的相同 SMEM offset mbarrier。單一 2-CTA cluster 可用 `0b11`；多個 2-CTA group 時每組 leader 必須把 mask 移到自己的 pair，例如 `3 << cluster_rank`。硬編碼 `3` 會讓後續 group 收不到 arrive 並 deadlock。

重要差異：TMA multicast 的 mask 描述 data/byte delivery；tcgen05.commit multicast 描述 Tensor Core completion arrive routing。兩者不能因數值相似就共用 provenance。

新增：`CompletionRoutingMaskType = TMA_BYTE_DELIVERY | TCGEN05_ARRIVE_ROUTING`。

### 3. producer multicast topology 與 consumer completion topology 可以不同
**已確認工程實作。** NVIDIA CUTLASS 的 3-cluster task-scheduling tutorial 明確 override `PipelineTmaUmma.create()`：預設 `consumer_mask = producer_mask` 只覆蓋共享 A/B data 的 CTA；但 empty barrier 上的 tcgen05_commit 必須到達 cluster 中 ALL CTAs，否則 diagonal pair 會漏掉彼此 commit 而 deadlock。因此 multi-CTA pipeline 至少存在兩張 routing graph：

`TMADataFanoutGraph != TensorCoreCompletionFanoutGraph`

這是前一輪 BarrierReplicaTopology 的重要深化：同一 stage 的「資料從哪裡來」與「誰必須收到 consumer completion」不是同一拓撲。

### 4. runtime 已有官方 callback 可觀察 Blackwell tensor-core barrier routing
**已確認事實 / 官方工具。** NVIDIA Compute Sanitizer Patching API 定義 `SanitizerCallbackTensorCoreBarrier(userdata, pc, barrier, isMulticast, multicastMask)`，說明此事件可由 `tcgen05.commit` 產生；callback直接暴露 patched instruction PC、DSMEM mbarrier address、是否 multicast 與 multicast mask。

這讓 runtime witness 可建為：
`TensorCoreBarrierEvent = {kernel, pc, cluster/CTA attribution, barrier_dsmem, multicast, multicast_mask, timestamp/sequence}`

它仍不直接給 request_id/layer/head，但已足以驗證 `ExpectedCompletionDestinationReplicaSet` 與 observed routing operands。

### 5. tcgen05 execution contract 還必須包含 CTA group identity與 issuing-thread lineage
**官方資訊 + 合理建模。** CUTLASS tcgen05 文件指出 MMA 是 asynchronous；CTA_GROUP::1 與 CTA_GROUP::2 有不同 issue granularity，且所有 tcgen05 operations 必須使用一致 group。`tcgen05.commit` 只追蹤「current thread」先前發起、同 group 的 async tcgen05 operations。因此僅看到 barrier address/mask仍不足以證明 commit追蹤了正確 MMA set。

新增：
`Tcgen05AsyncOperationSetIdentity = KernelLaunch + CTAGroup + IssuerThreadLineage + CommitPC + CommitEpoch`

否定 edge：
`ObservedCommitBarrierEvent --does_not_prove→ CorrectPriorTcgen05OperationSet`

## Architecture Breakdown
### Blackwell Attention / GEMM completion path
1. Scheduler/model runtime 選定 Blackwell kernel variant。
2. CTA cluster 建立 `CTAGroupIdentity` 與 pair topology。
3. TMA 將 K/V/A/B tile 搬入 SMEM/TMEM path。
4. `tcgen05.mma` 非同步發出 Tensor Core work。
5. Kernel在 stage lifecycle 的 completion boundary 發出 `tcgen05.commit`。
6. commit綁定 current issuing thread 先前的同-group tcgen05 async set。
7. work完成後 hardware 對 local 或 multicast barrier replicas執行 arrive::one。
8. consumer/producer pipeline wait parity/phase觀察 barrier transition。
9. stage被釋放/重用。

### 兩張不可混淆的 topology
`Data topology: Global tile → TMA multicast → destination CTA SMEM replicas`

`Completion topology: tcgen05 issuer/group → commit → completion mask → empty/full barrier replicas`

## Bottom-Level Logic
令 `G` 為 CTA group，`T` 為 issuing thread lineage，`O(T,G,e)` 為 commit epoch e 之前由 T 發出的未被前一 commit切斷的 async tcgen05 operation set。

`commit(T,G,e,B,M)` 建立：
`Track(O(T,G,e)) → on_complete(arrive_one(B replica for each CTA in M))`

因此 correctness 至少要求：
- `ExpectedCTAGroup == ObservedCTAGroup`
- `ExpectedIssuerLineage == CommitIssuerLineage`
- `ExpectedCompletionReplicaSet == Decode(multicastMask)`
- `BarrierGeneration/Phase` 正確
- 每個 required replica收到正確 multiplicity 的 completion arrive
- stage release發生在 Tensor Core async set真正完成之後

新 failure states：
- `TCGEN05_COMMIT_GROUP_MISMATCH`
- `TCGEN05_COMMIT_WRONG_ISSUER_LINEAGE`
- `TCGEN05_COMPLETION_MASK_ALIAS`
- `TCGEN05_REQUIRED_REPLICA_OMITTED`
- `TCGEN05_UNEXPECTED_REPLICA_SIGNALLED`
- `DATA_FANOUT_COMPLETION_FANOUT_CONFLATION`
- `COMMIT_EVENT_WITHOUT_REQUEST_ATTRIBUTION`

## Visual Simulation Idea
### Dual Routing Graph: TMA Data vs Tensor-Core Completion
互動 UI 左側顯示 CTA cluster，例如 4×2；上層畫 TMA A/B/K/V data multicast edges，下層畫 tcgen05.commit completion edges。

可切換：
- CTA_GROUP::1 / ::2
- cluster rank / pair leader
- producer TMA mask
- tcgen05 completion mask
- barrier SMEM offset
- phase/parity
- stage index
- commit PC

Console 將 Expected/Observed 疊圖：
- 綠：expected and observed
- missing edge：required replica未收到 completion
- extra edge：signal到未授權 replica
- topology mismatch：data mask被錯拿來當completion mask

下一步可接 Compute Sanitizer callback event stream，讓圖從模擬器升級成 runtime trace viewer。

## Code / GitHub
### NVIDIA CUTLASS
值得繼續看的目錄/核心檔：
- `examples/python/CuTeDSL/experimental/task_scheduling/blackwell/tutorial/04_gemm_bf16_advanced_ts/01_fp16_bf16_gemm_3_cluster.py`
  - actual cluster rank
  - pair/group mapping
  - TMA multicast mask
  - `PipelineTmaUmma.create()` consumer_mask override
- Python DSL primitives `tcgen05_commit`
- task_scheduling pipeline `TSPipelineUmmaUmma`
- Blackwell functionality docs for tcgen05 MMA group semantics

### FlashAttention-4
Repo: `Dao-AILab/flash-attention`
目前 README 已將 FlashAttention-4列為 CuTeDSL implementation，針對 Hopper/Blackwell。下一輪要追真正 2-CTA callsites，將 attention-specific CTA group topology接到上述 generic CUTLASS contract。

### Runtime instrumentation
NVIDIA Compute Sanitizer Patching API：優先實作 TensorCoreBarrier callback adapter，欄位至少：PC、barrier DSMEM address、multicast bool、mask，再與 kernel launch/CTA rank/stage metadata join。

## Papers
### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling
- Authors: Ted Zadouri, Markus Hoehnerbach, Jay Shah, Timmy Liu, Vijay Thakkar, Tri Dao
- Institution: NVIDIA / Dao-AILab ecosystem（作者 affiliation 以論文為準）
- Year: 2026
- URL: https://arxiv.org/abs/2603.05451
- Code: https://github.com/Dao-AILab/flash-attention
- Dataset: kernel benchmark / attention workloads，不是資料集型研究
- Architecture: Blackwell attention pipeline，fully asynchronous MMA、larger tiles、TMEM、2-CTA MMA；CuTeDSL implementation
- Contribution: 針對 Blackwell asymmetric scaling重新設計 attention algorithm/kernel pipeline；報告 B200 BF16最高1613 TFLOP/s、71% utilization、相對 cuDNN 9.13最高1.3×
- Limitations: performance/correctness contract高度依賴 GPU architecture、kernel variant與 pipeline topology；論文本身不提供 request-level provenance instrumentation
- 改變了什麼：讓 `CTAGroupIdentity + TensorCoreCompletionTopology` 成為 attention execution contract 的一級節點，而不是底層實作細節。

### Hardware-Aware FP4 FlashAttention-4
- Author: Robert Hu
- Year: 2026
- URL: https://arxiv.org/abs/2609.04105
- Architecture: Blackwell FP4 attention path
- Contribution: 顯示降低 matmul precision後，softmax conversion/on-chip dependency會成為更主要瓶頸；Direct-P noncausal path報告最高2.13× BF16 forward throughput
- Limitations: 單一新工作，需繼續驗證 code與後續引用；本輪只作為「Tensor Core加速會把同步/資料流瓶頸推向前台」的旁證，不把其性能結果泛化到所有 attention workload。

## Unknown / Open Questions 1-3
1. Compute Sanitizer TensorCoreBarrier callback 是否能穩定取得足以 join cluster rank / CTA pair / stage 的執行上下文？callback schema本身沒有 request_id。
2. FlashAttention-4 current 2-CTA attention kernel中，哪些 `tcgen05.commit` 對應 accumulator/TMEM completion，哪些對應 SMEM stage release？其 completion masks如何由 `cta_layout_vmnk`產生？
3. `tcgen05.commit` callback觀察到的是 instruction issue event還是 completion-side event語義？需要用 controlled delay / dependency microbenchmark驗證 timestamp含義，不能從 callback名稱直接推定。

## 下一輪研究
`FlashAttention-4 CuTeDSL source → 2-CTA variant selection → cta_layout_vmnk → tcgen05.mma issuer → tcgen05.commit callsite → completion mask construction → Compute Sanitizer TensorCoreBarrier callback → observed PC/barrier/mask → CTA rank/pair/stage attribution → expected vs observed completion replica graph → stage release → ΔAttention / ΔLogit / ΔToken`

優先建立一個最小 Blackwell microbenchmark：兩個2-CTA groups、故意把第二組 completion mask錯設為 `0b0011`，驗證 callback能否觀察錯誤 routing，並將 deadlock與 missing replica建立因果關係。

## Knowledge Graph 新增 Node / Edge
### Nodes
- `Tcgen05CommitEpoch`
- `Tcgen05AsyncOperationSetIdentity`
- `Tcgen05CTAGroupIdentity`
- `Tcgen05IssuerThreadLineage`
- `TensorCoreCompletionRoutingMask`
- `ExpectedCompletionDestinationReplicaSet`
- `ObservedTensorCoreBarrierEvent`
- `ObservedCompletionRoutingMask`
- `DataFanoutGraph`
- `TensorCoreCompletionFanoutGraph`
- `CompletionRoutingMaskType`
- `TensorCoreStageReleaseWitness`

### Edges
- `Tcgen05CommitEpoch --tracks→ Tcgen05AsyncOperationSetIdentity`
- `Tcgen05AsyncOperationSetIdentity --scoped_by→ Tcgen05CTAGroupIdentity`
- `Tcgen05AsyncOperationSetIdentity --issued_by→ Tcgen05IssuerThreadLineage`
- `TensorCoreCompletionRoutingMask --decodes_to→ ExpectedCompletionDestinationReplicaSet`
- `ObservedTensorCoreBarrierEvent --contains→ ObservedCompletionRoutingMask`
- `ObservedCompletionRoutingMask --compare_with→ ExpectedCompletionDestinationReplicaSet`
- `TMADataFanoutGraph --not_equivalent_to→ TensorCoreCompletionFanoutGraph`
- `Tcgen05CommitIssued --does_not_prove→ TensorCoreWorkCompleted`
- `ObservedTensorCoreBarrierEvent --does_not_prove→ CorrectPriorTcgen05OperationSet`
- `SameBarrierOffset --does_not_identify→ SameBarrierReplicaGeneration`

## 本輪結束判斷
- 缺哪一層：`tcgen05.commit source callsite → generated PTX/SASS → runtime callback → request/layer/stage attribution`。
- 最淺節點：`Tcgen05IssuerThreadLineage` 的 runtime join。
- 哪個概念仍只是名詞：`TensorCoreStageReleaseWitness` 的 request-scoped production instance。
- 哪個系統值得讀原始碼：FlashAttention-4 CuTeDSL 2-CTA attention kernel + CUTLASS PipelineTmaUmma/TSPipelineUmmaUmma。
- 哪篇論文需追引用：FlashAttention-4；另追 Hardware-Aware FP4 FlashAttention-4，觀察 precision scaling如何改變 on-chip pipeline bottleneck。
- 哪個概念最適合視覺模擬：`Dual Routing Graph: TMA Data vs Tensor-Core Completion`。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Runtime Provenance Verifier + CTA/Cluster Topology Verifier + TensorCore Completion Routing Verifier + Compute-Sanitizer Instrumentation Adapter + Request Trace Attribution Joiner + Causal Evidence Gate + Tool Executor`。

## Evidence classification
- **官方確認**：PTX `tcgen05.commit` completion semantics、CUTLASS CTA_2 multicast-mask規則、Compute Sanitizer TensorCoreBarrier callback schema。
- **工程實作確認**：CUTLASS 3-cluster tutorial中 data producer mask與empty-barrier consumer mask需要不同，否則可能 deadlock。
- **論文結果**：FlashAttention-4效能與2-CTA/TMEM/async pipeline設計。
- **合理推論**：將 callback event join成 request/layer/stage provenance graph；需下一輪實驗驗證。
- **尚未驗證假說**：callback timestamp是否代表 commit issue或 completion-side observation，以及能否低擾動地取得完整 request-scoped event stream。
