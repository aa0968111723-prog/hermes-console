# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 01:53（Asia/Taipei）**  
**本輪主題：Observation World Model × Belief-State Update × POMDP Active Perception × Expected Information Gain**

---

## 0. 本輪與歷史研究的差異

前一輪已完成：

```text
Visual Evidence
→ Evidence Sufficiency
→ Candidate Perception Actions
→ Value of Information
→ Acquire / Answer / Abstain
```

這輪不再重複「要不要 Crop / Zoom」本身，而是往下一層問：

> Agent 在還沒看之前，憑什麼預測「看那裡」可能得到什麼？看到新 observation 後，內部世界理解到底如何更新？

因此本輪把缺口拆成：

```text
Hidden World State
↓
Belief State b_t(s)
↓
Transition Model T(s'|s,a)
↓
Observation Model O(o|s',a)
↓
Perception Action a_t
↓
Observation o_{t+1}
↓
Bayesian / Approximate Belief Update
↓
Updated Belief b_{t+1}
↓
Expected Information Gain / Expected Utility
↓
Next Perception / Physical / Tool Action
```

本輪最重要的區分：

```text
Conversation Memory
≠ Belief State

Observation Summary
≠ Observation Model

Confidence Score
≠ Probability Distribution over Hidden States

POMDP-shaped Loop
≠ Explicit POMDP World Model
```

---

# 1. 本小時新發現

## 新架構 1：OmniAgent — native omni-modal active perception

**Paper:** Native Active Perception as Reasoning for Omni-Modal Understanding  
**Authors:** Zhenghao Xing, Ruiyang Xu, Yuxuan Wang, Jinzheng He, Ziyang Ma, Qize Yang, Yunfei Chu, Jin Xu, Junyang Lin, Chi-Wing Fu, Pheng-Ann Heng  
**Venue:** ICML 2026  
**Year:** 2026  
**Paper:** https://arxiv.org/abs/2606.19341  
**Code:** https://github.com/HarryHsing/OmniAgent

OmniAgent 把長影片理解描述成 POMDP-based Observation–Thought–Action（OTA）循環。Agent 每輪只選一個 structured action：

```text
get_frames
get_audio
get_clip
answer
```

環境只負責回傳原始 media segment；真正的 multimodal perception、reasoning 與 action selection 都由同一 native omni model 完成。

**重要限制：** 原始碼中的 operational state 主要以 textual observation / thought / action history 表達，並未看到 classical POMDP 中完整顯式的 belief distribution + learned/defined observation kernel + transition kernel。這表示「POMDP-based interaction」與「explicit belief-space planner」必須分開標記。

---

## 新機制 2：Perception-Based Beliefs（PBP）

**Paper:** Perception-Based Beliefs for POMDPs with Visual Observations  
**Authors:** Miriam Schäfers, Merlijn Krale, Thiago D. Simão, Nils Jansen, Maximilian Weininger  
**Year:** 2026  
**Paper:** https://arxiv.org/abs/2602.05679

PBP 的核心非常適合作為 Hermes 的底層 reference mechanism：

```text
Raw Image o_t
↓
Perception Model
↓
P(s | o_t)
↓
Belief Update
↓
POMDP Solver
```

它不要求 traditional solver 直接理解高維 image tensor，而是把 image classifier 的輸出轉成 state probability distribution，再進入 belief update。

論文證明：如果 classifier 精確，PBP belief update 可與 standard belief update 一致；對 classifier 不精確情況則加入 uncertainty quantification 修正。

這給 Hermes 一個非常重要的設計原則：

```text
Perception output
最好不是只有：
"我看到紅色杯子"

而是可以額外形成：
P(cup_on_table)=0.72
P(cup_in_hand)=0.18
P(no_cup)=0.10
```

---

## 新 world-model learning 3：Pinductor

**Paper:** Learning POMDP World Models from Observations with Language-Model Priors  
**Authors:** Valentin Six, Frederik Panse, Mathis Fajeau, Lancelot Da Costa, Mridul Sharma, Alfonso Amayuelas, Tim Z. Xiao, David Hyland, Philipp Hennig, Bernhard Schölkopf  
**Year:** 2026  
**Paper:** https://arxiv.org/abs/2605.13740  
**Code:** https://github.com/atomresearch/pinductor

