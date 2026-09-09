# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-09 19:53（Asia/Taipei）

## 本輪研究主題
**Distributed Tool Execution × Durable Execution × Idempotency × Saga / Compensation × Effect Fencing × MCP Tasks**

本輪承接上一輪 `Tool / Skill Capability Graph × Plan Compilation × Dependency DAG`，刻意不重複 tool discovery / DAG scheduling，而是研究 DAG 一旦進入真實外部世界之後，遇到 crash、timeout、response loss、partial effect、retry、rewind 時，Agent Runtime 如何避免重複寄信、重複扣款、重複部署、重複寫入與授權復活。

---

## 本小時新發現

### 新架構 / 新工程方向
1. **Effect-Aware Durable Agent Runtime**：把 `PlanNode` 從「可重跑函式」升級為具有 `Attempt / Effect / Verification / Compensation / Commit` 狀態的 durable operation。
2. **MCP Tasks Extension（2026-07-28）**：MCP Tasks 已從 2025-11-25 experimental core 移到 `io.modelcontextprotocol/tasks` extension。server 可在 `tools/call` 後回傳 durable task handle，client 以 `tasks/get` / `tasks/update` / `tasks/cancel` 驅動長任務 lifecycle。
3. **LangGraph × Temporal**：Temporal Python SDK 已提供 experimental LangGraph plugin，可把 LangGraph nodes/tasks 執行成 Temporal Activities，提供 durable execution、automatic retries、timeouts；這是「Agent graph runtime」接入成熟 durable workflow engine 的直接工程路徑。
4. **Semantic Rollback Fence**：ACRFence（2026）指出 LLM checkpoint restore 後可能重新生成不同 tool arguments / request IDs，使傳統 idempotency key 失效；需要在 tool boundary 對「語義相同 effect」做 replay-or-fork。
5. **Authorization-to-Effect Closure**：AID-Guard（2026-08）指出 authorization 不能只在 tool admission 時檢查；request mutation、provider state、response loss、retry、recovery 必須被同一 durable reservation 約束直到 effect terminal。

---

# 本小時最重要 5 個發現

## 1. Checkpoint ≠ Durable External Effect

### 是什麼
Agent framework 可以保存：

```text
Graph State
Messages
Node Cursor
Memory
Interrupt State
```

但 external tool 已經做掉的事情通常不會隨 checkpoint rewind：

```text
Agent checkpoint t10
↓
SEND_EMAIL()
↓
Provider accepted email
↓
Agent crashes before response
↓
restore checkpoint t10
↓
SEND_EMAIL() again
```

結果可能是兩封信。

### 底層如何運作
真正需要分成：

```text
LOCAL EXECUTION STATE
≠
EXTERNAL EFFECT STATE
```

可靠 runtime 必須額外保存：

```text
OperationIntent
↓
Attempt ID
↓
Provider Request ID / Idempotency Key
↓
Dispatch State
↓
Provider Evidence
↓
Effect Verification
↓
Terminal Outcome
```

LangGraph source 中 retry runtime 具有 `task_id / thread_id / checkpoint namespace / attempt` 等 attempt metadata，checkpoint 可以保存 graph execution；官方 interrupt 語義則提醒 resume 可能重新從 node 開頭執行，因此 side-effect code 不能假設只執行一次。

Temporal 的 LangGraph plugin 則把 LangGraph nodes/tasks 轉成 Temporal Activities，支援 retry、timeout、history-driven durability；但 external API 的 idempotency / effect correctness 仍必須由 activity / provider contract 處理。

### 為什麼重要
這直接修正：

```text
"有 checkpoint"
→
"所以 tool 不會重複執行"
```

這個錯誤假設。

### 限制
Durable workflow engine 能可靠記錄「我排程過什麼、哪個 activity 成功/失敗」，但無法神奇地 rollback 第三方 API 已發生且不可逆的 effect。

### Sources
- LangGraph `libs/langgraph/langgraph/pregel/_retry.py`
- LangGraph interrupts / persistence docs
- Temporal Python SDK `temporalio/contrib/langgraph/README.md`
- Temporal official docs

