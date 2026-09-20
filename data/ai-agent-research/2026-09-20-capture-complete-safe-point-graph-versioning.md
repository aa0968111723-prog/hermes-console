# 【AI Agent × Multimodal Research Report】

**時間：2026-09-20 21:51（Asia/Taipei）**

**本輪主題：Capture-Complete Safe Point × Graph Inspection × Topology/Content Version Separation**

## 本小時新發現

本輪延續前一輪 `CallbackApiSafetyWitness + NodeIdNamespaceCalibrationWitness`，不重複已確認的 CUPTI callback safety，而是追到 vLLM/PyTorch CUDA Graph capture 的真正「callback 外安全點」。current vLLM `CUDAGraphWrapper.__call__()` 在 `with torch.cuda.graph(...)` 結束後，才把 `entry.output` 與 `entry.cudagraph` 固化並增加 capture counter；這提供一個 framework-side **CaptureCompleteSafePoint**：此時 capture 已結束，且 graph object 已進入 cache entry，可在不把 CUDA Driver/Runtime API 塞進 CUPTI resource callback 的前提下進行 graph inspection。

同時確認 current vLLM 的 graph cache key 不是 layer identity，而是 `BatchDescriptor` / `BatchExecutionDescriptor`。descriptor 包含 CUDA Graph mode、token 數、request 數、uniform token count、max query len、active LoRA 數、microbatch 數等。因此 topology provenance 至少必須包含 descriptor identity，否則同一 model/layer 在不同 batch shape、LoRA 或 DBO 狀態下可能對應不同 graph artifact。

CUDA 13.4 Driver API 明確提供 `cuGraphNodeGetLocalId()`，且官方保證 `graphId + localNodeId` 可唯一識別 template graph node；CUPTI 13.4 per-node activity另外提供 `sourceGraphId/sourceGraphNodeId`，表示 execution node 從哪個 graph/node instantiated 或最後 updated。這使「capture-complete enumeration → template node table → replay source lineage」成為比 callback 內呼叫 CUDA API更安全的主路徑。

## 本小時最重要 5 個發現

### 1. CaptureCompleteSafePoint 是 production instrumentation 的正確分界

**已確認工程實作：** vLLM `CUDAGraphWrapper` 在 `with torch.cuda.graph(...)` 內執行 runnable；context 離開後才保存 `entry.cudagraph`。因此 capture 結束後可以建立 sidecar hook：

`SemanticCaptureEpoch → torch.cuda.graph exit → CaptureCompleteSafePoint → graph inspection → GraphTopologySideTable`

**重要性：** 前一輪已確認 CUPTI callback 中任意呼叫 CUDA API可能 hang；safe-point design把 callback hot path與 graph inspection徹底分離。

**限制：** PyTorch `torch.cuda.CUDAGraph` 是否直接暴露所有底層 `CUgraph` inspection handle仍需 prototype 驗證；必要時需 C++/CUDA sidecar。

### 2. Graph cache identity 是 descriptor-driven，不是 layer-driven

current vLLM `CUDAGraphEntry` 以 `BatchDescriptor` 為 key；GPU worker的 `BatchExecutionDescriptor`又包含 mode、tokens、requests、uniform token count、max query len、LoRA case、ubatch count。

因此：

`Same LayerSemanticIdentity != Same CapturedGraphArtifact`

應新增：

`GraphArtifactIdentity = ModelEpoch + BatchDescriptorIdentity + CaptureEpoch + GraphTopologyVersion + ExecutionSubstrateEpoch`

**限制：** descriptor仍不是完整 numerical/content identity；它描述 dispatch/capture shape，不代表 token/KV內容。

### 3. Template topology identity 與 runtime content identity 必須永久分離

vLLM debug path只檢查 replay tensor `data_ptr()` 與 capture時相同。這證明 CUDA Graph replay依賴穩定地址，但不證明該地址內的 token、slot mapping、BlockTable、KV lease或metadata仍屬於同一 epoch。

所以：

`GraphArtifactIdentity --does_not_prove→ RuntimeContentEpoch`

`CapturedBufferAddressIdentity --does_not_prove→ KVContentIdentity`

RuntimeKVReadWitness 必須同時 join topology side與content side。

### 4. CUDA 13.4 source lineage讓 graph update 成為一等版本事件

CUPTI Kernel13 的 `sourceGraphId/sourceGraphNodeId` 表示 node的來源或最後更新來源。因此 GraphExec update不能只視為參數微調；對 provenance而言它可能改變 source lineage。

新增：

`GraphExecUpdateEpoch → SourceLineageVersion → ReplayNodeIdentity`

如果 replay activity 的 source lineage不符合目前 topology side table，必須標記 `SOURCE_LINEAGE_VERSION_MISMATCH`，不能沿用舊 semantic binding。

### 5. Production trace與 calibration trace應是雙層模式

CUPTI graph-level trace降低 overhead但沒有 node visibility；per-node trace提供 graphNode/sourceGraphNode lineage。兩者互斥。因此 production architecture應是：

