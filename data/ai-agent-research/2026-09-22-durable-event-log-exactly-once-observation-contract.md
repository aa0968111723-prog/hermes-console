# AI Agent × Multimodal Research Report

時間：2026-09-22 23:50 Asia/Taipei

## 本小時新發現

本輪承接上一輪 A2A Event Stream × Durable Task Replay，但不再停在 A2A SDK 的 EventQueue/TaskStore 邊界，而是把問題下沉到 durable messaging semantics：Redis Streams 的 consumer-group/Pending Entries List、Kafka transaction + consumer offset、OpenTelemetry messaging creation context，以及 A2A v1.1 roadmap 正在推進的 task timeline/event filtering。

核心問題：如何從「事件曾經被送到某個 consumer」提升到「事件、state reduction、external side effect、observation publication 可以被同一個 semantic transaction 證明」。

## 本小時最重要 5 個發現

### 1. Delivery / ACK / side-effect commit 是三個不同 witness
Redis Streams consumer group 將 delivery 後尚未 ACK 的 entry 放入 Pending Entries List；XACK 只代表 consumer 宣告處理完成。crash/reclaim 可造成重新 delivery，因此 side-effect consumer 必須 idempotent。

新增：
- EventDeliveryWitness
- ConsumerProcessingWitness
- DeliveryAckWitness
- ExternalSideEffectReceipt

Invariant：`DeliveryAckWitness --does_not_prove→ ExternalSideEffectCommittedExactlyOnce`。

### 2. Durable cursor 只有在與 state/output commit 綁定時才有 exactly-once 意義
Kafka 的 transaction model 可以把 producer outputs 與 consumer offsets 放入同一 transaction；這比單純「先做 side effect、再 commit offset」更強，因為後者在 crash window 仍可能重做。

新增：`AtomicConsumeTransformCommitWitness`。

核心模型：`Consume(Event_n) → Reduce(State_n) → Produce(Event_n+1) + CommitOffset_n` 必須原子化，才能在同一 durable log domain 內逼近 exactly-once processing。

### 3. External side effects 仍超出 broker exactly-once 邊界
即使 Kafka transaction 能原子化 output records + offsets，也不能自動把第三方 HTTP/payment/database（若不參與同一 transaction）納入 exactly-once。因此 Agent runtime 仍需要 semantic idempotency key、durable receipt/outbox/inbox 或 reconciliation。

Invariant：`BrokerExactlyOnce --does_not_prove→ ExternalWorldExactlyOnce`。

### 4. Trace identity 不是 transaction identity
OpenTelemetry messaging conventions要求 producer 將 message creation context 傳給 consumer，並以 span links 關聯 producer/consumer。這非常適合 reconstruct causal graph，但 trace/span/message/conversation IDs 仍然是 observability/correlation identity，不是 authorization、idempotency 或 commit receipt。

新增：`MessageCreationContextIdentity`, `TraceCausalLinkWitness`。

Invariant：`TraceCausalLinkWitness --does_not_prove→ SemanticCommitIdentityMatch`。

### 5. A2A v1.1 正在補 task timeline/event filtering，但 durable replay contract 仍需 runtime 自己落實
A2A roadmap（2026-09-15 更新）將 v1.1 task timeline、event filtering、BiDi streaming列為 near-term initiatives。這能改善 task/event history 表達，但目前不能假定 protocol 已提供 broker-grade durable cursor + exactly-once side-effect semantics。

## Architecture Breakdown

建議 Hermes 的 production event architecture：

`A2A Request → ReceiverExecutionGeneration → DurableEventAppend → ConsumerClaim → IdempotencyInboxCheck → StateReducer → Tool/MCP Invocation → External Idempotency Key → External Commit → Durable Receipt → Observation/Artifact Event → State Commit → Consumer Offset/ACK → Sender ObservationCommit`

若 external system 不支援 idempotency key：

`PREPARED → MAY_HAVE_COMMITTED → RECONCILING → CONFIRMED / COMPENSATED / MANUAL_REVIEW`

而不能 timeout 後直接 retry。

## Bottom-Level Logic

Redis-style at-least-once：
`XADD → XREADGROUP → PEL → process → XACK`

failure：
`process(side effect) → crash before XACK → XAUTOCLAIM → process again`

Kafka-style transactional stream processing：
`poll → transform → produce outputs → sendOffsetsToTransaction → commitTransaction`

但若 transform 中包含 external HTTP side effect，broker transaction本身無法 rollback該 HTTP commit。

因此 Hermes 需要跨 domain semantic transaction：

`SemanticCommitIdentity = DelegationID + TaskID + ReceiverExecutionGeneration + EventIdentity + ToolInvocationIdentity + ExternalIdempotencyKey + ReceiptGeneration`

## Visual Simulation Idea

### Durable Event Log × Side-Effect Exactly-Once Microscope

泳道：A2A Sender / Durable Log / Consumer / State Reducer / MCP Tool / External System / Receipt Store / Observation Publisher。

