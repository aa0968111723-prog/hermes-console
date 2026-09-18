# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 17:53（Asia/Taipei）

主題：Android Present Fence × Transaction-to-Photon Witness × Evidence-Driven Computer Agent

## 本小時新發現
本輪承接 16:56 的 `PlatformCommitWitness`，不再停在 SurfaceControl transaction complete，而是追 Android transaction 從 latch 到真正 presentation 的可觀測證據。核心修正：上一輪把 `transaction complete ≠ user saw pixels` 留為缺口；本輪確認 Android API 與 Chromium 原始碼已存在 present-fence 路徑，可把證據推到 hardware-completion/presentation boundary，但仍不能等同人眼實際感知。

### 1. Android TransactionStats 已提供 latch time + present fence
**已確認／Android 官方。** `SurfaceControl.TransactionStats`（API 35）由 `addTransactionCompletedListener` 提供，`getLatchTimeNanos()` 表示 frame 被 framework latch 並排入 presentation 的 CLOCK_MONOTONIC 時間；`getPresentFence()` 回傳在 transaction 已 presented 時 signal 的 `SyncFence`。裝置不支援 present fence 時可能得到 empty fence。

底層鏈：
`SurfaceControl.Transaction.apply → latch → queued for presentation → present fence signal`

因此 `TransactionComplete` 應拆成至少：
`APPLIED → LATCHED → PRESENT_FENCE_SIGNALED`。

### 2. Chromium 不是只知道 callback；它真的讀 ASurfaceTransactionStats present fence
**已確認／Chromium 原始碼。** `ui/gfx/android/android_surface_control_compat.cc` 動態載入 `ASurfaceTransactionStats_getPresentFenceFd`、`getLatchTime`、surface stats 等 API。這表示 Chromium 的 Android SurfaceControl backend 可以取得 platform presentation fence，而非只靠 timestamp 猜測。

### 3. GLSurfaceEGLSurfaceControl 把 present fence 轉成 PresentationFeedback
**已確認／Chromium 原始碼。** `GLSurfaceEGLSurfaceControl::OrderedOnTransactionAckOnGpuThread()` 先發出 swap completion (`SWAP_ACK`)，再把 `transaction_stats.latch_time` 與 `transaction_stats.present_fence` 放入 pending presentation queue。`CheckPendingPresentationCallbacks()` 等 present fence signal；有效 fence signal 時產生帶 `kHWCompletion | kVSync` 的 `gfx::PresentationFeedback`。若 fence invalid，Chromium fallback 到 latch time 且 flags=0。

因此：
`SWAP_ACK ≠ PRESENTED`
而 Android 上可形成：
`TransactionStats → PresentFence → FenceSignalTime → PresentationFeedback(kHWCompletion|kVSync)`。

### 4. 新 proof ladder：Transaction-to-Photon Witness
**工程建模，基於官方與 Chromium 原始碼。** Hermes 應新增：

`P0 TRANSACTION_APPLIED`
`P1 TRANSACTION_ACKED`
`P2 LATCH_TIME_KNOWN`
`P3 PRESENT_FENCE_AVAILABLE`
`P4 PRESENT_FENCE_SIGNALED`
`P5 CHROMIUM_PRESENTATION_FEEDBACK`
`P6 DISPLAY_SCANOUT / PHOTON`（尚未直接證明）

命名上不應把 P5 稱為真正 Photon proof；較嚴謹名稱是 `PlatformPresentationWitness`。Present fence 是目前可取得的強平台證據，但 panel scanout、display pipeline、VRR、external display、human-visible latency 仍在其後。

### 5. Long-horizon CUA benchmark 支持「證據鏈 + postcondition」而非 outcome-only
**論文結果。** WeaveBench（Li et al., Zhejiang University / Microsoft Research Asia / Tsinghua University, 2026）含 114 個、8 個工作領域的長程 hybrid-interface tasks；最佳 PassRate 僅 41.2%，且 trajectory-aware judge 顯示只看最終 outcome 會高估 agent performance。這與 Hermes 的 Evidence DAG 相符：Computer Agent 不應只記「click succeeded」，而應保留 observation、action、presentation、artifact/log 與 postcondition evidence。

## 本小時最重要 5 個發現

