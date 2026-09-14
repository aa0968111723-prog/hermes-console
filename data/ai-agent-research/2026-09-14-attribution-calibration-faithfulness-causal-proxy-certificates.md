# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 20:59（Asia/Taipei）**  
**主題：Attribution Calibration × Faithfulness Benchmark × Activation-Patching Limits × Causal Proxy Certificates**

---

## 本小時新發現

本輪承接上一輪的 `Attribution Safety Tier / InfluenceCertificate`，不再重複 attention、gradient、occlusion 的基本定義，而是追問：**一個 attribution score 到底在什麼條件下可以被信任？能不能把 cheap attribution 校準成對真實 intervention effect 的可信代理？**

本輪新增：

1. **When Attribution Patching Lies（Zhang & Wang, 2026）**：plain attribution patching 是 activation patching 的一階 Taylor 近似；主要誤差可來自 downstream nonlinearity。作者提出 reliability score、error bound 與 HVP second-order correction，形成 Screen → Flag → Fix 流程。
2. **The Curse of Multiple Mediators（Vaidyanathan et al., 2026）**：activation patching 本身也不是無條件的「因果金標」。單一 mediator 的 natural indirect effect 可混入 interaction effect；在多元、冗餘、非線性 transformer 中，單元 patching 可能漏掉 conditional mechanism 或誇大 component importance。
3. **SPD-Faith Bench（ACL Findings 2026）**：多模態 reasoning 可以答案正確但 reasoning 與視覺證據脫鉤；提出 perceptual blindness 與 perception-reasoning dissociation，顯示 accuracy 不能替代 faithfulness。
4. **RFEval（ICLR 2026）**：把 reasoning faithfulness 拆成 stance consistency 與 causal influence，使用 output-level counterfactual intervention，而不是僅看 rationale plausibility。
5. **CAAP（2026）**：在 Vision Transformer 直接對 internal patch representations 做 activation intervention，說明 input occlusion / gradient heatmap 只是 patch influence 的 proxy；但 internal patching 仍需考慮 layer window、neutral target context 與 mediator interaction。
6. **MAVIS（AAAI 2026）**：157K visual QA instances、fact-level multimodal citations，並分 informativeness / groundedness / fluency；實驗顯示 multimodal RAG 對 image-document groundedness 仍弱於 text-document groundedness。

### 與歷史研究比較

上一輪已建立：

```text
T0 TELEMETRY_ONLY
T1 CORRELATIONAL_HINT
T2 MODEL_INTERNAL_ATTRIBUTION
T3 PERTURBATION_VALIDATED
T4 COUNTERFACTUAL_REPLAY_VALIDATED
T5 CAUSALLY_CERTIFIED_SCOPE
```

本輪補上最缺的中介層：

```text
Raw attribution score
↓
Reference intervention definition
↓
Faithfulness benchmark
↓
Calibration curve
↓
Interaction / OOD / alignment diagnostics
↓
CausalProxyCertificate
↓
Safety tier decision
```

核心新結論：

```text
Attribution Method Name
≠ Evidence Strength

Activation Patching
≠ Interaction-Free Ground Truth

Answer Accuracy
≠ Reasoning Faithfulness

High Attribution–Intervention Correlation
≠ Universally Calibrated Attribution
```

Sources:
- https://arxiv.org/abs/2606.09899
- https://arxiv.org/abs/2606.27510
- https://aclanthology.org/2026.findings-acl.995/
- https://aidaslab.github.io/RFEval/
- https://arxiv.org/abs/2603.13652
- https://ojs.aaai.org/index.php/AAAI/article/view/40585
- https://aclanthology.org/2025.emnlp-main.529/

---

# 本小時最重要 5 個發現

## 1. Faithfulness 必須先定義 target observable 與 reference intervention

「這個 token attribution 很 faithful」是不完整命題。至少要指定：

```text
Target
├ next-token logit?
├ target probability?
├ final claim?
├ tool choice?
├ permission decision?
└ task success?

Intervention
├ mask input token
├ replace source field
├ activation patch
├ activation ablation
├ image patch replacement
├ audio-span replacement
└ deterministic replay fork
```

