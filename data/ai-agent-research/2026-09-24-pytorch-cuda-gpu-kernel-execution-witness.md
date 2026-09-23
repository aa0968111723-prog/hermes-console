# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 00:52（Asia/Taipei）

## 本小時新發現
本輪承接上一輪 `SymbolBindingGeneration → GPUKernelExecutionWitness`，不再重複 CPU ELF / PLT/GOT，而是第一次把可驗證 execution chain 接進 PyTorch dispatcher、CUDA module、PTX/cubin 與 GPU kernel selection。

主要新來源：PyTorch current dispatcher source / devlog、NVIDIA CUDA 13.4 Driver API / Programming Guide / PTX Compiler API。

核心新鏈：

`Python torch op → C++ OperatorHandle → DispatchKeySet → highest-priority DispatchKey → registered CUDA kernel → CUDA Runtime/Driver → module image (fatbin/cubin/PTX) → architecture selection/JIT/finalization → CUmodule → CUfunction → kernel launch → GPU executable code`

## 本小時最重要 5 個發現

### 1. PyTorch operator name 並不等於實際 kernel identity
**已確認事實 / current source**：PyTorch dispatcher 的 active dispatch path 會從 `DispatchKeySet` 選取最高優先 key；operator registration table 把 `(operator, dispatch key)` 對應到 kernel implementation。CUDA、CPU、Autograd、Autocast 等都可能改變實際路徑。

因此：

`TorchOperatorIdentity --does_not_prove→ SelectedKernelImplementationIdentity`

Hermes 應新增：

`TorchDispatchDecision = H(operatorSchema, tensorDispatchKeys, TLSIncludedKeys, TLSExcludedKeys, selectedDispatchKey, registeredKernelIdentity)`

### 2. CUDA module input不是單一「GPU binary」
**NVIDIA 官方資訊**：Driver API `cuModuleLoad*` 可以接受 cubin、fatbin、PTX（新版本也包含 Tile IR）；fatbin 可包含多個不同 architecture 的 cubin/PTX。`cuModuleGetFunction()` 才從 module 取得 kernel function handle。

因此：

`CUDAHostLibraryApproved --does_not_prove→ GPUDeviceCodeApproved`

CPU 上 `libtorch_cuda.so` 的 provenance 不能替代 device-code provenance。

### 3. PTX 是可再次編譯的 virtual ISA；最終 GPU bytes 可能在部署機器才出現
**NVIDIA 官方資訊**：若 target GPU 有相容 native cubin，runtime 可直接使用；否則若 fatbin 含 PTX，driver 會將 PTX JIT compile 成 target GPU binary。PTX Compiler API 也能將 PTX 顯式轉成 GPU assembly/code，再交給 `cuModuleLoadData*`。

所以：

`PTXDigestValid --does_not_prove→ FinalGPUExecutableDigestKnownAheadOfTime`

新的 provenance chain：

`Source/CUDA op → PTX identity → JIT compiler/driver identity → target compute capability → JIT options → generated device-code identity → loaded module generation`

### 4. CUDA lazy loading讓 GPU code closure 可以在 signer authorization 之後才改變
**NVIDIA 官方資訊**：`CUDA_MODULE_LOADING=LAZY` 時，特定 kernel 的 device code 可以延遲到 function handle extraction / first use；EAGER 則在 module/library load 時較早 materialize。

因此：

`GPUCodeClosureAtAgentStartup --does_not_prove→ GPUCodeClosureAtEffectTime`

Hermes 必須把 `GPUCodeClosureGeneration` 做成 event-sourced，而不是 startup snapshot。

事件至少包括：
`CUDA_MODULE_LOAD`, `CUDA_LIBRARY_LOAD`, `CUDA_FUNCTION_RESOLVE`, `PTX_JIT`, `CUBIN_FINALIZE`, `KERNEL_FIRST_LOAD`, `MODULE_UNLOAD`。

### 5. 新 GPU architecture 還引入 cubin off-target finalization
CUDA 13.4 Programming Guide指出，對較新 compute capability，某些 cubin 在相容 GPU family 的不同 architecture 上可由 driver 做 off-target finalization。這和 PTX JIT 是不同 transformation。

因此 GPU provenance不能只有 `PTX → JIT → cubin`；還需要：

`InputCubin → DriverFinalization → TargetArchitecture → FinalizedGPUCode`

建立：

`GPUCodeTransformationGeneration`。

## Architecture Breakdown

### System Architecture：PyTorch → CUDA GPU execution

