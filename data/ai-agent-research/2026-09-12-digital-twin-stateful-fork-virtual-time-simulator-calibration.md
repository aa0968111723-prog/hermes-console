# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-12 15:53（Asia/Taipei）

## 本輪研究主題
**Digital Twin Tool Runtime × Stateful Sandbox Fork × Database Branching × Browser Virtual Time × Simulator Calibration × Counterfactual World Confidence**

本輪承接上一輪的 `Replay World Boundary × Effect Virtualization`，刻意不再重複 HAR replay、strict egress、tool sandbox 等既有結論，而是處理上一輪尚未解決的核心問題：

> **如果 counterfactual Agent 做出 factual run 從未出現過的新 Tool / MCP / Browser action，舊 fixture 沒有 response，系統要如何產生一個可驗證、可分岔、可回滾、而且能表達不確定性的「新世界」？**

本輪答案逐步收斂為：Hermes 需要的不是單純 mock，而是 **Executable Digital Twin Runtime**。

---

# 本小時新發現

## 新論文 / 新架構

1. **DNative-Twin: Decision Graphs and Digital Twins for Reconstructable Agentic Decisions**（2026-09-03）
   - Authors: Junjie Pang, Zhenzhen Xie, Haoke Han, Ying He, Jing Wang, Gang Liu
   - Year: 2026
   - URL: https://arxiv.org/abs/2609.03787
   - Architecture: typed decision trajectory + synchronized digital twin + isolated replay + controlled condition comparison
   - 重要性：它直接指出 graph 能定位「已表示的變化」，但遇到 **unobserved tool state** 時，光靠圖結構仍無法判斷結果；加入 replay-contract state 與 verification evidence 後，unresolved-divergence recall 才提高。
   - 限制：偏 enterprise decision-process reconstruction，不等於完整 browser/network/tool world simulator。

2. **DeltaBox: Scaling Stateful AI Agents with Millisecond-Level Sandbox Checkpoint/Rollback**（2026-05-21）
   - Authors: Yunpeng Dong, Jingkai He, Yuze Hou, Dong Du, Zhonghu Xu, Si Yu, Yubin Xia, Haibo Chen
   - Institutions: Shanghai Jiao Tong University / Ministry of Education ERC / Huawei Technologies
   - Year: 2026
   - URL: https://arxiv.org/abs/2605.22781
   - GitHub: https://github.com/dongyunpeng-sjtu/deltabox
   - Architecture: `DeltaState → DeltaFS + DeltaCR → millisecond checkpoint/rollback`
   - Contribution: DeltaFS 以 layered writable state + copy-on-write 實作 filesystem delta checkpoint；DeltaCR 使用 incremental process dumps + frozen template process 加速 process rollback。
   - Reported result: checkpoint 約 14 ms、rollback 約 5 ms。
   - 限制：截至本輪，官方 repo 明確表示 kernel patch、userspace controller、benchmark scripts 尚未公開，因此目前不能做 source-code-level mechanism audit。

3. **Agent World Model: Infinity Synthetic Environments for Agentic Reinforcement Learning**（ICML 2026）
   - Authors: Zhaoyang Wang, Canwen Xu, Boyi Liu, Yite Wang, Siwei Han, Zhewei Yao, Huaxiu Yao, Yuxiong He
   - Institutions: Snowflake AI Research / UNC-Chapel Hill 等
   - Year: 2026
   - URL: https://arxiv.org/abs/2602.10090
   - Code: https://github.com/Snowflake-Labs/agent-world-model
   - Dataset: AgentWorldModel-1K
   - Architecture: executable synthetic environment generator + database-backed state + generated FastAPI/MCP tools + task/verifier pipeline
   - Contribution: 1,000 executable environments、平均約 35 tools/environment；code-driven、database-backed 的 state transition，比純 LLM 模擬環境更一致且可驗證。
   - Limitation: synthetic world 與真實 SaaS / browser / external API 的行為仍有 sim-to-real gap。