同一 attribution method 對不同 target 可能得到完全不同 fidelity。

Hermes 新增：

```text
FaithfulnessTargetContract
├ target_observable
├ target_metric
├ intervention_space
├ intervention_baseline
├ protected_variables[]
├ recomputed_descendants[]
├ side_effect_policy
└ equivalence_relation
```

### 為什麼重要

RFEval 明確將「reasoning 與 answer 是否一致」與「reasoning 是否真的因果影響 answer」分開；SPD-Faith Bench 也顯示 MLLM 可能輸出正確答案，但中間 reasoning 已與視覺 evidence dissociate。

因此：

```text
Plausible Explanation
≠ Faithful Explanation

Correct Answer
≠ Faithful Computation
```

---

## 2. Input perturbation 可能 OOD；internal intervention 也不是無偏金標

傳統 occlusion：

```text
x
↓ remove region i
x\i
↓
f(x\i)
```

問題是 `x\i` 可能落到訓練分布之外。EMNLP 2025 的 Causal Faithfulness 工作因此使用 activation patching，以 internal mediation 介入避免一部分 input-level OOD 問題。

但 2026 的 `The Curse of Multiple Mediators` 又指出：

```text
NIE(component)
=
PIE(component)
+
INT(component, rest of network)
```

也就是 activation patching 的自然間接效應可能包含該 mediator 與其他 bypass / mediator states 的 interaction。

因此本輪新增：

```text
ReferenceInterventionCertificate
├ intervention_level
├ baseline_generation
├ OOD_risk
├ mediator_scope
├ interaction_risk
├ redundancy_risk
├ prompt_dependence
└ validity_scope
```

### 核心 edge

```text
Internal Intervention
→ Reduces Some Input-OOD Risk

Internal Intervention
≠ Removes Mediator Interaction
```

---

## 3. Attribution patching 是一階近似，因此應該被「校準」，不是直接被相信

TransformerLens 目前新的 `transformer_lens/tools/analysis/attribution_patching.py` 把 plain attribution patching 寫得非常清楚：

```text
effect(node)
≈
(a_clean - a_corrupt)
·
d(metric)/d(a_corrupt)
```

也就是 clean-corrupt activation displacement 對 corrupt point gradient 的一階 Taylor estimate。

其 current implementation 也明確標示：

```text
node granularity            implemented
ig_steps = 1               implemented
edge scoring / EAP          not yet implemented
ig_steps > 1 / EAP-IG       not yet implemented
ablate-outside faithfulness not yet implemented
```

因此 library API 支援某個 attribution surface，並不代表該 surface 已通過 causal faithfulness certification。

`When Attribution Patching Lies` 的重要推進是把誤差來源放在 downstream nonlinearities，並提出 HVP correction。Hermes 可以抽象為：

```text
Cheap score S1
↓
Reliability diagnostic R
↓
if reliable:
   accept cheap proxy
else:
   run HVP / IG / activation patching
↓
compare against reference intervention
```

新增：

```text
AttributionApproximationRecord
├ approximation_order
├ expansion_point
├ displacement_norm
├ local_nonlinearity_score
├ reliability_score
├ error_bound
├ correction_method
└ reference_effect
```

---

## 4. Hermes 應建立「attribution → intervention probability」校準曲線，而不是一個 universal threshold

現在常見 UI：

```text
attribution = 0.91
```

使用者自然會誤解成：

```text
91% probability this source caused the output
```

這通常是錯的。

本輪提出：對特定 model × task × modality × attribution method × intervention contract，收集 benchmark：

```text
For each unit i:
  attribution score s_i
  ↓
  run reference intervention
  ↓
  observe effect Δ_i
  ↓
  label causal-proxy event z_i
```

其中例如：

```text
z_i = 1 if |Δ_i| ≥ δ
```

然後建：

```text
P(z=1 | score=s, domain=D)
```

而不是：

```text
P(cause)=raw_score
```

Hermes 新增：

