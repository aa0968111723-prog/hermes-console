# 【AI Agent × Multimodal Research Report】

時間：2026-09-23 20:56（Asia/Taipei）

主題：Runtime Artifact Consumption Witness × openat2 × File Descriptor Identity × fs-verity × OverlayFS

## 本小時新發現

本輪承接上一輪最淺節點 `RuntimeArtifactConsumptionWitness`，避免重複 package provenance / installed-member hashing，改追「已驗證 runtime path」如何綁到 interpreter / dynamic loader 真正消費的同一個 file object。

核心新鏈：

`Resolved Path → constrained pathname lookup → open file descriptor → open file description → file-object identity → fs-verity/digest on that object → read/mmap from same object → RuntimeArtifactConsumptionWitness → CodeClosureGeneration`

關鍵結論：

`PathHashVerified --does_not_prove→ LaterPathOpenConsumesSameObject`

`PathNameStable --does_not_prove→ FileObjectStable`

`OverlayPathIdentity --does_not_prove→ UnderlyingLayerIdentityStable`

`fs-verity digest + reads from same verity file object` 是比「先 hash(path)，再重新 open(path)」更強的 runtime consumption primitive。

## 本小時最重要 5 個發現

### 1. Linux fd 是 path→consumption TOCTOU 的真正 join point

**已確認事實 / Linux API**：`open()` 成功後建立 open file description，file descriptor 是它的 reference；即使 pathname 後續被 unlink、rename 或改成指向別的檔案，既有 fd 仍引用原先 open 的 file description。

因此 Hermes 不應：

`hash(path) → close → runtime open(path)`

而應朝：

`secure open(path) → fd → verify(fd) → consume(fd)`

設計。

新增 `OpenedFileObjectGeneration`、`FileDescriptorConsumptionBinding`。

### 2. openat2 RESOLVE_* 能把 hostile pathname resolution 約束在 kernel lookup 階段

`openat2()` 的 `RESOLVE_BENEATH` 可阻止 path escape 起始 dirfd；`RESOLVE_NO_SYMLINKS` 禁止所有 symlink traversal；kernel pathname lookup 文件也說明這些 flags 是為了降低 changing path components 所造成的 race / attack scenario。

因此高風險 Agent 的 package root 可採：

`trusted root dirfd → openat2(relative path, RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS)`

再對回傳 fd 建 witness。

但：`openat2 restrictions --does_not_prove→ file bytes approved`，它解的是 resolution confinement，不是 provenance。

新增 `ConstrainedPathResolutionWitness`。

### 3. fs-verity 可把「驗證 digest」與「之後 read/mmap 的 bytes」綁得更緊

Linux fs-verity 對啟用後的 read-only file 建 Merkle tree；之後所有 reads（包含 mmap reads）由 filesystem 自動對 Merkle tree 驗證。`FS_IOC_MEASURE_VERITY` 可取回 kernel 正在 enforcement 的 file digest。

所以更強路徑是：

`open fd → FS_IOC_MEASURE_VERITY(fd) → compare approved digest → read/mmap same verity file`

而不是 userspace hash 後再次依 path 開檔。

新增 `VerityEnforcedConsumptionWitness`。

限制：fs-verity只證明該 file content與 digest；不自行證明 package/source provenance，仍需 join 上一輪 `RuntimePackageMemberWitness`。

### 4. CPython 已有 code-open interception primitive，但 path hook 仍不是完整 fd consumption protocol

Current CPython `importlib/_bootstrap_external.py` 的 `FileLoader.get_data()` 對 `SourceLoader / SourcelessFileLoader / ExtensionFileLoader` 使用 `_io.open_code(path)` 讀取 code bytes。`io.open_code()` 可由 `PyFile_SetOpenCodeHook()` 覆寫，官方定位就是在 executable-code open 時做額外 validation / preprocessing。

這提供 Hermes 一個可落地 prototype hook：

`importlib → io.open_code(path) → Hermes open-code hook → constrained open + fd verification → return file object`

但本輪也找到 2026 CPython security issue CVE-2026-2297 的脈絡：舊的 SourcelessFileLoader path 曾繞過 `io.open_code()`，current source已把 SourcelessFileLoader納入 open_code 分支。這是一個重要教訓：runtime consumption coverage 必須逐 loader 驗證，不能只假設單一 hook覆蓋全部 code path。

### 5. OverlayFS 讓 inode/path identity不能被當成 portable artifact identity

