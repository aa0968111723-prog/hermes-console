# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 08:55（Asia/Taipei）**  
**主題：Probabilistic Clock Synchronization × Causal Time × Bitemporal State × Temporal-Causal DAG × Incremental State Repair × Compensating Transactions**

## 0. 與歷史研究比較

上一輪已建立：Event Time / Ingest Time / Processing Time / Commit Time、reorder buffer、watermark、temporal completeness frontier、late-event state repair，以及「State Rollback ≠ World Rollback」。本輪避免重複，往下一層解決五個尚未完成的問題：

1. 不同節點／感測器／MCP 的 timestamp 本身不完全可信時，如何表示時間不確定性？
2. 「時間先後」與「因果先後」如何分開？
3. 如何保存「世界何時為真」以及「Agent 何時知道」兩條時間軸？
4. late correction 發生後，如何只重算被影響的因果子圖，而不是 replay 全世界？
5. 如果錯誤 state 已導致外部副作用，如何用 compensation 修復，而不是幻想 world rollback？

---

# 一、本小時新發現

## 新架構
- **Probabilistic Temporal-Causal State Runtime**：Clock interval + causal clock + bitemporal store + causal DAG + affected-subgraph repair + compensation ledger。
- **Temporal Evidence Envelope**：事件不再只有 `timestamp`，而是 `{event_time_interval, HLC/logical_clock, source_clock, uncertainty, causal_parents}`。
- **Bitemporal World State**：把 valid time（世界何時成立）與 system/knowledge time（Hermes 何時得知）正式分離。
- **Causal Repair Frontier**：late event 不觸發全域 replay，而先算其 downstream causal descendants，再對受影響 state/actions 做 incremental recompute。
- **Compensation Causal Ledger**：補償不是刪掉歷史，而是新增一筆「修復既有副作用」的可追溯 action。

## 新論文 / 新研究
1. **Causal-Temporal Event Graphs: A Formal Model for Recursive Agent Execution Traces** — Simon Foldvik, Independent Researcher, 2026。形式化 recursive agent trace 的 causal-temporal graph，指出線性時間 log 無法可靠恢復 causal structure。URL: https://arxiv.org/abs/2604.17557
2. **Practically-self-stabilizing vector clocks without scheduling fairness** — Acta Informatica, 2026。研究 crash-prone asynchronous message-passing 中，在 transient fault 後可恢復的 vector-clock causality tracking。URL: https://link.springer.com/article/10.1007/s00236-026-00544-z
3. **DyC-STG: Dynamic Causal Spatio-Temporal Graph Network for Real-time Data Credibility Analysis in IoT** — Cheng et al., AAAI 2026。使用 event-driven dynamic graph + temporal precedence constrained causal reasoning 做即時資料可信度分析。URL: https://ojs.aaai.org/index.php/AAAI/article/view/36973
4. **TempReasoner: neural temporal graph networks for event timeline construction** — Mohammed Aldawsari, Prince Sattam Bin Abdulaziz University, Scientific Reports 2026。以 temporal KG、dynamic graph、multi-scale temporal attention 建立 event timeline。URL: https://www.nature.com/articles/s41598-026-35385-w

## 新 GitHub / 原始碼
- `cockroachdb/cockroach/pkg/util/hlc/`：實際 production Hybrid Logical Clock。核心：`doc.go`, `hlc.go`, `timestamp.go`, `hlc_test.go`。
- `fortressi/compensate`：Go Saga / compensation implementation。核心：`saga_executor.go`, `sagadag.go`, `dag.go`, `store.go`, `action_registry.go`, `examples/manual_rollback/`。

---

# 二、本小時最重要 5 個發現

## 1. Physical Time ≠ Causal Time

### 是什麼
兩個事件的 wall-clock timestamp 可以排序錯誤，尤其事件來自不同節點、不同手機、不同 MCP server、不同 provider 或 drifted sensor。

### 底層如何運作
Hybrid Logical Clock（HLC）把 timestamp 拆成：

```text
HLC = (physical_component, logical_component)
```

本地事件：

```text
physical = max(local_wall_clock, previous_physical)
if physical == previous_physical:
    logical += 1
else:
    logical = 0
```

