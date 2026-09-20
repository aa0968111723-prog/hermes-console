# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-21 07:52（Asia/Taipei）  
**本輪主題**：RDMA CQ Completion × Relaxed Ordering × GPU Visibility Gap  
**研究鏈位置**：Semantic KV → Lease → Transfer → CQ completion → **GPU visibility contract** → CUDA ordering → Attention

## 與歷史研究比較

上一輪已確認 `Transport DONE/COMPLETED ≠ GPU visibility`，並建立 `RequiredTransferFrontier ∧ RequiredVisibilityFrontier ∧ RequiredConsumerOrderingFrontier`。本輪不再重複這個結論，而是向 NIXL/Mooncake 原始碼下鑽：**generic completion status 的底層究竟能追到哪個 completion primitive，以及 relaxed ordering 會不會讓「CQE 已到」與「Attention 可安全讀」之間仍存在缺口。**

結論：Mooncake 已能追到 `ibv_poll_cq()` 與 per-slice completion aggregation；而且 current RDMA transport會在可用時要求 `IBV_ACCESS_RELAXED_ORDERING`。這使 Hermes 必須把 `CQCompletionWitness` 與 `GPUVisibilityWitness` 永久分開。NIXL public `check_xfer_state()` 仍只提供 `DONE/PROC/ERR` abstraction；本輪在可檢索 source中沒有找到 `cuFlushGPUDirectRDMAWrites`，因此不能宣稱 NIXL DONE 自帶 CUDA visibility guarantee。

---

## 本小時新發現

### 1. Mooncake COMPLETED 可以下鑽到 CQ / slice aggregation，而不是單純 UI status

current Mooncake TENT RDMA path直接呼叫 `ibv_poll_cq()`；slice完成後 `updateSliceStatus(..., COMPLETED)` 會累加 `task->transferred_bytes`，待 slices resolve後形成 task terminal status。這提供了比 `getTransferStatus()` 更底層的 `CQCompletionWitness → SliceCompletionWitness → TaskTransportCompletionWitness`。

值得看的檔案：
- `mooncake-transfer-engine/tent/src/transport/rdma/cq.cpp`
- `mooncake-transfer-engine/tent/src/transport/rdma/rdma_transport.cpp`
- `mooncake-transfer-engine/tent/include/tent/transport/rdma/slice.h`
- `mooncake-transfer-engine/src/transport/rdma_transport/rdma_context.cpp`

Repo: https://github.com/kvcache-ai/Mooncake

### 2. Mooncake current RDMA path可能啟用 IBV relaxed ordering

`RdmaTransport` 檢查 `ibv_reg_mr_iova2`，支援時會要求 `IBV_ACCESS_RELAXED_ORDERING`；TENT buffers/context同樣可把 relaxed-ordering flag加入 MR access rights。

這不是錯誤，而是性能能力；但 provenance不能把「CQE出現」偷換成「所有 GPU consumer execution已具備 CUDA memory-model visibility」。因此新增：

`RdmaOrderingMode = STRICT | RELAXED`

以及：

`CQCompletionWitness + RdmaOrderingMode → BackendVisibilityContract evaluation`

### 3. NVIDIA官方再次限制證據強度：GPUDirect RDMA memory ordering依賴 CUDA boundary

NVIDIA GPUDirect RDMA 13.4指出，只有 CPU initiated CUDA synchronization/work-submission APIs提供 GPU觀察 GPUDirect operations所需的 ordering；與 RDMA write concurrent 的 kernel可能看到 stale/partial/out-of-order data。`cuFlushGPUDirectRDMAWrites()` 則等待 remote writes對指定 scope可見；若硬體 ordering scope足夠則可能是 no-op，多 hardware paths還可能形成不同 ordering domains。

官方來源：
- https://docs.nvidia.com/cuda/gpudirect-rdma/
- https://docs.nvidia.com/cuda/cuda-driver-api/cuda_driver_api/group__CUDA__DEVICE.html

### 4. NIXL public DONE仍停在 transport lifecycle證據層

NIXL `src/api/python/_api.py` 的 `check_xfer_state()` 對 application暴露 `DONE/PROC/ERR`；examples持續 polling直到 `DONE`。本輪 code search沒有找到 `cuFlushGPUDirectRDMAWrites`。因此目前最保守、可驗證的建模仍是：

`NIXL DONE → TransportTerminalStatusWitness`

而不是：

`NIXL DONE → GPUDirectVisibilityWitness`

注意：「搜尋不到 flush」不證明 backend沒有其他 ordering primitive；這只是目前尚未驗證，必須標 `VISIBILITY_CONTRACT_UNRESOLVED`。

### 5. 新的 backend contract應從 status enum提升為 evidence ladder

