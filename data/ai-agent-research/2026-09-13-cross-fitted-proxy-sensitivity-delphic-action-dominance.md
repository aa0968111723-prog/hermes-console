# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 00:51（Asia/Taipei）**

## 本輪研究主題
**Cross-Fitted Proxy Discovery × Neural Doubly-Robust Proximal Estimation × Sensitivity-Budget Calibration × Delphic Uncertainty × Robust Action Dominance**

> 本輪承接上一輪 `Proxy-Role Discovery × Invalid Negative-Control Selection × Bridge Epistemic Uncertainty × Hidden-Confounder Sensitivity × Causal Planner Gate`。上一輪已回答：「proxy candidate 不等於 valid proxy；bridge point estimate 不等於 bridge knowledge；hidden confounding 應輸出 action bounds 而不是一個 confidence」。本輪不重複 proxy/bridge 基礎，而是集中處理一個更危險的 runtime 問題：**如果同一份資料同時被用來挑 proxy、fit bridge、選 sensitivity budget、再 certify planner action，Hermes 會不會產生 selection-induced overconfidence？以及當多個與觀測資料相容的 causal worlds 對 action ranking 不一致時，Planner 到底應該如何判斷「哪個 action 在整個 uncertainty envelope 下仍然支配其他 action」？**

---

# 本小時新發現

## 新論文 / 新架構 / 新機制
1. **Neural Doubly Robust Proximal Causal Estimation（AISTATS 2026）**：同時學 outcome bridge 與 treatment bridge，利用 doubly-robust estimator，在兩個 bridge 中任一個正確指定時維持期望層面的穩健性；同時研究 treatment-bridge estimation accuracy 與 DR variance。這對 Hermes 很重要，因為自動 proxy discovery 後 bridge misspecification 幾乎不可避免。
2. **Doubly Robust Proxy Causal Learning without Density Ratios（2026）**：進一步把 proximal causal learning 推向高維、連續處置，不需顯式 density ratio，提供另一種可工程化的 bridge-combination方向。
3. **Delphic Offline Reinforcement Learning（ICLR 2024）**：delphic uncertainty 並不是一般 epistemic uncertainty，而是「多個與 observational data 相容、但因 hidden confounder 而導致不同 counterfactual value 的 world models 之間的分歧」。它會在資料量增加後仍然存在。
4. **CausalRL `discovery.py` / `ope/bounds.py`**：實際原始碼清楚暴露 causal discovery 與 sensitivity runtime 的邊界：`discovery.py` 的 PC-style路徑預設 causal sufficiency，而 PAG/FCI 路徑才能表達 latent-confounder witness；`ope/bounds.py` 則明確把 sensitivity result 回傳成 interval/certificate，而不是偽裝成 point-identified value。
5. **Robust Action Dominance（本輪工程模型）**：Planner 不應只比較 nominal expected value，而要比較「在 bridge posterior、proxy-set uncertainty、hidden-confounding sensitivity、delphic compatible-world ensemble 下，某 action 是否仍然對其他 action 保有保守優勢」。

---

# 本小時最重要 5 個發現

## 1. Cross-Fitted Proxy Discovery：同一份資料不能同時「發現 proxy」又「證明 proxy 有效」

### 問題
上一輪建立：

```text
Observation Channels
→ Proxy Candidate Pool
→ Role Assignment
→ Bridge Fit
→ Causal Decision Certificate
```

但如果整條 pipeline 都用同一批 trajectory logs：

```text
D
→ 找到最能解釋 outcome 的 proxy
→ 在 D 上 fit bridge
→ 在 D 上測 bridge residual
→ 在 D 上選 gamma / sensitivity budget
→ 在 D 上 certify action
```

那結果很可能出現：

```text
selection-induced overconfidence
```

也就是 proxy 被挑中，正因為它「剛好在這份資料」表現特別好；後續 validation 又在同一資料上進行，導致低估 proxy invalidity、bridge uncertainty 與 action-flip risk。

### 建議架構
Hermes 應採用 cross-fitting / sample-splitting 思維：

```text
Dataset D
↓
K folds

Fold 1:
  Discovery on D\1
  Validate / score on D1

Fold 2:
  Discovery on D\2
  Validate / score on D2

...

↓
Aggregate
├ proxy-role stability
├ held-out bridge residual
├ held-out NC residual
├ held-out action ranking
└ certificate dispersion
```

