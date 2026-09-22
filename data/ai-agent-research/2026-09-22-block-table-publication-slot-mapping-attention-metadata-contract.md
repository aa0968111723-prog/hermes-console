# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-22 11:54 Asia/Taipei

## 本小時主題
**vLLM Block-Table Publication × Slot Mapping × Attention-Metadata Generation Contract**

本輪承接上一輪 `Request → Scheduler → KVCacheManager → BlockPool → PageTableGeneration`，但不再重複 allocator / prefix-cache reuse。這次追真正跨 CPU→GPU 的 publication boundary：scheduler/worker 手上的 block IDs，如何變成 attention kernel 實際讀取的 device block table 與每個新 token 寫入 KV cache 的 slot mapping。

核心鏈：

`Request/Scheduler → request block_ids → CPU BlockTable row → optional manager-block→kernel-block translation → H2D commit → device BlockTableGeneration → positions/query_start_loc → GPU slot-mapping kernel → SlotMappingGeneration → AttentionMetadataGeneration → Attention backend → KV read/write`

---

## 本小時新發現

### 1. vLLM 明確存在 CPU block-table → GPU block-table 的 publication frontier
current `vllm/v1/worker/block_table.py` 的 `BlockTable` 同時持有 CPU/NumPy/GPU buffer；`add_row/append_row` 修改 CPU-side table，而 `commit_block_table(num_reqs)` 才呼叫 `copy_to_gpu(num_reqs)`。`gpu_model_runner.py` 更刻意先啟動這次 copy，以便與後續 CPU operations overlap。

因此新增：

`CPUBlockTableMutationWitness --does_not_prove→ DeviceBlockTablePublicationWitness`

真正可供 attention kernel 使用的是 device generation，而不是 Python / NumPy row 已經更新這件事。

### 2. allocator block identity 與 kernel block identity 可能不同
current BlockTable 支援 hybrid blocks：若 KV manager block size 大於 attention kernel block size，`map_to_kernel_blocks()` 會把一個 manager block 展開成多個 kernel block IDs。例如 32-token manager block在16-token kernel block下，ID 1 對應 kernel IDs [2,3]。

因此上一輪的：

`PageTableGeneration`

必須拆成：

`ManagerBlockTableGeneration → KernelBlockTableGeneration`

並新增：

`SameManagerBlockID --does_not_imply→ SameKernelBlockAddressingIdentity`

因為 kernel block size / blocks_per_kv_block 是 address translation contract 的一部分。

### 3. block table 決定「讀哪些頁」，slot mapping 決定「本 step 的 K/V 寫到哪個 slot」
current Triton `ComputeSlotMappingKernel` 逐 request 讀 `query_start_loc` 與 token `positions`，先算 virtual block index / local block offset，再從 GPU block table載入 block number，最後形成：

`slot_id = block_number × kernel_block_size + slot_offset`

在 context-parallel 情境還會依 CP rank / interleave 判斷 token 是否 local；非 local token寫 PAD slot。

因此：

`CorrectReadBlockTable --does_not_prove→ CorrectKVWriteSlotMapping`

以及：

`AttentionKVStateCorrect = ReadMappingCorrect ∧ WriteMappingCorrect ∧ PositionIdentityCorrect`

這是本輪最重要的 bottom-level mechanism。

### 4. AttentionMetadata 可以重用結構，但 block table / slot mapping 必須更新
current `gpu_model_runner.py` 的 attention metadata builder在 `supports_update_block_table` 時，可以重用 cached metadata object，只更新 `block_table_tensor` 與 `slot_mapping`；不同 KV cache group也會把自己的 block table / slot mapping 放入 common metadata，再讓同 group layers共享。

所以：

`SameAttentionMetadataObject --does_not_prove→ SameAttentionMetadataGeneration`

真正 identity 應至少包含：

`AttentionMetadataGeneration = StructuralMetadataIdentity + DeviceBlockTableGeneration + SlotMappingGeneration + SeqLen/QueryRangeGeneration + KVCacheGroupIdentity`

這對 CUDA Graph / metadata cache 特別重要：object identity 或 tensor shape 都不能代替 semantic generation。

