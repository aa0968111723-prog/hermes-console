# 【AI Agent × Multimodal Research Report】

時間：2026-09-23 19:53（Asia/Taipei）

主題：Package Artifact → Extracted Member → Install Transformation → Runtime Artifact Binding

## 本小時新發現

本輪承接上一輪最淺節點 `PackageMemberIntegrityWitness`，避免重複 package provenance / Sigstore / SLSA 本身，改追「已驗證 package artifact」如何一路綁到 Agent 此刻真正 import/require/mmap 的 installed member。

核心新鏈：

`Registry Provenance → Package Artifact Digest → Archive Member Digest → Extraction → Installer Transformation → Installed Member Digest → Runtime Resolver → Opened Runtime File Digest → CodeClosureGeneration`

關鍵結論：

`PackageArtifactProvenanceValid --does_not_prove→ InstalledMemberBytesMatch`

`InstallTimeIntegrityValid --does_not_prove→ RuntimeMemberStillUntampered`

`InstalledMemberHashMatch --does_not_prove→ RuntimeActuallyLoadedThatPath`

## 本小時最重要 5 個發現

### 1. Wheel RECORD 是 package→member 的第一個 cryptographic bridge，但不是完整 runtime witness

**已確認事實 / 官方規格**：Wheel 的 `.dist-info/RECORD` 列出 wheel 內幾乎所有檔案及 secure hash；除 RECORD 自身外，wheel 成員必須有 hash，演算法需 SHA-256 或更強。Wheel installer 在 extraction 時應對照 RECORD 驗證 archive member。

來源：Python Packaging Binary Distribution Format / PEP 427。

**底層拆解**：

`wheel digest verified → unzip member → member path → RECORD lookup → member hash → compare bytes → extraction decision`

但 installed environment 的 RECORD semantics 更寬鬆：PEP 627 允許 installed RECORD 的 hash/size 缺省（雖不鼓勵），`.pyc` 與 RECORD 本身也有特殊情況。因此不能把「存在 installed RECORD」等價成「每個 runtime file 都具有強 hash witness」。

新增：`WheelArchiveMemberWitness`、`InstalledRecordMemberWitness`。

### 2. pip 安裝本身會合法改寫/生成檔案，因此 archive-member digest 不一定等於 installed-member digest

**工程實作 / 原始碼**：current pip `src/pip/_internal/operations/install/wheel.py` 會改寫 `#!python` script shebang；對 `changed` files 與 generated files 呼叫 `rehash()`，再建立 installed RECORD rows。這代表 package→runtime binding 不能簡化為 `archive member hash == installed file hash`。

真正需要：

`ArchiveMemberIdentity → InstallerTransformation → InstalledMemberIdentity`

其中 transformation 必須被記錄，而不是把 hash 差異直接當 tamper。

新增：`InstallerTransformationGeneration`、`InstalledMemberIdentity`。

### 3. npm 的 SRI / pacote integrity 主要綁 package tarball，不等於逐一綁住 node_modules runtime members

**官方/工程資訊**：npm package-lock 的 `integrity` 對 registry/remote tarball 使用 Subresource Integrity；pacote 接受 expected integrity，tarball mismatch 會報 `EINTEGRITY`，並可 extract 到目的目錄。npm cache 也是 content-addressable 且在 insertion/extraction 驗證 cache data integrity。

但這個 witness 主要回答：

`FetchedTarball == ExpectedTarball`

不是：

`Runtime node_modules/foo/x.js == OriginalTarMember(x.js)`

因此新增：`TarballIntegrityWitness --does_not_prove→ InstalledTreeMemberIntegrity`。

### 4. npm lifecycle scripts 是 package→installed tree 之間明確的 mutation boundary

**官方資訊**：npm install/ci 在 dependency installation 後會執行 install/postinstall/prepare 等 lifecycle scripts；native addon 也可能由 node-gyp 在 install/rebuild 階段產生 target-specific binary。

所以：

`AttestedTarball → extraction → lifecycle/build scripts → installed tree`

不是 immutable copy pipeline。

Hermes 必須將 lifecycle output 視為新的 build generation：

`InstallGeneration = H(inputTarballDigest, lockfileGeneration, installerIdentity, lifecycleScriptSet, buildEnvironmentIdentity, outputTreeDigest)`

這是 Hermes architecture proposal，不是 npm 現有標準 claim。

對高風險 Agent，可優先使用 `--ignore-scripts` / allow-list policy，或把 lifecycle build 移入可 attestation 的 builder，再把 output digest 當 deployment reference value。

