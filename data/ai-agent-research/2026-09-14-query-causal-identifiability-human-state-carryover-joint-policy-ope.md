# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 00:54（Asia/Taipei）**

**本輪主題：Query Causal Identifiability × Human-State Carryover × Interference × Joint Query/Action Policy OPE × Causal Experimentation Runtime**

---

## 本小時新發現

本輪承接上一輪 `Information Action Dual Effect × Joint Query/Action Policy`，但不再重複「query 可能改變世界」這個概念，而是進一步處理兩個更底層的問題：

1. **怎麼判斷一個 information action 是 measurement 還是 intervention？**
2. **當 query policy 自己改變後續 state / feedback / user behavior 時，歷史資料要如何做 off-policy evaluation？**

本輪核心結論：

```text
P(answer | query=q, history=h)
≠
P(answer | do(query=q), history=h)
```

也就是：看到歷史上某種 query 後使用者怎麼回答，不等於知道「如果現在主動把 query 改成 q」會產生什麼結果。

如果 query 的選擇與 latent user state、uncertainty、risk、prior interaction history 有關，直接把 observational response distribution 當 interventional response model，會同時受到 **confounding、carryover、selection bias 與 interference** 影響。

本輪優先交叉驗證來源：

- CausaLab: A Scalable Environment for Interactive Causal Discovery Toward AI Scientists (2026) — https://arxiv.org/abs/2605.26029
- CausaLab official code — https://github.com/DylanZSZ/CausaLab-Benchmark
- Modeling Distinct Human Interaction in Web Agents (2026) — https://arxiv.org/abs/2602.17588
- Integrated Control and Active Perception in POMDPs (2025) — https://arxiv.org/abs/2504.13288
- Policy Learning with a Natural Language Action Space: A Causal Approach (2025) — https://arxiv.org/abs/2502.17538
- Asking for Information by Evaluating the Communication and Coordination Trade-Off in Multi-Agent POMDPs (2026) — https://doi.org/10.1109/LRA.2026.3703246
- Counterfactual Planning for Generalizable Agents’ Actions (AAAI 2026) — https://doi.org/10.1609/aaai.v40i35.40184

---

# 本小時最重要 5 個發現

## 1. Query Response Model 必須區分 observational conditional 與 interventional response

### 概念

對 Agent 來說，以下兩個問題不同：

```text
OBSERVATIONAL
歷史上，Agent 問 q 時，使用者通常回答什麼？

INTERVENTIONAL
如果 Agent 現在刻意選擇問 q，會造成什麼回答與後續狀態？
```

### 底層如何運作

考慮 latent human state `U_t`：

```text
U_t
├→ Query selection Q_t
├→ Answer Y_t
└→ Future engagement E_{t+1}
```

如果 `Q_t` 是 Agent 根據過去互動與 user state proxy 選出的，則：

```text
P(Y_t | Q_t=q, H_t)
```

可能包含 selection/confounding。

真正 query simulator 想估的是：

```text
P(Y_t | do(Q_t=q), H_t)
```

如果 query 還改變 user state：

```text
U_{t+1} = f(U_t, Q_t, Y_t, burden_t, trust_t, ...)
```

那 query 的 effect 不只在 immediate answer，而在後續多步 trajectory。

### 為什麼重要

Hermes 若把 observational answer model 直接當 VoI simulator：

```text
history
→ estimate P(answer | q)
→ simulate posterior
→ choose q
```

可能會錯估 query value。

### 限制

真實 user latent state 不可完整觀察；通常只能在 explicit assumptions、randomization、instrument、proxy-state model 或 sensitivity analysis 下識別。

### 來源

- causal intervention / counterfactual planning literature
- dynamic treatment / causal policy learning
- interactive causal discovery benchmarks

新增：

```text
QueryCausalContract
├ query_id
├ observational_model_id
├ interventional_model_id
├ treatment_assignment_model
├ confounder_set
├ positivity_status
├ carryover_window
├ interference_scope
├ identification_strategy
└ validity_status
```

核心否定 edge：

```text
Observed Query Response
≠ Causal Query Effect
```

---

