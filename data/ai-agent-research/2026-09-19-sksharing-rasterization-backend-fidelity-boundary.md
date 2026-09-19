# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 14:55 Asia/Taipei

## 本小時新發現

本輪延續前輪 `RenderEngine MSKP Resource Closure × Valid Ablation Closure`，但不重複「shared-image serialization 是否存在」。本輪直接追 current Skia `SkSharingProc.cpp`，確認 **MSKP replay artifact 會在 serialization 前把 texture-backed image 轉成 raster image**；而 Ganesh 與 Graphite 採取不同 readback 路徑。這是 `COUNTERFACTUAL_PIXEL_BOUND → CAPTURE_PIXEL_BOUND` 的關鍵 fidelity boundary。

最重要的新結論：MSKP 保存的是可重播的 **rasterized resource snapshot**，不是 production GPU texture/backend object 的等價封裝。Ganesh 路徑呼叫 `SkImage::makeRasterImage(GrDirectContext*)`；Graphite 路徑則建立 RGBA_8888 + premultiplied bitmap，執行 `asyncRescaleAndReadPixels(... kSrc, kNearest)`，同步 submit 到 CPU，再把 bitmap 轉回 raster `SkImage`。因此 replay 可以保存 visual resource contents，但 backend texture identity、GPU storage、driver-specific sampling execution 與部分原始 pixel-format semantics 不會被原樣保存。

另一個重要發現：current sharing serializer 以 `SkImage::uniqueID()` 做同一 process 內的 image identity；第一次遇到 image 時會把 raster/non-texture replacement 以 PNG 編碼寫入，後續 occurrence 只寫 in-file id。若 encode 失敗，甚至會寫入 magenta placeholder。這使 `ReplayResourceClosureWitness` 必須再拆成 `RESOURCE_PRESENT` 與 `RESOURCE_FAITHFUL`，不能只看 MSKP 能否 deserialize。

## 本小時最重要 5 個發現

### 1. Texture-backed image 在 MSKP resource collection 中會被 rasterize
**狀態：官方原始碼 / 已確認。**

current `SkSharingProc.cpp` 的 `make_raster_image()`：

`SkImage`
→ 若非 texture-backed：保留 image reference
→ 若 Ganesh DirectContext：`makeRasterImage(dctx)`
→ 若 Graphite Context：`asyncRescaleAndReadPixels`
→ CPU bitmap
→ raster `SkImage`

因此 MSKP replay 的 image resource 是 capture-time raster snapshot，而非原始 backend texture object。

**重要性**：這清楚界定 replay provenance：它適合回答「capture-time resource pixels 經 command stream 會造成什麼畫面效果」，但不能單靠 MSKP 證明 production GPU texture execution byte-identical。

**限制**：仍需實測 colorspace/HDR/format conversion 與 protected buffer 行為。

### 2. Graphite readback 明確規格化成 RGBA_8888 + Premul
**狀態：官方原始碼 / 已確認。**

Graphite path 先建立：

`img->imageInfo()`
→ `.makeColorType(kRGBA_8888_SkColorType)`
→ `.makeAlphaType(kPremul_SkAlphaType)`
→ `asyncRescaleAndReadPixels`
→ `SkBitmap`

這表示 replay artifact 可能已經發生 representation normalization。

**重要性**：`ReplayBackendIdentity` 不能只記 GANESH / GRAPHITE；還需要 `resource_readback_representation`、color type、alpha type、colorspace/dataspace、HDR metadata preservation state。

**合理推論**：即使 replay 視覺上相同，對 HDR、wide gamut、high precision 或特殊 buffer format，byte-exact equivalence 不能預設成立。

### 3. Sharing identity 是 SkImage uniqueID → in-file ID，不是 GraphicBuffer ID
**狀態：官方原始碼 / 已確認。**

`serializeImage()` 使用 `img->uniqueID()` 查 `fImageMap`。第一次 serialization 寫 image payload並配置 sequential in-file id；之後 occurrence 只寫 id reference。

因此必須區分：

`GraphicBufferGenerationKey`
≠ `SkImageUniqueID`
≠ `MSKPSharedImageID`

Hermes 需要額外 bridge：

`(layerId, graphicBufferId, frameNumber)`
→ LayerSettings / annotation
→ SkImage uniqueID
→ MSKP shared image id

否則 replay 中的 resource identity 無法直接反推 production GraphicBuffer generation。

### 4. Serialization 成功不代表 resource faithful：encode failure 會退化成 magenta placeholder
**狀態：官方原始碼 / 已確認。**