1. **PresentFence 是比 transaction complete 強一級的 presentation witness。** Transaction complete 不等於 presentation；present fence signal 才把證據推到平台已呈現的邊界。限制：硬體不一定支援 fence，且 fence 仍不是人眼/photodiode proof。
2. **Chromium 已把 Android platform fence 接回 browser presentation feedback。** 這不是設計假說，而是 `GLSurfaceEGLSurfaceControl` 現有 runtime 路徑。
3. **Swap completion 與 presentation callback 在 Chromium 中明確分離。** Agent runtime 若只觀察 swap ACK，會過早宣稱畫面已更新。
4. **Fallback 必須保留 uncertainty。** invalid/unsupported present fence 時 Chromium 用 latch time 產生 feedback 且不帶 HWCompletion/VSync flags；Hermes 不可把這種 feedback 與 fence-backed feedback 等價。
5. **Computer Agent 的 verifier 應採 trajectory/evidence-aware。** WeaveBench 顯示 outcome-only grading 會高估可靠度；Hermes 的 action gate 與 postcondition verifier應保存完整 evidence chain。

## Architecture Breakdown

### Android SurfaceControl presentation path
`Viz Aggregated Frame`
→ `Skia/Overlay plane scheduling`
→ `HardwareBuffer / SurfaceControl surface`
→ `SurfaceControl.Transaction.setBuffer + geometry + z-order`
→ `Transaction.apply`
→ `SurfaceFlinger latch`
→ `TransactionStats.latch_time`
→ `PresentFence FD`
→ `Fence signal`
→ `Chromium gfx::PresentationFeedback`
→ `Hermes PlatformPresentationWitness`
→ `Postcondition verifier`
→ `Action authority update`

### Hermes evidence-driven Computer Agent
`Intent`
→ `Semantic Target`
→ `RequiredProofStrength`
→ `Observation Bundle`
→ `Structured State + Screenshot`
→ `Grounding`
→ `PlatformPresentationWitness`
→ `Action Gate`
→ `Input Event`
→ `World Mutation`
→ `Recapture / State Read`
→ `Postcondition Evidence`
→ `Continue / Retry / Rollback / Ask`

## Bottom-Level Logic

### Present fence state machine
`APPLY`
→ `ON_COMMIT?`
→ `ON_COMPLETE / ACK`
→ `LATCHED`
→ `PRESENT_FENCE_PENDING`
→ `PRESENT_FENCE_SIGNALED`
→ `PresentationFeedback`

異常分支：
- `present_fence invalid` → use latch timestamp; proof strength downgrade.
- `present_fence not signaled` → presentation pending; action depending on new pixels must wait/recapture.
- `transaction timeout` → mark platform evidence broken/unknown.
- updated surface absent from stats or reused resource → do not infer per-plane freshness from transaction-level feedback alone.

### Proposed witness
`PlatformPresentationWitness { platform, transactionId?, chromiumFrameToken?, swapTraceId?, latchTime, presentFenceSupported, presentFenceSignalTime?, feedbackFlags, surfaceSet?, confidenceClass }`

`confidenceClass ∈ { FENCE_BACKED_PRESENTATION, LATCH_ONLY, ACK_ONLY, UNKNOWN, BROKEN }`

## Visual Simulation Idea

### Transaction-to-Presentation Microscope
時間軸同時顯示：
`Chromium frame_token → Viz swap → SurfaceControl TX → ACK → latch → present fence → feedback → capture → VLM tokens → click`

互動注入：`fence unsupported / fence late / transaction timeout / child surface stale / capture before fence / capture after fence / dropped frame / reused buffer`。

UI 應直接顯示 action verdict：
`ALLOW / WAIT_FOR_PRESENT / RECAPTURE / BLOCK`
並顯示「哪一條 evidence edge 缺失」。

## Code / GitHub

### Chromium 值得讀的核心檔案
- `ui/gfx/android/android_surface_control_compat.cc`：NDK SurfaceControl API 動態綁定、TransactionStats、present fence/latch time。
- `ui/gl/gl_surface_egl_surface_control.cc`：transaction ack ordering、present-fence polling、PresentationFeedback 生成。
- `ui/gl/gl_surface_egl_surface_control.h`：pending presentation callback、transaction id 與 fence state。

### 原始碼確認
`android_surface_control_compat.cc` 載入 `ASurfaceTransactionStats_getPresentFenceFd` 與 `getLatchTime`。
`gl_surface_egl_surface_control.cc` 在 swap completion 後才建立 pending presentation callback；有效 fence signal 時標記 `kHWCompletion | kVSync`，invalid fence 則 fallback latch time 且 flags=0。

## Papers

