# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 04:53（Asia/Taipei）**

**本輪主題：Conflict-Core Optimization × Dual Infeasibility Certificate × Minimal Repair Set × Interventional VOI × Evidence-Repair Policy**

---

## 0. 與歷史研究比較：本輪避免重複的起點

前幾輪已建立：

- selective acting / abstention / conformal calibration
- delayed feedback / selective labels / verification propensity
- sequential DR / trajectory positivity
- causal history compression / action sufficiency
- negative controls / proximal bridges / hidden-confounder sensitivity
- cross-fitted proxy discovery / delphic uncertainty
- Γ sensitivity / adversarial compatible-world search / causal decision regret
- Γ × Λ transport sensitivity / state-level identifiability / mechanism falsification
- causal evidence reconciliation / identified-set geometry / minimal conflict core / imprecise VOI

上一輪已知道：當多個 causal evidence sets 的共同交集為空時，不應平均或丟棄全部證據，而應找 minimal conflict core，接著用 verification / experiment 修復 certificate。

本輪不再重做 evidence reconciliation，而是回答四個更底層的問題：

1. **衝突核心如何被 solver 實際證明，而不是由 LLM 猜測？**
2. **「最小衝突集合」與「最小修復集合」有何差別？**
3. **連續 constraint system 如何用 dual / Farkas certificate 說明 infeasibility？**
4. **Agent 下一個 verification 應如何直接以 conflict repair / decision regret reduction 為目標？**

---

# 本小時新發現

## 新論文 / 新方向

1. **Goal-Oriented Sequential Bayesian Experimental Design for Causal Learning** — Zheyu Zhang, Jiayuan Dong, Jie Liu, Xun Huan, 2025。
   - Institution: University of Michigan 等
   - URL: https://arxiv.org/abs/2507.07359
   - Architecture: transformer-based intervention policy + variational EIG lower bound + normalizing-flow posterior
   - Contribution: 不以「恢復完整 causal graph」為目標，而直接最大化與使用者指定 causal quantity 相關的 expected information gain，並規劃 intervention sequence。
   - Limitation: 仍依賴指定 Bayesian model / variational approximation；EIG 與 Hermes 的 worst-case decision repair 並不相同。

2. **Adaptive Online Experimental Design for Causal Discovery** — Elahi, Wei, Kocaoglu, Ghasemi, ICML 2024。
   - URL: https://proceedings.mlr.press/v235/elahi24a.html
   - Architecture: graph-separating intervention system + adaptive allocation matching + track-and-stop termination
   - Contribution: 把 interventional sample allocation 視為 online pure exploration，以較少 samples 達成指定 confidence 的 causal discovery。
   - Limitation: 主要目標是 graph discovery，而非直接修復 Agent action certificate。

3. **Causal Discovery by Interventions via Integer Programming** — Elrefaey, Pan, AAAI 2025。
   - URL: https://ojs.aaai.org/index.php/AAAI/article/view/33810
   - Contribution: 用 integer programming 設計 minimal intervention sets，使 causal structure 可識別。
   - Limitation: 側重 causal graph identification，不處理 downstream decision regret 與 action side effects。

4. **Value of Information under Imprecise Probabilities: Decision-Rule-Specific Values and Fixed-Measure Envelopes on a Credal Set** — Rowan Iskandar, 2026。
   - URL: https://arxiv.org/abs/2607.06570
   - Contribution: 在單一 probability measure 無法被識別、只能得到 credal set 時，區分 rule-specific VOI 與 fixed-measure VOI envelope。
   - Limitation: 本身不提供 Agent-specific intervention runtime 或 causal conflict-core extraction。

5. **Core-Guided Minimal Correction Set and Core Enumeration** — Narodytska, Bjørner, Marinescu, Sagiv, IJCAI 2018。
   - URL: https://www.ijcai.org/Proceedings/2018/188
   - Contribution: 同時抽取 minimal unsatisfiable cores 與 correction sets；這對 Hermes 將「衝突來源」與「最小修復」分開非常重要。

