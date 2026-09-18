# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 04:53（Asia/Taipei）

主題：SurfaceFlinger FrameTracer × Winscope × Observable Presentation Witness

## 本小時新發現

本輪接續上一輪 `SurfaceFlinger OutputLayer → HWC composition → Layer-associated display present`，專注回答：**平台已存在的 tracing / debugging primitives，能否讓 Hermes 非侵入式收集 `Layer + Buffer + Frame + Present` 的 runtime witness，而不再只依賴 screenshot timestamp 猜測？**

結論：可以取得一條比 screenshot correlation 強很多的 observable chain，但仍不能把它誤稱為 vendor-independent physical-plane identity。

AOSP current SurfaceFlinger 在 buffer latch 時把 `layerId + bufferId + frameNumber` 送入 FrameTracer，事件包含 ACQUIRE_FENCE 與 LATCH；在 display presentation 時，再把同一組 identity 與 display present fence（或 HWC 不支援 present fence 時的推導 present timestamp）記為 PRESENT_FENCE。Winscope 的 SurfaceFlinger viewer 同時可觀察 Layer hierarchy、Frame Number、buffer geometry、z-order 等狀態。因此 Hermes 可以建立 `ObservableLayerFrameWitness`，把 compositor state trace 與 timing trace 合併。

## 本小時最重要 5 個發現

### 1. FrameTracer 已經提供 Layer / Buffer / Frame 的事件主鍵

**已確認工程實作**：SurfaceFlinger buffer latch path 取得：

`layerId = getSequence()`
`bufferId = buffer->getId()`
`frameNumber = drawingState.frameNumber`

並記錄 acquire fence 與 latch timestamp。

底層鏈：

```text
SurfaceControl transaction
→ BufferStateLayer drawing state
→ layerId
→ GraphicBuffer bufferId
→ frameNumber
→ acquire fence
→ latch
→ FrameTracer event stream
```

這表示 Hermes 不需要自己發明 layer-frame correlation key。

限制：這仍是 SurfaceFlinger logical layer / buffer identity，不是 display controller physical plane identity。

### 2. PRESENT_FENCE event 能把同一 Layer/Buffer/Frame 關聯到 display presentation

**已確認工程實作**：SurfaceFlinger current Layer.cpp 在 present fence 有效時呼叫 FrameTracer traceFence，帶入 `layerId + currentBufferId + currentFrameNumber + presentFence`。若 HWC 不提供有效 present fence，SurfaceFlinger會以 HWC present timestamp / vsync period 建立 actual present time，再 traceTimestamp 為 PRESENT_FENCE。

因此可建立：

```text
(layerId, bufferId, frameNumber)
→ ACQUIRE_FENCE
→ LATCH
→ PRESENT_FENCE / PRESENT_TIMESTAMP
```

重要：這是 **layer-associated display presentation evidence**，不是 per-layer hardware scanout fence。

### 3. Winscope 可提供 state-side witness，FrameTracer 提供 timing-side witness

**官方資訊**：Winscope SurfaceFlinger viewer 能顯示 layer hierarchy、frame number、buffer size/transform、destination frame、z-order 等屬性。

因此 Hermes 應把 evidence 分成：

```text
State witness:
Winscope / Layer trace
→ Layer hierarchy
→ Frame Number
→ geometry / transform / z-order

Timing witness:
FrameTracer
→ QUEUE
→ ACQUIRE_FENCE
→ LATCH
→ FALLBACK_COMPOSITION(optional)
→ PRESENT_FENCE
```

兩者 join 後才形成 `ObservablePresentationWitness`。

### 4. CLIENT composition 可以被 FrameTracer 額外標記

AOSP BufferLayer path 在 `outputLayer->requiresClientComposition()` 時記錄 `FALLBACK_COMPOSITION` timestamp。這使 Hermes 能區分至少一部分：

```text
Layer frame
├─ DEVICE/HWC path
└─ CLIENT/RenderEngine fallback path
```

但不能只靠 absence of FALLBACK_COMPOSITION 就宣稱 vendor physical plane identity；這仍需 composition state / OutputLayer evidence交叉驗證。

### 5. Agent verification 應從 screenshot-only 升級成 state + render + visual 三證據

StateAct（2026）顯示 screenshot 是 underlying program state 的 lossy rendering，使用 program state 做 action/verification 並只在必要時委派 GUI subagent，可改善長程 computer-use；VisCritic 則顯示 pre/post screenshots 的 visual state comparison 可作 step-level process reward。兩者不是互斥，而是支持 Hermes 採：

```text
ProgramStateWitness
+
RenderPresentationWitness
+
VisualObservationWitness
→ TransitionVerifier
```

