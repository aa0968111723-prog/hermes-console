# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 15:01（Asia/Taipei）**  
**本輪主題：Termination Policies × Competing Risks × Async Event DAG × Concurrent Option OPE**

---

## 0. 與歷史研究比較：本輪刻意不重複什麼

上一輪已建立：

- Atomic Action ≠ Turn ≠ Option ≠ Full Trajectory
- Option 需要 initiation / internal policy / termination / duration
- SMDP target 需要 `γ^τ`
- trajectory segmentation 本身會改變 action statistical unit
- asynchronous multi-agent 不能把相同 logged timestep 當成相同 causal time

本輪因此不再重講「什麼是 option」，而只追四個仍未補齊的底層缺口：

1. **Option 到底因為什麼結束？**
2. **多種 termination cause 如何彼此競爭？**
3. **多個 option 同時執行時，事件應如何排序與歸因？**
4. **歷史資料只有終點或被截斷時，OPE 如何避免把 censoring 當 failure？**

本輪的主要新結論：

```text
OptionTerminated = true
≠
Termination semantics are known
```

以及：

```text
Same duration
≠
Same termination mechanism
```

---

# 一、本小時新發現

## 新論文 / 新架構

### 1. ToMacVF: Temporal Macro-Action Value Factorization for Asynchronous Multi-Agent Reinforcement Learning

- Authors: Wenjing Zhang, Wei Zhang
- Institution: Harbin Institute of Technology
- arXiv: 2507.10251
- Year: 2025；2026-08-25 online publication
- Architecture: CTDE + Macro-action Segmented Joint Experience Replay Trajectory (Mac-SJERT) + Temporal Macro-action IGM + temporal value factorization
- Benchmarks: BoxPushing, Overcooked, WareHouse
- 核心改變：不再只在 macro-action termination endpoint 取樣 joint experience，而是保留 macro-action 執行期間的時間切片，以避免 incomplete trajectory representation 與錯誤 temporal credit。
- 限制：核心仍以 MARL value learning 為主，沒有直接提供 production Agent 常見的 termination-cause taxonomy、counterfactual censoring certificate 或 concurrent tool-runtime semantics。
- URL: https://arxiv.org/abs/2507.10251
- Published version: https://journals.sagepub.com/doi/10.3233/FAIA251261

### 2. Agent-Centric Actor-Critic for Asynchronous Multi-Agent Reinforcement Learning

- Authors: Whiyoung Jung, Sunghoon Hong, Deunsol Yoon, Kanghoon Lee, Woohyung Lim
- Institution: LG AI Research
- Venue: ICML 2025
- Architecture: agent-centric trajectory encoders + attention aggregation + centralized critic + asynchronous GAE / PPO
- GitHub: https://github.com/LGAI-Research/acac
- 核心改變：不用 padding 強行同步 agent histories；每個 agent 的非同步 trajectory 獨立編碼，再由 attention 聚合給 centralized critic。
- 限制：execution log 仍主要以 `mac_done` 表示 macro-action 是否完成，沒有 production Agent 所需的多原因 termination event ontology。
- Paper: https://proceedings.mlr.press/v267/jung25a.html

### 3. Off-Policy Evaluation and Learning for Survival Outcomes under Censoring

- Authors: Kohsuke Kubota, Mitsuhiro Takahashi, Yuta Saito
- Year: 2026
- 核心：把右設限 survival outcome 引入 OPE，提出 IPCW-IPS 與 IPCW-DR，避免把「觀察結束前事件尚未發生」錯當成事件已經發生。
- 對 Hermes 的意義：Agent option 常因 session end、context limit、job cancellation、runtime shutdown、budget exhaustion 而停止觀察；這些可能是 **censoring**，不等於 option failure。
- URL: https://arxiv.org/abs/2603.22900

### 4. Semi-competing risks / illness-death model

傳統 survival / competing-risk 模型把不同 event cause 拆成不同 cause-specific hazards。雖然來源主要來自醫療統計，但底層結構對 Agent termination 非常可移植：

```text
option running
├→ goal achieved
├→ timeout
├→ tool failure
├→ safety veto
├→ user interruption
├→ planner replan
└→ observation censored
```

