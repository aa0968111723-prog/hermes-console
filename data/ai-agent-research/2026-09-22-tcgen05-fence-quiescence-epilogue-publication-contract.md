# 【AI Agent × Multimodal Research Report】

**時間：2026-09-22 04:55（Asia/Taipei）**

**本輪主題：Blackwell TCGen05 Fence × Consumer Quiescence × Epilogue Publication Contract**

> Evidence policy: 本報告嚴格區分 NVIDIA/PTX 官方語義、CUTLASS 工程實作、論文結果、工程推論與尚未驗證假說。本輪延續前輪 `tcgen05.ld → wait::ld → epilogue → dealloc`，但不重複「load completion」本身；本輪集中研究 **load 已完成之後，如何跨 thread synchronization 建立 ordering，以及何時才能宣稱 TMEM consumer 已 quiescent、allocation 可安全回收**。

## 本小時新發現

1. **新底層機制：TCGen05 fence 是 ordering primitive，不是 completion primitive。** PTX 9.0 將 `tcgen05.fence::before_thread_sync` / `after_thread_sync` 定義為跨 thread execution-order synchronization 前後的 tcgen05 ordering mechanism。它不能替代 `tcgen05.wait::ld` / `wait::st`，而 `wait::ld` 也不能替代跨 thread fence。
2. **新 correctness contract：Load Completion 與 Cross-Thread Publication 必須分開。** `tcgen05.ld → wait::ld` 證明該 thread 的 TMEM→RMEM load completion；若後續要以 CTA barrier / flag / ownership transfer 讓其他 threads 依賴這批 tcgen05 operations，還需要 `fence::before_thread_sync → execution-order synchronization`。
3. **新 lifecycle frontier：TMEMConsumerQuiescenceWitness 不能由單一 warp 的 wait 推出。** CUTLASS current `1cta_mma_pipeline.py` 在所有 epilogue warps 完成 TMEM loads/store 後執行 `tcgen05_fence(BEFORE_THREAD_SYNC)`、CTA barrier，最後只由 warp 0 deallocate TMEM。這提供一個 production-like quiescence protocol。
4. **新 failure family：completion/order conflation。** 新增 `LOAD_COMPLETE_WITHOUT_PUBLICATION_ORDER`、`FENCE_WITHOUT_LOAD_COMPLETION`、`DEALLOC_BEFORE_CTA_QUIESCENCE`、`MISSING_BEFORE_THREAD_SYNC_FENCE`、`AFTER_THREAD_SYNC_REENTRY_ORDER_GAP`。
5. **新 system-level connection：FlashAttention-4 的 fully asynchronous Blackwell pipeline 使 completion、ordering、ownership transfer 必須被分開建模。** FA4 使用 asynchronous MMA、TMEM、2-CTA MMA；當硬體非同步程度提高，單純的「barrier passed」不再足以描述資料何時可讀、何時已發布、何時可回收。

## 本小時最重要 5 個發現

### 1. `wait::ld` 與 `fence::before_thread_sync` 解決不同問題

**已確認事實（NVIDIA PTX / CUTLASS docs）**

- `tcgen05.ld` 是 asynchronous operation。
- dependent use 前需要 `tcgen05.wait::ld`。
- `tcgen05.fence::before_thread_sync` 用於把先前 asynchronous tcgen05 operations 排在後續 execution-order synchronization 之前。
- `tcgen05.fence::after_thread_sync` 用於把後續 tcgen05 operations 排在先前 synchronization 之後。

因此：

```text
TMEMLoadIssue
  → wait::ld
  → TMEMLoadCompletionWitness
  → RMEMFragmentReadableWitness

PriorTCGen05Operations
  → fence::before_thread_sync
  → CTA/cluster execution synchronization
  → CrossThreadPublicationOrderingWitness
```

新的否定關係：

```text
TMEMLoadCompletionWitness
--does_not_prove→ CrossThreadPublicationOrderingWitness

Tcgen05BeforeThreadSyncFence
--does_not_prove→ TMEMLoadCompletionWitness
```

