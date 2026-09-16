# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 19:51（Asia/Taipei）

主題：Disaggregated Encoder Cache × ECConnector × NIXL/CPU Tier × Namespace/Revision × Multimodal Prefix Partial-Block Correctness

## 本小時新發現

本輪接續上一輪 `Distributed Encoder Cache Identity → Model / Processor / Adapter Revision → Namespace → Invalidation → Prefix KV Identity` 缺口，直接追 vLLM 最新 `vllm/distributed/ec_transfer/` 原始碼、ECCPUConnector、shared-memory encoder cache、disaggregated encoder 文件，以及 vLLM-Omni multimodal prefix caching 的 partial-block semantics。

本輪確認：production multimodal serving 已經形成兩個相互連接、但 identity 粒度不同的 cache graph：`mm_hash/encoder identifier → encoder feature cache` 與 `prefix block hash chain → KV/prefix tensor cache`。Encoder cache 可以保存整個 multimodal item 的 embedding，而 prefix cache 通常只保存完整 token block。因此「prefix partial miss」不代表 vision encoder 必須重算：只要 encoder identity 命中，未被 prefix block 覆蓋的 visual-token span 仍可從 encoder feature cache取回。

## 本小時最重要 5 個發現

### 1. ECConnector 已是 scheduler/worker 分離的 distributed computation protocol

已確認工程實作：vLLM `ECConnectorBase` 明確拆成 scheduler-side 與 worker-side。Scheduler 決定 cache 是否存在、是否需要 load、request 結束與 metadata；worker 在 model execution 前依 metadata 非同步 load/save encoder cache。`encoder_cache` 的核心介面仍是 `dict[str, Tensor]`，key 是 multimodal `mm_hash`/identifier。

底層：

`Request → Scheduler checks EC identity → alloc/load decision → ConnectorMetadata → Worker start_load_caches → local encoder_cache → gather multimodal embeddings → model forward → save_caches → WorkerMetadata → Scheduler state update`

重要性：encoder cache 已不是單一 Python LRU，而是一個 execution-runtime protocol，可跨 process、CPU tier、remote transport。

限制：base abstraction 本身沒有定義完整的 model/processor revision namespace；correctness 仍高度依賴上游 identifier 是否完整。

### 2. ECCPUConnector 的 CPU tier 是真正 mmap-backed shared computation store

已確認工程實作：`ECSharedRegion` 在 `/dev/shm/vllm_ec_{engine_id}.mmap` 建立 MAP_SHARED flat region，layout 是 `(num_blocks, block_size_bytes)`。每個 process 映射同一物理頁；CUDA 可對整個 mmap 做 `cudaHostRegister`，讓 GPU↔CPU DMA 使用 pinned memory。allocation/eviction 則由 scheduler 的 EmbeddingCache 管理。

底層：

`Encoder Tensor on GPU → async CUDA copy → pinned shared mmap block → mm_hash→block metadata → later request → mmap block → async CUDA copy → local GPU encoder_cache`

重要性：這是「AI 計算結果」從 GPU HBM 下沉到 CPU shared-memory tier 的具體 physical path。

限制：shared mmap 是 engine-instance local；跨 instance reuse 需要 NIXL/remote connector 層。

### 3. Disaggregated Encoder 把 multimodal inference正式拆成 E→P→D stage graph

官方資訊與工程實作一致：vLLM Disaggregated Encoder 讓 vision encoder instance 與 Prefill/Decode instance 分離；encoder output 透過 ECConnector 傳到 PD。這使 encoder fleet 可獨立 scale，language-only request 可 bypass encoder，也允許跨 process reuse embeddings。

系統架構：

`Media → E Scheduler → Vision Encoder GPU → EC → CPU/Remote Tier → P Scheduler → Visual Embedding Injection → LLM Prefill → KV Transfer → D → Decode`

2026 EPD-Serve 也以 stage-level Encode/Prefill/Decode disaggregation 為核心，在其 Ascend 高併發實驗中相對 PD-disaggregated deployment 報告 57.37–69.48% end-to-end throughput 提升；這是特定系統/workload 結果，不能外推所有硬體。

### 4. Multimodal Prefix Cache 與 Encoder Cache 的 reuse unit 不相同