最重要的是：

```text
P(terminated by time t)
```

不足以回答：

```text
P(terminated by CAUSE k at time t)
```

因此「duration model」與「termination-cause model」必須拆開。

---

# 二、本小時最重要 5 個發現

## 發現 1：Option termination 必須從 Boolean 升級成 competing-risk process

### 是什麼

目前很多 Agent / RL runtime 實際上紀錄：

```text
terminated = true / false
```

但 production Agent 的 option 結束至少有：

```text
GOAL_ACHIEVED
TIMEOUT
TOOL_FAILURE
SAFETY_VETO
USER_INTERRUPT
PLANNER_REPLAN
BUDGET_EXHAUSTED
CONTEXT_EXHAUSTED
DEPENDENCY_CANCELLED
RUNTIME_SHUTDOWN
```

這些 event 對 learning、OPE、permission、安全解釋完全不同。

### 底層如何運作

令 `T` 是 option termination time，`K` 是 termination cause。

對 cause `k` 定義 cause-specific hazard：

```text
λ_k(t | H_t, o)
=
lim(Δt→0)
P(t ≤ T < t+Δt, K=k | T≥t, H_t,o) / Δt
```

overall hazard：

```text
λ_total(t) = Σ_k λ_k(t)
```

survival：

```text
S(t)
=
P(T>t)
=
exp(-∫₀ᵗ λ_total(u)du)
```

cause-specific cumulative incidence：

```text
F_k(t)
=
P(T≤t,K=k)
=
∫₀ᵗ S(u-) λ_k(u)du
```

### 為什麼重要

假設兩個 Research options 都平均執行 42 秒：

```text
Option A
70% goal achieved
20% timeout
10% safety veto

Option B
20% goal achieved
70% timeout
10% safety veto
```

平均 duration 完全可能相同，但政策品質完全不同。

因此：

```text
Duration Distribution
≠
Termination Semantics
```

### 限制

survival / competing-risk 結構可以移植，但「cause taxonomy」本身必須由 Agent runtime 明確定義，不能直接照醫療 event semantics 套用。

---

## 發現 2：Censoring 不是 failure；Agent OPE 必須分 observed termination 與 observation ending

### 是什麼

Agent execution log 常看到：

```text
option start
...
log ends
```

log ends 的原因可能是：

- session 被關閉
- context window rollover
- workflow 被人工停止
- telemetry 掉線
- 研究時間窗結束
- upstream job cancellation

這些都不代表 option 失敗。

### 底層如何運作

令：

```text
T = true termination time
C = censoring time
Y = min(T,C)
δ = I(T ≤ C)
```

如果直接把 `Y` 當 termination time，就會系統性低估 duration / success-to-event time。

2026 censoring-aware OPE 的核心做法是額外使用 censoring survival probability：

```text
G(t|H,A) = P(C ≥ t | H,A)
```

並使用 inverse probability of censoring weighting：

```text
w_censor(t)
≈
δ / G(Y|H,A)
```

再和 policy importance ratio 結合。

### Hermes runtime primitive

```text
OptionObservationStatus
├ observed_end_time
├ termination_observed
├ censoring_observed
├ censoring_reason
├ termination_cause
├ censoring_model_version
└ identifiability_status
```

### 新 edge

```text
Log End
≠
Option Termination
```

以及：

```text
Censored Option
≠
Failed Option
```

---

## 發現 3：非同步資料不能只在 macro-action endpoint 取樣

ToMacVF 指出既有 Mac-JERT 類 buffer 只在 macro-action endpoint 收集有限資訊，會造成 execution process representation 不完整，以及 unsuitable credit assignment。

ToMacVF 改用：

```text
Macro-action Segmented Joint Experience Replay Trajectory
(Mac-SJERT)
```

保留 macro-action 執行期間的時間分段資訊，再同時做 micro-TD 與 macro-TD。

### 對 Hermes 的直接翻譯

錯誤：

```text
Option Start
↓
42 sec black box
↓
Option End
```

應改為：

