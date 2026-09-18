# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 19:52（Asia/Taipei）

主題：Display Deadline → VSyncId → OutputSurfaceFrame × Aggregate-vs-Source Frame Identity

> 證據標籤：**[官方]** Android/AOSP/Chromium 官方文件或原始碼；**[論文]** 論文結果；**[工程]** 原始碼可直接確認；**[推論]** 多個 primitive 組成但尚無單一 API 完整證明；**[假說]** 待驗證。

## 本小時新發現

本輪接續上一輪 `CompositorFrame.frame_token → choreographer_vsync_id` 缺口，追到一條新的 Chromium 內部 causal spine。核心修正是：Android `choreographer_vsync_id` 並不是從某個 renderer `CompositorFrame.frame_token` 直接產生；它在 Viz `DisplayScheduler` 選擇 display deadline 時進入 `DrawAndSwapParams`，再由 `Display::DrawAndSwap()` 寫入 `SwapFrameData`，進而進入 `OutputSurfaceFrame`，最後在 GPU process 的 `SkiaOutputSurfaceImplOnGpu::SwapBuffersInternal()` 傳給 Presenter，再由 `GLSurfaceEGLSurfaceControl` 寫入 SurfaceControl transaction。

因此新的已確認鏈是：

```text
Android / BeginFrame deadline candidates
→ DisplayScheduler selected_deadline.vsync_id
→ DrawAndSwapParams.choreographer_vsync_id
→ Display::DrawAndSwap
→ DirectRenderer::SwapFrameData.choreographer_vsync_id
→ OutputSurfaceFrame.choreographer_vsync_id
→ SkiaOutputSurfaceImplOnGpu
→ Presenter::SetChoreographerVsyncIdForNextFrame
→ GLSurfaceEGLSurfaceControl
→ SurfaceControl Transaction::SetFrameTimelineId
→ ASurfaceTransaction_setFrameTimeline
→ SurfaceFlinger
→ present fence
```

這條鏈比上一輪更強，但也揭露新的 identity boundary：`VSyncId` 是 **display aggregate / presentation target identity**，而 renderer `frame_token` 是 **source CompositorFrame identity**。一個 display aggregation 可包含多個 Surface/CompositorFrame，因此不能宣稱 `frame_token == VSyncId`。

## 本小時最重要 5 個發現

### 1. `choreographer_vsync_id` 的 producer 已追到 `DisplayScheduler` deadline selection

**[工程]** Chromium `DisplayScheduler` 在 deadline selection 後把 `selected_deadline.vsync_id` 寫入 `params.choreographer_vsync_id`，然後呼叫 `client_->DrawAndSwap(params)`。

```text
Frame deadline candidates
→ choose selected_deadline
→ selected_deadline.vsync_id
→ DrawAndSwapParams
→ DrawAndSwap
```

重要性：上一輪只知道 Presenter 接到 VSyncId；本輪已把 identity 往上游追到 Viz scheduler。

限制：這仍不是 renderer `CompositorFrame.frame_token` 的 producer。

來源：Chromium `components/viz/service/display/display_scheduler.cc`、`display_scheduler_base.h`。

### 2. `Display::DrawAndSwap()` 把同一 VSyncId 與 display trace / aggregation 一起送往 swap

**[工程]** `Display::DrawAndSwap()` 用 `params.choreographer_vsync_id` 建立 `PresentationGroupTiming`，同時產生 `display_trace_id`；之後建立 `DirectRenderer::SwapFrameData`，保存 `choreographer_vsync_id` 與 `swap_trace_id=display_trace_id`。

```text
DrawAndSwapParams
├─ choreographer_vsync_id
├─ BeginFrame frame_time
└─ selected_deadline
      ↓
Display aggregation
      ↓
SwapFrameData
├─ choreographer_vsync_id
└─ swap_trace_id
```

重要性：Hermes 現在可以把 `VSyncId` 與 Chromium display aggregation / swap trace 放在同一 witness，而不是只做 timestamp correlation。

限制：display aggregation 可能包含 root + OOPIF + overlay 等多個 source surfaces。

來源：Chromium `components/viz/service/display/display.cc`。

### 3. VSyncId 會穿過 `OutputSurfaceFrame` 到 Android Presenter

