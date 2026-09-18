# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-18 09:50 Asia/Taipei

## 本小時新發現

本輪承接上一輪 `Rendered Frame Witness × Viz Surface Identity × Presentation Proof`，不重複「frame_token 能對應 presentation feedback」的結論，而是追下一個缺口：**在不修改 Chromium 的前提下，能否把 Blink/main-thread activity、LocalSurfaceId、CompositorFrame、Viz presentation 與 screenshot/copy-output 串成一條可追蹤 witness chain？**

本輪結論是：Chromium 已存在一組可利用的 tracing/copy-output primitives，足以建立比單純 CDP timestamp 更強的 **Trace-Correlated Render Witness**；但目前公開證據仍不足以把一般 `Page.captureScreenshot` 的 byte result 直接證明為某個 `frame_token` 的 exact pixels。最值得利用的 primitives 是：

1. `BeginFrameArgs.trace_id`：由 service 設定，可供 client/service trace events 使用。
2. `LocalSurfaceId.submission_trace_id()`：Chromium 在 renderer/client 與 Viz/service 間用 Perfetto flow 串接 surface submission。
3. `CompositorFrameMetadata.frame_token`：presentation feedback 的 per-frame identity。
4. `FrameTimingDetails`：把 frame submission/embedding/draw/swap/presentation 等時間集中到同一 frame token。
5. Viz `CopyOutputRequest`：能對指定 `LocalSurfaceId` / exact Surface 做 output copy，且 Chromium 對 same-document navigation screenshot 已有 destination-token 與 exact-surface capture 路徑。

因此 Hermes 下一階段不應追求不存在的 universal atomic revision，而應建立兩層 witness：

`TraceCorrelatedRenderWitness`：證明 lifecycle / surface submission / compositor frame / presentation 之間的 trace correlation。

`ExactSurfaceCaptureWitness`：當 capture 路徑可指定 exact SurfaceId/LocalSurfaceId 時，再把 pixel capture 綁到指定 rendered surface。

一般 CDP screenshot 若沒有 exact-surface/frame binding，仍只能是 `BOUNDED_STRONG`，不能升級成 `FRAME_EXACT`。

---

## 本小時最重要 5 個發現

### 1. LocalSurfaceId 已經內建跨 process tracing identity

**已確認／Chromium 原始碼。** `AsyncLayerTreeFrameSink` 在提交 CompositorFrame 時，使用 `LocalSurfaceId.Submission.Flow` trace event，並把 `local_surface_id_.submission_trace_id()` 同時作為 process-scoped terminating flow 與 global outgoing flow；`LayerTreeHost` 收到 parent LocalSurfaceId 時也用相同 submission trace id 建立跨 process flow。

底層：

`Parent allocates LocalSurfaceId → SetLocalSurfaceIdFromParent(trace flow) → commit state → LayerTreeHostImpl → AsyncLayerTreeFrameSink::SubmitCompositorFrame → global Perfetto flow → Viz`

這表示 `LocalSurfaceId` 不只是 surface identity；它還提供了一個原生 trace correlation hook。Hermes 可把它保存為：

```text
SurfaceSubmissionWitness {
  frameSinkId
  localSurfaceId
  submissionTraceId
  rendererProcess
  vizProcess
}
```

**為什麼重要：** 上一輪 `RenderedFrameWitness` 的 SurfaceId 與 frame token 還像兩個孤立 ID；submission trace flow 提供了「這個 surface identity 如何跨 renderer → Viz 被提交」的可觀測鏈。

**限制：** submission trace id 綁的是 surface submission flow，不等於 screenshot byte identity，也不等於 DOM revision。

### 2. BeginFrame trace_id 與 frame_token 是不同層級 identity，不能混為一談

**已確認／Chromium 原始碼。** `BeginFrameArgs.trace_id` 是 service 設定、用於 client/service trace events 的 BeginFrame correlation；`CompositorFrameMetadata.frame_token` 則用於辨識提交 frame 與 presentation feedback。Chromium metrics code甚至明確選擇 frame token 而非 BeginFrameId 追蹤某些 dropped/presented frame metrics，因為 frame drop 與 long-running main-frame 會讓兩者不是一對一。

所以 Hermes Knowledge Graph 應明確拆成：

```text
BeginFrameTraceId
   ↓ schedules / drives
MainFrame / ImplFrame
   ↓ may produce / may drop
CompositorFrameToken
   ↓ submitted
Surface
   ↓ presented
PresentationFeedback
```

而不是：

```text
BeginFrameId == PresentedFrameId
```

