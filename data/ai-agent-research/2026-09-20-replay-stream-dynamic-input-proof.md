# 【AI Agent × Multimodal Research Report】

時間：2026-09-20 06:56（Asia/Taipei）

主題：CUDA Graph Replay Stream × Dynamic Input Happens-Before × Runtime Provenance Verifier

## 本小時新發現

本輪承接上一輪 `ReplayExternalCorrelationWitness`，但不再只追「在哪個 CPU thread push external correlation」。新的核心缺口是：**CUDA Graph capture stream 與 replay stream 不是同一個 identity，且 graph replay 可以發生在任意 stream。** 因此 Hermes 若只保存 capture stream，無法證明某個 BlockTable/KV dynamic input epoch 在 replay consumer 前已可見。

已確認事實：

1. CUDA Runtime 的 `cudaGraphLaunch(graphExec, stream)` 明確以 launch 時傳入的 stream 執行 executable graph；每次 launch 會排在該 stream 先前工作以及同一 graphExec 的前次 launch之後。
2. PyTorch CUDA semantics 明確指出 captured graph 可以在任意 stream replay；而且 replay 時 CUDA 可能重新安排 graph 內獨立 operations 的 stream/enqueue order，只保留原 DAG dependency semantics。
3. vLLM current `CUDAGraphWrapper` capture 時顯式使用 `stream=current_stream()`，但 replay path 只呼叫 `get_offloader().sync_prev_onload(); entry.cudagraph.replay()`。vLLM wrapper 自己沒有保存一個「capture stream = replay stream」的不變式。
4. vLLM current source 特別在 replay 前呼叫 `sync_prev_onload()`，註解指出這是為了確保 pre-capture/eager offloader H2D dependencies 在 graph replay 前已完成；current `cudagraph_utils.py` 更指出 eager/piecewise → full graph transition 時，copy_stream 上的 H2D 可能無法被 graph captured events 看見，因此必須在 replay 前同步。
5. vLLM `CUDAGraphWrapper` 自己不負責把 runtime inputs copy 進 persistent buffers；它假定 dynamic input buffer management 在 wrapper 外完成。DEBUG mode只驗證 replay input `data_ptr()` 與 capture 相同，不驗證 buffer content epoch。

來源：
- NVIDIA CUDA Graphs Programming Guide: https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/cuda-graphs.html
- CUDA Runtime `cudaGraphLaunch`: https://docs.nvidia.com/cuda/cuda-runtime-api/group__CUDART__GRAPH.html
- PyTorch CUDA semantics / CUDA Graphs: https://docs.pytorch.org/docs/main/notes/cuda.html
- vLLM `vllm/compilation/cuda_graph.py`: https://github.com/vllm-project/vllm/blob/main/vllm/compilation/cuda_graph.py
- vLLM `vllm/v1/worker/gpu/cudagraph_utils.py`: https://github.com/vllm-project/vllm/blob/main/vllm/v1/worker/gpu/cudagraph_utils.py

## 本小時最重要 5 個發現

### 1. CaptureStreamIdentity ≠ ReplayStreamIdentity

概念：graph capture 建立 execution DAG，但真正 graph execution 被 enqueue 到哪條 stream，是 replay/launch 時決定。

底層：

`Capture Stream Sc → Graph Template → GraphExec G → cudaGraphLaunch(G, Replay Stream Sr)`

為什麼重要：Hermes 不能用 capture 時 stream identity 推論 runtime dynamic input ordering。

限制：PyTorch `CUDAGraph.replay()` 在 Python API 層沒有直接把 replay stream 當參數暴露出來；因此實測 verifier 必須在 replay call 前觀察 current stream，並用 CUPTI/driver activity交叉驗證。

### 2. Graph replay 的 stream DAG 是 dependency contract，不是固定 physical schedule

PyTorch 官方文件明確提醒：非平凡 multi-stream DAG 在 replay 時可被 CUDA 重新安排獨立 operations 到不同 streams 或不同 enqueue order，只需維持原始 DAG dependencies。

因此：

`CapturedInternalStreamId ≠ GuaranteedReplayPhysicalStreamId`

真正可依賴的是 dependency edge，而不是把 capture timeline 當 runtime timeline重播。

### 3. vLLM 已經暴露 dynamic-input / replay 邊界

current source：

`get_offloader().sync_prev_onload() → entry.cudagraph.replay()`

這不是一般性的 host sync 裝飾，而是 execution correctness boundary。vLLM current comment明確指出 copy_stream 的某些 H2D copies 在 eager/piecewise → full cudagraph transition 時可能不被 graph captured events看見，若沒有 sync，replay 可能在 copy 尚未完成時覆寫/消費 static buffers。

這提供 Hermes 第一個可以 instrument 的 replay gate。

### 4. Pointer equality 只證明 storage identity，不證明 semantic epoch

vLLM DEBUG replay 檢查：

`new_input_addresses == entry.input_addresses`

這只能證明 static buffer address 一致。真正 provenance 還需要：

`StaticBufferIdentity + BufferContentEpoch + ContentHash + H2DCompletion + ReplayEpoch`

