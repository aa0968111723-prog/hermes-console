# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-19 17:52 Asia/Taipei

## 本小時新發現

本輪延續上一輪 `Capture Pixel → Vision Preprocessing → Vision Patch`，不重複 Android capture / Skia provenance；研究焦點直接移到 **Qwen2-VL raw patch → vision transformer → spatial merger → LLM placeholder → M-RoPE → KV cache**，嘗試閉合 `ExactTokenIdentityBridge`。

主要來源：
- Hugging Face Transformers current Qwen2-VL implementation: https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2_vl/modeling_qwen2_vl.py
- Qwen2-VL docs: https://huggingface.co/docs/transformers/model_doc/qwen2_vl
- Qwen2-VL paper / Naive Dynamic Resolution + M-RoPE: https://arxiv.org/abs/2409.12191
- HoPE（用來比較長視訊 M-RoPE position allocation 的限制）: https://arxiv.org/abs/2505.20444

### 新架構發現
Qwen2-VL current Transformers implementation 已提供足夠資訊，把 visual token identity 確定性地追到 LLM sequence slot：

```text
Capture pixels
→ preprocessed pixel tensor
→ Conv3d PatchEmbed
→ raw patch embedding i
→ Vision Transformer blocks
→ PatchMerger group g
→ image feature g
→ image placeholder slot s
→ inputs_embeds[s] = image_feature[g]
→ M-RoPE position (t,h,w)
→ decoder Q/K/V
→ KV cache slot s
```

這表示上一輪最淺的 `ExactTokenIdentityBridge` 可以進一步拆成三個可驗證 witness：

1. `PatchToMergedTokenIdentity`
2. `MergedTokenToSequenceSlotIdentity`
3. `SequenceSlotToKVCacheIdentity`

---

## 本小時最重要 5 個發現

### 1. PatchEmbed 不是抽象 patchify，而是 Conv3d projection
**已確認／原始碼。** `PatchEmbed` 使用 kernel/stride = `(temporal_patch_size, patch_size, patch_size)` 的 `nn.Conv3d`；輸入先 reshape 成 `[-1,C,T,P,P]`，再投影成每 patch 一個 `embed_dim` vector。

預設 vision config 為 spatial patch 14、temporal patch 2、spatial merge 2。因此 image path 的底層不是「切成方塊」而是：

```text
2 × 14 × 14 × RGB samples
→ Conv3d linear projection
→ one raw visual patch embedding
```

重要性：現在 pixel→patch embedding 已能對應到具體 weight operator，而不是只有幾何格子。

限制：經過 projection 後 representation 已是 learned linear mixture；不能把單一 output dimension解釋為單一 pixel。

### 2. Vision Transformer 在 merger 前已做 global/context mixing
**已確認／原始碼。** raw patch embeddings 經 vision blocks；vision attention 是 non-causal，Q/K 套用 vision axial 2D RoPE。之後才進 `PatchMerger`。

```text
raw patch i
→ QKV
→ 2D rotary position
→ non-causal self-attention
→ residual/MLP
→ contextualized patch i'
```

因此 `merged token g` 的**幾何輸入群**可以精確知道，但其**語義 causal support**不只限於該 2×2 group，因為 merger 之前已經發生 attention context mixing。

這正式區分：

```text
PatchMergerGeometricSupport != EncodedTokenCausalSupport
```

### 3. Spatial merger 是可精確建模的 4→1 learned merge
**已確認／原始碼。** `PatchMerger` 將 `spatial_merge_size²` 個 contextualized patch vectors reshape/concatenate；merge_size=2 時即 4 個 patch，經 LayerNorm → Linear → GELU → Linear 投影至 LLM hidden size。

```text
[p0,p1,p2,p3]
→ LayerNorm
→ concatenate (4 × vision_context_dim)
→ Linear
→ GELU
→ Linear
→ one LLM-width visual embedding
```

而 `get_image_features()` 用：

```text
split_size = T*H*W / spatial_merge_size²
```

切回每張 image 的 merged embeddings。因此 merged visual token count 是 deterministic function of `image_grid_thw`。

### 4. image feature → LLM sequence slot 是 exact scatter，不是 cross-attention 黑盒
**已確認／原始碼。** Qwen2-VL 先取得 text `inputs_embeds`，找出 `image_token_id` placeholder mask；它檢查 placeholder token count 必須等於 image feature count，接著：

