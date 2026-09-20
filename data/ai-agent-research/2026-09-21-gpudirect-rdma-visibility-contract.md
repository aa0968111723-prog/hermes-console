# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-21 06:56（Asia/Taipei）  
**本輪主題**：GPUDirect RDMA Visibility Contract × Transport Completion × Consumer CUDA Ordering  
**研究鏈位置**：Semantic KV → Residency → Lease → Transfer Frontier → **RDMA visibility** → CUDA consumer ordering → Attention launch → RuntimeKVReadWitness

## 與歷史研究比較

前一輪已把 distributed KV readiness 從 boolean 提升為 per-producer/per-stream/per-sequence 的 `RequiredTransferFrontier`，並區分 `TransportTerminalStatusWitness`、`ConsumerOrderingWitness`。本輪不重複 timeline semaphore，而是補上一個更底層、先前仍未閉合的問題：**NIXL/Mooncake 回報 transfer DONE/COMPLETED 後，遠端 GPUDirect RDMA 寫入何時對 GPU kernel 真正可見？**

本輪得到的核心修正是：**RDMA completion 與 GPU visibility 不是同一個證據。** NVIDIA GPUDirect RDMA 官方文件明確指出，第三方裝置完成 PCIe/RDMA writes 後，並不代表 concurrently running GPU kernel 一定立刻看到一致資料；GPU 可能看到 stale、partial 或 out-of-order data。CUDA synchronization/work-submission API 才建立 GPU 端所需的 memory-ordering boundary。CUDA Driver API 另外提供 `cuFlushGPUDirectRDMAWrites()`，可阻塞直到 remote writes 對指定 scope 可見。

---

## 本小時新發現

### 1. 新 bottom-level mechanism：GPUDirect RDMA visibility boundary

官方 CUDA 13.4 Driver API：

`cuFlushGPUDirectRDMAWrites(target, scope)`

語義不是「等待網路傳輸 API」，而是等待透過 GPUDirect RDMA mapping 進入 target context 的 remote writes 對指定 CUDA scope **visible**。如果硬體已提供足夠 ordering，呼叫可能是 no-op；是否可省略應依 device attributes 判斷，而不能寫死。

來源：
- https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/group__CUDA__DEVICE.html
- https://docs.nvidia.com/cuda/gpudirect-rdma/

### 2. NIXL `DONE` 是 transfer lifecycle terminal state，不應自動升格為 CUDA visibility proof

NIXL Python API與官方 examples都以 `check_xfer_state(handle)` 輪詢，`DONE` 為完成、`PROC` 為進行中、`ERR` 為錯誤。這足以建立 `TransportTerminalStatusWitness`，但目前從此 public contract本身看不到「DONE 必然等價於遠端 CUDA consumer context visibility + stream ordering」的正式證據。

值得看的 NIXL 原始碼：
- `src/api/python/_api.py`
- `examples/python/basic_two_peers.py`
- `examples/python/remote_storage_example/nixl_storage_utils/common.py`
- 下一輪需下鑽 backend progress/completion path（UCX/UCX-RMA/RDMA plugin）

Repo：https://github.com/ai-dynamo/nixl

### 3. Mooncake TransferEngine 的 `COMPLETED` 同樣是 transport contract；不同 backend 的 memory-ordering substrate可能不同

Mooncake Transfer Engine可在 DRAM/VRAM間使用 TCP、GPUDirect RDMA、NVMe-oF、NVLink、EFA等 transport。BatchTransfer可用 `getTransferStatus` 監控完成；TENT runtime contract把狀態抽象成 `PENDING / COMPLETED / FAILED`，runtime本身不檢查 byte 如何移動。這意味著 `COMPLETED` 是 transport abstraction，而 GPU visibility是否成立仍依實際 backend + CUDA ordering contract。

Mooncake docs：
- https://kvcache-ai.github.io/Mooncake/design/transfer-engine/index.html
- https://kvcache-ai.github.io/Mooncake/design/tent/testing.html

### 4. 新證據分層：Completion、Visibility、Ordering 必須三分

此前：

`Transfer DONE → Consumer Ordering → Attention`

本輪修正：

`RDMA Work Completion`
`→ TransportTerminalStatusWitness`
`→ RemoteWriteArrivalWitness`
`→ GPUDirectVisibilityWitness`
`→ ConsumerCudaOrderingWitness`
`→ PostBarrierAttentionLaunchWitness`
`→ RuntimeKVReadWitness`

其中 `RemoteWriteArrivalWitness` 與 `GPUDirectVisibilityWitness` 不可合併。

### 5. `cuFlushGPUDirectRDMAWrites` 不是 universal always-required barrier

