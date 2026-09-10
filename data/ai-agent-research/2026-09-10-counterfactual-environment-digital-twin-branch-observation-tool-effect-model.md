# 【AI Agent × Multimodal Research Report】

**時間：2026-09-10 14:53 Asia/Taipei**

**本輪主題：Counterfactual Environment Simulation × Digital Twin × Branch-Specific Observation × Tool Effect Model**

## 與歷史研究的差異

上一輪已建立 `Production Request → Primary Runtime / Shadow Runtime → Effect Virtualization Gate → EffectIntent`，解決「Shadow Agent 不應真的修改 production 世界」。本輪往下一層：只攔截 effect 還不夠。一旦 Shadow 的 action 與 Primary 不同，兩個 runtime 理論上已進入不同世界，後續 observation 不能再共用。新核心問題是：**如何為每個 Agent branch 建立可演化、可驗證、可回滾、帶不確定性的 counterfactual environment state。**

---

## 本小時新發現

### 新論文 / 新架構

1. **Agent World Model: Infinity Synthetic Environments for Agentic Reinforcement Learning** — Zhaoyang Wang, Canwen Xu, Boyi Liu, Yite Wang, Siwei Han, Zhewei Yao, Huaxiu Yao, Yuxiong He; UNC-Chapel Hill / Snowflake AI Research; ICML 2026; arXiv:2602.10090. 系統會合成 1,000 個可執行、SQL database-backed、以統一 MCP interface 暴露的 tool-use environments，並提供 environment start/check、agent trajectory 與 SQL/code verifier。Code: https://github.com/Snowflake-Labs/agent-world-model
2. **World Reasoning Arena (WR-Arena)** — PAN Team et al.; 2026; arXiv:2603.25887. 將 world model 評估從單純 next-frame fidelity 擴展到 Action Simulation Fidelity、Long-horizon Forecast、Simulative Reasoning & Planning。Code: https://github.com/MBZUAI-IFM/WR-Arena
3. **Current Agents Fail to Leverage World Model as Tool for Foresight** — Cheng Qian et al.; ACL 2026. 研究指出 world model 即使可用，Agent 仍常不會正確決定何時模擬、如何解讀 rollout、如何把 foresight 整合回 planning；部分 agent simulation invocation <1%，誤用 predicted rollout 約 15%，強制使用 simulation 甚至可能使表現下降。URL: https://aclanthology.org/2026.acl-long.623/
4. **Counterfactual Planning for Generalizable Agents’ Actions** — Jiarun Fu et al.; Beijing Institute of Technology; AAAI 2026. 把 environment/action interaction 形式化為 Structural Causal Model，使用 State Causality Evaluator 與 What-If-Not counterfactual reward 改善 stochastic environment 下的 planning generalization。DOI: https://doi.org/10.1609/aaai.v40i35.40184
5. **World Model-Guided Reinforcement Learning via Counterfactual User Engagement Simulation** — Ang Li et al.; 2026-09-01; arXiv:2609.01067. 用 frozen User Engagement World Model 對相同 user history 的多個 candidate actions 平行預測 feedback，將 counterfactual feedback 轉為 reward，再訓練 policy。

---

## 本小時最重要 5 個發現

### 1. Recorded Observation Replay 只在「分支尚未改變世界」時有效

已確認事實：上一輪的 Primary-recorded observation 可以減少 production environment volatility 對 shadow differential 的干擾。

但合理工程推論是，只要 Shadow 做出不同的 effect intent：

```text
Production State S0
├ Primary: READ A
│  └ Observation = O_primary
└ Shadow: UPDATE A := B
   └ Environment should become S1_shadow
```

下一輪如果還把 `O_primary` 餵給 Shadow，就會產生 impossible history：Shadow 已改變 A，卻仍看到 Primary 未修改前的世界。

因此新增 invariant：

```text
SharedObservationAllowed(branch) =
  NoDivergentEffectSinceSharedAncestor(branch)
```

一旦 branch diverges：

```text
Shared Observation Bus
→ STOP
→ Branch-Specific Environment Twin
```

