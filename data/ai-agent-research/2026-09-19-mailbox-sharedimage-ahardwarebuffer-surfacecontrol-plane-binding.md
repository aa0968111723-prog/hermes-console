# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 01:54（Asia/Taipei）

主題：Mailbox → SharedImage → AHardwareBuffer → SurfaceControl Plane Binding

## 本小時新發現

本輪延續上一輪 `OverlayCandidate → ScheduledPlaneWitness → PlatformBufferWitness`，不再追 `tracking_id`，而直接追 Chromium 真正把 overlay content 送到 platform presenter 的資料路徑。核心結果：在 BufferQueue/Ozone 類路徑中，`OverlayCandidate` 的 `mailbox` 會進入 `SkiaOutputDeviceBufferQueue::ScheduleOverlays()`，經 `SharedImageRepresentationFactory::ProduceOverlay(mailbox)` 取得 `OverlayImageRepresentation` 與 `ScopedReadAccess`，再交給 `OutputPresenter::ScheduleOverlayPlane()`；Android SurfaceControl 路徑最終在 `GLSurfaceEGLSurfaceControl::ScheduleOverlayPlane()` 取得 `AHardwareBuffer*`，將該 buffer 綁到一個 child `SurfaceControl::Surface` 的 pending transaction，並同時設定 z-order、visibility、crop/geometry/fence 等 plane semantics。

這使上一輪最淺的 `ScheduledPlaneWitness` 第一次有了具體 runtime bridge：

```text
OverlayCandidate
→ mailbox
→ OverlayImageRepresentation
→ ScopedReadAccess
→ OutputPresenter::ScheduleOverlayPlane
→ OverlayImage
→ AHardwareBuffer
→ SurfaceControl child Surface
→ pending SurfaceControl Transaction
→ SetBuffer / SetZOrder / SetVisibility / crop
→ Apply
→ PresentFence / PresentationFeedback
```

但本輪同時確認：`mailbox` 仍不是 buffer-generation ID。Chromium 會重用同一 mailbox 的 OverlayData/SharedImage representation；Android SurfaceControl 也可能在同一 child Surface 上換入新的 AHardwareBuffer。因此 Hermes 需要把 `SharedImageIdentity`、`ReadAccessEpoch`、`AHardwareBufferIdentity`、`SurfaceControlSurfaceIdentity` 與 `TransactionEpoch` 分層保存。

## 本小時最重要 5 個發現

### 1. Overlay mailbox 已能跨過 Viz → GPU SharedImage boundary

**已確認工程事實**：`SkiaRenderer` 在 scheduling overlays 前，會鎖住 overlay resource、取得 sync token，並把 resource 對應的 GPU mailbox 寫入 overlay；`SkiaOutputDeviceBufferQueue::ScheduleOverlays()` 再用 mailbox 取得或重用 `OverlayImageRepresentation`。

```text
resource_id
→ resource lock
→ sync token
→ mailbox
→ ProduceOverlay(mailbox)
→ OverlayImageRepresentation
→ ScopedReadAccess
```

這比 `tracking_id` 強，因為 mailbox 真正參與 content backing 的取得；但 mailbox 可重用，所以它仍不能單獨表示「這一幀的 buffer generation」。

來源：Chromium `components/viz/service/display/skia_renderer.cc`; `components/viz/service/display_embedder/skia_output_device_buffer_queue.cc`。

### 2. `ScheduleOverlays()` 真正把 mailbox-backed content 交給 platform presenter

**已確認工程事實**：BufferQueue 的 `ScheduleOverlays()` 對每個 overlay 取 mailbox，建立/重用 OverlayData，保存 pending overlay mailboxes，然後呼叫 `presenter_->ScheduleOverlayPlane(overlay, access)`。之後 `Present()` 才呼叫 presenter 的 Present，並交換 pending/committed mailbox sets。

```text
OverlayList
→ ScheduleOverlayPlane(...)
→ pending_overlay_mailboxes
→ Present(frame)
→ committed_overlay_mailboxes
→ swap completion
→ release / reuse
```

