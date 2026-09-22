# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-22 13:52 Asia/Taipei

## 本小時主題
**CUDA Graph Persistent Buffer × Replay Generation × Pinned-Host Input Lifetime Contract**

## 與歷史研究比較
上一輪已把 CPU metadata mutation → H2D enqueue → copy completion → stream dependency → slot-mapping/attention consumer 拆開。本輪不重複 stream ordering，而是追 CUDA Graph replay 的另一個 identity 問題：graph topology 可以重用，但 replay 所讀的固定地址 buffer 內容必須屬於當前 batch generation；此外 pinned host staging buffer 在 non-blocking H2D DMA 完成前不可被下一輪 CPU preparation 覆寫。

歷史最淺節點 `DeviceMetadataDependencyWitness` 因此再拆成：

`HostStagingGeneration → H2DReadLifetime → DevicePersistentBufferGeneration → GraphReplayBinding → KernelConsumerGeneration`

---

## 本小時新發現

### 1. CUDA Graph 固定的是 execution topology / address binding，不是每輪 input semantic generation
NVIDIA CUDA Graph 文件指出 graph 參照的 external memory 必須在 graph executable lifetime 內保持有效；host buffer 的 address 被 capture，而 contents 可以在 replay 間改變。對 pinned host memory，async transfer 真正非同步，因此 CPU 在 transfer 完成前不可覆寫該 buffer。

官方來源：
- https://docs.nvidia.com/dl-cuda-graph/cuda-graph-basics/constraints.html
- https://docs.nvidia.com/cuda/archive/13.1.0/cuda-programming-guide/04-special-topics/cuda-graphs.html

**已確認事實**：graph address stability 與 buffer-content freshness 是兩個不同 contract。

新增否定 edge：
`StableCapturedAddress --does_not_prove→ CurrentReplaySemanticGeneration`

### 2. vLLM 已有明確 event protocol 保護 reused pinned CPU buffers
current vLLM `gpu_model_runner.py` 的 `synchronize_input_prep()` 在下一次 input preparation 前 `prepare_inputs_event.synchronize()`，並在 context 結束時 `prepare_inputs_event.record()`。原始碼註解直接說明原因：dummy/real steps 共用 pinned CPU tensors，而 CPU→GPU transfer 是 async；若下一輪太早覆寫，prior non_blocking H2D DMA 仍可能正在讀。

核心檔案：
- `vllm/v1/worker/gpu_model_runner.py`
- commit examined: `d50723df04f77c732c75e07d337ee81d843e014f`
- https://github.com/vllm-project/vllm/blob/d50723df04f77c732c75e07d337ee81d843e014f/vllm/v1/worker/gpu_model_runner.py

**工程實作已確認**：host staging buffer 本身存在跨 step lifetime hazard。

新增：
`PinnedHostBufferReuseSafe = PreviousDMAReadComplete ∧ NextCPUWriteAllowed`

### 3. FULL CUDA Graph replay 會讀 capture-time metadata buffers，因此內容必須重新 staging
current vLLM source 明確註解：FULL replay reads capture-time metadata buffers；dummy/capture path必須重新 staging，而不能保留 previous real batch 的 state indices。spec-decode cudagraph utility也明確指出，重用較早 capture 建立的 metadata 會讓 kernels 使用 stale buffer contents。

核心檔案：
- `vllm/v1/worker/gpu/model_runner.py`
- `vllm/v1/worker/gpu/spec_decode/autoregressive/cudagraph_utils.py`

**工程實作已確認**：CUDA Graph correctness 不只是 graph shape bucket match，還需要 persistent input buffer generation match。

新增：
`GraphReplayTopologyMatch --does_not_prove→ ReplayInputGenerationMatch`

### 4. CUDA Graph replay identity 應該包含「地址世代」與「內容世代」兩層
NVIDIA Programming Guide指出 graph allocations 在 graph lifetime中具有固定地址；Foundry 2026也指出 CUDA graph不能天真序列化，因 graph topology之外還綁定 execution context，包括 kernel arguments中的 device addresses與lazy-loaded kernel code。

論文：Foundry: Template-Based CUDA Graph Context Materialization for Fast LLM Serving Cold Start
Authors: Xueshen Liu, Yongji Wu, Yuncheng Yao, Danyang Zhuo, Ion Stoica, Z. Morley Mao
Year: 2026
URL: https://arxiv.org/abs/2604.06664
Architecture: offline graph/context template → deterministic memory layout → online materialization → rank-dependent communication patching
Contribution: 把 CUDA graph portability 問題從 topology 提升到 execution-context materialization。
Limitations: 重點是 cold start/context reconstruction，不是 request-level semantic-generation verification。

