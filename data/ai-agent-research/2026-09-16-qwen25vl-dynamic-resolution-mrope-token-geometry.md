# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 16:51 Asia/Taipei

## 本小時新發現

本輪接續上一輪 `Multimodal Dynamic Geometry × Vision Encoder CUDA Graph × Encoder Cache`，刻意補上最缺的 `raw pixels / frames → model-specific exact token geometry`。研究焦點為 Qwen2.5-VL 的 dynamic resolution、`image_grid_thw / video_grid_thw`、spatial merge、dynamic FPS 與 MRoPE，並交叉讀 Hugging Face Transformers、vLLM 與 Qwen vision preprocessing 原始碼。

核心新結論：對 Qwen2.5-VL 類架構，raw image resolution 不是直接等於 LLM visual token 數。輸入先被 smart-resize 到符合 patch/merge 因子的尺寸，再形成 `(T,H,W)` patch grid；vision encoder 輸出經 spatial merge 後，LLM 接收到的 visual token 數可由 `prod(grid_thw) / spatial_merge_size²` 精確表示。Transformers 的 Qwen2.5-VL 實作直接用此公式切分 image embeddings。

## 本小時最重要 5 個發現

### 1. Qwen2.5-VL visual-token count 可以從 grid 精確計算

已確認工程實作：Transformers `Qwen2_5_VLForConditionalGeneration.get_image_features()` 使用：

`split_sizes = image_grid_thw.prod(-1) // spatial_merge_size**2`

因此對單一 image/video item：

`N_visual = T_grid × H_grid × W_grid / merge_size²`。

Qwen2.5-VL processor config 的典型參數為 `patch_size=14`、`temporal_patch_size=2`、`merge_size=2`。對 still image，processor 仍使用 temporal patch packing；外部 resize factor 因而常以 `patch_size × merge_size = 28` 為空間粒度。

底層：
`Raw H×W → smart resize to 28-multiple → patch grid → ViT → 2×2 spatial merge → LLM visual embeddings`。

重要性：上一輪的 `VisionTokenGeometry` 現在不再只是抽象 node，可以直接計算 LLM context 增量。

來源：Transformers Qwen2.5-VL modeling source；Qwen2-VL/Qwen2.5-VL processor docs/config。

### 2. Smart resize 是「幾何約束 + token budget」而不是任意縮圖

已確認工程實作：Qwen vision preprocessing 的 `smart_resize` 會讓 H/W 可被 factor 整除，限制總 pixel 數在 min/max pixels，並盡量保持 aspect ratio；超出 max 時按面積比例縮小，低於 min 時放大。Qwen utility 中 image resize factor 由 `image_patch_size × SPATIAL_MERGE_SIZE` 形成。

因此：

`Raw Pixels → Aspect Ratio Constraint → Area Budget → Divisibility Constraint → Resized H,W`。

這代表 `min_pixels / max_pixels` 實際上是 perception compute budget knob。官方 Transformers 文件也直接把 `256×28×28` 到 `1024×28×28` 解釋為約 256–1024 image tokens 的設定方式。

限制：不同 Qwen 世代的 patch size 已開始不同；Qwen3-VL utility 明確允許 Qwen2.5-VL 使用 14、Qwen3-VL 使用 16，所以 Hermes 不能把 28 寫死成所有 VLM 通則。

### 3. Video 的 token geometry 多了一個真正的 temporal budget

已確認工程實作：vLLM Qwen2.5-VL schema 將 video pixel tensor表示為 `(num_patches, channels × temporal_patch_size × patch_size²)`，並攜帶 `video_grid_thw`、`second_per_grid_ts` 與 timestamps。Qwen utility 的 `smart_nframes` 則先依 requested fps / nframes、min/max frames 與 frame factor 決定實際抽樣 frame 數。

底層：
`Video duration + source FPS → sampled frames → temporal patch packing → T_grid → H_grid/W_grid → spatial merge → visual tokens`。

因此 video cost 不是單純 `duration × resolution`，而是：

`N_video_visual ≈ T_grid × H_grid × W_grid / merge_size²`

其中 `T_grid` 又受 frame sampling 與 temporal patch size 控制。

### 4. MRoPE 把「token 數」與「時間位置」分成兩個不同問題

已確認工程實作：Transformers Qwen2.5-VL 使用三軸 position IDs；text 走一般 1D progression，image/video 依 `grid_thw` 建立 temporal/height/width position。對 video，temporal spacing 會乘上 `tokens_per_second × second_per_grid_ts`；image 則不做 video temporal scaling。

所以：

`Visual token count` 決定算多少 token；
`MRoPE coordinates` 決定這些 token 在時間/空間位置上如何被模型感知。

這兩者不能混為一談。一段影片即使經不同 FPS sampling 得到相近 token count，MRoPE 的 temporal interval 仍可能不同，因為它保留時間尺度資訊。

Qwen2.5-VL 官方架構說明也指出 dynamic FPS sampling 與更新後的 MRoPE 用 absolute-time alignment 學習 temporal sequence / speed。

### 5. Multimodal runtime 可以在 encoder 前預估 decoder context cost