6. **Exact duals and short certificates of infeasibility and weak infeasibility in conic linear programming** — Liu, Pataki, 2015。
   - URL: https://arxiv.org/abs/1507.00290
   - Contribution: 指出一般 conic LP 中普通 Lagrange dual / Farkas 型證明可能不足，並建立更精確的 infeasibility / weak-infeasibility certificates。
   - Limitation: Hermes 多數 constraint systems 不一定是純 LP / cone program，需依 solver family 選 certificate。

---

# 本小時最重要 5 個發現

## 1. Unsat Core ≠ Minimal Conflict Core

### 是什麼

若 Hermes 有 constraints：

```text
C1: Γ ≤ 1.3
C2: proxy exclusion residual ≤ .05
C3: Λ ≤ 1.1
C4: state effect ≥ .24
C5: proximal effect ≤ .18
```

solver 回傳：

```text
UNSAT core = {C1,C2,C3,C4,C5}
```

不代表五條都是必要的。

真正需要的是 deletion-minimal conflict core：

```text
MUS = {C2,C4,C5}
```

即任何一條移除後，剩餘集合會重新 satisfiable。

### Bottom-level mechanism

PySAT 的 `examples/musx.py` 實際做：

```text
1. 對全部 soft constraints 加 selector literals
2. SAT solve(all selectors)
3. 若 UNSAT → oracle.get_core()
4. core 當 over-approximation
5. 對每個 constraint ci：
      test = core - {ci}
      若 test 仍 UNSAT：永久刪掉 ci
      若 test SAT：保留 ci
6. 回傳 deletion-minimal MUS
```

這不是抽象說法；PySAT 原始碼中的 `_compute()` 就逐一產生 `to_test`，再以 `oracle.solve(assumptions=to_test)` 決定刪除或保留。

### 為什麼重要

LLM 如果看到五條相衝突 assumptions，容易產生語意上「看起來合理」的 explanation；但這不是 machine-checkable proof。

Hermes 應分開：

```text
SolverUnsatCore
↓
CoreMinimizer
↓
MinimalConflictCore
↓
NaturalLanguageExplanation
```

LLM 只能放在最後一層。

### 限制

- deletion-minimal 不等於 minimum-cardinality；可能存在另一個更小的 MUS。
- 一個 system 可能有很多 MUS。
- SMT solver 預設 core 不一定 minimal；Z3 官方程式指南也明確說明 unsat core 不保證 minimal。

### 來源

- PySAT MUSX source: https://github.com/pysathq/pysat/blob/master/examples/musx.py
- Z3 Programming: https://z3prover.github.io/papers/programmingz3.html
- PySAT docs: https://pysathq.github.io/docs/html/api/examples/musx.html

---

## 2. Conflict Core ≠ Repair Set；真正要執行的是 MCS / Minimal Correction Set

### 是什麼

MUS 回答：

> 哪些 assumptions 一起構成無法共同成立的核心？

MCS 回答：

> 最少撤回 / 放寬哪些 assumptions，可以讓整體重新 satisfiable？

例如：

```text
MUS_1 = {proxy_valid, state_lower_bound, proximal_upper_bound}
MUS_2 = {transport_stable, state_lower_bound, proximal_upper_bound}
```

可能的 MCS：

```text
{state_lower_bound}
```

或：

```text
{proxy_valid, transport_stable}
```

### Bottom-level mechanism

PySAT `examples/mcsls.py` 的 BLS/CLD implementation：

```text
Hard constraints
+
Soft assumptions with selectors
↓
Solve hard part
↓
Current model partitions soft constraints into
  satisfied assumptions
  unsatisfied candidates
↓
逐個嘗試 enable candidate
├ SAT   → 留在 satisfiable side
└ UNSAT → 標成 backbone of correction
↓
得到 MCS
↓
block(MCS)
↓
enumerate next MCS
```

