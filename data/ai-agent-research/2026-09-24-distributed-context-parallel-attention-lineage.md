# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 22:51 Asia/Taipei

## 本小時新發現
本輪承接上一輪 `AttentionDomainGraph → distributed softmax/domain merge`，避免重複單 GPU paged-attention、KV allocation與一般 collective provenance，直接追到 **Decode Context Parallel (DCP) 的 sequence-sharded KV → per-rank local attention → local LSE → cross-rank LSE correction → output reduction → GlobalAttentionOutputWitness**。

核心命題：

`AllLocalAttentionOutputsCorrect ≠ GlobalAttentionOutputCorrect`

更精確：

`GlobalRequiredAttentionDomain → DCPPartitionGeneration → RankLocalKVDomain → LocalAttentionOutput + LocalLSE → CrossRankLSEGather → GlobalLogSumExp → RankOutputRescale → ReduceScatter/AllReduce → GlobalAttentionOutputGeneration`

## 本小時最重要 5 個發現

### 1. DCP不是「把 attention 平均」，而是 sequence-shard + log-sum-exp-aware exact merge
**已確認／官方設計 + 原始碼。** vLLM DCP沿 sequence/token 維度切 KV cache；decode時每 rank只對自己的 KV shard算局部 attention。current `vllm/v1/attention/ops/dcp.py` 先 all-gather各 rank 的 local LSE，求跨 rank global LSE，再以 `exp(local_lse - global_lse)`（或 base-2等價形式）重縮放各 rank local attention output，最後 ReduceScatter/AllReduce形成全域 output。

因此不是：`global_out = sum(local_out)`；而是：
`LSE_global = log Σ_r exp(LSE_r)`
`O_global = Σ_r O_r · exp(LSE_r - LSE_global)`。

新增 `DistributedSoftmaxMergeWitness`。

來源：https://github.com/vllm-project/vllm/blob/main/vllm/v1/attention/ops/dcp.py

### 2. LSE 的對數底數本身是跨 backend 的 semantic contract
**已確認／原始碼。** vLLM attention backend contract明確區分 natural-log LSE與 base-2 LSE；DCP combine kernel以 `IS_BASE_E`分支。原始碼註解直接警告：這個設定若錯，會 silent corrupt cross-shard softmax denominator。

因此：
`SameLocalOutput + SameNumericLSE --does_not_prove→ SameGlobalAttention`

新增：
`LSERepresentationGeneration = H(logBase, dtype, shapeLayout, backendGeneration)`。

來源：https://github.com/vllm-project/vllm/blob/main/vllm/v1/attention/backend.py

### 3. 空 shard 不是零 LSE；必須是 -∞ 才能保持 softmax identity
**已確認／原始碼。** current DCP code對沒有 local sequence的 rank把 LSE填為 `-inf`。這是必要的：softmax partition merge中空集合應貢獻 `exp(-∞)=0`；若誤用0，空 rank反而會向 denominator加入1，導致合法但錯誤的 attention output。

新增：
`EmptyShardIdentityWitness`、`RankLocalDomainCardinalityWitness`。

### 4. DCP KV layout是 interleaved virtual address space，而不必是連續 context chunk
**已確認／官方設計。** vLLM目前以 `cp_kv_cache_interleave_size`控制 token到DCP rank的交錯配置；effective attention block size會乘上 DCP world size。這代表「rank 0 = context前25%」只是概念圖，不是普遍的 physical invariant。speculative decoding更要求每次 rejection後從 global sequence length + DCP rank/size + interleave重新推導 local length，不能簡單 local_len±1。

因此新增：
`DCPTokenOwnershipGeneration = H(globalPosition, virtualBlock, interleave, dcpSize, dcpRank)`。

來源：https://docs.vllm.ai/en/latest/serving/context_parallel_deployment/ ; https://github.com/vllm-project/vllm/issues/50391

### 5. Distributed attention correctness需要「partition completeness + exclusivity + merge equivalence」三個不同 witness
**建模／由官方實作與論文交叉推導。** 只知道每 rank算對自己的 shard仍不夠。Hermes至少要證明：
1. Completeness：所有 required KV token至少被一個合法 rank覆蓋；
2. Exclusivity：非刻意 replication的 token沒有被重複計入；
3. Merge Equivalence：local `(O_r,LSE_r)`合併等價於對 union domain一次做完整 softmax attention。

這與 Ring Attention / DistFlashAttn 的核心思想一致：把 sequence/KV domain分散到裝置，但維持 exact attention semantics，同時重疊communication與compute。

