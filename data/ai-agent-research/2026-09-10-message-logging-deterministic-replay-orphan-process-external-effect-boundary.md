# 【AI Agent × Multimodal Research Report】

**時間：2026-09-10 10:52（Asia/Taipei）**

**本輪主題：Message Logging × Deterministic Replay × Orphan Process × External Effect Replay Boundary**

> 本輪承接上一輪 Distributed Consistent Checkpoint × Recovery Line，不再重複 barrier / consistent cut，而是補上 crash 後如何靠「記錄非決定性事件」把 execution 往前重播，以及何時 replay 會製造 orphan state、何時必須停止 replay 並進入 effect reconciliation。

---

## 本小時新發現

### 1. Log-based rollback recovery 的真正核心不是「記所有東西」，而是記錄 nondeterministic event 的 determinant

經典 rollback-recovery survey 將 log-based recovery 定義為：checkpoint + nondeterministic events 的 determinants。determinant 是能讓 recovery 重新產生同一 nondeterministic event 的最小資訊。依 determinant 何時被穩定保存，可分 pessimistic、optimistic、causal logging。

對 Agent Runtime，可把 nondeterministic event 拆成：

```text
LLM sampling decision
Tool result arrival order
External API response
Timeout / retry decision
Concurrent branch winner
User interrupt
Clock / UUID / random
GPU kernel / batch completion order
Browser observation
Message receive ordering
```

因此 Agent replay 不應把所有 execution state 無差別 dump，而應定義：

```text
Determinant
├ event_id
├ event_type
├ causal_parent_ids[]
├ logical_time / HLC
├ input_identity
├ observed_value
├ authority_epoch
├ branch_id
└ replay_policy
```

**已確認事實：** 傳統 message-logging 文獻以 determinant 作為 replay nondeterminism 的核心 abstraction。

**工程推論：** Hermes 應把 tool result、LLM sampling outcome、branch winner、timeout decision 等提升為 Agent Determinant。

---

### 2. Deterministic Replay ≠ Re-execute Everything

Temporal 的 Event History 提供很清楚的工程對照：Workflow replay 重新執行 Workflow code，但把新產生的 Commands 與既有 Event History 比對；歷史中已經存在的 Activity result / Timer event 不會被當作新的真實外部 action 再執行。若程式在 replay 時產生的 command sequence 和 history 不一致，就形成 nondeterminism error。

可抽象為：

```text
History Event
↓
Replay Workflow Code
↓
Generate Command
↓
Compare against recorded history
├ MATCH → consume historical event
└ MISMATCH → NONDETERMINISM
```

所以 Hermes 的 replay 必須分成：

```text
REPLAYABLE PURE LOGIC
→ 可重新計算

RECORDED NONDETERMINISM
→ 注入已記錄 determinant

EXTERNAL EFFECT
→ 不直接 replay，先查 effect journal
```

核心關係：

```text
Deterministic Replay
≠
Blind Re-execution
```

---

### 3. Orphan Process 是 Agent Recovery 很重要但常被忽略的失敗模式

Rollback-recovery 文獻中的 orphan process 指：某 surviving process 的 state 依賴一個已無法重現的 nondeterministic event。

Agent 版例子：

```text
Planner P1
收到 ToolResult R7
↓
產生 PlanNode N8
↓
Memory Worker P2
把 N8 寫進 Knowledge Graph

但 ToolResult R7 的 determinant
尚未 durable，就 crash
```

Recovery 後：

```text
P2 仍保存 N8
但 P1 無法再重現 R7
```

此時 P2 就持有 orphan-derived state。

所以 Hermes 必須追蹤：

```text
Depend(event)
= 哪些 process / artifact / memory / branch
直接或間接依賴此 determinant
```

若 determinant 消失，依賴它的 state 不能直接當合法歷史保留。

**已確認事實：** optimistic logging 允許暫時形成 orphan process，recovery 時必須 rollback 這些依賴遺失 determinant 的 state。

