# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 12:55（Asia/Taipei）

主題：DebugCanvas Command Ablation × Replay Resource Sharing × PixelEffectMask

## 本小時新發現

本輪接續 11:51 的 `ReplayFidelityEnvelope`，不再重複「SKP 可 replay」本身，而是回答上一輪明確留下的工程問題：是否存在可實作的 `command range → suppress → replay → target crop diff` 路徑？答案是 **有，而且 Skia DebugCanvas 原始碼已直接提供 command-level visibility gate**。

證據階梯推進：

```text
DRAW_COMMAND_BOUND
→ REPLAY_RESOURCE_BOUND
→ REPLAY_BACKEND_BOUND
→ COMMAND_ABLATION_BOUND        [本輪閉合可實作路徑]
→ COUNTERFACTUAL_PIXEL_BOUND    [本輪可直接建立]
→ CAPTURE_PIXEL_BOUND           [仍需 production equivalence]
→ VISION_TOKEN_REGION_BOUND
```

## 本小時最重要 5 個發現

### 1. DebugCanvas 已有真正的 command suppression primitive

**已確認 / Skia 原始碼**：`DebugCanvas::drawTo()` 逐一走訪 `fCommandVector`，只有 `DrawCommand::isVisible()` 為 true 才執行 command；`DebugCanvas::toggleCommand(index, bool)` 直接呼叫 `setVisible(toggle)`。

因此不需要先 fork 一套 SkPicture interpreter，就能實作：

```text
MSKP frame
→ DebugCanvas command vector
→ toggleCommand(i, false)
→ drawTo(output)
→ target crop
→ compare with baseline
```

這是上一輪要求的最小 command-ablation loop。

限制：關掉 stateful command（save/restore/clip/matrix）可能改變後續 command semantics；因此 attribution 必須區分 `DRAW_COMMAND` 與 `STATE_COMMAND`，不能盲目逐 index ablate。

### 2. DebugCanvas 不只 replay command，還保留 Android offscreen-layer dependency semantics

**已確認 / Skia 原始碼**：Android offscreen layer 在 DebugCanvas 不是普通靜態 image；`DrawImageRectLayerCommand` 會在 replay 時向 `LayerManager` 取得該 frame/index 對應的 layer image。這意味著 Hermes 若只做 flat command deletion，可能漏掉 offscreen surface / blur / saveLayer dependency。

正確模型：

```text
CommandGraph
├ direct draw command
├ state command
└ deferred/offscreen dependency
      ↓
  LayerManager / frame
      ↓
  reconstructed layer image
```

因此 `PixelEffectMask` 應依賴 command dependency graph，而不只是 command list。

### 3. MultiPictureDocument 已有 image-sharing serialization/deserialization test path

**已確認 / Skia tests**：`MultiPictureDocumentTest` 使用 `SkSharingSerialContext::serializeImage` 配置 `SkSerialProcs.fImageProc`，反序列化則用 `SkSharingDeserialContext::deserializeImage`，並建立多 frame picture document。測試目的就是確認 serialization/deserialization 後 pictures 能被準確重建。

這修正上一輪較保守的敘述：不是「MSKP image resource fidelity 沒有路」，而是 **存在 explicit shared-image serialization path，但 Hermes 仍必須確認 Android RenderEngine capture 實際採用的 procs 與 protected/sideband path**。

### 4. Pixel attribution 可以先採「group ablation + state closure」，避免 invalid replay

**工程模型 / 基於 DebugCanvas semantics 的合理推論**：若只關閉 `drawRect`，通常可保持 canvas state；若關閉 `save`、`clip`、`concat`、`restore`，後續 command 的 coordinate/clip stack 可能失真。

Hermes 應先建立：

```text
AblationGroup {
  generation_key
  draw_commands[]
  required_state_prefix[]
  offscreen_dependencies[]
  annotation_interval
}
```

執行 ablation 時保留 state commands，只 suppress 該 generation/effect 的 output-producing draw commands；需要研究 state contribution 時，使用 separate state-counterfactual mode。

### 5. 上層 Agent verifier 應把 active perception 與 pixel provenance 結合

**論文結果**：GUI-Eyes（2026）把 GUI perception 從一次 screenshot 改為 agent 主動決定是否、何時、如何 crop/zoom；ScreenSpot-Pro 報告 GUI-Eyes-3B 以 3k labeled samples 達 44.8% grounding accuracy。HiViG 則在 action 執行前以 current screenshot 做 visually grounded coordinate critique。

Hermes 可把兩者提升為 provenance-aware active perception：不是只「zoom 一下」，而是當 target-region evidence 弱時，要求 fresh capture + generation join + region/pixel verifier，再決定 ALLOW / REOBSERVE。

## Architecture Breakdown

### System architecture：Hermes Counterfactual Pixel Attribution Runtime v0.3

