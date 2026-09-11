# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-11 17:55（Asia/Taipei）  
**本輪主題**：Effect Semantics × Idempotency × Non-Atomic Failure × TOCTOU × Saga × Semantic Transactions × Recovery Verification × Multi-Agent Concurrency

---

## 0. 與歷史研究比較：本輪新增了什麼？

上一輪已建立：

```text
User Intent
→ Task-Scoped Authority
→ Minimal Capability
→ Effect Classification
→ Prepare
→ Commit / Abort / Compensation
→ Postcondition Verification
```

但仍有一個更底層的 reliability 缺口：**Tool schema 通常只描述「輸入/輸出」，卻沒有精確描述「這個呼叫會改變什麼世界狀態、什麼時候改變、重試是否安全、結果是否可能已生效但回應遺失、如何判斷補償真的完成、以及多 Agent 同時修改共享狀態時如何避免 stale-plan execution」。**

本輪因此把 Tool Calling 從：

```text
Intent
→ Tool Schema
→ Tool Selection
→ Arguments
→ Execution
→ Observation
```

升級成：

```text
Intent
→ Tool Schema
→ Effect Contract
→ Read/Write Footprint
→ Idempotency Identity
→ Precondition Snapshot
→ Dispatch
→ Ambiguous Outcome Handling
→ Postcondition Verification
→ Verify-Before-Retry
→ Saga / Semantic Transaction
→ Recovery Verification
→ Durable Effect Ledger
```

本輪核心新結論：

> **Tool return ≠ effect truth。**
>
> Agent Runtime 必須把「呼叫有沒有回成功」和「外部世界到底有沒有改變」拆開建模。

---

# 1. 本小時新發現

## A. Cordon — Semantic Transactions for Tool-Using LLM Agents

- **Title**：Cordon: Semantic Transactions for Tool-Using LLM Agents
- **Authors**：Zheng Chen, Hanqing Liu, Duling Xu, Dong Dong, Jialin Li, Bangzheng Pu, Jidong Zhai
- **Year**：2026
- **URL**：https://arxiv.org/abs/2606.17573
- **Architecture**：task-level semantic transaction → derived-result lineage → reversible shadow state → effect outbox → validation → commit/release → recovery metadata
- **Contribution**：指出 per-tool RPC boundary 太小，不能表達跨多步 tool workflow 的 commit/rollback/recovery/audit；提出 task-scoped transactional containment boundary。
- **Limitation**：外部 irreversible effect 仍不能被真正 rollback；semantic transaction 的正確性高度依賴 effect classification、staging 能力與 validator coverage。
- **本輪改變**：把上一輪「每個 tool call 的 transaction coordinator」提升成「整個 task / subgoal 的 semantic transaction」。

## B. Verified Tool Calls Improve LLM Agent Reliability Under Non-Atomic Failures

- **Authors**：Isham Kalappurackal Mansoor, Abhishek Phadke, Pratip Rana
- **Year**：2026
- **URL**：https://arxiv.org/abs/2608.02645
- **Architecture**：tool wrapper + postcondition verification + verify-before-retry + idempotency key
- **Contribution**：直接處理真實 API 常見的 non-atomic failure：request 已 dispatch / side effect 已發生，但 response timeout 或 visibility delayed。
- **Limitation**：實驗主要在 controlled simulated environment；不同 external system 的 postcondition/read-after-write consistency 差異很大。
- **本輪改變**：正式把 `UNKNOWN_EFFECT` / `AMBIGUOUS_OUTCOME` 設成 Tool Runtime 的一級狀態，而不是把 timeout 等同 FAILURE。

## C. Agentic Transaction: Towards ACID-Compliant Agent Systems

