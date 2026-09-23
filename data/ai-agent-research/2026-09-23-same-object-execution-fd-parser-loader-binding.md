# 【AI Agent × Multimodal Research Report】

時間：2026-09-23 21:55（Asia/Taipei）

主題：Same-Object Execution Witness × FD-Bound Parser/Loader × execveat/fexecve × Node Source Boundary

## 本小時新發現

本輪承接上一輪最淺節點 `SameObjectConsumptionWitness`，不重複 openat2/fs-verity/path TOCTOU，而是追「已驗證 fd 如何真正成為 interpreter/compiler/native execution 所消費的 object」。

核心新鏈：

`Resolved Artifact → Verified FD → Content/Provenance Witness → FD-bound read/mmap/exec → Consumer Identity → SameObjectExecutionWitness → CodeClosureGeneration → Signer Authorization`

本輪最重要的新區分：

`VerifiedFD --does_not_prove→ ConsumerUsedThatFD`

`ConsumerReceivedVerifiedBytes --does_not_prove→ NativeAddonUsedSameObject`

`PathResolvedToApprovedObject --does_not_prove→ LaterRuntimeReopenSameObject`

## 本小時最重要 5 個發現

### 1. execveat(AT_EMPTY_PATH) / fexecve 是 native executable 的真正 fd→execution primitive

**已確認事實 / Linux API**：`fexecve(fd, argv, envp)` 與 `execve()` 等價，但 executable 由 fd 指定而非 pathname；Linux `execveat(fd, "", ..., AT_EMPTY_PATH)` 同樣可直接執行 fd 指向的 executable。這代表 Hermes 對 native worker/process 可以把「驗證 object」與「執行 object」直接 join 在同一 fd 上。

推薦鏈：

`openat2 → fd → fs-verity/content/provenance verify(fd) → execveat(fd, "", ..., AT_EMPTY_PATH)`

而不是：

`verify(path) → execve(path)`。

限制：script/shebang 路徑存在 fd close-on-exec / interpreter handling caveat，因此不能把 native ELF 的 fd-binding結論直接套到所有 script execution。

新增 `FdBoundExecWitness`、`NativeExecutionObjectIdentity`。

### 2. mmap(fd) 提供 native library/code page 的 object-level consumption join，但 dlopen(path) 本身不是 witness

**已確認事實 / POSIX/Linux**：`mmap(..., fd, offset)` 建立的 mapping 對應 fd 所代表的 memory object。因此若 verifier 驗證的是同一 fd，且 executable mapping 也是由該 fd 建立，object identity 可以跨 verification→mapping 維持。

但高階 `dlopen(path)` API 接受 pathname；若 Hermes 只在呼叫前驗證 path/fd，卻讓 dynamic loader再次自行 pathname lookup，就重新引入 namespace race。

因此：

`VerifiedFD + mmap(same FD) → strong SameObjectMappingWitness`

但：

`VerifiedFD + dlopen(path) --does_not_prove→ SameObjectMappingWitness`

新增 `SameObjectMappingWitness`、`DynamicLoaderReopenRisk`。

### 3. Node ESM source path揭露清楚的 source/native 分叉：JS source可在 bytes boundary攔截，native addon仍進 dlopen

**原始碼確認**：Node current `lib/internal/modules/esm/load.js` 對 `file:` module source呼叫 `loaderMethods.readFileSync(url)` 取得 source bytes；但當 format 是 `addon` 時，source被設為 null，註解明確指出 addon必須從 filesystem以 `dlopen` 載入。

因此 Node 的 closure必須拆成兩條：

`file: JS module → resolver → loaderMethods.readFileSync → source Buffer → parser/compiler`

以及：

`native addon → filesystem path → dlopen → ELF mappings`

這提供 Hermes 一個實作方向：JS/JSON/WASM source可在 loader source boundary建立 `VerifiedSourceBytesWitness`；native addon則必須走獨立 `NativeAddonExecutionWitness`，不能因 JS loader完成驗證就宣稱整個 Node closure完成。

新增 `NodeVerifiedSourceBytesWitness`、`NodeNativeAddonBoundary`。

### 4. 「verified bytes」是 interpreter 的可行 join point，但它與 fd identity是不同 witness

對 Python/Node source，consumer最終需要的是 bytes/code object，而不一定保留原 fd。Hermes因此應允許兩種 same-object策略：

A. `FD_IDENTITY_MODE`：consumer直接 read/mmap/exec verified fd。

B. `VERIFIED_BYTES_MODE`：trusted loader從 verified fd一次讀出 immutable bytes，建立 digest，再把該 exact byte buffer交給 parser/compiler，且後續不得按 path重讀。

