# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 06:51（Asia/Taipei）**  
**本輪主題：Robust Causal Experiment Design × Model Misspecification × Safe Exploration × Adversarial Revalidation**

> 本輪承接 `2026-09-14-minimal-distinguishing-interventions-active-certificate-revalidation.md`。上一輪已回答「在既定 competing hypotheses H1…Hk 內，如何用最少 interventions 判斷 certificate 是否可遷移」。本輪不再重複 minimal hitting set / certificate EIG，而是處理更危險的 production failure：**真實機制根本不在 H1…Hk 裡時，planner 是否會用高 EIG 實驗把自己推向更有自信、卻更錯的結論？**

---

# 與歷史研究比較

既有 Hermes 研究已建立：

```text
Model Misspecification
→ Residual Diagnostics
→ Missing-Cause Hypothesis
→ Alternative Model Classes
→ Discriminating Experiment
```

以及：

```text
Certificate Hypothesis Set
→ Candidate Interventions
→ Certificate EIG / Distinguishing Power
→ Minimal Intervention Planner
→ Observation
→ Posterior Update
→ Adaptive Replan
```

但這兩條還缺少一個關鍵橋樑：

```text
What if truth ∉ current hypothesis set?
```

如果 runtime 只在封閉的 `H={H1,...,Hk}` 裡做 Bayesian update，則所有 posterior 最後仍會加總為 1；**即使每一個 H 都是錯的，系統仍被迫選出一個「最可能」的錯模型。**

因此本輪新增：

```text
Closed Hypothesis Revalidation
≠ Robust Revalidation
```

真正 robust 的迴圈應為：

```text
Hypothesis Set H
↓
Candidate Intervention
↓
Nominal Information Gain
+
Misspecification Risk
+
Decision Fragility
+
Out-of-Model Surprise Power
+
Safety Cost
↓
Robust / Adversarial Experiment Choice
↓
Observation
↓
In-Model Update
+
Out-of-Model Residual Test
↓
KEEP H / EXPAND H / REJECT H / QUARANTINE CERTIFICATE
```

---

# 本小時新發現（新論文 / 新架構 / 新 GitHub）

## 1. On the Misinformation in a Statistical Experiment
- **Authors:** Jake Callahan, Tommie Catanach
- **Venue:** AISTATS 2026, PMLR 300:2287–2295
- **Year:** 2026
- **URL:** https://proceedings.mlr.press/v300/callahan26a.html
- **Code:** 未在 PMLR 頁面確認專用 code repository
- **Dataset:** methodological / simulated statistical experiments
- **Architecture:** Bayesian experiment ranking under model/inference misspecification; generalized robust axiomatic framework; EGIG interpreted as penalizing inferential error; complementary criterion penalizes model error.
- **Contribution:** 正式推翻「資訊更多一定更好」在 misspecified inference 下的普遍性。高資訊量 experiment 可放大 bias，讓 posterior 更 confident 但更錯；傳統 Blackwell-style monotonic intuition 不再安全。
- **Limitations:** 這是 statistical experimental-design theory，不直接提供 Agent runtime 的 tool/MCP/sensor safety layer；Hermes 的 runtime mapping 屬工程延伸。
- **改變了什麼:** 上一輪的 `CertificateEIG` 不能直接成為 production revalidation objective；需要額外的 misspecification / misinformation term。

## 2. Robust Bayesian Decision Making under Adversarial Uncertainty
- **Authors:** Haripriya Harikumar, Sammie Katt, Yasir Zubayr Barlas, Samuel Kaski
- **Venue:** UAI 2026, PMLR 337:1983–2007
- **Year:** 2026
- **URL:** https://proceedings.mlr.press/v337/harikumar26a.html
- **Code:** 本輪未確認官方 repository
- **Dataset:** synthetic + real-world scientific datasets
- **Architecture:** sequential adversarially robust decision-aware experimental design; experiments are scored by downstream decision stability under plausible adversarial variables, not merely nominal information gain.
- **Contribution:** conventional decision-aware design 可快速收斂到「高信心但 fragile」的決策；robust objective 對 hidden / weakly modeled effects 做 adversarial variation，直接最佳化 decision stability。
- **Limitations:** adversarial-variable set 仍需定義；若 ambiguity / adversary class 漏掉真正 shift，robustness guarantee 仍可能失效。
- **改變了什麼:** Hermes revalidation 不應只最大化「辨識 certificate validity 的資訊」，還要問「在 plausible unexpected effects 下，最終 permission decision 是否穩定」。

