# 【AI Agent × Multimodal Research Report】

時間：2026-09-20 20:55（Asia/Taipei）

主題：Callback-Safe CUDA Graph Node Identity × CUPTI GraphNodeId × Tools/Local ID Namespace Calibration

## 本小時新發現

本輪直接接續上一輪最淺節點 `NodeIdNamespaceCalibrationWitness`，並修正上一輪 instrumentation contract 中一個重要風險：**CUPTI callback 內不能任意呼叫 CUDA Runtime/Driver API 來查 `cudaGraphNodeGetToolsId` / `cuGraphNodeGetToolsId`。** CUPTI 官方 Callback API 明確警告，除非文件另有說明，callback 中呼叫 CUDA runtime/driver API 不受支援，可能造成 hang。因此 `GRAPHNODE_CREATED callback → cudaGraphNodeGetToolsId()` 不能作為 production-safe 預設路徑。

同時，CUPTI 本身已有 `cuptiGetGraphNodeId(CUgraphNode, uint64_t*)`、`cuptiGetGraphId(CUgraph, uint32_t*)`、`cuptiGetGraphExecId(CUgraphExec, uint32_t*)`。CUDA 11.0 起，NVIDIA 就把 `cuptiGetGraphNodeId()` 定義為取得與 activity `graphNodeId` 對應的 graph-node unique ID，且 `GRAPHNODE_CREATED` callback 會發生在 graph-node creation API enter/exit callbacks之間。這提供一條比「在 CUPTI callback 裡反呼 CUDA API」更自然的 tools-side identity path。

因此本輪把 capture binder 修正成兩條 identity lane：

```text
Lane A — CUPTI-native provenance
GRAPHNODE_CREATED
→ CUgraphNode handle
→ cuptiGetGraphNodeId
→ CUPTI CaptureNodeId
→ replay sourceGraphNodeId
→ semantic join

Lane B — CUDA graph inspection / calibration
outside CUPTI callback
→ cuGraphGetId
→ cuGraphNodeGetLocalId
→ cuGraphNodeGetToolsId
→ graph topology inspection
→ namespace calibration
```

`Lane A` 是 production provenance 主路；`Lane B` 是 calibration/debug/inspection 路，不再要求 callback hot path 呼叫 CUDA API。

官方來源：
- CUPTI Usage / Callback API / CUDA Graph tracing: https://docs.nvidia.com/cupti/main/main.html
- CUPTI Activity API (`cuptiGetGraphNodeId`, `cuptiGetGraphId`, `cuptiGetGraphExecId`): https://docs.nvidia.com/cupti/13.4.1/api/group__CUPTI__ACTIVITY__API.html
- CUDA Driver Graph API (`cuGraphGetId`, `cuGraphNodeGetLocalId`, `cuGraphNodeGetToolsId`): https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/group__CUDA__GRAPH.html
- CUPTI 13.4 release notes (`sourceGraphId/sourceGraphNodeId`): https://docs.nvidia.com/cupti/release-notes/release-notes.html

## 本小時最重要 5 個發現

### 1. 修正：不要在 CUPTI resource callback 裡直接呼 CUDA Graph query API

**官方已確認**：CUPTI callback 文件說明，除非特別註明，callback 中呼叫 CUDA runtime/driver API 不受支援，可能造成 application hang。

因此上一輪概念：

```text
GRAPHNODE_CREATED callback
→ cudaGraphNodeGetToolsId
```

必須降級為 **不安全/未允許的預設設計**。

production hot path應改成：

```text
callback
→ copy callback payload / handles
→ CUPTI-safe identity path
→ compact record
→ return
```

CUDA graph inspection則移到 framework-controlled safe point或 calibration harness。

新增：`CallbackApiSafetyWitness`、`ForbiddenCudaApiInCallbackState`。

### 2. `cuptiGetGraphNodeId` 是 capture ↔ activity 最直接的 ID bridge

**官方已確認**：CUPTI 自 CUDA 11.0 起提供 `cuptiGetGraphNodeId()`；release notes明確說明 activity `graphNodeId` 可用該 API query。CUDA 13.4 per-node activity又增加 `sourceGraphId/sourceGraphNodeId`，表示執行 node instantiated 或最後 updated 的來源。

因此新的核心鏈是：

```text
Capture CUgraphNode
→ cuptiGetGraphNodeId
→ CaptureCUPTINodeId

Replay Kernel13
→ graphNodeId
→ sourceGraphNodeId
→ CaptureCUPTINodeId
```

這比先把 `toolsNodeId` 假設成 `sourceGraphNodeId` 更嚴格。

