# 【AI Agent × Multimodal Research Report】

**時間：2026-09-22 09:51（Asia/Taipei）**  
**主題：FlashAttention-4 Split-KV × LSE Merge × Final Output Generation Contract**

## 本小時新發現

本輪延續上一輪 `FinalNormalization → OutputPublication → ResidualConsumption`，但不重複單一 CTA / 單一 attention pass 的 final O 路徑，而是處理一個上一輪尚未封閉的系統架構缺口：**Split-KV 時，任何單一 split 的 O 即使已完成 final normalization 與 GMEM publication，也仍不是模型可消費的 final Attention output。**

current FA4 forward-only source明確包含 `flash_fwd_combine.py`；其 combine kernel輸入 `O_partial` 與 `LSE_partial`，先跨 split 計算 LSE max / exp scale / normalized split weights，再以這些 weights 對各 split 的 O_partial 做 FP32 accumulation，最後 cast 成 output dtype 並寫入 final O。這使 Hermes 必須新增一層 `SplitKVCombineGeneration`，位於 partial-output publication 與 residual consumption之間。

官方/論文架構背景方面，FlashAttention-4（Zadouri et al., 2026）針對 Blackwell 的非對稱硬體 scaling，以 fully asynchronous MMA、TMEM、larger tiles、software-emulated exponential、conditional rescaling與2-CTA MMA重設pipeline；而 current vLLM FA4 backend已存在 split-count specialization，且對 split-KV combine做額外 compile path。這表示 split-KV merge不是抽象演算法附註，而是 production serving path中的獨立 kernel / generation boundary。

## 本小時最重要 5 個發現

### 1. Partial O publication 不等於 final Attention publication
**概念：** `SplitKVPartialOutputIdentity` 與 `SplitKVCombineGeneration`。  
**底層：** 每個 KV split各自產生 `(O_partial_s, LSE_partial_s)`；combine kernel必須讀齊對應 generation，重建全域 normalization weights，再形成 final O。  
**重要性：** 上一輪的 `AttentionOutputPublicationWitness` 若落在 split producer，只能證明 partial output已發布，不能直接連到 residual stream。  
**限制：** 尚未取得 production runtime split-id / combine-generation trace。  
**證據等級：** current source confirmed + serving integration cross-check。

新增否定 edge：

`SplitPartialOPublished --does_not_prove→ FinalAttentionOPublished`

### 2. Split-KV combine 是 log-sum-exp measure merge，不是 naive average
對每個 query row，combine source先求：

`M = max_s LSE_s`

再計算：

`w_s_raw = exp(LSE_s - M)`

`Z = Σ_s w_s_raw`

`w_s = w_s_raw / Z`

最後：

`O_final = Σ_s w_s · O_partial_s`

並輸出：

`LSE_final = log(Z) + M`

因此 split combine的 correctness依賴 **O_partial 與 LSE_partial 必須屬於同一 split、同一 query/head、同一 numerical generation**。不能只靠相同 destination address或相同 batch index推定配對。

新增：

`SplitKVMeasureIdentity = {request, layer, head, q_tile, split_id, kv_range, partial_o_generation, partial_lse_generation}`

### 3. O_partial / LSE_partial generation mismatch 會形成 silent semantic corruption
若：

`O_partial(s,g1)` 配到 `LSE_partial(s,g2)`

即使兩者 shape、dtype、address range都合法，combine仍會用錯誤的 normalization weight縮放 O。這類錯誤不一定被 memory sanitizer捕捉，因為它是 semantic-generation mismatch，而非 OOB。

新增 failure：

`SPLITKV_O_LSE_GENERATION_MISMATCH`

以及 invariant：

`PartialMeasureConsistency = SameRequest ∧ SameLayer ∧ SameHead ∧ SameQTile ∧ SameSplit ∧ SameKVRange ∧ SameNumericalGeneration`

### 4. Invalid / empty split 有顯式 identity，不能被當成普通零向量
current combine source以 `-inf` 表示無效 LSE split，先尋找每 row 的 `max_valid_split`，並對 all-`-inf` case做保護；只有有效 split 才對 O accumulation產生正權重。這表示 empty split的語義是 **zero probability mass**，不是「一個 O=0、LSE=0 的普通 split」。

新增：

`SplitValidityIdentity = VALID | EMPTY_NEG_INF | MASKED | OUT_OF_RANGE`

新增否定 edge：

`ZeroPartialO --does_not_imply→ EmptyProbabilityMass`

### 5. Final O 的 generation boundary 位於 combine store，而不是 producer store
combine source最後先在 register中以 FP32累積 scaled O partial，再 cast成 output dtype並寫 final GMEM O。故對 Split-KV path：

`ResidualConsumableGeneration = CombineOutputGeneration`

而不是任何：

`PartialProducerOutputGeneration`

這使上一輪的 output-publication contract需要分岔：

`Dense/SingleSplit → DirectOutputPublication`

`SplitKV → PartialPublication → LSE/O Merge → CombineOutputPublication`

## Architecture Breakdown

本輪 system architecture：**FA4 Split-KV forward + combine kernel**。

