# 【AI Agent × Multimodal Research Report】

**時間：2026-09-10 15:52 Asia/Taipei**

**本輪主題：Partial Observability × Belief State × Epistemic Control × Stochastic Transition × Causal World Model**

## 與歷史研究的差異

上一輪已建立 `Production Snapshot → Counterfactual Branch → Tool Effect Model → Transition → Branch-Specific Observation`，解決 Shadow Agent 分支後不能再共用 production observation 的問題。本輪往下一層：即使 branch-local Digital Twin 存在，Agent 仍通常看不到完整 world state。Camera 只看到視野內物件，Browser 只看到當前 DOM，MCP 只暴露查詢結果，Tool timeout 也不能直接證明「操作失敗」。因此真正的 Agent runtime 不應把 Observation 當 State，而需要顯式維護 `Belief State`，並決定何時應該「再查證一次」而不是立刻做不可逆行動。

核心問題從：

```text
Action
→ Environment Transition
→ Observation
```

升級為：

```text
Hidden True State s_t
↓
Observation Model O(o_t | s_t, a_{t-1})
↓
Observation o_t
↓
Belief Update b_t
↓
Planning under uncertainty
↓
Information-Gathering / Task Action
↓
Transition Model T(s_{t+1} | s_t, a_t)
```

本輪因此補上 Digital Twin 到真正「Agent 怎麼知道世界」之間缺失的 inference layer。

---

## 本小時新發現

### 1. Belief Memory: Agent Memory Under Partial Observability
- **Title:** Belief Memory: Agent Memory Under Partial Observability
- **Authors:** Junfeng Liao, Qizhou Wang, Jianing Zhu, Bo Du, Rui Yan, Xiuying Chen
- **Institutions:** MBZUAI, RIKEN AIP, UT Austin, Wuhan University
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.05583
- **Code:** 論文頁目前未提供官方 GitHub implementation；需持續追蹤
- **Datasets / Benchmarks:** LoCoMo, ALFWorld
- **Architecture:** Attribute-level probabilistic memory；每個 attribute 保留多個 candidate conclusions 與概率；新 evidence 透過 Add / Merge 與 noisy-OR 更新；retrieval 回傳整個 belief，而不是單一 top-1 conclusion。
- **Contribution:** 把 Agent memory 從 deterministic fact store 改成 belief approximation。論文把 POMDP belief state定義為 `b_t(s)=P(s_t=s | observation/action history)`，並指出 external memory 可視為對不可直接維護的完整 posterior 的近似。
- **Limitations:** 作者明確承認 noisy-OR 並非完整 normalized posterior，沒有形式 convergence guarantee；evidence strength 由 LLM 抽取，因此存在 calibration error；維護多候選也增加寫入/合併成本。
- **改變了什麼:** Memory 不再代表「世界是真的如此」，而代表「基於目前證據，世界可能如此，且每個假說有不同 confidence」。

### 2. PABU: Progress-Aware Belief Update for Efficient LLM Agents
- **Title:** PABU: Progress-Aware Belief Update for Efficient LLM Agents
- **Authors:** Haitao Jiang, Lin Ge, Hengrui Cai, Rui Song
- **Institutions:** North Carolina State University; Amazon; University of California Irvine
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2602.09138
- **Code:** https://github.com/Hunter-Jiang/Progress-Aware-Belief-Update
- **Benchmark:** AgentGym eight environments: Maze, Wordle, ALFWorld, SciWorld, BabyAI, TextCraft, Weather, Movie
- **Architecture:** 預測 task progress，並透過 learned retention policy 決定 action-observation 是否保留，未來 policy 僅條件化在保留的 compact history/belief representation。
- **Reported result:** 在其 AgentGym 設定中 81.0% average task completion、9.5 average steps；作者報告相對其選定 prior SoTA 為 +23.9% success 與 -26.9% interaction steps。這些數字僅適用於論文指定 benchmark/configuration。
- **改變了什麼:** 表明 partial-observability state estimator 不一定要保存所有歷史；state relevance / task progress 本身也可成為 belief compression signal。