- **Authors**：Zhaoyan Sun, Xiaoxiao Wang, Guoliang Li
- **Institution**：Tsinghua University / Tsinghua Database Group
- **Year**：2026
- **URL**：https://arxiv.org/abs/2608.13900
- **Code**：https://github.com/TsinghuaDatabaseGroup/ACID-Agent
- **Architecture**：transactional exploration → execution → validation cycle；semantic atomicity / consistency / isolation / durability；transaction-aware semantic state management
- **Contribution**：將 classical ACID 重新定義成 agent workflow 的 semantic guarantees，而不是硬套 database row transaction。
- **Reported result**：論文摘要報告對 benchmark 的整體效果較既有 agents 提升 10.6%。
- **Limitation**：主要是 data-agent 場景；跨 SaaS / browser / MCP / physical-effect 的外部 transaction semantics 仍需要另一層 runtime。

## D. CoAgent — Concurrency Control for Multi-Agent Systems

- **Authors**：Hongtao Lyu, Dingyan Zhang, Mingyu Wu, Xingda Wei, Haibo Chen
- **Year**：2026
- **URL**：https://arxiv.org/abs/2606.15376
- **Architecture**：MTPO（Monotonic Trajectory Pre-Order）→ fixed serialization order → order-filtered reads → speculative in-place writes → conflict notification → semantic plan repair → saga-style inverse
- **Contribution**：指出 2PL/OCC 對長推理 Agent 很昂貴；讓 runtime 管理 serialization，而 LLM 判斷「某個 conflict 是否真的使我的 plan 失效」。
- **Reported result**：摘要報告在 10 個 contended workloads 中維持距離 serial correctness 5% 內並取得約 1.4× speedup。
- **Limitation**：依賴工具預先或在線取得 footprint / inverse semantics；LLM conflict judge 仍可能錯判。

## E. Saga / Idempotency 的經典工程規則仍然有效

官方工程實務持續確認：

- AWS：mutating operations 應以 idempotency token 讓 retries 不產生額外 side effects。
- Azure Saga：distributed workflow 拆成 local transactions；失敗時以 compensating transactions 回到可接受狀態。
- Temporal Saga SDK：補償預設可按 reverse registration order 執行；補償本身需要可重試與可觀測。

關鍵是：Agent 不會因為用了 LLM 就逃離 distributed systems 的基本 failure semantics；反而因為 agent planning 更長、更 stochastic、更容易 retry / branch / resume，這些問題更嚴重。

---

# 2. 本小時最重要 5 個發現

## 發現 1：Tool Return ≠ Effect Truth

一般 Agent loop 常把：

```text
HTTP 200 → SUCCESS
Exception / timeout → FAILURE
```

但真實 distributed system 至少需要：

```text
NOT_DISPATCHED
DISPATCHED_UNKNOWN
APPLIED_UNVERIFIED
APPLIED_VERIFIED
REJECTED_VERIFIED
COMPENSATION_PENDING
COMPENSATED_VERIFIED
IRRECOVERABLE
```

最危險的例子：

```text
Agent → charge_card(order_42, $100)
Service actually charges card
↓
response packet lost
↓
Agent sees timeout
↓
naive retry
↓
second charge
```

因此 timeout 的語義不是：

```text
FAILED
```

而是：

```text
OUTCOME UNKNOWN
```

### 底層正確流程

```text
Intent
↓
Idempotency Key
↓
Dispatch
↓
Timeout
↓
DO NOT blindly retry
↓
Verify Postcondition
├ effect exists → accept prior effect
├ effect absent → retry same logical operation / same key
└ cannot determine → escalate / bounded reconciliation
```

### Hermes 新增 primitive

```text
EffectOutcome {
  dispatch_state,
  acknowledgement_state,
  world_state,
  verification_state,
  idempotency_key,
  operation_identity,
  provider_receipt,
  observed_at,
  confidence,
  provenance_root
}
```

### 新否定關係

```text
RPC Failure ≠ Operation Failure
RPC Success ≠ Postcondition Success
Timeout ≠ Safe Retry
Tool Observation ≠ World State
```

---

## 發現 2：Idempotency Key 必須代表「同一個 logical intent」，不是每次 retry 產生新 UUID

