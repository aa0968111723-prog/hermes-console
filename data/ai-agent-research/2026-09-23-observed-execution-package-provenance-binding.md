# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-23 18:52 Asia/Taipei

## 本小時研究主題
**Observed Execution Graph × Package Artifact Provenance × PyPI PEP 740 × npm/Sigstore × SLSA × Runtime Code Closure**

本輪承接上一輪 `Runtime-resolved Code Closure / JITProvenanceWitnessV2`，不重複 resolver、loader、JIT telemetry本身。這輪專門補上上一輪最淺的 edge：

`Runtime observed artifact → ? → approved source/build/package provenance`

核心問題：**即使 Hermes 已經知道 Python/Node Agent 真正 import/require/mmap 了哪些 bytes，如何證明這些 bytes 是由被批准的 source revision、builder、workflow與 registry publication path產生，而不是只是精準量測到一份惡意 package？**

---

## 本小時新發現

### 新架構
`Observed Artifact Provenance Binding`：把 runtime truth 與 supply-chain truth接起來：

`Runtime Resolution Event → Resolved File Digest → Package Artifact Identity → Registry Provenance → Attestation Subject Digest → Builder/Publisher Identity → Source Repository/Commit → Policy Decision → CodeClosureGeneration`

### 新 GitHub / 原始碼
1. `pypi/pypi-attestations/src/pypi_attestations/_impl.py`
2. `npm/cli/lib/commands/audit.js`
3. `npm/cli/lib/utils/verify-signatures.js`
4. `npm/provenance`
5. Sigstore bundle / verification implementation與規格

### 新底層機制
PyPI PEP 740 attestation verification不只驗 signature：current `pypi-attestations` implementation會解析 in-toto subject、比對 distribution filename，再比對 subject SHA-256 與實際 distribution digest；GitHub Trusted Publisher policy還驗 OIDC issuer、source repository URI與 build-config workflow URI。

npm current CLI的 `audit signatures` 則透過 Arborist取得 installed dependency tree，對 registry package要求 pacote `verifySignatures` + `verifyAttestations`，並把 invalid provenance獨立標成 `EATTESTATIONVERIFY`。

---

# 本小時最重要 5 個發現

## 1. Provenance的最小可信單位必須是 artifact digest，不是 package name/version

### 是什麼
`foo@1.2.3` 或 `foo-1.2.3.whl` 只是人類可讀 identity；真正能與 runtime bytes接起來的是 cryptographic digest。

### 底層如何運作
PyPI PEP 740 / in-toto path：

`distribution file → SHA-256 → in-toto Statement.subject.digest → DSSE signature → Sigstore certificate/transparency material → Trusted Publisher policy`

Current `pypi-attestations` source會拒絕：
- subject distribution name不符
- subject沒有 SHA-256
- subject SHA-256 != distribution digest
- unknown attestation predicate

所以 Hermes應建立：

`PackageArtifactIdentity = H(ecosystem, registry, package, version, distributionFilename, artifactDigest)`

而不是只存 package/version。

### 為什麼重要
runtime resolver若載入一個名稱與版本都正確、但 bytes被 mirror/cache/本地路徑替換的 artifact，name/version matching完全不足。

### 限制
artifact digest只證明「這是某一份 bytes」；不證明 builder可信，也不證明 source本身安全。

### 判定
- 已確認：PEP 740 verifier確實綁 subject name + SHA-256 digest。
- 工程設計：Hermes runtime closure以 artifact digest作 provenance join key。

---

## 2. PyPI Publish Attestation 與 SLSA Provenance不能混成同一種保證

PyPI目前支援 `PyPI Publish` 與 `SLSA Provenance` 兩類 attestation。Publish Attestation主要回答：

`這份 release distribution 是否由特定 Trusted Publisher identity發布？`

SLSA Provenance則可回答更多 build/source關係。

因此：

`TrustedPublisherVerified --does_not_prove→ SourceCodeSafe`

