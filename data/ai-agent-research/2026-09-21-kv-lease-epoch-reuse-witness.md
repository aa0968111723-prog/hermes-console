# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 00:53（Asia/Taipei）

## 本小時新發現
本輪接續上一輪最淺節點 `KVLeaseEpoch production witness`，不重複 CUDA Graph / semantic-node identity，而是深入 vLLM V1 KV block allocator 的 allocate → free → reuse lifecycle。核心結論：`block_id` 是穩定的 physical slot identity，但不是穩定的 semantic-content identity；同一 block_id 被 `get_new_blocks()` 再次交付時，必須產生新的 lease/generation，否則 provenance 會把前一位 request 的 KV 與新 request 的 KV 誤接在一起。

current vLLM `BlockPool` 初始化時一次建立全部 `KVCacheBlock(idx)`，以 free queue 管理；`get_new_blocks()` 從 queue 取出 block，若有 `_reuse_watchers` 會在真正重新交付前 `_notify_reuse(ret)`，接著可能 evict 舊 cached hash，最後增加 ref_cnt。`free_blocks()` 在 ref_cnt 歸零後把 block 放回 free queue；non-cached block 採 LIFO 優先 reuse，cached block採 FIFO/LRU eviction 行為。更關鍵的是 `unpin_blocks()` 明確定義「已釋放但在真正 reuse 前仍可讀」，並以 `_reuse_watchers[block_id]` 在 `get_new_blocks()` 真正重新交付時通知 caller 停止讀取。這提供了一個非常接近 production lease-boundary 的 hook。

## 本小時最重要 5 個發現

### 1. KVLeaseEpoch 應在「重新交付」而非單純 free 時遞增
**已確認工程事實**：free 之後 block 可以處於 free queue，但 cached/unpinned content 仍可能保持可讀或可重用；`unpin_blocks()` 更明確允許 block 在 reused 前持續 readable。因此 `free()` 不是 content validity 的精確終點。

建議 canonical transition：
`Allocated(L=n) → Released/Reusable(L=n) → get_new_blocks handout → ReuseBoundary → LeaseEpoch n+1 → NewOwner`

這避免把「scheduler ownership」和「physical bytes 是否仍可讀」混為一談。

### 2. vLLM 已存在可直接利用的 ReuseBoundaryWitness
`_reuse_watchers` / `_notify_reuse()` 是非常有價值的底層 witness：watcher 以 block_id 註冊，在 `get_new_blocks()` 把該 physical block 重新交付時觸發。Hermes 不需要從 GPU pointer 猜 reuse 時刻，可以在 allocator semantic layer建立 `BlockReuseBoundaryWitness`。

限制：這個 watcher目前服務 deferred-readable/unpin語義，不等於 vLLM 已替所有 block 維護 generation counter；Hermes仍需自己的 instrumentation。

### 3. Prefix-cache eviction 與 physical reuse 是兩個事件
`_maybe_evict_cached_block()` 移除 hash/cache metadata；physical block真正成為另一個 allocation則發生在 `get_new_blocks()` handout。故：
`CacheEvictionEpoch != PhysicalLeaseEpoch`。

如果只監看 BlockRemoved/cache hash eviction，會錯把 metadata eviction 當作 memory ownership change。

### 4. Block ID 穩定性反而要求 generation identity
BlockPool 預先建立固定 `KVCacheBlock(idx)`；因此 block_id 是 pool內穩定 index。這對 address translation 很好，但 provenance 必須使用：
`PhysicalKVIdentity = (pool_identity, block_id, lease_epoch)`
而非 `(pool_identity, block_id)`。

對每個 token slot再加：
`KVSlotIdentity = PhysicalKVIdentity + slot_offset + layer/group + layout_version + content_epoch`。

### 5. KV virtualization 正從 block-level 往 token-level移動
2026 vToken 提出 token-table indirection，將 logical token liveness 與 physical block placement解耦，並保持 PagedAttention kernel / CUDA Graph compatibility。這證明 Hermes 不應把 `block_table` 寫死成 universal semantic abstraction；應保留 `KVAddressTranslationLayer`，讓 BlockTable、TokenTable 或未來 relocation table 都是 implementation。

