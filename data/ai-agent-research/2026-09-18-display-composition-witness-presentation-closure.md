# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-18 13:53 Asia/Taipei

## 本小時新發現

本輪承接上一輪 `Visual Contribution Closure × Overlay Provenance × Capture Perturbation`，不重複 Surface/Quad/Filter/Overlay candidate，而是追下一層：**Viz 已經選出 root render pass + overlay candidates 後，什麼證據能證明「這組 plane 確實成為使用者螢幕上的 presented composition」？**

核心結論：Chromium 的 Display Compositor 明確把 aggregation/rendering 與平台 presentation 分層。`DirectRenderer` 先產生 output-surface plane 與 overlay list；`SkiaRenderer::FinishDrawingFrame()` 排程 overlays；`SkiaRenderer::SwapBuffers()` 把 `seq` 與 `swap_trace_id` 寫進 `OutputSurfaceFrame` 後交給 `SkiaOutputSurface`；Display 再以 swap acknowledgement 與 presentation feedback 完成 timing closure。這提供了建立 `DisplayCompositionWitness` 的原生證據鏈，但目前仍不能從公開 screenshot API 證明 screenshot bytes 與正常 presentation 的完整 plane set 完全相同。

主要來源：
- Chromium Display Compositor README: https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/display/
- Chromium `direct_renderer.cc`: https://github.com/chromium/chromium/blob/main/components/viz/service/display/direct_renderer.cc
- Chromium `skia_renderer.cc`: https://github.com/chromium/chromium/blob/main/components/viz/service/display/skia_renderer.cc
- Chromium `skia_output_device.h`: https://chromium.googlesource.com/chromium/src/+/main/components/viz/service/display_embedder/skia_output_device.h
- Chromium `display.cc`: https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/display/display.cc
- Temporal UI State Inconsistency: https://arxiv.org/abs/2604.18860
- StateAct: https://arxiv.org/abs/2607.22798
- ASIL: https://arxiv.org/abs/2608.26991
- PriMobiBench: https://arxiv.org/abs/2609.13873

---

## 本小時最重要 5 個發現

### 1. Display composition 是 render output + plane schedule，不是單一 framebuffer
**已確認／Chromium 官方架構與原始碼。** Display Compositor 把來自 frame sinks 的內容組合後交給 platform-specific OutputSurface。`DirectRenderer` 在 draw frame 期間呼叫 OverlayProcessor，得到 `output_surface_plane` 與 `overlay_list`。因此最終 composition 應建模為：

`AggregatedRenderPasses → PrimaryPlane + OverlayPlanes/Underlays → OutputSurface → Swap → Presentation`

而不是 `RootFramebuffer → Screen`。

限制：不同平台（Windows DComp、Ozone/Wayland、macOS CoreAnimation、Android SurfaceControl）有不同 plane semantics，不能假設一套 plane API 覆蓋全部平台。

### 2. Overlay scheduling 與 SwapBuffers 有明確的同-frame execution boundary
**已確認／Chromium 原始碼。** `SkiaRenderer::FinishDrawingFrame()` 會 `ScheduleOverlays()`；`SkiaRenderer::SwapBuffers()` 建立 `OutputSurfaceFrame`，帶入 frame `seq` 與 `swap_trace_id`，最後呼叫 `skia_output_surface_->SwapBuffers()`。`SkiaOutputDevice` 文件則明確說 scheduled primary plane / overlays 會在 SwapBuffers/PostSubBuffer 時上屏。

因此 Hermes 可以新增：

`PlaneScheduleWitness → SwapTraceId → SwapAck → PresentationFeedback`

這比只保存 overlay candidate list 強，因為 candidate 只是「可被提升」，scheduled plane 才進入 presentation path。

### 3. Swap acknowledgement != presentation；PresentationFeedback 才是更強的顯示證據
**已確認／Chromium 原始碼。** `Display::DidReceiveSwapBuffersAck()` 與 presentation feedback 是分開處理；Display 使用 `swap_trace_id` 把正確的 swap timing group 對回 acknowledgement，之後 `PresentationGroupTiming::OnPresent()` 再把 `gfx::PresentationFeedback` 傳給 helpers。

因此 proof ladder 應拆成：

`COMPOSED → SCHEDULED → SWAPPED → ACKED → PRESENTED`

不能把 `SwapBuffers()` 呼叫成功等同「使用者真的看到了這一幀」。