而不是只用 screenshot difference。

## Architecture Breakdown

### Observable Presentation Evidence Architecture

```text
Chromium / App
  ↓
SurfaceControl Transaction
  ↓
SurfaceFlinger Layer
  ├─ layerId
  ├─ bufferId
  └─ frameNumber
  ↓
Acquire Fence
  ↓
Latch
  ↓
Composition Decision
  ├─ CLIENT → RenderEngine → ClientTarget
  └─ DEVICE → HWC layer
  ↓
HWC presentDisplay
  ↓
Display Present Fence / Present Timestamp
  ↓
FrameTracer PRESENT_FENCE

parallel state channel:
Layer Trace / Winscope
  ↓
Hierarchy + FrameNumber + geometry + transform + z-order

join:
ObservableLayerFrameWitness
  ↓
ObservablePresentationWitness
  ↓
CaptureEvidence
  ↓
Visual Tokens
  ↓
Agent TransitionVerifier
```

## Bottom-Level Logic

Hermes runtime 不應把「看到 screenshot」當作單一 observation。建議 observation envelope：

```text
ObservationEnvelope {
  observation_id,
  capture_time,
  program_state_witness,
  layer_state_witness,
  layer_frame_witnesses[],
  presentation_witness,
  capture_witness,
  visual_embedding,
  confidence
}
```

其中：

```text
LayerFrameWitness {
  layer_id,
  buffer_id,
  frame_number,
  acquire_event,
  latch_event,
  composition_branch,
  present_event,
  geometry,
  z_order
}
```

證據強度必須區分：

```text
PRESENT_FENCE_VALID
> PRESENT_TIMESTAMP_FALLBACK
> TEMPORAL_CORRELATION_ONLY
```

## Visual Simulation Idea

### FrameTracer × Winscope Causal Timeline Explorer

互動介面分四軌：

```text
APP       TX91────────TX92────────TX93
LAYER     B41/F471────B42/F472────B43/F473
SF        acquire─latch─compose────present
CAPTURE                  C22────────C23
AGENT                     O118──────A119
```

點擊任一 Agent observation，可反向高亮：

```text
Visual token region
← Capture
← Presented LayerFrame set
← (layerId, bufferId, frameNumber)
← SurfaceControl transaction
← Browser source frame
```

故障注入：invalid present fence、timestamp fallback、client composition、retained layer、buffer reuse、capture-before-present、capture-after-next-frame、missing trace packet。

Edge 狀態：`CAUSAL / TRACE-BOUND / PRESENT-BOUND / CORRELATED / UNKNOWN / BROKEN`。

## Code / GitHub

本輪值得直接閱讀的 AOSP 核心位置：

- `frameworks/native/services/surfaceflinger/Layer.cpp`：buffer identity、acquire/latch、present fence / present timestamp、FrameTracer。
- `frameworks/native/services/surfaceflinger/BufferStateLayer.cpp`（歷史/current lineage）：bufferId、frameNumber、acquire/latch tracking。
- `frameworks/native/services/surfaceflinger/BufferQueueLayer.cpp`：QUEUE / ACQUIRE_FENCE trace。
- `frameworks/native/services/surfaceflinger/FrameTracer.*`：event model 與 trace serialization。
- SurfaceFlinger CompositionEngine / OutputLayer：CLIENT vs DEVICE composition evidence。
- Winscope SurfaceFlinger trace parser/viewer：可觀察 state schema。

## Papers

### StateAct: Program State, before Pixels, for Long-Horizon Computer-Use Agents
Authors: Yan Yang, Xiangru Jian, Ziyang Luo, Zirui Zhao, Yutong Dai, Ziji Shi, Hanshu Yan, Jun Hao Liew, Silvio Savarese, Junnan Li
Year: 2026
URL: https://arxiv.org/abs/2607.22798
Architecture: code-first main agent + dedicated GUI subagent + independent finish gate + fresh subagents
Contribution: 把 action、verification、memory grounding 從 pixels 移向 program state；OSWorld 2.0 binary success 20.6%→26.9%，partial 54.8%→61.6%。
Limitation: 依賴可程式化取得的 program state；純視覺或封閉 app 仍需 GUI perception。

### VisCritic: Visual State Comparison as Process Reward for GUI Agents
Author: Jiachen Qian
Year: 2026
URL: https://arxiv.org/abs/2606.24525
Architecture: Siamese Vision Transformer + Action-Aware Critic Head
Contribution: 直接比較 action 前後 visual state，作為 step-level success/progress/error process reward。
Limitation: screenshot comparison 仍無法單獨證明 hidden program state 或 compositor provenance。

