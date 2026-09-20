# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 01:51（Asia/Taipei）

## 本小時新發現
本輪接續上一輪 `KVLeaseEpoch → connector/offload → Triton exact indexing`，避免重複 CUDA Graph 與 block reuse 基礎。核心進展有兩個：第一，current vLLM 對 external-computed KV 採「先保護所有 group 的 local hits，再為 external tokens 配 GPU blocks」的 two-phase allocation，說明外部 KV 的 semantic content lineage 與 GPU physical lease 是兩個不同生命週期；第二，Triton unified attention 已能把 block-table translation 精確下鑽到 physical block 與 cache stride，讓 ExpectedPhysicalKVReadSet 可以從概念變成可計算集合。

## 本小時最重要 5 個發現

### 1. External KV import 不是沿用遠端 physical lease，而是在本地重新取得 GPU lease
**已確認工程實作**：`KVCacheCoordinator` 先對所有 single-type manager 執行 `add_local_computed_blocks()`，之後才對 external computed tokens 執行 `allocate_external_computed_blocks()`。後者最後呼叫本地 `block_pool.get_new_blocks()`，把 external semantic content 配到新的 local physical blocks。

因此 canonical provenance 必須拆成：
`Remote/External SemanticKVContentLineage → Transfer/Promotion → Local block_pool.get_new_blocks → Local KVLeaseEpoch → Local KVContentMaterializationEpoch`。

結論：跨節點/跨 tier 傳輸可以保留 semantic content lineage，但不能保留 physical block identity 或 physical lease identity。

### 2. Hybrid / multi-group allocation 有明確的 cross-group correctness ordering
Coordinator source 明確說明 two-phase allocation 是為了避免「較早 group 為 external tokens 呼叫 get_new_blocks，卻 evict 尚未 touch 的較晚 group local cache-hit blocks」。這表示 KV provenance 不只是 per-block；在 hybrid/multi-group runtime 中還存在 `CrossGroupAllocationBarrier`。

新增 invariant：
`AllGroups.LocalHitProtectionComplete → AnyGroup.ExternalPhysicalAllocationAllowed`。

如果 instrumentation 只觀察單一 group，可能錯過造成 lease transition 的跨 group eviction pressure。

### 3. Triton attention 的 block-table translation 已能寫成 exact index relation
current vLLM Triton family明確使用：
`physical_block_idx = block_table[block_table_offset + floor(seq_offset / BLOCK_SIZE)]`。

之後 cache base 由 `cache_ptr + physical_block_idx * stride_cache_0 + kv_head_idx * stride_cache_2` 建立，再以 block slot / head dimension stride形成實際 K/V load tile。因此 classic paged-KV 的 address provenance可以寫成：
`seq_offset → logical_block=floor(seq_offset/BLOCK_SIZE) → block_table[row, logical_block] → physical_block → cache base(stride_cache_0) → slot(stride_cache_1) → kv_head(stride_cache_2) → dim(stride_cache_3)`。

限制：實際 visible `seq_offset` 集合仍受 causal/window/prefix/R-SWA/chunked/multimodal range等 policy影響，所以不能把 `[0, seq_len)` 無條件當成 read set。

### 4. ExpectedPhysicalKVReadSet 應是「policy-filtered translation result」，不是整張 BlockTable
正確拆解：
`QueryInvocation → AttentionVisibilityPolicy → VisibleLogicalPositionSet → LogicalBlock/SlotSet → TranslationEpoch → PhysicalBlock@LeaseEpoch → Layout/Quantization → ExpectedByteRangeSet`。

這讓 Hermes 可以在沒有逐 load hardware trace 前，先產生 model/kernel contract層的 expected read-set；之後再和 observed kernel execution / memory instrumentation比較。

### 5. Offloading 讓 Residency 成為獨立 provenance axis
vLLM 最新 tiering offload設計是 GPU ↔ CPU primary tier ↔ secondary storage/network tier；secondary tier不能直接碰 GPU，必須先 promotion到 CPU primary，再進 GPU。這表示 `SemanticContentLineage`、`PhysicalResidency`、`PhysicalLease` 三者不能合併。

建議：
`SemanticKVContentId` 可跨 tier保持；
`ResidencyEpoch` 每次 HBM/CPU/storage/network placement變化；
`KVLeaseEpoch` 只描述某個 local physical pool slot 的 generation；
`MaterializationEpoch` 描述 semantic content被寫入該 lease 的那次實體化。

