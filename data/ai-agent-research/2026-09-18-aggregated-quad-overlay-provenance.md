# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 23:56（Asia/Taipei）

主題：AggregatedDrawQuad × Overlay Promotion × Region Contribution Provenance

## 與歷史研究比較

上一輪已把 `SurfaceFrameGeneration → ResolvedFrameData → ResolvedPassData → CopyQuadsToPass → AggregatedDrawQuad` 接起來，最淺節點是 `AggregatedQuadIdentity`。本輪不重複 Surface generation，而是沿 Viz display pipeline 繼續追蹤 aggregated quad 在 overlay promotion、occlusion、copy request、platform plane 分流之後是否仍能作為 target-region provenance。

## 本小時新發現

1. Chromium 現行 `OverlayCandidateFactory::FromDrawQuad()` 直接從 `DrawQuad` 建立 `OverlayCandidate`，並依 material 分派 Texture / VideoHole / delegated SolidColor / AggregatedRenderPass / Tile 等路徑。這證明 aggregated draw primitive 與 overlay candidate 之間存在真實 runtime conversion boundary，而不是概念上的推論。
2. `OverlayProcessorUsingStrategy::ProcessForOverlays()` 在 root `AggregatedRenderPass` 上執行 overlay strategy；如果存在 copy request，Chromium 會阻止移除 quads 做 overlay/CALayer，原因是 framebuffer 否則會缺少被移除 quad 的內容。這是 capture request 可以改變 composition strategy 的又一個直接原始碼證據。
3. Windows DComp 路徑中，成功 promotion 的 quad 可能被 `EraseAndInvalidateAllPointers()` 從 root render pass quad list 移除，轉成 DComp overlay/underlay。故 `AggregatedDrawQuad present in final root pass` 不是穩定的 presentation identity。
4. Overlay candidate 的幾何可見性不是單純 rect intersection：Chromium 會考慮 transform、visible_rect clipping、opaque occluders、blend、filters；`EstimateVisibleDamage()` 甚至明確把被 opaque quads 遮住的區域從候選可見 damage 中扣除。
5. 因此 Hermes 需要把 provenance 從「quad identity」升級為「render primitive lineage + composition branch + region visibility state」，否則 overlay promotion 後 provenance 會在最靠近 display 的地方斷掉。

## 本小時最重要 5 個發現

### 1. AggregatedDrawQuad 不是 presentation-stable object

**已確認工程實作。** Aggregated quad 在 overlay processing 前可以存在於 root pass；promotion 成功後可能被移除並改由 platform plane 呈現。因此不能把 `quad pointer / quad-list position` 當跨 stage identity。

底層：

`AggregatedDrawQuad → OverlayCandidateFactory → Candidate → Overlay Strategy → {remain in primary plane | promoted overlay | underlay | delegated platform layer}`

重要性：Hermes 的 VisualContributionGraph 必須跨 composition branch，而不是只追 Skia framebuffer。

限制：不同平台 overlay processor（DComp/CALayer/SurfaceControl/Ozone）會有不同 identity primitive。

### 2. Copy request 是 composition observer effect

**已確認工程實作。** Chromium 在有 copy request 時會 block 某些 overlay/CALayer quad removal，以避免 capture framebuffer 缺內容。

底層：

`CopyRequest → BlockForCopyRequests → overlay strategy constrained → altered plane assignment → captured framebuffer`

重要性：這直接支持先前 Knowledge Graph 的 `CounterfactualPresentationGap`：Agent capture 可能改變正常 presentation path。

限制：不能由此推論所有 screenshot API 都必然 perturb composition；需逐 capture mode 驗證。

### 3. Region contribution 必須經過 occlusion/clip/blend/filter 判定

**已確認工程實作。** Overlay candidate factory 會把 quad transform 到 target space，檢查 visible rect、occlusion、filter overlap、blend 等條件。

底層：

`Source Rect → Transform → Clip/VisibleRect → Z-order overlap → Opaque occlusion → Blend/Filter semantics → Effective Visible Region`

