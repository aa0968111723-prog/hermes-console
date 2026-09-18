# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 03:55（Asia/Taipei）

主題：SurfaceFlinger OutputLayer × HWC Buffer Cache × Composition Type × Presentation Provenance

## 本小時新發現

本輪延續前一輪 `SurfaceControl child Surface → SurfaceFlinger Layer → HWC composition → retained-plane presentation`，不重複 Present Fence / Release Fence 定義，而是深入 SurfaceFlinger CompositionEngine 的 OutputLayer 與 HWC state，確認 app/browser buffer 如何被轉成 HWC layer state，以及在哪裡失去「一個 plane = 一個獨立 present fence」的幻想。

已確認事實：AOSP `OutputLayerCompositionState::Hwc` 保存 backing `HWC2::Layer`、最近設定的 `hwcCompositionType`、`HwcBufferCache`，current main 還保存 `activeBufferId` 與 `activeBufferSlot`。`OutputLayer::writeStateToHWC()` / `setBuffer()` 會把 GraphicBuffer 經 HWC buffer cache 映射成 HWC slot/buffer，再連同 acquire fence 寫入 HWC layer。HWC composition type 可以是 CLIENT / DEVICE 等，且 validate 階段可由硬體 composer 改變。

已確認事實：SurfaceFlinger 的 CompositionEngine 在 present 後取得 display present fence 與 per-HWC-layer release fences。對 output layers，per-layer release fence 用於告知 LayerFE 該 buffer 何時可釋放；若該 layer 是 client composition，release synchronization 還會與 client target acquire fence 合併。因此 release fence 是 buffer lifetime / reuse evidence，而不是 target-region visibility proof。

已確認事實：AOSP current `Layer.cpp` 會把 display present fence 與 layerId、current frame number、current buffer id 一起送入 TimeStats / FrameTracer。這是一個比上一輪更強的 observation：SurfaceFlinger 內部確實能在 Layer domain 將 `(layerId, bufferId, frameNumber)` 與 display-level present fence 關聯；但該 fence仍是 display presentation fence，不是硬體對單一 plane提供的獨立 scanout fence。

新論文 / Agent verification：DiagEval (Hong et al., 2026) 將 GUI evaluation 建模成 latent UI state-transition graph 上的 trajectory-conditioned diagnosis。單一失敗 trajectory 無法區分 evaluator execution error 與 software defect；針對失敗軌跡做 diagnostic probes，在 WebDevJudge-Unit / RealDevBench 上可恢復 45.6–62.1% 原先誤判為 software defect 的 false negatives。這直接支持 Hermes 將 provenance failure 從單純 `retry screenshot` 升級為 `diagnose broken evidence edge → targeted probe`。

## 本小時最重要 5 個發現

### 1. SurfaceFlinger OutputLayer 是 Browser Plane 與 HWC Layer 之間的新 identity domain

是什麼：CompositionEngine 的 `OutputLayer` 是 output-dependent layer state；它持有 `LayerFE` 對應關係與 optional HWC state。

底層：
`SurfaceControl/LayerFE → OutputLayer → OutputLayerCompositionState → HWC2::Layer`。

為什麼重要：Hermes 先前從 Chromium AHardwareBuffer / SurfaceControl child Surface 直接跳到「platform plane」太粗。現在應加入 `SurfaceFlingerOutputLayerWitness`。

限制：OutputLayer/HWC layer identity 是 SurfaceFlinger runtime identity，不能直接當 physical display plane identity。

狀態：AOSP 原始碼確認。

### 2. `activeBufferId + activeBufferSlot` 可形成 HWC-side buffer binding witness，但仍不是 global generation ID

底層：
`GraphicBuffer → HwcBufferCache → hwcSlot/hwcBuffer → HWC2::Layer::setBuffer(acquireFence)`。

HWC buffer cache 的目的之一就是避免重複傳送 reused buffers，因此 slot identity 與 content generation 必須分離。

Hermes 建議：
`HwcBufferBindingWitness = OutputLayerId + activeBufferId + activeBufferSlot + bindingEpoch + acquireFenceEpoch`。

