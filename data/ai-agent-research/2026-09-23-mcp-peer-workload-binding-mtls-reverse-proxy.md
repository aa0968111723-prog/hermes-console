# 【AI Agent × Multimodal Research Report】

**時間：2026-09-23 09:52（Asia/Taipei）**  
**主題：SPIFFE mTLS Peer Identity × MCP Request Dispatch × Reverse-Proxy Trust Boundary × Per-Request Workload Binding**

## 歷史研究比較 / 本輪避免重複

上一輪已建立：`SourceRevision → Build → ArtifactDigest → Sigstore/SLSA → RunningWorkload → SPIFFE/SVID → ConformanceSubject`，並指出最淺節點是 `MCPPeerWorkloadBindingWitness`。本輪不重複 artifact provenance、conformance harness、fencing 或 receipt evidence，而是專門補：**「已 attested workload」如何成為某一次 MCP `tools/call` 的可信對端身分。**

核心問題：

`RunningWorkloadAttested(A) + MCPResponseReceived` 並不能直接推出 `ThisMCPRequestWasServedBy(A)`。

中間還有 DNS、load balancer、reverse proxy、TLS termination、connection pooling、service mesh、OAuth resource server、MCP handler dispatch 等層。

---

## 本小時新發現

1. SPIFFE Workload API 可向 workload 提供短生命週期 X.509-SVID、private key 與 trust bundle；X.509-SVID 可直接建立 mTLS。SPIFFE ID 被放在 X.509 URI SAN 中，驗證端可從 TLS peer certificate 取得 cryptographic workload identity。
2. SPIRE/Envoy SDS 可以把 X.509-SVID 動態交給 Envoy，由 proxy 代表 workload 建立 mTLS；這帶來新的 identity termination boundary：TLS peer 可能是 Envoy，而不是 application process。
3. MCP Streamable HTTP 的 OAuth authorization 與 workload mTLS identity 是兩條不同 identity plane。OAuth token回答「caller principal/scopes」，mTLS回答「transport peer workload」。兩者不能互相替代。
4. MCP TypeScript SDK current examples 明確把 bearer verification 與 per-tool scope authorization分開：HTTP gate做 token verification，而真正知道哪個 tool 在執行的是 tool handler；handler讀 `authInfo.scopes` 做 per-tool enforcement。
5. 現代 MCP HTTP server常由 reverse proxy / load balancer前置。若 TLS 在 proxy終止，backend application看到的 socket peer是 proxy；除非有可信 identity propagation 或 proxy→backend再次mTLS，否則 application不能把外部 client的TLS identity直接當成 per-request peer proof。

---

## 本小時最重要 5 個發現

### 1. Transport Peer Identity ≠ Application Request Identity

**已確認事實：** X.509-SVID可以建立雙向TLS，讓雙方驗證SPIFFE ID與trust bundle。

底層：

`Workload Attestation → X509-SVID issuance → TLS handshake → certificate chain validation → URI SAN/SPIFFE ID extraction → authenticated channel`

但TLS只直接證明**這條TLS連線的peer**。若HTTP request經過reverse proxy：

`Hermes → mTLS → Proxy → HTTP/mTLS → MCP App`

MCP App直接看到的peer是Proxy，不是Hermes。

新增 invariant：

`ValidPeerSVID --proves→ TLSConnectionPeerIdentity`

`ValidPeerSVID --does_not_prove→ OriginalEndUserIdentity`

`ProxyAuthenticated --does_not_prove→ ForwardedIdentityUntampered`

### 2. OAuth Principal 與 SPIFFE Workload 是正交 identity

MCP HTTP authorization把server視為OAuth resource server；bearer token可攜帶principal/scopes。SPIFFE則對compute workload建立runtime identity。

因此一次安全tool call至少要同時綁：

`CallerPrincipalIdentity`
`CallerWorkloadIdentity`
`ServerWorkloadIdentity`
`ToolDeploymentIdentity`
`SemanticCommitIdentity`

新的 per-request identity envelope：

```text
MCPRequestIdentityEnvelope {
  requestId
  semanticCommitId
  callerPrincipal
  callerWorkloadSpiffeId
  serverWorkloadSpiffeId
  serverDeploymentDigest
  oauthTokenFingerprint
  grantedScopes
  tlsSessionBinding
  toolName
  toolDeploymentIdentity
  receivedAt
}
```

重要規則：

