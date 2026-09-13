# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 12:54–13:00 Asia/Taipei**  
**本輪主題：Sequential Evidence Transformer × OPE-to-E-Process × Exact/Asymptotic Evidence Regimes × Agent Risk Gating**

---

## 0. 與歷史研究比較：本輪避免重複

上一輪已完成：

- Off-policy replay admissibility
- Behavior / target policy propensity
- Doubly-robust pseudo-outcome
- OPE confidence sequence
- Candidate policy set / anytime-valid policy identification
- Sequential Evidence Admission Gate（概念）

上一輪留下的明確缺口是：

```text
OPE Confidence Sequence
↓
???
↓
合法 e-value / e-process
↓
e-BH / LORD / SCORE
↓
Verifier certificate
```

本輪不再重講 OPE/DR 基礎，而是往下拆「Sequential Evidence Transformer」應該保存什麼數學物件，以及何時根本不能轉換。

---

# 本小時新發現

## 新論文 / 新理論

1. **Anytime-valid off-policy inference for contextual bandits** — Waudby-Smith, Wu, Ramdas, Karampatziakis, Mineiro；2022（v3 2024）。建立 adaptive logging 下的 nonparametric、doubly-robust、time-uniform OPE confidence sequences；要求 target policy 對 logging policy 絕對連續，並明確指出若環境受到過去 actions 主動影響，單純 contextual-bandit counterfactual interpretation 會改變。
2. **Admissible anytime-valid sequential inference must rely on nonnegative martingales** — Ramdas, Ruf, Larsson, Koolen；證明 admissible CS / p-process / e-process 最終都與 nonnegative martingale 結構相連。
3. **Asymptotic e-processes** — Massiani, Schulze, Mollenhauer；2026。當 nuisance estimation / misspecification 讓 e-variable 只能近似成立時，以雙指標 process 與 growing monitoring horizon 建立 asymptotic Ville-type guarantee。
4. **Conformal Selective Acting: Anytime-Valid Risk Control for RLVR-Trained LLMs** — Khosravi, Huo；2026。把 per-threshold e-process 直接用於 LLM selective acting / abstention risk gate，展示 e-process 不只是一個統計報表，而能成為 deployment-side action gate。
5. **Learning to Bet for Horizon-Aware Anytime-Valid Testing** — Taga, Oymak, Shekhar；2026。將 betting strategy 本身視為 finite-horizon control problem，顯示「如何下注」是 evidence runtime 的 policy，而不是固定公式。

## 新 GitHub / 工程實作

### jakorostami/expectation

值得看的目錄：

```text
expectation/
├ confseq/
│  ├ confidenceconfig.py
│  └ confidencesequence.py
├ seqtest/
│  └ sequential_e_testing.py
├ modules/
├ parametric/
├ conformal/
└ par_seqtest.py
```

`confidencesequence.py` 實際維護：

```text
n_samples
sum
sum_squares
running_mean
intrinsic_time
variance_estimate
```

再把 `intrinsic_time` 丟進 mixture boundary 算 radius。

這個實作給 Hermes 一個重要工程提醒：

> CS endpoint 是 downstream projection；真正應保存的是生成 boundary / martingale / betting construction 所需的 state 與 provenance。

---

# 本小時最重要 5 個發現

## 1. Confidence Sequence ↛ 唯一 E-Process

### 是什麼

常說：

```text
e-process
↓ test inversion
confidence sequence
```

但 production runtime 不應倒著假設：

```text
confidence sequence endpoints
↓
唯一原始 e-process
```

這通常不成立。

### 底層如何運作

對 null family `H_θ`，若有 e-process：

```text
E_t(θ)
```

則可以定義：

```text
C_t(α)
=
{ θ : sup_{s≤t} E_s(θ) < 1/α }
```

或由對應 anytime test inversion 形成 CS。

但 UI 最後只留下：

```text
[L_t, U_t]
```

會丟失：

