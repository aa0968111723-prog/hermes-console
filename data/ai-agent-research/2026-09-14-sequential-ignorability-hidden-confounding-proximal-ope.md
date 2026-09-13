# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 01:54（Asia/Taipei）**

**本輪主題：Sequential Ignorability × Hidden Confounding × Positivity × Sensitivity Bounds × Proximal OPE × Interactive-Agent Causal Identification**

---

## 本小時新發現

本輪承接上一輪 `Query Causal Identifiability × Human-State Carryover × Joint Query/Action OPE`，但不再重複「query 是 intervention」或「joint propensity 要被記錄」；而是進一步回答一個更根本的問題：

> **即使 Hermes 已經完整記錄 query/action propensity，歷史互動資料是否真的足以識別新 interactive policy 的因果效果？**

本輪核心答案是：**不一定。**

因為標準 OPE 常隱含 sequential ignorability / no hidden confounding 類條件：在給定已記錄 history / state 後，行動選擇不能再和未觀察、同時影響 outcome 的 latent variable 相關。

但真實 Agent runtime 裡可能存在：

```text
latent user urgency U_t
├→ Agent decides ASK_USER vs ACT
├→ user future response
└→ task outcome

latent tool health Z_t
├→ routing/model/tool selection
└→ execution success

latent operator skill H_t
├→ manual takeover probability
└→ eventual task quality
```

即使 log 中有：

```text
P(chosen_action | observed_history)
```

若 observed history 沒把真正 confounding state 捕捉完整，普通 IPS / DR / Bellman OPE 仍可能有系統性偏誤。

因此本輪正式建立：

```text
CausalIdentificationStatus
├ IDENTIFIED_BACKDOOR
├ IDENTIFIED_RANDOMIZATION
├ IDENTIFIED_INSTRUMENTAL
├ IDENTIFIED_PROXIMAL
├ PARTIALLY_IDENTIFIED_BOUNDS
├ SENSITIVITY_ONLY
├ SUPPORT_VIOLATION
├ HIDDEN_CONFOUNDING_UNRESOLVED
└ NOT_IDENTIFIED
```

本輪優先交叉驗證來源：

- Zhang & Bareinboim, **Causal Eligibility Traces for Confounding Robust Off-Policy Evaluation**, UAI 2025
  https://proceedings.mlr.press/v286/zhang25d.html
- Marmarelis et al., **Off-policy Predictive Control with Causal Sensitivity Analysis**, UAI 2025
  https://proceedings.mlr.press/v286/marmarelis25a.html
- Venkatesh & Malikopoulos, **Model-Based Reinforcement Learning Under Confounding**, 2025
  https://arxiv.org/abs/2512.07528
- Meng et al., **Neural Doubly Robust Proximal Causal Estimation**, AISTATS 2026
  https://proceedings.mlr.press/v300/meng26b.html
- Zhang et al., **Instrumental and Proximal Causal Inference with Gaussian Processes**, UAI 2026
  https://proceedings.mlr.press/v337/zhang26f.html
- Faruque et al., **Spatiotemporal Proximal Causal Inference under Hidden Confounding and Interference**, 2026
  https://arxiv.org/abs/2608.01352
- PyWhy / DoWhy official source
  https://github.com/py-why/dowhy

---

# 本小時最重要 5 個發現

## 1. Logged propensity 並不能替代 Sequential Ignorability

### 已確認事實

標準 sequential OPE 中，常見假設可以概念化為：

```text
A_t ⟂ FuturePotentialOutcomes
|
H_t
```

其中 `H_t` 必須包含足以阻斷 action assignment 與 future outcome 間 backdoor path 的資訊。

如果存在未觀察 confounder `U_t`：

```text
U_t
├→ A_t
└→ Y_{t+1:T}
```

那即使精確知道：

```text
μ(A_t | H_t)
```

也不能自動得到：

```text
P(Y | do(A_t=a), H_t)
```

### 對 Agent 的具體例子

```text
latent user frustration
├→ Agent detects weak proxy → chooses ASK_USER
└→ user later abandons task
```

離線資料可能顯示：

```text
ASK_USER → higher abandonment
```

但真正 causal explanation 可能是：

