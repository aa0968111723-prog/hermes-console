# 【AI Agent × Multimodal Research Report】

時間：2026-09-08 20:50（Asia/Taipei）

主題：Agent Identity × Delegated Authority × Zero-Trust Agent Mesh

本輪承接前一輪 `A2A × MCP × Durable Event Bus × Distributed Trace`，避免重複 A2A Message/Task/Artifact 基礎，專門補齊「A2A 已知道對方 Agent 是誰之後，這個 Agent 到底能代表誰、能做什麼、可否再把權力交給下一個 Agent」這一層。

---

## 本小時新發現

### 新標準 / 草案

1. **Verifiable Attenuated Delegation for AI Agent Chains**，IETF Internet-Draft，2026-09-03。核心是多跳 delegation 的 authority monotonic attenuation：第 N 跳的權限不得大於 N-1，並以 parent commitment、RAR policy、expiry/depth 約束及 offline verification 驗證整條鏈。
2. **Delegation Chain for OAuth 2.0**，IETF Internet-Draft，2026-06。新增 `delegation_chain` JWT claim，補足 RFC 8693 `act` claim 只能描述 actor lineage、不能表示每跳 authorization constraints 的缺口。
3. **Attenuating Authorization Tokens for Agentic Delegation Chains**，IETF Internet-Draft，2026-06。把 tool-level authority 與 argument constraints 放進 task-scoped token，token holder 可離線派生 equal-or-narrower authority。
4. **OAuth Identity and Authorization Chaining Across Domains**，IETF OAuth WG Internet-Draft，2026-05。解決 identity/authorization context 穿越 trust domain 的 transport 問題。
5. **AI Agent Authorization Integration Framework**，IETF Internet-Draft，2026-07。嘗試把 cross-domain identity、policy、consent evidence、multi-hop delegation 組成 Agent authorization framework。
6. MCP `2026-07-28` authorization 繼續朝標準 OAuth/OIDC 靠攏；MCP server 是 Resource Server，Bearer token / Protected Resource Metadata / OAuth AS discovery 是 authorization plane，而不是 MCP server 自己發 token。
7. A2A v1.0 Signed Agent Cards 只證明 Agent Card authenticity/integrity 與 claimed provider origin；它本身不代表使用者已授予該 Agent 任意 external resource authority。

狀態標記：上述 IETF delegation documents 目前均為 Internet-Draft / work in progress，不應當成 finalized RFC。

---

# 本小時最重要 5 個發現

## 1. Identity、Authentication、Authorization、Delegation 必須拆成四層

不能再畫成：

```text
Agent Login
↓
Agent 有權限
```

更準確應是：

```text
Identity
= Who is this principal?

Authentication
= Can it prove that identity?

Authorization
= What may this principal do?

Delegation
= Which subset of that authority may it pass onward?
```

A2A Signed Agent Card 解的是前兩層的一部分：卡片是否來自宣稱的 provider、metadata 是否被竄改。

OAuth / MCP authorization 解的是 resource access。

Agent delegation chain 則再增加：

```text
User
↓ delegates
Hermes
↓ attenuates
Agent B
↓ attenuates
Agent C
```

所以：

```text
Verified Agent Identity
≠
User Delegated Authority
```

這是本輪最重要的 Knowledge Graph 修正。

---

## 2. 多跳 Agent delegation 的核心 invariant 應是 Monotonic Attenuation

理想條件：

```text
Authority(User → A)
⊇ Authority(A → B)
⊇ Authority(B → C)
```

每一跳只能：

- 減少 scopes
- 減少 tools
- 收窄 resource
- 收窄 argument range
- 降低金額 / 數量上限
- 縮短 expiration
- 減少 delegation depth

不能：

```text
Agent A:
Drive.read

↓ delegates

Agent B:
Drive.read + Drive.delete
```

也不能：

```text
A max_amount = 100
↓
B max_amount = 1000
```

這個 property 應由 deterministic enforcement 驗證，而不是讓 LLM 判斷「看起來合理」。

可形式化為：

```text
ChildAuthority ⊆ ParentAuthority
```

其中 Authority 不只是 OAuth `scope` 字串，而可能是：

