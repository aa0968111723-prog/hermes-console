# 【AI Agent × Multimodal Research Report】

**時間：2026-09-24 16:56（Asia/Taipei）**

**本輪主題：CollectiveOperationWitness → CUDA Stream/Event Dependency → Completion Visibility → Consumer Kernel → ResidualStateWitness**

## 與歷史研究比較

上一輪已建立 DistributedExecutionTopologyGeneration、CollectiveCommunicatorGeneration、CollectiveOrdinalBindingWitness、DistributedResidualGeneration，回答「哪些 ranks / communicator / collective ordinal 參與運算」。本輪不重複 NCCL topology，而追下一個更底層缺口：collective 已正確 enqueue，不代表下游 kernel 已安全看到完成後的 tensor。

核心命題：

`CorrectCollectiveEnqueue --does_not_prove→ CorrectConsumerVisibility`

`SameBufferAddress --does_not_prove→ SameTensorGeneration`

`CollectiveCompleteOnStreamA + ConsumerOnStreamB --requires→ ExplicitDependency(A→B)`

---

## 本小時新發現

### 1. CUDA stream 是 execution-order domain，不是全 GPU 自動排序

**已確認事實 / 官方資訊：** CUDA Programming Guide 說明，同一 stream 中操作依 enqueue 順序執行；不同 streams 可並行，沒有依賴時不能假設順序。`cudaStreamWaitEvent()` 會讓指定 stream 後續工作等待 event 完成；event 因此可表達跨 stream happens-before edge。

因此需要：

`StreamGeneration = H(deviceGeneration, processGeneration, streamHandleGeneration, flags, priority, captureState)`

`CUDAEventGeneration = H(deviceGeneration, eventHandleGeneration, recordStreamGeneration, recordOrdinal)`

`StreamDependencyEdge = ProducerOp → EventRecord → StreamWaitEvent → ConsumerOp`

### 2. NCCL API return 只代表 collective 已 enqueue，不代表 GPU collective 已完成

**已確認事實 / 官方資訊：** NCCL 2.32.3 examples 明確指出 collective call 後 operation 已 enqueue 到 stream；若要等待完成，可以 `cudaStreamSynchronize(stream)`。因此 host-side API return 不能作為 tensor completion witness。

新增：

`CollectiveEnqueueWitness != CollectiveCompletionWitness`

`CollectiveCompletionWitness = H(collectiveOperationGeneration, producerStreamGeneration, completionEventGeneration, completionStatus)`

### 3. PyTorch async distributed communication 會把 communication kernel enqueue 到獨立 CUDA stream

**已確認事實 / 官方資訊：** PyTorch distributed 文件說 async communication 回傳 Work object，communication kernel 可 enqueue 在 separate CUDA stream 以重疊 communication/computation；跨 process group / CUDA stream 使用結果前需要適當 wait/synchronization。`Work.block_current_stream()` 可使目前 GPU stream 等待 operation 完成。

這代表 Agent/LLM inference runtime 的 provenance 必須追：

`FrameworkWorkHandleGeneration → BackendCollectiveGeneration → CommunicationStreamGeneration → CompletionDependency → ConsumerComputeStreamGeneration`

而不是只追 Python function call。

### 4. CUDA Graph capture 會把跨 stream event dependency編譯進 graph DAG

**已確認事實 / 官方資訊：** CUDA Graph stream capture支援 `cudaEventRecord()` + `cudaStreamWaitEvent()` 跨 stream dependency，但 participating streams 必須 join 回 origin stream；否則 capture失敗。NCCL collective也可被 graph capture，而且 NCCL要求 graph-captured property在 participating ranks一致。

所以 CUDA Graph 不是「把 kernel list cache 起來」，而是：

`GraphGeneration = Nodes + DependencyEdges + Stream/Capture Semantics`

Hermes新增：

`CUDAGraphDependencyWitness = H(graphGeneration, producerNode, eventNode, waitNode, consumerNode, edgeType)`

### 5. vLLM current source已存在顯式 stream dependency，證明這不是理論問題

**工程實作：** vLLM `parallel_state.py` 在 CUDA graph capture 前會取 current stream；若 capture stream不同，就呼叫 `stream.wait_stream(curr_stream)`，原始碼註解明確表示要確保 initialization operations 完成後才在另一 stream capture graph。其 all-reduce/all-gather/reduce-scatter再委派給 device communicator。

這形成實際架構：

`Initialization/current stream → wait_stream → graph capture stream → distributed op → consumer kernels`

若 dependency漏掉，logical collective / weights / ranks都可能正確，但 graph capture或consumer仍可能跨 generation讀取。

---

## 本小時最重要 5 個發現

### 發現 1 — Completion 是 provenance object，不是 boolean

底層：enqueue、execution、completion、visibility是不同事件。應記錄 producer operation、stream、event、wait edge、consumer operation。

限制：event證明 ordering/completion，不直接證明數值正確。

### 發現 2 — Tensor identity 必須包含 generation，而非 pointer

GPU allocator會重用地址；同一 pointer在不同時間可代表不同 tensor generation。因此：

