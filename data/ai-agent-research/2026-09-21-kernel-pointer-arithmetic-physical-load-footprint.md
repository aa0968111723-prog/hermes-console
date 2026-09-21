# 【AI Agent × Multimodal Research Report】

**時間：2026-09-21 14:54（Asia/Taipei）**  
**主題：Paged KV Kernel Pointer Arithmetic × Physical Load Footprint × Semantic Contribution Boundary**

## 本小時新發現

本輪直接接續上一輪 `physical page ID → kernel pointer arithmetic → actual global-memory/TMA load trace`，不再停留於 page table。核心突破：在 current vLLM Triton prefix/paged-attention path，physical block ID 如何轉成 K/V element offset 已可從 production kernel逐項還原；因此 `ExpectedPhysicalKVReadSet` 可以從「page集合」提升為「element-address公式」。但 `ObservedPhysicalKVReadSet` 仍不能宣稱已由硬體trace觀測，必須保持 expected/observed 分離。

## 本小時最重要 5 個發現

### 1. Physical page ID → K/V element offset 已有 production公式【已確認工程實作】

vLLM `_paged_kv_cache_offsets` 先以 `token_indices // PHYSICAL_BLOCK_SIZE` 得到 logical block，再從 `B_Loc[request, logical_block]` 取得 physical block `bn`。接著 K/V 使用不同 layout 計算 offset：

```text
K layout = [num_blocks, num_kv_heads, head_size/x, block_size, x]
V layout = [num_blocks, num_kv_heads, head_size, block_size]

internal = token_position % PHYSICAL_BLOCK_SIZE

K_offset =
  physical_block * stride_k_cache_bs
+ kv_head        * stride_k_cache_h
+ floor(d/x)     * stride_k_cache_d
+ internal       * stride_k_cache_bl
+ (d mod x)      * stride_k_cache_x

V_offset =
  physical_block * stride_v_cache_bs
+ kv_head        * stride_v_cache_h
+ d              * stride_v_cache_d
+ internal       * stride_v_cache_bl
```

這表示 `PhysicalKVPageIdentity + Head + TokenOffset + FeatureDim + LayoutStrides` 已足以推導 expected element addresses。

### 2. Attention kernel真的以這些 offsets執行 `tl.load`【已確認工程實作】

context loop每次產生 `off_k/off_v` 後，直接執行 `tl.load(K_cache + off_k)` 與 `tl.load(V_cache + off_v)`；尾端tile或 padded head dimension則使用mask。這比上一輪只知道 page metadata更接近實際 GPU load instruction，但仍是 source-level expected footprint，不是硬體memory trace。

### 3. Physical load footprint與semantic contribution再次被正式分離【已確認 + 合理推論】

K/V可以先被載入，之後 qk才經 sequence-boundary與 sliding-window mask變成 `-inf`。因此某個K/V element被load，不代表它最後對softmax/output有非零貢獻。新增三層：

```text
ExpectedElementLoadFootprint
→ LoadedButMaskedFootprint
→ SemanticContributionSet
```

這修正任何「GPU讀到 = 模型使用到」的過度推論。

### 4. FlashInfer證明同一semantic KV集合可以映射到不同physical backend contract【官方文件】

FlashInfer current API允許 paged K/V pool使用 HND/NHD layout；`paged_kv_indices`仍是physical page IDs，但page pool tensor strides/layout與backend可為 FA2/FA3/TRTLLM-Gen/CuTe DSL等。其 current context-attention API支援 page size 16/32/64/128；CUDA Graph模式還要求caller持有persistent page-index/indptr/last-page-length buffers。

所以 `ExpectedPhysicalKVReadSet` 必須帶 `BackendLayoutIdentity`，不能只帶 page IDs。

### 5. `ObservedPhysicalKVReadSet` 的最小可行 instrumentation 已可定義【研究設計，尚未驗證】

下一步不應直接追求逐byte全量trace，而應建立 differential witness：

```text
ExpectedElementAddressSet
+ controlled ZERO/REPLACE page/token/head region
+ attention output delta
+ residual/logit/token delta
→ CausalPhysicalReadWitness
```

再以 instrumented kernel記錄 `(physical_block, token_offset, kv_head, feature_tile)`，和 expected address model比對。硬體cache-line/TMA transaction trace可作更強證據，但不是第一個可行版本。

