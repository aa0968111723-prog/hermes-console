# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 16:56（Asia/Taipei）

## 本小時新發現

本輪接續 `2026-09-21-physical-read-instrumentation-causal-kv-probe.md`，不重複「expected / executed / causal」三級證據，而是深入上一輪尚未解析的 FlashInfer CuTe DSL / TMA physical footprint，並把「instrumented executed read」進一步拆成 source-level TMA issue、binary-level memory instruction、memory transaction/sector 三種不同觀測層級。

### 新架構 / system architecture
FlashInfer current CuTe DSL paged GQA decode（Blackwell SM100）將 paged KV cache 的 physical page table 先搬入 shared memory，之後由 TMA warp 取出 `virtual_page_idx`，直接作為 global K/V tensor 的 page coordinate，再用 TMA bulk tensor copy 將 page-shaped tile搬到 shared memory，最後交給 MMA/softmax pipeline。這不是一般 scalar `ld.global` 模型，而是：

`PageTable → shared page IDs → TMA tensor coordinate → TensorMap descriptor → bulk G2S copy → shared-memory KV stage → UMMA/MMA → score/mask/softmax → output`。

### 新 bottom-level mechanism
FlashInfer `GroupedQueryAttentionDecodePaged` 對 K 建立 `(page_size, mma_tile_k)` TMA tile，對 V 建立 `(mma_tile_m, page_size)` TMA tile；page size限定 8/16/32/64，sequence tile必須為128倍數。實作中的 `virtual_page_idx = rPT[...]` 隨後直接索引 `gK_tma[..., virtual_page_idx]` / `gV_tma[..., virtual_page_idx]` 並交給 `cute.copy(tma_atom_*, ..., tma_bar_ptr=...)`。因此 physical read footprint的最低合理單位不再只是「element address」，而需要新增 `TMATileTransferFootprint`。

## 本小時最重要 5 個發現

### 1. FlashInfer paged decode 的 physical read contract 是 page-table-driven TMA bulk transfer
**概念**：physical page ID不是先展開成每個 token/head element的 scalar address再逐一 load；CuTe DSL建立 TMA tensor map，runtime page-table ID成為 TMA tensor coordinate的一部分。

**底層如何運作**：
`seqlen/table offset → page table prefetch → shared sPT → rPT → virtual_page_idx → gK_tma/gV_tma coordinate → TMA G2S → shared K/V stage → MMA`。

**為什麼重要**：上一輪 `ExpectedElementLoadFootprint` 對 Triton scalar/vector load合理，但對TMA backend不足。Hermes必須依 backend切換 physical-read model。

**限制**：source-level CuTe DSL仍不是硬體 transaction trace；TensorMap與TMA copy描述的是應執行的bulk transfer contract。

**來源**：FlashInfer `flashinfer/cute_dsl/attention/gqa_decode_paged.py` current source；FlashInfer 0.6.18 docs。

### 2. TMA descriptor 本身是 physical-address derivation contract的一部分
CUDA Driver API `cuTensorMapEncodeTiled` 將 `globalAddress + globalDims + globalStrides + boxDim + elementStrides + interleave + swizzle + L2 promotion + OOB fill` 編碼成 opaque TensorMap。也就是：

`PhysicalPageID` 單獨仍不足以重建實際 physical footprint；至少需要：
`TensorMapGeneration + GlobalBaseAddress + GlobalDims/Strides + BoxDims + DType + Swizzle + PageCoordinate`。

因此新增：
`TensorMapGeneration`、`TensorMapAddressBinding`、`TMATileShape`、`TMACoordinateWitness`。

**限制**：descriptor是opaque；source-level metadata可重建contract，但不等於實際DRAM transaction。

### 3. FlashInfer官方文件確認 TMA paged kernel會 over-read full pages
FlashInfer 0.6.18 CuTe DSL docs要求 `paged_kv_indices`指向的page在 `last_page_len` 之後仍必須是finite，因為TMA-based paged kernel會 over-read full pages並依 masking排除語義無效部分。

所以：
`SemanticValidTokens(last_page_len)`
`≠ TMATileTransferFootprint`
`≠ SemanticContributionSet`。

這使上一輪 `BackendPhysicalReadPolicy` 可加入一個 production instance：
`FlashInfer CuTe/TMA = FULL_PAGE_OR_TILE_LOAD_THEN_MASK`。

