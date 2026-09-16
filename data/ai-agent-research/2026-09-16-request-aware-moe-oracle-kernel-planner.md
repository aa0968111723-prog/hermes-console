# 【AI Agent × Multimodal Research Report】

**時間：2026-09-16 13:54（Asia/Taipei）**  
**主題：Request-Aware MoE Oracle × Backend Compatibility × Runtime Autotuning × Physical Execution Plan**

## 與歷史研究比較

上一輪已建立 `KernelFeasibilityFilter → AnalyticalKernelCostModel → BenchmarkGuard → ExecutionPlanCache`，並下鑽 Blackwell TCGen05/TMEM epilogue。本輪避免重複 kernel 內部細節，往上一層追：**一個實際 request 的 phase、量化格式、Expert Parallel 配置與硬體能力，如何被 runtime 轉譯成可執行 backend/kernel。**

## 本小時新發現

1. vLLM 的 MoE backend selection 已出現真正的 **Oracle layer**：`fused_moe/oracle/` 依 quantization family 拆成 FP8、MXFP4、NVFP4、unquantized 等 selector，而不是單一 `if GPU == ...`。
2. FP8 oracle 的 priority 會被 runtime config 改寫：Blackwell SM100 + DeepEP v2 contiguous layout + dynamic/static 128-block FP8 時，FlashInfer TRTLLM 被提前，原因是 tile-level skipping 可避免 padded rows 的無效計算；Hopper SM90 block-FP8 則依 EP size，在 EP 時偏 FlashInfer CUTLASS、非 EP 時偏 Triton。
3. Backend selection 必須先做 **semantic/feature compatibility filtering**：例如 SwiGLU clamp、量化 block shape、EP/TP layout、async prepare/finalize 等功能若 backend 不支援，不能只因 benchmark 快就選它。
4. vLLM 已把 MoE execution 拆成 prepare/finalize 與 expert kernel families；DeepEP high-throughput/low-latency、FlashInfer 等 communication path 可和 DeepGEMM/Triton/CUTLASS/Marlin expert kernels組合，顯示真正 planner 的 decision space 是 `communication backend × expert backend`，不是單一 backend 名稱。
5. 2026 Ada-MK 與 GPU Forecasters 提供兩個互補方向：固定 deployment configuration 可把最佳 DAG execution path離線固化；對巨大候選空間則可用 surrogate 預測縮小昂貴 GPU measurement 次數。這支持 Hermes 採 **compatibility → analytical prediction → selective measurement → cache** 的分層 planner。

## 本小時最重要 5 個發現

### 1. vLLM 已有 MoE Backend Oracle，而不是純靜態 backend switch

**已確認／官方文件 + GitHub 原始碼。**

vLLM `vllm/model_executor/layers/fused_moe/oracle/fp8.py` 定義 `Fp8MoeBackend`，包含 FlashInfer TRTLLM/CUTLASS、DeepGEMM、Triton、Marlin、Humming、CUTLASS、HPC、XPU/CPU 等。`_get_priority_backends()` 再依 platform/config 重排候選。

```text
Model Quantization
+ GPU Architecture
+ EP/TP Config
+ Activation/Weight QuantKey
+ Dispatcher Layout
→ Priority Backend List
→ is_supported_config
→ Concrete Experts Kernel Class
```

**重要性：** `auto` 不是一個 kernel；它是一個 policy layer。

**限制：** 現有 priority 很多仍是人工工程 heuristics，不等於 per-request performance-optimal。

來源：
- https://github.com/vllm-project/vllm/blob/main/vllm/model_executor/layers/fused_moe/oracle/fp8.py
- https://docs.vllm.ai/en/latest/api/vllm/config/

### 2. Backend 選擇會受「padding 是否能跳過」這種 layout-level 細節影響

**已確認／原始碼。**

FP8 oracle 對 SM100 + DeepEP v2 contiguous layout 特別優先 FlashInfer TRTLLM，原始碼註解指出 worst-case padded allocation 下，TRTLLM tile-level skipping 可避免 padding rows 的 wasted compute。

