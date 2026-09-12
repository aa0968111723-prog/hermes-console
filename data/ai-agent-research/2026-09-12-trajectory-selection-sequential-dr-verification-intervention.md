# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 20:51（Asia/Taipei）**  
**本輪主題：Trajectory-Level Selection Correction × Sequential Doubly Robust Estimation × Verification-as-Intervention × Longitudinal Positivity × Adaptive Monitoring**

> 本輪承接上一輪 `Doubly-Robust Calibration × Verification Propensity × Informative Censoring`，不再重複單一 decision-event 的 IPS / AIPW。新的問題是：**Agent 是一個多步閉環系統，前一步 verification、abstention、human query、tool call 會改變後續 state、context 與下一次 verification probability；因此 selection correction 必須從單點 propensity 升級為 trajectory-level causal model。**

---

## 一、本小時新發現

### 新論文 / 新架構

1. **Longitudinal Adaptive Experimental Design for Learning Multiple Target Estimands with Semiparametric Efficient Inference**  
   Authors: Wenxin Zhang, Mark van der Laan  
   Institution: Division of Biostatistics, University of California, Berkeley  
   Year: 2026  
   URL: https://arxiv.org/abs/2607.29421  
   Code: 本輪未找到作者正式 code release  
   Dataset: simulation-based longitudinal adaptive experiments  
   Architecture: backward-recursive oracle allocation + adaptive longitudinal design + ADL-LTMLE  
   Contribution: 證明早期 randomization 的最佳配置依賴後續 allocation；提出 adaptive-design-likelihood-based longitudinal TMLE，在 adaptive/dependent data 下做 semiparametric efficient inference。  
   Limitation: 研究重點是 longitudinal adaptive experiments，不是 LLM Agent tool runtime；映射到 Hermes 需要重新定義 action、verification 與 outcome。  
   改變了什麼：**logging / verification policy 不應只逐步獨立看待；前期 sampling policy 會決定後面可辨識的 state-action support。**

2. **Treatment persistence drives estimator performance in longitudinal causal inference based on observational data: A simulation study**  
   Authors: Sergio Gaiotti, Sara Poletto, Enrico Longato, Erica Tavazzi, Martina Vettoretti  
   Year: 2026  
   URL: https://arxiv.org/abs/2609.04940  
   Dataset: SCM simulation，9 種 longitudinal scenarios  
   Architecture: time-varying confounding + binary longitudinal treatment + sustained regimes；比較 baseline 與 longitudinal IPTW/LTMLE  
   Contribution: treatment persistence 顯著影響 positivity 與 estimator variance；低 persistence 時 longitudinal IPTW/LTMLE interval 明顯變寬。  
   Limitation: simulation-based；不是 agent verification system。  
   改變了什麼：**Trajectory positivity 不能只看每一步最小 propensity；整條 action/verification pattern 是否在資料中被支撐更重要。**

3. **Evaluating the impact of longitudinal treatment strategies in the presence of informative monitoring and time-dependent confounding**  
   Authors: Leah Pirondini, Karla Diaz-Ordaz, Edward Palmer, Ruth H. Keogh  
   Year: 2026  
   URL: https://arxiv.org/abs/2604.09898  
   Dataset: simulation + ICU routinely collected data  
   Architecture: IPW / G-computation / longitudinal TMLE + monitoring indicators as time-varying confounders  
   Contribution: monitoring frequency 本身可帶有狀態資訊；忽略 informative monitoring 會造成偏差。  
   Limitation: medical longitudinal setting；Hermes 的 `VERIFY/HUMAN/TOOL_READ` 比醫療 monitoring 更可能直接改變後續 environment。  
   改變了什麼：**Observation process 本身要進 causal graph；「為什麼此時去查」可能是 confounder，也可能是 intervention。**

