# 【AI Agent × Multimodal Research Report】

時間：2026-09-24 18:55（Asia/Taipei）

主題：GraphPointerBindingWitness → Compiled Kernel / Backend Selection → Numerical Semantics → Final Norm → LM Head → RawLogitsGeneration

## 與歷史研究比較
上一輪已建立 StorageGenerationIdentity、GraphPointerBindingWitness 與 CUDAGraphDispatchWitness，回答「pointer 是否仍屬於正確 tensor generation」。本輪不重複 allocator/stream/collective，而補下一層：即使輸入 tensor、pointer、weights 都正確，runtime 實際選到哪個 compiled kernel、哪個 backend、哪種 accumulation/reduction policy，仍會改變數值路徑，最後可能改變 logits 與 token。

## 本小時新發現
1. PyTorch SDPA 不是單一實作；runtime 可在 FlashAttention、memory-efficient、cuDNN、math 等 backend 中選擇，官方明確指出 fused floating-point implementations 的 output 可能不同。
2. kernel identity 必須包含 backend、compiled artifact、shape specialization、dtype、GPU architecture、math/accumulation policy，而不能只記 logical op 名稱。
3. NVIDIA CUTLASS 4.8（2026-09）同一 GEMM abstraction 支援 TF32/BF16/FP16/FP8/FP4/MX formats與不同 architecture/policy specialization；logical GEMM 因此不是足夠的 provenance identity。
4. FP8 MMA甚至存在 fast accumulation 模式，以 accumulator precision 換 throughput，顯示 accumulation policy 本身就是 model semantic state。
5. vLLM Qwen3 current source把 final hidden state交給 LogitsProcessor(lm_head, hidden_states)，因此 end-of-model lineage可以明確延伸為 final residual → final norm/model output → LM-head/logits processor → raw logits，而不是直接從「Transformer」跳到 sampling。

## 本小時最重要 5 個發現

### 1. Kernel selection 是隱藏的模型執行超參數
已確認官方資訊：PyTorch scaled_dot_product_attention 可自動選擇多種 CUDA optimized backend，也允許 sdpa_kernel 強制 backend；官方並警告不同 fused implementations 因浮點融合方式不同可能產生不同 output。

底層：
LogicalAttentionOp → Input Shape/Dtype/Layout → Backend Eligibility → Backend Priority/Heuristic → Kernel Implementation → Tile/Reduction Policy → Output Tensor

重要性：Same model + same weights + same inputs 並不充分推出 same numerical state。

限制：backend-level witness 還不足以唯一標識最終 machine code。

### 2. Compiled artifact generation 必須成為 provenance node
工程推論：Triton/Inductor/CUTLASS 類 runtime會依 shape、dtype、architecture、compile flags與 tuning/config生成或選擇 kernel。應建立：

CompiledKernelGeneration = H(logicalOp, compilerGeneration, source/IR digest, targetArchitecture, specializationKey, launchConfig, mathMode, accumulationPolicy, binaryDigest)

並建立 KernelLaunchWitness 綁定 input/output TensorGeneration。

### 3. Numerical semantics 不等於 dtype 名稱
已確認官方資訊：CUTLASS支援跨多種 precision/architecture 的 GEMM specialization；NVIDIA cuTile MMA文件明示 FP8的 use_fast_acc 可犧牲 accumulator precision換 throughput。

所以 FP8/FP16/BF16/TF32 只描述部分 semantics；還要記 accumulator dtype、reduction order、fast-math/fast-acc、fused epilogue、rounding/downcast boundary。

NumericalPolicyGeneration = H(inputDtypes, accumulatorDtype, mathMode, reductionOrderPolicy, fusedEpilogue, downcastBoundary)

### 4. Kernel-level微小誤差可沿 autoregressive loop放大
論文結果：2025「Give Me FP32 or Give Me Death?」報告 GPU count/type/batch size與有限精度會讓 greedy inference產生明顯 output差異；2026 HEAL進一步把跨 GPU不一致追到 kernel boundary downcast/truncation並提出針對性補償；2026-09-22 cross-architecture work則把 hardware-dependent kernel selection與 reduction order直接連到跨 GPU token divergence。

因此新增 edge：KernelNumericalDelta --can_amplify_through→ AutoregressiveTokenDivergence。

### 5. Raw logits需要自己的 witness
vLLM current Qwen3 source：forward產生 hidden_states；compute_logits再呼叫 self.logits_processor(self.lm_head, hidden_states)。因此新增：

