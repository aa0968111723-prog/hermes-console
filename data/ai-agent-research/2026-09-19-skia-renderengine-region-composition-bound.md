# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 09:53（Asia/Taipei）

主題：Skia RenderEngine × Source Sampling × Blend/Effect Influence × REGION_COMPOSITION_BOUND

## 本小時新發現

本輪接續 08:55 的 `CaptureRenderPrimitiveWitness → CaptureRegionCandidate`，不再重複 LayerSnapshot/GraphicBuffer identity，而直接讀 AOSP RenderEngine/Skia backend，追 `LayerSettings` 如何真正變成 capture pixels。

核心突破：AOSP `SkiaRenderEngine` 在 buffer-backed layer 上直接取得 `ExternalTexture` 對應的 GraphicBuffer、等待 source fence、建立 backend texture/SkImage，並把 `LayerSettings.source.buffer.textureTransform` 正規化後映射到實際 image width/height。RenderEngine 還會依 `isOpaque`、premultiplied alpha、layer alpha、dataspace/color transform、tone mapping、stretch、rounded geometry、blur/shadow 等建立不同 shader / paint / effect path。因此 `CaptureRegionContributionWitness` 可以從「rectangle candidate」升級為「render-state-bound composition witness」，但仍不能在沒有 GPU shader instrumentation 或 counterfactual render 的情況下宣稱逐 pixel causal attribution。

新證據階梯：

```text
EXACT_LOGICAL_GENERATION_JOIN
→ PRIMITIVE_BOUND
→ REGION_CANDIDATE
→ REGION_COMPOSITION_BOUND   [本輪]
→ CAPTURE_PIXEL_BOUND
→ VISION_TOKEN_REGION_BOUND
```

## 本小時最重要 5 個發現

### 1. Source texture sampling 的 identity 與 coordinate mapping 可在 Skia backend 觀測

**已確認 / AOSP source**：`SkiaRenderEngine` 對 `layer.source.buffer.buffer` 建立 backend texture / SkImage；若 source buffer 帶 fence，先等待 fence。`textureTransform` 不是抽象 metadata，而會先依 layer bounds 正規化，再依 image width/height 映射成實際 texture sampling matrix。

底層：

```text
GraphicBuffer generation
→ ExternalTexture
→ wait source fence
→ backend texture
→ SkImage
→ textureTransform
→ normalize by layer bounds
→ scale to image dimensions
→ sampled source coordinates
```

重要性：Hermes 可以建立 `SourceSamplingWitness`，把 source generation 與 output-space candidate region之間的 coordinate mapping保存下來。

限制：matrix mapping證明「會從哪個 source domain取樣」，不證明每個 output pixel最終值，因為後面仍有 blending/color/effects。

### 2. Alpha/opacity 不是單一 layer.alpha；buffer alpha interpretation 也是 render state

**已確認工程實作**：Skia backend會依 source buffer `isOpaque` 與 `usePremultipliedAlpha` 選擇 alpha interpretation，並結合 `LayerSettings.alpha`。部分格式還有 opaque workaround；alpha=0 也不一定能直接 skip，因為 color/effect path可能仍要求處理。

正確模型：

```text
SourceRGBA
→ source alpha interpretation
→ premultiplied/unpremultiplied handling
→ layer alpha
→ blend mode
→ prior composite
→ output
```

因此 Hermes 不應把 `alpha=1` 當成「必然完全覆蓋」，也不能把 `alpha=0` 在所有 effect/color branch下當成「零貢獻」。

### 3. Color transform / dataspace / tone mapping 會改變 pixel value，但通常不改變基本幾何 support

**已確認**：RenderEngine 會比較 source/output dataspace、layer color transform、HDR/dimming條件，必要時建立 linear/color effect shader。這意味 provenance 必須分開記錄：

```text
GeometricSupportWitness
vs
PixelValueTransformWitness
```

前者回答「可能影響哪些 output locations」；後者回答「source value如何被轉換」。

重要性：對 Agent target authorization，多數情況先需要 support/freshness；若做 pixel-exact forensic，才需要完整 color pipeline。

