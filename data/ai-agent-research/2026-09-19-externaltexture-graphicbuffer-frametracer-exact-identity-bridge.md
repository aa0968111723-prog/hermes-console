# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 07:52（Asia/Taipei）

主題：ExternalTexture × GraphicBuffer × FrameTracer Exact Buffer Identity Bridge

## 本小時新發現

本輪接續上一輪最淺節點 `LogicalGenerationJoinWitness`，直接驗證 `LayerSnapshot.externalTexture → renderengine::ExternalTexture::getId() → GraphicBuffer::getId() → FrameTracer bufferId`。

核心突破：AOSP current `renderengine::impl::ExternalTexture` 的 `getId()` 不是另一套 texture-local ID，而是直接 `return getBuffer()->getId()`。SurfaceFlinger 的 FrameTracer 在 Layer/BufferQueue 路徑同樣把 `GraphicBuffer::getId()` 當成 `bufferId`，並與 `layerId + frameNumber` 一起記錄 QUEUE/LATCH/PRESENT_FENCE。因此，在同一 SurfaceFlinger runtime / GraphicBuffer identity domain 內：

```text
LayerSnapshot.externalTexture->getId()
=
ExternalTexture.getBuffer()->getId()
=
GraphicBuffer::getId()
=
FrameTracer bufferId
```

這不是時間相關性推論，而是原始碼層級的 exact identity bridge。

因此上一輪仍屬假說的 `StableBufferGenerationKey` 可收斂為：

```text
LogicalLayerBufferGenerationKey {
  layer_sequence / layerId,
  graphic_buffer_id,
  frame_number
}
```

在 capture snapshot 與 presentation FrameTracer 都保留這三個欄位時，可建立 `EXACT_LOGICAL_GENERATION_JOIN`。注意：這仍不等於 physical scanout byte identity；capture 是 RenderEngine 重新渲染 snapshot set。

## 本小時最重要 5 個發現

### 1. ExternalTexture ID 就是 GraphicBuffer ID

**已確認工程實作 / AOSP official source**：`libs/renderengine/include/renderengine/impl/ExternalTexture.h` 的 `getId()` 直接回傳 `getBuffer()->getId()`；`getBuffer()` 回傳 ExternalTexture 綁定的 `sp<GraphicBuffer>`。

底層：

```text
ExternalTexture
→ mBuffer : sp<GraphicBuffer>
→ getBuffer()
→ GraphicBuffer::getId()
→ ExternalTexture::getId()
```

重要性：capture manifest 的 `external_texture_id` 不需要再建立 heuristic mapping；它已經位於 GraphicBuffer identity domain。

限制：這個結論針對 AOSP `renderengine::impl::ExternalTexture`；測試/trace parser 可存在 FakeExternalTexture，其 ID 由外部資料注入，因此 instrumentation 必須記錄 implementation/source domain。

### 2. FrameTracer 使用同一個 GraphicBuffer::getId()

**已確認工程實作**：SurfaceFlinger `Layer.cpp` 從 `mDrawingState.buffer->getId()` 取得 `bufferId` 後交給 FrameTracer；BufferQueueLayer 在 QUEUE/LATCH 也直接使用 `item.mGraphicBuffer->getId()` / queue item GraphicBuffer ID。BufferLayer presentation path 則以 `getCurrentBufferId(), mCurrentFrameNumber` 記錄 PRESENT_FENCE。

因此：

```text
QUEUE:   (layerId, GraphicBufferId, frameNumber)
LATCH:   (layerId, GraphicBufferId, frameNumber)
PRESENT: (layerId, GraphicBufferId, frameNumber)
```

可與 capture snapshot：

```text
(layer_sequence, externalTexture.getId(), frameNumber)
```

做 exact logical join。

### 3. StableBufferGenerationKey 已從名詞升級成可實作 key

Hermes 應正式採：

```text
LogicalLayerBufferGenerationKey =
(layer_id, graphic_buffer_id, frame_number)
```

其中：
- `layer_id` 限定 layer identity domain；
- `graphic_buffer_id` 限定 backing buffer；
- `frame_number` 限定 producer generation / queue progression。

這比任何單欄位都強。GraphicBuffer ID 相同可能代表 buffer reuse；frame number 相同不能假設跨 producer/system 唯一；layer id 單獨只代表 Layer lifetime。

### 4. HWC buffer cache 再次交叉驗證 GraphicBuffer ID 是 composition-side buffer key

**已確認工程實作**：`HwcBufferCache::getHwcSlotAndBuffer()` 以 `buffer->getId()` 查 `mCacheByBufferId`。這表示同一 GraphicBuffer identity 不只存在 capture/FrameTracer，還延伸到 HWC composition-side cache key。

可建立：

```text
Capture ExternalTexture ID
↕ exact
GraphicBuffer ID
↕ exact
FrameTracer bufferId
↕ same buffer identity
HwcBufferCache key
```

但 HWC slot 是 cache-local identity，不能反向當作全域 buffer ID。

### 5. Agent observation 現在可以帶「exact logical generation」而不只是 screenshot timestamp

