# 【AI Agent × Multimodal Research Report】

**時間：2026-09-10 04:52（Asia/Taipei）**

**本輪主題：Capability Epoch × Long-Running Tool Cancellation × Late Result Fencing × Orphaned Execution × Result Commit Validation**

## 與歷史研究比較

上一輪已建立：Failure Detector → Lease → Membership Epoch → Fencing Token → Resource-side Validation，主要解決「舊 Worker 復活後再次發起 stale write」的 split-brain 問題。本輪避免重複，專門處理更難的情況：**舊 Worker 在 authority 有效時已經啟動長任務，但 authority 失效後，舊任務才完成並送回結果。**

因此研究焦點由 request fencing 推進到 **completion fencing / result commit fencing**：

```text
START under authority=41
↓
15-minute GPU / MCP / browser / video job
↓
lease expires
↓
new owner authority=42
↓
old job eventually completes
↓
Can its result still mutate state?
```

核心結論：**Cancellation intent ≠ Execution stopped ≠ Result is invalid ≠ Result cannot commit.** 可靠 Agent Runtime 必須把這四件事分開建模。

---

## 本小時新發現

### 新架構：Capability Epoch + Completion Fence

將一次工具/模型/多模態長任務的 authority 固定在啟動瞬間：

```text
ExecutionAuthority
├ run_id
├ plan_node_id
├ capability_id
├ capability_epoch
├ worker_session
├ fence_token
├ input_hash
├ side_effect_scope
└ commit_policy
```

工作執行完成後，**不能直接寫回 Agent State / Artifact Store / External World**，而應先經 Result Commit Gateway：

```text
Raw Completion
↓
Result Envelope
↓
Completion Fence Validation
├ same capability epoch?
├ session still valid?
├ task still expected?
├ replacement execution exists?
├ input identity unchanged?
├ branch still live?
├ side effect already committed?
└ result policy allows late acceptance?
↓
COMMIT / DISCARD / QUARANTINE / REPLAY / FORK
```

### 新官方資訊：MCP Tasks cancellation 是 cooperative、eventually consistent

MCP Tasks extension（`io.modelcontextprotocol/tasks`）在 2026-07-28 規格中明確指出，`tasks/cancel` 只表示 cancellation intent；server ack 不代表 underlying work 已停止，task 甚至可能最後變成 `completed` 而不是 `cancelled`。這意味 MCP protocol 本身沒有替 Agent Runtime 提供「取消後的晚到結果一定不能被採納」語義；host/runtime 必須自己補 result fencing。

### 新工程實作：MCP C# SDK 把 execution token 和 task state 分開

官方 C# SDK 的 Tasks 實作會為每個 task 建立獨立 CancellationTokenSource，背景執行透過 task token 傳入 tool pipeline；結果完成後呼叫 `SetCompletedAsync`，取消路徑則呼叫 `SetCancelledAsync`。官方 TaskStore 契約還要求 terminal task 的 `SetCompletedAsync` / `SetFailedAsync` / `SetCancelledAsync` 應為 no-op，以避免 late cancellation 覆寫既有 terminal result。這是重要的一階防護，但它處理的是「task state terminalization race」，不等於跨 Worker / capability epoch / branch replacement 的 result fencing。

### 新工程實作：Temporal 長任務取消依賴 heartbeat / worker cooperation

Temporal Activity 的 cancellation 並非魔法中止。非 local Activity 需要 heartbeat 才能收到 server-side cancellation；heartbeat timeout 後 service 可判定 activity timeout 並重試新的 attempt，而舊工作在某些 executor/外部工作模式下仍可能持續。Temporal Python SDK 本身把 running activity 以 `task_token` 管理，建立 cancellation event，並在 completion 時把 result 回報 core。這再次說明 durable workflow engine 可以可靠地管理 execution state，但真正「外部工作是否已停」與「晚到 result 是否仍應提交」仍需要適配器語義。

### 新論文：Cancellation in Systems

Microsoft Research / OSDI 2022《Cancellation in Systems: An Empirical Study of Task Cancellation Patterns and Failures》分析 13 個分散式/並行系統中的 62 個 cancellation feature requests 與 156 個 cancellation-related bugs，指出 cancellation 經常被低估，錯誤集中在 cancellation propagation、cleanup、race、資源生命週期等。這提供了對 Agent Runtime 很重要的警告：**cancel 不是單一 API call，而是一條跨層協議。**

