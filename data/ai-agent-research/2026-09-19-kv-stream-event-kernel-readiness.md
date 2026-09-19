# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 21:55（Asia/Taipei）

主題：KV CUDA Stream/Event × Kernel-Readiness × Causal Intervention Gate

## 本小時新發現

本輪承接上一輪 `TransferCompletionWitness → exact CUDA stream/event → KernelLaunchWitness`，避免再重複 KV block allocation。核心突破：current vLLM 的 HiSparse worker 已把 KV 搬移的 stream dependency、layer-ready event、DMA completion event、host-write event 與 transfer-id completion queue 明確寫進 runtime；這使 Hermes 能把「worker 說完成」向下細化成「哪條 stream 在等待哪個 event、哪個 event 封住哪批 bytes」。同時 LMCache MP connector 會在 current CUDA stream 上 record interprocess event，再把 event 交給 store request，提供另一個跨元件 dependency witness。

新 system architecture：`GPU KV Temporal Readiness Graph`。

新 GitHub 深讀：
- `vllm/distributed/kv_transfer/kv_connector/v1/hisparse/worker.py`
- `vllm/distributed/kv_transfer/kv_connector/v1/lmcache_mp_connector.py`
- `vllm/distributed/kv_transfer/kv_connector/v1/base.py`
- `vllm/distributed/kv_transfer/kv_connector/v1/offloading_connector.py`

新底層機制：`compute stream → ready event → DMA stream wait_event → swap/copy → completion event → query/synchronize → transfer-id completion → destination-ready`。

## 本小時最重要 5 個發現

### 1. HiSparse 已存在可直接建模的 CUDA happens-before chain【已確認：原始碼】

HiSparse 建立獨立 `dma_stream`、per-layer `_layer_ready_events`、`_forward_ready_event`、`host_write_events` 與 pending completion-event queues。提交 DMA 時，如果沒有指定 ready event，DMA stream 先 `wait_stream(current_stream())`；若有 ready event，則 `wait_event(ready_event)`。之後在 DMA stream 執行 block swap，並在同一 stream record host-write event 與 completion event。

因此可建立：
`Compute writes KV → ReadyEvent.record(compute) → DMAStream.wait_event → KV DMA → CompletionEvent.record(DMA) → CompletionEvent.query → transfer complete`。

重要性：這比 scheduler `completed_jobs` 更接近硬體執行順序，第一次能建立 exact runtime happens-before witness。

限制：event 建立順序仍不是 GPU 全域 wall-clock timestamp；跨 device/process 要另外建立 clock/IPC correlation。

### 2. layer mirror 在 layer kernel 後 record ready event，再啟動 DMA【已確認：原始碼】

`_enqueue_layer_mirror()` 在某 layer 的 KV 已產生後 record `_layer_ready_events[layer_index]`，再把該 event 傳給 `_enqueue_row_dma()`；DMA stream 等待該 event後才讀 resident KV。這提供 `LayerComputeCompletion → KVReadByDMA` 的精確 dependency edge。

這對 Hermes 很重要，因為「某 visual token 的 layer-L K/V 已存在」不能只靠 sequence/block metadata判定；現在可以要求 layer-ready event witness。

限制：這證明 DMA 不早於 producer，但尚未證明後續 attention consumer 不早於 restore completion；consumer-side wait仍需逐 backend追。

### 3. restore path 的 completion event可落在 current compute stream【已確認：原始碼】

`_restore_pages()` 將 host KV non-blocking copy 到 resident cache，接著 `_record_transfer_completion(..., stream=current_stream())`。同 stream ordering 意味著 completion event 位於 restore copies 之後；而 normal DMA path則把 completion event記在 dedicated DMA stream。Hermes 因此不能把所有 `TransferCompletionWitness` 都視為同一種來源，必須保存 `stream_identity + event_identity + producer_op`。

新增：`GPUEventWitness(event_id, stream_id, device, producer_op, transfer_ids, query_state)`。

限制：PyTorch event abstraction不是 raw CUPTI kernel trace；要閉合 exact attention launch仍需 profiler/CUPTI 或 backend launch instrumentation。

### 4. LMCache MP 顯示跨元件 transfer也可攜帶 CUDA event dependency【已確認：原始碼】

current `lmcache_mp_connector.py` 在 current CUDA stream上建立 `torch.cuda.Event(interprocess=True)` 並 `record()`，再把 event交給 `batched_submit_store_requests()`。這表示 transfer API可以攜帶「此前 compute 已完成到此 event」的 dependency token，而非只靠 CPU callback時間。

