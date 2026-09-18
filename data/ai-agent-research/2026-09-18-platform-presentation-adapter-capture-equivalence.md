# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 14:54（Asia/Taipei）

主題：Platform Presentation Adapter × Capture Equivalence × Cross-Platform Display Proof

## 本小時新發現

本輪承接上一輪 `Display Composition Witness × Presentation Closure × Scheduled Plane Set`，不重複 Viz aggregation / overlay candidate / swap lifecycle，而是研究下一個缺口：**Chromium 把 ScheduledPlaneSet 交給不同 OS 後，Windows DComp、Linux/Wayland、Android SurfaceControl、macOS CALayer 是否仍能用同一套「presented」語義？Screenshot / CopyOutput 又是否等價於使用者實際看到的 platform composition？**

核心結論：不能建立單一跨平台 `PresentedPlaneSet` 假設。Chromium 的 DirectRenderer/OverlayProcessor 會先產生 primary plane 與 overlay list，但後續 presentation 是 platform-specific。Android 可使用 SurfaceControl 管理 display compositor buffer queue 與 overlays；macOS 路徑會把大量 render passes promotion 成 CALayer；Windows delegated/DComp composition 甚至可能保留 root pass 但不 render；Wayland presentation 又受到 compositor frame callback/vsync protocol 約束。因此 Hermes 應建立 `PlatformPresentationAdapter`，把共同語義限制在 `Scheduled → Swap/Commit → Feedback`，把 plane identity、commit atomicity、capture equivalence 留給平台 adapter 證明。

## 本小時最重要 5 個發現

### 1. Platform presentation 不是 Viz presentation 的單一延伸
**已確認事實 / Chromium 原始碼：** `DirectRenderer` 在 overlay processing 前建立 primary plane，接著由 OverlayProcessor 產生 overlay list；但不同平台採不同 output/composition backend。

底層：
`AggregatedRenderPass → DirectRenderer → PrimaryPlane + OverlayList → SkiaOutputDevice/OutputSurface → Platform compositor → Presentation feedback`

重要性：Hermes 不能用同一個 `PresentedPlaneSet` schema 假裝所有 OS 都能 read-back 相同資訊。

限制：公開 presentation feedback 通常證明 timing/commit lifecycle，不必然提供完整 platform plane-set readback。

來源：Chromium `components/viz/service/display/direct_renderer.cc`、Skia output device implementations。

### 2. Android SurfaceControl 是真正獨立的 composition backend
**官方工程實作：** Chromium feature 定義明確說明 Android SurfaceControl 用來管理 display compositor buffer queue 與 overlays；OverlayProcessor 在 SurfaceControl case 使用專門 processor。

底層：
`Viz candidate → OverlayProcessorSurfaceControl → AHardwareBuffer-backed resource → SurfaceControl transaction/buffer queue → Android compositor → display`

重要性：若 screenshot/copy path 只複製 Viz root framebuffer，就不能自動推出它包含所有 SurfaceControl plane 的正常 presented 結果。

限制：本輪尚未完成 SurfaceFlinger transaction/latch/fence 與 Chromium feedback identity 的完整 causal binding。

### 3. macOS CALayer promotion 改變「root framebuffer = screen」假設
**已確認工程資訊：** Chromium DirectRenderer 的 Apple path 註記指出 Mac 上 render passes 可 promotion 到 CALayer；GPU metrics 也記錄 Skia output surface 每幀 scheduling overlays 時建立 pending CALayer tree 的成本。

底層：
`RenderPass → CALayer candidates/tree → ScheduleOverlays → CoreAnimation composition → presentation`

重要性：正常 screen composition 可能是 layer tree，而不是一張完整 root buffer。

限制：仍缺 CoreAnimation transaction / IOSurface / display callback 對 Chromium swap_trace_id 的完整 mapping。

### 4. Windows delegated composition 甚至可能不 render root pass
**已確認工程資訊：** Chromium current DirectRenderer 在 Windows delegated compositing 情境註記 root pass 可以被 preserved but not rendered。

因此：
`RootRenderPass exists ≠ RootRenderPass pixels were rasterized ≠ RootRenderPass equals presented desktop pixels`

重要性：這直接否定「Copy root render pass = 使用者所見」作為通用 capture equivalence。

限制：本輪未完成 DComp visual tree / swap chain / overlay plane presentation readback。

### 5. Capture Equivalence 必須成為 platform + capture-mode-specific proof
合理模型：
`CapturePixelEquivalence(platform, captureMode, planeSet, time)`
而不是全域 boolean。

