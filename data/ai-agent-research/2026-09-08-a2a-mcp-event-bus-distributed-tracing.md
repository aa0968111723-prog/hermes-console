# AI Agent × Multimodal Research Report

時間：2026-09-08 19:53 Asia/Taipei

## 本輪主題

Agent Communication Protocol × A2A v1.0 × MCP × Durable Event Bus × Distributed Trace

本輪承接上一輪 Multi-Agent Shared State / Concurrency，不再重複 worker pool、state version、write-set、WAW conflict；改研究「Agent A 到 Agent B 的資訊究竟如何跨程序、跨框架、跨組織流動，以及如何與 MCP tool call、durable events、trace 串成一條可驗證 execution lineage」。

## 本小時新發現

1. A2A Protocol v1.0 已於 2026-03-12 成為 stable production-ready release。它將 protocol 分成 canonical data model、abstract operations、protocol bindings 三層；normative source 是 `specification/a2a.proto`。
2. A2A v1.0 的核心 object 不是「agent chat」，而是 AgentCard / Message / Task / Part / Artifact / Extension。Task 是 stateful execution unit；Message 是 communication turn；Artifact 是 task output。
3. A2A spec 明確指出 Messages 不應作為 critical information 的可靠 delivery mechanism；stream reconnect 也不保證補回所有 transient status messages。因此 A2A 本身不是 durable event log。
4. A2A 支援 JSON-RPC、gRPC、HTTP+JSON/REST，多 transport 共用同一 canonical semantic model；A2A-Version 用 Major.Minor 協商。
5. A2A v1.0 的 Task lifecycle 含 SUBMITTED / WORKING / COMPLETED / FAILED / CANCELED / INPUT_REQUIRED / REJECTED / AUTH_REQUIRED。
6. A2A Send Message 可以利用 `message_id` 做 duplicate detection，但規格只說 MAY idempotent，不能把它等同 exactly-once execution。
7. A2A push notification 是「提醒 client 去重新 GetTask」的 async notification path，而不是 authoritative state；真正 authoritative state 是 Task snapshot / Artifact。
8. OpenTelemetry 的 GenAI semantic conventions 已可把 `invoke_agent`、LLM `chat`、`execute_tool` spans 組成單一 trace tree，適合 Hermes 建立 Agent → A2A → MCP → Tool 的 distributed trace。

Sources:
- https://a2a-protocol.org/v1.0.0/specification/
- https://a2a-protocol.org/dev/blog/2026/03/12/a2a-protocol-ships-v10-production-ready-standard-for-agent-to-agent-communication/
- https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto
- https://a2a-protocol.org/latest/topics/streaming-and-async/
- https://a2a-protocol.org/latest/sdk/python/api/a2a.utils.telemetry.html
- https://opentelemetry.io/blog/2026/genai-observability/
- https://modelcontextprotocol.io/

---

## 本小時最重要 5 個發現

### 1. A2A 與 MCP 的 boundary 應用「principal」區分，而不是用「都能呼叫東西」混在一起

A2A：

User / Client Agent
→ Agent Card discovery
→ Remote Agent
→ Task lifecycle
→ Message / Artifact exchange

MCP：

Agent Runtime
→ MCP Client
→ MCP Server
→ Tool / Resource / Prompt
→ External capability

A2A 的遠端對象是「可獨立管理任務與狀態的 agentic principal」。MCP 的 server 則是 runtime 能呼叫的能力邊界。

因此：

Agent A --A2A--> Agent B
Agent B --MCP--> Search Server
Agent B --MCP--> Database Server

這三個角色不應畫在同一層。

底層差異：
- A2A 有 AgentCard、Task、Artifact、TaskState、context_id。
- MCP 有 tools/resources/prompts 與 capability negotiation / authorization。
- A2A 假設 remote execution opaque；不要求交換內部 memory、tool implementation、reasoning。

