# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 20:52（Asia/Taipei）

主題：Source Frame PresentationHelper × PresentationGroupTiming × Source-to-Present Causal Binding

> 證據標籤：**[官方]** Chromium/AOSP 官方文件或原始碼；**[論文]** 論文結果；**[工程]** 原始碼可直接確認；**[推論]** 由多個已確認 primitive 組成、尚無單一 API 完整證明；**[假說]** 待驗證。

## 本小時新發現

本輪直接接續上一輪的最大缺口 `SourceFrameContributionSet → DisplayAggregation → Presentation`，並找到一條比「frame_token → VSyncId 一對一」更正確、也更強的 Chromium causal binding：**每個被本次 Display aggregation 使用的 Surface，可以交出一個攜帶該 Surface 當前 `frame_token` 的 `Surface::PresentationHelper`；Display 把這些 helpers 收進同一個 `PresentationGroupTiming`，而該 group 同時保存 `choreographer_vsync_id`、`swap_trace_id`、draw/swap timing；真正收到 presentation feedback 時，`OnPresent()` 會把同一份 feedback fan-out 回每個 helper，最後以原始 `frame_token` 呼叫 `SurfaceClient::OnSurfacePresented()`。**

這表示上一輪的 identity model 可以正式升級為：

```text
Source Surface frame_token F471 ─┐
Child Surface frame_token C88 ───┼─ PresentationHelpers
Child Surface frame_token C104 ──┘          │
                                            ▼
                                  PresentationGroupTiming G31
                                  ├─ swap_trace_id S82
                                  ├─ choreographer_vsync_id V9002
                                  ├─ draw_start
                                  └─ swap_timings
                                            │
                                            ▼
                                  platform presentation feedback
                                            │
                                            ▼
                                  OnPresent(feedback)
                                  ├─ DidPresent(F471)
                                  ├─ DidPresent(C88)
                                  └─ DidPresent(C104)
```

因此真正存在的不是：

```text
frame_token == VSyncId
```

而是：

```text
frame_token --MEMBER_OF_PRESENTATION_GROUP--> G31
G31 --TARGETED_AT--> VSyncId
G31 --SWAPPED_AS--> swap_trace_id
G31 --PRESENTED_WITH--> PresentationFeedback
PresentationFeedback --FANNED_OUT_TO--> frame_token
```

這是目前 Hermes Browser/Computer perception causal graph 中，第一次從 **source CompositorFrame identity** 接到 **display-level presentation feedback** 的明確 Chromium 原始碼鏈。

## 本小時最重要 5 個發現

### 1. `Surface::PresentationHelper` 本身保存 source `frame_token`

**[工程]** Chromium `components/viz/service/surfaces/surface.cc` 中，`Surface::PresentationHelper` 建構時保存 `frame_token_`。`DidPresent()` 被呼叫後，會把該 token 與 draw/swap/presentation feedback 交回 `surface_client_->OnSurfacePresented(...)`。

```text
Surface active frame
→ frame_token
→ PresentationHelper(frame_token)
→ DidPresent(feedback)
→ SurfaceClient::OnSurfacePresented(frame_token, ...)
```

重要性：這不是 timestamp correlation，而是 source frame identity 被物件直接攜帶到 presentation callback。

限制：helper 證明的是該 source frame 被納入某次 presentation notification group，不代表 source frame 的每一個 pixel 都對最終 target region 有視覺貢獻。

來源：
- https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/surfaces/surface.cc
- https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/surfaces/surface.h

### 2. Display 只從本次 aggregation 的 contained surfaces 收集 PresentationHelper

**[工程]** Chromium `Display::DrawAndSwap()` 在準備 swap 時遍歷 `aggregator_->previous_contained_surfaces()`，對每個仍存在的 Surface 呼叫 `TakePresentationHelperForPresentNotification()`，並把 helper 加進當次 `PresentationGroupTiming`。

```text
SurfaceAggregator
→ previous_contained_surfaces
→ each Surface
→ TakePresentationHelperForPresentNotification
→ PresentationGroupTiming::AddPresentationHelper
```

