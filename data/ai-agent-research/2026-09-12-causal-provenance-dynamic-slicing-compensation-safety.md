# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 09:56（Asia/Taipei）**

**本輪主題：Causal Provenance Inference × Read/Write Dependency × Dynamic Program Slicing × Evidence Lineage × Compensation Safety**

> 本輪延續上一輪的 `Probabilistic Clock Synchronization × Causal Time × Bitemporal State × Incremental Repair × Compensation`。上一輪已回答「晚到事件如何改寫歷史狀態」；本輪進一步處理更底層的問題：**一個事件、記憶、工具回傳、模型輸出到底實際影響了哪些 Agent 決策？如何自動切出最小受影響子圖，而不是整段 replay？又如何判斷外部效果是否能安全補償？**

---

## 本小時新發現

### 新論文 / 研究方向

1. **From Agent Traces to Trust: Evidence Tracing and Execution Provenance in LLM Agents** — Yiqi Wang et al., 2026。系統性整理 Agent execution provenance：retrieval evidence、tool output、memory、environment observation、intermediate claim、action 與 final answer 之間的 lineage。
2. **AgentTrails: Towards Trust and Reuse for Agentic Tasks** — Eden Wu, Sonia Castelo, Yurong Liu, Cláudio T. Silva, Juliana Freire, 2026。把 chronological trajectory 轉成 structured provenance graph，tool call 當 action，input/output 當 data artifact，支援多次 execution 的 graph comparison。
3. **The Log is the Agent: Event-Sourced Reactive Graphs for Auditable, Forkable Agentic Systems** — Yohei Nakajima, 2026。把 append-only event log 設為 source of truth，graph 為 deterministic projection，提供 replay / fork / diff / lineage。
4. **Causality Laundering: Denial-Feedback Leakage in Tool-Calling LLM Agents** — 2026。指出 flat provenance 不足，因為「被拒絕的 action 結果」本身也能因果影響後續 benign-looking tool call；提出 provenance graph + counterfactual causal edges。
5. **OpenTelemetry span links / trace DAG semantics** — 工程標準。parent-child 適合單一 parent；scatter/gather、batch、async operation 需要 span links，支援多來源 causal association。

### 新 GitHub / 原始碼

- `yoheinakajima/activegraph`
  - `activegraph/runtime/runtime.py`
  - `activegraph/runtime/context_reads.py`
  - `activegraph/core/graph.py`
  - `activegraph/runtime/promote.py`
  - event log / replay / fork / diff / trace-context-reads 已是實作能力，不只概念。

---

# 本小時最重要 5 個發現

## 1. Chronological Trace ≠ Causal Provenance

### 是什麼

一般 Agent log 常長成：

```text
10:00 memory read
10:01 tool call
10:02 tool result
10:03 planner
10:04 send email
```

但「排在前面」不代表「影響了後面」。真正需要的是：

```text
Memory M17 ───────┐
ToolResult T91 ───┼→ PlannerDecision D42 → SendEmail A8
Policy P3 ────────┘
```

### 底層如何運作

Hermes 應將 execution runtime 中的 dependency edge 分至少四種：

```text
READ_FROM
  State/Memory/Object → Behavior/Planner

DATA_DEPENDENCY
  ToolResult / ModelOutput → Argument / Claim / Artifact

CONTROL_DEPENDENCY
  Branch condition / policy decision → executed action

EFFECT_DEPENDENCY
  Action → external effect / changed world state
```

並保留：

```text
TEMPORAL_BEFORE
```

但絕不能把它當成 causal edge。

### 為什麼重要

上一輪的 late-event repair 若沒有真正 dependency graph，只能粗暴：

```text
late event
→ replay everything after timestamp
```

有 provenance DAG 後可以：

```text
late event
→ descendants(event)
→ only materially affected nodes
```

### 限制

自動建立 causal edge 很難：LLM 可能讀了 context 卻沒有實際使用；反過來，某些 influence 可能經 prompt summary、denial feedback 或 tool-side hidden state 間接傳遞。

