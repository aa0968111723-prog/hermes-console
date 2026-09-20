# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-20 08:51（Asia/Taipei）

## 本小時新發現

本輪延續 07:56 的 `VLLMDedicatedExecutionStream → StreamIdentityCalibrationWitness`，不再重複 CUDA Graph / BlockTable 基礎，而是向下閉合「Python `torch.cuda.Stream` 到 CUPTI `streamId`」這個 identity gap。

**已確認事實 / 官方與原始碼：**
1. PyTorch `torch.cuda.Stream` 是 CUDA stream wrapper；current `torch/cuda/streams.py` 明確暴露 `self.cuda_stream`，`__cuda_stream__()` 回傳 `(0, self.cuda_stream)`，文件將它描述為 `cudaStream_t`/`hipStream_t` handle 的 Python integer representation。`ExternalStream` 也可由外部 `stream_ptr` 建立 wrapper。
2. vLLM current `current_stream()` 在 CUDA 上建立 dedicated `torch.cuda.Stream()`，先 `new_stream.wait_stream(torch.cuda.current_stream())`，再設為 current stream；source comment 明確指出 CUDA Graph capture/replay 使用同一 dedicated stream per process。
3. CUPTI 13.4 `CUpti_ActivityStream` 提供 `contextId + streamId + priority + correlationId`，其中 `streamId` 是 CUPTI 的 unique stream ID；`CUpti_ActivityGraphTrace` 又提供 graph launch 的 `contextId + streamId + graphId + correlationId + start/end`。
4. 因此 **Python/CUDA handle 與 CUPTI streamId 是不同 identity namespace**。不能假設 `torch.cuda.Stream.cuda_stream == CUPTI streamId`。正確做法是 runtime calibration / observation binding。
5. PyTorch stream ordering仍是 happens-before 的基礎：同 stream operations serialized；不同 streams 若無 wait/event/synchronization，不可假定 relative order。

**新論文：** 2026 `The Serialized Bridge: Understanding and Recovering LLM Serving Performance under Blackwell GPU Confidential Computing` 顯示 confidential VM↔GPU bridge 可破壞 serving runtime 對 async/concurrent host-device movement 的效能假設；這提醒 Hermes 的 provenance model 必須把 execution environment / transfer mode 也當成節點，而不能只依一般 CUDA stream 語義推測效能或 overlap。

## 本小時最重要 5 個發現

### 1. Python Stream Handle ≠ CUPTI Stream ID
**概念：** PyTorch `Stream.cuda_stream` 是底層 CUDA stream handle 的 Python integer 表示；CUPTI `streamId` 是 profiler/runtime activity namespace 裡的 unique ID。

**底層：**
`torch.cuda.Stream object → cuda_stream property → cudaStream_t handle → CUDA API launch → CUPTI API/activity correlation → CUPTI contextId/streamId`

**重要性：** 先前 `DedicatedStreamRuntimeInvariant` 不能用數值相等證明。Hermes 必須建立 `StreamIdentityCalibrationWitness`。

**限制：** CUPTI public activity record本身不保證直接輸出 raw `cudaStream_t`；需要透過 launch API callback/activity correlation、stream creation activity、NVTX/external correlation或受控 calibration operation做 binding。

來源：PyTorch `torch/cuda/streams.py`; NVIDIA CUPTI 13.4 `CUpti_ActivityStream`, `CUpti_ActivityGraphTrace`。

### 2. PyTorch 已提供足夠的 raw-handle observation point
`Stream.__cuda_stream__()` 與 `.cuda_stream` 使 Hermes 可以在 instrumentation point記錄：

```text
PythonStreamWitness {
  semantic_epoch
  process_id
  thread_id
  device
  python_object_id
  cuda_stream_handle
  observed_at_ns
}
```

這比只記 `repr(stream)` 或 object identity 強，因為可以跨 Python wrapper 層追到底層 handle。

### 3. CUPTI stream identity必須與 context 一起保存
CUPTI records同時暴露 `contextId` 與 `streamId`。Hermes Knowledge Graph應使用 `(deviceId, contextId, streamId)` 作 profiler-side stream key，而不是只保存 `streamId`。

