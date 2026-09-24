# 【AI Agent × Multimodal Research Report】

時間：2026-09-24 17:54 TST

## 本小時新發現

本輪接續 `2026-09-24-cuda-stream-event-collective-visibility-lineage.md`，不重複 stream/event synchronization，而深入其下一層：**allocator/storage lifetime、pointer reuse/ABA、CUDA Graph static address binding、graph dispatch key 與 tensor generation identity**。

核心結論：

`Correct TensorVisibilityWitness --does_not_prove→ Correct StorageGeneration`

以及：

`SamePointerValue --does_not_prove→ SameTensorGeneration`

GPU pointer 是 location，不是 semantic identity。Caching allocator、stream-ordered allocator與 CUDA Graph replay 都會讓同一 virtual address 在時間上承載不同 semantic tensor；反過來，CUDA Graph 又刻意要求某些地址跨 replay 穩定。因此 Hermes 必須同時追蹤 address identity 與 allocation/storage generation。

## 本小時最重要 5 個發現

### 1. PyTorch caching allocator 的安全單位不是 Python tensor lifetime，而是 stream-aware block lifetime

**已確認／官方資訊。** PyTorch CUDA semantics 說明 caching allocator可在不做 device synchronization 下快速釋放；不同 stream可並行，因此 side-stream使用 tensor時必須用 `record_stream()` 或自行建立 synchronization。更關鍵的是，即使新 operation不讀舊內容，也可能需要 wait，因為 allocator可能把「已 deallocated 但舊 GPU work仍在使用」的 block重新配置給新 tensor。

底層：

`Tensor A logical death → allocator block pending uses → event/stream completion → block reusable → Tensor B allocation → same virtual address possible`

因此 `ptr(A)==ptr(B)` 不能證明 A/B 是同一 tensor。

來源：PyTorch CUDA semantics；`torch.Tensor.record_stream`。

### 2. `record_stream()` 本質上把 storage reuse safety 連到 consumer stream completion

**已確認／官方資訊。** `record_stream(stream)`告知 caching allocator：該 tensor被另一 stream使用；allocator在重用 block前要等待該 stream當時排隊的 work完成。若不使用 record_stream，runtime作者必須自己把 side-stream使用同步回 creation stream後才允許 deallocation/reuse。

因此新增：

`StorageUseGeneration → StreamUseWitness → ReuseEligibilityGeneration`

而不是只記 `Tensor → pointer`。

限制：record_stream保障 lifetime safety，不證明 tensor semantic role、request identity或 graph replay binding正確。

### 3. cudaMallocAsync / stream-ordered allocator 明確允許 freed memory reuse，reuse policy本身是 execution semantics

**已確認／NVIDIA官方。** CUDA stream-ordered allocator會優先重用先前由 `cudaFreeAsync()`釋放的 memory；同 stream可直接形成 stream ordering，跨 stream reuse則可依 event dependency、opportunistic reuse或 internal dependency policy決定。

所以 allocator config也必須 generation 化：

`AllocatorPolicyGeneration = H(backend, memPool, reuseFollowEventDependencies, reuseAllowOpportunistic, reuseAllowInternalDependencies)`

同一 model/runtime在 allocator policy改變後，即使所有 kernel code相同，physical storage reuse graph仍可能不同。

### 4. CUDA Graph replay故意固定 pointer；因此「地址穩定」反而可能掩蓋 semantic generation錯綁

**已確認／PyTorch + NVIDIA官方。** CUDA Graph記錄 kernels及arguments；PyTorch文件明確指出 replay預設使用 capture時相同 virtual addresses，所以 input buffers通常是在固定地址填入新資料後 replay。若 graph使用的 memory被 free，replay可能 illegal access；若該地址被重新分配給其他 tensor，replay可能污染其他 tensor。因此 PyTorch使用 graph-private memory pool讓 graph所需地址跨 replay保持有效。