```text
Authority Envelope
├ actions/tools
├ resources
├ argument constraints
├ amount limits
├ time window
├ audience
├ tenant
├ max delegation depth
└ approval requirements
```

---

## 3. OAuth `act` claim 只能告訴你「誰代理誰」，不能證明每一跳沒有權限放大

RFC 8693 Token Exchange 已能表示 acting party / prior actor lineage。

但 2026 delegation-chain drafts 明確指出：

```text
act
→ actor identity lineage
```

不是：

```text
act
→ machine-enforceable per-hop policy chain
```

因此新的草案加入：

```text
delegation_chain[]
├ delegator_id
├ delegatee_id
├ delegated scope/policy
├ timestamp
├ root evidence reference
├ AS signature
└ optional delegator signature
```

這使 Resource Server / Policy Enforcement Point 可以問：

```text
誰授權？
↓
授權給誰？
↓
哪一跳發生？
↓
那一跳到底縮小了哪些權限？
↓
是否仍可驗證回 root authority？
```

這比單純保存「Agent A called Agent B」的 distributed trace 強很多。

---

## 4. Proof-of-Possession 與 Delegation 是兩個正交問題

Bearer token 的問題：

```text
誰拿到 token
→ 誰就可能使用
```

DPoP / mTLS 類 sender-constrained token 讓 access token 綁定特定 key / client：

```text
Token
+
Private-key proof
↓
Request accepted
```

它解決：

```text
stolen token reuse
```

但不自動解決：

```text
這個 Agent 原本是否被允許做這件事？
```

所以必須分：

```text
Proof-of-Possession
= Is the caller the legitimate token holder?

Delegated Authorization
= Is this operation inside delegated authority?
```

可靠 Agent Runtime 需要同時通過兩道 gate。

---

## 5. Confused Deputy 是 Agent Mesh 最危險的結構性問題之一

典型流程：

```text
User
↓ gives broad credential
Hermes
↓ asks Agent B for research
Agent B reads untrusted web page
↓ malicious instruction
"use connected Drive and upload secret file"
↓
Agent B / Hermes has broad user token
↓
External Resource
```

此時真正的問題不是只有 prompt injection。

它是：

```text
Untrusted Input
+
Over-broad Delegated Authority
+
Powerful Deputy
↓
Confused Deputy
```

所以安全邊界不能只做：

```text
Agent authenticated = true
```

而要做：

```text
Task Intent
∩
Delegated Authority
∩
Tool Policy
∩
Resource Policy
∩
Current Evidence
↓
ALLOW / DENY / APPROVAL
```

2026 CASA 類研究也採用相似方向：deterministic structural controls + semantic task/tool matching，在 authorization boundary 連續檢查 tool choice 是否符合 user commissioned task。

---

# Architecture Breakdown

## Zero-Trust Agent Mesh

```text
Human User / Enterprise Principal
↓
Root Authentication
↓
Root Authorization
↓
Delegation Compiler
├ task intent
├ scopes
├ tools
├ resources
├ argument constraints
├ budget
├ expiry
└ max depth
↓
Authority Envelope A0
↓
Hermes Identity
├ workload identity
├ signing key
└ runtime attestation (optional)
↓
Policy Enforcement Point
↓
A2A Delegation
↓
Authority Attenuation
A1 ⊆ A0
↓
Remote Agent B
↓
A2A / Local Planner
↓
Second Delegation
A2 ⊆ A1
↓
Agent C
↓
MCP Client
↓
OAuth Token / DPoP proof
↓
MCP Resource Server
↓
Tool
↓
External Resource
```

每一跳應保存：

```text
Delegation Record
├ parent authority hash/commitment
├ delegator identity
├ delegatee identity
├ task id
├ allowed capabilities
├ structured constraints
├ issue time
├ expiry
├ depth
├ proof-of-possession binding
└ signature
```

---

# Bottom-Level Logic

## 一次 Hermes → Agent B → MCP 的完整 authorization flow

使用者：

> 幫我讀 `/Reports` 裡的 Q3 檔案並摘要，不要修改或分享。

### Step 1 — Goal → Authority

