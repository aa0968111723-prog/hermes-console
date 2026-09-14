# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 13:52（Asia/Taipei）**  
**本輪主題：Macro-Actions / Options × Semi-Markov Agent OPE × Trajectory Segmentation × Hierarchical Credit Assignment**

---

## 0. 與歷史研究比較：本輪避免重複的邊界

前一輪已建立 `Structured Action Ledger → Propensity Provenance → Action Abstraction Graph → HierarchicalAgentPropensity → OPE Router`，重點是回答：「一個 LLM tool call / JSON arguments / token sequence，到底在哪個 semantic abstraction level 才適合做 counterfactual evaluation？」

本輪不再重做 single-action abstraction，而是進入下一層 temporal abstraction：

```text
atomic action
≠
turn
≠
macro-action / option
≠
full trajectory
```

真實 Agent 常出現：

```text
Search
→ Open
→ Read
→ Compare
→ Verify
→ Summarize
```

這六個 atomic actions 對人類而言很可能是「蒐集並驗證資料」的一個 macro-action，但對 runtime / OPE 而言，只有在它具備可稽核的 initiation、internal policy、termination、duration 與 outcome contract 時，才應被視為一個 option。

因此本輪核心問題是：

> 如何把長 Agent trajectory 分割成具有語義與因果意義的 option，並在 duration 不固定、internal policy 不同、termination policy 會改變的 Semi-Markov setting 下進行 OPE、credit assignment 與安全驗證？

---

# 一、本小時新發現

## 新論文 / 新架構

### 1. HiMAC: Hierarchical Macro-Micro Learning for Long-Horizon LLM Agents
- Authors: Hongbo Jin, Rongpeng Zhu, Jiayu Ding, Wenhao Zhang, Ge Li
- Institution: Peking University
- Year: 2026
- URL: https://arxiv.org/abs/2603.00977
- Benchmarks: ALFWorld, WebShop, Sokoban
- Architecture: Macro blueprint policy + Micro goal-conditioned execution policy
- Contribution: 將 long-horizon LLM agent 從 flat autoregressive control 拆成 macro blueprint 與 micro execution；使用 `<sub_done>` 作為 subgoal termination signal，並透過 hierarchical relative advantage 做 level-specific credit assignment。
- Limitation: macro boundary 很大程度由 blueprint/subgoal protocol 定義；尚不能視為一般 production agent trajectory segmentation theorem。

### 2. ArCHer: Training Language Model Agents via Hierarchical Multi-Turn RL
- Authors: Yifei Zhou, Andrea Zanette, Jiayi Pan, Sergey Levine, Aviral Kumar
- Year: 2024
- URL: https://arxiv.org/abs/2402.19446
- Code: https://github.com/YifeiZhou02/ArCHer
- Environments: Twenty Questions, Detective Game, Guess My City, WebShop
- Architecture: 高層 off-policy critic / value learning跨 utterance 聚合 delayed reward；低層 LM actor 對 utterance/token policy 做 policy-gradient optimization。
- Contribution: 將 multi-turn language interaction明確分成高層 turn-level value與低層 token-generation policy。
- Limitation: 其 hierarchy 主要依 conversation turn / utterance 切分，並非自動發現任意 tool trajectory 的 macro boundaries。

### 3. Using Options and Covariance Testing for Long Horizon Off-Policy Policy Evaluation
- Authors: Zhaohan Daniel Guo, Philip S. Thomas, Emma Brunskill
- Year: 2017
- URL: https://arxiv.org/abs/1703.03453
- Architecture: option-level policies + importance sampling + covariance-based dropping of unnecessary weights
- Contribution: 顯示在 long-horizon OPE 中，使用 temporally extended actions/options 可以降低傳統 trajectory-wise importance sampling 隨 horizon 惡化的問題；進一步提出 Incremental Importance Sampling。
- Limitation: classical options setting 與現代 LLM agent 的 open-ended text/tool/browser actions仍有巨大表示差距。

### 4. Agent-Centric Actor-Critic for Asynchronous Multi-Agent Reinforcement Learning
- Authors: Whiyoung Jung et al.
- Venue: ICML 2025
- URL: https://proceedings.mlr.press/v267/jung25a.html
- Architecture: macro-actions + asynchronous agent histories + agent-centric encoders + centralized critic + modified GAE
- Contribution: macro-action duration不同時，不能用簡單 time padding 假裝 agents 同步；應以各 agent 自己的 event/trajectory clock處理。
- Limitation: multi-agent RL setting，不直接解 LLM tool-use option discovery。

