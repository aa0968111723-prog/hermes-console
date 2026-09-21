# 【AI Agent × Multimodal Research Report】

**時間：2026-09-21 13:51（Asia/Taipei）**  
**主題：Paged KV Translation × Physical Page Identity × Attention Read Contract**

## 本小時新發現

本輪延續前一輪 `ForwardConsumptionEpoch → paged-KV logical→physical translation → actual Attention kernel memory read` 的缺口，不再研究 transport completion，而是進入 vLLM/FlashInfer 的 page-table 與 kernel metadata path。

核心結論：`ObservedPhysicalKVReadSet` 仍不能直接宣稱已觀測，但 `ExpectedPhysicalKVReadSet` 已可從 runtime metadata 具體建模，而不是名詞。vLLM 的 CommonAttentionMetadata 明確攜帶 `seq_lens`、`block_table_tensor` 與 `slot_mapping`；GPU block-table implementation 再把 request logical position 經 kernel block size、block table lookup 轉成 slot id。FlashInfer backend則把 vLLM block table複製成 `paged_kv_indices`，再連同 `paged_kv_indptr` / `last_page_len` 傳給 paged-attention wrapper。

### 本小時最重要 5 個發現

1. **Logical token → physical KV slot 的公式已在 vLLM production code中明確存在。**
   - 非 context parallelism common case：`block_index = position // kernel_block_size`；`block_offset = position % kernel_block_size`；`block_number = block_table[request, block_index]`；`slot_id = block_number * kernel_block_size + block_offset`。
   - 這讓 `LogicalToPhysicalKVTranslationWitness` 可被 instrumentation，而不是抽象推論。
   - 限制：CP/DCP、hybrid block與特殊 backend會修改 mapping。

2. **Block table與slot mapping扮演不同角色。**
   - `slot_mapping`主要描述本 step scheduled tokens寫入/更新 KV 的物理 slot。
   - attention讀取歷史 context時，backend可直接消費 block/page table + sequence lengths來遍歷歷史 pages。
   - 因此不能把 `slot_mapping` 誤當成完整 historical read set。

3. **FlashInfer提供清楚的 physical-page boundary。**
   - vLLM FlashInfer builder把 `block_table_tensor` 的實際 page IDs複製到 `paged_kv_indices`。
   - FlashInfer的 paged KV介面定義 `paged_kv_indptr`為 request page ranges、`paged_kv_indices`為 physical page IDs、`last_page_len`為最後一頁有效 token數。
   - 因此對 dense full-context attention，`ExpectedPhysicalKVPageSet(request)` 可由 page-table row與有效 seq_len決定。

4. **CUDA Graph使 metadata identity成為 correctness的一部分。**
   - FlashInfer CUDA-Graph wrapper要求 caller預留 persistent indptr/indices/last-page-len buffers，batch size在wrapper lifecycle內不可改。
   - vLLM GPU block-table也明確保留 persistent input block tables；dummy graph run會清零 rows，避免 stale block IDs指向已 free/reallocated blocks。
   - 新結論：`PhysicalReadContract` 必須包含 `PageTableGeneration` 與 persistent metadata buffer generation，不能只包含 KV block lease。

5. **Kernel可能讀取比語義有效 token更粗的物理區域。**
   - FlashInfer CuTe DSL文件指出TMA paged kernel可能 over-read full pages，再靠 masking排除語義無效位置。
   - 所以必須區分 `SemanticKVReadSet`、`ExpectedPhysicalPageFootprint`、`ObservedMemoryLoadFootprint`。這三者不一定相等。

## Architecture Breakdown

```text
Scheduler / KV Manager
  → request block IDs
  → BlockTable row
  → gather input_block_tables
  → CommonAttentionMetadata
       ├─ seq_lens
       ├─ block_table_tensor
       └─ slot_mapping
  → backend metadata builder
  → FlashInfer paged_kv_indptr / paged_kv_indices / last_page_len
  → paged attention kernel
  → physical K/V page loads
  → mask / softmax
  → attention output
  → residual stream
```

vLLM block table additionally支援 manager block size與kernel block size不同時的 virtual splitting；因此 `KVManagerBlockIdentity` 與 `KernelPageIdentity` 也不能永遠視為一對一。

## Bottom-Level Logic

### 1. Write-side logical → physical slot