### 來源

- AgentTrails (2026)
- From Agent Traces to Trust (2026)
- OpenTelemetry trace/span-link semantics

---

## 2. Read Set 是 Dynamic Slice 的最低可行底座，但 Read ≠ Influence

### 已確認工程實作

ActiveGraph `runtime.py` 已明確支援：

```text
EventStore
Runtime.load(...)
replay_strict
fork(at_event)
diff(other)
trace_context_reads
```

而 `context_reads.py` 在 `trace_context_reads=True` 時，會對每次 behavior execution 建 `ReadRecorder`，追蹤：

```text
ctx.view.objects(...)
graph.get_object(id)
LLM prompt assembly 中實際序列化進 prompt 的 objects
```

然後在 behavior commit 時 emit 一個：

```text
context.read
├ behavior
├ event_id
├ execution_event_id
├ object_ids[]
├ count
└ truncated?
```

這表示 Hermes 可以直接從 runtime instrumentation 建：

```text
Object / Memory Node
      │ READ_FROM
      ↓
Behavior Execution
```

### 但仍有重要缺口

ActiveGraph 文件也明列未追蹤：

```text
relation reads
event reads
triggering event argument
relation argument
tool 內部透過 raw Graph 的 reads
runtime-internal reads
```

所以：

```text
Tracked Read Set
≠
Complete Dependency Set
```

且：

```text
Read
≠
Causal Influence
```

例如 200 個 objects 進 prompt，但模型真正決策只使用其中 3 個。

### Hermes 建議

建立兩層 edge：

```text
OBSERVED_READ
  runtime 可證明有讀

INFERRED_INFLUENCE
  透過 perturbation / counterfactual / attribution 推測真正有影響
```

不要混為同一種 causal edge。

---

## 3. Dynamic Slicing 應以「Execution Instance」為單位，而不是只對原始碼做 static slice

傳統 program slicing 問：

```text
哪一些 statement 可能影響 variable x？
```

Agent runtime 更應問：

```text
這一次 Decision D42
實際依賴了哪些 runtime objects / tool results / model calls / memory reads？
```

因此 Hermes 的 slicing criterion 應是：

```text
SliceCriterion
├ decision_id
├ claim_id
├ action_id
├ state_revision_id
└ external_effect_id
```

### Backward dynamic slice

```text
Target Decision
↓ reverse traversal
READ_FROM
DATA_DEPENDENCY
CONTROL_DEPENDENCY
MODEL_DERIVATION
TOOL_RESULT_OF
STATE_DERIVED_FROM
↓
Minimal Provenance Slice
```

### Forward impact slice

```text
Late Event / Corrected Fact
↓ forward traversal
State nodes
→ prompts
→ decisions
→ actions
→ external effects
↓
Affected Slice
```

### 新架構意義

這讓 repair 從：

```text
ReplaySession(start=t)
```

變成：

```text
Repair(
  affected_subgraph(corrected_event)
)
```

並可用 event-sourced runtime 的 fork/diff 驗證：

```text
Old branch
vs
Corrected-event fork
↓
Decision divergence
↓
External-effect divergence
```

ActiveGraph 的 `fork()` / `diff()` 與 log replay 已提供一個可落地的工程模板。

---

## 4. Parent/Child Trace 不足以表達 Agent，多來源 decision 需要 DAG + Span Links 類語義

OpenTelemetry 把 Trace 描述成 span DAG；parent 表示單一 parent 關係，但 batch、scatter/gather、async flow 可用 `Link` 連到多個 causally-related spans。

這對 Agent 很重要，因為：

```text
PlannerDecision D
```

往往不是：

```text
one parent → D
```

而是：

```text
MemoryRead M ────┐
ToolResult T ────┼→ D
VisionEvidence V ┤
PolicyCheck P ───┘
```

因此 Hermes 不能用單一 `parent_id` 代表 provenance。

建議：

```text
CausalEdge
├ src
├ dst
├ edge_type
├ strength
├ evidence
├ observed_or_inferred
├ valid_time
├ system_time
└ confidence
```