**為什麼重要：** 這避免把 scheduler tick 當成 rendered frame identity，也能正確表示 skipped frame、dropped frame、compositor-only frame。

**限制：** 還需要 tracing parser 才能把多種 flow/event 對齊成單一 runtime witness。

### 3. FrameTimingDetails 已接近「presentation proof record」

**已確認／Chromium 原始碼。** `CompositorFrameSinkSupport::DidPresentCompositorFrame(frame_token, ...)` 以 frame token 找到 pending frame，建立 `FrameTimingDetails`；目前 master 會保存 received compositor frame timestamp、embedded frame timestamp、draw start、swap timings、presentation feedback、frame id，以及 Viz display-tree/draw/submit 相關 timing。Chromium 還檢查每個 frame token 只應有一份 presentation feedback。

可抽象為：

```text
FrameTimingWitness {
  frameToken
  frameSubmitTime
  frameEmbedTime
  drawStart
  swapTimings
  presentationFeedback
  beginFrameId
  vizPipelineStages
}
```

**為什麼重要：** Hermes 可以把「presented」從 boolean 升級成一份包含 pipeline timing 的 evidence object，並區分 submitted、embedded、drawn、swapped、presented、failed。

**限制：** `FrameTimingDetails` 是 Chromium internal data path；一般 CDP consumer 不保證直接取得全部欄位。

### 4. Chromium 已存在 exact-surface CopyOutput 路徑，這比普通 screenshot API 更接近 pixel binding

**已確認／Chromium 原始碼。** Viz `CompositorFrameSinkSupport` 的 pending copy-output request 可以帶 `LocalSurfaceId`，並有 `capture_exact_surface_id` 行為；若 embedding token 改變，舊 capture 可被拒絕。`HostFrameSinkManager::RequestCopyOfOutput(const SurfaceId&, ..., bool capture_exact_surface_id)` 也明確支援對 exact SurfaceId 取 snapshot，註解指出這可用來取得 navigation 後仍保留的舊 Surface。Chromium same-document navigation screenshot 路徑還使用 destination token 把 CopyOutputResult 回送 browser process。

這使 Hermes 可以定義新的 proof ladder：

```text
P0 ScreenshotTimestamp
P1 ObservationEpochBound
P2 TraceCorrelatedSurface
P3 PresentedFrameCorrelated
P4 ExactSurfaceCopyOutput
P5 ExactFramePixelBinding   ← 尚未證明通用可得
```

**為什麼重要：** `CopyOutputRequest(exact SurfaceId)` 是目前找到最接近「這些 pixels 確實來自這個 surface identity」的 browser-native primitive。

**限制：** exact Surface capture 仍不自動等於特定 `frame_token`；Surface lifetime 中可提交多個 compositor frames。普通 `Page.captureScreenshot` 也沒有公開返回 SurfaceId/frame_token。

### 5. 最合理的 Hermes browser witness 是 evidence DAG，不是單一 revision number

**工程推論／由 Chromium primitives 交叉支持。** Chromium rendering 天生是多 scheduler、多 process、多 identity domain；硬造 `BrowserRevision=42` 會隱藏 dropped frames、compositor-only animation、OOPIF child surfaces 與 asynchronous presentation。

因此本輪把 architecture 收斂為：

```text
Document / Frame Identity
        ↓
Blink Lifecycle Observation
        ↓
BeginFrameTraceId
        ↓
Commit
        ↓
LocalSurfaceId + submissionTraceId
        ↓
CompositorFrameToken
        ↓
FrameTimingDetails
        ↓
PresentationFeedback
        ↓
ExactSurface CopyOutput (when available)
        ↓
PixelDigest
```

每條 edge 保存 `PROVEN / TRACE_CORRELATED / TIME_BOUNDED / UNKNOWN`，而不是把整條鏈壓成一個假的 atomic revision。

**限制：** DOM/AX snapshot 到 BeginFrame/commit 的 deterministic causal binding，以及 exact Surface 到 exact frame pixels 的 binding，仍未完全解決。

---

## Architecture Breakdown

### System Architecture：Trace-Correlated Browser Observation Runtime