4. **Chrome DevTools Protocol Virtual Time**
   - Official docs: https://chromedevtools.github.io/devtools-protocol/tot/Emulation/
   - `Emulation.setVirtualTimePolicy` 可用 synthetic time source 取代 real-time，支援 `advance / pause / pauseIfNetworkFetchesPending`、virtual time budget、initial virtual time。
   - 這使 browser counterfactual 不必依賴 wall clock。

5. **Database Branching / Point-in-Time Fork**
   - Neon references:
     - https://neon.com/blog/time-travel-with-postgres
     - https://neon.com/blog/point-in-time-recovery-in-postgres
   - 核心機制：versioned storage + copy-on-write branch；可由 timestamp / LSN 建立 parent state 的 fork。
   - 對 Hermes 的意義：counterfactual branch 應直接 fork stateful DB，而非 export/import 全庫或共用 production DB。

---

# 本小時最重要 5 個發現

## 1. Recorded Replay ≠ Executable Digital Twin

### 是什麼
上一輪 Replay World 可以回答 factual run 中已經出現過的 request：

```text
request
→ fixture lookup
→ recorded response
```

但 counterfactual branch 可能做：

```text
factual:
list_orders()
→ cancel_order(17)

counterfactual:
list_orders()
→ change_address(17, "new address")
```

如果 `change_address()` 從未在 factual trace 出現，fixture 完全沒有答案。

### 底層如何運作
真正 Digital Twin 必須有：

```text
State S_t
+
Action A_t
+
Transition Function T
↓
S_{t+1} = T(S_t, A_t, ξ_t)
↓
Observation O_{t+1}
```

其中 `ξ_t` 是外生噪音 / stochastic environment state。

這就是 Agent World Model 比純 fixture 更重要的地方：它真的生成 **FastAPI/MCP + SQLite-backed executable environment**。

本輪直接檢查其 GitHub：

```text
awm/
├ core/
│  ├ agent.py
│  ├ db.py
│  ├ env.py
│  ├ pipeline.py
│  ├ reset.py
│  ├ scenario.py
│  ├ server.py
│  ├ spec.py
│  ├ task.py
│  ├ verifier.py
│  └ verify.py
├ tools.py
├ prompts.py
└ gpt.py
```

`awm/core/server.py` 實際會：

```text
scenario
↓
prepare database
↓
保存 initial.db
↓
將 generated environment code 綁定到指定 SQLite DB
↓
mount FastAPI MCP
↓
執行 environment
↓
保存 final.db
```

這不是 README-only 架構。

### 為什麼重要
Hermes 如果只做 replay cassette，最多只能研究「已發生過的路徑」。
Digital Twin 才能研究：

```text
如果 Agent 當時選另一個合法 action
世界接下來會發生什麼？
```

### 限制
Synthetic transition 並不保證與真實 API / browser backend 一致。

### 來源
- Agent World Model paper: https://arxiv.org/abs/2602.10090
- Source: https://github.com/Snowflake-Labs/agent-world-model

---

## 2. Counterfactual World 應該 Fork State，而不是 Clone Whole World

### 是什麼
若每一次 branching 都 full-copy：

```text
filesystem
+
process memory
+
database
+
browser profile
```

那 Tree-of-Thought / Shapley / multi-branch replay 很快就不可用。

### Bottom-level mechanism
DeltaBox 提出：

```text
DeltaState
├ DeltaFS
│  ├ freeze current writable layer
│  ├ insert fresh writable layer
│  ├ copy-on-write changes
│  └ rollback = layer switch
│
└ DeltaCR
   ├ incremental process dump
   ├ frozen template process
   └ direct fork rollback
```

Database 端則可採 Neon 類型：

```text
DB@LSN_42
     │
     ├─ factual branch
     │
     ├─ cf-A branch
     │
     └─ cf-B branch
```

