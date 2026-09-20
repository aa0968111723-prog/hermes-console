# 【AI Agent × Multimodal Research Report】

**時間：2026-09-21 04:55（Asia/Taipei）**

**本輪主題：Cross-Process KV Event IPC × Device Happens-Before × Readability Proof**

> 本輪承接上一輪 `DeviceReadinessWitness` 的缺口，不再重複 CUDA Graph / KV Lease / scheduler readiness。研究目標縮到一個更底層問題：當 KV producer 與 consumer 位於不同 process 時，究竟什麼證據能證明 consumer 的 GPU stream 在讀 KV 前，producer 的 GPU stream 已完成寫入？

## 本小時新發現

### 1. LMCache 已把跨 process KV ordering 明文化為 Event IPC contract

current LMCache 的 `docs/design/v1/platform/base/event_ipc_abstraction.md` 明確定義：worker 在 producer stream 記錄 event，server 匯入該 event 並在讀/寫 shared KV memory 前 wait；server 完成 transfer queueing 後再記錄 completion event，worker future 匯入、poll、wait 該 completion event。

這表示跨 process KV readiness 不是單一 `transfer_complete=True`，而是雙向 GPU event protocol。

### 2. Host synchronization 不能替代跨 process GPU ordering

LMCache 官方設計文件特別指出：只 drain importing process 自己的 streams，不能證明 exporting process 已完成。兩者是不同 CUDA contexts；若沒有真正 import producer event，consumer 可能在 producer 尚未完成 KV write 時就開始 transfer/read，而且可能沒有顯式 error，只表現為 load 下的 silent wrong-cache-content。

因此 Hermes 必須加入：

`HostSynchronization --does_not_prove→ CrossProcessDeviceHappensBefore`

### 3. Event handle 本身不是證據；必須保留原 producer event identity/lifetime

2026-05 LMCache issue #3236 顯示，producer-side `torch.cuda.Event` 若在 daemon 開啟 IPC handle 前被 GC，`from_ipc_handle()` 可能失敗。這表示 IPC handle provenance 還需要 EventLifetimeEpoch，而不能只保存 bytes handle。

### 4. Device identity 是 ordering contract 的一部分

2026-06 LMCache issue #3493 報告 DP+EP 下 event device index 與 recording stream device index mismatch。這再次證明 `EventRecorded` 不能單獨作為 readiness witness；還需要 producer device、producer stream、consumer device、consumer stream 與 import target device。

### 5. Layerwise readiness其實可以抽象成「跨 context happens-before graph」

LMCache 的 EventIPCBackend 已抽象 `create_event / export_event / import_event / record_event / wait_event / query_event / synchronize_event`。這比 connector-specific `wait_for_layer_load()` 更接近 Hermes 需要的 universal substrate：Hermes 應建模 Event IPC capability，而不是把 Python method name 當成 correctness proof。

---

# 本小時最重要 5 個發現

## 發現 1 — CrossProcessDeviceHappensBefore 是 KV readability 的必要證據層

**概念**：跨 process GPU ordering。

**底層如何運作**：

`Producer KV Write → Producer Stream → Record Event → Export IPC Handle → Consumer Import Event → Consumer Stream Wait → KV Transfer/Attention Read`

**為什麼重要**：scheduler ready、network transfer complete、host future resolved 都不等於 GPU consumer stream 已被排序到 producer write 之後。

**限制**：不同 accelerator/backend 的 IPC event semantics不同，不能假設 CUDA contract適用所有平台。

## 發現 2 — imported event 必須代表原 producer timeline

如果 backend 在 import 失敗時偷偷建立 local already-complete event，consumer wait會立即通過，形成 false readiness witness。

因此新增 invariant：

`ImportedEvent.producer_timeline_identity == ExportedEvent.producer_timeline_identity`

否則標記：`FABRICATED_EVENT_FALSE_READINESS`。

## 發現 3 — Event lifetime 本身是 provenance

新的 identity：

`EventIdentity = ProcessEpoch + DeviceIdentity + StreamIdentity + EventGeneration + EventLifetimeEpoch`

IPC handle只是一種 capability/reference，不應當作 event semantic identity。

## 發現 4 — Readability proof需要 producer與consumer兩端

以前：

`TransferComplete → DeviceReadable`

現在：

`ProducerWriteCompleteWitness + IPCEventImportWitness + ConsumerWaitWitness + PostWaitReadLaunchWitness → CrossProcessReadableKVWitness`

## 發現 5 — capability failure應 fail closed

LMCache 的設計要求：若 device不支援 cross-process event import，必須 fail capability check並改走不依賴該 ordering 的 transfer mode，而不是 silent fallback。

這可直接上升為 Hermes runtime原則：

`MissingOrderingCapability → NoStrongReadabilityClaim`

---

# Architecture Breakdown

## LMCache multiprocess KV ordering architecture

