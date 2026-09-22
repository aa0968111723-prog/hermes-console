# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-22 12:52 Asia/Taipei

## 本小時主題
**CUDA Stream Ordering × Attention-Metadata Publication × Slot-Mapping Safety Contract**

## 與歷史研究比較
上一輪已建立 `CPUBlockTableGeneration → KernelBlockTableGeneration → DeviceBlockTableGeneration → SlotMappingGeneration → AttentionMetadataGeneration`，但最淺節點仍是 `DeviceBlockTablePublicationWitness`：CPU 呼叫 copy 並不等於 GPU consumer 已可安全讀取。本輪不再重複 page-table identity，而是深入 **publication 的 execution-order mechanism**，並用 2026-08 vLLM slot-mapping 真實缺陷驗證「metadata shape/validity」也是 correctness contract。

## 本小時新發現
1. CUDA stream 是 in-order work queue：同一 stream 內 async copy 與後續 kernel launch依 enqueue order執行；不同 non-blocking streams 之間不能推定 ordering，必須有 event/synchronization dependency。
2. vLLM `BlockTable.commit_block_table()` 只呼叫 `CpuGpuBuffer.copy_to_gpu(num_reqs)`；`compute_slot_mapping()` 隨後讓 Triton kernel讀 `block_table.gpu`。因此真正的 publication witness 不是 Python function return，而是 **copy 與 consumer kernel 之間的 stream/dependency relation**。
3. current vLLM `BlockTable` 同時維護 CPU/GPU buffer、manager→kernel block translation、per-group slot mapping；同一 request 在 hybrid KV groups中可能有不同 row width、block size與 slot-mapping mode。
4. 2026-08-27 vLLM issue #53982 揭露 `_compute_slot_mapping_kernel` 對窄 block-table group缺少 column-range mask：token/CP mask正確仍可能 OOB。報告在 8× MI325X 上觀察到長 context GPU memory fault；加入 `block_indices < block_table_stride` guard後指定配置可跑到 250k context。這是工程 issue 證據，不應泛化成所有 CUDA/ROCm 配置都會 fault。
5. 因此 metadata publication correctness 必須拆成兩軸：`TemporalPublicationSafety` 與 `StructuralAddressabilitySafety`。即使 copy ordering完全正確，錯誤的 row-width contract仍可產生非法或語義錯誤 slot mapping。

## 本小時最重要 5 個發現

### 1. Device publication 是 dependency graph，不是 host-side boolean
**概念**：`commit_block_table()` 返回不等於 attention metadata 已可被任意 stream consumer安全讀取。

**底層如何運作**：
`CPU mutation → enqueue H2D copy(stream A) → copy completion frontier → [same-stream order OR event edge] → slot-mapping kernel(stream B/A) → metadata consumer`

同一 stream：enqueue order提供 execution dependency。不同 stream：需要 event/wait或其他明確 dependency；不能依 host call順序推定 GPU execution order。

**為什麼重要**：Hermes 若只追 Python call graph，會把「copy已排入queue」誤判成「device generation已發布」。

**限制**：本輪尚未把 vLLM 的實際 PyTorch current-stream / CpuGpuBuffer copy implementation與 attention launch stream逐一 runtime trace join。

**證據類型**：NVIDIA 官方 CUDA stream semantics + vLLM current source。

### 2. Publication witness 應拆成 Enqueue / Dependency / Consumer 三個 witness
新增：
- `DeviceMetadataCopyEnqueueWitness`
- `DeviceMetadataDependencyWitness`
- `DeviceMetadataConsumerReadWitness`

並建立：
`CopyEnqueued --does_not_prove→ CopyCompleted`
`CopyCompleted --does_not_prove→ ConsumerOrderedAfterCopy`
`SameHostThreadCallOrder --does_not_prove→ CrossStreamGPUOrder`

這比上一輪單一 `DeviceBlockTablePublicationWitness` 更可驗證。

### 3. Slot mapping 還有 structural addressability contract
vLLM `ComputeSlotMappingKernel` 由 position / query range / block table / CP mapping計算 physical slot。2026-08 issue #53982指出某些窄 side-cache group的 computed `block_indices` 可以超過 row stride，而既有 mask只涵蓋 token validity與CP ownership。

新增：
`SlotMappingStructuralSafety = TokenValid ∧ CPOwnershipValid ∧ BlockColumnInRange ∧ RowGenerationMatch ∧ BlockSizeContractMatch`

因此：
`TokenValidityWitness --does_not_prove→ BlockTableAddressabilityWitness`

### 4. Memory fault與semantic corruption是同一 contract 的兩種 manifestation
若 OOB index落到 unmapped memory，可能直接 fault；若落到仍 mapped allocator region，可能讀出合法地址範圍內但錯誤的 block number。issue #53982 本身指出 fault threshold受 allocator layout影響，且未驗證 CUDA manifestation。

Hermes 因此不能只等 crash：
`NoGPUFault --does_not_prove→ CorrectSlotMapping`

需要主動驗證 mapping identity與bounds。

