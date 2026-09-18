# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 05:50（Asia/Taipei）

主題：SurfaceFlinger Capture Snapshot × RenderEngine × Observation Binding

## 本小時新發現

本輪接續上一輪 `ObservablePresentationWitness → CapturePresentationBindingWitness`，專注回答：**Agent 收到的 screenshot 能否被嚴格視為「剛剛 physical display 已呈現 layer set」的像素副本？**

結論：不能直接等同。AOSP SurfaceFlinger 的 `captureDisplay/captureLayers` 不是從 display scanout buffer 或 HWC physical plane 直接回讀；capture path 會取得一組 screenshot layer snapshots，建立 RenderArea，再由 RenderEngine 把這些 LayerFE snapshots 重新渲染到一個獨立 capture GraphicBuffer，最後以 capture render fence 回傳。這建立了一條強的 **logical composition snapshot → capture buffer** causal chain，但不是 `physical-presented framebuffer → capture` 的 byte-identical proof。

因此上一輪的 `CaptureBoundPresentedLayerSet` 必須拆成兩個不同集合：

```text
PresentedLayerFrameSet(t_present)
CaptureSnapshotLayerSet(t_snapshot)
```

兩者可藉由 `(layerId, bufferId, frameNumber)`、snapshot epoch、geometry 與時間窗口 join，但在沒有 capture API 原生輸出 layer-frame membership manifest 前，不能宣稱兩者天然相等。

## 本小時最重要 5 個發現

### 1. captureDisplay/captureLayers 是 snapshot + re-render，不是 scanout readback

**已確認工程實作**：SurfaceFlinger `captureDisplay()` / `captureLayers()` 最終進入 `captureScreenCommon()` / `captureScreenshot()`；capture 先取得 screenshot Layer snapshots，建立 RenderArea，再進 `renderScreenImpl()` 將 layer state 轉換後畫入 capture target buffer。

底層鏈：

```text
capture request
→ CaptureArgs / LayerCaptureArgs
→ RenderArea
→ getLayerSnapshotsForScreenshots()
→ vector<Layer*, LayerFE>
→ captureScreenshot()
→ renderScreenImpl()
→ RenderEngine
→ ExternalTexture / GraphicBuffer
→ FenceResult
→ ScreenCaptureResults
```

重要性：Agent screenshot provenance 的正確問題不是「capture 是否複製 physical framebuffer」，而是「capture snapshot 使用了哪些 logical layer generations，以及這些 generations 是否與最近 presented generations 一致」。

限制：snapshot 與 display presentation 是不同 execution path；不能從 capture 成功直接推出 captured pixels 曾以完全相同 composition branch 出現在 physical display。

### 2. Capture 使用自己的 LayerSnapshot state，因此 capture epoch 必須成為一級 identity

**已確認工程實作**：current SurfaceFlinger screenshot path 透過 `getLayerSnapshotsForScreenshots()` 取得 layer snapshots；`renderScreenImpl()` 使用 LayerFE snapshot 的 visibility、secure/protected、geometry transform、HDR/dataspace 等 state，並依 RenderArea transform 重算 capture-side geometry。

因此 Hermes 應新增：

```text
CaptureSnapshotEpoch {
  capture_id,
  snapshot_time,
  render_area,
  layer_snapshot_membership[],
  output_buffer_id,
  render_fence,
  dataspace
}
```

並避免：

```text
Capture timestamp ≈ Presented frame timestamp
```

這種弱關聯被誤標成 causal proof。

### 3. ScreenCaptureResults 的 fence 證明 capture render 完成，不等於 display present fence

**已確認工程實作**：capture path 回傳 capture buffer 與 `FenceResult`；RenderEngine rendering 完成後 listener 才收到 ScreenCaptureResults。這個 fence 是 capture target 可安全消費的同步 witness。

必須區分：

```text
DisplayPresentFence
≠ CaptureRenderFence
≠ LayerReleaseFence
≠ SourceAcquireFence
```

因此 ObservationEnvelope 應同時保存 `presentation_witness` 與 `capture_render_witness`，而不是只保存一個 generic fence。

### 4. Capture layer membership 可以比 pixel timestamp 更接近 causal binding，但 current public result 不直接輸出完整 manifest

**工程推論（基於已確認 capture pipeline）**：SurfaceFlinger 在 capture 時內部已經持有 `vector<pair<Layer*, LayerFE>>`，也就是 capture rendering 的 layer membership source。若 Hermes 能在 instrumented Android / test runtime 於這一點記錄 `(layerId, bufferId, frameNumber, geometry, z-order)`，即可建立：