Pinductor 不只「用 LLM 做 planner」，而是讓 LLM 從少量 observation-action trajectories 提出 candidate POMDP models，再用 belief-based likelihood objective 迭代修正。

其研究問題非常關鍵：

```text
Agent 不知道真正 hidden state
只有：
(o_0,a_0,o_1,a_1,...)
↓
能否反推出一個可用的：
State Space
Transition Model
Observation Model
Reward Structure
```

論文結果指出，在不取得 privileged hidden-state information 的條件下，Pinductor 可達到與部分使用更多資訊的方法相近的 performance/sample efficiency，並優於 tabular baselines。

---

## 新 failure 4：Belief Inertia

**Paper:** Seeing Isn't Believing: Mitigating Belief Inertia via Active Intervention in Embodied Agents  
**Authors:** Hanlin Wang, Chak Tou Leong, Jian Wang, Wenjie Li  
**Year:** 2026  
**Paper:** https://arxiv.org/abs/2604.17252  
**Code:** https://github.com/WangHanLinHenry/EVU

論文提出 **belief inertia**：Agent 即使收到與舊認知衝突的 environment feedback，也可能持續依賴 prior belief。

其 EVU mechanism：

```text
Estimate
↓
預測 action 應造成什麼結果
↓
Verify
↓
比較實際 observation
↓
Update
↓
顯式修改 belief
```

這很重要，因為「把 observation append 到 context」不等於「belief 已更新」。

---

## 新 benchmark 5：ENACT

**Paper:** ENACT: Evaluating Embodied Cognition with World Modeling of Egocentric Interaction  
**Venue:** ICLR 2026  
**Year:** 2026  
**Dataset:** 8,972 QA pairs，來源為 BEHAVIOR simulator 的 long-horizon household activities  
**Paper:** https://proceedings.iclr.cc/paper_files/paper/2026/hash/f841d4e62cf309aec2bfe9a459e852b4-Abstract-Conference.html

ENACT 使用 POMDP framing 測兩種 world modeling：

```text
Forward World Modeling:
actions → future state sequence

Inverse World Modeling:
state changes → action sequence
```

研究顯示：目前 VLM 在 horizon 增長後與人類差距快速擴大，而且 inverse world modeling 通常比 forward world modeling 容易。

這意味着：

```text
能解釋「剛才發生了什麼」
≠
能可靠預測「下一步會發生什麼」
```

而 active perception 的 Value-of-Information 計算，恰恰依賴後者。

---

# 2. 本小時最重要 5 個發現

## 發現 1：文字 Memory 不是 Belief State

### 是什麼

LLM Agent 很常維護：

```text
Memory =
- 00:10 出現紅車
- 00:18 人物走進房間
- 00:25 聽到關門聲
```

這是 accumulated evidence / compressed history。

真正 POMDP belief state 是：

```text
b_t(s) = P(S_t=s | history_t)
```

例如：

```text
P(person_in_room)=0.83
P(person_left_room)=0.12
P(uncertain)=0.05
```

### 底層如何運作

classical belief prediction：

```text
b^-_{t+1}(s')
=
Σ_s T(s'|s,a_t)b_t(s)
```

收到新 observation 後：

```text
b_{t+1}(s')
∝
O(o_{t+1}|s',a_t)b^-_{t+1}(s')
```

normalize：

```text
b_{t+1}(s') = numerator / Σ_{s''} numerator(s'')
```

### 為什麼重要

如果 Hermes 只有 memory，會知道「看過哪些 evidence」，卻不一定知道：

- 哪些 hidden-world hypotheses 還活著；
- 各自概率是多少；
- observation 對哪個 hypothesis 是支持或反證；
- 下一個 observation 最能區分哪兩個 hypotheses。

### 限制

真實 world state 通常不可枚舉，必須使用 particle belief、latent belief、factorized belief 或 textual symbolic approximation。

