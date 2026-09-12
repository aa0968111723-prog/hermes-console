# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 03:55（Asia/Taipei）**

**本輪主題：Causal Evidence Reconciliation × Identified-Set Conflict Core × Assumption Debugging Graph × Imprecise Value of Information × Verification Selection**

---

## 0. 與歷史研究比較：本輪避免重複的起點

前幾輪已建立：

- Selective acting / abstention / conformal calibration
- Delayed feedback / selective labels / verification propensity
- Sequential DR / trajectory propensity / positivity
- Causal history compression / action sufficiency
- Negative controls / proximal bridges / hidden-confounder sensitivity
- Cross-fitted proxy discovery / delphic uncertainty
- Gamma sensitivity / adversarial compatible-world search / causal decision regret
- Gamma × Lambda transport sensitivity / state-level identifiability / mechanism falsification

上一輪明確留下的缺口是：Hermes 同時可能得到 MSM Γ bound、proximal/proxy bound、information-theoretic bound、negative-control test、mechanism falsification、transport Λ bound，但尚未有正式規則處理「它們互相不相容」的情況。

本輪因此不再重做 Γ、Λ、proxy 或 falsification 基礎，而是研究：

> **多個 causal evidence modules 產生不同 identified sets 時，Hermes 如何判斷它們能不能共同成立、衝突來自哪個 assumption、需要放寬多少、下一次 verification / experiment 應該買哪一個資訊？**

---

# 本小時新發現

## 新論文 / 新方向

1. **Bridging Multiple Worlds: Multi-marginal Optimal Transport for Causal Partial-identification Problem** — Gao, Ge, Qian, AISTATS 2025。將 causal partial identification 重寫為 multi-marginal optimal transport，直接求 exact partial identified set，而不是假定 counterfactual joint distribution 已知。
   - URL: https://proceedings.mlr.press/v258/gao25b.html

2. **BudgetIV: Optimal Partial Identification of Causal Effects with Mostly Invalid Instruments** — Penn, Gunderson, Bravo-Hermsdorff, Silva, Watson, AISTATS 2025。允許多數 IV 不完全有效，以可調 budget constraints 描述違反程度；可行 causal-effect set 甚至可以是不連通的。
   - URL: https://proceedings.mlr.press/v258/penn25a.html
   - Code: https://github.com/jpenn2023/budgetIVr

3. **Optimization-Based Sensitivity Analysis for Unmeasured Confounding Using Partial Correlations** — Tobias Freidling, Qingyuan Zhao, Journal of Computational and Graphical Statistics, online 2026。把 sensitivity analysis 當成 constrained stochastic optimization，而不是單一 closed-form perturbation。
   - URL: https://doi.org/10.1080/10618600.2025.2573156
   - Code/package: https://github.com/tobias-freidling/optsens

4. **Robust Bayes Treatment Choice with Partial Identification** — Aradillas Fernández, Montiel Olea, Qiu, Stoye, Tinda, Econometric Theory, online 2026-07-23。對 partially identified decision problem 使用 set of priors 做 robust Bayes / minimax-risk treatment choice；指出 partial identification 下「知道 identified set」與「知道該怎麼決策」仍是兩件事。
   - URL: https://www.cambridge.org/core/journals/econometric-theory/article/robust-bayes-treatment-choice-with-partialidentification/4125FE898E298193C00B107953D36ECC

5. **Value of Information under Imprecise Probabilities: Decision-Rule-Specific Values and Fixed-Measure Envelopes on a Credal Set** — Rowan Iskandar, 2026。當 evidence 只確定一組 probability measures 而非單一 distribution 時，VOI 必須區分 rule-specific VOI 與 fixed-measure envelope。
   - URL: https://arxiv.org/abs/2607.06570

6. **A roadmap for systematic identification and analysis of multiple biases in causal inference** — Wijesuriya et al., 2025。強調多種 bias 不應逐個獨立 sensitivity，而應同時表達、共同調整，因為 one-at-a-time analysis 無法反映 bias interaction。
   - URL: https://arxiv.org/abs/2504.08263

---

# 本小時最重要 5 個發現

## 1. 多個 causal bounds 的正確物件不是「平均值」，而是 Set Geometry

### 概念

假設 Hermes 有六個 evidence modules：

