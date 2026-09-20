# 【AI Agent × Multimodal Research Report】

**時間：2026-09-20 12:54（Asia/Taipei）**  
**主題：LayerName → KV Cache Tensor → Attention Custom Op → CUDA Graph Node：建立 AttentionNodeBindingWitness**

## 本小時新發現

本輪延續上一輪 `EffectiveKVReadSet → AttentionNodeBindingWitness`，不再重複 block-table / slot-mapping 位址算術，而是追查「哪一層 Attention、哪一份 KV cache、哪一次 custom op，如何成為 GPU graph node 的可驗證 identity」。

### 1. vLLM 已存在穩定的 layer-name identity bridge（已確認工程事實）

current vLLM `Attention.__init__` 把每個 attention layer 以 `prefix` 註冊進 `compilation_config.static_forward_context[prefix]`，並保留 `self.layer_name`。`forward()` 呼叫 `unified_kv_cache_update(..., self.layer_name)` 與 `unified_attention_with_output(..., self.layer_name)`。這表示 layer semantic identity 並沒有在 opaque custom-op 邊界消失。

來源：
- https://github.com/vllm-project/vllm/blob/main/vllm/model_executor/layers/attention/attention.py

### 2. `get_attention_context(layer_name)` 是 semantic layer → runtime state 的關鍵 join point（已確認工程事實）

`get_attention_context(layer_name)` 會從 forward context 解析：

`layer_name → attn_metadata → no_compile_layers[layer_name] → attn_layer.kv_cache → slot_mapping[layer_name]`

因此同一個 layer name 可以同時綁到：
- Attention implementation/backend
- 該層 KV cache tensor
- 該層 slot mapping
- 該 step attention metadata

這是建立 `LayerRuntimeContextWitness` 的最佳 source-level instrumentation point。

### 3. KV write 與 attention read 之間存在顯式 compile dependency（已確認工程事實）

`unified_kv_cache_update()` 回傳 dummy tensor；該 dummy 被傳入 `unified_attention_with_output()`，雖然後者立即 `del kv_cache_dummy_dep`，但其目的明寫為讓 `torch.compile` 保留 KV cache update → attention forward 的 ordering。

因此 source DAG 為：

`LayerName → KVUpdateCustomOp → DummyDependency → AttentionCustomOp → Backend.forward`

這比只看 kernel 時間鄰近更強，但仍只是 compile/execution ordering evidence，不等於 exact memory-read proof。

### 4. opaque custom op 是 layer semantic identity 與 graph/kernel identity 的自然 instrumentation seam（工程推論，source-supported）

CUDA-like platforms由 vLLM 把 attention 註冊為 giant opaque custom op。這使 Hermes 可在 custom-op dispatch 周邊記錄：

`SemanticEpoch + LayerName + BackendIdentity + KVCacheTensorIdentity + AttentionMetadataEpoch + StreamIdentity`

再以 CUPTI per-node activity取得 `graphId + graphNodeId`。CUDA 13.4 `CUpti_ActivityKernel13` 明確提供 graph/node identity；CUPTI 官方也說 per-node trace可透過 kernel/memcpy/memset activity取得 graphId / graphNodeId。

來源：
- https://docs.nvidia.com/cupti/main/main.html
- https://docs.nvidia.com/cupti/13.4.0/api/structCUpti__ActivityKernel13.html

### 5. `graphNodeId` 本身仍不足以宣稱 layer identity（重要限制）

CUPTI 知道某 kernel 屬於哪個 graph/node，但它不天然知道 `model.layers.18.self_attn`。反方向，vLLM知道 layer name與 runtime KV cache，但不天然知道哪個 CUPTI graph node執行該 layer。因此必須建立顯式 join witness，不能用 kernel name相似度當最終證據。

建議 evidence ladder：

`LayerSemanticBound → CustomOpBound → GraphReplayBound → GraphNodeCandidate → NodeLayerCalibration → AttentionNodeBindingWitness → EffectiveKVReadSetBound`

---

## 本小時最重要 5 個發現

1. **LayerName 是可保留的 semantic identity**：vLLM 沒有在 custom-op 邊界丟掉 layer identity。
2. **get_attention_context 是最佳 runtime join point**：一次取得 metadata、layer object、KV cache、slot mapping。
3. **KV update → attention 有顯式 dummy dependency**：torch.compile ordering不是偶然時間順序。
4. **CUPTI graphNodeId 是 execution identity，不是 semantic layer identity**：兩者需要 binder。
5. **AttentionNodeBindingWitness 應以 instrumentation/calibration 建立，不應靠 kernel-name猜測。**

---

## Architecture Breakdown

```text
SchedulerStep / SemanticEpoch
        ↓
ForwardContext
        ↓
LayerName
        ├──→ AttentionMetadataEpoch
        ├──→ AttentionLayer instance
        ├──→ BackendIdentity
        ├──→ KVCacheTensorIdentity
        └──→ LayerSlotMapping
                 ↓
        unified_kv_cache_update
                 ↓
          DummyDependency
                 ↓
      unified_attention_with_output
                 ↓
          Backend.forward
                 ↓
        CUDA/Triton kernels
                 ↓
      CUPTI graphId/nodeId
                 ↓
      NodeLayerCalibration
                 ↓
   AttentionNodeBindingWitness
                 ↓
       EffectiveKVReadSet
```