### 新資料結構

```text
CrossFittedProxyContract
├ proxy_id
├ proposed_role
├ discovery_folds[]
├ validation_folds[]
├ selection_frequency
├ role_stability
├ heldout_nc_residual
├ heldout_bridge_residual
├ effect_dispersion
├ action_flip_frequency
└ status
```

### 為什麼重要
這一層不是 cosmetic statistical hygiene，而是決定 Hermes 是否會把「偶然找到的 proxy」誤當成 causal evidence。

### 新否定關係

```text
In-Sample Bridge Fit ≠ Out-of-Sample Causal Validity
Selected Proxy ≠ Stable Proxy
Low Training Residual ≠ Low Bridge Risk
```

---

## 2. Neural Doubly-Robust Proximal Estimation：bridge 需要「雙路徑容錯」，不能只信單一 h 或 q

### 論文
**Title:** Neural Doubly Robust Proximal Causal Estimation  
**Authors:** Ruolin Meng, Dhanajit Brahma, Ricardo Henao, Lawrence Carin  
**Venue:** AISTATS 2026 / PMLR 300  
**Year:** 2026  
**URL:** https://proceedings.mlr.press/v300/meng26b.html  
**Dataset:** simulations / benchmark setups in paper  
**Architecture:** treatment-inducing proxy + outcome-inducing proxy → outcome bridge h + treatment bridge q → neural estimators → doubly-robust proximal effect  
**Contribution:** proposes neural doubly-robust proximal estimation, gives new accuracy bound for treatment bridge and analyzes DR variance.  
**Limitations:** DR does not mean arbitrary misspecification immunity；it is robust in expectation to one bridge being misspecified, not both simultaneously, and proxy identification assumptions still matter.

### Bottom-Level Logic
Proximal estimator 應不只一條路：

```text
Path A
Z/W/X/A/Y
↓
outcome bridge h
↓
POR-style estimate

Path B
Z/W/X/A/Y
↓
treatment bridge q
↓
PIPW-style estimate

Combined
h + q
↓
Proximal DR
```

抽象 DR correction：

```text
base effect from h
+
q × residual(Y - h)
```

所以 Hermes 不應只有：

```text
bridge_model = h
```

而應：

```text
BridgeSystem
├ outcome_bridge_h
├ treatment_bridge_q
├ h_validation
├ q_validation
├ dr_estimate
├ disagreement
└ misspecification_alarm
```

### 對 Agent Planner 的意義
如果：

```text
h says MCP_WRITE = +0.28
q says MCP_WRITE = -0.04
DR = +0.07
```

那 Planner 應該知道這不是單純「平均值 = +0.10」，而是：

```text
bridge-path disagreement is evidence
```

應提高 VERIFY / ABSTAIN 機率。

### 新否定關係

```text
Doubly Robust ≠ Both Bridges Can Be Wrong
Two Bridge Models ≠ Two Independent Truth Sources
DR Point Estimate ≠ Low Decision Risk
```

---

## 3. Delphic Uncertainty：資料更多也不一定能消除 hidden-causal ambiguity

### 論文
**Title:** Delphic Offline Reinforcement Learning under Nonidentifiable Hidden Confounding  
**Authors:** Alizée Pace, Hugo Yèche, Bernhard Schölkopf, Gunnar Rätsch, Guy Tennenholtz  
**Venue:** ICLR 2024  
**Year:** 2024  
**URL:** https://proceedings.iclr.cc/paper_files/paper/2024/hash/0b9ff9baa226af39f86045ecdc173672-Abstract-Conference.html  
**Dataset:** sepsis simulation + real EHR  
**Architecture:** compatible-world ensemble → latent confounder model → action-value predictions → aleatoric / epistemic / delphic uncertainty decomposition → pessimistic offline RL  
**Contribution:** isolates uncertainty caused by nonidentifiable hidden confounding, distinct from ordinary epistemic and aleatoric uncertainty.  
**Limitation:** practical compatible-world ensemble only approximates the true equivalence class; world-model coverage is itself uncertain.

### Bottom-Level Logic
Delphic uncertainty 的核心不是：

```text
model ensemble variance
```

而是：

```text
observational data D
↓
multiple latent causal worlds W1...Wk
all compatible with D
↓
for each world:
  Q_w(s,a)
↓
world-to-world counterfactual disagreement
↓
Delphic uncertainty
```

可以概念化為：

