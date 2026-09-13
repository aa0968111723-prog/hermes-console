# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 23:53（Asia/Taipei）**  
**主題：Information Action Dual Effect × Active Perception × Query-Induced State Change × Joint Query/Action Policy × Causal OPE**

---

## 0. 與歷史研究比較：本輪不重複什麼

上一輪已完成：

- Active Feedback Acquisition
- Verification-as-Action
- Value of Information (VoI)
- Query-Policy Alignment
- Verification Propensity / Selection Bias

上一輪的核心缺口是：

```text
Verification chosen by agent
↓
verification changes what becomes observable
↓
but does verification also change the world / user / future policy?
```

所以本輪不再研究「uncertainty 高要不要問」，而是研究更底層的：

> **Information action 往往具有 dual effect：它一方面改變資訊，另一方面也可能改變環境狀態、使用者狀態、時間、成本、信任與後續 observation process。**

因此：

```text
ASK_USER
REFRESH_CAMERA
MOVE_VIEWPOINT
READ_TOOL
SECOND_MODEL
WAIT
```

不能一律視為 passive observation。

---

# 本小時新發現

## 新論文 / 新架構 / 新 GitHub / 新模型

### 1. Integrated Control and Active Perception in POMDPs for Temporal Logic Tasks and Information Acquisition
- Authors: Chongyang Shi, Michael R. Dorothy, Jie Fu
- Year: 2025
- URL: https://arxiv.org/abs/2504.13288
- Architecture: joint control + active perception policy in a POMDP; actions can affect both transition dynamics and emission/perception function.
- Contribution: optimization jointly considers task satisfaction and conditional-entropy reduction about hidden temporal events.
- What changed: sensing no longer sits outside planning; the policy itself chooses actions that simultaneously influence state dynamics and future information.
- Limitation: graph/security-style examples; does not directly solve LLM-agent human-query causal effects or generic production OPE.

### 2. Act, Sense, Act: Learning Non-Markovian Active Perception Strategies from Large-Scale Egocentric Human Data
- Authors: Jialiang Li, Yi Qiao, Yunhan Guo, Changwen Chen, Wenzhao Lian
- Institution: Shanghai Jiao Tong University / collaborators
- Year: 2026
- URL: https://arxiv.org/abs/2602.04600
- Project: https://jern-li.github.io/asa/
- Architecture: CoMe-VLA, cognitive auxiliary head + dual-track temporal memory + VLA policy.
- Contribution: active perception represented as a history-dependent perception-action loop with information seeking and decision branching rather than a one-shot image encoder.
- Training: cognitive-state pretraining → cognition-action joint pretraining → robot fine-tuning.
- Limitation: paper/project material supports the architecture; publicly inspectable runtime source was not found in this round, so code-level claims are kept separate from paper-level claims.

### 3. Reinforcement Learning for Active Perception in Autonomous Navigation
- Authors: Grzegorz Malczyk, Mihir Kulkarni, Kostas Alexis
- Year: 2026
- URL: https://arxiv.org/abs/2602.01266
- Architecture: navigation policy jointly controls robot motion and actuated camera orientation, with an information reward based on observed geometry.
- Contribution: perception action is physically coupled to control; moving the sensor changes future observation geometry and consumes control opportunity.
- Limitation: robotic navigation domain; not a general human-agent verification theorem.

### 4. Robot Planning and Situation Handling with Active Perception (VAP-TAMP)
- Authors: Austine Oloo, Zainab Altaweel, Yohei Hayamizu, Peiqi Liu, Yan Ding, Saeid Amiri, Hao Yang, Andy Kaminski, Chad Esselink, Chris Paxton, Xiaohan Zhang, Shiqi Zhang
- Year: 2026
- URL: https://arxiv.org/abs/2604.26988
- Architecture: action knowledge → active view selection / VLM situation assessment → scene graph → task-and-motion planning.
- Contribution: unforeseen execution-time situations are actively perceived rather than assumed to be observable automatically.
- Limitation: public paper confirms architecture; no inspectable official repository was identified in this run.