```text
PRODUCER PROCESS
KV compute / reservation
        ↓
producer CUDA stream
        ↓
record Event P
        ↓
export IPC handle
        │
        │ IPC
        ▼
CONSUMER / SERVER PROCESS
import Event P
        ↓
consumer transfer stream wait(P)
        ↓
shared KV read/write / DMA
        ↓
record Event C
        ↓
export completion handle
        │
        ▼
PRODUCER FUTURE
import Event C
→ query / wait / synchronize
```

Hermes應在這張圖上另外 join：

`RequestId + TransferEpoch + ConnectorId + KVPoolIdentity + BlockId + LeaseEpoch + LayerId + DeviceId + StreamId`。

---

# Bottom-Level Logic

## Cross-process Event IPC proof chain

1. producer kernel / DMA 對 KV physical memory產生 writes。
2. producer event被 record在同一或有明確 dependency的 producer stream。
3. event export產生 IPC handle。
4. producer event object保持 alive直到 consumer成功 import且 protocol允許釋放。
5. consumer以正確 device context import handle。
6. imported event必須指向原 producer timeline，而不是 local substitute。
7. consumer transfer/compute stream執行 `wait_event(imported_event)`。
8. consumer KV read / transfer / Attention launch必須排在 wait之後。
9. physical block的 `KVLeaseEpoch` 在 1→8 期間不可失效或 reuse。
10. BlockTable/translation epoch必須仍指向同一 lease generation。

因此：

```text
CrossProcessReadableKVWitness =
  ProducerWriteWitness
  ∧ ProducerEventRecordWitness
  ∧ EventLifetimeValid
  ∧ IPCExportWitness
  ∧ IPCImportWitness
  ∧ ProducerTimelineIdentityPreserved
  ∧ DeviceIdentityMatch
  ∧ ConsumerStreamWaitWitness
  ∧ LeaseStillValid
  ∧ TranslationStillValid
  ∧ PostWaitReadLaunchWitness
```

這比 `finished_recving` 或 `wait_for_layer_load()` 強一個證據等級。

---

# Visual Simulation Idea

## Cross-Process KV Happens-Before Microscope

```text
PROCESS A / GPU0                         PROCESS B / GPU1

Producer Stream S0                      Transfer Stream S4
KV WRITE W17
████████████
      │
      └─ record Event E91
             │
             └──── IPC HANDLE ────────→ import E91'
                                            │
                                            └─ wait(E91')
                                                  │
                                                  ▼
                                            DMA / KV READ
                                                  │
                                                  └─ record C22
                                                         │
                  import C22' ←──── IPC HANDLE ──────────┘
```

Console互動：點 E91 顯示 process/device/stream/event generation/lifetime、對應 KV blocks與 lease；拖曳時間軸可模擬 event GC、wrong-device import、missing wait、lease reuse。

錯誤狀態：

- `EVENT_HANDLE_LIFETIME_EXPIRED`
- `EVENT_DEVICE_STREAM_MISMATCH`
- `IMPORTED_EVENT_NOT_PRODUCER_TIMELINE`
- `CONSUMER_READ_BEFORE_WAIT`
- `LEASE_CHANGED_DURING_TRANSFER`
- `HOST_SYNC_FALSE_READINESS`
- `ORDERING_CAPABILITY_UNAVAILABLE`

---

# Code / GitHub

## LMCache

值得繼續讀：

- `docs/design/v1/platform/base/event_ipc_abstraction.md`
- `lmcache/v1/platform/base/event_ipc.py`
- `lmcache/v1/platform/devices/cuda/`
- `lmcache/integration/vllm/vllm_v1_adapter.py`
- LMCache MP worker/server future implementation

current design已明確把 Event IPC視為跨 process shared-KV ordering primitive。

## vLLM

下一輪應追：

- `vllm/distributed/kv_transfer/kv_connector/v1/lmcache_mp_connector.py`
- NIXL worker transfer completion
- Mooncake receive worker
- connector model-runner hooks

current vLLM LMCache MP connector會建立 interprocess CUDA event、record後交給 worker adapter，說明 event IPC已位於真實 serving hot path。

---

# Papers

## 1. ObjectCache: Layerwise Object-Storage Retrieval for KV Cache Reuse

- Authors: Yu Zhu, Aditya Dhakal, Yunming Xiao, Dejan Milojicic, Gustavo Alonso
- Year: 2026
- Architecture: S3-compatible object storage + NIXL + layer-consumption-ordered retrieval
- Contribution: storage server依 GPU layer消費順序送 KV，將 remote retrieval與 compute overlap
- Result: 64K context相對 local DRAM只增加約 5.6% latency；共享 bandwidth下 scheduler將額外 TTFT降低約1.2–1.8×
- Limitation: layerwise overlap仍需要正確的 transfer/readiness ordering substrate；論文本身不是逐 CUDA event provenance verifier。

## 2. Accelerating LLM Inference Throughput via Asynchronous KV Cache Prefetching