```text
u_delphic(s,a)
≈ Var_w[ E(Q_w(s,a,Z) | observed state) ]
```

### Hermes 應正式拆開四種 uncertainty

```text
UncertaintyVector
├ aleatoric
├ epistemic_model
├ epistemic_bridge
└ delphic_causal
```

再加：

```text
sensitivity_bound_width
```

因為 sensitivity bound 與 delphic uncertainty 也不是同一件事：
- sensitivity：在某個 Γ / hidden-confounding model class 內，value 可移動多遠。
- delphic：在多個觀測等價 causal worlds 間，counterfactual prediction 的分歧。

### 關鍵結論

```text
More Data
→ epistemic_model ↓

但不保證
→ delphic_causal ↓
```

因此如果 Hermes 的 causal ambiguity 是「不可識別」而不是「樣本不足」，繼續累積相同 observation logs 可能沒有幫助；它需要新的 intervention、new proxy channel、randomized verification 或 domain constraint。

---

## 4. GitHub 原始碼：`causalrl` 清楚顯示「causal discovery」與「hidden-confounding bounds」是不同層

### GitHub
**Repo:** https://github.com/raphaelrrcoelho/causalrl

本輪不重複上一輪的 `certificate.py / certify_policy()`，改追兩個新核心檔案：

```text
src/causalrl/discovery.py
src/causalrl/ope/bounds.py
```

### `discovery.py`
原始碼的 module docstring 明確說明：

```text
PC path:
  assumes causal sufficiency + faithfulness
  returns CPDAG
```

而 `PAG` 結構能用：

```text
a <-> b
```

表達 latent confounder witness。

這對 Hermes 很重要：

```text
Causal discovery output
≠
Causal graph truth
```

如果 discovery routine 假設 causal sufficiency，而 Agent runtime 明明存在大量 latent world state，就不能把 CPDAG 當最終 world model。

`conditional_mutual_information()` 的底層還值得注意：PC/FCI 等 discovery 最終都反覆落到：

```text
I(X;Y|Z)
```

的 conditional-independence test；原始碼使用離散 cell counting、dense/sparse path，說明 discovery 的 computational bottleneck 其實落在 conditioning-set combinatorics × CI tests。

### `ope/bounds.py`
這個檔案把 confounded logs 的 policy evaluation 拆成：

```text
causal_q_bounds
ipw_sensitivity_bounds
msm_policy_value_bounds
msm_contribution_bounds
msm_per_step_bounds
msm_stratified_bounds
```

最關鍵的 runtime 行為：

```text
p(action|state) = 0
→ causal_q_bounds = [0,1]
→ require_identified=True 時直接丟 NotIdentifiableError
```

而不是：

```text
沒有資料
→ 模型猜一個數字
```

此外 MSM sensitivity 使用 Γ 約束 hidden confounding 下的 inverse weights：

```text
nominal propensity e
↓
odds = (1-e)/e
↓
weight interval
[1 + odds/Γ,
 1 + odds·Γ]
↓
extreme stabilized weighted means
↓
value interval
```

### 對 Hermes 的核心啟示
應建立：

```text
Evidence Ladder
IDENTIFIED
BOUNDED
EMPIRICAL
DELPHIC
UNIDENTIFIED
```

其中 `DELPHIC` 不是統計 library 的既有類別，而是本輪建議的 Agent-specific epistemic status：資料支援多個相容 world，且 action ranking 不穩定。

---

## 5. Robust Action Dominance：Planner 要問的是「這個 action 在整個可接受 causal uncertainty set 中都更好嗎？」

上一輪 Planner API 已有：

```text
Action Causal Bounds
```

本輪再往下拆：單一 action 的 bound 還不夠，因為 Planner 的核心其實是「排序」。

### 定義工程化 uncertainty set

```text
CausalWorldSet Ω
=
Proxy-validity uncertainty
× Bridge posterior
× Bridge misspecification alternatives
× Sensitivity Γ range
× Compatible latent-world ensemble
× Finite-sample uncertainty
```

對每個 action：

```text
V(a; ω),  ω ∈ Ω
```

Hermes 應問：

```text
Does action a dominate b?

min_{ω∈Ω} [ V(a;ω) - V(b;ω) ] > safety_margin ?
```

如果成立：

```text
ROBUSTLY_DOMINANT
```

如果只有 nominal world 成立：

```text
NOMINAL_ONLY
```

