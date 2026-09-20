# 【AI Agent × Multimodal Research Report】

**時間：2026-09-21 05:56（Asia/Taipei）**

**本輪主題：Timeline Semaphore Event IPC × Global KV Transfer Epoch × Transport Completion Evidence**

> 本輪承接上一輪 `CrossProcessReadableKVWitness`，不再重複 scheduler readiness / KV lease / CUDA Graph identity。研究問題縮到：LMCache 新的 timeline-semaphore IPC 到底如何形成跨 process ordering；NIXL/Mooncake 的「transfer done」證據與 device-stream readability 差在哪裡；以及 `GlobalKVTransferEpoch` 應該如何從名詞變成可計算的版本向量。

## 本小時新發現

### 1. LMCache 已從 CUDA IPC Event handle 進一步抽象成 GPU-resident timeline semaphore

current LMCache `TimelineSemaphoreEventIPCBackend` 不使用 CUDA interprocess event handle，而是在每個 device 配置 IPC-shared GPU memory semaphore buffer。每個 recording stream 綁定一個 slot，record 時 sequence 單調遞增：

`record_event → cuStreamWriteValue64(slot, seq)`

`wait_event → cuStreamWaitValue64(slot, seq, GEQ)`

export wire payload是 `(version, cudaIpcMemHandle, slot_offset, sequence)`；import後映射同一 semaphore buffer，consumer stream wait 到指定 sequence。

這表示 event identity 可從「opaque event object」提升為可序列化的 **Timeline Coordinate**。

### 2. GlobalKVTransferEpoch 不應是單一 scalar，而應是 per-stream timeline vector

因為 LMCache 每條 recording stream各自擁有 slot與 sequence，沒有天然全域單調 total order。比較正確的抽象是：

`TransferTimelineCoordinate = (producer_process_epoch, producer_device, semaphore_buffer_generation, slot, sequence)`

跨 TP/DP/EP、多 producer、多 stream 的 request-level transfer epoch應該是 vector / set：

`GlobalKVTransferEpoch = {rank_i → [TimelineCoordinate...]}`

只有當 consumer滿足該 request所需全部 coordinates，才能宣告 aggregate transfer barrier完成。

### 3. Timeline semaphore把 event lifetime風險從「event object GC」改成「buffer generation lifetime」

上一輪發現 default CUDA IPC Event可能受 producer event object lifetime影響。Timeline backend則把 imported mapping cache到 process lifetime，semaphore buffer本身也不回收 slot；event export是 sequence snapshot。

因此 lifetime provenance要修正：

`EventLifetimeEpoch → SemaphoreBufferGeneration + SlotGeneration + Sequence`

這降低單一 Python event object GC造成的 identity脆弱性，但不代表 process crash / CUDA context teardown後舊 handle仍有效。

### 4. NVIDIA 官方對 Stream Memory Operations 有重要安全限制，與「把它當 universal CUDA dependency」存在邊界

CUDA Driver API說明 `cuStreamWaitValue64` 會讓後續 stream work等待 memory condition成立；但官方同時警告：不當使用可能 deadlock，而且透過 stream-memory operations建立的 ordering不一定對 CUDA scheduler可見；間接排序的 CUDA tasks應同時表達 CUDA-visible dependencies（例如 events）。

因此 Hermes不能把：

`TimelineSemaphoreWait → universal CUDA-visible dependency`

當成無條件定律。應新增：

`StreamMemOpOrderingWitness` 與 `CudaSchedulerVisibilityWitness`，並對跨 stream/capture/graph情境做壓力驗證。

### 5. NIXL / Mooncake current vLLM path主要暴露「transport terminal status」，證據等級仍不同於 consumer-stream wait

current NIXL worker輪詢 `nixl_wrapper.check_xfer_state(handle)`，以 `DONE` 作為 transfer handle完成；Mooncake direct P/D path使用 `batch_transfer_sync_write()`，producer端在 synchronous transfer call返回 terminal status後記錄成功。

這些都是重要 transport completion witness，但從目前讀到的 vLLM connector層原始碼，仍不能直接推出：

`TransportDone → ConsumerComputeStreamOrderedAfterRemoteWrite`

因此 Hermes要把 transport completion與 device ordering永久拆開。

---

# 本小時最重要 5 個發現

## 發現 1 — Timeline Coordinate 比 Event Handle 更適合做 provenance identity

**概念**：以 `(buffer generation, slot, sequence)` 表示一次 GPU ordering point。

**底層如何運作**：record stream先完成前序 KV writes，再向自己的 semaphore slot寫入 sequence；consumer stream wait同一 slot直到 `value >= seq`。

**為什麼重要**：可跨 process序列化、可比較同一 slot上的先後、可直接畫時間軸。

