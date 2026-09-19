# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 15:54 Asia/Taipei

## 本小時新發現

本輪延續上一輪 `SkSharing Rasterization × Backend Fidelity Boundary`，不再重複「texture-backed SkImage 會 rasterize」；直接追下一個最淺節點：**protected content 與 HDR/dataspace 是否允許 MSKP replay evidence 升級成 production capture pixel evidence**。

核心結論：這兩條必須分開建模。Protected content 是「可讀性／授權／readback」邊界；HDR 是「表示法／dataspace／brightness／tone mapping」邊界。兩者都可能讓 `COUNTERFACTUAL_PIXEL_BOUND` 無法升級成 `CAPTURE_PIXEL_BOUND`，但原因完全不同。

## 本小時最重要 5 個發現

### 1. SurfaceFlinger 對 protected layer 會建立 protected screenshot target
**狀態：AOSP 官方原始碼 / 已確認。**

`captureScreenCommon()` 會遍歷 visible layers，若 `allowProtected && RenderEngine.supportsProtectedContent()` 且存在 protected layer，capture target usage 會包含 `GRALLOC_USAGE_PROTECTED`；否則一般 screenshot target 才加入 CPU read/write usage。

因此：

`Protected Source Layer`
→ `Protected Capture Target`
→ `RenderEngine Protected Context/Surface`
→ `GPU-only / restricted readback path`

這與普通 screenshot 的 CPU-readable capture buffer 是不同 execution class。

來源：
- AOSP SurfaceFlinger.cpp: https://android.googlesource.com/platform/frameworks/native/+/f6923a1061775ca0e97979015aa018930f0a5661/services/surfaceflinger/SurfaceFlinger.cpp
- AOSP SkiaGpuContext.h: https://android.googlesource.com/platform/frameworks/native/+/dec962bc0aeb487e19dddcd6d769a65248bd9a2e/libs/renderengine/skia/compat/SkiaGpuContext.h

### 2. protected 與 secure 不是同一概念
**狀態：AOSP 官方原始碼 / 已確認。**

SurfaceFlinger 明確區分 protected layer（典型來源為 DRM / GRALLOC protected usage）與 secure layer（應用要求不可被一般 screenshot/unsecure display 擷取）。`capturedSecureLayers` 若存在且 caller 無 blackout capture 能力，可直接得到 `PERMISSION_DENIED`；protected layer 則主要改變 buffer/context usage 與可讀性。

因此 Knowledge Graph 不應再有單一 `SensitiveVisualLayer` 節點，而應拆成：

`SecurePolicyState`
`ProtectedMemoryState`
`CaptureAuthorizationState`
`ReadbackCapabilityState`

來源：
- https://android.googlesource.com/platform/frameworks/native/+/837b0a213df965c7ca6b4f95bb89fde2ee01c1a7/services/surfaceflinger/SurfaceFlinger.cpp

### 3. AHardwareBuffer protected bit 會一路進 Skia backend texture
**狀態：AOSP/Skia 官方原始碼 / 已確認。**

Ganesh backend 建立 texture 時會讀 `AHardwareBUFFER_USAGE_PROTECTED_CONTENT`，並建立 protected image；Skia GL AHardwareBuffer import 也會在 EGL image attributes 設定 `EGL_PROTECTED_CONTENT_EXT`。

鏈條：

`AHardwareBuffer usage`
→ `PROTECTED_CONTENT bit`
→ `GaneshBackendTexture createProtectedImage`
→ `EGL_PROTECTED_CONTENT_EXT / protected GPU resource`
→ `Skia protected context/surface`

這表示 protected semantics 不是 SurfaceFlinger 上層 metadata 而已，而是進入 GPU resource creation。

來源：
- AOSP GaneshBackendTexture.cpp: https://android.googlesource.com/platform/frameworks/native/+/d09a587244661602d9a56b9786c1b28fd6861a3a/libs/renderengine/skia/compat/GaneshBackendTexture.cpp
- Skia AHardwareBufferGL.cpp: https://skia.googlesource.com/skia/+/refs/heads/main/src/gpu/ganesh/gl/AHardwareBufferGL.cpp

### 4. HDR screenshot 不是「原畫面 pixels 直接 copy」；capture path 會重新決定 dataspace/brightness/tone mapping
**狀態：AOSP 官方原始碼 / 已確認。**