NVIDIA Graph API允許部分 node params用 `cudaGraphExecKernelNodeSetParams()`等 API更新，但這是顯式 mutation，不能把 graph理解為每次自動重新解析 tensor object。

因此新增：

`GraphPointerBindingWitness = H(graphExecGeneration, nodeGeneration, argOrdinal, virtualAddress, storageGeneration, semanticTensorGeneration)`

核心 invariant：

`CapturedPointerAddress == ReplayPointerAddress`

不足以推出：

`CapturedTensorGeneration == ReplaySemanticTensorGeneration`

### 5. vLLM CUDA Graph dispatcher證明 graph identity不只 batch size，也綁 runtime mode與 LoRA state

**工程實作／原始碼。** vLLM current `vllm/v1/cudagraph_dispatcher.py`把 valid graph keys視為 runtime dispatch唯一 source of truth；dispatch key包含 token數、request數、uniform decode狀態，以及 LoRA是否存在/active LoRA count。它還會把 batch size padding到 capture size，FULL/PIECEWISE/NONE分開選擇。

因此 graph provenance不能只寫：`graph_for_batch_32`。

應寫：

`CUDAGraphDispatchWitness = H(graphGeneration, mode, BatchDescriptor, paddedTokenCount, requestCount, uniformDecode, activeLoRAGenerationSet, modelWeightStateGeneration)`

這直接連回前面研究的 `EffectiveModelWeightStateWitness`：adapter hot swap若沒有反映到 graph generation/dispatch compatibility，就可能形成「graph地址與kernel都合法，但 semantic model generation錯誤」的狀態。

## Architecture Breakdown

### GPU Tensor Storage / CUDA Graph execution architecture

`LogicalTensorGeneration`
→ `StorageRequest(size, dtype, device)`
→ `AllocatorBackend(native | cudaMallocAsync | custom)`
→ `MemoryPoolGeneration`
→ `AllocationBlockGeneration`
→ `VirtualAddressRange`
→ `TensorViewGeneration(offset/stride/shape)`
→ `Producer Kernel`
→ `StreamUseWitness[]`
→ `Logical Tensor Death`
→ `Deferred Reuse Eligibility`
→ `Allocator Reuse Decision`
→ `New AllocationGeneration`

CUDA Graph path：

`Warmup Tensor Generations`
→ `Graph Capture`
→ `Kernel Node + pointer args`
→ `GraphExecGeneration`
→ `Graph-private Pool / stable addresses`
→ `Runtime Dispatch Key`
→ `copy/fill new semantic input into static buffer`
→ `Graph Replay`
→ `Kernel consumes static pointer`
→ `Output buffer generation interpreted as current request`

因此真正需要證明的是：

`RequestGeneration → RuntimeTensorGeneration → StaticGraphBufferGeneration → GraphNodeArgumentBinding → KernelOutputGeneration`

而不是只有 pointer equality。

## Bottom-Level Logic

### Pointer ABA 問題

假設：

`t0: Tensor A → ptr 0x1000, AllocationGeneration #81`
`t1: A Python ref dropped`
`t2: GPU side-stream仍使用 A`
`t3: allocator若錯誤判定 reusable`
`t4: Tensor B → ptr 0x1000, AllocationGeneration #82`
`t5: old kernel writes ptr 0x1000`

pointer在 t0/t4相同，但 semantic owner已改變。這就是 GPU storage lineage中的 ABA-style identity problem。

正確 identity至少是：

`StorageIdentity = (deviceGeneration, allocatorGeneration, poolGeneration, allocationGeneration, addressRange)`

Tensor則是：

`TensorGenerationIdentity = H(StorageIdentity, offset, shape, stride, dtype, producerGeneration, semanticRole, requestGeneration)`

### CUDA Graph stale semantic binding

Graph capture：

`Node K arg0 → address 0x2000`

Replay N：

`Request N input → copy into storageGeneration G41 at 0x2000 → replay`

