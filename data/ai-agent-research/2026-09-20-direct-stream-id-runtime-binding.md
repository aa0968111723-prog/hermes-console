# 【AI Agent × Multimodal Research Report】

**時間：2026-09-20 09:50（Asia/Taipei）**  
**主題：Raw cudaStream_t → Direct CUPTI Stream ID → Graph Replay Runtime Binding**

## 本小時新發現

本輪延續上一輪 `Python torch.cuda.Stream → raw cudaStream_t → CUPTI streamId` 缺口，但找到一個更直接、也更強的閉合方法：**不必先製造一個 calibration kernel/memcpy 再靠 correlationId 猜 stream mapping。CUPTI 本身提供 `cuptiGetStreamIdEx(context, stream, perThreadStream)`，可直接從 CUDA stream handle 取得 context-unique CUPTI stream ID。** CUDA Runtime 13.4 另有 `cudaStreamGetId(cudaStream_t)`，回傳 program-lifetime unique stream ID；這是另一套 ID namespace，不能在未驗證前與 CUPTI `streamId` 當成同一數字。

官方來源：
- CUPTI Python binding `get_stream_id_ex`: https://docs.nvidia.com/cupti-python/api-reference/topics/bindings.html
- CUDA Runtime `cudaStreamGetId`: https://docs.nvidia.com/cuda/cuda-runtime-api/cuda_runtime_api/group__CUDART__STREAM.html
- CUPTI GraphTrace2: https://docs.nvidia.com/cupti/13.4.0/api/structCUpti__ActivityGraphTrace2.html
- CUPTI ActivityStream: https://docs.nvidia.com/cupti/13.4.0/api/structCUpti__ActivityStream.html

這使上一輪的：

`raw cudaStream_t → calibration operation → correlationId → CUPTI streamId`

可升級為：

`torch.cuda.Stream → raw cudaStream_t → cuptiGetStreamIdEx → CUPTI(contextId, streamId) → GraphTrace2(contextId, streamId) → exact GraphReplayWitness`

原本 correlation-based calibration 仍保留為 cross-check，而不再是唯一 bridge。

## 本小時最重要 5 個發現

### 1. Direct Stream Identity Bridge
**已確認官方事實。** CUPTI current Python binding公開 `get_stream_id_ex(context, stream, per_thread_stream)`，輸入 raw stream handle，直接回傳 context-unique stream ID。這正好把 PyTorch 暴露的 raw `cudaStream_t` 接到 CUPTI activity namespace。

底層：`Python Stream → cuda_stream integer → CUstream/cudaStream_t → cuptiGetStreamIdEx → uint32 streamId`。

重要性：Hermes 可以在 graph replay 前取得 expected CUPTI stream identity，再和 GraphTrace2 的 observed `contextId + streamId` 比對。

限制：`streamId` 是 context-scoped；多 context / MIG / green context / multi-process 必須保留 `process + device + context + stream` 複合 identity。

### 2. CUDA Runtime Stream ID 與 CUPTI Stream ID 必須分 namespace
**已確認官方資訊 + 工程推論。** CUDA 13.4 `cudaStreamGetId` 的 ID 在 program lifetime 唯一；CUPTI `get_stream_id_ex` 則明確稱 context-unique。兩者契約不同，因此 Knowledge Graph 不得建立未驗證的 `CUDAStreamRuntimeId == CUPTIStreamId`。

新增規則：
`RawHandleIdentity ≠ CUDAStreamRuntimeId ≠ CUPTIStreamKey`，除非有 explicit mapping witness。

### 3. PyTorch replay 的真正 launch stream 已在 C++ source 閉合
**已確認原始碼。** current PyTorch `CUDAGraph::replay()` 使用 `cudaGraphLaunch(graph_exec_, at::cuda::getCurrentCUDAStream())`，且 source 明寫 graph exec 可在任意 stream replay。這表示 replay identity 的關鍵 observation point 是 **replay 呼叫當下的 current CUDA stream**，不是 capture stream。

核心檔案：`pytorch/pytorch/aten/src/ATen/cuda/CUDAGraph.cpp`。

### 4. vLLM dedicated stream invariant 現在可直接驗證
**已確認原始碼 + 可驗證設計。** current vLLM `vllm/utils/torch_utils.py::current_stream()` 在 CUDA 建立 dedicated stream，並註明 CUDA Graph capture/replay 使用同一 stream。新的 verifier 不必只相信註解：

`vLLM current_stream().cuda_stream → cuptiGetStreamIdEx → expected CUPTIStreamKey`