```text
Option Start
↓
Event segment 1
↓
Tool call
↓
Observation
↓
Concurrent memory write
↓
Safety check
↓
Planner event
↓
Tool retry
↓
Termination event
```

因此新增：

```text
OptionSegmentedEventTrace
├ option_instance_id
├ segment_id
├ logical_start
├ logical_end
├ wall_clock_start
├ wall_clock_end
├ observed_state_hash
├ action_ids[]
├ tool_events[]
├ reward/cost events[]
├ concurrent_option_ids[]
└ termination_hazard_snapshot
```

這一層可以視為 Hermes 版 `Mac-SJERT`。

### 重要限制

ToMacVF 的目標是 MARL learning；Hermes 要額外加入：

- tool/MCP provenance
- permission state
- retry lineage
- cancellation propagation
- user interrupts
- model/router versions
- causal availability timestamps

---

## 發現 4：ACAC 證明「不 padding」比假同步更合理，但 Agent runtime 還需要 Event DAG

ACAC 針對 asynchronous macro-actions，不把 agent trajectories padding 到相同長度，而是：

```text
Agent 1 history → encoder ┐
Agent 2 history → encoder ├→ attention aggregation → centralized critic
Agent 3 history → encoder ┘
```

官方 repo 的核心結構：

```text
acac/
├ acac_marl/
│  ├ algs/
│  │  ├ acac.py
│  │  ├ acac_micro_gae.py
│  │  └ acac_vanilla.py
│  └ cores/acac/
│     ├ controller.py
│     ├ envs_runner.py
│     ├ learner_acac.py
│     ├ memory.py
│     ├ models.py
│     └ transformer_model.py
└ env/
```

`envs_runner.py` 的 worker 會從 environment info 讀：

```text
action = info['cur_mac']
valid  = info['mac_done']
```

並對每個 macro-action 累積 discounted reward 與 step count；只要 macro-action 還沒 done，就持續累積 duration 與 reward。

這證明 duration-aware runtime 已進入工程實作，但 Hermes 還應再增加：

```text
mac_done
↓
termination_cause
termination_trigger_event
termination_actor
termination_permission
termination_counterfactual_status
```

### 為什麼 Event DAG 比 timestep 更重要

真實 Agent：

```text
Research option ────────────────┐
  ├ Search                      │
  ├ Read                        │
  └ Verify                      │
                                ├→ final answer
Memory compaction ────────┐     │
                          └─────┘
Safety monitor ─────────────────┘
```

同一 wall-clock 時間可能有多個 concurrent processes。

所以：

```text
step 17
```

不夠；應有：

```text
AsyncEventDAG
Node = event
Edge types:
├ happens_before
├ observes
├ triggers
├ cancels
├ depends_on
├ blocks
├ resumes
├ writes_state
└ reads_state
```

### 新核心 edge

```text
Same Timestamp
≠
Same Causal Availability
```

---

## 發現 5：Concurrent options 不能用單一 option propensity 直接做 OPE

假設同時存在：

```text
O1 = Research
O2 = Memory compaction
O3 = Safety monitor
```

Research 的成功機率可能依賴 Safety monitor 是否 veto；Memory compaction 又可能改變 Research 後續 context。

因此：

```text
P(O1 | H)
```

通常不足。

真正可能需要：

```text
P(
  option-set,
  start-order,
  overlap-pattern,
  cancellation-policy,
  termination-causes
| history
)
```

完整 exact joint propensity 幾乎會爆炸，因此 Hermes 要分層：

```text
ConcurrentOptionPropensity
├ option initiation propensity
├ concurrency-set propensity
├ scheduler propensity
├ resume/preempt propensity
├ cancellation propensity
├ cause-specific termination propensity
└ censoring propensity
```

### bottom-level hazard factorization（工程假說）

在有條件獨立性可接受時，可以近似：

```text
P(trace)
≈
Π initiation
× Π scheduler decisions
× Π internal actions
× Π survival increments
× termination hazard
× censoring process
```

但這只是 **合理工程建模方向**，不是已證明可通用於 arbitrary LLM agents 的定理。

---

# 三、Architecture Breakdown

## Hermes：Async Option Runtime v2

