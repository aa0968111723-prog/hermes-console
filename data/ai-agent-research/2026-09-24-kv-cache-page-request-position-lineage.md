# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 06:52（Asia/Taipei）

## 本小時研究主題
**KV Cache Page Lineage × Request/Sequence Identity × Position/RoPE × PagedAttention × TokenGenerationWitness**

本輪承接上一輪 `GPUExecutionReplayWitness → Attention Q/K/V → KV Cache block/page → Request/Sequence Identity → Position → RoPE → Attention → Logits`，不重複 CUDA Graph / allocation provenance，而是回答：**合法 GPU execution 如何證明讀到的是正確 request、正確 sequence、正確 logical token positions 的 KV state？**

---

## 本小時新發現

1. **PagedAttention 的核心不是「KV cache 分頁」而已，而是 logical token/block → physical KV block 的映射。** vLLM 的 PagedAttention kernel依 block table取得 `physical_block_number`，再用 physical block offset/head stride計算實際 K/V address。
2. **Current vLLM V1 已把 block table 明確做成 request-row state。** `BlockTables` 保存 `[max_num_reqs, max_num_blocks]`，`append_block_ids(req_index, ...)` 把 scheduler配置的 physical block IDs寫入該 request row；forward前再 gather成 model input block tables。
3. **Current vLLM 原始碼已直接承認 stale block-id / reallocation hazard。** CUDA graph dummy path會把 persistent input block table row清零，註解說 previous real step 的 stale block IDs 可能指向已 freed and reallocated blocks。這正是上一輪 ABA allocation identity問題在 KV cache層的具體實例。
4. **KV block可跨 request共享是功能，不一定是 bug。** PagedAttention/vLLM與 TensorRT-LLM 都支援 prefix/KV reuse。因此 provenance不能要求 `physical block → exactly one request`；應要求 `physical block generation → approved semantic prefix identity → authorized request bindings`。
5. **TensorRT-LLM current KV system已有 cross-request reuse、partial reuse、eviction、KV events；attention系統還有 cyclic cache、beam `cache_indirection`。** 因此 request→KV lineage不只是一張 page table，而是會隨 reuse/eviction/copy/beam path/window overwrite演化的 generation graph。

---

# 本小時最重要 5 個發現

## 1. Block table 是 attention 的語意地址轉譯層

### 是什麼
對 paged KV cache，logical sequence position並不直接等於 GPU physical address。需要：

`Request/Sequence → Logical KV Block → Block Table Entry → Physical KV Block → Token Offset → Head → K/V address`

### 底層如何運作
以 vLLM current design：scheduler/core分配 `KVCacheBlock.block_id`；worker端 `BlockTables.append_block_ids(req_index, ...)` 把 block IDs寫入 request row；GPU attention依 block table讀 physical block number，再計算 K/V pointer。

### 為什麼重要
因此：

`Correct K/V bytes in GPU memory --does_not_prove→ Correct Request Read Them`

真正需要驗證的是 **address translation lineage**。

### 限制
不同 backend（FlashAttention/FlashInfer/TensorRT-LLM）page-table layout與kernel ABI不同，不能把 vLLM欄位當成 portable標準。

---

## 2. Physical block ID 不是穩定 identity：必須加入 generation

Current vLLM dummy CUDA-graph path特別把 persistent block-table rows zero掉，原因是 stale block IDs可能指向 blocks since freed and reallocated。

所以：

`SamePhysicalBlockId --does_not_prove→ SameKVSemanticState`

新增：

`KVPhysicalBlockGeneration = H(poolGeneration, physicalBlockId, allocationEpoch, dtype/layout, layerGroup, device/rank)`

這與上一輪 `AllocationGenerationIdentity` 接起來，但更高一層：allocation generation只證明 storage object；KV block generation還必須證明該 storage目前承載哪一代 token-state。

---

## 3. Prefix sharing迫使 provenance從 ownership模型升級成 semantic-content模型

PagedAttention論文的主要貢獻之一就是允許 KV cache在 request內/跨 request靈活共享；TensorRT-LLM current system也會將已填滿 blocks放進 search structure，讓後續 matching-prefix request重用，並允許 partial reuse。

所以錯誤模型是：

`KVBlock.owner_request_id`

更合理的是：

`KVBlockSemanticIdentity = H(modelGeneration, adapterGeneration, attentionLayerGroup, tokenPrefixIdentity, positionEncodingGeneration, KVdtype/quantization, blockTokenRange)`

然後：

`RequestSequenceGeneration --authorized_to_read→ KVBlockSemanticIdentity`

同一 semantic prefix可以被多個 request合法引用。

---

