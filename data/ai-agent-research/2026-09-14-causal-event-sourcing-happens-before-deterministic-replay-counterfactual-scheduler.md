# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-14 15:50（Asia/Taipei）

## 本小時研究主題
**Causal Event Sourcing × Happens-Before Clocks × Deterministic Replay × Side-Effect Barriers × Counterfactual Scheduler**

本輪承接上一輪 `Termination Policies × Competing Risks × Async Event DAG × Concurrent Option OPE`，不再重複 option/termination 定義，而是回答更底層的問題：

> 當 Agent 同時執行 research、memory、browser、safety、MCP/tool 等工作時，如何記錄足夠的事件因果資訊，使一次執行能被可靠 replay、fork、diff，並在不重複真實 side effect 的前提下研究「如果 scheduler / priority / event ordering 改變，結果會不會不同？」

---

# 本小時新發現

### 新架構
1. **Causal Event Sourcing Runtime**：Event log 不只記 timestamp，而記 causal parents、logical clock、effect class、idempotency、replay policy。
2. **Replay Barrier Runtime**：把 model/tool/read-only call 與 irreversible external write 分開處理。
3. **Counterfactual Scheduler Sandbox**：只有在 event/effect dependency 可重建時，才允許交換 concurrent event order 做反事實 replay。
4. **AgenticStash**：2026 Agent record/replay 專案，攔截 model/tool/MCP/time/randomness，支援 deterministic replay、fork、diff 與 divergence detection。
5. **Temporal-style Event History**：workflow state 由 event history replay 重建；workflow code 必須在相同歷史下產生相同 command sequence。

### 新底層節點
- Happened-Before Relation
- Lamport Logical Clock
- Vector Clock / Causal Frontier
- Deterministic Command Replay
- Replay Divergence
- Replay Barrier
- Side-Effect Class
- Idempotency Key
- Effect Receipt
- Counterfactual Scheduler
- Schedule Equivalence Class
- Causal Cut
- Replay Safe Prefix

---

# 本小時最重要 5 個發現

## 1. Wall-clock order ≠ causal order

### 是什麼
Lamport 在 1978 年正式定義 distributed system 中的 `happened-before (→)`：

- 同一 process 內先發生的 event：`a → b`
- message send → corresponding receive
- transitive closure

沒有 `a → b` 也沒有 `b → a` 的兩個事件，可視為 concurrent。

### 底層如何運作
Hermes 現在若只記：

```text
15:50:01.102 MemoryWrite
15:50:01.104 PlannerReplan
15:50:01.106 SafetyCheck
```

只能看到物理時間接近，不能證明：

```text
MemoryWrite → PlannerReplan
```

真正需要：

```text
Event {
  event_id
  actor_id
  local_seq
  lamport_clock
  vector_clock / causal_frontier
  parent_event_ids[]
  reads_state_versions[]
  writes_state_versions[]
}
```

Lamport clock 可以產生與 causal order 一致的 logical total order，但單一 scalar clock 不能完整判斷 concurrency；vector-clock 類資訊才可直接比較兩事件是否有 causal precedence 或 concurrent。

### 為什麼重要
Counterfactual scheduler 若把真正有因果依賴的事件交換順序，產生的不是「另一個合法 scheduler」，而是一個不可能 execution。

### 限制
Vector clock 在 actor 數量大、動態 agent/tool 數量高時有 metadata 成本，因此 production 可使用 causal-parent DAG、compressed version vector 或 trace-span ancestry 替代完整 dense vector。

### 來源
- Leslie Lamport, *Time, Clocks, and the Ordering of Events in a Distributed System*, CACM, 1978.
- Friedemann Mattern / Colin Fidge 後續 vector-clock 路線。

---

## 2. Event history replay ≠重新執行所有事件

### 是什麼
Temporal durable execution 的核心不是「從 checkpoint 接著跑」而已，而是：