**為什麼重要：**這是從「shadow testing」進入「counterfactual rollout」真正的分界。

**限制：**如果工具 effect 無法被模擬、或 transition model confidence 太低，branch 必須停止延伸而不是幻想結果。

---

### 2. Tool Effect Model 應拆成 Precondition → Transition → Postcondition → Observation

不能把 Tool Simulation 寫成：

```text
call_tool(x)
→ fake_result
```

Hermes 應要求每個可模擬 Tool 擁有：

```text
Intent
→ Tool Schema
→ Arguments
→ Resolve Current Branch State
→ Check Preconditions
→ Apply Transition
→ Produce Postconditions
→ Generate Observation
→ Validate Invariants
→ Advance Branch Version
```

例如：

```text
update_doc(doc=7, title="B")

Precondition:
  doc 7 exists
  caller can edit
  version = 41

Transition:
  title A → B
  version 41 → 42

Postcondition:
  doc.title = B
  version = 42

Observation:
  {success:true, doc_id:7, version:42}
```

這使：

```text
Tool Response
≠
Environment Transition
```

Tool response 只是 transition 後可見 observation 的一部分。

---

### 3. Digital Twin 必須是「可 fork 的 state machine」，不是單一 mock database

Agent World Model 是本輪最接近 Hermes 所需結構的工程案例。它不是只生成 tool schemas，而是合成 SQL database-backed executable environments，透過 MCP interface 執行，並保存 initial/final DB 與 trajectory，再用 SQL/code verifier 檢查結果。

GitHub 原始碼值得看的核心目錄：

```text
awm/
├ core/
│  ├ agent.py
│  ├ db.py
│  ├ env.py
│  ├ pipeline.py
│  ├ reset.py
│  ├ sample.py
│  ├ scenario.py
│  ├ server.py
│  ├ spec.py
│  ├ task.py
│  ├ verifier.py
│  └ verify.py
├ eval/
├ tools.py
├ prompts.py
└ gpt.py
```

其中 `env.py` / `db.py` / `server.py` 對應 environment lifecycle + state + MCP exposure；`agent.py` 是 tool-use loop；`verifier.py` / `verify.py` 是 post-state verification；`reset.py` 則是 benchmark/world reset 入口。

Hermes 應把這個概念升級為：

```text
EnvironmentSnapshot S0
↓ fork
├ Branch A / State A0
│  ↓ action
│  State A1
└ Branch B / State B0
   ↓ action
   State B1
```

每個 branch state 必須有自己的：

```text
branch_state_id
parent_state_id
action_id
transition_model_version
state_hash
uncertainty
```

---

### 4. World Model 的最大風險不是「看起來不真」，而是 Transition Error 會逐步累積

WR-Arena 的重要改變，是不再只看 next-state / visual fidelity，而測：

```text
Action Simulation Fidelity
Long-Horizon Forecast
Simulative Reasoning & Planning
```

這非常適合 Hermes，因為 tool/world digital twin 的核心問題不是單步：

```text
S0 --a1→ S1
```

而是：

```text
S0
--a1→ Ŝ1
--a2→ Ŝ2
--a3→ Ŝ3
...
```

每一步都有 transition approximation error：

```text
ε1, ε2, ε3 ...
```

長 horizon 時誤差可能累積成：

```text
Predicted World
≠
Reachable Real World
```

因此新增：

```text
CounterfactualConfidence(t+1)
=
CounterfactualConfidence(t)
× TransitionConfidence(a_t, s_t)
× ObservationFidelity(a_t)
```

這不是論文公式，而是 Hermes 的工程建模假說；需要後續用真實 sandbox trajectory 校準。

當 confidence 低於 threshold：

```text
STOP COUNTERFACTUAL ROLLOUT
→ Ask real read / sandbox validation / human review
```

---

### 5. 「有 World Model」不等於 Agent 會用 World Model

ACL 2026《Current Agents Fail to Leverage World Model as Tool for Foresight》直接指出 bottleneck 常在 Agent orchestration，而不只 world model 本身：何時呼叫 simulator、如何解讀 predicted future、何時相信/忽略 rollout 都會失敗。