## 4. Position lineage 是 KV correctness 的一部分

K/V不是只有 token內容；Transformer attention還依賴 token position，RoPE類模型尤其把 position資訊旋轉進 Q/K representation。

因此：

`SameTokenPrefix + SameKVBytesSchema --does_not_prove→ SameAttentionSemantics`

Hermes需加入：

`PositionEncodingGeneration = H(positionIds, ropeConfig, ropeScaling, slidingWindowPolicy, sequenceOffset, modelGeneration)`

TensorRT-LLM cyclic KV cache會覆寫較舊 cache slot；beam search又用 `cache_indirection[sequence][beam][token]`重建正確 path。這顯示 logical token position/path不能從 physical slot位置直接推導。

---

## 5. KV reuse安全邊界已開始成為 serving runtime 的顯式功能

TensorRT-LLM current KV cache文件描述跨 request reuse，且版本文件已提供 cache-salt式隔離機制；KV cache events還能輸出 block stored/removed/created/updated，供外部 KV-aware router使用。

對 Hermes 的意義：KV provenance不應只藏在 GPU kernel trace裡，而可形成一等事件流：

`KV_BLOCK_ALLOCATED`
`KV_BLOCK_FILLED`
`KV_BLOCK_SEMANTIC_HASHED`
`KV_BLOCK_SHARED`
`KV_BLOCK_PARTIAL_COPIED`
`KV_BLOCK_EVICTED`
`KV_BLOCK_REALLOCATED`
`KV_BLOCK_TABLE_BOUND`
`KV_ATTENTION_READ`

---

# Architecture Breakdown

```text
RequestGeneration
  ↓
SequenceGeneration
  ↓
TokenPrefixIdentity
  ↓
PositionEncodingGeneration
  ↓
Scheduler / KVCacheManager
  ↓
LogicalKVBlockIdentity
  ↓
KVBlockSemanticIdentity
  ↓
PhysicalBlockGeneration
  ↓
Request Block-Table Generation
  ↓
PagedAttention Page Translation
  ↓
K/V Address
  ↓
Attention Kernel
  ↓
AttentionOutputGeneration
  ↓
Residual / MLP / LM Head
  ↓
LogitsGeneration
  ↓
Sampling
  ↓
TokenGenerationWitness
```

### Trust boundary

```text
Approved GPU kernel
        ≠
Approved KV mapping
        ≠
Approved KV semantic state
        ≠
Approved sequence/position lineage
        ≠
Approved token output
```

---

# Bottom-Level Logic

## Paged KV address translation

抽象化：

```text
logical_token_position
→ logical_block_index = position // block_size
→ block_offset = position % block_size
→ physical_block = block_table[request_row][logical_block_index]
→ K/V base + physical_block * block_stride
→ + kv_head * head_stride
→ + block_offset * token_stride
→ K/V vector
```

vLLM current paged-attention文件與kernel說明顯示 K pointer正是由 `physical_block_number`、KV head與 physical block offset計算。

## 新 witness

```text
KVPageBindingWitness = H(
  requestGeneration,
  sequenceGeneration,
  blockTableGeneration,
  logicalBlockIndex,
  physicalBlockGeneration,
  kvBlockSemanticIdentity,
  tokenRange,
  positionEncodingGeneration,
  modelGeneration
)
```

## Attention State Lineage Witness

```text
AttentionStateLineageWitness = MerkleRoot(
  QGeneration,
  ordered KVPageBindingWitnesses,
  maskGeneration,
  positionEncodingGeneration,
  attentionKernelInvocationWitness
)
```

這是 Hermes architecture proposal，不是 vLLM / NVIDIA既有標準。

---

# Visual Simulation Idea

## **Paged KV Cache → Token Attention Lineage Microscope**

UI 左到右：

`Requests | Sequences | Token Positions | Logical Blocks | Block Table | Physical KV Pool | Q/K/V | Attention | Logits | Token`

互動時點擊 request，可高亮：
- request/sequence generation
- token positions
- logical KV blocks
- physical blocks
- shared prefix blocks
- block generation/epoch
- RoPE/position generation
- attention讀取的實際 pages
- 最終 logit/token lineage

### Fault Injection

`BLOCK_ID_REUSED_AFTER_FREE`
`WRONG_REQUEST_ROW_SELECTED`
`BLOCK_TABLE_STALE_AFTER_PREEMPTION`
`PREFIX_HASH_COLLISION_OR_BAD_BINDING`
`CROSS_REQUEST_REUSE_WITH_WRONG_NAMESPACE`
`PARTIAL_REUSE_WRONG_TOKEN_BOUNDARY`
`POSITION_IDS_SHIFTED`
`ROPE_SCALING_CHANGED`
`CYCLIC_CACHE_OVERWRITE_WRONG_WINDOW`
`BEAM_CACHE_INDIRECTION_WRONG_PATH`
`KV_DTYPE_OR_SCALE_CHANGED`
`REMOTE_KV_PAGE_FROM_WRONG_MODEL_GENERATION`