## 3. Robust Expected Information Gain for Optimal Bayesian Experimental Design Using Ambiguity Sets
- **Authors:** Jinwoo Go, Tobin Isaac
- **Venue:** UAI 2022, PMLR 180:728–737
- **Year:** 2022
- **URL:** https://proceedings.mlr.press/v180/go22a.html
- **Code:** 本輪以 REIGN 2026 engineering repo 觀察 robust-EIG 類型實作；該 repo 不是 Go & Isaac 論文官方實作，不能混同。
- **Dataset:** numerical experimental-design benchmarks
- **Architecture:** EIG over nominal prior → KL ambiguity set around prior → minimize an affine relaxation of EIG over plausible distributions → robust EIG; sampling form對應 log-sum-exp stabilization.
- **Contribution:** EIG 對 prior perturbation / sampling error 敏感；ambiguity-set robustification 可降低 optimistic experiment ranking。
- **Limitations:** robustness 範圍由 ambiguity set 決定；KL ball 不等於任意 structural misspecification。
- **改變了什麼:** Hermes 可把 `CertificateEIG(I)` 升級成 `RobustCertificateEIG(I; ambiguity_set)`，但不能宣稱 KL ambiguity 已涵蓋未知 causal mechanism。

## 4. Adversarial Causal Intervention Falsification (ACIF)
- **Author:** Mojtaba Eslami
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2608.06427
- **Code:** 本輪未確認公開官方 code
- **Dataset:** methodological / linear-Gaussian example + finite model/intervention classes
- **Architecture:** causal generator proposes observational/interventional laws; adversarial experimentalist chooses interventions that maximally falsify generator; discriminator is intervention-indexed.
- **Contribution:** 明確區分 `observational fit`、`interventional equivalence over admissible queries`、`point identification`；在有限 model/intervention class 下，worst-intervention discrepancy 可用來做 adversarial falsification，並有 disagreement-driven sequential elimination result。
- **Limitations:** arXiv 理論 setting 與高維 neural multimodal Agent 仍有距離；admissible intervention family 是否 separating 是核心假設。
- **改變了什麼:** Hermes experiment planner 應加入 `FalsificationScore(I)`：不是只問「哪個 intervention 最能在已知 H 之間分類」，而是問「哪個 intervention 最可能讓整個 current model class 露出破綻」。

## 5. REIGN: Robust Expected Information Gain for Navigating Adaptive Perturbation Screens
- **Repository:** https://github.com/11NOel11/REIGN
- **Year:** 2026 workshop release
- **Status:** 工程實作 / workshop repo；不能當成上述 UAI REIG 論文的官方等價實作。
- **值得看的目錄:** `src/reign/acquisition/`, `src/reign/models/`, `src/reign/experiments/`, `src/reign/sim/`, `src/reign/metrics/`
- **核心檔案:** `src/reign/acquisition/info_gain.py`
- **工程重點:** 同一檔案同時實作 Gaussian closed-form EIG、soft-min robust EIG、cross-context robust EIG、spectral concentration、shift-aware robust EIG。
- **改變了什麼:** 提供 Hermes 一個非常直接的 acquisition-module 工程 pattern：robustness 可被做成 planner plug-in，而不是散落在 prompt 中。

---

# 本小時最重要 5 個發現

## 發現 1 — Maximum Information Gain 可以是「Misinformation Gain」

### 是什麼

在 well-specified Bayesian experimental design 中，直覺是：

```text
Experiment I
↓
Higher expected information gain
↓
Posterior more concentrated
↓
Better inference
```

但 misspecified setting 可能變成：

