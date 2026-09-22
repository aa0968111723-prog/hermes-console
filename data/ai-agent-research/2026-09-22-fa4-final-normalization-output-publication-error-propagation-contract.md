# 【AI Agent × Multimodal Research Report】

**時間：2026-09-22 08:51（Asia/Taipei）**  
**主題：FlashAttention-4 Final Normalization × Output Publication × Error-Propagation Contract**

## 本小時新發現

本輪延續上一輪 `DeferredNormalizationDebt → correction warp → final row_sum`，不重複 correction ownership，而是往模型輸出方向推進：**當 correction debt 已被消化後，Attention output 仍必須經過 denominator reciprocal、V descale、output dtype conversion 與 GMEM publication；這些步驟共同決定真正送入 residual stream 的 O，而不是單靠「correction 完成」即可證明 Attention output 正確。**

已確認的 current FlashAttention-4 SM100 source 顯示 final path 會保存 `(row_sum, row_max, zero_or_nan flag)`，以 `rcp_approx(row_sum)` 形成 normalization scale，再乘 `v_descale`，之後交給 `correction_epilogue`。這表示 final normalization 本身具有可辨識的數值 generation，而不是一個無狀態的尾端乘法。

同一份 current source 也明確記錄 Low Precision Scaling：P 在 P@V 前會 cast 到 input dtype；若 conditional rescaling 允許 row max lag，`2^(max_offset + rescale_threshold)` 可能超出 dtype finite range，使 P saturation，而 FP32 denominator 仍完整計入 probability mass。這與上一輪的 `AttentionMeasureConsistencyWitness` 直接相接：**final reciprocal normalization 無法修復 numerator 與 denominator 已屬於不同 probability measure 的錯誤。**

獨立交叉驗證方面，HiFA4（2026）在 HIF4 low-bit attention 上明確報告：若 PV 使用量化後的 P̂，而 normalizer 使用不同 representation，會產生 coherent output-scaling error；其 P-Reordering 改成讓 normalizer從與 PV 相同的 P̂ 累積。ThriftAttention（2026）則顯示低精度 attention error 對 query-key block 的功能影響高度不均勻，重要 interaction 上的誤差更容易影響 long-context quality。兩者共同支持 Hermes 不能只追 `ΔO norm`，還必須追 error 的 token/head/block attribution。

## 本小時最重要 5 個發現

### 1. Final normalization 是獨立的 numerical frontier
**概念：** `FinalNormalizationGeneration`。  
**底層：** `row_sum → rcp_approx(row_sum) → × v_descale → O accumulator scaling → dtype conversion → output publication`。  
**重要性：** correction debt resolved 不等於 final output 已正規化。  
**限制：** 尚未取得 B200 runtime instruction-level trace。  
**證據等級：** current source confirmed + paper architecture cross-check。

### 2. Approximate reciprocal 必須被建模
current FA4 source使用 `cute.arch.rcp_approx(row_sum)`。因此 denominator 不應只存 `row_sum`，還應存 reciprocal policy：

`ReciprocalPolicyIdentity = {operation, input_dtype, approximation_mode, row_sum_generation}`

新增否定 edge：

`CorrectRowSum --does_not_prove→ ExactFinalReciprocal`

這不是說 `rcp_approx` 必然造成不可接受誤差，而是 evidence graph 必須區分「denominator 正確」與「其硬體近似 reciprocal 的結果」。

### 3. Final normalization 不能修復 measure mismatch
若 PV numerator來自低精度 / saturation後的 `P_lowp`，而 denominator仍來自較高精度 probability mass：

`O = Σ(P_lowp · V) / Σ(P_reference)`

這不是單純 scale precision error，而是 numerator / denominator measure mismatch。HiFA4 的 P-Reordering結果提供獨立研究證據，支持「normalizer應與實際PV所消費的 P representation一致」這個 invariant。

新增：