### 3. Active Epistemic Control for Query-Efficient Verified Planning
- **Title:** Active Epistemic Control for Query-Efficient Verified Planning
- **Author:** Shuhui Qu
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2602.03974
- **Benchmarks:** ALFWorld, ScienceWorld
- **Architecture:** 嚴格分離 `grounded fact store` 與 `belief store`。belief 可用於 pruning candidate plans；當 unresolved predicate uncertainty 高或 prediction ambiguous 時，Agent 主動 query environment；最終 commitment 則需要 grounded precondition coverage。
- **Contribution:** 把「資訊蒐集 action」升級成 planner 的一級 action，而不是失敗後才補查資料。
- **改變了什麼:** 對 Hermes 最重要的安全原則是：**Prediction/Belief 可以幫助節省查詢與縮小搜尋空間，但不能直接替高風險 effect 證明可執行性。**

### 4. PO-PDDL: Learning Symbolic POMDPs from Visual Demonstrations for Robot Planning Under Uncertainty
- **Title:** PO-PDDL: Learning Symbolic POMDPs from Visual Demonstrations for Robot Planning Under Uncertainty
- **Authors:** Wenjing Tang, Xuanjin Jin, Yuan Liu, Renming Huang, Cewu Lu, Panpan Cai
- **Institutions:** Shanghai Jiao Tong University; Shanghai Innovation Institute
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2606.15654
- **Architecture:** 從 real-robot execution videos 重建 latent symbolic state trajectory；透過 inferred states 與 visual observations 的不一致辨識 partial observability，再學 stochastic transition / observation models；輸出可供 online belief-space planning 的 PO-PDDL domain。
- **Contribution:** 將 Camera/Image/Video perception 與 symbolic POMDP planning 接起來，直接對應 Hermes 多模態世界模型需要的 `Visual Observation → Symbolic Belief → Planning`。
- **Limitations:** Symbolic abstraction 的 correctness 依賴 visual-to-symbolic inference；稀有 stochastic outcome 與長尾 perception error 仍難從 demonstration 覆蓋。

### 5. A Unifying Perspective on Causal World Models: From Observations to Representations to Structure
- **Title:** A Unifying Perspective on Causal World Models: From Observations to Representations to Structure
- **Authors:** Avinash Kori, Fabrizio Russo
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2608.13456
- **Status:** accepted at Causality in Decision Making workshop at UAI 2026
- **Architecture / Thesis:** 有用的 world model 不應只生成 plausible future，而需要表示 entity properties、entity-entity interactions、entity-environment interactions，以及可支援 intervention/counterfactual reasoning 的 causal structure；並特別討論 identifiability。
- **改變了什麼:** 將上一輪 Digital Twin 的 `T(s,a)→s'` 推進成 `SCM / causal transition structure`：Agent 必須區分 correlation-based prediction 與 intervention effect。

---

## 本小時最重要 5 個發現

### 發現 1：Observation ≠ State；Memory 也不應假裝自己是 State

已確認理論：POMDP 中 Agent 不直接看到 latent state `s_t`，而收到 observation `o_t`。在標準形式中：

```text
s_t ∈ S                 hidden state
 a_t ∈ A                action
 o_t ∈ O                observation
T(s'|s,a)               transition model
Z(o|s',a)               observation model
b_t(s)=P(s_t=s|history) belief state
```

因此 Agent runtime 真正的資訊流程不應是：

```text
ToolResult
→ Memory Fact
→ Planner
```

而應是：

```text
ToolResult / Camera / DOM / MCP response
↓
Observation Envelope
├ provenance
├ timestamp
├ source reliability
├ visibility scope
├ negative-evidence meaning
└ noise model
↓
Belief Updater
↓
Candidate Hidden States / Hypotheses
↓
Planner
```

例如：

```text
Observation:
GET /service → timeout
```

不能直接寫成：