### 5. 最終 runtime witness 必須在「實際 open/load」時 join installed-member identity

上一輪已建立 Runtime Resolver Monitor。本輪把 join point 往下推：

`Resolver result(path/url) → open/stat → file identity → digest/fs-verity identity → package ownership lookup → installed member witness → package provenance witness → policy → CodeClosure event`

所以新增第一版：

`RuntimePackageMemberWitness = H(runtimeResolvedIdentity, runtimeFileDigest, installedMemberDigest, archiveMemberIdentity, packageArtifactDigest, installerTransformationGeneration, provenanceDigest, policyGeneration)`

只有：

`RuntimeFileDigestMatch ∧ InstalledMemberBindingValid ∧ PackageArtifactBindingValid ∧ ProvenancePolicyMatch`

才允許 runtime node從 `OBSERVED` 升級到 `PROVENANCE_BOUND`。

## Architecture Breakdown

System architecture：**Provenance-Bound Runtime Member Gate**

```text
Registry / Provenance
        ↓
Package Artifact Digest
        ↓
Archive Member Manifest
        ↓
Extraction Verifier
        ↓
Installer Transformation Boundary
        ↓
Installed Member Manifest
        ↓
Read-only / fs-verity Deployment
        ↓
Runtime Resolver
        ↓
open/import/require/mmap
        ↓
Runtime File Identity + Digest
        ↓
RuntimePackageMemberWitness
        ↓
CodeClosureGeneration
        ↓
Signer Authorization
```

Python path：

`PEP 740 provenance → wheel SHA256 → wheel RECORD member SHA256 → pip install transform → installed RECORD/output digest → importlib resolution → opened .py/.so digest → closure witness`

Node path：

`npm provenance/signature → package tarball SRI → pacote extraction → lifecycle/build mutation boundary → installed-tree digest manifest → Node resolver → opened .js/.node digest → closure witness`

## Bottom-Level Logic

### Python wheel member binding

`WheelArtifact → ZIP central directory → member bytes → RECORD(path, hash, size) → extraction → optional installer mutation → rehash changed/generated output → installed RECORD → importlib resolved path → runtime bytes → digest compare`

注意：RECORD 的主要 installed-project用途也包含 uninstall inventory；不能假設所有 installed RECORD rows 都一定帶 hash。

### npm tarball member binding

`package-lock integrity → fetch tarball → SRI verification → pacote extraction → node_modules tree → lifecycle scripts/native build → output tree → runtime resolution → require/import → opened member`

npm package-level SRI 是必要但不充分條件。若 install scripts能生成/改寫 bytes，Hermes 必須建立 post-install output-tree manifest 或禁止該 mutation path。

## Visual Simulation Idea

### Package → Runtime Member Integrity Microscope

泳道：

`Registry | Artifact | Archive Member | Installer | Lifecycle Build | Installed Tree | Runtime Resolver | File Open | Code Closure | Signer`

互動 fault injection：

- `WHEEL_RECORD_MEMBER_HASH_MISMATCH`
- `PIP_SCRIPT_REWRITTEN_EXPECTED`
- `INSTALLED_PY_MODIFIED_AFTER_INSTALL`
- `PYC_UNHASHED_OR_STALE`
- `NPM_TARBALL_SRI_VALID_MEMBER_REPLACED_AFTER_EXTRACT`
- `POSTINSTALL_GENERATES_NATIVE_ADDON`
- `NODE_MODULE_FILE_EDITED_AFTER_NPM_CI`
- `SYMLINK_REDIRECT_AFTER_INSTALL`
- `RUNTIME_RESOLVER_LOADS_FILE_OUTSIDE_PACKAGE_MANIFEST`
- `PACKAGE_PROVENANCE_VALID_RUNTIME_MEMBER_UNKNOWN`

關鍵 UI：

`Package provenance ✓ | Artifact digest ✓ | Archive member ✓ | Install transform ✓ | Installed member ✓ | Runtime open digest ✗`

→ `BLOCK HIGH-RISK SIGN`

## Code / GitHub

### pip

值得持續看的目錄/核心檔：

- `src/pip/_internal/operations/install/wheel.py`
  - `rehash()`：對 installed output 做 SHA-256
  - `fix_script()`：安裝時合法修改 shebang
  - `get_csv_rows_for_installed()`：對 changed/generated files 建立新 digest/RECORD rows
