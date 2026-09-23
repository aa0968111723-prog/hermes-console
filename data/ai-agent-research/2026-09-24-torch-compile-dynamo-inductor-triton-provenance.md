# 【AI Agent × Multimodal Research Report】

時間：2026-09-24 01:52（Asia/Taipei）

主題：torch.compile → TorchDynamo → FX/AOTAutograd → TorchInductor → Triton → GPU Kernel Provenance

## 本小時新發現

本輪承接上一輪 `GPUKernelExecutionWitness`，不重複 CUDA module/PTX/cubin 基礎，而是補「高階 model graph 如何生成 device code」這條 provenance chain。

已確認的官方 architecture：`torch.compile` 以 TorchDynamo 捕捉 Python/PyTorch execution 為 FX graph；training path 可經 AOTAutograd/AOTDispatcher 產生 forward/backward graph；預設 backend TorchInductor 對 NVIDIA/AMD/Intel GPU 以 Triton 作為重要 codegen building block。PyTorch 亦提供 AOT compilation，可把 graph tracing、Inductor code generation、Triton kernel compilation、autotuning提前完成並序列化 artifact。

本輪核心結論：

`ApprovedModelWeights + ApprovedPyTorchRuntime --does_not_prove→ ApprovedGeneratedGPUKernel`

因為 compiler output 還依賴 captured graph、guards、input specialization、decomposition/partition、Inductor configuration、Triton compiler、autotuning decision、GPU architecture與 cache artifact。

## 本小時最重要 5 個發現

### 1. Dynamo captured graph 是新的 executable-generation boundary

概念：TorchDynamo 使用 CPython Frame Evaluation API/bytecode analysis，在 Python frame 執行前捕捉 PyTorch operation sequence，輸出 FX Graph。

底層鏈：
`Python frame → bytecode/frame evaluation → Dynamo tracing → FX Graph → backend callable`

重要性：同一份 Python source 在不同 guards/input state 下可以形成不同 compiled result；所以 source digest 不是 compiled execution identity。

限制：graph break 會讓 execution 同時包含 compiled region 與 eager region。

新增：`DynamoGraphGeneration`、`FXGraphIdentity`、`GraphBreakGeneration`。

### 2. Guards / recompilation 是 code generation identity 的一部分

PyTorch 文件確認同一 frame 可因 guard failure 多次 compilation，compiled result cache 綁在 code object；recompile limit 後甚至可 fallback eager。

因此：
`SamePythonCode --does_not_prove→ SameCompiledGraph`

Hermes 應保存：
`GuardSetIdentity = H(shape,dtype,device,Python/object assumptions,dynamic-shape policy,compiler generation)`

並建立：
`GuardSet → selects → CompiledGraphGeneration`

如果 guard failure 造成 recompile：
`CompiledGraphGeneration++ → GPUCodeClosureGeneration++`

### 3. AOTAutograd 會把 backward computation 也變成 compiler artifact

training path 並非只有 forward。AOTAutograd/AOTDispatcher 可捕捉 backward graph，並 partition forward/backward state。

因此 training agent 的 executable graph應拆成：
`ForwardFXGraph → partition/decomposition → ForwardCompiledArtifact`
`BackwardFXGraph → partition/decomposition → BackwardCompiledArtifact`

`ForwardGraphApproved --does_not_prove→ BackwardGraphApproved`

新增：`AOTAutogradGraphGeneration`、`ForwardPartitionIdentity`、`BackwardPartitionIdentity`。

### 4. Inductor/Triton cache 是 executable supply-chain的一部分

PyTorch官方 caching 文件列出 FXGraphCache、TritonCache（包含 Triton compilation生成的 cubin）、InductorCache、AOTAutogradCache與 AutotuningCache；autotuning會 benchmark候選 kernel並保存選擇。

因此：
`CompilerInputGraphValid --does_not_prove→ CacheArtifactValid`

需要：
`CompilerArtifactWitness = H(FXGraphIdentity, GuardSetIdentity, InductorConfig, TritonSourceDigest, TritonCompilerIdentity, GPUArch, AutotuneDecision, GeneratedArtifactDigest, CacheKey)`

cache hit 必須被視為 provenance lookup，而不是直接等價於可信 execution。