```text
Event History
↓
Workflow code re-executes
↓
Past Activities / Timers / Signals
→ return recorded result
↓
Commands must match historical command sequence
↓
History exhausted
↓
only then issue new real commands
```

### 底層如何運作
若 workflow 原本歷史是：

```text
1 Schedule Search
2 Search Completed(result=A)
3 Schedule Read
4 Read Completed(result=B)
```

replay 時 `Search` 與 `Read` 不應再打外部 API，而是由 history 回放 A/B。若新程式碼在 step 3 改成 `Schedule ToolCall`，runtime 應偵測 non-determinism / divergence。

### 對 Agent 的對應
LLM Agent runtime 應把 nondeterminism 全部 journal：

```text
LLM output
Tool response
MCP response
Clock
Randomness
User interrupt
Browser observation
Retriever result
Scheduler decision
```

否則同一 prompt 重新呼叫模型並不是 replay，只是 another run。

### 限制
Workflow deterministic replay 假定 workflow logic 的 nondeterminism 被隔離；LLM Agent 的 model output、stream timing、tool latency、external state 更廣，因此需要更大的 nondeterminism boundary。

---

## 3. AgenticStash 顯示：Replay 的核心 join key 是「call identity + input fingerprint」

本輪不只讀 README，實際深入 `davccavalcante/agenticstash`：

```text
src/
├ record/
├ replay/
├ fork/
├ diff/
├ interceptors/
├ mcp/
├ storage/
├ seal/
├ hash.ts
├ types.ts
└ wire.ts
```

其中 `src/replay/index.ts` 會依：

```text
(channel, key)
```

維護 recorded-event cursor，並檢查當前 input hash 是否與錄製時 `inputRef` 相同。

執行鏈：

```text
Agent code asks channel/key
↓
find next recorded event
↓
compare current input hash vs inputRef
↓
MATCH
→ consume event
→ return recorded result / rethrow recorded error

MISMATCH
→ ERR_DIVERGENCE
或 collect divergence
```

它也辨識：

```text
input-mismatch
extra-call
missing-call
```

這比單純 trace viewer 更接近「replay validator」。

### 重要差異
但 `(channel,key)+ordinal` 仍主要保留 sequence semantics；對真正 concurrent Agent，Hermes 還需補：

```text
causal_parent_ids
scheduler_epoch
logical_clock
resource/version dependencies
```

才能知道兩個 recorded calls 是必須先後，還是只是在原 run 裡碰巧先後。

---

## 4. Deterministic replay ≠ side effect 可以安全重做

### 核心例子

```text
Tool: transfer_money(amount=1000)
```

即使 model output、tool args、clock 都完全 replay deterministic，也不能在 replay 時再次呼叫真實支付 API。

因此 Hermes 必須把 effect class 變成一級 runtime concept：

```text
EffectClass
├ PURE
├ READ_ONLY
├ IDEMPOTENT_WRITE
├ NON_IDEMPOTENT_WRITE
├ HUMAN_SIDE_EFFECT
└ IRREVERSIBLE_EXTERNAL_EFFECT
```

每次 tool call 應建立：

```text
EffectReceipt
├ effect_id
├ tool_name
├ input_hash
├ effect_class
├ idempotency_key
├ external_receipt_id
├ committed_at
├ reconciliation_status
└ replay_policy
```

### Replay policy

```text
PURE
→ recompute or replay

READ_ONLY
→ replay recorded result by default

IDEMPOTENT_WRITE
→ may resume using idempotency key + external receipt

NON_IDEMPOTENT_WRITE
→ never blind replay

UNKNOWN COMMIT STATE
→ RECONCILIATION REQUIRED
```

Salvor 2026 的設計也採取類似原則：工具宣告 read/write/idempotent；若 write 在 crash 時處於不確定狀態，不會 blind replay，而要求 reconciliation；跨 run exactly-once 需要 tool 提供 idempotency key。

### 重要 edge

```text
Deterministic Replay
≠ Exactly-Once External Effect
```

真正可保證的通常是：