```text
Wrong model class M
↓
Choose highly informative I under M
↓
Observation strongly discriminates parameters inside M
↓
Posterior collapses tightly around pseudo-true θ*
↓
Bias amplified
↓
Confidently wrong
```

Callahan & Catanach 2026 明確指出 classical experiment-comparison principle 在 model / inference misspecification 下可失效，高資訊 experiment 甚至會主動增加錯誤信心。

### 底層如何運作

Hermes 上一輪使用：

```text
EIG(I)
= H(H | history)
- E_o H(H | history, do(I), o)
```

這個式子只會問：

```text
在 current hypothesis family 裡，
I 讓 posterior entropy 降多少？
```

它不會問：

```text
current hypothesis family 本身對不對？
```

因此本輪新增：

```text
MisinformationRisk(I)
```

概念上要依賴：

```text
posterior concentration gain
×
model discrepancy / inferential approximation error
×
certificate consequence severity
```

Production planner 不應使用：

```text
score(I) = EIG(I)
```

而應朝：

```text
score(I)
=
RobustInfo(I)
+ FalsificationPower(I)
+ DecisionStabilityGain(I)
- MisinformationRisk(I)
- SafetyCost(I)
```

### 為什麼重要

這直接修正上一輪 `Minimal Distinguishing Intervention` 的盲點：如果 H1…H5 全錯，最小 distinguishing set 仍可非常有效率地選出「五個錯答案中最像真的那一個」。

### 限制

通用 `MisinformationRisk` 尚不存在可直接套在 arbitrary VLM/Agent runtime 的 theorem；這裡是基於 2026 robust BED 理論形成的 Hermes architecture。

### 狀態
**論文結果已確認；Hermes runtime score 為合理工程建模。**

---

## 發現 2 — Robustness 應對「分布 ambiguity」與「structural misspecification」分層

### 是什麼

Robust EIG 的 ambiguity-set 思路很適合：

```text
nominal prior p(θ)
↓
plausible q(θ) within KL radius
↓
worst / soft-worst information value
```

但這主要處理：

```text
parameter/prior uncertainty around model class
```

不等同於：

```text
true mechanism not representable by model class
```

### Bottom-level mechanism：soft-min robust EIG

工程上，REIGN 的 `robust_expected_information_gain()` 對多個 plausible noise levels 計算 IG：

```text
IG_j(a)
= 0.5 log(1 + model_var(a)/noise_var_j)
```

再用：

```text
REIG(a)
≈ -(T/ρ)
   log mean_j exp(-(ρ/T) IG_j(a))
```

這是一個 log-sum-exp soft-min：

```text
某 intervention
只在 optimistic noise assumption 下 IG 很高
↓
robust score 被拉低
```

REIGN 另外提供 shift-aware score：

```text
v_aug(a)
= v_model(a) + ρ s²_between_context(a)

score(a)
= EIG(v_aug)
- w × shift_evidence
    × spectral_concentration
    × normalized_between_context_variance(a)
```

### Hermes 應分成兩層

```text
Layer A: Distributional Robustness
├ prior perturbation
├ noise uncertainty
├ context shift
└ sampling uncertainty

Layer B: Structural Robustness
├ missing mechanism
├ wrong graph edge
├ wrong intervention semantics
├ omitted latent state
└ tool/sensor mechanism changed
```

所以新增核心否定：

```text
Robust EIG under ambiguity set
≠
Robustness to arbitrary structural misspecification
```

### 狀態
**UAI 2022 robust-EIG 原理已確認；REIGN 是獨立工程參考，不能視為官方實作等價。**

---

## 發現 3 — Revalidation 的目標應從「最有資訊」升級成「最穩定 permission decision」

### 是什麼

Hermes 真正關心的通常不是：

```text
我對 θ 知道多少？
```

而是：

```text
WRITE_EXTERNAL 是否仍可安全 ALLOW？
```

UAI 2026 robust decision-aware design 的核心是：

```text
Nominal best decision
```

可能對隱藏/弱建模 effects 非常脆弱，因此 experimental design 應直接追：