`bindingEpoch` / `acquireFenceEpoch` 是 Hermes 工程模型，不是 AOSP 官方 invariant。

### 3. Composition Type 是 provenance graph 的 branch，不是 metadata

`LayerFE desired composition → requested composition type → HWC validate → accepted composition type`。

若為 DEVICE，HWC 可能直接合成該 layer；若為 CLIENT，SurfaceFlinger/RenderEngine 先把多個 layers 合成 client target，再由 HWC 顯示 client target。因此：

`Source Layer → CLIENT → ClientTarget → HWC Display`
與
`Source Layer → DEVICE → HWC Layer → HWC Display`

是兩條不同 provenance branch。

這表示 Hermes 的 `PlanePresentedGroupMembership` 必須拆成 `DeviceCompositionMembership` 與 `ClientTargetCompositionMembership`。

### 4. AOSP 內部已存在 `(layerId, bufferId, frameNumber) → display present fence` 的 tracing association

current `Layer.cpp` 在 valid present fence 時，把 `layerId`, `mCurrentFrameNumber`, `getCurrentBufferId()` 與 present fence送進 TimeStats/FrameTracer。

這比上一輪只有 transaction-level present fence 更接近 per-layer evidence，但證據強度必須標記為 `LAYER_ASSOCIATED_DISPLAY_PRESENT`，不能誤稱 `PER_LAYER_PHYSICAL_PRESENT_FENCE`。

### 5. GUI Agent 的 failure verifier 應從 retry 升級成 evidence-edge diagnosis

DiagEval：
`failed trajectory → source-of-uncertainty diagnosis → targeted probes → evidence aggregation → attribution`。

Hermes 可映射成：
`failed action/postcondition → locate weakest provenance edge → choose state/render/capture/tool probe → update confidence → retry/replan/block`。

這比固定 screenshot retry 更適合目前已建立的 Evidence DAG。

## Architecture Breakdown

### SurfaceFlinger / HWC system architecture

```text
Chromium SharedImage / AHardwareBuffer
  → SurfaceControl child Surface
  → SurfaceFlinger Layer / LayerFE
  → CompositionEngine OutputLayer
      ├─ visibleRegion
      ├─ displayFrame
      ├─ sourceCrop
      ├─ z
      └─ Hwc state
          ├─ HWC2::Layer
          ├─ compositionType
          ├─ HwcBufferCache
          ├─ activeBufferId
          └─ activeBufferSlot
  → writeStateToHWC
  → setBuffer(slot, buffer, acquireFence)
  → HWC validate
  → branch
      ├─ DEVICE composition
      │   → HWC layer composition
      └─ CLIENT composition
          → RenderEngine/client target
          → HWC client target
  → presentDisplay
  → display PresentFence
  → per-layer ReleaseFence
```

### Hermes evidence architecture

```text
SurfaceBufferBindingWitness
→ SurfaceFlingerLayerWitness
→ OutputLayerWitness
→ HwcBufferBindingWitness
→ CompositionDecisionWitness
   ├ DEVICE → HwcLayerMembership
   └ CLIENT → ClientTargetContribution
→ DisplayPresentWitness
→ LayerAssociatedPresentWitness
→ CaptureWitness
→ RegionContributionWitness
→ VisionTokenWitness
```

## Bottom-Level Logic

### HWC buffer binding

1. LayerFE exposes current composition state/buffer.
2. OutputLayer owns output-specific geometry and HWC state.
3. HwcBufferCache maps GraphicBuffer to HWC slot/buffer representation.
4. `HWC2::Layer::setBuffer` receives slot, buffer and acquire fence.
5. HWC must not consume the buffer before acquire synchronization completes.
6. validate determines/adjusts composition type.
7. DEVICE layers can be composed by HWC; CLIENT layers are rasterized into the client target first.
8. present produces display-level presentation synchronization.
9. layer release fences govern lifetime/reuse of prior layer buffers.

### New evidence-strength taxonomy

