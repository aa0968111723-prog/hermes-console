# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 18:53（Asia/Taipei）**

**本輪主題：Tool / Skill Capability Graph × MCP Dynamic Discovery × Plan Compilation × Dependency DAG × Runtime Verification**

本輪直接接續上一輪 `Action Model × Affordance × Preconditions/Effects × PDDL/BDDL × Learned Transition Model × Execution Verification`，刻意不再重複「單一 action 是否可執行」。這次往下一層追：當 Agent 同時擁有數十、數百甚至動態變化的 Tools / MCP Servers / Agent-as-Tool / Handoffs 時，它到底如何從使用者目標中選出候選能力、建立 dependency graph、決定 sequential/parallel、處理副作用與權限，最後把自然語言目標編譯成可驗證 execution plan？

核心鏈：

```text
User Goal
↓
Intent / Goal Decomposition
↓
Capability Discovery
↓
Tool Schema Normalization
↓
Capability Graph
├ inputs / outputs
├ preconditions
├ effects
├ permissions
├ side effects
├ latency / cost
└ trust / provenance
↓
Candidate Tool Retrieval
↓
Dependency Inference
↓
Plan IR / DAG
↓
Static Validation
↓
Scheduler
├ parallel-ready set
├ sequential dependencies
└ join barriers
↓
Tool Execution
↓
Observation / Structured Result
↓
Postcondition / Effect Verification
↓
Dynamic Replan
↓
Goal Completion
```

---

## 本小時新發現

1. **MCP 本身提供的是 dynamic capability discovery，不是完整 planner。** 目前 MCP Tool definition 至少包含 `name / description / inputSchema / optional outputSchema / annotations`；client 透過 `tools/list` 發現工具，server 若宣告 `tools.listChanged`，可以主動通知 tool inventory 變化。這表示 Agent 的 capability graph 必須是 runtime-maintained，而不是啟動時一次性 hard-code。
2. **Tool schema 仍不足以直接成為 Action Schema。** MCP annotations 目前提供 `readOnlyHint / destructiveHint / idempotentHint / openWorldHint` 等風險提示，但規格明確要求：來自不可信 server 的 annotations 必須視為 untrusted hint，而不是 enforcement。也就是 tool catalog 還需要額外的 authorization、precondition、effect、cost、trust enrichment layer。
3. **LLMCompiler 已經把 tool orchestration 做成 compiler-like runtime。** 其公開原始碼不是只有 README；`src/llm_compiler/` 明確拆出 `planner.py / output_parser.py / task_fetching_unit.py / llm_compiler.py`。`TaskFetchingUnit` 真正維護 task dependencies，以 completed-event 解鎖 executable set，再用 `asyncio.create_task()` 併行執行沒有未解 dependency 的 tasks。
4. **Tool selection 與 tool scheduling 必須分開。** Toolformer / Gorilla 主要強調「何時呼叫哪個 API、參數如何生成、如何降低 hallucinated API calls」；ReWOO / LLMCompiler 則進一步研究「已決定要用多個工具後，如何把 observation 與 reasoning 解耦、如何先建立 plan、如何併行執行」。因此 Agent Runtime 至少應拆成 Capability Resolver、Planner、Scheduler、Executor、Verifier 五層。
5. **工具的安全性與 correctness 不能只由 LLM 決定。** OpenAI Agents SDK 最新文件把 function-tool guardrails 明確包在工具 invocation 前後；LangGraph `ToolNode` 也把 tool execution、parallel execution、error handling、state injection 做成 runtime component。這支持一個重要工程結論：Tool Planner 應產生 proposal，Runtime Policy Engine 才決定是否真的執行。

---

# 本小時最重要 5 個發現

## 1. Tool Catalog 不只是 `name + JSON Schema`，而應提升成 Capability Graph

### 已確認事實

MCP tools 可以透過 `tools/list` 動態列舉，tool definition 包含：

```text
Tool
├ name
├ title?
├ description
├ inputSchema
├ outputSchema?
├ annotations?
└ execution?   (較新規格)
```

目前正式公開規格中，annotations 可表達 read-only、destructive、idempotent、open-world 等 hints；server 也能透過 `notifications/tools/list_changed` 告知 client 工具列表變更。