### Hermes 映射

```text
MCS element              → possible repair
------------------------------------------------
proxy_validity            → revalidate / replace proxy
Gamma envelope            → widen Γ or collect benchmark
transport assumption      → collect target-domain evidence
state constraint          → refine state partition
bridge fit                → refit h/q bridge
policy-version equality   → split by policy version
```

### 為什麼重要

如果只知道 conflict core，Hermes 還不知道下一步要改哪一條 assumptions。

MCS enumeration 可產生多個 candidate repair plans，再交給成本 / side-effect / VOI layer 排序。

### 新節點

```text
MinimalCorrectionSet
EvidenceRepairCandidate
RepairCardinality
RepairCost
RepairSideEffect
RepairCoverage
MUS-MCS Duality
```

### 來源

- PySAT MCSls source: https://github.com/pysathq/pysat/blob/master/examples/mcsls.py
- Core-Guided Minimal Correction Set and Core Enumeration: https://www.ijcai.org/Proceedings/2018/188

---

## 3. 對連續 causal bounds，Hermes 需要 Dual Infeasibility Certificate，而不只是 solver.status = infeasible

### 是什麼

若 evidence reconciliation 是 linear inequalities：

```text
Aθ ≤ b
θ ≥ 0
```

Farkas' Lemma 告訴我們二者恰有其一成立：

```text
(A) ∃ θ satisfying Aθ ≤ b, θ ≥ 0
```

或存在 certificate `y`：

```text
y ≥ 0
yᵀA ≥ 0
yᵀb < 0
```

因此 `y` 本身就是一個可被獨立驗證的 infeasibility proof。

### 為什麼比 status 好

錯誤做法：

```text
optimizer says INFEASIBLE
↓
Hermes 顯示：evidence conflict
```

正確做法：

```text
optimizer says INFEASIBLE
↓
extract dual ray / Farkas certificate
↓
independent checker 驗證 certificate
↓
map non-zero multipliers back to assumptions
↓
得到 machine-checkable conflict explanation
```

### 新資料結構

```text
InfeasibilityCertificate
├ solver_family
├ primal_status
├ certificate_kind
│  ├ UNSAT_CORE
│  ├ MUS
│  ├ FARKAS_DUAL_RAY
│  ├ EXACT_CONIC_CERTIFICATE
│  └ UNKNOWN
├ constraint_ids[]
├ multipliers[]
├ verification_residual
├ numerical_tolerance
├ exact_or_float
└ independently_verified
```

### 重要限制

普通 LP 的 Farkas certificate 很乾淨，但 conic / semidefinite systems 存在 weak infeasibility；Liu & Pataki 指出一般 conic LP 的普通 Lagrange dual 不一定能產生 exact infeasibility proof。

因此新增：

```text
SolverInfeasible
≠
CertificateVerifiedInfeasible
```

以及：

```text
NumericallyInfeasible
≠
StructurallyContradictory
```

### 來源

- CGAL solution certificates / Farkas lemma: https://doc.cgal.org/5.1.3/QP_solver/index.html
- Liu & Pataki: https://arxiv.org/abs/1507.00290

---

## 4. Assumption Pressure 不應只是 heuristic；可以由 Repair Cost + Dual Signal 共同形成

### 問題

上一輪已提出：

```text
AssumptionPressure(proxy) = .81
```

但 `.81` 從哪裡來尚未完全定義。

### 本輪建模

對 constraint `i` 建立：

```text
pressure_i =
  α * normalized_dual_magnitude_i
+ β * MUS_frequency_i
+ γ * MCS_frequency_i
+ δ * minimal_relaxation_gain_i
+ ε * downstream_decision_sensitivity_i
```

其中：

```text
MUS_frequency_i
= constraint i 出現在多少個 conflict cores

MCS_frequency_i
= constraint i 出現在多少個 minimal repairs

minimal_relaxation_gain_i
= 每單位 assumption relaxation 可恢復多少 feasible volume
```