```text
AttributionCalibrationProfile
├ model_version
├ task_family
├ modality
├ attribution_method
├ target_contract_id
├ score_bins[]
├ empirical_effect_rate[]
├ mean_effect[]
├ calibration_error
├ rank_correlation
├ top_k_precision
├ false_negative_rate
├ interaction_failure_rate
└ support_scope
```

### 重要限制

Calibration 必須是 conditional：

```text
Model A calibration
≠ Model B calibration

Text calibration
≠ Vision calibration

Short answer calibration
≠ Long reasoning calibration
```

---

## 5. Faithfulness benchmark 需要至少三個軸：effect recovery、ranking recovery、mechanism stability

只有 deletion / insertion score 不夠。

本輪建議 Hermes benchmark matrix：

### A. Effect Recovery

```text
predicted attribution effect
vs
reference intervention Δ
```

Metrics:

```text
MAE / normalized error
sign agreement
calibration error
```

### B. Ranking Recovery

是否把真正高-effect components 放前面：

```text
Spearman
Kendall
Precision@K
Recall@K
NDCG
```

### C. Mechanism Stability

在：

```text
prompt paraphrase
seed
model checkpoint
baseline choice
clean/corrupt pair
modality transform
```

改變後，mechanism 是否仍成立？

2026 mediator-interaction 工作指出 prompt dependence 與 hidden interactions 可以讓 single-component rankings 不穩定，所以 Hermes 應另外報：

```text
Attribution Stability
Interaction Sensitivity
Baseline Sensitivity
```

而不能只報一個 heatmap。

---

# Architecture Breakdown

```text
Text / Image / Audio / Video / Memory / Tool Field
↓
Physical Source Alignment
↓
Candidate Attribution Engines
├ attention
├ gradient × input
├ integrated gradients
├ attribution patching
├ recursive attribution
└ learned attribution proxy
↓
FaithfulnessTargetContract
↓
Reference Intervention Engine
├ input replacement
├ activation patching
├ activation ablation
├ multimodal patch replacement
└ deterministic replay fork
↓
Interaction / OOD Diagnostics
↓
Faithfulness Benchmark Runner
↓
AttributionCalibrationProfile
↓
CausalProxyCertificate
↓
Safety Tier Router
├ visualization only
├ trace slicing
├ evidence suggestion
├ audit
└ permission enforcement
```

新的核心 runtime primitive：

```text
CausalProxyCertificate
├ source_unit
├ target_observable
├ attribution_method
├ raw_score
├ calibrated_effect_probability
├ expected_effect_range
├ reference_intervention
├ reliability_score
├ interaction_risk
├ OOD_risk
├ alignment_uncertainty
├ benchmark_support
├ safety_tier
└ prohibited_uses[]
```

---

# Bottom-Level Logic

## Plain attribution patching

對 activation `a` 與 scalar metric `m(a)`：

```text
Δa = a_clean - a_corrupt

g = ∇_a m(a_corrupt)

Δm_hat_1 = gᵀ Δa
```

這只是：

```text
first-order local approximation
```

真實 patch effect：

```text
Δm_true
=
m(a_clean patched into corrupt context)
-
m(a_corrupt)
```

誤差：

```text
ε = Δm_true - Δm_hat_1
```

二階近似概念：

```text
Δm_hat_2
≈
gᵀΔa
+
1/2 ΔaᵀHΔa
```

2026 HVP 工作的意義，就是不需要顯式建立完整 Hessian，而利用 Hessian-vector product 改善一階估計。

## Calibration layer

對 score bin `B_k`：

```text
cal(B_k)
=
1 / |B_k|
Σ_i I(|Δ_i_reference| ≥ δ)
```

然後 UI 才能從：

```text
raw attribution = 0.83
```

改成：

```text
On this benchmark domain,
score 0.8–0.9 corresponded to
reference-intervention effects above δ
in 74% of supported cases.
```

這才具有 probabilistic interpretation。

## Interaction-aware layer

若單獨 patch A、B 與 jointly patch A+B：

```text
INT(A,B)
≈
Δ(A+B)
-
Δ(A)
-
Δ(B)
```

若 interaction 很大：

```text
single-unit attribution ranking
→ unsafe as modular explanation
```

