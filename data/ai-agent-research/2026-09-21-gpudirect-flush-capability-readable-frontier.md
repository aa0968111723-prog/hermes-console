# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 08:55（Asia/Taipei）

## 本小時新發現

本輪延續前幾輪 `CQ completion → GPUDirect visibility → CUDA consumer ordering → Attention` 的缺口，但不再只停留在「需要 visibility」。本輪把 NVIDIA CUDA 13.4 已公開的 **兩種 GPUDirect RDMA visibility primitive** 納入可執行的 capability model：

1. Host-side `cuFlushGPUDirectRDMAWrites(target, scope)`：等待 remote writes 對指定 CUDA scope 可見。
2. Stream-memory-op path：裝置若宣告 `CU_FLUSH_GPU_DIRECT_RDMA_WRITES_OPTION_MEMOPS`，可使用 `CU_STREAM_WAIT_VALUE_FLUSH` / `CU_STREAM_MEM_OP_FLUSH_REMOTE_WRITES` 把 remote-write visibility 放入 stream ordering。

因此 `BackendVisibilityContract` 不應只有「是否 flush」布林值，而必須由 GPU capability、visibility scope、transport ordering domain、consumer stream 與 lease/translation generation共同決定。

本輪同時重新讀 Mooncake TENT 原始碼。`RdmaTask` 並不是單一 CQE 完成就變 COMPLETED：每個 `RdmaSlice` 各自 resolve；成功 slice 增加 `transferred_bytes` / `success_slices`，所有 `resolved_slices >= num_slices` 後，只有全部 slice 成功才 CAS task status 到 COMPLETED。`RdmaSlice` 還維護 `completions_owed`，註解明確指出 timeout/teardown 即使已 resolve slice，live work request 仍可能稍後從 CQ 回傳，所以 terminal task status 與「CQ 再也不會觸及此 slice」也是不同生命週期。

Mooncake current tree也確認 PCIe relaxed ordering 是 runtime capability：MR 可帶 `IBV_ACCESS_RELAXED_ORDERING`；官方 Transfer Engine 文件提供 `MC_IB_PCI_RELAXED_ORDERING` 控制。這使 `RdmaOrderingMode` 必須成為 visibility contract 的輸入，而非背景 metadata。

NIXL current Python API與 examples仍把 `check_xfer_state(handle) == DONE` 當 transfer lifecycle terminal state；本輪跨 NIXL/Mooncake code search仍未找到 `cuFlushGPUDirectRDMAWrites` 的直接使用。因此目前只能確認 transport completion，不可把「沒搜到 flush」推論成 backend 一定沒有其他 visibility mechanism。

## 本小時最重要 5 個發現

### 1. GPUDirect visibility 有 capability-driven fast path，而不是固定 flush
**已確認官方資訊。** CUDA 13.4 指出 `cuFlushGPUDirectRDMAWrites()` 會等待 remote writes 對 scope 可見；如果 requested scope 已被 `CU_DEVICE_ATTRIBUTE_GPU_DIRECT_RDMA_WRITES_ORDERING` 覆蓋，呼叫可安全省略。Hermes 因此應先 query capability，再決定 visibility action，而不是每次強制 host flush。

底層：`RDMA completion → query GPU ordering capability → compare required visibility scope → no-op OR flush → CUDA consumer work`。

限制：多 hardware RDMA path 可形成獨立 ordering domains；CUDA 文件明確要求此情況由使用者在 CUDA 外額外排序。

### 2. Stream MemOp 可以把 visibility gate 拉進 consumer stream
**已確認官方資訊。** CUDA type/API 文件列出 `CU_FLUSH_GPU_DIRECT_RDMA_WRITES_OPTION_MEMOPS`，對應 `CU_STREAM_WAIT_VALUE_FLUSH` 與 `CU_STREAM_MEM_OP_FLUSH_REMOTE_WRITES`。這比 host poll → host flush → launch 更適合 Hermes 要追蹤的 device happens-before，因為 visibility primitive可直接成為 consumer stream timeline的一部分。

推論：若 backend 能把 RDMA completion signal 映射到 stream-visible memory/semaphore，Hermes可形成更強的 `RemoteCompletionCoordinate → StreamWait+Flush → AttentionLaunch` witness；但 backend 是否真的這樣接仍需逐實作驗證。

### 3. Mooncake COMPLETED 是 slice aggregation，不是單一 CQE
**已確認工程實作。** TENT `updateSliceStatus()` 只有在每個 slice resolve 後才結算 task；全部 slice成功才得到 COMPLETED。這使 `TaskTransportCompletionWitness` 應保留 `slice_count / resolved_count / success_count / transferred_bytes`，否則會失去 terminal status背後的 coverage證據。

### 4. Mooncake terminal status 與 CQ object lifetime 是兩條狀態機
**已確認工程實作。** `RdmaSlice::completions_owed` 的原始碼註解說明：timeout/teardown可能先 resolve slice，但已 posted WR仍可稍後由 CQ交回該地址。因此 `TaskStatus=COMPLETED/FAILED/CANCELED` 不能取代 `OutstandingCQCompletionCount=0`。