### 類型

- Standard POMDP：已確認理論
- PBP：論文結果
- Hermes belief object：工程建模建議

---

## 發現 2：Active Perception 需要 Observation Model，不只需要 uncertainty

上一輪的：

```text
uncertainty high
→ maybe zoom
```

仍然少了一層。

真正的問題是：

```text
如果我做 action a = crop(left_top)
我預期可能看到哪些 observation？
```

formalization：

```text
O(o | s,a)
```

例如：

```text
Hypothesis H1: sign says STOP
Hypothesis H2: sign says YIELD

Action A: crop sign

P(read STOP | H1,A)=0.92
P(read STOP | H2,A)=0.06
```

有了 observation model，才可以事前估計：

```text
Expected posterior entropy
Expected information gain
Expected decision-risk reduction
```

因此：

```text
Uncertainty Estimator
≠ Observation Model
```

以及：

```text
知道「我不知道」
≠
知道「去哪裡看最能解決不知道」
```

---

## 發現 3：Expected Information Gain 是 active perception 的底層橋梁

belief entropy：

```text
H(b) = -Σ_s b(s) log b(s)
```

某個 perception action a 的預期 posterior entropy：

```text
E_o[ H(b' | a,o) ]
```

expected information gain：

```text
EIG(a)
=
H(b_t)
-
E_{o~P(o|b_t,a)}[H(b_{t+1})]
```

但 EIG 最大不代表 action 最值得執行。

例如：

```text
Action A：看無關背景
→ 可以知道很多世界細節
→ EIG 高
→ 對目前 decision 無用
```

所以 Hermes 應同時支援：

```text
Information Gain
Decision Value of Information
Task Relevance
Acquisition Cost
Risk
```

最後形成：

```text
PerceptionUtility(a)
=
DecisionRiskReduction(a)
+ λ_info EIG(a)
- Cost(a)
- Risk(a)
```

---

## 發現 4：OmniAgent 是很好的 Agent architecture，但不是完整顯式 belief-space planner

OmniAgent source code 的 `video_prompt.py` 明確要求：

```text
observation
think
confidence
action
```

並要求 observation 成為 media 被移除後的 persistent high-fidelity textual log。

這表示它實際的 state compression 更像：

```text
Transient Multimodal Percept
↓
Textual Observation Memory
↓
Reasoning
↓
Structured Perception Action
```

而不是：

```text
State hypotheses
↓
Probability distribution
↓
Bayesian belief update
↓
belief-space planning
```

因此 Hermes 知識圖譜必須明確加：

```text
POMDP Framing
≠ Explicit POMDP Solver
```

但 OmniAgent 的 runtime 非常值得學：

- action schema 明確；
- `get_frames/get_audio/get_clip/answer` 被環境嚴格驗證；
- rollout loop 維護 independent environment lifecycle；
- asynchronous alive pool 可避免已完成 trajectories 等待 slow trajectories；
- multimodal preprocessing 將 image/video/audio inputs 與 token position / RoPE 一起處理；
- training rollout 記錄 action type、frame count、clip/audio interval 等 step-level statistics。

---

## 發現 5：World Model 至少要拆成「Predictive Model」與「Belief Model」

很多 AI 討論把 world model 當成一個詞，但在 active agent 中至少有兩種不同功能：

### A. Predictive World Model

```text
(s_t, a_t)
↓
Predict
↓
s_{t+1} / observation distribution
```

用於：

- forward simulation
- action planning
- expected observation prediction
- counterfactual rollout

### B. Belief Model

```text
prior belief
+
action
+
new observation
↓
posterior belief
```

用於：

- partial observability
- uncertainty tracking
- hypothesis management
- information-seeking action

它們互相依賴，但不是同一件事。

新增：

```text
World Model
├ Predictive Dynamics Model
├ Observation Model
├ Belief Update Model
└ Reward / Utility Model
```

---

# 3. Architecture Breakdown

Hermes 下一階段建議 architecture：