這說明「scheduled」與「presented」必須是不同 evidence state。

### 3. Android SurfaceControl 路徑存在 concrete `AHardwareBuffer → child Surface` binding

**已確認工程事實**：`GLSurfaceEGLSurfaceControl::ScheduleOverlayPlane()` 從 OverlayImage 取得 `AHardwareBuffer*`，選擇/建立 child SurfaceControl Surface，並在 pending transaction 中更新 visibility、z-order 與 buffer。它也保存 `pending_frame_resources_[surface]`，使該 Surface 與當前 scoped buffer resource 在 transaction lifetime 內有具體關係。

```text
OverlayImage
→ AHardwareBuffer B
→ SurfaceControl child S
→ pending_frame_resources[S] = B
→ Transaction.SetBuffer(S, B, fence)
→ Transaction.Apply()
```

這是目前最接近 `ScheduledPlaneWitness → PlatformBufferWitness` 的 causal binding。

來源：Chromium `ui/gl/gl_surface_egl_surface_control.cc`（main）。

### 4. resource lifetime 本身就是 provenance 的一部分

**已確認工程事實**：BufferQueue 會對 overlay backing ref/unref；mailbox 被替換後才釋放上一幀的 reference，release fence 也在 backing 最後不再使用時回寫。SurfaceControl 路徑則把 `pending_frame_resources_` 與 `current_frame_resources_` 在 commit 時交換，並在下一 transaction ack 後釋放前一幀資源。

因此 Hermes 應建模：

```text
MailboxIdentity
+ SharedImageReadAccessEpoch
+ PlatformBufferIdentity
+ SurfaceBindingEpoch
+ TransactionEpoch
+ ReleaseFence
```

而不是 `mailbox == presented buffer`。

### 5. GUI Agent 的可靠性需要 state + active perception + independent verification

**論文結果**：StateAct（Yang et al., 2026）把 program state 作為主 agent grounding，GUI subagent 只處理需要 pixels 的子任務，並以 independent finish gate 驗證輸出；OSWorld 2.0 上 binary success 由 20.6% 提升至 26.9%，partial success 由 54.8% 提升至 61.6%。GUI-Eyes（Chen et al., 2026）則讓 agent 主動決定是否及如何 crop/zoom，在 ScreenSpot-Pro 報告 44.8% grounding accuracy。Visual Confused Deputy（Liu et al., 2026）指出 GUI perception error / screenshot manipulation / TOCTOU 可把 agent 變成 confused deputy，並主張在 perceptual loop 外做 independent verification。

這三者與 Hermes 目前的 runtime 模型一致：pixel provenance 不是為了做 compositor debug，而是要決定 observation 可以授權多高風險的 action。

## Architecture Breakdown

本輪 system architecture：Chromium Overlay Scheduling → SharedImage → Android SurfaceControl。

```text
SurfaceFrameGeneration
→ AggregatedDrawQuad
→ OverlayCandidate
→ Overlay Strategy Success
→ SkiaRenderer OverlayList
   ├ resource_id
   ├ mailbox
   ├ display_rect / uv
   ├ z_order
   └ sync token
→ SkiaOutputDeviceBufferQueue::ScheduleOverlays
→ ProduceOverlay(mailbox)
→ OverlayImageRepresentation
→ ScopedReadAccess
→ OutputPresenter::ScheduleOverlayPlane
→ GLSurfaceEGLSurfaceControl::ScheduleOverlayPlane
→ AHardwareBuffer
→ child SurfaceControl Surface
→ pending_frame_resources
→ SurfaceControl Transaction
   ├ SetBuffer
   ├ SetVisibility
   ├ SetZOrder
   ├ SetGeometry / crop
   └ fence
→ Apply
→ transaction ACK / latch / present fence
→ PresentationFeedback
```

### 關鍵 identity domains

```text
Viz domain:       resource_id, mailbox
GPU domain:       SharedImage representation/read access
Buffer domain:    AHardwareBuffer*
Plane domain:     SurfaceControl child Surface
Commit domain:    SurfaceControl Transaction / ack epoch
Display domain:   VSyncId / present fence
Capture domain:   CaptureObservation
```

