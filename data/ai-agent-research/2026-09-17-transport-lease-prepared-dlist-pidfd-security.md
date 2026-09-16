# 【AI Agent × Multimodal Research Report】

時間：2026-09-17 03:55（Asia/Taipei）

主題：OpenUCX VMM POSIX-FD IPC × pidfd Security × NIXL Prepared Dlist Lifetime × Deregistration / Transport Lease

## 本小時新發現

本輪延續上一輪 CUDA VMM / ExpandableSegment / POSIX-FD 研究，專注把抽象的 TransportLease 對應到真實 API 與失效條件。核心來源為 PyTorch `CUDACachingAllocator.cpp`、OpenUCX `cuda_ipc` VMM POSIX-FD 設計討論、NIXL/NIXLBench prepared-transfer 原始碼，以及 Linux `pidfd_getfd(2)` 權限語義。

新架構重點：跨程序 GPU memory fast path 不是單純 pointer-sharing，而是 `allocation → export capability → importer permission → imported mapping → transport registration → prepared descriptor → request → in-flight → completion → release → deregistration → unmap` 的生命週期圖。

## 本小時最重要 5 個發現

### 1. POSIX-FD VMM IPC 的核心不是傳 GPU pointer，而是傳 capability locator

【已確認事實 / 官方原始碼】PyTorch ExpandableSegment `share()` 會序列化 producer PID、segment geometry、handle type，並對 POSIX-FD handle 保存可分享 FD；`fromShared()` 則在 consumer 端重建 expandable segment mapping。OpenUCX 2026-06-11 issue #11548 提出的 POSIX-FD cuda_ipc arm直接沿用這個模式：export `{pid, fd}`，consumer 以 `pidfd_open(pid)` + `pidfd_getfd(pidfd, fd)` 取得 local duplicate FD，再 `cuMemImportFromShareableHandle`、`cuMemMap`、`cuMemSetAccess`。

底層：
`Producer VA → CUmemGenericAllocationHandle → POSIX FD → {PID,FD} → pidfd_getfd → local FD → imported CUmem handle → Consumer VA mapping`。

為什麼重要：distributed AI runtime 必須把「memory capability identity」與「virtual address identity」分開。

限制：OpenUCX 的 POSIX-FD arm截至本輪仍是 open feature request，不能把 proposed design 說成已部署 production implementation。

來源：
- https://github.com/pytorch/pytorch/blob/main/c10/cuda/CUDACachingAllocator.cpp
- https://github.com/openucx/ucx/issues/11548

### 2. pidfd_getfd 是 security boundary，不是無條件 FD duplication

【已確認事實 / Linux API】`pidfd_getfd()` 受 `PTRACE_MODE_ATTACH_REALCREDS` access check 約束；可能回傳 `EPERM`，Linux 5.6 起提供。它不要求 target process 透過 UNIX socket 主動合作，這與 SCM_RIGHTS 不同。

底層：
`PID → pidfd_open → ptrace-style permission check → pidfd_getfd(target_fd) → duplicated local FD`。

工程實作已出現 container 中 `pidfd_getfd: Operation not permitted` 的 PyTorch expandable-segments CUDA IPC案例，因此「同 user / 同 node」仍不能抽象成必然成功；container security policy、Yama/ptrace policy、namespace/capability 都可能改變結果。

為什麼重要：Hermes Knowledge Graph 應把 `IPCReachable` 拆成 `SameNode ∧ HandleExportable ∧ ImportPermission ∧ BackendImportable`。

來源：
- https://man7.org/linux/man-pages/man2/pidfd_getfd.2.html
- https://github.com/pytorch/pytorch/issues/165685

### 3. NIXL Prepared Dlist 是可重用 preparation state，但原始碼顯示它有明確 release lifecycle

【已確認事實 / GitHub 原始碼】NIXLBench `prepareSlot()` 在 `prepared_xfer` 模式先建立 local/remote descriptor lists，分別呼叫 `prepXferDlist()`，再用 prepared handles + indices 呼叫 `makeXferReq()`。普通模式則直接 `createXferReq()`。