```text
DeepEP Layout
→ padded activation rows
→ backend tile semantics
→ skip / compute padded rows
→ effective FLOPs
→ latency
→ backend priority
```

這證明 planner input 不能只含 `M,N,K,dtype,GPU`，還需要 **layout semantics**。

### 3. Physical Execution Plan 是笛卡兒積後再過濾，不是單一選項

**官方資訊 + 工程實作。** vLLM modular MoE 把 prepare/finalize communication 與 experts compute 解耦。DeepEP high-throughput 可搭 DeepGEMM、Triton、CUTLASS、Marlin 等 experts；low-latency path又有 batched variants。

因此候選空間更接近：

```text
Plan =
  DispatcherBackend
× ExpertsBackend
× QuantizationPath
× Layout
× AsyncMode
× Parallelism
× GPUArchitecture
```

再經：

```text
Feature Compatibility
→ Memory Feasibility
→ Performance Prediction
→ Measurement Guard
```

來源：https://docs.vllm.ai/en/latest/design/moe_kernel_features/

### 4. Request-aware planner 必須區分「deployment-stable」與「request-dynamic」參數

**合理推論，受論文與 runtime 設計支持。**

可在模型載入時固定：

```text
GPU architecture
quantization format
expert weights
EP topology
supported kernels
```

每個 request/batch 才改變：

```text
prefill/decode
active tokens
batch size
expert histogram
router skew
sequence state
SLO / queue pressure
```

因此：

```text
Static Compile Plan
+ Dynamic Request State
→ Small Runtime Decision
```

Ada-MK 的核心觀察是固定 deployment config 下 optimal mega-kernel path 可離線搜尋並固化，避免 latency-critical runtime branching。這與 vLLM Oracle 的 compatibility filtering互補。

論文：Ada-MK: Adaptive MegaKernel Optimization via Automated DAG-based Search for LLM Inference, Wenxin Dong et al., 2026, arXiv:2605.11581. Architecture: MLIR DAG offline search + MegaKernel plugin + hybrid prefill/decode engine. Contribution: 將可固定的 dynamic decisions移到 compile-time。限制：L20/商業廣告 workload，不能直接外推所有 LLM/MoE。

### 5. Autotuning 最合理的角色是「選擇性校正」，不是每次 request 都 benchmark

**論文結果 + 系統推論。**

GPU Forecasters 研究 LLM surrogate 預測 kernel relative performance，重點是 calibrated/selective：不確定時才 defer 到真 GPU measurement。對 Hermes 更實際的版本不必由 LLM直接決定 kernel，而可採：

```text
Compatibility Oracle
→ Analytical Cost Model
→ Confidence
├ high → use predicted best
└ low  → benchmark Top-K candidates
→ update measured profile
→ ExecutionPlanCache
```

論文：GPU Forecasters: Language Models as Selective Surrogates for Kernel Runtime Optimization, Zaid Khan et al., 2026, arXiv:2605.31464. Contribution: selective surrogate 減少 GPU evaluation budget。限制：kernel-search setting，不等同 production serving backend selector。

## Architecture Breakdown

### Hermes Request-Aware Physical Execution Planner

```text
Incoming Request / Batch
↓
RequestFeatureExtractor
├ phase: prefill / decode
├ active_tokens
├ batch_size
├ sequence_lengths
├ expert_histogram
├ router_skew
└ SLO
↓
ModelExecutionProfile
├ attention type
├ MoE config
├ quantization
├ hidden/intermediate dims
├ top-k
└ expert placement
↓
HardwareProfile
├ GPU arch
├ SM count
├ HBM BW/capacity
├ SMEM/TMEM
├ NVLink/RDMA topology
└ supported instructions
↓
Compatibility Oracle
↓
Candidate Physical Plans
↓
Analytical Cost Model
↓
Confidence / Prediction Error Model
├ confident → choose
└ uncertain → Top-K microbenchmark
↓
ExecutionPlanCache
↓
Dispatcher + Expert Kernel + Tile/Schedule
↓
Measured Trace
↓
Planner Feedback
```

