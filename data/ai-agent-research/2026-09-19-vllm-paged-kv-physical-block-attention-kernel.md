# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-19 18:53 Asia/Taipei

## 本小時新發現

本輪延續 17:52 的 `Exact visual token → LLM sequence slot → logical KV slot`，不重複 Qwen2-VL vision encoder；焦點移到 **vLLM V1 KVCacheManager → BlockTable → slot_mapping → physical KV block → PagedAttention kernel**，嘗試閉合上一輪最淺的 `LogicalKVCacheIdentity → PhysicalKVBlockIdentity`。

主要來源：
- vLLM current `vllm/v1/core/kv_cache_manager.py`
- vLLM current `vllm/v1/worker/block_table.py`
- vLLM PagedAttention kernel design: https://docs.vllm.ai/en/v0.8.1/design/kernel/paged_attention.html
- vLLM current Hybrid KV Cache Manager: https://docs.vllm.ai/en/latest/design/hybrid_kv_cache_manager/
- PagedAttention paper: https://arxiv.org/abs/2309.06180
- Paged Attention Meets FlexAttention: https://arxiv.org/abs/2506.07311

### 與歷史研究比較
上一輪已閉合：

```text
Capture Pixel
→ Vision Patch
→ Merged Visual Token
→ Exact LLM Sequence Slot s
→ M-RoPE(t,h,w)
→ logical K_l[s], V_l[s]
```

本輪新增：

```text
logical token position p
→ request block-table row
→ logical block index floor(p / block_size)
→ physical block number
→ in-block offset p % block_size
→ physical slot id
→ K/V cache tensor address
→ PagedAttention global-memory load
→ Q·K
→ softmax
→ weighted V
→ attention output
```

因此 `LogicalKVCacheIdentity → PhysicalKVBlockIdentity` 已可在 vLLM full-attention paged-cache path 建立 deterministic witness；但「physical block id」仍不是永久 identity，因為 block 可被 free/reuse、prefix cache 可共享，hybrid/cache groups 也可能使用不同 block-size/manager semantics。

---

## 本小時最重要 5 個發現

### 1. Scheduler/KV manager 交付的是 block IDs，而不是一整段連續 KV memory
**已確認／vLLM 原始碼。** `KVCacheBlocks` 將每個 KV cache group 的 `KVCacheBlock` 集合封裝給 scheduler，`get_block_ids()` 取出每個 block 的 `block_id`。這正是 logical request context 與 worker-side block table 的橋。

```text
Request
→ KVCacheManager / coordinator
→ KVCacheBlocks[group][j]
→ KVCacheBlock.block_id
→ worker BlockTable row
```

重要性：Hermes 不應把 sequence slot 直接等同 GPU address；中間先經 block allocation identity。

限制：不同 KV cache group 可有不同 manager；Mamba/state cache 不一定使用 token-to-slot mapping。

### 2. BlockTable 明確把 request logical block sequence 映射到 physical block numbers
**已確認／vLLM 原始碼。** `BlockTable.add_row/append_row()` 將 block IDs 寫入 `block_table[row_idx, ...]`。current implementation還支援 allocation block size 與 attention-kernel block size不同：一個 KV-manager block可被拆成多個 kernel blocks。

因此 identity 必須區分：

```text
KVManagerBlockIdentity
≠ KernelBlockIdentity
```

若 manager block=32 tokens、kernel block=16，manager block 0 會映射到 kernel blocks [0,1]。

重要性：這是上一輪 `PhysicalKVBlockIdentity` 太粗糙的第一個修正。

### 3. slot_mapping kernel 給出 token position → physical cache slot 的精確公式
**已確認／vLLM Triton 原始碼。** 在一般單 rank、無 context-parallel 特例時，可簡化為：

```text
logical_block = position // block_size
physical_block = block_table[request, logical_block]
offset = position % block_size
slot_id = physical_block * block_size + offset
```

current kernel在 DCP/PCP context-parallel 情況會先算 virtual block、判斷 token 是否屬於 local rank，再換算 local block offset；非 local token使用 PAD slot。

因此 Hermes 應建立：

```text
PhysicalKVSlotWitness {
 request_id,
 cache_group_id,
 sequence_position,
 logical_block_index,
 kernel_block_id,
 physical_block_number,
 in_block_offset,
 slot_id,
 cp_rank,
 allocation_epoch
}
```

`allocation_epoch` 是 Hermes 建議新增的 runtime witness，用來避免 block ID 被 recycle 後產生假 identity。

### 4. PagedAttention kernel真的用 physical block number計算 K/V global-memory位置
**已確認／vLLM 官方 kernel design。** vLLM 的 paged attention把 K/V cache拆成固定 token blocks。官方文件顯示 K cache layout形如：

