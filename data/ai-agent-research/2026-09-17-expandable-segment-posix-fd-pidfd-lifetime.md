# 【AI Agent × Multimodal Research Report】

時間：2026-09-17 02:54（Asia/Taipei）

主題：PyTorch ExpandableSegment POSIX-FD/pidfd IPC × CUDA VMM × Transport Lifetime/Invalidation

## 本小時新發現

本輪承接前一輪 CUDA allocator/VMM → transport eligibility，深入 PyTorch `CUDACachingAllocator.cpp` 的 ExpandableSegment `map/share/fromShared`，並交叉比對 OpenUCX #11548、NIXL #1754 與近期 PyTorch allocator failure reports。核心新結論：VMM allocation 的「pointer identity」不足以當作 transport lifetime identity；真正可共享的是 segment-level `CUmemGenericAllocationHandle`，POSIX-FD 是該 physical allocation handle 的跨程序能力載體，importer 再把 handle map 到自己的 VA。

## 本小時最重要 5 個發現

### 1. ExpandableSegment 的 IPC identity 位於 physical handle，不是 virtual pointer
已確認工程實作：PyTorch 對每個 segment 使用 `cuMemCreate` 建立 `CUmemGenericAllocationHandle`，再用 `cuMemMap`/`cuMemSetAccess` 映射到預留 VA。當 IPC 開啟，handle type 先依裝置能力固定為 FABRIC 或 POSIX_FD。這表示 VA 可保持穩定，但背後 physical handle 的 map/unmap lifecycle 可以變化。

底層：VA Reserve → cuMemCreate physical handle → cuMemMap → cuMemSetAccess → tensor pointer。

限制：不同 CUDA/driver/platform capability 會影響 handle type。

### 2. POSIX-FD share/import 是 capability transfer，而不是傳 GPU pointer
已確認工程實作：producer `cuMemExportToShareableHandle(... POSIX_FILE_DESCRIPTOR)` 得到 FD，wire header 同時傳 pid、segment_size、num_handles、handle_type；consumer 以 `pidfd_open(pid)` + `pidfd_getfd(fd)` 複製 FD，再 `cuMemImportFromShareableHandle` 還原 generic allocation handle，最後 `mapAndSetAccess` 到 consumer 自己的 VA。

底層：PhysicalHandle → Export FD → {pid,fd} → pidfd duplicate → Import PhysicalHandle → Reserve consumer VA → Map → Access。

為什麼重要：跨 process reuse 的 semantic identity 不應包含 producer raw pointer。

### 3. UCX 現行 cuda_ipc 與 PyTorch VMM handle protocol 存在能力落差
官方/工程衝突：PyTorch 已具 POSIX-FD + pidfd 的 VMM IPC 路徑；OpenUCX #11548 指出 cuda_ipc 對 VMM/mempool 主要接受 FABRIC handle，POSIX-FD-only allocation 會失去 cuda_ipc lane。NIXL #1754 在單機 H100/NVLink 測得 expandable_segments VMM buffer 從約 179–201 GB/s cuda_ipc fast path 降到約 0.29–0.32 GB/s TCP emulation；此數字只代表該實驗環境。

改變了什麼：TransportEligibility 必須依 `allocation handle type × backend import protocol` 判斷，不能只看 memory registration success。

### 4. Allocation/Registration Generation 必須成為 correctness primitive
合理工程模型：若同一 VA range unmap 舊 physical handle 後再 map 新 handle，`pointer == old_pointer` 不代表舊 memh/rkey/prepared descriptor 仍有效。因此建議：`AllocationGeneration` 每次 physical mapping identity 改變遞增；`RegistrationGeneration` 綁定 AllocationGeneration；PreparedTransfer 同時綁定 registration generation。

Invariant：PreparedTransfer.valid ⇔ allocation_generation == registered_generation == prepared_generation AND region still mapped/access-compatible。

此為本輪提出的 correctness target，不宣稱 PyTorch/NIXL 已使用同名 generation counter。

