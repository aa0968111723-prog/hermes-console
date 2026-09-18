# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 02:53（Asia/Taipei）

主題：Per-Surface Release Fence × Transaction Present Fence × Plane Presentation Boundary

## 與歷史研究比較
上一輪已把 OverlayCandidate → mailbox → SharedImage → AHardwareBuffer → SurfaceControl child Surface → Transaction 接起來，最淺節點是 `PerPlanePresentationWitness`。本輪不重複 mailbox/SharedImage 路徑，而是直接追 Android NDK TransactionStats 與 Chromium `GLSurfaceEGLSurfaceControl` 如何把「每個 child Surface 的舊 buffer release」和「整筆 transaction 的 presentation」分開處理。

## 本小時新發現

1. Android NDK 的 `ASurfaceTransactionStats` 同時暴露 transaction-global `presentFence`，以及 transaction 內各 `ASurfaceControl` 的 per-surface stats；兩者不是同一種證據。
2. `ASurfaceTransactionStats_getASurfaceControls()` 可列出本 transaction 更新過的 Surface；`getPreviousReleaseFenceFd(stats, surface)` 則回傳該 Surface 上「前一個 buffer」的 release fence。
3. Android 官方語意明確指出：每次 `setBuffer()` applied 後，framework 對該 buffer 建立一個與特定 Surface 綁定的 unique ref；更新/移除 buffer 時，這個 ref 會在 OnComplete callback 中釋放，必要時還要等 previous-release fence signal 才能安全 reuse。
4. Chromium current main 的 `GLSurfaceEGLSurfaceControl` 已實際把 `transaction_stats.surface_stats` 與 `released_resources` 以 `surface` pointer 對齊，將 per-surface release fence 寫回對應 `scoped_buffer->SetReadFence()`。
5. 但是 transaction 的 `presentFence` 仍然是 transaction/global presentation evidence；Chromium 並沒有從這組 NDK API 得到「每個 child plane 各自的 present fence」。因此 `PerPlanePresentationWitness` 不能被錯誤標成已完全閉合。

## 本小時最重要 5 個發現

### 1. Transaction Present Fence 與 Per-Surface Release Fence 是不同 causal axis
**已確認事實 / 官方 API**：`getPresentFenceFd(stats)` 回傳 transaction presented 時 signal 的 fence；`getPreviousReleaseFenceFd(stats, surface)` 則針對指定 Surface 的 previous buffer，表示 framework 何時不再使用它。

底層：

```text
Transaction T91
├─ global presentFence PF91
├─ Surface S0 stats → previousReleaseFence RF0
├─ Surface S1 stats → previousReleaseFence RF1
└─ Surface S2 stats → previousReleaseFence RF2
```

重要性：`PF91` 能證明 transaction presentation boundary；`RF1` 能證明 S1 上一代 buffer lifetime 結束。它們不能互換。

限制：release fence 不證明 current buffer 曾被 target region 看見；present fence 也不直接指出每個 plane 的 pixel contribution。

來源：Android NDK `surface_control.h`、AOSP native SurfaceControl implementation、Chromium SurfaceControl compatibility layer。

### 2. Android 提供了真正的 Surface-scoped buffer lifetime identity
**已確認事實**：NDK 文件說 framework 將「buffer 加到 particular surface」視為 unique ref。這比單純 AHardwareBuffer pointer 更接近 generation/lifetime identity。

可建模：

```text
SurfaceBufferRef
= SurfaceControlIdentity
+ BufferIdentity
+ SetBufferTransactionEpoch
```

這個 tuple 是 Hermes 工程模型；官方確認的是 particular-surface unique ref 語意，不是此欄位名稱。

### 3. Chromium 已把 per-surface release fence 回灌 SharedImage/Overlay resource lifetime
**工程實作已確認**：`OrderedOnTransactionAckOnGpuThread()` 迭代 `transaction_stats.surface_stats`，用 `surface_stat.surface` 查 `released_resources`，若 fence 有效則呼叫 `scoped_buffer->SetReadFence()`。

```text
SurfaceControl S1
→ TransactionStats.surface_stats[S1]
→ previous release fence
→ released_resources[S1]
→ scoped hardware buffer
→ SetReadFence()
→ safe resource reuse boundary
```

這是上一輪 `StablePlatformBufferGenerationIdentity` 的重要補強：generation 不能只看 handle reuse，而必須看 Surface binding epoch + release synchronization。

### 4. Chromium resource bookkeeping 本身存在「transaction只回報 updated surfaces」的非完備性
**工程實作已確認**：Chromium 註解指出，不一定每個 `released_resources` 都能在 `surface_stats` 看到，因為 transaction ack 只包含本 transaction 被 updated 的 surfaces；同一 frame 使用但沒有 buffer update 的 Surface 不一定出現在 ack。