如果 action ranking 在 Ω 內翻轉：

```text
RANK_UNSTABLE
```

如果 evidence 本身 unsupported：

```text
UNIDENTIFIED
```

### 新 Planner Gate

```text
Candidate Actions
↓
Cross-fitted Proxy Contracts
↓
Bridge h/q + DR
↓
Bridge posterior
↓
Sensitivity envelope Γ
↓
Compatible-world ensemble
↓
Action value matrix
         worlds →
SEARCH      .55 .53 .49 .51
ASK_USER    .48 .50 .54 .57
MCP_WRITE   .62 .44 .20 -.08
COMMIT      .70 .31 -.22 -.41
↓
Pairwise dominance matrix
↓
Action ranking stability
↓
Planner Verdict
```

### 建議 verdict

```text
ROBUST_ACT
VERIFY_THEN_ACT
ASK_USER
ABSTAIN
HUMAN_APPROVAL
BLOCK
```

### 為什麼這比 confidence 好
`confidence=.82` 沒告訴 Planner：
- 0.82 是哪一種 uncertainty？
- 另一個 action 是否其實在 worst-case 下更好？
- hidden-confounding assumptions 改一點會不會 action flip？

Robust dominance 直接回答 decision question。

---

# Architecture Breakdown

本輪 Hermes architecture 收斂為：

```text
Raw Agent Logs / Multimodal Observations
↓
Typed Causal Event Graph
↓
K-Fold / Cross-Fitting Split Manager
↓
Proxy Candidate Discovery
├ Text / Context
├ Memory
├ Browser
├ Tool
├ MCP
├ Vision
├ Audio
└ Runtime metadata
↓
Held-Out Proxy Role Validation
├ temporal constraints
├ negative controls
├ exclusion diagnostics
├ role stability
└ invalid-proxy robustness
↓
CrossFittedProxyContract
↓
Bridge System
├ outcome bridge h
├ treatment bridge q
├ neural estimators
├ bridge posterior
└ proximal DR estimate
↓
Compatible Causal Worlds
├ proxy alternatives
├ bridge alternatives
├ latent-confounder models
└ sensitivity Γ grid
↓
Uncertainty Decomposition
├ Aleatoric
├ Model Epistemic
├ Bridge Epistemic
├ Delphic
└ Sensitivity Width
↓
Action Value Envelope
↓
Robust Action Dominance
↓
CausalDecisionCertificate
↓
Planner Gate
├ ROBUST_ACT
├ VERIFY_THEN_ACT
├ ASK_USER
├ ABSTAIN
├ HUMAN_APPROVAL
└ BLOCK
```

---

# Bottom-Level Logic

## A. Cross-fitting

```text
for k in folds:
  train = D \ fold_k
  test  = fold_k

  proxy_set_k = discover_proxy(train)
  h_k, q_k = fit_bridges(train, proxy_set_k)

  validate on test:
    nc_residual_k
    bridge_residual_k
    dr_effect_k
    action_rank_k

aggregate across folds
```

Hermes 最重要的不是 fold-average effect，而是：

```text
selection_frequency(proxy)
role_consistency(proxy)
action_rank_stability
certificate_dispersion
```

## B. Neural Proximal DR

```text
Observation
→ encode X,Z,W,A,Y
→ neural h(W,A,X)
→ neural q(Z,A,X)
→ residual correction
→ DR causal effect
→ cross-fit aggregation
```

## C. Delphic World Ensemble

```text
Observed D
↓
Generate / fit compatible causal worlds
W1 ... Wm
↓
for each action a:
  counterfactual value V_w(a)
↓
world variance
↓
delphic uncertainty
```

## D. Sensitivity Envelope

```text
Nominal propensity / causal model
↓
Γ grid
1.0, 1.1, 1.25, 1.5, 2, ...
↓
for each Γ:
  value lower/upper
  preferred action
↓
Tipping Γ
```

## E. Robust Dominance

```text
for every pair (a,b):
  worst_gap(a,b)
    = min_ω V(a,ω)-V(b,ω)

if worst_gap > margin:
  a robustly dominates b
```

最後建立 partial order，而不是硬排序所有 action。

---

# Visual Simulation Idea

## Cross-Fitted Causal Action Dominance Lab

### Panel 1 — Proxy Stability Matrix