### 5. Multi-agent active perception with prediction rewards
- GitHub: https://github.com/laurimi/multiagent-prediction-reward
- Engineering status: source code is inspectable.
- Directory structure confirmed:

```text
solver/
├ core/
├ decpomdp/
│  ├ base/
│  ├ conversions/
│  └ discrete/
├ observationmodel/
├ policy/
│  ├ base/
│  └ graph/
├ SPTS/
└ madp_wrapper/
```

- Worth-reading core files:

```text
solver/include/decpomdp/base/DecPOMDP.hpp
solver/include/decpomdp/base/JointBelief.hpp
solver/include/decpomdp/base/Simulator.hpp
solver/include/decpomdp/conversions/DecPOMDPConversions.hpp
solver/include/observationmodel/ObservationModel.hpp
solver/include/policy/base/ExecutionState.hpp
solver/include/policy/base/Policy.hpp
solver/include/policy/graph/FSC.hpp
```

- README/source indicates its conversion and solver represent decentralized active perception using prediction reward / negative-entropy-style final reward; this is useful as an inspectable reference for how belief, observation model, policy graph, and Dec-POMDP solver are separated in code.

---

# 本小時最重要 5 個發現

## 1. Information Action 具有 Dual Effect

### 已確認的控制理論概念

Dual control 的核心不是單純 exploration bonus，而是：

```text
current action
↓
changes physical / latent state
AND
changes future information available to controller
```

因此 action 的價值至少包含：

```text
ImmediateTaskValue(a)
+
FutureControlValue(a)
+
InformationValue(a)
-
InterventionCost(a)
```

對 Hermes：

```text
ASK_USER
```

可能同時：

```text
1. reveal preference
2. change user's attention
3. change user's preference framing
4. consume patience
5. change future response propensity
```

所以：

```text
Verification Action
≠ Passive Sensor Read Automatically
```

### 新 Node

```text
InformationActionDualEffect
```

---

## 2. 需要把 Transition Model 與 Observation Model 同時條件化在 Query/Perception Action

普通簡化 Agent 常寫：

```text
S_t
→ O_t
→ A_t
→ S_{t+1}
```

但 active perception 應寫：

```text
b_t
↓
choose u_t = (world_action, information_action)
↓
S_{t+1} ~ T(S_{t+1} | S_t, u_t)
↓
O_{t+1} ~ Z(O_{t+1} | S_{t+1}, u_t)
↓
b_{t+1}
```

也就是 information action `q_t` 可以同時進入：

```text
Transition kernel T
Observation kernel Z
```

而不是只出現在：

```text
P(answer | query)
```

### Hermes 新 contract

```text
InformationActionEffectContract
├ transition_effect_status
├ observation_effect_status
├ user_state_effect_status
├ latency_effect
├ cost_effect
├ privacy_effect
├ feedback_propensity_effect
├ reversibility
└ interference_scope
```

---

## 3. ASK_USER 的結果不能只當 Bayesian observation；它可能是 intervention on human state

### 合理推論（不是已證明通用 theorem）

LLM Agent 常把 clarifying question 寫成：

```text
latent preference θ
↓
ask q
↓
y ~ P(y | θ,q)
↓
posterior P(θ|y,q)
```

這隱含：

```text
q does not change θ
```

但真實 human interaction 可能更接近：

```text
θ_t
↓ ask(q)
θ_{t+1} ~ T_human(θ_{t+1}|θ_t,q)
↓
y ~ P(y|θ_{t+1},q)
```

例：

```text
「你是不是比較在意安全？」
```

可能不只測量 preference，也 prime 使用者重新權衡安全。

因此：

```text
Answer after query
≠ Counterfactual answer without query
```

### 新 distinction

```text
Measurement Query
vs
Interventional Query
vs
Mixed Query
```

---

## 4. Joint Query/Action Policy 的 OPE 不能只評估 acting policy

上一輪已有：

```text
π_verify(q | b,risk,budget)
```

與：

```text
π_act(a | b)
```

本輪應合併成：

```text
π_joint(u_t | h_t)

u_t ∈ {
  ACT(a),
  QUERY(q),
  SENSE(s),
  WAIT,
  ASK_USER,
  ASK_AGENT
}
```

