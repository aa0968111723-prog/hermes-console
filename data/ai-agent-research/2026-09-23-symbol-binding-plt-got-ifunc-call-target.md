# 【AI Agent × Multimodal Research Report】

**時間：2026-09-23 23:55（Asia/Taipei）**  
**主題：Symbol Binding Generation × PLT/GOT × Lazy Binding × Interposition × IFUNC × Actual Call Target**

## 與歷史研究比較

上一輪已建立 `ActualLinkMapGraph / NativeELFClosureGeneration`，回答「哪些 ELF/DSO 真正被載入」。本輪刻意不重複 DSO 搜尋與 mapping，而下鑽一層：即使所有 loaded DSO 都是批准的 bytes，一個 native call 最後仍需經過 symbol lookup、version matching、relocation、PLT/GOT、lazy/eager binding、interposition 與 IFUNC resolver，才能決定真正跳到哪個 machine-code address。因此 `ApprovedLoadedObjectGraph` 不能直接推出 `ApprovedCallTargetGraph`。

## 本小時新發現

### 1. glibc lazy PLT binding 是可精確建模的 state transition【已確認／原始碼】

`elf/dl-runtime.c::_dl_fixup()` 是第一次 lazy PLT call 的核心路徑：由 PLT relocation 找出 referenced symbol，呼叫 `_dl_lookup_symbol_x()`，形成 defining `link_map + symbol address`，若 symbol 為 `STT_GNU_IFUNC` 再呼叫 resolver，最後由 `elf_machine_fixup_plt()` 修補 PLT/GOT，使後續 call 直接到已解析 target。

可拆成：

`CallSite → PLT Entry → JMP_SLOT Relocation → Symbol Name/Version → Lookup Scope → Defining DSO → Symbol Address → IFUNC? → Audit? → GOT/PLT Patch → Machine-Code Target`

因此 `SymbolBindingGeneration` 必須是 code closure 的一部分，而不能只記錄 loaded libraries。

### 2. symbol version 是 binding identity 的一部分【已確認／原始碼】

`elf/dl-lookup.c` 的 lookup 不只比較 symbol name，也處理 version hash/name、hidden/default version。故 `foo@VER_A` 與 `foo@VER_B` 不應在 Hermes KG 被視為同一 callable identity。

`SymbolIdentity = H(name, version, definingObjectIdentity, symbolIndex/type)`

### 3. LD_PRELOAD / lookup scope 的風險本質是 implementation interposition【已確認 + 工程建模】

上一輪只看到「額外 DSO 被載入」。本輪補出真正 effect：symbol lookup scope 可讓 reference bind 到另一個 defining object，因此即使原本預期 libc 的 function，實際 target 可能來自 preload object。

`AllDSOsApproved --does_not_prove→ ExpectedProviderWonLookup`

Hermes 應保存 `ReferenceObject → Symbol → DefiningObject → ResolvedAddress` edge，而不只是 DSO set。

### 4. IFUNC 使「symbol provider」仍不足以決定真正 implementation【已確認／官方文件 + 原始碼】

`STT_GNU_IFUNC` symbol 指向 resolver，而 resolver回傳真正 implementation address；glibc 文件指出 resolver可依 CPU capability/tunables選 implementation，lazy PLT 情況可到第一次 call 才 resolve。因此：

`DefiningDSO + SymbolName --does_not_prove→ FinalMachineCodeTarget`

需要：

`IFUNCResolverIdentity → ResolverInputs/HWCAP/Tunables → ReturnedAddress → ContainingApprovedMapping`

### 5. rtld audit 能觀察 binding，但 audit 本身可改 target【已確認／原始碼 + man page】

`la_symbind*()` 可取得 referencing object、defining object、symbol，且其 return value可以改變實際控制流 target；`la_pltenter()` 也可在 PLT call 前觀察並改變 value。glibc `dl-audit.c` 也明確處理 `LA_SYMB_ALTVALUE`。

所以：

`AuditObservedBinding --does_not_prove→ AuditDidNotRewriteBinding`

安全 profile 不能把 `LD_AUDIT` 單純當可信 observer；若使用 audit 做 telemetry，audit module 本身必須被納入 CodeClosure 與 policy，並記錄 alternate target capability。

## 本小時最重要 5 個發現