收到 remote timestamp：

```text
physical = max(local_wall, local_hlc.physical, remote_hlc.physical)
logical  = tie-breaking increment based on which physical component won
```

CockroachDB 的 production HLC 會把 clock readings 附在 inter-node messages 上，接收節點再 forward local HLC，以保存 causal ordering。它同時明確使用 `max_offset` / uncertainty interval，因為 HLC 並不 magically 讓 physical time 精準。

### 為什麼重要
Hermes 不能只存：

```text
event.timestamp = 10:00:00.120
```

而應存：

```text
TemporalStamp
├ physical_time
├ logical_counter
├ source_clock_id
├ uncertainty_low
├ uncertainty_high
└ causality_token
```

### 限制
HLC 能維護 causal-compatible timestamp，但不能證明兩個沒有 causal communication 的 concurrent events 的真實 wall-time 順序。

### 來源
- CockroachDB HLC design/source: https://github.com/cockroachdb/cockroach/tree/master/pkg/util/hlc
- CockroachDB design: https://github.com/cockroachdb/cockroach/blob/master/docs/design.md

**分類：已確認官方工程實作。**

---

## 2. Temporal Order ≠ Causal Order

### 是什麼

```text
A.timestamp < B.timestamp
```

不等於：

```text
A caused B
```

同理：

```text
A and B arrived in order
```

也不代表任何 causal dependence。

### Agent 底層例子

```text
User Request
├→ Agent Tool Search
│   └→ Search Result
└→ Memory Read
    └→ Memory Result

Search Result + Memory Result
→ Planner Decision
```

Planner Decision 有兩個 causal parents。單一 linear trace：

```text
search
search_result
memory
memory_result
plan
```

看不出 `plan` 真正依賴哪些 inputs。

CTEG 研究正式指出 plain chronological log 不足以捕捉 recursive agent causal relationships，並以 explicit parenthood 建構 causal-temporal execution trace。但它目前採 single-parenthood arborescence；Hermes 的真實 tool/memory/fusion runtime 很常有 **multi-parent causal dependency**，因此需要 general DAG，而不是 tree。

### Hermes 模型

```text
CausalEvent
├ event_id
├ event_type
├ temporal_stamp
├ causal_parents[]
├ read_set[]
├ write_set[]
├ tool_effects[]
├ observation_sources[]
└ provenance
```

### 重要否定關係

```text
Earlier ≠ Cause
Later ≠ Effect
Total Order ≠ Causal DAG
Trace Position ≠ Dependency
```

### 來源
- CTEG: https://arxiv.org/abs/2604.17557
- 2026 vector-clock work: https://link.springer.com/article/10.1007/s00236-026-00544-z

**分類：論文結果 + Hermes 工程推論。**

---

## 3. Event Time / Commit Time 還不夠：World State 必須 Bitemporal

### 是什麼
需要同時保存：

```text
VALID TIME
世界中的事實何時成立？

SYSTEM / KNOWLEDGE TIME
Hermes 何時知道／寫入這件事？
```

例如：

```text
09:59 payment success      ← valid time
10:03 success event arrives← system/knowledge time
```

在 10:01，Hermes 當時合理相信 payment failed；到 10:03 才知道它其實在 09:59 已成功。

如果只有最新版資料：

```text
payment = success
```

就無法重建：

> Agent 在 10:01 到底看見了什麼，為什麼會 retry？

### Bitemporal State

```text
WorldFactVersion
├ fact_id
├ value
├ valid_from
├ valid_to
├ system_from
├ system_to
├ evidence_ids[]
├ causal_parents[]
└ revision
```

查詢 A：

```text
What was actually true at 09:59?
→ VALID AT 09:59 using latest knowledge
```

查詢 B：

```text
What did Hermes believe at 10:01?
→ AS OF system_time 10:01 + VALID AT 09:59
```

XTDB 的 production bitemporal model 正式維護 `_system_from/_system_to/_valid_from/_valid_to`；system time 表示資訊進系統的 audit history，valid time 表示事實在 modeled world 的有效期間，並明確支援 out-of-order updates/backfills。