current serializer 若 PNG encoding 失敗，不會讓整份 capture 必然失敗，而是產生 magenta placeholder 讓 debugger 繼續。

因此新 evidence taxonomy：

`RESOURCE_PRESENT`
→ artifact 中存在 image entry

`RESOURCE_DECODED`
→ replay 成功 deserialize

`RESOURCE_FAITHFUL`
→ resource hash/metadata 與 capture-time readback witness 對得上

`RESOURCE_PLACEHOLDER`
→ encode/readback failure 的替代內容

這是前輪 `ReplayResourceClosureWitness` 必須補上的失敗狀態。

### 5. Computer-use verification 應把 execution memory 與 state-grounded outcome 分開
**狀態：近期論文結果 + Hermes 架構推論。**

EchoPath（2026-09-15）把已驗證 GUI trajectory 轉成帶 state preconditions、GUI evidence、validation provenance 的 callable replay memory，並在 current screen 上重新 re-aim target；論文報告 median token cost 降低超過 90%、median execution time 約降低 60%。ERPBench（2026-09-15）則用 live ERP database ground truth 評估 screenshot-only agents，指出「成功操作 UI」與「persistent record 寫對」差距可非常大。

Hermes 應將兩者與本輪 rendering provenance 合併：

`ExecutionMemory`
→ `Current State Preconditions`
→ `Observation/Pixel Provenance`
→ `Action`
→ `Persistent Outcome Verifier`

而不是把 replayable trajectory 本身當作成功證明。

## Architecture Breakdown

### Production RenderEngine resource path

`GraphicBuffer / AHardwareBuffer`
→ `GaneshBackendTexture or GraphiteBackendTexture`
→ backend texture
→ `SkImage`
→ shader / LayerSettings
→ production RenderEngine draw
→ capture buffer

AOSP current RenderEngine 會依 build/runtime 選擇 Ganesh GL、Ganesh Vulkan 或 Graphite Vulkan；因此 production backend identity 是正式 evidence，不應只寫「Skia GPU」。

### MSKP resource path

`production SkImage`
→ `collectNonTextureImagesFromPicture`
→ `make_raster_image`
→ Ganesh `makeRasterImage` OR Graphite async GPU→CPU readback
→ raster SkImage
→ PNG encode
→ `MSKP shared image payload`
→ deserialize PNG
→ raster SkImage
→ DebugCanvas replay

### Hermes fidelity architecture

`ProductionGenerationWitness`
→ `SkImageBridgeWitness`
→ `RasterizationWitness`
→ `SerializationRepresentationWitness`
→ `MSKPSharedImageWitness`
→ `ReplayResourceFaithfulnessGate`
→ `BackendReplayWitness`
→ `BaselineProductionDiff`
→ `CounterfactualPixelWitness`
→ `CapturePixelAttributionManifest`

## Bottom-Level Logic

### 1. Resource rasterization

不要再建模為：

`GPU texture → MSKP → same GPU texture`

應改成：

`GPU texture`
→ `readback / rasterization`
→ `CPU-visible raster image`
→ `PNG payload`
→ `reconstructed raster image`
→ `replay upload/sampling`

這是一個 materialization boundary。

### 2. Graphite branch

current code：

`texture-backed SkImage`
→ derive image info
→ force RGBA_8888
→ force Premul alpha
→ allocate SkBitmap
→ `asyncRescaleAndReadPixels`
→ submit Graphite context with SyncToCpu
→ wait callback completion
→ bitmap image

因此 `GraphiteResourceReadbackWitness` 應保存：source info、readback info、callback success、output hash。

### 3. Shared image identity

`SkImage::uniqueID()` 是 process-local image identity，不是 content hash。MSKP 再把 uniqueID 映射成 file-local sequential ID。

因此建議 instrumentation：

`RenderGenerationKey`
→ `SkImageUniqueID`
→ `MSKPSharedImageID`
→ `RasterPayloadHash`

讓 replay resource 可以回連到 `(layerId, bufferId, frameNumber)`。

### 4. Fidelity gate

對 resource `r`：

`ProductionReadbackHash(r)`
與
`SerializedRasterHash(r)`
與
`DeserializedRasterHash(r)`

至少應建立三段 witness。

對 frame/region `R`：

`ProductionCapture(R)` vs `BaselineReplay(R)`

分類：
- `BYTE_EXACT`
- `NUMERICALLY_BOUNDED`
- `PERCEPTUALLY_BOUNDED`
- `NON_EQUIVALENT`
- `RESOURCE_PLACEHOLDER`

只有前兩級才適合升級成高可信 `CAPTURE_PIXEL_BOUND`；第三級只能支援視覺/語義 attribution，不能宣稱 exact numeric provenance。