```text
User Task
  ↓
Hermes Browser Runtime
  ├─ CDP Observation Plane
  │   ├─ Frame/Loader identity
  │   ├─ DOMSnapshot
  │   ├─ Accessibility Tree
  │   └─ Screenshot
  │
  ├─ Trace Plane
  │   ├─ Blink/devtools.timeline
  │   ├─ BeginFrame trace_id
  │   ├─ viz.surface_id_flow
  │   ├─ LocalSurfaceId submissionTraceId
  │   └─ graphics.pipeline
  │
  ├─ Viz Evidence Plane
  │   ├─ SurfaceId
  │   ├─ CompositorFrame frame_token
  │   ├─ FrameTimingDetails
  │   └─ PresentationFeedback
  │
  └─ Capture Plane
      ├─ ordinary screenshot
      └─ exact-surface CopyOutput when available

             ↓
     Evidence DAG Builder
             ↓
     Correspondence Strength
             ↓
     Action Freshness Gate
             ↓
       Execute / Recapture / Block
```

### Runtime state machine

```text
OBSERVING
→ TRACE_ARMED
→ STRUCTURE_CAPTURED
→ SURFACE_CORRELATED
→ FRAME_SUBMITTED
→ PRESENTATION_CONFIRMED
→ PIXEL_CAPTURED
→ PROOF_EVALUATED

Failure branches:
NAVIGATION → INVALIDATE
EMBED_TOKEN_CHANGED → INVALIDATE
FRAME_DROPPED → NO_PRESENTATION
TRACE_GAP → UNKNOWN
SURFACE_ONLY_CAPTURE → SURFACE_BOUND
NO_NATIVE_BINDING → BOUNDED_STRONG
```

---

## Bottom-Level Logic

### Mechanism：Surface submission flow → frame presentation → copy output

1. Browser/renderer obtains or updates `LocalSurfaceId`.
2. `LayerTreeHost` places the parent-provided LocalSurfaceId into pending commit state.
3. Chromium emits `LocalSurfaceId.Submission.Flow` using `submission_trace_id()` across process boundaries.
4. `LayerTreeHostImpl` produces a `CompositorFrame` and assigns frame metadata including frame token / BeginFrame acknowledgement.
5. `AsyncLayerTreeFrameSink` submits the frame to Viz and continues the global trace flow.
6. Viz activates/embeds the relevant Surface.
7. Display pipeline draws/swaps the frame.
8. `OnSurfacePresented(frame_token, ...)` resolves presentation back to the frame token.
9. `FrameTimingDetails` records received/embed/draw/swap/presentation evidence.
10. If a capture path requests exact output, `CopyOutputRequest` can target a LocalSurfaceId/SurfaceId and reject incompatible embedding changes.
11. Pixel result is hashed and stored as `PixelDigest`.
12. Hermes builds edges between these artifacts and assigns proof strength.

### Critical invariant

```text
Presented(frameToken = F)
AND
Captured(surfaceId = S)
```

仍不自動推出：

```text
CapturedPixels == ExactPixelsOf(frameToken F)
```

除非另外有 `F → S active frame → CopyOutput` 的 exact binding witness。

### OOPIF extension

對含 cross-origin iframe 的頁面，應保存：

```text
RootPresentedFrame
  ↓ aggregates
PresentedSurfaceSet {
  RootSurface
  ChildSurface A
  ChildSurface B
  ...
}
```

每個 child surface 都應有自己的 LocalSurfaceId/submission trace/presentation freshness；root presentation 不能替 stale child 自動背書。

---

## Visual Simulation Idea

### Trace-to-Pixels Witness Explorer

Hermes Console 建立一個可拖曳時間軸的 browser rendering microscope：

```text
BLINK      DOM D41 ─ layout ─ paint ─ D42
BEGIN      BF901 ───────────── BF902
COMMIT          C17 ───────── C18
SURFACE         S7(trace 88) ========
FRAME              F471 ─ F472 ─ F473
VIZ                  embed   draw swap
PRESENT                    ✓472     ✕473
COPY                         [S7 exact]
PIXELS                         hash:P88
```

互動控制：
- 開/關 `viz.surface_id_flow`
- 注入 dropped frame
- compositor-only animation
- OOPIF child surface update
- navigation / embed token change
- exact-surface capture vs ordinary screenshot
- delayed presentation feedback
- trace event loss

畫面即時顯示：
- Document/Frame identity
- BeginFrame trace id
- LocalSurfaceId
- submissionTraceId
- frame token
- presentation status
- capture target surface
- PresentedSurfaceSet
- PixelDigest
- Correspondence Strength
- Required Proof Strength
- Action Gate verdict

教育目標：讓使用者直接看到「模型看到一張 screenshot」背後其實經過多個 asynchronous identity domains，而不是單一畫面 revision。

---

## Code / GitHub / Source Tree

### Chromium 值得繼續追的核心檔案

1. `cc/mojo_embedder/async_layer_tree_frame_sink.cc`
   - `SubmitCompositorFrame`
   - `LocalSurfaceId.Submission.Flow`
   - `submission_trace_id()`
   - graphics pipeline flow