### 來源
- XTDB key concepts: https://docs.xtdb.com/concepts/key-concepts.html
- XTDB time: https://docs.xtdb.com/about/time-in-xtdb.html

**分類：已確認官方資料庫語義 + Hermes 架構映射。**

---

## 4. Late Event Repair 應該是 Affected-Subgraph Replay，不是 Full Replay

### 問題
若 09:59 的 late event 在 10:03 抵達，最笨做法：

```text
重新 replay 整個 session
```

對長任務 Agent 不可行。

### 正確底層流程

```text
Late Event E
↓
Insert into bitemporal event store
↓
Locate state facts whose valid interval overlaps E
↓
Recompute directly derived facts
↓
Traverse causal DAG descendants
↓
Mark affected nodes DIRTY
↓
Incremental topological recomputation
↓
Compare old vs new state/action outputs
↓
Historical Decision Divergence
↓
No external effect? → replace derived state
External effect?    → compensation analysis
```

定義：

```text
Affected(E)
= descendants(E)
  ∩ nodes whose derivation depends on changed value
```

不能只用 timestamp window：

```text
all events after E.time
```

因為 10:02 的另一個完全獨立 Agent 分支可能與 payment 無關。

### 新增 Repair Frontier

```text
RepairFrontier
├ late_event_id
├ affected_state_nodes[]
├ affected_plan_nodes[]
├ affected_action_nodes[]
├ external_effect_nodes[]
├ recompute_order[]
└ repair_status
```

### 研究支持
DyC-STG 以 event-driven dynamic graph 與 temporal precedence 建立 dynamic causal spatio-temporal relation；CTEG 則說明 agent execution 必須保存 causal structure。將這兩者映射到 incremental repair 是合理工程推論，而不是論文本身已提出的 Agent repair algorithm。

### 來源
- DyC-STG (AAAI 2026): https://ojs.aaai.org/index.php/AAAI/article/view/36973
- CTEG: https://arxiv.org/abs/2604.17557

**分類：論文結構證據 + 尚待 Hermes 實證的工程設計。**

---

## 5. Compensation ≠ Undo；它是新的 Forward Action

### 問題
外部世界沒有 database rollback：

```text
send email
charge card
publish IG
delete cloud file
book ticket
open physical door
```

有些甚至不可逆。

因此：

```text
World Rollback
```

不存在。

真正能做的是：

```text
Old Effect
↓
Discover it was wrong
↓
Create NEW compensating effect
```

例如：

```text
charge $100
↓
late evidence says charge should not happen
↓
refund $100
```

`refund` 不是把 `charge` 從歷史移除，而是一個新的 transaction。

### Saga 原始碼觀察
`fortressi/compensate/saga_executor.go` 有明確 action state machine：

```text
pending
running
completed
failed
undoing
undone
```

Execution failure 後會走 `compensate()`，目前實作是把 completed actions 逆序呼叫 `UndoIt()`；它也持久化 saga state 與 execution trace。

這是一個好 runtime reference，但對 Hermes 還不夠：Azure 2026 官方 compensating-transaction guidance 明確指出 compensation **不一定必須是原操作的完全反序**、compensation 自己也可能失敗、需要記錄進度並設計成 idempotent；高影響／難自動化情況可能要 human intervention。

因此 Hermes 應區分：

```text
REVERSIBLE
COMPENSATABLE
MITIGATABLE
IRREVERSIBLE
```

而不是每個 Tool 都硬塞 `undo()`。

### CompensationRecord

```text
CompensationRecord
├ original_effect_id
├ reason_event_id
├ repair_revision
├ compensation_type
├ compensation_action
├ idempotency_key
├ preconditions
├ expected_residual_risk
├ status
└ human_approval_required
```

### 來源
- GitHub: https://github.com/fortressi/compensate
- Azure Compensating Transaction Pattern (updated 2026): https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction
- Azure Saga Pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/saga

**分類：官方工程 pattern + GitHub source + Hermes 延伸設計。**

---

# 三、Architecture Breakdown

