# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-22 10:52 Asia/Taipei

## 本小時主題
**Paged KV Cache × Page-Table Generation × Request/Attention Causal Contract**

本輪延續上一輪 Split-KV producer→combine→final O 的跨-kernel generation identity，但不再重複 FA4 kernel 內部細節；研究邊界向 serving runtime 上游移動：**Attention kernel 到底是如何知道「這個 request 的第 t 個 token 應讀哪一塊實體 K/V」？**

核心鏈：

`Request → Scheduler → Logical token positions → KV block allocation/reuse → Block table / page table → Physical KV pages → Attention kernel offsets → QK/PV → O → Residual`

---

## 本小時新發現

### 1. Page table 本身是模型計算語義的一部分，不只是 allocator metadata
vLLM current prefix-prefill kernel會以 absolute token position 算 logical block，再查 `B_Loc` / block table 得到 physical block，最後依 K/V layout 建 physical element offset。也就是 Attention 的 K/V operand identity 是透過 indirection 在 runtime 才解析。

因此新增：

`LogicalKVIdentity != PhysicalKVAddress`

以及：

`CorrectPhysicalAddress --does_not_prove→ CorrectLogicalTokenIdentity`

因為一個合法 GPU address 仍可能指向「另一個 request / generation 的合法 KV」。

### 2. vLLM block ID 是穩定 allocator identity，但 block content 可以被 eviction/reuse 改寫
current `BlockPool` 啟動時預先建立所有 `KVCacheBlock`，free queue同時承擔 allocation、free與 cache eviction ordering。prefix-cache hash map則把 block hash映射到一或多個 physical blocks。原始碼特別指出：為維持 block tables append-only，cache不會因 duplicate content就更換已配置的 block ID。

因此：

`KVBlockID --does_not_imply→ KVContentGeneration`

必須新增：

`KVPhysicalBlockGeneration = BlockID + ReuseEpoch + ContentIdentity`

### 3. Prefix-cache hit 是 content/provenance decision，不只是 memory reuse
vLLM current設計用 prefix-chain block hash做 prefix caching；block還帶 group identity。current source建立 block events時也會保存 token_ids、block_size、LoRA identity、extra keys、group index、session identity。這證明「可安全重用」需要比 physical block ID更豐富的上下文 identity。

新增：

`KVReuseCompatibilityContract = TokenPrefixHash + Model/LayerGroupContext + MultimodalExtraKeys + AdapterIdentity + CacheSalt/SessionPolicy`

注意：上述欄位的精確 hash inclusion需逐項依 current implementation驗證；此處把 event/provenance欄位與 reuse safety contract分開，不把 event metadata誤當全部 hash key。

### 4. Attention kernel與KV allocator之間存在 ownership boundary
FlashInfer current docs明確說它負責「依 caller 提供的 page table 對 paged KV 做 attention」，但不負責 page-table allocation/pop/reclamation策略；這些由 serving engine管理。其 paged decode contract要求 `indptr / indices / last_page_len` 或 native CSR page metadata，並在 device上讀取 live lengths/page tables。

因此真正 architecture 是：

`Serving Scheduler/Cache Manager --publishes→ PageTableGeneration --consumed_by→ Attention Backend`

不是「Attention backend 自己知道 request KV」。

### 5. Token-level virtualization顯示 block generation未來還會再被拆細
2026 vToken指出：PagedAttention的固定block allocation雖降低allocator fragmentation，但token-level eviction會產生block內不可回收空洞；其做法增加 token-table indirection，保持 stable logical token view，同時非同步repack live tokens，並保留 PagedAttention kernels與CUDA Graph compatibility。論文報告 retained KV blocks/request下降27.2%–72.3%，SLA throughput最高1.37×、受限KV budget下最大concurrency最高2×。

這表示 Hermes KG 不能把 `BlockID` 當最低層 semantic identity；未來至少需要：

`LogicalTokenIdentity → TokenTableGeneration → PhysicalSlotGeneration → PhysicalBlockGeneration`

---

# 本小時最重要 5 個發現

## 1. PageTableGeneration
**是什麼**：request logical KV sequence到physical page list的一次具版本語義映射。

**底層**：
`token position → logical block index → page-table entry → physical block ID → layout stride → K/V element address`

**重要性**：沒有generation，block table即使shape完全正確，也可能是stale mapping。

**限制**：目前尚未取得production request-scoped page-table mutation trace。

## 2. KVPhysicalBlockGeneration
**是什麼**：同一 physical block ID 每次被重新配置/填入不同KV後，必須視為不同generation。

**底層**：
`free/evict → allocation → write K/V → publish mapping → read → unpin/free → reuse`

**重要性**：GPU memory sanitizer只能證明address合法，不能證明semantic generation正確。