重要性：上一輪提出的 `SourceFrameContributionSet` 不再只是抽象概念。Chromium 本身已經有一個 presentation-notification membership mechanism，把 aggregation 所包含的 source surfaces 綁到 display presentation group。

限制：`contained surface` 仍不等於 `pixel contributor`。被包含的 Surface 可能只有部分區域可見，也可能受 clip/occlusion/filter/overlay 影響；因此 region-level proof 仍需接回先前建立的 `VisualContributionGraph`。

來源：
- https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/display/display.cc
- https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/display/surface_aggregator.h

### 3. `PresentationGroupTiming` 同時保存 source helpers 與 display identity spine

**[工程]** 最新 Chromium `Display::PresentationGroupTiming::OnDraw()` 保存 `frame_time`、`interval`、`draw_start_timestamp`、thread ids、`choreographer_vsync_id`、`swap_trace_id`、selected deadline。之後 `OnSwap()` 加入 swap timings；`OnPresent()` 再把 presentation feedback fan-out 給所有 helpers。

```text
PresentationGroupTiming
├─ source PresentationHelpers(frame_token...)
├─ choreographer_vsync_id
├─ swap_trace_id
├─ selected_deadline
├─ draw_start
├─ swap_timings
└─ presentation_feedback
```

重要性：這就是 Hermes 一直在尋找的 **SourceFrame ↔ DisplayAggregation ↔ PlatformPresentation** 中介 witness。

限制：它是 group-level witness；不能宣稱 group 內每個 source frame 都獨占或完整產生 final display pixels。

來源：
- https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/display/display.cc

### 4. `frame_token` 最終會得到自己的 `FrameTimingDetails`

**[工程]** `CompositorFrameSinkSupport::DidPresentCompositorFrame(frame_token, ...)` 以 `frame_token` 查回該 frame 的 received/embedded timing，建立 `FrameTimingDetails`，其中包含 `draw_start_timestamp`、`swap_timings`、`presentation_feedback`、`BeginFrameId`；而且程式碼明確要求每個 `frame_token` 只得到一次 PresentationFeedback。

因此可形成：

```text
frame_token
→ received_compositor_frame_timestamp
→ embedded_frame_timestamp
→ draw_start_timestamp
→ swap_timings
→ presentation_feedback
→ BeginFrameId
```

重要性：Hermes 可以把 source frame lifecycle 從「submitted」一路建模到「presentation feedback returned」，而不必只依靠 VSync timestamp 猜測。

限制：`FrameTimingDetails.presentation_feedback` 是 display presentation result 回傳給 source frame 的 timing witness，不是 pixel-level capture identity。

來源：
- https://chromium.googlesource.com/chromium/src/+/refs/heads/master/components/viz/service/frame_sinks/compositor_frame_sink_support.cc
- https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/common/frame_timing_details.h

### 5. GUI Agent 的真正 observation verifier 應驗證「transition provenance」，不只是 next screenshot

**[論文]** Desktop-Delta Bench（Pillai, Nayak, Chen, 2026）以 2,013 個 human-verified desktop transition instances 測 state verification、source tracking、context-aware control；最佳 temporal-ordering exact match 約 65%，顯示模型很難判斷下一個 observation 是否真由上一 action 導致。

**[論文]** StateAct（Yang et al., 2026）則顯示 program-state-first + GUI subagent + independent finish gate 比 screenshot-only 更可靠；其核心觀點是 pixels 是 underlying program state 的 lossy rendering。

**[論文]** Temporal UI State Inconsistency（Xu, 2026）把 observation-to-action gap 形式化為 TOCTOU/Visual Atomicity Violation；其 pre-execution re-verification 在視覺/窗口型攻擊有效，但對 zero-visual-footprint DOM injection 仍有盲點，進一步支持多證據通道。

因此 Hermes Agent loop 應從：

```text
Action
→ Screenshot
→ VLM
→ Next Action
```

升級成：

```text
Intent
→ Expected State Transition
→ Action Dispatch
→ Program/DOM State Witness
→ Source Frame Witness
→ PresentationGroup Witness
→ Capture Witness
→ Observation
→ Transition Verifier
→ Risk-Adaptive Next Decision
```