```text
TransferSubmitted
→ WorkRequestPosted
→ CQCompletionWitness
→ SliceCompletionWitness
→ TaskTransportCompletionWitness
→ RemoteWriteArrivalWitness
→ GPUDirectVisibilityWitness
→ ConsumerCudaOrderingWitness
→ PostBarrierAttentionLaunchWitness
```

每個 backend只能宣告自己真正提供到哪一層，不能用 `DONE/COMPLETED` 一次跨越全部層級。

---

## 本小時最重要 5 個發現

1. **Mooncake completion可追到 verbs CQ**：`ibv_poll_cq()` 提供 transport-level硬證據，但仍不是 CUDA visibility proof。限制是 CQ semantics與 GPU memory model不是同一抽象層。
2. **Mooncake支援 relaxed ordering**：MR可能要求 `IBV_ACCESS_RELAXED_ORDERING`，因此 ordering mode必須進 provenance。限制是是否真正啟用取決於 host能力/config。
3. **CQE ≠ Attention-safe**：NVIDIA官方要求 dependent CUDA boundary；concurrent kernel與 RDMA write構成 data race風險。限制是不同硬體可能已有更強 ordering。
4. **NIXL DONE evidence仍較粗**：public API證明 lifecycle terminal state；目前未驗證到 remote CUDA visibility bridge。限制是 backend內部可能有未被本輪索引命中的機制。
5. **BackendVisibilityContract必須可能力協商**：Transport、CQ、visibility、consumer ordering要分層，Hermes才能 fail closed而非猜測。

---

## Architecture Breakdown

### System Architecture：Mooncake RDMA → CUDA Attention

```text
KV semantic content
→ destination Block@LeaseEpoch
→ Mooncake BatchTransfer
→ RDMA request slicing
→ Work Requests / QP
→ ibv_poll_cq()
→ CQCompletionWitness
→ updateSliceStatus(COMPLETED)
→ transferred_bytes aggregation
→ Task COMPLETED
→ [visibility contract gate]
   ├ hardware ordering sufficient
   ├ cuFlushGPUDirectRDMAWrites required
   ├ CUDA work-submission boundary required
   └ unresolved → fail closed
→ ConsumerCudaOrderingWitness
→ TranslationEpoch validation
→ Attention launch
→ ExpectedPhysicalKVReadSet
```

### Failure states

- `CQ_COMPLETE_VISIBILITY_UNKNOWN`
- `RELAXED_ORDERING_WITHOUT_VISIBILITY_WITNESS`
- `TASK_COMPLETE_NOT_CONSUMER_ORDERED`
- `VISIBILITY_SCOPE_TOO_WEAK`
- `MULTI_ORDERING_DOMAIN_UNRESOLVED`
- `LEASE_CHANGED_AFTER_CQ_COMPLETION`
- `ATTENTION_LAUNCHED_BEFORE_VISIBILITY_GATE`

---

## Bottom-Level Logic

### CQ completion與 GPU visibility的最小模型

```text
NIC posts RDMA WRITE
→ remote GPU BAR/VRAM receives transactions
→ verbs CQ reports completion
→ host/runtime marks slice/task complete
→ [CUDA/GDR visibility boundary]
→ dependent CUDA work submission/order
→ Attention kernel may safely consume KV
```

Hermes不可省略中間的 visibility boundary。

新的 proof object：

```text
BackendVisibilityContract {
  transport_backend,
  completion_primitive,
  ordering_mode,
  destination_memory_kind,
  gdr_ordering_capability,
  required_visibility_action,
  visibility_scope,
  consumer_ordering_primitive,
  evidence_strength,
  verified_version
}
```

`ReadableKVWitness = LeaseValid ∧ TranslationValid ∧ TransportComplete ∧ VisibilitySatisfied ∧ ConsumerOrdered ∧ LaunchAfterBarrier`

---

## Visual Simulation Idea

### CQ → Visibility → Attention Evidence Ladder

```text
RDMA QP
  │ WRITE
  ▼
GPU VRAM Block42@Lease8
  │
  ├── CQE ✓
  │     ↓
  ├── Slice Complete ✓
  │     ↓
  ├── Task COMPLETED ✓
  │     ↓
  ├── GPU Visibility ?
  │     ↓
  ├── CUDA Ordering ?
  │     ↓
  └── Attention L18 BLOCKED
```

互動切換 STRICT / RELAXED ordering、hardware ordering capability、flush/no-flush、lease reuse與Attention launch時序；Console只在所有 proof edges成立時把 Attention改成 READABLE。

---

## Code / GitHub

