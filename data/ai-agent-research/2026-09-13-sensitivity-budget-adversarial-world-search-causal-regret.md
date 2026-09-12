# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 01:50（Asia/Taipei）**

## 本輪研究主題
**Sensitivity-Budget Calibration × Adversarial Compatible-World Search × Temporal Cross-Fitting × Causal Decision Regret**

> 本輪承接 `2026-09-13-cross-fitted-proxy-sensitivity-delphic-action-dominance.md`。上一輪已建立 Cross-Fitted Proxy Contract、Compatible Causal World、Delphic Uncertainty 與 Robust Action Dominance；本輪不重複 proxy/bridge 基礎，而集中處理兩個仍未封閉的 runtime 問題：**(1) sensitivity parameter Γ 到底從哪裡來，如何避免人工拍值；(2) compatible-world ensemble 是否漏掉真正會讓 action ranking 翻轉的 adversarial world。** 本輪把這兩件事接到 temporal cross-fitting、worst-case regret 與 Hermes Planner gate。

---

# 本小時新發現

## 新論文 / 新架構 / 新 GitHub / 新機制

1. **Robust Counterfactual Policy Optimisation via Nondeterministic Causal Models（2026-08）**：把 sequential counterfactual policy optimization 從 deterministic causal models 推到 probabilistic nondeterministic causal models，明確分開 latent confounding 與 irreducible stochasticity，並在 sensitivity-analysis uncertainty set 中尋找 robust policy。這一點對 Hermes 很重要：Aleatoric randomness 不應被誤當成 hidden confounding。
2. **Policy Learning under Unobserved Confounding: A Robust and Efficient Approach（2025）**：使用 Marginal Sensitivity Model（MSM）定義 hidden-confounding uncertainty set，以 worst-case welfare / policy improvement 最佳化 robust policy，並提供 asymptotic regret guarantee。這直接支援 Hermes 將「Γ → compatible counterfactual distributions → policy regret」做成一條正式 runtime path。
3. **An Average-Case Sensitivity Analysis for Unmeasured Confounding（Biometrika 2026）**：敏感度不一定只應由最極端 hidden bias 決定；average-case / distributional sensitivity 對 Hermes 特別重要，因為單一 global worst-case Γ 可能讓整個 Agent 永久過度保守。
4. **CausalML/confounding-robust-policy-improvement GitHub**：不只 README；`methods.py` 實際沿一系列 `GAMS` 建立 propensity uncertainty bounds、對每個 Γ 重新最佳化 robust policy，並用 `calibrate_risk_for_policies()` 形成「在 Γ_train 下學到的 policy，若真實 Γ_calib 不同，會承受多少 worst-case regret」的矩陣。這很接近 Hermes 所需的 Sensitivity Surface。
5. **Adversarial Compatible-World Search（本輪 Hermes 工程模型）**：不再均勻抽樣 world，而把 world generator 當 adversary，主動搜尋 `argmax_world DecisionRegret` 或 `argmin_world RobustMargin`；若找到 action-ranking counterexample，立刻撤銷原 action certificate。
6. **Temporal Cross-Fitting（本輪工程約束）**：Agent logs 有 policy drift、tool version drift、memory schema drift，因此 random K-fold 可能把未來資料洩漏進過去。Hermes 應採 rolling / blocked / policy-version-aware cross-fitting，確保 proxy、Γ calibration、world generator 與 action certificate 都在時間上可部署。

---

# 本小時最重要 5 個發現

## 1. Sensitivity Parameter Γ 不是模型超參數；它是「尚未觀察的偏差允許多大」的 epistemic budget

### 已確認事實
Marginal Sensitivity Model 類方法使用一個 sensitivity parameter 控制 hidden confounder 可以讓真實 assignment odds 相對 nominal propensity 偏離多少。Γ 越大，允許的 hidden confounding 越強，counterfactual value interval 通常越寬。

概念上：

```text
Nominal assignment odds
        ↓
Observed X-based propensity e(X)
        ↓
Hidden U allowed to perturb odds
        ↓
Γ controls admissible distortion
        ↓
Compatible counterfactual distributions
```

Hermes 不能把：

```text
Gamma = 2
```

寫死在設定檔，因為這代表一個因果假設，而不是單純 temperature / learning rate。

### 本輪新模型：SensitivityBudgetEvidence