```text
frustration
→ ASK_USER
frustration
→ abandonment
```

並不代表 ASK_USER 自己造成全部差異。

### Hermes implication

不能只有：

```text
JointPolicyDecisionRecord
behavior_probability
```

還需要：

```text
SequentialConfoundingAudit
├ state_representation_id
├ candidate_confounders[]
├ observed_adjustment_set[]
├ latent_confounder_hypotheses[]
├ negative_controls[]
├ proxy_candidates[]
├ assignment_model_residual_tests[]
└ identification_status
```

### 新核心否定 edge

```text
Logged Propensity
≠ Sequential Ignorability
```

以及：

```text
Good Behavior-Policy Fit
≠ No Hidden Confounding
```

---

## 2. Positivity Failure 與 Hidden Confounding 是兩個不同失敗模式，不能只用同一個「uncertainty 高」表示

### Positivity / overlap

如果 target policy 想採用：

```text
π(VERIFY | h) > 0
```

但 behavior policy 在該 history 從未 verify：

```text
μ(VERIFY | h) = 0
```

這是 **support failure**。

### Hidden confounding

若：

```text
μ(VERIFY | h) > 0
```

但 Agent 是否 verify 還依賴 log 沒記錄的 latent state：

```text
U_t → VERIFY
U_t → outcome
```

這是 **hidden confounding**。

兩者可能同時存在，但處理方式不同。

### 2025 UAI Causal Eligibility Traces 的重要進展

Zhang & Bareinboim 研究 biased offline sequential data，在 unobserved confounding 與 no-overlap 都可能存在時，不再強迫 point-identify value，而是延伸 Bellman 結構得到 value bounds，並用 eligibility traces 做 finite-data estimation。

對 Hermes 最大的啟發：

```text
Point Estimate unavailable
≠ Evaluation impossible
```

可以改成：

```text
TargetPolicyValue
∈ [LowerBound, UpperBound]
```

然後將 permission 判斷改成 pessimistic：

```text
if LowerBound > safety_threshold:
    candidate for deploy
else:
    block / pilot / collect support
```

### 新增

```text
InteractiveSupportCertificate
├ action_support
├ query_support
├ state_support
├ history_support
├ minimum_behavior_probability
├ extrapolation_fraction
└ support_status
```

與：

```text
ConfoundingRobustValueBound
├ lower_value
├ upper_value
├ confounding_model
├ overlap_regime
├ horizon
└ assumptions
```

### 核心否定

```text
No Overlap
≠ Hidden Confounding

Wide IS Variance
≠ Hidden Confounding Evidence Automatically

Point OPE Failure
≠ No Useful Bound
```

---

## 3. Sensitivity Analysis 應成為 Agent runtime 的一級「假設旋鈕」，而不是事後統計附錄

### 論文結果

Marmarelis et al. 2025 的 **Off-policy Predictive Control with Causal Sensitivity Analysis** 處理 partial observation 下的 hidden confounding，使用 generalized causal sensitivity model 約束 future actions 與 future states 之間可能存在的隱藏混淆，計算 interventional outcome bounds；其 sensitivity model 允許 confounding with memory，而不只單一步 treatment-outcome confounding。

這對 Agent 很重要，因為 latent variable 很可能持續多步：

```text
U_t = user urgency / tool degradation / task difficulty
↓
A_t
↓
U_{t+1} correlated with U_t
↓
A_{t+1}
↓
...
```

所以不能只問：

```text
「若存在一個未觀察 confounder，單步 effect 會變多少？」
```

而應問：

```text
「在 confounding memory strength Γ 與 horizon H 下，整條 trajectory policy value 還安全嗎？」
```

### Hermes 新元件

```text
CausalSensitivityContract
├ sensitivity_family
├ gamma_or_strength
├ memory_horizon
├ affected_action_classes[]
├ affected_outcomes[]
├ lower_value_bound
├ upper_value_bound
├ policy_rank_stability
└ permission_stability
```

### Permission stability

例如：

```text
Γ = 1.0 → WRITE_EXTERNAL preferred
Γ = 1.2 → WRITE_EXTERNAL still preferred
Γ = 1.5 → ASK_USER preferred
Γ = 2.0 → BLOCK
```

