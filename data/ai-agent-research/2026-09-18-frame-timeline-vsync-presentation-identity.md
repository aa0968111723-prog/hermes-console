# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 18:54（Asia/Taipei）

主題：FrameTimeline VSync Identity × SurfaceControl Present Fence × Causal Presentation Graph

> 證據標籤：**[官方]** Android/AOSP/Chromium 官方文件或原始碼；**[論文]** 論文結果；**[工程]** 從原始碼可直接確認的實作；**[推論]** 由多個已確認 primitive 組成、但尚未有單一 API 完整證明；**[假說]** 待下一輪驗證。

## 本小時新發現

本輪接續上一輪 `FrameTokenToPresentFenceEdge`，不再重複「present fence 比 transaction ACK 強」的結論，而是往 Android FrameTimeline identity 深挖。新的核心發現是：Chromium 的 SurfaceControl backend 已實際把 Choreographer 提供的 `vsync_id` 寫入待提交的 `ASurfaceTransaction`；Android NDK 官方則定義 `ASurfaceTransaction_setFrameTimeline(transaction, vsyncId)` 用於告訴 SurfaceFlinger 該 frame 的預期 presentation timeline。這提供了 Chromium transaction → Android FrameTimeline 的明確 identity edge，但目前仍未找到 `CompositorFrame.frame_token → vsync_id` 的單一直接 causal ID。

新架構：`FrameTimelinePresentationWitness`。

新 bottom-level mechanism：`Choreographer VSyncId → ASurfaceTransaction_setFrameTimeline → SurfaceFlinger scheduling → latch → present fence`。

新 benchmark：Desktop-Delta Bench（2026）把 stale/delayed/occluded screenshot 與 action-caused transition 明確當成 Computer Agent 的 step-level causal verification 問題；這與本輪 presentation identity 的工程缺口直接對應。

## 本小時最重要 5 個發現

### 1. Chromium 確實把 Android `vsync_id` 寫進 SurfaceControl transaction

**[工程/官方]** `GLSurfaceEGLSurfaceControl` 在 `use_target_deadline_` 且 `choreographer_vsync_id_for_next_frame_` 存在時，呼叫 `pending_transaction_->SetFrameTimelineId(...)`，然後才 Apply transaction。`gfx::SurfaceControl::Transaction::SetFrameTimelineId` 再直接呼叫 NDK `ASurfaceTransaction_setFrameTimeline(transaction_, vsync_id)`。

底層：

```text
Choreographer callback
→ frame timeline candidate
→ vsync_id
→ GLSurfaceEGLSurfaceControl
→ pending SurfaceControl Transaction
→ SetFrameTimelineId(vsync_id)
→ ASurfaceTransaction_setFrameTimeline
→ Apply
→ SurfaceFlinger
```

為什麼重要：這第一次把 Chromium Android presentation path 中的「target display timeline identity」變成可保存的 knowledge-graph node，而不只是 timestamp correlation。

限制：這仍不是 `CompositorFrame.frame_token` 的 identity；同一 browser frame 到底如何選到這個 next-frame Choreographer timeline，仍需繼續追 caller / scheduling path。

來源：
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/gl/gl_surface_egl_surface_control.cc
- https://chromium.googlesource.com/chromium/src/+/e4fe9c3c8c3068d96a31b33be8890cba96690801/ui/gfx/android/android_surface_control_compat.cc

### 2. Android FrameTimeline 的 VSyncId 是「presentation target identity」，不是 present proof

**[官方]** Android NDK 定義 `ASurfaceTransaction_setFrameTimeline`：vsync ID 來自 Choreographer frame timeline；SurfaceFlinger 會嘗試在對應 expected presentation time 呈現 frame。

```text
VSyncId
= scheduling / intended presentation timeline identity
≠ proof that pixels were actually presented
```

真正較強的 presentation evidence 仍是 `ASurfaceTransactionStats_getPresentFenceFd()`；官方定義該 fence 在 transaction 已 presented 時 signal。`getLatchTime()` 則只證明 framework latch，不能等同 display。

因此 Hermes 應保存：

```text
FrameTimelineTarget(vsync_id)
→ TransactionApplied
→ TransactionLatched
→ PresentFence
→ FenceSignaled
```

而不是把 VSyncId 直接標成 `PRESENTED`。

來源：https://developer.android.com/ndk/reference/group/native-activity

### 3. Android sync framework 把 acquire / release / present fence 分成不同 causal semantics

**[官方]** AOSP graphics synchronization framework 明確區分：Acquire fence 保證 producer write 完成後 compositor 才讀；Release fence 表示上一個 buffer 不再被 HWC 使用；Present fence 對 physical display 表示 current frame 出現在 screen。

