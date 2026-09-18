# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-18 12:55 Asia/Taipei

## 本小時新發現

本輪承接上一輪 `Aggregation Closure × Pixel-Region Provenance`，不再重複 Surface closure / frame_index / primary-fallback，而是追最深缺口：**幾何上 intersect target pixel 的 quad，是否真的對最終顯示 pixel 有視覺貢獻？**

核心結論：答案是否定的。Chromium Viz 在 aggregation 後仍存在 SharedQuadState opacity/blend、mask/filter/backdrop filter、render-pass flatten/merge，以及 overlay promotion。特別是 overlay promotion 會把候選內容從一般 render-pass composition 路徑轉移到獨立硬體/平台 plane；因此 `PixelContributionGraph` 不能只停在 `Surface → Quad → transformed rect`，必須升級成 **VisualContributionGraph**，追到「最終 display composition」。

來源：
- Chromium `surface_aggregator.cc`: https://chromium.googlesource.com/chromium/src/+/d458f6381414eb46b5ec96f85a727b1c5db8fd54/components/viz/service/display/surface_aggregator.cc
- Chromium `overlay_candidate.h`: https://chromium.googlesource.com/chromium/src/+/693b66c58ca90c3ed9264e55072310406ac1d16f/components/viz/service/display/overlay_candidate.h
- Chromium `dc_layer_overlay.cc`: https://chromium.googlesource.com/chromium/src/+/main/components/viz/service/display/dc_layer_overlay.cc
- Chromium GitHub mirror `surface_aggregator.cc`: https://github.com/chromium/chromium/blob/main/components/viz/service/display/surface_aggregator.cc
- Chromium GitHub mirror `overlay_candidate_factory.cc`: https://github.com/chromium/chromium/blob/main/components/viz/service/display/overlay_candidate_factory.cc

---

## 本小時最重要 5 個發現

### 1. Geometry overlap != visual contribution
**已確認／Chromium 原始碼 + graphics semantics。** `SurfaceAggregator` 複製/重建 SharedQuadState 時會攜帶 transform、visible rect、clip、mask filter、opacity、blend mode 等資訊；render-pass quad 還可以攜帶 filters 與 backdrop filters。因此 target pixel 落在 quad transformed bounds 內，只能建立「candidate contributor」，不能證明它實際改變最後 pixel。

底層應拆成：

`Quad geometry → visible rect → transform → clip → opacity → blend → mask/filter → render-pass composition → candidate visual contribution`

限制：精確重建 GPU raster/filter/blend 的每個 sample 成本很高，Hermes 應使用分層 proof，而不是預設逐 pixel 重播整個 renderer。

### 2. Overlay promotion 讓 final display 不再等於 root render-pass framebuffer
**已確認／Chromium 原始碼。** `OverlayCandidate` 保存 `display_rect`、`uv_rect`、transform、opacity、rounded corners、tracking_id 等；candidate factory 會從 SharedQuadState 複製 opacity 並執行 geometric clipping。Windows DComp/DC layer overlay path 會處理 overlay candidates，並可能替換/刪除原 quad。這表示某塊畫面可能最後由獨立 overlay plane 顯示，而不是由 root render-pass texture 直接提供。

所以：

`RootRenderPassPixel != necessarily FinalDisplayPixel`

Hermes 需要新增：

`DisplayCompositionGraph = RenderPassPlane + OverlayPlanes + Underlay/PlatformPlanes`

### 3. Capture/readback 與 overlay eligibility 互相影響，證明「截圖所見」不一定等於平常呈現路徑
**已確認／Chromium 原始碼。** `dc_layer_overlay.cc` 對含 capture/copy request 的 render pass 會限制 overlay promotion（非 requires-overlay 的候選可能因 copy request 被拒）。這是非常重要的 observation effect：**為了取得 screenshot/readback，本身可能改變 composition strategy。**

因此：

`ObservedCapturePath != guaranteed NormalPresentationPath`

這和量子比喻無關，而是純工程層的 instrumentation perturbation。Hermes 的 RenderedFrameWitness 必須標示 capture mode 與是否改變 overlay decision。

