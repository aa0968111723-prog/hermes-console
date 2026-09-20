# 【AI Agent × Multimodal Research Report】

**時間：2026-09-20 11:53（Asia/Taipei）**  
**主題：Attention Kernel Exact KV Read Set × BlockTable Consumer Semantics × RuntimeKVReadWitness**

## 本小時新發現

本輪延續上一輪 `SlotMappingEpoch → PhysicalKVIdentity → RuntimeKVReadWitness`，不再重複 stream/CUPTI identity。這次直接追 current vLLM `TRITON_ATTN` 的 metadata 與 `triton_unified_attention.py` kernel，找到上一輪缺失的 **attention backend metadata → exact kernel KV-read address function**。

關鍵修正：`slot_mapping` 是本 step 新 K/V 的 **write address**；attention read path 並不是拿 `slot_mapping` 逐項讀 cache，而是由 `seq_idx + seq_len + query position + attention mask/window + block_table` 決定 logical KV positions，再由 `block_table` 把 logical block 翻譯成 physical block，最後以 cache strides + KV head + slot offset形成 K/V global-memory address。因此：

`KVWriteAddress(slot_mapping) ≠ KVReadSet(block_table, seq_len, mask/window, head, cache strides)`。

這使 `RuntimeKVReadWitness` 可以從模糊概念收斂為可計算的 address-set witness。

## 本小時最重要 5 個發現

### 1. TritonAttentionMetadata 已把 read-side 關鍵動態資料集中到同一 metadata contract
**已確認工程實作**：current `TritonAttentionMetadata` 包含 `query_start_loc`、`seq_lens`、`block_table`、`slot_mapping`，另有 causal、sliding/RSWA、multimodal-prefix 等會改變可讀 token 範圍的 metadata。CUDA Graph capture 支援為 ALWAYS，而且註解明示 step-dependent fields 直接 reference persistent input buffers。

**重要性**：Hermes 應建立 `AttentionMetadataEpoch`，而不是只追 `BlockTableEpoch` 或 `SlotMappingEpoch`。

來源：https://github.com/vllm-project/vllm/blob/main/vllm/v1/attention/backends/triton_attn.py

### 2. Kernel 直接從 block table 解析 physical block
**已確認工程實作**：`kernel_unified_attention` 先由 `resolve_seq_and_query_len()` 得到 `seq_idx/query_len/seq_len`，計算 `block_table_offset = seq_idx * block_table_stride`；tile loop 中再執行：

```text
seq_offset = j * TILE_SIZE + offs_t
physical_block_idx = load(
  block_tables_ptr
  + block_table_offset
  + seq_offset // BLOCK_SIZE
)
```

這是目前最重要的新 bottom-level mechanism：logical context position 在 kernel 內透過 block table被翻譯成 physical KV block。

來源：https://github.com/vllm-project/vllm/blob/main/vllm/v1/attention/ops/triton_unified_attention.py

### 3. Exact KV address 可以由 kernel address arithmetic 重建
非 tensor-descriptor path 的 K/V 位址明確由：

```text
physical_block_idx
+ kv_head_idx
+ seq_offset % BLOCK_SIZE
+ head-dimension offset
+ cache strides
```

組成。概念式：

```text
V_addr = V_base
       + physical_block * stride_v_block
       + kv_head * stride_v_head
       + slot_offset * stride_v_slot
       + dim * stride_v_dim

K_addr = K_base
       + physical_block * stride_k_block
       + kv_head * stride_k_head
       + slot_offset * stride_k_slot
       + dim * stride_k_dim
```

Tensor Descriptor path雖改成 descriptor load，但仍先由 block table取得 `physical_block_scalar`，再以 physical block/head/offset建立 descriptor base；因此 semantic address translation不變。

### 4. 「BlockTable 中存在」仍不等於「kernel 實際讀取」
Kernel 先透過 `compute_tile_loop_bounds()` 限制 tile 範圍，再透過 `compute_kv_seq_mask()` 套用 causal、sliding window、multimodal prefix、chunk-local、RSWA 等規則。因此 read set 必須是：

