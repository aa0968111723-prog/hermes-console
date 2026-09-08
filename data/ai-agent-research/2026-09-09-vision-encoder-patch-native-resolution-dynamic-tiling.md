# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 06:53（Asia/Taipei）**

**本輪主題：Vision Encoder × Patch Embedding × 2D Position × Native/Dynamic Resolution × Window Attention × High-Resolution Tiling**

> 本輪接續上一輪 `Visual Projector × Resampler × Visual Token Bottleneck`，刻意不重複 projector / Q-Former / Perceiver Resampler。焦點往更底層移動：**RGB pixels 如何先變成 patch tokens，再如何保留 2D/temporal position、控制 native-resolution 計算量，最後才交給 projector / merger。**

---

## 1. 本小時新發現

### 新架構 / 新工程方向

1. **Qwen2.5-VL native dynamic-resolution ViT**：官方說明 Qwen2.5-VL 從頭訓練 native dynamic-resolution ViT；為避免高解析度造成 ViT load imbalance，絕大多數層使用 Window Attention，只有四層使用 Full Attention；window 最大 8×8，較小區域不 padding，以保留原始尺度。
   - Official: https://qwenlm.github.io/blog/qwen2.5-vl/
   - Qwen2-VL paper: https://arxiv.org/abs/2409.12191

2. **Qwen2.5-VL vision position 已不是傳統 1D learned position table**：目前 Hugging Face implementation 對 vision Q/K 使用 axial 2D RoPE，height / width 各有 position ids，再重組成 head 維度中的 rotary frequencies。
   - Source: `huggingface/transformers/src/transformers/models/qwen2_5_vl/modeling_qwen2_5_vl.py`

3. **SigLIP 2 / NaFlex 類 native-aspect-ratio vision encoder**：SigLIP 2 的官方論文已包含 multiple-resolution、保留原生 aspect ratio 的 encoder 變體；這代表「VLM 支援任意解析度」不必永遠靠 image tiling hack，也可以在 vision encoder training regime 就原生支援 variable-size sequences。
   - Paper: https://arxiv.org/abs/2502.14786

4. **InternVL3.5 Visual Resolution Router（ViR）**：不是整張圖用固定 compression ratio，而是根據 patch semantic richness 動態選擇壓縮率；官方宣稱 Flash variants 可減少最多約 50% visual tokens 且接近完整效能。這是 2025 的工程方向，應視為特定模型結果，不可泛化成 universal rule。
   - Official: https://internvl.github.io/blog/2025-08-26-InternVL-3.5/

5. **High-resolution architecture 已分成兩條主路徑**：
   - Native variable-resolution：Qwen2-VL / Qwen2.5-VL / NaViT / SigLIP2 native-resolution variants。
   - Dynamic tiling：InternVL 系列把大圖切成多張 448×448 tiles，再逐 tile 跑 vision encoder。

這兩條路徑看似都叫「高解析度」，但底層成本、position semantics、cross-tile continuity、token count pattern 完全不同。

---

# 2. 本小時最重要 5 個發現

## 發現 1 — Patch Embedding 本質上是有 stride 的局部線性投影，不是先做「物件辨識」

### 概念

標準 ViT 的最底層可以寫成：

```text
RGB Image
H × W × C
↓
Divide into P × P patches
↓
flatten / Conv(P,P,stride=P)
↓
linear projection
↓
N patch embeddings

N ≈ (H/P) × (W/P)
```

在 production implementation 中，patchify + projection 往往直接融合成 convolution。

Qwen2.5-VL 更進一步用 `Conv3d`：

```text
kernel = [temporal_patch_size, patch_size, patch_size]
stride = kernel
```

所以 image/video 可以共用：

```text
Pixels / Frames
↓
3D local blocks
↓
Vision patch tokens
```

### 底層如何運作

對一個 patch `p_i`：

```text
z_i = W_patch · flatten(p_i) + b
```

若用 Conv2d / Conv3d，只是把相同 operation 以 kernel/stride 形式高效執行。

### 為什麼重要

因為這表示：

```text
Patch Token
≠ Object
≠ Word
≠ Semantic Unit
```

它首先只是局部 pixel block 的 learned vector representation。

### 限制

patch 越大：token 越少、成本越低，但細字、小物體、細線條更容易在最前端就被下採樣掉。

