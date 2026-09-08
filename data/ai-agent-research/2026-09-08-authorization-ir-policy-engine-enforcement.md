# 【AI Agent × Multimodal Research Report】

時間：2026-09-08 21:51（Asia/Taipei）

主題：Authorization IR × Policy Engine × PDP/PEP × Cedar/OPA/Zanzibar × Agent Tool Enforcement

歷史比較：本輪接續前一輪「Agent Identity × Delegated Authority × Zero-Trust Agent Mesh」。前一輪解決「權力從哪裡來、如何逐跳縮權」；本輪不重複 identity/delegation，而是繼續追「自然語言任務如何轉成可機器驗證的授權決策，以及決策如何在 Tool/MCP/A2A 邊界真正被執行」。

---

## 本小時新發現

1. 2026-03 AWS 已將 Amazon Bedrock AgentCore Policy GA，核心架構是把 policy engine 放在 agent code 外，掛到 AgentCore Gateway，攔截每一次 agent→tool 呼叫後再決定 allow/deny。官方同時支援自然語言政策生成 Cedar，但生成後仍會經 schema validation 與 semantic analysis。
2. Cedar 最新文件（2026-08/09 更新）已明確寫出 AI agent acting-on-behalf-of user 的兩種建模方法：Agent 作 principal、user 放 context；或 User 作 principal、agent 放 context。這代表「代理誰」可成為正式 authorization request 的一部分，而不是只存在 prompt。
3. OPA 不只是一個 Rego evaluator：它可以把 policy query 編譯成低階 IR plan、Wasm，也支援 bundle distribution、decision logging 與 OpenTelemetry；因此 Policy Runtime 本身也可以有 compiler/runtime/observability 分層。
4. Cedar 原始碼的 `cedar-policy-core/src/authorizer.rs` 直接以 `Request + PolicySet + Entities → Response` 執行授權；`cedar-policy-symcc` 則把政策編譯進 SMT/formal verification 路線。這顯示「runtime decision」與「policy correctness proof」是兩條不同但可連接的管線。
5. 2026 的 Agent security 研究正在從 RBAC/單一 scope 轉向 task-aware、argument-aware、composition-aware authorization。OpenPort、ToolGuardian、Policy Algebra 等工作共同指向：授權不應只判斷「能不能叫這個工具」，還要判斷「這次 task 下，能不能用這組 arguments 對這個 resource 造成這個 effect」。

---

# 本小時最重要 5 個發現

## 1. Natural-language Intent ≠ Authorization Policy

### 概念
使用者說：

> 幫我把低於 1000 美元的退款自動處理，高於 1000 要人工確認。

這只是自然語言 intent，不應直接成為 enforcement input。

正確鏈應是：

```text
User Goal
↓
Task / Intent Parser
↓
Authorization IR
↓
Policy Compiler
↓
Cedar / Rego / Capability Constraints
↓
Policy Validation
↓
Policy Decision Point
↓
Policy Enforcement Point
```

### 為什麼重要
LLM 產生的 policy 仍可能過度寬鬆、條件翻譯錯誤、引用不存在欄位，或把 human-readable requirement 編譯成一個實際上 `ALLOW_ALL` 的 policy。

AWS AgentCore Policy 已把這點工程化：自然語言可以生成 Cedar，但 schema checks 必定執行，semantic validation 還可檢測 ALLOW_ALL / DENY_ALL / ineffective policies。

### 確認層級
- 官方資訊：AWS AgentCore Policy、Cedar docs。
- 工程推論：Hermes 應建立自己的 Authorization IR，避免把 vendor policy language 直接當 Agent planner output。

來源：
- https://aws.amazon.com/about-aws/whats-new/2026/03/policy-amazon-bedrock-agentcore-generally-available/
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-validation-overview.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-getting-started.html

---

## 2. Policy Decision Point (PDP) 與 Policy Enforcement Point (PEP) 必須分開

### 底層
PDP 回答：

```text
principal + action + resource + context
↓
POLICY EVALUATION
↓
ALLOW / DENY / OBLIGATIONS
```

PEP 則真正負責：

```text
Tool Call
↓
Intercept
↓
Ask PDP
↓
ALLOW → execute
DENY → block
```

如果只有 PDP 而沒有 PEP，Agent 還是可能繞過 policy engine 直接打 API。

### AgentCore system architecture

