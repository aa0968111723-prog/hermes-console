# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 10:52 Asia/Taipei

## 主題
Agent Observation → Run Loop → Tool Intent → Approval → MCP/API Execution → Side Effect → Result Correlation → Context Re-entry

## 與歷史研究比較
上一輪已建立 `AgentObservationWitness`，把 server output 經 protocol projection、SSE、client reducer、tool-call assembly 還原到 Agent 真正收到的 observation。本輪不重複 transport/parser，而往下一個 effect boundary：一個可信 observation 如何成為 tool execution，以及 tool result 如何只回到正確 run/turn/call generation。

核心新問題：`CorrectToolCallAssembly --does_not_prove→ CorrectEffectExactlyOnce`；`CorrectToolResult --does_not_prove→ CorrectContextReentry`。

## 本小時新發現
- OpenAI Agents SDK current run loop：LLM output若包含 tool calls，runner執行 tool calls、append results，再重新呼叫模型；handoff會更新 current agent/input。
- OpenAI Agents SDK current RunState/session recovery已有重要 exactly-once-like 防線：resumed tool work後若 session append acknowledgement失敗，恢復時會比對 exact history tail；完整 batch已commit則不重複append，未commit才retry；history ambiguous時 fail closed，而且不會重新執行已完成 tool/handoff work。
- Tool approval在 current Agents SDK以 specific call ID 為 scope；resume state可保存 pending approvals/results。
- MCP 2026-07-28 modern lifecycle已移除 protocol session；每個 request self-contained。MRTR使用 `input_required + requestState + inputResponses` 重送原 call；Tasks extension則為長工具提供 durable task state machine。
- MCP Tasks cancellation是 cooperative/eventually consistent：cancel acknowledgement不代表 side effect必然停止，因此 EffectCommit不能等同 CancellationAck。
- LangGraph durable execution在 node boundary checkpoint；失敗後從該 node開頭重跑，因此包含 external side effect的 node若沒有 idempotency/receipt，框架級 retry/resume仍可能重複 effect。

## 本小時最重要 5 個發現

### 1. Tool Call Identity 必須與 Effect Identity 分離
**已確認/工程實作：** Agent runner可以在同一 turn產生 tool calls，執行後將 outputs加入下一次 model input。

底層應拆成：
`Observation → ModelTurn → ToolIntent → ToolCall(call_id,args) → Approval → ExecutionAttempt → ExternalEffect → Result → ContextAppend → NextModelTurn`

Hermes不能只記 `tool_call_id`，因為 retry可能用同一 logical call產生多個 execution attempts。

提出：
`LogicalToolCallIdentity = H(runGeneration, turnGeneration, callId, toolIdentity, canonicalArgs)`
`ToolExecutionAttemptGeneration = H(LogicalToolCallIdentity, attemptOrdinal, executorGeneration)`
`ExternalEffectIdentity = provider-native idempotency/effect id when available`

### 2. Exactly-once 不是 transport property，而是 effect protocol
OpenAI Agents SDK目前對 session history append已做 exact-tail reconciliation，這能避免已完成工具結果在恢復時被重複加入 history；但它不能普遍證明任意外部 API 的 side effect exactly-once。

因此：
`HistoryExactlyOnce --does_not_prove→ ExternalEffectExactlyOnce`

對有副作用工具，Hermes應使用：
`Prepare → IdempotencyKey → Execute → ProviderReceipt → Commit → ContextAppend`

若 provider沒有 idempotency primitive，狀態應是 `EFFECT_OUTCOME_AMBIGUOUS`，不能自動 retry destructive call。

### 3. Approval 必須綁定 canonical call generation
Agents SDK current approval decision綁 specific call ID。這是必要但仍不充分：如果 args在 approval後被 canonicalization/parser/retry改變，舊 approval不能授權新 effect。

提出：
`ApprovalWitness = H(principal, LogicalToolCallIdentity, canonicalArgsDigest, policyGeneration, scope, decision, expiry)`

關係：
`ApprovalWitness --authorizes_exactly→ LogicalToolCallIdentity`
而不是 `approval --authorizes→ toolName`。

### 4. MCP 2026 modern lifecycle讓 application correlation更重要
MCP 2026-07-28 request本身stateless；application state應透過顯式 handle/requestState/taskId承載。MRTR會重送 original call；Tasks extension則把長工作表示為 taskId + status/result。

因此 Hermes應建立：
`MCPRequestGeneration → [InputRequiredRoundGeneration]* → MCPTaskGeneration? → MCPResultGeneration`

`requestState`、`taskId`、JSON-RPC request id、agent logical call id是不同 identity domain，不能混成一個 ID。