### 3. `toolsNodeId`、`localNodeId`、`CUPTI graphNodeId` 應視為不同 namespace，直到實測證明映射

CUDA Driver API 13.4 分別提供：

```text
cuGraphNodeGetLocalId(node) → local node id
cuGraphNodeGetToolsId(node) → tools node id
cuptiGetGraphNodeId(node) → CUPTI graph node id
```

其中官方明確保證的是：

```text
graphId + localNodeId
→ uniquely identifies node within template graph
```

以及 CUPTI activity 使用自己的 `graphNodeId/sourceGraphNodeId` provenance contract。

目前沒有足夠官方證據可宣稱：

```text
localNodeId == toolsNodeId == cuptiGraphNodeId
```

所以 Knowledge Graph 新增否定/待驗證關係：

```text
LocalNodeId
--not_assumed_equal→ ToolsNodeId

ToolsNodeId
--not_assumed_equal→ CUPTIGraphNodeId
```

### 4. Calibration harness 應該在 callback 外建立三 namespace 對照表

新的 calibration run：

```text
Capture graph完成、仍未 destroy
→ cuGraphGetNodes(graph)
→ for each node:
   cuGraphGetId(graph)
   cuGraphNodeGetLocalId(node)
   cuGraphNodeGetToolsId(node)
   cuptiGetGraphNodeId(node)
→ 保存 tuple

Replay
→ Kernel13.graphId
→ Kernel13.graphNodeId
→ Kernel13.sourceGraphId
→ Kernel13.sourceGraphNodeId
→ join tuple
```

輸出：

```text
NodeNamespaceTuple {
  graph_id,
  local_node_id,
  tools_node_id,
  cupti_node_id,
  node_type,
  capture_epoch,
  topology_version
}
```

這才是 `NodeIdNamespaceCalibrationWitness` 的 production-grade 定義。

### 5. Graph-level trace與 per-node trace必須是兩種 evidence mode，而不是同時期待

**官方已確認**：CUPTI graph-level trace與 per-node tracing互斥。Graph-level trace降低 overhead，但不提供 node visibility；per-node trace提供 `graphId/graphNodeId/sourceGraphId/sourceGraphNodeId`，NVIDIA建議 node-level tracing優先考慮 HES 以降低成本。

因此 Hermes應有：

```text
PRODUCTION_LOW_OVERHEAD
→ GraphTrace2
→ graph replay witness
→ topology version

CALIBRATION / SAMPLE
→ Kernel13 / Memcpy7 / Memset
→ sourceGraphNodeId
→ exact semantic node binding
```

不能把「production graph trace沒有 node」誤判成 provenance failure。

## Architecture Breakdown

### Hermes Graph Semantic Binder v1

```text
Framework Semantic Plane
vLLM ForwardContext
→ ForwardSemanticSnapshot
→ LayerScope
→ OpSemanticToken
             │
             ▼
Capture Plane
CUPTI RESOURCE callback
→ GRAPHNODE_CREATED
→ copy CUpti_GraphData fields
→ current SemanticToken ID
→ cupti-native node identity when supported/safe
→ CaptureNodeEvent
→ native ring buffer
             │
             ▼
Topology Plane
CaptureNodeRecord
→ dependency DAG
→ graphExec lifecycle
→ GraphTopologyVersion
             │
             ├── Debug Calibration Plane
             │   safe-point graph inspection
             │   → localNodeId
             │   → toolsNodeId
             │   → CUPTI nodeId
             │   → NodeNamespaceTuple
             │
             ▼
Replay Plane
GraphTrace2 (production)
OR
Kernel13/Memcpy7/Memset (sample)
→ graphNodeId/sourceGraphNodeId
→ CaptureOriginNode
→ OpSemanticToken
→ Layer/KV/metadata identity
→ CanonicalLaunchWitness
```

### System architecture implication

這個 binder應該成為 Hermes Runtime Provenance Verifier 的底層 adapter，而不是寫死在 UI：

```text
Hermes Console UI
→ Provenance Query API
→ Runtime Provenance Verifier
   ├ Semantic Binder
   ├ Graph/Eager Adapter
   ├ Node Namespace Calibrator
   ├ KV Read-Set Resolver
   └ Causal Intervention Verifier
→ vLLM / CUDA / CUPTI
```

這讓 UI 可視化與底層 profiler解耦。

## Bottom-Level Logic

### Capture callback hot path

```text
on GRAPHNODE_CREATED(graphData):
  1. read current thread-local OpSemanticToken ID
  2. copy graph/node/originalGraph/originalNode/nodeType handles
  3. obtain CUPTI-native IDs only through APIs documented/validated safe for this callback path
  4. assign event_seq + process_epoch + capture_epoch
  5. enqueue fixed-size CaptureNodeEvent
  6. return immediately
```