`VerifiedSourceBytesWitness = H(openedObjectGeneration, contentDigest, byteLength, consumerIdentity, codeClosureGeneration)`

這是 Hermes工程模型，不是 Linux/Python/Node既有標準。

它解決 source parser不需要 fd 的現實，但不能用來替代 native `.so` / ELF mapping witness。

新增 `VerifiedSourceBytesWitness`、`ConsumerByteBufferGeneration`。

### 5. Same-object execution必須成為 per-consumer coverage matrix，而不是單一布林值

本輪形成第一版 coverage matrix：

- Native ELF process：`execveat/fexecve(fd)` → 可建立強 fd-bound execution witness。
- File-backed executable mmap：`mmap(fd)` → 可建立強 object-bound mapping witness。
- Python/JS source：`verified fd → immutable bytes → compile exact bytes` → 可建立 verified-bytes witness。
- Node native addon / generic `dlopen(path)`：仍有 reopen/path semantics gap。
- shebang/interpreter scripts：fd execution仍有 interpreter/FD_CLOEXEC caveat。
- JIT/anonymous executable memory：仍需上一輪的 JIT provenance機制，file-object witness不適用。

因此：

`SameObjectExecutionCoverage = Σ consumer-specific witnesses`

而不是 `sameObject=true/false`。

## Architecture Breakdown

System architecture：**FD-to-Execution Consumption Gate**

```text
Runtime Resolver
  ↓
openat2 / trusted dirfd
  ↓
Verified FD
  ├─ content digest / fs-verity
  ├─ package-member provenance
  └─ file-object generation
       ↓
Consumer Router
  ├─ Native ELF → execveat(AT_EMPTY_PATH)
  ├─ mmap code → mmap(same fd)
  ├─ Python/JS source → read exact fd → immutable verified bytes → compiler/parser
  ├─ Native addon → loader-specific gate (gap)
  └─ JIT → JIT provenance gate
       ↓
SameObjectExecutionWitness
       ↓
CodeClosureGeneration++
       ↓
Runtime Attestation
       ↓
High-risk Signer Authorization
```

## Bottom-Level Logic

### Native execution

`fd = openat2(...)`
`verify(fd)`
`execveat(fd, "", argv, envp, AT_EMPTY_PATH)`

核心安全性不是「path沒變」，而是 syscall直接使用 verifier持有的 object reference。

### File-backed executable mapping

`verify(fd) → mmap(PROT_EXEC, fd, offset)`

mapping來源是 fd代表的 memory object；若同一 fd已由 fs-verity/content/provenance gate驗證，則可形成 object-level join。

### Source-language execution

`verify(fd) → read exact fd → freeze bytes → digest → parser/compiler consumes exact buffer`

此處 trust join point由 fd轉成 immutable byte buffer；必須記錄 transition witness，否則「先驗證 fd，再讓 runtime按 path重讀」仍然不安全。

### Node source/native boundary

Node current ESM loader對 file URL讀 source；native addon format則不讀 source buffer，而轉到 filesystem/dlopen。因此 source loader coverage與 addon coverage是兩個不同安全域。

## Visual Simulation Idea

### Verified FD → Execution Microscope

泳道：

`Resolver | VFS | Verified FD | fs-verity | Source Reader | Parser/Compiler | execveat | mmap | dlopen | Code Closure | Signer`

fault injection：

- `VERIFY_FD_THEN_REOPEN_PATH`
- `SOURCE_BUFFER_REPLACED_AFTER_VERIFY`
- `NODE_JS_SOURCE_VERIFIED_ADDON_UNVERIFIED`
- `DLOPEN_PATH_SWAP`
- `EXECVE_PATH_INSTEAD_OF_EXECVEAT`
- `SCRIPT_FEXECVE_CLOEXEC_FAILURE`
- `MMAP_DIFFERENT_FD_THAN_VERIFIED`
- `VERIFIED_BYTES_DIGEST_MISMATCH`
- `JIT_CODE_OUTSIDE_FILE_WITNESS`

UI：

`Resolve ✓ | FD ✓ | Integrity ✓ | Provenance ✓ | Consumer binding ✓/? | Exact bytes/object ✓/? | Execution coverage 82%`

任何高風險 code node的 consumer binding未知：

→ `BLOCK HIGH-RISK SIGN`

## Code / GitHub

### Node.js

值得繼續看的 current source：

- `lib/internal/modules/esm/load.js`
  - `file:` source → `loaderMethods.readFileSync(url)`
  - `format === 'addon'` → source=null → filesystem/dlopen boundary
