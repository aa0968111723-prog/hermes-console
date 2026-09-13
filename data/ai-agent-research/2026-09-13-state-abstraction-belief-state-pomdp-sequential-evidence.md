# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-13 15:52 Asia/Taipei  
**主題**：State Abstraction Validity × Belief State × Predictive State × POMDP Sequential Evidence × LLM Agent State Sufficiency

## 0. 與歷史研究比較 / 本輪避免重複

上一輪已建立：Observed UI State ≠ Markov State；visit-gated transition residual 只有在 state 表示足以支撐 conditional Markov law 時，才可能成為 martingale-difference candidate。更早幾輪已處理 trajectory OPE、occupancy ratio、Bellman flow、off-policy replay、sequential evidence transformer。

**本輪不再重複 Bellman martingale / DualDICE / FORE / OPE。** 本輪專門回答更上游的問題：

> Agent 如何把 raw history / multimodal observation / memory / tool state 壓成「足以支撐未來預測與決策」的 internal state？這個 state 什麼時候只是方便的摘要，什麼時候才接近 POMDP belief state / predictive state / valid abstraction？

---

## 1. 本小時新發現

### 新論文 / 新架構

1. **Belief-State Engine: Augmenting LLMs for Principled Planning Under Partial Observability** — Arnab Chattopadhayay, Debdipta Halder, 2026, arXiv:2609.10036.  
   URL: https://arxiv.org/abs/2609.10036  
   Architecture: explicit Bayesian belief engine outside the LLM; the LLM receives posterior belief rather than raw history.  
   Contribution: proposes four belief-consistency axioms and argues BSE+LLM acts as a Markov policy on the belief MDP when raw history is hidden from the LLM.  
   Limitation: assumes an explicit underlying POMDP model / latent-state hypothesis space; this is much stronger than open-world Agent settings.

2. **PABU: Progress-Aware Belief Update for Efficient LLM Agents** — Haitao Jiang, Lin Ge, Hengrui Cai, Rui Song, 2026, arXiv:2602.09138.  
   URL: https://arxiv.org/abs/2602.09138  
   Code: https://github.com/Hunter-Jiang/Progress-Aware-Belief-Update  
   Dataset/Benchmark: AgentGym environments.  
   Architecture: predict progress + retention + action; keep only selected historical interactions.  
   Contribution: compact task-oriented state; paper reports 81.0% average completion and 9.5 average interaction steps across eight environments.  
   Limitation: engineering "belief" is a learned retained-history representation; it is not automatically a calibrated posterior over latent world states.

3. **Compositional Behavioral Semantics for State Abstraction in Reinforcement Learning** — Yivan Zhang, Ziyan Luo, Manuel Baltieri, 2026, arXiv:2606.25357.  
   URL: https://arxiv.org/abs/2606.25357  
   Contribution: provides a compositional framework for determining which behavioral structures are preserved under abstraction rather than assuming any compression is safe.

4. **Toward Learning POMDPs Beyond Full-Rank Actions and State Observability** — Seiji Shaw, Travis Manderson, Chad Kessens, Nicholas Roy, 2026, arXiv:2601.18930.  
   URL: https://arxiv.org/abs/2601.18930  
   Contribution: connects predictive-state style learning to explicit POMDP parameter recovery under rank assumptions; also demonstrates an impossibility boundary when different hidden-state models induce the same observation distributions.

5. **Mori-Zwanzig approach for belief abstraction with application to belief space planning** — Hou et al., Autonomous Robots 2025.  
   URL: https://link.springer.com/article/10.1007/s10514-024-10185-1  
   Code: https://github.com/mengxueHou/M-Z-based-Belief-Abstraction-for-Symbolic-Planning  
   Contribution: when an abstraction is not Markov, retain explicit memory correction instead of pretending the compressed state is Markov.

---

## 2. 本小時最重要 5 個發現

### 發現 1：History Compression ≠ Belief State