### 5. Tool Result Correlation 是 Context Integrity Boundary
即使 effect本身正確，若 result被append到錯誤 branch/run/turn，下一輪 reasoning仍會被污染。

提出：
`ToolResultCorrelationWitness = H(LogicalToolCallIdentity, executionAttempt, effectReceipt, resultDigest, targetRunGeneration, targetBranchGeneration, targetTurnGeneration, contextAppendOrdinal)`

下一次模型呼叫前要求：
`ResultReceived → ReceiptVerified → CallMatched → BranchMatched → ContextAppendCommitted → NextTurn`

## Architecture Breakdown

### OpenAI Agents SDK run loop
`Input/RunState → Agent model call → output classification → {final | handoff | tool calls} → tool execution/approval interruption → tool result items → session/history reconciliation → next turn`

值得看的 current repository paths：
- `src/agents/run.py` — runner/event loop
- `src/agents/run_state.py` — resumable state、pending resumed session write
- `src/agents/result.py` — generated/session items與 state conversion
- `src/agents/run_config.py` — tool approval/guardrail execution configuration
- `tests/test_agent_runner.py`
- `tests/test_handoff_history_duplication.py`

### MCP 2026-07-28 execution architecture
`Agent logical call → tools/call(JSON-RPC) → complete | input_required | task → MRTR retry / task polling → final result → host correlation → agent context`

重要差異：protocol-level session已退場；long-running state由 explicit requestState/taskId等 application-visible identity承擔。

### LangGraph durable execution comparison
`State → Node → checkpoint boundary → next node`

失敗/resume會從 interrupted node起點重跑；因此 external effect最好隔離成細粒度 node/task並具 idempotency/receipt。Checkpoint證明 workflow state durability，不等同 external effect exactly-once。

## Bottom-Level Logic

### Tool effect path
`Intent → Tool Schema → Tool Selection → Canonical Arguments → Call Identity → Authorization/Approval → Idempotency Key → Execution Attempt → Provider Effect → Provider Receipt → Result Decode → Result Validation → Call Correlation → Context Append → Next Decision`

### Failure matrix
- timeout before provider accepts：可安全 retry only if idempotent/idempotency-keyed
- timeout after provider accepts但response lost：`OUTCOME_AMBIGUOUS`；先query receipt/status，不直接重做
- result duplicated：dedupe by logical call + provider receipt
- session append ack lost：reconcile exact history tail
- branch changed：reject result append unless branch generation matches
- approval stale：canonical args/policy generation mismatch即重新 approval
- MCP input_required retry：保留 same logical call，增加 round generation
- MCP task cancel ack：不可推論 effect已停止

## Visual Simulation Idea
### Agent Tool Effect & Context Re-entry Microscope
欄位：
`Run | Turn | Tool Intent | Call ID | Canonical Args | Approval | Attempt | MCP/API Request | Effect | Receipt | Result | Branch | Context Append | Next Turn`

故障注入：
- `TIMEOUT_AFTER_EFFECT_BEFORE_RESULT`
- `RETRY_WITHOUT_IDEMPOTENCY_KEY`
- `APPROVAL_ARGS_CHANGED`
- `MCP_INPUT_REQUIRED_REPLAY_WRONG_STATE`
- `TASK_CANCEL_ACK_BUT_EFFECT_COMMITS`
- `RESULT_FROM_RUN_A_APPENDED_TO_RUN_B`
- `SESSION_APPEND_ACK_LOST`
- `HANDOFF_BRANCH_CHANGED_BEFORE_RESULT`
- `DUPLICATE_PROVIDER_RECEIPT`

UI應顯示：`CALL ✓ | APPROVAL ✓ | EFFECT ? | RECEIPT ? | RESULT ✓ | CORRELATION ✓ | CONTEXT COMMIT ✓`。

## Code / GitHub
### OpenAI Agents SDK
Current source/docs交叉確認：runner loop、RunState serialization、session history reconciliation與 approval interruption是最值得直接instrument的點。

Hermes建議新增 instrumentation adapters：
- `AgentRunGenerationAdapter`
- `ToolCallCanonicalizer`
- `EffectReceiptAdapter`
- `MCPRequestCorrelationAdapter`
- `ContextAppendCommitAdapter`

### LangGraph
值得進一步追 checkpoint/task internals，而不是只看 agent API；尤其 side-effect node retry semantics與 durable execution replay。

### MCP SDK/spec
下一步應追 TypeScript/Python SDK `call_tool`、MRTR driver、Tasks client/server state machine，確認 requestState/task result的實際 persistence與retry邊界。

## Papers / Standards
本輪核心不是新模型論文，而是 runtime/distributed-systems correctness。優先來源為 OpenAI Agents SDK current docs/source、MCP 2026-07-28 spec/Tasks extension、LangGraph durable execution docs。下一輪論文線應補：workflow exactly-once、transactional outbox/inbox、sagas、idempotent receivers與effect systems，對照 Agent tool runtime。

