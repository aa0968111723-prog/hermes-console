# AI Agent × Multimodal Research Report

時間：2026-09-23 00:52 Asia/Taipei

## 本小時新發現

本輪承接上一輪 Durable Event Log × Exactly-Once Observation，但不再停在概念節點，開始把 Hermes 所需的跨 A2A / broker / MCP / external-world provenance 具體化成可實作資料契約：`EventEnvelope`, `InboxRecord`, `OutboxRecord`, `SideEffectReceipt`, `ReplayCursor`, `SemanticCommitEnvelope`。

核心問題：broker 的 exactly-once、OpenTelemetry 的 causal trace、MCP 的 request correlation 都不能單獨證明「這個真實世界 side effect 就是這一次 Agent semantic invocation 所造成，而且 observation 只發布一次」。

## 本小時最重要 5 個發現

### 1. Semantic commit 必須有獨立 identity，不可借用 trace/message/request ID
OpenTelemetry messaging conventions把 create/send/receive/process/settle 分開，並要求 message creation context 穿越 producer→consumer；這非常適合 reconstruct causal graph，但 creation context / trace/span 仍是 observability identity。

Hermes 定義：
`SemanticCommitID = hash(delegationId, taskId, executionGeneration, eventId, toolInvocationId, canonicalEffectDigest)`。

Invariant：`TraceCorrelation == true --does_not_prove→ SemanticCommitMatch`。

### 2. Inbox 的目的不是「記得收過訊息」，而是鎖住 deterministic reduction generation
建議 `InboxRecord`：
- semanticCommitId
- eventId
- consumerId
- deliveryGeneration
- payloadDigest
- reducerVersion
- stateBeforeGeneration
- stateAfterGeneration
- status: RECEIVED | REDUCING | REDUCED | FAILED
- firstSeenAt / lastSeenAt

同一 semanticCommitId 若 payloadDigest 不同，必須進入 `IDENTITY_COLLISION_OR_MUTATION`，不可當正常 duplicate。

### 3. Outbox 必須與 local state commit 原子化，而不是「state 寫完再 publish」
Kafka/stream transactions可在 broker domain 內把 consumed offsets與produced records原子提交；但 external service不在該 transaction 內。Hermes 因此需要 local DB transaction：`StateMutation + OutboxRecord` 一起 commit，relay 可重送，consumer靠 eventId/semanticCommitId dedupe。

`OutboxRecord`：outboxId, semanticCommitId, aggregateId, eventType, payloadDigest, payloadRef, causalParentIds, traceContext, status, attemptCount, publishedAt。

### 4. External receipt 必須是 evidence object，而不是 Agent-generated text
`SideEffectReceipt`：
- receiptId
- semanticCommitId
- toolInvocationId
- externalSystem
- idempotencyKey
- canonicalEffectDigest
- externalTransactionId / resourceVersion
- committedAt
- verifierType
- verifierEvidenceDigest
- status: CONFIRMED | REJECTED | MAY_HAVE_COMMITTED | COMPENSATED

只有 `CONFIRMED` receipt 可以 authorise irreversible observation publication。若 timeout 且無 receipt，進入 reconciliation，不直接 retry。

### 5. Replay cursor 與 semantic state generation 必須雙向驗證
`ReplayCursor` 不只保存 broker offset；還應保存 stream identity、partition、offset/sequence、lastEventId、lastSemanticCommitId、stateGeneration、updatedAt。

恢復時要求：`cursor.lastSemanticCommitId == reducerState.lastAppliedSemanticCommitId`。若 broker cursor前進但state generation落後，或state超前但cursor未commit，runtime必須標示 `REPLAY_DIVERGENCE`，而非靜默繼續。

## Architecture Breakdown

`A2A Event → EventEnvelope → Durable Log → Inbox Dedupe → Deterministic Reducer → Local State + Outbox Atomic Commit → Tool/MCP Intent → SemanticCommitEnvelope → External Idempotency Key → External Commit → SideEffectReceipt → Receipt Verification → Observation Outbox → Durable Publish → A2A Artifact/Task Update → Sender Observation Commit`

OpenTelemetry平行附著於每一層，但不作 correctness authority：
`trace/span/message creation context → causal observability sidecar`。

## Bottom-Level Logic

### EventEnvelope
`eventId, semanticCommitId?, producer, taskId, executionGeneration, sequence, type, payloadDigest, payloadRef, causalParents[], traceContext, createdAt`

### SemanticCommitEnvelope
`semanticCommitId, delegationId, taskId, executionGeneration, sourceEventId, toolInvocationId, principalRef, authorityGeneration, canonicalArgumentsDigest, canonicalEffectDigest, idempotencyKey, policyDecisionGeneration, createdAt`

### Commit state machine
`PROPOSED → AUTHORIZED → DISPATCHED → MAY_HAVE_COMMITTED → CONFIRMED → OBSERVATION_PUBLISHED`

Alternative terminal states：`REJECTED / COMPENSATED / MANUAL_REVIEW`。

Rule：`MAY_HAVE_COMMITTED` 永遠不可自動變回 `PROPOSED` 並重新執行；必須先 reconcile receipt/external state。