來源：
- https://arxiv.org/abs/2607.26041
- https://arxiv.org/abs/2607.22798
- https://arxiv.org/abs/2604.18860

## Architecture Breakdown

### Chromium source-frame-to-presentation architecture

```text
Renderer / Browser Compositor
        │
        ▼
CompositorFrame(frame_token)
        │
        ▼
CompositorFrameSinkSupport
        │
        ▼
Surface active frame
        │
        ├─ received timestamp
        ├─ embedded timestamp
        └─ PresentationHelper(frame_token)
                 │
                 ▼
SurfaceAggregator
        │
        ├─ contained_surfaces
        ├─ SurfaceId → frame_index
        └─ aggregated render passes
                 │
                 ▼
Display::DrawAndSwap
        │
        ├─ PresentationHelpers[]
        ├─ swap_trace_id
        ├─ choreographer_vsync_id
        └─ selected_deadline
                 │
                 ▼
PresentationGroupTiming
        │
        ▼
OutputSurface / Presenter / Platform compositor
        │
        ▼
PresentationFeedback
        │
        ▼
PresentationGroupTiming::OnPresent
        │
        ├─ helper(F471).DidPresent
        ├─ helper(C88).DidPresent
        └─ helper(C104).DidPresent
                 │
                 ▼
CompositorFrameSinkSupport::DidPresentCompositorFrame(frame_token)
        │
        ▼
FrameTimingDetails[frame_token]
```

### Hermes Evidence-Driven Computer Agent architecture

```text
User Goal
→ State-grounded Planner
→ Expected Transition
→ Computer Action
→ Structured State Witness
→ Browser SourceFrameWitness
→ PresentationGroupWitness
→ CaptureObservation
→ Region Grounding
→ TransitionEvidenceVerifier
→ ActionAuthority
→ Continue / Recapture / Recover / Block
```

## Bottom-Level Logic

本輪最重要的 bottom-level mechanism 是 **presentation feedback fan-out with preserved source identity**。

抽象成資料流：

```text
for surface in AggregationContainedSurfaces:
    helper = surface.takePresentationHelper()
    if helper:
        group.add(helper)          # helper retains source frame_token

group.bind(vsync_id, swap_trace_id, deadline)
swap()
feedback = platformPresentationFeedback()

group.onPresent(feedback):
    for helper in helpers:
        helper.didPresent(feedback)
        → sourceClient.onSurfacePresented(frame_token, feedback)
```

新的 invariant：

```text
Presented(DisplayGroup G)
AND Member(SourceFrame F, G)
⇒ F receives G.presentation_feedback
```

但不能推出：

```text
F contributed every pixel of G
```

也不能推出：

```text
Capture C contains F
```

所以 Hermes 必須保留三層 proof：

```text
GroupMembershipProof
≠ PixelContributionProof
≠ CaptureInclusionProof
```

## Visual Simulation Idea

### Source Frame → Presentation Group → Capture Provenance Explorer

互動時間軸：

```text
SOURCE FRAMES
F471 ───────────────┐
C88  ───────────────┼─ helpers ─┐
C104 ───────────────┘           │
                                ▼
DISPLAY GROUP G31
contained surfaces: 3
swap_trace: S82
vsync: V9002
                                │
                                ▼
PLATFORM PRESENT
feedback: 20:52:34.812
                                │
                  ┌─────────────┼─────────────┐
                  ▼             ▼             ▼
               F471 ✓         C88 ✓        C104 ✓
                  │
                  ▼
CAPTURE C22 ?
                  │
                  ▼
VLM Observation O118
```

可切換：source frame replaced-before-aggregation、fallback child、contained-but-occluded、swap canceled、presentation failure、capture-before-present、capture-after-next-present、protected plane、OOPIF late update。

每條 edge 顯示：`CAUSAL / GROUP-BOUND / REGION-BOUND / CORRELATED / UNKNOWN / BROKEN`。

## Code / GitHub

本輪值得繼續讀的 Chromium 核心檔案：

1. `components/viz/service/surfaces/surface.cc`
   - `Surface::PresentationHelper`
   - `TakePresentationHelperForPresentNotification`
   - `DidPresent`