```text
MSM Γ                 → Θ_Γ
Proximal bridge       → Θ_P
Info-theoretic bound  → Θ_I
Transport Λ           → Θ_T
State constraints     → Θ_S
Mechanism tests       → Θ_M
```

最先需要問的不是「哪一個 confidence 比較高」，而是：

```text
Θ_joint = Θ_Γ ∩ Θ_P ∩ Θ_I ∩ Θ_T ∩ Θ_S ∩ Θ_M
```

### 底層如何運作

若 `Θ_joint ≠ ∅`，表示這些 evidence / assumptions 至少存在共同相容的 causal worlds。

若：

```text
Θ_joint = ∅
```

代表目前的 evidence stack 不能同時成立。

但空交集有多種來源：

```text
A. 真正 assumption contradiction
B. Source / target scope 不一致
C. State scope 不一致
D. Finite-sample uncertainty 沒有被納入
E. Optimization approximation error
F. Proxy validity failure
G. Model misspecification
H. Version / temporal drift
```

### 為什麼重要

BudgetIV 特別提醒 identified set 可以是 disconnected feasible set；multi-marginal OT 也直接操作完整 partial identified set。因此 Hermes 不應把所有 causal evidence 強制壓成單一 `[L,U]`。

### 限制

Set intersection 只有在各模組對相同 estimand、population、time、state、intervention semantics 下才有意義。

### 新節點

```text
CausalEvidenceSet
IdentifiedSetGeometry
DisconnectedIdentifiedSet
JointCompatibleSet
EmptyIntersection
EstimandAlignmentContract
ScopeAlignmentContract
```

---

## 2. 空交集後真正該找的是 Minimal Conflict Core，而不是丟棄所有模型

### 概念

若：

```text
Θ_1 ∩ Θ_2 ∩ Θ_3 ∩ Θ_4 = ∅
```

不代表四套證據全部都錯。

可能：

```text
Θ_1 ∩ Θ_2 ∩ Θ_3 ≠ ∅
Θ_1 ∩ Θ_2 ∩ Θ_4 ≠ ∅
Θ_1 ∩ Θ_3 ∩ Θ_4 ≠ ∅
Θ_2 ∩ Θ_3 ∩ Θ_4 = ∅
```

此時 `{2,3,4}` 才是衝突核心。

### Hermes 工程化

新增：

```text
MinimalConflictCore
├ evidence_ids[]
├ assumption_ids[]
├ estimand
├ population
├ state_scope
├ time_scope
├ first_empty_intersection
├ numerical_tolerance
└ provenance
```

以及：

```text
AssumptionDebuggingGraph
Evidence module
   ↓ depends_on
Assumption
   ↓ constrains
Latent world / effect
   ↓ conflicts_with
Other assumption
```

### 更進一步：Minimal Relaxation

不要只說「衝突」，還要解：

```text
min Σ cost_i(δ_i)
subject to
intersection( relaxed Θ_i(δ_i) ) ≠ ∅
```

其中 `δ_i` 是 assumption relaxation。

例如：

```text
Gamma upper bound    1.35 → 1.48
Lambda upper bound   1.10 → 1.10
Proxy residual max   .05  → .09
```

若只放寬 proxy residual 一點點就能恢復 feasible set，Hermes 就知道下一輪最值得查 proxy validity，而不是重做 transport model。

### 已確認工程參照：optsens

`optsens/R/bounds.R` 將每個 sensitivity assumption 轉為 direct/comparative constraints；`R/grid.R` 再把這些 constraints 組合成 feasible grid，呼叫底層 grid search 找近似 feasible parameter points，最後才在 grid 上評估 causal effect。

值得讀：

```text
R/bounds.R
R/grid.R
R/inference.R
src/
```

這個設計給 Hermes 一個非常重要的模式：

```text
Assumptions
→ Explicit constraints
→ Feasibility
→ Identified set
→ Decision
```

而不是：

```text
Assumption
→ hidden inside model
→ one number
```

---

## 3. Evidence Reconciliation 必須區分「Hard Constraint」「Soft Evidence」「Falsifier」

上一輪已有 falsification monitor，但這輪發現不能把 negative control p-value、proximal interval、Γ bound、transport bound 全部當成同類型 interval。