```text
at-least-once execution
+
idempotency / receipt reconciliation
→ effect-level practical exactly-once semantics
```

而不是 runtime 魔法消除現實世界的 duplicate side effect。

---

## 5. Counterfactual scheduler 必須只交換「causally swappable」events

如果原 run：

```text
A: Browser read page
B: Memory compact
C: Safety monitor reads tool output
D: Planner chooses final action
```

而 causal DAG 是：

```text
A ───────→ D
C ───────→ D

B   (concurrent with A,C before D)
```

那 scheduler simulator 可以研究：

```text
A,B,C,D
B,A,C,D
C,B,A,D
```

但不能研究：

```text
D,A,C,B
```

因為 D 依賴 A/C。

因此 counterfactual scheduler 的搜尋空間不是所有 permutation：

```text
n!
```

而是 DAG 的 **topological sorts / linear extensions**。

### Hermes 新 bottom-level mechanism

```text
Recorded events
↓
Build causal DAG G=(V,E)
↓
Compute causal frontier
↓
Find pair (a,b)
where a ∦ b and no shared irreversible-effect conflict
↓
Swap / reorder within legal topological schedule
↓
Replay deterministic prefix
↓
Inject counterfactual scheduling decision
↓
Run sandbox/live-tail after divergence
↓
Compare outcome / permissions / latency / cost
```

這讓「如果 Memory compaction 比 Safety decision 早 20ms」從不可驗證猜測，變成有明確 causal constraint 的 simulation。

---

# Architecture Breakdown

## Causal Event-Sourced Agent Runtime

```text
User / Sensor / Model / Tool / MCP / Memory / Scheduler
↓
Event Interceptor Layer
↓
Canonical Event Envelope
├ event_id
├ actor_id
├ run_id
├ option_id
├ wall_clock
├ logical_clock
├ causal_parents[]
├ input_hash
├ output_hash
├ state_reads[]
├ state_writes[]
├ effect_class
└ policy/model/tool versions
↓
Append-Only Event Store
↓
Causal DAG Builder
↓
State Fold / Materialized Views
↓
Replay Engine
├ deterministic event substitution
├ divergence detector
├ missing/extra event detector
├ version guard
└ replay barrier
↓
Effect Reconciliation Layer
↓
Counterfactual Scheduler Sandbox
↓
Fork / Diff / Regression / OPE / Failure Analysis
```

### Runtime rule

Agent 的 state 不應只被當成一個 mutable JSON blob：

```text
state = latest snapshot
```

而應可理解為：

```text
S_t = Fold(S_0, E_1 ... E_t)
```

snapshot 只是 acceleration：

```text
Event log = source of causal truth
Snapshot = replay optimization
```

---

# Bottom-Level Logic

## A. Happens-before

```text
a → b
```

若：
1. a、b 在同一 actor/process 且 a 在 b 前；或
2. a 是 message/tool-result send，b 是 receive/consume；或
3. 存在 c，使 `a→c` 且 `c→b`。

若：

```text
¬(a→b) ∧ ¬(b→a)
```

則：

```text
a || b
```

表示 causal concurrency，不等於物理時間完全同時。

## B. Lamport clock

每 actor 維護 `L`：

```text
local event: L = L + 1
send: attach L
receive timestamp T:
L = max(L,T)+1
```

保證：

```text
a → b ⇒ L(a) < L(b)
```

但反向不成立：

```text
L(a)<L(b)
≠
a→b
```

## C. Replay divergence

Hermes 可定義：

```text
ReplaySignature(e)
=
Hash(
  event_type,
  actor,
  canonical_input,
  dependency_versions,
  model/tool/schema versions
)
```

replay 時：

```text
expected_signature
vs
actual_signature
```

分類：

```text
INPUT_DIVERGENCE
COMMAND_DIVERGENCE
STATE_VERSION_DIVERGENCE
TOOL_SCHEMA_DIVERGENCE
MODEL_VERSION_DIVERGENCE
EVENT_MISSING
EVENT_EXTRA
CAUSAL_PARENT_DIVERGENCE
```