重要性：Hermes 如果把 remote agent 直接註冊成普通 MCP tool，會失去 long-running task lifecycle、artifact streaming、input-required/auth-required、task cancellation 等語意。

限制：一個系統可以把 A2A agent 包成 tool abstraction，但那是 local adapter，不代表 wire protocol 本身相同。

### 2. A2A Message ≠ Durable Event；真正可靠的協作應把 Task State 與 Event Log 分開

A2A specification 明確區分 Message 與 Artifact：Message 用於 task initiation、clarification、status/context interaction；task output SHOULD 以 Artifact 傳遞。規格也警告 streaming client reconnect 後不一定能取得所有 transient status updates，Messages 不應被視為 critical data 的可靠 delivery channel。

因此 Hermes 不應做：

A2A SSE stream
→ directly mutate shared state
→ assume every event arrived exactly once

而應：

A2A event
↓
Ingress Adapter
↓
Dedup / Normalize
↓
Durable Event Log
↓
State Reducer
↓
Materialized Task State

建議 envelope：

{
  event_id,
  trace_id,
  source_agent,
  protocol: "a2a",
  task_id,
  context_id,
  message_id,
  event_type,
  source_sequence?,
  observed_at,
  payload_hash,
  payload
}

這裡 `source_sequence` 不是 A2A v1.0 核心必備欄位，所以若 Hermes 需要 strict ordering，應由自己的 event layer 補上，不可假裝 protocol 已提供。

### 3. A2A 的 Task 是跨 Agent coordination 的「distributed execution handle」

A2A v1 proto 定義：

Task
├ id
├ context_id
├ status
├ artifacts[]
├ history[]
└ metadata

TaskState：
SUBMITTED
→ WORKING
→ COMPLETED / FAILED / CANCELED / REJECTED
或中斷：
→ INPUT_REQUIRED
→ AUTH_REQUIRED

這和上一輪 Hermes 內部 task DAG 的 PENDING / READY / RUNNING / BLOCKED / DONE 不完全相同。

因此必須建立 translation layer：

Hermes Internal Task State
↕ State Mapper
A2A Remote Task State

例如：
- Hermes RUNNING ↔ A2A WORKING
- Hermes BLOCKED(user input) ↔ INPUT_REQUIRED
- Hermes BLOCKED(auth) ↔ AUTH_REQUIRED
- Hermes DONE ↔ COMPLETED
- Hermes FAILED ↔ FAILED

但不能 1:1 粗暴映射：A2A 是 remote agent contract；Hermes internal state 還包含 dependency readiness、transaction status、verification status 等更細資訊。

### 4. A2A `message_id` 可支援 dedup，但絕不能推論 exactly-once side effect

A2A v1 operation semantics：Get/List operations naturally idempotent；Send Message MAY be idempotent，agent MAY 用 messageId 偵測 duplicate。

所以：

same message_id
→ server MAY dedup

不等於：

same semantic intent
→ side effect exactly once

因為：
- client retry 可能換 message_id；
- remote agent 可能已執行外部 side effect 但 response timeout；
- remote agent 內部又可能呼叫 MCP/API；
- task replan 可能生成新的 Message，但語義副作用相同。

所以必須沿用上一輪的 Semantic Effect Identity：

A2A Message ID
≠
Task ID
≠
Semantic Effect ID
≠
MCP Tool Call ID

Hermes 建議建立 Effect Lineage：

User Intent
→ Internal Task
→ A2A Message
→ Remote Task
→ MCP Tool Call
→ External Effect

每一層保留自己的 identity，不要共用一個 requestId 假裝涵蓋全部語意。

### 5. Distributed Trace 應成為 A2A + MCP + Model + Tool 的共同 observability backbone

OpenTelemetry 2026 GenAI observability example 已用：

invoke_agent span
├ chat span
├ execute_tool span
└ chat span

Hermes 可以擴成：

