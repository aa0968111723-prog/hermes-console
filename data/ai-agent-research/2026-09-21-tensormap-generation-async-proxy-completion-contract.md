# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 17:51 Asia/Taipei

## 本小時新發現
本輪延續前一輪 `TMA Physical Footprint × TensorMap × Binary Runtime Trace Contract`，不重複「TMA 會整頁 over-read」本身，而是向下補齊 **TensorMap descriptor 的 generation/lifetime、async proxy、completion barrier**。核心結論：對 TMA backend，`TensorMapGeneration` 不能只是描述性 metadata；它必須成為 execution provenance 的正式 epoch。CUDA 允許 device-side 修改 TensorMap（包括 base address / size / stride 等），修改後還需要 `tensormap_copy_fenceproxy` 類型的 fence/copy 才能建立正確的 proxy 可見性。另一方面，global→shared TMA 是 asynchronous operation，completion 透過 shared-memory barrier / mbarrier 建立。因此「TMA instruction issued」不等於「shared tile ready for MMA」。

新論文：FlashAttention-4 (Zadouri, Hoehnerbach, Shah, Liu, Thakkar, Dao, 2026) 將 Blackwell attention pipeline重新設計，使用 fully asynchronous MMA、larger tiles、tensor memory、2-CTA MMA；報告在 B200 BF16 最高 1613 TFLOP/s、相對 cuDNN 9.13 最高 1.3×。另一個 2026 cross-architecture CuTile 評估顯示 tile/TMA abstraction 的效能高度依 architecture/workload 而異：B200 fused attention 可高於 FA2，但同一 kernel 在 RTX PRO 6000 Blackwell 上相對 FA2 只有 53%，提醒 Hermes 不應把 `backend=cute/tile` 當成單一 execution contract。

## 本小時最重要 5 個發現

### 1. TensorMap 是 address-generation contract，不只是 kernel parameter
**已確認事實 / 官方資訊。** CUDA TensorMap 描述 multi-dimensional global/shared layout；TMA 透過 descriptor + tensor coordinates 決定 bulk tensor copy。descriptor 綁定 global base、dimensions、strides、box/tile dimensions、element strides、swizzle/OOB 等語義。

底層鏈：
`KV allocation → TensorMap encode → TensorMapGeneration → tensorCoords → cp.async.bulk.tensor → physical tile footprint`。

重要性：`PhysicalPageID` 相同時，只要 TensorMap base/stride/generation 改變，實際 physical footprint 就可能不同。

限制：TensorMap 是 opaque object，Hermes 不能僅靠 application-level page id 還原硬體 copy；需要保存 descriptor construction evidence。

來源：CUDA Driver API 13.4 Tensor Map Object Management；CUDA Programming Guide TMA chapters。

### 2. Device-side TensorMap mutation 建立新的 descriptor epoch
**已確認事實 / 官方資訊。** CUDA 13.x 文件描述 device-side TensorMap modification：可先把 template TensorMap copy 到 shared memory，使用 `tensormap.replace` 修改 base address、size、stride 等欄位，再以 `tensormap_copy_fenceproxy` 類操作複製並建立必要 fencing。

因此新增：
`TensorMapMutationEpoch`、`TensorMapProxyFenceWitness`、`TensorMapDescriptorReadyWitness`。

否定 edge：
`TensorMapFieldsModified --does_not_prove→ TensorMapReadyForTMA`

合理工程推論：如果 KV page/lease 已切換，但 replay/kernel仍使用舊 TensorMap generation，可能產生 `STALE_TENSOR_MAP_GENERATION`，即使 page table 本身是新的。

### 3. TMA issue ≠ shared tile ready
**已確認事實 / 官方資訊。** TMA bulk tensor copies是 asynchronous。global→shared copy的 completion 可透過 shared-memory barrier/mbarrier協調。PTX `cp.async.bulk.tensor` 是 non-blocking initiation，而不是同步 load。

因此底層 pipeline 必須拆成：
`TMAIssueWitness → AsyncProxyInFlight → MBarrierArrival/TransactionExpectation → TMACompletionWitness → SharedTileReadableWitness → MMAConsumerWitness`。

否定 edge：
`SourceTMACopyWitness --does_not_prove→ SharedTileReadableWitness`

這是本輪最重要 bottom-level mechanism。

### 4. Request attribution 必須跨 descriptor epoch + barrier epoch
**工程建模 / 合理推論。** 前一輪的 `RequestTraceAttributionTag` 不足。binary memory trace 若只記 kernel/request，仍無法知道某筆 TMA transfer使用哪一版 TensorMap，也無法證明 consumer MMA是在 transfer completion之後。

新 attribution key：
`request_id + forward_epoch + layer + kv_head + PageTableGeneration + KVLeaseEpoch + TensorMapGeneration + BarrierEpoch + GraphExecIdentity`。

這讓 Expected/Observed diff 可以區分：錯 page、錯 descriptor、錯 barrier、錯 graph replay。

