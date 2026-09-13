# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 11:52（Asia/Taipei）**  
**本輪主題：Off-Policy Sequential Evidence Reconstruction × Doubly-Robust Confidence Sequences × Replay-Uncertainty Propagation × Anytime-Valid Policy Identification × Evidence Admission Gate**

---

## 0. 與歷史研究比較：本輪不是重做 OPE，而是補「OPE → sequential evidence」這一層

上一輪已建立：

```text
Historical Agent Trajectory
→ BehaviorPolicyTrace
→ Replay Admissibility Gateway
→ Support / Positivity
→ Importance Ratio
→ IS / PDIS / DR / Model-Assisted Replay
→ EXACT_REPLAYABLE / OFF_POLICY_REWEIGHTABLE / MODEL_ASSISTED_ONLY / NON_IDENTIFIABLE
```

但上一輪仍留下核心缺口：

```text
Corrected H8 evidence
不是 factual observation
而是 OPE estimate / interval / bound

那它能不能直接變成：
→ e-value ?
→ e-process increment ?
→ LORD / SCORE input ?
→ verifier rejection ?
```

本輪結論是：**不能直接。**

必須新增一個中間 runtime：

```text
Counterfactual Evidence Estimate
↓
Statistical Target Contract
↓
Sequential Validity Contract
↓
Doubly-Robust Pseudo-Outcome
↓
Anytime-Valid Confidence Sequence / Betting Process
↓
Evidence Admission Gate
↓
Policy Certificate / Verifier Certificate
↓
Multiplicity Layer
```

也就是：

```text
OPE estimate
≠ Sequential Evidence

Doubly Robust Point Estimate
≠ Anytime-Valid Evidence

Confidence Interval
≠ E-Process Increment
```

---

# 1. 本小時新發現

## 1.1 新論文：Anytime-valid Optimal Policy Identification（2026）

**Title**：Anytime-valid Optimal Policy Identification  
**Author**：Daniel Molitor  
**Institution**：Cornell University, School of Information Science（作者公開頁面）  
**Year**：2026  
**URL**：https://arxiv.org/abs/2606.17515  
**Code / Replication**：https://github.com/dmolitor/av-policy-selection  
**Dataset / application**：模擬資料；另對大型 adaptive experiment / misinformation intervention data 做示範。  
**Architecture**：logged contextual bandit data → per-policy anytime-valid confidence sequences → candidate policy set `S_t` → elimination → data-dependent stopping。  
**Contribution**：把「單一 target policy 的 anytime-valid OPE」推進到「有限 policy class 的 anytime-valid optimal-policy identification」。  
**Limitations**：仍需要 logging-policy support / causal-OPE identifying conditions；policy class 的 simultaneous inference 需要控制 family-level error；這不是一般 full RL trajectory counterfactual simulator。

核心結構：

```text
Π = {π1, π2, ..., πm}
↓
對每個 πi 建立 time-uniform [L_t(πi), U_t(πi)]
↓
S_t = {
  π : U_t(π) ≥ max_{π'} L_t(π')
}
↓
持續刪除明顯次佳 policy
↓
|S_t| = 1
↓
Anytime-Valid Identification
```

其 unique optimum 情況的 sample-complexity rate：

```text
O(
  [log |Π| + log log(1/Δ_min)]
  / Δ_min²
)
```

這對 Hermes 很重要，因為 Planner 的問題往往不是「估一個 action value」，而是：

```text
SEARCH
ASK_USER
READ_MCP
WRITE_MCP
COMMIT
ABSTAIN
```

這其實就是一個小型 candidate-policy/action class。

---

## 1.2 新工程原始碼：dmolitor/av-policy-selection

本輪不只讀 README，實際追入：

```text
src/av_policy_selection/
├ __init__.py
├ confidence_sequences.py
├ load_data.py
├ policy_selection.py
├ reanalysis.py
└ reward_predictors.py
```

以及：

```text
simulations.py
```

### `confidence_sequences.py`

程式明確實作：

```text
LILConfidenceSequence
BettingConfidenceSequence
PrPLConfidenceSequence
```

其中 `LILConfidenceSequence` 對 doubly-robust pseudo-outcome 做：

```text
φ_t
↓
ξ_t = φ_t / (1+k)
↓
lagged predictable mean ξ̂_{t-1}
↓
V_t = Σ(ξ_i - ξ̂_{i-1})²
↓
variance-adaptive LIL correction
↓
L_t
```

最重要的是它不是：

```text
每次把目前資料丟進普通 CI 函式
```

而是顯式保存 sequential variance process：

```text
V_t
```

並且需要 lagged / predictable quantity：

```text
ξ̂_{t-1}
```

而不是偷用當期 observation 後才決定的 estimator state。

### `policy_selection.py`

實際 runtime 非常乾淨：

