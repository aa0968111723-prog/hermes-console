# 【AI Agent × Multimodal Research Report】

時間：2026-09-21 12:56（Asia/Taipei）

主題：Forward Consumption Epoch × Scheduler Admission × Async/Sync KV Dependency Mapping

## 本小時新發現

本輪延續上一輪 `CurrentForwardConsumptionWitness`，不再重複 CUDA Graph / RDMA visibility，而是把 vLLM scheduler 的 request-level remote KV decision 一路追到 worker forward admission。核心新結論：`has_sync_kv_loads` 是 batch-level OR gate，不是 per-request readiness proof；真正可驗證的 consumption provenance 必須保存 request → external token range → load mode → scheduler step → connector metadata → worker pre_forward → layer gate 的映射。

已確認 current vLLM scheduler 在 fresh admission 時先取得 local prefix hit，再呼叫 connector `get_num_new_matched_tokens(request, block_aligned_local)`，回傳 `(ext_tokens, load_kv_async)`；如果 external hit 存在且 `load_kv_async=True`，本 step 將 `num_new_tokens=0`，配置 blocks 後把 request 置為 `WAITING_FOR_REMOTE_KVS`，本輪不執行 forward。若 external hit 存在但 `load_kv_async=False`，request 直接進 RUNNING，並把 batch-level `has_sync_kv_loads=True`。

worker 端 `ActiveKVConnector.pre_forward()` 先 bind 本 step connector metadata；只有 `has_sync_kv_loads=True` 才在 forward 前呼叫 `_start_load_kv()`。沒有 sync load 時，pending load 會延後到 `post_forward()`，因此其 submission 不應被歸因為本次 forward 的依賴。

async path 則形成兩階段 admission：Step N 只配置 remote-load destination blocks 並進入 `WAITING_FOR_REMOTE_KVS`；worker connector 回報 `finished_recving` 後，scheduler 下一次 promotion 才 `_update_waiting_for_remote_kv()`、cache valid blocks、將 request 轉回 WAITING/PREEMPTED，之後才可能在 Step N+k 真正進入 forward。

這表示 `TransferEpoch` 與 `ForwardConsumptionEpoch` 是不同 epoch，兩者可能跨多個 scheduler steps。

## 本小時最重要 5 個發現

### 1. `has_sync_kv_loads` 是 batch-level gate，不是 request-level witness

已確認事實 / 工程實作：scheduler 初始化 `has_sync_kv_loads=False`；只要本 step 任一被直接 admitted 的 request 有 `num_external_computed_tokens > 0` 且不是 async load，就設為 True。SchedulerOutput 只攜帶這個 aggregate boolean。

底層：
`request external hit → load_kv_async=False → request RUNNING → has_sync_kv_loads=True → SchedulerOutput → worker pre_forward → start_load_kv before forward`

限制：boolean 沒有指出是哪個 request、哪些 external token、哪些 layer 真正消費 remote KV。

### 2. Async remote KV load 的 scheduler step 不執行 model forward

已確認事實 / 工程實作：`load_kv_async=True` 時 scheduler 設 `num_new_tokens=0`，配置 destination blocks，request 進 `WAITING_FOR_REMOTE_KVS` 並 `continue`。因此 load-admission step 與 consumption-forward step 明確分離。

新的否定 edge：
`AsyncLoadAdmissionEpoch --does_not_equal→ ForwardConsumptionEpoch`

### 3. `finished_recving` 只重新取得 scheduling eligibility

worker-side connector completion 進入 Scheduler 後，request 必須先經 `_update_waiting_for_remote_kv()`；valid blocks 被 cache，failure 時 token count 會截短或釋放 blocks，full prompt hit 還會 rewind 最後 token / replay window。之後 request 才回 WAITING 或 PREEMPTED。

因此：
`finished_recving → PromotionEligibilityWitness → CacheCommit/Rewind → WAITING → future schedule → ForwardConsumptionEpoch`

而不是：
`finished_recving → immediate Attention read`。

### 4. CurrentForwardConsumptionWitness 必須是 per-request/per-range，而不是 batch boolean

