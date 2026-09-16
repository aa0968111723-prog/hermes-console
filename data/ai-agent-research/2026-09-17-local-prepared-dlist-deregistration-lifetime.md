# 【AI Agent × Multimodal Research Report】

時間：2026-09-17 05:51（Asia/Taipei）

主題：NIXL Local Prepared Dlist × deregisterMem × metadataP lifetime × Local/Remote Coherence Asymmetry

## 本小時新發現

本輪延續 04:54 的 `PreparedDlist / RemoteSection Generation`，專門追上一輪尚未確認的缺口：**local prepared dlist 在 local memory deregister/remap 後，是否有和 remote weak-generation guard 對稱的 fail-closed 機制？**

核心新結論：在目前 NIXL main（本輪追蹤 commit `d24959417cefb5ab5bfb8d132020da010a323684`）中，`nixlMemSection::populate()` 會把 local section 中的 raw `nixlBackendMD* metadataP` 放入 prepared metadata descriptor；`nixlLocalSection::remDescList()` 則直接呼叫 backend `deregisterMem(metadataP)`，再從 section 移除 descriptor。相較於 remote prepared dlist 已有 `weak_ptr<nixlRemoteSection>` generation guard，本輪尚未在 local prepared dlist 路徑找到對稱的 local-section lifetime guard。因此 **local prepared dlist 必須被視為 registration-lifetime-bound object；應先 release request / prepared dlist，再 deregister memory**。NIXL 自己的 agent example 也採這個 teardown 順序。

這不是宣稱已證明存在可利用的 UAF；目前能確認的是 raw metadata pointer 的資料流與官方/example teardown contract，而「錯序 deregister 後重用 prepared local dlist 會發生哪一種 backend-specific failure」仍需下一輪以 unit test/ASAN/UCX backend 實測驗證。

## 本小時最重要 5 個發現

### 1. Local prepared descriptor 直接攜帶 backend registration metadata pointer

【已確認事實 / NIXL 原始碼】`nixlMemSection::populate()` 先找到覆蓋 query descriptor 的 registered section entry，然後建立 `nixlMetaStrideDesc(..., base[s_index].metadataP, ...)`。換句話說：

`Local Allocation → registerMem → nixlBackendMD* → LocalSection → prepXferDlist/populate → Prepared MetaStrideDesc.metadataP`。

這表示 prepared local dlist 不是只保存 `(addr,len,device)`；它已經解析到 registration metadata object identity。

來源：`ai-dynamo/nixl/src/infra/nixl_memory_section.cpp`。

### 2. `deregisterMem()` 會先交給 backend teardown metadata，再從 LocalSection 移除 registration entry

【已確認事實 / NIXL 原始碼】`nixlLocalSection::remDescList()` 先確認所有 descriptors 都存在；之後逐一 `backend->deregisterMem(target[idx].metadataP)`，再 `target.remDescs(indices)`。若該 `(memory type, backend)` section 已空，會從 `sectionMap` 與 `memToBackend` 移除。

底層：

`Registered Range → metadataP → backend.deregisterMem(metadataP) → remove LocalSection descriptor → possibly erase backend section`。

BackendGuide 同樣定義：`registerMem()` 回傳 per-registration `nixlBackendMD`，之後 transfer 會把同一 metadata key 傳回 backend；`deregisterMem()` 以該 metadata object 為唯一輸入。

來源：NIXL `nixl_memory_section.cpp`；BackendGuide。

### 3. Remote prepared dlist 有 generation guard；local prepared dlist 目前呈現不對稱 lifetime model

【已確認部分 + 工程推論】上一輪已確認 remote prepared dlist 保存 `weak_ptr<nixlRemoteSection>`，remote metadata generation 消失時 `makeXferReq()` 會 fail closed。Local prepared descriptors 本輪看到的是 raw backend `metadataP` 被 materialize 進 descriptor；目前追到的 `releasedDlistH()` 只是 delete dlist handle，沒有看到對 local section 的 weak ownership/generation check。

因此目前最合理的 correctness model 是：

```text
REMOTE
RemoteSection G7
→ weak generation guard
→ stale generation can be rejected

LOCAL
LocalSection registration
→ raw backend metadataP
→ PreparedLocalDlist
→ lifetime must not outlive registration
```

