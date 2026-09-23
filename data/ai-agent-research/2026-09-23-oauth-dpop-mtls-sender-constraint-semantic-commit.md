# 【AI Agent × Multimodal Research Report】

時間：2026-09-23 10:53 Asia/Taipei

主題：OAuth DPoP / mTLS Sender Constraint × MCP Request Replay Resistance × SemanticCommit Binding

## 與歷史研究比較

上一輪已建立 `MCPPeerWorkloadBindingWitness`，把 SPIFFE/SVID、mTLS peer、reverse proxy、OAuth principal、per-tool dispatch 分開。本輪不重複 workload attestation 或 proxy identity propagation，而是補上一個仍未閉合的安全缺口：**Bearer token 被複製後，另一個 workload 是否能重放同一份授權？**

歷史鏈條：

`Artifact Provenance → Running Workload Attestation → mTLS Peer → OAuth Principal → Tool Dispatch → SemanticCommit`

本輪新增：

`Principal Token → Sender-Constrained Key → Per-Request Proof → Replay Window → Tool Dispatch → SemanticCommit`

核心結論：

`ValidAccessToken --does_not_prove→ PresenterIsAuthorizedWorkload`

`ValidDPoPProof --does_not_prove→ SemanticEffectAuthorized`

`mTLSCertificateBoundToken --does_not_prove→ PerSemanticCommitFreshness`

---

## 本小時新發現

### 1. DPoP 是 application-layer sender constraint，不是單純 token signature

RFC 9449 的 DPoP proof 是 JWT。resource request 至少綁定：

- `jti`：proof identity / replay detection
- `htm`：HTTP method
- `htu`：HTTP target URI
- `iat`：proof issuance time
- `ath`：access-token hash（resource access）
- optional server nonce

因此：

`AccessToken + DPoPPrivateKey → FreshRequestProof`

Resource Server 驗證：

`proof signature → public-key thumbprint → token cnf/jkt → htm → htu → iat → ath → jti replay state → nonce policy`

偷到 access token、但沒有 DPoP private key 的 attacker，不能自行為另一個 request 產生有效 proof。

限制：DPoP 是 application-level proof。若 attacker 能在合法 client 上預先產生 proofs 並外帶，單靠 `iat` 仍有 pre-generation window；RFC 9449 因此說明 server-provided unpredictable nonce 能縮小這個問題。

### 2. `ath` 解決 token substitution，但不是 SemanticCommit binding

DPoP 的 `ath` 把 proof 綁到 access token value，避免 proof 與另一份 access token 交換使用。但 MCP tool call 的 JSON-RPC body / tool arguments / `semanticCommitId` 並不在 RFC 9449 必要 claims 中。

因此：

`DPoP(htm, htu, ath) --does_not_prove→ ToolArgumentsDigestBound`

對 Hermes，高風險 tool call 仍需要額外的 application-layer request binding：

`SemanticRequestDigest = H(protocolVersion || requestId || toolName || canonicalArgumentsDigest || semanticCommitId || toolDeploymentIdentity || approvalGeneration)`

建議在 Hermes-owned gateway/adapter 建立：

`SemanticCommitBindingWitness = Sign_or_MAC(workloadKeyContext, SemanticRequestDigest, senderProofIdentity)`

這不是 RFC 9449 的既有標準 claim，而是 Hermes 的工程 extension；不能把它誤稱為 DPoP 原生能力。

### 3. OAuth mTLS certificate-bound token 是另一種 sender constraint

RFC 8705 定義 certificate-bound access token：token 可帶 `cnf.x5t#S256`，resource server 從實際 mTLS connection 取得 client certificate，計算 thumbprint 並與 token binding 比對。

底層：

`TLS Client Private Key → CertificateVerify → mTLS Session → Client Certificate → SHA-256 Thumbprint → Access Token cnf.x5t#S256 → Match/Reject`

所以 stolen token 無法在沒有相同 certificate private key 的另一端直接使用。

