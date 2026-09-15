# 【AI Agent × Multimodal Research Report】

**時間：2026-09-16 04:56（Asia/Taipei）**

**本輪主題：PagedAttention × BlockPool × RadixAttention × Chunked/Async Scheduling × SLO-aware KV Management × HBM/Storage Hierarchy**

## 與歷史研究比較

上一輪已建立 ContinuousBatching、SchedulerStep、KVAdmission、RequestPreemption、AgentProgramContinuity、ToolPause、KVRetentionTTL 與 P/D disaggregation。本輪不再重複「Scheduler 會 preempt」；改向下追 physical KV block lifecycle、refcount/eviction ordering、Radix tree prefix topology，並向上比較 SLO/fairness 如何與 KV residency 共用同一個決策訊號。

## 本小時新發現

1. PagedAttention 的真正系統意義是把「request 的邏輯 token sequence」與「GPU 中 KV 的物理位置」解耦：邏輯 blocks 經 block table 映射到不必連續的 physical blocks，讓 KV 能 on-demand allocate、share、copy-on-write，降低 fragmentation。
2. vLLM V1 `BlockPool` 現在把 prefix cache 與 physical block reuse 合在同一 lifecycle：free queue 同時包含真正 free blocks與 `ref_cnt=0` 的 cached eviction candidates；重新分配 block 時才移除舊 hash metadata。
3. vLLM eviction order 不是單一 LRU：non-cached free blocks會 prepend，形成 LIFO reuse 以改善 GPU locality；cached blocks append，形成 FIFO reuse以近似 LRU prefix-cache eviction。`touch()` 在 cache hit 時會把 ref_cnt=0 block 從 free queue 移除再增加 refcount。
4. SGLang RadixCache 不以固定 hash block map 表示 prefix，而以 token prefix radix tree 表示共享結構；node 保存 `lock_ref / last_access_time / hit_count / priority / host_ref_counter`，eviction 從可驅逐 leaves 依可插拔 strategy 建 heap，並沿 parent 回收。
5. 2026 Cascade 顯示 serving fairness/QoS 不應只改 request ordering：它用同一個 per-request latency budget，同時決定 scheduling 與 KV restore/prefetch/retain/recompute。這使 `SLO budget` 成為 queue 與 memory hierarchy 之間的共同控制訊號。

## 本小時最重要 5 個發現

### 1. PagedAttention 是「KV virtual memory」，不是單純 attention kernel 優化

底層：Token position → logical KV block → request block table → physical KV block ID → HBM address → attention kernel gather/read。

傳統 contiguous KV allocation 必須為未知最大 sequence 預留連續空間，造成 internal/external fragmentation。PagedAttention 借用 OS paging：固定大小 blocks、非連續 physical placement、on-demand allocation、block table indirection；parallel sampling/beam 等可共享 prefix physical blocks並在寫入時 copy-on-write。

SOSP 2023 論文報告 vLLM 在其測試模型/workload下，相較 FasterTransformer/Orca在相同 latency level 提升約 2–4× throughput。這是論文結果，不應外推成所有硬體與 2026 serving stack 的固定倍率。

### 2. vLLM BlockPool 揭露真正的 physical lifecycle

`BlockPool` 初始化固定數量 `KVCacheBlock`，以 doubly-linked `FreeKVCacheBlockQueue` 管理 free/eviction candidates，另以 hash→block map 支援 prefix lookup。

核心 lifecycle：
`allocate → ref_cnt 0→1 → compute/fill → full block hash → cache map → request free → ref_cnt→0 → free queue(cached candidate) → later allocation → evict old hash → reuse physical block`。

關鍵細節：cached block即使 ref_cnt=0仍可被 prefix lookup 命中；`touch()` 會把它從 free queue移除並重新持有。這表示「free」在 cache manager 語義上不一定等於「內容已不存在」，而是「physical block 可被下一次 allocation 覆寫」。

### 3. Eviction policy 與 GPU locality 是兩種不同目標

vLLM `free_blocks()` 把沒有 cache hash 的 blocks 放 free queue 前端，採 LIFO reuse；帶 prefix hash 的 cached blocks放尾端，讓較早進 free queue 的 cached block先被 reuse/evict，形成 LRU-like behavior。

因此 memory manager同時最佳化：
- physical locality / quick reuse；
- prefix reuse value；
- refcount correctness；
- cache metadata consistency。

這比抽象的「KV 用 LRU」更精確。

### 4. SGLang RadixAttention 把 prefix sharing 表示成 tree topology

