# 【AI Agent × Multimodal Research Report】

**時間：2026-09-20 02:55（Asia/Taipei）**  
**本輪主題：ATen H2D Current Stream × Pinned Host Lifetime × CUDA Graph Consumer Boundary**

## 與歷史研究比較

上一輪已建立 `BlockTableContentEpoch → non_blocking H2D → ConsumerScopedVisibilityWitness → CUDA Graph consumer`，但最淺節點仍是：vLLM `gpu.copy_(..., non_blocking=True)` 究竟落在哪一條 CUDA stream，以及 copy 與 graph replay 的 ordering 如何構成可驗證的 happens-before。本輪不重複 block-table、KV lease、PagedAttention、graphId/nodeId，而直接向下追 PyTorch/ATen CUDA copy implementation 與 CUDA Graph stream semantics。

## 本小時新發現

1. PyTorch current CUDA semantics：CUDA stream 是 device 上的線性 execution sequence；同一 stream 內 operation 按 enqueue order 序列化，不同 streams 若沒有 explicit synchronization 則可以任意相對執行。CUDA Graph replay 可在任意 stream 上執行，但 graph 內 multi-stream DAG 的 replay 排程可被重組，只保證原 DAG dependencies。
2. ATen `aten/src/ATen/native/cuda/Copy.cu` 明確使用 `getCurrentCUDAStream(...)` 決定 CUDA copy stream；可直接 memcpy 的 device copy 走 `CUDACachingAllocator::memcpyAsync(...)`，跨 device 時用 CUDA events 建立兩向 stream barrier。
3. PyTorch 2026 pinned-memory allocator說明指出：真正可 overlap 的 H2D async copy 需要 pinned host memory；`gpu_tensor.copy_(cpu_pinned, non_blocking=True)` 返回時 DMA 仍可能 in-flight，因此 host buffer lifetime 不能用 Python call return 判斷。allocator 會對 host block + storage context 記錄 CUDA event，以避免 DMA 尚未完成就重用 pinned block。
4. CUDA Graph static-input pattern 的官方 PyTorch 語義是：graph replay 每次讀相同 virtual addresses；若要使用新 input，必須先把新資料 copy 到 capture 的 static input tensor，再 replay graph。這直接支持 Hermes 的 `StaticBufferIdentity ≠ BufferContentEpoch` 模型。
5. CUPTI 13.4 的 memcpy activity 提供 start/end、streamId、correlationId；graph node activity可提供 graphId/graphNodeId。故 `H2D completion → replay consumer` 可以用 activity timeline + stream/dependency evidence閉合，而不必把 Python return time 當完成時間。

## 本小時最重要 5 個發現

### 1. Current CUDA stream 是 copy provenance 的一級 identity
**已確認事實 / 原始碼：** ATen CUDA copy implementation會取得 current CUDA stream；因此 `copy_()` 的 semantic provenance 必須記錄 call 當下的 current-stream identity，而不是只記 destination pointer。

**底層：**
`ATen copy_ → current CUDA stream → cudaMemcpyAsync/copy kernel → stream-ordered completion`。

**重要性：** 同一 static GPU pointer 若不同 iteration 的 H2D 在不同 stream，consumer visibility rules 會不同。

**限制：** 本輪 source closure 尚未等於某次 Hermes/vLLM inference 的 CUPTI observed stream。

### 2. non_blocking=True 是 host-asynchrony，不等於 consumer-ready
**官方資訊：** PyTorch說明 `non_blocking=True` 嘗試讓 conversion 對 host 非同步；跨 non-default stream 時 caller 仍負責 synchronization。

**底層：**
`CPU enqueue → DMA in-flight → API return` 可以發生在 transfer completion 前。

**重要性：** `copy_ returned` 不能成為 `GPUVisible` witness。

### 3. Pinned host buffer 自己也需要 lifetime provenance
**工程實作：** PyTorch pinned-memory allocator會對 async transfer涉及的 host allocation記錄 CUDA event；buffer 只有在 copy completion 後才能安全 reuse。

因此新增：
`HostPinnedBufferIdentity → HostBufferLease → H2DTransfer → HostReuseFence`。

這是前幾輪只追 GPU static buffer 時漏掉的另一半 temporal provenance。

### 4. CUDA Graph replay 的 stream identity不能由 capture stream推斷
**官方資訊：** PyTorch CUDA Graph可以在任意 stream replay；capture 的 multi-stream DAG在 replay時可被重新安排，只需保持 dependency DAG。

