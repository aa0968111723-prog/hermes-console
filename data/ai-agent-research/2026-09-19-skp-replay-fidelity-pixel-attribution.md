# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 11:51（Asia/Taipei）

主題：SKP/MSKP Replay Fidelity × Resource Serialization × Pixel Attribution Boundary

## 本小時新發現

本輪接續 10:53 的 `DRAW_COMMAND_BOUND → COUNTERFACTUAL_PIXEL_BOUND`，不再重複 LayerSettings / GraphicBuffer identity。核心突破是：Skia 官方工具鏈已經提供「逐 draw command replay + pixel-change breakpoint + CPU/GPU backend」的可操作觀測面，但 `SkPicture` 的一般 serialization 對 image resource 有重要陷阱：預設 image encoder 可以是 null，因此不能假設任意 SKP 都完整保存 production texture。Android RenderEngine 的 MSKP capture/Debugger 路徑則額外保存 image-resource metadata，適合成為 Hermes replay fidelity verifier 的基礎。

本輪證據階梯：

```text
EXACT_LOGICAL_GENERATION_JOIN
→ PRIMITIVE_BOUND
→ REGION_COMPOSITION_BOUND
→ DRAW_COMMAND_BOUND
→ REPLAY_RESOURCE_BOUND          [本輪]
→ REPLAY_BACKEND_BOUND           [本輪]
→ COUNTERFACTUAL_PIXEL_BOUND     [可實作]
→ CAPTURE_PIXEL_BOUND            [仍需 production equivalence]
→ VISION_TOKEN_REGION_BOUND
```

## 本小時最重要 5 個發現

### 1. Skia Debugger 已提供 pixel-oriented command replay primitive

**已確認 / Skia 官方文件**：Skia Debugger 可以逐 draw command playback，顯示當下 clip 與 matrix，使用 crosshair 選 pixel，並可設定「當 pixel color 改變時停止」的 breakpoint；也支援 CPU/GPU backed execution、GPU op bounds、Android offscreen layer visualization 與 shared resource viewer。

底層：

```text
SKP/MSKP
→ Frame
→ Ordered Draw Commands
→ Command Playback
→ Current Matrix / Clip
→ Pixel Crosshair
→ Pixel Color Change Breakpoint
```

重要性：Hermes 第一版 pixel causality debugger 不必先自行重建 Skia command interpreter；可以直接以官方 Debugger semantics 作 oracle，再把 generation annotations join 回 draw intervals。

限制：Debugger replay 是 replay evidence，不是 production GPU physical execution trace。

來源：Skia Debugger 官方文件。

### 2. `SkPicture::playback()` 確認 command stream 可逐 command 重放，但 serialization resource completeness 不是自動保證

**已確認 / Skia API**：`SkPicture::playback(canvas)` 會把已記錄的 commands 逐一送到 canvas。`SkPicture::serialize()` 支援 custom `SkSerialProcs`；官方 API 特別指出 image serialization 需要正確 image proc，否則不能假設 image resource 會自動完整內嵌。

因此 replay provenance 必須拆成：

```text
Command Fidelity
+
Resource Fidelity
+
Backend Fidelity
+
Color/Precision Fidelity
=
Replay Fidelity Envelope
```

不能只看到 SKP 可開啟，就宣稱 replay 與 production capture 等價。

### 3. Android RenderEngine capture 是比一般 SKP 更合適的研究入口

**已確認 / Skia Android capture 官方文件**：RenderEngine 可透過 `frameworks/native/libs/renderengine/skia/debug/record.sh` 擷取一段時間內 RenderEngine 處理的 frames，輸出 MSKP；官方文件也指出 capture serialization 完成有時間差，過早複製可能得到 truncated file。

工程意義：Hermes 應記錄 capture lifecycle witness：

```text
CaptureStart
→ Recording Window
→ Frame Sequence
→ SerializationComplete
→ File Hash
→ Resource Inventory
→ Replay Validation
```

而不是只保存一個 `.mskp` 路徑。

### 4. Counterfactual attribution 必須先通過 baseline replay equivalence gate

**合理工程推論，建立在官方 replay/serialization行為上**：在做 primitive ablation 前，先比較「未修改 replay」與 production capture buffer 的 target-region hash / perceptual diff。如果 baseline 本身不一致，後續 ablation delta 只能標記 `REPLAY_MODEL_EFFECT`，不能升級為 `CAPTURE_PIXEL_EFFECT`。

建議 evidence gate：

```text
Production Capture Crop P(R)
Baseline Replay Crop B(R)

if exact_hash(P)==exact_hash(B):
    BYTE_EXACT_REPLAY
elif bounded_error(P,B) <= epsilon:
    NUMERICALLY_EQUIVALENT_REPLAY
else:
    NON_EQUIVALENT_REPLAY
```

