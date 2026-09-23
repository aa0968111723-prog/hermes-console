# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-23 17:54 Asia/Taipei

## 本小時研究主題
**Runtime Module Resolution × Python/Node Dependency Identity × Native Extension Loading × V8 JIT Provenance × CodeClosureGeneration**

本輪承接上一輪 `CodeClosureGeneration` / `JITProvenanceWitness`，不重複主 ELF、pidfd、IMA、fs-verity、TPM、DPoP 與 MCP sender constraint。這輪專門回答：**若 Hermes Agent 是 Python / Node，如何把真正被 import/require 的程式碼、native extension、動態 loader hook 與 JIT machine code納入可驗證 code closure？**

---

## 本小時新發現

### 新架構
`Runtime-resolved Code Closure`：不把 lockfile 或主程式 hash 當成「實際執行程式碼」，而把 runtime resolver/load event 視為 truth source：

`Declared Dependency → Resolver → Resolved Artifact → Loader → Executed Module → Native Extension / JIT Event → CodeClosureGeneration`

### 新 GitHub / 原始碼
1. CPython `Lib/importlib/_bootstrap.py`
2. CPython `Lib/importlib/_bootstrap_external.py`
3. Node `lib/internal/modules/cjs/loader.js`
4. Node ESM loader / module customization hooks
5. V8 `include/v8-callbacks.h`
6. V8 JIT memory / sandbox code paths

### 新底層機制
V8 公開 `JitCodeEvent`，事件含 `CODE_ADDED / CODE_MOVED / CODE_REMOVED` 類型，並區分 `BYTE_CODE / JIT_CODE / WASM_CODE`；JIT/Wasm event 可觀察 machine-code address + length。這讓 `JITProvenanceWitness` 從純概念進入可實作 telemetry 層，但 event 本身仍不是 cryptographic attestation。

---

# 本小時最重要 5 個發現

## 1. Lockfile 是 declared graph，不是 executed graph

### 是什麼
`package-lock.json / pnpm-lock / poetry.lock / uv.lock / requirements` 能固定或描述 dependency resolution，但不能單獨證明 runtime 最後執行了哪些 bytes。

### 底層如何運作
Node ESM resolution實際走：

`specifier → parentURL → package/imports/exports resolution → real path / URL → format → load`

CommonJS 則走自己的 resolver，且 current Node source還允許 module resolve/load hooks介入。Python則經：

`import statement → sys.meta_path → finder.find_spec → ModuleSpec → loader.create_module → loader.exec_module`

因此 runtime closure應記錄 **resolved artifact**，不是只記錄 declared package name/version。

### 為什麼重要
如果 lockfile寫 `foo@1.2.3`，但 runtime loader被 custom hook、symlink、PYTHONPATH、editable install、Node loader hook或其他 resolution path導向不同檔案，lockfile仍可保持完全不變。

### 限制
runtime instrumentation若只在語言層做，也可能被同 process內高權限程式繞過；仍需要 kernel/file integrity層交叉驗證。

### 判定
- 已確認：Node/Python runtime都有真正的 resolver/loader machinery。
- 工程推論：Hermes應將 lockfile視為 `DeclaredDependencyGraph`，runtime event視為 `ObservedExecutionGraph`。

---

## 2. CPython native extension是 code-closure的重要跨界點

CPython current `ExtensionFileLoader.create_module()` 會呼叫 `_imp.create_dynamic` 載入 extension module，`exec_module()` 再呼叫 `_imp.exec_dynamic` 初始化；extension module本身沒有 Python code object/source，而 loader回傳實際 filename。

因此 closure不能停在 `.py`：

`Python import → ModuleSpec → Source/Bytecode Module`

也可能變成：

`Python import → ExtensionFileLoader → shared object (.so/.pyd) → dynamic linker → executable mappings`

Hermes新增：

`PythonModuleResolutionWitness`
`PythonExtensionLoadWitness`
`NativeExtensionArtifactIdentity`

重要否定邊：

`PythonSourceClosureComplete --does_not_prove→ NativeCodeClosureComplete`

---

## 3. Node loader hooks本身必須成為 trust root的一部分

Current Node CJS source的 `resolveForCJSWithHooks()` 在存在 hooks時會先建立 parent URL / conditions，再讓 `resolveWithHooks()` 參與 resolution，最後才把 URL轉回 filename。

因此：

`PackageLockValid --does_not_prove→ RuntimeResolutionUnmodified`

若 custom resolver/loader能改寫 `specifier → resolved URL/source`，它本身就是 code provenance decision point。

Hermes應建立：

`ModuleResolverIdentity`
`ModuleLoaderHookGeneration`
`ResolvedModuleArtifactIdentity`

每次 hook set改變：

`ModuleLoaderHookGeneration++ → CodeClosureGeneration++ → revoke old high-risk SignerUseAuthorization`