所以：
`CaptureStreamIdentity ≠ ReplayStreamIdentity`。

真正需要的是每次 replay 的 `GraphReplayStreamWitness`，再判斷 H2D producer 與 replay consumer是否同 stream或有 event/dependency edge。

### 5. Consumer-scoped visibility可以形成可機器驗證的判定式
對 ContentEpoch E：

`VISIBLE_TO_CONSUMER(E,C) = H2D_COMPLETE(E) AND (same_stream_order OR event_wait OR graph_dependency OR stronger_sync)`

若只有 H2D submit，標 `H2D_IN_FLIGHT`；若 transfer已完成但 consumer ordering未知，標 `CONSUMER_ORDER_UNPROVEN`；若 consumer開始早於合法 happens-before，標 `STALE_DYNAMIC_INPUT_EPOCH`。

## Architecture Breakdown

```text
SchedulerOutput
  ↓
CPU BlockTable E204
  ↓
PinnedHostBuffer Lease H17
  ↓
ATen copy_(non_blocking=True)
  ↓
CurrentCUDAStream S_copy
  ↓
cudaMemcpyAsync / copy path
  ↓
CUPTI Memcpy Activity M449
  ↓
H2D completion timestamp
  ↓
HostReuseFence satisfied
  ↓
GPU Static Buffer ptr P
  ↓
GPU ContentEpoch E204
  ↓
[same stream / event / dependency]
  ↓
CUDA Graph Replay R89 on S_replay
  ↓
graphId G12 / graphNodeId N57
  ↓
Attention consumer
  ↓
BlockTable E204 consumed
  ↓
Physical KV block lookup
```

## Bottom-Level Logic

### H2D producer

```text
CPU semantic state
→ pinned allocation/storage context
→ copy_ enqueue
→ current stream lookup
→ async transfer activity
→ transfer completion
→ host source reuse becomes legal
```

### Graph consumer

```text
static GPU address
→ dynamic ContentEpoch
→ replay enqueue on replay stream
→ graph dependency DAG
→ attention graph node
→ dynamic input read
```

### Evidence gate

```text
if memcpy.end <= consumer.start and dependency is proven:
    RUNTIME_CONTENT_EPOCH_BOUND
elif producer_stream == consumer_stream and enqueue order is proven:
    RUNTIME_CONTENT_EPOCH_BOUND
else:
    CONSUMER_ORDER_UNPROVEN
```

注意：單純比較 timestamps不是完整同步證明；真正的強證據是 stream-order/event/graph dependency，加上 CUPTI activity timestamps 做 runtime observation。

## Visual Simulation Idea

### H2D → CUDA Graph Happens-Before Microscope

三條主要 lane：

```text
CPU / Pinned Host
E204 prepared ─ copy_ call ─ API return ───── host buffer reusable
                    │                            ↑
Copy Stream         └─ M449 H2D =================● completion
                                                  │
Graph Stream                                      ├─ dependency
                                                  ↓
                                            Replay R89
                                                  ↓
                                             Node N57
                                                  ↓
                                         Attention reads E204
```

互動功能：點 `E204` 顯示 host buffer lease、storage context、producer stream、CUPTI memcpy correlation、completion、replay stream、graphId/nodeId、consumer verdict。若 host buffer 在 DMA completion 前被 reuse，顯示 `HOST_BUFFER_REUSE_RACE`。

## Code / GitHub

### PyTorch
- `aten/src/ATen/native/cuda/Copy.cu`
- `c10/cuda/CUDAStream.h`
- CUDA caching/pinned host allocator相關 implementation

值得繼續看的核心：CPU↔GPU branch 中 `cudaMemcpyAsync`、`record_event` 與 pinned allocator reuse fence。

### vLLM
下一輪需把 current stream witness接回：
- block-table `commit_block_table()`
- `gpu_model_runner.py`
- CUDA Graph wrapper/replay
- attention backend launch

## Papers / Technical Sources

本輪主要是 runtime/source investigation，沒有用產品新聞替代底層證據。

1. **PyTorch CUDA semantics** — PyTorch documentation, updated 2026-09-05.  
   URL: https://docs.pytorch.org/docs/main/notes/cuda.html  
   Contribution: stream ordering、CUDA Graph static addresses/replay semantics。  
   Limitation: framework-level semantics，不是 vLLM specific runtime trace。

2. **Pinned memory: what it is for, and why nobody gives it back** — PyTorch DevLog, 2026-08-09.  
   URL: https://docs.pytorch.org/devlogs/eager/2026-08-09-pinned-memory-allocator/  
   Contribution: pinned allocator、async DMA lifetime、record_event reuse protection。  
   Limitation: engineering explanation，不是 formal verification。

