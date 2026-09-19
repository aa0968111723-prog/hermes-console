# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 10:53（Asia/Taipei）

主題：SkiaCapture × Draw-Command Trace × Counterfactual Pixel Attribution

## 本小時新發現

本輪接續 09:53 的 `REGION_COMPOSITION_BOUND → CAPTURE_PIXEL_BOUND`，不再重複 GraphicBuffer / LayerSnapshot identity。核心突破是：AOSP RenderEngine 其實已經存在一個比「自行發明 contributor-ID buffer」更接近 production draw semantics 的觀測入口——`SkiaCapture`。

`SkiaCapture` 能把 RenderEngine 送進 Skia 的 frame 記成 multi-frame SKP/MSKP command stream；當 capture 啟用時，`SkiaRenderEngine::drawLayersInternal()` 會在每個 layer draw 前把完整 `LayerSettings` 以 `drawAnnotation()` 寫入 command stream。Blur 使用 offscreen surface 時，也會保存 `SurfaceID` annotation。這表示 Hermes 可以先建立「Draw Command Provenance Trace」，把 logical generation / LayerSettings 與真正的 SkCanvas draw sequence 綁在一起，而不是只停在 drawLayers() input manifest。

本輪證據階梯：

```text
EXACT_LOGICAL_GENERATION_JOIN
→ PRIMITIVE_BOUND
→ REGION_CANDIDATE
→ REGION_COMPOSITION_BOUND
→ DRAW_COMMAND_BOUND          [本輪]
→ COUNTERFACTUAL_PIXEL_BOUND  [可實作研究方案]
→ CAPTURE_PIXEL_BOUND         [仍需驗證]
→ VISION_TOKEN_REGION_BOUND
```

## 本小時最重要 5 個發現

### 1. AOSP 已有 production-adjacent Skia command capture，不必從零打造 draw tracer

**已確認 / AOSP source**：`SkiaCapture` 的目的就是 capture RenderEngine 送往 Skia 的 frames，並序列化成 multi-frame SKP/MSKP；`tryCapture()` 在 capture 開啟時回傳 recording/N-way canvas，正常路徑則使用 screen canvas。

底層：

```text
SurfaceFlinger / RenderEngine
→ drawLayersInternal()
→ SkCanvas
→ SkiaCapture::tryCapture()
→ recording/N-way canvas
→ Skia draw command stream
→ multi-frame SKP/MSKP
```

重要性：Hermes 的 provenance instrumentation 可以優先復用 Skia command recording，而不是侵入每個 GPU backend shader。

限制：SKP 是 draw-command / semantic render trace，不是 GPU physical execution trace，也不直接等於每 pixel 的 source attribution。

來源：
- https://android.googlesource.com/platform/frameworks/native/+/f76775af4374b9cdda21cc1616cf0fd6937d4c13/libs/renderengine/skia/debug/SkiaCapture.h
- https://android.googlesource.com/platform/frameworks/native/+/180f95b4641e4bdf66a6586d2fbf43c1defb2d81/libs/renderengine/skia/SkiaRenderEngine.cpp

### 2. LayerSettings 已被直接寫進 draw command stream，可形成 `Layer → DrawCommand` 邊

**已確認工程實作**：在每個 layer 開始 render 時，若 capture running，RenderEngine 會 `PrintTo(layer, ...)`，再用 `canvas->drawAnnotation(...)` 把 layer name 與完整 LayerSettings 字串寫進 Skia command stream；之後才 concat layer position transform、算 bounds/clip、執行 blur/shadow/content draw。

因此可以建立：

```text
LogicalLayerGeneration
(layerId, bufferId, frameNumber)
→ LayerSettingsAnnotation
→ SkiaCommandInterval
→ drawShadow / blur / drawRect / drawRRect
```

這比上一輪的 `CompositionInputManifest` 多一層：不只知道「準備畫什麼」，還知道「真正送出了哪些 SkCanvas commands」。

限制：annotation 目前主要是 human/debug metadata；若要 machine join `(layerId, bufferId, frameNumber)`，Hermes fork/instrumentation 應把 structured generation key 明確寫入 annotation，而不是只 parse PrintTo 字串。

來源：
- https://android.googlesource.com/platform/frameworks/native/+/180f95b4641e4bdf66a6586d2fbf43c1defb2d81/libs/renderengine/skia/SkiaRenderEngine.cpp

