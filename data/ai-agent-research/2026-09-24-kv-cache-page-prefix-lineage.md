# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 20:50 Asia/Taipei

## 本小時新發現
本輪延續前一輪 `CommittedTokenGeneration → KV Cache` 缺口，避開既有 2026-09-08 long-context/RoPE/KV-cache 報告的宏觀介紹，專注 **request-local KV identity、PagedAttention block/slot mapping、prefix-cache reuse、preemption/reuse、multimodal/LoRA cache key 與下一步 attention read provenance**。

核心命題：

`CommittedTokenCorrect ≠ NextDecodeKVCorrect`

更精確：

`TokenGeneration → Layer K/V Projection → Logical KV Position → KV Group → Logical Block → Physical Block/Page → Slot → Write → Cache/Prefix Identity → Read Mapping → Attention Consumer`

任何一層 generation 錯綁，都可能讓下一步 query 讀到「數值有效但語意屬於另一 request/prefix/model generation」的 K/V。

## 本小時最重要 5 個發現

### 1. PagedAttention 的核心不是 cache，而是 KV virtual-memory translation
**已確認／論文結果。** Kwon et al., SOSP 2023 的 PagedAttention 將 KV cache 管理類比 OS paging，把每個 sequence 的 logical KV blocks 映射到非連續 physical blocks；vLLM 論文報告近零 KV memory waste、跨 request sharing，並在當時評估中相較 FasterTransformer/Orca 提升 2–4× throughput。

底層應拆成：
`request token position → logical block index → block table entry → physical block id → intra-block offset → layer K/V address`。

因此 `physical block id` 本身不是 semantic identity；它必須與 request generation、token span、layer/model generation 綁定。

來源：https://arxiv.org/abs/2309.06180 ; https://doi.org/10.1145/3600006.3613165

### 2. current vLLM KVCacheManager 明確把 request allocation 與 cache-hit blocks 分開
**已確認／原始碼。** `vllm/v1/core/kv_cache_manager.py` 的 `KVCacheBlocks` 以 group→blocks 表示配置；`get_computed_blocks()` 先由 request block hashes 尋找 longest cache hit，且即使所有 token hit cache，也必須重算最後 token以取得 logits。`allocate_slots()`則為新 tokens、prefix-hit tokens、lookahead/speculative tokens及 external-computed tokens配置 slots。

這意味著 provenance 至少要區分：
`ComputedPrefixKVGeneration`、`NewKVWriteGeneration`、`LookaheadKVReservationGeneration`、`ExternalKVGeneration`。

不能只記「request R 使用 blocks [1,2,3]」。

原始碼：https://github.com/vllm-project/vllm/blob/main/vllm/v1/core/kv_cache_manager.py

### 3. Prefix cache key 已經是 provenance tuple，而不是純 token hash
**已確認／官方設計。** current vLLM Automatic Prefix Caching 以 parent block hash + exact block tokens + extra hashes 建 block identity；extra components可包含 LoRA IDs、多模態 input hashes與 cache salt。v0.11 起 default hash為 SHA-256；`sha256_cbor`提供跨語言/環境較可重現的 canonical serialization。只 cache full blocks。

因此 Hermes 應建：
`PrefixKVIdentity = H(parentPrefixIdentity, exactTokenIds, modelGeneration, tokenizerGeneration, KVLayoutGeneration, LoRAGeneration, multimodalInputIdentity, cacheSaltTrustDomain)`。

vLLM目前 key已覆蓋部分因素，但 Hermes witness應額外顯式綁 model/KV-layout generation，而不是假定 process config永遠不變。

來源：https://docs.vllm.ai/en/latest/design/prefix_caching/

### 4. Prefix reuse 同時是 correctness 與 security boundary
**已確認／官方安全文件。** vLLM security documentation指出 shared prefix cache存在 timing side channel；`cache_salt`混入第一個 KV block hash，可限制只有相同 salt的 requests共享 prefix。多模態 cache identity若由 caller-supplied UUID錯誤重用，還可能造成另一 caller的 cached media output被重用，因此官方建議 multi-tenant使用唯一 media UUID，並以 per-tenant secret cache salt做 defense-in-depth。