因此新增：
`CUDAReplayIdentity = GraphExecIdentity + ShapeBucketIdentity + CapturedAddressSet + PersistentBufferGeneration + BatchSemanticGeneration`

### 5. 固定 shape / CUDA Graph 可提高 determinism，但不等於 semantic freshness
CoRun 2026以 isolated prefill + fixed-shape batched decode + CUDA graphs達到 deterministic inference，顯示固定 execution shape能控制 batch-dependent kernel tiling/reduction variability；但這與「metadata是否屬於當前request/batch」是不同 correctness axis。

論文：CoRun: Padding is Simple and Efficient for Deterministic LLM Inference
Authors: Shiju Zhao et al.
Year: 2026
URL: https://arxiv.org/abs/2608.14376
Contribution: fixed-shape scheduling + CUDA Graph replay控制batch-dependent nondeterminism。
Limitations: determinism不證明 request/KV/metadata provenance正確。

新增：
`ExecutionDeterminism --does_not_prove→ SemanticGenerationCorrectness`

---

## 本小時最重要 5 個發現

1. **Persistent Buffer Generation**
   - 是什麼：固定 device/host address在不同 replay 可承載不同 batch generation。
   - 底層：capture address → replay same address → CPU/H2D更新 contents → kernels consume current bytes。
   - 為什麼重要：地址完全合法也可能是 stale metadata。
   - 限制：尚未有 production request-scoped trace id。

2. **Pinned Host DMA Read Lifetime**
   - 是什麼：non-blocking H2D期間，host staging buffer仍被DMA engine讀取。
   - 底層：CPU fill pinned buffer → async H2D enqueue → DMA read interval → completion event → CPU buffer可安全覆寫。
   - 為什麼重要：下一step CPU write可能污染上一step GPU input。
   - 來源：NVIDIA CUDA Graph constraints + vLLM `synchronize_input_prep`。

3. **Replay Input Restaging**
   - 是什麼：FULL graph replay必須把當前batch資料放回capture時固定的input buffers。
   - 底層：batch semantic state → persistent buffer staging → graph replay → fixed kernel argument address → current contents。
   - 為什麼重要：graph object正確不代表buffer內容正確。
   - 來源：vLLM FULL replay/capture comments與spec-decode capture implementation。

4. **Topology Identity ≠ Semantic Identity**
   - 是什麼：同一graph executable可服務多個runtime generations。
   - 底層：GraphExec固定kernel DAG與argument/address structure；request identity由每輪buffer contents提供。
   - 為什麼重要：Hermes verifier不能把 graph hash當成request provenance。
   - 來源：CUDA official docs + Foundry。

5. **Determinism ≠ Correct Provenance**
   - 是什麼：每次都穩定得到同一錯誤generation仍然可以完全deterministic。
   - 底層：fixed shape/reduction order降低numerical nondeterminism，但不驗證metadata freshness。
   - 為什麼重要：benchmark repeatability與serving semantic correctness要分開建模。
   - 來源：CoRun + vLLM replay behavior。

---

## Architecture Breakdown

```text
SchedulerOutputGeneration G
  ↓
CPU InputBatch / BlockTable / seq_lens / query_start_loc / positions
  ↓ CPU writes
PinnedHostStagingGeneration G
  ↓ non_blocking H2D
DMAReadLifetime(G)
  ↓ completion/event
PersistentDeviceBufferGeneration G
  ↓ fixed captured addresses
CUDA Graph Exec / Shape Bucket
  ↓ replay
AttentionMetadata Consumer Generation G
  ↓
Slot Mapping / Attention / KV Read-Write
```

需要同時成立：

`ReplaySafe(G) = HostWriteGeneration(G) ∧ PreviousDMAQuiescent ∧ H2DPublication(G) ∧ CapturedAddressValid ∧ DeviceBufferGeneration(G) ∧ BatchSemanticGeneration(G) ∧ KernelConsumerGeneration(G)`

---

## Bottom-Level Logic

### Pinned host staging race
```text
CPU step G fills H
→ cudaMemcpyAsync(H → D)
→ DMA engine starts reading H
→ [danger window]
→ copy completion event
→ H can be reused by CPU step G+1
```

錯誤序列：
```text
CPU G fills H
→ async H2D(G)
→ CPU G+1 overwrites H too early
→ DMA(G) observes mixed/new bytes
→ D contains semantically hybrid generation
→ graph replay consumes legal address + wrong contents
```