```text
CUPTIStreamKey = deviceId : contextId : streamId
```

這可避免多 context / 多 worker / 多 GPU 時 identity collision 或錯綁。

### 4. 最小 calibration 不需要修改 attention kernel
可以在 dedicated stream 上插入低風險 calibration marker / controlled CUDA operation，記錄 raw handle 與 semantic calibration token，再從 CUPTI API/activity correlation取得對應 `contextId/streamId`。之後 graph replay的 `GraphTrace.streamId` 即可與已校準 dedicated stream比較。

```text
raw cudaStream_t H17
→ calibration op C501
→ CUPTI correlationId C501
→ CUPTI (ctx=3, stream=17)
→ StreamCalibration(H17 ↔ ctx3:S17)
```

注意：這是**設計方案/合理推論**，尚未在目標 vLLM process 實測。

### 5. Execution environment 是新的 provenance dimension
Blackwell GPU Confidential Computing研究顯示，host/device bridge 在 confidential mode 下可能呈現序列化與高 setup cost，async transfer甚至可能在 runtime boundary失去一般預期的行為。這不是說 CUDA ordering semantics失效，而是說 performance/overlap假設不能只從 API 名稱推導。

Hermes 應新增：
`ExecutionEnvironment → TransferConcurrencyCapability → ObservedOverlapWitness`。

## Architecture Breakdown

### System architecture：Stream Identity Calibration Layer

```text
Hermes SemanticEpoch
  ↓
vLLM worker / launch thread
  ↓
vLLM current_stream()
  ↓
torch.cuda.Stream
  ├─ python object identity
  ├─ device
  └─ cuda_stream raw handle
  ↓
Calibration Operation
  ↓
CUDA Runtime/Driver API
  ↓ correlationId
CUPTI Activity
  ├─ deviceId
  ├─ contextId
  └─ streamId
  ↓
StreamIdentityCalibrationWitness
  ↓
CUPTI GraphTrace.streamId
  ↓
GraphReplayEpoch
  ↓
GraphNode / Attention
```

### Evidence grades

```text
PYTHON_STREAM_ONLY
RAW_CUDA_HANDLE_OBSERVED
CUPTI_STREAM_ONLY
CALIBRATION_CORRELATED
GRAPH_REPLAY_STREAM_MATCHED
DEDICATED_STREAM_RUNTIME_VERIFIED
STREAM_INVARIANT_VIOLATION
```

只有 `GRAPH_REPLAY_STREAM_MATCHED` 以上才能把 source invariant提升成 runtime evidence。

## Bottom-Level Logic

### PyTorch Stream wrapper

current PyTorch source：

```text
Stream object
→ _CudaStreamBase
→ .cuda_stream
→ __cuda_stream__() = (0, cuda_stream)
```

`wait_stream(other)` 底層語義則是：

```text
other.record_event()
→ this.wait_event(event)
→ future work on this stream waits for event
```

因此 Stream identity與 ordering witness可分開：

```text
StreamIdentityWitness
≠ StreamOrderingWitness
```

知道兩個 operation在哪條 stream，不自動證明跨 stream happens-before。

### CUPTI side

```text
CUDA Stream Creation / Use
→ CUpti_ActivityStream
  contextId
  streamId
  priority
  correlationId

Graph Launch
→ CUpti_ActivityGraphTrace
  correlationId
  graphId
  contextId
  streamId
  start/end
```

新的 verifier predicate：

```text
DEDICATED_STREAM_RUNTIME_VERIFIED(D, R)
=
CALIBRATED(raw_handle(D), cupti_context_stream)
∧ GRAPH_TRACE(R).contextId == calibrated.contextId
∧ GRAPH_TRACE(R).streamId == calibrated.streamId
```

若不相等：

```text
STREAM_INVARIANT_VIOLATION
```

而不是偷偷改用 graph trace stream 當作 dedicated stream。

## Visual Simulation Idea

### Python Handle ↔ CUPTI Stream Calibration Microscope

互動式三欄：