來源：https://arxiv.org/abs/2310.01889 ; https://arxiv.org/abs/2310.03294

## Architecture Breakdown

### vLLM Decode Context Parallel
`Committed token / Query`
→ TP/DCP group identity
→ Q preparation / optional Q all-gather or replication
→ global KV token domain
→ interleaved DCP ownership mapping
→ each rank local block table / local KV cache
→ local attention kernel
→ `(local output O_r, local LSE_r)`
→ empty-shard masking (`LSE=-inf`)
→ LSE all-gather
→ global LSE via stable log-sum-exp
→ local output correction `O_r *= exp(LSE_r-LSE_global)`
→ ReduceScatter or AllReduce
→ global attention output for relevant heads
→ output projection / residual.

vLLM 2026-08 engineering report describes standard DCP rhythm as `AllGather Q → Compute → AllGather LSE/output + ReduceScatter`; MLA may optionally replicate the small query projection to remove Q all-gather. DCP reduces KV duplication for GQA/MLA long-context serving while trading extra communication.

來源：https://github.com/vllm-project/vllm-project.github.io/blob/main/_posts/2026-08-07-decode-context-parallelism.md

## Bottom-Level Logic

對 query q，把全域可見KV集合 D 分成 disjoint shards `D_1...D_R`。

每 rank：
`Z_r = Σ_{j∈D_r} exp(s_j)`
`LSE_r = log Z_r`
`O_r = Σ_{j∈D_r} [exp(s_j)/Z_r] V_j`

全域：
`Z = Σ_r Z_r`
`LSE = logsumexp(LSE_1...LSE_R)`
`α_r = exp(LSE_r-LSE)`
`O = Σ_r α_r O_r`

因此 local output本身已被 local denominator normalize；不能直接sum。`α_r`是把每個 local probability measure重新嵌回 global denominator的權重。

新增 witness：

`DCPPartitionWitness = H(globalRequiredDomain, dcpGroupGeneration, interleaveGeneration, rankLocalDomains)`

`PartitionCompletenessWitness = H(globalRequiredDomain, union(rankLocalDomains))`

`PartitionExclusivityWitness = H(rankLocalDomains, replicationPolicyGeneration)`

`RankLocalAttentionWitness = H(rankIdentity, localDomain, queryGeneration, localOutputGeneration, localLSEGeneration)`

`LSERepresentationWitness = H(attentionBackendGeneration, logBase, dtype, layout)`

`DistributedSoftmaxMergeWitness = H(localAttentionWitnesses, globalLSEGeneration, correctionFactors, collectiveGeneration, globalOutputGeneration)`

`GlobalAttentionOutputWitness = H(queryGeneration, globalRequiredDomain, DCPPartitionWitness, DistributedSoftmaxMergeWitness, outputGeneration)`

核心 invariant：
`union(rankLocalDomains) == GlobalRequiredAttentionDomain`
且在非replicated policy下：
`intersection(D_i,D_j)=∅ for i≠j`
且：
`DistributedMerge(O_r,LSE_r) ≈ SingleDeviceExactAttention(GlobalDomain)`。

## Visual Simulation Idea
### Distributed Attention Domain & Softmax Merge Microscope

畫面：
`Global token timeline | DCP rank ownership | local KV pages | local scores | local LSE | α_r | collective | merged output`

使用者點一個 Query，可看到：
`Q(pos=131072, layer=37, head=4)`
→ required global positions
→ token-by-token DCP owner（含 interleave）
→ Rank0..R local visible set
→ local max/LSE/output
→ global LSE
→ 每rank correction factor
→ ReduceScatter/AllReduce contribution
→ final output vector。

故障注入：
`DCP_TOKEN_OWNERSHIP_GAP`、`TOKEN_DOUBLE_COUNTED_ACROSS_RANKS`、`INTERLEAVE_CONFIG_STALE`、`EMPTY_SHARD_LSE_ZERO_INSTEAD_OF_NEG_INF`、`LSE_LOG_BASE_MISMATCH`、`LSE_RANK_ORDER_SWAPPED`、`LOCAL_SEQ_LEN_STALE_AFTER_SPEC_REJECTION`、`WRONG_DCP_GROUP`、`REDUCE_SCATTER_HEAD_SLICE_WRONG`、`Q_REPLICATION_GENERATION_STALE`。

## Code / GitHub
### vLLM
Repo: https://github.com/vllm-project/vllm