`prepareSlot`：
`IOV → nixl_xfer_dlist_t → prepXferDlist(local) + prepXferDlist(remote) → nixlDlistH → makeXferReq → postXferReq`。

`recycleSlot()` 則先 `releaseXferReq()`，再 `releasedDlistH()` local/remote prepared handles；若啟用 `reregister_mem`，其後才執行 deregistration cycle。這證明 prepared dlist 與 request 是不同 lifetime object。

為什麼重要：Digital Twin 不能只有「prepared transfer=true/false」，而要畫出 `PreparedDlistHandle`、`XferReq`、`MemoryRegistration` 三個不同 stateful objects。

限制：NIXLBench 是 benchmark/client implementation，不能直接推論所有 backend 都具有完全相同內部 cache lifetime；但它可靠地展示 public agent API 的使用與 teardown order。

核心檔案：
- `benchmark/nixlbench/src/worker/nixl/nixl_worker.cpp`

### 4. 真正的 teardown ordering 已可部分落地：Request → Prepared Dlist → Deregistration

【工程實作】NIXLBench `recycleSlot()` 的順序是：

`releaseXferReq`
`→ releasedDlistH(local)`
`→ releasedDlistH(remote)`
`→ clear indices`
`→ deregisterIterationMem (when reregister_mem)`。

因此上一輪提出的 TransportLease 可以修正為至少兩層：

`TransferObjectLease: PREPARED → REQUEST_CREATED → IN_FLIGHT → COMPLETED → REQUEST_RELEASED → DLIST_RELEASED`

與：

`MemoryLease: ALLOCATED → MAPPED → REGISTERED → ... → DEREGISTERED → UNMAPPED → RELEASED`

兩條 lease 有交叉依賴，但不應被畫成單一直線。

【合理推論 / 待 backend 驗證】安全 invariant 應為：只要任何 request/prepared object 仍可能引用 registration-derived metadata，就不應 unmap/recycle underlying physical mapping。下一輪需追 NIXL agent/backend 實作確認 `prepXferDlist` 是否 materialize memh/rkey/backend metadata，或只保存 descriptor-normalization state。

### 5. Pointer equality 不能當 prepared-transfer validity key

【合理工程模型，由前幾輪已確認 VMM 行為支持】CUDA VMM 可讓同一 VA range 重新 map 到不同 physical allocation handles。因此：

`VA_t0 == VA_t1`
並不能推出
`PhysicalHandle_t0 == PhysicalHandle_t1`
更不能推出
`Registration_t0 == Registration_t1`
或
`PreparedDlist_t0 is valid at t1`。

Hermes 應使用 generation-aware validity：

`PreparedTransferValid = allocation_generation == registration_generation == prepared_generation ∧ mapping_active ∧ import_capability_valid ∧ peer_metadata_valid`。

這仍是 Hermes correctness abstraction，而非 NIXL 現有同名 API。

## Architecture Breakdown

### System Architecture：Cross-process VMM transport lifecycle

`PyTorch CUDA Allocator`
→ `ExpandableSegment / CUDA VMM`
→ `CUmemGenericAllocationHandle`
→ `POSIX FD or FABRIC capability`
→ `IPC capability metadata`
→ `pidfd permission boundary`
→ `Consumer import`
→ `Consumer VMM mapping`
→ `NIXL registerMem`
→ `Backend metadata / remote metadata`
→ `prepXferDlist`
→ `makeXferReq`
→ `postXferReq`
→ `getXferStatus / completion`
→ `releaseXferReq`
→ `releasedDlistH`
→ `deregisterMem`
→ `cuMemUnmap / cuMemRelease`。

這是一條「GPU state 如何變成可跨 process 移動的 transport object」的完整中介層。

## Bottom-Level Logic

### Mechanism：pidfd-based POSIX-FD import

1. allocator 使用 `cuMemCreate` 建 physical allocation handle。
2. physical handle map 到 producer VA。
3. export 時用 `cuMemExportToShareableHandle(... POSIX_FILE_DESCRIPTOR ...)` 得到 FD。
4. wire metadata攜帶 producer PID + FD number + segment geometry。
5. consumer `pidfd_open(producer_pid)`。
6. kernel 對 `pidfd_getfd` 執行 `PTRACE_MODE_ATTACH_REALCREDS` 權限檢查。
7. 成功後得到 consumer process 內的 duplicate FD。
8. consumer 用 CUDA Driver API import physical handle。
9. consumer reserve 自己的 VA；producer/consumer VA 不需相同。
10. `cuMemMap` + `cuMemSetAccess` 建 consumer GPU-visible mapping。
11. transport backend 才能在該 mapping 上建立 registration/IPC lane。