TRACE user-request
│
├ UI span
├ invoke_agent: hermes
│  ├ context_build
│  ├ model_inference
│  ├ a2a.send_message
│  │  └ REMOTE TRACE CONTEXT
│  │     └ invoke_agent: remote-agent
│  │        ├ model_inference
│  │        ├ mcp.call_tool
│  │        │  └ external API
│  │        └ artifact.build
│  └ verify_remote_artifact
└ final_render

必須分開三種 ID：
- trace_id：observability lineage
- task_id/context_id：protocol execution identity
- semantic_effect_id：side-effect safety identity

它們用途不同，不應互相替代。

---

## Architecture Breakdown

### Distributed Agent Communication Runtime

User Goal
↓
Hermes Planner / Task DAG
↓
Remote Capability Resolver
├ Local Tool? → MCP
└ Remote Autonomous Agent? → A2A
↓
A2A Discovery
├ Agent Card
├ skills
├ capabilities
├ supported interfaces
├ security schemes
└ protocol version
↓
Protocol Negotiator
├ JSON-RPC
├ gRPC
└ HTTP+JSON
↓
Task Initiator
↓
Message Envelope
├ message_id
├ context_id
├ task_id?
├ parts[]
├ extensions[]
└ reference_task_ids[]
↓
Remote Agent Runtime
↓
Task Lifecycle
↓
Streaming / Polling / Push Notification
↓
Ingress Event Adapter
↓
Durable Event Log
↓
Task State Reducer
↓
Artifact Store
↓
Verifier / Joiner
↓
Hermes Shared State Commit

### MCP path inside remote agent

Remote Agent
↓
Model / Planner
↓
Tool Intent
↓
MCP Client
↓
MCP Server
↓
Tool Execution
↓
Observation
↓
Remote Agent
↓
A2A Artifact / Status

A2A 不需要也不應暴露這段 internal tool topology 給 caller，除非雙方另有約定。

---

## Bottom-Level Logic

### A2A task streaming 的真正資料流

1. Client fetch Agent Card.
2. Resolve supported protocol interface + protocol version + auth scheme.
3. Build Message with client-generated `message_id`.
4. SendMessage / SendStreamingMessage.
5. Remote server MAY return direct Message or create stateful Task.
6. Task starts SUBMITTED / WORKING.
7. Streaming path emits TaskStatusUpdateEvent / TaskArtifactUpdateEvent.
8. Artifact chunks may carry same artifact_id with `append=true`; `last_chunk=true` marks final chunk.
9. Stream closes on terminal or interrupted task state depending operation semantics.
10. If stream disconnects, client cannot assume it saw every transient Message.
11. Client must reconcile with GetTask / ListTasks or push-triggered GetTask.
12. Hermes normalizes remote snapshot into internal state and records provenance.

### Exactly-once illusion

Network sequence:

Hermes
→ A2A SendMessage(message_id=M1)
→ Remote Agent
→ MCP send_email
→ Email server commits
→ Remote Agent generates success
X network connection lost

Hermes observes timeout.

Unsafe:
retry with M2
→ second remote task/tool call
→ duplicate email

Safer:
UNKNOWN
↓
GetTask(M1-associated task if task id known)
↓
Remote verification / external evidence
↓
COMPLETED ?
├ yes → commit
├ no → retry
└ unknown → escalate / reconciliation

所以 A2A transport-level retry 必須接到之前建立的 Transaction / Verification Runtime，而不是獨立做 naive retry。

---

## Visual Simulation Idea

### Agent Communication X-Ray

同一個 user request：
「請研究三篇論文，交給遠端 Research Agent，再把結果存入資料庫。」

顯示四條泳道：

Hermes Runtime | A2A | Remote Agent | MCP/Tool

動畫：

Goal
→ internal task T-H1
→ Agent Card discovery
→ A2A message M1
→ remote task T-R9
→ WORKING
→ remote model
→ MCP.search()
→ MCP.database()
→ Artifact A1 chunk 1
→ Artifact A1 chunk 2
→ COMPLETED
→ Hermes verifier
→ shared-state commit