```text
Decision Stability
```

### Hermes 新 primitive

```text
DecisionFragilityProfile
├ certificate_id
├ permission_decision
├ nominal_utility
├ adversarial_variables[]
├ ambiguity_scope
├ worst_case_utility
├ worst_case_regret
├ decision_flip_probability
├ instability_margin
└ status
```

介入 I 的價值應加入：

```text
DecisionStabilityGain(I)
=
FragilityBefore
-
E_o[FragilityAfter(I,o)]
```

例如：

```text
I1: Camera occlusion test
EIG = .91
但所有 plausible outcomes 都維持 VERIFY
DecisionStabilityGain = .02

I2: Tool schema perturbation
EIG = .61
但 outcome 可把 WRITE_EXTERNAL
從 ALLOW ↔ BLOCK
DecisionStabilityGain = .47
```

Production runtime 可能應優先 I2。

### 新核心 edge

```text
Most Informative Experiment
≠
Most Decision-Stabilizing Experiment
```

### 狀態
**2026 paper result + Hermes permission mapping。**

---

## 發現 4 — Adversarial Revalidation 不只是紅隊攻擊，而是 causal falsification primitive

### 是什麼

一般 revalidation：

```text
H1,H2,H3
↓
挑最能分辨 H1/H2/H3 的 I
```

Adversarial falsification：

```text
Current model / certificate claim C
↓
尋找 intervention I*
使 predicted interventional law
與 observed law 的 worst-case discrepancy 最大
```

概念式：

```text
I*
= argmax_I
  D(
    P_real(O | do(I)),
    P_model(O | do(I))
  )
```

ACIF 強調三個不同層次：

```text
Observational Fit
≠ Interventional Equivalence
≠ Point Identification
```

這對 Hermes 特別重要：一個 VLM/world-model 可能在 replay dataset 上 prediction 很準，但只要少數 intervention 就暴露錯 causal mechanism。

### 新 runtime object

```text
AdversarialRevalidationPlan
├ target_certificate
├ admissible_interventions[]
├ safety_constraints[]
├ discrepancy_metric
├ predicted_interventional_laws[]
├ worst_case_candidate
├ expected_falsification_power
├ live_execution_allowed
├ sandbox_proxy
└ stop_rule
```

### Safe exploration

高 falsification power 不代表可 live execution：

```text
FalsificationPower(I)
HIGH
+
ExternalWorldRisk(I)
HIGH
→ SIMULATE_ONLY / SHADOW_ONLY
```

因此 intervention 必須經：

```text
Candidate
↓
Safety Classifier
├ replay-safe
├ sandbox-safe
├ shadow-safe
├ canary-safe
└ live-prohibited
↓
Adversarial planner
```

### 新核心 edge

```text
Most Falsifying Intervention
≠ Safest Executable Intervention
```

### 狀態
**ACIF theoretical framing confirmed; Agent safe-execution layer is engineering extension。**

---

## 發現 5 — Robust planner 必須允許「Hypothesis-Set Escape」

### 問題

封閉 posterior：

```text
P(H1|D)+...+P(Hk|D)=1
```

這會造成：

```text
truth ∉ H
↓
仍被迫將 probability 分配給錯模型
↓
某個錯模型最終拿到 0.99
```

因此 Hermes 需要 `OUT_OF_MODEL` 不是一句 warning，而是一級 state。

### 新 architecture

```text
Observation o
↓
In-Model Predictive Check
├ likelihood / predictive density
├ standardized residual
├ cross-modal residual
├ intervention signature mismatch
└ structural invariant violation
↓
Surprise / Misspecification Test
↓
if compatible:
   Bayesian update within H
else:
   HYPOTHESIS_SET_ESCAPE
```

新 primitive：

```text
HypothesisSetAdequacyCertificate
├ hypothesis_set_id
├ predictive_coverage
├ intervention_coverage
├ residual_structure_score
├ worst_intervention_discrepancy
├ out_of_model_evidence
├ misspecification_status
└ next_action
```

`next_action`：

