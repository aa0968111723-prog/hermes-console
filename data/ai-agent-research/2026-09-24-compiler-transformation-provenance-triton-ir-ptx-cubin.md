# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 02:53（Asia/Taipei）

## 本小時新發現

本輪承接上一輪 `CompilerTransformationProvenanceWitness`，不重複 Dynamo/FX/Inductor 的高層介紹，而是追進 Triton current compiler source，確認 GPU kernel 並不是一次性由 Triton source 變成 cubin，而是一條可明確分段、可逐階段量測的 transformation chain：

`Inductor-selected kernel/config → Triton source → TTIR → TTGIR → LLIR → PTX → ptxas → cubin → cache → loaded kernel`

這使 Hermes 可以把「compiler provenance」從抽象名詞改造成 event-sourced transformation DAG。

### 新架構
`CompilerTransformationProvenanceGraph`

### 新 GitHub / 原始碼
- `triton-lang/triton/python/triton/compiler/compiler.py`
- `triton-lang/triton/third_party/nvidia/backend/compiler.py`
- `pytorch/pytorch/torch/_inductor/codecache.py`

### 新官方資訊
PyTorch compile cache 不只有 FX/Inductor cache；官方文件列出 Triton cache（含 cubin）、AOTAutograd cache、PGO cache、Autotuning cache，Mega-Cache 可以把多層 compiler artifact 打包/搬移。因此 cache 本身已是 executable supply-chain boundary。

---

## 本小時最重要 5 個發現

### 1. Triton compilation 是明確的多階段 transformation pipeline
**已確認事實 / 原始碼。** NVIDIA backend `add_stages()` 明確註冊 `ttir → ttgir → llir → ptx → cubin`。因此不能只驗最終 cubin；Hermes 可以對每個 stage 建立 input/output digest。

底層：
`SourceIdentity → make_ttir → TTIRDigest → make_ttgir → TTGIRDigest → make_llir → LLIRDigest → make_ptx → PTXDigest → make_cubin → CubinDigest`

重要性：任何 pass/config/backend/toolchain 改變都可能讓下游 machine code 改變。

限制：digest 能證明 artifact identity，不自動證明 transformation semantic correctness。

### 2. TTGIR pass pipeline 本身是 executable provenance 的重要輸入
**已確認事實 / 原始碼。** Current NVIDIA backend 在 TTGIR 中執行 layout conversion removal、thread locality、matmul acceleration、dot operand optimization、loop scheduling、pipeline、warp specialization、TMA lowering、fence insertion 等大量 pass；不同 compute capability 還走不同 pass branch。

因此：
`Same Triton Source --does_not_prove→ Same TTGIR`

需要：
`CompilerPassPipelineIdentity = H(pass order, compiler build, target capability, compiler options)`

### 3. Target GPU / options 不只是 deployment metadata，而是 code-generation input
**已確認事實 / 原始碼 + 官方文件。** Triton backend 依 capability 決定 pass、NVPTX target、feature set；PTX 會寫入 target SM，ptxas 再以指定 GPU arch 產生 cubin。PyTorch/Triton autotune config 又包含 num_warps、num_stages、num_ctas、maxnreg 等。

因此：
`KernelSourceDigestValid --does_not_prove→ KernelBinaryGenerationEquivalent`

新增：
`GPUCompilerTargetIdentity = H(arch, capability, PTX version, features, num_warps, num_stages, num_ctas, maxnreg, fp-fusion/options)`

### 4. ptxas 是獨立的 trusted compiler stage
**已確認事實 / 原始碼。** Triton `make_cubin()` 把 PTX 寫入 temporary file，再啟動 `ptxas`，參數包含 GPU arch、debug/optimization、fmad、register-allocation與額外 options，最後讀回 cubin bytes。

因此：
`PTXApproved --does_not_prove→ CubinApproved`

Hermes 必須記錄：
`PTXDigest + ptxasIdentity/version + ptxasOptions + targetArch → CubinDigest`

這也是上一輪 `GPUCodeTransformationWitness` 可以真正落地的位置。

### 5. Compiler cache 是 transformation graph 的 shortcut，而不是 provenance 的替代品
**已確認事實 / PyTorch 官方文件 + 原始碼。** Triton compiler 會用 compiler key/hash 查 cache；cache hit 可以直接回傳 `CompiledKernel` 而跳過完整 pipeline。PyTorch Mega-Cache 又能搬移 FXGraph/Triton/cubin/autotuning 等 artifacts。Inductor `codecache.py` 會序列化 graph details 建 key，並將 PyTorch/Inductor source 納入 torch key。

因此：
`CacheKeyMatch --does_not_prove→ ArtifactProvenanceComplete`

Hermes 應要求：
`CacheArtifactDigest + OriginalTransformationWitness + CompilerGeneration + TargetIdentity + AutotuneDecision`

---

## Architecture Breakdown

