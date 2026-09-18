# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 15:52（Asia/Taipei）

主題：Capture Equivalence Matrix × Agent-Visible vs User-Visible World × Observation Provenance

## 本小時新發現

本輪承接上一輪 `PlatformPresentationAdapter × Capture Equivalence`，不再重複 Windows DComp / Wayland / Android SurfaceControl / macOS CALayer 的 platform backend 分流，而是直接研究下一個缺口：**不同 capture API 到底在哪一層取樣？Agent 得到的 pixels 能否被當成使用者當下真正看到的 pixels？**

核心結論：`screenshot` 不是單一 observation primitive。至少必須區分 browser-surface capture、Viz/CopyOutput capture、OS compositor capture、display/output capture、hardware writeback。不同 capture path 對 overlay、cursor、protected content、color pipeline、timing、capture-induced recomposition 的涵蓋不同。因此 Hermes 應把 screenshot 改成 `CaptureObservation`，並保存 `captureSource / captureBoundary / planeCoverage / timingWitness / perturbation / protectionPolicy / pixelDigest`。

## 本小時最重要 5 個發現

### 1. Chrome Page.captureScreenshot 的 `fromSurface` 本身已證明「截圖」有不同 capture boundary
**已確認官方資訊：** Chrome DevTools Protocol `Page.captureScreenshot` 提供 `fromSurface`，官方定義是從 surface 而不是 view 擷取，預設 true。Chromium `PageHandler::CaptureScreenshot` 對 `from_surface=false` 與 surface capture 採不同處理，browser tests 也分別比較兩條路徑。

底層：
`Page.captureScreenshot → fromSurface? → RenderWidgetHostView / surface capture path → image encode → base64`

重要性：Hermes 不能只記 `source=screenshot`；至少要記 `CDP_SURFACE` 與 `CDP_VIEW`。此外 Chromium full-page screenshot 程式碼自己留下 TODO：取得 full-page size 後到真正 capture 時頁面可能已改變，這再次證明 capture 前置 metadata 與 pixels 不是天然 atomic。

來源：
- https://chromedevtools.github.io/devtools-protocol/1-3/Page/#method-captureScreenshot
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/devtools/protocol/page_handler.cc

### 2. Wayland/Weston 提供最清楚的反例：不同 capture source 會直接改變正常 composition
**已確認 protocol 行為：** Weston output-capture protocol 明確區分 `writeback / framebuffer / full_framebuffer / blending`。其中 hardware `writeback` 可能允許 hardware planes 繼續使用；`framebuffer` capture 則會暫時停用 hardware planes 與 DRM KMS color-pipeline features；`blending` 也會停用 hardware planes。

這直接給出：
`CaptureRequested → CompositionStrategyChanged → CapturedPixels`

所以：
`CapturedPixels ≠ CounterfactualNormalPresentedPixels`

即使截圖視覺上「完整」，它也可能是為了 capture 而重新合成後的世界，而不是使用者在沒有 capture request 時看到的原 presentation path。

來源：
- https://wayland.app/protocols/weston-output-capture
- https://wayland.app/protocols/wlr-screencopy-unstable-v1

### 3. OS compositor capture 比 browser capture 更接近 user-visible world，但仍不是完整 display truth
**官方資訊：** Windows Graphics Capture 讓使用者選擇 display 或 application window 作為 capture item；Apple ScreenCaptureKit 也以 display/app/window 作為 shareable content，輸出帶 metadata 的 CMSampleBuffer；Wayland screencopy 類 protocol 則由 compositor 將 output/window content 複製到 client buffer。

合理推論：這些 capture path 的 boundary 通常比 browser-internal CopyOutput 更靠近 OS compositor，因此更適合建立 `UserVisibleWorldWitness`，但仍不能自動升級成 physical-display truth，因為 protected content、cursor mode、HDR/color conversion、hardware plane/writeback support 與 compositor policy 都可能造成差異。

來源：
- https://learn.microsoft.com/windows/apps/develop/media-authoring-processing/screen-capture
- https://developer.apple.com/documentation/screencapturekit
- https://wayland.app/protocols/wlr-screencopy-unstable-v1

### 4. Protected content 使「user visible but agent invisible」成為正式狀態，而不是 screenshot bug
**已確認 protocol 資訊：** Weston content-protection protocol 的目的之一就是讓受保護 surface 不出現在 screenshots，並避免顯示到不安全 output。

因此 Hermes 必須允許：
`UserVisibleRegion = PRESENT`
`AgentVisibleRegion = REDACTED / BLACK / UNAVAILABLE`