```text
BUFFER_BOUND_TO_HWC_LAYER
COMPOSITION_TYPE_ACCEPTED
DEVICE_COMPOSITION_MEMBER
CLIENT_TARGET_MEMBER
LAYER_ASSOCIATED_DISPLAY_PRESENT
BUFFER_RELEASED
CAPTURE_INCLUDED
REGION_VISIBLE
```

Do not collapse these into `PRESENTED=true`.

## Visual Simulation Idea

### SurfaceFlinger Composition Branch Microscope

互動時間軸左側顯示 browser/source lineage，中央顯示 SurfaceFlinger，右側顯示 HWC/display/capture：

```text
B41 → Surface S1 → Layer L7 → OutputLayer O7 → HWC Layer H3
                                  │
                                  ├ DEVICE ──────────────┐
                                  │                      ↓
                                  └ CLIENT → ClientTarget CT9
                                                         ↓
                                                   presentDisplay
                                                         ↓
                                                    PresentFence
```

可注入：HWC validate 把 DEVICE 改成 CLIENT、buffer cache reuse、same slot/new buffer generation、late acquire fence、retained layer、client-target fallback、missing release fence、capture before/after present。

每條 edge 顯示：`IDENTITY / BINDING / COMPOSITION / LIFETIME / DISPLAY-ASSOCIATED / REGION / UNKNOWN / BROKEN`。

## Code / GitHub

AOSP 值得讀的核心檔案：

- `services/surfaceflinger/CompositionEngine/include/compositionengine/impl/OutputLayerCompositionState.h`
- `services/surfaceflinger/CompositionEngine/src/OutputLayer.cpp`
- `services/surfaceflinger/CompositionEngine/src/Output.cpp`
- `services/surfaceflinger/Layer.cpp`
- `services/surfaceflinger/SurfaceFlinger.cpp`
- `services/surfaceflinger/DisplayHardware/HWComposer.*`
- Composer3 / HWC HAL implementation interfaces

DiagEval code：`scutGit/DiagEval`，值得追 `failure diagnosis / branch generation / verification probes` 的實作，映射 Hermes Evidence DAG verifier。

## Papers

### DiagEval: Trajectory-Conditioned Diagnosis for Reliable Software Evaluation with GUI Agents
- Authors: Sirui Hong, Zhijie Liu, Tengfei Li, Wei Tao, Yifan Wu, Chenglin Wu
- Institution: DeepWisdom; Independent Researcher; HKUST (Guangzhou)（依公開作者資訊）
- Year: 2026
- Paper: arXiv:2605.17439
- Code: https://github.com/scutGit/DiagEval
- Dataset / Evaluation: WebDevJudge-Unit, RealDevBench
- Architecture: trajectory-conditioned failure diagnosis + targeted diagnostic probes
- Contribution: 將 GUI evaluator failure attribution 從 blind retry 改成 trajectory-conditioned diagnosis。
- Result: false-negative cases recovery 45.6–62.1%；overall accuracy WebDevJudge-Unit 69.9→78.3%，RealDevBench 65.0→81.6%。
- Limitation: latent graph 是 motivating model；系統不重建完整 graph，也不提供 calibrated posterior。
- 改變了什麼：為 Agent verifier 提供「失敗後診斷哪條 transition/evidence edge 不可靠」的具體研究方向。

## 與歷史研究比較

上一輪最淺節點：`PlanePresentedGroupMembership`。

本輪補足：
`SurfaceFlinger Layer → OutputLayer → HWC2::Layer → buffer binding → composition type → display present association`。

因此不再把 HWC 當黑盒；但也證明 `OutputLayer/HWC Layer` 與 physical plane/pixel visibility 仍不是同一 identity domain。

## Unknown / Open Questions

1. current SurfaceFlinger Layer tracing / Winscope 是否能穩定輸出 `layerId + bufferId + frameNumber + compositionType + present timestamp/fence`，供 Hermes runtime 收集，而不需要 invasive instrumentation？
2. HWC Composer3 HAL 是否暴露足以把 HWC2::Layer 進一步綁到 vendor physical plane，還是 physical plane assignment 本質上是 vendor-private implementation detail？
3. CLIENT composition 時，如何把多個 source Layer 的 region provenance穿過 RenderEngine client target，重新綁回 capture pixel？