合理工程推論，建立在已確認公式上：只要 processor 已決定 resized geometry 與 frame count，runtime 在真正跑完整 vision encoder 前，就能估計：

`visual tokens → LLM prefill length → KV allocation → attention cost bucket`。

因此 Hermes 可以新增 `PreEncoderCostEstimator`：

`Media metadata → Processor policy → predicted grid_thw → predicted visual tokens → encoder graph budget + decoder prefill/KV budget`。

這能讓上一輪的 Encoder CUDA Graph planner 與 Decoder PhysicalExecutionPlanner 在 vision encoder 執行前就做 joint planning，而不是 encoder 完成後才知道 context shape。

限制：data-dependent visual token pruning、adaptive tiling、OCR crop generation 等模型會讓 pre-encoder estimate 變成上界或概率估計，而非精確值。

## Architecture Breakdown

```text
Image
→ Decode
→ Smart Resize
   ├ aspect ratio
   ├ min_pixels
   ├ max_pixels
   └ divisible-by-(patch×merge)
→ Resized H,W
→ Patchify (14×14)
→ image_grid_thw = [T,Hg,Wg]
→ Vision Transformer
→ Spatial Merge (2×2)
→ N_visual = T×Hg×Wg/4
→ Projected Visual Embeddings
→ Multimodal Placeholder Merge
→ LLM Prefill
→ KV Allocation
→ Decode
```

Video：

```text
Video
→ Decode metadata
→ duration / source FPS
→ smart_nframes / dynamic FPS sampling
→ sampled frames
→ spatial smart resize
→ temporal patch packing (2 frames)
→ video_grid_thw = [Tg,Hg,Wg]
→ Vision Transformer
→ Spatial Merge
→ visual embeddings
→ MRoPE(T,H,W + absolute-time interval)
→ LLM Prefill
```

### System Architecture：Geometry-Aware Multimodal Execution Planner

`PerceptionGeometryPlan = f(media_geometry, processor_revision, min_pixels, max_pixels, patch_size, temporal_patch_size, spatial_merge_size, fps_policy, pruning_policy)`。

輸出：`resized_geometry, grid_thw, predicted_visual_tokens, encoder_graph_budget, decoder_context_delta, position_geometry`。

## Bottom-Level Logic

本輪深入 mechanism：Qwen-style dynamic-resolution tokenization。

```text
1 讀 raw image H,W 或 video duration/FPS
2 取得 processor patch_size / temporal_patch_size / merge_size
3 factor = patch_size × merge_size
4 smart_resize：
   - round H/W to factor
   - 若 area > max_pixels，依 sqrt(area/max_pixels) 等比例縮小
   - 若 area < min_pixels，依 sqrt(min_pixels/area) 等比例放大
5 image: 建立 patch grid
   Hg = resized_H / patch_size
   Wg = resized_W / patch_size
   T 依 processor 的 temporal packing規則
6 video: 先 smart_nframes，再按 temporal_patch_size 形成 Tg
7 ViT 接收 patch sequence
8 spatial merger 每 merge_size×merge_size 空間 patches 合成一個 LLM visual embedding
9 N_visual = prod(grid_thw) / merge_size²
10 processor 用相同 token 數替換 image/video placeholder
11 MRoPE 為 visual tokens 建立 T/H/W position IDs
12 decoder prefill 長度 += N_visual
13 KV/cache/runtime planner 使用新的 context geometry
```

## 可計算例子

對已經 resize 為 `1960×1120` 的 still image，patch=14、merge=2：

`Hg=1120/14=80`
`Wg=1960/14=140`

若 image temporal grid T=1，merge 後：

`N_visual = 1×80×140/4 = 2800`。

這個例子刻意從「processor 已決定 resize 結果」開始；raw 1920×1080 是否會精確 resize 成這組尺寸，取決於 min/max pixel budget 與 smart-resize rounding，因此 Digital Twin 應先執行 processor policy，而不能直接用 raw pixels / 784 粗除。

## Visual Simulation Idea

### Qwen Visual Token Geometry Microscope

左側：raw image/video、H×W、duration、source FPS。

中央：
`Smart Resize → 28-grid → 14×14 patches → image/video_grid_thw → 2×2 merge → visual tokens`。

右側同步顯示：
- raw pixels
- resized pixels
- patch count
- merged visual tokens
- sampled video frames
- temporal grid
- MRoPE T/H/W coordinates
- encoder CUDA Graph budget
- decoder context increment
- estimated KV bytes

互動重點：拖動 max_pixels，直接看 resize boundary → patch-grid boundary → visual-token boundary → CUDA Graph bucket → LLM context cost 的連鎖變化；影片則拖 FPS，分開看「token 數變化」與「MRoPE temporal spacing 變化」。

## Code / GitHub

### Hugging Face Transformers
值得讀：
- `src/transformers/models/qwen2_5_vl/modeling_qwen2_5_vl.py`：`image_grid_thw.prod(-1) // spatial_merge_size**2`、vision position IDs、MRoPE temporal spacing。
- Qwen2/Qwen2.5-VL image processor：patch=14、temporal_patch=2、merge=2、min/max pixel policy。