1. Python API 建立 operator call，例如 tensor op。
2. PyTorch schema/operator registry解析 operator identity。
3. Tensor metadata形成 `DispatchKeySet`。
4. TLS included/excluded keys 修改 effective key set。
5. Dispatcher選 highest-priority dispatch key。
6. `(operator, dispatch key)` lookup到 registered kernel。
7. CUDA backend kernel進入 CUDA runtime/driver。
8. Device-code module 由 fatbin/cubin/PTX/IR 提供。
9. Driver依 GPU architecture與 module loading policy選擇/產生 device code。
10. PTX可能 JIT；較新 cubin可能 off-target finalization。
11. `CUmodule` 建立。
12. `cuModuleGetFunction()` / equivalent 取得 function handle。
13. Kernel launch把 function + grid/block + arguments + stream提交給 GPU。
14. GPU scheduler/driver執行 device code。

Hermes proposed witness chain：

`TorchOperatorWitness → TorchDispatchDecision → HostCUDAKernelWitness → DeviceModuleInputWitness → GPUCodeTransformationWitness → LoadedGPUFunctionWitness → GPUKernelLaunchWitness → GPUKernelExecutionWitness`

## Bottom-Level Logic

### CUDA module / JIT identity

建議第一版 identity：

`DeviceModuleInputIdentity = H(inputType, inputBytesDigest, toolkitProducer, moduleLoadOptions)`

`GPUCodeTransformationWitness = H(inputIdentity, driverVersion, JITCompilerIdentity, targetComputeCapability, JITOptions, outputCodeDigest?, cacheIdentity, transformationType)`

其中 `transformationType ∈ {NATIVE_CUBIN, PTX_JIT, OFF_TARGET_FINALIZATION, RUNTIME_COMPILE}`。

`LoadedGPUFunctionIdentity = H(moduleGeneration, functionName, functionHandleGeneration, targetDeviceIdentity)`

`GPUKernelLaunchWitness = H(functionIdentity, gridDim, blockDim, sharedMem, streamGeneration, argumentSchemaDigest, codeClosureGeneration)`

注意：這些是 Hermes architecture proposal，不代表 CUDA API 已原生提供完整 signed attestation envelope。

### 已確認 vs 推論

- 已確認：PyTorch dispatch key決定 backend kernel選擇。
- 已確認：CUDA module可由 cubin/fatbin/PTX載入。
- 已確認：PTX可在 load/runtime被 JIT 成 target device code。
- 已確認：CUDA支援 lazy module/kernel loading。
- 已確認：新 architecture 存在 cubin off-target finalization。
- 工程推論：Hermes可用 driver/runtime interception + module/function event log建立 `GPUCodeClosureGeneration`。
- 尚未驗證：能否在一般 production CUDA stack 中取得每個實際 resident GPU instruction image 的穩定 cryptographic digest並遠端 attestation。

## Visual Simulation Idea

### PyTorch → GPU Kernel Execution Microscope

互動層：

`Python Op | DispatchKeySet | Dispatcher | CUDA backend | libcuda | Fatbin/PTX/Cubin | JIT/Finalizer | CUmodule | CUfunction | Stream | GPU`

點擊一個 `torch` op 後逐步顯示：

`aten::op → effective DispatchKeySet → CUDA → registered host kernel → module input → PTX/cubin decision → JIT/finalization → function → launch`。

故障注入：
- `DISPATCH_KEY_CHANGED_BY_TLS`
- `CUSTOM_CUDA_KERNEL_REGISTRATION`
- `PTX_CHANGED_SAME_HOST_LIBRARY`
- `PTX_JIT_AFTER_SIGNER_AUTH`
- `DRIVER_VERSION_CHANGED`
- `TARGET_GPU_ARCH_CHANGED`
- `CUBIN_OFF_TARGET_FINALIZED`
- `CUDA_MODULE_LAZY_LOAD_AFTER_AUTH`
- `FUNCTION_RESOLVES_FROM_DIFFERENT_MODULE`

最重要 UI：

`Torch op ✓ | CUDA dispatch ✓ | Host kernel ✓ | PTX provenance ✓ | JIT transform ? | Final GPU code ?`

→ `GPU EXECUTION PROVENANCE INCOMPLETE → HIGH-RISK EFFECT BLOCKED`

## Code / GitHub

### PyTorch
值得繼續看的 current tree：
- `aten/src/ATen/core/dispatch/Dispatcher.h`
- `aten/src/ATen/core/dispatch/Dispatcher.cpp`
- `aten/src/ATen/core/dispatch/OperatorEntry.*`
- `aten/src/ATen/native/native_functions.yaml`
- `aten/src/ATen/native/cuda/`
- generated `RegisterCUDA_*` code
- `c10/cuda/`

Current source evidence shows dispatcher obtains `highestPriorityTypeId()` from dispatch key set; current docs/source examples show operators can have distinct CPU/CUDA registrations.

### NVIDIA CUDA
下一步值得讀：
- CUDA Driver API Module Management
- CUDA Library Management
- kernel launch APIs
- PTX Compiler API
- NVRTC
- nvJitLink
- CUDA lazy loading implementation/observability
- CUPTI callback/activity APIs

## Papers / Technical Sources
本輪主要是 architecture + official implementation path，未用產品新聞替代底層來源。

