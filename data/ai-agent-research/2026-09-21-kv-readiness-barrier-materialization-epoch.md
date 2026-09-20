# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 02:50（Asia/Taipei）

## 本小時新發現
本輪接續上一輪 `External KV → Local Physical Lease → Materialization → Attention Read`，避免重複 CUDA Graph、block reuse 與基本 block-table translation。核心進展是把「transfer 完成」拆成 worker completion、scheduler observation、request state transition、cache registration/readiness 四個事件，並找到 current vLLM scheduler 的明確 admission barrier：request 在 remote KV 尚未 ready 時進入 `WAITING_FOR_REMOTE_KVS`，worker-side connector 透過 `KVConnectorTransferResults.finished_recving` 回報完成；scheduler 接收完成後才走 `_update_waiting_for_remote_kv()`，把已接收 KV 對應到 cache state並讓 request 回到可排程狀態。這使 `KVContentMaterializationEpoch` 可以從抽象概念變成跨 worker/scheduler 的可觀測 state-machine witness。

## 本小時最重要 5 個發現

### 1. `finished_recving` 是 scheduler-visible transfer completion，不等於「看到 remote hit」
**已確認工程實作**：current vLLM `KVConnectorTransferResults` 將 `finished_recving`、`finished_sending`、`failed_recving` 分開；scheduler 的 `update_from_output()` 消費 `finished_recving`，而 connector 自己也先收到 `update_connector_output()`。這表示 external hit discovery 與實際 receive completion 是兩個事件。

Canonical chain：
`ExternalContentMatch → LocalBlockAllocation → WorkerTransferStart → WorkerTransferComplete → KVConnectorOutput.finished_recving → SchedulerCompletionObserved`。

新增否定關係：
`ExternalContentMatch --does_not_prove→ TransferComplete`。

### 2. request state machine 本身就是 KV readability barrier 的一部分
**已確認工程實作**：remote KV 尚未 ready 時，request 會進入 `WAITING_FOR_REMOTE_KVS`；vLLM scheduler source 對 `_update_waiting_for_remote_kv()` 的描述是「async recv finished 後更新 request state；transfer ready 時 cache blocks，request 從 WAITING_FOR_REMOTE_KV 回到 WAITING」。測試也明確驗證 request 在收到 `finished_recving` 前不被排入 model execution。

因此 Hermes 可建立：
`SchedulerKVReadinessBarrier = WAITING_FOR_REMOTE_KVS → finished_recving observed → cache/update validation → WAITING → eligible for schedule`。

這比只在 connector 裡記 transfer timestamp 更強，因為它證明 model scheduler 尚未允許該 request 進入 attention。

### 3. failure completion 也可能出現在 `finished_recving`，所以 completion ≠ successful materialization
**已確認工程實作**：vLLM `KVConnectorTransferResults` 的註解明確說 failed receives 也出現在 `finished_recving`，讓 scheduler 能解除 transfer wait state；同時另以 `failed_recving` 表示失敗。scheduler 有 `recompute` failure policy，測試也驗證 failed receive 後會截斷/重算，而不是把失敗 block當成 readable KV。

所以正確 witness 必須是：
`finished_recving ∧ req_id ∉ failed_recving ∧ valid_block_set ∧ cache-state commit`。

新增：
`TransferCompletionWitness --does_not_prove→ SuccessfulKVMaterialization`。

### 4. async scheduling / overlapping batches 會產生「舊 write 與新 load」競爭，因此 block lifetime barrier必須和 transfer barrier join
**已確認工程實作**：current scheduler 對 consumer connector + multiple inflight batches 特別設定 `defer_block_free`，註解指出：先前 step 可能仍在寫已釋放 request 的 KV block，而 consumer connector可能重新配置並 load同一 blocks；若沒有 ordering，out-of-band load會和舊 write競爭。

因此 production provenance 必須同時滿足：
`PhysicalLeaseValid ∧ NoPriorWriterHazard ∧ TransferSuccess ∧ CacheStateCommitted → LocalReadableKVContentWitness`。

這把前一輪的 `KVLeaseEpoch` 與本輪 `MaterializationEpoch` 真正 join 起來。

### 5. request-level readiness仍太粗；下一層必須是 layer/block granularity
**已確認官方 interface**：connector worker API 有 `start_load_kv(forward_context)` 與 `wait_for_layer_load(layer_name)`；這說明某些 connector 的實際 readiness可能是逐 layer同步，而不是單一 request completion瞬間所有 layer都同時可讀。

因此 `KVContentMaterializationEpoch` 應分層：
`RequestTransferEpoch → LayerMaterializationEpoch → BlockMaterializationEpoch → TranslationCommitEpoch → AttentionReadEpoch`。

對 SmartGen/Lynx 這類 selective/progressive transfer，這個分層尤其重要：request可以開始 decode，但完整 KV payload仍可能尚未全部到齊。

## Architecture Breakdown