4. **Doubly Robust Off-policy Value Evaluation for Reinforcement Learning**  
   Authors: Nan Jiang, Lihong Li  
   Institution: University of Michigan / Microsoft Research（論文時期 affiliation；具體版本應以原 PDF 為準）  
   Year: 2016  
   URL: https://proceedings.mlr.press/v48/jiang16.html  
   Code: 多個後續 library 有實作；本輪追 SCOPE-RL  
   Dataset: RL benchmark tasks  
   Architecture: sequential / per-decision importance weighting + Q-function control variate  
   Contribution: 將 bandit DR 延伸到 sequential decision making，降低純 importance sampling 的 variance。  
   Limitation: 長 horizon、弱 overlap 時 cumulative ratio 仍可能爆炸；標準公式假設 action probabilities 與 reward/Q 結構可被適當估計。  
   改變了什麼：**Hermes 的 trajectory correction 應採 stepwise residual correction，而不是只把整條 trajectory 乘一個巨大 inverse propensity。**

5. **Adaptive Sparsening and Smoothing of the Treatment Model for Longitudinal Causal Inference Using Outcome-Adaptive LASSO and Marginal Fused LASSO**  
   Authors: Mireille E. Schnitzer et al.  
   Institution: Université de Montréal、Université Laval、Dartmouth、University of Pennsylvania 等  
   Year: 2026  
   URL: https://doi.org/10.1002/sim.70316  
   Architecture: longitudinal treatment/censoring propensity models + outcome-adaptive LASSO + fused smoothing  
   Contribution: 直接處理 longitudinal settings 中 practical positivity violation 與 treatment model sparsity。  
   Limitation: smoothing/variable selection 可能改善 variance，但不能創造原本不存在的 trajectory support。  
   改變了什麼：**Hermes 需要區分「模型估得差」與「資料根本沒有 support」；後者不能靠更強 ML 補掉。**

---

## 二、Code / GitHub 深讀

### SCOPE-RL

Repo: https://github.com/hakuhodo-technologies/scope-rl

本輪不是只看 README，而是追入：

```text
scope_rl/
├ ope/
│  ├ discrete/
│  │  └ basic_estimators.py
│  ├ continuous/
│  └ ...
├ dataset/
├ policy/
└ utils/
```

最值得看的核心檔案：

```text
scope_rl/ope/discrete/basic_estimators.py
```

其中 `DoublyRobust` 實際執行：

```text
behavior_policy_pscore
↓
evaluation_policy_pscore
↓
step-wise cumulative importance weight w_0:t
↓
weight_prev = w_0:t-1
↓
Q_hat(s_t, a_t)
↓
V_hat(s_t) = Σ_a π_e(a|s_t) Q_hat(s_t,a)
↓
γ^t [
    w_0:t   * (r_t - Q_hat(s_t,a_t))
  + w_0:t-1 * V_hat(s_t)
]
↓
sum over trajectory
```

這裡非常適合映射 Hermes：

```text
Behavior policy
≈ deployed Agent + verification policy version

Evaluation policy
≈ candidate Agent / revised safety gate

Reward / outcome
≈ task success + safety + external effect quality

Q_hat
≈ learned trajectory outcome model / digital twin value model
```

但 Hermes 比標準 RL 更複雜，因為 action space 不只：

```text
TOOL_A / TOOL_B
```

還包括：

```text
ACT
VERIFY
ABSTAIN
ASK_HUMAN
READ_TOOL
WRITE_TOOL
BLOCK
```

而其中 `VERIFY` / `ASK_HUMAN` 會增加資訊，甚至改變 environment，所以不能只是 passive censoring indicator。

---

# 三、本小時最重要 5 個發現

## 1. Step Propensity ≠ Trajectory Support

### 已確認事實
Longitudinal causal inference 與 sequential OPE 都要求逐時條件 action probability；trajectory weight 通常來自：

```text
W_0:t
=
Π_k=0:t
π_target(a_k | h_k)
/
π_logging(a_k | h_k)
```

其中 `h_k` 是到 k 為止的完整歷史。

### Hermes 映射
上一輪只有：