## Architecture Breakdown

```text
Request / ForwardConsumptionEpoch
→ Attention metadata
→ B_Loc / paged_kv_indices
→ logical token position
→ logical block index
→ physical block ID
→ internal token offset
→ kv head
→ feature dimension tile
→ backend layout strides
→ K/V element offsets
→ tl.load / backend memory load
→ q·k
→ causal/window mask
→ softmax
→ p·v
→ attention output
→ residual
→ logits
→ sampled token
```

本輪 system architecture重點不是transport，而是 `Page Table → Kernel Address Generator → Memory Load → Semantic Mask → Attention Output`。

## Bottom-Level Logic

### vLLM Triton address generation

```text
token_position
→ logical_block = token_position // physical_block_size
→ physical_block = B_Loc[request, logical_block]
→ internal = token_position % physical_block_size
→ K/V stride arithmetic
→ off_k / off_v
→ K_cache + off_k / V_cache + off_v
→ tl.load
```

### Read evidence ladder

```text
PageTableWitness
→ PhysicalPageWitness
→ ElementAddressDerivationWitness
→ SourceLevelLoadInstructionWitness
→ ExpectedElementLoadFootprint
→ [missing hardware/instrumented observation]
→ ObservedPhysicalKVReadSet
→ SemanticMaskWitness
→ SemanticContributionSet
→ AttentionOutputDelta
```

重要否定 edges：

```text
SourceLevelLoadInstructionWitness --does_not_prove→ RuntimeLoadExecuted
ExpectedElementLoadFootprint --does_not_prove→ ObservedPhysicalKVReadSet
PhysicalElementLoaded --does_not_imply→ SemanticContribution
PhysicalPageID --does_not_fully_define→ ElementAddress
```

最後一條需要 `BackendLayoutIdentity + Strides + dtype + head geometry`。

## Visual Simulation Idea

### KV Address-to-Attention Microscope

左側顯示 logical token/page；中間顯示 physical page pool；右側顯示 address arithmetic與attention contribution。

```text
Token 37
  ↓ /16
Logical page 2, offset 5
  ↓ B_Loc[req,2]
Physical block 42
  ↓ + head + feature + strides
K addr: base + off_k
V addr: base + off_v
  ↓ tl.load
Loaded tile
  ↓ window/causal mask
MASKED or ACTIVE
  ↓
softmax weight
  ↓
attention output delta
```

互動控制：backend layout HND/NHD、page size、head、feature tile、sliding window、stale page-table generation、ZERO/REPLACE某page/token/head。Failure states：`ADDRESS_LAYOUT_IDENTITY_MISSING`、`EXPECTED_LOAD_NOT_OBSERVED`、`OBSERVED_LOAD_OUTSIDE_EXPECTED_FOOTPRINT`、`LOADED_BUT_SEMANTICALLY_MASKED`、`STALE_PAGE_GENERATION_ADDRESS`。

## Code / GitHub

### vLLM
- `vllm/v1/attention/ops/prefix_prefill.py`
  - `_paged_kv_cache_offsets`: logical position → physical block → K/V element offsets。
  - `_fwd_kernel`: context loop實際用 `tl.load(K_cache + off_k)` / `tl.load(V_cache + off_v)`，再進 qk、mask、softmax、V accumulation。
- 下一步：對照 decode paged-attention與其他backend，確認同一semantic read set的address formula差異。

### FlashInfer
- current attention API：paged cache可為 separate K/V page pools或combined pool；physical page IDs由 `paged_kv_indices`提供。
- backend可切換 FA2/FA3/TRTLLM-Gen/CuTe DSL等，因此需要 `BackendLayoutIdentity`。

## Papers

### Efficient Memory Management for Large Language Model Serving with PagedAttention
- Authors: Woosuk Kwon et al.
- Institution: UC Berkeley / affiliated authors
- Year: 2023
- URL: https://arxiv.org/abs/2309.06180
- Code: https://github.com/vllm-project/vllm
- Dataset/Workloads: LLM serving workloads used in paper evaluation
- Architecture: logical KV blocks → non-contiguous physical blocks → PagedAttention kernel
- Contribution: 建立 serving KV paging abstraction，讓logical sequence不必對應contiguous physical memory。
- Limitation for this research: 論文本身不足以證明current 2026 kernel逐element runtime footprint；本輪以current source補上address-generation evidence。
- 本輪改變：PagedAttention不再只作架構背景，而被接到current kernel stride arithmetic與load instruction層。