只有前兩級才允許 counterfactual result 進入高可信 attribution manifest。

### 5. Agent verifier 應把 provenance evidence 與 program-state evidence分開，避免「看起來對」就授權

**論文結果**：StateAct 顯示 screenshot 是 program state 的 lossy rendering，並以 program-state verification提升長流程 agent 成功率；2026-09-10 的 AgentCIBench 又顯示跨應用 context disclosure 是實際 CUA 風險，15 個 frontier agents 中 11 個在超過一半情境洩漏資訊，平均 leakage 67.9%。

對 Hermes 的改變：pixel provenance回答「Agent 看見的 target region從哪裡來」，program-state/context policy回答「即使看見，這些資料是否應該被使用/傳送」。兩者不能合併成單一 confidence score。

## Architecture Breakdown

### System architecture：Hermes Replay Fidelity & Pixel Attribution Runtime v0.2

```text
Production Capture
├ CaptureBuffer
├ CaptureFence
├ CaptureLayerGenerationManifest
└ SkiaCapture MSKP
        ↓
Replay Intake
├ file hash
├ serialization-complete witness
├ image/resource inventory
├ frame index
├ backend config
└ color-space/config
        ↓
Baseline Replay
├ CPU replay
├ GPU replay
└ target-region crop
        ↓
Replay Fidelity Gate
├ BYTE_EXACT_REPLAY
├ NUMERICALLY_EQUIVALENT_REPLAY
└ NON_EQUIVALENT_REPLAY
        ↓
DrawCommandGraph
        ↓
Candidate command/group ablation
        ↓
PixelEffectMask
        ↓
CapturePixelAttributionManifest
        ↓
ObservationEnvelope
        ↓
PreAction Verifier / Risk Gate
```

### Bottom-level mechanism：Replay Fidelity Envelope

```text
ReplayFidelityEnvelope {
  mskp_hash
  frame_index
  command_stream_hash
  resource_inventory_hash
  image_resource_count
  backend
  gpu_driver_or_cpu_renderer
  output_color_type
  output_color_space
  surface_size
  baseline_exact_hash
  baseline_error_metric
  fidelity_class
}
```

最重要的規則：`COUNTERFACTUAL_PIXEL_BOUND` 必須依附在一個 `ReplayFidelityEnvelope`，否則 provenance graph 無法區分「真實 capture 的因果證據」與「另一個 renderer 模型中的反事實」。

## Visual Simulation Idea

### Replay Fidelity × Pixel Causality Lab

上方：production vs replay

```text
Production Capture C22       Replay Frame R22
hash: 91ab...                hash: 91ab...
backend: Android GPU         backend: GPU
status: BYTE_EXACT_REPLAY
```

中間：draw timeline

```text
#120 annotate L12/B91/F471
#121 concat matrix
#122 clipRRect
#123 drawRect(image shader)
#124 snapshot Surface#31
#125 blur
#126 drawBlurRegion
```

右側 target pixel `(x,y)`：

```text
baseline RGBA: ...
last color-changing command: #126
candidate generation: L12/B91/F471
ablate #123 → changed
ablate blur group → changed
```

底部必須固定顯示 evidence badge：

`PRODUCTION_CAPTURE` / `BYTE_EXACT_REPLAY` / `NUMERIC_REPLAY` / `REPLAY_ONLY`

## Code / GitHub / Source

本輪值得看的原始碼/工具：

- Skia Debugger：command playback、matrix/clip、pixel breakpoint、CPU/GPU replay。
- `SkPicture` API：`playback()`、`serialize()`、`SkSerialProcs`。
- Android RenderEngine capture script：`frameworks/native/libs/renderengine/skia/debug/record.sh`。
- AOSP RenderEngine `SkiaCapture.*`：MSKP recording / serialization lifecycle。
- 下一輪需直接追 Skia debugger 的 command filtering / DebugCanvas 實作，以及 Android MSKP image-resource serializer，確認能否穩定做 command-group suppression。

官方來源：
- https://skia.org/docs/dev/tools/debugger/
- https://skia.org/docs/dev/tools/android-capture/
- https://api.skia.org/classSkPicture.html

## Papers

### StateAct: Program State, before Pixels, for Long-Horizon Computer-Use Agents
Authors: Yan Yang, Xiangru Jian, Ziyang Luo, Zirui Zhao, Yutong Dai, Ziji Shi, Hanshu Yan, Jun Hao Liew, Silvio Savarese, Junnan Li
Year: 2026
URL: https://arxiv.org/abs/2607.22798
Architecture: code-first main agent + dedicated GUI subagent + independent finish gate + fresh subagents for long horizon context control.
Contribution: OSWorld 2.0 binary success 20.6%→26.9%，partial 54.8%→61.6%，並報告約 9× lower cost/task than screenshot-only setup。
Limitations: 不處理 compositor / pixel provenance。
Change for Hermes: program-state witness與render/pixel witness應是互補證據軸。