---

# Code / GitHub

## vLLM
Repository: https://github.com/vllm-project/vllm

值得繼續看的核心檔案：
- `vllm/v1/core/kv_cache_manager.py` — scheduler/KV allocation interface、block IDs、cache lifecycle
- `vllm/v1/core/block_pool.py` — physical block pool、free/reuse/cache state
- `vllm/v1/core/kv_cache_coordinator.py` — heterogeneous/hybrid cache coordination
- `vllm/v1/core/single_type_kv_cache_manager.py` — per-attention-type allocation/reuse
- `vllm/v1/worker/block_table.py`
- `vllm/v1/worker/gpu/block_table.py` — request-row block tables、slot mappings、CUDA-graph persistent inputs
- paged attention CUDA/Triton kernels — logical→physical KV translation
- `vllm/distributed/kv_transfer/` — disaggregated/remote KV lineage，下一階段很重要

Current source確認：`KVCacheBlocks`把每 group的 `KVCacheBlock`轉為 physical `block_id`；GPU `BlockTables`維護 request rows，並在 CUDA graph dummy path主動清 stale block IDs，因為 blocks可能已 free/reallocate。

## TensorRT-LLM
值得追：`KVCacheManager`、block reuse、partial reuse、KV cache events、cache salt、cyclic KV、beam `cache_indirection`。

## FlashInfer
其 XQA/paged KV API顯式接受 `k_cache`, `v_cache`, `page_table`，適合拿來比較 portable `KVPageBindingWitness` 的最小欄位。

---

# Papers

## Efficient Memory Management for Large Language Model Serving with PagedAttention
- **Authors:** Woosuk Kwon, Zhuohan Li, Siyuan Zhuang, Ying Sheng, Lianmin Zheng, Cody Hao Yu, Joseph E. Gonzalez, Hao Zhang, Ion Stoica
- **Institution:** UC Berkeley；Ying Sheng亦列 Stanford；Cody Hao Yu為 Independent Researcher；Hao Zhang為 UC San Diego
- **Year:** 2023, SOSP '23
- **URL:** https://arxiv.org/abs/2309.06180
- **Code:** https://github.com/vllm-project/vllm
- **Dataset/workloads:** LLM serving workloads / model serving evaluations；不是單一訓練 dataset論文
- **Architecture:** virtual-memory-inspired KV blocks + logical→physical mapping + sharing/copy-on-write + continuous serving
- **Contribution:** 將 KV cache memory從 contiguous per-request allocation改成 paged blocks，降低 fragmentation並支援 sharing；論文報告相較 FasterTransformer/Orca在相同 latency下有 2–4× throughput提升。
- **Limitations:** 原論文核心主要是效率/記憶體管理，不提供本研究所要求的 cryptographic request→page→position provenance；現代 hybrid attention、remote KV、quantized KV、speculative decoding也超出原始簡化模型。
- **改變了什麼:** 把 KV cache從「tensor buffer」提升成類 virtual-memory subsystem；本輪再把它提升成 AI execution provenance 的 address-translation layer。

## Jenga: Effective Memory Management for Serving LLM with Heterogeneity
- **Authors:** Chen Zhang et al.
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2503.18292
- **Architecture:** two-level allocator + layer-specific cache policy for heterogeneous embeddings/access patterns
- **Contribution:** 指出現代 heterogeneous model讓單一 homogeneous PagedAttention memory abstraction不再足夠。
- **本研究意義:** `KVBlockSemanticIdentity` 必須包含 layer/cache-group kind，而不能假設所有 layers共享同一 page geometry與 retention policy。

---

# 已確認事實 / 推論邊界

### 已確認（官方/原始碼/論文）
- PagedAttention使用 logical→physical block mapping並支援 KV sharing。
- vLLM current worker block table按 request row保存 physical block IDs。
- vLLM current source明確防止 CUDA graph dummy run使用 stale、已 free/reallocated的 block IDs。
- TensorRT-LLM current KV manager支援 block reuse、partial reuse、eviction與 KV events。
- cyclic/window cache與 beam indirection會讓 physical cache location和 logical sequence path進一步分離。

### 工程推論
- request→page→position lineage應成為高風險 AI runtime attestation的一部分。
- block ID需搭配 generation/semantic identity，單一 integer ID不足。