```text
User / Agent Planner
↓
Option Proposal
↓
Option Initiation Gate
├ permission
├ resource budget
├ dependency readiness
└ initiation propensity
↓
Concurrent Option Scheduler
├ RUN
├ WAIT
├ PREEMPT
├ RESUME
└ CANCEL
↓
EventTimeLedger
↓
AsyncEventDAG
├ happens_before
├ observes
├ triggers
├ reads/writes
├ blocks
├ resumes
└ cancels
↓
OptionSegmentedEventTrace
↓
Cause-Specific Termination Runtime
├ GOAL_ACHIEVED
├ TIMEOUT
├ TOOL_FAILURE
├ SAFETY_VETO
├ USER_INTERRUPT
├ PLANNER_REPLAN
├ BUDGET_EXHAUSTED
├ CONTEXT_EXHAUSTED
├ DEPENDENCY_CANCELLED
└ RUNTIME_SHUTDOWN
↓
Censoring Auditor
├ observed termination?
├ observation ended?
├ censoring mechanism
└ support
↓
Semi-Markov Transition Builder
↓
Concurrent Option OPE Router
├ exact option IS
├ hierarchical IS
├ IPCW
├ DR + censoring correction
├ segmented credit
└ BLOCK / NOT IDENTIFIED
↓
Macro / Micro / Duration / Termination-Cause Credit
↓
Policy Update + Knowledge Graph
```

---

# 四、Bottom-Level Logic

## 4.1 Option execution state

對 option `o` 在時間 `t`：

```text
Z_t(o)
∈ {
  NOT_STARTED,
  RUNNING,
  WAITING,
  PREEMPTED,
  RESUMED,
  TERMINATED,
  CENSORED
}
```

termination 不應被壓縮成只有 `TERMINATED`。

## 4.2 Cause-specific discrete hazard

Agent runtime 多半是離散 event loop，因此可用：

```text
h_k(t)
=
P(K=k,T=t | T≥t,H_t,o)
```

總 hazard：

```text
h(t)=Σ_k h_k(t)
```

存活到下一事件：

```text
P(T>t | T≥t)
=
1-h(t)
```

## 4.3 SMDP target 必須 condition on termination semantics

普通 option target：

```text
G_t
=
Σ(i=0→τ-1) γ^i r_(t+i)
+
γ^τ V(s_(t+τ))
```

Hermes 應加入 termination-aware terminal state：

```text
V(
 state_after_option,
 termination_cause,
 outstanding_concurrent_options,
 permission_state
)
```

因為：

```text
Research → Goal achieved
```

與：

```text
Research → Safety veto
```

即使停在相同 UI state，也不應有相同 downstream semantics。

## 4.4 Censoring-aware OPE

若 target policy ratio 是：

```text
ρ_t = π_e(a_t|H_t) / π_b(a_t|H_t)
```

而 option observation 受到 censoring，工程上可考慮：

```text
W
=
policy-ratio product
×
IPCW correction
```

並優先使用 doubly-robust estimator 降低單一 nuisance model 錯誤風險。

但前提仍包括：

- policy support
- censoring support
- censoring mechanism 可被合理模型化
- hidden confounding 沒有被忽略

所以：

```text
IPCW available
≠
Counterfactual option value identified automatically
```

---

# 五、Visual Simulation Idea

# **Async Option Hazard × Event DAG Lab**

## UI 左側：Concurrent Option Timeline

```text
0s      5s      10s      15s      20s
Research  ██████████████████ X
Memory       ███████✓
Safety    ███████████████████████
Browser      █████ X
```

`X` 點開後顯示：

```text
Research termination:
PLANNER_REPLAN

Browser termination:
TOOL_FAILURE
```

而不是只有 `done=true`。

## UI 中央：Hazard Viewer

每一秒顯示：

```text
Goal achieved   0.08
Timeout         0.04
Tool failure    0.11
Safety veto     0.03
User interrupt  0.01
Planner replan  0.09

Survival to next event = 0.64
```

使用者改變：

```text
Tool reliability: 98% → 70%
```

畫面看到 `TOOL_FAILURE hazard` 上升。

## UI 右側：Event DAG