### vLLM Remote-KV Readiness State Machine
`Remote semantic hit discovery`
→ `KVCacheManager local block allocation`
→ `connector metadata / handshake`
→ `worker start_load_kv`
→ `async transfer`
→ `worker get_finished`
→ `KVConnectorTransferResults.finished_recving / failed_recving`
→ `ModelRunnerOutput / KVConnectorOutput`
→ `scheduler.update_from_output`
→ `connector.update_connector_output`
→ `finished_recving_kv_req_ids`
→ `_update_waiting_for_remote_kv`
→ `cache blocks / invalid-block recovery`
→ `WAITING_FOR_REMOTE_KVS → WAITING`
→ next scheduler admission
→ model runner
→ per-layer `wait_for_layer_load` if connector requires it
→ attention

### Readability contract
`LocalReadableKVContentWitness =`
`SemanticContentMatch`
+ `PhysicalLeaseGeneration`
+ `TransferCompletionSuccess`
+ `NoPriorWriterHazard`
+ `Layer/BlockMaterialization`
+ `TranslationCommitEpoch`
+ `SchedulerAdmissionEpoch`.

任何一項缺失，都只能說「可能存在 KV」，不能說「這次 attention 已有資格讀取該 KV」。

## Bottom-Level Logic

### Completion state decomposition
對 request `r`：
1. `match(r)`: connector/scheduler知道 remote content存在。
2. `allocate(r)`: 本機 block/lease已保留。
3. `start(r)`: worker啟動 load。
4. `complete(r)`: req_id進 `finished_recving`。
5. `success(r)`: req_id不在 `failed_recving`，且 invalid-block validation通過。
6. `commit(r)`: scheduler/cache manager把成功載入的 blocks納入本地 cache state。
7. `admit(r)`: request離開 `WAITING_FOR_REMOTE_KVS`，重新具備 scheduling資格。
8. `layer_ready(r,l)`: layer `l` 的 connector-specific wait完成。
9. `read(r,l,a)`: attention invocation `a` 可合法使用該 layer的 KV。

因此：
`complete(r) ≠ success(r) ≠ commit(r) ≠ layer_ready(r,l) ≠ read(r,l,a)`。

### Concurrency hazard
若舊 batch `B0` 還可能對 block `P42@Lease7` 寫入，而新 consumer load準備把 remote content寫入同一 physical storage，則單純看到 network/DMA completion不足以證明 content穩定。需要 `PriorWriterQuiesced` 或等價 ordering witness。current vLLM以 consumer + multiple inflight batches時 defer block free避免這類 reuse/load race，證明這不是純理論問題。

## Visual Simulation Idea
### KV Transfer Readiness State-Machine Microscope
左側顯示 request lifecycle：
`REMOTE HIT → ALLOCATED → TRANSFERRING → FINISHED_RECVING → VALIDATED → CACHE_COMMITTED → WAITING → SCHEDULED → LAYER_READY → ATTENTION_READ`。

右側同步顯示 physical block：
`Block42@Lease8`
→ transfer progress
→ writer hazard status
→ materialized layers
→ BlockTable translation epoch
→ actual attention invocation。

錯誤狀態：
- `TRANSFER_COMPLETE_BUT_FAILED`
- `TRANSFER_COMPLETE_NOT_CACHE_COMMITTED`
- `BLOCK_LEASE_CHANGED_DURING_TRANSFER`
- `PRIOR_WRITER_NOT_QUIESCED`
- `REQUEST_READY_LAYER_NOT_READY`
- `TRANSLATION_NOT_COMMITTED`
- `DUPLICATE_COMPLETION_EVENT`

## Code / GitHub
值得持續讀的 current vLLM 原始碼：
- `vllm/distributed/kv_transfer/kv_connector/v1/base.py`: `KVConnectorTransferResults`, `start_load_kv`, `wait_for_layer_load`, scheduler/worker connector contract。
- `vllm/v1/core/sched/scheduler.py`: `WAITING_FOR_REMOTE_KVS`, `finished_recving_kv_req_ids`, `_update_waiting_for_remote_kv`, failure recovery與 `defer_block_free`。
- `vllm/distributed/kv_transfer/kv_connector/v1/nixl/*`: worker completion與scheduler-side heartbeat/push completion。
- `vllm/v1/simple_kv_offload/manager.py`: load completion cleanup，以及store completion需要聚合所有 worker後才commit的例子。
- `tests/v1/kv_connector/unit/test_remote_prefill_lifecycle.py`, `test_invalid_blocks_correctness.py`, `test_kv_load_failure_recovery.py`: state-machine correctness tests。

本輪另發現 current issue #51786 報告 MultiConnector可能跨 scheduler steps重複回報同一 `finished_recving`，造成 assertion；這提醒 Hermes 的 completion witness應使用 `(request_id, transfer_epoch, connector_id)` 去重，而不能只靠 request_id。