對 Hermes 的意義：要新增 `TransportObjectQuiescenceWitness`，避免在仍有 live CQ completion path 時回收/重用 provenance object。

### 5. Relaxed Ordering 必須進入 readable frontier
**官方文件 + 工程實作交叉支持。** Mooncake會在支援時為 MR加入 `IBV_ACCESS_RELAXED_ORDERING`，而 NVIDIA GPUDirect文件又明確描述 relaxed GPU memory model與 remote writes visibility boundary。因此 `Task COMPLETED` 在 STRICT 與 RELAXED mode下都不能自動提升成 `AttentionReadable`；visibility action必須由 backend/GPU capability決定。

## Architecture Breakdown

### System architecture：Distributed KV Readable Frontier

```text
Semantic KV Content
  → Residency / Local Allocation
  → KVLeaseEpoch
  → RDMA Slice Plan
  → WR Post(s)
  → CQE per slice
  → SliceCompletionWitness[]
  → TaskTransportCompletionWitness
  → TransportObjectQuiescenceWitness
  → OrderingDomainResolution
  → GPUDirectVisibilityCapability
  → VisibilityAction
      ├ HARDWARE_ORDERED_NO_FLUSH
      ├ HOST_FLUSH
      ├ STREAM_MEMOP_FLUSH
      ├ EXTERNAL_MULTI_DOMAIN_BARRIER
      └ FAIL_CLOSED_UNVERIFIED
  → ConsumerStreamOrderingWitness
  → TranslationEpoch
  → AttentionLaunchWitness
  → ExpectedPhysicalKVReadSet
```

### Bottom-level mechanism：VisibilityAction selection

```text
required_scope
+ GPU_DIRECT_RDMA_WRITES_ORDERING
+ FLUSH_GPU_DIRECT_RDMA_OPTIONS
+ number/order of RDMA hardware paths
+ destination CUDA context/device
+ consumer stream
+ backend completion primitive
→ RequiredVisibilityAction
```

重要否定：

`CQE ≠ SliceComplete ≠ TaskComplete ≠ CQQuiescent ≠ GPUVisible ≠ ConsumerOrdered ≠ AttentionRead`

這些必須是不同 node / witness。

## Visual Simulation Idea

### GPUDirect Readable Frontier Simulator

畫面分五條同步時間軸：NIC/QP、CQ、Host Transport State、GPU Visibility、CUDA Compute Stream。

```text
QP0 WR0 ───── CQE0 ✓ ─ Slice0 ✓
QP1 WR1 ───────── CQE1 ✓ ─ Slice1 ✓
                          ↓
                    Task COMPLETED
                          ↓
Ordering mode: RELAXED
                          ↓
GPU ordering capability: OWNER scope only
Required scope: OWNER
                          ↓
STREAM_MEMOP_FLUSH ✓
                          ↓
Compute S7: wait/flush ─ Attention L18
```

互動控制：STRICT/RELAXED、Host Flush/Stream Flush/No Flush、single/multi ordering domain、提前 lease reuse、漏一個 slice CQE、task terminal但 `completions_owed > 0`。Console輸出 `TASK_COMPLETE_VISIBILITY_PENDING`、`CQ_NOT_QUIESCENT`、`MULTI_DOMAIN_BARRIER_MISSING`、`VISIBILITY_SCOPE_TOO_WEAK`、`LEASE_CHANGED_BEFORE_ATTENTION`。

## Code / GitHub

### Mooncake
值得繼續讀：
- `mooncake-transfer-engine/tent/include/tent/transport/rdma/slice.h`：task/slice aggregation、`completions_owed`、terminal CAS。
- `mooncake-transfer-engine/tent/src/transport/rdma/cq.cpp`：`ibv_poll_cq()`。
- `mooncake-transfer-engine/tent/src/transport/rdma/workers.cpp`：completion handler、retry/timeout/retire。
- `mooncake-transfer-engine/tent/src/transport/rdma/buffers.cpp`：MR access flags與 relaxed ordering。
- `mooncake-transfer-engine/src/transport/rdma_transport/rdma_transport.cpp`：legacy/current transport capability detection。

### NIXL
值得繼續讀：
- `src/api/python/_api.py`：`check_xfer_state()` public lifecycle。
- UCX / LIBFABRIC / GPUNETIO plugins：下一輪應追 `DONE` 的 backend-specific transition。

本輪 repository search 未找到 NIXL/Mooncake直接呼叫 `cuFlushGPUDirectRDMAWrites`；此為「未找到直接證據」，不是「證明不存在」。

## Papers / Technical Sources

本輪核心不是新增泛用論文，而是把 correctness gap收斂到 CUDA官方 memory-ordering contract。重要技術來源：NVIDIA CUDA Driver API 13.4 `cuFlushGPUDirectRDMAWrites`、GPUDirect RDMA Synchronization and Memory Ordering、CUDA flush options；Mooncake current source；NIXL current source。