SurfaceFlinger capture 會先標記 `capturedHdrLayers`，再經 `pickBestDataspace(...)` 決定 `capturedDataspace`；HDR 情況還會帶入 `sdrWhitePointNits`、`displayBrightnessNits`，並依 local tonemapping flag、preserve-display-colors/seamless-transition 條件調整 brightness/headroom。AOSP 甚至有 screenshot HDR headroom clamp。

因此 production screenshot pixel function更接近：

`Layer linear/light-domain values`
→ `source dataspace`
→ `composition color pipeline`
→ `requested/captured dataspace`
→ `SDR white point`
→ `display brightness`
→ `local/global tone mapping policy`
→ `capture target encoding`
→ `pixel`

而不是單純 `source RGBA → output RGBA`。

來源：
- Android 16 SurfaceFlinger: https://android.googlesource.com/platform/frameworks/native/+/refs/heads/android16-qpr2-release/services/surfaceflinger/SurfaceFlinger.cpp
- current AOSP snapshot: https://android.googlesource.com/platform/frameworks/native/+/dec962bc0aeb487e19dddcd6d769a65248bd9a2e/services/surfaceflinger/SurfaceFlinger.cpp

### 5. MSKP raster resource normalization 與 production HDR capture 是兩個不同 color pipeline
**狀態：官方原始碼 + 工程推論。**

上一輪已確認 SkSharing Graphite serialization 會把 texture-backed resource readback 成 `RGBA_8888 + Premul` 後再 PNG encode；本輪確認 production screenshot 同時可能保有 HDR-specific dataspace/brightness/tone-map policy。這代表：

`MSKP Resource Pixel`
≠ automatically `Production Capture Pixel`

尤其在 HDR / wide-gamut / high-precision content 下，必須量測兩條 pipeline 的 numerical error，不能只靠 visual similarity。

Skia sharing serializer source：
https://skia.googlesource.com/skia.git/+/refs/heads/main/tools/SkSharingProc.cpp

## Architecture Breakdown

### System architecture：Protected/HDR-aware Capture Provenance Gate

```text
LayerSnapshot
├─ Secure policy state
├─ Protected memory state
├─ HDR state
├─ Dataspace
└─ Logical generation identity
        ↓
SurfaceFlinger Capture Policy
├─ allowProtected?
├─ canCaptureSecure?
├─ requested dataspace
├─ preserve display colors?
└─ local tone mapping?
        ↓
Capture Target Allocation
├─ PROTECTED GPU target
└─ CPU-readable target
        ↓
RenderEngine
├─ Ganesh/Graphite
├─ protected backend texture/context
├─ color transform
└─ tone mapping
        ↓
Production Capture Buffer
        ↕ Fidelity comparison
MSKP Resource Snapshot
├─ GPU→CPU rasterization
├─ RGBA8888/Premul normalization (Graphite path)
├─ PNG
└─ Replay backend
```

Hermes 應新增一個 `CaptureFidelityGate`，只有在 authorization、resource readability、dataspace、tone-map policy、backend、representation 與 baseline numerical diff 都滿足條件時，才允許 evidence 從 replay 升級。

## Bottom-Level Logic

### Protected path

```text
AHardwareBuffer_Desc.usage
→ AHARDWAREBUFFER_USAGE_PROTECTED_CONTENT?
→ protected backend image
→ protected GPU context/surface compatibility
→ CPU readback forbidden/restricted
→ MSKP rasterization may fail / become unavailable
→ ReplayResourceFaithfulnessGate = BLOCKED_PROTECTED
```

**重要限制**：目前已確認 protected bit 會進 GPU backend，但尚未以同一個 Android RenderEngine SkiaCapture 實驗證明 protected image serialization 最終一定是哪一種 failure mode；因此「一定產生 magenta placeholder」仍是未驗證假說，不能當事實。

### HDR path

```text
LayerSnapshot
→ isHdrLayer
→ capturedHdrLayers
→ pickBestDataspace
→ sdrWhitePointNits
→ displayBrightnessNits
→ local/global tone mapping policy
→ RenderEngine color pipeline
→ capture target dataspace
→ production pixel
```

對照 replay：

```text
SkImage texture resource
→ GPU readback
→ RGBA8888/Premul normalization
→ PNG
→ decoded raster SkImage
→ replay color pipeline
→ replay pixel
```

所以新的 numeric witness 應是：

