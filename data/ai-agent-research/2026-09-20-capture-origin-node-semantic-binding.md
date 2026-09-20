# 【AI Agent × Multimodal Research Report】

時間：2026-09-20 18:51（Asia/Taipei）

主題：Capture-Origin CUDA Graph Node × Semantic Marker × Versioned Execution Topology

## 本小時新發現

本輪延續上一輪 `GraphTopologyBinding → CaptureOriginNodeBinding` 缺口，不再重複 stream identity、KV slot mapping 或 2D/3D Triton kernel-set。核心結論是：**capture-time semantic binding 必須在 CUDA Graph lifecycle callback 發生時建立，而不能等 replay 後才用 kernel name 或時間鄰近反推。**

NVIDIA CUPTI 13.4 明確提供兩組互補證據：

1. Resource callback：graph/node create、clone、dependency、graphExec create/update lifecycle；`CUpti_GraphData` 提供 `graph`, `originalGraph`, `node`, `originalNode`, `nodeType`, `dependency`, `graphExec`。
2. Activity trace：replay execution 提供 `graphId`, `graphNodeId`；CUDA 13.4 增加 `sourceGraphId`, `sourceGraphNodeId`，指向 node 被建立或最後更新的來源。

因此 production provenance 應拆成：

```text
SemanticCaptureScope
→ CUPTI GRAPHNODE_CREATE callback
→ CaptureOriginNodeRecord
→ dependency edges
→ GraphExecInstantiation
→ GraphTopologyVersion
→ Replay sourceGraphId/sourceGraphNodeId
→ CaptureOriginNodeRecord
→ Semantic Op / Layer
```

### 新 GitHub / 工程發現

current vLLM `vllm/v1/worker/gpu/cudagraph_utils.py` 在 capture 時透過 `set_forward_context(...)` 同時帶入 `attn_metadata`, `cudagraph_runtime_mode`, `slot_mapping`, `batch_descriptor`, padding state；PIECEWISE 則進入 `run_pw_graph`。這表示 capture epoch 本身已有足夠的 framework-side semantic context，可以作為 `SemanticCaptureScope` 的來源。

但搜尋 current vLLM tree 未發現 `CUPTI_CBID_RESOURCE_GRAPHNODE_CREATED` instrumentation。也就是 **vLLM 現成 runtime 並沒有替我們完成 semantic-layer ↔ CUPTI graph-node binding**；Hermes 若要得到可驗證 provenance，需要 profiler/instrumentation sidecar 或 runtime hook。

另一個工程限制來自 vLLM 2026 issue #46253：PIECEWISE graph 在跨節點 GB10、host-staged NCCL 情境可因不可 capture 的 collective 失敗。這說明 `GraphTopologyVersion` 不能只由 model/batch shape 決定，也應納入 distributed execution substrate / capturability capability。

## 本小時最重要 5 個發現

### 1. Capture callback 才是 semantic binding 的正確時點

**已確認官方事實**：CUPTI 對 template graph/node 提供 create/clone/dependency callbacks；對 executable graph 提供 graphExec create/destroy/update callbacks。

**底層運作**：

```text
Layer/Op semantic scope
→ CUDA stream capture records operation
→ CUPTI GRAPHNODE_CREATE callback
→ CUpti_GraphData.node/originalNode/nodeType
→ side-table insert
```

**重要性**：這是第一次可以在 node 尚未 replay 前，就把 framework semantic scope 與 CUDA graph topology 放進同一筆 evidence。

**限制**：callback data 只在 callback invocation 期間有效，必須複製需要保留的資料；且 semantic scope 必須能在 callback thread/context 被可靠取得。

### 2. Graph node identity 必須是 versioned lineage，而不是單一 ID

**已確認官方事實**：CUDA 13.4 activity 的 `sourceGraphId/sourceGraphNodeId` 表示執行 node 的來源或最後更新來源。

因此 identity 應建模為：

```text
GraphNodeSemanticIdentity {
  capture_epoch,
  topology_version,
  source_graph_id,
  source_graph_node_id,
  node_type,
  semantic_scope_id
}
```

而不是只保存 `graphNodeId`。

**限制**：graph clone/update/instantiate 會產生 lineage；若 profiler late-attach，官方文件指出 graph tracing 存在限制。

### 3. Dependency edge 本身也是 provenance

`CUpti_GraphData` 含 dependency，CUDA graph API 也能列 nodes/edges。這意味 Hermes 不只應存 Node，還應存 capture DAG：

```text
Node A --happens-before→ Node B
Node B --feeds→ Node C
```

