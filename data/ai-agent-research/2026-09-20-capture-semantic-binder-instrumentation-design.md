# 【AI Agent × Multimodal Research Report】

時間：2026-09-20 19:50（Asia/Taipei）

主題：Capture Semantic Binder Instrumentation × Tools Node ID × ForwardContext Snapshot

## 本小時新發現

本輪延續上一輪最淺缺口 `CaptureScopeNodeCreationWitness`，不再重複 CUDA Graph topology、source lineage、KV slot mapping或 2D/3D kernel-set。本輪目標是把「capture-time semantic binder」從架構概念收斂成可以實作的 instrumentation contract。

核心進展有三個：

1. CUDA 13.4 提供 `cudaGraphNodeGetToolsId` / `cuGraphNodeGetToolsId`，其用途就是取得 tools 用來識別 graph node 的 ID；同時 `graphId + local nodeId` 可唯一識別 template graph node。這表示 Hermes 不必把 opaque `CUgraphNode` pointer 當持久 identity。
2. CUPTI `CUpti_GraphData` callback payload只在 callback invocation期間有效；若要留到 callback外，必須複製資料。因此 side table 的 ingest path必須在 callback當下把必要 handle/ID/type/lineage/scope snapshot複製成 owned record。
3. current vLLM `ForwardContext` 已包含 `attn_metadata`, `slot_mapping`, `cudagraph_runtime_mode`, `batch_descriptor`, `ubatch_slices`, `no_compile_layers` 等 runtime semantic state；`set_forward_context()` 是每次 model forward 的集中 context-manager入口。這提供 Hermes semantic snapshot 的最佳 framework-side hook，而不是重新從 CUDA kernel name猜 layer/request。

因此 production binder 可以具體化成：

```text
vLLM set_forward_context
→ Hermes ForwardSemanticSnapshot
→ capture-scope TLS / thread-local semantic token
→ CUPTI GRAPHNODE_CREATED callback
→ copy CUpti_GraphData
→ obtain/store graph/tools-node/local-node identity
→ CaptureNodeRecord
→ dependency / clone / graphExec lifecycle
→ replay sourceGraphId/sourceGraphNodeId
→ semantic join
```

## 本小時最重要 5 個發現

### 1. Persistent node identity 應優先使用 tools/node IDs，而不是 raw pointer

**官方已確認**：CUDA 13.4 Runtime/Driver Graph API提供 `cudaGraphNodeGetToolsId` / `cuGraphNodeGetToolsId`；另有 graph ID與 local node ID APIs。`graphId + local nodeId` 可唯一識別 template graph node。

**底層運作**：

```text
CUgraphNode handle
→ toolsNodeId
→ graphId + localNodeId
→ persistent CaptureNodeKey
```

建議：

```text
CaptureNodeKey {
  process_epoch,
  capture_epoch,
  graph_id,
  local_node_id,
  tools_node_id,
  node_type
}
```

**重要性**：raw CUDA object pointer只適合作為當下 handle，不適合作為跨 callback、clone/update/replay 的 semantic primary key。

**限制**：仍需實測 `toolsNodeId` 與 CUPTI activity `sourceGraphNodeId` 在 current CUDA 13.4 runtime上的精確對應契約；在未驗證前不能直接宣稱兩者數值必然相等。

### 2. Callback ingestion 必須是 copy-now / resolve-later

**官方已確認**：`CUpti_GraphData` 的 callback data只在 callback invocation期間有效；要在 callback外使用必須複製。

因此 callback hot path不應執行重型 Python/JSON/DB工作，而應：

```text
callback
→ read current semantic token
→ copy minimal graph fields
→ assign monotonic event_seq
→ enqueue lock-light/native record
→ return

consumer thread
→ resolve IDs/lineage
→ enrich semantic metadata
→ persist topology side table
```

這新增 `CallbackLifetimeSafetyWitness`。

### 3. vLLM ForwardContext 可以成為 SemanticCaptureScope 的 canonical source

current vLLM `create_forward_context()` 建立的 `ForwardContext` 包含 attention metadata、slot mapping、CUDA Graph runtime mode、batch descriptor、microbatch slices與 static forward context；`set_forward_context()` 是集中式 context manager。

因此 Hermes 不需要把 semantic scope做成一堆零散 hook，第一層可以先在 `set_forward_context()` entry建立：