```text
             fold1 fold2 fold3 fold4 fold5
browser_age     ✓     ✓     ✓     ✓     ✓
memory_tag      ✓     ✕     ✓     ✕     ✓
tool_latency    Z?    Z?    ✕     Z?    ✕
vision_feat_42  W?    W?    W?    W?    W?
```

顯示：

```text
Selection Frequency
Role Stability
Held-out NC Residual
Bridge Residual
```

### Panel 2 — Bridge Dual-Path Viewer

```text
Outcome Bridge h      +0.24 ± .08
Treatment Bridge q    +0.06 ± .11
DR Effect             +0.10 ± .09
Disagreement          HIGH ⚠
```

### Panel 3 — Compatible World Cube

三個軸：

```text
X = sensitivity Γ
Y = bridge posterior sample
Z = proxy-set alternative
```

顏色代表 preferred action。

### Panel 4 — Robust Dominance Graph

```text
SEARCH ─────▶ MCP_WRITE
   │
   └────────▶ COMMIT

ASK_USER ───▶ COMMIT
```

箭頭 `A → B` 表示：

```text
A robustly dominates B
under current causal uncertainty set
```

若 SEARCH 與 ASK_USER 沒有箭頭，代表兩者 ranking 未能穩健識別。

### Panel 5 — Planner Decision

```text
SEARCH
nominal value          .53
robust lower value     .47
delphic uncertainty    .05
bridge EU              .04
tipping Γ              >2.0
rank stable            YES

STATUS
ROBUST_ACT ✓
```

而：

```text
MCP_WRITE
nominal value          .62
robust lower value    -.08
delphic uncertainty    .31
bridge EU              .17
tipping Γ              1.18
rank stable            NO

STATUS
VERIFY_THEN_ACT ⚠
```

---

# Code / GitHub

## 1. `raphaelrrcoelho/causalrl`
Repo: https://github.com/raphaelrrcoelho/causalrl

### 本輪實際追的核心檔案

```text
src/causalrl/discovery.py
src/causalrl/ope/bounds.py
```

### 值得繼續讀

```text
src/causalrl/identification/
src/causalrl/conformal/
src/causalrl/ope/sequential.py
src/causalrl/certify/
```

### 本輪原始碼結論
- `discovery.py` 的 PC 路徑明列 causal sufficiency assumption，代表它不能直接解 latent-confounded Agent world。
- `PAG` 可表示 bidirected edge，適合作為 hidden-confounder witness layer。
- `conditional_mutual_information()` 是 CI discovery 的 inner loop，conditioning-set combinatorics 會成為 discovery scaling bottleneck。
- `ope/bounds.py` 對 never-logged state-action 會回傳 vacuous bound / `NotIdentifiableError`，這正是 Hermes 應採用的 fail-closed behavior。
- MSM sensitivity runtime 把 Γ 映射成 inverse-weight interval，再求 extreme stabilized means；因此 Γ 是一個 decision-sensitivity control，不是 confidence score。

## 2. Neural DR Proximal
本輪已驗證 AISTATS 2026 PMLR 論文，但沒有驗證到作者官方公開 GitHub，因此不虛構 code URL。

---

# Papers

## Paper A
**Title:** Neural Doubly Robust Proximal Causal Estimation  
**Authors:** Ruolin Meng, Dhanajit Brahma, Ricardo Henao, Lawrence Carin  
**Institution:** authors affiliated with Duke / related research groups as listed in paper  
**Year:** 2026  
**URL:** https://proceedings.mlr.press/v300/meng26b.html  
**Code:** no official repository verified this round  
**Architecture:** neural outcome bridge + neural treatment bridge + proximal DR  
**Contribution:** high-dimensional neural proximal DR, treatment-bridge error analysis, DR variance analysis  
**Limitations:** bridge/proxy assumptions remain；both bridges wrong can still fail.

## Paper B
**Title:** Delphic Offline Reinforcement Learning under Nonidentifiable Hidden Confounding  
**Authors:** Alizée Pace, Hugo Yèche, Bernhard Schölkopf, Gunnar Rätsch, Guy Tennenholtz  
**Institution:** Max Planck Institute / ETH Zürich / Google Research affiliations across versions  
**Year:** 2024 (ICLR; arXiv 2023)  
**URL:** https://proceedings.iclr.cc/paper_files/paper/2024/hash/0b9ff9baa226af39f86045ecdc173672-Abstract-Conference.html  
**Code:** official code repository not independently verified this round  
**Dataset:** sepsis simulation + EHR  
**Architecture:** compatible-world latent models + Q estimates + uncertainty decomposition + pessimistic ORL  
**Contribution:** separates delphic uncertainty from aleatoric/epistemic uncertainty  
**Limitations:** compatible-world ensemble is approximation；nonidentifiability is mitigated, not magically solved.