```text
User Goal
↓
Multimodal Observation
├ Camera / Image
├ Video
├ Audio
├ DOM
├ Sensor
└ Tool Result
↓
Perception Encoder
↓
Observation Likelihood Estimator
↓
Belief State Manager
├ Hypothesis Registry
├ Probability / Weight
├ Evidence Support
├ Contradiction
├ Unknown Variables
└ Belief Provenance
↓
World Model
├ Transition Model T(s'|s,a)
├ Observation Model O(o|s,a)
├ Reward / Cost Model
└ Uncertainty Model
↓
Belief-Space Planner
↓
Candidate Actions
├ physical action
├ tool action
├ MCP action
├ perception action
└ answer / abstain
↓
Expected Outcome Simulator
↓
Expected Observation Simulator
↓
EIG + Decision VoI + Cost + Risk
↓
Action Selection
↓
Environment
↓
New Observation
↓
Belief Update
↓
Replay / Provenance / Certificate
```

---

# 4. Bottom-Level Logic

## 4.1 POMDP tuple

```text
POMDP = (S, A, T, O, Ω, R, γ)
```

其中：

```text
S = hidden states
A = actions
T(s'|s,a) = transition probability
Ω = observations
O(o|s',a) = observation probability
R(s,a) = reward / utility
γ = discount
```

Agent 看不到 `s_t`，只維護：

```text
b_t(s)=P(s_t=s | interaction history)
```

---

## 4.2 Predict step

執行 action 後、 observation 進來前：

```text
b^-_{t+1}(s')
=
Σ_s T(s'|s,a_t)b_t(s)
```

這是「世界自己可能如何變化」。

---

## 4.3 Observation correction

收到 observation：

```text
b_{t+1}(s')
∝
O(o_{t+1}|s',a_t)b^-_{t+1}(s')
```

這是：

```text
prior
× likelihood
→ posterior
```

---

## 4.4 Approximate belief representation

真實 Agent 很難枚舉所有 state，因此 Hermes 應支援多種 representation：

```text
BeliefRepresentation
├ CategoricalBelief
├ ParticleBelief
├ FactorGraphBelief
├ GaussianLatentBelief
├ NeuralLatentBelief
├ SymbolicHypothesisSet
└ TextualBeliefApproximation
```

但要明確標註：

```text
TextualBeliefApproximation
≠ Calibrated Probability Distribution
```

---

## 4.5 Observation model uncertainty

PBP 類方法顯示 perception classifier 本身可能錯。

因此不能：

```text
image classifier output
→ directly treat as ground truth
```

而要保存：

```text
ObservationLikelihoodRecord
├ observation_id
├ latent_state_candidate
├ likelihood
├ perception_model
├ model_version
├ calibration_error
├ OOD_score
└ corruption_uncertainty
```

---

## 4.6 Belief inertia detection

EVU 類機制可以改寫成 Hermes runtime check：

```text
Before action:
ExpectedObservationDistribution
↓
Execute
↓
ActualObservation
↓
Surprise Score
↓
Belief Changed Enough?
├ YES → continue
└ NO  → BELIEF_INERTIA_WARNING
```

可定義：

```text
BeliefUpdateMagnitude
=
D_KL(b_{t+1} || b_t)
```

若 observation surprise 很大，但 belief update magnitude 極低：

```text
High Surprise
+
Low Belief Update
→ potential belief inertia
```

---

# 5. Visual Simulation Idea

# **Belief Space Observatory × Active Perception POMDP Lab**

畫面左側：真實世界（simulation/debug only）

```text
Hidden World
Room A: Person
Room B: Empty
Door: Closed
Phone: Room B
```

Agent 不可直接看 hidden world。

中間顯示 belief：

```text
Where is phone?

Room A  0.42
Room B  0.38
Bag     0.15
Unknown 0.05

Entropy: 1.18
```

右側 candidate observations：

```text
LOOK_ROOM_A
Expected EIG: 0.18
Cost: 1.0
Decision VoI: 0.11

LOOK_ROOM_B
Expected EIG: 0.46
Cost: 1.2
Decision VoI: 0.39

ASK_USER
Expected EIG: 0.62
Cost: 3.0
Privacy/Social cost: 0.8
```