`FinalNormalizationWitness --does_not_prove→ AttentionMeasureConsistencyWitness`

### 4. Output correctness 必須加入 publication identity
Attention kernel內部的 O accumulator 即使數值正確，也還沒有等同於模型 residual stream真正讀到的 tensor。Hermes需要：

`AttentionOutputPublicationIdentity = {request, layer, head, q_tile, output_generation, destination_range, output_dtype, stream/launch identity}`

鏈：

`Corrected O(TMEM) → final scale → RMEM fragment → dtype conversion → SMEM/GMEM store → publication completion → residual consumer`

因此新增：

`CorrectInternalO --does_not_prove→ CorrectPublishedO`

### 5. Error propagation 要從 scalar norm 升級成 structured attribution
ThriftAttention顯示 quantization error 的功能影響並不均勻，重要 query-key blocks承受的 error 更值得保留高精度。因此 Hermes 的 `ΔAttention → ΔResidual → ΔLogit → ΔToken` 不應只追一個 global L2 error，而要至少保存：

`{layer, head, q-range, kv-range, token-position, output-channel, error-source}`

這讓未來可以回答：哪個 low-precision P fragment、哪個 head、哪個 token位置最終造成 logit margin 翻轉。

## Architecture Breakdown

本輪 system architecture：**FlashAttention-4 SM100 forward final-output path**。

```text
Q,K,V
 → QK MMA
 → S(TMEM)
 → online softmax state
 → P low-precision encoding
 → P publication
 → PV MMA
 → O accumulator(TMEM)
 → deferred correction warp
 → corrected O generation
 → row_sum generation
 → rcp_approx(row_sum)
 → × V descale
 → final normalization generation
 → TMEM→RMEM
 → output dtype conversion
 → SMEM/GMEM publication
 → Attention output tensor
 → residual stream
 → next sublayer
 → logits
 → token
 → Agent decision/action
```

核心改變：上一輪的終點是 `NormalizationDebtResolved`；本輪把它往後拆成 `FinalNormalization → OutputEncoding → OutputPublication → ResidualConsumption`。

## Bottom-Level Logic

### Final normalization state

```text
ROW_SUM_READY(g)
 → RECIPROCAL_ISSUED(g)
 → RECIPROCAL_READY(g)
 → V_DESCALE_APPLIED(g)
 → O_SCALE_APPLIED(g)
 → OUTPUT_CAST(g)
 → OUTPUT_STORE_ISSUED(g)
 → OUTPUT_PUBLISHED(g)
 → RESIDUAL_CONSUMABLE(g)
```

必要 invariant：

```text
FinalAttentionOutputCorrect =
  AttentionMeasureConsistency
  ∧ AllNormalizationDebtResolved
  ∧ CorrectRowSumGeneration
  ∧ CorrectReciprocalGeneration
  ∧ CorrectVDescaleGeneration
  ∧ CorrectOutputEncoding
  ∧ CorrectOutputPublication
```

新增 failure family：

- `FINAL_NORMALIZATION_WRONG_ROWSUM_GENERATION`
- `RECIPROCAL_POLICY_MISMATCH`
- `V_DESCALE_GENERATION_MISMATCH`
- `CORRECT_O_BUT_STALE_OUTPUT_PUBLICATION`
- `OUTPUT_DTYPE_CAST_DRIFT`
- `ATTENTION_MEASURE_MISMATCH_SURVIVES_FINAL_NORMALIZATION`
- `OUTPUT_PUBLICATION_BEFORE_FINAL_SCALE_COMPLETE`
- `HEAD_LOCAL_ERROR_CAUSES_LOGIT_MARGIN_FLIP`

## Visual Simulation Idea

### Attention Output → Logit Causal Microscope

互動 UI 分成五層：