- null-indexed process `E_t(θ)`
- betting strategy
- mixture prior
- intrinsic time / variance process
- filtration
- one/two-sided construction
- alpha allocation
- boundary family

因此只憑 endpoints 無法安全重建供 e-BH / e-merging 使用的 terminal e-value。

### 為什麼重要

Hermes 上一輪的：

```text
OPE Confidence Sequence
→ e-value
```

必須改成：

```text
Underlying E-Process available?
├ YES → expose valid E_t(H0)
└ NO  → CS stays a CS
        不偽造 e-value
```

### 限制

某些 CS construction 的確有明確 underlying test martingale / e-process，可以直接保留它；問題不是「永遠不能轉」，而是「不能只從顯示層 interval 逆推」。

### 來源

- Ramdas et al., admissible anytime-valid inference / martingale universality
- Howard et al. confidence sequence literature
- `jakorostami/expectation/confseq/confidencesequence.py`

---

## 2. 正確方向不是 OPE estimate → e-value，而是 DR estimating process → betting/e-process → CS

### 是什麼

Hermes 不應做：

```text
DR point estimate
↓
套一個 heuristic transform
↓
e-value
```

更安全的 architecture：

```text
History F_{t-1}
↓
behavior policy h_t
↓
target policy π
↓
predictable nuisance predictor m̂_t
↓
DR pseudo-outcome φ_t
↓
null-centered increment Z_t(θ0)
↓
predictable bet λ_t
↓
nonnegative wealth update
↓
E_t(θ0)
↓
threshold / inversion
├ test / e-value
└ confidence sequence
```

### Bottom-level mechanism

核心 DR pseudo-outcome可抽象：

```text
w_t = π(A_t|X_t) / h_t(A_t|X_t)

m̂_t^π(X_t)
= Σ_a π(a|X_t)m̂_t(X_t,a)

φ_t
= m̂_t^π(X_t)
+ w_t [R_t - m̂_t(X_t,A_t)]
```

接著針對 null `H0: ν ≤ ν0` 建立 centered evidence increment，而 `λ_t` 必須 `F_{t-1}`-predictable。

Betting wealth 的抽象形式：

```text
E_t(ν0)
=
E_{t-1}(ν0)
× g_t(φ_t, ν0, λ_t)
```

並要求 null 下條件期望不超過 1：

```text
E[g_t | F_{t-1}, H0] ≤ 1
```

這才是可以被 multiplicity engine 消費的 evidence object。

### 為什麼重要

這會把 Hermes 從：

```text
confidence = .82
```

升級為：

```text
EvidenceProcessCertificate
```

可以回答「這個 evidence 為什麼在 optional stopping 下仍合法」。

### 限制

不是任意 DR estimator 都自動能變 finite-sample e-process。boundedness、predictability、support、moment / conditional mean constraints 與 construction 細節都要滿足。

---

## 3. Causal interpretation 與 statistical validity 必須分成兩層 certificate

### 是什麼

Waudby-Smith et al. 的 OPE CS 可以在非常一般的 adaptive contextual-bandit setting 下提供 time-uniform statistical coverage；但 paper 也清楚區分：若環境 transition / reward distribution 被過去 actions 主動改變，所覆蓋的 statistical functional 未必仍等同「整條 corrected policy 世界線」的 causal counterfactual。

### Hermes 應保存

```text
SequentialEvidenceCertificate
├ StatisticalValidity
│  ├ martingale/e-process condition
│  ├ optional stopping
│  ├ support
│  └ time-uniformity
└ CausalInterpretation
   ├ consistency
   ├ exchangeability / no hidden confounding
   ├ positivity
   ├ exogenous-vs-action-coupled environment
   └ estimand mapping
```

### 重要否定關係

```text
Statistically Anytime-Valid
≠
Causally Correct Counterfactual
```

### 為什麼重要

這正好銜接前幾輪的 `PolicyCoupledEvidence` 與 `CausalReplayBoundary`：