**限制**：不同 slot之間沒有天然 total order；buffer/context teardown需要額外 generation identity。

## 發現 2 — Global transfer epoch是 vector clock-like structure，不是 request counter

對 request R，如果 KV來自 P0/S0、P1/S3、P2/S1，readiness應表示為多個 producer timeline coordinates的 conjunction。

```text
R42 RequiredTransferFrontier = {
  P0: (slot=4, seq=91),
  P1: (slot=7, seq=38),
  P2: (slot=2, seq=117)
}
```

consumer只有在所需 frontier全部 satisfied後，才有資格建立 `AggregateTransferBarrierWitness`。

## 發現 3 — timeline semaphore lifetime是 buffer-generation問題

LMCache imported semaphore mappings保留到 process lifetime，slot不回收；sequence在每個 stream slot單調遞增。這使 event generation更穩定，但也要求：process restart、device reset、buffer重新配置必須建立新的 `SemaphoreBufferGeneration`，不能沿用舊 timeline coordinate。

## 發現 4 — transport completion與device readability必須分級

證據階層：

`TransferSubmitted < TransportTerminalStatus < ConsumerOrderingEstablished < PostBarrierAttentionLaunch`

NIXL `DONE`、Mooncake synchronous write return目前屬 transport completion層；LMCache timeline wait更接近 consumer ordering層。

## 發現 5 — stream-memory ordering需要 scheduler-visibility驗證

NVIDIA官方明確提醒 stream memory operations的 ordering visibility有陷阱。因此 Hermes應新增 differential test：

`CUDA Event path` vs `Timeline Semaphore path`

在多 stream、CUDA Graph、busy stream、cross-process與lease reuse壓力下比較結果，不能只依賴 API名稱推論 correctness。

---

# Architecture Breakdown

## LMCache TimelineSemaphoreEventIPCBackend

```text
PRODUCER PROCESS / GPU d0

KV WRITE / DMA
      ↓
Producer Stream S7
      ↓
slot[S7] = slot 14
seq = 201
      ↓
cuStreamWriteValue64(slot14, 201)
      ↓
export {
  mem_handle,
  slot_offset=14*8,
  seq=201
}
            │
            │ IPC bytes
            ▼
CONSUMER PROCESS / GPU dX
cudaIpcOpenMemHandle
      ↓
map same semaphore buffer
      ↓
cuStreamWaitValue64(slot14, 201, GEQ)
      ↓
consumer work after wait
```

LMCache的重要工程細節：

- slot按 recording stream分配；
- sequence按 slot單調遞增；
- lock持續到 write enqueue，避免 seq N+1先於 seq N寫入造成 stranded waiter；
- imported events只能 wait/query，不能重新 record；
- imported buffer mapping以 `(handle_bytes, importer_device)` cache到 process lifetime；
- `synchronize_event()`使用每 thread/device專用 sync stream，避免不同 pending waits互相 head-of-line block。

## NIXL / Mooncake evidence placement

```text
NIXL
post transfer
→ transfer handle
→ check_xfer_state(handle)
→ DONE
→ TransportTerminalStatusWitness

Mooncake
batch_transfer_sync_write(...)
→ return terminal status
→ TransportTerminalStatusWitness

LMCache Timeline
producer stream write semaphore
→ IPC memory handle
→ consumer stream wait semaphore
→ ConsumerOrderingWitness
```

三者不能在 Knowledge Graph中都簡化成 `KV_READY`。

---

# Bottom-Level Logic

## 1. Timeline semaphore record

對 producer stream `S`：

1. 找到或配置 stream-specific slot `k`。
2. `seq[k] = seq[k] + 1`。
3. 在 `S` enqueue `cuStreamWriteValue64(addr(k), seq[k])`。
4. 因為 write在同一 stream排在先前 KV work之後，sequence成為該 stream的一個 completion frontier。
5. export `(buffer_handle, offset(k), seq[k])`。

## 2. Timeline semaphore wait

consumer：

1. import GPU semaphore memory handle；
2. 得到 consumer process中的 `base_ptr`；
3. enqueue `cuStreamWaitValue64(base+offset, seq, GEQ)`；
4. 該 stream後續工作在條件成立前被阻塞；
5. 再把 post-wait Attention launch與 KV lease / translation epoch join。

## 3. Request-level vector frontier

```text
TransferRequirement(R) = {
  (rank0, streamA, seq17),
  (rank0, streamB, seq9),
  (rank3, streamC, seq42)
}

AggregateTransferBarrierWitness(R)
= AND(satisfied(coord) for coord in TransferRequirement(R))
```

這個模型自然支援 TP/DP/EP與多 connector fan-in，比單一 `GlobalKVTransferEpoch = 123` 更不容易產生 false ordering。

