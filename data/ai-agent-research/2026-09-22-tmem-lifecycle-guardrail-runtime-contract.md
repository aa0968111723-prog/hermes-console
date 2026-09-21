# 【AI Agent × Multimodal Research Report】

時間：2026-09-22 01:51（Asia/Taipei）

主題：Blackwell TMEM Lifecycle × TCMMA Guardrails × Runtime Safety Contract

## 本小時新發現

本輪承接上一輪 `TCGen05 MMA Issue Observability × Instrumentation Gap`，但不重複尋找尚未證實的 `tcgen05.mma` direct runtime callback。本輪改追一條可被 NVIDIA 官方工具直接驗證的相鄰底層鏈：**TMEM allocation → pointer retrieval → tcgen05 access → relinquish/deallocation → memcheck guardrail**。

核心新結論：即使 current Compute Sanitizer 公開 Patching API 沒有明確的 `tcgen05.mma issue` callback，NVIDIA 已提供另一個 production-grade runtime evidence surface：PTXAS `-g-tmem-access-check` 可在 Blackwell 的 `tcgen05.*` 周圍插入 TCMMA guardrails；在 Compute Sanitizer memcheck 下，可報告未配置 TMEM column、越界、misaligned access，以及 relinquish 後的不合法 allocation/access 類錯誤。因此 Hermes 不必把「沒有 exact MMA issue trace」誤判成「無法取得任何 Tensor Core runtime correctness evidence」。

本輪新增 system architecture：`TMEM Ownership & Safety Runtime`。

本輪新增 bottom-level mechanism：`TMEM Allocation Permit / Column Range / Pointer Generation / Access Guardrail / Relinquish / Deallocation` 的生命週期狀態機。

## 本小時最重要 5 個發現

### 1. Blackwell TCMMA guardrails 是官方 runtime safety evidence surface

**已確認事實 / NVIDIA 官方**：Compute Sanitizer 文件說明，在 Blackwell 使用 `tcgen05.*` 時，可透過 PTXAS `-g-tmem-access-check` 插入 guardrails。配合 memcheck，可報告 invalid TCMMA operation，例如 TMEM out-of-bounds、misaligned access、未配置 column，以及 allocation permit 已 relinquish 後的非法狀態。

來源：https://docs.nvidia.com/compute-sanitizer/ComputeSanitizer/index.html

這建立：

`TCMMAAccess → GuardrailCheck → TMEMSafetyViolationWitness`

但不能建立：

`GuardrailPass --proves→ ExactDynamicMMAIssueSet`

Guardrail 是 safety witness，不是完整 instruction lineage trace。

### 2. CUTLASS CuTe DSL 的 TMEM 是顯式 lifecycle，不是普通 register/shared-memory fragment

**已確認事實 / NVIDIA CUTLASS source**：current `cutlass/cute/arch/tmem.py` 暴露 `alloc_tmem`、`retrieve_tmem_ptr`、`relinquish_tmem_alloc_permit`、`dealloc_tmem`。allocation 會把 TMEM base address 寫到 SMEM buffer，之後再從該 buffer retrieve TMEM pointer；deallocation 必須帶 pointer 與 column count。

來源：https://github.com/NVIDIA/cutlass/blob/main/python/CuTeDSL/cutlass/cute/arch/tmem.py

因此底層不是：

`make_fragment_C → accumulator exists`

而是：

`AllocationPermit → alloc_tmem(columns) → SMEM address handoff → retrieve_tmem_ptr → TMEM pointer/range → tcgen05 access → dealloc/relinquish`。

### 3. TMEM provenance 必須加入 allocation generation 與 column-range identity

**工程建模 / 由官方 API 合理推導**：只保存 TMEM pointer 不足以唯一證明合法 ownership。TMEM allocation可被 deallocate/reused，allocation permit也可 relinquish。因此 Hermes 應建立：

`TMEMAllocationIdentity = KernelLaunchIdentity + CTA/CTAGroup + AllocationGeneration + BaseColumn + ColumnCount + TwoCTAFlag`

以及：

`TMEMPointerGeneration → belongs_to → TMEMAllocationIdentity`

新增否定 edge：

