# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 22:55（Asia/Taipei）**  
**主題：Active Feedback Acquisition × Verification-as-Action × Value of Information × Query-Policy Alignment × Selection-Bias-Aware Evidence**

---

## 0. 與歷史研究比較：本輪不重複什麼

Hermes 既有研究已經拆過：

- Unknown-Unknown detection、selective acting、active real verification；
- trajectory selection、verification intervention；
- delayed feedback、corrupted feedback、late evidence revision；
- informative delay、feedback censoring、IPCW、missing-outcome evidence；
- belief state、POMDP、multimodal observation reliability。

上一輪真正留下的缺口是：

```text
Passive Feedback Is Biased / Censored
↓
Agent decides to actively verify
↓
But verification choice itself changes
which outcomes become observable
↓
new selection mechanism becomes policy-dependent
```

所以本輪不是再做「uncertainty 高就問人」的 heuristic，而是研究：

> **Verification / clarification / sensor refresh / second-model check 應該被建模成一個 action；它有成本、有 outcome、有 observation model，而且會改變未來的 evidence distribution。**

---

# 本小時新發現

## 新論文 / 新架構 / 新 GitHub

### 1. Value of Information: A Framework for Human-Agent Communication
- Authors: Yijiang River Dong, Tiancheng Hu, Zheng Hui, Caiqi Zhang, Ivan Vulić, Andreea Bobu, Nigel Collier
- Venue: ACL 2026 Long Paper
- Year: 2026
- URL: https://aclanthology.org/2026.acl-long.1987/
- arXiv: https://arxiv.org/abs/2601.06407
- Code: https://github.com/dong-river/VOI_communication
- Problem: LLM Agent 面對 underspecified request 時，要決定「直接做」還是「先問一個問題」。
- Core architecture: belief over latent user preference → candidate query → simulate possible answers/posteriors → compute downstream action value → subtract question cost → ask only if net VoI is positive.
- Reported result: 在 20 Questions、medical diagnosis、flight booking、e-commerce 等四類 domain，VoI 方法整體匹配或優於手調 baseline；論文摘要報告高成本設定可高出最多 1.36 utility points。
- Limitation: utility function、user-answer model、posterior estimator 若失準，VoI 本身也會錯；它不是 statistical safety certificate。

### 2. When Self-Belief Misleads: Active Label Acquisition for RL with Verifiable Rewards
- Authors: Li Wang, Xiaodong Lu, Xiaohan Wang, Yikun Ban, Jiajun Chai, Wei Lin, Tianhao Peng, Guojun Yin
- Institution: Meituan / Beihang University / Nanyang Technological University（公開索引資訊）
- Year: 2026
- URL: https://arxiv.org/abs/2605.25864
- Code: https://github.com/Lumina04/CARE
- Problem: unsupervised RLVR 依賴 pseudo-label / self-belief，錯誤內部 reward 可能自我強化並造成 training collapse；但 ground truth annotation 很昂貴。
- Architecture: RLAVR + Corrective Advantage Gap (CAG) + CARE two-stage acquisition.
- Contribution: 把「哪筆資料值得花真實驗證成本」從 uncertainty sampling 推進到「這筆 ground-truth correction 對 policy-gradient 方向有多大修正價值」。
- Reported result: paper reports only 20% annotation budget already consistently improves over TTRL and closes a large part of the gap to fully supervised RLVR.
- Limitation: 主要是 post-training / RLVR acquisition；不能直接等同 deployed agent 的 online verification policy。

### 3. Leveraging the Value of Information in POMDP Planning
- Authors: Zakariya Laouar, Qi Heng Ho, Zachary Sunberg
- Year: 2026
- URL: https://arxiv.org/abs/2604.01434
- Architecture: VOI-aware dynamic programming + Value of Information Monte Carlo Planning (VOIMCP).
- Contribution: observation 的價值在 belief space 不均一；VOIMCP 在 VoI 低的地方減少 observation branching，把 planning compute 留給真正有資訊價值的 belief regions。
- Limitation: 主要解的是 planning-time observation reasoning cost，而不是 human-feedback selection bias 或 causal verification logging。

