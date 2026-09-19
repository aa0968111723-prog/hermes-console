# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-20 03:51（Asia/Taipei）

## 本小時研究主題
**CUDA Consumer Ordering × Runtime Trace Contract：從 H2D current-stream 語義推進到可驗證的 Graph Consumer happens-before 證據**

本輪延續上一輪 `ATen H2D Current Stream × Pinned Host Lifetime × CUDA Graph Consumer Boundary`，避免重複解釋 PagedAttention、KV block identity 與 CUDA Graph static-address semantics。本輪專注補齊目前最淺節點：**如何把 BlockTable / slot-mapping 的 H2D transfer 與某次 CUDA Graph replay 中的 attention consumer 建成可機器驗證的 happens-before contract。**

---

## 本小時新發現

1. **CUDA 的正確證據單位不是「GPU visible」而是 consumer-scoped happens-before。** `cudaMemcpyAsync` 對 host 非同步；對 pinned/page-locked host memory 才能真正非同步。資料能否安全被後續 kernel 使用，取決於 stream ordering 或顯式 synchronization，而非 Python `copy_()` 返回時間。
2. **同 stream 是最強、最便宜的 ordering witness。** CUDA stream 本身是有序操作序列；若 H2D 與 graph replay/consumer 在同一 stream，enqueue order 可建立 transfer-before-consumer。
3. **跨 stream 必須建立同步邊。** 合法 witness 可以是 CUDA event record/wait、graph dependency、stream synchronization 或更強同步；若只知道兩個 timestamp 先後，仍不足以證明 dependency semantics。
4. **CUPTI 13.4 已具備建立 runtime contract 所需的大部分 primitive。** Memcpy activity 提供 start/end、streamId、correlationId；Graph trace 提供 graph launch 的 correlationId、graphId、streamId；per-node trace 可用 graphId + graphNodeId；CUDA event activity可提供 eventId、streamId 與 deviceTimestamp。
5. **因此下一步不應再擴充抽象名詞，而應實作 trace collector + verifier。** Hermes Console 可以把 semantic epoch、CUPTI memcpy、event/sync、graph replay、graph node、kernel activity收斂成一張 runtime provenance DAG，對每次 attention read輸出 VERIFIED / UNPROVEN / STALE 三態。

主要官方來源：
- NVIDIA CUDA Programming Guide, Asynchronous Execution: https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/asynchronous-execution.html
- CUDA Runtime API, cudaMemcpyAsync: https://docs.nvidia.com/cuda/cuda-runtime-api/group__CUDART__MEMORY.html
- CUPTI 13.4 Usage / CUDA Graph tracing: https://docs.nvidia.com/cupti/main/main.html
- CUPTI `CUpti_ActivityMemcpy7`: https://docs.nvidia.com/cupti/13.4.0/api/structCUpti__ActivityMemcpy7.html
- CUPTI `CUpti_ActivityGraphTrace`: https://docs.nvidia.com/cupti/13.4.0/api/structCUpti__ActivityGraphTrace.html
- CUPTI `CUpti_ActivityCudaEvent2`: https://docs.nvidia.com/cupti/13.4.0/api/structCUpti__ActivityCudaEvent2.html

---

## 本小時最重要 5 個發現

### 1. ConsumerScopedVisibility 才是正確 invariant
**已確認事實 / 官方語義。** `cudaMemcpyAsync()` 可在 host call 返回後仍持續執行。CUDA Programming Guide 明確要求應用必須透過同步判定 transfer 完成後再安全使用結果。

底層：
`CPU Epoch → H2D enqueue → DMA/copy activity → completion → ordering edge → consumer`。

建議 Hermes invariant：

```text
VISIBLE_TO(E, C) :=
  H2D_COMPLETE(E)
  AND (
    SAME_STREAM_ORDER(E, C)
    OR EVENT_DEPENDENCY(E, C)
    OR GRAPH_DEPENDENCY(E, C)
    OR STRONGER_SYNC(E, C)
  )
```

限制：只有 wall-clock `memcpy.end < kernel.start` 不代表程式上一定建立 dependency；它可作觀測證據，但不能取代 ordering edge。

### 2. CUPTI Memcpy activity 可以給 H2D runtime identity
**已確認事實 / 官方資訊。** `CUpti_ActivityMemcpy7` 可帶 runtime correlation ID，並提供 graphId/graphNodeId（若 memcpy 由 graph 執行）；其他 memcpy activity structures 提供 start/end、streamId、contextId、deviceId。

