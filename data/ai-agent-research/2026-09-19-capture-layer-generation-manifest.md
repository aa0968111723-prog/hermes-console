# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 06:53（Asia/Taipei）

主題：Capture Layer Generation Manifest × LayerSnapshot Identity × Presented/Captured Exact Join

## 本小時新發現

本輪接續上一輪最淺節點 `CaptureLayerMembershipWitness`，直接追 AOSP current `frontend::LayerSnapshot → getLayerSnapshotsForScreenshots → LayerFE → RenderEngine capture`。

核心突破：capture path 內部其實已具備建立「capture 使用了哪一代 layer buffer」manifest 所需的大部分 identity。`LayerSnapshotBuilder` 把 `requested.bufferData->frameNumber` 寫入 `snapshot.frameNumber`，並把 `requested.externalTexture` 寫入 `snapshot.externalTexture`；`LayerSnapshot::getIsVisibleReason()` 更直接把 `externalTexture->getId()` 與 `frameNumber` 同時輸出。`getLayerSnapshotsForScreenshots()` 則依 visible snapshot 遍歷，使用 `snapshot->sequence` 找回 legacy Layer，並把該 snapshot 複製進新建的 LayerFE 後交給 screenshot rendering。

因此，在 SurfaceFlinger 內部 instrumented runtime 中，可建立比「capture timestamp」強很多的：

```text
CaptureLayerGenerationManifestEntry {
  layer_sequence,
  external_texture_id,
  frame_number,
  visible,
  geometry,
  transform,
  crop,
  z_order,
  secure,
  protected_content
}
```

這是「capture render input generation」的 machine-verifiable witness。但標準 ScreenCaptureResults 目前沒有證據顯示會把完整 manifest 對外回傳，因此 production 非侵入式取得仍是缺口。

## 本小時最重要 5 個發現

### 1. LayerSnapshot 已保存 capture generation 所需的 frame identity

**已確認工程實作**：`LayerSnapshotBuilder` 在 snapshot update 時設定：

```text
snapshot.externalTexture = requested.externalTexture
snapshot.frameNumber = requested.bufferData ? requested.bufferData->frameNumber : 0
```

這代表 capture snapshot 並非只有 geometry/state；buffer-backed layer 同時帶著 current ExternalTexture 與 frameNumber。

重要性：上一輪假設的 `CaptureLayerMembershipManifest` 不再只是抽象名詞；至少在 SurfaceFlinger 內部，可以直接從 capture 所使用的 LayerSnapshot 建構。

限制：`frameNumber=0` 可代表沒有 bufferData；sideband/color/effect layer 需要不同 identity schema，不能強迫套用 buffer-generation tuple。

### 2. ExternalTexture ID + frameNumber 比單一 frameNumber 更適合 capture-generation witness

**已確認工程實作**：`LayerSnapshot::getIsVisibleReason()` 對 buffer-backed snapshot 同時輸出 `externalTexture->getId()` 與 `frameNumber`。這表示 AOSP 自己也把 texture/buffer-side identity 與 frame sequence 視為互補資訊。

Hermes 應採：

```text
CaptureBufferGenerationWitness =
(layer_sequence, external_texture_id, frame_number, capture_snapshot_epoch)
```

而不是：

```text
frame_number alone
```

因為 frame number 的 uniqueness domain 不能假定是 system-global。

### 3. getLayerSnapshotsForScreenshots 是最小 instrumentation hook

**已確認工程實作**：current screenshot path 透過 `mLayerSnapshotBuilder.forEachVisibleSnapshot()` 選出 snapshot；以 `snapshot->sequence` 對應 legacy Layer；建立新的 LayerFE，並完整複製 `frontend::LayerSnapshot` 到 `layerFE->mSnapshot`，最後把這組 layers 交給 capture render path。

所以最小 patch 不需要改 RenderEngine pixel shader，也不需要攔截 HWC：只需在 capture snapshot set 確定後、RenderEngine draw 前輸出 manifest，即可得到「這張 capture 的 logical rendering input set」。

