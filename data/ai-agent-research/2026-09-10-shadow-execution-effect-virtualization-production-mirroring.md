# 【AI Agent × Multimodal Research Report】

時間：2026-09-10 13:51 Asia/Taipei

主題：Shadow Execution × Effect Virtualization × Safe Production Mirroring × Production Differential Testing

## 與歷史研究比較

上一輪已建立 Replay Certification：以 frozen historical corpus、determinants、dual replay、canonical state hash、first-divergence analyzer 與 seeded simulation 驗證新版 runtime。這一輪不重複 offline replay，而補上 production gap：**新版 runtime 如何吃到真實使用者流量、真實 observation 與真實 latency distribution，同時又絕對不能重複真實副作用。**

歷史路徑目前可接成：

Lease/Fencing → Late Result Fence → Speculative Winner Commit → Global Speculation Budget → Deadline Scheduler → Checkpoint/Continuation → Distributed Checkpoint → Deterministic Replay → Event-Sourced State → Replay Certification → **Shadow Execution / Effect Virtualization**。

---

## 本小時新發現

### 新架構

1. **Production Shadow Agent Runtime**：將 primary request 複製給 candidate runtime，但 candidate 的 effect plane 預設封閉。
2. **Observation Replay Bus**：Shadow 不直接再讀真實外部服務，而優先消費 primary 已取得的 observation，避免因外部狀態漂移造成假 divergence。
3. **Virtual Effect Sink**：把 Gmail/Drive/GitHub/MCP/Browser submit 等 tool mutation 轉成 effect intent，而不是執行。
4. **Shadow State Namespace**：Shadow 可以寫自己的 Memory、Artifact、KV、Knowledge Graph，但永遠不能寫 canonical production namespace。
5. **Promotion Evidence Bundle**：將 live decision diff、effect-intent diff、latency diff、安全 invariant 與 replay certificate 合併成部署證據。

### 新論文 / benchmark

- **A Unified Framework for the Evaluation of LLM Agentic Capabilities** — Pengyu Zhu, Lijun Li, Yaxing Lyu, Qianxin Luo, Jingyi Yang, Yi Liu, Tingfeng Hui, Xinyu Yuan, Li Sun, Sen Su, Jing Shao, 2026. 以統一 instruction-tool-environment、固定 ReAct harness、controllable sandbox 與 offline snapshots 區分模型能力、framework effects 與 environment volatility。Paper: https://arxiv.org/abs/2605.27898 ; Code: https://github.com/whfeLingYu/A-Unified-Framework-for-the-Evaluation-of-LLM-Agentic-Capabilities
- **ClawsBench: Evaluating Capability and Safety of LLM Productivity Agents in Simulated Workspaces** — Xiangyi Li et al., 2026. 建立 Gmail、Slack、Calendar、Docs、Drive 五個高擬真 mock services，支援 deterministic snapshot/restore；44 個跨服務與 safety-critical tasks。Paper: https://arxiv.org/abs/2604.05172
- **ComplexMCP** — Yuanyang Li, Xue Yang, Longyue Wang, Weihua Luo, Hongyang Chen, 2026. 300+ tools、7 stateful sandboxes、seed-driven environment failure；顯示 stateful/interdependent tools 比 isolated tool benchmark 困難許多。Paper: https://arxiv.org/abs/2605.10787 ; Code: https://github.com/ATH-MaaS/complex-mcp
- **SafeClawBench** — Yuchuan Tian et al., 2026. 將 semantic acceptance、audit-visible harm、sandbox-observed harm 分開，證明「文字上看似安全」與「工具真的沒造成 harm」不是同一件事。Paper: https://arxiv.org/abs/2606.18356
- **AgentTrust** — Chenglin Yang, 2026. 將 tool call 在 execution 前攔截，輸出 allow/warn/block/review，代表 production agent safety 需要 execution-boundary interception，而不只是 post-hoc benchmark。Paper: https://arxiv.org/abs/2605.04785

### 新 GitHub / system source

Envoy request mirroring 的核心路徑位於：

