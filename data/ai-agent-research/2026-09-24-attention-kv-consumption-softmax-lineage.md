# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 21:54 Asia/Taipei

## 本小時新發現
本輪承接上一輪 `KVReadWitness → Attention exact-consumption gap`，避免重複 KV allocation/prefix-cache，直接追到 **attention metadata → block table → physical K/V gather → QK score → mask/window/bias → online softmax → weighted V → AttentionOutputWitness**。

核心命題：

`CorrectKVPlacement ≠ CorrectAttentionDomain`

更精確：

`QueryGeneration → AttentionMetadataGeneration → BlockTableGeneration → RequiredLogicalKVSet → PhysicalKVGather → ScoreGeneration → Mask/BiasGeneration → OnlineSoftmaxState → WeightedVAccumulation → AttentionOutputGeneration`

即使 page/slot 都正確，只要 seq_len、block table、causal/window policy、scale、ALiBi/sink、FP8 scale 或 backend dispatch 任一 generation 錯綁，Query 仍可能讀到「合法存在但語意上不該可見」的 K/V。

## 本小時最重要 5 個發現

### 1. Attention correctness 的核心不是「KV存在」，而是 Query 實際可見的 KV domain
**已確認／原始碼。** current vLLM ROCm paged-attention Triton kernel由 `seq_lens`決定有效序列長度，逐 logical block透過 `block_tables`解析 physical block，再以 physical block + intra-block offset形成 K/V地址。最後 tile會額外 mask `abs_token_idx < seq_len`，避免 unwritten padding/garbage/NaN污染結果。

因此新增：
`RequiredAttentionDomainWitness = H(queryGeneration, seqLenGeneration, causalPolicy, slidingWindowPolicy, prefixPolicy, positionGeneration)`。

真正 invariant 是：
`GatheredLogicalKVSet == RequiredAttentionDomain`。

來源：https://github.com/vllm-project/vllm/blob/main/vllm/v1/attention/ops/chunked_prefill_paged_decode.py

### 2. block table 是 attention kernel 的 address translation program
**已確認／工程實作。** kernel 對每個 token位置計算 `logical_block_idx = abs_token_idx // PHYSICAL_BLOCK_SIZE`，再從 block table載入 `physical_block_id`，並用 `abs_token_idx % PHYSICAL_BLOCK_SIZE`決定 block內 offset。這證明上一輪的 KVPlacementGeneration 最終不是抽象 metadata，而是真正控制 GPU load address。

新增：
`AttentionAddressTranslationWitness = H(query, logicalTokenPosition, blockTableGeneration, physicalBlockGeneration, internalOffset, storageGeneration)`。

所以：
`CorrectBlockTableShape --does_not_prove→ CorrectBlockTableSemantics`。

### 3. attention score 不是只有 QKᵀ：scale、mask、window、ALiBi/sink 都是 semantic state
**已確認／原始碼。** current kernel先做 `qk = scale * dot(Q,K)`，再以 sequence boundary mask無效位置；若 sliding window啟用，再限制可見範圍；若 ALiBi啟用，還會依相對位置加入 head-specific bias。backend interface也顯式傳入 `causal`、`sliding_window`、`sm_scale`、`alibi_slopes`、`sinks`。

因此：
`SameQ + SameK --does_not_prove→ SameAttentionScores`。

新增 `AttentionSemanticsGeneration = H(scale, causal, window, position/bias, sink, backend)`。

來源：https://github.com/vllm-project/vllm/blob/main/vllm/v1/attention/backends/rocm_attn.py

### 4. FlashAttention 的關鍵是 exact attention 的 IO-aware execution，不是近似 attention
**論文結果。** Dao et al. 2022 將 Q/K/V tiled到 on-chip SRAM，以 online softmax維持逐 tile running max/normalizer，避免 materialize完整 N×N attention matrix；論文強調 canonical FlashAttention為 exact attention，主要收益來自降低 HBM↔SRAM IO。FlashAttention-2則重新安排 thread-block/warp work partition，降低 non-matmul FLOPs與 shared-memory traffic，論文報告相較 FlashAttention約2×，A100達理論峰值50–73%。