---

## 2. Timeout 不是 Failure；真正狀態可能是 UNKNOWN_EFFECT

### 是什麼
傳統 Agent 常把 tool call 分成：

```text
SUCCESS
FAILURE
```

但分散式系統裡至少需要：

```text
NOT_DISPATCHED
DISPATCHED
ACKNOWLEDGED
EFFECT_CONFIRMED
FAILED_NO_EFFECT
UNKNOWN_EFFECT
COMPENSATED
```

例如：

```text
Agent → payment provider
provider commits payment
provider → response
network drops response
Agent sees timeout
```

Agent 看見的是 failure-like timeout，但世界其實已成功扣款。

### 底層如何運作
因此 retry policy 應該是：

```text
Timeout
↓
Can provider outcome be queried?
│
├ YES
│  → VERIFY BEFORE RETRY
│
└ NO
   → Is operation idempotently fenced?
      ├ YES → retry same identity
      └ NO  → UNKNOWN_EFFECT / manual or compensating path
```

2026 `Verified Tool Calls Improve LLM Agent Reliability Under Non-Atomic Failures` 正式把 delayed visibility、timeout-after-dispatch、partial state update 這類 non-atomic failure 當成 Agent tool reliability 問題，提出 postcondition verification + verify-before-retry + idempotency key wrapper。

### 為什麼重要
Tool call 不再是：

```text
RPC return code
```

而是：

```text
Effect lifecycle
```

### 限制
如果 provider 沒有 query/status endpoint、沒有 idempotency contract，也沒有補償 action，就無法從 runtime 層保證 exactly-once physical effect。

### Sources
- Verified Tool Calls Improve LLM Agent Reliability Under Non-Atomic Failures, 2026
- Temporal durable execution docs
- Saga distributed transaction literature

---

## 3. Idempotency Key 對 LLM Agent 還不夠：必須綁定 Semantic Intent

### 是什麼
傳統 idempotency 假設 retry request 相同：

```text
Request A
key=123
↓ retry
Request A
key=123
```

但 LLM restore 後可能重新合成：

```text
transfer(
 amount=500,
 recipient=Bob,
 request_id=UUID_A
)

↓ restore

transfer(
 amount=500,
 recipient=Bob,
 request_id=UUID_B
)
```

provider 看起來是兩個不同 request。

### 底層如何運作
ACRFence 提出：

```text
Irreversible Tool Effect
↓
Effect Log
├ thread / branch
├ tool
├ args
└ environment context

↓ restore

New Tool Proposal
↓
Semantic Comparison
├ Equivalent → REPLAY old response
├ Different → FORK required
└ Reused authority → BLOCK
```

因此 Agent durable identity 應拆成：

```text
Attempt ID
≠
Provider Request ID
≠
Semantic Effect ID
```

Hermes 可定義：

```text
SemanticEffectFingerprint =
canonicalize(
  actor,
  capability,
  target,
  intended_state_change,
  authorization_scope
)
```

這是工程模型，不是現行統一標準。

### 為什麼重要
它把 retry safety 從「字串完全相同」升級成「effect intent 是否相同」。

### 限制
ACRFence 自己承認其 analyzer LLM 尚有分類錯誤 / adversarial evasion 風險；論文的 mitigation 尚未做完整大規模 production evaluation。

### Sources
- ACRFence: Preventing Semantic Rollback Attacks in Agent Checkpoint-Restore, 2026

---

## 4. Saga / Compensation 不是 Rollback；它是新的 forward action

### 是什麼
Distributed Agent plan：

```text
A reserve hotel
B charge card
C create calendar
D send confirmation
```

若 D 失敗，不能假設 database transaction 一鍵 rollback 全世界。

Saga 會定義：

```text
A ↔ CompensateA
B ↔ CompensateB
C ↔ CompensateC
```

如果 C 後失敗：

```text
CompensateC
→ CompensateB
→ CompensateA
```