CUDA Driver API允許查詢 GPU Direct RDMA write ordering/flush capability。若硬體 ordering scope已涵蓋所需 scope，flush可安全省略；某些平台還可能有多條 hardware RDMA path，屬不同 ordering domain，此時 CUDA flush本身也不一定替應用程式解決跨 path ordering。

因此 Hermes應建立 capability-driven verifier，而不是無條件插入 flush：

`DeviceCapability → RequiredVisibilityAction`

可能輸出：
- `HARDWARE_ORDERED_NO_FLUSH`
- `HOST_FLUSH_REQUIRED`
- `STREAM_MEMOP_FLUSH_REQUIRED`
- `MULTI_ORDERING_DOMAIN_EXTERNAL_BARRIER_REQUIRED`
- `UNVERIFIED_FAIL_CLOSED`

---

## 本小時最重要 5 個發現

### 發現 1 — Transport completion ≠ GPU visibility

**是什麼**：NIC/RDMA engine已完成寫入，不等於 GPU execution context已取得一致可見性。  
**底層如何運作**：第三方 device透過 BAR/GPUDirect path寫 VRAM，這條 data path不等同 CUDA scheduler內部的普通 stream dependency。  
**為什麼重要**：若 Hermes把 NIXL `DONE` 或 Mooncake `COMPLETED`直接標成 KV readable，可能把 stale/partial KV誤當正確 context。  
**限制**：具體 backend可能內部已做必要 flush/order，但必須逐 backend驗證。  
**來源**：NVIDIA GPUDirect RDMA官方文件 + NIXL/Mooncake public completion contracts。

### 發現 2 — CUDA提供 explicit GPUDirect visibility primitive

**是什麼**：`cuFlushGPUDirectRDMAWrites()`。  
**底層如何運作**：等待 remote GPUDirect writes對指定 CUDA target/scope可見。  
**為什麼重要**：它提供 `TransportTerminalStatus → GPU visibility` 之間可驗證的官方 bridge。  
**限制**：是否需要、scope多大、是否為 no-op依 hardware capability；多 ordering domain仍需額外機制。  
**來源**：CUDA Driver API 13.4。

### 發現 3 — NIXL DONE只應先建模為 terminal status

**是什麼**：NIXL `check_xfer_state()` 將 transfer狀態抽象為 `DONE/PROC/ERR`。  
**底層如何運作**：application輪詢 handle直到 backend progress回報 terminal state。  
**為什麼重要**：Hermes應保留 evidence granularity，不把 library-level status誤當 device memory model guarantee。  
**限制**：下一輪需追 NIXL RDMA backend真正的 completion queue與CUDA/GDR visibility處理。  
**來源**：NIXL `_api.py`與 examples。

### 發現 4 — Mooncake COMPLETED也需要 backend-specific interpretation

**是什麼**：Mooncake TENT runtime只消費 Transport contract，不直接檢查 DMA細節。  
**底層如何運作**：TransferEngine將不同 transport統一成 BatchTransfer + status lifecycle。  
**為什麼重要**：TCP copy、RDMA write、NVLink peer copy、NVMe-oF direct path的 visibility semantics不能用同一個 generic completion label代替。  
**限制**：需逐 `RdmaTransport/NvlinkTransport/...` 建立 `BackendVisibilityContract`。  
**來源**：Mooncake Transfer Engine/TENT docs。

### 發現 5 — GlobalKVTransferEpoch 必須加入 Visibility Coordinate

前一輪 frontier只有 transfer coordinate。本輪擴展：

`TransferCoordinate = producer/process/device/stream-or-QP/sequence`

`VisibilityCoordinate = destination CUDA context + ordering domain + visibility scope + visibility generation`

所以 request真正需要：

`RequiredReadableFrontier = RequiredTransferFrontier ∧ RequiredVisibilityFrontier ∧ RequiredConsumerOrderingFrontier`

---

## Architecture Breakdown

### System Architecture：Distributed KV over NIXL/Mooncake → CUDA Attention

```text
Remote semantic KV
  ↓
KV connector / scheduler
  ↓
Destination Block Allocation
  ↓
Block@KVLeaseEpoch
  ↓
NIXL / Mooncake Transfer Submission
  ↓
RDMA / TCP / NVLink / Storage Transport
  ↓
Transport Completion
  ↓
TransportTerminalStatusWitness
  ↓
[GPUDirect path?]
  ├─ no → backend-specific memory ordering
  └─ yes
       ↓
     GDR Ordering Capability Query
       ↓
     Visibility Action
       ├─ hardware ordered
       ├─ cuFlushGPUDirectRDMAWrites
       ├─ stream mem-op flush
       └─ external barrier
       ↓
     GPUDirectVisibilityWitness
       ↓
Consumer CUDA stream dependency / submission
  ↓
ConsumerCudaOrderingWitness
  ↓
TranslationEpoch valid?
  ↓
KVLeaseEpoch unchanged?
  ↓
Attention launch
  ↓
ExpectedPhysicalKVReadSet
  ↓
RuntimeKVReadWitness
```