這與 current vLLM Triton paged decode kernel的 `M/L/acc` running state直接對應：每 tile更新 running max M、normalizer L與 weighted-V accumulator，而非先產生完整 probability matrix。

來源：https://arxiv.org/abs/2205.14135 ; https://arxiv.org/abs/2307.08691

### 5. backend selection 本身已是 attention semantics/provenance的一部分
**已確認／官方設計與原始碼。** current vLLM會依 GPU architecture、dtype、KV dtype、block/head size與 feature需求，在 FlashAttention、FlashInfer、Triton、ROCm等 backend間選擇；部分配置會透明 fallback。例如 Blackwell特定 FA4 head-size路徑不支援某些 soft-capping/sink/mm-prefix/window功能時會退回其他 kernel。ROCm path也會因 non-standard block size或 hybrid stride layout改走 Triton，以避免 native writer/reader layout不相容。

所以：
`SameAttentionSemanticsRequested --does_not_prove→ SameAttentionBackendExecuted`。

Hermes需要：
`AttentionBackendDispatchWitness = H(requestedSemantics, hardwareGeneration, KVLayoutGeneration, candidateBackends, selectedBackend, fallbackReason, kernelGeneration)`。

來源：https://github.com/vllm-project/vllm/blob/main/docs/design/attention_backends.md

## Architecture Breakdown

### vLLM paged decode attention
`Query tensor`
→ AttentionMetadata (`query_start_loc`, `seq_lens`, `block_table`, causal/window)
→ backend dispatch
→ Q head ↔ KV head mapping (MHA/MQA/GQA)
→ logical token positions
→ block-table lookup
→ physical KV page + internal offset
→ K/V load (+ FP8 dequant scales if needed)
→ `scale × QK`
→ sequence/causal/window/bias semantics
→ tile max
→ exponentiation
→ tile normalizer
→ online softmax merge (`M`,`L`)
→ weighted V accumulation
→ normalize accumulator
→ optional output quantization
→ AttentionOutputGeneration
→ output projection/residual.

### Bottom-level online softmax state
For tile j:
`S_j = scale·QK_j + mask/bias`
`m_j = max(M_{j-1}, max(S_j))`
`p_j = exp(S_j - m_j)`
`alpha = exp(M_{j-1} - m_j)`
`L_j = alpha·L_{j-1} + sum(p_j)`
`Acc_j = alpha·Acc_{j-1} + p_j·V_j`
`O = Acc_final / L_final`

這是「exact math / tiled execution」的關鍵橋樑；Hermes應區分 logical attention equation與 physical tiled execution generation。

## Bottom-Level Logic

新增 witness：

`AttentionMetadataWitness = H(requestGeneration, layerGeneration, queryStartLoc, seqLens, blockTableGeneration, slotMappingGeneration, causalPolicy, windowPolicy)`

`RequiredAttentionDomainWitness = H(queryTokenGeneration, queryPosition, requiredLogicalKVSet, maskPolicyGeneration)`

`AttentionAddressTranslationWitness = H(logicalKVToken, blockTableGeneration, physicalBlockGeneration, intraBlockOffset, storageGeneration)`

`AttentionKVLoadWitness = H(addressTranslationSet, kvDtype, kScaleGeneration, vScaleGeneration, loadedKVGenerationSet)`

`AttentionScoreWitness = H(queryGeneration, loadedKSet, scaleGeneration, scoreKernelGeneration)`

`AttentionMaskWitness = H(scoreGeneration, seqBoundary, causalGeneration, slidingWindowGeneration, biasGeneration, visibleKVSet)`

`OnlineSoftmaxWitness = H(maskedScoreGeneration, tilePartitionGeneration, runningMaxGeneration, runningNormalizerGeneration, reductionPolicyGeneration)`

`AttentionOutputWitness = H(queryGeneration, visibleKVSet, onlineSoftmaxGeneration, loadedVSet, accumulatorGeneration, outputGeneration)`

核心 invariant：
`AttentionOutputWitness.visibleKVSet == RequiredAttentionDomainWitness.requiredLogicalKVSet`。

## Visual Simulation Idea
### Attention Domain → Paged KV → Online Softmax Microscope