工程結論：Hermes 的通用 `TransferFenceWitness` 應抽象 event/fence，而不是寫死 HiSparse job ID。

### 5. causal intervention 必須建立 numerical-control baseline【已確認：論文 + 合理工程推論】

2026 的《The Illusion of Equivalence》指出 FP16 cache-ON/cache-OFF可因浮點累加路徑不同而 deterministic divergence；因此 KV zero/replace experiment不能用「重新計算 baseline」直接和 cached intervention比較。另一方面 CAAP 顯示 activation patching可比 attention heatmap更接近 causal attribution；VLCache等 multimodal KV reuse研究也說明 visual KV本身可被選擇性重算/復用。

Hermes intervention protocol應固定 model weights、precision、attention backend、batch/sequence geometry、cache path與sampling，先做 sham intervention（讀寫同值）驗證 baseline，再做 zero/replace。

限制：action-level causality仍會受到 decoding threshold、sampling與agent loop後續工具 observation影響。

## Architecture Breakdown

```text
Visual Token / Logical KV
→ Layer L producer kernel
→ ComputeStream
→ LayerReadyEvent.record
→ DMAStream.wait_event
→ KV transfer / mirror / restore
→ CompletionEvent.record
→ CompletionEvent.query/synchronize
→ ResidencyReadyWitness
→ BlockTableSnapshot
→ AttentionLaunch
→ KV Read
→ Attention Output
→ Residual Stream
→ LM Head / Logits
→ Sampling
→ Reasoning/Action Token
```

關鍵規則：`event recorded ≠ event completed`；`event completed ≠ consumer kernel read`；`consumer kernel read ≠ causal importance`。

## Bottom-Level Logic

### CUDA/PyTorch stream ordering

同一 stream內 operations依 enqueue order建立順序；跨 stream則需 event/wait建立 dependency。HiSparse具體形成：

```text
S_compute:  producer kernels → E_ready.record
S_dma:      wait(E_ready) → swap_blocks_batch → E_done.record
CPU:        E_done.query() → publish transfer completion
```

因此 destination bytes的 readiness不是 CPU submit time，而是 `E_done` complete之後。

### Restore path

```text
S_current:
H2D copy(non_blocking)
→ ...
→ E_transfer_done.record
```

同 stream event天然位於 copy之後，但若 attention launch在另一 stream，仍必須證明 consumer stream wait/ordering。

### Intervention protocol v0

```text
1. Freeze request/model/runtime geometry
2. Capture block-table + lease epoch + stream/event graph
3. Baseline cached run
4. Sham intervention: K/V copy-to-self
5. Verify logits within numerical envelope
6. Target intervention: zero/replace selected visual-token K/V
7. Measure Δattention output
8. Measure Δresidual
9. Measure Δlogits
10. Hold decoding policy fixed
11. Measure generated token/action change
```

只有 4→11 都具 witness，才可從 `KVInterventionWitness` 升級到 `AgentActionCausalBound`。

## Visual Simulation Idea

### GPU KV Happens-Before × Causal Intervention Lab

三條時間軸：Compute Stream、DMA Stream、Attention Stream。每個 event畫成可點擊 fence：

```text
Compute  ── Layer18 KV write ──●E_ready──────────────
                               │
DMA                            └wait→COPY→●E_done────
                                                   │
Attention                                          └wait?→Kernel K882
```

點 `E_done` 顯示 transfer IDs、source/destination block、lease epoch、event query狀態；若 attention kernel缺少可證明的 wait/order edge，顯示 `CONSUMER_ORDER_UNPROVEN`。Causal mode可選 visual token S417，執行 sham/zero/replace三組實驗並畫出 layer-wise residual/logit delta。

## Code / GitHub

值得繼續看的核心檔案：
- vLLM `hisparse/worker.py`：stream/event/DMA ordering最清楚的實作樣本。
- vLLM `lmcache_mp_connector.py`：interprocess CUDA event傳遞。
- vLLM `offloading_connector.py`：worker abstraction與 completion propagation。
- vLLM attention backend / CUDA kernels：下一步 closure consumer launch/read。
- PyTorch CUDA Event/Stream implementation：event semantics與IPC boundary。

## Papers