## 3. PrefixReuseProvenance
**是什麼**：reuse的正確性依賴內容hash與上下文條件，而非「某頁還有資料」。

**底層**：
`request tokens/context → block hash chain → cache lookup → group compatibility → block pin/ref → block-table publication`

**限制**：不同framework的hash extra keys不一致，需要framework-specific contract。

## 4. Backend/Allocator Boundary
**是什麼**：FlashInfer類kernel library消費page table，但不管理其生命週期。

**重要性**：錯誤可能在kernel完全正確時，由scheduler提供stale/wrong page table造成。

新增 failure：`VALID_KERNEL_WRONG_PAGE_TABLE_GENERATION`。

## 5. Logical-token virtualization
**是什麼**：vToken把token liveness與physical placement進一步解耦。

**重要性**：未來觀測工具必須追 semantic token lineage，而不能只畫GPU page。

---

# Architecture Breakdown

```text
User Request
  ↓
Tokenizer / prompt assembly
  ↓
Scheduler Request Identity
  ↓
Prefix-cache lookup
  ├─ hit → existing KV content generation
  └─ miss → allocate physical blocks
  ↓
Logical token → block mapping
  ↓
PageTableGeneration G
  ↓
Attention launch descriptor
  ↓
Kernel reads page-table metadata
  ↓
logical token position
  → logical block
  → physical block
  → physical K/V offset
  ↓
QK → softmax → PV
  ↓
O / Split-KV O_partial+LSE
  ↓
Final O
```

跨層 invariant：

`AttentionKVOperandCorrect = RequestIdentityMatch ∧ PageTableGenerationMatch ∧ LogicalTokenRangeMatch ∧ PhysicalBlockGenerationMatch ∧ KVContentGenerationMatch ∧ PositionEncodingGenerationMatch`

---

# Bottom-Level Logic

Paged K/V address resolution不可簡化為「讀cache」：

```text
request_id
→ sequence_length
→ token_position t
→ logical_block = floor(t / block_size)
→ offset_in_block = t mod block_size
→ physical_block = page_table[request, logical_block]
→ K_address = K_pool[physical_block, kv_head, offset_in_block, d]
→ V_address = V_pool[physical_block, kv_head, offset_in_block, d]
→ attention math
```

若 page table是舊generation：

```text
request G8
→ stale table G7
→ physical block 41
→ address valid
→ dtype valid
→ bounds valid
→ semantic KV wrong
```

這是典型 **semantic use-after-reuse**，不是傳統memory OOB。

---

# Visual Simulation Idea

## KV Page-Table & Generation Microscope

互動視圖分四層：

1. **Logical Tokens**：t0…tN，標request/layer/head/position。
2. **Page Table**：logical block→physical block箭頭，支援切換 G7/G8。
3. **Physical KV Pool**：block ID、reuse epoch、ref count、hash/content generation。
4. **Attention Kernel**：顯示當前Q tile實際解析出的K/V address與semantic token。

故障注入：
- `STALE_PAGE_TABLE_GENERATION`
- `KV_BLOCK_REUSED_BEFORE_CONSUMER_QUIESCENCE`
- `PREFIX_HASH_CONTEXT_MISMATCH`
- `LOGICAL_TOKEN_TO_PHYSICAL_SLOT_ALIAS`
- `VALID_ADDRESS_WRONG_REQUEST_KV`
- `POSITION_ENCODING_GENERATION_MISMATCH`

UI最重要的對照不是 address red/green，而是：

`Memory Safe ✓ | Semantic Generation ✗`

---

# Code / GitHub

### vLLM
值得繼續讀：
- `vllm/v1/core/block_pool.py` — allocation/free/cache eviction/hash mapping/reuse watchers
- `vllm/v1/core/kv_cache_manager.py` — request→blocks lifecycle
- `vllm/v1/core/kv_cache_utils.py` — `KVCacheBlock`, hash, free queue
- `vllm/v1/attention/ops/prefix_prefill.py` — logical token→physical K/V offset
- scheduler與attention backend metadata builder — 下一輪重點

本輪current source確認 `BlockPool`預建block pool、free queue負責allocation/free/eviction，並維護cached hash→block映射；source另有 `_reuse_watchers` 用於已unpin但仍被讀取、直到pool reuse才完成的情境，這對建立 consumer-quiescence/reuse frontier特別重要。

### FlashInfer
current paged-attention API顯示kernel consumption contract：page indices/indptr/last-page length、live seq lengths、page table由caller提供；FlashInfer本身不負責page-table管理。

---

# Papers