```text
Natural-language Goal
↓
Authority Compiler
↓
{
  tool: Drive,
  actions: [read],
  resource_prefix: /Reports,
  write: false,
  share: false,
  expires: +10 min,
  delegable: true,
  max_depth: 1
}
```

### Step 2 — Hermes delegates

```text
A0
↓ attenuation
A1
```

例如 Remote Agent B 只需要：

```text
Drive.read
resource=/Reports/Q3.xlsx
expires=+5 min
max_depth=0
```

### Step 3 — Agent B requests MCP capability

```text
Agent B
↓ token exchange / delegated token acquisition
Authorization Server
↓
Access Token
├ subject/user context
├ actor/delegation context
├ audience=MCP Drive server
├ narrow authorization_details
└ cnf / PoP binding
```

### Step 4 — MCP Server enforcement

```text
HTTP Request
↓
Validate token signature
↓
Validate issuer
↓
Validate audience
↓
Validate expiry
↓
Validate proof-of-possession
↓
Validate delegated authority
↓
Validate tool + arguments
↓
ALLOW
```

如果 Agent B 嘗試：

```text
Drive.delete('/Reports/Q3.xlsx')
```

Runtime 不需要問 LLM「這是不是越權」。

Deterministic policy：

```text
delete ∉ allowed_actions
↓
DENY
```

---

# Delegation Invariant Simulator

本輪最適合 Hermes Console 的互動視覺模擬：

## **Authority Chain X-Ray**

畫面：

```text
USER
Authority A0
████████████████
read write share delete
$1000
1 hour

        ↓ delegate

HERMES
Authority A1
██████████
read write
$100
20 min

        ↓ delegate

RESEARCH AGENT
Authority A2
████
read only
$0
5 min
```

如果出現：

```text
Agent C asks:
Drive.delete
```

畫面立刻標紅：

```text
AUTHORITY ESCALATION

requested action = delete
parent authority = read only

DENY
```

互動控制項：

- Add delegation hop
- Narrow / widen scope
- Change expiry
- Add resource constraint
- Add argument constraint
- Steal token simulation
- DPoP on/off
- Prompt injection simulation
- Agent compromise simulation

右側顯示：

```text
Identity proof       PASS
Token signature      PASS
PoP                  PASS
Scope attenuation    FAIL
Argument constraint  PASS
Depth                PASS
Expiry               PASS
Final decision        DENY
```

最重要的教學效果：

> 「身份是真的」仍然可能「要求的權限是錯的」。

---

# Code / GitHub

## Hermes Console 應新增的 runtime primitive

建議未來程式層，不要只保存：

```ts
connected: true
```

而應逐步形成：

```ts
interface AuthorityEnvelope {
  principalId: string
  actorId: string
  taskId: string
  audience: string[]
  capabilities: CapabilityConstraint[]
  issuedAt: number
  expiresAt: number
  maxDelegationDepth: number
  parentCommitment?: string
  proofBinding?: string
}
```

以及：

```ts
interface DelegationDecision {
  identityValid: boolean
  proofOfPossessionValid: boolean
  parentAuthorityValid: boolean
  attenuationValid: boolean
  taskAlignment: 'pass' | 'fail' | 'unknown'
  approvalRequired: boolean
  decision: 'allow' | 'deny' | 'escalate'
}
```

值得研究的公開實作線索包括 OAuth Token Exchange + DPoP + RAR 實作；GitHub code search 可看到已有 implementation 同時驗證 `sub`、`act`、`scope`、`cnf`、`authorization_details`，也有 DPoP refresh/key-binding 與 delegated sub-agent binding tests。這些是工程參考，不是 Agent delegation 標準本身。

---

# Papers / Specifications

## 1. Verifiable Attenuated Delegation for AI Agent Chains

- Author: R. Asor
- Organization/Track: IETF WIMSE Internet-Draft
- Year: 2026
- Published: 2026-09-03
- Architecture: OAuth JWT Access Token + RAR authority + cryptographic parent commitment + PoP + monotonic attenuation verification
- Dataset: N/A
- Code: specification draft; no canonical production implementation established in this report
- Contribution: 將 multi-hop authority narrowing 變成可 deterministic/offline verify 的 chain property
- Limitations: Internet-Draft / work in progress；部署與 interoperability 尚未成熟
- Changed what: 把「相信上游 Agent 有縮權」改成「enforcement point 可驗證每一跳都沒有放大權限」