```text
Camera / Audio / Video / UI / Tool / MCP / Memory / Agent
↓
Temporal Envelope Builder
├ event_time estimate
├ timestamp uncertainty interval
├ HLC
├ vector/causal token when needed
├ source clock
└ ingest/system time
↓
Causal Dependency Extractor
├ explicit parent
├ read-from relation
├ tool-call → observation
├ memory-read → decision
├ subagent → parent continuation
└ multimodal evidence → fused state
↓
Bitemporal Event / State Store
├ VALID TIME
└ SYSTEM / KNOWLEDGE TIME
↓
World-State Materializer
↓
Planner / Reasoning
↓
Action Execution
↓
Effect Ledger
↓
Late / Corrective Event
↓
Temporal-Causal Repair Engine
├ insert historical fact
├ affected-subgraph discovery
├ incremental recomputation
├ old/new decision diff
└ side-effect impact analysis
↓
Repair Policy
├ STATE_ONLY_REPAIR
├ VERIFY_WORLD
├ REPLAN
├ COMPENSATE
├ MITIGATE
└ HUMAN_ESCALATION
↓
Compensation Executor
↓
New bitemporal revision + causal edges
```

---

# 四、Bottom-Level Logic

## A. Time envelope

Hermes 不再接收：

```json
{"timestamp": "2026-09-12T10:00:00.123"}
```

而是：

```text
TemporalEnvelope
{
  physical_estimate,
  uncertainty_interval=[earliest, latest],
  hlc=(wall, logical),
  source_clock_id,
  ingest_time,
  causal_parents,
  confidence
}
```

### 排序規則

1. 有明確 causal edge：causal order 優先。
2. 無 causal edge且 physical intervals 不重疊：可安全建立 physical-before relation。
3. intervals 重疊：標記 `CONCURRENT_OR_UNRESOLVED`，不要硬製造 total order。
4. UI 如需要穩定顯示，可用 HLC/ID 做 deterministic display order，但必須標示：

```text
DISPLAY ORDER ≠ PROVEN CAUSAL ORDER
```

## B. Causal merge

```text
Observation O1
Observation O2
Memory M3
↓
Decision D
```

D 應直接存：

```text
parents = [O1,O2,M3]
```

而不是靠 `timestamp < D.timestamp` 事後猜。

## C. Incremental repair

```text
changed = {late_event}
queue = direct_dependents(changed)

while queue not empty:
    node = pop_topological(queue)
    new_value = recompute(node, repaired_inputs)
    if new_value != old_value:
        mark revised
        enqueue dependents(node)
```

只有 value / decision materially changed 的 branch 才繼續傳播 dirty status。

## D. Compensation planning

```text
Historical Decision Divergence
↓
Find external-effect descendants
↓
For each effect:
    classify reversibility
    query current world state
    check compensation preconditions
    calculate residual harm
↓
choose:
    no-op
    reverse
    compensate
    mitigate
    human approval
```

---

# 五、Visual Simulation Idea

## **Causal Time Machine & Repair Simulator**

### View 1 — Physical vs Causal Time

```text
Node A clock: 10:00:00.120
Node B clock: 10:00:00.080

A SEND ───────────────→ B RECEIVE

Wall timestamps:
B appears earlier ⚠

Causal clock:
A SEND → B RECEIVE ✓
```

UI 可以切換：

```text
[Wall Time]
[HLC]
[Causal DAG]
[Uncertainty Interval]
```

### View 2 — Bitemporal State

橫軸 1：World / Valid Time  
橫軸 2：Hermes Knowledge / System Time

```text
VALID TIME       09:59 payment=SUCCESS
SYSTEM TIME      10:03 Hermes learns SUCCESS
```

把 cursor 拉回 10:01：

```text
WORLD TRUTH (latest reconstructed): SUCCESS
HERMES BELIEF AT 10:01: FAILED
```

### View 3 — Late Event Repair

```text
late event
   │
   ▼
payment state r1 ─→ retry decision ─→ charge #2 ⚠
   │
   └→ unrelated weather branch       (not replayed)
```

點擊 `REPAIR`：

```text
payment state r2
→ retry decision becomes NO_RETRY
→ charge #2 marked historical divergence
→ compensation planner proposes refund
```

