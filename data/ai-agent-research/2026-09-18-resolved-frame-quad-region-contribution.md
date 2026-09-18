# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 22:53（Asia/Taipei）

## 本小時新發現

主題：ResolvedFrameData × CopyQuadsToPass × Generation-to-Region Contribution。

本輪承接 21:51 的 `SurfaceFrameGenerationWitness`，不再只證明 source generation 是 PresentationGroup member，而是追進 Chromium `SurfaceAggregator` 的實際 quad aggregation 路徑。核心進展：`ResolvedFrameData` 會在 `previous_frame_index() != surface->GetActiveFrameIndex()` 或 surface animation damage 時重新 `ProcessResolvedFrame()`；之後 `HandleSurfaceQuad()` 解析 SurfaceRange，選出本次 aggregation 固定的 resolved Surface，最後 `CopyQuadsToPass()` 將該 generation 的 source quads 複製／重映射到 `AggregatedRenderPass`。這第一次提供 `Surface generation → aggregated quad` 的具體 runtime bridge。

## 本小時最重要 5 個發現

### 1. ResolvedFrameData 是 active-generation 到 aggregation 的版本邊界
【已確認事實／原始碼】`SurfaceAggregator::GetResolvedFrame(SurfaceId)` 將 resolved frame cache 與 `surface->GetActiveFrameIndex()` 比較；active index 改變時重新 `ProcessResolvedFrame()`。同時 `SurfaceRange` 在一次 aggregation 期間會被 cache 到選定的 latest in-flight SurfaceId，避免同一 aggregation 中反覆解析成不同 Surface。

來源：https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/display/surface_aggregator.cc

意義：Hermes 的 `AggregationEpoch` 不只是抽象概念；Chromium 本身存在「本次 aggregation 固定 resolution」的 runtime 行為。

限制：fallback SurfaceRange、interpolation、surface animation 仍需個別建模。

### 2. HandleSurfaceQuad 是 parent SurfaceDrawQuad → child generation 的解析關口
【已確認事實／原始碼】`HandleSurfaceQuad()` 先取得 `surface_quad->surface_range.end()` 作為 primary Surface，再透過 `GetResolvedFrame(surface_range)` 選定實際 resolved child；若找不到 Surface，會輸出 default-background SolidColorDrawQuad；若使用 fallback，damage/geometry 行為也不同。

因此 provenance 必須保存：

`ParentSurfaceDrawQuad → SurfaceRange → ResolvedSurfaceId → ResolvedFrameGeneration`

而不能只記 `SurfaceRange.end()`。

### 3. CopyQuadsToPass 提供 generation → AggregatedDrawQuad 的實際 bridge
【已確認事實／原始碼】在 merge path，`HandleSurfaceQuad()` 直接以 resolved root pass 呼叫 `CopyQuadsToPass()`；非 merge path 則建立 remapped AggregatedRenderPass，再由 `CopyQuadsToPass()` 複製 source pass quads。一般 quad 會由 `dest_pass->CopyFromAndAppendDrawQuad(quad)` 產生 destination quad，resource identity 同時被 remap。

因此可建立新的 evidence edge：

`ResolvedFrameGeneration --EMITS/REMAPS--> AggregatedDrawQuad`

限制：Chromium 現有 AggregatedDrawQuad 本身沒有自動附帶 Hermes 所需的 source-generation provenance label；若要 runtime 可觀測，需要 sidecar map 或 instrumentation。

### 4. 「被 copy 到 AggregatedRenderPass」仍不等於 target pixel 最終可見
【已確認事實 + 工程推論】`CopyQuadsToPass()` 保存 rect/visible_rect、SharedQuadState、transform、clip、resource remap，但後續仍存在 quad order、opacity、blend、mask、filter、occlusion、overlay promotion 等 composition effects。因此證據階梯應拆成：

`GENERATION_BOUND → QUAD_BOUND → GEOMETRIC_REGION_BOUND → COMPOSITING_VISIBLE → PRESENTED → CAPTURE_INCLUDED`

這與先前 VisualContributionGraph / DisplayCompositionWitness 相容，並把兩條研究線真正接起來。

### 5. FineState-Bench 再次證明「找到控制項」不等於「達到精確 UI state」
【論文結果】FineState-Bench（Ji et al., 2026）包含 2,209 個 desktop/web/mobile instances、23 種 UI component，將 GUI 任務拆成 localization、interaction、exact-state success；最佳 exact target-state success 在 Web 為 32.8%，跨平台平均 22.8%。Visual Diagnostic Assistant 提供 localization hint 後仍留下大量 state-setting failure。