**合理工程推論**：Hermes 應建立 edge bundle，而不是 global ID：

```text
ResourceToPlatformBufferWitness {
  source_generation,
  aggregated_quad_lineage,
  mailbox,
  shared_image_access_epoch,
  hardware_buffer_identity,
  surface_control_surface,
  transaction_epoch,
  acquire_fence,
  release_fence,
  geometry,
  z_order,
  presentation_witness
}
```

`shared_image_access_epoch` / `transaction_epoch` 是 Hermes sidecar，並非宣稱 Chromium 已提供同名 invariant。

## Bottom-Level Logic

本輪 bottom-level mechanism：**buffer ownership + synchronization + plane binding**。

```text
GPU producer writes SharedImage
→ SyncToken / acquire synchronization
→ Overlay ScopedReadAccess
→ obtain platform OverlayImage
→ AHardwareBuffer becomes readable by compositor
→ bind buffer to SurfaceControl child Surface
→ set crop / transform / z-order
→ apply transaction
→ compositor latches buffer
→ present fence signals
→ old buffer eventually receives release semantics
→ backing becomes reusable
```

因此：

```text
Same Mailbox
≠ Same Buffer Generation

Same SurfaceControl Surface
≠ Same Content Generation

ScheduledPlane
≠ PresentedPlane

PresentedPlane
≠ CapturedPlane
```

### 新 evidence state machine

```text
CANDIDATE
→ RESOURCE_BOUND
→ SHARED_IMAGE_ACCESSED
→ PLATFORM_BUFFER_BOUND
→ SURFACE_BOUND
→ TRANSACTION_BOUND
→ LATCHED
→ PRESENTED
→ RELEASED
```

任何一步缺 witness，都不能把下一層當作已確認事實。

## Visual Simulation Idea

### SharedImage → SurfaceControl Plane Lifetime Microscope

Hermes Console 可新增可互動時間軸：

```text
Frame F471
  ↓
Quad Q17
  ↓
Mailbox M8 ────────┐
  ↓                │ reuse
ReadAccess E31     │
  ↓                │
AHB B22            │
  ↓                │
Surface SC-2       │
  ↓                │
TX 91              │
  ↓                │
PresentFence P91   │
                   │
Frame F472         │
  ↓                │
Mailbox M8 ────────┘
  ↓
ReadAccess E32
  ↓
AHB B23
  ↓
Surface SC-2
  ↓
TX 92
```

注入：mailbox reuse、same AHardwareBuffer reuse、child Surface reuse、late acquire fence、release fence delay、transaction queue、overlay disappears、protected buffer、capture between TX91/TX92。UI 每條 edge 顯示 `CAUSAL / RESOURCE-BOUND / SURFACE-BOUND / TRANSACTION-BOUND / PRESENTED / UNKNOWN / BROKEN`。

## Code / GitHub

### Chromium 值得看的核心檔案

1. `components/viz/service/display/skia_renderer.cc`
   - resource lock、sync token、mailbox 寫入 overlay。
2. `components/viz/service/display_embedder/skia_output_device_buffer_queue.cc`
   - `GetOrCreateOverlayData()`
   - `ScheduleOverlays()`
   - `Present()`
   - overlay mailbox ref/release lifecycle。
3. `components/viz/service/display_embedder/output_presenter.h`
   - platform presenter abstraction；下一輪需深入。
4. `ui/gl/gl_surface_egl_surface_control.cc`
   - `ScheduleOverlayPlane()`
   - `CommitPendingTransaction()`
   - AHardwareBuffer / SurfaceControl transaction / resource lifetime。
5. `ui/gfx/android/surface_control.*`
   - NDK transaction wrapper、SetBuffer、OnComplete、present fence extraction。
6. Windows 對照：`components/viz/service/display_embedder/skia_output_device_dcomp.cc`
   - mailbox → DCLayerOverlayImage → DComp scheduling。

## Papers