3. **CUPTI 13.4 Activity API** — NVIDIA, 2026.  
   URL: https://docs.nvidia.com/cupti/13.4.0/api/structCUpti__ActivityMemcpy7.html  
   Contribution: memcpy timing/stream/correlation + graph lineage fields。  
   Limitation: 要真正執行 profiler 才能得到 Hermes runtime witness。

## Unknown / Open Questions

1. vLLM block-table H2D 的 `copy_` 在實際 model-runner context 中，current stream 是否與 `CUDAGraph.replay()` 的 replay stream完全相同？若不同，具體 wait/event edge在哪裡建立？
2. block-table CPU backing buffer是否始終 pinned？不同 configuration 是否可能走 pageable/staging path，改變 overlap與 completion semantics？
3. CUDA Graph replay 時 attention node對 dynamic block-table static buffer的 read，能否用 CUPTI node trace + external correlation精確綁定到 Hermes `ContentEpoch`，且 profiler overhead可接受？

## Knowledge Graph 新增 Node / Edge

### Nodes
- `ATenCurrentCUDAStreamWitness`
- `PinnedHostBufferIdentity`
- `HostBufferLeaseIdentity`
- `HostReuseFenceWitness`
- `H2DDMAActivityWitness`
- `GraphReplayStreamWitness`
- `CaptureStreamIdentity`
- `ReplayStreamIdentity`
- `ConsumerScopedVisibilityPredicate`
- `HostBufferReuseRaceState`
- `RuntimeContentEpochBound`

### Edges
- `BlockTableContentEpoch --staged_in--> PinnedHostBufferIdentity`
- `PinnedHostBufferIdentity --leased_as--> HostBufferLeaseIdentity`
- `HostBufferLeaseIdentity --submitted_on--> ATenCurrentCUDAStreamWitness`
- `ATenCurrentCUDAStreamWitness --executes--> H2DDMAActivityWitness`
- `H2DDMAActivityWitness --completion_releases--> HostReuseFenceWitness`
- `H2DDMAActivityWitness --publishes--> GPUContentEpoch`
- `GPUContentEpoch --ordered_before--> GraphReplayStreamWitness`
- `GraphReplayStreamWitness --executes--> GraphNodeExecutionWitness`
- `ConsumerScopedVisibilityPredicate --gates--> RuntimeContentEpochBound`

## 本輪結束判定

**缺哪一層：** vLLM實際 `ATen current stream → graph replay stream` 的 runtime observed dependency edge。  
**哪個節點最淺：** `GraphReplayStreamWitness` 的實測 instance。  
**哪個概念仍只是名詞：** `RuntimeContentEpochBound` 尚未由同一次真實 inference 的 CUPTI trace實測閉合。  
**哪個系統值得讀原始碼：** PyTorch ATen CPU↔CUDA copy branch + vLLM CUDA Graph runner。  
**哪篇論文/資料需追引用：** PyTorch CUDA Graph/static input semantics與 CUPTI 13.4 per-node tracing；下一輪再追 CUDA Graph execution determinism / serving runtime instrumentation研究。  
**哪個概念最適合視覺模擬：** H2D → CUDA Graph Happens-Before Microscope。  
**哪個 Agent 架構最值得實作：** `State-grounded Planner + Provenance Runtime + PreAction Verifier`；把 model reasoning與system/runtime evidence分開。

## 下一輪研究

```text
vLLM commit_block_table
→ exact torch Tensor.copy_ call context
→ current CUDA stream identity
→ pinned/pageable source classification
→ CUPTI memcpy correlation
→ H2D completion
→ CUDAGraph.replay stream
→ event/stream/graph dependency
→ graphId + graphNodeId
→ RuntimeContentEpochBound
→ controlled sham KV intervention
→ zero/replace KV
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔAgent Action
```

## 本輪結論

研究鏈現在從「GPU visibility」再往下拆成了兩個必須同時成立的 provenance：**host-side source lifetime** 與 **device-side consumer ordering**。同一個 static GPU address只有在某個 `ContentEpoch` 的 H2D transfer完成、host buffer沒有被過早重用，且該 epoch對特定 CUDA Graph consumer存在可證明 happens-before 時，才能宣稱 attention node讀到的是那一代 scheduler semantics。這比把 `copy_()` return、GPU pointer或 graph replay任一單點當成證據更接近真正可驗證的 AI runtime provenance。