Agent 選：

```text
LOOK_ROOM_B
```

Observation：

```text
camera sees phone-like object
classifier:
P(phone)=0.81
P(remote)=0.14
P(other)=0.05
```

belief update animation：

```text
Prior:
Room B = .38

Likelihood:
P(obs | phone in Room B)=.88

Posterior:
Room B = .79
```

使用者可切換：

```text
Memory View
Belief View
World Model View
Observation Model View
VoI View
```

並開啟 `GROUND TRUTH DEBUG` 比較 belief 與 hidden simulator state。

---

# 6. Code / GitHub

## 6.1 OmniAgent

Repository：

```text
HarryHsing/OmniAgent
```

值得看的核心目錄：

```text
agent_system/
├ environments/
│  ├ env_package/video_env.py
│  └ prompts/video_prompt.py
├ multi_turn_rollout/
│  ├ rollout_loop.py
│  └ utils.py

inference/
demo/
verl/
```

### `video_prompt.py`

重要內容：

```text
Observation–Thought–Action loop
confidence gate
get_frames
get_audio
get_clip
answer
```

並要求：

```text
raw media after turn
→ replaced by text placeholder
→ observation must preserve details
```

因此 `observation` 實際上具有 compressed persistent memory 的角色。

### `video_env.py`

值得看的部分：

- GlobalProcessor
- multimodal message encoding
- image/video/audio processing
- token count
- environment action validation
- ffmpeg-backed media extraction
- reward scoring

### `multi_turn_rollout/rollout_loop.py`

重要 runtime 特徵：

```text
alive_ids dynamic pool
↓
chunk / micro-batch
↓
multimodal generation
↓
environment step
↓
done env eviction
```

這是 Agent Runtime × GPU scheduling 很好的實作案例。

它也紀錄：

```text
action_type
n_frames
clip_start/end/duration
audio_start/end/duration
error_code
```

非常適合 Hermes 未來接 Observation Cost Model。

---

## 6.2 Pinductor

Repository：

```text
atomresearch/pinductor
```

目前可確認的 repository 結構：

```text
main.py
uncertain_worms/
├ environments/
├ planners/
├ policies/
├ structs.py
└ utils.py
particle_filtering/
curtis_baseline/
scripts/
docs/
```

`main.py` 的 episode loop 在 partially observable setting 下明確將 observation 而非 hidden state 傳給 agent：

```text
if fully_obs:
    get_next_action(previous_state)
else:
    get_next_action(previous_obs)
```

程式也包含 belief-vs-real debug logging；如果 agent 有 particle belief，會比較真實 agent position 與 belief particle distribution，包含：

```text
top belief position
real position weight
belief-real distance
field-of-view contradiction
```

這是一個很適合 Hermes 的 debugging pattern：

```text
Belief
vs
Ground Truth (simulation only)
vs
Observation
```

---

# 7. Papers

## Paper A — Native Active Perception as Reasoning for Omni-Modal Understanding

- **Authors:** Zhenghao Xing et al.
- **Institution:** CUHK / SJTU / Alibaba-related author affiliations（以論文版本為準）
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2606.19341
- **Code:** https://github.com/HarryHsing/OmniAgent
- **Architecture:** native omni model + OTA loop + persistent textual observation memory + structured media actions
- **Contribution:** 將 long-video understanding 轉成 on-demand active audio-visual exploration
- **Limitations:** POMDP framing 不代表顯式完整 belief-space model；memory 主要為 textual consolidation
- **改變了什麼:** 將 multimodal understanding 從 watch-all 推向 selective perception as reasoning

## Paper B — Perception-Based Beliefs for POMDPs with Visual Observations

- **Authors:** Miriam Schäfers et al.
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2602.05679
- **Architecture:** image perception model → state distribution → traditional POMDP belief update → solver
- **Contribution:** 將 high-dimensional visual observation 接入 principled belief update
- **Limitations:** 依賴 perception model quality；state abstraction 仍需可建模
- **改變了什麼:** 清楚建立 perception uncertainty 與 belief-space planning 的介面