`SameTMEMPointerValue --does_not_prove→ SameTMEMAllocationGeneration`

這與先前 KV page generation / TensorMap generation 的 provenance 原則一致，但作用於 Blackwell on-chip Tensor Memory。

### 4. tcgen05 的安全性與 exact MMA lineage 是兩個不同 evidence axis

上一輪缺口是：`generated tcgen05.mma → dynamic MMAIssueEvent`。

本輪確認可以平行建立：

`ExecutionLineageEvidence = source / compiled / binary / commit-frontier`

與：

`TMEMSafetyEvidence = allocation / range / alignment / permit / guardrail`

因此一個 kernel 可能是：

`MMA lineage = RECONSTRUCTED`

但同時：

`TMEM safety = RUNTIME_GUARDRAIL_VERIFIED`

Hermes Console 不應把不同 evidence axis 壓成單一 VERIFIED/UNVERIFIED。

### 5. datacenter Blackwell 與 consumer Blackwell 的 tcgen05 capability 不能混為一談

**已確認事實 / current CUTLASS source**：current `tcgen05/mma.py` 明確將 tcgen05 TMEM/UMMA hardware 描述為 datacenter-Blackwell path，並對 consumer `sm_120/sm_121` 提示改用 warp-level MMA 路徑。這也修正前一輪將 sm_120 外部 instrumentation 線索直接外推到 B200/sm_100 的風險。

來源：https://github.com/NVIDIA/cutlass/blob/main/python/CuTeDSL/cutlass/cute/nvgpu/tcgen05/mma.py

因此新增：

`GPUArchitectureCapabilityContract → gates → TCGen05/TMEMExecutionContract`

不能只以「Blackwell」一詞推導所有 tcgen05/TMEM capability。

## Architecture Breakdown

### TMEM Ownership & Safety Runtime

```text
Request / ForwardEpoch / Layer
  ↓
KernelLaunchIdentity
  ↓
GPUArchitectureCapabilityContract
  ↓
CTA / CTAGroup ownership
  ↓
TMEM Allocation Permit
  ↓
alloc_tmem(column_count)
  ↓
SMEM address handoff
  ↓
retrieve_tmem_ptr
  ↓
TMEMAllocationIdentity
  ↓
TMEMPointerGeneration
  ↓
tcgen05.cp / tcgen05.mma / tcgen05.ld/st
  ↓
TCMMA Guardrail
  ├─ valid → safety witness
  └─ invalid → memcheck violation
  ↓
commit / wait / consumer
  ↓
dealloc_tmem
  ↓
relinquish allocation permit
```

### 與上一輪 MMA observability stack 的關係

```text
                ┌─ MMA lineage axis ─────────────┐
CuTe source → PTX/SASS → [runtime issue gap] → commit frontier
                └─────────────────────────────────┘

                ┌─ TMEM safety axis ──────────────┐
alloc → pointer/range → tcgen05 access → guardrail → dealloc
                └─────────────────────────────────┘
```

兩軸最後在 `tcgen05 access` 與 `Stage/Accumulator identity` join。

## Bottom-Level Logic

### TMEM lifecycle state machine

```text
NO_PERMIT
  → PERMIT_AVAILABLE
  → ALLOCATING
  → ALLOCATED(generation, base_column, count)
  → POINTER_PUBLISHED_TO_SMEM
  → POINTER_RETRIEVED
  → ACTIVE_ACCESS
  → QUIESCENT
  → DEALLOCATED
  → PERMIT_RELINQUISHED
```

合法 access contract：

```text
AccessLegal =
  ArchitectureSupportsTCGen05
  ∧ AllocationGenerationIsLive
  ∧ Column ∈ [BaseColumn, BaseColumn + ColumnCount)
  ∧ AlignmentValid
  ∧ CTAGroupOwnershipValid
  ∧ AllocationPermitStateValid
```

Runtime guardrail 能直接覆蓋其中部分 safety predicates，但不能自動證明 request/layer causal attribution。