## 2. Delegation Chain for OAuth 2.0

- Authors: D. Liu, H. Zhu, S. Krishnan, A. Parecki
- Institutions: Alibaba Group, Cisco, Okta
- Year: 2026
- Architecture: OAuth Token Exchange + `act` + `delegation_chain` + per-hop policy + optional delegator signature
- Dataset: N/A
- Contribution: 在 actor lineage 上加入 authorization lineage
- Limitations: Internet-Draft；`delegation_chain` 尚非 finalized RFC claim
- Changed what: Identity lineage → Identity + policy lineage

## 3. Attenuating Authorization Tokens for Agentic Delegation Chains

- Author: N. A. Niyikiza
- Institution: Tenuo
- Year: 2026
- Architecture: signed task-scoped token + RAR tool claims + argument constraints + offline child-token derivation
- Dataset: N/A
- Contribution: capability-style offline attenuation
- Limitations: Internet-Draft；需評估 revocation、key management、token size / policy complexity
- Changed what: OAuth scope 從粗粒度字串進一步往 tool/argument-level constraint 發展

## 4. OAuth Identity and Authorization Chaining Across Domains

- Authors: A. Schwenkschuster, P. Kasselmann, K. Burgin, M. Jenkins, B. Campbell, A. Parecki
- Institutions: Defakto Security, MITRE, NSA-CCSS, Ping Identity, Okta
- Year: 2026 draft revision
- Architecture: Token Exchange + JWT Authorization Grant across trust domains
- Contribution: 保留 identity / authorization context 穿越 domain boundary
- Limitations: 是 cross-domain transport pattern，不等於 Agent-specific authority attenuation

## 5. Hybrid Inspection and Task-Based Access Control in Zero-Trust Agentic AI

- Authors: Majed El Helou, Benjamin Ryder, Chiara Troiani, Jean Diaconu, Hervé Muyal, Marcelo Yannuzzi
- Year: 2026
- Architecture: zero-trust interception layer + deterministic controls + semantic task extraction + task-tool authorization matching
- Dataset: extends ASTRA with multi-turn conversation/tool authorization examples
- Contribution: 將 user task intent 帶到 authorization boundary，而非只有 static OAuth scopes
- Limitations: semantic policy engine 自身可能誤判；不可取代 deterministic scope / resource enforcement
- Changed what: Authorization 從 session-level permission 走向 continuous per-action semantic authorization

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Agent Identity
├ Provider Identity
├ Workload Identity
├ Agent Instance Identity
└ User-on-behalf-of Identity

Delegated Authority
├ Root Authority
├ Authority Envelope
├ Scope
├ Structured Authorization
├ Argument Constraint
├ Budget Constraint
├ Temporal Constraint
├ Delegation Depth
└ Audience

Delegation Chain
├ Delegator
├ Delegatee
├ Parent Commitment
├ Attenuation
├ Signature
├ Proof-of-Possession
└ Root Evidence

Zero-Trust Agent Mesh
├ Policy Enforcement Point
├ Policy Decision Point
├ Task Intent
├ Continuous Authorization
├ Confused Deputy Defense
└ Least-Privilege Delegation
```

## Edges

```text
User Identity
--grants-->
Root Authority

Root Authority
--delegated to-->
Hermes

Hermes Authority
--attenuated into-->
Remote Agent Authority

Remote Agent
--invokes via-->
MCP

MCP Resource Server
--enforces-->
Delegated Authority

Proof-of-Possession
--binds-->
Token Holder

Delegation Chain
--must preserve-->
Monotonic Attenuation

Untrusted Context
--can exploit-->
Confused Deputy