```text
lower_bounds: shape (m,T)
upper_bounds: shape (m,T)
↓
max_lower[t]
↓
π_i ∈ S_t iff U_i,t ≥ max_lower[t]
```

停止條件：

```text
∃ π_i:
L_t(π_i) > max_{j≠i} U_t(π_j)
```

原始碼使用 second-max trick 計算每個 policy 的最佳 competitor upper bound，避免對每個 policy 做 O(m²T) 的 naive loop。

這對 Hermes 很值得直接抽象成：

```text
ActionCandidateSetRuntime
```

而不是只在 UI 顯示每個 action 各自的 confidence bar。

---

## 1.3 新/重要底層機制：Doubly-Robust Pseudo-Outcome → Martingale-Compatible Evidence

Waudby-Smith et al. 的 anytime-valid OPE 框架允許：

```text
logging policy h_t
可以依 H_{t-1} 改變
```

也就是：

```text
h_t = f(H_{t-1})
```

只要其選擇對當期 observation 前是 predictable。

對 target policy `π`，核心 importance weight 是：

```text
w_t(π)
=
π(A_t | X_t)
/
h_t(A_t | X_t)
```

最基本 IPW pseudo-outcome：

```text
Y_t^IPW
=
w_t R_t
```

Doubly Robust 則加入 reward model `r̂_t(x,a)`：

```text
φ_t^DR(π)
≈
Σ_a π(a|X_t) r̂_t(X_t,a)
+
w_t(π)[R_t - r̂_t(X_t,A_t)]
```

關鍵不是「DR 比較準」這句話，而是：

```text
reward prediction term
+
importance-weighted residual correction
```

使 nuisance reward predictor 可拿來降 variance，卻不應被 Hermes 誤當成 factual counterfactual observation。

在 anytime-valid 架構中，更關鍵的是：

```text
r̂_t
必須是由 H_{t-1} 建立
```

亦即：

```text
past
↓
train / update r̂_t
↓
observe X_t
↓
logging action A_t
↓
observe R_t
↓
construct DR pseudo-outcome
```

不能：

```text
先看 R_t
↓
讓 LLM / model 根據 R_t 重調 r̂_t
↓
再假裝它是 predictable DR term
```

這與 Hermes 前幾輪建立的 filtration / predictability contract 完全接上。

---

## 1.4 新發現：Anytime-valid OPE 允許 adaptive logging，但不等於允許 active environment feedback

Waudby-Smith et al. 明確允許：

```text
h_t
依據完整歷史 H_{t-1}
自適應改變
```

也允許 context distribution 隨時間漂移。

但其反事實 interpretation 依賴一個重要邊界：context/reward mechanism 不應透過過去 Agent actions 改寫未來 environment process 到破壞其 causal target interpretation。

換句話說：

```text
Adaptive Logging
≠
Arbitrary Agent-Environment Feedback
```

這與上一輪 active non-stationarity 的分類形成直接銜接：

```text
Context Drift
但不由 Agent 過往 action 造成
→ 可較直接進入 contextual-bandit sequential OPE

Action changes external DB / human response / world state
→ trajectory-coupled
→ 需要 MDP / SCM / longitudinal causal model
→ 不能把 contextual-bandit theorem 生搬過去
```

Hermes 因此需要：

```text
SequentialEvidenceRegime
├ CONTEXTUAL_BANDIT_EXOGENOUS
├ ADAPTIVE_LOGGING_EXOGENOUS
├ MARKOV_ACTION_COUPLED
├ HUMAN_RESPONSE_COUPLED
├ TOOL_STATE_COUPLED
└ UNKNOWN
```

---

## 1.5 新發現：最新 2026 policy identification 把「信賴區間」直接變成 Planner elimination primitive

傳統 Agent 常做：

```text
score(action)
↓
argmax
```

但 anytime-valid policy identification 是：

```text
Action A     [0.44,0.63]
Action B     [0.41,0.60]
Action C     [0.05,0.32]

max lower = 0.44

C:
U_C = 0.32 < 0.44
→ eliminate

A/B 保留
```

因此 Planner 不必強迫提早做唯一決策：

```text
Candidate set
可以縮小，但暫時 >1
```

這很適合 Hermes：

```text
{SEARCH, ASK_USER}
```

可能都仍合理；而：

```text
WRITE_EXTERNAL
```

已可以安全淘汰。

這比把所有 action 壓成 single confidence score 更符合證據結構。

---

# 2. 本小時最重要 5 個發現

## Finding 1 — OPE estimate 不能直接餵進 e-process

### 是什麼

上一輪如果得到：

```text
CorrectedValue(ASK_USER) = 0.61
```

這只是一個 estimator output。

若要變成 sequential evidence，需要額外證明其 increment 或其所構造的 confidence sequence 在目前 filtration 下具有合法性。