以及：

`PublishAttestationValid --does_not_prove→ ReproducibleBuild`

PyPI自己的 security model也明確區分「來源/identity可驗證」與「程式值得信任」。

Hermes新增：

`PackagePublishIdentityWitness`
`PackageBuildProvenanceWitness`
`PackageTrustPolicyDecision`

Verifier UI必須分開顯示：

`Artifact Digest ✓ | Publisher ✓ | Build Provenance ✓/? | Source Revision ✓/? | Policy Trust ✓/?`

---

## 3. npm 已有從 installed tree 回查 registry signature/provenance 的 production verification path

Current npm CLI：

`npm audit signatures`
→ Arborist `loadActual()`
→ installed dependency edges
→ registry/TUF verification keys
→ `pacote.manifest(name@version, verifySignatures=true, verifyAttestations=true)`
→ signatures / attestations / attestation bundles
→ invalid attestation => `EATTESTATIONVERIFY`

npm官方 provenance path還會把 published tarball subject與 package name/version/tarball digest、repository與 signing certificate claims比對。

這代表 Hermes不需要自己發明 Node package provenance ecosystem；可把 npm verification結果轉成 Knowledge Graph witness。

但：

`npm audit signatures PASS --does_not_prove→ Runtime loaded bytes came from audited package tree`

因為上一輪已證明 runtime loader hook、NODE_PATH、custom resolver、symlink/native addon等可能讓 observed execution graph偏離 declared/installed graph。

所以真正需要的是 join：

`npm Provenance Result ↔ Installed Artifact Digest ↔ Runtime Resolved Artifact Digest`

---

## 4. Sigstore bundle是一個 verification package，不等於 trust policy

Sigstore bundle可以攜帶：
- signing certificate / public-key material
- DSSE/message signature
- transparency log entry
- signed entry timestamp / inclusion proof
- RFC3161 timestamp material

因此可讓 verifier離線或延後驗證 artifact signature、identity與 signing-time evidence。

但：

`SigstoreBundleCryptographicallyValid --does_not_prove→ SignerAllowedByHermesPolicy`

Hermes仍需要 reference policy：

`AllowedRepository`
`AllowedWorkflow`
`AllowedBuilderIdentity`
`AllowedSourceRef/Commit`
`AllowedRegistry`
`RequiredPredicateType`
`MinimumProvenanceLevel`

所以新增：

`SupplyChainPolicyGeneration`
`AttestationCryptographicWitness`
`AttestationIdentityPolicyWitness`

這與前面 runtime attestation得到同一個核心原則：**Evidence ≠ Policy Decision**。

---

## 5. Code Closure應由「runtime artifact witness」和「supply-chain witness」做雙向 join

上一輪只有：

`Resolver → Resolved Artifact → Executed Module → CodeClosureGeneration`

本輪升級為：

`RuntimeArtifactWitness`
`↓ digest equality`
`PackageArtifactIdentity`
`↓ subject digest`
`RegistryAttestation`
`↓`
`Builder/Publisher Identity`
`↓`
`Source Revision`
`↓`
`SupplyChainPolicyDecision`

只有 join成功，該 code node才可從：

`OBSERVED`

升級成：

`PROVENANCE_BOUND`

再依 policy升級成：

`APPROVED_FOR_HIGH_RISK_EXECUTION`

提出：

`ObservedArtifactProvenanceWitness = H(runtimeArtifactDigest, packageArtifactDigest, attestationDigest, sourceRevision, builderIdentity, publisherIdentity, policyGeneration)`

這是 Hermes architecture proposal，不是 PEP 740/SLSA既有欄位。

關鍵否定邊：

`ObservedArtifactDigestKnown --does_not_prove→ ProvenanceKnown`

`ProvenanceKnown --does_not_prove→ PolicyApproved`

`PolicyApprovedAtInstall --does_not_prove→ RuntimeArtifactStillSame`

---

