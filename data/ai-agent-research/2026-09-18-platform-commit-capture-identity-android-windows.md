# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 16:56（Asia/Taipei）

主題：Platform Commit Identity × Android SurfaceControl × Windows DirectComposition × Capture Authority

## 本小時新發現
本輪承接 15:52 的 Capture Equivalence Matrix，不再重複「Agent-visible ≠ User-visible」結論，而是追缺口：Chrome/Viz 的 frame/swap identity 離開 Chromium 後，如何進入 OS compositor；以及 capture buffer 能否被因果綁回 platform commit。

### 1. Android SurfaceControl transaction 是可觀測的 OS-compositor commit boundary
**已確認／Android 官方 + Chromium 原始碼。** Android SurfaceControl 是 system compositor 管理的 on-screen Surface handle；SurfaceControl 形成 scene-graph hierarchy，Transaction 控制 buffer、geometry、z-order、visibility 等。Chromium `android_surface_control_compat.cc` 動態綁定 `ASurfaceTransaction_apply`、`setBuffer`、`setGeometry`、`setZOrder`、`setVisibility`，並支援 transaction completion callback。

底層鏈：
`Viz ScheduledPlaneSet → AHardwareBuffer → ASurfaceControl → ASurfaceTransaction(setBuffer/geometry/z/visibility) → apply(transaction id) → transaction complete → Android system compositor → display`

這比只保存 `swap_trace_id` 更靠近 platform commit，但 transaction complete 仍不等於 photons/pixels 已被使用者看見。

### 2. Android capture 與 Chromium frame identity 仍是兩個 clock/identity domain
**已確認／Chromium 原始碼。** Chromium Android screen capture 的 `OnRGBAFrameAvailable` 接收 Android-side timestamp，將事件標成 compositor update；這提供 capture timing，但沒有自然攜帶 Chromium `CompositorFrame.frame_token` 或 SurfaceControl transaction id。

因此：
`CaptureTimestamp ≠ SurfaceTransactionId ≠ ChromiumFrameToken`

需要 `PlatformCommitCorrelation`，不能把相近時間戳當成 causal proof。

### 3. Windows DirectComposition 是另一種 composition authority
**已確認／Microsoft 官方。** DirectComposition 接受由 Direct2D/Direct3D 等產生的 bitmap content，組合後交給 Desktop Window Manager 顯示；它本身不是 rasterizer。這代表 Windows 路徑應建模為：
`Chromium/Viz → DComp visual/content → DComp commit → DWM composition → display`
而不是把 Viz root framebuffer 當成最終 display truth。

### 4. Platform commit witness 與 capture witness 必須分離
**工程推論（由上述官方/原始碼支持）。** 建議 Hermes 使用：
`PlatformCommitWitness { platform, chromiumFrameToken?, chromiumSwapTraceId?, platformTransactionId?, bufferIdentity?, commitRequestedAt, commitCompletedAt, presentationEvidence }`
以及獨立：
`CaptureWitness { api, source, captureTimestamp, bufferIdentity?, region, protectedContentPolicy, capturedPixelDigest }`
兩者之間只能以 `CAUSALLY_BOUND / CORRELATED / UNKNOWN / DIVERGENT` edge 連接。

### 5. Agent action authority 應依 observation proof strength，而不是 screenshot confidence
**論文交叉驗證。** StateAct（Yang et al., 2026）顯示 program-state-first + GUI subagent 的 hybrid 比純 screenshot 或純 code 更有效；GUI-Eyes（Chen et al., 2026）顯示 active crop/zoom perception 能改善 grounding。這支持 Hermes 把 recapture 當 runtime action，而不是把單張 screenshot 當 immutable truth。

## 本小時最重要 5 個發現
1. `ASurfaceTransaction_apply` 是 Android platform composition 的 concrete commit primitive；限制：commit completion 不是 display presentation proof。
2. Android capture timestamp 沒有天然等於 Chromium frame token；限制：跨 identity domain 只能先做 correlation。
3. DirectComposition 是 composition layer，不負責 rasterization，最後仍交 DWM；限制：公開 API 不直接提供 Chromium frame-token causal binding。
4. `PlatformCommitWitness` 與 `CaptureWitness` 必須是兩個 Knowledge Graph nodes；限制：需要平台 instrumentation 才能升級為 causal proof。
5. Computer Agent 應用 proof-strength 決定 ALLOW / RECAPTURE / BLOCK；限制：benchmark 目前主要量 task success，還缺 provenance-aware benchmark。

## Architecture Breakdown
`User Intent → Agent Planner → target semantic object → required observation proof → Browser state → Blink/Layout/Paint → CompositorFrame(frame_token) → Viz aggregation → ScheduledPlaneSet → PlatformPresentationAdapter → {Android SurfaceControl Transaction | Windows DirectComposition/DWM} → PlatformCommitWitness → Presentation Evidence`

平行 observation：
`Capture API → captured buffer/timestamp/region → CaptureWitness → PlatformCommitCorrelation → AgentVisibleObservation → Vision Encoder → visual tokens → multimodal fusion → reasoning → action gate`

## Bottom-Level Logic
Android：
`AHardwareBuffer → SurfaceControl node → Transaction.setBuffer → setGeometry → setZOrder → setVisibility → apply → completion callback`

Windows：
`GPU-rendered bitmap/swap-chain content → DirectComposition visual tree → composition commit → DWM → display`

核心 invariant：
`abs(capture_time - commit_time) < ε DOES NOT IMPLY Captured(commit)`

必須尋找 buffer identity、transaction identity、presentation callback 或 OS tracing witness。