所以 Hermes 不該：

```text
Agent
→ always simulate 10 futures
```

而應新增 **Simulation Admission Gate**：

```text
Candidate Action
↓
Simulation Value Estimator
├ effect risk
├ irreversibility
├ branch uncertainty
├ world-model confidence
├ expected decision impact
├ simulation cost
└ deadline slack
↓
SIMULATE / EXECUTE / VERIFY / ASK
```

可定義初步：

```text
SimulateIf =
ExpectedDecisionValue
-
SimulationCost
-
ModelRisk
> threshold
```

與先前 Global Speculation Budget 連結，避免 world-model rollout 形成新的資源爆炸。

---

## Architecture Breakdown

```text
User / Production Request
↓
Primary Runtime
├ Real Environment
└ Observation Recorder

Shadow / Candidate Runtime
↓
Counterfactual Branch Manager
↓
Branch State Resolver
├ Shared Ancestor Snapshot
├ Branch-local State Overlay
├ Artifact Overlay
├ Memory Overlay
└ EffectIntent History
↓
Simulation Admission Gate
↓
Tool Effect Model Router
├ Deterministic Transition
├ Rule / Schema Transition
├ SQL / Stateful Sandbox
├ Learned World Model
├ Multimodal World Model
└ UNKNOWN
↓
Precondition Evaluator
↓
Transition Executor
↓
Postcondition Validator
↓
Branch-Specific Observation Generator
↓
Observation Envelope
├ provenance
├ state_before
├ state_after
├ transition_model
├ confidence
└ fidelity class
↓
Agent Reasoning / Planning
↓
Next Candidate Action
↓
Multi-step Counterfactual Rollout
↓
Candidate Future Comparison
↓
Promotion / Execution Decision
```

### 四層 world representation

```text
L0 Symbolic State
DB rows / files / permissions / object properties

L1 Operational State
sessions / locks / rate limits / browser state / MCP connection

L2 Perceptual State
image / video / UI pixels / audio / spatial state

L3 Latent Predictive State
learned embedding / world-model latent / future distributions
```

Hermes 不應讓 L3 world model 取代全部 L0/L1。對 Gmail/Drive/GitHub/MCP 等精確軟體工具，symbolic/stateful simulator 通常比純生成式 world model 更可驗證；對 embodied/video/3D interaction，才需要 multimodal latent world model。

---

## Bottom-Level Logic

### Counterfactual Branch State

```text
CounterfactualState {
  state_id,
  branch_id,
  parent_state_id,
  ancestor_production_snapshot,
  symbolic_state_root,
  operational_state_root,
  perceptual_state_refs,
  latent_state_ref,
  effect_history[],
  observation_history[],
  transition_depth,
  confidence,
  state_hash
}
```

### Transition contract

```text
T(s, a, ξ) → (s', o, p, c)
```

其中：

```text
s  = branch state
a  = candidate action
ξ  = stochastic/exogenous variables
s' = predicted next state
o  = observation returned to agent
p  = provenance / proof
c  = confidence
```

要特別保存 `ξ`，否則 seeded replay 不能重現同一 counterfactual path。

### Branch consistency predicate

```text
BranchValid(B) =
  StateHashChainValid(B)
∧ PreconditionsSatisfied(B)
∧ NoCrossBranchWrite(B)
∧ ObservationMatchesBranchState(B)
∧ TransitionModelKnown(B)
∧ ConfidenceAboveFloor(B)
```

若 `ObservationMatchesBranchState = false`：

```text
COUNTERFACTUAL HISTORY INVALID
```

---

## Multimodal Bottom-Level Extension

軟體 Tool 的環境 transition 常可精確模擬；Camera/Image/Video/Embodied 不同。

```text
Camera / Video
↓
Encoder
↓
Visual Tokens / Latent State
↓
Action Candidate
↓
World Model
↓
Future Latent / Video
↓
VLM Observer
↓
Predicted Observation
↓
Agent Planner
```

因此多模態 counterfactual observation 實際上包含兩層模型誤差：

```text
Action → Future World prediction error
+
Future World → Observation interpretation error
```

即：