### 5. Backend/architecture identity 必須進 execution contract
**論文結果 + 官方框架資訊。** FlashAttention-4顯示 Blackwell attention效能依 fully async MMA、tile/pipeline設計與tensor memory而改變；CuTile cross-architecture evaluation則顯示同一 tile abstraction在 B200與RTX PRO 6000 Blackwell有明顯差異。FlashInfer current docs也將 FA2/FA3/TRTLLM-Gen/CuTe-DSL/prims-ts視為不同 backend，CuTe-DSL目前針對SM100+且功能子集不同。

因此：
`AttentionExecutionContract = BackendIdentity + GPUArchitecture + KernelVariant + PageLayout + TensorMapGeneration + BarrierProtocol + GraphExecIdentity`。

## Architecture Breakdown
### TMA-backed paged attention evidence pipeline
1. Scheduler/forward selects request and layer.
2. Page table resolves logical KV page → physical page.
3. Backend constructs/selects TensorMap descriptor.
4. `TensorMapGeneration` binds allocation base/layout/strides/tile policy.
5. Kernel computes page/tile tensor coordinates.
6. `cp.async.bulk.tensor` / equivalent TMA primitive issues global→shared transfer.
7. Async proxy owns in-flight transfer.
8. mbarrier/completion protocol proves transaction completion.
9. shared tile becomes consumer-readable.
10. MMA/attention consumes tile.
11. score mask decides semantic contribution.
12. softmax/PV changes attention output → residual → logits.

Production invariant:
`PageTableGeneration ∧ KVLeaseEpoch ∧ TensorMapGeneration ∧ TensorMapProxyFenceWitness ∧ TMACompletionWitness ∧ ConsumerBarrierWitness → SharedKVTileReadable`.

## Bottom-Level Logic
TMA is not equivalent to a normal scalar/vector load. Multi-dimensional TMA moves a tile using an opaque TensorMap plus tensor coordinates. Address derivation therefore crosses two domains:

`semantic KV position → physical page identity → TensorMap coordinate space → descriptor-defined global address → bulk tile transfer → shared-memory tile → MMA`.

A correct provenance verifier must separately validate descriptor creation/mutation and asynchronous completion. A descriptor may be structurally valid but stale; a TMA may be correctly issued but incomplete; a tile may be physically loaded but semantically masked. These are distinct states.

Proposed state machine:
`DESCRIPTOR_UNBOUND → DESCRIPTOR_BOUND → [MUTATED] → PROXY_FENCED → TMA_ISSUED → IN_FLIGHT → BARRIER_COMPLETE → SHARED_TILE_READABLE → MMA_CONSUMED → SEMANTIC_ACTIVE/MASKED`.

Fail-closed states:
`STALE_TENSOR_MAP_GENERATION`, `TENSOR_MAP_MUTATION_UNFENCED`, `TMA_ISSUED_WITHOUT_COMPLETION_WITNESS`, `MMA_CONSUMER_BEFORE_TMA_COMPLETE`, `BARRIER_EPOCH_MISMATCH`, `TRACE_WITHOUT_DESCRIPTOR_GENERATION`.

## Visual Simulation Idea
### TensorMap → TMA → Barrier → MMA Pipeline Microscope
Interactive lanes:
- Logical KV / PageTable
- KV allocation + LeaseEpoch
- TensorMap descriptor fields/generation
- TMA issue queue
- async proxy + mbarrier
- shared-memory tile
- MMA/Attention
- semantic mask / contribution

Controls: mutate base address/stride, reuse physical page, skip proxy fence, delay TMA completion, replay old GraphExec, swap backend (FA3/CuTe-DSL/prims-ts), alter page size. UI should render expected tile footprint and observed/instrumented references separately.

## Code / GitHub
Priority source targets for next source-code pass:
- FlashInfer CuTe DSL paged GQA decode and TMA loader implementation: trace TensorMap creation, `virtual_page_idx`, K/V TMA coordinates, barrier protocol, shared-tile consumer.
- NVBit: SASS inspection/injection around memory instructions; current public NVBit 1.8 supports SM up to 12.1 and memory-reference tracer style tools.
- CUTracer: NVBit-based memory/opcode/register tracing, CUDA Graph-aware runtime injection; candidate for Hermes debug instrumentation adapter.
- Hermes implementation target: `TensorMapContractVerifier`, `AsyncProxyCompletionVerifier`, `RequestTraceAttributionJoiner`.