Hermes 應建立 typed evidence：

```text
EvidenceType
├ HARD_IDENTIFICATION_CONSTRAINT
├ PARTIAL_IDENTIFICATION_SET
├ SENSITIVITY_FAMILY
├ STOCHASTIC_CONFIDENCE_SET
├ FALSIFICATION_TEST
├ MODEL_DIAGNOSTIC
├ TRANSPORT_CONSTRAINT
├ DOMAIN_ASSERTION
└ ENGINEERING_HEURISTIC
```

### 原因

例如：

```text
Negative-control failure
```

不是新的 ATE interval；它是在攻擊某個 assumption。

而：

```text
proximal [0.10,0.31]
```

通常是「在 proxy/bridge assumptions 成立時」的 identified / estimated region。

所以新的 reconciliation flow 應是：

```text
Evidence
↓
Type check
↓
Estimand / population / time alignment
↓
Assumption dependency expansion
↓
Hard-set intersection
↓
Statistical confidence inflation
↓
Falsifier overlay
↓
Diagnostic contradiction graph
```

新增重要否定 edge：

```text
Different Evidence Sources
≠
Exchangeable Measurements
```

以及：

```text
Falsification Test
≠
Effect Bound
```

---

## 4. Conflict 發生後，最重要的不是「再收更多資料」，而是 Value of Verification

### 問題

假設衝突核心是：

```text
ProxyValidityContract
vs
TransportLambda
vs
StateConstraint
```

Hermes 可以做：

```text
A. 問使用者一個問題
B. Browser 查來源
C. MCP read-only probe
D. Sandbox experiment
E. Shadow execution
F. Randomized verification
G. Human review
```

哪個最值得？

### 新定義

```text
VerificationValue(q)
=
Expected Conflict Reduction
+ Expected Identified-Set Contraction
+ Expected Decision-Regret Reduction
+ Expected Certificate Recovery
+ Expected Structural-Coverage Gain
-
Money Cost
-
Latency
-
Side-Effect Risk
-
Privacy Cost
```

### Imprecise VOI 的重要性

2026 的 imprecise-probability VOI 工作指出：當你只有 credal set（多個 admissible probability measures）時，「資訊價值」本身也不是一個天然的單一數字。至少要區分：

```text
RuleSpecificVOI
```

與：

```text
VOIEnvelopeAcrossCompatibleWorlds
```

因此 Hermes 不應用 nominal twin 去算一次 VOI 就決定做哪個 probe。

更安全的版本：

```text
VOI(q, ω)
for ω ∈ Ω

→ lower_VOI(q)
→ upper_VOI(q)
→ worst_case_net_VOI(q)
```

然後：

```text
q* = argmax_q min_{ω∈Ω} NetVOI(q,ω)
```

若沒有任何 verification 有正的 robust VOI：

```text
ABSTAIN / HUMAN / BLOCK
```

### 新節點

```text
ImpreciseValueOfInformation
VOIEnvelope
RuleSpecificVOI
ConflictReductionValue
CertificateRecoveryValue
RobustVerificationValue
```

---

## 5. Evidence Reconciliation 最後是 Decision Problem，不是 Statistics Dashboard

即使 joint identified set 不空：

```text
Θ_joint = [0.08, 0.41]
```

Agent 仍不知道要不要執行 `MCP_WRITE`。

而 2026 Robust Bayes Treatment Choice with Partial Identification 明確處理：在 partial identification + model ambiguity 下，如何以 set of priors 與 minimax risk / regret 做 treatment choice。

Hermes 因而應把 reconciliation 的輸出送入：

```text
Reconciled Causal Evidence
↓
Compatible Worlds Ω*
↓
Action Value Set
↓
Regret Set
↓
Robust / Minimax-Regret Decision Rule
↓
Planner Gate
```

而不是停在：

```text
「三個來源同意、兩個來源不同意」
```

新的 Planner 狀態：

```text
EVIDENCE_CONSISTENT
EVIDENCE_CONFLICT
ASSUMPTION_RELAXABLE
SCOPE_MISMATCH
STATISTICALLY_INCONCLUSIVE
STRUCTURALLY_UNIDENTIFIED
VERIFICATION_WORTH_BUYING
HUMAN_JUDGMENT_REQUIRED
```