### 3. 真正的 content draw 是「Paint shader + bounds draw」，不是單純 drawImageRect

**已確認**：buffer-backed layer 先取得 backend texture / SkImage、等待 source fence，再把 image / runtime effects / color pipeline 組進 `SkPaint`；最後依 geometry 走 `canvas->drawRRect(bounds, paint)` 或 `canvas->drawRect(bounds.rect(), paint)`。Rounded clip 會先 `clipRRect`。

因此 pixel provenance 應建模成：

```text
GraphicBuffer generation
→ SkImage
→ shader / runtime effect
→ SkPaint
→ canvas transform
→ clipRRect?
→ drawRect / drawRRect
→ destination coverage
```

這修正一個容易產生的錯誤心智模型：source texture 並不是一定透過一個顯式 `drawImageRect(source,destination)` 命令直接落到 output；source sampling可能已封裝在 paint shader/effect graph 裡。

來源：
- https://android.googlesource.com/platform/frameworks/native/+/180f95b4641e4bdf66a6586d2fbf43c1defb2d81/libs/renderengine/skia/SkiaRenderEngine.cpp

### 4. Blur provenance 是「snapshot prior composite → generate → drawBlurRegion」，天然需要 multi-source dependency

**已確認**：當 blur 需要 offscreen composition，RenderEngine 會先 `makeImageSnapshot()` 保存 active surface；background blur/blur regions再從這個 prior composite 生成 blurred image並 draw 回 canvas。當 offscreen capture 結束時，AOSP 還會寫入 `SurfaceID` annotation，再把 offscreen image blit 到 destination。

因此 blur 的 provenance 不是：

```text
BlurLayer → Pixel
```

而是：

```text
PriorDrawCommandSet
→ OffscreenSurfaceSnapshot
→ BlurFilter.generate
→ BlurRegion
→ DestinationDrawCommand
```

這使 `CompositionDependencyHyperedge` 可以進一步具體化成 `OffscreenSnapshotDependency`。

來源：
- https://android.googlesource.com/platform/frameworks/native/+/180f95b4641e4bdf66a6586d2fbf43c1defb2d81/libs/renderengine/skia/SkiaRenderEngine.cpp

### 5. 最可行的 exact attribution 研究路線可能是「command trace + counterfactual replay」，而非 production ID buffer

**合理工程推論 / 尚待 prototype 驗證**：既然 SKP/MSKP 保存 draw commands、layer annotations與 offscreen structure，Hermes 可以在 debug/research mode對同一 frame做 deterministic replay，針對 target region R 進行 counterfactual ablation：

```text
Baseline replay → P0(R)
Disable primitive/group Gi → Pi(R)
Delta_i(R) = difference(P0(R), Pi(R))
```

若 `Delta_i(R) != 0`，則 Gi 對 R 有可觀測 causal effect。這比 geometry overlap更強，且能處理 alpha/blend/shadow；對 background blur則需要 dependency-aware group ablation，不能把單一 layer獨立解釋。

重要限制：
- 非線性 blending / tone mapping / blur 使 attribution非加性；`sum(delta_i)` 不等於 final pixel。
- GPU backend / precision / cache / protected content可能讓 replay與 production output不同。
- Counterfactual replay證明的是「在 replay model 中移除某 draw group會改變 pixel」，不是 physical GPU execution provenance。

因此本輪只把它命名為 `COUNTERFACTUAL_PIXEL_BOUND`，不能冒充 `BYTE_IDENTICAL_PHYSICAL_PIXEL_CAUSE`。

## Architecture Breakdown

### System architecture：Hermes Render Provenance Recorder v0.1

```text
Capture Request
→ CaptureLayerGenerationManifest
→ LayerFE::LayerSettings
→ RenderEngine::drawLayers
→ SkiaCapture
   ├ FrameBegin
   ├ LayerGenerationAnnotation
   ├ Canvas Transform
   ├ Clip
   ├ Shadow Draw
   ├ Offscreen Snapshot / SurfaceID
   ├ Blur Generate / Blur Draw
   ├ Content Paint/Shader
   └ drawRect / drawRRect
→ MSKP Command Trace
→ Provenance Parser
→ DrawCommandGraph
→ Target Region Query
→ Counterfactual Replay (debug/research)
→ PixelEffectMask
→ CapturePixelAttributionManifest
```