### Mechanism：Prepared transfer lifecycle

`raw IOV`
→ `prepareTransferDescriptors`
→ `prepXferDlist(local/remote)`
→ `PreparedDlistHandle`
→ `makeXferReq`
→ `postXferReq`
→ `IN_PROGRESS / SUCCESS`
→ completion polling
→ `releaseXferReq`
→ `releasedDlistH`
→ optional `deregisterMem`。

這比「Agent 把 KV 搬去另一張 GPU」多出數層 stateful runtime object。

## Visual Simulation Idea

### Transport Lease & Capability Simulator

畫面分四條泳道：

`Allocator | IPC Capability | NIXL Objects | GPU/Network`

互動事件：
- Allocate VMM
- Export POSIX FD
- pidfd import success / EPERM
- registerMem
- prepXferDlist
- make/post request
- transfer in flight
- attempt unmap while in flight
- completion
- release request
- release prepared dlist
- deregister
- remap same VA to new physical handle

每個 object 顯示 generation：
`Allocation G7 / Registration G7 / Prepared G7`。

按下 Remap 後：
`Allocation G8`，舊 Registration/Prepared handles 顯示 STALE；若使用者仍嘗試 post，模擬器標示 correctness hazard。

另加入 pidfd security gate：
`same node ✓ / same user ✓ / ptrace permission ✗ → POSIX-FD import denied → cuda_ipc lane unavailable → fallback candidate`。

## Code / GitHub

值得繼續追的原始碼：

1. PyTorch `c10/cuda/CUDACachingAllocator.cpp`
   - `ExpandableSegment::share`
   - `ExpandableSegment::fromShared`
   - map/unmap/release lifecycle
2. OpenUCX `src/uct/cuda/cuda_ipc/cuda_ipc_md.c`
   - legacy cudaMalloc IPC arm
   - VMM/FABRIC handle arm
   - `NO_IPC` fallback
   - proposed POSIX-FD arm in #11548
3. NIXL `benchmark/nixlbench/src/worker/nixl/nixl_worker.cpp`
   - `prepareSlot`
   - `postSlot`
   - `recycleSlot`
   - `cleanupSlots`
   - `registerIterationMem/deregisterIterationMem`
4. 下一輪應追 NIXL agent implementation：
   - `prepXferDlist`
   - `releasedDlistH`
   - `makeXferReq`
   - `releaseXferReq`
   - `registerMem/deregisterMem`

## Papers / Technical References

本輪以原始碼、Linux API 與工程 issue 為主，沒有找到比這些 primary sources 更直接回答 lifetime 問題的新論文，因此不為湊數加入弱相關 paper。

工程參考：
- OpenUCX #11548, 2026, VMM/mempool POSIX-FD-only cuda_ipc gap。
- NIXL #1754, 2026, PyTorch expandable_segments 導致 cuda_ipc fast path 消失的 H100/NVLink 實測。
- PyTorch #165685, 2025, container 中 pidfd_getfd EPERM。
- PyTorch #186213, 2026, expandable IPC receiver 每個 imported handle 大量 reserve VA，顯示 imported mapping/cache 本身也可能成為資源瓶頸。

## 與歷史研究比較

上一輪已確認：VMM physical handle、POSIX-FD export/import、pointer identity hazard、allocation generation。

本輪新增且避免重複的層：
1. pidfd permission/security boundary。
2. PreparedDlistHandle 與 XferReq 的 lifetime 分離。
3. NIXLBench 實際 teardown ordering。
4. TransportLease 從單線 state machine 修正成 TransferObjectLease × MemoryLease 兩條交叉 lease。
5. imported VA/cache 可能本身造成 VA-space pressure。

## Unknown / Open Questions

