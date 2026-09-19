# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 23:54（Asia/Taipei）

主題：CUDA Graph Replay × CUPTI graphNodeId × Runtime Kernel Correlation

## 本小時新發現

本輪承接上一輪 `SourceReadClosureWitness → RuntimeKernelCorrelationWitness`，避免重複 Triton pointer arithmetic，專注 CUDA Graph replay 如何改變 host-launch→GPU-kernel identity。核心突破：current vLLM `CUDAGraphWrapper` 對每個 `BatchDescriptor` 保存一個 `CUDAGraphEntry`；capture 時記錄 Tensor input data_ptr，replay debug mode會驗證 input addresses相同，並在 replay 前 `get_offloader().sync_prev_onload()`，之後直接 `entry.cudagraph.replay()`。因此 replay 時不能再把 Python/Triton function call視為每輪 kernel launch witness；真正 runtime identity必須轉向 CUDA Graph execution + graph/node activity。

NVIDIA current CUPTI documentation確認：CUDA Runtime/Driver API record與GPU kernel/memcpy activity共享 `correlationId`；CUDA Graph activity另提供 `graphId`、`graphNodeId`，可把 graph launch對到 node-level GPU execution。CUPTI external correlation則可把 Hermes semantic ID 接到 CUDA API correlation ID。

新 system architecture：`Semantic Request → CUDA Graph Replay → GPU Node Execution Provenance Graph`。

新 bottom-level mechanism：`BatchDescriptor → captured graph entry → stable input addresses → offloader dependency sync → CUDAGraph.replay → CUPTI graphId/graphNodeId → kernel activity(stream,timestamps,correlationId)`。

## 本小時最重要 5 個發現

### 1. CUDA Graph replay打斷「Python call = kernel launch」假設【已確認：vLLM原始碼】
`CUDAGraphWrapper` capture runnable後，後續命中相同 BatchDescriptor直接 `entry.cudagraph.replay()`。因此 replay iteration未必重新經過原本 Triton Python launch site。Hermes若只在 `unified_attention()` 外加NVTX，可能只能穩定觀察capture/eager path，不能自動證明每次replay內部attention node的execution identity。

### 2. vLLM對graph replay有 address-stability invariant【已確認：vLLM原始碼】
current wrapper capture時保存 Tensor `data_ptr()`；DEBUG replay會assert runtime input addresses與capture時一致。這代表 CUDA Graph provenance不應把「pointer address固定」誤認為「semantic content固定」：同一static buffer address可在不同iteration承載不同 request/block-table內容。需要 `StaticBufferIdentity + ContentEpoch/BatchEpoch` 雙層 witness。

### 3. replay前存在 offloader dependency synchronization【已確認：vLLM原始碼】
在capture與replay前均呼叫 `get_offloader().sync_prev_onload()`；capture後還有 `join_after_forward()`。因此上一輪的 residency-ready/consumer-order問題，在CUDA Graph路徑至少存在明確同步hook；但這仍不等於已證明某個graph attention node讀的是哪一代block-table bytes，需要把同步完成、buffer content epoch與graph node activity對齊。

### 4. CUPTI graphId + graphNodeId是 replay node runtime identity的關鍵【已確認：NVIDIA官方文件】
CUPTI current docs說明 kernel/memcpy/memset activity可帶 `graphId` 與 `graphNodeId`；API與GPU activity以correlationId連接。故 runtime witness應從單一 `KernelLaunchWitness`升級為 `GraphExecutionWitness(graphId, launch correlation, stream, timestamps) + GraphNodeExecutionWitness(graphNodeId, kernel activity)`。

### 5. External correlation能把Hermes語義ID接進CUDA trace，但必須自行維護【已確認：NVIDIA官方文件 + 工程設計】
CUPTI external correlation允許client push/pop external ID，並產生 externalId↔CUDA correlationId record。Hermes可編碼 `request/batch_epoch/layer/block_table_epoch/lease_epoch` 的trace key，但需自行保存semantic lookup table。限制：graph capture與replay的correlation語義需實測；不能假設capture-time external ID會自動成為所有future replay node的semantic ID。

## Architecture Breakdown