因此：

```text
Missing SurfaceStats
≠ resource did not participate
```

Hermes provenance graph 必須把 `NO_STAT_THIS_TRANSACTION` 與 `NOT_PRESENT` 分開，避免把 observation absence 當成 negative proof。

### 5. `PerPlanePresentationWitness` 應拆成兩層，而不是假裝 Android 已提供 per-plane present fence
**合理工程建模**：

```text
PerPlaneLifetimeWitness
├─ surface identity
├─ buffer binding epoch
├─ acquire fence
├─ previous release fence
└─ resource ref lifetime

TransactionPresentationWitness
├─ transaction id
├─ latch time
├─ present fence
├─ VSyncId / FrameTimeline target
└─ updated surface set
```

接著用：

```text
PlaneWasMemberOfPresentedTransaction
```

作為 group-bound evidence，而不是 `PlaneWasIndividuallyPresented`。

## Architecture Breakdown

### Android Chromium overlay presentation architecture

```text
AggregatedDrawQuad
→ OverlayCandidate
→ mailbox / SharedImage
→ OverlayImageRepresentation
→ AHardwareBuffer
→ child SurfaceControl S_i
→ SetBuffer(S_i, B_i, acquireFence)
→ SurfaceControl Transaction T
   ├ SetGeometry
   ├ SetZOrder
   ├ SetVisibility
   └ SetFrameTimelineId(vsync_id)
→ Apply
→ SurfaceFlinger latch
→ TransactionStats
   ├ latchTime
   ├ presentFence(T)
   └ surfaceStats[S_i]
       └ previousReleaseFence(S_i)
→ Chromium OnTransactionAck
   ├ SWAP_ACK
   ├ release-resource fence propagation
   └ pending presentation callback
→ presentFence signal
→ PresentationFeedback
```

這個 architecture 的核心是「presentation」與「resource lifetime」是正交但相互約束的兩條 evidence chain。

## Bottom-Level Logic

### Buffer lifecycle

```text
Producer writes B41
→ acquire fence AF41
→ SetBuffer(S1, B41, AF41)
→ AF41 signals
→ SurfaceFlinger may acquire/latch B41
→ Transaction T91 presented (PF91)
→ later SetBuffer(S1, B42)
→ previous-release fence RF41
→ RF41 signals
→ B41 can be safely reused
```

需要避免的錯誤推論：

```text
RF41 signaled → B41 was visible at target pixel       [不成立]
PF91 signaled → every child plane individually visible [過強]
SurfaceStats missing → plane absent                     [不成立]
Same AHardwareBuffer pointer → same content generation  [不成立]
```

### 新 evidence strength

```text
BUFFER_BOUND
→ ACQUIRE_READY
→ TRANSACTION_MEMBER
→ TRANSACTION_PRESENTED
→ RELEASE_CONFIRMED
```

Region/pixel visibility 仍需另一條 geometry + z-order + occlusion + capture chain。

## Visual Simulation Idea

### Surface Buffer Lifetime × Presentation Fence Oscilloscope

Hermes Console 可做雙軸互動時間圖：

```text
TIME ───────────────────────────────────────────────▶

S1/B41  acquire ── latch ─────── T91 present ───── release
            AF41       │              PF91             RF41
                       │
S1/B42                 └──── SetBuffer B42 ─────────────▶

S2/B18  acquire ─────── latch ─ T91 present ── retained

CAPTURE                         C22 ?
```

可注入：late acquire fence、missing SurfaceStats、buffer reuse before release、surface hidden、plane retained without buffer update、transaction present fence unsupported、capture between present and release。UI 同步顯示 `BUFFER_BOUND / TRANSACTION_BOUND / PRESENTED_GROUP / REGION_UNKNOWN / CAPTURE_UNKNOWN / BROKEN`。

## Code / GitHub

### Chromium 值得看的核心檔案
- `ui/gl/gl_surface_egl_surface_control.cc`：ScheduleOverlayPlane、Surface state、SetBuffer、resource maps、transaction ack、present fence queue。
- `ui/gfx/android/android_surface_control_compat.cc`：NDK symbol binding、Transaction ID、TransactionStats conversion、per-Surface release fence extraction。
- `ui/gfx/android/android_surface_control_compat.h`：`SurfaceStats` / `TransactionStats` 資料模型。

### AOSP 值得看的核心檔案
- `include/android/surface_control.h`：NDK contract。
- `native/android/surface_control.cpp`：`ASurfaceTransactionStats` 與 `ASurfaceControlStats` implementation。

## Papers