### 4. Blur / shadow / stretch 讓 contribution support 超出 content geometry，必須引入 influence region

AOSP RenderEngine tests/cache paths顯示 shadow、background blur、blur regions、stretch都有獨立 render state；blur會讀取先前 composite surface，shadow可延伸出 caster bounds。因此：

```text
ContentGeometry
≠ EffectInfluenceRegion
```

Hermes 應建立 conservative influence region：

```text
PrimitiveSupport(P)
= transformed content bounds
  ∪ shadow expansion
  ∪ blur read/write influence
  ∪ stretch/edge-extension support
```

這比只做 rectangle overlap強，且不必立刻做昂貴的 symbolic GPU rendering。

限制：blur是跨 primitive dependency；只知道 blur layer自身 source generation不足以歸因被 blur 的背景 generations。

### 5. `REGION_COMPOSITION_BOUND` 可以 deterministic 建立，但 `CAPTURE_PIXEL_BOUND` 仍需更強 instrumentation

本輪可確認的 witness：

```text
RegionCompositionWitness {
  capture_epoch,
  primitive_id,
  logical_generation?,
  source_sampling_matrix?,
  transformed_geometry,
  clip/rounded support,
  z_index,
  source_alpha_mode,
  layer_alpha,
  blend_state,
  color_pipeline,
  effect_influence_region,
  dependencies[],
  target_region_intersection
}
```

如果 target R 與 primitive/effect support相交，且 render state完整，可標 `REGION_COMPOSITION_BOUND`。

但不能直接標 `CAPTURE_PIXEL_BOUND`，因為 exact post-blend pixel causal attribution仍需要 GPU/Skia draw instrumentation、ID buffer pass、或 counterfactual replay。

## Architecture Breakdown

```text
Capture Generation
(layerId, GraphicBufferId, frameNumber)
→ LayerFE::LayerSettings
→ RenderEngine::LayerSettings
→ SkiaRenderEngine
   ├ source fence wait
   ├ ExternalTexture → backend texture → SkImage
   ├ texture/source transform
   ├ geometry transform / rounded clip
   ├ source alpha interpretation
   ├ layer alpha / blending
   ├ dataspace / color transform / tone mapping
   ├ stretch
   ├ shadow
   └ background blur / blur regions
→ ordered canvas composition
→ Capture GraphicBuffer
→ completion fence
→ screenshot pixels
```

### 建議 Hermes runtime instrumentation

在進入 `drawLayers()` 前保存 immutable `CompositionInputManifest`；對每個 primitive建立 `RegionCompositionWitness`。不要嘗試從最終 screenshot反推完整 render state。

```text
CompositionInputManifest {
 capture_epoch,
 output_buffer_id,
 output_geometry,
 output_dataspace,
 primitives[]
}
```

每個 primitive包含 generation binding、source transform、geometry、alpha/blend、color/effect state與 dependency edges。

## Bottom-Level Logic

### A. Buffer-backed content

```text
LayerSettings.source.buffer
→ ExternalTexture/GraphicBuffer
→ acquire/source fence
→ backend texture
→ SkImage
→ textureTransform
→ source sampling coordinates
→ shader
→ geometry mask
→ alpha
→ blend into destination
```

### B. Solid-color / bufferless primitive

```text
solidColor
→ geometry
→ alpha
→ color pipeline
→ blend
```

identity domain應是 `derived/effect primitive id`，不能假裝有 GraphicBuffer generation。

### C. Shadow

```text
caster geometry/state
→ ShadowSettings
→ expanded influence region
→ shadow shader
→ destination blend
```

建立 `DERIVED_FROM(layer generation/state)` edge。

### D. Background blur

```text
prior composite generations
→ read destination/background region
→ blur kernel
→ blur region mask
→ write output region
```

這是一個 multi-source dependency；provenance必須是 hyperedge，而非單一 `layer → pixel` edge。

### E. Conservative region composition algorithm v1