```text
[num_blocks, num_kv_heads, head_size/x, block_size, x]
```

V cache則形如：

```text
[num_blocks, num_kv_heads, head_size, block_size]
```

讀 key 時會由 `physical_block_number`、KV head、block offset共同計算 pointer；thread groups將 K 從 global memory載入 registers，計算 query-key dot products，再做 softmax與 V 加權。

所以可以建立：

```text
Visual token sequence slot s
→ physical slot
→ K_cache address(layer,block,head,offset,...)
→ attention kernel load
→ q·k contribution
```

限制：實際 backend可能是 CUDA custom kernel、Triton、Flash/PagedAttention、FlexAttention等，layout不應被硬編碼成唯一格式。

### 5. physical block identity 是 runtime lease，不是 token永久身份
**已確認 + 工程推論。** PagedAttention 的目的就是讓 request logical blocks可以映射到非連續 physical blocks；prefix caching還允許 block被跨 request共享。vLLM current hybrid manager又會依 cache group分開管理 full attention、sliding-window、cross-attention、Mamba等 cache。

因此正確 identity應是：

```text
TokenSemanticIdentity
→ LogicalSequenceIdentity
→ CacheGroupIdentity
→ BlockLeaseIdentity
→ PhysicalSlotIdentity
→ KernelReadWitness
```

而不是：

```text
Token #417 = GPU block #91 forever   // 錯
```

Hermes 若要可驗證 provenance，必須記錄 block allocation/free/reuse event 或至少 `(request, group, block_id, allocation_epoch, time)`。

---

## Architecture Breakdown

### vLLM KV runtime path

```text
Multimodal decoder sequence
│
├─ Scheduler
│  └─ scheduled request/token positions
│
├─ KVCacheManager
│  ├─ cache groups
│  ├─ block pool
│  ├─ prefix-cache lookup
│  └─ KVCacheBlocks
│
├─ Worker BlockTable
│  ├─ request row
│  ├─ physical block IDs
│  ├─ optional manager-block → kernel-block split
│  └─ CPU → GPU block table
│
├─ Slot Mapping
│  ├─ sequence position
│  ├─ logical/virtual block index
│  ├─ physical block number
│  ├─ in-block offset
│  └─ physical slot id
│
├─ KV Cache Tensor
│  ├─ layer
│  ├─ physical block
│  ├─ KV head
│  ├─ token offset
│  └─ head dimension
│
└─ Attention Kernel
   ├─ load Q
   ├─ block-table-driven K loads
   ├─ QK dot products
   ├─ scale / mask
   ├─ softmax
   ├─ block-table-driven V loads
   └─ weighted reduction → attention output
```

### System reasoning vs model reasoning
- **System/runtime reasoning boundary:** scheduler、cache allocation、prefix reuse、preemption、block table、kernel routing。
- **Model computation:** Q/K/V projection、RoPE、attention scores、softmax、V reduction、MLP/logits。
- KV paging不改變模型定義的 attention graph，但改變 model state 在實體記憶體中的 placement 與讀取方式。

---

## Bottom-Level Logic

### A. Logical position → physical slot
最簡 full-attention、單 cache group、單 CP rank：

```text
b_logical = floor(p / B)
offset    = p mod B
b_phys    = block_table[request_row, b_logical]
slot      = b_phys * B + offset
```

current vLLM kernel在 context parallel時實際多一層：

```text
position
→ virtual_block_index
→ virtual_block_offset
→ is_local(rank)
→ local_block_offset
→ block_indices
→ block_numbers
→ slot_offsets
→ slot_ids
```

所以 `sequence_position → physical_slot` 是 runtime configuration dependent，但仍可 instrumentation。

### B. Physical slot → K/V tensor region
對 layer `l`、KV head `h`：

```text
slot
→ physical_block = slot // B
→ offset = slot % B
→ K[l, physical_block, h, offset, :]
→ V[l, physical_block, h, offset, :]
```

實際 tensor axis order依 backend不同；provenance schema應存 semantic axes，不應只存 raw pointer arithmetic。

### C. Attention read
生成 token `q_t` 時：

```text
q_t
→ each visible logical context block
→ block_table lookup
→ physical block
→ K loads
→ score_i = dot(q_t, K_i) * scale + mask
→ softmax(scores)
→ V loads
→ Σ softmax_i * V_i
→ attention output
```

這裡第一次能把上一輪 screenshot visual token `S417` 接到「某次 decode kernel確實讀了它的 K/V」。

### D. 不能把 attention weight 當 causal proof
即使能抓到：

```text
KernelReadWitness(S417)
AttentionWeight(S417 → generated token t)
```

也只能證明 runtime讀取與模型計算關係。它仍不等於：

```text
Screenshot region R causally caused action A
```