## 2. Human State Carryover 讓每一次 ASK 都可能改變下一輪 policy input

2026 的 `Modeling Distinct Human Interaction in Web Agents` 收集 400 條 real-user web navigation trajectories、超過 4,200 個 interleaved human/agent actions，辨識出 hands-off supervision、hands-on oversight、collaboration 與 takeover 等不同 interaction patterns；模型化 human intervention 後，可改善 intervention prediction，並在 live user study 提升 user-rated usefulness。

這件事對 Hermes 更深的意義不是「可以預測人類會不會插手」，而是：

```text
human interaction mode
```

本身就是 state。

例如：

```text
Q1: 你確定要執行嗎？
Q2: 真的確定嗎？
Q3: 還是我再幫你確認一次？
```

這三次 query 可能讓：

```text
Trust ↓
Annoyance ↑
Takeover probability ↑
Future response latency ↑
```

所以 user state dynamics 應寫成：

```text
HUMAN STATE
U_t = {
  intent,
  trust,
  cognitive_load,
  interruption_tolerance,
  urgency,
  interaction_style,
  preference_state
}

Query Q_t
↓
Answer Y_t
↓
U_{t+1} ~ T_h(U' | U_t, Q_t, Y_t, context)
```

而不是把每個 user answer 視為 independent sample。

新增：

```text
HumanStateCarryover
InteractionBurdenState
QueryFatigue
TakeoverHazard
TrustTransition
InterruptionToleranceState
```

重要 edge：

```text
ASK_USER
→ Human State Transition
→ Future Feedback Propensity
→ Future Action Distribution
```

因此：

```text
Single-Step VoI
≠ Long-Horizon Query Value Automatically
```

---

## 3. Interference：一個 query 的效果可能跨 Agent / Tool / User / Session 傳播

### 概念

標準 causal evaluation 常假設一個 unit 的 treatment 不影響另一個 unit（SUTVA/no interference 類假設）。但 Agent runtime 裡這個假設很容易失敗。

例子：

```text
Agent A asks user for clarification
↓
user changes shared project description
↓
Memory updated
↓
Agent B reads new memory
↓
Agent B changes tool action
```

這時 query Q_A 的影響傳到了 Agent B。

另一個例子：

```text
Verifier model sees answer from Planner model
↓
anchoring / shared-context dependence
↓
verification output changes
```

所以 information-action causal effect 不一定是：

```text
Q_t → Y_t
```

而可能是：

```text
Q_t
↓
User state
↓
Shared memory
↓
Other agents
↓
Tool state
↓
Future environment
```

新增：

```text
InformationActionInterferenceGraph
├ direct_descendants
├ human_state_descendants
├ shared_memory_descendants
├ agent_descendants
├ tool_descendants
├ environment_descendants
└ session_descendants
```

### Hermes runtime implication

每一個 information action 應保留：

```text
intervention_scope
expected_carryover_horizon
shared_state_written
recipient_agents
shared_memory_epoch
world_side_effects
```

新增否定 edge：

```text
One Query Event
≠ One Isolated Observation Unit
```

---

## 4. Joint Query/Action Policy OPE 需要估完整 trajectory ratio，而不是只對 world action 做 propensity correction

上一輪已提出：

```text
π_joint(ACT / ASK / VERIFY / SENSE / WAIT | H_t)
```

本輪把 OPE 往下拆。

若 behavior policy 是：

```text
μ(u_t | h_t)
```

而 target joint policy 是：

```text
π(u_t | h_t)
```

其中：

```text
u_t ∈ {
 world actions,
 information actions,
 wait/stop actions
}
```

最基本 trajectory importance ratio 為：

```text
W_T
=
Π_t
π(u_t | h_t)
──────────────
μ(u_t | h_t)
```

但 interactive Agent 多了一個關鍵問題：

```text
query changes future h_t distribution
```

因此只記：

```text
P(world_action | state)
```

不夠。

必須記整個 decision point 的 candidate set 與 behavior propensity：

```text
JointPolicyDecisionRecord
├ history_hash
├ belief_hash
├ human_state_hash
├ candidate_world_actions[]
├ candidate_information_actions[]
├ candidate_wait_actions[]
├ chosen_decision
├ behavior_probability
├ policy_epoch
├ cost_state
├ permission_state
└ intervention_scope
```

