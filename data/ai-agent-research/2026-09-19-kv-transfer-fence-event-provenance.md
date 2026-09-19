# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 20:51（Asia/Taipei）

主題：vLLM KV Transfer Fence × Residency Event × Kernel-Read Temporal Provenance

## 本小時新發現

本輪承接上一輪 `KVBlockLeaseIdentity → KernelReadEpochIdentity`，不再重複 block allocation，而是深入 vLLM current offloading/transfer path，追 scheduler metadata、canonical KV page mapping、worker async job、completion/fence、KV event stream。核心修正：**BlockStored/BlockRemoved 是 residency metadata witness，不是 CUDA completion fence，也不是 exact kernel-read witness。**

新 system architecture：`Temporal KV Transfer Provenance`。

新 GitHub 深讀：
- `vllm/distributed/kv_transfer/kv_connector/v1/offloading/worker.py`
- `vllm/v1/kv_offload/base.py`
- `vllm/distributed/kv_events.py`
- `vllm/v1/core/block_pool.py`
- `vllm/v1/core/kv_cache_manager.py`

新底層機制：`CanonicalKVCacheTensor / CanonicalKVCacheRef → GPULoadStoreSpec → submit_load/store(job_id) → asynchronous transfer → worker.get_finished() → completed_jobs → scheduler fence/reuse decision`。

## 本小時最重要 5 個發現

### 1. vLLM 已存在 canonical physical-page abstraction【已確認：原始碼】

Offloading worker 在 `register_kv_caches()` 中把各 layer KV tensor 轉成以 block 為第一維的 canonical views，記錄 `page_size_bytes`、storage offset、block stride；packed layout（例如 layer interleave）會把整個 packed manager block視為單一 transfer region。這表示 logical KV → physical tensor layout 中間已存在可插樁的 canonical page boundary。

底層：`Layer KV Tensor → group_kernel_blocks → storage_offset/stride → CanonicalKVCacheTensor → CanonicalKVCacheRef → transfer page`。

重要性：Hermes 不應直接把 `block_id` 當 raw byte address；應以 canonical page + mapping + allocation epoch 建立跨 backend/offload 的 identity bridge。

限制：canonical mapping 是 runtime transfer abstraction，不等於 GPU MMU physical address。

### 2. store/load 是 job-based asynchronous lifecycle【已確認：原始碼】

`OffloadingConnectorWorker` 維護 `_load_jobs[job_id]` 與 deferred `_unsubmitted_store_jobs`。`start_kv_transfers()` 呼叫 `submit_load()`；store 甚至刻意延後到下一 engine step，以避免干擾 token sampling。完成不是 submit 當下，而是 `worker.get_finished()` 回傳 transfer result 後才 `mark_completed(job_id)`。

底層：`Scheduler Plan → job_id → GPULoadStoreSpec → submit → IN_FLIGHT → get_finished → COMPLETED → scheduler metadata`。

重要性：上一輪 `KVResidencyLease.valid_from/valid_until` 必須加入 transfer job state；不能在 submit 時就宣稱 destination bytes 可供 attention kernel 使用。

限制：此層仍是 worker completion abstraction；要證明 exact CUDA stream/event，需要再深入具體 OffloadingWorker backend。

### 3. preemption/reuse 有明確 flush barrier【已確認：原始碼】

current worker 的 `handle_preemptions()` 會把需 flush 的 store jobs提交，接著 `worker.wait(jobs_to_flush)`；註解明確指出 scheduler 以 completed jobs追 store completion，並透過 `jobs_to_flush` 在 block reuse 前建立 fence。這第一次提供 `old lease → transfer completion → reuse` 的 runtime temporal boundary。

因此 Hermes 應新增：`ReuseFenceWitness(job_ids, block_lease, completed_before_reuse)`。

限制：`worker.wait()` 證明 runtime barrier，不自動等同我們已取得 CUDA event timestamp。

### 4. KV events 不能單獨閉合 active ownership 或 kernel timing【已確認：原始碼 + current issue】

`BlockStored` / `BlockRemoved` 包含 block hashes、token ids、medium（GPU/CPU/STORAGE）、group metadata等，適合建立 residency graph；但 current event model沒有 kernel launch ID、CUDA stream ID、allocation epoch。2026-08 的 vLLM feature discussion還指出缺少 `ref_cnt 1→0` 的 `BlockInactive` event，因此 external consumer 無法可靠區分「仍 resident 但無 active request」與「仍 active」。

所以：`KVEventStream ≠ ActiveOwnershipTrace ≠ KernelReadTrace`。