### 解讀

高 dual multiplier：這條 constraint 對目前 infeasibility 很「緊」。

高 MUS frequency：很多矛盾都反覆牽涉它。

高 MCS frequency：很多最小修復方案都會動到它。

高 decision sensitivity：放寬它會真正改變 Planner action，而不是只改幾何邊界。

### 重要否定關係

```text
Large Dual Multiplier
≠
Assumption False
```

dual 只表示在目前 optimization geometry 中，該 constraint 對 infeasibility / objective 很敏感，不等於它語義上錯誤。

因此 UI 應寫：

```text
HIGH REPAIR PRESSURE
```

不能寫：

```text
LIKELY FALSE
```

---

## 5. Verification Selection 應從「最大資訊量」升級為 Interventional Evidence-Repair VOI

### 問題

典型 Bayesian experimental design 選：

```text
q* = argmax EIG(q)
```

GO-CBED 已比普通 causal discovery 更進一步：它讓 EIG 對「指定 causal query」而不是完整 graph 最大化，並用 transformer policy 規劃 intervention sequence。

但 Hermes 的目標仍不同。

Hermes 真正要選的是：

```text
哪個 verification / experiment
最可能修掉目前 decision-relevant conflict？
```

### 新公式

對 verification `q`：

```text
RepairVOI(q)
=
Expected[MUS reduction]
+
Expected[MCS cost reduction]
+
Expected[identified-set contraction]
+
Expected[worst-case decision-regret reduction]
+
Expected[certificate recovery]
+
Expected[world-search coverage gain]
-
monetary cost
-
latency cost
-
privacy cost
-
side-effect cost
-
intervention-induced state drift
```

若 probability measure 本身只能識別到一個 credal set `P ∈ K`，則計算：

```text
LowerRepairVOI(q)
= min_{P ∈ K} RepairVOI(q; P)

UpperRepairVOI(q)
= max_{P ∈ K} RepairVOI(q; P)
```

Planner 對高風險 external action 應偏向：

```text
argmax_q LowerRepairVOI(q)
```

而不是 nominal EIG 最大。

### Interventional complication

verification 可能本身改變環境：

```text
ASK_USER
→ 使用者回答
→ user state 改變
→ future policy state 改變
```

因此不能用 passive VOI：

```text
P(new evidence | current world)
```

必須至少概念上建模：

```text
P(new evidence,
  post-intervention state
  | do(q), history)
```

### 來源

- GO-CBED: https://arxiv.org/abs/2507.07359
- Adaptive Online Experimental Design: https://proceedings.mlr.press/v235/elahi24a.html
- Imprecise VOI: https://arxiv.org/abs/2607.06570

---

# Architecture Breakdown

## Evidence-Repair Causal Runtime

```text
User / Goal
↓
Agent State H_t
↓
Candidate Actions
↓
Causal Evidence Registry
├ MSM Γ constraints
├ Proximal bridge constraints
├ Info-theoretic bounds
├ State constraints
├ Transport Λ constraints
├ Negative controls
└ Mechanism tests
↓
Scope / Estimand Alignment
↓
Constraint Compiler
├ Boolean / SMT constraints
├ Linear inequalities
├ Nonlinear constraints
└ Statistical confidence objects
↓
Feasibility Router
├ SAT / SMT Solver
├ LP / Convex Solver
├ Nonlinear Solver
└ Statistical Compatibility Test
↓
if FEASIBLE
│  ↓
│ Compatible-World Set
│  ↓
│ Robust Planner
│
└ if INFEASIBLE
   ↓
 Certificate Extractor
 ├ Unsat core
 ├ MUS minimizer
 ├ Dual / Farkas ray
 └ Numerical diagnostic
   ↓
 Independent Certificate Verifier
   ↓
 Conflict Core Enumerator
   ↓
 MCS / Repair Enumerator
   ↓
 Assumption Pressure Engine
   ↓
 Verification Candidate Generator
   ↓
 Interventional Repair-VOI
   ↓
 Verification / Experiment / Human Review
   ↓
 New evidence
   ↓
 Recompile constraints
   ↓
 Certificate repaired?
   ↓
 Robust Planner Gate
```

