# 【AI Agent × Multimodal Research Report】

**時間：2026-09-22 16:56（Asia/Taipei）**

**本輪主題：MCP 2026-07-28 Stateless Tool Transaction × MRTR × requestState Provenance Contract**

## 歷史研究比較 / 去重

上一輪已把 Agent tool call 從單一箭頭拆成 `Model Output → Canonical Invocation Identity → Approval/Guardrail → Execution → Side Effect → Result → Observation Commit → Next Model Turn`，並指出最大的未解缺口是 `Agent runtime invocation identity → MCP/HTTP server → external side-effect receipt` 的 distributed transaction。

本輪不重複 tool-selection 或 approval，而是專門下鑽 MCP 2026-07-28 的 wire/runtime boundary：當 MCP 已移除 protocol session，tool call 如何跨 HTTP、load balancer、多輪輸入、server re-entry 保持「同一個語義交易」？研究結果顯示：JSON-RPC request id、MCP requestState、Agent ToolInvocationIdentity、外部 idempotency key 是四個不同 identity domain，不能互相代替。

---

## 本小時新發現

### 新架構：MCP 2026-07-28 Stateless Core

MCP 2026-07-28 移除 `initialize/initialized` handshake 與 `Mcp-Session-Id`。每個 request 自描述 protocol version、client identity/capabilities；`server/discover` 變成可選普通 RPC。因此 request 可以落到 round-robin load balancer 後任意 server instance。

### 新機制：Multi Round-Trip Requests (MRTR)

需要 confirmation / elicitation / sampling 等中間輸入時，server 不再依賴長連線反向 RPC，而回傳 `resultType: input_required`；client 收集答案後重新送出原始 call，並攜帶 `inputResponses` 與 `requestState`。

### 新原始碼證據：TypeScript SDK v2

值得繼續讀的目錄/檔案：

- `packages/core-internal/src/wire/rev2026-07-28/buildSchemas.ts` — frozen 2026 wire contract、request method registry、`tools/call` schema。
- `packages/core-internal/src/wire/codec.ts` — envelope、inputResponses、requestState lifting/dispatch。
- `packages/core-internal/src/shared/inputRequiredDriver.ts` — client MRTR auto-fulfil + retry engine。
- `docs/servers/input-required.md` — write-once handler、requestState security、cross-round semantics。
- `examples/guides/servers/input-required.examples.ts` — confirmation/state examples。

---

# 本小時最重要 5 個發現

## 1. JSON-RPC Request ID 不是 Tool Invocation Identity，也不是 Idempotency Key

### 是什麼

`tools/call` 在 wire 上仍是 JSON-RPC request，具有 request id；SDK schema也把 `RequestId` 定義成 string/int。但 request id主要解決 request/response correlation。

### 底層如何運作

`Agent ToolInvocationIdentity`
→ MCP client建立 `tools/call`
→ JSON-RPC RequestId
→ HTTP request
→ server dispatch
→ handler
→ JSON-RPC response with same correlation id

### 為什麼重要

network timeout後，client若重送同一語義操作，新的transport request可能取得新的request id；即使沿用request id，也不能推出server沒有執行過side effect。因此：

`SameJSONRPCRequestId --does_not_prove→ SameSemanticInvocation`

`SameSemanticInvocation --does_not_prove→ SideEffectExecutedExactlyOnce`

### 限制

MCP core不替任意side-effecting tool提供 exactly-once transaction semantics；需要應用層 idempotency/receipt。

### 證據分類

- 已確認：MCP/SDK wire schema。
- 合理工程推論：request correlation無法單獨提供external exactly-once。

---

## 2. Stateless MCP 把 hidden session state 轉成 explicit semantic state

### 是什麼

2026-07-28移除protocol-level session。跨round狀態不再隱藏在server connection/session，而需顯式放進 request payload/state handle。

### 底層如何運作