這讓 Hermes 可以建立：

```text
H2DActivityWitness {
  semantic_epoch,
  correlation_id,
  runtime_correlation_id,
  stream_id,
  context_id,
  start_ns,
  end_ns,
  bytes,
  src_kind,
  dst_kind
}
```

限制：CUPTI 本身不知道 `semantic_epoch` 是哪個 scheduler step；這個 mapping 必須由 Hermes instrumentation / external correlation / NVTX-like semantic marker補上。

### 3. CUDA Graph replay 有自己的 stream identity
**已確認事實 / 官方資訊。** `CUpti_ActivityGraphTrace` 提供 graph launch correlationId、graphId、contextId、streamId、start/end。故不能只保存 capture stream；每次 replay 都應建立 `GraphReplayEpoch`。

```text
GraphReplayWitness {
  replay_epoch,
  graph_id,
  launch_correlation_id,
  stream_id,
  start_ns,
  end_ns
}
```

限制：graph-level trace不提供 node 細節；若要定位 attention node，需要 per-node tracing / kernel activity。

### 4. CUDA Event 可以把跨-stream ordering 變成第一級 Knowledge Graph edge
**已確認事實 / 官方資訊。** CUPTI CUDA Event activity可記錄 eventId、record stream、device timestamp；synchronization activity可追 event/stream synchronization。

因此 edge 不應只叫 `happened_before`，而應保留 witness：

```text
H2DCompletion
  --[event_record:E77 on stream S_copy]-->
CUDAEvent E77
  --[stream_wait_event on S_graph]-->
GraphReplay R204
```

若找不到同-stream order或任何 event/sync/graph dependency，狀態必須是 `CONSUMER_ORDER_UNPROVEN`。

### 5. 下一個真正工程產物應是 Runtime Provenance Verifier
**工程推論，基於上述官方 primitive。** 目前研究已足以停止新增純概念節點，開始做可執行 verifier：輸入 semantic epochs + CUPTI activities，輸出每個 attention consumer是否讀到正確 dynamic-input epoch。

判定：

```text
VERIFIED
  = epoch mapped + H2D observed + legal ordering edge + consumer observed

UNPROVEN
  = consumer observed but ordering edge missing

STALE
  = consumer bound to older epoch or replay before required visibility

AMBIGUOUS
  = static address reused but semantic epoch mapping missing
```

---

## Architecture Breakdown

```text
Scheduler Step / Request Set
  ↓
BlockTable CPU Content Epoch E204
  ↓
Pinned Host Buffer Lease H33
  ↓
ATen/PyTorch copy_(non_blocking=True)
  ↓
CUDA Current Stream S_copy
  ↓
CUPTI H2D Activity M449
  ↓
H2D completion
  ↓
[Ordering Proof]
  ├─ same stream
  ├─ CUDA event record/wait
  ├─ graph dependency
  └─ stronger synchronization
  ↓
CUDA Graph Replay R89 / stream S_graph
  ↓
graphId G12
  ↓
graphNodeId N57
  ↓
Attention Kernel Activity K882
  ↓
BlockTable E204 consumed
  ↓
physical KV block/slot
  ↓
K/V load
```

### System architecture：Runtime Provenance Verifier

```text
Semantic Instrumentation
        │
        ├── scheduler_step_id
        ├── content_epoch
        ├── request_ids
        └── content_hash
        ↓
Trace Collector
        ├── CUPTI Runtime/Driver API
        ├── Memcpy Activity
        ├── CUDA Event Activity
        ├── Synchronization Activity
        ├── Graph Trace
        └── Kernel / graph-node activity
        ↓
Correlation Engine
        ↓
Happens-Before DAG
        ↓
Verifier
        ├── VERIFIED
        ├── UNPROVEN
        ├── STALE
        └── AMBIGUOUS
        ↓
Hermes Knowledge Graph / UI
```

---

## Bottom-Level Logic

### Mechanism：H2D → consumer happens-before closure

1. Scheduler 產生新的 block-table semantic content `E_n`。
2. CPU/pinned buffer被填入 E_n，記錄 hash 與 request set。
3. `copy_(non_blocking=True)` 把 transfer enqueue 到當前 CUDA stream。
4. CUPTI 捕捉對應 memcpy activity，取得 correlation、stream、start/end。
5. 找到 consumer graph replay 的 graph launch activity與 replay stream。
6. 若 `copy.stream == replay.stream`，使用 stream enqueue order建立 edge。
7. 若不同 stream，搜尋 event record/wait、synchronization 或 graph dependency。
8. 找到 graphId/nodeId對應 attention kernel。
9. 將 attention kernel綁到 `E_n`，建立 `RuntimeContentEpochBound`。
10. 若沒有合法 ordering witness，不升級證據等級。