很多 Agent implementation 會錯做：

```text
attempt 1 → random UUID A
attempt 2 → random UUID B
```

這完全失去 dedup 意義。

真正應該是：

```text
LogicalOperationId
=
H(
  task_version,
  subgoal,
  effect_type,
  target_resource,
  canonical_semantic_arguments
)
```

然後所有 transport retries 使用同一 operation identity：

```text
Attempt 1 → key K
Attempt 2 → key K
Attempt 3 → key K
```

但若使用者真的修改 intent：

```text
$100 → $120
```

就必須：

```text
K_old ≠ K_new
```

因此：

```text
Same Network Request
≠ Same Logical Operation

Same Logical Operation
≠ Same Attempt
```

### 需要注意的 collision / mutation

如果只 hash tool name + args，仍可能把不同 authorization epoch、resource version、task revision 錯當成同一動作。

Hermes 應加入：

```text
OperationIdentity {
  intent_version,
  authority_version,
  resource_version_constraint,
  semantic_args_hash,
  side_effect_scope
}
```

---

## 發現 3：TOCTOU 不只是 Permission Race，也是 Semantic Race

上一輪已指出 commit 前要重新驗證 permission；本輪更進一步：**Agent 的 plan premise 本身也可能過時。**

例如：

```text
t0: read inventory = 1
↓
Agent reasoning 20 sec
↓
t1: another agent sells item
↓
t2: current agent charges customer
```

權限沒有改，卻仍然錯。

因此 commit gate 必須同時驗證：

```text
Authority Version
Resource Version
Read Set
Decision-Relevant Preconditions
Tool Schema Version
Provider Capability Version
```

Hermes 應新增：

```text
SemanticPrecondition {
  proposition,
  evidence_id,
  resource_version,
  observed_at,
  max_staleness,
  required_at_commit
}
```

### CoAgent 帶來的重要擴充

Multi-Agent concurrency 不能只靠 lock：Agent transaction 很長，鎖會跨越昂貴 inference；OCC 若每個 conflict 都整段 abort，也浪費大量 reasoning。

所以可以拆成：

```text
Conflict detected
↓
Which premise became stale?
↓
Which plan operations depend on that premise?
↓
Patch only dependent suffix
```

這與前幾輪 Hermes 的 provenance / dependency graph 可以直接合流：

```text
Changed Resource
↓
Reverse Dependency Closure
↓
Affected Beliefs
↓
Affected Plan Nodes
↓
Selective Revalidation / Repair
```

### 新否定關係

```text
Permission Still Valid ≠ Plan Still Valid
No Write Conflict ≠ No Semantic Conflict
State Changed ≠ Plan Invalidated
Conflict Detected ≠ Full Workflow Must Restart
```

---

## 發現 4：Saga 的真正安全點不是「有 compensation function」，而是 Compensation 能被驗證

典型框架只記：

```text
book_hotel ↔ cancel_hotel
charge_card ↔ refund_card
```

但：

```text
cancel_hotel() returned success
```

不代表世界已恢復到 acceptable state。

可能出現：

```text
Cancellation accepted
but fee remains

Refund requested
but settlement pending

Git revert created
but production deployment still running old bad image
```

因此每個 compensation 需要：

```text
CompensationContract {
  forward_effect,
  compensating_action,
  expected_postcondition,
  verification_query,
  max_settlement_delay,
  retry_policy,
  terminal_failure_policy
}
```

完整 recovery loop：

```text
Forward Effect
↓
Later Failure
↓
Compensation Requested
↓
Compensation Ack
↓
Postcondition Read
├ acceptable world state → COMPENSATED_VERIFIED
├ transient → WAIT / RETRY VERIFY
├ compensation absent → RETRY COMPENSATION
└ unrecoverable → MANUAL_RECOVERY / IRRECOVERABLE
```

因此：

```text
Compensation Called ≠ Recovery Complete
Compensation Ack ≠ Restored State
Restored State ≠ Historical Erasure
```

---