Replay N+1必須證明：

`Request N+1 input → same static buffer generation contract → overwrite complete → replay begins after overwrite → node arg0 still intended for this semantic slot`

若 address仍是0x2000但 storage已被錯誤交給另一用途，graph本身可能完全不知道。

因此：

`PointerStability --does_not_prove→ SemanticBindingStability`

## Visual Simulation Idea

### GPU Memory Lifetime & CUDA Graph Replay Microscope

時間軸 + address-space雙視圖：

`Request | Tensor Generation | Stream | Alloc Block | Pointer | Graph Node | Replay # | Semantic Role`

點擊 `0x7f...2000` 可看到：

`Allocation #81 → Tensor A → stream S1 → free requested → event pending → reusable → Allocation #82 → Tensor B`

CUDA Graph模式則顯示：

`GraphExec G7 → Node K19 → arg0 0x2000 → Static Input Slot I3 → Replay 981 → Request R554`

故障注入：

- `MISSING_RECORD_STREAM`
- `ALLOCATOR_REUSES_BLOCK_BEFORE_SIDE_STREAM_COMPLETES`
- `POINTER_ABA_SAME_ADDRESS_NEW_GENERATION`
- `GRAPH_PRIVATE_POOL_RELEASED_EARLY`
- `GRAPH_REPLAY_STATIC_INPUT_NOT_OVERWRITTEN`
- `GRAPH_DISPATCH_WRONG_BATCH_DESCRIPTOR`
- `LORA_GENERATION_CHANGED_WITH_STALE_GRAPH`
- `NODE_PARAM_UPDATED_WITH_WRONG_STORAGE_GENERATION`
- `VIEW_OFFSET_ALIASES_ANOTHER_TENSOR`

## Code / GitHub

### vLLM

本輪深入：

- `vllm/v1/cudagraph_dispatcher.py`
  - `CudagraphDispatcher`
  - `_compute_bs_to_padded_graph_size`
  - `_get_lora_cases`
  - `initialize_cudagraph_keys`
  - `dispatch`

值得下一輪續讀：

- CUDA graph wrapper / capture implementation
- input/output buffer copy path
- model runner static input buffers
- PyTorch allocator interaction
- LoRA graph capture specialization

本輪不是只讀 README；已把 runtime dispatch key與前幾輪的 model/adapter generation lineage接起來。

## Papers / technical sources

本輪主題屬 runtime mechanism，主要證據來自 NVIDIA CUDA Programming Guide / Runtime API、PyTorch CUDA semantics與 vLLM source，而非單一論文。

應延伸追蹤：

1. CUDA Graphs相關系統研究：graph capture/replay如何降低 CPU launch overhead，同時引入 static memory/address constraints。
2. GPU memory allocator / asynchronous allocator研究：stream-aware lifetime、fragmentation、reuse與 correctness。
3. deterministic inference研究：allocator/layout/graph選擇是否間接改變 kernel selection或 reduction behavior。

## 與歷史研究比較

上一輪已證明：

`Collective completion → stream/event dependency → consumer visibility`

本輪新增的不是另一種 synchronization，而是：

`visibility edge正確之後，consumer所看到的 address究竟屬於哪一代 storage/tensor？`

因此 lineage從：

`CollectiveOperationWitness → TensorVisibilityWitness`

擴展為：

`CollectiveOperationWitness → TensorVisibilityWitness → StorageGenerationWitness → GraphPointerBindingWitness → ConsumerKernelInputBindingWitness`

避免重複上一輪。

## Unknown / Open Questions

1. 如何用低 overhead方式在 production為 allocator block建立 generation counter，而不對每次 tensor allocation做昂貴 hash/log？
2. CUDA Graph private pool與vLLM static buffers之間，哪一層最適合生成可攜的 `GraphPointerBindingWitness`？
3. dynamic shapes、piecewise graphs、LoRA hot swap與quantization hot reload同時存在時，graph invalidation contract應如何形式化？