## Papers
### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling
- Authors: Ted Zadouri, Markus Hoehnerbach, Jay Shah, Timmy Liu, Vijay Thakkar, Tri Dao
- Institution: author affiliations to verify from full paper metadata in next citation pass
- Year: 2026
- URL: https://arxiv.org/abs/2603.05451
- Code: CuTe-DSL implementation is described; exact canonical repository/version should be pinned in next pass
- Dataset/Workload: attention kernel benchmarks on Blackwell/B200; not a dataset-centric paper
- Architecture: fully asynchronous MMA pipeline, larger tiles, tensor memory, 2-CTA MMA design
- Contribution: co-designs attention algorithm/kernel pipeline for Blackwell asymmetric scaling
- Limitations: architecture-specific; performance/correctness provenance still requires backend/runtime integration evidence
- Changed: reinforces that attention physical execution contract is architecture/kernel-generation specific, not just `attention(Q,K,V)`.

### Evaluating CUDA Tile for AI Workloads on Hopper and Blackwell GPUs
- Authors: Divakar Kumar Yadav, Tian Zhao, Deepak Kumar
- Institution: verify from full paper in next pass
- Year: 2026
- URL: https://arxiv.org/abs/2604.23466
- Code/Dataset: to verify
- Architecture: tile-centric CUDA abstraction evaluated across H100 NVL, B200, RTX PRO 6000 Blackwell
- Contribution: independent cross-architecture evaluation including fused attention and end-to-end LLM inference
- Limitations: performance evaluation, not a memory-provenance/correctness tracing study
- Changed: demonstrates that architecture identity must be part of kernel/backend evidence rather than assuming portability equivalence.

## Unknown / Open Questions 1-3
1. FlashInfer CuTe paged decode current generated PTX/SASS中，K/V TMA operation與mbarrier的 exact opcode/phase protocol為何？
2. NVBit/CUTracer對SM100/SM120 TMA instruction能取得的是 instruction witness、descriptor operand、effective address，還是只能看到部分 reference metadata？
3. CUDA Graph replay時 TensorMap descriptor mutation / graph-owned descriptor lifetime如何與 `GraphExecIdentity`、KV allocation reuse精準join？

## 下一輪研究
`FlashInfer CuTe source → TensorMap construction → descriptor generation → virtual_page_idx/tensorCoords → TMA issue → mbarrier protocol → shared tile → MMA consumer → generated PTX/SASS → NVBit/CUTracer observability matrix → request/layer/page attribution`。

實驗設計：建立 debug-only KV trace mode，對單 request/單 layer/單 head記錄 PageTableGeneration、KVLeaseEpoch、TensorMapGeneration、TMA tile coordinate、barrier epoch；再做 ZERO/REPLACE selected physical page intervention，測 `ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction`。

## Knowledge Graph 新增 Node / Edge
Nodes:
- `TensorMapMutationEpoch`
- `TensorMapProxyFenceWitness`
- `TensorMapDescriptorReadyWitness`
- `TMAIssueWitness`
- `AsyncProxyInFlightState`
- `TMACompletionWitness`
- `BarrierEpoch`
- `SharedTileReadableWitness`
- `MMAConsumerWitness`
- `AttentionExecutionContract`
- `StaleTensorMapGenerationState`

Edges:
- `TensorMapFieldsModified --requires→ TensorMapProxyFenceWitness`
- `TensorMapProxyFenceWitness --supports→ TensorMapDescriptorReadyWitness`
- `TMAIssueWitness --creates→ AsyncProxyInFlightState`
- `TMACompletionWitness --resolves→ AsyncProxyInFlightState`
- `TMACompletionWitness + ConsumerBarrierWitness --supports→ SharedTileReadableWitness`
- `SharedTileReadableWitness --precedes→ MMAConsumerWitness`
- `TMAIssueWitness --does_not_prove→ SharedTileReadableWitness`
- `PhysicalPageID --does_not_define→ TensorMapGeneration`
- `MMAConsumerWitness --does_not_prove→ SemanticContribution`

## 本輪結束判斷
- 缺哪一層：generated PTX/SASS 的 TMA+mbarrier exact protocol到 runtime binary trace。
- 哪個節點最淺：`TMACompletionWitness` 的 production instrumentation instance。
- 哪個概念仍只是名詞：`HardwareMemoryTransactionWitness`；目前仍不能把 binary-level reference等同DRAM transaction。
- 哪個系統值得讀原始碼：FlashInfer CuTe DSL paged decode/TMA loader + NVBit/CUTracer。
- 哪篇論文需追引用：FlashAttention-4，尤其CuTe-DSL/Blackwell pipeline與後續kernel implementation引用。
- 哪個概念最適合視覺模擬：TensorMap → TMA → Barrier → MMA Pipeline Microscope。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Runtime Provenance Verifier + TensorMap Contract Verifier + Async Proxy Completion Verifier + Binary Instrumentation Controller + Request Trace Attribution Joiner + Causal KV Probe + Causal Evidence Gate + Tool Executor`。

本輪把「page/tile被TMA搬運」再拆成兩個之前未充分建模的 correctness epoch：**descriptor generation** 與 **async completion/barrier generation**。這讓 Hermes 下一步可以驗證的不只是「搬哪裡」，而是「用哪一版地址描述器搬、何時真的搬完、哪個 MMA consumer有資格讀」。