這一層的核心不是「copy 快不快」，而是 **semantic data version 是否在 consumer 執行前具有可證明的 GPU ordering。**

---

## Visual Simulation Idea

### Dynamic Input Happens-Before Verifier

三條主要 lane：

```text
CPU / Scheduler
E204 prepared ───── content_hash H204
        │
Pinned Host
Lease H33 ────────────────┐
                          │
GPU Copy Stream S7        ↓
                   M449 H2D ████████ done
                                  │ event E77
                                  └──────────────┐
                                                 ↓ wait(E77)
GPU Graph Stream S2                       Replay R89
                                             │
                                             └─ G12/N57 Attention
                                                    │
                                                    └─ KV Read
```

互動功能：點擊任一 visual token / sequence slot後，沿 provenance一路展開到 semantic epoch、memcpy correlation、stream、event、graph replay、graph node與 physical KV read。

警示：
- `CONSUMER_ORDER_UNPROVEN`
- `STALE_DYNAMIC_INPUT_EPOCH`
- `STATIC_ADDRESS_DYNAMIC_CONTENT`
- `HOST_BUFFER_REUSE_RACE`
- `GRAPH_NODE_SEMANTICS_UNBOUND`

---

## Code / GitHub

### vLLM
Repository: https://github.com/vllm-project/vllm

本輪值得繼續看的路徑：
- `vllm/v1/worker/gpu_model_runner.py` — scheduler output、dynamic input preparation、CUDA graph dispatch入口。
- `vllm/v1/worker/block_table.py` — block-table CPU/GPU representation、commit與slot mapping。
- `vllm/compilation/cuda_graph.py` — capture/replay lifecycle與static input addresses。
- `vllm/utils/torch_utils.py` — H2D helper與current stream相關工具。
- attention backend / Triton unified attention — block-table consumer與exact K/V loads。

本輪原始碼閱讀的新工程訊號：`gpu_model_runner.py` current main 同時匯入 `async_tensor_h2d`、`CUDAGraphWrapper`、`BatchDescriptor`、offloader與attention backend，顯示 dynamic H2D、graph dispatch、KV/offload與attention execution確實在同一 model-runner orchestration boundary匯合；但這仍不是實測 stream correlation，必須由 profiler trace補足。

### PyTorch
- https://github.com/pytorch/pytorch/blob/main/aten/src/ATen/native/cuda/Copy.cu

需追：current stream selection、pinned/pageable host path、`cudaMemcpyAsync`/copy kernel dispatch、allocator event/lifetime handling。

---

## Papers / Technical References

本輪核心是 runtime semantics，因此以官方技術文件為主；未把一般產品文章當證據。

1. **CUDA Programming Guide — Asynchronous Execution**
   - Institution: NVIDIA
   - URL: https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/asynchronous-execution.html
   - Contribution: 定義 stream ordering、async copy、pinned memory與 synchronization semantics。
   - Limitation: 不知道 vLLM semantic epoch。

2. **CUPTI 13.4 — CUDA Graph tracing / Activity API**
   - Institution: NVIDIA
   - Year: 2026 current docs
   - URL: https://docs.nvidia.com/cupti/main/main.html
   - Contribution: graphId、graphNodeId、source graph lineage、kernel/memcpy/event trace primitive。
   - Limitation: semantic request/content identity需要上層 instrumentation。

3. **PagedAttention / Efficient Memory Management for LLM Serving with PagedAttention**
   - Authors: Woosuk Kwon et al.
   - Institution: UC Berkeley / collaborators
   - Year: 2023
   - Architecture: paged KV cache + continuous serving
   - Code: https://github.com/vllm-project/vllm
   - Contribution: 把 logical KV sequence映射到可非連續 physical blocks。
   - Limitation: 論文本身不是 runtime causal provenance system。

---

## 與歷史研究比較

前幾輪已完成：

```text
Pixel
→ Vision Patch
→ Visual Token
→ Sequence Slot
→ Logical KV
→ Physical KV Block/Slot
→ KV Lease Epoch
→ Transfer Completion
→ CUDA Graph Static Buffer
→ BlockTable Content Epoch
→ H2D Current Stream
```

