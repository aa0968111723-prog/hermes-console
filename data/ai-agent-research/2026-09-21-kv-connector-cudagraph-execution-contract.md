# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 10:52 Asia/Taipei

## 本小時新發現

本輪延續前一輪 `GraphVisibilityContractEpoch`，但把問題從 CUDA Driver 的 wait/flush primitive 往上接到 **vLLM 真正的 KV connector × CUDA Graph execution policy**。核心新結論：對 layerwise asynchronous KV connector，correctness 不一定靠把 visibility primitive 塞進 FULL graph；current vLLM 已有更高階的 production contract：**如果 connector 的 `wait_for_layer_load` / `save_kv_layer` 需要 Python-side async synchronization，就必須要求 PIECEWISE CUDA Graph，讓同步邏輯在 graph pieces 之間 eager 執行。** Base connector 明確警告這些操作若被 FULL graph capture/replay 跳過會造成 data race；LMCache 在 `use_layerwise=True` 時實際回傳 requires-piecewise。

這修正前一輪一個過度單一路徑的模型：`GraphVisibilityContractEpoch` 不應只描述「graph 內有沒有 WAIT+FLUSH node」，而應提升成 **Execution Synchronization Topology**：同步可以 graph-internal、graph-boundary eager、pre-replay fence，或 fail-closed。

新論文方面，SmartGen (Luo, Shen, Wang, Zhou, 2026) 以 proactive / on-demand / speculative 三條 KV transfer path 做 selective disaggregated transfer，最高報告 4.3× TTST 改善。它再次證明 readiness 可能是 subset / phase dependent，而不是單一 request-ready boolean。

## 本小時最重要 5 個發現

### 1. Connector synchronization 本身是 CUDA Graph mode constraint
**已確認工程實作。** vLLM `KVConnectorBase_V1.requires_piecewise_for_cudagraph()` 的 contract 指出，使用 asynchronous layer-by-layer `wait_for_layer_load/save_kv_layer` 的 connector 應回傳 True；原因是這些 Python-side operations 無法被 CUDA Graph 正確 capture，replay 時會被跳過並造成 data race。

底層：
`Remote KV async load → Python layer barrier → Attention layer`。若 FULL graph replay 只重播 captured GPU DAG，而 Python barrier 不再執行，則 `Attention(layer N)` 可能越過 `KV(layer N) ready`。

### 2. LMCache 已提供 production-grade policy instance
**已確認工程實作。** `LMCacheConnectorV1.requires_piecewise_for_cudagraph()` 在 `use_layerwise=True` 時要求 PIECEWISE，並明確把原因連到 `wait_for_layer_load/save_kv_layer` 的 async synchronization。

因此 Hermes 可建立：
`ConnectorSynchronizationRequirement → CUDAGraphExecutionModeConstraint`。

### 3. PIECEWISE 的本質是保留 eager synchronization island
**已確認官方設計 + 合理建模。** vLLM CUDA Graph 設計中 PIECEWISE 讓 attention 或其他 graph-incompatible operations 留在 eager execution；新的 breakable cudagraph 更直接在 dispatcher 遇到 attention/KV custom ops時中止 capture、eager 執行，再恢復 capture。

因此 graph correctness identity 應從：
`GraphExecIdentity + VisibilityPolicy`
提升成：
`GraphExecIdentity + ExecutionMode + EagerBoundaryTopology + ConnectorSyncCapability + VisibilityPolicy`。

### 4. FULL replay 也已存在 pre-replay synchronization precedent
**已確認工程實作。** vLLM `run_fullgraph()` 在 replay 前會呼叫 offloader `sync_prev_onload()`；原始碼註解說明從 eager/piecewise 轉 FULL 時，前一輪 copy stream 的 H2D copies 可能無法被 graph capture-time events 看見，若不先 sync，replay 可能在 copy 尚未完成時覆寫 static buffers。

這是非常重要的 production witness：**captured event topology 不能自動涵蓋 replay 前新產生的 asynchronous work。**

### 5. Readability proof 應加入 Execution-Mode Compatibility Gate
**合理推論，基於上述 production contracts。** 先前 RequiredReadableFrontier 只有 transfer / quiescence / visibility / consumer ordering / lease / translation；現在必須加入：

`ExecutionModeCompatible ∧ SynchronizationTopologySatisfied`。

否則即使 transport 和 CUDA visibility本身都正確，FULL replay仍可能因 barrier不在 replay DAG中而讀到尚未 ready 的 layer KV。

## Architecture Breakdown

### vLLM KV connector × CUDA Graph execution

`Scheduler / ModelRunner`
→ `KVConnector capability`
→ `requires_piecewise_for_cudagraph(extra_config)`
→ `CUDAGraph mode resolution`
→ `FULL / PIECEWISE / FULL_AND_PIECEWISE / breakable`
→ `Forward context + persistent buffers`
→ `graph segment replay`
→ `eager synchronization island (when required)`
→ `attention / KV custom op`
→ `next graph segment`

對 layerwise LMCache：