### 底層如何運作

```text
Historical observation
↓
known behavior propensity h_t
↓
target propensity π
↓
importance ratio
↓
predictable reward predictor
↓
DR pseudo-outcome
↓
variance / betting process
↓
time-uniform bound
```

### 為什麼重要

否則 Hermes 會犯一個非常危險的統計錯誤：

```text
counterfactual estimate
→ 當成 observed evidence
→ 再計一次 confidence
→ fake certainty
```

### 限制

對 trajectory/action-coupled environment，contextual-bandit OPE theorem 不一定適用。

### 來源

- https://arxiv.org/abs/2210.10768
- https://github.com/dmolitor/av-policy-selection

---

## Finding 2 — Doubly Robust 的「double robustness」不能被 Hermes 誤解成「任何模型錯都沒關係」

### 是什麼

在這一類 anytime-valid OPE implementation 中，DR pseudo-outcome主要是用 regression adjustment + IPW correction 來減 variance 並維持 estimator structure。

Daniel Molitor 的說明特別提醒：其 context 中所稱 DR，不是要表達「統計保證一定依賴兩個 nuisance models 至少一個完全正確」的簡化口號；reward predictor 即使 misspecified，也仍可作 variance reduction，只要整體 theorem contract 被滿足。

### 底層

```text
plug-in predicted reward
+
IPW residual correction
```

若 predictor 很好：

```text
R - r̂
小
→ variance ↓
```

若 predictor 很差：

```text
residual correction
仍保留重要的 unbiased / valid structure
```

但這不表示：

```text
bad propensity
hidden confounding
support violation
filtration violation
```

也會自動被 DR 修掉。

### 重要否定關係

```text
Doubly Robust
≠ Universal Robustness
```

---

## Finding 3 — Predictability 是 OPE → sequential evidence 的真正 admission gate

Hermes 必須保存：

```text
EstimatorUpdateTrace
├ model_version
├ trained_until_event_id
├ filtration_hash
├ features_used
├ outcome_columns_used
├ created_at
└ predictability_status
```

對 observation `t`：

```text
reward_predictor_t
threshold_t
betting_fraction_t
behavior_policy_t
```

都必須檢查：

```text
MEASURABLE_WITH_RESPECT_TO(H_{t-1})
```

如果 verifier 在看到 `R_t` 後才選對自己最有利的：

```text
model
clip
weight
threshold
candidate policy
```

原本的 sequential guarantee 可能失效。

所以：

```text
Good OPE Formula
≠ Valid Sequential Runtime
```

---

## Finding 4 — 2026 Anytime-valid Optimal Policy Identification 提供了比「action confidence score」更好的 Planner abstraction

Hermes 可直接建立：

```text
AnytimeActionSet
S_t
```

每次 evidence 更新只做：

```text
max_lower_t
↓
刪除 U_i,t < max_lower_t 的 action
```

直到：

```text
|S_t| = 1
```

再進：

```text
EXECUTE
```

但 Hermes 應再加入 side-effect class：

```text
READ-only action
可能在 S_t={A,B} 時就允許

irreversible WRITE
則可能要求唯一 winner
或 robust-dominance margin
```

也就是：

```text
Statistical Identification Threshold
×
Operational Risk Threshold
```

兩層 gate。

---

## Finding 5 — OPE 的 support quality 不只是 estimation diagnostic，應直接控制 evidence admission strength

即使 absolute continuity 成立：

```text
π(a|x) > 0
⇒
h(a|x) > 0
```

也可能出現：

```text
w_t = π/h
```

極大，導致 pseudo-outcome heavy-tail / variance 爆炸。

Waudby-Smith et al. 的方法不要求知道全域 `w_max`，可依 empirical variance 建立 confidence sequences；Microsoft `csrobust` 甚至特別示範 off-policy quantile identification function 在 Pareto importance weights 下可能出現 infinite variance。

因此 Hermes 不能把：

```text
support_status = PASS
```

理解成：

```text
strong evidence
```

應再保存：

```text
SequentialOPEQuality
├ positivity_status
├ max_observed_weight
├ effective_sample_size
├ variance_process
├ tail_regime
├ clipping_or_truncation
├ confidence_width
└ evidence_strength
```

---

# 3. Architecture Breakdown

## 3.1 本輪提出：Off-Policy Sequential Evidence Runtime

