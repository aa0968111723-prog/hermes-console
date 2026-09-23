# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-23 16:55 Asia/Taipei

## 本小時新發現
本輪承接上一輪最淺的 `CodeClosureGeneration`，不重複主 executable / pidfd / DPoP / HSM，改向「一個 Agent process 真正會執行的完整 code closure」下鑽：

`ELF main executable → PT_INTERP/dynamic loader → executable mmap → shared libraries → interpreter/script/module → plugin/native extension → memfd/anonymous executable memory → JIT → CodeClosureGeneration`。

新 system architecture：**Code-Closure-Bound Agent Runtime Authorization**。

新 bottom-level mechanism：**Linux executable mmap integrity hooks + interpreter explicit exec-check + executable-memory provenance gap**。

核心結論：

`MainExecutableApproved --does_not_prove→ WholeCodeClosureApproved`

`SharedLibraryMeasured --does_not_prove→ ScriptOrModuleMeasured`

`FileBackedExecIntegrity --does_not_prove→ AnonymousJITIntegrity`

`CodeClosureSnapshotValid --does_not_prove→ FutureDlopenOrJITStillValid`

---

## 本小時最重要 5 個發現

### 1. Linux integrity enforcement已經能覆蓋 file-backed executable mmap，因此 shared libraries可以成為 code-closure evidence【已確認／Linux kernel】
Linux current IMA source `security/integrity/ima/ima_main.c` 實作 `ima_file_mmap()`；kernel builtin IMA `tcb` policy也明確描述會量測所有 exec'd programs與 files mmap'd for exec。這使 main ELF之外的 file-backed executable mappings（典型 shared objects）可以進入 integrity evidence chain。

因此 Hermes應把：

`MainExecutableDigest`

升級為：

`CodeClosure = MainExecutable ∪ ExecutableFileMappings`

但 coverage仍由 policy決定，因此：

`IMAEnabled --does_not_prove→ EveryExecutableMappingMeasured`

來源：https://docs.kernel.org/admin-guide/kernel-parameters.html
Linux source: `security/integrity/ima/ima_main.c`。

### 2. IPE顯示 executable dependency enforcement可在 mmap層阻止未授權 libc/loader，但它同時揭露 anonymous/JIT gap【已確認／Linux kernel】
Linux Integrity Policy Enforcement (IPE) threat model明確以「untrusted binary + loader + libc」為例，目標是驗證 executable code及 dependencies；官方 audit範例甚至顯示 `ld-linux.so` mmap `libc.so.6` 被 policy DENY。

這是非常重要的 architecture signal：code identity不能只綁主 binary，dynamic loader與shared libraries也是執行鏈的一部分。

但同一份官方文件明列限制：IPE不能驗 anonymous executable memory，例如 closures/libffi trampolines與 JIT code。

因此新增：

`FileBackedCodeClosure`
`AnonymousExecutableCodeGeneration`

並建立：

`FileBackedClosureTrusted --does_not_prove→ JITClosureTrusted`

來源：https://www.kernel.org/doc/html/latest/admin-guide/LSM/ipe.html

### 3. interpreted Agent runtime存在不同的 code-identity問題；script不一定天然走 executable hook【已確認／Linux kernel source + docs】
Python/Node等 Agent runtime不能簡化成「python/node executable hash正確，所以應用 code正確」。Linux IPE文件明確指出，傳統 interpreter把 script當普通文字讀取時，script本身不一定經 executable-code hook。

新機制 `AT_EXECVE_CHECK` 允許 interpreter使用 `execveat(..., AT_EXECVE_CHECK)` 主動要求 kernel對將執行的 script執行 LSM security checks。Current Linux `security/security.c` 與 IMA source已包含這條路徑；IMA註解明確說明它可依 policy measure/appraise由 script interpreter執行的 file。

因此：

`InterpreterBinaryApproved --does_not_prove→ ScriptApproved`

Hermes的 Python/Node Agent若要求強 code-closure guarantee，需明確處理 `.py/.js`、loaded modules、native extensions與dynamic imports，而不能只信 interpreter binary。

### 4. memfd/JIT是目前 CodeClosureGeneration 最明顯的 blind spot【已確認／Linux kernel】
Linux `memfd` 官方文件說明，歷史上 memfd預設可執行曾造成 NoExec bypass / confused-deputy attack，因此新增 `MFD_NOEXEC_SEAL`、`MFD_EXEC` 與 namespaced `vm.memfd_noexec` policy。`MFD_NOEXEC_SEAL`可在建立時讓 memfd不可執行並封鎖日後加入 execute bit。

因此對不需要JIT的 Hermes高風險 Agent，production profile應優先：