來源：
- MCP Tools spec: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP schema: https://modelcontextprotocol.io/specification/2025-06-18/schema
- 2025-11-25 schema: https://modelcontextprotocol.io/specification/2025-11-25/schema

### 底層如何運作

```text
MCP Server Connect
↓
Capability Negotiation
↓
tools/list
↓
Tool descriptors
↓
Host normalization
↓
Capability Registry
↓
(optional)
notifications/tools/list_changed
↓
Registry invalidation / refresh
```

### 為什麼還不夠

單靠 MCP descriptor 很難回答：

```text
這個 tool 需要什麼 world-state precondition？
執行後會改變什麼 state？
是否要使用者批准？
會花多少錢 / 多久？
是否可安全 retry？
output 能否餵給另一個 tool？
```

所以 Hermes 應該把 MCP descriptor 編譯成更完整的：

```text
CapabilityNode
├ tool_ref
├ input_type
├ output_type
├ semantic_intent
├ preconditions[]
├ effects[]
├ required_permissions[]
├ read_only
├ destructive
├ idempotent
├ open_world
├ latency_estimate
├ monetary_cost
├ trust_level
├ source_server
└ runtime_health
```

這一層是**工程建模**，不是 MCP 現行標準。

---

## 2. Tool Selection ≠ Plan Compilation ≠ Scheduling

### Toolformer / Gorilla 解的問題

Toolformer（Meta AI 等，2023）訓練模型決定：

```text
when to call API
which API
arguments
how result enters subsequent prediction
```

Gorilla（UC Berkeley，2023）則更集中在大量 API documentation、API call generation 與 hallucination；其 APIBench 涵蓋 HuggingFace、TorchHub、TensorHub API，並顯示 retrieval API docs 能改善 test-time API adaptation。

這兩者主要解：

```text
Goal
→ Correct Tool / API Invocation
```

### ReWOO / LLMCompiler 解的下一層

ReWOO 把 reasoning plan 與 tool observation 分離，先規劃，再用 Worker 執行、Solver 整合；論文在 HotpotQA 報告約 5x token efficiency 與 4% accuracy improvement（限其 benchmark setting）。

LLMCompiler 更進一步將 multi-tool orchestration 表成 dependency-aware tasks：

```text
Planner
↓
Tasks + dependencies
↓
Task Fetching Unit
↓
Executable Ready Set
↓
Parallel Executor
↓
Join / final answer
```

LLMCompiler 論文報告最高 3.7x latency speedup、6.7x cost saving、約 9% accuracy improvement compared with ReAct，均是其實驗設定，不可泛化為所有 Agent。

因此 Hermes 應明確拆：

```text
Tool Selector
→ 決定可能用哪些 capability

Plan Compiler
→ 決定 dependency / dataflow / control flow

Scheduler
→ 決定現在有哪些 node 可以執行

Executor
→ 真正呼叫 tool

Verifier
→ 驗證 effect / result
```

---

## 3. LLMCompiler 的 bottom-level mechanism 是「dependency readiness」，不是簡單 parallel=true

直接讀 `SqueezeAILab/LLMCompiler` 原始碼，真正值得看的目錄：

```text
src/llm_compiler/
├ llm_compiler.py
├ planner.py
├ output_parser.py
├ task_fetching_unit.py
└ constants.py
```

另外 repo 還拆：

```text
src/
├ agents/
├ callbacks/
├ chains/
├ executors/
├ tools/
├ react/
└ llm_compiler/
```

`task_fetching_unit.py` 的核心 state：

```text
tasks
tasks_done: asyncio.Event
remaining_tasks
```

核心邏輯：

```text
for remaining task:
    if all dependencies.done:
        task enters executable set

for each executable task:
    asyncio.create_task(run_task)
```

而且 dependency output 會透過 `${1}` / `$1` placeholder 替換進 downstream arguments。

這代表真正的 Agent scheduler 可抽象成：

```text
Ready(t) = {
  task_i |
  ∀ d ∈ dependencies(task_i), completed(d)=true
}
```

每一次 state transition：

```text
Completed(task_j)
↓
Unlock downstream edges
↓
Recompute Ready Set
↓
Dispatch parallel tasks
```

