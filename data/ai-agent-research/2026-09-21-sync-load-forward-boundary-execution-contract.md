# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-21 11:55（Asia/Taipei）  
**本輪主題**：KV Sync-Load Admission × Forward Boundary × CUDA Graph/Eager Execution Contract  
**研究定位**：接續前輪 `ExecutionSynchronizationContract`，不再重複 RDMA/CQ/visibility，而是追 `scheduler → connector pre_forward → start_load_kv → attention decorator → graph/eager boundary → post_forward` 的 exact runtime control edge。

## 本小時新發現

### 新架構：vLLM 的「同步 load / 非同步 load」已成為 scheduler-to-runner correctness bit
current vLLM `SchedulerOutput.has_sync_kv_loads` 明確表示：本 step 是否有 request 會消費 connector 在該 step 同步載入的 KV。ActiveKVConnector 在 `pre_forward()` 綁定 metadata；若該 bit 為 true，立即 `_start_load_kv()`，因此 load submission 在 forward 前發生。若為 false，load submission 被延後到 `post_forward()`，目的在把 CPU-side submission cost 藏到 GPU compute 後面。

這表示 `start_load_kv` 的時間位置不是 connector 自己任意決定，而是 scheduler metadata + runner lifecycle 共同形成的 execution contract。

### 新底層機制：layerwise hook 的真正位置是 attention function 外層
`maybe_transfer_kv_layer` decorator 的 exact call order 已確認：

`resolve layer → get attention context → connector.wait_for_layer_load(layer) → attention func → connector.save_kv_layer(layer)`

因此真正的 layer-readiness gate 就在 attention invocation 前，而不是 request completion 後的泛化 barrier。

### 新 execution boundary：Breakable CUDA Graph 對 decorator order 有 correctness 要求
vLLM `breakable_cudagraph.py` 明確要求 `@eager_break_during_capture` 必須放在 `@maybe_transfer_kv_layer` 外層。原因是 connector 的 `wait_for_layer_load/save_kv_layer` 是 host-side side effects，必須在 eager segment 執行；若 decorator order 反轉，side effects 會被錯誤納入 capture/replay，甚至 hang。

這讓 `DecoratorTopology` 成為新的 execution provenance 節點，而不是純 Python 寫法細節。

### 新 capability matrix：LMCache layerwise 明確要求 PIECEWISE；MultiConnector 採 OR join
LMCache `requires_piecewise_for_cudagraph(extra_config)` 在 `use_layerwise=true` 時回傳 true，理由就是 layerwise async synchronization 不能被 CUDA Graph capture。MultiConnector 則逐 child connector 檢查，只要任何 child 要求 PIECEWISE，aggregate capability 就是 PIECEWISE_REQUIRED。

### 新研究：ObjectCache 與 HiSparse 將 layerwise readiness 推向不同方向
ObjectCache（Yu Zhu, Aditya Dhakal, Yunming Xiao, Dejan Milojicic, Gustavo Alonso, 2026）以 NIXL + object storage 按 GPU layer 消費順序送 KV，在 100Gbps RoCE prototype 中，64K context 相對 local DRAM 增加約 5.6% latency；共享頻寬下 scheduler 將 added TTFT 降低 1.2–1.8×。HiSparse（Zhiqiang Xie et al., Stanford/Meta/Alibaba, 2026）則把 sparse-attention selected KV 的 hit detection、LRU replacement、host→device fetch 融入 decode CUDA graph，並以 layer-wise prefetch 隱藏部分 miss overhead。兩者共同說明：`LayerReadiness` 不是單一 connector callback，而可以由 storage scheduling 或 graph-internal fetch 生產。

## 本小時最重要 5 個發現

### 1. SyncLoadAdmissionEpoch
**是什麼**：scheduler 宣告「這個 forward 前必須完成/啟動同步 KV load」的 epoch。  
**底層**：`SchedulerOutput.has_sync_kv_loads → ActiveKVConnector.pre_forward → _start_load_kv → model forward`。  
**重要性**：它決定 load 是 forward dependency 還是下一輪/背景 overlap work。  
**限制**：bit 本身不證明 device visibility，只證明 host runtime 的 submission ordering。

