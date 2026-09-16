# 【AI Agent × Multimodal Research Report】

時間：2026-09-17 01:56 Asia/Taipei

主題：PyTorch CUDA Allocator × Expandable Segments/VMM × CUDA IPC Eligibility × NIXL Prepared Transfer Reuse

## 與歷史研究比較

上一輪已確認 UCX SGL、descriptor fragmentation、registration/metadata cache、DMA-BUF/PeerMem/Data Direct 與 GPU/NIC ordering。本輪不重複 RDMA/SGL，而是往 allocation origin 追：同樣是 GPU VRAM，為何 allocator 的建立方式會改變 CUDA IPC/UCX fast-path；registration success 為何不足以代表 transport eligibility；以及 NIXL prepared transfer 如何把 descriptor preparation 與 request lifecycle變成可重用 execution state。

## 本小時新發現

1. PyTorch `expandable_segments` 不是普通 caching policy，而是 CUDA VMM allocation topology：先 `cuMemAddressReserve` 大型 VA，再用 `cuMemCreate` 建 physical handles，最後 `cuMemMap/cuMemSetAccess` 將 pages映射進 virtual range。
2. Allocation provenance 會直接改變 transport path。NIXL issue #1754 的 H100 reproduction 中，default cudaMalloc buffer走 `cuda_ipc/cuda` 約 179–201 GB/s；expandable-segments VMM buffer registration雖成功，卻退到 TCP software-emulated RMA 約 0.29–0.32 GB/s。這是特定環境測量，不應泛化為所有硬體的固定倍率。
3. 根因是 legacy CUDA IPC export compatibility：PyTorch expandable segment physical allocation使用 `cuMemCreate` + POSIX-FD shareable handle；`cuIpcGetMemHandle` 對該 VMM memory path不可用，而該 UCX build 的 VMM sharing需要 fabric handles/IMEX，導致 cuda_ipc lane消失。
4. 因此 `registerMem success` 與 `fast-path eligible` 必須拆成兩個 Knowledge Graph節點。註冊成功只代表 backend接受該 memory region；真正 routing 還需 allocator provenance、shareable handle type、legacy IPC capability、UCX lanes、topology等條件。
5. NIXLBench 已有 prepared transfer execution mode：`prepXferDlist` 預先準備 local/remote descriptor handles，後續 `makeXferReq` 使用 prepared handles；相對 `createXferReq` 每次從 raw dlists 建 request。這提供把 stable KV layout 的 preparation cost攤銷到多次 transfer 的實作基礎。

## 本小時最重要 5 個發現

### 1. Expandable Segments = Virtual Address Reservation + Physical Page Mapping

已確認官方/原始碼：PyTorch expandable segments 將 allocation 拆成：

Request
→ reserve huge virtual address range
→ cuMemCreate physical chunk
→ cuMemMap physical handle into VA
→ cuMemSetAccess
→ allocator Block points into mapped range

其目的為降低動態 batch size造成的 segment fragmentation。PyTorch 2026 allocator devlog說明，一個 expandable segment通常對應 `(pool, stream)`，virtual range可以持續長大；physical page粒度可為 small/large pool不同尺寸。

重要性：`GPU pointer` 不再足以描述 physical allocation。Pointer是 VA；其背後 physical mapping可在 allocator lifecycle中 grow/unmap/remap。

限制：VMM mapping本身有成本，而且 expandable segments仍可能有 segment內 fragmentation。

來源：
- https://docs.pytorch.org/devlogs/eager/2026-06-01-cuda-caching-allocator/
- https://github.com/pytorch/pytorch/blob/main/c10/cuda/CUDACachingAllocator.cpp

### 2. Allocation Provenance 是 Transport Routing Input

工程實測（NIXL issue #1754）：

cudaMalloc allocation
→ UCX recognizes CUDA IPC-compatible region
→ zero-copy cuda_ipc/cuda
→ same-node H100/NVLink READ 179–201 GB/s

PyTorch expandable_segments VMM allocation
→ registerMem succeeds
→ legacy cuda_ipc export unavailable
→ UCX software-emulated RMA over TCP
→ 0.29–0.32 GB/s