這比「模型一次輸出多個 tool calls」更接近 compiler / runtime scheduler。

來源原始碼：
- https://github.com/SqueezeAILab/LLMCompiler/tree/main/src/llm_compiler
- `task_fetching_unit.py`
- `planner.py`

---

## 4. MCP annotations 是 Risk Vocabulary，不是 Enforcement

目前 MCP ToolAnnotations：

```text
readOnlyHint
destructiveHint
idempotentHint
openWorldHint
```

這些對 planner 很有價值，因為可以影響：

```text
是否可 parallel
是否可 retry
是否需要 approval
是否能 speculative execute
是否可能讀到 untrusted content
```

例如：

```text
search_web
readOnly = true
idempotent ≈ true
openWorld = true

send_email
readOnly = false
destructive/additive side effect
idempotent = false
```

所以：

```text
search A
search B
```

通常可以 parallel；但：

```text
create draft
send draft
```

存在 data dependency；而：

```text
charge_card
charge_card
```

若不是 idempotent，retry 本身就可能造成危險。

但是 MCP 官方明確提醒：annotations 只是 hints，不可信 server 可以撒謊，因此：

```text
ToolAnnotation
≠ Authorization
≠ Sandbox Enforcement
≠ Network Policy
≠ Human Approval
```

這也和 OpenAI Agents SDK 的 tool guardrail 設計吻合：function-tool invocation 可以有 input guardrail 與 output guardrail，分別在執行前後判定 allow/reject/throw；這比只靠模型 prompt 安全得多。

來源：
- MCP tool annotations: https://modelcontextprotocol.io/specification/2025-06-18/schema
- MCP blog, 2026-03-16, Tool Annotations as Risk Vocabulary
- OpenAI Agents SDK Guardrails: https://openai.github.io/openai-agents-js/guides/guardrails/

---

## 5. 真正的 Plan Compiler 應輸出 Typed Plan IR，而不是一串自然語言 steps

### 問題

自然語言 planner 常輸出：

```text
1. Search user
2. Get order
3. Refund order
4. Email user
```

但 runtime 真正需要：

```text
node n1
 tool = search_user
 inputs = {email}
 outputs = {user_id}
 side_effect = none

node n2
 tool = get_orders
 inputs = {user_id: $n1.user_id}
 outputs = {order_id, status}
 depends_on = [n1]

node n3
 tool = refund_order
 inputs = {order_id: $n2.order_id}
 preconditions = [status == PAID]
 requires_approval = true
 side_effect = financial
 depends_on = [n2]

node n4
 tool = send_email
 inputs = {email, refund_result: $n3.result}
 depends_on = [n3]
```

### Hermes Plan IR 草案

```text
PlanNode
├ node_id
├ capability_id
├ typed_inputs
├ output_bindings
├ depends_on[]
├ preconditions[]
├ expected_effects[]
├ permission_requirements[]
├ retry_policy
├ timeout
├ idempotency_key?
├ failure_policy
└ verification_rule
```

Plan-level：

```text
PlanIR
├ goal
├ nodes[]
├ dependency_edges[]
├ branch_conditions[]
├ join_nodes[]
├ rollback_edges[]
└ completion_predicate
```

這一層目前沒有 MCP / LangGraph / OpenAI Agents SDK 共通標準；因此暫時標為 **Unified Agent Plan IR — 尚未驗證標準化假說**。

---

# Architecture Breakdown

```text
User / UI
↓
Goal Interpreter
↓
Task Decomposer
↓
Capability Discovery Layer
├ MCP tools/list
├ Static function tools
├ Agent-as-Tool
├ Handoffs
├ Browser/Computer tools
└ Code/Sandbox tools
↓
Capability Normalizer
├ schema
├ semantics
├ permissions
├ risk
├ cost
└ trust
↓
Capability Graph
↓
Candidate Retriever / Router
↓
Plan Compiler
├ output-input type matching
├ dependency inference
├ prerequisite inference
├ effect chaining
├ risk ordering
└ dataflow binding
↓
Typed Plan IR
↓
Static Validator
├ missing input
├ cycle
├ permission gap
├ type mismatch
├ unsafe destructive chain
└ impossible precondition
↓
Scheduler
├ Ready Queue
├ dependency events
├ parallel dispatch
├ barrier/join
└ cancellation
↓
Runtime Policy Gate
↓
Tool Executor
↓
Structured Observation
↓
Result Normalizer
↓
Effect / Postcondition Verifier
↓
State + Memory Update
↓
Dynamic Replanner
↓
Goal Completion
```