【尚未驗證假說】若 caller 先 deregister local memory、仍保留 prepared local dlist，再呼叫 `makeXferReq()`，不同 backend 可能回 error、使用 stale metadata，或由更深層檢查擋下；本輪沒有足夠證據把其中任何一種當成通用事實。

### 4. NIXL example 明確採「request → prepared dlist → deregister → free memory」順序

【已確認工程實作】NIXL `test/nixl/agent_example.cpp` 的 cleanup 順序為：

`releaseXferReq(req) → releasedDlistH(src) → releasedDlistH(dst) → deregisterMem(src/dst) → free buffers`。

這與本輪 lifetime dependency 完全一致：prepared descriptor 先於 registration teardown 被釋放，registration 又先於 backing allocation free 被解除。

Hermes 應把這個順序提升成 invariant：

```text
RequestLease < PreparedDlistLease < RegistrationLease < AllocationLease
```

也就是右側 object 的 lifetime 必須至少覆蓋左側依賴者。

### 5. Production failure 顯示 metadata/registration coherence 已是分散式推論的真實可用性問題

【工程 issue】2026-08 的 SGLang issue #33789 報告 NIXL P/D deployment 中只替換 Prefill 或 Decode 一側後，兩側雖然都顯示 Ready，但 requests 失敗或 timeout；雙邊重啟才恢復。這不能單獨證明是 local prepared-dlist stale pointer，但它強烈說明 agent replacement / metadata refresh / connection generation 必須進 health model，而不能只看 process readiness。

另外 LMCache #2983 曾報告 async PUT cleanup 與 sync GET race 導致「object segment key is not registered with backend」，顯示 registration cleanup 與 concurrent transfer ownership錯序確實可能直接殺死 inference engine。

來源：SGLang #33789；LMCache #2983。

## Architecture Breakdown

本輪 system architecture：**NIXL Local Registration → Prepared Transfer → Deregistration Lifetime Pipeline**。

```text
CUDA/DRAM Allocation
      │
      ▼
registerMem(desc)
      │
      ▼
Backend nixlBackendMD*
      │
      ▼
LocalSection
      │
      ├── serialize public metadata → Remote Agent
      │
      ▼
prepXferDlist(local)
      │
      ▼
populate()
      │
      ▼
Prepared MetaStrideDesc
(addr,len,devId,metadataP,stride,count)
      │
      ▼
makeXferReq
      │
      ▼
Backend prepXfer
      │
      ▼
post / progress / completion
      │
      ▼
release request
      │
      ▼
release prepared dlist
      │
      ▼
deregisterMem(metadataP)
      │
      ▼
remove LocalSection entry
      │
      ▼
allocator free / unmap
```

### Control plane vs data plane

Control plane：`registerMem → LocalSection → serialize metadata → RemoteSection`。

Data plane：`PreparedDlist → makeXferReq → backend request → transfer → completion`。

Lifetime plane：`AllocationLease → RegistrationLease → PreparedDlistLease → RequestLease`。

這三個 plane 必須同時成立；只畫 data path 會漏掉 stale registration 問題。

## Bottom-Level Logic

本輪 bottom-level mechanism：**backend metadata pointer materialization 與 deregistration invalidation**。

### Register

```text
Descriptor(addr,len,dev)
→ backend.registerMem
→ nixlBackendMD* M17
→ LocalSection stores M17
```

### Prepare

```text
Query(addr,len)
→ LocalSection.getCoveringIndex
→ registered entry
→ metadataP = M17
→ MetaStrideDesc(..., M17, ...)
→ PreparedLocalDlist
```

### Deregister

```text
Descriptor(addr,len)
→ LocalSection.getIndex
→ M17
→ backend.deregisterMem(M17)
→ remove descriptor from LocalSection
```

因此 `M17` 的 lifetime 是關鍵。Hermes 建議建立：

```text
RegistrationIdentity =
(backend, memory_type, registered_range, allocation_generation, backend_metadata_identity)
```

以及：

```text
PreparedLocalDlistValid =
RegistrationStillPresent
AND AllocationStillMapped
AND BackendMetadataStillLive
AND NoInFlightRequestDependsOnIt
```

這是 Hermes correctness abstraction，不是 NIXL 現有 API 的同名公式。

## Visual Simulation Idea

### Local Registration Lifetime Microscope

四條泳道：

```text
Allocator | allocate ------------------------------- free
NIXL      | register -- prepare -- request -- release -- deregister
Backend   |    M17 ------- memh/rkey ---------- destroy
GPU/NIC   |                 transfer ======> done
```