### WeaveBench: A Long-Horizon, Real-World Benchmark for Computer-Use Agents with Hybrid Interfaces
- Authors: Wanli Li, Bowen Zhou, Yunyao Yu, Zhou Xu, Yifan Yang, Dongsheng Li, Caihua Shan
- Institution: Zhejiang University; Microsoft Research Asia; Tsinghua University
- Year: 2026
- URL: https://arxiv.org/abs/2606.09426
- Code/Project: https://weavebench.github.io/
- Dataset: 114 tasks, 8 real-world work domains
- Architecture/Eval: GUI + CLI/code hybrid runtime; trajectory-aware judge examines deliverables/files/screenshots/logs/action traces
- Contribution: isolates long-horizon cross-interface orchestration and detects shortcut/fabricated evidence
- Result: best PassRate 41.2%; outcome-only grading overestimates performance
- Limitation: Ubuntu-centered deployed environment; benchmark evidence does not itself solve platform-level pixel provenance
- 改變了什麼：把「agent 成功」從 final outcome 推向 trajectory evidence，與 Hermes 的 Evidence DAG / independent verifier 方向一致。

## Unknown / Open Questions 1-3

1. Chromium 的 `frame_token / swap_trace_id` 能否在 Android SurfaceControl path 被穩定綁到特定 transaction id + present fence，而不是只靠 callback ordering？
2. transaction-level present fence 能否證明所有 SurfaceControl child planes 都是同一 freshness epoch，或仍需要 per-surface buffer/fence witness？
3. OS capture buffer 能否取得足夠 identity，直接 causal-bind 到 fence-backed presented transaction？目前仍缺 `PresentedTransaction → CapturedBuffer` 的硬 identity。

## 下一輪研究

優先深入：
`Chromium frame_token → OutputSurfaceFrame → GLSurfaceEGLSurfaceControl transaction queue → SurfaceControl transaction id → present fence → PresentationFeedback`。

並追 Android `SurfaceFlinger / FrameTimeline / vsync_id / present fence`，確認是否可建立 `FrameTokenToPresentFenceEdge`。Windows 端平行追 `DComp commit → DWM frame statistics / present statistics`，建立跨平台 `PlatformPresentationAdapter` 的共同最小介面。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `AndroidPresentFence`
- `TransactionLatchTime`
- `PlatformPresentationWitness`
- `FenceBackedPresentation`
- `LatchOnlyPresentation`
- `PresentationFeedbackFlags`
- `TransactionToPresentationGap`
- `FrameTokenToPresentFenceEdge`
- `TrajectoryEvidenceVerifier`
- `PresentationDependentActionGate`

### Edges
- `SurfaceControlTransaction --LATCHED_AT--> TransactionLatchTime`
- `SurfaceControlTransaction --PRESENTED_BY--> AndroidPresentFence`
- `AndroidPresentFence --SIGNALS--> FenceBackedPresentation`
- `FenceBackedPresentation --EMITS--> ChromiumPresentationFeedback`
- `ChromiumPresentationFeedback --SUPPORTS--> PlatformPresentationWitness`
- `PlatformPresentationWitness --AUTHORIZES--> PresentationDependentAction`
- `ActionTrace --VERIFIED_BY--> TrajectoryEvidenceVerifier`

## 本輪結束判斷

- **缺哪一層：** `Chromium frame_token → SurfaceControl transaction/present-fence` 的硬 causal identity，以及 `presented transaction → captured buffer`。
- **哪個節點最淺：** `FrameTokenToPresentFenceEdge`。
- **哪個概念仍只是名詞：** 真正的 `PhotonWitness`；present fence 不能誇大成人眼已看到。
- **哪個系統值得讀原始碼：** Chromium `GLSurfaceEGLSurfaceControl` + Android SurfaceFlinger/FrameTimeline。
- **哪篇論文需追引用：** WeaveBench，尤其 trajectory-aware verification 與 hybrid-interface failure taxonomy。
- **哪個概念最適合視覺模擬：** Transaction-to-Presentation Microscope。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Active Visual Subagent + Evidence DAG + Presentation-dependent Action Gate + Independent Postcondition Verifier`。

## 對「AI 到底怎麼運作」的新增還原

`使用者一句話`
→ `UI`
→ `Agent Runtime`
→ `Context / Memory`
→ `Model Reasoning`
→ `Planning`
→ `Computer Tool Intent`
→ `Observation / Grounding`
→ `Browser Render`
→ `GPU / Viz`
→ `SurfaceControl Transaction`
→ `Latch`
→ `Present Fence`
→ `Platform PresentationFeedback`
→ `Capture Boundary`
→ `Pixels`
→ `Vision Encoder`
→ `Visual Tokens`
→ `Multimodal Fusion`
→ `Reasoning`
→ `Risk-adaptive Action Gate`
→ `Input Action`
→ `Postcondition Verification`
→ `Output`

本輪的核心進展：Android 路徑已從「transaction complete」深入到「present fence signal」。這讓 Hermes 第一次能把 Computer Agent 的 display evidence 建模到 platform presentation boundary；但仍必須保留最後的證據邊界：present fence 是強 presentation witness，不是螢幕光子、人眼感知或 capture-buffer identity 的完整證明。