---

## 本小時最重要 5 個發現

### 1. Cancellation 是 signal，不是事實

**概念：Cancellation Intent**

底層流程應拆成：

```text
Cancel Requested
↓
Cancellation Recorded
↓
Signal Delivered?
↓
Worker Observed?
↓
Underlying Runtime Interruptible?
↓
Cleanup Finished?
↓
Execution Terminalized?
```

MCP 2026-07-28 明確採 cooperative cancellation；Temporal Activity 也要求 heartbeat 才能收到部分 server-side cancellation。兩者共同證明：

```text
cancel_ack
≠
worker_stopped
```

**為什麼重要：** Agent 若把 cancel ack 當成「世界已停止」，就可能在 replacement task 已開始後仍收到舊結果，造成 duplicate output、stale memory update、重複發文、重複影片 artifact 或錯誤 tool observation。

**限制：** cancellation 是否能硬中止取決於 runtime、OS process、GPU API、browser session、HTTP request、external provider 等。

---

### 2. Request Fencing 不足，必須增加 Result Fencing

上一輪的 fencing token 能阻止舊 Worker「重新發起」操作，但不能解決：

```text
Request was valid when started
↓
Authority later expired
↓
Completion arrives late
```

因此新增：

```text
ResultFence = validate(
  capability_epoch,
  task_generation,
  branch_id,
  input_hash,
  current_owner,
  terminal_state
)
```

結果 envelope：

```text
CompletionEnvelope
├ task_id
├ attempt_id
├ capability_epoch
├ fence_token
├ started_at
├ completed_at
├ input_hash
├ output_hash
├ effect_evidence
└ parent_plan_revision
```

提交前：

```text
if envelope.capability_epoch < current_epoch:
    reject_or_quarantine()
```

**工程推論：** 對 read-only 工作可以允許「stale but still useful」結果進 quarantine；對 write / irreversible 工作則應更嚴格，通常只接受 current authority 的 terminal evidence。

---

### 3. Task Generation 必須和 Attempt ID 分開

Retry 常被錯誤地只用 attempt number 表達：

```text
attempt=1
attempt=2
```

但 replacement / replan / fork 其實是另一個語義層：

```text
Task Generation 17
├ attempt 1
├ attempt 2

Task Generation 18
└ replacement after authority transfer
```

因此新增：

```text
attempt_id
≠
task_generation
≠
capability_epoch
```

- `attempt_id`：同一 execution intent 的 retry。
- `task_generation`：同一 plan node 被 replacement / supersede 後的新世代。
- `capability_epoch`：執行權限世代。

**為什麼重要：** 舊 attempt 的結果有時可被新 attempt reuse；但舊 generation 的結果通常不能自動覆寫新 generation。

---

### 4. Cancellation 和 Commit 必須採兩階段狀態機

推薦的 task state 不只：

```text
working / completed / failed / cancelled
```

而要增加 execution 與 acceptance 的分離：

```text
ExecutionState
QUEUED
RUNNING
CANCEL_REQUESTED
STOPPING
EXECUTED
FAILED
ORPHANED

CommitState
UNDECIDED
CURRENT
STALE
QUARANTINED
COMMITTED
DISCARDED
SUPERSEDED
```

所以可能出現：

```text
ExecutionState = EXECUTED
CommitState    = DISCARDED
```

這不是錯誤，而是「工作確實完成，但結果已不再有 authority」。

這一層對 GPU generation 特別重要：模型算完一支影片不代表這支影片應自動掛入現在 branch。

---

### 5. Late result policy 應依 Effect Class 而不同

不能對所有 long-running tool 使用同一策略。

```text
PURE COMPUTE
→ stale result may be cacheable

READ ONLY
→ stale result may be quarantine/revalidate

IDEMPOTENT WRITE
→ verify current desired state

COMPENSABLE WRITE
→ verify effect + maybe compensate

IRREVERSIBLE WRITE
→ strict fence + terminal evidence required
```