## Architecture Breakdown

### KV Lifetime Provenance Architecture
`Request / Prefix Semantic State`
→ `KVCacheManager.allocate_slots()`
→ `Coordinator.allocate_new_blocks()`
→ `BlockPool.get_new_blocks()`
→ `PhysicalBlockHandout`
→ `KVLeaseEpoch++`
→ `SlotMapping / KV Write`
→ `KVContentEpoch`
→ `BlockTable / Translation Table`
→ `Attention Read`
→ `Release/free/unpin`
→ `FreeQueue Residency`
→ `ReuseBoundaryWitness`
→ next lease

重要狀態分離：
1. Ownership state: ref_cnt / request ownership
2. Cacheability state: block_hash / prefix-cache map
3. Queue state: allocated vs free queue
4. Readability state: deferred readable until reuse
5. Lease state: generation of physical ownership
6. Content state: bytes currently representing a semantic KV generation

## Bottom-Level Logic

### Lease counter instrumentation proposal
Hermes sidecar維護：
`lease_epoch[(pool_id, block_id)] -> uint64`

在 `get_new_blocks()` 完成 physical handout 時：
1. capture previous lease
2. if block was previously handed out, increment generation
3. emit `BlockLeaseStarted(pool, block, lease, owner/request, timestamp)`
4. if reuse watcher exists, emit `BlockReuseBoundaryWitness(previous_lease, next_lease)`
5. when slot mapping writes K/V, create `KVContentEpoch` subordinate to current lease

free 時只發：
`BlockOwnershipReleased`，不能直接發 `LeaseInvalidated`。

### Exact address model
對 classic paged KV：
`logical_position p`
→ `logical_block = floor(p / block_size)`
→ `slot_offset = p mod block_size`
→ `physical_block = translation[request, logical_block]`
→ `lease = current_lease(pool, physical_block)`
→ `address = KV_base + layout_offset(layer, physical_block, head, slot_offset, dim)`

因此 RuntimeKVReadWitness 至少需要：
`{request_epoch, layer/op invocation, logical token set, translation_epoch, pool_id, physical_block_id, lease_epoch, content_epoch, layout_version, kernel_execution_witness}`。

## Visual Simulation Idea
### KV Block Lease Timeline Microscope
同一 physical block畫成長時間軸：
`Block 42 | Lease 7: Req A | RELEASED-but-readable | REUSE boundary | Lease 8: Req B |`

上層同步顯示 logical mapping：
`Req A LBlock3 → PBlock42@Lease7`
`Req B LBlock0 → PBlock42@Lease8`

當 GPU trace只有 address/block 42但 provenance lease不一致時顯示：
`ADDRESS_MATCH_LEASE_MISMATCH`。

可再疊加 prefix-cache hash、ref_cnt、free-queue位置、BlockStored/BlockRemoved events、slot mapping、BlockTable與Attention read-set。

## Code / GitHub
值得繼續讀：
- `vllm/v1/core/block_pool.py`: `get_new_blocks`, `_notify_reuse`, `unpin_blocks`, `free_blocks`, `_maybe_evict_cached_block`, `touch`
- `vllm/v1/core/kv_cache_manager.py`: `allocate_slots`, skipped-block removal, coordinator allocation
- `vllm/v1/core/single_type_kv_cache_manager.py`: request block list與`get_new_blocks` join
- `vllm/v1/core/kv_cache_coordinator.py`: multi-group allocation ordering
- 下一層：`vllm/v1/attention/ops/triton_unified_attention.py` exact block-table indexing

## Papers
### vToken: Token-Level Virtualization for Reclaimable KV Caches
Authors: Yuanhang Gao, Xiangrui Yang, Yuanfeng Chen, Hongjia Chen, Qianru Lv, Wenfei Wu, Dongsheng Li
Year: 2026
URL: https://arxiv.org/abs/2608.13263
Architecture: token-table indirection + asynchronous live-token repacking over paged KV storage
Contribution: logical token liveness與physical block placement解耦；保留PagedAttention kernels與CUDA Graph compatibility；報告 retained KV blocks降低27.2%–72.3%，SLA throughput最高1.37×，active-KV budget下最大concurrency最高2×。
Limitations: 論文結果需在Hermes目標模型/backend/workload重現；token relocation會使單純block-level lease模型不足。
Changed: 強化 `KVAddressTranslationLayer` 必須抽象化，不可等同BlockTable。

