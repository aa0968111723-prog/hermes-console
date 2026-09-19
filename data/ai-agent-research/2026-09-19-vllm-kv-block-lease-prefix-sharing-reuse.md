# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 19:52（Asia/Taipei）

主題：vLLM KV Block Lease × Prefix Sharing × Free/Reuse Temporal Identity

## 本小時新發現

本輪承接上一輪 `Visual Token → Logical KV Slot → Physical KV Block/Slot → Attention Kernel Read`，專門閉合最淺節點 `AllocationEpochWitness`。核心結論：**physical block_id 不是穩定的 token provenance identity；真正可驗證的 identity 必須加入 lease / residency epoch。** vLLM current `BlockPool` 預先建立固定 block_id 的 `KVCacheBlock` pool；block 經 allocate、touch、free、cache eviction、reuse 後，同一 block_id 可以在不同時間承載不同 prefix/token contents。

新架構：`Temporal KV Provenance / Block Lease Model`。

新 GitHub 深讀：`vllm/v1/core/block_pool.py`，追到 `BlockHashToBlockMap`、`BlockPool.get_new_blocks()`、`touch()`、`free_blocks()`、`unpin_blocks()`、`_notify_reuse()`、`_maybe_evict_cached_block()`、`move_block_hashes()`、`reset_prefix_cache()`。

新研究：PolyKV（2026-04-27）、Tutti（2026-05-05）、DroidSpeak（NSDI 2026）、OasisKV（2026-08）、py-kvcache（2026-09-10）顯示 KV identity 已不能只假設為單 GPU HBM block；sharing、compression、cross-model reuse、CPU/NVMe/offload 都要求把 logical KV identity 與 physical residency 分離。

## 本小時最重要 5 個發現

### 1. block_id 是 pool slot identity，不是永久 content identity【已確認：原始碼】

`BlockPool.__init__` 建立 `KVCacheBlock(idx)`；`get_new_blocks()` 從 free queue 取回 block，若該 block 曾是 cached prefix，會先 `_maybe_evict_cached_block()` 清掉 hash metadata，再把 refcount 從 0 提升為 1。也就是同一 `block_id=91` 可先代表 prefix A，free/evict/reuse 後再代表 prefix B。

底層：`Fixed Pool Slot → Lease A(content/hash A) → ref_cnt→0 → free queue → eviction/reuse → Lease B(content/hash B)`。

重要性：上一輪 `PhysicalKVSlotWitness(block=91)` 若沒有 epoch，跨 scheduler step 或 trace replay 就可能錯接舊內容。

限制：current code 沒有直接命名 `allocation_epoch` 欄位；epoch 是 Hermes 應由事件/allocate/reuse transitions 建立的 provenance abstraction。

來源：https://github.com/vllm-project/vllm/blob/main/vllm/v1/core/block_pool.py

### 2. Prefix sharing 是 refcount lease sharing，而不是複製 KV【已確認：原始碼/官方 docs】

cache hit 時 `touch(blocks)`：若 `ref_cnt==0`，先從 free queue 移除，再 `ref_cnt += 1`。同一 cached block 因此可以被多個 requests 同時引用。官方 block_pool docs 同樣描述 cached block 可同時被 running request 使用或位於 free queue 成為 eviction candidate。

底層：`BlockHash → cached KVCacheBlock → request A touch → request B touch → ref_cnt=N → shared physical block`。

重要性：Knowledge Graph 必須支援 `N logical request-prefix identities → 1 physical block lease` 多對一 edge。

限制：sharing 的正確性依賴 prefix hash、group identity、model/runtime compatibility；不能把相同 token text 自動視為相同 KV。

來源：https://docs.vllm.ai/en/latest/api/vllm/v1/core/block_pool/

### 3. free 不等於 bytes 立刻失效；存在 readable-until-reuse window【已確認：原始碼】

`unpin_blocks()` 明確允許釋放 reference 後 block 保持 readable until reused，並註冊 `_reuse_watchers`；`get_new_blocks()` 真正重新配置時 `_notify_reuse()` 才通知 caller 停止讀取。

