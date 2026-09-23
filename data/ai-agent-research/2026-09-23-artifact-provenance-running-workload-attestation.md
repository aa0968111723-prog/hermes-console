# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-23 08:51（Asia/Taipei）

## 本小時研究主題
**SLSA/Sigstore Artifact Provenance × SPIFFE/SPIRE Running Workload Attestation × Tool Conformance Binding**

本輪承接上一輪最淺節點 `ToolImplementationDigest → RunningInstanceAttestation`，刻意不再重複 ToolAnnotations、OAuth、guardrail、fencing 與 receipt，而補上 supply-chain artifact identity 到實際 running MCP/tool workload identity 的缺口。

---

## 本小時新發現

### 1. Build provenance 證明「artifact 從哪裡來」，不是「現在是哪個 process 在跑」（已確認：SLSA v1.2）
SLSA v1.2 provenance 將 artifact subject 綁到 buildDefinition 與 runDetails；builder.id 代表受信任 build platform 的 trust boundary，resolvedDependencies 可記錄具 digest 的來源與依賴。這足以建立：

`SourceRevision → BuildDefinition → TrustedBuilder → ArtifactDigest`

但它沒有直接證明：

`CurrentNetworkPeer == ProcessRunning(ArtifactDigest)`

所以：

`ValidBuildProvenance --does_not_prove→ RunningInstanceIdentity`

### 2. Sigstore/Cosign 把 signer identity 與 container digest 綁在一起，但仍停在 artifact admission 層（已確認：Sigstore）
Cosign verification 預設驗證 signature payload 中的 container image digest；keyless verification還可驗證 certificate identity 與 OIDC issuer。Sigstore policy-controller會把 image tag resolve 到 digest，以避免 admission 後執行與被驗證的 image 不同。

因此可建立：

`SignerIdentity → Signature → ImageDigest → AdmissionDecision`

但：

`SignedImageDigest --does_not_prove→ RequestCameFromThatRunningImage`

### 3. SPIRE 把 workload identity 拉到 runtime，且 current Docker workload attestor 已能把 image digest / Sigstore verification 納入 selector（已確認：SPIRE 文件 + 原始碼）
SPIRE Agent 在 workload 呼叫 Workload API 時進行 workload attestation，再依 registration conditions 發 SVID。current SPIRE Docker workload attestor 會從 PID 找 container、inspect container/image，加入 image_config_digest selector；若配置 Sigstore verifier，會對 RepoDigests 驗證簽章，驗證成功後加入 Sigstore selectors。

這形成目前最接近 Hermes 所需的橋：

`PID → Container → ImageDigest → SigstoreVerification → WorkloadSelectors → SPIFFE ID/SVID`

但 SPIFFE ID 本身仍不等於 implementation digest；安全性取決於 registration policy 是否真的要求相符的 digest/signature selectors。

### 4. Conformance evidence 必須綁 artifact digest，而 Planner 最終必須驗 running workload evidence（工程模型）
上一輪 `ToolConformanceEvidence` 若只綁 toolName / serverIdentity，deployment replacement 後可能誤用舊證據。本輪改成：

`ConformanceSubject = {toolName, schemaDigest, implementationArtifactDigest, testHarnessDigest, conformanceProfileVersion}`

執行時需要：

`RunningWorkloadEvidence = {spiffeId, svidGeneration, imageDigest, workloadSelectors, attestationAuthority, attestedAt, expiresAt}`

只有：

`ConformanceArtifactDigest == RunningWorkloadImageDigest`

且 SVID/attestation仍有效，才能產生：

`RunningConformanceBindingWitness`

### 5. Identity chain 必須分層，不能把 signature、provenance、workload identity 混成一個 Safe=true（已確認 + 工程推論）
Hermes 應顯式保存：

`SourceIdentity → BuildIdentity → ArtifactIdentity → AdmissionIdentity → WorkloadIdentity → MCPServerIdentity → ToolDeploymentIdentity → SemanticCommitIdentity`

每一條 edge 都要有 evidence。缺一條時，Planner只能降低 evidence score 或阻擋高風險 write tool，不能用同名 tool 或同一 URL 補推論。

---

## 本小時最重要 5 個發現

1. **SLSA provenance ≠ runtime attestation**：它回答 artifact 如何被建置，不回答現在誰在執行。
2. **Cosign signature ≠ peer identity**：digest signature 能保護 artifact identity，但 request 還需要 workload-level identity。
3. **SPIRE current Docker attestor 已出現關鍵 bridge**：PID/container inspect → image digest → optional Sigstore verify → selectors → workload identity。
4. **Conformance evidence 必須 content-addressed**：測過的必須是 artifact digest，而不是 mutable tag、tool name 或 deployment URL。
5. **Planner safety 應驗完整 identity chain**：Source→Build→Artifact→Workload→MCP Server→Tool→SemanticCommit。