### Positivity / support 問題

若舊 policy 從不在某 state 問使用者：

```text
μ(ASK_USER | h)=0
```

而新 policy 想在這裡問：

```text
π(ASK_USER | h)>0
```

則普通 IPS/IS 無法從歷史資料識別這個 counterfactual。

所以 Hermes 應明確輸出：

```text
OPEStatus
├ IDENTIFIABLE_ON_SUPPORT
├ HIGH_VARIANCE
├ PARTIAL_SUPPORT
├ UNSUPPORTED_ACTION
└ INTERFERENCE_UNRESOLVED
```

核心否定：

```text
Logged Acting Propensity
≠ Logged Joint Interactive Propensity
```

以及：

```text
High Offline Estimated Value
≠ Causally Identified Policy Improvement
```

---

## 5. CausaLab 顯示「預測正確」與「機制真的找對」是兩件事，這正是 Hermes 需要的 Causal Query Auditor

### 論文結果

CausaLab 把 LLM agent 放進由隨機 structural causal model 生成的 synthetic lab，讓 Agent 從 observational records 與 interventions 中恢復 causal mechanism，再預測 held-out reactor crystal。

論文的重要結果：

- 純 observation 的 6-node setting 中，GPT-5.2-high task accuracy 可達 92%，但 all-edge F1 只有 0.471。
- mixed observation/intervention setting 中，GPT-5.2-high 的 task accuracy 與 all-edge F1 都約 80%。
- pure intervention 策略仍困難。
- premature stopping 是明顯 failure mode；要求模型檢查 hypothesis 與既有 evidence 的 consistency 可改善。

這證明：

```text
Prediction Correctness
≠ Mechanism Recovery
```

對 Hermes 來說完全可以映射成：

```text
Query Policy works on current examples
≠
Query causal model is correct
```

### GitHub 原始碼深讀

官方 repository：

https://github.com/DylanZSZ/CausaLab-Benchmark

root 中不是只有 dataset，而有：

```text
agents/
causal_graph_configs/
causalab_reeval/
discoveryworld/
examples/
release/
scripts/
```

`agents/recoma/` 進一步包含：

```text
causal_tool.py
react_controller.py
discoveryworld_env_models.py
discoveryworld_promptlm.py
run_recoma.py
configs/
prompts/
```

最值得讀的核心檔案：

```text
agents/recoma/causal_tool.py
agents/recoma/react_controller.py
```

### causal_tool.py 的底層機制

`OnlineInterventionCausalTool` 不是單純 LLM prompt heuristic，而是：

```text
candidate causal graphs
↓
filter observed variable set
↓
receive intervention transition
↓
simulate graph under intervention
↓
compare predicted post-intervention values
↓
remove inconsistent graph
↓
maintain active candidate set
```

它實際保存：

```text
all_candidates
active_candidates
transition_count
last_observed_prop_set
```

`add_transition()` 會：

```text
before observation
+ after observation
+ experiment
↓
_transition_matches_graph()
↓
shrink candidate set
```

這提供 Hermes 很好的 primitive：

```text
CausalHypothesisSet
↓
Information Action
↓
Observed Transition
↓
Hypothesis Elimination
```

### react_controller.py 的 Agent loop

實際 controller 使用：

```text
Action
↔ Observation
```

交替 loop；並維護 history、memory/DSL state、pending experiment 與 optional causal tool。

值得注意的一個工程細節：在 `build_message_thread2()` 中，長 Observation history 為了 context size 被刻意跳過，而主要保留 action history。

這對 Hermes 是一個很好的警告：

```text
Context Compression
→ may remove causal evidence
```

若 agent 要做 causal audit，不能只保留自然語言摘要；應將 causal evidence 與 intervention transition 放到獨立 structured ledger。

---

# Architecture Breakdown

本輪提出 Hermes 的：

# Causal Information-Action Runtime