## 4. Strong readability contract v2

```text
StrongReadableKVWitness =
  SemanticContentLineageMatch
  ∧ PhysicalLeaseGenerationValid
  ∧ TranslationEpochValid
  ∧ TransportTerminalStatusWitness
  ∧ RequiredTransferFrontierSatisfied
  ∧ ConsumerOrderingWitness
  ∧ CudaSchedulerVisibilityWitness
  ∧ PostBarrierAttentionLaunchWitness
```

---

# Visual Simulation Idea

## Distributed KV Transfer Frontier Viewer

```text
P0 / Stream S1        slot 4:  89 ─ 90 ─ 91 ●
P0 / Stream S8        slot 9:  14 ─ 15 ●
P1 / Stream S3        slot 7:  36 ─ 37 ─ 38 ●
P2 / Stream S1        slot 2: 115 ─116 ─117 ●

Request R42 requires:
P0:S1 >= 91   ✓
P0:S8 >= 15   ✓
P1:S3 >= 38   ✓
P2:S1 >=117   ✗

Aggregate Barrier: NOT READY
Attention L18: BLOCKED
```

互動功能：

- 切換 Event IPC / Timeline Semaphore / NIXL / Mooncake evidence mode；
- 模擬 process restart，所有舊 buffer-generation coordinates變紅；
- 模擬缺一個 TP rank completion；
- 模擬 `DONE` 已到但 consumer wait尚未建立；
- 模擬 lease在 frontier完成前被 reuse；
- 顯示 `TRANSPORT_DONE_NOT_DEVICE_ORDERED`、`STALE_SEMAPHORE_GENERATION`、`PARTIAL_FRONTIER_SATISFIED`、`CUDA_SCHEDULER_VISIBILITY_UNPROVEN`。

---

# Code / GitHub

## LMCache

本輪深入：

- `lmcache/v1/platform/devices/cuda/timeline_semaphore_event_ipc.py`
- `docs/design/v1/platform/devices/cuda/timeline_semaphore_event_ipc.md`
- `docs/design/v1/platform/base/event_ipc_abstraction.md`
- `tests/v1/platform/devices/cuda/test_timeline_semaphore_event_ipc.py`

核心檔案證明 timeline backend不是包裝名稱，而是直接使用 `cuStreamWriteValue64 / cuStreamWaitValue64` + CUDA IPC memory handle。

## vLLM NIXL

值得繼續追：

- `vllm/distributed/kv_transfer/kv_connector/v1/nixl/base_worker.py`
- `vllm/distributed/nixl_utils.py`
- `NixlWrapper.check_xfer_state()`底層 NIXL contract

current worker以 transfer handle + `check_xfer_state()==DONE`追完成狀態。

## vLLM Mooncake

本輪確認：

- `vllm/distributed/kv_transfer/kv_connector/v1/mooncake/mooncake_connector.py`
- direct P/D path以 `batch_transfer_sync_write()`回傳 terminal status；
- transfer regions包含 layer name/index、base address、block length、KV block length與group index。

這使 Hermes可以把 transport completion直接接回 layer/physical-region provenance，但仍需 device-ordering witness。

---

# Papers / Technical Sources

## NVIDIA CUDA Driver API — Stream Memory Operations

- Institution: NVIDIA
- Version observed: CUDA 13.3/13.4 documentation, 2026
- Mechanism: `cuStreamWriteValue64`, `cuStreamWaitValue64`, stream memory operations
- Contribution to this research:提供 timeline-semaphore底層 ordering primitive與 capability query；同時明確警告 improper use可能 deadlock，且 stream-memory ordering存在 CUDA scheduler visibility限制。
- Limitation: API contract本身不是 LMCache cross-process protocol correctness proof。
- URL: https://docs.nvidia.com/cuda/cuda-driver-api/group__CUDA__MEMOP.html

## LMCache Timeline Semaphore Event IPC Design

- Institution/Project: LMCache / Tensormesh ecosystem
- Year: current 2026 source
- Architecture: IPC-shared GPU memory + per-stream slot + monotonic 64-bit sequence
- Contribution:移除 default CUDA IPC event handle對 shared `/dev/shm` / hostIPC部署的依賴，將 event semantics建立在 memory handle上。
- Limitation: CUDA stream-memory-op scheduler visibility仍需依官方限制與實測建立 evidence level。
- Code: https://github.com/LMCache/LMCache/blob/dev/lmcache/v1/platform/devices/cuda/timeline_semaphore_event_ipc.py

---

# 與歷史研究比較

上一輪：

`CrossProcessReadableKVWitness = producer event → IPC export/import → consumer event wait → read`

本輪沒有重複該結論，而是把 event abstraction往下拆成：