可注入：
- CRASH_AFTER_SIDE_EFFECT_BEFORE_ACK
- DUPLICATE_DELIVERY
- OFFSET_COMMITTED_BEFORE_STATE
- STATE_COMMITTED_BEFORE_OFFSET
- EXTERNAL_TIMEOUT_AFTER_COMMIT
- TRACE_ID_MATCH_BUT_IDEMPOTENCY_KEY_MISMATCH
- EVENT_GAP_AFTER_RESUBSCRIBE

UI 狀態：`Event Durable ✓ | Delivered ×2 | State Reduced ✓ | External Commit ? | Receipt ✓ | Offset ✓ | Observation ✓ | Retry Safe ✗/✓`。

## Code / GitHub

Hermes historical report compared: `data/ai-agent-research/2026-09-22-a2a-event-stream-durable-task-replay-contract.md`。上一輪已提出 A2AEventGeneration → ResultAggregator → TaskStore → distributed Queue/Event Bus → resubscribe cursor；本輪新增 broker-level ACK/offset/transaction 與 external-world receipt boundary，避免重複停在 SDK queue abstraction。

下一輪值得讀：A2A Python ResultAggregator/TaskStore/QueueManager；A2A JS ExecutionEventBusManager；並設計 Redis Streams/Kafka adapter contract。

## Papers / Official technical sources

- Apache Kafka Design — Transactions / exactly-once processing。貢獻：output records 與 consumer position 可在 producer transaction 中原子提交。限制：第三方 external side effect 不會自動加入 transaction。
- Redis Streams documentation — consumer groups, PEL, XACK, XAUTOCLAIM。貢獻：清楚呈現 at-least-once delivery 與 reclaim failure window。限制：Redis Streams 本身不提供 external side-effect exactly-once。
- OpenTelemetry Messaging Semantic Conventions — message creation context / producer-consumer span links。貢獻：跨 broker/intermediary reconstruct causal graph。限制：observability identity 不是 semantic transaction identity。
- A2A Protocol Roadmap, updated 2026-09-15 — v1.1 task timeline/event filtering/BiDi streaming。限制：roadmap 不等同已發布 normative durable replay semantics。

## Unknown / Open Questions

1. A2A v1.1 最終是否定義可攜式 event sequence/replay cursor，還是留給 SDK/broker implementation？
2. 如何把 external receipt hash/transaction ID 正式綁進 A2A Artifact/Task timeline，而不讓 Agent-generated text 冒充 receipt？
3. Hermes 應以 Redis Streams（簡單、低延遲）還是 Kafka-style transactional log（較強 stream transaction）作為 production durable event substrate？

## 下一輪研究

`DurableEventIdentity → ConsumerInbox → StateReducer → MCP Invocation → External Idempotency/Receipt → Outbox → ObservationEvent → A2A Artifact → Sender ObservationCommit → OpenTelemetry causal trace`

並開始設計 Hermes 的 `EventEnvelope`, `InboxRecord`, `OutboxRecord`, `SideEffectReceipt`, `ReplayCursor` schema。

## Knowledge Graph 新增 Node / Edge

Nodes：DurableEventIdentity、ConsumerDeliveryGeneration、PendingDeliveryIdentity、DeliveryAckWitness、ConsumerOffsetGeneration、AtomicConsumeTransformCommitWitness、IdempotencyInboxRecord、TransactionalOutboxRecord、ExternalCommitAmbiguityState、ExternalSideEffectReceiptGeneration、MessageCreationContextIdentity、TraceCausalLinkWitness、SemanticCommitIdentity、ReplayCursorGeneration。

Edges：
- DurableEventIdentity → delivered_as → ConsumerDeliveryGeneration
- ConsumerDeliveryGeneration → pending_until → DeliveryAckWitness
- DurableEventIdentity → reduced_into → TaskStateGeneration
- ToolInvocationIdentity → bound_by → ExternalIdempotencyKey
- ExternalIdempotencyKey → confirmed_by → ExternalSideEffectReceiptGeneration
- ExternalSideEffectReceiptGeneration → authorizes_publication_of → ObservationEventGeneration
- MessageCreationContextIdentity → correlates → ConsumerProcessSpan
- TraceCausalLinkWitness --does_not_prove→ SemanticCommitIdentityMatch
- BrokerExactlyOnce --does_not_prove→ ExternalWorldExactlyOnce

## 本輪結論

缺的層：durable event/state transaction 與 external-world receipt 的跨 domain atomicity。

最淺節點：ExternalSideEffectReceiptGeneration → ObservationEventGeneration 的強制 binding。

仍只是名詞：跨 broker/tool/vendor portable SemanticCommitIdentity。

最值得讀原始碼：A2A Python ResultAggregator/TaskStore/QueueManager + JS ExecutionEventBusManager。

最值得追：A2A v1.1 task timeline/event filtering normative semantics，以及 stream processing / transactional outbox/inbox 的 formal treatment。

最適合視覺模擬：Durable Event Log × Side-Effect Exactly-Once Microscope。

最值得實作的 Agent 架構：`State-grounded Planner + Durable Event Log + Idempotency Inbox + Deterministic State Reducer + MCP Invocation Binder + External Receipt Resolver + Transactional Outbox + Replay/Gap Detector + Observation Commit Gate`。