### 4. Query-Policy Misalignment in Preference-Based RL
- Authors: Xiao Hu, Jianxiong Li, Xianyuan Zhan, Qing-Shan Jia, Ya-Qin Zhang
- URL: https://arxiv.org/abs/2305.17400
- Contribution: 「對 reward model 最 informative 的 query」不一定對目前 policy 最有用；query distribution 與 policy occupancy 不對齊時，feedback efficiency 會很差。
- Hermes relevance: verification policy 不能只最大化 global uncertainty reduction，而必須最大化 **decision-relevant information**。

### 5. Asking for Information by Evaluating Communication and Coordination Trade-Off in Multi-Agent POMDPs
- 2026 IEEE RA-L
- DOI page: https://doi.org/10.1109/LRA.2026.3703246
- Contribution: agent 比較「不溝通的 return」與「取得其他 agent observation 後的 return」並扣除 communication cost，再決定是否主動 ask。
- Hermes relevance: ASK_AGENT / ASK_USER / REFRESH_SENSOR / VERIFY_TOOL 都應是一等 action，而不是 planner 外的特殊 exception。

---

# 本小時最重要 5 個發現

## 1. Verification 必須是 action，不是 dashboard button

### 已確認事實 / 論文結果

VoI human-agent communication 將 ask-or-act 明確當成 decision problem；VOIMCP 也將「使用 observation information」是否值得處理視為 belief-dependent decision。

### Hermes 應改成

```text
Belief b_t
↓
Candidate world actions A_world
+
Candidate information actions A_info

A_info = {
  ASK_USER,
  ASK_AGENT,
  REFRESH_CAMERA,
  READ_DOM,
  RECHECK_TOOL,
  SECOND_MODEL,
  EXTERNAL_SEARCH,
  HUMAN_REVIEW
}
↓
Action value comparison
↓
choose ACT / VERIFY / ASK / WAIT
```

而不是：

```text
Planner outputs risky action
↓
UI 顯示「是否驗證？」
```

### Bottom-level mechanism

對 information action `q`，最基本的 one-step VoI 可以寫成：

```text
VOI(q | b)
=
E_y[
  max_a E[U(a,S) | b, y, q]
]
-
max_a E[U(a,S) | b]
-
C(q)
```

拆開就是：

```text
current belief b
↓
current best action value V_before
↓
for each candidate query q:
    predict P(y | b,q)
    for each possible answer y:
        update belief b' = Bayes(b,q,y)
        recompute best downstream action value
    expected V_after(q)
↓
VOI = V_after - V_before - query_cost
↓
if VOI > 0:
    query
else:
    act
```

### 關鍵否定 edge

```text
High Uncertainty
≠
High Value of Verification
```

如果 uncertainty 很高，但所有 plausible states 都導向同一個 safe action，那不值得問。

反之 uncertainty 只有中等，但兩個 plausible states 分別導向 SEND 與 DO_NOT_SEND，verification 可能非常有價值。

---

## 2. 真正該最大化的不是 Information Gain，而是 Decision-Relevant Value

Entropy reduction 常被當作 acquisition objective：

```text
IG(q) = H(S|b) - E_y[H(S|b,y,q)]
```

但這只是「知道更多」，不一定代表「做得更好」。

Query-Policy Misalignment 的經驗結果與 CARE 的 CAG 思路共同指出：

```text
Globally informative sample/query
≠
Policy-relevant sample/query
```

### Hermes 新增三種 acquisition objective

```text
AcquisitionObjective
├ INFORMATION_GAIN
├ DECISION_VALUE
└ POLICY_CORRECTION_VALUE
```

其中：

```text
INFORMATION_GAIN
= belief uncertainty 降多少

DECISION_VALUE
= 最終 utility / risk 改善多少

POLICY_CORRECTION_VALUE
= 若目前 pseudo-belief / pseudo-reward 錯了，
  這次真實驗證能修正多少 policy update
```

CARE 的 Corrective Advantage Gap 提供很重要的底層觀念：