合理建模：
`CurrentForwardConsumptionWitness = (request_id, scheduler_step_seq, connector_metadata_epoch, external_token_range, block_generation, load_mode, forward_epoch)`。

其中 `load_mode ∈ {SYNC_CURRENT_FORWARD, ASYNC_FUTURE_FORWARD, NO_EXTERNAL_LOAD}`。

這能避免 batch 裡 A request 的 sync load 導致 `has_sync_kv_loads=True`，卻錯誤地把 B request 的 async/future load也歸因為 current forward。

### 5. Async scheduling 本身也是 residency reservation contract

current scheduler 對 async load 設 `delay_cache_blocks=True`，並把 request 加入 `_inflight_prefills`；它還保留 blocks，避免 transfer 尚未完成時被其他工作搶走。這表示 async remote load 不只是 I/O state，而是 scheduler resource state。

新的模型：
`AsyncLoadAdmissionEpoch → DestinationBlockReservationEpoch → TransferEpoch → CompletionPromotionEpoch → CacheCommitEpoch → ForwardConsumptionEpoch`。

## Architecture Breakdown

```text
Request arrives
  ↓
Local prefix lookup
  ↓
Connector external lookup
  ↓
(ext_tokens, load_kv_async)
  ├─ ext=0
  │    → local/recompute path
  │
  ├─ ext>0, async=False
  │    → allocate destination blocks
  │    → update_state_after_alloc
  │    → RUNNING
  │    → has_sync_kv_loads=True
  │    → SchedulerOutput
  │    → bind_connector_metadata
  │    → start_load_kv BEFORE forward
  │    → layer readiness gate
  │    → Attention
  │
  └─ ext>0, async=True
       → allocate destination blocks
       → delay cache publication
       → WAITING_FOR_REMOTE_KVS
       → NO FORWARD THIS STEP
       → start async transfer
       → finished_recving
       → validate failures / cache valid prefix
       → WAITING/PREEMPTED
       → later Scheduler step
       → ForwardConsumptionEpoch
       → Attention
```

System architecture implication for Hermes: scheduler provenance is not optional metadata. It is the bridge between transport evidence and model execution evidence.

## Bottom-Level Logic

### Scheduler-level consumption equation

For request r and forward F:

`ConsumesRemoteKV(r,F)` iff:

`Scheduled(r,F)`
`∧ ExternalRange(r) > 0`
`∧ RemoteMaterializationGeneration(r) == BoundBlockGeneration(r,F)`
`∧ ((SyncLoad(r,F) ∧ StartLoadBeforeForward(F)) OR (AsyncLoadCompletedEarlier(r) ∧ CacheCommitBeforeF(r)))`
`∧ LayerReadinessGateSatisfied(r,F,L)`

Batch-level `has_sync_kv_loads(F)` is only:

`OR_r SyncLoad(r,F)`

Therefore:

`has_sync_kv_loads(F) --does_not_identify→ r`

`has_sync_kv_loads(F) --does_not_prove→ LayerReadiness(r,L,F)`

### Async path state machine

`LOOKUP_HIT`
→ `DESTINATION_RESERVED`
→ `WAITING_FOR_REMOTE_KVS`
→ `TRANSFER_IN_FLIGHT`
→ `FINISHED_RECV_SIGNAL`
→ `VALID_PREFIX_COMMITTED`
→ `WAITING/PREEMPTED`
→ `SCHEDULED_FOR_COMPUTE`
→ `FORWARD_CONSUMPTION`

這裡至少有 4 個不同 epoch：Allocation / Transfer / CacheCommit / ForwardConsumption。

## Visual Simulation Idea

### Scheduler → Transfer → Forward Consumption Causal Viewer

四條同步時間軸：

```text
Scheduler  S101 lookup ─ reserve ─ WAIT_REMOTE ─ S104 promote ─ S105 RUN
Connector       submit ═══════════ finished_recv
KV Blocks       Lease8 ═ write ═══ commit/gen8 ═════════════════════
GPU Forward     [ none ]                         F77 → L0 → ... → L18
```

點擊 request 可顯示：
- external token range
- local/external hit boundary
- `load_kv_async`
- scheduler step seq
- block IDs + generation
- connector metadata epoch
- transfer epoch
- cache commit epoch
- consuming forward epoch
- per-layer readiness