```text
FACT: service is down
```

更合理是：

```text
H1 service down      0.45
H2 network degraded  0.30
H3 rate limited      0.15
H4 client bug        0.10
```

新的 observation 再更新 posterior。

**為什麼重要：** deterministic memory 會把暫時 observation 固化成「真相」，後續 Agent action 又基於這個錯誤真相，形成 self-reinforcing error。BeliefMem 2026 正面驗證這一問題，並以 probabilistic candidate memory 改善 ALFWorld / LoCoMo 表現。

**限制：** 真實 open-world Agent 幾乎不可能枚舉完整 hidden-state space，所以 Hermes 需要 sparse hypothesis / factorized belief，而非教科書式完整 distribution。

來源：https://arxiv.org/abs/2605.05583 ; POMDP 經典理論由 Kaelbling, Littman, Cassandra 1998 建立。

---

### 發現 2：Belief Update 的底層是 Predict → Observe → Correct，而不是 Summarize History

標準 Bayes filter 可以拆成兩段。

#### Prediction

Agent 執行 action `a_{t-1}` 後，尚未看到新 observation 前：

```text
b^-_t(s')
=
Σ_s T(s' | s, a_{t-1}) b_{t-1}(s)
```

這一步回答：

> 依照上一刻 belief 和我剛做的 action，現在世界可能變成什麼？

#### Correction

收到 `o_t` 後：

```text
b_t(s')
=
η Z(o_t | s', a_{t-1}) b^-_t(s')
```

其中 `η` 是 normalization constant。

完整 runtime flow：

```text
Prior Belief b_{t-1}
↓
Action a_{t-1}
↓
Transition Prediction T
↓
Predicted Belief b^-_t
↓
Observation o_t
↓
Observation Likelihood Z
↓
Bayes Correction
↓
Posterior Belief b_t
```

這和一般 Agent context summarization 完全不同：

```text
Summary = 壓縮文字
Belief = 對 hidden state 的估計
```

PABU 提供一條實用近似：以 task progress 與 learned retention 選擇重要 interaction，避免把 full history 當 latent state proxy。BeliefMem 則走另一條近似：保留 candidate conclusions + probabilities，使用 noisy-OR evidence merge。兩者都不是 exact Bayesian filter，但都在解決同一件事：**history 不等於 state。**

**Hermes 推論：** 未來 Belief Runtime 應同時支援三種 estimator：

```text
Exact / Symbolic Bayesian
Approximate Probabilistic
Language Belief / Hypothesis Set
```

這是工程設計推論，尚非既有標準。

來源：https://arxiv.org/abs/2605.05583 ; https://arxiv.org/abs/2602.09138

---

### 發現 3：Agent 必須有 Epistemic Action；「查一下」本身就是 Action

一般 Agent planner 常只優化 task action：

```text
open_door
send_email
edit_file
merge_pr
```

但 partial observability 下還存在另一類 action：

```text
look_again
query_status
list_files
inspect_permission
read_current_version
ask_user
run_diagnostic
probe_environment
```

它們不直接完成 goal，而是降低 uncertainty。

因此 action space 必須拆成：

```text
A = A_task ∪ A_epistemic
```

Hermes 可以建立簡化 Value of Information：

```text
VOI(query)
≈
ExpectedDecisionLossBefore
-
ExpectedDecisionLossAfter
-
QueryCost
-
LatencyCost
```

當：

```text
VOI > 0
```

先查證。

Active Epistemic Control 的設計很適合 Hermes：

```text
Belief Store
→ candidate pruning

Grounded Fact Store
→ commitment authorization
```

例如：

```text
Belief:
file probably unused = 0.87
```

可以讓 Agent 優先研究刪除方案，但：

```text
DELETE FILE
```

之前仍應重新確認：存在性、version、ownership、references、permission、current branch state。

因此新增原則：

```text
Belief-Supported Planning
≠
Belief-Authorized Effect
```