---

# Bottom-Level Logic

## A. Data dependency

如果：

```text
Tool A output type = UserID
Tool B input requires UserID
```

則：

```text
A → B
```

## B. World-state dependency

```text
unlock(file)
→ effect: writable(file)

edit(file)
→ precondition: writable(file)
```

因此：

```text
unlock → edit
```

## C. Side-effect ordering

即使 A、B 沒有資料 dependency，如果兩者都修改同一 resource：

```text
write_sheet(row42)
write_sheet(row42)
```

仍可能需要 serialization / conflict control。

因此：

```text
No Data Dependency
≠ Safe To Parallelize
```

Hermes 可以定義：

```text
CanParallel(A,B)
=
NoDataDependency
∧ NoStateConflict
∧ PermissionsIndependent
∧ RetrySemanticsCompatible
∧ ResourceLocksDisjoint
```

這是工程模型，不是現行標準公式。

## D. Retry correctness

```text
Tool failure
↓
Classify
├ transient
├ validation
├ permission
├ semantic
└ side-effect-unknown
```

只有符合 idempotency / known execution status 時才能安全 retry。

```text
HTTP timeout after send_email
```

不能直接假設：

```text
failed → retry
```

因為工具可能已成功執行，只是 response 丟失。

所以需要：

```text
Execution Attempt ID
Idempotency Key
Observed Side Effect
Verification Tool
```

---

# Visual Simulation Idea

## **Tool Capability Graph & Plan Compiler Lab**

左側即時顯示動態能力來源：

```text
MCP: Gmail
├ search_messages
├ create_draft
└ send_message

MCP: Calendar
├ list_events
├ check_freebusy
└ create_event

Local
├ calculator
└ python
```

每個 node 顯示：

```text
Inputs
Outputs
Read-only
Destructive
Idempotent
Open-world
Permission
Latency
Trust
```

使用者輸入：

```text
「找出 Alice 最新一封信裡提到的會議時間，
確認我有空後建立行事曆事件。」
```

畫面立即編譯：

```text
n1 search_messages(Alice)
         ↓
n2 read_message
         ↓
n3 extract_datetime
         ↓
n4 check_freebusy
         ↓
      [free?]
       /    \
     yes     no
      ↓       ↓
n5 create_event  ask/replan
```

同時標記：

```text
READ-ONLY lane
n1 n2 n4

WRITE lane
n5
→ requires approval
```

若加入另一個獨立查詢：

```text
search location
```

Simulator 可直接把 DAG 展開成：

```text
         n1 ─→ n2 ─→ n3 ─┐
                           ├→ n5
         n4 ───────────────┘

         location_search ──┘
```

並顯示：

```text
Sequential baseline: 4.2 s
Compiled DAG:         2.6 s
Critical path: n1→n2→n3→n5
```

可注入 failures：

```text
Tool disappears (tools/list_changed)
Schema changes
Permission revoked
429 rate limit
Timeout after side effect
Prompt injection in open-world result
Non-idempotent retry
Circular dependency
```

並觀察 Plan IR 如何 patch，而不是整個 Agent 重新從頭思考。

---

# Code / GitHub

## 1. SqueezeAILab/LLMCompiler

Repo:
https://github.com/SqueezeAILab/LLMCompiler

值得讀：

```text
src/llm_compiler/
├ planner.py
├ output_parser.py
├ task_fetching_unit.py
└ llm_compiler.py
```

核心理由：真正具備 planner → dependency tasks → asynchronous scheduler，而不是只有 function calling demo。

尤其：

```text
task_fetching_unit.py
```

值得對照 Hermes future runtime：

```text
Task
├ idx
├ tool
├ args
├ dependencies
├ observation
└ is_join
```

與：

```text
_get_all_executable_tasks()
_run_task()
schedule()
aschedule()
```