```text
Production Observation
├ CaptureBuffer
├ GenerationManifest
├ MSKP / frame
└ ReplayFidelityEnvelope
       ↓
MSKP Decode
       ↓
DebugCanvas
├ command vector
├ annotations
├ matrix / clip state
└ offscreen LayerManager dependencies
       ↓
Command Dependency Classifier
├ DRAW_OUTPUT
├ STATE_ONLY
├ OFFSCREEN_PRODUCER
├ EFFECT_CONSUMER
└ UNKNOWN
       ↓
AblationGroup Builder
       ↓
Baseline Replay B(R)
       ↓
select group Gi
→ toggle output commands false
→ preserve state closure
→ replay Bi(R)
       ↓
PixelEffectMask_i = diff(B(R), Bi(R))
       ↓
CounterfactualPixelWitness
       ↓
Replay Fidelity Gate
       ↓
CapturePixelAttributionManifest
```

### Bottom-Level Logic：DebugCanvas visibility gate

```text
for command i in [0..index]:
    maintain replay order
    if command[i].isVisible():
        command[i].execute(canvas)

Hermes ablation:
    DebugCanvas.toggleCommand(i, false)
    DebugCanvas.drawTo(output, finalIndex)
    crop = output[targetRegion]
    delta = compare(baselineCrop, crop)
```

重要：`toggleCommand()` 是已存在的 machine-level suppression primitive；真正研究難點已從「能不能 suppress」轉成「哪些 commands 應視為同一 causal group，以及 replay 是否 production-equivalent」。

## Visual Simulation Idea

### Command Ablation × Pixel Effect Graph

```text
Generation L12/B91/F471
   │
   ├─ #120 Annotation
   ├─ #121 Save             [STATE]
   ├─ #122 Concat           [STATE]
   ├─ #123 ClipRRect        [STATE]
   ├─ #124 DrawRect         [OUTPUT] ─────┐
   ├─ #125 Restore          [STATE]       │
   │                                      ↓
   └──────────────────────────── Target Region R

Blur group
Prior Composite → Offscreen Snapshot → Blur → DrawBlurRegion → R
```

UI 操作：點 generation/effect group → 「Counterfactual Off」→ 保留必要 state closure → replay → 疊加 PixelEffectMask；旁邊固定顯示 `BYTE_EXACT / NUMERIC / REPLAY_ONLY` fidelity badge。

## Code / GitHub / Source

本輪值得看的核心原始碼：

- `tools/debugger/DebugCanvas.cpp`
  - `drawTo()`：command loop + `isVisible()` gate。
  - `toggleCommand()`：直接設定 command visibility。
  - Android offscreen layer handling：deferred `DrawImageRectLayerCommand`。
  - `drawAndCollectOps()`：GPU audit trail / command-to-op observation。
- `tools/debugger/DrawCommand.cpp`：command metadata 包含 visible、matrix、bounds、paint、blendMode、sampling 等。
- `tests/MultiPictureDocumentTest.cpp`：shared image serial/deserial context 與 multi-frame reconstruction。
- 下一輪值得追：Android RenderEngine `SkiaCapture` 實際傳入 MultiPictureDocument 的 `SkSerialProcs`，以及 DebugLayerManager 的 offscreen frame dependency。

來源：
- https://skia.googlesource.com/skia/+/0f7aa54e433deadebc664b5e126dbda9d6eaba9c/tools/debugger/DebugCanvas.cpp
- https://skia.googlesource.com/skia/+/907ce248d98dd6cdddda262afb52479bf5b0ab50/tools/debugger/DrawCommand.cpp
- https://skia.googlesource.com/skia/+/2baabb43c8f9b327b4b72da795ff43812c725208/tests/MultiPictureDocumentTest.cpp
- https://skia.googlesource.com/skia/+/main/include/core/SkSerialProcs.h

## Papers

### GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents
Authors: Chen Chen, Jiawei Shao, Dakuan Lu, Haoyi Hu, Xiangcheng Liu, Hantao Yao, Wu Liu
Year: 2026
URL: https://arxiv.org/abs/2601.09770
Architecture: two-stage coarse exploration → fine-grained grounding；policy 主動選擇是否/如何使用 crop、zoom 等 visual tools。
Contribution: ScreenSpot-Pro 上 GUI-Eyes-3B 使用 3k labeled samples 報告 44.8% grounding accuracy。
Limitations: 不提供 compositor/pixel provenance。
Change for Hermes: active perception tool invocation應由 provenance uncertainty驅動。

### A History-Aware Visually Grounded Critic for Computer Use Agents (HiViG)
Authors: Jaewoo Lee et al.
Year: 2026
URL: https://arxiv.org/abs/2606.11078
Architecture: macro-action history + visually grounded pre-execution critic。
Contribution: 對 strongest baseline，Qwen3-VL-32B 平均 success +5.8%，Gemini-3-Flash +9.0%。
Limitations: critic仍以視覺 observation 為主，沒有 OS render provenance。
Change for Hermes: current-screenshot coordinate verification可再加入 generation/pixel evidence。