值得後續追蹤的研究問題：是否有近期 KV-disaggregation系統正式量化 host flush、stream memop flush與硬體 ordering fast path 對 TTFT/throughput的成本差異。

## Unknown / Open Questions

1. Mooncake/NIXL 的 GPUDirect destination在實際 CUDA consumer path上，哪一層建立 post-CQE CUDA-visible ordering？若依賴「CQE回到 CPU後再提交 CUDA work」這個官方 ordering boundary，需找到確切 launch/control path。
2. `CU_STREAM_MEM_OP_FLUSH_REMOTE_WRITES` 在 CUDA Graph capture/replay與多 ordering-domain環境中的可用性、capture semantics與版本限制為何？
3. NIXL各 plugin的 `DONE` 是否具有不同 completion strength（UCX vs LIBFABRIC vs GPUNETIO），需要建立 per-plugin `BackendVisibilityContract`，不能只在 NIXL API層統一處理。

## 下一輪研究

```text
Mooncake Workers::handleCompletion
→ exact CQE→slice transition
→ completion_owed→0 quiescence
→ task terminal
→ caller observes COMPLETED
→ next CUDA API / kernel submission

NIXL
→ plugin-specific progress()
→ UCX/LIBFABRIC/GPUNETIO completion
→ DONE transition
→ GPU visibility bridge

CUDA
→ STREAM_WAIT_VALUE_FLUSH / MEM_OP_FLUSH_REMOTE_WRITES
→ CUDA Graph compatibility
→ multi-ordering-domain semantics

最後 join：
RequiredTransferFrontier
∧ RequiredVisibilityFrontier
∧ RequiredConsumerOrderingFrontier
∧ LeaseEpoch
∧ TranslationEpoch
→ RequiredReadableFrontier
→ Attention Visibility Policy
→ VisibleLogicalPositionSet
→ ExpectedPhysicalKVReadSet
→ causal ZERO/REPLACE experiment
```

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `GPUDirectFlushCapability`
- `HostFlushVisibilityWitness`
- `StreamMemOpFlushVisibilityWitness`
- `RequiredVisibilityAction`
- `TransportObjectQuiescenceWitness`
- `OutstandingCQCompletionCount`
- `SliceCompletionCoverageWitness`
- `MultiOrderingDomainBarrierWitness`
- `HardwareOrderedNoFlushWitness`
- `TaskCompleteVisibilityPendingState`

新增 Edges：
- `GPUOrderingCapability --selects→ RequiredVisibilityAction`
- `SliceCompletionWitness[] --aggregates→ TaskTransportCompletionWitness`
- `OutstandingCQCompletionCount==0 --supports→ TransportObjectQuiescenceWitness`
- `TaskTransportCompletionWitness --does_not_prove→ TransportObjectQuiescenceWitness`
- `TaskTransportCompletionWitness --does_not_prove→ GPUDirectVisibilityWitness`
- `GPUDirectFlushCapability + OrderingScope --selects→ HostFlush|StreamMemOpFlush|NoFlush`
- `MultiOrderingDomain --requires→ ExternalBarrierOrFailClosed`
- `RequiredVisibilityActionSatisfied --supports→ RequiredVisibilityFrontier`

## 本輪結束判斷

- **缺哪一層：** backend CQ/task terminal之後，實際 consumer CUDA API/stream submission 的 bridge。
- **最淺節點：** `BackendVisibilityContract` 的 per-plugin production instance。
- **仍只是名詞：** `ObservedPhysicalKVReadSet`；目前建立的是合法可讀條件，不是逐 load trace。
- **最值得讀原始碼：** Mooncake `workers.cpp` completion handler；NIXL UCX/LIBFABRIC/GPUNETIO plugin progress path。
- **最值得追引用/技術脈絡：** GPUDirect RDMA synchronization/memory ordering與 CUDA stream memop flush semantics。
- **最適合視覺模擬：** GPUDirect Readable Frontier Simulator。
- **最值得實作的 Agent 架構：** `State-grounded Planner + Runtime Provenance Verifier + Transport Quiescence Verifier + Backend Visibility Contract Adapter + Device Ordering Verifier + Residency/Lease Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。

## 與歷史研究相比的實質新增

前幾輪已建立 `transport complete ≠ GPU visible`、CQ/slice/task hierarchy與 relaxed-ordering風險。本輪新增的不是重述，而是把 **visibility gap轉成可執行 capability decision**：硬體 ordering足夠時允許 no-flush；不足時區分 host flush與 stream-memop flush；多 ordering domain則 fail closed或要求外部 barrier。同時補上 Mooncake `completions_owed` 所揭示的第二條 lifecycle：**task terminal不代表 transport object已 quiescent**。這兩點讓 `RequiredReadableFrontier` 從概念模型更接近可落地 verifier。