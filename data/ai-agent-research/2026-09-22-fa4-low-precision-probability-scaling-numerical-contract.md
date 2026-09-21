# 【AI Agent × Multimodal Research Report】

**時間：2026-09-22 06:53（Asia/Taipei）**

**主題：FlashAttention-4 Low-Precision P Scaling × Online-Softmax Numerical Contract × PV Input Fidelity**

## 本小時新發現

本輪延續上一輪 `P fragment publication → PV overlap`，但不重複 publication/barrier，而是往「已發布的 P 到底代表什麼數值」深入。Current FlashAttention-4 Blackwell source 在 `flash_attn/cute/flash_fwd_sm100.py` 明確留下 Low Precision Scaling contract：P 原始範圍為 `(0,1]`，但在 P@V 前會 cast 到 input dtype；實作會利用 `2^max_offset` 放大 P，以使用低精度 dtype 尚未利用的上方動態範圍。若 `rescale_threshold > 0` 允許 row max 落後，P 可成長到 `2^(max_offset + rescale_threshold)`；一旦超過 dtype 最大有限值，top probabilities 會 saturation，而 FP32 denominator 仍計入完整值，造成 output shrink。這是數值 correctness contract，不只是效能 tuning。

同一 current source 還顯示 B200/SM100 與 SM103 對 exponent path 採不同 tuning：SM103 fast native exp2 將 emulation frequency 設為 0，而部分 SM100 configurations 會以不同 `ex2_emu_freq` 將 exp2 工作從 MUFU 移到 FMA；因此 `SoftmaxImplementationIdentity` 必須納入 architecture、dtype、causal mode、head dimension、2CTA mode 與 emulation schedule，不能只寫 `softmax`。

FlashAttention-4 論文指出 Blackwell 的 Tensor Core throughput 成長快於 shared-memory bandwidth 與 exponential units，因此 forward pipeline 不只做 asynchronous MMA overlap，也以 software-emulated exponential 與 conditional softmax rescaling減少 non-matmul bottleneck。這與 current source 的 tuning knobs 互相驗證。

## 本小時最重要 5 個發現

### 1. P publication correctness 與 P numerical fidelity 是兩個不同維度

**已確認工程實作：** 上一輪證明 P fragment 必須在 TMEM store visibility fence 後才能發布給 PV；本輪 source 顯示即使 publication ordering 完全正確，P 在 cast/scaling 時仍可能因 dtype saturation 改變數值。

因此新增：

`PFragmentPublicationWitness --does_not_prove→ PFragmentNumericalFidelityWitness`

完整 PV input readiness 應改為：

`PVInputReady = PublicationReady ∧ RangeCoverageReady ∧ GenerationMatch ∧ NumericalContractSatisfied`

### 2. Online-softmax denominator 與低精度 P numerator path 可以失配

**官方/current source evidence：** source comment明確指出，超過 dtype max 時 top P values saturation，但 FP32 denominator仍以完整值累積，結果會 shrink output。

拆解：

`Score S → RowMax m → exp2(S-m) → FP32 Sum/Denominator → P Scaling → LowPrecision Cast → Saturation? → P_lowp @ V → O_acc → / Denominator`

若：

`P_scaled_exact > dtype_max`

則：

`P_lowp = dtype_max`

但 denominator 沒有相同 clipping，因此 numerator/denominator不再表示同一個 probability measure。

新增 failure：`P_NUMERATOR_DENOMINATOR_SEMANTIC_DIVERGENCE`。

### 3. max_offset 是 representation contract，不只是 magic constant

P 在 `(0,1]` 時直接 cast 到低精度格式會浪費 dtype 正值上方大量 code points。以 `2^max_offset` 放大 probability tail 可以提高有效表示精度，但必須同時限制：

`max_offset + row_max_lag <= log2(dtype_max)`

因此新增：

`ProbabilityScalingContract = {dtype, log2_dtype_max, max_offset, rescale_threshold, row_max_epoch}`

以及：

`SameProbabilityValue --under_different_scaling_contract→ DifferentLowPrecisionEncoding`

### 4. Softmax bottleneck 已經從演算法節點變成 architecture-dependent execution policy

FA4論文指出 Blackwell asymmetric scaling 讓 exponential units成為更明顯瓶頸；current source則具體顯示 SM100可採 software-emulated exp2，而 SM103因 native exp2較快而關閉此路徑。這表示 Knowledge Graph 中 `Softmax` 不能只有抽象公式，還需要：

`SoftmaxMathIdentity → SoftmaxExecutionPolicy → Exp2Backend → EmulationSchedule → RegisterBudget → PScalingContract`

新增 `Exp2Backend = HARDWARE_MUFU | SOFTWARE_FMA_EMULATION | MIXED`。

### 5. Attention output causal chain必須保留 numerical-generation provenance