```text
WorldModel Fidelity
≠
Agent Observation Fidelity
```

WR-Arena 的 action simulation / long-horizon / simulative planning 三軸正適合成為 Hermes visual world-model evaluator 的起點。

---

## Visual Simulation Idea

# Counterfactual Agent World / Digital Twin Lab

主畫面中央是一個可 fork 的世界樹：

```text
Production S0
├ Primary
│  ├ READ A
│  └ S0
│
├ Shadow Branch B1
│  ├ UPDATE A=B
│  ├ S1
│  ├ READ A
│  └ Observation: B
│
└ Shadow Branch B2
   ├ DELETE A
   ├ S2
   ├ READ A
   └ Observation: NOT_FOUND
```

每個 transition edge 顯示：

```text
Model      SQL / Rule / Learned WM
Confidence 0.97
Effect     WRITE
Depth      3
State hash 7AC...
```

可以切換：

```text
RECORDED OBSERVATION
STATEFUL DIGITAL TWIN
LEARNED WORLD MODEL
HYBRID
```

並注入：

```text
PERMISSION DENIED
CONCURRENT WRITE
NETWORK TIMEOUT
RATE LIMIT
STALE VERSION
UI LAYOUT CHANGE
VIDEO PHYSICS ERROR
WORLD MODEL HALLUCINATION
```

UI 同時畫出 confidence decay：

```text
B1 depth 1  0.98
B1 depth 2  0.94
B1 depth 3  0.81
B1 depth 4  0.59  ← STOP / VERIFY
```

最重要的教育動畫：

```text
Primary READ A → A
Shadow UPDATE A → B

錯誤模式：
Shadow 下一步仍注入 Primary READ observation = A
→ IMPOSSIBLE HISTORY

正確模式：
Shadow READ routed to Branch Twin
→ observation = B
```

---

## Code / GitHub

### Snowflake-Labs/agent-world-model

Repository: https://github.com/Snowflake-Labs/agent-world-model

值得追的目錄與核心檔：

```text
awm/core/env.py       environment lifecycle / executable environment
awm/core/db.py        database-backed environment state
awm/core/server.py    MCP-facing server path
awm/core/agent.py     multi-turn agent/tool loop
awm/core/scenario.py  generated scenario/state definition
awm/core/reset.py     reset/snapshot-like lifecycle
awm/core/verifier.py  state/result verifier
awm/core/verify.py    verification orchestration
awm/tools.py          tool abstraction
awm/eval/             benchmark/evaluation
```

這個 repository 對 Hermes 最有價值的不是「生成 synthetic data」，而是：**把工具世界做成可執行的 stateful environment，再用真實 post-state 驗證 Agent trajectory。**

### MBZUAI-IFM/WR-Arena

Repository: https://github.com/MBZUAI-IFM/WR-Arena

值得追：

```text
action_simulation_fidelity_scripts/
simulative_reasoning_planning_scripts/
generation_consistency_eval_scripts/
smoothness_eval_scripts/
world_generators/
datasets/
thirdparty/
```

它適合補 Hermes 的 multimodal/world-model simulation evaluator，而不是 software tool state engine。

---

## Papers

### Agent World Model: Infinity Synthetic Environments for Agentic Reinforcement Learning
- Authors: Zhaoyang Wang, Canwen Xu, Boyi Liu, Yite Wang, Siwei Han, Zhewei Yao, Huaxiu Yao, Yuxiong He
- Institution: UNC-Chapel Hill, Snowflake AI Research
- Year: 2026; ICML 2026
- URL: https://arxiv.org/abs/2602.10090
- Code: https://github.com/Snowflake-Labs/agent-world-model
- Dataset/Environment: 1,000 synthetic executable SQL database-backed MCP tool-use environments
- Architecture: environment/scenario generation → database-backed MCP server → agent trajectory → SQL/code verification
- Contribution: 將 synthetic tool-use training data 提升成 executable stateful worlds
- Limitation: 主要仍聚焦結構化軟體環境，不等價於完整 physical/multimodal world simulation