Edge types 至少：

```text
TRIGGERED_BY
READ_FROM
DERIVED_FROM
CONTROLLED_BY
SUPPORTED_BY
CONTRADICTED_BY
RESULT_OF
AUTHORIZED_BY
DENIED_BY
EFFECT_OF
COMPENSATES
```

其中 `DENIED_BY` 很重要：Causality Laundering 顯示「拒絕結果」也能變成新資訊，若 provenance 只追成功 tool output，會漏掉 denial-induced causal influence。

---

## 5. Compensation Safety 需要依賴 DAG、Pivot Detection、Idempotency，而不是單純倒序 undo

### 已確認官方工程原則

Microsoft Azure 2026 Compensating Transaction / Saga 文件明確指出：

- compensation 不一定需要按照原操作的精確逆序；
- 某些 compensation 可平行；
- compensation 自己也可能失敗；
- 需要記錄 compensation progress；
- 每個 compensation step 應設計成 idempotent；
- 高影響或無法可靠自動化時，可能需要 human intervention；
- Saga 中存在 pivot transaction / point of no return。

### 對 Hermes 的推論

上一輪只有：

```text
Effect
→ compensation candidate
```

還不夠。

本輪應升級成：

```text
Affected External Effects
↓
Compensation Dependency DAG
↓
Classify Each Effect
├ REVERSIBLE
├ COMPENSATABLE
├ MITIGATABLE
└ IRREVERSIBLE
↓
Detect Pivot / Point-of-No-Return
↓
Topological Compensation Plan
↓
Idempotency + Retry Safety
↓
Residual Risk
↓
AUTO / HUMAN APPROVAL / BLOCK
```

不能假設：

```text
reverse(executed_actions)
```

就是安全 compensation order。

例如：

```text
reserve inventory
charge card
ship parcel
send confirmation
```

如果 `ship parcel` 已進物流不可攔截，退款仍可做，但「世界狀態」已跨過原本 Saga 的重要 pivot；後續可能變成 mitigation，而不是 restoration。

---

# Architecture Breakdown

```text
UI / Agent / Tool / MCP / Memory / Multimodal Runtime
↓
Execution Event Stream
↓
Provenance Instrumentation
├ Context Read Recorder
├ Tool Input/Output Links
├ Model Prompt/Response Links
├ Memory Read/Write Links
├ State Read/Write Links
├ Policy / Denial Links
└ External Effect Links
↓
Typed Causal Provenance DAG
↓
Execution Slice Engine
├ backward_slice(target)
├ forward_slice(source)
├ transitive_reduce()
└ uncertainty_edges()
↓
Bitemporal + Event-Sourced State
↓
Late Correction / New Evidence
↓
Affected Slice Discovery
↓
Fork Corrected Branch
↓
Selective Replay
↓
Decision / State / Effect Diff
↓
Compensation Safety Planner
├ dependency DAG
├ pivot detection
├ reversibility classification
├ idempotency check
├ residual-risk estimator
└ human gate
↓
COMMIT REPAIR / COMPENSATE / MITIGATE / ESCALATE
```

---

# Bottom-Level Logic

## Mechanism A — Runtime Read-From Edge Capture

```text
Behavior starts
↓
Create ReadRecorder
↓
Every allowed state/memory read
→ recorder.record(object_id)
↓
LLM prompt assembly
→ record every serialized object
↓
Behavior completes/fails
↓
Emit context.read
↓
Create graph edges:
Object ─READ_FROM→ Execution
```

這是 **observed provenance**，不是 inferred causality。

## Mechanism B — Minimal Dynamic Slice

對 target node `v`：

```text
S0 = {v}
S(k+1) = S(k) ∪ parents(S(k), allowed_dependency_types)
```

直到 fixed point。

允許的 edge type 依分析目的不同：