建議 verdict：
- `PROVEN_EQUIVALENT`
- `PRIMARY_ONLY`
- `COMPOSITED_BUT_PERTURBED`
- `TIMING_CORRELATED`
- `UNKNOWN`
- `KNOWN_DIVERGENT`

例如 CopyOutput 可能讀 Viz composition；OS screen capture 可能在 platform compositor 後；某些 protected/secure overlay 可能根本不可 capture；capture request 本身又可能抑制 overlay promotion。故「Agent screenshot」與「user-visible screen」應保留兩條 evidence chain。

## Architecture Breakdown

### PlatformPresentationAdapter

```text
Viz Aggregation
→ RenderPasses
→ OverlayProcessor
→ ScheduledPlaneSet
→ PlatformPresentationAdapter
   ├─ WindowsDCompAdapter
   ├─ WaylandAdapter
   ├─ AndroidSurfaceControlAdapter
   └─ MacCALayerAdapter
→ PlatformCommitWitness
→ PresentationFeedbackWitness
→ PresentedCompositionVerdict
```

Adapter 不應只回傳 `presented=true`，而應回傳：

```text
PlatformPresentationWitness {
  platform
  backend
  scheduledPlaneEvidence
  commitIdentity
  swapIdentity
  feedbackIdentity
  presentationTime
  planeSetReadbackStrength
  protectedContentState
  captureMode
  captureEquivalenceVerdict
}
```

### Capture Evidence 雙路徑

```text
NORMAL PRESENTATION
Viz → Plane scheduling → Platform compositor → Display

CAPTURE
Viz / Browser / OS capture API
→ capture-specific composition path
→ bytes
→ Vision encoder
```

Hermes 必須保存 `NORMAL_PRESENTATION` 與 `CAPTURE` 是否 share causal ancestor，而不是只比較 timestamp。

## Bottom-Level Logic

### Android
`CompositorFrame → Viz aggregation → OverlayProcessorSurfaceControl → SurfaceControl-backed plane/buffer → platform transaction → latch/present → feedback`

### macOS
`CompositorFrame → RenderPass → CALayer promotion → pending CALayer tree → CoreAnimation composition → presentation`

### Windows
`CompositorFrame → overlay/delegated composition decision → DComp visual/plane path → platform commit → presentation`

### Wayland
`CompositorFrame → buffer/overlay submission → Wayland compositor → frame callback / presentation timing → next BeginFrame pacing`

2026-06 的 Chromium Wayland change 甚至需要對同一 refresh cycle 的多個 frame callbacks 做 vsync throttle，否則會過早產生下一 frame、造成 dropped frame/driver stall。這再次證明 browser frame production 與 platform presentation timing 是耦合但不同的狀態機。

## Visual Simulation Idea

### Cross-Platform Presentation & Capture Equivalence Lab

左側選擇平台：Windows / Wayland / Android / macOS。

中央顯示：
```text
Root RenderPass
├─ Plane 0 primary
├─ Plane 1 video
├─ Plane 2 iframe
└─ Plane 3 browser UI
       ↓
Platform Adapter
       ↓
Commit / Swap
       ↓
Presented Composition
```

右側同時顯示 Capture Path：
```text
CopyOutput / Page Screenshot / OS Capture
→ Captured Plane Coverage
→ Missing / Perturbed Planes
→ Pixel Digest / Region Coverage
```

可注入：overlay promotion、protected video、capture request、delegated composition、SurfaceControl、CALayer promotion、Wayland delayed callback、swap ACK without presentation、platform plane missing。

UI 指標：`ScheduledPlaneCoverage`、`PresentedEvidenceStrength`、`CapturePlaneCoverage`、`CapturePerturbation`、`CaptureEquivalenceVerdict`、`TargetRegionVisibleToUser`、`TargetRegionVisibleToAgent`。

## Code / GitHub

本輪值得繼續追的 Chromium 原始碼：
- `components/viz/service/display/direct_renderer.cc`
- `components/viz/service/display/overlay_processor_interface.cc`
- `components/viz/service/display_embedder/skia_output_device*`
- `ui/ozone/platform/wayland/`
- Android SurfaceControl / Viz display paths
- Windows DComp overlay/output-device paths
- macOS CALayer/Skia output-device paths

不是只看 README；下一輪應沿 `ScheduleOverlays → SwapBuffers/CommitOverlayPlanes → platform callback → presentation feedback` 做 function-level call graph。

## Papers / Technical Sources