重要性：Agent 點擊 target `(x,y)` 時，不能只問「哪個 source quad bounds 包含 x,y」，而要問「最終 composition 中哪個 lineage 對此 region 有有效可見貢獻」。

限制：真正 pixel contribution還包含 shader/filter/color conversion/AA 等 raster effects。

### 4. Overlay promotion 需要 lineage sidecar

**合理工程推論，尚待 Hermes 實作驗證。** 建議新增 `RenderPrimitiveLineageId`，不要依賴 Chromium pointer identity。

建議 tuple：

`SurfaceGeneration + SourcePassId + SourceQuadOrdinal + AggregationEpoch + AggregatedPassId + CompositionBranchEpoch`

promotion 時建立：

`AggregatedQuadLineage --PROMOTED_AS--> OverlayCandidateLineage --SCHEDULED_AS--> PlatformPlaneLineage`

限制：quad merge、split、CALayer all-or-nothing promotion、multi-plane video 可能需要 one-to-many / many-to-one edge。

### 5. GUI Agent 的 perception 應是 active evidence acquisition

**論文結果。** GUI-Eyes（Chen et al., 2026）以 coarse exploration → fine grounding 的兩階段策略主動決定是否 crop/zoom；ScreenSpot-Pro 上 GUI-Eyes-3B 以 3k labeled samples 達 44.8% grounding accuracy。WeaveBench（Li et al., 2026）則以 114 個跨 GUI/CLI/code 長程任務顯示最佳 PassRate 41.2%，且 outcome-only grading 會高估能力。

重要性：Hermes 應把 recapture/crop/zoom 當 Evidence DAG 的 action，而非被動 screenshot preprocessing；trajectory verifier 也應讀 provenance，而非只看最後畫面。

限制：benchmark 結果不能直接證明 compositor provenance 本身提高 end-to-end success，需做 Hermes ablation。

## Architecture Breakdown

本輪 system architecture：Chromium Viz aggregation → overlay/platform composition。

```text
Renderer CompositorFrame
  ↓
Surface active generation
  ↓
ResolvedFrameData / ResolvedPassData
  ↓
CopyQuadsToPass
  ↓
AggregatedRenderPass
  ↓
AggregatedDrawQuad
  ↓
OverlayCandidateFactory::FromDrawQuad
  ↓
OverlayProcessor
  ├─ keep in primary plane → SkiaRenderer
  ├─ promote overlay → platform plane
  ├─ underlay → platform plane + primary-plane treatment
  └─ delegated CALayer/DComp path
  ↓
ScheduledPlaneSet
  ↓
Platform compositor
  ↓
Presentation witness
  ↓
Capture boundary
  ↓
Agent-visible pixels
```

新的核心 invariant：

```text
AggregatedQuadContributor
≠ PrimaryPlaneContributor
≠ OverlayPlaneContributor
≠ PresentedRegionContributor
≠ CapturedRegionContributor
```

## Bottom-Level Logic

本輪 bottom-level mechanism：**quad → candidate → visible region → composition branch**。

```text
Q = AggregatedDrawQuad
T = quad_to_target_transform
R0 = Q.visible_rect
R1 = Map(T, R0)
R2 = Intersect(R1, clip)
R3 = R2 - definitely-opaque occluders
S  = blend/filter/color/opacity semantics

EffectiveContribution(Q, target_region)
  = Intersects(R3, target_region)
    AND composition_semantics(S)
```

若 promotion：

```text
Q
→ CandidateFactory.FromDrawQuad(Q)
→ OverlayCandidate C
→ Strategy.Attempt(C)
→ PlatformPlane P
```

若 capture request block promotion：

```text
Q
→ CopyRequest present
→ BlockForCopyRequests
→ Q retained in framebuffer path
```

因此同一 source generation 在 `normal presentation` 與 `capture-active presentation` 下可能有不同 CompositionBranch。

## Visual Simulation Idea

### Quad → Plane → Pixel Provenance Microscope

互動視覺：左側顯示 Surface generations；中央顯示 AggregatedRenderPass quad stack；右側同時顯示 Primary Plane / Overlay Planes / User-visible Display / Agent Capture。

點任一 target pixel/region 時反向高亮：