### World Reasoning Arena
- Authors: PAN Team, Qiyue Gao, Kun Zhou, Jiannan Xiang, Zihan Liu, Dequan Yang, Junrong Chen, Arif Ahmad, Cong Zeng, Ganesh Bannur, Xinqi Huang, Zheqi Liu, Yi Gu, Yichi Yang, Guangyi Liu, Zhiting Hu, Zhengzhong Liu, Eric Xing
- Year: 2026
- URL: https://arxiv.org/abs/2603.25887
- Code: https://github.com/MBZUAI-IFM/WR-Arena
- Dataset: includes Agibot World Colosseo / Language Table based evaluation setups
- Architecture: world generators + action simulation fidelity + long-horizon/consistency + simulative reasoning/planning
- Contribution: 從 visual fidelity 擴展到「能否真的拿 world model 做 planning」
- Limitation: evaluator 與 generated visual future 仍不直接保證 software-tool effect correctness

### Current Agents Fail to Leverage World Model as Tool for Foresight
- Authors: Cheng Qian, Emre Can Acikgoz, Bingxuan Li, Xiusi Chen, Yuji Zhang, Bingxiang He, Qinyu Luo, Gokhan Tur, Dilek Hakkani-Tür, Yunzhu Li, Heng Ji
- Year: 2026, ACL
- URL: https://aclanthology.org/2026.acl-long.623/
- Contribution: 實證指出 Agent orchestration / simulation-use policy 本身是 world-model agent bottleneck
- Limitation: findings 依 benchmark/model setup 而異，不能直接外推為所有 Agent

### Counterfactual Planning for Generalizable Agents’ Actions
- Authors: Jiarun Fu, Lizhong Ding, Qiuning Wei, Yuhan Guo, Yurong Cheng, Junyu Zhang
- Institution: Beijing Institute of Technology
- Year: 2026, AAAI
- URL: https://doi.org/10.1609/aaai.v40i35.40184
- Architecture: Structural Causal Model + State Causality Evaluator + What-If-Not reward
- Contribution: 把 counterfactual intervention 引入 action planning under stochastic feedback
- Limitation: 與 production software tool simulation 的 effect journal / permissions / transactions 還有明顯距離

### World Model-Guided Reinforcement Learning via Counterfactual User Engagement Simulation
- Authors: Ang Li, Xin Xu, Bin Liang, Yue Ma, Fubang Zhao, Yangyang Kang, Kam-Fai Wong
- Year: 2026
- URL: https://arxiv.org/abs/2609.01067
- Architecture: user history → multiple candidate actions → User Engagement World Model → simulated feedback → dense reward → policy optimization
- Contribution: 對「相同起始狀態、多個 counterfactual action、平行預測 outcome」提供近期實證案例
- Limitation: user engagement world model 是特定 domain simulator，不能直接視為 general tool/world twin

---

## 已確認 / 推論 / 假說界線

**已確認事實**
- Agent World Model 提供 1,000 個 SQL DB-backed executable MCP environments，具 trajectory 與 verification pipeline。
- WR-Arena 明確評估 action simulation fidelity、long-horizon 與 simulative reasoning/planning。
- ACL 2026 foresight study 顯示 Agent 可能不會有效使用 world-model simulation。

**工程實作推論**
- Production Shadow 一旦產生 divergent effect，必須停止直接 replay Primary observation。
- Digital twin 應以 forkable branch state + effect transition + observation generator 實作。

**尚未驗證假說**
- `CounterfactualConfidence` 可以透過 transition confidence 乘積式衰減來當作 rollout cutoff；此公式目前只是初始模型，需實驗校準。
- Hybrid symbolic + learned world model 是否能跨 software + multimodal environment 提供單一 ABI，尚未被證明。

---

## Unknown / Open Questions