- 下一輪：wheel unpacking / metadata parsing / hash-check path，以及 importlib 與 installed RECORD ownership join。

### npm / pacote

- `npm/pacote/lib/fetcher.js`：package fetch/integrity abstraction
- `npm/pacote/lib/file.js`：extract path
- npm lifecycle scripts：install/postinstall/prepare 是明確 mutation boundary
- 下一輪：Arborist reify、bin linking、node-gyp output、symlink/workspace semantics。

## Papers / Specifications

本輪偏工程與規格，沒有把一般論文硬塞進來。

1. **PEP 427 / Wheel Binary Package Format** — Python Packaging — wheel member RECORD secure hashes；改變：建立 archive→member digest mapping。限制：不直接證明安裝後與 runtime load 時的 bytes。
2. **PEP 376 / PEP 627 / Recording installed projects** — Python Packaging — installed RECORD inventory/hash semantics；限制：hash/size可缺省，且 RECORD不是 runtime attestation protocol。
3. **npm package-lock / SRI + pacote integrity** — npm — package tarball integrity；限制：package-level digest不是 installed member / runtime load witness。
4. **npm lifecycle scripts** — npm — 明確證實 installation 後存在 executable mutation/build boundary。

## Unknown / Open Questions

1. 如何建立跨 Python/npm/native 的 canonical `InstalledTreeManifest`，同時正確處理合法 installer transformations、symlink、generated binary與平台差異？
2. runtime file 在 digest 完成後到 mmap/import 真正消費 bytes 之間，如何避免 path replacement / TOCTOU？應優先研究 fd-based hashing + mmap identity + fs-verity。
3. `.pyc`、Node code cache、native addon build output等 derived artifacts，應綁 source artifact、compiler/runtime identity，還是直接視為新的 build provenance generation？

## 下一輪研究

鎖定：

`Runtime path → open fd → inode/mount identity → hash/fs-verity → mmap/import from same fd → rename/symlink/path-replacement TOCTOU → RuntimeArtifactConsumptionWitness`

並深入：

- Linux `openat2()` RESOLVE_* restrictions
- `/proc/self/fd` / fd-based identity
- fs-verity runtime reads
- Python importlib path→open race
- Node loader path→file read race
- container overlayfs copy-up / layer identity

下一個核心問題：

**即使 installed `.py/.js/.so` 在檢查那一刻 hash 完全正確，Hermes 如何證明 runtime 真正執行/解析的就是「同一個已驗證 file object」，而不是 hash 完後 path 被 rename、symlink redirect、overlay copy-up 或 race 換成另一份 bytes？**

## Knowledge Graph 新增 Node / Edge

### Nodes

- `WheelArchiveMemberWitness`
- `InstalledRecordMemberWitness`
- `InstallerTransformationGeneration`
- `InstalledMemberIdentity`
- `TarballIntegrityWitness`
- `InstalledTreeMemberIntegrity`
- `InstallLifecycleMutationBoundary`
- `InstallGeneration`
- `InstalledTreeManifest`
- `RuntimePackageMemberWitness`
- `RuntimeArtifactConsumptionWitness`（下一輪待深化）

### Edges

- `PackageArtifactDigest --contains→ ArchiveMemberIdentity`
- `ArchiveMemberIdentity --transformed_by→ InstallerTransformationGeneration`
- `InstallerTransformationGeneration --produces→ InstalledMemberIdentity`
- `TarballIntegrityWitness --does_not_prove→ InstalledTreeMemberIntegrity`
- `InstallTimeIntegrityValid --does_not_prove→ RuntimeMemberStillUntampered`
- `InstalledMemberHashMatch --does_not_prove→ RuntimeActuallyLoadedThatPath`
- `RuntimeResolvedArtifact --joins→ InstalledMemberIdentity`
- `InstalledMemberIdentity --joins→ ObservedArtifactProvenanceWitness`
- `RuntimePackageMemberWitness --advances→ CodeClosureGeneration`
- `UnexpectedRuntimeMemberDigest --revokes→ SignerUseAuthorization`

## 與歷史研究比較

上一輪回答的是「runtime observed artifact 如何綁 package/source provenance」；本輪補上其中缺失的中間層：**package artifact 不是 runtime file**。Python installer可能合法改寫/生成檔案，npm lifecycle也可能在 extraction後建置 native/output bytes，因此 provenance chain 必須顯式經過 `InstallerTransformationGeneration / InstallGeneration`。下一輪再把「runtime path」提升成「runtime 真正 consumption 的同一 file object」。