才能回答「同一 pointer 這次承載哪個 scheduler/request/block-table state」。

### 5. Runtime Provenance Verifier 應由 replay gate 開始，而不是 attention kernel 開始

若先 instrument 每個 attention kernel，成本高且 semantic binding仍不完整。更穩健的順序是：

`SemanticEpoch → DynamicInputCommit → H2D → ReplayGate → ReplayStream → GraphExecution → sampled graphNode → Attention Kernel`

先證明 dynamic state進入正確 graph replay，再抽樣 node-level trace。

## Architecture Breakdown

### System architecture：vLLM CUDA Graph dynamic-input replay path

```text
SchedulerOutput
  ↓
Request / BlockTable / SlotMapping state
  ↓
CPU DynamicInput ContentEpoch
  ↓
Persistent/static GPU input buffer
  ↓
H2D / update operation
  ↓
Offloader / external copy dependencies
  ↓
sync_prev_onload()              ← Replay Gate
  ↓
torch.cuda.CUDAGraph.replay()
  ↓
cudaGraphLaunch(GraphExec, ReplayStream)
  ↓
Graph execution DAG
  ↓
Attention graph node
  ↓
block_table lookup
  ↓
physical KV address
  ↓
K/V load
  ↓
Attention output
```

### Evidence architecture

```text
SemanticEpochId
  ↓
DynamicInputContentEpoch
  ↓
H2DActivityWitness
  ↓
ReplayGateWitness
  ↓
ReplayCurrentStreamWitness
  ↓
GraphLaunchWitness
  ↓
GraphExecutionWitness
  ↓
GraphNodeExecutionWitness
  ↓
AttentionKernelWitness
  ↓
RuntimeKVReadWitness
```

## Bottom-Level Logic

### Replay-safe visibility predicate

舊版：

`GPU_VISIBLE(E)`

不足。

新版：

```text
CONSUMABLE_BY_REPLAY(E, R) =
  CONTENT_EPOCH_BOUND(E)
  ∧ PRODUCER_COMPLETE(E)
  ∧ REPLAY_GATE_PASSED(E,R)
  ∧ HAPPENS_BEFORE(E,R)
```

其中：

```text
HAPPENS_BEFORE(E,R) =
  SAME_LAUNCH_STREAM_ORDER
  OR CUDA_EVENT_EDGE
  OR GRAPH_DEPENDENCY
  OR EXPLICIT_SYNC
  OR VERIFIED_OFFLOADER_FENCE
```

### Graph launch ordering

CUDA Runtime 官方語義：

```text
prior work in ReplayStream
        ↓
cudaGraphLaunch(GraphExec, ReplayStream)
        ↓
Graph execution
```

同一 `GraphExec` 的 launches 也彼此有 ordering constraint；同一 executable graph不能同時執行多個 instance，若要 concurrent execution需 instantiate multiple executable graphs。

因此 Knowledge Graph 不能只有 `GraphId`，還要有：

`GraphExecIdentity → GraphReplayEpoch → ReplayStreamIdentity`。

## Visual Simulation Idea

### Dynamic Input → Replay Gate Microscope

三層同步 UI：

```text
SEMANTIC
Step 912 / Req A,B
BlockTable Epoch E206
        │
        ▼
DYNAMIC INPUT
CPU E206 → H2D M455 → Static GPU Buffer 0xABC
                         │
                         ▼
REPLAY GATE
sync_prev_onload() ── PASS
                         │
                         ▼
GPU EXECUTION
ReplayStream S3 → GraphExec G12 / Replay R91
                         │
                         ▼
                    Node N57
                         │
                         ▼
                 Attention K901
```

Evidence badges：
- `CAPTURE_STREAM_ONLY`：只有 capture stream，不能證明 replay stream。
- `REPLAY_STREAM_OBSERVED`：已取得 replay current stream。
- `REPLAY_GATE_VERIFIED`：dynamic producer completion已被 fence。
- `CONTENT_EPOCH_BOUND`：E206 已綁定 R91。
- `GRAPH_NODE_SAMPLED`：抽樣取得 N57。
- `RUNTIME_KV_READ_BOUND`：N57 與 exact KV read 已閉合。

互動：點選 Replay R91 後，UI 顯示「此 replay 消費哪一個 ContentEpoch、透過什麼 fence 成為可見、使用哪條 launch stream、最後落到哪個 attention node」。

## Code / GitHub

### vLLM

值得持續追：

1. `vllm/compilation/cuda_graph.py`
   - `CUDAGraphWrapper.__call__`
   - capture `stream=current_stream()`
   - replay `sync_prev_onload() → entry.cudagraph.replay()`
   - debug input address invariant

2. `vllm/v1/worker/gpu/cudagraph_utils.py`
   - eager/piecewise → full graph transition
   - copy_stream H2D dependency fence

3. 下一輪需追：
   - `get_offloader().sync_prev_onload()` implementation
   - actual event/synchronize primitive
   - current stream before/after replay
   - PyTorch `CUDAGraph::replay` → `cudaGraphLaunch`

