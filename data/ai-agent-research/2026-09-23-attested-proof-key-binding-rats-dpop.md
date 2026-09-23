# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-23 11:54 Asia/Taipei

## 本小時新發現

本輪承接上一輪最淺節點 `DPoPKeyThumbprint → SPIFFEWorkloadIdentity`，不再重複 DPoP replay / MCP peer binding，而是追問：**DPoP proof 的 private key 正確，如何證明它屬於目前通過 attestation 的 workload，而不是另一個合法 process/container？**

新架構焦點：`Attested Proof Key Binding`。核心鏈條為：

`Target Environment → Attester → Evidence → Verifier/Appraisal → Attestation Result → Workload Identity → Proof-Key Identity → OAuth cnf.jkt → DPoP Proof → MCP Request → SemanticCommit`

新標準節點：IETF RATS RFC 9334 的 Evidence / Verifier / Attestation Result 模型，以及 2026 年 RFC 9999 RATS Conceptual Message Wrapper，可作為跨 vendor attestation evidence/result 的封裝方向。

## 本小時最重要 5 個發現

### 1. DPoP 證明「持有 key」，不是「這把 key 屬於哪個 workload」
**已確認事實（RFC 9449）：** DPoP access token 透過 `cnf.jkt` 綁 JWK SHA-256 thumbprint；每次 resource request 再用相同 private key 簽 DPoP proof。Resource Server 驗證 proof public key 與 token 的 `jkt`、`ath`、`htm`、`htu` 等。

底層：
`Generate KeyPair → JWK Thumbprint → AS binds token.cnf.jkt → Sign DPoP JWT → RS recomputes/compares jkt → Verify signature`

但 RFC 9449 不提供 workload attestation，因此：
`DPoPProofValid --does_not_prove→ ProofKeyBelongsToAttestedWorkload`

重要性：若另一個 process 可以取得同一 private key，sender constraint 仍成立，但 sender 已不是 Planner 預期的 workload。

### 2. SPIFFE Workload API 的預設 X.509-SVID profile會把 private key交給 workload
**已確認事實（SPIFFE）：** Workload API 可依 OS/kernel metadata辨識呼叫 workload，回傳 SPIFFE ID、X.509-SVID、trust bundle；目前標準 X509SVID message包含未加密 PKCS#8 `x509_svid_key`。SPIFFE文件也描述 private key tied to SPIFFE ID，並以短生命週期與自動 rotation降低暴露風險。

底層：
`Process → local Workload API → OS metadata/workload attestation → Registration Selector Match → SPIFFE ID → X509-SVID + Private Key`

因此：
`SPIFFEIdentityIssued --does_not_prove→ KeyNonExportable`

這是本輪最重要的修正。若 Hermes 要求「DPoP key只能由已 attested workload使用」，不能只把一般可匯出的 SVID key 當 hardware proof。

### 3. Node TPM attestation 與 application proof-key attestation 是不同層
**工程實作（SPIRE/TPM）：** SPIRE 有 TPM node attestation 路徑；例如 `tpm_devid` 會做 proof-of-possession 與 proof-of-residency，驗證 LDevID keypair resides in TPM。Keylime SPIRE plugin則以 nonce取得 TPM attestation-key signed quote，再由 verifier驗證。

但：
`NodeTPMAttested --does_not_prove→ DPoPPrivateKeyIsTPMResident`

Node attestation只證明 Agent/node 的某些 trust claims。若 DPoP key是在 application memory裡生成，仍缺 `DPoPKey ↔ AttestationEvidence` 的直接 cryptographic edge。

### 4. RATS提供正確的「Evidence → Appraisal → Result」分層
**已確認事實（RFC 9334）：** Attester產生 Evidence；Verifier結合 Reference Values、Endorsements與 Appraisal Policy評估 Evidence，再產生 Attestation Results給 Relying Party。RFC也強調 freshness，且 Evidence必須與 Target Environment安全關聯，避免拿另一個較可信 environment 的 evidence冒充。

Hermes因此不應只存 `attested=true`，而要存：
`AttestationEvidenceGeneration → VerifierIdentity → AppraisalPolicyDigest → ReferenceValueSet → AttestationResultGeneration → Freshness`

2026 年 RFC 9999進一步定義 RATS Conceptual Message Wrapper，提供 conceptual messages 的共通封裝結構；它可成為 Hermes portable attestation envelope 的參考，而不是自行發明完全不相容的 wire format。

### 5. 真正需要的是 AttestedProofKeyBindingWitness
**合理架構推論：** Hermes應要求 proof key本身被 attestation result辨識，或由已 attested / isolated key service代簽，然後將 public-key thumbprint綁到 workload/deployment identity。

第一版 witness：
`AttestedProofKeyBindingWitness = H(attestationResultDigest, workloadSpiffeId, deploymentDigest, proofKeyThumbprint, keyProtectionClass, verifierIdentity, issuedAt, expiresAt)`