trajectory 變成：

```text
H_t
↓
U_t ~ μ(U|H_t)
↓
world + observation process transition
↓
O_{t+1}
↓
H_{t+1}
```

若 target policy 改變 query frequency，會同時改變：

```text
state distribution
observation distribution
user state
latency distribution
verification dataset
```

所以：

```text
OPE of Acting Policy Only
≠ OPE of Interactive Agent Policy
```

### 需要記錄

```text
JointPolicyPropensityRecord
├ history_hash
├ eligible_world_actions
├ eligible_information_actions
├ chosen_action
├ selection_probability
├ policy_epoch
├ cost_state
├ intervention_class
└ observation-model-version
```

### Bottom-level candidate

若可得到 behavior propensity `μ(u_t|h_t)` 與 target propensity `π(u_t|h_t)`，path-space importance ratio 是：

```text
W_t
=
Π_{k≤t}
π(U_k|H_k) / μ(U_k|H_k)
```

但這只有在：

- support/positivity 成立；
- action semantics 一致；
- history/state 足夠；
- query-induced transition 已包含在 trajectory 中；
- 沒有未建模 interference；

時才有意義。

這與 Hermes 前幾輪 occupancy-ratio / trajectory-OPE 研究正式接軌。

---

## 5. Information Gain 可能與安全目標衝突

Active perception 常最大化：

```text
I(hidden_state ; future_observation)
```

或最小化 conditional entropy：

```text
H(secret | observations)
```

但在 Agent runtime：

```text
maximum information
≠ minimum risk
```

例如：

```text
為了驗證付款狀態
→ 讀更多敏感帳戶資料
```

可能 information gain 高，但 privacy cost 不可接受。

所以 Hermes 的 query objective 應至少是：

```text
J(q)
=
DecisionValue(q)
+
RiskReduction(q)
+
PolicyCorrectionValue(q)
-
LatencyCost(q)
-
UserBurden(q)
-
PrivacyCost(q)
-
WorldInterventionCost(q)
```

而不是只：

```text
argmax InformationGain(q)
```

---

# Architecture Breakdown

## **Dual-Effect Information Action Runtime**

```text
User / Camera / Voice / UI / Tool / MCP
↓
Observation Ledger
↓
Belief / Predictive State
↓
Candidate Generator
├ World Actions
└ Information Actions
     ├ ASK_USER
     ├ ASK_AGENT
     ├ MOVE_CAMERA
     ├ REFRESH_SENSOR
     ├ RECHECK_TOOL
     ├ SECOND_MODEL
     └ WAIT
↓
Dual-Effect Predictor
├ transition effect T
├ observation effect Z
├ human/user-state effect
├ latency / cost
├ privacy / permissions
└ feedback-propensity effect
↓
Counterfactual Branch Simulator
↓
Joint Query/Action Policy
↓
Propensity + Intervention Logger
↓
Execution
↓
Observation / State Transition
↓
Belief Update
↓
Permission Gate
↓
Outcome Ledger
↓
Joint-Policy OPE / Learning
```

---

# Bottom-Level Logic

## A. Passive sensing assumption

```text
S_{t+1} ~ T(S_{t+1}|S_t,a_t)
O_{t+1} ~ Z(O_{t+1}|S_{t+1})
```

## B. Active sensing / dual-effect model

```text
U_t = (a_t,q_t)

S_{t+1}
~
T(S_{t+1}|S_t,a_t,q_t)

O_{t+1}
~
Z(O_{t+1}|S_{t+1},a_t,q_t)
```

Belief update：

```text
b_{t+1}(s')
∝
Z(o_{t+1}|s',u_t)
×
Σ_s T(s'|s,u_t)b_t(s)
```

這一式直接指出：

> information action 不只會進 observation likelihood，也可能進 transition dynamics。

## C. Human-query extension

```text
X_t = world state
Θ_t = human/user latent state

( X_{t+1}, Θ_{t+1} )
~
T_joint(
 X_{t+1},Θ_{t+1}
 |
 X_t,Θ_t,q_t,a_t
)

Y_{t+1}
~
P(answer | Θ_{t+1},q_t)
```