```text
Historical Agent Event Ledger
↓
Behavior Policy Resolver
↓
Target / Corrected Policy Resolver
↓
Replay Admissibility Gateway
├ semantic support
├ positivity
├ action coupling
├ causal regime
└ provenance
↓
Sequential Evidence Regime Classifier
├ contextual bandit
├ action-coupled MDP
├ longitudinal causal
└ unknown
↓
Nuisance Model Manager
├ reward predictor
├ propensity
└ state / value model
↓
Predictability Verifier
↓
DR Pseudo-Outcome Builder
↓
Weight / Tail Diagnostics
↓
Anytime-Valid Evidence Constructor
├ LIL CS
├ predictable plug-in CS
├ betting CS
└ heavy-tail robust CS
↓
Candidate Action / Policy Set
↓
Evidence Admission Gate
↓
Multiplicity Runtime
↓
Planner Risk Gate
↓
Tool / MCP / External Action
```

---

## 3.2 Evidence Admission Gate

新增：

```text
SequentialEvidenceAdmissionCertificate
├ evidence_id
├ estimand_id
├ target_policy_hash
├ behavior_policy_trace_id
├ theorem_regime
├ support_status
├ positivity_status
├ propensity_known
├ nuisance_model_predictable
├ importance_weight_diagnostics
├ tail_regime
├ confidence_sequence_type
├ anytime_valid
├ action_coupling_class
├ causal_interpretation_status
├ multiplicity_family_id
└ verdict
```

Verdict：

```text
ADMIT_AS_ANYTIME_EVIDENCE
ADMIT_AS_FIXED_HORIZON_ONLY
ADMIT_AS_MODEL_ASSISTED_BOUND
ADMIT_FOR_DECISION_ONLY_NOT_TESTING
QUARANTINE
REJECT_EVIDENCE
```

這是本輪最重要的 production 建議。

---

# 4. Bottom-Level Logic

## 4.1 Behavior policy → importance ratio

```text
h_t(a | x, H_{t-1})
```

是實際收資料 policy。

Target policy：

```text
π(a | x)
```

觀測 action `A_t` 的 weight：

```text
w_t
=
π(A_t | X_t)
/
h_t(A_t | X_t)
```

要求：

```text
π << h_t
```

即 target policy 對某 action 有正 probability 時，logging policy 不能完全不記錄它。

---

## 4.2 DR pseudo-outcome

可抽象寫成：

```text
m̂_t^π(X_t)
=
Σ_a π(a|X_t) r̂_t(X_t,a)
```

再：

```text
φ_t^DR
=
m̂_t^π(X_t)
+
w_t[R_t-r̂_t(X_t,A_t)]
```

其中：

```text
r̂_t
```

必須由過去資料建立，才能乾淨接進 predictable sequential runtime。

---

## 4.3 Variance process

`av-policy-selection` 的 LIL implementation 使用：

```text
ξ_t = φ_t / (1+k)
```

再建立 lagged predictable mean：

```text
ξ̂_{t-1}
```

與：

```text
V_t
=
Σ_i≤t (ξ_i - ξ̂_{i-1})²
```

最後 bound width 不只看：

```text
n
```

而是看實際累積 variance process。

這對 Agent 非常重要，因為不同 runtime 時段可能出現：

```text
stable tool regime
→ V_t 緩慢

model/tool migration
→ residual / weights 大幅波動
→ V_t 上升
→ confidence sequence 自動變寬
```

這比固定 confidence threshold 更合理。

---

## 4.4 Candidate policy set

```text
S_t
=
{
π_i:
U_t(π_i; α/m)
≥
max_j L_t(π_j; α/m)
}
```

逐步形成：

```text
t1: {SEARCH, ASK, READ, WRITE, COMMIT}
t2: {SEARCH, ASK, READ, COMMIT}
t3: {ASK, READ, COMMIT}
t4: {ASK, READ}
t5: {ASK}
```

這就是一個非常直觀的 Agent decision convergence trace。

---

# 5. Visual Simulation Idea

## Off-Policy Evidence Reconstruction Lab

這一輪最適合 Hermes Console 的可互動模擬應該不是再做一個一般 OPE chart，而是把：

```text
歷史 action
→ counterfactual estimate
→ sequential evidence
→ action elimination
```

整條 chain 視覺化。

### Panel A — Behavior / Target Policy Flow

```text
Context X_t
       │
       ├── Historical h_t
       │      ASK .60
       │      READ .30
       │      WRITE .10
       │
       └── Corrected π
              ASK .30
              READ .60
              WRITE .10
```

點 observed action：

```text
READ

h=.30
π=.60
w=2.0
```

---

### Panel B — DR Reconstruction

```text
Predicted reward
r̂(READ)=.55

Observed R=.70
Residual=.15

DR term:
model component  .61
correction       +.30
---------------------
φ_DR             .91
```

並標記：

```text
PREDICTOR TRAINED BEFORE EVENT ✓
PROPENSITY LOGGED ✓
SUPPORT ✓
TAIL RISK MEDIUM
```

---

### Panel C — Sequential Evidence Timeline

