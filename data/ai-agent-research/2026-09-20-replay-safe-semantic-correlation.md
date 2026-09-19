# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-20 05:51（Asia/Taipei）

## 本小時新發現

本輪承接上一輪 `SemanticEpoch → CUPTI ExternalCorrelation → CUDA Graph`，不再重複 H2D/stream 基礎，改追「SemanticEpoch 到底應在哪個 CPU thread / graph replay 邊界注入，才不會把 capture-time marker 誤當 replay-time evidence」。

核心結論：CUPTI External Correlation 是 **per CPU thread、per correlation kind 的 stack**。因此 semantic ID 必須在真正發出 CUDA API 的同一 CPU thread 上 push，並在 API enqueue 後 pop；若 scheduler thread 建立 ID、worker thread 才呼叫 CUDA，單純在 scheduler thread push 不會自動跨 thread 傳播。這把上一輪的 `ExternalCorrelationPushWitness` 進一步細化為 `ThreadLocalSemanticCorrelationScope`。

第二個關鍵：vLLM 已有 layerwise NVTX hooks，會用 `torch.cuda.nvtx.range_push/range_pop` 包住 PyTorch module forward，並記錄 module、tensor shapes、kwargs/static params。但 CUDA Graph 下 Python/PyTorch hooks 可能只描述 capture-time Python forward；replay 時 graph 直接重播 GPU work，所以不能把既有 layerwise NVTX range 直接當成每次 replay 的 semantic identity。

第三個關鍵：CUPTI graph trace / per-node trace 提供兩種 evidence grade。graph-level trace 有 graph launch 的 `correlationId`, `graphId`, `streamId`, start/end；per-node trace再提供 kernel/memcpy/memset 的 `graphId + graphNodeId`。CUDA 13.4 還提供 source graph/node lineage。因此最小可行 runtime binder 應把 SemanticEpoch 綁在「每次 graph launch/replay API」而不是 graph capture。

第四個新方向：CUPTI 13.1+ 有 Graph Host Node activity，可觀察 graph host node 的 `correlationId + graphId + graphNodeId + process/thread + timestamps`。它可作為未來 replay-time CPU witness，但不應為了 tracing 任意插 host node 到 production graph，因為那會改變 execution graph 與 overhead；第一版 verifier 應保持 passive tracing。

第五個工程結論：Runtime Provenance Verifier 應採兩階段：Phase A 用 replay-scope ExternalCorrelation + graph-level trace 建立低成本 `SemanticEpoch → GraphReplay`；Phase B 在抽樣窗口開 per-node trace，閉合 `GraphReplay → Attention graphNode → Kernel`。不要全程高成本 node tracing。

## 本小時最重要 5 個發現

### 1. Thread-local external correlation 是 semantic binding 的硬邊界
**已確認事實（NVIDIA 官方）**：CUPTI 為每個 CPU thread、每個 `CUpti_ExternalCorrelationKind` 維護獨立 stack；CUDA API activity 在該 thread stack 非空時才產生 ExternalCorrelation record。

底層鏈：
`SemanticEpoch → worker/thread handoff → push externalId on launch thread → cudaGraphLaunch / CUDA API → CUPTI correlationId → pop externalId`。

重要性：Hermes 若只在 scheduler/orchestrator thread push semantic ID，而真正 CUDA API 在 model worker thread 發生，證據鏈可能完全斷裂。

限制：external correlation 不會替 Hermes 解讀 request/epoch；64-bit externalId 到 semantic metadata 的 mapping 必須由 Hermes 自己持久化。

### 2. NVTX module hook ≠ CUDA Graph replay witness
**工程實作（vLLM source）**：`vllm/utils/nvtx_pytorch_hooks.py` 的 `PytHooks` 在 module forward pre/post hooks 中 push/pop NVTX range，並可記錄 input/output tensor shapes 與 static params。

底層鏈：
`Python module forward → pre-hook → NVTX push → module execution → post-hook → NVTX pop`。

但 CUDA Graph replay 是：
`dynamic inputs updated → cudagraph.replay()/graph launch → previously captured GPU nodes execute`。

所以 capture-time NVTX layer range 不能直接證明 replay R89 執行的是 SemanticEpoch E204。這是本輪最重要的 anti-false-positive rule。

### 3. Replay-scope correlation 比 capture-scope correlation 更接近 ground truth
**已確認事實（NVIDIA 官方）**：graph trace record 有 graph launch correlationId、graphId、streamId 與 execution timestamps；per-node activities再用 graphId/graphNodeId識別 node。

建模：
`SemanticEpochId → ReplayScopeExternalId → GraphLaunchCorrelationId → graphId → graphNodeId → GPU kernel activity`。

限制：需要實際驗證 vLLM/PyTorch `cudagraph.replay()` 下 external correlation record 與 graph launch activity 的對應行為；目前是由 CUPTI contract 推導出的 instrumentation design，尚非本環境實測 trace。