## 2. LangGraph ToolNode

官方 docs：
https://docs.langchain.com/oss/python/langchain/tools

現在的 `ToolNode` 已處理：

```text
parallel tool execution
error handling
state injection
conditional routing
```

這很適合拿來比較「framework execution node」與「真正 compiler IR」的差別。

## 3. OpenAI Agents SDK

官方 docs：
- Guardrails: https://openai.github.io/openai-agents-js/guides/guardrails/
- Handoffs: https://openai.github.io/openai-agents-js/guides/handoffs/

重要實作語意：

```text
Handoff exposed as tool-like choice
Tool guardrail before/after function tool execution
isEnabled can control available handoffs
```

但 handoff 路徑與普通 function-tool execution pipeline 不完全相同，所以「所有 capability 都是相同 Tool ABI」仍不成立。

## 4. MCP

官方規格：
- Tools: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Schema: https://modelcontextprotocol.io/specification/2025-06-18/schema

最值得 Hermes 直接實作的事件：

```text
tools/list
notifications/tools/list_changed
```

讓 Capability Graph 成為 live graph。

---

# Papers

## Paper 1 — An LLM Compiler for Parallel Function Calling

- **Title:** An LLM Compiler for Parallel Function Calling
- **Authors:** Sehoon Kim, Suhong Moon, Ryan Tabrizi, Nicholas Lee, Michael W. Mahoney, Kurt Keutzer, Amir Gholami
- **Institution:** UC Berkeley / collaborators
- **Year:** 2023 preprint; ICML 2024 work
- **URL:** https://arxiv.org/abs/2312.04511
- **Code:** https://github.com/SqueezeAILab/LLMCompiler
- **Dataset / Eval:** multi-function calling benchmarks used in paper
- **Architecture:** Planner → Task Fetching Unit → Executor
- **Contribution:** 把 function calling 從 repeated sequential loop 提升成 dependency-aware parallel orchestration
- **Limitations:** Planner 產生的 dependency / argument bindings 仍受 LLM correctness 影響；production permission、transaction、distributed lock 並非完整解決
- **改變了什麼:** 證明 Agent tool-use runtime 可以像 compiler/scheduler，而不必永遠 ReAct 一步一思考

## Paper 2 — ReWOO: Decoupling Reasoning from Observations for Efficient Augmented Language Models

- **Authors:** Binfeng Xu, Zhiyuan Peng, Bowen Lei, Subhabrata Mukherjee, Yuchen Liu, Dongkuan Xu
- **Institution:** Microsoft Research / collaborators
- **Year:** 2023
- **URL:** https://arxiv.org/abs/2305.18323
- **Code:** paper/project implementations exist in ecosystem
- **Dataset:** HotpotQA, TriviaQA, GSM8K, StrategyQA, AQUA, ScienceQA, SOTUQA
- **Architecture:** Planner → Worker → Solver
- **Contribution:** planning 與 observations 解耦，降低 repeated prompt/tool interleaving
- **Limitations:** 預先計畫遇到高度動態 environment 時仍需 replan
- **改變了什麼:** 把「Plan first, execute later」正式帶進 tool-augmented LM runtime

## Paper 3 — Toolformer: Language Models Can Teach Themselves to Use Tools

- **Authors:** Timo Schick et al.
- **Institution:** Meta AI / collaborators
- **Year:** 2023
- **URL:** https://arxiv.org/abs/2302.04761
- **Code:** research implementations; original paper focuses on training method
- **Dataset / Tools:** calculator, QA, search, translation, calendar 等 API
- **Architecture:** self-supervised API-call annotation + LM training
- **Contribution:** 模型學習何時 call tool、call 哪個 tool、帶什麼 arguments、怎麼使用 result
- **Limitations:** 工具數量與 schema / environment dynamics 和現代 MCP ecosystem 不同
- **改變了什麼:** Tool use 從 prompt engineering 變成可學習能力

## Paper 4 — Gorilla: Large Language Model Connected with Massive APIs