```text
t     DR φ      weight      V_t       CS
1     .54       1.1         .02    [.00,.98]
20    .61       1.4         .31    [.31,.82]
50    .58       2.2         .74    [.39,.73]
80   3.40 ⚠    12.0        8.90    [.28,.79]
120   .63       1.3        9.20    [.39,.75]
```

直接讓使用者看到：

> 一個 extreme importance weight 為什麼會讓 evidence 立刻變弱。

---

### Panel D — Action Set Elimination

```text
ASK      [.58 ━━━━━ .72]  ACTIVE
READ     [.55 ━━━ .67]    ACTIVE
SEARCH   [.31 ━ .48]      ELIMINATED
WRITE    [.10 ━━━━━ .54]  ELIMINATED
COMMIT   [.33 ━━━ .57]    ELIMINATED
```

顯示：

```text
max lower = .58
```

若：

```text
U_WRITE=.54 < .58
```

則：

```text
WRITE leaves S_t
```

---

### Panel E — Validity Gate

```text
Support                 PASS
Propensity              PASS
Reward predictor        PASS
Predictability          PASS
Tail diagnostics        WARN
Action-coupling         EXOGENOUS
Anytime theorem         PASS
Multiplicity            PASS

FINAL:
ADMIT_AS_ANYTIME_EVIDENCE
```

若 Agent 的 action 會改變後續外部 world：

```text
Action-coupling:
ENVIRONMENT_COUPLED

FINAL:
QUARANTINE_CONTEXTUAL_BANDIT_THEOREM
→ ROUTE_TO_LONGITUDINAL / MDP REPLAY
```

---

# 6. Code / GitHub

## 6.1 dmolitor/av-policy-selection

Repository：
https://github.com/dmolitor/av-policy-selection

本輪實際追到值得看的檔案：

```text
src/av_policy_selection/confidence_sequences.py
```

重點：

```text
LILConfidenceSequence
PrPLConfidenceSequence
BettingConfidenceSequence
```

特別值得 Hermes 借的不是 class 名稱，而是：

```text
predictable lagged state
variance process
confidence sequence contract
```

以及：

```text
src/av_policy_selection/policy_selection.py
```

重點：

```text
optimal_set()
stopping_time()
```

這可以直接變成 Hermes 的：

```text
candidate-action evidence gate
```

另外：

```text
reward_predictors.py
```

值得下一輪繼續看，因為 nuisance predictor 的更新時點直接關係 predictability。

```text
reanalysis.py
```

值得看其真實資料重分析如何建 target policies 與 simultaneous CS。

---

## 6.2 microsoft/csrobust

Repository：
https://github.com/microsoft/csrobust

核心不是 package runtime，而是研究 notebooks：

```text
csrobustmean.ipynb
csnsopquantile.ipynb
csnsopquantile-ebern.ipynb
csnsquantile-unbounded.ipynb
csnsexpectile.ipynb
```

README 明確指出：

```text
Off-policy quantile identification functions
可能因 importance weights 呈 Pareto heavy-tail
甚至有 infinite variance
```

這對 Hermes 的啟示：

```text
OPE evidence constructor
不能只有 normal / finite-variance mode
```

應該有：

```text
TailRegimeRouter
├ BOUNDED
├ FINITE_VARIANCE_HEAVY_TAIL
├ FINITE_Q_MOMENT
├ POSSIBLY_INFINITE_VARIANCE
└ UNKNOWN
```

---

# 7. Papers

## Paper A — Anytime-valid off-policy inference for contextual bandits

**Title**：Anytime-valid off-policy inference for contextual bandits  
**Authors**：Ian Waudby-Smith, Lili Wu, Aaditya Ramdas, Nikos Karampatziakis, Paul Mineiro  
**Year**：2022；目前 arXiv v3 更新於 2024-08-15  
**URL**：https://arxiv.org/abs/2210.10768  
**Code related**：Microsoft `csrobust` 為相關 robust-CS implementation/demo；2026 `av-policy-selection` 直接實作其中 LIL / betting CS。  
**Dataset**：methodological / simulated contextual-bandit settings。  
**Architecture**：adaptive logging → importance weighted / doubly robust pseudo-outcomes → martingale / betting / variance-adaptive CS → arbitrary stopping-time inference。  
**Contribution**：允許 adaptive logging；time-varying policy values；可處理未知且不必全域 bounded 的 importance weights；建立 time-uniform OPE inference。  
**Limitations**：其 causal interpretation 仍依賴 identifying assumptions；contextual-bandit regime 不涵蓋任意 action-driven environment dynamics。

**改變了什麼**：

從：

```text
OPE point estimate / fixed-N CI
```

改成：

```text
continuously monitor
↓
stop whenever evidence sufficient
↓
still retain valid coverage
```

---

## Paper B — Anytime-valid Optimal Policy Identification