Computer-use failure research（CUADebug、AgentHijack）持續顯示動態環境、perception/control coupling 與錯誤 diagnosis 是主要問題。Hermes 現在可以把 compositor evidence 真正加入 verifier：

```text
ObservationEnvelope
  screenshot
  capture_manifest[]
    (layerId, bufferId, frameNumber)
  nearest_presented_set[]
    (layerId, bufferId, frameNumber, presentWitness)
  exact_generation_matches[]
  divergences[]
  capture_fence
  observation_time
```

這讓 pre-action revalidation 可以直接問「我要點的 region 是否仍屬於我推理時看到的同一 logical generation？」而不是只比較兩張圖像是否相似。

## Architecture Breakdown

### Exact Logical Generation Join

```text
APP / BROWSER PRODUCER
→ GraphicBuffer B91
→ frameNumber F471
→ SurfaceControl transaction
→ SurfaceFlinger Layer L12

PRESENT PATH
L12 / B91 / F471
→ QUEUE
→ ACQUIRE
→ LATCH
→ HWC or CLIENT composition
→ PRESENT_FENCE
→ FrameTracer(L12, B91, F471)

CAPTURE PATH
LayerSnapshot L12
→ externalTexture
→ ExternalTexture.getId()
→ GraphicBuffer.getId() = B91
→ frameNumber F471
→ CaptureManifest(L12, B91, F471)
→ RenderEngine
→ CaptureBuffer C22

JOIN
FrameTracer(L12,B91,F471)
== CaptureManifest(L12,B91,F471)
→ EXACT_LOGICAL_GENERATION_JOIN
```

### System reasoning vs model reasoning

```text
System reasoning:
collect compositor/capture evidence
→ join generations
→ detect stale/diverged state
→ authorize or block action

Model reasoning:
visual/text tokens
→ infer task state
→ choose plan/action
```

Hermes 不應要求模型自行猜 compositor freshness；generation verification 應由 deterministic runtime 完成。

## Bottom-Level Logic

### Identity bridge

```text
LayerSnapshot.externalTexture
→ virtual ExternalTexture::getId()
→ impl::ExternalTexture::getId()
→ getBuffer()->getId()
→ GraphicBuffer::getId()
```

Presentation tracing：

```text
GraphicBuffer
→ bufferId = GraphicBuffer::getId()
→ FrameTracer.traceTimestamp/traceFence(
     layerId,
     bufferId,
     frameNumber,
     event)
```

Capture join：

```text
snapshot.sequence == trace.layerId
AND snapshot.externalTexture.getId == trace.bufferId
AND snapshot.frameNumber == trace.frameNumber
→ SAME_LOGICAL_LAYER_BUFFER_GENERATION
```

Temporal guard：還必須確認 capture snapshot epoch 與 chosen PRESENT event 的 ordering，避免把未 presented 的新 capture generation 錯配到較早 presentation。

### Evidence ladder 更新

```text
SCREENSHOT_ONLY
< TEMPORAL_CORRELATION
< LAYER_MATCH
< LAYER_FRAME_MATCH
< GRAPHIC_BUFFER_ID_MATCH
< EXACT_LOGICAL_GENERATION_JOIN
< REGION_CONTRIBUTION_BOUND
< CAPTURE_PIXEL_BOUND
```

`EXACT_LOGICAL_GENERATION_JOIN` 仍低於 physical-pixel equivalence。

## Visual Simulation Idea

### Presented ↔ Captured Generation Join Microscope

時間軸：

```text
Layer L12
B90/F470 ─ PRESENT P70
B91/F471 ─ PRESENT P71 ─────┐
B92/F472 ─ LATCH            │
                            │
CAPTURE C22                 │
manifest: L12/B91/F471 ─────┘ EXACT JOIN

CAPTURE C23
manifest: L12/B92/F472 → NO PRESENT YET
                         STALE/UNPRESENTED DIVERGENCE
```

互動控制：buffer reuse、frameNumber advance、same buffer/new frame、new buffer/same layer、capture-before-present、retained layer、CLIENT↔DEVICE composition、secure layer omission、effect/sideband layer。

UI 對每個 edge 顯示：`EXACT / TEMPORAL / UNPRESENTED / DIVERGED / STATE-ONLY / UNKNOWN`。

## Code / GitHub

本輪值得看的 AOSP 核心檔案：

- `libs/renderengine/include/renderengine/impl/ExternalTexture.h`
  - `getBuffer()`
  - `getId() { return getBuffer()->getId(); }`
- `libs/renderengine/ExternalTexture.cpp`
  - GraphicBuffer mapping/unmapping lifetime
- `services/surfaceflinger/Layer.cpp`
  - FrameTracer QUEUE/DEQUEUE buffer ID path
  - release callback `{buffer->getId(), frameNumber}`
- `services/surfaceflinger/BufferLayer.cpp`
  - PRESENT_FENCE uses `getCurrentBufferId(), mCurrentFrameNumber`
- `services/surfaceflinger/BufferQueueLayer.cpp`
  - QUEUE/ACQUIRE/LATCH use `mGraphicBuffer->getId()`
- `services/surfaceflinger/CompositionEngine/src/HwcBufferCache.cpp`
  - cache keyed by `buffer->getId()`