---

## 4. V8已提供 JIT code lifecycle觀察點，但 observation ≠ provenance

V8 `JitCodeEvent` 對 `JIT_CODE` / `WASM_CODE` 提供 code start與code length，並有 code-added / moved等事件。這代表 Hermes可以建立：

`JIT event → generated code bytes digest → JITCodeGeneration`

但只有 machine-code hash仍不夠。真正 provenance至少需要：

`RuntimeBuildIdentity`
`IsolateIdentity`
`SourceScriptIdentity`
`Bytecode/IR Identity`
`CompilerTier`
`CompilerConfig/Flags`
`GeneratedMachineCodeDigest`
`JITEventSequence`

合理設計：

`JITProvenanceWitness = H(runtimeBuild, isolate, sourceDigest, bytecodeOrIRDigest, tier, flags, machineCodeDigest, generation)`

這是 Hermes proposal，不是 V8既有 attestation格式。

另外 V8文件明確指出 JIT需要在 runtime寫入 executable memory；其 CFI/JIT memory設計以 per-thread memory permissions等方式降低 writable+executable memory被攻擊者濫用的風險。這回答「如何安全生成 code」，但仍不等於「遠端 verifier知道生成的是哪段 code」。

否定邊：

`JITMemoryProtected --does_not_prove→ JITCodeApproved`

---

## 5. 高風險 Agent 最務實的策略可能是「closure profiles」，而非假裝所有 runtime都能完整 attestation

Linux IPE已明確承認 anonymous executable memory / JIT code無法由其 file-integrity trust model驗證；interpreted script也需要 interpreter主動使用 `AT_EXECVE_CHECK` 才能把 kernel policy帶進 script execution。

因此 Hermes應區分：

### Profile A — `STATIC_CLOSURE_STRICT`
- no JIT
- 禁止 executable anonymous memory
- 禁止未列入 allowlist 的 dynamic plugin
- package/module resolution固定
- file-backed code必須 fs-verity/IMA/IPE通過
- 適合高風險 write agent / signer broker

### Profile B — `DYNAMIC_CLOSURE_OBSERVED`
- 允許 dynamic imports/plugins
- 每次 runtime resolution都產生 closure event
- native extension需 artifact digest
- closure變更即重新授權

### Profile C — `JIT_CLOSURE_ATTESTED_EXPERIMENTAL`
- V8/PyPy/JVM JIT telemetry
- source/bytecode/IR → machine code provenance graph
- executable-memory generation event
- verifier目前只能判斷 coverage，而非假裝有完整 kernel-native cryptographic attestation

V8本身也提供 `--jitless` 類模式，證明「完全不在 runtime配置 executable memory」是可行的安全/相容性取捨，只是會犧牲部分效能。

---

# Architecture Breakdown

## Runtime-resolved Code Closure Architecture

```text
User Request
  ↓
Agent Planner
  ↓
SemanticCommit
  ↓
Process / Executable Generation
  ↓
Language Runtime Identity
  ├─ Python
  │   └─ sys.meta_path → Finder → ModuleSpec → Loader
  │       ├─ .py source
  │       ├─ .pyc bytecode
  │       └─ ExtensionFileLoader → .so/.pyd
  │
  └─ Node
      ├─ CJS require → resolver → loader
      └─ ESM import → ESM_RESOLVE → URL/format → load
          └─ custom resolve/load hooks
  ↓
Resolved Artifact Digest
  ↓
ObservedExecutionGraph
  ├─ file-backed source/module
  ├─ native extension
  ├─ dynamic library
  ├─ WASM
  └─ JIT generated code
  ↓
CodeClosureGeneration
  ↓
Runtime Attestation / Coverage Decision
  ↓
Signer Authorization
  ↓
DPoP → MCP → Tool → Effect → Receipt
```

核心原則：

`DeclaredDependencyGraph ≠ ObservedExecutionGraph`

以及：

`ObservedExecutionGraph ≠ FullyAttestedExecutionGraph`

第三層必須另外用 coverage witness表示「哪些 edge有 cryptographic / kernel evidence，哪些只是 runtime telemetry」。

---

# Bottom-Level Logic

## Python import

```text
import name
→ check sys.modules
→ locate parent/package context
→ sys.meta_path finders
→ find_spec(name, path, target)
→ ModuleSpec
→ loader.create_module(spec)
→ module object
→ loader.exec_module(module)
→ code executes
→ sys.modules caches identity
```

對 native extension：

```text
find extension
→ ExtensionFileLoader
→ _imp.create_dynamic(spec)
→ dynamic shared object load
→ _imp.exec_dynamic(module)
→ native initialization
→ executable mapping enters process closure
```

## Node resolution

