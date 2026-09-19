# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 16:53 Asia/Taipei

## 本小時新發現

本輪延續上一輪 `Protected/HDR Capture Fidelity Gate`，不再重複 protected bit、HDR dataspace 或 MSKP rasterization；直接往最終目標下一層推進：**可讀且已通過 CaptureFidelityGate 的 screenshot pixel，如何真正變成 Vision Encoder 的 input patch / visual token？**

核心結論：`CAPTURE_PIXEL_BOUND → VISION_TOKEN_REGION_BOUND` 不能建成單一邊。Vision preprocessing 本身就是一個會改變幾何、數值與 token 數量的 deterministic transform pipeline，而且不同 VLM 的 mapping 不同。Hermes 必須保存 `VisionPreprocessManifest`，才能把 compositor pixel provenance 延伸到 visual token provenance。

## 本小時最重要 5 個發現

### 1. Vision token provenance 必須先穿過 preprocessing，不是 screenshot pixel 直接進 Transformer
**狀態：官方/主流工程實作，已確認。**

Hugging Face image processor 文件明確把 vision model input preprocessing 拆成 resize/center-crop、rescale、normalize 等步驟；Qwen2-VL 實作則再加入 dynamic resize 與 patchify。

因此正確鏈條是：

`Capture Pixel (x,y)`
→ `RGB conversion`
→ `resize transform`
→ `rescale`
→ `channel normalization`
→ `patch grid`
→ `patch vector`
→ `vision patch embedding`
→ `visual token`

來源：
- https://github.com/huggingface/transformers/blob/main/docs/source/en/image_processors.md
- https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2_vl/image_processing_qwen2_vl.py

### 2. Qwen2-VL 的 dynamic resolution 讓 token 數量本身成為 screenshot geometry 的函數
**狀態：論文 + 原始碼交叉驗證，已確認。**

Qwen2-VL 論文提出 Naive Dynamic Resolution，讓不同解析度輸入轉成不同數量 visual tokens；Transformers current implementation 的 `smart_resize()` 要求輸出 H/W 可被 `patch_size * merge_size` 整除，並限制 min/max pixels。預設 `patch_size=14`、`merge_size=2`，因此 resize factor 為 28。

`H0,W0`
→ `smart_resize(factor=28)`
→ `Hr,Wr`
→ `grid_h=Hr/14, grid_w=Wr/14`
→ `grid_h*grid_w raw patches`

這表示同一個 UI 元件在不同 screenshot resolution 下，可能對應不同 patch/token set，不能把 token provenance 寫死成固定 14×14 source-pixel tile。

來源：
- Qwen2-VL paper: https://arxiv.org/abs/2409.12191
- Qwen2-VL image processor source: https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2_vl/image_processing_qwen2_vl.py

### 3. patchify 是可逆追蹤的 deterministic index transform，但 resize interpolation 讓單一 output pixel 可能依賴多個 capture pixels
**狀態：原始碼已確認 + 工程推論。**

Qwen2-VL `patchify()` 先把 `(B,C,H,W)` reshape 成 patch grid，再 permute/flatten。這讓 `(patch_index → resized-image rectangle)` 可精確重建。

但 screenshot 到 resized image 的 resize 使用 bicubic resampling；因此更嚴格的 provenance 不應只有 rectangle overlap，而要記錄 `ResamplingSupportWitness`：一個 resized pixel 的值可能由 source screenshot 鄰域共同決定。

因此：

`CaptureRegionContributorSet`
→ `ResizeSamplingFootprint`
→ `NormalizedPixelTensor`
→ `PatchIndex`
→ `PatchVector`

比 `CaptureRect → TokenID` 更正確。

### 4. SigLIP 2 NaFlex 證明「native aspect ratio + variable sequence length」已是另一種正式 vision-token geometry
**狀態：論文 + implementation，已確認。**

SigLIP 2 的 NaFlex variant 支援 multiple resolutions 並盡量保留 native aspect ratio；Transformers SigLIP2 processor 會依 `patch_size` 與 `max_num_patches` 計算 resize，patchify 後 pad 到固定 patch dimension，並另外輸出 `pixel_attention_mask` 與 `spatial_shapes`。

因此 Hermes 的 token provenance schema 不能綁死 Qwen2-VL。至少要支援：

`fixed-square ViT`
`dynamic-resolution grid`
`NaFlex variable grid + padding mask`
`tiled/cropped multi-view encoder`