共同頁面共享，只有 divergence 才新增 storage。

### 為什麼重要
Hermes 的 Attribution / Planning / Repair 會大量 fan-out：

```text
1 factual run
→ 10 candidate interventions
→ 每個 5 stochastic replays
→ 50 worlds
```

若 fork 不是 cheap primitive，所有上一輪提出的 counterfactual science 都會被 infra cost 卡死。

### 限制
DeltaBox code 尚未釋出，Neon DB branch 也只涵蓋資料庫，不涵蓋 process/browser/network state。

### 已確認 / 工程推論區分
- 已確認：DeltaBox paper 的 DeltaFS / DeltaCR、C/R reported latency。
- 已確認：Neon branch 可從 timestamp/LSN 建立 copy-on-write state branch。
- 工程推論：Hermes 應把 FS/Process/DB/Browser 統一成 composite `WorldFork` ABI。

---

## 3. Browser Virtual Time 是 Digital Twin 的必要狀態，不只是測試功能

### 問題
Browser world 裡許多邏輯取決於：

```text
Date.now()
setTimeout()
setInterval()
requestAnimationFrame()
expiration
retry backoff
auth token TTL
polling
animation / debounce
```

如果 factual / counterfactual 用不同 wall clock：

```text
Decision Difference
可能其實只是
Clock Difference
```

### 官方底層
CDP `Emulation.setVirtualTimePolicy`：

```text
policy = advance
       | pause
       | pauseIfNetworkFetchesPending

initialVirtualTime
budget
maxVirtualTimeTaskStarvationCount
```

並在 virtual time budget 消耗完時送出 `virtualTimeBudgetExpired`。

Playwright BrowserContext 也提供 `clock` 來 mock clock / passage of time。

### Hermes 模型

```text
BrowserTwinClock
├ epoch
├ monotonic_time
├ timezone
├ timer_queue
├ virtual_time_policy
├ virtual_time_budget
├ network_pending_state
└ task_starvation_guard
```

### 為什麼重要
Counterfactual Browser Agent 的「時間」必須跟 FS / DB snapshot 一樣是 versioned state。

### 關鍵否定

```text
Same DOM
≠
Same Browser World

Same HTTP Fixtures
≠
Same Timer State

Same Wall Clock Timestamp
≠
Same Scheduler State
```

---

## 4. Digital Twin 必須有 Calibration，否則只是「看起來合理的假世界」

### DNative-Twin 給出的重要警告
DNative-Twin 的實驗發現：typed graph 可以定位 represented change，但 graph 本身無法推斷 **unobserved tool state** 的後果。

其 controlled experiment 顯示，加入：

```text
Replay Contract State
+
Verification Result
```

才能逐步提升 unresolved divergence detection。

這非常重要，因為 Digital Twin 最大風險不是 crash，而是：

```text
Twin 回答得很順
但回答錯了
```

### Hermes 應建立 Twin Calibration Loop

```text
Real Tool Transition
(S, A) → S'_real

Twin Transition
(S, A) → S'_twin

↓ compare

State Error
Observation Error
Invariant Violation
Effect Error
Timing Error
↓
TwinCalibrationProfile
```

至少保存：

```text
TwinCalibrationProfile
├ domain
├ tool_version
├ state_region
├ action_family
├ sample_count
├ state_match_rate
├ observation_match_rate
├ invariant_pass_rate
├ timing_error
├ effect_error
├ last_verified_at
└ confidence_interval
```

### 重要區分

```text
Simulator Executable
≠
Simulator Accurate

Simulator Accurate On Seen States
≠
Accurate On Counterfactual State

Verifier Passed
≠
Real-World Equivalence
```

---

## 5. Counterfactual Runtime 應有「Response Authority Ladder」

當新 action 出現時，不應一律交給 LLM hallucinate 一個 result。

Hermes 可以按照 authority：