```text
inputs_embeds = inputs_embeds.masked_scatter(image_mask, image_embeds)
```

所以可以建立 deterministic mapping：

```text
merged_visual_token[g]
→ ordered image placeholder[g]
→ exact multimodal sequence slot s
```

這是本輪最關鍵的 `ExactTokenIdentityBridge`。Qwen2-VL 不是把 image feature 留在獨立 cross-attention memory，而是把它直接寫進 decoder input embedding sequence 的 image placeholder positions。

### 5. LLM-visible visual token 接著獲得 3D M-RoPE，並進入同一 decoder KV cache
**已確認／原始碼。** `get_rope_index()` 對 image/video tokens建立 temporal/height/width 三軸 position IDs；文字則是一般 1D progression。Decoder 對 sequence hidden states做 Q/K/V projection，套 M-RoPE，若 cache 存在則呼叫 `past_key_values.update(key_states, value_states, layer_idx)`。

因此可建立：

```text
visual sequence slot s
→ M-RoPE(t,h,w)
→ K_l[s], V_l[s]
→ layer-l KV cache
→ later generated-token attention
```

重要性：Hermes 第一次可以從 screenshot pixel provenance一路連到「哪個 LLM sequence slot、哪個 positional identity、哪個 KV-cache entry」；但 KV cache保存的是 transformed K/V，不是原始 pixel 或 patch。

限制：進入 decoder self-attention 後，每一層 hidden state持續跨 text + visual sequence mixing，不能再把後層 representation視為局部 image region的純表示。

---

## Architecture Breakdown

### Qwen2-VL multimodal ingress

```text
Screenshot / Image
│
├─ image processor
│  ├─ dynamic resize
│  ├─ rescale / normalize
│  └─ pixel_values + image_grid_thw
│
├─ Vision Tower
│  ├─ Conv3d PatchEmbed (T×14×14)
│  ├─ axial 2D vision RoPE
│  ├─ non-causal vision self-attention × depth
│  └─ PatchMerger (2×2 → 1)
│
├─ Multimodal Sequence Injection
│  ├─ text token embeddings
│  ├─ image_token placeholder mask
│  └─ masked_scatter(image_embeds)
│
├─ M-RoPE
│  ├─ temporal ID
│  ├─ height ID
│  └─ width ID
│
└─ LLM Decoder
   ├─ RMSNorm
   ├─ Q/K/V projections
   ├─ M-RoPE on Q/K
   ├─ KV cache update
   ├─ causal attention over prior multimodal context
   ├─ MLP
   └─ logits → sampling → next token
```

### Model reasoning vs system reasoning
- **Model reasoning:** decoder hidden-state transformations, attention, MLP, logits/sampling。
- **System reasoning:** Agent runtime 決定何時 capture、如何 crop、是否重新觀察、是否調工具、是否允許 action。
- Hermes 不應把「模型 attention」與「Agent planning loop」合稱 reasoning；兩者需要分開建圖。

---

## Bottom-Level Logic

### Exact visual token identity formula
對單張 image grid `(T,H,W)`，spatial merge `m=2`：

```text
N_raw = T * H * W
N_merged = T * (H/m) * (W/m)
```

對 merged grid coordinate `(t, hm, wm)`，可建立它的直接 merger input group：

```text
G(t,hm,wm) = {
 (t, 2hm,   2wm),
 (t, 2hm,   2wm+1),
 (t, 2hm+1, 2wm),
 (t, 2hm+1, 2wm+1)
}
```

這是 **direct geometric merger support**，不是最終 semantic support。

### Exact sequence identity
若 image placeholder positions（依 sequence order）為：

```text
S = [s0,s1,...,s(N_merged-1)]
```

則 current implementation 的 ordered scatter 提供：

```text
merged_token[g] → sequence_slot S[g]
```

### M-RoPE identity
`get_vision_position_ids()` 對 merged grid產生 `(T,H,W)` positions；image token因此不只有 scalar sequence index，還同時有 multimodal spatial identity：

```text
VisualTokenIdentity = {
 image_id,
 merged_index,
 sequence_slot,
 t,
 h,
 w
}
```

### KV identity
對 decoder layer `l`：

```text
x_s
→ q_proj/k_proj/v_proj
→ M-RoPE(q_s,k_s)
→ K_l[s], V_l[s]
→ KVCache(layer=l, sequence_slot=s)
```