### 2. LayerAttentionReadinessGate
**底層**：`wait_for_layer_load(L) → attention(L) → save_kv_layer(L)`。  
**重要性**：將 request-level readiness縮小成 exact layer consumption boundary。  
**限制**：不同 connector 的 `wait_for_layer_load` evidence strength 不同；no-op 不能被誤認為 device barrier。

### 3. DecoratorTopologyWitness
**底層**：`eager_break_during_capture(maybe_transfer_kv_layer(attention))` 才能讓 connector side effects位於 eager island。  
**重要性**：Python decorator ordering 會改變 CUDA execution semantics。  
**限制**：只適用 breakable graph path；FULL/PIECEWISE還需各自的 runtime-mode evidence。

### 4. ConnectorCapabilityJoin
**底層**：MultiConnector 對 child `requires_piecewise_for_cudagraph` 做 OR reduction。  
**重要性**：多 connector 系統的 correctness capability由最嚴格 child決定，而非平均。  
**限制**：目前這個 API主要表達 PIECEWISE requirement，尚不足以描述 visibility、device-event、RDMA ordering等完整能力。

### 5. LayerReadinessProducerType
新的 taxonomy：
- `PRE_FORWARD_SYNC_LOAD`
- `LAYERWISE_EAGER_WAIT`
- `GRAPH_INTERNAL_FETCH`
- `BACKGROUND_ASYNC_FOR_FUTURE_STEP`
- `UNVERIFIED`

這能把 LMCache layerwise、ObjectCache storage schedule、HiSparse graph-internal fetch放入同一知識圖譜，而不錯誤假設它們共享同一 barrier substrate。

## Architecture Breakdown

```text
Scheduler
  │
  ├─ build connector metadata
  ├─ derive has_sync_kv_loads
  ▼
ActiveKVConnector.pre_forward
  ├─ handle_preemptions
  ├─ bind_connector_metadata
  ├─ [sync?] start_load_kv
  ▼
Model Forward
  ▼
Attention Layer L
  ├─ eager/breakable boundary
  ├─ wait_for_layer_load(L)
  ├─ ATTENTION(L)
  └─ save_kv_layer(L)
  ▼
post_forward
  ├─ [async?] start_load_kv
  ├─ wait_for_save
  ├─ get_transfer_results
  └─ clear_connector_metadata
```

關鍵是兩條不同 lifecycle：

```text
SYNC CONSUMED THIS STEP
metadata → start_load_kv → layer gate → attention

ASYNC / FUTURE WORK
metadata → forward → start_load_kv → transfer progress → later admission
```

不能把兩條線都畫成 `start_load_kv → attention`。

## Bottom-Level Logic

新的 `AttentionReadable(request, layer, invocation)`：

```text
SchedulerAdmissionWitness
∧ SyncLoadPlacementCompatible
∧ ConnectorMetadataEpochMatches
∧ LayerReadinessProducerKnown
∧ ExecutionModeCompatible
∧ DecoratorTopologyValid
∧ SynchronizationBoundaryExecuted
∧ KVLeaseEpochValid
∧ TranslationEpochValid
∧ Visibility/OrderingContractSatisfied
∧ AttentionLaunchAfterGate
```

新否定關係：

```text
has_sync_kv_loads
  --does_not_prove→ DeviceReadableKV

wait_for_layer_load_called
  --does_not_prove→ DeviceBarrierSatisfied

FULL/PIECEWISE mode selected
  --does_not_prove→ ConnectorSideEffectsExecuted

TransportComplete
  --does_not_prove→ CurrentForwardConsumesTransferredKV
```

## Visual Simulation Idea

### Forward Boundary × Layer Readiness Timeline Viewer
五條同步時間軸：