但 mTLS token binding主要綁「token ↔ certificate」，不是每一個 JSON-RPC tool body；HTTP/2 connection reuse 下，多個 requests 可以共用同一 authenticated connection。因此 Hermes 仍要在 MCP dispatch 層把 `requestId / semanticCommit / argumentsDigest` 綁到 authorization decision。

### 4. TLS exporter 是 channel-binding material，但不是 OAuth/DPoP 的自動替代品

RFC 9266 為 TLS 1.3 定義 `tls-exporter` channel binding，使用 TLS Exported Keying Material：

`label = EXPORTER-Channel-Binding`

`context = zero-length`

`length = 32 bytes`

它可讓上層 protocol 把 authentication state 綁到特定 TLS channel。然而：

`TLSExporterAvailable --does_not_prove→ OAuthTokenSenderConstrained`

除非 application protocol 明確把 exporter material 納入 proof/verification，否則它只是可用 primitive。對 Hermes，TLS exporter適合做 `TransportChannelBindingWitness`，不能直接取代 DPoP `jkt` 或 mTLS `x5t#S256`。

### 5. MCP TypeScript SDK 已把 DPoP 放在「真正看得到 method/URL/response」的 transport layer

current MCP TypeScript SDK 的 client auth source說明，DPoP signing 刻意不放在 generic token adapter；當 provider 提供 `dpop()` session 時，transport 以 `withDpopFromProvider` 包住 resource-server fetch，把 Bearer 升級成 DPoP authorization，並對每個 request 產生 proof、處理 nonce challenge。這個位置是正確的，因為只有 transport 知道實際 HTTP method、URL 和 response。

因此 Hermes 不應在 Planner 先產生 DPoP proof；Planner 應產生 semantic intent / effect digest，transport 才產生 sender proof。

---

## 本小時最重要 5 個發現

### 1. Sender constraint 與 authorization 是兩層

是什麼：sender constraint證明「presenter持有被 token 綁定的 key」。

底層：`token cnf → proof/certificate key → request verification`。

為什麼重要：Bearer token theft 不應直接等於 Agent authority theft。

限制：它不證明 tool effect 本身符合 policy。

來源：RFC 9449、RFC 8705。

### 2. DPoP request binding 仍未涵蓋 MCP semantic body

是什麼：標準 DPoP 綁 method、URI、token、proof freshness，但不是任意 request body digest。

底層：`htm + htu + ath + jti + iat [+ nonce]`。

重要性：兩個不同 `tools/call` 若走同一 endpoint，僅靠 `htu` 無法表達 tool arguments 的 semantic identity。

限制：Hermes extension 需要 canonical JSON、versioning 與 server-side verification。

來源：RFC 9449；合理工程推論已明確標示為 Hermes extension。

### 3. Nonce 解決 pre-generated proof 的一部分風險

是什麼：server-issued unpredictable nonce要求 client在看到 challenge後重新用 key 簽 proof。

底層：`server nonce → DPoP proof nonce claim → jti replay cache → verification`。

重要性：降低合法 workload 內 proof 被預先大量產生並外帶後重放的時間窗口。

限制：nonce/jti retention、distributed replay cache、clock skew仍是 runtime問題。

來源：RFC 9449。

### 4. mTLS sender constraint 與 DPoP 有不同部署邊界

mTLS：transport-layer certificate possession，適合 service/workload-to-service；但 TLS termination proxy 會形成 identity boundary。

DPoP：application-layer proof，較容易穿越一般 TLS termination architecture，但 proof key仍需可靠綁到 workload identity。

限制：兩者都不能自行證明 semantic effect authorization。

來源：RFC 8705、RFC 9449、前輪 proxy研究。

### 5. HTTP/2 connection identity 與 request identity不可混為一談

同一 mTLS/TLS connection可以承載多個 MCP requests。connection-level peer identity應產生 `TransportPeerWitness`，每個 request仍需獨立 `RequestAuthorizationWitness` 與 `ToolDispatchIdentityWitness`。

因此：