```text
ForwardSemanticSnapshot {
  forward_epoch,
  rank,
  pipeline_stage,
  cudagraph_runtime_mode,
  batch_descriptor_digest,
  attn_metadata_epoch,
  slot_mapping_epoch,
  ubatch_slice_id,
  static_forward_context_version
}
```

**限制**：ForwardContext 是 forward-level scope，不等於 exact Layer/Op scope；仍需在 attention/KV custom-op boundary push更細的 `OpSemanticToken`。

### 4. Semantic scope 必須是階層式，而不是單一 Layer ID

本輪把 scope模型修正為：

```text
ForwardScope
  └─ MicrobatchScope
      └─ LayerScope
          └─ OpScope
              └─ Kernel/GraphNode creation
```

建議 token：

```text
SemanticToken {
  forward_epoch,
  microbatch_epoch,
  layer_name,
  op_kind,
  op_invocation_epoch,
  metadata_epoch,
  kv_cache_identity,
  slot_mapping_epoch
}
```

這能避免 PIECEWISE/FULL、speculative decode、microbatching 下只用 `layer_name` 造成 semantic collision。

### 5. Capture-time binder與 replay-time binder應透過 explicit source-lineage join，而不是 ID 猜測

CUPTI 13.4 per-node activities提供 `graphId/graphNodeId` 與 `sourceGraphId/sourceGraphNodeId`；source fields表示 node 被 instantiated 或最後 updated 的來源。這讓 replay evidence可回到 capture-origin node。

但新的嚴格規則是：

```text
ToolsNodeId
--requires_runtime_validation_before_equating→
sourceGraphNodeId
```

Hermes 應先做 calibration run，對同一 graph同時記錄：

```text
CUgraphNode handle
localNodeId
toolsNodeId
CUPTI graphNodeId
CUPTI sourceGraphNodeId
```

建立 `NodeIdNamespaceCalibrationWitness`，再決定可否直接 join。

## Architecture Breakdown

### Hermes Capture Semantic Binder v0

```text
Framework Plane
vLLM set_forward_context()
      ↓
ForwardSemanticSnapshot
      ↓
Layer / custom-op semantic hooks
      ↓
Thread-local SemanticToken Stack
      ↓
CUDA Capture Plane
CUPTI RESOURCE callbacks
 GRAPHNODE_CREATED
 GRAPHNODE_CLONED
 DEPENDENCY_CREATED
 GRAPHEXEC_CREATED
 GRAPH_NODE_UPDATED
      ↓
Native Callback Ring Buffer
      ↓
Topology Consumer
      ↓
CaptureNodeRecord + DAG + GraphExecRecord
      ↓
Replay Plane
Kernel13 / Memcpy7 / Memset5 / GraphTrace
      ↓
sourceGraphId/sourceGraphNodeId
      ↓
NodeIdNamespaceCalibration
      ↓
CaptureOriginSemanticJoin
      ↓
CanonicalLaunchWitness
```

### CaptureNodeRecord schema

```text
CaptureNodeRecord {
  event_seq,
  timestamp_cpu,
  process_epoch,
  thread_id,
  semantic_token_id,
  capture_epoch,
  topology_version,
  graph_handle_ephemeral,
  node_handle_ephemeral,
  original_graph_handle_ephemeral,
  original_node_handle_ephemeral,
  graph_id,
  local_node_id,
  tools_node_id,
  node_type,
  clone_parent_key,
  graph_exec_key,
  callback_kind
}
```

`*_handle_ephemeral` 只作 debug，不作 durable primary key。

## Bottom-Level Logic

### Instrumentation algorithm

```text
1. Process startup before any graph instantiate:
   - initialize CUPTI;
   - enable resource callbacks;
   - enable selected graph/kernel activities;
   - allocate native ring buffer;
   - establish process_epoch.

2. Enter vLLM set_forward_context:
   - increment forward_epoch;
   - snapshot runtime mode/batch descriptor/metadata epochs;
   - push ForwardScope token.

3. Enter attention/KV custom op:
   - derive LayerScope + OpScope;
   - push SemanticToken on the same launch/capture thread.

4. CUPTI GRAPHNODE_CREATED:
   - copy callback-owned graph/node/original handles and nodeType immediately;
   - read current SemanticToken ID;
   - assign event_seq;
   - emit compact CaptureNodeEvent.

5. Consumer:
   - resolve graph/local/tools IDs where safe;
   - build CaptureNodeRecord;
   - join dependency and clone callbacks;
   - version topology.

6. GRAPHEXEC_CREATED:
   - bind graphExec to capture topology version.

7. Replay:
   - collect graphId/graphNodeId/sourceGraphId/sourceGraphNodeId;
   - use calibrated namespace mapping;
   - join to CaptureNodeRecord;
   - emit CaptureOriginNodeBindingWitness.

8. Join LayerRuntimeContext + EffectiveKVReadSet:
   - emit RuntimeKVReadWitness candidate.
```