1. **Probability Measure**：P_exact / P_lowp / denominator measure。
2. **PV + Correction**：O accumulator、normalization debt、correction generation。
3. **Final Normalization**：row_sum、rcp approximation、V descale、output cast。
4. **Publication**：TMEM/RMEM/SMEM/GMEM 與 output-generation timeline。
5. **Model Effect**：ΔO → ΔResidual → ΔLayerNorm/RMSNorm → ΔMLP/next attention → ΔLogit → token-rank change。

使用者可注入：P saturation、wrong denominator generation、reciprocal perturbation、V descale mismatch、BF16/FP16 cast error、stale output tile；UI顯示哪個 head / token / channel 對最終 logit margin影響最大。

## Code / GitHub

### Dao-AILab/flash-attention
值得繼續看的 current paths：

- `flash_attn/cute/flash_fwd_sm100.py` — SM100 forward pipeline、Low Precision Scaling、correction/final epilogue。
- `flash_attn/cute/softmax.py` — row_max / row_sum / conditional rescaling。
- `flash_attn/cute/blackwell_helpers.py` — TMEM copy / fence helpers。
- `flash_attn/cute/pipeline.py` — pipeline phase / barrier semantics。
- `flash_attn/cute/block_sparse_utils.py` — empty/sparse tile correction edge cases。

Current source evidence：`flash_fwd_sm100.py` explicitly computes `scale = rcp_approx(row_sum)` then multiplies by `v_descale` before `correction_epilogue`; the file also documents the Low Precision Scaling saturation condition.

## Papers

### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling
- **Authors:** Ted Zadouri, Markus Hoehnerbach, Jay Shah, Vijay Thakkar, Tri Dao
- **Institution / venue:** MLSys 2026
- **Year:** 2026
- **URL:** https://proceedings.mlsys.org/paper_files/paper/2026/hash/ae8b0b5838ba510daff1198474e7b984-Abstract-Conference.html
- **Code:** https://github.com/Dao-AILab/flash-attention
- **Architecture:** Blackwell fully-asynchronous MMA + TMEM + warp specialization + conditional softmax rescaling + software exponential + 2-CTA MMA
- **Contribution:** shifts optimization from pure GEMM throughput to asymmetric bottleneck co-design.
- **Limitation for Hermes:** paper-level architecture does not provide request-scoped runtime causal provenance from row_sum to published O.

### HiFA4: Training-Free 4-bit FlashAttention on Ascend HIF4 NPUs for LLM Inference
- **Authors:** Hui Dong et al.
- **Institution:** Huawei Technologies
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.04302
- **Architecture:** HIF4 QK/PV + FP16 online-softmax state + Smooth-QK + P-Reordering
- **Contribution:** demonstrates coherent output-scaling error when normalizer and PV use inconsistent P representations; P-Reordering aligns them.
- **Reported result:** Qwen3-8B Layer-0 trace measured net probability-mass loss across 3.6M attention tiles in the evaluated direct-quantization setting; P-Reordering reduces downstream decision drift.
- **Limitation:** Ascend HIF4 result is conceptual cross-validation, not direct B200 FA4 runtime evidence.

### ThriftAttention: Selective Mixed Precision for Long-Context FP4 Attention
- **Author:** Joe Sharratt
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.23081
- **Code:** https://github.com/joesharratt1229/ThriftAttention
- **Architecture:** important QK block selection → selected FP16 path + remaining FP4 path → online-softmax merge
- **Contribution:** shows low-bit attention error has highly non-uniform functional importance; computing only a small fraction of selected blocks in FP16 recovers much of the FP4→FP16 quality gap in its experiments.
- **Limitation:** block-selection heuristic does not directly give causal GPU-instruction provenance.

## Unknown / Open Questions 1–3

1. `rcp_approx(row_sum)` 在 SM100 compiled PTX/SASS 的 exact lowering、error bound與runtime observability為何？
2. `correction_epilogue` 的 final O store在不同 `use_tma_O / split-KV / pack-GQA / varlen` branches中，publication frontier是否具有相同語義？
3. 如何把單一 `ProbabilityNumericalGeneration` 的 error可靠 join 到 residual tensor element，再跨後續層追到 logit margin與token decision，而不把相關性誤當因果？