```text
specifier
→ caller / parent URL
→ CJS or ESM resolution rules
→ package imports/exports + conditions
→ optional customization hooks
→ resolved URL / filename
→ format determination
→ source/native addon/Wasm load
→ module cache
→ execution
```

Node官方文件亦指出 `.node` native addon可經 `process.dlopen()` 路徑載入，因此 JS module graph與 native code graph不可分開建模。

## JIT

```text
source module
→ parser
→ bytecode / baseline representation
→ profiling / hotness
→ optimizing compiler
→ machine code emission
→ executable-memory transition
→ JitCodeEvent(CODE_ADDED)
→ hash generated bytes
→ append JIT provenance edge
→ CodeClosureGeneration++
```

若 code moved：

`CODE_MOVED → update location, preserve code-generation identity`

若無法可靠觀察 removal / provenance coverage：標記 coverage gap，不能宣告 closure完整。

---

# Visual Simulation Idea

## Runtime Code Closure & JIT Provenance Microscope

### 泳道
`Lockfile | Resolver | Loader | Module Cache | Native Loader | V8 JIT | Kernel Integrity | Closure Graph | Signer`

### 使用者可切換
- Python Agent
- Node Agent
- Node + V8 JIT
- strict no-JIT Agent

### 可注入故障
- `LOCKFILE_VALID_MODULE_FILE_REPLACED`
- `PYTHONPATH_SHADOW_MODULE`
- `SYS_META_PATH_MALICIOUS_FINDER`
- `NODE_CUSTOM_LOADER_REDIRECT`
- `NATIVE_EXTENSION_CHANGED`
- `PROCESS_DLOPEN_UNEXPECTED_ADDON`
- `JIT_CODE_EMITTED_AFTER_SIGNER_AUTH`
- `JIT_MACHINE_CODE_DIGEST_CHANGED`
- `ANON_EXEC_MEMORY_UNOBSERVED`
- `AT_EXECVE_CHECK_NOT_ADOPTED`

### UI狀態
```text
Declared deps       ✓
Resolved modules    ✓
Source digest       ✓
Native extensions   ✓
Loader hooks        ✓
JIT source binding  ?
JIT machine code    observed
Kernel coverage     partial
--------------------------------
CODE CLOSURE: PARTIAL
HIGH-RISK SIGN: BLOCK
```

---

# Code / GitHub

## CPython
值得繼續看的核心檔案：
- `Lib/importlib/_bootstrap.py` — import state machine / ModuleSpec / loading
- `Lib/importlib/_bootstrap_external.py` — source, bytecode, extension loaders
- `Python/import.c` — interpreter-side import integration
- `Python/dynload_*.c` — native extension dynamic loading
- `Modules/_imp.c` — `_imp.create_dynamic / exec_dynamic`

本輪已確認 `_bootstrap_external.py` 的 extension loader直接進 `_imp.create_dynamic` 與 `_imp.exec_dynamic`。

## Node.js
- `lib/internal/modules/cjs/loader.js`
- `lib/internal/modules/esm/resolve.js`
- `lib/internal/modules/esm/loader.js`
- `lib/internal/modules/customization_hooks.js`
- native addon / `process.dlopen` path

本輪已確認 current CJS loader的 resolution可以進 customization hook chain。

## V8
- `include/v8-callbacks.h` — `JitCodeEvent`
- `src/codegen/`
- `src/compiler/`
- `src/baseline/`
- `src/heap/` code range / executable memory
- `src/sandbox/` — code pointer / trusted-space protection

---

# Papers / Technical Foundations

## 1. Integrity Measurement Architecture (IMA)
- Title: *Design and Implementation of a TCG-based Integrity Measurement Architecture*
- Authors: Reiner Sailer, Xiaolan Zhang, Trent Jaeger, Leendert van Doorn
- Institution: IBM Research / Pennsylvania State University ecosystem
- Year: 2004
- Architecture: pre-execution measurement + ordered measurement list + TPM aggregate
- Contribution: 建立 execution/file measurement到remote attestation的基本鏈
- Limitation: 不直接解決現代 interpreted/JIT runtime完整 provenance
- Dataset: N/A
- Code: Linux IMA後續進入 kernel

## 2. V8 JIT-less engineering
- Type: official V8 engineering architecture
- Year: 2019–present
- Architecture: interpreter/runtime execution without allocating executable memory at runtime
- Contribution: 證明 high-assurance profile可以用「禁止 JIT」換取較小 runtime executable-code attack surface
- Limitation: performance tradeoff；不是 remote attestation protocol

## 3. Linux IPE / AT_EXECVE_CHECK
- Type: Linux kernel official architecture
- Year: current kernel
- Architecture: kernel execution integrity policy + interpreter opt-in execution check
- Contribution: 把 interpreted script帶入 kernel execution-policy decision point
- Limitation: interpreter必須採用；JIT/anonymous executable memory仍是明確 coverage gap

