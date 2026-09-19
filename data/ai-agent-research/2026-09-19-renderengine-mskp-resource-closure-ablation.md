# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 13:51 Asia/Taipei

## 本小時新發現

本輪延續前輪 `DebugCanvas Command Ablation × PixelEffectMask`，但不重複「toggleCommand 能否關閉 command」；焦點改成兩個尚未閉合的底層邊界：**Android RenderEngine 的 MSKP 是否真的保存可 replay 的 image/resource closure**，以及 **offscreen layer / state command 下，怎樣定義不破壞 rendering semantics 的 valid ablation closure**。

已確認官方 AOSP RenderEngine `SkiaCapture::setupMultiFrameCapture()` 不是依賴 Skia 的 image default serialization，而是明確建立 `SkSharingSerialContext`，把 `SkSerialProcs.fImageProc` 設為 `SkSharingSerialContext::serializeImage`，並在 `SkMakeMultiPictureDocument` 的 end-page callback 呼叫 `collectNonTextureImagesFromPicture`；typeface 也以 include-data 方式序列化。這大幅提高 MSKP 作為離線 replay artifact 的 resource fidelity。

Skia 自己的 `MultiPictureDocumentTest` 更直接驗證 AHardwareBuffer-backed image：建立 AHardwareBuffer image、錄進 MultiPictureDocument、釋放原始 AHardwareBuffer、close document，再以 `SkSharingDeserialContext::deserializeImage` 反序列化。這提供了跨 Android hardware-buffer image → shared serialized image → replay 的官方測試證據。

同時，Skia debugger 的 MSKP loader 使用同一對 sharing deserializer，且 `DebugCanvas` 對 Android offscreen layers 並非單純保存一個 `drawImageRect`：它辨識 `OffscreenLayerDraw` / `SurfaceID` annotation，透過 `DebugLayerManager` 在正確 frame/command index 取得 layer image，再延遲執行 `DrawImageRectLayerCommand`。因此 valid ablation 必須包含 offscreen dependency closure。

## 本小時最重要 5 個發現

### 1. RenderEngine MSKP 已有 explicit shared-image serialization
**狀態：官方資訊 / 已確認工程實作。**

底層鏈：

`RenderEngine SkiaCapture → SkSharingSerialContext → SkSerialProcs.fImageProc=serializeImage → MultiPictureDocument → collectNonTextureImagesFromPicture → MSKP`

重要性：前輪 `REPLAY_RESOURCE_BOUND` 不再只是「Skia 理論上能保存 image」；Android RenderEngine 本身已採用 shared-image serialization path。

限制：resource fidelity 不等於 production GPU byte identity；protected/sideband/driver-specific execution 仍需另行處理。

來源：AOSP `frameworks/native/libs/renderengine/skia/debug/SkiaCapture.cpp`；Skia `SkSerialProcs.h`。

### 2. AHardwareBuffer-backed image 有官方 serialization/deserialization test
**狀態：官方測試結果。**

Skia Android test 建立 AHardwareBuffer-backed `SkImage`，使用 `SkSharingSerialContext` 錄製 MultiPictureDocument，釋放原始 hardware buffer 後完成 document，再用 `SkSharingDeserialContext` 讀回。

這代表：

`AHardwareBuffer image → shared serialization → MSKP → shared deserialization → reconstructed SkImage`

至少在被測試支援的 GPU/context 條件下是刻意支援的工程路徑。

限制：測試證明 serialization/reconstruction 能工作，不代表所有 RenderEngine production external textures、protected buffers、dataspace、HDR path 都 byte-exact。

### 3. MSKP debugger 與 RenderEngine capture 的 image sharing protocol 對得上
**狀態：官方資訊 / 交叉驗證。**

Debugger loader 對 MSKP 建立 `SkSharingDeserialContext`，把 `SkDeserialProcs.fImageProc` 指向 `deserializeImage`。這與 RenderEngine capture 端的 `serializeImage` 是對偶 protocol。

因此可以建立新的 witness：

`SharedResourceSerializationWitness → SharedResourceDeserializationWitness → ReplayResourceClosureWitness`