## D. Replay-safe prefix

定義最長 prefix `P*`：

```text
P* = maximal prefix where
all replay signatures match
and all causal dependencies are satisfied
```

fork/counterfactual 模擬只需要從第一個 divergence point 之後重新生成。

---

# Visual Simulation Idea

## **Causal Replay × Counterfactual Scheduler Lab**

### 上層：原始 execution timeline

```text
0ms      100       200       300       400
Planner  ███ plan ─────────────────────────
Browser       █████ read page ───────┐
Memory           ███ compact         │
Safety              █████ inspect ───┤
Tool                           WRITE ─┤
Planner                              └─ final
```

### 中層：切換到 Causal DAG

```text
UserInput#1
   ↓
Plan#2
  ↙       ↘
Read#3   Safety#5
  ↓        ↓
Memory#4  │
    ↘     ↙
    Final#8
```

節點顯示：

```text
Wall clock
Lamport clock
Vector/causal frontier
Effect class
State reads/writes
Replay status
```

### 下層：Scheduler What-if

使用者拖動 `Memory#4` 到 `Read#3` 前面：

若 DAG 無依賴：

```text
LEGAL COUNTERFACTUAL ORDER
```

若拖動 `Final#8` 到 `Read#3` 前面：

```text
BLOCKED
Causal dependency violated:
Read#3 → Final#8
```

如果移動的是：

```text
PaymentWrite#12
```

系統顯示：

```text
REPLAY BARRIER
IRREVERSIBLE SIDE EFFECT
Use recorded EffectReceipt or sandbox mock.
```

### Replay diff panel

```text
Original run
vs
Counterfactual run

first divergence: SchedulerDecision#7
model calls changed: 2
memory writes changed: 1
external effects changed: 0 (blocked)
latency: -18%
permission decision: ALLOW → VERIFY
final answer semantic delta: 0.12
```

---

# Code / GitHub

## 1. davccavalcante/agenticstash
值得看的目錄：

```text
src/record/
src/replay/
src/fork/
src/diff/
src/interceptors/
src/mcp/
src/storage/
src/seal/
src/hash.ts
src/types.ts
```

### 核心檔案
`src/replay/index.ts`

值得 Hermes 借鏡：
- per `(channel,key)` recorded-event queue/cursor
- strict input-hash validation
- `ERR_DIVERGENCE`
- `extra-call` / `missing-call` / `input-mismatch`
- recorded error rethrow
- live tail for fork

不足：
- sequence-centric replay 尚不足以表達完整 distributed happens-before
- 對 concurrent event swap 的 causal legality 仍需 Agent runtime 額外建模
- external side-effect semantic 需要更強 effect contract

## 2. Temporal
值得看的 system architecture：

```text
Workflow code
↓ Commands
History Service
↓ Event History
Task Queue / Matching
↓
Workers
↓ Activities
```

研究重點：
- deterministic workflow code
- event-history replay
- Activity 與 Workflow nondeterminism boundary
- versioning / replay compatibility
- durable timers/signals

## 3. AgentReplay / Agent Observability
可作為比較線：
- transport/call recording
- fixture/cassette replay
- structural divergence
- counterfactual mutation

需要區分：

```text
HTTP/model deterministic fixture replay
≠
causal scheduler replay
```

---

# Papers

## Paper 1
**Title:** Time, Clocks, and the Ordering of Events in a Distributed System  
**Author:** Leslie Lamport  
**Institution:** Massachusetts Computer Associates（後於 Microsoft Research 官方頁維護）  
**Year:** 1978  
**Venue:** Communications of the ACM 21(7), 558–565  
**Architecture / Mechanism:** happened-before relation、logical clocks、distributed state-machine ordering  
**Contribution:** 建立 distributed event causal order 的經典 formal basis；說明 physical timestamp 不是 causality。  
**Limitations:** scalar logical clock 無法完整識別 concurrency；現代 dynamic agent graph 需 vector/causal ancestry 擴展。  
**改變了什麼:** Hermes 的 AsyncEventDAG 從「可視化 trace」升級成可以檢驗合法 replay ordering 的正式 causal ordering layer。

