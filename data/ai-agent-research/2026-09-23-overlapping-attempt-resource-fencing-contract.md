# 【AI Agent × Multimodal Research Report】

**時間：2026-09-23 03:52（Asia/Taipei）**

**本輪主題：Overlapping Activity Attempts × Resource-Enforced Fencing × Commit Admission Contract**

## 與歷史研究比較

歷史研究已建立兩條不同防線：

1. 2026-09-10 的 `Capability Epoch × Completion Fence` 處理「舊 execution 晚到的 result 能不能寫回 Agent state」。
2. 2026-09-23 的 `Receipt Evidence Lattice` 處理「外部 effect 是否真的發生、是否能證明由本次 SemanticCommit 造成」。

本輪避免重複，補中間仍缺的一層：**當 durable runtime 因 heartbeat timeout / retry 啟動新 attempt，而舊 attempt 尚未真正停止時，如何阻止 stale attempt 在新 attempt 之後仍修改 external resource。**

這不是 result fencing，而是 **write admission fencing**。

---

## 本小時新發現

### 新架構：Attempt Overlap 必須視為正常 failure mode

Temporal server source 的 `RecordActivityTaskHeartbeat` 契約明確說明：若 worker 未在 heartbeat timeout 內 heartbeat，Activity 會被標記 timed out，`ActivityTaskTimedOut` 寫入 Workflow History；之後舊 task token 再 heartbeat 會失敗。這證明 service 可以終止「server 對 attempt 的認可」，但不等於舊 process / thread / external request 已物理停止。

因此可能出現：

```text
Attempt A fence=41 starts
→ external call / long computation
→ heartbeat lost
→ Temporal records timeout
→ retry Attempt B fence=42 starts
→ B commits
→ A resumes after pause/network delay
→ A attempts stale commit
```

核心 invariant：

`ActivityTaskTimedOut --does_not_prove→ OldAttemptStopped`

以及：

`NewAttemptStarted --does_not_prove→ OldAttemptCannotWrite`

### Bottom-level mechanism：Fencing Token 必須由 resource-side 強制驗證

Martin Kleppmann 對 distributed lease 的經典分析指出：即使 lock service 本身正確，舊 client 在 lease 過期後仍可能因 GC pause / network delay 復活並寫入。修正方式不是只檢查 client 自己的 lease，而是每次 acquisition 取得單調遞增 fencing token，並要求 storage/resource 記住已接受的最大 token、拒絕更小 token。

因此 Hermes 定義：

`FenceToken(resource, semanticCommit) = monotonic generation`

Resource admission：

```text
if request.fenceToken < resource.maxAcceptedFence:
    REJECT_STALE_ATTEMPT
else:
    atomically apply effect and advance maxAcceptedFence
```

重要區分：

`LeaseValidity` 是 client/runtime-side knowledge；
`FenceAcceptance` 是 resource-side safety property。

### PostgreSQL：advisory lock 不是 fencing token

PostgreSQL 官方文件說 advisory locks 的語義由 application 定義，且 session-level lock 可活到 explicit unlock / session end；它們能協調 mutual exclusion，但本身沒有「resource 永久拒絕較舊 generation」的 monotonic fencing semantics。

所以：

`AdvisoryLockHeld --does_not_prove→ StaleWriterCannotCommitLater`

對 Hermes 更安全的 database adapter 是把 fencing generation 存進 resource row，並在同一 SQL mutation 做 CAS：

```sql
UPDATE agent_resource
SET value = :new_value,
    last_fence = :fence,
    version = version + 1
WHERE id = :id
  AND last_fence < :fence
  AND version = :expected_version;
```

`rows_affected = 1` 才形成 `FenceAdmissionWitness`；`0` 代表 stale fence 或 concurrent version conflict，需要 reconciliation，不得盲目 retry。

### 新模型：Attempt Identity、Semantic Commit、Fence Generation 必須分離

同一 semantic effect 可有多次 runtime attempt：