`deny/limit executable memfd + deny unexpected anonymous executable memory + require file-backed authenticated code`

這是工程建議，不是宣稱 Linux已自動替 Hermes完成 policy。

對確實需要JIT的 runtime，單靠 IMA/fs-verity/IPE不足，必須新增 JIT provenance layer，例如：

`ApprovedRuntime → JITCompilationEvent → Source/IR Digest → GeneratedCodeDigest → ExecutableMemoryGeneration`

目前這仍是 Hermes研究模型，尚不是通用 Linux attestation標準。

來源：https://docs.kernel.org/userspace-api/mfd_noexec.html

### 5. Code closure不是靜態集合，而是隨 dlopen/import/JIT演化的 generation【工程建模／建立於上述 kernel機制】
Agent啟動時驗一次 main executable與libraries仍不夠，因為之後可以 dlopen plugin、import新module、載入native extension或產生JIT code。

因此本輪提出：

`CodeClosureGeneration = H(previousGeneration, codeEventType, artifactIdentity, provenance, policyDecision, sequence)`

事件至少包括：

`EXEC_MAIN | EXEC_INTERPRETER | MMAP_EXEC_FILE | SCRIPT_EXEC_CHECK | DLOPEN_NATIVE | MODULE_LOAD | MEMFD_EXEC | ANON_EXEC | JIT_EMIT`

高風險 signer/tool authorization不再綁單一 executable digest，而應綁：

`ProcessGeneration + CodeClosureGeneration + RuntimeIntegrityDecision + SemanticCommit`

若新的 executable event不在允許 policy內：

`UnexpectedCodeEvent → increment closure generation → revoke old SignerUseAuthorization`

---

## Architecture Breakdown

### Code-Closure-Bound Agent Runtime

```text
Hermes Agent Process
  ↓ exec
Main ELF / interpreter
  ↓
PT_INTERP / dynamic loader
  ↓ mmap(PROT_EXEC)
Shared libraries / native extensions
  ↓
IMA FILE_MMAP / IPE EXECUTE-MMAP
  ↓
Measured/Appraised file-backed closure
  ↓
Python/Node script/module path
  ├─ ordinary read/import → may bypass executable-file semantics
  └─ AT_EXECVE_CHECK-aware interpreter → LSM/IMA/IPE check
  ↓
Dynamic plugin/import events
  ↓
memfd / anonymous executable memory / JIT
  ↓
Executable-memory provenance gap
  ↓
CodeClosureGeneration
  ↓
RuntimeIntegrityDecision
  ↓
SignerUseAuthorization
  ↓
DPoP → MCP → tool → effect → receipt
```

### Trust decomposition

```text
Main artifact identity       = executable/fs-verity digest
File-backed dependency set   = executable mmap identities
Interpreted-code identity    = script/module/package provenance
Native extension identity    = mapped executable artifact digest
Anonymous/JIT identity       = generated executable-memory provenance
Closure generation           = ordered code-loading event generation
Runtime authorization        = fresh closure + policy + semantic commit
```

---

## Bottom-Level Logic

### A. ELF + loader
A dynamically linked ELF does not execute in isolation. Kernel/loader path introduces interpreter/dynamic-loader and shared objects. A main-binary digest therefore cannot represent the entire instruction provenance of the process.

### B. executable mmap
File-backed libraries commonly become executable mappings. Linux IMA/IPE hooks around executable mmap provide a kernel-level point to measure/appraise/deny these mappings. This is the natural place to grow `FileBackedCodeClosure`.

### C. interpreted code
Interpreter executable與 application source是兩個 identity layers。若 script只是被 interpreter `read()`，它不等價於 kernel直接 exec file。`AT_EXECVE_CHECK`提供一個新 bridge，但需要 interpreter主動整合。

### D. native modules/plugins
Python wheels、Node native addons、shared plugins最後可能落到 `.so`/native executable mappings，因此可部分回到 file-backed mmap evidence；pure script modules則需要 package/module provenance與interpreter-aware enforcement。

### E. memfd / JIT
anonymous/generated executable code沒有穩定 filesystem artifact identity，fs-verity自然無法直接覆蓋。若 workload不需要JIT，最簡單安全策略是限制 executable memfd/anonymous exec；若需要JIT，就必須把 code-generation event本身納入 attestation model。

### F. closure generation
closure不是 set-only model，而應是 event-sourced generation。每次新增可執行來源都改變 generation，使先前簽發的高風險 signer authorization自然失效。

---

## Visual Simulation Idea

### Agent Code Closure Microscope

泳道：