## Architecture Breakdown

### External KV → Local Attention Read Architecture
`External KV semantic match`
→ `Coordinator local-hit protection phase`
→ `External allocation phase`
→ `Local BlockPool.get_new_blocks`
→ `Local KVLeaseEpoch`
→ `Connector transfer / tier promotion`
→ `KVContentMaterializationEpoch`
→ `BlockTable / translation table update`
→ `AttentionVisibilityPolicy`
→ `VisibleLogicalPositionSet`
→ `physical_block_idx lookup`
→ `K/V cache stride address`
→ `Attention kernel load`
→ `Attention output`

### Three-axis identity model
1. Semantic axis: request/prefix/segment/content lineage.
2. Residency axis: GPU HBM / CPU primary / SSD/network secondary / remote producer.
3. Physical axis: pool + block + lease + slot + layout.

只有三軸 join後，才能聲稱「這次 Layer/Attention invocation 讀到的是哪一代、哪個來源、目前住在哪裡的 KV」。

## Bottom-Level Logic

### Exact classic paged-KV translation
對 visible logical position `p`：
- `logical_block = floor(p / BLOCK_SIZE)`
- `slot = p mod BLOCK_SIZE`
- `physical_block = block_table[seq_row, logical_block]`
- `lease = lease_epoch(pool, physical_block)`
- `K_base = K_cache + physical_block * stride_block + kv_head * stride_head`
- `K_addr(d) = K_base + slot * stride_slot + d * stride_dim`
- V 同理，但 layout/stride可能不同。

對 kernel tile，`ExpectedPhysicalKVReadSet` 是所有 policy-visible `p`、實際 kv heads、head dimensions經上述映射後的 byte ranges聯集，而不是單一 pointer。

### External materialization contract
`ExternalContentMatchWitness`
+ `CrossGroupAllocationBarrierWitness`
+ `LocalBlockLeaseStarted`
+ `TransferStarted/Completed`
+ `MaterializationEpoch`
+ `TranslationEpoch`
→ `LocalReadableKVContentWitness`。

如果 block已 allocate但 transfer尚未完成，不能標成 readable；如果 transfer完成但 translation table尚未切換，也不能聲稱該 attention invocation會讀它。

## Visual Simulation Idea
### KV Residency × Address Translation Microscope
三層同步時間軸：

`SEMANTIC: Prefix P77 / Content C12`
`RESIDENCY: Remote P-node → CPU Primary → GPU D-node`
`PHYSICAL: GPU Block42@Lease8 → slot0..15 → byte ranges`

右側顯示某次 Attention：
`Visible token 33 → logical block2/slot1 → BlockTable[2]=42 → Lease8 → K/V address ranges`。

若 transfer未完成顯示 `CONTENT_NOT_MATERIALIZED`；若 block id吻合但 lease不同顯示 `ADDRESS_MATCH_LEASE_MISMATCH`；若 semantic content吻合但目前只在 secondary tier顯示 `SEMANTIC_HIT_NOT_GPU_RESIDENT`。

## Code / GitHub
本輪值得看的 current vLLM 原始碼：
- `vllm/v1/core/kv_cache_coordinator.py`: two-phase local-hit protection / external allocation，multi-group ordering。
- `vllm/v1/core/single_type_kv_cache_manager.py`: `allocate_external_computed_blocks()` 最終使用 local `block_pool.get_new_blocks()`；partial local hit另有 CoW block path。
- `vllm/v1/attention/ops/triton_unified_attention.py`: block table、cache strides、2D/3D unified attention與多種 visibility policy。
- `vllm/v1/attention/ops/triton_unified_attention_diffkv.py`: source中可直接看到 `seq_offset // BLOCK_SIZE → physical_block_idx`。
- `vllm/v1/kv_offload/tiering/manager.py`: CPU primary + secondary tier promotion architecture。