## Paper C
**Title:** Instrumental and Proximal Causal Inference with Gaussian Processes  
**Authors:** Yuqi Zhang, Krikamol Muandet, Dino Sejdinovic, Edwin Fong, Siu Lun Chau  
**Venue:** UAI 2026 / PMLR 337  
**URL:** https://proceedings.mlr.press/v337/zhang26f.html  
**Architecture:** Deconditional Gaussian Process for IV/proximal learning  
**Contribution:** posterior variance gives bridge epistemic uncertainty; marginal likelihood enables model selection  
**Limitation:** low posterior variance does not validate causal proxy assumptions.

## Paper D
**Title:** Doubly Robust Proxy Causal Learning without Density Ratios  
**Authors:** Bariscan Bozkurt, Houssam Zenati, Dimitri Meunier, Liyuan Xu, Arthur Gretton  
**Year:** 2026  
**Architecture:** kernel proximal causal learning combining outcome/treatment bridges without explicit density-ratio estimation  
**Contribution:** high-dimensional / continuous treatment friendly DR proxy learning  
**Limitation:** still relies on proximal identification structure.

---

# Unknown / Open Questions

## 1. Sensitivity Budget Γ 到底如何校準？
目前最危險的點仍是：

```text
Γ = 1.5
```

代表什麼實際世界條件？

如果 Γ 只是工程師手動選一個數字：

```text
Sensitivity Analysis
≠
Calibrated Safety Guarantee
```

下一步需要研究：
- negative controls 是否能 lower-bound plausible Γ；
- randomized verification 能否估計 hidden-selection strength；
- observed proxy mismatch 是否能轉成 Γ prior / range；
- domain expert constraints 是否能成為 Γ evidence。

## 2. Compatible-world ensemble 怎麼知道「已經夠多」？
Delphic uncertainty 的工程難點不是 variance formula，而是：

```text
是否漏掉重要 compatible causal worlds？
```

若 world generator 很窄，delphic uncertainty 會被嚴重低估。

需要：
- world diversity diagnostics；
- causal equivalence coverage；
- adversarial world search；
- certificate that lists excluded world classes。

## 3. Cross-fitting 遇到非平穩 Agent logs 怎麼辦？
Agent policy / tool version / UI / MCP server 都會變。

隨機 K-fold 可能把：

```text
future policy regime
```

洩漏進 training fold。

因此 Agent runtime 可能需要：

```text
Temporal Cross-Fitting
Policy-Version Cross-Fitting
Environment-Regime Split
```

而不是一般 IID random fold。

---

# 下一輪研究

## 主題
**Sensitivity-Budget Calibration × Adversarial Compatible-World Search × Temporal Cross-Fitting × Causal Decision Regret**

### 下一輪核心問題
目前 Hermes 已經有：

```text
proxy contracts
bridge posterior
DR estimator
sensitivity bounds
delphic compatible worlds
robust action dominance
```

但仍有兩個未解核心：

```text
1. Γ 的 plausible range 從哪裡來？
2. compatible worlds 是否漏掉最危險的世界？
```

### 下一輪應追的 pipeline

```text
Negative Controls
+
Randomized Verification
+
Proxy Mismatch
+
Domain Constraints
↓
Sensitivity Budget Evidence
↓
Γ Prior / Range
↓
Adversarial Compatible-World Generator
↓
Search for action-ranking counterexample
↓
Worst-Case Decision Regret
↓
Planner Gate
```

並研究：

```text
If there exists a plausible world
where chosen action loses badly,
should Hermes still act?
```

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Cross-Fitted Proxy Discovery
Cross-Fitted Proxy Contract
Proxy Selection Frequency
Proxy Role Stability
Held-Out Negative-Control Residual
Held-Out Bridge Residual
Neural Outcome Bridge
Neural Treatment Bridge
Proximal Doubly Robust Estimator
Bridge-Path Disagreement
Bridge Misspecification Alarm
Delphic Uncertainty
Compatible Causal World
Compatible-World Ensemble
World-Coverage Diagnostic
Sensitivity Budget
Sensitivity Tipping Gamma
Causal Uncertainty Set
Action Value Envelope
Robust Action Dominance
Pairwise Causal Dominance
Action Ranking Stability
Causal Decision Partial Order
Selection-Induced Overconfidence
Temporal Cross-Fitting
Policy-Version Cross-Fitting
```

## 新增 Edges

```text
Proxy Discovery
→ requires → Held-Out Validation