已確認官方設計：prefix caching 只保存完整 block；multimodal input 若跨 block boundary，後半段 visual tokens 可能落在未 cache 的 partial block。下一個 request 即使只 hit 前一個完整 prefix block，runtime 仍能依 image hash 命中 encoder cache，取回剩餘 visual embeddings，再和 prefix KV state 一起計算後續 block。

因此：

`PrefixCacheMiss(partial block) ≠ EncoderCacheMiss(media item)`

正確鏈：

`Prefix full-block hit → mark prefix tokens precomputed → schedule remaining span → encoder identity lookup → encoder feature hit → slice/merge needed visual embeddings → compute remaining token block with cached KV context`

重要性：Hermes Knowledge Graph 必須把 cache identity 粒度標示出來：media-item identity、visual-span identity、token-block identity、KV-chain identity不能混為一談。

### 5. Distributed cache namespace 必須升級成 Computation Identity，而不能只有 Media Identity

已確認事實：ECCPUConnector/ECConnector transport 主要以 `mm_hash`/identifier 找 tensor；vLLM security docs 又指出 UUID alias 可污染 processor/encoder/prefix caches。合理工程推論：當 cache 跨 instance、跨 deployment、跨 model revision 存活時，安全 key 應描述「哪個 computation 產生這個 embedding」，而不只是「哪個 media」。

Hermes 建議模型：

`EncoderComputationIdentity = H(MediaProcessingIdentity, ModelRevision, VisionTowerRevision, ProjectorRevision, Adapter/LoRAIdentity, ProcessorPolicySignature, OutputDType/Layout, SemanticFeatureFlags)`

其中哪些欄位已直接進 vLLM 現行 identifier、哪些仍需 namespace 層補足，必須在下一輪逐項驗證，不能把此公式誤標成 vLLM 已實作事實。

## Architecture Breakdown

### Disaggregated Multimodal E→P→D

```text
Client Media
  ↓
Media / Processing Identity
  ↓
Encoder Scheduler
  ├ EC local lookup
  ├ remote EC lookup
  └ MISS → Vision Encoder
                ↓
         Encoder Embedding
                ↓
      ┌─────────┴──────────┐
      ↓                    ↓
 GPU EC                CPU EC
                           ↓
                    /dev/shm mmap
                           ↓
                       NIXL P2P
                           ↓
                    Prefill Instance
                           ↓
             Multimodal Embedding Merge
                           ↓
                    Prefix KV blocks
                           ↓
                       KV transfer
                           ↓
                    Decode Instance
```

### ECConnector control/data split

```text
Scheduler Plane
Request
→ has_cache_item / ensure_cache_available
→ allocation state
→ ConnectorMetadata
                 │
                 ▼
Worker Plane
bind metadata
→ start_load_caches
→ GPU model execution
→ save_caches
→ WorkerMetadata
                 │
                 ▼
Scheduler update
```

## Bottom-Level Logic

### CPU encoder-cache physical path

`Vision Encoder Output Tensor → GPU pointer → CUDA stream copy → cudaHostRegister-pinned mmap pages → flat cache block → scheduler metadata → later load → CUDA stream → GPU tensor`

`ECSharedRegion` 使用 `MAP_SHARED`；creator 會先 pre-fault pages，支援 `MADV_POPULATE_WRITE`，不支援時 fallback 到逐頁 read-modify-write。每個 TP worker 因 virtual address 不同，需要各自 `cudaHostRegister` 同一 shared physical pages。

### Partial multimodal prefix reuse

假設 block size=4，image 產生 6 visual tokens：

```text
Block 0: [Im0 Im1 Im2 Im3]   ← prefix block cached
Block 1: [Im4 Im5 foo bar]   ← changed / uncached
```

第二次 request：

`PrefixBlockHash(Block0) HIT → 4 tokens precomputed → Block1 must execute → Image EncoderIdentity HIT → retrieve full image embedding → select Im4/Im5 span → merge with foo/bar → attention uses cached Block0 KV → compute Block1`

因此同一 request 可以同時存在：`KV HIT + partial token MISS + Encoder HIT`。

## Visual Simulation Idea

### Multimodal E→P→D Cache Coherence Microscope

Hermes Console 新增互動視圖：

左側 Media Identity：
- media hash / UUID
- processor policy
- model / vision tower / LoRA
- encoder computation identity

