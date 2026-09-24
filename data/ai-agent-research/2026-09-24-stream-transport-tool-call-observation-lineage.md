# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 09:55（Asia/Taipei）

## 本小時研究主題
**RequestOutput → SSE → Streaming State Machine → Tool-call Delta Assembly → Structured Tool Call → Agent Observation / Effect Boundary**

本輪承接上一輪 `CommittedToken → Detokenization → Stop Semantics → RequestOutput`，避免重複 tokenizer / stop / sampling，向外推進到 transport 與 agent 真正消費的 observation/effect boundary。

---

## 本小時新發現

### 1. 新架構：Output Transport & Observation Plane
LLM server 的 `RequestOutput` 並不是 Agent 最終看到的 observation。中間至少存在：

`RequestOutput → protocol projection → typed/legacy SSE event → UTF-8 event framing → client receive → event parser → request/response binding → delta state machine → content/reasoning/tool-call assembly → structured object validation → AgentObservation → ToolIntent → Effect Gate`

因此：

`ServerOutputCorrect --does_not_prove→ AgentObservationCorrect`

### 2. vLLM Responses streaming 本身是 state machine
vLLM current `vllm/entrypoints/openai/responses/streaming_events.py` 的 `split_delta()` 會將 compound `DeltaMessage` 拆成 atomic deltas，固定順序為 reasoning → content → tool_calls，tool calls 再依 index grouping；`SimpleStreamingEventProcessor` 則明確以 CONTENT / REASONING / TOOL_CALL state 進行 open → repeated delta → close lifecycle。

這表示 transport 前就存在一次語意重新投影：

`DeltaMessage → AtomicDeltaSequence → TypedSSEEventSequence`

Source:
- https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/openai/responses/streaming_events.py
- https://docs.vllm.ai/en/latest/api/vllm/entrypoints/openai/responses/streaming_events/

### 3. SSE 保證的是 event-stream parsing order，不是 application semantic completeness
WHATWG SSE 規範要求 UTF-8 decoding，逐行依收到順序處理；blank line dispatch event，並維護 data/event/last-event-id buffers。

但這只能支撐：

`wire byte order → parsed event order`

不能證明：

`all expected semantic deltas arrived exactly once`

更不能證明：

`tool call JSON is complete / valid / belongs to correct request generation`

Source:
- https://html.spec.whatwg.org/multipage/server-sent-events.html

### 4. Tool-call parser 是新的高風險 semantic boundary
vLLM `abstract_parser.py` 的 streaming path會把 `previous_text/current_text/delta_text` 與 previous/current/delta token IDs交給 model-specific tool parser；因此 tool call不是 transport-neutral fact，而是 parser state + tokenizer/model output format共同產生的 derived semantic object。

工程上已出現具體反例：2026-07 的 vLLM issue #48020 顯示 DeepSeek V3/V3.1 tool parser在 start/end tokens落在同一 streaming delta時可直接丟失 tool call；2026-09 issue #54701則回報 concurrent load下 Kimi K2 streaming tool parser可終止為 `finish_reason=tool_calls`，但 wire 上沒有可用 name/arguments。

Sources:
- https://github.com/vllm-project/vllm/blob/main/vllm/parser/abstract_parser.py
- https://github.com/vllm-project/vllm/issues/48020
- https://github.com/vllm-project/vllm/issues/54701

### 5. Disaggregated serving 使「token truth」與「API semantic truth」正式分離
vLLM 2026 Derenderer API 明確把 GPU token generation 與 GPU-less post-processing分離：derender負責 detokenization、reasoning parsing、tool-call parsing，streaming時還需要 client-carried `stream_state`。

所以：

`GeneratedTokenSequenceIdentity --does_not_prove→ OpenAICompatibleResponseIdentity`

新的 provenance boundary 是：

`TokenSequence + OriginalRequest + PromptTokens + ParserGeneration + StreamState → API Response Semantics`

Source:
- https://docs.vllm.ai/en/latest/serving/online_serving/derenderer/

---

# 本小時最重要 5 個發現

## 1. Observation identity 必須獨立於 server output identity
### 是什麼
Agent真正做下一步 reasoning/tool execution時，消費的是 client-side assembled observation，不是 server內部 `RequestOutput`。

