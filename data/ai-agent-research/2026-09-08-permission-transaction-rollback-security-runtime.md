# AI Agent × Multimodal Research Report

時間：2026-09-08 16:55（Asia/Taipei）

## 本輪定位

本輪接續既有研究：Multimodal Runtime → Fusion → Cross-Attention Memory Topology → Computer Agent Perception/Grounding/Action → World State/Verification Runtime。本輪不重複上述機制，向下補齊可靠 Agent OS 尚缺的 **Permission × Transaction × Rollback × Security Boundary**。

核心問題：當 Agent 已經能規劃、呼叫工具、操作 GUI、驗證結果之後，誰決定「這個副作用可以真的發生」？如果一個多步驟任務中途失敗，Runtime 如何避免重複付款、重寄郵件、復活已消耗權限，或把 checkpoint restore 誤當成真正世界 rollback？

---

## 本小時新發現

### 新架構：Tool Approval 是 Runtime interruption，不只是 prompt

OpenAI Agents SDK 的 HITL flow 顯示，敏感工具可宣告 `needs_approval`。模型產生 tool call 後，Runner 先解析參數，再檢查 approval rule；若需要批准則不執行，而是將 pending approval 寫入 RunState，暫停整個 run。批准或拒絕後再從原 RunState 繼續。這個 approval surface 甚至跨 handoff 與 nested agent-as-tool。

因此：

```text
Model proposes Action
↓
Runtime parses args
↓
Approval Policy
├ ALLOW → Execute
├ DENY → Return rejection observation
└ REQUIRE_APPROVAL → Persist RunState → Pause
```

### 新架構：Semantic Transaction

Cordon（2026）指出 per-call guardrail 不足以處理跨多工具、多步驟的 task-level side effects。它提出 semantic transaction：將 tool intents、result lineage、reversible local state、staged external effects、delegated authority、audit metadata 放進同一個 task-scoped execution boundary；外部不可逆副作用先進 effect outbox，整體流程驗證通過才 release/commit。

### 新攻擊：Semantic Rollback Attack

ACRFence（2026）指出 checkpoint restore 有一個 Agent 特有問題：LLM restore 後可能重新生成「語意相同但參數略不同」的請求，例如新的 transaction/reference ID。傳統 idempotency 假設「retry 與原 request 相同」會失效，可能造成 Action Replay 或 Authority Resurrection。

### 新 Security Runtime：Tool-call boundary enforcement

ClawGuard（2026）將 indirect prompt injection 的防線從模型 alignment 移到 deterministic runtime boundary：從使用者目標導出 task-specific access constraints，在每個外部 tool call 真正產生副作用前做 enforcement。論文涵蓋 web/local content injection、MCP server injection、skill file injection。

### MCP Authorization 正在進入 enterprise identity layer

MCP 2026-07-28 authorization 更接近標準 OAuth/OIDC 部署，並強化 issuer validation；Enterprise-Managed Authorization extension 已於 2026-06-18 標示 stable，用組織 IdP 中央管理 MCP server access。

---

# 本小時最重要 5 個發現

## 1. Permission、Approval、Authorization 是三個不同層

```text
Authorization
= 身分目前擁有哪些 capability / scope

Permission Policy
= 此 task / state 下是否允許使用該 capability

Approval
= 某次高風險 action 是否需要人或 policy engine 額外同意
```

完整流程應是：

```text
Intent
↓
Tool Selection
↓
Arguments
↓
Identity / Credential Resolution
↓
Authorization Scope Check
↓
Task Permission Policy
↓
Risk Classification
↓
Approval Gate
↓
Precondition Verification
↓
Execution
```

因此「OAuth 成功」絕不等於「Agent 可以自由呼叫所有工具」。OAuth 只回答 identity / scopes；runtime 還需要 task-level policy。

---

## 2. Checkpoint rollback ≠ world rollback

Agent Runtime 很容易出現錯誤直覺：

```text
restore checkpoint S3
→ 世界也回到 S3
```

實際上：

```text
Agent State rollback
≠
External Side Effect rollback
```

例如：

```text
S1 建立付款
S2 payment API 成功
S3 Agent crash
↓
restore S1
↓
LLM 重新生成付款 action
↓
第二次付款
```

如果重試時 transaction ID 不同，server-side 傳統 idempotency key 也可能無法識別語意重播。ACRFence 將此類問題稱為 semantic rollback attack。

所以 checkpoint 必須額外保存：

```text
Irreversible Effect Ledger
├ effect semantic identity
├ tool/server identity
├ authority consumed
├ idempotency metadata
├ commit status
└ replay/fork policy
```