---

# Architecture Breakdown

```text
User / Goal
↓
Agent Context + State
↓
Candidate Action / Estimand
↓
Causal Evidence Registry
├ MSM Γ sensitivity
├ Proximal / proxy bridge
├ Information-theoretic bound
├ Negative controls
├ Mechanism falsification
├ Transport Λ
├ State constraints
├ Randomized verification
└ Domain assumptions
↓
Evidence Type Checker
↓
Estimand Alignment
├ intervention semantics
├ outcome
├ horizon
├ population
├ state scope
└ time / policy version
↓
Assumption Dependency Graph
↓
Identified-Set Builder
↓
Joint Feasibility Engine
├ intersection
├ disconnected components
├ confidence inflation
└ optimization tolerance
↓
IF FEASIBLE
│  └→ Reconciled Compatible Worlds
│       ↓
│     Robust Decision / Regret Gate
│
└ IF EMPTY
   ↓
Minimal Conflict Core Finder
↓
Minimal Assumption Relaxation Solver
↓
Conflict Explanation Graph
↓
Verification Candidate Generator
↓
Imprecise VOI / Robust Verification Value
↓
QUERY / PROBE / EXPERIMENT / HUMAN / ABSTAIN
↓
New evidence
↓
Rebuild certificate
```

---

# Bottom-Level Logic

## A. Constraint normalization

每個 evidence module 先轉成：

```text
C_i(θ, ω, s, t) ≤ 0
```

或 set：

```text
Θ_i = { θ : C_i(θ) ≤ 0 }
```

但同時保存 assumption provenance：

```text
ConstraintRecord
├ constraint_id
├ evidence_id
├ assumption_ids
├ estimand
├ state_scope
├ population_scope
├ valid_time
├ system_time
├ confidence_level
├ hard_or_soft
└ source
```

## B. Feasibility first

```text
Find θ
subject to C_i(θ) ≤ 0 ∀ i
```

若無解：

```text
status = INFEASIBLE
```

不要輸出假 intersection。

## C. Conflict-core search

概念上寻找最小 subset `K`：

```text
∩_{i∈K} Θ_i = ∅
```

且移除任意一個 evidence 後恢復可行。

這可以類比 constraint programming 裡的 irreducible infeasible subsystem (IIS) 思想；Hermes 不必一開始做全局精確 IIS，可先用 greedy delete / hitting-set 近似。

## D. Minimum relaxation

```text
min_δ Σ λ_i |δ_i|
subject to
C_i(θ) ≤ δ_i
δ_i ≥ 0
```

輸出：

```text
AssumptionPressure
```

例如：

```text
proxy exclusion      0.72
transport stability  0.11
Gamma envelope       0.05
state constraint     0.00
```

表示 proxy exclusion 是恢復共同可行性時最受壓的 assumption。

## E. Decision-coupled conflict severity

不是所有 evidence conflict 都重要。

定義：

```text
DecisionConflictSeverity
=
P(action ranking changes across admissible reconciliations)
× worst_case_regret
```

如果 bounds 有衝突但所有合理 reconciliation 都選同一 action，Planner 可以繼續，但 certificate 必須顯示 assumption conflict。

若 conflict 會翻轉 action：

```text
ACT 禁止
→ VERIFY / HUMAN / BLOCK
```

---

# Visual Simulation Idea

## Causal Evidence Reconciliation Observatory

### 1. Identified-set layer

```text
Effect θ

MSM Γ          [---------]
Proximal             [------]
Info bound       [------------]
Transport          [-----]
State                 [---]
                    ↑
              joint feasible
```

衝突時：

```text
MSM Γ          [----]
Proximal                 [----]
Info bound       [------------]

JOINT SET = ∅
```

### 2. Conflict Core graph

```text
          Proxy Validity
            /       \
           /         \
   Proximal Bound   Negative Control
           \         /
            \       /
         EMPTY CORE #2
```

點擊 node 顯示：

```text
Assumption:
W ⟂ A | U,X

Evidence against:
held-out NC residual = .23
threshold = .08

Relaxation required:
+.11
```

### 3. Assumption Pressure Bars

```text
Proxy exclusion       █████████  .81
Transport stability   ██         .18
Gamma envelope        █          .07
State constraint                 .00
```