```text
Debug Slice:
READ_FROM + RESULT_OF + CONTROLLED_BY

Evidence Slice:
SUPPORTED_BY + DERIVED_FROM + RETRIEVED_FROM

Repair Slice:
STATE_DERIVED_FROM + READ_FROM + CONTROLLED_BY + EFFECT_OF
```

這比「所有 edge 都 traverse」更重要，否則 provenance graph 會退化成巨大 connected component。

## Mechanism C — Counterfactual Influence Validation

對候選 edge：

```text
X → Decision D
```

建立 branch：

```text
Original Run
vs
Run without X / with corrected X
```

若：

```text
Decision changes materially
```

可把 edge 從：

```text
OBSERVED_READ
```

提升為：

```text
COUNTERFACTUALLY_SUPPORTED_INFLUENCE
```

注意：對 stochastic LLM 必須多次 sampling 或固定 random seed / recorded model response，否則一次 divergence 不能證明 causality。

---

# Visual Simulation Idea

## **Agent Causal Slice & Repair Graph Lab**

主畫面是一張 execution DAG：

```text
UserGoal
   │
Memory M7 ─────┐
Search T4 ─────┼→ Planner D9 → Payment Retry A2 → Charge Effect E3
Policy P1 ─────┘
```

使用者點 `Charge Effect E3`：

```text
[Backward Slice]
```

只亮起真正祖先節點。

點 `Memory M7`：

```text
[Forward Impact]
```

只亮起受它影響的 decisions/actions/effects。

接著注入：

```text
Corrected Tool Result T4'
```

系統自動 fork：

```text
Original branch          Corrected branch
D9 = RETRY               D9' = DO NOT RETRY
A2 = charge              A2' = none
E3 = second charge       —
```

畫面產生：

```text
REPAIR SLICE SIZE: 7 nodes
FULL SESSION SIZE: 1,248 nodes
REPLAY SAVED: 99.4%
```

再進 compensation view：

```text
E3 second charge
↓
Refund candidate
↓
Idempotency key: OK
Dependency: no shipment dependency
Residual risk: LOW
[AUTO COMPENSATE]
```

若跨 pivot：

```text
Shipment released
↓
POINT OF NO RETURN
↓
Refund + recall attempt
Residual risk: HIGH
[HUMAN APPROVAL]
```

---

# Code / GitHub

## `yoheinakajima/activegraph`

值得讀：

```text
activegraph/runtime/runtime.py
```

重點：EventStore、load/replay、strict replay、fork、diff、tool loop、LLM loop、context read tracing。

```text
activegraph/runtime/context_reads.py
```

重點：`ReadRecorder`、`TracedView`、`context_read_payload()`；是 Hermes 建 runtime read-set provenance 最直接的參考。

```text
activegraph/core/graph.py
```

重點：event replay 與 projection。

```text
activegraph/runtime/promote.py
```

重點：fork base / parent-now / fork-now 的 three-way comparison，適合延伸成 corrected-history repair diff。

### 工程限制

目前 context read tracing 明確沒有涵蓋所有 relation/event/tool-internal reads，因此若 Hermes 直接照搬，會有 provenance blind spot。

---

# Papers / Reports

## 1. From Agent Traces to Trust: Evidence Tracing and Execution Provenance in LLM Agents

- Authors: Yiqi Wang et al.
- Year: 2026
- Type: Survey / conceptual framework
- URL: https://arxiv.org/abs/2606.04990
- Contribution: 把 evidence tracing / execution provenance 定義成 Agent 可驗證性核心問題。
- Limitation: Survey 本身不等於 production-ready instrumentation。
- 改變了什麼：把 final-answer evaluation 往 execution lineage 推進。

## 2. AgentTrails: Towards Trust and Reuse for Agentic Tasks

- Authors: Eden Wu, Sonia Castelo, Yurong Liu, Cláudio T. Silva, Juliana Freire
- Year: 2026
- Architecture: trajectory → provenance graph；tool call = computational action；I/O = artifacts；跨 execution 比較。
- Contribution: 將 Agent logs 轉成 dataflow/provenance graph。
- Limitation: provenance edge 主要描述 computational dependency，不代表所有 semantic causality。
- 改變了什麼：Agent debugging 從 timeline view 轉向 reusable dependency graph。

