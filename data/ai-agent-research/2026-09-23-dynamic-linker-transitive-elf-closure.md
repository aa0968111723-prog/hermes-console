# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-23 22:50 Asia/Taipei

## 本小時新發現
本輪承接上一輪 `SameObjectExecutionWitnessV2 → NativeAddonExecutionWitness`，專注 Python/Node native extension 進入 glibc dynamic linker 後，如何把單一 `.so` 擴張為可驗證的 transitive ELF closure。研究對象包含 glibc `elf/dl-load.c`、Linux `dlopen(3)` / `ld.so(8)`、rtld audit 與 link-map namespace。

新的核心鏈：

`Python _imp.create_dynamic / Node process.dlopen → dlopen(path) → search policy → open FD → _dl_map_object_from_fd → file identity → PT_LOAD mmap → dynamic section → DT_NEEDED → recursive resolution → link_map namespace → relocation/symbol binding → constructors → NativeELFClosureGeneration`

與上一輪相比，本輪不再只問「native addon 本體是不是同一 file object」，而是追蹤 addon 會讓哪些額外 DSO 真正進入 address space。

---

## 本小時最重要 5 個發現

### 1. glibc 真正 mapping shared object 的核心已經是 FD-bound
**已確認事實 / 原始碼：** glibc `elf/dl-load.c` 的 `_dl_map_object_from_fd()` 接收已開啟 FD；它先取得 file identity，讀 ELF/program headers，最後把同一 FD 傳給 `_dl_map_segments()`。mapping 完成後才 close FD。

這表示 dynamic linker 內部真正的 object consumption 並不是純 pathname：

`path resolution → open FD → ELF verify/read → PT_LOAD mmap(same FD)`

因此 Hermes 不需要重新發明 ELF mapping；真正缺的是在 glibc open→map 邊界加入/取得可驗證 witness。

**為什麼重要：** 上一輪的 `verify(fd) → dlopen(path)` 有 reopen risk；若能觀測或控制 glibc 實際開啟的 FD，就能建立 `MappedELFObjectWitness`。

**限制：** 公開 `dlopen()` API 接受 pathname，沒有標準 `dlopen(fd)`；所以外部 verifier 仍無法單靠預先驗證 FD 保證 glibc 使用該 FD。

### 2. Native addon 的 identity 必須是 transitive dependency graph，不是單一 `.so`
**已確認事實 / 官方文件：** `dlopen()` 若 pathname 不含 `/`，dynamic linker 會依 DT_RPATH（特定條件）、LD_LIBRARY_PATH、DT_RUNPATH、cache、default directories 等規則尋找 object；載入後，其 `DT_NEEDED` dependency 又會繼續觸發 resolution。

所以：

`NativeAddonDigestValid --does_not_prove→ NativeELFClosureApproved`

真正需要：

`RootAddon → DT_NEEDED edges → ResolvedDSO nodes → recursive DT_NEEDED → namespace closure`

每個 node 必須綁：resolved object identity、content digest/verity、namespace、load generation、provenance/reference policy。

### 3. RPATH 與 RUNPATH 的傳播語意不同，會直接改變 closure
`DT_RUNPATH` 主要用於 object 的 immediate dependencies；舊式 `DT_RPATH` 具有不同、較具傳播性的 resolution behavior。`LD_LIBRARY_PATH`、`$ORIGIN/$LIB/$PLATFORM` expansion、`ld.so.cache` 與 hardware capability directories 也可能改變最終 resolution。

因此 Hermes 必須把 **loader search policy 本身** 視為 code identity 的一部分：

`LoaderSearchPolicyGeneration = H(RPATH, RUNPATH, LD_LIBRARY_PATH policy, cache generation, default dirs, hwcaps, secure-exec state)`

否則同一 root `.so` digest 在兩台機器可能解析出不同 transitive closure。