```text
SemanticCommit S17
├ Attempt A1
├ Attempt A2
└ Attempt A3
```

它們共用：

`semanticCommitId + effectDigest + externalIdempotencyKey`

但每次 attempt 可有新的：

`activityAttempt + workerSession + leaseGeneration + fenceGeneration`

因此：

`AttemptIdentity != SemanticCommitIdentity != FenceGeneration`

Idempotency 解決「同一 effect 重送不要做兩次」；fencing 解決「舊 owner 即使復活也不能在新 owner 之後寫」。兩者不能互相替代。

### 新 Commit Admission Contract

Hermes 對高風險 side effect 的 write path 應改成：

```text
SemanticCommitEnvelope
→ EffectManifest
→ Acquire/Issue FenceGeneration
→ Activity Attempt
→ Tool/MCP Adapter
→ Resource Admission Gate
   ├ SemanticCommitId match
   ├ EffectDigest match
   ├ Idempotency key match
   ├ Fence >= required/current fence
   ├ Expected resource version match
   └ Authority generation valid
→ External Commit
→ Receipt(fence, resourceVersion, transactionId)
→ ReceiptVerifier
→ Observation Commit Gate
```

新的核心 invariant：

`SafeExternalCommit = IdempotencyBinding ∧ FenceAdmission ∧ PreconditionWitness ∧ AuthorityValid ∧ EffectDigestMatch`

---

## 本小時最重要 5 個發現

### 1. Heartbeat timeout 會終止 server-side attempt validity，但不能證明舊工作已停止

**已確認事實 / 官方 + source：** Temporal source 明確把 missed heartbeat → ActivityTaskTimedOut history event；舊 task token 後續 heartbeat 會失敗。

**限制：** runtime history 無法物理撤回已送往外部系統的 request。

### 2. Completion fencing 與 write fencing 是不同安全邊界

**工程推論：** 2026-09-10 的 Completion Fence 能阻止 stale result 回寫 Hermes state，但若 stale worker 已直接修改 Stripe/DB/GitHub/robot，result discard 已經太晚。

因此需要 external resource admission gate。

### 3. Fencing token 的安全性來自「resource 拒絕 stale token」，不是 token 本身

**已確認機制：** monotonic token 只有在 storage/resource 記住更高 generation 並拒絕舊 generation 時才有 correctness value。

### 4. Advisory lock ≠ fencing

**官方資訊：** PostgreSQL advisory locks 是 application-defined lock primitive；session / transaction lifecycle不同，但官方沒有提供 monotonic stale-writer rejection contract。

**工程實作：** 用 row `last_fence` + version CAS 可把 fencing admission 與 mutation 放在同一 database transaction。

### 5. Idempotency + fencing + CAS 解決三種不同 race

```text
Idempotency → duplicate semantic effect
Fencing     → stale owner / stale attempt
CAS/version → concurrent mutation of current resource generation
```

高風險 Agent side effect 應同時使用三者，而不是選一個。

---

## Architecture Breakdown

### System Architecture：Durable Agent Write Admission Plane

```text
Planner
→ SemanticCommitEnvelope
→ Durable Workflow
→ Attempt Scheduler
→ Fence Authority
→ Worker Attempt
→ MCP/Tool Adapter
→ Resource Admission Gate
→ External Resource
→ Receipt Store
→ Reconciler
→ Observation Commit Gate
```

`Fence Authority` 可以是能產生 monotonic generation 的 strongly ordered store / DB sequence / resource version authority；真正 correctness 關鍵仍是 target resource 的 admission check。

### Failure path

```text
A1 fence=101 starts
→ pause
→ heartbeat timeout
→ A2 fence=102 starts
→ A2 write accepted; resource.lastFence=102
→ A1 resumes
→ A1 write fence=101
→ resource rejects STALE_FENCE
→ A1 result quarantined
```

