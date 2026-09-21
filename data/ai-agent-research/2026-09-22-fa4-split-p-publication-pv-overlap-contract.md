# 【AI Agent × Multimodal Research Report】

**時間：2026-09-22 05:55（Asia/Taipei）**

**本輪主題：FlashAttention-4 Split-P Publication × TMEM Store Visibility × PV Overlap Contract**

> Evidence policy：本報告區分【官方/原始碼確認】【論文結果】【工程推論】【尚未驗證假說】。本輪承接上一輪 completion→ordering→quiescence，但不再重複 tcgen05.ld / wait::ld / dealloc；改追 FlashAttention-4 真實 forward kernel 中 **QK accumulator → softmax → P 寫入 TMEM → P@V MMA** 的 publication protocol，尤其 partial-P overlap。

## 本小時新發現

1. 【原始碼確認】FlashAttention-4 SM100 forward 不是等整個 P tile 寫完才開始 P@V。`split_P_arrive` 預設取 `n_block_size * 3/4` 並對齊 32，softmax 可先發布 P 的前一部分，讓 MMA warp 提前啟動 P@V，再繼續產生剩餘 P。
2. 【原始碼確認】P 的 TMEM store publication 明確使用 `cute.arch.fence_view_async_tmem_store()`，然後才 signal pipeline。這表示「store 已 issue」與「可由 MMA consumer 安全觀察」不是同一事件。
3. 【原始碼確認】partial-P 與 last-split completion 使用兩條同步路徑：第一段透過 `pipeline_s_p_o.consumer_release_w_index(stage)`；最後一段在 fence 後 `sync_warp + elect_one + pipeline_p_lastsplit.producer_commit_w_index(stage)`。PV MMA 端可取得 last-split mbarrier pointer/phase。
4. 【原始碼確認】FA4 將 `pipeline_s_p_o` 明確描述為非典型 producer-consumer pipeline：MMA warp先 signal S ready；softmax/correction threads 寫 P / rescale O 後反向 signal；MMA warp再做 P@V。這是一個 cyclic ownership protocol，而非單向 queue。
5. 【論文結果】FlashAttention-4 的核心設計正是用 fully asynchronous MMA、larger tiles、software-emulated exponential、conditional rescaling、TMEM 與 2-CTA MMA 對抗 Blackwell asymmetric scaling；B200 BF16 報告最高 1613 TFLOP/s、71% theoretical utilization、最高 1.3× cuDNN 9.13、2.7× Triton。

## 本小時最重要 5 個發現

### 1. Partial-P publication 是正式 execution frontier

**概念**：`ProbabilityFragmentPublicationFrontier`

**底層**：
`QK MMA → S in TMEM → softmax load S → rowmax/exp → P fragment in RMEM → async TMEM store → fence_view_async_tmem_store → publication signal → PV MMA consumer`

【原始碼確認】FA4 `softmax_step()` 對 P fragment逐段 `cute.copy(... tStP_r2t ...)`；達到 split index 時先 fence，再 release `pipeline_s_p_o`。因此第一段 P 可以在整個 P tile 尚未完成前交給 PV consumer。

**為什麼重要**：Hermes 不能把 `PReady` 建成單一 boolean；至少要建成 fragment/range-aware frontier。

**限制**：目前是 source-level protocol reconstruction，尚未有 B200 runtime event trace。

### 2. TMEM store visibility 必須與 store issue 分離

【原始碼確認】P store後不是直接 signal，而是先 `fence_view_async_tmem_store()`。因此：

`TMEMStoreIssue --does_not_prove→ TMEMStorePublicationVisibility`

`PublicationSignalWithoutRequiredFence → potential stale/partial consumer view`

這與上一輪 `tcgen05.ld completion != cross-thread publication ordering` 對稱：讀與寫兩側都有 completion/visibility frontier。

### 3. Split-P 形成 two-frontier protocol

定義：

- `PPartialReadyFrontier(stage,generation,range=[0,split))`
- `PLastSplitReadyFrontier(stage,generation,range=[split,N))`
- `PFullReady = PartialReady ∧ LastSplitReady ∧ SameGeneration`

【原始碼確認】first publication 與 last-split 使用不同 pipeline/barrier路徑。故：