另外 current hybrid/Mamba issue顯示 `BlockStored.token_ids` 與 emitted block hashes 在 skipped null blocks 情況可產生對應歧義，表示 event consumer 必須保留 group/spec與logical index witness，不能盲信 flat token span。

### 5. offload residency 是多階段 state machine，不是 GPU↔CPU boolean【已確認：官方 docs/原始碼】

vLLM current offloading支援 CPU primary tier與 secondary tiers；只有 CPU primary能直接與 GPU交換，secondary tier必須經 CPU staging。GPU↔CPU 使用 asynchronous DMA。`OffloadingManager.lookup()` 還區分 `MISS/HIT/HIT_PENDING/RETRY`；`prepare_load()` 會保護 blocks 不被 eviction，`complete_load()` 後才解除；store 也有 prepare/complete lifecycle。

因此 residency graph 應為：`GPU_RESIDENT → STORE_PREPARED → STORE_IN_FLIGHT → CPU_READY → [SECONDARY_IN_FLIGHT → STORAGE_READY]`，load反向亦然，而不是單一 `medium` 欄位。

## Architecture Breakdown

```text
Visual Token / Logical KV
→ KVBlockLease(epoch)
→ BlockTable / GPU block
→ CanonicalKVCacheRef
→ GPULoadStoreSpec
→ TransferJob(job_id)
   ├─ PREPARED
   ├─ SUBMITTED
   ├─ IN_FLIGHT
   ├─ COMPLETED
   └─ FAILED/RETRY
→ Residency Medium
   ├─ GPU
   ├─ CPU pinned memory
   └─ secondary storage
→ ReuseFenceWitness
→ Scheduler admits/reuses block
→ Attention backend
→ Kernel launch/read
```

關鍵分離：

```text
BlockStored event      = residency/index witness
Transfer completion    = data-ready witness
Reuse fence            = lifecycle ordering witness
Kernel read            = execution witness
Causal intervention    = causal witness
```

## Bottom-Level Logic

Hermes instrumentation 建議：

```text
on_transfer_prepare(job, lease, src, dst)
on_transfer_submit(job, stream/backend)
on_transfer_complete(job, completion_witness)
on_residency_event(hash, group, medium, event_type)
on_reuse_fence(block, old_epoch, jobs_to_flush)
on_allocate(block, new_epoch)
on_kernel_launch(layer, request, block_table_version)
on_kernel_read(slot, lease_epoch)
```

新增 `KVTransferWitness`：

```text
KVTransferWitness {
  job_id,
  canonical_kv_identity,
  source_lease,
  source_medium,
  destination_medium,
  gpu_block_ids[],
  group_ids[],
  canonical_page_refs[],
  state,
  submitted_step,
  completed_step,
  transfer_bytes,
  transfer_time,
  completion_kind
}
```

新增 `KernelReadEpochIdentity` 最低要求：

```text
(request_id, model_step, layer, kv_group, block_table_version,
 block_id, allocation_epoch, slot_range, kernel_launch_id)
```

## Visual Simulation Idea

### KV Transfer Fence × Kernel Timeline Simulator

Console 顯示四條同步 timeline：Scheduler、GPU KV、CPU/Storage、Attention Kernel。

點一個 Visual Token 可以看到：

```text
S417
→ lease B91:E17
→ store job J44
→ CPU transfer IN_FLIGHT
→ completion J44
→ GPU lease release
→ later load J73
→ GPU B12:E31
→ completion J73
→ kernel K882 reads B12:E31
```

如果 kernel launch 發生在 load completion witness 前，標紅 `READ_BEFORE_READY`；如果 kernel witness epoch 與 block current epoch不同，標紅 `STALE_LEASE_READ`；如果只有 BlockStored event而沒有 transfer completion，顯示 `RESIDENCY_METADATA_ONLY`。

## Code / GitHub

值得繼續追：
- `vllm/distributed/kv_transfer/kv_connector/v1/offloading/worker.py`：job submit/finish/flush。
- `vllm/v1/kv_offload/base.py`：canonical tensor/page、OffloadKey、lookup/prepare/complete state semantics。
- `vllm/distributed/kv_events.py`：BlockStored/Removed/AllBlocksCleared event schema。
- `vllm/v1/core/block_pool.py`：event emission與 lease lifecycle。
- 下一層：具體 OffloadingWorker backend，找 `cudaMemcpyAsync`、CUDA event/stream、wait implementation。

## Papers