# Architecture Breakdown

## Runtime-to-Supply-Chain Binding Architecture

```text
User Request
  ↓
Agent Planner
  ↓
SemanticCommit
  ↓
Runtime Resolver / Loader
  ↓
Resolved Runtime Artifact
  ↓
RuntimeArtifactDigest
  ├────────────────────────────────────────────┐
  │                                            │
  │ digest equality                            │
  ↓                                            │
Installed/Downloaded Package Artifact          │
  ↓                                            │
PackageArtifactDigest                          │
  ↓                                            │
Registry Provenance / Attestation              │
  ↓                                            │
DSSE / Sigstore Verification                   │
  ↓                                            │
Attestation Subject Digest ────────────────────┘
  ↓
Publisher / Builder Identity
  ↓
Source Repository + Revision + Workflow
  ↓
SupplyChainPolicyGeneration
  ↓
ObservedArtifactProvenanceWitness
  ↓
CodeClosureGeneration
  ↓
Runtime Attestation
  ↓
Signer Authorization
  ↓
DPoP → MCP → Tool → Effect → Receipt
```

核心公式：

`ProvenanceBoundCodeNode = RuntimeDigestMatch ∧ AttestationSubjectMatch ∧ SignatureValid ∧ TransparencyEvidenceValid ∧ PublisherPolicyMatch ∧ BuilderPolicyMatch ∧ SourcePolicyMatch`

對高風險 Agent：

`SignerAllowed = CodeClosureComplete ∧ EveryExecutableNode.ProvenanceBoundOrExplicitlyExempt ∧ ClosurePolicyFresh`

---

# Bottom-Level Logic

## Python wheel path

```text
import foo
→ sys.meta_path
→ ModuleSpec
→ loader
→ resolved .py/.pyc/.so path
→ hash resolved bytes
→ determine owning wheel/distribution
→ obtain wheel artifact digest
→ fetch PyPI provenance object
→ parse PEP 740 attestation
→ verify DSSE/Sigstore material
→ verify subject filename
→ verify subject SHA-256 == wheel digest
→ verify Trusted Publisher / SLSA identity policy
→ bind resolved module digest to wheel membership
→ create ObservedArtifactProvenanceWitness
→ add node to CodeClosureGeneration
```

注意：最後還缺一個非常重要的問題——**wheel-level digest如何精準證明某個 extracted file就是該 wheel內的那個 member？** Python wheel的 `RECORD` 會成為下一輪的重要節點。

## npm path

```text
require/import package
→ runtime resolver
→ resolved JS/native-addon file
→ runtime file digest
→ locate owning package root
→ installed package identity
→ package tarball/integrity identity
→ npm registry provenance/signature lookup
→ Sigstore attestation verification
→ subject tarball digest match
→ repository/workflow/builder policy
→ bind runtime file to installed package artifact
→ ObservedArtifactProvenanceWitness
→ CodeClosureGeneration
```

同樣缺一層：tarball provenance是 package-level，而 runtime執行的是 extracted member file；需要 `PackageMemberIntegrityWitness`。

---

# Visual Simulation Idea

## **Runtime → Package → Source Provenance Microscope**

### 泳道
`Runtime Resolver | File System | Package Manager | Registry | Sigstore | Builder | Source Repo | Policy Engine | Code Closure`

### 互動事件
- `PYPI_WHEEL_ATTESTATION_VALID`
- `PYPI_PUBLISHER_CHANGED`
- `WHEEL_DIGEST_MISMATCH`
- `NPM_TARBALL_PROVENANCE_VALID`
- `RUNTIME_FILE_NOT_OWNED_BY_ATTESTED_PACKAGE`
- `LOCAL_EDIT_AFTER_INSTALL`
- `NODE_LOADER_REDIRECT_TO_UNATTESTED_FILE`
- `VALID_SIGSTORE_BUNDLE_WRONG_REPOSITORY`
- `VALID_PUBLISH_ATTESTATION_NO_SLSA_PROVENANCE`
- `SOURCE_COMMIT_POLICY_REVOKED`
- `ATTESTATION_VALID_BUT_PACKAGE_MEMBER_CHANGED`