**為什麼重要：** 這直接把本輪接回前幾輪的 `Effect Gate / Capability Epoch / Winner Commit / Shadow Runtime`。

來源：https://arxiv.org/abs/2602.03974

---

### 發現 4：Exogenous Event 必須進 Belief Update，否則 Digital Twin 會過度自信

上一輪 transition contract 是：

```text
T(s, a, ξ) → (s', o, provenance, confidence)
```

本輪確認 `ξ` 不只是 simulation noise，而是 partial-observability inference 的必要變數。

例如 Agent：

```text
Read file version 41
↓
Reason 20 seconds
↓
Prepare update based on v41
```

這 20 秒內：

```text
Other user edits → version 42
```

這不是 Agent action 的結果，而是 exogenous event。

如果 runtime 只有：

```text
State + My Action → Next State
```

就會得到錯誤 certainty。

更合理：

```text
S_t
+
A_t
+
ξ_t
→
S_{t+1}
```

Agent 無法直接看到 `ξ_t`，只能從後續 observation 反推。

所以 Hermes 應新增：

```text
BeliefState
├ hypotheses
├ probability/confidence
├ evidence links
├ last_grounded_at
├ staleness
├ volatility class
└ exogenous-risk model
```

對高 volatility entity：

```text
GitHub branch HEAD
calendar availability
live browser DOM
permission state
rate limit
MCP session
```

belief decay 應更快；對低 volatility entity：

```text
static document ID
model architecture
immutable artifact hash
```

belief decay 可較慢。

這裡的 time/volatility-based decay 是 **Hermes 工程假說**，需要後續 production trace 校準。

---

### 發現 5：Causal World Model ≠ Predictive World Model

Predictive model 問：

```text
P(next state | observed history)
```

Causal model更關心：

```text
What happens if I intervene with do(A=a)?
```

這在 Agent tool use 很重要。

例如 observational history 顯示：

```text
High CPU
↔
Failed tool calls
```

不能直接推論：

```text
Restart CPU-heavy service
→ tool calls recover
```

因為可能有共同原因：

```text
Network outage
├ causes retries → High CPU
└ causes tool failure
```

Causal representation應更接近：

```text
ξ_network ──→ NetworkState ──→ ToolSuccess
        └────────────────────→ RetryLoad ──→ CPU

AgentAction(restart)
→ ServiceState
→ ? ToolSuccess
```

這就是上一輪 counterfactual simulator 下一步必須補的結構。

2026《A Unifying Perspective on Causal World Models》明確主張 world models 應超越 generative prediction，捕捉 entity properties 與 interaction structure，並把 identifiability 視為核心限制。

因此 Hermes 應區分：

```text
Predictive Confidence
Causal Confidence
Observation Confidence
Grounding Confidence
```

**尚未驗證假說：** production Agent 可以用 hybrid SCM + learned transition model；symbolic/tool domains 優先 SCM，pixel/video domains 優先 latent predictive model，再以 object/event extraction bridge 到 causal layer。

來源：https://arxiv.org/abs/2608.13456

---

# Architecture Breakdown

本輪建立 Hermes **Belief-State Agent Runtime**：

```text
User / Camera / Image / Voice / Browser / MCP / Tool
↓
Observation Ingestion Layer
├ timestamp
├ source
├ modality
├ provenance
├ confidence
├ visibility scope
└ raw artifact ref
↓
Observation Model
├ symbolic parser
├ VLM perception
├ ASR/audio event
├ API/tool semantics
└ sensor noise model
↓
Grounded Fact Store ─────────────────────┐
                                        │
Belief Engine                           │
├ hypothesis generation                 │
├ transition prediction                 │
├ evidence likelihood                   │
├ contradiction handling                │
├ confidence update                     │
├ decay / staleness                     │
└ alternative retention                 │
↓                                       │
Belief State b_t                        │
↓                                       │
Uncertainty Analyzer                    │
├ entropy / ambiguity                   │
├ missing preconditions                 │
├ stale facts                           │
└ exogenous risk                        │
↓                                       │
Epistemic Controller                    │
├ QUERY                                 │
├ INSPECT                               │
├ SIMULATE                              │
├ ASK                                   │
└ PROCEED                               │
↓                                       │
Planner                                 │
↓                                       │
Candidate Action                        │
↓                                       │
Commitment Grounding Gate ◄─────────────┘
├ grounded preconditions?
├ capability valid?
├ state fresh enough?
├ effect reversible?
└ uncertainty below risk threshold?
↓
Tool / MCP / Browser / Robot Action
↓
New Observation
↓
Belief Update Loop
```