這能把「Layer 18 Attention kernel」從孤立 GPU event 升級成 execution topology 中的 causal predecessor/successor。

**合理推論**：若 semantic marker 能綁定 segment boundary，再利用 dependency graph，可縮小未知 node 的 semantic candidate set；但這仍不是 exact proof，除非 node creation scope 本身已被記錄。

### 4. Graph topology 取決於 execution substrate，不只 model semantics

vLLM current capture path會根據 CUDAGraph mode / batch descriptor / attention metadata進入不同 capture route。跨節點 collective 的 capturability又可能改變 graph/eager partition。

因此新增：

```text
ExecutionSubstrateEpoch
→ CapturabilityCapability
→ GraphPartitionDecision
→ GraphTopologyVersion
```

**工程實作證據**：vLLM issue #46253 報告跨節點 GB10 host-staged NCCL 被 capture 造成 PIECEWISE capture failure；這不是 universal architecture law，但足以證明 topology/capture feasibility 會受 transport substrate 影響。

### 5. Production tracing 必須在 instantiate 前啟用

CUPTI 官方文件指出 late attach（在 `cudaGraphInstantiate` 後）有 graph trace 限制，包括 activity 類型誤判與無法收集 graph trace。

因此 Hermes verifier 新增 lifecycle invariant：

```text
ProfilerAttachEpoch < GraphInstantiationEpoch
```

否則 evidence quality 必須降級為：

```text
LATE_ATTACH_UNTRUSTED_GRAPH_TOPOLOGY
```

這是 production verifier 很容易忽略、但會直接影響證據可靠度的底層條件。

## Architecture Breakdown

### Versioned Semantic Graph Topology Binder

```text
Framework Semantic Plane
LayerInvocation / Op / Attention / KV Update
        ↓
SemanticCaptureScope
        ↓
Runtime Capture Plane
set_forward_context
CUDAGraphMode
BatchDescriptor
AttentionMetadataEpoch
SlotMappingEpoch
        ↓
CUPTI Resource Callback Plane
GRAPH_CREATED
GRAPHNODE_CREATED
GRAPHNODE_CLONED
DEPENDENCY_CREATED
GRAPHEXEC_CREATED
GRAPH_NODE_UPDATED
        ↓
GraphTopologySideTable
        ↓
Replay Plane
GraphTrace / Kernel Activity
sourceGraphId/sourceGraphNodeId
        ↓
CaptureOriginNodeBinding
        ↓
CanonicalLaunchWitness
        ↓
EffectiveKVReadSet
```

### Evidence levels

```text
G0 graph replay observed
G1 topology version known
G2 source lineage known
G3 capture-origin node known
G4 semantic capture scope bound
G5 dependency topology bound
G6 layer/op semantic identity bound
G7 KV read-set bound
G8 causal intervention bound
```

## Bottom-Level Logic

### Capture-origin binding algorithm

```text
1. Before graph instantiate, enable CUPTI resource callbacks + required activities.
2. Enter SemanticCaptureScope S(layer/op, metadata_epoch, batch_descriptor, mode).
3. On GRAPHNODE_CREATED:
   a. copy CUpti_GraphData fields needed outside callback;
   b. obtain CUPTI graph/node IDs where supported;
   c. record nodeType;
   d. attach current SemanticCaptureScope ID;
   e. store originalGraph/originalNode lineage.
4. On DEPENDENCY_CREATED:
   store DAG edge.
5. On GRAPHEXEC_CREATED:
   bind executable graph to topology version.
6. On GRAPH_NODE_UPDATED / params update:
   increment or derive a new topology/content version as appropriate.
7. At replay:
   read graphId/graphNodeId/sourceGraphId/sourceGraphNodeId.
8. Join source lineage to CaptureOriginNodeRecord.
9. Join semantic node to LayerRuntimeContext/KV tensor/metadata epoch.
10. Only after this join produce CaptureOriginNodeBindingWitness.
```

### Critical distinction

```text
TopologyVersion ≠ ContentEpoch
```

A CUDA graph may replay the same topology and fixed buffer addresses while dynamic contents change every step. Therefore:

```text
GraphTopologyVersion
+ RuntimeContentEpoch
+ KVLeaseEpoch
+ MetadataEpoch
```

must remain separate axes.

## Visual Simulation Idea

### Capture DAG → Replay Lineage → Semantic Layer Microscope

Interactive four-pane view:

```text
SEMANTIC           CAPTURE DAG            GRAPH EXEC            REPLAY
Layer18 ATT  →     Source N17 ───────→    Exec V4       ←────  Node N81
                     │                                         source=N17
                     └→ Source N18 ──→                    ←──── Node N82
Layer18 Reduce →      semantic=reduce                         source=N18
```