```text
SensitivityBudgetEvidence
├ negative_control_discrepancy
├ observed_covariate_benchmark
├ randomized_verification_gap
├ proxy_mismatch
├ policy_version_shift
├ domain_expert_bound
├ historical_tipping_points
└ support_quality
```

再輸出：

```text
GammaEnvelope
├ gamma_low
├ gamma_reference
├ gamma_high
├ evidence_sources[]
├ calibration_method
├ transport_scope
└ status
```

### 建議的 Γ 校準順序

```text
1. Observed-covariate benchmarking
   └ 比較「移除一個已觀察強 confounder」會讓 propensity / outcome relation 改變多少

2. Negative-control residual
   └ 若理論上零效應的 control 仍殘留 association，擴大 Γ

3. Randomized / trusted verification slice
   └ 比較 observational estimate 與 randomized/trusted slice 的偏差

4. Proxy / bridge disagreement
   └ h/q 或 proxy sets 越不穩定，Γ 下限不能太樂觀

5. Historical tipping Γ
   └ 記錄過去 action ranking 在 Γ 多少時翻轉
```

### 為什麼重要
Γ 不校準時，Hermes 只有兩種壞結果：

```text
Γ 太小 → 偽安全 / overconfident action
Γ 太大 → 永久 VERIFY / HUMAN / BLOCK
```

### 限制
這些 evidence source 並不「識別真實 Γ」；它們只能提供可辯護的 sensitivity budget。真正的 latent confounding 強度通常不可由 observational data 唯一恢復。

### 新否定關係

```text
Sensitivity Parameter ≠ Ordinary Hyperparameter
Calibrated Γ ≠ True Hidden Confounding Known
Large Γ ≠ More Accurate World Model
Small Γ ≠ Safe Environment
```

---

## 2. Worst-Case World 應被「搜尋」，不是只從有限 ensemble 被動抽樣

### 問題
上一輪：

```text
Compatible worlds W1...Wk
→ evaluate actions
→ robust dominance
```

仍有一個漏洞：

```text
如果真正會讓 COMMIT 翻成 ASK_USER 的 W* 根本不在 W1...Wk 裡？
```

那 `ROBUSTLY_DOMINANT` 其實只代表：

```text
robust within sampled worlds
```

不是：

```text
robust within admissible causal uncertainty set
```

### 本輪新架構：World Adversary

令 causal world 參數為 `ω`，包含：

```text
ω
├ latent-confounder strength
├ hidden-state transition
├ proxy error structure
├ bridge parameters
├ action-state dependence
├ stochastic transition noise
└ censoring / observation mechanism
```

約束：

```text
ω ∈ Ω(Γ, observed data, proxy contracts, invariants)
```

對 candidate action `a`，定義：

```text
WorstValue(a) = min_{ω∈Ω} V(a,ω)
```

對 action pair `a,b`：

```text
RobustMargin(a,b)
= min_{ω∈Ω} [V(a,ω)-V(b,ω)]
```

如果 adversary 找到：

```text
V(COMMIT,ω*) < V(ASK_USER,ω*)
```

則 `COMMIT` 的 robust-dominance certificate 立即失效。

### Bottom-Level Search Loop

```text
Initialize world ω0
↓
Generate counterfactual trajectory
↓
Evaluate planner action values
↓
Compute ranking margin / regret
↓
Differentiate / optimize / evolutionary-search world parameters
↓
Project ω back into admissible Ω
↓
Repeat until:
  counterexample found
  or search budget exhausted
↓
Certificate
```

若 causal simulator 可微：

```text
ω ← Projection_Ω(
      ω + η ∇_ω DecisionRegret
    )
```

若不可微（Browser / MCP / discrete graph）：

```text
beam search
CEM
Bayesian optimization
evolutionary mutation
constraint-guided search
```

### 新資料結構

```text
AdversarialWorldSearchResult
├ target_action
├ challenger_action
├ gamma
├ world_id
├ objective
├ worst_margin
├ counterexample_found
├ constraints_satisfied
├ search_coverage
├ search_budget
└ unresolved_regions[]
```

### 限制
找不到 counterexample 不能證明不存在；所以 certificate 必須寫：

```text
NO_COUNTEREXAMPLE_FOUND_WITHIN_SEARCH_BUDGET
```

而不是：

```text
PROVEN_SAFE
```

### 新否定關係

```text
Sampled World Ensemble ≠ Complete Compatible-World Set
No Counterexample Found ≠ No Counterexample Exists
World Diversity ≠ Worst-Case Coverage
Large Ensemble ≠ Adversarial Coverage
```