`FirstPFragmentReady --does_not_prove→ FullPTileReady`

`LastSplitSignal --requires→ EarlierFragmentGenerationMatch`

### 4. FA4 forward 是 cyclic ownership graph，不是線性 pipeline

【原始碼確認】`pipeline_s_p_o` 的註解直接描述：MMA warp發布 S；softmax threads寫P且correction threads rescale O；它們再以 consumer-side signal回覆 MMA warp，之後才執行 P@V。

可建模為：

`MMA(QK) → SReady → SoftmaxOwnsS → PPublication + ORescale → MMAOwnsP/V → MMA(PV) → OAccumulator → Correction → next generation`

這是 system-level state machine reasoning，不能只靠單一 mbarrier 名稱理解。

### 5. Overlap optimization 改變 correctness contract

【論文結果 + 原始碼確認】FA4 為吞吐刻意重疊 softmax 與 P@V；因此最佳化不是單純 scheduling hint，而會新增 range-level readiness、generation matching與多 barrier sequencing correctness requirements。

新增 failure family：

- `PV_READ_BEFORE_P_FRAGMENT_PUBLICATION`
- `P_PARTIAL_LASTSPLIT_GENERATION_MISMATCH`
- `P_PUBLICATION_SIGNAL_WITHOUT_TMEM_STORE_FENCE`
- `P_LASTSPLIT_SIGNAL_OMISSION`
- `P_FRAGMENT_RANGE_COVERAGE_GAP`
- `PV_CONSUMER_ADVANCE_BEFORE_REQUIRED_RANGE_READY`
- `CYCLIC_PIPELINE_PHASE_ALIAS`

## Architecture Breakdown — FlashAttention-4 SM100 Forward

【原始碼確認】核心檔案：`flash_attn/cute/flash_fwd_sm100.py`。

主要角色/資源：

- Load warps：Q/K/V 搬運。
- MMA warp：QK MMA、PV MMA、TMEM allocation/free。
- Softmax warps：從 QK accumulator/TMEM 讀 S，做 rowmax、exp、sum，將 P 寫回 TMEM。
- Correction warps：依 softmax statistics rescale O accumulator，並參與 P/O handoff。
- Epilogue warps：輸出路徑（依配置可由 correction warps兼任）。

主要 pipelines：

- `pipeline_q`: Q producer→MMA
- `pipeline_kv`: K/V producer→MMA
- `pipeline_s_p_o`: MMA S-ready → softmax/correction → P-ready/O-rescaled → MMA
- `pipeline_p_lastsplit`: softmax last P split → MMA
- `pipeline_o_acc`: MMA O-ready → correction
- `pipeline_sm_stats`: softmax stats → correction
- `pipeline_o_epi`: correction → epilogue

此架構顯示 Attention forward不是 `QK→Softmax→PV` 三個黑盒，而是多 warp-group、多 memory locale、多 phase/generation、多 publication frontier 的循環資料流。

## Bottom-Level Logic — P fragment publication

1. QK `tcgen05.mma` 產生 S accumulator（TMEM）。
2. MMA warp透過 `pipeline_s_p_o.producer_commit_w_index(stage)` 發布 S-ready。
3. softmax warp `consumer_wait` 等 S generation。
4. TMEM→RMEM 讀 S。
5. rowmax / masking / exp2 / row-sum 計算。
6. 產生 P register fragments。
7. `cute.copy` 將 P fragments async 寫回 TMEM。
8. 若到 `split_P_arrive`：
   - `fence_view_async_tmem_store()`
   - release `pipeline_s_p_o`，讓 MMA 可開始消費已發布 range。
9. 繼續寫剩餘 P fragments。
10. 再次 `fence_view_async_tmem_store()`。
11. `sync_warp()`；elected lane commit `pipeline_p_lastsplit`。
12. PV MMA 使用 P(TMEM) × V(SMEM)，其 last-split dependency可接收 mbarrier pointer/phase。
13. O accumulator進 correction / epilogue path。

新的 correctness predicate：

`PVRangeSafe(r,g) = PStoreIssued(r,g) ∧ PStoreVisibilityFence(r,g) ∧ PublicationSignalObserved(r,g) ∧ ConsumerStageGeneration==g ∧ RequiredRange(r)`

整個 P tile ready：