```text
Agent
↓
Tool Call
↓
AgentCore Gateway  ← PEP
↓
Policy Engine      ← PDP
↓
Cedar evaluation
↓
ALLOW / DENY
↓
Gateway executes or rejects tool
```

官方說明 Gateway 會攔截每次 tool invocation，且 default-deny、forbid-wins。

### Hermes 的推論
Hermes 應把 Enforcement Point 放在 `Action Router → Tool/MCP/GUI/API` 之前，不能依賴模型「自己遵守 policy」。

Knowledge edge：

```text
Authorization Policy
--evaluated by-->
PDP

Tool Invocation
--intercepted by-->
PEP

PDP Decision
--controls-->
PEP Execution
```

來源：
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-core-concepts.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-getting-started.html

---

## 3. Authorization Request 應是一個正式資料結構，而不是 prompt 片段

Cedar 的基本 request abstraction 是：

```text
principal
+ action
+ resource
+ context
```

Cedar 官方對 AI agents acting on behalf of users 還提出：

### Pattern A
```text
principal = Agent
context.onBehalfOf = User
```

適合：「Agent 自己的 permission 也重要」。

### Pattern B
```text
principal = User
context.viaAgent = Agent
```

適合：「主要沿用 user permission，但限制哪些 agent 可以代表 user」。

這帶來一個 Hermes Authorization IR：

```json
{
  "principal": {
    "user": "user:alice",
    "agent": "agent:hermes"
  },
  "action": "gmail.send",
  "resource": "mailbox:alice",
  "task": "send-approved-report",
  "arguments": {
    "recipient": "bob@example.com",
    "attachments": ["report-v3.pdf"]
  },
  "risk": "outward_write",
  "delegation": {
    "root": "user:alice",
    "depth": 0
  },
  "evidence": {
    "user_intent_ref": "..."
  }
}
```

這個 IR 才應被翻譯成 Cedar/Rego，或直接進自家 PDP。

### 限制
Cedar 的 principal/action/resource/context 是 authorization-domain abstraction；Hermes 還需要 task ID、semantic effect ID、transaction ID、provenance 等 Agent-specific 欄位，所以不能直接把 Cedar request 當完整 Agent IR。

來源：
- https://docs.cedarpolicy.com/policies/syntax-policy.html
- https://docs.cedarpolicy.com/bestpractices/bp-using-the-context.html

---

## 4. Cedar、OPA、Zanzibar 解決的層並不相同

### Cedar
核心是：

```text
Request
+ PolicySet
+ Entities
↓
Authorizer
↓
Allow / Deny
```

特徵：formal semantics、schema validation、permit/forbid、forbid-wins、implicit deny。

原始碼：

```text
cedar-policy/cedar
├ cedar-policy-core/
│  └ src/authorizer.rs
├ cedar-policy/
│  └ src/ffi/is_authorized.rs
├ cedar-policy-cli/
│  └ src/command/authorize.rs
└ cedar-policy-symcc/
   └ src/symcc/verifier.rs
```

`Authorizer::is_authorized` 明確接受 Request、PolicySet、Entities。

### OPA
核心是 general policy evaluation：

```text
input JSON
+ data
+ Rego
↓
prepared query / evaluator
↓
JSON decision
```

並可：

```text
Rego
→ IR Plan
→ Wasm
→ embedded PEP/runtime
```

值得看的原始碼：

```text
open-policy-agent/opa
├ v1/rego/rego.go
├ v1/rego/compile/compile.go
├ v1/sdk/opa.go
└ cmd/eval.go
```

### Zanzibar
核心不是 agent policy language，而是大規模 relationship-based authorization / ACL storage + evaluation consistency。

典型 abstraction：

```text
User
--member of-->
Group
--viewer of-->
Document
```

重點：全球規模、external consistency、causal ordering、低延遲 authorization checks。

### 結論

```text
Cedar
≈ fine-grained authorization language + engine

OPA
≈ general policy-as-code engine / compiler / runtime

Zanzibar
≈ relationship graph + globally consistent authorization system
```

三者可以組合，而不是互斥。

例如 Hermes：

```text
Authorization IR
├ relationship facts → Zanzibar-like store
├ task/tool policy → Cedar / OPA
└ runtime decision → PDP
```

來源：
- https://github.com/cedar-policy/cedar
- https://www.openpolicyagent.org/docs/integration
- https://www.openpolicyagent.org/docs/ir
- https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/

---

