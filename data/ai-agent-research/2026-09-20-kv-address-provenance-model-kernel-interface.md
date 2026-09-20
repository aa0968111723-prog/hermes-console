# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-20 23:51（Asia/Taipei）

## 本小時新發現

本輪延續上一輪 `SemanticToken → PyTorch graph annotation → sourceGraphNodeId → replay kernel`，不再重複 CUDA Graph identity，而是往真正尚未閉合的下一層推進：**Replay kernel 到底讀了哪一批 KV cache，以及如何把 model-level metadata 轉成可驗證的 kernel memory contract。**

核心新結論：對 vLLM current Triton Attention，必須把 KV provenance 分成兩條不同方向：

1. **KV Write Provenance**：`layer_slot_mapping → cache-update kernel → physical KV slots`。
2. **KV Read Provenance**：`block_table + seq_lens + query geometry + attention policy → attention kernel → logical token set → physical KV blocks/offsets`。

`slot_mapping` 不是 attention read-set 的完整描述；它主要描述目前 forward 的 K/V 要寫入哪個 cache slot。Attention 的歷史 KV read path 則由 `block_table`、sequence length、window/mask、prefix/segment policy 等共同決定。

這是對前幾輪 `BlockTable / SlotMapping → EffectiveKVReadSet` 的重要精化。

---

# 本小時最重要 5 個發現

## 1. vLLM 已有一個非常乾淨的 Layer → KV runtime join point

current `get_attention_context(layer_name)` 直接從 `ForwardContext` 取得：

- layer-specific `attn_metadata`
- `attn_layer`
- 該 layer 綁定的 `kv_cache`
- `layer_slot_mapping`

而 speculative decoding 情況下，metadata 甚至可能是 `list[dict[layer_name → metadata]]`，base-model metadata 位於 index 0。

因此 Hermes 不需要從 kernel trace反推 layer的 KV tensor；可以在 semantic side先建立：

`LayerInvocationSemanticEpoch → {attn_metadata, kv_cache, layer_slot_mapping}`。

狀態：已確認，vLLM current source。

## 2. KV write path 與 KV read path 是不同的 provenance contract

current vLLM `unified_kv_cache_update()` 取得 `kv_cache + layer_slot_mapping`，再呼叫 backend `do_kv_cache_update()`。Triton backend中，cache-update kernel接收 `slot_mapping`，把 current key/value reshape/store進 cache。

因此 write witness可建模為：

`CurrentTokenKV → layer_slot_mapping → CacheUpdateKernel → PhysicalKVSlotWriteSet`。

但是 attention forward並沒有把 `slot_mapping` 傳進 `unified_attention()`；Triton `forward()` 取出的是：

`query_start_loc, seq_lens, max_query_len, max_seq_len, block_table, window/mask/prefix/segment metadata, key_cache, value_cache`。

因此 read witness應是：

`QueryInvocation → block_table + seq_lens + policy → logical KV token set → physical blocks → K/V addresses → AttentionKernelReadSet`。

這兩條 path必須分離後再用 ContentEpoch join。

狀態：已確認，vLLM current source。

## 3. `block_table` 是 read indirection；`slot_mapping` 是 current-write placement，不能混為同一概念

PagedAttention 的核心就是 logical blocks 到 non-contiguous physical blocks 的映射。current Triton attention把 `attn_metadata.block_table` 直接傳入 `unified_attention()`，同時把 `key_cache/value_cache` view傳入 kernel。

因此最小 read-address模型應是：

`logical_token_position`
→ `logical_block = floor(position / block_size)`
→ `offset = position mod block_size`
→ `physical_block = block_table[request, logical_block]`
→ `KV tensor layout/stride`
→ `K address + V address`。

注意：這只是 canonical paged-attention address model；實際 backend還可能加入 sliding window、sink token、chunk lookback、multimodal prefix、sparse/indexer、quantized layout、3D segmented attention等變形。

狀態：PagedAttention論文 + current vLLM source交叉確認。

## 4. Physical address 本身仍不足以證明 semantic KV identity

前幾輪已建立 `CapturedBufferAddressIdentity != RuntimeContentEpoch`。本輪把它延伸到 KV：

`Same KV tensor data_ptr + same physical block number`
並不代表
`Same request / token / semantic KV content`。

因為 block可能在不同 request lifecycle被重新租用，block table也會隨 runtime state改變。