### System architecture：Hermes Runtime Provenance Verifier v0.4

Verifier 建議拆成四個 plane：

1. **Semantic Plane**：request / scheduler step / layer name / metadata epoch。
2. **Storage Plane**：KV tensor / cache group / physical block / lease epoch。
3. **Execution Plane**：stream / graph replay / graph node / kernel activity。
4. **Causal Plane**：sham / zero / replace intervention → Δattention → Δlogit → Δaction。

這輪補的是 Semantic Plane ↔ Execution Plane 的 layer-level join。

---

## Bottom-Level Logic

### Attention call path

```text
Attention.forward(query,key,value)
→ reshape Q/K/V
→ unified_kv_cache_update(key,value,layer_name)
→ get_attention_context(layer_name)
→ kv_cache + layer_slot_mapping
→ backend.do_kv_cache_update(...)
→ dummy dependency
→ unified_attention_with_output(...,layer_name,dummy)
→ get_attention_context(layer_name)
→ attn_metadata + attn_layer + kv_cache
→ attn_layer.impl.forward(...kv_cache,attn_metadata...)
→ Triton/CUDA kernel
→ graph node/kernel activity
```

### 關鍵區分

```text
LayerNameBound
≠ GraphNodeBound
≠ RuntimeKVReadBound
≠ CausalEffectBound
```

每一層都需要獨立 witness。

### 建議 NodeLayerCalibration

在 sampled verification run：

```text
Before custom op:
record(epoch, layer_name, backend, kv_cache_ptr, stream)

GPU trace:
collect(graphId, graphNodeId, kernelName, streamId, start, end)

After custom op / replay:
bind candidate node interval

repeat across isolated layers / shapes
→ establish stable NodeLayerCalibrationWitness
```

若 CUDA Graph replay使 Python custom-op hook不會每次重跑，則 calibration只能用於 capture/node topology；每次 replay 的 semantic epoch仍必須由先前建立的 replay-level ExternalCorrelation / GraphReplayWitness補上。不得把 capture layer marker錯當 replay semantic marker。

---

## Visual Simulation Idea

### Layer → KV → Graph Node Binder

互動視圖分四欄：

```text
SEMANTIC          STORAGE              EXECUTION              READ SET
Layer 18          KV cache L18         Graph G12              positions 0..204
Req A             cache group 0        Node N57               ↓ masks
Epoch E209        lease L45            Kernel K932            physical blocks
   │                  │                    │                   17,31,91...
   └──────────────────┴──── BINDER ───────┘
```

功能：
- 點 layer 顯示 KV tensor / backend / metadata epoch。
- 點 graph node 顯示 source-bound layer candidates。
- 切換 capture/replay，禁止把 capture marker誤當 replay witness。
- 點 token 反查 logical position → physical block → KV address → layer/node。
- Evidence badge：`SOURCE_BOUND / REPLAY_BOUND / NODE_CALIBRATED / KV_READ_BOUND / CAUSAL_BOUND`。

---

## Code / GitHub

### vLLM

核心檔案：
- `vllm/model_executor/layers/attention/attention.py`
  - `Attention.__init__`
  - `Attention.forward`
  - `get_attention_context`
  - `unified_kv_cache_update`
  - `unified_attention_with_output`
- 下一輪：`vllm/v1/attention/ops/triton_unified_attention.py`
- 下一輪：Triton attention helpers / backend selector / CUDA Graph manager。

Repository：https://github.com/vllm-project/vllm

### CUPTI

需要 activity fields：
- graphId
- graphNodeId
- sourceGraphId / sourceGraphNodeId（CUDA 13.4）
- stream/context identity
- kernel timestamps/name/correlation

Docs：https://docs.nvidia.com/cupti/main/main.html

---

## Papers

### Identify Critical KV Cache in LLM Inference from an Output Perturbation Perspective
- Authors：Yuan Feng, Junlin Lv, Yukun Cao, Xike Xie, S. Kevin Zhou
- Year：2025
- URL：https://arxiv.org/abs/2502.03805
- Architecture：以 attention output perturbation分析 KV criticality。
- Contribution：指出 attention weight不是唯一 criticality依據，value states與模型參數同樣影響 output perturbation。
- Dataset/benchmark：Needle-in-a-Haystack、LongBench。
- Limitation：criticality/perturbation model不等於 serving runtime physical provenance。
- 對 Hermes 的改變：causal viewer不能只畫 attention score，必須量測 intervention後 output/logit effect。

### LoopGuard: Breaking Self-Reinforcing Attention Loops via Dynamic KV Cache Intervention
- Authors：Dongjie Xu et al.
- Year：2026
- URL：https://arxiv.org/abs/2604.10044
- Dataset：LoopBench。
- Contribution：把 decoding repetition與 collapsed attention + KV reuse feedback loop連結，並用 inference-time KV intervention破壞迴圈。
- Limitation：是 failure-mode intervention，不是通用 mechanistic causality證明。
- 對 Hermes 的改變：提供一個非常適合 `KV intervention → behavioral action/output change` 的真實 benchmark方向。