**工程推論：** Agent Artifact Graph 應保存 determinant lineage，否則無法知道哪個 Memory/Plan/Artifact 已變成 orphan-derived。

---

### 4. Pessimistic / Optimistic / Causal Logging 對 Agent Runtime 是不同的 latency-vs-recovery trade-off

#### Pessimistic Logging

```text
Nondeterministic Event
↓
Persist Determinant
↓
Allow dependent state to escape
```

優點：failure 後容易避免 orphan；output commit 邏輯較簡單。
缺點：每個重要 nondeterministic event 都可能增加同步 durable-write latency。

適合：

```text
irreversible tool
financial mutation
canonical memory commit
security-sensitive capability change
```

#### Optimistic Logging

```text
Event
↓
continue execution
↓
async persist determinant
```

優點：fast path latency 較低。
缺點：crash 可能遺失 determinant，造成 orphan dependency chain，recovery 需要 rollback 多個 surviving components。

適合：

```text
pure/recomputable inference
cache
speculative branch
non-canonical analysis artifact
```

#### Causal Logging

目標是只讓 causal dependents 攜帶/保存足夠 determinant information，以降低 pessimistic 同步寫入成本，同時避免大範圍 orphan rollback。

對 Hermes 可轉為：

```text
Critical Effect Path
→ pessimistic durability

Cheap Recomputable Path
→ optimistic durability

Cross-Agent Shared Derived State
→ causal determinant propagation
```

因此不能只有單一 `event_log.append()` 策略。

---

### 5. External Effect Replay Boundary 必須與 Workflow Replay 明確切開

Kafka Streams 能做到 tightly integrated exactly-once，是因為 source offsets、state-store updates、output topic writes 可以在同一 Kafka transaction semantics 中一起提交。但 Agent Tool 常常寫的是 Kafka 之外的世界：email、Google Drive、GitHub、MCP server、支付、Browser UI、第三方 DB。

因此：

```text
Replay Workflow Logic
≠
Replay External Side Effect
```

Hermes 應建立 Effect Boundary：

```text
Tool Intent
↓
Effect ID / Idempotency Key
↓
PREPARED
↓
DISPATCHED
↓
ACKED / UNKNOWN
↓
VERIFIED
↓
COMMITTED_TO_AGENT
```

Replay 遇到 effect 時：

```text
Effect Journal lookup
├ COMMITTED → inject historical result
├ ACKED → verify external state
├ DISPATCHED_UNKNOWN → reconcile first
├ PREPARED → safe to redispatch by policy
└ ABSENT → execute as new effect
```

這是本輪最重要的 Agent-specific replay boundary。

---

# Architecture Breakdown

```text
User / Sensor / Agent Input
↓
Agent Runtime
↓
Deterministic Core
├ Planner state machine
├ Context compiler
├ Memory graph projection
└ Workflow DAG
↓
Nondeterminism Boundary
├ LLM sample
├ Tool observation
├ Time / UUID / random
├ Message order
├ Retry / timeout
└ Branch winner
↓
Determinant Recorder
↓
Event / Message Log
├ event_id
├ causal parents
├ HLC
├ payload hash
├ result
├ capability epoch
└ branch identity
↓
Checkpoint
↓ crash
Recovery Planner
↓
Load checkpoint
↓
Replay event log
↓
Inject determinants
↓
Rebuild deterministic state
↓
Effect Boundary Gate
├ historical effect → inject/verify
├ uncertain effect → reconcile
└ new effect → execute
↓
Continuation Commit Gate
↓
Canonical Agent State
```

核心分層：

```text
STATE LOG
記「世界已經被推導成什麼狀態」

DETERMINANT LOG
記「哪些非決定性選擇讓世界走到這裡」

EFFECT JOURNAL
記「哪些事情真的對外部世界做了」
```