## Visual Simulation Idea

### GPU Texture → MSKP Rasterization Boundary Viewer

四欄互動視圖：

1. **Production Resource**：GraphicBuffer ID、frameNumber、AHardwareBuffer format/usage、Ganesh/Graphite backend。
2. **Readback Boundary**：SkImage uniqueID、texture-backed flag、readback color type/alpha、success/failure、protected flag。
3. **Serialized Artifact**：MSKP shared-image ID、PNG hash、placeholder state。
4. **Replay Result**：decoded resource hash、baseline output、production diff heatmap。

點 target pixel 可反向展開：

`Replay Pixel`
← `DrawCommand`
← `MSKPSharedImageID`
← `SkImageUniqueID`
← `GraphicBufferGenerationKey`

若中途發生 RGBA_8888 normalization、placeholder、colorspace mismatch 或 backend mismatch，以紅色斷點顯示「證據不能再升級」。

## Code / GitHub

本輪值得直接讀的核心原始碼：

- Skia `tools/SkSharingProc.cpp`
- Skia `tools/SkSharingProc.h`
- Skia `tests/MultiPictureDocumentTest.cpp`
- AOSP `frameworks/native/libs/renderengine/RenderEngine.cpp`
- AOSP `frameworks/native/libs/renderengine/skia/compat/GaneshBackendTexture.cpp`
- AOSP `frameworks/native/libs/renderengine/skia/compat/GraphiteBackendTexture.cpp`
- AOSP `frameworks/native/libs/renderengine/skia/debug/SkiaCapture.cpp`

特別值得追：current `SkSharingProc.cpp` 已同時具有 `GrDirectContext*` 與 `skgpu::graphite::Context*`，代表 sharing/readback path 本身已意識到 Ganesh/Graphite backend 差異。

## Papers

### EchoPath: Execution-Level Replayable Memory for GUI Agents
- Authors: Yao Zhao, Aditya Shanmugham, Swastik Roy, Yanxun Xu
- Year: 2026（2026-09-15）
- Architecture: artifact-validated GUI trajectory → parameterized callable execution memory；保存 intent keys、app/state preconditions、GUI evidence、validation provenance、lifecycle state；replay 時以 image-based target re-aiming 修正 coordinates。
- Dataset/Experiments: real computer-use recurrent tasks。
- Contribution: 把 trajectory memory 從 unstructured history 轉成可驗證、可拒絕、可重新綁定輸入的 execution asset。
- Reported result: median token cost >90% reduction；median execution time 約 60% reduction。
- Limitations: visual re-aiming/state precondition 仍不等於 compositor/pixel generation proof；persistent outcome 仍需外部 verifier。
- 改變了什麼：支持 Hermes 將已驗證 action sequence 編譯成 memory/tool，但 invocation 前必須重驗 current provenance/state。

### ERPBench: A State-Grounded Evaluation Paradigm for Computer-Use Agents in Enterprise Software
- Authors: Kratika Bhagtani, Kusha Sridhar, Maziyar Baran Pouyan, Yuying Zhao, Eugene Siow
- Year: 2026（2026-09-15）
- Architecture: screenshot-only agent 操作 live reproducible ERP；task success 由 database ground truth 驗證；production harness 可在人類 approval gate 後執行 action。
- Contribution: 把 GUI task evaluation 從「畫面看起來完成」提升到 persistent system state correctness。
- Reported result: 某些 agents 可在高比例 runs 執行 save，但正確寫入值的比例可低到個位數。
- Limitations: benchmark 專注 enterprise ERP，不提供 OS compositor provenance。
- 改變了什麼：Hermes verifier 必須把 `visual/process evidence` 與 `persistent outcome evidence` 分開。

### The Art of Building Verifiers for Computer Use Agents
- Authors: Corby Rosset, Pratyusha Sharma, Andrew Zhao, Miguel González-Fernández, Ahmed Awadallah
- Institution: Microsoft Research
- Year: 2026
- Code: `microsoft/fara`
- Dataset: CUAVerifierBench
- Architecture: rubric decomposition + process/outcome separation + controllable/uncontrollable failure separation + divide-and-conquer trajectory context。
- Contribution: Universal Verifier 的 false-positive rate 報告接近零，並達到接近 human-human agreement 的 verifier agreement。
- Limitations: verifier evidence 主要是 task/trajectory 層，不是 GPU/pixel-level causal proof。
- 改變了什麼：支持 Hermes 將 rendering provenance 作為 process verifier 的一個 evidence channel，而不是取代 outcome verifier。

## Unknown / Open Questions 1-3

