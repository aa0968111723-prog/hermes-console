# 【AI Agent × Multimodal Research Report】

時間：2026-09-21 15:53（Asia/Taipei）

主題：Physical KV Read Instrumentation × Load-Mask Semantics × Causal KV Probe

## 本小時新發現

本輪承接上一輪 `Kernel Pointer Arithmetic → ExpectedElementLoadFootprint`，不再重複 page-table/address derivation，而是集中回答：如何把 expected address model 升級成 runtime evidence，並避免把「被載入」誤判成「對 attention 有語義貢獻」。

### 新架構：Three-Level Physical Read Evidence

Hermes 應永久區分三層：

1. `StaticExpectedReadSet`：由 block table、layout、stride、head、token、feature 推導。
2. `InstrumentedExecutedReadSet`：由 kernel instrumentation / sanitizer / binary instrumentation 收集實際執行 load address。
3. `CausalContributionSet`：對選定 KV 做 ZERO/REPLACE 後，觀察 attention/residual/logit/token/action 的差分。

因此：

`StaticExpectedReadSet != InstrumentedExecutedReadSet != CausalContributionSet`

## 本小時最重要 5 個發現

### 1. vLLM current Triton paged decode 已把「最後一 tile 的未寫入 KV」在 load 階段排除

已確認工程實作：current `chunked_prefill_paged_decode.py` 中，kernel 先由 `abs_token_idx → l_block_idx → p_block_idx → internal_offsets` 建立 K/V offset；對最後一 tile 額外建立 `kv_load_mask = abs_token_idx < seq_len`，並把它直接放進 K/V `tl.load` mask。這代表上一輪較泛化的「kernel 可能先 over-read 再 semantic mask」不能套用到所有 backend；vLLM 此 Triton path 已刻意避免最後一 tile 讀到 unwritten NaN/garbage。

底層：
`seq_len → num_blocks → final tile → kv_load_mask → tl.load(K/V, mask=...) → qk → seq_mask → softmax`

重要性：physical read footprint 本身受 backend implementation 影響；不能只從 semantic attention window反推實際 memory load。

限制：sliding-window mask仍在 QK 計算後套用，因此 window外、但仍位於有效 `seq_len` 的 K/V 可以先被 load，之後才被 score mask。

### 2. 「load mask」與「semantic score mask」是兩個不同 gate

已確認工程實作：vLLM current Triton path先用 `kv_load_mask` 防止最後 tile超出 `seq_len` 的 K/V load；之後又建立 `seq_mask`，再對 sliding window做 score-level masking。

因此新增：
`PhysicalLoadEligibilityGate` 與 `SemanticContributionEligibilityGate`。

否定 edge：
`PhysicalElementLoaded --does_not_imply→ SemanticContribution`

### 3. FlashInfer CuTe paged path形成相反的重要對照：TMA paged kernel要求 referenced page 的尾部也保持 finite

官方 FlashInfer CuTe DSL文件指出 paged KV `paged_kv_indices` 指向的 page 必須在 `last_page_len` 之後仍為 finite，因為 TMA-based paged kernel會 over-read full pages，再依 masking排除。這與 vLLM Triton final-tile masked load形成 backend-level差異。

因此新增 `BackendPhysicalReadPolicy`：
- `PREDICATED_ELEMENT_LOAD`
- `FULL_PAGE_OR_TILE_LOAD_THEN_MASK`
- `UNKNOWN`

重要性：同一 SemanticKVReadSet 在不同 backend可能產生不同 physical traffic、NaN safety requirement與 instrumentation結果。

### 4. NVIDIA Compute Sanitizer適合建立 allocation/range correctness witness，但不能直接當成完整 access trace

官方 Compute Sanitizer memcheck可精確偵測 global/local/shared 的 out-of-bounds與misaligned access；NVTX Memory API還能標記 memory pool、label allocation、設定 read/write permission與有效範圍。這非常適合把 KV pool/page generation註冊成 runtime contract，驗證 kernel是否讀出合法 lease/range。

但合理推論：這類 correctness instrumentation與「完整列出每一筆合法 GPU load address」是不同問題。Hermes不應把 `MemcheckPassed` 升級成 `ObservedPhysicalKVReadSetComplete`。

新增：
`AllocationRangeAccessWitness`、`KVPoolNVTXLabel`、`MemcheckPassState`。

否定 edge：
`MemcheckPassState --does_not_prove→ CompletePhysicalReadTrace`