## 下一輪研究

優先追：

`OutputLayer/HWC2::Layer → Composer3 HAL → validateDisplay/presentDisplay → composition changes → layer release fences → FrameTracer/Layer tracing`。

同時研究 Winscope / LayerTrace protobuf，確認能否建立 non-invasive `LayerPresentationTraceWitness`。若 physical plane identity 在標準 HWC API 不存在，就應停止追求 vendor-independent physical-plane ID，轉而建立 `HWCCompositionMembership + DisplayPresent + CapturePixel` 的可驗證證據組合。

## Knowledge Graph 新增 Node / Edge

Nodes:
- `SurfaceFlingerOutputLayerWitness`
- `HwcLayerWitness`
- `HwcBufferCacheWitness`
- `HwcBufferBindingWitness`
- `CompositionDecisionWitness`
- `DeviceCompositionMembership`
- `ClientTargetCompositionMembership`
- `LayerAssociatedDisplayPresentWitness`
- `LayerPresentationTraceWitness`
- `DiagnosticEvidenceProbe`

Edges:
- `SurfaceFlingerLayer -> OutputLayer`
- `OutputLayer -> HWC2Layer`
- `GraphicBuffer -> HwcBufferBinding`
- `HwcBufferBinding -> HWC2Layer`
- `HWC2Layer -> CompositionDecision`
- `CompositionDecision[DEVICE] -> DeviceCompositionMembership`
- `CompositionDecision[CLIENT] -> ClientTargetCompositionMembership`
- `LayerBufferFrame -> LayerAssociatedDisplayPresentWitness`
- `BrokenEvidenceEdge -> DiagnosticEvidenceProbe`

## 本輪結束判斷

缺哪一層：`HWC composition membership → standardized physical-plane / display contribution → capture inclusion`。

哪個節點最淺：`LayerPresentationTraceWitness`；AOSP 有 tracing primitives，但尚未驗證 Hermes 可取得的完整 runtime trace schema 與穩定關聯欄位。

哪個概念仍只是名詞：`VendorIndependentPhysicalPlaneIdentity`。目前不能假設標準 HWC API 提供它。

哪個系統值得讀原始碼：AOSP SurfaceFlinger CompositionEngine + Composer3/HWC HAL + Winscope Layer tracing。

哪篇論文需追引用：DiagEval (2026)，尤其後續把 diagnostic probes 用於 autonomous computer-use verifier / RL reward 的工作。

哪個概念最適合視覺模擬：`SurfaceFlinger Composition Branch Microscope`。

哪個 Agent 架構最值得實作：

`State-grounded Planner + Active Perception + Render/Composition Evidence DAG + Trajectory-conditioned Diagnostic Verifier + Risk-Adaptive Action Gate`。

## 全鏈更新

```text
使用者一句話
→ UI
→ Agent Runtime
→ Context / Memory
→ Model Reasoning
→ Planning
→ Tool / Computer Intent
→ Browser Render
→ Surface Generation
→ Aggregated Quad
→ Overlay / SharedImage / AHardwareBuffer
→ SurfaceControl Surface
→ SurfaceFlinger Layer / OutputLayer
→ HWC Buffer Binding
→ Composition Decision (DEVICE | CLIENT)
→ Display Present
→ Capture
→ Region Pixels
→ Vision Encoder
→ Visual Tokens
→ Multimodal Fusion
→ Agent Verification / Diagnosis
→ Action
→ Postcondition
→ Output
```

本輪核心結論：`per-plane presentation` 不應被建模成一個不存在的單一 fence。更可驗證的做法，是保存 `Layer/OutputLayer/HWC buffer binding + composition branch + display-present association + release lifetime + capture/region evidence`，再用 Evidence DAG 表達每條 edge 的證據強度。