```text
Search#12
  ↓ observes
Page#41
  ↓ triggers
Read#7 ─────────┐
                ↓
MemoryWrite#9 → PlannerReplan#3
                ↓ cancels
ResearchOption#4
```

讓使用者切換：

```text
Wall-clock view
Logical-clock view
Causal-availability view
```

## 底部：OPE Integrity Panel

```text
Option support          PASS
Concurrency support     WARN
Termination cause       PASS
Censoring model         WARN
Scheduler propensity    UNKNOWN

Concurrent Option OPE:
NOT POINT IDENTIFIED

Reason:
Scheduler propensity not logged
```

這個模擬可以非常直觀地說明：

> 「AI 同時做很多事」不是畫幾條平行進度條而已；要做可信 counterfactual analysis，必須知道誰先看到哪個事件、誰讓誰停止、以及哪些終止其實只是觀察被截斷。

---

# 六、Code / GitHub

## A. LGAI-Research/acac

Repo:
https://github.com/LGAI-Research/acac

值得繼續看的目錄：

```text
acac/acac_marl/algs/
├ acac.py
├ acac_micro_gae.py
└ acac_vanilla.py

acac/acac_marl/cores/acac/
├ controller.py
├ envs_runner.py
├ learner_acac.py
├ learner_acac_micro_gae.py
├ memory.py
├ models.py
└ transformer_model.py
```

### 已確認原始碼行為

`envs_runner.py`：

```text
action = info['cur_mac']
valid = info['mac_done']
```

runner 為每個 agent 維護：

```text
accu_rewards
mac_act_step
last_mac_start
last_valid
```

macro-action 未完成時持續增加 `mac_act_step` 並折扣累積 reward。

這是很好的 duration-aware execution foundation，但 production Agent 應擴充：

```text
mac_done
→ termination_event
→ cause
→ actor
→ parent event
→ censoring flag
→ concurrent option set
```

## B. ToMacVF

Paper:
https://arxiv.org/abs/2507.10251

目前本輪未確認到作者官方 GitHub repo，因此只把 paper architecture 當研究來源，不宣稱存在可直接移植的正式 codebase。

值得借用的架構概念：

```text
Mac-JERT endpoint buffer
↓
Mac-SJERT segmented execution trace
```

Hermes 對應：

```text
Option-end-only logs
↓
OptionSegmentedEventTrace
```

---

# 七、Papers

## Paper 1

**Title**: ToMacVF: Temporal Macro-Action Value Factorization for Asynchronous Multi-Agent Reinforcement Learning  
**Authors**: Wenjing Zhang, Wei Zhang  
**Institution**: Harbin Institute of Technology  
**Year**: 2025 / online 2026  
**URL**: https://arxiv.org/abs/2507.10251  
**Code**: 本輪未確認官方 repo  
**Datasets/Benchmarks**: BoxPushing, Overcooked, WareHouse  
**Architecture**: Mac-SJERT + To-Mac-IGM + ATPG + micro/macro TD  
**Contribution**: 保留 macro-action 執行中的 temporal information，改善非同步 temporal credit assignment。  
**Limitation**: 不處理 production Agent termination taxonomy、censoring provenance、tool/MCP cancellation semantics。

## Paper 2

**Title**: Agent-Centric Actor-Critic for Asynchronous Multi-Agent Reinforcement Learning  
**Authors**: Whiyoung Jung, Sunghoon Hong, Deunsol Yoon, Kanghoon Lee, Woohyung Lim  
**Institution**: LG AI Research  
**Year**: 2025  
**URL**: https://proceedings.mlr.press/v267/jung25a.html  
**Code**: https://github.com/LGAI-Research/acac  
**Architecture**: agent-centric encoders + attention centralized critic + asynchronous PPO/GAE  
**Contribution**: 避免 padding 導致 experience misalignment / spurious correlation。  
**Limitation**: termination 在工程 log 中仍偏向 done-mask semantics。

## Paper 3