`PFullReady(g) = ∀r∈RequiredPFragments: PVRangeSafe(r,g)`

## Visual Simulation Idea

### P→V Overlap & Publication Frontier Microscope

四條時間軸：

1. QK MMA / S accumulator
2. Softmax + P fragment generation
3. TMEM P stores + visibility fences
4. PV MMA consumption

互動控制：stage、generation、split threshold、P fragment count、fence on/off、first/last signal on/off、consumer delay。

UI 將 P tile畫成 range segments：`UNWRITTEN → STORE_IN_FLIGHT → FENCED → PUBLISHED → CONSUMED`。當 PV consumer越過 publication frontier時直接標紅；若 partial與lastsplit generation不同則顯示 phase alias。

這比單純 Attention Viewer更接近「AI attention在GPU上如何真的流動」。

## Code / GitHub

### Dao-AILab/flash-attention

Repository: https://github.com/Dao-AILab/flash-attention

值得繼續讀：

- `flash_attn/cute/flash_fwd_sm100.py` — 本輪核心；SM100 forward、pipelines、QK/softmax/PV overlap。
- `flash_attn/cute/softmax.py` — SoftmaxSm100 rowmax / exp / rescale。
- `flash_attn/cute/pipeline.py` — custom PipelineTmaUmma / PipelineUmmaAsync phase semantics。
- `flash_attn/cute/blackwell_helpers.py` — tcgen05/PTX helpers、partial GEMM path。
- `flash_attn/cute/mma_sm100_desc.py` — MMA descriptor lowering。
- `flash_attn/cute/sm100_hd256_2cta_fmha_forward.py` — 2CTA specialized forward。

本輪不只讀 README；已追到 `FlashAttentionForwardSm100` pipeline creation、`mma()` 的 `gemm_Pi` partial path、`softmax_step()` 的 P TMEM store/fence/signal protocol。

### NVIDIA/cutlass

Repository: https://github.com/NVIDIA/cutlass

交叉驗證方向：Blackwell tcgen05/TMEM primitives、SM100 GEMM epilogue、PipelineUmmaAsync、TMEM copy/fence semantics。

## Papers

### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling

- **Authors**: Ted Zadouri, Markus Hoehnerbach, Jay Shah, Timmy Liu, Vijay Thakkar, Tri Dao
- **Institution**: authors' affiliations見論文原文
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2603.05451
- **Code**: https://github.com/Dao-AILab/flash-attention/tree/main/flash_attn/cute
- **Dataset**: 非 dataset-centric；以 attention kernel benchmark/workloads 評估
- **Architecture**: Blackwell/Hopper CuTeDSL FlashAttention pipeline；fully asynchronous MMA；TMEM；2-CTA；softmax/MMA overlap
- **Contribution**: 針對 tensor-core throughput成長快於shared-memory與exp units的 asymmetric scaling重新設計attention pipeline；B200 BF16最高1613 TFLOP/s、71% theoretical utilization。
- **Limitations**: 硬體/shape/dtype相關最佳化強；paper benchmark不能直接證明每個 production serving runtime 的同步事件。
- **改變了什麼**: attention optimization焦點由「只加速GEMM」移到跨 MMA、softmax、TMEM、CTA scheduling的協同設計。

## 與歷史研究比較

前輪已建立：

`MMA → accumulator full → tcgen05.ld → wait::ld → RMEM → before-thread-sync fence → CTA rendezvous → dealloc`

本輪新增的是另一條、且更貼近 Attention algorithm 中央的鏈：

`QK MMA → S(TM) → Softmax(RMEM) → P fragments → async TMEM store → visibility fence → partial publication → PV MMA overlap → lastsplit publication → O accumulator`

所以不是重複「TMEM同步」，而是把 **consumer-side load completion** 擴展到 **producer-side P publication**，並發現 partial range publication是 FA4 真實效能機制。

## Unknown / Open Questions

1. `fence_view_async_tmem_store()` 最終 lowering 到哪些 PTX/SASS ordering instructions？其 scope/proxy semantics如何精確對應 P fragment visibility？
2. `gemm_ptx_partial(... split_arrive=...)` 如何在 generated PTX 中把 P range consumption與 last-split mbarrier/phase綁定？PV是否可能在第一個 publication frontier後只消費已完成的columns？
3. B200 runtime如何直接觀察 `P fragment store → fence → publication signal → PV tcgen05.mma` 的 dynamic causal chain？Compute Sanitizer現有 callback是否足夠，或仍需 binary instrumentation？