真正要視覺化的不是單一 estimate，而是：

```text
Policy Decision
vs.
Unobserved Confounding Strength
```

### 核心 edge

```text
Causal Point Estimate
→ Sensitivity Curve
→ Permission Stability
```

---

## 4. Proximal Causal Inference 提供一條很適合 Agent 的路：不必直接恢復 hidden confounder，但要有合法 proxy 與 completeness 條件

### 問題

一般 backdoor adjustment 要求觀察足夠 confounders：

```text
U observed
→ adjust U
```

但 Agent 中 latent state 常無法直接觀察：

```text
true user intent
true operator expertise
hidden tool health
latent environment difficulty
```

### Proximal idea

Proximal causal inference 不要求直接 recover `U`，而利用兩類 proxy：

```text
Z = treatment-inducing proxy
W = outcome-inducing proxy
```

透過 confounding bridge function，把 latent confounding effect 從 observable proxy distribution 中識別出來。

概念鏈：

```text
Hidden confounder U
↓             ↓
Z proxy       W proxy
↓             ↓
bridge equation
↓
causal estimand
```

### 2026 最新進展

Meng et al. AISTATS 2026 的 **Neural Doubly Robust Proximal Causal Estimation** 同時考慮 outcome bridge 與 treatment bridge，再構造 doubly robust estimator；其保證是：兩個 bridge function 中只要有一個正確指定，估計在 expectation 下仍具 robustness（不是兩個都錯也能救）。

Zhang et al. UAI 2026 則把 instrumental / proximal inference 放進 Gaussian Process 框架，提供 posterior variance 形式的 epistemic uncertainty，而不只有 point estimate。

Faruque et al. 2026 更進一步把 proximal identification 擴展到 spatiotemporal hidden confounding + interference，加入 local / neighborhood proxy 與 completeness 條件。

### Agent proxy 的工程候選

例如 latent `user urgency U_t`：

```text
Z candidates:
- time since last user response
- frequency of urgent wording before decision
- session interruption pattern

W candidates:
- future response latency
- takeover behavior
- downstream correction frequency
```

但非常重要：

```text
Proxy Correlated With U
≠ Valid Proximal Proxy Automatically
```

還需要 exclusion / completeness 類假設。

### Hermes 新元件

```text
ProximalProxyContract
├ latent_confounder_hypothesis
├ treatment_proxy_Z[]
├ outcome_proxy_W[]
├ exclusion_status
├ completeness_status
├ bridge_model_id
├ bridge_residual_test
├ uncertainty
└ identification_status
```

### 核心否定

```text
Hidden State Embedding
≠ Valid Confounder Proxy

High Mutual Information With Outcome
≠ Valid Outcome Proxy Automatically

Proximal Identification
≠ Hidden Confounder Recovery
```

---

## 5. 真正 production 級 Causal OPE 不應只輸出一個分數，而應輸出「Identification Decision Tree」

### 新架構結論

Hermes 不應收到歷史 log 後直接：

```text
run IPS
→ target value 7.2
```

而應：

```text
Historical Interactive Log
↓
1. Define causal target
↓
2. Audit timeline / interference
↓
3. Audit measured state sufficiency
↓
4. Audit action/query positivity
↓
5. Search valid adjustment set
↓
6. Search instrument / proxies
↓
7. Choose identification regime
├ Backdoor
├ Randomized
├ Instrumental
├ Proximal
├ Partial Identification
├ Sensitivity Analysis
└ Not Identified
↓
8. Estimate / bound
↓
9. Robustness + support audit
↓
10. Permission decision
```

### DoWhy 原始碼深讀

本輪直接讀官方：

https://github.com/py-why/dowhy

不是只看 README。

`dowhy/causal_refuters/` 中目前可見：

```text
add_unobserved_common_cause.py
assess_overlap.py
assess_overlap_overrule.py
evalue_sensitivity_analyzer.py
linear_sensitivity_analyzer.py
non_parametric_sensitivity_analyzer.py
partial_linear_sensitivity_analyzer.py
...
```

其中 `add_unobserved_common_cause.py` 的 `AddUnobservedCommonCause` 真正支援：