---

## 3. Causal Decision Regret 比「value interval width」更接近 Planner 真正需要的風險

### 問題
Hermes 若只看到：

```text
SEARCH      [0.42, 0.58]
ASK_USER    [0.39, 0.61]
MCP_WRITE   [0.18, 0.64]
COMMIT      [-0.31,0.72]
```

interval 很寬，但 Planner 真正想知道的是：

> 選錯 action 最慘會損失多少？

### 定義：Decision Regret
對 world `ω`：

```text
Regret(a,ω)
= max_b V(b,ω) - V(a,ω)
```

worst-case：

```text
WorstCaseRegret(a)
= max_{ω∈Ω} Regret(a,ω)
```

Planner 可以選：

```text
argmin_a WorstCaseRegret(a)
```

而不是：

```text
argmax_a nominal mean
```

### Hermes CausalDecisionRegretProfile

```text
CausalDecisionRegretProfile
├ action
├ nominal_value
├ lower_value
├ upper_value
├ worst_case_regret
├ expected_regret
├ ranking_flip_probability_or_frequency
├ adversarial_world_id
├ gamma_tipping_point
└ side_effect_class
```

### 為什麼它比 uncertainty 更實用

```text
Action A uncertainty 很大
但所有 worlds 下仍最佳
→ decision risk 低

Action B uncertainty 很小
但剛好與 threshold / competitor 非常接近
→ decision risk 高
```

所以：

```text
Uncertainty Magnitude ≠ Decision Regret
```

### Planner Gate

```text
if robust_margin > safety_margin
   and worst_case_regret < regret_budget:
      ROBUST_ACT

elif counterexample can be resolved by cheap evidence:
      VERIFY_FIRST

elif best action changes across plausible worlds:
      ASK_USER / HUMAN

elif action has irreversible side effects:
      BLOCK
```

### 與 2025 robust policy learning 的連結
Policy Learning under Unobserved Confounding 直接對 uncertainty set 中的 worst-case welfare / policy improvement 做 optimization，並研究 regret guarantees。Hermes 應把這個思想從 batch policy learning 改造成 per-decision runtime certificate。

---

## 4. Temporal Cross-Fitting：random K-fold 對長期 Agent log 可能產生時間穿越

### 問題
上一輪提出 cross-fitting：

```text
train folds → discover proxy / fit bridge
held-out fold → validate
```

但 Agent 是非平穩系統：

```text
model v1 → v2
prompt v12 → v13
MCP server changes
tool schema changes
memory schema changes
user population changes
```

若 random split：

```text
2026-09 future log
→ 幫 2026-07 model 驗證 proxy
```

就會造成 deployment-incompatible information leakage。

### Hermes 應改成三種 split

```text
A. Rolling-Origin Cross-Fit
train <= t
validate t+1 block

B. Policy-Version Cross-Fit
never mix future policy version into older certificate validation

C. Environment-Regime Cross-Fit
split across tool/MCP/model/runtime regime changes
```

### 新 contract

```text
TemporalCrossFitContract
├ train_start
├ train_end
├ validation_start
├ validation_end
├ policy_versions_train[]
├ policy_versions_validation[]
├ tool_versions[]
├ environment_regime
├ leakage_checks[]
├ proxy_role_stability
├ gamma_stability
└ regret_stability
```

### 需要追的 drift

```text
Proxy role drift
Bridge drift
Gamma tipping-point drift
World-adversary drift
Action ranking drift
Regret-budget drift
```

### 何時撤銷 certificate

```text
if current policy/runtime version
not covered by temporal validation:
    certificate → STALE
```

### 新否定關係

```text
Random Cross-Fit ≠ Temporal Validity
Held-Out Data ≠ Future-Like Data
No Leakage at Row Level ≠ No Policy-Version Leakage
Past Calibration ≠ Current Runtime Calibration
```

---

## 5. 必須分開 Hidden Confounding 與 Irreducible Stochasticity