本輪新增的不是另一個 memory identity，而是把：

```text
H2D Current Stream
→ Ordering Witness
→ Graph Replay Stream
→ graphId/nodeId
→ ConsumerScopedVisibility
```

定義成**可驗證 runtime contract**。

---

## Unknown / Open Questions

1. **同一次真實 vLLM inference 中，block-table H2D 與 graph replay實際是否總在同一 stream？** Source semantics不足以回答，需 CUPTI trace。
2. **若不同 stream，vLLM/PyTorch的實際 dependency 是 event、legacy/default-stream semantics、graph dependency，還是其他同步？** 必須實測，不可推測。
3. **如何把 scheduler semantic epoch無歧義映射到 CUPTI correlation ID？** 建議實作 external correlation / NVTX semantic range或自有 trace side-channel。

---

## 下一輪研究

優先不再做純 source reading，而是設計/實作最小 runtime trace harness：

```text
scheduler_step_id
→ content_epoch + hash
→ semantic marker / external correlation
→ H2D CUPTI activity
→ streamId + completion
→ event/sync activity
→ graph launch correlation
→ graphId + replay stream
→ graphNodeId
→ attention kernel
→ RuntimeContentEpochBound
```

之後才進入受控 causal experiment：

```text
Baseline
→ Sham KV write-back
→ Zero selected visual-token KV
→ Replace selected KV
→ ΔAttention output
→ ΔResidual
→ ΔLogits
→ ΔGenerated token
→ ΔAgent action
```

必須固定 model、weights、precision、attention backend、batch/sequence geometry與sampling條件，避免把 numerical path差異誤判為 causal effect。

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `H2DActivityWitness`
- `GraphReplayWitness`
- `ConsumerScopedVisibilityPredicate`
- `ConsumerOrderingProof`
- `CUDAEventRecordWitness`
- `CUDAEventWaitWitness`
- `RuntimeContentEpochBound`
- `SemanticEpochCorrelationWitness`
- `RuntimeProvenanceVerifier`
- `RuntimeProvenanceVerdict`

### Edges
- `BlockTableContentEpoch --submitted_as--> H2DActivityWitness`
- `H2DActivityWitness --ordered_before--> GraphReplayWitness`
- `CUDAEventRecordWitness --synchronizes_with--> CUDAEventWaitWitness`
- `GraphReplayWitness --executes--> GraphNodeExecutionWitness`
- `GraphNodeExecutionWitness --consumes--> RuntimeContentEpochBound`
- `RuntimeContentEpochBound --authorizes--> RuntimeKVReadWitness`

### Evidence states
- `VERIFIED_RUNTIME_ORDER`
- `CONSUMER_ORDER_UNPROVEN`
- `STALE_DYNAMIC_INPUT_EPOCH`
- `SEMANTIC_EPOCH_AMBIGUOUS`

---

## 本輪結論

- **缺哪一層：** 真實 vLLM run 的 CUPTI H2D→graph replay ordering trace。
- **哪個節點最淺：** `SemanticEpochCorrelationWitness` / `ConsumerOrderingProof` 的實測 instance。
- **哪個概念仍只是名詞：** `RuntimeContentEpochBound` 尚未由本環境實際 GPU trace證明。
- **哪個系統值得讀原始碼：** PyTorch ATen CUDA copy path + vLLM CUDA Graph runner + attention backend。
- **哪篇論文/文件需追引用：** CUDA/CUPTI graph tracing與 PagedAttention serving-runtime後續研究。
- **哪個概念最適合視覺模擬：** Dynamic Input Happens-Before Verifier。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + PreAction Evidence Gate + Tool Executor`。

最終鏈目前推進為：

```text
UI
→ Pixel
→ Vision Encoder / Visual Token
→ LLM Sequence Slot
→ Logical KV
→ Physical KV Lease
→ BlockTable Content Epoch
→ H2D Activity
→ Consumer Ordering Proof
→ CUDA Graph Replay
→ Attention Graph Node
→ Exact KV Read
→ [Controlled Causal Intervention]
→ Logit
→ Reasoning / Tool Decision
→ Agent Action
```

**本輪最重要的修正：不是問「資料是否已在 GPU」，而是問「這一代資料是否有一條可驗證的 happens-before 路徑，到達這一次具體的 attention consumer」。這是從 GPU memory provenance 進入真正 runtime execution provenance 的關鍵邊界。**