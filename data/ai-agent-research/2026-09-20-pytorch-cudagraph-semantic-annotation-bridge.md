# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-20 22:52（Asia/Taipei）

## 本小時新發現

本輪延續上一輪 `CaptureCompleteSafePoint → GraphInspectionSidecar → sourceGraphNodeId` 缺口，但出現一個比自行打造 sidecar 更重要的新事實：**PyTorch main 已經在實作一條非常接近 Hermes 所需的 CUDA Graph semantic annotation bridge。**

這不是產品新聞，而是直接閱讀 PyTorch main 原始碼後得到的 runtime architecture 發現。`torch/cuda/graphs.py` 現在提供 capture-start/end、post-instantiate、replay-start/end、destroy hooks；`CUDAGraph` 還暴露 `raw_cuda_graph()` / `raw_cuda_graph_exec()` 的生命週期入口。更關鍵的是 `torch/cuda/_graph_annotations.py` 與 `_graph_node_callbacks.py` 已把 semantic scope → capture graph node → toolsId → profiler trace/sourceGraphNodeId 做成實際工程路徑。

### 與歷史研究比較

上一輪我們認為仍需自己完成：

`CaptureCompleteSafePoint → native CUgraph/CUgraphExec inspection handle → node enumeration → namespace calibration`

本輪修正為：

`PyTorch capture hooks/raw handles + graph annotations` 已經覆蓋其中很大一段，因此 Hermes 應優先**適配 upstream substrate**，而不是立刻 fork 一套重複 profiler。

同時上一輪的「CUPTI callback 中禁止 CUDA Runtime/Driver API」必須更精確：NVIDIA 官方仍明確說，除非文件特別允許，CUPTI callback 內呼叫 CUDA Runtime/Driver API 是 unsupported 且可能 hang；但 PyTorch main 的 `_graph_node_callbacks.py` 實際在 `GRAPHNODE_CREATED` resource callback 裡呼叫 `cudaGraphNodeGetToolsId(graph_data.node)`。因此目前存在**官方一般規則 vs upstream 工程實作**的衝突，不能把 PyTorch 實作自動升格成 NVIDIA 保證安全的 contract。

---

# 本小時最重要 5 個發現

## 1. PyTorch 已提供真正的 Capture-Complete Inspection Window

### 概念
`capture_end_pre()` / capture-end hooks。

### 底層如何運作
PyTorch C++ `CUDAGraph::capture_end_pre()` 先呼叫 `cudaStreamEndCapture(..., &graph_)`，此時 template `cudaGraph_t` 已存在；Python `capture_end()` 隨後執行 capture-end hooks，之後才 instantiate / finalize。`register_capture_end_hook()` 的文件也明確說 hook 執行時 captured `cudaGraph_t` 仍可透過 `raw_cuda_graph()` 存取。

因此 Hermes 不需要在 CUPTI resource callback 中做 graph enumeration；可以在 capture-end hook 進行：

`raw_cuda_graph → graph id → nodes → edges → node type/params → semantic topology snapshot`

### 為什麼重要
這直接把上一輪最淺的 `GraphInspectionSidecar` 從概念變成可依附的 upstream lifecycle point。

### 限制
這是 PyTorch main 的目前實作；部署版本是否已包含這些 API 必須做 feature detection，不能假設所有 stable PyTorch 都有。

### 狀態
已確認：PyTorch main source。

---

## 2. PyTorch 已有 Semantic Scope → Graph Node Annotation 機制

### 概念
`mark_kernels(annotation)`。

### 底層如何運作
`_graph_annotations.py` 的設計不是只在 profiler timeline 上畫 range，而是：

`semantic scope entry`
→ `snapshot capture frontier / publish active annotation`
→ `new CUDA graph nodes appear`
→ `identify node toolsId`
→ `record_node_annotation(tools_id, annotation)`
→ capture/exec remapping
→ Chrome/profiler trace join。

目前有兩個 discovery backend：