所以：
`CacheHit --does_not_prove→ AuthorizedCacheReuse`。

新增 `PrefixCacheAuthorizationWitness`，把 cache reuse trust domain納入 Agent runtime安全模型。

來源：https://docs.vllm.ai/en/v0.29.0/usage/security/ ; https://docs.vllm.ai/en/latest/design/prefix_caching/

### 5. block-level paging正在往 token-level virtualization演進
**論文結果／2026新研究。** Gao et al. 的 vToken（2026-08-13）指出 block-level PagedAttention與 token-granularity eviction存在粒度不匹配，提出 stable logical token view + token-table indirection，讓 live tokens可非同步 repack到 physical blocks，同時保留 PagedAttention kernels與 CUDA Graph compatibility。論文報告 retained KV blocks/request降低 27.2%–72.3%，SLA throughput最高 1.37×，受限 active-KV budget下 concurrency最高2×。

這使 Hermes identity需要從 `KVBlockGeneration`進一步抽象為：
`LogicalKVTokenIdentity → PlacementGeneration → PhysicalKVSlotGeneration`。

也就是未來 physical block甚至不應被視為長期 token identity。

來源：https://arxiv.org/abs/2608.13263

## Architecture Breakdown

### vLLM KV serving path
`Committed Token / Prompt Token`
→ layer Q/K/V projection
→ K/V tensor generation
→ scheduler request state
→ KVCacheManager.get_computed_blocks()
→ prefix-cache hit reconciliation
→ KVCacheManager.allocate_slots()
→ KV cache group/coordinator
→ logical block table
→ physical block IDs / slots
→ attention kernel slot mapping
→ KV write
→ future decode query
→ block table / slot mapping read
→ paged attention gather
→ attention score/value aggregation
→ next residual/logits

### Prefix reuse path
`Token IDs`
→ block partition
→ parent block hash
→ block tokens
→ extra hashes (LoRA / multimodal / salt)
→ PrefixKVIdentity
→ block pool lookup
→ cached physical block binding
→ request computed-prefix binding
→ remaining suffix allocation
→ attention read.

## Bottom-Level Logic

Hermes 應建立以下 witness：

`KVProjectionWitness = H(modelWeightState, layer, tokenGeneration, position, KDigest, VDigest)`

`LogicalKVTokenIdentity = H(requestGeneration, sequenceGeneration, tokenGeneration, absolutePosition, layerGeneration, kvHead)`

`KVPlacementGeneration = H(logicalKVToken, kvCacheLayoutGeneration, groupId, logicalBlockIndex, physicalBlockGeneration, slotOffset)`

`KVWriteWitness = H(logicalKVToken, placementGeneration, producerKernelGeneration, storageGeneration, completionDependency)`

`PrefixKVIdentity = H(parentPrefixIdentity, exactTokenIds, extraIdentitySet, hashAlgorithmGeneration)`

`PrefixCacheReuseWitness = H(requestGeneration, prefixKVIdentity, matchedTokenSpan, physicalBlocks, trustDomain, cacheSaltGeneration)`

`KVReadWitness = H(queryGeneration, requestedPositionSet, blockTableGeneration, slotMappingGeneration, resolvedPhysicalKVGenerations, attentionKernelGeneration)`

最重要 invariant：

`KVReadWitness.resolvedLogicalKVSet == AttentionSemantics.requiredPastKVSet`

而不是僅檢查 pointer/block存在。

## Visual Simulation Idea
### KV Cache Virtual Memory & Prefix Lineage Microscope

互動欄位：
`Request | Token Position | Layer | Logical KV Token | Logical Block | Prefix Hash | Cache Hit | Physical Block | Slot | Storage Generation | Write | Read | Attention Consumer`

視覺上同時呈現：
1. sequence token timeline；
2. logical KV pages；
3. physical GPU blocks；
4. prefix-sharing edges；
5. preemption/free/reuse timeline；
6. multimodal/LoRA/cache-salt identity；
7. 下一 decode step實際讀取的 K/V集合。

