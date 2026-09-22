# AI Agent × Multimodal Research Report

時間：2026-09-23 02:55 Asia/Taipei

## 本小時新發現

本輪承接上一輪 `Temporal Activity → EffectManifest → ReceiptVerifier`，避免重複 idempotency / Saga 定義，改回答：external transaction ID、ETag/resource version、read-after-write、database CAS 各自能提供多強的 commit evidence，以及 Temporal heartbeat/cancellation 在 long-running Agent tool execution 中究竟能證明什麼。

核心結論：Hermes 不能把 ReceiptVerifier 做成單一 boolean。它需要一個 **Receipt Evidence Lattice**，把「證明這個 effect 已發生」與「證明這個 effect 是由這一次 SemanticCommit 發生」分開。

## 本小時最重要 5 個發現

### 1. Temporal heartbeat 是 liveness/progress witness，不是 external commit receipt
直接讀 Temporal Python SDK source：Activity `Info` 暴露 `attempt`、`heartbeat_details`、`heartbeat_timeout`、activity/workflow identity 與 retry policy；`heartbeat()` 將 details 送入 worker heartbeat path。worker 會 drain pending heartbeats、只取最新 details，呼叫 core `record_activity_heartbeat`。若 heartbeat recording 失敗，worker 會取消 activity。這證明 heartbeat 是 execution progress/cancellation channel，而不是 external side-effect transaction record。

Invariant：
`HeartbeatRecorded --does_not_prove→ ExternalEffectCommitted`

以及：
`HeartbeatDetails --may_checkpoint→ ReconciliationProgress`

因此 Hermes 可把 `semanticCommitId / reconciliationPhase / lastExternalProbe` 放進 heartbeat details 作恢復提示，但 authoritative receipt仍須由 external evidence建立。

### 2. Activity user code return 與 durable completion acknowledgement之間仍存在 failure boundary
Temporal Python worker source顯示：先 `_execute_activity()`，再 encode result，最後另外呼叫 `complete_activity_task(completion)`；該 completion call本身被 try/except包住，失敗時記錄 `Failed completing activity task`。因此 user Activity code已成功、甚至 external effect已完成，仍可能在 completion被 core/service接受前失敗。

Invariant：
`ActivityFunctionReturned --does_not_prove→ ActivityCompletionDurablyRecorded`

這是上一輪 crash window 的原始碼級確認，而不是只依賴架構推論。

### 3. ETag / If-Match 是 precondition witness，不是唯一 commit-origin witness
RFC 9110規定 If-Match 對 state-changing request在執行 method前檢查 strong entity tag，可避免 lost update；條件失敗通常回 412。但 RFC 也允許：若 server判斷 state-changing request看起來已經成功，可能回 2xx。這意味 ETag 很適合證明「我只在版本 V 上更新」，但單看最終 ETag或相同最終值，未必能證明是哪個 SemanticCommit造成。

Hermes 定義：
`PreconditionWitness = expectedVersion/ETag matched before mutation`

`PostconditionWitness = observed resource state/version after mutation`

但：
`PostconditionMatch --does_not_prove→ CommitCausality`

若要提升到強 CONFIRMED，需要 server transaction/idempotency record，或 resource version lineage能唯一連結本次 effect。

### 4. Database MVCC / CAS 能阻止 stale write，但 read-after-write仍可能被第三方更新污染
PostgreSQL current docs顯示 Read Committed 每個 statement看到 statement開始時的 snapshot；UPDATE遇到 concurrent updater時會等待，之後重新評估 WHERE condition。Repeatable Read/Serializable則可能要求整個 transaction retry。這支持 Hermes 使用 `UPDATE ... WHERE id=? AND version=?` / version column / CAS 做 effect precondition。

但若 external commit後第三方又合法更新，稍後 read-back得到的 version/state已不是 Hermes寫入後的 immediate state。因此：
`CASSuccess → strong Precondition+Mutation witness`

但：
`LaterReadState ≠ necessarily ImmediatePostCommitState`

最佳 adapter應在同一 DB transaction中取得 affected-row count + new resource version + transaction/commit identity（若可用），立即形成 receipt，而不是事後只比對最終欄位值。

### 5. Receipt evidence 必須分級，且 CONFIRMED 門檻依 effect risk調整
本輪建立 Evidence Lattice：

Tier 0 `MODEL_CLAIM`：Agent/tool文字說成功；不可當 receipt。

Tier 1 `TRANSPORT_RESPONSE`：HTTP 2xx / MCP success；證明收到成功 response，但若 response lineage未綁 SemanticCommit，證據有限。

Tier 2 `POSTCONDITION_MATCH`：read-after-write狀態符合；可能由第三方或碰巧相同狀態造成。