三者不可混為同一張 log。

---

# Bottom-Level Logic

## Replay 的最小 invariant

對事件 `e`：

```text
Reproducible(e)
=
Deterministic(e)
∨ DeterminantDurable(e)
∨ HistoricalResultInjectable(e)
```

若：

```text
¬Reproducible(e)
∧ Depend(e) ≠ ∅
```

則：

```text
Dependent state
→ ORPHAN-DERIVED
```

必須 rollback、quarantine 或 fork。

## External Effect Predicate

```text
ReplayEffectAllowed(effect) =
    Pure(effect)
∨   IdempotentWithStableKey(effect)
∨   VerifiedNotYetApplied(effect)
```

否則：

```text
STOP AUTOMATIC REPLAY
→ EFFECT RECONCILIATION
```

## Canonical Commit Predicate

```text
CommitRecoveredState(S) =
    AllRequiredDeterminantsAvailable(S)
∧   NoOrphanDependencies(S)
∧   EffectBoundaryReconciled(S)
∧   CapabilityEpochValid(S)
∧   BranchLineageValid(S)
```

---

# Visual Simulation Idea

## Deterministic Replay & Orphan-Process Lab

畫面左側是 4 條 timeline：

```text
Planner ─────────────────────────
Tool    ─────────────────────────
Memory  ─────────────────────────
GPU     ─────────────────────────
```

中央 Event Log：

```text
E41  LLM_SAMPLE = tool(search)
E42  TOOL_DISPATCH search#17
E43  TOOL_RESULT R7
E44  PLAN_NODE N8
E45  MEMORY_WRITE M9
```

使用者可以切換：

```text
PESSIMISTIC LOGGING
OPTIMISTIC LOGGING
CAUSAL LOGGING
```

並注入：

```text
CRASH BEFORE E43 DURABLE
DROP TOOL ACK
REORDER MESSAGE
RANDOM VALUE CHANGED
CODE VERSION CHANGED
DUPLICATE EFFECT
```

### Orphan 動畫

```text
R7 determinant LOST
↓
N8 depends on R7
↓
M9 depends on N8
↓
N8 / M9 turn RED

ORPHAN-DERIVED SUBGRAPH
```

再比較：

```text
Pessimistic:
R7 was durable before N8 escaped
→ no orphan

Optimistic:
R7 lost
→ rollback N8 + M9

Causal:
R7 determinant copy survived in causal dependent
→ reconstruct
```

### Replay Boundary 動畫

當 replay 走到：

```text
E42 SEND EMAIL
```

UI 顯示：

```text
EffectJournal:
DISPATCHED_UNKNOWN

Replay action:
DO NOT SEND AGAIN
VERIFY PROVIDER STATE FIRST
```

這會直接解釋「為什麼 durable Agent 不能只是重新跑一次 prompt」。

---

# Code / GitHub

## Temporal Java SDK

值得繼續追的核心檔案：

```text
temporal-sdk/src/main/java/io/temporal/internal/replay/
└ ReplayWorkflowContextImpl.java

temporal-sdk/src/main/java/io/temporal/internal/statemachines/
└ WorkflowStateMachines.java

temporal-sdk/src/main/java/io/temporal/workflow/
└ Workflow.java
```

觀察重點：

- `WorkflowStateMachines` 會根據 replay 狀態處理 command/message emission。
- `Workflow.sideEffect()` 用 history 保存一次性的 nondeterministic result，replay 時回傳歷史值而非重新產生。
- replay correctness 依賴「同樣 input/history → 同樣 command sequence」。

## Ray

Ray object fault tolerance 的 lineage reconstruction：若 object lost 且沒有 replica，Ray 可以重新執行產生該 object 的 task；但官方明確假設 task deterministic 且 idempotent，而且 lineage 本身有記憶體成本與 owner-liveness 限制。

因此：

```text
Lineage Reconstruction
≠
General Agent Replay
```