故障注入：
`STALE_BLOCK_TABLE`、`PHYSICAL_BLOCK_REUSED_FOR_OTHER_REQUEST`、`PREFIX_HASH_COLLISION`、`CACHE_SALT_TRUST_DOMAIN_MISMATCH`、`LORA_ID_MISSING_FROM_CACHE_IDENTITY`、`MULTIMODAL_HASH_WRONG`、`PREEMPTED_REQUEST_RESUMES_WITH_OLD_SLOT_MAPPING`、`SPEC_LOOKAHEAD_SLOT_COMMITTED_AS_REAL_TOKEN`、`TOKEN_REPACK_MOVED_WITH_STALE_TOKEN_TABLE`。

## Code / GitHub

### vLLM
Repo: https://github.com/vllm-project/vllm

優先目錄／核心檔：
- `vllm/v1/core/kv_cache_manager.py` — request-facing allocation、prefix hit、slot lifecycle。
- `vllm/v1/core/kv_cache_coordinator.py` — multi-group/hybrid cache coordination。
- `vllm/v1/core/single_type_kv_cache_manager.py` — per-cache-type allocation/retention。
- `vllm/v1/core/kv_cache_utils.py` — block/hash/config utilities。
- `vllm/v1/kv_cache_interface.py` — cache specs/groups/layout contract。
- attention backends / kernels — block table、slot mapping如何真正進 kernel。

current source 顯示 `KVCacheBlocks.blocks[i][j]`直接代表第 i 個 KV cache group的第 j 個 block；`get_computed_blocks()`使用 request.block_hashes找 longest hit，並對 hybrid groups做 reconciliation。這是 Hermes應插入 `KVPlacementWitness`與`PrefixCacheReuseWitness`的最佳 runtime seam。

## Papers

### Efficient Memory Management for Large Language Model Serving with PagedAttention
- Authors: Woosuk Kwon, Zhuohan Li, Siyuan Zhuang, Ying Sheng, Lianmin Zheng, Cody Hao Yu, Joseph E. Gonzalez, Hao Zhang, Ion Stoica
- Institution: UC Berkeley / associated collaborators
- Year: 2023, SOSP 2023
- URL: https://arxiv.org/abs/2309.06180
- Code: https://github.com/vllm-project/vllm
- Dataset/Workloads: LLM serving workloads/models used in system evaluation
- Architecture: logical KV blocks → physical blocks + block tables + PagedAttention kernel
- Contribution: virtual-memory-inspired KV paging/sharing；顯著降低 fragmentation/duplication。
- Limitations: original block abstraction不直接解決後來的 token-granularity eviction、hybrid-state models、multi-tenant cache identity等問題。
- 改變了什麼: 把 KV cache從 contiguous per-sequence allocation變成 serving runtime可虛擬化/共享的 memory object。

### vToken: Token-Level Virtualization for Reclaimable KV Caches
- Authors: Yuanhang Gao, Xiangrui Yang, Yuanfeng Chen, Hongjia Chen, Qianru Lv, Wenfei Wu, Dongsheng Li
- Year: 2026
- URL: https://arxiv.org/abs/2608.13263
- Code: 論文描述 implementation in vLLM；本輪尚未確認獨立公開 repo/merge狀態。
- Dataset/Policies: H2O, Random, Scissorhands；多模型 serving evaluation
- Architecture: stable logical token table → asynchronous physical repacking → unchanged PagedAttention kernel interface
- Contribution: decouple token liveness from physical block placement。
- Limitations: 額外 indirection/repacking correctness與 concurrent generation lineage仍需深入驗證。
- 改變了什麼: KV provenance應從 block identity升級為 logical-token identity + placement generation。

### Jenga: Effective Memory Management for Serving LLM with Heterogeneity
- Authors: Chen Zhang et al.
- Year: 2025
- URL: https://arxiv.org/abs/2503.18292
- Architecture: two-level allocator + layer-specific caching logic for heterogeneous model states
- Contribution: 處理 modern model embeddings/attention/access-pattern heterogeneity；報告最高79.6% GPU memory-utilization improvement、最高4.92× throughput。
- Limitation: 更複雜 allocator意味 Hermes不能假設「一種 KV block layout適用所有 layers」。

