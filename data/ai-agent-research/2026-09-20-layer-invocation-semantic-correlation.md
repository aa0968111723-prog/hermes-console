# 【AI Agent × Multimodal Research Report】

時間：2026-09-20 15:53（Asia/Taipei）

主題：LayerInvocationScope × Semantic Correlation × CUPTI Kernel Correlation Set × Attention Runtime Provenance

## 本小時新發現

本輪承接上一輪 `AttentionKernelSetIdentity`，不再重複 2D/3D kernel-set 本身，而是研究如何把「某一層某一次 attention invocation」與 CUPTI 實際觀測到的 kernel activities 綁定。

已確認的 vLLM current source：`Attention.forward()` 將 `layer_name` 傳入 `unified_attention_with_output`；該 custom op 以 `@eager_break_during_capture` 包裝，resolve layer name 後由 `get_attention_context(layer_name)` 取得 attention metadata、attention layer 與 KV cache，最後呼叫 backend `impl.forward(...)`。因此 `layer_name` 是 source/runtime semantic join point，但 vLLM current tree 搜尋不到內建 CUPTI external-correlation push/pop；不能假設 layer semantic ID 已自動出現在 GPU trace。

已確認的 CUPTI 13.4：kernel activity 的 `correlationId` 與啟動該 kernel 的 driver/runtime API activity correlation ID 相同；Kernel13 同時提供 `deviceId/contextId/streamId/gridId/name/graphId/graphNodeId/sourceGraphId/sourceGraphNodeId`。因此可以用 host-side semantic scope + CUPTI API/kernel correlation 建立 `LayerInvocationScope -> KernelCorrelationSet`，但 semantic scope 本身仍需 instrumentation。

已確認的 Triton unified attention：2D path launch `kernel_unified_attention`；3D path先 launch同一 core kernel（3D grid/IS_3D），再 launch `reduce_segments`。因此 semantic scope 的結束點不能在第一個 kernel launch；3D invocation 必須等 reduction kernel 納入同一 invocation completion set。

## 本小時最重要 5 個發現

### 1. LayerInvocationScope 是缺失的 host semantic boundary
- 是什麼：`{layer_name, invocation_epoch, attention_metadata_epoch, kv_cache_identity, execution_variant}` 的 host-side scope。
- 底層：進入 `unified_attention_with_output(layer_name)` 建立 scope；resolve runtime context；backend forward；收集該 scope 期間 CUDA launch/API correlation；退出時封存 correlation set。
- 為什麼重要：kernel name 只能告訴我們「跑了哪種 kernel」，不能可靠回答「這是 model.layers.18 的第幾次 invocation」。
- 限制：current vLLM 沒有現成 CUPTI semantic correlation instrumentation；需要 Hermes verifier/sidecar 或可選 patch。
- 證據等級：官方/原始碼確認 + 工程設計推論。

### 2. CUPTI correlationId 是 launch identity，不是 layer semantic identity
- Kernel13 `correlationId` 可連到 driver/runtime API launch activity。
- 它適合做 GPU launch witness，但沒有 layer_name。
- 必須新增 `SemanticCorrelationBridge`，不能把 kernel name 或 graphNodeId 當 layer identity。

### 3. KernelCorrelationSet 必須是集合而非單一 correlationId
2D：`{core}`；3D：`{segmented-core, reduce_segments}`。未來 INT4、FlashAttention、FlashInfer 或 composite routing可能是不同集合。因此 canonical evidence 應為：
`LayerInvocationScope -> ExpectedKernelSet -> ObservedKernelCorrelationSet -> CompletionWitness`。

### 4. Graph / eager 兩域可以共用同一 semantic scope
Graph kernel可額外用 `graphId/graphNodeId/sourceGraph*`；eager kernel合法地 `graphNodeId=0`。Universal identity應建立在 semantic scope + kernel correlation set，而不是 graph node。

### 5. RuntimeKVReadWitness 必須等 execution completion 才能升級
source-derived `EffectiveKVReadSet` 描述 address semantics；CUPTI observed kernel set描述 execution；只有兩者與 layer/KV/metadata epoch join，且 kernel set完整，才能升級為 runtime read witness候選。3D只看到 core kernel時必須標 `KERNEL_SET_INCOMPLETE`。

## Architecture Breakdown