```text
source/common/router/router.h
source/common/router/router.cc
test/integration/shadow_policy_integration_test.cc
```

`router.cc` 會先決定 active shadow policies，再啟動 shadow streams。Istio traffic mirroring 建立在相同概念上：將 live request 複製到 mirrored backend；mirror traffic 位於 primary critical path 之外，而且回應被丟棄。這是 Agent Shadow 的重要基礎，但 **HTTP response discard 不等於 Agent side-effect isolation**。

ComplexMCP repo 不只 README，目前根目錄值得繼續讀：

```text
benchmark/
client/
config/
servers/
software/
run_benchmark.py
start_servers.sh
start_softwares.sh
```

這些比 README 更接近 stateful tool sandbox、benchmark runner、server lifecycle 與 environment orchestration。

---

## 本小時最重要 5 個發現

### 1. Traffic Mirroring ≠ Safe Agent Shadowing

已確認事實：Istio traffic mirroring 會把 live request 複製到 mirror backend，mirror response 為 fire-and-forget/discard，不影響 primary response path。

Agent 的差異在於：candidate 收到 request 後可能呼叫 `send_email`、`delete_file`、`merge_pr`、`browser_submit`、`mcp_write`。即使最後把 candidate 的 HTTP response 丟掉，副作用早就發生。

所以 Agent shadow 必須拆成：

```text
Production Request
→ Request Mirror
→ Candidate Agent
→ Intent
→ Tool Schema
→ Tool Selection
→ Arguments
→ EFFECT CLASSIFIER
→ Virtual Effect Sink
→ Simulated Observation / Primary Observation
→ Context
→ Next Decision
```

而不能：

```text
Production Request
→ Candidate Agent
→ Real Tool
→ discard final response
```

限制：對 pure-read tool，可以允許 shadow live read，但外部狀態變動會造成 baseline/candidate observation drift。

來源：Istio traffic mirroring；Envoy router shadow source。

### 2. Shadow Agent 最難的不是「不 commit output」，而是「不 commit effect」

需要正式區分：

```text
Output Commit
State Commit
Artifact Commit
External Effect Commit
```

Shadow runtime 應預設：

```text
Output Commit = NO
Canonical State Commit = NO
External Effect Commit = NO
Shadow Telemetry Commit = YES
Shadow Namespace Commit = YES
```

因此建立 **EffectIntent**：

```text
EffectIntent
├ tool_name
├ arguments_hash
├ semantic_target
├ effect_class
├ capability_required
├ predicted_preconditions
├ predicted_postconditions
├ idempotency_key_candidate
└ irreversible_risk
```

Candidate 不是「真的寄信」，而是輸出：

```text
INTENT: send_email
recipient = X
subject_hash = ...
body_hash = ...
risk = external_irreversible
```

這讓 primary 與 candidate 能比較：

```text
Same Decision?
Same Tool?
Same Target?
Same Arguments?
Same Effect Class?
Same Preconditions?
```

### 3. Live Shadow 需要 Observation Control，否則 diff 可能是假訊號

如果 Primary 在 13:51:10 搜到資料 A，而 Shadow 在 13:51:13 自己重查外部服務得到 B，後續 plan divergence 不能直接歸因於新版 runtime。

因此建議 Hermes 對 tool 定義 observation mode：

```text
RECORDED_PRIMARY
→ Candidate 消費 primary observation

LIVE_READ_ONLY
→ Candidate 可以自己讀，但結果標記 environment-drift risk

SIMULATED
→ Candidate 進 sandbox/mock service

BLOCKED
→ Candidate 只能產生 EffectIntent，不得到真實結果
```

這和 Unified Framework 的 offline snapshot、ClawsBench deterministic snapshot/restore、ComplexMCP seed-driven sandbox 共同支持一個原則：**environment control 是 agent differential evaluation 的必要條件。**

### 4. Sandbox Fidelity 是 Shadow Promotion 的底層瓶頸

論文結果指出，ClawsBench 即使在高擬真 productivity sandbox，agents 仍有 7–33% unsafe action rate（特定實驗配置）；ComplexMCP 更顯示多服務、互相依賴、stateful tools 與 injected API failures 會大幅拉高難度。

