# 【AI Agent × Multimodal Research Report】

時間：2026-09-20 13:53 Asia/Taipei

主題：Breakable CUDA Graph × Attention Execution Domain × RuntimeKVReadWitness

## 本小時新發現

本輪延續前一輪 `LayerName → KV tensor → graph node → EffectiveKVReadSet`，但發現必須先修正一個重要假設：**Attention 不一定存在於 CUDA Graph node 內。** current vLLM 已加入 `BreakableCUDAGraphCapture`。它會在 attention / KV-cache custom op 邊界結束當前 graph capture，將 custom op 以 eager callable 執行，再開始下一個 graph segment。capture artifact 因而不是單一 graph，而是依序排列的 `CUDAGraph.replay` 與 eager callable。

這意味 `AttentionNodeBindingWitness` 不能被定義成所有 runtime mode 的必經節點。對 FULL CUDA Graph，attention 可有 `graphId/graphNodeId`；對 PIECEWISE / breakable path，attention kernel 可能是 regular eager launch，此時 CUPTI kernel activity 的 `graphNodeId=0` 是合法且有語義的結果，而不是 trace 失敗。

## 本小時最重要 5 個發現

### 1. Attention execution domain 必須先於 node binding 判定
已確認工程實作：`unified_attention_with_output` 被 `@eager_break_during_capture` 包裝；breakable capture 在非 FULL mode 遇到該 op 時，先 `_end_segment()`，eager 執行 op，記錄 callable，再 `_begin_segment()`。因此 attention 的 execution domain 由 runtime CUDA graph mode 決定。

底層：
`ForwardContext.cudagraph_runtime_mode → eager_break_during_capture → {FULL: remain in graph | non-FULL: graph break → eager attention → resume graph}`。

重要性：避免把 `graphNodeId=0` 誤判成 provenance 缺失。

限制：此結論針對 current vLLM breakable CUDA graph path；其他 capture implementation 需另建 adapter。

### 2. RuntimeKVReadWitness 應從 GraphNode-centric 升級為 Launch-centric
已確認官方資訊：CUPTI graph per-node tracing會在 graph-launched kernel activity上提供 `graphId/graphNodeId`；若 kernel 非由 graph launch，graphNodeId 為 0。因此 canonical identity 應為：

`AttentionKernelLaunchIdentity { device, context, stream, correlation_id, kernel_name, start/end, graph_id?, graph_node_id?, source_graph_id?, source_graph_node_id? }`

而非強制 `{graphId, graphNodeId}`。

### 3. Breakable graph 是一個 heterogeneous execution tape
current vLLM source顯示 capture結果是 ordered `segments: list[Callable]`，其中元素可能是 bound `CUDAGraph.replay` 或 eager function。`replay()` 只是依序 `for r in self.segments: r()`。

因此 system architecture 應建模成：
`GraphSegment G0 → Eager Attention A0 → GraphSegment G1 → Eager Attention A1 → ...`
而不是單一 GPU DAG。

### 4. Static buffer identity 跨 eager/graph segment 是 correctness invariant
breakable source明確要求 eager segment 使用 capture時相同 static buffers，否則後續 graph segment會讀錯 memory address。這使前幾輪的 `ContentEpoch`、`StaticBufferIdentity`、`ReplayGateWitness` 必須擴充到 segment boundary。

新的 predicate：
`SEGMENT_SAFE(E_i,A_i,G_i+1) = StaticAddressStable ∧ ContentEpochValid ∧ A_i completes-before G_i+1 ∧ OutputBufferIdentityStable`。

### 5. vLLM runtime mode 是 provenance schema 的一部分，不只是 performance config
官方 vLLM CUDA Graph設計有 NONE / PIECEWISE / FULL / FULL_DECODE_ONLY / FULL_AND_PIECEWISE，並依 batch composition動態 dispatch；backend 不支援時還會 downgrade。故同一 layer 在不同 request/batch可能需要不同 evidence path。