1. `edge_walk`：scope 結束後沿 CUDA Graph dependency edges 找出 scope 期間新增 nodes。
2. `cupti`：CUPTI `RESOURCE / GRAPHNODE_CREATED` 在 node 建立當下讀 ambient annotation，直接綁定 node。

這幾乎就是我們前幾輪抽象出的：

`OpSemanticToken → CaptureOriginNodeBindingWitness`。

### 為什麼重要
Hermes 可以把 annotation payload 擴充成：

`forward_epoch, microbatch_epoch, layer_name, op_kind, invocation_epoch, metadata_epoch, kv_cache_identity, slot_mapping_epoch`

然後使用 upstream node annotation substrate。

### 限制
PyTorch annotations 是 internal/beta-oriented implementation；版本相容性、性能與 nested child graph semantics仍需驗證。

### 狀態
已確認：PyTorch main source。

---

## 3. `toolsId` 很可能就是 CUPTI graph-node trace 的關鍵 namespace，但仍需版本化驗證

PyTorch `_graph_node_callbacks.py` 的 source comment 直接說：

`toolsId is the value CUPTI later reports as graph node id`

並用 `tools_id >> 32` 取得 graph id，用來判斷 top-level capture graph與 child/conditional body graph。

這比我們前幾輪的 `Local/Tools/CUPTI namespace tuple` 更進一步：upstream PyTorch 已把 `toolsId` 當成 profiler/CUPTI graph-node identity bridge。

但 Hermes 仍不應刪除 `NodeIdNamespaceCalibrationWitness`。理由是：

- CUDA Driver 官方保證 `graphId + localNodeId` 唯一識別 template node。
- `cuGraphNodeGetToolsId` 被定義成「tools 使用的 node id」。
- CUPTI 13.4 新增 `sourceGraphId/sourceGraphNodeId`。
- PyTorch current main 明確依賴 toolsId 與 CUPTI graph node identity的對應。

所以更好的模型是：

`ToolsNodeIdentity --upstream_asserted_maps_to→ CUPTIGraphNodeIdentity`

但 production 啟動時仍做一次 capability/version calibration，而不是跨 CUDA/PyTorch 版本永久假設。

### 狀態
官方 API + upstream engineering implementation；跨版本 universal equivalence仍需 runtime calibration。

---

## 4. `sourceGraphNodeId` 讓 semantic annotation 不必每次 re-instantiation 都重新映射

PyTorch current main已出現 `_annotation_key_by = "exec" | "source"`。

當 key_by=`source` 時，annotation 留在 capture graph key-space；consumer直接讀 CUPTI 13.4 的 `sourceGraphNodeId` 回到 capture-origin node，而不是每次 instantiate 都把 annotations重新 key 到 exec graph。

這與 Hermes 最近幾輪建立的：

`ReplayNode → source lineage → CaptureOriginNode → Semantic Op`

完全一致。

因此更穩定的 canonical path應是：

`SemanticToken`
→ `Capture toolsId`
→ `Source-keyed Annotation`
→ `GraphExec/Re-instantiation`
→ `Kernel13.sourceGraphNodeId`
→ `SemanticToken`

而 exec-keyed remap只作為舊 CUPTI/driver 或 sourceless node的 fallback。

### 為什麼重要
GraphExec 每次重新 instantiate 都可能產生新的 exec identity；source-keyed semantic identity更接近「模型語義 operation 的出生證明」。

### 限制
PyTorch source特別指出 host/memcpy 等 sourceless nodes仍可能需要 exec alias；child/conditional body graphs也有獨立 graph-id space。

---

## 5. NVIDIA 官方規則與 PyTorch CUPTI backend 存在必須顯式建模的安全衝突

NVIDIA CUPTI 13.4 Usage文件仍寫明：除非特別說明，CUPTI callback 裡呼叫 CUDA Runtime/Driver API 不受支援，可能造成 hang。

但 PyTorch `_graph_node_callbacks.py` 的 `GRAPHNODE_CREATED` handler實際執行：

