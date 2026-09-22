# AI Agent × Multimodal Research Report

時間：2026-09-23 01:54 Asia/Taipei

## 本小時新發現

本輪承接 `SemanticCommitEnvelope → Canonical Effect Manifest → external commit → ReceiptVerifier`，避免重複上一輪 schema 定義，改深入 Temporal durable execution 的 Workflow/Activity failure boundary、HTTP Idempotency-Key 的 key/fingerprint contract，以及 Saga compensation。核心問題是：Agent 的外部 side effect 已成功，但 worker 在把成功結果寫回 durable runtime 前 crash 時，如何避免 retry 再做一次。

## 本小時最重要 5 個發現

### 1. Durable Workflow replay 與 Activity side effect 是兩個不同 correctness domain
Temporal Workflow 依 event history replay；已完成 Activity 的結果可由 history重放，而不重新執行 Activity。但 Activity 本身預設具 retry / at-least-once execution semantics，因此 external side effect 仍可能重複。

最危險 crash window：
`ActivityAttempt → ExternalCommit ✓ → WorkerCrash → ActivityCompletionRecord ✗ → Retry → ExternalCommit again`。

Invariant：`WorkflowReplayDeterministic --does_not_prove→ ActivityExternalEffectExactlyOnce`。

Hermes 因此不能把 durable workflow engine 當成 external-world transaction manager。

### 2. Temporal Activity retry identity 必須綁 semantic commit，而不能綁 attempt
同一 logical Activity 的不同 attempt 是 execution generations；idempotency key若跟 attempt number變動，會失去去重效果。

Hermes 定義：
`ActivityAttemptIdentity ≠ SemanticCommitIdentity`。

`ExternalIdempotencyKey = derive(SemanticCommitID, EffectManifestVersion, TargetResourceIdentity)`。

所有 retry attempt 必須重用相同 external idempotency key；若 canonical effect 改變，必須建立新的 SemanticCommit generation，而不是偷偷沿用舊 key。

### 3. HTTP Idempotency-Key 必須與 payload/effect fingerprint 一起驗證
IETF HTTPAPI 的 Idempotency-Key draft 明確要求 key 不得重用於不同 payload，並允許 resource 建立 idempotency fingerprint。這與 Hermes `CanonicalEffectDigest` 直接對應。

Hermes 將 request contract升級為：
`IdempotencyBindingWitness = SameKey ∧ SameCanonicalEffectDigest ∧ SameTargetResource ∧ WithinRetentionWindow`。

若：`SameKey ∧ DifferentEffectDigest`，狀態必須是 `IDEMPOTENCY_KEY_SEMANTIC_COLLISION`，不可接受 server 回傳 cached success 後繼續。

注意：截至本輪，IETF draft -07 已於 2026-04-18 過期，仍屬 work in progress，不應描述成正式 RFC。

### 4. ReceiptVerifier 應先 reconcile，再決定 retry
對 timeout / connection reset，`no response` 不能推論 `no commit`。Hermes 的 Activity adapter應在 retry前進入：

`DISPATCHED → RESPONSE_LOST_OR_TIMEOUT → MAY_HAVE_COMMITTED → RECONCILE`

Reconcile adapter依 external system能力分級：
1. `IDEMPOTENCY_LOOKUP`：用 idempotency key查原 request結果；
2. `TRANSACTION_LOOKUP`：查 external transaction ID；
3. `RESOURCE_VERSION_READ`：read-after-write + version/ETag；
4. `DOMAIN_STATE_PROBE`：以 effect manifest驗證目標狀態；
5. `MANUAL_REVIEW`：無可靠查詢介面時禁止 blind retry。

只有 `NOT_COMMITTED` witness才允許重新 dispatch；`CONFIRMED`直接生成 receipt並完成 Activity；`UNKNOWN`繼續 reconciliation / manual review。

### 5. Saga compensation 不是 rollback，也不是 exactly-once substitute
Saga 將 long-lived transaction拆成一連串 local transactions；部分步驟失敗時執行 compensating transactions。補償本身也是新的 side effect，也會 retry、失敗或只部分成功，因此它同樣需要 SemanticCommitIdentity / idempotency / receipt。

Hermes 定義：
`CompensationCommitID = hash(originalSemanticCommitId, compensationType, compensationGeneration)`。

以及：
`OriginalEffectConfirmed → CompensationAuthorized → CompensationDispatched → CompensationReceiptConfirmed`。

Invariant：`CompensationRequested --does_not_prove→ OriginalEffectReversed`。

## Architecture Breakdown

`User/Agent Intent → SemanticCommitEnvelope → Durable Workflow Decision → Activity Scheduled → Activity Attempt_n → EffectManifest Compiler → External Idempotency Binding → HTTP/DB/MCP Dispatch → External Commit → Response/Timeout → ReceiptVerifier → {CONFIRMED | NOT_COMMITTED | UNKNOWN} → Activity Completion / Retry / Reconciliation → Workflow History → Observation Publication`