### Failure states

```text
NO_SEMANTIC_TOKEN_AT_NODE_CREATE
CALLBACK_DATA_ESCAPED_LIFETIME
NODE_ID_NAMESPACE_UNCALIBRATED
TOPOLOGY_VERSION_MISMATCH
GRAPH_EXEC_UNBOUND
THREAD_SCOPE_MISMATCH
OP_SCOPE_LEAK
SOURCE_LINEAGE_UNRESOLVED
```

## Visual Simulation Idea

### Semantic Token Stack → Capture Node Binder

```text
THREAD T7                         CUDA GRAPH

Forward E501
 └─ µBatch U3
    └─ Layer18
       └─ Attention A9
          [TOKEN S882] ───────→ NODE_CREATED
                                graph=G14
                                local=N17
                                tools=T991
                                type=KERNEL
                                   ↓
                              Source Record
                                   ↓
REPLAY R122                    Exec Node N81
                                   │
                                   └─ source=N17
                                          ↓
                                  Layer18 / A9
```

UI interactions:
- live semantic stack per CPU thread;
- click node → show callback lifetime record + IDs in each namespace;
- namespace calibration panel comparing local/tools/source/execution IDs;
- DAG overlay and graphExec lifecycle;
- warning badges for scope leak, missing token, uncalibrated namespace, late attach;
- replay timeline joins dynamic `RuntimeContentEpoch` separately from static topology.

## Code / GitHub

### vLLM current source inspected

- `vllm/forward_context.py`
  - `get_forward_context()` exposes current context.
  - `create_forward_context()` materializes `attn_metadata`, `slot_mapping`, `cudagraph_runtime_mode`, `batch_descriptor`, `ubatch_slices`, `no_compile_layers`.
  - `set_forward_context()` is the centralized context-manager hook for model forward.
- `vllm/v1/worker/gpu/model_runner.py`
  - attention metadata is prepared from block tables, slot mappings, attention groups and KV cache config;
  - FULL capture has a distinct `for_capture` metadata staging path.
- `docs/design/cuda_graphs.md`
  - capture occurs on first dummy/model forward with non-NONE runtime mode;
  - full capture deliberately prepares attention metadata so backends launch the intended routines.

Worth reading next:
- attention custom-op wrapper entry/exit boundaries;
- `BreakableCUDAGraphCapture` thread behavior;
- speculative decode/microbatch ForwardContext nesting;
- CUDA graph update path and graphExec replacement.

### NVIDIA APIs to prototype

- `CUPTI_CBID_RESOURCE_GRAPHNODE_CREATED`
- `CUpti_GraphData`
- `cuGraphGetId` / `cudaGraphGetId`
- `cuGraphNodeGetLocalId` / `cudaGraphNodeGetLocalId`
- `cuGraphNodeGetToolsId` / `cudaGraphNodeGetToolsId`
- CUPTI `sourceGraphId/sourceGraphNodeId`
- `CUPTI_ACTIVITY_KIND_EXTERNAL_CORRELATION`

## Papers / Technical References

本輪主要缺口是 runtime instrumentation semantics，因此以官方 CUDA/CUPTI 與 vLLM source為主，不為湊數新增弱相關論文。

上一輪的 Model2Kernel仍值得追：它的核心方向「model invocation constraints → kernel argument verification」與本輪 `SemanticToken → CaptureNodeRecord` 可形成互補：前者驗證 kernel contract，後者驗證 runtime provenance。

## Unknown / Open Questions