`cudaGraphNodeGetToolsId(graph_data.node)`。

因此不能再寫：

`CUPTI callback → absolutely no CUDA API`

也不能反過來寫：

`PyTorch does it → officially safe`

新的 evidence state應是：

`CallbackCudaApiUse`
→ `OFFICIAL_UNSUPPORTED_GENERAL_RULE`
+
`UPSTREAM_PYTORCH_IMPLEMENTED_EXCEPTION_PATH`
→ `REQUIRES_VERSIONED_STRESS_VALIDATION`

Hermes profiler prototype若採這條 path，必須提供 edge-walk fallback；這也正好是 PyTorch自己的 architecture：`annotation_backend = edge_walk | cupti`。

---

# Architecture Breakdown

## PyTorch CUDA Graph Semantic Annotation Architecture

```text
Model / vLLM Forward
        ↓
ForwardContext
        ↓
Hermes SemanticToken
        ↓
mark_kernels({...})
        ↓
Active Annotation Scope
        ↓
┌──────────────────────────────┐
│ Node Discovery Backend       │
│                              │
│ A. edge_walk                 │
│ capture frontier             │
│ → dependency traversal       │
│                              │
│ B. CUPTI                     │
│ GRAPHNODE_CREATED            │
│ → ambient annotation         │
│ → toolsId                    │
└──────────────────────────────┘
        ↓
Capture Node Annotation Store
        ↓
Capture Graph ID / toolsId
        ↓
Instantiation
        ↓
exec-key remap
OR
source-key preservation
        ↓
Replay
        ↓
CUPTI Kernel13
 graphId / graphNodeId
 sourceGraphId / sourceGraphNodeId
        ↓
Semantic Layer / Op
        ↓
KV Metadata Epoch
        ↓
EffectiveKVReadSet
```

## Hermes integration architecture

Hermes 不應 fork PyTorch graph lifecycle；應增加 adapter：

```text
vLLM ForwardContextAdapter
→ SemanticTokenFactory
→ PyTorchGraphAnnotationAdapter
→ CUPTISourceLineageAdapter
→ RuntimeContentEpochJoiner
→ RuntimeKVReadWitness
→ CausalInterventionEngine
```

---

# Bottom-Level Logic

## 從 Layer 18 Attention 到 replay kernel

```text
ForwardContext
→ layer_name = model.layers.18.self_attn
→ metadata_epoch = M91
→ slot_mapping_epoch = S44
→ kv_cache_identity = KV18

→ SemanticToken T882

→ mark_kernels(T882)

→ Attention CUDA operations captured

→ Graph Node Created

edge_walk path:
 capture frontier
 → new dependent edges
 → graph nodes
 → cudaGraphNodeGetToolsId

or CUPTI path:
 GRAPHNODE_CREATED
 → current_annotation()
 → cudaGraphNodeGetToolsId(node)

→ Annotation[toolsId] = T882

→ instantiate/replay

→ CUPTI Kernel13
 sourceGraphNodeId = toolsId-like source identity

→ T882
→ Layer18 Attention
→ RuntimeContentEpoch R201
→ BlockTable B45
→ SlotMapping S44
→ PhysicalKVLease K33
→ EffectiveKVReadSet
→ RuntimeKVReadWitness
```

## Model reasoning vs system reasoning

這裡沒有把 GPU trace誤稱為 model reasoning。

- Model reasoning：Transformer內部 token-state transformation / attention / residual / logits。
- System reasoning：Hermes planner、runtime state machine、tool selection、verification gate。
- Provenance bridge：把 model execution 的 physical evidence連回 system-visible semantic event。

---

# Visual Simulation Idea

## Semantic Annotation → Source Lineage Microscope

四條同步時間軸：