### WeaveBench: A Long-Horizon, Real-World Benchmark for Computer-Use Agents with Hybrid Interfaces
Authors: Wanli Li et al.
Institutions: Zhejiang University / Microsoft Research Asia / Tsinghua University
Year: 2026
URL: https://arxiv.org/abs/2606.09426
Code/Project: https://weavebench.github.io/
Dataset: 114 tasks, 8 work domains
Architecture: GUI + CLI/code hybrid trajectories + trajectory-aware judge
Contribution: 最佳 PassRate 41.2%；outcome-only grading 會高估 Agent performance。
Limitation: benchmark verification evidence仍不等於 OS compositor-level causal provenance。

## 與歷史研究比較

前一輪已得到：

```text
SurfaceControl Surface
→ SurfaceFlinger OutputLayer
→ HWC2 Layer / ClientTarget
→ display present fence
```

本輪新增的不是另一套 composition architecture，而是 **可實際收集的觀測層**：

```text
(layerId, bufferId, frameNumber)
→ acquire/latch
→ composition clue
→ display present event
+
Winscope state
```

因此 Knowledge Graph 從 theoretical/runtime path 前進到 `runtime-observable evidence path`。

## Unknown / Open Questions

1. current Winscope / Perfetto trace packet 是否能在一般非-root production Android 裝置穩定取得完整 `bufferId + frameNumber + composition type`，權限與 overhead 邊界為何？
2. Layer trace 與 FrameTracer event stream 是否有官方穩定 join key / timestamp discipline，或 Hermes 需要自行建立 trace epoch？
3. screenshot / screen capture pipeline 是否能提供足夠 identity，把 capture buffer 精確綁到同一 display present epoch，而非只用時間窗相關？

## 下一輪研究

直接追 `FrameTracer → Perfetto/Winscope serialization → trace packet schema → capture pipeline`：

```text
FrameTracer event
→ Perfetto trace packet
→ Winscope / trace processor
→ layerId/bufferId/frameNumber reconstruction
→ ScreenCapture / captureLayers
→ capture buffer
→ capture timestamp / fence
→ ObservationEnvelope
```

重點驗證 Android `ScreenCapture` / `captureDisplay` / `captureLayers` 是否走 SurfaceFlinger snapshot composition，以及 capture fence 能否與 display presentation epoch 建立 causal edge。

## Knowledge Graph 新增 Node / Edge

Nodes:
- `ObservableLayerFrameWitness`
- `FrameTracerEvent`
- `LayerStateTraceWitness`
- `WinscopeStateWitness`
- `PresentFenceEventWitness`
- `PresentTimestampFallbackWitness`
- `FallbackCompositionEvent`
- `ObservablePresentationWitness`
- `ObservationEnvelope`
- `TraceEpoch`

Edges:
- `SurfaceFlingerLayer -> ObservableLayerFrameWitness`
- `GraphicBuffer -> ObservableLayerFrameWitness`
- `FrameNumber -> ObservableLayerFrameWitness`
- `ObservableLayerFrameWitness -> AcquireFenceEvent`
- `ObservableLayerFrameWitness -> LatchEvent`
- `ObservableLayerFrameWitness -> PresentFenceEventWitness`
- `LayerStateTraceWitness + FrameTracerEvent -> ObservablePresentationWitness`
- `ObservablePresentationWitness -> CaptureEvidence [UNRESOLVED]`

## 本輪結束判定

- 缺哪一層：`ObservablePresentationWitness → exact capture buffer inclusion`。
- 哪個節點最淺：`CapturePresentationBindingWitness`。
- 哪個概念仍只是名詞：`CaptureBoundPresentedLayerSet`。
- 哪個系統值得讀原始碼：AOSP `FrameTracer + ScreenCapture + SurfaceFlinger captureDisplay/captureLayers`。
- 哪篇論文需追引用：StateAct，特別是 state-grounded verification 與 finish gate 後續工作。
- 哪個概念最適合視覺模擬：`FrameTracer × Winscope Causal Timeline Explorer`。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Active Perception + Render/Presentation Evidence DAG + Independent Transition Verifier + Risk-Adaptive Action Gate`。

## 核心結論

本輪把 Hermes 從「知道 SurfaceFlinger 內部理論上有 Layer/Buffer/Present 關聯」推進到「找到平台現成的 runtime observable witness」。真正重要的不是取得更多 screenshot，而是讓每個 Agent observation 能攜帶 program state、Layer state、buffer/frame identity、latch、presentation 與 capture evidence。下一個硬邊界是 capture：必須證明 Agent 收到的 capture buffer 與哪一個 presented layer-frame set 對應，才能把 `UI → compositor → display → screenshot → VLM tokens → Agent action` 的因果鏈真正閉合。