```text
Agent Pixel R
← Capture Plane Coverage
← Presented Plane P
← OverlayCandidate C OR PrimaryPlane raster
← AggregatedQuad lineage Q17
← Source quad q4
← Surface S2@g41 / F471
```

可注入：opaque occluder、opacity、filter、clip、transform、video overlay、DComp underlay、CALayer promotion、copy request、protected content、capture-before-present。每條 edge 顯示 `CAUSAL / REGION-BOUND / BRANCH-BOUND / CORRELATED / UNKNOWN / BROKEN`，並讓 Action Gate 輸出 `ALLOW / ACTIVE_REOBSERVE / RECAPTURE / BLOCK`。

## Code / GitHub

本輪值得持續讀的 Chromium 核心檔案：

- `components/viz/service/display/overlay_candidate_factory.cc`：`FromDrawQuad`、occlusion、visible damage、material→candidate conversion。
- `components/viz/service/display/overlay_processor_using_strategy.cc`：root pass overlay strategy、copy-request blocking、primary-plane construction。
- `components/viz/service/display/dc_layer_overlay.cc`：Windows DComp overlay/underlay promotion，成功 promotion 後可從 render-pass quad list 移除 quad。
- `components/viz/service/display/overlay_unittest.cc`：tracking id、rotation、occlusion、damage、filter 等 invariants 的 executable evidence。
- 下一步：`direct_renderer.cc`、`skia_renderer.cc`、`overlay_candidate.cc`、各平台 presenter/output-device，追 `Candidate → ScheduledPlane → Presentation` identity。

## Papers

### GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents
- Authors: Chen Chen, Jiawei Shao, Dakuan Lu, Haoyi Hu, Xiangcheng Liu, Hantao Yao, Wu Liu
- Institution: 論文作者機構以原文 metadata 為準，本輪不在缺乏原文 affiliation 證據時猜測
- Year: 2026
- URL: https://arxiv.org/abs/2601.09770
- Code: 本輪未確認官方 code repository
- Dataset/Benchmark: ScreenSpot-Pro；3k labeled samples setting
- Architecture: two-stage active perception；coarse exploration + fine-grained grounding；visual crop/zoom tools；two-level policy
- Contribution: 把「何時、是否、如何再觀察」納入 agent policy
- Result: GUI-Eyes-3B 44.8% grounding accuracy（論文報告）
- Limitations: grounding benchmark 不等於完整 long-horizon computer-use reliability
- 改變了什麼：把 perception 從固定 observation 轉為可學習的 tool action。

### WeaveBench: A Long-Horizon, Real-World Benchmark for Computer-Use Agents with Hybrid Interfaces
- Authors: Wanli Li, Bowen Zhou, Yunyao Yu, Zhou Xu, Yifan Yang, Dongsheng Li, Caihua Shan
- Year: 2026
- URL: https://arxiv.org/abs/2606.09426
- Code: 本輪未確認官方 code URL
- Dataset: 114 tasks / 8 real-world domains
- Architecture/Evaluation: GUI + CLI + code hybrid trajectories；trajectory-aware judge 檢查 deliverables/files/screenshots/logs/action traces
- Contribution: 測 long-horizon cross-interface orchestration 並抓 fabricated visual evidence / shortcut behavior
- Result: best PassRate 41.2%（論文報告）
- Limitations: Ubuntu-centric deployed runtime；不是 compositor-level benchmark
- 改變了什麼：證明 outcome-only evaluation 對 agent reliability 不夠。

## Unknown / Open Questions

1. `OverlayCandidate.tracking_id` 是否足以跨 frame / strategy / platform plane 建立穩定 lineage？需要直接追 candidate factory 的 tracking-id producer 與 platform scheduling consumer。
2. 一個 AggregatedDrawQuad 經 render-pass merge、CALayer/DComp promotion、multi-plane video 後，是否會產生 one-to-many plane lineage？哪些平台有可讀 identity？
3. CopyOutput / CDP / OS capture 各自在哪些情況 block overlay、強迫 recomposition、或直接 capture compositor output？需要建立 capture-mode × composition-branch matrix。