### 底層如何運作
`RequestOutput → protocol event projection → SSE frame → UTF-8 parser → typed event → reducer/state machine → assembled content/tool call → AgentObservation`

### 為什麼重要
如果 provenance停在 server output，就無法偵測 duplicate/drop/reorder/cross-request mix/parser divergence。

### 限制
HTTP/TCP本身可提供可靠 ordered byte stream，但 reconnect、application retries、multiple concurrent streams、client reducer bugs仍需要更高層 generation/sequence identity。

## 2. Tool-call arguments 是 incremental semantic object
### 是什麼
Streaming tool call的 function name/arguments可能跨多個 deltas逐步形成。

### 底層如何運作
`Model tokens → parser state → tool_call[index] → name delta + arguments delta → JSON buffer → completion/validation`

### 為什麼重要
工具執行是 effect boundary；不能在 incomplete/ambiguous parser state上執行。

### 限制
不同模型輸出格式不同：JSON、XML-like tags、special tokens、structural tags；不存在單一 parser semantics。

## 3. finish_reason 不能單獨當作完整性證明
2026 vLLM issue #53269記錄 streamed tool call被 max_tokens截斷時仍可能報 `finish_reason=tool_calls`，遮蔽原本 length termination。這證明 terminal metadata也必須與 argument completeness/schema validation交叉驗證。

Source: https://github.com/vllm-project/vllm/issues/53269

## 4. Typed SSE event sequence 是 provenance graph 的新一層
Responses API把 reasoning/content/tool calls拆成不同 typed events；因此需要 `TransportEventGeneration`，至少保存 request/response generation、event ordinal/type、payload digest、parser generation與 predecessor edge。

## 5. Agent effect gate 必須在 parser/transport之後
真正安全的鏈應為：

`ToolIntentTokens → ToolParserWitness → ToolCallAssemblyWitness → SchemaValidationWitness → Authorization/SemanticCommit → ToolExecution`

而不是：

`看到像 JSON 的字串 → execute`

---

# Architecture Breakdown

```text
Model/GPU
  ↓
CommittedTokenGeneration
  ↓
Decode / Stop / RequestOutput
  ↓
ProtocolProjectionGeneration
  ↓
DeltaMessage
  ↓ split_delta
AtomicDeltaSequence
  ↓
Streaming State Machine
  ├─ reasoning events
  ├─ content events
  └─ tool-call events
  ↓
SSE UTF-8 framing
  ↓
Network byte stream
  ↓
Client SSE parser
  ↓
TransportEventGeneration
  ↓
Request/Response binding
  ↓
Client reducer / stream state
  ↓
ToolCallDeltaAssembly
  ↓
JSON / schema validation
  ↓
AgentObservationGeneration
  ↓
ToolIntentGeneration
  ↓
Authorization / SemanticCommit
  ↓
Effect
```

### 已確認事實
- WHATWG SSE逐行依收到順序解析 UTF-8 event stream。
- vLLM Responses streaming會拆 compound delta並透過 state machine輸出 typed events。
- vLLM tool parsing有 model-specific incremental streaming state。
- vLLM Derenderer可把 token generation與 reasoning/tool parsing拆到 GPU-less frontend。

### 工程實作觀察
- vLLM 2026 issue已出現 same-delta boundary造成 tool call drop、concurrency下 empty tool-call deltas、truncation finish_reason錯誤等實例。

### Hermes architecture proposal
- TransportEventGeneration / ToolCallAssemblyWitness / AgentObservationWitness / EffectCommitWitness 是本研究提出的 provenance nodes，不是 SSE/vLLM既有標準。

---

# Bottom-Level Logic

## SSE event reconstruction

```text
HTTP response bytes
→ UTF-8 decode
→ line boundary recognition (CRLF/LF/CR)
→ field parse (data/event/id/retry)
→ data buffer append
→ blank-line dispatch
→ MessageEvent / typed protocol event
```

## Tool-call streaming reconstruction

```text
Token delta
→ decoded text delta
→ model-specific parser state
→ detect tool-call phase
→ identify tool index / id / name
→ append arguments delta
→ detect syntactic completion
→ JSON parse
→ tool schema validation
→ semantic authorization
→ execute
```