補償支線：
`Confirmed Effect → Saga Policy → Compensation SemanticCommit → Compensation Activity → External Compensation → Compensation Receipt → Final Reconciled State`。

Temporal 的角色：保存 orchestration decision/history、Activity schedule/result、retry state；external system 的 transaction/idempotency domain仍須由 adapter證明。

## Bottom-Level Logic

### Canonical Effect Manifest v0

建議欄位：
- `effectManifestVersion`
- `semanticCommitId`
- `operationClass`: CREATE | UPDATE | DELETE | SEND | TRANSFER | EXECUTE
- `targetSystem`
- `targetResourceType`
- `targetResourceIdentity`
- `canonicalArgumentsDigest`
- `expectedPrecondition`: resourceVersion / ETag / state predicate
- `intendedPostcondition`: state predicate / result shape
- `externalIdempotencyKey`
- `reconciliationStrategy`
- `compensationPolicyRef`
- `authorityGeneration`
- `createdAt`

`CanonicalEffectDigest = hash(canonical_json(effect_manifest_without_runtime_evidence))`。

### Activity execution state machine

`SCHEDULED → ATTEMPTING → DISPATCHED → {RESPONSE_RECEIVED | RESPONSE_LOST}`

`RESPONSE_RECEIVED(success) → VERIFY_RECEIPT → CONFIRMED → COMPLETE_ACTIVITY`

`RESPONSE_LOST → MAY_HAVE_COMMITTED → RECONCILE`

`RECONCILE → CONFIRMED → COMPLETE_ACTIVITY`

`RECONCILE → NOT_COMMITTED → RETRY_SAME_SEMANTIC_COMMIT`

`RECONCILE → UNKNOWN → WAIT / MANUAL_REVIEW`

禁止：`MAY_HAVE_COMMITTED → blind retry`。

### Receipt verifier interface

Input：`SemanticCommitEnvelope + EffectManifest + transport evidence + prior receipts`。

Output：
- status: CONFIRMED | NOT_COMMITTED | UNKNOWN | COMPENSATED
- externalTransactionId?
- resourceVersion?
- observedPostconditionDigest?
- verifierType
- verifierEvidenceDigest
- verifiedAt

只有 CONFIRMED / COMPENSATED 才能形成 downstream authoritative observation。

## Visual Simulation Idea

### Durable Activity × External Effect Crash-Window Microscope

泳道：Agent Planner / Durable Workflow / Activity Queue / Worker Attempt / MCP-HTTP Adapter / External System / Receipt Store / Reconciler / Observation Gate。

互動 failure injection：
- `CRASH_BEFORE_EXTERNAL_COMMIT`
- `CRASH_AFTER_EXTERNAL_COMMIT_BEFORE_ACTIVITY_COMPLETE`
- `HTTP_TIMEOUT_AFTER_SERVER_COMMIT`
- `SAME_KEY_DIFFERENT_EFFECT_DIGEST`
- `IDEMPOTENCY_RECORD_EXPIRED`
- `RESOURCE_VERSION_ADVANCED_BY_THIRD_PARTY`
- `COMPENSATION_TIMES_OUT_AFTER_COMMIT`

UI：`WorkflowHistory ✓ | Attempt #3 | External Commit ? | Idempotency Binding ✓ | Receipt UNKNOWN | Retry BLOCKED | Reconciliation RUNNING`。

## Code / GitHub

值得深入追的 Temporal runtime/source區域：
- Python SDK workflow activity scheduling / retry surface；
- Activity execution context（attempt / activity identity / heartbeat）；
- worker Activity completion path；
- workflow history replay與 activity result application；
- Temporal server history service中 ActivityTaskScheduled / Started / Completed / TimedOut / Failed transition。

本輪 GitHub code search 未取得足夠精準的 SDK code excerpt，因此不把未讀到的實作細節冒充已確認原始碼；下一輪應直接按 repository directory/path讀 SDK/server source。

## Papers / Official technical sources

### Sagas
Title: Sagas
Authors: Hector Garcia-Molina, Kenneth Salem
Institution: Princeton University
Year: 1987
Architecture: long-lived transaction拆成可交錯的 subtransactions，失敗時執行 compensating transactions。
Contribution: 建立 Saga / compensation 的經典模型。
Limitation: 不直接提供現代 HTTP/MCP/Agent invocation identity、idempotency receipt或 provenance contract。

### Enhancing Saga Pattern for Distributed Transactions within a Microservices Architecture
Authors: Eman Daraghmi, Cheng Pu Zhang, Shyan Ming Yuan
Institution: National Yang Ming Chiao Tung University
Year: 2022
Contribution: 針對 Saga isolation weakness提出 quota cache / commit-sync service。
Limitation: 聚焦 microservice transaction consistency，不是 Agent semantic authority / tool receipt。