1. **PLT/GOT binding 是動態 code identity**：lazy binding 可在第一次 call 才決定 provider，故 signer authorization 前的 loaded-object snapshot 不足。
2. **Symbol version 不能省略**：名稱相同不等於 ABI/implementation identity相同。
3. **Interposition 是 edge-level 攻擊面**：風險不是只多載入一個 `.so`，而是它可能贏得 lookup 並接管既有 symbol。
4. **IFUNC 再增加一層 runtime choice**：即使 defining DSO與 symbol已知，resolver仍決定最終 machine-code target。
5. **LD_AUDIT 不是純 observer**：audit callbacks本身具有 target substitution能力，必須被視為 active runtime participant。

## Architecture Breakdown

```text
Python/Node/native call
  ↓
call site
  ↓
PLT entry
  ↓
JMP_SLOT relocation
  ↓
Symbol Reference Identity
  ↓
Lookup Scope Generation
  ↓
_dl_lookup_symbol_x
  ↓
Symbol Version Match
  ↓
Defining link_map / DSO
  ↓
STT_GNU_IFUNC ?
  ├─ no → symbol address
  └─ yes → resolver → implementation address
  ↓
rtld audit / possible alternate value
  ↓
PLT/GOT patch
  ↓
Actual Callable Address
  ↓
Containing executable mapping
  ↓
Mapped ELF Artifact Identity
  ↓
CallTargetWitness
  ↓
SymbolBindingGeneration
  ↓
CodeClosureGeneration
```

## Bottom-Level Logic

對 lazy binding，Hermes 應將一次 binding 建模為：

`BindingEvent = H(refObjectGeneration, relocationIdentity, symbolName, symbolVersion, lookupScopeGeneration, definingObjectGeneration, resolvedSymbolOffset, ifuncResolverGeneration?, finalTargetAddressClass, auditGeneration, sequence)`

其中 `finalTargetAddressClass` 不應依賴 ASLR 絕對位址做跨機器 identity，而應轉成：

`TargetCodeIdentity = H(mappedArtifactDigest, executableSegmentIdentity, relativeOffset, symbolIdentity, IFUNCImplementationIdentity?)`

這是 Hermes architecture proposal，尚非現有標準 attestation envelope。

高風險 signer gate：

`NativeCallClosureApproved = LoadedObjectGraphApproved ∧ SymbolBindingPolicyApproved ∧ IFUNCTargetContainedInApprovedMapping ∧ NoUnapprovedAuditRewrite ∧ BindingGenerationFresh`

## Visual Simulation Idea

### PLT/GOT → Actual Call Target Microscope

互動欄位：
- Referencing DSO
- call site / PLT slot
- relocation
- requested symbol + version
- lookup scope order
- candidate providers
- selected defining DSO
- preload/interposition state
- IFUNC resolver + HWCAP/tunables
- audit callback
- GOT before/after
- final target mapping/digest
- CodeClosureGeneration
- signer authorization state

Fault injection：
- `LD_PRELOAD_SYMBOL_INTERPOSITION`
- `SAME_SYMBOL_WRONG_VERSION`
- `LAZY_BIND_AFTER_SIGNER_AUTH`
- `IFUNC_RETURNS_UNEXPECTED_TARGET`
- `LD_AUDIT_ALTERNATE_VALUE`
- `DLSYM_RETURNS_DIFFERENT_PROVIDER`
- `NEW_NAMESPACE_DIFFERENT_BINDING`

最重要畫面：

`DSO closure ✓ | Symbol lookup ✓ | Defining DSO ✓ | IFUNC target ? | Audit rewrite ✗`

→ `BLOCK HIGH-RISK SIGN`

## Code / GitHub

### glibc
值得持續追：
- `elf/dl-runtime.c` — `_dl_fixup`, lazy PLT resolution, IFUNC invocation, PLT patch
- `elf/dl-lookup.c` — symbol lookup, scope, version matching, interposition semantics
- `elf/dl-audit.c` — `la_symbind` / PLT audit與 alternate target
- 下一輪：`elf/dl-reloc.c`, arch `dl-machine.h`, `dlsym.c`, `dl-sym.c`

## Papers / Specifications / Primary Sources

本輪主要是 system architecture / original-source deep dive，而非新增 Agent 論文：
- GNU C Library Dynamic Linker / Indirect Functions documentation (2026 current docs)
- glibc current source `dl-runtime.c`, `dl-lookup.c`, `dl-audit.c`
- Linux `rtld-audit(7)` interface documentation

這輪改變的是 Hermes KG 對 native execution 的粒度：由「載入哪個 library」提升為「每個 reference 最後 bind 到哪個 provider / implementation」。