Paper: FineState-Bench: Benchmarking State-Conditioned Grounding for Fine-grained GUI State Setting
Authors: Fengxian Ji, Jingpu Yang, Zirui Song, Yuanxi Wang, Zhexuan Cui, Yuke Li, Qian Jiang, Xiuying Chen
Year: 2026
URL: https://arxiv.org/abs/2604.27974
Code: https://github.com/FengxianJi/FineState-Bench
Dataset: 2,209 instances; desktop/web/mobile; 23 UI component types
Architecture/Eval: SR@Loc → SR@Int → ES-SR@Loc → ES-SR@Int
Contribution: separates grounding, interaction, and exact-state verification
Limitations: benchmark-level UI evidence，沒有 compositor/source-frame ground truth

## Architecture Breakdown

```text
Producer CompositorFrame(frame_token)
→ Surface pending/active frame
→ SurfaceFrameGeneration
   ├─ SurfaceId
   ├─ ActiveFrameIndex
   └─ FrameToken
→ ResolvedFrameData
   ├─ cached per SurfaceId
   └─ refreshed on active-frame-index change
→ ResolvedPassData
→ parent SurfaceDrawQuad
→ SurfaceRange resolution
→ HandleSurfaceQuad
→ CopyQuadsToPass
   ├─ copy SharedQuadState
   ├─ transform / clip
   ├─ remap RenderPassId
   └─ remap ResourceId
→ AggregatedDrawQuad
→ AggregatedRenderPass
→ VisualContributionGraph
→ Overlay / platform composition
→ PresentationGroup / PresentationFeedback
→ CaptureEvidenceDAG
→ Vision Encoder
→ Visual Tokens
→ Agent State Belief
→ Action Gate
```

System architecture insight：`PresentationGroup` 回答「哪幾代 source frame 被本次 display aggregation 通知為 presented」；`CopyQuadsToPass provenance` 回答「哪一代 source frame 的哪些 draw primitives 進入哪個 aggregated pass」；兩者必須 join 才能形成 region-level presentation proof。

## Bottom-Level Logic

建議 Hermes 新增 sidecar evidence model：

```text
AggregatedQuadProvenance {
  aggregationEpoch,
  sourceSurfaceId,
  sourceActiveFrameIndex,
  sourceFrameToken,
  sourceRenderPassId,
  sourceQuadIndex,
  resolvedSurfaceRange,
  usedFallback,
  destinationRenderPassId,
  destinationQuadIndex,
  sourceRect,
  sourceVisibleRect,
  destinationRect,
  transform,
  clipRect,
  opacity,
  blendMode,
  resourceRemap,
  provenanceStrength
}
```

region query：

```text
TargetRegion R
→ find AggregatedDrawQuads whose transformed visible geometry intersects R
→ recover AggregatedQuadProvenance
→ group by SurfaceFrameGeneration
→ apply clip / z-order / opacity / blend / mask / filter dependency
→ compute CandidateGenerationSet(R)
→ compute VisibleGenerationSet(R)
→ join PresentationGroupWitness
→ join CaptureWitness
→ derive RegionObservationAuthority(R)
```

重要：`rect intersects R` 只能產生 candidate，不可直接標成 visible contributor。

## Visual Simulation Idea

### Generation → Quad → Pixel Provenance Microscope

Console 左側顯示 Surface generations；中央顯示 AggregatedRenderPass quad stack；右側顯示 target region / captured pixels。點擊任一 pixel 或 UI 元件後反向高亮：

```text
Pixel R
← visible AggregatedQuad Q17
← copied source quad q4
← ResolvedPass P3
← Surface S2 @ active-index 41 / frame-token 471
← PresentationGroup G31
← PresentFence / Feedback
← Capture C22
```

可注入：fallback Surface、active-frame replacement、merged pass、non-merged pass、clip、opacity、occlusion、moving-pixel filter、overlay promotion、copy-output request。每條 edge 顯示 `CAUSAL / GENERATION_BOUND / QUAD_BOUND / REGION_BOUND / PRESENTED / CAPTURED / UNKNOWN / BROKEN`。

## Code / GitHub

本輪值得繼續讀的 Chromium 核心檔案：

- `components/viz/service/display/surface_aggregator.cc` — `GetResolvedFrame`, `HandleSurfaceQuad`, `CopyQuadsToPass`, `CopyPasses`, `Aggregate`
- `components/viz/service/display/resolved_frame_data.*` — frame/pass/resource resolution 與 aggregation-local state
- `components/viz/common/quads/surface_draw_quad.*` — SurfaceRange embedding primitive
- `components/viz/service/surfaces/surface.*` — active frame/index、presentation helper、activation
- `components/viz/service/display/display.cc` — aggregation → presentation group

本輪不是只讀 README；核心證據來自 Chromium runtime implementation。

## Papers