因此需要區分：`OWNED → UNPINNED_BUT_READABLE → REUSED/INVALIDATED`。

重要性：這提供比單純 allocate/free 更精確的 temporal provenance boundary，也直接回答上一輪「block 什麼時候真正失去 identity」。

限制：這是 runtime semantic witness，不等同 GPU hardware memory scrub；舊 bytes 是否仍物理殘留不能由這段 code 證明。

來源：https://github.com/vllm-project/vllm/blob/main/vllm/v1/core/block_pool.py

### 4. Prefix cache eviction 與 physical allocation lifecycle 是兩層【已確認：原始碼】

`evict_blocks()` 對 ref_cnt>0 block 可以只從 prefix hash table 移除，而不把 block 從 pool free；`free_blocks()` 則 decrement refcount，ref_cnt 到 0 才回 free queue。cached blocks 採 FIFO append 以形成 LRU-like eviction，non-cached blocks採 LIFO prepend以提升 GPU locality。

所以：`PrefixCacheReachability ≠ PhysicalBlockResidency ≠ ActiveRequestOwnership`。

重要性：Hermes debugger 必須同時畫三個 state，而不是一個 cached/free boolean。

限制：不同 connector/offload backend 可能增加其他 residency tier。

來源：https://github.com/vllm-project/vllm/blob/main/vllm/v1/core/block_pool.py

### 5. KV provenance 必須升級成 location-independent identity【論文結果 + 工程推論】

2026 systems 已把 KV 移出單一 HBM：Tutti 做 SSD-backed KV；OasisKV 將 decode KV 從 HBM 解耦並做 sparse prefetch；DroidSpeak 跨 fine-tuned model variants reuse；PolyKV 讓多 agents 共用壓縮 KV pool；py-kvcache 則量測 GPU/CPU/NVMe tier tradeoff。因此 `GPU block #91` 只能是某一時刻的 residency witness，而不能成為 canonical KV identity。

Hermes canonical identity 應為：`(model/version, request/prefix lineage, layer, kv-head/group, logical token range, content/hash semantics)`；physical location則是 timestamped lease edge。

限制：跨模型 sharing 的數值等價性依系統而異；不能把 DroidSpeak/PolyKV 的近似 reuse 泛化成 exact identity。

## Architecture Breakdown

```text
Screenshot Region
→ Visual Token
→ Exact LLM Sequence Slot
→ Logical KV Identity
→ Prefix/Block Hash
→ KV Cache Group
→ BlockHashToBlockMap
→ KVCacheBlock(block_id)
→ BlockLease(epoch)
   ├─ owner request(s)
   ├─ ref_cnt
   ├─ cached hash(es)
   ├─ residency medium
   └─ readable state
→ BlockTable
→ Kernel Block
→ Physical Slot
→ Attention Kernel Read
```

Lifecycle：

```text
FREE
→ get_new_blocks
→ ALLOCATED(ref=1)
→ fill KV
→ CACHEABLE(hash)
→ SHARED(touch, ref=N)
→ release refs
→ ref=0
→ FREE_QUEUE + CACHED/EVICTION_CANDIDATE
→ [optional UNPINNED_BUT_READABLE]
→ reuse selected
→ old hashes removed / reuse watcher fired
→ NEW LEASE EPOCH
```

## Bottom-Level Logic

Hermes 應新增 runtime instrumentation：

```text
on_allocate(block_id): epoch[block_id] += 1
on_hash_attach(block_id, hash, group): bind hash to lease
on_touch(block_id, request): add request-holder edge
on_free_ref(block_id, request): remove holder edge
on_unpin(block_id): state = READABLE_UNTIL_REUSE
on_reuse(block_id): close previous lease; invalidate stale witnesses
on_evict_hash(block_id): remove prefix-reachability edge only
```

`PhysicalKVSlotWitness` 必須改為：

