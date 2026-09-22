# 【AI Agent × Multimodal Research Report】

**時間：2026-09-22 17:52（Asia/Taipei）**

**本輪主題：MCP Authorization Capability × Scope Step-Up × Side-Effect Semantic Transaction Contract**

## 歷史研究比較 / 去重

上一輪已建立 MCP 2026-07-28 stateless/MRTR provenance：`ToolInvocationIdentity → JSON-RPC → requestState → replica → external idempotency key → durable receipt → ObservationCommit`，並指出 JSON-RPC ID、requestState、side-effect receipt 是不同 identity domain。

本輪不重複 MRTR，而下鑽「誰被允許執行這次 side effect、授權證據如何進入 handler、dynamic scope 如何與 tool arguments 綁定，以及 per-call authorization 為何仍不足以保護 multi-step Agent workflow」。研究同時交叉閱讀 MCP TypeScript SDK authorization implementation/docs、MCP 2026-era authorization資料，以及 2026 Cordon semantic transaction研究。

---

## 本小時新發現

### 新架構：MCP Resource-Server Authorization Boundary

MCP server在HTTP模式中是 OAuth resource server：驗證 Authorization Server 發出的 bearer token，而不是自己簽發token。HTTP middleware先建立 verified `AuthInfo`，再將它送入 per-request server/handler context。

### 新機制：Per-operation scope step-up

除了endpoint-wide required scopes，MCP TypeScript SDK支援 primitive-level `scopeChallenge`。Tool/resource/prompt可根據request內容動態要求scope，缺scope時在handler執行前回傳 `403 insufficient_scope`。

### 新研究：Cordon — Semantic Transactions for Tool-Using LLM Agents

Cordon (Chen et al., 2026) 指出 isolated tool RPC缺乏 task-scoped commit/rollback/recovery boundary；其semantic transaction把 tool intents、result lineage、shadow state、staged external effects、delegated authority與audit metadata放入同一transaction manager，先驗證完整workflow再釋放不可逆effects。

---

# 本小時最重要 5 個發現

## 1. Authentication / token validity ≠ authorization for this semantic action

### 是什麼

Bearer token驗證只證明token有效且形成一個 `AuthInfo`。真正tool action還可能需要endpoint scope與operation-specific scope。

### 底層如何運作

`Authorization: Bearer token`
→ verifier
→ token signature/introspection + expiry
→ `AuthInfo(clientId, scopes, expiresAt, ...)`
→ endpoint requiredScopes
→ primitive `scopeChallenge`
→ handler

### 為什麼重要

Hermes不能建立：

`ValidAccessToken → ToolAuthorized`

而應建立：

`ToolAuthorizationWitness = TokenValid ∧ ResourceBindingValid ∧ RequiredEndpointScopesSatisfied ∧ OperationScopesSatisfied ∧ PrincipalBindingMatch`

### 限制

SDK提供mechanism，但scope語義與hierarchy由application定義。

### 證據分類

- 已確認：TypeScript SDK authorization middleware、AuthInfo flow、requiredScopes/scopeChallenge。
- 合理推論：高保證Agent需把authorization witness綁定canonical ToolInvocationIdentity。

---

## 2. Dynamic scope decision happens before tool input schema validation

### 是什麼

MCP TypeScript SDK文件明確警告：`scopeChallenge` callback在primitive input schema validate/transform之前執行；callback看到的是JSON-parsed wire values。

### Bottom-level mechanism

`Wire JSON arguments`
→ scopeChallenge(raw parsed values)
→ allow / 403 step-up
→ schema validation/transform
→ handler canonical arguments

### 為什麼重要

若authorization policy對參數語義敏感，例如：

`read-repository({visibility:'private'}) → repo:read`

那麼policy若用raw value，而handler最後使用canonicalized/transformed value，可能出現：

`AuthorizationArgumentIdentity != ExecutionArgumentIdentity`

因此新增：

`AuthorizationArgumentCanonicalizationWitness`

以及 invariant：

`AuthorizedSemanticAction = CanonicalAuthorizationArguments == CanonicalExecutionArguments`

### 限制

這不是宣稱SDK存在漏洞；官方文件已明確提醒dynamic authorization應自行validate/canonicalize影響scope的值。

---

## 3. OAuth challenge / retry creates a new authorization generation

### 是什麼

缺token或invalid token會得到401；valid token但scope不足會得到403 `insufficient_scope`，client可經Protected Resource Metadata與Authorization Server取得/升級credential後retry。

### 底層如何運作

