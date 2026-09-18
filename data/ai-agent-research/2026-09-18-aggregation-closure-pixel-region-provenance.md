# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-18 11:55 Asia/Taipei

## 本小時新發現

本輪承接上一輪 `Presented Surface Set × OOPIF Fallback Freshness`，不再重複 primary/fallback 基礎，而是追下一個缺口：**如何證明某次 Viz aggregation 實際使用了哪些 Surface，而且哪些 Surface 真正貢獻了 target pixel region？**

核心結論：Chromium `SurfaceAggregator` 已提供一個很接近「aggregation closure」的內部 primitive：`contained_surfaces_ / previous_contained_surfaces_`，而且 map value 保存 aggregation 當時各 Surface 的 `frame_index`。但 `active_referenced_surfaces()` 比「真正畫進 pixels 的 surface」更寬：被 reference、但未出現在 `SurfaceDrawQuad` 的 surface 會被歸入 `undrawn_surfaces`，主要為 CopyOutputRequest 遍歷，不直接貢獻 display pixels。因此 Hermes 必須嚴格區分 `ReferencedSurfaceSet`、`ContainedDrawnSurfaceSet`、`UndrawnReferencedSurfaceSet`。

---

## 本小時最重要 5 個發現

### 1. Chromium 已有 aggregation-time surface closure，但不是公開 Browser API
**已確認／Chromium 原始碼。** `SurfaceAggregator::Aggregate()` 在一次 aggregation 期間建立 `contained_surfaces_`，完成後 swap 到 `previous_contained_surfaces_`；header 明確說它記錄「For each Surface used in the last aggregation, gives the frame_index at that time」。這比只保存 SurfaceId 強，因為同一 Surface lifetime 可跨多個 frame。

底層：
`Root Surface → Prewalk/Resolve → SurfaceDrawQuad traversal → contained_surfaces_[SurfaceId]=frame_index → Aggregate → previous_contained_surfaces_`

限制：這是 Viz 內部 state，普通 CDP screenshot 不直接回傳此 closure。

### 2. Referenced != Drawn：reference graph 不能直接當 pixel provenance
**已確認／Chromium 原始碼。** `active_referenced_surfaces()` 中尚未被 prewalk/contained 的 surface 會進 `undrawn_surfaces`；註解明確指出它們沒有包含於 SurfaceDrawQuad，因此不貢獻 display pixels，只在必要時為 CopyOutputRequest 遍歷。

因此：
`SurfaceReferenceEdge != PixelContributionEdge`

這修正上一輪可能過度把 SurfaceManager reachability 視為畫面內容的風險。

### 3. SurfaceManager reachability 是 lifetime/GC correctness，不是 presentation proof
**已確認／Chromium 原始碼。** SurfaceManager 從 root/reference graph 找 reachable surfaces，用於管理 live surfaces；Surface active frame 改變時也會更新 references。這證明 reference DAG 與 aggregation/render DAG 是相關但不同的兩個 graph。

Hermes 應分離：
`LifetimeReferenceGraph`、`AggregationGraph`、`PixelContributionGraph`。

### 4. Aggregation closure 應攜帶 frame_index，才能偵測同 SurfaceId 下的 child 更新
**Hermes architecture proposal，基於 Chromium primitive。** 若 witness 只記 SurfaceId，child 在同一 LocalSurfaceId lifetime 內更新 frame 時可能看不出來。建議 `AggregatedSurfaceWitness {surfaceId, frameIndex, selectionPath, transform, clip, contributedRegion}`。

### 5. GUI grounding需要 region-level evidence，不只是 action type correctness
**論文結果 + 工程推論。** PAGER 在 precision-sensitive GUI tasks 顯示一般 multimodal model 即使 action type accuracy >88%，task success 仍可低於 6%，指出 semantic decision 與 point-level execution 存在巨大 gap。RegionFocus/GUI-Eyes 類工作則顯示 zoom/crop/active perception 可提升 grounding。對 Hermes 而言，下一步不是只把 screenshot 餵給 VLM，而是把 target region 與 render provenance 綁定後再 grounding。

---

## Architecture Breakdown

```text
SurfaceManager
  LifetimeReferenceGraph
       ↓
Root Surface
  ↓ Aggregate(root)
SurfaceAggregator
  ↓ PrewalkSurface
  ↓ Resolve SurfaceRange
  ↓ SurfaceDrawQuad traversal
  ├─ Drawn/contained Surface → frame_index
  └─ Referenced but undrawn Surface → CopyOutput-only path
       ↓
AggregationClosure
  {SurfaceId → frame_index}
       ↓
Aggregated Render Passes
       ↓
Transforms / Clips / Quads
       ↓
PixelContributionGraph
       ↓
Target Pixel Region
       ↓
GUI Grounding
       ↓
ActionFreshnessGate
```