### Interactive Reward Agent: GUI Task Evaluation via Environment-State Verification
- Authors: Chenrui Shi, Yuwei Wu, Yang Liu, Ruining Feng, Zirui Shang, Zhi Gao, Lifeng Fan, Che Sun
- Year: 2026
- Dataset/Benchmark: GUI-RewardBench，321 GUI trajectories、10 Ubuntu desktop app categories
- Architecture: propose-then-verify evaluator，主動使用 system/application/GUI tools 驗證 completion conditions
- Contribution: 將 GUI evaluation 從 screenshot-only/outcome guess 推進到 environment-state evidence acquisition；報告 86.9% evaluation accuracy，並用作 RL reward 時得到 34.0% OSWorld success rate
- Limitation: 它驗證 task/environment state，沒有處理 GPU/compositor/capture pixel provenance；因此與 Hermes 本輪屬互補層。
- URL: https://arxiv.org/abs/2607.25904

本輪改變：它進一步支持 Hermes 的 `Independent Postcondition Verifier` 不應只依賴畫面，而應跨 structured state、GUI、runtime evidence 主動取證。

## Unknown / Open Questions

1. Android transaction-level present fence 能否透過 SurfaceFlinger/HWC layer tracing，再被強化成可驗證的 per-layer/per-plane presentation evidence？
2. 對沒有在該 transaction 更新 buffer、但仍被保留並 scanout 的 child Surface，如何建立跨 transaction 的 retained-plane membership proof？
3. presented transaction 到 screen-capture buffer 之間，是否存在可公開取得的 layer/buffer identity，還是最終只能建立受限制的 correlation + region verification？

## 下一輪研究

直接追：

```text
SurfaceControl child Surface
→ SurfaceFlinger Layer
→ BufferStateLayer / layer state
→ HWC composition type
→ display composition
→ present / release fences
→ retained layer across transactions
```

並對照 Android `dumpsys SurfaceFlinger --latency`、FrameTimeline、Layer tracing、HWC2 present/release fence semantics，判斷能否建立 `SurfaceControlSurface → SurfaceFlingerLayer → HWCPlane` 的更強 causal edge。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `SurfaceBufferRef`
- `SurfaceBufferBindingEpoch`
- `PerSurfaceReleaseFenceWitness`
- `PerPlaneLifetimeWitness`
- `TransactionUpdatedSurfaceSet`
- `RetainedPlaneState`
- `MissingSurfaceStatsState`
- `TransactionPresentationWitness`
- `PlanePresentedGroupMembership`

### Edges
```text
AHardwareBuffer --BOUND_TO_SURFACE_AS--> SurfaceBufferRef
SurfaceBufferRef --ACQUIRE_GATED_BY--> AcquireFence
SurfaceBufferRef --MEMBER_OF--> SurfaceControlTransaction
SurfaceControlTransaction --PRESENTED_BY--> PresentFence
SurfaceBufferRef --RELEASED_BY--> PreviousReleaseFence
PreviousReleaseFence --AUTHORIZES_REUSE_OF--> AHardwareBuffer
SurfaceControlSurface --MAY_BE_RETAINED_ACROSS--> TransactionEpoch
PlanePresentedGroupMembership --DOES_NOT_IMPLY--> RegionPixelContribution
```

## 本輪結束判斷

- **缺哪一層**：SurfaceControl child Surface → SurfaceFlinger Layer/HWC composition → retained-plane presentation → capture inclusion。
- **哪個節點最淺**：`PlanePresentedGroupMembership`；目前有 transaction membership + global present fence，但沒有 per-plane present fence。
- **哪個概念仍只是名詞**：`IndividuallyPresentedPlaneWitness`。
- **哪個系統值得讀原始碼**：AOSP SurfaceFlinger Layer/BufferStateLayer + HWC2 composition/present fence pipeline。
- **哪篇論文需追引用**：Interactive Reward Agent，因為它把 postcondition verification 明確建模為主動取得跨介面 evidence，而非 screenshot judge。
- **哪個概念最適合視覺模擬**：Surface Buffer Lifetime × Presentation Fence Oscilloscope。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + Active Perception + Render/Plane Provenance DAG + Environment-State Verifier + Risk-Adaptive Action Gate`。

## 本輪可信度標記
- **官方資訊**：Android NDK TransactionStats / SurfaceStats / present & previous-release fence semantics。
- **工程實作已確認**：Chromium per-surface release-fence extraction、resource map matching、SetReadFence、transaction-global presentation callback。
- **合理推論/工程模型**：`SurfaceBufferRef`、`PlanePresentedGroupMembership`、evidence strength taxonomy。
- **尚未驗證假說**：可從公開 SurfaceFlinger/HWC tracing 建立穩定 `SurfaceControlSurface → physical HWC plane → capture` causal identity。