### CUDA Graph replay
```text
Capture:
KernelArg → DeviceBufferAddress A

Replay G7:
A contains MetadataGeneration G7

Replay G8:
A same address
A must now contain MetadataGeneration G8
```

所以：
`SameAddress(A) ∧ SameGraphExec` 不足以證明 `Same/CorrectSemanticGeneration`。

---

## Visual Simulation Idea
### CUDA Graph Persistent-Buffer Generation Microscope
四層同步時間線：
1. CPU scheduler / pinned staging buffer
2. H2D DMA engine + completion event
3. persistent GPU input buffers
4. CUDA Graph replay + attention kernels

互動注入：
- `HOST_OVERWRITE_BEFORE_DMA_COMPLETE`
- `REPLAY_WITH_STALE_BLOCK_TABLE`
- `REPLAY_WITH_STALE_QUERY_START_LOC`
- `REPLAY_WITH_STALE_SEQ_LENS`
- `GRAPH_BUCKET_MATCH_BUT_BATCH_GENERATION_MISMATCH`
- `DUMMY_CAPTURE_METADATA_LEAK_INTO_REAL_REPLAY`
- `REAL_BATCH_STATE_LEAK_INTO_CAPTURE`

核心UI狀態：
`Graph Topology ✓ | Address Lifetime ✓ | DMA Lifetime ✗ | Buffer Generation ✗ | Semantic Correctness ✗`

---

## Code / GitHub

### vLLM
Repository: https://github.com/vllm-project/vllm

值得繼續看的核心檔案：
- `vllm/v1/worker/gpu_model_runner.py` — pinned input staging、`prepare_inputs_event`、dummy/real step、attention metadata
- `vllm/v1/worker/gpu/model_runner.py` — FULL replay metadata restaging
- `vllm/v1/worker/gpu/cudagraph_utils.py` — capture/replay input buffers
- `vllm/v1/worker/gpu/spec_decode/autoregressive/cudagraph_utils.py` — fresh capture metadata、stale-buffer防護
- `vllm/v1/worker/block_table.py` — block table/slot mapping persistent buffers

### NVIDIA CUDA
- CUDA Graph constraints: https://docs.nvidia.com/dl-cuda-graph/cuda-graph-basics/constraints.html
- CUDA Graph Programming Guide: https://docs.nvidia.com/cuda/archive/13.1.0/cuda-programming-guide/04-special-topics/cuda-graphs.html

---

## Papers

### Foundry: Template-Based CUDA Graph Context Materialization for Fast LLM Serving Cold Start
- Authors: Xueshen Liu, Yongji Wu, Yuncheng Yao, Danyang Zhuo, Ion Stoica, Z. Morley Mao
- Year: 2026
- URL: https://arxiv.org/abs/2604.06664
- Code: 未在本輪確認
- Dataset/Workload: dense/MoE serving models up to 235B
- Architecture: offline template capture + deterministic layout + online context materialization
- Contribution: CUDA Graph execution context可重建，而不只是保存graph topology
- Limitation: 不直接處理request-level metadata generation verification
- 改變了什麼：把 graph reuse correctness擴展到address/kernel context。

### CoRun: Padding is Simple and Efficient for Deterministic LLM Inference
- Authors: Shiju Zhao, Jiacheng Yang, Qihang Chen, Junhao Hu, Jiaqi Zheng, Guihai Chen, Xusheng Chen
- Year: 2026
- URL: https://arxiv.org/abs/2608.14376
- Code: 本輪未確認
- Architecture: isolated prefill + fixed-shape batched decode + CUDA Graphs
- Contribution: 不要求batch-invariant kernels也能建立deterministic serving path
- Limitation: determinism不驗證semantic provenance
- 改變了什麼：證明scheduler/shape本身可以成為numerical execution identity的一部分。

### Hybrid JIT-CUDA Graph Optimization for Low-Latency Large Language Model Inference
- Authors: Divakar Kumar Yadav, Tian Zhao
- Year: 2026
- URL: https://arxiv.org/abs/2604.23467
- Architecture: static graph-replay regions + dynamic JIT kernels
- Contribution: 將static/dynamic runtime拆開，降低interactive inference launch overhead
- Limitation: single-GPU / batch-size-one為主要評估範圍
- 改變了什麼：強化「GraphExecIdentity與DynamicStateIdentity必須分開」的架構方向。

---