```text
User / UI / Camera / Voice / Tool / MCP
↓
Observation Ledger
↓
Belief State + Human Interaction State
↓
Candidate Generator
├ World Actions
└ Information Actions
   ├ ASK_USER
   ├ ASK_AGENT
   ├ SECOND_MODEL
   ├ TOOL_RECHECK
   ├ SENSOR_REFRESH
   ├ SEARCH
   └ WAIT
↓
InformationActionClassifier
├ PURE_MEASUREMENT
├ LIKELY_MEASUREMENT
├ MIXED
├ INTERVENTIONAL
└ UNKNOWN
↓
QueryCausalContract
↓
Causal Effect Predictor
├ immediate answer effect
├ human-state effect
├ observation-kernel effect
├ world-state effect
├ shared-memory effect
├ other-agent interference
└ feedback-propensity effect
↓
Counterfactual Query Simulator
↓
Joint Query/Action Policy
↓
JointPolicyDecisionRecord
↓
Permission Gate
↓
Execution
↓
Intervention Descendant Graph
↓
Outcome + Feedback
↓
Joint-Policy OPE / Causal Audit
```

---

# Bottom-Level Logic

## 1. Measurement assumption

最簡化 query model：

```text
U_t fixed
Q_t = q
Y_t ~ P(Y | U_t, q)
```

query 只改 observation mechanism。

## 2. Interventional human-state model

```text
U_{t+1}
~
T_h(U' | U_t, Q_t, interaction_context)

Y_t
~
P(Y | U_{t+1}, Q_t)
```

此時 query 已經改變 latent state。

## 3. Multi-step carryover

```text
Q_t
→ U_{t+1}
→ Y_t
→ Memory_{t+1}
→ Q_{t+1}
→ U_{t+2}
→ A_{t+2}
```

因此 query effect 要有 horizon：

```text
Immediate Causal Effect
Short-Horizon Carryover
Long-Horizon Policy Effect
```

## 4. Joint-policy OPE

在沒有 interference 且有 support 的理想化情況：

```text
W_T
=
∏_t π_joint(U_t | H_t)
    / μ_joint(U_t | H_t)
```

再搭配：

```text
IS / WIS / DR / model-based OPE
```

但 Hermes 在 production 前必須先過：

```text
Support Gate
Confounding Gate
Interference Gate
State Sufficiency Gate
Propensity Integrity Gate
```

任一 gate 失敗，都不能把單一 OPE number 當成 causal policy value。

## 5. Causal hypothesis update

借用 CausaLab pattern：

```text
Hypothesis Set H_t
↓ choose intervention q_t
Environment executes do(q_t)
↓ observe transition
Filter inconsistent hypotheses
↓ H_{t+1}
```

Hermes 可以將此 pattern 用於：

```text
Tool-state hypotheses
Auth-state hypotheses
User-intent hypotheses
Sensor-reliability hypotheses
Memory-conflict hypotheses
```

---

# Visual Simulation Idea

# Query Causal Lab × Human-State Carryover × Joint-Policy OPE

Console 左側顯示 latent/user-state simulator：

```text
User State
Trust                .82
Interruption Tolerance .61
Urgency              .77
Cognitive Load       .42
Preference certainty .55
```

中間顯示兩種 query：

```text
Q1 Neutral
「你比較重視速度還是安全？」

Q2 Leading
「為避免出錯，你應該比較重視安全，對嗎？」
```

切換：

```text
MODEL A: PASSIVE MEASUREMENT
MODEL B: QUERY CHANGES HUMAN STATE
```

結果顯示：

```text
                 Q1       Q2
Info Gain        .31      .39
Immediate VoI    .42      .51
Trust Shift     -.01     -.09
Fatigue Shift    .02      .12
Future Takeover +.01     +.08
Long-Horizon VoI .36      .07
```

第二頁 OPE Simulator：

```text
Historical behavior policy
ASK_USER        8%
TOOL_RECHECK   22%
ACT            70%

Target policy
ASK_USER       35%
TOOL_RECHECK   15%
ACT            50%
```

顯示：

```text
ASK_USER support at high-risk state = 0.00

Naive OPE value:        7.4
Support-aware status:   UNSUPPORTED
Causal estimate:        NOT IDENTIFIED
Recommended action:     RANDOMIZED PILOT / SIMULATION
```