### 5. AOT compilation 提供比 runtime JIT 更容易 attestation 的部署模式

2026 PyTorch官方 `aot_compile()` 可提前完成 tracing、Inductor codegen、Triton kernel compilation與 autotuning，序列化 compiled artifact；example inputs決定 shape/dtype/device validity。

因此 Hermes 可建立兩個 profile：

`RUNTIME_JIT_DYNAMIC`：每次新 graph/guard/autotune/kernel generation 都更新 GPUCodeClosureGeneration。

`AOT_COMPILED_ATTESTABLE`：deployment前生成 artifact manifest + digest + compiler/toolchain identity；runtime只允許符合 guards的已批准 compiled artifact。

後者更適合高風險 Agent inference/signing runtime。

## Architecture Breakdown

`User/Input`
→ `Python model forward`
→ `CPython frame`
→ `TorchDynamo`
→ `FX Graph`
→ `Guard Set`
→ `AOTAutograd/AOTDispatcher (training)`
→ `decomposition/partition`
→ `TorchInductor`
→ `scheduler/fusion/codegen`
→ `generated Triton kernel source`
→ `Triton compiler`
→ `PTX/cubin/device artifact`
→ `Autotune candidate benchmark/selection`
→ `Compiler Cache`
→ `CUDA module/function`
→ `GPU launch`
→ `GPUKernelExecutionWitness`

重要 distinction：
`Model Identity ≠ Graph Identity ≠ Compiler Artifact Identity ≠ Loaded GPU Function Identity ≠ Kernel Launch Identity`

## Bottom-Level Logic

本輪 proposed witness：

`CompiledGPUKernelProvenanceWitness = H(`
` modelGraphGeneration,`
` fxGraphDigest,`
` guardSetDigest,`
` decompositionPartitionDigest,`
` inductorVersionConfig,`
` tritonSourceDigest,`
` tritonCompilerIdentity,`
` targetGPUArchitecture,`
` autotuneDecisionDigest,`
` generatedArtifactDigest,`
` cacheArtifactIdentity,`
` loadedGPUFunctionIdentity,`
` gpuCodeClosureGeneration )`

只有：
`GraphBound ∧ GuardsValid ∧ CompilerPolicyMatch ∧ GeneratedArtifactDigestMatch ∧ CacheProvenanceValid ∧ LoadedFunctionBound`
才能升級：
`GENERATED → PROVENANCE_BOUND → APPROVED_FOR_GPU_EXECUTION`。

這是 Hermes architecture proposal；不是 PyTorch/Triton 現成的 cryptographic attestation protocol。

## Visual Simulation Idea

### Model Graph → Generated GPU Kernel Microscope

互動層：
`Python | Dynamo | FX Graph | Guards | AOTAutograd | Inductor | Triton Source | Autotune | Cache | PTX/Cubin | CUDA | GPU`

故障注入：
- `GUARD_FAILURE_RECOMPILE`
- `GRAPH_BREAK_TO_EAGER`
- `CUSTOM_BACKEND_CHANGED`
- `INDUCTOR_CONFIG_CHANGED`
- `TRITON_SOURCE_CHANGED`
- `AUTOTUNE_WINNER_CHANGED`
- `FX_CACHE_POISONED`
- `TRITON_CACHE_CUBIN_REPLACED`
- `GPU_ARCH_CHANGED`
- `AOT_ARTIFACT_GUARD_MISMATCH`

UI 應顯示：
`Model ✓ | FX Graph ✓ | Guards ✓ | Inductor ✓ | Triton source ✓ | Autotune ? | cache artifact ✓ | loaded GPU function ✓`

若任一 executable transformation 缺 witness：`GPU EXECUTION PROVENANCE INCOMPLETE`。

## Code / GitHub

本輪直接追 PyTorch source：
- `torch/_inductor/compile_fx.py`：FX graph進入 Inductor compiler的核心路徑；current source亦包含 recursive graph passes、joint/pre-grad passes等 transformation boundary。
- `torch/_inductor/codecache.py`：`FxGraphCache` local cache寫入與 compiler artifact caching核心。
- `torch/_functorch/_aot_autograd/autograd_cache.py`：AOTAutograd cache與 Inductor codecache相接。

