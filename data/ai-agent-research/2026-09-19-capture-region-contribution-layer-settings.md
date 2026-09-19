# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 08:55（Asia/Taipei）

主題：CaptureRegionContributionWitness × LayerSettings × RenderEngine Composition

## 本小時新發現

本輪接續 07:52 已閉合的 `ExactLogicalGenerationJoin`，不再追 ExternalTexture/GraphicBuffer identity，而往下一層：exact captured logical generation 如何變成 capture buffer 的 target-region pixels。

核心突破：AOSP `compositionengine::LayerFE::LayerSettings` 本身就是 `renderengine::LayerSettings` 的 superset，並額外保留 `bufferId` 與 `frameNumber`；`prepareClientCompositionList()` 回傳 z-ordered LayerSettings，官方註解明確指出這個 list 會傳給 `RenderEngine::drawLayers()`，且一個 Layer 可以產生多個 settings（例如 shadow + content）。因此可把上一輪的 generation key 延伸到真正的 render primitive，而不必在 `LayerFE → RenderEngine` 邊界丟失 identity。

SurfaceFlinger capture path 會遍歷 capture layer set、建立 `LayerFE::ClientCompositionTargetSettings`、取得每層 `prepareClientCompositionList()`，把結果聚合成 `clientCompositionLayers`，最後交給 `RenderEngine::drawLayers()` 寫入 capture buffer。capture result fence 則標記 RenderEngine output 完成。

因此新鏈：

```text
Captured Logical Generation
(layerId, bufferId, frameNumber)
→ LayerFE
→ prepareClientCompositionList
→ LayerFE::LayerSettings[]
→ renderengine::LayerSettings[]
→ RenderEngine::drawLayers
→ Capture Buffer
→ Capture Fence
→ Pixels
```

這把最淺節點從「哪一代 buffer 被 capture」推進到「哪一代 buffer 產生哪些 capture render primitives」。

## 本小時最重要 5 個發現

### 1. LayerSettings 保留 bufferId + frameNumber，identity 可跨進 RenderEngine input

**已確認 / AOSP official source**：`LayerFE::LayerSettings : renderengine::LayerSettings`，並有 `uint64_t bufferId`、`uint64_t frameNumber`。`prepareClientCompositionList()` 回傳 z-ordered list 給 `RenderEngine::drawLayers()`。

底層：

```text
LayerSnapshot generation
→ LayerFE
→ LayerFE::LayerSettings {
   bufferId,
   frameNumber,
   source,
   geometry,
   alpha,
   colorTransform,
   blend/effects...
 }
→ RenderEngine
```

重要性：Hermes 可以建立 `CaptureRenderPrimitiveWitness`，而不是只保存 screenshot-level manifest。

限制：一個 logical layer 可展開成多個 render primitives；不能假設 Layer ↔ LayerSettings 一對一。

### 2. Capture 是 z-ordered LayerSettings composition，不是「複製 layer pixels」

**已確認工程實作**：SurfaceFlinger capture path 聚合 client-composition settings，再呼叫 `RenderEngine::drawLayers()`。capture 還可能加入 fill layer；blur、shadow、hole punch、solid-color/effect primitives 也可能出現在 LayerSettings list。

因此：

```text
Logical Layer Generation
≠ single Capture Primitive
```

正確模型：

```text
Logical Generation
→ 0..N Render Primitives
→ ordered composition
→ output pixels
```

### 3. Region contribution 必須是 compositing function，而非 rectangle overlap

`LayerSettings` 的 source 與非-buffer state會共同決定 output：geometry boundaries、source buffer、alpha、dataspace/color transform、disableBlending、shadow、blur/stretch/edge effects 等。AOSP client-composition request cache 比較 LayerSettings 時也明確把 geometry、alpha、dataspace、color transform、blending、shadow、blur/stretch/edge-extension 視為 render-relevant state。

Hermes 應定義：

```text
Contribution(P_i, R)
= Rasterize(
    source_i,
    geometry_i,
    transform_i,
    crop_i,
    alpha_i,
    blend_i,
    effects_i,
    color_i,
    prior_composite
  ) ∩ R
```

