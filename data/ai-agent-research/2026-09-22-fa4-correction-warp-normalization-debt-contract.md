# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-22 07:56 Asia/Taipei

## 本小時研究主題
FlashAttention-4 Correction Warp × Deferred Rescaling × Normalization-Debt Contract

本輪承接上一輪 `ProbabilityScalingContract / ProbabilityMassConservationWitness`，但不重複低精度 P encoding。本輪改追：**當 conditional online-softmax 刻意延後 O 的 rescale 時，這筆「數值債務」如何被記錄、發布、由 correction warp 消化，最後再以 row_sum 正規化後發布 O。**

---

## 本小時新發現

### 1. FA4 的 conditional rescaling 不是單純「少乘幾次」；它建立 deferred normalization debt

官方 current source `SoftmaxSm100.update_row_max_from_local / update_row_max` 顯示：

`row_max_new → acc_scale_=(row_max_old-row_max_safe)*scale_log2 → exp2(acc_scale_)`

若 `rescale_threshold > 0` 且 `acc_scale_ >= -threshold`，實作會保留舊 `row_max`、令 `acc_scale=1`，也就是暫時不 rescale 舊 O。這是 algorithm state transition，不只是 performance flag。

因此新增：

`DeferredNormalizationDebt = exact_scale_required_but_not_yet_applied_to_O`

並且：

`ConditionalRescaleSkip --does_not_imply→ NoFutureCorrectionRequired`

### 2. Correction warp 是獨立的數值 ownership domain

current `flash_fwd_sm100.py` 的 correction loop 會讀 `sScale[row]`，warp-wide ballot 判斷任一 lane 是否 `scale < 1.0`；若需要，呼叫 `correction_rescale()`：

`O(TMEM) → tcgen05 TMEM load → RMEM multiply(scale) → tcgen05 TMEM store → fence_view_async_tmem_store`

之後才 `pipeline_s_p_o.consumer_release_w_index(stage)` 通知 MMA warp O 已完成 correction。

因此 correction 不是附屬於 softmax 的普通 scalar operation，而是一個：

`SoftmaxStatsProducer → CorrectionWarpConsumer/Producer → MMAWarpConsumer`

的跨 warpgroup ownership protocol。

### 3. O 的 publication readiness 必須同時包含 numerical correction 與 TMEM visibility

`correction_rescale()` 最後明確執行 `fence_view_async_tmem_store()`；所以「乘完 scale」與「新 O 已可被 MMA warp 安全消費」是兩個不同事件。

新增：

`OCorrectionArithmeticWitness`
`OCorrectionTMEMStoreWitness`
`OCorrectionVisibilityWitness`
`OCorrectionReleaseWitness`

安全條件：

`OCorrectionReady = ArithmeticComplete ∧ TMEMStoreIssued ∧ VisibilityEstablished ∧ CorrectStageGeneration ∧ ReleaseSignalled`

否定 edge：

`OCorrectionArithmeticWitness --does_not_prove→ OCorrectionPublicationWitness`

### 4. Final normalization 與 intermediate correction 是兩種不同 scale

correction loop 中間使用 `scale=sScale[...]` 修正既有 O；但 tile 結束後 source 把 `sScale[...]` 解讀成 `row_sum`，計算：

`final_scale = rcp(row_sum) * v_descale`

然後 `correction_epilogue()` 再做：

`O(TMEM) → RMEM → × final_scale → output dtype → SMEM → GMEM/TMA`

因此必須分離：

`IntermediateOCorrectionScaleIdentity`
vs
`FinalOutputNormalizationScaleIdentity`

同一個 scalar buffer `sScale` 在不同 pipeline epoch/phase 可以承載不同 semantic role，不能只用 address 判斷意義。

### 5. Low-precision probability mass 與 output normalization 必須是同一 measure 才能稱為 numerical fidelity

上一輪已發現 FP8 P saturation 可能使 PV numerator 與 FP32 denominator 不一致。本輪補上 output side：最終 O 是用 `1/row_sum` 正規化，因此若 PV 實際消費的 low-precision P mass 與 `row_sum` 記錄的 probability mass 不同，final normalization 無法自動恢復原本 attention measure。

新增：

`AttentionMeasureConsistencyWitness = PVNumeratorMeasureIdentity == SoftmaxDenominatorMeasureIdentity`

這與 2026 HiFA4 的 P-Reordering 結果形成獨立交叉驗證：該工作明確指出使用量化 P 做 PV、卻用不同高精度 measure 做 normalizer 會產生 coherent output-scaling error，並改成讓 normalizer 與實際量化 P 使用相同 measure。

---

## 本小時最重要 5 個發現