Tier 3 `PRECONDITIONED_MUTATION`：If-Match / version-CAS 成功 + immediate returned version；較強，但仍需辨識 server是否能唯一歸因。

Tier 4 `IDEMPOTENCY_RECORD`：server以同 idempotency key + same effect fingerprint回傳原 transaction/result；強 causal evidence，但受 retention window影響。

Tier 5 `EXTERNAL_TRANSACTION_RECEIPT`：外部系統提供 immutable transaction/event ID，且可查詢並驗證 target、arguments/effect digest、commit status；最高一般應用層證據。

Hermes policy：高風險 side effect（TRANSFER/DELETE/PUBLISH/SECURITY_CHANGE）要求 Tier 4/5；Tier 2 不足以自動解除 `MAY_HAVE_COMMITTED`。

## Architecture Breakdown

`Agent Intent → SemanticCommitEnvelope → Temporal Workflow → Activity Scheduled → Attempt_n → heartbeat(progress) → EffectManifest → Precondition Read → Conditional Mutation / External API → Response Lost? → Receipt Evidence Collector → Evidence Lattice Evaluator → {CONFIRMED | NOT_COMMITTED | UNKNOWN} → Activity Completion → Workflow History → Observation Gate`

Concurrency branch：
`ExpectedVersion V7 → If-Match/CAS → {mutation V8 | 412/0 rows} → immediate receipt evidence → third-party V9 update`。

因此 receipt不能只保存 `currentState`，而應保存 `preconditionVersion + committedVersion + transaction/idempotency identity + effect digest`。

## Bottom-Level Logic

### ReceiptEvidence v1

- `evidenceId`
- `semanticCommitId`
- `effectDigest`
- `evidenceType`: TRANSPORT_RESPONSE | POSTCONDITION | PRECONDITIONED_MUTATION | IDEMPOTENCY_RECORD | EXTERNAL_TRANSACTION
- `sourceSystem`
- `sourceIdentity`
- `observedAt`
- `preconditionVersion?`
- `committedVersion?`
- `externalTransactionId?`
- `idempotencyKey?`
- `payload/resultDigest?`
- `retentionExpiresAt?`
- `cryptographicBinding?`
- `confidenceClass`: WEAK | MODERATE | STRONG | AUTHORITATIVE

### Receipt confirmation rule

`CONFIRMED = EffectDigestMatch ∧ SemanticIdentityBinding ∧ CommitStatusFinal ∧ EvidenceFreshEnough ∧ SourceTrustSatisfied`

`NOT_COMMITTED` 必須有 affirmative negative evidence，例如 idempotency lookup明確不存在且 retention/consistency條件足以保證可見，或 conditional mutation明確 0 rows且沒有 dispatch ambiguity。

缺乏證據只能是 `UNKNOWN`，不能由 absence-of-response推導 `NOT_COMMITTED`。

### Heartbeat / cancellation contract

Heartbeat可攜：
`semanticCommitId, phase, lastProbeType, lastKnownExternalTxId, lastKnownVersion, reconciliationGeneration`

但 recovery後必須重新驗證 external evidence；不得因 heartbeat detail寫著 `committed=true` 就發布 Observation。

## Visual Simulation Idea

### Receipt Evidence Lattice & Concurrency Microscope

泳道：Temporal Workflow / Activity Attempt / Heartbeat / MCP-HTTP Adapter / DB-or-API / Concurrent Actor / ReceiptVerifier / Observation Gate。

互動：
- `CRASH_AFTER_DB_COMMIT_BEFORE_ACTIVITY_COMPLETE`
- `HEARTBEAT_SAYS_COMMITTED_BUT_RECEIPT_MISSING`
- `IF_MATCH_412`
- `CAS_0_ROWS`
- `THIRD_PARTY_UPDATE_AFTER_OUR_COMMIT`
- `IDEMPOTENCY_RECORD_EXPIRED`
- `SAME_FINAL_STATE_DIFFERENT_ACTOR`

UI同時顯示：`Execution Progress`, `Precondition`, `Commit Evidence Tier`, `Causal Binding`, `Receipt Status`, `Retry Authorization`。

## Code / GitHub

本輪直接讀 `temporalio/sdk-python`：
- `temporalio/activity.py`：`Info` 包含 activity identity、attempt、heartbeat details/timeout、workflow identity與 retry policy；`heartbeat()` 進入 current Activity context。
- `temporalio/worker/_activity.py`：worker poll Activity tasks；heartbeat queue會合併成最新 detail並送 core；Activity function result encode後，最後才呼叫 `complete_activity_task`。因此 execution success與 durable completion是分離步驟。

值得下一輪繼續追：Temporal server history service中 ActivityTaskStarted/Completed/TimedOut state transition與 heartbeat timeout scheduling；PostgreSQL adapter實作 CAS receipt；MCP tool adapter如何把 EffectManifest映射到 HTTP conditional/idempotent request。