故障注入：
- 把 async load 錯標成 current-forward dependency → `ASYNC_LOAD_FALSE_CAUSAL_ATTRIBUTION`
- completion 到了但 block generation 已變 → `COMPLETION_BLOCK_GENERATION_MISMATCH`
- batch sync bit=True 但 request 沒 external range → `BATCH_GATE_NOT_REQUEST_WITNESS`
- request promotion 後未 cache valid prefix → `PROMOTION_WITHOUT_CACHE_COMMIT`
- current forward 使用的 metadata epoch 與 scheduler admission不一致 → `FORWARD_METADATA_EPOCH_MISMATCH`

## Code / GitHub

### vLLM scheduler
值得繼續看的核心檔案：
- `vllm/v1/core/sched/scheduler.py`
  - external prefix lookup
  - `load_kv_async`
  - `WAITING_FOR_REMOTE_KVS`
  - `has_sync_kv_loads`
  - `_update_waiting_for_remote_kv`
  - `_try_promote_blocked_waiting_request`
- `vllm/v1/worker/gpu/kv_connector.py`
  - `ActiveKVConnector.pre_forward`
  - `_start_load_kv`
  - `post_forward`
- `vllm/distributed/kv_transfer/kv_connector/v1/base.py`
  - connector metadata / load contract
- connector-specific `update_state_after_alloc` / `start_load_kv` / `wait_for_layer_load`

### Important implementation contrast
HiSparse can force `scheduler_output.has_sync_kv_loads=True` because its worker state must be rebound before forward. This reinforces that the bit is an execution-placement requirement, not a universal KV-readiness proof.

## Papers

### ObjectCache: Layerwise Object-Storage Retrieval for KV Cache Reuse
- Authors: Yu Zhu, Aditya Dhakal, Yunming Xiao, Dejan Milojicic, Gustavo Alonso
- Year: 2026
- Architecture: layerwise object-storage KV retrieval, NIXL, S3-compatible storage, compute/transfer overlap
- Dataset/workload: long-context serving experiments including 64K contexts
- Contribution: storage server sends KV in GPU layer-consumption order; scheduler coordinates shared bandwidth
- Result: 64K context adds ~5.6% latency over local DRAM; shared-bandwidth scheduler reduces added TTFT 1.2–1.8×
- Limitation: paper-level scheduling evidence does not itself prove vLLM per-request forward consumption epochs.
- URL: https://arxiv.org/abs/2605.22850

### Tutti: Making SSD-Backed KV Cache Practical for Long-Context LLM Serving
- Authors: Shi Qiu, Yifan Hu, Xintao Wang, Wenhao Zhu, Jianqin Yan, Hao Chen, Kaiqiang Xu, Kai Chen, Yiming Zhang
- Year: 2026
- Architecture: GPU-centric KV object store + GPU io_uring + slack-aware I/O scheduling
- Contribution: moves SSD I/O control/data path away from CPU-critical path; asynchronous per-layer GPU I/O
- Result: reports 78.3% TTFT reduction vs GDS-enabled SSD-backed LMCache under strict SLOs and 2× achievable request rate
- Limitation: GPU-native I/O introduces a different readiness producer; cannot assume host scheduler callbacks are the causal boundary.
- URL: https://arxiv.org/abs/2605.03375

本輪 paper 對比的重要改變：ObjectCache代表 scheduler-driven layer consumption ordering；Tutti代表 GPU-native I/O control。Hermes 的 Knowledge Graph 因此必須把 readiness producer type 與 forward consumption epoch分開建模。

## Unknown / Open Questions