本輪實際追讀：
- `vllm/v1/attention/ops/dcp.py` — empty-shard mask、LSE all-gather、global LSE、rank output correction、ReduceScatter/AllReduce。
- `vllm/v1/attention/backend.py` — backend LSE log-base contract；錯誤設定可 silent corrupt cross-shard denominator。
- `vllm/v1/attention/backends/flash_attn.py` — DCP combine選擇。
- `vllm/v1/attention/backends/flashinfer.py` — FlashInfer DCP combine與base-2 LSE路徑。
- `vllm/v1/core/kv_cache_utils.py` — DCP effective block size與scheduler/hash granularity。
- `vllm/v1/worker/gpu/model_runner.py` — runtime dcp size/rank/interleave state。

值得下一步追：
- `dcp_a2a_lse_reduce` direct/symmetric-memory路徑；
- PCP+DCP unified context parallel RFC；
- multimodal prefix / sparse attention在distributed domain上的partition contract；
- DCP + speculative decoding的local sequence metadata修正。

## Papers

### Ring Attention with Blockwise Transformers for Near-Infinite Context
- Authors: Hao Liu, Matei Zaharia, Pieter Abbeel
- Institution: UC Berkeley
- Year: 2023/ICLR 2024
- URL: https://arxiv.org/abs/2310.01889
- Code: https://github.com/haoliuhl/ringattention
- Dataset/Workloads: language modeling、long-range retrieval、reinforcement learning
- Architecture: sequence blocks distributed across devices；KV blocks沿ring循環；blockwise exact attention；communication/compute overlap。
- Contribution: 讓context capacity近似隨device count線性擴張，而不把完整KV集中到單一裝置。
- Limitations: 論文重點偏training/長序列；現代paged-KV serving、spec decode、prefix caching、heterogeneous backend的provenance不是其原始問題設定。
- 改變了什麼: 將「長context attention」從單GPU memory optimization推進成distributed attention-domain execution問題。

### DISTFLASHATTN: Distributed Memory-efficient Attention for Long-context LLMs Training
- Authors: Dacheng Li, Rulin Shao, Anze Xie, Eric P. Xing, Xuezhe Ma, Ion Stoica, Joseph E. Gonzalez, Hao Zhang
- Institutions: CMU / UC Berkeley / related collaborators
- Year: 2023 preprint, 2024 revision
- URL: https://arxiv.org/abs/2310.03294
- Code: https://github.com/RulinShao/LightSeq
- Dataset/Workloads: Llama-7B variants, 32K–512K sequence lengths
- Architecture: sequence partition + distributed memory-efficient attention + KV communication overlap + rematerialization-aware checkpointing。
- Contribution: paper reports 8× longer sequences and 4.45–5.64× over Ring Self-Attention in evaluated settings, plus gains versus Megatron-LM/other sequence-parallel baselines。
- Limitations: training-centric；不直接等價於serving DCP implementation。
- 改變了什麼: 顯示distributed attention的核心不只memory capacity，還包括token-level load balance、communication overlap與checkpoint/recompute design。

### USP: A Unified Sequence Parallelism Approach for Long Context Generative AI
- Authors: Jiarui Fang, Shangchun Zhao
- Year: 2024
- URL: https://arxiv.org/abs/2405.07719
- Code: https://github.com/feifeibear/long-context-attention
- Architecture: unify Ulysses all-to-all與Ring Attention sequence parallel dimensions。
- Contribution: 將sequence parallel策略與network topology/model architecture共同考量；論文報告兩個8×A800 node上Llama3-8B、208K context達47% MFU。
- Limitations: 主要是training；serving DCP的paged KV、prefix/speculation semantics需另外建模。
- 改變了什麼: 說明distributed attention topology不是單一固定ring，而可依head/sequence/network條件組合。

## Unknown / Open Questions
1. `dcp_a2a_lse_reduce` direct/symmetric-memory path與AG+RS是否可建立portable semantic-equivalence witness，而非只做numerical regression？
2. DCP + speculative decoding下，rejection造成global sequence length回退時，如何以generation-safe方式原子更新每rank local sequence metadata、slot ownership與draft KV？
3. sparse attention、multimodal prefix、attention sinks進入DCP後，partition completeness不再是簡單token interval union；需要一般化為`DistributedAttentionDomainGraph`。

## 下一輪研究
優先鎖定新的缺口：
`GlobalAttentionOutputWitness → DCP + speculative decoding rollback → draft KV/local length/slot mapping reconciliation → committed global token → next-step distributed KV ownership`。