### StateAct: Program State, before Pixels, for Long-Horizon Computer-Use Agents
- Authors: Yan Yang et al.
- Institution: NVIDIA / collaborators（依論文作者 affiliation 為準）
- Year: 2026
- URL: https://arxiv.org/abs/2607.22798
- Architecture: code-first main agent + GUI subagent + fresh subagents + independent finish gate
- Dataset/Benchmark: OSWorld 2.0
- Contribution: 把 program state 放在 screenshot 之前作為主要 grounding/verification substrate。
- Limitations: 需要可存取 underlying program state；無法取代所有 GUI-only interaction。
- 改變了什麼：將 computer-use bottleneck 從純 perception 問題改寫成 state-grounded reasoning + verification 問題。

### GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents
- Authors: Chen Chen, Jiawei Shao, Dakuan Lu, Haoyi Hu, Xiangcheng Liu, Hantao Yao, Wu Liu
- Year: 2026
- URL: https://arxiv.org/abs/2601.09770
- Architecture: two-stage active perception policy，主動 crop/zoom。
- Benchmark: ScreenSpot-Pro
- Contribution: 讓 agent 學會何時以及如何取得更細 observation。
- Limitation: grounding accuracy 仍不足以單獨提供高風險 action authorization。

### Visual Confused Deputy: Exploiting and Defending Perception Failures in Computer-Using Agents
- Authors: Xunzhuo Liu, Bowei He, Xue Liu, Andy Luo, Haichen Zhang, Huamin Chen
- Year: 2026
- URL: https://arxiv.org/abs/2603.14707
- Architecture: dual-channel contrastive guardrail outside agent perceptual loop
- Contribution: 將 grounding error、screen manipulation、TOCTOU 明確提升為 security / authorization 問題。
- Limitation: guardrail 仍依賴 deployment knowledge 與 classifier coverage。

## 已確認 / 推論 / 未驗證邊界

**已確認**：mailbox → ProduceOverlay → ScopedReadAccess → ScheduleOverlayPlane；Android SurfaceControl path 可取得 AHardwareBuffer 並綁 child Surface；pending/current resource sets 跟 transaction lifetime 一起管理；present 與 release lifecycle 分離。

**合理推論**：Hermes 可以用 `(mailbox, access_epoch, AHB identity, Surface identity, transaction epoch)` 建立比 tracking_id 強很多的 plane provenance witness。

**尚未驗證**：AHardwareBuffer pointer/handle 在所有 backing/reuse path 是否足以當穩定 generation identity；OutputPresenter 的 Android implementation 是否還有額外 buffer wrapping/identity translation；platform presentation feedback 是否能直接回指某個 child plane buffer，而非只代表整個 transaction/display frame。

## Unknown / Open Questions 1-3

1. `OutputPresenter::ScheduleOverlayPlane()` 到 Android `GLSurfaceEGLSurfaceControl::ScheduleOverlayPlane()` 中間是否保存可觀測、可持久化的 per-plane identity？
2. AHardwareBuffer 在 buffer pool/reuse 下，Hermes 應以什麼 generation witness 區分「同一 handle、不同內容 epoch」？acquire fence、read-access epoch、transaction epoch 是否足夠？
3. SurfaceControl transaction 的 present fence 是 transaction/display-level witness；如何證明其中某一 child Surface 的特定 AHardwareBuffer 真正參與該次 present，而非被替換、drop 或未 latch？

## 下一輪研究

直接追：

```text
OutputPresenter::ScheduleOverlayPlane
→ Android OutputPresenter implementation
→ ScopedOverlayAccess / OverlayImage
→ GLSurface ScheduleOverlayPlane
→ SurfaceControl::Transaction::SetBuffer
→ transaction stats / surface stats
→ per-surface release fence / present evidence
```

並與 Windows：

```text
mailbox
→ DCLayerOverlayImage
→ DCLayerOverlayParams
→ DCompPresenter
→ DirectComposition visual/content
→ Commit / presentation statistics
```

