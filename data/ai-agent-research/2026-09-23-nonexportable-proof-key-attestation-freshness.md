# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-23 12:56 Asia/Taipei

## 本小時主題
Non-exportable Proof Key × PKCS#11/HSM × EAT Freshness × DPoP Workload Binding

## 與歷史研究比較
上一輪建立 `AttestedProofKeyBindingWitness`，但最淺節點仍是 `AttestationResultGeneration → ProofKeyIdentity`：即使 DPoP proof 正確、SPIFFE workload 已 attested，也還沒有證明 proof private key 不可被另一 process 複製。本輪不重複 DPoP sender constraint、SPIFFE identity、RATS 基本架構，而是向下拆到 key object 的 residency / extractability / signer interface，以及 attestation freshness 的實際 failure mode。

## 本小時新發現
1. PKCS#11 已有能表達 key extractability history 的 primitive：`CKA_NEVER_EXTRACTABLE` 為 true 代表 key 從未被設定為 extractable；`CKA_ALWAYS_AUTHENTICATE` 可要求每次 private-key operation 重新認證。但 attribute 是 token/HSM policy evidence，不等於 workload identity binding。
2. SPIRE Agent 的 KeyManager abstraction 回傳的 `Key` 是 `crypto.Signer`，呼叫端可以要求簽章而不必取得 raw private-key bytes；這是把 DPoP signer 改造成 non-exportable signer handle 的重要工程接點。
3. SPIRE Agent 官方文件目前內建 key managers 是 `disk` 與 `memory`；KeyManager plugin 類型明確定位為「generate/store private key，並可用於 hardware binding」。因此「SPIRE 有 KeyManager abstraction」不能誤寫成「SPIRE Agent 預設已把 workload/DPoP key 放進 HSM」。
4. RFC 9711 EAT 將 freshness 明確放入 attestation profile；其 constrained-device standard profile要求每次 token request 使用新的 unique nonce。這證明 attestation result 的可信度不只取決於簽章，也取決於 verifier challenge freshness。
5. 2026 Keylime CVE-2026-6420 是極具價值的真實 failure case：7.14.0–7.14.1 push attestation 使用 hardcoded challenge nonce，使 root attacker 可預先囤積合法 TPM quotes 並在 compromise 後 replay；7.14.2 修復。這直接證明 `SignedQuoteValid --does_not_prove→ EvidenceFresh`。

## 本小時最重要 5 個發現

### 1. Non-exportability 必須成為獨立證據，不可由「硬體 key」文字推論
**概念**：Key Residency / Extractability Evidence。

**底層**：
`GenerateKey inside token → Private Key Object → CKA_EXTRACTABLE=false → CKA_NEVER_EXTRACTABLE=true → Sign(handle, digest) → Signature leaves token; private scalar does not`

**重要性**：Hermes 要的是「workload 可以簽 DPoP proof，但拿不到 raw private key」。

**限制**：PKCS#11 attribute證明 token policy；它本身不證明這個 token、slot、object 就是目前 attested workload被授權使用的那一把 key。

**狀態**：官方標準已確認；workload binding 是 Hermes architecture proposal。

### 2. SPIRE KeyManager 的 `crypto.Signer` 是正確 abstraction boundary
SPIRE source `pkg/agent/plugin/keymanager/keymanager.go` 定義 `KeyManager.GenerateKey/GetKey/GetKeys`；`Key` interface直接嵌入 `crypto.Signer`。因此上層 certificate/SVID signing邏輯可依賴 signer interface，而不是依賴 exportable key bytes。

這提供 Hermes 一個可實作模式：
`DPoP Proof Builder → crypto.Signer-like ProofKeyHandle → PKCS#11/KMS/TPM/HSM backend`

新增 invariant：
`SignerAvailable --does_not_prove→ PrivateKeyExportable`

也反向新增：
`PrivateKeyNotExportedByAPI --does_not_prove→ HardwareNonExportable`

### 3. Attestation freshness 是 proof-key binding 的必要條件
EAT/RATS chain不能只驗：
`signature + measurement + key id`

還要驗：
`challenge nonce + issued time / age + verifier policy + replay state`

建議：
`AttestedProofKeyBindingWitness = H(attestationResultDigest, verifierNonce, workloadSpiffeId, deploymentDigest, proofKeyThumbprint, keyProtectionClass, verifierIdentity, issuedAt, expiresAt)`

若 nonce不可預測性失效，signed evidence可能只是「過去某一刻健康」的 replay。