```text
Level 0  Exact Recorded Fixture
         ↓ highest factual fidelity

Level 1  Deterministic Code / DB Twin

Level 2  Calibrated Domain Simulator

Level 3  Learned World Model

Level 4  LLM Synthetic Guess
         ↓ lowest authority

Level 5  UNKNOWN / BLOCK
```

每一個 observation 必須標記：

```text
ObservationEnvelope
├ value
├ source_authority
├ twin_id
├ twin_version
├ calibration_scope
├ calibration_confidence
├ generated_from_state
├ action_id
├ stochastic_seed_key
└ factuality_status
```

這形成一條非常重要的新知識圖譜關係：

```text
Digital Twin Output
IS_A
Modelled Observation

Digital Twin Output
IS_NOT
Observed Fact
```

---

# Architecture Breakdown

本輪建議 Hermes 的完整新 architecture：

```text
User / Planner / Agent
↓
Action Intent
↓
World Mode Router
├ LIVE
├ RECORD
├ REPLAY
├ COUNTERFACTUAL
└ SHADOW
↓
World Snapshot Manager
├ Process Snapshot
├ Delta Filesystem
├ DB Branch / MVCC Point
├ Browser Profile Snapshot
├ Browser Virtual Clock
├ Memory Revision
├ MCP Resource State
└ Policy / Tool Version
↓
World Fork Manager
↓
Action Router
│
├ Recorded action?
│   └→ Fixture Replay
│
├ Executable deterministic tool twin?
│   └→ Code/DB Twin
│
├ Calibrated simulator?
│   └→ Domain Digital Twin
│
├ Learned world model allowed?
│   └→ Probabilistic Twin
│
└ Otherwise
    └→ UNKNOWN / BLOCK
↓
Synthetic / Replayed Observation
↓
Twin Calibration Envelope
↓
Counterfactual Agent Continues
↓
Outcome
↓
Twin Confidence Propagation
↓
Attribution / Planning / Repair Certificate
```

---

# Bottom-Level Logic

## A. World Fork ABI

```text
WorldSnapshot
├ snapshot_id
├ parent_snapshot_id
├ fs_layer
├ process_state
├ db_version
├ browser_state
├ virtual_time
├ rng_namespace
├ mcp_state
├ memory_revision
├ tool_versions
└ policy_version
```

Fork：

```text
fork(parent_snapshot)
→ child world
→ share immutable state
→ allocate writable delta
```

Rollback：

```text
rollback(child)
→ discard writable delta
→ restore parent references
```

Commit 不應預設允許：

```text
counterfactual branch
≠
production branch
```

---

## B. New Action Resolution

```text
A_cf
↓
Canonical Tool Identity
↓
Validate Preconditions
↓
Determine State Coverage
↓
Response Authority Ladder
↓
Transition
↓
Invariant Check
↓
Observation
↓
Confidence Assignment
```

Pseudo-contract：

```text
step(world_state, action) -> {
  next_state,
  observation,
  effects,
  provenance,
  uncertainty,
  simulator_version
}
```

---

## C. Simulator Confidence Propagation

若 trajectory 有 8 步，其中 2 步使用低信心 learned twin：

```text
S0
→ exact fixture
→ deterministic DB twin
→ learned twin (.63)
→ deterministic
→ learned twin (.58)
→ ...
```

最後 outcome 不應宣稱：

```text
counterfactual success = TRUE
```

而應是：

```text
CounterfactualOutcome
├ outcome = success
├ world_model_confidence = LOW/MEDIUM
├ lowest_authority_step = learned_twin
├ unsupported_transition_count = 0
├ extrapolation_distance = ...
└ needs_real_verification = true
```

這一層是 Hermes engineering synthesis，並非某單篇 paper 已完整定義。

---

# Visual Simulation Idea

## **Digital Twin Fork & Calibration Lab**

### View 1 — World Fork Tree