### 4. Verification Marketplace

```text
Candidate                 Robust VOI   Cost  Side effect
Ask user intent              .71       .08      low
Read-only MCP probe          .64       .04      low
Browser source check         .48       .03      low
Shadow write simulation      .39       .18      none-real
Real write probe             .22       .31      high
Human review                 .66       .55      low
```

### 5. Action before / after reconciliation

```text
Before:
MCP_WRITE   nominal .68
ASK_USER    nominal .55

After compatible-world reconciliation:
MCP_WRITE   regret [0,.44]
ASK_USER    regret [0,.09]

Planner verdict:
ASK_USER
```

---

# Code / GitHub

## 1. `tobias-freidling/optsens`

Repository:
https://github.com/tobias-freidling/optsens

核心值得看的檔案：

```text
R/bounds.R
R/grid.R
R/inference.R
R/sensana.R
src/
```

### 實際底層機制

`bounds.R`：

```text
user sensitivity statement
↓
add_bound()
↓
compute_bound()
↓
direct / comparative constraints
↓
store in sa$bounds
```

`grid.R`：

```text
bounds
↓
static_bounds()
+
constants()
↓
feasible_grid()
↓
Rcpp grid_search(...)
↓
feasible parameter grid
↓
eval_on_grid(...)
↓
causal-effect partially identified range
```

### 對 Hermes 的價值

不是照抄統計模型，而是照抄 architecture principle：

```text
Explicit Assumption Object
→ Constraint Object
→ Feasibility Engine
→ Partial Identified Set
```

## 2. `jpenn2023/budgetIVr`

Repository:
https://github.com/jpenn2023/budgetIVr

值得追：budget constraints、feasible set computation，以及如何表示 disconnected effect sets。

## 3. 下一輪應追 code

- conditional OT partial identification: https://github.com/siruilin1998/causalPIviaCOT
- Copula sensitivity: https://github.com/JiajingZ/CopSens
- multi-bias: https://github.com/pcbrendel/multibias

---

# Papers

## Paper 1

**Title:** Bridging Multiple Worlds: Multi-marginal Optimal Transport for Causal Partial-identification Problem  
**Authors:** Zijun Gao, Shu Ge, Jian Qian  
**Venue/Year:** AISTATS 2025  
**URL:** https://proceedings.mlr.press/v258/gao25b.html  
**Architecture:** potential-outcome marginals → multi-marginal OT coupling constraints → exact partial identified set  
**Contribution:** 把未觀察的 joint counterfactual coupling 視為 OT ambiguity，直接求 exact set。  
**Limitations:** 需要指定 marginal / cost / estimand structure；對複雜 sequential Agent world 需額外擴張。  
**改變了什麼：** 讓 Hermes 不再假定「identified set 一定是單 interval」。

## Paper 2

**Title:** BudgetIV: Optimal Partial Identification of Causal Effects with Mostly Invalid Instruments  
**Authors:** Jordan Penn, Lee M. Gunderson, Gecia Bravo-Hermsdorff, Ricardo Silva, David Watson  
**Venue/Year:** AISTATS 2025  
**URL:** https://proceedings.mlr.press/v258/penn25a.html  
**Code:** https://github.com/jpenn2023/budgetIVr  
**Architecture:** potentially invalid IVs → interpretable violation budgets → feasible causal effect set  
**Contribution:** 不要求所有 IV 完全有效；用 violation budgets 建立 sharp / exact feasible regions。  
**Limitations:** 假設類型仍需事先指定；budget calibration 本身仍是 sensitivity problem。  
**改變了什麼：** 直接支持 Hermes 的 `AssumptionBudget` 與 disconnected feasible set。

## Paper 3

**Title:** Optimization-Based Sensitivity Analysis for Unmeasured Confounding Using Partial Correlations  
**Authors:** Tobias Freidling, Qingyuan Zhao  
**Journal/Year:** Journal of Computational and Graphical Statistics, 2026 online publication  
**URL:** https://doi.org/10.1080/10618600.2025.2573156  
**Code:** https://github.com/tobias-freidling/optsens  
**Architecture:** partial-correlation sensitivity constraints → constrained stochastic optimization / grid search → partially identified region + uncertainty  
**Contribution:** 把 sensitivity analysis 變成通用 constraint optimization，可組合多條 intuitive bounds。  
**Limitations:** 主要聚焦 linear regression / IV 類模型；Hermes 需要推廣到 nonlinear sequential world models。  
**改變了什麼：** 提供 Evidence Reconciliation Engine 最直接的工程抽象。