### IETF HTTPAPI Idempotency-Key draft -07
Authors: Jayadeba Jena, Sanjay Dalal
Latest revision: 2025-10-15; expired 2026-04-18
Contribution: 定義 HTTP `Idempotency-Key`、uniqueness、expiry、fingerprint與resource/client responsibilities。
Limitation: Internet-Draft，非正式 RFC；也不能單獨證明跨 MCP/A2A 的 semantic identity。

### Temporal durable execution / AI patterns
官方工程資料確認 Activities有 at-least-once execution semantics；write-side tools應用 stable idempotency key，parallel tool calls各自作為 durable Activities。Workflow replay與 Activity retry需明確分層。

## 已確認 / 推論邊界

已確認：Temporal Activity retry可能在 external operation成功、completion尚未被 durable history記錄時重新執行；HTTP idempotency draft要求 key不可對不同 payload重用；Saga compensation是新的 transaction，而非時間倒轉。

工程推論：Hermes 應把 stable SemanticCommitID 映射到 Temporal Activity attempts，並以 CanonicalEffectDigest做 idempotency fingerprint；這是本研究提出的 architecture，不是 Temporal/IETF既有標準。

尚未驗證假說：能否設計跨 HTTP/database/MCP vendor一致的 `ReceiptVerifier` interface且保留足夠 evidence，在不修改外部服務的情況下達到高可信 reconciliation。

## Unknown / Open Questions

1. 外部 API idempotency record 的 retention window過期後，Hermes要如何安全區分「很久以前已 commit」與「從未 commit」？
2. resource read-after-write若同時有第三方合法修改，如何證明 observed state仍源自該 SemanticCommit，而非碰巧相同的最終值？
3. Compensation與原始 effect存在部分不可逆資訊流（email已寄出、資料已外洩）時，如何在 Knowledge Graph表示「business compensated but physical/information effect irreversible」？

## 下一輪研究

深入 `Temporal SDK/server source → ActivityTask state transitions → timeout/heartbeat/cancellation → completion recording → retry generation`，並比較 database optimistic concurrency（version/ETag/CAS）、HTTP conditional requests、MCP tool adapter如何生成 `EffectManifest + ReceiptVerifier`。

下一輪要回答：`External transaction ID / resource version / ETag / idempotency record` 哪些證據足以構成 Hermes 的 `CONFIRMED` receipt，哪些只能構成 probabilistic evidence。

## Knowledge Graph 新增 Node / Edge

Nodes：`DurableWorkflowGeneration`, `ActivityExecutionIdentity`, `ActivityAttemptGeneration`, `EffectManifestGeneration`, `ExternalIdempotencyBindingWitness`, `IdempotencyRetentionWindow`, `ReconciliationGeneration`, `ReconciliationEvidenceSet`, `NotCommittedWitness`, `UnknownCommitWitness`, `CompensationSemanticCommit`, `CompensationReceiptGeneration`, `IrreversibleResidualEffect`。

Edges：
- `SemanticCommitEnvelope → scheduled_as → ActivityExecutionIdentity`
- `ActivityExecutionIdentity → retried_as → ActivityAttemptGeneration`
- `ActivityAttemptGeneration --must_reuse→ ExternalIdempotencyBindingWitness`
- `EffectManifestGeneration → hashed_as → CanonicalEffectDigest`
- `HTTPIdempotencyKey ↔ bound_to ↔ CanonicalEffectDigest`
- `ResponseLost → enters → UnknownCommitWitness`
- `UnknownCommitWitness → requires → ReconciliationGeneration`
- `NotCommittedWitness → authorizes → RetrySameSemanticCommit`
- `ConfirmedReceipt → authorizes → ObservationPublication`
- `ConfirmedReceipt → may_trigger → CompensationSemanticCommit`
- `CompensationSemanticCommit → produces → CompensationReceiptGeneration`
- `CompensationReceiptGeneration --does_not_erase→ IrreversibleResidualEffect`

## 本輪結論

缺的層：跨 external API/database 的 receipt evidence strength model，以及 retention expiry後的 reconciliation。

最淺節點：`ReconciliationEvidenceSet → CONFIRMED` 的證據門檻。

仍只是名詞：跨 vendor portable `EffectManifest + ReceiptVerifier` contract。

最值得讀原始碼：Temporal SDK/server ActivityTask lifecycle與 retry/completion recording path。

最值得追引用：Sagas，以及現代 Saga isolation/compensation研究；HTTP Idempotency-Key draft後續是否復活或進入 RFC流程。

最適合視覺模擬：Durable Activity × External Effect Crash-Window Microscope。

最值得實作的 Agent 架構：`State-grounded Planner + Durable Workflow + SemanticCommitEnvelope + Stable Activity Idempotency Binding + EffectManifest Compiler + ReceiptVerifier/Reconciler + Compensation State Machine + Observation Commit Gate`。

本輪最大的推進：Hermes 現在開始把「durable execution」與「external exactly-once」徹底拆開。Workflow能可靠重播決策，不代表真實世界動作只做一次；真正安全的 Agent side effect需要 stable semantic identity、effect fingerprint、外部 idempotency、receipt verification，以及 timeout後先 reconcile 再 retry。