`Layer N remote KV transfer`
→ `wait_for_layer_load(N)`
→ **must execute outside an opaque FULL replay path**
→ `Attention(N)`
→ `save_kv_layer(N)` if applicable
→ next layer.

### Breakable CUDA Graph

current design可抽象為：

`capture segment A`
→ dispatcher intercepts attention/KV op
→ end capture
→ eager op / synchronization
→ resume capture segment B
→ artifact = `[graph replay A, eager callable, graph replay B, ...]`.

這提供一個比「全部 FULL」或「全部 eager」更細的 synchronization topology。

## Bottom-Level Logic

### 新的 Execution Synchronization Contract

```text
ExecutionSynchronizationContract {
  connector_id
  connector_mode
  cudagraph_mode
  graph_exec_generation
  eager_boundary_topology
  layerwise_sync_required
  pre_replay_fence_required
  visibility_primitive
  ordering_domain_set
  static_buffer_generation
}
```

Attention layer L 可讀的條件更新為：

```text
AttentionReadable(L) =
  RequiredTransferFrontier(L)
  ∧ TransportObjectQuiescence(L)
  ∧ RequiredVisibilityFrontier(L)
  ∧ RequiredConsumerOrderingFrontier(L)
  ∧ KVLeaseEpochValid(L)
  ∧ TranslationEpochValid(L)
  ∧ ExecutionModeCompatible(L)
  ∧ SynchronizationBoundaryExecuted(L)
  ∧ PostBarrierAttentionLaunch(L)
```

### 為什麼 FULL replay 會有新風險

CUDA Graph replay重播的是 capture/instantiate 時建立的 GPU execution DAG與固定/可更新參數；但「上一個 eager iteration剛排入 copy stream的新 H2D」、「Python connector剛收到的 remote layer completion」都可能是 **capture之後才出現的 runtime dependency**。

因此：

`RuntimeDependencyCreatedAfterCapture --does_not_automatically_belong_to→ CapturedGraphDependencyDAG`。

vLLM offloader的 pre-replay sync正是這個問題的 production evidence。

## Visual Simulation Idea

### CUDA Graph Synchronization Island Viewer

五條同步時間軸：

```text
REMOTE KV      L0 =====ready    L1 =====ready
CONNECTOR          wait(L0)         wait(L1)
GRAPH SEGMENT   [ G0 ]          [ G1 ]
EAGER ISLAND          [ATTN0]          [ATTN1]
GPU COPY        H2D ----->| fence
```

互動切換：
- FULL
- PIECEWISE
- FULL_AND_PIECEWISE
- Breakable CUDA Graph
- layerwise on/off
- pre-replay offloader fence on/off
- wait_for_layer_load executed/skipped

故障狀態：
- `CONNECTOR_SYNC_SKIPPED_BY_FULL_REPLAY`
- `RUNTIME_DEPENDENCY_OUTSIDE_CAPTURED_DAG`
- `PRE_REPLAY_COPY_NOT_QUIESCED`
- `EAGER_BOUNDARY_MISSING`
- `GRAPH_MODE_CONNECTOR_CAPABILITY_MISMATCH`
- `ATTENTION_LAUNCHED_BEFORE_LAYER_READY`

Hermes Console應把「graph segment」和「eager synchronization island」畫成不同視覺物件，而不是只畫一條 CUDA Graph。

## Code / GitHub

### vLLM 值得看的核心檔案
1. `vllm/distributed/kv_transfer/kv_connector/v1/base.py`
   - `requires_piecewise_for_cudagraph`
   - connector-level graph compatibility contract。
2. `vllm/distributed/kv_transfer/kv_connector/v1/lmcache_connector.py`
   - LMCache `use_layerwise` → PIECEWISE production instance。
3. `vllm/distributed/kv_transfer/kv_connector/v1/multi_connector.py`
   - child connector任一要求 PIECEWISE，aggregate connector也要求 PIECEWISE；這其實是一種 capability join。
4. `vllm/v1/cudagraph_dispatcher.py`
   - runtime graph key / mode dispatch。
5. `vllm/compilation/breakable_cudagraph.py`
   - capture break → eager callable → resume capture。
6. `vllm/v1/worker/gpu/cudagraph_utils.py`
   - `run_fullgraph()` 的 `sync_prev_onload()` pre-replay fence。
7. `vllm/v1/worker/gpu_model_runner.py`
   - attention backend CG support、capture/warmup、forward context與 connector finalization。

## Papers

### SmartGen: Seamless Disaggregated LLM Inference with Selective KV Cache Transfer
- Authors: Xuchuan Luo, Jiacheng Shen, Xin Wang, Yangfan Zhou
- Year: 2026
- URL: https://arxiv.org/abs/2607.28150
- Code: 本輪未確認官方 code repository
- Dataset: serving workload / evaluation setup，非單一訓練 dataset
- Architecture: disaggregated prefill/decode + proactive / on-demand / speculative KV transfer
- Contribution: selective KV transfer，避免一次完整搬移所有 KV；報告 TTST最高改善 4.3×，後續 decoding performance/accuracy comparable。
- Limitations: 論文結果不能直接證明 CUDA memory visibility、connector barrier或 graph replay ordering；這些仍需 runtime source/evidence。
- 改變了什麼: readiness由 request-level boolean進一步變成 subset/path/phase-dependent state，支持 Hermes 的 `ReadableSubsetWitness`。