```text
Candidate positions from sequence
→ tile-loop bounds
→ physical block lookup
→ causal/window/MM/chunk mask
→ valid global-memory K/V loads
```

而不是 `all blocks in block_table`。

這新增否定 edge：
`BlockTableMembership --does_not_prove→ ActualKVRead`。

### 5. vLLM backend routing使 RuntimeKVReadWitness 必須 backend-specific
vLLM current CUDA backend priority會依 GPU generation與 feature compatibility選 FLASHINFER / FLASH_ATTN / TRITON_ATTN / FLEX / TURBOQUANT 等；不同 backend 的 metadata與 kernel address path不完全相同。因此本輪只對 `TRITON_ATTN` 建立 source-proven exact-read model，不能外推為所有 vLLM attention backend。

來源：https://docs.vllm.ai/en/latest/design/attention_backends/

## Architecture Breakdown

```text
SchedulerStepEpoch
  ↓
CommonAttentionMetadata
  ├─ query_start_loc
  ├─ seq_lens
  ├─ block_table
  ├─ slot_mapping ───────→ KV WRITE address
  ├─ causal/window
  └─ multimodal ranges
          ↓
TritonAttentionMetadataEpoch
          ↓
Graph Replay / Attention Node
          ↓
kernel_unified_attention
          ↓
resolve_seq_and_query_len
          ↓
compute_tile_loop_bounds
          ↓
logical seq_offset
          ↓
block_table[seq, logical_block]
          ↓
physical_block_idx
          ↓
cache stride arithmetic
          ↓
K/V global-memory load
          ↓
compute_kv_seq_mask
          ↓
EffectiveKVReadSet
          ↓
RuntimeKVReadWitness
```

## Bottom-Level Logic

### Read-set function

```text
READ_SET(R, H) = {
  PhysicalKVIdentity(
    device,
    cache_group,
    layer,
    block_table[R.seq][p // BLOCK_SIZE],
    p % BLOCK_SIZE,
    H,
    KVLeaseEpoch,
    ContentEpoch
  )
  for p in EFFECTIVE_POSITIONS(R)
}
```

其中：

```text
EFFECTIVE_POSITIONS(R)
=
SEQUENCE_RANGE(R.seq_len)
∩ TILE_LOOP_BOUNDS(R)
∩ CAUSAL_MASK(R)
∩ SLIDING_OR_CHUNK_MASK(R)
∩ MM_PREFIX_RULE(R)
∩ RSWA_RULE(R)
```

### Evidence predicate

```text
RUNTIME_KV_READ_BOUND(replay, layer, head, kv) =
  GRAPH_REPLAY_RUNTIME_BOUND(replay)
  ∧ ATTENTION_NODE_BOUND(replay, layer)
  ∧ ATTENTION_METADATA_EPOCH_BOUND(replay)
  ∧ BACKEND_IDENTITY == TRITON_ATTN
  ∧ BLOCK_TABLE_CONTENT_EPOCH_BOUND
  ∧ KV_LEASE_VALID(kv, replay)
  ∧ kv ∈ RECONSTRUCTED_EFFECTIVE_READ_SET(replay, layer, head)
```

注意：這仍是 **source-semantics + runtime-node binding**。若要聲稱每一次 global-memory transaction 都被硬體實測觀察，還需要更低層 memory tracing；目前不做過度宣稱。

## Visual Simulation Idea

### Attention Read-Set Microscope

```text
Req A / Layer 18 / Head 7
        ↓
seq_len=205, query=1
        ↓
logical positions 0..204
        ↓
causal + window + MM mask
        ↓
Effective positions
[77..204]
        ↓
BlockTable E208
logical block 4 → physical 91
logical block 5 → physical 12
...
        ↓
KV addresses
B91:s13:h7
B91:s14:h7
...
        ↓
Graph G12 / Node N57
TRITON_ATTN
        ↓
RUNTIME_KV_READ_BOUND
```