互動：

1. 正常順序：`release request → release dlist → deregister → free`，全部綠色。
2. 在 `PREPARED` 後直接按 `deregister`：`metadataP M17` 變紅，prepared local dlist 標示 `STALE / lifetime violation candidate`。
3. 在 `IN_FLIGHT` 時按 `deregister`：顯示 `transport ownership hazard`。
4. allocator `unmap/remap` 同一 VA：Allocation Generation +1，舊 registration/prepared state 全部要求重新驗證。
5. Remote Agent restart：對照 remote weak-generation guard與 local lifetime model的差異。

視覺核心不是顯示大量文字，而是讓使用者看見「pointer 還在，但它指向的 registration capability 已經死掉」。

## Code / GitHub

### 本輪深讀

1. `ai-dynamo/nixl/src/infra/nixl_memory_section.cpp`
   - `nixlMemSection::populate`
   - `nixlLocalSection::addDescList`
   - `nixlLocalSection::remDescList`
   - `nixlLocalSection::~nixlLocalSection`
   - `nixlRemoteSection::addDescList`

2. `ai-dynamo/nixl/src/core/nixl_agent.cpp`
   - `prepXferDlist`
   - `makeXferReq`
   - `releasedDlistH`
   - `releaseXferReq`

3. `ai-dynamo/nixl/test/nixl/agent_example.cpp`
   - cleanup ordering：request → dlist → deregistration → free。

4. `ai-dynamo/nixl/docs/BackendGuide.md`
   - `registerMem/deregisterMem`
   - backend metadata ownership
   - descriptor population semantics。

### 值得下一輪讀的核心檔案

- `src/plugins/ucx/ucx_backend.cpp/.h`
- UCX backend registration metadata class / destructor
- `src/infra/mem_section.h`
- `test/gtest/error_handling.cpp`
- registration/deregistration concurrency tests
- PR #2252 / #2253 對 releaseXferReq refusal/retry contract 的最新修正。

## Papers

### SmartGen: Seamless Disaggregated LLM Inference with Selective KV Cache Transfer

Authors：Xuchuan Luo, Jiacheng Shen, Xin Wang, Yangfan Zhou  
Year：2026  
URL：https://arxiv.org/abs/2607.28150  
Architecture：Prefill/Decode disaggregation + proactive essential-KV transfer + parallel on-demand fetch + speculative full transfer。  
Contribution：把「全部 KV 一次搬完」改成多路徑、選擇性 transfer；論文報告 time-to-second-token 最高 4.3× 改善。  
Limitations：selection correctness、remote fetch timing、network/workload 都會影響收益；本論文主要處理 transfer policy，不直接解決 registration metadata lifetime。  
本輪意義：當 transfer 從單一 bulk operation 變成 proactive/on-demand/speculative 多條 lifetime 重疊路徑時，registration / prepared-state ownership 會更重要。

### Tutti: Making SSD-Backed KV Cache Practical for Long-Context LLM Serving

Authors：Shi Qiu et al.  
Year：2026  
URL：https://arxiv.org/abs/2605.03375  
Architecture：GPU-centric KV object store + GPU io_uring + slack-aware I/O scheduling。  
Contribution：把 fragmented KV I/O 的 control path 往 GPU 移；論文報告相較 GDS-enabled SSD-backed LMCache，TTFT 降低 78.3%、request rate 2×。  
Limitations：SSD/offload architecture 與 RDMA registration lifecycle不是同一問題；數字只適用其實驗設定。  
本輪意義：再次證明 physical state layout、descriptor fragmentation、ownership/control path 都是 KV serving 的一級系統問題。

## Unknown / Open Questions

1. **Local prepared dlist stale guard**：local registration被 `deregisterMem()` 移除後，舊 prepared local dlist再進 `makeXferReq()`，UCX backend是否有可靠 fail-closed check？目前未確認。
2. **UCX metadataP ownership**：`nixlBackendMD*` 內究竟保存 `ucp_mem_h`、packed rkey、registration-cache reference 或其他 handle？`deregisterMem()` 精確銷毀哪些資源？
3. **Concurrency contract**：`deregisterMem()` 與 `makeXferReq/post/check` 是否由 NIXL agent lock 完整序列化，還是 backend queue / async progress仍存在跨 lock lifetime window？

