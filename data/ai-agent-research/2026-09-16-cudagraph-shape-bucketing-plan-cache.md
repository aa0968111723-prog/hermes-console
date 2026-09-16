# 【AI Agent × Multimodal Research Report】

**時間：2026-09-16 14:50（Asia/Taipei）**  
**主題：CUDA Graph × Request Shape Bucketing × MoE Oracle × ExecutionPlanCache Invalidation**

## 與歷史研究比較
上一輪已建立 Request → Compatibility Oracle → Candidate Physical Plans → Cost Model → Benchmark Guard → ExecutionPlanCache。本輪不重複 MoE kernel/TCGen05，而是追查 planner 真正落地時最容易被忽略的限制：**CUDA Graph replay 需要可辨識的 execution signature；request 的動態 shape 不能任意切 kernel 而仍期待 graph replay。**

## 本小時新發現
1. vLLM `CudagraphDispatcher` 本身就是 request-shape bucketing runtime：預先建立 `batch size → padded graph size`，再用 `BatchDescriptor(num_tokens,num_reqs,uniform,has_lora,num_active_loras)` 作為 graph key。
2. FULL 與 PIECEWISE graph 的 key semantics 不同：PIECEWISE 可放寬 `num_reqs=None, uniform=False`；FULL 需要更精確 descriptor，且 FA3 scheduler metadata 依賴 exact `num_reqs`。
3. 超過 `max_cudagraph_capture_size`、沒有 matching key、feature 禁止某 mode、或 graph 尚未初始化時，runtime 必須 fallback 到 NONE/eager，而不是錯誤 replay。
4. vLLM MXFP4/NVFP4 oracle 明確註記 primary backend 選定後仍可能發生 shape-specific runtime fallback；所以 `ExecutionPlanCache` key 不能只有 model+GPU+quantization。
5. CUDA Graph 與 backend oracle 必須共同建模：backend 改變、activation format、LoRA specialization、capture size、uniform decode、feature compatibility 都可能改變 graph identity 或使舊 graph 不再合法。

## 本小時最重要 5 個發現

### 1. CUDA Graph Dispatcher 是 Physical Execution Planner 的第二層 oracle
**已確認：vLLM GitHub 原始碼。**

```text
Request
→ num_tokens / uniform_decode / LoRA state
→ pad to captured graph size
→ BatchDescriptor
→ FULL key lookup
→ PIECEWISE relaxed key lookup
→ NONE fallback
```

這表示 planner 不只選 backend；還要選 **execution container**：eager、piecewise graph、full graph。

### 2. Shape Bucketing 的本質是用 padding 換 graph reuse
`_compute_bs_to_padded_graph_size()` 將未捕獲的 batch size 映射到鄰近 capture size。這降低 graph variants，但增加 padded work。因此 cost model 應加入：

```text
GraphReuseBenefit - PaddingComputeCost - GraphMemoryCost
```

而不是永遠選最近 graph。

### 3. Graph key 必須包含「語意會改變 execution graph 的狀態」
目前 vLLM key 已包含 token 數、request 數、uniform decode、LoRA presence/count。Hermes 應泛化為：

```text
ExecutionSignature = hash(
 model_revision,
 quantization,
 backend_family,
 dispatcher_backend,
 attention_backend,
 phase,
 padded_shape_bucket,
 speculative_width,
 lora_signature,
 multimodal_shape_signature,
 feature_flags,
 hardware_arch,
 runtime_version
)
```

其中部分欄位是 Hermes 的工程推論，需後續逐 framework 驗證。

### 4. Cache invalidation 是 correctness 問題，不只是效能問題
**官方/工程事實 + 合理推論。** NVIDIA TensorRT CUDA Graph 文件指出 graph 與 capture 時的 input size / execution-context state 綁定；vLLM 也只允許 dispatcher 中已初始化的 valid keys replay。因此若 backend、shape semantics、LoRA specialization 或 runtime binary 改變，錯誤沿用舊 plan/graph 可能不只是變慢，而是非法或語意錯誤。

建議 invalidation taxonomy：

```text
Hard invalidate:
 model revision / kernel ABI / runtime version / GPU arch / quant format

Compatibility invalidate:
 backend capability / feature flag / activation format / EP layout

Shape invalidate:
 graph bucket / speculative width / multimodal token geometry

Soft revalidate:
 telemetry drift / workload histogram / latency prediction error
```

### 5. Static graph 不代表 runtime 必須完全靜態
KV-RM (2026) 顯示可把不規則 KV movement 壓到固定-shape decoder interface 以下：logical KV history → block pager → committed descriptor → coalesced transfer → static kernel。這和 vLLM graph bucketing形成互補：**上層固定 execution envelope，下層仍可維持動態 state virtualization。**

## Architecture Breakdown

```text
Incoming Request
↓
RequestFeatureExtractor
├ phase
├ num_tokens
├ num_reqs
├ speculative width
├ LoRA
├ multimodal geometry
└ expert histogram
↓
Compatibility Oracle
↓
Backend Candidate
↓
Graph Eligibility
├ FULL
├ PIECEWISE
└ NONE
↓
Shape Bucket / Padding
↓
ExecutionSignature
↓
Plan Cache Lookup
├ HIT → validate generation/version
└ MISS → cost model / benchmark
↓
PhysicalExecutionPlan
↓
Graph Replay or Eager Launch
↓
Telemetry
↓
Soft Revalidation / Hard Invalidation
```

## Bottom-Level Logic