### 1. Deferred Normalization Debt
**概念：** conditional rescaling skip 不是消除 correction，而是把 correction 延後。

**底層：** `row_max update → acc_scale → threshold decision → scale=1 or correction scale → stats publication → correction warp`。

**重要性：** Hermes 若只記 `row_max`，無法知道 O 是否仍欠 correction。

**限制：** 目前為 source-level verified，尚缺 B200 runtime trace。

### 2. Correction Warp Ownership Protocol
**概念：** correction warp 對 O(TMEM) 擁有短暫 read-modify-write ownership。

**底層：** `wait stats → read scale → ballot → TMEM load → RMEM multiply → TMEM store → visibility fence → release`。

**重要性：** 這是 Softmax 與 PV MMA 之間真正的 numerical synchronization layer。

**限制：** 尚缺 generated PTX/SASS 與 runtime stage attribution。

### 3. Arithmetic completion != publication visibility
**概念：** scale 已乘完，不代表 MMA warp 已能看到新 O。

**底層：** asynchronous TMEM store 後需要 `fence_view_async_tmem_store()` 再 release pipeline stage。

**重要性：** 把 numerical correctness 與 memory ordering 合併成可驗證 contract。

### 4. Intermediate correction != final normalization
**概念：** intermediate scale 對齊不同 online-softmax epochs；final scale 則除以最終 row_sum 並乘 V descale。

**底層：** `O_partial × correction_scale` 與 `O_final × reciprocal(row_sum) × v_descale` 是兩個不同 phase。

**重要性：** 避免 Hermes 把相同 buffer/address 中的 scalar 誤判成同一 semantic object。

### 5. Measure consistency is stronger than mass conservation alone
**概念：** numerator 與 denominator 必須來自同一 probability representation。

**底層：** `P_exact → scaling/cast → P_lowp → PV numerator` 必須與 `row_sum` 的 measure identity 對齊。

**重要性：** final normalization 不能修復 numerator/denominator 使用不同 probability measure 的錯誤。

**限制：** FA4 BF16/FP16 path與 FP8 path需要分開驗證；不可把 HiFA4 HIF4 NPU 結果直接當成 B200 runtime evidence。

---

## Architecture Breakdown

### System Architecture: FlashAttention-4 SM100 forward numerical pipeline

`Q/K → QK MMA → S(TMEM)`

`S → rowmax → conditional online-softmax → P fragments`

`P → low-precision conversion → publication → PV MMA`

同時維護：

`row_max epoch`
`row_sum`
`intermediate O correction scale`

接著：

`softmax stats → correction warp`

`correction warp → O(TMEM) load → rescale → O(TMEM) store → visibility fence → pipeline release`

最後：

`O accumulator ready → row_sum reciprocal × v_descale → TMEM→RMEM → output conversion → SMEM → GMEM`

這是一個至少三方循環：

`Softmax Warpgroup ↔ MMA Warp ↔ Correction Warpgroup`

而不是線性 `QK→softmax→PV→O`。

---

## Bottom-Level Logic

### Conditional-rescale state machine

`ROWMAX_EPOCH(g)`
→ `NEW_TILE_MAX`
→ `DELTA_LOG2`
→ `THRESHOLD_TEST`

若需立即 rescale：
`CORRECTION_SCALE_CREATED`
→ `STATS_PUBLISHED`
→ `CORRECTION_WARP_OWNS_O`
→ `TMEM_LOAD`
→ `RMEM_SCALE`
→ `TMEM_STORE`
→ `TMEM_VISIBILITY_FENCE`
→ `O_CORRECTION_PUBLISHED`
→ `MMA_CAN_ADVANCE`

若 skip：
`DEFERRED_NORMALIZATION_DEBT_CREATED`
→ 後續 epoch 仍必須由 numerical contract 解決或被 final representation證明等價。

### Final normalization

`PV accumulator O`
→ `FinalRowSum`
→ `rcp(row_sum)`
→ `× v_descale`
→ `O(TMEM) load`
→ `× final_scale`
→ `dtype conversion`
→ `SMEM publication`
→ `GMEM output`

### Required invariant

`FinalAttentionOutputCorrect`
requires
`CorrectPVNumerator`
∧ `CorrectDenominator`
∧ `SameProbabilityMeasure`
∧ `AllDeferredCorrectionsResolved`
∧ `CorrectTMEMPublicationOrdering`
∧ `CorrectFinalScaleGeneration`

---

## Visual Simulation Idea

### Normalization Debt & Correction-Warp Microscope

四條同步 timeline：

1. `RowMax / RowSum Epoch`
2. `P Numerical Generation`
3. `O(TMEM) Generation`
4. `Correction Warp Ownership`