**已確認事實**：Qwen2.5-VL implementation 的 patch embed 由 Conv3d 完成。  
Source: https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2_5_vl/modeling_qwen2_5_vl.py

---

## 發現 2 — Image Resolution 會平方級改變 patch token 數，進而改變 attention / prefill 成本

如果 patch size 固定：

```text
N = (H/P) × (W/P)
```

例如只做概念比較：

```text
224² image, P=14
→ 16 × 16
→ 256 patches

448² image, P=14
→ 32 × 32
→ 1024 patches

896² image, P=14
→ 64 × 64
→ 4096 patches
```

resolution 邊長 ×4，patch count 會約 ×16。

如果 vision layer 是 full self-attention：

```text
attention pair count ∝ N²
```

所以固定 patch size 下，高解析度不是「多一點成本」，而可能是急劇增加。

PaliGemma 的 224 / 448 / 896 版本很好地展示了這個 trade-off；Hugging Face 官方也提醒高解析度版本因 sequence 更長而需要更多記憶體，通常只有 OCR / fine-grained task 才特別有價值。

Sources:
- https://huggingface.co/blog/paligemma
- https://huggingface.co/docs/transformers/model_doc/paligemma

### Knowledge implication

上一輪的：

```text
Visual Token Count
→ LLM Prefill Cost
→ KV Cache
```

現在必須再往前加：

```text
Image Resolution
× Patch Size
→ Vision Patch Count
→ Vision Attention Cost
→ Visual Token Count after Merger
→ LLM Prefill / KV
```

---

## 發現 3 — Native Resolution 的核心，不只是「不要 resize」，而是讓模型能處理 variable-length 2D token grids

NaViT 的核心不是單純取消 resize，而是：

```text
Images of different H×W
↓
Different patch sequence lengths
↓
Pack multiple image sequences efficiently
↓
Attention mask / positional representation
↓
Single ViT training batch
```

這讓 inference 時可以把 resolution 當作一個連續 cost-quality knob，而不是只有固定 224 / 448 / 896 幾個 checkpoints。

Paper:
- **Patch n' Pack: NaViT, a Vision Transformer for any Aspect Ratio and Resolution**
- Authors: Mostafa Dehghani, Basil Mustafa, Josip Djolonga, Jonathan Heek, Matthias Minderer, Mathilde Caron, Andreas Steiner, et al.
- Institution: Google Research / collaborators
- Year: 2023
- URL: https://arxiv.org/abs/2307.06304
- Architecture: Native-resolution ViT + sequence packing
- Contribution: arbitrary resolution/aspect ratio without standard fixed resize pipeline
- Limitation: variable sequence lengths introduce batching / packing / position / compute-management complexity

SigLIP 2 延續這個方向，加入 multiple-resolution / native-aspect-ratio variants，並提升 localization / dense features。

Paper:
- **SigLIP 2: Multilingual Vision-Language Encoders with Improved Semantic Understanding, Localization, and Dense Features**
- Authors: Michael Tschannen, Alexey Gritsenko, Xiao Wang, Muhammad Ferjad Naeem, Ibrahim Alabdulmohsin, et al.
- Institution: Google DeepMind / Google
- Year: 2025
- URL: https://arxiv.org/abs/2502.14786
- Architecture: Sigmoid image-text encoder + caption/self-supervised objectives + native-resolution variants
- Contribution: stronger VLM visual representations, localization, multilingual understanding, native aspect ratio support
- Limitation: encoder quality提升不代表 downstream LLM 一定能完整利用 dense/local features

---

## 發現 4 — Qwen2.5-VL 用 Window Attention 控制 native-resolution ViT 成本，但必須周期性回到 Full Attention 交換全域資訊

Qwen2.5-VL 官方說明：

```text
Most Vision Layers
→ Window Attention

Only selected layers
→ Full Attention
```

目前 Transformers source 也直接看到：

```text
for layer_num, blk in enumerate(self.blocks):
    if layer_num in self.fullatt_block_indexes:
        use global cu_seqlens
    else:
        use window cu_seqlens
```

也就是 vision token 在大多數層只跟所在 window 的 token interaction，到了特定 full-attention layer 才進行較全域的信息交換。

### System architecture

```text
Native-resolution image
↓
Patch Embed
↓
Window reorder / packed windows
↓
2D axial RoPE
↓
Vision Block 0 — Window Attention
↓
Vision Block 1 — Window Attention
↓
...
↓
Selected Block — Full Attention
↓
...
↓
Patch Merger
↓
LLM visual tokens
```

