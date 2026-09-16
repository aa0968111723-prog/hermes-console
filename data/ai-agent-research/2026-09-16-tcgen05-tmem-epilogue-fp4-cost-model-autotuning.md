# 【AI Agent × Multimodal Research Report】

**時間：2026-09-16 12:52（Asia/Taipei）**  
**主題：TCGen05/TMEM Epilogue × Block Scaling × MoE Kernel Cost Model × Backend Autotuning**

## 與歷史研究比較

上一輪已追到 MonoMoE persistent pipeline、Blackwell TCGen05/TMEM、DeepGEMM MegaMoE 與 DynamicMoEBackendSelector。本輪避免重複 routing/dispatch，往「MMA 結果如何離開 TMEM」以及「runtime 如何選 kernel」兩層下鑽。

## 本小時新發現

1. Blackwell epilogue 是獨立的 memory/computation pipeline：TCGen05 accumulator 留在 TMEM，epilogue 以 subtile 將 TMEM → registers，做 activation/scale/cast，再寫 SMEM，最後由 TMA 寫回 GMEM。
2. DeepGEMM 原始碼確認 dynamic FP8 output 並非簡單 cast：先將 accumulator round 到 BF16，對每 row × 32 columns 做 amax，計算 UE8M0 scale，再 FP8 cast；scale factor 以 TMA-aligned packed layout 寫出。
3. TMEM lifetime 可早於整個 epilogue store 結束：DeepGEMM 在所有需要的 TMEM values 已進 registers 後立刻通知 `tmem_empty_barrier`，而 cast/SMEM/TMA store 可以繼續。這使 TMEM reuse 與 epilogue overlap 成為可建模資源。
4. Blackwell block-scaled MMA 把 scale factor layout 變成硬體 execution contract。TCGen05 block-scale MMA 直接消耗 scale factors；MXFP/NVFP 類格式不是「4-bit weight + 一個 scale」這麼簡單，而是 data tiles + scale tiles + layout/swizzle + MMA descriptor 的共同協定。
5. DeepGEMM 的 SM100 heuristic 已是 backend selection 的雛形：候選 layout 受 shape、dtype、major layout、SM count、cluster、swizzle、SMEM、TMEM scale-factor columns、output scale granularity限制，再由 runtime/JIT 選擇。這表示 kernel selection 可以從靜態 if/else 升級成可解釋 cost model + benchmark guard。

## 本小時最重要 5 個發現

### 1. TCGen05 → TMEM → Epilogue 是一條完整資料流

**已確認／官方 + 原始碼。**

```text
A/B tiles + scale factors
→ TMA / SMEM
→ TCGen05 MMA
→ TMEM accumulator
→ TMEM load subtile
→ Registers
→ Epilogue transform
→ SMEM swizzled store
→ TMA store
→ HBM/GMEM D
```

CUTLASS SM100 文件描述 accumulator 在 TMEM，epilogue 逐 subtile載入 registers、做 fusion，再 SMEM→TMA→GMEM。DeepGEMM `sm100_store_cd.cuh` 實際以 SM100 TMEM load instruction 讀 accumulator，之後 pipeline TMA store。

**重要性：** 模型 layer latency 不能只算 MMA FLOPs；epilogue 可能被 TMEM load、register work、SMEM footprint 或 DRAM store 限制。

**限制：** 不同 CUTLASS/DeepGEMM/cuDNN kernel 的 subtile 與 warp mapping不同。

### 2. Dynamic low-precision output 本身是一個 reduction pipeline

**已確認／工程實作。** DeepGEMM dynamic FP8 epilogue：

```text
TMEM FP32 accumulator
→ registers
→ round BF16
→ group amax (32 columns)
→ UE8M0 scale exponent
→ inverse scale
→ FP8 E4M3 cast
→ SMEM
→ TMA D store
+ packed scale-factor store
```

這說明 quantization metadata 也會消耗 bandwidth、instructions 與 layout constraints。Blackwell NVFP4/MXFP4 同理需把 block scale 視為 operand graph，而非附註 metadata。