### Failure states

- `TRANSPORT_DONE_VISIBILITY_UNKNOWN`
- `REMOTE_WRITE_ARRIVED_NOT_GPU_VISIBLE`
- `VISIBILITY_SCOPE_TOO_WEAK`
- `MULTI_RDMA_ORDERING_DOMAIN_UNRESOLVED`
- `KV_LEASE_CHANGED_AFTER_TRANSFER`
- `TRANSLATION_CHANGED_AFTER_VISIBILITY_BARRIER`
- `ATTENTION_LAUNCHED_BEFORE_VISIBILITY_WITNESS`

---

## Bottom-Level Logic

### GPUDirect RDMA relaxed-memory problem

最小化模型：

```text
NIC / third-party device
      │
      │ RDMA WRITE
      ▼
GPU BAR / VRAM
      │
      ├──── GPU kernel already running
      │       └─ may observe stale / partial / out-of-order state
      │
      ▼
CPU observes transport completion
      │
      ▼
CUDA visibility/order operation
      │
      ▼
Dependent CUDA work submission
      │
      ▼
Attention kernel sees ordered KV
```

所以 `CQE received`、`check_xfer_state == DONE`、`TransferStatus == COMPLETED`都不能單獨作為 `RuntimeKVReadWitness`。

### 新的 Readable KV contract

```text
ReadableKV(r, layer, block) =
  SemanticContentMatches
∧ KVLeaseEpochMatches
∧ TransportTerminalStatusSuccess
∧ RemoteWriteArrivalEstablished
∧ GPUDirectVisibilityEstablished
∧ VisibilityScopeCoversConsumer
∧ TranslationEpochMatches
∧ ConsumerCudaOrderingEstablished
∧ AttentionLaunchAfterOrdering
```

---

## Visual Simulation Idea

### RDMA Completion → GPU Visibility Microscope

Hermes Console新增四條時間軸：

```text
NIC / RDMA QP
WRITE ───────── CQE ●
                 │
                 │ transport done
                 ▼
CUDA VISIBILITY
             flush/order ●
                         │
                         ▼
COMPUTE STREAM
.................... barrier ─── Attention L18

KV BLOCK 42
Lease 8 ────────────────────────────────

Translation
Epoch 31 ───────────────────────────────
```

互動：
1. 移除 visibility barrier → `TRANSPORT_DONE_VISIBILITY_UNKNOWN`。
2. 在 CQE與flush之間重用 Block42 → `LEASE_CHANGED_DURING_VISIBILITY_WINDOW`。
3. 選擇不足 scope → `VISIBILITY_SCOPE_TOO_WEAK`。
4. 兩條 RDMA hardware paths同時寫同一 destination → `MULTI_ORDERING_DOMAIN_UNRESOLVED`。
5. Attention在 barrier前 launch → `CONSUMER_LAUNCH_BEFORE_VISIBILITY`。

---

## Code / GitHub

### NIXL
Repo：https://github.com/ai-dynamo/nixl

本輪確認：
- `src/api/python/_api.py` — `check_xfer_state`
- `examples/python/basic_two_peers.py` — polling terminal status
- `examples/python/remote_storage_example/nixl_storage_utils/common.py` — `while status != "DONE"`

下一輪必讀：
- backend/plugin transfer progress
- RDMA completion queue handling
- CUDA/GDR memory registration
- completion status到 GPU visibility的任何 bridge

### Mooncake
Repo：https://github.com/kvcache-ai/Mooncake

本輪確認架構：
- TransferEngine
- Transport abstraction
- `RdmaTransport`
- `NvlinkTransport`
- BatchTransfer
- `getTransferStatus`
- TENT `PENDING/COMPLETED/FAILED`

下一輪必讀：RDMA transport completion path與 GPU buffer registration/ordering。

---

## Papers / Technical Sources

### NVIDIA GPUDirect RDMA Documentation
- **Institution**：NVIDIA
- **Year**：current CUDA 13.4 docs
- **URL**：https://docs.nvidia.com/cuda/gpudirect-rdma/
- **Architecture**：third-party PCIe/RDMA device ↔ GPU BAR/VRAM + CUDA synchronization model
- **Contribution**：定義 GPUDirect RDMA與 CUDA relaxed memory model的 ordering boundary
- **Limitations**：不是 inference-specific，也不替 NIXL/Mooncake定義其 backend contract
- **改變了什麼**：讓 Hermes第一次能正式區分 `transport completed` 與 `GPU visible`