`RadixKey` 包含 token IDs、`extra_key`、`cache_salt`，匹配前會檢查 namespace compatibility；RadixCache找 longest prefix，必要時 split node。TreeNode保存 lock/ref、access time、priority、host backup state與 hash metadata。

Eviction：collect evictable leaves → eviction strategy priority heap → free leaf KV segment → delete leaf → 若 parent 變 leaf且未 lock則加入 heap。這使 prefix共享結構本身直接決定哪些 KV segment可以回收。

vLLM hash-block model與SGLang radix-tree model不是誰絕對較好，而是兩種不同的 cache index/topology abstraction；都仍需底層 allocator把 logical prefix映射到 physical KV storage。

### 5. Fairness/QoS 必須同時控制「算力順序」與「KV 去留」

Cascade 定義 per-request latency budget = SLO deadline/headroom 與 predicted remaining service time 的差額，並持續依 request characteristics、KV state與 system load更新；scheduler優先處理 budget小的 request，memory manager則用同一 budget決定 KV restore/prefetch/retain/recompute。

這揭露新的控制 loop：
`SLO → urgency → schedule priority + KV residency decision → queue/memory latency → updated remaining time → new urgency`。

論文在其 production traces / 三個模型設定報告 goodput最多 2.4×、SLO violation較 default vLLM FCFS降低40%。限制：依賴 remaining-time prediction；fairness定義仍是 SLO/service-class層，不等於 security isolation。

## Architecture Breakdown

Agent Runtime
→ Model Router
→ Inference Security Gateway
→ Request Metadata {principal, job, SLO, modality}
→ Scheduler
  ├ continuous/async scheduling
  ├ chunked prefill
  ├ urgency / priority
  └ token + encoder budget
→ Prefix Index
  ├ vLLM hash/block chain
  └ SGLang radix tree
→ Logical KV Mapping
→ Physical KV Allocator / BlockPool
  ├ refcount
  ├ free queue
  ├ cache metadata
  ├ eviction candidate order
  └ reuse watcher
→ HBM KV blocks
→ Attention kernel
→ Decode
→ Tool pause / next turn

Extended hierarchy：HBM ↔ peer GPU/NVLink ↔ CPU/CXL ↔ NVMe/remote KV storage。

## Bottom-Level Logic

### PagedAttention mapping

For sequence token position `t`：
`logical_block = floor(t / block_size)`；
`offset = t mod block_size`；
`physical_block = block_table[request][logical_block]`；
attention kernel從 `(physical_block, offset)` 讀 K/V。

因此 logical sequence連續不要求 HBM physical addresses連續。

### Block refcount

`ref_cnt > 0`：至少一個 active owner/reference，不能 physical reuse。
`ref_cnt == 0 + cached hash`：prefix cache內容仍可 hit，但已是 eviction/reuse candidate。
`ref_cnt == 0 + no hash`：純 free block，可優先 reuse。

### Radix prefix

`Request tokens + namespace → longest-prefix traversal → cached KV indices`。若 match落在 node segment中間，split node建立精確 prefix boundary；lock_ref沿 ancestor保護 active prefix不被 eviction。

### Chunked prefill

長 prompt不必一次吃完整 scheduler token budget：prefill可切 chunk與 decode request交錯執行。這降低 long-prefill head-of-line blocking，但增加 request state、partial KV、scheduler step與 multimodal item boundary 的複雜度。vLLM SchedulerConfig也明確區分 chunked prefill與 multimodal encoder budget。

### Async scheduling

vLLM `AsyncScheduler` 允許 scheduling 與 output processing pipeline overlap，並維護 output placeholders/speculative-token狀態；stale delivery/preemption需避免錯誤 decrement/cache。效能收益來自縮小 CPU scheduling gap，但 correctness state machine更複雜。

## Visual Simulation Idea

### KV Virtual Memory × Radix Prefix × SLO Simulator

四層同步視圖：
1. Token sequence：每個 request/agent turn的 tokens。
2. Logical prefix：vLLM block hash chain vs SGLang radix tree。
3. Physical memory：HBM block grid，顯示 block ID/refcount/hash/owner/free-queue位置。
4. Scheduler/SLO：TTFT/ITL deadline、latency budget、chunked prefill、decode與preemption timeline。

互動：block size、HBM容量、prefix overlap、tenant數、SLO、prompt長度、chunk size、eviction strategy、tool pause、cache salt。

動畫：allocate → share → touch → free(ref=0 but cached) → evict hash → physical reuse；同時比較 hash-block與radix-tree cache topology。

輸出：fragmentation、cache hit、recompute tokens、evictions、HBM occupancy、TTFT/ITL、SLO goodput、per-principal slowdown。