### 5. unmap synchronization 是 transport invalidation 的另一半
近期 PyTorch #196258 顯示 expandable segment release 若在錯誤 current device 上同步，可能在 queued GPU work 尚未完成時 unmap，造成 illegal memory access。這支持 Digital Twin 必須把 allocator unmap 看成 execution dependency，而不只是 free-memory event。

底層：Last GPU User → Stream/Device Synchronization → Transport Quiescence → Deregister/Invalidate Prepared State → cuMemUnmap → cuMemRelease。

## Architecture Breakdown

```text
Tensor / KV State
→ ExpandableSegment VA
→ Segment Slot
→ CUmemGenericAllocationHandle
→ Handle Type
   ├ POSIX_FD
   └ FABRIC
→ Export Capability
→ IPC Metadata {pid, fd/fabric handle, segment size, count}
→ Consumer Import
→ Consumer VA Reserve
→ cuMemMap
→ cuMemSetAccess
→ Transport Registration
→ UCX/NIXL lane selection
→ Prepared Transfer
→ NIC/NVLink movement
```

Lifecycle side-channel:

```text
GPU work
→ completion/order barrier
→ transport quiesce
→ prepared-transfer invalidation
→ registration invalidation
→ unmap
→ physical handle release
→ optional remap/new handle
→ new AllocationGeneration
```

## Bottom-Level Logic

Producer POSIX-FD path：
1. `cuMemCreate` with `CU_MEM_HANDLE_TYPE_POSIX_FILE_DESCRIPTOR`.
2. map physical segment into reserved VA.
3. `cuMemExportToShareableHandle(&fd, handle, POSIX_FD)`.
4. keep shareable FD associated with segment handle.
5. serialize pid, segment geometry, handle type, FD identifiers.

Consumer path：
1. parse header and validate handle type.
2. `pidfd_open(producer_pid)`.
3. `pidfd_getfd(pidfd, producer_fd)` to obtain local FD duplicate.
4. `cuMemImportFromShareableHandle` → generic allocation handle.
5. reserve its own expandable VA.
6. `cuMemMap` + `cuMemSetAccess`.
7. tensor accesses local VA although physical allocation originated in producer.

Transport mismatch path：
VMM POSIX_FD allocation → UCX cuda_ipc lacks POSIX-FD arm → cuda_ipc lane rejected → other UCX lane selected → potentially TCP/host fallback.

## Visual Simulation Idea

### VMM Handle Lifetime & Transport Invalidation Simulator

Two process address spaces side-by-side：

```text
Producer VA 0xA000              Consumer VA 0xF000
       │                               │
       └── map ── Physical Handle H17 ─┘
                    │
             export POSIX FD=42
                    │
              pidfd_getfd
                    │
             import Handle H17'
```

Controls：Map / Share / Import / Register UCX / Prepare Transfer / Queue GPU Kernel / Unmap / Remap。

When Remap is pressed：
`H17 → released`, same VA maps `H22`, AllocationGeneration 7→8；UI should immediately mark old `memh/rkey/prepared-transfer` RED/STale even though pointer text is unchanged.

## Code / GitHub

PyTorch core file：`c10/cuda/CUDACachingAllocator.cpp`
Worth reading：`ExpandableSegment::map`, `share`, `fromShared`, `mapAndSetAccess`, `unmapHandles`, handle-type detection, IPC caching path.

OpenUCX：issue #11548 and `src/uct/cuda/cuda_ipc/cuda_ipc_md.c` handle-type dispatch are the next source targets.

NIXL：issue #1754 demonstrates allocator provenance changing UCX selected protocol despite successful registration.

## Papers / technical reports

This round is dominated by primary source/runtime engineering rather than a new paper. The most important evidence is upstream implementation + reproducible transport issue reports. Next literature pass should connect this to disaggregated inference/KV transport papers and ask whether their cost models include allocator/registration generation and fast-path eligibility.