- contextual bandit / exogenous drift：OPE sequential evidence較有機會直接用
- action changes future state：要升級成 MDP / longitudinal causal runtime

### 限制

本輪未找到一個能直接把 Waudby-Smith contextual-bandit DR e-process完整推廣到「任意 Agent + MCP + human response + mutable external world」且仍 finite-sample exact 的統一 theorem。

---

## 4. Exact E-Process 與 Asymptotic E-Process 必須分型

### 是什麼

2026 **Asymptotic e-processes** 專門處理：

```text
ideal e-variable
```

因為 nuisance estimation / model approximation 無法精確計算，只能得到：

```text
approximate e-variable
```

它不是把 approximation 當沒發生，而是加入 approximation index `m`：

```text
E_{m,n}
```

並把可安全監控的時間 horizon 與 approximation quality 綁定。

### Hermes 應新增

```text
EvidenceValidityRegime
├ FINITE_SAMPLE_EXACT
├ ASYMPTOTIC_ANYTIME_VALID
├ FIXED_HORIZON_APPROXIMATE
├ MODEL_ASSISTED_ONLY
└ UNVERIFIED
```

以及：

```text
AsymptoticEvidenceContract
├ approximation_index
├ approximation_error_bound
├ allowed_monitoring_horizon
├ nuisance_estimator_version
├ convergence_assumption
└ asymptotic_ville_status
```

### 為什麼重要

Agent runtime 幾乎一定大量使用 learned nuisance models：

```text
reward model
world model
propensity reconstruction
VLM verifier
risk predictor
```

若所有這些估出來的 evidence 都被 UI 標成「anytime-valid」，會把 asymptotic / approximate guarantee 假裝成 exact finite-sample guarantee。

### 限制

Asymptotic e-process 本身不會自動解決 model misspecification；它只是提供一個誠實描述 approximation 與 monitoring horizon 的數學框架。

---

## 5. E-Process 可以直接成為 Agent action gate，而不是只做 dashboard 指標

### 是什麼

2026 **Conformal Selective Acting (CSA)** 把 per-threshold e-process 用在 RLVR-trained LLM deployment：對多個 acting thresholds 維護 evidence，只有達到風險 certificate 的 threshold 才 release / act，否則 abstain。

這對 Hermes 的意義不是照抄 conformal 方法，而是 architecture pattern：

```text
Model proposal
↓
Risk threshold family τ_1...τ_K
↓
per-threshold evidence process
↓
validity / multiplicity gate
↓
max certified action threshold
↓
ACT or ABSTAIN
```

### Hermes 可映射為

```text
Candidate Action
├ READ_MCP
├ SEARCH_WEB
├ ASK_USER
├ WRITE_INTERNAL
└ WRITE_EXTERNAL
```

每一類 action 不一定共用同一風險 threshold。

### 為什麼重要

這把前面很多研究真正接回：

```text
Evidence
→ Permission
→ Action
```

而不是：

```text
Evidence
→ UI 顯示
```

### 限制

CSA 的具體 theorem 是特定 RLVR / selective risk setting；不能宣稱直接覆蓋 Hermes 的通用 MCP/tool safety。

---

# Architecture Breakdown

## System Architecture：Sequential Evidence Transformer Runtime

```text
UI / Agent Goal
↓
Planner proposes action / policy π
↓
Historical Behavior Policy Trace h_t
↓
Replay / OPE Admissibility Gate
↓
DR Reconstruction Layer
├ target propensity
├ behavior propensity
├ predictable reward model
└ DR pseudo-outcome
↓
Sequential Evidence Constructor
├ null / alternative contract
├ predictable betting rule
├ mixture / boundary family
├ variance / intrinsic time
└ filtration contract
↓
Evidence Process Registry
├ E_t(H0)
├ running max
├ test threshold
├ CS inversion map
└ terminal e-value
↓
Validity Regime Router
├ exact finite-sample
├ asymptotic e-process
├ fixed-horizon only
└ quarantine
↓
Multiplicity Runtime
├ e-BH
├ LORD / online family
├ SCORE (theorem-specific)
└ family epoch
↓
Risk / Permission Gate
↓
Planner executes / abstains / asks / verifies
```