### 5. Demystifying the Paradox of Importance Sampling with an Estimated History-Dependent Behavior Policy in OPE
- Authors: Hongyi Zhou, Josiah P. Hanna, Jin Zhu, Ying Yang, Chengchun Shi
- Venue: ICML 2025
- URL: https://proceedings.mlr.press/v267/zhou25f.html
- Contribution: history-dependent behavior policy estimation可能降低 asymptotic variance，但增加 finite-sample bias；condition on 更長 history時 variance可下降。
- 本輪意義: Agent option propensity未必只依當下 state；macro-action 啟動機率可能依賴完整 task/history/context，因此「Markov propensity logging」不能想當然。

---

# 二、本小時最重要 5 個發現

## 發現 1：Macro-action 不是「幾個 tool calls 黏在一起」

### 概念
一個 production-grade option 至少應表示：

```text
Option o = (
  initiation set I_o,
  internal policy π_o,
  termination rule β_o,
  duration τ_o,
  outcome / reward contract
)
```

對 LLM Agent 可對應：

```text
I_o
= 何時允許開始「研究某主題」

π_o
= Search → Open → Read → Compare → Verify 的內部策略

β_o
= 找到足夠交叉驗證來源 / budget exhausted / evidence threshold reached

τ_o
= 5 tool steps、17 sec、3 webpages……
```

### 底層如何運作
普通 MDP transition：

```text
(s_t, a_t)
→
r_t, s_{t+1}
```

Option/SMDP transition則更接近：

```text
(s_t, o_t)
→
(R_t:t+τ-1, τ, s_{t+τ})
```

其中 option 持續 `τ` 個 primitive steps。若 discount factor為 `γ`，option return為：

```text
R_o
=
Σ_{k=0}^{τ-1} γ^k r_{t+k}
```

而 next-option value需要乘：

```text
γ^τ V(s_{t+τ})
```

而不是固定 `γ V(s_{t+1})`。

### 為什麼重要
如果 Hermes 把「搜尋 1 分鐘」與「搜尋 8 分鐘」都當一個普通一步 action，會直接丟掉 duration、resource usage、intermediate risk與termination behavior。

### 限制
option 定義如果只是語義 clustering，而沒有 transition/reward/termination sufficiency，OPE 仍可能 biased。

### 結論

```text
Semantic Action Cluster
≠
Valid Temporal Option
```

---

## 發現 2：Option-level OPE 可以降低 horizon explosion，但只有在 hierarchy 本身有效時

### 傳統 trajectory IS
對 primitive actions：

```text
W
=
∏_{t=0}^{T-1}
π_e(a_t|h_t)
────────────
π_b(a_t|h_t)
```

長 horizon 下即使每一項 ratio只有小誤差，乘積仍容易：

```text
→ 0
或
→ extremely large
```

### Option-level
若 primitive trajectory可合法映射成 `K << T` 個 options：

```text
W_option
=
∏_{j=0}^{K-1}
Π_e(o_j|H_j)
────────────
Π_b(o_j|H_j)
```

這把 multiplicative horizon 從 `T` 降到 `K`。

2017 Guo/Thomas/Brunskill 已證明 temporally extended actions在 long-horizon IS OPE 中可顯著改善資料需求，並進一步利用 covariance testing 決定哪些 IS weights實際可省略。

### 但關鍵限制
若兩個 macro-actions表面名稱相同，但 internal policy不同：

```text
ResearchOption_v1
= Google → source A → summarize

ResearchOption_v2
= Scholar → source B/C → cross-check
```

那麼只記：

```text
option_name = RESEARCH
```

可能隱藏重要 policy change。

因此 Hermes 必須保存：

```text
OptionPolicyFingerprint
├ option_type
├ internal_policy_version
├ model/router versions
├ tool set
├ schema versions
├ termination rule
├ budget
└ risk policy
```

### 新 edge

```text
Shorter OPE Horizon
≠
Lower Bias Automatically
```

---

## 發現 3：Option boundary 本身就是一個需要版本化與驗證的模型

LLM trajectory：

```text
Search A
Open A
Read A
Search B
Open B
Read B
Compare
Write note
```

可以切成：