互動顯示：

`delta max`
`threshold`
`acc_scale`
`debt created/resolved`
`O stage generation`
`TMEM load/store`
`visibility fence`
`pipeline release`
`final row_sum`
`final_scale`

故障注入：

`CORRECTION_SCALE_GENERATION_MISMATCH`
`CORRECTION_RELEASE_BEFORE_TMEM_VISIBILITY`
`CORRECTION_SKIPPED_WITH_UNRESOLVED_DEBT`
`FINAL_NORMALIZATION_WRONG_ROW_SUM_GENERATION`
`PV_NUMERATOR_DENOMINATOR_MEASURE_DIVERGENCE`
`O_STAGE_REUSED_DURING_CORRECTION_OWNERSHIP`

最後可繼續模擬：

`ΔP measure → ΔPV numerator → Δnormalization → ΔO → ΔResidual → ΔLogit → ΔToken → ΔAgentAction`

---

## Code / GitHub

### Dao-AILab/flash-attention
值得繼續讀：

- `flash_attn/cute/softmax.py`
  - `SoftmaxSm100.update_row_max_from_local`
  - `SoftmaxSm100.update_row_max`
  - `update_row_sum`
  - `scale_subtract_rowmax`
  - `apply_exp2_convert`
- `flash_attn/cute/flash_fwd_sm100.py`
  - `correction_loop`
  - `correction_rescale`
  - `correction_epilogue`
  - `pipeline_s_p_o`
  - `pipeline_sm_stats`
  - `pipeline_o_acc`
- `flash_attn/cute/pipeline.py`
  - stage/phase semantics
- `flash_attn/cute/blackwell_helpers.py`
  - TCGen05/TMEM copy and fence abstractions

Source evidence confirms current SM100 code explicitly separates correction scale handling, correction TMEM read-modify-write, async TMEM store visibility fence, final reciprocal(row_sum), V descale, and epilogue publication.

---

## Papers

### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling
- **Authors:** Tri Dao et al.
- **Year:** 2026
- **Architecture:** Blackwell attention pipeline with fully asynchronous MMA, TMEM, software-emulated exponential, conditional softmax rescaling, 2-CTA MMA
- **Contribution:** moves attention design around shifted Blackwell bottlenecks; conditional rescaling removes most output rescale work from critical path
- **Reported result:** up to 1613 TFLOP/s BF16 on B200, about 71% theoretical utilization; up to 1.3× cuDNN 9.13 and 2.7× Triton
- **Code:** Dao-AILab/flash-attention `flash_attn/cute`
- **Limitation for Hermes:** paper-level performance/correctness does not provide request-scoped runtime provenance for correction stages

### HiFA4: Training-Free 4-bit FlashAttention on Ascend HIF4 NPUs for LLM Inference
- **Authors:** Hui Dong, Yanzhao Li, Jie Gao, Chunlu Li, Zhiyuan Zhang, Yupeng Sun, Zhenyuan Chen, Zhiqiang Zou
- **Year:** 2026
- **Architecture:** HIF4 QK/PV with FP16 online-softmax state; P-Reordering aligns normalizer with quantized P measure
- **Contribution:** directly exposes numerator/denominator representation mismatch as coherent output scaling error
- **Dataset/benchmarks:** MMLU and multiple LLMs
- **Limitation:** Ascend/HIF4 result; it supports the abstract measure-consistency contract, not NVIDIA B200 implementation details

### VFA: Relieving Vector Operations in Flash Attention with Global Maximum Pre-computation
- **Authors:** Yupeng Sun et al.
- **Year:** 2026
- **Architecture:** precondition/stabilize global maximum to reduce rowmax/rescale chain
- **Contribution:** attacks the same online-softmax vector bottleneck from a different algorithmic direction and can avoid FA4-style conditional-rescale update stages
- **Limitation:** requires separate accuracy/hardware validation before being treated as a replacement architecture

---

## Evidence Classification

### 已確認官方/原始碼事實
- FA4 SM100 conditional rescale uses thresholded row-max logic.
- correction loop consumes scale and can rescale O in TMEM.
- correction rescale performs TMEM load → RMEM multiply → TMEM store → async TMEM store visibility fence.
- final output normalization uses reciprocal(row_sum) and V descale before epilogue output.

### 論文結果
- FA4 Blackwell throughput/utilization claims.
- HiFA4 numerator/denominator mismatch measurements.
- VFA reduction of online-softmax vector work.

### 工程推論
- correction should be modeled as explicit numerical ownership transfer.
- `sScale` needs semantic role + epoch identity rather than address identity.