每個封包可點開：
- trace_id
- message_id
- task_id
- context_id
- artifact_id
- protocol version
- transport binding
- auth principal
- source / destination agent
- delivery state
- retry count
- duplicate status
- verification state

Failure Injection：
- SSE disconnect
- duplicate Message
- late Artifact
- AUTH_REQUIRED
- INPUT_REQUIRED
- push notification arrives twice
- remote task completed but client timed out
- MCP side effect succeeded but remote Agent crashed

畫面同時比較：

A2A only
vs
A2A + Durable Event Log

讓使用者看到為什麼「收到訊息」不等於「系統狀態可靠」。

---

## Code / GitHub

### a2aproject/A2A

值得看的：

- `docs/specification.md`
  - protocol layers
  - message vs artifact
  - operation semantics
  - idempotency
  - task lifecycle
  - security / versioning
- `specification/a2a.proto`
  - `A2AService`
  - `SendMessage`
  - `SendStreamingMessage`
  - `GetTask`
  - `ListTasks`
  - `CancelTask`
  - `SubscribeToTask`
  - `Task`
  - `TaskState`
  - `Message`
  - `Artifact`
  - `TaskStatusUpdateEvent`
  - `TaskArtifactUpdateEvent`
- official SDK telemetry modules

原始碼的重要實作結論：`a2a.proto` 已把 canonical model 與 HTTP bindings 一起定義，可看到 `/message:send`、`/message:stream`、`/tasks/{id}`、`/tasks/{id}:subscribe`，並支援 tenant-specific bindings。

### a2aproject/a2a-js

值得追：
- task lifecycle sample
- streaming sample
- multi-transport agent
- v0.3 → v1.0 compatibility/migration

### Hermes Console integration targets

未來不應只新增 `a2a-client.ts`，而應至少拆：

lib/server/a2a/
├ discovery.ts
├ client.ts
├ task-mapper.ts
├ event-normalizer.ts
├ auth.ts
└ trace.ts

lib/server/events/
├ envelope.ts
├ dedup.ts
├ reducer.ts
└ durable-store.ts

lib/contracts/
├ remote-task.ts
├ distributed-trace.ts
└ semantic-effect.ts

此輪只匯入研究，不直接改 production runtime，以避免在尚未驗證 protocol choices 前破壞 Hermes single-agent invariants。

---

## Papers / Specifications

### Agent2Agent Protocol Specification v1.0

Organization: A2A Project / Linux Foundation
Year: 2026
URL: https://a2a-protocol.org/v1.0.0/specification/
Code: https://github.com/a2aproject/A2A
Architecture: AgentCard + Message + Task + Artifact + multi-binding operations
Contribution: 建立跨 vendor/framework opaque agent interoperability 的正式 task/message contract。
Limitations: protocol 不等於 durable event log；不保證 critical transient message 的 reliable replay；SendMessage idempotency 亦非 mandatory exactly-once execution。
Changed: 把「Agent 呼叫另一個 Agent」從 framework-specific handoff 提升成跨系統 wire protocol。

### OpenTelemetry GenAI Semantic Conventions / GenAI Observability

Organization: OpenTelemetry
Year: 2026 (current observability examples)
URL: https://opentelemetry.io/blog/2026/genai-observability/
Architecture: agent span → model chat span → tool execution span
Contribution: 提供可跨 model/tool/agent runtime 組合的 observability vocabulary。
Limitations: tracing 只能觀察 lineage，不自動提供 transactional consistency、dedup 或 exactly-once semantics。
Changed: 讓 Agent Debug 可以從「聊天 log」升級為 distributed execution trace。

### Model Context Protocol

Organization: MCP project
URL: https://modelcontextprotocol.io/
Architecture: Host / Client / Server → tools/resources/prompts
Contribution: 標準化 Agent-to-capability boundary。
Limitations: 不是 Agent-to-Agent long-running task protocol，也不是 general durable message bus。
Changed: 與 A2A 組合後形成明確的 north/south vs east/west communication boundary。