Cross-Fitting
→ reduces → Selection-Induced Overconfidence

Outcome Bridge h
+ Treatment Bridge q
→ combined_by → Proximal DR

Compatible Causal Worlds
→ induce → Delphic Uncertainty

Sensitivity Budget
→ controls → Causal Value Envelope

Causal Value Envelope
→ determines → Robust Action Dominance

Robust Action Dominance
→ gates → Planner Action
```

## 新增否定 Edges

```text
Selected Proxy ≠ Stable Proxy
In-Sample Fit ≠ Causal Validation
Doubly Robust ≠ Assumption Free
Doubly Robust ≠ Both Bridges Wrong Is Safe
More Data ≠ Less Delphic Uncertainty
Epistemic Uncertainty ≠ Delphic Uncertainty
Sensitivity Width ≠ Delphic Uncertainty
Nominal Best Action ≠ Robustly Best Action
Point Estimate ≠ Stable Ranking
Low Posterior Variance ≠ Identification
World Ensemble ≠ Complete World Set
Cross-Fitting ≠ Validity Proof
```

---

# 本輪結束回答

## 缺哪一層？
**Sensitivity-Budget Calibration + Compatible-World Coverage / Adversarial World Search。**

## 哪個節點最淺？
1. `SensitivityBudgetCalibration`
2. `WorldCoverageDiagnostic`
3. `TemporalCrossFittedProxyContract`
4. `CausalDecisionRegret`

## 哪個概念仍只是名詞？
目前 `Adversarial Compatible-World Search` 在 Hermes 中仍主要是架構概念，尚缺穩定的 runtime 定義與可測 coverage criterion。

## 哪個系統值得讀原始碼？
優先：

```text
causalrl/src/causalrl/discovery.py
causalrl/src/causalrl/ope/bounds.py
causalrl/src/causalrl/ope/sequential.py
causalrl/src/causalrl/conformal/
```

其次應追 Neural Doubly Robust Proximal Estimation 的作者 code（若正式釋出）。

## 哪篇論文需追引用？
優先：**Neural Doubly Robust Proximal Causal Estimation（AISTATS 2026）**，因為它直接決定高維 Agent observation channel 下 proximal bridge 是否可實際工程化；第二優先是 **Delphic Offline RL** 的後續引用，特別是 compatible-world coverage 與 decision-aware confounding uncertainty。

## 哪個概念最適合視覺模擬？
**Cross-Fitted Causal Action Dominance Lab**。

## 哪個 Agent 架構最值得實作？
**Cross-Fitted Robust-Causal Planner Runtime**：

```text
Observation
→ Cross-Fitted Proxy Discovery
→ Dual Bridge + Proximal DR
→ Bridge Posterior
→ Sensitivity Envelope
→ Compatible-World Ensemble
→ Delphic Uncertainty
→ Robust Action Dominance
→ Causal Decision Certificate
→ Planner Gate
```

---

# 對「AI 到底怎麼運作」的新補充

這輪把 Agent 的完整鏈再往下補一層：

```text
User input
→ UI
→ Agent
→ Context / Memory
→ Reasoning / Planning
→ Candidate Tool Action
→ Observational History
→ Proxy Discovery
→ Hidden-State Causal Model
→ Bridge Estimation
→ Compatible Causal Worlds
→ Action Counterfactual Envelope
→ Robust Dominance
→ Planner Gate
→ Tool / MCP / Browser
→ World changes
→ New observations
```

因此，成熟 Agent 不能只問：

> 「哪個 action 的預測分數最高？」

它還必須問：

> 「這個 action 的優勢是不是只存在於我剛好選中的 proxy、剛好 fit 出來的 bridge、剛好假設的 hidden-confounding strength、或某一個 compatible world？如果把這些合理但未確定的 causal choices 都納入，這個 action 還能不能穩健地勝過其他選項？」

這是從「會預測的 AI」走向「知道自己的 causal evidence 到底有多穩的 Agent」的一層。