## Code / GitHub

### vLLM
- `vllm/v1/core/block_pool.py`：BlockHashToBlockMap、BlockPool、FreeKVCacheBlockQueue使用、refcount、touch/free、cached eviction、reuse watcher、KV events。
- `vllm/v1/core/kv_cache_manager.py`：下一輪繼續追 request→cache-group→block allocation與hybrid attention groups。
- `vllm/v1/core/sched/async_scheduler.py`：async scheduling output placeholders、spec tokens、preemption/stale output correctness。
- `vllm/v1/core/sched/scheduler.py`：chunked prefill/admission與 KV allocation failure path。

### SGLang
- `python/sglang/srt/mem_cache/radix_cache.py`：RadixKey、TreeNode、longest prefix、split、lock ref、leaf eviction。
- `base_prefix_cache.py`：prefix cache abstraction。
- `allocation.py` / `allocator/`：下一輪追 token→KV physical allocator。
- `unified_radix_cache.py`、`storage/`：tiered KV / host storage方向。

## Papers

### Efficient Memory Management for Large Language Model Serving with PagedAttention
Authors: Woosuk Kwon, Zhuohan Li, Siyuan Zhuang, Ying Sheng, Lianmin Zheng, Cody Hao Yu, Joseph E. Gonzalez, Hao Zhang, Ion Stoica. Institution: UC Berkeley 等。Year: 2023, SOSP. URL: arXiv:2309.06180 / ACM DOI 10.1145/3600006.3613165. Code: vLLM. Dataset/workload: serving benchmarks across multiple models/decoding workloads。Architecture: paged KV blocks + block tables + sharing/COW + scheduler。Contribution: virtual-memory-style KV management，降低 fragmentation並提升 batch capacity。Limitations: 原始設計早於2026 tiered/disaggregated KV、agent-aware serving與現代 hybrid attention。

### Cascade: Exploiting SLO-Aware latency budget for fair and high goodput LLM inference serving
Authors: Muhammad Adnan, Rohan Mahapatra, Prashant J. Nair, Daniel Berger, Pantea Zardoshti, Rodrigo Fonseca, Esha Choukse. Year: 2026. URL: arXiv:2608.06557. Architecture: continuously updated per-request latency budget shared by scheduler與KV memory manager。Contribution: scheduling + KV movement unified under SLO urgency。Limitations: prediction accuracy/workload dependence；QoS fairness不等於 confidentiality isolation。

### SwiftCache
Jianmin Hu et al., 2026, arXiv:2606.16135. Architecture: heterogeneous models donate idle GPU memory; NVLink cross-model prefix storage; active-layer local KV. Reported P99 TTFT up to 69% lower and max context up to 3.98× in its workloads. Limitation: placement/interference/isolation complexity。

### Tutti
Shi Qiu et al., 2026, arXiv:2605.03375. Architecture: GPU-centric KV object store + GPU io_uring + slack-aware SSD I/O scheduling。Reported vs GDS-enabled SSD-backed LMCache: TTFT -78.3% under its strict SLO setting, request rate 2×, serving cost -27%。Limitation: storage/GPU integration complexity；需驗證多tenant isolation與failure semantics。

### OasisKV
Can Xiao et al., 2026, arXiv:2608.08097. Architecture: speculative lookahead預測重要KV，decode只把 sparse relevant KV prefetch到HBM。Reported reasoning workload throughput 1.69× dense vLLM at 0.1-point accuracy loss，部分multi-GPU/P-D設定約2×。Limitations: approximation/accuracy tradeoff與lookahead dependence。

## 已確認 / 論文結果 / 工程推論 / 假說

**原始碼已確認**：vLLM BlockPool 的 refcount/free queue/cache-hash lifecycle、cached/non-cached不同reuse order、touch/remove、reuse watcher；AsyncScheduler placeholder/preemption處理；SGLang RadixCache namespace、tree split、lock_ref、leaf eviction。

**論文結果**：PagedAttention 2–4×、Cascade 2.4× goodput/40% SLO violation reduction、SwiftCache/Tutti/OasisKV數字均只代表各自實驗設定。

**Hermes 工程推論**：應建立 `KVResidencyDecision` knowledge node，把 `principal + agent_job + SLO + tool-pause + confidentiality-domain + cache-value`送入 server-side policy；LLM不得直接決定 physical pin/priority。

**尚未驗證假說**：將 security principal isolation與SLO-aware KV management共同編譯成 allocator constraints，是否能在低 overhead 下同時提供 fairness與可量測的 cross-tenant interference bound。

## Unknown / Open Questions