- **Authors:** Shishir G. Patil, Tianjun Zhang, Xin Wang, Joseph E. Gonzalez
- **Institution:** UC Berkeley
- **Year:** 2023
- **URL:** https://arxiv.org/abs/2305.15334
- **Code / Data:** Gorilla project / APIBench
- **Dataset:** APIBench (HuggingFace, TorchHub, TensorHub APIs)
- **Architecture:** fine-tuned LLaMA + API doc retrieval
- **Contribution:** 大規模 API call generation、retrieval-aware documentation adaptation、減少 hallucinated API calls
- **Limitations:** 正確 API generation 不等於完整 multi-tool plan compilation
- **改變了什麼:** 將 Tool Retrieval / API Documentation 變成 tool calling correctness 的核心元件

## Paper 5 — MRKL Systems

- **Title:** MRKL Systems: A modular, neuro-symbolic architecture that combines large language models, external knowledge sources and discrete reasoning
- **Authors:** Ehud Karpas et al.
- **Year:** 2022
- **URL:** https://arxiv.org/abs/2205.00445
- **Architecture:** LM router + neural/discrete expert modules
- **Contribution:** 早期明確提出 LLM 應作為 modular system 的 routing/reasoning component，而不是所有能力都塞在模型內
- **Limitations:** 沒有現代 MCP dynamic discovery、typed plan IR、runtime policy/approval semantics
- **改變了什麼:** 奠定今日 Tool Router / Specialist Module architecture 的系統觀

---

# Framework Comparison

```text
MCP
強：dynamic tool discovery / schema / protocol interoperability
缺：global planner / dependency compiler / hard policy enforcement

OpenAI Agents SDK
強：tools / handoffs / guardrails / runtime orchestration
缺：通用 cross-provider typed plan IR

LangGraph
強：explicit state graph / ToolNode / conditional flow / persistence
缺：自動從大量 tools 編譯 optimal DAG 並不是核心標準能力

Google ADK
強：agent/tool runtime、sandbox/code execution、MCP integration、多 agent
缺：跨 framework capability semantics standardization

LLMCompiler
強：dependency plan + asynchronous parallel scheduler
缺：modern MCP permissions / trust / transactions / dynamic tool-list mutation

ReWOO
強：plan-observation decoupling / token efficiency
缺：dynamic environment 下的 continuous validity checking
```

---

# Unknown / Open Questions

## 1. 如何自動從 Tool Schema 推出 Preconditions / Effects？

JSON Schema 只描述 arguments structure：

```text
{ order_id: string }
```

它不會告訴 planner：

```text
refund_order requires order.status == PAID
refund_order changes status → REFUNDED
```

需要 documentation extraction、execution traces、static code analysis 或 learned action model。

## 2. 如何在動態 tool inventory 中維持 plan validity？

MCP server 可以：

```text
tools/list_changed
```

所以正在執行的 plan 可能突然遇到：

```text
Tool removed
Schema changed
Permission changed
Server unhealthy
```

需要 Plan Dependency Invalidation / partial recompile，而不是 full restart。

## 3. 如何讓 multi-tool plan 同時具備 ACID-like safety 與 agent flexibility？

例如：

```text
reserve flight
charge card
create calendar
send email
```

中間失敗時可能需要 compensation，而不是簡單 retry。

因此下一個深層節點可能需要：

```text
Saga / Compensation Graph
Transaction Boundary
Idempotency Key
Exactly-once-ish semantics
```

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Capability Registry
Capability Node
Dynamic Tool Inventory
Tool Schema Normalizer
Capability Graph
Capability Retriever
Plan Compiler
Plan IR
Plan Node
Dependency Edge
Dataflow Binding
Ready Queue
Join Barrier
Runtime Policy Gate
Tool Guardrail
Tool Trust Level
Tool Health
Retry Semantics
Idempotency Key
Compensation Action
Plan Invalidation
Partial Recompile
```

## 新增核心 Edges

```text
MCP Server
→ exposes
Tool Descriptor

Tool Descriptor
→ normalized into
Capability Node

Capability Node
→ participates in
Capability Graph

Goal
→ queries
Capability Graph

Tool Output Type
→ satisfies
Downstream Tool Input

Tool Effect
→ satisfies
Downstream Precondition

Dependency Edge
→ constrains
Scheduling

Completed Task
→ unlocks
Ready Task