### 5. page-table publication protocol未來還必須支援 format/ownership transitions
2026 Minima-KV 提供一個獨立的 production-oriented交叉驗證：它的 mixed-format paged KV lifecycle要求 destination page先建好，再 atomically publish新的 format tag + physical identifier；source只有在 readers與conversion event都清除後才能release。它也讓不同physical formats各自算 partial attention state，再以global online-softmax merge重建 final output。

這表示 Hermes 的 PageTableGeneration不能只記 `physical block ID`，長期應升級成：

`PageMappingEntry = LogicalRange + PhysicalIdentity + ContentGeneration + FormatGeneration + PublicationGeneration + OwnershipState`

而不是固定假設所有 page 都是同一 dtype / layout。

---

# 本小時最重要 5 個發現

## 1. DeviceBlockTablePublicationWitness
**概念**：CPU-side request→block mapping真正成為GPU kernel可讀資料的publication事件。

**底層如何運作**：
`request block_ids → BlockTable.add/append_row → CPU pinned buffer → copy_to_gpu(num_reqs) → device tensor`

**為什麼重要**：CPU mapping正確但device tensor仍舊，attention仍會合法地讀錯頁。

**限制**：目前 source證明有H2D publication boundary，但尚未建立 request-scoped copy completion / stream ordering runtime trace。

**證據類型**：官方原始碼已確認；runtime generation attribution尚未驗證。

## 2. Manager→Kernel Block Translation
**概念**：allocator page granularity不一定等於attention kernel page granularity。

**底層如何運作**：
`manager_block_id → × blocks_per_kv_block → contiguous kernel block IDs`

**重要性**：address identity必須帶 kernel block size與translation generation。

**限制**：不同 backend / hybrid KV group可能有不同 kernel granularity。

**證據類型**：官方原始碼已確認。

## 3. SlotMappingGeneration
**概念**：本次scheduled tokens要把新K/V寫入哪個實體cache slot的generation。

**底層如何運作**：
`query_start_loc → position → virtual block → CP locality → block-table lookup → local offset → slot_id`

**重要性**：block table主要描述request可見pages；slot mapping直接控制當前step KV write placement。錯誤write mapping可能污染後續所有decode step。

**限制**：尚未把 slot write與實際 KV store kernel event join起來。

**證據類型**：官方 Triton source已確認。

## 4. AttentionMetadataGeneration
**概念**：attention kernel launch所消費的完整semantic metadata版本，而非Python object identity。

**底層如何運作**：
`block_table + slot_mapping + query ranges + seq lengths + backend/group-specific fields → metadata builder/update → layer launch`

**重要性**：cached metadata object可被原地更新；same object不等於same semantics。

**限制**：不同backend的metadata fields仍需逐一建立schema。

**證據類型**：官方原始碼已確認。

## 5. Mapping Publication 必須納入 Format / Ownership
**概念**：physical page mapping不只是一個address，還可能指向不同precision/representation與不同ownership epoch。

**底層如何運作**：
`construct destination → conversion complete → publish physical+format mapping → readers switch generation → retire source after quiescence`

**重要性**：未來FP8/TQ3/evicted/repacked KV不能只靠BlockID辨識。

**限制**：Minima-KV是獨立研究系統，不代表current vLLM已採相同protocol；本輪只把它當作架構交叉驗證與下一代contract證據。

**證據類型**：論文結果 / architecture design；非vLLM current implementation claim。

---

# Architecture Breakdown

## System Architecture：vLLM request metadata → attention launch

```text
Scheduler
  ↓
KVCacheManager / coordinator
  ↓
request.block_ids
  ↓
InputBatch BlockTable CPU rows
  ↓
[manager-block → kernel-block translation]
  ↓
commit_block_table
  ↓
GPU BlockTable tensor
  ├─→ attention read-page metadata
  └─→ ComputeSlotMappingKernel
          ↑ positions
          ↑ query_start_loc
          ↑ CP rank/interleave
          ↓
       slot_mapping
          ↓
CommonAttentionMetadata
          ↓
backend metadata builder / update_block_table
          ↓
per KV-cache-group / per-layer attention metadata
          ↓
Attention kernel
  ├─ reads old K/V through block table
  └─ writes new K/V through slot mapping
```