新增 failure states：
- `TMEM_UNALLOCATED_COLUMN_ACCESS`
- `TMEM_COLUMN_RANGE_OOB`
- `TMEM_MISALIGNED_ACCESS`
- `TMEM_STALE_ALLOCATION_GENERATION`
- `TMEM_ACCESS_AFTER_DEALLOC`
- `TMEM_ALLOC_AFTER_PERMIT_RELINQUISH`
- `TMEM_CTA_GROUP_OWNERSHIP_MISMATCH`
- `ARCH_CAPABILITY_CONFLATION`

## Visual Simulation Idea

### TMEM Lifecycle & Guardrail Microscope

Hermes Console 顯示三層同步視圖：

```text
Lifecycle:  PERMIT → ALLOC G7 → PTR → ACTIVE → DEALLOC → RELINQUISH
Columns:    0 .... 31 | 32 .... 63 | 64 ....
                         ^ allocated range
Accesses:              MMA / LD / ST / CP
Guardrail:             PASS / OOB / MISALIGN / STALE
```

互動控制：
- 調整 base column / column count
- 切換 CTA_GROUP::1 / ::2
- 模擬 pointer reuse
- 在 dealloc 後再次 access
- 提前 relinquish permit
- 切換 sm_100 vs sm_120 capability profile

Evidence badge 分開顯示：`LINEAGE: RECONSTRUCTED`、`SAFETY: RUNTIME_GUARDRAIL`、`CAUSAL: UNVERIFIED/VERIFIED`。

## Code / GitHub

### NVIDIA CUTLASS

值得看的 current 檔案：
- `python/CuTeDSL/cutlass/cute/arch/tmem.py`
  - `alloc_tmem`
  - `retrieve_tmem_ptr`
  - `dealloc_tmem`
  - `relinquish_tmem_alloc_permit`
- `python/CuTeDSL/cutlass/cute/nvgpu/tcgen05/mma.py`
  - architecture capability gate
  - tcgen05 MMA op definitions
- `examples/cute/tutorial/blackwell/01_mma_sm100.cu`
  - TMEM allocator / accumulator lifecycle example

Repository：https://github.com/NVIDIA/cutlass

### NVIDIA Compute Sanitizer

值得驗證：
- PTXAS `-g-tmem-access-check`
- memcheck TCMMA guardrails
- unallocated column / OOB / misalignment / relinquish-related failures

URL：https://docs.nvidia.com/compute-sanitizer/ComputeSanitizer/index.html

## Papers

### Model2Kernel: Model-Aware Symbolic Execution For Safe CUDA Kernels

- Authors：Mengting He, Shihao Xia, Haomin Jia, Wenfei Wu, Linhai Song
- Year：2026
- URL：https://arxiv.org/abs/2603.24595
- Code：本輪未確認公開 code URL
- Dataset / evaluation：vLLM、Hugging Face 與近期 LLM research CUDA kernels/models
- Architecture：model-aware dynamic analysis + CUDA-specialized symbolic execution
- Contribution：將模型架構固定參數與 user-controlled kernel arguments分類後進行 memory-safety verification；論文報告發現 353 個 previously unknown bugs、9 false positives
- Limitations：symbolic/dynamic verification不是 Blackwell tcgen05/TMEM 專用 hardware trace；不能取代 TCMMA guardrail 或 exact MMA lineage
- 改變了什麼：提供 Hermes `Runtime Guardrail + Model-Aware Static/Symbolic Verification` 雙層 GPU safety verifier 的研究依據。

### Microbenchmark-Driven Analytical Performance Modeling Across Modern GPU Architectures

- Authors：Aaron Jarmusch, Sunita Chandrasekaran
- Year：2026
- URL：https://arxiv.org/abs/2605.04178
- Architecture：B200 model 顯式建模 TMEM、TMA、5th-gen Tensor Cores
- Contribution：21 個 B200 kernels 報告 1.31% MAE；naive roofline baseline 在同組 kernels 超過 95% error
- Limitations：performance model，不是 correctness/runtime lineage verifier
- 改變了什麼：再次證明 TMEM/TMA/tensor-core execution 必須成為 Blackwell 一級 architecture nodes，而非 generic GPU memory/tensor-core 標籤。

## Unknown / Open Questions 1-3