Linux OverlayFS 對 lower regular file 發生需要 write 的操作時會 `copy_up` 到 upper layer；之後 merged path提供 upper object。官方文件也指出某些配置下 `st_ino/st_dev` 不保證像一般 filesystem 一樣持久穩定。

所以：

`(st_dev, st_ino)` 可作 local file-object diagnostic witness，但不能單獨當 supply-chain identity。

Hermes 應分離：

`Consumption Object Identity`（fd / mount / inode / generation）

與

`Artifact Content Identity`（fs-verity digest / cryptographic digest）

以及

`Supply-chain Identity`（package artifact + provenance）。

## Architecture Breakdown

System architecture：**FD-Bound Runtime Artifact Consumption Gate**

```text
Runtime Resolver
   ↓ resolved relative path
Trusted Package Root dirfd
   ↓
openat2 + RESOLVE_* policy
   ↓
Opened File Descriptor
   ↓
fstat/statx + mount/file-object metadata
   ↓
FS_IOC_MEASURE_VERITY or fd-based digest
   ↓
join InstalledMember + Package Provenance
   ↓
RuntimeArtifactConsumptionWitness
   ↓
consume bytes from SAME opened object
   ↓
compile / parse / mmap / dlopen strategy
   ↓
CodeClosureGeneration++
   ↓
Signer Authorization
```

Python prototype：

`Finder → ModuleSpec → FileLoader → io.open_code(path) → Hermes OpenCodeHook → openat2 → verify fd → return verified file object → read → compile`

Native `.so` path仍需額外處理 dynamic loader 的 reopen semantics；不能因 Python source path完成 fd binding就宣稱 native loader也完成。

## Bottom-Level Logic

### Path vs file object

`pathname` 是 lookup input；`fd` 是成功 lookup後對 open file description 的 reference。若驗證後再次用 pathname open，攻擊者仍可能在兩次 lookup間改 namespace。若 verifier 與 consumer共享同一 fd/open file object，rename/unlink 本身不會讓 fd突然改指向另一 pathname target。

### Secure resolution

`root dirfd → relative member path → openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS) → fd`

這可阻止多類 symlink/magic-link/path escape，但不是 cryptographic integrity。

### Verity consumption

`fd → FS_IOC_MEASURE_VERITY → approved digest match → read/mmap → filesystem verifies Merkle path on every page/read`

這是目前最接近 `verified object == consumed object` 的 kernel-native file-backed primitive。

### OverlayFS

`lower member → merged lookup → write/metadata event → copy_up → upper member`

因此 path相同不代表 backing object generation相同；Hermes應在 consumption event記錄 mount/file-object witness與content digest，而不是只記 merged path。

## Visual Simulation Idea

### Path → FD → Bytes Consumption Microscope

泳道：

`Runtime Resolver | VFS Path Lookup | openat2 | FD Table | OverlayFS | fs-verity | Python/Node Loader | mmap/dlopen | Code Closure | Signer`

fault injection：

- `SYMLINK_SWAP_BEFORE_OPEN`
- `PATH_RENAME_AFTER_HASH`
- `PATH_REPLACED_AFTER_VERIFICATION`
- `OPENAT2_BENEATH_ESCAPE`
- `MAGICLINK_PROC_FD_REDIRECT`
- `OVERLAY_COPY_UP_AFTER_PATH_CHECK`
- `FD_VERIFIED_PATH_REOPENED`
- `FS_VERITY_DIGEST_MISMATCH`
- `SOURCE_LOADER_VERIFIED_NATIVE_LOADER_UNCOVERED`
- `SAME_PATH_DIFFERENT_FILE_OBJECT`

關鍵 UI：

`Resolved path ✓ | Secure lookup ✓ | FD object ✓ | Verity digest ✓ | Provenance ✓ | Same-object consumption ✓`

若最後一格是 `?`：

→ `CODE CLOSURE CONSUMPTION INCOMPLETE → BLOCK HIGH-RISK SIGN`

## Code / GitHub

### CPython

值得看的 current source：

- `Lib/importlib/_bootstrap_external.py`
  - `FileLoader.get_data()`：SourceLoader / SourcelessFileLoader / ExtensionFileLoader 走 `_io.open_code()`
  - `SourceFileLoader`：source path→bytes
  - `SourcelessFileLoader`：pyc bytes→code object
  - `ExtensionFileLoader`：native extension boundary
- `PyFile_SetOpenCodeHook()`：可在 interpreter初始化前安裝 code-open hook。

### Linux kernel / VFS