所以 `bounds intersects target` 只能是候選 contributor，不是 proof。

### 4. Capture output fence 證明 render completion，但不證明單 primitive 的 pixel attribution

SurfaceFlinger 把 RenderEngine `drawLayers()` 的結果 fence 放進 capture result，並可將 release/completion signal 回饋給 rendered layers。

可確認：

```text
LayerSettings input set
→ drawLayers
→ CaptureBuffer
→ CaptureRenderFence
```

但不能從單一 fence 推導：

```text
Primitive P_i → exact pixel x,y
```

因此下一層仍需要 per-region attribution / counterfactual or instrumented RenderEngine evidence。

### 5. Computer Agent 安全上，target-region provenance 應成為 action authorization 的獨立 channel

近期 `Visual Confused Deputy` 把 grounding error、screenshot manipulation、TOCTOU 視為安全問題，提出 agent perception loop 外的 independent guardrail；StateAct 則顯示 program-state grounding + independent finish verification 優於 screenshot-only；Tactile 將 accessibility/OCR/visual evidence轉為帶 provenance 的 action-grounded targets。

Hermes 可以把 compositor evidence加入同一原則：

```text
Agent says: click target T
↓
Visual target evidence
+
Program-state evidence
+
CaptureRegionContributionWitness
+
Generation freshness
↓
Authorization Gate
```

限制：compositor provenance證明 pixels 的來源與 freshness，不等於語義上「這個按鈕是安全的」。

## Architecture Breakdown

### Capture-side system architecture

```text
Capture Request
→ Capture Snapshot Epoch
→ LayerSnapshot Set
→ Exact Logical Generation Key
   (layerId, GraphicBufferId, frameNumber)
→ LayerFE
→ ClientCompositionTargetSettings
→ prepareClientCompositionList()
→ LayerSettings[] (z ordered)
→ RenderEngine::drawLayers()
→ Capture GraphicBuffer
→ Render Fence
→ Encoder / Screenshot Consumer
→ Vision Tokens
→ Agent
```

### Identity-preserving primitive model

```text
CaptureRenderPrimitiveWitness {
  primitive_id,
  source_layer_id,
  source_buffer_id?,
  source_frame_number?,
  primitive_kind,
  z_index,
  geometry,
  source_crop,
  transform,
  alpha,
  blend_state,
  effects,
  dataspace,
  protected_state,
  capture_epoch
}
```

`buffer_id?` 必須 nullable，因為 solid-color/effect/shadow/hole-punch primitive 不一定有普通 source buffer。

### System reasoning vs model reasoning

```text
SYSTEM REASONING
exact generation join
→ primitive expansion
→ region candidate set
→ occlusion/blend/effect analysis
→ freshness / provenance confidence
→ authorization evidence

MODEL REASONING
pixels/tokens
→ semantic interpretation
→ task planning
→ intended action
```

兩者不可混為「模型自己看圖判斷」。

## Bottom-Level Logic

### Generation → primitive expansion

```text
G=(layerId,bufferId,frameNumber)
→ LayerFE
→ prepareClientCompositionList(targetSettings)
→ [P0,P1,...Pn]
```

每個 P 保留 render state；buffer-backed content primitive 可保留 G，其他 effect primitive以 `derived_from(layerId,captureEpoch)` 建 provenance edge。

### Region candidate phase

對 target capture region R：

```text
P.geometry
→ transform to capture/output space
→ clip against capture RenderArea
→ candidate visible region
→ intersect R
```

若無 intersection：`NO_REGION_CONTRIBUTION`。

若有 intersection，只標 `REGION_CANDIDATE`。

### Composition phase

```text
z-order
→ source sampling
→ alpha
→ blending
→ color transform/dataspace
→ blur/shadow/stretch/edge effects
→ occlusion by later primitives
→ final capture pixel
```

只有處理這些後才能升級為 `REGION_CONTRIBUTION_BOUND`。

### Evidence ladder