本輪重點是 Chromium system architecture 與原始碼，而不是新增一篇泛論文。新增值得追的工程變更：Chromium 2026-06-16 `BeginFrameSourceWayland: rate limit frame callbacks for the same vsync`，顯示 Wayland frame callback 與 browser scheduler 的 timing mismatch 會造成過早 frame production、drop 與 driver stall。

## 與歷史研究比較

上一輪已建立 `COMPOSED → SCHEDULED → SWAPPED → ACKED → PRESENTED`。本輪新增的是：`PRESENTED` 本身不是跨平台同構 evidence。它必須展開成 `PlatformPresentationAdapter → PlatformCommitWitness → Platform-specific presentation feedback`，且 capture 是平行 evidence path，不是 presentation 的自然副產品。

## Unknown / Open Questions

1. Windows DComp、Android SurfaceControl、macOS CoreAnimation 是否能取得足夠穩定的 per-plane identity，與 Chromium `swap_trace_id/frame_token` 做 causal binding？
2. 哪些 screenshot / CopyOutput / OS capture mode 能包含 platform overlays，哪些會抑制 overlay、漏掉 protected plane，或重新 composition？
3. 能否建立 target-region 級別的 `UserVisible ↔ AgentVisible` equivalence，而不需要 full-screen pixel equality？

## 下一輪研究

直接追 `Capture Equivalence` 的實際 capture implementations：Chrome `Page.captureScreenshot` / CopyOutput、Windows Graphics Capture/DComp、Android SurfaceControl/PixelCopy、macOS ScreenCapture/CoreAnimation、Wayland screencopy/portal。建立 capture-mode matrix，明列 capture 發生在 Viz 前、Viz 後、platform compositor 後哪一層，以及 overlay/protected content coverage。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
`PlatformPresentationAdapter`, `WindowsDCompAdapter`, `WaylandPresentationAdapter`, `AndroidSurfaceControlAdapter`, `MacCALayerAdapter`, `PlatformCommitWitness`, `PlatformPlaneIdentity`, `CaptureMode`, `CapturePlaneCoverage`, `UserVisibleRegion`, `AgentVisibleRegion`, `CaptureEquivalenceVerdict`, `PresentationBackend`, `PlatformFeedbackIdentity`。

新增 Edges：
`ScheduledPlaneSet --HANDLED_BY--> PlatformPresentationAdapter`
`PlatformPresentationAdapter --EMITS--> PlatformCommitWitness`
`PlatformCommitWitness --CORRELATED_WITH--> PresentationFeedbackWitness`
`CaptureMode --OBSERVES--> CapturePlaneCoverage`
`CapturePlaneCoverage --MAY_DIFFER_FROM--> PresentedPlaneSet`
`UserVisibleRegion --COMPARES_WITH--> AgentVisibleRegion`
`CaptureRequest --MAY_PERTURB--> OverlayPromotion`

## 本輪結束判斷

- 缺哪一層：capture API 到 platform plane coverage 的 causal mapping。
- 哪個節點最淺：`PlatformPlaneIdentity`，尤其 DComp/CALayer/SurfaceControl 到 Chromium frame token 的 binding。
- 哪個概念仍只是名詞：跨平台通用的 `PresentedPlaneSet`；應由 platform adapter 取代。
- 哪個系統值得讀原始碼：Chromium SkiaOutputDevice + Windows DComp / Android SurfaceControl / macOS CALayer / Wayland Ozone 四條 backend。
- 哪篇論文/技術來源需追引用：2026-06 Chromium Wayland BeginFrameSource change，以及各平台 output-device implementation 的後續 CL。
- 哪個概念最適合視覺模擬：`User-visible vs Agent-visible Capture Equivalence`。
- 哪個 Agent 架構最值得實作：`Structured State + Render Provenance + Platform Presentation Adapter + Capture Equivalence Gate + Region-Level Action Gate`。

最終鏈條更新為：

`User Input → UI → Agent Runtime → Context → Reasoning → Planning → Memory/Tools/MCP → Browser Program State → DOM/AX → Blink/Layout/Paint → CompositorFrame → Viz Surface/Aggregation → Visual Contribution → ScheduledPlaneSet → PlatformPresentationAdapter → Presented Composition → Capture Path → Vision Tokens → Grounding → Action Freshness/Correspondence/Capture-Equivalence Gate → External Action → Settlement → Output`。

核心進展：**「AI 看見的畫面」與「使用者看見的畫面」現在被正式拆成兩條可比較的 evidence path。真正可靠的 Computer Agent 不應假定 screenshot 就是 display truth；它必須知道 capture 發生在哪一層、涵蓋哪些 plane、是否改變 composition，以及 target region 在 user-visible 與 agent-visible 兩個世界中是否真的等價。**