互動功能：切換 causal/sliding-window/MM-prefix/RSWA；點一個 logical token立即高亮 physical block、slot、head、K/V address；拖動 KV lease epoch時顯示 block reuse；切換 backend 時若尚未建立 backend-specific address model，顯示 `BACKEND_READ_MODEL_UNVERIFIED`。

## Code / GitHub

### 本輪已讀到核心檔案
1. `vllm/v1/attention/backends/triton_attn.py`
   - `TritonAttentionMetadata`
   - `TritonAttentionMetadataBuilder`
   - `TritonAttentionImpl`
   - `unified_attention` call boundary
2. `vllm/v1/attention/ops/triton_unified_attention.py`
   - `kernel_unified_attention`
   - `_load_kv_tile_td`
   - `resolve_seq_and_query_len`
   - `compute_tile_loop_bounds`
   - `compute_kv_seq_mask`
   - physical block lookup
   - K/V pointer arithmetic
3. `vllm/v1/worker/block_table.py`
   - scheduler/block-table → slot mapping contract

### 下一個 source-reading target
- 找 `TritonAttentionImpl.forward()` 到 `unified_attention()` 的完整實參綁定，建立 `layer/cache_group → kv_cache tensor → block_table tensor` identity。
- 追 `triton_attention_helpers.py` 的 `compute_tile_loop_bounds()` 與 `compute_kv_seq_mask()`，把所有 mask規則轉成可執行 read-set simulator。
- 追 active backend selector，讓 verifier先記錄每 layer實際 backend identity，再選對應 address model。
- 對 FLASH_ATTN / FLASHINFER 建立第二、第三個 backend-specific read model，驗證是否能共用 canonical `EffectiveKVReadSet` IR。

## Papers

### Efficient Memory Management for Large Language Model Serving with PagedAttention
- Authors: Woosuk Kwon et al.
- Institution: UC Berkeley 等
- Year: 2023
- Code: https://github.com/vllm-project/vllm
- Architecture: PagedAttention + block-based KV cache management。
- Contribution: 將 KV cache切成非連續 physical blocks，以 block table進行 logical→physical mapping，降低 fragmentation並支援 sharing。
- Limitations relative to this round: 論文/設計回答 memory-management abstraction；本輪進一步追 current Triton kernel 中 block-table lookup 到實際 K/V pointer arithmetic。
- 改變了什麼：Hermes 的 `PhysicalKVIdentity` 不應等同 contiguous sequence address，而必須保留 logical→physical translation witness。

### vLLM Paged Attention kernel design
- Type: official engineering design document
- URL: https://docs.vllm.ai/en/latest/design/paged_attention/
- Contribution: 解釋 paged KV block layout、thread groups、global→shared-memory access。
- Limitation: current vLLM支援多個 backend；舊/單一 paged-attention kernel文件不能當成所有 backend 的唯一 runtime truth。

## Unknown / Open Questions 1-3

1. `TRITON_ATTN` 下如何以最低 overhead把 `AttentionMetadataEpoch` 與 sampled CUPTI `graphNodeId` 精確綁到 layer instance，而不依賴 capture-time NVTX？
2. FLASH_ATTN / FLASHINFER 是否能被正規化成同一個 canonical `EffectiveKVReadSet` IR，還是需要不同 provenance schema？
3. 在 prefix sharing、hybrid KV cache groups、DCP、multimodal prefix與 sparse attention下，`KVLeaseEpoch` 應該是 block-level、slot-level還是 page-object-level identity？

## Knowledge Graph 新增 Node / Edge

### Nodes
- `AttentionMetadataEpoch`
- `AttentionBackendIdentity`
- `TritonAttentionReadModel`
- `LogicalKVPosition`
- `EffectiveKVPositionSet`
- `PhysicalBlockLookupWitness`
- `KVCacheStrideIdentity`
- `KVGlobalMemoryAddress`
- `KVReadAddressSet`
- `AttentionMaskEpoch`
- `BackendReadModelVerificationState`