```text
EXACT_LOGICAL_GENERATION_JOIN
< PRIMITIVE_BOUND
< REGION_CANDIDATE
< REGION_COMPOSITION_BOUND
< CAPTURE_PIXEL_BOUND
< VISION_TOKEN_REGION_BOUND
```

本輪把 Hermes 從 `EXACT_LOGICAL_GENERATION_JOIN` 推到可實作的 `PRIMITIVE_BOUND`，並定義 `REGION_CANDIDATE` 的 deterministic first pass。

## Visual Simulation Idea

### Capture Compositor Contribution Microscope

左側：capture layer/generation tree；中央：z-ordered LayerSettings cards；右側：capture buffer。

點 target region R 後：

```text
R
← P7 button buffer L12/B91/F471 [candidate]
← P8 translucent overlay L19/B22/F88 [blend contributor]
← P9 shadow from L20 [effect contributor]
← P10 opaque modal L21/B30/F9 [occludes 63%]
```

滑桿：alpha、z-order、crop、transform、blur radius、color transform；開關：secure omission、solid-color layer、hole punch、bufferless effect、capture epoch change。

每個 primitive 顯示：`SOURCE_GENERATION / DERIVED_EFFECT / CANDIDATE / OCCLUDED / BLENDED / FINAL_CONTRIBUTOR / UNKNOWN`。

## Code / GitHub

本輪值得追的 AOSP 核心位置：

- `services/surfaceflinger/CompositionEngine/include/compositionengine/LayerFE.h`
  - `LayerFE::LayerSettings`
  - `bufferId`
  - `frameNumber`
  - `prepareClientCompositionList()`
- `services/surfaceflinger/SurfaceFlinger.cpp`
  - capture/render path
  - `ClientCompositionTargetSettings`
  - `clientCompositionLayers`
  - `RenderEngine::drawLayers`
  - capture result fence
- `services/surfaceflinger/CompositionEngine/src/ClientCompositionRequestCache.cpp`
  - render-relevant LayerSettings equality state
- `services/surfaceflinger/CompositionEngine/src/planner/CachedSet.cpp`
  - blur / hole-punch derived LayerSettings
- 下一輪應讀 `libs/renderengine/LayerSettings.*`、Skia/GLES `drawLayers` backend，找 source crop/texture transform/blend/effect 實際 rasterization path。

## Papers

### Visual Confused Deputy: Exploiting and Defending Perception Failures in Computer-Using Agents
Authors: Xunzhuo Liu, Bowei He, Xue Liu, Andy Luo, Haichen Zhang, Huamin Chen
Year: 2026
URL: https://arxiv.org/abs/2603.14707
Architecture: independent dual-channel contrastive guardrail，分別驗證 visual click target 與 agent reasoning，再決定是否允許 execution。
Contribution: 將 visual grounding / TOCTOU 從 accuracy 問題提升成 authorization/security 問題。
Limitations: guardrail仍主要在 visual/semantic evidence層，不提供 OS compositor generation provenance。
Change for Hermes: `CaptureRegionContributionWitness` 可成為 perception loop 外的第三個 deterministic provenance channel。

### StateAct: Program State, before Pixels, for Long-Horizon Computer-Use Agents
Authors: Yan Yang et al.
Year: 2026
URL: https://arxiv.org/abs/2607.22798
Dataset: OSWorld 2.0 tasks.
Architecture: code-first main agent + GUI subagent + independent finish gate + fresh subagents for long horizon context control.
Contribution: program-state grounding將 screenshot-only baseline 的 binary success 20.6% 提升到 26.9%，partial 54.8% 到 61.6%。
Limitations: program state不是所有 visual/OS compositor state的完整替代。
Change for Hermes: program-state witness 與 capture/render provenance 應合併，而不是互相取代。

### Tactile: Giving Computer-Using Agents Hands and Feet
Authors: Yong Liu, Zhenyi Zhong, Zhanpeng Shi
Year: 2026
URL: https://arxiv.org/abs/2607.14443
Architecture: accessibility semantics + OCR-grounded text + visual fallback → action-grounded interface states → observe-ground-act-verify。
Contribution: 將 action target變成帶 source/state/geometry/verification cues 的可稽核物件。
Limitations: 不提供 compositor-level pixel generation lineage。
Change for Hermes: action target object 應可附加 `CaptureRegionContributionWitness` 與 generation freshness。