workaround是在 transfer staging buffer allocation期間暫時關閉 expandable segments；該案例恢復到約 150 GB/s end-to-end。

這證明：

Same device = GPU
Same dtype/size
Same pointer class = CUDA address
≠ Same transport capability

### 3. Registration Success ≠ Fast-Path Eligibility

需要新增兩層：

MemoryRegistrationState
→ backend accepted memory

TransportEligibility
→ legacy CUDA IPC capable?
→ POSIX-FD/Fabric handle available?
→ UCX cuda_ipc lane enabled?
→ NIC RDMA lane available?
→ topology compatible?

只有第二層才能決定：

CUDA IPC / NVLink
vs RDMA
vs host/TCP fallback

NIXL #1754提出用 `CU_POINTER_ATTRIBUTE_IS_LEGACY_CUDA_IPC_CAPABLE` 在 UCX memReg階段偵測並警告，正好顯示 capability需要顯式可觀測。

### 4. VMM Shareable Handle Type 是 Physical Execution Contract

PyTorch CUDACachingAllocator source明確將 expandable segment與普通 cudaMalloc allocation分開建模，且 expandable segment IPC可走其 own share/import protocol。NIXL issue指出 PyTorch VMM physical blocks請求 POSIX-FD shareable handle，而 legacy `cuIpcGetMemHandle` path不適用。

因此 allocator→transport chain應為：

Allocator Backend
→ Allocation Mechanism
→ Shareable Handle Type
→ IPC Export Capability
→ UCX Memory Domain Capability
→ Selected Lane

而不是：

GPU Tensor → UCX

這是本輪 bottom-level mechanism的核心。

### 5. Prepared Transfer 是 Descriptor Execution State Cache

NIXLBench current source提供：

Raw local/remote IOV
→ prepXferDlist(local)
→ prepXferDlist(remote)
→ prepared dlist handles
→ makeXferReq(op, handles, indices)
→ postXferReq

未啟用 prepared mode則：

Raw IOV
→ createXferReq(op, raw dlists, target)
→ postXferReq

合理工程模型：對固定 KV region/layout、重複 peer、固定 descriptor topology，可把 descriptor/backend preparation從每次 request移出 hot path。但 prepared state必須與 memory-registration/allocation generation綁定，否則 allocator unmap/remap/free後可能成為 stale execution state。

這個「prepared state invalidation」是下一輪需要直接追原始碼驗證的缺口。

## Architecture Breakdown

### System Architecture：Allocator-Aware KV Transport Planner

Model Runtime
→ KV Allocation Request
→ PyTorch CUDA Allocator
├ native cudaMalloc segment
├ expandable VMM segment
├ cudaMallocAsync backend
└ custom MemPool / allocator
→ Allocation Provenance Inspector
→ Memory Registration
→ IPC/RDMA Capability Probe
→ Transport Route Selection
├ CUDA IPC / NVLink
├ GPUDirect RDMA
├ CUDA copy
└ Host/TCP fallback
→ Descriptor Builder
→ Prepared Transfer Cache
→ postXferReq
→ Completion
→ CUDA Consumer Fence
→ Attention

Planner不應只問「memory registered嗎？」；必須問「這個 allocation generation在這個 peer/topology/backend下能走哪個 lane？」

## Bottom-Level Logic

### Mechanism A：Expandable Segment

1. allocator為 stream/pool建立 expandable segment。
2. `cuMemAddressReserve` 保留大型 contiguous VA。
3. request需要更多 backing memory時，以 `cuMemCreate` 建 physical allocation handle。
4. `cuMemMap` 將 physical pages映射到 segment VA。
5. `cuMemSetAccess` 設定 device access。
6. allocator在該 VA內切分/合併 Block。
7. 空 physical pages可在 OOM/reclaim時 unmap並釋放。
8. 因 pointer是 VA，transport不能僅依 pointer判斷 export semantics；必須知道 backing allocation/handle capability。

### Mechanism B：Allocator → UCX Routing Failure

Expandable Tensor
→ VMM backing (`cuMemCreate`)
→ POSIX-FD-oriented shareable handle
→ NIXL/UCX register succeeds
→ legacy CUDA IPC capability probe fails
→ cuda_ipc lane unavailable
→ alternative lane selection
→ software/TCP fallback（#1754環境）