### View 4 — Compensation

```text
ORIGINAL EFFECT
charge #2  $100

CAN UNDO?        NO
CAN COMPENSATE?  YES

PROPOSED
refund $100
idempotency key: repair-742:charge2
residual risk: low
```

---

# 六、Code / GitHub

## 1. CockroachDB HLC
Repository: https://github.com/cockroachdb/cockroach

值得讀：

```text
pkg/util/hlc/doc.go
pkg/util/hlc/hlc.go
pkg/util/hlc/timestamp.go
pkg/util/hlc/hlc_test.go
pkg/kv/kvserver/uncertainty/
```

值得學的不是「直接拿 Cockroach clock」，而是：
- physical + logical timestamp split
- remote timestamp forwarding
- strict monotonicity
- max clock offset assumption
- transaction uncertainty interval
- observed timestamps

## 2. fortressi/compensate
Repository: https://github.com/fortressi/compensate

值得讀：

```text
saga_executor.go
sagadag.go
dag.go
dag_builder.go
store.go
action_registry.go
examples/manual_rollback/
examples/persistent_cli/
```

`SagaExecutor` 已有：

```text
DAG
→ topological execution
→ persistent state
→ failure
→ compensation
→ reverse completed actions
```

Hermes 需要再補：

```text
causal provenance
bitemporal validity
late-event-triggered compensation
effect reversibility class
idempotency
compensation failure recovery
human escalation
```

---

# 七、Papers

## Paper A
**Title:** Causal-Temporal Event Graphs: A Formal Model for Recursive Agent Execution Traces  
**Authors:** Simon Foldvik  
**Institution:** Independent researcher  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2604.17557  
**Code:** 未發現官方 code requirement；論文為 formal model  
**Dataset:** N/A  
**Architecture:** typed rooted causal-temporal arborescence + recursive subagent grafting  
**Contribution:** 把 agent execution 的 temporal order 與 causal parenthood一起形式化；可 compositional 建構 recursive traces；可 relational encode / Merkle commit。  
**Limitations:** single-parent causal semantics；不回答 parent assignment 本身是否「因果正確」；真實 Agent fusion 常有 multi-parent dependency。  
**改變了什麼:** 把「Agent trace = linear log」推進成「Agent trace = explicit causal-temporal structure」。

## Paper B
**Title:** Practically-self-stabilizing vector clocks without scheduling fairness  
**Authors:** 請以下一輪 bibliographic audit 補完整作者欄  
**Venue:** Acta Informatica  
**Year:** 2026  
**URL:** https://link.springer.com/article/10.1007/s00236-026-00544-z  
**Architecture:** asynchronous crash-prone message-passing + self-stabilizing vector clock  
**Contribution:** transient faults 後仍能實現 practical self-stabilization / wait-free recovery 的 causal event ordering。  
**Limitations:** vector clocks metadata 隨 participants 增加；不是 multimodal Agent runtime 直接設計。  
**改變了什麼:** 提醒 Hermes causal clock 本身也可能遭 transient corruption，不能把 clock metadata 視為永遠正確。

## Paper C
**Title:** DyC-STG: Dynamic Causal Spatio-Temporal Graph Network for Real-time Data Credibility Analysis in IoT  
**Authors:** Cheng, G.; Li, B.; Wu, P.; Chen, F.; Zhao, X.; Zhu, M.; Deng, S.  
**Venue:** AAAI 2026  
**Year:** 2026  
**URL:** https://ojs.aaai.org/index.php/AAAI/article/view/36973  
**Dataset:** 兩個 real-world datasets（論文釋出）  
**Architecture:** event-driven dynamic graph + causal reasoning constrained by temporal precedence  
**Contribution:** graph topology 隨 physical state/event 變化，並用 causal temporal structure 做 IoT credibility analysis。  
**Limitations:** credibility analysis ≠ Agent action repair；graph causality仍需 domain assumptions。  
**改變了什麼:** 支持 Hermes 把 dynamic causal graph 當成 streaming state component，而不是一次建好永不變。

