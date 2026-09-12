# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-13 05:51（Asia/Taipei）  
**本輪主題**：Typed Statistical Evidence Semantics × Confidence Sequence × E-Process × Sequential Causal Effect × Conflict Semantics × Anytime-Valid Evidence Runtime  
**承接上一輪**：`2026-09-13-conflict-core-dual-certificate-interventional-voi-evidence-repair.md`

---

# 0. 與歷史研究比較：本輪不重複什麼

Hermes 歷史研究已經有：

```text
Repeated Peeking
→ Anytime-Valid Inference
→ E-Value / E-Process
→ Confidence Sequence
→ Sequential Rollout Gate
```

也已經有：

```text
Cluster / Markov / Multi-way Dependence
→ Filtration Registry
→ Evidence Validity Runtime
```

以及上一輪：

```text
Evidence Constraints
→ Feasibility Solver
→ UNSAT / Infeasible
→ MUS / MCS
→ Evidence Repair
```

所以本輪**不再重講「e-value 可以 optional stopping」**，而是處理上一輪真正留下的缺口：

> Solver 看到的每個「區間 / 集合 / p-value / e-value / posterior / conformal set」到底是哪一種語意？哪些可以硬交集？哪些只能作 stochastic evidence？哪些只是在 falsify 某個 assumption？什麼情況下兩個 95% intervals 不相交只是抽樣波動，而不是 structural contradiction？

本輪目標：建立 Hermes 的 **Typed Statistical Evidence Runtime**。

---

# 1. 本小時新發現

## 1.1 新論文：Confidence intervals for causal effects in sequential decision making

- **Title**: Confidence intervals for causal effects in sequential decision making
- **Authors**: Vladimir Vovk, Ruodu Wang
- **Year**: 2026
- **Version**: v2, 2026-06-25
- **URL**: https://arxiv.org/abs/2605.25687
- **Code**: 未找到官方 code
- **Dataset**: 理論工作，無固定 benchmark dataset
- **Architecture / setting**: causal DAG + back-door adjustment + adaptive interventions + sequential observations
- **Contribution**: 對 causal effect 建立 confidence intervals / confidence sequences；當 intervention 可依 past data 自適應時，interval 會付出 law-of-iterated-logarithm（LIL）型 penalty；未知 horizon 的真正 sequential setting 會再增加 time-uniform penalty。
- **Limitations**: 需要適用的 causal identification criterion；confidence validity 不等於 identification assumptions 已被驗證。
- **改變了什麼**: Hermes 不能把「同樣標 95%」的 fixed-horizon CI 與 confidence sequence 視為同一 constraint type。

## 1.2 2026 JRSSB：Anytime validity is free

- **Title**: Anytime validity is free: inducing sequential tests
- **Authors**: Nick W. Koning, Sam van Meer
- **Institution**: Erasmus University Rotterdam
- **Year**: 2026
- **Published**: 2026-02-21
- **URL**: https://doi.org/10.1093/jrsssb/qkag050
- **Contribution**: 給定最大 horizon N，可把 terminal valid test sequentialize，且在 N 時匹配原 test；核心表示是 terminal test outcome 在目前 filtration 下的 conditional expectation。
- **重要細節**: anytime validity 並不只屬於 e-value paradigm；因此 Hermes 的 type system 應根據「validity contract」，不是根據 UI 上寫的是 p / e / interval。
- **Limitation**: terminal horizon 與 null model structure仍是重要條件；不是任意 adaptive ML pipeline 都自動 valid。

## 1.3 2026：E-values for Adaptive Clinical Trials

- **Authors**: Alexandra Sokolova, Vadim Sokolov
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2602.06379
- **Code**: https://github.com/VadimSokolov/evalinger
- **Contribution**: 將 e-value / e-process 作成 continuous-monitoring workflow，處理 optional stopping / continuation，並與 group sequential / Bayesian adaptive workflow 比較。
- **工程價值**: repository 把 `betting.R`, `confseq.R`, `monitor.R`, `platform.R`, `futility.R`, `calibrate.R` 分層，接近 production sequential-evidence engine，而不是只有論文公式。