### 4. Keylime 2026 nonce CVE 是 Agent attestation 的 production counterexample
Keylime GHSA-q8w6-w55c-ccv5 / CVE-2026-6420：affected 7.14.0–7.14.1；fixed 7.14.2。push attestation challenge nonce hardcoded，讓具 root權限攻擊者能事先產生 TPM quotes，compromise 後 replay。

新增 invariant：
`TPMQuoteSignatureValid --does_not_prove→ QuoteFresh`

`AttestationKeyBound --does_not_prove→ CurrentPlatformState`

這也要求 Hermes Console 把 `Cryptographic Validity` 與 `Freshness Validity` 分開顯示。

### 5. DPoP `cnf.jkt` 應綁到 attested signer identity，而不只是 public-key hash
RFC 9449 的 `cnf.jkt` 是 DPoP public JWK SHA-256 thumbprint，resource server用它確認 token與 proof key一致；但它不描述 key storage class。

因此 Hermes需要額外 evidence edge：
`DPoP jkt → ProofKeyIdentity → KeyResidencyWitness → AttestationResult → WorkloadIdentity`

安全判斷更新為：
`SafeSender = TokenValid ∧ DPoPValid ∧ JktMatch ∧ KeyResidencySatisfied ∧ AttestationFresh ∧ WorkloadIdentityMatch ∧ DeploymentDigestMatch ∧ SemanticCommitMatch`

## Architecture Breakdown

### System architecture：Attested Non-Exportable Proof-Key Broker

`Planner`
→ `SemanticCommit Compiler`
→ `Proof-Key Broker`
→ `Workload Identity Gate`
→ `Attestation Result Verifier`
→ `Key Policy Gate`
→ `Signer Handle`
→ `PKCS#11 / TPM / HSM / Remote KMS`
→ `DPoP JWT Sign`
→ `OAuth/MCP Transport`
→ `Resource Server`
→ `jkt + freshness + replay verification`
→ `Tool Authorization`
→ `Effect Runtime`
→ `Receipt`

Broker禁止 `ExportPrivateKey()`；只允許受 policy 約束的 `Sign(canonicalProofDigest)`。

## Bottom-Level Logic

### A. Proof generation
`HTTP method + URI + iat + jti + nonce? + ath`
→ canonical DPoP claims
→ JWS signing input
→ `Sign(handle, digest)`
→ token/HSM performs private-key operation
→ signature returned
→ DPoP JWT

### B. Attested key binding
`VerifierNonce`
→ attester challenge
→ platform/workload measurements
→ proof-key public identity / thumbprint association
→ signed Evidence
→ Verifier checks endorsement/reference values/freshness
→ Attestation Result
→ bind `proofKeyThumbprint + workload + deployment + protectionClass`
→ short-lived Binding Witness

### C. Resource verification
`AccessToken.cnf.jkt`
→ compare DPoP JWK thumbprint
→ verify DPoP signature
→ verify htm/htu/iat/jti/ath/nonce
→ lookup fresh `AttestedProofKeyBindingWitness`
→ require workload/deployment/policy match
→ verify SemanticRequestDigest
→ dispatch tool

## Visual Simulation Idea
### Non-Exportable Proof-Key & Attestation Freshness Microscope
泳道：
`Agent Workload | SPIRE | Proof-Key Broker | HSM/TPM | RATS/EAT Verifier | OAuth AS | MCP Resource Server | Replay Store`

可注入：
- `RAW_KEY_EXPORT_ATTEMPT`
- `CKA_EXTRACTABLE_TRUE`
- `VALID_JKT_WRONG_WORKLOAD`
- `ATTESTATION_NONCE_REUSED`
- `STOCKPILED_TPM_QUOTE_REPLAY`
- `ATTESTATION_RESULT_EXPIRED`
- `KEY_ROTATED_OLD_ACCESS_TOKEN`
- `HSM_SIGNER_VALID_SEMANTIC_DIGEST_MISMATCH`

UI分欄：
`Key Exists | Non-exportable | Signer Authorized | Workload Bound | Measurement Valid | Fresh | jkt Match | DPoP Fresh | Semantic Bound`

## Code / GitHub
### SPIRE
值得繼續讀：
- `pkg/agent/plugin/keymanager/keymanager.go` — KeyManager / `crypto.Signer` boundary
- `pkg/agent/plugin/keymanager/base/` — RPC → key operation bridge
- Agent `svidkeymanager` — key rotation / A-B generation
- `doc/spire_agent.md` — KeyManager deployment semantics