`BearerTokenValid --does_not_prove→ ExpectedCallerWorkload`

`ExpectedCallerWorkload --does_not_prove→ PrincipalHasToolScope`

### 3. Reverse proxy 是 identity translation boundary

若 Envoy/SPIRE SDS代表application做mTLS，Envoy是TLS private key holder與transport peer。這不是錯誤，而是必須明確建模。

安全架構有三種：

A. **End-to-end workload mTLS**：Hermes直接與MCP workload建立mTLS，證據最直接。

B. **Trusted proxy + re-mTLS**：Hermes→Envoy mTLS，Envoy→MCP app再以獨立mTLS；app把proxy視為trusted identity translator，原始caller identity必須透過受保護metadata傳遞。

C. **TLS termination + unsigned forwarded header**：不可用於高風險ToolWriteCapability attestation。

新增：

`IdentityTerminationBoundary`
`IdentityTranslationWitness`
`ForwardedWorkloadIdentityEvidence`

以及：

`X-Forwarded-Client-Cert present --does_not_prove→ OriginalPeerAttested`

除非header只能由可信proxy注入、外部輸入會被剝除、且proxy→backend channel本身被認證。

### 4. MCP dispatch 是最後一個「誰執行哪個tool」的 authoritative point

TypeScript SDK scoped-tools example明確指出：HTTP middleware若要做per-tool scope enforcement，必須重新解析request body猜operation；真正 authoritative 知道正在執行哪個tool的是tool handler本身。因此 Hermes的peer/workload evidence不能只停在HTTP middleware，必須一路傳進dispatch context。

正確路徑：

`TLS Peer Verification → OAuth Verification → MCP Parse → Tool Resolution → Tool Handler → Scope/Effect Authorization → SemanticCommit Binding → Execution`

新的 witness：

`ToolDispatchIdentityWitness = hash(requestIdentityEnvelope, toolDeploymentIdentity, toolName, canonicalArgumentsDigest)`

並要求：

`PreExecutionAuthorization(toolDispatchIdentityWitness) == PASS`

### 5. Stateless MCP 使 identity 必須 per-request 重建，而不是依賴舊 session

現代MCP核心朝stateless request發展；因此安全runtime不應假設「session初始化時驗過一次就永久可信」。每次高風險 `tools/call` 都應重新取得/驗證足夠的：protocol metadata、OAuth principal/scopes、peer workload identity、deployment identity freshness與effect authorization。

新增 invariant：

`PreviouslyAuthenticatedSession --does_not_prove→ CurrentRequestPeerFresh`

這也降低長生命session被替換、proxy重新連線、deployment rollover後仍沿用舊identity的風險。

---

## Architecture Breakdown

```text
User/UI
  ↓
Hermes Planner
  ↓
ToolSafetyRequirementProfile
  ↓
SemanticCommitEnvelope
  ↓
OAuth Principal + Scope Token
  ↓
Hermes Workload X509-SVID
  ↓
TLS / mTLS
  ↓
[Optional Trusted Reverse Proxy / Envoy]
  ↓  Identity Translation Boundary
MCP Server TLS Peer Verification
  ↓
OAuth Resource Server Verification
  ↓
MCP Protocol Parser
  ↓
Tool Resolver
  ↓
Per-Tool Scope + Effect Authorization
  ↓
ToolDispatchIdentityWitness
  ↓
RunningConformanceBindingWitness
  ↓
EffectManifest / Fence / Idempotency
  ↓
External Resource
  ↓
ReceiptVerifier
  ↓
Observation Commit Gate
  ↓
Agent Context / UI
```

### Trust planes

1. **Artifact plane**：source/build/image/conformance。
2. **Workload plane**：SPIRE attestation/SVID。
3. **Transport plane**：mTLS peer identity。
4. **Principal plane**：OAuth subject/scopes。
5. **Dispatch plane**：resolved tool + args + deployment。
6. **Effect plane**：SemanticCommit/fence/idempotency/receipt。

任一plane通過都不能代替其他plane。

---

## Bottom-Level Logic

### X.509-SVID → MCP dispatch

```text
PID/container
→ SPIRE workload attestation
→ selectors
→ registration match
→ X509-SVID issuance
→ short-lived private key/certificate
→ TLS ClientHello/ServerHello
→ certificate presentation
→ trust bundle validation
→ URI SAN SPIFFE ID extraction
→ authenticated transport peer
→ HTTP request
→ bearer token validation
→ MCP request decode
→ tools/call resolution
→ handler context
→ principal/workload/scope revalidation
→ canonical args digest
→ ToolDispatchIdentityWitness
→ effect authorization
→ execution
```