## 與歷史研究比較

前輪建立：
`GraphVisibilityContractEpoch`、`DataBeforeSignalWitness`、`WAIT_VALUE_FLUSH` 與 remote-write visibility。

本輪新增的不是另一個 flush primitive，而是更高階的 correctness boundary：

`GraphVisibilityContractEpoch`
→ **`ExecutionSynchronizationContract`**
→ **`EagerSynchronizationIsland`**
→ **`ConnectorGraphModeCompatibility`**。

前輪假設的主要解法偏向「把必要 visibility semantics 放進 graph generation」。本輪修正：對 Python/layerwise async connector，production system可能選擇 **不把 barrier capture進 FULL graph，而是保留 eager boundary / PIECEWISE execution**。兩種策略都必須被 provenance模型表達。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `ExecutionSynchronizationContract`
- `ConnectorGraphModeCapability`
- `ExecutionModeCompatibilityWitness`
- `EagerSynchronizationIsland`
- `SynchronizationBoundaryExecutedWitness`
- `RuntimeDependencyOutsideCapturedDAGState`
- `PreReplayFenceWitness`
- `StaticBufferGeneration`
- `GraphSegmentIdentity`
- `BreakableGraphBoundary`
- `ConnectorCapabilityJoin`

### Edges
- `LayerwiseAsyncConnector --requires→ EagerSynchronizationIsland`
- `LMCache(use_layerwise) --requires→ PIECEWISEExecutionCapability`
- `MultiConnector --joins→ ChildConnectorGraphModeCapabilities`
- `PreReplayFenceWitness --orders→ FullGraphReplay`
- `BreakableGraphBoundary --separates→ GraphSegment / EagerOperation`
- `ExecutionModeCompatibilityWitness --gates→ AttentionReadable`
- `RuntimeDependencyCreatedAfterCapture --does_not_automatically_belong_to→ CapturedGraphDependencyDAG`
- `FULLGraphReplay --does_not_prove→ ConnectorSynchronizationExecuted`

## Unknown / Open Questions

1. NIXL / Mooncake connectors是否有 connector-specific `requires_piecewise_for_cudagraph`、或它們完全在 request-level admission前完成 ordering？目前需要逐 implementation確認。
2. Breakable CUDA Graph eager attention boundary是否能成為通用 KV transfer visibility hook，還是 connector同步仍位於更外層 model-runner lifecycle？
3. `ObservedPhysicalKVReadSet` 仍未解：目前證據已能描述「Attention何時合法啟動」，尚未證明 kernel實際 load了哪些 KV byte ranges。

## 下一輪研究

1. 逐 connector建立 `ConnectorGraphModeCapabilityMatrix`: LMCache / NIXL / Mooncake / MoRIIO / MultiConnector。
2. 追 `gpu_model_runner → set_forward_context → cudagraph dispatcher → connector wait/finalize → attention` exact call order。
3. 追 breakable cudagraph dispatcher如何攔截 attention/KV custom op，以及 eager island前後的 stream/event semantics。
4. 將 `ExecutionSynchronizationContract` 實作成 Hermes knowledge-graph schema。
5. 再往下接 `VisibleLogicalPositionSet → ExpectedPhysicalKVReadSet → controlled ZERO/REPLACE KV → ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction`。

## 本輪結束判斷

- **缺哪一層：** connector completion / layer barrier到 vLLM graph/eager boundary的 exact runtime call-order trace。
- **哪個節點最淺：** `ExecutionModeCompatibilityWitness` 已有 LMCache production instance，但跨 connector matrix尚未完成。
- **哪個概念仍只是名詞：** `ObservedPhysicalKVReadSet`。
- **哪個系統值得讀原始碼：** vLLM `breakable_cudagraph.py + cudagraph_dispatcher.py + gpu_model_runner.py`，再與 LMCache/NIXL/Mooncake connector對照。
- **哪篇論文需追引用：** SmartGen，尤其 selective/on-demand KV fetching如何與 layer readiness及 CUDA execution boundary整合。
- **哪個概念最適合視覺模擬：** `CUDA Graph Synchronization Island Viewer`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Connector Capability Adapter + Execution Synchronization Contract Verifier + Transport/Visibility Frontier Verifier + Residency/Lease Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。

## 本輪最重要結論

從「使用者說一句話」一路還原到 GPU 時，不能把 CUDA Graph當成透明加速層。對 distributed KV / layerwise transfer而言，**graph execution mode本身就是 correctness contract的一部分**。現在 Hermes需要驗證的不只是「KV傳完、GPU可見、lease正確」，還要驗證：**這一次真正採用的 FULL / PIECEWISE / breakable execution topology，有沒有保留 connector要求的 runtime synchronization boundary；如果 barrier在 capture之外，replay是否仍確實執行它。**