## Papers
### SmartGen: Seamless Disaggregated LLM Inference with Selective KV Cache Transfer
Authors: Xuchuan Luo, Jiacheng Shen, Xin Wang, Yangfan Zhou
Year: 2026
URL: https://arxiv.org/abs/2607.28150
Architecture: proactive + on-demand + speculative KV transfer。
Contribution: decode不再必須等待完整 KV一次性搬完；論文報告 TTST最高改善4.3×。
Limitations: request-level `finished_recving` 模型不足以描述 selective subset何時可讀。
Changed: 強化 `PartialMaterializationEpoch`、`ReadableSubsetWitness`。

### Lynx: Progressive Speculative Quantization for accelerating KV Transfer in Long-Context Inference
Authors: Wenchen Han, Gingfung Matthew Yeung, Marco Barletta, William Toner, Amory Hoste, Adam Barker
Year: 2026
URL: https://arxiv.org/abs/2607.01831
Architecture: Anchor high-priority bitstream + Residual refinement stream + speculative decode/verification。
Contribution: challenge「KV必須完整收完才能用」；Anchor到達即可先decode，Residual並行傳輸。
Limitations: readiness不再只是 token/block subset，也可能是 precision subset；semantic KV content需要 `PrecisionMaterializationEpoch`。
Changed: 新增 `ProgressivePrecisionMaterialization` 概念。

### SpectrumKV: Per-Token Mixed-Precision KV Cache Transfer for Prefill-Decode Disaggregated LLM Serving
Author: Yang Pengju
Year: 2026
URL: https://arxiv.org/abs/2606.08635
Architecture: token-wise FP16/INT8/INT4 transfer policy。
Contribution: KV transfer budget從 binary token selection擴展成 per-token precision allocation。
Limitations: INT4 tolerance model-dependent；Qwen2.5-7B在論文設定下不適合 aggressive INT4。
Changed: `ReadableKVSet` 未來需帶 `(token, precision_epoch, verification_state)`，不能只有 token id。

## Unknown / Open Questions
1. `wait_for_layer_load()` 在 NIXL、LMCache、Mooncake、offloading connectors中的實際同步語義是否一致？哪些 connector是真正 per-layer barrier，哪些只是 no-op/全 request barrier？
2. scheduler `cache_blocks`/invalid-block recovery完成後，到 model runner讀取 block table前是否還有另一個 translation-table commit boundary需要獨立觀測？
3. 如何把 transfer epoch與 CUDA stream/event完成、KV DMA visibility、attention kernel launch建立 device-side happens-before，而不只依賴 host scheduler state？

## 下一輪研究
`Connector-specific wait_for_layer_load`
→ NIXL / LMCache / Mooncake / offload differential semantics
→ CUDA stream/event transfer completion
→ device-side happens-before
→ `LayerMaterializationEpoch`
→ `TranslationCommitEpoch`
→ attention visibility branches
→ exact `VisibleLogicalPositionSet`
→ ExpectedPhysicalKVReadSet
→ ZERO/REPLACE selected KV
→ ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction

## Knowledge Graph 新增 Node / Edge
Nodes:
- `WorkerTransferCompletionEpoch`
- `SchedulerCompletionObservedEpoch`
- `SchedulerKVReadinessBarrier`
- `SuccessfulKVMaterializationWitness`
- `LayerMaterializationEpoch`
- `BlockMaterializationEpoch`
- `TranslationCommitEpoch`
- `PriorWriterQuiescenceWitness`
- `ReadableSubsetWitness`
- `PrecisionMaterializationEpoch`
- `DuplicateCompletionState`
- `TransferEpochIdentity`

Edges:
- `WorkerTransferCompletionEpoch → reported_as → finished_recving`
- `finished_recving + !failed_recving → contributes_to → SuccessfulKVMaterializationWitness`
- `SuccessfulKVMaterializationWitness + CacheCommit → permits → WAITING_FOR_REMOTE_KVS→WAITING`
- `SchedulerKVReadinessBarrier → precedes → ModelExecutionAdmission`
- `LayerMaterializationEpoch → precedes → LayerAttentionRead`
- `PhysicalLeaseGeneration + PriorWriterQuiescence → guards → Materialization`
- `ExternalContentMatch --does_not_prove→ TransferComplete`
- `TransferCompletionWitness --does_not_prove→ SuccessfulKVMaterialization`
- `RequestReady --does_not_always_prove→ EveryLayerFullyMaterialized`

## 本輪結束判斷
缺哪一層：connector-specific per-layer/device-side readiness與 CUDA stream/event happens-before。
最淺節點：`LayerMaterializationEpoch` 的跨 connector production witness。
仍只是名詞：`ObservedPhysicalKVReadSet`；host-side readability barrier已更清楚，但還不是逐 load hardware witness。
最值得讀原始碼：NIXL / LMCache / Mooncake worker-side `start_load_kv`、`wait_for_layer_load`、`get_finished`。
需追引用：Lynx，因為它把 materialization從「有/無」改成 progressive precision state；SmartGen則繼續追 selective subset readiness。
最適合視覺模擬：KV Transfer Readiness State-Machine Microscope。
最值得實作的 Agent 架構：`State-grounded Planner + Runtime Provenance Verifier + Transfer/Materialization State Machine + Residency/Lease Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。