`SameAuthenticatedConnection --does_not_prove→ SameSemanticCommit`

---

## Architecture Breakdown

建議 Hermes 高風險 MCP HTTP call：

`User Intent`
→ `Planner`
→ `Effect Risk Classification`
→ `ToolSafetyRequirementProfile`
→ `Tool Capability Evidence`
→ `SemanticCommitEnvelope`
→ `CanonicalArgumentsDigest`
→ `AuthorizationBindingWitness`
→ `Access Token (sender-constrained)`
→ `DPoP Proof OR mTLS Certificate Proof`
→ `Transport Peer Verification`
→ `MCP HTTP Parse`
→ `Request Replay Gate`
→ `Per-Tool Scope Gate`
→ `SemanticRequestDigest Verification`
→ `RunningConformanceBinding`
→ `Fence / Idempotency / CAS Gate`
→ `External Effect`
→ `Receipt`
→ `Observation Commit Gate`
→ `Context`
→ `UI`

### DPoP path

`Workload Key K`
→ `JWK thumbprint jkt`
→ `AS issues token bound to jkt`
→ `MCP request created`
→ `proof = Sign_K(jti, htm, htu, iat, ath, nonce)`
→ `RS validates token + proof + replay state`
→ `Hermes validates SemanticRequestDigest`
→ `tool dispatch`

### mTLS path

`Workload Private Key`
→ `X509-SVID / client certificate`
→ `TLS CertificateVerify`
→ `AS issues token with cnf.x5t#S256`
→ `RS obtains actual TLS client certificate`
→ `thumbprint match`
→ `Hermes request/effect authorization`
→ `tool dispatch`

---

## Bottom-Level Logic

### DPoP replay decision

Pseudo invariant：

`DPoP_ACCEPT = SignatureValid ∧ KeyMatchesToken ∧ HTMMatch ∧ HTUMatch ∧ ATHMatch ∧ IATFresh ∧ JTIUnseen ∧ NonceSatisfied`

Hermes 再加：

`TOOL_EXECUTE = DPoP_ACCEPT ∧ PrincipalScopeFit ∧ WorkloadIdentityFit ∧ DeploymentIdentityFit ∧ SemanticDigestMatch ∧ ApprovalFresh ∧ ToolCapabilityFit`

### Distributed replay cache

`jti` 不是只存本機 process memory。若 MCP resource server 多 replica：

`proof → LB → Replica A` 與 replay `proof → LB → Replica B`

若 A/B 不共享 replay state，可能都視為 unseen。因此高風險 DPoP verifier 需要：

`ReplayKey = H(issuer, proofKeyThumbprint, jti, htm, htu)`

並配合原子 `SET-if-absent + expiry` 或 strongly consistent replay store。

這是工程實作要求；RFC 9449規定 replay prevention semantics，但具體 distributed storage是部署責任。

### Semantic request canonicalization

建議：

`CanonicalArgumentsDigest = SHA256(JCS_or_versioned_canonical_encoding(arguments))`

`SemanticRequestDigest = SHA256(protocolVersion || toolDeploymentIdentity || toolName || CanonicalArgumentsDigest || semanticCommitId || approvalGeneration)`

必須 version canonicalization，否則同一 JSON object 的 key ordering / number/string normalization可能造成 verifier disagreement。

---

## Visual Simulation Idea

### Sender-Constrained MCP Replay Microscope

泳道：

`Planner | OAuth AS | Workload Key | MCP Transport | Reverse Proxy | Resource Server | Replay Store | Tool Handler | External Resource`

互動開關：

- Bearer token stolen
- DPoP private key absent/present
- DPoP proof replay
- same `jti` sent to another replica
- server nonce enabled/disabled
- mTLS cert mismatch
- TLS terminates at proxy
- HTTP/2 same connection / different MCP request
- same endpoint, different tool arguments
- SemanticRequestDigest mismatch

視覺結果例：