```text
ColorFidelityEnvelope {
  source_dataspace,
  capture_dataspace,
  hdr_present,
  sdr_white_nits,
  display_brightness_nits,
  tone_mapping_mode,
  source_buffer_format,
  serialization_color_type,
  serialization_alpha_type,
  replay_color_space,
  max_abs_error,
  mean_abs_error,
  deltaE_or_perceptual_error,
  target_region_hash
}
```

## Visual Simulation Idea

### Protected/HDR Capture Fidelity Lab

Hermes Console 顯示左右兩條 pipeline：

```text
PRODUCTION                           REPLAY
Layer B91/F471                       Layer B91/F471
  ↓ protected/HDR                      ↓ SkImage
Capture policy                         ↓ readback
  ↓ dataspace/tone map                 ↓ RGBA8888/Premul
RenderEngine                           ↓ PNG
  ↓                                    ↓ replay backend
Capture pixel P(x,y)                 Replay pixel R(x,y)
             \                       /
              → Fidelity Gate ←
```

互動：點 screenshot 任一 pixel/region，顯示 `SECURE / PROTECTED / HDR / DATASPACE / TONE-MAP / READBACK / SERIALIZATION / REPLAY` 八層 witness。若 protected path 無合法 readback，UI 不應偽造 pixel provenance，而要顯示 `PROVENANCE TERMINATED BY PROTECTED MEMORY BOUNDARY`。

HDR 則顯示 production/replay RGB、absolute error、perceptual error，以及哪一個 color-pipeline stage 首次造成 divergence。

## Code / GitHub

本輪最值得繼續看的原始碼：

1. `frameworks/native/services/surfaceflinger/SurfaceFlinger.cpp` — capture policy、protected target、HDR dataspace/brightness/tone mapping。
2. `frameworks/native/libs/renderengine/skia/compat/GaneshBackendTexture.cpp` — AHardwareBuffer protected bit → backend image。
3. `frameworks/native/libs/renderengine/skia/compat/SkiaGpuContext.h` — Ganesh/Graphite context abstraction 與 protected surface semantics。
4. `skia/src/gpu/ganesh/gl/AHardwareBufferGL.cpp` — protected AHardwareBuffer → EGL protected image。
5. `skia/tools/SkSharingProc.cpp` — replay resource rasterization/PNG boundary。

## Papers / Benchmarks

### WeaveBench: A Long-Horizon, Real-World Benchmark for Computer-Use Agents with Hybrid Interfaces
Authors: Wanli Li, Bowen Zhou, Yunyao Yu, Zhou Xu, Yifan Yang, Dongsheng Li, Caihua Shan. 2026.
URL: https://arxiv.org/abs/2606.09426
Architecture: GUI + CLI/code hybrid agent runtime；trajectory-aware judge 同時檢查 deliverables、files、screenshots、logs、action traces。
Contribution: 114 個長流程真實任務；最佳 reported PassRate 41.2%，並顯示 outcome-only grading 會高估 agent performance。
Limitations: benchmark 層證據，不直接驗證 compositor/pixel provenance。
改變了什麼：支持 Hermes 把「visual evidence」與 file/log/persistent-state witness 合併，而不是讓 screenshot 成為唯一 verifier。

### WindowsWorld
Authors: Jinchao Li et al. 2026.
URL: https://arxiv.org/abs/2604.27776
Dataset: 181 tasks，17 desktop apps，78% multi-application。
Contribution: process-centric、cross-application benchmark；leading agents 在 multi-app tasks reported success <21%。
Limitations: Windows desktop benchmark，與 Android compositor 路徑不同。
改變了什麼：強化 Hermes `ProcessWitnessGraph` 的必要性——長流程的 correctness 必須跨 observation/action/subgoal/persistent outcome，而非只驗證終局畫面。

## 與歷史研究比較

前幾輪已依序閉合：

`Capture Layer Generation Identity`
→ `GraphicBuffer Exact Join`
→ `LayerSettings / Region Composition`
→ `Skia Draw Command Bound`
→ `Command Ablation`
→ `MSKP Resource Closure`
→ `GPU→Raster Serialization Boundary`

本輪沒有重複以上節點，而是新增兩個會阻止 evidence 升級的 gate：

`ProtectedMemoryBoundary`
與
`HDRColorFidelityBoundary`。

這使原本單一路徑：

`COUNTERFACTUAL_PIXEL_BOUND → CAPTURE_PIXEL_BOUND`

改成：