```text
KVBlockLeaseWitness {
  block_id,
  allocation_epoch,
  cache_group_id,
  logical_token_range,
  block_hash,
  holders[],
  ref_cnt,
  residency_medium,
  state,
  allocated_at_step,
  invalidated_at_step
}
```

## Visual Simulation Idea

### KV Block Lease Timeline × VRAM Residency Inspector

互動介面同時呈現：

1. 左：request/prefix tree。
2. 中：block pool，顯示 block_id、epoch、refcount、hash、free-queue position。
3. 右：GPU/CPU/NVMe residency tiers。
4. 下方 timeline：allocate → share → unpin → free → evict → reuse。

點 `block #91` 可以看到：

```text
E17: visual token S417 / request A+B / hash H1
→ ref 2→1→0
→ cached free candidate
→ reused
E18: request C / hash H9
```

若使用者試圖用 E17 witness 解釋 E18 kernel read，UI 顯示 `STALE_PHYSICAL_IDENTITY`。

## Code / GitHub

值得繼續看的 vLLM 目錄/核心檔：

- `vllm/v1/core/block_pool.py`：allocation/free/cache/reuse/refcount lifecycle。
- `vllm/v1/core/kv_cache_utils.py`：`KVCacheBlock`、free queue、hash semantics。
- `vllm/v1/core/kv_cache_manager.py` / coordinators：request→block allocation policy。
- `vllm/distributed/kv_events.py`：BlockStored/BlockRemoved/AllBlocksCleared，可作 provenance event stream。
- KV connector/offload implementations：跨 GPU/CPU/SSD residency。

vLLM：https://github.com/vllm-project/vllm

## Papers

### PolyKV: A Shared Asymmetrically-Compressed KV Cache Pool for Multi-Agent LLM Inference
- Year: 2026
- URL: https://arxiv.org/abs/2604.24971
- Architecture: shared compressed KV pool; K int8 + V 3-bit quantization; inject into multiple agents.
- Contribution: 將 multi-agent 重複 context KV 從 per-agent copies 改為 shared pool。
- Reported result: 2.91× compression；Llama-3-8B/15 agents/4K context 場景報告 97.7% KV memory reduction，perplexity +0.57%。
- Limitation: approximate/compressed reuse，不是 byte-exact KV identity。

### Tutti: Making SSD-Backed KV Cache Practical for Long-Context LLM Serving
- Authors: Shi Qiu et al.
- Year: 2026
- URL: https://arxiv.org/abs/2605.03375
- Architecture: GPU-native KV object store + GPU io_uring + slack-aware scheduling。
- Contribution: 把 KV residency 延伸到 SSD 並降低 restore stalls。
- Reported result: vs GDS-enabled SSD LMCache，TTFT -78.3%，achievable request rate 2×。
- Limitation: external-tier identity/transfer consistency 需要額外 witness。

### DroidSpeak: KV Cache Sharing Across Fine-tuned Model Variants
- Institution: Microsoft Research et al.
- Venue/Year: NSDI 2026
- URL: https://www.microsoft.com/en-us/research/publication/droidspeak-kv-cache-sharing-for-efficient-multi-llm-serving/
- Architecture: selective layer recomputation + cross-model KV reuse。
- Contribution: canonical KV identity需納入 model variant/layer compatibility。
- Limitation: selective reuse 是 quality/performance tradeoff，不是所有 layer 都 exact-equivalent。

### OasisKV: Scaling In-Decode KV Cache Beyond HBM with Lookahead Sparse Prefetching
- Institution: Microsoft Research et al.
- Year: 2026
- URL: https://www.microsoft.com/en-us/research/publication/oasiskv-scaling-in-decode-kv-cache-beyond-hbm-with-lookahead-sparse-prefetching/
- Architecture: speculative-lookahead-driven sparse KV prefetch from larger memory tiers into HBM。
- Contribution: decode kernel read set 與 full logical KV set 可以不同。
- Limitation: sparse selection introduces approximation/accuracy envelope。