因此：

```text
Mock Tool Pass
≠
Production Effect Safe
```

Hermes 需要追蹤 **Simulation Fidelity Gap**：

```text
schema fidelity
state-transition fidelity
permission fidelity
failure-mode fidelity
latency fidelity
concurrency fidelity
auth fidelity
rate-limit fidelity
```

如果 sandbox 沒模擬 OAuth expiry、429、partial write、eventual consistency、duplicate callback，shadow pass 仍可能在 production fail。

### 5. Production Promotion 應比較 Effect Intent，而不只比較文字答案

SafeClawBench 把 semantic failure、audit evidence、sandbox-observed harm 分開，顯示文字判斷與 executable harm 是不同 endpoint。

所以 Shadow Diff 應至少輸出：

```text
Decision Diff
Tool Selection Diff
Argument Diff
Effect Intent Diff
State Projection Diff
Memory Write Diff
Artifact Diff
Latency Diff
Cost Diff
Safety Invariant Diff
```

候選 runtime 只有在「effect intent 沒出現 breaking divergence」時才有 promotion 資格。

---

## Architecture Breakdown

```text
User / Camera / Voice / Video
↓
Production Ingress
↓
Request Mirror Controller
├──────────── PRIMARY ───────────────┐
│                                    │
│ Primary Runtime                    │
│ ↓                                  │
│ Context / Reason / Plan            │
│ ↓                                  │
│ Real Tools / MCP                   │
│ ↓                                  │
│ REAL EFFECT                        │
│ ↓                                  │
│ Observation Recorder ───────┐      │
│ ↓                           │      │
│ Canonical State             │      │
│ ↓                           │      │
│ User Output                 │      │
│                             │      │
└──────────── SHADOW ─────────┼──────┘
                              ↓
                     Candidate Runtime
                              ↓
                     Shadow Context
                              ↓
                     Reason / Plan
                              ↓
                     Tool Intent Router
                      ├ PURE_READ
                      ├ RECORDED_OBS
                      ├ SIMULATED
                      └ EFFECTFUL
                              ↓
                     Effect Virtualization Gate
                              ↓
                  ┌───────────┴────────────┐
                  ↓                        ↓
          Virtual Effect Sink       Sandbox / Mock Tool
                  ↓                        ↓
          EffectIntent Log        Simulated Observation
                  └───────────┬────────────┘
                              ↓
                     Shadow State Namespace
                              ↓
                     Differential Analyzer
                              ↓
                     Promotion Evidence
```

核心 safety invariant：

```text
ShadowCanonicalWriteCount = 0
ShadowRealExternalEffectCount = 0
```

若任一 > 0，該 shadow run 直接判定 containment failure。

---

## Bottom-Level Logic

### Effect Virtualization Pipeline

```text
Intent
→ Tool Schema Resolve
→ Tool Selection
→ Argument Construction
→ Effect Classification
→ Capability Check
→ Shadow Policy Lookup
→ Execute?
   ├ READ + allowed → live/snapshot/recorded observation
   ├ PURE compute → local execution
   ├ EFFECTFUL → virtualize
   └ UNKNOWN → block
→ Observation Envelope
→ Context Injection
→ Next Decision
```

Shadow policy 建議 fail-closed：

```text
if effect_class == UNKNOWN:
    BLOCK_REAL_EXECUTION
```

### Observation Envelope

```text
ObservationEnvelope
├ observation_id
├ source_mode
│  ├ PRIMARY_RECORDED
│  ├ LIVE_SHADOW_READ
│  ├ MOCK
│  └ SYNTHETIC
├ tool_contract_version
├ observed_at
├ primary_event_id
├ freshness
├ payload_hash
└ environment_snapshot_id
```

### Differential Predicate

```text
Comparable(primary, shadow) =
  SameInputIdentity
∧ CompatibleToolContracts
∧ ObservationLineageKnown
∧ EnvironmentDriftWithinPolicy
```