vLLM 的 dispatcher 會先用 capture sizes 建立 O(1) batch-size→padded-size mapping。runtime request 被轉成 BatchDescriptor。FULL graph 先做 exact-key lookup；PIECEWISE 則可將 request-count/uniform 屬性放寬後 lookup；找不到或 token 數超過 max capture size就回到 NONE。

這個機制揭示一個重要邊：

```text
Dynamic Request Shape
→ Shape Bucket
→ Padding
→ Static Graph Identity
→ Replay Eligibility
```

而 MoE oracle 的 shape-specific fallback 又加入：

```text
Graph Identity
↔ Backend Identity
↔ Runtime Shape
```

三者不能分開快取。

## Visual Simulation Idea
### Execution Signature × CUDA Graph Bucket Simulator
畫面四層：Request Stream、Shape Buckets、Graph Cache、GPU Timeline。拖曳 request 的 token 數、LoRA 數、speculative width、multimodal token 數與 MoE backend，即時顯示：padding tokens、graph hit/miss、FULL/PIECEWISE/NONE、cache key、capture memory、launch overhead、predicted latency。

特別動畫：`127 tokens → bucket 128 → FULL replay`；feature flag 改變後舊 key變紅並 invalidated；`129 → bucket 256` 時顯示 padding cost，讓使用者直觀看到「graph reuse vs wasted compute」。

## Code / GitHub
### vLLM
值得繼續讀：
- `vllm/v1/cudagraph_dispatcher.py`：graph key 初始化、padding、FULL/PIECEWISE/NONE dispatch。
- `docs/design/cuda_graphs.md`：CUDA Graph mode 設計。
- `vllm/model_executor/layers/fused_moe/oracle/mxfp4.py`：MXFP4 primary backend + shape-specific fallback。
- `vllm/model_executor/layers/fused_moe/oracle/nvfp4.py`：NVFP4 compatibility-first backend selection。

## Papers
### KV-RM: Regularizing KV-Cache Movement for Static-Graph LLM Serving
- Authors: Zhiqing Zhong, Zhijing Ye, Jian Zhang, Weijian Zheng, Bolun Sun, Xiaodong Yu
- Year: 2026
- Architecture: logical KV histories → block pager → committed descriptor → merge-staged transport → fixed-shape attention kernel
- Contribution: 將動態 KV movement regularize 到 static decoder interface 以下。
- Limitation: 論文結果基於其 2×A100 prototype/workloads；不能直接外推所有 serving stack。
- 改變了什麼：證明 static graph 與 dynamic KV virtualization 並不矛盾。

## Unknown / Open Questions
1. vLLM MoE 的 shape-specific fallback 是否會在 CUDA Graph capture/replay 路徑造成 backend identity 分叉？需要追 concrete kernel class 的 runtime fallback call path。
2. multimodal encoder token geometry 應如何進入 graph signature：只看總 token 數是否足夠，還是 image grid / video frames / modality type 也會改 kernel graph？
3. ExecutionPlanCache 最佳 invalidation 粒度應是 whole-plan、operator-level 還是 graph-segment-level？

## 下一輪研究
**Multimodal Dynamic Shapes × Encoder Cache × CUDA Graph × Image/Video Token Geometry × Attention Backend Eligibility**。

目標把：
```text
Camera/Image/Video
→ resize/patchify
→ vision encoder
→ visual token count/geometry
→ projector/fusion
→ LLM batch descriptor
→ CUDA Graph eligibility
→ physical kernel plan
```
完整接到目前的 Request-Aware Physical Execution Planner。

## Knowledge Graph 新增 Node / Edge
Nodes: `CUDAGraphDispatcher`, `CUDAGraphMode`, `FullCUDAGraph`, `PiecewiseCUDAGraph`, `BatchDescriptor`, `GraphCaptureSize`, `ShapeBucket`, `PaddingComputeCost`, `GraphReplayEligibility`, `ExecutionSignature`, `HardPlanInvalidation`, `CompatibilityInvalidation`, `ShapeInvalidation`, `SoftPlanRevalidation`, `GraphFallback`, `StaticExecutionEnvelope`, `DynamicStateVirtualization`.

Edges:
- `RequestShape → ShapeBucket`
- `ShapeBucket → BatchDescriptor`
- `BatchDescriptor → GraphReplayEligibility`
- `GraphReplayEligibility → PhysicalExecutionPlan`
- `BackendIdentity ↔ GraphIdentity`
- `RuntimeShape ↔ GraphIdentity`
- `LoRASignature → ExecutionSignature`
- `VersionChange → HardPlanInvalidation`
- `TelemetryDrift → SoftPlanRevalidation`
- `DynamicKVState → StaticExecutionEnvelope`

## 本輪結束判斷
- **缺哪一層：** Multimodal encoder 的 dynamic geometry 如何穿過 compile/CUDA-graph boundary。
- **哪個節點最淺：** multimodal shape signature、operator-level invalidation、MoE runtime fallback 與 graph replay 的交互作用。
- **哪個概念仍只是名詞：** `UnifiedExecutionSignature`，尚未跨 vLLM/FlashInfer/TensorRT-LLM 驗證。
- **哪個系統值得讀原始碼：** vLLM multimodal encoder cache + CUDA graph dispatcher + FusedMoE runtime fallback。
- **哪篇論文需追引用：** KV-RM，特別是 static-graph serving、paged KV、descriptor-based execution 的後續工作。
- **哪個概念最適合視覺模擬：** Execution Signature × CUDA Graph Bucket Simulator。
- **哪個 Agent 架構最值得實作：** 對 Hermes 而言仍是 `Request-Aware Physical Execution Planner`，但下一步必須讓它理解 multimodal request geometry，而不只 text/MoE shape。