`Main ELF | Loader | Shared Libraries | Interpreter | Scripts/Modules | Native Plugins | memfd | JIT | IMA/IPE | TPM/Verifier | Signer Broker`

互動 fault injection：
- `MAIN_BINARY_VALID_LIBC_REPLACED`
- `LD_PRELOAD_UNAPPROVED_SO`
- `DLOPEN_AFTER_SIGNER_AUTH`
- `PYTHON_INTERPRETER_VALID_SCRIPT_TAMPERED`
- `NODE_MODULE_CHANGED_AFTER_START`
- `NATIVE_EXTENSION_DIGEST_MISMATCH`
- `AT_EXECVE_CHECK_NOT_USED`
- `EXECUTABLE_MEMFD_CREATED`
- `ANONYMOUS_JIT_PAGE_CREATED`
- `OLD_CODE_CLOSURE_WITNESS_REUSED`

UI evidence rail：

`Main | Loader | Exec mmap | Script coverage | Modules | Native plugins | memfd | JIT | Closure Gen | TPM | Signer Auth`

關鍵案例：

`Main ✓ | loader ✓ | libc ✓ | Python ✓ | script ? | native plugin ✓ | JIT ? → CODE CLOSURE INCOMPLETE → BLOCK HIGH-RISK SIGN`

---

## Code / GitHub

### Linux kernel
Repository: `torvalds/linux`

本輪值得看的核心檔案：
- `security/integrity/ima/ima_main.c` — `ima_file_mmap()`與 executable mapping measurement/appraisal path。
- `security/integrity/ima/ima_appraise.c` — script `AT_EXECVE_CHECK` appraisal distinction。
- `security/security.c` — `AT_EXECVE_CHECK` LSM path。
- `Documentation/admin-guide/LSM/ipe.rst` — loader/library enforcement、interpreted/JIT limitations。
- `Documentation/userspace-api/mfd_noexec.rst` — executable memfd policy與 sealing。
- `fs/verity/` — file-backed immutable artifact identity。

值得下一輪追的原始碼：
- ELF `PT_INTERP` / binary format loader path
- `mmap` / `mprotect` executable transitions
- `memfd_create` + `F_SEAL_EXEC`
- IPE `EXECUTE` hook implementation
- Python/Node是否/何時採用 `AT_EXECVE_CHECK`

---

## Papers

### 1. Design and Implementation of a TCG-based Integrity Measurement Architecture
- Authors: Reiner Sailer, Xiaolan Zhang, Trent Jaeger, Leendert van Doorn
- Institution: IBM T. J. Watson Research Center
- Year: 2004
- Architecture: execution/load measurement → ordered log → TPM aggregate → remote verification
- Contribution: 建立 Linux dynamic runtime code measurement基礎。
- Limitation: modern interpreted/JIT/containerized agent code closure遠超原始 executable-load model。
- URL: https://research.ibm.com/publications/design-and-implementation-of-a-tcg-based-integrity-measurement-architecture

### 2. PRIMA: Policy-Reduced Integrity Measurement Architecture
- Authors: Trent Jaeger, Reiner Sailer, Umesh Shankar
- Year: 2006
- Contribution: 將 integrity measurement與information-flow/security policy結合，指出「量測所有 code」與「建立有意義的 trust」不是同一問題。
- Limitation: 不直接解決現代 JIT / dynamic language package provenance。
- URL: https://research.ibm.com/publications/prima-policy-reduced-integrity-measurement-architecture

### 3. Towards Continuous Integrity Attestation and Its Challenges in Practice: A Case Study of Keylime
- Authors: Margie Ruffin et al.
- Year: 2025
- Venue: DSN 2025
- Contribution: production continuous attestation的 policy/false-positive/false-negative問題，對 dynamic code closure特別重要。
- Limitation: node integrity仍不等於 Agent semantic authorization。
- URL: https://research.ibm.com/publications/towards-continuous-integrity-attestation-and-its-challenges-in-practice-a-case-study-of-keylime

---

## 與歷史研究比較
上一輪已補：

`ProcessGeneration → exec → IMA BPRM_CHECK → main executable digest/fs-verity → TPM/remote verifier → ExecutableGenerationWitness`

本輪的新資訊不是再次證明 main executable，而是指出：

`ExecutableGenerationWitness`仍只覆蓋入口 artifact，不能代表 process實際執行的全部 instructions。

因此新增：

`ExecutableGenerationWitness → FileBackedCodeClosure → InterpretedCodeClosure → Anonymous/JITClosure → CodeClosureGeneration`

研究焦點從「現在跑哪個 binary？」提升到「現在這個 Agent可執行的全部 code provenance是什麼？」。

---

## Unknown / Open Questions