## Unknown / Open Questions
1. vLLM current `prepare_inputs_event` 在所有 FULL/PIECEWISE/speculative/ubatch 路徑中，是否都能形成同一套 request-scoped host-buffer lifetime witness？
2. 哪些 attention metadata buffers是在graph內固定地址直接讀，哪些會在backend builder再次materialize/transform？
3. 如何在不造成全域同步的情況下，把 `HostStagingGeneration → H2DCompletion → GraphReplayGeneration` 以NVTX/CUPTI/event correlation變成production witness？

---

## Knowledge Graph 新增 Node
- `PinnedHostStagingGeneration`
- `HostBufferWriteGeneration`
- `H2DDMAReadLifetime`
- `HostBufferReuseSafetyWitness`
- `PersistentDeviceBufferIdentity`
- `PersistentDeviceBufferGeneration`
- `CUDAReplayIdentity`
- `GraphExecIdentity`
- `GraphShapeBucketIdentity`
- `CapturedAddressSetIdentity`
- `ReplayInputRestagingWitness`
- `ReplayInputGenerationWitness`
- `BatchSemanticGeneration`
- `GraphKernelConsumerGeneration`

## Knowledge Graph 新增 Edge
- `StableCapturedAddress --does_not_prove→ CurrentReplaySemanticGeneration`
- `GraphReplayTopologyMatch --does_not_prove→ ReplayInputGenerationMatch`
- `ExecutionDeterminism --does_not_prove→ SemanticGenerationCorrectness`
- `H2DDMAReadLifetime --must_complete_before→ HostBufferNextWriteGeneration`
- `PinnedHostStagingGeneration --publishes_via→ PersistentDeviceBufferGeneration`
- `PersistentDeviceBufferGeneration --consumed_by→ CUDAReplayIdentity`
- `CUDAReplayIdentity --binds→ GraphKernelConsumerGeneration`
- `BatchSemanticGeneration --must_match→ ReplayInputGenerationWitness`

## 新增 Failure Family
- `HOST_STAGING_OVERWRITE_BEFORE_H2D_COMPLETE`
- `CUDA_GRAPH_REPLAY_STALE_PERSISTENT_BUFFER`
- `CAPTURE_METADATA_GENERATION_LEAK`
- `REPLAY_BATCH_GENERATION_MISMATCH`
- `GRAPH_BUCKET_MATCH_SEMANTIC_GENERATION_MISMATCH`
- `PINNED_BUFFER_LIFETIME_VIOLATION`

---

## 下一輪研究

鎖定：

`SchedulerOutputGeneration → InputBatch persistent row identity → pinned CPU buffer fill → prepare_inputs_event protocol → H2D DMA → persistent device buffers → CUDA Graph bucket selection → replay → backend attention metadata → KV read/write → output → sampled token`

優先深讀：
1. `CpuGpuBuffer.copy_to_gpu` 的 stream與non_blocking semantics。
2. `CUDAGraphWrapper/CUDAGraphManager` 對input buffer address與shape bucket的綁定。
3. FULL vs PIECEWISE graph對attention metadata materialization的差異。
4. speculative decoding中target/drafter是否共享或重建metadata generations。
5. CUPTI/NVTX是否能把graph node、memcpy、kernel consumer與request generation低成本join。

---

## 本輪結束判斷
- **缺哪一層：** host pinned buffer generation → H2D DMA completion → graph replay consumer 的production request-scoped causal trace。
- **哪個節點最淺：** `ReplayInputGenerationWitness`。
- **哪個概念仍只是名詞：** `GraphKernelConsumerGeneration` 的production attribution。
- **哪個系統值得讀原始碼：** vLLM CUDA Graph manager + `CpuGpuBuffer` + FULL/spec-decode replay paths。
- **哪篇論文需追引用：** Foundry，因為它直接處理graph topology之外的execution-context/address materialization；CoRun則追deterministic scheduling如何與serving provenance交會。
- **哪個概念最適合視覺模擬：** CUDA Graph Persistent-Buffer Generation Microscope。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Host/DMA Lifetime Verifier + Persistent-Buffer Generation Tracker + CUDA-Graph Replay Provenance Verifier + Attention Metadata Joiner + KV Read/Write Joiner + Causal Evidence Gate + Tool Executor`。

## 本輪核心推進
Hermes 現在不只區分「copy enqueue / completion / consumer ordering」，而開始理解 CUDA Graph 的另一個根本問題：**Graph可以重播同一組固定地址，但每次重播真正代表哪一個request/batch，取決於那些persistent buffers在當下裝的是哪一代資料。** 因此未來的GPU provenance不能只追kernel與address，也必須追 host staging lifetime、DMA讀取區間、device buffer generation與graph replay semantic generation。