## Visual Simulation Idea
### Platform Commit ↔ Capture Correlation Lab
左右兩條時間線：
`Chromium frame_token → Viz swap_trace_id → platform transaction → commit complete → present`
`capture request → OS capture → captured buffer → VLM tokens`

互動注入：late transaction、dropped frame、capture between apply/complete、protected plane、overlay-only region、Android SurfaceControl child update、Windows DComp visual update。UI 顯示 edge：PROVEN / CAUSALLY_BOUND / CORRELATED / UNKNOWN / DIVERGENT，並即時計算 Action Authority。

## Code / GitHub
值得繼續讀：
- Chromium `ui/gl/android/android_surface_control_compat.{h,cc}`：SurfaceControl/Transaction compatibility layer；核心 primitive 包含 apply、completion callback、buffer、geometry、z-order、visibility。
- Chromium `media/capture/content/android/screen_capture_machine_android.cc`：Android captured RGBA frame 與 capture timestamp 進入 Chromium 的位置。
- 下一輪：Chromium Android overlay processor / SkiaOutputDeviceSurfaceControl 與 Windows DComp output-device/overlay processor，找 `frame_token/swap_trace_id → platform transaction/content` 的最近 causal edge。

## Papers
### StateAct: Program State, before Pixels, for Long-Horizon Computer-Use Agents
Authors: Yan Yang et al. Institution: Stanford/NVIDIA-associated author group（依作者 affiliations 需下一輪逐欄核對）. Year: 2026. URL: https://arxiv.org/abs/2607.22798 . Dataset/Benchmark: OSWorld 2.0. Architecture: code-first main agent + GUI subagent + independent finish gate. Contribution: 將 grounding/verification/memory 轉向 program state；108 tasks 中 GUI subagent 僅用於 28 tasks，main-agent steps 約 1.1%。Limitations: direct state access 並非所有真實應用可取得；code-only 仍低於 hybrid。

### GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents
Authors: Chen Chen et al. Year: 2026. URL: https://arxiv.org/abs/2601.09770 . Benchmark: ScreenSpot-Pro. Architecture: two-stage active perception + crop/zoom visual tools + RL. Contribution: 3B model以約3k labeled samples達44.8% grounding accuracy。Limitations: active visual perception改善 grounding，但沒有解決 capture provenance / user-visible equivalence。

### SecAgent: Efficient Mobile GUI Agent with Semantic Context
Authors: Yiping Xie et al. Year: 2026. URL: https://arxiv.org/abs/2603.08533 . Dataset: 18k grounding samples + 121k navigation steps across 44 apps. Architecture: 3B mobile GUI agent + semantic-context history compression + SFT/RL. Contribution: 壓縮 screenshot/action history 成 task-relevant semantic context。Limitations: context compression可能丟失 provenance/time-sensitive visual evidence，值得 Hermes 後續研究。

## Unknown / Open Questions
1. Android SurfaceControl transaction completion 是否能可靠綁定到特定 displayed buffer/present fence，並再綁回 Chromium frame_token？
2. Windows Chromium DComp path 中哪個 object/commit/fence identity 最接近 `swap_trace_id → DWM presented content` 的 causal witness？
3. OS capture 是否有可取得的 buffer/frame identity，可避免只靠 timestamp correlation？

## 下一輪研究
深入 `SkiaOutputDeviceSurfaceControl / OverlayProcessorSurfaceControl / DCompPresenter / DCLayerOverlay / OutputSurface`，建立 `ChromiumFrameToPlatformBufferEdge`；優先找 Android transaction stats/present fences 與 Windows DComp/DWM present statistics。若仍無公開 causal identity，明確保持 UNKNOWN，而不虛構跨層 frame ID。

## Knowledge Graph 新增 Node / Edge
Nodes: `PlatformCommitWitness`, `SurfaceControlTransaction`, `SurfaceControlBufferBinding`, `AndroidTransactionCompletion`, `DirectCompositionVisual`, `DWMCompositionBoundary`, `PlatformCommitCorrelation`, `CaptureClockDomain`, `PlatformBufferIdentity`, `ActionAuthorityFromEvidence`.

Edges: `CompositorFrame --SCHEDULED_AS--> PlatformBuffer`; `PlatformBuffer --BOUND_TO--> SurfaceControlTransaction`; `SurfaceControlTransaction --APPLIED_TO--> AndroidCompositor`; `DirectCompositionVisual --COMPOSED_BY--> DWM`; `CaptureWitness --CORRELATED_WITH--> PlatformCommitWitness`; `ObservationProof --AUTHORIZES--> ComputerAction`.

## 本輪結束診斷
- 缺哪一層：`Chromium frame_token/swap_trace_id → concrete platform buffer/transaction → OS present → capture buffer` causal chain。
- 哪個節點最淺：`PlatformBufferIdentity`。
- 哪個概念仍只是名詞：跨平台 `CapturedPlatformCommit(commit_id)`。
- 哪個系統值得讀原始碼：Chromium Android SurfaceControl output-device + Windows DComp presenter/overlay path。
- 哪篇論文需追引用：StateAct，特別是 state-grounding、finish gate 與 OSWorld 2.0 後續工作。
- 哪個概念最適合視覺模擬：Platform Commit ↔ Capture Correlation Lab。
- 哪個 Agent 架構最值得實作：`State-grounded planner + active visual subagent + provenance-aware observation gate + independent postcondition verifier`。

最終鏈條本輪補成：
`使用者一句話 → UI → Agent → Context → Reasoning → Planning → Memory → Tool/Computer intent → semantic target → observation proof requirement → Browser state → Blink → CompositorFrame → Viz → OS platform transaction/composition → capture boundary → pixels → vision encoder → multimodal tokens → action gate → external action → postcondition verification → output`。