因此 Capability Graph 再新增：

```text
Capability
├ execution_timeout
├ cancellation_mode
├ interruption_granularity
├ late_result_policy
├ result_fence_domain
├ effect_class
└ compensation_policy
```

**核心改變：** Capability 不只描述「能做什麼」，還必須描述「失去 authority 後，正在做的工作和晚到結果要怎麼處理」。

---

## Architecture Breakdown

```text
User Goal
↓
Plan Compiler
↓
Plan Node
↓
Capability Resolver
↓
Authority Grant
├ capability_epoch
├ fence_token
├ task_generation
└ branch_id
↓
Execution Start Journal
↓
Long-Running Runtime
├ MCP Task
├ Temporal Activity
├ GPU Job
├ Browser Job
├ Coding Sandbox
└ External API Operation
↓
Heartbeat / Progress
↓
Cancellation Plane
├ cancel intent
├ cancellation delivery
├ stop acknowledgement
└ forced isolation
↓
Execution Completion
↓
Completion Envelope
↓
RESULT COMMIT GATE
├ CapabilityEpochValidator
├ TaskGenerationValidator
├ BranchLivenessValidator
├ InputIdentityValidator
├ EffectVerifier
├ DuplicateCommitDetector
└ PolicyEngine
↓
COMMIT
DISCARD
QUARANTINE
REVALIDATE
COMPENSATE
FORK
```

關鍵是：

```text
Execution Plane
≠
Commit Plane
```

Worker 可以做完，但 commit plane 可以拒絕它。

---

## Bottom-Level Logic

### 1. Capability Epoch

對每個 capability/fence domain 維護 monotonic epoch：

```text
Epoch(capability, scope) = N
```

工作啟動：

```text
job.capability_epoch = N
```

authority transfer：

```text
Epoch → N+1
```

late completion：

```text
Accept(job) only if
job.capability_epoch == CurrentEpoch(scope)
```

但 read-only/cacheable 工作可有例外：

```text
if stale
and effect_class == PURE
and input_hash matches
and output still valid:
    CACHE_ONLY
```

### 2. Supersession

```text
TaskGeneration 17
↓
SUPERSEDED_BY
TaskGeneration 18
```

任何 generation 17 完成結果：

```text
state mutation = BLOCK
cache reuse     = policy dependent
artifact keep   = quarantine/pin policy dependent
```

### 3. Cancellation Timeline

```text
t0 START(epoch=41)
t1 HEARTBEAT
t2 CANCEL_REQUESTED
t3 lease expires
t4 epoch=42 granted
t5 replacement starts
t6 old execution completes
```

在 t6 不能只判斷：

```text
result == success
```

而應判斷：

```text
CurrentEpoch == 42
CompletionEpoch == 41
↓
STALE_COMPLETION
```

### 4. Commit Predicate

Hermes 工程模型：

```text
CommitAllowed(R) =
  ResultIntegrityValid(R)
  ∧ TaskGenerationCurrent(R)
  ∧ CapabilityEpochCurrent(R)
  ∧ BranchAcceptsResult(R)
  ∧ NoNewerCommittedResult(R)
  ∧ EffectPolicyAllows(R)
```

若任一條失敗：

```text
DO NOT mutate canonical state
```

---

## Visual Simulation Idea

# Long-Running Task Cancellation & Late Result Fence Lab

時間軸：

```text
Worker A          Authority        Worker B          Commit Gate
   |                  |               |                  |
START epoch=41         |               |                  |
   |-----------------> GPU job        |                  |
   | heartbeat         |               |                  |
   X partition         |               |                  |
                      expire           |                  |
                      epoch=42 -------> START replacement |
   |                  |               |                  |
OLD GPU RESULT ----------------------------------------->|
                                                      epoch 41
                                                      current 42
                                                      REJECT
```

互動控制：

```text
CANCEL TASK
DROP HEARTBEAT
EXPIRE LEASE
TRANSFER AUTHORITY
START REPLACEMENT
DELIVER OLD RESULT
CHANGE BRANCH
CHANGE INPUT
```

介面即時顯示：