### 4. Offscreen layer 是 command dependency graph，不是 flat command list
**狀態：官方原始碼。**

`DebugCanvas` 對 Android layer annotation 使用 `SurfaceID` / `OffscreenLayerDraw`，並由 `DebugLayerManager` 依 frame 與 command progression 重建 layer image。延遲的 `DrawImageRectLayerCommand` 在真正 replay 時才取 `getLayerAsImage()`。

所以錯誤做法：

`toggle one draw command → assume only one primitive disappeared`

正確模型：

`Generation/Effect Group → state prefix + offscreen producers + deferred layer-image consumer + downstream draw`

### 5. CUA verification 應把 pixel provenance 變成 action substrate 的 evidence，而非模型內部自信
**狀態：論文結果 + 合理架構推論。**

CUADebug 把 computer-use failure 視為 multimodal causal localization，主動檢查 suspicious step 的 before/after screenshot 與 action trace；Tactile 則把 target 建模成帶來源、state、geometry、affordance、verification cue 的 action object。Visual Confused Deputy 顯示 visual grounding / TOCTOU 可成為 authorization 漏洞。

Hermes 的新推論是把 compositor/render provenance 直接加入 target object：

`TargetObject { semantic_state, geometry, logical_generation, pixel_effect_evidence, freshness, authorization }`

限制：這是 Hermes 的 architecture proposal，不是上述論文已實作的 compositor provenance。

## Architecture Breakdown

### RenderEngine capture/replay architecture

`SurfaceFlinger capture/client composition`
→ `SkiaRenderEngine`
→ `SkiaCapture::tryCapture()`
→ `SkMakeMultiPictureDocument`
→ `SkSharingSerialContext`
→ `SkPicture frames + shared image resources + typefaces`
→ `.mskp`
→ `SkMultiPictureDocumentRead`
→ `SkSharingDeserialContext`
→ `SkPicture`
→ `DebugCanvas`
→ `DebugLayerManager`
→ `DrawCommand stream`
→ `GPU/CPU replay surface`

### Hermes valid-ablation architecture

`Generation Key (layerId, bufferId, frameNumber)`
→ `LayerSettings annotation interval`
→ `DrawCommand set`
→ `Dependency extraction`
→ `State closure`
→ `Offscreen producer closure`
→ `Deferred consumer closure`
→ `ValidAblationGroup`
→ `Baseline replay B(R)`
→ `Ablated replay A_i(R)`
→ `PixelEffectMask_i(R)`
→ `ReplayFidelityGate`
→ `CapturePixelAttributionManifest`

## Bottom-Level Logic

### Resource closure

不要把 MSKP 看成只有 draw opcode：

`SkImage / GraphicBuffer-derived content`
→ `SkSharingSerialContext::serializeImage`
→ `shared resource table / encoded payload`
→ `picture references`
→ `SkSharingDeserialContext::deserializeImage`
→ `reconstructed SkImage`
→ `shader / draw command replay`

Skia `SkSerialProcs` 的一般規則是：custom image proc 若回傳 data 就使用該資料；若回 null 才採 default image behavior。因此 RenderEngine 明確指定 sharing proc 是關鍵 evidence。

### Valid ablation closure

對 command `d_i`，不能只做 `visible=false`。先計算：

`Closure(d_i) = OutputCommands(d_i) ∪ RequiredStatePrefix(d_i) ∪ OffscreenProducerDeps(d_i) ∪ DeferredConsumerDeps(d_i)`

實作上應**保留** RequiredStatePrefix（save/concat/clip 等），只 suppress 屬於目標 generation/effect 的 output commands；若 output 來自 offscreen layer，則 suppression 必須依 dependency graph 選擇 producer 或 final consumer，而不能任意破壞 layer-manager progression。

### Pixel effect

對 target region R：

`B(R) = baseline replay crop`

`A_g(R) = replay with ValidAblationGroup(g) suppressed`

`Mask_g(R) = Diff(B(R), A_g(R))`