### SparseX: Efficient Segment-Level KV Cache Sharing for Interleaved LLM Serving
Authors: Quqing Zhang et al.
Year: 2026
URL: https://arxiv.org/abs/2606.01751
Architecture: segment-level KV reuse + Sparse-Q selection + Sparse-KV recomputation + layer-specific full/sparse hybrid attention
Contribution: 將non-prefix、cross-request/cross-turn/cross-agent segment reuse納入vLLM/PagedAttention路徑。
Limitations: segment reuse引入新的semantic ownership與RoPE/context-correction問題；不能直接用classic prefix lease語義描述。
Changed: `KVContentProvenance`未來必須能表達shared/derived/recomputed segment，而不只single-request ownership。

## Unknown / Open Questions
1. `get_new_blocks()` 的 handout是否對所有 hybrid KV group / connector / offload回遷路徑都是唯一 lease transition point？可能不是，需要跨pool/coordinator追蹤。
2. KV connector / P-D disaggregation把外部KV載回GPU時，應建立新physical lease但保留semantic content lineage；兩種epoch如何join仍待驗證。
3. Triton unified attention對BlockTable的exact index與K/V layout address公式仍需逐行還原，才能從ExpectedPhysicalKVReadSet進入address-level witness。

## 下一輪研究
`KVCacheCoordinator + SingleTypeKVCacheManager`
→ multi-group/hybrid allocation
→ connector/offload import
→ physical lease transition taxonomy
→ Triton unified_attention exact indexing
→ logical token → physical block → byte-address formula
→ ExpectedPhysicalKVReadSet
→ Kernel argument contract
→ RuntimeKVReadWitness
→ ZERO/REPLACE KV intervention
→ ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction

## Knowledge Graph 新增 Node / Edge
Nodes:
- `KVLeaseEpoch`
- `BlockLeaseStarted`
- `BlockOwnershipReleased`
- `BlockReuseBoundaryWitness`
- `DeferredReadableBlockState`
- `FreeQueueResidencyState`
- `PrefixCacheMetadataEpoch`
- `PhysicalKVGenerationIdentity`
- `KVSlotGenerationIdentity`
- `TranslationEpoch`
- `SharedKVContentLineage`

Edges:
- `BlockPool.get_new_blocks → emits_candidate → BlockLeaseStarted`
- `unpin_blocks → enters → DeferredReadableBlockState`
- `get_new_blocks(reused block) → terminates → DeferredReadableBlockState`
- `BlockReuseBoundaryWitness → separates → KVLeaseEpoch(n), KVLeaseEpoch(n+1)`
- `CacheEvictionEpoch --not_equal→ PhysicalLeaseEpoch`
- `BlockId --does_not_prove→ SemanticKVIdentity`
- `PhysicalAddress --requires→ KVLeaseEpoch → SemanticKVIdentity`
- `BlockTable/TokenTable --implements→ KVAddressTranslationLayer`

## 本輪結束判斷
缺哪一層：multi-group/connector/offload下的完整 lease transition taxonomy + Triton exact indexing。
最淺節點：`KVLeaseEpoch`已找到production-grade候選hook，但尚未變成跨所有KV路徑的universal witness。
仍只是名詞：`ObservedPhysicalKVReadSet`。
最值得讀原始碼：vLLM `kv_cache_coordinator.py`、`single_type_kv_cache_manager.py`、`triton_unified_attention.py`。
需追引用：vToken，尤其token relocation與PagedAttention compatibility；SparseX則追segment-level semantic lineage。
最適合視覺模擬：KV Block Lease Timeline Microscope。
最值得實作的Agent架構：`State-grounded Planner + Runtime Provenance Verifier + KV Lease/Address Translator + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。
