# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-18 10:50 Asia/Taipei

## 本小時新發現

本輪承接上一輪 `Trace-Correlated Render Witness × Exact-Surface CopyOutput × Pixel Binding`，不重複 SurfaceId/frame_token/presentation feedback，而是追最深缺口：**root CompositorFrame 已 presented 時，OOPIF/embedded child region 是否一定來自 child 的最新 surface？**

結論：不是。Chromium Viz aggregation 會解析 `SurfaceDrawQuad` 的 primary surface range；若 primary 不可用，aggregator 可以選擇 latest in-flight/fallback surface，甚至在沒有可用 surface 時輸出 default background。Surface synchronization 的測試也明確描述 aggregation-time 會選「freshest surfaces available」，這不是「所有 child 都與 root 同 revision」的 atomic snapshot。

因此 Hermes 必須把 `PresentedFrameWitness` 升級成 **PresentedSurfaceSetWitness**：證明實際被聚合進 root output 的 surface set，以及每個 embedded region 最終採用 PRIMARY / FALLBACK / DEFAULT / UNRESOLVED 哪一條 render path。

---

## 本小時最重要 5 個發現

### 1. Root presented 不代表所有 child 都是 latest
**已確認／Chromium 原始碼與測試。** `SurfaceAggregator::HandleSurfaceQuad()` 先解析 primary SurfaceId，再向 SurfaceManager 尋找可用 in-flight surface；若找不到 active frame，可能退回 default background。Surface synchronization 測試則明確說明 latest-in-flight/fallback 機制用於 aggregation time 呈現 freshest surfaces available。

底層：
`Root CompositorFrame → SurfaceDrawQuad → SurfaceRange(primary/fallback) → GetLatestInFlightSurface → active child frame or fallback/default → aggregate → display`

重要性：root 的 frame token/presentation proof 只能證明 root output 被呈現，不能單獨證明 iframe/child region 使用的是 child 最新 frame。

限制：公開 API 不一定直接暴露完整 aggregated child surface lineage。

### 2. SurfaceDrawQuad 本身就是跨 process render dependency
**已確認／Chromium 工程實作。** `SurfaceLayerImpl` 會建立 primary SurfaceDrawQuad；當 primary/fallback 不同時，舊版與相關實作會把 primary surface 加入 activation dependencies，並保留 fallback quad。這表示 child embedding 不是普通 bitmap copy，而是具有 surface identity、activation/fallback semantics 的 dependency edge。

Hermes 應建立：
`RootFrame --EMBEDS--> SurfaceRange --SELECTED_AS--> ChildSurface`

### 3. Fallback 是合法呈現狀態，不是 rendering error
**已確認／Chromium tests。** SurfaceAggregator 測試驗證：primary 存在時使用 primary；primary 不可用時可以使用 fallback。這表示「畫面成功顯示」仍可能是 stale-but-valid fallback。

新的 correctness distinction：
`VisuallyPresent != SemanticallyFresh`

對 Agent 點擊尤其重要：如果 iframe region 顯示 fallback，而 DOM/AX/tool state 已指向 newer child document，pixel grounding 與 semantic grounding 已分叉。

### 4. PresentedSurfaceSet 應包含 selection reason 與 freshness relation
**Hermes architecture proposal／合理推論。** 單純保存 `{root, childA, childB}` 不夠，應保存：
`surfaceId, frameSinkId, localSurfaceId, selectedPath, primaryCandidate, fallbackCandidate, activeFrame?, presentation relation, freshness relation, region/transform`。

建議 verdict：`PRIMARY_CURRENT / PRIMARY_OLDER / FALLBACK / DEFAULT / UNKNOWN`。

### 5. Browser Agent 的 action gate 必須從 frame-level 提升到 region-level proof
**工程推論，受 Chromium aggregation semantics 與 2026 cross-origin iframe Browser Use failure案例支持。** 若 action target 位於 OOPIF，Hermes 應先解析 target region → embedded surface → selected child surface → correspondence/freshness，再決定是否允許 click。公開 Browser Use issue 也顯示 cross-origin iframe 可能出現 parent 可觀察、child 不可 inspect/click、screenshot 又不是實際 viewport 的 observability gap。

---

## Architecture Breakdown

```text
Browser / Renderer Processes
  Root Renderer
    └─ Root CompositorFrame F_root
         ├─ normal quads
         └─ SurfaceDrawQuad
              ├─ primary SurfaceId S_child_new
              └─ fallback SurfaceId S_child_old

Viz SurfaceManager
  → resolve SurfaceRange
  → inspect active/in-flight surface
  → select actual child surface
  → aggregate render passes
  → produce display frame
  → presentation feedback

Hermes Witness Layer
  RootFrameWitness
  → SurfaceEmbeddingEdge
  → SurfaceSelectionWitness
  → PresentedSurfaceSetWitness
  → RegionFreshnessVerdict
  → ActionFreshnessGate
```

這一層的 system architecture 重點不是「Browser screenshot」，而是 **multi-process graphical state aggregation**。

## Bottom-Level Logic

```text
SurfaceDrawQuad arrives
→ read primary surface range end
→ resolve latest usable/in-flight surface
→ if usable active frame:
     emit selected surface content
  else:
     emit default/fallback path
→ recursively aggregate embedded render passes
→ transform/clip into parent coordinate space
→ produce aggregated frame
→ submit/present
```

Hermes 新 invariant：

```text
RootPresented(R)
DOES_NOT_IMPLY
∀ child c ∈ VisibleChildren(R): Latest(c)
```

更強的 action admissibility：