必須區分：

`SyntaxComplete ≠ SchemaValid ≠ Authorized ≠ SafeToExecute`

## Proposed witness

```text
TransportEventWitness = H(
  requestGeneration,
  responseGeneration,
  connectionGeneration,
  eventOrdinal,
  eventType,
  payloadDigest,
  predecessorDigest,
  protocolParserGeneration
)
```

```text
ToolCallAssemblyWitness = H(
  responseGeneration,
  toolCallIndex,
  toolCallId,
  orderedDeltaMerkleRoot,
  functionName,
  argumentBytesDigest,
  parserGeneration,
  completionState,
  schemaIdentity
)
```

```text
AgentObservationWitness = H(
  responseGeneration,
  orderedTransportEventRoot,
  contentDigest,
  reasoningVisibilityPolicy,
  toolCallAssemblyRoots,
  finishReason,
  clientReducerGeneration
)
```

---

# Visual Simulation Idea

## Stream → Tool Call → Agent Observation Microscope

互動視圖：

`Tokens | Server Delta | Atomic Events | SSE Frames | Wire | Client Events | Tool Buffer | JSON AST | Schema | Observation | Effect Gate`

可注入：
- `DROP_TOOL_ARGUMENT_DELTA`
- `DUPLICATE_ARGUMENT_DELTA`
- `CROSS_REQUEST_EVENT_MIX`
- `SAME_DELTA_START_END_TOKEN`
- `FINISH_REASON_TOOL_CALLS_BUT_JSON_INCOMPLETE`
- `RECONNECT_REPLAYS_LAST_EVENT`
- `TOOL_INDEX_CHANGED`
- `PARSER_GENERATION_CHANGED`
- `CLIENT_REDUCER_APPLIES_EVENT_TWICE`
- `SCHEMA_CHANGED_AFTER_STREAM_START`

UI應同時顯示：

`Token lineage ✓ | Server output ✓ | Event sequence ✓ | Tool assembly ? | Schema ✓ | Authorization ? | Effect blocked`

---

# Code / GitHub

值得繼續讀的 vLLM current source：

1. `vllm/entrypoints/openai/responses/streaming_events.py`
   - typed SSE state machine
   - `split_delta`
   - content/reasoning/tool-call lifecycle
2. `vllm/entrypoints/openai/responses/serving.py`
   - engine output → Responses streaming events
3. `vllm/parser/abstract_parser.py`
   - reasoning/tool parser orchestration
   - streaming parser boundary
4. `vllm/tool_parsers/abstract_tool_parser.py`
   - parser state abstraction
5. `vllm/tool_parsers/streaming.py`
   - named/required streaming helpers
6. `vllm/serving/online_serving/derenderer` related implementation
   - token-in/token-out與 post-processing分離

值得加入 regression corpus 的真實 failures：
- vllm-project/vllm#48020 — same streaming delta tool boundary drop
- #54701 — concurrent streaming empty tool calls
- #53269 — truncated tool call finish reason ambiguity
- #31871 — Hermes streaming parser raw content instead of structured tool_calls

---

# Papers / Standards

本輪核心不是新模型論文，而是 protocol/runtime correctness，因此主要研究材料是：

1. **WHATWG HTML Standard — Server-sent events**
   - Institution: WHATWG
   - URL: https://html.spec.whatwg.org/multipage/server-sent-events.html
   - Contribution: 定義 UTF-8 event-stream framing、field parsing與 dispatch semantics。
   - Limitation: 不定義 LLM request identity、tool-call completeness或 exactly-once semantic delivery。

2. **vLLM current runtime / API architecture**
   - Project: vLLM
   - URL: https://github.com/vllm-project/vllm
   - Architecture: model output → parser → OpenAI-compatible serving → typed streaming events / derenderer
   - Contribution: 提供真實 production LLM streaming/tool parsing state machine可追原始碼。
   - Limitation: model-specific parsers與快速演進的 streaming paths增加 semantic divergence surface。

---

# Unknown / Open Questions