### 新論文
**Title:** Robust Counterfactual Policy Optimisation via Nondeterministic Causal Models  
**Authors:** Jessica Lally, Milad Kazemi, Nicola Paoletti, David Watson, Sander Beckers  
**Year:** 2026  
**Date:** 2026-08-03  
**URL:** https://arxiv.org/abs/2608.02893  
**Code:** 本輪未確認到作者公開對應 repository  
**Dataset / Evaluation:** sepsis treatment simulator；diabetes 作為 hidden global confounder  
**Architecture:** probabilistic nondeterministic causal model → sensitivity analysis → robust counterfactual policy optimisation  
**Contribution:** 將 counterfactual sequential policy optimisation 中「latent causal uncertainty」與 MDP 本身 stochastic transition 分開；在 nondeterministic causal model 下尋找 robust counterfactual policy。  
**Limitations:** sensitivity model 仍需 assumptions；simulation benchmark 不代表 general Agent tooling world；本輪未發現公開 source code 可做 directory-level audit。

### 為什麼這對 Hermes 很重要
前幾輪 uncertainty vector 已有：

```text
Aleatoric
Model Epistemic
Bridge Epistemic
Delphic
Sensitivity Width
```

本論文進一步支持：

```text
同一個 next-state 分歧
不能全部丟進 hidden confounding
```

例如：

```text
Payment API network jitter
→ irreducible / operational randomness

User intent not observed but influences both ask-user action and success
→ hidden confounding
```

Hermes World Adversary 必須受到 decomposition 約束：

```text
Adversary can perturb latent-confounding dimensions
within Γ

but cannot arbitrarily rewrite aleatoric transition law
unless that law itself is uncertain
```

否則 worst-case world 會變成任意悲觀故事，而不是 sensitivity analysis。

### 新否定關係

```text
Transition Randomness ≠ Hidden Confounding
Worst-Case World ≠ Arbitrary Impossible World
Sensitivity Analysis ≠ Adversarial Hallucination
```

---

# Architecture Breakdown

## Sensitivity-Calibrated Adversarial Causal Planner

```text
User / Goal
↓
Agent Context + Causal State
↓
Candidate Actions
↓
Temporal Cross-Fit Evidence Store
├ proxy contracts
├ bridge validation
├ negative controls
├ randomized verification
└ historical action outcomes
↓
Sensitivity Budget Calibrator
↓
GammaEnvelope
├ Γ_low
├ Γ_ref
└ Γ_high
↓
Compatible-World Constraint Builder
↓
World Adversary
├ continuous latent parameters
├ discrete graph alternatives
├ proxy failure modes
├ bridge misspecification modes
└ sequential hidden-state trajectories
↓
Action Evaluation in each searched world
↓
Causal Decision Regret
↓
Robust Dominance / Minimax Regret
↓
Causal Decision Certificate
↓
Planner Gate
├ ROBUST_ACT
├ VERIFY_FIRST
├ ASK_USER
├ HUMAN
├ ABSTAIN
└ BLOCK
↓
Execution
↓
Observed outcome / delayed outcome
↓
Update temporal evidence + Gamma calibration
```

---

# Bottom-Level Logic

## A. Γ → propensity uncertainty

概念 MSM：

```text
nominal odds = e(X)/(1-e(X))

hidden world odds
within multiplicative Γ envelope
```

由 Γ 形成 observation-specific weight / propensity bounds：

```text
Γ
↓
lower propensity / weight bound
upper propensity / weight bound
↓
set of admissible reweightings
↓
worst-case outcome / welfare
```

## B. Robust policy optimization

`CausalML/confounding-robust-policy-improvement` 的 `ConfoundingRobustPolicy.fit()` 實際流程：

```text
X,T,Y,q0
↓
for gamma in GAMS:
  get_bnds(q0,gamma)
  ↓
  update optimizer constraints
  ↓
  optimize robust policy
  ↓
  reversion / optimality checks
  ↓
  store policy
↓
calibrate_risk_for_policies(GAMS,POLS)
↓
Gamma_train × Gamma_calibration risk matrix
```

這個 matrix 對 Hermes 很值得直接抽象成：

```text
SensitivitySurface[action/policy, gamma_assumed, gamma_true]
```

## C. World adversary objective

```text
ω* = argmax_{ω∈Ω(Γ)} Regret(a,ω)
```

或者找 dominance counterexample：

```text
ω* = argmin_{ω∈Ω(Γ)} [V(a,ω)-V(b,ω)]
```

若：

```text
min margin < 0
```

則 `a` 不 robustly dominate `b`。

## D. Tipping Gamma

定義某 action 排名第一次翻轉的：

```text
Γ_tip(a,b)
= inf { Γ : ∃ω∈Ω(Γ), V(b,ω) > V(a,ω) }
```

Hermes 顯示：

```text
COMMIT vs ASK_USER
Γ_tip = 1.37

Current defensible Γ range = [1.0, 1.8]
→ ranking not robust
```