```text
position p
→ local_position(p, CP topology)
→ kernel_block_index = floor(local_position / kernel_block_size)
→ physical_block = block_table[request, kernel_block_index]
→ block_offset = local_position mod kernel_block_size
→ slot_id = physical_block * kernel_block_size + block_offset
```

### 2. Read-side page set

對 dense paged attention可建立：

```text
request row
→ seq_len
→ num_live_pages = ceil(seq_len / page_size)
→ page range = paged_kv_indptr[r] : paged_kv_indptr[r+1]
→ physical page IDs = paged_kv_indices[range]
→ final valid tokens constrained by last_page_len
→ semantic token mask
→ attention kernel physical page footprint
```

### 3. 三種 read set必須永久區分

```text
SemanticKVReadSet
= 模型語義上允許參與 attention 的 token/KV positions

ExpectedPhysicalKVReadSet
= 由 page table + seq_len + window/mask + backend layout推導的預期物理 pages/slots

ObservedPhysicalKVReadSet
= 真正由 GPU memory tracing / instrumented kernel取得的 memory load footprint
```

新增否定 edge：

```text
slot_mapping --does_not_equal→ HistoricalAttentionReadSet
ExpectedPhysicalKVReadSet --does_not_prove→ ObservedPhysicalKVReadSet
PhysicalPageLoaded --does_not_imply→ SemanticTokenContributed
```

最後一條尤其重要：kernel可以整頁load，mask後某些token不會進入softmax有效集合。

## Visual Simulation Idea

### Paged KV Translation Microscope

互動介面同時畫五層：

```text
Logical Tokens
0 1 2 3 | 4 5 6 7 | 8 9
     ↓ page translation
Block Table
logical page 0 → physical page 17
logical page 1 → physical page 03
logical page 2 → physical page 42
     ↓
Physical KV Pool
P03   P17   P42   P55 ...
     ↓ kernel footprint
Loaded pages: 17,03,42
     ↓ semantic mask
Effective tokens: 0..9
     ↓
Attention weights / output delta
```

可切換：page size、sliding window、CP rank、hybrid manager/kernel block size、page reuse generation、stale graph metadata、TMA full-page over-read。Failure states：`PAGE_TABLE_GENERATION_MISMATCH`、`STALE_PHYSICAL_PAGE_ID`、`SLOT_MAPPING_MISATTRIBUTED_AS_READ_SET`、`PHYSICAL_FOOTPRINT_EXCEEDS_SEMANTIC_SET`、`GRAPH_METADATA_BUFFER_STALE`。

## Code / GitHub

值得繼續讀：

- `vllm/v1/worker/block_table.py`：CPU/通用 BlockTable、slot mapping與manager→kernel block mapping。
- `vllm/v1/worker/gpu/block_table.py`：GPU-native block table、persistent forward tables、Triton slot mapping kernel。
- `vllm/v1/attention/backend.py`：`CommonAttentionMetadata` contract。
- `vllm/v1/attention/backends/flashinfer.py`：vLLM block table → FlashInfer page metadata。
- 下一輪：FlashInfer/Triton/CUDA attention kernel內部，追 physical page ID如何變成 pointer arithmetic與global-memory loads。

## Papers

### Efficient Memory Management for Large Language Model Serving with PagedAttention
- Authors: Woosuk Kwon, Zhuohan Li, Siyuan Zhuang, Ying Sheng, Lianmin Zheng, Cody Hao Yu, Joseph E. Gonzalez, Hao Zhang, Ion Stoica
- Institution: UC Berkeley/affiliated authors
- Year: 2023
- URL: https://arxiv.org/abs/2309.06180
- Code: https://github.com/vllm-project/vllm
- Architecture: OS-style paging for KV cache + PagedAttention
- Contribution: 將 request logical KV blocks與non-contiguous physical blocks解耦，降低fragmentation並支援sharing。
- Limitations for current research: 論文描述paging abstraction，但不足以證明current production backend逐 memory-load footprint；需要與2026原始碼交叉驗證。

### Jenga: Effective Memory Management for Serving LLM with Heterogeneity
- Authors: Chen Zhang et al.
- Year: 2025
- URL: https://arxiv.org/abs/2503.18292
- Architecture: two-level allocator for heterogeneous embeddings/KV patterns
- Contribution: 指出現代模型layer/cache heterogeneity讓單一page abstraction不再足夠。
- Reported result: GPU memory utilization最高改善79.6%，serving throughput最高4.92×（平均1.80×）。
- Limitation: 效能結果不能直接外推為physical read correctness。