嚴格禁止在 hot path做：

```text
CUDA Runtime/Driver graph query
Python callback
JSON serialization
filesystem/database I/O
network I/O
blocking lock
```

除非個別 API 有明確 callback-safe契約並經實測。

### Namespace calibration

```text
capture complete
→ safe framework point
→ enumerate graph nodes
→ query LocalId
→ query ToolsId
→ query CUPTI NodeId
→ persist namespace tuple
→ instantiate/replay
→ collect Kernel13 source IDs
→ verify mapping
```

判定：

```text
CALIBRATED_EXACT
CALIBRATED_VERSION_SPECIFIC
UNRESOLVED_NAMESPACE
MAPPING_CHANGED_AFTER_UPDATE
NODE_DESTROYED_BEFORE_CALIBRATION
```

### Graph update complication

CUDA 13.4 `sourceGraphId/sourceGraphNodeId` 表示 node instantiated **或最後 updated** 的來源，因此 `GraphExecUpdate` / node parameter update不能只沿用 capture-time mapping。

必須加入：

```text
GraphExecEpoch
NodeParameterVersion
SourceLineageVersion
```

即：

```text
Capture Origin
→ Instantiate V1
→ Update V2
→ Replay R
→ source lineage points to last update source
```

所以 semantic provenance是 versioned lineage，不是 immutable one-time mapping。

## Visual Simulation Idea

### Node-ID Namespace Calibration Microscope

Hermes Console增加四欄：

```text
SEMANTIC       TEMPLATE GRAPH       TOOL/CUPTI IDS       REPLAY

Layer18/A9 → Graph G14/N17 → Local 17              → Exec N81
                              Tools 991                graphNode 81
                              CUPTI 4401               sourceNode 4401
                                  │
                                  └── CALIBRATED_EXACT
```

若三種 ID不相等但 mapping穩定：

```text
Local 17
Tools 991
CUPTI 4401
→ tuple mapping ✓
```

而不是顯示錯誤。

錯誤狀態：

- `CUDA_API_CALLED_INSIDE_CUPTI_CALLBACK`
- `NODE_NAMESPACE_UNCALIBRATED`
- `SOURCE_LINEAGE_UNRESOLVED`
- `NODE_DESTROYED_BEFORE_CALIBRATION`
- `GRAPH_UPDATE_VERSION_MISMATCH`
- `TOPOLOGY_VERSION_MISMATCH`

使用者點 Replay kernel後，可以一路回溯：

```text
Replay Kernel
→ sourceGraphNodeId
→ CUPTI capture node ID
→ namespace tuple
→ template node
→ semantic token
→ Layer / Attention invocation
→ KV read-set
```

## Code / GitHub

### NVIDIA / CUDA / CUPTI

值得持續讀：

- CUPTI `cuda_graphs_trace` sample：官方文件指出此 sample示範 graph node launch與 node creation API correlation。
- CUPTI Activity API：`cuptiGetGraphNodeId`, `cuptiGetGraphId`, `cuptiGetGraphExecId`。
- CUDA Driver Graph API：`cuGraphGetNodes`, `cuGraphGetId`, `cuGraphNodeGetLocalId`, `cuGraphNodeGetToolsId`, `cuGraphGetEdges`。

### vLLM

接續上一輪已確認的 hooks：

- `vllm/forward_context.py`
- CUDA Graph manager / `cudagraph_utils.py`
- attention custom op / `unified_attention_with_output`
- Triton attention backend

下一個 source task不是再找 layer name，而是找 **capture safe point**：graph capture完成、graph仍存活、且不在 CUPTI callback內的位置，插入 calibration hook。

## Papers / Technical Reports

本輪沒有為了數量重複塞入新論文。這一輪的核心缺口是 CUDA/CUPTI API semantics，官方 CUDA 13.4/CUPTI 13.4文件比二手論文更具決定性。

前輪值得繼續追的 Model2Kernel方向仍保留：model invocation constraint → kernel argument verification，後續可與本輪 semantic binder整合成 `semantic operation → kernel identity → argument contract`。

## 與歷史研究比較

上一輪結論：

```text
SemanticToken
→ GRAPHNODE_CREATED
→ Tools/Local Node Identity
→ Replay sourceGraphNodeId
```

本輪修正為：

```text
SemanticToken
→ GRAPHNODE_CREATED
→ CUPTI-native Capture Node Identity
→ Replay sourceGraphNodeId

AND separately:

safe-point CUDA graph inspection
→ LocalId / ToolsId
→ namespace calibration
```