- pathname lookup / `openat2()` RESOLVE flags
- fs-verity `FS_IOC_MEASURE_VERITY`
- OverlayFS copy_up / origin semantics

下一輪應直接追：dynamic loader / `dlopen()` 如何從 pathname轉成 file mapping；Node internal module source讀取是否能建立同等 fd-bound hook；以及 `execveat(fd, "", ..., AT_EMPTY_PATH)` / fd-oriented execution primitive。

## Papers / Specifications

本輪以 OS/runtime 原始機制為主，沒有為了格式硬塞一般 Agent 論文。

1. **Linux open/openat2 + Pathname Lookup documentation** — Linux/man-pages/kernel docs — 提供 open file description 與 restricted path resolution；限制：不是 provenance/integrity system。
2. **fs-verity** — Linux kernel — file-level Merkle-tree integrity，reads/mmap自動驗證；限制：只保護 file content，不回答 source/build trust。
3. **CPython io.open_code / PyFile_SetOpenCodeHook** — Python runtime — code-open validation interception；限制：coverage取決於各 loader是否真正走該 path。
4. **OverlayFS documentation** — Linux kernel — copy_up與inode identity caveats；限制：描述 filesystem semantics，不直接提供 runtime attestation witness。

## Unknown / Open Questions

1. 如何讓 CPython/Node/native dynamic loader都真正「consume the same verified fd」，而不是 verifier驗 fd後 runtime內部再次按 path reopen？
2. `dlopen()` / ELF loader 的 fd-oriented binding應如何做，且不破壞 dependency resolution、RPATH/RUNPATH semantics？
3. OverlayFS/container環境中，如何把 merged file object、lower/upper origin、container image layer digest與 fs-verity/content digest形成可遠端驗證的 canonical witness？

## 下一輪研究

鎖定：

`Verified fd → interpreter/compiler/native loader consumption → dlopen/ELF mapping → execveat/fexecve → Node module source ingestion → same-object execution witness`

並研究：

- glibc dynamic loader / `dlopen()` source path
- `execveat(AT_EMPTY_PATH)` / `fexecve()`
- CPython open-code hook可否回傳已驗 fd-backed file object完整覆蓋 source/pyc
- Node internal module read path與可攔截位置
- memfd sealing / executable fd作為 immutable derived-code carrier

下一個核心問題：

**Hermes現在可以把 pathname安全地變成「已驗證 fd」，但如何保證 Python compiler、Node parser、ELF dynamic loader真正解析/映射的就是這個 fd所代表的 bytes，而不是 runtime內部又把 pathname重新 resolve 一次？**

## Knowledge Graph 新增 Node / Edge

### Nodes

- `ConstrainedPathResolutionWitness`
- `OpenedFileObjectGeneration`
- `FileDescriptorConsumptionBinding`
- `FileObjectIdentityWitness`
- `VerityEnforcedConsumptionWitness`
- `OverlayCopyUpGeneration`
- `RuntimeArtifactConsumptionWitnessV2`
- `SameObjectConsumptionWitness`
- `CodeOpenHookCoverageWitness`

### Edges

- `ResolvedRuntimePath --resolved_by→ ConstrainedPathResolutionWitness`
- `ConstrainedPathResolutionWitness --produces→ OpenedFileObjectGeneration`
- `OpenedFileObjectGeneration --measured_by→ VerityEnforcedConsumptionWitness`
- `OpenedFileObjectGeneration --joins→ RuntimePackageMemberWitness`
- `PathHashVerified --does_not_prove→ LaterPathOpenConsumesSameObject`
- `FileDescriptorConsumptionBinding --supports→ SameObjectConsumptionWitness`
- `OverlayCopyUpGeneration --may_change→ FileObjectIdentityWitness`
- `VerityEnforcedConsumptionWitness --does_not_prove→ SupplyChainProvenance`
- `RuntimeArtifactConsumptionWitnessV2 --advances→ CodeClosureGeneration`
- `SameObjectConsumptionUnknown --revokes→ HighRiskSignerAuthorization`

## 與歷史研究比較

上一輪已把 package artifact、installer transformation、installed member、runtime path串起來，但最後仍停在 `Runtime open digest`。本輪補上「path不是object」這一層：把 trust join point移到 kernel開出的 fd/open file description，並用 openat2限制 lookup、fs-verity綁定後續 read/mmap。這避免把 pathname hash誤當 execution identity，也首次明確把 OverlayFS copy_up視為 file-object generation change。