本輪 system architecture：**Compiler-Provenance-Aware AI Runtime**

`Model / Agent inference request`
→ `Dynamo/FX Graph Identity`
→ `Inductor lowering`
→ `Scheduler/Fusion Decision`
→ `Kernel Candidate Set`
→ `Autotune Decision`
→ `Triton Source Identity`
→ `TTIR`
→ `TTGIR + pass pipeline`
→ `LLVM IR`
→ `PTX`
→ `ptxas`
→ `cubin`
→ `Triton/Inductor cache`
→ `CUDA module/function`
→ `GPU Kernel Launch`
→ `GPUCodeClosureGeneration`
→ `Runtime Attestation`

Hermes proposal：每一個箭頭都產生 `CompilerTransformationEvent`：

`event = H(parentArtifactDigest, stageName, compilerIdentity, passPipelineIdentity, optionsDigest, targetIdentity, outputArtifactDigest, sequence)`

所有 event 聚合：

`CompilerTransformationProvenanceWitness = MerkleRoot(events)`

這是工程提案，不是 PyTorch/Triton 現有標準。

---

## Bottom-Level Logic

### Triton source → TTIR
建立語意較高的 Triton IR，執行 inline/canonicalize/combine/CSE/DCE/unroll 等。

### TTIR → TTGIR
加入 GPU-specific layout、thread/warp/CTA、memory、matmul、pipeline/scheduling semantics。Current NVIDIA backend依 GPU capability 選擇 Hopper/Blackwell 等不同 transformation branch。

### TTGIR → LLIR
配置 shared/tensor/global scratch memory，lower GPU operations，轉 NVVM/LLVM dialect，再形成 LLVM module；target triple 為 NVPTX CUDA，並附 target processor/features。

### LLIR → PTX
LLVM backend 產生 PTX assembly；Triton再固定 PTX version/SM target並取得 kernel entry name。

### PTX → cubin
`ptxas` 依 GPU architecture與 compiler options產生 device binary。

因此真正需要驗證的是：

`Graph → Schedule → Triton Source → TTIR → TTGIR → LLIR → PTX → Cubin`

而不是：

`Graph → cubin ✓`

---

## Visual Simulation Idea

### Compiler Transformation Provenance Microscope

互動 UI 分成 9 欄：

`FX Graph | Fusion/Schedule | Triton Source | TTIR | TTGIR | LLVM IR | PTX | ptxas | Cubin`

每欄顯示：
- artifact digest
- compiler/version
- target GPU
- options
- parent edge
- cache hit/miss
- provenance state

可注入：
- `TTGIR_PASS_ORDER_CHANGED`
- `GPU_CAPABILITY_CHANGED`
- `NUM_WARPS_CHANGED`
- `AUTOTUNE_WINNER_CHANGED`
- `TRITON_IR_OVERRIDE`
- `PTX_REPLACED_BEFORE_PTXAS`
- `PTXAS_BINARY_CHANGED`
- `PTXAS_OPTIONS_CHANGED`
- `CUBIN_CACHE_POISONED`
- `MEGACACHE_IMPORTED_FROM_DIFFERENT_COMPILER_GENERATION`

高風險判定範例：

`FX ✓ | Triton Source ✓ | TTIR ✓ | TTGIR ? | PTX ✓ | ptxas identity ✗ | cubin digest ?`
→ `COMPILER PROVENANCE INCOMPLETE → BLOCK HIGH-RISK MODEL/AGENT AUTHORIZATION`

---

## Code / GitHub

### triton-lang/triton
值得繼續看的核心檔案：
- `python/triton/compiler/compiler.py`：stage orchestration、cache、metadata、IR override/dump。
- `third_party/nvidia/backend/compiler.py`：TTIR/TTGIR/LLVM/PTX/cubin lowering與 NVIDIA target-specific passes。
- 下一輪：runtime cache / CompiledKernel / launcher path。

特別重要：current compiler 支援 `ir_override` / override manager，代表 compiler pipeline 本身存在「合法但會改變產物」的 override surface；Hermes policy 必須把 override state 納入 provenance，而不能只 hash source。

### pytorch/pytorch
- `torch/_inductor/codecache.py`：FX graph serialization/hash、torch source key、compiler artifact cache identity。
- 下一輪應讀 `torch/_inductor/scheduler.py`、`torch/_inductor/codegen/triton.py`、`torch/_inductor/runtime/triton_heuristics.py`，把 FX/Inductor scheduling/fusion 到 Triton source 的上游 edge 補齊。

---

## Papers / 技術資料

本輪重點是 current production compiler architecture，優先使用官方文件與原始碼；沒有用新聞代替底層證據。