## Knowledge Graph 新增 Node / Edge
### Nodes
- `AgentRunGeneration`
- `AgentTurnGeneration`
- `AgentBranchGeneration`
- `LogicalToolCallIdentity`
- `CanonicalToolArgumentsIdentity`
- `ApprovalWitness`
- `ToolExecutionAttemptGeneration`
- `IdempotencyKeyIdentity`
- `ExternalEffectGeneration`
- `ExternalEffectReceipt`
- `EffectOutcomeAmbiguityState`
- `MCPRequestGeneration`
- `MCPInputRequiredRoundGeneration`
- `MCPRequestStateIdentity`
- `MCPTaskGeneration`
- `MCPTaskStatusGeneration`
- `ToolResultGeneration`
- `ToolResultCorrelationWitness`
- `ContextAppendGeneration`
- `ContextAppendCommitWitness`

### Edges
- `AgentObservationGeneration --enters→ AgentTurnGeneration`
- `AgentTurnGeneration --proposes→ LogicalToolCallIdentity`
- `ApprovalWitness --authorizes_exactly→ LogicalToolCallIdentity`
- `LogicalToolCallIdentity --attempted_as→ ToolExecutionAttemptGeneration`
- `ToolExecutionAttemptGeneration --may_commit→ ExternalEffectGeneration`
- `ExternalEffectGeneration --proven_by→ ExternalEffectReceipt`
- `LogicalToolCallIdentity --maps_to→ MCPRequestGeneration`
- `MCPRequestGeneration --may_resume_via→ MCPInputRequiredRoundGeneration`
- `MCPRequestGeneration --may_materialize_as→ MCPTaskGeneration`
- `ExternalEffectReceipt --supports→ ToolResultCorrelationWitness`
- `ToolResultCorrelationWitness --commits_as→ ContextAppendGeneration`
- `ContextAppendGeneration --feeds→ Next AgentTurnGeneration`
- `CancellationAck --does_not_prove→ EffectCancelled`
- `HistoryExactlyOnce --does_not_prove→ EffectExactlyOnce`

## 已確認 / 推論 / 假說界線
**已確認官方/原始碼：** Agents SDK runner的 tool-result loop；RunState/session exact-tail recovery；per-call approval；MCP 2026 stateless request lifecycle、MRTR與Tasks；LangGraph node-boundary durable resume。

**工程推論：** 高風險 Agent若把 checkpoint/session persistence當成 external exactly-once，會留下 duplicate-effect window。

**Hermes architecture proposal / 尚未成為跨框架標準：** `ExternalEffectReceipt`、`ToolResultCorrelationWitness`、`ContextAppendCommitWitness`與 effect ambiguity fail-closed state。

## Unknown / Open Questions
1. 如何為沒有 idempotency key / status lookup的 legacy tools產生足夠可信的 Effect Receipt？
2. 多代理 handoff/subagent並行時，logical call、branch、effect receipt應如何形成跨-runtime causal DAG？
3. MCP Task與外部 provider task同時存在時，哪一層應擁有 authoritative cancellation/commit state？

## 本輪結束判定
- **缺哪一層：** Context Append → prompt/context assembly → memory/RAG injection → next model invocation 的 causal lineage。
- **最淺節點：** `ExternalEffectReceipt`，因為provider能力差異最大。
- **仍只是名詞：** 跨 provider 的 portable `EffectCommitWitness`。
- **最值得讀原始碼：** OpenAI Agents SDK `run.py/run_state.py`，接著 MCP SDK MRTR/Tasks與 LangGraph checkpoint/task internals。
- **最需追的研究：** exactly-once workflow / transactional outbox-inbox / saga 與 agent runtime的結合。
- **最適合視覺模擬：** Agent Tool Effect & Context Re-entry Microscope。
- **最值得實作 Agent 架構：** `Event-sourced Agent Runtime + Canonical ToolCall Identity + Approval Witness + Idempotent Effect Executor + Provider Receipt + Result Correlation + Context Commit + MCP Task/MRTR Adapter`。

## 下一輪研究
`ToolResultCorrelationWitness → ContextAppendCommit → Message/Role/Branch Identity → Context Window Assembly → System/Developer/User/Tool precedence → Memory/RAG retrieval injection → summarization/compaction → prompt tokenization → Next Model Invocation Witness`

核心問題：即使 tool effect與 result correlation都可信，如何證明下一次模型真正看到的 context，就是被批准的 message/memory/tool-result集合，而且沒有因 compaction、summary、RAG retrieval、role precedence、branch merge或 context-window truncation而改變 causal meaning？