### Building py-kvcache: A Performance Characterization of External KV Caching for vLLM with NVMe SSDs
- Institution: Vrije Universiteit Amsterdam; IBM Research Zurich
- Year: 2026
- URL: https://arxiv.org/abs/2609.11744
- Architecture: vLLM KV offload connector + async direct I/O + bounded staging + scheduler-aware preload。
- Contribution: 指出 external KV 是否值得載入取決於 granularity、staging、scheduler timing，不只 bandwidth。
- Limitation: 尚需追原始碼確認 connector event/identity semantics。

## Unknown / Open Questions

1. `KVCacheBlock` 的 canonical content generation/lease epoch 應由 scheduler event stream建立，還是 worker/kernel 層也需要獨立 generation counter？
2. Prefix sharing、offload/restore、connector transfer後，如何證明 restored bytes 對應同一 logical KV identity，而非只有相同 block hash metadata？
3. 在 block reuse 與 asynchronous kernels overlap 時，哪個 fence/event 才是「old lease 最後一次合法 read」與「new lease 第一個 write」的硬 temporal boundary？

## 下一輪研究

直接追：

```text
KVCacheBlock
→ FreeKVCacheBlockQueue
→ KV event stream
→ scheduler allocate/free
→ worker transfer
→ CUDA/NPU stream ordering
→ offload connector
→ HBM↔CPU/NVMe copy
→ completion event/fence
→ lease invalidation
→ exact physical residency interval
→ kernel launch correlation
→ KV zero/replace intervention
→ logit delta
```

優先閉合 `BlockLeaseIdentity → KernelReadEpochIdentity`，再進入真正 causal intervention。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `KVBlockLeaseIdentity`
- `KVAllocationEpochWitness`
- `KVBlockHolderSet`
- `PrefixCacheReachability`
- `PhysicalBlockResidency`
- `ReadableUntilReuseState`
- `KVReuseInvalidationWitness`
- `KVHashBindingWitness`
- `KVResidencyMedium`
- `KVTransferWitness`
- `StalePhysicalIdentityState`
- `KernelReadEpochIdentity`

新增 Edges：
- `LogicalKVIdentity --LEASED_AS--> KVBlockLeaseIdentity`
- `KVBlockLeaseIdentity --RESIDES_IN--> PhysicalBlockResidency`
- `RequestPrefix --SHARES--> KVBlockLeaseIdentity`
- `KVBlockLeaseIdentity --HAS_HOLDER--> Request`
- `KVBlockLeaseIdentity --REACHABLE_BY--> PrefixHash`
- `KVBlockLeaseIdentity --CLOSED_BY--> KVReuseInvalidationWitness`
- `PhysicalBlock(block_id,E17) --REUSED_AS--> PhysicalBlock(block_id,E18)`
- `KernelRead --MUST_MATCH_EPOCH--> KVBlockLeaseIdentity`

## 本輪結論

- 缺哪一層：`BlockLeaseIdentity → exact GPU stream/kernel read epoch → causal intervention`。
- 哪個節點最淺：`KernelReadEpochIdentity`。
- 哪個概念仍只是名詞：`KVInterventionWitness → LogitCausalBound → AgentActionCausalBound`。
- 哪個系統值得讀原始碼：vLLM scheduler + KV connector/offload + CUDA attention backend。
- 哪篇論文需追引用：Tutti 與 OasisKV，因為它們直接改寫「KV 一定常駐 HBM」的假設；PolyKV則值得放入 multi-agent sharing branch。
- 哪個概念最適合視覺模擬：`KV Block Lease Timeline × VRAM Residency Inspector`。
- 哪個 Agent 架構最值得實作：`Provenance-grounded Agent Runtime + Temporal KV Witness Graph + PreAction Verifier`。

最重要修正：**Hermes 已不能再把 `physical block #91` 當成穩定事實；正確問題是「block #91 的哪一個 lease epoch，在哪個 residency tier，被哪些 requests 共享，何時仍可讀、何時被 reuse，且某次 attention kernel read 是否與同一 epoch 對齊」。這是從 GPU 空間 provenance 進入 GPU 時空 provenance 的關鍵一步。**