```text
Input: target region R, z-ordered primitives P0..Pn

for P in primitives:
  S = transformed geometric support(P)
  S = apply clip/rounded-corner support(S)
  S = union(S, effectInfluence(P))
  if intersect(S, R) is empty:
      mark NO_REGION_CONTRIBUTION
  else:
      bind source sampling / alpha / blend / color / effect state
      collect dependencies (e.g. blur background)
      mark REGION_COMPOSITION_BOUND

Then process z-order conservatively:
  fully opaque, no-effect upper primitive may mark covered lower subregion OCCLUDED
  translucent/effect upper primitive keeps lower contributors as dependencies
```

這是 conservative causal support，不宣稱 exact numeric pixel decomposition。

## Visual Simulation Idea

### RenderEngine Pixel Provenance Workbench

三欄：

1. **Source Space**：GraphicBuffer + frame generation + texture coordinates。
2. **Composition Space**：z-order LayerSettings stack，顯示 geometry、alpha、blend、blur/shadow dependency。
3. **Capture Space**：target screenshot region與 contributor overlay。

互動：拖曳 target region，立即顯示：

```text
R(420,300..500,360)
├ P12 L7/B91/F471 CONTENT
│  source UV: ...
│  alpha: 1
│  status: OCCLUDED 18%
├ P13 L8/B55/F88 TRANSLUCENT
│  alpha: .42
│  status: BLEND CONTRIBUTOR
└ P14 BLUR from L9
   reads: P12 + P13 prior composite
   status: EFFECT DEPENDENCY
```

可切換 `geometry only / composition bound / hypothetical pixel-exact` 三種 evidence mode，避免 UI 把推論強度混在一起。

## Code / GitHub

本輪值得看的 AOSP 原始碼：

- `libs/renderengine/include/renderengine/LayerSettings.h`
  - Geometry / PixelSource / Buffer / alpha / color/effect state
- `libs/renderengine/skia/SkiaRenderEngine.cpp`
  - source buffer → backend texture/SkImage
  - source fence wait
  - textureTransform mapping
  - opaque/premultiplied alpha handling
  - color management / tone mapping / stretch shader
- `libs/renderengine/skia/SkiaGLRenderEngine.cpp`
  - drawLayers backend、blur pipeline、GraphicBuffer-backed SkImage path
- `libs/renderengine/skia/Cache.cpp`
  - image/solid/shadow/blur/stretch combinations used to prime shaders
- `libs/renderengine/tests/RenderEngineTest.cpp`
  - output-region assertions，可作 Hermes provenance instrumentation 的 regression oracle
- `services/surfaceflinger/Layer.cpp`
  - Layer state → LayerSettings geometry/alpha/color/blur mapping

## Papers

### A History-Aware Visually Grounded Critic for Computer Use Agents (HiViG)
Authors: Jaewoo Lee, Zaid Khan, Archiki Prasad, Justin Chih-Yao Chen, Supriyo Chakraborty, Kartik Balasubramaniam, Sambit Sahu, Elias Stengel-Eskin, Hyunji Lee, Mohit Bansal
Year: 2026
URL: https://arxiv.org/abs/2606.11078
Architecture: policy + multimodal critic；critic保存 macro-action history，並在 execution 前以當前 screenshot 驗證 raw action coordinates。
Contribution: 在 web/mobile/desktop benchmarks上，對強 baseline平均成功率提升 5.8%（Qwen3-VL-32B）與 9.0%（Gemini-3-Flash）。
Limitations: visual critic仍以 screenshot-level evidence為主，沒有 compositor generation/pixel provenance。
Change for Hermes: `RegionCompositionWitness` 可作為 visually-grounded critic之外的 deterministic pre-execution evidence channel。

### GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents
Authors: Chen Chen, Jiawei Shao, Dakuan Lu, Haoyi Hu, Xiangcheng Liu, Hantao Yao, Wu Liu
Year: 2026
URL: https://arxiv.org/abs/2601.09770
Architecture: two-stage coarse→fine active perception，agent主動選擇 crop/zoom等 visual tools。
Contribution: ScreenSpot-Pro 上 3B model以約3k labeled samples達44.8% grounding accuracy。
Limitations: 主動取得更清楚 screenshot不等於驗證 screenshot generation freshness或 pixel source。
Change for Hermes: active perception應與 `GenerationRevalidationGate + RegionCompositionWitness` 結合。

