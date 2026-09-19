# 【AI Agent × Multimodal Research Report】

**時間：2026-09-20 01:50（Asia/Taipei）**  
**本輪主題：BlockTable GPU Visibility × CUDA Stream Ordering × Graph Consumption Boundary**

## 本小時新發現

本輪接續上一輪 `BlockTableContentEpoch → H2D → GPU visibility → CUDA Graph replay`，不再重複 static-buffer / content-epoch 定義，而是追查「non-blocking H2D 到底何時能被 attention consumer 合法看見」。核心修正：**H2D API return、DMA completion、GPU-visible-for-a-specific-consumer 是三個不同證據層級。**

已確認的 vLLM source path：

```text
SchedulerOutput
→ CPU block_table.np mutation
→ commit_block_table(num_reqs)
→ CpuGpuBuffer.copy_to_gpu()
→ gpu.copy_(..., non_blocking=True)
→ device block_table.gpu
→ compute_slot_mapping(... block_table.gpu ...)
→ attention metadata / graph input
→ attention kernel
```

vLLM current source 明確把 `commit_block_table()` 放在 input preparation 很早的位置，註解說目的就是讓 copy 與後續 CPU operations overlap；`BlockTable.commit_block_table()` 只呼叫 `self.block_table.copy_to_gpu(num_reqs)`；`CpuGpuBuffer.copy_to_gpu()` 最終使用 `gpu.copy_(..., non_blocking=True)`。

## 本小時最重要 5 個發現

### 1. `non_blocking=True` 不代表資料已經 GPU-visible

**已確認事實 / 工程實作。** `copy_to_gpu()` 是非同步提交。CPU thread 可以繼續，但不能因此建立 `GPUVisibilityWitness`。

必須拆成：

```text
CPUContentEpoch
→ H2DSubmitWitness
→ H2DActivityWitness
→ H2DCompletionWitness
→ ConsumerOrderingWitness
→ GPUVisibleForConsumerWitness
```

「GPU visible」應定義成**相對某個 consumer operation 的 happens-before 關係**，而不是一個沒有 consumer 的全域布林值。

### 2. CUDA in-order stream 可以把 completion fence 隱含在 stream ordering 裡

**官方 CUDA 語義。** 同一 CUDA stream 的 operations 依 enqueue order 執行。因此若 H2D copy 與後續 attention/graph replay 位於同一 stream，且沒有特殊 relaxed dependency，則：

```text
H2D enqueue
→ H2D execute/complete
→ later consumer execute
```

可以由 stream order 建立 consumer-safe visibility，而不一定需要 host `synchronize()`。

但如果 producer copy 與 consumer 在不同 streams，則不能只靠時間接近推論；需要 event、stream-wait-event、graph dependency 或其他 CUDA-defined synchronization edge。

### 3. `GPUVisibilityWitness` 應升級成 `ConsumerScopedVisibilityWitness`

上一輪節點過度粗糙。本輪改成：

```text
ConsumerScopedVisibilityWitness {
  content_epoch,
  destination_buffer,
  producer_stream,
  h2d_correlation_id,
  h2d_end_ns,
  consumer_kind,
  consumer_stream,
  graph_id?,
  graph_node_id?,
  dependency_type,
  happens_before_proven
}
```

這能區分：

- SAME_STREAM_ORDER
- CUDA_EVENT_EDGE
- GRAPH_DEPENDENCY
- EXPLICIT_SYNC
- ORDER_UNPROVEN

### 4. CUPTI 已足以提供 H2D 與 graph-node runtime evidence，但 semantic binding 仍需 Hermes 自己做

**官方資訊。** CUPTI memory-copy activity提供 transfer direction、bytes、start/end timestamps、stream/context/device IDs、correlation ID；CUDA Graph node activities提供 `graphId`、`graphNodeId`。CUDA 13.4 還提供 `sourceGraphId/sourceGraphNodeId` 追 node lineage。

因此 runtime closure 可設計為：

```text
Hermes ContentEpoch E204
→ CUDA memcpy API correlationId M449
→ CUPTI Memcpy Activity(stream S, end=t1)
→ graph replay correlationId R89
→ graphId G12
→ graphNodeId N57
→ Attention Kernel Activity(stream S2, start=t2)
→ dependency proof
→ ConsumerScopedVisibilityWitness
```

但 CUPTI 不知道 `E204` 是「哪一批 request 的 block table」；Hermes 必須在 CPU semantic layer 維護 `ContentEpoch ↔ correlation/graph execution` mapping。

### 5. CUDA Graph 讓「地址穩定」與「內容新鮮度」徹底分離

**已確認架構結論。** Graph replay 可以反覆消費固定 device addresses，但每輪之前動態 input buffer 的內容可能不同。因此 provenance 必須是：

```text
StaticBufferIdentity
+ ContentEpoch
+ Visibility/Ordering Proof
+ GraphReplayEpoch
+ GraphNodeExecution
```

而不是：

```text
data_ptr → request identity
```