### Hermes proposal / 尚未標準化
- `KVPhysicalBlockGeneration`
- `KVBlockSemanticIdentity`
- `KVPageBindingWitness`
- `AttentionStateLineageWitness`
- 以 Merkle root對每 token的完整 KV read-set做 attestation

---

# Unknown / Open Questions

1. **如何低成本建立每 token 的 KV read-set witness？** 對每 layer/head/page完整記錄可能造成巨大 tracing overhead，需要 page-range aggregation / sampled attestation / Merkle accumulator。
2. **跨節點 disaggregated prefill/decode 時，remote KV page identity如何跨 transport、GPU rank、RDMA buffer保持 lineage？**
3. **Prefix caching 的 semantic identity究竟要 hash token IDs、model/adapter generation、RoPE config、attention mask、multimodal encoder prefix到哪一層，才足以避免錯誤 reuse？**

---

# Knowledge Graph 新增 Node / Edge

### Nodes
- `RequestGeneration`
- `SequenceGeneration`
- `TokenPrefixIdentity`
- `LogicalKVBlockIdentity`
- `KVPhysicalBlockGeneration`
- `KVBlockSemanticIdentity`
- `KVBlockTableGeneration`
- `KVPageBindingWitness`
- `PositionEncodingGeneration`
- `RoPEGeneration`
- `KVReuseAuthorization`
- `KVPartialReuseGeneration`
- `KVEvictionGeneration`
- `BeamCacheIndirectionGeneration`
- `AttentionStateLineageWitness`
- `LogitsGeneration`
- `TokenGenerationWitness`

### Edges
```text
RequestGeneration --owns--> SequenceGeneration
SequenceGeneration --contains--> TokenPrefixIdentity
TokenPrefixIdentity --requires--> LogicalKVBlockIdentity
LogicalKVBlockIdentity --maps_via--> KVBlockTableGeneration
KVBlockTableGeneration --resolves_to--> KVPhysicalBlockGeneration
KVPhysicalBlockGeneration --carries--> KVBlockSemanticIdentity
RequestGeneration --authorized_to_read--> KVBlockSemanticIdentity
PositionEncodingGeneration --conditions--> KVBlockSemanticIdentity
KVPageBindingWitness --binds--> SequenceGeneration
KVPageBindingWitness --binds--> KVPhysicalBlockGeneration
AttentionStateLineageWitness --consumes--> KVPageBindingWitness
AttentionStateLineageWitness --produces--> AttentionOutputGeneration
AttentionOutputGeneration --contributes_to--> LogitsGeneration
LogitsGeneration --sampled_as--> TokenGenerationWitness
KVEvictionGeneration --invalidates--> KVPhysicalBlockGeneration
KVPartialReuseGeneration --derives_from--> KVBlockSemanticIdentity
```

---

# 本輪結束判定

- **缺哪一層：** KV/attention state → residual stream → final hidden state → LM head logits → sampling RNG/policy → token。
- **哪個節點最淺：** `KVBlockSemanticIdentity`，尤其 multimodal prefix、adapter、remote KV、quantized KV時的完整 semantic hash欄位。
- **哪個概念仍只是名詞：** portable signed `AttentionStateLineageWitness`。
- **哪個系統最值得讀原始碼：** vLLM `block_pool.py + kv_cache_manager.py + distributed/kv_transfer`，其次 TensorRT-LLM KVCacheManager。
- **哪篇論文需追引用：** PagedAttention SOSP 2023，下一步追 disaggregated KV serving、prefix caching與 heterogeneous KV memory研究。
- **哪個概念最適合視覺模擬：** **Paged KV Cache → Token Attention Lineage Microscope**。
- **哪個 Agent 架構最值得實作：** `Risk-aware Agent Runtime + Request/Sequence Generation + KV Page Lineage + Attention State Witness + TokenGenerationWitness + Runtime Attestation + MCP SemanticCommit/Receipt`。

---

# 下一輪研究

鎖定：

`AttentionStateLineageWitness → Residual Stream → RMSNorm/LayerNorm → MLP/MoE routing → Final Norm → LM Head → logits → temperature/top-k/top-p → RNG state → token selection → TokenGenerationWitness`

並開始把 **model reasoning** 與 **system reasoning**正式分層：模型內部是 tensor/token state transformation；Agent runtime則是對輸出 token/tool-call進行 state-machine / planner / policy / permission決策。

下一個核心問題：**即使 Q/K/V、KV page、request、position與 attention read-set全部可信，Hermes如何證明最後輸出的 token確實來自這一代 hidden state/logits，以及 sampling參數、RNG state、logit processors與 speculative decoding沒有在最後一步改變 token lineage？**