### Ownership domains
1. Scheduler/KV manager：決定 logical request ownership與block allocation。
2. Worker BlockTable：把scheduler identity翻成kernel addressing identity。
3. GPU publication：讓device取得本step mapping generation。
4. Slot-mapping kernel：把logical token position翻成physical write slot。
5. Attention backend：消費read/write mapping，但不應被視為mapping authority。

---

# Bottom-Level Logic

## A. Manager block → kernel block

若：

`manager_block_size = M`
`kernel_block_size = K`
`M % K = 0`

則：

`blocks_per_kv_block = M / K`

對 manager block `b`：

`kernel_blocks(b) = [b*r + 0, ..., b*r + (r-1)]`

其中 `r = blocks_per_kv_block`。

因此physical identity不能只存 `b`；至少需要：

`{manager_block_id, manager_block_size, kernel_block_size, translation_generation}`。

## B. Token position → slot ID

current slot mapping可抽象為：

```text
position
→ virtual_block_index
→ virtual_block_offset
→ CP locality
→ local_block_offset
→ kernel block index
→ block_table[request, block_index]
→ physical block number
→ slot_offset
→ slot_id = physical_block * kernel_block_size + slot_offset
```

所以 `position`、`query_start_loc`、`block_table` 任一generation錯位，都可能生成memory-safe但semantically wrong slot。

## C. Read/write consistency invariant

新增：

`KVMappingConsistencyWitness =`
`RequestGenerationMatch`
`∧ DeviceBlockTableGenerationMatch`
`∧ SlotMappingGenerationMatch`
`∧ PositionGenerationMatch`
`∧ KernelBlockTranslationMatch`
`∧ KVCacheGroupMatch`

並新增否定edge：

`MemoryBoundsSafe --does_not_prove→ KVMappingConsistencyWitness`

---

# Visual Simulation Idea

## Block-Table Publication & Slot-Mapping Microscope

Hermes Console可做五層互動圖：

```text
Request Tokens
[t0][t1][t2]...[tN]
        ↓ logical position
CPU Block Table
[R0: 12, 44, 91]
        ↓ H2D publication G17
GPU Block Table
[R0: 12, 44, 91]
        ↓ lookup
Slot Mapping
[token N → block 91 → offset 7 → slot X]
        ↓
KV Cache Physical Pages
[P12][P44][P91]
```

可注入：
- stale GPU block-table generation
- manager/kernel block-size mismatch
- wrong request row after batch move
- stale position generation
- wrong CP rank/interleave
- stale slot mapping
- same metadata object but new mapping generation

UI同時顯示：

`CPU MAPPING ✓`
`GPU PUBLICATION ✓/✗`
`READ MAPPING ✓/✗`
`WRITE SLOT ✓/✗`
`SEMANTIC GENERATION ✓/✗`

最有價值的故障畫面是：

`Memory Safe ✓ | Device Mapping Stale ✗ | Model Semantics Wrong ✗`

---

# Code / GitHub

## vLLM
Repository: https://github.com/vllm-project/vllm

本輪值得繼續追的核心檔案：

- `vllm/v1/worker/block_table.py`
  - `BlockTable.append_row`
  - `BlockTable.add_row`
  - `BlockTable.move_row`
  - `BlockTable.commit_block_table`
  - `BlockTable.map_to_kernel_blocks`
  - `ComputeSlotMappingKernel`
- `vllm/v1/worker/gpu_model_runner.py`
  - input preparation
  - block-table H2D commit
  - attention metadata build/update
  - per-KV-group block-table / slot-mapping wiring
- `vllm/v1/attention/backend.py`
  - `AttentionMetadataBuilder`
  - `update_block_table`
- 下一輪應追：真正 attention backend如何把 `block_table_tensor` / `slot_mapping` 傳入 FlashAttention / FlashInfer / Triton kernel。

重要原始碼事實：`move_row` 會清空vacated source row；source comment明確說dummy-run batch可能解引用stale row並在block已free/reallocate後寫state，這是「batch row identity也有generation」的直接工程證據。

---

# Papers