1. **Exactly-once Observation 是否可能？**
   SSE/TCP order不等於 application exactly-once；需要 request generation + event ordinal + reducer idempotency才能形成可驗證 observation semantics。

2. **Tool-call parser state如何簽章？**
   parser state可能包含 partial JSON/XML/special-token buffers；需要低成本 state digest，否則只能在完成後驗證。

3. **Effect gate應綁哪一層？**
   是綁 assembled JSON、schema-normalized arguments，還是 tool adapter最終 ABI/API request？目前最合理是一路綁到 effect-ready canonical arguments。

---

# 下一輪研究

下一輪應從 observation繼續推進到真正 Agent loop：

`AgentObservationWitness → Context Append → Message/Role Identity → Tool Result → Context Re-entry → Planner/Reasoning Step → Next Tool Decision → MCP Tool Call → External Effect → Tool Result Receipt`

核心問題：

**即使 transport與 tool-call assembly完全可信，Hermes如何證明 tool執行結果回到的是正確 agent run / branch / tool-call generation，而且沒有被 prompt injection、cross-run result mix、retry duplicate effect或 stale observation污染下一輪 context？**

優先原始碼：OpenAI Agents SDK run loop、LangGraph state/checkpoint execution、MCP request/result correlation，以及 Hermes Console自身 runtime/tool bridge。

---

# Knowledge Graph 新增 Node / Edge

## Nodes
- `ProtocolProjectionGeneration`
- `AtomicDeltaSequenceIdentity`
- `SSEConnectionGeneration`
- `TransportEventGeneration`
- `TransportEventWitness`
- `ClientStreamParserGeneration`
- `ClientReducerGeneration`
- `ToolParserGeneration`
- `ToolCallDeltaGeneration`
- `ToolCallAssemblyGeneration`
- `ToolCallAssemblyWitness`
- `SchemaValidationWitness`
- `AgentObservationGeneration`
- `AgentObservationWitness`
- `EffectReadyToolCallIdentity`
- `EffectCommitWitness`

## Edges
- `RequestOutputGeneration --projected_as→ ProtocolProjectionGeneration`
- `ProtocolProjectionGeneration --split_into→ AtomicDeltaSequenceIdentity`
- `AtomicDeltaSequenceIdentity --framed_as→ TransportEventGeneration`
- `TransportEventGeneration --delivered_over→ SSEConnectionGeneration`
- `TransportEventGeneration --consumed_by→ ClientStreamParserGeneration`
- `ToolCallDeltaGeneration --assembled_into→ ToolCallAssemblyGeneration`
- `ToolCallAssemblyGeneration --validated_by→ SchemaValidationWitness`
- `SchemaValidationWitness --contributes_to→ AgentObservationWitness`
- `AgentObservationWitness --authorizes_candidate→ EffectReadyToolCallIdentity`
- `EffectReadyToolCallIdentity --must_precede→ EffectCommitWitness`

---

# 本輪結束判定

- **缺哪一層：** AgentObservation → Context re-entry → Tool execution/result correlation → next reasoning step。
- **哪個節點最淺：** `EffectCommitWitness`，尚未綁到實際 MCP/API side effect與 result receipt。
- **哪個概念仍只是名詞：** portable signed `AgentObservationWitness`。
- **哪個系統值得讀原始碼：** vLLM streaming/tool parser後，下一個最值得讀 OpenAI Agents SDK run loop + MCP correlation + LangGraph checkpoint/state transition。
- **哪篇論文/標準需追引用：** SSE標準本身之外，下一輪應轉向 distributed exactly-once/idempotency與 agent tool-execution correctness文獻。
- **哪個概念最適合視覺模擬：** `Stream → Tool Call → Agent Observation Microscope`。
- **哪個 Agent 架構最值得實作：** `Event-sourced Agent Runtime + Observation Witness + Canonical ToolCall Assembly + SemanticCommit/Effect Receipt + Idempotent Tool Execution`。

目前端到端鏈更新為：

`User → UI → Agent → Context → Model → GPU → KV/Attention → Logits/Sampling → Token → Decode/Stop → RequestOutput → Protocol Projection → SSE → Client Reducer → Tool/Content Assembly → AgentObservation → [next: Context Re-entry / Tool Effect / Result Receipt]`