### 底層如何運作
Capability Node 應增加：

```text
CapabilityNode
├ Execute
├ Verify
├ RetryPolicy
├ IdempotencyPolicy
├ CompensationCapability
├ Pivot / Irreversibility
└ CommitSemantics
```

Saga state：

```text
PLANNED
↓
EXECUTING
↓
PARTIALLY_COMMITTED
├ success → COMMITTED
└ failure → COMPENSATING
                 ↓
          COMPENSATED / MANUAL_REPAIR
```

### 為什麼重要
「取消一封已寄出的 email」不是 rollback；最多可能再寄更正信。

```text
compensation
≠ inverse function
```

它是另一個外部 effect，需要自己的 permission、verification、failure handling。

### 限制
某些 effect 是不可補償的：資料外洩、郵件已被閱讀、金錢跨鏈轉出、實體機器碰撞等。因此 runtime 必須標示 pivot / irreversible boundary。

### Sources
- Saga distributed transactions pattern, Microsoft / distributed systems literature

---

## 5. Authorization 必須一直綁到 Provider Effect Terminal，而非 approval 後就結束

### 是什麼
舊模型：

```text
User approves
↓
Agent gets authority
↓
Tool executes whenever / however later
```

AID-Guard 指出這中間存在 authorization-effect gap。

### 底層如何運作
更安全的 lifecycle：

```text
Intent
↓
Approval Manifest
↓
Reservation
↓
Pre-Commit Revalidation
├ actor
├ target
├ payload
├ provider state
└ authorization scope
↓
Dispatch Fence
↓
Provider Effect
↓
Terminal Evidence
↓
Release Authority
```

若 response lost：

```text
DO NOT immediately mint successor authority
↓
retain reservation
↓
resolve original effect
↓
only then terminalize / release / successor
```

AID-Guard 在其 prototype / Stripe / Resend 測試中報告，在宣告的 provider contract 與 failure schedule 下避免 duplicate effects，但 strict exact-manifest policy 會犧牲部分 benign utility。

### 為什麼重要
這把：

```text
Permission Gate
```

從單一前置 check 升級成：

```text
Stateful Authorization Lifecycle
```

### 限制
依賴 provider contract 能提供足夠 identity、status、reservation / delivery evidence；對沒有這些語義的 tool，保證會弱很多。

### Sources
- AID-Guard: Stateful Authorization for Delegated Agent Effects, 2026-08-21

---

# Architecture Breakdown

```text
User Goal
↓
Planner / Plan Compiler
↓
Typed Plan DAG
↓
Durable Orchestrator
├ Run ID
├ Branch ID
├ Checkpoint
├ Event History
└ Resume Cursor
↓
Ready Plan Node
↓
Effect Classifier
├ PURE
├ READ_ONLY
├ IDEMPOTENT_WRITE
├ COMPENSABLE_WRITE
└ IRREVERSIBLE_WRITE
↓
Authorization Reservation
↓
Operation Journal
├ Semantic Effect ID
├ Attempt ID
├ Tool / MCP server
├ Canonical Args
├ Provider Request ID
├ Idempotency Key
├ Dispatch State
├ Provider Task ID
└ Last Evidence
↓
Tool / MCP Runtime
├ synchronous tools/call
└ MCP Task handle
   ├ tasks/get
   ├ tasks/update
   └ tasks/cancel
↓
Provider / External World
↓
Observation / Receipt / Status
↓
Effect Verifier
├ CONFIRMED_SUCCESS
├ CONFIRMED_NO_EFFECT
├ PARTIAL_EFFECT
├ UNKNOWN_EFFECT
└ CONFLICT
↓
Decision
├ COMMIT
├ VERIFY_AGAIN
├ RETRY_SAME_EFFECT_ID
├ COMPENSATE
├ REPLAN
├ FORK
└ HUMAN_REPAIR
↓
World / Memory / Plan State Update
```

---

# Bottom-Level Logic

## A. Effect state machine