來源：
- NVIDIA PTX ISA 9.0: https://docs.nvidia.com/cuda/pdf/ptx_isa_9.0.pdf
- CUTLASS tcgen05 DSL docs: https://docs.nvidia.com/cutlass/latest/media/docs/pythonDSL/cute_dsl_api/cute_nvgpu_tcgen05.html
- CUTLASS primitives: https://docs.nvidia.com/cutlass/latest/media/docs/pythonDSL/primitives.html

### 2. `sync` 必須拆成 Completion / Ordering / Rendezvous 三種語義

**建模結果（由官方語義推導）**

Hermes 不應再用單一 `SynchronizationWitness`。至少拆成：

```text
CompletionWitness
  = 某 asynchronous operation 本身完成

OrderingWitness
  = 某 operation 在 execution-order edge 的前/後關係成立

RendezvousWitness
  = 指定 thread group 到達 synchronization point
```

典型合法鏈：

```text
tcgen05.ld
→ wait::ld                  # completion
→ consume RMEM
→ fence::before_thread_sync # ordering
→ barrier_cta_sync          # rendezvous
→ dealloc TMEM              # lifecycle transition
```

**限制：** 上述鏈證明的是工程 synchronization protocol；若要證明某個 request/layer/head 的實際 runtime event，仍需 dynamic trace。

### 3. CUTLASS current source 給出具體 TMEM quiescence protocol

**工程實作（current CUTLASS commit f614dc40）**

`examples/python/CuTeDSL/experimental/primitives/tcgen05/1cta_mma_pipeline.py` 的 consumer/epilogue path：

```text
MMA K-loop
→ tcgen05_commit(acc_mbar)
→ wait acc_mbar
→ each warp computes its TMEM row partition
→ tcgen05_ld
→ tcgen05_wait(LOAD)
→ RMEM vector store
→ tcgen05_fence(BEFORE_THREAD_SYNC)
→ barrier_cta_sync
→ warp 0 tcgen05_dealloc
```

值得看的核心檔案：
- `examples/python/CuTeDSL/experimental/primitives/tcgen05/1cta_mma_pipeline.py`
- `examples/python/CuTeDSL/experimental/primitives/tcgen05/1cta_mma_a_from_tmem.py`
- `examples/python/CuTeDSL/experimental/primitives/tcgen05/2cta_mma_basic.py`
- `examples/python/CuTeDSL/experimental/primitives/tcgen05/2cta_mma_tma_store.py`
- `examples/python/CuTeDSL/experimental/primitives/tcgen05/tmem_ld_st.py`

Repo: https://github.com/NVIDIA/cutlass

新的 lifecycle equation：

```text
DeallocationSafe
= AllRequiredConsumerLoadsComplete
∧ RequiredRMEMUsesIssued/CompletedPerContract
∧ BeforeThreadSyncOrderingEstablished
∧ RequiredCTAGroupRendezvousCompleted
∧ AllocationGenerationStillMatches
```

### 4. CUDA async proxy 讓「程式順序」不能自動等於「跨 proxy 可見性」

**官方資訊**

CUDA Programming Guide 將 TMA 與部分 tensor-core operations 建模為 async thread / async proxy；普通 generic-proxy memory operations與async-proxy operations之間不能只靠 source program order推導完整可見性，特定情況需要 proxy fence / synchronization contract。

因此 Knowledge Graph 要新增：

```text
ExecutionOrderEdge
MemoryVisibilityEdge
ProxyTransitionEdge
CompletionEdge
```

且：

```text
ExecutionOrderEdge --does_not_imply→ MemoryVisibilityEdge
```

來源：https://docs.nvidia.com/cuda/cuda-programming-guide/03-advanced/advanced-kernel-programming.html

### 5. FA4 證明這不是教學 kernel 才需要的細節

**論文結果**

FlashAttention-4 針對 Blackwell 使用 fully asynchronous MMA、larger tiles、TMEM 與 2-CTA MMA；B200 BF16 報告最高 1613 TFLOP/s、71% utilization，最高約 1.3× cuDNN 9.13、2.7× Triton。這種 pipeline 讓 producer/consumer ownership、completion、ordering、publication、reuse 成為 attention kernel correctness 與 performance 的共同核心。

來源：https://arxiv.org/abs/2603.05451

## Architecture Breakdown

本輪 system architecture：**CUTLASS Blackwell TCGen05 pipelined GEMM / epilogue handoff**。