```text
pseudo rewards r~
↓
pseudo GRPO advantage Ã

true rewards r
↓
true GRPO advantage A

CAG = ||A - Ã||
```

若 CAG 大，代表錯誤 label 不只是「預測錯」，而是可能把 optimizer 往不同方向推。

### Hermes 應借用但不能混淆

部署期可以定義類似：

```text
DecisionCorrectionGap(q)
=
Expected distance between
current action/risk decision
and
post-verification action/risk decision
```

但這是 Hermes 工程推論，不是 CARE paper 已證明的 deployed-agent theorem。

---

## 3. Active verification 會自己製造新的 selection bias

上一輪研究：

```text
Observed Feedback
≠
True Outcome Distribution
```

本輪再往下一層：

如果 Agent 主動選：

```text
只有高 uncertainty case 才去查真值
```

那 verified dataset 變成：

```text
P(verified=1 | history, belief, uncertainty, action, risk)
```

不是自然世界 sample。

因此：

```text
Verified Cases
≠
Representative Cases
```

### 新 runtime requirement

每次 verification decision 必須保存：

```text
VerificationPropensityRecord
├ event_id
├ candidate_query_set
├ selected_query
├ selection_probability
├ scoring_function_hash
├ model/belief epoch
├ budget state
├ query cost
├ eligibility mask
└ forced/randomized exploration flag
```

原因：若未來要估：

```text
「如果 verification policy 換成另一種，
Agent 的安全率 / utility 會怎樣？」
```

沒有 query propensity，就很難做 OPE / IPS / DR correction。

### 重要 distinction

```text
Verification Improves Current Decision
≠
Verification Dataset Is Unbiased For Future Learning
```

這是目前 Agent active-learning pipeline 最容易被忽略的層。

---

## 4. Verification Policy 與 Acting Policy 是 coupled policies

不能把兩個 policy 分開想：

```text
π_action(a | b)
π_verify(q | b)
```

因為 verification 會改 belief：

```text
b_t
↓ π_verify
q_t
↓ observation y_t
b'_t
↓ π_action
a_t
```

而 action 又改變 future state：

```text
a_t
↓
S_{t+1}
↓
future observations
↓
future verification opportunities
```

所以更完整的是 joint policy：

```text
π_joint(mode, action/query | belief, budget, risk)
```

### Hermes architecture implication

Planner 不應只有：

```text
world_action_candidates
```

而要同時生成：

```text
information_action_candidates
```

並讓 action-value evaluator 比較：

```text
ACT_NOW
ASK_USER
VERIFY_TOOL
REFRESH_SENSOR
SECOND_MODEL
WAIT_FOR_PENDING_TRUTH
```

這才會形成真正的 closed-loop information gathering Agent。

---

## 5. Verification budget 本身也是 state，且有 opportunity cost

CARE 是 budget-constrained active label assignment；VoI human-agent framework 顯式扣除 cognitive cost；multi-agent POMDP work 扣除 communication cost。

因此 Hermes 的 verify gate 不可只是：

```text
if risk > threshold: verify
```

而應引入：

```text
VerificationBudgetState
├ human_interrupt_budget
├ latency_budget
├ API/token budget
├ sensor energy budget
├ privacy budget
├ external-call quota
├ pending-verification count
├ urgency
└ opportunity_cost
```

同樣一個 query：

```text
ASK_USER
```

在低風險慢任務可能 cost 很低；
在即時語音、駕駛、醫療急迫情境，延遲本身可能造成 risk。

所以：

```text
Useful Information
≠
Worth Acquiring Now
```

---

# Architecture Breakdown

## Active Verification / Information Acquisition Runtime