### 4. LD_PRELOAD / LD_AUDIT / dlmopen namespace 代表「實際 loaded graph」可超出 DT_NEEDED graph
`LD_PRELOAD` 可以在其他 objects 前載入額外 DSO並影響 symbol interposition；`LD_AUDIT` audit objects 會在獨立 linker namespace 接收 object-load checkpoints；`dlmopen(LM_ID_NEWLM, ...)` 可建立新的 link-map namespace。

所以：

`DeclaredDTNeededGraph --does_not_prove→ ActualLoadedELFGraph`

新增：

`ActualLinkMapGraph`
`PreloadInjectionGeneration`
`LoaderAuditGeneration`
`LinkMapNamespaceIdentity`

高風險 Agent profile 應將未批准 preload、audit module、new namespace 視為 closure mutation event。

### 5. rtld audit 很適合 observation，但不能直接等同 security enforcement
`rtld-audit` 的 `la_objopen()` 會在新 shared object 載入時收到 link_map 與 namespace identity，`la_activity()` 可看到 link-map activity 狀態。

這很適合建立：

`Loader Event → Object Identity → Namespace → ClosureGeneration++`

但合理推論是：如果 attacker 已能控制 loader environment 或 process runtime，單純 LD_AUDIT observation 不能被當成完整 trusted enforcement；它應與 IMA/fs-verity、process/code attestation、policy gate交叉驗證。

因此：

`RtldAuditObserved --does_not_prove→ DSOApproved`

---

## Architecture Breakdown

### Native Extension / DSO trust path
1. Agent runtime 決定載入 native addon。
2. Python `_imp.create_dynamic` 或 Node `process.dlopen` 進入 platform loader。
3. `dlopen(path)` 建立 root load request。
4. dynamic linker依 RPATH/RUNPATH/environment/cache/default dirs resolve candidate。
5. candidate 被 open 成 FD。
6. glibc `_dl_map_object_from_fd()` 取得 file identity並讀 ELF metadata。
7. `_dl_map_segments()` 從該 FD mapping PT_LOAD segments。
8. dynamic section產生 `DT_NEEDED` dependency edges。
9. 每個 dependency 重複 resolve→open→map。
10. object加入指定 `link_map` namespace。
11. relocation / symbol resolution決定實際 symbol provider。
12. constructors 執行。
13. loader observation layer產生 object-load events。
14. Hermes 將實際 loaded object graph與 Approved ELF Reference Graph比對。
15. graph mutation造成 `NativeELFClosureGeneration++`。
16. 高風險 signer authorization 必須綁定最新 closure generation。

### 建議 Hermes Runtime component
`DynamicLinkClosureMonitor`

輸入：
- process generation
- link-map namespace
- root native addon request
- rtld object events
- resolved path + file identity
- artifact digest / fs-verity digest
- package/provenance witness
- DT_NEEDED / SONAME
- RPATH/RUNPATH
- preload/audit state

輸出：
- `NativeELFClosureGeneration`
- `NativeELFClosureCoverage`
- `UnexpectedDSO[]`
- `UnapprovedResolutionEdge[]`
- `SignerRevocationRequired`

---

## Bottom-Level Logic

### glibc object mapping
`dlopen request`
→ `search path selection`
→ `candidate pathname`
→ `open/verify`
→ `FD`
→ `_dl_get_file_id(fd)`
→ `_dl_map_object_from_fd`
→ read ELF header/program headers from FD
→ collect PT_LOAD
→ `_dl_map_segments(... fd ...)`
→ parse dynamic section
→ close FD only after mappings established
→ add object to namespace/link_map

### Transitive closure
`RootDSO`
→ parse `DT_NEEDED[n]`
→ for each SONAME/name: resolve using loader policy
→ open actual object
→ map object
→ extract its `DT_NEEDED`
→ recurse
→ produce actual graph G(V,E)

Node identity proposal:
`ELFObjectIdentity = H(namespace, contentDigest, buildId?, soname, provenanceIdentity)`