```text
World S42
├── factual
│    └── cancel_order
│
├── CF-A
│    └── change_address
│
└── CF-B
     └── issue_refund
```

點任何 branch 顯示：

```text
Filesystem      shared → delta 12 KB
DB              branch @ LSN 8A91
Browser         profile fork
Virtual time    2026-09-12T15:40:00
MCP state       snapshot v17
RNG namespace   cf-b/seed-22
```

### View 2 — Observation Authority

每個 tool response 用不同圖示：

```text
✓ RECORDED FACT
◇ DETERMINISTIC TWIN
△ CALIBRATED SIMULATOR
~ LEARNED WORLD MODEL
? UNKNOWN
```

使用者可以立即看出：

```text
這條 counterfactual trajectory
哪幾步是「知道」
哪幾步是「模擬」
哪幾步只是「猜」
```

### View 3 — Sim-vs-Real Calibration

```text
Action: change_shipping_address

Twin predicted:
status = updated
ETA +1 day

Real shadow run:
status = updated
ETA +2 days

State Match        ✓
Observation Match  partial
Timing Error       +1 day
Effect Error       medium
```

### View 4 — Confidence Decay Timeline

```text
Step 1  Exact Replay          1.00
Step 2  DB Twin               .99
Step 3  Learned Twin          .66
Step 4  DB Twin               .66
Step 5  Unknown external tax  .31

FINAL COUNTERFACTUAL CONFIDENCE: LOW
```

---

# Code / GitHub

## 1. Snowflake-Labs/agent-world-model
https://github.com/Snowflake-Labs/agent-world-model

本輪值得看的核心目錄 / 檔案：

```text
awm/core/env.py
awm/core/db.py
awm/core/server.py
awm/core/reset.py
awm/core/scenario.py
awm/core/task.py
awm/core/verifier.py
awm/core/verify.py
awm/tools.py
```

### 本輪 source audit 重點

`env.py`
- 測試 generated environment 時會把原 database 複製到 temporary DB。
- 每個 scenario 可啟動獨立 server process。
- 使用 FastAPI/SQLite/SQLAlchemy 形成 executable tool environment。

`server.py`
- 若指定 db_path，保存 `initial.db` snapshot。
- generated server code 會把 SQLAlchemy engine 指向指定 SQLite path。
- 掛載 FastAPI MCP。
- server 結束後保存 final DB snapshot。

這代表 AWM 已具備很接近 Hermes `Stateful Tool Twin` 所需的基本 pattern：

```text
Initial DB
→ Tool Server
→ Agent Actions
→ State Mutation
→ Final DB
→ Verification
```

## 2. dongyunpeng-sjtu/deltabox
https://github.com/dongyunpeng-sjtu/deltabox

值得追蹤，但目前只能讀 paper/project page；官方明確表示核心 artifacts 尚未公開。

**研究規則：不要虛構不存在的 `deltafs.c`、kernel module path 或 userspace controller 檔名。**

## 3. ComplexMCP
https://github.com/ATH-MaaS/complex-mcp

上一輪已研究 tool sandbox；本輪只保留一個新意義：它的 seed-driven stateful sandbox 證明 agent tool world 可同時做到 **deterministic diversity + stateful interdependence**，適合未來拿來測 Hermes Twin Runtime。

---

# Papers

## Paper A
**DNative-Twin: Decision Graphs and Digital Twins for Reconstructable Agentic Decisions**
- Authors: Junjie Pang, Zhenzhen Xie, Haoke Han, Ying He, Jing Wang, Gang Liu
- Year: 2026
- URL: https://arxiv.org/abs/2609.03787
- Dataset: 三個 public process logs + controlled replay suites
- Architecture: graph-native decision twin
- Contribution: 明確分離 graph structure、replay context、verification evidence 的角色。
- Limitations: 未觀測 tool state 是 graph-only twin 的核心盲點；enterprise process setting 不代表一般 browser/MCP world。
- 改變了什麼：把「decision provenance」從 trace inspection 推向 isolated mechanism reconstruction。