RawLogitsGeneration = H(finalHiddenStateGeneration, finalNormGeneration, lmHeadWeightGeneration, logitsProcessorGeneration, TPCollectiveGeneration, numericalPolicyGeneration)

RawLogitsWitness不等於 sampled token witness；sampling仍是下一層獨立 state transition。

## Architecture Breakdown
System architecture：Compiled-kernel inference execution plane

ModelInvocationWitness
→ Tensor/Storage/Graph binding
→ Logical Op DAG
→ Backend Dispatcher
→ Compiler/Kernel Cache
→ Specialization Key(shape,dtype,layout,device)
→ Kernel Binary
→ Launch Config
→ Numerical Policy
→ Output TensorGeneration
→ Final Norm
→ LM Head / LogitsProcessor
→ RawLogitsGeneration
→ Sampling plane

這個 architecture 與 Agent runtime 的關係：Agent上層看到的是 model response；但 response lineage若要可驗證，必須一路能回指這一次 model invocation實際使用的 kernel/backend/numerical generation。

## Bottom-Level Logic
深入 mechanism：attention/GEMM backend selection與 numerical divergence。

Attention：Q,K,V → eligibility checks → backend selection → tiled QK^T → scaling/mask → softmax/reduction → PV → output。

GEMM：A/B storage → layout/stride → tile mapping → tensor-core instruction dtype → partial accumulators → reduction → epilogue → downcast → output storage。

任何下列變化都可能保持 logical op不變但改變 output bits：tile size、warp count、backend、GPU SM architecture、accumulator precision、reduction order、fused epilogue、fast accumulation、compiler version。

## Visual Simulation Idea
「Compiled Kernel → Logits Numerical Microscope」

面板：Logical Op | Dispatcher | Kernel Candidates | Selected Backend | Compiler/Cache Key | GPU Architecture | Tile/Warp | Input dtype | Accumulator | Reduction | Output Error | Final Logits | Top-token Margin

互動：切換 Flash/math/cuDNN、BF16/FP16/TF32/FP8、fast accumulation、GPU architecture，顯示每層 delta如何累積，最後觀察 top-1/top-2 logit margin何時被翻轉。

故障注入：KERNEL_CACHE_KEY_COLLISION、WRONG_SM_BINARY、AUTOTUNE_WINNER_CHANGED、FAST_ACC_ENABLED、TF32_POLICY_CHANGED、FUSED_EPILOGUE_CHANGED、SDPA_BACKEND_CHANGED、LOGITS_KERNEL_WRONG_WEIGHT_GENERATION。