## 3. The Log is the Agent

- Author: Yohei Nakajima
- Year: 2026
- Code: https://github.com/yoheinakajima/activegraph
- Architecture: append-only event log → deterministic graph projection → reactive behaviors。
- Contribution: deterministic replay、fork、diff、lineage。
- Limitation: event sourcing 可保證 provenance/replay substrate，但無法自動證明所有 causal influence。

## 4. Causality Laundering: Denial-Feedback Leakage in Tool-Calling LLM Agents

- Year: 2026
- Architecture: provenance graph + denied-action nodes + counterfactual causal edges + integrity lattice。
- Contribution: 指出 flat data lineage 會漏掉 denial feedback 產生的資訊流。
- Limitation: 針對 security enforcement；不是 general-purpose complete causal inference。

## 5. OpenTelemetry Trace / Span Links

- Type: Engineering standard
- Contribution: trace 是 span DAG；link 支援 async / batch / scatter-gather 的多來源 causal association。
- Limitation: Link 本身通常只表「related/causally associated」，不會自動推論 semantic dependency。

---

# 已確認事實 / 推論 / 假說分層

## 已確認事實

- ActiveGraph 原始碼已有 event log replay、fork、diff、context read tracing。
- OpenTelemetry 支援 span links 對多個 causally-related spans 建關聯。
- Azure Saga / Compensating Transaction guidance 要求 progress persistence、idempotency，且 compensation 不一定逆序、可能失敗、可能需要人工介入。

## 論文結果

- AgentTrails 將 trajectory 轉成 provenance graph 並比較 execution。
- ActiveGraph 論文提出 log-primary runtime，主張 deterministic replay / fork / lineage。
- Causality Laundering 指出 denial feedback 可形成間接因果資訊流。

## 合理工程推論

- Hermes 可以把 ActiveGraph-style context.read 轉成 `READ_FROM` edge，再搭配 fork/diff 做 selective counterfactual replay。
- Dynamic causal slicing 可顯著縮小 late-event repair 範圍。
- Compensation planner 應基於 dependency DAG，而不是單純 reverse execution order。

## 尚未驗證假說

- `ObservedRead → CounterfactualInfluence` 的升級規則在 stochastic LLM Agent 上能否穩定校準。
- 如何以低成本估算 semantic influence，而不必對每個 read node 做完整 counterfactual rerun。
- provenance edge 的 confidence 如何形成可比較、可累積的 calibration。

---

# Unknown / Open Questions

## 1. Read 了，但真的影響決策嗎？

需要研究：

```text
prompt perturbation
causal mediation
influence function
counterfactual replay
activation / attention attribution
```

但 `attention weight` 不能直接等同 causal influence。

## 2. Tool 內部 hidden reads 怎麼追？

工具可能：

```text
ToolCall
↓
DB read
secret lookup
cache read
network request
```

Agent runtime 若只看到 tool input/output，會漏掉真正 data lineage。

## 3. Compensation 的安全證明怎麼做？

需要：

```text
precondition
postcondition
idempotency
external invariants
pivot state
residual risk
```

最後才能建立真正的 `CompensationSafetyCertificate`。

---

# Knowledge Graph 新增 Node

```text
Execution Provenance
Evidence Lineage
Runtime Read Set
Observed Read Edge
Inferred Influence Edge
Read-From Edge
Data Dependency
Control Dependency
Effect Dependency
Denial Feedback Edge
Causal Span Link
Dynamic Execution Slice
Backward Slice
Forward Impact Slice
Slice Criterion
Affected Subgraph
Selective Replay
Counterfactual Influence Test
Provenance Blind Spot
Compensation Dependency DAG
Pivot Transaction
Point of No Return
Compensation Safety
Residual Effect Risk
```

# Knowledge Graph 新增 Edge