### Reverse proxy case

```text
Original Workload SVID
→ Front mTLS terminates at Proxy
→ Proxy validates SPIFFE ID
→ Proxy strips untrusted identity headers
→ Proxy creates protected identity metadata
→ Proxy establishes authenticated backend channel
→ Backend authenticates Proxy
→ Backend validates translated original identity evidence
→ Tool dispatch
```

若缺任何一項，Hermes只能得到`PROXY_PEER_CONFIRMED`，不能升格成`ORIGINAL_WORKLOAD_BOUND`。

---

## Visual Simulation Idea

### MCP Peer Identity & Proxy Boundary Microscope

泳道：

`Hermes Workload | SPIRE | TLS | Envoy/LB | MCP HTTP | OAuth | Tool Resolver | Tool Handler | External Resource`

互動故障注入：

- `VALID_OAUTH_WRONG_SPIFFE_WORKLOAD`
- `VALID_SPIFFE_INSUFFICIENT_TOOL_SCOPE`
- `TLS_TERMINATES_AT_PROXY`
- `FORGED_FORWARDED_CLIENT_IDENTITY_HEADER`
- `PROXY_FAILS_TO_STRIP_EXTERNAL_IDENTITY_HEADER`
- `BACKEND_CHANNEL_NOT_AUTHENTICATED`
- `SVID_ROTATES_BETWEEN_PLAN_AND_EXECUTE`
- `TOOL_DEPLOYMENT_REPLACED_AFTER_TLS_CONNECTION_CREATED`
- `SAME_SPIFFE_ID_DIFFERENT_ARTIFACT_DIGEST`

UI不顯示單一「Authenticated ✓」，而顯示：

`Principal ✓ | Caller Workload ✓ | Proxy Boundary ✓ | Server Workload ✓ | Deployment Digest ✓ | Tool Scope ✓ | Effect Authorization ✓ | Receipt ?`

---

## Code / GitHub

### modelcontextprotocol/typescript-sdk

值得繼續讀：

- `examples/scoped-tools/README.md`：HTTP bearer verify與per-tool scope enforcement分層。
- `examples/scoped-tools/server.ts`：handler讀request auth context做scope decision。
- `packages/server/src/server/createMcpHandler.ts`：request context / authInfo如何進handler。
- `docs/serving/http.md`：per-request factory與authInfo propagation。
- host/origin validation middleware：DNS rebinding防護屬transport入口安全，不等於tool authorization。

### SPIRE / SPIFFE

值得繼續讀：

- Workload API X509-SVID streaming/rotation。
- X509-SVID verification與SPIFFE ID URI SAN。
- Envoy SDS：proxy取得SVID並代表workload建立mTLS。
- Delegated Identity / Broker API：identity delegation本身是高權限trust boundary，不能與普通Workload API等同。

---

## Papers / Standards / Official Material

本輪重點是protocol/system architecture，沒有新增一篇足以取代既有經典論文的單篇agent paper；新增的是跨標準identity binding。

1. **SPIFFE X.509-SVID / Workload API specifications** — SPIFFE Project. Architecture：Workload Attestation → SVID → trust bundle → mTLS。Contribution：將runtime workload identity轉為cryptographically verifiable transport identity。Limitation：只直接識別credential/connection peer，不自動綁application-level tool dispatch。
2. **MCP Authorization / HTTP transport documentation** — Model Context Protocol. Architecture：OAuth Resource Server + Bearer token + per-request/handler context。Contribution：principal/scope authorization。Limitation：OAuth principal不是running workload attestation。
3. **SPIRE Envoy SDS integration** — SPIFFE/SPIRE. Architecture：SPIRE Agent → SDS → Envoy → mTLS。Contribution：不修改app也能導入workload mTLS。Limitation：引入proxy identity termination/translation boundary。

---

## Unknown / Open Questions

