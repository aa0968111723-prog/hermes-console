# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-22 15:52 Asia/Taipei

## 本小時新發現

本輪從前一輪 `sampled token → request state → next decode` 跨出純 LLM inference，進入真正 Agent Runtime 的第一個 side-effect boundary：

`Model Output → Tool Call Intent → Canonical Invocation Identity → Approval/Guardrail → Execution → Side Effect → Tool Result → Observation Commit → Next Model Turn`

研究核心不是「Agent 會呼叫工具」，而是：**一次 tool call 到底如何被識別成唯一 invocation，如何避免 resume/retry/duplicate 造成 side effect 重放，以及 tool result 何時才算成為 Agent 可安全消費的 observation。**

新 GitHub 深讀：OpenAI Agents Python SDK，不只 README，追入：
- `src/agents/run.py`
- `src/agents/run_internal/tool_planning.py`
- `src/agents/run_internal/tool_execution.py`
- `src/agents/_tool_invocation.py`
- `.agents/references/tool-execution-lifecycle.md`
- `docs/human_in_the_loop.md`

外部理論基線：ReAct (Yao et al., ICLR 2023) 將 reasoning/action/observation 交錯；本輪將其中粗粒度 `Action → Observation` 拆成 production runtime transaction。

---

## 本小時最重要 5 個發現

### 1. Tool definition identity 與 Tool invocation identity 必須分離

**已確認工程實作。** OpenAI Agents SDK current source 對 invocation 建立 canonical identity，不只使用 tool name。`_tool_invocation.py` 將 invocation type、provider call ID、approval scope 與 semantic payload fingerprint 組成穩定 identity；semantic fields可包含 arguments/input/action/operations/environment/caller 等。

因此：

`SameToolName --does_not_prove→ SameInvocation`

`SameCallID --does_not_prove→ SameInvocationSemantics`

更完整：

`ToolInvocationIdentity = InvocationType + CallID + ApprovalScope + SemanticFingerprint`

這對 Hermes 很重要：如果只以 `tool_name + request_id` dedupe，arguments 改變但 call ID 被錯誤 reuse 時，可能把新 side effect 當舊 invocation。

### 2. Planning/discovery 與 side-effect execution 是不同 correctness phase

**已確認工程實作。** SDK 的 durable architecture reference 明確要求 `process_model_response()` 發現 executable work，但 `tool_planning.py` 決定哪些工作「現在允許執行」；fresh turn 與 resumed interruption 需要不同 plan。

因此 Agent loop 應拆成：

`ModelResponse → InvocationDiscovery → Canonicalization → Dedupe → ApprovalPartition → GuardrailPreflight → ExecutionPlan → Invoke`

而不是粗略的：

`LLM → Tool → Result`

新增 invariant：

`ToolCallDiscovered --does_not_prove→ ToolCallAuthorizedToExecute`

### 3. Approval resume 的核心不是再次判斷，而是保存同一 invocation 的決策

**已確認工程實作。** current lifecycle reference指出：approval state一旦resolved就是authoritative；resume不能重新執行已完成 calls，也不應對同一已批准/拒絕 invocation重新跑 dynamic approval checker。另一方面，tool input guardrail在真正 invocation 前仍需再跑一次，因為等待批准期間 state/policy/arguments可能改變。

因此 approval 與 guardrail 不是同一代狀態：

`ApprovalDecisionGeneration != GuardrailEvaluationGeneration`

Hermes 應保存：

`ApprovalWitness = InvocationIdentity + Decision + DecisionGeneration`

`PreInvokeGuardrailWitness = InvocationIdentity + CurrentStateGeneration + PolicyGeneration + ArgumentGeneration`

### 4. Tool execution completion 不等於 Observation 已可進入下一輪 model context

**工程實作 + 架構推論。** lifecycle reference要求 output guardrails在 output 成為 accepted run state、model input或 persisted session history之前完成；hooks/span也不能在 output guardrail完成前宣告成功 end state。

因此：

`ToolHandlerReturned --does_not_prove→ ObservationCommitted`

真正鏈應是：

`Invoke → RawResult → OutputGuardrail → FailureConversion/Normalization → ToolOutputItem → RunStateCommit → SessionPersistence → NextModelInput`

新增：

`ObservationCommitWitness`

只有這個 witness 成立後，tool result 才是 Agent reasoning loop 中可被下一輪模型合法消費的 observation。

### 5. Parallel tool calls 需要「execution order」與「public observation order」雙重身份