---

## Architecture Breakdown

### Artifact-to-Running-Tool Verification Pipeline

`Git Commit / Source Digest`
→ `Build Platform`
→ `SLSA Provenance`
→ `Artifact/Image Digest`
→ `Sigstore Signature / Attestation`
→ `Registry`
→ `Deployment Admission`
→ `Container Runtime`
→ `SPIRE Workload Attestor`
→ `Workload Selectors`
→ `SPIFFE ID / SVID`
→ `MCP Transport Peer Identity`
→ `Tool Deployment Identity`
→ `Tool Capability Registry`
→ `Planner Safety Match`
→ `SemanticCommit`
→ `tools/call`
→ `External Receipt`

### Trust boundaries

A. Build trust：builder.id / provenance signer
B. Artifact trust：digest / signature / attestation
C. Admission trust：policy-controller / deployment policy
D. Runtime trust：node + workload attestor
E. Peer trust：SVID/TLS identity
F. Tool trust：catalog + schema + conformance subject
G. Effect trust：SemanticCommit + fence/idempotency/receipt

---

## Bottom-Level Logic

### Conformance → Runtime binding

```text
artifactDigest = SHA256(tool implementation image)
conformance = Test(artifactDigest, harnessDigest, profileVersion)
provenance = VerifySLSA(artifactDigest)
signature = VerifySigstore(artifactDigest, expectedSigner)
runtime = AttestWorkload(pid/container)

ALLOW_HIGH_RISK_TOOL only if:
  provenance.valid
  AND signature.valid
  AND runtime.imageDigest == artifactDigest
  AND runtime.identity is currently valid
  AND conformance.subjectDigest == artifactDigest
  AND conformance.notExpired
  AND capabilityRequirementsSatisfied
```

### Critical invariants

`SameToolName --does_not_prove→ SameImplementation`

`SameImageTag --does_not_prove→ SameArtifactDigest`

`ValidSignature --does_not_prove→ ConformancePassed`

`ConformancePassed(Artifact A) --does_not_prove→ RunningArtifact == A`

`ValidSPIFFEIdentity --does_not_prove→ ExpectedImplementationDigest`

`RunningConformanceBindingWitness = ArtifactDigestMatch ∧ WorkloadAttestationValid ∧ ConformanceEvidenceFresh ∧ ExpectedSigner/Builder ∧ ToolDeploymentMatch`

---

## Visual Simulation Idea

### Artifact → Running Tool Trust Chain Microscope

互動節點：

`Source | Builder | Provenance | Image Digest | Signature | Admission | Container | SPIRE Attestor | SVID | MCP Server | Tool | Conformance | Planner`

可注入：
- `MUTABLE_TAG_REPOINTED`
- `VALID_SIGNATURE_WRONG_SIGNER`
- `PROVENANCE_VALID_BUT_UNTRUSTED_BUILDER`
- `CONFORMANCE_PASSED_OLD_DIGEST`
- `DEPLOYMENT_REPLACED_AFTER_TEST`
- `SPIFFE_ID_VALID_IMAGE_DIGEST_MISMATCH`
- `SVID_EXPIRED_BETWEEN_PLAN_AND_EXECUTE`
- `MCP_ENDPOINT_SAME_NAME_DIFFERENT_WORKLOAD`

UI 不顯示單一 Safe，而顯示：

`Source ✓ | Build ✓ | Artifact ✓ | Runtime ? | Peer ✓ | Conformance ✗ | Effect Safety ✓ → BLOCK`

---

## Code / GitHub

### spiffe/spire
值得繼續讀：
- `pkg/agent/attestor/workload/workload.go` — workload attestor interface。
- `pkg/agent/plugin/workloadattestor/docker/docker.go` — PID/container lookup、ContainerInspect/ImageInspect、image_config_digest selector、Sigstore verification。
- 下一輪：registration entry matching、SVID issuance、Workload API delivery path。

### sigstore/cosign
值得讀：
- signature verification / verify-attestation path；
- image digest claim verification；
- in-toto attestation verification與policy evaluation。

### Hermes 建議新增 schema

```ts
type RunningConformanceBinding = {
  toolDeploymentId: string;
  artifactDigest: string;
  provenanceDigest: string;
  expectedBuilderId: string;
  signerIdentity: string;
  spiffeId: string;
  svidGeneration: string;
  workloadSelectorDigest: string;
  conformanceEvidenceId: string;
  conformanceProfileVersion: string;
  attestedAt: string;
  expiresAt: string;
};
```

---

## Papers / Standards / Technical Sources