### The Illusion of Equivalence: Systematic FP16 Divergence in KV-Cached Autoregressive Inference
Authors: Ranjith Chodavarapu, Lei Xu. Year: 2026. Architecture: cached vs cache-free autoregressive inference. Contribution:指出 FP16不同 accumulation path可造成 deterministic token divergence。Limitation:目前驗證模型/任務範圍有限，不能直接外推所有 backend。改變：Hermes causal experiment必須加入 numerical-path equivalence/sham control。

### Causal Attribution via Activation Patching
Authors: Amirmohammad Izadi et al. Year: 2026. Architecture: ViT intermediate activation intervention. Contribution:以 activation patching估計 image patch對prediction的 causal contribution。Limitation:不是 agent runtime/KV serving experiment。改變：支持 Hermes從 attention association升級到 intervention-based provenance。

### VLCache: Computing 2% Vision Tokens and Reusing 98% for Vision-Language Inference
Authors: Shengling Qin et al. Year: 2025. Architecture: multimodal encoder/KV reuse。Contribution:分析 non-prefix reuse error並做 layer-aware recomputation。Limitation:reuse fidelity不等於 action causality。改變：提供 visual KV selective reuse/intervention的工程參照。

## Unknown / Open Questions 1-3

1. Attention consumer究竟在哪個 stream launch？對 restore/DMA completion event的 wait edge在各 backend何處建立？
2. 如何把 PyTorch event identity與 CUPTI kernel activity / CUDA correlation ID連起來，得到 exact `KernelLaunchWitness`？
3. 對 visual-token K/V做 zero/replace時，如何在 GQA/MQA、tensor parallel、context parallel與prefix sharing下確保只介入目標 logical identity？

## 下一輪研究

直接追：`attention backend → forward context → block table → CUDA/Triton kernel launch → stream identity → CUPTI/profiler correlation → K/V pointer/slot → kernel read`。若 closure成功，建立第一版可實作的 `KVInterventionHarness`：同一 cached request做 sham、zero、replace，記錄 attention/residual/logit/action delta。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：`CUDAStreamIdentity`、`GPUEventWitness`、`LayerReadyEventWitness`、`DMACompletionEventWitness`、`InterprocessCUDAEventWitness`、`ResidencyReadyWitness`、`ConsumerOrderingWitness`、`ConsumerOrderUnprovenState`、`ShamInterventionWitness`、`NumericalControlEnvelope`、`KVInterventionHarness`、`AttentionOutputDeltaWitness`、`ResidualDeltaWitness`、`LogitDeltaWitness`。

新增 Edges：
- `LayerKVProducerKernel --records--> LayerReadyEventWitness`
- `DMAStream --waits_on--> LayerReadyEventWitness`
- `KVTransfer --records--> DMACompletionEventWitness`
- `DMACompletionEventWitness --establishes--> ResidencyReadyWitness`
- `AttentionKernelLaunch --requires--> ConsumerOrderingWitness`
- `ShamInterventionWitness --validates--> NumericalControlEnvelope`
- `KVInterventionWitness --causes?--> AttentionOutputDeltaWitness`
- `AttentionOutputDeltaWitness --propagates_to--> ResidualDeltaWitness`
- `ResidualDeltaWitness --propagates_to--> LogitDeltaWitness`
- `LogitDeltaWitness --may_change--> AgentActionToken`

## 本輪結束判定

缺哪一層：`ResidencyReadyWitness → exact Attention KernelLaunch/Read correlation`。

哪個節點最淺：`ConsumerOrderingWitness`，因不同 connector/backend可能有不同 stream semantics。

哪個概念仍只是名詞：`AgentActionCausalBound`；尚未完成受控 KV intervention。

哪個系統值得讀原始碼：vLLM attention backend + Triton/CUDA PagedAttention launch path，搭配 HiSparse stream/event path。

哪篇論文需追引用：`The Illusion of Equivalence` 與 `Causal Attribution via Activation Patching`，前者約束 numerical control，後者提供 intervention attribution方法論。

哪個概念最適合視覺模擬：`GPU KV Happens-Before × Causal Intervention Lab`。

哪個 Agent 架構最值得實作：`State-grounded Planner + VisualToken/KV Provenance + PreAction Verifier + Causal Evidence Gate`；只有 provenance/causal evidence達標才讓高風險 action進入 tool execution。

本輪把研究從「transfer job何時完成」推進到真正的 GPU ordering：現在已能指出 producer stream、ready event、DMA stream、completion event之間的 happens-before 關係。下一輪只差把 consumer attention launch/read接上同一張 temporal graph，之後才能對某個 screenshot-derived visual token做可重現的 KV intervention並量測它對 logit與 Agent action的真正因果效果。