```text
Global A/B
→ TMA descriptors
→ staged SMEM A/B
→ mbarrier FULL
→ consumer warp MMA K-loop
→ TCGen05 accumulator in TMEM
→ tcgen05.commit(acc_mbar)
→ accumulator publication
→ CTA wait
→ warp-partitioned TMEM reads
→ tcgen05.ld
→ wait::ld
→ RMEM fragment
→ epilogue/store
→ fence::before_thread_sync
→ CTA rendezvous
→ TMEM dealloc
```

這裡至少有 6 個不同 frontier：

1. `TMADataReadyFrontier`
2. `MMACommitFrontier`
3. `AccumulatorPublicationFrontier`
4. `TMEMLoadCompletionFrontier`
5. `CrossThreadPublicationOrderingFrontier`
6. `TMEMDeallocationSafetyFrontier`

任何兩者都不能因為「都像 synchronization」就合併。

## Bottom-Level Logic

### Canonical state machine

```text
ACC_FULL(g)
→ EPILOGUE_CONSUMER_OWNED(g)
→ TMEM_LD_ISSUED(g, warp_partition)
→ TMEM_LD_IN_FLIGHT
→ WAIT_LD_COMPLETE
→ RMEM_READABLE
→ EPILOGUE_RMEM_USE
→ BEFORE_THREAD_SYNC_FENCE
→ CTA_RENDEZVOUS
→ CONSUMER_QUIESCENT(g)
→ DEALLOC_SAFE(g)
→ DEALLOCATED(g)
```

### New correctness predicates

```text
RegisterReadable(g,w)
= LoadIssued(g,w) ∧ WaitLdCompleted(g,w)

CrossThreadPublicationOrdered(g)
= PriorTcgen05Ops(g)
∧ BeforeThreadSyncFence(g)
∧ ExecutionOrderSync(g)

ConsumerQuiescent(g)
= ∀w∈RequiredEpilogueWarps:
    RegisterReadable(g,w)
    ∧ EpilogueUseComplete(g,w)
  ∧ CrossThreadPublicationOrdered(g)
  ∧ GroupRendezvousComplete(g)

DeallocationSafe(g)
= ConsumerQuiescent(g)
∧ AllocationGeneration(g)=CurrentAllocationGeneration
```

### Failure examples

```text
LD → fence → barrier → RMEM read
```

錯誤：fence不是load completion wait。

```text
LD → wait::ld → warp0 dealloc
```

可能錯誤：warp0只知道自己的load完成，不能證明其他required consumer warps已quiescent。

```text
LD → wait::ld → RMEM use → CTA sync → dealloc
```

若 tcgen05 ordering contract要求 fence，而缺少 `before_thread_sync`，則不能只靠普通 CTA rendezvous把 prior async tcgen05 operation ordering視為已證明。

## Visual Simulation Idea

### TCGen05 Completion–Ordering–Quiescence Microscope

Hermes Console 畫五條時間軸：

```text
Warp0 TMEM LD : ISSUE ─ WAIT ─ RMEM USE ─┐
Warp1 TMEM LD : ISSUE ─ WAIT ─ RMEM USE ─┤
Warp2 TMEM LD : ISSUE ─ WAIT ─ RMEM USE ─┼→ FENCE → CTA SYNC → DEALLOC
Warp3 TMEM LD : ISSUE ─ WAIT ─ RMEM USE ─┘
TMEM lifetime : ALLOC ───────── OWNED ─────────────── FREE
```

互動開關：
- 移除某 warp 的 `wait::ld`
- 移除 `before_thread_sync`
- 讓 warp0 提前 dealloc
- 改變 required consumer warp set
- reuse 相同 TMEM column range 但增加 generation

Console 即時產生：
- `RMEM_READ_BEFORE_TMEM_LOAD_COMPLETE`
- `LOAD_COMPLETE_WITHOUT_PUBLICATION_ORDER`
- `MISSING_BEFORE_THREAD_SYNC_FENCE`
- `DEALLOC_BEFORE_CTA_QUIESCENCE`
- `TMEM_STALE_ALLOCATION_GENERATION`

並分開顯示三盞 evidence light：