```text
Scheduler       metadata ─ sync-bit ────────────────
Connector       bind ─ start_load ───── wait(L18) ─ save
CUDA Graph      SEG-A ─────┐          ┌──── SEG-B
Eager Island              wait→ATTN
KV Memory       transfer ─ visible ─ READ ─ updated
```

互動開關：`has_sync_kv_loads`、FULL/PIECEWISE/BREAKABLE、LMCache layerwise、decorator order、connector wait no-op/real barrier、KV lease reuse。

Failure states：
- `SYNC_LOAD_STARTED_AFTER_CONSUMING_FORWARD`
- `CONNECTOR_METADATA_EPOCH_MISMATCH`
- `DECORATOR_TOPOLOGY_INVALID`
- `LAYER_WAIT_CAPTURED_INSTEAD_OF_EAGER`
- `WAIT_CALLED_BUT_BARRIER_SUBSTRATE_UNKNOWN`
- `ASYNC_LOAD_MISATTRIBUTED_TO_CURRENT_FORWARD`

## Code / GitHub

### vLLM
值得繼續看的核心檔案：
- `vllm/v1/worker/gpu/kv_connector.py` — ActiveKVConnector pre/post-forward lifecycle。
- `vllm/v1/worker/kv_connector_model_runner_mixin.py` — legacy/current mixin lifecycle，明確區分 sync load before forward 與 async load after forward。
- `vllm/model_executor/layers/attention/kv_transfer_utils.py` — exact layer gate。
- `vllm/compilation/breakable_cudagraph.py` — eager break 與 decorator topology。
- `vllm/distributed/kv_transfer/kv_connector/v1/base.py` — connector contract。
- `vllm/distributed/kv_transfer/kv_connector/v1/lmcache_connector.py` — layerwise→PIECEWISE capability。
- `vllm/distributed/kv_transfer/kv_connector/v1/multi_connector.py` — child capability OR join。

本輪讀取的 vLLM commit snapshot：`9a70c233cd5d3ef3b14d79c582a6f9ddfa03cf80`。

## Papers

### ObjectCache: Layerwise Object-Storage Retrieval for KV Cache Reuse
- Authors: Yu Zhu, Aditya Dhakal, Yunming Xiao, Dejan Milojicic, Gustavo Alonso
- Institution: ETH Zürich / HPE Labs / CUHK-Shenzhen（依公開作者資訊）
- Year: 2026
- URL: https://arxiv.org/abs/2605.22850
- Code/Systems: NIXL + Ceph RGW + DAOS prototype；本輪未確認官方獨立 code repo
- Dataset/Workload: long-context prefix-KV reuse workloads
- Architecture: object storage → ordered layerwise retrieval → GPU consumption
- Contribution: storage protocol與transfer scheduling共同設計，依 layer consumption順序供應 KV
- Limitation: 短 context可隱藏的 compute較少，4K context仍有 56–75ms added latency
- 改變了什麼：證明 layerwise readiness producer可以位於 storage scheduler，而不只在 local connector。

### HiSparse: Scaling Sparse-Attention Decoding with Hierarchical KV Cache Management
- Authors: Zhiqiang Xie et al.
- Institution: Stanford / Meta / Alibaba Group
- Year: 2026
- URL: https://arxiv.org/abs/2608.07009
- Architecture: host full-history KV + bounded GPU cache + fused CUDA graph selection/fetch + layerwise prefetch
- Contribution: 將 sparse attention KV selection與hierarchical cache搬進 decode runtime
- Limitation: 聚焦 sparse-attention serving，不能直接泛化到 dense full-attention connector
- 改變了什麼：顯示 readiness甚至可以由 graph-internal fused fetch產生，因此 `eager wait` 不是唯一正確形態。

## 已確認 / 推論分級

**已確認原始碼事實**：vLLM sync-load placement、attention decorator order、breakable graph decorator constraint、LMCache PIECEWISE requirement、MultiConnector capability OR join。