---

## 3. Agent 需要 Transaction Manager，不只是 Tool Executor

傳統 tool runtime：

```text
Tool Call
→ Execute
→ Tool Result
```

可靠 agent runtime 應升級為：

```text
Task
↓
Begin Semantic Transaction
↓
Intent Ledger
↓
Reversible changes → Shadow State
Irreversible outward effects → Effect Outbox
↓
Cross-step Validation
↓
Commit Gate
├ COMMIT → release outward effects
├ ABORT → discard staged state
└ COMPENSATE → execute compensating actions
```

這使 transaction 成為 task-level control plane，而非每個 API 自己獨立成功就算完成。

---

## 4. Rollback 必須先對 action 做 reversibility classification

2026 的 Revisable by Design 將 action 分為：

```text
Idempotent
Reversible
Compensable
Irreversible
```

這個分類非常適合加入 Agent OS：

```text
Read file          → Idempotent
Edit local draft   → Reversible
Send email         → Compensable? 通常只能另寄更正，不能真正 undo
Wire transfer      → Irreversible / domain dependent
Delete temp file   → Reversible only if trash/versioning exists
```

因此 Retry Policy 不應只有：

```text
error → retry
```

而應：

```text
error
↓
classify previous side effect
├ idempotent → retry
├ reversible → rollback + retry
├ compensable → compensate + replan
└ irreversible → stop / escalate / fork recovery
```

---

## 5. Prompt Injection 的真正危險點是「資料跨過 authority boundary」

Indirect prompt injection 本身只是惡意文字。真正造成 damage 的路徑是：

```text
Untrusted Content
↓
Model Context
↓
Model generates Tool Call
↓
Runtime grants real authority
↓
External Side Effect
```

所以 security architecture 應把 trust label 跟著資料 lineage 傳播：

```text
Web Page [UNTRUSTED]
MCP Result [SERVER_TRUST_LEVEL]
User Goal [AUTHORIZED_INTENT]
Memory [PERSISTED / POSSIBLY_POISONED]
```

然後 tool boundary 檢查：

```text
Proposed Action
+
Data Provenance
+
User Goal Constraints
+
Authority Scope
↓
Policy Engine
↓
ALLOW / DENY / REQUIRE_APPROVAL
```

這比單純叫模型「不要被 prompt injection 騙」更可審計。

---

# Architecture Breakdown

## Secure Transactional Agent Runtime

```text
User Goal
↓
Goal / Constraint Compiler
↓
Task Authority Envelope
├ allowed tools
├ allowed resources
├ allowed scopes
├ max spend / write scope
└ approval rules
↓
Planner
↓
Proposed Action
↓
Action Classifier
├ read-only
├ idempotent
├ reversible
├ compensable
└ irreversible
↓
Security Policy Engine
├ provenance check
├ prompt-injection boundary
├ authorization scopes
├ least privilege
└ task constraint check
↓
Approval Gate
↓
Precondition Verifier
↓
Transaction Manager
├ Intent Ledger
├ Shadow State
├ Effect Outbox
├ Authority Ledger
└ Recovery Metadata
↓
Tool / MCP / GUI Executor
↓
Environment
↓
Postcondition Verifier
↓
Commit Controller
├ COMMIT
├ RETRY
├ COMPENSATE
├ ABORT
└ ESCALATE
↓
Checkpoint
```

這一層把上一輪的 Verification Runtime 接到真正的 side-effect safety。

---

# Bottom-Level Logic

## 一次高風險 Tool Call 真正應怎麼跑

假設模型產生：

```json
{
  "tool": "send_email",
  "arguments": {
    "to": "alice@example.com",
    "attachment": "budget.xlsx"
  }
}
```

Runtime 不應立刻 execute。

```text
1 Parse JSON
2 Validate Schema
3 Resolve Tool Identity
4 Resolve Credential Identity
5 Check OAuth / MCP scope
6 Compare against Task Authority Envelope
7 Classify side effect = outward write
8 Compute risk
9 Check provenance of attachment and recipient
10 Check preconditions
11 Approval decision
12 Stage intent in transaction
13 Execute / release effect
14 Capture tool result
15 Verify external state
16 Record effect semantic identity
17 Commit checkpoint
```

如果在 15 發現 UNKNOWN：

```text
不要盲目 retry
↓
先 probe external state
↓
確認第一次是否其實已成功
```

這一步是避免 duplicate side effect 的核心。

---

# Visual Simulation Idea

## Permission & Transaction X-Ray

Hermes Console 可新增一個視覺模擬頁：