## 5. Agent Authorization 必須從 Tool-level 升級成 Effect-level

只判斷：

```text
Can agent call send_email?
```

是不夠的。

真正需要：

```text
Task Intent
↓
Tool
↓
Arguments
↓
Target Resource
↓
Expected Effect
↓
Risk / Budget / Reversibility
↓
Policy Decision
```

例如：

```text
send_email
```

可能有：

```text
Recipient = internal teammate
→ ALLOW

Recipient = external domain
→ APPROVAL

Attachment contains secret
→ DENY
```

2026 ToolGuardian 強調 runtime authorization 需要 capabilities、effects、task context 與 multi-tool composition；OpenPort 也把 least privilege、ABAC constraints、risk-gated writes、preflight impact binding、idempotency 與 State Witness 放進 governance protocol。

因此 Hermes 的 Authorization IR 不只要描述 API scope，還要描述：

```text
Effect
Risk
Reversibility
Data Sensitivity
Recipient / Destination
Budget
Provenance
Transaction
```

來源：
- https://arxiv.org/abs/2607.21835
- https://arxiv.org/abs/2602.20196
- https://arxiv.org/abs/2608.16402

---

# Architecture Breakdown

## Hermes Authorization Runtime v1

```text
User Goal
↓
Goal Parser
↓
Task Intent Graph
↓
Authorization IR Builder
├ Principal
├ Agent identity
├ On-behalf-of user
├ Action
├ Resource
├ Arguments
├ Effect
├ Risk
├ Budget
├ Reversibility
├ Delegation scope
└ Provenance
↓
Policy Compiler
├ Cedar
├ Rego
├ Capability constraints
└ Relationship query
↓
Static Validation
├ schema
├ type
├ unsupported field
└ policy syntax
↓
Semantic Analysis
├ allow-all
├ deny-all
├ privilege escalation
├ contradictory condition
└ unreachable rule
↓
Policy Store
↓
Runtime Request
↓
PEP: Action Router interception
↓
PDP
├ identity facts
├ relationship facts
├ current context
├ task policy
└ global policy
↓
Decision
├ ALLOW
├ DENY
├ APPROVAL_REQUIRED
└ NEED_MORE_EVIDENCE
↓
Transaction / Approval Gate
↓
Tool / MCP / API / GUI
↓
Environment
↓
Postcondition Verification
↓
Decision + Effect Log
```

### System architecture 本輪深入拆解：Amazon Bedrock AgentCore Policy

已確認架構：

```text
Agent
↓
AgentCore Gateway
↓
Gateway tool schema
↓ generates
Cedar Schema
↓
Policy Engine
↓
Cedar evaluation
↓
allow/deny
↓
Target Tool
```

關鍵點：
1. policy 在 agent code 外；
2. tool definition 會映射成 Cedar action/schema；
3. 每次 invocation 都被 gateway 攔截；
4. default deny；
5. forbid wins；
6. decision 可記錄到 CloudWatch；
7. policy 可以先 LOG_ONLY / validation 再 ENFORCE。

這是一個可直接對照 Hermes Action Router 的 production architecture。

---

# Bottom-Level Logic

## 一次 Tool Call 如何變成 Authorization Decision

假設模型產生：

```json
{
  "tool": "process_refund",
  "arguments": {
    "order_id": "O-918",
    "amount": 1200
  }
}
```

不要直接 execute。

底層流程：

```text
1. Tool call parsed
2. Resolve tool schema
3. Resolve authenticated principal
4. Resolve on-behalf-of user
5. Resolve target resource
6. Extract arguments
7. Derive semantic effect = financial_refund
8. Attach current task scope
9. Attach delegation constraints
10. Attach risk / reversibility
11. Build Authorization IR
12. Convert to engine request
13. PDP loads policies + entities/data
14. Evaluate permit rules
15. Evaluate forbid rules
16. Compute final decision
17. PEP enforces decision
18. Execute only if allowed
19. Record decision_id + effect_id
20. Verify postcondition
```

### Cedar 底層模型

```text
Request(principal, action, resource, context)
+
PolicySet
+
Entities
↓
Policy matching
↓
permit matches?
forbid matches?
↓
Decision
```

核心語意：

```text
ALLOW
iff
≥1 permit matches
AND
0 forbid matches
```

否則 deny。

### OPA 底層模型

```text
input
+
data
+
compiled Rego query
↓
Evaluator
↓
result JSON
```