### 4. Passive verifier 優先於 graph mutation
**官方資訊**：CUPTI 能觀察 Graph Host Node activity，含 graph/node identity、thread/process 與 timestamps。

**合理工程推論**：雖可考慮 host node 作 replay-time marker，但把 tracing host node 注入 production CUDA Graph 會改變 graph topology/overhead，因此第一版 verifier 不應依賴 graph mutation。應先用 external correlation + activity trace被動觀察。

### 5. Evidence grade 應分成 graph-level 與 node-level
建議 evidence state：
- `SEMANTIC_EPOCH_CREATED`
- `LAUNCH_THREAD_BOUND`
- `REPLAY_EXTERNAL_CORRELATED`
- `GRAPH_REPLAY_OBSERVED`
- `GRAPH_NODE_OBSERVED`
- `ATTENTION_NODE_BOUND`
- `RUNTIME_KV_READ_BOUND`
- `INTERVENTION_VALIDATED`

這避免「看見 graph replay」就誤宣稱「已看見 attention node/KV read」。

## Architecture Breakdown

### System architecture：Replay-safe Runtime Provenance Verifier

```text
Scheduler / Agent Runtime
  ↓
SemanticEpochRegistry
  - scheduler_step_id
  - request_ids
  - block_table_content_epoch
  - kv_lease_epoch
  - content_hash
  ↓ explicit propagation
Model Worker / CUDA-launch thread
  ↓
ReplayCorrelationScope
  push_external_id(epoch64)
  ↓
CUDAGraph.replay / cudaGraphLaunch
  ↓
CUPTI CUDA API Activity
  correlationId
  ↓
CUPTI Graph Trace
  graphId / streamId / start / end
  ↓ sampled per-node trace
CUPTI Kernel Activity
  graphId / graphNodeId / kernel
  ↓
AttentionNodeBinder
  ↓
RuntimeProvenanceDAG
  ↓
CausalEvidenceGate
```

### 與上一輪比較
上一輪模型：`SemanticEpoch → ExternalCorrelation → GraphReplay`。

本輪修正：
`SemanticEpoch → explicit thread handoff → launch-thread correlation scope → graph launch API → graph replay → sampled node trace`。

新增的核心約束是 **thread locality** 與 **capture/replay separation**。

## Bottom-Level Logic

### CUPTI External Correlation
1. Hermes 產生 64-bit `semantic_epoch_id`。
2. metadata 放入 registry，而非把所有語義塞進 ID。
3. epoch 隨 task/request state 傳到實際 CUDA launch thread。
4. launch thread 呼叫 `cuptiActivityPushExternalCorrelationId(kind, epoch64)`。
5. 同 thread 發生 CUDA Runtime/Driver API。
6. CUPTI 為 API 產生 `correlationId`。
7. ExternalCorrelation activity 記錄 `externalId ↔ correlationId`。
8. GPU activity透過 correlationId / graphId / graphNodeId連回 API。
9. enqueue scope 結束後 pop external ID，避免污染後續不相干 CUDA calls。

### Capture vs Replay
`CaptureEpoch` 定義 graph topology/static addresses；`ReplaySemanticEpoch` 定義本輪動態 request/content。兩者必須是不同 node：

`GraphCaptureEpoch --creates→ GraphExecIdentity`

`ReplaySemanticEpoch --launches→ GraphExecutionWitness`

`GraphExecutionWitness --executes→ GraphNodeExecutionWitness`

不可建立錯誤 edge：
`CaptureNVTXRange --proves→ every replay`。

## Visual Simulation Idea

### Replay-Safe Semantic Correlation Microscope
三條 lane：

```text
Scheduler Thread
E205 create ── handoff ─────────────────────┐
                                             ↓
CUDA Launch Thread                    push(E205)
                                      replay G12
                                      pop(E205)
                                             │
GPU/CUPTI                                    ↓
                                   API corr C901
                                             ↓
                                   Graph G12 / R90
                                             ↓
                                   Node N57 Attention
                                             ↓
                                   Kernel K883
```

UI 同時顯示 capture timeline：
`Capture C17 → NVTX layer hooks → GraphExec G12`，並用不同視覺層明確標註 `CAPTURE_ONLY`，避免使用者把它當 replay evidence。

異常狀態：
- `WRONG_THREAD_CORRELATION`
- `CAPTURE_MARKER_REUSED_AS_REPLAY_EVIDENCE`
- `REPLAY_EXTERNAL_ID_MISSING`
- `GRAPH_LEVEL_ONLY`
- `NODE_BINDING_UNPROVEN`

## Code / GitHub

值得看的 vLLM 原始碼：
- `vllm/utils/nvtx_pytorch_hooks.py`：PyTorch forward hooks → NVTX range；適合 layer topology/shape inspection，但不是 replay-safe semantic identity。
- `vllm/v1/worker/gpu_model_runner.py`：載入 `PytHooks`、CUDA Graph / model execution 主路徑；下一輪應定位 replay call 與 worker/thread boundary。