應升級到：

```text
pair/group search
circuit-level analysis
or downgrade certificate tier
```

---

# Visual Simulation Idea

## Attribution Calibration Arena

使用者選：

```text
Target:
Final claim "18:00"

Sources:
Text / Image / Audio / Memory

Method:
Attention
Gradient
IG
Attribution Patching
Activation Patching
Replay Intervention
```

左側顯示 raw attribution：

```text
Image bbox #12       .91
Memory.start_time    .83
Text chunk #4        .42
Audio 03:21–03:26    .39
```

中央執行 intervention benchmark：

```text
                 raw   patch Δ   replay Δ
Image bbox       .91    .04       .02
Memory field     .83    .79       .74
Text chunk       .42    .13       .10
Audio span       .39    .35       .31
```

使用者會直接看到：

```text
HIGH ATTRIBUTION
≠ HIGH INTERVENTION EFFECT
```

右側顯示 calibration：

```text
Method: Attribution Patching
Domain: Llama / retrieval QA

0.0–0.2 → 11% strong effect
0.2–0.4 → 28%
0.4–0.6 → 49%
0.6–0.8 → 68%
0.8–1.0 → 76%

ECE: 0.14
Interaction risk: MEDIUM
Certificate: T2.7
```

再加一個 `PAIR INTERACTION` 按鈕：

```text
Memory alone    +0.31
Image alone     +0.08
Together        +0.71

Interaction     +0.32
```

畫面直接警告：

```text
NON-ADDITIVE MECHANISM
Single-source explanation incomplete.
```

---

# Code / GitHub

## TransformerLens

Repository:
https://github.com/TransformerLensOrg/TransformerLens

本輪值得看的目錄 / 核心檔案：

```text
transformer_lens/
├ model_bridge/
│  └ bridge.py
├ tools/
│  └ analysis/
│     ├ attribution_patching.py
│     └ direct_path_patching.py
├ ActivationCache.py
└ hook_points.py
```

目前 `attribution_patching.py` 的重要工程事實：

1. clean forward 取得 `a_clean`。
2. corrupt forward/backward 取得 `a_corrupt` 與 metric gradients。
3. node effect 使用 `(a_clean-a_corrupt)·gradient`。
4. ranking 用 absolute effect magnitude。
5. current source 明確指出 edge scoring、EAP-IG、ablate-outside faithfulness 尚未實作。
6. 新 API 目標為 `TransformerBridge`；檔案註記 v4 deprecates `HookedTransformer`。

這代表 Hermes 不應只存：

```text
method = attribution_patching
```

而應存：

```text
implementation
commit
approximation_order
ig_steps
node/edge granularity
hook family
metric definition
clean/corrupt construction
```

否則同名 method 在不同版本可能已不是同一個 estimator。

---

# Papers

## 1. When Attribution Patching Lies: Diagnosis and a Second-Order Correction

- Authors: Luyang Zhang, Jialu Wang
- Year: 2026
- URL: https://arxiv.org/abs/2606.09899
- Architecture: attribution patching → reliability diagnostic → HVP second-order correction
- Models: five model families, roughly 124M–9B reported in abstract
- Contribution: 分析 plain attribution patching 的一階近似誤差，提出 reliability score、error bounds、HVP correction。
- Limitation: 仍是特定 intervention / metric 下的 patch-effect approximation，不等於完整 Agent-level causality。
- 改變了什麼：讓 attribution patching 從「便宜替代 activation patching」升級成「可先診斷可靠性、必要時補二階校正的 proxy」。

## 2. The Curse of Multiple Mediators: Hidden Interaction Effects in Activation Patching

- Authors: Sankaran Vaidyanathan, David Arbour, Aaron Mueller, Scott Niekum, David Jensen
- Year: 2026
- URL: https://arxiv.org/abs/2606.27510
- Architecture: causal mediation analysis of transformer activation patching
- Dataset/task: GPT-2 IOI circuit experiments reported in abstract
- Contribution: NIE = component-specific path effect + interactions；interaction 可使 component invisible 或 inflated。
- Limitation: combinatorial mediator search 對大型模型不可直接窮舉。
- 改變了什麼：迫使我們放棄「activation patching = 無偏 component ground truth」的過度簡化。