## Paper C — Learning POMDP World Models from Observations with Language-Model Priors

- **Authors:** Valentin Six et al.
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.13740
- **Code:** https://github.com/atomresearch/pinductor
- **Architecture:** trajectories → LLM prior → candidate POMDP → belief likelihood refinement
- **Contribution:** 使用 LLM prior 降低 hidden-state-free POMDP model induction 的 sample cost
- **Limitations:** 目前 domain/state complexity 仍遠低於真正 open-world multimodal world model
- **改變了什麼:** 將 LLM 的 prior knowledge 轉成 explicit probabilistic world-model induction prior

## Paper D — Seeing Isn't Believing

- **Authors:** Hanlin Wang et al.
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2604.17252
- **Code:** https://github.com/WangHanLinHenry/EVU
- **Architecture:** Estimate → Verify → Update
- **Contribution:** 定義 belief inertia 並顯式介入 belief update
- **Limitations:** textual belief state 並不天然具有 calibrated probabilistic semantics
- **改變了什麼:** 指出 context 中存在 observation 不代表 Agent 已經相信它

## Paper E — ENACT

- **Venue:** ICLR 2026
- **Year:** 2026
- **URL:** https://proceedings.iclr.cc/paper_files/paper/2026/hash/f841d4e62cf309aec2bfe9a459e852b4-Abstract-Conference.html
- **Dataset:** 8,972 QA pairs from BEHAVIOR
- **Architecture/Task:** forward + inverse world modeling under POMDP framing
- **Contribution:** 用 egocentric interaction sequence 評估 VLM embodied world modeling
- **Limitations:** benchmark world modeling 不等於完整 online control policy
- **改變了什麼:** 顯示 current VLM forward dynamics understanding 仍是明顯弱點

---

# 8. Unknown / Open Questions

## 1. 如何把 open-world continuous state 壓成可計算 belief？

```text
Pixels / audio / language
↓
Object-centric state?
Scene graph?
Latent vector?
Particle set?
Text hypotheses?
Hybrid?
```

目前沒有單一答案。

## 2. Observation Model 要怎麼學？

真實世界中：

```text
P(o | s,a)
```

很難直接取得 ground truth。

可能方法：

```text
Simulator
Self-supervised predictive model
Generative world model
LLM/VLM prior
Empirical calibration
Offline trajectory induction
```

## 3. Language-native belief 是否能被校準？

例如：

```text
"I think the person is probably in the room"
```

和：

```text
P(person_in_room)=0.72
```

不是同一種 object。

未來 Hermes 需要區分：

```text
TextualBelief
ProbabilisticBelief
LatentBelief
CalibratedBelief
```

---

# 9. Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Belief State
Belief Distribution
Belief State Manager
Categorical Belief
Particle Belief
Latent Belief
Textual Belief Approximation
Predictive World Model
Transition Model
Observation Model
Observation Likelihood
Observation Likelihood Estimator
Belief Prediction
Bayesian Belief Update
Approximate Belief Update
Belief Provenance
Belief Inertia
Belief Surprise
Belief Update Magnitude
Expected Information Gain
Expected Posterior Entropy
Belief-Space Planner
POMDP Model Induction
Language-Model Prior for World Model
Observation World Model
Forward World Modeling
Inverse World Modeling
Perception-Based Belief
```

## 新增 Edges

```text
Conversation Memory
≠ Belief State

Observation Summary
≠ Observation Model

Confidence Score
≠ Belief Distribution

POMDP Framing
≠ Explicit POMDP Solver

Perception Model
→ Observation Likelihood

Transition Model
→ Belief Prediction

Observation Likelihood
→ Posterior Belief

Belief State
→ Information-Seeking Action

Observation Model
→ Expected Information Gain

Forward World Model
→ Predicts Consequences

Belief Model
→ Updates Uncertain State Estimate

High Observation Surprise
+
Low Belief Update
→ Potential Belief Inertia