```text
CaptureLayerMembershipWitness
→ CaptureRenderInputSet
→ CaptureBuffer
```

再與 FrameTracer 的：

```text
(layerId, bufferId, frameNumber)
→ PRESENT_FENCE
```

做 exact-key join。

但 **尚未驗證假說**：標準非侵入式 ScreenCapture API 是否能直接返回完整 layer-frame membership manifest。目前證據顯示 ScreenCaptureResults 提供 buffer/fence/capture metadata，但不能假設它公開這份 manifest。

### 5. Computer Agent 的安全邊界應從 observation-time 提升到 action-time revalidation

StateAct 證明 screenshot 是 underlying program state 的 lossy rendering，program-state verification 能改善 long-horizon computer use；2026 的 Temporal UI State Inconsistency 研究則量化 screenshot→action TOCTOU gap，並顯示 action dispatch 前重新驗證 UI state 可阻擋多類 race。最新 AgentHijack 進一步顯示 local visual patch 能沿 screenshot→VLM→action parser→environment execution 形成端到端環境影響。

Hermes 因此應採：

```text
ObservationEnvelope
→ Reasoning / Plan
→ PreActionRevalidationEnvelope
→ Compare state/render/capture witnesses
→ Risk gate
→ Action dispatch
```

而不是：

```text
Screenshot
→ long reasoning delay
→ click
```

## Architecture Breakdown

### Capture-Bound Observation Architecture

```text
APP / Chromium
  ↓
SurfaceControl transaction
  ↓
SurfaceFlinger logical Layer
  ├─ layerId
  ├─ bufferId
  └─ frameNumber
  ↓
Latch / composition
  ↓
Display Present Fence
  ↓
ObservablePresentationWitness

parallel capture path:
Capture Request C22
  ↓
CaptureSnapshotEpoch E22
  ↓
getLayerSnapshotsForScreenshots
  ↓
CaptureLayerSnapshotSet
  ↓
RenderArea transform / crop
  ↓
RenderEngine composition
  ↓
Capture GraphicBuffer CB22
  ↓
CaptureRenderFence CF22
  ↓
Pixels
  ↓
Vision Encoder
  ↓
Visual Tokens
  ↓
Observation O118

join path:
PresentedLayerFrameSet
  ↕ exact-key / temporal / geometry join
CaptureLayerSnapshotSet
  ↓
CapturePresentationBindingWitness
```

### Evidence strength

```text
EXACT_LAYER_FRAME_JOIN
(layerId, bufferId, frameNumber captured + presented)
>
LAYER_FRAME_TEMPORAL_JOIN
>
GEOMETRY_AND_TIME_CORRELATION
>
SCREENSHOT_TIMESTAMP_ONLY
```

Capture 仍可能重繪與 physical presentation 不同的 composition branch，因此即使 exact layer-frame join 成功，也應標記為：

```text
SAME_LOGICAL_LAYER_GENERATION
```

而不是：

```text
BYTE_IDENTICAL_PHYSICAL_SCANOUT
```

## Bottom-Level Logic

### Capture pipeline

```text
CaptureIntent
→ Permission Validation
→ CaptureArgs
→ RenderArea Selection
→ Snapshot Selection
→ Visibility/Security Filtering
→ LayerFE Snapshot Set
→ Geometry Transform
→ Dataspace/HDR Decision
→ RenderEngine Draw
→ Capture Buffer
→ Render Fence
→ Consumer Read
→ Image preprocessing
→ Vision Encoder
→ Visual Tokens
```

### Proposed ObservationEnvelope v2

```text
ObservationEnvelope {
  observation_id,
  capture_request_id,
  capture_snapshot_epoch,
  capture_buffer_witness,
  capture_render_fence,
  capture_layer_membership[],
  nearest_presented_layer_frames[],
  presentation_binding_edges[],
  program_state_witness,
  visual_embedding,
  observation_time,
  confidence
}
```

### Pre-action atomicity

```text
Observation O118
→ Plan P118
→ intended target T
→ acquire PreActionRevalidationEnvelope R119
→ verify target state + layer generation + visual region
→ unchanged? execute
→ changed? block / re-ground / replan
```

這把 OS compositor provenance 與 Agent TOCTOU defense 接成同一條 runtime architecture。

## Visual Simulation Idea

### Presented-vs-Captured Layer Set Diff Explorer

雙時間軸：

```text
PRESENTED
L1 B41 F471 ───── PRESENT@t1
L2 B88 F203 ───── PRESENT@t1

CAPTURE SNAPSHOT
L1 B41 F471 ───── SNAPSHOT@t1+3ms
L2 B89 F204 ───── SNAPSHOT@t1+3ms   ← generation changed

CAPTURE RENDER
CB22 ──────────── FENCE@t1+7ms

AGENT
O118 ──────────── ENCODE@t1+12ms
A119 ──────────── CLICK@t1+6500ms
```