```text
P(verify_t | context_t)
```

本輪升級成：

```text
P(
  verification_t,
  action_t,
  human_query_t,
  tool_mode_t
  |
  full_history_t
)
```

並維護：

```text
TrajectorySupportProfile
├ per_step_propensity[]
├ cumulative_log_weight[]
├ min_step_propensity
├ supported_prefix_length
├ first_support_break
├ effective_trajectory_sample_size
├ policy_version_path
└ history_digest[]
```

### 為什麼重要
即使每一步：

```text
p_t > 0
```

整條 trajectory 仍可能幾乎沒出現過：

```text
0.2 × 0.2 × 0.1 × 0.05 × 0.1
= 0.00002
```

所以：

```text
Per-step positivity
≠
Practical trajectory positivity
```

### 限制
完整 history conditioning 維度很高；必須做 state abstraction / sufficient-history representation，但過度壓縮又可能漏 confounder。

---

## 2. Verification 不是純 Observation；它可能是 Intervention

上一輪把 verification selection 當成「哪筆 label 被看見」。但在 Agent 系統中：

```text
VERIFY
```

可能代表：

```text
問使用者
↓
使用者補資料
↓
Planner 改變 action
↓
Environment state 改變
```

或：

```text
讀 payment API
↓
觸發 rate limit / token refresh / audit log
↓
後續 tool state 改變
```

因此需要區分：

```text
PASSIVE_OBSERVE
ACTIVE_QUERY
INTERVENTIONAL_VERIFY
SIDE_EFFECTFUL_VERIFY
```

新的 causal graph：

```text
History H_t
   ↓
Verification V_t
 ├────────→ Observation O_t
 │                ↓
 │             Action A_t
 │                ↓
 └────────→ Environment S_t+1
                  ↓
               V_t+1
```

所以：

```text
Verification propensity correction
≠
完整 verification causal effect correction
```

如果 V_t 改變後續世界，不能只把它當 missing-label mechanism。

---

## 3. Sequential DR 的核心不是「雙重保險」，而是逐步 residual correction

SCOPE-RL 的 DR 原始碼清楚顯示：

```text
Direct model contribution
+
importance-weighted observed residual
```

是每一步加回，而不是最後一次修正。

Hermes 可定義：

```text
Q_hat(H_t, A_t)
= 預測從目前 state/action 到 trajectory 結束的 outcome

V_hat(H_t)
= candidate policy 下的 expected Q
```

然後逐步：

```text
DR_t
=
W_0:t * (Y_t - Q_hat_t)
+
W_0:t-1 * V_hat_t
```

對 Agent outcome 可改成多目標：

```text
Y_t
=
α task_success
- β safety_violation
- γ irreversible_effect
- δ cost
- ε latency
```

但應保存 vector，不應過早全部壓成一個 scalar。

### 重要限制
若：

```text
W_0:t → huge
```

DR 仍然可能 high variance。

所以：

```text
Doubly Robust
≠
Long-Horizon Robust
```

---

## 4. Monitoring / Verification Policy 是 Time-Varying Confounder，也可能是 Mediator

2026 informative-monitoring 研究的重要訊息是：

```text
who gets observed, when observed
```

本身帶有 state information。

Hermes 例如：

```text
risk_t ↑
→ more likely VERIFY
→ more evidence
→ safer action
```

如果分析 verification 對 final outcome 的 causal effect：

```text
risk_t
```

同時影響：

```text
verification_t
final_outcome
```

是 confounder。

但如果研究 Agent base policy 對 outcome：

```text
verification_t
```

又可能是 policy 的 mediator。

因此同一節點的角色依 estimand 改變：

```text
Node role
≠ intrinsic property
```

必須先定義：

```text
What causal question are we estimating?
```

才知道該 adjust、mediate、stratify 或 intervention。

---

## 5. Agent Safety 需要 Trajectory Positivity Gate，而不只是 Probability Clipping

當某條 candidate policy trajectory：