因此建議 Hermes 的 provenance object：

```text
VisualTokenWitness {
 capture_id,
 pixel_region,
 resize_sampling_footprint,
 raw_patch_ids[],
 merger_group_id,
 merged_token_index,
 sequence_slot,
 mrope_t,
 mrope_h,
 mrope_w,
 kv_slots_by_layer[]
}
```

---

## Visual Simulation Idea

### Pixel → Token → KV Cache Microscope

互動方式：使用者點 screenshot 上 `(x,y)`。

Console 展示：

```text
Pixel (x,y)
↓ resize sampling footprint
Raw patch #1668
↓ Conv3d
Vision embedding #1668
↓ ViT context mixing
Contextual patch #1668
↓ merger group #417 [1668,1669,17xx,17xx]
Merged visual token #417
↓ masked_scatter
LLM sequence slot #S417
↓ M-RoPE
(t=0,h=11,w=9)
↓ decoder layer 0..L-1
KV cache K_l[S417], V_l[S417]
↓
Generated action/reasoning tokens
```

UI 必須把三種 provenance 用不同語義標籤區分：
- `EXACT_IDENTITY`: deterministic index/slot mapping
- `DIRECT_GEOMETRIC_SUPPORT`: patch/merge footprint
- `CONTEXT_MIXED`: attention後不能宣稱局部 causal ownership

可加入 intervention mode：遮蔽某 patch group、重跑 vision encoder，量測 downstream token/logit/action delta；只有 intervention 才能逐步逼近 causal semantic provenance。

---

## Code / GitHub

### 值得持續追的核心檔案
1. `transformers/models/qwen2_vl/image_processing_qwen2_vl.py` — resize / normalization / patch ordering。
2. `transformers/models/qwen2_vl/modeling_qwen2_vl.py` — `PatchEmbed`, `VisionAttention`, `PatchMerger`, `Qwen2VisionTransformerPretrainedModel`, `get_image_features`, `get_placeholder_mask`, `get_rope_index`, decoder KV update。
3. `transformers/models/qwen2_vl/processing_qwen2_vl.py` — image placeholder expansion、`mm_token_type_ids` 與 processor-side sequence construction。
4. `transformers/cache_utils.py` — DynamicCache / StaticCache 真正的 storage/index semantics。

### 工程實作優先順序
Hermes instrumentation 不應先 dump 全部 activation；先建立低成本 manifest：

```text
VisionTokenManifest
- capture_id
- image_grid_thw
- patch_size
- temporal_patch_size
- merge_size
- raw_patch_count
- merged_token_count
- placeholder_positions[]
- mrope_positions[]
- decoder_sequence_length
- cache_type
```

這足以先完成 deterministic identity graph，再選擇性做 activation/intervention。

---

## Papers

### Qwen2-VL: Enhancing Vision-Language Model's Perception of the World at Any Resolution
- Authors: Qwen Team / Wang et al.
- Institution: Alibaba Cloud / Qwen
- Year: 2024
- URL: https://arxiv.org/abs/2409.12191
- Code: https://github.com/QwenLM/Qwen2-VL
- Architecture: dynamic-resolution vision encoder + visual token merger + decoder-only LLM + M-RoPE
- Contribution: Naive Dynamic Resolution、M-RoPE、image/video統一 multimodal sequence。
- Limitation for Hermes: 論文描述架構，但 exact current runtime identity需以實作版本驗證。
- 改變了什麼：讓 image/video 不必被強制成固定 token count，並將 spatial/temporal coordinates帶入 LLM positional encoding。

### HoPE: Hybrid of Position Embedding for Length Generalization in Vision-Language Models
- Authors: Haoran Li, Yingjie Qin, Baoyuan Ou, Lai Xu, Ruiwen Xu
- Year: 2025
- URL: https://arxiv.org/abs/2505.20444
- Code: https://github.com/hrlics/HoPE
- Architecture: hybrid frequency allocation + dynamic temporal scaling
- Contribution: 系統分析 multimodal RoPE 在長視訊 context 的 position-frequency allocation問題。
- Limitations: 重點是 long-video generalization，不是 GUI agent pixel provenance。
- 對 Hermes 的意義：提醒 `M-RoPE coordinate identity` 不等於「長 context 中語義位置一定可靠」。