### 核心資料結構

```text
EvidenceProcessCertificate
├ evidence_process_id
├ hypothesis_id
├ null_semantics_hash
├ estimand_id
├ target_policy_hash
├ behavior_policy_trace_id
├ filtration_schema_hash
├ pseudo_outcome_formula_hash
├ nuisance_model_lineage
├ betting_rule_hash
├ boundary_or_mixture_id
├ process_state
│  ├ log_wealth
│  ├ intrinsic_time
│  ├ variance_process
│  └ running_max
├ validity_regime
├ stopping_time_validity
├ causal_interpretation_status
├ multiplicity_compatibility
└ provenance
```

---

# Bottom-Level Logic

## A. 從 observation 到 DR pseudo-outcome

```text
X_t
↓
h_t(.|X_t)
↓
A_t ~ h_t
↓
R_t

w_t = π(A_t|X_t) / h_t(A_t|X_t)

φ_t = m̂_t^π(X_t)
    + w_t(R_t-m̂_t(X_t,A_t))
```

必要條件：

```text
π(a|x)>0 ⇒ h_t(a|x)>0
```

## B. 從 DR pseudo-outcome 到 sequential evidence

不能直接：

```text
φ̄_t → e-value
```

而是：

```text
H0: ν ≤ ν0
↓
construct null-centered increment
↓
choose predictable λ_t using F_{t-1}
↓
update nonnegative wealth
↓
prove/record E[g_t|F_{t-1},H0] ≤ 1
↓
E_t
```

## C. 從 e-process 到 CS

```text
for θ in parameter grid/family:
    maintain E_t(θ)

C_t(α)
=
{θ : evidence against H_θ has not crossed 1/α}
```

重要：

```text
E-process state → CS
```

通常是資訊壓縮，因此 Hermes 必須保存 generator lineage。

## D. 從 e-process 到 multiplicity

若 terminal/current `E_t` 要餵 e-BH / other e-value multiple testing：

```text
Single-hypothesis validity
↓
Filtration compatibility
↓
Cross-stream dependence assumptions
↓
Anytime multiplicity contract
↓
Family procedure
```

不能因為每條 stream 各自 anytime-valid，就自動得到 multi-stream anytime FDR guarantee。

---

# Visual Simulation Idea

## **Sequential Evidence Transformer Lab**

### Panel 1 — Evidence Lineage

```text
Historical Event
     ↓
Propensity h=.20
Target π=.50
     ↓
Importance weight 2.5
     ↓
Reward model .62
Observed reward 1.0
     ↓
DR pseudo-outcome
     ↓
Bet λ_t=.08
     ↓
E_t = 3.4
     ↓
CS = [.54,.77]
```

使用者點任何節點可看到：

```text
OBSERVED
ESTIMATED
PREDICTABLE
DERIVED
ASSUMED
THEOREM-GUARANTEED
```

### Panel 2 — CS ↔ E-Process Provenance

```text
           underlying process retained?
                    │
       ┌────────────┴────────────┐
      YES                       NO
       │                         │
CS [.54,.77]                CS [.54,.77]
E(H0)=3.4                   E(H0)=UNKNOWN
       │                         │
 e-BH eligible            NOT e-BH eligible
```

### Panel 3 — Validity Regime

```text
FINITE-SAMPLE EXACT   ✓
ASYMPTOTIC            ⚠ horizon ≤ r_m
FIXED-HORIZON         △
MODEL-ASSISTED        △
UNVERIFIED            ✕
```

### Panel 4 — Agent Permission