**已確認事實 / paper result**：PABU deliberately selects and retains a subset of interactions and predicts progress; BSE instead maintains an explicit posterior over latent states.

底層區分：

```text
Raw history H_t
  ↓ compressor C
Compact summary z_t
```

只代表 `z_t = C(H_t)`。

真正 Bayesian belief state 則是：

```text
b_t(s)
= P(S_t=s | O_1,A_1,...,O_t)
```

更新：

```text
prediction:
\bar b_t(s') = Σ_s T(s'|s,a_{t-1}) b_{t-1}(s)

correction:
b_t(s') ∝ O(o_t|s') \bar b_t(s')
```

**為什麼重要**：Hermes 的 memory summary / context compression / progress state 不能只因為短且有效，就標成 `BELIEF_STATE_VALID`。

新增規則：

```text
Compact History Summary
≠ Bayesian Belief State
≠ Predictively Sufficient State
```

### 發現 2：LLM 看 raw history 可能破壞「belief-MDP Markovization」

BSE 的核心 architecture insight 是：如果 planner 同時看到 posterior belief `b_t` 與 raw history `H_t`，它仍可能根據 history 中 belief 未編碼的模式改變 policy；這時 policy 不再只是 `π(a|b_t)`。

```text
Safe belief-policy abstraction:
H_t → Belief Engine → b_t → LLM → a_t

Potential leakage:
H_t ───────────────┐
H_t → b_t → LLM ←─┘
```

對 Hermes 的工程含義：state abstraction certificate 必須保存 **side-channel exposure**：system prompt、retrieved memory、tool trace、raw screenshots、hidden metadata 是否繞過 state constructor 被 planner 直接看見。

新增：

```text
StateExposureContract
├ permitted_state_view
├ forbidden_raw_history_channels
├ memory_side_channels
├ tool_trace_side_channels
├ multimodal_side_channels
└ leakage_status
```

### 發現 3：Predictive State 可以不恢復「真實 hidden state」，但必須保留未來可預測資訊

POMDP belief 是 latent-state posterior；Predictive State Representation (PSR) 的思路則用 future observation/action tests 的 predictions 當 state。

概念鏈：

```text
History H_t
↓
Predictions of future tests
p(test outcome | H_t)
↓
Predictive state q_t
↓
update q_{t+1}
```

2026 POMDP learning工作再次強調：從 sequential observations 有時只能辨識 hidden states 的 partition / equivalence class，而不能唯一還原真實 latent states。

因此：

```text
Latent-State Recovery
≠ Predictive Sufficiency
```

對 Hermes：若「使用者意圖 / 外部世界狀態」不可唯一識別，但不同 latent hypotheses 對未來 tool observations 和 safe actions 給出相同預測，仍可能足以決策。

### 發現 4：State Abstraction 必須明列「保留什麼 semantics」

2026 compositional abstraction work指出，安全 abstraction 的核心不是「壓縮率高」，而是哪些 behavioral properties 被保留。

Hermes 應將 abstraction contract 改為：

```text
StateAbstractionCertificate
├ abstraction_hash
├ source_history_schema
├ preserved_prediction_family
├ preserved_reward_family
├ preserved_safety_properties
├ preserved_action_equivalence
├ bisimulation_or_metric_bound
├ aliasing_test_status
├ side_channel_status
└ validity_scope
```

例如：

```text
摘要 A：保留 task progress
但未保留 auth state
→ 對導航可用
→ 對 WRITE_MCP permission 不可用
```

所以：

```text
State Validity
must be scoped to downstream query/action family
```

### 發現 5：若 abstraction 非 Markov，正確方向可能是「顯式記憶核」而不是硬逼成 Markov

Mori–Zwanzig belief abstraction 顯示：降維後的 dynamics 可能天然帶 memory effect。

簡化表示：

```text
z_{t+1}
= F(z_t,a_t)
+ memory_kernel(z_{0:t},a_{0:t})
+ noise
```