Language Model Prior
→ Can Reduce World-Model Induction Sample Cost
```

---

# 10. 建議 Hermes 實作的資料結構

```text
BeliefState
├ belief_id
├ timestamp
├ representation_type
├ hypotheses[]
│  ├ state_ref
│  ├ probability_or_weight
│  ├ support_evidence[]
│  ├ contradicting_evidence[]
│  └ provenance
├ entropy
├ calibration_status
└ source_model_versions[]
```

```text
ObservationModelRecord
├ action_type
├ hidden_state_variable
├ observation_space
├ likelihood_model
├ calibration_profile
├ uncertainty
├ OOD_profile
└ version
```

```text
BeliefUpdateEvent
├ prior_belief_id
├ action_id
├ predicted_observation_distribution
├ actual_observation_id
├ observation_likelihood
├ posterior_belief_id
├ KL_update_magnitude
├ surprise_score
└ belief_inertia_warning
```

```text
PerceptionPlanCandidate
├ action
├ predicted_observations[]
├ expected_posterior_entropy
├ expected_information_gain
├ expected_decision_risk_reduction
├ token_cost
├ latency_cost
├ privacy_cost
├ physical_risk
└ net_utility
```

---

# 11. 下一輪研究

下一輪自然收斂到：

# **Latent World Models × Predictive Observation Simulation × Dream Rollouts × Model-Based Agent Planning**

因為目前已建立：

```text
Observation
↓
Belief
↓
Transition / Observation Model
↓
Belief Update
↓
VoI
```

下一個問題是：

> 如果 Agent 不實際執行 action，能否在內部先「想像」多個未來 observation / state trajectories，再比較哪條路最好？

下一輪優先拆：

```text
World Models / Dreamer
latent dynamics
RSSM
JEPA-style predictive representation
video world models
robot world models
model predictive control
Monte Carlo Tree Search over learned dynamics
LLM simulator vs learned latent simulator
uncertainty accumulation in imagined rollouts
```

並建立：

```text
LatentWorldState
DreamRollout
PredictedObservation
WorldModelUncertainty
ImaginationHorizon
ModelBiasAccumulation
PlanningRolloutGraph
WorldModelCertificate
```

---

# 12. 本輪結束判定

**缺哪一層：**  
`Latent Predictive World Model + Internal Rollout Planning Layer`

**哪個節點最淺：**  
`ObservationModel`、`CalibratedBeliefState`、`BeliefSpacePlanner`、`ExpectedInformationGain`

**哪個概念仍只是名詞：**  
production 級 `OpenWorldBeliefState`。目前 textual memory、particle belief、neural latent belief 都只能解部分問題。

**哪個系統值得讀原始碼：**  
1. `HarryHsing/OmniAgent`：`video_prompt.py → video_env.py → rollout_loop.py`  
2. `atomresearch/pinductor`：`uncertain_worms/policies → planners → particle_filtering → main.py`

**哪篇論文需追引用：**  
優先 `Perception-Based Beliefs for POMDPs with Visual Observations`，因為它直接連接 vision perception uncertainty 與 formal belief update；其次是 Pinductor。

**哪個概念最適合視覺模擬：**  
`Belief Space Observatory × Active Perception POMDP Lab`

**哪個 Agent 架構最值得實作：**

```text
Multimodal Observation
↓
Observation Likelihood Estimator
↓
Belief State Manager
↓
Transition + Observation World Model
↓
Expected Observation Simulator
↓
EIG / VoI / Risk Planner
↓
Perception or Tool Action
↓
Belief Update
↓
Replay + Provenance Certificate
```

---

# 核心結論

> 真正的 Active Perception Agent 不只是「不確定就再看」。它必須維護一個對 hidden world 的 belief，預測 action 之後世界可能如何變化、不同 hidden states 下可能看到什麼 observation，再估算哪次觀察最能改變 decision。收到新 evidence 後，也不能只把文字 append 到 context，而必須真正更新 belief。從這一層開始，Memory、World Model、Observation Model、Belief Update、Planning 才形成完整的 Perception → Reasoning → Action 閉環。