**已確認工程實作。** current SDK reference指出 provider-side parallel tool-call generation與 SDK-side function-tool concurrency是不同層；handlers可以不同順序完成，但 emitted outputs仍需保留 model order；sibling failure/cancellation也不能抹掉已成功 sibling outputs。

因此新增：

`ToolCallModelOrder`
`ToolExecutionScheduleOrder`
`ToolCompletionOrder`
`ToolObservationCommitOrder`

並建立：

`CompletionOrder --does_not_imply→ ObservationOrder`

這是 multi-agent/tool runtime 做 deterministic replay 與 causal debugging 的必要基礎。

---

## Architecture Breakdown

### OpenAI Agents SDK tool execution runtime

從 current source還原：

```text
User / Previous Observation
        ↓
Runner / AgentRunner
        ↓
Model Invocation
        ↓
ModelResponse
        ↓
process_model_response
        ↓
Tool/Handoff/Final classification
        ↓
Tool Invocation Discovery
        ↓
Canonical Tool Lookup
        ↓
Canonical Invocation Identity
        ↓
Deduplicate by invocation identity
        ↓
Approval planning
        ├─ approved
        ├─ rejected
        └─ interruption → serialize RunState → resume
        ↓
Pre-invoke guardrail
        ↓
Execution plan
        ↓
Function/MCP/Computer/Shell/... boundary
        ↓
Actual side effect
        ↓
Raw tool result
        ↓
Output guardrail
        ↓
Failure conversion / output normalization
        ↓
ToolCallOutputItem
        ↓
RunState / Session history
        ↓
Next model invocation
```

### 與 ReAct 的關係

ReAct 抽象：

`Thought → Action → Observation → Thought`

Production runtime應展開成：

`ReasoningState → ActionIntent → InvocationIdentity → Authorization → SideEffect → ResultValidation → ObservationCommit → ContextGeneration → NextReasoningState`

因此 ReAct 是 agent policy-level architecture；SDK tool lifecycle則是 runtime transaction architecture。兩者不可混為同一層。

---

## Bottom-Level Logic

### Canonical invocation fingerprint

current `_tool_invocation.py` 對 semantic payload normalization後做 fingerprint。概念上：

```text
semantic_payload = {
  approval_scope,
  type,
  name/namespace when applicable,
  arguments | input | action | operations,
  environment,
  caller,
  ...
}

fingerprint = SHA256(canonicalize(semantic_payload))

InvocationIdentity =
  (invocation_type, provider_call_id, semantic_fingerprint)
```

這解決兩種不同問題：

1. exact duplicate invocation可以coalesce/dedupe；
2. same call ID但semantic payload不同，可以判定為 identity violation，而不是盲目重放或略過。

### Side-effect exactly-once approximation

Agent runtime很難在任意external tool上保證distributed exactly-once，但可以建立至少一次/至多一次邊界：

```text
Model emits invocation I
→ canonicalize I
→ check ExecutedInvocationSet
→ approval/guardrail
→ mark invocation execution boundary
→ invoke external side effect
→ capture result
→ commit observation
```

必須區分：

`InvocationExecutedWitness`

與

`ObservationCommittedWitness`

如果 process 在兩者中間 crash，resume policy不能只看「沒有 observation」就再次 side-effect；必須知道 invocation是否已經跨過 execution boundary。

### Tool transaction state machine

```text
DISCOVERED
→ CANONICALIZED
→ WAITING_APPROVAL | READY
→ APPROVED | REJECTED
→ PREINVOKE_VALIDATED
→ EXECUTING
→ SIDE_EFFECT_MAY_HAVE_OCCURRED
→ RAW_RESULT_AVAILABLE
→ OUTPUT_VALIDATED
→ OBSERVATION_COMMITTED
→ CONSUMED_BY_MODEL
```

Failure ambiguity最高的是：

`EXECUTING → SIDE_EFFECT_MAY_HAVE_OCCURRED`

例如 HTTP POST 已成功，但 client timeout；runtime不能安全假設「exception = 沒執行」。這是下一階段要接 idempotency key / external transaction receipt 的地方。

---

## Visual Simulation Idea

### Tool Invocation Transaction & Replay Microscope

互動式視覺分成 7 條 lane：

1. Model Response
2. Invocation Identity
3. Approval / Guardrail
4. Execution Scheduler
5. External Tool / MCP Server
6. Observation Commit
7. Next Model Context

可注入 failure：