### PyTorch

值得追：
- `aten/src/ATen/cuda/CUDAGraph.cpp`
- Python `torch.cuda.CUDAGraph.replay`
- current stream取得與 graph launch bridge

## Papers / technical references

本輪重點是 runtime source + official semantics，未用產品新聞替代底層證據。

值得延伸的研究方向：CUDA Graph deterministic replay、GPU execution trace、dynamic serving state、causal intervention reproducibility。上一輪的 causal literature仍有效，但本輪先完成 replay provenance boundary，不重複整理。

## Unknown / Open Questions

1. vLLM `sync_prev_onload()` 在不同 offloader backend究竟使用 event wait、stream wait、host sync還是 backend-specific fence？需要逐 backend讀 source。
2. PyTorch `CUDAGraph.replay()` 最終 `cudaGraphLaunch` 使用哪個 current stream bridge？需要直接追 `CUDAGraph.cpp` 並用 CUPTI驗證。
3. graph replay時 CUDA 可重排 internal stream scheduling；Hermes應把哪些 node-level dependency當 semantic invariant，哪些只當 observed runtime schedule？

## 下一輪研究

```text
vLLM sync_prev_onload()
→ offloader backend implementations
→ CUDA event / stream synchronization primitive
→ PyTorch CUDAGraph::replay
→ current stream
→ cudaGraphLaunch
→ CUPTI graph launch activity
→ replay streamId
→ SemanticEpoch binding
→ sampled graphNodeId
→ Attention node classifier
→ RuntimeContentEpochBound
```

若以上閉合，下一步才進入：

```text
Baseline
→ Sham KV writeback
→ Zero target KV
→ Replace target KV
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔGeneratedToken
→ ΔAgentAction
```

## Knowledge Graph 新增 Node / Edge

### Nodes

- `CaptureStreamIdentity`
- `ReplayStreamIdentity`
- `GraphExecIdentity`
- `GraphReplayEpoch`
- `ReplayGateWitness`
- `ReplayCurrentStreamWitness`
- `OffloaderFenceWitness`
- `DynamicInputConsumabilityWitness`
- `CaptureReplayStreamConflationState`
- `ReplayStreamUnobservedState`
- `GraphInternalScheduleObservation`
- `GraphDependencyInvariant`

### Edges

```text
CaptureStreamIdentity
  --captures→ GraphExecIdentity

GraphExecIdentity
  --replayed_as→ GraphReplayEpoch

GraphReplayEpoch
  --launched_on→ ReplayStreamIdentity

DynamicInputContentEpoch
  --producer_completed_before→ ReplayGateWitness

ReplayGateWitness
  --permits→ GraphReplayEpoch

GraphReplayEpoch
  --executes→ GraphNodeExecutionWitness

GraphNodeExecutionWitness
  --binds_to→ AttentionKernelWitness
```

Negative evidence edges：

```text
CaptureStreamIdentity
  --does_not_prove→ ReplayStreamIdentity

StaticBufferIdentity
  --does_not_prove→ BufferContentEpoch

GraphReplayWitness
  --does_not_prove→ GraphNodeExecutionWitness
```

## 本輪結束判定

缺哪一層：`vLLM replay gate → PyTorch current replay stream → cudaGraphLaunch → CUPTI observed streamId`。

哪個節點最淺：`ReplayCurrentStreamWitness` 的真實 runtime instance。

哪個概念仍只是名詞：`RuntimeKVReadWitness → AgentActionCausalBound` 尚未完成實測 causal intervention。

哪個系統值得讀原始碼：PyTorch `aten/src/ATen/cuda/CUDAGraph.cpp` 與 vLLM offloader `sync_prev_onload()` implementations。

哪篇論文需追引用：下一輪優先找 CUDA Graph / dynamic serving state / deterministic replay 的系統論文；因本輪官方 CUDA/PyTorch/vLLM source已比二手論文更直接回答 runtime semantics。

哪個概念最適合視覺模擬：`Dynamic Input → Replay Gate → Replay Stream → Graph Node` happens-before microscope。

哪個 Agent 架構最值得實作：`State-grounded Planner + Runtime Provenance Verifier + Causal Evidence Gate + Tool Executor`。

## 與歷史研究比較

上一輪已建立 `SemanticEpoch → worker/thread handoff → replay external correlation → graphId/nodeId`。本輪沒有重複 external-correlation stack，而是補上其後仍缺失的一個 runtime identity：**ReplayStream**。

新的修正是：

```text
上一輪：
SemanticEpoch → LaunchThread → Graph Replay

本輪：
SemanticEpoch
→ DynamicInput ContentEpoch
→ Producer Completion
→ Replay Gate
→ Replay Current Stream
→ cudaGraphLaunch
→ Graph Replay Epoch
→ Graph Node
```

因此 Hermes 現在不應問「capture 時 graph在哪條 stream」，而應問：**這一次 semantic epoch 的 dynamic data，透過哪一條可驗證 happens-before path，在哪一條 replay launch stream 上，被哪一次 GraphExec replay真正消費？**