為降低 runtime latency，可先：

```text
Rego
↓ parse/compile
Prepared Query
↓
per-request input
↓
Eval
```

OPA 官方說明 prepared query 可以避免每次 request 重複 parsing/compilation。

---

# Authorization IR 建議格式

Hermes 不應直接把 Cedar/Rego 當內部 canonical format，建議先有 vendor-neutral IR：

```json
{
  "subject": {
    "root_principal": "user:alice",
    "agent": "agent:hermes",
    "delegation_chain": []
  },
  "operation": {
    "tool": "gmail.send",
    "action": "send",
    "resource": "mailbox:alice"
  },
  "arguments": {
    "recipient_domain": "example.com",
    "attachment_ids": ["artifact:report-v3"]
  },
  "effect": {
    "class": "external_write",
    "reversibility": "compensable"
  },
  "task": {
    "task_id": "T-19",
    "intent_id": "I-3"
  },
  "constraints": {
    "max_external_recipients": 1,
    "approval_required": true,
    "expires_at": "..."
  },
  "context": {
    "risk": "medium",
    "data_sensitivity": "internal",
    "device_trust": "managed"
  }
}
```

然後 Adapter：

```text
Authorization IR
├→ Cedar Request + Entities
├→ OPA input JSON
├→ Zanzibar relationship check(s)
└→ Capability token attenuation check
```

這是本輪最重要的建模輸出。

---

# Visual Simulation Idea

## Policy Decision X-Ray

### UI
左側：Agent 產生的 action

```text
Hermes
└ send_email
   ├ recipient: external@example.com
   ├ attachment: report.pdf
   └ effect: external_write
```

中間：Authorization IR

```text
Principal      Alice via Hermes
Action         gmail.send
Resource       mailbox/alice
Task           send-report
Risk           medium
Reversible     compensable
Data           internal
Delegation     depth=0
```

右側：Policy Engines

```text
Cedar
├ PERMIT internal mail
├ FORBID secret → external
└ result: ALLOW

OPA
├ budget check
├ device posture
└ result: ALLOW

Relationship
└ Alice ownerOf mailbox
   TRUE
```

最終：

```text
FINAL DECISION
ALLOW
```

### Failure Injection
切換：

```text
Recipient → external
Attachment → secret
```

立即顯示：

```text
Cedar FORBID matched
↓
DENY
```

再切換：

```text
amount 500 → 1500
```

顯示：

```text
Task Policy
refund < 1000
↓
condition failed
↓
APPROVAL_REQUIRED
```

### 教學價值
讓使用者直接看見：

```text
Model proposed action
≠
Authorized action
≠
Executed action
```

---

# Code / GitHub

## cedar-policy/cedar

值得看的目錄/核心檔案：

```text
cedar-policy-core/src/authorizer.rs
```
- runtime authorization semantics；`Authorizer::is_authorized`。

```text
cedar-policy/src/ffi/is_authorized.rs
```
- FFI-facing authorization call path。

```text
cedar-policy-cli/src/command/authorize.rs
```
- CLI request→authorizer integration。

```text
cedar-policy-symcc/src/symcc/verifier.rs
```
- symbolic compiler / formal verification 路線。

```text
cedar-policy-symcc/README.md
```
- counterexample / always-allows / always-denies 等 symbolic reasoning。

## open-policy-agent/opa

值得看的：

```text
v1/rego/rego.go
```
- query construction / prepared evaluation。

```text
v1/rego/compile/compile.go
```
- Rego compilation。

```text
v1/sdk/opa.go
```
- embeddable runtime SDK。

```text
cmd/eval.go
```
- CLI eval execution path。

OPA 官方還公開 IR schema；`opa build -t plan` 可輸出 policy evaluation plan，`-t wasm` 可編譯成 Wasm。

---

# Papers / Systems

## 1. Zanzibar: Google’s Consistent, Global Authorization System
Authors: Ruoming Pang, Ramon Caceres, Mike Burrows, Zhifeng Chen, Pratik Dave, Nathan Germer, Alexander Golynski, Kevin Graney, Nina Kang, Lea Kissner, Jeffrey L. Korn, Abhishek Parmar, Christina D. Richards, Mengzhi Wang
Institution: Google
Year: 2019
URL: https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/
Architecture: relationship-based authorization + globally consistent ACL store/evaluator
Contribution: 支援 Google 大量服務的全球一致 authorization，兼顧 causal ordering 與低延遲。
Limitations for Agent OS: 不直接描述 task intent、tool arguments、reversibility、LLM provenance；需要與 Agent policy layer 結合。