## Unknown / Open Questions

1. NIXL Prepared Transfer handles: exactly which backend-owned registration/mapping objects are retained, and what explicit invalidation hooks exist after deregistration/remap?
2. UCX POSIX-FD VMM support: whether #11548 has an implementation PR/merge path after the June 2026 proposal, and its security/permission behavior under pidfd restrictions.
3. Can allocator generation be inferred without modifying PyTorch allocator, or must Hermes/vLLM introduce an explicit allocation lease/token?

## 下一輪研究

Priority：`OpenUCX cuda_ipc_md.c × VMM POSIX-FD arm × pidfd security × NIXL prepXferDlist lifetime × deregistration semantics × allocation lease`。

Goal：derive an exact `TransportLease` state machine：ALLOCATED → MAPPED → REGISTERED → PREPARED → IN_FLIGHT → QUIESCED → INVALIDATED → UNMAPPED/RELEASED，and identify which upstream API transition proves each edge.

## Knowledge Graph 新增 Node / Edge

Nodes：`VMMPhysicalHandle`, `ExpandableSegmentSlot`, `ShareableHandleType`, `POSIXFDGPUCapability`, `PidfdImport`, `ConsumerVirtualMapping`, `AllocationGeneration`, `RegistrationGeneration`, `PreparedTransferGeneration`, `TransportLease`, `TransportQuiescence`, `RemapInvalidation`, `PointerIdentityHazard`, `BackendHandleTypeCompatibility`。

Edges：
- `ExpandableSegmentSlot → owns → VMMPhysicalHandle`
- `VMMPhysicalHandle → exported_as → POSIXFDGPUCapability`
- `PidfdImport → duplicates → POSIXFDGPUCapability`
- `POSIXFDGPUCapability → imports → VMMPhysicalHandle`
- `VMMPhysicalHandle → maps_into → ConsumerVirtualMapping`
- `Remap → increments → AllocationGeneration`
- `AllocationGeneration → constrains → RegistrationGeneration`
- `RegistrationGeneration → constrains → PreparedTransferGeneration`
- `TransportQuiescence → precedes → RemapInvalidation`
- `BackendHandleTypeCompatibility → determines → TransportFastPathEligibility`

## 與歷史研究比較 / 本輪收斂

前輪已證明 allocator provenance 會改變 CUDA IPC/UCX route；本輪沒有重複 bandwidth 結論，而是補上「share/import 到底如何工作」與「為什麼 pointer 不足以代表 transport validity」。因此 execution chain 從：

`CUDA VMM Allocation → Transport Eligibility`

深化成：

`VA → Physical Handle → Shareable Capability → Cross-process Import → Registration Generation → Prepared Transfer Generation → Quiesce → Invalidate → Remap`。

## 本輪結束判斷

缺哪一層：backend deregistration/prepared-transfer 的 exact lifetime state machine。

哪個節點最淺：`TransportLease`。

哪個概念仍只是名詞：`PreparedTransferGeneration`，目前是 correctness abstraction，尚未對應 upstream concrete field。

哪個系統最值得讀原始碼：OpenUCX `cuda_ipc` memory-domain/rkey pack-unpack + NIXL prepared-transfer implementation。

哪篇論文需追引用：下一輪應回接 disaggregated inference/KV-transfer papers，檢查是否忽略 allocator fast-path eligibility；本輪無單一論文優先於 upstream source。

哪個概念最適合視覺模擬：VMM Handle Lifetime & Transport Invalidation。

哪個 Agent 架構最值得實作：在 Hermes 研究代理中實作 `Execution Digital Twin / TransportLease Inspector`，讓 runtime state 與研究 Knowledge Graph 共用同一套 lifecycle node/edge schema。

最終鏈新增：`Model/KV → CUDA VA → VMM Physical Handle → POSIX-FD/Fabric Capability → Cross-process Import → Transport Registration → Prepared Transfer → GPU/NIC movement → synchronization → Attention`。