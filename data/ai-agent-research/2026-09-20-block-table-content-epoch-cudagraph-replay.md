# 【AI Agent × Multimodal Research Report】

**時間：2026-09-20 00:56（Asia/Taipei）**

**主題：vLLM BlockTable Content Epoch × Async H2D × CUDA Graph Replay Runtime Binding**

## 本小時新發現

本輪承接上一輪 `StaticBufferIdentity ≠ BufferContentEpoch`，不再重複 CUDA Graph identity，而是追 vLLM scheduler output 如何真正改寫 GPU block-table/slot-mapping，再讓同一組 static CUDA Graph addresses 在下一次 replay 表示新的 request/KV semantics。

### 已確認事實 / 官方與原始碼

1. vLLM `GPUModelRunner._prepare_inputs()` 一開始就呼叫 `self.input_batch.block_table.commit_block_table(num_reqs)`；原始碼註解明確說這是刻意先啟動 block-table copy，讓 H2D copy 與後續 CPU preprocessing overlap。
2. `MultiGroupBlockTable.commit_block_table()` 會對每個 KV cache group 的 `BlockTable` 呼叫 `commit_block_table()`；後者本質上是 `CpuGpuBuffer.copy_to_gpu(num_reqs)`。
3. `CpuGpuBuffer.copy_to_gpu()` 使用 `gpu.copy_(cpu, non_blocking=True)`；所以在 pinned-memory configuration 下，block-table content update 是可與 CPU work overlap 的 asynchronous H2D operation，而不是「Python 呼叫返回即代表 GPU 已讀到新內容」。
4. 同一輪 `_prepare_inputs()` 稍後用 GPU 上的 `query_start_loc` 與 `positions` 呼叫 `compute_slot_mapping()`。因此 block table 不只是 attention read lookup table，也參與 token→KV-slot mapping 的 runtime derivation。
5. vLLM 的 block table 是預先配置的 CPU/GPU buffer；在 hybrid KV manager block / kernel block size 不同時，一個 manager block 還會展開成多個 kernel blocks。因此 static tensor address、logical row、kernel block identity、content epoch 必須分開。
6. NVIDIA CUPTI 官方文件確認 CUDA API↔GPU activity 可用 `correlationId` 關聯；CUDA Graph per-node activity可額外使用 `graphId`/`graphNodeId`。CUDA 13.4 還加入 sourceGraphId/sourceGraphNodeId，用於辨識 node 的來源/更新 lineage。

### 工程推論（需 runtime trace 驗證）

vLLM 在同一 current stream 上提交 non-blocking H2D block-table copy，之後再進入 model/CUDA Graph replay 時，CUDA stream ordering 應提供 copy-before-consumer 的 happens-before；但 Hermes 尚未收集該次 memcpy activity、graph launch activity、stream ID 與 graph-node kernel activity，因此目前只能標記 `SOURCE_ORDER_EXPECTED`，不能升級為 `RUNTIME_CONTENT_EPOCH_BOUND`。

## 本小時最重要 5 個發現

### 1. BlockTable 的 semantic identity 必須帶 ContentEpoch

**概念**：同一 GPU tensor pointer 的 block table 在每輪 scheduler step 都可能被覆寫。

**底層**：SchedulerOutput → InputBatch row mutation → CPU block-table buffer → `commit_block_table()` → async H2D → static GPU block-table buffer → attention metadata/kernel。

**重要性**：CUDA Graph replay 固定 address，不固定 address 中的 semantic content。若 provenance 只記 `data_ptr`，下一輪 request 會被誤連到上一輪 KV lease。

**限制**：尚未實測 H2D memcpy 的 CUPTI timestamp/correlation。

### 2. ContentEpoch 必須在 copy submit 與 GPU visibility 間拆狀態

建議狀態機：

`CPU_PREPARED → H2D_SUBMITTED → H2D_IN_FLIGHT → GPU_VISIBLE → GRAPH_CONSUMED`

`commit_block_table()` 的 Python return 最多只能證明 submit path 已發生；GPU-visible 必須由 stream ordering/event/activity witness 證明。

### 3. BlockTable 與 SlotMapping 是兩個相連但不同的 provenance object

`block_table[request, logical_block] → physical block`；而 slot mapping 把 scheduled token positions 映射到實際 KV slot。current runner 在 block-table commit 後，以 GPU query positions 執行 `compute_slot_mapping()`。因此需要：

`BlockTableContentEpoch → SlotMappingComputationEpoch → PhysicalKVSlotWitness`

不能只追 block table 而忽略 write-side slot mapping。

### 4. CUDA Graph replay 的真正 dynamic input 是「固定 buffer + 新內容」

這輪將上一輪模型具體化為：

`StaticAddress + ContentEpoch + StreamOrder + GraphExecutionEpoch`。

CUDA Graph optimization之所以可重播，是因為 graph topology/addresses 可穩定，而 input tensor content 在 replay 前更新。這也是 Foundry 2026 所指出 CUDA Graph 與 execution context/device addresses 緊密耦合的同一類系統約束。