## 發現 5：Agent transaction 的正確邊界通常不是單一 Tool Call，而是「語意上必須一起成立的一組 effects」

Cordon 與 Agentic Transaction 都推向同一個系統結論：

```text
per-RPC safety
```

不足以保證：

```text
workflow-level semantic consistency
```

例：

```text
create user
assign billing plan
create workspace
send invite
```

每個 call 單獨都合法、都成功，整體仍可能停在：

```text
user created
billing absent
workspace absent
invite sent
```

所以 Hermes 應建立：

```text
SemanticTransaction {
  transaction_id,
  task_id,
  semantic_goal,
  authority_envelope,
  read_set,
  write_set,
  staged_effects,
  externalized_effects,
  derived_results,
  invariants,
  commit_conditions,
  compensation_graph,
  recovery_state,
  provenance_root
}
```

### Cordon 帶來的 bottom-level pattern

```text
Tool intent
↓
Derived result object
↓
Lineage tracking
↓
Local reversible mutation → Shadow State
↓
External effect → Effect Outbox
↓
Compose entire flow
↓
Validate invariants / authority / lineage
↓
COMMIT
↓
Release staged effects
```

這會讓 Agent 的「思考/探索」與「真的改世界」第一次被系統化分開。

---

# 3. Architecture Breakdown

本輪建議 Hermes 新增：

# **Effect-Safe Semantic Transaction Runtime**

```text
User Intent
↓
Intent Version + Authority Envelope
↓
Planner
↓
Semantic Transaction Builder
├ semantic goal
├ invariants
├ expected effects
└ compensation requirements
↓
Tool Resolver
↓
Effect Contract Resolver
├ purity
├ read set
├ write set
├ side-effect class
├ idempotency support
├ compensation
└ verification method
↓
Precondition Snapshot
↓
Operation Identity / Idempotency Key
↓
Dispatch
↓
Effect State Machine
├ NOT_DISPATCHED
├ DISPATCHED_UNKNOWN
├ APPLIED_UNVERIFIED
├ APPLIED_VERIFIED
└ REJECTED_VERIFIED
↓
Verification Layer
├ provider receipt
├ read-after-write
├ invariant check
├ resource version
└ semantic postcondition
↓
Verify-Before-Retry Controller
↓
Shadow State / Effect Outbox
↓
Commit Gate
├ authority revalidation
├ TOCTOU precondition revalidation
├ provenance validation
├ transaction invariant
├ concurrency conflict check
└ branch winner check
↓
COMMIT / ABORT
↓
Saga Recovery Engine
├ compensation graph
├ reverse dependency order
├ compensation idempotency
└ post-compensation verification
↓
Durable Effect Ledger
↓
Planner / Memory / Provenance
↺
```

---

# 4. Bottom-Level Logic

## 4.1 Effect State Machine

建議 Hermes 不再使用 boolean `tool_success`：

```text
PREPARED
  ↓ dispatch
IN_FLIGHT
  ├ definite reject → REJECTED_VERIFIED
  ├ ack success → APPLIED_UNVERIFIED
  └ timeout / disconnect → DISPATCHED_UNKNOWN

DISPATCHED_UNKNOWN
  ↓ verify
  ├ found → APPLIED_VERIFIED
  ├ absent → SAFE_TO_RETRY
  └ ambiguous → RECONCILIATION_REQUIRED

APPLIED_UNVERIFIED
  ↓ postcondition
  ├ pass → APPLIED_VERIFIED
  └ fail → EFFECT_MISMATCH
```

這一層是本輪最重要的 bottom-level mechanism。

## 4.2 Verify-Before-Retry

錯誤：

```text
catch Timeout:
    retry()
```

正確：

```text
catch AmbiguousFailure:
    status = verify(operation_id, postcondition)

    if status == APPLIED:
        return prior_effect
    elif status == ABSENT:
        retry_same_operation_identity()
    else:
        reconcile_or_escalate()
```

## 4.3 Semantic TOCTOU