```text
RegionActionAdmissible(T)
=
TargetRegionBound(T)
∧ SelectedSurfaceKnown(T)
∧ SurfaceFreshEnough(T)
∧ SemanticPixelCorrespondence(T)
∧ RequiredObservationFresh(T)
```

## Visual Simulation Idea

### Presented Surface Set & OOPIF Freshness Microscope

```text
ROOT F900  PRESENTED ✓
│
├─ Header          local quad
├─ iframe A        PRIMARY  S-A-19 ✓
├─ iframe B        FALLBACK S-B-07 ⚠
└─ iframe C        DEFAULT  ■ ?

Target click
   ↓
iframe B region
   ↓
SelectedSurface = FALLBACK
   ↓
Freshness Gate = BLOCK / RECAPTURE
```

互動控制：child submission delay、primary activation、fallback availability、OOPIF count、root presentation timing、navigation、surface eviction、Viz crash/default background、target region。視覺輸出：Surface DAG、selected surface path、fallback age、root/child skew、region proof strength、click admissibility。

## Code / GitHub

本輪深入 Chromium Viz/cc 原始碼與測試，值得下一輪繼續讀：
- `components/viz/service/display/surface_aggregator.cc`
- `components/viz/service/display/surface_aggregator_unittest.cc`
- `components/viz/service/frame_sinks/surface_synchronization_unittest.cc`
- `cc/layers/surface_layer_impl.cc`
- 下一輪：`components/viz/service/surfaces/surface.*`、SurfaceManager、aggregation contained-surfaces bookkeeping、CopyOutput aggregated path。

## Papers / technical sources

本輪核心證據主要是 Chromium 官方原始碼與 tests，而非論文。補充工程案例：2026-05-05 OpenAI Codex Browser Use issue #21144 記錄 cross-origin iframe 在 parent 可見時仍可能無法 inspect/click，且 screenshot capture 可能不是實際 browser viewport；它不是 Chromium correctness proof，但說明 Agent runtime 的 iframe observability/capture boundary 是真實工程風險。

## Unknown / Open Questions 1-3

1. 能否在不修改 Chromium 的情況下，從 Perfetto/Viz tracing 重建一次 display aggregation 實際包含的完整 `SurfaceId` set？
2. exact-surface CopyOutput 若從 root 執行，是否能同時取得/推導被聚合 child surfaces 的 identity lineage，還是只得到 pixels？
3. child fallback 的「freshness」應相對於哪個 reference 判定：parent expected LocalSurfaceId、child latest submitted surface、document navigation identity，或 semantic target state？

## 下一輪研究

直接追 `SurfaceAggregator` contained surfaces / referenced surfaces / SurfaceManager 與 CopyOutput aggregation，建立：

`Root FrameToken → Aggregated Surface Set → Selected Child Surface → Child Frame Evidence → Pixel Region → Target Element`

並研究 region-level pixel provenance，回答「某個 click 座標的 pixels 到底由哪個 renderer/surface/frame 產生」。這將把 Browser correctness 從 whole-frame witness 推到 **Pixel Region Provenance**。

## Knowledge Graph 新增 Node / Edge

Nodes：`PresentedSurfaceSetWitness`、`SurfaceEmbeddingEdge`、`SurfaceRange`、`PrimarySurfaceCandidate`、`FallbackSurfaceCandidate`、`SurfaceSelectionWitness`、`FallbackFreshness`、`RegionFreshnessVerdict`、`OOPIFRenderDependency`、`DefaultBackgroundFallback`、`PixelRegionProvenance`。

Edges：
- `RootCompositorFrame EMBEDS SurfaceRange`
- `SurfaceRange SELECTS SurfaceId`
- `SurfaceId MAY_FALLBACK_TO SurfaceId`
- `SelectedSurface CONTRIBUTES_TO AggregatedFrame`
- `AggregatedFrame PRESENTED_AS DisplayFrame`
- `TargetRegion RENDERED_BY SelectedSurface`
- `RegionFreshnessVerdict GATES ComputerAction`

---

## 本輪結束判斷

- **缺哪一層：** Aggregated frame → exact child surface set → pixel region 的 provenance binding。
- **哪個節點最淺：** `PixelRegionProvenance`。
- **哪個概念仍只是名詞：** `PresentedSurfaceSetCompleteness`，尚未證明公開 tracing 能完整重建。
- **哪個系統值得讀原始碼：** Chromium Viz `SurfaceAggregator` / SurfaceManager / CopyOutput。
- **哪篇論文需追引用：** 本輪以官方原始碼為主；下一輪回補 GUI/OOPIF observation correctness benchmark 與 browser-agent safety work。
- **哪個概念最適合視覺模擬：** OOPIF primary/fallback surface selection 與 region freshness。
- **哪個 Agent 架構最值得實作：** `Region-Proof-Gated Computer Agent`：每個高風險 GUI action 在執行前，要求 target region 的 surface/pixel/semantic evidence 達到指定 proof strength。

最終鏈條再補深一層：

`User → Agent → Browser Observation → DOM/AX → Blink → Paint → Root/Child CompositorFrames → SurfaceDrawQuad → Viz Surface Selection → Aggregated PresentedSurfaceSet → Pixels → Vision Tokens → Reasoning → Region Proof Gate → Action → Effect → Settlement → Output`

核心結論：**「root frame 已 presented」不是整頁 freshness proof。OOPIF/embedded region 可以合法地使用 fallback 或不同步的 child surface。Hermes 若要回答 AI 到底看到了什麼，就必須從 whole-screen screenshot 繼續往下追到每個可操作 region 實際由哪個 SurfaceId/frame path 產生；只有 target region 的 render provenance 與 semantic state 對得上，Computer Agent 才有資格把『看見』轉成『點擊』。**