## Paper D
**Title:** TempReasoner: neural temporal graph networks for event timeline construction  
**Author:** Mohammed Aldawsari  
**Institution:** Prince Sattam Bin Abdulaziz University  
**Year:** 2026  
**URL:** https://www.nature.com/articles/s41598-026-35385-w  
**Dataset:** five benchmark datasets  
**Architecture:** temporal knowledge graph + adaptive GNN + multi-scale temporal attention + temporal consistency loss  
**Contribution:** automated event timeline construction；論文報告 event ordering accuracy 94.3%、平均 127 ms/event sequence。  
**Limitations:** learned ordering accuracy ≠ causal proof；不應直接當 Hermes 的 authoritative causal ordering layer。  
**改變了什麼:** 顯示 learned temporal graph 可作輔助排序器，但 Hermes 核心 causal ledger 必須保留 provenance/uncertainty，而不是只存模型預測順序。

---

# 八、已確認事實 / 推論 / 假說分層

## 已確認事實 / 官方資訊
- CockroachDB production 使用 HLC，physical + logical time；inter-node message 會傳遞 timestamp；bounded max offset 被用於 uncertainty reasoning。
- XTDB 明確維護 system time 與 valid time兩個 temporal dimensions。
- Azure compensating transaction guidance 明確指出 compensation 可失敗、要保存 progress、應 idempotent、且不一定按原始操作反序執行。

## 論文結果
- CTEG：agent recursive trace 可建成 causal-temporal event graph，但使用 single-parent causal semantics。
- DyC-STG：event-driven dynamic causal-spatiotemporal graph 對 IoT credibility 有效。
- TempReasoner：神經 temporal graph 可改善 event timeline ordering，但它是 learned ordering，不是 causal proof。

## 工程推論
- Hermes 應把 `valid time + system time + causal DAG + uncertainty interval` 合併為 world-state provenance substrate。
- Late event repair 應透過 causal descendants做 incremental replay。
- compensation 應與 late-event repair pipeline 原生整合。

## 尚未驗證假說
- 以 HLC + sparse vector-clock/causal-parent edges 的 hybrid representation，可以在 Hermes Agent runtime 中比純 vector clock 更好地平衡 metadata 成本與 causal fidelity。
- `Affected-Subgraph Replay` 對長程 Agent workflow 會顯著低於 full replay 成本，同時維持正確ness；仍需實際 benchmark。

---

# 九、Unknown / Open Questions

1. **Causal parent 怎麼自動推導？** ToolCall→ToolResult 很容易，但 LLM decision 同時受 context、memory、tool results、system policy 影響；不能把 attention score 當 causal provenance。
2. **多 Agent 規模下要用 HLC、vector clock、interval tree clock，還是 explicit DAG？** Metadata / query cost / causality precision 還需要 benchmark。
3. **Compensation Safety 如何證明？** 一個退款、刪除、撤文 action 本身可能觸發新的 side effect；需要 compensation-of-compensation 與 pivot / point-of-no-return semantics。

---

# 十、下一輪研究

下一輪應進入：

# **Causal Provenance Inference × Read/Write Dependency × Dynamic Program Slicing × Compensation Safety**

研究鏈：

```text
Agent Runtime Trace
↓
Explicit Tool / Memory / State Reads
↓
Read-From / Write-After / Control Dependency
↓
Dynamic Causal Slice
↓
Late Correction
↓
Minimal Affected Slice
↓
Action Divergence
↓
Compensation Dependency DAG
↓
Point-of-No-Return / Pivot Detection
↓
Safe Compensation Plan
↓
Repair Certificate
```

優先追：
- dynamic program slicing / provenance graph
- database read-from dependencies
- OpenTelemetry span links vs true causal provenance
- Saga pivot transactions
- compensation ordering under parallel DAG execution
- idempotency / deduplication / exactly-once illusion
- irreversible external effects

---