## Unknown / Open Questions

1. `renderengine::LayerSettings` 的 exact source crop / texture transform / geometry mapping 在 current Skia backend 如何變成 sampled source coordinates？需要直接讀 backend shader/Skia draw path。
2. blur、shadow、stretch、edge-extension 會讓 contribution 超出原始 geometry；如何建立 conservative-but-useful influence region，而不必做昂貴的 per-pixel symbolic rendering？
3. sideband/protected content在 capture 中可能被省略、替代或受政策限制；`CapturePrimitiveGenerationUnion` 仍需為 buffer-backed / bufferless effect / sideband 定義不同 identity domain。

## 下一輪研究

直接追：

```text
LayerFE::LayerSettings
→ renderengine::LayerSettings
→ SkiaRenderEngine / GLES RenderEngine
→ source texture sampling
→ texture transform / crop
→ geometry transform
→ alpha / blending
→ blur/effect expansion
→ z-order / occlusion
→ output pixel
```

目標：把 `REGION_CANDIDATE` 升級成 `REGION_COMPOSITION_BOUND`，建立第一版 `CaptureRegionContributionWitness` 演算法與可觀測 instrumentation points。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `CaptureRenderPrimitiveWitness`
- `LayerSettingsGenerationBinding`
- `CapturePrimitiveKind`
- `CapturePrimitiveGenerationUnion`
- `CaptureRegionCandidate`
- `CaptureRegionContributionWitness`
- `CaptureCompositionState`
- `DerivedEffectPrimitive`
- `CaptureRenderFenceWitness`
- `RegionAuthorizationEvidence`

### Edges

```text
ExactLogicalGenerationJoin
→expands_to→ CaptureRenderPrimitiveWitness

LogicalLayerBufferGenerationKey
→bound_by→ LayerSettingsGenerationBinding

LayerFE
→prepares→ CaptureRenderPrimitiveWitness

CaptureRenderPrimitiveWitness
→intersects→ CaptureRegionCandidate

CaptureRegionCandidate
+ CaptureCompositionState
→supports→ CaptureRegionContributionWitness

CaptureRegionContributionWitness
→contributes_to→ CaptureBufferRegion

CaptureBufferRegion
→encoded_into→ VisualTokenRegion

CaptureRegionContributionWitness
+ GenerationRevalidationGate
→feeds→ RegionAuthorizationEvidence
```

## 本輪結束判斷

- 缺哪一層：`LayerSettings render primitive → exact post-blend/effect target-region contribution`。
- 哪個節點最淺：`CaptureRegionContributionWitness`，但其前一層 `CaptureRenderPrimitiveWitness` 已可由 AOSP LayerSettings 實作。
- 哪個概念仍只是名詞：跨 blur/shadow/sideband/bufferless effect 的完整 `CapturePrimitiveGenerationUnion`。
- 哪個系統值得讀原始碼：AOSP RenderEngine current Skia backend 的 `drawLayers`、texture sampling、geometry/blend/effect path。
- 哪篇論文需追引用：Visual Confused Deputy；其 independent authorization guardrail 很適合加入 deterministic compositor provenance channel。
- 哪個概念最適合視覺模擬：`Capture Compositor Contribution Microscope`。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + ObservationEnvelope + Exact Generation Join + CaptureRegionContributionWitness + Independent Target Authorization + PreAction Revalidation + Risk Gate`。

本輪最大的進展：上一輪只證明 capture 與 presentation 是同一個 `(layerId, bufferId, frameNumber)` generation；本輪找到 identity 可繼續保留到 `LayerFE::LayerSettings`，而 LayerSettings 正是 RenderEngine 的 z-ordered composition input。Hermes 因此已能從「哪一代 layer 被 capture」推進到「這一代 layer 展開成哪些真正送進 RenderEngine 的 render primitives」。下一個硬邊界是把 geometry/crop/transform/blending/effects 解析成 target-region 的實際 contribution。