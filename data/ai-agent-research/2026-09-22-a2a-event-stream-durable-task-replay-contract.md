# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-22 22:51 Asia/Taipei

## 本小時新發現

本輪承接上一輪 `A2A DelegationIdentity → ReceiverTaskGeneration → MCP Invocation → SideEffectReceipt`，但不重複 delegation/auth 本身；改追 A2A receiver runtime 的「Task / Event / Artifact 到底如何被發布、持久化、斷線重連與重播」，因為若中間事件遺失，Sender 即使拿到最終 Artifact，也無法證明它與某一次 Receiver execution / side effect 是同一條因果鏈。

核心新鏈：

`A2A Message → RequestContext → TaskIdentity → AgentExecutor → EventQueue → TaskStatus/Artifact Event → ResultAggregator → TaskStore → Stream/Push → Client Observation → Resubscribe/Recovery`

官方 A2A Python SDK current architecture 顯示 `DefaultRequestHandler` 同時協調 `AgentExecutor`、`TaskStore`、`QueueManager` 與 optional push sender；message execution 建立/接續 Task、建立 RequestContext、取得 `create_or_tap(task_id)` queue、啟動 producer task，並由 `ResultAggregator` 消費 events。Streaming client 斷線時，handler 會在 background 繼續 consume/persist events，而不是直接停止 agent execution。這是 production runtime 的重要 causal boundary。

來源：
- A2A Python SDK server source: https://github.com/a2aproject/a2a-python/blob/main/src/a2a/server/request_handlers/default_request_handler.py
- A2A EventQueue docs: https://a2a-protocol.org/latest/sdk/python/api/a2a.server.events.event_queue.html
- A2A TaskUpdater docs: https://a2a-protocol.org/latest/sdk/python/api/a2a.server.tasks.task_updater.html
- A2A roadmap (2026-09-15): https://a2a-protocol.org/latest/roadmap/

## 本小時最重要 5 個發現

### 1. Task persistence 與 Event delivery 是兩個不同 durability domain

**已確認事實 / 工程實作：** A2A runtime 將 `TaskStore` 與 `QueueManager/EventQueue` 分離。TaskStore 管理 durable/logical task state；EventQueue 是 executor → response/stream consumer 的 event transport。Default handler 會讓 ResultAggregator 消費 event 並更新 Task state。

因此：

`TaskStatePersisted --does_not_prove→ EveryIntermediateEventDurablyReplayable`

反過來也成立：

`EventDeliveredToClient --does_not_prove→ EventDurablyCommittedToTaskStore`

Hermes 必須新增兩個 witness：

- `A2ATaskStateCommitWitness`
- `A2AEventDeliveryWitness`

並禁止把 SSE delivery 當作 durable commit receipt。

### 2. Client disconnect 不等於 Agent execution 被取消

**已確認事實：** current Python SDK 的 streaming handler捕捉 `CancelledError/GeneratorExit` 後，會建立 background task 繼續 `result_aggregator.consume_all(consumer)`，讓 agent producer 繼續執行並持久化後續狀態。

所以：

`ClientStreamDisconnected --does_not_prove→ ReceiverExecutionCanceled`

這是 side-effect safety 的關鍵。Sender 若斷線後直接重送同一 semantic delegation，可能形成：

`Execution A still running + Retry Execution B`

若 receiver tool side effect 沒有 invocation/idempotency binding，就可能 double commit。

### 3. Resubscribe 需要的是 replay provenance，不只是重新打開 SSE

**已確認事實 + 工程缺口：** A2A 的 queue abstraction支援 tap/consumer；歷史 SDK/issue也揭露 in-memory queue 在 process restart 後可能無法重建 intermediate event history。A2A 2026-09-15 roadmap 正在推進 v1.1 task timeline 與 event filtering semantics，說明 event history/recovery 仍是活躍的 protocol/runtime問題。

因此 Hermes 定義：

`A2AReplaySafe = TaskIdentityMatch ∧ EventGenerationMonotonic ∧ DurableEventOffsetKnown ∧ NoDuplicateSemanticCommit ∧ ArtifactLineageRecoverable`

新增：

`ResubscribeSuccess --does_not_prove→ NoEventGap`

以及：

`LatestTaskStateKnown --does_not_prove→ CompleteCausalHistoryKnown`

### 4. Artifact 是 result object，不天然是 side-effect receipt

**已確認事實：** `TaskUpdater.add_artifact()` 產生 `TaskArtifactUpdateEvent`；artifact 可以分 chunk、append，並有 artifact id。它代表 receiver 發布的工作產物。