# 十一、Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Hybrid Logical Clock
Physical Clock Component
Logical Counter
Clock Uncertainty Interval
Clock Skew Bound
Causal Clock
Vector Clock
Causal Concurrency
Temporal Evidence Envelope
Bitemporal State
Valid Time
System Time
Knowledge Time
Temporal-Causal DAG
Causal Parent
Read-From Edge
World-State Revision
Repair Frontier
Affected Subgraph
Incremental Replay
Historical Decision Divergence
Effect Ledger
Compensation Action
Compensation DAG
Idempotency Key
Irreversible Effect
Residual Risk
```

## 新 Edges

```text
HybridLogicalClock COMBINES PhysicalTime
HybridLogicalClock COMBINES LogicalTime
TemporalEnvelope CARRIES ClockUncertainty
CausalEvent HAS_PARENT CausalEvent
WorldFact HAS_VALID_TIME ValidInterval
WorldFact HAS_SYSTEM_TIME KnowledgeInterval
LateEvent INVALIDATES HistoricalStateRevision
LateEvent TRIGGERS RepairFrontier
RepairFrontier SELECTS AffectedSubgraph
AffectedSubgraph CONTAINS HistoricalDecisionDivergence
HistoricalDecisionDivergence MAY_REQUIRE CompensationAction
CompensationAction COMPENSATES ExternalEffect
CompensationAction CREATES NewExternalEffect
```

## 新否定關係

```text
Wall-Clock Order ≠ Causal Order
HLC Order ≠ Proof Of Real-Time Order For Concurrent Events
Temporal Order ≠ Causality
Linear Trace ≠ Causal Provenance
Event Time ≠ Knowledge Time
Current Truth ≠ What Agent Knew Then
Late Correction ≠ Full Replay Required
State Rollback ≠ World Rollback
Compensation ≠ History Deletion
Compensation ≠ Exact Inverse
Undo Function Exists ≠ Effect Is Safely Reversible
```

---

# 十二、本輪結束回答

**缺哪一層？**  
缺 `Causal Provenance / Dynamic Dependency Slicing Layer`：現在知道要存 causal graph，但「哪些 context/memory/tool facts 真正是某個 decision 的必要依賴」仍未完全自動化。

**哪個節點最淺？**  
`CompensationSafetyCertificate` 與 `AutomaticCausalParentInference`。

**哪個概念仍只是名詞？**  
`TemporalCausalRepairCertificate`、`CompensationSafetyCertificate`、`AgentBitemporalWorldABI`、`HybridCausalClock`。

**哪個系統值得讀原始碼？**  
第一優先：CockroachDB `pkg/util/hlc/` 與 `pkg/kv/kvserver/uncertainty/`。第二優先：`fortressi/compensate/saga_executor.go`、`sagadag.go`、持久化 Store 與 manual rollback examples。

**哪篇論文需追引用？**  
`Causal-Temporal Event Graphs`：下一輪要沿其引用追 agent provenance / recursive tracing；另外追 2026 self-stabilizing vector clock 對 fault recovery 的 clock semantics。

**哪個概念最適合視覺模擬？**  
`Causal Time Machine & Repair Simulator`：同時切 Wall Time / HLC / Causal DAG / Bitemporal Knowledge，插入 late event 後動畫展示 affected-subgraph repair 與 compensation。

**哪個 Agent 架構最值得實作？**

> **Bitemporal Causal-Repair Agent Runtime = Temporal Evidence Envelope + HLC/Uncertainty + Explicit Causal DAG + Bitemporal World Store + Versioned State Materializer + Effect Ledger + Affected-Subgraph Incremental Replay + Compensation Planner + Repair Certificate。**

---

# 核心收斂

這輪把「AI 到底怎麼運作」再補上一層：成熟 Agent 不能只有一條 chronological log。它需要同時回答四個不同問題：

```text
這件事在世界中何時發生？
Hermes 何時知道？
它因果上依賴什麼？
如果後來發現當時的世界模型錯了，哪些決策與副作用真的需要修？
```

所以最終資料結構不應是：

```text
(timestamp, message)
```

而應逐步收斂為：

```text
(event-time uncertainty,
 system/knowledge time,
 causal parents,
 evidence provenance,
 state revision,
 action/effect lineage,
 repair/compensation lineage)
```

這才足以讓 Hermes 從「會執行工具的聊天 Agent」走向「能解釋自己當時知道什麼、為什麼這樣做，以及事後如何安全修正世界影響的可驗證 Agent Runtime」。