### 4. Occlusion 需要從「遮住矩形」升級成 compositing-aware occlusion
**已確認／Chromium overlay path + 合理工程建模。** Chromium overlay overlap 判斷會跳過接近透明的 quad，並對 pixel-moving filters 擴大 overlap rect；mask/rounded corners/backdrop filter 也會改變可視關係。因此簡單 z-order + rectangle subtraction 不是完整 visual provenance。

Hermes 建議分級：
- `GEOMETRIC_CANDIDATE`：transform/clip 後相交。
- `COMPOSITING_CANDIDATE`：考慮 opacity/blend/mask/filter 後仍可能影響。
- `PLANE_BOUND`：已知道最終 render/overlay plane。
- `DISPLAY_BOUND`：能把 target region 綁到實際 display composition witness。

### 5. GUI Agent 的 grounding failure 已明確包含 occlusion / candidate localization，而非只有語意錯誤
**論文結果。** `GUI-Primitives`（Jahin & Parvez, 2026）以 994 個 contrastive items 隔離七種 spatial relations，包括 occlusion；19 個 VLM strict point-in-box accuracy 最高僅 32%，且 60–92% 預測落在兩個候選之外。對 containment/occlusion，即使落入候選區後 relation selection 仍沒有顯著高於 chance。PAGER 則再次顯示 action type accuracy >88% 仍可能 <6% task success。

這支持 Hermes 把「模型選對語意目標」與「pixel/plane execution proof」完全分離。

Papers:
- GUI-Primitives: https://arxiv.org/abs/2608.21832
- PAGER: https://arxiv.org/abs/2605.15963
- RegionFocus: https://arxiv.org/abs/2505.00684
- GUI-Eyes: https://arxiv.org/abs/2601.09770

---

## Architecture Breakdown

```text
Program / DOM / AX
      ↓
Semantic Target
      ↓
Surface Aggregation Closure
      ↓
ResolvedFrameData
      ↓
SurfaceDrawQuad / RenderPass
      ↓
SharedQuadState
  ├─ transform
  ├─ clip
  ├─ opacity
  ├─ blend mode
  ├─ mask / rounded corner
  └─ sorting context
      ↓
Filters / Backdrop Filters
      ↓
Candidate Visual Contribution Graph
      ↓
Overlay Processor
  ├─ keep in render pass
  ├─ promote overlay
  ├─ underlay
  └─ reject promotion
      ↓
Display Composition Graph
      ↓
Target Region Final Contributor Set
      ↓
VisualContributionWitness
      ↓
RegionActionProof
      ↓
ALLOW / ACTIVE RECAPTURE / BLOCK
```

### 與上一輪的差異

上一輪：
`Surface → frame_index → RenderPass → transform/clip → target region`

本輪新增：
`opacity/blend/mask/filter → occlusion semantics → overlay promotion → final display plane`

也就是從 **geometric provenance** 升級成 **visual contribution provenance**。

---

## Bottom-Level Logic

### A. Candidate contributor

```text
Target region R
→ enumerate quads whose visible rect intersects R
→ compose quad_to_target_transform
→ apply clip rect / rounded mask bounds
→ discard opacity≈0 contributors when semantics allow
→ inspect blend mode
→ inspect render-pass filters / backdrop filters
→ expand dependency region for pixel-moving filters
→ produce CandidateContributorSet
```

### B. Render-pass dependency

Backdrop/filter 是關鍵，因為 output pixel 可能依賴 target region 外的 source pixels：

```text
Target Pixel p
→ Filter Kernel / Pixel Movement Radius
→ Source Neighborhood N(p)
→ upstream quads contributing to N(p)
→ dependency expansion
```

因此 `PixelRegionProvenance` 可能不是單點 lineage，而是 **region dependency cone**。

### C. Overlay transition

```text
Aggregated Quad
→ OverlayCandidateFactory
→ candidate geometry/UV/opacity/transform
→ platform validation
→ promotion decision
→ if promoted:
     remove/replace quad in render pass
     attach OverlayPlaneWitness
→ final display composition
```

### D. Capture perturbation

```text
Normal frame
→ overlay candidate may promote

Capture/CopyOutput frame
→ HasCapture()
→ non-required overlay may be rejected
→ render composition changes
→ screenshot pixels can follow a different composition route
```

新的 invariant：

`CapturePixelEquivalenceToPresentedPixel` 必須被證明，不能預設。

---

## Visual Simulation Idea

### Visual Contribution & Overlay Plane Microscope