1. `-g-tmem-access-check` 對 production attention kernel 的 overhead、coverage 與 graph/capture 相容性是多少？需要真實 B200 benchmark。
2. guardrail error 是否能穩定 join 到 Hermes 的 `KernelLaunchIdentity + request_id + layer_id + CTAGroupIdentity + TMEMAllocationGeneration`？
3. 如何把 runtime TMEM safety witness 與上一輪缺失的 `RuntimeBinaryMMAIssueWitness` join，形成 `MMA issue → legal TMEM accumulator range → commit frontier → output` 的完整 causal chain？

## 下一輪研究

只追一條主線：

```text
TMEM allocator callsite
→ tcgen05.alloc / retrieve pointer lowering
→ AllocationGeneration
→ accumulator TMEM layout
→ tcgen05.mma destination columns
→ -g-tmem-access-check guardrail
→ memcheck runtime violation schema
→ launch/request attribution
→ commit frontier
→ accumulator load
→ Attention output
```

若能找到真實 B200 guardrail trace/schema，下一輪建立 `TMEMRuntimeSafetyWitness` 的 production event schema；若找不到，明確停在官方 capability contract，不把文件能力誤寫成已實測。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `GPUArchitectureCapabilityContract`
- `TMEMAllocationPermitState`
- `TMEMAllocationIdentity`
- `TMEMAllocationGeneration`
- `TMEMColumnRange`
- `TMEMPointerGeneration`
- `TMEMAccessWitness`
- `TCMMAGuardrailWitness`
- `TMEMRuntimeSafetyWitness`
- `TMEMDeallocationWitness`
- `TMEMPermitRelinquishWitness`
- `ExecutionLineageEvidenceAxis`
- `TMEMSafetyEvidenceAxis`

### Edges
```text
GPUArchitectureCapabilityContract --gates→ TCGen05ExecutionContract
TMEMAllocationPermitState --authorizes→ TMEMAllocationIdentity
TMEMAllocationIdentity --owns→ TMEMColumnRange
TMEMPointerGeneration --refers_to→ TMEMAllocationGeneration
TCGen05Access --targets→ TMEMColumnRange
TCMMAGuardrailWitness --verifies_subset_of→ TMEMSafetyContract
TMEMDeallocationWitness --invalidates→ TMEMAllocationGeneration
TMEMPermitRelinquishWitness --closes→ TMEMAllocationPermitState
SameTMEMPointerValue --does_not_prove→ SameTMEMAllocationGeneration
GuardrailPass --does_not_prove→ ExactDynamicMMAIssueSet
RuntimeMMAIssueWitness --orthogonal_to→ TMEMRuntimeSafetyWitness
```

## 本輪結束判斷

- **缺哪一層：** 真實 B200 `-g-tmem-access-check + memcheck` event → request/layer/TMEM allocation generation attribution。
- **哪個節點最淺：** `TMEMRuntimeSafetyWitness` 的 production instance。
- **哪個概念仍只是名詞：** request-scoped `TMEMAllocationGeneration` runtime join；目前是必要 provenance model，尚未有 serving trace。
- **哪個系統值得讀原始碼：** CUTLASS TMEM allocator + Blackwell FMHA accumulator lifecycle，並與 Compute Sanitizer guardrail behavior 對照。
- **哪篇論文需追引用：** Model2Kernel，特別追它對 inference kernel dynamic tensor memory / user-controlled dimensions 的後續工作。
- **哪個概念最適合視覺模擬：** `TMEM Lifecycle & Guardrail Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + GPU Capability Router + TMEM Lifecycle Verifier + TCMMA Guardrail Adapter + MMA/Commit Frontier Reconstructor + Launch Attribution Joiner + Causal Evidence Gate + Tool Executor`。

本輪最大的推進：**上一輪確認 exact `tcgen05.mma` dynamic issue trace仍有 observability gap；本輪沒有假裝把缺口補上，而是找到 NVIDIA 已正式提供、可直接驗證的另一條 runtime correctness 軸——TMEM/TCMMA guardrails。Hermes 因此開始從單一「GPU instruction lineage」升級成多軸證據模型：execution lineage、TMEM safety、completion frontier、causal output 各自保留證據強度，再在 Knowledge Graph 中 join。**