### Visual Confused Deputy: Exploiting and Defending Perception Failures in Computer-Using Agents
Authors: Xunzhuo Liu, Bowei He, Xue Liu, Andy Luo, Haichen Zhang, Huamin Chen
Year: 2026
URL: https://arxiv.org/abs/2603.14707
Architecture: visual target channel + reasoning channel 的 independent guardrail。
Contribution: 把 grounding error / screenshot manipulation / TOCTOU 建模成 action authorization問題。
Limitations: 不提供 OS compositor provenance。
Change for Hermes: composition witness可成為 guardrail 的 platform evidence channel。

## Unknown / Open Questions

1. Current Skia backend 中 geometry clip、rounded-corner mask與 blend mode的最終 draw call能否低成本輸出 per-primitive ID/coverage attachment，而不改變 production composition semantics？
2. Background blur是對 prior composite做取樣；要建立 exact contributor set，是否能用 RenderEngine debug replay + dependency mask，而不是對每個 source逐一重繪？
3. `CAPTURE_PIXEL_BOUND` 應定義為「exact source set」還是還要包含每個 source對 numeric RGBA 的貢獻權重？後者在非線性 color/tone/effect pipeline會顯著更難。

## 下一輪研究

直接追：

```text
SkiaRenderEngine draw path
→ canvas clip / geometry mask
→ shader / SkImage sampling
→ blend mode
→ blur dependency
→ actual draw calls
→ optional ID/coverage side pass
→ Capture Pixel Attribution Manifest
```

同時讀 RenderEngine tests，設計最小 instrumentation prototype：不改變正常 capture output，只在 debug/research mode產生 contributor-ID / coverage buffer。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `SourceSamplingWitness`
- `SourceSamplingMatrix`
- `GeometricSupportWitness`
- `PixelValueTransformWitness`
- `EffectInfluenceRegion`
- `RegionCompositionWitness`
- `CompositionInputManifest`
- `CompositionDependencyHyperedge`
- `BackgroundBlurDependency`
- `OpaqueOcclusionWitness`
- `CapturePixelAttributionManifest` (planned)

### Edges

```text
CaptureRenderPrimitiveWitness
→sampled_by→ SourceSamplingWitness

SourceSamplingWitness
+ GeometricSupportWitness
→supports→ CaptureRegionCandidate

CaptureRegionCandidate
+ alpha/blend/color/effect state
→bound_by→ RegionCompositionWitness

PriorCompositeGenerationSet
→influences→ BackgroundBlurDependency

BackgroundBlurDependency
→hyperedge_into→ RegionCompositionWitness

RegionCompositionWitness
→supports→ CaptureRegionContributionWitness

CaptureRegionContributionWitness
→next_target→ CapturePixelAttributionManifest
```

## 本輪結束判斷

- 缺哪一層：`REGION_COMPOSITION_BOUND → exact capture pixel attribution`。
- 哪個節點最淺：`CapturePixelAttributionManifest`；`RegionCompositionWitness` 已有可直接從 LayerSettings + Skia backend instrumentation取得的資料。
- 哪個概念仍只是名詞：`ExactNumericPixelContributionWeight`，尤其遇到 blur、tone mapping、nonlinear color transform時。
- 哪個系統值得讀原始碼：AOSP `SkiaRenderEngine.cpp` 的 actual canvas draw/clip/blend path與 blur filter implementation。
- 哪篇論文需追引用：HiViG，因為 pre-execution visually-grounded critic可直接和 Hermes platform provenance verifier合併比較。
- 哪個概念最適合視覺模擬：`RenderEngine Pixel Provenance Workbench`。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Active Perception + Generation Revalidation + Region Composition Verifier + History-aware Visual Critic + Independent Risk Gate`。

## 來源

AOSP RenderEngine / SurfaceFlinger official source；2026 GUI-agent papers：HiViG、GUI-Eyes、Visual Confused Deputy。重要底層結論以 LayerSettings 定義、SkiaRenderEngine implementation、RenderEngine tests/cache path交叉驗證。