### 4. Overlay resource lifetime 提供「presentation-associated resource」證據，但不是 pixel-equivalence proof
**已確認／Chromium 原始碼。** `SkiaRenderer::SwapBuffersComplete()` 會根據 swap result 管理 pending/committed overlay locks；未 present 的 swap 會立即釋放 pending overlay locks，而成功路徑把 pending locks 轉為 committed，部分平台還要等待 release/presentation 相關訊號。這說明 Chromium runtime 確實把 overlay resource lifetime 與 presentation lifecycle 綁定。

但限制是：resource lifetime 只能證明 plane/resource 參與 presentation path，不能直接證明 screenshot capture 的每個 pixel 與正常 display composition 相同。

### 5. Agent 的 observation/action security 必須把 display provenance 與 semantic provenance 分開
**論文結果 + 工程推論。** Temporal UI State Inconsistency 顯示 screenshot→action gap 可形成 TOCTOU；StateAct/ASIL 顯示 structured/program state 能顯著減少 screenshot-only 的脆弱性；PriMobiBench 又顯示 screenshot stream 本身會暴露大量 task-irrelevant private visual evidence。這三者合起來支持 Hermes 的新原則：

`SemanticStateProof` 與 `DisplayCompositionProof` 必須並行，而不是互相替代。

高風險 GUI action 應要求：

`Target semantic identity + fresh structured state + target-region presented-plane provenance + pre-action freshness check`。

---

## Architecture Breakdown

```text
Program / DOM / AX
      ↓
Semantic Target
      ↓
Surface Aggregation Closure
      ↓
Aggregated Render Passes
      ↓
Visual Contribution Graph
      ↓
OverlayProcessor
  ├─ OutputSurface primary plane
  ├─ Overlay candidates
  ├─ Underlays
  └─ traditionally composited quads
      ↓
SkiaRenderer::FinishDrawingFrame
      ↓
ScheduleOverlays
      ↓
PlaneScheduleWitness
      ↓
SkiaRenderer::SwapBuffers
  ├─ frame seq
  └─ swap_trace_id
      ↓
SkiaOutputSurface / SkiaOutputDevice
      ↓
Platform compositor
      ↓
Swap ACK
      ↓
PresentationFeedback
      ↓
DisplayCompositionWitness
      ↓
TargetRegionPresentedWitness
      ↓
RegionActionProof
      ↓
ALLOW / RECAPTURE / BLOCK
```

### 與上一輪的差異
上一輪停在：
`Overlay candidate → DisplayCompositionGraph`。

本輪補上：
`DisplayCompositionGraph → scheduled plane set → swap identity → acknowledgement → presentation feedback`。

也就是從「這些 plane 理論上構成畫面」推進到「這些 plane 是否真的進入 presentation lifecycle」。

---

## Bottom-Level Logic

### A. Plane scheduling

```text
RenderPasses
→ OverlayProcessor::ProcessForOverlays(...)
→ current_frame.output_surface_plane
→ current_frame.overlay_list
→ FinishDrawingFrame()
→ ScheduleOverlays()
```

`overlay_handled=true` 仍只是 processor/validator decision；真正的 runtime evidence 必須至少看到 scheduling。

### B. Swap identity

```text
SwapFrameData
→ OutputSurfaceFrame
   seq = swap_frame_data.seq
   swap_trace_id = swap_frame_data.swap_trace_id
→ SkiaOutputSurface::SwapBuffers
```

Hermes 應保存 `swap_trace_id`，因為 Display 會用它對齊 swap completion timing group。

### C. Presentation closure

```text
PlaneSchedule
→ SwapBuffers
→ DidReceiveSwapBuffersAck(params.swap_trace_id)
→ matching PresentationGroupTiming
→ DidReceivePresentationFeedback
→ PresentationGroupTiming::OnPresent(feedback)
→ PRESENTED witness
```

### D. 新 invariant

```text
CandidateOverlay(q)
≠ ScheduledOverlay(q)
≠ SwapAccepted(q)
≠ PresentedOverlay(q)
```

以及：

```text
ScreenshotCaptured(frame)
≠ ProvenSameCompositionAsNormalPresentation(frame)
```

除非能取得 capture mode、plane schedule 與 presented frame 的額外 binding。

---

## Visual Simulation Idea

### Display Composition & Presentation Closure Microscope

```text
AGGREGATED FRAME
Root RP  ──────────────────────────────┐
Overlay A ────────────────┐            │
Underlay B ───────────┐   │            │
                     ▼   ▼            ▼
PLANE SCHEDULE      [B] [ROOT] [A]
                         │
                    swap_trace_id=991
                         │
                    SwapBuffers
                         │
                  ACK ───┼─── PRESENT
                         │        ✓
                         ▼
               DisplayCompositionWitness
```