使用者點某個 screenshot region 時，介面同時顯示：

- capture snapshot 中是哪個 Layer/Buffer/Frame；
- 最近一次 presented generation；
- 是否 exact-key match；
- capture 是否套用了 crop/transform/dataspace/HDR；
- observation→action 期間 target generation 是否已更換。

故障注入：snapshot-after-next-buffer、secure layer omitted、protected content、retained layer、display CLIENT/DEVICE branch divergence、late capture fence、crop/scale、TOCTOU focus switch、visual patch injection。

Edge 狀態：`CAPTURE-BOUND / SAME-GENERATION / PRESENT-BOUND / TEMPORAL / DIVERGED / UNKNOWN / BROKEN`。

## Code / GitHub

本輪值得直接閱讀的 AOSP 核心位置：

- `frameworks/native/services/surfaceflinger/SurfaceFlinger.cpp`
  - `captureDisplay`
  - `captureLayers`
  - `captureScreenCommon`
  - `captureScreenshot`
  - `renderScreenImpl`
  - `getLayerSnapshotsForScreenshots`
- `frameworks/native/services/surfaceflinger/SurfaceFlinger.h`：capture pipeline signatures。
- `frameworks/native/services/surfaceflinger/RenderArea.*`：capture coordinate space / crop / transform。
- `frameworks/native/libs/renderengine/`：LayerSettings → RenderEngine draw → capture target。
- `frameworks/native/libs/gui/` ScreenCaptureResults / ScreenCapture client path：buffer + fence + metadata transport。

本輪 GitHub/AOSP 閱讀重點不是 README，而是 runtime call chain 與 capture data ownership。

## Papers

### StateAct: Program State, before Pixels, for Long-Horizon Computer-Use Agents
Authors: Yan Yang, Xiangru Jian, Ziyang Luo, Zirui Zhao, Yutong Dai, Ziji Shi, Hanshu Yan, Jun Hao Liew, Silvio Savarese, Junnan Li
Year: 2026
URL: https://arxiv.org/abs/2607.22798
Architecture: code-first main agent + GUI subagent + independent finish gate + fresh subagents
Contribution: program-state grounding 改善 OSWorld 2.0 long-horizon computer use；證明 screenshot 與 underlying state 應互補而非互相取代。
Limitations: 封閉 app / 無 programmatic state access 時仍依賴 GUI perception。

### Temporal UI State Inconsistency in Desktop GUI Agents: Formalizing and Defending Against TOCTOU Attacks on Computer-Use Agents
Author: Wenpeng Xu
Year: 2026
URL: https://arxiv.org/abs/2604.18860
Architecture: Pre-execution UI State Verification (target-region pixel check + global screenshot diff + window-state diff)
Contribution: 將 observation→action gap 建模為 Visual Atomicity Violation；在其測試環境量到平均 6.51 秒 gap，並以 action 前 revalidation 防禦多類 race。
Limitations: DOM-only/zero-visual-footprint mutation 仍可能繞過純視覺 revalidation。

### AgentHijack: Visual Patch Attacks on Multimodal Computer-Use Agents
Authors: Zhihao Liu, Hongyu Sun, Zhiyuan Fu, Xiaonan Duan, Jice Wang, Shangru Zhao, Weizhi Meng, Wuxin Yang, Yangfan Zhou, Yuqing Zhang
Year: 2026
URL: https://arxiv.org/abs/2609.09212
Architecture: visual patch → screenshot → VLM → action parsing → environment execution end-to-end attack evaluation
Dataset/Evaluation: 600 online instance-level cases across five GUI-agent/VLM backends
Contribution: 顯示局部 visual signal 可穿透完整 CUA execution chain，E2E-ASR reported 20.3%。
Limitations: author-controlled pages / specific backends；不能直接外推所有 computer-use deployment。

## Unknown / Open Questions

1. `getLayerSnapshotsForScreenshots()` 的 current LayerSnapshot 是否能穩定暴露 `(layerId, bufferId, frameNumber)` 三元組，足以與 FrameTracer exact join？需要下一輪直接追 LayerSnapshot schema 與 LayerFE preparation。
2. Capture RenderEngine path 對 DEVICE overlay / protected content / sideband / HDR gainmap 的處理，何時會與 physical display composition 出現 semantic pixel divergence？
3. 是否能在不修改 AOSP 的 production Android 上，用 Perfetto/Winscope + ScreenCapture timestamp/fence 建立足夠強的 CapturePresentationBindingWitness？若不能，Hermes instrumentation 最小 patch 應在哪個函式掛鉤？