比顯示單一 confidence 更可解釋。

---

# Visual Simulation Idea

## **Sensitivity Surface × Adversarial World Explorer**

### Panel A — Γ Slider

```text
Γ = 1.00 ─────●──────── 3.00
```

動態顯示：

```text
SEARCH      [ .47, .55 ]
ASK_USER    [ .42, .58 ]
MCP_WRITE   [ .30, .63 ]
COMMIT      [ .21, .69 ]
```

隨 Γ 增加變成：

```text
SEARCH      [ .42, .58 ]
ASK_USER    [ .37, .62 ]
MCP_WRITE   [ .05, .66 ]
COMMIT      [-.44, .71 ]
```

### Panel B — Action Ranking Tipping Map

```text
Γ
1.0  COMMIT
1.2  COMMIT
1.3  COMMIT / ASK_USER boundary
1.4  ASK_USER
1.8  ASK_USER
2.2  SEARCH
```

### Panel C — Adversarial World Search

```text
World Search
Iteration   Worst margin
1           +0.19
7           +0.08
13          +0.02
18          -0.04  ← counterexample found
```

點開 counterexample：

```text
Hidden intent confounding ↑
Proxy reliability ↓
User-response mediator ↑
Tool stochasticity unchanged

COMMIT      .31
ASK_USER    .35
```

### Panel D — Regret Matrix

```text
             W1    W2    W3    W_adv
SEARCH      .08   .03   .02   .00
ASK_USER    .11   .00   .00   .00
MCP_WRITE   .00   .09   .21   .46
COMMIT      .00   .17   .48   .72
```

### Panel E — Evidence Behind Γ

```text
Observed-covariate benchmark    Γ≈1.25
Negative-control residual       Γ≈1.40
Randomized verification slice   Γ≈1.55
Proxy instability               Γ≈1.35

Defensible range: [1.25,1.60]
```

使用者會第一次真正看到：

> 「不是 AI 信心 60%，而是當 hidden bias 允許到什麼程度時，哪個 action 會開始被另一個 action 擊敗。」

---

# Code / GitHub

## 1. CausalML/confounding-robust-policy-improvement
**Repository:** https://github.com/CausalML/confounding-robust-policy-improvement

### 值得讀的檔案

```text
README.md
methods.py
subgrad.py
unconfoundedness_fns.py
data_scenarios.py
methods_test.py
WHI_eval.py
```

### `methods.py`
核心 class：

```text
ConfoundingRobustPolicy
```

值得讀：

```text
fit()
update_opt_params()
get_upper_gamma_bnds()
calibrate_risk_for_policies()
reversion_check_optimality()
```

`fit()` 不是單點 Γ；它沿 `GAMS` 迭代，為每個 sensitivity setting 建立 bounds、最佳化 policy，再保存 policy path。

`calibrate_risk_for_policies()` 更重要：

```text
policy learned under Γ_i
×
world calibrated under Γ_j
→ worst-case risk
```

這正是 Hermes Sensitivity Surface 的原型。

### `subgrad.py`
值得下一輪繼續深入：

```text
adversarial weight subproblem
projected / constrained gradient procedures
worst-case reweighting
```

### 限制
repository 是較舊的研究 code style / Python 2-era syntax，不能直接當 production runtime；但 optimization decomposition 很值得抽象移植。

## 2. konstantinhess/Efficient_sharp_policy_learning
**Repository:** https://github.com/konstantinhess/Efficient_sharp_policy_learning

結構：

```text
config/
data/
notebooks/
runnables/
src/
```

值得後續追：sharp bound / efficient estimation 如何生成 policy learning uncertainty set，以及能否抽成 Hermes batch calibration job。

---

# Papers

## Paper 1
**Title:** Robust Counterfactual Policy Optimisation via Nondeterministic Causal Models  
**Authors:** Jessica Lally, Milad Kazemi, Nicola Paoletti, David Watson, Sander Beckers  
**Institution:** 作者 affiliations 以論文頁為準  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2608.02893  
**Code:** 本輪未確認公開 repository  
**Dataset:** sepsis treatment simulator  
**Architecture:** nondeterministic causal model + hidden global confounder + sensitivity analysis + robust counterfactual policy optimisation  
**Contribution:** 將 irreducible stochasticity 與 latent confounding 明確分離，再做 robust counterfactual sequential policy optimization。  
**Limitations:** sensitivity assumptions；simulation-centric；尚未完成 source-code audit。  
**改變了什麼:** 讓 Hermes world adversary 不再把「隨機性」與「hidden causal ambiguity」混成同一維度。