Edge identity proposal:
`ELFResolutionEdge = H(parentObject, neededName, searchPolicyGeneration, resolvedObjectIdentity)`

Closure generation proposal:
`NativeELFClosureGeneration = H(previousGeneration, namespace, objectLoadUnloadEvent, ELFObjectIdentity, ELFResolutionEdge, policyDecision)`

注意：Build-ID 可做 diagnostics/join key，但不能取代 cryptographic content identity。

---

## Visual Simulation Idea
### Dynamic Linker Transitive Closure Microscope

畫面節點：
`Python/Node Runtime | root addon | dlopen | RPATH/RUNPATH | LD_LIBRARY_PATH | ld.so.cache | glibc FD | PT_LOAD mmap | DT_NEEDED | link_map namespaces | IMA/fs-verity | provenance | signer`

互動注入：
- `ROOT_ADDON_VALID_DEPENDENCY_SWAPPED`
- `LD_LIBRARY_PATH_SHADOW_LIBRARY`
- `DT_RUNPATH_RESOLVES_UNAPPROVED_DSO`
- `LD_PRELOAD_INJECTED`
- `ETC_LD_SO_PRELOAD_INJECTED`
- `LD_AUDIT_UNAPPROVED`
- `DLMOPEN_NEW_NAMESPACE`
- `SAME_SONAME_DIFFERENT_DIGEST`
- `TRANSITIVE_DEPENDENCY_CHANGED`
- `OBJECT_LOADED_AFTER_SIGNER_AUTH`

視覺結果示例：
`addon ✓ → libA ✓ → libB ✗ → NativeELFClosureGeneration changed → signer BLOCK`

---

## Code / GitHub
### glibc
Repository: `bminor/glibc`

值得持續讀：
- `elf/dl-load.c` — path resolution、`_dl_map_object_from_fd`、file identity、mapping入口
- `elf/dl-map-segments.h` — PT_LOAD mapping
- `elf/dl-deps.c` — dependency graph / DT_NEEDED traversal
- `elf/dl-open.c` — dlopen scope與dependency loading
- `elf/dl-lookup.c` — symbol lookup/interposition
- `elf/dl-audit.c` — rtld audit callbacks
- `elf/rtld.c` — process startup loader state/environment
- `elf/dl-close.c` — unload與closure mutation

原始碼確認：`_dl_map_object_from_fd()` 會取得 FD file identity、從 FD讀 program header，將同一 FD交給 `_dl_map_segments()`，完成 mapping 後才 close descriptor。

---

## Papers / 技術來源
本輪主題偏 system implementation，核心證據優先採 glibc 原始碼與 Linux/glibc manual，而非用論文替代實作事實。

後續值得接續的研究文獻方向：
- runtime integrity measurement / IMA
- dynamic-linker attack surface與library interposition
- continuous runtime attestation
- software supply-chain provenance與runtime evidence binding

---

## 已確認 / 推論 / 未驗證邊界
**已確認：** glibc `_dl_map_object_from_fd()` 是 FD-bound mapping path；DT_NEEDED、RPATH/RUNPATH、LD_LIBRARY_PATH、LD_PRELOAD、LD_AUDIT、link-map namespace都會影響 runtime loaded objects。

**工程推論：** Hermes 可以將 rtld load events + file digest/verity + provenance組合為 event-sourced `NativeELFClosureGeneration`。

**尚未驗證假說：** 不修改 glibc 的前提下，能否用足夠可信、低 race 的方式取得「每次 loader open 的 FD digest」並把它與 rtld audit event一一綁定；這需要下一輪繼續研究 fanotify/LSM/eBPF/IMA 與 loader event correlation。

---