### 為什麼重要

這是一個典型的：

```text
Locality for efficiency
+
Sparse global mixing for coherence
```

架構。

它與前一輪的 visual token compression 不同：

```text
Window Attention
→ 降低 vision encoder interaction cost

Patch Merger / Compressor
→ 降低送進 LLM 的 token count
```

兩者是在不同位置省成本。

**工程實作已確認**：Transformers 的 Qwen2.5-VL VisionTransformer 具有 `fullatt_block_indexes`, `window_size`, window permutation、variable-length cu_seqlens 與 patch merger。  
Source: https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2_5_vl/modeling_qwen2_5_vl.py

---

## 發現 5 — Vision Position 已從「第幾個 token」演化成真正的空間/時間座標

傳統 ViT 常見：

```text
Patch sequence
↓
Learned absolute position embedding
```

但多模態 native-resolution / video 需要：

```text
Temporal coordinate t
Height coordinate h
Width coordinate w
```

Qwen2-VL 的 M-RoPE 將 position 維度拆成時間、高度、寬度；Qwen2.5-VL vision encoder 的 source 則可看到 axial 2D RoPE：vision `position_ids` 是 `(2, N)`，row 0 = height，row 1 = width，再分別產生頻率並重組到 attention head dimensions。

Sources:
- Qwen2-VL paper: https://arxiv.org/abs/2409.12191
- Official architecture: https://qwenlm.github.io/zh/blog/qwen2-vl/
- Source code: https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2_5_vl/modeling_qwen2_5_vl.py

### 為什麼重要

同一組 patch features 若只被 flatten 成 1D sequence：

```text
patch 31
patch 32
```

並不足以知道它們原來是：

```text
same row?
next row?
next frame?
```

所以多模態 position system 必須把 sequence order 重新連回 spatial / temporal geometry。

---

# 3. Architecture Breakdown

## System Architecture：Qwen2.5-VL Vision Front-End

```text
Image / Video
↓
Image Processor
├ resize within pixel constraints
├ normalize
├ temporal grouping
└ grid_thw metadata
↓
Raw Pixel Blocks
↓
Qwen2_5_VisionPatchEmbed
├ Conv3d
├ temporal_patch_size
├ patch_size H
└ patch_size W
↓
Vision Patch Embeddings
↓
2D Position IDs
├ height
└ width
↓
Axial Vision RoPE
↓
Window Index Builder
↓
Packed Window Order
↓
Vision Transformer Blocks
├ RMSNorm
├ QKV projection
├ Window / Full Attention
├ Residual
├ RMSNorm
├ SwiGLU-like MLP
└ Residual
↓
Patch Merger
├ spatial_merge_size × spatial_merge_size
├ RMSNorm
└ MLP projection
↓
Merged Visual Tokens
↓
LLM hidden dimension
↓
Multimodal LLM Context
```

### 和上一輪的連接

上一輪：

```text
Vision Features
→ Projector / Resampler
→ LLM Tokens
```

本輪補成：

```text
RGB / Frames
→ Patch Embed
→ Vision Position
→ Vision Transformer
→ Patch Merger / Projector
→ LLM Tokens
```

---

# 4. Bottom-Level Logic

## 4.1 Pixel → patch vector

概念式：

```text
patch_i ∈ R^(P×P×C)
↓ flatten
p_i ∈ R^(P²C)
↓
z_i = Wp_i + b
```

Video / Qwen2.5-VL 類：

```text
patch_i ∈ R^(T×P×P×C)
↓
Conv3D kernel = stride = (T,P,P)
↓
z_i ∈ R^D
```

---

## 4.2 Patch vector → contextual visual feature

```text
z₀
↓
RMSNorm
↓
Q = zWq
K = zWk
V = zWv
↓
2D RoPE(Q,K)
↓
Attention(Q,K,V)
↓
Residual Add
↓
MLP
↓
Residual Add
↓
z₁
```

重複 L layers 後：

```text
local pixel patch representation
→ contextual visual representation
```

注意：這仍不代表每一個 token 對應單一人類可命名物件。

---

## 4.3 Dynamic-resolution cost propagation

```text
Input H,W ↑
↓
patch count ↑
↓
vision attention work ↑
↓
vision activation memory ↑
↓
merger output tokens ↑ (unless compression adapts)
↓
LLM prefill ↑
↓
LLM KV cache ↑
```