2. `components/viz/service/display/display.cc`
   - `PresentationGroupTiming`
   - `Display::DrawAndSwap`
   - `DidReceiveSwapBuffersAck`
   - `DidReceivePresentationFeedback`
3. `components/viz/service/display/surface_aggregator.h/.cc`
   - `previous_contained_surfaces`
   - `contained_surfaces`
   - `frame_index`
4. `components/viz/service/frame_sinks/compositor_frame_sink_support.cc`
   - `DidPresentCompositorFrame`
   - `frame_timing_details_`
5. `components/viz/common/frame_timing_details.h`
   - source-frame receive/embed/draw/swap/present lifecycle

Chromium source root：
- https://chromium.googlesource.com/chromium/src/

## Papers

### Desktop-Delta Bench: Do Computer-Use Models Understand Desktop GUI Transitions?
- Authors: Abhishek Pillai, Samir Kumar Nayak, Yuan Chen
- Institution: 以論文正式 affiliation 為準，本輪不從摘要推測
- Year: 2026
- URL: https://arxiv.org/abs/2607.26041
- Code/Dataset: 論文頁面/作者 release 為準
- Dataset: 2,013 human-verified desktop transition instances
- Architecture: offline step-level temporal/source/action transition evaluation
- Contribution: 把 GUI Agent 評估從 final success 往 causal transition verification 下鑽
- Limitations: benchmark 是診斷層，不直接提供 browser compositor causal identity
- 改變了什麼：證明「辨識畫面」與「辨識這個畫面是不是上一 action 的結果」是不同能力。

### StateAct: Program State, before Pixels, for Long-Horizon Computer-Use Agents
- Authors: Yan Yang, Xiangru Jian, Ziyang Luo, Zirui Zhao, Yutong Dai, Ziji Shi, Hanshu Yan, Jun Hao Liew, Silvio Savarese, Junnan Li
- Year: 2026
- URL: https://arxiv.org/abs/2607.22798
- Architecture: code-first main agent + GUI subagent + independent finish gate
- Contribution: 把 state grounding 放在 screenshot perception 之前
- Limitations: program state 並不能完全取代只有 GUI 才暴露的 rendered/transient state
- 改變了什麼：支持 Hermes 採雙軌 `SemanticStateProof + VisualPresentationProof`。

### Temporal UI State Inconsistency in Desktop GUI Agents
- Author: Wenpeng Xu
- Year: 2026
- URL: https://arxiv.org/abs/2604.18860
- Architecture: screenshot-driven CUA TOCTOU threat model + pre-execution UI state verification
- Contribution: 形式化 observation-to-action temporal gap
- Limitations: zero-visual-footprint DOM injection 對純視覺 re-verification 仍是盲點
- 改變了什麼：說明 action gate 必須在 dispatch 前重新驗證多通道 state，而非相信舊 screenshot。

## Unknown / Open Questions 1–3

1. **PresentationGroup membership 是否能精確到 aggregation 時使用的 `(SurfaceId, frame_index, frame_token)` 三元組？** 目前 helper 保存 frame_token、aggregator 保存 SurfaceId→frame_index，但仍需讀 `TakePresentationHelperForPresentNotification()` 與 active-frame replacement lifecycle，確認兩者是否永遠指向同一 generation。
2. **同一 PresentationGroup 的 source frame 若只被部分/遮擋區域使用，如何把 group-level presentation feedback 降到 target-region proof？** 需要把 `PresentationHelper` 接回 `VisualContributionGraph` 的 quad/transform/clip/occlusion/filter/overlay provenance。
3. **Presented group 如何 causal-bind 到 Agent capture buffer？** 這仍是最大的跨 browser/OS/capture boundary 缺口；`PresentationFeedback` 與 screenshot timestamp 接近仍不等於同一 presented composition。

## 下一輪研究

下一輪鎖定：

```text
Surface active frame
→ frame_index
→ frame_token
→ TakePresentationHelperForPresentNotification
→ contained_surfaces membership
→ PresentationGroupTiming
```

優先回答 `SurfaceFrameGenerationWitness`：是否能建立：

```text
SurfaceId + frame_index + frame_token
```