它非常適合 Agent 的 pure/recomputable artifact，但不適合直接拿來重播不可逆工具。

## Apache Flink

上一輪研究過 barrier / channel state；本輪延伸關注其 recovery 前提：durable source 必須可 replay，checkpoint 才能將 state 和 input progress 接回來。Flink 的這個設計可映射為 Agent 的：

```text
Checkpoint
+
Replayable Event Source
+
External Effect Sink Policy
```

---

# Papers

## A Survey of Rollback-Recovery Protocols in Message-Passing Systems

- **Title:** A Survey of Rollback-Recovery Protocols in Message-Passing Systems
- **Authors:** Elmootazbellah N. Elnozahy, Lorenzo Alvisi, Yi-Min Wang, David B. Johnson
- **Institution:** IBM Research / University research collaboration
- **Year:** 2002
- **URL:** https://doi.org/10.1145/568522.568525
- **Code:** N/A
- **Dataset:** N/A
- **Architecture:** checkpoint-based recovery + log-based recovery taxonomy
- **Contribution:** 系統化定義 coordinated/uncoordinated/communication-induced checkpointing 與 pessimistic/optimistic/causal message logging；以 determinant、orphan process、output commit 作為核心 correctness vocabulary。
- **Limitations:** 不是針對 LLM/Agent/GPU/MCP；外部 SaaS effect、branch speculation、model sampling 需重新映射。
- **改變了什麼：** 本輪用它把 Hermes recovery 從「checkpoint/replay」提升為「determinant durability + orphan prevention + effect commit」。

## DelAct: A Replayable Boundary Runtime for Auditable and Governed LLM Agent Workflows

- **Authors:** 依 IEEE 論文正式版本
- **Venue:** IEEE/ACM IWQoS 2026
- **Year:** 2026
- **URL:** https://doi.org/10.1109/IWQoS70441.2026.11661202
- **Code:** 本輪未確認正式 code repository
- **Dataset:** Ticket/Invoice workflow fault-injection workloads
- **Architecture:** control plane + tool/data plane + observability/event-log plane
- **Contribution:** 對 Agent 明確建立 deliberation 與 actuation 的 replayable boundary，用 commitment hash/idempotency/in-doubt verification/compensation 管理 side effects。
- **Limitations:** workload 仍集中在少數 tool workflow，不能直接代表 browser/GPU/video/embodied agent。
- **改變了什麼：** 強化本輪 External Effect Replay Boundary，證明 Agent replay 研究已從傳統 workflow 走向 tool-side settlement/governance。

## ActiveGraph: The Log is the Agent / Event-Sourced Reactive Graphs for Auditable, Forkable Agentic Systems

- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.21997
- **Code:** 本輪未完成 code-level verification
- **Dataset:** 依論文實驗配置
- **Architecture:** append-only event log as source of truth → deterministic graph projection → reactive behaviors
- **Contribution:** 把 log 從 observability 附屬品升級成 Agent runtime source of truth，支持 replay、fork、lineage。
- **Limitations:** event-sourced state consistency 不自動等於 external side-effect exactly-once。
- **改變了什麼：** 對 Hermes Knowledge Graph 提供「Event Log → Working Graph Projection」的直接架構參考。

---

# Unknown / Open Questions

1. **LLM Sampling Determinant 的粒度**：要記最終 token、logits、RNG state、sampling seed，還是 model/provider response envelope？不同粒度影響 replay fidelity、成本與跨模型版本可攜性。

2. **Cross-runtime causal determinant propagation**：ToolResult determinant 被 Planner、Memory、Evaluator、UI 同時依賴時，如何低成本維護 `Depend(e)`，而不是全圖掃描？

3. **External effect finality oracle**：很多 SaaS API 沒有 idempotency key 或 transaction status endpoint。`DISPATCHED_UNKNOWN` 如何在沒有可靠 read-back 的情況下安全解決，仍是最薄弱節點。