```text
Object ─READ_FROM→ BehaviorExecution
ToolCall ─RESULTS_IN→ ToolResult
ToolResult ─DERIVED_INTO→ Decision
Decision ─CONTROLS→ Action
Action ─EFFECT_OF→ WorldEffect
DeniedAction ─INFORMS→ LaterDecision
LateCorrection ─INVALIDATES→ StateRevision
StateRevision ─AFFECTS→ Decision
ExternalEffect ─COMPENSATED_BY→ CompensationAction
Pivot ─BOUNDS→ CompensabilityRegion
```

# 關鍵否定關係

```text
Chronological Before ≠ Causal Dependency
Read ≠ Influence
Prompt Presence ≠ Decision Use
Trace Parent ≠ Complete Multi-Source Provenance
Event Log ≠ Semantic Causal Graph
Provenance ≠ Causal Proof
Rollback ≠ Compensation
Reverse Execution Order ≠ Safe Compensation Order
Tool Output Provenance ≠ Tool Internal Data Provenance
Attention ≠ Causal Attribution
```

---

# 下一輪研究

下一輪最值得轉向：

## **Semantic Influence Attribution × Counterfactual Replay × Tool-Internal Provenance × Provenance Completeness**

建議研究鏈：

```text
Observed Runtime Read Graph
↓
Candidate Influence Edges
↓
Counterfactual Perturbation
↓
Decision / Action Divergence
↓
Influence Score
↓
Tool-Internal Dataflow Instrumentation
↓
Provenance Coverage Metric
↓
Causal Slice Confidence
↓
Repair Certificate
```

應深入：

- LLM prompt/context attribution 與 causal mediation
- black-box counterfactual replay methods
- OpenTelemetry baggage/span-link 與 tool/MCP instrumentation
- database/query lineage
- model output claim-to-evidence attribution
- provenance completeness benchmark
- compensation pre/post-condition verification

---

# 本輪收斂回答

**缺哪一層？** 目前最缺 `Semantic Influence Attribution + Tool-Internal Provenance Layer`。

**哪個節點最淺？** `CounterfactualInfluenceTest` 與 `CompensationSafetyCertificate`。

**哪個概念仍只是名詞？** `ProvenanceCompletenessCertificate`、`CausalSliceConfidence`、`SemanticInfluenceEdge`。

**哪個系統最值得讀原始碼？** `yoheinakajima/activegraph`，尤其 `activegraph/runtime/context_reads.py` 與 `runtime.py`；下一步再追 OpenTelemetry SDK 的 span/link propagation implementation。

**哪篇論文需追引用？** `From Agent Traces to Trust`、`AgentTrails`、`The Log is the Agent`；security 線追 `Causality Laundering`。

**哪個概念最適合視覺模擬？** `Agent Causal Slice & Repair Graph Lab`。

**哪個 Agent 架構最值得實作？**

> **Causally-Instrumented Event-Sourced Agent Runtime = Event Log + Typed Provenance DAG + Runtime Read/Write Instrumentation + Dynamic Slice Engine + Counterfactual Fork/Diff + Bitemporal Repair + Compensation Dependency Planner + Safety Gate。**

---

## 這輪對「AI 到底怎麼運作」補上的一層

從：

```text
使用者一句話
→ UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory / Tool / MCP
→ Action
→ Output
```

進一步變成：

```text
每一步都產生 Event
↓
每次 Read / Write / Tool Result / Policy / Model Output
都形成 typed provenance edge
↓
Decision 不再只是黑盒節點
而有可追溯 dependency slice
↓
世界資料後來被修正時
Hermes 能知道到底哪些 decision/action 真正受到影響
↓
只 replay 最小 causal slice
↓
對已發生外部效果執行安全 compensation / mitigation
```

成熟 Agent 的核心因此不只是「會推理」，而是：**它能證明自己的某個判斷是由哪些資料、工具結果、記憶與規則導出的；當其中一個來源被推翻時，它能沿因果依賴圖找到最小受影響範圍，重新計算，並知道哪些現實世界效果需要被補償。**