這不是 observation failure，而可能是安全策略正確運作。

對 Agent Runtime 的意義：若 target region 是 protected/uncapturable，不應讓 VLM 根據黑畫面或 stale cached pixels猜測；應轉用 semantic/program-state channel，或要求使用者接管。

來源：https://wayland.app/protocols/weston-content-protection

### 5. GUI Agent 研究通常把 screenshot 當 observation tensor，但沒有證明 capture equivalence
**論文結果：** OSWorld 的 observation space包含 complete screenshot、accessibility tree、terminal output，並強調 screenshot 用來對齊 human perception；AndroidWorld 的 State 同時保存 RGB pixels 與 accessibility tree。這些 benchmark 對 agent reasoning 很重要，但它們的 screenshot observation 本身並不提供 browser/Viz/platform/display provenance proof。

最新安全研究 AgentHijack（2026-09-06）更展示 visual patch 可以沿 `screenshot → VLM generation → action parsing → environment execution` 傳播到真實副作用：600 online cases 中 E2E-ASR 20.3%。這表示 screenshot 不只是一張圖片，而是 action authority 的上游 evidence；capture/provenance 錯誤與視覺 injection 都可能一路傳到外部世界。

來源：
- OSWorld, Xie et al., 2024, https://arxiv.org/abs/2404.07972
- AndroidWorld, Rawles et al., 2024, https://arxiv.org/abs/2405.14573
- AgentHijack, Liu et al., 2026, https://arxiv.org/abs/2609.09212

## Architecture Breakdown

### CaptureObservation Architecture

```text
World State
├─ Browser semantic state
│  ├─ DOM
│  └─ AX
├─ Browser render state
│  ├─ Surface
│  ├─ RenderPass
│  └─ Overlay candidates
├─ Platform composition
│  ├─ Primary plane
│  ├─ Overlay planes
│  ├─ Cursor
│  └─ protected content
└─ Physical display

Capture Request
→ Capture API
→ Capture Boundary
→ Capture-induced Perturbation?
→ Plane / Region Coverage
→ Timing Witness
→ Pixel Buffer
→ Encode / Color Transform
→ CaptureObservation
→ Vision Encoder
→ Visual Tokens
→ Context
→ Reasoning
→ Plan
→ Action Gate
```

### 建議資料模型

```text
CaptureObservation {
  observationId
  captureApi
  captureMode
  captureBoundary
  sourceIdentity
  requestedRegion
  capturedRegion
  cursorPolicy
  protectedContentPolicy
  planeCoverage
  colorSpace
  hdrMode
  captureRequestedAt
  pixelsReadyAt
  presentationWitness
  perturbationVerdict
  equivalenceVerdict
  pixelDigest
}
```

### Capture Equivalence Matrix

| Capture path | 主要 boundary | Overlay coverage | 可能改變正常 composition | 與 user-visible world 關係 |
|---|---|---|---|---|
| CDP `Page.captureScreenshot(fromSurface=true)` | Browser surface | 不應假定等於 OS plane set | 是，特定 capture/CopyOutput 路徑可能影響 promotion | Browser-render correlated |
| Chromium CopyOutput | Viz/surface/render path | 依 capture target/aggregation | 可能 | Surface/Viz correlated |
| Windows Graphics Capture | OS window/display capture | 平台決定 | 需平台驗證 | OS-compositor correlated |
| ScreenCaptureKit | display/app/window stream | 平台決定 | 需平台驗證 | OS-compositor correlated |
| Wayland screencopy | compositor output/region | compositor決定 | implementation-dependent | compositor correlated |
| Weston framebuffer capture | final framebuffer | hardware planes被停用後重組 | **明確是** | capture-composed world |
| Weston hardware writeback | display/writeback path | 可保留 hardware planes | 較低但依硬體 | 最接近 display-path witness |

關鍵規則：表中任何一列都不能單憑 API 名稱標記 `PROVEN_EQUIVALENT`；必須由 platform adapter + capture mode + timing + region coverage 建立證據。

## Bottom-Level Logic

### Capture Equivalence 不應是 bitmap equality 問題

真正要比較的是兩條 causal path：

```text
Normal Path:
WorldRevision W
→ Render R
→ PlaneSet P
→ PlatformCommit C
→ Presentation D
→ UserVisiblePixels U

Capture Path:
WorldRevision W?
→ CaptureRequest Q
→ CaptureBoundary B
→ PossibleRecomposition R'
→ CapturedBuffer X
→ Color/Encode E
→ AgentVisiblePixels A
```