1. PyTorch Compile Time Caching documentation — 說明 FXGraphCache、TritonCache（含 cubin）、InductorCache、AOTAutogradCache、PGO、Autotuning cache、Mega-Cache。
2. PyTorch Warp Specialization engineering report — Meta/NVIDIA，2025；展示 TTGIR communication ops、code partitioning與 TTGIR→LLVM/PTX materialization，證明 compiler transformations 會實質改變 GPU execution structure。
3. Triton current NVIDIA backend source — current production lowering implementation；不是論文，但對本輪 transformation graph 的驗證價值高於只讀架構圖。

---

## Unknown / Open Questions 1-3

1. 如何建立可重播、跨機器驗證的 pass-by-pass transformation witness，而不必保存巨大 IR 全量？
2. Autotuning依真實硬體 benchmark選 winner；如何把 measurement environment、candidate set與 winner selection變成可驗證 provenance？
3. Compiler cache hit跳過 transformation pipeline時，如何證明 cached cubin仍然對應同一 graph/compiler/pass/target generation，而不是只有 cache key碰巧匹配或 cache被污染？

---

## 下一輪研究

鎖定：

`Inductor FX graph → scheduler/fusion → kernel candidate generation → autotune benchmark → winner → Triton source → cache key`

追：
- `torch/_inductor/scheduler.py`
- `torch/_inductor/codegen/triton.py`
- `torch/_inductor/runtime/triton_heuristics.py`
- Triton autotuner/cache runtime

目標建立：
`AutotuneDecisionWitness` + `KernelCandidateSetIdentity` + `InductorFusionGeneration`

核心問題：同一 FX graph 在不同 shape、dtype、GPU、config與 benchmark noise 下可能選到不同 kernel；Hermes 如何證明「最後勝出的 kernel」確實來自批准 candidate set，且 winner 是由批准的 autotune policy與 measurement environment選出？

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `CompilerTransformationEvent`
- `CompilerTransformationProvenanceGraph`
- `CompilerTransformationProvenanceWitnessV2`
- `CompilerPassPipelineIdentity`
- `GPUCompilerTargetIdentity`
- `TTIRArtifactIdentity`
- `TTGIRArtifactIdentity`
- `LLVMIRArtifactIdentity`
- `PTXCompilerArtifactIdentity`
- `PTXASCompilerIdentity`
- `PTXASInvocationGeneration`
- `CubinCompilerArtifactIdentity`
- `CompilerCacheProvenanceWitness`
- `IROverrideGeneration`

### Edges
- `TritonSourceIdentity --lowered_by→ TTIRArtifactIdentity`
- `TTIRArtifactIdentity --transformed_by→ CompilerPassPipelineIdentity`
- `CompilerPassPipelineIdentity --produces→ TTGIRArtifactIdentity`
- `TTGIRArtifactIdentity --lowers_to→ LLVMIRArtifactIdentity`
- `LLVMIRArtifactIdentity --targets→ GPUCompilerTargetIdentity`
- `LLVMIRArtifactIdentity --emits→ PTXCompilerArtifactIdentity`
- `PTXCompilerArtifactIdentity --compiled_by→ PTXASCompilerIdentity`
- `PTXASInvocationGeneration --produces→ CubinCompilerArtifactIdentity`
- `CompilerCacheProvenanceWitness --reuses→ CubinCompilerArtifactIdentity`
- `IROverrideGeneration --mutates→ CompilerTransformationProvenanceGraph`

---

## 本輪結束判斷

- **缺哪一層：** Inductor scheduler/fusion/autotune decision → Triton source 的完整 provenance。
- **哪個節點最淺：** `AutotuneDecisionWitness`。
- **哪個概念仍只是名詞：** 可攜式、可簽章、pass-by-pass 的 `CompilerTransformationProvenanceWitnessV2`。
- **哪個系統值得讀原始碼：** TorchInductor scheduler + Triton autotuner/runtime cache。
- **哪篇/哪類資料需追引用：** Triton warp-specialization compiler transformation work與 compiler reproducibility / translation validation研究。
- **哪個概念最適合視覺模擬：** Compiler Transformation Provenance Microscope。
- **哪個 Agent 架構最值得實作：** `Risk-aware Agent Runtime + Graph/Guard Witness + Compiler Transformation DAG + GPU CodeClosure + Runtime Attestation + Non-exportable Signer + MCP SemanticCommit/Receipt`。

目前完整鏈進一步成為：

`使用者 → UI → Agent → Context → Reasoning → Planning → Model → Dynamo/FX → Inductor Schedule/Fusion → Triton Source → TTIR → TTGIR → LLVM IR → PTX → ptxas → Cubin → CUDA → GPU Kernel → Tensor → Output`

多模態：

`Camera/Image/Voice/Video → Encoder/Input Tensor → Graph Capture → Compiler Transformation DAG → GPU Kernel → Fusion/Attention/Decoder → Agent Reasoning → Action`

本輪最核心的答案是：**AI 在 GPU 上執行的 machine code，不應只被視為一個最終 cubin；它是 graph、scheduler、compiler passes、target GPU、autotuning、PTX 與 ptxas 共同形成的一條可追溯 transformation lineage。**