---

# Unknown / Open Questions

1. **如何建立跨 CPython / Node / V8 的 portable `ObservedExecutionGraph` schema？** Runtime event語意不同，不能只用 filename/hash硬湊。
2. **JIT source/IR → machine-code digest如何形成可遠端驗證且低 overhead的 witness？** V8 JitCodeEvent提供 observation primitive，但不是 attestation protocol。
3. **module cache / hot reload / dynamic import之後，何時 closure generation應失效 signer authorization？** 需要定義可驗證的 generation/fence semantics。

---

# 下一輪研究

下一輪鎖定：

`Runtime module event → dependency provenance → package signature/provenance → SBOM → SLSA/in-toto → resolved artifact digest → observed execution graph → code closure attestation`

重點研究：
1. npm provenance / Sigstore bundle如何連到實際 resolved package files。
2. Python wheel `RECORD` / package metadata / supply-chain provenance如何連到 importlib實際載入檔案。
3. SBOM是 build-time inventory還是能成為 runtime closure reference values。
4. 如何把 `ObservedExecutionGraph` 與 signed build provenance做 graph matching。
5. runtime發現 undeclared/unprovenanced module時，如何立即 downgrade/revoke signer authority。

---

# Knowledge Graph 新增 Node / Edge

## Nodes
- `DeclaredDependencyGraph`
- `ObservedExecutionGraph`
- `RuntimeModuleResolutionGeneration`
- `ModuleResolverIdentity`
- `ModuleLoaderHookGeneration`
- `ResolvedModuleArtifactIdentity`
- `PythonModuleResolutionWitness`
- `PythonExtensionLoadWitness`
- `NativeExtensionArtifactIdentity`
- `NodeModuleResolutionWitness`
- `NodeLoaderHookWitness`
- `JITCodeGeneration`
- `JITMachineCodeDigest`
- `JITSourceIdentity`
- `JITCompilerTierIdentity`
- `JITProvenanceWitnessV2`
- `CodeClosureProfile`
- `CodeClosureCoverageWitnessV2`

## Edges
- `DeclaredDependencyGraph --does_not_prove→ ObservedExecutionGraph`
- `PackageLockValid --does_not_prove→ RuntimeResolutionUnmodified`
- `PythonSourceClosureComplete --does_not_prove→ NativeCodeClosureComplete`
- `RuntimeResolver --resolves_to→ ResolvedModuleArtifactIdentity`
- `ResolvedModuleArtifactIdentity --loaded_by→ ModuleLoaderIdentity`
- `NativeExtensionArtifactIdentity --extends→ CodeClosureGeneration`
- `ModuleLoaderHookGeneration --mutates→ RuntimeModuleResolutionGeneration`
- `JITSourceIdentity --compiled_into→ JITMachineCodeDigest`
- `JITMemoryProtected --does_not_prove→ JITCodeApproved`
- `JITCodeGeneration --increments→ CodeClosureGeneration`
- `CodeClosureGeneration --invalidates→ PriorSignerUseAuthorization`

---

# 本輪結束判斷

**缺哪一層：** runtime observed artifact → signed supply-chain provenance / reference-value matching。

**哪個節點最淺：** `JITProvenanceWitnessV2`，目前有可觀察 event但沒有 portable cryptographic attestation semantics。

**哪個概念仍只是名詞：** 跨語言的 `ObservedExecutionGraph` attestation envelope。

**哪個系統值得讀原始碼：** CPython importlib + `_imp` native loader、Node ESM/CJS customization hooks、V8 JIT event/code-memory path。

**哪篇論文需追引用：** IMA 2004之後對 interpreted/runtime/JIT integrity與 continuous attestation的延伸工作。

**哪個概念最適合視覺模擬：** `Runtime Code Closure & JIT Provenance Microscope`。

**哪個 Agent 架構最值得實作：**

`Risk-aware Planner + Runtime Module Resolver Monitor + Native Extension Gate + JIT Closure Monitor + Kernel Integrity Cross-check + Event-sourced CodeClosureGeneration + Attestation-aware Signer + DPoP/MCP + SemanticCommit/Receipt Runtime`

最終鏈現在可再往下還原一段：

`使用者 → UI → Agent → Context → Reasoning → Planning → SemanticCommit → Process → Language Runtime → Resolver → Loader → Python/JS Module → Native Extension → JIT Machine Code → CodeClosureGeneration → Runtime Attestation → Signer → DPoP → MCP → Tool → Effect → Receipt → Output`

下一個核心問題：**我們已能觀察「runtime真的載入/生成了什麼」，下一步要證明這些實際執行 artifact 是否真的來自被批准的 source/build/package provenance，而不是只得到一串可信地量測出的惡意 hash。**