中央 Cache Tiers：
- GPU Encoder Cache
- `/dev/shm` CPU Encoder Cache
- Remote NIXL Encoder Cache
- Prefix KV Cache

右側 Token Blocks：
- visual token spans
- full prefix blocks
- partial block
- KV hit/miss
- encoder hit/miss

互動事件：改 prompt 尾端但保留同一 image，畫面應呈現 `Prefix Block 0 HIT / Block 1 MISS / Encoder HIT`；切換 vision adapter 則 EncoderIdentity 應改變並 MISS；模擬 remote CPU hit 時動畫顯示 NIXL transfer 取代 Vision Encoder recompute。

## Code / GitHub

值得繼續讀的 vLLM 目錄與核心檔案：

- `vllm/distributed/ec_transfer/ec_connector/base.py` — scheduler/worker EC protocol
- `vllm/distributed/ec_transfer/ec_connector/cpu/connector.py` — CPU EC role routing
- `vllm/distributed/ec_transfer/ec_connector/cpu/ec_shared_region.py` — mmap/pinned-memory physical substrate
- `vllm/distributed/ec_transfer/ec_connector/cpu/scheduler/` — allocation、eviction、availability
- `vllm/distributed/ec_transfer/ec_connector/cpu/worker/` — GPU↔CPU async copy
- `vllm/distributed/ec_transfer/ec_connector/cpu/session.py` — NIXL/remote session path
- `vllm/distributed/ec_transfer/ec_connector/mooncake_ec_connector.py` — alternate remote EC backend
- `vllm/v1/core/kv_cache_manager.py` / prefix hash path — 下一輪追 multimodal block identity

## Papers

### EPD-Serve: A Flexible Multimodal EPD Disaggregation Inference Serving System On Ascend
Authors: Fan Bai et al.
Institution: paper authors' Ascend-oriented serving work; institution mapping待從全文逐項確認
Year: 2026
URL: https://arxiv.org/abs/2601.11590
Code: 本輪未確認公開 code
Dataset/Workload: multimodal understanding serving workloads
Architecture: Encode / Prefill / Decode stage disaggregation + async feature prefetch + grouped KV transfer + multi-route scheduling
Contribution: 將 multimodal E/P/D stages 解耦並針對跨 stage communication/scheduling 最佳化
Limitations: Ascend/interconnect/workload specific；不能把 throughput 數字直接外推 NVIDIA/vLLM
改變了什麼：把 PD disaggregation 擴成 multimodal Encode-aware EPD serving。

### vLLM-Omni: Fully Disaggregated Serving for Any-to-Any Multimodal Models
Authors: Peiqi Yin et al.
Year: 2026
URL: https://arxiv.org/abs/2602.02204
Code: https://github.com/vllm-project/vllm-omni
Architecture: stage graph + independently served LLM/diffusion engines + per-stage batching + inter-stage connectors
Contribution: 將 disaggregation 從 E/P/D 擴展到 any-to-any multimodal stage graph
Limitations: stage abstraction 解決 serving orchestration，不等於已解決所有跨 stage cache namespace/correctness 問題
改變了什麼：讓「多模態模型」可被視為可排程的 heterogeneous execution graph，而不是單一 monolithic model call。

### VLCache: Computing 2% Vision Tokens and Reusing 98% for Vision-Language Inference
Authors: Shengling Qin et al.
Year: 2025
URL: https://arxiv.org/abs/2512.12977
Code: 論文稱 pipeline 已整合 SGLang；本輪未逐檔驗證 code mapping
Architecture: encoder cache + KV reuse + layer-aware selective recomputation
Contribution: 分析 non-prefix reuse cumulative error，動態選擇需要重算的層/token
Limitations: reuse correctness 與模型/資料/策略相關；其 1.2×–16× TTFT speedup 為論文 workload 結果
改變了什麼：cache reuse 不再只有 exact prefix，而開始進入 vision token / layer selective reuse。

## Unknown / Open Questions

1. vLLM encoder identifier 是否已完整包含 model revision / projector revision / processor revision，還是目前主要依 model_id、processor kwargs、media hash、LoRA 等上游 identity？需要沿 `input_processor.py → MultiModalFeatureSpec → EC scheduler` 逐欄追。
2. Remote EC cache 在 rolling upgrade、不同 dtype/layout、不同 TP/PCP topology 間如何 namespace/invalidate？目前文件重點是 transfer/reuse，revision coherence 還不夠清楚。
3. Multimodal prefix block hash 對 image UUID/hash、placeholder range、partial-block boundary 的 exact serialization 是什麼？下一輪必須追 prefix hash source code，而不只依設計文件。