要升級成 causal evidence仍需 token/patch ablation、KV intervention或 activation patching，再比較 logits/action trajectory。

---

## Visual Simulation Idea

### Visual Token → VRAM Page → Attention Kernel Microscope

在 Hermes Console 點 screenshot UI region：

```text
Pixel region
↓
Vision patch group
↓
Merged visual token #417
↓
LLM sequence slot S417
↓
Layer 18 K/V
↓
Request logical block #26
↓ BlockTable
Physical block #91
↓
Offset #1 / physical slot
↓
GPU KV tensor
↓
PagedAttention kernel
↓
Q·K score
↓
softmax weight
↓
V contribution
↓
attention output
```

互動功能：
1. `Logical View`：sequence token與M-RoPE位置。
2. `Memory View`：block table、block lease、fragmentation、prefix sharing。
3. `Kernel View`：哪個 head/warp/thread group正在讀哪個 K/V block。
4. `Causal Experiment`：只對指定 visual-token KV做 zero/replace intervention，重跑 decode，顯示 logit/action delta。
5. `Evidence Labels`：`EXACT_LOGICAL_ID` / `EXACT_RUNTIME_MAPPING` / `KERNEL_READ` / `ATTENTION_ASSOCIATION` / `CAUSAL_INTERVENTION`。

---

## Code / GitHub

### 本輪追的核心檔案
1. `vllm/v1/core/kv_cache_manager.py`
   - `KVCacheBlocks`
   - `KVCacheManager`
   - cache group / coordinator / block pool interface
2. `vllm/v1/worker/block_table.py`
   - `BlockTable`
   - manager-block → kernel-block mapping
   - `compute_slot_mapping`
   - `ComputeSlotMappingKernel`
3. 下一輪應追：
   - `vllm/v1/core/block_pool.py`
   - `vllm/v1/core/kv_cache_coordinator.py`
   - `vllm/v1/attention/backends/*`
   - CUDA/Triton paged-attention kernels

### 建議 Hermes instrumentation

```text
KVRuntimeManifest {
 request_id,
 model_instance_id,
 layer_id,
 cache_group_id,
 block_size,
 kernel_block_size,
 sequence_position,
 logical_block_index,
 physical_block_id,
 allocation_epoch,
 in_block_offset,
 slot_id,
 kv_head,
 backend,
 kernel_launch_id,
 timestamp
}
```

另建立 `BlockLeaseEvent`：

```text
ALLOC / SHARE / HIT / COPY / FREE / REUSE / PREEMPT / OFFLOAD / RESTORE
```

這比直接 dump K/V tensors更適合第一版，成本較低且能先閉合 identity graph。

---

## Papers

### Efficient Memory Management for Large Language Model Serving with PagedAttention
- Authors: Woosuk Kwon, Zhuohan Li, Siyuan Zhuang, Ying Sheng, Lianmin Zheng, Cody Hao Yu, Joseph E. Gonzalez, Hao Zhang, Ion Stoica
- Institutions: UC Berkeley / LMSYS ecosystem
- Year: 2023
- URL: https://arxiv.org/abs/2309.06180
- Code: https://github.com/vllm-project/vllm
- Dataset/benchmarks: serving workloads across popular LLMs; throughput/latency/memory evaluation
- Architecture: virtual-memory-inspired KV blocks + PagedAttention + vLLM serving engine
- Contribution: KV cache按 block動態配置，降低 fragmentation並支援 sharing；論文報告相較當時系統 throughput 提升約 2–4×。
- Limitations for Hermes: 論文是 serving efficiency，不提供 screenshot→token→physical-slot provenance schema。
- 改變了什麼：把 KV cache從「每 request 一大塊連續 memory」改成可分頁、可非連續、可共享的 runtime state。

### Paged Attention Meets FlexAttention: Unlocking Long-Context Efficiency in Deployed Inference
- Authors: Thomas Joshi, Herman Saini, Neil Dhillon, Antoni Viros i Martin, Kaoutar El Maghraoui
- Institution: IBM Research / Foundation Model Stack
- Year: 2025
- URL: https://arxiv.org/abs/2506.07311
- Code: paper reports open-source implementation in FMS
- Architecture: Paged KV storage + FlexAttention fused gather/attention
- Contribution:展示 paged physical placement可與不同 attention programming/kernel abstraction結合。
- Limitations: benchmark硬體/模型設定有限；不能推論所有 vLLM backend layout相同。
- 對 Hermes 的意義：再次證明 `logical KV identity` 應與 `backend-specific physical layout` 分離建模。

---

## Unknown / Open Questions 1-3