因此 Hermes 的 physical witness至少要包含：

`KVPoolIdentity + PhysicalBlockId + SlotOffset + KVLeaseEpoch + KVContentEpoch + LayerIdentity + dtype/layout/quantization`。

只有 address沒有 lease/content epoch，只能叫 `PhysicalAddressObservation`，不能升格成 `RuntimeKVReadWitness`。

狀態：工程推論，建立在 vLLM dynamic block mapping與前幾輪 content/topology separation之上；仍需 allocator lifecycle instrumentation驗證 lease epoch。

## 5. Model2Kernel / M2K 類研究指出真正缺口是「model-kernel interface contract」

Model2Kernel 不是單純 kernel fuzzing；它先分析模型如何呼叫 kernel，把 kernel arguments區分為 model-fixed 與 user-variable，再把這些 invocation constraints交給 CUDA-specialized symbolic execution。這與 Hermes目前的研究方向高度一致。

Hermes不應只收集：

`kernel_name, grid, block, pointer`

而應建立：

`SemanticInvocationContract {
 layer,
 backend,
 tensor shapes,
 tensor strides,
 dtype,
 block_size,
 block_table domain,
 seq_len bounds,
 slot_mapping domain,
 quantization mode,
 attention policy,
 kernel variant
}`

然後驗證 runtime launch 是否滿足 contract。

這讓 Runtime Provenance Verifier 可以同時變成 Model↔Kernel Contract Verifier。

狀態：論文結果 + Hermes architecture synthesis。

---

# Architecture Breakdown

## System architecture：vLLM Attention / KV provenance

```text
Scheduler / KV Manager
        ↓
CommonAttentionMetadata
        ↓
ForwardContext
        ↓
get_attention_context(layer_name)
        ↓
┌─────────────────────────────────────────────┐
│ Layer Runtime Context                       │
│ attn_metadata                               │
│ kv_cache                                    │
│ layer_slot_mapping                          │
└─────────────────────────────────────────────┘
        ↓
        ├──────── KV WRITE PATH
        │
        │ unified_kv_cache_update
        │ → do_kv_cache_update
        │ → slot_mapping
        │ → reshape/cache kernel
        │ → PhysicalKVSlotWriteSet
        │
        └──────── KV READ PATH
          unified_attention_with_output
          → backend impl.forward
          → block_table
          → seq_lens/query geometry
          → mask/window/prefix policy
          → key_cache/value_cache
          → attention kernel-set
          → PhysicalKVReadSet
```

## 與上一輪 CUDA Graph semantic provenance 合併

```text
SemanticToken
→ PyTorch Graph Annotation / Eager Correlation
→ Replay Kernel Identity
                         ┐
                         ├→ ModelKernelInvocationContract
ForwardContext Snapshot ┘
→ BlockTableEpoch
→ KVLeaseEpoch
→ KVContentEpoch
→ ExpectedPhysicalKVReadSet

Replay Kernel
→ observed launch / variant
→ contract match
→ RuntimeKVReadWitness
```

---

# Bottom-Level Logic

## KV write

```text
current token K/V
→ layer_name
→ get_attention_context
→ kv_cache
→ layer_slot_mapping
→ do_kv_cache_update
→ reshape_and_cache kernel
→ slot index
→ physical block + block offset
→ K/V storage address
→ KVWriteWitness
```

## KV read

```text
query token
→ request / sequence
→ seq_len
→ attention policy
   ├ causal mask
   ├ sliding window
   ├ sink token
   ├ multimodal prefix
   ├ chunk lookback
   └ sparse/indexer policy
→ effective logical token positions
→ logical block ids
→ block_table lookup
→ physical block ids
→ block offset
→ key_cache/value_cache stride/layout
→ physical K/V address set
→ attention kernel-set
→ output
```

## Quantization/layout 不能忽略

current Triton backend會依 KV quantization改變 cache view：普通 path把 KV cache transpose後 split成 K/V；per-token-head quantized path使用專用 cache view與 scale cache；FP8 path還可能 reinterpret dtype。因此：

`PhysicalKVReadSet = address-set + layout-version + dtype + quantization-mode + scale-state`。

只記 pointer 不足以重建 kernel看到的數值。

---

# Visual Simulation Idea

## KV Virtual Memory → Physical Read/Write Microscope