Interactions:
- click a replay node → highlight source node → capture scope → layer/op → metadata/KV epoch;
- timeline switch between topology versions;
- show clone/update lineage;
- overlay dependency edges;
- badge evidence quality: SOURCE_BOUND / SEMANTIC_BOUND / CONTENT_BOUND / KV_READ_BOUND;
- warnings: `LATE_ATTACH`, `TOPOLOGY_VERSION_MISMATCH`, `UNBOUND_CAPTURE_SCOPE`, `SOURCE_LINEAGE_MISSING`, `CAPTURE_SUBSTRATE_CHANGED`.

## Code / GitHub

### vLLM

Worth reading next:

- `vllm/v1/worker/gpu/cudagraph_utils.py` — capture inputs, `set_forward_context`, PIECEWISE dispatch.
- Breakable / piecewise CUDA graph implementation — segment boundaries and eager breaks.
- attention custom-op wrappers — semantic operation boundary.
- distributed collective path — graph capturability and topology changes.

Observed current behavior: PIECEWISE capture enters `set_forward_context` with attention metadata, runtime mode, slot mappings, batch descriptor and padding state before `run_pw_graph`.

### NVIDIA CUPTI / CUDA

Key APIs/concepts:

- `CUPTI_CB_DOMAIN_RESOURCE`
- `CUPTI_CBID_RESOURCE_GRAPHNODE_CREATED`
- `CUPTI_CBID_RESOURCE_GRAPHNODE_CLONED`
- graph-node dependency callbacks
- graphExec create/update callbacks
- `CUpti_GraphData`
- `graphId / graphNodeId`
- `sourceGraphId / sourceGraphNodeId`
- `cudaGraphGetNodes / cudaGraphGetEdges`

## Papers

### Hybrid JIT-CUDA Graph Optimization for Low-Latency Large Language Model Inference

- Authors: Divakar Kumar Yadav, Tian Zhao
- Year: 2026
- Architecture: static transformer regions via CUDA Graph replay + dynamic regions via JIT kernels
- Contribution: demonstrates hybrid static/dynamic partition as a practical latency optimization
- Reported result: up to 66% TTFT reduction in its single-GPU, batch-size-one LLaMA-2 7B evaluation regime
- Limitation: evaluation regime is narrow and cannot be directly generalized to continuous batching / multi-node vLLM production serving
- URL: https://arxiv.org/abs/2604.23467

### CoRun: Padding is Simple and Efficient for Deterministic LLM Inference

- Authors: Shiju Zhao et al.
- Year: 2026
- Architecture: isolated prefill + fixed-shape batched decode + CUDA graphs
- Contribution: treats execution shape as a determinism control variable rather than requiring all kernels to be batch-invariant
- Importance here: reinforces that runtime shape/topology/numerical execution path are part of provenance, not merely performance metadata
- Limitation: determinism result does not itself establish semantic-to-GPU node provenance
- URL: https://arxiv.org/abs/2608.14376

### Model2Kernel: Model-Aware Symbolic Execution For Safe CUDA Kernels

- Authors: Mengting He, Shihao Xia, Haomin Jia, Wenfei Wu, Linhai Song
- Year: 2026
- Architecture: model-aware dynamic analysis → kernel argument classification → CUDA-specialized symbolic execution
- Contribution: connects model-level invocation constraints to CUDA-kernel verification
- Reported result: 353 previously unknown bugs with nine false positives in its evaluation
- Importance here: supports the broader thesis that kernel evidence becomes substantially stronger when joined with model-level invocation semantics
- URL: https://arxiv.org/abs/2603.24595

## Unknown / Open Questions

1. During PyTorch stream capture used by vLLM, can a robust semantic scope be made visible synchronously at every CUPTI graph-node creation callback without perturbing capture behavior?
2. For cloned/updated graphs, which combination of `originalNode`, CUPTI source IDs and graphExec lifecycle produces the most stable cross-replay semantic key?
3. How should topology versioning behave when only node parameters/content change but dependency topology remains identical?

## Knowledge Graph 新增 Node / Edge

### Nodes

- `SemanticCaptureScope`
- `CaptureOriginNodeRecord`
- `CaptureOriginDependencyEdge`
- `GraphExecInstantiationWitness`
- `GraphProfilerAttachEpoch`
- `LateAttachGraphTraceRiskState`
- `ExecutionSubstrateEpoch`
- `CapturabilityCapability`
- `GraphPartitionDecision`
- `GraphTopologyEvidenceLevel`
- `CaptureScopeNodeCreationWitness`
- `SourceLineageSemanticJoin`