```text
User / Camera / Voice / UI / Tool / MCP
↓
Observation Ledger
↓
Belief State Engine
↓
Decision Boundary Detector
│
├─ candidate WORLD actions
│   ├ READ
│   ├ WRITE
│   ├ SEND
│   └ EXECUTE
│
└─ candidate INFORMATION actions
    ├ ASK_USER
    ├ ASK_AGENT
    ├ SENSOR_REFRESH
    ├ TOOL_RECHECK
    ├ WEB_VERIFY
    ├ SECOND_MODEL
    └ WAIT_FOR_PENDING_TRUTH
↓
Query Outcome Model
P(y | belief, query)
↓
Counterfactual Belief Updater
b → b_y
↓
Downstream Action Re-evaluator
↓
Acquisition Scorer
├ expected utility gain
├ safety/risk gain
├ policy-correction value
├ entropy / information gain
└ calibration gain
↓
Cost Model
├ user interruption
├ latency
├ money/API
├ privacy
└ compute/energy
↓
Verification Policy
↓
Verification Propensity Logger
↓
Execute Query
↓
Observation / Truth
↓
Belief Update
↓
Permission Gate
↓
World Action
↓
Outcome
↓
Feedback Observation Process
↓
Selection-Bias-Aware Learning / Evaluation
```

---

# Bottom-Level Logic

## 1. Expected Value of Perfect / Sampled Information

在 latent state `S`、belief `b(S)`、world actions `a` 下：

```text
V_no_query(b)
=
max_a Σ_s b(s) U(a,s)
```

對 query `q`：

```text
P(y | b,q)
=
Σ_s P(y | s,q)b(s)
```

Bayes update：

```text
b_q,y(s)
∝
P(y | s,q)b(s)
```

Query 後期望 value：

```text
V_query(b,q)
=
Σ_y P(y|b,q)
  max_a Σ_s b_q,y(s)U(a,s)
-
C(q)
```

所以：

```text
VOI(q|b)
=
V_query(b,q)-V_no_query(b)
```

重要的是 `U` 可以不是 reward，而是：

```text
utility
-
risk_penalty
-
irreversibility_cost
-
latency_cost
-
privacy_cost
```

---

## 2. CARE / CAG mechanism

CARE paper 的 RLVR setting：

```text
prompt x
↓
G rollouts
↓
pseudo reward r~
↓
pseudo advantage Ã
↓
policy gradient
```

若取得 ground truth：

```text
true reward r
↓
true advantage A
```

Corrective Advantage Gap：

```text
CAG ≈ ||A - Ã||
```

高 CAG 的 sample 表示 pseudo supervision 對 optimization direction 可能有較高傷害。

因為真值在 query 前未知，CARE 用 two-stage network：

```text
Stage 1:
Predict pseudo-label reliability
↓
Reliable
→ retain/use pseudo supervision

Unreliable
↓
Stage 2:
Predict expected correction value / CAG
↓
rank under annotation budget
↓
query selected ground truth
```

這比：

```text
highest entropy → always annotate
```

更接近 decision/policy relevance。

---

## 3. Verification propensity and off-policy correction

如果 deployed verifier policy 是：

```text
q_t ~ μ(q | H_t)
```

而之後想評估 target query policy：

```text
π(q | H_t)
```

最基本 importance weight：

```text
w_t
=
π(q_t|H_t) / μ(q_t|H_t)
```

但這仍有前幾輪研究已指出的限制：

- positivity/support；
- high variance；
- verification action 會改後續 belief/state，因此 trajectory-level correction 可能需要 occupancy / sequential DR；
- query propensity 若是 deterministic 且從不探索某些 query，target policy 可能不可識別。

因此本輪新增：

```text
VerificationExplorationContract
├ min_propensity
├ forced_randomization_rate
├ unsafe_queries_excluded
├ logging_policy_version
└ support_certificate
```

---

# System Architecture Deep Dive

## A. dong-river/VOI_communication

本輪直接讀原始碼，不只 README。

Repository root：

```text
VOI_communication/
├ flight_rec/
└ mixed_20q/
```

`flight_rec/` 包含：

```text
README.md
api_utils.py
constants.py
data/
evaluate.py
flight_rec.py
results/
run_experiments.sh
utils.py
voi_utils.py
```

最值得看的檔案：

```text
flight_rec/voi_utils.py
flight_rec/flight_rec.py
flight_rec/api_utils.py
```