```text
KEEP_SET
EXPAND_SET
REBUILD_MODEL_CLASS
COLLECT_DIAGNOSTIC_DATA
QUARANTINE_CERTIFICATE
BLOCK_PERMISSION
```

### 為什麼重要

這才真正閉合上一輪留下的問題：

```text
Planner believes H1...Hk
↓
True mechanism ∉ H
↓
EIG misleading
```

解法不是單純把 EIG 換成另一個 scalar，而是允許 runtime 說：

```text
NONE OF THE ABOVE
```

### 狀態
**合理工程推論；需後續研究 formal sequential misspecification test / e-process boundary。**

---

# Architecture Breakdown

## Robust Adversarial Certificate Revalidation Runtime

```text
Model / Encoder / Tool / MCP / Policy Change
↓
Certificate Dependency Graph
↓
Affected Claim Extractor
↓
Current Hypothesis Set H
+
OUT_OF_MODEL branch
↓
Candidate Intervention Generator
├ replay perturbation
├ modality ablation
├ sensor perturbation
├ context/memory perturbation
├ tool-schema perturbation
├ MCP permission perturbation
├ environment shift
└ query/user intervention
↓
Intervention Safety Classifier
├ REPLAY_SAFE
├ SANDBOX_SAFE
├ SHADOW_SAFE
├ CANARY_SAFE
└ LIVE_PROHIBITED
↓
Multi-Objective Experiment Evaluator
├ Nominal Certificate EIG
├ Robust EIG over ambiguity sets
├ Decision Stability Gain
├ Falsification Power
├ Out-of-Model Surprise Power
├ Representativeness
├ Cost
├ Latency
├ Privacy
└ Physical / External Risk
↓
Robust Experiment Planner
├ soft-min / ambiguity-set objective
├ minimax
├ distributionally robust
├ adversarial falsification
└ constrained Pareto planner
↓
Execute in safest sufficient environment
↓
Observation Ledger
↓
Dual Update
├ In-Model Bayesian Update
└ Model-Adequacy / Surprise Update
↓
Decision Router
├ CONTINUE_REVALIDATION
├ MIGRATE
├ SCOPED_MIGRATION
├ EXPAND_HYPOTHESIS_SET
├ REBUILD_MODEL_CLASS
├ QUARANTINE
└ BLOCK
↓
Permission Gate
```

---

# Bottom-Level Logic

## 1. Nominal certificate EIG

```text
U_nom(I)
= H(C | D)
- E_o H(C | D,I,o)
```

只回答 certificate uncertainty reduction。

## 2. Distributionally robust certificate value

對 ambiguity set `Q`：

```text
U_rob(I)
= inf_{q ∈ Q}
  E_q[ U(C,I,O) ]
```

工程上可 soft-min：

```text
SoftWorst(I)
= -τ log Σ_j w_j exp(-U_j(I)/τ)
```

`τ ↓` 時更靠近 worst case。

## 3. Adversarial decision stability

```text
V_robust(d)
= inf_{a ∈ A_adv}
  E[ utility(d,Y,a) ]
```

Experiment 要最大化的不只是 posterior change，而是：

```text
ΔStability(I)
= robust_value_after(I)
- robust_value_before
```

## 4. Falsification score

```text
F(I)
= D(
    P_obs(. | do(I)),
    P_model(. | do(I))
  )
```

實務上 observation 尚未取得時可用 competing simulators / posterior predictive 近似 expected falsification power。

## 5. Out-of-model surprise

```text
S(o,I)
= -log P_H(o | do(I),D)
```

但單一 low likelihood 不足以宣稱 model class 錯；應結合：

```text
repeated surprise
+
structured residual
+
intervention inconsistency
+
invariant violation
```

形成：

```text
ModelClassEscapeScore
```

## 6. Safe robust planner

本輪建議 Hermes 初版 objective：

```text
Score(I)
=
α RobustCertificateEIG(I)
+ β DecisionStabilityGain(I)
+ γ FalsificationPower(I)
+ δ OutOfModelDetectionPower(I)
- λ1 Cost(I)
- λ2 Latency(I)
- λ3 PrivacyRisk(I)
- λ4 ExternalWorldRisk(I)
```