```text
READ_MCP      certified   → ALLOW
SEARCH_WEB    certified   → ALLOW
ASK_USER      safe        → ALLOW
WRITE_LOCAL   uncertain   → VERIFY
WRITE_REMOTE  uncertified → BLOCK
```

---

# Code / GitHub

## 1. jakorostami/expectation

值得追：

```text
expectation/confseq/confidencesequence.py
expectation/seqtest/sequential_e_testing.py
expectation/modules/
expectation/par_seqtest.py
```

已確認 `ConfidenceSequenceState` 具體保存 sample count、sum、sum-squares、running mean、intrinsic time、variance estimate，再由 mixture boundary 生成區間。

Hermes 可借用的不是 UI，而是「stateful statistical object + explicit config + immutable result」模式。

## 2. 下一輪值得深入的 code

```text
Waudby-Smith / off-policy CS replication code
betting-based OPE implementations
MDP doubly-robust / sequential OPE implementations
CSA code（若公開）
```

---

# Papers

## Paper 1

**Title:** Anytime-valid off-policy inference for contextual bandits  
**Authors:** Ian Waudby-Smith, Lili Wu, Aaditya Ramdas, Nikos Karampatziakis, Paul Mineiro  
**Institution:** cross-institutional; authors include Carnegie Mellon University and Microsoft Research affiliations  
**Year:** 2022; revised 2024  
**URL:** https://arxiv.org/abs/2210.10768  
**Code:** paper page / associated implementations should be followed separately  
**Dataset:** method paper; contextual-bandit experiments  
**Architecture:** adaptive logging → importance weighting / DR pseudo-outcome → martingale/betting/time-uniform boundary → OPE CS  
**Contribution:** exact nonparametric anytime-valid OPE under adaptive logging; time-varying values; off-policy CDF bands  
**Limitations:** requires support / absolute continuity; causal pathwise interpretation is not guaranteed in action-coupled environments  
**改變了什麼:** 把 OPE 從 fixed-n uncertainty 拉成 continuously monitorable inference。

## Paper 2

**Title:** Admissible anytime-valid sequential inference must rely on nonnegative martingales  
**Authors:** Aaditya Ramdas, Johannes Ruf, Martin Larsson, Wouter Koolen  
**Institution:** CMU / LSE / CWI 等跨機構  
**Year:** 2020–2022 versions  
**URL:** https://arxiv.org/abs/2009.03167  
**Code:** not central  
**Dataset:** none  
**Architecture:** admissible sequential procedure → nonnegative martingale representation / domination  
**Contribution:** 說明 martingale/e-process 並非只是一種方便技巧，而接近 admissible anytime-valid inference 的底層共同語言  
**Limitations:** 理論層，不直接提供 Agent-specific transformer  
**改變了什麼:** 支持 Hermes 將 martingale/e-process lineage 視為一級 runtime object。

## Paper 3

**Title:** Asymptotic e-processes  
**Authors:** Pierre-François Massiani, Sebastian Schulze, Mattes Mollenhauer  
**Institution:** authors include German research/industry affiliations; verify exact affiliation from paper PDF when integrating bibliography DB  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2604.19353  
**Code:** not identified in this round  
**Dataset:** theoretical  
**Architecture:** approximation index m × monitoring time n → approximate e-process → growing safe horizon r_m → asymptotic Ville bound  
**Contribution:** formalizes sequential evidence when exact e-values unavailable because of approximation / estimation error  
**Limitations:** asymptotic, not finite-sample exact  
**改變了什麼:** Hermes 可以誠實分離 exact 與 approximate sequential guarantees。

## Paper 4