這讓 Hermes 的 buffer lifecycle 必須拆成：

```text
GPU writes buffer
→ AcquireFence
→ SurfaceFlinger/HWC reads
→ presentDisplay
→ PresentFence
→ frame appears on physical display
→ ReleaseFence(previous buffer)
→ buffer reuse allowed
```

重要性：`PlatformBufferIdentity` 不能只記 AHardwareBuffer pointer/handle；還要附帶 fence generation/lifetime，否則 buffer reuse 會造成 ABA-style provenance 錯誤：同一 buffer identity 在不同時間可能代表不同 pixel contents。

限制：AOSP 的 present fence semantics 很強，但 Hermes 還缺「哪一個 Chromium frame_token 產生了哪個 buffer generation」。

來源：https://source.android.com/docs/core/graphics/sync

### 4. Android 新的 JankData / FrameTimeline API 顯示 VSyncId 可以成為跨 metrics 的 join key

**[官方]** Android `SurfaceControl.JankData`（API 36 起）提供 `getVsyncId()`，文件明確指出可透過 frame VSync id 與 `FrameMetrics` 關聯；更新 API 還提供 actual present time，並區分 `PRESENTATION_TIME_UNSET`（沒有呈現）與 `PRESENTATION_TIME_UNKNOWN`（平台無法確認）。

這暗示 Hermes 可以建立：

```text
VSyncId
├─ Choreographer FrameTimeline
├─ SurfaceControl Transaction target
├─ FrameMetrics
├─ Jank classification
└─ Actual/Unknown/Unset present status
```

**[推論]** 這是一個比「timestamp 靠很近」更好的 Android-side correlation spine；但 Chromium 是否能在 production runtime 取得足夠 JankData 並把它與自身 frame_token 串起，尚未驗證。

來源：https://developer.android.com/reference/kotlin/android/view/SurfaceControl.JankData

### 5. Computer Agent 的 stale-observation 問題本質上就是缺 causal transition witness

**[論文]** Desktop-Delta Bench（Pillai, Nayak, Chen, 2026）建立 2,013 個 human-verified step-level desktop instances，專門測 state verification、source tracking、context-aware control。論文明確指出 inference、remote input、app rendering、screenshot capture 是非同步的，下一張 observation 可能 delayed、occluded、transient 或與 action 無關。最佳 temporal ordering exact-match 仍約 65%。

這與 Hermes 本輪的工程模型直接對應：

```text
Action A
→ expected state transition
→ browser frame
→ platform timeline
→ presentation
→ capture
→ Observation O
```

若 O 缺少 presentation/capture causal witness，Agent 不能安全地把 `O` 當成 `A` 的後果。

來源：https://arxiv.org/abs/2607.26041

## Architecture Breakdown

### Android FrameTimeline Presentation Architecture

```text
Browser / Viz
  │
  ├─ CompositorFrame frame_token          [Chromium identity]
  │
  ├─ OutputSurface / swap sequencing
  │
  ▼
GLSurfaceEGLSurfaceControl
  │
  ├─ SurfaceControl::Transaction id       [Chromium wrapper identity]
  ├─ AHardwareBuffer + acquire fence
  ├─ geometry / z / visibility / color
  └─ FrameTimeline VSyncId                [Android scheduling identity]
  │
  ▼
ASurfaceTransaction_apply
  │
  ▼
SurfaceFlinger
  │
  ├─ latch time
  ├─ composition / HWC
  ├─ desired vs actual timeline
  └─ present fence
  │
  ▼
Physical Display
```

Hermes 應把它建模成 Evidence DAG，而不是強迫所有 ID 合成一個不存在的 `global_frame_id`。

### 建議資料結構

```ts
type FrameTimelinePresentationWitness = {
  chromiumFrameToken?: number
  swapTraceId?: number
  surfaceTransactionId?: number
  platformBufferGeneration?: string
  choreographerVsyncId?: bigint
  targetPresentationTime?: number
  latchTime?: number
  presentFenceId?: string
  presentFenceSignalTime?: number
  actualPresentTime?: number
  presentationStatus:
    | 'FENCE_BACKED'
    | 'PRESENT_TIME_REPORTED'
    | 'LATCH_ONLY'
    | 'TARGET_ONLY'
    | 'NOT_PRESENTED'
    | 'UNKNOWN'
  bindingStrength: 'CAUSAL' | 'CORRELATED' | 'UNKNOWN'
}
```

## Bottom-Level Logic

### FrameTimeline 不是 frame counter