做 identity-strength 對照，確認哪些 witness 是跨平台共通、哪些只能平台特化。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `SharedImageOverlayRepresentation`
- `SharedImageReadAccessEpoch`
- `OverlayMailboxLifetime`
- `AHardwareBufferWitness`
- `SurfaceControlChildSurface`
- `SurfaceBindingEpoch`
- `PlatformBufferBindingWitness`
- `OverlayResourceLifetime`
- `AcquireSynchronizationWitness`
- `ReleaseSynchronizationWitness`
- `TransactionResourceSet`

### Edges
```text
OverlayCandidate --BACKED_BY--> Mailbox
Mailbox --PRODUCES_ACCESS_TO--> SharedImageOverlayRepresentation
SharedImageOverlayRepresentation --EXPOSES--> PlatformOverlayImage
PlatformOverlayImage --CONTAINS--> AHardwareBufferWitness
AHardwareBufferWitness --BOUND_TO--> SurfaceControlChildSurface
SurfaceControlChildSurface --UPDATED_BY--> SurfaceControlTransaction
SurfaceControlTransaction --PRESENTS_AS_GROUP--> PlatformPresentationWitness
PlatformPresentationWitness --RELEASES_PREVIOUS--> OverlayResourceLifetime
```

## 本輪結束判斷

- **缺哪一層**：per-child-Surface / per-AHardwareBuffer 的 latch/present proof，以及 presented plane → capture inclusion。
- **哪個節點最淺**：`PlatformBufferBindingWitness` 已有實作支撐，但 `PerPlanePresentationWitness` 仍最淺。
- **哪個概念仍只是名詞**：`StablePlatformBufferGenerationIdentity`。
- **哪個系統值得讀原始碼**：Android `OutputPresenter + GLSurfaceEGLSurfaceControl + gfx::SurfaceControl::Transaction`，並以 Windows DComp 對照。
- **哪篇論文需追引用**：Visual Confused Deputy，因為它直接把 perception provenance 與 action authorization / TOCTOU 接在一起。
- **哪個概念最適合視覺模擬**：SharedImage → AHardwareBuffer → SurfaceControl Plane Lifetime Microscope。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + Active Perception + Render/Plane Provenance DAG + Independent Transition Verifier + Risk-Adaptive Action Gate`。

## 對「AI 到底怎麼運作」的新增還原

```text
使用者一句話
→ UI
→ Agent Runtime
→ Context / Memory
→ Model Reasoning
→ Planning
→ Computer Intent
→ Browser State
→ Renderer / CompositorFrame
→ Surface Generation
→ Aggregated Quad
→ Overlay Candidate
→ GPU Mailbox / SharedImage
→ AHardwareBuffer
→ SurfaceControl Plane
→ OS Transaction
→ Present Fence
→ Capture Boundary
→ Pixels
→ Vision Encoder
→ Visual Tokens
→ Multimodal Fusion
→ Reasoning
→ Evidence-aware Action Gate
→ Action
→ Transition Verification
→ Output
```

本輪最大的進展：Hermes 已從「overlay strategy 選中了哪個 candidate」跨進真正的 GPU/platform resource boundary，找到 `mailbox → SharedImage representation → AHardwareBuffer → SurfaceControl child Surface → transaction` 的具體 implementation chain。下一個真正的硬問題不再是 scheduled plane 在哪裡，而是如何證明**某個 child Surface 上的某一代 AHardwareBuffer，確實被該次 transaction latch/present，且 Agent 的 capture 又確實包含那個 plane**。

## Sources
- Chromium SkiaOutputDeviceBufferQueue: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/viz/service/display_embedder/skia_output_device_buffer_queue.cc
- Chromium GLSurfaceEGLSurfaceControl: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/gl/gl_surface_egl_surface_control.cc
- Chromium SkiaRenderer: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/viz/service/display/skia_renderer.cc
- Chromium SkiaOutputDeviceDComp: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/viz/service/display_embedder/skia_output_device_dcomp.cc
- StateAct: https://arxiv.org/abs/2607.22798
- GUI-Eyes: https://arxiv.org/abs/2601.09770
- Visual Confused Deputy: https://arxiv.org/abs/2603.14707