### Segmentation A
```text
[Search/Open/Read A]
[Search/Open/Read B]
[Compare/Write]
```

或：

### Segmentation B
```text
[Search/Open/Read A/Search/Open/Read B/Compare]
[Write]
```

不同 segmentation 會直接改變：

```text
option count
option propensity
option duration
reward attribution
support / overlap
credit assignment
```

因此不能把 trajectory segmentation 當 preprocessing detail。

新增：

```text
TrajectorySegmentationContract
├ segmentation_model_id
├ boundary_rule
├ boundary_features
├ semantic_goal
├ initiation_state
├ termination_signal
├ minimum_duration
├ maximum_duration
├ confidence
├ alternative_boundaries[]
└ downstream_validity_scope
```

HiMAC 提供一個很乾淨的 engineering example：micro-policy產生 `<sub_done>`，作為 subgoal termination signal。這相當於 explicit learned termination token。但 production agent通常沒有這麼乾淨的 boundary signal，因此需要從：

```text
planner subgoal change
+ tool-family change
+ context reset
+ evidence threshold
+ explicit done token
+ state-change detector
+ reward event
```

共同推斷 boundary。

### 新 edge

```text
Trajectory Segmentation
→ Changes Statistical Unit of Action
```

---

## 發現 4：Credit assignment 必須分「option selection」與「option execution」

HiMAC / ArCHer 都從不同角度指出 long-horizon Agent 的核心問題不是只有 reward sparse，而是：

```text
Planner 選錯 subgoal？
還是 Executor 執行錯？
```

若成功率下降，不能只把 terminal reward平均灑給所有 tokens。

Hermes 應拆：

```text
Macro Credit
=
這個 option / subgoal 值不值得選？

Micro Credit
=
已經選定 option 後，內部 actions 執行得好不好？
```

ArCHer 原始碼直接反映這種層次：`ArcherAgent` 使用 LM 生成 action/utterance，`get_log_prob()` 將整個生成 action 的 token log-prob加總；`ArcherTrainer` 的 critic同時學 Q/V，actor則使用 `Q−V` advantage更新 LM。高層 reward/value learning與低層 LM generation因此有明確介面。

對 tool agent 更適合的資料結構：

```text
OptionCreditRecord
├ option_id
├ macro_advantage
├ execution_advantage
├ terminal_contribution
├ duration_adjustment
├ resource_cost
├ safety_cost
├ internal_step_credit[]
└ uncertainty
```

### 重要區分

```text
Bad Outcome
≠
Bad Macro Choice Automatically
```

有可能 macro plan正確，但 tool timeout。

同樣：

```text
Successful Internal Execution
≠
Good Macro Choice
```

例如 Agent 完美地執行了一個根本不需要的 20-step research option。

---

## 發現 5：Asynchronous / variable-duration agents 必須用 event time，而不是假同步 timestep

Option duration本身是 decision variable。

在 single agent：

```text
option A duration = 2
option B duration = 11
```

在 multi-agent：

```text
Research Agent option = 30 sec
Coding Agent option   = 8 sec
Verifier option       = 13 sec
```

如果 runtime將它們硬 padding成：

```text
t = 1,2,3,...
```

會製造沒有真實 causal meaning 的同步關係。

ICML 2025 ACAC 就是針對 macro-action asynchronous MARL指出 padding會造成 misaligned experiences與 spurious correlations，轉而使用 agent-centric history encoders與 modified GAE。

Hermes 應新增：

```text
EventTimeLedger
├ wall_clock_start
├ wall_clock_end
├ logical_clock
├ parent_option
├ concurrent_options[]
├ causally_available_events[]
└ observation_cutoff
```

### 新 edge

```text
Same Logged Timestep
≠
Same Causal Time
```

---

# 三、Architecture Breakdown

## Hermes Temporal Abstraction Runtime