1. **Proxy identity propagation如何做portable attestation？** 不同Envoy/service mesh對original peer identity的metadata格式不同；Hermes需要vendor-neutral `ForwardedWorkloadIdentityEvidence`。
2. **HTTP/2 connection pooling下如何處理request identity freshness？** 一條長生命mTLS connection可能跨SVID rotation、deployment rollover；要決定哪些高風險call必須重新驗peer/deployment generation。
3. **SaaS MCP server沒有SPIRE時怎麼建立等價proof？** 需要比較mTLS client cert、DPoP、token-bound identity、cloud workload identity federation與vendor-signed runtime attestation。

---

## 下一輪研究

`MCPPeerWorkloadBindingWitness → TLS exporter/channel binding → OAuth sender-constrained token (mTLS/DPoP) → request replay resistance → HTTP/2 connection reuse → reverse-proxy identity propagation → SemanticCommit binding`

目標：回答「即使攻擊者偷到Bearer token，能不能把它從另一個workload重放到同一個MCP server？」並建立 `PrincipalToken ↔ WorkloadKey ↔ TLS/DPoP Proof ↔ SemanticCommit` 的sender-constrained authorization模型。

---

## Knowledge Graph 新增 Node / Edge

### Nodes

- `TransportPeerIdentityGeneration`
- `X509SVIDPeerWitness`
- `MCPRequestIdentityEnvelope`
- `CallerPrincipalIdentity`
- `CallerWorkloadIdentity`
- `ServerWorkloadIdentity`
- `IdentityTerminationBoundary`
- `IdentityTranslationWitness`
- `ForwardedWorkloadIdentityEvidence`
- `ToolDispatchIdentityWitness`
- `PerToolScopeAuthorizationWitness`
- `RequestPeerFreshnessWitness`
- `ProxyPeerConfirmedState`
- `OriginalWorkloadBoundState`

### Edges

- `RunningWorkloadAttestationEvidence --issues→ X509SVIDPeerWitness`
- `X509SVIDPeerWitness --authenticates→ TransportPeerIdentityGeneration`
- `OAuthToken --authorizes→ CallerPrincipalIdentity`
- `TransportPeerIdentityGeneration --does_not_equal→ CallerPrincipalIdentity`
- `ReverseProxy --creates→ IdentityTerminationBoundary`
- `IdentityTerminationBoundary --requires→ IdentityTranslationWitness`
- `MCPRequestIdentityEnvelope --binds→ CallerWorkloadIdentity`
- `MCPRequestIdentityEnvelope --binds→ CallerPrincipalIdentity`
- `MCPRequestIdentityEnvelope --binds→ ServerWorkloadIdentity`
- `ToolResolver --produces→ ToolDispatchIdentityWitness`
- `PerToolScopeAuthorizationWitness --authorizes→ ToolDispatchIdentityWitness`
- `RunningConformanceBindingWitness --must_match→ ToolDispatchIdentityWitness`
- `ToolDispatchIdentityWitness --binds→ SemanticCommitIdentity`

---

## 本輪結論

**缺哪一層：** principal token與workload cryptographic key的sender-constrained binding；目前OAuth bearer token被竊取後仍可能由另一workload重放。  
**哪個節點最淺：** `ForwardedWorkloadIdentityEvidence`。  
**哪個概念仍只是名詞：** vendor-neutral `MCPRequestIdentityEnvelope` / `IdentityTranslationWitness`。  
**哪個系統值得讀原始碼：** MCP TypeScript SDK `createMcpHandler` / scoped-tools dispatch，以及SPIRE Workload API + Envoy SDS。  
**哪篇論文/規格需追引用：** SPIFFE X.509-SVID/Workload API，並轉入OAuth sender-constrained token（mTLS/DPoP）標準。  
**哪個概念最適合視覺模擬：** MCP Peer Identity & Proxy Boundary Microscope。  
**哪個 Agent 架構最值得實作：** `Risk-aware Planner + Runtime Workload Attestation + mTLS Peer Binder + OAuth Principal/Scope Gate + Per-Tool Dispatch Authorization + SemanticCommit + ReceiptVerifier`。

最終鏈條新增了先前缺失的一段：

`Attested Image → Running Workload → X509-SVID → mTLS Peer → Proxy Identity Boundary → OAuth Principal → MCP Request → Tool Dispatch → SemanticCommit → Resource Enforcement → Receipt → Observation`

核心判斷：**Hermes不能因為「server有合法憑證」或「request有合法Bearer token」就認定某次tool call來自預期的已測試workload；高風險tool call需要把runtime workload、transport peer、principal、tool deployment與semantic effect在同一次request中綁成可驗證證據鏈。**