推薦 hook：

```text
getLayerSnapshotsForScreenshots()
→ selected LayerSnapshot set
→ emit CaptureLayerGenerationManifest
→ LayerFE copies
→ renderScreenImpl()
→ RenderEngine
```

### 4. Presented/Captured exact join 現在可以被定義，但仍不是 physical scanout equivalence

前輪 FrameTracer 路徑可把 presented layer frame 關聯到 layer/buffer/frame 與 display present timing；本輪 capture path 又能在內部取得 layer sequence + external texture ID + frameNumber。因此 Hermes 可以定義：

```text
PresentedGenerationKey
↕ identity mapping
CapturedGenerationKey
```

若 key 與 epoch 都匹配，可升級成：

```text
SAME_LOGICAL_LAYER_GENERATION
```

但仍不能宣稱：

```text
BYTE_IDENTICAL_PHYSICAL_SCANOUT
```

因為 screenshot 是 RenderEngine 對 snapshot set 的 capture-side rendering；physical display 可能走 DEVICE/HWC overlay、CLIENT target、不同 dataspace/HDR/protected-content branch。

### 5. Agent verifier 應保存「證據來源」而不是只保存 screenshot

2026 的 CUADebug 顯示 computer-use failure diagnosis 必須主動檢查可疑步驟、before/after screenshot 與 action traces，而不是對整段 trajectory 一次性猜原因；另一項對 150 條公開 CUA failure trajectories 的 audit 發現 15.3% FAIL verdict 本身是錯的，且 verification/feedback 與 planning failure 比單純 grounding/execution 更主導真實失敗。

Hermes 因此應把 observation 升級為：

```text
ObservationEnvelope {
  screenshot,
  capture_generation_manifest,
  nearest_presented_generation_set,
  program_state_witness,
  action_trace,
  evidence_strength,
  contradictions[]
}
```

這使 verifier 可以回答「錯在 perception、capture generation、state transition、planning，還是 evaluator 本身」。

## Architecture Breakdown

### Capture Generation Provenance Architecture

```text
App / Browser producer
→ SurfaceControl buffer transaction
→ RequestedLayerState.bufferData
   ├ frameNumber
   └ externalTexture
→ LayerSnapshotBuilder
→ frontend::LayerSnapshot
   ├ sequence
   ├ externalTexture.getId()
   ├ frameNumber
   ├ geometry / transform / crop
   ├ visibility
   ├ secure/protected
   └ z-order/state
→ getLayerSnapshotsForScreenshots
→ CaptureLayerGenerationManifest
→ LayerFE snapshot copy
→ renderScreenImpl
→ RenderEngine
→ Capture GraphicBuffer
→ Capture Fence
→ Image preprocessing
→ Vision Encoder
→ Visual Tokens
→ ObservationEnvelope
→ Reasoning / Plan
→ PreAction Revalidation
→ Action
```

### Presented/Captured join architecture

```text
PRESENT SIDE
Layer/Buffer/Frame
→ latch
→ composition
→ display present witness
→ PresentedGenerationSet

CAPTURE SIDE
LayerSnapshot generation
→ CaptureSnapshotEpoch
→ CaptureLayerGenerationManifest
→ Capture Buffer

JOIN
PresentedGenerationSet
↕ generation-key mapping + temporal constraints
CaptureLayerGenerationManifest
→ CapturePresentationBindingWitness
```

## Bottom-Level Logic

### Manifest construction

```text
CaptureRequest
→ select RenderArea
→ enumerate visible LayerSnapshot
→ for each snapshot:
   sequence
   externalTexture?.getId
   frameNumber
   geomLayerTransform
   crop/bounds
   z/state
   secure/protected
→ freeze manifest under CaptureSnapshotEpoch
→ copy snapshots into LayerFE
→ RenderEngine draw
→ capture fence
→ bind manifest hash to CaptureBufferWitness
```

### Evidence ladder