## 1.4 經典但本輪必要的底層來源：Time-uniform confidence sequences

- **Title**: Time-uniform, nonparametric, nonasymptotic confidence sequences
- **Authors**: Steven R. Howard, Aaditya Ramdas, Jon McAuliffe, Jasjeet Sekhon
- **Venue**: Annals of Statistics
- **Year**: 2021
- **URL**: https://arxiv.org/abs/1810.08240
- **Code**: https://github.com/gostevehoward/confseq
- **Contribution**: 建立 time-uniform CS、mixture/stitching boundaries 與非負 supermartingale 技術。
- **本輪用途**: 不重複理論，而是直接拆 code，確認 Hermes 統計 evidence runtime 應如何從 process → threshold → inverted set。

## 1.5 Agent 直接相關：Anytime-valid Off-policy Inference

- **Title**: Anytime-valid off-policy inference for contextual bandits
- **Authors**: Aaditya Ramdas, Ian Waudby-Smith, Lili Wu, Nikos Karampatziakis, Paul Mineiro
- **Year**: 2022
- **URL**: https://arxiv.org/abs/2210.10768
- **Architecture**: adaptive logging policy + contextual bandit + martingale OPE inference
- **Contribution**: logging policy 可變、context distribution 可具時間依賴時，仍建立 anytime-valid OPE confidence sequences，包括 doubly-robust functionals。
- **Agent relevance**: Agent rollout / tool-routing / policy-version evaluation 本質上就是 adaptive policy evaluation。

---

# 2. 本小時最重要 5 個發現

## 發現 1：`95% interval` 不是一種 evidence type

### 已確認事實
以下東西 UI 都可能畫成：

```text
[lower, upper]
```

但語意完全不同：

```text
Fixed-Horizon Confidence Interval
Confidence Sequence
Bayesian Credible Interval
Conformal Prediction Set
Partial Identified Set
Sensitivity Bound
Optimization Feasible Set
```

### 底層差異

#### Fixed-horizon CI
大致保證：

```text
P(theta ∈ CI_n) ≥ 1 - alpha
```

在預先指定 n 的 repeated sampling 意義成立。

#### Confidence Sequence
要求：

```text
P(∀t ≥ 1: theta ∈ CS_t) ≥ 1 - alpha
```

因此可以：

```text
任意看 dashboard
→ data-dependent stopping
→ interval 仍維持 coverage contract
```

#### Partial Identified Set
不是「抽樣不確定性」，而是：

```text
即使 population distribution 已完全知道
仍可能有多個 theta 與 assumptions 相容
```

#### Bayesian Credible Set
依賴：

```text
prior + likelihood + posterior semantics
```

其 `95%` 不是自動等同 frequentist 95% coverage。

### Hermes runtime 必須新增

```text
StatisticalEvidenceType
├ FIXED_HORIZON_CI
├ CONFIDENCE_SEQUENCE
├ E_VALUE
├ E_PROCESS
├ P_VALUE
├ P_PROCESS
├ BAYESIAN_CREDIBLE_SET
├ CONFORMAL_PREDICTION_SET
├ IDENTIFIED_SET
├ SENSITIVITY_SET
├ OPTIMIZATION_FEASIBLE_SET
├ FALSIFICATION_RESULT
└ MODEL_DIAGNOSTIC
```

### 關鍵否定

```text
Same Numeric Shape
≠
Same Statistical Semantics
```

---

## 發現 2：Confidence Sequence 的本體不是「一直重算 CI」，而是 time-uniform evidence inversion

`gostevehoward/confseq` 的 source code 很值得 Hermes 借鑑。

在 `src/confseq/uniform_boundaries.h`，核心抽象是：

```text
MixtureSupermartingale
├ log_superMG(s,v)
├ s_upper_bound(v)
└ bound(v, log_threshold)
```

並有：

```text
OneSidedNormalMixture
TwoSidedNormalMixture
GammaExponentialMixture
GammaPoissonMixture
BetaBinomialMixture
PolyStitchingBound
```

這顯示真正 architecture 是：

```text
streaming sufficient statistics
↓
nonnegative supermartingale / mixture process
↓
uniform boundary
↓
invert rejected null values
↓
confidence sequence
```