只有 Comparable=true 時，decision divergence 才能歸因到 candidate runtime。

### Promotion Predicate

```text
PromotionEligible(R_new) =
  ReplayCertificatePass
∧ ShadowContainmentPass
∧ NoBreakingEffectIntentDiff
∧ SafetyInvariantPass
∧ StateProjectionDiffWithinPolicy
∧ LatencySLOPass
∧ CostBudgetPass
```

這是合理工程建模，不是目前既有標準。

---

## Visual Simulation Idea

### Shadow Agent & Effect Virtualization Lab

畫面左右兩個 runtime：

```text
PRIMARY                         SHADOW R_new

User Request ────────────────→ mirrored request
     ↓                               ↓
Planner A                         Planner B
     ↓                               ↓
Tool: send_email                Tool: send_email
     ↓                               ↓
REAL Gmail                      VIRTUAL EFFECT SINK
     ↓                               ↓
Email sent                     Intent recorded
     ↓                               ↓
Observation O71 ─────────────→ inject O71
     ↓                               ↓
State A                          Shadow State B
```

UI 同時顯示：

```text
Decision Similarity       0.92
Tool Match                 YES
Argument Match             NO
External Effect Executed   PRIMARY ONLY
Shadow Containment         PASS
Observation Mode           PRIMARY_RECORDED
Latency Delta              +8.3%
Cost Delta                 -12.1%
```

可以手動注入：

```text
ENABLE REAL SHADOW EFFECT   ← UI 應警告/預設禁止
CHANGE TOOL CONTRACT
PRIMARY 429
PRIMARY PARTIAL WRITE
MOCK RETURNS STALE STATE
LIVE READ DRIFT
SHADOW MEMORY WRITE
SHADOW ATTEMPTS CANONICAL WRITE
```

最重要的視覺情境：

```text
Candidate 決定 DELETE FILE
↓
Effect Virtualization Gate
↓
REAL DELETE = BLOCKED
↓
EffectIntent = RECORDED
↓
DIFF:
Primary = READ FILE
Shadow = DELETE FILE
↓
PROMOTION BLOCKED
```

這直接把「模型說了什麼」與「Agent 想對世界做什麼」分開。

---

## Code / GitHub

### Envoy
值得讀：

```text
source/common/router/router.h
source/common/router/router.cc
test/integration/shadow_policy_integration_test.cc
```

核心原因：這是 production-grade request mirroring / shadow stream lifecycle 的成熟實作，可借鏡 request duplication、timeout、streaming shadow 與 primary/shadow lifecycle 分離。

### ComplexMCP
值得讀：

```text
benchmark/
client/
servers/
software/
config/
run_benchmark.py
start_servers.sh
start_softwares.sh
```

核心原因：不是 isolated API mock，而是多個 stateful software sandbox + MCP tools + benchmark runner；適合研究 Hermes 的 Effect Simulator / Stateful Tool Twin。

### 下一步原始碼閱讀目標

1. Envoy router shadow stream 啟動、timeout、body streaming、shadow response disposal。
2. ComplexMCP `servers/`：MCP server tool abstraction、state mutation boundary。
3. ComplexMCP `software/`：stateful service model、reset/seed/failure injection。
4. ClawsBench 若公開完整 service source：snapshot/restore、cross-service state semantics。

---

## Papers

### A Unified Framework for the Evaluation of LLM Agentic Capabilities
- Authors: Pengyu Zhu et al.
- Year: 2026
- URL: https://arxiv.org/abs/2605.27898
- Code: https://github.com/whfeLingYu/A-Unified-Framework-for-the-Evaluation-of-LLM-Agentic-Capabilities
- Dataset: Unified Agent Framework dataset / benchmark integration
- Architecture: unified instruction-tool-environment + fixed ReAct harness + sandbox + optional offline snapshots
- Contribution: 分離 model capability、harness effect、environment volatility
- Limitations: benchmark/offline environment 與真實 production SaaS 仍存在 fidelity gap
- 改變了什麼：證明 agent evaluation 不能忽略 harness 和 environment。