硬 constraint：

```text
ExternalWorldRisk(I) ≤ risk_budget
PermissionRequired(I) ⊆ current_permissions
InterventionSideEffects(I) within sandbox contract
```

注意：這是 Hermes runtime design，不是某一篇論文直接給出的 universal formula。

---

# Visual Simulation Idea

# Robust Revalidation Arena × Model-Class Escape Lab

畫面左側：Current models

```text
H1  Fully equivalent         .42
H2  Camera role shifted      .31
H3  Tool proxy invalid       .19
H4  NCO invalid              .08
OUT_OF_MODEL                 ?
```

中央 interventions：

| Intervention | Nominal EIG | Robust EIG | Decision Stability | Falsification | OOM Detection | Risk |
|---|---:|---:|---:|---:|---:|---:|
| Camera occlusion | .91 | .52 | .18 | .47 | .62 | Low |
| Tool schema shift | .72 | .68 | .66 | .71 | .55 | Low |
| NCO perturbation | .79 | .61 | .31 | .83 | .74 | Low |
| Live external write | .95 | .91 | .89 | .94 | .86 | Critical |

使用者切換 planner：

```text
[Nominal EIG]
→ chooses Live external write
→ BLOCKED by safety constraint

[Robust EIG]
→ Tool schema shift

[Adversarial Falsification]
→ NCO perturbation

[Decision-Stability]
→ Tool schema shift
```

執行 NCO perturbation 後：

```text
Predicted under all H:
metric ∈ [.72,.79]

Observed:
.31
```

Console 不應強迫：

```text
H3 posterior = .97
```

而應跳出：

```text
OUT-OF-MODEL SURPRISE ⚠

Current hypothesis family rejected
Certificate CSC-8 → QUARANTINE
OPE-31 → STALE
WRITE_EXTERNAL → BLOCK

Recommended:
EXPAND MODEL CLASS
```

再顯示「信心陷阱」動畫：

```text
Nominal entropy
1.76 → 0.21 bits

Model adequacy
PASS → FAIL

Interpretation:
MORE CERTAIN, LESS CORRECT
```

這會非常直接地讓不懂 causal inference 的夥伴理解：

> posterior entropy 下降，不一定等於 AI 更接近真實世界。

---

# Code / GitHub

## REIGN
**Repository:** `11NOel11/REIGN`

### Directory structure 值得看

```text
src/reign/
├ acquisition/
│  ├ gaussian.py
│  ├ info_gain.py
│  ├ mes.py
│  └ thompson.py
├ data/
├ experiments/
├ metrics/
├ models/
├ sim/
└ utils/
```

### 核心檔案

`src/reign/acquisition/info_gain.py`

實際含：

```text
expected_information_gain()
robust_expected_information_gain()
cross_context_robust_eig()
spectral_concentration()
shift_aware_robust_eig()
```

工程上最值得 Hermes 借的是接口邊界：

```text
model uncertainty
+
noise / context uncertainty
+
shift evidence
↓
acquisition score
```

而不是直接複製其數學當作 universal causal guarantee。

### Hermes 可對應

```text
src/research_runtime/acquisition/
├ nominal_eig.py
├ robust_eig.py
├ decision_stability.py
├ falsification.py
├ oom_detection.py
└ safe_multiobjective.py
```

---

# Papers

## Paper A
**Title:** On the Misinformation in a Statistical Experiment  
**Authors:** Jake Callahan, Tommie Catanach  
**Institution:** PMLR page未列 affiliation；需追 PDF / OpenReview metadata再補  
**Year:** 2026  
**URL:** https://proceedings.mlr.press/v300/callahan26a.html  
**Code:** 未確認  
**Dataset:** methodological simulations  
**Architecture:** robust axioms for experimental comparison under misspecification  
**Contribution:** informative experiment can amplify wrong inference; separates inferential-error vs model-error robust criteria  
**Limitations:** not an Agent runtime architecture  