### Agent-side integration

```text
ObservationEnvelope
├ screenshot
├ capture_generation_manifest
├ draw_command_trace_id
├ target_region_attribution
├ nearest_presented_generation_set
├ program_state_witness
└ evidence_strength

Reasoning
→ intended action target
→ target region provenance query
→ freshness/generation check
→ pre-action revalidation
→ ALLOW / DEFER / REOBSERVE / BLOCK
```

這讓 compositor evidence從「事後 forensic」轉成 action authorization input。

## Bottom-Level Logic

### A. Draw-command binding

```text
LayerGenerationKey
→ structured annotation
→ command_begin
→ transform
→ clip
→ effect commands
→ content draw
→ command_end
```

建議不要只靠 layer.name 作 identity；使用先前已閉合的 `(layerId, GraphicBufferId, frameNumber)`。

### B. Clip / geometry

AOSP current Skia path會先 concat `positionTransform`，再計算 bounds/rounded clip；需要 rounded clipping時先 `clipRRect`，最後以 `drawRect` / `drawRRect` 執行 content draw。

```text
Local geometry
→ positionTransform
→ canvas total matrix
→ rounded crop/clip
→ raster coverage
```

### C. Shadow

```text
Caster geometry
→ ShadowSettings
→ SkShadowUtils::DrawShadow
→ expanded support
→ destination blend
```

Shadow command應標成 `DERIVED_EFFECT(layer-generation-or-state)`。

### D. Blur / offscreen snapshot

```text
Prior composite
→ makeImageSnapshot
→ blurRect (mapped + device clipped)
→ BlurFilter.generate
→ drawBlurRegion
→ target canvas
```

這裡 contributor 是 prior command set，不是單一 buffer。

### E. Counterfactual attribution v0

```text
Input: MSKP frame F, target region R, draw groups G0..Gn

1. Replay F → baseline crop B(R)
2. For each candidate Gi whose conservative support intersects R:
   a. replay F with Gi disabled/masked
   b. crop Ci(R)
   c. compute difference mask Di = diff(B, Ci)
   d. if Di non-empty: mark COUNTERFACTUAL_CONTRIBUTOR
3. For blur/effect groups:
   evaluate dependency group, not isolated primitive only
4. Save evidence:
   generation key
   command range
   effect dependencies
   diff mask
   replay backend/config hash
```

注意：這是 causal ablation，不是 additive Shapley attribution。若未來要 numeric contribution weights，需要另外研究 cooperative attribution / Shapley approximations，但成本可能呈指數增長。

## Visual Simulation Idea

### Skia Draw Command × Pixel Causality Lab

左欄：Layer generations

```text
L12 / B91 / F471
L13 / B55 / F88
Effect E7 / BackgroundBlur
```

中欄：真實 command timeline

```text
ANNOTATE L12/B91/F471
concat(matrix)
clipRRect(...)
drawRect(shader=Image[B91])

ANNOTATE L13/B55/F88
snapshot Surface#31
blur.generate(...)
drawBlurRegion(...)
drawRRect(...)
```

右欄：Target pixel/region

```text
R = (420,300)-(500,360)
L12/B91/F471  → 68% pixels changed under ablation
L13/B55/F88   → 41% pixels changed under ablation
Blur E7       → dependency group changed 74%
```

UI 必須明確顯示 evidence mode：

`GEOMETRY` / `DRAW_COMMAND` / `COUNTERFACTUAL_REPLAY` / `PHYSICAL_PRESENTATION`

避免把不同證據強度混為一談。

## Code / GitHub / Source

本輪值得看的 AOSP 原始碼：

- `libs/renderengine/skia/debug/SkiaCapture.h`
  - `tryCapture()`、`tryOffscreenCapture()`、`endOffscreenCapture()`、multi-frame SKP/MSKP recording。
- `libs/renderengine/skia/debug/SkiaCapture.cpp`
  - capture lifecycle、serialization、capture file。
- `libs/renderengine/skia/SkiaRenderEngine.cpp`
  - LayerSettings annotation、position transform、rounded clip、blur snapshot、shadow、paint/shader、`drawRect`/`drawRRect`、completion fence。