## 1. Minima-KV: Retention-Preserving KV Cache Compression with Mixed-Format Paged Attention
- Authors: Sergii Kozyrev, Davyd Maiboroda
- Institution: 論文頁面本輪未可靠解析出機構，標記待驗證
- Year: 2026
- URL: https://arxiv.org/abs/2608.23834
- Code: 本輪未驗證公開code repository，標記待追
- Dataset / evaluation: RULER NIAH、LongBench v2；Qwen3.6-27B profiles
- Architecture: Recent/Anchor FP8 + Stale TQ3；format-specific paged-attention partial states + global online-softmax merge
- Contribution: retention-preserving mixed-format page lifecycle；copy-before-publish / reader-aware retirement；直接 heterogeneous decode
- Limitations: 作者明確區分quality profile、direct canary與deployment accounting；不是單一run同時證明所有claim，且direct performance evidence為有限canary。
- 改變了什麼: 把 page-table entry 從「address mapping」提升為「format + ownership + publication lifecycle」的一部分。

## 2. PersistentKV: Page-Aware Decode Scheduling for Long-Context LLM Serving on Commodity GPUs
- Author: Muhammad Ahmed
- Institution: 本輪來源未可靠解析，待驗證
- Year: 2026
- URL: https://arxiv.org/abs/2606.26666
- Code: 本輪未驗證
- Dataset/workload: synthetic/held-out decode workload traces；RTX 3060 FP16，page size 16，GQA geometry
- Architecture: native block-table decode + KV-head-group work mapping + sequence splitting/workqueue + adaptive policy
- Contribution: 顯示 serving performance不只取決於attention kernel，page-aware work assignment與scheduler policy本身是關鍵變數。
- Limitations: hardware與workload範圍有限；不能直接外推到Blackwell/vLLM production。
- 改變了什麼: 強化 `PageTableGeneration → WorkAssignmentGeneration → KernelLaunchGeneration` 也應進KG，而非只追address mapping。

## 3. GrowPage: On-Demand KV Budgeting for Efficient LLM Reasoning Serving
- Authors: Qiankun Ma, Yanjiang Zhou, Zinan Xiong, Haofei Wang, Zhen Song, Yang Xiang, Ziyao Zhang, Hairong Zheng
- Institution: 本輪搜尋結果未可靠解析，待驗證
- Year: 2026
- URL: https://arxiv.org/abs/2609.03494
- Code: 本輪未驗證
- Architecture: dual-timescale query summaries → demand estimate → compress within allocation or acquire additional physical page
- Contribution: 把KV capacity從固定request budget改成runtime resource，保留PagedAttention continuous batching/prefix caching。
- Limitations: 本輪只取得摘要級證據，詳細runtime ownership與publication protocol下一輪需讀全文/code。
- 改變了什麼: `KVCapacityGeneration` 也可能成為 request runtime state，而非靜態config。

---

# Unknown / Open Questions

1. `commit_block_table()` 的 H2D copy在current runner stream語義下，哪個event / stream frontier精確保證attention kernel看見新generation？source顯示copy被刻意提早以overlap CPU work，但production runtime witness仍缺。
2. `slot_mapping` 生成完成到實際 K/V cache write kernel之間，是否存在backend-specific transform / reorder / graph replay buffer，導致需要再增加一層 `BackendSlotMappingGeneration`？
3. async scheduling、batch row move/condense、spec decode與CUDA Graph replay同時存在時，`request_id → batch row → block-table row → slot mapping → metadata object` 的generation如何端到端join？

---

# 下一輪研究

鎖定：

`SchedulerOutput → InputBatch row generation → BlockTable.add/move/swap → H2D commit stream → DeviceBlockTableGeneration → ComputeSlotMappingKernel → SlotMappingGeneration → CommonAttentionMetadata → backend metadata → FlashAttention/FlashInfer kernel args → KV cache read/write → CUDA completion`

優先追：
1. `gpu_model_runner.py` block-table commit前後完整callsite與stream semantics。
2. `CpuGpuBuffer.copy_to_gpu` 是否使用non-blocking copy / current stream / event。
3. current FlashAttention / FlashInfer backend metadata builder如何傳block table與slot mapping。
4. CUDA Graph replay時mapping tensor是否in-place更新、何時視為新generation。
5. async scheduler + row move是否可能形成stale-row semantic hazard，以及現有guardrail如何避免。

---

# Knowledge Graph 新增 Node / Edge