```text
Goal:「寄出最新預算表給 Alice」

[Authority Envelope]
✓ Gmail.send
✓ Drive.read /Reports
✕ Drive.delete
max recipients = 1
requires approval for external send

        ↓

[Proposed Action]
send_email(...)

        ↓

[Risk Classifier]
OUTWARD WRITE
COMPENSABLE / NOT REVERSIBLE

        ↓

[Approval Gate]
WAITING

        ↓ approve

[Transaction]
Intent Ledger   ✓
Effect Outbox   queued
Preconditions   ✓ attachment latest

        ↓

[Commit]
Effect released

        ↓

[Verification]
API says sent = TRUE
Message-ID captured

        ↓

COMMITTED
```

Failure Injection 模式：

```text
Network timeout after send
```

使用者可看到錯誤做法：

```text
TIMEOUT → RETRY → DUPLICATE EMAIL
```

與正確做法：

```text
TIMEOUT
→ status UNKNOWN
→ Evidence Probe
→ search by semantic/idempotency identity
→ found sent message
→ mark COMMITTED
```

這可以直接把「Agent retry 為什麼危險」視覺化。

---

# Code / GitHub

## OpenAI Agents SDK

值得追：human-in-the-loop / RunState approval flow。

重點機制：
- `needs_approval`
- pending `interruptions`
- `state.approve(...)` / `state.reject(...)`
- serialized RunState
- hosted MCP approvals
- shell / patch approvals

特別重要：approval 是 run-wide；nested agent / handoff 內的 sensitive tool 仍會浮到外層 run 處理。

## ClawGuard

Repo：`Claw-Guard/ClawGuard`

值得看的目錄：

```text
clawguard/
config/
openclaw-plugin/
main.py
```

研究重點不是 blacklist，而是論文版本所描述的 deterministic tool-boundary rule enforcement：使用者確認的 task-specific constraint 在真正副作用前攔截 action。

## MCP Authorization

MCP 2026-07-28：
- authorization 更貼近 OAuth/OIDC
- authorization server issuer (`iss`) 應回傳並由 client 驗證
- Enterprise-Managed Authorization extension 已 stable

Hermes 應把 MCP server identity、tool identity、scope、approval policy 分開保存，不能只顯示「Connected」。

---

# Papers

## Cordon: Semantic Transactions for Tool-Using LLM Agents

Authors: Zheng Chen, Hanqing Liu, Duling Xu, Dong Dong, Jialin Li, Bangzheng Pu, Jidong Zhai  
Year: 2026

核心貢獻：把 per-tool RPC 提升成 task-scoped semantic transaction，加入 shadow state、effect outbox、result lineage、authority、audit/recovery metadata，再於 commit 前做 composed-flow validation。

Knowledge Graph：

```text
Agent Runtime
→ Transaction Manager
→ Semantic Transaction
→ Effect Outbox
→ Commit / Recovery
```

限制：研究結果是特定 workload / prototype 的系統實驗，尚不能假定所有 SaaS / GUI action 都可 staging。

## ACRFence: Preventing Semantic Rollback Attacks in Agent Checkpoint-Restore

Authors: Yusheng Zheng, Yiwei Yang, Wei Zhang, Andi Quinn  
Year: 2026

核心貢獻：指出 LLM restore 後重新生成 request 會突破傳統 request-level idempotency，提出 Action Replay、Authority Resurrection 與 replay-or-fork enforcement。

Knowledge Graph：

```text
Checkpoint
→ Semantic Rollback
→ Irreversible Effect Ledger
→ Replay / Fork Policy
```

## ClawGuard: A Runtime Security Framework for Tool-Augmented LLM Agents Against Indirect Prompt Injection

Authors: Wei Zhao, Zhe Li, Peixin Zhang, Jun Sun  
Year: 2026

核心貢獻：把安全 enforcement 移至每個 tool-call boundary，依 user objective 導出 task-specific access constraints；涵蓋 web/local、MCP、skill injection channel。

Knowledge Graph：

```text
Prompt Injection
→ Tool Boundary
→ Policy Enforcement
→ Side-Effect Prevention
```

## Revisable by Design: A Theory of Streaming LLM Agent Execution

Authors: Zhiyuan Zhai, Ming Li, Xin Wang  
Year: 2026

核心貢獻：action reversibility taxonomy：Idempotent / Reversible / Compensable / Irreversible，並研究 mid-execution revision / rollback 的理論限制。

Knowledge Graph：

```text
Action
→ Reversibility Class
→ Recovery Strategy
```

---

# Knowledge Graph 新增 Node / Edge