### Mooncake
- `mooncake-transfer-engine/tent/src/transport/rdma/cq.cpp` — `ibv_poll_cq`
- `mooncake-transfer-engine/tent/include/tent/transport/rdma/slice.h` — slice完成與 transferred_bytes aggregation
- `mooncake-transfer-engine/src/transport/rdma_transport/rdma_transport.cpp` — relaxed ordering capability/config
- `mooncake-transfer-engine/tent/src/transport/rdma/buffers.cpp` — `IBV_ACCESS_RELAXED_ORDERING`
- `mooncake-transfer-engine/tent/src/transport/rdma/context.cpp` — MR registration ordering flags

### NIXL
- `src/api/python/_api.py` — `check_xfer_state`
- `examples/python/basic_two_peers.py`
- `examples/python/remote_storage_example/nixl_storage_utils/common.py`

---

## Papers / Technical Sources

本輪核心不是新增泛論文，而是補 correctness boundary；優先級高於再擴論文數量。

1. **NVIDIA GPUDirect RDMA 13.4 Documentation** — NVIDIA, 2026 docs. Contribution：明確定義 third-party RDMA 與 GPU relaxed memory model的 ordering限制。Limitation：提供 CUDA-level contract，不替 NIXL/Mooncake證明其 backend已正確接入。
2. **CUDA Driver API 13.4 — `cuFlushGPUDirectRDMAWrites`** — NVIDIA. Contribution：提供 remote write visibility primitive與 capability/scope語義。Limitation：multi-path ordering domains可能仍需 CUDA外部機制。

---

## Unknown / Open Questions

1. NIXL RDMA/UCX plugin從底層 CQ/progress completion到 `DONE` 的 exact state transition在哪個 source path？
2. Mooncake在 GPU VRAM RDMA + relaxed ordering下，是否於更高層插入 CUDA/GDR visibility boundary，或依賴 subsequent CUDA API submission？
3. 能否以 controlled test建立 `CQE timestamp → flush/order timestamp → Attention launch timestamp`，再配合 KV sentinel corruption驗證 visibility contract？

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `CQCompletionWitness`
- `SliceCompletionWitness`
- `TaskTransportCompletionWitness`
- `RdmaOrderingMode`
- `RelaxedOrderingCapability`
- `BackendVisibilityContract`
- `VisibilityContractUnresolvedState`
- `CQCompleteVisibilityUnknownState`
- `AttentionVisibilityGate`

### Edges
```text
ibv_poll_cq CQE
→ supports
→ CQCompletionWitness

CQCompletionWitness
→ contributes_to
→ TaskTransportCompletionWitness

TaskTransportCompletionWitness
--does_not_prove→ GPUDirectVisibilityWitness

IBV_ACCESS_RELAXED_ORDERING
→ parameterizes
→ BackendVisibilityContract

GPUDirectVisibilityWitness
+
ConsumerCudaOrderingWitness
→ enables
→ AttentionVisibilityGate
```

---

## 下一輪研究

```text
NIXL source/plugin graph
→ backend progress engine
→ CQ/UCX completion
→ DONE exact transition
→ GPU memory registration path
→ visibility/order primitive search

Mooncake
→ CQ handler exact task resolution
→ GPU VRAM registration
→ relaxed-ordering runtime path
→ post-CQE CUDA boundary search

Then
→ BackendVisibilityContract prototype
→ controlled CQE/visibility/Attention experiment
→ AttentionVisibilityPolicy
→ VisibleLogicalPositionSet
→ ExpectedPhysicalKVReadSet
→ ZERO / REPLACE selected KV
→ ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction
```

## 本輪結束判斷

- **缺哪一層**：NIXL/Mooncake backend-specific `CQ completion → CUDA visibility/order` bridge。
- **哪個節點最淺**：`BackendVisibilityContract` production instance。
- **哪個概念仍只是名詞**：`ObservedPhysicalKVReadSet`；目前證明的是「何時有資格讀」，不是逐 load觀測。
- **哪個系統值得讀原始碼**：NIXL backend progress/plugin layer；Mooncake TENT RDMA CQ + MR registration path。
- **哪篇論文/來源需追引用**：NVIDIA GPUDirect RDMA memory-ordering contract與 CUDA Driver flush API；此階段比泛論文更直接。
- **哪個概念最適合視覺模擬**：CQ → Visibility → Attention Evidence Ladder。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + Runtime Provenance Verifier + Backend Visibility Contract Adapter + Device Ordering Verifier + Residency/Lease Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。

本輪把上一輪的「transport completion ≠ GPU visibility」從文件層再下鑽到 Mooncake verbs CQ與slice/task completion實作。下一個真正要閉合的證據洞，是**CQE之後到底由哪個 backend-specific CUDA/GDR primitive建立 visibility與consumer ordering**；只有閉合這一層，Hermes才應允許 Attention從 `BLOCKED` 進入 `READABLE`。