**Title**：Anytime-valid Optimal Policy Identification  
**Author**：Daniel Molitor  
**Institution**：Cornell University  
**Year**：2026  
**URL**：https://arxiv.org/abs/2606.17515  
**Code**：https://github.com/dmolitor/av-policy-selection  
**Dataset**：simulation + adaptive experiment application。  
**Architecture**：per-policy CS → simultaneous correction → optimal set `S_t` → elimination → stopping。  
**Contribution**：由 OPE inference 推進到 candidate policy identification。  
**Limitations**：policy class size / gap 決定 sample complexity；仍不是 arbitrary long-horizon Agent trajectory reconstruction。

**改變了什麼**：

```text
Which policy is best?
```

不必固定 sample size 後才回答；可以：

```text
持續縮小 candidate set
直到唯一 policy 被辨識
```

---

## Paper C — Sequential Off-Policy Learning with Logarithmic Smoothing

**Title**：Sequential Off-Policy Learning with Logarithmic Smoothing  
**Authors**：Maxime Haddouche, Otmane Sakhi  
**Venue**：AISTATS 2026, PMLR 300  
**Year**：2026  
**URL**：https://proceedings.mlr.press/v300/haddouche26a.html  
**Architecture**：deploy policy → collect batch → combine all historical logged data → logarithmic smoothing estimator → online PAC-Bayes update → redeploy。  
**Contribution**：正式處理 policy 反覆更新、重新部署、再利用舊 log 的 sequential off-policy learning，而非只處理單一固定 logging policy batch。  
**Limitations**：核心問題是 sequential off-policy *learning*，不是 Hermes 所需的 semantic-invalidation rollback theorem；也不能直接替代 anytime-valid verifier evidence。

**改變了什麼**：

這篇強化了上一輪的一個結論：

```text
production Agent
不應假設歷史 log 都來自同一 behavior policy
```

---

## Paper D — Logging Policy Design for Off-Policy Evaluation

**Title**：Logging Policy Design for Off-Policy Evaluation  
**Authors**：Connor Douglas, Joel Persson, Foster Provost  
**Year**：2026  
**URL**：https://arxiv.org/abs/2605.15108  
**Architecture**：design logging policy to trade reward vs target-policy coverage。  
**Contribution**：形式化 reward-coverage tradeoff，並在不同 target / reward knowledge regimes 推導 logging design。  
**Limitations**：不是 sequential evidence paper，但直接關係 Hermes 未來能否收集到可 replay 的 evidence。

**改變了什麼**：

```text
Logging
```

不只是「記錄」；它本身是 future identifiability / evidence quality 的設計問題。

---

# 8. 已確認事實 / 工程實作 / 推論 / 尚未驗證假說

## 已確認事實

1. Anytime-valid contextual-bandit OPE 可以在 logging policy 自適應於過去歷史的條件下建立 time-uniform inference。
2. Target policy 必須相對 logging policy 有 support / absolute continuity，否則一般 OPE inference 不可行。
3. `av-policy-selection` 實際包含 LIL、predictable plug-in、betting 類 confidence-sequence implementation。
4. `PolicySelector` 實際以 simultaneous lower / upper bound 建 candidate optimal set 與 stopping time。
5. 2026 `Anytime-valid Optimal Policy Identification` 把 anytime-valid OPE 擴成 policy-class identification。
6. Microsoft `csrobust` 明確研究 heavy-tailed / infinite-variance 類 off-policy identification-function 情境。

## 官方 / 論文結果

```text
confidence sequence
→ arbitrary stopping-time valid
```

不是等同於：

```text
任意 adaptive modeling step 都合法
```

它仍要求相對應 theorem 的 filtration / predictability / support contracts。

## 工程實作

本輪提出的：

```text
SequentialEvidenceAdmissionCertificate
TailRegimeRouter
ActionCandidateSetRuntime
```

是 Hermes architecture proposal，不是論文現成 package API。

## 合理推論

如果 Hermes 能保存：

```text
BehaviorPolicyTrace
PredictabilityTrace
SequentialEvidenceRegime
```

就能比現在更安全地決定：

```text
某筆 counterfactual reconstruction
究竟能不能進 online verifier
```

## 尚未驗證假說

最重要的是：

```text
OPE-derived confidence sequence
如何安全地轉換 / 組合成
現有 e-process / online-FDR wealth object
```

不能因為兩者都 anytime-valid，就假設可以直接互換。

這是下一輪真正要解的問題。

---

# 9. Unknown / Open Questions

## Q1. Confidence Sequence → e-value 的合法轉換在 Hermes 的一般 typed-evidence algebra 中應怎麼實作？

理論上 CS、sequential tests、e-process 常可透過 test inversion / duality 關聯，但：

```text
已有 OPE CS
```

不代表 Hermes 可以任意取：

```text
1 / p
```

或自行構造 e-value。

需要 formal conversion contract：