次線追蹤：
`DistributedAttentionDomainGraph → multimodal prefix / sparse attention → non-contiguous semantic visibility → cross-rank domain authorization`。

## Knowledge Graph 新增 Node / Edge

Nodes:
- `DCPGroupGeneration`
- `DCPInterleaveGeneration`
- `DCPTokenOwnershipGeneration`
- `DCPPartitionGeneration`
- `DCPPartitionWitness`
- `RankLocalAttentionDomainGeneration`
- `RankLocalDomainCardinalityWitness`
- `PartitionCompletenessWitness`
- `PartitionExclusivityWitness`
- `RankLocalAttentionOutputGeneration`
- `RankLocalLSEGeneration`
- `RankLocalAttentionWitness`
- `EmptyShardIdentityWitness`
- `LSERepresentationGeneration`
- `LSERepresentationWitness`
- `CrossRankLSEGatherGeneration`
- `GlobalLSEGeneration`
- `RankOutputCorrectionGeneration`
- `DistributedSoftmaxMergeGeneration`
- `DistributedSoftmaxMergeWitness`
- `GlobalAttentionOutputGeneration`
- `GlobalAttentionOutputWitness`
- `DistributedAttentionDomainGraph`

Edges:
- `GlobalRequiredAttentionDomain --partitioned_by→ DCPPartitionGeneration`
- `DCPInterleaveGeneration --assigns→ DCPTokenOwnershipGeneration`
- `DCPTokenOwnershipGeneration --materializes→ RankLocalAttentionDomainGeneration`
- `RankLocalAttentionDomainGeneration --must_union_to→ GlobalRequiredAttentionDomain`
- `RankLocalAttentionDomainGeneration --constrains→ RankLocalAttentionOutputGeneration`
- `RankLocalAttentionOutputGeneration --paired_with→ RankLocalLSEGeneration`
- `RankLocalLSEGeneration --represented_by→ LSERepresentationGeneration`
- `RankLocalLSEGeneration --all_gathered_into→ CrossRankLSEGatherGeneration`
- `CrossRankLSEGatherGeneration --logsumexp→ GlobalLSEGeneration`
- `GlobalLSEGeneration --rescales→ RankLocalAttentionOutputGeneration`
- `RankOutputCorrectionGeneration --reduced_by→ CollectiveOperationGeneration`
- `CollectiveOperationGeneration --produces→ GlobalAttentionOutputGeneration`
- `PartitionCompletenessWitness --attests→ DCPPartitionWitness`
- `PartitionExclusivityWitness --attests→ DCPPartitionWitness`
- `DistributedSoftmaxMergeWitness --attests→ GlobalAttentionOutputWitness`

## 本輪結束判斷
- **缺哪一層：** DCP + speculative decoding rejection/rollback後的 distributed KV ownership與local metadata reconciliation。
- **哪個節點最淺：** `DistributedAttentionDomainGraph`，dense DCP已可精確描述，但 sparse/mm-prefix/sink的跨rank visibility仍未統一。
- **哪個概念仍只是名詞：** 跨 AG+RS、A2A、ring、Ulysses backend portable 的 `DistributedSoftmaxMergeWitness` equivalence contract。
- **哪個系統值得讀原始碼：** vLLM `dcp.py`的A2A/direct symmetric-memory路徑 + speculative DCP RFC實作；之後對照 SGLang/USP。
- **哪篇論文需追引用：** Ring Attention → DistFlashAttn → USP，並追它們在inference/context-parallel serving的後續引用。
- **哪個概念最適合視覺模擬：** Distributed Attention Domain & Softmax Merge Microscope。
- **哪個 Agent 架構最值得實作：** `Event-sourced Agent Runtime + DistributedAttentionDomainWitness + GlobalAttentionOutputWitness + TokenCommitWitness + distributed KV rollback lineage`。

## 與歷史研究比較
上一輪已證明單GPU `Query → block table → K/V load → mask → online softmax → AttentionOutputWitness`；本輪新增的是跨rank exact-attention合併層，沒有重複前一輪。現在端到端鏈推進為：

`User → UI → Agent → Context → Prompt Compiler → Token/Embedding → Weights → Transformer/MoE → Distributed GPU → Kernel → KV Virtual Memory → Local Attention Domain → DCP Partition → Local O/LSE → Distributed Softmax Merge → Global Attention Output → Residual/Logits → Sampling/RNG/Speculation → Token Commit → Context Re-entry`。