## Visual Simulation Idea

### Semantic Commit Envelope & Crash-Window Simulator

泳道：A2A / Durable Log / Inbox / Reducer / Outbox / MCP / External System / Receipt Verifier / Observation Publisher / OpenTelemetry。

互動注入：
- DUPLICATE_EVENT_SAME_DIGEST
- DUPLICATE_ID_DIFFERENT_DIGEST
- CRASH_AFTER_STATE_BEFORE_OUTBOX（應由 atomic transaction 消除）
- CRASH_AFTER_EXTERNAL_COMMIT_BEFORE_RECEIPT_PERSIST
- OUTBOX_RELAY_DUPLICATE
- CURSOR_STATE_GENERATION_DIVERGENCE
- TRACE_CONTEXT_LOST_BUT_SEMANTIC_COMMIT_INTACT
- TRACE_MATCH_BUT_SEMANTIC_COMMIT_MISMATCH

UI：`Event ✓ | Inbox ✓ | StateGen 42 | Outbox ✓ | Tool ✓ | External ? | Receipt ✗ | Observation BLOCKED | Trace ✓`。

## Code / GitHub

本輪與歷史 `2026-09-22-durable-event-log-exactly-once-observation-contract.md` 比較：上一輪建立 DurableEventIdentity / Inbox / Outbox / Receipt / SemanticCommitIdentity 概念；本輪第一次給出欄位級 schema、state machine 與 divergence rules，避免重複。

Hermes 下一步可在 `src` 建立純型別/validator prototype，先不綁 Redis/Kafka，讓 broker adapter 都實作同一 correctness contract。

## Papers / Official technical sources

- OpenTelemetry Messaging Semantic Conventions：producer/consumer messaging creation context、create/send/receive/process/settle、span links。限制：observability correlation不是transaction/idempotency authority。
- Kafka/Confluent exactly-once technical guidance：Kafka transaction能原子化 Kafka-domain offsets/outputs，但 external REST/database side effects不自動納入 transaction，外部效果仍需 idempotence。
- Transactional Outbox pattern：將 local state mutation 與待發布事件寫入同一 local transaction，再由 relay at-least-once發布；consumer仍需 dedupe。

## Unknown / Open Questions

1. `canonicalEffectDigest` 應由 tool schema + canonical args推導，還是由 tool server回傳 effect manifest後再封存？
2. 對不提供 transaction ID / idempotency key 的 legacy API，Hermes 如何建立可信 receipt verifier：read-after-write、resource version、domain reconciliation，還是人工確認？
3. SemanticCommitEnvelope 應如何映射 A2A v1.1 task timeline與 MCP request metadata，而不要求修改兩個協定本身？

## 下一輪研究

`SemanticCommitEnvelope → canonical effect manifest → MCP tool server → external API/database → receipt verifier → compensation/reconciliation`。

下一輪優先比較：HTTP idempotency-key contracts、database optimistic concurrency/resource version、Saga compensation、Temporal-style durable execution，並判斷哪些能成為 Hermes `ReceiptVerifier` adapter。

## Knowledge Graph 新增 Node / Edge

Nodes：SemanticCommitEnvelope、CanonicalEffectDigest、InboxPayloadDigestWitness、ReducerGenerationBinding、OutboxAtomicCommitWitness、SideEffectReceiptEvidenceDigest、ReceiptVerifierGeneration、ReplayStateGenerationBinding、ReplayDivergenceWitness、ObservationPublicationAuthorizationWitness。

Edges：
- DurableEventIdentity → wrapped_by → EventEnvelope
- EventEnvelope → deduplicated_by → InboxRecord
- InboxRecord → advances → ReducerGenerationBinding
- StateMutation → atomically_commits_with → OutboxRecord
- ToolInvocationIdentity → wrapped_by → SemanticCommitEnvelope
- SemanticCommitEnvelope → binds → CanonicalEffectDigest
- ExternalSideEffectReceiptGeneration → verified_by → ReceiptVerifierGeneration
- ReceiptVerifierGeneration → authorizes → ObservationPublicationAuthorizationWitness
- ReplayCursorGeneration ↔ must_match ↔ ReducerGenerationBinding
- TraceCausalLinkWitness --does_not_prove→ SemanticCommitEnvelopeMatch

## 本輪結論

缺的層：external effect 的 canonical manifest 與 receipt verifier 如何跨 HTTP/database/tool vendor 標準化。

最淺節點：ReceiptVerifierGeneration。

仍只是名詞：portable CanonicalEffectDigest / effect manifest contract。

最值得讀原始碼：Temporal durable execution/activity retry與各 SDK 的 idempotency/retry boundary；MCP server tool dispatch；A2A task/event adapters。

最值得追：transactional outbox/inbox + Saga/compensation + HTTP idempotency semantics。

最適合視覺模擬：Semantic Commit Envelope & Crash-Window Simulator。

最值得實作的 Agent 架構：`State-grounded Planner + SemanticCommitEnvelope + Idempotency Inbox + Deterministic Reducer + Atomic Outbox + MCP Invocation Binder + ReceiptVerifier + Reconciliation State Machine + Observation Commit Gate + OTel Causal Sidecar`。