VSyncId 的作用不是簡單的 `frame #123`。它代表 Choreographer 提供的 frame timeline candidate。應用程式依自己能否趕上 deadline 與 desired presentation time 選擇 timeline，再把 VSyncId 放進 SurfaceControl transaction，讓 SurfaceFlinger 對應 scheduling。

```text
VSync callback
→ candidate timelines
→ choose timeline based on deadline
→ extract VSyncId
→ tag transaction
→ SurfaceFlinger scheduling
```

因此：

```text
same VSyncId ⇒ 有共同 scheduling identity
```

比：

```text
|timestampA - timestampB| < 5ms
```

強；但它仍不能單獨證明 pixels actually reached display。

### Buffer generation 是缺失的底層節點

若 buffer B 被重複使用：

```text
B@generation17 → frame F471
B@generation18 → frame F479
```

只保存 `buffer=B` 會錯誤把兩次內容視為同一 evidence object。Hermes 應加入：

```text
PlatformBufferGeneration
= buffer identity
+ acquire fence generation
+ transaction identity
+ content epoch
```

這是本輪的新推論模型，尚需從 Chromium resource/overlay lock lifecycle 驗證。

## Visual Simulation Idea

### FrameTimeline Causal Spine Explorer

Console 顯示 6 條同步時間線：

```text
CHROMIUM   F471────F472────────F473
              │
SWAP          S81────S82────────S83
                       │
VSYNC       V9001──V9002──V9003──V9004
                       │
TX                     TX91 apply
                          │
SF                        latch
                            │
HWC                         presentDisplay
                               │
FENCE                          signal
                                  │
CAPTURE                         C22
                                  │
AGENT                           O118
```

可注入：missed deadline、transaction delayed、buffer reuse、fence unsupported、frame replaced-before-present、capture-before-present、capture-after-next-frame、jank、OOPIF child late update。

每條 edge 顯示 `CAUSAL / CORRELATED / UNKNOWN / BROKEN`，並同步產生 action authority：`ALLOW / WAIT / RECAPTURE / BLOCK`。

## Code / GitHub

本輪值得繼續讀的核心檔案：

1. Chromium `ui/gl/gl_surface_egl_surface_control.cc`：SurfaceControl transaction queue、Choreographer VSyncId、transaction ACK、presentation callback。
2. Chromium `ui/gfx/android/android_surface_control_compat.cc/.h`：NDK SurfaceControl wrapper、transaction id、SetBuffer、SetFrameTimelineId、present fence/latch stats。
3. 下一輪：搜尋 `choreographer_vsync_id_for_next_frame_` 的 producer/caller，建立 `BeginFrame/Viz frame → VSyncId` edge。
4. 下一輪：追 `AHardwareBuffer` / overlay resource / fence lifecycle，建立 `FrameToken → PlatformBufferGeneration` edge。

Chromium source:
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/gl/gl_surface_egl_surface_control.cc
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/gfx/android/android_surface_control_compat.cc

## Papers

### Desktop-Delta Bench: Do Computer-Use Models Understand Desktop GUI Transitions?
- Authors: Abhishek Pillai, Samir Kumar Nayak, Yuan Chen
- Institution: 論文頁需下一輪補齊作者 affiliation 驗證
- Year: 2026
- URL: https://arxiv.org/abs/2607.26041
- Code: 本輪未確認官方 code repository
- Dataset: 2,013 human-verified instances；463 3-frame temporal-ordering，1,550 before-after pairs；約 15 applications、50 task domains
- Architecture: benchmark / diagnostic evaluation，不是 agent runtime architecture
- Contribution: 把 GUI action 後的 causal transition understanding 獨立成 benchmark layer
- Limitations: offline diagnostic；不能直接證明 end-to-end runtime 的 presentation/capture provenance
- 改變了什麼：把「下一張 screenshot 看起來合理」與「它真的是上一個 action 造成的狀態」正式拆開。

### WeaveBench: A Long-Horizon, Real-World Benchmark for Computer-Use Agents with Hybrid Interfaces
- Authors: Wanli Li, Bowen Zhou, Yunyao Yu, Zhou Xu, Yifan Yang, Dongsheng Li, Caihua Shan
- Year: 2026
- URL: https://arxiv.org/abs/2606.09426
- Dataset: 114 tasks / 8 real-world domains
- Architecture: GUI + CLI/code hybrid trajectories + trajectory-aware judge
- Contribution: trajectory evidence 能抓出 fabricated visual evidence / hard-coded metrics；最佳 PassRate 41.2%
- Limitation: 不直接提供 OS compositor-level provenance
- 本輪角色：支援 Hermes 必須保存 trajectory evidence，而不是只驗最後 outcome。