### 建議 Hermes Runtime 分層

1. `LifetimeReferenceGraph`：SurfaceManager references，回答 surface 是否仍 reachable/live。
2. `AggregationClosureWitness`：本次 Aggregate 真正 contained 的 `{SurfaceId, frameIndex}`。
3. `PixelContributionGraph`：Surface/RenderPass/Quad 經 transform+clip 對 root pixel region 的貢獻。
4. `TargetRegionWitness`：action target rectangle/point 的 contributor set。
5. `RegionActionProof`：target region 的 contributor freshness + semantic correspondence + grounding confidence。

---

## Bottom-Level Logic

### Surface closure

```text
Aggregate(root)
→ resolve root active frame
→ prewalk render passes
→ encounter SurfaceDrawQuad
→ resolve SurfaceRange
→ choose usable child frame
→ recursively prewalk child
→ mark child contained
→ record child frame_index
→ continue until closure
```

### Reference-vs-pixel distinction

```text
active_referenced_surfaces
→ if contained by SurfaceDrawQuad
     contributes through aggregation path
→ else
     undrawn_surfaces
     → maybe CopyOutput traversal
     → DOES NOT imply display-pixel contribution
```

### Region provenance

```text
Target point/rect R
→ Root render pass coordinates
→ intersect DrawQuad visible rect
→ invert/compose quad transforms
→ apply clip chain
→ if RenderPassDrawQuad: descend pass
→ if embedded Surface content: attach SurfaceId + frame_index
→ collect contributor set
→ compute freshness/correspondence verdict
```

這裡最重要的 invariant：

`PresentedSurfaceSetCompleteness != PixelRegionProvenanceCompleteness`

即使知道所有 contained surfaces，仍需 transform/clip/render-pass traversal 才知道「哪個 surface 貢獻了我要點的 pixel」。

---

## Visual Simulation Idea

### Aggregation Closure & Pixel Provenance Microscope

```text
ROOT S0#91
├─ local quad [0..300]
├─ child S1#44  PRIMARY
│    └─ region x=300..700
├─ child S2#18  FALLBACK
│    └─ region x=700..900
└─ referenced S3#7  UNDRAWN

Target click (812, 420)
        ↓
Root Quad Q8
        ↓ transform/clip
Child S2#18
        ↓
FALLBACK / age=3 frames
        ↓
Region verdict = STALE
        ↓
BLOCK + RECAPTURE
```

互動控制：root/child frame rate、OOPIF update lag、fallback selection、quad transform、clip、occlusion、copy-only surface、target point、grounding noise。

顯示：`LifetimeReferenceGraph / AggregationClosure / frame_index / Drawn vs Undrawn / PixelContributorSet / fallback age / target region proof strength / action verdict`。

---

## Code / GitHub

### Chromium 值得繼續讀的核心檔案
- `components/viz/service/display/surface_aggregator.cc`
- `components/viz/service/display/surface_aggregator.h`
- `components/viz/service/display/resolved_frame_data.*`
- `components/viz/service/surfaces/surface.cc`
- `components/viz/service/surfaces/surface_manager.cc`
- `components/viz/common/quads/surface_draw_quad.*`
- `components/viz/common/quads/compositor_render_pass_draw_quad.*`

本輪原始碼確認：`previous_contained_surfaces()` 暴露上一輪 Aggregate 使用的 surface map；`GetLatestFrameData()` 的註解甚至警告必須緊接 Aggregate 呼叫，避免兩次呼叫間又收到新的 CompositorFrame。這再次證明 render witness 本身有 TOCTOU boundary。

---

## Papers

### PAGER: Bridging the Semantic-Execution Gap in Point-Precise Geometric GUI Control
Authors: Jingxuan Wei et al.  
Year: 2026  
Architecture: topology-aware planning + pixel-level execution + precision-aligned RL  
Dataset/Benchmark: PAGE Bench，4,906 problems、224K+ process-supervised pixel-level actions  
Contribution: 將 GUI semantic correctness 與 geometric execution correctness 明確拆開。  
Limitation: 主要聚焦 precision-sensitive geometric GUI，不直接處理 browser compositor provenance。