**[工程]** `SkiaOutputSurfaceImplOnGpu::SwapBuffersInternal(frame)` 直接呼叫 `presenter_->SetChoreographerVsyncIdForNextFrame(frame->choreographer_vsync_id)`；Presenter 介面也明確註記這是 corresponding Choreographer frame 的 vsync id。SurfaceControl backend 隨後將它存入 next-frame transaction 並呼叫 `SetFrameTimelineId`。

```text
OutputSurfaceFrame
→ GPU process
→ SkiaOutputSurfaceImplOnGpu
→ Presenter
→ GLSurfaceEGLSurfaceControl
→ SurfaceControl transaction
```

重要性：這建立了跨 Viz → GPU → platform presenter 的直接欄位傳遞鏈。

限制：若 draw render pass 失敗，current Chromium code 會 skip present，因此 witness 必須能表示 `DRAW_FAILED / NOT_SUBMITTED`。

來源：Chromium `skia_output_surface_impl_on_gpu.cc`、`presenter.h`、`gl_surface_egl_surface_control.cc`。

### 4. 必須正式拆開 Source Frame Identity 與 Display Aggregate Identity

**[推論，建立在上述原始碼]** Renderer `CompositorFrame.frame_token` 不應硬綁成 Android VSyncId。Viz Display 每次 draw 會 aggregate 多個 surfaces；因此更正確的模型是：

```text
Source CompositorFrame F471 ─┐
Child CompositorFrame  C88 ──┼→ DisplayAggregation A31
Overlay Resource       O12 ──┘       │
                                     ├→ swap_trace_id S82
                                     └→ VSyncId V9002
```

因此需要新的 edge：

```text
SourceFrame --CONTRIBUTED_TO--> DisplayAggregation
DisplayAggregation --TARGETED_AT--> VSyncId
```

而不是不存在的：

```text
SourceFrame --EQUALS--> VSyncId
```

這是本輪最重要的知識圖譜修正。

### 5. Android `JankData.vsyncId` 可成為 display-side verification join key，但仍不是 source-frame key

**[官方]** Android `SurfaceControl.JankData` 提供 `getVsyncId()`，可與 `FrameMetrics.FRAME_TIMELINE_VSYNC_ID` / Choreographer FrameTimeline / Transaction.setFrameTimeline 關聯；新版 API 的 `getPresentTimeNanos()` 還能區分 actual-present、not-presented (`UNSET`) 與 unknown presentation。

這意味：

```text
DisplayAggregation
→ VSyncId
→ SurfaceControl FrameTimeline
→ JankData
→ actual / unset / unknown present time
```

可形成 display-side causal/verification spine。

限制：它仍不告訴我們 aggregation 中每個 child source frame 的 freshness。

來源：https://developer.android.com/reference/android/view/SurfaceControl.JankData

## Architecture Breakdown

### Aggregate-to-Presentation Architecture

```text
Renderer processes
  F471      C88       C104
    \        |        /
     \       |       /
      → SurfaceAggregator
              ↓
       DisplayAggregation A31
       ├─ contained surfaces
       ├─ frame indices
       ├─ render passes
       └─ overlays
              ↓
       DisplayScheduler
       └─ selected deadline V9002
              ↓
       Display::DrawAndSwap
       ├─ swap_trace_id S82
       └─ choreographer_vsync_id V9002
              ↓
       OutputSurfaceFrame
              ↓
       SkiaOutputSurfaceImplOnGpu
              ↓
       Presenter
              ↓
       SurfaceControl TX91
       └─ FrameTimeline V9002
              ↓
       SurfaceFlinger / HWC
              ↓
       Present fence
```

Hermes 應將 presentation proof 掛在 `DisplayAggregation`，再由 `CONTRIBUTED_TO` edge 回溯各 source frame。

### 建議 witness

```ts
type DisplayAggregationPresentationWitness = {
  aggregationId: string
  sourceFrames: Array<{
    surfaceId: string
    frameToken?: number
    frameIndex?: number
    selection: 'PRIMARY' | 'FALLBACK' | 'LOCAL' | 'UNKNOWN'
  }>
  beginFrameId?: string
  selectedDeadlineVsyncId?: bigint
  swapTraceId?: bigint
  outputSurfaceSequence?: number
  platformTransactionId?: string
  presentFenceSignalTime?: number
  actualPresentTime?: number
  status:
    | 'TARGET_SELECTED'
    | 'SUBMITTED'
    | 'LATCHED'
    | 'FENCE_BACKED_PRESENTED'
    | 'NOT_PRESENTED'
    | 'DRAW_FAILED'
    | 'UNKNOWN'
}
```