## Unknown / Open Questions

1. `CompositorFrame.frame_token → choreographer_vsync_id_for_next_frame_` 的實際 producer/call chain 是什麼？是否可得到直接 causal edge，而不是靠 transaction order 推論？
2. SurfaceControl transaction 中每個 AHardwareBuffer 是否能建立穩定的 `PlatformBufferGeneration`，避免 buffer reuse 造成 provenance ABA 問題？
3. Android `JankData.vsyncId / actualPresentTime` 能否在 Chromium production path 被低成本採集，並與 transaction/frame token join？

## 下一輪研究

優先搜尋並讀取：

```text
choreographer_vsync_id_for_next_frame_
SetChoreographerVsyncIdForNextFrame
AChoreographerFrameCallbackData_getFrameTimelineVsyncId
OutputSurfaceFrame
frame_token
SurfaceControl SetBuffer
AHardwareBuffer / overlay resource lock
```

目標建立：

```text
CompositorFrame.frame_token
→ OutputSurface submission
→ Choreographer VSyncId
→ SurfaceControl TransactionId
→ PlatformBufferGeneration
→ PresentFence
→ CaptureWitness
```

如果無法找到 direct identity，保持 `CORRELATED/UNKNOWN`，禁止用 timestamp 補成假的 causal proof。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `FrameTimelinePresentationWitness`
- `AndroidFrameTimelineVSyncId`
- `FrameTimelineCandidate`
- `PlatformBufferGeneration`
- `AcquireFenceWitness`
- `ReleaseFenceWitness`
- `PresentFenceWitness`
- `PresentationStatusUnknown`
- `PresentationStatusUnset`
- `CausalTransitionWitness`
- `ObservationAfterActionWitness`

### Edges

```text
ChoreographerFrameTimeline --IDENTIFIED_BY--> AndroidFrameTimelineVSyncId
AndroidFrameTimelineVSyncId --TAGS--> SurfaceControlTransaction
SurfaceControlTransaction --TARGETS--> SurfaceFlingerTimeline
PlatformBufferGeneration --GUARDED_BY--> AcquireFenceWitness
SurfaceFlingerComposition --COMPLETES_WITH--> PresentFenceWitness
PreviousPlatformBufferGeneration --RELEASED_BY--> ReleaseFenceWitness
Action --EXPECTS--> CausalTransitionWitness
CaptureObservation --CLAIMS_EVIDENCE_OF--> CausalTransitionWitness
```

## 本輪結束判斷

- **缺哪一層：** `CompositorFrame.frame_token → Choreographer VSyncId → concrete buffer generation`。
- **哪個節點最淺：** `PlatformBufferGeneration`。
- **哪個概念仍只是名詞：** `FrameTokenToPresentFenceEdge`；現在中段 identity 變強，但尚未端到端 causal。
- **哪個系統最值得讀原始碼：** Chromium `GLSurfaceEGLSurfaceControl` + Android SurfaceFlinger FrameTimeline/HWC sync path。
- **哪篇論文需追引用：** Desktop-Delta Bench，尤其 stale observation / source tracking / transition verification 後續工作。
- **哪個概念最適合視覺模擬：** `FrameTimeline Causal Spine Explorer`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Active Visual Subagent + Causal Observation Evidence DAG + Presentation-dependent Action Gate + Independent Transition Verifier`。

## 最終鏈條目前推進位置

```text
使用者一句話
→ UI
→ Agent Runtime
→ Context / Memory
→ Model Reasoning
→ Planning
→ Tool / Computer Intent
→ Browser State
→ Blink / Layout / Paint
→ CompositorFrame
→ Viz
→ OutputSurface
→ SurfaceControl Transaction
→ FrameTimeline VSyncId
→ SurfaceFlinger latch
→ HWC composition
→ Present Fence
→ [尚缺 Capture causal identity]
→ Captured Pixels
→ Vision Encoder
→ Visual Tokens
→ Multimodal Fusion
→ Reasoning
→ Action Gate
→ External Action
→ Causal Transition Verification
→ Output
```

本輪最大的進展不是再找到一個 timestamp，而是找到一條 Android 原生的 **FrameTimeline identity spine**：Chromium 確實能把 Choreographer VSyncId 寫入 SurfaceControl transaction，Android 又能用同一類 VSync identity 做 frame metrics/jank 關聯，再由 present fence提供較強的 actual-presentation evidence。下一步的核心就是把 Chromium `frame_token` 與這條 spine 的入口直接綁定，並把出口綁到 capture buffer。