1. `prepXferDlist()` 的 backend-specific prepared handle 究竟保存哪些 registration-derived objects：memh、rkey、remote metadata pointer、backend MR cache entry，還是純 descriptor normalization？這決定 deregistration 後 prepared handle 的 exact invalidation semantics。
2. OpenUCX #11548 的 POSIX-FD arm若實作，FD lifetime 應綁定 memory deregistration、rkey lifetime 還是 exporter allocation lifetime？producer FD 提前 close 時，已 duplicate/import 的 consumer handle是否完全獨立？需追 CUDA Driver API ownership semantics。
3. Container / Kubernetes / user namespace / Yama ptrace_scope 下，如何建立最小權限的 pidfd GPU IPC policy，而不要求過度寬鬆的 ptrace capability？

## 下一輪研究

優先研究：
`NIXL prepXferDlist internals → backend prepared descriptor → registration lookup → deregisterMem invalidation → UCX rkey/memh cache lifetime → remote metadata invalidation → request completion ownership`。

並追一個新的 system-level failure mode：
`Imported VMM VA reservation explosion → IPC handle cache → VA exhaustion → distributed inference long-running stability`。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `IPCCapabilityLocator`
- `PidfdPermissionBoundary`
- `PtraceRealCredsCheck`
- `ImportedGPUFD`
- `PreparedDlistHandle`
- `TransferRequestHandle`
- `TransferObjectLease`
- `MemoryLease`
- `PreparedGeneration`
- `RegistrationGeneration`
- `ImportedVAMapping`
- `IPCHandleCache`
- `VirtualAddressPressure`
- `TransportTeardownOrder`

新增 Edges：
- `POSIXFDGPUCapability → located_by → {PID,FD}`
- `{PID,FD} → guarded_by → PidfdPermissionBoundary`
- `PidfdPermissionBoundary → authorizes → ImportedGPUFD`
- `PreparedDlistHandle → used_to_create → TransferRequestHandle`
- `TransferRequestHandle → must_release_before → PreparedDlistHandle`
- `PreparedDlistHandle → should_release_before → MemoryDeregistration`
- `AllocationRemap → increments → AllocationGeneration`
- `GenerationMismatch → invalidates → PreparedTransfer`
- `ImportedVAMapping → consumes → GPUVirtualAddressSpace`
- `IPCHandleCache → retains → ImportedVAMapping`

## 本輪結束判斷

缺哪一層：NIXL agent/backend 對 prepared dlist 的內部 materialization 與 deregistration invalidation。

哪個節點最淺：`PreparedGeneration`，目前仍是 Hermes correctness abstraction。

哪個概念仍只是名詞：`TransportLease` 已開始落地，但尚未逐 backend 對應所有 API/state transition。

哪個系統值得讀原始碼：NIXL agent `prepXferDlist/releasedDlistH` 與 UCX backend memory-registration/rkey cache。

哪篇論文需追引用：本輪 primary evidence 以 source/API/issue 為主；下一輪若轉向 long-running distributed serving stability，再補 KV transfer/cache lifetime paper。

哪個概念最適合視覺模擬：`Transport Lease & Capability Simulator`。

哪個 Agent 架構最值得實作：對 Hermes 本身，最值得實作的是 event-driven state-machine runtime，把 tool/model/transport execution都表示成可觀測 lease，而不是再新增一個高階 ReAct clone。

## 從一句話到 GPU 的新增鏈段

`使用者一句話`
→ UI
→ Agent Runtime
→ Context / Planning / Memory / Tools
→ Model
→ KV / Multimodal State
→ CUDA Allocator
→ VMM Physical Handle
→ POSIX-FD/FABRIC Capability
→ pidfd Permission Gate
→ Consumer Mapping
→ NIXL Registration
→ Prepared Dlist
→ Transfer Request
→ GPU/NIC Movement
→ Completion
→ Request/Dlist Teardown
→ Deregistration
→ Attention Kernel
→ Logits
→ Output。

本輪核心答案：AI distributed runtime 中，「GPU memory 可以被另一個 process 使用」不是單一布林值，而是一條帶權限、handle type、mapping、registration、prepared-object 與 lifetime ordering 的 capability graph。