```text
π_new(actions | histories)
```

落到 logging data 從未支撐的區域，單純：

```text
clip weight at 10
```

只是把 variance 壓住，不代表識別問題消失。

所以 Hermes 應加入：

```text
TrajectoryPositivityGate
├ SUPPORTED
├ WEAK_SUPPORT
├ PREFIX_ONLY_SUPPORT
├ UNSUPPORTED_ACTION
├ UNSUPPORTED_VERIFICATION_PATH
└ UNIDENTIFIED
```

當：

```text
UNIDENTIFIED
```

系統只能：

```text
REAL_VERIFY
SANDBOX_EXPERIMENT
HUMAN_REVIEW
BLOCK_DEPLOYMENT
```

不能產生：

```text
“95% safe”
```

這是一個比 clipping 更重要的產品安全邊界。

---

# 四、Architecture Breakdown

```text
User / Goal
↓
Agent Policy π
↓
History State H_t
├ context
├ memory
├ tool results
├ world state
├ prior verification
└ policy/version metadata
↓
Verification / Sensing Policy ν_t
├ passive observe
├ active query
├ human query
└ side-effectful verification
↓
Observation O_t
↓
Action Policy π_t
↓
Tool / MCP / World Transition
↓
Outcome / delayed feedback
↓
Trajectory Logger
├ π_t probability
├ ν_t probability
├ censor probability
├ policy version
├ world version
└ history digest
↓
Trajectory Support Auditor
↓
Sequential DR / LTMLE Layer
↓
Trajectory Risk Certificate
↓
Candidate Policy Gate
```

如果 verification 本身改變 environment：

```text
ν_t
↓
World Transition
```

必須另外進 transition model，而不能只當 sampling probability。

---

# 五、Bottom-Level Logic

## 5.1 Trajectory importance ratio

```text
ρ_t
=
π_eval(A_t | H_t)
/
π_log(A_t | H_t)
```

累積：

```text
W_0:t = Π_k≤t ρ_k
```

若連 verification policy 一起換：

```text
ρ_t^joint
=
[
 π_eval(A_t|H_t)
 ν_eval(V_t|H_t)
]
/
[
 π_log(A_t|H_t)
 ν_log(V_t|H_t)
]
```

這只是簡化表示；若 V_t 先於 A_t 並改變 observation/history，實際 factorization 應按照事件順序：

```text
P(V_t | H_t)
×
P(O_t | H_t,V_t)
×
P(A_t | H_t,V_t,O_t)
```

不可偷乘成彼此獨立。

## 5.2 Sequential DR

核心形式：

```text
model estimate
+
weighted residual correction
```

每步使用：

```text
Q_hat(H_t,A_t)
V_hat(H_t)
W_0:t
W_0:t-1
```

避免只有 terminal outcome 時將所有 correction 壓到最後。

## 5.3 Log-domain weight accumulation

Production runtime 不應直接連乘：

```text
W *= ratio
```

而應：

```text
logW_t
=
Σ log ρ_k
```

並同時追：

```text
max_log_weight
weight_variance
ESS
support_break
```

因為長 horizon 容易 overflow / underflow。

## 5.4 Effective sample size

```text
ESS
=
(Σ_i w_i)^2
/
Σ_i w_i^2
```

但 trajectory 系統還需要：

```text
ESS_by_horizon[t]
ESS_by_action_family
ESS_by_verification_path
```

否則總體 ESS 看似足夠，某個危險 action path 可能其實沒有 support。

---

# 六、Visual Simulation Idea

# **Trajectory Selection × Verification Intervention Lab**

畫面主體是一條可互動 Agent trajectory：

```text
S0
│
├ V0: PASSIVE      p=.82
│  ↓
├ A0: SEARCH       p=.61
│
S1
│
├ V1: ASK_HUMAN    p=.17
│  ↓ user adds constraint
├ A1: MCP_WRITE    p=.23
│
S2
│
├ V2: VERIFY_API   p=.04  ⚠
│  ↓ API state changes
├ A2: COMMIT       p=.41
│
S3
```