```text
PREPARED
↓
DISPATCHING
↓
DISPATCHED
├ receipt → VERIFYING
├ timeout → UNKNOWN_EFFECT
└ explicit reject → FAILED_NO_EFFECT

VERIFYING
├ effect exists → COMMITTED
├ no effect certified → SAFE_TO_RETRY
├ partial → PARTIAL_EFFECT
└ uncertain → UNKNOWN_EFFECT
```

## B. Safe retry predicate

Hermes 工程模型：

```text
SafeRetry(op) =
  ConfirmedNoEffect(op)
  OR
  ProviderIdempotencyFence(op)
  OR
  ReplayRecordedResult(op)
```

否則：

```text
UNKNOWN_EFFECT
→ no blind retry
```

## C. Retry identity

```text
RunID
└ PlanNodeID
   └ SemanticEffectID
      ├ Attempt#1
      ├ Attempt#2
      └ Attempt#3
```

同一 `SemanticEffectID` 的 attempts 代表「同一 intended world effect 的 delivery attempts」。

若 agent 改變 recipient / amount / target / authorization scope：

```text
SemanticEffectID changes
→ new branch / fresh approval may be required
```

## D. Exactly-once clarification

```text
Exactly-once execution
```

通常不是可以跨任意外部服務直接保證的物理事實。

更精確應拆成：

```text
At-least-once delivery
+
Idempotent provider effect
+
Durable deduplication
+
Effect verification
≈ exactly-once effect illusion
```

重要：這是 distributed systems 的組合語義，不應讓 Agent UI 只顯示 `success=true`。

---

# MCP Tasks：與 Durable Execution 的關係

2026-07-28 MCP 把 Tasks 移到 `io.modelcontextprotocol/tasks` extension。

核心 lifecycle：

```text
Client tools/call
+ tasks extension capability
↓
Server decides async task
↓
CreateTaskResult / durable task handle
↓
client tasks/get
├ working
├ input_required / extension-defined lifecycle
├ completed
├ failed
└ cancelled
↓
result / status
```

重要區分：

```text
MCP Task Handle
≠
Global Agent Workflow Checkpoint
≠
Exactly-once Tool Effect
≠
Saga Coordinator
```

MCP Tasks 解的是「長時間 / 非同步 tool invocation 的 durable handle 與 lifecycle」。Agent runtime 仍需自己處理跨多 tools 的 saga、effect identity、authorization、compensation 與 plan-level resume。

另外，2026-07-28 extension 與 2025-11-25 experimental Tasks wire protocol 不相容；Python SDK 當前 migration docs 也明確指出 extension runtime 尚未完整實作，因此 MCP Tasks 生態目前仍存在 SDK maturity 差異。

---

# Visual Simulation Idea

## Durable Agent Execution & Effect Recovery Lab

### 主畫面

```text
PLAN DAG

A Search flight ─────┐
                     ↓
B Reserve seat → C Charge card → D Send email
      ↘ compensate     ↘ refund
```

每個 node 顯示：

```text
Effect Class
Attempt
Semantic Effect ID
Provider ID
Idempotency Key
Permission Reservation
Dispatch State
Verification State
Compensation
```

### Failure Injection

使用者可以按：

```text
NETWORK DROP AFTER COMMIT
PROCESS CRASH
PROVIDER 500 BEFORE EFFECT
PROVIDER 500 AFTER EFFECT
PARTIAL WRITE
DELAYED VISIBILITY
CHECKPOINT REWIND
LLM CHANGES ARGUMENTS ON RETRY
AUTH TOKEN RESURRECTION
```

### Example

```text
Charge $500
↓
Provider commits
↓
Response lost
```

Simulator 不應顯示：

```text
FAILED → RETRY
```

而顯示：

```text
UNKNOWN_EFFECT
↓
VERIFY provider transaction
↓
FOUND original charge
↓
REPLAY RECEIPT
↓
DO NOT RE-CHARGE
```

若 checkpoint restore 後 LLM 產生新 UUID：