## Papers / Official technical sources

### RFC 9110 — HTTP Semantics
Authors: Roy Fielding, Mark Nottingham, Julian Reschke
Institution: IETF HTTP Working Group
Year: 2022
Architecture/Contribution: 定義 ETag、If-Match、If-None-Match、conditional request與 precondition precedence；If-Match可用於避免 lost update。
Limitation: ETag是 representation validator / precondition機制，不是跨 Agent/MCP 的 SemanticCommit receipt protocol。

### PostgreSQL Transaction Isolation / MVCC
Institution: PostgreSQL Global Development Group
Current documentation: PostgreSQL 18
Contribution: Read Committed statement snapshots、concurrent UPDATE re-evaluation、Repeatable Read/Serializable conflict/retry semantics，提供 DB-side optimistic concurrency基礎。
Limitation: DB isolation只涵蓋該 database transaction domain；不能原子涵蓋 MCP/A2A/HTTP外部系統。

### Temporal Python SDK source
Repository: temporalio/sdk-python
Files: `temporalio/activity.py`, `temporalio/worker/_activity.py`
Contribution: 原始碼確認 heartbeat、attempt identity、cancellation details、Activity execution與 completion call的實際分層。
Limitation: SDK worker source不是 Temporal server history state machine本身；server-side durable transition下一輪繼續讀。

## 已確認 / 推論邊界

已確認：Temporal Python SDK將 Activity user-code execution/result encode與 `complete_activity_task` 分成不同步驟；heartbeat有獨立 recording path；RFC 9110 If-Match可保護 state-changing method免於 lost update；PostgreSQL MVCC/transaction isolation不等同 application-level cross-system exactly-once。

工程推論：Receipt Evidence Lattice、risk-based confirmation threshold與 heartbeat reconciliation checkpoint是 Hermes architecture proposal，不是 Temporal/RFC/PostgreSQL既有標準。

尚未驗證假說：不同 vendor的 external transaction receipt能否映射成足夠一致的 `ReceiptEvidence` schema，且在 retention/replication lag下仍可靠區分 NOT_COMMITTED與UNKNOWN。

## Unknown / Open Questions

1. Idempotency record過期後，若 resource已被後續合法修改，還有哪些 immutable audit/event logs可重建 commit causality？
2. PostgreSQL transaction ID / WAL LSN / application version column，哪一種最適合暴露給 Agent receipt layer，而不洩漏不必要的 database internals？
3. Temporal heartbeat detail是否應只存 reconciliation cursor，避免把未驗證 external state誤當 durable truth？

## 下一輪研究

深入 `Temporal server ActivityTask state machine → heartbeat timeout → cancellation → retry generation → history event recording`；再研究 PostgreSQL `xmin / transaction ID / WAL LSN` 與 application version column的證據強度，並把 MCP tool adapter的 `EffectManifest → If-Match/CAS/Idempotency-Key → ReceiptEvidence` 做成可實作介面。

下一輪要回答：**durable runtime究竟在什麼事件點才知道 Activity 已完成？heartbeat timeout/cancel/retry與 external commit重疊時，如何避免兩個 attempt同時操作同一個 SemanticCommit？**

## Knowledge Graph 新增 Node / Edge

Nodes：`ReceiptEvidenceGeneration`, `ReceiptEvidenceTier`, `PreconditionWitness`, `PostconditionWitness`, `PreconditionedMutationWitness`, `ExternalTransactionReceiptWitness`, `HeartbeatProgressWitness`, `ActivityCompletionSubmissionGeneration`, `ActivityCompletionDurableRecordWitness`, `ConcurrentExternalMutationGeneration`, `CommitCausalityWitness`, `EvidenceRetentionWindow`。

Edges：
- `ActivityAttemptGeneration → emits → HeartbeatProgressWitness`
- `HeartbeatProgressWitness --does_not_prove→ ExternalTransactionReceiptWitness`
- `ActivityFunctionReturn → precedes → ActivityCompletionSubmissionGeneration`
- `ActivityCompletionSubmissionGeneration --does_not_prove→ ActivityCompletionDurableRecordWitness`
- `ExpectedResourceVersion → guards → PreconditionedMutationWitness`
- `PreconditionedMutationWitness → produces → committedVersion`
- `ConcurrentExternalMutationGeneration → may_supersede → committedVersion`
- `PostconditionWitness --does_not_prove→ CommitCausalityWitness`
- `IdempotencyRecord → strongly_supports → CommitCausalityWitness`
- `ExternalTransactionReceiptWitness → strongly_supports → CONFIRMED`
- `ReceiptEvidenceGeneration → evaluated_by → ReceiptEvidenceTier`
- `ReceiptEvidenceTier + EffectRisk → determines → ObservationPublicationAuthorizationWitness`