因此 Hermes 應把 state gate 從二元：

```text
MARKOV / FAIL
```

升級成：

```text
StateDynamicsRegime
├ EXACT_MARKOV
├ APPROX_MARKOV_WITH_BOUND
├ BELIEF_MARKOV
├ PREDICTIVE_STATE
├ NONMARKOV_MEMORY_KERNEL
├ HISTORY_REQUIRED
└ UNRESOLVED
```

---

## 3. Architecture Breakdown

### System Architecture：Belief-Aware Hermes Runtime

```text
UI / Voice / Camera / Browser / Tool / MCP
↓
Raw Observation Event Ledger
↓
History Normalizer
↓
Latent-State / Predictive-State Router
├ Explicit POMDP known
│   → Bayesian Belief Filter
│
├ Hidden state unknown but future tests learnable
│   → Predictive State Encoder
│
├ Task-oriented compression only
│   → Progress / Memory State
│
└ Compression loses Markov property
    → Memory-Kernel / Full-History fallback
↓
State Sufficiency Auditor
├ prediction calibration
├ one-step residual
├ multi-step residual
├ state aliasing
├ action-conditional forecast
├ side-channel leakage
└ safety-property preservation
↓
State Certificate
↓
Planner View Firewall
↓
LLM Planner / Policy
↓
Permission Gate
↓
Tool / MCP / External Action
```

### 核心新元件：Planner View Firewall

目的：若某條 theorem / policy guarantee 假設 planner 只看到 `b_t`，就不能讓 raw history 從 RAG、memory、debug trace、screenshot metadata 偷渡進去。

```text
PlannerInput = CertifiedStateView
                + AllowedGoalContext
                + AllowedActionSchema

NOT:
PlannerInput = everything available in runtime
```

---

## 4. Bottom-Level Logic

### 4.1 Bayesian belief update

```text
b_{t-1}
↓ action a_{t-1}
transition prediction
↓
\bar b_t
↓ observation o_t
observation likelihood
↓
normalization
↓
b_t
```

### 4.2 State aliasing

若兩個 history：

```text
H_t^1 ≠ H_t^2
```

被壓成同一個 state：

```text
C(H_t^1) = C(H_t^2) = z
```

但存在某 action / future event，使：

```text
P(Y_{t+1:t+k}|H_t^1,a) ≠ P(Y_{t+1:t+k}|H_t^2,a)
```

則 `z` 對該 predictive task 有 aliasing，不是 sufficient state。

### 4.3 Predictive sufficiency test family

Hermes 不應只測 next token / next tool result；至少需要：

```text
1-step observation prediction
k-step event prediction
risk-state reachability
permission-relevant hidden variable
human-response distribution
MCP/tool outcome distribution
```

### 4.4 Belief calibration ≠ belief correctness

即使 posterior calibration 看起來好，也可能：

```text
state space misspecified
observation model misspecified
transition model misspecified
latent hypothesis missing
```

因此需分：

```text
BeliefCalibrationCertificate
ModelClassAdequacyCertificate
StateSpaceCoverageCertificate
```

---

## 5. Visual Simulation Idea

# Belief State × State Aliasing × Planner Leakage Lab

左側顯示兩條不同 history：

```text
History A:
Login OK → Token refreshed → MCP read success

History B:
Login expired → cached UI → MCP read success
```

中間的 naive compressor 都壓成：

```text
z = "MCP available"
```

點選 `WRITE_MCP` 後顯示：

```text
Future outcome distribution:
A: success .95 / auth fail .05
B: success .10 / auth fail .90

STATE ALIASING DETECTED
```

再切換 Bayesian belief：

```text
b(auth_valid)
A = .97
B = .12
```

最後加入 Planner Leakage toggle：

```text
[ ] expose raw history
[x] belief only
```

當 raw history 開啟，UI 標示：

```text
Belief-MDP theorem scope: BROKEN BY SIDE CHANNEL
```