`voi_utils.py` 的註解直接定義 runtime pipeline：

```text
(1) LLM estimates priors over preference states
(2) candidate question → estimate P(answer)
    + posterior P(state | answer)
(3) action value = max option expected matched-features
(4) VOI = E[value_after] - value_before - question_cost
```

實作還把 user preference state 拆成：

```text
price
stops
layover
arrival
airline
```

並對 candidate clarification question 預測：

```text
P(answer=A/B/C/...)
```

以及每個 hypothetical answer 下的 posterior。

### Hermes 可直接借用的 pattern

```text
CandidateQuery
↓
PredictAnswerDistribution
↓
CounterfactualPosteriorPerAnswer
↓
EvaluateBestActionPerPosterior
↓
ExpectedValueAfter
↓
subtract QueryCost
↓
VOI
```

### 不可直接照搬的部分

目前 repo 以 LLM 自己估 prior、answer distribution、posterior；這些概率若未校準，VoI 只是 model-based expected utility，不等同 statistical guarantee。

Hermes 必須另外保留：

```text
QueryModelCalibrationCertificate
```

---

## B. Lumina04/CARE

Repo root 是完整訓練 codebase，而非只有 paper stub：

```text
CARE/
├ examples/
├ recipe/
├ scripts/
└ verl/
```

README 指定兩個主要實驗 track：

```text
Math:
examples/unsupervised_rlvr/
reward: verl/utils/reward_score/ttrl_math/

Knights-and-Knaves:
examples/unsupervised_rlvr_kk/
reward: verl/utils/reward_score/kk.py
```

Math 的 `examples/unsupervised_rlvr/` 內含：

```text
al-rule.sh
certainty-based.sh
ensemble-based.sh
grpo-adv-diff.sh
grpo-avg-prob-gt.sh
grpo-entropy-gt.sh
grpo-random-gt.sh
self-verify.sh
...
```

`al-rule.sh` 暴露 CARE acquisition / probe 相關 hyperparameters：

```text
PROBE_GT_TOP_PCT
PROBE_PROB_GATE
PROBE_PROMPT_HIDDEN_DIM
PROBE_RESP_MLP_HIDDEN_DIM
PROBE_TRAIN_STEPS
PROBE_BUFFER_SIZE
PROBE_BUFFER_BATCH_SIZE
SOFT_ADV
REWARD_TYPE=grpo_adv_diff_probe_setscorer
```

並把 probe settings 接到 `verl.trainer.main_ppo` 的 unsupervised reward estimator。

### Hermes 可借用 pattern

```text
cheap internal estimate
↓
reliability gate
↓
high-value uncertain subset
↓
expensive real verification
↓
correct policy signal
```

而不是：

```text
all uncertain samples
↓
expensive verification
```

---

# Visual Simulation Idea

## **Verification Policy × Value-of-Information × Selection Bias Lab**

左側：Belief / decision state

```text
Possible world state

AUTH_VALID       0.55
AUTH_EXPIRED     0.35
TOOL_STALE       0.10
```

目前 action values：

```text
READ_MCP          +4.8
WRITE_MCP         +4.3 but risk tail high
ASK_USER          -0.4 interruption
REFRESH_AUTH      -0.8 latency/API
SECOND_MODEL      -0.2 compute
```

中間：候選 query outcomes

```text
REFRESH_AUTH
├ VALID   p=.58
│  → belief update
│  → WRITE value +6.2
└ EXPIRED p=.42
   → belief update
   → BLOCK / REAUTH value +5.7

Expected post-query value = 5.99
Query cost = .8
Current best no-query = 4.8
VOI = +0.39
→ VERIFY
```

右側：selection-bias monitor

```text
Verification policy this week:

High-risk states verified: 91%
Low-risk states verified:   4%

Verified sample success rate: 73%
Naive global safety estimate: INVALID

Query propensity support:
READ-only low-risk region: weak
WRITE region: strong
```

再加一個 toggle：

```text
Acquisition Objective
[ Entropy ]
[ Information Gain ]
[ Decision Value ]
[ Policy Correction Value ]
```