### CUDA Driver API — cuFlushGPUDirectRDMAWrites
- **Institution**：NVIDIA
- **Year**：CUDA 13.4
- **URL**：https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/group__CUDA__DEVICE.html
- **Contribution**：提供 remote GPUDirect write visibility primitive與scope/capability model
- **Limitations**：multi-path ordering domain可能仍需外部機制

本輪未把一般 KV cache論文硬塞入 Papers；目前真正的知識缺口是 transport/device memory-model contract，官方 CUDA文件比泛化 inference paper更直接。

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `RemoteWriteArrivalWitness`
- `GPUDirectVisibilityWitness`
- `GPUDirectOrderingCapability`
- `VisibilityScope`
- `VisibilityGeneration`
- `RDMAOrderingDomain`
- `RequiredVisibilityFrontier`
- `RequiredReadableFrontier`
- `BackendVisibilityContract`
- `TransportDoneVisibilityUnknownState`
- `VisibilityScopeTooWeakState`
- `MultiOrderingDomainUnresolvedState`

### Edges

```text
TransportTerminalStatusWitness
--does_not_prove→ GPUDirectVisibilityWitness

RDMACompletionQueueEvent
--supports→ RemoteWriteArrivalWitness

RemoteWriteArrivalWitness
--does_not_prove→ GPUConsumerVisibility

cuFlushGPUDirectRDMAWrites
--can_establish→ GPUDirectVisibilityWitness

GPUDirectOrderingCapability
--determines→ RequiredVisibilityAction

RequiredTransferFrontier
+ RequiredVisibilityFrontier
+ RequiredConsumerOrderingFrontier
--compose→ RequiredReadableFrontier

RequiredReadableFrontier
+ KVLeaseEpoch
+ TranslationEpoch
--gates→ AttentionReadAdmission
```

---

## Unknown / Open Questions

1. **NIXL**：各 RDMA backend的 `DONE` 是在 local CQ completion、remote acknowledgement、還是更強的 visibility boundary後產生？是否有 GDR flush/order primitive？
2. **Mooncake**：`RdmaTransport` 對 GPU destination buffer完成 `COMPLETED` 前後，是否顯式處理 CUDA/GDR visibility？不同 transport是否具有不同 completion strength？
3. **CUDA**：對目前主流 H100/H200/B200 + ConnectX topology，`GPU_DIRECT_RDMA_WRITES_ORDERING` 實際回報哪些 scope；哪些部署可省略 flush，哪些不可？

---

## 下一輪研究

```text
NIXL RDMA backend
→ CQ / progress engine
→ DONE exact transition
→ GPU buffer registration
→ GDR ordering/flush

Mooncake RdmaTransport
→ request submission
→ CQ completion
→ COMPLETED exact transition
→ GPU visibility handling

CUDA capability matrix
→ GPU_DIRECT_RDMA_WRITES_ORDERING
→ FLUSH_GPU_DIRECT_RDMA_OPTIONS
→ HOST vs MEMOPS flush

→ BackendVisibilityContract
→ RequiredVisibilityFrontier prototype
→ RequiredReadableFrontier
→ Attention Visibility Policy
→ VisibleLogicalPositionSet
→ ExpectedPhysicalKVReadSet
→ causal ZERO/REPLACE KV
→ ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction
```

---

## 本輪結束判斷

- **缺哪一層**：NIXL/Mooncake backend-specific `transport terminal → GPUDirect visibility` bridge。
- **哪個節點最淺**：`BackendVisibilityContract`。
- **哪個概念仍只是名詞**：`ObservedPhysicalKVReadSet`；目前能證明「有資格安全讀」，仍不是逐 load address observation。
- **哪個系統值得讀原始碼**：NIXL RDMA backend與 Mooncake `RdmaTransport`。
- **哪篇論文/技術來源需追引用**：NVIDIA GPUDirect RDMA memory-ordering/flush docs及其引用的 CUDA stream-memory-op semantics。
- **哪個概念最適合視覺模擬**：`RDMA Completion → GPU Visibility → CUDA Consumer Ordering`。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + Runtime Provenance Verifier + Distributed Transfer Frontier Verifier + GPUDirect Visibility Verifier + Device Ordering Verifier + Residency/Lease Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。

本輪最大的推進：**Hermes 現在不再把「網路/RDMA傳完」等同「GPU看得到」。Distributed KV provenance正式增加了 CUDA memory-model visibility layer，將 transport completion、remote write arrival、GPU visibility、consumer stream ordering、Attention launch拆成五個不同證據階段。**