## Paper 2
**Title:** Global Reproducibility through Local Control for Distributed Active Objects  
**Authors:** Lars Tveito, Einar Broch Johnsen, Rudolf Schlatte  
**Year:** 2020  
**Venue:** FASE 2020  
**Architecture:** 在 local stable states 記錄足以決定 nondeterministic scheduling 的 traces，再於 replay 時局部控制，仍可達成 global reproducibility。  
**Contribution:** 說明 replay 不必把整個 distributed system 完全 serialise；只要記錄真正決定 nondeterminism 的 local choices。  
**限制:** formal active-object setting 和 LLM/tool/MCP runtime 還有 abstraction gap。  
**對 Hermes:** 可研究「minimal replay trace」：不必記所有 runtime noise，只記能決定 causal branching 的 scheduling/model/tool events。

## Paper 3
**Title:** Deterministic replay for transparent recovery in component-oriented middleware  
**Authors:** Rob Strom, Chitra Dorai, Thomas Huining Feng, Zheng Wei  
**Institution:** IBM Research  
**Year:** 2009  
**Venue:** ICDCS 2009  
**Architecture:** checkpoint + deterministic replay；message 搭配 virtual times；runtime 依 virtual-time order 處理。  
**Contribution:** 將 message scheduling nondeterminism轉成可記錄 / 可重播順序。  
**限制:** 不涵蓋現代 neural/model randomness、browser state、MCP/tool side effects。  
**對 Hermes:** virtual/logical time 應成為 Agent runtime 的一級資料，而非 observability annotation。

---

# 已確認事實 / 工程實作 / 推論 / 假說分層

### 已確認事實
- Lamport happened-before 是 partial order；logical clock 可與其保持一致。
- Temporal-style replay 依 event history 重建 state，workflow command sequence 必須在 replay 中保持一致。
- AgenticStash 的 replay 原始碼以 `(channel,key)` 找 recorded events，並以 input hash 偵測 divergence。

### 已確認工程實作
- AgenticStash 已提供 record/replay/fork/diff/interceptor/MCP 等模組。
- 其 replayer 已分類 input mismatch、extra call、missing call，且可以 replay recorded error。

### 合理工程推論
- Hermes 的 concurrent Agent replay 需要比 sequence cursor 更完整的 causal parent / event dependency metadata。
- Scheduler counterfactual 應被限制在 causal DAG 的 legal topological reorderings。

### 尚未驗證假說
- `Causal Event DAG + EffectReceipt + replay-safe prefix` 是否足以支撐 production 級 cross-version Agent counterfactual regression。
- 是否能建立低 overhead、動態 actor-safe 的 compressed vector/causal clock，覆蓋大量 ephemeral sub-agents。

---

# Unknown / Open Questions

## 1. Minimal sufficient replay trace 是什麼？
完整記錄所有事件很昂貴；只記 branch/scheduler/nondeterministic choices 又可能漏掉 implicit dependency。需要定義：

```text
Replay Sufficient Event Set
```

## 2. Counterfactual scheduler 在 stateful external world 上如何驗證？
即使兩個 internal events causal-independent，它們可能競爭同一 API quota、DB lock、GPU resource 或人類注意力。這形成 hidden interference。

## 3. Model streaming token order 是否是 causal event？
對大多數 Agent，tool decision 只依賴完整 model message；但 streaming UI、interruptible generation、speculative decoding、real-time voice Agent 可能讓 token/chunk timing 真正影響 actions。需要分：

```text
DISPLAY_ONLY_STREAM
vs
ACTION_CAUSAL_STREAM
```

---

# 下一輪研究

## **Replay Sufficiency × Hidden Nondeterminism × Deterministic State Fold × Snapshot/Event Compaction × Cross-Version Replay**