### KeepKV: Eliminating Output Perturbation in KV Cache Compression for Efficient LLMs Inference
- Authors：Yuxuan Tian et al.
- Year：2025
- URL：https://arxiv.org/abs/2504.09936
- Contribution：以 merging history與 zero-inference-perturbation merging降低 cache compression造成的 attention/output perturbation。
- Limitation：compression quality evidence不直接提供 physical runtime read provenance。
- 對 Hermes 的改變：可作為 SHAM/REPLACE intervention設計的對照文獻。

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `LayerSemanticIdentity`
- `LayerRuntimeContextWitness`
- `AttentionCustomOpIdentity`
- `KVUpdateCustomOpIdentity`
- `CompileOrderingDependencyWitness`
- `KVCacheTensorIdentity`
- `LayerSlotMappingIdentity`
- `LayerAttentionMetadataEpoch`
- `GraphNodeCandidate`
- `NodeLayerCalibrationWitness`
- `AttentionNodeBindingWitness`
- `CaptureLayerTopologyWitness`
- `ReplayLayerExecutionWitness`

### Edges

```text
LayerSemanticIdentity --resolves_via→ LayerRuntimeContextWitness
LayerRuntimeContextWitness --binds→ KVCacheTensorIdentity
LayerRuntimeContextWitness --binds→ LayerAttentionMetadataEpoch
LayerRuntimeContextWitness --binds→ LayerSlotMappingIdentity
KVUpdateCustomOpIdentity --ordered_before→ AttentionCustomOpIdentity
AttentionCustomOpIdentity --dispatches→ AttentionBackend
AttentionBackend --launches_candidate→ GraphNodeCandidate
GraphNodeCandidate --calibrated_to→ LayerSemanticIdentity
NodeLayerCalibrationWitness --supports→ AttentionNodeBindingWitness
AttentionNodeBindingWitness --constrains→ EffectiveKVReadSet
CaptureLayerTopologyWitness --does_not_prove→ ReplayLayerExecutionWitness
GraphNodeId --does_not_prove→ LayerSemanticIdentity
```

---

## Unknown / Open Questions

1. CUDA Graph capture後，一個 `unified_attention_with_output(layer_name)` 是否穩定對應單一 graph node，還是會展開為多個 kernel nodes？需要實際 per-node trace確認。
2. 不同 backend（TRITON_ATTN / FlashAttention / FlashInfer / MLA）是否可共用同一 `CanonicalAttentionNodeBinding` schema？目前尚未驗證。
3. KV sharing layer（`kv_sharing_target_layer_name`）會讓 semantic layer與 physical KV owner分離；Knowledge Graph需要 `SemanticConsumerLayer → PhysicalKVOwnerLayer` edge。

---

## 下一輪研究

優先追：

```text
LayerName
→ unified_attention custom op
→ active backend
→ exact Triton kernel launch set
→ graph capture topology
→ CUPTI graphId / graphNodeId / kernelName
→ NodeLayerCalibrationWitness
→ KV-sharing owner identity
→ EffectiveKVReadSet
→ RuntimeKVReadWitness
→ SHAM intervention
→ ZERO / REPLACE selected KV
→ ΔAttention output
→ ΔResidual
→ ΔLogit
→ ΔGeneratedToken
→ ΔAgentAction
```

並開始設計最小 intervention harness，要求同一 prompt / weights / precision / backend / batch geometry / sampling seed 下跑 baseline、sham、zero、replace 四組。

---

## 本輪結論檢查

- **缺哪一層：** Layer semantic identity → exact captured/replayed graph-node set 的 runtime calibration。
- **哪個節點最淺：** `NodeLayerCalibrationWitness` production instance。
- **哪個概念仍只是名詞：** 跨 backend 的 `CanonicalAttentionNodeBinding` 與最下游 `AgentActionCausalBound`。
- **哪個系統值得讀原始碼：** vLLM Triton unified attention + CUDA Graph manager + KV sharing path。
- **哪篇論文需追引用：** *Identify Critical KV Cache in LLM Inference from an Output Perturbation Perspective*，以及 LoopGuard 的 inference-time intervention工作。
- **哪個概念最適合視覺模擬：** `LayerName → KV tensor → graph node → effective KV read set` 四層 Binder。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Causal Evidence Gate + Tool Executor`。

最終鏈目前推進到：

`User Input → Context → Token/Multimodal Token → LayerSemanticIdentity → AttentionMetadata → BlockTable/SlotMapping → PhysicalKVIdentity → AttentionCustomOp → GraphNodeCandidate → EffectiveKVReadSet → [待實測 Node Binding] → RuntimeKVReadWitness → Causal Intervention → ΔLogit → ΔAgentAction`。

本輪真正跨過的邊界，是找到 vLLM 內部可把「模型第幾層」與「該 step 的 metadata / KV cache / slot mapping / backend custom op」綁在一起的 source-level join point。下一輪不再需要猜哪個 layer 使用哪份 cache，而要把這個 semantic identity正式落到 CUPTI graph node。