所以 query-induced preference/attention/trust change 必須成為可表達的 state transition，而不能全部誤認成 epistemic update。

---

# Visual Simulation Idea

# **Information Action Dual-Effect × Counterfactual Query Lab**

左側顯示 belief：

```text
User wants speed    .45
User wants safety   .40
User undecided      .15
```

候選 query：

```text
Q1 neutral:
「速度與安全哪個比較重要？」

Q2 leading:
「為了避免出錯，你是不是比較重視安全？」
```

中間顯示兩種模型：

```text
PASSIVE MODEL
query only reveals Θ

INTERVENTIONAL MODEL
query can change Θ
```

Q2 在 passive 模型可能顯示：

```text
Expected information gain = HIGH
```

但在 interventional model：

```text
Preference-shift risk = HIGH
Counterfactual validity = LOW
```

右側畫 causal branches：

```text
                 ┌→ Answer: Safety
Belief → ASK Q2 ─┤
                 └→ user state shifted toward safety
                         ↓
                    later decisions change
```

再提供 toggle：

```text
[ ] Query affects only observation
[ ] Query affects user state
[ ] Query changes response propensity
[ ] Query changes future trust
[ ] Query costs 15 sec
[ ] Query reveals sensitive data
```

即時計算：

```text
Information Gain
Decision Value
Intervention Cost
Query-induced State Shift
Estimated OPE Support
Permission State
```

這個模擬能清楚說明：

```text
「問更多」
≠
「只是知道更多」
```

---

# Code / GitHub

## laurimi/multiagent-prediction-reward

Repository:
https://github.com/laurimi/multiagent-prediction-reward

### 已確認 directory structure

```text
solver/include/
├ core/
├ decpomdp/
│  ├ base/
│  ├ conversions/
│  └ discrete/
├ observationmodel/
├ policy/
│  ├ base/
│  └ graph/
├ SPTS/
└ madp_wrapper/
```

### 最值得看的核心檔案

```text
decpomdp/base/DecPOMDP.hpp
  → Dec-POMDP abstraction boundary

decpomdp/base/JointBelief.hpp
  → joint hidden-state belief interface

decpomdp/base/Simulator.hpp
  → policy/environment rollout interface

decpomdp/conversions/DecPOMDPConversions.hpp
  → prediction-reward / active-perception conversion

observationmodel/ObservationModel.hpp
  → observation likelihood abstraction

policy/base/ExecutionState.hpp
policy/base/Policy.hpp
policy/graph/FSC.hpp
  → decentralized policy execution / finite-state controller structure
```

### Hermes 值得借用的工程分層

```text
Environment model
≠ Observation model
≠ Belief
≠ Policy
≠ Policy execution state
```

這個 separation 對 Hermes 很重要；目前 LLM Agent 常把這五層混在 prompt/context 裡。

### 不可過度外推

此 repository 是 Dec-POMDP / multi-agent active-perception solver，不等同 LLM/MCP Agent runtime；可借用 architecture boundaries，但不應把其 reward theorem直接當 Hermes safety theorem。

---

# Papers

## Paper 1
**Title:** Integrated Control and Active Perception in POMDPs for Temporal Logic Tasks and Information Acquisition  
**Authors:** Chongyang Shi, Michael R. Dorothy, Jie Fu  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2504.13288  
**Architecture:** POMDP joint control/perception policy; action-dependent transition and emission; temporal-logic task objective + entropy objective.  
**Contribution:** formalizes active perception as part of policy synthesis rather than an external sensor-refresh heuristic.  
**Limitations:** not designed around LLM tools, human preference shift, or off-policy verification evaluation.

## Paper 2
**Title:** Act, Sense, Act: Learning Non-Markovian Active Perception Strategies from Large-Scale Egocentric Human Data  
**Authors:** Jialiang Li, Yi Qiao, Yunhan Guo, Changwen Chen, Wenzhao Lian  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2602.04600  
**Project:** https://jern-li.github.io/asa/  
**Architecture:** CoMe-VLA; visual-language backbone + cognition head + dual temporal memory + action decoder.  
**Contribution:** information-seeking behavior and decision branching are learned as a history-dependent perception-action loop.  
**Limitations:** public runtime code was not located in this round.