### 5. Nsight Compute提供 memory-system aggregate evidence，但仍不是 per-load causal provenance

NVIDIA Nsight Compute官方 profiling model可觀察 global/local memory、L1/L2、DRAM與peer/system apertures等 memory hierarchy counters。這可用來做 ZERO/REPLACE probe前後的 transaction/caching對照，建立 `MemoryTrafficDeltaWitness`。

但 aggregate counter無法單獨回答「request R42 / layer L18 / logical token 37實際讀了哪個 KV address」。所以完整 instrumentation仍需 source/binary-level probe或受控 kernel變體。

## Architecture Breakdown

### Physical Read Verifier

`ForwardConsumptionEpoch`
→ `AttentionMetadataGeneration`
→ `PageTableGeneration`
→ `BackendLayoutIdentity`
→ `StaticExpectedReadSet`
→ `BackendPhysicalReadPolicy`
→ `InstrumentationPlan`
→ `InstrumentedExecutedReadSet`
→ `ExpectedObservedDiff`
→ `CausalProbe`
→ `CausalContributionSet`
→ `Residual/Logit/Token/AgentAction Delta`

### InstrumentationPlan

建議三階段，不直接一開始追所有GPU transaction：

A. Range contract：把每個 KV allocation/page/lease generation用 NVTX memory label/range描述，先找 illegal/stale read。

B. Address probe：建立 debug kernel variant，在選定 request/layer/head/token範圍內把 `p_block_idx/internal_offsets/k_offset/v_offset` 寫入 trace buffer；只 sampling少量 query避免改變 execution過多。

C. Causal probe：對 selected physical slot/page執行 ZERO、REPLACE、SWAP-GENERATION，記錄 `ΔAttention → ΔResidual → ΔLogit → ΔToken`。

## Bottom-Level Logic

以 current vLLM Triton decode path：

`seq_idx, kv_head_idx`
→ `seq_len`
→ `j × BLOCK_SIZE`
→ `abs_token_idx`
→ `l_block_idx = abs_token_idx // PHYSICAL_BLOCK_SIZE`
→ `p_block_idx = block_table[l_block_idx]`
→ `internal_offsets = abs_token_idx % PHYSICAL_BLOCK_SIZE`
→ `k_offset/v_offset` from physical block + head + feature + token strides
→ final tile `kv_load_mask = abs_token_idx < seq_len`
→ `tl.load(K/V)`
→ optional FP8 scale
→ `QK`
→ `seq_mask`
→ optional sliding-window score mask
→ softmax
→ `P·V`
→ output.

新的關鍵區分：

`AddressGenerated`
≠ `LoadPredicateTrue`
≠ `MemoryTransactionObserved`
≠ `SemanticWeightNonZero`
≠ `OutputCausallyDependsOnValue`.

## Visual Simulation Idea

### Expected vs Observed KV Read Microscope

五層同步時間/空間視圖：

1. Logical tokens：0…N
2. Page table：logical page → physical page + lease generation
3. Expected addresses：K/V address heatmap
4. Observed/instrumented addresses：trace overlay，差異用 `EXPECTED_NOT_OBSERVED / OBSERVED_NOT_EXPECTED`
5. Semantic contribution：softmax weight與ZERO/REPLACE造成的 Δlogit

互動開關：
- backend：vLLM Triton / FlashInfer CuTe
- sliding window
- final-page partial length
- FP8/BF16
- page reuse generation
- trace sampling layer/head/token
- ZERO / REPLACE / stale-page injection

Failure states：
`STALE_LEASE_READ`、`OUT_OF_EXPECTED_RANGE_READ`、`EXPECTED_OBSERVED_DIVERGENCE`、`LOADED_BUT_SEMANTICALLY_MASKED`、`CAUSAL_EFFECT_WITHOUT_EXPECTED_READ`、`EXPECTED_READ_WITHOUT_CAUSAL_EFFECT`。

## Code / GitHub

### vLLM
值得持續讀：
- `vllm/v1/attention/ops/chunked_prefill_paged_decode.py`
- `vllm/v1/attention/backends/flashinfer.py`
- paged attention metadata / block table construction

本輪已確認 `chunked_prefill_paged_decode.py` 的 physical block lookup、stride address generation、final-tile load predicate與後續 score masking是分離的。

### FlashInfer
值得持續讀：
- CuTe DSL paged prefill/decode wrappers
- TMA paged kernel implementation
- page table → tensor map / TMA tile mapping