KeyProtectionClass至少區分：
`PROCESS_MEMORY | AGENT_MANAGED | TPM_RESIDENT | TEE_SEALED | HSM_REMOTE`

高風險工具不應把這些 assurance level視為相同。

## Architecture Breakdown

`UI → Agent/Planner → SemanticCommit → ToolSafetyRouter → Workload Attestation → RATS Evidence → Verifier → Attestation Result → Proof-Key Provisioner → DPoP Key Thumbprint → OAuth AS cnf.jkt → Access Token → MCP Transport → DPoP Proof → Resource Server → Per-Tool Authorization → SemanticRequestDigest → Tool Handler → Effect Runtime → Receipt`

安全決策新增：
`SafeSender = TokenValid ∧ DPoPValid ∧ ProofKeyAttested ∧ WorkloadIdentityMatch ∧ DeploymentDigestMatch ∧ AttestationFresh ∧ SemanticCommitMatch`

## Bottom-Level Logic

以硬體/隔離 proof key為目標的理想流程：

1. `Workload launch`
2. OS / SPIRE workload attestor建立 process/container identity。
3. Attesting Environment收集 node/workload/code measurement claims。
4. Verifier用 endorsement + reference values + appraisal policy驗 Evidence。
5. 產生 fresh Attestation Result。
6. Proof-Key Provider在 TPM/TEE/HSM 或受控 key manager建立 keypair。
7. Evidence/Attestation Result必須包含或安全關聯該 proof public key/thumbprint。
8. OAuth AS只對已通過 appraisal 的 `proofKeyThumbprint` 發 DPoP-bound token (`cnf.jkt`)。
9. MCP request由同一 key簽 DPoP proof。
10. Resource Server驗 token + proof，再查 `AttestedProofKeyBindingWitness` freshness。
11. Hermes再驗 `SemanticRequestDigest`，因 DPoP本身仍不原生保證 MCP body/tool args。
12. Tool handler才可進入 Fence / Idempotency / CAS / Receipt side-effect runtime。

新的 failure cases：
- valid DPoP key，但 key從舊 workload memory被複製；
- valid SPIFFE ID，但 DPoP key不是該 workload attested key；
- node TPM quote valid，但 application binary已換；
- attestation result已過期；
- proof key在 attestation後rotate，但 OAuth token仍綁舊 `jkt`；
- 同 deployment digest，但不同 runtime instance取得可匯出 key。

## Visual Simulation Idea

### Attested Proof-Key Chain Microscope
泳道：
`Workload | SPIRE | TPM/TEE/HSM | RATS Attester | Verifier | OAuth AS | MCP Transport | Resource Server | Tool Handler`

互動注入：
`DPoP_KEY_EXPORTED_TO_OTHER_PROCESS`
`NODE_ATTESTED_APP_NOT_MEASURED`
`ATTESTATION_RESULT_EXPIRED`
`KEY_ROTATED_TOKEN_STILL_OLD_JKT`
`VALID_SPIFFE_ID_WRONG_PROOF_KEY`
`TPM_RESIDENT_KEY_CORRECT_WORKLOAD`
`SEMANTIC_DIGEST_MISMATCH`

UI不要只顯示 Safe/Unsafe，而分解：
`Node Evidence ✓ | Workload Evidence ✓ | Code Measurement ✓ | Proof-Key Residency ? | jkt Binding ✓ | DPoP Fresh ✓ | SemanticCommit Binding ✓`

## Code / GitHub

值得繼續看的 SPIRE 目錄：
- `pkg/agent/plugin/keymanager/`：Agent key manager abstraction。
- `pkg/agent/plugin/keymanager/svidkeymanager.go`：SVID key manager以 A/B key ID rotation，`GenerateKey(..., ECP256)`建立新 key。
- `doc/plugin_agent_nodeattestor_tpm_devid.md`：TPM DevID node attestation，包含 proof-of-possession / proof-of-residency。
- `spiffe/spire-server-attestor-tpm`：TPM-backed server attestation（目前專案自述仍屬 experimental，不應當 production guarantee）。
- `keylime/spire-keylime-plugin`：nonce → TPM AK signed quote → verifier → SPIFFE identity 的工程參考。

## Papers / Standards