右側即時顯示：

```text
Step                  0      1      2
Action propensity    .61    .23    .41
Verify propensity    .82    .17    .04
Cumulative log W     .12    1.44    4.81
ESS                  822    244      17
Support               ✓      ⚠       ✕
```

再讓使用者切：

```text
[Behavior policy]
[Candidate policy]
```

直接看哪些 branch 變成：

```text
SUPPORTED
WEAK SUPPORT
UNIDENTIFIED
```

第二視圖顯示 Verification causal role：

```text
VERIFY
├ reveals information
├ changes context
├ changes user behavior
├ changes tool state
└ changes future verification probability
```

第三視圖可以切換估計器：

```text
Naive observed outcome
Trajectory IS
Per-decision IS
Sequential DR
Truncated DR
Model-only
```

並即時顯示：

```text
estimate
variance
ESS
max weight
unsupported mass
```

這會讓非統計背景的人直接看懂：

> **不是資料量很多就代表 AI 的新策略可以被可靠離線評估；關鍵是新策略想走的那些路，舊系統到底有沒有真的走過。**

---

# 七、Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Trajectory Logging Policy
Trajectory Propensity
Sequential Verification Policy
Verification Intervention
Passive Monitoring
Active Monitoring
Side-Effectful Verification
Trajectory Support
Supported Prefix
Support Break
Trajectory Positivity
Practical Longitudinal Positivity
Sequential Doubly Robust Estimator
Per-Decision Importance Weight
Cumulative Importance Weight
Log Importance Weight
Trajectory Effective Sample Size
History-Conditional Action Probability
History-Conditional Verification Probability
Adaptive Monitoring Confounder
Verification Mediator
Trajectory Risk Certificate
Trajectory Support Certificate
```

## 新增 Edges

```text
StepPropensity
COMPOSES_INTO
TrajectoryPropensity

VerificationPolicy
CHANGES
ObservationProcess

VerificationPolicy
MAY_CHANGE
EnvironmentState

EnvironmentState
AFFECTS
FutureVerificationPolicy

History
CONDITIONS
ActionProbability

History
CONDITIONS
VerificationProbability

TrajectorySupport
LIMITS
OffPolicyIdentifiability

SequentialDR
USES
CumulativeImportanceWeight

SequentialDR
USES
QFunctionEstimate

LowTrajectoryESS
WEAKENS
RiskCertificate
```

## 新增否定關係

```text
Per-Step Positivity
≠
Practical Trajectory Positivity

Verification
≠
Always Passive Observation

Observation Policy
≠
Environment-Neutral Policy

Doubly Robust
≠
Long-Horizon Robust

Weight Clipping
≠
Restored Identifiability

Large Dataset
≠
Large Trajectory Support

Node Role
≠
Intrinsic Causal Role

Model Extrapolation
≠
Observed Support
```

---

# 八、與歷史研究比較

前幾輪已建立：

```text
Selective labels
→ Verification propensity
→ Doubly robust correction
→ Positivity / overlap
```

本輪不是重複，而是把單點 DAG：

```text
X → VERIFY → Y observed
```

升級成：

```text
H0
↓
V0 → O0 → A0 → S1
               ↓
H1 ←────────────┘
↓
V1 → O1 → A1 → S2
               ↓