---

## Unknown / Open Questions

1. **Exact processor placeholder expansion**：current processor如何依 `image_grid_thw / merge_size²` 展開 image placeholder，以及 multi-image/text interleave 時 slot ordering是否有額外特殊 token，需要下一輪讀 `processing_qwen2_vl.py` 完整閉合。
2. **KV cache physical layout**：logical `(layer, sequence_slot)` 已能確立，但 DynamicCache / StaticCache / paged KV runtime（如 vLLM）如何映射到實際 GPU page/block仍未閉合。
3. **Causal semantic support**：vision attention與LLM attention之後，哪個 source region真正影響 action logits，需要 activation patching / token ablation / causal tracing，不能以 attention weights替代。

---

## 下一輪研究

優先沿著：

```text
Qwen2VLProcessor
→ image placeholder expansion
→ mm_token_type_ids
→ exact multimodal sequence positions
→ M-RoPE positions
→ DynamicCache / StaticCache
→ paged KV cache
→ GPU KV block/page
→ attention kernel
→ logits
```

並比較 Hugging Face eager/SDPA/FlashAttention 與 vLLM paged-attention runtime，建立：

```text
LogicalVisualTokenIdentity
→ LogicalKVSlot
→ PhysicalKVBlock/Page
→ AttentionKernelRead
→ GeneratedTokenLogit
```

下一輪 system architecture：**Inference Runtime / Paged KV Cache**。
下一輪 bottom-level mechanism：**visual token K/V 如何被寫入與後續 decoding query讀取**。

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `Conv3dPatchEmbeddingWitness`
- `VisionAxialRoPEWitness`
- `VisionContextMixingBoundary`
- `PatchMergerGeometricGroup`
- `MergedVisualTokenIdentity`
- `ImagePlaceholderWitness`
- `ExactTokenIdentityBridge`
- `MultimodalSequenceSlot`
- `MRoPE3DPositionWitness`
- `VisualTokenKVSlot`
- `LogicalKVCacheIdentity`
- `CausalSemanticSupportUnknown`

### Edges
```text
CapturePixelRegion
→ ResizeSamplingFootprint
→ RawVisionPatch
→ Conv3dPatchEmbeddingWitness
→ VisionContextMixingBoundary
→ PatchMergerGeometricGroup
→ MergedVisualTokenIdentity
→ ImagePlaceholderWitness
→ MultimodalSequenceSlot
→ MRoPE3DPositionWitness
→ VisualTokenKVSlot
→ LogicalKVCacheIdentity
```

另建立警告 edge：

```text
PatchMergerGeometricGroup
-/> EncodedTokenCausalSupport
```

`-/>` 表示「不能僅由 direct geometry 推論 causal ownership」。

---

## 本輪結束判定

- **缺哪一層：** LLM logical sequence slot → physical inference-runtime KV block/page → attention kernel read。
- **哪個節點最淺：** `LogicalKVCacheIdentity → PhysicalKVBlockIdentity`。
- **哪個概念仍只是名詞：** `EncodedTokenCausalSupport`；需要 intervention 才能驗證。
- **哪個系統值得讀原始碼：** Hugging Face `cache_utils.py` + vLLM paged attention / KV cache manager。
- **哪篇論文需追引用：** Qwen2-VL 的 M-RoPE後續工作，特別是 HoPE 對長 multimodal context position encoding的分析。
- **哪個概念最適合視覺模擬：** `Pixel → Patch → Merged Token → Sequence Slot → M-RoPE → KV Cache`。
- **哪個 Agent 架構最值得實作：** `Provenance-driven Active Perception + Exact Visual Token Manifest + State-grounded Planner + PreAction Revalidation`。

## 本輪核心結論

上一輪只能說「這群 screenshot pixels 形成某個 vision patch / merged visual token」。本輪已把 identity chain推進到 decoder：**Qwen2-VL 的 merged image features依序替換 image placeholder embedding，因此可以建立 merged visual token → exact LLM sequence slot → exact M-RoPE (t,h,w) → logical per-layer KV slot 的 deterministic bridge。**

下一個真正硬邊界不再是 vision encoder，而是 inference infrastructure：**這個 logical visual-token KV slot在 GPU runtime 裡究竟落在哪個 physical KV block/page，後續 generated token的 attention kernel又如何讀到它。**