`Production: GraphTrace2 → GraphReplayWitness → GraphArtifactIdentity`

`Calibration/Sample: Kernel13 → sourceGraphNodeId → TemplateNode → Semantic Binding`

再把 calibration結果版本化保存，而不是每個 request都開高成本 node tracing。

## Architecture Breakdown

```text
ForwardContext
  ↓
BatchDescriptorIdentity
  ↓
CUDAGraphWrapper
  ├─ cache miss → CaptureEpoch
  │              ↓
  │        torch.cuda.graph(...)
  │              ↓
  │       runnable execution
  │              ↓
  │      CaptureCompleteSafePoint
  │              ↓
  │      Graph Inspection Sidecar
  │              ↓
  │      TemplateNodeTable
  │              ↓
  │      GraphTopologyVersion
  │
  └─ cache hit → ReplayEpoch
                 ↓
             GraphTrace2
                 ↓
        optional Kernel13 sample
                 ↓
     sourceGraphId/sourceGraphNodeId
                 ↓
          TemplateNodeTable
                 ↓
          Semantic Layer/Op
```

這個 architecture把三種 epoch分開：

1. `CaptureEpoch`：graph template何時出生。
2. `GraphExecUpdateEpoch`：executable graph何時被更新。
3. `RuntimeContentEpoch`：本次 replay 的 token/KV/metadata內容。

三者不得互相替代。

## Bottom-Level Logic

### Capture path

`BatchDescriptor → cache lookup → graph miss → allocate CUDAGraph → enter capture → CUDA operations become graph nodes → exit capture → graph finalized → cache graph → safe-point enumeration → node IDs/dependencies/params fingerprint → topology version`

### Replay path

`Runtime ForwardContext → same compatible descriptor → cached graph → stable input addresses → replay → CUPTI graph launch → optional node activity → source lineage → topology lookup → semantic op → runtime metadata/content epoch join`

### RuntimeKVReadWitness 最小條件

```text
RuntimeKVReadWitness =
  SemanticOpIdentity
  + GraphArtifactIdentity / EagerLaunchIdentity
  + SourceLineageVersion
  + KernelSetCompletionWitness
  + EffectiveKVReadSet
  + PhysicalKVIdentity
  + KVLeaseEpoch
  + RuntimeContentEpoch
  + NumericalReliabilityEpoch
```

缺任一關鍵版本時，只能標記 candidate，不升級為 causal witness。

## Visual Simulation Idea

### Graph Artifact × Runtime Content Dual-Timeline Viewer

左側顯示 topology lifecycle：

```text
Capture C17
  ↓
Topology V4
  ├─ N17 Attention Core
  └─ N18 Reduce
  ↓
GraphExec E4
  ↓ update
GraphExec E5 / SourceLineage V5
```

右側顯示每次 replay 的 content lifecycle：

```text
Replay R201 → TokenEpoch T91 → KVLease K33 → BlockTable B44
Replay R202 → TokenEpoch T92 → KVLease K34 → BlockTable B45
```

使用者點 N17時，可看到它在不同 replay中「拓撲相同但內容不同」的實際 KV read set。若 graph topology相同但 content epoch變化，UI不應誤顯示成同一 causal state。

## Code / GitHub

### vLLM 值得看的核心檔案

- `vllm/compilation/cuda_graph.py`
  - `CUDAGraphEntry`
  - `CUDAGraphWrapper.__call__`
  - capture/replay cache path
  - input-address replay invariant
- `vllm/v1/worker/gpu/cudagraph_utils.py`
  - `BatchExecutionDescriptor`
  - `CudaGraphManager`
  - capture candidate construction
  - FULL / PIECEWISE / ubatch / LoRA dispatch dimensions
- 下一輪：`vllm/compilation/breakable_cudagraph.py`
  - capture segment lifecycle
  - eager break boundary
  - piecewise graph ownership

### NVIDIA / CUDA

- CUPTI 13.4 CUDA Graph tracing: https://docs.nvidia.com/cupti/main/main.html
- CUpti_ActivityKernel13: https://docs.nvidia.com/cupti/13.4.0/api/structCUpti__ActivityKernel13.html
- CUDA Driver Graph Management: https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/group__CUDA__GRAPH.html
- CUDA Graph Programming Guide: https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/cuda-graphs.html

## Papers / Technical Work

本輪不以增加不相關論文數量為目標；目前真正的研究缺口是 runtime provenance instrumentation。後續仍應追 Model2Kernel 類「model invocation constraints → kernel verification」工作，並比較它們如何處理 dynamic runtime state、kernel arguments與版本化 execution evidence。

## 已確認 / 推論 / 假說分級

**已確認（官方/原始碼）：**
- vLLM graph cache由 batch descriptor驅動。
- vLLM capture context結束後保存 CUDAGraph並供後續 replay。
- replay debug invariant檢查 tensor address。
- CUDA `graphId + localNodeId` 可唯一識別 template node。
- CUPTI 13.4提供 replay node的 source graph lineage。
- graph-level trace與per-node trace是不同成本/可見性模式。