**合理推論：** 即使 Artifact 內容說「已完成付款」，Artifact 本身仍只是 agent-produced result，不能自動證明外部系統 commit。Hermes 必須把：

`A2AArtifactGeneration`

與：

`ExternalSideEffectReceiptGeneration`

分開，再建立：

`ArtifactReceiptBindingWitness`

所以：

`TaskCompleted ∧ ArtifactPublished --does_not_prove→ ExternalSideEffectCommittedExactlyOnce`

### 5. A2A execution stream 本質上是一條 event-sourced state transition candidate，但 current default queue 不等於完整 event log

**Architecture interpretation：** TaskUpdater 將 agent execution 轉成 `TaskStatusUpdateEvent / TaskArtifactUpdateEvent`；EventConsumer按事件流消費；ResultAggregator把 event 合併進 Task state。這非常接近 event-sourced runtime：

`State_n + Event_(n+1) → State_(n+1)`

但只有在 events 具有 durable identity、ordering、offset、dedupe 與 replay semantics 時，才能真正當可驗證 event log。

Hermes 因此新增：

`A2AEventIdentity = TaskID + ExecutionGeneration + EventSequence + EventType + ProducerIdentity`

以及：

`A2ATaskGeneration = TaskID + ReceiverExecutionGeneration + DelegationGeneration`

避免同一 task ID 在 retry/resume/reconnect 情境被誤認為同一 execution generation。

## Architecture Breakdown

### A2A receiver runtime

```text
Sender Agent
  ↓ SendMessage / Stream
Transport Adapter
  ↓
DefaultRequestHandler
  ↓
TaskManager / TaskStore
  ↓
RequestContextBuilder
  ↓
AgentExecutor.execute(context, event_queue)
  ↓
TaskUpdater
  ├─ TaskStatusUpdateEvent
  ├─ TaskArtifactUpdateEvent
  └─ Message / Task
  ↓
EventQueue
  ↓
EventConsumer
  ↓
ResultAggregator
  ├─ update Task state
  ├─ persist Task
  ├─ stream response
  └─ optional push notification
  ↓
Sender Observation
```

### Failure path

```text
Receiver Tool Side Effect succeeds
  ↓
Artifact event enqueued
  ↓
network disconnect
  ↓
Sender does not observe event
  ↓
Receiver continues background execution
  ↓
TaskStore reaches COMPLETED
  ↓
Sender retries delegation
  ↓
SECOND execution may start
```

因此真正 safe retry 判斷不能只看 network exception：

```text
SafeRetry =
  PriorExecutionResolved
  OR (
    SameSemanticInvocation
    AND IdempotencyBindingPresent
    AND DurableReceiptLookupAvailable
  )
```

## Bottom-Level Logic

### Event publication mechanism

```text
Agent internal state
→ TaskUpdater call
→ construct protobuf event
→ enqueue_event(event)
→ queue buffer
→ EventConsumer.dequeue
→ ResultAggregator apply
→ TaskStore state commit
→ transport emission
→ client receive
```

每一步都是不同 witness：

1. `EventConstructedWitness`
2. `EventEnqueuedWitness`
3. `EventDequeuedWitness`
4. `EventAppliedWitness`
5. `TaskStateCommitWitness`
6. `TransportEmissionWitness`
7. `ClientObservationWitness`

因此：

`EventEnqueued ≠ EventPersisted ≠ EventObserved`

### Artifact chunking

Artifact 支援 `artifact_id + append + last_chunk`。因此 receiver result identity 不應只用 artifact id；Hermes 應追：

`ArtifactGeneration = ArtifactID + ChunkGeneration + AppendOrder + CompletionWitness + TaskGeneration`

否則 client可能看到 partial artifact卻誤認 final result。

## Visual Simulation Idea

### A2A Task/Event Durability & Replay Microscope

八條 timeline：

1. Sender Agent
2. Transport/SSE
3. DefaultRequestHandler
4. AgentExecutor
5. EventQueue
6. ResultAggregator/TaskStore
7. MCP/Tool Side Effect
8. Durable Receipt / Artifact

互動 fault injection：

- `CLIENT_DISCONNECT_AFTER_SIDE_EFFECT`
- `EVENT_ENQUEUED_NOT_PERSISTED`
- `PROCESS_RESTART_LOSES_QUEUE`
- `RESUBSCRIBE_WITH_EVENT_GAP`
- `ARTIFACT_PARTIAL_CHUNK_TREATED_FINAL`
- `TASK_COMPLETED_WITHOUT_EXTERNAL_RECEIPT`
- `RETRY_WHILE_PRIOR_EXECUTION_STILL_RUNNING`
- `DUPLICATE_EVENT_REPLAY`