## Bottom-Level Logic

### Deadline selection → platform frame timeline

Chromium 的 causal mechanism 現在可以拆成：

```text
BeginFrame
→ candidate deadlines
→ deadline feasibility / latch target
→ selected_deadline
→ selected_deadline.vsync_id
→ DrawAndSwapParams
→ Display aggregation
→ SwapFrameData
→ OutputSurfaceFrame
→ Presenter next-frame VSyncId
→ SurfaceControl transaction FrameTimeline
```

這不是單純把 timestamp 傳下去，而是把 scheduler 選中的 platform timeline identity 帶到 transaction。

### Source-to-aggregate proof

真正還缺的底層機制變成：

```text
CompositorFrame.frame_token
→ Surface active frame / frame_index
→ SurfaceAggregator contained surface
→ DisplayAggregation A
→ swap_trace_id / VSyncId
```

這比上一輪直接追 `frame_token → VSyncId` 更精確，因為一個 VSyncId 可對應一個 aggregate display update，而 aggregate update 有多個 source frames。

## Visual Simulation Idea

### Source Frames → Display Timeline Causal Graph

```text
SOURCE
F471 ─────┐
C88 ──────┼────► AGG A31 ──► SWAP S82 ──► VSYNC V9002 ──► TX91 ──► FENCE
C104 ─────┘          │
                     ├─ child B = fallback
                     └─ overlay O12

CAPTURE C22 ─────────────────────────────────────────────────────► OBS O118
```

互動操作：切換 child frame fallback/latest、draw failure、deadline miss、frame replaced、overlay promotion、present-fence unavailable、capture-before/after-present。點擊任一 source frame時，高亮它經由 aggregation 到 platform presentation 的 causal path；若 edge 缺證據則顯示 `UNKNOWN`。

這個模擬比單純 FrameTimeline timeline 更能回答：「Agent 看到的某個 UI 區域，是哪個 source frame 參與哪次 display aggregation 後才被呈現？」

## Code / GitHub

本輪值得看的 Chromium 核心檔案：

1. `components/viz/service/display/display_scheduler.cc` — `selected_deadline.vsync_id → DrawAndSwapParams.choreographer_vsync_id`。
2. `components/viz/service/display/display_scheduler_base.h` — `DrawAndSwapParams` 的 `choreographer_vsync_id` 欄位。
3. `components/viz/service/display/display.cc` — aggregation、PresentationGroupTiming、`SwapFrameData.choreographer_vsync_id`、`swap_trace_id`。
4. `components/viz/service/display/direct_renderer.h` — `SwapFrameData` schema。
5. `components/viz/service/display_embedder/skia_output_surface_impl_on_gpu.cc` — `OutputSurfaceFrame → Presenter::SetChoreographerVsyncIdForNextFrame`。
6. `ui/gl/presenter.h` — Android VSyncId presenter contract。
7. `ui/gl/gl_surface_egl_surface_control.cc/.h` — next-frame VSyncId → SurfaceControl transaction、pending resources、present callbacks。

## Papers

### Efficient GUI Agents: A Systems Survey of Observation, Memory, Action, and Runtime Optimization
- Authors: Bizhe Bai, Jiakang Yuan, Hongming Wu, Xinyue Wang, Jie Ren, Siyao Chen, Yuchen Ya, Fan Bai, Pai Peng, Huafeng Qin, Tao Chen
- Year: 2026
- URL: https://arxiv.org/abs/2609.02309
- Architecture: systems survey across observation/context-memory/action/planner-runtime efficiency
- Contribution: recent GUI-agent work converges on selective observation、global-to-local visual allocation、recoverable memory、verification-aware control、hybrid GUI/non-GUI runtimes
- Limitations: survey，不提供 compositor-level causal provenance implementation
- 改變了什麼：支持 Hermes 將 observation provenance / verifier cost 當 runtime architecture 的一級公民，而不是附加 debug feature。

### WeaveBench: A Long-Horizon, Real-World Benchmark for Computer-Use Agents with Hybrid Interfaces
- Authors: Wanli Li, Bowen Zhou, Yunyao Yu, Zhou Xu, Yifan Yang, Dongsheng Li, Caihua Shan
- Year: 2026
- URL: https://arxiv.org/abs/2606.09426
- Dataset: 114 tasks / 8 real-world domains
- Architecture: GUI + CLI/code hybrid trajectories + trajectory-aware judge
- Contribution: best PassRate 41.2%；outcome-only grading overestimates performance
- Limitation: 不提供 OS compositor provenance
- 本輪意義：支持保存 trajectory/evidence chain，而非只看最後畫面。