```text
Read R@v17
↓
derive belief B
↓
derive plan P
↓
commit-time R@v19
↓
DependencyGraph:
R → B → P.step3
↓
Only revalidate / repair affected plan suffix
```

## 4.4 Saga Recovery

```text
T1 forward  ──✓──┐
T2 forward  ──✓──┼── T3 fails
T3 forward  ──✕──┘

compensate(T2)
↓ verify(T2 inverse postcondition)
compensate(T1)
↓ verify(T1 inverse postcondition)
```

但若：

```text
T2 = SEND_EMAIL
```

則 inverse 不存在：

```text
COMPENSATION = send_correction
```

所以：

```text
Compensation Graph
≠ Inverse Function Graph
```

---

# 5. System Architecture 深拆：ACID-Agent

本輪不只讀 README，已追 `TsinghuaDatabaseGroup/ACID-Agent` 的 repository structure。

目前 `da_agent/` 主要可見：

```text
da_agent/
├ agent/
│  ├ acid_agent.py
│  ├ action.py
│  ├ agents.py
│  ├ claude_code.py
│  ├ codex.py
│  └ prompts.py
├ controllers/
│  ├ python.py
│  └ setup.py
├ envs/
│  ├ da_agent.py
│  └ step_env.py
├ review/
│  ├ answer_candidate.py
│  ├ exploration_evidence.py
│  ├ retry_policy.py
│  └ workspace_outputs.py
├ utils/
├ configs/
└ images/
```

`acid_agent.py` 的實作註解明確是：

```text
step-by-step execution
+ objective review
+ retry
```

並且 runtime 物件實際包含：

```text
trajectory
per-task persistent environment
pending reviews
verified outputs
quarantined outputs
exploration evidence
objective confidence evaluator
probability contrast
Evidence Surprise evaluator
RetryPolicy
AnswerCandidateTracker
```

這表示它的「ACID」不是 database engine 式 WAL/2PC，而更接近：

```text
Exploration
↓
Action
↓
Persistent Workspace State
↓
Objective / Evidence Review
↓
Verify / Quarantine / Retry
↓
Commit semantic answer/workspace
```

### 值得繼續讀的核心檔案

```text
da_agent/agent/acid_agent.py
  主 runtime / step loop / review-retry integration

da_agent/review/retry_policy.py
  recovery / retry decision

da_agent/review/exploration_evidence.py
  evidence lifecycle

da_agent/review/workspace_outputs.py
  output verification/quarantine

da_agent/utils/objective_confidence.py
  objective verification plane

da_agent/utils/probability_contrast.py
  uncertainty / contrast signal

da_agent/envs/da_agent.py
  persistent execution environment
```

### Hermes 應避免照搬的部分

ACID-Agent 的 semantic transaction 與本輪外部 side-effect transaction 不完全相同。

```text
Workspace/Data Agent Semantic Atomicity
≠
External SaaS / MCP Effect Atomicity
```

Hermes 應把兩者組合，而不是混為同一層。

---

# 6. Framework / System 比較

| System | 核心問題 | 交易邊界 | Failure Handling | 最值得 Hermes 借用 |
|---|---|---|---|---|
| Verified Tool Calls | non-atomic call / timeout ambiguity | single logical operation | verify-before-retry | EffectOutcome state machine |
| Atomix | speculative / conflicting effects | progress-aware transaction | delay + compensate | resource frontier / gated commit |
| Cordon | cross-step irreversible workflow | task semantic transaction | staged effect + recovery metadata | shadow state + effect outbox |
| ACID-Agent | long-horizon semantic correctness | exploration-execution-validation transaction | objective review + retry | semantic consistency / validation |
| Saga | cross-service partial commit | business workflow | reverse compensation | compensation graph |
| CoAgent | parallel agents mutate shared state | agent trajectory | semantic conflict repair + undo | selective repair instead of full abort |

關鍵結論：

```text
這些架構不是互斥的。
```