如果 external API 無法接受 fencing token，Hermes 必須降級：依賴 vendor idempotency + reconciliation；對不可逆高風險 action，若無法建立足夠 receipt / fence，應要求 stronger approval 或 serialize through a Hermes-controlled proxy.

---

## Bottom-Level Logic

### Fenced CAS

```text
Input:
  semanticCommitId
  effectDigest
  fenceGeneration
  expectedResourceVersion

Atomic resource transaction:
  read currentFence/currentVersion
  reject if fenceGeneration < currentFence
  reject if expectedVersion != currentVersion
  verify semantic effect identity
  apply mutation
  persist currentFence=fenceGeneration
  increment resourceVersion
  emit receipt
```

注意 `fence == currentFence` 是否允許必須由 idempotency record 決定：若相同 semanticCommit/effectDigest，回傳既有 receipt；若 identity/digest 不同，標記 collision。

---

## Visual Simulation Idea

### Overlapping Attempt & Resource Fence Microscope

八條 timeline：

`Temporal Service | Attempt A | Attempt B | Fence Authority | MCP Adapter | Resource Gate | External Resource | Receipt/Observation`

可注入：

- `HEARTBEAT_TIMEOUT_OLD_WORKER_STILL_RUNNING`
- `GC_PAUSE_AFTER_LEASE_EXPIRY`
- `NETWORK_DELAY_STALE_WRITE_ARRIVES_LAST`
- `SAME_SEMANTIC_COMMIT_NEW_ATTEMPT`
- `STALE_FENCE_REJECTED`
- `FENCE_VALID_BUT_VERSION_CONFLICT`
- `EXTERNAL_API_HAS_IDEMPOTENCY_BUT_NO_FENCING`
- `OLD_ATTEMPT_COMPLETES_AFTER_NEW_RECEIPT`

UI 核心狀態：

`Attempt A TIMED_OUT | Attempt B RUNNING | Fence A=101 | Fence B=102 | ResourceFence=102 | A write BLOCKED | B Receipt CONFIRMED`

---

## Code / GitHub

### Temporal server

值得繼續追：

- `service/frontend/workflow_handler.go` — Activity heartbeat API boundary；source comment 明確描述 missed heartbeat → timeout history event。
- `service/history/timer_queue_active_task_executor.go` — timeout timer processing / retry decision。
- `service/history/historybuilder/event_factory.go` — `CreateActivityTaskTimedOutEvent` 與 attempt metadata。
- `service/history/workflow/mutable_state_impl*` — ActivityInfo attempt/stamp generation。

### Hermes 建議實作

新增 runtime contracts：

- `FenceToken`
- `FenceAuthority`
- `FenceAdmissionWitness`
- `FencedEffectManifest`
- `ResourceVersionWitness`
- `StaleAttemptRejectionReceipt`

Adapter capability flags：

```text
supportsIdempotency
supportsFencing
supportsConditionalMutation
supportsTransactionReceipt
supportsReconciliationLookup
```

---

## Papers / References

### How to do distributed locking

- **Author:** Martin Kleppmann
- **Year:** 2016
- **Type:** distributed-systems technical analysis
- **Architecture:** lease/lock → monotonic fencing token → storage-side stale-token rejection
- **Contribution:** 清楚說明 lease expiry + paused client 的 stale write race，並提出 resource-enforced fencing。
- **Limitation:** 不是 Agent-specific protocol，也不是 peer-reviewed paper；Hermes 將其機制映射到 durable Agent attempt overlap。

### Temporal Activity semantics

- **Source:** Temporal official docs + temporalio/temporal source
- **Mechanism:** heartbeat timeout → timeout history → retry attempt；cancellation/heartbeat 是 cooperative runtime control。
- **Limitation:** durable execution history 不自動提供 external resource fencing。

### PostgreSQL advisory locks

- **Source:** PostgreSQL official documentation
- **Mechanism:** application-defined session/transaction locks。
- **Limitation:** lock primitive 本身不是 monotonic fencing protocol。