## Papers / Technical Sources

1. FlashInfer CuTe DSL documentation, current 0.6.x docs. Architecture：paged KV + CuTe DSL/TMA；重要改變：明確揭露 full-page over-read + mask 的 memory contract。限制：文件是 API/implementation contract，不是 hardware transaction trace。
2. NVIDIA Compute Sanitizer documentation. Architecture：runtime correctness instrumentation；貢獻：precise illegal/misaligned access detection、NVTX memory labeling/permissions。限制：不等於完整合法 access trace。
3. NVIDIA Nsight Compute Profiling Guide. Architecture：GPU performance counter/profiling stack；貢獻：memory hierarchy traffic與aperture觀測。限制：aggregate evidence，非 request/token-level provenance。

## Unknown / Open Questions

1. FlashInfer CuTe/TMA在特定 SM90/SM100 kernel variant中，TMA transaction的最小實際 physical footprint如何由page size、tile shape與layout共同決定？
2. 如何在不大幅改變 timing/cache behavior下取得 request/layer/head scoped physical read trace？source-level trace buffer與binary instrumentation哪個 perturbation較小？
3. ZERO/REPLACE probe如何處理 softmax冗餘：某個 loaded KV即使被改動也可能因 attention weight極低而幾乎沒有 Δlogit，不能反推「沒有讀」。

## 下一輪研究

優先下鑽：

`FlashInfer CuTe DSL paged kernel`
→ `TMA tensor map / tile shape`
→ `physical page base`
→ `TMA load footprint`
→ `mask boundary`
→ `SM90/SM100 backend differences`

並設計 Hermes debug instrumentation schema：

`{request_id, forward_epoch, layer_id, head_id, page_generation, physical_page, token_offset, address_range, load_predicate, semantic_mask, causal_probe_id}`

之後接：
`ObservedReadEvidence → ZERO/REPLACE → ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction`。

## Knowledge Graph 新增 Node / Edge

Nodes：
- StaticExpectedReadSet
- InstrumentedExecutedReadSet
- CausalContributionSet
- PhysicalLoadEligibilityGate
- SemanticContributionEligibilityGate
- BackendPhysicalReadPolicy
- PredicatedElementLoadPolicy
- FullTileLoadThenMaskPolicy
- AllocationRangeAccessWitness
- KVPoolNVTXLabel
- MemoryTrafficDeltaWitness
- ExpectedObservedDiff
- CausalKVProbe
- TracePerturbationRisk

Edges：
- `PageTableGeneration + BackendLayoutIdentity → StaticExpectedReadSet`
- `BackendPhysicalReadPolicy → PhysicalLoadEligibilityGate`
- `PhysicalLoadEligibilityGate → InstrumentedExecutedReadSet`
- `InstrumentedExecutedReadSet --does_not_imply→ SemanticContributionSet`
- `MemcheckPassState --does_not_prove→ CompletePhysicalReadTrace`
- `MemoryTrafficDeltaWitness --supports_but_does_not_identify→ PerTokenPhysicalRead`
- `CausalKVProbe + OutputDelta → CausalContributionEvidence`

## 本輪結論

缺哪一層：仍缺低擾動、request/layer/head scoped 的 runtime physical-address observation。

最淺節點：`InstrumentedExecutedReadSet` production implementation。

仍只是名詞：hardware-strength `CompletePhysicalReadTrace`。

最值得讀原始碼：FlashInfer CuTe/TMA paged kernel與vLLM對FlashInfer backend的metadata轉換。

最值得追引用/技術脈絡：TMA paged attention、GPU binary instrumentation、CUDA memory correctness instrumentation。

最適合視覺模擬：Expected vs Observed KV Read Microscope。

最值得實作的 Agent 架構：`State-grounded Planner + Runtime Provenance Verifier + Kernel Address Verifier + Backend Physical Read Policy Adapter + Instrumentation Controller + Causal KV Probe + Causal Evidence Gate + Tool Executor`。

本輪核心推進：上一輪只能回答「kernel原始碼預期從哪裡讀」；本輪把下一個驗證層正式拆成 `expected → executed/instrumented → causal` 三級證據，並發現 vLLM Triton與FlashInfer CuTe對 partial page 的 physical-read policy並不相同。Hermes後續不能再用單一 `ObservedPhysicalKVReadSet` 混合這三種不同強度的證據。