- `libs/renderengine/skia/filters/BlurFilter*`
  - prior composite → blurred image → blur region。
- `libs/renderengine/tests/RenderEngineTest.cpp`
  - 可作 counterfactual replay instrumentation 的 regression oracle。

關鍵來源：
- https://android.googlesource.com/platform/frameworks/native/+/180f95b4641e4bdf66a6586d2fbf43c1defb2d81/libs/renderengine/skia/SkiaRenderEngine.cpp
- https://android.googlesource.com/platform/frameworks/native/+/f76775af4374b9cdda21cc1616cf0fd6937d4c13/libs/renderengine/skia/debug/SkiaCapture.h
- https://android.googlesource.com/platform/frameworks/native/+/f76775af4374b9cdda21cc1616cf0fd6937d4c13/libs/renderengine/skia/debug/SkiaCapture.cpp

## Papers

### STAGE: Diagnosing Semantic Transfer at Grounded Execution in Embodied Agents
Authors: Baosheng Jin, Yushen Liang, Hua Shen
Year: 2026
URL: https://arxiv.org/abs/2609.13458
Dataset/Benchmark: SAT-Bench，包含 fixed-observation counterfactuals。
Architecture: fixed visual state + semantic counterfactual instruction；另提出 VISA execution-time interface，輸出 ALLOW / DEFER / target-consistency / verified-selection decisions。
Contribution: 在 LIBERO target-name / pixel-grounded relation swaps中，target recovery可達 100.0% / 95.8%，但 OpenVLA action sensitivity僅 6.8% / 7.7%；VISA 把 invalid-instruction blind execution 從 92.7% 降到 2.8%。
Limitations: embodied-policy/action semantic transfer，不處理 OS compositor pixel provenance。
Change for Hermes: 即使 perception正確，semantic state也未必真正控制 action；Hermes 的 `RegionProvenance + GenerationRevalidation` 應輸入 execution-time authorization，而不是只提供給 planner參考。

### OSWorld2.0: Benchmarking Computer Use Agents on Long-Horizon Real-World Tasks
Authors: Mengqi Yuan et al.
Institutions: multi-institution collaboration
Year: 2026
URL: https://arxiv.org/abs/2606.29537
Dataset: 108 long-horizon real-world workflows；平均約 318 tool calls（reported setup）。
Architecture: authentic artifacts + stateful profiles + long-horizon workflows + safety reports。
Contribution: primary binary completion metric下，reported best setup仍只有 20.6% complete / 54.8% partial；主要問題包含 constraint loss、mid-task information、hidden state recovery、verification skipping。
Limitations: benchmark-level diagnosis，沒有 compositor/render provenance。
Change for Hermes: deterministic state/render witnesses最有價值的地方不是提高 static grounding leaderboard，而是長任務中的 hidden-state recovery與 verification。

### FineState-Bench: Benchmarking State-Conditioned Grounding for Fine-grained GUI State Setting
Authors: Fengxian Ji, Jingpu Yang, Zirui Song, Yuanxi Wang, Zhexuan Cui, Yuke Li, Qian Jiang, Xiuying Chen
Institution: see ACL 2026 paper metadata
Year: 2026
URL: https://aclanthology.org/2026.findings-acl.2136/
Dataset: 2,209 instances，desktop/web/mobile，23 UI component types。
Architecture: stage-wise Localization / Interaction / Exact-State metrics + Visual Diagnostic Assistant。
Contribution: exact goal-state success仍低；paper reports average ES-SR@Int 22.8%，顯示「找到 control」與「到達正確 state」是不同問題。
Limitations: screenshot/state benchmark，沒有 OS render provenance。
Change for Hermes: Console 應把 grounding、execution、exact state、generation freshness分開評估，不能只有 task success。

## Unknown / Open Questions

1. Current MSKP/SKP replay是否能在 SurfaceFlinger production-equivalent Skia backend下穩定重現 capture buffer pixels，尤其 HDR、protected content、runtime shader與vendor-specific paths？
2. 如何為 blur建立最小 dependency group，使 counterfactual replay既保留 prior-composite semantics，又能定位真正 contributor set，而不產生錯誤的單-layer attribution？
3. `CAPTURE_PIXEL_BOUND` 的工程定義應採「pixel changed under deterministic replay ablation」還是還必須加入 production output hash / tolerance / backend equivalence proof？