### ClawsBench
- Authors: Xiangyi Li et al.
- Year: 2026
- URL: https://arxiv.org/abs/2604.05172
- Dataset: 44 tasks + released trajectories/future dataset
- Architecture: five high-fidelity productivity mock services + deterministic snapshot/restore
- Contribution: 能在不傷害 live services 的環境中測真實 productivity agent side effects
- Limitations: mock service 仍無法完全等同 live cloud systems
- 改變了什麼：把 stateful multi-service safety evaluation 拉近 production workflow。

### ComplexMCP
- Authors: Yuanyang Li, Xue Yang, Longyue Wang, Weihua Luo, Hongyang Chen
- Institution: paper authors affiliations should be rechecked from full paper metadata before storing as canonical KG institution node
- Year: 2026
- URL: https://arxiv.org/abs/2605.10787
- Code: https://github.com/ATH-MaaS/complex-mcp
- Dataset/Environment: 300+ tools, 7 stateful sandboxes
- Architecture: MCP tool environment + seed-driven dynamic states/API failure injection
- Contribution: 測 interdependent/stateful tool use，而非 isolated function call
- Limitations: benchmark sandbox failure model 仍是 production failure distribution 的近似
- 改變了什麼：將 MCP agent evaluation 從 tool-call accuracy 推到 workflow/runtime resilience。

### SafeClawBench
- Authors: Yuchuan Tian et al.
- Year: 2026
- URL: https://arxiv.org/abs/2606.18356
- Architecture: staged safety endpoints
- Contribution: semantic acceptance、audit evidence、sandbox harm 分開量測
- Limitations: sandbox-observed harm 仍不等同所有 production harms
- 改變了什麼：證明 agent safety 不能只看文字輸出。

---

## 已確認 / 推論 / 尚未驗證

### 已確認
- Istio/Envoy 支援 production request mirroring/shadowing，mirror path 可 out-of-band，shadow response 可被丟棄。
- ClawsBench 使用高擬真 stateful mock productivity services 與 deterministic snapshot/restore。
- ComplexMCP 使用 MCP、300+ tools、7 stateful sandboxes、seed-driven failure/state variation。
- Unified Framework 明確使用 controllable sandbox 與 optional offline snapshot 來拆 environment volatility。

### 工程推論
- Agent shadow runtime 必須把 effect plane 與 observation plane 拆開。
- `PRIMARY_RECORDED` observation 應作為 differential shadow 的預設模式，才能減少 environment drift。
- Shadow runtime 必須擁有獨立 state namespace，且 canonical/external writes fail-closed。

### 尚未驗證假說
- EffectIntent semantic diff 是否比 raw tool/argument diff 更能預測 production regression。
- 多少比例 live traffic 才足以覆蓋 long-tail agent branching。
- 對 multimodal Agent，影像/音訊 observation replay 應保存原始 bytes、encoder tokens，還是 semantic digest 才能兼顧成本與 reproducibility。

---

## Unknown / Open Questions

1. **如何虛擬化「必須真的執行才知道 observation」的 effectful tool？** 例如建立 PR 後 GitHub 才回傳 server-generated ID。需要 prepare-only endpoint、transaction sandbox、digital twin 或 synthetic response contract。
2. **Primary observation 是否會掩蓋 candidate 原本會造成的不同世界？** 如果 Shadow 本來選了不同 Tool，直接餵 primary observation 可能形成 counterfactual inconsistency。需要 branch-specific counterfactual environment simulator。
3. **多模態 side effect 怎麼比較？** 例如 candidate 生成不同影片/圖片，不能只比 hash；需要 perceptual + semantic + policy-aware artifact diff。

---

## 下一輪研究

下一輪應進入：

# Counterfactual Environment Simulation × Digital Twin × Branch-Specific Observation × Tool Effect Model

因為 Shadow Candidate 一旦選擇與 Primary 不同的 action：

```text
Primary:
READ A
→ Observation Oa

Shadow:
UPDATE A
→ ???
```