而 `betting.py` 更直接：

```text
multiplicand_t
= 1 + lambda_t (X_t - mu_t)

capital_t
= Π multiplicand_i
```

其中 `lambda_t` 必須依 past information 選擇；之後 `betting_cs()` 使用 `cs_from_martingale()` 把一組 candidate means `m` 的 martingale test 反演成 lower/upper confidence sequence。

### Hermes implication

Statistical evidence 不應只存：

```text
lower
upper
confidence = .95
```

而應存：

```text
EvidenceProcessCertificate
├ process_type
├ null_family
├ filtration_id
├ update_rule
├ predictability_contract
├ threshold_rule
├ stopping_validity
├ continuation_validity
├ dependence_scope
├ horizon_scope
└ inversion_method
```

---

## 發現 3：一個 interval conflict 必須先分成 Structural / Statistical / Sequential 三層

假設：

```text
Evidence A: [0.10, 0.30]
Evidence B: [0.35, 0.50]
```

上一輪 solver 若直接做：

```text
intersection = empty
→ UNSAT
```

可能錯得很嚴重。

### Case A：兩個都是 hard identified sets

若兩者都是同一 estimand、同一 population、同一 time、同一 causal model 下的**population-level logical constraints**：

```text
empty intersection
→ 真正 structural incompatibility
```

### Case B：兩個都是普通 95% CIs

```text
empty intersection
```

只代表目前抽樣 realization 的 intervals 不重疊；不能直接推出 structural contradiction。

### Case C：一個是 fixed CI，一個是 CS

如果 runtime 持續監測，fixed CI 在 repeated peeking 後已不具原 validity contract；此時 solver 甚至不該先比較區間，而應先把 evidence 標成：

```text
VALIDITY_BREACH
```

### Case D：一個是 sensitivity set，一個是 confidence set

這兩者維度不同：

```text
Sensitivity set
= assumption / identification uncertainty

Confidence set
= sampling uncertainty
```

合理 composition 更像：

```text
Union / envelope over allowed sensitivity assumptions
+
statistical uncertainty within each assumption
```

而不是 naïve set intersection。

### 新 conflict taxonomy

```text
EvidenceConflictKind
├ STRUCTURAL_CONTRADICTION
├ FINITE_SAMPLE_DISAGREEMENT
├ ANYTIME_VALIDITY_BREACH
├ ESTIMAND_MISMATCH
├ POPULATION_MISMATCH
├ TEMPORAL_SCOPE_MISMATCH
├ FILTRATION_MISMATCH
├ IDENTIFICATION_VS_SAMPLING_MIXUP
├ MODEL_ASSUMPTION_CONFLICT
└ NUMERICAL_OPTIMIZATION_FAILURE
```

---

## 發現 4：Sequential causal effect 比一般 sequential mean 多一層「adaptive intervention penalty」

Vovk & Wang 2026 的重要點不是只說「可以做 causal CS」，而是：

```text
IID fixed intervention
→ tightest setting

intervention depends on past data
→ wider interval + LIL penalty

unknown stopping horizon
→ confidence sequence + additional time-uniform penalty
```

也就是 Agent 的 causal monitoring 有兩種 adaptivity：

```text
A. 何時停止看資料？
B. 下一步做什麼 intervention / verification？
```

Hermes 過去主要處理 A；這輪正式把 B 放進 Evidence Type Contract。

### Agent 例子

```text
Agent observes failures
↓
increases ASK_USER verification
↓
changes future data distribution
↓
continues monitoring success effect
```

這不是單純 optional stopping。

而是：

```text
adaptive treatment / intervention assignment
+
sequential inference
```

### 新 Node

```text
AdaptiveInterventionEvidenceContract
├ intervention_policy
├ intervention_propensity
├ filtration
├ causal_identification_rule
├ adaptive_penalty
├ horizon_mode
└ time_uniform_validity
```

---

## 發現 5：E-process 的工程底層非常適合 Agent Runtime，但 predictability contract 必須 first-class

`VadimSokolov/evalinger/R/betting.R` 直接實作：