```text
Q + KV cache
  → split KV ranges {R0...Rn}
  → Attention split 0 → O_partial_0 + LSE_partial_0
  → Attention split 1 → O_partial_1 + LSE_partial_1
  → ...
  → Attention split n → O_partial_n + LSE_partial_n
  → partial GMEM publication frontier
  → combine kernel
      → load LSE_partial[*]
      → lse_max = max(LSE_s)
      → exp(LSE_s - lse_max)
      → sum-exp across splits
      → normalized split weights
      → load O_partial[*]
      → FP32 weighted accumulation
      → output dtype cast
      → final O GMEM store
      → final LSE store (optional)
  → residual stream
  → next sublayer
  → logits
  → token
  → Agent action
```

與歷史研究的差異：前幾輪把 `P numerical generation → PV → O correction → final normalization → output publication` 封閉到單一 attention execution；本輪新增 **跨 kernel、跨 split 的 second-level normalization frontier**。

## Bottom-Level Logic

### Split merge state machine

```text
SPLITS_DISPATCHED(g)
 → PARTIAL_O_LSE_IN_FLIGHT(g,s)
 → PARTIAL_O_LSE_PUBLISHED(g,s)
 → ALL_REQUIRED_SPLITS_READY(g)
 → LSE_MAX_READY(g)
 → SPLIT_WEIGHT_SUM_READY(g)
 → NORMALIZED_SPLIT_WEIGHTS_READY(g)
 → PARTIAL_O_ACCUMULATING(g)
 → COMBINE_FP32_O_READY(g)
 → OUTPUT_CAST(g)
 → COMBINE_OUTPUT_STORE(g)
 → FINAL_O_PUBLISHED(g)
 → RESIDUAL_CONSUMABLE(g)
```

### Correctness invariant

```text
FinalSplitKVAttentionCorrect =
  AllRequiredSplitsPresent
  ∧ EveryPartialMeasureConsistent
  ∧ EmptySplitSemanticsCorrect
  ∧ StableLSEMergeCorrect
  ∧ WeightedOAccumulationCorrect
  ∧ CombineGenerationMatchesRequest
  ∧ FinalOutputPublicationComplete
```

### Evidence separation

```text
MemorySafetyWitness
  != PartialGenerationConsistencyWitness
  != LSEMergeNumericalWitness
  != CombineOutputPublicationWitness
  != ResidualConsumptionWitness
```

## Visual Simulation Idea

### Split-KV LSE Merge & Output Generation Microscope

UI 左側顯示 KV sequence 被切成 split 0...N；每個 split有獨立：

`KV range → local score → local softmax → O_partial → LSE_partial → publish`

中央顯示 LSE merge：

`LSE_s → global max → exp offset → sum → normalized w_s`

右側顯示：

`w_s × O_partial_s → FP32 Σ → cast → final O → residual`

可注入：

- `SPLITKV_O_LSE_GENERATION_MISMATCH`
- `SPLITKV_MISSING_PARTIAL`
- `SPLITKV_DUPLICATE_SPLIT_GENERATION`
- `SPLITKV_EMPTY_SPLIT_LSE_CORRUPTION`
- `SPLITKV_WRONG_KV_RANGE_IDENTITY`
- `SPLITKV_COMBINE_BEFORE_ALL_REQUIRED_SPLITS_READY`
- `SPLITKV_FINAL_OUTPUT_STALE_GENERATION`

視覺上要讓使用者看到：**每個 partial O單獨看都可能是合法數值，但只要 LSE weight或generation配錯，final O仍會被靜默污染。**

## Code / GitHub

### vllm-project/tml-fa4
值得繼續讀：

- `flash_attn/cute/flash_fwd_combine.py`：Split-KV LSE/O combine核心；已確認 LSE max、exp scaling、normalized split weights、FP32 O accumulation與final store。
- `flash_attn/cute/flash_fwd.py`：forward dispatch與split selection入口。
- `flash_attn/cute/flash_fwd_sm100.py`：Blackwell split producer、partial O/LSE generation來源。
- `flash_attn/cute/tile_scheduler.py`：dynamic/persistent split work identity。
- `flash_attn/cute/interface.py`：runtime compile / dispatch boundary。

### vLLM integration
current vLLM FA4 backend存在 `num_splits` specialization與split combine compile path，顯示 production serving必須把 producer kernel與combine kernel視為同一 request-level attention transaction，而非兩個無關 launches。

## Papers

### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling
- **Authors:** Ted Zadouri, Markus Hoehnerbach, Jay Shah, Timmy Liu, Vijay Thakkar, Tri Dao
- **Institutions:** Princeton University, Meta, Colfax Research, NVIDIA, Georgia Tech, Together AI
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2603.05451
- **Code:** https://github.com/Dao-AILab/flash-attention
- **Architecture:** Blackwell-optimized FlashAttention with fully asynchronous MMA, TMEM, larger tiles, conditional rescaling, software exponential, 2-CTA MMA
- **Contribution:** rebalances attention pipeline for Blackwell asymmetric scaling; reports up to 1613 TFLOP/s BF16 and 71% utilization on B200.
- **Limitations for this round:** paper-level architecture does not itself provide request-scoped runtime provenance for each split/combine generation.