## Paper 4

**Title:** Robust Bayes Treatment Choice with Partial Identification  
**Authors:** Andrés Aradillas Fernández, José Luis Montiel Olea, Chen Qiu, Jörg Stoye, Serdil Tinda  
**Journal/Year:** Econometric Theory, 2026  
**URL:** https://www.cambridge.org/core/journals/econometric-theory/article/robust-bayes-treatment-choice-with-partialidentification/4125FE898E298193C00B107953D36ECC  
**Architecture:** partially identified state → set of priors → robust Bayes / Γ-minimax risk → decision rule  
**Contribution:** 明確處理 model ambiguity + sampling uncertainty 下的 action choice。  
**Limitations:** treatment-choice abstraction比 Agent action graph簡單；production Agent 還要加入 side effects、tool permissions、trajectory effects。  
**改變了什麼：** 告訴 Hermes「Reconcile evidence」最後一定要接 Decision Rule，不是只做 dashboard。

## Paper 5

**Title:** Value of Information under Imprecise Probabilities: Decision-Rule-Specific Values and Fixed-Measure Envelopes on a Credal Set  
**Author:** Rowan Iskandar  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2607.06570  
**Architecture:** credal set → classical VOI evaluated over measures + rule-specific VOI → lower/upper VOI / decision-rule value  
**Contribution:** 說明 uncertainty set 下 VOI 本身也要 robustify。  
**Limitations:** 並非專為 causal Agent runtime；需與 causal identified sets、verification side effects 結合。  
**改變了什麼：** Hermes 的 next-best-verification 不應只依 nominal model 的 expected information gain。

---

# Unknown / Open Questions

## 1. Statistical conflict vs structural conflict 要怎麼正式分離？

兩個 95% confidence sets 不相交，不必然表示 structural assumptions 衝突；可能只是 finite-sample randomness。Hermes 需要把：

```text
identified set
confidence region around identified set
optimizer approximation
```

三層分開。

## 2. Minimal conflict core 是否能在高維 nonlinear causal world 即時求？

精確 IIS / minimal unsat core 搜尋可能非常昂貴。需要研究：

```text
greedy deletion
hitting-set approximation
Lagrangian conflict score
constraint dual variables
```

哪個最適合 Agent runtime。

## 3. Verification 本身若改變 world，VOI 如何計算？

前面已研究 verification-as-intervention。這表示：

```text
Information Gain
≠
Passive Observation Gain
```

Hermes 需要：

```text
Interventional VOI
```

同時計入 query 改變 state 的 causal effect。

---

# 下一輪研究

## 主題

**Conflict-Core Optimization × Dual Certificates × Interventional Value of Information × Evidence-Repair Policy**

下一輪應走：

```text
Evidence Constraint System
↓
Infeasible Joint Set
↓
Minimal Unsat / Conflict Core
↓
Dual / Shadow Price of Each Assumption
↓
Candidate Relaxation
↓
Candidate Verification
↓
Interventional Robust VOI
↓
Evidence-Repair Policy
↓
New Evidence
↓
Certificate Recovery
```

具體要研究：

1. constraint optimization 的 IIS / conflict refiner 如何映射到 causal assumptions；
2. dual variable / Lagrange multiplier 是否能當 `AssumptionPressure`；
3. partial identification 下 experiment design / active learning 如何選最有價值 measurement；
4. verification 改變 environment 時如何定義 causal VOI；
5. 多個 conflict cores 同時存在時，是修最便宜的 core，還是修最可能翻 action 的 core。

---

# Knowledge Graph 新增 Node

```text
Causal Evidence Reconciliation
Causal Evidence Registry
Evidence Type
Causal Evidence Set
Identified Set Geometry
Disconnected Identified Set
Joint Compatible Set
Empty Evidence Intersection
Estimand Alignment Contract
Scope Alignment Contract
Assumption Dependency Graph
Minimal Conflict Core
Assumption Conflict Graph
Minimal Assumption Relaxation
Assumption Pressure
Constraint Provenance
Statistical Conflict
Structural Conflict
Optimization Conflict
Imprecise Value of Information
VOI Envelope
Rule-Specific VOI
Robust Verification Value
Conflict Reduction Value
Certificate Recovery Value
Evidence Repair Policy
Decision Conflict Severity
```