```text
simulation_method =
├ direct-simulation
├ linear-partial-R2
├ non-parametric-partial-R2
└ e-value
```

而且把 confounder 對 treatment 與 outcome 的 effect strength 分開建模：

```text
effect_strength_on_treatment
effect_strength_on_outcome
```

這對 Hermes 很值得借用，因為目前我們的 uncertainty / causal certificate 常只有：

```text
hidden_confounding = high
```

更好的形式應是：

```text
ConfounderStrengthAxis
├ effect_on_query_assignment
├ effect_on_world_action_assignment
├ effect_on_feedback_visibility
├ effect_on_outcome
└ persistence_across_time
```

另外 `assess_overlap.py` 直接用 `OverruleAnalyzer` 學 support / overlap rules，並用 `overlap_eps` 定義 propensity overlap region；這說明 production causal runtime 可以將「support」變成可解釋 ruleset，而不是只顯示最低 propensity 數字。

### Hermes 借用的工程邊界

```text
Causal Target
≠ Identification
≠ Estimation
≠ Refutation
≠ Sensitivity
≠ Support Audit
```

應該分層。

---

# Architecture Breakdown

本輪建立 Hermes 的：

# Interactive Causal Identification Runtime

```text
User / UI / Camera / Voice / Tool / MCP / Human Feedback
↓
Event + Intervention Ledger
↓
JointPolicyDecisionRecord
↓
Causal Target Builder
├ target policy
├ target population
├ horizon
├ outcome
└ intervention scope
↓
Sequential Confounding Auditor
├ observed state sufficiency
├ hidden-confounder hypotheses
├ human-state latent variables
├ tool/environment latent variables
└ interference graph
↓
Support / Positivity Auditor
├ state support
├ world-action support
├ information-action support
└ history support
↓
Identification Router
├ RANDOMIZED
├ BACKDOOR
├ INSTRUMENTAL
├ PROXIMAL
├ PARTIAL_IDENTIFICATION
├ SENSITIVITY_ONLY
└ NOT_IDENTIFIED
↓
Estimator / Bound Engine
├ IS / DR
├ g-computation
├ bridge estimator
├ causal eligibility traces
├ sensitivity bound
└ pessimistic bound
↓
Robustness + Refutation Layer
↓
Causal Identification Certificate
↓
Permission Gate
├ DEPLOY
├ LIMITED_PILOT
├ RANDOMIZED_PILOT
├ COLLECT_PROXY
├ COLLECT_SUPPORT
├ SIMULATE_ONLY
└ BLOCK
```

---

# Bottom-Level Logic

## A. 標準 interactive OPE 的理想情況

假設 history `H_t` 已包含所有 confounders：

```text
A_t ⟂ Y^{π}_{t:T} | H_t
```

再加 positivity：

```text
μ(a|h) > 0
whenever
π(a|h) > 0
```

則可建立 trajectory ratio：

```text
W_T
=
Π_t π(A_t|H_t) / μ(A_t|H_t)
```

再估：

```text
V(π)
≈ E_μ[W_T R_T]
```

## B. Hidden confounding 時

如果存在：

```text
U_t → A_t
U_t → Y
```

但 `U_t ∉ H_t`，則：

```text
P(Y | A,H)
≠
P(Y | do(A),H)
```

普通 importance weighting 沒辦法消掉 `U_t`。

## C. Proximal route

引入 proxies：

```text
Z_t ← U_t → W_t
```

尋找 bridge function `h`，使 observable conditional moment restriction 成立，概念上：

```text
E[Y | Z,A,X]
≈
E[h(W,A,X) | Z,A,X]
```

之後以 bridge 替代直接 adjustment on U。

## D. Sensitivity route

若 identification 不足，就指定 confounding strength family：

```text
Γ ∈ [1, Γ_max]
```

計算：

```text
V_lower(π; Γ)
V_upper(π; Γ)
```

而不是假裝得到單一 causal value。

## E. Permission semantics

真正 Hermes 可使用：