- Authors: Yanhao Dong, Yubo Miao, Weinan Li, Xiao Zheng, Chao Wang, Jiesheng Wu, Feng Lyu
- Institution: Alibaba Cloud / Central South University
- Venue/Year: AAAI 2026
- Architecture: computation-load overlap + KV→GPU L2 proactive prefetch
- Contribution:利用 active computation window 的 idle memory bandwidth預取 KV到 L2
- Reported result: attention kernel efficiency 2.15×、end-to-end throughput最高1.97×
- Limitation: performance-oriented prefetch並不等同 semantic provenance；Hermes仍需知道被prefetch的 KV generation與實際 consumer ordering。

## 3. Cache-to-Cache: Direct Semantic Communication Between Large Language Models

- Authors: Tianyu Fu et al.
- Venue: ICLR 2026
- Architecture: source-model KV → learned projection/fusion → target-model KV
- Contribution: KV不再只是 inference cache，而成為 model-to-model semantic communication medium
- Reported result:相較 text communication平均 latency約2.5× speedup，並報告 accuracy提升
- Limitation:跨模型 KV semantics改寫後，`SemanticContentLineage` 不能等同 raw physical cache lineage。

---

# 與歷史研究比較

上一輪已建立：

`ConnectorReadinessCapability → DeviceReadinessWitness`。

本輪把最淺節點從「connector是否 wait」推進到：

`跨 process event是否真的保留 producer timeline + consumer stream是否真的 wait`。

因此沒有重複 scheduler readiness、KV lease或 CUDA Graph identity，而是補上真正的 inter-process device ordering substrate。

---

# Unknown / Open Questions

1. LMCache current CUDA `TimelineSemaphoreEventIPCBackend` 與 default `torch.cuda.Event` backend，在 lifetime、multi-device與failure semantics上有何精確差異？
2. NIXL / Mooncake在 GPUDirect RDMA完成時，使用的 completion primitive能否直接建立 device-side happens-before，還是仍需 host progress → CUDA event bridge？
3. 在 P/D disaggregation + TP/DP/EP 下，event identity應如何跨 rank合併成 `GlobalKVTransferEpoch`？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

- `CrossProcessDeviceHappensBefore`
- `EventIPCBackendCapability`
- `ProducerEventRecordWitness`
- `IPCEventExportWitness`
- `IPCEventImportWitness`
- `ProducerTimelineIdentity`
- `EventLifetimeEpoch`
- `ConsumerStreamWaitWitness`
- `CrossProcessReadableKVWitness`
- `CompletionEventWitness`
- `OrderingCapabilityFailureState`
- `FabricatedEventFalseReadinessState`
- `EventDeviceStreamMismatchState`

## Edges

```text
ProducerKVWrite
→ ProducerEventRecordWitness
→ IPCEventExportWitness
→ IPCEventImportWitness
→ ConsumerStreamWaitWitness
→ PostWaitKVRead

ProducerTimelineIdentity
→ preserved_by
→ IPCEventImportWitness

EventLifetimeEpoch
→ constrains
→ IPCEventImportWitness

CrossProcessDeviceHappensBefore
→ required_for
→ StrongCrossProcessReadableKVClaim

HostSynchronization
--does_not_prove→ CrossProcessDeviceHappensBefore

IPCHandleBytes
--does_not_prove→ EventLifetimeValid

TransferFutureResolved
--does_not_prove→ ConsumerStreamOrdered
```

---

# 下一輪研究

```text
LMCache CUDA EventIPC backend
→ TimelineSemaphoreEventIPCBackend
→ event lifetime ownership
→ MP server/future exact wait path
→ NIXL completion primitive
→ Mooncake RDMA completion primitive
→ host/device completion bridge
→ GlobalKVTransferEpoch
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

- **缺哪一層：** GPUDirect/NIXL/Mooncake completion → CUDA consumer-stream ordering 的 backend-specific bridge。
- **哪個節點最淺：** `CrossProcessReadableKVWitness` 已有 LMCache Event IPC強證據，但尚未統一所有 connector/backend。
- **哪個概念仍只是名詞：** `GlobalKVTransferEpoch`，尤其跨 TP/DP/EP rank。
- **哪個系統最值得讀原始碼：** LMCache `TimelineSemaphoreEventIPCBackend` + MP server/future，再對照 NIXL/Mooncake。
- **哪篇論文需追引用：** ObjectCache，因為它直接把 NIXL、layerwise retrieval與 storage scheduling接在一起。
- **哪個概念最適合視覺模擬：** Cross-Process KV Happens-Before Microscope。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Cross-Process Ordering Verifier + Residency/Lease Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。

本輪把「KV 已傳到另一個 process」再拆深一層：真正的 correctness boundary不是 host看到 transfer完成，而是 consumer GPU stream取得一條可驗證、保留 producer timeline identity 的 happens-before edge，並且在這條 edge成立後才發生 KV read。這是把 Runtime KV provenance從 scheduler/connector語義推進到跨 CUDA context ordering語義的關鍵一步。