# Knowledge Graph 新增 Edge

```text
CausalEvidence
→ constrains
IdentifiedSet

CausalEvidence
→ depends_on
Assumption

Assumption
→ may_conflict_with
Assumption

MinimalConflictCore
→ explains
EmptyIntersection

MinimalAssumptionRelaxation
→ repairs
JointFeasibility

Verification
→ reduces
ConflictUncertainty

Verification
→ may_change
WorldState

ReconciledCompatibleSet
→ feeds
RobustPlannerGate
```

# 重要否定 Edge

```text
Evidence Agreement
≠
Causal Truth

Evidence Conflict
≠
All Evidence Wrong

Empty Point-Estimate Overlap
≠
Structural Inconsistency

Falsification Test
≠
Effect Bound

Different Evidence Sources
≠
Exchangeable Measurements

Set Intersection
≠
Evidence Averaging

Identified Set
≠
Confidence Set

Optimizer Failure
≠
Causal Infeasibility

No Joint Feasible Point
≠
No Repairable Assumption Set

More Data
≠
Most Valuable Evidence

Expected Information Gain
≠
Robust Value of Verification

Passive VOI
≠
Interventional VOI
```

---

# 本輪結束回答

**缺哪一層：** `Conflict-Core Optimization + Interventional Robust VOI`。

**哪個節點最淺：** `AssumptionPressure`、`StatisticalVsStructuralConflict`、`CertificateRecoveryValue`。

**哪個概念仍只是名詞：** production-scale `EvidenceRepairPolicy`；目前還沒有針對大型 Agent causal graph 的成熟直接實作。

**哪個系統值得讀原始碼：** `tobias-freidling/optsens`，優先 `R/grid.R`、`R/inference.R` 與 `src/`；其次 `jpenn2023/budgetIVr`。

**哪篇論文需追引用：** `Optimization-Based Sensitivity Analysis for Unmeasured Confounding Using Partial Correlations`，因為它最接近「把人類可理解 assumption 轉成 optimizer constraints」；其次追 `Robust Bayes Treatment Choice with Partial Identification` 的 decision-theoretic 延伸。

**哪個概念最適合視覺模擬：** `Causal Evidence Reconciliation Observatory`——尤其是 identified-set geometry + minimal conflict core + verification marketplace 三聯圖。

**哪個 Agent 架構最值得實作：**

```text
Evidence-Reconciled Causal Planner
=
Typed Evidence Registry
+
Estimand Alignment
+
Constraint/Set Engine
+
Minimal Conflict Core
+
Assumption Relaxation
+
Imprecise Robust VOI
+
Evidence Repair
+
Minimax-Regret Planner Gate
```

---

# 對「AI 到底怎麼運作」新增的核心

到目前 Hermes 對 AI 決策的還原已從：

```text
User
→ Context
→ Reasoning
→ Planning
→ Tool
→ Outcome
```

逐步擴展成：

```text
User
→ Context
→ Causal State
→ Candidate Actions
→ 多套不完全因果證據
→ 每套證據依賴不同 assumptions
→ 形成多個 partial identified sets
→ 檢查這些 evidence 是否能共同成立
→ 若衝突，定位最小 conflict core
→ 計算放寬哪個 assumption 才能修復
→ 評估下一次 query / experiment 的 robust VOI
→ 修復 causal certificate
→ 再做 minimax-regret / robust action decision
→ Tool / MCP / Browser / Human / World
→ 新 outcome
→ 回寫 Evidence Registry
```

因此本輪的核心結論是：

> **成熟 Agent 不能只蒐集越來越多「證據」。它必須知道每一條證據建立在哪些 assumptions 上、這些 assumptions 能不能共同成立、衝突是 statistical 還是 structural、哪一個最小衝突核心真正會翻轉 action，以及下一次花成本取得什麼資訊最可能修復決策。因果能力的下一層，不只是 estimation，而是 evidence reconciliation。**