```text
if identification_status == IDENTIFIED:
    use uncertainty-aware value

elif PARTIALLY_IDENTIFIED:
    use lower bound for permission

elif SENSITIVITY_ONLY:
    require decision stability over configured Γ range

elif SUPPORT_VIOLATION:
    randomized pilot / collect support

elif NOT_IDENTIFIED:
    do not claim causal improvement
```

---

# Visual Simulation Idea

## **Hidden Confounder × Positivity × Proximal Proxy × Policy Bound Lab**

畫面左側：因果圖

```text
       U (hidden urgency)
      / \
     ↓   ↓
 ASK_USER → Task Success
   ↓
 Answer

Z proxy ← U → W proxy
```

中間：可切換識別假設

```text
[✓] Sequential ignorability
[✓] Positivity
[ ] Hidden confounding
[ ] Proxy Z/W available
[ ] Instrument available
[ ] Interference
```

右側即時顯示：

```text
Naive OPE value       7.8
DR estimate           7.5

Hidden confounding Γ=1.4
Causal value bound   [5.1, 7.9]

Proxy bridge enabled
Proximal estimate     6.2 ± 0.7

Support status
ASK_USER high-risk region: NO SUPPORT

Causal status
PARTIALLY IDENTIFIED

Permission
LIMITED PILOT
```

再加入 `Γ` slider：

```text
Γ=1.0  → DEPLOY
Γ=1.2  → DEPLOY
Γ=1.4  → LIMITED PILOT
Γ=1.8  → BLOCK
```

以及 proxy validity toggle：

```text
Z exclusion violated
→ PROXIMAL IDENTIFICATION INVALID
```

這個模擬能讓夥伴直觀看到：

> **Offline policy value 不是一個天然存在的數字，而是由「哪些因果假設成立」決定它是否可被識別。**

---

# Code / GitHub

## 本輪最值得讀：PyWhy / DoWhy

Repository：
https://github.com/py-why/dowhy

### 值得持續追的目錄

```text
dowhy/
├ causal_identifier/
├ causal_estimators/
├ causal_refuters/
└ gcm/
```

### 本輪已深入

```text
dowhy/causal_refuters/add_unobserved_common_cause.py
dowhy/causal_refuters/assess_overlap.py
dowhy/causal_refuters/assess_overlap_overrule.py
dowhy/causal_refuters/linear_sensitivity_analyzer.py
dowhy/causal_refuters/non_parametric_sensitivity_analyzer.py
```

### 工程價值

DoWhy 最值得 Hermes 借用的是 separation of concerns：

```text
model causal assumptions
↓
identify estimand
↓
estimate
↓
refute / sensitivity / overlap
```

Hermes 可進一步改成 sequential / agent-native：

```text
model interaction causal graph
↓
identify policy effect
↓
estimate / bound
↓
audit hidden confounding
↓
audit support
↓
permission certificate
```

---

# Papers

## 1. Causal Eligibility Traces for Confounding Robust Off-Policy Evaluation

- **Authors:** Junzhe Zhang, Elias Bareinboim
- **Institution:** Columbia / Causal AI research line
- **Year:** 2025, UAI
- **URL:** https://proceedings.mlr.press/v286/zhang25d.html
- **Architecture:** confounding-robust Bellman bounds + eligibility traces
- **Contribution:** handles offline sequential evaluation under unobserved confounding and no-overlap via bounds rather than naïve point identification
- **Limitation:** bound usefulness depends on assumed confounding model / information; wide bounds can become non-actionable
- **改變了什麼:** 把「biased sequential data 無法 OPE」改成「可以在 assumptions 下求 causal value bounds」

## 2. Off-policy Predictive Control with Causal Sensitivity Analysis

- **Authors:** Myrl G. Marmarelis, Ali Hasan, Kamyar Azizzadenesheli, R. Michael Alvarez, Anima Anandkumar
- **Year:** 2025, UAI
- **URL:** https://proceedings.mlr.press/v286/marmarelis25a.html
- **Architecture:** generalized causal sensitivity model + predictive control
- **Contribution:** hidden confounding with memory 下計算 interventional outcome bounds
- **Limitation:** sensitivity family / calibration 本身是 assumption，不是從資料免費辨識
- **改變了什麼:** sensitivity analysis 從單步 treatment effect 推向 trajectory/control