```text
D_i = X_i^T - X_i^C

E_n
= Π_i [1 + lambda_i D_i]
```

再用：

```text
log_evalue = cumulative sum(log increment)
threshold  = log(1/alpha)
first crossing → rejection_time
```

這是非常 production-friendly 的形式：避免直接乘積 overflow，用 log wealth 累積；threshold crossing 可以 O(1) streaming update。

但最關鍵的是：

```text
lambda_i
```

必須 predictable，也就是在看到第 i 筆新 outcome 之前由 past information 決定。

因此：

```text
Adaptive Bet
≠
Use Current Outcome To Pick Bet
```

如果 Hermes 的 LLM verifier 看完當前 observation 後才「回頭」挑最有利的 betting fraction，martingale/e-process validity 可能直接失效。

### Agent Runtime 新規則

```text
Evidence Update t
↓
freeze F_{t-1}
↓
choose lambda_t / test action
↓
receive observation O_t
↓
update evidence E_t
↓
append immutable provenance
```

而不是：

```text
receive O_t
↓
LLM 找最好看的 lambda_t
↓
update evidence
```

---

# 3. Architecture Breakdown

本輪建議 Hermes 新增：

# Typed Statistical Evidence Runtime

```text
Agent / Tool / MCP / Multimodal Event Stream
↓
Observation Provenance
↓
Filtration Registry
↓
Evidence Compiler
│
├ Identification Layer
│  ├ Identified Set
│  ├ Sensitivity Set
│  └ Structural Constraint
│
├ Frequentist Fixed-Horizon Layer
│  ├ CI
│  ├ p-value
│  └ hypothesis test
│
├ Anytime-Valid Layer
│  ├ e-value
│  ├ e-process
│  ├ confidence sequence
│  └ p-process
│
├ Predictive Layer
│  ├ conformal set
│  └ prediction interval
│
├ Bayesian Layer
│  └ credible set / posterior
│
└ Diagnostic Layer
   ├ falsification test
   └ model diagnostic
↓
Validity Contract Checker
↓
Scope / Estimand Alignment
↓
Conflict Semantics Router
├ Hard feasibility solver
├ Statistical compatibility test
├ Anytime-valid monitor
├ Posterior comparison
└ Diagnostic alarm
↓
Evidence Reconciliation
↓
Planner Gate
```

---

# 4. Bottom-Level Logic

## 4.1 Betting process

對 bounded mean 類問題，可抽象為：

```text
E_t(m)
=
Π_{i=1}^t
[1 + λ_i (X_i - m)]
```

其中：

```text
λ_i ∈ F_{i-1}
```

即 bet 只能依 past filtration 選。

若在 null `m` 下 `E_t(m)` 是 nonnegative supermartingale，則利用 Ville inequality：

```text
P_m(
  sup_t E_t(m) ≥ 1/α
)
≤ α
```

因此 CS 可以由 inversion 得到：

```text
CS_t
=
{m : E_t(m) < 1/α}
```

實際 implementations 可再取 running intersection，使區間單調縮小。

## 4.2 Statistical conflict 不應轉成 binary SAT

對兩個 sampling-based confidence objects：

```text
C_A(data_A)
C_B(data_B)
```

合理 runtime 需要知道：

```text
joint coverage method
multiple-testing budget
independence / dependence
monitoring history
```

才決定能否把：

```text
C_A ∩ C_B
```

當成仍具有某個 coverage guarantee 的新 evidence object。

所以 typed constraint 應攜帶：

```text
StatisticalConstraintContract
├ estimand
├ evidence_type
├ nominal_level
├ guarantee_type
├ horizon
├ stopping_rule
├ monitoring_count
├ filtration
├ dependence_model
├ multiplicity_family
├ provenance
└ validity_status
```

---

# 5. Visual Simulation Idea

# Statistical Evidence Type × Conflict Simulator

Hermes Console 顯示同一組數字：

```text
A = [0.10, 0.30]
B = [0.35, 0.50]
```

讓使用者切換 evidence type：

```text
A type:
○ Fixed 95% CI
○ 95% Confidence Sequence
○ Bayesian 95% Credible Interval
○ Partial Identified Set
○ Sensitivity Bound

B type:
○ ...
```