## 下一輪研究

`flash_fwd_sm100.softmax_step → fence_view_async_tmem_store lowering → pipeline_s_p_o release → gemm_ptx_partial split_arrive → pipeline_p_lastsplit mbarrier → generated PTX/SASS → partial PV MMA issue sequence → range/generation mapping → runtime observability → P publication causal witness → O accumulator`

優先追 `blackwell_helpers.py` 與 custom `pipeline.py`，建立 source abstraction → PTX instruction → barrier/phase 的 exact mapping。

## Knowledge Graph 新增 Node / Edge

### Nodes

- `ProbabilityFragmentIdentity`
- `ProbabilityFragmentRange`
- `PStoreIssueWitness`
- `PStoreVisibilityFenceWitness`
- `PPartialReadyFrontier`
- `PLastSplitReadyFrontier`
- `PFullReadyWitness`
- `PVRangeConsumptionWitness`
- `SplitPGenerationIdentity`
- `CyclicAttentionPipelineIdentity`
- `SoftmaxToPVHandoffContract`
- `ProbabilityPublicationEvidenceLevel`

### Edges

- `QKAccumulator --consumed_by→ SoftmaxWarp`
- `SoftmaxWarp --produces→ ProbabilityFragment`
- `ProbabilityFragment --stored_into→ TMEM`
- `PStoreIssueWitness --ordered_by→ PStoreVisibilityFenceWitness`
- `PStoreVisibilityFenceWitness --precedes→ PPartialReadyFrontier`
- `PPartialReadyFrontier --enables→ PVRangeConsumption`
- `PLastSplitReadyFrontier --completes→ PFullReadyWitness`
- `PFullReadyWitness --belongs_to→ SplitPGenerationIdentity`
- `TMEMStoreIssue --does_not_prove→ TMEMStorePublicationVisibility`
- `FirstPFragmentReady --does_not_prove→ FullPTileReady`
- `PublicationSignal --requires→ MatchingStageGeneration`
- `PVRangeConsumption --requires→ PublishedProbabilityRange`
- `pipeline_s_p_o --forms→ CyclicAttentionPipelineIdentity`

## 本輪結束檢查

- **缺哪一層**：P async TMEM store / fence / partial signal 到 generated PTX/SASS 與 runtime PV consumption 的 exact join。
- **哪個節點最淺**：`PVRangeConsumptionWitness` 的 production runtime evidence。
- **哪個概念仍只是名詞**：request/layer/head scoped `ProbabilityFragmentRange` runtime attribution。
- **哪個系統值得讀原始碼**：FlashAttention-4 `blackwell_helpers.py` + `pipeline.py` + `flash_fwd_sm100.py` partial PV path。
- **哪篇論文需追引用**：FlashAttention-4（arXiv:2603.05451），尤其後續對 Blackwell softmax/PV overlap與production integration的引用。
- **哪個概念最適合視覺模擬**：P→V Overlap & Publication Frontier Microscope。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + Attention Pipeline Provenance Verifier + Fragment-Range Publication Verifier + TMEM Ordering Verifier + Barrier/Phase Trace Joiner + Launch Attribution Joiner + Causal Evidence Gate + Tool Executor`。

## 最終還原鏈更新

`User Request → UI → Agent → Context → Reasoning/Planning → Model Forward → Attention Layer → Q/K/V → QK tcgen05.mma → S in TMEM → Softmax warp → S TMEM→RMEM → rowmax/exp/sum → P fragments → P async TMEM store → TMEM store visibility fence → partial P publication → PV tcgen05.mma overlap → last-split publication → O accumulator → correction/normalization → epilogue → output tensor → residual/MLP → logits → sampling → token → Agent next decision/tool action`

本輪最大的推進：**Hermes 現在不再把 Softmax→P@V 視為一條粗粒度箭頭，而開始建模 P tile 在 TMEM 中如何分段生成、分段建立 visibility、分段發布給 PV MMA，並把這個 overlap 最佳化轉成可驗證的 range/generation correctness contract。**