`ToolCall Round 0`
→ server發現缺 confirmation
→ `input_required`
→ client取得 user answer
→ retry original call
→ `inputResponses + requestState`
→ 任意server replica重新進入handler
→ handler重新derive execution position

### 為什麼重要

這使 Hermes 能把 state lineage 直接視覺化，不必把「session」當黑盒：

`InvocationSemanticGeneration → MRTRRoundGeneration → RequestStateGeneration → HandlerReentryGeneration`

### 限制

server application仍可建立自己的state store；stateless是protocol core，不代表整個Agent application無狀態。

### 新 Edge

`ProtocolSessionRemoved --causes→ ExplicitCrossRoundStateRequirement`

---

## 3. requestState 是 capability/bearer proof，不只是 resume cursor

### 是什麼

TypeScript SDK文件明確要求：`requestState` 會經client round-trip，因此是 attacker-controlled input；SDK本身不自動保護。`createRequestStateCodec` 提供 HMAC-SHA256 mint/verify，且建議fleet共享key與TTL。

### 底層如何運作

`Prior Round Evidence`
→ server僅mint已被證明的facts
→ HMAC(request-state payload)
→ client byte-exact echo
→ next server replica verify
→ decode state
→ handler re-entry

若過早mint `{step:'confirmed'}`，就等於在confirmation真正發生前發出一張可攜式「已確認」證明。

### 為什麼重要

這使 requestState 必須進入 Hermes Security/Provenance graph：

`RequestStateGeneration = PayloadClaims + IssuerKeyGeneration + MintTime + Expiry + InvocationBinding`

### 限制

官方codec簽名但不加密，payload可被client解碼，因此不能放secret。

### 新 invariant

`RequestStateTrusted = SignatureValid ∧ NotExpired ∧ ClaimsDerivedFromPriorEvidence ∧ InvocationBindingValid`

---

## 4. MRTR re-entry 是重新執行 handler，不是從程式 counter 繼續

### 是什麼

SDK文件要求 write-once handler：每次entry先讀已有answers/state，再只要求缺失輸入。`inputResponses`只含最新round答案；server round之間沒有隱含handler-local memory。

### 底層如何運作

`Entry N`
→ validate requestState
→ validate untrusted inputResponses
→ reconstruct semantic state
→ decide missing evidence
→ either `input_required` OR execute side effect

這與 coroutine suspend/resume 不同；它更接近 event-sourced/state-reconstruction state machine。

### 為什麼重要

如果side effect在 `input_required` 之前發生，retry會重新進入handler，便可能重複side effect。

因此需要：

`PreCommitPhase → InputCollectionPhase → SideEffectCommitBoundary → ReceiptPersistence → CompleteResult`

而不是把side effect散落在每個round。

### 新 failure

`MRTR_REENTRY_DUPLICATE_SIDE_EFFECT`

`REQUEST_STATE_VALID_BUT_SIDE_EFFECT_RECEIPT_MISSING`

---

## 5. Stateless + load balancing 使 distributed provenance 從最佳實務變成 correctness requirement

### 是什麼

同一個multi-round semantic operation可以先到server A，再到server B。MCP官方2026-07-28設計本來就允許普通round-robin routing。

### 底層如何運作

`Agent Invocation I42`
→ Round0 / Server A
→ input_required + requestState S1
→ Client/user confirmation
→ Round1 / Server B
→ verify S1
→ external POST
→ Receipt R7
→ response
→ Agent Observation Commit

### 為什麼重要

如果 server-local memory是唯一「已執行」證據，換replica後就消失。side-effecting MCP tool必須把 durable receipt / idempotency identity放到shared/external transactional domain。

### 新 invariant

`SafeMCPToolCommit = InvocationIdentityBound ∧ RequestStateVerified ∧ AuthorizationValid ∧ SideEffectIdempotencyKeyBound ∧ DurableReceiptRecorded ∧ ObservationCommitBound`