## Bottom-Level Logic

以 FP8 MoE 為例：

```text
Request
→ phase/batch/expert histogram
→ quant key = FP8 block 128
→ GPU capability = SM90 or SM100
→ EP size / DeepEP layout
→ oracle priority rewrite
→ enumerate backend kernel classes
→ is_supported_config
→ reject incompatible clamp/layout/block-size paths
→ estimate padding + GEMM + dispatch/combine cost
→ choose candidate
→ execute
→ collect latency / bytes / utilization
→ cache by execution signature
```

建議 execution signature：

```text
hash(
 model_id,
 quant_scheme,
 gpu_arch,
 ep_size,
 dispatcher,
 phase,
 token_bucket,
 expert_histogram_bucket,
 layout,
 kernel_version
)
```

## Visual Simulation Idea

### Request → Kernel Decision Tree Simulator

左側：request tokens / prefill-decode / expert histogram。  
中央：Oracle decision graph，每個 backend candidate 顯示 `compatible / rejected / predicted cost / confidence`。  
右側：實際 physical plan：Dispatcher → Layout → Expert Kernel → GPU timeline。

互動參數：GPU(H100/B200)、FP8/FP4、EP size、tokens、router skew、DeepEP layout、SLO、autotune on/off。

動畫示例：

```text
同一模型
H100 + EP=1
→ Triton candidate priority ↑

H100 + EP>1
→ FlashInfer CUTLASS priority ↑

B200 + DeepEP-v2 padded FP8
→ TRTLLM tile-skip value ↑
→ backend choice changes
```

## Code / GitHub

值得繼續追：

- `vllm/model_executor/layers/fused_moe/oracle/fp8.py` — FP8 backend priority/selection。
- `vllm/model_executor/layers/fused_moe/oracle/mxfp4.py` — SM100+ FP4/MXFP4 backend priority。
- `vllm/model_executor/layers/fused_moe/oracle/nvfp4.py` — NVFP4 selection。
- `vllm/model_executor/layers/fused_moe/config.py` — semantic feature constraints。
- `vllm/model_executor/layers/fused_moe/experts/` — concrete expert kernels。
- `vllm/model_executor/layers/fused_moe/prepare_finalize/` — dispatch/combine modular paths。
- DeepGEMM heuristics / MegaMoE — tile feasibility 與 SM100 physical schedule。

## Papers

1. **Ada-MK: Adaptive MegaKernel Optimization via Automated DAG-based Search for LLM Inference** — Wenxin Dong et al.; 2026; arXiv:2605.11581. Code:未在本輪確認。Dataset/workload: commercial online advertising inference workload。Architecture: MLIR DAG offline search + MegaKernel + TensorRT-LLM hybrid engine。Limitation: hardware/workload specific。
2. **GPU Forecasters: Language Models as Selective Surrogates for Kernel Runtime Optimization** — Zaid Khan, Justin Chih-Yao Chen, Jaemin Cho, Elias Stengel-Eskin, Mohit Bansal; 2026; arXiv:2605.31464. Architecture: selective/calibrated surrogate for GPU kernel evaluation。Limitation: kernel optimization search，非直接 production serving oracle。
3. **SpecGen: Accelerating Agentic Kernel Optimization with Speculative Generation** — Jihu Guo et al.; 2026; arXiv:2606.17518. Architecture: reasoning generation + speculative kernel candidates + parallel validation/profiling pools。Limitation: agentic kernel-generation workflow，與 online inference selection不同。

## Unknown / Open Questions

1. vLLM `auto` priority 在多少情況只是 architecture-level heuristic，而不是 shape/request-level benchmark optimum？
2. Expert histogram 是否能在 router 完成後、expert dispatch 前，以足夠低 overhead 改變 expert backend，而不破壞 CUDA Graph / compiled execution？
3. Planner cache key 如何避免過度細分，又能捕捉 router skew、padding、SLO 對最佳 backend 的 crossover？