`TensorGenerationIdentity = H(allocationGeneration, storageRange, dtype, shape, producerOperationGeneration, semanticRole)`

限制：完整 hash GPU tensor代價高，實作需 metadata witness + sampling/hash策略。

### 發現 3 — Cross-stream happens-before 是 distributed residual correctness 的必要條件

`CollectiveOperation → completion event → consumer wait → RMSNorm/next layer`

若 collective在 communication stream、下一層在 compute stream，沒有正確 edge就不能從「collective已發出」推論「consumer看到完成資料」。

### 發現 4 — CUDA Graph provenance 必須包含 dependency DAG generation

相同 graph executable handle不應被當成永恆 identity；capture source、node params、event dependencies、communicator generation、model generation改變都應產生新 generation。

### 發現 5 — Performance overlap與semantic ordering應分離

communication/computation overlap是性能策略；semantic dependency是 correctness constraint。Hermes不應用全域 synchronize解決所有問題，因為會摧毀 overlap；應建立最小 happens-before DAG。

---

## Architecture Breakdown

```text
DistributedResidualInput
  ↓
CollectiveOperationGeneration
  ↓ enqueue
CommunicationStreamGeneration
  ↓
NCCL / custom collective kernels
  ↓
CUDAEventRecord / Work completion
  ↓
CollectiveCompletionWitness
  ↓ wait edge
ConsumerComputeStreamGeneration
  ↓
RMSNorm / Attention / MLP / Residual consumer kernel
  ↓
ConsumerKernelInputBindingWitness
  ↓
NextResidualStateGeneration
```

CUDA Graph path：

```text
Origin Stream
 → producer nodes
 → event record
 → fork stream wait
 → NCCL/compute nodes
 → event record
 → origin stream wait
 → consumer node
 → GraphExecGeneration
```

---

## Bottom-Level Logic

### Same-stream

`op[n] → op[n+1]` 由 in-order stream semantics建立 happens-before。

### Cross-stream

```text
producer(Stream A)
→ cudaEventRecord(E, A)
→ cudaStreamWaitEvent(B, E)
→ consumer(Stream B)
```

### PyTorch async collective

```text
collective(async_op=True)
→ WorkGeneration
→ NCCL communication stream
→ work.wait()/block_current_stream()
→ consumer stream dependency
→ safe tensor consumption
```

### Proposed witness

`TensorVisibilityWitness = H(tensorGeneration, producerOperationGeneration, producerStreamGeneration, completionPrimitiveGeneration, dependencyEdges, consumerStreamGeneration, consumerKernelGeneration)`

`ResidualConsumptionWitness = H(layerGeneration, inputTensorGeneration, TensorVisibilityWitness, consumerKernelInvocationWitness, outputResidualGeneration)`

---

## Visual Simulation Idea — GPU Stream & Tensor Visibility Microscope

互動欄位：

`Time | Compute Stream | Comm Stream | CUDA Events | NCCL | Tensor Buffer | Graph Nodes | Consumer Kernel | Residual Generation`

使用者點擊 residual tensor可反查：

`Residual L17 → consumer GEMM → waited Event E91 → NCCL AllReduce #381 → ranks 0..7 → producer partial tensors`

故障注入：

- `MISSING_STREAM_WAIT`
- `EVENT_RECORDED_BEFORE_COLLECTIVE`
- `CONSUMER_USES_POINTER_FROM_PREVIOUS_GENERATION`
- `WORK_HANDLE_DROPPED_WITHOUT_DEPENDENCY`
- `GRAPH_CAPTURE_MISSING_CROSS_STREAM_JOIN`
- `COMM_STREAM_CHANGED_AFTER_GRAPH_CAPTURE`
- `BUFFER_REUSED_BEFORE_CONSUMER_COMPLETES`
- `ASYNC_FREE_BEFORE_LAST_ACCESS`

---

## Code / GitHub

### vLLM

值得繼續讀：

- `vllm/distributed/parallel_state.py` — group coordinator、all_reduce/all_gather/reduce_scatter、graph capture stream synchronization。
- 下一輪：device communicator / custom all-reduce / NCCL wrapper，追 collective實際使用的 CUDA stream與 completion semantics。

本輪直接確認 `parallel_state.py` graph capture路徑存在：

`curr_stream = torch.cuda.current_stream()`

若不同：

`stream.wait_stream(curr_stream)`

其目的就是在另一 stream capture前等待初始化工作。

---

## Papers / Technical Sources

### CUDA Programming Guide — Asynchronous Execution / Streams / Events
- Institution: NVIDIA
- Year: current documentation, accessed 2026-09-24
- Architecture: stream-ordered asynchronous execution + events
- Contribution: 定義 same-stream ordering、cross-stream event synchronization、event completion semantics
- Limitation: API semantics，不證明 higher-level framework正確使用依賴。

### CUDA Programming Guide — CUDA Graphs
- Institution: NVIDIA
- Year: current documentation, accessed 2026-09-24
- Architecture: captured operation DAG
- Contribution: 定義 cross-stream capture dependency與 event edge如何成為 graph dependency
- Limitation: graph dependency正確仍不代表 model semantic binding正確。