外部參考：
- NVIDIA CUPTI Usage / External Correlation / CUDA Graph tracing。
- NVIDIA CUPTI `CUpti_ActivityGraphHostNode`。
- `eunomia-bpf/cupti-tutorial`：包含 external correlation 等 CUPTI sample/tutorial，可作 collector prototype 參考，但不是 vLLM ground truth。

## Papers / Technical Reports

本輪核心是官方 runtime semantics 與原始碼，而非新增論文數量。

1. **NVIDIA CUPTI Documentation (2026 current)** — NVIDIA — CUDA 13.x。Architecture：Activity/Callback/Correlation tracing。Contribution：提供 API↔GPU activity correlation、ExternalCorrelation、CUDA Graph graph/node identity。Limitation：不理解 Hermes semantic epoch，且 tracing overhead/feature modes需控制。
2. **vLLM source: NVTX PyTorch hooks** — vLLM contributors — current source。Architecture：module forward hooks + NVTX ranges。Contribution：layerwise model/VLM module profiling metadata。Limitation：CUDA Graph replay 下不能單獨作每次 replay semantic witness。

## Unknown / Open Questions

1. PyTorch `CUDAGraph.replay()` 的實際 Runtime/Driver API callback chain 中，哪一個 callback/correlationId 最穩定代表單次 replay？需要真實 CUPTI trace驗證。
2. vLLM production worker是否存在 thread migration、async worker或多 rank 邊界，使 semantic epoch 必須跨 process/rank傳播，而不只是 thread handoff？
3. 如何在低 overhead 模式下把 `graphNodeId` 穩定綁定到 attention backend/kernel variant，並處理 graph update/sourceGraphNodeId lineage？

## 下一輪研究

直接實作/設計最小 verifier contract：

`SemanticEpochRegistry → worker/rank propagation → replay-call instrumentation point → push/pop ExternalCorrelation → CUPTI API activity → graph trace → graphId/streamId → sampled per-node trace → graphNodeId → attention-node classifier → RuntimeContentEpochBound`。

接著才進入 causal phase：
`Baseline → Sham KV writeback → Zero/Replace target KV → ΔAttention → ΔResidual → ΔLogit → ΔGeneratedToken → ΔAgentAction`。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `ThreadLocalSemanticCorrelationScope`
- `LaunchThreadIdentity`
- `SemanticEpochRegistry`
- `SemanticEpochHandoffWitness`
- `ReplayExternalCorrelationWitness`
- `CaptureOnlyNVTXWitness`
- `GraphLaunchAPICorrelationWitness`
- `GraphLevelExecutionWitness`
- `PerNodeExecutionWitness`
- `GraphHostNodeWitness`
- `PassiveTraceMode`
- `SampledNodeTraceMode`
- `WrongThreadCorrelationState`
- `CaptureReplayConflationState`

### Edges
- `SemanticEpoch --handoff_to→ LaunchThreadIdentity`
- `LaunchThreadIdentity --pushes→ ReplayExternalCorrelationWitness`
- `ReplayExternalCorrelationWitness --correlates→ GraphLaunchAPICorrelationWitness`
- `GraphLaunchAPICorrelationWitness --launches→ GraphLevelExecutionWitness`
- `GraphLevelExecutionWitness --contains→ PerNodeExecutionWitness`
- `PerNodeExecutionWitness --binds_to→ AttentionKernelIdentity`
- `CaptureOnlyNVTXWitness --does_not_prove→ ReplaySemanticEpoch`

## 本輪結束判定

- **缺哪一層：** 真實 vLLM replay call 的 CUPTI external correlation trace與跨 thread/rank semantic propagation。
- **哪個節點最淺：** `ReplayExternalCorrelationWitness` 的實測 instance。
- **哪個概念仍只是名詞：** `RuntimeContentEpochBound → AgentActionCausalBound`。
- **哪個系統值得讀原始碼：** vLLM CUDA Graph replay / worker execution boundary + CUPTI cuda_graphs_trace / external-correlation sample。
- **哪篇論文需追引用：** 下一輪回到 causal intervention 時，追 activation patching / causal tracing 與 cache numerical-equivalence 文獻；本輪以官方 runtime contract為主。
- **哪個概念最適合視覺模擬：** Capture-vs-Replay Semantic Correlation Microscope。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Causal Evidence Gate + Tool Executor`。

## 來源
- NVIDIA CUPTI current documentation: https://docs.nvidia.com/cupti/main/main.html
- NVIDIA CUPTI Graph Host Node API: https://docs.nvidia.com/cupti/13.4.0/api/structCUpti__ActivityGraphHostNode.html
- vLLM NVTX hooks: https://github.com/vllm-project/vllm/blob/main/vllm/utils/nvtx_pytorch_hooks.py
- vLLM GPU model runner: https://github.com/vllm-project/vllm/blob/main/vllm/v1/worker/gpu_model_runner.py
- CUPTI tutorial repository: https://github.com/eunomia-bpf/cupti-tutorial