```text
SequentialEvidenceTransformer
├ source_evidence_type
├ source_null
├ source_filtration
├ conversion_theorem
├ output_e_process_contract
└ validity_proof
```

---

## Q2. DR nuisance model 若由 LLM / neural model 持續線上更新，如何證明 predictability？

程式上的：

```text
trained_at < observation_at
```

還不夠。

如果 training dataset、retrieved memory、feature computation 偷偷包含後來修正的 outcome 或 future-derived label，仍可能 leakage。

需要：

```text
NuisanceModelLineageCertificate
```

---

## Q3. Long-horizon Tool / MCP Agent 要從 contextual-bandit theorem 升級到什麼模型？

對：

```text
MCP_WRITE
→ world changes
→ next observation changes
```

contextual-bandit OPE 不夠。

可能需要：

```text
sequential DR for longitudinal treatment regimes
MDP OPE
marginalized importance sampling
DRL / density ratio
proximal / confounded OPE
SCM trajectory identification
```

下一輪需明確比較它們的 evidence-object compatibility。

---

# 10. 下一輪研究

下一輪核心應為：

# **CS / E-Process Duality × OPE-Derived E-Values × Sequential DR for MDP × Evidence Transformer**

依序研究：

```text
Doubly Robust OPE pseudo-outcome
↓
Anytime-valid CS
↓
Sequential test inversion
↓
E-value / e-process construction
↓
Compatibility with e-BH / LORD / SCORE
↓
Multiple target policies
↓
Action-set decision certificate
```

同時開第二條：

```text
Contextual Bandit OPE
↓
Longitudinal / MDP OPE
↓
Sequential DR
↓
trajectory dependence
↓
Agent tool / human / memory feedback
```

要回答：

> 當 corrected Agent action 會改變後續世界時，Hermes 要用什麼最小充分 causal / sequential model，才能重建「可驗證 evidence」而非只生成一段 plausible simulation？

---

# 11. Knowledge Graph 新增 Node / Edge

## Nodes

```text
Off-Policy Sequential Evidence Reconstruction
Sequential Evidence Admission Gate
Sequential Evidence Admission Certificate
Doubly Robust Pseudo-Outcome
Predictable Reward Predictor
Nuisance Model Predictability
Estimator Update Trace
Behavior Policy Predictability
Anytime-Valid OPE
OPE Confidence Sequence
LIL OPE Confidence Sequence
Betting OPE Confidence Sequence
Predictable Plug-In Confidence Sequence
Sequential OPE Quality
Importance-Weight Tail Regime
Tail Regime Router
Variance Process
Policy Candidate Set
Anytime-Valid Policy Identification
Optimal Policy Set S_t
Policy Elimination Time
Policy Identification Stopping Time
Statistical Identification Threshold
Operational Risk Threshold
Action Candidate Set Runtime
Evidence Strength From OPE
Sequential Evidence Regime
Contextual-Bandit Exogeneity
Adaptive Logging Exogeneity
Action-Coupled Sequential Evidence
Nuisance Model Lineage Certificate
Sequential Evidence Transformer
```

## Edges

```text
BehaviorPolicyTrace
→ defines
ImportanceRatio

ImportanceRatio
+ RewardPredictor
→ constructs
DoublyRobustPseudoOutcome

DoublyRobustPseudoOutcome
→ feeds
VarianceProcess

VarianceProcess
→ parameterizes
AnytimeValidConfidenceSequence

AnytimeValidConfidenceSequence
→ constrains
PolicyCandidateSet

PolicyCandidateSet
→ drives
PlannerDecisionConvergence

PredictabilityContract
→ gates
SequentialEvidenceAdmission

TailRegime
→ changes
ConfidenceSequenceMethod

LoggingPolicyDesign
→ controls
FutureReplayCoverage
```

## 否定 / 防混淆 edges

```text
OPE Estimate
≠ Sequential Evidence

Doubly Robust
≠ Universal Robustness

Doubly Robust Point Estimate
≠ Anytime-Valid Evidence

Confidence Interval
≠ Confidence Sequence

Confidence Sequence
≠ E-Process Automatically

Adaptive Logging
≠ Arbitrary Action-Coupled Environment

Support Pass
≠ Strong Evidence

Known Propensity
≠ Low-Variance OPE

Candidate Set Size > 1
≠ Statistical Failure

Policy Identification
≠ Operational Permission Automatically

Good OPE Formula
≠ Valid Sequential Runtime

Same Counterfactual Estimate
≠ Same Evidence Strength
```

---

# 12. 本輪結束回答

## 缺哪一層？

目前最缺的是：

```text
OPE Confidence Sequence
→ valid e-value / e-process
→ online multiplicity
```

的 **Evidence Transformer theorem layer**。

---

## 哪個節點最淺？