```text
SEMANTIC EFFECT MATCH
REQUEST ID CHANGED
↓
ROLLBACK FENCE
↓
REPLAY / REQUIRE FORK
```

### UI 可視化指標

```text
Duplicate Effect Count
Unknown Effect Duration
Retries Avoided
Compensation Count
Irreversible Pivot Crossed
Authorization Lifetime
Replay vs Fork Decisions
Recovery Latency
```

這個 simulator 能直接讓使用者理解：

> Agent 的可靠性不是「失敗就 retry」，而是「先知道世界是否已經被改變，再決定 retry / replay / compensate / replan」。

---

# Code / GitHub

## LangGraph
值得看的：

```text
libs/langgraph/langgraph/
├ pregel/_retry.py
├ pregel/_loop.py
├ pregel/_algo.py
├ pregel/main.py
├ func/__init__.py
└ types.py
```

`_retry.py` 已具有 task/thread/checkpoint/attempt metadata，以及 run/idle timeout、progress/heartbeat 等 attempt runtime primitives。Interrupt / checkpoint semantics 則顯示 resume 與 node re-execution 的關係，值得下一輪繼續追 node commit boundary。

## Temporal Python SDK

```text
temporalio/contrib/langgraph/
└ README.md
```

Temporal 的 LangGraph plugin 已能讓：

```text
LangGraph Node / Task
↓
execute_in="activity"
↓
Temporal Activity
├ timeout
├ retry policy
├ history
└ durable execution
```

也允許部分 node 在 deterministic workflow context 執行。

## MCP Python SDK

目前 codebase 保留 2025-11-25 Tasks types；官方 2026 migration 文件指出 experimental Tasks runtime 已移除，而 2026-07-28 Tasks extension 正在重新整合。這代表在 Hermes 中 MCP Tasks connector 應做 protocol/version capability negotiation，而不能假設所有 SDK 都支援同一 Tasks API。

---

# Papers

## 1. ACRFence: Preventing Semantic Rollback Attacks in Agent Checkpoint-Restore
- Authors: Yusheng Zheng, Yiwei Yang, Wei Zhang, Andi Quinn
- Institution: 本輪可驗證 arXiv HTML 未明列 affiliation，故不猜測
- Year: 2026
- URL: https://arxiv.org/abs/2603.20625
- Code: 本輪未驗證到完整 mitigation implementation repo
- Dataset/Testbed: Claude Code CLI + Qwen3-32B；模擬 bank/cloud/approval MCP services
- Architecture: effect log + semantic analyzer + replay-or-fork fence
- Contribution: 指出 checkpoint restore 對 nondeterministic LLM 會產生 semantic rollback attacks
- Limitations: mitigation analyzer 仍有 misclassification / adversarial evasion；evaluation 規模有限
- 改變了什麼: 把 checkpoint-retry security 從 exact request identity 推向 semantic effect identity

## 2. AID-Guard: Stateful Authorization for Delegated Agent Effects
- Authors: Yingzhe Tong, Leyu Dai, Songhui Guo
- Institution: 本輪可驗證 arXiv HTML 未明列 affiliation，故不猜測
- Year: 2026
- URL: https://arxiv.org/abs/2608.21159
- Code: Python/SQLite prototype（論文報告）
- Dataset/Eval: loopback MCP domain、Stripe provider-contract trials、Resend、crash/recovery/concurrency schedules
- Architecture: approval manifest → reservation → commit revalidation → delivery fence → terminalization
- Contribution: authorization 不在 admission 結束，而是綁到 provider effect terminal
- Limitations: strict profile 降低 benign utility；依賴 provider contract
- 改變了什麼: Permission 從 boolean gate 升級為 stateful effect lifecycle