## 下一輪研究

`MultiModalFeatureSpec / identifier → Prefix Cache Block Hash → multimodal extra keys → partial block → cache_salt → KV Connector → cross-instance reproducibility → rolling-upgrade namespace`。

優先追：

1. vLLM `input_processor.py` 的 `_get_mm_identifier` 與 feature specs。
2. prefix cache block hash 的 exact tuple / serialization。
3. multimodal UUID/hash 如何進 block extra keys。
4. cache_salt 如何只在 first block 形成 descendant hash chain。
5. Mooncake/NIXL distributed KV/EC store 的 cross-process hash reproducibility。
6. model/processor/adapter revision 改變時，現有 cache 是否有 hard namespace boundary。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `ECConnectorProtocol`
- `ECConnectorSchedulerPlane`
- `ECConnectorWorkerPlane`
- `EncoderCacheMetadata`
- `ECSharedRegion`
- `PinnedSharedMmap`
- `EncoderCacheBlock`
- `EncoderCacheTier`
- `RemoteEncoderCacheTransfer`
- `EncoderComputationIdentity`
- `MultimodalPrefixBlock`
- `PartialMultimodalBlock`
- `VisualSpanReuse`
- `EncoderPrefixDualCache`
- `StageDisaggregatedMultimodalServing`
- `EPDStageGraph`
- `CrossStageFeatureTransfer`

新增 Edges：
- `mm_hash → indexes → EncoderCacheBlock`
- `SchedulerDecision → emits → ECConnectorMetadata`
- `ECConnectorMetadata → controls → WorkerCacheLoad`
- `GPUEncoderOutput → offloads_to → PinnedSharedMmap`
- `PinnedSharedMmap → reloads_to → GPUEncoderCache`
- `RemoteEncoderCacheTransfer → bypasses → VisionEncoderRecompute`
- `PrefixBlockHash → indexes → KVPrefixBlock`
- `PartialMultimodalBlock → requires → VisualSpanEmbedding`
- `EncoderCacheHit → supplies → VisualSpanEmbedding`
- `PrefixCacheHit → composes_with → EncoderCacheHit`
- `EncoderComputationIdentity → must_namespace → DistributedEncoderCache`

## 本輪結束判斷

缺哪一層：`MultimodalFeatureSpec → exact Prefix Block Hash serialization → distributed KV key`。

哪個節點最淺：`EncoderComputationIdentity` 的 revision namespace，目前部分是工程建模，尚未證明所有欄位已進現行 runtime key。

哪個概念仍只是名詞：`RollingUpgradeCacheNamespace`。

哪個系統值得讀原始碼：vLLM `input_processor.py + kv_cache_manager/prefix hashing + ec_transfer/cpu/session.py`，其次 vLLM-Omni stage connector。

哪篇論文需追引用：`vLLM-Omni`，因為它把 E/P/D 進一步泛化成任意 multimodal stage graph，會直接影響 Hermes 的 Execution Digital Twin。

哪個概念最適合視覺模擬：`Prefix HIT + Partial Block MISS + Encoder HIT` 的 dual-cache coherence。

哪個 Agent 架構最值得實作：本輪不是 Agent loop 主題；對 Hermes Runtime 最值得實作的是 `Stage Graph Planner + Cache Identity Inspector`，之後再把 Agent 的 image/browser/tool observations 映射到同一 perception cache graph。

## 來源分級

已確認原始碼：vLLM `ECConnectorBase`、`ECCPUConnector`、`ECSharedRegion`。

官方資訊：vLLM Disaggregated Encoder、CPU EC Connector、NIXL connector、vLLM security / prefix caching docs。

論文結果：EPD-Serve、vLLM-Omni、VLCache；所有效能數字僅視為各自實驗結果。

合理推論：`EncoderComputationIdentity` 完整 namespace 公式、rolling-upgrade invalidation model。

尚未驗證假說：跨不同 model/processor revision 的 remote EC store 是否已有自動 hard namespace，以及 exact multimodal prefix block extra-key serialization。