```text
SequentialEvidenceTransformer
NuisanceModelLineageCertificate
ActionCoupledSequentialEvidence
OPE-to-EProcess conversion
```

---

## 哪個概念仍只是名詞？

目前最接近「有名字但還沒被 formalize 成 Hermes contract」的是：

```text
Sequential Evidence Admission Gate
```

雖然本輪已給出 schema，但還缺 theorem-aware automatic validator。

---

## 哪個系統值得讀原始碼？

第一優先：

```text
dmolitor/av-policy-selection
```

接著讀：

```text
reward_predictors.py
reanalysis.py
simulations.py
```

第二優先：

```text
microsoft/csrobust
```

特別看 off-policy quantile / heavy-tail notebooks。

第三優先仍是上一輪的：

```text
SCOPE-RL
```

把 batch / RL OPE estimators 接到本輪 anytime-evidence layer。

---

## 哪篇論文需追引用？

第一：

**Anytime-valid off-policy inference for contextual bandits**

因為它是本輪 sequential evidence 的基礎 theorem layer。

第二：

**Anytime-valid Optimal Policy Identification (2026)**

因為它開始把這套 inference 直接推進到 Planner 可用的 multi-policy elimination。

第三：

**Sequential Off-Policy Learning with Logarithmic Smoothing (AISTATS 2026)**

因為 production Agent 必然是 sequential redeployment，而不是 single fixed behavior policy。

---

## 哪個概念最適合視覺模擬？

**Off-Policy Evidence Reconstruction Lab**。

尤其：

```text
Historical propensity
→ Target propensity
→ Importance ratio
→ DR pseudo-outcome
→ Variance process
→ Confidence sequence
→ Candidate action set
```

非常適合讓不懂統計的使用者直接理解：

> 為什麼「我有歷史 log」不代表「我知道另一個 Agent policy 會怎樣」，以及為什麼一個大 importance weight 可以瞬間讓原本看似確定的決策重新變得不確定。

---

## 哪個 Agent 架構最值得實作？

# **Anytime-Valid Counterfactual Planner**

```text
Behavior Policy Trace
+
Replay Admissibility Gateway
+
Predictable DR Reconstruction
+
Anytime-Valid Confidence Sequence
+
Candidate Action Set
+
Operational Risk Gate
```

Planner 不再問：

```text
哪個 action score 最高？
```

而是：

```text
哪些 action
在目前所有合法 counterfactual evidence 下
仍不能被淘汰？
```

這會比傳統 LLM planner 的 single-score ranking 更適合真正長期 Agent。

---

# 13. 對「AI 到底怎麼運作」本輪補上的位置

整條主線現在進一步變成：

```text
使用者一句話
↓
UI
↓
Agent Runtime
↓
Context / Memory
↓
Reasoning / Planning
↓
Candidate Actions
↓
Tool / MCP / Model Router
↓
Action
↓
Environment Observation
↓
Evidence Ledger
↓
Behavior Policy Trace
↓
Counterfactual Target Policy
↓
Support / Positivity
↓
Importance Ratio
↓
Predictable Reward Model
↓
Doubly Robust Pseudo-Outcome
↓
Sequential Variance / Betting Process
↓
Anytime-Valid Confidence Sequence
↓
Candidate Policy / Action Set
↓
Multiplicity / Safety Gate
↓
下一個 Agent Action
```

因此本輪真正補上的核心答案是：

> **AI Agent 事後想判斷「如果當時選另一個 action 會怎樣」，不能把模型生成的 counterfactual 直接當成新事實。它必須先知道歷史 policy 當時以多少機率選了這個 action，再透過 importance weighting / doubly-robust reconstruction 建立 counterfactual pseudo-outcome；如果系統還會邊跑邊看、隨時決策，就必須再把這些 pseudo-outcomes 放進符合 filtration 與 predictability 條件的 confidence sequence / betting process。最後 Planner 應維護一組尚未被證據淘汰的 action，而不是假裝永遠有一個精確最高分答案。**

---

## Sources

- Waudby-Smith, I., Wu, L., Ramdas, A., Karampatziakis, N., Mineiro, P. — Anytime-valid off-policy inference for contextual bandits: https://arxiv.org/abs/2210.10768
- Molitor, D. — Anytime-valid Optimal Policy Identification: https://arxiv.org/abs/2606.17515
- Molitor replication code: https://github.com/dmolitor/av-policy-selection
- Microsoft Robust Confidence Sequences: https://github.com/microsoft/csrobust
- Haddouche, M., Sakhi, O. — Sequential Off-Policy Learning with Logarithmic Smoothing: https://proceedings.mlr.press/v300/haddouche26a.html
- Douglas, C., Persson, J., Provost, F. — Logging Policy Design for Off-Policy Evaluation: https://arxiv.org/abs/2605.15108