```text
COMPLETION  ✓/✗
ORDERING    ✓/✗
QUIESCENCE  ✓/✗
```

## Code / GitHub

### NVIDIA CUTLASS

Repo: https://github.com/NVIDIA/cutlass

本輪實際追 current source，不只 README。最重要 call chain：

```text
full_bar wait parity
→ tcgen05_mma K-block loop
→ tcgen05_commit(empty_bar)
→ final tcgen05_commit(acc_mbar)
→ acc_mbar wait
→ make_tmem_ptr_from_warp_row_col
→ tcgen05_ld
→ tcgen05_wait(LOAD)
→ RMEM/global store
→ tcgen05_fence(BEFORE_THREAD_SYNC)
→ barrier_cta_sync
→ tcgen05_dealloc
```

### NVIDIA PTX / CUDA docs

- PTX ISA 9.0: https://docs.nvidia.com/cuda/pdf/ptx_isa_9.0.pdf
- PTX online ISA: https://docs.nvidia.com/cuda/parallel-thread-execution/index.html
- CUDA async execution/proxy model: https://docs.nvidia.com/cuda/cuda-programming-guide/03-advanced/advanced-kernel-programming.html
- CUTLASS tcgen05 DSL: https://docs.nvidia.com/cutlass/latest/media/docs/pythonDSL/cute_dsl_api/cute_nvgpu_tcgen05.html
- CUTLASS primitives: https://docs.nvidia.com/cutlass/latest/media/docs/pythonDSL/primitives.html

## Papers

### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling

- **Authors:** Ted Zadouri, Markus Hoehnerbach, Jay Shah, Timmy Liu, Vijay Thakkar, Tri Dao
- **Institution:** Princeton University / Meta / Colfax Research / NVIDIA / Georgia Tech / Together AI（作者 affiliations）
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2603.05451
- **Code:** FlashAttention repository / CuTe-DSL implementation (paper reports implementation entirely in CuTe-DSL)
- **Dataset:** 非 dataset-centric；以 attention workloads / GPU kernel benchmarks 為主
- **Architecture:** Blackwell attention pipeline with fully asynchronous MMA, larger tiles, TMEM, 2-CTA MMA
- **Contribution:** 針對 Blackwell asymmetric scaling重新設計 attention algorithm + kernel pipeline；B200 BF16最高1613 TFLOP/s、71% utilization
- **Limitations:** 本論文效能結果不能直接替代本報告所需的 request-scoped runtime synchronization trace；performance success ≠ causal provenance proof
- **改變了什麼：** attention最佳化從單純提升Tensor Core利用率，轉向共同處理 matmul、shared-memory、softmax/exponential與on-chip async pipeline bottlenecks。

### Model2Kernel: Model-Aware Symbolic Execution For Safe CUDA Kernels

- **Authors:** Mengting He, Shihao Xia, Haomin Jia, Wenfei Wu, Linhai Song
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2603.24595
- **Code:** 本輪未確認公開code URL，保持 UNKNOWN
- **Dataset:** vLLM、Hugging Face與近期LLM research kernels / models 作為 evaluation corpus
- **Architecture:** model-aware dynamic analysis + CUDA-specialized symbolic execution
- **Contribution:** 報告發現353個先前未知bugs、9個false positives；引入dynamic tensor memory與thread identifier相關分析 abstraction
- **Limitations:** symbolic/static safety不等於Blackwell runtime tcgen05 completion/ordering trace
- **改變了什麼：** 顯示 inference kernel verification 必須把 model-level invocation constraints 帶進 kernel analysis，而不能只把 kernel 當孤立CUDA函式。

## Unknown / Open Questions 1–3

1. **Runtime fence observability：** Compute Sanitizer / binary instrumentation 能否低擾動地取得 `tcgen05.wait::ld → fence::before_thread_sync → CTA barrier → dealloc` 的完整 dynamic sequence，並保留 CTA/warp identity？
2. **Quiescence minimum proof：** 對不同 epilogue warp specialization，`all required consumer warps` 的集合如何由 source/compiled layout可靠推導，而不是假定整個CTA？
3. **FlashAttention-4 mapping：** FA4 QK/PV/softmax pipeline中哪些 TMEM handoff實際使用同型 fence/quiescence pattern，哪些由不同 pipeline/barrier abstraction封裝？