需要證明的是：

```text
SameRelevantWorld(U, A)
AND SameRelevantRegion(U, A)
AND TimingSkew(U, A) <= policy
AND CapturePerturbation does not invalidate semantics
```

不是單純 `hash(U) == hash(A)`；實務上 U 往往根本無法 read back。

### 新增 `CounterfactualPresentationGap`

若 capture request 會關閉 overlay 或改變 color pipeline，Agent 實際看到的是：

`World under observation`

而不是：

`World had it not been observed`

這與物理 measurement 不同，但在系統工程上是一個真正的 observer effect。Hermes 應保存 `CapturePerturbationWitness`，而不是假設 observation 是 passive read。

## Visual Simulation Idea

### Capture Boundary & Observer Effect Lab

畫面左側顯示正常 presentation：

```text
Browser Surface
→ Viz
→ Primary + Video Overlay + OOPIF
→ Platform Compositor
→ Display
```

右側可切換：
- CDP surface screenshot
- CopyOutput
- Windows Graphics Capture
- ScreenCaptureKit
- Wayland screencopy
- Weston framebuffer
- Weston writeback

使用者可注入：
- hardware overlay
- protected video
- cursor separate plane
- HDR/color pipeline
- OOPIF child surface
- capture-induced overlay disable
- one-frame timing skew

Console 即時計算：
`CaptureBoundary / PlaneCoverage / ProtectedRegion / TimingSkew / Perturbation / EquivalenceVerdict / ActionAdmissibility`。

最重要的視覺效果是同時畫出 `UserVisibleWorld` 與 `AgentVisibleWorld`，不同區域用 provenance edge 對應；無證據的 edge 顯示 UNKNOWN，而不是自動連線。

## Code / GitHub

本輪值得繼續追的 Chromium 核心檔案：
- `content/browser/devtools/protocol/page_handler.cc` — CDP screenshot dispatch、fromSurface、full-page capture
- `content/browser/renderer_host/render_widget_host_view_*` — CopyFromSurface / platform view capture boundary
- `components/viz/common/frame_sinks/copy_output_request.*` — CopyOutput semantics
- `components/viz/service/display/*` — aggregation/render/copy path
- `components/viz/service/display_embedder/skia_output_device_*` — platform output / overlay / swap path

外部平台下一層：
- Weston output capture implementation：writeback vs framebuffer 的實際 DRM/KMS path
- Windows Graphics Capture + DComp：capture item 與 visual/swapchain inclusion
- ScreenCaptureKit + CoreAnimation/WindowServer：frame metadata 與 display timing
- Android SurfaceControl / PixelCopy：SurfaceView/secure layer 與 transaction/latch timing

## Papers

### AgentHijack: Visual Patch Attacks on Multimodal Computer-Use Agents
- Authors: Zhihao Liu et al.
- Year: 2026
- URL: https://arxiv.org/abs/2609.09212
- Architecture: visual patch → screenshot observation → VLM → parsed action → environment execution
- Dataset/Eval: 600 online instance-level cases across five GUI-agent/VLM backends
- Contribution: end-to-end驗證視覺 patch 能傳到真實環境副作用
- Result: T-ASR 84.5%, TAPR 47.0%, E2E-ASR 20.3%
- Limitation: 攻擊設定與 agent/backend 範圍有限，不能直接外推所有 CUA
- 改變了什麼：把「視覺輸入安全」從 perception robustness 推進到 execution safety

### OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments
- Authors: Tao Xie et al.
- Year: 2024
- URL: https://arxiv.org/abs/2404.07972
- Observation: screenshot + accessibility tree + terminal
- Contribution: 真實 desktop computer-use benchmark
- Limitation for this research: screenshot 被視為 observation source，而非具有 render/presentation provenance 的 evidence object

### AndroidWorld: A Dynamic Benchmarking Environment for Autonomous Agents
- Authors: Christopher Rawles et al.
- Year: 2024
- URL: https://arxiv.org/abs/2405.14573
- Observation: RGB pixels + accessibility tree
- Action: ADB-based click/swipe/text/navigation
- Limitation for this research: pixels/AX 的 cross-representation revision binding 仍需 runtime 額外建立

## Unknown / Open Questions 1-3