1. **RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP)**; Fett et al.; IETF; 2023. Architecture: access-token `cnf.jkt` + per-request signed DPoP proof. Contribution: sender-constrained OAuth token。Limitations: proof key provenance / workload attestation不在規格範圍；request body semantic binding也不是核心保證。
2. **RFC 9334 — Remote ATtestation procedureS (RATS) Architecture**; Birkholz, Thaler, Richardson, Smith, Pan; Fraunhofer SIT / Microsoft / Sandelman / Intel / Huawei; 2023. Architecture: Attester → Evidence → Verifier → Attestation Result → Relying Party. Contribution: vendor-neutral attestation roles/evidence/appraisal/freshness語義。Limitations: architecture/terminology，不指定單一硬體或 wire protocol。
3. **RFC 9999 — RATS Conceptual Message Wrapper (CMW)**; Birkholz, Smith, Fossati, Tschofenig; IETF; 2026. Contribution:為 RATS conceptual messages提供共通 wrapper，可映射 CBOR/JWT/CWT/X.509。改變：讓跨系統傳遞 Evidence/Attestation Result有更標準化的封裝基礎。

## Unknown / Open Questions 1–3

1. SPIRE/SPIFFE ecosystem中，哪條 production-ready path能讓 application DPoP signing key保持 non-exportable，同時又能把 key thumbprint直接綁入 workload attestation result？
2. TPM quote / TEE report應直接攜帶 DPoP public key hash，還是由 attested key broker簽 `workload → proofKey` delegation？哪個 rotation/revocation模型更穩定？
3. Serverless / managed SaaS MCP server無法暴露 TPM/TEE evidence時，Hermes最低可接受的替代 assurance chain應如何分級？

## Knowledge Graph 新增 Node / Edge

Nodes：`ProofKeyIdentity`, `ProofKeyProtectionClass`, `AttestationEvidenceGeneration`, `AttestationVerifierIdentity`, `AttestationAppraisalPolicy`, `AttestationResultGeneration`, `ReferenceValueSet`, `EndorsementSet`, `AttestedProofKeyBindingWitness`, `ProofKeyRotationGeneration`, `KeyResidencyWitness`, `RATSConceptualMessageEnvelope`。

Edges：
- `DPoPProofGeneration --proves_possession_of→ ProofKeyIdentity`
- `DPoPProofGeneration --does_not_prove→ SPIFFEWorkloadIdentity`
- `SPIFFEIdentityIssued --does_not_prove→ ProofKeyNonExportable`
- `NodeTPMAttestation --does_not_prove→ ApplicationProofKeyResidency`
- `AttestationEvidenceGeneration --appraised_by→ AttestationVerifierIdentity`
- `AttestationVerifierIdentity --produces→ AttestationResultGeneration`
- `AttestationResultGeneration --binds→ ProofKeyIdentity`
- `ProofKeyIdentity --thumbprint_bound_to→ OAuthAccessToken`
- `AttestedProofKeyBindingWitness --qualifies→ SenderConstrainedRequest`
- `SenderConstrainedRequest --still_requires→ SemanticCommitBindingWitness`

## 與歷史研究比較

上一輪已建立 `OAuth Principal Token ↔ WorkloadKey ↔ DPoP/mTLS ↔ MCPRequest ↔ SemanticCommit`，但 `DPoPKeyThumbprint → SPIFFEWorkloadIdentity` 仍只是空 edge。本輪把它拆成 RATS Evidence/Appraisal/Result、SPIFFE workload identity、key protection class與 proof-key thumbprint，並確認「一般 X.509-SVID private key可由 Workload API交給 workload」與「TPM node attestation不等於 application DPoP key residency」兩個重要邊界，因此沒有重複上一輪的 replay-store或 `htu/ath/jti` 研究。

## 本輪結束判斷

**缺哪一層：** application proof-key non-exportability / delegation 到 workload identity 的 production protocol。

**哪個節點最淺：** `AttestationResultGeneration → ProofKeyIdentity` 的標準化 claim semantics。

**哪個概念仍只是名詞：** `AttestedProofKeyBindingWitness` 的跨 TPM/TEE/HSM portable schema。

**哪個系統值得讀原始碼：** SPIRE Agent KeyManager / Workload API issuance path，接著 Keylime/TPM attestation verifier。

**哪篇論文/標準需追引用：** RFC 9334 RATS，並追 2026 RFC 9999 CMW 如何承載 vendor-neutral attestation results。

**哪個概念最適合視覺模擬：** Attested Proof-Key Chain Microscope。

**哪個 Agent 架構最值得實作：** `Risk-aware Planner + RATS Attestation Verifier + Attested Proof-Key Broker + DPoP-bound OAuth + SemanticCommit Binder + MCP Per-Tool Authorization + Fenced/Idempotent Effect Runtime + ReceiptVerifier`。

## 下一輪研究

鎖定：`SPIRE Agent KeyManager → Workload API private-key delivery → TPM/PKCS#11/HSM key manager possibilities → Keylime quote claims → EAT/RATS Attestation Result → proof-key delegation certificate → DPoP cnf.jkt rotation/revocation`。

下一個核心問題：**如何讓 Agent workload可以簽 DPoP proof，但永遠拿不到可複製的 raw private key；同時讓遠端 MCP server可驗證「這個 proof key是由目前這個已通過 code/workload attestation 的 instance所控制」？**