## 3. Model-Based Reinforcement Learning Under Confounding

- **Authors:** Nishanth Venkatesh, Andreas A. Malikopoulos
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2512.07528
- **Architecture:** contextual MDP with latent context → proximal OPE reward identification → behavior-averaged transition → surrogate MDP / Bellman operator
- **Contribution:** 說明 naive model learning under latent context confounding fundamentally mismatches interventional quantities，並以 proximal OPE 建 surrogate model
- **Limitation:** 依賴 proxy invertibility / proximal identification assumptions
- **改變了什麼:** hidden confounding 不只影響 OPE，也直接污染 learned world model

## 4. Neural Doubly Robust Proximal Causal Estimation

- **Authors:** Ruolin Meng, Dhanajit Brahma, Ricardo Henao, Lawrence Carin
- **Year:** 2026, AISTATS
- **URL:** https://proceedings.mlr.press/v300/meng26b.html
- **Architecture:** neural outcome bridge + treatment bridge + doubly robust proximal estimator
- **Contribution:** bridge misspecification robustness；分析 treatment bridge estimation 與 DR variance
- **Limitation:** doubly robust 不是「兩邊都錯也沒關係」；proxy validity / completeness 仍是核心 assumption
- **改變了什麼:** proximal inference 開始具有更 practical 的 neural + DR estimator

## 5. Instrumental and Proximal Causal Inference with Gaussian Processes

- **Authors:** Yuqi Zhang, Krikamol Muandet, Dino Sejdinovic, Edwin Fong, Siu Lun Chau
- **Year:** 2026, UAI
- **URL:** https://proceedings.mlr.press/v337/zhang26f.html
- **Architecture:** deconditional GP for IV/proximal inference
- **Contribution:** 將 epistemic uncertainty 納入 hidden-confounding causal inference
- **Limitation:** uncertainty calibration 仍依 model/identification assumptions；不能用 posterior variance 取代 identification audit
- **改變了什麼:** causal estimate 不再只有 point value，而能攜帶 decision-aware epistemic uncertainty

## 6. Spatiotemporal Proximal Causal Inference under Hidden Confounding and Interference

- **Authors:** Omar Faruque, Pavan Raj Ravi, Jianwu Wang
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2608.01352
- **Architecture:** spatiotemporal encoders + proxy learning + conditional mutual information critic + bridge moment matching
- **Contribution:** 把 hidden confounding、space/time dependence、interference 放進 proximal framework
- **Limitation:** 目前主要 synthetic evaluation；proxy/exclusion/completeness assumptions 仍需嚴格驗證
- **改變了什麼:** proxy causal inference 開始能處理 network/spatiotemporal interference，與 multi-agent/shared-memory runtime 很接近

---

# Unknown / Open Questions 1–3

## 1. Agent state abstraction 何時足以滿足 sequential ignorability？

前面 Hermes 已有：

```text
Belief State
Predictive State
State Sufficiency Auditor
```

但：

```text
Predictively sufficient state
≠
Causally sufficient adjustment state
```

一個 state 可能足夠預測下一個 observation，卻仍漏掉同時影響 action assignment 與 long-term outcome 的 latent confounder。

需要新的：

```text
CausalStateSufficiencyCertificate
```

---

## 2. LLM embedding 能否成為合法 proximal proxy？

很誘人：

```text
conversation embedding
→ latent user state proxy
```

但 correlation / predictive usefulness 完全不等於 proximal exclusion + completeness。

需要研究：

```text
Multimodal Proxy Validation
Text/Image/Voice Embedding
→ proxy causal assumptions
```

---

## 3. Hidden confounding + interference + delayed feedback + nonstationarity 能否同時做 sequentially valid OPE？

目前前幾輪 Hermes 已各自研究：

```text
delayed feedback
informative censoring
interference
joint query/action OPE
hidden confounding
```

下一步真正困難的是把它們組起來，而不是逐個獨立處理。

---

# 下一輪研究

下一輪收斂到：

# **Causal State Sufficiency × Proxy Validation × Negative Controls × Sequential Confounder Discovery**

研究鏈：