## Paper B
**DeltaBox: Scaling Stateful AI Agents with Millisecond-Level Sandbox Checkpoint/Rollback**
- Authors: Yunpeng Dong et al.
- Institutions: SJTU / Huawei 等
- Year: 2026
- URL: https://arxiv.org/abs/2605.22781
- Code: 尚未釋出核心 artifacts
- Architecture: DeltaFS + DeltaCR
- Contribution: 讓 Agent sandbox checkpoint/rollback 從 full duplication 轉向 delta-based transactional state。
- Limitations: artifact unavailable；仍未處理 browser/network/external SaaS state。
- 改變了什麼：使大規模 counterfactual branching 有成為 runtime primitive 的可能。

## Paper C
**Agent World Model: Infinity Synthetic Environments for Agentic Reinforcement Learning**
- Authors: Zhaoyang Wang et al.
- Year: 2026
- URL: https://arxiv.org/abs/2602.10090
- Code: https://github.com/Snowflake-Labs/agent-world-model
- Dataset: AgentWorldModel-1K
- Architecture: LLM synthesis pipeline → code-driven DB-backed environments → MCP tools → tasks/verifiers → agent training/evaluation
- Contribution: 把 agent environment 從 static benchmark 變成 executable synthetic world。
- Limitations: synthetic tool semantics / state distribution 與 production world 仍可能偏移。
- 改變了什麼：對 Hermes 而言，證明「世界模型」不必只是一個 neural latent model，也可以是一個 code + DB executable environment。

---

# Unknown / Open Questions

## 1. 如何量化 Twin 在未看過 state/action region 的 extrapolation distance？
目前 `calibration accuracy` 若只做平均，很容易掩蓋 OOD region。

需要：

```text
State-Action Coverage Map
+
OOD Detector
+
Local Calibration Error
```

## 2. Browser Twin 要 snapshot 到哪一層才夠？
目前還缺：

```text
Service Worker internal state
WebSocket protocol state
browser process scheduler
GPU/compositor state
cross-origin storage interaction
```

不是只有 storageState + HAR。

## 3. Learned World Model 的錯誤如何沿 Agent trajectory 傳播？
需要建立：

```text
Transition Uncertainty
→ State Uncertainty
→ Observation Uncertainty
→ Planner Decision Uncertainty
→ Counterfactual Outcome Confidence
```

而不是每步 confidence 各自獨立。

---

# 下一輪研究

## 主題
**World-Model Uncertainty Propagation × Sim-to-Real Calibration × OOD State Detection × Learned Tool Twin × Transition Verification**

下一輪路徑：

```text
Real Tool Logs
↓
State / Action / Next-State Dataset
↓
Twin Transition Model
↓
Calibration Split
↓
State-Action Coverage
↓
OOD Detection
↓
Transition Uncertainty
↓
Multi-Step Error Accumulation
↓
Decision Sensitivity
↓
Counterfactual Outcome Confidence
↓
Selective Real Verification
```

優先研究：
- learned world model / model-based RL uncertainty
- ensemble dynamics models
- conformal prediction for transition models
- simulator calibration / system identification
- sim-to-real gap
- trajectory-level uncertainty accumulation
- tool/API emulators that can learn transition models from logs

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Executable Digital Twin
Tool Digital Twin
MCP Digital Twin
Stateful Tool Twin
World Fork
Composite World Snapshot
Delta State
Delta Filesystem
Process State Fork
Database Branch
LSN Snapshot
Browser Virtual Time
Browser Scheduler State
Twin Transition Function
Modelled Observation
Observation Authority
Response Authority Ladder
Replay Contract State
Twin Calibration
Twin Calibration Profile
State-Action Coverage
Twin Extrapolation
Simulation-to-Reality Gap
Transition Verification
World-Model Confidence
Counterfactual Outcome Confidence
Synthetic Effect
Digital Twin Version
```

## 新增 Edges

```text
Recorded Replay
IS_NOT
Executable Digital Twin