## 下一輪研究

主題：**UCX Backend `registerMem/deregisterMem` × ucp_mem_h lifetime × rkey packing × Local Prepared Dlist stale-use test × NIXL agent locking**。

優先順序：

`nixlLocalSection::addDescList → UCX registerMem → UCX metadata object → populate(metadataP) → makeXferReq → UCX prepXfer → deregisterMem → metadata destructor → stale prepared dlist behavior`。

並追 2026-09-14 NIXL PR #2252 / #2253，確認 `releaseXferReq` 的 refusal-and-retry contract 是否已將 request ownership從「best effort release」提升為可驗證 state machine。

## Knowledge Graph 新增 Node / Edge

### Nodes

- `LocalRegistrationMetadata`
- `BackendMetadataPointer`
- `LocalPreparedDlist`
- `LocalRegistrationLifetime`
- `RegistrationPresence`
- `LocalPreparedStateStaleness`
- `RegistrationTeardownOrdering`
- `AllocationRegistrationDependency`
- `RequestPreparedDlistDependency`
- `LocalRemoteCoherenceAsymmetry`
- `AgentReplacementCoherence`
- `RegistrationCleanupRace`

### Edges

```text
Allocation
→ registered_as
→ LocalRegistrationMetadata

LocalRegistrationMetadata
→ materialized_into
→ LocalPreparedDlist

LocalPreparedDlist
→ used_to_build
→ BackendTransferRequest

DeregisterMem
→ invalidates
→ LocalRegistrationMetadata

RequestLease
→ depends_on
→ PreparedDlistLease

PreparedDlistLease
→ depends_on
→ RegistrationLease

RegistrationLease
→ depends_on
→ AllocationLease

RemotePreparedDlist
→ guarded_by
→ RemoteSectionWeakGeneration

LocalPreparedDlist
→ currently_requires_lifetime_discipline_with
→ LocalRegistrationMetadata
```

## 與歷史研究比較

04:54 輪已證明 remote side 存在 `RemoteSection weak generation` fail-closed guard；本輪沒有重複該結論，而是補上其鏡像缺口：local side prepared descriptors如何取得 registration metadata、deregister如何摧毀該 metadata，以及官方 example採用的 teardown ordering。

因此 Knowledge Graph 從：

`Remote Metadata Generation → PreparedDlist → Request`

擴充為雙側：

```text
Local Allocation
→ Local Registration Metadata
→ Local Prepared Dlist
→ Request
← Remote Prepared Dlist
← RemoteSection Generation
← Remote Registration Metadata
```

## 本輪結束判斷

- 缺哪一層：UCX backend `nixlBackendMD → ucp_mem_h/rkey` 的精確 ownership 與 teardown。
- 哪個節點最淺：`LocalPreparedStateStaleness`。
- 哪個概念仍只是名詞：`LocalRegistrationGeneration`；目前 remote generation有 object-lifetime實作證據，local side尚未找到對稱 generation object。
- 哪個系統最值得讀原始碼：NIXL UCX backend + NIXL agent locking / memory-section teardown。
- 哪篇論文需追引用：SmartGen，因 selective/on-demand KV transfer會把 registration lifetime與多 transfer path交疊問題放大。
- 哪個概念最適合視覺模擬：Local Registration Lifetime Microscope。
- 哪個 Agent 架構最值得實作：在 Hermes 仍是 `state-machine Agent Runtime + explicit resource lease graph`，因為它可以把 Tool/MCP/Model/GPU transport 都統一成「Acquire → Use → Complete → Release / Invalidate」的可觀測 execution state，而不是只畫 LLM reasoning loop。

## 從使用者一句話到 GPU 的新增拼圖

```text
User
→ UI
→ Agent Runtime
→ Context / Planning / Tool Loop
→ Model
→ KV / Multimodal State
→ GPU Allocation
→ Local Registration
→ Backend Metadata Capability
→ Prepared Local/Remote Dlists
→ Request Construction
→ Transport
→ Completion
→ Attention Kernel
→ Logits
→ Output
```

本輪補上的核心答案是：**AI runtime 裡一段 GPU state 能被搬移，不只因為它有 address；它必須有仍存活的 backend registration capability。Prepared transfer 已經把這個 capability materialize 進 descriptor，所以 teardown ordering 本身就是 distributed inference correctness 的一部分。**