```text
Execution stopped?      NO
Cancellation observed?  UNKNOWN
Old result arrived?     YES
Capability epoch valid? NO
Task generation valid?  NO
Effect class             PURE COMPUTE

Decision:
QUARANTINE AS CACHE CANDIDATE
DO NOT COMMIT TO BRANCH
```

另一個模式改成 `IRREVERSIBLE_WRITE`：

```text
Decision:
REJECT + VERIFY EXTERNAL EFFECT
```

這個 Simulator 可以直接解釋「AI 取消一個任務後，為什麼舊任務仍可能跑完，以及系統如何保證它不污染新世界」。

---

## Code / GitHub

### temporalio/sdk-python

值得看的核心目錄 / 檔案：

```text
temporalio/worker/_activity.py
temporalio/activity.py
temporalio/client/_activity.py
```

`_activity.py` 實際維護 running activities，以 task token 索引，建立 cancellation event，接收 start/cancel task，記錄 heartbeat，最後把 completion 回報 core。這對 Hermes 最值得借鏡的不是 API 形式，而是「execution identity / cancellation signal / completion reporting」三者明確分離。

### modelcontextprotocol/csharp-sdk

值得看的核心檔案：

```text
src/ModelContextProtocol.Extensions.Tasks/Server/
├ IMcpTaskStore.cs
├ InMemoryMcpTaskStore.cs
└ McpTasksBuilderExtensions.cs
```

`McpTasksBuilderExtensions` 實際建立每 task 專用 CancellationTokenSource，背景執行 tool pipeline，再以 task store terminalize completed/cancelled/failed；TaskStore 契約要求 terminal update no-op，避免 late state transition 覆寫既有 terminal state。

Hermes 應在這個模型上多加：

```text
capability_epoch
fence_token
task_generation
branch_id
result_commit_policy
```

---

## Papers

### Cancellation in Systems: An Empirical Study of Task Cancellation Patterns and Failures

- **Authors:** Utsav Sethi, Haochen Pan, Shan Lu, Suman Nath, Madan Musuvathi
- **Institution:** Microsoft Research / collaborators
- **Year:** 2022
- **Venue:** OSDI 2022
- **Architecture / Scope:** empirical study across concurrent/distributed systems
- **Dataset:** 62 cancel-feature requests + 156 cancel-related bugs across 13 systems
- **Contribution:** identifies recurrent cancellation anti-patterns and demonstrates that cancellation correctness spans propagation, cleanup, resource lifecycle and concurrency races
- **Limitation:** not specific to LLM/Agent Runtime; does not define capability epochs or late-result commit fencing
- **改變了什麼：** 支持把 cancellation 從「一個 token / API」重新定義成「跨多層 execution protocol」

### The Tail at Scale

- **Authors:** Jeffrey Dean, Luiz André Barroso
- **Institution:** Google
- **Year:** 2013
- **Venue:** Communications of the ACM
- **Architecture:** hedged / tied requests for tail-latency mitigation
- **Contribution:** shows that duplicate/secondary execution and loser cancellation can reduce tail latency dramatically; cited benchmark: hedging after 10 ms reduced p99.9 latency from 1800 ms to 74 ms with ~2% extra requests in the described BigTable test
- **Limitation:** focuses on latency and mostly request-level duplicate work; does not solve stale authority or external side-effect fencing
- **改變了什麼：** 提醒 Agent Runtime 未來若做 speculative / hedged tool execution，必須把「loser cancellation」與「loser late completion rejection」一起設計

---

## 已確認事實 / 工程實作 / 推論分級

**已確認官方事實：** MCP Tasks cancellation 是 cooperative 且 eventually consistent；cancel ack 不保證最終 `cancelled`。Temporal Activity cancellation 對非 local activity 依賴 heartbeat/worker cooperation。

**已確認工程實作：** MCP C# SDK 為 task 建立獨立 cancellation source，背景執行後寫入 terminal task store；Temporal Python SDK 以 task token 管 running activity、heartbeat、cancellation event、completion。

**論文結果：** OSDI 2022 cancellation study 提供大規模 cancellation bug 類型證據；The Tail at Scale 提供 duplicate execution / loser cancellation 的 tail-latency背景。

**合理工程推論：** Agent Runtime 應加入 Capability Epoch、Task Generation、Completion Envelope、Result Commit Gate 與 Late Result Policy。