```text
PYTHON / vLLM
Dedicated Stream D1
object id: 0xPY...
cuda_stream: 0x7f...A0
        │
        │ calibration token C501
        ▼
CUDA API
operation C501
correlationId 8841
        │
        ▼
CUPTI
contextId 3
streamId 17
        │
        ▼
Graph Replay R93
G12 / streamId 17
        │
        ▼
MATCH ✓
DEDICATED_STREAM_RUNTIME_VERIFIED
```

互動功能：切換 request/epoch、hover raw handle / CUPTI ID、顯示 calibration edge、stream mismatch紅色警告、多 worker/rank filter、capture vs replay stream比較、happens-before overlay。

## Code / GitHub

### vLLM
- `vllm/utils/torch_utils.py`
  - `current_stream()`
  - `_current_stream_tls`
  - patched stream-setting path
  - dedicated stream bootstrap
- 下一輪：定位所有 `current_stream()` consumers、CUDA Graph manager/replay callsites，確認 worker/rank/thread scope。

### PyTorch
- `torch/cuda/streams.py`
  - `Stream.cuda_stream`
  - `Stream.__cuda_stream__()`
  - `ExternalStream`
  - `wait_stream()` / `record_event()` / `wait_event()`
- 下一輪：
  - `c10/cuda/CUDAStream.h/.cpp`
  - `aten/src/ATen/cuda/CUDAGraph.cpp`
  - 追 `CUDAGraph::replay()` 到 `cudaGraphLaunch/cuGraphLaunch`，確認 current stream handle如何傳入。

### NVIDIA CUPTI
- `CUpti_ActivityStream`
- `CUpti_ActivityGraphTrace/GraphTrace2`
- Runtime/Driver API activity
- External correlation
- CUDA Event / Synchronization activities

## Papers

### The Serialized Bridge: Understanding and Recovering LLM Serving Performance under Blackwell GPU Confidential Computing
- Authors: Hang Yin, Kevin Wang
- Year: 2026
- URL: https://arxiv.org/abs/2606.23969
- Code: 本輪未確認官方 code
- Dataset: 以 RTX Pro 6000、B300 HGX 上的 serving / microbenchmark experiments為主，非傳統 dataset
- Architecture: confidential VM + GPU-CC + LLM serving runtime + host/device bridge
- Contribution: 將 13–27% serving throughput loss定位到 confidential VM-GPU bridge，並分析 KV restore / alloc-copy / concurrency behavior。
- Limitations: hardware/environment specific；不能直接外推到一般 non-confidential CUDA deployment。
- 改變了什麼：提醒 provenance/visual simulator必須區分「semantic correctness ordering」與「實際 transfer concurrency/performance」。

### Frontier: Towards Comprehensive and Accurate LLM Inference Simulation
- Authors: Yicheng Feng, Xin Tan, Yangtao Deng, Yimin Jiang, Yibo Zhu, Hong Xu
- Year: 2026
- URL: https://arxiv.org/abs/2605.21312
- Code: 本輪未確認
- Dataset: serving traces / H800 testbed scenarios
- Architecture: discrete-event simulator，包含 P/D disaggregation、Attention-FFN disaggregation、CUDA Graph、speculative decoding、stateful workloads
- Contribution: 把 scheduler-batch-engine loop與 modern runtime optimization納入 simulation；16-H800 testbed報告平均 throughput error <4%。
- Limitations: simulation fidelity仍取決於 calibration/model assumptions，不能替代 runtime provenance trace。
- 改變了什麼：支持 Hermes 將「可視化模擬模型」拆成 runtime-calibrated discrete-event layer，而不是只有概念動畫。

## Unknown / Open Questions 1-3

1. PyTorch/CUDA/CUPTI 最低侵入的 raw `cudaStream_t → CUPTI contextId/streamId` calibration primitive應選哪個：marker、event、memset、tiny kernel，還是 API callback？需實測 overhead與 graph capture safety。
2. vLLM multi-worker / tensor-parallel環境中，每 process dedicated stream是否始終一對一，是否存在 thread切換、secondary stream或 backend-specific override？
3. `GraphTrace.streamId` 在所有 vLLM CUDA Graph modes（full / piecewise / mixed）是否都對應同一 dedicated execution stream？需 runtime trace，不可只由 source comment推論。

## 下一輪研究

