# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 22:51（Asia/Taipei）

主題：vLLM Triton Attention Kernel × Exact KV Read Closure × CUPTI Correlation

## 本小時新發現

本輪承接上一輪 `ResidencyReadyWitness → ConsumerOrderingWitness → Attention KernelLaunch/Read`，不重複 KV allocation/offload。核心突破是 current vLLM `TRITON_ATTN` 已把 `attn_metadata.block_table` 直接傳進 `unified_attention()`；Triton kernel 內部逐 tile 以 `seq_offset // BLOCK_SIZE` 查 block table 得到 `physical_block_idx`，再以 physical block、KV head、in-block slot 與 tensor strides計算 K/V pointer並 `tl.load`。因此 Hermes 現在可把「kernel 使用 block table」提升成 source-level exact read-address formula。

新 system architecture：`Attention Consumer Read Provenance Graph`。

新 GitHub 深讀：
- `vllm/v1/attention/backends/triton_attn.py`
- `vllm/v1/attention/ops/triton_unified_attention.py`
- current vLLM backend selection/ROCm implementation作為 backend-divergence比較。

新底層機制：`AttentionMetadata.block_table → unified_attention launch → Triton program(seq, kv_head, tile) → physical_block_idx → K/V stride arithmetic → tl.load → QK/softmax/V accumulation`。

## 本小時最重要 5 個發現

### 1. BlockTableSnapshot 已真正進入 consumer kernel【已確認：原始碼】

`TritonAttentionImpl.forward()` 直接取 `block_table = attn_metadata.block_table`，並與 `key_cache/value_cache` 一起傳入 `unified_attention()`。因此 scheduler/runtime 建立的 block-table tensor不是只供 metadata/debug 使用，而是 attention consumer 的直接輸入。

重要性：Hermes 可以把 `BlockTableSnapshotWitness` 定義成 kernel argument identity，而不是推測性的 runtime mapping。

限制：Python object/tensor identity本身仍不是「launch 時 bytes 的 immutable snapshot」；若要處理異步 mutation/CUDA Graph replay，需要 version/fence witness。

### 2. Triton kernel 已提供 exact physical-block lookup【已確認：原始碼】

kernel 對每個 sequence tile執行：`physical_block_idx = block_table[seq_idx, seq_offset // BLOCK_SIZE]`。也就是 logical sequence offset先映射到 logical block-table entry，再得到 physical KV block。

這閉合：
`sequence position → block-table entry → physical block`。

限制：不同 backend可能採不同 layout/kernel；此公式是 current TRITON_ATTN 的可驗證實作，不應錯誤泛化成所有 vLLM backend。

### 3. K/V raw address可由 strides與 slot deterministic重建【已確認：原始碼】

pointer path 中：
`K_offset = physical_block * stride_k0 + kv_head * stride_k2 + head_dim * stride_k3 + (seq_offset % BLOCK_SIZE) * stride_k1`；V 使用對應 `stride_v*`。接著 `tl.load(key_cache_ptr + k_offset)` / `tl.load(value_cache_ptr + v_offset)`。

因此可新增 `KernelKVReadAddressWitness`：保存 block-table version、physical block、in-block slot、kv_head、head_dim range、base storage identity與strides。

重要性：上一輪的 `PhysicalKVSlotWitness` 現在能接到 consumer kernel實際 load expression，而非只停在 cache manager。

### 4. Launch identity必須包含 kernel variant/grid，而不只 kernel name【已確認：原始碼 + 工程推論】

`unified_attention()` 依 prefill/decode、batch geometry與 intermediate buffers選 2D 或 3D launch；grid可為 `(total_num_q_blocks, num_kv_heads)` 或再加 softmax segment維度，3D path後續還有 `reduce_segments` kernel。因此 `AttentionKernelLaunchWitness` 至少要保存 backend、kernel variant、grid、constexprs、stream、block-table tensor/version、KV tensor storage identity。

限制：source-level launch witness仍缺 runtime CUPTI correlation ID與GPU timestamps。

### 5. CUPTI/Kineto是把 Python/Triton launch接到GPU activity的正確觀測層【官方文件交叉驗證】

NVIDIA CUPTI Activity/Callback APIs可追 kernel launch、memcpy與CPU↔GPU correlation；PyTorch profiler/Kineto可收集 CUDA kernel/runtime activities，且其 profiler integration具有 correlation-ID tracking。這提供 `LaunchSiteWitness → CUPTICorrelation → GPUKernelActivity` 的工程路徑。