因此 visual resolution selection 應被視為 Agent runtime 的一個 resource decision，而不只是 image preprocessing setting。

---

# 5. Dynamic Tiling vs Native Resolution

| Dimension | Native-resolution ViT | Dynamic Tiling |
|---|---|---|
| 基本方法 | 整張圖產生 variable grid | 大圖切成多個 fixed-size tiles |
| 代表 | NaViT, Qwen2-VL/Qwen2.5-VL, SigLIP2 variants | InternVL 1.5/2.5/3/3.5 |
| Batch | variable-length packing 較複雜 | fixed tile encoder 較規則 |
| Spatial continuity | 原生 grid 較自然 | tile boundary 需額外處理 |
| 超大圖 | token sequence 可非常長 | 以 tile 數控制 |
| OCR | 可保留 native detail | tile 能保留局部高解析 detail |
| Compute control | pixel/token budget、window attention | tile count / selected tiles |
| Failure | sequence explosion | cross-tile relation / duplicate context |

InternVL3 官方：dynamic resolution 可在 training 最多 36 個 448×448 tiles、testing 最多 128 tiles；並使用 pixel unshuffle 把 visual token 數降到原本四分之一。
Source: https://internvl.github.io/blog/2025-04-11-InternVL-3.0/

InternVL3.5 又加入 Visual Resolution Router，朝 per-patch adaptive compression 演進。
Source: https://internvl.github.io/blog/2025-08-26-InternVL-3.5/

---

# 6. Visual Simulation Idea

## **Pixel → Patch → Vision Token X-Ray**

這一輪最適合加入 Hermes Console 的互動模擬。

### 左區：原始圖片

```text
Resolution: 1920×1080
Patch size: 14
Pixel budget: 1.2 MP
Mode: native / tiled
```

畫面直接疊 patch grid。

### 中區：Vision Encoder

```text
Pixels
↓
Patchify
↓
Patch Embedding
↓
2D Position
↓
Window Attention
↓
Full Attention
↓
Patch Merger
```

用動畫顯示：

```text
local window communication
vs
full global communication
```

### 右區：Cost meter

```text
Raw pixels
Vision patches
Vision attention pairs
Merged visual tokens
LLM prefill tokens
Estimated KV bytes
```

### 可調控制

```text
Resolution: 224 → 448 → 896 → native
Patch: 14 → 16 → 32
Window: 4×4 → 8×8 → full
Merge: 1× → 2× → 4×
Mode:
- Fixed Resize
- Native Resolution
- Dynamic Tiling
- Adaptive Resolution Router
```

### Failure Simulator

把同一張有小字、GUI 按鈕、細圖表的圖片逐步降解析度：

```text
Fine Text
↓
Patch Coverage
↓
Vision Features
↓
Visual Tokens
↓
Question Answer
```

直接標示 evidence 在哪一層消失：

```text
PREPROCESS LOSS
PATCH LOSS
ATTENTION LOCALITY LOSS
MERGER LOSS
LLM UTILIZATION LOSS
```

這會把「模型看不到」從一句模糊描述拆成可定位 failure layer。

---

# 7. Code / GitHub

## Hugging Face Transformers — Qwen2.5-VL

Repository:
https://github.com/huggingface/transformers

值得讀：

```text
src/transformers/models/qwen2_5_vl/
├ modeling_qwen2_5_vl.py
├ processing_qwen2_5_vl.py
├ image_processing_qwen2_5_vl.py
└ configuration_qwen2_5_vl.py
```

本輪已實際追到 `modeling_qwen2_5_vl.py` 的：

```text
Qwen2_5_VisionPatchEmbed
Qwen2_5_VLVisionRotaryEmbedding
Qwen2_5_VLVisionAttention
Qwen2_5_VLVisionBlock
Qwen2_5_VisionTransformerPretrainedModel
Qwen2_5_VLPatchMerger
```

尤其值得看：

```text
forward(hidden_states, grid_thw)
↓
get_vision_position_ids
get_vision_attention_seqlens
get_vision_window_index
↓
patch_embed
↓
window permutation
↓
window/full-attention layer switch
↓
patch merger
```

## Hugging Face Transformers — SigLIP

```text
src/transformers/models/siglip/modeling_siglip.py
└ SiglipVisionEmbeddings
```