```text
TARGET (812,420)
      ↓
Q17 iframe content  opacity=1.0
      ↓
RenderPass RP4
      ↓ backdrop blur radius=12
      ├── Q12 background
      ├── Q13 text
      └── Q17 target
      ↓
Overlay decision
      ├── video Q20 → Overlay Plane #1
      └── RP4       → Root Plane
      ↓
DISPLAY COMPOSITION

Plane #1  [video overlay]
Plane #0  [root render pass]

Target Witness:
semantic target = button#delete
surface = S2#18
quad = Q17
plane = root
contributors = {Q17, RP4 filter neighborhood}
proof = COMPOSITING_CANDIDATE
```

互動注入：opacity、z-order、blend mode、clip、rounded mask、blur radius、backdrop filter、overlay promotion、underlay、copy request、capture mode、target point。

即時顯示：`GeometricContributorSet / FilterDependencyCone / Occlusion Set / Overlay Plane / Capture Perturbation / Final Contributor Set / Region Proof Strength / Action Verdict`。

---

## Code / GitHub

本輪不是只讀 README，核心原始碼路徑：

- `components/viz/service/display/surface_aggregator.cc`
  - `CopyQuadsToPass`
  - SharedQuadState copy/scale
  - mask/filter propagation
  - render-pass filters/backdrop filters
- `components/viz/service/display/overlay_candidate.h`
  - `display_rect`, `uv_rect`, transform, opacity, tracking_id
- `components/viz/service/display/overlay_candidate_factory.cc`
  - candidate geometry clipping
  - SharedQuadState → candidate opacity
- `components/viz/service/display/dc_layer_overlay.cc`
  - overlay validation/promotion
  - overlap/filter handling
  - capture/copy-request restrictions
- 下一步應讀：
  - `components/viz/service/display/skia_renderer.*`
  - `components/viz/service/display/overlay_processor_*`
  - `components/viz/service/display/display.*`
  - `components/viz/service/display/output_surface.*`

---

## Papers

### GUI-Primitives: Diagnosing Spatial Reasoning Failures in Vision-Language GUI Grounding
Authors: Md Abrar Jahin, Md Rizwan Parvez  
Year: 2026  
URL: https://arxiv.org/abs/2608.21832  
Dataset: GUI-Primitives, 994 contrastive items; 7 spatial relations including occlusion  
Architecture/Method: diagnostic benchmark rather than a new runtime architecture  
Contribution: separates candidate localization from relation binding; shows occlusion/containment remain especially weak.  
Limitations: synthetic/diagnostic GUI relation setting does not model compositor provenance or temporal freshness.

### PAGER: Bridging the Semantic-Execution Gap in Point-Precise Geometric GUI Control
Authors: Jingxuan Wei et al.  
Year: 2026  
URL: https://arxiv.org/abs/2605.15963  
Dataset: PAGE Bench, 4,906 problems, 224K+ process-supervised pixel actions  
Architecture: dependency-structured planning + pixel execution + precision-aligned RL  
Contribution: demonstrates semantic/action-type correctness can coexist with catastrophic point-level execution failure.  
Limitations: does not provide browser compositor/display-plane proof.

### Visual Test-time Scaling for GUI Agent Grounding (RegionFocus)
Authors: Tiange Luo, Lajanugen Logeswaran, Justin Johnson, Honglak Lee  
Year: 2025  
URL: https://arxiv.org/abs/2505.00684  
Code: https://github.com/tiangeluo/RegionFocus  
Architecture: dynamic zoom + image-as-map  
Contribution: active region focusing reduces clutter; reported 61.6% ScreenSpot-Pro grounding with Qwen2.5-VL-72B.  
Limitations: perception improvement, not render provenance proof.

### GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents
Authors: Chen Chen et al.  
Year: 2026  
URL: https://arxiv.org/abs/2601.09770  
Architecture: two-stage coarse/fine policy with crop/zoom visual tools  
Contribution: makes observation itself an agent decision.  
Limitations: observation identity still not bound to compositor/display witness.

---

## Unknown / Open Questions 1-3

