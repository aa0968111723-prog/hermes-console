# 【AI Agent × Multimodal Research Report】

時間：2026-09-20 17:50（Asia/Taipei）

主題：CUDA Graph Capture Topology × Stable Node Identity × Semantic Replay Binding

## 本小時新發現

本輪承接上一輪 `GraphTopologyBinding` 缺口，直接追 vLLM current CUDA Graph wrapper、FULL/PIECEWISE execution design、CUDA/CUPTI graph identity semantics。核心進展：不能把 replay-time `graphId/graphNodeId` 當作唯一長期 semantic identity；CUDA 13.4 的 `sourceGraphId/sourceGraphNodeId` 與 CUDA graph resource callbacks提供了更適合的 capture-origin lineage。Hermes 應建立 capture-time `GraphTopologySideTable`，再以 source lineage 對 replay node做 semantic binding。

## 本小時最重要 5 個發現

### 1. vLLM CUDAGraphWrapper 的 cache key 是 BatchDescriptor，而不是 layer semantic identity
current `vllm/compilation/cuda_graph.py` 中，每個 wrapper用 `concrete_cudagraph_entries[BatchDescriptor]` 保存 CUDAGraphEntry；第一次遇到 descriptor時 capture，之後直接 `entry.cudagraph.replay()`。FULL wrapper包整個 model；PIECEWISE wrapper則包編譯切出的片段。因此 replay-time只有 graph entry/batch descriptor，layer semantic topology已經被固化在 capture結果內。

### 2. Piecewise capture確實可能近似「每 layer 多個 graph片段」
source comment明確指出 piecewise mode在 model forward中會 capture many pieces，roughly one per layer；因此 capture topology不是單一 graph，而是 `BatchDescriptor -> ordered graph segments -> nodes`。Hermes應保存 `GraphSegmentSemanticIdentity`，不能只保存 graphId。

### 3. Replay memory identity是 correctness invariant之一
vLLM debug mode會記錄 capture時 tensor `data_ptr()`，replay前確認 input addresses完全一致。CUDA Graph replay會重用 capture時記錄的 memory addresses，因此 semantic content epoch與buffer address identity必須分開：地址相同不代表內容 epoch相同。

### 4. CUPTI 13.4 sourceGraph lineage比單純 graphNodeId更適合跨 clone/update追蹤
CUPTI per-node activities新增 `sourceGraphId/sourceGraphNodeId`，表示 node從哪個 graph/node instantiated或last updated。CUDA resource callback的 `CUpti_GraphData`同時提供 graph/originalGraph、node/originalNode、graphExec。這使 capture-origin topology side-table可以與 replay activity lineage join，而不是假設 graphNodeId永遠穩定。

### 5. Graph-level trace與per-node trace互斥，production verifier需雙層策略
Graph-level trace降低 overhead但不提供node visibility；per-node trace可取得 graphId/graphNodeId/source lineage。Hermes應 production常態收 graph-level replay witness，抽樣/診斷時切 per-node/HES，並把 capture topology side-table持久化，使低成本 replay witness仍可指向已校準 topology版本。

## Architecture Breakdown

```text
Capture Epoch C17
  BatchDescriptor B
  RuntimeMode FULL/PIECEWISE
        |
        v
GraphTopologySideTable V17
  Segment S0 -> semantic region/layers
  Segment S1 -> semantic region/layers
        |
        +-> sourceGraph Gsrc
             |- sourceNode N1 -> op semantic
             |- sourceNode N2 -> op semantic

Replay Epoch R93
  external semantic step E441
        |
        v
  cudaGraphLaunch correlation C990
        |
        v
  GraphTrace graphId Gexec
        |
        v
 sampled per-node activity
  graphId / graphNodeId
  sourceGraphId / sourceGraphNodeId
        |
        v
 CaptureOriginNodeBinding
        |
        v
 Layer/Op Semantic Identity
```

## Bottom-Level Logic

### Capture
`BatchDescriptor -> CUDAGraphEntry -> torch.cuda.graph(current_stream) -> runnable kernels -> graph topology -> GraphTopologyVersion`

### Replay
`BatchDescriptor -> cached CUDAGraphEntry -> sync dependencies -> CUDAGraph.replay -> cudaGraphLaunch -> GraphTrace -> optional node activities`

### Stable semantic binding
`ReplayNode(graphId,nodeId) -> sourceGraph lineage -> CaptureOriginNode -> GraphTopologySideTable -> SemanticOp/Layer`

禁止直接：`graphNodeId -> LayerName`。

### Memory/content separation
`CapturedBufferAddressIdentity != RuntimeContentEpoch`。
同一 address可在不同 step被覆寫新 token/block-table/metadata，因此 RuntimeKVReadWitness仍需 ContentEpoch/KVLeaseEpoch。

## Visual Simulation Idea

### Capture Topology → Replay Lineage Microscope

左側 Capture：顯示 FULL/PIECEWISE segments、BatchDescriptor、source graph/node、layer/op。右側 Replay：顯示 graph launch、graphId/nodeId、sourceGraph lineage。中央以 lineage edges連接。

異常：`TOPOLOGY_VERSION_MISMATCH`、`SOURCE_NODE_UNRESOLVED`、`GRAPH_ENTRY_DESCRIPTOR_MISMATCH`、`BUFFER_ADDRESS_CHANGED`、`CONTENT_EPOCH_UNBOUND`。

## Code / GitHub