### ActionEngine: From Reactive to Programmatic GUI Agents via State Machine Memory
Authors: Hongbin Zhong et al.
Year: 2026
URL: https://arxiv.org/abs/2602.20502
Architecture: Crawling Agent建立 state-machine memory；Execution Agent生成 executable Python；失敗時 vision re-ground + memory repair。
Contribution: WebArena Reddit tasks 報告 95% success、平均單次 LLM call、相對 vision-only baseline 66%，cost 11.8× lower、latency 2× lower。
Limitations: 不解決 screenshot provenance / render-level TOCTOU。
Change for Hermes: state-machine memory可以保存 `state node → expected generation/provenance signature`，執行前做低成本 mismatch gate。

## Unknown / Open Questions

1. Android RenderEngine `SkiaCapture` 現行版本實際使用哪一組 `SkSerialProcs` / image sharing context？GraphicBuffer-derived SkImage 在 MSKP 中的 resource identity能保留到什麼程度？
2. `toggleCommand()` 對 saveLayer / clip / matrix / offscreen layer graph 的合法 ablation closure應如何自動計算，才能避免產生語義無效的 replay？
3. GPU `GrAuditTrail` / Graphite tracing能否把 DebugCanvas command進一步綁到 production-equivalent GPU op，讓 `COUNTERFACTUAL_PIXEL_BOUND` 再往 `CAPTURE_PIXEL_BOUND` 推進？

## 下一輪研究

直接追：

```text
Android RenderEngine SkiaCapture
→ MultiPictureDocument creation
→ SkSerialProcs
→ GraphicBuffer-backed SkImage serialization
→ shared resource ID
→ MSKP deserialize
→ DebugLayerManager
→ offscreen dependency graph
→ DebugCanvas command group
→ valid ablation closure
→ GPU op / output crop
```

成功條件：確認 Android MSKP capture 的 image resource serializer，並建立至少一種不破壞 state stack 的 generation-level command group ablation規則。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `DebugCanvasCommandVisibilityWitness`
- `CommandAblationWitness`
- `CommandDependencyClass`
- `AblationGroup`
- `StateClosureWitness`
- `OffscreenLayerDependency`
- `DeferredLayerImageWitness`
- `SharedImageSerializationWitness`
- `CounterfactualPixelWitness`
- `ProvenanceDrivenActivePerception`

新增 Edges：

```text
MSKPFrame
→ DECODED_INTO → DebugCanvasCommandStream

DrawCommandWitness
→ CONTROLLED_BY → DebugCanvasCommandVisibilityWitness

DebugCanvasCommandVisibilityWitness
→ ENABLES → CommandAblationWitness

AblationGroup
→ PRESERVES → StateClosureWitness

OffscreenLayerDependency
→ RESOLVED_BY → DebugLayerManager

CommandAblationWitness
→ PRODUCES → CounterfactualReplayWitness

CounterfactualReplayWitness
→ DIFFS_TO → PixelEffectMask

PixelEffectMask
→ SUPPORTS → CounterfactualPixelWitness

CounterfactualPixelWitness
→ VALID_ONLY_UNDER → ReplayFidelityEnvelope

ProvenanceUncertainty
→ TRIGGERS → ProvenanceDrivenActivePerception
```

## 本輪結束判斷

- 缺哪一層：`COUNTERFACTUAL_PIXEL_BOUND → production-equivalent CAPTURE_PIXEL_BOUND`。
- 哪個節點最淺：`StateClosureWitness`，因為 state/offscreen commands 的合法 ablation closure 尚未形式化。
- 哪個概念仍只是名詞：`PhysicalPixelCausalWeight`。
- 哪個系統值得讀原始碼：Android RenderEngine `SkiaCapture` serializer + Skia `DebugLayerManager` / GPU audit trail。
- 哪篇論文需追引用：GUI-Eyes，尤其 active perception 是否可由 uncertainty/provenance verifier驅動；HiViG則直接適合 pre-action gate。
- 哪個概念最適合視覺模擬：Command Ablation × Pixel Effect Graph。
- 哪個 Agent 架構最值得實作：`State-machine Memory + Provenance-driven Active Perception + History-aware Critic + PreAction Generation/Pixel Revalidation`。

本輪最重要結論：**上一輪的「command-range suppression是否需要自己 fork renderer」已被回答：Skia DebugCanvas 本身已有 `toggleCommand → isVisible → execute` 的 command-level suppression path。下一個真正難點不是關掉 command，而是建立合法的 causal ablation group：保留必要 matrix/clip/save state，同時正確處理 Android offscreen layer與 effect dependencies，再把 replay delta在 ReplayFidelityEnvelope 下升級為可信的 pixel evidence。**