## Nodes
- `CPUBlockTableGeneration`
- `ManagerBlockTableGeneration`
- `KernelBlockTableGeneration`
- `DeviceBlockTableGeneration`
- `DeviceBlockTablePublicationWitness`
- `KernelBlockTranslationIdentity`
- `SlotMappingGeneration`
- `SlotMappingPublicationWitness`
- `PositionGeneration`
- `BatchRowGeneration`
- `AttentionMetadataGeneration`
- `KVCacheGroupIdentity`
- `KVMappingConsistencyWitness`
- `BackendSlotMappingGeneration`（hypothesis / 待驗證）
- `KVCapacityGeneration`（research-derived）
- `KVFormatGeneration`（research-derived）

## Edges
- `RequestBlockOwnership --materializes_as→ CPUBlockTableGeneration`
- `ManagerBlockTableGeneration --translated_by→ KernelBlockTranslationIdentity`
- `KernelBlockTableGeneration --published_as→ DeviceBlockTableGeneration`
- `DeviceBlockTableGeneration + PositionGeneration --computes→ SlotMappingGeneration`
- `DeviceBlockTableGeneration + SlotMappingGeneration --embedded_in→ AttentionMetadataGeneration`
- `AttentionMetadataGeneration --consumed_by→ AttentionKernelLaunch`
- `CPUBlockTableMutationWitness --does_not_prove→ DeviceBlockTablePublicationWitness`
- `CorrectReadBlockTable --does_not_prove→ CorrectKVWriteSlotMapping`
- `SameAttentionMetadataObject --does_not_prove→ SameAttentionMetadataGeneration`
- `SameManagerBlockID --does_not_imply→ SameKernelBlockAddressingIdentity`
- `MemoryBoundsSafe --does_not_prove→ KVMappingConsistencyWitness`
- `PageMappingEntry --may_include→ KVFormatGeneration`
- `KVCapacityGeneration --constrains→ PageAllocationGeneration`

---

# 證據分級

### 已確認事實 / 官方原始碼
- BlockTable CPU/GPU buffer與explicit H2D commit。
- hybrid manager-block→kernel-block translation。
- GPU Triton slot mapping由position + block table算physical slot。
- metadata builder可reuse object並更新block table / slot mapping。
- multi-group KV cache各有block table / slot mapping wiring。

### 論文結果
- Minima-KV mixed-format lifecycle與copy-before-publish ownership protocol。
- PersistentKV page-aware work assignment結果。
- GrowPage runtime KV capacity budgeting摘要級結果。

### 工程推論
- production correctness應把H2D block-table publication視為generation frontier。
- metadata object identity不足以作semantic identity。

### 尚未驗證假說
- `BackendSlotMappingGeneration` 是否需要獨立於worker SlotMappingGeneration。
- exact request-scoped H2D copy completion witness。
- async scheduling + graph replay下完整batch-row generation trace。

---

# 本輪結束判定

**缺哪一層？**
CPU→GPU block-table publication completion與attention launch之間的stream/event causal join。

**哪個節點最淺？**
`DeviceBlockTablePublicationWitness` 的production runtime attribution。

**哪個概念仍只是名詞？**
`BackendSlotMappingGeneration`。

**哪個系統最值得讀原始碼？**
vLLM `gpu_model_runner.py → block_table.py → attention backend metadata builder → FlashAttention/FlashInfer backend`。

**哪篇論文需追引用？**
Minima-KV，尤其 ownership-aware page transition與mixed-format page-table lifecycle；其次GrowPage的runtime page-budget mutation。

**哪個概念最適合視覺模擬？**
`Block-Table Publication & Slot-Mapping Microscope`。

**哪個 Agent 架構最值得實作？**
`State-grounded Planner + Request/BatchRow Generation Tracker + Device-Mapping Publication Verifier + Slot-Mapping Verifier + Attention-Metadata Provenance Joiner + KV Read/Write Trace Joiner + Causal Evidence Gate + Tool Executor`

本輪最大的推進：**Hermes 不再只知道「scheduler分配了哪些KV blocks」，而開始區分 CPU mapping、kernel-granularity translation、GPU publication、read-page mapping與write-slot mapping。這補上了 request identity 真正跨進GPU attention metadata前的一個關鍵斷層：一個mapping在Python裡是新的，不代表GPU正在消費的mapping generation也是新的。**