畫面即時改變判定：

### Scenario 1

```text
A = Hard Identified Set
B = Hard Identified Set

→ STRUCTURAL CONFLICT
→ launch MUS/MCS solver
```

### Scenario 2

```text
A = 95% fixed CI
B = 95% fixed CI

→ STATISTICAL DISAGREEMENT
→ no hard UNSAT
→ inspect sample / multiplicity / dependence
```

### Scenario 3

```text
A = fixed CI
monitoring = 38 peeks

→ VALIDITY BREACH ⚠
→ recompute with anytime-valid method
```

### Scenario 4

```text
A = CS
B = sensitivity set

→ TWO-LAYER UNCERTAINTY
→ show sampling × assumption uncertainty surface
```

### Timeline panel

```text
Evidence wealth
log E_t
│                         ╭── threshold log(1/α)
│                  ╭──────╯
│          ╭───────╯
│____╭─────╯________________ time
     ↑       ↑          ↑
 choose λ   observe     stop
 from F_t-1
```

使用者點擊每個 time step 可看：

```text
filtration snapshot
betting fraction
new observation
log increment
validity check
```

這會讓「為什麼 optional stopping 有時合法、有時不合法」變成可視化機制，而不是統計名詞。

---

# 6. Code / GitHub 深入拆解

## 6.1 `gostevehoward/confseq`

Repository：
https://github.com/gostevehoward/confseq

值得繼續讀：

```text
src/confseq/
├ uniform_boundaries.h
├ boundaries.cpp
├ betting.py
├ betting_strategies.py
├ predmix.py
├ conjmix_bounded.py
└ cs_plots.py
```

### `uniform_boundaries.h`
核心 OO abstraction：

```text
MixtureSupermartingale
├ log_superMG()
├ s_upper_bound()
└ bound()
```

這很適合直接映射 Hermes：

```text
EvidenceProcess
├ update()
├ validity_contract()
├ threshold()
├ invert()
└ certificate()
```

### `betting.py`
值得看的核心：

```text
betting_mart()
betting_cs()
betting_lower_cs()
diversified_betting_mart()
```

`betting_mart()` 具體做：

```text
predictable λ
→ multiplicand
→ cumulative product
→ capital process
```

`betting_cs()` 再透過 martingale inversion 產生 CS。

## 6.2 `VadimSokolov/evalinger`

Repository：
https://github.com/VadimSokolov/evalinger

目錄直接分：

```text
R/
├ betting.R
├ bridge.R
├ calibrate.R
├ compare.R
├ confseq.R
├ futility.R
├ grow.R
├ logrank.R
├ monitor.R
├ platform.R
└ plot.R
```

最值得 Hermes 模仿的是：

```text
statistical primitive
≠ monitoring policy
≠ calibration
≠ platform multiplicity
≠ plotting / explanation
```

不要把全部 evidence logic 寫進 Planner prompt。

---

# 7. Papers

## Paper A
**Confidence intervals for causal effects in sequential decision making**  
Authors: Vladimir Vovk, Ruodu Wang  
Year: 2026  
URL: https://arxiv.org/abs/2605.25687  
Code: 未找到官方 code  
Dataset: 理論  
Architecture: causal DAG + adaptive intervention + sequential inference  
Contribution: causal CI/CS；adaptive intervention 與 unknown horizon 帶來 LIL/time-uniform widening  
Limitation: identification assumptions仍需外部保證  
**改變了什麼**：把 Agent 的「adaptive action」正式接到 statistical interval width，而不是只處理 stopping time。

## Paper B
**Anytime validity is free: inducing sequential tests**  
Authors: Nick W. Koning, Sam van Meer  
Institution: Erasmus University Rotterdam  
Year: 2026  
Venue: JRSSB  
URL: https://doi.org/10.1093/jrsssb/qkag050  
Architecture: terminal test → conditional expectation process → anytime-valid sequential test  
Contribution: terminal power 與 anytime-valid sequentialization 可在 horizon N 匹配  
Limitation: 不是所有未知-model adaptive ML workflow 都無代價  
**改變了什麼**：Hermes 的 evidence registry 不應用「e-value vs p-value」做粗略合法/不合法分類。