此時不能再把 Primary 的 Oa 塞給 Shadow，否則 candidate trajectory 不是真正的 counterfactual world。

下一輪應拆：

```text
Current Environment Snapshot
→ Candidate EffectIntent
→ Transition Model
→ Counterfactual State
→ Synthetic/Simulated Observation
→ Candidate Next Action
→ Multi-step Counterfactual Rollout
→ Fidelity / Uncertainty Score
```

並研究 environment simulator、digital twin、world model、state transition validation、simulation drift、counterfactual replay。

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
Production Shadow Agent
Request Mirror Controller
Shadow Runtime
Shadow State Namespace
Effect Virtualization Gate
Virtual Effect Sink
EffectIntent
Observation Replay Bus
Observation Envelope
Primary-Recorded Observation
Live Shadow Read
Simulation Fidelity Gap
Shadow Containment
Production Differential
Effect Intent Diff
Promotion Evidence Bundle
Counterfactual Environment Gap
```

### Edges

```text
Production Request
→ mirrored_to
Shadow Runtime

Shadow Runtime
→ writes_only_to
Shadow State Namespace

Effectful Tool Call
→ intercepted_by
Effect Virtualization Gate

Effect Virtualization Gate
→ emits
EffectIntent

Primary Tool Observation
→ recorded_as
Observation Envelope

Observation Envelope
→ injectable_into
Shadow Runtime

EffectIntent
→ compared_against
Primary Effect

Shadow Containment
→ required_by
Promotion Eligibility

Simulation Fidelity Gap
→ weakens
Shadow Evidence
```

### 否定關係

```text
Traffic Mirroring
≠ Safe Agent Shadowing

Discard Shadow Response
≠ Suppress Shadow Side Effect

Mock Tool Success
≠ Production Effect Safety

Semantic Output Match
≠ Effect Intent Match

Same Input
≠ Same Environment Observation

Live Shadow Read
≠ Deterministic Differential Replay
```

---

## 本輪結束答案

- 缺哪一層：**Counterfactual Environment / Digital Twin transition layer**。
- 哪個節點最淺：**EffectIntent → simulated postcondition / observation**。
- 哪個概念仍只是名詞：**Production Agent Effect Virtualization ABI、Counterfactual Observation Contract**。
- 哪個系統最值得讀原始碼：**Envoy shadow router + ComplexMCP stateful server/software layers**。
- 哪篇論文需追引用：**A Unified Framework for the Evaluation of LLM Agentic Capabilities、ClawsBench、ComplexMCP、SafeClawBench**。
- 哪個概念最適合視覺模擬：**Shadow Agent & Effect Virtualization Lab**。
- 哪個 Agent 架構最值得實作：**Effect-Isolated Production Shadow Agent Runtime**。

## 核心結論

真正的 Agent shadow testing 不能只是把 production HTTP request 複製給新版 Agent。對一般 web service，丟掉 shadow response 往往已足以隔離使用者；但 AI Agent 會在 reasoning 中間對 Gmail、Drive、GitHub、Browser、MCP、Database、GPU artifact 等真實世界產生 side effects。因此 Hermes 必須讓 Shadow Runtime 能看到真實流量、真實 observation lineage 與真實 latency，同時把所有 effectful action 截斷在 **Effect Virtualization Gate**，只留下可比較的 `EffectIntent`。只有當 Replay Certification、Shadow Containment、Effect Intent Differential 與 Safety Invariant 都通過，新 Runtime 才有資格被 promotion。

## Sources

- Istio Traffic Mirroring: https://istio.io/latest/docs/tasks/traffic-management/mirroring/
- Envoy source: https://github.com/envoyproxy/envoy/tree/main/source/common/router
- Unified Framework: https://arxiv.org/abs/2605.27898
- ClawsBench: https://arxiv.org/abs/2604.05172
- ComplexMCP: https://arxiv.org/abs/2605.10787
- ComplexMCP code: https://github.com/ATH-MaaS/complex-mcp
- SafeClawBench: https://arxiv.org/abs/2606.18356
- AgentTrust: https://arxiv.org/abs/2605.04785