## Paper B
**Title:** Robust Bayesian Decision Making under Adversarial Uncertainty  
**Authors:** Haripriya Harikumar, Sammie Katt, Yasir Zubayr Barlas, Samuel Kaski  
**Institution:** authors associated with probabilistic / decision-theoretic ML research; exact affiliations should be taken from PDF rather than inferred here  
**Year:** 2026  
**URL:** https://proceedings.mlr.press/v337/harikumar26a.html  
**Code:** 未確認  
**Dataset:** synthetic + real scientific datasets  
**Architecture:** sequential adversarially robust decision-aware experiment design  
**Contribution:** optimize decision stability under plausible hidden/adversarial effects  
**Limitations:** depends on adversarial-variable / robustness set specification  

## Paper C
**Title:** Robust Expected Information Gain for Optimal Bayesian Experimental Design Using Ambiguity Sets  
**Authors:** Jinwoo Go, Tobin Isaac  
**Institution:** Georgia Institute of Technology  
**Year:** 2022  
**URL:** https://proceedings.mlr.press/v180/go22a.html  
**Code:** 未在本輪確認官方 repo  
**Dataset:** numerical benchmarks  
**Architecture:** KL ambiguity set → robust EIG → log-sum-exp stabilization  
**Contribution:** robustifies experiment ranking against prior perturbation / sampling uncertainty  
**Limitations:** ambiguity set does not solve arbitrary missing-mechanism error  

## Paper D
**Title:** Adversarial Causal Intervention Falsification  
**Author:** Mojtaba Eslami  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2608.06427  
**Code:** 未確認  
**Dataset:** theory + linear Gaussian example  
**Architecture:** generator vs adversarial experimenter; intervention-indexed discrepancy  
**Contribution:** worst-intervention falsification; interventional-equivalence framing; disagreement-driven elimination  
**Limitations:** finite-class theoretical assumptions; neural multimodal scaling remains open  

---

# Unknown / Open Questions 1–3

## 1. Hypothesis family misspecification 要如何 anytime-valid 地偵測？

目前 `ModelClassEscapeScore` 仍只是 architecture concept。需要研究：

```text
adaptive interventions
+
repeated posterior predictive checks
+
optional stopping
+
model expansion
```

下如何避免因為 planner 主動挑最容易出現 anomaly 的 intervention 而把 false-alarm rate 弄壞。

## 2. Ambiguity set 怎麼自動生成，而不是人工拍腦袋？

KL ball、noise range、adversarial variable range都需要來源。可能路線：

```text
historical residuals
cross-environment drift
encoder-version drift
tool-version drift
human-state variation
red-team perturbations
```

→ learned / certified ambiguity set。

## 3. Safe falsification 的 simulator-to-live gap 怎麼控制？

在 sandbox 裡最 falsifying 的 intervention，不一定在真實 Tool/MCP/Embodied runtime 中仍有同樣辨識力。需要：

```text
sandbox falsification
→ shadow replay
→ low-risk canary
→ live intervention
```

之間的 transportability certificate。

---

# Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Misinformation Experiment
Misinformation Risk
Robust Experiment Utility
Distributional Misspecification
Structural Misspecification
Ambiguity Set
Robust Expected Information Gain
Soft-Min Experiment Utility
Decision Fragility
Decision Stability Gain
Adversarial Variable
Adversarial Revalidation
Causal Falsification Intervention
Worst-Intervention Discrepancy
Interventional Equivalence Class
Separating Intervention Family
Out-of-Model Surprise
Hypothesis-Set Escape
HypothesisSetAdequacyCertificate
ModelClassEscapeScore
RobustCertificateEIG
AdversarialRevalidationPlan
Safe Falsification
Robust Revalidation Arena
```

## 新 Edges

```text
Higher Information Gain
≠ Better Inference Under Misspecification

Posterior Concentration
≠ Model Correctness

Minimal Distinguishing Intervention
≠ Robust Revalidation Automatically

Robust EIG Over KL Ambiguity
≠ Robustness To Arbitrary Structural Misspecification