## Paper C
**E-values for Adaptive Clinical Trials: Anytime-Valid Monitoring in Practice**  
Authors: Alexandra Sokolova, Vadim Sokolov  
Year: 2026  
URL: https://arxiv.org/abs/2602.06379  
Code: https://github.com/VadimSokolov/evalinger  
Contribution: betting-martingale e-process、continuous monitoring、futility、platform multiplicity  
Limitation: clinical-trial assumptions不直接等於 Agent telemetry assumptions  
**改變了什麼**：提供 production-like evidence runtime 分層範例。

## Paper D
**Time-uniform, nonparametric, nonasymptotic confidence sequences**  
Authors: Steven R. Howard, Aaditya Ramdas, Jon McAuliffe, Jasjeet Sekhon  
Year: 2021  
Venue: Annals of Statistics  
URL: https://arxiv.org/abs/1810.08240  
Code: https://github.com/gostevehoward/confseq  
Contribution: mixture / stitching / supermartingale-based time-uniform inference  
Limitation: 每種 boundary 仍有自己的 moment/dependence assumptions  
**改變了什麼**：形成 Hermes EvidenceProcess abstraction 的數學底層。

## Paper E
**Anytime-valid off-policy inference for contextual bandits**  
Authors: Aaditya Ramdas, Ian Waudby-Smith, Lili Wu, Nikos Karampatziakis, Paul Mineiro  
Year: 2022  
URL: https://arxiv.org/abs/2210.10768  
Architecture: adaptive logging + OPE + martingale inference  
Contribution: adaptive / drifting contexts 中做 anytime-valid OPE，含 doubly robust CS  
Limitation: contextual-bandit setting 與 full Agent trajectory仍有 gap  
**改變了什麼**：最接近 Hermes agent-policy rollout 的 statistical blueprint。

---

# 8. Unknown / Open Questions

## Open Question 1：不同 evidence types 要如何合法 composition？

例如：

```text
Identified Set
× Confidence Sequence
× Transport Sensitivity Set
× Conformal Safety Set
```

最終 decision set 是 intersection、union、nested envelope、product space 還是 robust optimization？需要 formal composition algebra。

## Open Question 2：Evidence validity 本身如何版本化？

若 runtime 更新：

```text
verifier v7 → v8
policy v12 → v13
filtration schema changes
cluster resolver changes
```

舊 CS/e-process 是否仍能 continuation？或必須 restart / bridge / spend new alpha budget？

## Open Question 3：Long-running Agent 的 multiplicity budget 怎麼跨「指標 × 時間 × policy versions」管理？

Hermes 同時監控：

```text
success
safety
cost
latency
security
hallucination
MCP side effects
```

每個 metric 又可 continuous monitoring；不能只做 single-stream CS。

---

# 9. 下一輪研究

本輪完成：

```text
Statistical Evidence
→ Type Semantics
→ Validity Contract
→ Conflict Router
```

下一輪最重要的是：

# Evidence Composition Algebra × Anytime-Valid Multiplicity × Versioned Evidence Continuation

研究鏈：

```text
Typed Evidence Objects
↓
Composition Rules
├ intersection
├ union
├ nesting
├ sequential product
├ e-merging
└ confidence-set combination
↓
Metric Family / Hypothesis Family
↓
Anytime-Valid Multiplicity
↓
Policy Version Change
↓
Evidence Continuation or Reset
↓
Alpha / E-wealth Accounting
↓
Versioned Decision Certificate
```

優先追：

```text
e-BH / e-merging
online FDR
confidence-sequence multiplicity
alpha-investing / wealth processes
optional continuation
safe reuse across model versions
```

---

# 10. Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Typed Statistical Evidence
Statistical Evidence Type
Statistical Validity Contract
Evidence Process Certificate
Fixed-Horizon Confidence Interval
Confidence Sequence
E-Value
E-Process
P-Process
Bayesian Credible Set
Conformal Prediction Set
Partial Identified Set
Sensitivity Set
Statistical Constraint Contract
Anytime Validity Breach
Finite-Sample Disagreement
Structural Contradiction
Evidence Conflict Kind
Predictability Contract
Adaptive Intervention Evidence Contract
Adaptive Intervention Penalty
LIL Penalty
Evidence Inversion
Sequential Causal Confidence Sequence
Evidence Composition Algebra
Versioned Evidence Continuation
```

## 新增 Edges

```text
Confidence Sequence
--INVERTS_FROM--> Sequential Test / E-Process