---

## Unknown / Open Questions

1. A2A v1.0 沒有提供通用 global causal clock；Hermes 跨 A2A + MCP + internal DAG 要不要引入 Lamport clock / hybrid logical clock，還是 `trace_id + local sequence + state version` 已足夠？
2. A2A streaming/push 在 production 中如何實作 durable replay 最合理？應依賴 A2A Task snapshots、外部 Kafka/NATS/Redis Streams，還是 Hermes 自己 event store？
3. Agent Card discovery 如何與 trust registry、signed card、tenant routing、key rotation、revocation 組合，才不會讓「發現 agent」直接等於「信任 agent」？

---

## 下一輪研究

下一輪建議：

**Agent Identity × Delegated Authority × Zero-Trust Agent Mesh**

追：

User Principal
↓
Hermes Identity
↓
Delegation Token
↓
A2A Remote Agent
↓
Subtask Authority
↓
MCP Tool Scope
↓
External Resource

核心問題：
- Agent Card signature 到底驗證什麼、不驗證什麼？
- Remote Agent 如何知道 Hermes 代表哪個 user / tenant？
- delegated authority 是否應隨 A2A task 傳遞？
- downstream MCP token 應該是 user token、agent token 還是 attenuated capability token？
- multi-hop A→B→C 如何避免 confused deputy？
- permission scope 如何在跨 agent delegation 時只能縮小不能放大？

---

## Knowledge Graph 新增 Node / Edge

新增 Node：

Agent Communication Protocol
├ A2A
├ Message
├ Task
├ Artifact
├ Agent Card
├ Protocol Binding
├ Version Negotiation
└ Push Notification

Distributed Event Runtime
├ Event Envelope
├ Durable Event Log
├ Dedup
├ Ordering
├ State Reducer
├ Materialized Task State
└ Replay / Reconciliation

Distributed Observability
├ Trace ID
├ Span ID
├ Agent Span
├ Model Span
├ Tool Span
├ A2A Span
└ MCP Span

Identity Dimensions
├ Message ID
├ Task ID
├ Context ID
├ Artifact ID
├ Trace ID
└ Semantic Effect ID

新增 Edges：

Hermes Agent
--delegates via--> A2A

Remote Agent
--uses capability via--> MCP

A2A Message
--may create--> A2A Task

A2A Task
--produces--> Artifact

A2A Stream
--feeds--> Event Normalizer

Event Normalizer
--appends--> Durable Event Log

Durable Event Log
--reduces into--> Shared State

Trace ID
--correlates--> Agent / Model / MCP / Tool spans

Message ID
--supports--> Duplicate Detection

Semantic Effect ID
--protects against--> Duplicate Side Effect

A2A Task State
--maps to--> Hermes Internal Task State

---

## 本輪進化檢查

缺哪一層：跨 Agent identity / delegated authority。
哪個節點最淺：A2A push / streaming 的 production replay semantics。
哪個概念仍只是名詞：Agent Mesh / Zero-Trust Agent Network。
哪個系統值得讀原始碼：A2A official Python/JS SDK 的 task store、streaming、push notification、auth、telemetry implementation。
哪篇規格需追引用：A2A v1.0 → enterprise agent interoperability / distributed coordination work。
哪個概念最適合視覺模擬：Agent Communication X-Ray（A2A ↔ Remote Agent ↔ MCP ↔ Tool + distributed trace）。
哪個 Agent 架構最值得實作：Hermes single orchestrator + typed A2A remote workers + durable event/state layer + MCP capability layer，而不是 free-form swarm。

## 一句核心結論

**A2A 解決「Agent 如何跨系統委派與交換 Task/Artifact」，MCP 解決「Agent 如何呼叫能力」，Event Log 解決「事件如何可靠保存與重播」，OpenTelemetry 解決「整條鏈如何被看見」；這四層不能互相替代。**