`ToolInvocation I42`
→ Request R0 / AuthGeneration A0
→ 403 insufficient_scope
→ WWW-Authenticate + resource_metadata
→ OAuth discovery/authorization
→ token generation A1
→ retry request R1
→ scope challenge passes
→ handler execution

### 為什麼重要

retry仍可屬於同一semantic invocation，但authorization generation已不同：

`ToolInvocationIdentity != AuthorizationDecisionGeneration`

Hermes必須記錄：

`Invocation I42 --authorized_by→ AuthDecision A1`

而不能因R0被拒絕就建立新的side-effect identity。

### 新 failure

`AUTH_RETRY_REBOUND_TO_WRONG_INVOCATION`

`STEP_UP_SCOPE_VALID_BUT_ARGUMENT_GENERATION_CHANGED`

---

## 4. Authorization success does not prove safe side-effect commit

### 是什麼

即使token、scope、requestState全部正確，Agent仍可能在multi-step workflow中組合出危險或違反高層intent的actions。

### 交叉驗證

Cordon 2026把問題描述成tool RPC boundary太細：單一步驟都可能局部合法，但跨步驟的composed execution仍可能違反task-level constraints。它用semantic transaction manager追蹤derived result lineage、shadow state、effect outbox、delegated authority與audit metadata，在commit前驗證整體execution flow。

### 新 invariant

`SafeIrreversibleCommit = PerCallAuthorizationWitness ∧ WorkflowIntentConsistencyWitness ∧ ResultLineageValid ∧ EffectSetValidated ∧ CommitPolicySatisfied`

因此：

`AuthorizedToolCall --does_not_prove→ SafeWorkflowCommit`

### 限制

Cordon是研究系統，不代表MCP core已提供transaction manager；Hermes應把它建模為Agent runtime上層contract。

---

## 5. Authority 本身需要 provenance 與 delegation identity

### 是什麼

Agent tool execution不只需要「有token」，還需要知道authority從哪個principal來、scope是哪一代、是否經step-up、是否只適用這個resource/action，以及external side effect是否超出原authority。

### 新 identity

`AuthorityGeneration = PrincipalIdentity + CredentialGeneration + ResourceIdentity + ScopeSet + AuthorizationDecisionGeneration + Expiry + InvocationBinding`

### 為什麼重要

未來 multi-agent / nested-agent delegation會產生：

`UserAuthority → ParentAgentDelegation → ChildAgent → MCP Tool → External API`

如果Hermes只保留最末端bearer token，就無法回答「這個side effect究竟由哪個user intent授權」。

### 新 Edge

`UserIntentGeneration --delegates→ AgentAuthorityGeneration`

`AgentAuthorityGeneration --authorizes→ ToolInvocationIdentity`

`ToolInvocationIdentity --commits→ ExternalSideEffectReceipt`

---

# Architecture Breakdown

```text
User Intent / Approval
    ↓
Agent Authority Generation
    ↓
Canonical ToolInvocationIdentity
    ↓
MCP HTTP Request
    ↓
Bearer Token
    ↓
OAuth Resource Server Gate
    ├─ token invalid → 401 + WWW-Authenticate
    └─ token valid
         ↓
      AuthInfo
         ↓
      endpoint requiredScopes
         ↓
      primitive scopeChallenge(raw arguments)
         ├─ insufficient → 403 + scope step-up → retry
         └─ allowed
              ↓
          schema validate / canonicalize
              ↓
          AuthorizationArgument == ExecutionArgument ?
              ↓
          requestState / MRTR evidence
              ↓
          Handler
              ↓
          Semantic Transaction
              ├─ shadow/reversible state
              ├─ derived result lineage
              ├─ effect outbox
              └─ delegated authority
              ↓
          Commit Policy
              ↓
          External Side Effect
              ↓
          Durable Receipt
              ↓
          Observation Commit
              ↓
          Next Model Context
```

---

# Bottom-Level Logic

## Authorization decomposition

```text
Raw HTTP Request
→ Extract Bearer Credential
→ Verify Token
→ Validate Expiry
→ Establish Principal/AuthInfo
→ Validate Resource Binding
→ Endpoint Scope Check
→ Parse Tool Request
→ Dynamic Operation Scope Decision
→ Optional OAuth Step-Up
→ Retry With New Credential Generation
→ Canonicalize Tool Arguments
→ Bind Authorization Decision To Invocation
→ Pre-Side-Effect Policy
→ Execute/Stage Effect
→ Persist Receipt
→ Commit Observation
```