E-Process
--REQUIRES--> Predictability Contract

E-Process
--VALID_UNDER--> Stopping-Time Contract

Fixed-Horizon CI
--NOT_EQUIVALENT_TO--> Confidence Sequence

Credible Set
--NOT_EQUIVALENT_TO--> Confidence Set

Identified Set
--REPRESENTS--> Identification Uncertainty

Confidence Set
--REPRESENTS--> Sampling Uncertainty

Sensitivity Set
--REPRESENTS--> Assumption Uncertainty

Empty Interval Intersection
--DOES_NOT_IMPLY--> Structural Contradiction

Repeated Peeking
--CAN_INVALIDATE--> Fixed-Horizon Inference

Adaptive Intervention
--WIDENS--> Sequential Causal Confidence Set

Same Numeric Shape
--NOT_EQUIVALENT_TO--> Same Statistical Semantics

Optional Stopping Valid
--DOES_NOT_IMPLY--> Optional Adaptation Valid

Predictable Bet
--PRECEDES--> New Observation
```

---

# 11. 本輪結束回答

**缺哪一層？**  
目前最缺 **Evidence Composition Algebra + Anytime-Valid Multiplicity + Versioned Evidence Continuation**。Hermes 已知道 evidence 有不同型別，但還沒正式定義這些型別如何組合與跨版本延續。

**哪個節點最淺？**  
`StatisticalValidityContract`、`EvidenceCompositionAlgebra`、`VersionedEvidenceContinuation` 最淺。

**哪個概念仍只是名詞？**  
`Cross-Version E-Wealth Accounting` 目前仍主要是 engineering hypothesis，尚未形成 Hermes 的 formal contract。

**哪個系統最值得讀原始碼？**  
第一優先 `gostevehoward/confseq/src/confseq/betting.py` + `uniform_boundaries.h`；第二優先 `VadimSokolov/evalinger/R/monitor.R`, `platform.R`, `confseq.R`。

**哪篇論文需追引用？**  
2026 Vovk & Wang 的 **Confidence intervals for causal effects in sequential decision making**，因它直接連接 causal identification、adaptive intervention 與 confidence sequence。

**哪個概念最適合視覺模擬？**  
`Statistical Evidence Type × Conflict Simulator`：相同兩條數值區間，切換 evidence type 後讓 conflict semantics 即時改變。

**哪個 Agent 架構最值得實作？**  

```text
Typed Anytime-Valid Evidence Agent Runtime
=
Filtration Registry
+
Evidence Type System
+
Validity Contract Checker
+
Anytime-Valid Evidence Engine
+
Conflict Semantics Router
+
Evidence Reconciliation
+
Planner Gate
```

---

# 12. 對「AI 到底怎麼運作」新增的一層

本輪把 Agent 的 decision loop 補成：

```text
User says something
↓
UI / Agent / Context / Memory
↓
Reasoning / Planning
↓
Tool / MCP / Model action
↓
World produces observations
↓
Observation enters a specific filtration
↓
Statistical evidence process updates
↓
Evidence receives a validity type
↓
Sampling / identification / assumption uncertainty are separated
↓
Evidence conflict is semantically classified
↓
Only valid evidence reaches causal/robust planner gate
↓
Next action
```

核心結論：

> **AI 不只要知道「我看到什麼資料」，還要知道「這份資料產生的證據到底是哪一種數學物件」。兩個畫面上看起來完全相同的 `[lower, upper]`，可能分別代表抽樣不確定性、時間一致的 sequential guarantee、因果不可識別性、Bayesian posterior mass 或 sensitivity assumption。成熟 Agent 若沒有 statistical evidence type system，就會把數值相似誤認為語意相同，進而錯誤宣告衝突、安全或因果結論。**