重要性：Hermes 不需要假設「呼叫 unified_attention 的那一刻就是 kernel執行時間」，而能把 host launch、CUDA runtime activity、GPU activity分層。

限制：本輪沒有在實際 Hermes GPU worker上跑 CUPTI trace，所以 `RuntimeKernelCorrelationWitness` 仍是待實測節點。

## Architecture Breakdown

```text
Visual Token / Logical KV
→ KV Block Lease(epoch)
→ ResidencyReadyWitness
→ AttentionMetadata
→ BlockTable Tensor
→ TritonAttentionImpl.forward
→ unified_attention(... block_table, K, V ...)
→ KernelLaunch(grid, variant, stream)
→ seq_offset // BLOCK_SIZE
→ physical_block_idx = block_table[...]
→ in_block = seq_offset % BLOCK_SIZE
→ K/V stride arithmetic
→ tl.load(K/V)
→ Q·K
→ masking / softmax
→ weighted V accumulation
→ attention output
→ residual / LM head / logits
→ generated reasoning/action token
```

關鍵規則：`block table passed to kernel ≠ immutable launch snapshot`；`source pointer formula ≠ observed runtime load`；`runtime load ≠ causal importance`。

## Bottom-Level Logic

### Current TRITON_ATTN read path

```text
logical token position p
→ logical_block = p // B
→ physical_block = block_table[seq, logical_block]
→ slot = p % B
→ K address = K_base
             + physical_block*stride_k0
             + slot*stride_k1
             + kv_head*stride_k2
             + dim*stride_k3
→ V address = analogous stride_v expression
→ tl.load
```

Tensor-descriptor path仍使用相同 physical block identity，但由 `_load_kv_tile_td()`做 tile load；因此 provenance schema應描述 semantic address region，而非只保存某條 pointer arithmetic implementation。

### Kernel launch closure

```text
TritonAttentionImpl.forward
→ unified_attention
→ choose 2D/3D
→ construct grid + constexpr launch configuration
→ kernel_unified_attention[grid](...)
→ CUDA/Triton runtime launch
→ CUPTI runtime correlation ID
→ GPU kernel activity
```

### Causal intervention gate v1

在 target visual-token KV 的 read-address region已閉合後，intervention仍需：
1. 固定 block lease epoch與block-table version。
2. 固定 attention backend/kernel variant/precision/batch geometry。
3. Baseline cached run。
4. Sham write-back同值，建立 numerical-control envelope。
5. Zero/replace target K/V region。
6. 確認 intervention完成 fence happens-before consumer launch。
7. 量測 attention output、residual、logit與action delta。

## Visual Simulation Idea

### Attention Kernel Read Microscope

Console 四層同步視圖：

```text
[Logical]
Visual Token S417 → layer18 → position p

[Block Table]
p/B → entry 26 → Physical Block 91:E17

[Kernel]
program(seq=0, kv_head=3, tile=26)
→ slot 1
→ K/V address region
→ tl.load

[GPU Timeline]
E_restore_done → launch K882 → CUPTI activity → output
```

點某個 visual token時，高亮它在 block table中的 entry、K/V tensor region與會讀到它的 Triton tile。若缺 runtime CUPTI witness顯示 `SOURCE_READ_CLOSED / RUNTIME_READ_UNOBSERVED`；若 CUPTI已對上則升級 `RUNTIME_KERNEL_CORRELATED`。

## Code / GitHub

值得看的核心檔案：
- vLLM `vllm/v1/attention/backends/triton_attn.py`：metadata/KV/block-table到 unified kernel的入口。
- vLLM `vllm/v1/attention/ops/triton_unified_attention.py`：physical block lookup、K/V pointer、`tl.load`、2D/3D launch。
- vLLM `vllm/v1/attention/backends/rocm_attn.py`：backend差異；ROCm native kernel只支援特定 block size，其他情況可路由 Triton。
- PyTorch profiler/Kineto：host operator與CUDA kernel trace。
- NVIDIA CUPTI Activity/Callback APIs：runtime/kernel/memcpy correlation。

## Papers / Technical Sources

### Efficient Memory Management for Large Language Model Serving with PagedAttention
Authors: Woosuk Kwon et al. Institution: UC Berkeley et al. Year: 2023. Architecture: block-based KV cache + scheduler. Contribution:將 KV cache以非連續 physical blocks管理並支援sharing。Limitation:論文抽象不等於 current vLLM backend/kernel細節。改變：提供 logical→physical KV mapping的原始設計基礎。