核心 UI：

`Task State ✓ | Event Gap ? | Side Effect ✓ | Durable Receipt ✓ | Artifact ✓ | Client Observed ✗ | Retry Safe ?`

## Code / GitHub

### A2A Python SDK 值得追的目錄

- `src/a2a/server/request_handlers/default_request_handler.py`
  - message execution setup
  - streaming/background consumption
  - task ID validation
  - cancellation
- `src/a2a/server/events/`
  - EventQueue
  - QueueManager
  - EventConsumer
- `src/a2a/server/tasks/`
  - TaskUpdater
  - TaskManager
  - ResultAggregator
  - TaskStore
- `src/a2a/server/agent_execution/`
  - AgentExecutor
  - RequestContext
- `tests/integration/test_scenarios.py`
  - resubscribe / lifecycle behavior

官方 repo：https://github.com/a2aproject/a2a-python

## Papers

### AIP: Agent Identity Protocol for Verifiable Delegation Across MCP and A2A
- Authors: Sunil Prakash
- Year: 2026
- URL: https://arxiv.org/abs/2603.24775
- Architecture: Invocation-Bound Capability Tokens; compact JWT + chained Biscuit mode
- Contribution: 將 identity、attenuated authorization、MCP/A2A transport binding與completion provenance綁在 delegation chain
- Reported result: paper reports 600 adversarial attempts all rejected; multi-agent deployment overhead 2.35 ms
- Limitation: protocol proposal/reference implementation，不等於 A2A/MCP current standard內建 guarantee
- 本輪意義：completion record應與 invocation/delegation chain cryptographically bind，而不能只靠 Task/Artifact文字。

### HDP: A Lightweight Cryptographic Protocol for Human Delegation Provenance in Agentic AI Systems
- Authors: Asiri Dalugoda
- Year: 2026
- URL: https://arxiv.org/abs/2604.04522
- Architecture: human authorization event + append-only signed delegation hops
- Contribution: terminal action可追到 human principal 與完整 delegation chain
- Limitation: 重點是 delegation provenance，不直接解決 A2A event durability/replay

### MPAC: A Multi-Principal Agent Coordination Protocol for Interoperable Multi-Agent Collaboration
- Authors: Kaiyang Qian, Xinmin Fang, Zhengxiong Li
- Year: 2026
- URL: https://arxiv.org/abs/2604.09744
- Architecture: Session / Intent / Operation / Conflict / Governance，Lamport causal watermark + optimistic concurrency
- Contribution: 把 multi-principal coordination、causal ordering與conflict變成一級 protocol object
- Reported result: controlled 3-agent code-review benchmark reports 95% coordination-overhead reduction and 4.8× wall-clock speedup vs serialized human-mediated baseline
- Limitation: multi-principal coordination protocol，不是 A2A event store replacement

### Mandato: Protocol-Level Enforcement of Digitally Signed Mandates on AI Agent Actions with Cryptographically Chained Audit Trails
- Authors: Giovanni Racioppi
- Year: 2026
- URL: https://arxiv.org/abs/2608.14074
- Architecture: signed mandate + protocol proxy + decision/enforcement separation + hash-chained audit log
- Contribution: 將 tool authorization decision與evidence變成 tamper-evident audit chain
- Limitation: reference system/evaluation仍在發展；不能把 proposed audit semantics視為 current MCP/A2A guarantee

## 與歷史研究比較

上一輪已建立：

`DelegationIdentity → ReceiverAuthority → A2A Task → MCP Tool → SideEffectReceipt`

本輪新增的是 receiver runtime 中間缺失的 temporal/event layer：

`ReceiverTaskGeneration → ExecutorGeneration → EventGeneration → TaskStateCommitGeneration → ArtifactGeneration → ClientObservationGeneration → ReplayGeneration`

因此 Hermes 現在開始能區分：

- **Identity correctness**：是不是同一 task/delegation
- **Authority correctness**：receiver有沒有權做
- **Execution correctness**：是哪一代 executor在做
- **Event correctness**：哪一個 state transition被發布
- **Durability correctness**：是否真的persist
- **Observation correctness**：sender是否真的看到
- **Side-effect correctness**：外部世界是否 exactly-once / idempotently committed

## Unknown / Open Questions