**Title**: Off-Policy Evaluation and Learning for Survival Outcomes under Censoring  
**Authors**: Kohsuke Kubota, Mitsuhiro Takahashi, Yuta Saito  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2603.22900  
**Architecture**: IPCW-IPS / IPCW-DR  
**Contribution**: 對受 censoring 的 survival outcome 做 OPE/OPL，避免 naive OPE 把 censored follow-up 當完整 outcome。  
**Limitation**: 原問題並非 LLM Agent option runtime，需要重新定義 Agent-specific censoring process。

---

# 八、已確認事實 / 論文結果 / 工程實作 / 推論 / 假說分層

## 已確認事實

- ACAC 官方 code 存在，並以 agent-centric asynchronous architecture 實作。
- `envs_runner.py` 讀取 `cur_mac` 與 `mac_done`，並累積 macro-action duration / discounted reward。
- ToMacVF 論文提出 Mac-SJERT，以避免只取 macro-action endpoint 導致 temporal information loss。

## 論文結果

- ACAC 報告其 agent-centric、不 padding 架構在非同步 MARL benchmark 加速 convergence 並改善 performance。
- ToMacVF 報告 segmented macro-action replay + temporal value factorization 優於非同步 baselines。
- 2026 censoring-aware OPE 顯示 IPCW-based estimator 可處理右設限 survival outcomes；IPCW-DR 提供 doubly robust 性質。

## 工程實作

- ACAC：`envs_runner.py`、`learner_acac.py`、`memory.py` 是目前最值得 Hermes 參考的 execution / replay / credit 路徑。

## 合理推論

- 對 production Agent，termination cause 應該成為 first-class runtime event，而不是只存 boolean done。
- `OptionSegmentedEventTrace` 比只有 option start/end 更適合進行稽核與 counterfactual analysis。
- Event DAG 比 global timestep 更適合多工具、多 Agent、多背景任務的 causally ordered execution。

## 尚未驗證假說

- Generic LLM Agent 的 concurrent-option trajectory 是否可用 factorized cause-specific hazard + hierarchical propensity 得到實用且低偏差的 OPE。
- 如何在 highly semantic option boundaries 下穩健估 scheduler propensity。
- competing-risk survival representation 是否能成為跨 Agent framework 通用 termination IR。

---

# 九、Unknown / Open Questions

## 1. Termination hazard 是否能與 LLM policy probability 分開估？

同一 LLM 可能同時決定：

```text
下一個 tool action
以及
是否結束 option
```

因此 action policy 與 termination policy 很可能共享 hidden state。若硬拆兩個獨立模型，會不會產生錯誤 factorization？

## 2. Planner replan 是 termination 還是 option continuation？

例如 Research option 內部換搜尋策略：

```text
Google → Scholar
```

可能是：

```text
同一 option 的 internal replanning
```

也可能是：

```text
舊 option terminated by REPLAN
→ 新 option initiated
```

這會直接改變 OPE statistical unit。

## 3. Concurrent options 的 counterfactual interference 如何識別？

Memory compaction、safety monitor、research、browser runtime 可以互相影響。這不只是 multi-agent，而是 **同一 Agent 內部多個 concurrent controllers 的 interference**。

---

# 十、Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Termination Cause
Cause-Specific Termination Hazard
Overall Termination Hazard
Termination Cumulative Incidence
Option Survival Function
Option Censoring
Censoring Mechanism
Censoring Propensity
OptionObservationStatus
OptionSegmentedEventTrace
AsyncEventDAG
Causal Availability Time
Concurrent Option Set
ConcurrentOptionPropensity
Scheduler Propensity
Preemption Propensity
Resume Propensity
Cancellation Propensity
TerminationCauseCredit
Duration Credit
Censoring-Aware OPE
IPCW Option Evaluation
Concurrent Option OPE
Termination IR
```

## 新 Edges

```text
Option Done
≠ Termination Semantics Known

Same Duration
≠ Same Termination Mechanism

Log End
≠ Option Termination

Censored Option
≠ Failed Option

Termination Probability
≠ Cause-Specific Termination Probability

Same Timestamp
≠ Same Causal Availability

Concurrent Option Execution
→ Creates Interference

Endpoint-Only Replay
→ Can Lose Temporal Credit Information

Segmented Event Trace
→ Preserves Internal Option Dynamics