Fixture
ANSWERS_ONLY
Previously Recorded Request

Executable Digital Twin
CAN_ANSWER
Novel Counterfactual Action

World Fork
DERIVED_FROM
World Snapshot

Database Branch
IMPLEMENTS
Stateful Fork

Browser Virtual Time
CONTROLS
Browser Temporal Dynamics

Twin Output
IS_A
Modelled Observation

Twin Output
IS_NOT
Observed Fact

Twin Confidence
DEPENDS_ON
Calibration Scope

Counterfactual Outcome Confidence
DEPENDS_ON
Transition Confidence

Replay Contract State
REDUCES
Unresolved Divergence

Verification Evidence
CALIBRATES
Digital Twin
```

## 新增否定關係

```text
Recorded Trace ≠ Executable World
Mock API ≠ Stateful Digital Twin
Executable Simulator ≠ Accurate Simulator
Simulator Accuracy ≠ Real-World Equivalence
Same DOM ≠ Same Browser World
Same Database Rows ≠ Same Full Runtime State
Forkable State ≠ Causally Faithful State
Digital Twin Output ≠ Observed Fact
Verifier Passed ≠ Real-World Equivalence
Low One-Step Error ≠ Low Multi-Step Error
Synthetic Success ≠ Production Success
```

---

# 本輪結束檢查

**缺哪一層？**
- World-model uncertainty propagation + sim-to-real calibration + OOD state/action detection。

**哪個節點最淺？**
- `TwinExtrapolationDistance`
- `CounterfactualOutcomeConfidence`
- `BrowserSchedulerStateSnapshot`

**哪個概念仍只是名詞 / 工程假說？**
- `CompositeWorldForkABI`
- `ResponseAuthorityLadder`
- `TwinCalibrationCertificate`
- `TrajectoryWorldModelConfidence`

**哪個系統值得繼續讀原始碼？**
1. `Snowflake-Labs/agent-world-model`：`db.py / verifier.py / verify.py / scenario.py`
2. DeltaBox：等核心 artifacts 正式釋出後第一優先深挖
3. Chromium/CDP virtual time implementation
4. OpenEnv（AWM infra 已合併進去）

**哪篇論文需追引用？**
1. Agent World Model
2. DeltaBox
3. DNative-Twin

**哪個概念最適合視覺模擬？**
- **Digital Twin Fork & Calibration Lab**

**哪個 Agent 架構最值得實作？**

> **Forkable Executable-World Counterfactual Runtime = Composite World Snapshot + Cheap State Fork + Browser Virtual Clock + DB Branch + Tool/MCP Digital Twin + Response Authority Ladder + Simulator Calibration + Uncertainty Propagation + Counterfactual Confidence Certificate。**

---

# 本輪對「AI 到底怎麼運作」新增的一層

前幾輪已經追到：

```text
User
→ UI
→ Agent
→ Context
→ Reasoning / Planning
→ Memory
→ Tool / MCP
→ External World
```

本輪補上的是：

```text
External World
≠
只能被動觀察的黑盒
```

研究型 Agent Runtime 還需要建立一個可分岔的模型：

```text
Observed World State
↓ snapshot
Forked Counterfactual World
↓
Novel Agent Action
↓
Executable Twin Transition
↓
Synthetic Observation
↓
Agent continues reasoning
↓
Counterfactual Outcome
↓
Calibration / Confidence
```

因此要真正回答：

> **「如果 AI 當時做了另一個決定，會發生什麼？」**

不能只把舊 log 播一次，也不能叫 LLM 猜一個故事；必須有 **可執行世界、可分岔狀態、明確 transition semantics、校準誤差與不確定性標記**。