CoRun（2026）提供額外交叉證據：fixed-shape decode + CUDA graphs 可用於 deterministic inference，但 batch-dependent GPU execution / reduction order本身會造成 nondeterminism；因此 Hermes 未來做 causal intervention 時仍須固定 batch geometry / execution path。

## Architecture Breakdown

```text
[Scheduler]
request IDs / logical KV leases
        ↓
[CPU Dynamic State]
BlockTableContentEpoch E_n
        ↓
commit_block_table
        ↓
[CpuGpuBuffer]
gpu.copy_(cpu, non_blocking=True)
        ↓
[CUDA Runtime]
H2D submitted on producer stream
        ↓
[CUPTI Memcpy Activity]
correlationId + stream + start/end
        ↓
[Ordering Boundary]
 same stream / event / graph dependency / explicit sync
        ↓
[GPU Static Input Buffer]
StaticBufferIdentity + GPU-visible E_n
        ↓
[Slot Mapping / Attention Metadata]
logical token → physical slot
        ↓
[CUDA Graph Replay]
ReplayEpoch R_n
        ↓
[CUPTI Graph Node]
graphId + graphNodeId
        ↓
[Attention Kernel]
physical K/V read
```

### System reasoning vs model reasoning

這一層完全屬於 **system/runtime reasoning infrastructure**，不是模型內部 chain-of-thought。它決定模型計算看到的是哪個 block-table/KV state；若 runtime state epoch錯誤，模型即使 reasoning 正確，也是在錯誤 memory mapping 上運算。

## Bottom-Level Logic

### Block-table upload

vLLM：

```text
BlockTable.commit_block_table(num_reqs)
→ CpuGpuBuffer.copy_to_gpu(num_reqs)
→ gpu[:n].copy_(cpu[:n], non_blocking=True)
```

### Slot mapping consumer

```text
position p
→ logical block
→ block_table.gpu[row, logical_block]
→ physical block
→ in-block offset
→ physical KV slot
```

所以若 block table content epoch 尚未對 slot-mapping/attention consumer 可見，就可能形成：

```text
CPU E204
H2D E204 in flight
consumer sees E203
→ stale physical block
→ wrong KV read
```

Hermes 應將此錯誤命名為：

`STALE_DYNAMIC_INPUT_EPOCH`。

### CUDA ordering proof

```text
Case A: same stream
H2D(E204) → Kernel(N57)
=> stream order proves happens-before

Case B: cross stream + event
H2D(E204) → Event.record(S_copy)
Event.wait(S_compute) → Kernel(N57)
=> event edge proves happens-before

Case C: cross stream, no edge observed
H2D(E204) || Kernel(N57)
=> CONSUMER_ORDER_UNPROVEN
```

## Visual Simulation Idea

### Dynamic Input Visibility × Graph Consumer Simulator

Hermes Console 顯示三條 lane：

```text
CPU lane
E204 prepared ─ commit ───────────────────────────────

Copy stream
             H2D M449 ███████ done(t1)
                              │
                              ├─ event / ordering edge
                              ↓
Compute/Graph stream
                       Replay R89 ─ N57 Attention ███
```

點選 `E204` 時右側顯示：

- CPU content hash
- static GPU pointer
- H2D correlationId
- producer stream
- memcpy start/end
- replay epoch
- graphId / graphNodeId
- consumer stream
- dependency type
- resulting physical KV blocks

狀態標籤：

- `H2D_SUBMITTED`
- `H2D_COMPLETED`
- `SAME_STREAM_ORDERED`
- `EVENT_ORDERED`
- `GRAPH_DEPENDENCY_ORDERED`
- `CONSUMER_ORDER_UNPROVEN`
- `STALE_DYNAMIC_INPUT_EPOCH`
- `RUNTIME_CONTENT_EPOCH_BOUND`

## Code / GitHub

### vLLM 值得繼續看的核心檔案

1. `vllm/v1/worker/gpu_model_runner.py`
   - `_prepare_inputs`
   - `commit_block_table`
   - dynamic inputs / CUDA Graph replay boundary
2. `vllm/v1/worker/block_table.py`
   - `BlockTable.commit_block_table`
   - `compute_slot_mapping`
   - manager-block → kernel-block mapping
3. `vllm/v1/utils.py`
   - `CpuGpuBuffer.copy_to_gpu`
4. CUDA Graph wrapper / runner
   - capture/replay
   - static input address invariants
5. attention backend
   - block table argument
   - Triton/PagedAttention KV address computation

## Papers

### CoRun: Padding is Simple and Efficient for Deterministic LLM Inference
- Authors: Shiju Zhao et al.
- Year: 2026
- Architecture: isolated prefill + fixed-shape batched decode + CUDA Graphs
- Contribution: 用 scheduling/fixed-shape execution 避免 batch-dependent execution shape造成 nondeterminism，同時保留高效 kernels。
- Reported results: 相對 batch-invariant approaches，throughput +15–324%，平均 TTFT -51.8%、TPOT -48.6%。
- Limitation: 聚焦 deterministic inference/runtime scheduling，不直接提供 visual-token→KV causal provenance。