使用者會直接看到：

> 最大 entropy 的 query，不一定是最值得問的 query。

---

# Papers

## Paper 1
**Title:** Value of Information: A Framework for Human-Agent Communication  
**Authors:** Yijiang River Dong, Tiancheng Hu, Zheng Hui, Caiqi Zhang, Ivan Vulić, Andreea Bobu, Nigel Collier  
**Year:** 2026  
**Venue:** ACL 2026 Long Papers  
**URL:** https://aclanthology.org/2026.acl-long.1987/  
**Code:** https://github.com/dong-river/VOI_communication  
**Dataset/Tasks:** 20 Questions, medical diagnosis, flight booking, e-commerce  
**Architecture:** belief → candidate question → answer distribution → posterior simulation → downstream utility → subtract question cost  
**Contribution:** decision-theoretic clarify-or-commit without hand-tuned confidence threshold  
**Limitations:** model-based probability and utility estimation; no generic safety guarantee.

## Paper 2
**Title:** When Self-Belief Misleads: Active Label Acquisition for Reinforcement Learning with Verifiable Rewards  
**Authors:** Li Wang et al.  
**Institution:** Meituan / Beihang University / Nanyang Technological University  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2605.25864  
**Code:** https://github.com/Lumina04/CARE  
**Dataset:** DAPO-Math-17k; Knights-and-Knaves in public repo setup  
**Architecture:** RLAVR → reliability classifier → expected CAG predictor → sparse GT query → mixed verified/pseudo reward → GRPO  
**Contribution:** annotation value linked to correction of policy-gradient advantage, not just uncertainty  
**Limitations:** training-time RLVR; deployment-time active verification needs additional causal/evidence treatment.

## Paper 3
**Title:** Leveraging the Value of Information in POMDP Planning  
**Authors:** Zakariya Laouar, Qi Heng Ho, Zachary Sunberg  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2604.01434  
**Architecture:** VOI-aware POMDP dynamic programming + VOIMCP  
**Contribution:** computational effort follows observation value across belief space  
**Limitations:** not a human-query selection-bias paper.

## Paper 4
**Title:** Query-Policy Misalignment in Preference-Based Reinforcement Learning  
**Authors:** Xiao Hu, Jianxiong Li, Xianyuan Zhan, Qing-Shan Jia, Ya-Qin Zhang  
**URL:** https://arxiv.org/abs/2305.17400  
**Contribution:** global reward-model information acquisition can be poorly aligned with current policy needs; near-on-policy query improves feedback efficiency.

## Paper 5
**Title:** Asking for Information by Evaluating the Communication and Coordination Trade-Off in Multi-Agent POMDPs  
**Year:** 2026  
**DOI:** https://doi.org/10.1109/LRA.2026.3703246  
**Contribution:** ask-for-information decision via expected return gain vs communication cost.

---

# Unknown / Open Questions 1–3

## 1. Verification-policy OPE under belief intervention

當 query 改變 belief、belief 又改 action，再改未來 state 時，單步：

```text
π_verify / μ_verify
```

是否足夠？

通常不夠。下一步要正式連到：

```text
joint verification + action policy
↓
trajectory occupancy
↓
sequential DR / marginalized correction
```

目前仍缺 production-ready theorem bridge。

## 2. Query model calibration

VoI 依賴：

```text
P(answer | belief,query)
P(state | answer,query)
```

但若這兩個 probability 都是同一個 LLM 自己估，可能出現：

```text
miscalibrated question model
↓
wrong VOI
↓
wrong ask/act decision
```

Hermes 仍缺：

```text
QueryModelCalibrationCertificate
```

## 3. Verification can corrupt the target

ASK_USER、HUMAN_REVIEW、SECOND_MODEL 不一定是 passive measurement。

問題本身可能：

- 改變使用者偏好；
- 提示答案；
- 改變 agent/user interaction trajectory；
- 讓 second model 錨定在 first model proposal；
- sensor refresh 改變 physical state / latency.

因此：

```text
Verification
≠
Non-interventional Observation Automatically
```