2. `cc/trees/layer_tree_host.cc`
   - `SetLocalSurfaceIdFromParent`
   - pending commit state
   - surface-id trace propagation

3. `components/viz/service/frame_sinks/compositor_frame_sink_support.cc`
   - `SubmitCompositorFrame`
   - `OnSurfacePresented`
   - `DidPresentCompositorFrame`
   - `FrameTimingDetails`
   - `RequestCopyOfOutput`
   - exact LocalSurfaceId handling

4. `components/viz/common/quads/compositor_frame_metadata.h`
   - `frame_token`
   - `begin_frame_ack`
   - activation dependencies

5. `components/viz/common/frame_sinks/begin_frame_args.h`
   - `trace_id`
   - BeginFrame identity semantics

6. `components/viz/host/host_frame_sink_manager.h`
   - `RequestCopyOfOutput(SurfaceId, ..., capture_exact_surface_id)`
   - screenshot destination callbacks

7. `cc/metrics/compositor_frame_reporting_controller.h`
   - dropped/presented frame accounting
   - why frame_token is used instead of BeginFrameId in some metrics

### Hermes 建議新增模組

```text
src/research/browser-witness/
  trace-event-adapter.ts
  surface-flow-correlator.ts
  frame-presentation-correlator.ts
  copy-output-witness.ts
  presented-surface-set.ts
  browser-evidence-dag.ts
  proof-strength.ts
```

資料型別：

```text
TraceCorrelatedRenderWitness
SurfaceSubmissionWitness
FrameTimingWitness
ExactSurfaceCaptureWitness
PresentedSurfaceSet
PixelDigest
BrowserEvidenceEdge
BrowserProofStrength
```

---

## Papers

### Conditional Multi-Event Temporal Grounding in Long-Form Video
- Authors: Yuanhao Zou et al.
- Year: 2026
- Dataset: CoMET-Bench，2,789 queries / 600 long-form videos，平均 33.8 分鐘
- Architecture: CoMET-Agent，training-free structured search-and-aggregate
- Contribution: 把長影片 grounding 從單一 moment 擴展到多事件、條件式 temporal/spatial grounding；agentic structured search 相對 GPT-5 提升 F1@0.5 6.1%。
- Limitations: entity tracking、position-uniform retrieval、causal event pairing 仍是主要缺口。
- 與本輪關係：支持 Hermes 將 video observation 也建模成 temporal evidence graph，而非單 frame embedding。

### OmniGUI: Benchmarking GUI Agents in Omni-Modal Smartphone Environments
- Authors: Felix Henry et al.
- Year: 2026
- Dataset: 709 episodes / 2,579 action steps / 29 apps
- Architecture: continuous interleaved image + synchronous audio + video observations
- Contribution: 顯示 GUI action 在需要同步 temporal/audio evidence 時顯著退化，並揭示 cross-modal interference。
- Limitations: omni-modal agent framework 尚早期，基線主要以 foundation omni-modal models 代理。
- 與本輪關係：RenderedFrameWitness 不能只服務 browser pixels；未來 Camera/Audio/Video 也需要 presentation/event-time witness 與 cross-modal capture bounds。

---

## Unknown / Open Questions

### 1. ExactFramePixelBinding
能否在不 patch Chromium 的情況下，從 Perfetto + Viz tracing + CopyOutput 建立：

`frame_token F → active frame on Surface S → CopyOutput(S) → PixelDigest P`

而且排除同一 Surface 在 F 與 capture 之間又提交 F+1？目前仍未證明。

### 2. DOMCommitWitness
Blink DOM/layout/paint lifecycle 的 trace event 能否穩定對應到 compositor commit / BeginFrame / frame token，使：

`DOMSnapshot D → Commit C → Frame F`

從 `TIME_BOUNDED` 升級成 `TRACE_CORRELATED`？

### 3. PresentedSurfaceSet completeness
Viz aggregation 時能否取得「這個 root presented frame 實際採用了哪些 child SurfaceId / child frame」的完整集合，尤其 OOPIF、surface fallback、stale child reuse 與 surface activation dependency？

---

## 下一輪研究

下一輪鎖定 **Viz aggregation graph + child surface freshness**：

```text
Root CompositorFrame
→ SurfaceDrawQuad
→ child SurfaceId
→ activation dependency
→ fallback surface
→ aggregation
→ PresentedSurfaceSet
→ child freshness
→ root action proof
```