第三頁 Causal Hypothesis Viewer：

```text
H1: Query only reveals preference
H2: Query changes trust
H3: Query changes preference framing
H4: Query changes future feedback propensity
```

每次 intervention 後，像 CausaLab 一樣顯示 candidate mechanism set shrinking。

---

# Code / GitHub

## DylanZSZ/CausaLab-Benchmark

https://github.com/DylanZSZ/CausaLab-Benchmark

值得深入：

```text
agents/recoma/causal_tool.py
agents/recoma/react_controller.py
agents/recoma/discoveryworld_env_models.py
agents/recoma/discoveryworld_promptlm.py
agents/recoma/run_recoma.py
causal_graph_configs/
causalab_reeval/
discoveryworld/
release/causalab_dataset/
```

### causal_tool.py 值得借用

- explicit candidate causal hypothesis set
- deterministic consistency filtering
- intervention transition replay
- model-vs-observation matching
- candidate set summary

### react_controller.py 值得借用

- explicit `Action` / `Observation` runtime object
- controller-managed history
- pending experiment state
- causal tool optional integration
- DSL / memory modes

### Hermes 不應照搬的地方

CausaLab 是 synthetic SCM benchmark，具 deterministic graph simulation 與明確 intervention semantics；human-agent query causal effect 沒有這麼乾淨。

因此：

```text
Synthetic Intervention Identifiability
≠ Human Interaction Identifiability
```

---

# Papers

## 1. CausaLab: A Scalable Environment for Interactive Causal Discovery Toward AI Scientists

- Authors: Junlin Yang, Dylan Zhang, Xiangchen Song, Qirun Dai, Xiao Liu, Yuen Chen, Aniket Vashishtha, Jing Shi, Chenhao Tan, Hao Peng
- Institutions: UIUC / Tsinghua / CMU / University of Chicago / Adobe 等作者團隊
- Year: 2026
- URL: https://arxiv.org/abs/2605.26029
- Code: https://github.com/DylanZSZ/CausaLab-Benchmark
- Dataset: 950 synthetic causal graph configs, 19 JSONL suites (官方 repo release)
- Architecture: hidden SCM + observational/interventional experiment loop + causal DSL + mechanism evaluation
- Contribution: 將 Agent causal reasoning 從最終答對提升到 mechanism recovery
- Limitation: synthetic environment；介入語義可控，與真實 human-agent causal query 不等價
- 改變了什麼：證明「預測答案準」不足以表示 agent 找到 causal mechanism

## 2. Modeling Distinct Human Interaction in Web Agents

- Authors: Faria Huq, Zora Zhiruo Wang, Zhanqiu Guo, Venu Arvind Arangarajan, Tianyue Ou, Frank Xu, Shuyan Zhou, Graham Neubig, Jeffrey P. Bigham
- Year: 2026
- URL: https://arxiv.org/abs/2602.17588
- Dataset: CowCorpus, 400 real-user web trajectories, 4,200+ interleaved actions
- Architecture: web agent + human intervention-style modeling
- Contribution: 明確建模何時與如何需要人介入
- Limitation: intervention prediction 不等於 query causal effect identification
- 改變了什麼：human interaction style 應進 Agent state，不應只當 external annotation

## 3. Integrated Control and Active Perception in POMDPs for Temporal Logic Tasks and Information Acquisition

- Authors: Chongyang Shi, Michael R. Dorothy, Jie Fu
- Year: 2025
- URL: https://arxiv.org/abs/2504.13288
- Architecture: POMDP with actions affecting both transition and emission/perception
- Contribution: joint control + active information acquisition
- Limitation: formal stochastic environment，human interaction effect 不在主模型內
- 改變了什麼：資訊動作正式進 transition + observation kernel

## 4. Policy Learning with a Natural Language Action Space: A Causal Approach

- Authors: Bohan Zhang, Yixin Wang, Paramveer S. Dhillon
- Year: 2025
- URL: https://arxiv.org/abs/2502.17538
- Architecture: causal multi-stage decision making / dynamic treatment style policy learning over natural-language action embeddings
- Contribution: 將 causal sequential policy learning延伸到 language action space
- Limitation: 與 full interactive LLM Agent runtime / tool / human feedback loop仍有差距
- 改變了什麼：自然語言 query/action 可以是 treatment，不只 token output