Most Informative Experiment
≠ Most Decision-Stabilizing Experiment

Most Falsifying Intervention
≠ Safest Executable Intervention

Observational Fit
≠ Interventional Equivalence

Interventional Equivalence
≠ Point Identification

Closed Hypothesis Posterior
→ Can Become Confidently Wrong

Out-of-Model Surprise
→ Hypothesis-Set Escape

Hypothesis-Set Escape
→ Certificate Quarantine

Decision Fragility
→ Raises Revalidation Priority

Adversarial Falsification
→ Tests Model-Class Adequacy
```

---

# 下一輪研究

下一輪應進入：

# Anytime-Valid Model-Class Falsification × Adaptive Goodness-of-Fit × Sequential Misspecification E-Process × Hypothesis Expansion

因為目前最大的缺口已不是「選哪個 intervention」，而是：

```text
Agent adaptively chooses interventions
↓
therefore observations are selection-adaptive
↓
residual surprise observed
↓
Can we validly say current model class is wrong?
```

下一輪建議拆：

```text
Adaptive Intervention Policy
↓
Previsible Model Check / Test Martingale
↓
Posterior Predictive Residual
↓
Sequential E-Value / Confidence Sequence
↓
Model-Class Rejection Certificate
↓
Hypothesis Expansion
↓
New Mechanism Candidates
↓
Safe Revalidation Restart
```

特別要避免：

```text
Keep probing until something looks weird
↓
claim model misspecified
```

這等同 adaptive multiple testing / optional stopping failure。

---

# 每輪結束回答

**缺哪一層？**  
目前最缺的是 `Anytime-Valid Model-Class Falsification Layer`：能在 adaptive experiment selection 下合法判定「整個 current model family 不足」。

**哪個節點最淺？**  
`ModelClassEscapeScore`、`HypothesisSetAdequacyCertificate`、`SafeFalsificationTransportability`。

**哪個概念仍只是名詞？**  
production 級 `Out-of-Model E-Process`；目前沒有把它當成已有通用 theorem。

**哪個系統值得讀原始碼？**  
`11NOel11/REIGN` 的 `src/reign/acquisition/info_gain.py`，再向 `models/`、`experiments/`、`sim/` 追 acquisition → surrogate → experiment runner 的完整鏈。

**哪篇論文需追引用？**  
第一優先：Callahan & Catanach 2026，因為它直接處理「更 informative 為什麼可能更 misleading」；第二優先：Harikumar et al. 2026，因為它把 robust experiment design 從 parameter information 推到 downstream decision stability。

**哪個概念最適合視覺模擬？**  
`Robust Revalidation Arena × Model-Class Escape Lab`，尤其用「entropy 下降但 model adequacy FAIL」的動畫呈現 confidently-wrong failure。

**哪個 Agent 架構最值得實作？**  

```text
Certificate Dependency Graph
↓
Current H + OUT_OF_MODEL
↓
Candidate Intervention Generator
↓
Safety Classifier
↓
Robust EIG + Decision Stability + Falsification + OOM Detection
↓
Constrained Experiment Planner
↓
Sandbox / Shadow / Canary Executor
↓
Dual Update:
  In-Model Posterior
  + Model-Adequacy State
↓
Migrate / Expand H / Quarantine / Block
```

---

# 對「AI 到底怎麼運作」新增的核心

```text
User / Camera / Voice / Tool / MCP
↓
Agent forms a world-model hypothesis set
↓
Agent chooses an experiment / verification action
↓
World returns evidence
↓
AI does NOT only update probabilities inside its current model
↓
AI must also ask whether the whole model family still explains reality
↓
If not:
  stop increasing confidence
  invalidate affected certificates
  expand the hypothesis space
  redesign experiments
  restrict permissions
```

**真正可驗證的 AI，不能只會在「自己想得到的答案集合」裡越學越有信心。它還需要一個能主動找自己破綻的 adversarial experiment layer，並保留 `NONE OF THE ABOVE` 這個結論。否則 active learning 越有效率，模型錯時反而可能越快走向 confidently wrong。**