```text
vLLM dedicated Stream
→ torch Stream.cuda_stream
→ c10::cuda::CUDAStream
→ cudaStream_t
→ CUDAGraph::replay
→ cudaGraphLaunch(..., stream)
→ CUPTI API correlation
→ CUpti_ActivityGraphTrace.streamId/contextId
→ calibration binder
→ DedicatedStreamRuntimeInvariant
→ sampled graphNodeId
→ Attention node
→ RuntimeContentEpochBound
```

下一輪優先追 PyTorch C++ source，找出 `cudaStream_t` 在 `CUDAGraph::replay()` 中的 exact data path；同時設計最小 CUPTI calibration probe schema，避免再停留在抽象節點。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `RawCUDAStreamHandleWitness`
- `CUDAStreamProtocolWitness`
- `CUPTIStreamKey`
- `CUPTIStreamCreationWitness`
- `StreamCalibrationOperation`
- `StreamIdentityCalibrationWitness`
- `GraphReplayStreamMatchWitness`
- `DedicatedStreamRuntimeVerifiedState`
- `StreamInvariantViolationState`
- `ExecutionEnvironmentIdentity`
- `TransferConcurrencyCapability`
- `ObservedTransferOverlapWitness`
- `RuntimeCalibratedSimulationNode`

### Edges

```text
VLLMDedicatedExecutionStream
--wrapped_by→ TorchCUDAStream

TorchCUDAStream
--exposes→ RawCUDAStreamHandleWitness

RawCUDAStreamHandleWitness
--calibrated_by→ StreamCalibrationOperation

StreamCalibrationOperation
--correlates_with→ CUPTIStreamKey

CUPTIStreamKey
--matched_against→ GraphTraceStreamIdentity

GraphTraceStreamIdentity
--verifies→ DedicatedStreamRuntimeInvariant

ExecutionEnvironmentIdentity
--constrains→ TransferConcurrencyCapability

TransferConcurrencyCapability
--validated_by→ ObservedTransferOverlapWitness
```

## 本輪結束判定

- **缺哪一層：** raw `cudaStream_t` 到 CUPTI `(contextId, streamId)` 的真實 runtime calibration，以及其與 graph replay activity 的實測 binding。
- **哪個節點最淺：** `StreamIdentityCalibrationWitness` 的 production instance。
- **哪個概念仍只是名詞：** `DedicatedStreamRuntimeInvariant` 尚未由目標 vLLM GPU trace實證；`AgentActionCausalBound` 更下游仍未閉合。
- **哪個系統值得讀原始碼：** PyTorch `c10/cuda/CUDAStream.*` + `ATen/cuda/CUDAGraph.cpp`，其次 vLLM cudagraph manager。
- **哪篇論文需追引用：** `The Serialized Bridge`，特別是 confidential transfer serialization / async boundary；`Frontier` 用於 runtime-calibrated simulator設計。
- **哪個概念最適合視覺模擬：** `Python Stream Handle ↔ CUPTI Stream Calibration Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Causal Evidence Gate + Tool Executor`；其中本輪優先實作 Verifier 的 Stream Calibration layer。

## 目前整體鏈

```text
使用者輸入
→ UI
→ Agent Runtime
→ Context / Memory / Planning
→ Multimodal Tokens
→ Transformer / Attention
→ Logical KV
→ Physical KV
→ Scheduler ContentEpoch
→ H2D / Ordering
→ vLLM DedicatedExecutionStream
→ torch.cuda.Stream
→ raw cudaStream_t
→ [StreamIdentityCalibration]
→ CUPTI contextId:streamId
→ CUDA Graph Replay
→ graphId / graphNodeId
→ Attention Kernel
→ Exact KV Read
→ Causal Intervention
→ ΔResidual / ΔLogit
→ Generated Token
→ Tool / Agent Action
```

本輪把上一輪的「vLLM 預期使用 dedicated stream」向下推到一個可執行的校準問題：**PyTorch 已直接暴露 raw CUDA stream handle，而 CUPTI 提供 profiler-side context/stream identity；下一步不是再猜 stream，而是用受控 correlation 把兩個 identity namespace 實測綁在一起。**