Hermes 最終應該分層：

```text
Operation Layer
→ verified tool call + idempotency

Transaction Layer
→ Atomix/Cordon-style commit boundary

Workflow Recovery Layer
→ Saga

Semantic Correctness Layer
→ ACID-Agent-style validation

Concurrency Layer
→ CoAgent-style selective invalidation/repair
```

---

# 7. Visual Simulation Idea

# **Effect Truth & Recovery Simulator**

這是本輪最適合加入 Hermes Console 的可互動模擬。

## Mode A：Non-Atomic Tool Call

畫面：

```text
Agent
  ↓ charge_card(K42)
Payment API
  ↓
CARD CHARGED ✓
  ↓
NETWORK RESPONSE LOST ✕
```

右側顯示：

```text
RPC status: TIMEOUT
Effect status: UNKNOWN

BAD ACTION:
[ Retry with new key ]

SAFE ACTION:
[ Verify K42 ]
```

按 Verify：

```text
Provider receipt found
$100 charged
operation_id = K42

→ APPLIED_VERIFIED
→ DO NOT RETRY EFFECT
```

## Mode B：TOCTOU / stale premise

```text
Agent A reads Inventory@17 = 1
       ↓
      Plan
       ↓
Agent B writes Inventory@18 = 0
       ↓
Agent A commit gate
```

UI 將 provenance graph 高亮：

```text
Inventory@17
   ↓
Belief: item available
   ↓
Plan.step4: charge customer
```

顯示：

```text
STALE PRECONDITION
Affected suffix only: steps 4–6

[ Repair suffix ]
[ Abort transaction ]
```

## Mode C：Saga Recovery

```text
Create Account      ✓
Charge Card         ✓
Create Workspace    ✕
Send Invite         blocked
```

自動生成 compensation timeline：

```text
Refund Card       REQUESTED
                 ↓
                 SETTLED ✓

Delete Account    REQUESTED
                 ↓
                 VERIFIED ✓
```

畫面必須特別區分：

```text
FORWARD STATE
COMPENSATION REQUEST
COMPENSATION ACK
RECOVERY VERIFIED
```

## Mode D：Parallel Agent Conflict

```text
Agent A             Agent B
Read file v10       Read file v10
Plan 20 sec         Write file v11
   ↓                    ↓
Conflict notification ←─┘
```

Hermes 顯示：

```text
Changed premise:
config.timeout = 30 → 60

Affected plan nodes:
P4, P7

Unaffected nodes:
P1, P2, P3, P5, P6
```

讓使用者看到：「Concurrency control 不一定等於整條 Agent 重跑」。

---