## 3. SPD-Faith Bench: Diagnosing and Improving Faithfulness in Chain-of-Thought for Multimodal Large Language Models

- Authors: Weijiang Lv et al.
- Institution: ACL 2026 paper; author affiliations見原文
- Year: 2026
- URL: https://aclanthology.org/2026.findings-acl.995/
- Code: https://anonymous.4open.science/r/SPD-Faith/
- Architecture: fine-grained image-difference reasoning benchmark + SAGE visual evidence calibration
- Contribution: perceptual blindness / perception-reasoning dissociation；指出 response correctness 不足以評估 MLLM reasoning faithfulness。
- Limitation: benchmark task distribution 仍是特定 fine-grained visual comparison。

## 4. RFEval: Benchmarking Reasoning Faithfulness under Counterfactual Reasoning Intervention in Large Reasoning Models

- Authors: Yunseok Han, Yejoon Lee, Jaeyoung Do
- Institution: Seoul National University / IPAI / ECE
- Year: 2026, ICLR poster
- URL: https://aidaslab.github.io/RFEval/
- Architecture: output-level counterfactual intervention
- Contribution: stance consistency + causal influence 分離；避免把 plausible rationale 當 faithful reasoning。
- Limitation: output-level intervention 仍未直接給出全部 internal mechanism causality。

## 5. Causal Attribution via Activation Patching

- Authors: Amirmohammad Izadi et al.
- Year: 2026
- URL: https://arxiv.org/abs/2603.13652
- Architecture: ViT internal patch-representation intervention over intermediate layers
- Contribution: 對 image patch influence 使用 internal activation intervention，而非只靠 input perturbation / attention / backward relevance。
- Limitation: attribution 對 neutral target、layer range、component interaction 敏感。

## 6. MAVIS: A Benchmark for Multimodal Source Attribution in Long-form Visual Question Answering

- Authors: Seokwon Song, Minsu Park, Gunhee Kim
- Institution: Seoul National University
- Year: 2026, AAAI-26
- URL: https://ojs.aaai.org/index.php/AAAI/article/view/40585
- Dataset: 157K visual QA instances with fact-level multimodal citations
- Metrics: informativeness / groundedness / fluency
- Contribution: 大型 multimodal source-attribution benchmark；發現 image-document groundedness 比 text document 更弱。
- Limitation: citation groundedness 與 internal causal attribution仍是不同問題。

---

# Unknown / Open Questions

## 1. Attribution calibration 能否跨 model / checkpoint transfer？

目前合理假設：大多數情況**不能直接 transfer**。

需要驗證：

```text
Model A calibration
↓ adapter?
Model B
```

是否可由：

```text
architecture family
activation scale
layer geometry
attribution method
```

建立 hierarchical calibration。

## 2. 如何把 mediator interaction 納入可計算 certificate？

完整 combinatorial search 不可行。

可能路徑：

```text
single unit screen
↓
high instability / low reliability
↓
pairwise interaction probing
↓
cluster-level group intervention
↓
interaction-aware certificate
```

## 3. 哪個 calibration tier 足以進 permission enforcement？

目前結論：

```text
Attention / Gradient alone
→ NO

Calibrated attribution proxy
→ candidate filtering / warning

Replay-validated or direct scoped intervention
→ stronger audit use

Irreversible action gate
→ still requires explicit policy + provenance + effect semantics
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Faithfulness Target Contract
Reference Intervention
ReferenceInterventionCertificate
Attribution Calibration
AttributionCalibrationProfile
Causal Proxy
CausalProxyCertificate
Attribution Approximation Error
Local Nonlinearity
Hessian-Vector Correction
Mediator Interaction Effect
Pairwise Intervention
Group Intervention
Interaction Risk
OOD Intervention Risk
Ranking Faithfulness
Effect Faithfulness
Mechanism Stability
Baseline Sensitivity
Prompt Sensitivity
Faithfulness Benchmark Runner
```