### UI狀態
```text
Runtime file digest      ✓
Package ownership        ✓
Package artifact digest  ✓
Attestation signature    ✓
Publisher identity       ✓
Build provenance         ✓
Source revision          ✓
Member integrity         ?
Hermes policy            ✓
---------------------------
Closure node: PARTIALLY PROVENANCE-BOUND
High-risk signer: BLOCK
```

---

# Code / GitHub

## pypi/pypi-attestations
值得看的核心：
- `src/pypi_attestations/_impl.py`
  - distribution/subject name matching
  - SHA-256 subject digest matching
  - Sigstore Bundle ↔ PEP 740 Attestation conversion
  - GitHub Trusted Publisher verification policy
- `src/pypi_attestations/_cli.py`
  - package/provenance verification CLI flow

本輪確認 current `_impl.py` 會把 attestation subject解析成 distribution identity並驗 SHA-256；GitHub policy驗 `token.actions.githubusercontent.com` issuer、source repository URI、build-config URI與 workflow。

## npm/cli
值得看的核心：
- `lib/commands/audit.js`
- `lib/utils/verify-signatures.js`
- downstream `pacote` signature/attestation verification

Current CLI會從 actual installed tree建立驗證集合，取得 TUF/registry keys，再對 package啟用 `verifySignatures` / `verifyAttestations`。

## npm/provenance
值得追：
- npm publish provenance generation
- server-side package subject / repository / certificate claim validation
- registry publish attestation

## Sigstore
值得追：
- bundle protobuf format
- DSSE envelope
- Fulcio certificate identity
- Rekor inclusion proof / SET
- TUF trust-root distribution

---

# Papers / Standards / Technical Reports

## PEP 740 / PyPI Digital Attestations
- Institution/community: Python Packaging Authority / PyPI
- Architecture: in-toto attestation + Sigstore + Trusted Publishing
- Contribution: distribution-level signed provenance/publish claims
- Limitation: attestation證明來源/identity claims，不自動證明 code值得信任；package-level artifact與runtime extracted member仍需額外 binding。

## SLSA Provenance
- Institution: OpenSSF / SLSA community
- Architecture: in-toto Statement subject + provenance predicate
- Contribution:把 artifact與 build/source metadata建立可驗證關係
- Limitation: verifier仍需 builder/source trust policy；provenance不是 malware/vulnerability proof。

## Sigstore Bundle
- Architecture: verification material + signature/DSSE content + transparency/timestamp evidence
- Contribution:攜帶足夠 verification evidence，支援 identity-based signing與透明度驗證
- Limitation: cryptographic validity不等於 Hermes policy approval。

---

# 與歷史研究比較

前一輪得到：

`DeclaredDependencyGraph ≠ ObservedExecutionGraph`

本輪補上：

`ObservedExecutionGraph ≠ ProvenanceBoundExecutionGraph`

因此現在有三層：

```text
DeclaredDependencyGraph
        ↓ runtime resolution
ObservedExecutionGraph
        ↓ artifact/provenance join
ProvenanceBoundExecutionGraph
        ↓ Hermes trust policy
ApprovedExecutionGraph
```

這避免重複上一輪 resolver/JIT研究，並把研究向 supply-chain truth前進一層。

---

# Unknown / Open Questions

1. **Package member integrity**：wheel/tarball整體 digest已驗證後，如何低成本、可增量地證明 runtime resolved `.py/.js/.so` 是該已驗 artifact內的原始 member，而不是 extraction後被改寫？
2. **Editable/local installs**：Python editable install、npm link/workspace/git dependency沒有普通 registry artifact時，應如何建立 source-tree provenance witness？
3. **Native build/install scripts**：npm lifecycle script或 Python build backend在 install time產生新的 native/generated code時，package provenance如何延伸到 installation-derived artifact？