## 3. Verified Tool Calls Improve LLM Agent Reliability Under Non-Atomic Failures
- Authors: Isham Kalappurackal Mansoor, Abhishek Phadke, Pratip Rana
- Institution: 本輪可驗證 arXiv HTML 未明列 affiliation，故不猜測
- Year: 2026
- URL: https://arxiv.org/abs/2608.02645
- Code: 本輪未驗證公開 repo
- Dataset/Eval: controlled simulated environment with injected non-atomic failures
- Architecture: verification-aware tool wrapper
- Contribution: postcondition verification + verify-before-retry + idempotency keys
- Limitations: controlled/simulated failure environment；仍需 provider observability
- 改變了什麼: Tool reliability 從 return-code handling 升級到 effect verification

## 4. Agent Mesh: Reliability Primitives for Non-Idempotent Agent Delegation — Identity Adequacy and Evidence Adequacy
- Authors: Mazhar Shaikh, Anurag Rajkumar Bombarde, Harshal Pathak
- Institution: 本輪可驗證 arXiv HTML 未明列 affiliation，故不猜測
- Year: 2026
- URL: https://arxiv.org/abs/2608.26225
- Code: 本輪未驗證公開 repo
- Dataset/Eval: production failure study，147 incidents / 81 runs（依論文摘要）
- Architecture: delegation-level reliability primitives
- Contribution: 指出 service-mesh-style retry/timeout/error-rate primitives直接套到 agent delegation 會違反 identity/evidence assumptions
- Limitations: failure study 不等同完整 controlled evaluation
- 改變了什麼: reliability enforcement unit 從 message/tool-call 推向 delegation/effect identity

---

# 已確認事實 / 論文結果 / 工程推論 / 尚未驗證假說

## 已確認官方 / 原始碼
- LangGraph 具有 checkpoint / retry / interrupt execution primitives。
- LangGraph interrupt resume 可能重新執行 node 前段 code，因此 side effects 必須安全設計。
- Temporal Python SDK 有 experimental LangGraph plugin，把 LangGraph nodes/tasks 當 Temporal Activities，支援 retry/timeouts/durable history。
- MCP 2026-07-28 Tasks 已移到 extension，使用 durable task handle + polling lifecycle；舊 experimental API 不 wire-compatible。

## 論文結果
- ACRFence：展示 semantic rollback / authority resurrection failure。
- AID-Guard：在其測試 contract 下以 stateful authorization-effect closure 阻擋 duplicate/unauthorized effects。
- Verified Tool Calls：verification-aware retry 在 injected non-atomic failures 下減少 duplicate actions。
- Agent Mesh：production incident study 顯示 message-level retry/timeout primitives不足以表達 agent delegation reliability。

## Hermes 工程推論
- Agent Runtime 應建立 `SemanticEffectID`，獨立於 Attempt ID 與 provider request ID。
- `UNKNOWN_EFFECT` 必須成為一級狀態，不應被壓成 failure。
- Capability Graph 應加入 `verify / compensate / pivot / idempotency / commit semantics`。
- Authorization 應作為 durable reservation 跟隨 effect lifecycle。

## 尚未驗證假說
- 是否能建立跨 MCP / REST / Browser / Computer Use 的統一 SemanticEffectFingerprint。
- 是否能在不依賴 LLM classifier 的情況下，以 schema + world-state delta 可靠判定 semantic replay。
- 是否能建立 Agent-specific Saga IR，讓 planner 自動推導 compensation graph。

---

# Unknown / Open Questions 1–3

## 1. 如何自動知道一個 tool 是否真正 idempotent？
MCP/tool annotations 只是宣告；provider 真實行為可能不符。需要 contract test、history-based verification 或 runtime probes。

## 2. UNKNOWN_EFFECT 要等多久才可以 replan？
有些 provider eventual consistency 幾秒，有些 batch job 幾小時。需要 effect-specific verification horizon / TTL。