- 下一步：`process.dlopen` / native addon loader → libuv/glibc dynamic loader。

### CPython

延續上一輪：

- `Lib/importlib/_bootstrap_external.py`
- `_io.open_code()` / `PyFile_SetOpenCodeHook()`
- source/pyc應建立 verified-fd→exact-bytes→compile witness
- native extension則進 `_imp.create_dynamic` / dynamic loader，需獨立 same-object mapping研究。

### Linux / libc

- `fexecve()`
- `execveat(... AT_EMPTY_PATH)`
- `mmap(fd)`
- 下一輪：glibc `dlopen` / `_dl_map_object` / `_dl_map_segments` 路徑。

## Papers / Specifications

本輪以 OS/runtime mechanism為主，沒有用一般 Agent論文填充。

1. **POSIX fexecve / Linux execveat** — fd-oriented executable selection；限制：script interpreter與FD_CLOEXEC有特殊 caveat。
2. **POSIX/Linux mmap** — mapping直接由 fd memory object建立；限制：不自行證明該 object受信任。
3. **Node.js ESM loader source** — 展示 source-buffer與native-addon/dlopen安全邊界；限制：internal implementation可能改變。
4. **CPython code-open path** — 可作 source-code validation interception；歷史 CVE-2026-2297證明 loader coverage漏一條就可繞過 validation。

## Unknown / Open Questions

1. glibc `dlopen(path)` 能否建立 production-grade「verified object → same mapped object」binding，而不依賴不穩定 `/proc/self/fd/N` pathname技巧？
2. Python `_imp.create_dynamic` 與 Node `process.dlopen` 最終如何把 path交給 ELF loader；可否加入 fd-oriented native-addon broker？
3. verified source bytes進 parser/compiler後，如何對 generated bytecode/code object建立可遠端驗證的 transition witness，而不把 runtime instrumentation本身變成新的 trusted-computing-base黑洞？

## 下一輪研究

鎖定：

`Node process.dlopen / CPython _imp.create_dynamic → glibc dlopen → _dl_map_object → open/mmap → ELF dependency graph → RPATH/RUNPATH → fd-oriented native addon gate`

同時研究：

- ELF DT_NEEDED dependency resolution
- loader namespace與`LD_PRELOAD` / audit hooks
- `/proc/self/fd/N`與fd-based loader strategies的限制
- native addon transitive `.so` closure
- loader-level IMA/fs-verity cross-check

下一個核心問題：

**Hermes現在已能對 native executable用 execveat、對source用 verified bytes建立強 consumption binding；但 Python/Node載入 native extension時仍會跨入 dynamic linker。如何證明 `.so` 本體以及它透過 DT_NEEDED / RPATH / RUNPATH載入的整個 ELF dependency closure，全部都是被批准且實際 mmap 的同一批 file objects？**

## Knowledge Graph 新增 Node / Edge

### Nodes

- `FdBoundExecWitness`
- `NativeExecutionObjectIdentity`
- `SameObjectMappingWitness`
- `DynamicLoaderReopenRisk`
- `VerifiedSourceBytesWitness`
- `ConsumerByteBufferGeneration`
- `NodeVerifiedSourceBytesWitness`
- `NodeNativeAddonBoundary`
- `SameObjectExecutionCoverage`
- `SameObjectExecutionWitnessV2`

### Edges

- `VerifiedFD --consumed_by→ FdBoundExecWitness`
- `FdBoundExecWitness --supports→ SameObjectExecutionWitnessV2`
- `VerifiedFD --mapped_by→ SameObjectMappingWitness`
- `VerifiedFD --does_not_prove→ ConsumerUsedThatFD`
- `VerifiedSourceBytesWitness --consumed_by→ ParserCompiler`
- `NodeVerifiedSourceBytesWitness --does_not_cover→ NodeNativeAddonBoundary`
- `DlopenPath --introduces→ DynamicLoaderReopenRisk`
- `SameObjectExecutionWitnessV2 --advances→ CodeClosureGeneration`
- `ConsumerBindingUnknown --revokes→ HighRiskSignerAuthorization`

## 與歷史研究比較

上一輪完成 `path → secure lookup → fd → integrity/provenance`，但最後仍把「consume same fd」留成未知。本輪第一次依 consumer類型拆解這個未知：native process可用 `execveat/fexecve`直接把fd變成execution object；file mapping可用`mmap(fd)`；Python/JS source可把trust join point轉成exact immutable bytes；而 Node native addon / generic dlopen仍是主要缺口。因此下一輪不再泛談path TOCTOU，而會直接深入dynamic linker的object/dependency mapping。