1. `cuGraphNodeGetToolsId()` 的 `toolsNodeId` 與 CUPTI 13.4 `sourceGraphNodeId` 是否在所有 clone/update/instantiate path 都能直接等值 join，還是必須維護 namespace mapping？目前先視為未驗證。
2. vLLM capture/custom-op boundary是否始終在同一 CPU thread觸發 CUPTI graph-node lifecycle callback？若 torch.compile/runtime內部跨 thread，需要 explicit semantic-token handoff。
3. graph node parameter update但 topology不變時，應建立 `NodeContentVersion` 還是新的 `GraphTopologyVersion`？建議先分離 topology version 與 node-parameter/content version。

## Knowledge Graph 新增 Node / Edge

### Nodes

- `ForwardSemanticSnapshot`
- `HierarchicalSemanticToken`
- `OpSemanticToken`
- `CaptureNodeKey`
- `ToolsNodeIdentity`
- `LocalGraphNodeIdentity`
- `NodeIdNamespaceCalibrationWitness`
- `CallbackLifetimeSafetyWitness`
- `NativeCaptureEventBuffer`
- `NodeParameterVersion`
- `SemanticTokenScopeIntegrityWitness`
- `CaptureBinderInstrumentationState`

### Edges

```text
ForwardContext
--snapshots_to→ ForwardSemanticSnapshot

ForwardSemanticSnapshot
--contains→ HierarchicalSemanticToken

OpSemanticToken
--active_during→ CaptureNodeRecord

CUgraphNode
--has_tools_identity→ ToolsNodeIdentity

CUgraphNode
--has_local_identity→ LocalGraphNodeIdentity

ToolsNodeIdentity
--requires_calibration_to_join→ SourceGraphNodeIdentity

CUpti_GraphData
--must_copy_within_callback→ CaptureNodeRecord

CallbackLifetimeSafetyWitness
--guards→ CaptureOriginNodeBindingWitness

GraphTopologyVersion
--independent_axis_from→ NodeParameterVersion

SemanticTokenScopeIntegrityWitness
--guards→ CaptureScopeNodeCreationWitness
```

## 與歷史研究比較

上一輪完成：

```text
SemanticCaptureScope
→ GRAPHNODE_CREATED
→ CaptureOriginNodeRecord
→ replay source lineage
```

本輪新增真正可實作的細節：

```text
vLLM ForwardContext
→ hierarchical semantic token
→ callback-safe native event
→ graph/local/tools node IDs
→ namespace calibration
→ durable CaptureNodeKey
→ replay source-lineage join
```

因此最淺缺口已從「要在哪裡綁 semantic」下降成「ID namespace與 thread/scope semantics是否能在 production capture path穩定校準」。

## 本輪結束判定

- 缺哪一層：`toolsNodeId/localNodeId ↔ CUPTI sourceGraphNodeId` 的 production calibration，以及 capture callback thread ownership實測。
- 哪個節點最淺：`NodeIdNamespaceCalibrationWitness` production instance。
- 哪個概念仍只是名詞：跨 process/rank 的 `GlobalSemanticExecutionTape`。
- 哪個系統值得讀原始碼：vLLM attention custom-op + Breakable CUDA Graph capture thread path；NVIDIA `cuda_graphs_trace` sample。
- 哪篇論文需追引用：Model2Kernel，特別是 model-level invocation constraint 如何映射到 kernel argument verification。
- 哪個概念最適合視覺模擬：Semantic Token Stack → Capture Node Binder + Node-ID Namespace Calibration。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Runtime Provenance Verifier + Capture Semantic Binder + Graph/Eager Evidence Adapter + Causal Evidence Gate + Tool Executor`。

## 下一輪研究

```text
prototype NodeIdNamespaceCalibration
→ inspect cuda_graphs_trace sample
→ verify tools/local/source node ID relations
→ verify callback thread identity
→ attention custom-op OpSemanticToken hook
→ capture event ring buffer schema
→ CaptureOriginNodeBindingWitness
→ KernelSetCompletionWitness
→ EffectiveKVReadSet
→ RuntimeKVReadWitness
→ controlled ZERO/REPLACE KV
→ ΔAttentionOutput
→ ΔResidual
→ ΔLogit
→ ΔGeneratedToken
→ ΔAgentAction
```

本輪最重要的推進：**Capture Semantic Binder 已從抽象架構變成一個具體 instrumentation contract：用 vLLM ForwardContext 提供 semantic snapshot、用階層式 token標記 op scope、在 CUPTI node-create callback內做 lifetime-safe ingest，再用 CUDA tools/local node IDs與 CUPTI source lineage經 calibration建立 durable semantic node identity。**