## 5. Counterfactual Planning for Generalizable Agents’ Actions

- Authors: Jiarun Fu, Lizhong Ding, Qiuning Wei, Yuhan Guo, Yurong Cheng, Junyu Zhang
- Institution: Beijing Institute of Technology
- Year: 2026, AAAI
- URL: https://doi.org/10.1609/aaai.v40i35.40184
- Architecture: SCM-based agent planning + State Causality Evaluator + What-If-Not reward
- Contribution: 用 counterfactual intervention改善 stochastic environment 中的 generalization/adaptation
- Limitation: 對 human query-induced preference/trust shift 並非直接建模
- 改變了什麼：counterfactual analysis可以進 agent planner，而不是只用於 post-hoc explanation

---

# 已確認事實 / 推論層級

## 已確認事實

- CausaLab code 中存在 candidate graph filtering、intervention transition simulation、ReAct action-observation controller。
- CausaLab paper 將 prediction accuracy 與 causal mechanism recovery 分開評估。
- CowCorpus 含 real-user web agent human interaction trajectories。
- active-perception POMDP 可以讓 action 同時影響 transition 與 emission。

## 論文結果

- CausaLab 6-node observational setting 中有高 prediction accuracy 與明顯較低 graph recovery F1 的 gap。
- Modeling Distinct Human Interaction 論文報告 intervention prediction 與 user-rated usefulness 改善。

## 工程推論

- Hermes 若要做 query policy OPE，應記錄 joint propensity，而非只有 world-action propensity。
- Human interaction style / trust / burden 應進 state representation。

## 尚未驗證假說

- production LLM Agent 是否能穩定估計 `P(answer | do(query))`。
- human trust / preference carryover 是否能用低維 latent state可靠表示。
- 在 multi-agent shared-memory runtime 中能否實際識別 information-action interference graph。

---

# Unknown / Open Questions 1–3

## 1. Query Intervention Identification

什麼條件下可以從 observational interaction log 可靠估計：

```text
P(answer | do(query=q), history)
```

而不用真實 randomization？

可能需要：

```text
backdoor adjustment
frontdoor / instrument
natural experiment
sequential ignorability
proxy causal inference
sensitivity bounds
```

但 production Agent 的 assumptions 必須被明確記錄。

## 2. Human-State Sufficient Representation

如何判斷：

```text
intent + trust + burden + urgency + interaction style
```

真的足以阻斷 query assignment 與 future outcome 的 confounding？

這重新連回前幾輪的：

```text
State Sufficiency
Belief State
State Aliasing
```

## 3. Joint Interactive OPE under Interference

當 query 會更新 shared memory、影響其他 agents、改變 human response policy 時：

```text
trajectory IS / DR
```

是否仍能直接使用？

可能必須升級到：

```text
cluster/interference-aware estimand
causal graph factorization
multi-agent occupancy ratio
or simulation-based partial identification
```

---

# 下一輪研究

下一輪應正式轉向：

# Causal Query Identification × Sequential Ignorability × Positivity × Sensitivity Analysis × Interactive-Agent OPE

研究鏈：

```text
Historical Interaction Log
↓
Query Assignment Mechanism
↓
Confounder / State Sufficiency Audit
↓
Sequential Ignorability Testable Proxies
↓
Positivity / Overlap Audit
↓
Interference Audit
↓
Identification Strategy
├ Randomized Query
├ Backdoor Adjustment
├ Doubly Robust OPE
├ Instrument / Natural Experiment
├ Sensitivity Bounds
└ NOT IDENTIFIED
↓
Joint Query/Action Policy Evaluation
↓
Permission To Deploy New Interaction Policy
```

下一輪應優先追：

- dynamic treatment regimes
- longitudinal causal inference
- marginal structural models
- sequential doubly robust estimation
- proximal causal inference under hidden confounding
- interference-aware OPE
- contextual bandit / RL policy evaluation with active querying