---

## Unknown / Open Questions

1. Temporal `ActivityInfo.Stamp` 是否具有可安全映射為跨 retry monotonic fencing token 的正式穩定語義，還是只能視為 internal mutable-state generation？在確認 normative contract 前不可直接拿它做 external fence。
2. 對無法接受 custom fencing token 的 SaaS API，Hermes-controlled proxy 能否以 per-resource serialized outbox + vendor idempotency 建立等價安全性？需要按 API 類型驗證。
3. Multi-region / failover 下 Fence Authority 的 monotonicity 與 target resource admission 如何跨 region 保持，尤其 resource 本身只有 eventual consistency 時仍未解決。

---

## 下一輪研究

深入：

`Temporal ActivityInfo Stamp / attempt generation → history mutable state → retry scheduling → task token validity → FenceAuthority design → multi-region generation ordering`

並比較：

`DB sequence / row version / PostgreSQL xmin / etcd revision / ZooKeeper zxid / Redis INCR` 哪些值具有足夠的 monotonic / linearizable properties，可安全成為 Agent side-effect fencing generation；哪些只能做 observability metadata。

---

## Knowledge Graph 新增 Node / Edge

### Nodes

- `ActivityAttemptOverlapGeneration`
- `AttemptServerValidityGeneration`
- `FenceAuthorityIdentity`
- `FenceGeneration`
- `ResourceFenceState`
- `FenceAdmissionWitness`
- `StaleAttemptRejectionWitness`
- `FencedEffectManifest`
- `ResourceVersionWitness`
- `WriteAdmissionGeneration`

### Edges

```text
HeartbeatTimeout --invalidates_server_attempt→ AttemptServerValidityGeneration
HeartbeatTimeout --does_not_prove→ OldAttemptStopped
RetryAttempt --receives→ FenceGeneration
FenceGeneration --checked_by→ ResourceFenceState
ResourceFenceState --produces→ FenceAdmissionWitness
StaleAttempt --rejected_by→ FenceAdmissionWitness
SemanticCommitEnvelope --binds→ FencedEffectManifest
FencedEffectManifest --requires→ FenceAdmissionWitness
FenceAdmissionWitness --combined_with→ ResourceVersionWitness
ExternalCommit --produces→ SideEffectReceipt
SideEffectReceipt --authorizes_after_verification→ ObservationCommit
```

---

## 本輪結束判斷

- **缺哪一層：** multi-region Fence Authority → external resource admission 的 production contract。
- **哪個節點最淺：** `FenceAuthorityIdentity` 的跨 backend normative semantics。
- **哪個概念仍只是名詞：** portable `FencedEffectManifest`。
- **哪個系統值得讀原始碼：** Temporal `timer_queue_active_task_executor + mutable_state_impl`，接著 etcd/ZooKeeper revision generation。
- **哪篇研究需追引用：** fencing token / lease correctness 的後續 distributed-systems literature，以及 Temporal retry/timeout implementation evolution。
- **哪個概念最適合視覺模擬：** Overlapping Attempt & Resource Fence Microscope。
- **哪個 Agent 架構最值得實作：** `Durable Workflow + SemanticCommitEnvelope + Monotonic FenceAuthority + Fenced Tool Adapter + Resource CAS Gate + ReceiptVerifier + Observation Commit Gate`。

最終鏈條新增一段：

```text
User Intent
→ Agent Plan
→ SemanticCommit
→ Durable Activity Attempt
→ Heartbeat/Lease
→ Retry Generation
→ Fence Generation
→ MCP/Tool
→ Resource-side Fence + CAS
→ External Commit
→ Durable Receipt
→ Observation
→ Agent Context
→ UI Output
```

這一層回答的是：**Agent runtime 即使誤以為舊 attempt 已死，也不能只靠「相信舊 worker 不會再動」。安全性必須下沉到真正會被修改的 resource，由 resource 用 monotonic fence 主動拒絕 stale execution。**