```text
Agent Security Runtime
├ Identity
├ Authorization
├ Permission Policy
├ Risk Classifier
├ Approval Gate
├ Least Privilege
├ Provenance Policy
└ Tool Boundary Enforcement
```

```text
Transaction Runtime
├ Semantic Transaction
├ Intent Ledger
├ Effect Outbox
├ Shadow State
├ Authority Ledger
├ Commit Gate
├ Compensation
└ Recovery Metadata
```

```text
Action Reversibility
├ Idempotent
├ Reversible
├ Compensable
└ Irreversible
```

```text
Rollback Safety
├ Checkpoint Restore
├ Semantic Effect Identity
├ Action Replay
├ Authority Resurrection
└ Replay-or-Fork
```

新增核心 edges：

```text
User Goal
--defines-->
Task Authority Envelope

Task Authority Envelope
--constrains-->
Tool Call

Tool Call
--classified by-->
Reversibility Class

Untrusted Observation
--carries-->
Provenance

Provenance + Authority + Intent
--evaluated by-->
Security Policy Engine

Approved Intent
--enters-->
Semantic Transaction

Semantic Transaction
--stages-->
External Effect

Verification
--controls-->
Commit / Compensate / Abort

Checkpoint Restore
--must consult-->
Irreversible Effect Ledger
```

目前 AI Agent OS 主幹可更新為：

```text
User Goal
↓
Context / Memory
↓
Reasoning / Planning
↓
Proposed Action
↓
Permission / Security
↓
Transaction
↓
Tool / MCP / GUI
↓
Environment
↓
Verification
↓
Commit / Rollback / Compensate
↓
State / Memory Update
```

---

# Unknown / Open Questions

1. **Semantic Effect Identity 如何穩定生成？** 不能只靠 model-generated idempotency key；需要把 tool identity、resource、operation semantics、arguments normalization、authority lineage 結合起來。

2. **哪些外部副作用可以真正 staging？** Database/local file 比較容易；email、payment、social post、GUI click 常沒有標準 two-phase commit，因此必須依賴 compensation 或 deferred release gateway。

3. **Permission policy 如何避免被 prompt injection 間接改寫？** Policy 本身必須位於 model-context 之外或至少有不可被 untrusted observation 覆寫的 deterministic enforcement representation。

---

# 下一輪研究

下一輪優先進入：**Model Reasoning × System Reasoning × Planning Runtime**。

研究鏈：

```text
Goal
↓
Model proposes reasoning/action
↓
Planner / Search / Graph Runtime
↓
Candidate Plans
↓
Cost / Risk / Permission constraints
↓
Execution Plan
↓
Dynamic Replanning
```

要比較 ReAct、Plan-and-Execute、ReWOO、LLMCompiler、Tree/Graph search，並回答：
- 哪些 reasoning 發生在模型 token generation 內？
- 哪些其實是 runtime 外部 orchestration？
- planning state 應該保存成 text、graph、DAG 還是 event log？
- parallel tool calls 如何形成 dependency graph？
- replan 如何和 transaction / rollback boundary 對齊？

---

# 本輪進化檢查

- 最缺的一層：Reasoning / Planning 與 Transaction Runtime 的正式接口。
- 最淺節點：Semantic Effect Identity。
- 仍偏名詞化：Compensating Action 的跨服務標準化。
- 最值得讀原始碼：OpenAI Agents SDK approval/run-state、ClawGuard runtime boundary、具 transaction manager 的 agent runtime prototype。
- 最值得追論文：Cordon → ACRFence → streaming/revision transaction line。
- 最適合視覺模擬：Permission & Transaction X-Ray + Duplicate Side-Effect Failure Injection。
- 最值得 Hermes 實作：`Task Authority Envelope + Action Risk Classifier + Approval Gate + Effect Ledger + Verification/Commit state`，先做成可觀察的 control-plane 資料模型，再接真正 side-effect executor。

## Sources

- OpenAI Agents SDK — Human-in-the-loop / approval flow: https://openai.github.io/openai-agents-python/human_in_the_loop/
- OpenAI Agents SDK — MCP approvals: https://openai.github.io/openai-agents-js/guides/mcp/
- MCP 2026-07-28 specification overview: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- MCP Enterprise-Managed Authorization: https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/
- Cordon: https://arxiv.org/abs/2606.17573
- ACRFence: https://arxiv.org/abs/2603.20625
- ClawGuard: https://arxiv.org/abs/2604.11790
- ClawGuard code: https://github.com/Claw-Guard/ClawGuard
- Revisable by Design: https://arxiv.org/abs/2604.23283