- `DUPLICATE_CALL_ID_DIFFERENT_ARGUMENTS`
- `RESUME_REEXECUTES_COMPLETED_SIDE_EFFECT`
- `APPROVAL_RECHECK_CHANGES_DECISION`
- `GUARDRAIL_STATE_STALE_AFTER_APPROVAL_WAIT`
- `TOOL_RETURNED_BUT_OUTPUT_NOT_COMMITTED`
- `SIDE_EFFECT_SUCCEEDED_CLIENT_TIMED_OUT`
- `PARALLEL_COMPLETION_REORDERS_PUBLIC_OBSERVATIONS`
- `NESTED_AGENT_TOOL_STATE_ALIAS`

核心 UI 指標：

`Identity ✓ | Approval ✓ | Guardrail ✓ | Side Effect ? | Observation Commit ✗ | Safe to Retry ?`

最重要的是讓 `?` 成為 first-class state，而不是硬轉成成功/失敗。

---

## Code / GitHub

### OpenAI Agents Python SDK

值得持續讀：

- `src/agents/run.py` — Runner / AgentRunner orchestration entrypoint
- `src/agents/run_internal/tool_planning.py` — fresh/resume plan、dedupe、approval partition
- `src/agents/run_internal/tool_execution.py` — actual invocation、concurrency、failure/cancellation、guardrails
- `src/agents/_tool_invocation.py` — canonical invocation identity/fingerprint
- `src/agents/_tool_identity.py` — lookup/namespace identity
- `src/agents/run_state.py` / context — resume state與approval persistence
- `.agents/references/tool-execution-lifecycle.md` — maintainer-level lifecycle contract
- `tests/test_tool_choice_reset.py`
- `tests/test_tool_use_tracker.py`
- `tests/test_run_state.py`

特別值得驗證的 current behavior：nested `Agent.as_tool()` 有自己的 nested run loop/resumable state，cache必須以 parent RunState + call identity scope，而不能只以 reusable agent/tool object scope。

---

## Papers

### ReAct: Synergizing Reasoning and Acting in Language Models
- Authors: Shunyu Yao, Jeffrey Zhao, Dian Yu, Nan Du, Izhak Shafran, Karthik Narasimhan, Yuan Cao
- Institution: Princeton University / Google Research 等作者機構
- Year: 2022 arXiv；ICLR 2023
- URL: https://arxiv.org/abs/2210.03629
- Code/Project: https://react-lm.github.io/
- Dataset/Environment: HotpotQA, FEVER, ALFWorld, WebShop
- Architecture: interleaved reasoning traces + task-specific actions + environment observations
- Contribution: 將 reasoning 與 acting交錯，使external observation能更新後續reasoning/planning
- Limitations for Hermes: paper層的 Action/Observation仍太粗，不定義 production invocation identity、approval persistence、exactly-once side-effect boundary、parallel execution commit order。
- 改變了什麼：建立現代 tool-using agent最重要的 policy loop之一；Hermes本輪把它下鑽成 runtime transaction graph。

### Pre-Act: Multi-Step Planning and Reasoning Improves Acting in LLM Agents
- Authors: Mrinal Rawat, Ambuje Gupta, Rushil Goomer, Alessandro Di Bari, Neha Gupta, Roberto Pieraccini
- Year: 2025
- URL: https://arxiv.org/abs/2505.09970
- Architecture: multi-step plan先於action，並隨tool output增量更新
- Contribution: 強化action planning與turn/end-to-end evaluation
- Limitation for本輪：仍主要處理policy/action correctness，而不是side-effect transaction provenance。

---

## 已確認 / 推論 / 未驗證分界

**已確認事實 / 官方 current source：** OpenAI Agents SDK Runner的 model→tool/handoff/final loop；canonical invocation identity；fresh/resume planning分離；approval persistence；pre-invoke guardrail recheck；parallel tool execution與public output order分離；nested Agent.as_tool resumable state。

**論文結果：** ReAct 在 HotpotQA/FEVER、ALFWorld/WebShop展示 interleaved reasoning/action的效果；Pre-Act研究先規劃再action。

**合理工程推論：** Hermes若要跨不同tool/MCP/external APIs提供 causal replay，應把 `SIDE_EFFECT_MAY_HAVE_OCCURRED` 當成獨立狀態，並要求external receipt/idempotency evidence，而不是 exception即判未執行。

**尚未驗證假說：** 不同 Agent frameworks（LangGraph/Google ADK/Semantic Kernel/CrewAI）是否都具備與 current OpenAI Agents SDK同等強度的 canonical invocation identity + resume dedupe contract；下一輪需比較。