`GPU semaphore memory → stream-specific slot → monotonic sequence → exported timeline coordinate → vector transfer frontier`。

因此 `GlobalKVTransferEpoch` 從上一輪的名詞，升級成可以實作的 distributed version structure。

同時加入一個重要修正：**transport DONE 與 consumer stream ordering是不同 evidence class**；NIXL/Mooncake不能因為 transfer API完成就自動提升到 LMCache timeline wait同一證據等級。

---

# Unknown / Open Questions

1. LMCache timeline semaphore在 CUDA Graph capture / replay、跨 device peer access與高壓多 stream下，是否需要額外 CUDA-visible event dependency才能完全符合 NVIDIA scheduler visibility建議？
2. NIXL `check_xfer_state()==DONE` 對 GPU memory visibility的精確 backend contract是什麼？不同 UCX/IB/RDMA backend是否相同？
3. Mooncake `batch_transfer_sync_write()`返回成功時，remote GPU memory visibility與consumer compute stream之間是否存在明示 device-side barrier，或仍需 connector額外建立？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

- `TimelineSemaphoreEventIPCBackend`
- `SemaphoreBufferGeneration`
- `SemaphoreSlotIdentity`
- `TimelineSequence`
- `TransferTimelineCoordinate`
- `RequiredTransferFrontier`
- `AggregateTransferBarrierWitness`
- `TransportTerminalStatusWitness`
- `ConsumerOrderingWitness`
- `StreamMemOpOrderingWitness`
- `CudaSchedulerVisibilityWitness`
- `StaleSemaphoreGenerationState`
- `PartialFrontierSatisfiedState`
- `TransportDoneNotDeviceOrderedState`

## Edges

```text
ProducerStream
→ owns
→ SemaphoreSlotIdentity

SemaphoreSlotIdentity
→ advances
→ TimelineSequence

TransferTimelineCoordinate
→ member_of
→ RequiredTransferFrontier

RequiredTransferFrontier
→ satisfied_by
→ AggregateTransferBarrierWitness

NIXLTransferDONE
→ supports
→ TransportTerminalStatusWitness

MooncakeSyncTransferSuccess
→ supports
→ TransportTerminalStatusWitness

TransportTerminalStatusWitness
--does_not_prove→ ConsumerOrderingWitness

TimelineSemaphoreWait
→ supports
→ ConsumerOrderingWitness

TimelineSemaphoreWait
--does_not_unconditionally_prove→ CudaSchedulerVisibilityWitness

SemaphoreBufferGeneration
→ invalidates_old
→ TransferTimelineCoordinate
```

---

# 下一輪研究

```text
NixlWrapper / NIXL backend source
→ check_xfer_state DONE contract
→ RDMA completion queue / memory visibility
→ Mooncake TransferEngine batch_transfer_sync_write internals
→ remote GPU completion semantics
→ LMCache timeline semaphore CUDA Graph stress semantics
→ RequiredTransferFrontier prototype
→ GlobalKVTransferEpoch implementation
→ Attention Visibility Policy
→ VisibleLogicalPositionSet
→ ExpectedPhysicalKVReadSet
→ causal ZERO/REPLACE intervention
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔToken
→ ΔAgentAction
```

---

# 本輪結論

- **缺哪一層：** NIXL/Mooncake transport terminal completion → remote GPU consumer-stream ordering 的正式 backend contract。
- **哪個節點最淺：** `CudaSchedulerVisibilityWitness`；LMCache timeline semaphore已有具體實作，但官方 stream-memory-op scheduler visibility警告需要被納入驗證。
- **哪個概念仍只是名詞：** `ObservedPhysicalKVReadSet`；本輪已把 distributed transfer frontier變得可計算，但仍未觀測逐 memory load。
- **哪個系統最值得讀原始碼：** NIXL `NixlWrapper/check_xfer_state`與 Mooncake TransferEngine `batch_transfer_sync_write`底層。
- **哪篇論文/技術來源需追引用：** NVIDIA Stream Memory Operations + LMCache timeline-semaphore設計；這兩者之間的 correctness boundary比新增一篇泛用 KV paper更重要。
- **哪個概念最適合視覺模擬：** Distributed KV Transfer Frontier Viewer。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Distributed Transfer Frontier Verifier + Device Ordering Verifier + Residency/Lease Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。

本輪最大的推進，是把上一輪仍抽象的 `GlobalKVTransferEpoch` 變成 **由每個 producer stream 的 `(buffer-generation, slot, sequence)` 組成的 distributed frontier**。這讓 Hermes未來能精確區分：「資料傳輸 API 已回報完成」、「所有 producer timeline 已越過必要 frontier」、「consumer GPU stream 已建立 ordering」、「Attention kernel已在 barrier之後啟動」四種完全不同的證據等級。