## Papers
### SmartGen: Seamless Disaggregated LLM Inference with Selective KV Cache Transfer
Authors: Xuchuan Luo, Jiacheng Shen, Xin Wang, Yangfan Zhou
Year: 2026
URL: https://arxiv.org/abs/2607.28150
Architecture: profile-based proactive transfer + parallel on-demand transfer + speculative transfer for P/D-disaggregated serving.
Contribution: 將 KV transfer從「全量搬移」改成多路徑 selective materialization；論文報告 TTST最高改善4.3×。
Limitations: selective transfer意味 decode端某時刻可能只 materialize semantic KV的一部分，Hermes不能把 request-level transfer-complete當成全部KV resident。
Changed: 引入 `PartialMaterializationEpoch` 與 `RemoteReadableSet` 概念。

### Tutti: Making SSD-Backed KV Cache Practical for Long-Context LLM Serving
Authors: Shi Qiu et al.
Year: 2026
URL: https://arxiv.org/abs/2605.03375
Architecture: GPU-centric KV object store + GPU io_uring + slack-aware I/O scheduling。
Contribution: 把 SSD-backed KV 的 control/data path進一步推向GPU；論文報告相對GDS-enabled LMCache TTFT降低78.3%、request rate 2×。
Limitations: 其GPU-native storage path會打破「所有secondary tier都必經CPU primary」這種vLLM特定假設，因此Knowledge Graph必須把tier transport建模成capability，而非 universal rule。
Changed: `ResidencyTransition` 必須能表示 CPU-staged 與 GPU-direct storage兩類 transport。

## Unknown / Open Questions
1. `allocate_external_computed_blocks()` 分配 local GPU block後，connector transfer completion與 scheduler何時允許該 request進入attention，精確 barrier在哪一層？
2. Unified attention在 causal/window/R-SWA/mm-prefix/chunked attention下，如何逐 token構造最小 `VisibleLogicalPositionSet`？需要逐分支還原。
3. 如何取得 `ObservedPhysicalKVReadSet`：CUPTI/kernel args只能證明kernel與base tensors，不等於逐memory-load witness；需評估SASS instrumentation、sanitizer/trace或causal intervention。

## 下一輪研究
`Connector scheduler/worker handshake`
→ transfer start/complete/readiness barrier
→ `KVContentMaterializationEpoch`
→ attention visibility policy逐分支
→ exact `VisibleLogicalPositionSet`
→ exact byte-range generator
→ ModelKernelInvocationContract
→ ExpectedPhysicalKVReadSet
→ ObservedPhysicalKVReadSet candidate
→ ZERO/REPLACE selected KV slot
→ ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction

## Knowledge Graph 新增 Node / Edge
Nodes:
- `CrossGroupAllocationBarrier`
- `ExternalSemanticKVContentLineage`
- `ResidencyEpoch`
- `KVContentMaterializationEpoch`
- `PartialMaterializationEpoch`
- `LocalReadableKVContentWitness`
- `AttentionVisibilityPolicy`
- `VisibleLogicalPositionSet`
- `ExpectedByteRangeSet`
- `ResidencyTransitionCapability`
- `SemanticHitNotGPUResidentState`

Edges:
- `ExternalSemanticKVContentLineage → materializes_as → Local KVLeaseEpoch`
- `AllGroups.LocalHitProtectionComplete → precedes → ExternalPhysicalAllocation`
- `BlockTable + TranslationEpoch → maps → LogicalBlock → PhysicalBlock`
- `AttentionVisibilityPolicy → filters → VisibleLogicalPositionSet`
- `VisibleLogicalPositionSet + Translation + Layout → derives → ExpectedPhysicalKVReadSet`
- `SemanticContentLineage --not_equal→ PhysicalResidency`
- `PhysicalResidency --not_equal→ PhysicalLease`
- `ExternalContentMatch --does_not_prove→ GPUReadableKV`

## 本輪結束判斷
缺哪一層：connector transfer-completion/readiness barrier + visibility-policy exact token set。
最淺節點：`KVContentMaterializationEpoch` production witness。
仍只是名詞：`ObservedPhysicalKVReadSet`；Expected set已更接近可計算。
最值得讀原始碼：vLLM connector scheduler/worker handshake、`triton_unified_attention.py` visibility branches。
需追引用：SmartGen（partial/selective KV materialization）與 Tutti（GPU-direct storage path）。
最適合視覺模擬：KV Residency × Address Translation Microscope。
最值得實作的Agent架構：`State-grounded Planner + Runtime Provenance Verifier + Residency/Lease/Content Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。