```text
REQUEST R7 / Layer18

Logical tokens
0 1 2 3 | 4 5 6 7 | 8 9
    ↓         ↓        ↓
Logical B0   B1       B2
    ↓         ↓        ↓
BlockTable
B0→P12      B1→P91   B2→P33

GPU KV POOL
P12 [K/V K/V K/V K/V]
P33 [K/V K/V ...]
P91 [K/V K/V K/V K/V]

READ
Attention A9
→ logical {0..9}
→ physical {P12,P91,P33}
→ exact K/V address ranges

WRITE
new token 10
→ slot_mapping S
→ P33[offset=2]
```

互動功能：

- 點 query token：顯示它實際可見的 logical KV token set。
- 點 logical token：沿 block table跳到 physical block/offset。
- 點 physical slot：顯示目前 `request/token/layer/lease_epoch/content_epoch`。
- 同時疊加 CUDA kernel identity/sourceGraphNodeId。
- 切換 sliding-window / prefix / sparse / quantized mode，比較 read set。
- 顯示 `ADDRESS_MATCH_BUT_LEASE_MISMATCH`、`BLOCK_TABLE_EPOCH_MISMATCH`、`KERNEL_CONTRACT_MISMATCH`。

---

# Code / GitHub

## vLLM current source — 本輪最值得看的檔案

### `vllm/model_executor/layers/attention/attention.py`

關鍵：

- `get_attention_context(layer_name)`：semantic layer → metadata/KV cache/slot mapping join point。
- `unified_kv_cache_update()`：KV write path。
- `unified_attention_with_output()`：Attention read/compute path。

### `vllm/v1/attention/backends/triton_attn.py`

關鍵：

- `TritonAttentionImpl.forward()`：`block_table`、`seq_lens`、query geometry、KV views進入 `unified_attention()`。
- `_pth_key_value_caches()`：per-token-head quantized layout。
- `do_kv_cache_update()`：`slot_mapping`進入 cache write kernel。

下一輪應繼續讀：

- Triton `unified_attention` kernel本體的 block-table indexing。
- KV cache manager / block allocator：physical block lease/reuse lifecycle。
- block table builder：request logical block → physical block mapping生成點。

---

# Papers

## Efficient Memory Management for Large Language Model Serving with PagedAttention

- Authors: Woosuk Kwon, Zhuohan Li, Siyuan Zhuang, Ying Sheng, Lianmin Zheng, Cody Hao Yu, Joseph E. Gonzalez, Hao Zhang, Ion Stoica
- Institution: UC Berkeley 等
- Year: 2023 / SOSP 2023
- Architecture: logical KV blocks → block table → non-contiguous physical blocks → paged attention kernel
- Contribution: 把 OS-style paging引入 KV cache，降低 fragmentation並支援 block sharing。
- Limitation: 論文是 serving memory architecture，不直接提供 Hermes 所需的 per-invocation causal provenance。
- 改變了什麼：把 KV cache從「request一塊連續 tensor」改成 logical-to-physical virtualized state。

## Model2Kernel: Model-Aware Symbolic Execution For Safe CUDA Kernels

- Authors: Mengting He, Shihao Xia, Haomin Jia, Wenfei Wu, Linhai Song
- Year: 2026
- Architecture: model-aware dynamic analysis → invocation constraints → CUDA-specialized symbolic execution
- Contribution: 把 model context帶進 kernel memory-safety verification；論文報告在 vLLM/Hugging Face等環境找到大量先前未知 bugs。
- Limitation: 目標是 memory safety，不是完整 semantic/KV causal provenance。
- 對 Hermes 的改變：確認 `ModelKernelInvocationContract` 應成為 Knowledge Graph一級節點，而不是把 kernel當成只有名字的黑盒。

## vToken: Token-Level Virtualization for Reclaimable KV Caches

- Authors: Yuanhang Gao, Xiangrui Yang, Yuanfeng Chen, Hongjia Chen, Qianru Lv, Wenfei Wu, Dongsheng Li
- Year: 2026
- Architecture: stable logical token view → token-table indirection → asynchronous physical repacking
- Contribution: 把 KV virtualization從 block-level再細化到 token-level，並保持 PagedAttention kernel/CUDA Graph compatibility。
- Limitation: 新的 token indirection會讓 `logical token → physical KV` provenance更動態。
- 對 Hermes 的改變：`BlockTableEpoch` 不是未來所有 runtime的 universal最低層；Knowledge Graph應抽象成 `KVAddressTranslationLayer`，PagedAttention block table只是其中一種 implementation。