來源：
- SigLIP 2: https://arxiv.org/abs/2502.14786
- https://github.com/huggingface/transformers/blob/main/src/transformers/models/siglip2/image_processing_pil_siglip2.py

### 5. `VISION_TOKEN_REGION_BOUND` 應拆成 preprocessing-bound 與 encoder-bound
**狀態：架構建模 / 合理推論。**

目前可以 deterministic 證明的是 screenshot pixel 經 preprocessing 後進入哪個 patch vector；但 patch embedding、self-attention、token merging/projector 之後，單一 token representation 會混合其他 patch/token 資訊。

因此 evidence ladder 應改成：

`CAPTURE_PIXEL_BOUND`
→ `VISION_PREPROCESS_BOUND`
→ `VISION_PATCH_INPUT_BOUND`
→ `VISION_PATCH_EMBEDDING_BOUND`
→ `VISION_CONTEXT_MIXING_BOUND`
→ `VISION_TOKEN_REGION_BOUND`
→ `MULTIMODAL_FUSION_BOUND`

不能把「patch 的幾何 receptive field」和「Transformer 後 token 的 causal semantic support」當成同一件事。

## Architecture Breakdown

### System architecture：Capture Pixel → Vision Token Provenance Bridge

```text
SurfaceFlinger / RenderEngine
→ CaptureFidelityGate
→ Capture Buffer
→ Screenshot Tensor
        ↓
VisionPreprocessManifest
├─ source width/height
├─ RGB/channel conversion
├─ resize algorithm
├─ resized width/height
├─ crop/pad/tile operations
├─ rescale factor
├─ normalization mean/std
├─ patch size
├─ merge size
├─ temporal patch size
└─ spatial/token mask
        ↓
Preprocessed Pixel Tensor
        ↓
Patchify
        ↓
PatchInputWitness[]
        ↓
Vision Patch Embedding
        ↓
Vision Transformer
        ↓
Token Mixing / Merge / Projector
        ↓
LLM-visible visual tokens
```

Hermes 應新增：

```text
VisionPreprocessManifest {
  model_family,
  processor_version,
  source_size,
  resize_size,
  resize_kernel,
  crop,
  padding,
  channel_order,
  rescale_factor,
  mean,
  std,
  patch_size,
  merge_size,
  temporal_patch_size,
  grid_shape,
  token_mask
}
```

這份 manifest 必須和 `ObservationEnvelope` 綁在同一次 model call，而不能只記模型名稱。

## Bottom-Level Logic

### Qwen2-VL concrete path

```text
Screenshot RGB H×W
→ smart_resize(H,W,factor=patch_size*merge_size)
→ Bicubic Resize Hr×Wr
→ Rescale
→ Normalize(CLIP mean/std)
→ patchify(patch_size=14, temporal_patch_size=2)
→ raw patch grid (Hr/14 × Wr/14)
→ image_grid_thw=[1,grid_h,grid_w]
→ Vision Encoder
→ spatial merge
→ multimodal token sequence
```

Transformers source explicitly returns both `pixel_values` and `image_grid_thw`，因此 Hermes 可把 patch geometry 當成 runtime witness，而不是離線猜測。

### Pixel → patch mapping

對 resize 後座標 `(xr,yr)`：

```text
patch_x = floor(xr / patch_size)
patch_y = floor(yr / patch_size)
patch_id = patch_y * grid_w + patch_x
```

但 source capture `(x0,y0)` 到 `(xr,yr)` 不能只存 nearest mapping；bicubic interpolation 需要：

```text
ResizeSamplingFootprint {
  output_xy,
  source_support_region,
  interpolation_kernel,
  coefficients_or_reconstructable_transform
}
```

第一版不一定要存每個 coefficient；保存 processor config + exact source/resized dimensions，即可 deterministic reconstruct。

### Patch → token boundary

`PatchInputWitness` 是 deterministic preprocessing evidence；進入 vision Transformer 後，attention 會讓 representation 取得 global/non-local context，因此應新增：

`GeometricPatchSupport`
≠ `EncodedTokenSemanticSupport`

前者可以 exact；後者若要談 causal attribution，必須另做 activation/attention/intervention evidence，不能由 patch rectangle直接推出。

## Visual Simulation Idea

### Pixel → Patch → Visual Token Microscope

Hermes Console 左側顯示 production screenshot；中間顯示 resize 後 image 與 patch grid；右側顯示 visual-token sequence。