```text
COUNTERFACTUAL_PIXEL_BOUND
→ Authorization Gate
→ Protected Readback Gate
→ Resource Faithfulness Gate
→ Color/HDR Fidelity Gate
→ Backend Numerical Equivalence Gate
→ CAPTURE_PIXEL_BOUND
```

## Unknown / Open Questions

1. Android RenderEngine `SkiaCapture` 遇到 protected texture-backed SkImage 時，實際 `serializeImage()` 是 encode failure、readback failure、skip、placeholder，還是 capture 本身被禁止？需要真機/AOSP instrumentation 實測。
2. HDR production capture 與 MSKP replay 在 BT2020_PQ / BT2020_HLG / Display-P3 等 dataspace 下的最大 numeric/perceptual error 是多少？目前沒有足夠證據可設定統一 threshold。
3. protected screenshot target 若無 CPU readback，能否在同一 protected GPU domain 內建立 non-readable contributor-ID side pass，只輸出非敏感 provenance metadata，而不洩露 protected pixels？這是值得探索但尚未驗證的架構。

## 下一輪研究

下一輪不再問「protected bit 是否存在」；這已閉合。應追：

```text
RenderEngine SkiaCapture
→ protected SkImage serialization behavior
→ readback/encode failure point
→ SkSharing placeholder branch
→ HDR source format/dataspace
→ production capture target format
→ PNG/replay normalization
→ numerical/perceptual diff harness
→ fidelity thresholds
→ CAPTURE_PIXEL_BOUND
→ Vision Encoder preprocessing
```

若 protected branch 天生不可讀，下一輪應把它正式建模為 **proof boundary**，而不是硬追 pixel value；同時開始把可讀 SDR/HDR capture 接到 Vision Encoder 的 resize/crop/normalize/patchification，準備跨入 `VISION_TOKEN_REGION_BOUND`。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `ProtectedMemoryState`
- `SecurePolicyState`
- `CaptureAuthorizationState`
- `ProtectedCaptureTarget`
- `ProtectedBackendTextureWitness`
- `ProtectedReadbackBoundary`
- `HdrLayerWitness`
- `CapturedDataspaceWitness`
- `ScreenshotToneMappingWitness`
- `ScreenshotBrightnessEnvelope`
- `ColorFidelityEnvelope`
- `HdrColorFidelityBoundary`
- `CaptureFidelityGate`
- `ProcessWitnessGraph`

新增 Edges：
- `AHardwareBufferUsage → ProtectedMemoryState`
- `ProtectedMemoryState → ProtectedBackendTextureWitness`
- `ProtectedBackendTextureWitness → ProtectedReadbackBoundary`
- `SecurePolicyState → CaptureAuthorizationState`
- `HdrLayerWitness → CapturedDataspaceWitness`
- `CapturedDataspaceWitness → ScreenshotToneMappingWitness`
- `ScreenshotBrightnessEnvelope → ScreenshotToneMappingWitness`
- `ReplayResourceFaithfulnessGate → ColorFidelityEnvelope`
- `ColorFidelityEnvelope → CaptureFidelityGate`
- `CaptureFidelityGate → CAPTURE_PIXEL_BOUND`

## 本輪結束判斷

**缺哪一層：** production-vs-replay 的實測 numeric/color fidelity，以及 protected SkiaCapture 的真實 failure semantics。

**哪個節點最淺：** `ProtectedReadbackBoundary → SkiaCapture serialization outcome`。

**哪個概念仍只是名詞：** `ProtectedResourceReplayWitness`；目前尚不能宣稱 protected pixels 可被 replay。

**哪個系統值得讀原始碼：** Android RenderEngine `SkiaCapture + SkSharingProc + Ganesh/Graphite protected backend`。

**哪篇論文需追引用：** WeaveBench，尤其 trajectory-aware judge 對 screenshot/log/file/action trace 的證據融合。

**哪個概念最適合視覺模擬：** `Protected/HDR Capture Fidelity Lab`。

**哪個 Agent 架構最值得實作：** `State-grounded Planner + Provenance-driven Active Perception + CaptureFidelityGate + Process/Outcome Verifier + Independent PreAction Risk Gate`。

本輪最重要的模型修正：**pixel provenance 並不是「追到 RenderEngine 就完成」。對 protected content，證據可能依法/硬體設計在 readback boundary 終止；對 HDR，證據雖可讀，但必須穿過 dataspace、brightness 與 tone-mapping fidelity gate。Hermes 應把「無法證明」本身建模成正式、可視化的 provenance state，而不是用 replay 畫面假裝已閉合。**