互動控制：
- overlay promotion on/off
- copy/screenshot request
- underlay
- swap skipped / failed / recreate buffers
- delayed presentation feedback
- platform mode: DComp / Ozone / CoreAnimation / SurfaceControl
- partial swap
- overlay resource released before/after presentation
- action delay

Console 顯示：
- Candidate Plane Set
- Scheduled Plane Set
- swap_trace_id
- Swap ACK state
- PresentationFeedback state
- Plane Resource Lifetime
- Capture Perturbation
- Target Region Plane Provenance
- Semantic Freshness
- Action Verdict

---

## Code / GitHub

### Chromium 值得繼續讀的目錄/檔案
1. `components/viz/service/display/direct_renderer.cc`
   - `OverlayProcessor::ProcessForOverlays`
   - output-surface primary plane
   - overlay list / damage
2. `components/viz/service/display/skia_renderer.cc`
   - `FinishDrawingFrame`
   - `ScheduleOverlays`
   - `SwapBuffers`
   - `SwapBuffersComplete`
   - `BuffersPresented`
3. `components/viz/service/display/display.cc`
   - `DrawAndSwap`
   - `DidReceiveSwapBuffersAck`
   - presentation feedback routing
4. `components/viz/service/display_embedder/skia_output_device.h`
   - `SchedulePrimaryPlane`
   - `ScheduleOverlays`
   - platform output device contract
5. 下一輪：
   - `skia_output_device_buffer_queue.*`
   - platform-specific DComp/Ozone/SurfaceControl output devices
   - `OutputSurfaceFrame` / swap trace propagation

---

## Papers

### Temporal UI State Inconsistency in Desktop GUI Agents
- Author: Wenpeng Xu
- Year: 2026
- URL: https://arxiv.org/abs/2604.18860
- Architecture: screenshot observation → reasoning delay → action; pre-execution UI verification
- Contribution: formalizes visual TOCTOU and reports mean 6.51s observation-to-action gap on OSWorld workloads.
- Limitation: pixel/window verification has a structural blind spot for zero-visual-footprint DOM mutation.
- 改變了什麼：證明 GUI action gate 必須在 execution 前重新驗證，而不是只信 reasoning 起點的 screenshot。

### StateAct: Program State, before Pixels, for Long-Horizon Computer-Use Agents
- Authors: Yan Yang et al.
- Year: 2026
- URL: https://arxiv.org/abs/2607.22798
- Architecture: code/state-grounded main agent + GUI specialist + finish gate
- Dataset/Benchmark: OSWorld 2.0
- Contribution: binary 20.6→26.9%，partial 54.8→61.6%；code-only partial 45.9%，顯示 hybrid 比單一路徑更合理。
- Limitation: program-state access不是所有 app/GUI 都完整可得。
- 改變了什麼：把 screenshot 從 canonical truth 降為必要時的 perceptual channel。

### ASIL: Replacing Screenshot-and-Click with Structured State and Semantic Actions
- Authors: Rui Xie, Lu Chen
- Year: 2026
- URL: https://arxiv.org/abs/2608.26991
- Dataset: 15 apps；300 single-app + 80 multi-app tasks
- Architecture: structured JSON observations + semantic executable actions
- Contribution: closed models >80 strict performance；screenshot-click matched control 明顯較低。
- Limitation: deepest feasible access path 因 application 而異；opaque visual semantics 仍需 rendering channel。
- 改變了什麼：支持 Hermes 把 semantic state proof 與 display proof 分層。

### PriMobiBench: Characterizing Visual Privacy Leakage in VLM-Driven Mobile GUI Agents
- Authors: Qihang Cen et al.
- Year: 2026
- URL: https://arxiv.org/abs/2609.13873
- Dataset: MobiLeak，16 apps，25 privacy attributes，2,960 privacy instances
- Contribution: sensitive extraction up to 82.5%，visual profile inference 約 70%；mask task-irrelevant sensitive UI 可降低 profiling up to 58%，約 8% performance loss。
- Limitation: mobile screenshot workflows，不能直接等同 desktop/browser composition。
- 改變了什麼：display provenance 不只 correctness，也應支持 region-level privacy minimization。

---

## Unknown / Open Questions

1. `PresentationFeedback` 能否在不修改 Chromium 的情況下，可靠綁定到完整 `ScheduledPlaneSet`，尤其 platform-specific overlays/underlays？
2. screenshot/CopyOutput 在各平台是否包含 overlay plane pixels，還是會 force composition / block promotion / 走不同 readback path？如何建立 `CapturePixelEquivalence` 的 platform-specific witness？
3. target region 若跨 primary plane 與 overlay plane boundary，能否從 Viz tracing 重建 `PresentedPlaneSet(region)`，而不需要 GPU/display-driver instrumentation？