## 下一輪研究

**vLLM Oracle 全路徑 × MXFP4/NVFP4 backend selection × CUDA Graph constraints × request-shape bucketing × online telemetry × ExecutionPlanCache invalidation。**

重點回答：`auto` backend 到底何時選錯、如何量測 crossover、如何讓 planner 學會更新而不讓 autotuning 本身拖慢 serving。

## Knowledge Graph 新增 Node / Edge

### Nodes

- `RequestFeatureExtractor`
- `ModelExecutionProfile`
- `HardwareProfile`
- `MoEBackendOracle`
- `BackendPriorityRewrite`
- `SemanticCompatibilityFilter`
- `LayoutCompatibility`
- `DispatcherBackend`
- `ExpertsBackend`
- `PhysicalExecutionPlan`
- `ExecutionSignature`
- `RequestShapeBucket`
- `PlannerConfidence`
- `SelectiveBenchmarkGuard`
- `ExecutionPlanCache`
- `MeasuredExecutionTrace`
- `PlannerFeedbackLoop`

### Edges

```text
Request → RequestFeatureExtractor
Model → ModelExecutionProfile
GPU → HardwareProfile
RequestFeatureExtractor → MoEBackendOracle
ModelExecutionProfile → MoEBackendOracle
HardwareProfile → MoEBackendOracle
MoEBackendOracle → CandidatePhysicalPlan
CandidatePhysicalPlan → SemanticCompatibilityFilter
SemanticCompatibilityFilter → AnalyticalKernelCostModel
AnalyticalKernelCostModel → PlannerConfidence
PlannerConfidence → SelectiveBenchmarkGuard
SelectiveBenchmarkGuard → ExecutionPlanCache
ExecutionPlanCache → PhysicalExecutionPlan
PhysicalExecutionPlan → MeasuredExecutionTrace
MeasuredExecutionTrace → PlannerFeedbackLoop
PlannerFeedbackLoop → AnalyticalKernelCostModel
```

## 本輪結束檢查

- **缺哪一層：** CUDA Graph / compile cache 對 request-dynamic backend switching 的限制。
- **哪個節點最淺：** `RequestShapeBucket`、`PlannerConfidence`、`ExecutionPlanCache invalidation`。
- **哪個概念仍只是名詞：** Hermes 的跨 Attention/MoE/Linear 統一 `PhysicalExecutionPlanner`。
- **哪個系統值得讀原始碼：** vLLM `fused_moe/oracle/*` 與 modular kernel prepare/finalize 全路徑。
- **哪篇論文需追引用：** Ada-MK，因它直接處理 compile-time DAG decision 與 runtime latency tradeoff。
- **哪個概念最適合視覺模擬：** Request → Oracle → Candidate rejection → Cost prediction → Kernel 的決策樹。
- **哪個 Agent 架構最值得實作：** `Planner + Verifier/Profiler` 雙層 Agent；Planner 提 execution plan，Verifier 只在低信心/新 shape 時實測，避免讓 LLM 位於每 token critical path。

## 還原「AI 到底怎麼運作」的新一段

```text
User
→ UI
→ Agent Runtime
→ Context / Memory / Tools
→ Model Request
→ Scheduler
→ Transformer
→ MoE Router
→ Expert Histogram
→ Request-Aware Physical Execution Planner
→ Compatibility Oracle
→ Dispatcher Backend + Expert Backend
→ GPU Kernel / Fabric
→ Measured Trace
→ Planner Feedback
→ Output Token
→ Agent
→ Action
```

本輪最重要的系統觀念是：**AI inference runtime 不應只知道「模型要執行哪個 operator」，還必須知道「這個 request 在這台硬體、這個量化、這個 parallel layout、這個 token/expert distribution 下，哪個 physical implementation 最合理」。模型 graph 與 GPU kernel 之間需要一層可驗證、可學習、可回饋的 Physical Execution Planner。**