## 3. Compensation planner 如何知道「補償」是否造成更糟的新副作用？
Compensation 本身也是 action，需要 permission、precondition、effect prediction、verification；因此 Saga 其實是另一層 Agent plan，而不是 rollback button。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Durable Agent Runtime
Operation Journal
Semantic Effect ID
Attempt ID
Provider Request ID
Effect State
Unknown Effect
Effect Verification
Verify-Before-Retry
Idempotency Fence
Semantic Rollback
Replay-or-Fork
Authorization Reservation
Delivery Fence
Saga
Compensation Action
Pivot Action
Irreversible Effect
Durable Task Handle
MCP Tasks Extension
Checkpoint
Event History
```

## Edges

```text
Plan Node
→ materializes as
Durable Operation

Durable Operation
→ owns
Semantic Effect ID

Semantic Effect ID
→ groups
Multiple Attempts

Attempt
→ may produce
External Effect

Timeout
→ may imply
Unknown Effect

Unknown Effect
→ requires
Verification Before Retry

Checkpoint Restore
→ may re-execute
Tool Proposal

LLM Re-synthesis
→ may change
Provider Request Identity

Semantic Effect Log
→ constrains
Replay / Fork

Authorization
→ remains bound until
Effect Terminalization

Failed Saga Step
→ triggers
Compensation Plan

Compensation
≠
Rollback

MCP Task
→ represents
Long-running Tool Invocation

MCP Task
≠
Global Workflow Transaction

Checkpoint
≠
External Effect Rollback

Retry
≠
Safe Re-execution
```

---

# 下一輪研究

下一輪最值得進：

# **Event Sourcing × Deterministic Replay × Agent Nondeterminism × Side Effects × Branch/Fork Semantics**

核心問題：

```text
Durable engine 能 replay workflow history
↓
但 LLM 本身 nondeterministic
↓
那 Agent 要 replay 的到底是：
模型重新推理？
舊模型輸出？
舊 tool result？
舊 external effect？
```

下一輪拆：

```text
Event Log
↓
Deterministic Workflow Replay
├ recorded model output
├ recorded tool observation
├ side effects
├ nondeterministic values
└ versioned code
↓
Agent Fork
├ replay old branch
├ regenerate reasoning
└ diverge intentionally
↓
Commit / Merge / Abort
```

並研究：Temporal event history / replay / SideEffect semantics、LangGraph checkpoint/time-travel、AgentGit / agent branch systems、workflow versioning、LLM inference nondeterminism，以及 agent exploration 與 production effect isolation。

---

# 每輪結束檢查

- **缺哪一層？** `Durable event history → deterministic / nondeterministic Agent replay boundary`。
- **哪個節點最淺？** `SemanticEffectID` 的跨 tool canonicalization。
- **哪個概念仍只是名詞？** `Unified Agent Saga IR`、`Exactly-once Agent Effect ABI`。
- **哪個系統值得讀原始碼？** Temporal Python SDK + LangGraph plugin，其次 LangGraph `_retry.py / _loop.py`，以及 MCP Tasks SDK implementation。
- **哪篇論文需追引用？** ACRFence 與 AID-Guard，因為它們直接碰到 checkpoint/recovery 與 external effect safety 的交界。
- **哪個概念最適合視覺模擬？** `Durable Agent Execution & Effect Recovery Lab`。
- **哪個 Agent 架構最值得實作？** `Effect-Aware Durable Agent = Plan DAG + Operation Journal + Semantic Effect ID + Verify-Before-Retry + Authorization Reservation + Saga Compensation + World Effect Verifier`。

---

# 本輪核心結論

> **Agent Runtime 最危險的錯誤，是把「tool timeout」當成「世界沒有被改變」，再盲目 retry。可靠 Agent 必須把每個具副作用的 tool call 當成 durable effect lifecycle：Prepare → Authorize → Dispatch → Verify → Commit；若結果不明，狀態應是 UNKNOWN_EFFECT，而不是 FAILURE。Checkpoint 能恢復 Agent 的內部狀態，卻不能自動回滾外部世界。要安全地恢復、重試與分支，必須同時擁有 Semantic Effect Identity、Operation Journal、Idempotency / Delivery Fence、Verify-Before-Retry、Saga Compensation 與 Stateful Authorization。這才是 Plan DAG 真正落到現實世界後需要的 execution substrate。**