```text
CAPTURE_BUFFER_ONLY
< CAPTURE_TIMESTAMP
< LAYER_MEMBERSHIP
< LAYER_FRAME_MATCH
< BUFFER_GENERATION_MATCH
< CAPTURE_MANIFEST_BOUND
< PRESENTED_AND_CAPTURED_SAME_LOGICAL_GENERATION
```

仍禁止自動升級為 `PHYSICAL_SCANOUT_EQUIVALENCE`。

## Visual Simulation Idea

### Capture Generation Manifest Inspector

互動 UI 左側顯示 screenshot；右側顯示 capture manifest。點任意 layer/region 後沿時間軸反查：

```text
Screenshot region R
← Capture Buffer CB22
← Manifest M22
   ├ L1 / Tex91 / F471
   ├ L2 / Tex44 / F203
   └ L3 / effect/no-buffer
← Snapshot Epoch E22

Presented set nearest E22
   ├ L1 / Buffer91 / F471  MATCH
   ├ L2 / Buffer43 / F202  DIVERGED
   └ L3 / effect           STATE-MATCH
```

可注入：buffer replacement between present/capture、frameNumber reuse domain、externalTexture replacement、retained layer、secure layer filtering、sideband stream、effect/color layer、HDR transform、capture crop、TOCTOU action delay。

Edge 狀態：`MANIFEST-BOUND / SAME-GENERATION / TEMPORAL / STATE-ONLY / DIVERGED / UNKNOWN / BROKEN`。

## Code / GitHub

本輪值得直接讀的 AOSP 核心檔案：

- `services/surfaceflinger/FrontEnd/LayerSnapshot.h`
- `services/surfaceflinger/FrontEnd/LayerSnapshot.cpp`
- `services/surfaceflinger/FrontEnd/LayerSnapshotBuilder.cpp`
- `services/surfaceflinger/SurfaceFlinger.cpp`
  - `getLayerSnapshotsForScreenshots`
  - `captureScreenCommon`
  - `renderScreenImpl`
- `services/surfaceflinger/LayerFE.*`
- `libs/renderengine/`

關鍵 runtime facts：LayerSnapshotBuilder 寫入 `externalTexture` 與 `frameNumber`；LayerSnapshot debug path 同時顯示 texture id/frame number；screenshot selection 複製完整 LayerSnapshot 到 LayerFE。

## Papers

### CUADebug: Diagnosing and Repairing Computer-Use Agent Failures
Authors: Weijia Zhang et al.
Year: 2026
URL: https://arxiv.org/abs/2608.02643
Architecture: CUAErrorBench + tool-augmented CUADebugger；主動檢查可疑 step 的 before/after screenshots 與 action traces，輸出 root-cause step、error subtype、grounded evidence、repair strategy。
Dataset: 204 human-annotated failed OSWorld trajectories。
Contribution: task reasoning/control 是最大 failure family；RCA guidance 能明顯改善 re-execution。
Limitations: diagnosis accuracy 仍有限，且依賴 trajectory evidence quality。

### How Benchmarks Mis-Score Computer-Use Agents
Authors: Zihan Dong, Zhiyuan Ma, Zekun Wang, Yunqing Li, Zirou Liu, Ruixuan Deng, Qishi Zhan, Rui Qian
Year: 2026
URL: https://arxiv.org/abs/2607.28367
Dataset: audit 150 public failure-scored trajectories across five benchmarks。
Contribution: 15.3% FAIL verdict 錯誤，其中 10.7% evaluator false negatives、4.7% broken tasks；verification/feedback 與 planning failure 是主要 genuine-failure classes。
Limitations: audit sample 為公開 failure trajectories，不代表所有 CUA workload 的完整分布。

### AgentHijack: Benchmarking Computer Use Agent Robustness to Common Environment Corruptions
Authors: Jingwei Sun, Jianing Zhu, Yuanyi Li, Tongliang Liu, Xia Hu, Bo Han
Year: 2026
URL: https://arxiv.org/abs/2605.25707
Architecture: 9 類環境 corruption + action generator + onlooker environment checker。
Contribution: 顯示 pop-up、resolution change、competing app 等非惡意環境變動即可顯著破壞 agent execution，支持 action-time environment checking。
Limitations: robustness benchmark，不直接提供 compositor-level provenance。