### Keylime
值得讀：
- verifier attestation challenge generation
- quote nonce validation
- fixed path for CVE-2026-6420
- TPM quote / PCR / IMA verification chain

## Papers / Standards
1. **RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP)**. Fett et al., IETF, 2023. Contribution: sender-constrained OAuth token using per-request signed proof and `cnf.jkt`. Limitation: does not attest storage/residency of private key or bind it to workload measurement.
2. **RFC 9711 — The Entity Attestation Token (EAT)**. Lundblade et al., IETF, 2025. Contribution: JWT/CWT attestation-oriented claims and profiles; explicitly handles freshness/profile requirements. Limitation: a profile/system still must define verification-key trust and concrete workload/proof-key semantics.
3. **PKCS #11 v3.1**, OASIS. Contribution: cryptographic token object model and key attributes including extractability/history/authentication constraints. Limitation: does not by itself define remote workload attestation or OAuth semantics.
4. **Keylime / TPM remote attestation implementation**. CNCF project. Contribution: TPM-backed remote integrity verification. 2026 nonce replay vulnerability demonstrates why freshness must be separately verified.

## Unknown / Open Questions
1. 如何標準化 `AttestationResult → DPoP jkt` claim，使 resource server不必理解 TPM/TEE/HSM vendor evidence？
2. Proof-Key Broker 若為 sidecar / daemon，如何證明 requesting process就是被 attested workload，而不是同 node 的另一 process？
3. key rotation時，access token、DPoP `jkt`、attestation result、SemanticCommit inflight request應採何種 generation/overlap window？

## Knowledge Graph 新增 Node
- `NonExportableProofKey`
- `KeyProtectionPolicy`
- `PKCS11KeyObject`
- `KeyExtractabilityWitness`
- `NeverExtractableWitness`
- `SignerHandleGeneration`
- `ProofKeyBrokerIdentity`
- `AttestationFreshnessWitness`
- `VerifierChallengeNonceGeneration`
- `QuoteReplayDetectionWitness`
- `DPoPJktToAttestationBinding`
- `KeyRotationOverlapGeneration`

## Knowledge Graph 新增 Edge
- `DPoPJkt --identifies→ ProofKeyIdentity`
- `ProofKeyIdentity --protected_by→ KeyProtectionPolicy`
- `PKCS11KeyObject --can_provide→ NeverExtractableWitness`
- `SignerHandle --uses_without_export→ NonExportableProofKey`
- `AttestationEvidence --challenged_by→ VerifierChallengeNonceGeneration`
- `AttestationFreshnessWitness --required_for→ AttestedProofKeyBindingWitness`
- `SignedQuoteValid --does_not_prove→ EvidenceFresh`
- `SPIFFEKeyManager --can_abstract→ HardwareBackedSigner`

## 本輪結束判斷
- **缺哪一層**：workload process → local Proof-Key Broker/HSM signer handle 的不可冒用 IPC authorization。
- **哪個節點最淺**：`ProofKeyBrokerIdentity → RequestingProcessIdentity`。
- **哪個概念仍只是名詞**：vendor-neutral `DPoPJktToAttestationBinding` claim/profile。
- **哪個系統值得讀原始碼**：SPIRE KeyManager/base + Keylime 7.14.2 nonce fix；再接 PKCS#11 signer implementation。
- **哪篇/哪份規格需追引用**：RFC 9711 EAT profiles、RFC 9334 RATS、PKCS#11 v3.1；並追 EAT/RATS key attestation profiles。
- **哪個概念最適合視覺模擬**：Non-Exportable Proof-Key & Attestation Freshness Microscope。
- **哪個 Agent 架構最值得實作**：`Risk-aware Planner + Local Attested Proof-Key Broker + Non-exportable Signer + Fresh RATS/EAT Verification + DPoP-bound OAuth + SemanticCommit Binder + Fenced Effect Runtime + ReceiptVerifier`。

## 下一輪研究
鎖定：
`Workload PID/cgroup identity → Unix socket peer credentials / workload API → Proof-Key Broker authorization → PKCS#11 signer handle → key rotation generation → DPoP token rotation → per-request SemanticCommit`

核心問題：即使 private key 已不可匯出，如何阻止同一台 node 上另一個 process 借用合法 signer service 代簽惡意 DPoP proof？下一輪將研究 local IPC peer identity、capability handle、cgroup/container identity、SPIFFE Workload API caller attestation與 signer authorization，補上「不可複製 key」之後仍存在的 confused-deputy gap。