## Paper 2
**Title:** Policy Learning under Unobserved Confounding: A Robust and Efficient Approach  
**Authors:** Zequn Jin, Gaoqian Xu, Xi Zheng, Yahong Zhou  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2507.20550  
**Code:** 本輪未確認官方對應 repository  
**Dataset:** simulations + JTPA + Head Start empirical applications  
**Architecture:** MSM uncertainty set → worst-case welfare / policy improvement → doubly robust score → robust policy optimization  
**Contribution:** closed-form robust welfare criteria + doubly robust learning + asymptotic regret bounds under adversarial hidden-confounding scenario。  
**Limitations:** Γ 仍需外部 sensitivity judgment / calibration；batch policy setting與 Agent online runtime仍有工程距離。  
**改變了什麼:** 提供 Hermes `Γ → uncertainty set → worst-case welfare → regret` 的理論骨架。

## Paper 3
**Title:** An Average-Case Sensitivity Analysis for Unmeasured Confounding  
**Authors:** Yao Zhang, Qingyuan Zhao  
**Venue:** Biometrika 113(2), 2026  
**Year:** 2026  
**URL:** https://doi.org/10.1093/biomet/asag030  
**Code:** 本輪未確認  
**Architecture:** average-case sensitivity analysis for unmeasured confounding  
**Contribution:** 不只以最大 hidden bias 做最悲觀 sensitivity；提供 average-case 觀點。  
**Limitations:** 不是直接為 sequential Agent 設計。  
**改變了什麼:** 提醒 Hermes 不應只有一個「全資料最大 Γ」；應允許 state/action/trajectory-specific sensitivity distribution。

## Paper 4
**Title:** Off-policy Predictive Control with Causal Sensitivity Analysis  
**Authors:** Myrl G. Marmarelis, Ali Hasan, Kamyar Azizzadenesheli, R. Michael Alvarez, Anima Anandkumar  
**Venue:** UAI 2025 / PMLR 286  
**Year:** 2025  
**URL:** https://proceedings.mlr.press/v286/marmarelis25a.html  
**Code:** 本輪未確認官方 repository  
**Architecture:** partial observation → generalized causal sensitivity model on future action/state trajectories → sharp interventional bounds → model predictive control  
**Contribution:** 直接把 hidden-confounding sensitivity bounds 放進 sequential predictive controller。  
**Limitations:** sensitivity model validity 與 computational tractability。  
**改變了什麼:** 支持 Hermes 由單步 action bound 升級到 trajectory-level adversarial causal planning。

## Paper 5
**Title:** A Causal Target for Learning to Defer Under Hidden Confounding  
**Authors:** Y. Li, L. Liu, X. Wang, Z. Mao, J. Wu, W. Bao  
**Venue:** AAAI 2026  
**Year:** 2026  
**URL:** https://doi.org/10.1609/aaai.v40i28.39493  
**Architecture:** potential-outcome sharp bounds → bound overlap / width → probabilistic action-vs-deferral target  
**Contribution:** 不只把不確定性變成 interval，而是直接轉成 defer probability。  
**Limitations:** 仍需 hidden-confounding bound assumptions。  
**改變了什麼:** Hermes Planner gate 可以把 action-bound overlap 直接映射到 VERIFY / HUMAN，而不是人工 threshold。

---

# 事實層級標記

## 已確認事實
- MSM / sensitivity methods 用 sensitivity parameter 定義 hidden-confounding uncertainty set。
- `CausalML/confounding-robust-policy-improvement` 的 `ConfoundingRobustPolicy.fit()` 會沿多個 Γ 最佳化 robust policy；`calibrate_risk_for_policies()` 會比較 policy-learning Γ 與 calibration Γ。
- 2026 nondeterministic causal-model paper明確處理 stochasticity 與 hidden confounding 分離。
- robust policy learning paper以 worst-case welfare / policy improvement和 regret為核心。

## 論文結果
- Robust policy learning under MSM 有 asymptotic regret results（依論文 assumptions）。
- Off-policy predictive control sensitivity work可在 partial observability / hidden confounding 下建立 interventional outcome bounds。
- AAAI 2026 CTLD使用 causal bounds overlap / width 建立 deferral target。