```text
User Goal
↓
Planner
↓
Primitive Agent Events
├ reasoning event
├ tool call
├ browser action
├ MCP call
├ memory read/write
├ multimodal observation
└ human interaction
↓
EventTimeLedger
↓
Trajectory Segmenter
├ explicit planner subgoal
├ semantic goal shift
├ tool-family shift
├ state-change detector
├ <done>/<sub_done>
├ reward event
└ evidence threshold
↓
Option Candidate
↓
Option Validity Auditor
├ initiation consistency
├ internal-policy coherence
├ termination consistency
├ reward/transition sufficiency
├ duration distribution
├ semantic stability
└ counterfactual relevance
↓
OptionRegistry
↓
Hierarchical Policy Ledger
├ Π_macro(option | history)
└ π_micro(action | option, local history)
↓
Semi-Markov Transition Builder
├ start state
├ option
├ duration τ
├ discounted intra-option reward
├ terminal state
└ termination cause
↓
Hierarchical OPE Router
├ primitive trajectory IS
├ option-level IS
├ intra-option correction
├ history-dependent propensity
├ marginalized occupancy methods
└ BLOCK / PARTIAL-ID
↓
Hierarchical Credit Assignment
├ macro credit
├ micro execution credit
├ duration credit
├ resource credit
└ safety credit
↓
Policy-Safe Deployment Gate
```

---

# 四、Bottom-Level Logic

## 4.1 Semi-Markov Bellman target

普通 MDP：

```text
Q(s,a)
=
E[r + γV(s')]
```

Option / SMDP：

```text
Q(s,o)
=
E[
  Σ_{k=0}^{τ-1} γ^k r_{t+k}
  + γ^τ V(s_{t+τ})
]
```

底層差異不是名稱，而是：

```text
τ is random
```

因此 duration distribution也是 option model的一部分。

---

## 4.2 Hierarchical propensity factorization

對第 `j` 個 option：

```text
P(primitive segment | history)
=
Π(o_j | H_j)
×
P(a_{t:t+τ-1}, τ | o_j, H_j)
```

更細：

```text
=
Π(o_j | H_j)
×
∏ internal action probabilities
×
termination probability
```

因此只記 macro probability仍不夠。

新增：

```text
OptionPropensityRecord
├ macro_selection_prob
├ internal_action_logprob
├ termination_logprob
├ duration_prob
├ behavior_policy_version
├ history_hash
└ identifiability_status
```

---

## 4.3 Option-level importance ratio

理想 option identity完全對齊時：

```text
ρ_j
=
Π_e(o_j|H_j)
────────────
Π_b(o_j|H_j)
```

但 target與behavior若使用不同 internal policies，需要：

```text
ρ_j_total
=
ρ_macro
×
ρ_internal
×
ρ_termination
```

如果 `ρ_internal` 不可識別，就不能因為 option label一樣而假設 ratio=1。

新增 edge：

```text
Same Option Label
≠
Same Option Policy
```

---

## 4.4 History dependence

2025 Zhou et al. 顯示即使 true behavior policy Markovian，estimated history-dependent behavior policy仍可能降低 asymptotic variance，但會增加 finite-sample bias。

對 Agent runtime 這意味著：

```text
Π_b(option | current screen only)
```

不一定是最合適 propensity model。

真實 selection 可能依賴：

```text
user goal
previous failures
memory state
remaining budget
previous tool outputs
planner thoughts/state
security state
```

因此：

```text
Option propensity
= P(o_j | H_j)
```

其中 `H_j` 需要明確的 history contract。

---

# 五、Visual Simulation Idea

# **Agent Trajectory → Option Segmentation → Semi-Markov OPE Lab**

主畫面先顯示原始 trace：

```text
00 User asks research
01 Search(query A)
02 Open(source A)
03 Read(source A)
04 Search(query B)
05 Open(source B)
06 Read(source B)
07 Compare(A,B)
08 Save memory
09 Draft answer
10 Verify citation
11 Final answer
```

使用者可拖動 boundary：

```text
[01–03] Gather A
[04–06] Gather B
[07–10] Synthesize+Verify
[11] Respond
```

或：

```text
[01–10] Research
[11] Respond
```

Console 即時計算：

```text
Option count             4 → 2
Mean duration            2.5 → 5.0
Macro overlap            .78 → .94
Internal overlap         .63 → .41
ESS                      188 → 91
Estimated variance       ↓
Estimated abstraction bias ↑
Termination mismatch     LOW → HIGH
```

再提供 `SMDP CLOCK`：

```text
ResearchOption
start 13:00:00
end   13:00:37
τ=8 events

VerifierOption
start 13:00:22
end   13:00:41
```

畫面顯示兩個 option overlap，提醒：

```text
CONCURRENT OPTIONS
≠ sequential MDP steps
```

Credit panel：