```text
SEMANTIC
Forward E501
 └ µBatch U3
   └ Layer18
     └ Attention A9
       └ Token T882

CAPTURE
Graph G14
 ├ Tools N991  ← T882
 └ Tools N992  ← T882/reduce

EXEC
GraphExec E21
 ├ Exec N81
 └ Exec N82

REPLAY TRACE
Kernel K81
 sourceGraphNodeId=N991
      ↓
 T882 / Layer18 / A9
```

互動功能：

- 點 semantic token → highlight capture nodes / replay kernels。
- 點 kernel → 反查 sourceGraphNodeId → annotation → layer/op。
- 切換 `edge_walk` / `cupti` backend，比較 node membership 是否一致。
- 顯示 `OFFICIAL_CALLBACK_SAFETY_CONFLICT`。
- 顯示 `SOURCE_NODE_UNAVAILABLE` 時自動退回 exec-key mapping。
- 疊加 RuntimeContentEpoch，避免 topology identity 被誤認為 KV content identity。

---

# Code / GitHub

## PyTorch — 本輪最值得看的核心檔案

1. `torch/cuda/graphs.py`
   - global/per-graph capture hooks
   - capture_end_pre / capture_end_post
   - post-instantiate hooks
   - replay hooks
   - raw graph / exec lifecycle
   - source-vs-exec annotation key strategy

2. `torch/cuda/_graph_annotations.py`
   - `mark_kernels`
   - active semantic scopes
   - edge-walk discovery
   - toolsId annotations
   - sourceGraphNodeId capability/version gating

3. `torch/cuda/_graph_node_callbacks.py`
   - CUPTI RESOURCE / GRAPHNODE_CREATED
   - current ambient annotation
   - `cudaGraphNodeGetToolsId`
   - child graph handling
   - CUPTI subscriber lifecycle

4. `aten/src/ATen/cuda/CUDAGraph.cpp`
   - `capture_end_pre()`
   - `capture_end_post()`
   - `raw_cuda_graph()`
   - `raw_cuda_graph_exec()`
   - graph instantiation/replay lifecycle

## vLLM — 接點

`vllm/compilation/breakable_cudagraph.py` current main確認：

`_begin_segment → torch.cuda.CUDAGraph.capture_begin`

`_end_segment → capture_end → append replay callable`

`add_eager → end graph segment → eager fn → begin next graph segment`

因此 Breakable path可以在每個 graph segment建立獨立 semantic/topology artifact，而 eager attention則沿前幾輪建立的 EagerCorrelationAdapter。

---

# Papers

本輪沒有為了湊數加入與缺口無直接關係的新論文。這一輪的核心證據是 NVIDIA CUDA/CUPTI 官方文件與 PyTorch/vLLM current source；它們對「semantic operation如何落到 graph node identity」比高層 Agent paper更直接。

需要持續追蹤的研究方向：Model2Kernel / model-level invocation constraint → kernel-level verification，因為下一階段將從 identity binding進入 kernel argument與KV address correctness。

---

# Unknown / Open Questions

1. PyTorch CUPTI `GRAPHNODE_CREATED → cudaGraphNodeGetToolsId()` 在 NVIDIA「callback內一般不支援 CUDA API」規則下，哪些 CUDA/CUPTI/driver版本實際安全？需要 stress matrix，而不是只做一次成功測試。

2. vLLM production pinned PyTorch版本是否已包含 current-main graph annotations / replay hooks？若沒有，Hermes應採 minimal backport adapter還是 edge-walk sidecar？

3. `sourceGraphNodeId` 對 nested child graph、conditional graph、GraphExec update、host/memcpy nodes的 coverage如何形成完整 CanonicalLaunchWitness？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

- `PyTorchGraphAnnotationSubstrate`
- `CaptureEndInspectionWindow`
- `GraphAnnotationScope`
- `EdgeWalkNodeDiscoveryBackend`
- `CUPTIGraphNodeDiscoveryBackend`
- `SourceKeyedAnnotationIdentity`
- `ExecKeyedAnnotationIdentity`
- `AnnotationBackendAgreementWitness`
- `CallbackCudaApiSafetyConflictState`
- `VersionedCallbackSafetyWitness`
- `RawCudaGraphHandleWitness`
- `RawCudaGraphExecHandleWitness`
- `GraphDestroyLifecycleWitness`
- `SemanticAnnotationTraceJoin`