### NCCL 2.32.3 Documentation
- Institution: NVIDIA
- Year: 2026/current
- Architecture: stream-associated GPU collectives
- Contribution: collective API return = enqueued；completion需 CUDA synchronization/event semantics
- Limitation: communicator/collective正確不涵蓋上層 tensor semantic identity。

### PyTorch Distributed Documentation
- Institution: PyTorch Foundation / Meta ecosystem
- Year: current documentation, accessed 2026-09-24
- Architecture: ProcessGroup + async Work + NCCL streams
- Contribution: async communication與 compute overlap，以及 Work/stream synchronization接口
- Limitation: framework API不自動形成跨所有自訂 streams的 semantic provenance。

---

## 已確認 / 推論 / 假說分界

**已確認事實：** CUDA same-stream ordering；event/wait可建立跨 stream dependency；NCCL call可只完成 enqueue；PyTorch async communication可使用 separate CUDA stream；vLLM graph capture前存在 explicit `wait_stream`。

**工程推論：** LLM distributed inference若遺漏 dependency edge，可能讓 consumer在 producer/collective完成前使用 buffer；因此 pointer/collective ID不足以證明 residual generation。

**Hermes architecture proposal：** `TensorVisibilityWitness`、`ResidualConsumptionWitness`、`StreamGeneration`、`CUDAGraphDependencyWitness`。

**尚未驗證假說：** 是否能以低於約 1% inference overhead，在 production vLLM中捕捉足夠的 stream/event/collective metadata，建立逐 layer visibility witness。

---

## Unknown / Open Questions

1. vLLM不同 communicator backend（NCCL/custom AR/DeepEP/NIXL/FlashInfer）是否都能暴露一致的 producer-stream / completion primitive metadata？
2. CUDA Graph replay時，如何以低 overhead把 GraphExecGeneration與每次 request/model generation綁定，而不逐 node tracing？
3. GPU allocator / async free / buffer reuse如何納入 TensorGenerationIdentity，避免 ABA pointer reuse？

---

## Knowledge Graph 新增 Node

- CUDAStreamGeneration
- CUDAEventGeneration
- StreamDependencyEdge
- CollectiveEnqueueWitness
- CollectiveCompletionWitness
- FrameworkWorkHandleGeneration
- TensorGenerationIdentity
- TensorVisibilityWitness
- CUDAGraphGeneration
- CUDAGraphDependencyWitness
- ConsumerKernelGeneration
- ConsumerKernelInputBindingWitness
- ResidualConsumptionWitness
- AsyncAllocationGeneration
- BufferReuseGeneration

## Knowledge Graph 新增 Edge

- `CollectiveOperationGeneration --enqueued_on→ CUDAStreamGeneration`
- `CollectiveOperationGeneration --completed_by→ CollectiveCompletionWitness`
- `CUDAEventGeneration --establishes→ StreamDependencyEdge`
- `StreamDependencyEdge --orders_before→ ConsumerKernelGeneration`
- `TensorGenerationIdentity --visible_to→ ConsumerKernelGeneration`
- `CUDAGraphDependencyWitness --preserves→ StreamDependencyEdge`
- `ConsumerKernelGeneration --produces→ NextResidualStateGeneration`
- `SameBufferAddress --does_not_prove→ SameTensorGeneration`
- `CollectiveEnqueueWitness --does_not_prove→ CollectiveCompletionWitness`

---

## 本輪結束診斷

- **缺哪一層：** Tensor visibility之後仍缺 final RMSNorm → LM head/logits 的逐 kernel state lineage與 allocator/buffer lifetime完整綁定。
- **哪個節點最淺：** `BufferReuseGeneration / AsyncAllocationGeneration`。
- **哪個概念仍只是名詞：** production-grade、低 overhead `TensorVisibilityWitness`。
- **哪個系統值得讀原始碼：** vLLM device communicator + custom all-reduce + CUDA graph runner；再對照 PyTorch ProcessGroupNCCL。
- **哪篇論文需追引用：** distributed deterministic inference研究，下一輪連到 kernel scheduling / allocator / graph replay。
- **哪個概念最適合視覺模擬：** GPU Stream & Tensor Visibility Microscope。
- **哪個 Agent 架構最值得實作：** `Event-sourced Agent Runtime + ModelInvocationWitness + DistributedExecutionWitness + TensorVisibilityWitness + ResidualStateLineage + Runtime Attestation`。

## 下一輪研究

鎖定：

`TensorVisibilityWitness → CUDA allocator/storage lifetime → pointer reuse/ABA → CUDA Graph replay parameter binding → kernel input/output generation → Final RMSNorm → LM Head → RawLogitsGeneration`

核心問題：

> 即使 stream/event dependency全部正確，Hermes如何證明 consumer kernel所持有的 pointer/storage仍然代表「這一次 request / layer / model generation」的 tensor，而不是 allocator reuse、async free、graph replay stale pointer或 buffer aliasing造成的另一代資料？