```text
Model Layer
  -> Attention.forward(layer_name)
  -> unified_attention_with_output(layer_name)
  -> LayerInvocationScope(E)
       { layer_name
         invocation_epoch
         metadata_epoch
         kv_cache_tensor_identity
         execution_variant }
  -> get_attention_context(layer_name)
  -> backend.impl.forward(...)
  -> Triton dispatch
       2D: core
       3D: segmented-core -> reduce_segments
  -> CUDA runtime/driver launch activities
  -> CUPTI correlationId[]
  -> Kernel13 activities[]
       {name, gridId, streamId, graphId, graphNodeId, timestamps}
  -> KernelCorrelationSet(E)
  -> KernelSetCompletionWitness(E)
  -> EffectiveKVReadSet(E)
  -> RuntimeKVReadWitness(E)
```

## Bottom-Level Logic

### Semantic correlation bridge

建議 Hermes verifier 定義：

```text
LayerInvocationScope {
  semantic_epoch
  layer_name
  backend
  attention_type
  execution_variant
  metadata_epoch
  kv_cache_identity
  stream_key_expected
  enter_ts
  exit_ts
}

KernelLaunchWitness {
  correlation_id
  runtime_correlation_id?
  device_id
  context_id
  stream_id
  grid_id
  kernel_name
  graph_id
  graph_node_id
  source_graph_id
  source_graph_node_id
  start_ts
  end_ts
}
```

Binder不能只依時間窗；至少應同時使用：scope semantic ID、launch/API correlation、expected stream/context、execution variant、kernel fingerprint與 happens-before constraints。時間戳只做輔助。

### 2D/3D matcher

```text
if variant == TRITON_2D:
  require core_kernel
  completion = core.end

if variant == TRITON_3D:
  require segmented_core
  require reduce_segments
  require reduce.start >= core.start (ordering/happens-before需以 stream/API evidence確認)
  completion = reduce.end
```

注意：同 stream時間順序是有力 evidence，但不能以 wall-clock proximity單獨證明 semantic ownership。

## Visual Simulation Idea

### Layer Invocation → CUPTI Correlation Microscope

四欄同步：
1. Semantic：Layer 18 / invocation E441 / metadata M90 / KV tensor K18
2. Dispatch：TRITON 3D / mask / quant / cache layout
3. Launch：API corr C901 -> core K81；API corr C902 -> reduce K82
4. GPU：stream 17；graph/eager domain；start/end；EffectiveKVReadSet

互動：點 layer invocation可 highlight所有 correlation IDs；點 kernel可反向回 layer、metadata epoch、KV cache、logical/physical read set。若只以時間猜測則顯示 `TEMPORAL_ONLY_WEAK_BINDING`；kernel set不完整顯示 `KERNEL_SET_INCOMPLETE`；跨 scope混入 kernel顯示 `SEMANTIC_SCOPE_CONTAMINATION`。

## Code / GitHub

值得繼續讀：
- `vllm/model_executor/layers/attention/attention.py`：layer_name、custom op、runtime context join。
- `vllm/v1/attention/ops/triton_unified_attention.py`：2D/3D dispatch、core + reduction launch。
- `vllm/v1/worker/gpu_model_runner.py`：step/input preparation與 layer-specific slot mappings。
- vLLM compilation / breakable CUDA graph：決定 attention在 graph/eager execution domain。
- NVIDIA CUPTI Activity API：Kernel13、runtime/driver API activity、external correlation。

## Papers

### Selective KV Cache Protection for Noise-Resilient LLM Inference on Analog Compute-In-Memory Systems
Authors: Yuannuo Feng et al.  
Year: 2026  
Architecture: analog CIM + hierarchical token protection + digital precision path  
Contribution: 顯示不同 token KV 對硬體 noise 的脆弱度並不均勻，初始與近期 token更敏感；提出 sink/recent token高精度保護。  
Reported result: 九個 LLM 的實驗中平均 perplexity由 noisy 33.91降至11.95，clean baseline 11.06。  
Limitation: analog CIM noise setting不能直接外推一般 GPU inference。  
Change to KG: `PhysicalKVRead` 還需加入 `NumericalReliabilityEpoch/StorageComputeSubstrate`，因「讀到同一 slot」不保證數值品質等價。

### Multi-Segment Attention: Enabling Efficient KV-Cache Management for Faster Large Language Model Serving
Authors: Chunan Shi et al.  
Year: 2026  
Architecture: Multi-Segment Attention + cache eviction + adaptive chunking  
Contribution: KV residency與attention kernel execution cost共同最佳化。  
Limitation: 系統性能結果依 workload/hardware；不直接提供 semantic provenance。  
Change to KG: 強化 `KVResidencyDecision -> AttentionExecutionVariant/Cost` edge。

## Unknown / Open Questions 1-3