`Token VALID`
`DPoP key VALID`
`ath VALID`
`jti FRESH`
`htu VALID`
`SemanticCommit DIGEST MISMATCH`
`→ AUTHENTICATED SENDER / EFFECT BLOCKED`

這個畫面可以直觀展示「身份驗證成功」與「這個真實世界修改被授權」不是同一件事。

---

## Code / GitHub

### modelcontextprotocol/typescript-sdk

值得追：

- `packages/client/src/client/auth.ts`：OAuth provider abstraction；source comments明確指出 DPoP request signing必須在看得到實際 method/URL/response 的 transport layer。
- client DPoP session / middleware：`DpopSession`、`withDpopFromProvider`，負責 token_type=DPoP、fresh proof、nonce challenge。
- server authorization docs/path：`requireBearerAuth` / `AuthInfo`；現階段 bearer verification與 per-operation scope是 server boundary的重要基礎，但 sender-constrained verification需要確認具體 server verifier/deployment支援程度。

### panva/oauth4webapi / panva/dpop

值得看：

- DPoP keypair generation
- JWK thumbprint
- proof generation
- nonce cache
- access-token binding
- resource-server JWT/token validation integration

工程提醒：library 驗證函式不等於完整 policy；nonce、scope、`jti` retention等仍可能要求 caller額外處理，需逐 API contract確認。

---

## Papers / Standards

### RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP)
Authors: Daniel Fett, Brian Campbell, John Bradley, Torsten Lodderstedt, Michael B. Jones, David Waite
Institution/affiliations: Authlete, Ping Identity, Yubico, Tuconic, Self-Issued Consulting 等
Year: 2023
Architecture: application-layer sender-constrained OAuth token + per-request signed proof
Contribution: token theft/replay resistance；`jti/htm/htu/iat/ath/nonce`
Limitations: proof pre-generation、replay cache、key compromise；不原生綁 arbitrary MCP request body / SemanticCommit。

### RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens
Authors: Brian Campbell, John Bradley, Nat Sakimura, Torsten Lodderstedt
Year: 2020
Architecture: OAuth token ↔ X.509 certificate thumbprint (`cnf.x5t#S256`) ↔ mTLS possession
Contribution: certificate-bound access/refresh token sender constraint
Limitations: TLS termination topology、certificate rotation；connection identity不是 semantic request identity。

### RFC 9266 — Channel Bindings for TLS 1.3
Author: S. Whited
Year: 2022
Architecture: TLS exporter EKM exposed as channel binding
Contribution: TLS 1.3-compatible `tls-exporter`
Limitations: primitive only；上層 protocol若未使用，不會自動形成 OAuth/MCP binding。

---

## 已確認事實 / 推論邊界

**已確認（標準）**：DPoP 可 sender-constrain OAuth token；resource request proof有 `jti/htm/htu/iat/ath` 等驗證要求；nonce可降低 proof pre-generation/replay window。

**已確認（標準）**：OAuth mTLS certificate-bound token使用 certificate thumbprint confirmation，resource server需將 token binding與實際 TLS client certificate比對。

**已確認（標準）**：TLS 1.3可使用 RFC 9266 `tls-exporter` channel binding。

**已確認（工程原始碼/官方 SDK）**：MCP TypeScript client已設計 DPoP session，request signing位於能看到真實 HTTP request 的 transport middleware，而非 generic token adapter。

**合理工程推論 / Hermes proposal**：`SemanticRequestDigest`、`SemanticCommitBindingWitness`、跨 replica replay-store schema不是 RFC 9449/MCP 標準欄位；是為 Hermes 的高風險 Agent side effect 提出的 runtime contract。

---

## Unknown / Open Questions

1. MCP server-side DPoP verification是否應成為標準 authorization profile，還是由 deployment-specific OAuth resource server完全處理？
2. 如何把 SPIFFE workload key/SVID lifecycle與 DPoP key lifecycle安全綁定，避免「合法 DPoP key存在於錯誤 workload」？
3. SemanticRequestDigest應如何標準化 canonical JSON / binary content / streaming payload，才能跨語言、跨 MCP SDK驗證一致？