## 2. ToolGuardian: Declarative Security for AI Agent-Tool Interactions
Authors: Arun Ravindran, Saurabh Deochake
Year: 2026
URL: https://arxiv.org/abs/2607.21835
Architecture: tool characterization → declarative ASP policy → task-aware runtime authorization
Contribution: 把 tool description、syscall/observed effect/source evidence 轉成 structured facts，再進 deterministic policy reasoning；強調 composition/conformance。
Dataset/Evaluation: 16 MCP-style tools（含 malicious variants）、20 runtime scenarios。
Limitations: 規模仍偏研究型；ASP policy 與 production identity/delegation infrastructure 仍需整合。
改變了什麼：authorization 從 tool-name whitelist 推進到 task/effect/composition-aware。

## 3. OpenPort Protocol: A Security Governance Specification for AI Agent Tool Access
Authors: Genliang Zhu, Chu Wang, Ziyuan Wang, Zhida Li, Qiang Li
Year: 2026
URL: https://arxiv.org/abs/2602.20196
Architecture: governance gateway + scoped authorization + ABAC constraints + risk-gated writes + preflight/state witness
Contribution: 把 idempotency、review、time-bound auto execution、TOCTOU state revalidation 納入 agent-tool protocol。
Limitations: 為新 protocol/specification，生態與互通性仍需觀察。
改變了什麼：把 policy decision 和 transaction/verification 接起來。

## 4. A Policy Algebra for Trust-Preserving Agentic AI Execution
Authors: Bhaskar Tripathi, Anurag Kumar, Ramendra Kumar, Bhavesh Gadhe
Year: 2026
URL: https://arxiv.org/abs/2608.16402
Architecture: identity/profile/tool/data/memory/budget/artifact/approval/audit constraints composition
Contribution: 把可靠性定義成 execution path property，而不是只看最終 task success；限制經 joins/intersections/budget narrowing/approval inheritance 組合。
Limitations: 仍屬新研究，需更多獨立 replication。
改變了什麼：把 authorization 從單點 allow/deny 推到整條 agent trajectory。

## 5. Separating Capability from Permission: A Governance Framework for Agentic AI Autonomy Levels
Authors: Haining Zheng, Qian Dong, Rodolfo K. Depena, Jonathan D. Bhatia, Feng Xiao, Peng Xu
Year: 2026
URL: https://arxiv.org/abs/2607.23438
Contribution: 明確區分 Autonomous Capability Levels 與 Allowed Autonomy Levels。
對 Hermes 的意義：模型「會做」不能等同 Runtime「允許做」。

---

# 已確認事實 / 工程實作 / 推論 / 假說

## 已確認官方資訊
- AgentCore Policy 在 2026-03 GA，policy engine 位於 agent code 外並掛到 gateway。
- Cedar 使用 principal/action/resource/context，default-deny/forbid-wins 語意可用於 fine-grained auth。
- Cedar docs 已有 agent-on-behalf-of-user modeling patterns。
- OPA 能使用 prepared query，也能編譯 Rego 至 IR/Wasm。
- Zanzibar 是大規模一致 authorization system，不是 Agent planning framework。

## 已確認工程實作
- Cedar `Authorizer::is_authorized` 接 Request/PolicySet/Entities。
- OPA `v1/rego/rego.go` 與 SDK 有 prepared evaluation execution path。

## 合理工程推論
- Hermes 應建立 vendor-neutral Authorization IR，再 adapter 到 Cedar/OPA/Zanzibar/capability constraints。
- Authorization PEP 最適合置於 Action Router 和真實 tool execution 之間。
- Effect-level policy 比 tool-name allowlist 更適合 agent runtime。

## 尚未驗證假說
- 一個統一 Authorization IR 能否足夠精準覆蓋 GUI action、MCP、A2A、API、Code execution，需要 prototype 與 conflict analysis。
- Cedar + Zanzibar-like relationship store + capability attenuation 是否會比單一 OPA policy stack 更容易維護，仍需實驗。

---

# Unknown / Open Questions

## 1. Authorization IR 的 canonical schema 應該是什麼？
需決定：

```text
principal/action/resource/context
```
是否足夠，或必須把：