因此本輪不是重複 node identity，而是消除一個可能造成 deadlock/hang 的 instrumentation設計錯誤，並把 `NodeIdNamespaceCalibrationWitness` 變成可測試 contract。

## Unknown / Open Questions

1. CUDA 13.4 current `cuda_graphs_trace` sample在 `GRAPHNODE_CREATED` callback內實際使用哪些 CUPTI identity APIs？哪些 API被 NVIDIA sample視為 callback-safe？需要直接取得 sample source逐行確認。
2. `cuptiGetGraphNodeId(node)` 與 Kernel13 `sourceGraphNodeId` 在 clone、`GraphExecUpdate`、node parameter update後的 mapping是否始終可由 source lineage一對一還原？
3. vLLM capture完成到 graph instantiate之間是否存在穩定 framework safe point，可做一次 namespace enumeration而不干擾 capture/replay與效能？

## 下一輪研究

```text
NVIDIA cuda_graphs_trace sample source
→ callback-safe API whitelist
→ cuptiGetGraphNodeId exact usage
→ vLLM capture-complete safe point
→ graph enumeration prototype
→ Local/Tools/CUPTI ID tuple
→ GraphExec update/version semantics
→ Kernel13 source lineage
→ CaptureOriginNodeBindingWitness
→ KernelSetCompletionWitness
→ EffectiveKVReadSet
→ RuntimeKVReadWitness
→ ZERO / REPLACE KV
→ ΔAttentionOutput
→ ΔResidual
→ ΔLogit
→ ΔGeneratedToken
→ ΔAgentAction
```

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
CallbackApiSafetyWitness
ForbiddenCudaApiInCallbackState
CUPTICaptureNodeIdentity
NodeNamespaceTuple
GraphInspectionSafePoint
NamespaceCalibrationEpoch
GraphExecEpoch
SourceLineageVersion
NodeDestroyedBeforeCalibrationState
GraphUpdateVersionMismatchState
```

### Edges

```text
CUgraphNode
→ cuptiGetGraphNodeId
→ CUPTICaptureNodeIdentity

ReplayNode
→ sourceGraphNodeId
→ CUPTICaptureNodeIdentity

GraphInspectionSafePoint
→ LocalNodeId
→ NodeNamespaceTuple

GraphInspectionSafePoint
→ ToolsNodeId
→ NodeNamespaceTuple

CUPTICaptureNodeIdentity
→ NodeNamespaceTuple

ToolsNodeId
--not_assumed_equal→ CUPTICaptureNodeIdentity

LocalNodeId
--not_assumed_equal→ ToolsNodeId

CUPTIResourceCallback
--must_not_assume_safe→ CUDA_Runtime_Driver_API

GraphExecUpdate
→ increments
→ SourceLineageVersion
```

## 本輪結束判定

**缺哪一層：** NVIDIA official `cuda_graphs_trace` sample的 callback-safe identity extraction逐行證據，以及 vLLM graph capture-complete safe point。

**哪個節點最淺：** `CallbackApiSafetyWitness` / `NodeIdNamespaceCalibrationWitness` 的真實 CUDA 13.4 production instance。

**哪個概念仍只是名詞：**跨 process/rank 的 `GlobalSemanticExecutionTape`，以及尚未實測的 `GraphInspectionSafePoint`。

**哪個系統值得讀原始碼：** NVIDIA CUPTI `cuda_graphs_trace` sample + vLLM CUDA Graph manager。

**哪篇論文需追引用：** Model2Kernel；下一階段要把 model invocation constraints接到本輪的 exact kernel/node provenance。

**哪個概念最適合視覺模擬：** `SemanticToken → Capture Node → Local/Tools/CUPTI Namespace → Replay source lineage → KV Read Set`。

**哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Callback-Safe Semantic Binder + Versioned Graph Topology Binder + Causal Evidence Gate + Tool Executor`。

## 本輪核心結論

真正可靠的 semantic-to-GPU provenance不能建立在「某幾個 CUDA node ID看起來一樣」上，也不能為了取得 ID 而在 CUPTI callback內任意反呼 CUDA API。更嚴格的架構是：**用 CUPTI-native graph-node identity作 capture/replay provenance主鏈，再於 callback外的安全點取得 CUDA Local/Tools IDs做 namespace calibration。** 這讓 Hermes 往 `Layer/Op semantic event → capture-origin graph node → replay GPU execution → physical KV read → model output` 又向下閉合了一層，同時避免 profiler instrumentation本身改變或鎖死被觀測系統。