---

# Bottom-Level Logic

## A. MUS extraction

```text
core ← unsat_core(C)
for c in core:
    if UNSAT(core \ {c}):
        core ← core \ {c}
return core
```

性質：

```text
UNSAT(core)
∀ c ∈ core:
SAT(core \ {c})
```

這叫 inclusion-minimal，不一定是 minimum-cardinality。

## B. MCS

`R ⊆ C` 是 correction set 若：

```text
SAT(C \ R)
```

是 minimal correction set 若：

```text
SAT(C \ R)
且
∀ R' ⊂ R:
UNSAT(C \ R')
```

MUS / MCS 間存在 hitting-set duality；工程上這表示：

```text
衝突核心 enumeration
↔
修復方案 enumeration
```

不是兩個互不相關的問題。

## C. Farkas certificate

對：

```text
Aθ ≤ b
θ ≥ 0
```

若存在：

```text
y ≥ 0
yᵀA ≥ 0
yᵀb < 0
```

則原系統 infeasible。

Verifier 不必重新跑同一 solver；只需檢查上述 inequalities。

這正符合 Hermes 的安全哲學：

```text
Solver Result
≠
Trusted Result

Solver Result
+
Independent Certificate Check
→ Trusted Evidence
```

## D. Minimal repair optimization

```text
min_R
  Σ_i cost_i * 1[i ∈ R]
subject to
  C \ R is satisfiable
```

若 assumption 可連續放寬：

```text
min_δ
  Σ_i repair_cost_i(δ_i)
subject to
  C(δ) is feasible
  δ_i ≥ 0
```

這就是上一輪 `minimal assumption relaxation` 的正式 optimization 版本。

---

# Visual Simulation Idea

## Conflict Core × Evidence Repair Workbench

Hermes Console 新增一個三欄互動視圖。

### 左欄：Evidence Constraint Graph

```text
Γ bound ─────────────┐
Proxy validity ──────┼→ effect θ
Transport Λ ─────────┤
State lower bound ───┤
Proximal upper bound ┘
```

點一下 `CHECK` 後：

```text
STATUS: INFEASIBLE
Certificate: VERIFIED
```

### 中欄：Conflict / Repair Dual View

```text
MUS #1
● Proxy validity
● State lower bound
● Proximal upper bound

MUS #2
● Transport Λ
● State lower bound
● Proximal upper bound
```

切到 Repair：

```text
MCS #1  cost 0.31
○ relax State lower bound

MCS #2  cost 0.67
○ revalidate Proxy
○ revalidate Transport
```

### 右欄：Verification Marketplace

```text
Verification             Lower VOI   Cost   Side effect
-------------------------------------------------------
Read-only MCP check          .62      .08      LOW
Ask user intent              .57      .14      MED
Target-domain replay         .49      .20      LOW
Proxy re-measurement         .44      .17      LOW
Real write probe             .11      .36      HIGH
```

### 最關鍵的互動

點 `Read-only MCP check` 後，畫面模擬：

```text
Before
Joint set = ∅
MUS count = 4
Worst-case regret = .38

After possible PASS
Joint set = non-empty
MUS count = 0
Worst-case regret = .09

After possible FAIL
Proxy assumption removed
MUS count = 1
Worst-case regret = .16
```

這比只顯示「信心 72%」更能讓不懂因果推論的人看懂 Agent 為何要查這一件事。

---

# Code / GitHub

## 1. PySAT — MUSX

Repository:
https://github.com/pysathq/pysat

值得讀：