### Frontier: Towards Comprehensive and Accurate LLM Inference Simulation
- Authors: Yicheng Feng et al.
- Year: 2026
- Architecture: discrete-event simulator for disaggregated LLM serving，納入 CUDA Graph、speculative decoding、scheduler-batch-engine loop。
- Contribution: 證明 runtime optimization、communication、memory 與 scheduling 必須在同一 simulation model 裡，對 Hermes 的可視化 runtime simulator 很有參考價值。
- Reported result: 16-H800 testbed 平均 throughput error <4%。

## Unknown / Open Questions

1. vLLM `commit_block_table()` 的 H2D 實際在哪個 CUDA stream enqueue？該 stream 與 slot-mapping / CUDA Graph replay consumer 的 stream 是否總是相同，或某些 backend/configuration 會分流？
2. CUDA Graph replay 前是否存在可直接觀測、穩定的 dependency edge，能把某個 `BlockTableContentEpoch` 唯一綁到該 replay？
3. 若使用 piecewise CUDA Graph / torch.compile / multi-stream backend，dynamic-input copy ordering 是否會改變？

## Knowledge Graph 新增 Node / Edge

### Nodes

- `H2DSubmitWitness`
- `H2DActivityWitness`
- `H2DCompletionWitness`
- `ProducerStreamIdentity`
- `ConsumerStreamIdentity`
- `CUDAStreamOrderEdge`
- `CUDAEventDependencyEdge`
- `GraphDependencyEdge`
- `ConsumerScopedVisibilityWitness`
- `StaleDynamicInputEpochState`
- `RuntimeContentEpochBound`

### Edges

```text
BlockTableContentEpoch
→ H2DSubmitWitness
→ H2DActivityWitness
→ H2DCompletionWitness

H2DCompletionWitness
→ CUDAStreamOrderEdge / CUDAEventDependencyEdge / GraphDependencyEdge
→ ConsumerScopedVisibilityWitness

ConsumerScopedVisibilityWitness
→ GraphReplayEpoch
→ GraphNodeExecutionWitness
→ RuntimeKVReadWitness
```

## 與歷史研究比較

上一輪最淺節點是 `BlockTableGPUVisibilityWitness`。本輪發現該節點本身定義不夠精確：visibility 不是全域瞬間狀態，而應對**具體 consumer**建立 happens-before proof。因此將瓶頸從「copy 完成了嗎？」推進到「哪一條 CUDA dependency 證明 E_n 在 graph-node N 執行前已可見？」。

已避免重複上一輪的 static pointer/content epoch、CUPTI graph identity與 exact Triton KV read address；本輪新增的是 **memory consistency / ordering semantics**。

## 下一輪研究

```text
PyTorch gpu.copy_(non_blocking=True)
→ ATen CUDA copy implementation
→ current CUDA stream selection
→ cudaMemcpyAsync / copy kernel
→ CUPTI Memcpy Activity
→ producer stream ID
→ CUDA Graph replay stream ID
→ same-stream / event dependency proof
→ exact GraphNodeExecution
→ RuntimeContentEpochBound
```

閉合後再進入 causal harness：

```text
RuntimeContentEpochBound
→ Sham KV intervention
→ Zero / Replace target KV
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔGenerated Token
→ ΔAgent Action
```

## 本輪結論

- **缺哪一層：** PyTorch/ATen non-blocking copy 的實際 CUDA stream → vLLM graph replay consumer stream 的 runtime dependency closure。
- **哪個節點最淺：** `ConsumerScopedVisibilityWitness` 的實測版本。
- **哪個概念仍只是名詞：** `RuntimeContentEpochBound`；source/official semantics 已足夠，但尚缺同一實際 inference run 的 CUPTI trace。
- **哪個系統值得讀原始碼：** PyTorch ATen CUDA copy path + vLLM CUDA Graph runner。
- **哪篇論文需追引用：** CoRun；特別追 deterministic serving、fixed-shape decode、CUDA Graph 與 batch geometry 對 numerical reproducibility 的後續工作。
- **哪個概念最適合視覺模擬：** Dynamic Input Visibility × Graph Consumer Simulator。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance + PreAction Verifier + Causal Evidence Gate`。

最終鏈目前推進到：

```text
UI
→ Pixel
→ Vision Patch
→ Visual Token
→ LLM Sequence Slot
→ Logical KV
→ KV Lease
→ Physical KV
→ BlockTable ContentEpoch
→ H2D Submit/Complete
→ Consumer-scoped Visibility
→ CUDA Graph Replay
→ Attention Graph Node
→ Exact KV Read
→ [Causal Intervention]
→ Logit
→ Agent Action
```

本輪的核心不是「H2D 很快」，而是建立一條可驗證規則：**只有當某個 dynamic-input content epoch 對某個具體 GPU consumer 存在 CUDA-defined happens-before edge，Hermes 才能宣稱該 consumer 看見的是那一代資料。**