### FineState-Bench: Benchmarking State-Conditioned Grounding for Fine-grained GUI State Setting
Authors: Fengxian Ji et al.
Institution: 論文作者機構以原文 metadata 為準，本輪未把未交叉驗證 affiliation 寫成確定事實。
Year: 2026
URL: https://arxiv.org/abs/2604.27974
Code: https://github.com/FengxianJi/FineState-Bench
Dataset: 2,209 GUI state-setting instances
Architecture: stage-wise localization / interaction / exact-state diagnostic pipeline
Contribution: 將 GUI grounding 與 exact state verification 分離
Limitations: 不含 compositor provenance / source-generation truth
改變了什麼：把「點對位置」進一步拆成「找到 → 操作 → 精確狀態成立」，支持 Hermes 把 observation/action success 做成 evidence stages。

補充交叉驗證：GUI-Eyes（Chen et al., 2026, https://arxiv.org/abs/2601.09770）顯示主動 crop/zoom 的 tool-augmented perception 能提升 GUI grounding，支持 Hermes 的 Active Visual Subagent；但 active recapture 仍需 provenance，否則只是得到另一張未知來源的 screenshot。

## Unknown / Open Questions 1-3

1. `ResolvedFrameData` 在 interpolation / fallback / SurfaceRange replacement 時，如何精確標記實際被 copy 的 generation，而不把 primary SurfaceId 誤當成 resolved SurfaceId？
2. `CopyQuadsToPass()` 是否有最小侵入點可建立 `destination quad → source (SurfaceId, frame_index, frame_token, pass, quad-index)` sidecar map，且不改變 production rendering semantics？
3. moving-pixel filters、render-pass merging、overlay promotion 後，如何把 source-generation region contribution一路保持到 capture buffer，而不只停在 geometric intersection？

## 下一輪研究

優先追：

`ResolvedFrameData → ResolvedPassData → quad_data/remapped_resources → destination AggregatedDrawQuad identity → DirectRenderer/SkiaRenderer consumption`

目標建立 `AggregatedQuadIdentity`，並確認它能否跨 render-pass merge / resource remap / overlay promotion 維持可追蹤性。第二優先把 `AggregatedQuadProvenance` 接回先前的 `VisualContributionGraph`，開始產生真正的 `RegionContributionProof`。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：

- `ResolvedFrameGeneration`
- `ResolvedSurfaceRangeBinding`
- `ResolvedPassData`
- `AggregatedQuadIdentity`
- `AggregatedQuadProvenance`
- `SourceQuadIdentity`
- `ResourceRemapWitness`
- `CandidateGenerationSet`
- `VisibleGenerationSet`
- `RegionObservationAuthority`

新增 Edges：

```text
SurfaceFrameGeneration --RESOLVED_AS--> ResolvedFrameGeneration
SurfaceDrawQuad --SELECTS--> ResolvedSurfaceRangeBinding
ResolvedFrameGeneration --CONTAINS--> ResolvedPassData
ResolvedPassData --COPIES_QUAD_AS--> AggregatedQuadIdentity
SourceQuadIdentity --REMAPS_RESOURCE_TO--> AggregatedQuadIdentity
AggregatedQuadIdentity --INTERSECTS--> TargetRegion
AggregatedQuadIdentity --CONTRIBUTES_IF_VISIBLE_TO--> TargetRegion
VisibleGenerationSet --MEMBER_OF--> PresentationGroupWitness
PresentedRegionProof --INCLUDED_BY?--> CaptureWitness
CaptureWitness --AUTHORIZES--> RegionObservationAuthority
```

## 本輪結束判斷

- 缺哪一層：`AggregatedDrawQuad → post-compositing visible region → capture inclusion`。
- 哪個節點最淺：`AggregatedQuadIdentity`，因為 production quad 在 copy/remap 後尚缺穩定 provenance sidecar identity。
- 哪個概念仍只是名詞：`RegionContributionProof`；目前只接到 aggregated quad，還沒完成 occlusion/filter/overlay/capture closure。
- 哪個系統值得讀原始碼：Chromium `ResolvedFrameData + SurfaceAggregator + DirectRenderer/SkiaRenderer`。
- 哪篇論文需追引用：FineState-Bench，尤其 exact-state diagnostic 與後續 state verification 工作。
- 哪個概念最適合視覺模擬：`Generation → Quad → Pixel Provenance Microscope`。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Active Visual Subagent + Region Provenance DAG + Presentation/Capture Witness + Transition Evidence Verifier + Risk-Adaptive Action Gate`。

最終鏈條目前補到：

`UI state → renderer CompositorFrame → Surface generation → ResolvedFrameData → source quad → AggregatedDrawQuad → [待補：visible contribution] → platform presentation → capture → vision tokens → Agent state belief → action`。

本輪最大的進展：上一輪只知道「哪一代 Surface 是 presented group member」；這一輪已找到 Chromium 真正把那一代 Surface 的 render-pass/quads 複製進 AggregatedRenderPass 的 runtime bridge。下一個問題不再是『這個 frame 有沒有被 aggregation 用到』，而是『它被 copy 出來的哪個 AggregatedDrawQuad，最後是否真的形成 Agent 所依賴的那個 target-region pixel』。