互動：
1. 點 screenshot 的 `(x,y)`。
2. 顯示 resize sampling footprint。
3. 高亮受影響 resized pixels。
4. 高亮對應 raw patches。
5. 顯示 merge 後 visual token ID。
6. 展開該 token 在 vision encoder 各 layer 的 attention/context mixing。
7. 與前一輪 `CapturePixelAttributionManifest` 串接，反向看到：`Visual Token ← Patch ← Resize Footprint ← Capture Pixel ← Skia Draw ← GraphicBuffer generation`。

最終 UI 應能顯示：

`L12/B91/F471 → draw command → capture pixel region → resize footprint → patch #418 → merged visual token #104 → multimodal sequence position`。

## Code / GitHub

本輪不只讀 README，直接追 implementation：

1. `huggingface/transformers/src/transformers/models/qwen2_vl/image_processing_qwen2_vl.py`
   - `smart_resize()`：dynamic geometry
   - `Qwen2VLImageProcessor.resize()`：factor=`patch_size*merge_size`
   - `patchify()`：tensor reshape/permute/flatten
   - `_preprocess()`：resize → rescale/normalize → patchify → `image_grid_thw`
   - `get_number_of_image_patches()`：runtime patch count
2. `huggingface/transformers/src/transformers/models/siglip2/image_processing_pil_siglip2.py`
   - `get_image_size_for_max_num_patches()`
   - resize/rescale/normalize
   - patchify + padding
   - `pixel_attention_mask` / `spatial_shapes`
3. 下一輪應再讀 Qwen2-VL vision encoder/modeling：patch embedding、spatial merger、M-RoPE 與 projector，建立 patch→LLM visual token exact identity。

## Papers

### Qwen2-VL: Enhancing Vision-Language Model's Perception of the World at Any Resolution
Authors: Peng Wang, Shuai Bai, Sinan Tan, Shijie Wang, Zhihao Fan, Jinze Bai, Keqin Chen, Xuejing Liu, Jialin Wang, Wenbin Ge, Yang Fan, Kai Dang, Mengfei Du, Xuancheng Ren, Rui Men, Dayiheng Liu, Chang Zhou, Jingren Zhou, Junyang Lin.
Institution: Alibaba/Qwen team.
Year: 2024.
URL: https://arxiv.org/abs/2409.12191
Code: https://github.com/QwenLM/Qwen2-VL
Dataset: paper 使用大規模多模態訓練 mixture；本輪重點不是 dataset，而是 inference geometry。
Architecture: Naive Dynamic Resolution + ViT vision encoder + M-RoPE + unified image/video processing。
Contribution: image resolution 不再固定，visual token count 隨輸入 geometry 改變；M-RoPE 統一 text/image/video positional representation。
Limitations: 論文描述 model architecture，但 production API 可能在上游另做 screenshot compression/resizing；Hermes 必須 instrument 真正 runtime processor。
改變了什麼：讓 `pixel→token` provenance 必須是 per-observation runtime mapping，而非 model-level static mapping。

### SigLIP 2: Multilingual Vision-Language Encoders with Improved Semantic Understanding, Localization, and Dense Features
Authors: Michael Tschannen, Alexey Gritsenko, Xiao Wang, Muhammad Ferjad Naeem, Ibrahim Alabdulmohsin, Nikhil Parthasarathy, Talfan Evans, Lucas Beyer, Ye Xia, Basil Mustafa, Olivier Hénaff, Jeremiah Harmsen, Andreas Steiner, Xiaohua Zhai.
Institution: Google DeepMind / Google Research.
Year: 2025.
URL: https://arxiv.org/abs/2502.14786
Code: https://github.com/google-research/big_vision/tree/main/big_vision/configs/proj/image_text/README_siglip2.md
Architecture: SigLIP objective + captioning pretraining + self-distillation/masked prediction + NaFlex variable-resolution/native-aspect-ratio variants。
Contribution: 改善 localization/dense features，並讓 variable sequence length/native aspect ratio 成為正式 encoder configuration。
Limitations: encoder-level研究，不等於完整 GUI agent VLM pipeline。
改變了什麼：證明 Hermes schema 必須抽象成 `VisionPreprocessManifest`，不能只為 Qwen dynamic resolution 寫特例。

## 與歷史研究比較

歷史鏈已建立：

`Browser/Layer generation`
→ `GraphicBuffer exact join`
→ `LayerSettings`
→ `Skia draw command`
→ `command ablation`
→ `MSKP resource closure`
→ `GPU→raster fidelity`
→ `Protected/HDR CaptureFidelityGate`
→ `CAPTURE_PIXEL_BOUND`

本輪第一次真正跨出 compositor/rendering subsystem，進入 VLM perception runtime：