### Visual Test-time Scaling for GUI Agent Grounding / RegionFocus
Authors: Tiange Luo, Lajanugen Logeswaran, Justin Johnson, Honglak Lee  
Year: 2025  
Architecture: dynamic region zoom + image-as-map  
Contribution: 透過 region selection 減少視覺 clutter，ScreenSpot-Pro grounding 有顯著提升。  
Limitation: region 是 perception strategy，不是 world-state/render provenance proof。

### GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents
Authors: Chen Chen et al.  
Year: 2026  
Architecture: two-stage coarse-to-fine active perception + crop/zoom tools  
Contribution: Agent 學會何時以及如何重新觀察，而非被動接受單張 screenshot。  
Limitation: 仍未把 crop/zoom observation 與 compositor frame/surface identity 做 correctness binding。

---

## Unknown / Open Questions

1. 能否在不修改 Chromium 的情況下，從 tracing 或 DevTools instrumentation 擷取 `{SurfaceId, frame_index}` aggregation closure？
2. AggregatedRenderPass 經 surface merge、render-pass merge、overlay promotion 後，如何保留精確 contributor lineage 到最終 display pixel？
3. Occlusion、filters、opacity、blend mode、mask、overlay plane 會讓「幾何相交」不等於「真正視覺貢獻」，PixelContributionGraph 的最低可行 proof 要做到多深？

---

## 下一輪研究

直接追：

```text
ResolvedFrameData
→ frame_index
→ SurfaceAggregator::HandleSurfaceQuad
→ CopyQuadsToPass
→ AggregatedRenderPass
→ SharedQuadState transform/clip
→ RenderPassDrawQuad
→ overlay candidate/promotion
→ target pixel contributor
```

並研究 Viz tracing 是否已輸出 contained surface/frame index、render pass/quad lineage。若沒有，就設計最小 Chromium instrumentation patch，而不是假裝 CDP 能直接取得。

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `AggregationClosureWitness`
- `ContainedSurfaceFrameIndex`
- `ReferencedSurfaceSet`
- `UndrawnReferencedSurface`
- `LifetimeReferenceGraph`
- `AggregationGraph`
- `PixelContributionGraph`
- `PixelContributionEdge`
- `TargetRegionWitness`
- `RegionActionProof`
- `RenderWitnessTOCTOU`
- `QuadTransformWitness`
- `ClipChainWitness`

### Edges
- `RootSurface --AGGREGATES--> AggregationClosureWitness`
- `AggregationClosureWitness --CONTAINS_AT_FRAME_INDEX--> Surface`
- `SurfaceReference --MAY_NOT_DRAW--> UndrawnReferencedSurface`
- `Surface --CONTRIBUTES_VIA--> PixelContributionEdge`
- `PixelContributionEdge --MAPS_TO--> TargetRegionWitness`
- `TargetRegionWitness --GATES--> ComputerAction`

---

## 本輪結束判斷

- **缺哪一層：** Aggregated render pass / quad 到最終 target pixel 的可驗證 lineage，尤其 overlay/filter/occlusion。
- **哪個節點最淺：** `PixelContributionGraph`。
- **哪個概念仍只是名詞：** `PixelRegionProvenanceCompleteness`，目前只有設計，尚未找到完整 native witness。
- **哪個系統值得讀原始碼：** Chromium Viz `SurfaceAggregator + ResolvedFrameData + Display/Overlay`。
- **哪篇論文需追引用：** PAGER，因為它最直接量化 semantic understanding 與 geometric execution 的落差。
- **哪個概念最適合視覺模擬：** Aggregation Closure & Pixel Provenance Microscope。
- **哪個 Agent 架構最值得實作：** `Structured/semantic grounding + region-level render witness + active visual recapture + action gate` 的 hybrid Computer Agent。

## 與總目標的連接

本輪把：

`Camera/Image/UI → Pixels → Vision Tokens → Reasoning → Action`

往 browser 底層還原為：

`Renderer/OOPIF → Surface frames → SurfaceRange selection → Viz aggregation closure → render passes/quads → pixel region → crop/vision tokens → semantic grounding → reasoning → region proof → action`。

新的核心結論：**知道「哪些 Surface 存在」還不夠，甚至知道「哪些 Surface 被本次 aggregation 使用」仍不夠。高可靠 GUI Agent 最終需要回答的是：我要操作的這個 pixel region，究竟由哪個 Surface 的哪個 frame 經過哪些 transform/clip/render-pass 路徑產生；只有把 perception provenance 收斂到 action target，才能真正把「AI 看到了畫面」升級成「AI 有足夠證據安全地操作這個畫面」。**