```text
Hermes Request / Visual Token provenance
→ RequestEpoch
→ BatchDescriptor
→ Static Input Buffers
→ ContentEpoch(block table / slot mapping / KV lease)
→ CUDAGraphEntry
   ├─ graph capture identity
   └─ stable input-address invariant
→ sync_prev_onload()
→ CUDAGraph.replay()
→ CUDA Runtime/Driver graph launch
→ CUPTI correlationId
→ graphId
→ graphNodeId
→ GPU Kernel Activity
→ streamId + start/end timestamp
→ attention node
→ SourceReadClosure(block table → physical KV address)
→ RuntimeKVReadWitness
```

關鍵規則：`same data_ptr ≠ same semantic content`；`same graphNodeId ≠ same request epoch`；`graph replay observed ≠ target attention node identified`；`target node identified ≠ causal importance`。

## Bottom-Level Logic

### CUDA Graph semantic identity

```text
StaticBufferIdentity = (device, data_ptr, dtype, shape/stride)
ContentEpoch = runtime iteration that writes semantic contents
GraphNodeIdentity = (graphId, graphNodeId)
GraphExecutionIdentity = (graphId, launch correlationId, streamId, time interval)
RuntimeReadIdentity = GraphExecutionIdentity + GraphNodeIdentity + ContentEpoch + KVLeaseEpoch
```

這比單純 `(kernel_name, pointer)`可靠，因graph replay會重用同一capture與static addresses。

### CUPTI correlation chain

```text
HermesExternalId
→ CUpti_ActivityExternalCorrelation
→ CUDA API correlationId
→ Graph launch activity
→ graphId
→ graphNodeId
→ kernel activity
→ streamId/start/end
```

對non-graph eager path仍可：
`HermesExternalId → CUDA API correlationId → kernel activity`。

### Intervention Gate v2

```text
固定 model/backend/precision/graph variant
→ establish StaticBufferIdentity
→ stamp ContentEpoch
→ establish KVLeaseEpoch
→ baseline graph replay + CUPTI node trace
→ sham write same K/V + fence
→ replay same graph variant
→ verify target graphNodeId/runtime kernel activity
→ zero/replace K/V + fence
→ replay
→ Δattention output
→ Δresidual
→ Δlogit
→ Δgenerated action token
```

必須把「intervention寫入完成」放在 graph replay之前的 happens-before chain，並驗證 graph node讀取同一ContentEpoch。

## Visual Simulation Idea

### CUDA Graph Replay × Semantic Buffer Epoch Inspector

五層同步視圖：

```text
[Semantic]
Visual Token S417 → KV lease B91:E17

[Static Buffers]
block_table ptr 0x... → ContentEpoch C203
KV ptr 0x... → Lease E17

[Graph]
graphId G12
 ├─ node N41 memcpy
 ├─ node N57 attention ← highlight
 └─ node N58 reduce

[Runtime]
Replay R203 → correlation 8821 → stream 7
N57 start/end → kernel name/grid

[Causal]
Baseline / Sham / Zero / Replace
→ ΔAttention → ΔResidual → ΔLogit → ΔAction
```

若同pointer但content epoch不同，標 `STATIC_ADDRESS_DYNAMIC_CONTENT`；若只看到graph launch而無node trace，標 `GRAPH_LEVEL_ONLY`；若node已對上但semantic epoch未對上，標 `NODE_EXECUTION_SEMANTICS_UNBOUND`。

## Code / GitHub

值得看的核心檔案：
- vLLM `vllm/compilation/cuda_graph.py`：CUDAGraphEntry、BatchDescriptor dispatch、input address invariant、offloader sync、capture/replay。
- vLLM `vllm/v1/worker/gpu/cudagraph_utils.py`：full graph replay與offloader transition。
- vLLM `docs/design/cuda_graphs.md`：piecewise compilation與dual CUDA Graph runtime mode。
- vLLM `vllm/v1/worker/gpu_model_runner.py`：attention metadata在cudagraph capture/runtime的建構。
- NVIDIA CUPTI Activity API：correlationId、graphId、graphNodeId、external correlation。

## Papers / Technical Sources

### Efficient Memory Management for Large Language Model Serving with PagedAttention
Authors: Woosuk Kwon et al.; Institution: UC Berkeley et al.; Year: 2023. Architecture: paged KV + continuous batching. Contribution:建立logical token到non-contiguous physical KV blocks的serving abstraction。Limitation:未提供current CUDA Graph/CUPTI provenance。改變：是Hermes logical→physical KV identity的系統基礎。

### NVIDIA CUPTI Documentation
Institution: NVIDIA; current official documentation (2026 docs). Architecture: Activity/Callback/External Correlation/CUDA Graph tracing. Contribution:API↔GPU correlationId，以及graphId/graphNodeId node-level tracing。Limitation:只提供execution identity，不知道Hermes request/token/KV lease語義。