`RuntimeModeEpoch → ExecutionDomain → EvidenceAdapter` 必須進 Knowledge Graph。

## Architecture Breakdown

### Breakable CUDA Graph runtime

```text
Model Forward
  ↓
Graph Capture Segment G0
  ↓ attention custom op boundary
_end_segment()
  ↓
Eager Attention A0
  ↓
record callable(A0)
  ↓
_begin_segment()
  ↓
Graph Segment G1
  ↓
...

Replay:
G0.replay()
→ A0()
→ G1.replay()
→ A1()
→ ...
```

這是一條 heterogeneous execution tape。對 provenance verifier 而言，每一個 step 必須帶 `ExecutionDomain = GRAPH | EAGER`。

### Canonical attention evidence adapter

```text
LayerSemanticIdentity
→ RuntimeModeEpoch
→ ExecutionDomainClassifier
   ├─ FULL/GRAPH
   │   → GraphReplayWitness
   │   → graphId/graphNodeId
   │   → AttentionKernelLaunchIdentity
   └─ EAGER/PIECEWISE
       → CUDA API correlation
       → regular Kernel Activity
       → graphNodeId = 0 (expected)
       → AttentionKernelLaunchIdentity
→ EffectiveKVReadSet
→ PhysicalKVIdentity + KVLeaseEpoch
→ RuntimeKVReadWitness
```

## Bottom-Level Logic

`unified_attention_with_output` 先 resolve `layer_name`，再由 `get_attention_context(layer_name)` 取得 per-layer `attn_metadata`、attention layer、`kv_cache`；最後呼叫 `self.impl.forward(... kv_cache, attn_metadata ...)`。因此 layer semantic identity 與 backend read model仍有 source-level join point。

但 runtime launch identity有兩種：

1. Graph launch：kernel activity包含 graph identity。
2. Eager launch：kernel activity沒有 graph node identity，需靠 runtime/driver correlation、stream、time interval、kernel signature與 layer-scoped instrumentation綁定。

所以 `NodeLayerCalibrationWitness` 應被拆成：

- `GraphNodeLayerCalibrationWitness`
- `EagerKernelLayerCalibrationWitness`
- 上層 canonical `AttentionLaunchLayerBindingWitness`

## Visual Simulation Idea

### Hybrid Graph/Eager Attention Execution Microscope

```text
Semantic Layer      Execution Tape          GPU Evidence
Layer 17       →    Graph G0 Replay     →  graphNodeId 41
Layer 18 attn  →    EAGER A18           →  kernel K77 / graphNodeId=0
Layer 18 post  →    Graph G1 Replay     →  graphNodeId 52
Layer 19 attn  →    EAGER A19           →  kernel K91 / graphNodeId=0
```

互動：切換 NONE / PIECEWISE / FULL / FULL_AND_PIECEWISE；同一 attention layer 的 evidence path會即時改變。若 PIECEWISE 下看到 `graphNodeId=0`，顯示 `EXPECTED_EAGER_DOMAIN`；若 FULL 下 attention kernel卻沒有 graph node identity，顯示 `EXECUTION_DOMAIN_MISMATCH`。

## Code / GitHub

值得繼續讀：
- `vllm/compilation/breakable_cudagraph.py`：capture break、segments、replay tape。
- `vllm/model_executor/layers/attention/attention.py`：`get_attention_context`、`unified_kv_cache_update`、`unified_attention_with_output`。
- `vllm/config/compilation.py`：attention splitting ops 與 CUDAGraphMode。
- 下一輪：active Triton backend `forward()` → exact launch call / Triton kernel symbol。

## Papers / technical sources

本輪主要是 source/runtime architecture correction，而不是新增論文數量。官方 vLLM CUDA Graph design確認 runtime可在 FULL、PIECEWISE、NONE等模式間 dispatch，且 backend compatibility可能導致 mode downgrade。NVIDIA CUPTI CUDA 13.4則確認 graph-launched kernel可透過 `graphId/graphNodeId` trace，並新增 `sourceGraphId/sourceGraphNodeId` lineage。