下一輪需要拆 **information action causal effect**。

---

# 下一輪研究

下一輪建議聚焦：

# **Information Action Causal Effect × Query-Induced State Change × Verification Policy OPE × Joint Acting/Query Policy**

研究鏈：

```text
Belief b_t
↓
Choose verification q_t
↓
q_t itself may change human/world state
↓
observe y_t
↓
update belief
↓
choose world action a_t
↓
future state / feedback
↓
need joint causal model
↓
query-policy OPE
↓
selection-bias-aware sequential evidence
↓
permission gate
```

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Information Action
Verification Action
Clarification Action
Active Feedback Acquisition
Query Policy
Verification Policy
Joint Query-Action Policy
Value of Information
Expected Value of Verification
Decision-Relevant Information
Policy-Correction Value
Corrective Advantage Gap
Query Outcome Model
Counterfactual Query Posterior
Verification Cost Model
Verification Budget State
Verification Propensity
VerificationPropensityRecord
Verification Exploration Contract
Query-Policy Alignment
Query-Policy Misalignment
Verified Sample Selection Bias
Query Model Calibration
QueryModelCalibrationCertificate
Information Action Intervention
Verification-Induced State Change
```

## 新增 Edges

```text
High Uncertainty
≠ High Verification Value

Information Gain
≠ Decision Value

Most Informative Query
≠ Most Policy-Relevant Query

Verified Dataset
≠ Representative Outcome Dataset

Verification Improves Decision
≠ Verification Data Is Unbiased

ASK_USER
IS-A Information Action

REFRESH_SENSOR
IS-A Information Action

SECOND_MODEL
IS-A Information Action

Verification Policy
CHANGES Observation Distribution

Verification Observation
UPDATES Belief State

Belief State
CONTROLS World Action

World Action
CHANGES Future State
```

---

# 本輪結束判定

**缺哪一層：** 目前最缺 `Information Action Causal Effect + Joint Query/Acting Policy OPE`。  
**哪個節點最淺：** `VerificationPropensity`, `QueryModelCalibrationCertificate`, `Verification-Induced State Change`, `JointQueryActionPolicy`。  
**哪個概念仍只是名詞：** production 級 `Selection-Bias-Aware Verification E-Process` 仍只有 architecture concept，尚無通用 theorem。  
**哪個系統值得讀原始碼：** `dong-river/VOI_communication/flight_rec/voi_utils.py`，以及 `Lumina04/CARE/examples/unsupervised_rlvr/al-rule.sh` 往 `verl` 的 acquisition estimator 路徑。  
**哪篇論文需追引用：** ACL 2026 `Value of Information: A Framework for Human-Agent Communication`，以及 CARE/RLAVR；前者適合 deployed clarification policy，後者適合 policy-correction-aware acquisition。  
**哪個概念最適合視覺模擬：** `Verification Policy × VoI × Selection Bias Lab`。  
**哪個 Agent 架構最值得實作：**

```text
Belief Engine
↓
World Action + Information Action Generator
↓
VoI / Risk / Cost Evaluator
↓
Verification Policy
↓
Propensity Logger
↓
Belief Update
↓
Permission Gate
↓
World Action
```

---

# 對「AI 到底怎麼運作」新增的一層

過去常把 AI Agent 畫成：

```text
Observation
→ Reasoning
→ Action
```

這一輪補上的真正閉環是：

```text
Observation
↓
Belief
↓
「現在知道的夠不夠？」
↓
Information Action
├ 問使用者
├ 查工具
├ 重看畫面
├ 問另一個 Agent/Model
└ 等待真實 feedback
↓
New Observation
↓
Updated Belief
↓
Reasoning / Planning
↓
World Action
```

也就是：

> **成熟 Agent 不只是根據資訊做決定；它還必須決定「下一份資訊值不值得取得」。而從它開始選擇要看哪些 truth 的那一刻起，資料本身就不再是被動、無偏的世界樣本。Verification policy 因此同時是 decision policy、observation policy，也是未來 learning dataset 的 selection mechanism。**