### 4. Binary instrumentation可以成為 Expected→Executed 的下一級 witness，但仍不能直接等同 DRAM transaction
NVBit是NVIDIA GPU dynamic binary instrumentation framework，可在SASS instruction前後注入device instrumentation，支援instruction tracer與memory-reference tracer；2026年的CUTracer建立在NVBit上，並提供memory trace、register trace、opcode trace與CUDA Graph aware flow。

因此Hermes可建立：
`SourceTMACopyWitness → SASSMemoryInstructionWitness → InstrumentedMemoryReferenceWitness`。

但必須保留否定edge：
`InstrumentedMemoryReferenceWitness --does_not_prove→ ExactDRAMTransactionSet`，因為cache/coalescing/TMA engine/sector behavior仍會改變memory-system transaction。

### 5. cuFuzz證明 NVBit + whole-program instrumentation 已可用於大型CUDA correctness研究
**Paper**：Hunting CUDA Bugs at Scale with cuFuzz
**Authors**：Mohamed Tarek Ibn Ziad; Christos Kozyrakis
**Institution**：NVIDIA; Stanford University（作者affiliation）
**Year**：2026
**Venue**：OOPSLA / PACMPL 10(OOPSLA1)
**URL**：https://doi.org/10.1145/3798231
**Code**：https://github.com/NVlabs/cuFuzz
**Dataset/targets**：14 CUDA programs；論文報告發現43個先前未知bug，其中19個位於commercial libraries。
**Architecture**：whole-program fuzzing + NVBit device-side coverage + host compiler coverage + sanitization分離process。
**Contribution**：證明dynamic binary instrumentation可以和真實CUDA application、closed-source targets與sanitization工作流結合。
**Limitations**：目標是coverage/bug finding，不是逐request KV semantic provenance；Hermes仍需建立request/layer/head/page attribution layer。
**改變了什麼**：讓 `InstrumentedExecutedReadSet` 從概念走向可工程實作的 binary-instrumentation路線，但不能直接照搬cuFuzz的coverage schema。

## Architecture Breakdown

### FlashInfer CuTe DSL paged GQA decode

```text
Request / batch
  ↓
seqlens + table_offsets
  ↓
page_table global memory
  ↓ cp.async
shared sPT
  ↓
rPT[page]
  ↓
virtual_page_idx
  ↓
TensorMap K/V descriptor
  ├─ global base
  ├─ dims / strides
  ├─ dtype
  ├─ tile box
  └─ swizzle/interleave
  ↓
gK_tma / gV_tma coordinate
  ↓
TMA bulk G2S copy
  ↓
KV shared-memory pipeline stage
  ↓
UMMA / MMA QK
  ↓
mask + softmax
  ↓
P×V
  ↓
O / reduction
```

這個architecture要求Hermes把 backend physical-read contract從單一模型拆成：

- `SCALAR_OR_VECTOR_LOAD_ADDRESS_MODEL`（如Triton path）
- `TMA_TILE_TRANSFER_MODEL`（FlashInfer CuTe/TMA）
- `UNKNOWN_BACKEND_MODEL`（fail closed）

## Bottom-Level Logic

### TMA physical footprint derivation

```text
PageTableGeneration
→ page_table[logical_page]
→ PhysicalPageID

TensorMapGeneration
→ globalAddress
→ globalDims
→ globalStrides
→ boxDims
→ dtype
→ swizzle/interleave

PhysicalPageID
+ TensorMapGeneration
+ TMA tile coordinate
→ ExpectedTMATileTransferFootprint

ExpectedTMATileTransferFootprint
→ SourceTMACopyWitness
→ [binary instrumentation]
→ InstrumentedMemoryReferenceWitness
→ [cache/TMA transaction attribution still missing]
→ HardwareMemoryTransactionWitness
```

### Evidence grades

```text
E0 SOURCE_EXPECTED
E1 SOURCE_TMA_ISSUED
E2 SASS_INSTRUCTION_OBSERVED
E3 INSTRUMENTED_MEMORY_REFERENCE
E4 MEMORY_TRANSACTION_CORRELATED
E5 CAUSAL_INTERVENTION_VALIDATED
```

Hermes不得將E0/E1標成「GPU真的讀過」，也不得把E3標成「DRAM真的發生同樣transaction」。

## Visual Simulation Idea