本輪沒有用新論文數量填充報告；優先補足上一輪已明確指出的source-level底層缺口。

## 已確認 / 官方 / 推論 / 假說

**已確認工程實作：** vLLM physical block lookup、K/V stride arithmetic、`tl.load`位置、load後的sequence/window masking。  
**官方資訊：** FlashInfer paged-KV tensor layouts、page metadata與backend選擇。  
**論文結果：** PagedAttention的logical/physical paging architecture。  
**合理推論：** runtime metadata + kernel strides可生成 `ExpectedElementAddressSet`。  
**尚未驗證假說：** source-level expected addresses與硬體實際memory transactions完全一致；compiler vectorization/cache/TMA可能擴大或重排transaction footprint。

## Unknown / Open Questions 1-3

1. vLLM decode kernel、FlashInfer FA3/CuTe DSL與Triton prefix kernel在相同semantic KV set下，實際transaction footprint差多少？
2. `ObservedPhysicalKVReadSet`應以logical element、vector transaction、cache line還是TMA tile作canonical evidence unit？
3. 如何以最低侵入方式記錄physical block/token/head tile，同時不顯著改變kernel scheduling與memory behavior？

## 下一輪研究

```text
vLLM decode paged-attention + FlashInfer backend differential
→ physical page id
→ layout/stride identity
→ element address formula
→ vector/TMA transaction granularity
→ instrumented physical block/token/head trace
→ Expected vs Observed diff
→ ZERO / REPLACE selected KV region
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔToken
→ ΔAgentAction
```

優先建立 `PhysicalReadInstrumentationContract`，定義trace schema與evidence strength，再做backend differential。

## Knowledge Graph 新增 Node / Edge

Nodes:
- `BackendLayoutIdentity`
- `KVElementAddress`
- `KCacheElementOffset`
- `VCacheElementOffset`
- `ElementAddressDerivationWitness`
- `SourceLevelLoadInstructionWitness`
- `ExpectedElementLoadFootprint`
- `LoadedButMaskedFootprint`
- `SemanticContributionSet`
- `PhysicalReadInstrumentationContract`
- `CausalPhysicalReadWitness`

Edges:
- `PhysicalKVPageIdentity + TokenOffset + Head + FeatureDim + BackendLayoutIdentity --derives→ KVElementAddress`
- `KVElementAddress --consumed_by→ SourceLevelLoadInstructionWitness`
- `SourceLevelLoadInstructionWitness --supports→ ExpectedElementLoadFootprint`
- `ExpectedElementLoadFootprint --does_not_prove→ ObservedPhysicalKVReadSet`
- `PhysicalElementLoaded --may_enter→ LoadedButMaskedFootprint`
- `LoadedButMaskedFootprint --does_not_contribute_to→ SemanticContributionSet`
- `ObservedPhysicalKVReadSet + InterventionDelta --supports→ CausalPhysicalReadWitness`

## 本輪結束判斷

- **缺哪一層：** source-level `tl.load` expected addresses → runtime instrumented/hardware-observed memory transactions。
- **哪個節點最淺：** `PhysicalReadInstrumentationContract`，因為expected address model已具體，但observed schema尚未production化。
- **哪個概念仍只是名詞：** hardware-strength `ObservedPhysicalKVReadSet`。
- **哪個系統值得讀原始碼：** vLLM decode paged-attention + FlashInfer FA3/CuTe DSL kernels。
- **哪篇論文需追引用：** PagedAttention引用鏈中直接修改physical KV layout/kernel paging的後續工作，而非再追泛化serving文章。
- **哪個概念最適合視覺模擬：** `KV Address-to-Attention Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Page-Table Translation Verifier + Kernel Address Verifier + Physical Read Instrumentation Adapter + Causal Evidence Gate + Tool Executor`。

本輪把上一輪的 physical page identity真正接到kernel element address與`tl.load`：Hermes現在已能回答「依這個page-table generation、backend layout、head與token offset，kernel原始碼預期會從哪個K/V element address讀資料」。下一個邊界只剩最難也最關鍵的一層：**GPU runtime實際讀了什麼，以及被讀到的資料是否真的對Attention→logit→token→Agent action造成因果影響。**