---

# Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Query Causal Effect
Observational Query Response
Interventional Query Response
Query Assignment Mechanism
QueryCausalContract
Human State Carryover
Human Interaction State
Interaction Burden State
Trust Transition
Query Fatigue
Takeover Hazard
Information Action Interference
InformationActionInterferenceGraph
Shared-Memory Interference
Cross-Agent Query Effect
Joint Interactive Policy
JointPolicyDecisionRecord
Joint Interactive Propensity
Joint Query/Action OPE
Interactive Positivity
Interactive Support
Interactive OPE Status
Causal Query Auditor
Causal Hypothesis Set
Intervention Transition Constraint
Mechanism Recovery Score
Query Identification Strategy
```

## 新 Edges

```text
Observed Query Response
≠ Causal Query Effect

P(Y | Q=q,H)
≠ P(Y | do(Q=q),H)

Single-Step VoI
≠ Long-Horizon Query Value

ASK_USER
→ Human State Transition

Human State Transition
→ Future Feedback Propensity

Information Action
→ Shared Memory
→ Other Agent Behavior

One Query Event
≠ One Isolated Observation Unit

Logged Acting Propensity
≠ Logged Joint Interactive Propensity

High Offline Estimated Value
≠ Causally Identified Policy Improvement

Prediction Correctness
≠ Mechanism Recovery

Synthetic Intervention Identifiability
≠ Human Interaction Identifiability

Context Compression
→ Can Remove Causal Evidence
```

---

# 本輪結束判定

**缺哪一層：**

`Query Assignment / Causal Identification Layer`。

**哪個節點最淺：**

- `QueryCausalContract`
- `HumanStateCarryover`
- `InformationActionInterferenceGraph`
- `JointInteractiveOPE`
- `InteractivePositivity`

**哪個概念仍只是名詞：**

production 級 `CausalQueryAuditor`；目前已有理論組件，但尚未有適用於一般 LLM Agent + human + tools + multi-agent runtime 的通用實作與 validity theorem。

**哪個系統最值得讀原始碼：**

`DylanZSZ/CausaLab-Benchmark`，優先：

```text
agents/recoma/causal_tool.py
agents/recoma/react_controller.py
```

**哪篇論文需追引用：**

`CausaLab`，因為它開始把 Agent 的「互動實驗能力」與「mechanism recovery」分開評估，這正好是 Hermes 下一階段 causal simulator 的基礎。

**哪個概念最適合視覺模擬：**

`Query Causal Lab × Human-State Carryover × Joint-Policy OPE`。

**哪個 Agent 架構最值得實作：**

```text
Belief + Human State
↓
World / Information Action Generator
↓
InformationActionClassifier
↓
QueryCausalContract
↓
Counterfactual Query Simulator
↓
Joint Query/Action Policy
↓
Joint Propensity Logger
↓
Intervention Descendant Graph
↓
Causal OPE / Sensitivity Auditor
↓
Permission Gate
```

---

# 對「AI 到底怎麼運作」新增的一層

目前 Hermes 的整體還原鏈可以再加一段：

```text
User says something
↓
UI
↓
Agent Runtime
↓
Context / Memory
↓
Belief + Human Interaction State
↓
Reasoning / Planning
↓
Does the Agent need more information?
↓
Candidate Information Actions
↓
Query Causal Effect Prediction
↓
ASK / VERIFY / SENSE / WAIT
↓
Human / World may change because it was asked or sensed
↓
New Observation
↓
Belief + Human State Update
↓
Tool / MCP / Model / GPU
↓
Action
↓
Delayed Outcome / Feedback
↓
Causal Policy Evaluation
```

核心答案變成：

> **成熟 AI Agent 不只是「根據世界做推論」，它也會主動選擇要向世界提出哪些問題；而問題本身就是一種 intervention。只要 ASK、VERIFY、SENSE、WAIT 會改變人的狀態、共享記憶、其他 Agent 或未來 observation distribution，就不能再把它們當成免費、被動、獨立的資訊讀取。真正可驗證的 Agent 必須知道：這份資訊是觀察到的，還是因為自己做了某個 intervention 才產生的。**