## Unknown / Open Questions

1. breakable eager attention 的 exact CUDA/Triton kernel launch如何與 `layer_name` 在 production runtime無歧義綁定？
2. 同一 attention op若啟動多個 kernels（preprocess / attention / reduction），canonical `EffectiveKVReadSet` 應綁哪個 kernel set，而非單一 kernel？
3. runtime mode downgrade / batch dispatch 發生時，如何建立 `RuntimeModeEpoch` 並與 SemanticEpoch 同步？

## 下一輪研究

`RuntimeModeEpoch → active backend → unified_attention_with_output → impl.forward → Triton launch set → eager CUDA API correlation / graph node correlation → kernel-set classifier → LayerSemanticIdentity → EffectiveKVReadSet → PhysicalKVIdentity → RuntimeKVReadWitness`。

優先回答：**Attention 是一個 kernel，還是一個 kernel set？如何對 eager 與 graph execution 使用同一 canonical evidence model？**

## Knowledge Graph 新增 Node / Edge

Nodes:
- RuntimeModeEpoch
- AttentionExecutionDomain
- HeterogeneousExecutionTape
- GraphSegmentExecution
- EagerAttentionExecution
- AttentionKernelLaunchIdentity
- AttentionKernelSetIdentity
- GraphNodeLayerCalibrationWitness
- EagerKernelLayerCalibrationWitness
- AttentionLaunchLayerBindingWitness
- SegmentBoundaryContentWitness
- ExecutionDomainMismatchState
- ExpectedEagerDomainState

Edges:
- `RuntimeModeEpoch --selects→ AttentionExecutionDomain`
- `AttentionExecutionDomain --selects→ EvidenceAdapter`
- `HeterogeneousExecutionTape --contains_ordered→ GraphSegmentExecution`
- `HeterogeneousExecutionTape --contains_ordered→ EagerAttentionExecution`
- `LayerSemanticIdentity --binds_via→ AttentionLaunchLayerBindingWitness`
- `AttentionLaunchLayerBindingWitness --binds→ AttentionKernelSetIdentity`
- `AttentionKernelSetIdentity --computes_over→ EffectiveKVReadSet`
- `graphNodeId=0 --may_mean→ ExpectedEagerDomainState`
- `GraphNodeId --is_not_required_for→ EagerAttentionExecution`

## 與歷史研究比較

上一輪將最淺節點定為 `NodeLayerCalibrationWitness`，隱含「attention 會有 graph node」的偏向。本輪修正為更一般的 `AttentionLaunchLayerBindingWitness`。Graph node只是 FULL graph execution的一種 launch identity；PIECEWISE/breakable attention需要 eager kernel correlation adapter。

## 本輪結論

缺哪一層：eager attention kernel-set ↔ layer semantic identity 的 runtime correlation。

哪個節點最淺：`EagerKernelLayerCalibrationWitness`。

哪個概念仍只是名詞：`AttentionKernelSetIdentity` 的 production instance，以及 `AgentActionCausalBound`。

哪個系統值得讀原始碼：vLLM active Triton Attention backend與 breakable cudagraph dispatcher。

哪篇論文需追引用：PagedAttention / KV criticality intervention文獻仍需與 kernel-level evidence交叉；本輪優先級低於 source closure。

哪個概念最適合視覺模擬：Hybrid Graph/Eager Attention Execution Microscope。

哪個 Agent 架構最值得實作：`State-grounded Planner + Runtime Provenance Verifier + Execution-Domain Adapter + Causal Evidence Gate + Tool Executor`。

最終鏈條因此修正為：
`UI → Agent → Context → Reasoning/Planning → Memory/Tools/MCP → Model → LayerSemanticIdentity → RuntimeModeEpoch → Graph/Eager Execution Domain → Attention Kernel Set → EffectiveKVReadSet → Physical KV → GPU → logits → token → Agent Action`。