前幾輪已建立 stage generation / fragment generation；本輪新增 `ProbabilityNumericalGeneration`，因同一 fragment range 即使 barrier phase與TMEM generation一致，只要 row-max epoch或 scaling contract不同，仍可能是數值上錯誤的 P。

新的 identity：

`ProbabilityFragmentIdentity = Request + Layer + Head + QTile + KVTile + PipelineStageGeneration + FragmentRange + RowMaxEpoch + ProbabilityScalingContract`

因此：

`SameTMEMRange + SamePipelineGeneration --does_not_prove→ SameProbabilityNumericalGeneration`

## Architecture Breakdown

FA4 Blackwell forward的相關鏈現在可拆為：

`Q/K load → QK tcgen05 MMA → S in TMEM → S→RMEM → mask/score-mod → row max update → conditional rescale decision → exp2 backend selection → FP32 denominator accumulation → probability scaling by 2^max_offset → low-precision cast → P fragment TMEM store → async-store visibility fence → fragment publication → partial PV MMA → remaining P publication → PV accumulator → correction/rescale → output epilogue`

這一輪的 architecture lesson 是：`Softmax→P→PV` 同時跨越三種 contract：

1. **Mathematical contract**：online softmax normalization是否等價。
2. **Representation contract**：P scaling/cast/saturation是否保留預期比例。
3. **Pipeline contract**：正確 fragment是否在正確 generation 被發布給 PV。

三者不能合併成一個 `PReady` boolean。

## Bottom-Level Logic

對 row i、tile t，可將 online softmax抽象為：

`m_new = max(m_old, max(S_t))`

`alpha = exp(m_old - m_new)`

`l_new = alpha * l_old + sum(exp(S_t - m_new))`

FA4低精度 PV path額外引入 representation transform：

`P_exact = exp(S_t - m_effective)`

`P_scaled = P_exact * 2^max_offset`

`P_lowp = cast_dtype(P_scaled)`

若 conditional rescaling讓 `m_effective` 暫時落後 `delta`，則最大 P 可達：

`P_scaled_max = 2^(max_offset + delta)`

安全必要條件之一：

`max_offset + delta <= log2(dtype_max)`

若違反，`P_lowp` saturation，而 `l_new` 仍在FP32 path累積完整mass，造成 numerator/denominator divergence。

證據分類：

- **已確認 current source：** low-precision scaling、dtype max table、saturation/shrinking warning、architecture-specific exp2 tuning。
- **論文結果：** FA4以software-emulated exponential與conditional rescaling處理Blackwell非matmul瓶頸；B200 BF16最高1613 TFLOP/s、約71% theoretical utilization。
- **工程推論：** production verifier應把 row-max epoch/scaling contract綁進 P fragment provenance。
- **尚未驗證：** 真實B200 runtime逐fragment捕捉 `P_exact/P_scaled/P_lowp` 與最終 logit drift的完整 causal trace。

## Visual Simulation Idea

### Probability Scaling & Softmax Mass Conservation Microscope

互動參數：dtype（FP8 E4M3 / E5M2 / FP16 / BF16）、max_offset、rescale_threshold、row-max lag、score distribution、fragment split位置、exp2 backend。

同步顯示：

`S → row max → exp → P_exact → ×2^offset → P_scaled → cast → P_lowp → PV numerator`

另一條顯示：

`FP32 denominator mass`

UI用 `Mass Divergence Meter` 顯示：

`ΣP_exact` vs `Σdecode(P_lowp)`，並將 saturation fragment標紅。再把 divergence傳入 `ΔO → ΔResidual → ΔLogit → ΔToken` 模擬，讓使用者看到一個低層 dtype contract如何一路改變Agent輸出。

## Code / GitHub

### Dao-AILab/flash-attention

值得繼續看的核心：

- `flash_attn/cute/flash_fwd_sm100.py`：Blackwell forward、Low Precision Scaling note、dtype max、exp2 emulation tuning、split-P。
- `flash_attn/cute/softmax.py`：row max、exp2、sum與rescale implementation。
- `flash_attn/cute/blackwell_helpers.py`：TMEM/PV helper與Blackwell lowering glue。
- `flash_attn/cute/pipeline.py`：S/P/O cyclic pipeline與phase/generation。
- `flash_attn/cute/mma_sm100_desc.py`：QK/PV MMA descriptor construction。

值得追的 source-level invariant：

`P scaling contract → cast dtype → TMEM publication generation → PV consumer generation → O correction generation`

## Papers

### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling

- **Authors:** Ted Zadouri, Markus Hoehnerbach, Jay Shah, Timmy Liu, Vijay Thakkar, Tri Dao
- **Institutions:** Princeton University, Meta, Colfax Research, NVIDIA, Georgia Tech, Together AI
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2603.05451
- **Code:** https://github.com/Dao-AILab/flash-attention/tree/main/flash_attn/cute
- **Dataset:** kernel benchmarks / attention workloads；非傳統訓練dataset
- **Architecture:** CuTeDSL FA4；fully asynchronous MMA、TMEM、2CTA、software-emulated exp、conditional softmax rescaling
- **Contribution:** 針對Blackwell asymmetric hardware scaling重新共同設計attention algorithm與pipeline
- **Limitations:** kernel-level benchmark不能直接等同end-to-end model/token correctness；不同dtype與新架構仍需要獨立數值驗證
- **改變了什麼：** Attention optimization從「只減少HBM IO」進一步變成 tensor-core / exp-unit / shared-memory / TMEM / numerical-rescaling共同排程。

## Unknown / Open Questions

1. current `rescale_threshold`、`max_offset` 在各 dtype / head dimension / causal mode的完整決策表，如何一路傳到 softmax step與PV correction？
2. saturation guard是否完全由 compile-time/config限制保證，還是存在runtime row-dependent guard/correction？
3. 如何以低擾動 instrumentation擷取 `row-max epoch → P scaling → cast/saturation → PV → O`，並join到request/layer/head？

## 下一輪研究

`flash_fwd_sm100.py scaling config → softmax.py row-max/rescale implementation → exp2 hardware/emulation branch → max_offset/rescale_threshold derivation → P cast → PV accumulator correction → output normalization → generated PTX/SASS → numerical differential test → ΔAttention → ΔResidual → ΔLogit → ΔToken`

下一輪優先建立 `ProbabilityMassConservationWitness`，比較 reference FP32/BF16 mathematical path 與實際 low-precision P path，並把差異接入 Hermes causal evidence graph。

## Knowledge Graph 新增 Node / Edge

### Nodes

- `ProbabilityScalingContract`
- `ProbabilityNumericalGeneration`
- `PFragmentNumericalFidelityWitness`
- `ProbabilityMassConservationWitness`
- `LowPrecisionProbabilityEncoding`
- `ProbabilitySaturationWitness`
- `SoftmaxExecutionPolicy`
- `Exp2Backend`
- `Exp2EmulationSchedule`
- `RowMaxEpoch`
- `NumeratorDenominatorConsistencyWitness`
- `PVInputNumericalReadinessWitness`

### Edges

- `RowMaxEpoch → parameterizes → ProbabilityScalingContract`
- `ProbabilityScalingContract → transforms → P_exact → P_scaled`
- `P_scaled → cast_to → LowPrecisionProbabilityEncoding`
- `LowPrecisionProbabilityEncoding → consumed_by → PVMMA`
- `FP32Denominator → normalizes → OAccumulator`
- `ProbabilitySaturationWitness → may_break → NumeratorDenominatorConsistencyWitness`
- `PFragmentPublicationWitness --does_not_prove→ PFragmentNumericalFidelityWitness`
- `SamePipelineGeneration --does_not_prove→ SameProbabilityNumericalGeneration`
- `SoftmaxExecutionPolicy → selects → Exp2Backend`
- `GPUArchitectureCapabilityContract → constrains → SoftmaxExecutionPolicy`

## 本輪結束判定

- **缺哪一層：** `row-max/rescale decision → low-precision P encoding → PV correction → final O` 的runtime numerical causal join。
- **哪個節點最淺：** `ProbabilityMassConservationWitness`。
- **哪個概念仍只是名詞：** request/layer/head-scoped `ProbabilityNumericalGeneration` runtime witness。
- **哪個系統值得讀原始碼：** FlashAttention-4 `softmax.py + flash_fwd_sm100.py`，其次是Blackwell PV correction path。
- **哪篇論文需追引用：** FlashAttention-4，尤其 conditional softmax rescaling / emulated exponential / low-precision forward 的後續工作。
- **哪個概念最適合視覺模擬：** Probability Scaling & Softmax Mass Conservation Microscope。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Attention Numerical Provenance Verifier + Probability Mass-Conservation Verifier + Fragment Publication Verifier + GPU Architecture Policy Router + Differential Kernel Tester + Causal Evidence Gate + Tool Executor`。

## 與歷史研究比較

前幾輪逐步建立 `TMA data routing → tcgen05 completion → launch attribution → MMA commit frontier → TMEM lifecycle → accumulator handoff → tcgen05.ld completion → fence/quiescence → split-P publication`。本輪第一次把 correctness從「資料何時可以被讀」擴展到「被讀到的 probability 是否仍代表同一個數學量」。這補上了 execution provenance與numerical provenance之間的缺口，也是從GPU pipeline逐步走向 `ΔAttention → ΔLogit → ΔToken → ΔAgentAction` 必須存在的一層。