### SLSA Provenance v1.2
- Organization: OpenSSF / SLSA community
- Year: 2026 current approved specification
- Architecture: subject artifact + buildDefinition + runDetails + builder identity
- Contribution: verifiable build provenance linking outputs to build inputs/platform
- Limitation: does not itself attest the currently running process/workload

### Sigstore / Cosign
- Organization: Sigstore / OpenSSF
- Architecture: artifact digest + signature/certificate identity + transparency/attestation ecosystem
- Contribution: content-addressed artifact signature verification and in-toto attestation support
- Limitation: artifact verification alone does not identify a live request peer

### SPIFFE / SPIRE
- Organization: CNCF / SPIFFE community
- Architecture: Server + Agent + node attestation + workload attestation + Workload API + SVID
- Contribution: runtime workload identity issuance based on attested selectors
- Limitation: strength depends on attestor and registration selectors; workload identity must still be bound to expected artifact/conformance evidence

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `SourceRevisionIdentity`
- `BuildPlatformIdentity`
- `SLSAProvenanceGeneration`
- `ArtifactDigestIdentity`
- `ArtifactSignatureIdentity`
- `ArtifactAdmissionWitness`
- `RunningWorkloadGeneration`
- `WorkloadSelectorDigest`
- `SPIFFEWorkloadIdentity`
- `SVIDGeneration`
- `RunningWorkloadAttestationEvidence`
- `ConformanceSubjectDigest`
- `RunningConformanceBindingWitness`
- `MCPPeerWorkloadBindingWitness`

### Edges
- `SourceRevisionIdentity --built_by→ BuildPlatformIdentity`
- `BuildPlatformIdentity --produces→ ArtifactDigestIdentity`
- `SLSAProvenanceGeneration --attests_build_of→ ArtifactDigestIdentity`
- `ArtifactSignatureIdentity --signs→ ArtifactDigestIdentity`
- `RunningWorkloadGeneration --executes→ ArtifactDigestIdentity`
- `SPIFFEWorkloadIdentity --issued_from→ RunningWorkloadAttestationEvidence`
- `ToolConformanceEvidence --tests→ ConformanceSubjectDigest`
- `RunningConformanceBindingWitness --binds→ ToolConformanceEvidence + RunningWorkloadGeneration`
- `MCPPeerWorkloadBindingWitness --binds→ MCPServerIdentity + SPIFFEWorkloadIdentity`

---

## Unknown / Open Questions

1. 如何讓 MCP transport peer identity 強制綁定 SPIFFE/SVID，而不是只由 reverse proxy 驗證後以 header 傳遞？
2. Workload attestation evidence 在 container restart / rolling deploy / SVID rotation 後應如何 generation 化，避免 planner 使用 stale binding？
3. 若工具不是 container，而是 serverless function、WASM、browser extension 或 remote SaaS，應使用什麼等價的 running-instance attestation？

---

## 下一輪研究

鎖定：

`SPIRE registration selector matching → SVID issuance → mTLS peer identity → MCP HTTP transport → reverse proxy boundary → tool deployment identity → per-request workload proof`

並比較：
- SPIFFE X.509-SVID / JWT-SVID；
- Kubernetes service account / projected token；
- cloud workload identity；
- TEE remote attestation（作為更強的 runtime measurement，而非預設必需）。

下一輪目標是建立 `MCPPeerWorkloadBinding`：讓 Hermes 不只知道「部署的是已驗證 image」，還能在每次高風險 tools/call 前證明「目前這條連線的對端，確實是那個已驗證 workload identity」。

---

## 本輪結束判定

**缺哪一層：** running workload identity → MCP transport peer → per-request tool dispatch 的不可替換 binding。

**哪個節點最淺：** `MCPPeerWorkloadBindingWitness`。

**哪個概念仍只是名詞：** 跨 container/serverless/SaaS 可攜的 `RunningConformanceBinding`。

**哪個系統值得讀原始碼：** SPIRE Workload API/SVID issuance + MCP HTTP transport authorization path。

**哪篇論文/規格需追引用：** SLSA Provenance v1.2、SPIFFE/SPIRE workload attestation、in-toto Attestation Framework。

**哪個概念最適合視覺模擬：** Artifact → Running Tool Trust Chain Microscope。

**哪個 Agent 架構最值得實作：**

`Risk-aware Planner + Content-addressed Conformance Registry + SLSA/Sigstore Artifact Verifier + SPIFFE Runtime Identity Binder + MCP Peer Binding Gate + SemanticCommit/Receipt Runtime`

最終鏈條新增：

`UI → Agent → Context → Reasoning → Planning → Tool Candidate → Conformance Evidence → Source/Build Provenance → Artifact Digest → Runtime Workload Attestation → MCP Peer Identity → Tool Dispatch → SemanticCommit → Resource Enforcement → Receipt → Observation → Context → Output`