`CAPTURE_PIXEL_BOUND`
→ `VisionPreprocessManifest`
→ `ResizeSamplingFootprint`
→ `PatchInputWitness`
→ `Vision Patch / Token`

所以沒有再重複 protected/HDR readback；對 protected branch，proof 仍可在 memory boundary 正確終止。對通過 fidelity gate 的普通 capture，則繼續向 vision token 前進。

## Unknown / Open Questions

1. Qwen2-VL `patchify()` 後 raw patch 到 vision encoder spatial merger 最終 LLM-visible token 的 exact index mapping，需要讀 modeling source，把 `raw patch id → merged token id → multimodal sequence position` 閉合。
2. 不同 production Computer Agent 是否在模型 processor 前還有 browser/server-side screenshot JPEG/WebP compression、max-dimension resize 或 crop？這會形成一個目前缺失的 `TransportImageTransformWitness`。
3. Vision Transformer attention 後，如何區分 geometric patch support 與真正 causal semantic support？Attention weight 不能直接當 causal attribution；需要 intervention/activation patching 或 token ablation witness。

## 下一輪研究

下一輪直接追：

```text
Qwen2VL patchify
→ vision patch embedding
→ vision positional encoding / M-RoPE
→ vision transformer blocks
→ spatial merger
→ merged visual token index
→ multimodal placeholder expansion
→ LLM sequence position
→ KV cache
→ cross-token reasoning
```

同時建立兩條不同證據：

`ExactTokenIdentityBridge`：raw patch 到 LLM sequence position 的 deterministic mapping。

`TokenCausalInfluenceWitness`：對 patch/token 做 controlled ablation/activation intervention，不能用 attention heatmap 冒充因果證據。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `VisionPreprocessManifest`
- `VisionProcessorVersion`
- `VisionResizeTransform`
- `ResizeSamplingFootprint`
- `NormalizedPixelTensor`
- `PatchGridWitness`
- `PatchInputWitness`
- `GeometricPatchSupport`
- `VisionPatchEmbeddingWitness`
- `VisionTokenIdentity`
- `VisionTokenMergeWitness`
- `EncodedTokenSemanticSupport`
- `TransportImageTransformWitness`（待驗證）
- `ExactTokenIdentityBridge`（下一輪閉合）

新增 Edges：
- `CapturePixel --RESAMPLED_INTO--> NormalizedPixelTensor`
- `NormalizedPixelTensor --PATCHIFIED_INTO--> PatchInputWitness`
- `PatchInputWitness --HAS_GEOMETRIC_SUPPORT--> CaptureRegion`
- `PatchInputWitness --EMBEDDED_AS--> VisionPatchEmbeddingWitness`
- `VisionPatchEmbeddingWitness --MIXED_BY--> VisionTransformer`
- `VisionPatchEmbeddingWitness --MERGED_INTO--> VisionTokenIdentity`
- `VisionTokenIdentity --INSERTED_INTO--> MultimodalSequence`

## 本輪結束判斷

- **缺哪一層**：`raw vision patch → spatial merger → exact LLM multimodal sequence position`。
- **哪個節點最淺**：`ExactTokenIdentityBridge`。
- **哪個概念仍只是名詞**：`EncodedTokenSemanticSupport`；目前不能把 attention map 當 causal support。
- **哪個系統值得讀原始碼**：Qwen2-VL modeling 的 vision patch embedding、spatial merger、M-RoPE 與 multimodal placeholder expansion。
- **哪篇論文需追引用**：Qwen2-VL，尤其 dynamic resolution/M-RoPE 後續模型；SigLIP 2 則追 NaFlex/localization 系列。
- **哪個概念最適合視覺模擬**：`Pixel → Patch → Visual Token Microscope`。
- **哪個 Agent 架構最值得實作**：`Provenance-grounded Computer Agent`：ObservationEnvelope + CaptureFidelityGate + VisionPreprocessManifest + ExactTokenIdentityBridge + PreAction State/Target Verifier。

本輪最重要的推進是：**Hermes 的可驗證鏈第一次從 Android compositor/capture pixel 跨進 Vision Encoder。現在已能把「Agent screenshot 中哪個 pixel 來自哪個 GraphicBuffer generation」接到「這些 pixels 經過什麼 resize/normalize/patchify 後進入哪個 vision patch」。下一輪只要閉合 spatial merger 與 multimodal sequence index，就能第一次形成 `GraphicBuffer generation → capture pixel → vision patch → LLM-visible visual token` 的 deterministic identity chain。**