這個視覺化能直接讓不懂 POMDP 的使用者理解：

> 為什麼「摘要看起來一樣」並不代表 Agent 位於同一個真正狀態。

---

## 6. Code / GitHub

### Hunter-Jiang/Progress-Aware-Belief-Update

Repo: https://github.com/Hunter-Jiang/Progress-Aware-Belief-Update

目錄：

```text
src/
├ PABU_evaluation.py
├ PABU_training.py
├ utils.py
└ utils_agentenv.py

agentenvs/
evaluation_split/
scripts/
```

值得看的核心檔案：

1. `src/PABU_evaluation.py`：實際 Agent rollout / environment loop；每個 active host 把 `env.history[-1]["content"]` tokenized 後餵給 LM，generation 再送回 `env.step(...)`。
2. `src/PABU_training.py`：progress/retention/action 的訓練路徑。
3. `src/utils_agentenv.py`：各 AgentGym environment client 與 history / environment interaction abstraction。

**工程判讀**：PABU 的 code 很適合研究「learned compact agent state」與 runtime efficiency，但不應直接被當成 probabilistic POMDP belief filter 的 reference implementation。

下一步值得讀：

```text
src/PABU_training.py
src/utils_agentenv.py
```

重點追：retention signal 如何變成下一輪 context、哪些 observation 被永久丟棄、progress label 如何建立。

---

## 7. Papers

### Paper A
**Title**: Belief-State Engine: Augmenting LLMs for Principled Planning Under Partial Observability  
**Authors**: Arnab Chattopadhayay, Debdipta Halder  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2609.10036  
**Architecture**: external Bayesian filter → posterior belief → LLM planner.  
**Contribution**: explicit belief state and belief-consistency architecture for LLM agents under partial observability.  
**Limitations**: known/constructible POMDP latent-state model; theorem assumptions may fail in open-world tool agents.

### Paper B
**Title**: PABU: Progress-Aware Belief Update for Efficient LLM Agents  
**Authors**: Haitao Jiang, Lin Ge, Hengrui Cai, Rui Song  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2602.09138  
**Code**: https://github.com/Hunter-Jiang/Progress-Aware-Belief-Update  
**Dataset**: AgentGym suite  
**Contribution**: learned progress-aware retention compresses history and reduces redundant interaction.  
**Limitations**: “belief” is task-oriented learned state, not automatically calibrated latent-state posterior.

### Paper C
**Title**: Compositional Behavioral Semantics for State Abstraction in Reinforcement Learning  
**Authors**: Yivan Zhang, Ziyan Luo, Manuel Baltieri  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2606.25357  
**Contribution**: clarifies what behavioral semantics are preserved by abstractions.

### Paper D
**Title**: Toward Learning POMDPs Beyond Full-Rank Actions and State Observability  
**Authors**: Seiji Shaw, Travis Manderson, Chad Kessens, Nicholas Roy  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2601.18930  
**Contribution**: predictive representations + POMDP recovery under rank assumptions; explicit identifiability boundary.

---

## 8. Unknown / Open Questions

1. **Belief-state sequential evidence**：如果 belief `b_t` 本身是 learned / approximate，如何把 belief error 傳進 transition e-process / Bellman certificate，而不是假裝 belief 是 observed truth？
2. **State abstraction theorem checker**：能否自動測試一個 Hermes context compressor 對指定 action family 是否保留 prediction / safety semantics？
3. **Planner side-channel theorem**：LLM 同時接觸 certified state 與額外 RAG / memory 時，什麼條件下還能維持 belief-policy / predictive-state guarantees？

---

## 9. 下一輪研究

下一輪聚焦：

# Belief Error Propagation × Approximate Filtering × POMDP Sequential Certificate × Multimodal Latent State

鏈路：

```text
Camera / Voice / UI / Tool Observations
↓
Multimodal Observation Model
↓
Approximate Bayesian / Neural Filter
↓
Belief Calibration + Model Misspecification
↓
Belief Uncertainty Set
↓
Robust POMDP / Risk Solver
↓
Sequential Belief Certificate
↓
Permission Gate
```