### Edges

```text
SemanticCaptureScope
--active_during→ CaptureOriginNodeRecord

CaptureOriginNodeRecord
--depends_on→ CaptureOriginNodeRecord

CaptureOriginNodeRecord
--instantiated_into→ GraphExecInstantiationWitness

ReplayNodeIdentity
--source_lineage→ CaptureOriginNodeRecord

CaptureOriginNodeRecord
--semantic_maps_to→ LayerOrOpIdentity

ExecutionSubstrateEpoch
--constrains→ CapturabilityCapability

CapturabilityCapability
--changes→ GraphPartitionDecision

GraphPartitionDecision
--versions→ GraphTopologyVersion

GraphTopologyVersion
--does_not_prove→ RuntimeContentEpoch

CapturedBufferAddressIdentity
--does_not_prove→ RuntimeContentEpoch

LateAttachGraphTraceRiskState
--degrades→ GraphTopologyEvidenceLevel
```

## 與歷史研究比較

前一輪已證明 replay node 應沿 source lineage 回到 capture origin；本輪新增的是 **「capture origin 如何在建立當下被 semantic 化」**：使用 CUPTI resource lifecycle callback + framework SemanticCaptureScope + versioned side table。

因此研究深度從：

```text
Replay Node → Source Node
```

推進到：

```text
Framework Semantic Scope
→ Node Creation Event
→ Capture Origin Semantic Node
→ GraphExec Lifecycle
→ Replay Source Lineage
→ Semantic Execution Witness
```

## 本輪結束判定

- 缺哪一層：framework semantic scope 與 CUPTI graph-node creation callback 的 production instrumentation。
- 哪個節點最淺：`CaptureScopeNodeCreationWitness` production instance。
- 哪個概念仍只是名詞：跨 process/rank 的 `GlobalSemanticExecutionTape`。
- 哪個系統值得讀原始碼：vLLM Breakable/PIECEWISE capture manager + NVIDIA `cuda_graphs_trace` sample。
- 哪篇論文需追引用：Model2Kernel，特別是 model invocation constraints 如何下沉到 kernel argument verification。
- 哪個概念最適合視覺模擬：Capture DAG → Replay Lineage → Semantic Layer Microscope。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Runtime Provenance Verifier + Versioned Graph Topology Binder + Graph/Eager Evidence Adapter + Causal Evidence Gate + Tool Executor`。

## 下一輪研究

```text
SemanticCaptureScope
→ CUPTI graph-node create callback
→ stable node/source ID extraction
→ dependency DAG
→ graphExec instantiate/update lifecycle
→ replay source lineage join
→ Layer/Op semantic identity
→ KernelSetCompletionWitness
→ EffectiveKVReadSet
→ PhysicalKVIdentity + ContentEpoch + LeaseEpoch
→ RuntimeKVReadWitness
→ controlled ZERO / REPLACE intervention
→ ΔAttentionOutput
→ ΔResidual
→ ΔLogit
→ ΔGeneratedToken
→ ΔAgentAction
```

下一輪優先不再擴散新名詞，而是確認 **CUPTI callback 中可以保存哪些 stable IDs、PyTorch/vLLM capture 時 semantic scope 的 thread/context 邊界，以及 graph clone/update 後 identity 是否仍能無歧義回到 capture-origin node**。

## Sources

- NVIDIA CUPTI 13.4 Usage — CUDA Graph per-node trace, graph-level trace, lifecycle callbacks, late-attach limitations: https://docs.nvidia.com/cupti/main/main.html
- NVIDIA CUPTI 13.4 `CUpti_GraphData`: https://docs.nvidia.com/cupti/13.4.0/api/structCUpti__GraphData.html
- CUDA Runtime API 13.4 Graph Management: https://docs.nvidia.com/cuda/cuda-runtime-api/cuda_runtime_api/group__CUDART__GRAPH.html
- CUDA Programming Guide — CUDA Graphs: https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/cuda-graphs.html
- vLLM `cudagraph_utils.py`: https://github.com/vllm-project/vllm/blob/main/vllm/v1/worker/gpu/cudagraph_utils.py
- vLLM issue #46253 (engineering case; not treated as universal behavior): https://github.com/vllm-project/vllm/issues/46253
- Hybrid JIT-CUDA Graph Optimization: https://arxiv.org/abs/2604.23467
- CoRun: https://arxiv.org/abs/2608.14376
- Model2Kernel: https://arxiv.org/abs/2603.24595