## Edges

```text
Answer Accuracy
≠ Reasoning Faithfulness

Attribution Score
≠ Probability Of Causality

Activation Patching
≠ Interaction-Free Ground Truth

Input Perturbation
→ May Create OOD Inputs

Internal Patching
→ Can Reduce Input-OOD Risk

Internal Patching
→ Can Retain Mediator Interaction

Attribution Patching
→ First-Order Approximation Of Patch Effect

Downstream Nonlinearity
→ Can Break First-Order Attribution

HVP Correction
→ Can Improve Local Patch-Effect Approximation

Calibration Profile
→ Is Model/Task/Modality/Target Conditional

High Rank Correlation
≠ Good Probability Calibration

Single-Component Ranking
→ Can Miss Interaction-Only Mechanisms
```

---

# 下一輪研究

下一輪自然收斂到：

# **Interaction-Aware Circuit Discovery × Group Attribution × Sparse Causal Subgraphs × Combinatorial Intervention Search**

因為目前已建立：

```text
Attribution
↓
Reference intervention
↓
Calibration
↓
Interaction diagnostic
```

但真正問題變成：

```text
當 A 單獨不重要、B 單獨不重要，
但 A+B 一起才是 mechanism 時，
怎麼在數十萬至數百萬 components 中找到它？
```

下一輪應深入：

```text
Attribution graph
↓
cheap candidate screen
↓
interaction diagnostics
↓
group / path intervention
↓
sparse causal subgraph search
↓
faithfulness validation
↓
circuit certificate
```

優先系統 / code：

- TransformerLens edge/path attribution roadmap
- Anthropic circuit-tracer / attribution graphs
- ACDC / Edge Attribution Patching / EAP-IG
- group intervention / sparse circuit discovery
- interaction-aware activation patching

---

# 本輪結束判定

**缺哪一層：** `Interaction-Aware Causal Circuit Discovery Layer`。

**哪個節點最淺：** `CausalProxyCertificate`、`AttributionCalibrationProfile`、`InteractionRisk`、`GroupInterventionPlanner`。

**哪個概念仍只是名詞：** production 級 `CausalityProbability`。現階段不能把 attribution score 直接轉稱「造成結果的機率」；只能在明確 benchmark/intervention contract 下稱 `calibrated proxy probability`。

**哪個系統值得讀原始碼：** TransformerLens `tools/analysis/attribution_patching.py` 與後續 edge/path implementation；下一輪再深讀 Anthropic circuit-tracer。

**哪篇論文需追引用：** `The Curse of Multiple Mediators` 第一優先，因為它直接挑戰 activation patching 作為單元 ground truth 的假設；其次是 `When Attribution Patching Lies`。

**哪個概念最適合視覺模擬：** `Attribution Calibration Arena`，尤其是 raw heatmap vs reference intervention effect vs interaction heatmap 三層同屏。

**哪個 Agent 架構最值得實作：**

```text
Attribution Engine
↓
FaithfulnessTargetContract
↓
Reference Intervention Engine
↓
Interaction/OOD Diagnostics
↓
Calibration Profile
↓
CausalProxyCertificate
↓
Safety Tier Router
```

---

# 對「AI 到底怎麼運作」本輪補上的核心

AI 的解釋不能停在「哪個 token / image patch 的 attention 最大」。即使換成 gradient、attribution patching，甚至 activation patching，也必須先定義你正在測量哪一個 outcome、用什麼 intervention、baseline 是否合理、介入是否 OOD、component 是否和其他 mediator 強烈交互作用，以及這套 attribution 在同類模型與任務上究竟多常與真正 intervention effect 一致。

因此，一個真正可驗證的 AI runtime 應從：

```text
Heatmap
```

進化成：

```text
Raw Attribution
↓
Reference Intervention
↓
Faithfulness Benchmark
↓
Calibration + Interaction Diagnostics
↓
Scoped Causal Proxy Certificate
```

只有走到這一層，Hermes 才能知道某個 attribution 是「漂亮的提示」、「有統計校準的 proxy」，還是「在明確因果介入範圍內被驗證過的證據」。