---

# 下一輪研究

鎖定：

`Package Artifact → Extracted Member → wheel RECORD / npm integrity → install-time transformation → local cache → runtime file → PackageMemberIntegrityWitness`

深入：
- Python wheel `.dist-info/RECORD` hash semantics
- pip install extraction與 RECORD verification/limitations
- npm tarball `dist.integrity` / pacote cache / extraction
- npm lifecycle scripts與 generated artifacts
- Python editable installs / PEP 660
- native wheel / node-gyp install-time outputs
- content-addressed package store（pnpm/Nix類設計作比較）

目標是回答：

**registry上的 wheel/tarball已被 provenance驗證，如何證明 Agent 此刻 mmap/import/require 的那個 extracted file，仍然就是該 artifact中的那份 bytes？**

---

# Knowledge Graph 新增 Node

- `PackageArtifactIdentity`
- `PackageArtifactDigest`
- `RegistryProvenanceObject`
- `PackagePublishIdentityWitness`
- `PackageBuildProvenanceWitness`
- `AttestationSubjectDigest`
- `AttestationCryptographicWitness`
- `AttestationIdentityPolicyWitness`
- `SupplyChainPolicyGeneration`
- `RuntimeArtifactWitness`
- `ObservedArtifactProvenanceWitness`
- `ProvenanceBoundExecutionGraph`
- `ApprovedExecutionGraph`
- `PackageMemberIntegrityWitness`（open）
- `InstallTransformationGeneration`（open）

# Knowledge Graph 新增 Edge

```text
RuntimeArtifactWitness
  --digest_matches→ PackageArtifactIdentity

RegistryProvenanceObject
  --attests_subject→ PackageArtifactIdentity

PackageBuildProvenanceWitness
  --built_from→ SourceRevisionIdentity

PackagePublishIdentityWitness
  --published_by→ PublisherIdentity

AttestationCryptographicWitness
  --does_not_prove→ AttestationIdentityPolicyWitness

ObservedArtifactProvenanceWitness
  --upgrades→ ObservedExecutionGraph
  --to→ ProvenanceBoundExecutionGraph

ProvenanceBoundExecutionGraph
  --policy_evaluated_by→ SupplyChainPolicyGeneration
  --may_upgrade_to→ ApprovedExecutionGraph

PackageArtifactDigest
  --does_not_prove_yet→ ExtractedRuntimeMemberIntegrity
```

---

# 本輪結束判定

**缺哪一層？**
Package artifact → extracted runtime member 的 cryptographic binding，以及 install-time generated code provenance。

**哪個節點最淺？**
`PackageMemberIntegrityWitness`。

**哪個概念仍只是名詞？**
跨 npm/PyPI/native artifact 的 portable `ObservedArtifactProvenanceWitness` envelope。

**哪個系統值得繼續讀原始碼？**
`pip` wheel install / RECORD handling、`pacote` tarball integrity/extraction、npm lifecycle install pipeline。

**哪篇論文/規格需追引用？**
SLSA Provenance / in-toto attestation model，以及 PEP 740 在 package ecosystem的後續 deployment研究。

**哪個概念最適合視覺模擬？**
`Runtime → Package → Source Provenance Microscope`。

**哪個 Agent 架構最值得實作？**

`Risk-aware Planner + Runtime Resolver Monitor + Provenance-bound Code Closure + Supply-chain Policy Engine + Runtime Attestation + Non-exportable Signer + DPoP/MCP + SemanticCommit/Receipt Runtime`

最終鏈條再補一段：

`User → UI → Agent → Context → Reasoning → Planning → Runtime Resolver → Executed Bytes → Package Artifact → Registry Attestation → Builder → Source Revision → Trust Policy → CodeClosure → Runtime Attestation → Signer → MCP Tool → Effect → Receipt → Output`