## Paper 3
**Title:** Reinforcement Learning for Active Perception in Autonomous Navigation  
**Authors:** Grzegorz Malczyk, Mihir Kulkarni, Kostas Alexis  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2602.01266  
**Architecture:** policy controls both navigation and camera orientation; information metric is part of reward.  
**Contribution:** shows perception geometry is controllable and coupled to physical action.  
**Limitations:** robotics-specific reward and sensors.

## Paper 4
**Title:** Robot Planning and Situation Handling with Active Perception  
**Authors:** Austine Oloo et al.  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2604.26988  
**Architecture:** action knowledge → strategic VLM prompting/view selection → scene graph → integrated task-and-motion planning.  
**Contribution:** runtime anomalies trigger active perceptual investigation instead of blindly replanning from stale state.  
**Limitations:** code not confirmed inspectable in this round.

## Paper 5
**Title:** Query-Policy Misalignment in Preference-Based Reinforcement Learning  
**Authors:** Xiao Hu, Jianxiong Li, Xianyuan Zhan, Qing-Shan Jia, Ya-Qin Zhang  
**Venue:** ICLR 2024  
**URL:** https://arxiv.org/abs/2305.17400  
**Contribution:** query distribution must align with policy-relevant state/action occupancy; global reward-model uncertainty is not sufficient.  
**Relation to this round:** once query is itself an intervention, query-policy alignment must include both observation selection and query-induced transition changes.

---

# Confirmed Fact / Paper Result / Engineering / Inference Boundary

## 已確認事實 / 官方或論文直接支持
- POMDP active-perception formulations can allow actions to affect both dynamics and observation/emission.
- Active perception can jointly optimize control objectives and information objectives.
- 2026 active-perception VLA work models information seeking as a history-dependent perception-action loop.
- Inspectable Dec-POMDP code separates belief, observation model, policy, execution state, and simulator layers.

## 工程實作確認
- `multiagent-prediction-reward` exposes concrete Dec-POMDP, observation-model, policy graph, execution-state, and conversion modules rather than only a README-level sketch.

## 合理推論
- ASK_USER can be a state-changing intervention due to priming, attention, burden, trust, or preference reconstruction.
- SECOND_MODEL can be interventional if the verifier is shown first-model output and becomes anchored.
- WAIT can itself be an action because the environment/user state may evolve while waiting.

## 尚未驗證假說
- Generic production-grade causal correction for LLM-agent query-induced user-state shifts.
- A universal joint-query/action OPE estimator robust to latent human-state interference.
- An anytime-valid e-process that simultaneously handles adaptive querying, query-induced dynamics, delayed feedback, and selection bias.

---

# Unknown / Open Questions 1–3

## 1. Query Causal Identifiability

如果：

```text
query q
→ changes user state Θ
→ changes answer y
```

如何從 normal interaction log 分離：

```text
information revealed by q
vs
preference/state caused by q
```

沒有 randomization / instruments / strong structural assumptions 時可能不可識別。

## 2. Joint Query/Action OPE

如何同時處理：

```text
query propensity
world-action propensity
state-distribution shift
observation-kernel shift
user-state intervention
feedback censoring
```

目前 Hermes 的 trajectory OPE / occupancy-ratio研究還沒有完整覆蓋這個 joint intervention setting。

## 3. Safe Information Actions

資訊行為本身如何進 Permission Gate？

例如：

```text
READ_PRIVATE_FILE
ASK_SENSITIVE_QUESTION
MOVE_CAMERA
WEB_VERIFY
EXTERNAL_AGENT_QUERY
```

本身都可能具有 privacy / security / social cost，因此不能把「只是在查證」預設成低風險。

---

# 下一輪研究

下一輪收斂為：

# **Query Causal Identifiability × Interference × Human-State Dynamics × Joint Query/Action OPE**

研究鏈：