重點原始碼：
- `vllm/compilation/cuda_graph.py`: `CUDAGraphWrapper`, `CUDAGraphEntry`, capture/replay與input-address invariant。
- `vllm/v1/worker/gpu/cudagraph_utils.py`: FULL capture、attention metadata shaping、breakable/piecewise manager。
- vLLM CUDA Graph design docs：FULL wrapper在整個model外；PIECEWISE wrapper在compiled regions內。
- NVIDIA CUPTI CUDA Graph trace/resource callbacks：graph/node lineage與graphExec lifecycle。

## Papers / Technical Sources

本輪優先官方/runtime source。延續追蹤 2026 `Hybrid JIT-CUDA Graph Optimization for Low-Latency Large Language Model Inference`：其 static graph + dynamic JIT partition支持「execution topology本身是runtime architecture的一部分」，但其單GPU batch-1結果不能外推到vLLM continuous batching。

## Unknown / Open Questions 1-3

1. vLLM FULL graph內 layer boundaries如何在capture時最小侵入地標註到CUDA graph node creation callbacks？
2. graph update/clone後 `sourceGraphNodeId` 是否足以維持所有vLLM replay topology lineage，哪些update會需要新TopologyVersion？
3. PIECEWISE + tensor parallel + microbatch時，segment ordering與rank-local graph identity如何合成global semantic execution tape？

## 下一輪研究

`capture-time semantic marker -> CUPTI resource callback -> graph/node creation lineage -> GraphTopologySideTable -> graphExec identity -> replay GraphTrace -> sourceGraphNodeId join -> CanonicalLaunchWitness -> KernelSetCompletionWitness -> EffectiveKVReadSet -> RuntimeKVReadWitness -> controlled KV intervention -> ΔAttention -> ΔResidual -> ΔLogit -> ΔToken -> ΔAgentAction`

## Knowledge Graph 新增 Node / Edge

Nodes:
- `GraphTopologySideTable`
- `GraphTopologyVersion`
- `GraphSegmentSemanticIdentity`
- `CaptureOriginGraphIdentity`
- `CaptureOriginNodeIdentity`
- `ReplayGraphIdentity`
- `ReplayNodeIdentity`
- `SourceGraphLineageWitness`
- `CaptureOriginNodeBinding`
- `GraphExecLifecycleWitness`
- `CapturedBufferAddressIdentity`
- `GraphEntryBatchDescriptorIdentity`
- `TopologyVersionMismatchState`

Edges:
- `BatchDescriptor -> selects -> CUDAGraphEntry`
- `CUDAGraphEntry -> owns -> GraphTopologyVersion`
- `GraphTopologyVersion -> contains -> GraphSegmentSemanticIdentity`
- `CaptureOriginNodeIdentity -> semantic_maps_to -> LayerOrOpIdentity`
- `ReplayNodeIdentity -> source_lineage -> CaptureOriginNodeIdentity`
- `SourceGraphLineageWitness -> enables -> CaptureOriginNodeBinding`
- `CapturedBufferAddressIdentity --does_not_prove-> RuntimeContentEpoch`
- `ReplayGraphIdentity --does_not_prove-> LayerSemanticIdentity`

## 與歷史研究比較

上一輪確認 External Correlation只能直接把semantic scope綁到CUDA API/graph launch，Graph node semantic identity仍缺capture topology。本輪把缺口往下閉合：vLLM graph entry以BatchDescriptor cache並重播；piecewise graph是多segment；CUPTI 13.4 sourceGraph lineage與resource callback提供capture-origin mapping所需資料。因此 `GraphTopologyBinding` 不應是replay時臨時猜測，而應是capture時建立、replay時驗證的versioned side-table。

### 本輪結束判斷
- 缺哪一層：capture-time semantic layer/op marker如何與CUPTI graph-node creation callback精確同時對齊。
- 最淺節點：`CaptureOriginNodeBinding` production instance。
- 哪個概念仍只是名詞：跨rank/microbatch的 `GlobalSemanticExecutionTape`。
- 哪個系統值得讀原始碼：vLLM FULL capture manager、CUPTI `cuda_graphs_trace` resource callbacks、CUDA graph node ID APIs。
- 哪篇論文需追引用：Hybrid JIT-CUDA Graph Optimization，追static/dynamic partition與graph topology reuse後續。
- 最適合視覺模擬：Capture Topology → Replay Lineage Microscope。
- 最值得實作的 Agent 架構：`State-grounded Planner + Runtime Provenance Verifier + Versioned Graph Topology Binder + Graph/Eager Evidence Adapter + Causal Evidence Gate + Tool Executor`。

## 證據分類

- 已確認事實：vLLM wrapper按BatchDescriptor cache graph entry；capture記錄input addresses並可於debug replay驗證；piecewise source註解說明一次forward會capture many pieces；CUPTI per-node trace有graphId/nodeId與CUDA 13.4 source lineage。
- 官方資訊：vLLM CUDA Graph design、NVIDIA CUPTI 13.4、CUDA Graph APIs。
- 論文結果：Hybrid JIT-CUDA Graph在其指定LLaMA-2 7B/single-GPU/batch-1條件下報告TTFT改善，不能泛化。
- 工程設計建議：versioned GraphTopologySideTable + production graph-level trace + sampled per-node calibration。
- 合理推論：sourceGraph lineage是比raw replay graphNodeId更穩定的semantic join key。
- 尚未驗證假說：此capture-time instrumentation可在vLLM production維持足夠低overhead且不改變capture topology。