```text
Task failed

Macro planner credit     +0.31
Research execution       +0.72
Verification execution   -0.83
Duration cost            -0.21
Tool timeout cost        -0.40
```

核心教學訊息：

```text
ONE TRAJECTORY
CAN HAVE MULTIPLE VALID TEMPORAL ABSTRACTIONS

BUT ONLY SOME ABSTRACTIONS
ARE VALID FOR A GIVEN COUNTERFACTUAL CLAIM
```

---

# 六、Code / GitHub

## 深入原始碼：YifeiZhou02/ArCHer

Repository top-level：

```text
archer/
├ algorithms/
├ data/
├ environment/
├ models/
├ prompts/
└ utils.py

scripts/
dataset/
```

值得讀的核心：

```text
archer/algorithms/offpolicy_train_loop.py
archer/algorithms/archer/trainer.py
archer/models/archer_agent.py
archer/models/critic.py
archer/data/
archer/environment/
```

### `archer/models/archer_agent.py`
實際執行：

```text
observation
↓
tokenizer
↓
LM.generate()
↓
action / utterance
```

而 `get_log_prob()`：

```text
observation tokens + action tokens
↓
LM logits
↓
selected token probabilities
↓
Σ token log probabilities
↓
utterance/action log-prob
```

因此它示範了一個很實用的跨層接口：

```text
Token Policy
↓ aggregate
Turn / Utterance Action Probability
```

### `archer/algorithms/archer/trainer.py`
critic 部分維護：

```text
Q1,Q2,V1,V2
+ target critic
```

Bellman-style target：

```text
target_v
=
reward + (1-done) γ target_v(next)
```

actor 部分則：

```text
π action
↓
Q,V
↓
advantage = min(Q1,Q2)-min(V1,V2)
↓
log-prob × advantage
↓
LM update
```

### 對 Hermes 的限制
ArCHer 現有 code仍接近 fixed-step RL target，沒有 production Agent 所需的：

```text
random option duration τ
γ^τ
explicit option termination propensity
concurrent macro-actions
option-version migration
```

因此它最適合作為 hierarchical credit interface參考，而不是完整 SMDP Agent Runtime。

---

# 七、Papers

## Paper A — HiMAC
**Title:** HiMAC: Hierarchical Macro-Micro Learning for Long-Horizon LLM Agents  
**Authors:** Hongbo Jin, Rongpeng Zhu, Jiayu Ding, Wenhao Zhang, Ge Li  
**Institution:** Peking University  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2603.00977  
**Code:** 本輪未確認正式官方 code release  
**Dataset/Benchmark:** ALFWorld, WebShop, Sokoban  
**Architecture:** macro blueprint policy → micro goal-conditioned executor；`<sub_done>` termination；alternating macro exploration / micro adaptation  
**Contribution:** 將 long horizon agent exploration與credit assignment拆成明確 bi-level structure。  
**Limitations:** hierarchy主要由 blueprint protocol定義；尚未解一般 trajectory option discovery / OPE。

## Paper B — ArCHer
**Title:** ArCHer: Training Language Model Agents via Hierarchical Multi-Turn RL  
**Authors:** Yifei Zhou, Andrea Zanette, Jiayi Pan, Sergey Levine, Aviral Kumar  
**Year:** 2024  
**URL:** https://arxiv.org/abs/2402.19446  
**Code:** https://github.com/YifeiZhou02/ArCHer  
**Architecture:** high-level off-policy critic/value across turns + low-level token/utterance policy optimization  
**Contribution:** delayed multi-turn reward可透過 hierarchy回傳至 LM policy。  
**Limitations:** turn boundary不是通用 option boundary；runtime未完整建模 random duration SMDP。

## Paper C — Using Options and Covariance Testing for Long Horizon OPE
**Authors:** Zhaohan Daniel Guo, Philip S. Thomas, Emma Brunskill  
**Year:** 2017  
**URL:** https://arxiv.org/abs/1703.03453  
**Architecture:** option-based policy + IS + covariance testing / incremental IS  
**Contribution:** temporal abstraction不只改善 planning，也可直接降低 long-horizon OPE variance / sample complexity burden。  
**Limitations:** assumptions與 action representation仍較 classical RL。