...
```

核心新差異：

```text
上一輪：why was this label observed?
本輪：how did the entire observation/action policy generate this trajectory?
```

以及：

```text
上一輪：verification affects observation availability
本輪：verification may alter the world itself
```

---

# 九、Unknown / Open Questions

## 1. Agent history 到底要保留多細，才能近似 sequential ignorability？

若只用：

```text
risk score + action type
```

可能漏掉：

```text
prompt content
memory state
tool version
user response history
world snapshot
```

但若完整保存所有 token/history，又幾乎無法估 propensity。

需要研究：

```text
Causal History Compression
```

也就是找足以 blocking confounding 的最小 history state。

## 2. Verification-as-intervention 如何和 value-of-information 分開？

有些 verification：

```text
READ_ONLY
```

近似 information acquisition。

有些：

```text
ASK_HUMAN
```

會改變 human state。

有些：

```text
PROBE_API
```

會改變 rate-limit / server state。

需要 causal effect taxonomy。

## 3. Trajectory positivity 不足時，Hermes 應如何主動探索？

候選路線：

```text
sandbox experiment
shadow traffic
stochastic verification floor
safe exploration
human-approved probe
```

但這會再進一步形成：

```text
Data Collection Policy
↔
Safety Policy
```

的閉環。

---

# 十、下一輪研究

下一輪最重要的缺口：

# **Causal History Compression × State Abstraction × Sequential Ignorability Diagnostics × Safe Exploration for Support Repair**

研究路徑：

```text
Full Agent History
↓
Candidate causal variables
↓
History abstraction / representation
↓
Sequential propensity model
↓
Balance / residual confounding diagnostics
↓
Trajectory support map
↓
Unsupported state-action regions
↓
Safe exploration / shadow verification
↓
Support expansion
↓
Re-estimation
```

優先追：

```text
state representation for OPE
history-dependent confounding
sequential balancing representations
causal state abstraction
safe exploration under support constraints
conservative offline RL
coverage / concentrability coefficients
```

---

# 十一、本輪結束回答

- **缺哪一層：** `Causal History Compression + Sequential Ignorability Diagnostics`。目前即使知道 trajectory propensity，也尚未解決「history 應包含哪些變數才足以控制 confounding」。
- **哪個節點最淺：** `TrajectorySupportCertificate`、`VerificationInterventionType`、`CausalHistoryState`。
- **哪個概念仍只是名詞：** `TrajectoryRiskCertificate` 與 `CausalHistoryCompression` 還沒有 Hermes-specific estimator / schema。
- **哪個系統值得讀原始碼：** SCOPE-RL 的 `scope_rl/ope/discrete/basic_estimators.py`，下一步再往 state-marginal / state-action-marginal OPE 與 Double Reinforcement Learning implementations 深挖。
- **哪篇論文需追引用：** `Longitudinal Adaptive Experimental Design... (2026)`；其次是 `Treatment persistence... (2026)`，因為 positivity / persistence 對 Agent trajectory support 非常直接。
- **哪個概念最適合視覺模擬：** `Trajectory Selection × Verification Intervention Lab`。
- **哪個 Agent 架構最值得實作：** **Trajectory-Aware Selective Agent Runtime**：將 action policy、verification policy、world transition、delayed outcome 與 propensity logging 全部統一進 event-sourced trajectory graph，再接 Sequential DR + Support Gate。

---

# 十二、對「AI 到底怎麼運作」新增的一層

目前完整鏈條再補成：

```text
User says something
↓
UI
↓
Agent Runtime
↓
Context / Memory / Tools
↓
Planner
↓
Uncertainty
↓
Verification Policy
↓
Observation Acquisition
↓
Action Policy
↓
MCP / Tool / World Effect
↓
New World State
↓
New Context
↓
Next Verification Probability
↓
Next Action
↓
Trajectory
↓
Delayed Outcome
↓
Which outcomes become observable?
↓
Trajectory-level calibration / OPE
↓
Risk Certificate
↓
Next policy version
```

本輪最核心結論：

> **Agent 不是一次輸入、一次輸出的模型，而是由「看什麼、問什麼、做什麼、因此世界變成什麼、下一步又更可能看什麼」組成的閉環 trajectory。只校正單一步驟的 propensity，無法回答整個 Agent policy 是否真的安全、是否可由歷史資料識別。成熟 Hermes 必須把 verification 與 action 都視為 sequential policy，追蹤整條 trajectory 的 support、weight、causal role 與 uncertainty。**