**尚未驗證假說：** 是否能建立跨 MCP / Temporal / Kubernetes / GPU queue / Browser automation 通用的 `CapabilityEpoch ABI`，目前沒有已知通用標準。

---

## Unknown / Open Questions

1. GPU provider / image-video generation API 若不支援 server-side cancellation，應以何種標準 envelope 回傳 orphaned completion，並避免 artifact 洩漏與計費失控？
2. 對 read-only / pure compute late result，什麼條件下可以安全轉為 cache，而不是完全丟棄？需要定義 semantic input identity / freshness window。
3. Capability Epoch 應以 global monotonic counter、per-resource generation、Raft term、lease generation 還是 signed authority token 表達，才容易跨 MCP / Tool / GPU / browser runtime？

---

## 下一輪研究

下一輪應進入：

# Speculative / Hedged Agent Execution × Duplicate Suppression × Winner Commit × Loser Cancellation × Cost-aware Racing

因為現在已具備：

```text
start identity
→ cancellation
→ capability epoch
→ late result fence
```

下一步可以安全研究：

```text
Primary Tool / Model
          ↓ slow
Secondary Tool / Model
          ↓ fast
Winner Selection
↓
Winner Commit Fence
↓
Cancel Losers
↓
Late Loser Results
↓
Discard / Cache / Verify
```

要比較：

```text
Hedged Requests
Speculative Execution
Backup Tasks
Model Routing Racing
Multi-provider LLM Racing
Parallel Tool Candidate Execution
GPU speculative generation
```

並回答什麼時候值得用額外成本換 latency / reliability，以及 side-effecting tool 為什麼通常不能直接 hedge。

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
Capability Epoch
Task Generation
Execution Authority
Cancellation Intent
Cancellation Delivery
Execution Stop State
Orphaned Execution
Completion Envelope
Late Result
Stale Completion
Result Commit Gate
Result Fence Validator
Supersession Relation
Winner Commit
Late Result Policy
Quarantine Result
Cache-Only Result
```

### Edges

```text
Task Start
→ captures
Capability Epoch

Authority Transfer
→ increments
Capability Epoch

Cancellation Intent
→ may_trigger
Execution Stop

Cancellation Ack
≠
Execution Stopped

Execution Completion
→ produces
Completion Envelope

Completion Envelope
→ validated_by
Result Commit Gate

Older Task Generation
→ superseded_by
New Task Generation

Stale Completion
→ must_not_mutate
Canonical State

Pure Compute Late Result
→ may_become
Cache-Only Result

Irreversible Write Late Result
→ requires
External Effect Verification

Request Fencing
≠
Result Fencing
```

---

## 本輪收斂回答

- **缺哪一層：** speculative / hedged execution 的 winner/loser commit protocol。
- **哪個節點最淺：** Late Result Policy，尤其 pure/read-only result 的安全 reuse 條件。
- **哪個概念仍只是名詞：** Unified Capability Epoch ABI、Cross-Runtime Completion Envelope。
- **哪個系統值得讀原始碼：** Temporal Python Activity worker 與 MCP C# Tasks runtime；下一輪可追 Temporal server activity completion / retry path。
- **哪篇論文需追引用：** Cancellation in Systems；The Tail at Scale。
- **哪個概念最適合視覺模擬：** Long-Running Task Cancellation & Late Result Fence Lab。
- **哪個 Agent 架構最值得實作：** `Capability-Epoch Fenced Agent Runtime = Execution Authority + Cancellation Plane + Task Generation + Completion Envelope + Result Commit Gate`。

## 核心結論

真正可靠的 Agent 取消機制，不是「按取消後 task status 變 cancelled」而已。長時間 GPU、MCP、Browser、Coding 或外部 API 工作可能無法立即停止，甚至會在 authority 已轉移後才完成。因此 Agent Runtime 必須把「取消意圖」「實際停止」「工作完成」「結果是否仍有資格提交」拆成不同狀態。Request-side fencing 只能阻止舊 Worker 再發新操作；要防止已在路上的舊工作污染新世界，還必須有 **Capability Epoch + Task Generation + Result Commit Fence**。