---

# Unknown / Open Questions

1. current Triton `unified_attention` kernel內，所有 2D/3D/quantized/window/prefix path對 `block_table` 的實際 indexing公式是否能統一成一個 `EffectiveKVReadSet` contract？
2. vLLM physical block被 free/reallocate時，哪個 runtime event最適合產生 `KVLeaseEpoch`，且如何在多 KV-cache group / hybrid attention模型下保持唯一？
3. 對 vToken/token-level virtualization等新設計，Hermes應如何讓 `KVAddressTranslationLayer` plugin化，而不把 provenance綁死在 block table？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

- `KVWriteProvenance`
- `KVReadProvenance`
- `PhysicalKVSlotWriteSet`
- `ExpectedPhysicalKVReadSet`
- `ObservedPhysicalKVReadSet`
- `KVAddressTranslationLayer`
- `BlockTableEpoch`
- `SlotMappingEpoch`
- `KVPoolIdentity`
- `KVLeaseEpoch`
- `KVContentEpoch`
- `KVLayoutVersion`
- `ModelKernelInvocationContract`
- `KernelContractMismatchState`
- `AddressMatchLeaseMismatchState`
- `BlockTableEpochMismatchState`

## Edges

`LayerInvocationSemanticEpoch → get_attention_context → LayerRuntimeContext`

`LayerRuntimeContext → layer_slot_mapping → KVWriteProvenance`

`LayerRuntimeContext → block_table → KVReadProvenance`

`KVReadProvenance → KVAddressTranslationLayer → ExpectedPhysicalKVReadSet`

`ReplayKernelIdentity → satisfies → ModelKernelInvocationContract`

`ExpectedPhysicalKVReadSet + KVLeaseEpoch + KVContentEpoch → RuntimeKVReadWitness`

`PhysicalAddressObservation --does_not_prove→ SemanticKVIdentity`

`SlotMapping --does_not_fully_describe→ AttentionHistoricalKVReadSet`

`BlockTable --implements→ KVAddressTranslationLayer`

---

# 本輪結束判斷

**缺哪一層：** vLLM KV allocator/block manager 的 `allocate/free/reuse → KVLeaseEpoch`，以及 Triton kernel內 exact block-table indexing → physical address公式。

**哪個節點最淺：** `KVLeaseEpoch` production witness。

**哪個概念仍只是名詞：** `ObservedPhysicalKVReadSet`；目前可計算 expected read set，但尚未以 memory-access instrumentation逐地址觀測。

**哪個系統值得讀原始碼：** vLLM Triton `unified_attention` kernel + V1 KV cache manager/block allocator。

**哪篇論文需追引用：** vToken，因為它會直接挑戰「block table就是最低層 address translation」的假設；Model2Kernel/M2K則應追 model-kernel interface constraint extraction。

**哪個概念最適合視覺模擬：** `Logical Token → Block/Token Translation → Physical KV Slot → Replay Kernel`。

**哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Model-Kernel Contract Verifier + KV Address Translator + Causal Evidence Gate + Tool Executor`。

---

# 下一輪研究

```text
vLLM KV cache manager
→ block allocator
→ allocate/free/reuse lifecycle
→ KVPoolIdentity
→ KVLeaseEpoch
→ block table builder
→ BlockTableEpoch
→ Triton unified_attention indexing
→ exact logical-token → physical-address formula
→ ModelKernelInvocationContract
→ ExpectedPhysicalKVReadSet
→ optional observed memory-access validation
→ RuntimeKVReadWitness
→ ZERO / REPLACE KV
→ ΔAttentionOutput
→ ΔResidual
→ ΔLogit
→ ΔGeneratedToken
→ ΔAgentAction
```

本輪最大的推進是：**Semantic→GPU kernel 的身份鏈已經開始接到真正的 KV memory semantics；而且我們確認 read 與 write 是兩種不同的 address provenance。下一輪只要補上 allocator lease lifecycle 與 kernel exact indexing，就能開始把「這個 Attention invocation 讀了哪一代、哪些實體 KV」從抽象 Knowledge Graph變成可計算、可驗證的 runtime witness。**