### Edges
```text
CommonAttentionMetadata --materializes→ AttentionMetadataEpoch
AttentionMetadataEpoch --contains→ BlockTableContentEpoch
AttentionMetadataEpoch --contains→ AttentionMaskEpoch
SlotMappingEpoch --determines→ KVWriteAddress
AttentionMaskEpoch --filters→ EffectiveKVPositionSet
LogicalKVPosition --indexes→ BlockTableContentEpoch
BlockTableContentEpoch --resolves→ PhysicalBlockLookupWitness
PhysicalBlockLookupWitness --combines_with→ KVCacheStrideIdentity
KVCacheStrideIdentity --derives→ KVGlobalMemoryAddress
EffectiveKVPositionSet --constrains→ KVReadAddressSet
AttentionBackendIdentity --selects→ backend-specific read model
TritonAttentionReadModel --reconstructs→ KVReadAddressSet
KVReadAddressSet --supports→ RuntimeKVReadWitness
BlockTableMembership --does_not_prove→ ActualKVRead
SlotMappingEpoch --does_not_define→ AttentionReadSet
```

## 與歷史研究比較

歷史鏈已閉合到 `SemanticEpoch → H2D → replay stream → CUPTI stream identity → GraphReplayRuntimeBound → SlotMappingEpoch → PhysicalKVIdentity`。上一輪的缺口是「attention backend metadata如何變成 exact kernel KV-read set」。本輪首次直接讀 current Triton kernel並找到 physical block lookup、cache pointer arithmetic與 mask/window gating，因此 `RuntimeKVReadWitness` 不再只是名詞：對 `TRITON_ATTN`，它已有一個可實作、可重算、可視覺化的 source-semantics read-set模型。

但這不是硬體 memory transaction trace，也不能外推到其他 backend。證據等級應標為 `SOURCE_DERIVED_READ_SET + RUNTIME_NODE_BINDING`，待 runtime metadata/node join完成後再升級。

## 下一輪研究

```text
TritonAttentionImpl.forward
→ exact unified_attention argument binding
→ layer/cache-group identity
→ kv_cache tensor identity
→ AttentionMetadataEpoch
→ sampled CUPTI graphNodeId
→ layer/node classifier
→ reconstruct EffectiveKVReadSet
→ join PhysicalKVIdentity + KVLeaseEpoch
→ RuntimeKVReadWitness
→ SHAM target writeback
→ ZERO / REPLACE selected K/V
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔGeneratedToken
→ ΔAgentAction
```

## 本輪結束判定

- **缺哪一層**：`AttentionMetadataEpoch + layer/cache-group identity → sampled graphNodeId` 的 runtime join。
- **哪個節點最淺**：`AttentionNodeBindingWitness`，但 `TRITON_ATTN` 的 read semantics 已顯著加深。
- **哪個概念仍只是名詞**：跨 backend 的 `CanonicalEffectiveKVReadSet` 與最下游 `AgentActionCausalBound`。
- **哪個系統值得讀原始碼**：vLLM `triton_attention_helpers.py`、`TritonAttentionImpl.forward()`、backend selector，接著是 FlashAttention/FlashInfer integration。
- **哪篇論文需追引用**：PagedAttention 後續關於 prefix sharing、hybrid KV cache、KV eviction/offload 與 attention-kernel co-design 的工作。
- **哪個概念最適合視覺模擬**：`Logical Position → Mask → BlockTable → Physical Block → K/V Address → Attention Read`。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + Runtime Provenance Verifier + Causal Evidence Gate + Tool Executor`。

本輪最重要的模型修正：**`slot_mapping` 回答「新 K/V 寫去哪裡」，而 attention 的 read set 由 block table、sequence geometry、mask/window 規則與 cache strides共同決定。對 current TRITON_ATTN，我們已從抽象 PhysicalKVIdentity 下鑽到 kernel 內實際的 logical-position → physical-block → K/V address 算式。**