## Must-not-collapse identities

```text
PrincipalIdentity
≠ AccessTokenGeneration
≠ AuthorizationDecisionGeneration
≠ ToolInvocationIdentity
≠ MCPRequestIdentity
≠ RequestStateGeneration
≠ ExternalIdempotencyKey
≠ ExternalSideEffectReceipt
≠ ObservationCommitGeneration
```

---

# Visual Simulation Idea

## Authority → Tool → Side-Effect Transaction Microscope

Interactive lanes:

1. User Intent / Approval
2. Agent Runtime
3. OAuth Credential / Scope
4. MCP HTTP Boundary
5. scopeChallenge / Argument Canonicalization
6. Tool Handler
7. Semantic Transaction / Effect Outbox
8. External System
9. Observation Commit

Fault injection:

- expired token
- correct token / wrong resource
- insufficient scope → step-up
- argument changes between authorization and execution
- retry rebound to another invocation
- child agent uses parent authority outside delegation
- individually authorized calls compose into unsafe workflow
- external commit succeeds but receipt persistence fails

Key panel:

```text
Principal Verified          ✓
Resource Binding            ✓
Scope                       ✓
Argument Binding            ✗
Workflow Intent             ?
Side Effect                 ?
Durable Receipt             ✗
Observation Commit          ✗
```

---

# Code / GitHub

Primary implementation inspected: `modelcontextprotocol/typescript-sdk` current main.

High-value file/doc this round:

- `docs/serving/authorization.md` — resource-server gate, AuthInfo propagation, RFC 9728 metadata, endpoint scopes, per-operation scopeChallenge.
- `packages/server/` — next pass should locate concrete `requireBearerAuth`, `requireScopes`, handler dispatch, AuthInfo types.
- `packages/client/` — next pass should trace 401/403 challenge → OAuth acquisition/step-up → semantic retry.

Important source-level facts:

- MCP server verifies tokens as OAuth resource server and does not need to mint them.
- verified AuthInfo is forwarded into per-request handler context.
- per-operation scope challenge occurs before primitive invocation.
- dynamic scope callback sees JSON-parsed wire input before schema validation/transformation.
- authorization failure is expressed at HTTP boundary with 401/403 and WWW-Authenticate metadata.

---

# Papers / Specifications

## Cordon: Semantic Transactions for Tool-Using LLM Agents

- **Authors:** Zheng Chen, Hanqing Liu, Duling Xu, Dong Dong, Jialin Li, Bangzheng Pu, Jidong Zhai
- **Year:** 2026
- **Architecture:** task-scoped semantic transaction manager; shadow state; staged effect outbox; result lineage; delegated authority; recovery/audit metadata
- **Contribution:** moves safety/correctness boundary above isolated tool RPCs so composed multi-step effects can be validated before irreversible commit
- **Dataset / evaluation:** adversarial + benign tool-using workflows (paper evaluation); this round does not claim a standardized public dataset from the abstract alone
- **Code:** not verified in this round
- **Limitations:** runtime containment cannot make arbitrary external systems rollbackable; integration still needs adapters/idempotency/receipts
- **Changed what:** introduces a task-level transaction abstraction for agent side effects instead of relying solely on per-call guardrails
- **URL:** https://arxiv.org/abs/2606.17573

## MCP Authorization / 2026-07-28 ecosystem

- **Institution:** Model Context Protocol project
- **Year:** 2026
- **Architecture:** OAuth resource server + Protected Resource Metadata + authorization server discovery + per-operation scopes
- **Contribution:** separates resource-server validation from identity provider; supports explicit HTTP authorization challenges and operation-level scope requirements
- **Limitations:** authorization answers who may invoke; it does not by itself establish task-level semantic correctness or exactly-once external effects

---

# Confirmed Fact / Inference Separation

### 已確認事實

- MCP TypeScript SDK current authorization guide implements bearer-token resource-server gating.
- Missing/invalid/expired token yields 401; insufficient scope yields 403 with WWW-Authenticate challenge.
- AuthInfo reaches handlers.
- per-operation `scopeChallenge` can derive required scopes from request.
- dynamic scope callback runs before input schema validation/transformation.
- Cordon proposes task-scoped semantic transactions with staged effects and result lineage.

### 官方設計意圖

- Authorization is enforced at HTTP/resource-server boundary.
- Protected Resource Metadata enables clients to discover how to acquire suitable credentials.

### 合理工程推論