## Unknown / Open Questions

1. 如何低 overhead 地取得 production Agent 的 complete binding graph，而不使用可改 target 的 `LD_AUDIT`？可比較 uprobes/eBPF、USDT、loader internal probes、BPF LSM 等觀測方式。
2. IFUNC target 如何建立 portable identity？ASLR address不穩定，需驗證 `mapping artifact digest + segment + relative offset` 是否足以跨機器重建。
3. lazy binding發生在 signer authorization之後時，是否一律使舊 authorization stale，或能以 approved-provider policy做 incremental validation？

## 下一輪研究

`SymbolBindingGeneration → actual CPU/GPU callable implementation → CUDA driver/runtime → cuDNN/cuBLAS/TensorRT/PyTorch dispatcher → GPU kernel selection → kernel module / cubin / PTX JIT → GPU executable code identity`

理由：這能把目前 native ELF trust chain正式接到 AI inference最核心的 GPU execution path，而不是繼續只在 CPU loader層往橫向擴張。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `SymbolReferenceIdentity`
- `SymbolVersionIdentity`
- `LookupScopeGeneration`
- `SymbolBindingGeneration`
- `DefiningObjectWitness`
- `PLTRelocationIdentity`
- `GOTBindingGeneration`
- `InterpositionDecision`
- `IFUNCResolverIdentity`
- `IFUNCImplementationIdentity`
- `AuditBindingGeneration`
- `AuditAlternateTargetWitness`
- `ActualCallableTargetWitness`
- `NativeCallClosureGeneration`

### Edges
- `SymbolReferenceIdentity --resolved_under→ LookupScopeGeneration`
- `LookupScopeGeneration --selects→ DefiningObjectWitness`
- `SymbolReferenceIdentity --version_constrains→ SymbolVersionIdentity`
- `DefiningObjectWitness --defines→ SymbolBindingGeneration`
- `STT_GNU_IFUNC --invokes→ IFUNCResolverIdentity`
- `IFUNCResolverIdentity --selects→ IFUNCImplementationIdentity`
- `AuditBindingGeneration --may_replace→ ActualCallableTargetWitness`
- `SymbolBindingGeneration --materializes_as→ GOTBindingGeneration`
- `ActualCallableTargetWitness --must_be_contained_in→ ApprovedExecutableMapping`
- `SymbolBindingGeneration --mutates→ NativeCallClosureGeneration`
- `NativeCallClosureGeneration --mutates→ CodeClosureGeneration`

## 本輪結束判斷

- **缺哪一層：** CPU native call target之後的 GPU runtime/kernel dispatch identity。
- **哪個節點最淺：** `GPUKernelExecutionWitness`（下一輪建立）。
- **哪個概念仍只是名詞：** portable signed `ActualCallableTargetWitness`。
- **哪個系統值得讀原始碼：** PyTorch dispatcher + CUDA runtime/driver loading + NVIDIA kernel module loading path。
- **哪篇/哪組資料需追引用：** GPU runtime attestation / confidential GPU / kernel provenance相關官方技術報告與研究。
- **哪個概念最適合視覺模擬：** PLT/GOT → Actual Call Target Microscope。
- **哪個 Agent 架構最值得實作：** `Risk-aware Planner + NativeCallClosure Monitor + Provenance/FD-bound Code Gate + Runtime Attestation + Non-exportable Signer + DPoP/MCP + SemanticCommit/Receipt Runtime`。

## 回到總目標

目前底層鏈已推進到：

`使用者 → UI → Agent → Context → Reasoning → Planning → Memory → Tool/MCP → Language Runtime → Package Artifact → Verified File Object → ELF/DSO → Dynamic Linker → Symbol Lookup → PLT/GOT/IFUNC → Actual CPU Machine-Code Target → [下一輪：CUDA/PyTorch → GPU Kernel] → Output`

多模態鏈可進一步寫成：

`Camera/Image/Voice/Video → Decoder/Encoder → Python/Node → Native Tensor Runtime → ELF Binding → CUDA Runtime/Driver → GPU Kernel → Tensor Result → Model/Agent → Action`

本輪最重要的新問題因此變成：**當 Hermes 已能知道 CPU 上 native function 最終跳到哪份 machine code 後，如何一路追進 CUDA/PyTorch dispatcher，證明真正送到 GPU 執行的 kernel / cubin / PTX JIT code 也是被批准的那一代？**