## Paper D — ACAC
**Title:** Agent-Centric Actor-Critic for Asynchronous Multi-Agent Reinforcement Learning  
**Authors:** Whiyoung Jung et al.  
**Year:** 2025  
**URL:** https://proceedings.mlr.press/v267/jung25a.html  
**Architecture:** asynchronous macro-actions + agent-centric encoders + centralized attention critic + modified GAE  
**Contribution:** 明確指出 macro-action造成 asynchronous temporal abstraction後，padding會導致 misalignment/spurious correlation。  
**Limitations:** multi-agent RL，不是 language/tool agent專門架構。

## Paper E — History-Dependent Behavior Policy OPE
**Title:** Demystifying the Paradox of Importance Sampling with an Estimated History-Dependent Behavior Policy in Off-Policy Evaluation  
**Authors:** Hongyi Zhou, Josiah P. Hanna, Jin Zhu, Ying Yang, Chengchun Shi  
**Year:** 2025  
**URL:** https://proceedings.mlr.press/v267/zhou25f.html  
**Contribution:** 理論拆出 history-dependent estimated behavior policy 的 bias-variance tradeoff。  
**本輪意義:** macro-action propensity在 Agent setting 很可能需要完整 history，而非僅 current observation。

---

# 八、已確認事實 / 工程實作 / 推論 / 假說分層

## 已確認 / 論文結果
- Options / temporal abstraction 可將 decision process表述為 SMDP。
- Long-horizon IS 的 product weights具有 severe variance問題。
- Options可在特定 OPE setting降低 long-horizon IS負擔。
- HiMAC 使用 macro blueprint + micro executor，並用 explicit subgoal termination token。
- ArCHer 使用 hierarchical value/actor interface來處理 multi-turn delayed reward。
- Asynchronous macro-actions不能安全地假裝成 synchronized primitive steps。

## 已確認 / 工程實作
- ArCHer code確實包含 `algorithms / data / environment / models` 分層。
- `ArcherAgent.get_action()`以 LM autoregressive generation產生 action。
- `get_log_prob()`把 action tokens的 log probability彙總成 action/utterance probability。
- `ArcherTrainer`使用 double Q/V critic與 actor advantage更新。

## 合理工程推論
- Hermes 應建立 OptionRegistry、TrajectorySegmentationContract、OptionPolicyFingerprint與 EventTimeLedger。
- Production Agent OPE 應同時保留 macro propensity、internal propensity與termination propensity。
- Option boundary應版本化，因為 segmentation change會改變 OPE statistical unit。

## 尚未驗證假說
- 對 open-ended browser/tool trajectories，可否學到一套 task-transferable、同時 counterfactually sufficient 的 option segmentation。
- LLM semantic subgoal embedding 是否能在不引入不可接受 bias 下取代 exact option identity。
- 多個並行 options的通用 off-policy evaluation是否能以 tractable event-graph factorization完成。

---

# 九、Unknown / Open Questions

## 1. Option discovery如何被「反事實有效性」約束？
目前很多 skill / subgoal discovery方法主要優化 compression、predictability或return，但 Hermes真正需要的是：

```text
同一 option abstraction
是否保留 downstream counterfactual claim 所需差異？
```

需要研究 `CounterfactualOptionEquivalence`。

## 2. Termination propensity如何可靠 logging？
Agent終止一個 research option可能因：

```text
planner decides enough
budget exhausted
tool failure
context overflow
safety block
user interruption
```

termination不是單一 Bernoulli policy，而可能是 competing-risk process。

## 3. Concurrent options如何做 OPE？
多 Agent / async tool runtime 中：

```text
Option A running
Option B starts before A ends
B observation depends on A partial result
```

這已不再是普通 linear SMDP trajectory，可能需要 event DAG / asynchronous causal process。

---

# 十、下一輪研究

## **Termination Policies × Competing Risks × Async Event DAG × Concurrent Option OPE**

下一輪應直接拆：

```text
Option initiated
↓
internal events
↓
multiple possible termination hazards
├ goal achieved
├ timeout
├ tool failure
├ safety veto
├ user interruption
└ planner replan
↓
termination cause
↓
duration
↓
next / concurrent options
```

研究方向：

```text
Option termination model
→ survival / hazard formulation
→ cause-specific propensity
→ semi-Markov transition
→ concurrent event graph
→ async OPE
→ credit assignment
```

並需要回答：

> 如果 target policy不只改「選哪個 option」，還改「什麼時候提前終止 option」，歷史 logs 是否仍有足夠 support 做 off-policy evaluation？