### TMA Page-to-Tile Physical Footprint Viewer

畫面分六層：

1. Logical KV tokens / `last_page_len`
2. Page table generation與physical page IDs
3. TensorMap descriptor：base/stride/tile/swizzle
4. TMA tile issue timeline：K/V各自顯示page/tile
5. Instrumented SASS/memory-reference overlay
6. Semantic contribution overlay：masked / active / causal-effect

互動開關：page_size 8/16/32/64、NHD/HND、last_page_len、sliding window、stale page-table generation、TensorMap base-address replacement、instrumentation on/off、ZERO/REPLACE page。

Failure states：
- `TMA_PAGE_ID_GENERATION_MISMATCH`
- `TENSOR_MAP_ADDRESS_BINDING_STALE`
- `EXPECTED_TMA_TILE_NOT_OBSERVED`
- `OBSERVED_REFERENCE_OUTSIDE_EXPECTED_TILE`
- `FULL_PAGE_OVERREAD_NONFINITE_TAIL`
- `BINARY_TRACE_WITHOUT_REQUEST_ATTRIBUTION`
- `CAUSAL_EFFECT_WITHOUT_MATCHING_PHYSICAL_WITNESS`

## Code / GitHub

### FlashInfer
Repo: https://github.com/flashinfer-ai/flashinfer

值得繼續看的核心檔案：
- `flashinfer/cute_dsl/attention/gqa_decode_paged.py` — SM100 paged GQA decode、page table、TMA K/V、MMA pipeline。
- `flashinfer/cute_dsl/attention/config.py` — page/tile configuration與pages-per-KV-tile。
- `flashinfer/cute_dsl/attention/roles/loader_tma.py` — reusable paged TMA loader角色。
- `flashinfer/cute_dsl/attention/fmha/sm120/compile.py` — SM120 paged KV pool compile/layout contract。
- `flashinfer/decode.py` — wrapper/backend selection、paged metadata傳遞。

### NVBit
Repo: https://github.com/NVlabs/NVBit

值得看的核心能力：SASS inspection、before/after instruction injection、memory-reference tracing、runtime attach。

### CUTracer
Repo: https://github.com/facebookexperimental/CUTracer

值得看的部分：memory trace mode、CUDA Graph/stream-capture aware instrumentation、host-side trace processing。

### cuFuzz
Repo: https://github.com/NVlabs/cuFuzz

值得看的部分：NVBit coverage instrumentation、whole-program orchestration、sanitizer separation、closed-source target handling。

## Papers

### Hunting CUDA Bugs at Scale with cuFuzz
- Authors: Mohamed Tarek Ibn Ziad, Christos Kozyrakis
- Institution: NVIDIA / Stanford University
- Year: 2026
- Venue: PACMPL / OOPSLA1
- URL: https://doi.org/10.1145/3798231
- Code: https://github.com/NVlabs/cuFuzz
- Dataset/Targets: 14 CUDA programs
- Architecture: whole-program CUDA fuzzing + NVBit device coverage + host coverage + separated sanitization
- Contribution: scalable GPU correctness instrumentation/fuzzing；43 previously unknown bugs reported
- Limitation: coverage/correctness focus，不提供LLM KV request-level semantic attribution

### FlashPrefill V2: Block-Sparse Prefill Attention for Long-Context LLM Serving
- Authors: Qihang Fan, Huaibo Huang, Zhiying Wu, Bingning Wang, Ran He
- Institution: 待下一輪由paper PDF/author affiliations核實
- Year: 2026
- URL: https://arxiv.org/abs/2608.19758
- Code: 本輪未確認官方code mapping
- Dataset: long-context serving evaluations
- Architecture: block-sparse prefill + PackGQA + warp specialization + pingpong pipeline + paged KV + continuous batching
- Contribution: 把sparse attention推進到production-style paged KV/continuous batching；論文報告H20 128K context下相對FA2最高47.26×（FP8）/27.19×（BF16）
- Limitation: sparse prefill physical-read footprint與本輪decode TMA contract不同，不能直接共用同一trace model
- 改變了什麼: 再次證明 `SemanticAttentionSet → PhysicalMemoryFootprint` 高度依backend與sparsity implementation而異

## Unknown / Open Questions 1-3