1. **Overlay plane → screenshot equivalence**：普通 CDP screenshot / CopyOutput 到底在各平台如何處理 promoted overlays？是否可取得 per-plane witness，證明 capture pixels 與實際 presented pixels 等價？
2. **Filter dependency cone**：對 blur/backdrop/filter/mask，Hermes 是否能只保存 conservative affected region，而不必重播 GPU shader，仍足以安全授權 GUI action？
3. **Final display identity**：能否從 Viz/Display/OutputSurface tracing 取得 `frame_token + overlay candidates + swap/presentation` 的單一 DisplayCompositionWitness？

---

## 下一輪研究

直接追：

```text
AggregatedRenderPass
→ SkiaRenderer
→ OverlayProcessor
→ OverlayCandidateList
→ OutputSurface
→ SwapBuffers
→ PresentationFeedback
→ DisplayCompositionWitness
```

重點讀 `skia_renderer.* / overlay_processor_* / display.* / output_surface.*`，確認 overlay promotion 後 final plane set 是否有可追蹤 identity，以及 CopyOutput/screenshot 是否會讓 composition path 改變。

同時建立最小可實作的：

`ConservativeVisualContributionProof`

目標不是精確重播 GPU，而是能對高風險 target region 回答：

`這個區域有哪些可能 contributor？是否有 filter/overlay/capture ambiguity？若 ambiguity 超過 policy threshold，就 recapture / semantic re-read / block。`

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `VisualContributionGraph`
- `CandidateVisualContributor`
- `CompositingContributor`
- `FilterDependencyCone`
- `OcclusionWitness`
- `OverlayCandidateWitness`
- `OverlayPlaneWitness`
- `DisplayCompositionGraph`
- `DisplayCompositionWitness`
- `CapturePerturbation`
- `CapturePixelEquivalence`
- `ConservativeVisualContributionProof`
- `FinalContributorSet`

### Edges
- `DrawQuad --CANDIDATE_CONTRIBUTES_TO--> PixelRegion`
- `Filter --EXPANDS_DEPENDENCY_TO--> SourceRegion`
- `Quad --PROMOTED_TO--> OverlayPlane`
- `OverlayPlane --COMPOSED_INTO--> DisplayFrame`
- `CaptureRequest --MAY_CHANGE--> OverlayDecision`
- `DisplayedPixel --DERIVED_FROM--> FinalContributorSet`
- `RegionActionProof --REQUIRES--> ConservativeVisualContributionProof`

---

## 本輪結束檢查

- **缺哪一層：** `Overlay/RenderPass → OutputSurface → Swap → Presented Display Plane Set → Capture equivalence`。
- **哪個節點最淺：** `DisplayCompositionWitness`。
- **哪個概念仍只是名詞：** `CapturePixelEquivalence`；目前只能確認 capture 可能影響 overlay eligibility，尚未證明跨平台等價規則。
- **哪個系統值得讀原始碼：** Chromium Viz `SkiaRenderer + OverlayProcessor + OutputSurface`。
- **哪篇論文需追引用：** GUI-Primitives，尤其 occlusion/containment failure；PAGER 的 precision-sensitive execution lineage。
- **哪個概念最適合視覺模擬：** `Visual Contribution & Overlay Plane Microscope`。
- **哪個 Agent 架構最值得實作：** `Structured State + ObservationBundle + Render/Display Provenance + Active Visual Recapture + Region-Level Action Gate`。

## 對「AI 到底怎麼運作」新增的一段

```text
Browser Program State
→ DOM / AX
→ Blink Layout / Paint
→ Surface / CompositorFrame
→ Viz Aggregation
→ RenderPass / Quad
→ Transform / Clip
→ Opacity / Blend / Mask / Filter
→ Overlay Promotion
→ Display Plane Composition
→ Presented Pixels
→ Screenshot / Vision Encoder
→ Visual Tokens
→ Multimodal Fusion
→ Reasoning
→ Plan
→ RegionActionProof
→ Computer Action
→ Read-back / Settlement
→ Output
```

本輪最重要的修正是：**AI「看到某個 pixel」的來源不能在 Surface/Quad 幾何相交就停止。真正顯示到螢幕前，還會經過 opacity、blend、mask、filter、occlusion 與 overlay plane composition；甚至為了 screenshot 而做的 capture 本身就可能改變 overlay promotion。可靠 Computer Agent 因此需要的是 final-display-aware 的保守 visual contribution proof，而不是把 screenshot 當成無副作用、完整且天然對應真實 presentation 的世界真相。**