---

# 下一輪研究

優先：

## Event-Sourced Agent State × Log Compaction × Snapshot Projection × Schema Evolution × Replay Compatibility

原因：本輪把 event log / determinant log / effect journal 分開後，下一個 production 問題是：

```text
Event Log 10 億筆
↓
不能每次從 genesis replay
↓
Snapshot / Projection
↓
Log Compaction
↓
Code / Schema Version Upgrade
↓
舊 History 還能不能 replay？
```

下一輪應比較：

```text
Temporal Workflow Versioning
Kafka Log Compaction
Event Sourcing Snapshotting
Schema Registry / Upcaster
Projection Rebuild
Replay Compatibility Test
```

並建立：

```text
History Version
↓
Event Schema
↓
Upcaster / Migration
↓
Deterministic Projection
↓
Replay Compatibility Gate
```

---

# Knowledge Graph 新增 Node / Edge

## New Nodes

```text
Agent Determinant
Nondeterministic Event
Determinant Durability
Pessimistic Logging
Optimistic Logging
Causal Logging
Orphan Process
Orphan-Derived Artifact
Replayable Pure Logic
Historical Result Injection
Replay Command Matching
Replay Nondeterminism Error
Effect Replay Boundary
Effect Reconciliation
DISPATCHED_UNKNOWN
State Log
Determinant Log
Effect Journal
Output Commit Boundary
Lineage Reconstruction
```

## New Edges

```text
Nondeterministic Event
→ captured_as
Agent Determinant

Agent Determinant
→ persisted_in
Determinant Log

Derived State
→ causally_depends_on
Agent Determinant

Lost Determinant
→ may_create
Orphan-Derived Artifact

Checkpoint
→ anchors
Replay

Replay
→ injects
Historical Determinant

Replay Command
→ matched_against
Event History

External Effect
→ guarded_by
Effect Replay Boundary

DISPATCHED_UNKNOWN
→ requires
Effect Reconciliation

Lineage Reconstruction
→ reexecutes
Deterministic Idempotent Task
```

重要否定關係：

```text
Deterministic Replay
≠ Blind Re-execution

Checkpoint
≠ Replay Log

State Log
≠ Determinant Log

Determinant Log
≠ Effect Journal

Orphan Process
≠ Failed Process

Exactly-Once State Recovery
≠ Exactly-Once External Effect

Lineage Reconstruction
≠ General Agent Replay
```

---

# 本輪收斂回答

- **缺哪一層：** Event-sourced state 的長歷史 compaction / schema evolution / replay compatibility。
- **哪個節點最淺：** `DISPATCHED_UNKNOWN → Effect Reconciliation`，尤其第三方服務不可查狀態時。
- **哪個概念仍只是名詞：** Cross-Runtime Agent Determinant ABI。
- **哪個系統最值得讀原始碼：** Temporal SDK 的 replay/state-machine internals；其次 Ray lineage reconstruction。
- **哪篇論文需追引用：** Elnozahy et al. 2002 rollback-recovery survey；2026 DelAct；ActiveGraph。
- **哪個概念最適合視覺模擬：** Deterministic Replay & Orphan-Process Lab。
- **哪個 Agent 架構最值得實作：** `Checkpoint + Determinant Log + Event Projection + Effect Journal + Replay Boundary + Orphan Detector`。

核心結論：

> 真正可靠的 Agent replay 不是「把 Agent 再跑一次」。系統必須知道哪些步驟是 deterministic logic、哪些是 nondeterministic observation、哪些是已對真實世界產生 effect。只有 nondeterminism 被 durable determinant 固定、derived state 能追溯 determinant lineage、external effect 在 replay 時受 Effect Journal 與 reconciliation gate 保護，Agent 才能在 crash 後重建同一條 execution lineage，而不是創造一個看似合理、實際上歷史從未發生過的新世界。