1. **CUDA Driver API 13.4 — Module Management**. NVIDIA, 2026. Architecture: host module loader → cubin/fatbin/PTX → CUmodule/CUfunction. Contribution: 定義 module/device-code load與JIT入口。Limitation: API reference不是 remote attestation protocol。
2. **CUDA Programming Guide 13.4 — Driver API / CUDA Platform / Environment Variables**. NVIDIA, 2026. 說明 PTX JIT、lazy loading、off-target finalization。
3. **PTX Compiler API 13.4**. NVIDIA, 2026. 將 PTX compilation 與 driver load拆開，證明 GPU executable transformation可發生在 runtime pipeline 中。
4. **PyTorch Dispatcher DevLog / current source**. PyTorch, 2026. 說明 operator + DispatchKeySet + registration table如何決定 kernel implementation。

## Unknown / Open Questions

1. CUDA/CUPTI 是否能在不改 driver 的情況下取得「最終實際 GPU resident code」足以形成穩定 cryptographic execution witness？
2. PTX JIT cache 的 cache key / output artifact與 driver/toolkit/GPU architecture之間，哪些欄位足以形成可重現 provenance？
3. PyTorch 2.x compiler stack（TorchDynamo → AOTAutograd → Inductor → Triton）會產生 runtime GPU kernels；它們如何接入同一 `GPUCodeClosureGeneration`？

## 下一輪研究
下一輪優先轉入真正現代 AI inference會大量遇到的動態 kernel generation：

`torch.compile → TorchDynamo graph capture → FX graph → AOTAutograd → Inductor → Triton IR → LLVM/PTX → CUDA driver JIT → GPU kernel → cache → launch`

並比較 eager PyTorch 與 compiled PyTorch：同一句 model forward 為什麼可能產生完全不同的 GPU execution graph。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `TorchOperatorIdentity`
- `TorchDispatchKeySetGeneration`
- `TorchDispatchDecision`
- `RegisteredCUDAKernelIdentity`
- `DeviceModuleInputIdentity`
- `PTXArtifactIdentity`
- `CubinArtifactIdentity`
- `FatbinArtifactIdentity`
- `GPUCodeTransformationGeneration`
- `PTXJITGeneration`
- `CubinFinalizationGeneration`
- `CUDAModuleGeneration`
- `LoadedGPUFunctionIdentity`
- `GPUCodeClosureGeneration`
- `GPUKernelLaunchWitness`
- `GPUKernelExecutionWitness`

### Edges
- `TorchOperatorIdentity --dispatches_via→ TorchDispatchDecision`
- `TorchDispatchDecision --selects→ RegisteredCUDAKernelIdentity`
- `RegisteredCUDAKernelIdentity --does_not_prove→ GPUDeviceCodeApproved`
- `DeviceModuleInputIdentity --transformed_by→ GPUCodeTransformationGeneration`
- `PTXArtifactIdentity --jit_compiles_to→ GPU executable code`
- `CubinArtifactIdentity --may_finalize_to→ target GPU code`
- `CUDA_MODULE_LAZY_LOADING --can_mutate_after→ GPUCodeClosureGeneration`
- `LoadedGPUFunctionIdentity --launched_as→ GPUKernelLaunchWitness`
- `GPUKernelLaunchWitness --targets→ GPUKernelExecutionWitness`

## 本輪結束判定
- **缺哪一層：** GPU launch witness → GPU resident/fetched machine-code cryptographic identity + hardware-backed execution attestation。
- **哪個節點最淺：** `GPUKernelExecutionWitness`。
- **哪個概念仍只是名詞：** portable signed `GPUCodeTransformationWitness` / `GPUKernelExecutionWitness`。
- **哪個系統值得讀原始碼：** PyTorch Inductor/Triton + CUDA/CUPTI；下一輪優先 Inductor/Triton。
- **哪篇/規格需追引用：** CUDA PTX JIT / module loading與 PyTorch dispatcher後續對 compiler stack的實作文件。
- **哪個概念最適合視覺模擬：** `PyTorch → GPU Kernel Execution Microscope`。
- **哪個 Agent 架構最值得實作：** `Risk-aware Agent Runtime + CPU CodeClosure + TorchDispatchWitness + GPUCodeClosure Monitor + Runtime Attestation + Non-exportable Signer + MCP SemanticCommit/Receipt`。

最終 end-to-end graph 現在已延伸為：

`User → UI → Agent → Context → Reasoning → Planning → Model → PyTorch Operator → Dispatcher → CUDA Backend → CUDA Driver → PTX/Cubin → JIT/Finalization → GPU Kernel → Tensor Output → Agent → Tool/MCP → Effect → Receipt → UI`

多模態則為：

`Camera/Image/Voice/Video → Decoder/Encoder → Tensor → PyTorch Dispatcher → CUDA module → GPU kernel → multimodal fusion/Transformer → reasoning/agent → action`。