1. 最低侵入方式如何把 `semantic_epoch/layer_name` 寫入 CUPTI external correlation，且不破壞 CUDA Graph capture/replay semantics？
2. Triton JIT/autotune、kernel specialization是否會讓同一 semantic execution variant產生多個 kernel name/fingerprint，matcher應以哪些穩定特徵為主？
3. 在 microbatch、pipeline/tensor parallel、多 CUDA stream並行時，如何避免單純時間窗造成不同 layer invocation 的 kernel contamination？

## 下一輪研究

```text
LayerInvocationScope
-> CUPTI External Correlation API semantics
-> per-thread push/pop constraints
-> runtime/driver API activity
-> kernel correlationId join
-> microbatch/rank/stream disambiguation
-> 2D/3D kernel-set matcher
-> AttentionKernelSetCompletionWitness
-> EffectiveKVReadSet
-> PhysicalKVIdentity + LeaseEpoch
-> RuntimeKVReadWitness
-> controlled SHAM baseline
-> ZERO / REPLACE intervention
-> ΔAttentionOutput
-> ΔResidual
-> ΔLogit
-> ΔGeneratedToken
-> ΔAgentAction
```

## Knowledge Graph 新增 Node / Edge

Nodes:
- `LayerInvocationSemanticEpoch`
- `SemanticCorrelationBridge`
- `CUPTILaunchCorrelationWitness`
- `KernelCorrelationSet`
- `KernelSetCompletionWitness`
- `TemporalOnlyWeakBindingState`
- `SemanticScopeContaminationState`
- `RuntimeReadWitnessCandidate`
- `NumericalReliabilityEpoch`
- `StorageComputeSubstrateIdentity`

Edges:
- `LayerSemanticIdentity -> instantiates -> LayerInvocationSemanticEpoch`
- `LayerInvocationSemanticEpoch -> binds_via -> SemanticCorrelationBridge`
- `SemanticCorrelationBridge -> correlates -> CUPTILaunchCorrelationWitness`
- `CUPTILaunchCorrelationWitness -> launches -> KernelLaunchWitness`
- `KernelLaunchWitness[] -> forms -> KernelCorrelationSet`
- `KernelCorrelationSet -> satisfies -> ExpectedKernelSet`
- `ExpectedKernelSet + KernelCorrelationSet -> proves -> KernelSetCompletionWitness`
- `KernelSetCompletionWitness + EffectiveKVReadSet + PhysicalKVIdentity -> supports -> RuntimeKVReadWitness`
- `TemporalProximity --does_not_prove-> LayerSemanticOwnership`
- `KernelName --does_not_prove-> LayerSemanticIdentity`

## 與歷史研究比較

前幾輪已完成：Replay stream identity、BlockTable/SlotMapping、physical KV lease、Triton exact read-address model、LayerName/KV tensor join、Graph/Eager execution-domain correction、2D/3D AttentionKernelSet。這一輪新增的不是另一個 kernel細節，而是把 host semantic invocation與 GPU launch evidence之間缺失的 binder明確化。

### 本輪結束判斷
- 缺哪一層：`LayerInvocationSemanticEpoch -> CUPTI launch correlation set` 的真實 production instrumentation。
- 最淺節點：`SemanticCorrelationBridge` production instance。
- 哪個概念仍只是名詞：跨 backend/rank/microbatch 的 `CanonicalKernelCorrelationSet`。
- 哪個系統值得讀原始碼：CUPTI external correlation sample + vLLM breakable CUDA graph/custom-op dispatch。
- 哪篇論文需追引用：Multi-Segment Attention，尤其 KV residency與kernel scheduling的後續工作。
- 最適合視覺模擬：Layer Invocation → CUPTI Correlation Microscope。
- 最值得實作的 Agent 架構：`State-grounded Planner + Runtime Provenance Verifier + Semantic Correlation Bridge + Execution Variant Adapter + Causal Evidence Gate + Tool Executor`。

## 證據分類

- 已確認事實：vLLM layer_name/custom-op/runtime context chain；Triton 2D/3D launch shape；CUPTI Kernel13 correlation/stream/graph fields。
- 官方資訊：CUPTI correlationId與runtime/driver launch activity對應；graphNodeId=0可代表非 graph launch。
- 論文結果：Selective KV Protection、Multi-Segment Attention的作者報告結果。
- 工程實作建議：LayerInvocationScope、SemanticCorrelationBridge、KernelSet matcher。
- 合理推論：上述 bridge可把 source semantic identity與GPU execution identity閉合，但尚未在 hermes production GPU process實測。
- 尚未驗證假說：External Correlation instrumentation在vLLM breakable CUDA graph + Triton path上可低 overhead且無 capture/replay side effect。