**Title:** Conformal Selective Acting: Anytime-Valid Risk Control for RLVR-Trained LLMs  
**Authors:** Hamed Khosravi, Xiaoming Huo  
**Institution:** academic research; exact affiliations to confirm from full paper metadata  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2605.20270  
**Code:** not confirmed this round  
**Dataset:** eight specialist benchmarks + adversarial distribution-shift cells + live Expert-Iteration RLVR cells (paper-reported)  
**Architecture:** risk threshold grid → per-threshold e-process → anytime pathwise certification → max-certified-threshold acting rule  
**Contribution:** demonstrates deployment-side e-process as selective action permission mechanism  
**Limitations:** specialized selective-risk assumptions; not a universal tool/MCP safety theorem  
**改變了什麼:** 把 sequential evidence 從 monitoring 直接推到 LLM action release gate。

## Paper 5

**Title:** Learning to Bet for Horizon-Aware Anytime-Valid Testing  
**Authors:** Ege Onur Taga, Samet Oymak, Shubhanshu Shekhar  
**Institution:** academic research affiliations; exact metadata to verify from paper PDF  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2603.19551  
**Code:** not confirmed this round  
**Dataset:** synthetic sequential testing experiments  
**Architecture:** state (t, log wealth) → finite-horizon control → DQN betting policy  
**Contribution:** 將 betting strategy 視為可學習 sequential control policy  
**Limitations:** learned betting policy 的 validity 仍依賴其可預測性與 theorem setup  
**改變了什麼:** 提醒 Hermes「e-process betting policy」本身需要版本、state、filtration provenance。

---

# 已確認事實 / 推論分層

## 已確認（論文 / 官方 / 原始碼）

- Waudby-Smith et al. 提供 adaptive contextual-bandit anytime-valid OPE CS，並要求 target policy 對 logging policy absolute continuity。
- paper 明確區分 exogenous time variation 與 action-coupled histories對 counterfactual interpretation 的影響。
- admissible anytime-valid inference 與 nonnegative martingale structure 有深層等價 / 表示關係。
- asymptotic e-processes 針對 approximate e-variable / nuisance estimation 引入 approximation-indexed theory。
- `expectation` 原始碼的 CS object 保存 variance / intrinsic time 等 state，而不是只保存 endpoints。

## 合理工程推論

- Hermes 應把 e-process generator lineage 存成一級 object，否則 CS→e-value 會失去可驗證來源。
- Evidence Transformer 應從 pseudo-outcome / test construction 層產生 e-process，不該從 UI interval 反推。
- Agent action permission 可採「risk threshold family + certified threshold」pattern。

## 尚未驗證假說

- 一個可通用於任意 Hermes MCP/tool/human feedback trajectory 的 finite-sample exact DR e-process。
- production-grade 自動判斷「某 CS 是否可安全暴露 underlying e-value」的 proof checker。
- contextual-bandit evidence process 到 general MDP / POMDP / open-world Agent 的無損轉換。

---

# Unknown / Open Questions

## 1. CS-to-E Process Recoverability

若第三方 library 只回傳：

```text
lower
upper
alpha
```

Hermes 如何判斷：

```text
UNDERLYING_EPROCESS_AVAILABLE
EQUIVALENT_TEST_AVAILABLE
ONLY_INTERVAL_AVAILABLE
```

需要標準 provenance protocol。

## 2. Longitudinal / MDP Sequential DR

Agent 的 action 會改變下一個 state：

```text
S_t → A_t → S_{t+1}
```

contextual-bandit exogeneity 不夠。

真正需要：

```text
trajectory importance ratio
sequential DR / value-function correction
Markov / history-dependent filtration
anytime-valid trajectory evidence
```

## 3. Multiplicity Consumption Contract

即使有合法 per-hypothesis e-process，送進：

```text
e-BH
LORD
SCORE
Dynamic e-closure
```

需要的 contract 並不完全相同。

Hermes 需要：

```text
MultiplicityCompatibilityCertificate
```

---

# 下一輪研究

## 主題

**MDP / Longitudinal Sequential DR × Trajectory E-Process × State-Action Causal Feedback × Agent Permission Certificate**

優先研究：