## Unknown / Open Questions

1. `SurfaceAggregator` 是否能以低成本輸出每次 `DisplayAggregation` 的 `(SurfaceId, frame_index, frame_token?)` 完整 source set，建立 `SourceFrame → DisplayAggregation` causal edge？
2. `OutputSurfaceFrame` / swap completion / PresentationGroupTiming 能否保存 stable `aggregationId`，避免只靠 deque order 對應 presentation callback？
3. Android capture/JankData 能否把同一 `VSyncId` 帶到 captured buffer 或 observation metadata，建立 `PresentedAggregation → Capture` 的硬 join？

## 下一輪研究

下一輪不再追不存在的一對一 `frame_token == VSyncId`。直接深入：

```text
Surface::PresentationHelper
SurfaceAggregator::previous_contained_surfaces
ContainedSurface frame_index
CompositorFrame.frame_token
Display::PresentationGroupTiming
FrameTimingDetails
```

目標建立：

```text
Source CompositorFrame
→ DisplayAggregation
→ swap_trace_id
→ VSyncId
→ present fence
```

並確認 child/OOPIF fallback frame 能否保留自己的 frame token / frame index 到 presentation notification。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `DisplayAggregationIdentity`
- `DisplayDeadlineSelection`
- `SelectedDeadlineVSyncId`
- `OutputSurfaceFrameWitness`
- `AggregatePresentationWitness`
- `SourceFrameContributionSet`
- `SourceVsAggregateIdentityBoundary`
- `DrawFailedPresentationGap`

### Edges
```text
DisplayDeadline --SELECTS--> VSyncId
VSyncId --COPIED_INTO--> DrawAndSwapParams
DrawAndSwapParams --DRIVES--> DisplayAggregation
DisplayAggregation --SWAPPED_AS--> OutputSurfaceFrame
OutputSurfaceFrame --CARRIES--> VSyncId
OutputSurfaceFrame --PRESENTED_BY--> AndroidPresenter
SourceFrame --CONTRIBUTED_TO--> DisplayAggregation
DisplayAggregation --TARGETED_AT--> VSyncId
VSyncId --VERIFIED_BY--> JankData / PresentFence
```

## 本輪結束判斷

- **缺哪一層：** `Source CompositorFrame → exact DisplayAggregation contribution set`，以及 `PresentedAggregation → captured buffer`。
- **哪個節點最淺：** `SourceFrameContributionSet`。
- **哪個概念仍只是名詞：** `PresentedAggregationToCaptureEdge`。
- **哪個系統值得讀原始碼：** Chromium `SurfaceAggregator + Surface::PresentationHelper + Display::PresentationGroupTiming`。
- **哪篇論文需追引用：** `Efficient GUI Agents`，優先追 verification-aware control、selective observation、runtime overhead 的引用圖。
- **哪個概念最適合視覺模擬：** `Source Frames → Display Timeline Causal Graph`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Active Observation Subagent + Aggregate Presentation Evidence DAG + Pre-action Freshness Gate + Independent Transition Verifier`。

## 與歷史研究比較

上一輪把 `VSyncId` 定位為 Android presentation target identity，但仍把主要缺口描述為 `frame_token → VSyncId`。本輪修正為更符合 Chromium architecture 的多對一關係：**多個 source CompositorFrames 經 Surface aggregation 形成一次 DisplayAggregation；VSyncId 是該 aggregate display update 的 deadline/presentation identity。** 因此真正應補的是 `SourceFrameContributionSet`，而不是尋找不存在的一對一 global frame ID。

這使 Hermes 的最終鏈更精確：

```text
User intent
→ Agent runtime
→ semantic target
→ source UI frames
→ Surface aggregation
→ DisplayAggregation
→ selected VSyncId
→ OutputSurfaceFrame
→ SurfaceControl transaction
→ present fence
→ capture
→ pixels
→ vision encoder
→ multimodal tokens
→ reasoning
→ action gate
→ action
→ transition verifier
```

核心結論：**AI 的一張 screenshot 背後不是「一個 frame」，而是一次 display aggregation 對多個 source frame 的合成結果。要回答 AI 到底看到了什麼，Hermes 必須保存 source-frame contribution set，再把 aggregate presentation identity 往 platform present/capture 接下去。**