Task Intent
--constrains-->
Tool Authorization
```

---

# 已確認 / 推論 / 尚未驗證

## 已確認官方/規格資訊

- A2A Agent Cards MAY 用 JWS 簽名以驗證 authenticity/integrity。
- MCP HTTP authorization 採 OAuth-style Resource Server / Bearer token 架構；MCP server 本身不必是 token issuer。
- OAuth Token Exchange 的 `act` 可表示 actor/delegation identity lineage。
- 2026 多個 IETF drafts 正在補 multi-hop authorization policy lineage / attenuation。

## 論文 / Draft 結果

- Agent multi-hop authority attenuation 已成為 IETF 2026 明確研究與標準化方向。
- CASA 類工作顯示 task semantic matching 可加入 authorization enforcement，但不能替代 deterministic policy。

## 合理工程推論

Hermes 最終應把：

```text
A2A identity
+
OAuth delegated authority
+
MCP resource authorization
+
Transaction/Effect Ledger
+
Distributed Trace
```

合成同一條 security control plane。

## 尚未驗證假說

1. Authority Envelope 是否應直接使用 RAR `authorization_details` 作為 Hermes internal canonical IR，仍需比較 Cedar/OPA/Zanzibar-style policy representation。
2. Offline attenuated token chain 對高頻 Agent delegation 的 token size / verification latency 是否可接受，需 benchmark。
3. A2A AgentCard identity 與 workload identity（SPIFFE/SVID、cloud workload identity）如何可靠綁定，尚缺成熟 cross-vendor profile。

---

# Unknown / Open Questions

1. **Authority IR 的標準形式是什麼？** OAuth scope 太粗；RAR 比較結構化，但複雜 Agent policy 可能需要 Cedar/OPA/CEL 類 policy language。
2. **Revocation 如何穿透 N-hop delegation chain？** Root user revoke 後，所有 downstream child authority 要多快失效？offline verification 與即時 revocation 有 trade-off。
3. **Agent identity 與 model/runtime instance identity 如何區分？** 同一 Agent service 在不同 tenant、不同 ephemeral worker、不同 model route 上可能不是同一 trust principal。

---

# 下一輪研究

下一輪應研究：

## **Agent Policy Engine × Capability-Based Security × OPA/Cedar/Zanzibar × Authorization IR**

完整追：

```text
Natural-language Task
↓
Task Intent Extraction
↓
Authorization IR
↓
Policy Compiler
├ OAuth scopes
├ RAR authorization_details
├ Cedar / OPA policy
├ capability token constraints
└ resource graph permissions
↓
Policy Decision Point
↓
ALLOW / DENY / APPROVAL
↓
Policy Enforcement Point
↓
Tool / MCP / A2A / GUI Action
```

核心問題：

- OAuth scope 為什麼不足以描述 Agent action？
- RAR `authorization_details` 能否成為 tool-level authority IR？
- OPA/Rego、Cedar、Zanzibar-style relationship authorization 分別適合 Agent 哪一層？
- deterministic policy 與 LLM semantic policy 要如何組合，才能避免 LLM 成為安全根？
- capability token 與 centralized PDP 哪種更適合高頻 multi-agent delegation？

---

# 本輪結束檢查

- **缺哪一層：** Authority IR → Policy Engine → Enforcement Point 的標準介面。
- **哪個節點最淺：** Agent workload identity 與 A2A identity 的 cryptographic binding。
- **哪個概念仍只是名詞：** Zero-Trust Agent Mesh，目前還沒有單一成熟標準定義。
- **哪個系統值得讀原始碼：** OAuth Token Exchange / DPoP / RAR 實作，以及 MCP SDK authorization middleware。
- **哪篇規格最值得追引用：** `Verifiable Attenuated Delegation for AI Agent Chains` 與 OAuth `Delegation Chain` drafts。
- **哪個概念最適合視覺模擬：** Authority Chain X-Ray / Attenuation Simulator。
- **哪個 Agent 架構最值得實作：** Hermes 作唯一 root orchestrator，所有 remote-agent delegation 都透過 task-scoped attenuated authority；Remote Agent 再使用 MCP 時只能取得比 Hermes authority 更窄的 capability。

本輪核心結論：

> **Agent security 的真正問題不是「這個 Agent 是誰」而已，而是「它此刻代表誰、為了哪個任務、擁有多大的權力、權力從哪裡來、每一次轉授是否只能縮小，以及 Resource Server 能否在不相信 LLM 的情況下驗證這件事」。**