### Capable but Careless: Do Computer-Use Agents Follow Contextual Integrity?
Authors: Anmol Goel, Iryna Gurevych
Institution: TU Darmstadt / ATHENE
Year: 2026
URL: https://arxiv.org/abs/2606.23189
Code: UKPLab/arxiv2026-agentcibench
Dataset: AgentCIBench
Architecture: executable deterministic scenarios for visual co-location、task ambiguity overshare、recipient misalignment。
Contribution: 15 agents中11個在超過50% scenarios洩漏，平均 leakage 67.9%。
Limitations: context disclosure benchmark，不研究 low-level rendering。
Change for Hermes: provenance不等於 authorization；ObservationEnvelope應增加 `context_policy_witness`。

### Efficient GUI Agents: A Systems Survey of Observation, Memory, Action, and Runtime Optimization
Authors: Bizhe Bai et al.
Year: 2026
URL: https://arxiv.org/abs/2609.02309
Contribution: 以 observation/context-memory/action/planner-runtime 的 end-to-end systems lens整理 GUI agent efficiency，指出 verification-aware control 與 hybrid runtime 是共同趨勢。
Limitations: survey，不提供 compositor provenance implementation。
Change for Hermes: replay verifier成本必須被正式記帳，不能把安全/驗證當成免費附加層。

## Unknown / Open Questions

1. Android RenderEngine MSKP 的 image-resource serialization在各 buffer/effect path上是否足以重建與 production capture byte-exact 的 input resources？protected/sideband content如何表示？
2. Skia Debugger/DebugCanvas 是否能以穩定 machine API 做 command-range suppression，還是 Hermes需要 fork一個 replay runner？
3. GPU replay與production RenderEngine在driver、precision、runtime shader、HDR/tone-map條件下，哪一些情境可達 byte exact，哪些只能 bounded numeric equivalence？

## 下一輪研究

直接追：

```text
MSKP
→ MultiPictureDocument / serializer
→ image resource table
→ SkPicture deserialization
→ DebugCanvas
→ command index / filter
→ CPU/GPU replay
→ output surface
→ baseline production diff
→ command-group ablation
→ PixelEffectMask
```

下一輪成功條件：至少找到一條可實作的 `command range → suppress → replay → target crop diff` 原始碼路徑，並明確定義 production-equivalence test matrix。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `ReplayFidelityEnvelope`
- `ReplayResourceInventory`
- `SerializationCompletionWitness`
- `ReplayBackendIdentity`
- `BaselineReplayWitness`
- `ByteExactReplayWitness`
- `NumericallyEquivalentReplayWitness`
- `NonEquivalentReplayState`
- `PixelColorChangeBreakpointWitness`
- `ContextPolicyWitness`

新增 Edges：

```text
SkiaCaptureTrace
→ SERIALIZES_TO → MSKP

MSKP
→ CONTAINS → ReplayResourceInventory

MSKPFrame
→ REPLAYS_AS → BaselineReplayWitness

BaselineReplayWitness
→ COMPARED_WITH → ProductionCaptureBuffer

BaselineReplayWitness
→ CLASSIFIED_BY → ReplayFidelityEnvelope

DrawCommandWitness
→ COUNTERFACTUALLY_ABLATED_IN → ReplayBackendIdentity

CounterfactualReplayWitness
→ PRODUCES → PixelEffectMask

PixelEffectMask
→ VALID_ONLY_UNDER → ReplayFidelityEnvelope

ObservationEnvelope
→ REQUIRES_FOR_DISCLOSURE → ContextPolicyWitness
```

## 本輪結束判斷

- 缺哪一層：`replay fidelity → production-equivalent pixel attribution`。
- 哪個節點最淺：`ByteExactReplayWitness`，目前有工具鏈但尚未建立 Android production capture vs replay 的實測矩陣。
- 哪個概念仍只是名詞：`PhysicalPixelCausalWeight`。
- 哪個系統值得讀原始碼：Skia Debugger / DebugCanvas + Android RenderEngine MSKP serializer。
- 哪篇論文需追引用：StateAct；另外 AgentCIBench 值得納入 Hermes action/data authorization branch。
- 哪個概念最適合視覺模擬：Replay Fidelity × Pixel Causality Lab。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Render Provenance Verifier + Context Policy Gate + PreAction Revalidation`。

本輪最重要的結論：**Hermes 現在不該直接把 SKP/MSKP counterfactual replay 當成 capture pixel ground truth。真正需要補上的，是 Replay Fidelity Envelope：先證明 command、resource、backend、color/precision 條件下 baseline replay能重建 production capture，再讓 ablation delta升級為高可信 pixel attribution。這把下一階段從「可 replay」推進成「知道 replay 證據到底有多可信」。**