直接追：
- `components/viz/service/display/surface_aggregator.*`
- `components/viz/service/surfaces/surface.*`
- `SurfaceDrawQuad`
- surface activation dependencies / deadlines
- fallback surfaces
- OOPIF surface embedding
- copy-output aggregation semantics

並嘗試回答：**root frame 已 presented 時，如何知道某個 iframe region 顯示的是 child 最新 frame、舊 fallback surface，還是 unresolved/stale content？**

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `TraceCorrelatedRenderWitness`
- `SurfaceSubmissionWitness`
- `BeginFrameTraceId`
- `SubmissionTraceId`
- `FrameTimingWitness`
- `ExactSurfaceCaptureWitness`
- `ExactFramePixelBinding`
- `PixelDigest`
- `TraceGap`
- `BrowserEvidenceDAG`
- `PresentedSurfaceSetCompleteness`
- `DOMCommitWitness`

### Edges
- `BeginFrameTraceId → DRIVES → FramePipeline`
- `LocalSurfaceId → HAS_TRACE_ID → SubmissionTraceId`
- `SubmissionTraceId → CORRELATES → VizSurfaceSubmission`
- `CompositorFrameToken → RESOLVES_TO → PresentationFeedback`
- `FrameToken → HAS_TIMING → FrameTimingWitness`
- `SurfaceId → TARGET_OF → ExactSurfaceCaptureWitness`
- `ExactSurfaceCaptureWitness → PRODUCES → PixelDigest`
- `PresentedSurfaceSet → AGGREGATES → ChildSurface`
- `TraceGap → WEAKENS → CorrespondenceStrength`
- `ExactFramePixelBinding → WOULD_UPGRADE → BrowserProofStrength`

---

## 與歷史研究比較

上一輪回答「哪一個 compositor frame / surface 被呈現？」；本輪新增的是「**如何利用 Chromium tracing 把 surface submission、frame presentation 與 pixel capture 串起來**」。因此沒有重複 SurfaceId/frame_token 定義，而是新增 `submission_trace_id`、`BeginFrame trace_id`、`FrameTimingDetails`、exact-surface `CopyOutputRequest` 與 evidence DAG。

上一輪最淺節點是 `PresentedSurfaceSet`；本輪發現要解它之前，還必須先建立可操作的 trace/capture binding，否則 child surface freshness 只能靠 timestamp 猜測。

---

## 本輪結束判斷

- **缺哪一層：** Viz aggregation → child Surface/frame selection → PresentedSurfaceSet completeness。
- **哪個節點最淺：** `ExactFramePixelBinding`。
- **哪個概念仍只是名詞：** `DOMCommitWitness`；目前尚未證明 DOMSnapshot 能穩定 causal-bind 到特定 compositor commit/frame。
- **哪個系統值得讀原始碼：** Chromium `SurfaceAggregator` + `Surface` activation/fallback + CopyOutput path。
- **哪篇論文需追引用：** OmniGUI，因為它把 GUI observation freshness 從 pixels 擴展到 synchronous audio/video；CoMET-Bench 則值得追 temporal evidence/causal event pairing。
- **哪個概念最適合視覺模擬：** `Trace-to-Pixels Witness Explorer`。
- **哪個 Agent 架構最值得實作：** `Proof-Carrying Browser Agent`：每次 computer action 不只帶 target/action，也帶 supporting ObservationBundle、surface/frame witness、freshness/correspondence verdict；proof 不足時先 recapture/re-ground，而不是直接執行。

## 最終鏈條更新

```text
使用者說一句話
→ UI
→ Agent Runtime
→ Browser / Camera / Audio / Video Observation
→ Versioned Observation Bundle
→ Browser Evidence DAG
→ DOM / AX / Blink lifecycle
→ BeginFrame trace
→ Commit
→ LocalSurfaceId + submission trace
→ CompositorFrame token
→ Viz Surface / Aggregation
→ Presentation Feedback
→ Pixel Capture / Digest
→ Vision Tokens
→ Context
→ Model Reasoning
→ Planning
→ Memory
→ Action Freshness + Correspondence Gate
→ Tool / MCP / Computer Action
→ External Effect
→ Settlement Proof
→ Output
```

本輪核心結論：**Browser Agent 的「看見」可以比 screenshot timestamp 更可驗證。Chromium 已經提供 surface submission trace、frame token、presentation timing 與 exact-surface copy primitives；真正可靠的 Hermes 不應把它們壓成一個假的 global revision，而應保存成 evidence DAG。下一個關鍵不是再問 root frame 有沒有呈現，而是證明 root frame 實際聚合了哪些 child surfaces，以及 Agent 點擊的那個區域究竟來自哪個 fresh child frame。**