```text
Contextual Bandit
↓
MDP / POMDP
↓
trajectory likelihood ratio
↓
per-decision IS
↓
DR / marginalized DR
↓
sequential value process
↓
martingale / e-process construction
↓
trajectory risk certificate
↓
Agent action gate
```

並特別比較：

- contextual-bandit OPE CS
- Universal Off-Policy Evaluation for RL / MDP
- DRL / marginalized OPE
- online RL inference
- trajectory-wise vs per-decision importance weighting
- world-model-based evidence 與 exact statistical evidence 的界線

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Sequential Evidence Transformer
Evidence Process Certificate
E-Process Provenance
CS Inversion Map
CS-to-E Recoverability
Underlying Test Martingale
DR Evidence Increment
Null-Centered Pseudo-Outcome
Predictable Betting Rule
Betting Policy Lineage
Evidence Validity Regime
Finite-Sample Exact E-Process
Asymptotic E-Process
Approximation Index
Safe Monitoring Horizon
Statistical Validity Certificate
Causal Interpretation Certificate
Multiplicity Compatibility Certificate
Selective Action Risk Gate
Certified Action Threshold
Sequential Permission Certificate
MDP Evidence Gap
Trajectory E-Process
```

## Edges

```text
DR Pseudo-Outcome
→ can feed
Sequential Evidence Constructor

Sequential Evidence Constructor
→ produces
E-Process

E-Process
→ can invert to
Confidence Sequence

Confidence Sequence Endpoint
≠ uniquely determines
E-Process

Statistical Anytime Validity
≠ implies
Causal Counterfactual Validity

Finite-Sample Exact
≠
Asymptotic Anytime Valid

Approximate E-Variable
→ requires
Approximation Validity Contract

E-Process
→ can gate
Agent Action

Per-Hypothesis E-Process Validity
≠ automatically implies
Anytime Multiple-Testing Validity

Contextual-Bandit OPE
≠ general
Trajectory Counterfactual Inference
```

---

# 本輪結束判定

**缺哪一層：** `MDP / longitudinal trajectory sequential evidence`。  
**哪個節點最淺：** `CS-to-E Recoverability`、`MultiplicityCompatibilityCertificate`、`TrajectoryEProcess`。  
**哪個概念仍只是名詞：** production-level `SequentialEvidenceTransformer` automatic theorem checker。  
**哪個系統值得讀原始碼：** `jakorostami/expectation` 的 `seqtest/sequential_e_testing.py` 與 modules；另外應追 Waudby-Smith OPE implementation。  
**哪篇論文需追引用：** `Anytime-valid off-policy inference for contextual bandits`，沿引用往 MDP / longitudinal anytime-valid OPE 追。  
**哪個概念最適合視覺模擬：** `Sequential Evidence Transformer Lab`。  
**哪個 Agent 架構最值得實作：** `Evidence-Process-Backed Risk-Gated Planner`。

---

# 對「AI 到底怎麼運作」新增的一層

目前完整鏈路可以再補成：

```text
User says one sentence
↓
UI event
↓
Agent context / memory
↓
Planner candidate actions
↓
Historical behavior-policy trace
↓
Off-policy / causal admissibility
↓
DR pseudo-outcome
↓
Predictable sequential betting
↓
E-process / confidence sequence
↓
Multiplicity / validity regime
↓
Risk certificate
↓
Permission gate
↓
Tool / MCP / model action
↓
Environment changes
↓
new observation
↓
next evidence update
```

核心結論：

> **成熟 Agent 不應把「置信區間」、「e-value」、「e-process」視為可以互換的 UI 數字。真正能支撐長期 Agent 決策的是可追溯的 evidence-generating process：它知道 observation 如何經 propensity、DR correction、predictable betting 與 martingale validity 變成 sequential evidence，也知道這份證據是 finite-sample exact、asymptotic，還是只能當 model-assisted signal。只有這樣，e-BH/LORD/SCORE 或 action permission gate 才不會吃進一個看起來很像 evidence、其實沒有 theorem lineage 的數字。**