畫面同步呈現：
`Query token | absolute position | required KV domain | logical KV timeline | block table | physical pages | QK tiles | mask/window | running M/L | softmax mass | V contribution | output vector`

點一個 Query，可反查：
`Q(pos=8192, layer=23, head=7)`
→ `required positions 4097..8192`
→ logical blocks
→ physical blocks `[81,4,112,...]`
→ loaded K/V generations
→ 每 tile score range
→ 被 mask token
→ online-softmax running max/denominator
→ 各 V tile contribution
→ final head output。

故障注入：
`STALE_BLOCK_TABLE`、`SEQ_LEN_OFF_BY_ONE`、`WRONG_PHYSICAL_BLOCK`、`WINDOW_POLICY_CHANGED`、`CAUSAL_FLAG_DROPPED`、`ALIBI_SLOPE_WRONG_HEAD`、`FP8_K_SCALE_STALE`、`PADDING_NAN_LOADED`、`BACKEND_FALLBACK_SEMANTICS_MISMATCH`、`ONLINE_SOFTMAX_TILE_STATE_CORRUPTED`。

## Code / GitHub
### vLLM
Repo: https://github.com/vllm-project/vllm

本輪實際追讀：
- `vllm/v1/attention/ops/chunked_prefill_paged_decode.py` — physical block translation、K/V loads、QK、mask、sliding window、ALiBi、online softmax、V accumulation。
- `vllm/v1/attention/backends/rocm_attn.py` — metadata如何把 block table/seq lens/scale/window/causal傳入 kernel；KV update在 native與Triton writer間切換。
- `docs/design/attention_backends.md` — backend compatibility/priority/fallback。
- `vllm/v1/attention/backend.py` — backend capability contract、block-size compatibility與KV layout customization。

值得下一步追：
- FlashAttention backend exact metadata conversion；
- FlashInfer paged decode wrapper；
- attention layer output projection/residual binding；
- DCP/context-parallel attention的 KV domain partition/reduction。

## Papers

### FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness
- Authors: Tri Dao, Daniel Y. Fu, Stefano Ermon, Atri Rudra, Christopher Ré
- Institution: Stanford University / University at Buffalo collaborators
- Year: 2022, NeurIPS
- URL: https://arxiv.org/abs/2205.14135
- Code: https://github.com/Dao-AILab/flash-attention
- Dataset/Workloads: BERT-large, GPT-2, Long Range Arena等
- Architecture: tiled Q/K/V + SRAM reuse + online softmax + recomputation
- Contribution: exact attention的IO-aware重構，避免完整attention matrix HBM materialization。
- Limitations: kernel support受head dimension/hardware/dtype等條件影響；後續版本持續改進parallelism與新GPU特性。
- 改變了什麼: 將 attention optimization焦點從FLOPs轉到GPU memory hierarchy與IO complexity。

### FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning
- Author: Tri Dao
- Year: 2023
- URL: https://arxiv.org/abs/2307.08691
- Code: https://github.com/Dao-AILab/flash-attention
- Architecture: exact tiled attention + sequence-dimension parallelism + improved warp partition
- Contribution: 減少non-matmul FLOPs、提高occupancy、降低warp間shared-memory traffic；論文報告約2× FlashAttention。
- Limitations: numerical execution仍依GPU/kernel/dtype；「exact」指attention algorithm非近似，不等於跨backend bitwise identical。
- 改變了什麼: 證明相同attention數學可透過更好的GPU work partition得到大幅效能差異。

## Unknown / Open Questions
1. FlashAttention/FlashInfer/Triton/ROCm多backend下，如何定義跨backend portable `AttentionOutputWitness`：semantic-equivalent、numerically-close、bitwise-identical要分三級。
2. Decode Context Parallelism或context-parallel attention把 KV domain切到多rank時，`RequiredAttentionDomain`如何證明所有partition被完整且只聚合一次？
3. multimodal prefix/full-attention、attention sinks、sparse attention與hybrid linear-attention會使「可見KV集合」不再只是簡單causal interval，Knowledge Graph需升級為一般 `AttentionDomainGraph`。