1. **Exogenous event 問題：**當 branch fork 後，真實世界同時發生外部事件（其他使用者修改文件、信件進入、時間流逝），counterfactual twin 要 replay production event，還是 sampling possible future？
2. **Hybrid transition arbitration：**SQL/rule engine 與 learned world model 對同一 postcondition 判斷衝突時，哪個是 authority？如何量化 confidence？
3. **Long-horizon calibration：**如何把「world-model visual plausibility」轉成「Agent action outcome correctness」而不是只靠 VLM judge？

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
Counterfactual Environment
Agent Environment Digital Twin
Counterfactual Branch State
Shared Ancestor Snapshot
Branch State Overlay
Tool Effect Model
Transition Contract
Precondition Evaluator
Postcondition Validator
Branch-Specific Observation
Observation Provenance
Transition Confidence
Counterfactual Confidence
Simulation Admission Gate
World Model Tool
Symbolic World State
Operational World State
Perceptual World State
Latent Predictive State
Simulation Fidelity Gap
Impossible Counterfactual History
Exogenous Event
```

### Edges

```text
Production Snapshot
→ forked_into
Counterfactual Branch State

EffectIntent
→ interpreted_by
Tool Effect Model

Tool Effect Model
→ checks
Precondition

Tool Effect Model
→ transforms
Branch State

Branch State
→ generates
Branch-Specific Observation

Divergent Effect
→ invalidates
Shared Primary Observation

Transition Depth
→ increases
Counterfactual Uncertainty

Simulation Admission Gate
→ decides_use_of
World Model / Digital Twin

Symbolic State
→ grounds
Tool Transition

Latent Predictive State
→ predicts
Multimodal Future
```

### 重要否定關係

```text
Recorded Observation Replay
≠
Counterfactual Environment Simulation

Tool Response
≠
Environment Transition

Mock API
≠
Stateful Digital Twin

Visual Plausibility
≠
Action Outcome Correctness

World Model Availability
≠
Agent Foresight Capability

Same Initial State
≠
Same Future Observation After Divergent Action
```

---

## 下一輪研究

下一個最大缺口：

# Exogenous Events × Causal World State × Stochastic Transition × Belief State × Partial Observability

因為即使建立 branch-specific digital twin，Agent 通常仍看不到完整世界：

```text
True World State s_t
↓ hidden
Observation o_t
↓
Agent Belief b_t
↓
Action a_t
↓
Environment Transition
+
Exogenous Event ξ_t
↓
New World State s_{t+1}
```

下一輪應深入：

```text
POMDP
Bayesian Belief Update
State Estimation
Causal SCM
Exogenous Variables
Stochastic Tool Failure
Observation Noise
Belief-State Planning
Information-Gathering Action
Value of Information
```

並回答：**AI Agent 所謂的「世界狀態」到底是客觀 state，還是它根據不完整 observation 維護的 belief？當 Camera、Browser、MCP、Memory 對同一世界提供衝突訊號時，Agent 如何更新相信的世界。**

---

## 本輪結束判斷

- **缺哪一層：**Partial Observability / Belief-State Runtime。
- **哪個節點最淺：**Exogenous Event handling 與 learned/symbolic transition arbitration。
- **哪個概念仍只是名詞：**Unified Tool Effect Model ABI、Counterfactual Observation Contract。
- **哪個系統值得讀原始碼：**Snowflake-Labs/agent-world-model，優先 `awm/core/env.py`, `db.py`, `server.py`, `agent.py`, `verifier.py`; multimodal 部分追 MBZUAI-IFM/WR-Arena 的 `world_generators/` 與 `simulative_reasoning_planning_scripts/`。
- **哪篇論文需追引用：**Agent World Model、WR-Arena、Current Agents Fail to Leverage World Model as Tool for Foresight。
- **哪個概念最適合視覺模擬：**Counterfactual Agent World / Digital Twin Lab。
- **哪個 Agent 架構最值得實作：**`Branch-Isolated Counterfactual Agent Runtime = Snapshot Fork + Branch State Overlay + Tool Effect Model + Transition Validator + Branch Observation Generator + Simulation Admission + Confidence Cutoff`。

核心結論：**安全 Shadow Agent 的下一步不是更精緻地假裝 tool response，而是建立一個「分支真的能改變的世界」。每個 counterfactual action 都必須作用在 branch-local state 上，產生對應 post-state 與 observation；否則 Agent 雖然沒有碰 production，卻會在一條因果上不可能存在的假歷史中做 planning。**