### vLLM
值得讀：
- `vllm/model_executor/models/qwen2_5_vl.py`：image/video TensorSchema、`grid_thw`、timestamps、vision encoder runtime。
- 下一輪應接回 `encoder_cudagraph.py`，把 exact Qwen geometry 放進 graph budget simulator。

### Qwen vision utilities
值得讀：
- `qwen-vl-utils/src/qwen_vl_utils/vision_process.py`：`smart_resize`、`fetch_image`、`smart_nframes`。

## Papers

### Qwen2.5-VL Technical Report
Authors: Qwen Team / Yaowei Wang et al.（完整作者清單下一輪從正式 paper metadata 固化）
Institution: Alibaba / Qwen Team
Year: 2025
URL: https://arxiv.org/abs/2502.13923
Code: https://github.com/QwenLM/Qwen2.5-VL
Architecture: dynamic-resolution ViT + window attention + multimodal projector + Qwen2.5 LLM；video 採 dynamic FPS + temporal MRoPE。
Contribution: 把 native dynamic resolution 擴展到時間軸，並使 position encoding 對影片時間尺度敏感。
Limitations: processor/runtime 的實際成本仍高度依賴 resolution、frames、token budget 與 serving backend；technical report 的模型能力結果不能直接當 serving performance 結論。

## Unknown / Open Questions

1. Qwen2.5-VL image still-frame 的 temporal duplication/packing 在各 processor version 中是否完全一致？需逐版本追 image processor tensor construction，而不能只靠 `grid_thw` 最終值推回。
2. vLLM encoder cache identity 是否把 `min_pixels/max_pixels/fps/processor revision` 全部納入 hash？若同一 media bytes 在不同 processor policy 下產生不同 grid，cache correctness 必須保證不誤 hit。
3. 能否在 processor 前只用 metadata 建立安全 upper-bound `grid_thw`，讓 admission control 在尚未 decode 完整 media 前預留 encoder/decoder GPU budget？

## 下一輪研究

`Multimodal Cache Identity × Processor Revision Hash × Qwen image/video preprocessing exact tensor construction × Encoder Cache Correctness × Pre-Admission Cost Estimation`。

接著把：

`Media bytes → hash → preprocessing policy → grid_thw → encoder embedding cache key → graph budget → decoder context/KV budget`

串成可驗證的一條 state/cost path。

## Knowledge Graph 新增 Node / Edge

Nodes：`SmartResize`, `PixelBudget`, `PatchFactor`, `SpatialPatchGrid`, `TemporalPatchGrid`, `ImageGridTHW`, `VideoGridTHW`, `SpatialMerge`, `VisualTokenCountFormula`, `DynamicFPSSampling`, `MRoPETemporalInterval`, `PerceptionGeometryPlan`, `PreEncoderCostEstimator`, `ProcessorPolicySignature`, `DecoderContextDelta`。

Edges：
- `RawResolution → SmartResize → ResizedGeometry`
- `PatchSize × SpatialMergeSize → ResizeDivisibilityFactor`
- `ResizedGeometry → PatchGrid → GridTHW`
- `GridTHW ÷ SpatialMerge² → VisualTokenCount`
- `VideoFPSPolicy → SampledFrames → TemporalGrid`
- `VideoTimeInterval → MRoPETemporalCoordinates`
- `VisualTokenCount → EncoderGraphBudget`
- `VisualTokenCount → DecoderPrefillLength`
- `DecoderPrefillLength → KVAllocation`
- `ProcessorPolicySignature → PerceptionGeometryPlan`

## 本輪結束判斷

缺哪一層：`media identity + processor policy → cache identity/correctness`。

哪個節點最淺：`ProcessorPolicySignature`、still-image temporal packing 的跨版本一致性。

哪個概念仍只是名詞：`PreEncoderCostEstimator` 的 admission-control integration。

哪個系統值得讀原始碼：vLLM multimodal hashing/cache pipeline + Transformers Qwen2.5-VL processor。

哪篇論文需追引用：Qwen2.5-VL Technical Report，尤其後續 dynamic FPS / MRoPE / visual-token efficiency serving papers。

哪個概念最適合視覺模擬：`Raw Pixels/Frames → Smart Resize → Grid THW → Merge → Visual Tokens → MRoPE → Context/KV`。

哪個 Agent 架構最值得實作：Hermes `PerceptionExecutionPlanner`，新增 `GeometryEstimator + CacheIdentityVerifier + Encoder/Decoder Joint Cost Estimator`。

## 驗證分級

已確認事實／官方或主流工程實作：Qwen processor patch/temporal/merge parameters；smart-resize constraints；Transformers `prod(grid_thw)/merge²` embedding split；vLLM image/video schema；MRoPE 三軸與 video time interval。

論文結果：Qwen2.5-VL technical report 對 dynamic FPS / MRoPE 的模型設計敘述。

合理工程推論：PreEncoderCostEstimator、joint admission planning、processor-policy-aware cache signature。

尚未驗證假說：metadata-only admission upper bound 的最佳保守公式，以及跨 processor versions 的 cache-key 完整性。