---

## Unknown / Open Questions

1. External HTTP/MCP tool在「server side effect成功、client timeout」時，Hermes如何取得可驗證 receipt，區分 safe retry 與 duplicate side effect？
2. MCP tool call ID、provider function-call ID、Agent runtime invocation ID、external idempotency key之間應如何建立一對一/一對多 identity graph？
3. Nested agent、handoff與parallel sibling tools跨 pause/resume時，如何證明 observation commit order與uninterrupted execution語義等價？

---

## 下一輪研究

優先沿著真正 side-effect transaction繼續：

`ToolInvocationIdentity → MCP tools/call request ID → transport request → server handler → external side effect → result/receipt → transport response → output guardrail → ObservationCommit → ContextGeneration → Next Model Call`

並比較：

`OpenAI Agents SDK vs MCP protocol vs LangGraph ToolNode/runtime`

重點追：

- idempotency / duplicate call semantics
- timeout ambiguity
- retry policy
- approval與tool annotations trust boundary
- prompt injection進入 tool result後的 observation taint
- MCP server identity / namespace / auth principal
- tool output進context前的 provenance envelope

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `ToolDefinitionIdentity`
- `ToolInvocationIdentity`
- `ToolInvocationSemanticFingerprint`
- `ApprovalScopeIdentity`
- `ApprovalDecisionGeneration`
- `PreInvokeGuardrailGeneration`
- `ToolExecutionPlanGeneration`
- `ToolSideEffectBoundaryWitness`
- `SideEffectAmbiguityState`
- `RawToolResultGeneration`
- `ToolOutputGuardrailWitness`
- `ObservationCommitWitness`
- `ToolCallModelOrder`
- `ToolExecutionScheduleOrder`
- `ToolCompletionOrder`
- `ToolObservationCommitOrder`
- `NestedAgentRunIdentity`
- `ExternalIdempotencyReceipt` (open)

### Edges
- `ToolDefinitionIdentity --does_not_prove→ ToolInvocationIdentity`
- `SameCallID --does_not_prove→ SameInvocationSemantics`
- `ToolCallDiscovered --does_not_prove→ ToolCallAuthorizedToExecute`
- `ApprovalDecision --does_not_replace→ PreInvokeGuardrailValidation`
- `ToolHandlerReturned --does_not_prove→ ObservationCommitted`
- `CompletionOrder --does_not_imply→ ObservationCommitOrder`
- `InvocationExecutedWitness --precedes→ ObservationCommitWitness`
- `ObservationCommitWitness --enables→ NextModelContextGeneration`
- `NestedAgentRunIdentity --scoped_by→ ParentRunState + ToolInvocationIdentity`

---

## 本輪結束判斷

**缺哪一層：** Agent runtime invocation identity到MCP/HTTP server真正side-effect receipt之間的distributed transaction層。

**哪個節點最淺：** `ExternalIdempotencyReceipt`。

**哪個概念仍只是名詞：** 跨framework可攜的 `SideEffectAmbiguityState` / exactly-once approximation contract。

**哪個系統值得讀原始碼：** 下一輪優先 MCP Python/TypeScript SDK `tools/call` transport與server handler，再對照 LangGraph ToolNode persistence/resume。

**哪篇論文需追引用：** ReAct 的 production descendants，以及 tool-use reliability / agent transaction / durable execution研究。

**哪個概念最適合視覺模擬：** Tool Invocation Transaction & Replay Microscope。

**哪個 Agent 架構最值得實作：**

`State-grounded Planner + Canonical Invocation Identity Layer + Approval/Guardrail State Machine + Side-Effect Transaction Verifier + Idempotency/Receipt Resolver + Observation Commit Gate + Context Provenance Tracker + Tool Executor`

---

## 對最終「AI 到底怎麼運作」總圖的推進

目前因果鏈已可從底層 inference閉環正式接上Agent action：

`User → UI → Agent Context → Model → GPU Attention/MLP → Logits → Sampled Token → Host Publication → Request State → Tool Call Intent → Canonical Invocation → Approval/Guardrail → Tool Side Effect → Observation Commit → Context Mutation → Next Model Request`

本輪真正新增的不是另一個「工具框架介紹」，而是把 `Tool Call` 從一個箭頭拆成可驗證的 transaction state machine。這是 Hermes 要回答「AI 為什麼做了這個動作、這個動作是否真的只執行一次、模型下一輪看到的 observation究竟是哪一次執行的結果」所缺的底層層級。