## vToken: Token-Level Virtualization for Reclaimable KV Caches
- Authors: Yuanhang Gao, Xiangrui Yang, Yuanfeng Chen, Hongjia Chen, Qianru Lv, Wenfei Wu, Dongsheng Li
- Year: 2026
- URL: https://arxiv.org/abs/2608.13263
- Architecture: token-table indirection + asynchronous live-token repacking + unchanged PagedAttention kernel interface
- Contribution: 將logical token liveness與physical block placement解耦
- Dataset/Workloads: H2O, Random, Scissorhands policies across evaluated models
- Limitation: 目前論文結果不能直接證明所有production serving engine在concurrent mutation下的generation safety
- 改變了什麼：把KV virtualization由block級推向token級

## SparseX: Efficient Segment-Level KV Cache Sharing for Interleaved LLM Serving
- Authors: Quqing Zhang et al.
- Year: 2026
- URL: https://arxiv.org/abs/2606.01751
- Architecture: segment-level cache lookup + PagedAttention + RoPE alignment + Sparse-Q selection + Sparse-KV recomputation
- Contribution: reuse從identical prefix擴展到non-prefix/cross-turn/cross-agent repeated segments
- Limitation: segment reuse引入更複雜的contextual correction/provenance contract
- 改變了什麼：說明Agent/RAG workload的KV identity不能永遠只用prefix-chain描述

---

# Unknown / Open Questions

1. vLLM scheduler從request block table到attention backend metadata tensor的**精確generation publication point**在哪裡？
2. `_reuse_watchers` 與GPU stream/event completion如何形成「最後consumer完成→block可安全reuse」的production causal witness？
3. prefix caching在multimodal inputs、LoRA、cache salt、RoPE/position variants下，哪些identity實際進hash，哪些只存在event/provenance metadata？

---

# 下一輪研究

`Request → Scheduler → KVCacheManager → BlockPool → block table tensor build → GPU upload/device metadata → attention backend launch → page-table read → physical KV access → stream completion → unpin/free/reuse`

優先追：
1. `kv_cache_manager.py`
2. scheduler block-table metadata construction
3. FlashAttention/FlashInfer backend metadata adapter
4. CUDA stream/event與reuse watcher
5. 建立 `PageTablePublicationWitness`、`KVConsumerQuiescenceWitness`、`SafeBlockReuseFrontier`

---

# Knowledge Graph 新增 Node / Edge

### Nodes
- `LogicalKVIdentity`
- `PageTableGeneration`
- `PageTablePublicationWitness`
- `KVPhysicalBlockGeneration`
- `KVContentGeneration`
- `KVReuseCompatibilityContract`
- `PrefixReuseProvenance`
- `LogicalTokenIdentity`
- `TokenTableGeneration`
- `PhysicalSlotGeneration`
- `AttentionKVOperandIdentity`
- `KVConsumerQuiescenceWitness`
- `SafeBlockReuseFrontier`

### Edges
- `LogicalTokenIdentity --resolved_by→ PageTableGeneration`
- `PageTableGeneration --maps_to→ KVPhysicalBlockGeneration`
- `KVPhysicalBlockGeneration --contains→ KVContentGeneration`
- `AttentionLaunch --consumes→ PageTableGeneration`
- `PrefixReuseProvenance --authorizes→ KVContentReuse`
- `KVConsumerQuiescenceWitness --permits→ SafeBlockReuseFrontier`
- `KVBlockID --does_not_prove→ KVContentGeneration`
- `CorrectPhysicalAddress --does_not_prove→ CorrectLogicalTokenIdentity`
- `MemorySafetyWitness --does_not_prove→ KVSemanticGenerationCorrectness`

---

# 本輪結論

- **缺哪一層**：scheduler/block-table metadata到GPU attention launch的generation publication與completion trace。
- **最淺節點**：`PageTablePublicationWitness`。
- **仍只是名詞**：production request-scoped `KVConsumerQuiescenceWitness`。
- **最值得讀原始碼**：vLLM `kv_cache_manager.py` + scheduler metadata builder + `block_pool.py` reuse watcher path。
- **最值得追引用**：vToken，因它直接挑戰「physical block就是KV identity」的假設；SparseX則值得追Agent/RAG跨segment reuse。
- **最適合視覺模擬**：KV Page-Table & Generation Microscope。
- **最值得實作的 Agent 架構**：`State-grounded Planner + Request/KV Generation Tracker + Page-Table Provenance Verifier + Prefix-Reuse Compatibility Verifier + Consumer-Quiescence Trace Joiner + Attention Output Causal Joiner + Evidence Gate + Tool Executor`。

本輪最大的推進：**Hermes 的 Attention provenance 已從「kernel怎麼算O」跨到「kernel讀到的K/V究竟屬於哪個request、哪個logical token、哪一代physical block」。這補上從 serving scheduler / KV memory virtualization 到 GPU Attention 的關鍵中間層，也揭露一類最危險的錯誤：GPU address、shape、dtype與bounds全部正確，但模型其實讀到了錯誤generation的KV。**