### 3. TMEM 是需要管理 lifetime 的資源，不只是「更大的 register」

**已確認／原始碼。** DeepGEMM 會在 overlapped TMEM columns 已被讀出後通知 MMA warp；所有 accumulator load 進 registers 後再發 `tmem_empty_barrier`。因此可形成：

```text
TCGen05 writes TMEM region A
→ Epilogue loads A to registers
→ TMEM A becomes reusable
→ cast/store of old A continues
||
→ next MMA may occupy released TMEM
```

**推論：** TMEM pressure 應加入 occupancy/cost model；不能只用 SMEM + registers 判斷 kernel feasibility。

### 4. FP4/FP8 scale-factor layout 是 hardware-visible state

**官方資訊。** TCGen05 block-scaled MMA 支援 MXFP8/MXFP6/MXFP4/NVFP4 類格式，scale factor layout 與 vector size由 instruction contract約束。CUTLASS 也把 TMEM/SMEM scale-factor storage 納入 kernel building blocks。

因此 Knowledge Graph 應加入：

```text
QuantizationFormat
→ ScaleGranularity
→ ScaleTensorLayout
→ TMEM/SMEM Footprint
→ MMA Descriptor
→ Tile Feasibility
→ Kernel Choice
```

### 5. Backend selector 應是「可行性過濾 → 分析成本 → 小型實測」

DeepGEMM `heuristics/sm100.hpp` 已依 block M/N/K、cluster、swizzle、SM count、TMEM 512-column budget、output SF granularity等排除不合法 layout。tritonBLAS 則顯示 analytical GEMM model 能用 architecture/cache/topology + shape/blocking 逼近 autotuning；MonoMoE則採 generated specializations + offline schedule tuning。

Hermes 可採三階段：

```text
1 Feasibility Filter
  architecture / dtype / shape / memory / alignment
↓
2 Analytical Cost Model
  bytes + FLOPs + sync + padding + communication
↓
3 Benchmark Guard
  對 top-N candidates 做短 microbenchmark
↓
ExecutionPlan cache
```

## Architecture Breakdown

```text
Agent / Request
→ Model Execution Plan
→ MoE Router
→ tokens_per_expert histogram
→ MoE Backend Selector
   ├ Grouped GEMM
   ├ Masked Grouped GEMM
   ├ MonoMoE persistent
   └ SM100 MegaMoE
→ Kernel Layout Selector
→ TMA A/B/SF
→ TCGen05 block-scaled MMA
→ TMEM accumulator
→ Epilogue Scheduler
→ TMEM load
→ register transform / amax / activation / cast
→ SMEM
→ TMA store
→ HBM
→ Combine
```

## Bottom-Level Logic

初版成本模型：

```text
T_total ≈ max(T_mainloop, T_epilogue_overlap)
        + T_unhidden_sync
        + T_launch
        + T_dispatch/combine
```

其中：

```text
T_mainloop ≈ max(
  FLOPs / effective_tensorcore_FLOPS,
  bytes_A_B_SF / effective_HBM_or_L2_BW,
  T_TMA_pipeline
)

T_epilogue ≈ max(
  bytes_TMEM_load / BW_TMEM,
  ops_activation_scale_cast / ALU_rate,
  bytes_SMEM / BW_SMEM,
  bytes_D_and_SF / effective_store_BW
)

T_tail ≈ f(tokens_per_expert, tile_M, num_SMS, expert_skew)
```

對 FP4/FP8 必須額外加入：`scale-factor bytes + amax/reduction + scale layout padding + quant/dequant instructions`。

## Visual Simulation Idea

### Blackwell MMA → TMEM → Epilogue Microscope

四層同步動畫：

```text
MMA Timeline:      TCGen05 tile0 ─ tile1 ─ tile2
TMEM Lifetime:     [ACC0][read/free][ACC1]...
Epilogue Warps:         load→amax→cast→SMEM
TMA Store:                         D0→HBM
```