然後：

`GraphTrace2.contextId:streamId → observed CUPTIStreamKey`

若相等：`DEDICATED_STREAM_RUNTIME_VERIFIED`；若不同：`STREAM_INVARIANT_VIOLATION`。

### 5. GraphTrace2 是低成本 production verifier 的正確第一層
**已確認官方資訊。** `CUpti_ActivityGraphTrace2` 專門表示 graph execution 而不展開每個 node，提供 `correlationId/start/end/deviceId/graphId/contextId/streamId`。因此 production 模式可以只做 graph-level stream/provenance verification；只有抽樣深度驗證才開 per-node tracing。

這比永遠追 graphNodeId 更符合低 overhead runtime observability。

## Architecture Breakdown

```text
Hermes SemanticEpoch
  ↓
vLLM Scheduler / Worker Handoff
  ↓
Launch Thread
  ↓
vLLM Dedicated torch.cuda.Stream
  ↓
Python .cuda_stream
  ↓
raw cudaStream_t
  ├─→ cudaStreamGetId() ─→ CUDA Runtime Stream ID
  └─→ cuptiGetStreamIdEx() ─→ CUPTI Stream ID
                                  ↓
PyTorch CUDAGraph::replay()
  ↓
cudaGraphLaunch(graph_exec, getCurrentCUDAStream())
  ↓
CUPTI GraphTrace2
(deviceId, contextId, streamId, graphId, correlationId)
  ↓
Expected-vs-Observed Stream Binder
  ↓
GraphReplayRuntimeBound
  ↓ [sampled deep trace]
graphNodeId → Attention Kernel → Runtime KV Read
```

## Bottom-Level Logic

新的 identity key：

```text
ExecutionStreamKey = {
  process_id,
  device_id,
  context_id,
  cupti_stream_id
}
```

驗證 predicate：

```text
STREAM_BOUND(R) =
  expected = cuptiGetStreamIdEx(raw_cuda_stream)
  AND observed = GraphTrace2.contextId:streamId
  AND expected.contextId == observed.contextId
  AND expected.streamId == observed.streamId
```

狀態機：

```text
RAW_HANDLE_ONLY
→ DIRECT_CUPTI_ID_RESOLVED
→ GRAPH_REPLAY_OBSERVED
→ STREAM_RUNTIME_BOUND
→ DEDICATED_STREAM_RUNTIME_VERIFIED
```

失敗狀態：

```text
CONTEXT_ID_MISMATCH
STREAM_ID_MISMATCH
PER_THREAD_STREAM_MODE_AMBIGUOUS
STREAM_INVARIANT_VIOLATION
GRAPH_REPLAY_UNOBSERVED
```

## Visual Simulation Idea

### Stream Identity Binder Microscope

三欄互動視圖：

```text
PYTORCH / vLLM          DIRECT ID BRIDGE             CUPTI GPU TRACE
Stream D1               raw handle 0x...             Graph G12 / Replay R94
.cuda_stream ─────────→ cuptiGetStreamIdEx ───────→ context=3 stream=17
                        ↓
                        expected (3,17)
                                                     observed (3,17)
                                                           ↓
                                                     VERIFIED
```

若 observed 變成 `(3,22)`，UI 立即顯示 `STREAM_INVARIANT_VIOLATION`。另提供 `CUDA Runtime ID` 與 `CUPTI ID` 雙欄，避免把不同 namespace 的整數誤認成同一 identity。

## Code / GitHub

值得繼續讀：
1. `pytorch/pytorch/aten/src/ATen/cuda/CUDAGraph.cpp`：`CUDAGraph::replay()` 已確認直接把 current CUDA stream 傳入 `cudaGraphLaunch`。
2. `pytorch/pytorch/c10/cuda/CUDAStream.*`：下一輪追 raw handle、context/device identity 與 per-thread/default stream semantics。
3. `vllm-project/vllm/vllm/utils/torch_utils.py`：dedicated current stream TLS。
4. vLLM CUDA graph manager / wrapper：追 `entry.cudagraph.replay()` 呼叫點與 worker/rank boundary。
5. NVIDIA CUPTI samples：實作 `cuptiGetStreamIdEx + GRAPH_TRACE` 最小 collector。

## Papers / Technical Sources

本輪核心突破主要來自官方 runtime/API 與原始碼，而非新論文；這是刻意的，因為上一輪缺口是 identity closure，不是新 architecture survey。