## 下一輪研究

下一輪避免繼續停留在 generic TCGen05 名詞，直接進：

```text
FlashAttention-4 CuTe source
→ QK accumulator ownership
→ softmax consumer warp topology
→ PV accumulator ownership
→ TMEM→RMEM load callsites
→ wait::ld
→ before/after-thread-sync fence
→ pipeline release
→ actual epilogue/output store
→ generated PTX/SASS mapping
→ runtime-observable event surface
→ request/layer/head attribution
```

若 FA4 source path可取得，優先建立 `QKAccumulatorGeneration → SoftmaxGeneration → PVAccumulatorGeneration → OutputTileGeneration` 四代 ownership chain，而不是再新增泛化名詞。

## Knowledge Graph 新增 Node / Edge

### Nodes

- `Tcgen05LoadCompletionWitness`
- `Tcgen05BeforeThreadSyncFenceWitness`
- `Tcgen05AfterThreadSyncFenceWitness`
- `CrossThreadPublicationOrderingWitness`
- `ExecutionOrderSynchronizationWitness`
- `CTAConsumerRendezvousWitness`
- `RequiredEpilogueWarpSet`
- `TMEMConsumerQuiescenceWitness`
- `TMEMDeallocationSafetyFrontier`
- `CompletionOrderingSeparationContract`
- `AsyncProxyExecutionIdentity`
- `ProxyTransitionEdge`

### Edges

```text
Tcgen05LdIssue
--completed_by→ Tcgen05WaitLd

Tcgen05WaitLd
--establishes→ Tcgen05LoadCompletionWitness

Tcgen05LoadCompletionWitness
--enables→ RMEMFragmentReadableWitness

Tcgen05BeforeThreadSyncFenceWitness
--orders_before→ ExecutionOrderSynchronizationWitness

ExecutionOrderSynchronizationWitness
--participates_in→ CrossThreadPublicationOrderingWitness

RequiredEpilogueWarpSet
--must_all_satisfy→ TMEMConsumerQuiescenceWitness

TMEMConsumerQuiescenceWitness
--enables→ TMEMDeallocationSafetyFrontier

Tcgen05LoadCompletionWitness
--does_not_prove→ CrossThreadPublicationOrderingWitness

Tcgen05BeforeThreadSyncFenceWitness
--does_not_prove→ Tcgen05LoadCompletionWitness

CTAConsumerRendezvousWitness
--does_not_alone_prove→ PriorAsyncTcgen05Completion

ExecutionOrderEdge
--does_not_imply→ MemoryVisibilityEdge
```

## 本輪結束判斷

- **缺哪一層：** FA4 production callsite → compiled PTX/SASS → runtime wait/fence/barrier/dealloc trace。
- **哪個節點最淺：** request-scoped `TMEMConsumerQuiescenceWitness`。
- **哪個概念仍只是名詞：** FA4-specific `RequiredEpilogueWarpSet`，尚未完成 source topology mapping。
- **哪個系統值得讀原始碼：** FlashAttention-4 CuTe-DSL Blackwell forward kernel；CUTLASS `PipelineUmmaAsync` / tcgen05 primitives 作對照。
- **哪篇論文需追引用：** FlashAttention-4；另追 Model2Kernel 後續對 dynamic tensor memory / production inference kernel verification 的工作。
- **哪個概念最適合視覺模擬：** `TCGen05 Completion–Ordering–Quiescence Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + GPU Capability Router + Completion/Ordering Semantic Verifier + Consumer Quiescence Verifier + Binary Trace Joiner + Launch Attribution Joiner + Causal Evidence Gate + Tool Executor`。

## 本輪核心推進

Hermes 現在不再把「同步」當成單一事件。Blackwell TCGen05 路徑至少要分成 **operation completion、cross-thread ordering、thread-group rendezvous、consumer quiescence、resource deallocation** 五個不同的證據 frontier。這補上了前一輪 `wait::ld` 之後仍缺的一段：**資料已經進入 register，不代表跨 thread 的 ownership 已安全發布；CTA 都到 barrier，也不代表前面的 async tcgen05 operation 已被正確完成與排序。**