## Unknown / Open Questions

1. `externalTexture->getId()` 與 FrameTracer / Layer trace 所使用的 buffer identity 是否能無損一對一映射？目前只能確認 capture snapshot 有 texture id + frameNumber，下一輪需追 ExternalTexture backing 到 GraphicBuffer/BufferId 的 identity bridge。
2. sideband stream、color/effect layer 沒有一般 buffer generation tuple 時，`CaptureLayerGenerationManifest` 應如何建立 union schema？
3. 不修改 AOSP 的 production Android 是否能從 Perfetto/Winscope trace 重建足以與 capture snapshot epoch join 的 manifest？若不能，instrumentation hook 應輸出何種最小資料以降低觀測擾動？

## 下一輪研究

直接追：

```text
LayerSnapshot.externalTexture
→ renderengine::ExternalTexture::getId()
→ GraphicBuffer / BufferId
→ BufferData / producerId / frameNumber
→ FrameTracer buffer identity
→ PresentedGenerationKey
```

目標：閉合 `Capture ExternalTexture ID ↔ Presented Buffer ID` 的 identity bridge，確認 `(layer sequence, buffer identity, frameNumber)` 能否成為 presented/captured exact logical-generation join key。

並補 sideband/effect/color layer 的 manifest union type。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `CaptureLayerGenerationManifest`
- `CaptureLayerGenerationManifestEntry`
- `CaptureBufferGenerationWitness`
- `LayerSnapshotFrameIdentity`
- `ExternalTextureIdentity`
- `CaptureManifestEpoch`
- `CaptureManifestHash`
- `PresentedGenerationKey`
- `CapturedGenerationKey`
- `LogicalGenerationJoinWitness`
- `ManifestEvidenceStrength`

### Edges

```text
RequestedLayerState.bufferData
→supplies→ LayerSnapshotFrameIdentity

RequestedLayerState.externalTexture
→supplies→ ExternalTextureIdentity

LayerSnapshot
→selected_by→ getLayerSnapshotsForScreenshots

CaptureSnapshotEpoch
→freezes→ CaptureLayerGenerationManifest

CaptureLayerGenerationManifest
→describes_inputs_of→ RenderEngineCapture

CaptureLayerGenerationManifest
→bound_to→ CaptureBufferWitness

PresentedGenerationKey
→joins_with→ CapturedGenerationKey

LogicalGenerationJoinWitness
→supports→ CapturePresentationBindingWitness

CapturePresentationBindingWitness
→supports→ ObservationEnvelope
```

## 本輪結束判斷

- 缺哪一層：`Capture ExternalTexture identity → presented GraphicBuffer/FrameTracer buffer identity`。
- 哪個節點最淺：`LogicalGenerationJoinWitness`。
- 哪個概念仍只是名詞：跨 capture/present 的 `StableBufferGenerationKey`。
- 哪個系統值得讀原始碼：AOSP `renderengine::ExternalTexture`、GraphicBuffer identity、FrameTracer buffer-id path。
- 哪篇論文需追引用：CUADebug，因為它把 multimodal causal localization 直接轉成可修復 agent loop。
- 哪個概念最適合視覺模擬：`Capture Generation Manifest Inspector`。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + ObservationEnvelope + Capture/Presentation Evidence DAG + Active Diagnostic Verifier + PreAction Revalidation + Risk Gate`。

本輪把上一輪仍屬假說的 `CaptureLayerMembershipManifest` 推進成可由 SurfaceFlinger capture snapshot 內部資料直接構造的工程方案。真正剩下的 identity 硬點已不再是「capture 有沒有 layer/frame 資訊」，而是 `ExternalTexture ID` 如何與 presentation tracing 使用的 buffer identity 精確對齊。