1. Chrome `fromSurface=true` 在 Windows DComp、Android SurfaceControl、macOS CALayer promotion 下，實際 CopyOutput 是否涵蓋所有 promoted/delegated content？需要逐平台讀 `RenderWidgetHostView` 與 Viz CopyOutput call chain，不能由 protocol 名稱推論。
2. Windows Graphics Capture / ScreenCaptureKit 能否取得足夠 timing/identity metadata，與 Chromium `swap_trace_id / frame_token` 建立 bounded causal correlation？
3. Android secure/protected layers、Windows protected video、macOS protected media 在各 capture API 的具體 redaction semantics 是否能統一成 `ProtectedRegionWitness`？

## 下一輪研究

優先切入 **Capture API → Chromium/OS concrete call chain**，先選 Windows + Android 兩條：

```text
Chrome frame_token
→ Viz ScheduledPlaneSet
→ DComp / SurfaceControl commit
→ OS capture request
→ captured frame identity/time
→ Region coverage
→ AgentVisiblePixels
```

並建立第一版 `CaptureEvidenceDAG`，要求每張進入 VLM 的 screenshot 都能回答：
1. 從哪個 capture boundary 來？
2. capture 時 world revision 是否可能變動？
3. 哪些 plane/region 被包含？
4. 哪些內容因安全策略不可見？
5. capture 是否改變正常 composition？
6. 這張圖最多能授權哪一級 action？

## Knowledge Graph 新增 Node / Edge

### Nodes
- `CaptureObservation`
- `CaptureBoundary`
- `CaptureAPI`
- `BrowserSurfaceCapture`
- `OSCompositorCapture`
- `DisplayWritebackCapture`
- `CapturePlaneCoverage`
- `CaptureTimingWitness`
- `CapturePerturbationWitness`
- `CounterfactualPresentationGap`
- `ProtectedRegionWitness`
- `UserVisibleWorld`
- `AgentVisibleWorld`
- `CaptureEvidenceDAG`
- `CaptureActionAuthority`

### Edges
- `CaptureAPI --CAPTURES_AT--> CaptureBoundary`
- `CaptureObservation --DERIVED_FROM--> CaptureBoundary`
- `CaptureObservation --COVERS--> CapturePlaneCoverage`
- `CaptureObservation --TIMED_BY--> CaptureTimingWitness`
- `CaptureRequest --PERTURBS--> PlatformComposition`
- `ProtectedRegionWitness --REDACTS--> AgentVisibleWorld`
- `UserVisibleWorld --CORRESPONDS_WITH--> AgentVisibleWorld`
- `CaptureObservation --AUTHORIZES_AT_MOST--> CaptureActionAuthority`

## 本輪結束判斷

- **缺哪一層：** Capture API 到實際 platform plane coverage / captured frame identity 的 concrete call-chain proof。
- **哪個節點最淺：** `CapturePlaneCoverage`，目前 Wayland/Weston最清楚，Windows/macOS/Android仍需要原始碼級 mapping。
- **哪個概念仍只是名詞：** 跨平台 `PROVEN_EQUIVALENT(UserVisiblePixels, AgentVisiblePixels)`；目前不應宣稱成立。
- **哪個系統最值得讀原始碼：** Chromium `PageHandler → RenderWidgetHostView → CopyOutput → Viz`，再接 Android SurfaceControl / Windows DComp。
- **哪篇論文需追引用：** AgentHijack；它把 screenshot evidence corruption 與真實 action consequence 連起來，應追後續 defense / provenance-aware CUA work。
- **哪個概念最適合視覺模擬：** `Capture Boundary & Observer Effect Lab`。
- **哪個 Agent 架構最值得實作：** `Structured State + Semantic Grounding + CaptureEvidenceDAG + Region Provenance + Active Recapture + Risk-Adaptive Action Gate`。

## 對「AI 到底怎麼運作」新增的一層

```text
使用者看到的世界
→ OS / Browser composition
→ Capture Boundary
→ Agent-visible pixels
→ Image preprocessing
→ Vision Encoder
→ Visual Tokens
→ Multimodal Fusion
→ Context
→ Model Reasoning
→ System Planning
→ Tool / Computer Action
→ External Effect
```

本輪最重要的修正是：**「畫面 → Vision Encoder」中間不能再畫一條線就結束。真正的 Computer Agent 在 pixels 進模型之前，還存在 capture API、capture boundary、platform composition、protected content、observer effect、timing skew 與 region coverage。Hermes 若要回答『AI 到底怎麼運作』，每一張 screenshot 都應被視為有來源、有邊界、有時間、有缺失、有安全政策、且有最大 action authority 的 evidence object。**