### The Illusion of Equivalence: Systematic FP16 Divergence in KV-Cached Autoregressive Inference
Authors: Ranjith Chodavarapu, Lei Xu; Year: 2026; URL: arXiv:2604.15409. Dataset: GSM8K; Models: LLaMA-2-7B, Mistral-7B-v0.3, Gemma-2-2B. Contribution:指出FP16 cache-on/off不同累加路徑可造成deterministic divergence，FP32 control大幅縮小差異。Limitation:不是GUI-agent或multimodal provenance研究。改變：要求Hermes causal intervention加入sham與numerical-path controls。

## Unknown / Open Questions 1-3

1. current vLLM full/piecewise CUDA Graph中，哪個 `graphNodeId`穩定對應 target Triton attention kernel，graph重新capture/update後identity如何versioning？
2. block-table/static input buffer在每次replay前的write/update位置與完成fence在哪裡？如何建立 `ContentEpochWitness` 而非只依data_ptr？
3. CUPTI external correlation push/pop包住 `CUDAGraph.replay()` 時，external ID對graph launch與node kernel activity的實際傳播關係如何？需要最小GPU trace實驗驗證。

## 下一輪研究

直接追 vLLM `gpu_model_runner.py` 與 attention metadata builder：`scheduler output → block_table/slot_mapping update → static CUDA graph buffer copy → fence → graph replay`。再設計最小CUPTI/Nsight trace instrumentation，驗證 `ReplayEpoch → graphId/graphNodeId → attention kernel`。完成後才執行第一個 sham/zero/replace KV causal experiment。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：`CUDAGraphEntryIdentity`、`BatchDescriptorWitness`、`StaticBufferIdentity`、`StaticAddressDynamicContentState`、`BufferContentEpochWitness`、`GraphCaptureEpochWitness`、`GraphExecutionWitness`、`CUPTIGraphIdentity`、`CUPTIGraphNodeIdentity`、`GraphNodeExecutionWitness`、`GraphLevelOnlyState`、`NodeExecutionSemanticsUnboundState`、`ReplaySemanticEpochWitness`。

新增 Edges：
- `BatchDescriptorWitness --selects--> CUDAGraphEntryIdentity`
- `CUDAGraphEntryIdentity --captures--> GraphCaptureEpochWitness`
- `StaticBufferIdentity --holds_at_epoch--> BufferContentEpochWitness`
- `ReuseFenceWitness --happens_before--> GraphExecutionWitness`
- `GraphExecutionWitness --identified_by--> CUPTIGraphIdentity`
- `CUPTIGraphIdentity --contains--> CUPTIGraphNodeIdentity`
- `CUPTIGraphNodeIdentity --executes--> GraphNodeExecutionWitness`
- `BufferContentEpochWitness --binds_semantics_to--> GraphNodeExecutionWitness`
- `GraphNodeExecutionWitness --plus_source_read_closure--> RuntimeKVReadWitness`

## 本輪結束判定

缺哪一層：`static graph input buffer content epoch → graph replay node → exact attention runtime read`。

哪個節點最淺：`BufferContentEpochWitness`；現在已知道graph/node如何觀測，但仍需閉合block-table/slot-mapping bytes何時更新且對哪一輪request有效。

哪個概念仍只是名詞：實測 `RuntimeKVReadWitness` 與 `AgentActionCausalBound`。

哪個系統值得讀原始碼：vLLM `gpu_model_runner.py` 的 block table / slot mapping CUDA Graph input更新路徑。

哪篇論文需追引用：PagedAttention沿vLLM CUDA Graph serving演進；`The Illusion of Equivalence`沿KV causal/numerical controls。

哪個概念最適合視覺模擬：`CUDA Graph Replay × Semantic Buffer Epoch Inspector`。

哪個 Agent 架構最值得實作：`State-grounded Planner + Pixel→VisualToken→KV Provenance + ReplaySemanticEpochWitness + Runtime Read Gate + PreAction Causal Verifier`。

本輪實質進展：Hermes已發現CUDA Graph模式下「host Python attention call」不再是可靠的每輪execution identity。正確的runtime provenance必須把static pointer與dynamic content epoch分開，再用CUPTI correlationId + graphId + graphNodeId把某次replay中的GPU attention node接回request/KV lease。這是從source-level read closure進入真正runtime execution closure的必要一步。