### 新 Edge

`StatelessReplicaMobility --requires→ DurableSideEffectProvenance`

---

# Architecture Breakdown

```text
User / Agent Model
    ↓
Tool Intent
    ↓
Agent ToolInvocationIdentity
    ↓
Approval / Guardrail
    ↓
MCP Client
    ↓
JSON-RPC RequestId + tools/call(name,args)
    ↓
HTTP Mcp-Method / Mcp-Name routing
    ↓
Load Balancer
    ↓
MCP Server Replica A/B/N
    ↓
Wire Validation
    ↓
Handler Entry Generation
    ├── missing input
    │      ↓
    │   input_required
    │      ↓
    │   inputRequests + requestState
    │      ↓
    │   Client/User answer
    │      ↓
    │   Retry original call
    │      ↓
    │   requestState verify + inputResponses validate
    │
    └── sufficient evidence
           ↓
       Pre-Side-Effect Guard
           ↓
       External Idempotency Key
           ↓
       External Tool/API/DB
           ↓
       Durable SideEffectReceipt
           ↓
       MCP CallToolResult
           ↓
       Agent Output Guardrail
           ↓
       ObservationCommitWitness
           ↓
       ContextGeneration
           ↓
       Next Model Turn
```

---

# Bottom-Level Logic

## MCP tool call transaction decomposition

```text
Intent
→ Tool Schema
→ Tool Selection
→ Arguments
→ Canonical Agent Invocation Identity
→ MCP Wire Serialization
→ JSON-RPC Correlation Identity
→ HTTP Routing Identity
→ Authorization Context
→ Handler Entry Generation
→ RequestState Verification
→ InputResponses Validation
→ Semantic State Reconstruction
→ Pre-Invoke Guardrail
→ External Idempotency Binding
→ Side Effect Execution
→ Durable Receipt
→ MCP Result Serialization
→ Agent Result Validation
→ Observation Commit
→ Context Injection
→ Next Decision
```

## Identity domains that MUST remain separate

```text
AgentToolInvocationIdentity
≠ JSONRPCRequestId
≠ MCPRequestStateGeneration
≠ HTTPRequestIdentity
≠ ExternalIdempotencyKey
≠ ExternalSideEffectReceipt
≠ ObservationCommitGeneration
```

The graph may connect them, but must never collapse them into one node.

---

# Visual Simulation Idea

## MCP Stateless Transaction & MRTR Provenance Microscope

Interactive lanes:

1. Agent Runtime
2. MCP Client
3. HTTP / Load Balancer
4. Server Replica A
5. Server Replica B
6. User Approval / Elicitation
7. External Side-Effect System
8. Observation / Context Commit

Controls:

- switch Round0/Round1 between server replicas
- mutate requestState
- expire requestState
- mint state before evidence exists
- timeout before/after external commit
- retry with same/different JSON-RPC id
- retry with same/different idempotency key
- lose receipt persistence
- duplicate observation commit

Key status panel:

```text
JSON-RPC Correlation      ✓
requestState Signature    ✓
Prior Evidence Binding    ✓
Side Effect Executed      ?
Durable Receipt           ✗
Safe To Retry             ?
Observation Committed     ✗
```

Most important teaching moment: show that `HTTP 500` or client timeout cannot answer whether the side effect happened.

---

# Code / GitHub

Primary source inspected: `modelcontextprotocol/typescript-sdk` at commit `60321700871029401a2e3bed8fdf4f02c9ec3331`.

Highest-value files for next source pass:

- `packages/core-internal/src/shared/inputRequiredDriver.ts`
- `packages/core-internal/src/wire/codec.ts`
- `packages/core-internal/src/wire/rev2026-07-28/buildSchemas.ts`
- `packages/server/src/*` request dispatch / handler context
- `packages/client/src/*` request retry / transport
- `docs/servers/input-required.md`

Confirmed source facts:

- 2026 wire registry includes `tools/call`.
- RequestId remains explicit wire correlation identity.
- request `_meta` can carry progress and related-task metadata.
- inputResponses/requestState are lifted into MCP request context.
- input_required handler re-entry validates untrusted client responses.
- requestState can be HMAC-protected and fleet keys must be shared for cross-replica verification.

---

# Papers / Specifications

## Model Context Protocol Specification 2026-07-28

- **Authors / Institution:** MCP Core Maintainers / Model Context Protocol project
- **Year:** 2026
- **Architecture:** stateless request/response protocol core, header routing, MRTR, extension framework
- **Contribution:** removes protocol session coupling; makes each request self-describing; adds explicit cross-round state and input flow
- **Limitations relevant to Hermes:** protocol correlation/state mechanisms do not automatically establish exactly-once semantics for arbitrary external side effects
- **Changed what:** transforms MCP provenance from session-oriented connection state into request-carried state/evidence

## SEP-2575 / SEP-2567 family

- **Area:** Stateless MCP / explicit state handles
- **Changed what:** server affinity is no longer the semantic anchor; state must be explicit enough to survive replica changes

## SEP-2322 Multi Round-Trip Requests

- **Area:** mid-call client input without bidirectional held-open session
- **Changed what:** turns tool execution requiring input into explicit multi-entry state-machine execution

No benchmark dataset is applicable; this round is protocol/runtime correctness research rather than model-quality evaluation.

---

# Confirmed Fact / Inference Separation

### 已確認事實

- MCP 2026-07-28 removes handshake/session from the new protocol lifecycle.
- Requests can route to any replica.
- MRTR uses `input_required`, retry, `inputResponses`, and `requestState`.
- TypeScript SDK docs say requestState returns through the client as attacker-controlled input.
- SDK provides HMAC-SHA256 request-state codec and warns it signs rather than encrypts.
- Handler re-entry reconstructs state; latest-round inputResponses are not persistent server memory.

### 官方設計意圖

- Make MCP easier to scale over ordinary HTTP infrastructure.
- Move state from hidden transport sessions to explicit handles/payloads.

### 工程推論

- JSON-RPC request id alone cannot provide external exactly-once side-effect semantics.
- Multi-replica MRTR makes durable shared receipt/idempotency provenance necessary for high-assurance side-effecting tools.

### 尚未驗證假說

- Current TypeScript SDK may expose enough request/trace metadata to bind Agent ToolInvocationIdentity to MCP requestState and OpenTelemetry trace without patching transport internals.
- A generic Hermes `SideEffectReceiptAdapter` may be portable across MCP, LangGraph ToolNode, OpenAI Agents SDK, and HTTP tools.

---

# Unknown / Open Questions

1. **MCP requestState 應如何安全綁定 Agent ToolInvocationIdentity？** HMAC證明state未被修改，但若payload沒有 invocation fingerprint，仍需研究 cross-invocation replay 防護。
2. **timeout after commit 如何標準化？** MCP result失聯時，server/tool是否能以idempotency key查詢 durable receipt，而不是盲目retry？
3. **MRTR + authorization generation**：approval/authorization在Round0有效，Round1落到另一replica時，哪些policy evidence必須重新驗證，哪些可安全由signed state承接？

---

# 下一輪研究

鎖定以下鏈：

```text
Agent ToolInvocationIdentity
→ MCP client request construction
→ traceparent / request ID
→ Streamable HTTP headers
→ auth token / resource audience
→ server dispatch
→ requestState verification
→ handler context
→ external HTTP/DB idempotency key
→ side-effect receipt
→ timeout/retry
→ MCP result
→ Agent ObservationCommit
```

並深入比較：

```text
MCP TypeScript SDK
↔ OpenAI Agents SDK invocation identity
↔ LangGraph ToolNode retry/persistence
↔ external REST idempotency contracts
```