## 工程實作
- Sensitivity Surface、World Adversary、GammaEnvelope、CausalDecisionRegretProfile、TemporalCrossFitContract 是本輪為 Hermes 設計的 runtime abstractions。

## 合理推論
- 將 worst-case causal world search用於 Agent Planner，比固定 world ensemble 更能檢測 action-ranking counterexample。
- 使用 temporal / policy-version-aware cross-fitting比 random cross-fitting更符合持續更新 Agent 的部署場景。

## 尚未驗證假說
- 是否能用 negative-control residual + randomized verification + observed-covariate benchmarking穩定校準 production Agent 的 Γ range。
- adversarial world search 在大型 Browser/MCP tool graph 上是否能達到足夠 coverage。
- state/action-specific Γ 是否會比 global Γ 大幅改善 safety-utility tradeoff。

---

# Unknown / Open Questions 1–3

## 1. Γ 的 evidence fusion 應如何有統計 coverage，而不是 heuristic 加權？
目前 `GammaEnvelope` 的多來源 evidence fusion 仍主要是工程模型。需要追：benchmarking、negative controls、partial identification、Bayesian sensitivity distribution 是否能組成可校準 posterior / confidence region。

## 2. 如何知道 adversarial world search 已經「搜得夠深」？
需要 world-search coverage certificate：constraint-space coverage、counterexample discovery curve、multi-start stability、upper bound on unresolved regret。

## 3. Agent trajectory 的 Γ 應該是 global、state-specific、action-specific，還是 time-varying？
不同工具與 action 的 hidden confounding 完全不同；但過細 Γ 會造成 estimation / support 崩潰。需要 hierarchical sensitivity model。

---

# 下一輪研究

## 主題
**Hierarchical Sensitivity Models × World-Search Coverage Certificates × State/Action-Specific Γ × Decision-Focused Verification**

### 下一輪核心問題

```text
Global Γ
↓
可能太粗

Per-state Γ
↓
可能資料不足
```

需要研究：

```text
Global prior
↓
Action-family Γ
↓
State-region Γ
↓
Trajectory Γ
↓
Partial pooling / hierarchical shrinkage
```

並把 adversarial search 的結果接回 active verification：

```text
Adversarial world finds ranking flip
↓
identify which latent assumption causes flip
↓
find observable verification that maximally collapses that ambiguity
↓
Browser / MCP / Human query
↓
shrink Gamma / world set
↓
re-run planner
```

下一輪優先追：
1. hierarchical / heterogeneous sensitivity analysis；
2. sensitivity parameter benchmarking；
3. robust optimization separation oracle / adversarial oracle；
4. counterexample-guided abstraction refinement（CEGAR）能否借到 causal-world search；
5. decision-focused active learning / value of information，專門消除 action-ranking counterexample。

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Sensitivity Budget
Sensitivity Budget Evidence
Gamma Envelope
Gamma Reference Point
Gamma Tipping Point
Observed-Covariate Benchmark
Randomized Verification Gap
Average-Case Sensitivity
State-Specific Sensitivity
Action-Specific Sensitivity
Trajectory Sensitivity
Compatible-World Constraint Set
World Adversary
Adversarial Compatible World
Action-Ranking Counterexample
World Search Coverage
World Search Budget
Robust Margin
Causal Decision Regret
Worst-Case Decision Regret
Minimax-Regret Action
Sensitivity Surface
Temporal Cross-Fit Contract
Policy-Version Leakage
Environment-Regime Split
Nondeterministic Causal Model
Irreducible Stochasticity
Confounding-Stochasticity Decomposition
```

## 新增 Edges

```text
SensitivityBudgetEvidence
→ CALIBRATES
GammaEnvelope

GammaEnvelope
→ CONSTRAINS
CompatibleWorldConstraintSet

CompatibleWorldConstraintSet
→ SEARCHED_BY
WorldAdversary

WorldAdversary
→ FINDS
ActionRankingCounterexample

ActionRankingCounterexample
→ INVALIDATES
RobustActionDominance

CompatibleWorld
→ INDUCES
CausalDecisionRegret

CausalDecisionRegret
→ GATES
PlannerAction

TemporalCrossFitContract
→ VALIDATES
SensitivityBudgetCalibration