---

## 下一輪研究

`DPoP key → SPIFFE workload identity → key provenance / key isolation → TPM/TEE/HSM-backed proof → DPoP nonce/replay store → multi-replica verifier → SemanticRequestDigest canonicalization`

下一輪優先追：

- DPoP key是否能由 workload attestation派生/註冊，而不是任意 app key
- SPIFFE SVID key rotation與 OAuth sender-constrained token lifetime如何協調
- multi-replica nonce / `jti` replay cache correctness
- proxy termination後 DPoP vs mTLS sender constraint的安全差異
- body digest / semantic commit binding是否已有可復用的 HTTP Message Signatures / request-signing標準

---

## Knowledge Graph 新增 Node / Edge

### Nodes

- `SenderConstrainedAccessToken`
- `DPoPProofGeneration`
- `DPoPKeyThumbprint`
- `DPoPJtiReplayWitness`
- `DPoPNonceGeneration`
- `AccessTokenHashBindingWitness`
- `MTLSCertificateBoundToken`
- `CertificateThumbprintBindingWitness`
- `TLSExporterChannelBindingWitness`
- `RequestAuthorizationWitness`
- `SemanticRequestDigest`
- `SemanticCommitBindingWitness`
- `DistributedReplayStateGeneration`
- `HTTP2ConnectionIdentity`

### Edges

`AccessToken --bound_to→ DPoPKeyThumbprint`

`DPoPProof --binds→ HTTPMethod`

`DPoPProof --binds→ HTTPTargetURI`

`DPoPProof --binds→ AccessTokenHash`

`DPoPProof --checked_against→ DistributedReplayState`

`ServerNonce --limits→ ProofPreGenerationWindow`

`MTLSCertificateBoundToken --bound_to→ CertificateThumbprint`

`TLSHandshake --proves_possession_of→ CertificatePrivateKey`

`TLSExporter --derives_from→ TLSChannel`

`AuthenticatedSender --does_not_prove→ SemanticEffectAuthorized`

`HTTP2ConnectionIdentity --contains_many→ MCPRequestIdentity`

`SemanticRequestDigest --binds→ ToolArgumentsDigest`

`SemanticRequestDigest --binds→ SemanticCommitIdentity`

`RequestAuthorizationWitness --gates→ ToolDispatchIdentityWitness`

---

## 本輪結束判斷

**缺哪一層：** sender-constrained key 與 attested workload identity 的 cryptographic provenance binding。

**哪個節點最淺：** `DPoPKeyThumbprint → SPIFFEWorkloadIdentity`。

**哪個概念仍只是名詞：** portable `SemanticCommitBindingWitness`。

**哪個系統值得讀原始碼：** MCP TypeScript SDK DPoP transport + panva/oauth4webapi/dpop verifier path。

**哪篇論文/標準需追引用：** RFC 9449，尤其 proof pre-generation、nonce與 replay prevention；再追 RFC 8705 / RFC 9266。

**哪個概念最適合視覺模擬：** Sender-Constrained MCP Replay Microscope。

**哪個 Agent 架構最值得實作：**

`Risk-aware Planner + Attested Workload Identity + Sender-Constrained OAuth (DPoP/mTLS) + Distributed Replay Gate + SemanticCommit Request Binder + Per-Tool Authorization + Fenced/Idempotent Effect Runtime + ReceiptVerifier`

最終鏈條本輪補成：

`UI → Agent → Context → Reasoning → Planning → Tool Risk → SemanticCommit → Principal Authorization → Workload Key → DPoP/mTLS Sender Proof → Transport → MCP Request → Replay Gate → Per-Tool Authorization → Semantic Request Binding → Tool Runtime → External Effect → Receipt → Observation → Context → Output`

本輪回答的核心問題：**偷到 access token不應等於偷到 Agent 的執行權；但即使 sender proof通過，也仍必須把「誰在呼叫」與「究竟要做哪個 SemanticCommit」分開驗證。**