## Code / GitHub
vLLM值得繼續看的核心路徑：
- vllm/model_executor/models/qwen3.py：forward → compute_logits；LM head與LogitsProcessor邊界。
- vllm/model_executor/layers/logits_processor.py：TP gather/padding/scale等 logits semantics。
- vllm/attention/*：attention backend selection與kernel binding。
- vllm/model_executor/layers/quantization/*：quantized kernel selection。
- vllm/compilation/* 與 worker/model runner：compile/cache/CUDA graph與request binding。

Qwen3 current source確認 compute_logits = logits_processor(lm_head, hidden_states)。

## Papers
1. Give Me FP32 or Give Me Death? Challenges and Solutions for Reproducible Reasoning — Jiayi Yuan et al. — 2025 — arXiv:2506.09501. Architecture: LayerCast，16-bit weight storage + FP32 compute。Contribution：系統化量化 GPU/config/precision 對推理重現性的影響。Limitation：FP32 compute有性能成本，且不是所有 kernel/runtime provenance問題都由它解決。Code: https://github.com/nanomaoli/llm_reproducibility
2. Demystifying Numerical Instability in LLM Inference: Achieving Reproducible Inference for Mission-Critical Tasks with HEAL — Zhenting Zhu et al. — 2026 — arXiv:2606.21023. Architecture：INT16 QKV + algebraic error compensation on 16-bit Tensor Cores。Dataset/benchmark：MCR-Bench。Contribution：把不穩定性定位到 kernel-boundary truncation並降低高精度成本。Limitation：需跨更多模型/硬體驗證。
3. Accelerating the Mitigation of LLM Inference Nondeterminism Across GPU Architectures — Liam Cooper et al. — 2026-09-22 — arXiv:2609.25624. Architecture：fixed-configuration fused-upcast GEMM；以 problem shape決定固定 reduction order。Contribution：Ampere/Ada/Hopper linear-layer bitwise一致。Limitation：目前重點是 linear layers，完整模型仍包含 attention、normalization、collective與sampling等路徑。
4. The Silent Hyperparameter: Quantifying the Impact of Inference Backends on LLM Reproducibility — David Pape, Jonathan Evertz, Lea Schönherr — CISPA — 2026 — arXiv:2605.19537. Contribution：把 inference backend視為常被忽略的實驗變數。Limitations：backend級比較不能取代 per-kernel lineage。

## 已確認 / 推論 / 假說
已確認：PyTorch SDPA backend可切換且不同 fused backend可能產生不同 output；CUTLASS/CUDA primitives提供多種 precision與accumulation policy；vLLM Qwen3以 LogitsProcessor + lm_head計算 logits。
論文結果：有限精度、kernel/reduction與GPU差異能造成 autoregressive divergence。
工程推論：production provenance必須將 compiled binary/specialization/numerical policy納入 generation identity。
尚未驗證假說：對Hermes目標模型，可用「每層低成本摘要 + top-logit margin」而非完整tensor hash捕捉足夠的 kernel divergence signal。

## Unknown / Open Questions
1. 如何以低 overhead取得 Triton/Inductor/CUTLASS實際 binary/IR與autotune winner digest？
2. RawLogitsWitness應保存全 vocab digest、top-K digest，還是 margin-aware sketch才足以做production attestation？
3. CUDA/cuBLAS/cuDNN driver/library升級時，如何區分 semantic-compatible kernel generation與必須invalidate的 generation？

## 下一輪研究
RawLogitsGeneration → LogitsProcessor TP gather/padding/soft-cap/scale → temperature/top-k/top-p/min-p → RNG state/Philox → speculative decoding acceptance → CommittedTokenGeneration。

重點補齊「raw logits如何被轉成下一個 committed token」，並將 deterministic greedy、stochastic sampling與speculative decoding分成不同 provenance DAG。

## Knowledge Graph 新增 Node / Edge
Nodes：LogicalOpGeneration、BackendDispatchGeneration、KernelCandidateSetGeneration、CompiledKernelGeneration、KernelSpecializationGeneration、KernelCacheEntryGeneration、KernelBinaryIdentity、KernelLaunchGeneration、KernelLaunchWitness、NumericalPolicyGeneration、AccumulatorPolicyGeneration、ReductionOrderGeneration、KernelOutputTensorGeneration、FinalNormGeneration、LMHeadGeneration、LogitsProcessorGeneration、RawLogitsGeneration、RawLogitsWitness、TopLogitMarginGeneration。

Edges：LogicalOp --dispatched_by→ BackendDispatch；BackendDispatch --selects→ CompiledKernel；CompiledKernel --specialized_for→ Shape/Dtype/Architecture；KernelLaunch --consumes→ TensorGeneration；KernelLaunch --governed_by→ NumericalPolicy；KernelLaunch --produces→ KernelOutputTensor；KernelNumericalDelta --can_amplify_through→ AutoregressiveTokenDivergence；FinalHiddenState --normalized_by→ FinalNorm；FinalNorm --projected_by→ LMHead；LMHeadOutput --processed_by→ LogitsProcessor；LogitsProcessor --produces→ RawLogitsGeneration。

## 本輪結束判斷
缺哪一層：Raw logits → sampling / RNG / speculative acceptance → committed token。
哪個節點最淺：CompiledKernelGeneration 的 portable binary/IR identity。
哪個概念仍只是名詞：production-grade KernelLaunchWitness。
哪個系統值得讀原始碼：vLLM LogitsProcessor + sampling + Triton/Inductor kernel cache/dispatcher。
哪篇論文需追引用：arXiv:2609.25624，並回追 arXiv:2506.09501與 HEAL。
哪個概念最適合視覺模擬：Compiled Kernel → Logits Numerical Microscope。
哪個 Agent 架構最值得實作：Event-sourced Agent Runtime + ModelInvocationWitness + CompiledKernelGeneration + RawLogitsWitness + TokenCommitWitness。

端到端鏈更新：User → UI → Agent → Context → Prompt Compiler → Token/Embedding → Weights → Transformer/MoE → Distributed Collective → CUDA Stream/Event → Storage/Graph → Compiled Kernel/Numerical Policy → Final Hidden/Norm → LM Head → Raw Logits → [Sampling/Speculation gap] → Token → Decode/Stream → Observation → Tool/Effect → Context Re-entry。