### Mechanism C：Prepared Transfer Reuse

Stable IOV topology
→ prep local dlist once
→ prep remote dlist once
→ retain prepared handles
→ make request from handles + index map
→ post
→ complete
→ repeat

Correctness requirement（合理推論，待下一輪驗證）：

PreparedTransferValid =
AllocationGenerationSame
∧ RegistrationGenerationSame
∧ RemoteMetadataGenerationSame
∧ DescriptorTopologySame
∧ BackendCompatible

## Visual Simulation Idea

### CUDA Allocation → Transport Lane Simulator

互動控制：
- allocator backend: native / cudaMallocAsync
- expandable_segments ON/OFF
- allocation size
- pool/stream
- same-node / cross-node
- CUDA IPC capability
- POSIX FD / Fabric handle
- UCX cuda_ipc lane
- RDMA NIC lane
- prepared transfer ON/OFF

左側畫 allocator：

Virtual Address
┌─────────────────────────────────────┐
│ mapped │ mapped │ unmapped │ mapped │
└─────────────────────────────────────┘
      ↓ physical handles

中間顯示 capability gate：

REGISTERED ✓
LEGACY CUDA IPC ✗
RDMA ?

右側即時顯示 route：

Fast: GPU → cuda_ipc/NVLink → GPU
Fallback: GPU → UCX software/TCP → GPU

並加入「allocator設定只改一個 flag，但 transport route改變」重播模式，視覺化 #1754 的 179–201 GB/s vs 0.29–0.32 GB/s特定實測。

## Code / GitHub

### pytorch/pytorch
值得看的核心檔案：
- `c10/cuda/CUDACachingAllocator.cpp`：Block/Segment、ExpandableSegment、VMM mapping、shareable handle/IPС lifecycle
- allocator docs / CUDA semantics：`expandable_segments`、native vs cudaMallocAsync、MemPool

Repository: https://github.com/pytorch/pytorch

### ai-dynamo/nixl
值得看的核心區域：
- UCX memory registration / capability warning path
- `docs/BackendGuide.md`：prepXfer/postXfer lifecycle
- `benchmark/nixlbench/src/worker/nixl/nixl_worker.cpp`：prepared_xfer、reregister_mem、slot lifecycle
- issue #1754：expandable_segments VMM → cuda_ipc slow fallback reproduction

Repository: https://github.com/ai-dynamo/nixl

### openucx/ucx
值得追：
- issue #11548：VMM/mempool POSIX-FD-only handle types與 cuda_ipc lane gap；提出 pidfd/POSIX-FD arm方向。

Repository: https://github.com/openucx/ucx

## Papers / Technical Reports

本輪主要是 runtime/source-level機制，沒有用弱相關論文填充。重要技術來源：

1. PyTorch CUDA Caching Allocator DevLog — 2026 — PyTorch — 說明 fragmentation與 expandable-segment VMM機制。
2. NIXL #1754 — 2026 — ai-dynamo/NIXL — production reproduction，揭露 allocator provenance → UCX routing的巨大效能差異。
3. UCX #11548 — 2026 — OpenUCX — 將問題定位到 VMM/mempool POSIX-FD-only shareable handles與 legacy cuda_ipc gap，提出 POSIX-FD/pidfd方向。

## 已確認事實 / 推論 / 未驗證

已確認事實：
- PyTorch expandable segments使用 CUDA VMM式 VA reserve + physical mapping。
- NIXL #1754 的指定環境中 registration成功但 cuda_ipc lane失效並退到 TCP，且有具體 throughput數據。
- NIXLBench current source存在 prepared_xfer與 reregister_mem兩個可獨立控制的 benchmark維度。

工程推論：
- Allocation provenance應成為 Hermes Transport Planner的一級輸入。
- Prepared transfer cache應綁定 allocation/registration generation，而不是只綁 descriptor value。

尚未驗證假說：
- NIXL production UCX prepared handle是否已完整偵測 VMM unmap/remap後的 stale registration；下一輪需追 backend request/metadata ownership與 invalidation code。

## Unknown / Open Questions