## 下一輪研究

```text
correction_epilogue
 → final scale generation
 → rcp_approx lowering
 → V descale
 → output dtype conversion
 → TMA/non-TMA O store branch
 → output publication frontier
 → split-KV partial O / LSE merge semantics
 → final O generation identity
 → residual consumer
 → differential replay
 → ΔResidual
 → ΔLogit margin
 → ΔToken
 → ΔAgentAction
```

下一輪優先讀 `split-KV` combine path，因為一旦 attention output可由多個 KV split partial outputs合成，`CorrectPublishedO` 又必須拆成 `PartialOutputGeneration + LSEGeneration + MergeGeneration`，這是目前 output provenance 最明顯的下一缺口。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `FinalNormalizationGeneration`
- `ReciprocalPolicyIdentity`
- `ReciprocalApproximationWitness`
- `VDescaleGeneration`
- `OutputEncodingGeneration`
- `AttentionOutputPublicationIdentity`
- `AttentionOutputPublicationWitness`
- `ResidualConsumptionWitness`
- `StructuredAttentionErrorAttribution`
- `LogitMarginPerturbationWitness`

### Edges

```text
RowSumGeneration
 --normalized_by→ ReciprocalPolicyIdentity

ReciprocalPolicyIdentity
 --produces→ FinalNormalizationGeneration

FinalNormalizationGeneration
 --scales→ CorrectedOGeneration

CorrectedOGeneration
 --encoded_as→ OutputEncodingGeneration

OutputEncodingGeneration
 --published_as→ AttentionOutputPublicationIdentity

AttentionOutputPublicationIdentity
 --consumed_by→ ResidualConsumptionWitness

ProbabilityNumericalGeneration
 --can_perturb→ AttentionOutputPublicationIdentity

AttentionOutputPublicationIdentity
 --can_perturb→ ResidualState

ResidualState
 --can_perturb→ LogitMargin

LogitMargin
 --can_change→ TokenDecision
```

### Negative / non-implication edges

```text
NormalizationDebtResolved
 --does_not_prove→ FinalAttentionOutputCorrect

CorrectRowSum
 --does_not_prove→ ExactFinalReciprocal

FinalNormalizationWitness
 --does_not_prove→ AttentionMeasureConsistencyWitness

CorrectInternalO
 --does_not_prove→ CorrectPublishedO

SmallGlobalAttentionError
 --does_not_prove→ SmallTokenDecisionImpact
```

## 本輪結束判定

- **缺哪一層：** final normalized O → exact GMEM publication → residual consumer 的 runtime causal join。
- **哪個節點最淺：** `ResidualConsumptionWitness`。
- **哪個概念仍只是名詞：** production `LogitMarginPerturbationWitness`。
- **哪個系統值得讀原始碼：** FlashAttention-4 split-KV combine / O-store branches，以及 serving stack中 attention output進 residual stream 的 integration path。
- **哪篇論文需追引用：** FlashAttention-4；並追 HiFA4 的 measure-consistency與 ThriftAttention 的 importance-weighted error propagation。
- **哪個概念最適合視覺模擬：** `Attention Output → Logit Causal Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Attention Numerical Provenance Verifier + Final-Normalization Verifier + Output-Publication Trace Joiner + Structured Error Attribution Engine + Differential Replay Verifier + Causal Evidence Gate + Tool Executor`。

**本輪最大推進：** Hermes 的 Attention graph 已從「softmax/correction 在 GPU 裡算對了嗎」往模型層真正跨出一步：開始把 `row_sum → reciprocal → V descale → output encoding → GMEM publication → residual consumption` 視為獨立可驗證鏈。下一輪的核心不再是單 kernel 內部同步，而是 split-KV partial output如何合成唯一 final O，並如何把該 generation 接到後續 residual/logit/token。