```text
task intent
effect
reversibility
provenance
budget
delegation chain
transaction ID
expected postcondition
```
提升為 first-class fields。

## 2. 多 Policy Engine 決策如何合成？
例如：

```text
Cedar = ALLOW
OPA = DENY
Relationship check = TRUE
Human approval = UNKNOWN
```

Hermes 需要 deterministic decision algebra，而不是讓 LLM決定誰優先。

## 3. Policy TOCTOU 如何處理？
授權時 resource state 是 v10，真正 execution 時已成 v11；尤其金融、檔案分享、跨 Agent delegation 需要把 precondition/effect witness 與 transaction runtime 接起來。

---

# 下一輪研究

下一輪優先研究：

## **Context Engineering × Prompt Assembly × Attention Budget × Memory Selection Runtime**

原因：目前 Agent OS 從 Action 往外的 Permission/Transaction/Verification/Distributed layers 已建立很深；但從 UI 往 Model 的一條核心鏈仍缺少非常底層的「Context Compiler」。

下一輪將追：

```text
User Message
↓
Conversation State
↓
System Instructions
↓
Tool Schemas
↓
Retrieved Memory
↓
RAG Evidence
↓
Observation
↓
Token Budgeting
↓
Priority / Truncation
↓
Prompt / Context Assembly
↓
Tokenizer
↓
Model Prefill
```

核心問題：
- Context Window 裡到底塞了什麼？
- Tool schema 會吃掉多少 token budget？
- Memory/RAG/Agent history 衝突時誰優先？
- truncation 發生在哪層？
- lost-in-the-middle 如何影響 Agent？
- prompt injection 如何穿越 retrieved context？
- context compression / summarization 的 failure mode 是什麼？

---

# Knowledge Graph 新增 Node / Edge

新增 Nodes：

```text
Authorization Runtime
├ Authorization IR
├ Policy Compiler
├ Policy Validator
├ Policy Decision Point (PDP)
├ Policy Enforcement Point (PEP)
├ Decision Log
└ Policy Version

Authorization Request
├ Principal
├ On-Behalf-Of Principal
├ Action
├ Resource
├ Context
├ Arguments
├ Semantic Effect
└ Task Scope

Policy Model
├ Cedar
├ Rego / OPA
├ Relationship-Based Authorization
└ Capability Constraint

Decision Semantics
├ Permit
├ Forbid
├ Default Deny
├ Approval Required
└ Need More Evidence
```

新增 Edges：

```text
Natural Language Requirement
--compiled into-->
Authorization IR

Authorization IR
--translated to-->
Formal Policy

Formal Policy
--validated by-->
Schema / Semantic Analyzer

Tool Call
--intercepted by-->
PEP

PEP
--queries-->
PDP

PDP
--evaluates-->
Policy + Identity + Resource + Context

PDP Decision
--controls-->
Tool Execution

Relationship Store
--provides facts to-->
PDP

Decision Log
--feeds-->
Audit / Verification / Training Data
```

---

# 本輪結束檢查

缺哪一層：Context Compiler / Context Budgeting 還沒有拆到底層。

哪個節點最淺：Authorization IR canonical schema；目前是工程模型，還沒有跨 Cedar/OPA/MCP/A2A 的實證 prototype。

哪個概念仍只是名詞：Policy composition algebra，在多個 PDP / human approval / transaction gate 同時存在時仍未完全形式化。

哪個系統值得讀原始碼：`cedar-policy/cedar` 的 `authorizer.rs` + `cedar-policy-symcc`，以及 `open-policy-agent/opa` 的 Rego compiler / IR / prepared query path。

哪篇論文需追引用：Zanzibar（relationship-based auth 基礎）與 2026 ToolGuardian/OpenPort/Policy Algebra 的後續引用與 replication。

哪個概念最適合視覺模擬：Policy Decision X-Ray（Action → Authorization IR → PDP → matched rules → PEP → effect）。

哪個 Agent 架構最值得實作：Hermes 單一 Agent + deterministic Authorization Runtime，而不是再新增安全 Agent。安全 Agent 可以提供 risk analysis，但最終 enforcement 必須由非模型 PEP/PDP 執行。

本輪核心結論：

> 模型提出「想做什麼」，Authorization IR 精確描述「這次到底要做什麼」，Policy Engine 決定「是否允許」，Enforcement Point 保證「不允許就真的做不到」。可靠 Agent 的安全邊界必須落在模型之外。