1. A2A v1.1 task timeline/event filtering最後是否會提供足以構建 durable replay cursor 的 normative event identity/ordering semantics？目前 roadmap顯示這仍在推進。
2. 如何把 `A2AEventGeneration` 與 MCP `ToolInvocationIdentity / ExternalSideEffectReceipt` 做 end-to-end cryptographic binding，而不讓 artifact summary成為唯一證據？
3. distributed QueueManager + TaskStore 若採 Redis/Kafka/Postgres，應選 at-least-once event delivery + idempotent reducer，還是追求更強 transaction coupling？

## 下一輪研究

鎖定：

`A2A EventGeneration → ResultAggregator → TaskStore commit → distributed Queue/Event Bus → resubscribe cursor → duplicate/gap detection → ArtifactGeneration → MCP receipt binding`

並深入比較：

`A2A Python QueueManager ↔ A2A JS ExecutionEventBusManager ↔ Kafka/Redis Streams event semantics ↔ OpenTelemetry trace/span identity`

目標是回答：

**「跨 Agent 的工作在網路斷線、server restart、stream reconnect、event duplicate 的情況下，Hermes 怎麼證明沒有漏掉或重複一個會改變真實世界的 action？」**

## Knowledge Graph 新增 Node / Edge

### Nodes
- `A2AReceiverExecutionGeneration`
- `A2AEventGeneration`
- `A2AEventIdentity`
- `A2AEventEnqueueWitness`
- `A2AEventApplyWitness`
- `A2ATaskStateCommitWitness`
- `A2AEventDeliveryWitness`
- `A2AClientObservationGeneration`
- `A2AResubscribeGeneration`
- `A2AReplayGapWitness`
- `A2AArtifactChunkGeneration`
- `A2AArtifactCompletionWitness`
- `ArtifactReceiptBindingWitness`
- `A2ADurableEventOffset`
- `A2ARetrySafetyWitness`

### Edges
- `A2ADelegationGeneration --creates→ A2AReceiverExecutionGeneration`
- `A2AReceiverExecutionGeneration --emits→ A2AEventGeneration`
- `A2AEventGeneration --enqueued_as→ A2AEventEnqueueWitness`
- `A2AEventGeneration --applied_by→ A2AEventApplyWitness`
- `A2AEventApplyWitness --advances→ A2ATaskStateCommitWitness`
- `A2AEventGeneration --may_produce→ A2AArtifactChunkGeneration`
- `A2AArtifactChunkGeneration --requires→ A2AArtifactCompletionWitness`
- `ExternalSideEffectReceipt --must_bind_to→ ArtifactReceiptBindingWitness`
- `ClientDisconnect --does_not_imply→ ReceiverExecutionCanceled`
- `ResubscribeSuccess --does_not_prove→ NoEventGap`
- `TaskCompleted --does_not_prove→ SideEffectExactlyOnce`
- `ArtifactPublished --does_not_prove→ ExternalCommitReceipt`

## 本輪結束判斷

- **缺哪一層：** distributed durable event log → A2A TaskStore → MCP side-effect receipt 的 transaction/replay binding。
- **哪個節點最淺：** `ArtifactReceiptBindingWitness`。
- **哪個概念仍只是名詞：** portable `A2ADurableEventOffset` / replay cursor contract。
- **哪個系統值得讀原始碼：** A2A Python `ResultAggregator + QueueManager + TaskStore`，以及 A2A JS `ExecutionEventBusManager.settleByTaskId`。
- **哪篇論文需追引用：** AIP；它最直接把 A2A/MCP delegation 與 completion provenance接在一起。
- **哪個概念最適合視覺模擬：** A2A Task/Event Durability & Replay Microscope。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Delegation Identity + Durable Event Log + Idempotent Task Reducer + A2A→MCP Receipt Binder + Replay/Gap Detector + Observation Commit Gate`。

## 最終長鏈新增位置

```text
User
→ UI
→ Agent
→ Context
→ Reasoning / Planning
→ Delegation
→ A2A Receiver
→ Receiver Task
→ AgentExecutor
→ EventQueue
→ TaskStore
→ MCP Tool
→ External Side Effect
→ Durable Receipt
→ Artifact/Event
→ Sender Observation
→ Context
→ Next Reasoning
```

本輪最重要的推進：**Hermes 不再把「A2A Task completed」視為一個單一事實，而是拆成 execution、event enqueue、event apply、task-state commit、artifact publication、client observation、external receipt 七個不同 witness。只有把這些 generation 串起來，才能在斷線、重連、重試與 server restart 後判斷「這件事到底做過沒有、做了幾次、sender是否真的知道」。**