- Authorization decisions should be generation-bound to canonical invocation + canonical arguments.
- Scope step-up retry should retain semantic invocation identity while creating a new authorization generation.
- High-assurance agent runtime needs both per-call authorization and task-level commit policy.

### 尚未驗證假說

- MCP TypeScript SDK client exposes enough retry hooks to propagate a stable Hermes ToolInvocationIdentity across 401/403 OAuth step-up without transport patching.
- A portable `AuthorityGeneration` envelope can span OpenAI Agents SDK, MCP, LangGraph and nested-agent delegation.

---

# Unknown / Open Questions

1. OAuth resource/audience binding在current TypeScript SDK verifier contract中究竟由SDK強制、由verifier實作者負責，還是兩者混合？下一輪需讀實際auth source而不只guide。
2. 401/403 OAuth retry後，client transport是否保留足夠correlation metadata，讓同一 ToolInvocationIdentity可與新 credential generation可靠join？
3. Cordon式effect outbox如何與MCP MRTR requestState、external idempotency key與durable receipt整合，形成可portable的Agent transaction protocol？

---

# 下一輪研究

```text
ToolInvocationIdentity
→ MCP client HTTP request
→ bearer credential generation
→ Protected Resource Metadata
→ Authorization Server metadata
→ resource/audience binding
→ scope challenge
→ OAuth step-up
→ retry identity
→ AuthInfo
→ canonical arguments
→ handler
→ effect outbox / idempotency key
→ external commit
→ durable receipt
→ ObservationCommit
```

原始碼優先：

`modelcontextprotocol/typescript-sdk packages/server authorization implementation → packages/client OAuth transport → retry/challenge path → handler dispatch`。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

- `MCPResourceServerIdentity`
- `OAuthCredentialGeneration`
- `OAuthPrincipalIdentity`
- `OAuthResourceBindingIdentity`
- `EndpointScopeDecisionGeneration`
- `OperationScopeDecisionGeneration`
- `AuthorizationArgumentGeneration`
- `ExecutionArgumentGeneration`
- `AuthorizationArgumentCanonicalizationWitness`
- `OAuthStepUpGeneration`
- `AuthorityGeneration`
- `DelegatedAuthorityGeneration`
- `WorkflowIntentConsistencyWitness`
- `SemanticTransactionGeneration`
- `EffectOutboxGeneration`
- `TaskCommitPolicyWitness`

## Edges

```text
OAuthCredentialGeneration --establishes→ OAuthPrincipalIdentity
OAuthPrincipalIdentity --participates_in→ AuthorityGeneration
OperationScopeDecisionGeneration --authorizes→ ToolInvocationIdentity
AuthorizationArgumentGeneration --must_match→ ExecutionArgumentGeneration
OAuthStepUpGeneration --supersedes→ PriorAuthorizationGeneration
ToolInvocationIdentity --belongs_to→ SemanticTransactionGeneration
SemanticTransactionGeneration --stages→ EffectOutboxGeneration
TaskCommitPolicyWitness --permits→ ExternalSideEffectCommit
ExternalSideEffectReceipt --supports→ ObservationCommitGeneration
AuthorizedToolCall --does_not_prove→ SafeWorkflowCommit
ValidAccessToken --does_not_prove→ AuthorizedSemanticAction
```

---

# 本輪結束判定

- **缺哪一層：** OAuth authorization generation → canonical tool arguments → semantic transaction commit之間的production trace join。
- **哪個節點最淺：** `OAuthResourceBindingIdentity` 的actual verifier/runtime enforcement。
- **哪個概念仍只是名詞：** portable `DelegatedAuthorityGeneration`。
- **哪個系統值得讀原始碼：** MCP TypeScript SDK server/client OAuth authorization + challenge/retry path；Cordon若公開code則列為下一優先。
- **哪篇論文需追引用：** Cordon (2026)，尤其後續agent transaction / effect staging / recovery研究。
- **哪個概念最適合視覺模擬：** `Authority → Tool → Side-Effect Transaction Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Canonical Invocation Identity + Authority Generation Tracker + OAuth/Scope Verifier + Argument-Binding Gate + Semantic Transaction Manager + Effect Outbox + Durable Receipt Resolver + Observation Commit Gate`。

本輪將「Agent有權呼叫工具」進一步拆成可驗證鏈：**principal、credential、resource、scope、argument、invocation、workflow intent、commit policy與side-effect receipt必須各自保留identity。單次tool call即使完全通過OAuth，也不能推出整個Agent workflow的不可逆行為是安全且符合原始使用者意圖。**