```text
examples/musx.py
pysat/solvers.py
pysat/formula.py
```

核心檔案 `examples/musx.py`：

```text
compute()
  → solve(all selectors)
  → get_core()
  → _compute(core)

_compute()
  → remove one selector
  → solve(remaining assumptions)
  → keep/remove constraint
```

直接對應 Hermes `ConflictCoreMinimizer`。

## 2. PySAT — MCSls

值得讀：

```text
examples/mcsls.py
```

核心：

```text
compute()
_overapprox()
_compute()
do_cld_check()
enumerate()
block()
```

直接對應 Hermes `EvidenceRepairEnumerator`。

## 3. Z3

官方 Programming Z3 說明：

```text
assert_and_track()
check()
unsat_core()
```

可把每一條 assumption / evidence constraint 都掛 tracking literal；但官方同時提醒一般 unsat core 不保證 minimal，因此 Hermes 仍需 core minimization layer。

URL:
https://z3prover.github.io/papers/programmingz3.html

## 4. vsOED / Deep Adaptive Design

Repositories:

- https://github.com/wgshen/vsOED
- https://github.com/ae-foster/dad

值得借鑑的不是 causal certificate 本身，而是：

```text
sequential experimental design
↓
amortized policy
↓
不用每次從零 optimize 下一個 experiment
```

Hermes 未來可把 Repair-VOI policy 也 amortize 成 verification router。

---

# Papers

## Paper A

**Title:** Goal-Oriented Sequential Bayesian Experimental Design for Causal Learning  
**Authors:** Zheyu Zhang, Jiayuan Dong, Jie Liu, Xun Huan  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2507.07359  
**Architecture:** transformer policy + variational EIG bound + normalizing-flow posterior  
**Dataset / Evaluation:** synthetic structural causal models + semi-synthetic gene regulatory networks  
**Contribution:** 用 goal-oriented EIG 直接針對 causal quantity 選 intervention，並做 non-myopic sequential planning。  
**Limitations:** information gain 最大不保證 decision repair 最大；model misspecification / side-effect cost 仍需額外建模。  
**改變了什麼:** 把 experiment selection 從「學完整世界」拉向「只學現在目標需要知道的世界」。

## Paper B

**Title:** Adaptive Online Experimental Design for Causal Discovery  
**Authors:** Muhammad Qasim Elahi, Lai Wei, Murat Kocaoglu, Mahsa Ghasemi  
**Institution:** University of Wisconsin–Madison / Purdue 等  
**Year:** 2024  
**URL:** https://proceedings.mlr.press/v235/elahi24a.html  
**Architecture:** graph separating systems + adaptive intervention allocation + track-and-stop  
**Contribution:** 給定 confidence 後，自適應選 intervention 並自動決定何時停止。  
**Limitations:** 目標是 causal graph correctness，而非 Agent downstream action certificate。  
**改變了什麼:** verification 不需要固定 sample budget；可以由 evidence sufficiency 決定 stop time。

## Paper C

**Title:** Causal Discovery by Interventions via Integer Programming  
**Authors:** Abdelmonem Elrefaey, Rong Pan  
**Institution:** Arizona State University  
**Year:** 2025  
**URL:** https://ojs.aaai.org/index.php/AAAI/article/view/33810  
**Architecture:** integer-programming intervention-set optimization  
**Contribution:** 找使 causal structure identifiable 的 minimal intervention sets。  
**Limitations:** 不直接最佳化 decision regret / action safety。  
**改變了什麼:** 「下一步查什麼」本身可以是 combinatorial optimization problem。

## Paper D

**Title:** Value of Information under Imprecise Probabilities: Decision-Rule-Specific Values and Fixed-Measure Envelopes on a Credal Set  
**Author:** Rowan Iskandar  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2607.06570  
**Contribution:** 當 probability measure 只有 set-valued identification 時，VOI 本身也應是 set / envelope，且 rule-specific VOI 與 fixed-measure envelope 不相同。  
**Limitations:** 尚未專門處理 agentic verification intervention 對 world state 的副作用。  
**改變了什麼:** Hermes 不能在 unidentified worlds 下只回傳一個 verification VOI scalar。