### 1. Python/Node現行 production runtime對 `AT_EXECVE_CHECK` 的實際 adoption程度？
Kernel已提供 primitive，但 interpreter是否採用決定 script coverage。下一輪需直接追 CPython/Node原始碼與發行版本。

### 2. JIT code如何建立可遠端驗證的 provenance？
需要回答 generated machine code如何綁到 runtime artifact、source/bytecode/IR、compiler generation與policy；目前仍沒有像 fs-verity一樣自然的通用 file identity。

### 3. 如何把 process-local code closure與 node-global IMA/TPM log可靠 attribution？
需要從 event metadata / cgroup / process generation / namespace / executable mmap event建立 per-workload closure，而不能只知道 node曾量測某檔案。

---

## 下一輪研究
下一輪鎖定：

`Python/Node runtime → import/module resolution → package lockfile → wheel/npm artifact → native addon → dynamic loader → AT_EXECVE_CHECK adoption → JIT/V8 executable memory → per-Agent CodeClosure attestation`

優先讀：
1. CPython import machinery / extension module loader。
2. Node.js module resolution + native addon loading。
3. V8 JIT executable-memory allocation與W^X機制。
4. Linux `mprotect(PROT_EXEC)` / anonymous executable-memory security hooks。
5. IMA/IPE是否能對這些 runtime event提供足夠 attribution。

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `CodeClosureGeneration`
- `FileBackedCodeClosure`
- `ExecutableMappingGeneration`
- `DynamicLoaderIdentity`
- `SharedLibraryIdentity`
- `InterpreterRuntimeIdentity`
- `InterpretedScriptIdentity`
- `ScriptExecCheckWitness`
- `NativeExtensionIdentity`
- `DynamicPluginLoadGeneration`
- `ExecutableMemfdGeneration`
- `AnonymousExecutableMemoryGeneration`
- `JITCodeGeneration`
- `JITProvenanceWitness`
- `CodeClosureCoverageWitness`
- `CodeClosureAuthorizationGeneration`

### Edges
- `MainExecutableIdentity --loads→ DynamicLoaderIdentity`
- `DynamicLoaderIdentity --maps_exec→ SharedLibraryIdentity`
- `IMAFileMmapWitness --evidences→ ExecutableMappingGeneration`
- `InterpreterRuntimeIdentity --does_not_prove→ InterpretedScriptIdentity`
- `AT_EXECVE_CHECK --can_evidence→ ScriptExecCheckWitness`
- `NativeExtensionIdentity --extends→ FileBackedCodeClosure`
- `ExecutableMemfdGeneration --extends→ CodeClosureGeneration`
- `JITCodeGeneration --extends→ CodeClosureGeneration`
- `FileBackedCodeClosure --does_not_prove→ AnonymousJITIntegrity`
- `CodeClosureGeneration --binds→ CodeClosureAuthorizationGeneration`
- `UnexpectedCodeEvent --revokes→ SignerUseAuthorizationGeneration`

---

## 本輪結束回答
**缺哪一層？** interpreted/JIT code provenance與per-workload closure attribution層。

**哪個節點最淺？** `JITProvenanceWitness`。

**哪個概念仍只是名詞？** portable、可跨 Python/Node/V8/native runtime的 `CodeClosureGeneration` attestation envelope。

**哪個系統值得讀原始碼？** Linux IMA/IPE之後，下一輪最值得讀 CPython import/extension loader與 V8 JIT memory path。

**哪篇論文需追引用？** PRIMA與2025 Keylime continuous-attestation研究，尤其 dynamic policy / information-flow coverage。

**哪個概念最適合視覺模擬？** `Agent Code Closure Microscope`。

**哪個 Agent 架構最值得實作？**

`Risk-aware Planner + Event-sourced CodeClosure Monitor + pidfd/Workload Binder + IMA/IPE/fs-verity File-backed Gate + Interpreted/JIT Provenance Gate + TPM Runtime Verifier + Non-exportable Signer + DPoP/MCP + SemanticCommit/Receipt Runtime`

最終鏈條現在補成：

`UI → Agent → Context → Reasoning → Planning → SemanticCommit → ProcessGeneration → Main Executable → Loader → Shared Libraries → Scripts/Modules → Native Extensions → JIT/Executable Memory → CodeClosureGeneration → Runtime Attestation → Signer → DPoP → MCP → Tool → Effect → Receipt → Output`

本輪最核心的改變是：**Hermes不能再把「Agent主程式 hash 正確」視為 code identity；真正需要綁定高風險工具權限的是會隨 loader、library、module、plugin與JIT持續演化的整個 CodeClosureGeneration。**