優先研究：

- belief calibration under model misspecification
- robust POMDP ambiguity sets
- neural / particle filtering for Agent belief
- predictive-state vs latent-belief equivalence / identifiability
- belief error → policy risk upper bound
- multimodal observation likelihood fusion

---

## 10. Knowledge Graph 新增 Node / Edge

### Nodes

```text
Belief State
Bayesian Belief Filter
Belief MDP
Belief-State Engine
Planner View Firewall
State Exposure Contract
Raw-History Side Channel
Progress-Aware Belief Update
Task-Oriented Compact State
Predictive State Representation
Predictive Sufficiency
Latent-State Identifiability
State Aliasing
Behavioral State Abstraction
State Abstraction Certificate
Abstraction Scope
Safety-Preserving Abstraction
Bisimulation-Bounded Abstraction
Non-Markov Memory Kernel
Approximate Markov State
Belief Calibration Certificate
Model-Class Adequacy Certificate
State-Space Coverage Certificate
Belief Error Propagation
```

### Positive Edges

```text
History --BayesianFilter--> BeliefState
BeliefState --Markovizes--> POMDPPolicy
History --PredictiveEncoder--> PredictiveState
StateAbstraction --Preserves--> BehavioralSemantics
StateAliasing --Violates--> PredictiveSufficiency
RawHistorySideChannel --CanBreak--> BeliefPolicyAbstraction
NonMarkovAbstraction --MayRequire--> MemoryKernel
BeliefState --Feeds--> PlannerViewFirewall
```

### Negative / distinction Edges

```text
Compact History Summary
≠ Belief State

Progress State
≠ Calibrated Latent Posterior

Latent-State Recovery
≠ Predictive Sufficiency

Compression Quality
≠ State Sufficiency

High Task Success
≠ Markov Validity

Belief Calibration
≠ Correct State-Space Specification

State Validity For Navigation
≠ State Validity For External Write Permission

Belief State + Raw History
≠ Pure Belief-MDP Policy Automatically
```

---

## 11. 本輪結束判定

- **缺哪一層**：Approximate belief / predictive-state error 如何進入 sequential evidence 與 permission certificate。
- **哪個節點最淺**：`BeliefErrorPropagation`、`StateExposureContract`、`StateAbstractionCertificate`。
- **哪個概念仍只是名詞**：production 級 `Automatic State Sufficiency Auditor`。
- **哪個系統值得讀原始碼**：PABU 的 `PABU_training.py` + `utils_agentenv.py`；另需追 Belief-State Engine 對應 code release。
- **哪篇論文需追引用**：Belief-State Engine (2026) 與 Compositional Behavioral Semantics for State Abstraction (2026)。
- **哪個概念最適合視覺模擬**：Belief State × State Aliasing × Planner Leakage Lab。
- **哪個 Agent 架構最值得實作**：`Observation Ledger → Belief/Predictive State Router → State Sufficiency Auditor → Planner View Firewall → Permission Gate`。

## 12. 對「AI 到底怎麼運作」新增的一層

```text
使用者 / Camera / Voice / Tool
↓
observation history
↓
Agent 並不是直接「知道世界狀態」
↓
它必須從不完整 observation 推測 hidden state
↓
可選：Bayesian belief / predictive state / learned task summary
↓
驗證這個 state 是否保留未來預測與安全決策需要的資訊
↓
只把 certified state view 暴露給 Planner
↓
Reasoning / Planning
↓
Action
```

**核心結論**：真正的 Agent state 不是「目前 prompt 裡有哪些文字」，也不是「memory summary 寫了什麼」。在部分可觀測世界中，state 是對歷史資訊的推論性表示；若這個表示把會影響未來的差異壓掉，就會產生 state aliasing。Hermes 下一步必須從「context management」升級到「state estimation + state validity certification」。