Safety Veto
→ Termination Cause

Planner Replan
→ May Be Termination Cause

Context Exhaustion
→ May Be Censoring Or Termination

Missing Scheduler Propensity
→ Blocks Exact Concurrent-Option OPE
```

---

# 十一、下一輪研究

本輪之後最自然的下一層不是繼續增加 termination cause 名稱，而是：

# **Causal Event Sourcing × Happens-Before Clocks × Replay Determinism × Counterfactual Scheduler**

下一輪要解：

```text
Concurrent options
↓
Async events
↓
Event DAG
↓
logical clock / vector clock
↓
state writes / tool side effects
↓
replay
↓
Can the execution be deterministically reproduced?
↓
Counterfactual scheduler
↓
What if event ordering changed?
```

核心問題：

> 如果兩個事件的 wall-clock timestamp 很接近，但實際 causal order 不同，Hermes 能否重播出同一 execution？如果不能，就無法可靠判斷「換 scheduler / priority / concurrency policy」的反事實效果。

下一輪優先研究：

1. event sourcing / deterministic replay 在 distributed systems 與 Agent runtime 的接口；
2. Lamport clock / vector clock / happens-before 如何映射到 tool/MCP/agent events；
3. side-effectful tools 如何做 replay barrier / idempotency key；
4. concurrent schedule OPE / causal interference；
5. browser/computer agent 的 nondeterministic environment replay。

---

# 十二、本輪結束回答

**缺哪一層？**  
目前最缺的是 **Causal Event Ordering + Replay Semantics Layer**。Termination taxonomy 已開始成形，但若沒有可靠 happens-before / side-effect lineage，就很難做 concurrent option 的 counterfactual evaluation。

**哪個節點最淺？**  
`ConcurrentOptionPropensity`、`SchedulerPropensity`、`CounterfactualOptionTermination`、`AgentCompetingRiskModel`。

**哪個概念仍只是名詞？**  
production 級通用的 `Concurrent Option OPE` 目前仍主要是研究架構，不是成熟通用方法。

**哪個系統值得讀原始碼？**  
`LGAI-Research/acac`：優先順序為 `envs_runner.py → learner_acac.py → memory.py → controller.py → transformer_model.py`。

**哪篇論文需追引用？**  
第一優先 `ToMacVF`，因為它直接挑戰 endpoint-only asynchronous replay；第二優先 ACAC；第三優先 2026 censoring-aware OPE。

**哪個概念最適合視覺模擬？**  
`Async Option Hazard × Event DAG Lab`。

**哪個 Agent 架構最值得實作？**  

```text
EventTimeLedger
↓
AsyncEventDAG
↓
OptionSegmentedEventTrace
↓
Cause-Specific Termination Runtime
↓
Censoring Auditor
↓
Concurrent Option Propensity Ledger
↓
Semi-Markov Transition Builder
↓
Concurrent Option OPE Router
```

---

# 十三、對「AI 到底怎麼運作」新增的一層

目前完整鏈開始變成：

```text
User says something
↓
UI event
↓
Agent context
↓
Reasoning / planning
↓
Option initiation
↓
Concurrent scheduler
↓
Tool / MCP / browser / memory events
↓
Async Event DAG
↓
Internal option state
↓
Cause-specific termination hazards
↓
Termination OR censoring
↓
Semi-Markov transition
↓
Credit / OPE / memory update
↓
Next plan
↓
Model inference / GPU
↓
Output / action
```

多模態則是：

```text
Camera / Image / Voice / Video
↓
Encoder
↓
Tokens / latent representation
↓
Fusion
↓
Reasoning
↓
Option initiation
↓
Concurrent multimodal/tool execution
↓
Event DAG
↓
Termination / censoring
↓
Action
```

**本輪最核心的一句話：**

> AI Agent 的「做完了」不是一個 boolean。真正可驗證的 Agent runtime 必須知道：這個 option 為什麼結束、是誰讓它結束、結束前發生了哪些並行事件、哪些結果只是因為觀察被截斷而未知，以及如果 scheduler 或 termination policy 改變，歷史 execution 是否仍可拿來做合法的 counterfactual evaluation。