值得對照：固定/插值 positional embedding、Conv2d patch embedding 與 Qwen2.5-VL axial RoPE / variable grid 的差異。

## Qwen2-VL

Code:
https://github.com/QwenLM/Qwen2-VL

Paper:
https://arxiv.org/abs/2409.12191

---

# 8. Papers

## A. An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale

- Authors: Alexey Dosovitskiy et al.
- Institution: Google Research
- Year: 2020/2021
- URL: https://arxiv.org/abs/2010.11929
- Architecture: patchify → linear patch projection → Transformer encoder
- Contribution: established patch-token ViT paradigm
- Limitation: original regime heavily relies on fixed-size image preprocessing and large-scale pretraining

## B. Sigmoid Loss for Language Image Pre-Training

- Authors: Xiaohua Zhai, Basil Mustafa, Alexander Kolesnikov, Lucas Beyer
- Institution: Google Research
- Year: 2023
- URL: https://arxiv.org/abs/2303.15343
- Code: https://github.com/google-research/big_vision
- Architecture: image encoder + text encoder with pairwise sigmoid objective
- Contribution: avoids global softmax normalization over all image-text pairs; scales contrastive image-text pretraining differently from CLIP
- Limitation: training objective improvement does not directly solve native resolution / high-resolution inference cost

## C. Patch n' Pack: NaViT

- Authors: Mostafa Dehghani et al.
- Institution: Google Research
- Year: 2023
- URL: https://arxiv.org/abs/2307.06304
- Architecture: native-resolution ViT + packed variable-length image sequences
- Contribution: challenges fixed resize/crop assumption
- Limitations: variable-length training and serving are more complex

## D. Qwen2-VL

- Authors: Peng Wang, Shuai Bai, Sinan Tan, Shijie Wang, Zhihao Fan, et al.
- Institution: Alibaba / Qwen Team
- Year: 2024
- URL: https://arxiv.org/abs/2409.12191
- Code: https://github.com/QwenLM/Qwen2-VL
- Architecture: ~600M ViT + Qwen2, naive dynamic resolution, M-RoPE
- Contribution: arbitrary-resolution image handling and unified image/video position representation
- Limitations: visual token count still scales with input visual complexity / resolution; large inputs increase inference cost

## E. SigLIP 2

- Authors: Michael Tschannen et al.
- Institution: Google DeepMind / Google
- Year: 2025
- URL: https://arxiv.org/abs/2502.14786
- Code lineage: https://github.com/google-research/big_vision
- Architecture: improved SigLIP recipe + captioning/self-supervision + native-resolution variants
- Contribution: better localization/dense representations and native aspect ratio support
- Limitations: encoder feature fidelity does not guarantee downstream language decoder utilization

---

# 9. 已確認事實 / 推論 / 未驗證假說

## 已確認事實

- Qwen2-VL 引入 dynamic resolution 與 M-RoPE。
- Qwen2.5-VL 官方說明大部分 ViT 層使用 window attention，只有四層 full attention。
- Transformers Qwen2.5-VL source 使用 Conv3d patch embedding、axial 2D vision RoPE、window/full attention selection、patch merger。
- InternVL dynamic high-resolution 使用 448×448 tile strategy。
- SigLIP2 有 native aspect-ratio / multiple-resolution variants。

## 合理工程推論

Hermes 的 Multimodal Context Compiler 不應只在「projector 輸出 token 後」做 token budget；更好的資源控制位置應提前到：

```text
Agent Task
↓
Evidence Requirement
↓
Resolution Policy
↓
Vision Patch Budget
↓
Vision Encoder
↓
Visual Token Compression
↓
LLM Context Budget
```

因為如果 evidence 已在 resize / patchification 被破壞，之後 RAG、LLM reasoning、tool planning 都無法恢復原始 pixel detail。

## 尚未驗證假說

**Task-adaptive Vision Budget**：Hermes 可依任務類型動態選 resolution / tile / compression：

```text
Scene Summary
→ low resolution

OCR / GUI / Chart
→ high resolution

Object Spatial Relation
→ moderate-high + global mixing

Repeated screenshot state
→ reuse visual cache / selective re-encode
```

這個策略需要真正 benchmark，不能目前就當作最佳實作。

---

# 10. Unknown / Open Questions