這把之前的 Agent Loop：

```text
Intent
→ Tool Schema
→ Tool Selection
→ Arguments
→ Execution
→ Observation
→ Context
→ Next Decision
```

升級成：

```text
Intent
→ Current Belief
→ Missing Preconditions
→ Epistemic/Task Action Selection
→ Tool Schema
→ Arguments
→ Execution
→ Observation
→ Observation Likelihood
→ Belief Update
→ Grounding Check
→ Next Decision
```

---

# Bottom-Level Logic

## 1. POMDP Belief Filter

最底層機制：

```text
Prior b_{t-1}
↓
Transition prediction using T
↓
Predicted prior b^-_t
↓
Receive observation o_t
↓
Likelihood Z(o_t | state)
↓
Normalize
↓
Posterior b_t
```

對離散 state：

```text
b^-_t(s') = Σ_s T(s'|s,a_{t-1}) b_{t-1}(s)

b_t(s') = η Z(o_t|s',a_{t-1}) b^-_t(s')
```

## 2. Open-World Agent 的 Sparse Belief Approximation

完整 posterior 幾乎不可行，因此 Hermes 可以實作：

```text
BeliefAttribute
├ attribute_id
├ candidates[]
│  ├ hypothesis
│  ├ confidence
│  ├ evidence_ids[]
│  ├ contradictions[]
│  └ last_updated
├ unknown_mass
└ volatility
```

`unknown_mass` 非常重要，避免候選 probabilities 看似總和 1.0 而製造假 certainty。

例如：

```text
location(object-X)
├ room-A 0.45
├ room-B 0.25
├ inventory 0.10
└ UNKNOWN 0.20
```

## 3. Multimodal Observation Update

```text
Camera Frame
↓
Vision Encoder / VLM
↓
Object/Event Hypotheses
├ cup on table 0.78
├ cup in hand 0.17
└ occluded/unknown 0.05
↓
Temporal Association
↓
Existing World Entity
↓
Belief Update
```

Audio：

```text
Waveform
→ VAD
→ ASR / Audio Event Model
→ transcript/event hypotheses
→ speaker/source confidence
→ belief evidence
```

Browser：

```text
DOM / Screenshot
→ UI element extraction
→ entity/state hypotheses
→ stale-page / hidden-state risk
→ belief evidence
```

因此：

```text
Multimodal Encoder Output
≠
Ground Truth
```

Encoder/VLM output 應進 evidence layer，而不是直接覆寫 canonical world state。

---

# Visual Simulation Idea

## **Belief State & Epistemic Action Simulator**

主畫面分三層：

```text
TRUE WORLD（教學模式可見，Agent 模式隱藏）
┌─────────────────────────┐
│ Object X actually Room B │
└─────────────────────────┘
              ↓ noisy/partial observations
OBSERVATION STREAM
Camera: "maybe Room A"
MCP: "last seen Room B"
Tool: timeout
              ↓
BELIEF BRAIN
Room A     ███████ 0.45
Room B     ████    0.35
Unknown    ██      0.20
              ↓
ACTION POLICY
[Proceed] [Inspect] [Query] [Simulate] [Ask]
```

互動控制：

```text
Observation Noise
Sensor Coverage
World Volatility
Exogenous Event Rate
Query Cost
Effect Risk
Belief Threshold
Memory Decay
```

故障注入：