1. **TMA binary instrumentation visibility**：NVBit/CUTracer對Blackwell TMA相關SASS/async tensor memory operation能觀測到哪一層？能否取得descriptor-derived effective address/sector，而不只看到instruction opcode？
2. **Request attribution**：一個persistent/batched attention kernel中，如何把binary memory reference穩定join回 `request_id + layer + head + PageTableGeneration + TensorMapGeneration`？
3. **Hardware transaction truth**：TMA request經L1/L2/sector/coalescing後，如何建立低擾動 `HardwareMemoryTransactionWitness`？CUPTI/Nsight/NVBit各自能提供的證據強度需下一輪實測/文件交叉驗證。

## 下一輪研究

```text
FlashInfer CuTe/TMA source
→ generated PTX/SASS
→ identify TMA opcodes / tensor-map use
→ NVBit/CUTracer instrumentation feasibility
→ effective-address / memory-reference trace
→ request/layer/page attribution tag
→ ExpectedTMATileTransferFootprint vs InstrumentedMemoryReferenceWitness
→ ZERO / REPLACE selected physical page
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔToken
→ ΔAgentAction
```

並建立 `InstrumentationCapabilityMatrix`：
`NVBit / CUTracer / Compute Sanitizer / Nsight Compute / CUPTI` × `scalar global load / cp.async / TMA / CUDA Graph / persistent kernel / Blackwell`。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `TensorMapGeneration`
- `TensorMapAddressBinding`
- `TMATileShape`
- `TMACoordinateWitness`
- `ExpectedTMATileTransferFootprint`
- `SourceTMACopyWitness`
- `SASSMemoryInstructionWitness`
- `InstrumentedMemoryReferenceWitness`
- `HardwareMemoryTransactionWitness`
- `InstrumentationCapability`
- `RequestTraceAttributionTag`
- `TMAFullPageOverreadPolicy`

### Edges
- `PageTableGeneration --resolves→ PhysicalPageID`
- `PhysicalPageID + TensorMapGeneration --forms→ TMACoordinateWitness`
- `TMACoordinateWitness + TMATileShape --derives→ ExpectedTMATileTransferFootprint`
- `ExpectedTMATileTransferFootprint --supports→ SourceTMACopyWitness`
- `SASSInstrumentation --may_produce→ InstrumentedMemoryReferenceWitness`
- `InstrumentedMemoryReferenceWitness --does_not_prove→ HardwareMemoryTransactionWitness`
- `TMATileTransferFootprint --may_include→ SemanticallyMaskedTail`
- `PhysicalElementLoaded --does_not_imply→ SemanticContribution`
- `RequestTraceAttributionTag --joins→ ForwardConsumptionEpoch`

## 本輪結束檢查

**缺哪一層**：TMA source issue → generated SASS → instrumented effective memory reference → actual memory-system transaction 的中間觀測鏈。

**哪個節點最淺**：`HardwareMemoryTransactionWitness`；目前只有source contract與binary instrumentation可行性，尚無production trace。

**哪個概念仍只是名詞**：`RequestTraceAttributionTag`，尚未有FlashInfer/vLLM production implementation。

**哪個系統值得讀原始碼**：FlashInfer `gqa_decode_paged.py` + `loader_tma.py`，以及NVBit/CUTracer memory tracer。

**哪篇論文需追引用**：cuFuzz，優先追它使用NVBit的instrumentation design與limitations；FlashPrefill V2則追paged sparse attention physical footprint。

**哪個概念最適合視覺模擬**：`TMA Page-to-Tile Physical Footprint Viewer`。

**哪個 Agent 架構最值得實作**：`State-grounded Planner + Runtime Provenance Verifier + Backend Read-Model Adapter + TensorMap/TMA Contract Verifier + Binary Instrumentation Controller + Request Trace Attribution Joiner + Causal KV Probe + Causal Evidence Gate + Tool Executor`。

## 本輪核心推進

上一輪只知道 FlashInfer TMA path「會整頁/整tile over-read」。本輪已從 current source把它下鑽成可驗證的 execution contract：`page table → shared page ID → virtual_page_idx → TMA tensor coordinate → K/V bulk G2S tile → shared-memory pipeline → MMA`，並確認 CUDA TensorMap 的 base/stride/box/swizzle 本身也是 physical-address provenance的一部分。下一輪不再停在source code，會直接研究 **generated SASS與binary memory instrumentation是否能把 TMA tile issue變成真正的 runtime executed-read witness**。