# 8. Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Effect Semantics
Effect Contract
Effect Truth
Logical Operation
Logical Operation Identity
Attempt Identity
Idempotency Key
Non-Atomic Failure
Ambiguous Outcome
Dispatch State
Acknowledgement State
World-State Verification
Verify-Before-Retry
Postcondition Verifier
Read Set
Write Set
Semantic Precondition
Semantic TOCTOU
Stale Premise
Semantic Conflict
Semantic Transaction
Shadow State
Effect Outbox
Recovery Metadata
Saga Coordinator
Compensation Contract
Compensation Verification
Recovery Verification
Recovery State
Pivot Effect
Irrecoverable Effect
Durable Effect Ledger
Selective Plan Repair
Agent-Level Serializability
```

## 新增 Edges

```text
ToolCall --DECLARES→ EffectContract
LogicalOperation --USES→ IdempotencyKey
Attempt --INSTANCE_OF→ LogicalOperation
ToolCall --READS→ ResourceVersion
ToolCall --WRITES→ Resource
PlanNode --DEPENDS_ON→ SemanticPrecondition
ResourceUpdate --INVALIDATES→ SemanticPrecondition
SemanticTransaction --STAGES→ Effect
SemanticTransaction --COMMITS→ Effect
ForwardEffect --HAS_COMPENSATION→ CompensationAction
CompensationAction --REQUIRES→ RecoveryVerification
Conflict --INVALIDATES→ PlanNode
EffectOutcome --RECORDED_IN→ DurableEffectLedger
```

## 新增否定關係

```text
Tool Return ≠ Effect Truth
RPC Failure ≠ Operation Failure
RPC Success ≠ Postcondition Success
Timeout ≠ Safe Retry
Same Attempt ≠ Same Logical Operation
New Retry UUID ≠ Idempotency
Permission Valid ≠ Precondition Valid
No Permission Race ≠ No Semantic TOCTOU
No Write Conflict ≠ No Semantic Conflict
Compensation Called ≠ Recovery Complete
Compensation Ack ≠ Restored State
Compensation ≠ Historical Erasure
Per-Tool Correctness ≠ Workflow Atomicity
Tool Transaction ≠ Semantic Transaction
State Changed ≠ Entire Plan Invalid
Concurrency Conflict ≠ Full Restart Required
```

---

# 9. 已確認事實 / 工程推論 / 尚未驗證假說

## 已確認（paper / official / source）

- Non-atomic tool failures會造成 timeout-after-dispatch、partial update、duplicate actions；verify-before-retry + idempotency key 是可行方向。
- Cordon 將 semantic transaction 設為 task-level boundary，使用 shadow state、effect outbox、result lineage 與 recovery metadata。
- ACID-Agent 官方 repository 確實把 runtime 拆成 agent / env / review / retry / evidence / workspace-output 等模組；主 agent 有 persistent environment、pending review、verified/quarantined output 與 retry policy。
- CoAgent 將 multi-agent shared-state conflict 視為 concurrency-control 問題，並以 serialization order + semantic plan repair + undoable tools 處理。
- AWS / Azure 等 distributed-system guidance 仍要求 mutating retry 使用 idempotency，跨服務一致性使用 saga/compensation 類方法。

## 工程推論（Hermes design proposal）

- Hermes 應把 `EffectOutcome` 做成獨立 state machine，而不是 boolean tool success。
- Hermes 的既有 Provenance Graph 最適合直接成為 semantic TOCTOU 的 dependency invalidation substrate。
- Idempotency key 應綁 intent/version/resource semantic identity，而不應由 retry attempt 自己產生。
- Compensation 要有獨立 verification contract；否則 recovery 只是在「希望它回復」。

## 尚未驗證假說

1. `Selective Plan Repair` 在 Hermes 實際 tool/MCP workload 上是否比 full retry 更穩定且省 token，需建立 fault-injection benchmark。
2. `SemanticPrecondition` 的自動抽取是否能達到足夠 precision，避免過度 invalidation。
3. 多 SaaS provider 的 idempotency / read-after-write / compensation capabilities 是否能被統一成一個通用 Effect ABI，尚待實作驗證。

---

# 10. Unknown / Open Questions

## 1. Tool Effect Contract 如何自動取得？

理想：

```text
Tool Schema
+
Provider Docs
+
Runtime Trace
+
Fault Injection
↓
EffectContract
```

但現有 MCP / OpenAPI schema 通常不完整描述：

```text
idempotent?
read-after-write delay?
compensatable?
rollbackable?
which resources touched?
exact verification query?
```

## 2. Semantic transaction 的 commit point 在哪裡？

太早：

```text
外部 effect 洩漏
```

太晚：

```text
latency / resource holding / UX 變差
```

需要 `Irreversibility × Confidence × Dependency Closure × User Intent` 的 adaptive commit policy。

## 3. Recovery verification 何時可以宣布「完成」？

很多 external systems 是 eventual consistency。

```text
refund initiated
≠ refund settled
```

所以可能需要：

```text
RecoveryPending
→ asynchronous verifier
→ terminal certificate
```

而不是 blocking Agent loop。

---

# 11. 下一輪研究

下一輪最深缺口已經移到：

# **Automatic Effect Inference × Tool Contract Learning × Read/Write Footprint Discovery × Effect ABI × Fault Injection**

因為目前架構開始清楚知道「如果 Effect Contract 存在，transaction / retry / recovery 可以安全很多」，但真正困難變成：

> **一個新 MCP tool / API / browser action 加進來時，Hermes 怎麼知道它到底會改什麼？**

下一輪應拆：

```text
New Tool / MCP Capability
↓
Schema Inspection
↓
Static Effect Hints
↓
Sandbox Execution
↓
Before-State Snapshot
↓
Tool Invocation
↓
After-State Diff
↓
Retry Probe
↓
Idempotency Test
↓
Failure Injection
↓
Partial-Effect Detection
↓
Compensation Probe
↓
Verification Query Discovery
↓
Learned Effect Contract
↓
Effect Certificate
```

研究重點：

- automatic read/write set extraction
- MCP / OpenAPI effect metadata
- deterministic tool contracts
- property-based testing
- fault injection
- state diffing
- browser/computer action effect discovery
- API idempotency inference
- reversible / compensatable / irreversible classification
- physical / multimodal action effect semantics

---

# 12. 本輪結束回答

**缺哪一層？**  
最缺的是 **Automatic Effect Contract / Effect ABI Discovery Plane**。現在 transaction architecture 已逐步完整，但仍過度依賴人類事先知道 tool 的 idempotency、read/write footprint、verification 與 compensation semantics。

**哪個節點最淺？**  
`SemanticPrecondition` 與 `EffectContract` 的自動抽取目前最淺。

**哪個概念仍只是名詞？**  
`Universal Effect ABI`、`RecoveryCertificate`、`SemanticTransactionCertificate`、`EffectTruthScore`。

**哪個系統最值得繼續讀原始碼？**  
第一優先：`TsinghuaDatabaseGroup/ACID-Agent` 的 `agent/acid_agent.py`、`review/retry_policy.py`、`review/exploration_evidence.py`、`review/workspace_outputs.py`。第二優先是取得 Cordon / CoAgent 若有正式 code release 後深入 transaction manager / effect outbox / ToolSmith middleware。

**哪篇論文需追引用？**  
Cordon → Atomix → Verified Tool Calls；以及 Agentic Transaction → CoAgent。前者是 effect/recovery 線，後者是 semantic correctness/concurrency 線。

**哪個概念最適合視覺模擬？**  
**Effect Truth & Recovery Simulator**：特別是 timeout-after-effect、verify-before-retry、TOCTOU stale premise、Saga compensation verification、multi-agent selective repair。

**哪個 Agent 架構最值得實作？**  

> **Effect-Safe Semantic Transaction Agent Runtime = Task-Scoped Authority + Effect Contract + Logical Operation Identity + Idempotency + Effect Outcome State Machine + Verify-Before-Retry + Semantic Precondition Tracking + Shadow State/Effect Outbox + Commit-Time Revalidation + Saga Recovery + Recovery Verification + Durable Effect Ledger + Provenance-Driven Selective Repair。**

---

# 13. 回到「AI 到底怎麼運作」總鏈

本輪把原本：

```text
UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tools / MCP
→ Models
→ GPU
→ Output
```

中的 `Tools / MCP` 再拆成：

```text
Planner Intent
↓
Authority
↓
Tool Schema
↓
Effect Contract
↓
Logical Operation Identity
↓
Arguments
↓
Precondition Snapshot
↓
Dispatch
↓
External System
↓
World-State Change
↓
Acknowledgement
↓
Postcondition Verification
↓
Commit / Retry / Compensation
↓
Recovery Verification
↓
Provenance + Memory
↓
Next Decision
```

因此 Agent 真正可靠地「做一件事」並不是 `model emits tool_call` 就結束，而是一直到：

```text
Intent authorized
+
operation uniquely identified
+
effect actually observed
+
postcondition verified
+
workflow invariants preserved
+
recovery path verified if needed
```

才算完成。

這是本輪對「AI 到底怎麼運作」新增的最底層可靠執行層。