### FlashPrefill V2: Block-Sparse Prefill Attention for Long-Context LLM Serving
- **Authors:** Qihang Fan et al.
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2608.19758
- **Architecture relevance:** production long-context prefill, paged KV, continuous batching, FA3/4-aligned operator design.
- **Why it matters:** independent evidence that long-context production attention increasingly composes sparse/split scheduling, paged KV identity and low-precision kernels; Hermes的 provenance graph不能停在單 kernel。
- **Limitation:** sparse approximation與本輪 exact split-KV merge不是同一演算法，不應混為直接 correctness證據。

## Unknown / Open Questions 1-3

1. FA4 split producer對 `O_partial` 與 `LSE_partial` 的 exact generation / semaphore publication順序，如何在 compiled PTX/SASS與runtime launch trace中建立可驗證 join？
2. dynamic `num_splits`、persistent scheduler與continuous batching同時存在時，哪個 runtime identity足以防止 request / batch-slot / split generation alias？
3. combine output store完成後，framework層如何把該 exact generation交給 residual/add-norm consumer；CUDA stream order、graph capture、scheduler reuse之間還缺哪個 publication witness？

## 下一輪研究

鎖定：

`split scheduler → KV range identity → producer partial O/LSE → producer publication → combine launch dependency → LSE merge → weighted O accumulation → final GMEM O → framework tensor identity → residual/add-norm consumer → ΔResidual → ΔLogitMargin → ΔToken`

優先讀：

`flash_fwd.py → flash_fwd_sm100.py split path → tile_scheduler.py → flash_fwd_combine.py → vLLM FA4 backend dispatch → residual/add-norm callsite`

下一輪的核心不是再研究 softmax公式，而是補上 **跨 kernel generation lineage**。

## Knowledge Graph 新增 Node / Edge

### Nodes

- `SplitKVTransactionIdentity`
- `SplitKVRangeIdentity`
- `SplitKVPartialOutputIdentity`
- `SplitKVPartialLSEIdentity`
- `SplitKVMeasureIdentity`
- `SplitValidityIdentity`
- `AllRequiredSplitsReadyWitness`
- `SplitLSEMergeGeneration`
- `NormalizedSplitWeightIdentity`
- `SplitKVCombineGeneration`
- `CombineFP32AccumulatorWitness`
- `CombineOutputPublicationWitness`
- `ResidualConsumableAttentionGeneration`

### Edges

```text
SplitKVRangeIdentity
  --produces→ SplitKVPartialOutputIdentity

SplitKVRangeIdentity
  --produces→ SplitKVPartialLSEIdentity

SplitKVPartialLSEIdentity
  --normalizes_weight_for→ SplitKVPartialOutputIdentity

AllRequiredSplitsReadyWitness
  --enables→ SplitLSEMergeGeneration

SplitLSEMergeGeneration
  --produces→ NormalizedSplitWeightIdentity

NormalizedSplitWeightIdentity
  --weights→ SplitKVPartialOutputIdentity

SplitKVPartialOutputIdentity
  --combined_by→ SplitKVCombineGeneration

SplitKVCombineGeneration
  --publishes→ CombineOutputPublicationWitness

CombineOutputPublicationWitness
  --enables→ ResidualConsumableAttentionGeneration

SplitPartialOPublished
  --does_not_prove→ FinalAttentionOPublished

SameShapeAndAddress
  --does_not_prove→ SameSplitKVMeasureIdentity

MemorySafetyWitness
  --does_not_prove→ SplitGenerationConsistency
```

## 本輪結束判定

**缺哪一層：** split producer publication → combine consumer 的 request-scoped runtime generation join。  
**哪個節點最淺：** `AllRequiredSplitsReadyWitness` 的 production runtime attribution。  
**哪個概念仍只是名詞：** `ResidualConsumableAttentionGeneration` 的跨 kernel / framework witness。  
**哪個系統值得讀原始碼：** FA4 `flash_fwd_combine.py` + `tile_scheduler.py` + vLLM FA4 backend。  
**哪篇論文需追引用：** FlashAttention-4；並追 production Split-KV / paged-KV serving研究。  
**哪個概念最適合視覺模擬：** Split-KV LSE Merge & Output Generation Microscope。  
**哪個 Agent 架構最值得實作：** `State-grounded Planner + Cross-Kernel Generation Tracker + SplitKV Measure-Consistency Verifier + Scheduler Identity Verifier + Output-Publication Trace Joiner + Residual Consumer Joiner + Causal Evidence Gate + Tool Executor`。

## 本輪最大推進

Hermes 現在不再把「Attention output已寫到GMEM」視為單一終點。對 Split-KV path，真正的模型輸出必須跨過第二層數學與執行 frontier：**多個 KV split各自發布 partial O/LSE → 以 log-sum-exp重建全域 probability measure → 用同一 generation 的權重合併 partial O → final combine output publication → residual consumption。** 下一輪將把這個 second-level normalization frontier與 framework residual tensor identity接起來。