```text
FALSE NEGATIVE CAMERA
STALE MCP RESULT
TOOL TIMEOUT
OTHER AGENT CHANGES STATE
OBJECT OCCLUDED
ASR MISHEAR
CONTRADICTORY OBSERVATION
```

最值得做的動畫：

```text
Observation 1:
API timeout

Deterministic Memory:
SERVICE_DOWN = TRUE
→ restart immediately

Belief Runtime:
service_down     .45
network_issue    .30
rate_limit       .15
unknown          .10
↓
Query status endpoint
↓
Observation 2 = healthy
↓
service_down     .08
network_issue    .58
...
```

再切到高風險 action：

```text
DELETE / MERGE / SEND
```

UI 顯示：

```text
Belief confidence: 0.88
Grounded precondition coverage: 0.55

COMMIT BLOCKED
Reason: belief is not authorization
```

這個 simulator 可以直接解釋：**AI 看見的世界，與真實世界不是同一件事。**

---

# Code / GitHub

本輪深入追讀：

## Hunter-Jiang/Progress-Aware-Belief-Update
https://github.com/Hunter-Jiang/Progress-Aware-Belief-Update

根目錄值得看：

```text
agentenvs/
evaluation_split/
scripts/
src/
requirements.txt
```

`src/` 目前核心檔案：

```text
src/
├ PABU_evaluation.py
├ PABU_training.py
├ utils.py
└ utils_agentenv.py
```

`PABU_evaluation.py` 實際把多個 AgentGym environment client 接入同一 evaluation loop，包括：

```text
AlfWorldEnvClient
SciworldEnvClient
MazeEnvClient
WordleEnvClient
TextCraftEnvClient
BabyAIEnvClient
MovieEnvClient
WeatherEnvClient
```

它以每個 environment 最新 history content 建 dataset/batch，模型 generate 下一步 action，再透過 host env `.step(pred_iter)` 回傳新 environment state/observation。這個 runtime 結構很值得 Hermes 借鏡，因為它明確具備：

```text
Environment Host
→ Observation / History
→ Model Batch
→ Action Generation
→ Environment Step
→ New Observation
```

但 Hermes 要再補：

```text
Observation
→ Belief Engine
→ Uncertainty
→ Epistemic Action
```

而不是直接讓 history text 成為 model state。

值得下一步繼續讀：

```text
src/PABU_training.py
src/utils_agentenv.py
```

尤其 `utils_agentenv.py` 體量最大，應繼續追各 environment connector 如何組 prompt/history，以及 update/retention semantics 實際落在哪裡。

---

# Papers

1. **Belief Memory: Agent Memory Under Partial Observability** — Liao et al., 2026. MBZUAI / RIKEN AIP / UT Austin / Wuhan University. https://arxiv.org/abs/2605.05583
2. **PABU: Progress-Aware Belief Update for Efficient LLM Agents** — Jiang, Ge, Cai, Song, 2026. NCSU / Amazon / UCI. https://arxiv.org/abs/2602.09138 ; Code: https://github.com/Hunter-Jiang/Progress-Aware-Belief-Update
3. **Active Epistemic Control for Query-Efficient Verified Planning** — Shuhui Qu, 2026. https://arxiv.org/abs/2602.03974
4. **PO-PDDL: Learning Symbolic POMDPs from Visual Demonstrations for Robot Planning Under Uncertainty** — Tang et al., 2026. Shanghai Jiao Tong University / Shanghai Innovation Institute. https://arxiv.org/abs/2606.15654
5. **A Unifying Perspective on Causal World Models: From Observations to Representations to Structure** — Kori & Russo, 2026. https://arxiv.org/abs/2608.13456
6. **Planning and Acting in Partially Observable Stochastic Domains** — Kaelbling, Littman, Cassandra, 1998. 經典 POMDP / belief-state 基礎，需下一輪再追其後續 point-based / online POMDP planning citations。

---

# 已確認事實 / 工程推論 / 未驗證假說