**論文結果**：ObjectCache與HiSparse上述 performance/architecture敘述。

**工程推論**：Hermes 應將 `SyncLoadAdmissionEpoch`、`DecoratorTopologyWitness` 與 `LayerReadinessProducerType` 納入 provenance；這是基於已確認 control flow建立的模型，不是 vLLM 官方命名。

**尚未驗證假說**：對所有 NIXL/Mooncake/MoRIIO mode都能以同一 execution-contract schema完整描述；需要下一輪逐 connector驗證。

## Unknown / Open Questions

1. scheduler 在哪些 connector/load-mode組合精確設定 `has_sync_kv_loads`，是否可能同一 batch混合 sync/async requests，aggregate bit 如何映射到 request-level provenance？
2. Breakable CUDA Graph replay時，eager attention island前後的 static-buffer generation與 connector metadata epoch是否存在可直接觀測的 identity？
3. HiSparse 類 graph-internal fetch若與外部 connector同時存在，`LayerReadinessProducerType` 應採 union、priority還是 explicit dependency DAG？

## Knowledge Graph 新增 Node / Edge

Nodes:
- `SyncLoadAdmissionEpoch`
- `ForwardConsumptionEpoch`
- `LayerAttentionReadinessGate`
- `DecoratorTopologyWitness`
- `LayerReadinessProducerType`
- `AsyncLoadSubmissionEpoch`
- `ConnectorMetadataEpoch`
- `EagerSideEffectExecutionWitness`
- `CurrentForwardConsumptionWitness`

Edges:
- `has_sync_kv_loads --controls→ LoadSubmissionPlacement`
- `SyncLoadAdmissionEpoch --must_precede→ ForwardConsumptionEpoch`
- `wait_for_layer_load(L) --gates→ AttentionInvocation(L)`
- `DecoratorTopologyWitness --enables→ EagerSideEffectExecutionWitness`
- `AnyChildPiecewiseRequired --forces→ MultiConnectorPiecewiseRequired`
- `AsyncLoadSubmissionEpoch --does_not_imply→ CurrentForwardConsumptionWitness`

## 本輪結束判斷

- **缺哪一層**：scheduler request-level load mode → aggregate `has_sync_kv_loads` → individual request/layer consumption 的 mapping。
- **哪個節點最淺**：`CurrentForwardConsumptionWitness`。
- **哪個概念仍只是名詞**：`ObservedPhysicalKVReadSet`，仍缺逐 GPU load observation。
- **哪個系統值得讀原始碼**：vLLM scheduler `has_sync_kv_loads` producer、HiSparse fused CUDA fetch path。
- **哪篇論文需追引用**：HiSparse，因為它把 fetch 放進 decode CUDA graph，正好是前幾輪「graph外同步」模型的重要對照組；ObjectCache則追 layerwise scheduling。
- **哪個概念最適合視覺模擬**：Forward Boundary × Layer Readiness Timeline Viewer。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + Runtime Provenance Verifier + Forward Consumption Mapper + Execution Synchronization Contract Verifier + Connector Capability Adapter + Transport/Visibility Frontier Verifier + Residency/Lease Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。

## 下一輪研究

```text
vLLM scheduler
→ request.load_async / connector metadata
→ has_sync_kv_loads aggregation
→ per-request CurrentForwardConsumptionWitness
→ ActiveKVConnector pre_forward
→ CUDAGraphDispatcher runtime mode
→ breakable/eager attention boundary
→ wait_for_layer_load exact backend barrier
→ AttentionInvocationEpoch
→ VisibleLogicalPositionSet
→ ExpectedPhysicalKVReadSet
→ ZERO / REPLACE selected KV
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔToken
→ ΔAgentAction
```

下一輪同時建立 `LMCache / NIXL / Mooncake / MoRIIO / HiSparse` 的 `LayerReadinessProducer × GraphMode × LoadPlacement × BarrierSubstrate` capability matrix。