下一輪核心：

```text
Raw events
↓
Which events are causally sufficient?
↓
state fold
↓
snapshot / event compaction
↓
code/model/tool version migration
↓
old history replay under new runtime
↓
semantic divergence certificate
```

尤其要回答：

> Agent code、prompt、model、tool schema、MCP server 都升版後，舊 event history 哪些部分還可以合法 replay？哪些只能做 historical simulation，不能當作新 runtime 的 counterfactual evidence？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Causal Event Sourcing
Happened-Before Relation
Lamport Logical Clock
Vector Clock
Causal Frontier
Replay Event
Replay Signature
Replay Divergence
Replay-Safe Prefix
Replay Barrier
Effect Class
Effect Receipt
Idempotency Key
External Effect Reconciliation
Deterministic Command Replay
Causal Schedule
Schedule Equivalence Class
Counterfactual Scheduler
Legal Event Reordering
Causal Cut
Minimal Replay Trace
```

## Edges

```text
Wall-Clock Order
≠ Causal Order

Logical Clock Order
≠ Full Causality

Trace Visualization
≠ Deterministic Replay

Deterministic Replay
≠ Exactly-Once External Effect

Same Input Prompt
≠ Same Agent Run

Recorded Sequence
≠ Mandatory Causal Sequence

Concurrent Events
→ May Be Legally Reordered

Happened-Before Edge
→ Forbids Counterfactual Reordering

Irreversible Side Effect
→ Creates Replay Barrier

Idempotency Key
→ Enables Safer Effect Recovery

Event History
→ Reconstructs Runtime State

Snapshot
≠ Source Of Causal Truth

Replay Divergence
→ Defines Counterfactual Fork Point
```

---

# 本輪結束判定

- **目前最缺的一層：** Replay Sufficiency + Cross-Version History Semantics Layer
- **目前最淺節點：** MinimalReplayTrace、CounterfactualScheduler、ScheduleEquivalenceClass、EffectReconciliation
- **仍主要只是名詞/架構概念：** production 級 `Counterfactual Scheduler Certificate`
- **最值得繼續讀原始碼：** `agenticstash/src/record → replay → fork → diff → mcp → types.ts`
- **最值得追引用的論文：** Lamport 1978 + Tveito/Johnsen/Schlatte 2020 reproducibility paper
- **最適合視覺模擬：** Causal Replay × Counterfactual Scheduler Lab
- **最值得 Hermes 實作的 Agent Runtime：**

```text
Canonical Event Envelope
↓
Append-Only Event Store
↓
Causal DAG Builder
↓
Effect Receipt / Replay Barrier
↓
Deterministic Replay Engine
↓
Divergence Detector
↓
Counterfactual Scheduler Sandbox
↓
Fork / Diff / Regression Certificate
```

---

# 對「AI 到底怎麼運作」補上的核心

使用者對 AI 說一句話之後，真正 runtime 並不是一條單純線性的：

```text
UI → Agent → Tool → Answer
```

而更接近：

```text
User Input
↓
Planner Event
├ Model generation
├ Memory read/write
├ Retrieval
├ Safety evaluation
├ Tool/MCP calls
├ Browser observations
└ Concurrent background work
↓
Scheduler interleaves events
↓
External side effects
↓
State changes
↓
More planning
↓
Output
```

因此若要真的回答「AI 為什麼做出這個結果」，只保存最後 state 或 trace screenshot 不夠。必須能回答：

```text
哪些 event 真正先於哪些 event？
哪個 observation 當時已經可被 Planner 看見？
哪些兩個事件只是碰巧按 wall clock 排在前後？
哪個外部 side effect 已經 committed？
如果 scheduler 換一個合法順序，結果會不會改變？
```

**AI 的可解釋 runtime 最終不只需要 reasoning trace，而需要一個可 replay、可驗證、具有 causal ordering 與 effect semantics 的 execution history。**