1. **Allocation epoch / reuse witness**：vLLM block pool何時 free/reuse block ID、prefix sharing/refcount如何更新？若沒有 epoch，`physical_block_id=91` 在兩個時間點可能是不同內容。
2. **Exact backend tensor address**：current vLLM可選多種 attention backend；需逐 backend閉合 semantic slot → raw tensor strides/address → kernel load。
3. **KV causal provenance**：kernel讀了 visual token K/V並不等於它 causally決定 action；下一步需要 KV zero/replace intervention與 logit/action delta。

---

## 下一輪研究

優先沿著：

```text
KVCacheManager
→ BlockPool
→ KVCacheBlock refcount/hash
→ allocate/free/reuse
→ prefix-cache sharing
→ preemption/offload
→ allocation epoch
→ physical block lease
→ backend KV tensor
→ kernel load
→ KV intervention
→ logit delta
```

並回答：
- physical block ID何時失效？
- prefix cache共享時兩個 request是否指向同一 physical block？
- copy-on-write/partial hit如何改變 identity？
- preemption/offload/restore後 physical identity如何重建？
- 怎麼在不 dump敏感 K/V內容下證明某 sequence token在某 kernel launch被讀取？

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `KVCacheGroupIdentity`
- `KVManagerBlockIdentity`
- `KernelBlockIdentity`
- `BlockTableRowWitness`
- `PhysicalKVBlockIdentity`
- `PhysicalKVSlotWitness`
- `BlockLeaseIdentity`
- `AllocationEpochWitness`
- `ContextParallelLocalityWitness`
- `KVCacheTensorRegion`
- `AttentionKernelLaunchWitness`
- `KernelKVReadWitness`
- `AttentionAssociationWitness`
- `KVInterventionWitness`（planned）

### Edges
```text
LogicalKVCacheIdentity
  --ALLOCATED_AS--> KVManagerBlockIdentity
KVManagerBlockIdentity
  --SPLIT_TO--> KernelBlockIdentity
MultimodalSequenceSlot
  --POSITION_MAPS_TO--> BlockTableRowWitness
BlockTableRowWitness
  --RESOLVES_TO--> PhysicalKVBlockIdentity
PhysicalKVBlockIdentity
  --LEASED_DURING--> BlockLeaseIdentity
PhysicalKVBlockIdentity
  --OFFSET_SELECTS--> PhysicalKVSlotWitness
PhysicalKVSlotWitness
  --STORED_IN--> KVCacheTensorRegion
AttentionKernelLaunchWitness
  --READS--> KVCacheTensorRegion
KernelKVReadWitness
  --COMPUTES--> AttentionAssociationWitness
```

### Evidence ladder 更新

```text
CAPTURE_PIXEL_BOUND
→ VISION_PREPROCESS_BOUND
→ VISION_PATCH_BOUND
→ EXACT_MULTIMODAL_SEQUENCE_SLOT
→ LOGICAL_KV_CACHE_BOUND
→ BLOCK_TABLE_BOUND
→ PHYSICAL_KV_SLOT_BOUND          ← 本輪到達
→ ATTENTION_KERNEL_READ_BOUND     ← 本輪可建模
→ KV_CAUSAL_INTERVENTION_BOUND
→ LOGIT_CAUSAL_BOUND
→ AGENT_ACTION_CAUSAL_BOUND
```

---

## 本輪結束判斷

- **缺哪一層：** block allocation/free/reuse/prefix-sharing 的 temporal lease identity，以及 backend-specific raw tensor/kernel address closure。
- **哪個節點最淺：** `AllocationEpochWitness`。
- **哪個概念仍只是名詞：** `KVInterventionWitness → AgentActionCausalBound`。
- **哪個系統值得讀原始碼：** vLLM `block_pool.py + kv_cache_coordinator.py + attention backends/kernels`。
- **哪篇論文需追引用：** PagedAttention (Kwon et al., 2023)，並追後續 prefix caching、KV compression、disaggregated/offloaded KV work。
- **哪個概念最適合視覺模擬：** `Visual Token → VRAM Page → Attention Kernel Microscope`。
- **哪個 Agent 架構最值得實作：** `Provenance-driven Active Perception + Exact Multimodal Token Identity + KV Runtime Witness + PreAction Verifier`。

## 本輪最重要結論

Hermes 現在已不只知道 screenshot 某區域變成 LLM 的哪個 visual sequence slot；在 vLLM paged-cache runtime中，已可以繼續追到 **這個 slot 在某次 request/layer/cache-group 中被映射到哪個 physical KV block、哪個 in-block slot，以及 PagedAttention kernel如何透過 block table把它從 GPU global memory讀回來**。

但這也揭露下一個關鍵邊界：`physical block ID` 是會被配置、共享、釋放與重用的 runtime lease，不是永久 token identity。下一輪必須加入時間與 allocation epoch，才能讓「Pixel → Token → KV → GPU」成為真正不會串錯世代的可驗證 provenance chain。