1. **Visual evidence attribution**：回答錯誤時，如何判斷資訊是在 resize、patch embedding、window attention、merger，還是 LLM reasoning 階段遺失？目前缺少可操作的 provenance chain。

2. **Native resolution vs tiling 的 crossover point**：在哪些 image size / OCR density / GPU batch 狀況下，native variable sequence 比 dynamic tile 更省成本或更準？目前沒有可泛化單一答案。

3. **Vision cache semantics**：Computer Agent 連續螢幕 frame 只有小區域變動時，是否能安全 reuse 未改變區域的 vision features？這會牽涉 position、attention context、cache invalidation 與 visual grounding correctness。

---

# 11. Knowledge Graph 新增 Node / Edge

## Nodes

```text
Vision Front-End
├ Image Processor
├ Resize Policy
├ Native Resolution
├ Dynamic Tiling
├ Patch Size
├ Temporal Patch
├ Patch Embedding
├ Vision Token
├ Axial 2D RoPE
├ M-RoPE
├ Window Attention
├ Full Vision Attention
├ Sequence Packing
├ Vision Patch Merger
├ Visual Resolution Router
└ Visual Evidence Provenance
```

## Edges

```text
Image Resolution
→ determines
Vision Patch Count

Patch Size
→ inversely controls
Vision Patch Count

Vision Patch Count
→ increases
Vision Attention Cost

Window Attention
→ reduces
Vision Global Interaction Cost

Full Attention Layer
→ restores
Global Visual Mixing

2D Position
→ grounds
Patch Geometry

Dynamic Tiling
→ preserves
Local High-Resolution Detail

Dynamic Tiling
→ may fragment
Cross-Tile Spatial Relations

Patch Merger
→ reduces
LLM Visual Token Count

Visual Resolution
→ propagates cost to
LLM Prefill / KV Cache
```

---

# 12. 下一輪研究

下一輪最值得進入：

# **Vision Feature Semantics × CLIP/SigLIP Training Objective × Contrastive Alignment × Dense Features × Visual Grounding**

也就是把：

```text
Patch Tokens
↓
Vision Transformer
↓
Visual Features
```

進一步回答：

```text
為什麼這些 vector 最後會表示物體、文字、空間與語意？
```

下一輪拆解：

```text
Image Augmentation
↓
Vision Encoder
↓
Image Embedding

Text
↓
Text Encoder
↓
Text Embedding

Image/Text Similarity Matrix
↓
CLIP Softmax Contrastive Loss
vs
SigLIP Pairwise Sigmoid Loss
↓
Gradient
↓
Vision Feature Geometry
↓
Dense / Local Feature Quality
↓
VLM Projector
```

並比較：

```text
CLIP
SigLIP
SigLIP 2
DINOv2 / self-supervised visual features
EVA-CLIP
InternViT
```

以及提出 **Vision Feature Geometry Viewer**：把 patch features、image/text embedding、positive/negative similarity、training gradient 與 downstream VLM token 一起視覺化。

---

# 13. 本輪結束檢查

- **缺哪一層？** Vision feature 是如何透過 pretraining objective 形成 semantic / dense geometry。
- **哪個節點最淺？** Visual Evidence Provenance。
- **哪個概念仍只是名詞？** Task-adaptive Vision Budget。
- **哪個系統值得讀原始碼？** Qwen2.5-VL vision encoder / processor；其次是 SigLIP2 / Big Vision native-resolution input pipeline。
- **哪篇論文需追引用？** SigLIP 2 與 NaViT；兩者直接連到 native resolution、dense features 與 VLM encoder selection。
- **哪個概念最適合視覺模擬？** Pixel → Patch → Vision Token X-Ray。
- **哪個 Agent 架構最值得實作？** Hermes Multimodal Context Compiler 加入「Task → Resolution Policy → Vision Patch Budget → Visual Token Budget」兩階段資源控制，而不是只在 LLM context 最後截 token。

---

## 本輪核心結論

> **多模態 AI 的第一個資訊瓶頸，其實發生在 LLM 之前。RGB pixels 先被 resize / tile，再切成 patch，patch 被投影成 vision vectors，經 2D/temporal position 與 Vision Transformer 交換資訊，最後才被 merger/projector 壓成 LLM 可吃的 visual tokens。解析度、patch size、window attention 與 position encoding 共同決定模型『一開始究竟看見多少』；一旦證據在這一層丟失，後面的 reasoning 再強也無法憑空恢復。**