1. vLLM hash-block free queue與SGLang radix-tree leaf eviction在 Agent multi-turn / shared-system-prompt workload下，hit-rate、fairness與tail latency如何定量比較？
2. HBM→CPU/CXL/NVMe/remote 多層KV中，哪一層應成為 confidentiality principal boundary，metadata/event是否也必須 namespaced？
3. SLO-aware residency若允許高優先 request長期保留KV，如何防止 priority abuse / memory starvation，並建立 principal-level fairness floor？

## 下一輪研究

`KVCacheManager physical groups × Hybrid Attention (full/sliding/Mamba) × HBM bandwidth/kernel arbitration × FlashAttention/PagedAttention kernels × GPU memory hierarchy × QoS/security co-scheduling`。

## Knowledge Graph 新增 Node

PagedAttention, LogicalKVBlock, PhysicalKVBlock, RequestBlockTable, KVVirtualAddress, BlockPool, FreeBlockQueue, BlockRefCount, CachedEvictionCandidate, PhysicalBlockReuse, PrefixTopology, RadixCache, RadixNode, RadixLockRef, PrefixTreeEviction, ChunkedPrefill, AsyncScheduling, LatencyBudget, SLOGoodput, KVResidencyDecision, TieredKVStorage, SparseKVPrefetch。

## Knowledge Graph 新增 Edge

- `TokenPosition -> MAPS_TO -> LogicalKVBlock`
- `RequestBlockTable -> MAPS -> LogicalKVBlock -> PhysicalKVBlock`
- `BlockRefCount -> PROTECTS_FROM_REUSE -> PhysicalKVBlock`
- `RefCountZeroCachedBlock -> ENTERS -> CachedEvictionCandidate`
- `PhysicalBlockReuse -> INVALIDATES -> OldPrefixHashMapping`
- `RadixNode -> REPRESENTS -> SharedTokenPrefix`
- `RadixLockRef -> PROTECTS -> PrefixTreePath`
- `ChunkedPrefill -> REDUCES -> HeadOfLineBlocking`
- `AsyncScheduling -> OVERLAPS -> CPUSchedulingAndGPUWork`
- `LatencyBudget -> CONTROLS -> RequestPriority`
- `LatencyBudget -> CONTROLS -> KVResidencyDecision`
- `TieredKVStorage -> TRADES -> CapacityVsAccessLatency`
- `SparseKVPrefetch -> REDUCES -> HBMResidencyRequirement`

## 每輪結束檢查

- 缺哪一層：Transformer attention kernel如何用 block table實際 gather K/V；HBM/L2/SM memory traffic與kernel arbitration。
- 哪個節點最淺：KVResidencyDecision 的 security/QoS joint policy、TieredKVStorage principal isolation、AsyncScheduling side effects。
- 哪個概念仍只是名詞：principal-aware HBM bandwidth noninterference。
- 哪個系統值得讀原始碼：vLLM `kv_cache_manager.py` + PagedAttention/FlashAttention backend；SGLang allocator + UnifiedRadixCache。
- 哪篇論文需追引用：PagedAttention 的後續 memory-management lineage；Cascade 的 unified scheduling/memory budget；Tutti 的 GPU-centric storage stack。
- 哪個概念最適合視覺模擬：KV Virtual Memory × Radix Prefix × SLO Simulator。
- 哪個 Agent 架構最值得實作：Hermes `KVResidencyPolicyAdapter`，把 Agent program continuity、principal與SLO轉成受限 serving hints，由 inference server驗證與裁決。

## 從「使用者說一句話」再往 GPU 還原

User → UI → Agent → Context → Reasoning/Planning → Model Router → Scheduler → Tokenizer → logical token positions → logical KV blocks → request block table/radix prefix → physical KV allocator → HBM blocks → attention kernel → logits → sampling → Agent → Tool → resume。

多模態：Camera/Image/Voice/Video → encoder → modality tokens/features → encoder budget/cache → multimodal prefix identity → logical/physical KV residency → fusion/attention → decode → Agent action。

**本輪核心答案**：AI inference 中的「記憶」不是一整段連續顯存。Serving runtime把每個 token產生的K/V切成可共享、可引用、可驅逐、可搬移的記憶單元，再由 prefix topology與scheduler決定它們在HBM中的生命週期。PagedAttention回答「邏輯序列如何映射到物理KV」，RadixCache回答「共享prefix如何形成可回收拓撲」，而2026 SLO-aware/tiered systems開始回答「哪些KV值得留在最快的記憶體」。下一層要追的就是 attention kernel與GPU memory hierarchy如何真正消耗這些physical KV blocks。