- `services/surfaceflinger/FrontEnd/LayerSnapshot*`
  - capture-side `externalTexture + frameNumber + sequence`

## Papers

### CUADebug: Diagnosing and Repairing Computer-Use Agent Failures
Authors: Weijia Zhang et al.
Year: 2026
URL: https://arxiv.org/abs/2608.02643
Dataset: 204 human-annotated failed OSWorld trajectories.
Architecture: tool-augmented debugger actively inspects suspicious before/after screenshots and action traces.
Contribution: turns multimodal failure diagnosis into root-cause localization + corrective re-execution signal.
Limitations: diagnosis remains dependent on evidence quality and benchmark environment.
Change for Hermes: compositor generation witness can become an additional non-visual diagnostic tool rather than asking the VLM to infer stale state.

### AgentHijack: Benchmarking Computer Use Agent Robustness to Common Environment Corruptions
Authors: Jingwei Sun, Jianing Zhu, Yuanyi Li, Tongliang Liu, Xia Hu, Bo Han
Year: 2026
URL: https://arxiv.org/abs/2605.25707
Architecture: configurable environment corruptions + action generator + onlooker environment checker.
Contribution: shows minor environment changes can substantially degrade CUA execution and motivates continuous environment checking.
Limitations: benchmark does not expose compositor-level generation provenance.
Change for Hermes: replace part of heuristic environment checking with deterministic generation revalidation where platform evidence exists.

## Unknown / Open Questions

1. Capture manifest exact logical generation 已閉合，但如何把 target screenshot region 精確綁到 manifest 中哪個 LayerSettings / RenderEngine primitive，仍需 region contribution proof。
2. sideband stream、solid-color/effect layer 沒有普通 GraphicBuffer generation 時，需要 union identity schema；不能用 `(bufferId, frameNumber)` 強行描述所有 layer types。
3. production/non-root Android 是否能從 Perfetto + Winscope + screenshot API 同時取得足夠欄位完成 exact join？若 capture manifest 仍需 SurfaceFlinger instrumentation，Hermes 應定義 graceful evidence downgrade。

## 下一輪研究

上一輪的 identity bridge 已閉合，因此下一輪不應重複追 ID；改追：

```text
CaptureLayerGenerationManifestEntry
→ LayerFE
→ LayerSettings
→ RenderEngine::drawLayers
→ geometry / crop / alpha / transform / source buffer
→ target capture region contribution
→ CaptureBuffer pixel region
```

目標：建立 `CaptureRegionContributionWitness`，回答「capture pixel region R 究竟由哪些 exact logical layer generations 貢獻」。同時補 effect/color/sideband layer union schema。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `GraphicBufferIdentity`
- `LogicalLayerBufferGenerationKey`
- `ExactLogicalGenerationJoin`
- `ExternalTextureGraphicBufferIdentityBridge`
- `FrameTracerBufferIdentity`
- `HwcBufferCacheIdentityWitness`
- `UnpresentedCaptureGenerationState`
- `GenerationRevalidationGate`

### Edges

```text
ExternalTextureIdentity
→exactly_equals→ GraphicBufferIdentity

GraphicBufferIdentity
→used_as→ FrameTracerBufferIdentity

GraphicBufferIdentity
→keys→ HwcBufferCacheIdentityWitness

LayerSnapshotFrameIdentity
+ GraphicBufferIdentity
+ LayerIdentity
→forms→ LogicalLayerBufferGenerationKey

PresentedGenerationKey
↔exact_join↔ CapturedGenerationKey
→produces→ ExactLogicalGenerationJoin

ExactLogicalGenerationJoin
→supports→ CapturePresentationBindingWitness

CapturePresentationBindingWitness
→feeds→ GenerationRevalidationGate
```

## 本輪結束判斷

- 缺哪一層：`exact captured logical generation → target capture-region pixel contribution`。
- 哪個節點最淺：`CaptureRegionContributionWitness`。
- 哪個概念仍只是名詞：跨 buffer/effect/sideband 的統一 `CapturePrimitiveGenerationUnion`。
- 哪個系統值得讀原始碼：AOSP RenderEngine `LayerSettings` / `drawLayers` / Skia or GLES backend 的 per-layer composition path。
- 哪篇論文需追引用：CUADebug，因為 Hermes 現在能加入比 screenshot/action trace 更底層的 deterministic generation evidence。
- 哪個概念最適合視覺模擬：`Presented ↔ Captured Generation Join Microscope`。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + ObservationEnvelope + Exact Generation Join + Active Diagnostic Verifier + PreAction Generation Revalidation + Risk Gate`。

本輪最大的進展：上一輪最關鍵的未知已經閉合。AOSP `ExternalTexture::getId()` 直接等於其 `GraphicBuffer::getId()`，而 FrameTracer 也使用同一 GraphicBuffer ID。Hermes 因此第一次可以在 capture 與 presentation 之間建立原始碼證明的 exact logical buffer-generation join，而不再依賴 timestamp heuristic。下一個真正的底層邊界是「這個 exact generation 是否真的對 Agent screenshot 的 target region pixels 有貢獻」。