IrreducibleStochasticity
→ DISTINCT_FROM
HiddenConfounding
```

## 新增否定 Edges

```text
Sensitivity Parameter ≠ Ordinary Hyperparameter
Calibrated Γ ≠ True Γ Known
Sampled Compatible Worlds ≠ Complete Compatible-World Set
No Counterexample Found ≠ Counterexample Impossible
World Diversity ≠ Worst-Case Coverage
Large Ensemble ≠ Adversarial Coverage
Uncertainty Width ≠ Decision Regret
Nominal Best Action ≠ Minimax-Regret Action
Random Cross-Fit ≠ Temporal Validity
Held-Out Rows ≠ Future-Like Deployment Data
Transition Randomness ≠ Hidden Confounding
Worst-Case World ≠ Arbitrary Impossible World
Sensitivity Analysis ≠ Adversarial Hallucination
```

---

# 本輪結束回答

**缺哪一層？**  
目前最缺的是 **Hierarchical Sensitivity Calibration + World-Search Coverage Certificate**。Hermes 已能定義 robust action，但還不知道 Γ 在不同 action/state 應該多大，也不知道 adversarial search 是否真的覆蓋最危險 causal worlds。

**哪個節點最淺？**  
`GammaEnvelope`、`WorldSearchCoverage`、`GammaTippingPoint`、`CausalDecisionRegret`。

**哪個概念仍只是名詞 / 工程假說？**  
`SensitivityBudgetEvidenceFusion` 與 production-scale `AdversarialCompatibleWorldSearch` 尚未有 Hermes 實證。

**哪個系統值得讀原始碼？**  
下一輪優先繼續讀 `CausalML/confounding-robust-policy-improvement/subgrad.py` 的 adversarial weight optimization，以及 `konstantinhess/Efficient_sharp_policy_learning/src/` 的 sharp policy bound 實作。

**哪篇論文需追引用？**  
第一優先：`Robust Counterfactual Policy Optimisation via Nondeterministic Causal Models (2026)`；第二優先：`Policy Learning under Unobserved Confounding: A Robust and Efficient Approach (2025)`；第三優先：`Off-policy Predictive Control with Causal Sensitivity Analysis (UAI 2025)`。

**哪個概念最適合視覺模擬？**  
`Sensitivity Surface × Adversarial World Explorer`：Γ slider、action tipping map、adversarial search trajectory、regret matrix、Γ evidence panel。

**哪個 Agent 架構最值得實作？**  

```text
Sensitivity-Calibrated Adversarial Causal Planner
=
Temporal Cross-Fit Evidence
+ Gamma Envelope
+ Compatible-World Constraints
+ Adversarial World Search
+ Causal Decision Regret
+ Robust / Minimax-Regret Planner Gate
```

---

# 對「AI 到底怎麼運作」新增的底層

這輪把整條 Agent causal runtime 再補上一段：

```text
使用者一句話
↓
UI
↓
Agent Context
↓
Causal State / Memory / Tools
↓
Candidate Actions
↓
Models predict possible outcomes
↓
但 observational logs 可能 hidden-confounded
↓
Sensitivity Budget Γ
↓
形成 Compatible Causal Worlds
↓
World Adversary 主動搜尋最壞但仍合理的世界
↓
比較各 Action 的 counterfactual value
↓
Causal Decision Regret / Robust Margin
↓
Planner Gate
↓
Tool / MCP / Browser / Human action
↓
World changes
↓
Outcome 回流
↓
重新校準 Γ 與 world set
```

多模態同樣如此：

```text
Camera / Image / Voice / Video
↓
Encoder / Tokens / Fusion
↓
Observed multimodal state
↓
≠ Complete causal world state
↓
Proxy / hidden-state ambiguity
↓
Sensitivity envelope
↓
Adversarial compatible worlds
↓
Robust action selection
```

**核心結論：成熟 Agent 不應只問「哪個 action 的預測值最高？」；它還必須問「我允許多大的 hidden bias？在所有仍與證據相容的世界中，有沒有一個世界會讓這個 action 變成錯的？如果有，選錯的最大 regret 是多少？」只有 sensitivity budget 有證據、world search 沒找到可接受範圍內的 ranking counterexample、且 worst-case regret 落在 budget 內，Planner 才應真正執行高副作用 action。**

---

# Sources

- https://arxiv.org/abs/2608.02893
- https://arxiv.org/abs/2507.20550
- https://doi.org/10.1093/biomet/asag030
- https://proceedings.mlr.press/v286/marmarelis25a.html
- https://doi.org/10.1609/aaai.v40i28.39493
- https://github.com/CausalML/confounding-robust-policy-improvement
- https://github.com/konstantinhess/Efficient_sharp_policy_learning