作為不受 buffer reuse / active-frame replacement 影響的 source generation identity。

接著再把：

```text
SurfaceFrameGenerationWitness
→ Quad/RegionContributionWitness
→ PresentationGroupWitness
→ CaptureObservation
```

串起來。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `SourceFramePresentationHelper`
- `PresentationGroupTiming`
- `PresentationGroupMembership`
- `SourceFramePresentationWitness`
- `SurfaceFrameGenerationWitness`
- `FrameTimingDetailsWitness`
- `GroupMembershipProof`
- `PresentedSourceFrameSet`
- `PresentationFeedbackFanout`
- `TransitionEvidenceVerifier`

### Edges

```text
SourceFrame --OWNS--> SourceFramePresentationHelper
SourceFramePresentationHelper --MEMBER_OF--> PresentationGroupTiming
DisplayAggregation --CREATES--> PresentationGroupTiming
PresentationGroupTiming --TARGETED_AT--> ChoreographerVSyncId
PresentationGroupTiming --SWAPPED_AS--> SwapTraceId
PresentationFeedback --RESOLVES--> PresentationGroupTiming
PresentationGroupTiming --FANS_OUT_FEEDBACK_TO--> SourceFramePresentationHelper
SourceFramePresentationHelper --REPORTS_PRESENTED--> FrameToken
FrameToken --INDEXES--> FrameTimingDetailsWitness
GroupMembershipProof --MUST_BE_COMBINED_WITH--> PixelContributionProof
PixelContributionProof --MUST_BE_COMBINED_WITH--> CaptureInclusionProof
```

## 本輪結束檢查

- **缺哪一層：** `Presented source frame → captured buffer` 的 causal identity，以及 group-level → target-region 的 proof lowering。
- **哪個節點最淺：** `SurfaceFrameGenerationWitness`，因為 `SurfaceId/frame_index/frame_token` 三者的 generation consistency 尚未完整驗證。
- **哪個概念仍只是名詞：** `CaptureInclusionProof`；目前沒有跨平台通用 primitive 能證明某 source frame 的 target region 一定包含於 Agent 收到的 capture。
- **哪個系統值得讀原始碼：** Chromium Viz `Surface + SurfaceAggregator + Display::PresentationGroupTiming + CompositorFrameSinkSupport`，下一步再接 Android/Windows capture backend。
- **哪篇論文需追引用：** Desktop-Delta Bench，因為它直接量測 source tracking / temporal transition verification，可用來設計 Hermes `TransitionEvidenceVerifier` benchmark。
- **哪個概念最適合視覺模擬：** `Source Frame → Presentation Group → Capture Provenance Explorer`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Active Visual Subagent + SourceFrame/Presentation Evidence DAG + Transition Verifier + Risk-Adaptive Action Gate + Independent Postcondition Verifier`。

## 對「AI 到底怎麼運作」的本輪增量

```text
使用者一句話
→ UI
→ Agent Runtime
→ Context / Memory
→ Model Reasoning
→ Planning
→ Tool / Computer Intent
→ Expected State Transition
→ Browser/Program State
→ CompositorFrame(frame_token)
→ Surface(frame_index)
→ Display Aggregation
→ PresentationGroup(frame_tokens[], swap_trace_id, VSyncId)
→ Platform PresentationFeedback
→ per-source FrameTimingDetails
→ Capture Boundary
→ Agent-visible Pixels
→ Vision Encoder
→ Visual Tokens
→ Multimodal Fusion
→ Transition Verification
→ Risk-Adaptive Action Gate
→ Action
→ Postcondition Verification
→ Output
```

本輪最重要的修正：**上一輪判斷「不存在 frame_token = VSyncId 的一對一 identity」是正確的，但 Chromium 並非因此失去 source-to-present causal chain。真正的鏈是多個 source frame tokens 透過 `PresentationHelper` 成為同一 `PresentationGroupTiming` 的成員，再由該 group 綁定 swap/VSync/presentation feedback，最後把同一份 display presentation result 以原始 frame_token fan-out 回各 source client。Hermes 因此應建模『presentation group membership』，而不是尋找不存在的 global frame ID。**