### 5. AttentionMetadataGeneration 應包含 publication topology
新的 identity：
`AttentionMetadataGeneration = RequestBatchGeneration + KVCacheGroupIdentity + DeviceBlockTableGeneration + SlotMappingGeneration + PositionGeneration + QueryStartLocGeneration + PublicationStreamIdentity + DependencyGeneration`

這讓同一 tensor address在 CUDA Graph replay、speculative decode或多 cache-group情況下仍能區分 generation。

## Architecture Breakdown
### vLLM metadata-to-attention path
`SchedulerOutput`
→ `InputBatch row identity`
→ `KV manager block IDs`
→ `BlockTable.add/append/move/swap`
→ `manager→kernel block translation`
→ `CPU block-table generation`
→ `commit_block_table / H2D enqueue`
→ `CUDA stream dependency`
→ `DeviceBlockTableGeneration`
→ `ComputeSlotMappingKernel`
→ `SlotMappingGeneration`
→ `CommonAttentionMetadata`
→ `backend-specific metadata`
→ `FlashAttention / FlashInfer / other backend`
→ `KV read/write`
→ `Attention O`

### System reasoning vs model reasoning
這整條路徑屬於 **system/runtime reasoning and execution provenance**，不是模型內部 chain-of-thought。模型數學可以完全正確，但 runtime metadata generation錯誤仍會讓模型讀錯KV。

## Bottom-Level Logic
### CUDA publication state machine
`HOST_DIRTY(G)`
→ `COPY_ENQUEUED(G, stream=S)`
→ `COPY_IN_FLIGHT(G)`
→ `DEVICE_BYTES_READY(G)`
→ `DEPENDENCY_SATISFIED(G, consumer_stream=C)`
→ `CONSUMER_READABLE(G)`
→ `SLOT_MAPPING_DERIVED(G)`
→ `ATTENTION_METADATA_CONSUMABLE(G)`

### Required invariant
`MetadataConsumable = DeviceBytesReady ∧ ConsumerOrderedAfterPublication ∧ StructuralBoundsValid ∧ BatchRowGenerationMatch ∧ KVGroupMatch ∧ PositionGenerationMatch`

### Failure family
- `METADATA_COPY_ENQUEUED_BUT_NOT_ORDERED`
- `CROSS_STREAM_METADATA_RACE`
- `STALE_DEVICE_BLOCK_TABLE_GENERATION`
- `SLOT_MAPPING_BLOCK_COLUMN_OOB`
- `SLOT_MAPPING_ROW_GENERATION_MISMATCH`
- `KV_GROUP_WIDTH_CONTRACT_MISMATCH`
- `NO_FAULT_BUT_WRONG_MAPPED_BLOCK_READ`
- `CUDA_GRAPH_REPLAY_METADATA_GENERATION_ALIAS`

## Visual Simulation Idea
### CUDA Metadata Publication & Slot-Mapping Race Microscope
互動式四軌 timeline：
1. Host scheduler / CPU block table
2. H2D copy stream
3. slot-mapping/metadata stream
4. attention kernel stream

每個 generation 用 G7/G8 標記。使用者可切換：
- same stream / different stream
- event wait on/off
- row width
- block size / kernel block size
- CP rank
- request position
- CUDA Graph replay generation

UI 同時顯示：
`Temporal Publication ✓/✗`
`Structural Bounds ✓/✗`
`Semantic Generation ✓/✗`
`Memory Fault ✓/✗`

最重要示範：`Memory Fault ✗ | Structural Bounds ✗ | Semantic Correctness ✗`，說明「沒 crash」不代表正確。

## Code / GitHub
### vLLM
值得繼續追：
- `vllm/v1/worker/block_table.py`
  - `BlockTable.commit_block_table`
  - `BlockTable.compute_slot_mapping`
  - `ComputeSlotMappingKernel`
  - `map_to_kernel_blocks`
- `vllm/v1/worker/gpu/model_runner.py`
  - block-table commit時點
  - attention metadata build時點
  - CUDA Graph replay metadata update
- `CpuGpuBuffer.copy_to_gpu`
  - 是否使用 non_blocking copy
  - current stream identity
  - pinned-memory semantics
- backend metadata builders
  - FlashAttention
  - FlashInfer
  - speculative decode / DFlash

### 真實工程缺陷
vLLM issue #53982（2026-08-27）報告 `_compute_slot_mapping_kernel` 對窄 block-table group缺少 block-column range guard；作者在 MI325X/ROCm配置上以 instrumentation重現 OOB，並以兩行 range guard消除指定測試配置的 fault。此 issue 仍應視為工程證據，不等於已證明所有平台行為。

## Papers / Technical Sources
### NVIDIA CUDA Programming Guide — Asynchronous Execution / CUDA Streams
- Institution: NVIDIA
- Year: current CUDA 13.x documentation
- Architecture: stream-ordered async copy/kernel execution
- Contribution to this graph: 定義同 stream ordering與跨 stream不能隱式假設 ordering的底層 execution contract
- Limitation: 不描述 vLLM-specific tensor generation identity