### 5. CUPTI 應同時抓 Memcpy 與 Graph Node，而不是只抓 Kernel

若只記 attention kernel，無法證明它消費的是哪一代 block-table contents。最小 runtime trace 應包含：

`Hermes semantic epoch → H2D memcpy activity(correlationId, stream, start/end) → graph launch(correlationId, graphId) → attention graphNodeId/kernel(start/end, stream) → source-level block-table lookup`。

## Architecture Breakdown

```text
Scheduler
  ↓ SchedulerOutput
GPUModelRunner.update_states
  ↓
InputBatch BlockTable CPU rows
  ↓
commit_block_table(num_reqs)
  ↓
CpuGpuBuffer.copy_to_gpu(non_blocking=True)
  ↓
GPU Static BlockTable Buffer
  ↓ ContentEpoch E_n
compute_slot_mapping(query_start_loc, positions)
  ↓
SlotMapping Epoch S_n
  ↓
Attention Metadata
  ↓
CUDA Graph static input addresses
  ↓
CUDAGraph.replay()
  ↓
Graph Node: Attention Kernel
  ↓
block_table[req, logical_block]
  ↓
physical KV block / slot
  ↓
K/V load
```

## Bottom-Level Logic

### Block-table update

```text
CPU row semantics:
(request_i, logical_block_j) -> physical_block_k

commit:
CPU pinned tensor
  -> non_blocking H2D copy
  -> same preallocated GPU tensor address

identity:
BlockTableBufferIdentity = stable allocation
BlockTableContentEpoch   = semantic contents for scheduler step n
```

### Token → slot

```text
position p
→ logical block = p // kernel_block_size
→ physical block = block_table[request, logical block]
→ offset = p % kernel_block_size
→ slot mapping
→ KV write/read address family
```

### Runtime closure requirement

```text
Memcpy(E_n).end
    happens-before
GraphReplay(G_n).start
    happens-before
AttentionNode(N_n).read(block_table)
```

只有三段都被 runtime witness 綁定，才可宣稱：

`BlockTableContentEpoch E_n → Runtime Attention Read`。

## Visual Simulation Idea

### BlockTable Content Epoch × CUDA Graph Replay Microscope

Console 顯示同一 static pointer 的多代內容：

```text
GPU ptr 0xABC... (stable)

E203:
Req A row0 = [91, 92, 105]
H2D M441 ─────────── done
                       ↓
Graph Replay G12/R88
                       ↓
Attention Node N57 → block 91

E204:
Req C row0 = [14, 18, 19]
H2D M449 ─────────── done
                       ↓
Graph Replay G12/R89
                       ↓
Attention Node N57 → block 14
```

同 address 但 epoch 不同時以 `STATIC_ADDRESS_DYNAMIC_CONTENT` 顯示；kernel 若落在 H2D completion 前則顯示 `CONTENT_EPOCH_RACE`；若缺 memcpy trace 則顯示 `GPU_VISIBILITY_UNPROVEN`。

## Code / GitHub

### vLLM

值得繼續讀：
- `vllm/v1/worker/gpu_model_runner.py`：scheduler output → persistent input batch → block-table commit → positions/slot mapping → forward。
- `vllm/v1/worker/block_table.py`：MultiGroupBlockTable、BlockTable、ComputeSlotMappingKernel。
- `vllm/v1/utils.py`：CpuGpuBuffer 與 non-blocking H2D copy。
- CUDA Graph manager/wrapper：static input address capture、BatchDescriptor dispatch、replay。
- attention backend：block table 作為 kernel argument 到 Triton/CUDA read。

本輪原始碼結論：`commit_block_table()` 不是 metadata-only operation，而是 dynamic scheduler state 進入 GPU attention execution 的關鍵 content-epoch boundary。

## Papers

### Foundry: Template-Based CUDA Graph Context Materialization for Fast LLM Serving Cold Start
- Authors: Xueshen Liu, Yongji Wu, Yuncheng Yao, Danyang Zhuo, Ion Stoica, Z. Morley Mao
- Year: 2026
- Architecture: offline CUDA-graph topology/context persistence + deterministic memory layout + online materialization
- Contribution: 指出 CUDA Graph 不只保存 topology，也與 device addresses、lazy-loaded kernel code 等 execution context 耦合；以 template materialization 降低 cold-start graph capture cost。
- Reported result: Qwen3-235B-A22B cold-start 由約 10 分鐘降至 3.9 秒，最高降低 99%。
- Limitation for Hermes: 研究重點是 materialization/cold start，不直接提供 request-level semantic content epoch provenance。