補充工程風險：2026 年 ExecuTorch multi-session CUDA Graph issue指出 mutable session state rebinding 與固定 graph pointer/state 可能產生錯誤 session/KV binding，支持 Hermes 將 `StreamRuntimeBound` 與 `ContentEpochBound` 分成兩個獨立證據軸；stream 正確不代表 dynamic state 正確。
來源：https://github.com/pytorch/executorch/issues/20310

## Unknown / Open Questions

1. `cuptiGetStreamIdEx` 在 vLLM production process 中對 per-thread stream flag 的正確設定，以及 default/per-thread special stream 的 edge cases。
2. vLLM multi-rank / tensor-parallel worker 是否每 process 都穩定維持單一 dedicated execution stream，還是某些 backend / offloader / piecewise graph path 會切換 stream。
3. `StreamRuntimeBound + ContentEpochBound` 之後，如何最低成本地把 sampled `graphNodeId` 穩定分類為 attention/KV consumer，而不依賴脆弱 kernel name heuristic。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `CUDAStreamRuntimeId`
- `DirectCUPTIStreamIdWitness`
- `CUPTIStreamKey`
- `GraphReplayObservedStreamKey`
- `GraphReplayRuntimeBound`
- `StreamNamespaceSeparationRule`
- `PerThreadStreamModeWitness`
- `ContextScopedStreamIdentity`
- `DedicatedStreamRuntimeVerifiedState`

新增 Edges：
- `RawCUDAStreamHandle --resolved_by→ cuptiGetStreamIdEx`
- `cuptiGetStreamIdEx --produces→ CUPTIStreamKey`
- `GraphTrace2 --observes→ GraphReplayObservedStreamKey`
- `CUPTIStreamKey --matches→ GraphReplayObservedStreamKey`
- `match --proves→ GraphReplayRuntimeBound`
- `GraphReplayRuntimeBound --supports→ DedicatedStreamRuntimeVerifiedState`
- `CUDAStreamRuntimeId --not_assumed_equal_to→ CUPTIStreamId`
- `StreamRuntimeBound --does_not_prove→ ContentEpochBound`

## 與歷史研究比較

上一輪最淺節點是 `StreamIdentityCalibrationWitness`，設計仍依賴「做一個 operation → 用 correlationId 找到 CUPTI stream」。本輪找到 CUPTI 官方 direct lookup，因此把 calibration 從 **行為式間接推斷** 升級成 **handle→profiler-ID 直接解析**。Correlation-based calibration仍有價值，但降級成 independent cross-check。

同時保留前幾輪的重要區分：capture stream ≠ replay stream（一般 CUDA 語義）；vLLM source 預期 capture/replay dedicated same stream；source invariant ≠ runtime proof；stream identity ≠ content epoch identity。

## 下一輪研究

```text
cuptiGetStreamIdEx minimal probe
→ process/device/context key
→ vLLM dedicated raw stream handle
→ PyTorch CUDAGraph::replay
→ cudaGraphLaunch
→ CUPTI GraphTrace2
→ direct expected/observed stream match
→ ExternalCorrelation SemanticEpoch binding
→ ContentEpochBound join
→ sampled per-node trace
→ Attention node classifier
→ RuntimeKVReadWitness
→ sham / zero / replace KV intervention
→ ΔAttention → ΔResidual → ΔLogit → ΔAgentAction
```

## 本輪結束判定

- **缺哪一層：** 真實 vLLM process 中 direct `cuptiGetStreamIdEx(raw handle)` 與 GraphTrace2 observed stream 的實測 join。
- **哪個節點最淺：** `DirectCUPTIStreamIdWitness` 的 production instance。
- **哪個概念仍只是名詞：** `RuntimeKVReadWitness`、`AgentActionCausalBound`。
- **哪個系統值得讀原始碼：** PyTorch `c10/cuda/CUDAStream.*` + vLLM CUDA graph manager。
- **哪篇論文/工作需追引用：** CUDA Graph mutable-state / multi-session serving work；特別追 session-aware graph state 與 stable-address constraints。
- **哪個概念最適合視覺模擬：** Python raw handle ↔ CUPTI context/stream ↔ GraphReplay 三方 identity binder。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Causal Evidence Gate + Tool Executor`。

本輪把「Python stream 到 profiler stream」從需要間接校準的猜測，推進成可由 CUPTI 官方 API直接解析的 identity bridge。下一個真正關卡不再是『這是哪條 stream？』，而是把已驗證的 replay stream 與 SemanticEpoch、ContentEpoch、attention node 三條 identity chain 合流。