## 下一輪研究

直接追：

```text
AggregatedDrawQuad
→ OverlayCandidate.tracking_id
→ Overlay strategy result
→ ScheduledPlane
→ Platform plane/buffer identity
→ PresentationFeedback
```

優先讀 `overlay_candidate.{h,cc}`、`overlay_candidate_factory.cc` tracking-id producer、`overlay_processor_using_strategy.cc`、`skia_renderer.cc` schedule-overlays、Android SurfaceControl / Windows DComp presenter consumer。目標是建立 `AggregatedQuadToPresentedPlaneEdge`，並驗證 tracking id 到底是 debug/optimization identity，還是真能承載 causal provenance。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `RenderPrimitiveLineageId`
- `AggregatedQuadLineage`
- `OverlayCandidateLineage`
- `CompositionBranch`
- `CompositionBranchEpoch`
- `EffectiveVisibleRegion`
- `OcclusionWitness`
- `CopyRequestCompositionPerturbation`
- `PrimaryPlaneContribution`
- `OverlayPlaneContribution`
- `AggregatedQuadToPresentedPlaneEdge`
- `ActivePerceptionEvidenceAction`

### Edges
- `SurfaceFrameGeneration --RESOLVES_TO--> SourceQuad`
- `SourceQuad --COPIED_AS--> AggregatedQuadLineage`
- `AggregatedQuadLineage --CONVERTED_TO--> OverlayCandidateLineage`
- `OverlayCandidateLineage --PROMOTED_AS--> OverlayPlaneContribution`
- `AggregatedQuadLineage --RASTERIZED_IN--> PrimaryPlaneContribution`
- `OcclusionWitness --REDUCES--> EffectiveVisibleRegion`
- `CopyRequestCompositionPerturbation --CHANGES--> CompositionBranch`
- `PresentedPlane --CONTRIBUTES_TO--> UserVisibleRegion`
- `CapturePlaneCoverage --SELECTS_FROM--> PresentedComposition`
- `ActivePerceptionEvidenceAction --REFINES--> CaptureEvidenceDAG`

## 本輪結束判斷

- **缺哪一層：** `OverlayCandidate → concrete scheduled platform plane/buffer → presentation` 的 stable causal identity。
- **哪個節點最淺：** `AggregatedQuadToPresentedPlaneEdge`。
- **哪個概念仍只是名詞：** 跨平台通用的 `RenderPrimitiveLineageId`；目前是 Hermes 工程模型，不是 Chromium 原生 invariant。
- **哪個系統值得讀原始碼：** Chromium Viz `OverlayCandidateFactory + OverlayProcessorUsingStrategy + SkiaRenderer + platform presenters`。
- **哪篇論文需追引用：** GUI-Eyes，尤其 active observation/tool-use 對 long-horizon GUI agent 的後續工作；WeaveBench 則追 trajectory-aware verification。
- **哪個概念最適合視覺模擬：** `Quad → Plane → Pixel Provenance Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Active Perception Subagent + Render/Capture Evidence DAG + Transition Verifier + Risk-Adaptive Action Gate`。

## 對「AI 到底怎麼運作」的新增一層

```text
使用者一句話
→ UI
→ Agent Runtime
→ Context / Memory
→ Model Reasoning
→ Planning
→ Computer Intent
→ Observation Requirement
→ Browser Surface generations
→ Viz aggregation
→ Aggregated quads
→ Overlay/Primary composition branch
→ Platform planes
→ Presentation
→ Capture boundary
→ Agent-visible pixels
→ Vision Encoder
→ Visual Tokens
→ Multimodal Fusion
→ Reasoning
→ Evidence-aware Action Gate
→ Action
→ Transition Verification
→ Output
```

本輪核心修正：**「哪個 quad 進入 aggregation」仍不是「哪個 quad 形成使用者/Agent 最後看到的 pixel」。overlay promotion 可以把 quad 從 framebuffer branch 搬到 platform plane；capture request 又可能反過來阻止這種 promotion。Hermes 因此需要追的是 render primitive 的 lineage 與 composition branch，而不是單一 quad object。**