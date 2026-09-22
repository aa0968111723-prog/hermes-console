# 【AI Agent × Multimodal Research Report】

時間：2026-09-22 18:55（Asia/Taipei）

主題：Untrusted-Model Security Boundary × Semantic Authorization × Deterministic Policy Enforcement

本輪與歷史研究比較：2026-09-08 已建立 `Identity → Authentication → Authorization → Delegation` 與 authority attenuation；近期輪次又追到 MCP OAuth/resource/scope 與 side-effect commit。本輪不重複 OAuth plumbing，而補最關鍵缺口：**即使 identity、token、scope、delegation chain 全部正確，若 LLM 本身被 prompt injection 或誤推理控制，runtime 如何阻止「合法 credential 被拿去做不符合原始任務的合法 API call」？**

---

## 本小時新發現

1. **SEAgent / Taming Various Privilege Escalation in LLM-Based Agent Systems**（Ji et al., 2026）把 agent 攻擊重新定義為 privilege escalation，並用 information-flow graph + ABAC/MAC 在 agent-tool boundary 做強制存取控制；重點是不相信 LLM 自己做最終授權判斷。
2. **CASA / Hybrid Inspection and Task-Based Access Control in Zero-Trust Agentic AI**（El Helou et al., 2026）把 multi-turn conversation 先抽成 task，再於 authorization server 做 task↔tool semantic matching，形成 deterministic controls + semantic inspection 的 hybrid gate。
3. **Delegation Without Trust**（Dantuluri & Sundi, 2026）提出更強的安全基準：把 model 視為可被完全 prompt-inject 的 untrusted component；系統 correctness 應是「即使 model 被控制，也不能超出明確 delegated authority」。其實驗指出 LangGraph、CrewAI、AutoGen 與 MCP authorization model 單獨都不足以覆蓋完整 multi-agent confinement requirement。
4. MCP 官方授權仍主要解 resource-server/OAuth 邊界：Protected Resource Metadata、Bearer token、resource binding、scope。這是必要條件，但不等於 task-intent confinement。
5. 因此 Hermes 應新增一個位於 `Planner/LLM output` 與 `Tool/MCP execution` 之間、**不由 LLM 控制的 Policy Enforcement Point (PEP)**。

---

## 本小時最重要 5 個發現

### 1. Authentication/Scope 正確，仍可能是 Confused Deputy

已確認事實：OAuth/MCP 可以驗證 token、resource、scope；但 scope 通常描述「可呼叫哪些能力」，不直接證明「這次呼叫是否符合使用者此刻交付的任務」。

因此：

```text
ValidCredential
∧ ValidScope
∧ ValidToolSchema

--does_not_prove→

TaskIntentConformance
```

如果 prompt injection 誘導 agent 使用本來合法的 `email:send` 或 `files:write` scope 做另一件事，credential layer 本身可能完全正常。

### 2. Untrusted-model assumption 應成為 Hermes security architecture 的根

新的安全邊界：

```text
User Intent
→ Trusted Task Compiler
→ Delegated Capability Envelope
→ LLM / Planner  [UNTRUSTED]
→ Proposed Tool Call
→ Non-LLM Policy Enforcement Point
→ Tool / MCP
→ Side Effect
```

核心 invariant：

```text
ModelCompromise
--must_not_expand→
DelegatedAuthorityEnvelope
```

這比「偵測 prompt injection」更強，因為即使偵測失敗，runtime 仍要限制可達 actions。

### 3. Semantic authorization 不能只靠另一個 LLM classifier

CASA 類方法很有價值，但 semantic intent matching 是 probabilistic；SentinelAgent 類研究也顯示 intent preservation 比 deterministic authority narrowing 更難保證。

因此 Hermes 應拆成兩層：

```text
Deterministic Gate:
principal/resource/action/argument constraints/data labels/delegation depth/expiry

Semantic Gate:
conversation → task extraction → task-tool match → risk score
```

決策：高風險 side effect 必須先通過 deterministic gate；semantic gate 可收緊權限、要求 approval，但不能擴權。

新增 invariant：

```text
SemanticDecision
--may_narrow_but_must_not_expand→
DeterministicAuthority
```

### 4. Bottom-level mechanism：從自然語言任務編譯成可執行 authorization IR

不能只保存一句 `幫我整理並寄給老師`。應拆成：

```text
Conversation
→ Task Extraction
→ Subject/Principal
→ Resource Set
→ Allowed Actions
→ Argument Constraints
→ Data Classification
→ Recipient Constraints
→ Time/Count Budget
→ Delegation Depth
→ Approval Requirements
→ Authorization IR
→ Signed/Versioned Task Capability
```

每次 tool proposal：