### The Illusion of Equivalence: Systematic FP16 Divergence in KV-Cached Autoregressive Inference
- Authors: Ranjith Chodavarapu, Lei Xu
- Year: 2026
- URL: https://arxiv.org/abs/2604.15409
- Architecture: cached vs cache-free autoregressive inference comparison；layer-wise drift + activation patching。
- Contribution: 報告 FP16 cache-ON/cache-OFF 因浮點累加順序產生 deterministic divergence；FP32 control大幅降低差異。
- 改變了什麼：Hermes 的 causal experiment不能假設「recompute baseline」天然等價於「原 KV cache path」；介入實驗必須固定 precision/kernel/backend。
- Limitation: 需要更多模型/硬體/serving backend replication，不能泛化成所有 KV runtime必然相同幅度 divergence。

### HiKV: Hierarchical Importance-Aware KV Cache with Hardware Acceleration for LLM Decoding
- Authors: Chao Fang, Jun Yin, Man Shi, Marian Verhelst
- Year: 2026
- URL: https://arxiv.org/abs/2607.22389
- Architecture: token-level eviction + element-level selective loading + dedicated importance sorter。
- Contribution: 說明未來 kernel read set甚至可能不是完整 token KV；physical provenance需要 element/sub-page granularity。
- Limitation: specialized accelerator / approximate compression，不能直接映射到 vanilla vLLM exact KV semantics。

## Unknown / Open Questions

1. vLLM current concrete CUDA offloading worker用哪個 CUDA stream/event物件標記 DMA completion，`worker.get_finished()/wait()` 如何映射到該 event？
2. attention kernel launch前，scheduler/worker是否存在可直接取得的 block-table version或 step generation，足以把 kernel read綁定到 lease epoch？
3. 在 KV intervention（zero/replace）時，如何避免 cache-ON vs recompute FP16 numerical-path差異被誤判為 intervention causal effect？

## 下一輪研究

```text
OffloadingWorker concrete backend
→ cudaMemcpyAsync / torch copy_
→ CUDA stream
→ CUDA event
→ wait/get_finished
→ scheduler completed_jobs
→ reuse fence
→ attention launch
→ block-table snapshot/version
→ exact KernelReadEpochIdentity
→ controlled KV zero/replace
→ attention output delta
→ residual/logit delta
→ generated action-token delta
```

優先閉合 `TransferCompletionWitness → KernelLaunchWitness`，並建立第一個可重現的 KV causal intervention protocol。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `CanonicalKVPageIdentity`
- `CanonicalKVCacheRefWitness`
- `KVTransferJobIdentity`
- `KVTransferPreparedState`
- `KVTransferInFlightState`
- `KVTransferCompletionWitness`
- `KVResidencyEventWitness`
- `KVResidencyPendingState`
- `ReuseFenceWitness`
- `BlockTableVersionWitness`
- `ReadBeforeReadyFailure`
- `ResidencyMetadataOnlyState`
- `KernelReadEpochIdentity`
- `NumericalPathEquivalenceGate`

新增 Edges：
- `KVBlockLeaseIdentity --MAPPED_TO--> CanonicalKVPageIdentity`
- `CanonicalKVPageIdentity --TRANSFERRED_BY--> KVTransferJobIdentity`
- `KVTransferJobIdentity --COMPLETED_BY--> KVTransferCompletionWitness`
- `KVTransferCompletionWitness --ENABLES--> DestinationResidencyLease`
- `ReuseFenceWitness --ORDERS_BEFORE--> NewAllocationEpoch`
- `KVResidencyEventWitness --DESCRIBES--> PhysicalResidency`
- `KVResidencyEventWitness --DOES_NOT_PROVE--> KernelReadEpochIdentity`
- `KernelLaunchWitness --MUST_READ--> MatchingLeaseEpoch`
- `KVInterventionWitness --REQUIRES--> NumericalPathEquivalenceGate`

## 本輪結論

- 缺哪一層：`TransferCompletionWitness → exact CUDA stream/event → attention KernelLaunchWitness`。
- 哪個節點最淺：`BlockTableVersionWitness / KernelLaunchWitness correlation`。
- 哪個概念仍只是名詞：`KVInterventionWitness → LogitCausalBound`。
- 哪個系統值得讀原始碼：vLLM concrete OffloadingWorker backend + attention launch path。
- 哪篇論文需追引用：The Illusion of Equivalence，尤其 KV cache numerical-path divergence / activation patching follow-ups。
- 哪個概念最適合視覺模擬：KV Transfer Fence × Kernel Timeline Simulator。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Multimodal Provenance + Temporal KV Provenance + PreAction Verifier + Persistent Outcome Verifier`。

本輪把 Hermes 從「知道 KV block 在哪一代 lease」推進成「知道它何時正在搬、何時完成、何時才允許 reuse」。下一個硬邊界是把 runtime completion fence 精確接到 attention kernel launch，之後才有資格做不混入 race/numerical-path誤差的 KV causal intervention。