控制項：M/N/K、BF16/FP8/FP4、CTA1/CTA2、epilogue tile、TMA stages、TMEM columns、SMEM budget、expert M histogram。輸出：Tensor Core utilization、TMEM occupancy、SMEM occupancy、epilogue fraction、bytes/FLOP、padding、predicted latency、實測 latency與 model error。

## Code / GitHub

### deepseek-ai/DeepGEMM
值得持續讀：
- `deep_gemm/include/deep_gemm/epilogue/sm100_store_cd.cuh` — TMEM load、dynamic FP8 scale/cast、SMEM/TMA store。
- `deep_gemm/include/deep_gemm/epilogue/transform.cuh` — epilogue operator與 per-row/per-32-column scale contract。
- `csrc/jit_kernels/heuristics/sm100.hpp` — SM100 layout候選、TMEM/SMEM feasibility、cluster/swizzle與 TMA stage heuristics。
- `csrc/jit_kernels/heuristics/mega_moe.hpp` — 下一步把一般 GEMM cost model接到 MegaMoE。

### NVIDIA CUTLASS / cuDNN
- SM100 epilogue utilities：TMEM→register→fusion→SMEM→TMA。
- TCGen05 block-scaled MMA primitives：MXFP/NVFP scale-factor operand contract。
- SM100 grouped GEMM + SwiGLU/GLU/Quant：顯示 MoE epilogue fusion 正逐步成為標準 kernel primitive。

## Papers

### MonoMoE: An Efficient Fused Mega-kernel for Quantized MoE Decoding
- Authors: Yu Gong, Kailash Budhathoki, Taeho Kim, Haipeng Li, Ashish Khetan
- Year: 2026
- Code: FlashInfer `csrc/fused_moe/monomoe`
- Architecture: weight-major persistent mega-kernel
- Contribution: routing/top-k/quantization/two expert projections/activation/reduction融合，並用 generated specialization + offline tuning。
- Limitation: 目前論文主要在 H200 decode workloads；不能直接推論 Blackwell 最佳 schedule。
- 改變了什麼：證明 backend choice 應依 decode shape，而非固定 grouped GEMM。

### tritonBLAS: Triton-based Analytical Approach for GEMM Kernel Parameter Selection
- Authors: Ryan Swann et al.
- Year: 2025
- Architecture: architecture-aware analytical tile/config selection
- Contribution: 不做 runtime autotune，也能在其測試集達到 autotuning solutions 95% 以上效能。
- Limitation: GEMM cost model不等於完整 MoE mega-kernel model。
- 改變了什麼：提供 Hermes `AnalyticalCostModel → BenchmarkGuard` 的直接方法論依據。

### SonicMoE: Accelerating MoE with IO and Tile-aware Optimizations
- Authors: Wentao Guo, Mayank Mishra, Xinle Cheng, Ion Stoica, Tri Dao
- Year: 2025
- Architecture: IO-overlap + tile-aware token rounding
- Contribution: 把 padding waste 與 activation IO 明確納入 MoE kernel設計。
- Limitation: 主要聚焦 training/Hopper；與 Blackwell persistent decode backend仍需比較。

## 已確認事實 / 推論 / 假說

**已確認：** SM100 TCGen05 accumulator可位於 TMEM；epilogue可從 TMEM載入 register後做 fusion；DeepGEMM dynamic FP8 epilogue包含 BF16 round、amax、UE8M0 SF與FP8 cast；DeepGEMM heuristic明確檢查 TMEM scale-factor columns與 output SF granularity。

**合理推論：** TMEM lifetime、epilogue bytes、scale-factor traffic與 expert tile tail應成為 MoE backend cost model的一級變數。

**尚未驗證假說：** 一個跨 Hopper/Blackwell、prefill/decode、不同 MoE model皆穩定的單一解析 cost model可在不大量 benchmark下選出最佳 backend。

## Unknown / Open Questions