```text
Agent History
↓
State Representation
↓
Does state block action-outcome backdoors?
↓
Negative Control Tests
↓
Proxy Candidate Discovery
↓
Proxy Exclusion / Completeness Audit
↓
Causal State Sufficiency Certificate
↓
Backdoor / Proximal / Sensitivity Router
↓
Interactive Policy Permission
```

特別要深挖：

```text
LLM/VLM embedding
as
causal adjustment state / proxy
```

到底何時只是 predictive representation、何時能支持 causal identification。

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Sequential Ignorability
Sequential Exchangeability
Hidden Sequential Confounder
Causal State Sufficiency
CausalStateSufficiencyCertificate
Interactive Positivity
History Positivity
Support Violation
InteractiveSupportCertificate
Partial Identification
Confounding Robust Value Bound
Causal Eligibility Trace
Causal Sensitivity Model
Confounding Memory
CausalSensitivityContract
Proximal Causal Inference
Treatment-Inducing Proxy
Outcome-Inducing Proxy
Proximal Bridge Function
Outcome Bridge
Treatment Bridge
Doubly Robust Proximal Estimator
Proxy Exclusion Restriction
Proxy Completeness
ProximalProxyContract
CausalIdentificationStatus
Identification Router
Causal Identification Certificate
Permission Stability Under Confounding
```

## 新增 Edges

```text
Logged Propensity
≠ Sequential Ignorability

Predictive State Sufficiency
≠ Causal State Sufficiency

No Overlap
≠ Hidden Confounding

Point OPE Failure
≠ No Useful Causal Bound

Hidden State Embedding
≠ Valid Proximal Proxy

High Proxy Predictiveness
≠ Proxy Exclusion Validity

Proximal Identification
≠ Hidden Confounder Recovery

Sensitivity Bound
≠ Point Identification

Posterior Uncertainty
≠ Identification Validity

Causal Value Estimate
→ must be conditioned on Identification Status
```

---

# 本輪收尾判定

**缺哪一層：** `Causal State Sufficiency / Hidden-Confounder Identification Layer`。

**哪個節點最淺：** `CausalStateSufficiencyCertificate`、`ProximalProxyContract`、`SequentialConfoundingAudit`。

**哪個概念仍只是名詞：** production 級 `Interactive Agent Proximal OPE`；目前 proximal RL/OPE 已有論文，但還沒有直接對 LLM Agent query/tool/human-state runtime 的完整通用實作。

**哪個系統值得讀原始碼：** `py-why/dowhy`，下一輪應續讀 `causal_identifier/`、`assess_overlap_overrule.py`、`non_parametric_sensitivity_analyzer.py`，把 identification / overlap / sensitivity 的 runtime boundary 抽成 Hermes API。

**哪篇論文需追引用：** `Causal Eligibility Traces for Confounding Robust Off-Policy Evaluation`，因為它直接把 hidden confounding + no overlap 接到 sequential Bellman / TD-style evaluation。

**哪個概念最適合視覺模擬：** `Hidden Confounder × Positivity × Proximal Proxy × Policy Bound Lab`。

**哪個 Agent 架構最值得實作：**

```text
Joint Interaction Ledger
↓
Causal Target Builder
↓
Sequential Confounding Auditor
↓
Support / Positivity Auditor
↓
Identification Router
├ Backdoor
├ Proximal
├ Sensitivity
├ Bounds
└ Not Identified
↓
Causal Identification Certificate
↓
Permission Gate
```

---

# 對「AI 到底怎麼運作」新增的一層

> **當 AI Agent 從過去互動學習「哪個行動比較好」時，它不能只看行動與結果的統計相關，也不能只靠記錄 propensity 就認為已經消除偏差。真正的因果問題是：當時 Agent 為什麼選這個 action/query？是不是有一個 log 沒記到、但同時影響 action 與 outcome 的 latent state？如果有，歷史 trajectory 可能無法 point-identify 新 policy 的效果。成熟 Agent 因此必須先判斷因果效果是否可識別，再決定使用 backdoor、instrument、proximal proxy、partial-identification bounds 或 sensitivity analysis；有些情況最正確的答案不是『policy value = 7.3』，而是『目前無法從這份資料識別』。**