## Unknown / Open Questions
1. current attention backend中，`slot_mapping / block_table`從 scheduler metadata到 CUDA/Triton kernel的 exact generation chain在哪些結構間傳遞？下一輪需逐檔追原始碼。
2. preemption/resume、KV connector、disaggregated prefill時，external KV如何證明 model/layer/position/layout generation完全相容，而非只「傳輸成功」？
3. vToken式 token repacking若與 CUDA Graph、prefix sharing、speculative lookahead同時存在，如何提供低 overhead atomic placement-generation transition？

## 下一輪研究
鎖定：
`KVReadWitness → AttentionMetadata → block_table/slot_mapping → PagedAttention/Triton/FlashAttention kernel → Q×K score → mask/causal/window semantics → softmax → V gather → AttentionOutputWitness`

並追：
- vLLM attention backend source；
- hybrid KV cache manager；
- KV connector/disaggregated prefill；
- prefix-cache security與multimodal cache identity；
- vToken source/merge狀態。

## Knowledge Graph 新增 Node / Edge

Nodes:
- `KVCacheLayoutGeneration`
- `KVCacheGroupGeneration`
- `LogicalKVTokenIdentity`
- `KVProjectionGeneration`
- `KVProjectionWitness`
- `LogicalKVBlockGeneration`
- `PhysicalKVBlockGeneration`
- `PhysicalKVSlotGeneration`
- `KVPlacementGeneration`
- `KVWriteGeneration`
- `KVWriteWitness`
- `BlockTableGeneration`
- `SlotMappingGeneration`
- `PrefixKVIdentity`
- `PrefixHashAlgorithmGeneration`
- `PrefixCacheReuseGeneration`
- `PrefixCacheReuseWitness`
- `PrefixCacheAuthorizationWitness`
- `CacheSaltGeneration`
- `ExternalKVGeneration`
- `LookaheadKVReservationGeneration`
- `KVPreemptionGeneration`
- `KVReallocationGeneration`
- `KVReadGeneration`
- `KVReadWitness`
- `KVTokenRepackGeneration`

Edges:
- `CommittedTokenGeneration --produces_next_step_state→ LogicalKVTokenIdentity`
- `LogicalKVTokenIdentity --projected_as→ KVProjectionGeneration`
- `LogicalKVTokenIdentity --placed_by→ KVPlacementGeneration`
- `KVPlacementGeneration --resolves_to→ PhysicalKVSlotGeneration`
- `PrefixKVIdentity --may_reuse→ PhysicalKVBlockGeneration`
- `CacheSaltGeneration --scopes_authority_of→ PrefixCacheReuseGeneration`
- `KVPreemptionGeneration --invalidates_or_transitions→ KVPlacementGeneration`
- `KVTokenRepackGeneration --changes_physical_placement_of→ LogicalKVTokenIdentity`
- `KVReadGeneration --must_resolve→ CorrectLogicalPastKVSet`
- `KVReadWitness --feeds→ AttentionKernelGeneration`

## 本輪結束判斷
- **缺哪一層：** KV read metadata → attention kernel exact Q/K/V consumption。
- **哪個節點最淺：** `KVReadWitness`，尤其 hybrid/disaggregated KV下的 cross-runtime identity。
- **哪個概念仍只是名詞：** portable `KVPlacementGeneration` attestation；尚未有跨 serving engine標準。
- **哪個系統值得讀原始碼：** vLLM attention backend + KV connector，其次 SGLang radix/prefix cache作對照。
- **哪篇論文需追引用：** PagedAttention（追 serving-memory演化）；最新線優先 vToken。
- **哪個概念最適合視覺模擬：** KV Cache Virtual Memory & Prefix Lineage Microscope。
- **哪個 Agent 架構最值得實作：** `Event-sourced Agent Runtime + TokenCommitWitness + LogicalKVTokenIdentity + KVPlacementWitness + KVReadWitness + AttentionOutputWitness`。

## 端到端進度
`User → UI → Agent → Context → Prompt Compiler → Token/Embedding → Weights → Transformer/MoE → Distributed GPU → Kernel → Raw Logits → Sampling/RNG/Speculation → Committed Token → KV logical identity → block/page/slot placement → prefix reuse/preemption → KV read → [attention exact-consumption gap] → next logits → Decode/Stream → Observation → Tool/Effect → Context Re-entry`