下一輪值得讀：
- `torch/_inductor/graph.py`
- `torch/_inductor/scheduler.py`
- `torch/_inductor/codegen/triton.py`
- `torch/_inductor/runtime/triton_heuristics.py`
- Triton `python/triton/compiler/compiler.py`
- Triton backend LLVM/PTX lowering。

## Papers / Technical Sources

本輪以官方 PyTorch architecture/current source為主，因目標是建立可驗證 implementation graph，而非堆疊論文摘要。需在下一輪補追 TorchDynamo、AOTAutograd、TorchInductor/Triton compiler相關設計論文/技術文章，並把 paper abstraction與 current implementation逐項對照。

## Unknown / Open Questions

1. 如何建立穩定 canonical FX Graph digest，使 node metadata/非語義 serialization差異不造成假 generation？
2. Triton autotuning winner與實際 loaded cubin之間，是否能建立 portable、可簽章的 artifact manifest？
3. runtime cache hit時，如何證明 cache artifact是由被批准的 compiler/toolchain/input graph產生，而不是只驗最終 cubin hash？

## 下一輪研究

`FX Graph → Inductor scheduler/fusion → Triton source generation → Triton IR → LLVM/NVPTX lowering → PTX/cubin → cache key → autotune → loaded kernel`

優先補最淺節點：`CompilerTransformationProvenanceWitness`。

## Knowledge Graph 新增 Node / Edge

Nodes：
- `DynamoGraphGeneration`
- `FXGraphIdentity`
- `GraphBreakGeneration`
- `GuardSetIdentity`
- `CompiledGraphGeneration`
- `AOTAutogradGraphGeneration`
- `ForwardPartitionIdentity`
- `BackwardPartitionIdentity`
- `InductorCompilationGeneration`
- `TritonKernelSourceIdentity`
- `AutotuneDecisionGeneration`
- `CompilerCacheArtifactIdentity`
- `CompiledGPUKernelProvenanceWitness`
- `AOTCompiledArtifactIdentity`

Edges：
- `PythonFrame --captured_by→ DynamoGraphGeneration`
- `DynamoGraphGeneration --produces→ FXGraphIdentity`
- `GuardSetIdentity --selects→ CompiledGraphGeneration`
- `GuardFailure --increments→ CompiledGraphGeneration`
- `FXGraphIdentity --lowered_by→ InductorCompilationGeneration`
- `InductorCompilationGeneration --generates→ TritonKernelSourceIdentity`
- `TritonKernelSourceIdentity --compiled_to→ GPUCodeTransformationGeneration`
- `AutotuneDecisionGeneration --selects→ GeneratedGPUKernelArtifact`
- `CompilerCacheArtifactIdentity --may_supply→ GeneratedGPUKernelArtifact`
- `CompiledGPUKernelProvenanceWitness --authorizes→ GPUKernelExecutionWitness`

## 本輪結束判定

- 缺哪一層：Inductor/Triton 每一步 compiler transformation 的可重播 provenance。
- 哪個節點最淺：`CompilerTransformationProvenanceWitness`。
- 哪個概念仍只是名詞：portable signed `CompiledGPUKernelProvenanceWitness`。
- 哪個系統值得讀原始碼：TorchInductor scheduler/codegen + Triton compiler/backend。
- 哪篇論文需追引用：TorchDynamo/AOTAutograd/Inductor/Triton compiler設計資料，下一輪與 current source交叉比對。
- 哪個概念最適合視覺模擬：Model Graph → Generated GPU Kernel Microscope。
- 哪個 Agent 架構最值得實作：`Risk-aware Agent Runtime + CPU CodeClosure + Graph/Guard Witness + Compiler Provenance Monitor + GPUCodeClosure + Runtime Attestation + Non-exportable Signer + MCP SemanticCommit/Receipt`。

最終鏈新增：
`UI → Agent → Context → Reasoning → Planning → Model → Python → Dynamo → FX/Guards → AOTAutograd → Inductor → Triton → PTX/Cubin → CUDA → GPU → Tensor → Output`

多模態鏈：
`Camera/Image/Voice/Video → Encoder/Input Tensors → Dynamo/FX specialization → Inductor/Triton generated kernels → GPU fusion/attention kernels → multimodal tokens/features → reasoning/agent → action`。