1. `ExpandableSegment::share/fromShared` 的 POSIX-FD IPC protocol如何表示 VA offset、physical handle與 peer import，能否直接映射成 UCX新的 POSIX-FD lane？
2. NIXL prepared dlist/backend request究竟持有 memh/rkey的 reference、copy或 lookup key？deregister/unmap後如何 invalidation？
3. cudaMallocAsync mempool memory在不同 CUDA/UCX/Fabric配置下，transport capability matrix與 expandable segments是否相同？

## 下一輪研究

主題：`ExpandableSegment::share/fromShared × POSIX-FD/pidfd IPC × UCX VMM Lane × Prepared Transfer Invalidation × Allocation Generation`

優先追：
1. PyTorch `ExpandableSegment::share` / `fromShared` exact serialization/import path。
2. OpenUCX #11548後續實作/PR，是否已有 POSIX-FD VMM arm。
3. NIXL UCX registration metadata ownership與 prepared request lifetime。
4. allocator free/unmap/remap時，Hermes Digital Twin需要什麼 generation counter / invalidation edge。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `CUDAAllocatorBackend`
- `AllocationProvenance`
- `ExpandableSegment`
- `CUDAReservedVirtualRange`
- `CUDAPhysicalAllocationHandle`
- `VMMMappedPage`
- `AllocationGeneration`
- `ShareableHandleType`
- `LegacyCudaIPCCapability`
- `TransportEligibility`
- `TransportLaneSelection`
- `SilentTransportFallback`
- `PreparedTransferDlist`
- `PreparedTransferState`
- `PreparedTransferInvalidation`
- `RegistrationGeneration`

新增 Edges：
- `CUDAAllocatorBackend → creates → AllocationProvenance`
- `ExpandableSegment → reserves → CUDAReservedVirtualRange`
- `CUDAPhysicalAllocationHandle → maps_into → CUDAReservedVirtualRange`
- `AllocationProvenance → constrains → ShareableHandleType`
- `ShareableHandleType → constrains → LegacyCudaIPCCapability`
- `LegacyCudaIPCCapability → influences → TransportLaneSelection`
- `TransportLaneSelection → determines → PhysicalTransferPath`
- `StableDescriptorTopology → can_prepare → PreparedTransferState`
- `AllocationGeneration → should_guard → PreparedTransferState`
- `RegistrationGeneration → should_guard → PreparedTransferState`

## 本輪結束回答

缺哪一層：allocator physical handle export/import → UCX lane establishment → prepared-state invalidation。

哪個節點最淺：`PreparedTransferInvalidation`。

哪個概念仍只是名詞：跨 allocator/backend統一的 `AllocationGeneration`，尚未找到現成 runtime canonical ID。

哪個系統值得讀原始碼：PyTorch `CUDACachingAllocator.cpp` 的 `ExpandableSegment::share/fromShared`，其次 NIXL UCX registration/prepared-request lifetime。

哪篇論文/技術來源需追引用：PyTorch 2026 CUDA allocator DevLog與 OpenUCX #11548後續 patch/討論。

哪個概念最適合視覺模擬：`CUDA Allocation → Transport Lane Simulator`，因為同一 GPU tensor僅 allocator provenance不同即可導致完全不同 physical route。

哪個 Agent 架構最值得實作：本輪不是高階 Agent loop；最值得實作的是 Hermes `PhysicalExecutionPlanner` 的 `AllocatorAwareTransportPlanner` 子模組。

## 最終鏈條增量

本輪讓 Hermes 的「AI 到底怎麼運作」新增：

Prompt / Image
→ Agent / Model
→ KV / Encoder State
→ GPU Allocation Request
→ CUDA Allocator
→ Virtual Address + Physical Handle
→ Shareability Capability
→ Memory Registration
→ Transport Eligibility
→ CUDA IPC / RDMA / Fallback
→ Prepared Descriptor State
→ Transfer
→ GPU Consumer Kernel
→ Output

核心結論：GPU memory不是同質資源。AI Runtime要回答『這塊 KV 能不能高速搬到另一張 GPU』，必須一路知道它由哪個 allocator建立、使用哪種 VMM/physical handle、能否被目標 IPC/RDMA mechanism export，以及先前準備好的 transport state是否仍對當前 allocation generation有效。