---

## 下一輪研究

直接追：

```text
SkiaRenderer::ScheduleOverlays
→ SkiaOutputSurface
→ SkiaOutputDevice::ScheduleOverlays
→ platform output device
→ SwapBuffers
→ swap_trace_id
→ PresentationFeedback
→ released overlays
```

並比較 Windows DComp、Ozone/Wayland、Android SurfaceControl、macOS CoreAnimation，建立 `PlatformPresentationAdapter`。

下一輪核心問題：

```text
Scheduled Plane Set
→ Platform Composition
→ Presented Plane Set
→ Screenshot / CopyOutput

這四者在不同 OS 上到底何時相等、何時不相等？
```

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `DisplayCompositionWitness`
- `PlaneScheduleWitness`
- `ScheduledPlaneSet`
- `PresentedPlaneSet`
- `SwapTraceId`
- `SwapAcknowledgement`
- `PresentationClosure`
- `PresentationFeedbackWitness`
- `OverlayResourceLifetimeWitness`
- `TargetRegionPresentedWitness`
- `PlatformPresentationAdapter`
- `CapturePresentationDivergence`
- `SemanticDisplayDualProof`

### Edges
- `VisualContributionGraph -> produces -> ScheduledPlaneSet`
- `ScheduledPlaneSet -> scheduled_at -> SwapTraceId`
- `SwapTraceId -> acknowledged_by -> SwapAcknowledgement`
- `SwapTraceId -> presented_by -> PresentationFeedbackWitness`
- `ScheduledPlaneSet -> bounded_by -> OverlayResourceLifetimeWitness`
- `PresentationFeedbackWitness -> closes -> PresentationClosure`
- `PresentedPlaneSet -> supports -> TargetRegionPresentedWitness`
- `SemanticStateProof + TargetRegionPresentedWitness -> authorize -> RegionActionProof`
- `CopyOutputRequest -> may_cause -> CapturePresentationDivergence`

---

## 本輪結束檢查

- **缺哪一層：** platform compositor 的實際 plane commit/present identity，尤其 DComp/Ozone/SurfaceControl/CoreAnimation。
- **哪個節點最淺：** `PresentedPlaneSet`；目前有 scheduling + swap + presentation feedback，但還沒有跨平台完整 plane-set readback。
- **哪個概念仍只是名詞：** `CapturePixelEquivalence`，不能因 screenshot 看起來一樣就宣稱成立。
- **哪個系統值得讀原始碼：** Chromium platform-specific SkiaOutputDevice / OutputSurface implementations。
- **哪篇論文需追引用：** Temporal UI State Inconsistency，因它直接把 perception/action gap 形式化成 security boundary；StateAct/ASIL 則需追 structured-state verification 的後續工作。
- **哪個概念最適合視覺模擬：** `ScheduledPlaneSet → Swap → PresentedPlaneSet → TargetRegionPresentedWitness`。
- **哪個 Agent 架構最值得實作：** `State-grounded Computer Agent + Browser/GUI perceptual specialist + Display Provenance Gate + Pre-action freshness verification`。

---

## 還原「AI 到底怎麼運作」新增鏈

```text
使用者一句話
→ UI
→ Agent Runtime
→ Context / Memory
→ Model Reasoning
→ Planning
→ Semantic Target
→ Browser Program State / DOM / AX
→ Surface / RenderPass / Quad
→ Skia Raster / Filter / Blend
→ Overlay Processor
→ Scheduled Plane Set
→ OutputSurface
→ SwapTraceId
→ Platform Compositor
→ PresentationFeedback
→ Presented Display
→ Screenshot / Visual Tokens
→ Multimodal Fusion
→ Reasoning
→ TargetRegionPresentedWitness
→ Pre-action Freshness Gate
→ Computer Action
→ External Effect
→ Read-back / Settlement
→ Output
```

本輪最重要的結論：**「renderer 畫好了」與「使用者真的看到」是兩個不同事件。對可靠 Computer Agent，visual evidence 最終不能停在 screenshot、render pass，甚至不能停在 overlay candidate；Hermes 必須追到 scheduled plane set、swap identity 與 presentation feedback，才能把『模型看到的畫面』逐步提升成『有證據表明這組內容確實進入顯示 presentation lifecycle』。下一步則是跨 OS 證明 presented plane set 與 capture pixels 的關係。**