## 下一輪研究

鎖定：

`GraphPointerBindingWitness → KernelLaunchGeneration → kernel specialization/compile cache → Triton/CUTLASS/Inductor code generation → dtype/accumulation mode → final RMSNorm → LM Head → RawLogitsGeneration`

核心問題：即使 pointer/storage/graph binding完全正確，runtime如何證明實際 launch的是「這一代 model/config 對應的正確 compiled kernel」？compile cache key、dynamic shape specialization、SM architecture、TF32/FP8 accumulation、Triton autotune或Inductor recompilation是否會讓相同 logical op產生不同 numerical semantics？

## Knowledge Graph 新增 Node / Edge

### Nodes

- `AllocatorBackendGeneration`
- `MemoryPoolGeneration`
- `AllocationBlockGeneration`
- `StorageGenerationIdentity`
- `TensorViewGeneration`
- `StreamUseWitness`
- `ReuseEligibilityGeneration`
- `AllocatorReuseDecisionGeneration`
- `PointerAddressIdentity`
- `PointerABAGeneration`
- `GraphPrivatePoolGeneration`
- `CUDAGraphExecGeneration`
- `GraphNodeGeneration`
- `GraphPointerBindingWitness`
- `StaticGraphInputSlotGeneration`
- `GraphReplayGeneration`
- `CUDAGraphDispatchWitness`
- `GraphNodeParameterUpdateGeneration`
- `ConsumerKernelInputBindingWitnessV2`

### Edges

- `LogicalTensorGeneration --allocated_as→ StorageGenerationIdentity`
- `StorageGenerationIdentity --located_at→ PointerAddressIdentity`
- `StreamUseWitness --delays→ ReuseEligibilityGeneration`
- `ReuseEligibilityGeneration --permits→ AllocatorReuseDecisionGeneration`
- `AllocationGeneration_A --same_address_does_not_imply_same_generation→ AllocationGeneration_B`
- `CUDAGraphExecGeneration --owns_or_depends_on→ GraphPrivatePoolGeneration`
- `GraphNodeGeneration --binds_pointer_via→ GraphPointerBindingWitness`
- `CUDAGraphDispatchWitness --selects→ CUDAGraphExecGeneration`
- `StaticGraphInputSlotGeneration --materializes_for→ GraphReplayGeneration`
- `GraphReplayGeneration --produces→ ConsumerKernelInputBindingWitnessV2`

## 本輪結束判斷

- **缺哪一層：** compiled kernel identity / kernel numerical semantics。
- **哪個節點最淺：** `GraphPointerBindingWitness`在 vLLM production runtime中的低 overhead實作。
- **哪個概念仍只是名詞：** portable `StorageGenerationIdentity`，目前CUDA/PyTorch沒有直接提供跨allocator統一 semantic generation ID。
- **哪個系統值得讀原始碼：** PyTorch `CUDACachingAllocator` + vLLM CUDA graph wrapper/model runner。
- **哪篇論文需追引用：** CUDA Graph / GPU allocator系統研究，並與前輪 deterministic inference論文交叉。
- **哪個概念最適合視覺模擬：** GPU Memory Lifetime & CUDA Graph Replay Microscope。
- **哪個 Agent 架構最值得實作：** `Event-sourced Agent Runtime + ModelInvocationWitness + StorageGenerationWitness + GraphPointerBindingWitness + KernelExecutionWitness + end-to-end TokenGenerationWitness`。

最終端到端圖目前推進到：

`User → UI → Agent → Context → Prompt Compiler → Tokens → Embedding/Weights → Transformer/MoE → Distributed Collective → CUDA Stream/Event → Storage/Allocator → CUDA Graph Pointer Binding → [Compiled Kernel gap] → Residual/Logits → Sampling → Decode/Stream → Observation → Tool/Effect → Context Re-entry`。