1. TMEM bandwidth與 tcgen05.tmem_load contention在真實 MegaMoE 中如何量測並納入 roofline？
2. FP4 scale-factor layout/padding成本在 tiny-M decode 是否會抵銷部分 Tensor Core throughput優勢？
3. Backend selector應以單 kernel latency為目標，還是以 end-to-end token latency、tail latency與 multi-tenant fairness共同最佳化？

## 下一輪研究

**MoE Autotuner × DeepGEMM heuristics/mega_moe × FlashInfer MonoMoE schedule table × vLLM FusedMoE backend selection × end-to-end request-aware kernel planning**。

目標：把 `DynamicMoEBackendSelector` 從知識節點變成 Hermes Console 可執行的 decision graph：輸入 GPU/model/phase/batch/router histogram/quant/topology，輸出 backend、tile、cluster、TMA stage與預測成本，並保留 prediction vs measurement error。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：`TMEMAccumulatorLifetime`、`TMEMLoadSubtile`、`EpilogueTile`、`EpilogueWarpGrid`、`DynamicOutputScale`、`UE8M0ScaleFactor`、`ScaleFactorTensorLayout`、`BlockScaledMMA`、`EpilogueStorePipeline`、`TMAStoreStage`、`TMEMReuseBarrier`、`KernelFeasibilityFilter`、`AnalyticalKernelCostModel`、`BenchmarkGuard`、`ExecutionPlanCache`、`KernelPredictionError`。

新增 Edges：
- `TCGen05MMA → writes → TMEMAccumulator`
- `TMEMAccumulator → loaded_by → EpilogueWarp`
- `EpilogueWarp → releases → TMEMLifetime`
- `QuantizationFormat → determines → ScaleFactorLayout`
- `ScaleFactorLayout → consumes → TMEM/SMEMCapacity`
- `TMEMCapacity → constrains → KernelLayout`
- `ExpertHistogram → changes → TileTailWaste`
- `KernelCostModel → ranks → BackendCandidate`
- `BenchmarkGuard → corrects → KernelCostModel`
- `ExecutionPlanCache → selects → PhysicalExecutionGraph`

## 本輪結束判斷

- **缺哪一層：** request-level workload → kernel backend/tile/cluster 的 end-to-end runtime planner。
- **哪個節點最淺：** TMEM bandwidth/contension 的量測模型。
- **哪個概念仍只是名詞：** request-aware `ExecutionPlanCache` 的 invalidation與線上學習策略。
- **哪個系統值得讀原始碼：** vLLM FusedMoE backend selection + DeepGEMM `heuristics/mega_moe.hpp`。
- **哪篇論文需追引用：** MonoMoE，特別是後續 Blackwell/B200 reproduction與 backend comparisons。
- **哪個概念最適合視覺模擬：** TCGen05→TMEM→Epilogue lifetime + backend cost prediction error。
- **哪個 Agent 架構最值得實作：** 對 Hermes 最有價值的是 `Planner → Hardware-aware Execution Planner → Model Runtime`，讓 system reasoning不只決定用哪個模型，也能決定其 physical execution plan。

## 從一句話到 GPU 的新增還原段

```text
User sentence
→ UI
→ Agent Runtime
→ Context / Reasoning / Planning
→ Model Router
→ Transformer
→ MoE Router
→ Expert histogram
→ Backend Selector
→ Kernel Layout
→ TMA A/B/Scale
→ TCGen05 MMA
→ TMEM accumulator
→ Epilogue TMEM load
→ scale / activation / cast
→ SMEM
→ TMA store
→ HBM
→ next operator
→ logits
→ sampling
→ Agent
→ Tool/MCP/Action
```

本輪核心結論：**Blackwell 的低精度 MoE 執行不能只畫成「FP4 Tensor Core GEMM」。真正 physical graph 還包含 scale-factor layout、TMA、TMEM accumulator lifetime、epilogue reduction/cast、SMEM store pipeline與 kernel-layout feasibility。下一步應把這些硬體事實編成可計算的 Execution Planner，而不是繼續增加孤立名詞。**