### 已確認事實
- POMDP belief state 是 hidden state conditioned on action-observation history 的 posterior representation。
- BeliefMem 以 candidate conclusions + probabilities 取代 deterministic memory entry，並以 noisy-OR merge evidence；作者明確指出它不是完整 posterior 且無 formal convergence guarantee。
- PABU 使用 progress prediction + selective retention 建立 compact state representation，並在 AgentGym 指定實驗報告 81.0% average completion 與 9.5 steps。
- Active Epistemic Control 明確區隔 grounded facts 與 model beliefs，final commitment 需要 grounded precondition coverage。
- PO-PDDL 將 visual demonstrations 映射到可處理 partial observability/stochastic transition 的 symbolic POMDP representation。

### 合理工程推論
- Hermes 應將 Observation 存為 evidence，不應直接覆寫 world fact。
- 高 volatility state 應具有更快 belief staleness/decay。
- `unknown_mass` 應成為 sparse open-world belief 的一級欄位。
- 高風險 external effect 應依 grounded precondition coverage，而非只依 top-1 belief confidence。

### 尚未驗證假說
- Hybrid `symbolic SCM + learned latent transition + sparse belief` 可以作為 Hermes 跨 software/multimodal domain 的 unified world-state abstraction。
- Belief confidence × effect risk 可以建立 production-ready automatic query/commit threshold；需要真實 trace 校準。
- VLM / ASR confidence 可以直接或經 calibration 後映射到 observation likelihood；目前不同模型 confidence 不一定是 calibrated probability。

---

# Unknown / Open Questions 1–3

1. **Open-world belief space 如何擴張？** 當 evidence 無法由既有 hypotheses 解釋時，何時生成新 hypothesis，而不是把 probability 硬塞進舊候選？
2. **LLM confidence 如何 calibration 成 observation likelihood？** 自然語言模型產生的 `0.8 confidence` 不能直接假定等價於 `P(o|s)=0.8`。
3. **多模態 belief 如何對齊同一 entity？** Camera object、DOM item、MCP record、spoken reference 可能其實是同一 world entity，需要 entity resolution + temporal identity tracking 才能合併 evidence。

---

# 下一輪研究

最大的缺口現在變成：

## **Active Perception × Value of Information × Uncertainty Calibration × Information-Gain Planning**

下一輪應深入：

```text
Belief State b_t
↓
Candidate Questions / Sensor Actions / Tool Queries
↓
Expected Observation Distribution
↓
Expected Posterior b_{t+1}
↓
Entropy / Decision Loss Reduction
↓
Value of Information
↓
Query Cost + Latency + Risk
↓
Best Epistemic Action
```

並研究：
- entropy / mutual information / expected information gain
- active perception in robotics
- Bayesian experimental design
- conformal / calibration methods for VLM / LLM uncertainty
- selective prediction / abstention
- asking vs searching vs inspecting vs simulating 的 query policy
- multimodal sensor selection：Camera move、zoom、audio query、depth scan、browser inspect、MCP read

核心問題是：

> **如果 AI 不知道真相，它下一步應該查哪一個資訊，才能用最低成本消除最關鍵的不確定性？**

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Partial Observability
Latent World State
Observation Model
Observation Envelope
Belief State
Prior Belief
Predicted Belief
Posterior Belief
Bayes Filter
Sparse Belief
Unknown Probability Mass
Belief Memory
Belief Candidate
Evidence Likelihood
Contradictory Evidence
Belief Staleness
Volatility Class
Epistemic Action
Information-Gathering Action
Grounded Fact Store
Belief Store
Grounded Precondition Coverage
Value of Information
Exogenous Event
Stochastic Transition
Causal World Model
Structural Causal Model
Observation Confidence
Causal Confidence
Grounding Confidence
Entity Belief
Multimodal Evidence
```

## Edges

```text
Hidden World State
→ emits_through
Observation Model

Observation
→ updates
Belief State

Prior Belief
→ predicted_by
Transition Model

Predicted Belief
→ corrected_by
Observation Likelihood