## Paper E

**Title:** Exact duals and short certificates of infeasibility and weak infeasibility in conic linear programming  
**Authors:** Minghui Liu, Gabor Pataki  
**Year:** 2015  
**URL:** https://arxiv.org/abs/1507.00290  
**Contribution:** 對 conic LP 建立 exact duals 與短 infeasibility / weak-infeasibility certificates。  
**Limitations:** 工程 integration 複雜，且不同 constraint classes 需不同證明物件。  
**改變了什麼:** solver 的 `infeasible` 狀態不能一概視為等價；certificate family 必須跟 constraint geometry 對齊。

---

# Unknown / Open Questions

## 1. Statistical evidence 如何編譯成「不會過度硬化」的 constraint？

例如 95% confidence interval：

```text
θ ∈ [.2,.4]
```

不能直接永遠當 hard constraint，否則兩個 finite-sample CI 偶然不相交，就會被誤標 structural contradiction。

需要：

```text
Hard identification constraint
vs
Stochastic confidence constraint
vs
Diagnostic warning
```

不同 solver semantics。

## 2. 多個 MUS / MCS 很多時，如何只呈現 decision-relevant cores？

真實 evidence graph 可能產生數千個 cores。

需要：

```text
core relevance
=
repair cost
× action-flip sensitivity
× provenance priority
× verification tractability
```

而不是全部顯示。

## 3. Verification action 本身造成 state transition 時，RepairVOI 如何避免 self-invalidating experiment？

例如：

```text
ASK_USER
```

取得資訊同時也改變使用者決策，因此原本要估的 counterfactual world 已不存在。

這需要：

```text
pre-intervention estimand
post-intervention estimand
measurement-only query
state-changing query
```

明確分離。

---

# 下一輪研究

下一輪最值得追：

# **Statistical Constraint Semantics × Confidence-Set Conflict × Multiple Testing × Sequential Evidence Repair**

目前 pipeline：

```text
Causal evidence
↓
constraint compiler
↓
MUS / Farkas / MCS
```

下一個危險是把「統計不確定性」誤當「邏輯矛盾」。

下一輪應深入：

```text
Confidence set
Credible set
Conformal set
Partial identified set
Sensitivity set
Hard structural constraint
↓
Typed Constraint Semantics
↓
Joint compatibility under finite sample
↓
Multiple-testing / repeated-check correction
↓
Sequential certificate update
↓
Conflict persistence test
↓
Only persistent structural conflicts trigger repair
```

重點問題：

1. CI 不相交要在什麼條件下才叫 evidence conflict？
2. Agent 每小時重複檢查 constraints，false conflict rate 會不會累積？
3. 如何將 e-values / anytime-valid inference / confidence sequences 接入 long-running Agent？
4. 如何讓 certificate 在 data stream 上持續有效，而不是每次新增 observation 就重新解釋 p-value？

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Solver Unsat Core
Minimal Unsatisfiable Subset
Minimum-Cardinality Unsat Core
Minimal Correction Set
Correction Set Enumeration
MUS-MCS Duality
Conflict Core Enumerator
Evidence Repair Enumerator
Deletion-Based Core Minimization
Selector Literal
Tracked Assumption
Dual Infeasibility Certificate
Farkas Certificate
Dual Ray
Exact Conic Certificate
Weak Infeasibility
Certificate Verifier
Repair Cost
Repair Cardinality
Repair Coverage
Assumption Pressure
Dual Pressure
MUS Frequency
MCS Frequency
Repair VOI
Interventional Repair VOI
Repair VOI Envelope
Goal-Oriented Verification
Verification Stop Rule
Conflict Persistence
```

## 新增 Edges

```text
Unsat Core
→ overapproximates
Minimal Conflict Core