若 baseline replay 通過 fidelity gate，`Mask_g` 可升級為 counterfactual pixel witness；否則只能稱 replay-model effect。

## Visual Simulation Idea

### MSKP Resource & Ablation Dependency Inspector

三欄互動視圖：

1. **Resource Graph**：GraphicBuffer/AHardwareBuffer-derived image → serialized shared resource → deserialized SkImage。
2. **Command DAG**：annotation、save/transform/clip、offscreen producer、SurfaceID、deferred DrawImageRectLayer、final draw。
3. **Pixel Diff**：production capture / baseline replay / ablated replay / PixelEffectMask 四層切換。

點擊 screenshot 的 target pixel/region，反向高亮：

`Pixel → DrawCommand → Offscreen dependency → Generation → GraphicBuffer/Frame`

並顯示 evidence class：`RESOURCE_CLOSED / STATE_CLOSED / OFFSCREEN_CLOSED / REPLAY_EXACT / REPLAY_BOUNDED / REPLAY_ONLY`。

## Code / GitHub

值得直接讀的核心原始碼：

- AOSP `frameworks/native/libs/renderengine/skia/debug/SkiaCapture.cpp`
- AOSP `frameworks/native/libs/renderengine/skia/debug/SkiaCapture.h`
- Skia `tools/debugger/DebugCanvas.cpp`
- Skia `tools/debugger/DebugLayerManager.*`
- Skia `tools/debugger/DrawCommand.*`
- Skia `experimental/wasm-skp-debugger/debugger_bindings.cpp`
- Skia `tools/SkSharingProc.*`
- Skia `tests/MultiPictureDocumentTest.cpp`
- Skia `include/core/SkSerialProcs.h`

特別值得注意：current RenderEngine tree 同時已有 Ganesh/Graphite/Vulkan backend，因此 replay fidelity 之後不能只以「GPU replay」作單一 backend identity，必須記錄實際 backend/API/config。

## Papers

### CUADebug: Diagnosing and Repairing Computer-Use Agent Failures
- Authors: Weijia Zhang et al.
- Year: 2026
- Architecture: tool-augmented failure debugger；定位 suspicious steps，檢查 paired before/after screenshots + action traces。
- Dataset: CUAErrorBench，204 條人工標註 failed trajectories。
- Contribution: 把 CUA debugging 建模為 multimodal causal localization，並用 root-cause evidence 驅動 re-execution。
- Limitations: agent-level diagnosis，沒有 OS compositor / pixel-generation provenance。
- 改變了什麼：支持 Hermes 將 provenance witness 當成 debugger 可主動查詢的 evidence，而非只做離線可視化。

### Tactile: Giving Computer-Using Agents Hands and Feet
- Authors: Yong Liu, Zhenyi Zhong, Zhanpeng Shi
- Year: 2026
- Architecture: observe-ground-act-verify；融合 accessibility、OCR、visual fallback，保留 target provenance。
- Contribution: action target 從匿名 coordinate 升級成 semantic/verifiable/auditable object。
- Limitations: 未深入 compositor buffer/pixel provenance。
- 改變了什麼：提供 Hermes `TargetObject + provenance` 上層 execution interface 的直接設計參照。

### Visual Confused Deputy
- Authors: Xunzhuo Liu et al.
- Year: 2026
- Architecture: independent dual-channel guardrail，分別驗證 visual click target 與 agent reasoning。
- Contribution: 將 grounding error、screenshot manipulation、TOCTOU 從 accuracy 問題提升為 authorization/security 問題。
- Limitations: guardrail 仍主要處理視覺/語義 evidence，未使用 compositor generation proof。

## Unknown / Open Questions 1-3

1. `SkSharingSerialContext` 對 RenderEngine production `GraphicBuffer` / protected / HDR / sideband cases，各自會產生何種 serialized representation？哪些 path 會被拒絕、降級或失真？
2. `DebugLayerManager` 的 offscreen layer reconstruction 是否能為任意 command group建立 deterministic dependency closure，還是需要在 capture 時額外輸出 explicit dependency IDs？
3. 在 production backend 為 Graphite/Vulkan、replay backend 不同時，哪一組 tolerance（exact RGBA、linear-light delta、SSIM、perceptual delta）才足以把 `COUNTERFACTUAL_PIXEL_BOUND` 升級成 `CAPTURE_PIXEL_BOUND`？