### AgentCompile: An LLM-Guided Compiler for Direct CUDA Inference
- Authors: Xuanzhe Li, Ziyan Weng, Zhiyu Zhu, Junhui Hou
- Year: 2026
- Architecture: compiler contracts + generated decode-critical CUDA kernels + paged KV + continuous batching + bucketed full-step CUDA Graph replay
- Contribution: 證明 CUDA Graph replay 與 paged-KV/continuous batching 可共同存在於 serving runtime。
- Reported result: 對 vLLM 約 1.04–1.16× serving speedup（論文設定）。
- Limitation for Hermes: 性能研究，不提供 token→content-epoch→graph-node causal trace。

## Unknown / Open Questions

1. `CpuGpuBuffer.copy_to_gpu(non_blocking=True)` 的 block-table H2D 在 current runner 實際使用哪個 CUDA stream；graph replay 是否必然在同 stream，或是否存在 explicit event dependency？
2. CUDA Graph static attention node 在 replay 時讀 block table 的確切 GPU-visible epoch，能否用 CUPTI memcpy end + graph node start 無侵入閉合？
3. slot-mapping kernel/metadata update與 graph replay間是否還有另一個 dynamic-buffer epoch，需要與 block-table epoch共同 version？

## 下一輪研究

```text
commit_block_table
→ CpuGpuBuffer H2D
→ actual CUDA stream
→ CUPTI Memcpy Activity
→ correlationId
→ memcpy completion timestamp
→ CUDAGraph replay launch
→ graphId / replay epoch
→ graphNodeId
→ attention kernel start
→ dynamic block-table read
→ RuntimeContentEpochBound
→ sham intervention
→ replace one block-table entry / KV slot
→ attention/logit/action delta
```

優先建立最小 instrumentation schema：

```text
RuntimeDynamicInputWitness {
  scheduler_step_id,
  request_ids,
  buffer_name,
  static_data_ptr,
  content_epoch,
  content_hash,
  h2d_correlation_id,
  h2d_stream_id,
  h2d_start_ns,
  h2d_end_ns,
  graph_id,
  graph_replay_epoch,
  graph_node_id,
  kernel_start_ns,
  kernel_end_ns
}
```

## Knowledge Graph 新增 Node / Edge

### Nodes
- `BlockTableBufferIdentity`
- `BlockTableContentEpoch`
- `BlockTableH2DSubmitWitness`
- `BlockTableGPUVisibilityWitness`
- `SlotMappingComputationEpoch`
- `SlotMappingContentEpoch`
- `DynamicInputContentHash`
- `GraphReplayEpoch`
- `RuntimeDynamicInputWitness`
- `RuntimeContentEpochBound`
- `GPUVisibilityUnprovenState`
- `ContentEpochRaceState`

### Edges
- `SchedulerOutput -> mutates -> BlockTableContentEpoch`
- `BlockTableContentEpoch -> copied_by -> BlockTableH2DSubmitWitness`
- `BlockTableH2DSubmitWitness -> establishes_when_complete -> BlockTableGPUVisibilityWitness`
- `BlockTableContentEpoch -> constrains -> SlotMappingComputationEpoch`
- `BlockTableGPUVisibilityWitness -> precedes -> GraphReplayEpoch`
- `GraphReplayEpoch -> executes -> CUPTIGraphNodeIdentity`
- `CUPTIGraphNodeIdentity -> consumes -> BlockTableContentEpoch`
- `BlockTableContentEpoch + KVLeaseEpoch -> resolves -> PhysicalKVBlockIdentity`
- `RuntimeDynamicInputWitness -> closes -> RuntimeContentEpochBound`

## 與歷史研究比較

上一輪已證明 static GPU address 與 semantic content 必須分離，並提出 `BufferContentEpochWitness`；本輪首次把該概念落到 vLLM 的實際 scheduler→CPU block table→non-blocking H2D→GPU block table→slot mapping path，因此不是重複 CUDA Graph/CUPTI 介紹，而是補上「dynamic content 到底在哪裡被寫進 static graph input」的缺口。

## 本輪結論

- **缺哪一層**：block-table H2D completion / stream ordering → CUDA Graph attention-node consumption 的實測 runtime closure。
- **哪個節點最淺**：`BlockTableGPUVisibilityWitness`。
- **哪個概念仍只是名詞**：`RuntimeContentEpochBound`，尚缺 CUPTI 實測 trace。
- **哪個系統值得讀原始碼**：vLLM GPUModelRunner + BlockTable + CpuGpuBuffer + CUDA Graph manager + attention backend。
- **哪篇論文需追引用**：Foundry；尤其 deterministic memory layout、graph execution-context materialization 的後續工作。
- **哪個概念最適合視覺模擬**：BlockTable Content Epoch × CUDA Graph Replay Microscope。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + Visual/KV Provenance + RuntimeDynamicInputWitness + PreAction Verifier + Causal Evidence Gate`。

最終鏈目前推進為：

`UI → Screenshot Pixel → Vision Patch → Visual Token → LLM Sequence Slot → Logical KV → KV Lease → Physical KV → Scheduler BlockTable ContentEpoch → GPU Visibility → CUDA Graph Replay → Attention Graph Node → KV Read → [Causal Intervention 尚待閉合] → Logit → Agent Action`。