## 下一輪研究

下一輪直接追：

```text
SkiaCapture MSKP
→ SkPicture / command serialization
→ image/resource serialization
→ replay backend
→ deterministic output conditions
→ target-region crop hash
→ primitive/group ablation
→ PixelEffectMask
→ CapturePixelAttributionManifest
```

並檢查 AOSP / Skia tooling 是否已有 SKP replay、debug canvas、command inspection、image diff primitive可復用。若 replay fidelity不足，再比較第二方案：RenderEngine debug side-pass contributor ID / coverage attachment。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `SkiaCaptureTrace`
- `SkiaFrameCommandStream`
- `LayerSettingsAnnotationWitness`
- `DrawCommandWitness`
- `DrawCommandInterval`
- `OffscreenSurfaceSnapshotWitness`
- `OffscreenSnapshotDependency`
- `DrawCommandBoundRegion`
- `CounterfactualReplayWitness`
- `PixelEffectMask`
- `ReplayBackendIdentity`
- `CounterfactualPixelBound`
- `CapturePixelAttributionManifest` (refined)

### Edges

```text
LogicalLayerBufferGenerationKey
→ annotated_by→ LayerSettingsAnnotationWitness

LayerSettingsAnnotationWitness
→ scopes→ DrawCommandInterval

DrawCommandInterval
→ executes_as→ DrawCommandWitness

PriorDrawCommandSet
→ snapshotted_into→ OffscreenSurfaceSnapshotWitness

OffscreenSurfaceSnapshotWitness
→ feeds→ BackgroundBlurDependency

DrawCommandWitness
+ target region
→ bounds→ DrawCommandBoundRegion

DrawCommandBoundRegion
→ replayed_by→ CounterfactualReplayWitness

CounterfactualReplayWitness
→ produces→ PixelEffectMask

PixelEffectMask
→ supports→ CounterfactualPixelBound

CounterfactualPixelBound
→ candidate_for→ CapturePixelAttributionManifest
```

## 與歷史研究比較

09:53 已證明 `LayerSettings + Skia render state` 足以建立 `REGION_COMPOSITION_BOUND`，但當時下一步偏向新增 contributor-ID / coverage side pass。本輪發現 AOSP 已有 SkiaCapture command recording + LayerSettings annotation，因此優先順序應改為：

```text
第一方案：既有 SkiaCapture trace + structured generation annotation + replay/ablation
第二方案：只有在 replay fidelity不足時，再做 contributor-ID side pass
```

這降低對 production renderer 的侵入性，也保留真正 draw command ordering、clip、effect與offscreen structure。

## 本輪結束判斷

- 缺哪一層：`DRAW_COMMAND_BOUND → production-equivalent exact pixel attribution`。
- 哪個節點最淺：`CounterfactualPixelBound`；可實作但尚未以真實 MSKP replay prototype驗證。
- 哪個概念仍只是名詞：`PhysicalPixelCausalWeight`；非線性 blur/tone mapping/blending下不能把 ablation delta當成可加總權重。
- 哪個系統值得讀原始碼：Skia `SkPicture` / SKP serialization、DebugCanvas/replay tooling，以及 AOSP `SkiaCapture.cpp`。
- 哪篇論文需追引用：STAGE / SAT-Bench，因為它把「理解語義」與「語義真正控制 action」拆成兩個可測量層，與 Hermes execution authorization高度一致。
- 哪個概念最適合視覺模擬：`Skia Draw Command × Pixel Causality Lab`。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + ObservationEnvelope + Exact Generation Join + DrawCommand/Region Provenance + Counterfactual Pixel Verifier(debug) + Execution-time ALLOW/DEFER Gate + PreAction Revalidation`。

## 本輪核心結論

Hermes 已從「知道哪個 layer generation 進入 screenshot」推進到「能把 generation 綁到 RenderEngine 真正發出的 Skia draw command sequence」。更重要的是，AOSP 已有 SkiaCapture/MSKP infrastructure，代表下一步不一定要改 GPU shader；可以先利用 command trace + deterministic counterfactual replay建立 `PixelEffectMask`。真正尚未閉合的問題已從『哪個 primitive 畫到哪裡』縮小成『replay 是否足夠忠實，能讓 ablation 結果升級為 production capture pixel witness』。