## 下一輪研究

直接追：

```text
frontend::LayerSnapshot
→ buffer / frame identity fields
→ LayerFE::prepareClientComposition
→ LayerSettings
→ RenderEngine::drawLayers
→ ScreenCaptureResults
```

目標：確認 capture render input 是否能原生攜帶 `layerId + bufferId + frameNumber`，並建立第一版 `CaptureLayerMembershipManifest` schema。

同時比較 physical display composition 與 capture RenderEngine composition 在 overlay、protected content、sideband stream、HDR、blur、rounded corners、color transform 上的 divergence rules。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `CaptureSnapshotEpoch`
- `CaptureLayerSnapshotSet`
- `CaptureLayerMembershipWitness`
- `CaptureRenderInputSet`
- `CaptureBufferWitness`
- `CaptureRenderFenceWitness`
- `PresentedLayerFrameSet`
- `CapturePresentationBindingWitness`
- `LogicalGenerationEquivalence`
- `PhysicalCaptureDivergenceState`
- `PreActionRevalidationEnvelope`
- `VisualAtomicityBoundary`

### Edges

```text
CaptureRequest
→creates→ CaptureSnapshotEpoch

CaptureSnapshotEpoch
→selects→ CaptureLayerSnapshotSet

CaptureLayerSnapshotSet
→renders_into→ CaptureBufferWitness

CaptureBufferWitness
→completed_by→ CaptureRenderFenceWitness

ObservablePresentationWitness
→describes→ PresentedLayerFrameSet

PresentedLayerFrameSet
↔joined_with↔ CaptureLayerSnapshotSet

CaptureLayerSnapshotSet
→supports→ CapturePresentationBindingWitness

CapturePresentationBindingWitness
→supports→ ObservationEnvelope

ObservationEnvelope
→must_be_revalidated_at→ VisualAtomicityBoundary

PreActionRevalidationEnvelope
→authorizes_or_blocks→ AgentAction
```

## 事實 / 推論分級

**已確認官方/工程實作**：SurfaceFlinger captureDisplay/captureLayers 進 screenshot pipeline；capture 使用 layer snapshots + RenderArea + RenderEngine 渲染到獨立 buffer；ScreenCaptureResults 具有 capture output/fence 類同步結果；secure/protected/HDR/dataspace 等會影響 capture path。

**論文結果**：StateAct 支持 program-state grounding；Temporal UI State Inconsistency 支持 pre-action revalidation；AgentHijack 支持 visual observation 可成為 end-to-end action injection surface。

**合理工程推論**：若 capture snapshot 可記錄與 FrameTracer 相同的 `(layerId, bufferId, frameNumber)`，可建立遠強於 timestamp correlation 的 CapturePresentationBindingWitness。

**尚未驗證假說**：production Android 無 instrumentation 即可取得完整 CaptureLayerMembershipManifest；capture pixels 與 physical scanout pixels byte-identical。

## 本輪結束判定

- 缺哪一層：`CaptureLayerSnapshot → exact layer/buffer/frame identity manifest → FrameTracer presented-frame exact join`。
- 哪個節點最淺：`CaptureLayerMembershipWitness`。
- 哪個概念仍只是名詞：`CaptureLayerMembershipManifest`。
- 哪個系統值得讀原始碼：AOSP `LayerSnapshot / LayerFE / RenderEngine screenshot path`。
- 哪篇論文需追引用：Temporal UI State Inconsistency；它把 observation provenance 的問題延伸到 action-time atomicity。
- 哪個概念最適合視覺模擬：`Presented-vs-Captured Layer Set Diff Explorer`。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Capture/Presentation Evidence DAG + PreAction Revalidation Gate`。

## 本輪核心結論

上一輪問「Agent screenshot 能不能綁到已 presented layer set？」本輪得到更精確答案：**SurfaceFlinger screenshot 是 logical layer snapshot 的重新渲染，不是 physical scanout readback。** 因此真正要閉合的不是 `present fence → screenshot timestamp`，而是：

```text
Presented (layerId, bufferId, frameNumber)
↔
Captured LayerSnapshot generation
→ RenderEngine capture buffer
→ capture fence
→ vision input
```

這個修正很重要：Hermes 若把 screenshot 當成 physical display 的直接複製，會在 overlay、protected content、color/HDR 與 timing race 上建立錯誤的因果圖。下一輪應把 capture snapshot membership 本身變成可機器驗證的 manifest。