## Unknown / Open Questions
1. 如何把 rtld `la_objopen/link_map` event 與 kernel實際 mmap 的 file object/verity digest建立不可混淆的一對一 binding？
2. symbol interposition 是否需要成為 closure identity 的一部分，而不只是 loaded object set？同一 object graph但不同 symbol provider order可能改變程式語意。
3. `dlclose()`、lazy loading、IFUNC與late `dlopen()` 發生時，如何讓既有 signer authorization立即失效？

---

## 下一輪研究
鎖定：

`Loaded DSO graph → symbol resolution → relocation → interposition → LD_PRELOAD → IFUNC → lazy binding → actual callable-code provider → SymbolBindingGeneration`

核心問題：即使所有 `.so` 都是批准的 bytes，Hermes 如何證明某個 native call 最後實際跳到的是哪一個 object / symbol implementation？

---

## Knowledge Graph 新增 Node / Edge
### Nodes
- `NativeELFClosureGeneration`
- `MappedELFObjectWitness`
- `ELFObjectIdentity`
- `ELFResolutionEdge`
- `LoaderSearchPolicyGeneration`
- `ActualLinkMapGraph`
- `LinkMapNamespaceIdentity`
- `PreloadInjectionGeneration`
- `LoaderAuditGeneration`
- `TransitiveDSODependencyWitness`
- `NativeELFClosureCoverage`

### Edges
- `RootNativeAddon --requires→ TransitiveDSOClosure`
- `DT_NEEDED --resolves_via→ LoaderSearchPolicyGeneration`
- `ResolvedPath --opens→ MappedELFObjectWitness`
- `MappedELFObjectWitness --joins→ ArtifactProvenanceWitness`
- `MappedELFObjectWitness --member_of→ LinkMapNamespaceIdentity`
- `LD_PRELOAD --mutates→ ActualLinkMapGraph`
- `dlmopen --creates→ LinkMapNamespaceIdentity`
- `ObjectLoadUnloadEvent --increments→ NativeELFClosureGeneration`
- `NativeELFClosureGeneration --binds→ HighRiskSignerAuthorization`
- `NativeAddonDigestValid --does_not_prove→ NativeELFClosureApproved`
- `DeclaredDTNeededGraph --does_not_prove→ ActualLoadedELFGraph`
- `RtldAuditObserved --does_not_prove→ DSOApproved`

---

## 本輪結束檢查
- **缺哪一層：** loaded ELF object → actual symbol implementation / relocation target。
- **哪個節點最淺：** `SymbolBindingGeneration`（下一輪建立）。
- **哪個概念仍只是名詞：** portable `MappedELFObjectWitness` envelope。
- **哪個系統值得讀原始碼：** glibc `dl-deps.c`, `dl-open.c`, `dl-lookup.c`, `dl-runtime.c`, `dl-audit.c`。
- **哪篇論文需追引用：** continuous runtime attestation + dynamic-linker integrity work；下一輪加入具體論文與 citation graph。
- **哪個概念最適合視覺模擬：** Dynamic Linker Transitive Closure Microscope。
- **哪個 Agent 架構最值得實作：** `Risk-aware Planner + Provenance/FD-bound Code Gate + DynamicLinkClosureMonitor + Event-sourced CodeClosureGeneration + Runtime Attestation + Non-exportable Signer + DPoP/MCP + SemanticCommit/Receipt Runtime`。

## 對「AI 到底怎麼運作」總鏈的新增
`UI → Agent → Context → Reasoning → Planning → Runtime → Python/Node → Native Addon → glibc dlopen → FD → ELF mmap → DT_NEEDED recursive closure → link_map → relocation/symbol binding → machine code execution → CodeClosureGeneration → signer → MCP/tool → action → output`

多模態 Agent 若使用 CUDA/cuDNN/FFmpeg/OpenCV/ONNX Runtime/PyTorch native stack，同樣會穿過這條 native ELF closure；因此這不是旁支安全議題，而是 Camera/Image/Voice/Video → Encoder/Runtime → GPU 執行鏈的一部分。