```text
Information Action q_t
↓
Does q only reveal state?
or also change state?
↓
Measurement-vs-Intervention Identification
↓
Human / Environment State Transition Model
↓
Interference / Carryover
↓
Joint Query-Action Propensity
↓
Counterfactual Query Policy Evaluation
↓
Permission-Aware Information Acquisition
```

重點問題：

```text
P(answer | do(query=q))
vs
P(answer | observe(query=q))
```

以及：

```text
query at t
→ human state at t+1
→ answer/action at t+2
```

的 carryover effect。

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Information Action Dual Effect
Active Perception Action
Dual Control
Dual Effect
Joint Query-Action Policy
InformationActionEffectContract
Measurement Query
Interventional Query
Mixed Query
Query-Induced State Change
Human-State Transition
User-State Carryover
Observation-Kernel Intervention
Query-Induced Observation Shift
Query-Induced Transition Shift
JointPolicyPropensityRecord
Information-Action Permission
Information-Action Privacy Cost
Active Sensor Control
Decision Branching
Counterfactual Query Policy
Joint Query-Action OPE
Information Intervention Log
Perception-Control Coupling
```

## 新增 Edges

```text
Verification Action
≠ Passive Observation Automatically

ASK_USER
≠ Pure Measurement Automatically

Information Gain
≠ Safe Information Acquisition

Query Answer
≠ Pre-Query Preference Readout Automatically

Observation Policy
→ Can Change State Distribution

Information Action
→ Can Change Observation Kernel

Information Action
→ Can Change Transition Kernel

Most Informative Query
≠ Lowest-Intervention Query

Acting-Policy OPE
≠ Joint Interactive-Policy OPE

More Sensing
≠ More Safety Automatically
```

---

# 本輪結束判定

**缺哪一層：** `Measurement-vs-Intervention Identification Layer`，以及其後的 `Joint Query/Action Causal OPE`。  

**哪個節點最淺：** `QueryInducedStateChange`、`HumanStateTransition`、`JointQueryActionOPE`、`InformationActionPermission`。  

**哪個概念仍只是名詞：** production 級 `Causal Query Auditor` 與 generic `Joint Interactive Agent OPE`。  

**哪個系統值得讀原始碼：** `laurimi/multiagent-prediction-reward`，優先 `DecPOMDPConversions.hpp`、`JointBelief.hpp`、`ObservationModel.hpp`、`Simulator.hpp`、`FSC.hpp`。  

**哪篇論文需追引用：** `Integrated Control and Active Perception in POMDPs for Temporal Logic Tasks and Information Acquisition`，因為它最直接連結 action-dependent dynamics + perception；以及 2026 `Act, Sense, Act`，因為它把 active perception變成 VLA history-dependent policy。  

**哪個概念最適合視覺模擬：** `Information Action Dual-Effect × Counterfactual Query Lab`。  

**哪個 Agent 架構最值得實作：**

```text
Belief Engine
↓
World + Information Action Generator
↓
Dual-Effect Predictor
↓
Counterfactual Branch Simulator
↓
Joint Query/Action Policy
↓
Propensity + Intervention Logger
↓
Permission Gate
```

---

# 對「AI 到底怎麼運作」新增的底層答案

從前幾輪可以一路還原：

```text
User / Camera / Voice / Video / Tool
↓
Observation
↓
Reliability / Event-Time / Dependence
↓
Belief / Predictive State
↓
Reasoning / Planning
↓
Candidate World Actions
+
Candidate Information Actions
↓
Joint Query-Action Policy
↓
Tool / MCP / Physical / Communication Action
↓
World State Changes
+
Observation Process Changes
↓
New Multimodal Evidence
↓
Belief Revision
```

本輪補上的關鍵是：

> **AI 並不是站在世界外面「多問一個問題就多得到一筆資料」。只要 Agent 主動移動鏡頭、詢問使用者、呼叫第二個模型、等待、刷新工具或改變感測位置，它就在選擇未來會看見什麼；而其中一些資訊行為還會直接改變世界或被觀察者本身。因此成熟 Agent 的 perception、verification、communication 與 action 最終必須放進同一個 causal control loop。**