Tool Annotation
→ informs
Risk Policy

Tool Annotation
≠
Security Enforcement

No Data Dependency
≠
Safe Parallel Execution

Tool Failure
→ triggers
Retry / Compensation / Replan

Tool List Change
→ invalidates
Plan Assumptions

Plan Compiler
→ emits
Typed Plan IR

Typed Plan IR
→ executed by
Scheduler
```

---

# 與歷史研究比較

前一輪已建立：

```text
World State
→ Affordance
→ Preconditions
→ Permission
→ Feasibility
→ Action
→ Predicted Effect
→ Observed Effect
```

本輪新增的是上層「多 action / 多 tool compiler」：

```text
Goal
↓
300 available capabilities
↓
Which subset?
↓
In what order?
↓
Which can run in parallel?
↓
Which output feeds which input?
↓
Which writes require confirmation?
↓
How to recover if one node fails?
```

所以兩輪接起來後變成：

```text
Goal
↓
Capability Graph
↓
Plan Compiler
↓
Plan DAG
↓
Action Preconditions
↓
Execution
↓
World Effect Verification
↓
Belief Revision
```

這使原先的 Agent Loop：

```text
Think → Tool → Observe → Think
```

逐漸還原成更完整 runtime：

```text
Goal
→ Discover Capabilities
→ Compile Plan
→ Validate
→ Schedule
→ Authorize
→ Execute
→ Verify
→ Patch State
→ Recompile if needed
```

---

# 下一輪研究

下一輪最值得直接進：

# **Distributed Tool Execution × Saga / Compensation × Idempotency × Exactly-Once-ish Agent Semantics**

因為本輪 Plan DAG 建起來後，最深的新問題變成：

```text
Tool A 成功
Tool B 成功
Tool C timeout
```

Agent 到底怎麼知道：

```text
C 沒執行？
C 已執行但 response lost？
C 執行一半？
```

以及：

```text
前面 A/B 要不要 rollback？
rollback 是否真的可能？
還是要執行 compensation action？
```

下一輪應比較：

```text
Database Transaction
vs
Saga Pattern
vs
Workflow Engine
vs
Agent Tool Runtime
```

並研究：

```text
Idempotency Key
Attempt ID
Operation Journal
Outbox / Inbox pattern
At-least-once
At-most-once
Exactly-once illusion
Compensating Transaction
Durable Execution
Checkpoint / Resume
```

可進一步追 Temporal、Durable Functions、LangGraph durable execution、ADK session/task runtime、MCP task support 與長任務工具 semantics。

---

# 本輪結束回答

- **缺哪一層：** Plan DAG → distributed side-effect-safe execution / transaction semantics。
- **哪個節點最淺：** automatic Tool Preconditions / Effects induction。
- **哪個概念仍只是名詞：** Unified Capability Graph ABI、Unified Agent Plan IR。
- **哪個系統最值得讀原始碼：** `SqueezeAILab/LLMCompiler/src/llm_compiler/`，尤其 `planner.py` 與 `task_fetching_unit.py`；下一輪再進 durable workflow runtime。
- **哪篇論文需追引用：** LLMCompiler；其次 ReWOO，因為兩者直接連到 plan compiler / scheduler genealogy。
- **哪個概念最適合視覺模擬：** Tool Capability Graph & Plan Compiler Lab。
- **哪個 Agent 架構最值得實作：** `Live Capability Registry + Typed Plan Compiler + Dependency Scheduler + Runtime Policy Gate + Effect Verifier`。

---

## 本輪核心結論

> AI Agent 擁有很多 Tools，不等於它真的擁有「能力系統」。完整 Tool Runtime 必須先把動態 MCP / functions / agents / computer tools 正規化成 Capability Graph，再由 Plan Compiler 將 goal 編譯成 typed dependency DAG；Scheduler 只執行 dependency 已滿足的 node，Policy Gate 決定能不能真的做，Verifier 確認外部世界是否得到預期效果。Tool selection、plan compilation、scheduling、execution、verification 是五個不同層次。當這五層接起來後，我們才真正從「LLM 會呼叫 API」走到「Agent 可以像 runtime/compiler 一樣可靠地組合能力」。