Minimal Conflict Core
↔ hitting-set dual
Minimal Correction Set

Dual Ray
→ certifies
Linear Infeasibility

Minimal Correction Set
→ proposes
Evidence Repair

Evidence Repair
→ changes
Compatible World Set

Interventional Verification
→ can_change
Agent State

Repair VOI
→ prioritizes
Verification Action
```

## 新增否定關係

```text
Unsat Core ≠ Minimal Unsat Core
Minimal Unsat Core ≠ Minimum-Cardinality Core
Conflict Core ≠ Repair Set
Solver Infeasible ≠ Certificate-Verified Infeasible
Large Dual Multiplier ≠ Assumption False
Numerical Infeasibility ≠ Structural Contradiction
Information Gain ≠ Decision Repair Value
Passive VOI ≠ Interventional Repair VOI
One MUS ≠ Complete Conflict Explanation
One MCS ≠ Unique Repair
```

---

# 本輪結束回答

**缺哪一層？**  
目前最缺的是 **Typed Statistical Constraint Semantics**：Hermes 已能處理 logical/optimization conflict，但還必須區分 finite-sample disagreement、structural contradiction 與 numerical infeasibility。

**哪個節點最淺？**  
`AssumptionPressure`、`RepairVOIEnvelope`、`ConflictPersistence`、`CertificateVerifier` 的 production contract 仍最淺。

**哪個概念仍只是名詞？**  
`Decision-Relevant MUS Enumeration` 與 `Interventional Repair VOI` 目前仍主要是 Hermes architecture concept，尚未有完整現成框架可直接搬入。

**哪個系統值得讀原始碼？**  
PySAT `examples/musx.py` 與 `examples/mcsls.py`；下一步應再追其 hitting-set / MUS enumeration implementations，並對比 Z3 的 tracked assumptions / unsat-core path。

**哪篇論文需追引用？**  
`Goal-Oriented Sequential Bayesian Experimental Design for Causal Learning`，因為它最接近「不要學完整世界，只買與當前決策目標有關的資訊」；以及 Liu & Pataki 的 exact infeasibility certificate 工作，用來避免錯信 solver status。

**哪個概念最適合視覺模擬？**  
`Conflict Core × Evidence Repair Workbench`：同時把 MUS、MCS、dual pressure、verification VOI 與 repaired certificate 放在一個可互動視圖。

**哪個 Agent 架構最值得實作？**  

```text
Certificate-Backed Evidence Repair Agent
=
Typed Constraint Compiler
+
Solver Router
+
MUS / Dual Certificate Extractor
+
Independent Certificate Verifier
+
MCS Repair Enumerator
+
Interventional Repair-VOI Router
+
Robust Planner Gate
```

---

# 本輪對「AI 到底怎麼運作」補上的層

以前的 Agent loop：

```text
User
→ Context
→ Reasoning
→ Plan
→ Tool
→ Observation
→ Next action
```

目前逐步補成：

```text
User
→ Context / Memory / Multimodal observations
→ Causal state
→ Candidate actions
→ Evidence sets
→ Constraint compiler
→ Feasibility solver
→ Machine-checkable conflict certificate
→ Minimal conflict core
→ Minimal repair options
→ Interventional value of verification
→ Buy the most decision-relevant evidence
→ Repair causal certificate
→ Robust planner gate
→ Tool / MCP / browser / human action
→ World changes
→ New evidence
```

本輪最核心的結論是：

> **成熟 Agent 不能只說「我的證據互相衝突」。它必須能產生一個可驗證的衝突證明，指出哪個最小 assumption 集合無法共同成立，列出最少要改動哪些 assumptions 才能修復，再根據 decision regret、成本、副作用與可識別性，決定下一個真正值得執行的 verification。這把 AI reasoning 從文字解釋推進到 solver-backed evidence repair。**