Belief State
→ guides
Planner

Belief Uncertainty
→ motivates
Epistemic Action

Epistemic Action
→ acquires
Grounded Evidence

Grounded Evidence
→ updates
Grounded Fact Store

Grounded Fact Store
→ authorizes
High-Risk Commitment

Exogenous Event
→ changes
World State

Multimodal Encoder Output
→ contributes_evidence_to
Belief State

Causal World Model
→ supports
Intervention Reasoning
```

## 否定關係

```text
Observation ≠ World State
History ≠ Belief State
Summary ≠ Belief State
Memory Fact ≠ Ground Truth
Model Confidence ≠ Calibrated Probability
Predictive World Model ≠ Causal World Model
Belief-Supported Planning ≠ Belief-Authorized Effect
Multimodal Encoder Output ≠ Ground Truth
Counterfactual Prediction ≠ Grounded Fact
```

---

# 本輪收斂回答

- **缺哪一層：** Active Perception / Value-of-Information controller；目前 Belief Engine 知道「不確定」，但還沒有最佳化「該查什麼」。
- **哪個節點最淺：** `Observation Likelihood Calibration`，尤其是如何把 LLM/VLM/ASR 的 confidence 轉成可比較概率。
- **哪個概念仍只是名詞：** `Unified Multimodal Belief State ABI`、`Causal Confidence`、`Grounded Precondition Coverage` 的跨工具標準表示。
- **哪個系統值得讀原始碼：** `Hunter-Jiang/Progress-Aware-Belief-Update`，下一步優先 `src/utils_agentenv.py` 與 `src/PABU_training.py`；另外 PO-PDDL 若官方 code 完整公開，值得追其 visual-to-symbolic state reconstruction。
- **哪篇論文需追引用：** Kaelbling-Littman-Cassandra POMDP 1998 → online/point-based belief planning；BeliefMem 2026 → probabilistic agent memory；Active Epistemic Control 2026 → query-efficient grounding。
- **哪個概念最適合視覺模擬：** `Belief State & Epistemic Action Simulator`，能最直觀展示「AI 看到的不是世界，只是 evidence」。
- **哪個 Agent 架構最值得實作：**

> **Belief-Grounded Agent Runtime = Observation Ingestion + Belief Engine + Sparse Hypothesis Store + Uncertainty Analyzer + Epistemic Controller + Grounded Fact Store + Commitment Gate**

---

# 最終底層鏈補強

這輪把整體「AI 到底怎麼運作」補成：

```text
使用者對 AI 說一句話
↓
UI
↓
Agent Runtime
↓
Context / Memory
↓
Observation & Evidence
↓
Belief State（AI 認為世界可能是什麼）
↓
Reasoning
↓
Planning
↓
Epistemic Action / Task Action
↓
Tools / MCP / Browser / Computer
↓
Models
↓
Tokenizer / Embedding / Transformer / Attention / KV Cache
↓
GPU
↓
Observation / Output
↓
Belief Update
↓
Grounding / Commit
↓
使用者看到結果或真實世界被修改
```

多模態則補成：

```text
Camera / Image / Voice / Video / Depth
↓
Encoder / ASR / VLM / Sensor Model
↓
Perceptual Tokens / Features
↓
Observation Hypotheses
↓
Entity Resolution
↓
Multimodal Belief State
↓
Uncertainty
↓
Reasoning / Planning
↓
Active Perception or Action
↓
World Transition
↓
New Observation
```

本輪核心結論：**Agent 的 Memory 不應被理解為「AI 知道的事實清單」。在真實世界中，AI 多數時候只拿到局部、延遲、有噪聲、甚至互相矛盾的觀測；成熟的 Agent Runtime 必須把這些觀測保留成 evidence，維護對 hidden world state 的 belief，知道自己哪裡不確定，並在做高風險 Tool/MCP/Computer action 前主動取得足夠 grounded evidence。這才是從 Digital Twin 走向真正 World Understanding 的關鍵一層。**