1. Protected AHardwareBuffer 在 Ganesh/Graphite `make_raster_image` / async readback 路徑會如何失敗？是否會直接導致 magenta placeholder，還是 RenderEngine capture 更早排除該 resource？
2. Graphite 強制 RGBA_8888 + Premul readback 對 HDR/wide-gamut capture 的 numerical error 上界是多少？production capture 最終若也落在相同 SDR/8-bit representation，何時可重新建立 byte-exact equivalence？
3. 如何在 `LayerSettings annotation → SkImage uniqueID → MSKP shared image ID` 中加入 explicit generation bridge，避免同一 image resource 被多個 layer/frame reuse 時 provenance 混淆？

## 下一輪研究

下一輪不再確認 MSKP resource 是否能保存；改追 protected/HDR/format fidelity：

`AHardwareBuffer usage/format`
→ `protected content flag`
→ `GaneshBackendTexture / GraphiteBackendTexture`
→ `SkImage color space / alpha / format`
→ `makeRasterImage / asyncRescaleAndReadPixels`
→ `PNG encoding representation`
→ `production capture dataspace`
→ `replay output colorspace`
→ `numeric/perceptual error envelope`
→ `CAPTURE_PIXEL_BOUND`

同時建立 `Generation → SkImage uniqueID → MSKP resource ID` instrumentation schema。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `RasterizationWitness`
- `GaneshRasterizationWitness`
- `GraphiteAsyncReadbackWitness`
- `ResourceRepresentationNormalization`
- `SkImageUniqueIdentity`
- `MSKPSharedImageIdentity`
- `RasterPayloadHashWitness`
- `ResourcePlaceholderState`
- `ReplayResourceFaithfulnessGate`
- `PersistentOutcomeVerifier`
- `ExecutionReplayMemory`

新增 Edges：
- `TextureBackedSkImage --materialized_by--> RasterizationWitness`
- `GaneshRasterizationWitness --uses--> GrDirectContext`
- `GraphiteAsyncReadbackWitness --normalizes_to--> RGBA8888Premul`
- `SkImageUniqueIdentity --mapped_to--> MSKPSharedImageIdentity`
- `MSKPSharedImageIdentity --serialized_as--> RasterPayloadHashWitness`
- `ResourcePlaceholderState --invalidates--> ReplayResourceFaithfulnessGate`
- `ReplayResourceFaithfulnessGate --gates--> CounterfactualPixelWitness`
- `ExecutionReplayMemory --requires--> CurrentStatePrecondition`
- `AgentAction --verified_by--> PersistentOutcomeVerifier`

## 本輪結束判定

- **缺哪一層**：`rasterized replay resource → production capture numeric equivalence`，尤其 HDR/protected/format conversion。
- **哪個節點最淺**：`ReplayResourceFaithfulnessGate` 的 color/HDR fidelity branch。
- **哪個概念仍只是名詞**：`PhysicalPixelCausalWeight`；另外 `ProtectedResourceReplayWitness` 尚未閉合。
- **哪個系統值得讀原始碼**：AOSP `GraphiteBackendTexture/GaneshBackendTexture + SkiaCapture` 與 Skia `SkSharingProc` protected/HDR readback path。
- **哪篇論文需追引用**：EchoPath；它把 execution trajectory memory 變成 callable asset，值得與 Hermes Memory/MCP Tool Compiler 連接。ERPBench 應進 outcome-verification branch。
- **哪個概念最適合視覺模擬**：`GPU Texture → MSKP Rasterization Boundary Viewer`。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + ExecutionReplayMemory + Provenance-driven Active Perception + Pixel/Generation Revalidation + Persistent Outcome Verifier + Risk Gate`。

## 最終鏈條進度

目前從使用者指令到 visual action 的一段可驗證鏈已推進為：

`User Intent`
→ `Agent Plan`
→ `ObservationEnvelope`
→ `Capture Layer Generation`
→ `GraphicBuffer / FrameNumber`
→ `RenderEngine Primitive`
→ `Skia DrawCommand`
→ `SkImage Resource`
→ `Rasterization Boundary`
→ `MSKP Resource`
→ `Replay / Ablation`
→ `Counterfactual Pixel Witness`
→ `PreAction Revalidation`
→ `Action`
→ `Persistent Outcome Verification`

本輪最大的修正是：**MSKP resource closure 已成立，但它是 rasterized snapshot closure，不是 production GPU texture closure。這使下一個研究問題從「能不能 replay」精確收斂成「rasterization/format/colorspace 造成多少 fidelity loss，以及在什麼條件下 replay pixel evidence可以被升級成 production capture pixel evidence」。**