### 尚未驗證假說
- exact B200 SASS/runtime event sequence for every correction TMEM load/store/fence.
- request/layer/head-scoped dynamic `DeferredNormalizationDebt` witness.
- direct causal magnitude from one correction mismatch to token/agent-action change.

---

## Unknown / Open Questions

1. `sScale` 的 intermediate correction scale、final row_sum 在 compiled PTX/SASS 中如何被區分，能否建立 stable PC/phase signature？
2. `fence_view_async_tmem_store` lowering 後，是否能以官方 runtime instrumentation直接觀察 correction publication，還是仍需 binary instrumentation？
3. FP8 path 中 `max_offset=8`、rescale threshold、row-max lag、P saturation 與 correction warp 的 exact joint safety envelope 是什麼？

---

## 下一輪研究

鎖定：

`correction_loop source`
→ `sScale semantic phases`
→ `correction_rescale`
→ `tcgen05.ld/st lowering`
→ `fence_view_async_tmem_store lowering`
→ `pipeline_s_p_o release`
→ `PV accumulator generation`
→ `final row_sum / rcp`
→ `correction_epilogue`
→ `SMEM/GMEM publication`
→ `PTX/SASS signature`
→ `runtime observability`
→ `request/layer/head attribution`
→ `ΔO → ΔResidual → ΔLogit → ΔToken`

並建立 differential test：reference FP32/BF16 attention vs FA4 conditional-rescale path，分別注入 scale-generation mismatch、missing visibility fence、numerator/denominator measure mismatch，量化 output/logit drift。

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `DeferredNormalizationDebt`
- `NormalizationDebtGeneration`
- `IntermediateOCorrectionScaleIdentity`
- `FinalOutputNormalizationScaleIdentity`
- `OCorrectionOwnershipIdentity`
- `OCorrectionArithmeticWitness`
- `OCorrectionTMEMStoreWitness`
- `OCorrectionVisibilityWitness`
- `OCorrectionReleaseWitness`
- `OCorrectionPublicationWitness`
- `AttentionMeasureIdentity`
- `AttentionMeasureConsistencyWitness`
- `FinalNormalizationWitness`
- `FinalOutputPublicationWitness`
- `SoftmaxStatsSemanticPhaseIdentity`

### Edges
- `ConditionalRescaleSkip --creates→ DeferredNormalizationDebt`
- `SoftmaxStatsPublication --transfers_ownership_to→ CorrectionWarp`
- `CorrectionWarp --read_modify_writes→ OAccumulatorTMEM`
- `OCorrectionArithmeticWitness --does_not_prove→ OCorrectionPublicationWitness`
- `TMEMStoreFence --establishes_visibility_for→ OCorrectionStore`
- `OCorrectionPublicationWitness --unblocks→ PV/MMAStageAdvance`
- `FinalRowSum --produces→ FinalOutputNormalizationScale`
- `FinalOutputNormalizationScale --normalizes→ OAccumulator`
- `PVNumeratorMeasureIdentity --must_match→ SoftmaxDenominatorMeasureIdentity`
- `ProbabilityMassConservationWitness --does_not_prove→ AttentionMeasureConsistencyWitness`
- `SameScalarBufferAddress --does_not_imply→ SameSemanticScaleIdentity`

---

## 本輪結束判斷

- **缺哪一層：** correction TMEM load/store/fence/release 的 compiled PTX/SASS → runtime causal trace。
- **哪個節點最淺：** request-scoped `NormalizationDebtGeneration`。
- **哪個概念仍只是名詞：** production `AttentionMeasureConsistencyWitness`。
- **哪個系統值得讀原始碼：** FlashAttention-4 `correction_loop / correction_rescale / correction_epilogue` 與 CUTLASS TCGen05 copy/fence lowering。
- **哪篇論文需追引用：** FlashAttention-4；同時追 HiFA4 的 P-Reordering 與 VFA 對 online-softmax state redesign 的後續工作。
- **哪個概念最適合視覺模擬：** `Normalization Debt & Correction-Warp Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Attention Numerical Provenance Verifier + Normalization-Debt Tracker + Correction-Warp Ownership Verifier + Measure-Consistency Verifier + Binary Trace Joiner + Causal Evidence Gate + Tool Executor`。

本輪最重要推進：**Hermes 現在不只知道 P 是否被正確表示，也開始追蹤 online-softmax 為了效能而刻意延後的 O rescale「數值債務」：誰產生、哪個 warpgroup 接手、何時在 TMEM 完成 read-modify-write、何時建立 visibility、以及最終 row_sum normalization 是否與 PV 實際使用的 probability measure 一致。**