1. `kv_connector_metadata` 是否已攜帶足夠資訊，能無歧義重建每個 request 的 external token range → exact physical blocks → consuming forward？若不足，Hermes instrumentation需新增 provenance ID。
2. MultiConnector 中 batch-level sync gate與 child-specific async/sync load混合時，如何建立 child connector → request → range 的 attribution，而不被 aggregate boolean污染？
3. 下一個真正的底層缺口仍是 `ExpectedPhysicalKVReadSet → ObservedPhysicalKVReadSet`：需要 attention backend / paged-KV address translation 與 kernel instrumentation。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `SchedulerAdmissionEpoch`
- `ExternalTokenRange`
- `SyncLoadBatchGate`
- `AsyncLoadAdmissionEpoch`
- `DestinationBlockReservationEpoch`
- `CompletionPromotionEpoch`
- `CacheCommitEpoch`
- `ForwardConsumptionEpoch`
- `RequestForwardDependencyWitness`
- `BatchGateAttributionState`
- `AsyncLoadFalseCausalAttributionState`
- `ForwardMetadataEpochMismatchState`

### Edges
- `ExternalPrefixHit --selects→ LoadMode`
- `SyncCurrentForwardLoad --contributes_to→ SyncLoadBatchGate`
- `SyncLoadBatchGate --orders→ StartLoadBeforeForward`
- `AsyncLoadAdmissionEpoch --reserves→ DestinationBlockReservationEpoch`
- `AsyncLoadAdmissionEpoch --does_not_equal→ ForwardConsumptionEpoch`
- `FinishedRecvSignal --enables→ CompletionPromotionEpoch`
- `CompletionPromotionEpoch --precedes→ CacheCommitEpoch`
- `CacheCommitEpoch --may_precede_by_many_steps→ ForwardConsumptionEpoch`
- `SyncLoadBatchGate --does_not_identify→ RequestForwardDependencyWitness`
- `RequestForwardDependencyWitness --gates→ LayerAttentionReadinessGate`

## 與歷史研究比較

前幾輪已建立：Transfer completion → GPU visibility → CUDA ordering → Graph/Eager synchronization → Layer gate。本輪補上的不是另一個 transport primitive，而是其上游 causal attribution：**哪一份 remote KV、在什麼 scheduler step被 admitted、是否本 step forward真的消費它。**

因此 provenance 主鏈更新為：

`Semantic KV Content`
→ `ExternalPrefixMatch`
→ `SchedulerAdmissionEpoch`
→ `DestinationBlockReservationEpoch`
→ `TransferEpoch`
→ `Visibility/Ordering Frontier`
→ `CompletionPromotionEpoch`
→ `CacheCommitEpoch`
→ `ForwardConsumptionEpoch`
→ `ConnectorMetadataEpoch`
→ `LayerAttentionReadinessGate`
→ `AttentionInvocationEpoch`
→ `ExpectedPhysicalKVReadSet`
→ `ObservedPhysicalKVReadSet (仍缺)`

## 每輪結束回答

- 缺哪一層：`ForwardConsumptionEpoch → attention backend physical address translation → actual kernel memory read`。
- 哪個節點最淺：`RequestForwardDependencyWitness` 的 physical-block/range instrumentation。
- 哪個概念仍只是名詞：`ObservedPhysicalKVReadSet`。
- 哪個系統值得讀原始碼：vLLM `SchedulerOutput/kv_connector_metadata` builder + MultiConnector attribution；之後進 paged-attention backend。
- 哪篇論文需追引用：Tutti，因為 GPU-native I/O control可能打破 host-centric scheduler/connector readiness假設；ObjectCache繼續追 scheduler-layer consumption coupling。
- 哪個概念最適合視覺模擬：Scheduler → Transfer → Forward Consumption Causal Viewer。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Runtime Provenance Verifier + Request/Forward Dependency Mapper + Execution Synchronization Contract Verifier + Transport/Visibility Frontier Verifier + Residency/Lease Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。

## 下一輪研究

下一輪優先離開 scheduler aggregate bit，往 physical read path推進：

`SchedulerOutput.kv_connector_metadata`
→ per-request block tables
→ model runner input
→ `set_forward_context`
→ attention metadata
→ paged KV block table
→ logical token position → physical block/offset translation
→ attention backend kernel launch
→ expected address/read set
→ instrumentation / ZERO-REPLACE selected KV
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔToken
→ ΔAgentAction

同時建立 `RequestForwardDependencyWitness` 的最小 schema，讓 Hermes Console 可以把 scheduler causal evidence與 GPU evidence join 成同一條可查詢 provenance chain。