## 已確認 / 推論邊界

**已確認工程實作：** vLLM block-table/slot-mapping公式、persistent forward block tables、FlashInfer metadata builder的page index copy。  
**官方/文件資訊：** FlashInfer paged KV CSR metadata semantics與CUDA Graph persistent buffers。  
**論文結果：** PagedAttention/Jenga的架構與benchmark。  
**合理推論：** `ExpectedPhysicalKVReadSet`可由runtime page metadata + attention mask/window建模。  
**尚未驗證：** GPU kernel實際load addresses是否與expected footprint完全一致；TMA/cache-line/coalescing造成的額外load範圍。

## Unknown / Open Questions

1. FlashInfer/vLLM各attention backend如何把 physical page ID轉成最終K/V pointer arithmetic？
2. TMA/warp load/cache-line粒度下，ObservedPhysicalKVReadSet應定義到page、cache line、sector還是byte address？
3. 在sliding-window、sparse attention、DCP/PCP與hybrid block下，semantic set與physical footprint的差距多大？

## 下一輪研究

```text
FlashInfer / vLLM Attention Kernel
→ paged_kv_indices load
→ physical page id
→ base pointer + page/head/token offset
→ TMA / global load instruction
→ ExpectedPhysicalKVReadSet
→ instrumented ObservedPhysicalKVReadSet
→ ZERO / REPLACE selected physical page/token
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔToken
→ ΔAgentAction
```

優先做 backend differential：FlashInfer vs vLLM Triton paged attention vs FlashAttention，確認相同 semantic KV set是否形成不同 physical footprint。

## Knowledge Graph 新增 Node / Edge

Nodes:
- `LogicalKVPosition`
- `KernelBlockIndex`
- `PhysicalKVPageIdentity`
- `PhysicalKVSlotIdentity`
- `PageTableGeneration`
- `AttentionMetadataGeneration`
- `SemanticKVReadSet`
- `ExpectedPhysicalKVReadSet`
- `ExpectedPhysicalPageFootprint`
- `ObservedPhysicalKVReadSet`
- `KernelOverReadFootprint`
- `ManagerBlockToKernelBlockMapping`
- `PersistentGraphMetadataBufferGeneration`

Edges:
- `LogicalKVPosition --translated_by→ PageTableGeneration`
- `PageTableGeneration --maps_to→ PhysicalKVPageIdentity`
- `PhysicalKVPageIdentity + BlockOffset --forms→ PhysicalKVSlotIdentity`
- `BlockTableTensor --compiled_into→ PagedKVIndices`
- `PagedKVIndices + SeqLen + MaskPolicy --derives→ ExpectedPhysicalKVReadSet`
- `ExpectedPhysicalKVReadSet --does_not_prove→ ObservedPhysicalKVReadSet`
- `KernelOverReadFootprint --may_superset→ SemanticKVReadSet`
- `slot_mapping --does_not_equal→ HistoricalAttentionReadSet`

## 本輪結束判斷

- **缺哪一層：** physical page ID → kernel pointer arithmetic → actual global-memory/TMA load trace。
- **哪個節點最淺：** `ObservedPhysicalKVReadSet`，但它現在已有明確上游expected model。
- **哪個概念仍只是名詞：** `ObservedPhysicalKVReadSet` 的production instrumentation instance。
- **哪個系統值得讀原始碼：** FlashInfer paged attention kernel與vLLM Triton paged-attention backend。
- **哪篇論文需追引用：** PagedAttention，並沿引用鏈追Jenga/vTensor與2025-2026 GPU-native KV memory systems。
- **哪個概念最適合視覺模擬：** `Paged KV Translation Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Request/Forward Dependency Mapper + Page-Table Translation Verifier + Physical Read Contract Verifier + Causal Evidence Gate + Tool Executor`。

本輪把上一輪的 `ForwardConsumptionEpoch` 真正接到了 physical page identity：現在已能回答「某 request 的某 logical token range，按當下 page-table generation，預期會落到哪些physical KV pages/slots」。下一個真正的底層邊界不再是scheduler，而是GPU kernel本身：**page ID如何變成memory address，以及GPU究竟真的load了什麼。**