## 下一輪研究

下一輪不再確認 sharing serialization「存在」；本輪已閉合。直接追：

`SkSharingProc::serializeImage`
→ `texture-backed / non-texture image branching`
→ `collectNonTextureImagesFromPicture`
→ `AHardwareBuffer copy/readback semantics`
→ `protected image behavior`
→ `MSKP shared resource ID`
→ `SkSharingDeserialContext`
→ `DebugLayerManager offscreen dependency`
→ `backend-specific replay`
→ `baseline production diff`
→ `CAPTURE_PIXEL_BOUND`

同時開始定義 `ValidAblationClosure` 的機器可計算規則，而不是只人工判斷 command group。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `SharedImageSerializationWitness`
- `SharedImageDeserializationWitness`
- `ReplayResourceClosureWitness`
- `AHardwareBufferSerializationWitness`
- `TypefaceResourceWitness`
- `OffscreenLayerProducerWitness`
- `DeferredLayerConsumerWitness`
- `DebugLayerManagerStateWitness`
- `ValidAblationClosure`
- `BackendSpecificReplayWitness`
- `TargetProvenanceObject`

新增 Edges：
- `RenderEngineSkiaCapture --serializes_image_with--> SharedImageSerializationWitness`
- `SharedImageSerializationWitness --reconstructed_by--> SharedImageDeserializationWitness`
- `AHardwareBufferImage --tested_through--> SharedImageSerializationWitness`
- `SurfaceIDAnnotation --identifies--> OffscreenLayerProducerWitness`
- `OffscreenLayerProducerWitness --materialized_by--> DebugLayerManagerStateWitness`
- `DebugLayerManagerStateWitness --consumed_by--> DeferredLayerConsumerWitness`
- `DrawCommandGroup --requires--> ValidAblationClosure`
- `ValidAblationClosure --produces--> CounterfactualPixelWitness`
- `CounterfactualPixelWitness --gated_by--> ReplayFidelityEnvelope`
- `PixelProvenance --attached_to--> TargetProvenanceObject`

## 本輪結束判定

- **缺哪一層**：`COUNTERFACTUAL_PIXEL_BOUND → backend/resource-validated CAPTURE_PIXEL_BOUND`。
- **哪個節點最淺**：`BackendSpecificReplayWitness`，因 production/replay GPU backend equivalence 尚未量化。
- **哪個概念仍只是名詞**：`PhysicalPixelCausalWeight`；尤其 blur、HDR、nonlinear blend 下仍不能視為可加總 scalar contribution。
- **哪個系統值得讀原始碼**：`SkSharingProc + DebugLayerManager + current Graphite/Ganesh RenderEngine backend`。
- **哪篇論文需追引用**：CUADebug；它最適合連到 Hermes 的 provenance-driven causal debugger。
- **哪個概念最適合視覺模擬**：`MSKP Resource & Ablation Dependency Inspector`。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + TargetProvenanceObject + Provenance-driven Active Perception + Independent PreAction Verifier + Risk Gate`。

### 本輪核心結論

前輪最大的疑問之一「Android RenderEngine 的 MSKP 到底是否有真正的 image resource closure」本輪已大幅收斂：RenderEngine 明確使用 Skia sharing serializer，而 Skia Android 測試甚至覆蓋 AHardwareBuffer-backed image 的 serialize → release original buffer → deserialize 流程。因此下一個真正的硬問題不再是『MSKP 有沒有圖』，而是『重建出的圖與 production GPU execution 在 backend/color/protected/effect 條件下能否達到足夠 fidelity，以及 ablation 是否維持完整 offscreen/state dependency closure』。這是把 `COUNTERFACTUAL_PIXEL_BOUND` 推到真正 `CAPTURE_PIXEL_BOUND` 前的最後主要工程門檻之一。