---

# 十一、Knowledge Graph 新增 Node / Edge

## Nodes

```text
Temporal Abstraction
Macro Action
Option
Option Initiation Set
Option Internal Policy
Option Termination Policy
Option Duration
Semi-Markov Decision Process
Semi-Markov Transition
Option Return
Option Policy Fingerprint
Option Registry
Option Propensity Record
Trajectory Segmentation
TrajectorySegmentationContract
Boundary Model
Boundary Confidence
HierarchicalAgentPolicy
Macro Policy
Micro Policy
Macro Credit
Micro Execution Credit
Duration Credit
Option-Level OPE
Intra-Option OPE
Option-Level Importance Ratio
Internal Policy Ratio
Termination Ratio
Event Time Ledger
Logical Clock
Asynchronous Macro Action
Concurrent Option
CounterfactualOptionEquivalence
```

## Edges

```text
Primitive Actions
→ May Compose Into Option

Semantic Action Cluster
≠ Valid Temporal Option

Option
→ Has Initiation Set

Option
→ Has Internal Policy

Option
→ Has Termination Policy

Option
→ Has Random Duration

Option
→ Induces Semi-Markov Transition

Trajectory Segmentation
→ Changes Statistical Unit Of Action

Trajectory Segmentation
→ Changes Propensity

Trajectory Segmentation
→ Changes Credit Assignment

Same Option Label
≠ Same Option Policy

Shorter OPE Horizon
≠ Lower Bias Automatically

Macro Selection Probability
≠ Full Option Propensity

Bad Outcome
≠ Bad Macro Choice Automatically

Successful Internal Execution
≠ Good Macro Choice

Same Logged Timestep
≠ Same Causal Time

Concurrent Options
→ Require Event-Time Reasoning

Option Abstraction
→ Can Reduce IS Horizon

Option Abstraction
→ Can Introduce Counterfactual Bias
```

---

# 十二、本輪結束判定

**缺哪一層：** `Termination / Duration / Async Event Semantics Layer`。  
**哪個節點最淺：** `CounterfactualOptionEquivalence`、`TerminationPropensity`、`ConcurrentOptionOPE`。  
**哪個概念仍只是名詞：** production 級 `Agent Option Validity Certificate`，目前尚缺通用可驗證定義。  
**哪個系統值得讀原始碼：** ArCHer，尤其 `archer/models/archer_agent.py → archer/algorithms/archer/trainer.py → offpolicy_train_loop.py → data/environment`。  
**哪篇論文需追引用：** `Using Options and Covariance Testing for Long Horizon Off-Policy Policy Evaluation`，因為它直接把 temporal abstraction與 OPE variance連起來；其次是 HiMAC 的 macro-micro hierarchical agent training。  
**哪個概念最適合視覺模擬：** `Agent Trajectory → Option Segmentation → Semi-Markov OPE Lab`。  
**哪個 Agent 架構最值得實作：**

```text
EventTimeLedger
↓
Trajectory Segmenter
↓
OptionRegistry
↓
Option Validity Auditor
↓
Hierarchical Policy / Propensity Ledger
↓
Semi-Markov Transition Builder
↓
Hierarchical OPE Router
↓
Macro/Micro Credit Assignment
```

---

# 十三、對「AI 到底怎麼運作」新增的一塊

前幾輪已逐步補到：

```text
User
→ UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tool
→ Structured Action
```

本輪新增的是 Structured Action後面的時間層：

```text
Primitive actions
→ temporal segmentation
→ macro-action / option
→ internal execution policy
→ termination decision
→ duration
→ semi-Markov transition
→ delayed outcome
→ hierarchical credit
→ next planning decision
```

因此「AI 做了一個動作」其實還是不夠精確。成熟 Agent 的真實執行單位可能是持續數秒到數分鐘、包含多個 tool calls、觀察、重試與驗證的 temporally extended action。

真正可驗證的 Agent 必須知道：

> 我現在是在執行哪一個 option？為什麼開始？內部做了哪些 primitive actions？為什麼結束？持續多久？如果結果不好，是 planner 選錯 macro-action，還是 executor 執行錯，還是 termination 太早／太晚？

只有補上這一層，`UI → Agent → Planning → Tools → Action → Outcome` 才真正開始從「事件串」變成可分析、可模擬、可反事實評估的 Agent Runtime。