### vLLM source + issue #53982
- Institution/Project: vLLM community
- Year: 2026 current source / issue opened 2026-08-27
- Code: vLLM GitHub
- Architecture: CPU/GPU BlockTable + Triton ComputeSlotMappingKernel
- Contribution: 提供 production serving runtime的 metadata path與真實 bounds failure
- Limitation: issue實測主要為 ROCm MI325X；CUDA manifestation未驗證

## 已確認 / 推論 / 未驗證
**已確認（官方）**：CUDA同一stream operations依enqueue order執行；不同streams不能靠隱含順序保證 correctness。

**已確認（工程原始碼）**：vLLM BlockTable具有 CPU/GPU buffer、commit copy、GPU slot-mapping kernel、manager→kernel block translation。

**已確認（工程 issue）**：#53982 報告特定窄group path的OOB與MI325X重現結果。

**合理推論**：若 OOB落在mapped allocator memory，系統可能不 crash但產生錯誤block number，因此需要semantic verifier而非只靠memory fault detector。

**尚未驗證假說**：current vLLM production CUDA path是否存在任何實際 cross-stream block-table publication race；本輪沒有證據宣稱存在，只建立必須驗證的 contract。

## Unknown / Open Questions
1. `CpuGpuBuffer.copy_to_gpu` 在 current vLLM GPU runner中究竟 enqueue 到哪個 torch/CUDA stream？attention metadata builder與kernel launch是否必然同 stream？
2. CUDA Graph FULL/PIECEWISE replay時，block table / slot mapping 的 generation publication如何與固定buffer address綁定，是否有顯式 event或依賴？
3. issue #53982 的 range guard是否已進入後續commit/PR；不同 backend-specific builder是否會重算 mapping並完全繞過 generic output？

## 下一輪研究
`CpuGpuBuffer.copy_to_gpu`
→ `torch current stream`
→ `non_blocking H2D semantics`
→ `gpu_model_runner commit timing`
→ `slot-mapping launch stream`
→ `CommonAttentionMetadata build`
→ `CUDA Graph capture/replay buffer identity`
→ `backend kernel launch`
→ `event/stream dependency`
→ `runtime generation trace`
→ `KV read/write`

## Knowledge Graph 新增 Node
- `DeviceMetadataCopyEnqueueWitness`
- `DeviceMetadataCopyCompletionWitness`
- `DeviceMetadataDependencyWitness`
- `PublicationStreamIdentity`
- `ConsumerStreamIdentity`
- `CrossStreamDependencyGeneration`
- `BlockTableAddressabilityWitness`
- `SlotMappingStructuralSafetyWitness`
- `KVGroupWidthContract`
- `CUDAReplayMetadataGeneration`
- `NoFaultSemanticCorrectnessWitness`

## Knowledge Graph 新增 Edge
- `CPUBlockTableGeneration --enqueue_copy→ DeviceMetadataCopyEnqueueWitness`
- `DeviceMetadataCopyCompletionWitness --requires_ordering_to→ DeviceMetadataConsumerReadWitness`
- `SameStreamEnqueueOrder --establishes→ ExecutionDependency`
- `DifferentStreams --require_explicit_dependency_for→ PublicationOrdering`
- `TokenValidityWitness --does_not_prove→ BlockTableAddressabilityWitness`
- `NoGPUFault --does_not_prove→ CorrectSlotMapping`
- `SlotMappingStructuralSafetyWitness --required_by→ AttentionMetadataGeneration`
- `AttentionMetadataGeneration --controls→ KVReadWriteIdentity`

## 本輪結束判斷
- **缺哪一層**：PyTorch/CUDA actual stream identity + event/dependency runtime trace。
- **哪個節點最淺**：`DeviceMetadataDependencyWitness`。
- **哪個概念仍只是名詞**：production `CUDAReplayMetadataGeneration`。
- **哪個系統值得讀原始碼**：vLLM `CpuGpuBuffer → gpu_model_runner → BlockTable → CUDA Graph manager → backend metadata builder`。
- **哪篇/份資料需追引用**：CUDA stream/event ordering；vLLM #53982 後續 fix PR/commit。
- **哪個概念最適合視覺模擬**：CUDA Metadata Publication & Slot-Mapping Race Microscope。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + CUDA Stream Dependency Verifier + Metadata Generation Tracker + Slot-Mapping Structural Verifier + CUDA-Graph Replay Provenance Verifier + KV Read/Write Joiner + Causal Evidence Gate + Tool Executor`。

## 本輪核心推進
Hermes 現在不只知道「CPU block table有一代、GPU block table有一代」，而開始追 **這一代 metadata 是透過哪條 CUDA stream/dependency真正發布給consumer**；同時把 correctness 從 temporal generation擴充到 structural addressability。這使知識圖譜能區分「copy還沒對consumer可見」、「mapping generation錯」、「index超出該group row contract」以及「雖然沒有GPU fault但其實讀到錯誤mapped data」四種不同 failure。