下一輪優先讀 `inputRequiredDriver.ts`、wire codec、server request dispatcher與authorization middleware，建立真正可實作的 `Invocation → Transport → SideEffectReceipt → Observation` trace schema。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

- `MCPStatelessRequestIdentity`
- `MCPJSONRPCRequestIdentity`
- `MCPMRTRRoundGeneration`
- `MCPHandlerEntryGeneration`
- `MCPRequestStateGeneration`
- `MCPRequestStateSignatureWitness`
- `MCPRequestStateClaimProvenance`
- `MCPInputResponsesGeneration`
- `MCPInputResponseValidationWitness`
- `MCPReplicaExecutionIdentity`
- `MCPExternalIdempotencyBinding`
- `MCPDurableSideEffectReceipt`
- `MCPObservationCommitBinding`
- `CrossReplicaSemanticTransactionIdentity`

## Edges

- `AgentToolInvocationIdentity --serialized_as→ MCPStatelessRequestIdentity`
- `MCPStatelessRequestIdentity --correlated_by→ MCPJSONRPCRequestIdentity`
- `MCPJSONRPCRequestIdentity --does_not_prove→ AgentToolInvocationIdentity`
- `MCPMRTRRoundGeneration --carries→ MCPRequestStateGeneration`
- `MCPRequestStateGeneration --verified_by→ MCPRequestStateSignatureWitness`
- `MCPRequestStateSignatureWitness --does_not_prove→ ClaimWasProperlyEarned`
- `PriorRoundEvidence --authorizes_mint_of→ MCPRequestStateClaimProvenance`
- `MCPRequestStateGeneration --enables→ CrossReplicaSemanticTransactionIdentity`
- `CrossReplicaSemanticTransactionIdentity --requires→ MCPExternalIdempotencyBinding`
- `MCPExternalIdempotencyBinding --resolves_to→ MCPDurableSideEffectReceipt`
- `MCPDurableSideEffectReceipt --supports→ MCPObservationCommitBinding`
- `TransportTimeout --does_not_prove→ SideEffectAbsent`
- `StatelessReplicaMobility --requires→ DurableSideEffectProvenance`

---

# 本輪結束判斷

- **缺哪一層：** MCP handler → external system commit → durable receipt → retry resolution 的跨系統transaction layer。
- **哪個節點最淺：** `MCPDurableSideEffectReceipt`。
- **哪個概念仍只是名詞：** portable `CrossReplicaSemanticTransactionIdentity`。
- **哪個系統值得讀原始碼：** MCP TypeScript SDK `inputRequiredDriver.ts + codec + server dispatcher + auth middleware`，再接 LangGraph ToolNode persistence/retry。
- **哪篇規格/論文需追引用：** MCP 2026-07-28、SEP-2575、SEP-2567、SEP-2322；下一輪補 OpenTelemetry trace propagation 與 OAuth issuer/resource binding。
- **哪個概念最適合視覺模擬：** `MCP Stateless Transaction & MRTR Provenance Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Canonical Invocation Identity + MCP MRTR State Verifier + Cross-Replica Provenance Tracker + Idempotency/Receipt Resolver + Observation Commit Gate + Context Provenance Tracker`。

## 本輪最大推進

Hermes 現在不再把 MCP 視為「Agent 呼叫工具的通道」。MCP 2026-07-28 的 stateless core顯示，一次工具操作其實跨越多個不同 identity domain：Agent invocation、JSON-RPC correlation、MRTR round、signed requestState、server replica、external idempotency key、side-effect receipt、observation commit。下一步的核心不是再增加更多 tool arrows，而是建立這些 identity 之間可驗證、不可混淆的 causal joins，才能回答：**這個 Agent 動作到底是哪一次、在哪個 replica 執行、外部世界是否真的被改變、timeout 後能不能安全 retry，以及下一輪模型看到的 observation 是否真的來自那一次 side effect。**