**合理工程推論：**
- `torch.cuda.graph` context exit後是比 CUPTI resource callback更適合 graph inspection 的 framework safe point。
- production應採低成本 graph trace + 抽樣 node calibration。

**尚未驗證假說：**
- PyTorch `torch.cuda.CUDAGraph` 能否在不改 PyTorch 的情況下直接取得足夠的底層 CUgraph/CUgraphExec identity。
- localNodeId/toolsNodeId/CUPTI sourceGraphNodeId 在 clone/update後的精確 namespace mapping。
- Breakable CUDA Graph每個 piece是否都能以同一 safe-point hook穩定取得其 graph artifact identity。

## Unknown / Open Questions

1. PyTorch CUDAGraph object到 `CUgraph/CUgraphExec` 的最小、穩定、非侵入式 extraction path是什麼？
2. `cudaGraphExecUpdate` / individual node update後，哪些更新會改變 CUPTI `sourceGraphNodeId`，哪些只改參數而保持來源 identity？
3. PIECEWISE / Breakable capture下，如何把每個 graph piece與 Layer/Op semantic scope做 deterministic ownership，而不是只靠 capture順序？

## Knowledge Graph 新增 Node / Edge

### Nodes

- `CaptureCompleteSafePoint`
- `GraphArtifactIdentity`
- `BatchDescriptorIdentity`
- `TemplateNodeTable`
- `GraphInspectionSidecar`
- `GraphExecUpdateEpoch`
- `SourceLineageVersion`
- `RuntimeContentEpoch`
- `TopologyContentSeparationWitness`
- `SourceLineageVersionMismatchState`
- `GraphArtifactCalibrationState`

### Edges

```text
BatchDescriptorIdentity
→ selects_or_creates
→ GraphArtifactIdentity

CaptureCompleteSafePoint
→ enables_safe_inspection_of
→ TemplateNodeTable

TemplateNodeTable
→ versioned_as
→ GraphTopologyVersion

GraphExecUpdateEpoch
→ may_change
→ SourceLineageVersion

ReplayNodeIdentity
→ source_lineage
→ TemplateNodeTable

GraphArtifactIdentity
--does_not_prove→ RuntimeContentEpoch

CapturedBufferAddressIdentity
--does_not_prove→ KVContentIdentity

RuntimeContentEpoch
+ GraphArtifactIdentity
+ SourceLineageVersion
→ constrain
→ RuntimeKVReadWitness
```

## 與歷史研究比較

前一輪解決「callback裡不能安全亂呼叫 CUDA API」，本輪補上「那應該在哪裡做 inspection」：答案是 framework capture-complete safe point。前一輪聚焦 ID namespace calibration；本輪再加上一個更根本的維度：即使 node identity完全校準，**topology identity仍不能代表 runtime content identity**。因此下一階段不能只繼續追 GPU node ID，而必須把 replay-time ForwardContext / BlockTable / slot mapping / KV lease的 content epoch同步接入 execution tape。

## 本輪結束判斷

**缺哪一層：** `CaptureCompleteSafePoint → native CUgraph/CUgraphExec inspection handle` 的實際 prototype。

**哪個節點最淺：** `GraphInspectionSidecar` production instance。

**哪個概念仍只是名詞：** `GlobalSemanticExecutionTape` 與跨 rank 的 `RuntimeContentEpoch` 對時。

**哪個系統值得讀原始碼：** vLLM `breakable_cudagraph.py` + PyTorch `torch.cuda.CUDAGraph` C++ binding + NVIDIA CUDA graph samples。

**哪篇論文需追引用：** Model2Kernel，特別是 model invocation constraint如何映射到 kernel argument verification。

**哪個概念最適合視覺模擬：** `Graph Artifact × Runtime Content Dual-Timeline Viewer`。

**哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Versioned Graph/Content Binder + Graph/Eager Evidence Adapter + Causal Evidence Gate + Tool Executor`。

## 下一輪研究

```text
PyTorch CUDAGraph binding
→ CUgraph/CUgraphExec handle extraction
→ CaptureCompleteSafePoint prototype
→ graph/node enumeration
→ Local/Tools/CUPTI namespace tuple
→ GraphExec update experiment
→ sourceGraphNodeId calibration
→ Breakable/Piecewise piece ownership
→ RuntimeContentEpoch join
→ EffectiveKVReadSet
→ RuntimeKVReadWitness
→ ZERO / REPLACE KV
→ ΔAttentionOutput
→ ΔResidual
→ ΔLogit
→ ΔGeneratedToken
→ ΔAgentAction
```

本輪的核心推進：**把 instrumentation 從「callback 安全性」推到「capture 完成後的安全 graph inspection」，並正式把 CUDA Graph topology 的版本生命週期與每次 replay 的 token/KV/content生命週期拆成兩條必須重新 join 的 provenance 軸。**