### NVIDIA CUPTI documentation
Institution: NVIDIA. Current official technical documentation. Architecture: Activity/Callback/Correlation tracing. Contribution:可追 CUDA runtime/driver calls、kernel與memory activities並建立CPU↔GPU correlation。Limitation:觀測 execution，不自動提供 semantic token identity；Hermes仍需外部 correlation tag把 request/token/block lease接進trace。

### PyTorch Profiler / Kineto
Institution: PyTorch. Current official documentation. Architecture: operator + device activity profiler. Contribution:可收集 CUDA kernels/runtime activity並輸出 execution trace；Kineto integration維護 correlation IDs。Limitation:profile trace不會自動知道某個 physical block對應哪個 visual token。

## Unknown / Open Questions 1-3

1. 如何在 vLLM worker中把 `request_id/layer/block_lease_epoch/block_table_version` 作為 NVTX/CUPTI external correlation tag推到特定 Triton attention launch？
2. CUDA Graph / piece-wise graph replay時，Python launch site、block-table storage與實際 replayed kernel activity如何建立穩定 identity？
3. 在 GQA/MQA、context parallel、tensor parallel與3D segmented decode下，如何把同一 visual token的所有 shard/read region聚合成一個完整 `RuntimeKVReadWitness`？

## 下一輪研究

直接追 `torch.compile / piece-wise CUDA Graph → Triton launch → CUDA Graph replay → CUPTI activity → NVTX/external correlation`，並設計最小 instrumentation patch：在 attention launch前後寫入 request/layer/block-table-version/lease-epoch correlation metadata。接著建立第一個真正 runtime `KernelReadEpochIdentity`，再開始 sham/zero/replace KV intervention。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：`AttentionMetadataWitness`、`BlockTableKernelArgumentWitness`、`KernelVariantIdentity`、`KernelLaunchGridWitness`、`KernelKVReadAddressWitness`、`TensorDescriptorKVReadWitness`、`SourceReadClosureWitness`、`CUPTICorrelationWitness`、`GPUKernelActivityWitness`、`RuntimeKernelCorrelationWitness`、`RuntimeReadUnobservedState`、`RuntimeKVReadWitness`。

新增 Edges：
- `AttentionMetadataWitness --contains--> BlockTableKernelArgumentWitness`
- `BlockTableKernelArgumentWitness --maps--> PhysicalKVBlockIdentity`
- `PhysicalKVBlockIdentity --plus_slot/strides--> KernelKVReadAddressWitness`
- `KernelVariantIdentity --executes--> KernelKVReadAddressWitness`
- `KernelLaunchGridWitness --instantiates--> KernelVariantIdentity`
- `HostAttentionLaunch --correlates_via--> CUPTICorrelationWitness`
- `CUPTICorrelationWitness --identifies--> GPUKernelActivityWitness`
- `GPUKernelActivityWitness --observes?--> RuntimeKVReadWitness`
- `SourceReadClosureWitness --requires_runtime_validation--> RuntimeKernelCorrelationWitness`

## 本輪結束判定

缺哪一層：`source-level exact KV read closure → runtime launch/CUPTI correlation → intervention fence`。

哪個節點最淺：`RuntimeKernelCorrelationWitness`；source-level consumer mapping已明顯加深，但尚未在實際GPU worker trace中驗證。

哪個概念仍只是名詞：`RuntimeKVReadWitness`的實測版本，以及最終 `AgentActionCausalBound`。

哪個系統值得讀原始碼：vLLM Triton unified attention + CUDA Graph runner + PyTorch Kineto/CUPTI integration。

哪篇論文/技術來源需追引用：PagedAttention沿 current vLLM kernel演進；CUPTI/Kineto則追 external correlation與CUDA Graph activity correlation。

哪個概念最適合視覺模擬：`Attention Kernel Read Microscope`，因現在已有 deterministic block-table→K/V load公式可畫。

哪個 Agent 架構最值得實作：`State-grounded Planner + Pixel/VisualToken/KV Provenance + Runtime Read Witness + PreAction Causal Evidence Gate`。

本輪的實質進展：上一輪只能證明「KV transfer完成並準備給consumer」，本輪已在 current vLLM source中閉合 consumer如何真正從block table取得physical block並算出K/V load region。下一步不再需要猜 attention kernel讀哪裡，而是要把這個source-level read identity與實際GPU kernel activity在時間上對起來，之後才能對 screenshot-derived visual token做可重現、可歸因的KV intervention。