## Edges

```text
SemanticToken
→ published_as
→ GraphAnnotationScope

GraphAnnotationScope
→ discovered_by
→ EdgeWalkNodeDiscoveryBackend

GraphAnnotationScope
→ discovered_by
→ CUPTIGraphNodeDiscoveryBackend

CaptureNode
→ identified_by
→ ToolsNodeIdentity

ToolsNodeIdentity
→ source_keyed_join
→ CUPTI.sourceGraphNodeId

CaptureEndInspectionWindow
→ exposes
→ RawCudaGraphHandleWitness

GraphInstantiation
→ exposes
→ RawCudaGraphExecHandleWitness

NVIDIA_CallbackRule
--conflicts_with_engineering_use→
PyTorch_CUPTI_ToolsId_Query

GraphTopologyIdentity
--does_not_prove→
RuntimeContentEpoch
```

---

# 下一輪研究

下一輪不應再研究「怎麼拿 CUgraph handle」；這一層已被 current PyTorch main大幅閉合。

應改為：

```text
vLLM pinned PyTorch capability detection
→ enable_annotations / annotation_config exact API
→ Layer/Attention SemanticToken injection point
→ edge_walk vs CUPTI backend differential test design
→ toolsId/sourceGraphNodeId calibration
→ nested child graph / conditional coverage
→ Breakable graph segment identity
→ eager attention identity
→ CanonicalLaunchWitness
→ kernel argument inspection
→ BlockTable / SlotMapping / KV pointer join
→ EffectiveKVReadSet
→ RuntimeKVReadWitness
→ ZERO / REPLACE KV
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔToken
→ ΔAgentAction
```

---

# 本輪結束判定

**缺哪一層：** semantic graph-node identity 已接近閉合；目前主要缺 `Semantic Node → kernel arguments / BlockTable / KV physical address` 的 runtime join，以及 callback safety的版本化驗證。

**哪個節點最淺：** `VersionedCallbackSafetyWitness` 與 `SemanticNodeToKernelArgumentWitness`。

**哪個概念仍只是名詞：** `CanonicalLaunchWitness` 在 nested/conditional + eager/graph 混合 execution下仍未完全 production 化。

**哪個系統值得讀原始碼：** PyTorch `_graph_annotations.py`、`_graph_node_callbacks.py`、`graphs.py`，接著回到 vLLM attention / Breakable CUDA Graph integration。

**哪篇論文需追引用：** Model2Kernel；下一階段需要 model invocation constraint → kernel argument verification的做法。

**哪個概念最適合視覺模擬：** `Semantic Annotation → Capture toolsId → sourceGraphNodeId → Replay Kernel → Runtime KV Content` 雙時間軸顯微鏡。

**哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Upstream Graph Annotation Adapter + Runtime Content Joiner + Causal Evidence Gate + Tool Executor`。

## 本輪核心結論

前幾輪一直在設計「Hermes 要如何自行把模型 Layer/Op 語義綁到 CUDA Graph node」。本輪發現 current PyTorch main 已經開始提供幾乎同方向的 substrate：capture lifecycle hooks、raw graph handles、semantic graph annotations、edge-walk/CUPTI 雙 backend、toolsId、source-keyed replay lineage。

因此 Hermes 的最佳方向已從 **自建整套 CUDA Graph profiler** 改成 **把 vLLM ForwardContext / LayerInvocation SemanticToken 接到 PyTorch upstream graph-annotation substrate，再補 RuntimeContentEpoch、KV physical read evidence與 causal intervention**。這會大幅縮短從「模型語義」走到「GPU execution evidence」的距離，同時避免重複維護 PyTorch 已開始解決的 graph lifecycle 問題。