```text
Tool Call
→ Canonicalize Arguments
→ Resolve Resource Identity
→ Map Tool→Action
→ Join Data-Lineage Labels
→ Evaluate ABAC/MAC rules
→ Compare Task Capability
→ Semantic Task Match
→ ALLOW / DENY / STEP-UP
→ Audit Witness
```

這是本輪的 bottom-level mechanism。

### 5. Tool result 也要帶 provenance，否則 information-flow policy 會在下一輪失效

如果 tool A 讀到 `confidential` 資料，下一輪 LLM 再呼叫 tool B 把內容送往 public destination，單看 B 的 tool scope可能看不出資料外洩。

因此新增：

```text
ObservationGeneration
→ inherits → DataLabelSet
→ propagates through → ContextGeneration
→ constrains → NextToolInvocation
```

這把 SEAgent 的 information-flow graph 接回 Hermes 已建立的 ObservationCommit / Context provenance。

---

# Architecture Breakdown

```text
User/UI
  ↓
Intent Capture
  ↓
Trusted Task Compiler
  ↓
Task Capability / Authorization IR
  ↓
Context Builder
  ↓
LLM Planner / Reasoner  ← untrusted
  ↓ proposed action
Canonical Invocation Builder
  ↓
Policy Enforcement Point (non-LLM)
  ├─ Principal/Delegation verifier
  ├─ Resource/Scope verifier
  ├─ Argument constraint verifier
  ├─ Information-flow / data-label verifier
  ├─ Budget/depth/expiry verifier
  └─ Semantic task-tool verifier
  ↓ ALLOW / DENY / STEP-UP
MCP / Tool Runtime
  ↓
External Side Effect
  ↓
Durable Receipt
  ↓
Observation Commit + Data Labels
  ↓
Next Context Generation
```

與 ReAct 的差異：ReAct 描述 `Thought → Action → Observation`；本架構在 Action 與 environment 中間加入可信 enforcement boundary，並讓 Observation 帶 provenance/data labels 回到下一輪。

---

# Bottom-Level Logic

建議 `AuthorizationIR`：

```text
TaskCapability {
  task_id,
  principal_id,
  parent_delegation_id,
  allowed_tools,
  allowed_actions,
  resource_patterns,
  argument_predicates,
  input_data_labels,
  output_destinations,
  max_calls,
  max_cost,
  expires_at,
  max_delegation_depth,
  approval_policy,
  generation
}
```

決策函式：

```text
Decision =
  IdentityValid
∧ DelegationChainValid
∧ ToolAllowed
∧ ActionAllowed
∧ ResourceMatch
∧ ArgumentPredicatesSatisfied
∧ InformationFlowAllowed
∧ BudgetAvailable
∧ NotExpired
∧ SemanticTaskMatchAboveThreshold
```

但 semantic term不得擴張前面 deterministic authority；它只能 `ALLOW within envelope / DENY / STEP-UP`。

---

# Visual Simulation Idea

## Untrusted Agent Authorization & Information-Flow Microscope

互動視圖分六層：

1. User Intent / Task Capability
2. LLM Planner proposals
3. Delegation & deterministic authority envelope
4. Semantic task-tool matcher
5. Tool/MCP side effects
6. Observation/Data-label flow

可注入：

- `PROMPT_INJECTION_TOOL_ESCALATION`
- `CONFUSED_DEPUTY_SUBAGENT`
- `VALID_SCOPE_WRONG_TASK`
- `ARGUMENT_CONSTRAINT_BYPASS`
- `CONFIDENTIAL_TO_PUBLIC_EXFILTRATION`
- `DELEGATION_AUTHORITY_EXPANSION`

關鍵 UI：

```text
Credential ✓ | Scope ✓ | Delegation ✓ | Task Match ✗ | Data Flow ✗ | Commit BLOCKED
```

---

# Code / GitHub

Hermes Console 下一個值得實作的目錄：

```text
src/security/authorization-ir/
src/security/policy-engine/
src/security/information-flow/
src/security/delegation/
src/security/audit-witness/
```

值得持續讀原始碼：MCP SDK authorization middleware/resource metadata；LangGraph ToolNode/runtime；AutoGen/CrewAI tool execution boundary。重點不是 README，而是「tool call 在哪一層真正變成 external execution」，以及能否在該點插入 non-LLM PEP。

---

# Papers

### Taming Various Privilege Escalation in LLM-Based Agent Systems: A Mandatory Access Control Framework
- Authors: Zimo Ji, Daoyuan Wu, Wenyuan Jiang, Pingchuan Ma, Zongjie Li, Yudong Gao, Shuai Wang, Yingjiu Li
- Year: 2026
- URL: https://arxiv.org/abs/2601.11893
- Architecture: SEAgent, information-flow graph + ABAC/MAC
- Contribution: 把 agent tool abuse 統一成 privilege escalation / confused deputy，並在 runtime 強制政策。
- Limitation: policy/attribute engineering 與 semantic intent 本身仍是 deployment challenge。