## 下一輪研究
鎖定：
`AttentionOutputWitness → output projection → residual add → layer-to-layer state → final RMSNorm → LM head/logits` 的閉環驗證，並補 `Decode Context Parallelism / attention-domain partition`。

但為避免與先前 compiled-kernel/logits輪重複，下一輪優先深入新的缺口：
`AttentionDomainGraph → Context/Decode Parallel partition → per-rank Q/KV domain → partial softmax statistics → distributed merge → exact global AttentionOutputWitness`。

## Knowledge Graph 新增 Node / Edge

Nodes:
- `AttentionMetadataGeneration`
- `AttentionMetadataWitness`
- `AttentionSemanticsGeneration`
- `RequiredAttentionDomainGeneration`
- `RequiredAttentionDomainWitness`
- `AttentionBackendDispatchGeneration`
- `AttentionBackendDispatchWitness`
- `AttentionAddressTranslationGeneration`
- `AttentionAddressTranslationWitness`
- `AttentionKVLoadGeneration`
- `AttentionKVLoadWitness`
- `AttentionScoreGeneration`
- `AttentionScoreWitness`
- `AttentionMaskGeneration`
- `AttentionMaskWitness`
- `OnlineSoftmaxGeneration`
- `OnlineSoftmaxWitness`
- `AttentionAccumulatorGeneration`
- `AttentionOutputGeneration`
- `AttentionOutputWitness`
- `AttentionDomainGraph`

Edges:
- `KVReadWitness --materializes_into→ AttentionMetadataWitness`
- `RequiredAttentionDomainWitness --constrains→ AttentionKVLoadGeneration`
- `BlockTableGeneration --translates→ LogicalKVTokenIdentity_to_PhysicalKVSlot`
- `AttentionAddressTranslationWitness --loads→ KVProjectionGeneration`
- `QueryGeneration --scores_against→ AttentionKVLoadGeneration`
- `AttentionScoreGeneration --masked_by→ AttentionMaskGeneration`
- `AttentionMaskGeneration --defines→ VisibleKVSet`
- `VisibleKVSet --normalized_by→ OnlineSoftmaxGeneration`
- `OnlineSoftmaxGeneration --weights→ ValueGenerationSet`
- `ValueGenerationSet --accumulates_into→ AttentionOutputGeneration`
- `AttentionBackendDispatchGeneration --selects_execution_of→ AttentionSemanticsGeneration`
- `AttentionOutputWitness --feeds→ OutputProjectionGeneration`

## 本輪結束判斷
- **缺哪一層：** context/decode-parallel attention的 distributed softmax/domain merge。
- **哪個節點最淺：** `AttentionDomainGraph`，目前 dense causal/window已清楚，但 sparse/mm-prefix/sink/hybrid semantics尚未統一。
- **哪個概念仍只是名詞：** portable、跨backend的 `AttentionOutputWitness` equivalence contract。
- **哪個系統值得讀原始碼：** vLLM FlashAttention/FlashInfer backend + Decode Context Parallel；對照 SGLang attention backend。
- **哪篇論文需追引用：** FlashAttention → FlashAttention-2 → FlashAttention-3，以及 distributed/context-parallel attention相關工作。
- **哪個概念最適合視覺模擬：** `Attention Domain → Paged KV → Online Softmax Microscope`。
- **哪個 Agent 架構最值得實作：** `Event-sourced Agent Runtime + TokenCommitWitness + KVPlacementWitness + RequiredAttentionDomainWitness + AttentionOutputWitness + end-to-end ModelInvocation lineage`。

## 事實層級
- **已確認事實／官方或原始碼：** vLLM block-table physical translation、seq_len/padding mask、sliding-window/ALiBi、online softmax state、backend selection/fallback。
- **論文結果：** FlashAttention/FlashAttention-2的IO-aware exact attention與效能數據。
- **工程設計提案：** Hermes witness schema與Knowledge Graph nodes/edges。
- **合理推論：** attention provenance必須把 logical visible-domain與physical loads逐一對應，否則 page correctness不足以證明semantic correctness。
- **尚未驗證假說：** 低overhead production witness能否在多backend、多rank環境中逐token記錄完整visible-domain而不造成不可接受overhead。