### Hybrid Inspection and Task-Based Access Control in Zero-Trust Agentic AI
- Authors: Majed El Helou, Benjamin Ryder, Chiara Troiani, Jean Diaconu, Hervé Muyal, Marcelo Yannuzzi
- Year: 2026
- URL: https://arxiv.org/abs/2605.02682
- Dataset: extended ASTRA multi-turn conversation-tool dataset
- Architecture: deterministic interception + task extraction + task-tool semantic authorization
- Contribution: 把 TBAC 推進 multi-turn agent conversation。
- Limitation: semantic matching 是 probabilistic，不可取代 deterministic confinement。

### Delegation Without Trust: An Empirical Gap Analysis of Identity, Authorization, and Runtime Governance in Multi-Agent LLM Systems
- Authors: Panduranga Sai Varma Dantuluri, Jyotirmoy Sundi
- Year: 2026
- URL: https://arxiv.org/abs/2609.00267
- Architecture: authorization broker under untrusted-model assumption
- Contribution: 對 LangGraph/CrewAI/AutoGen/MCP 做 delegation/confinement gap analysis，並以 broker 驗證 capability confinement。
- Limitation: 新近研究，仍需追 code、artifact 與獨立 replication。

---

# Unknown / Open Questions

1. 如何把自然語言 user intent 編譯成 deterministic `AuthorizationIR`，同時避免 compiler 本身成為另一個可被 prompt injection 控制的 LLM boundary？
2. Information-flow label 如何穿過 summarization、RAG、memory compaction、multi-agent message 與 multimodal encoder而不遺失？
3. semantic task matching 的 false deny / false allow 如何校準，並在高風險 action 上轉成 deterministic approval policy？

---

# 下一輪研究

鎖定：

```text
Observation/Data Source
→ Data Classification
→ Provenance Label
→ Context/RAG/Memory
→ Summarization/Compaction
→ Multi-Agent Delegation
→ Tool Argument Construction
→ Sink Classification
→ Information-Flow Policy
→ Side-Effect Commit
```

下一輪優先追「資料標籤如何跨 RAG / Memory / summarization 保留」，把 Agent security 從 action authorization 推進到 information-flow / context provenance。

---

# Knowledge Graph 新增 Node / Edge

新增 Nodes：

- `UntrustedModelBoundary`
- `TrustedTaskCompiler`
- `TaskCapabilityGeneration`
- `AuthorizationIRGeneration`
- `DeterministicAuthorityEnvelope`
- `SemanticTaskAuthorizationWitness`
- `NonLLMPolicyEnforcementPoint`
- `InformationFlowGraphGeneration`
- `ObservationDataLabelSet`
- `ContextDataLabelPropagationWitness`
- `ToolSinkClassification`
- `ConfusedDeputyWitness`

新增 Edges：

```text
UserIntent --compiled_into→ AuthorizationIR
AuthorizationIR --defines→ DeterministicAuthorityEnvelope
LLMProposal --must_pass→ NonLLMPolicyEnforcementPoint
ValidOAuthScope --does_not_prove→ TaskIntentConformance
SemanticDecision --may_narrow_but_must_not_expand→ DeterministicAuthorityEnvelope
ObservationGeneration --inherits→ ObservationDataLabelSet
ObservationDataLabelSet --propagates_through→ ContextGeneration
ContextGeneration --constrains→ NextToolInvocation
ModelCompromise --must_not_expand→ DelegatedAuthorityEnvelope
```

---

## 本輪結束判斷

- **缺哪一層：** data provenance / information-flow labels 穿越 RAG、Memory、summarization 的可信傳播層。
- **哪個節點最淺：** `ContextDataLabelPropagationWitness`。
- **哪個概念仍只是名詞：** production-grade `TrustedTaskCompiler`。
- **哪個系統值得讀原始碼：** SEAgent artifact（若公開）＋ LangGraph ToolNode execution boundary ＋ MCP server authorization middleware。
- **哪篇論文需追引用：** SEAgent、CASA、Delegation Without Trust。
- **哪個概念最適合視覺模擬：** Untrusted Agent Authorization & Information-Flow Microscope。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Trusted Task Compiler + Deterministic Authority Envelope + Non-LLM PEP + Semantic Narrowing Gate + Information-Flow Tracker + Side-Effect Transaction Manager + Observation Commit Gate`。

本輪核心推進：**Hermes 的 security model 從「token/identity/scope 是否有效」前進到「即使 LLM 已被攻陷，它仍不能越過使用者真正授予的 task authority」。這把模型推理與系統授權正式拆成兩個 trust domain，並開始把 observation provenance / data labels 接回下一輪 context。**