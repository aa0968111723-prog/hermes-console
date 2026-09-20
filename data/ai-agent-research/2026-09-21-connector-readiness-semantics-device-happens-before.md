# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 03:55（Asia/Taipei）

## 本小時新發現
本輪接續上一輪 `LayerMaterializationEpoch → device-side happens-before`，避免重複 scheduler remote-KV state machine、KV lease 與 block-table 基礎。核心結論：vLLM 的 `wait_for_layer_load(layer_name)` 是一個介面名稱，不是統一同步語義。current connectors 至少分成三類：LMCache 真正推進 layerwise retriever；MoRIIO 以 host polling 等待該 layer READ transfer status；NIXL 與 Mooncake facade 則是 no-op，readiness 必須由 request/transfer completion 的其他 barrier 保證。故 Hermes 不可建立 universal `wait_for_layer_load → GPU-readable` edge，而必須以 connector capability + barrier implementation 建模。

## 本小時最重要 5 個發現

### 1. 同一 `wait_for_layer_load` API 背後有不同 barrier semantics
**已確認工程實作**：LMCache adapter 對每個 `layerwise_retriever` 呼叫 `next()`，以 layer 為節拍推進 retrieve pipeline；MoRIIO READ mode則檢查 `_recving_transfers` 中該 layer 的 status，host-side polling直到 success/failure/timeout；NIXL與Mooncake目前直接 `pass`。

因此新增：
`ConnectorReadinessCapability = {REQUEST_SCOPED, LAYER_PIPELINED, HOST_POLLED_LAYER, DEVICE_EVENT_LAYER, NO_LAYER_BARRIER}`。

否定關係：
`wait_for_layer_load_called --does_not_prove→ DeviceReadableKV`。

### 2. MoRIIO 顯示「layer barrier」也可能不是 device-event happens-before
MoRIIO 的 layer wait是 host polling transfer status；而且 FULL CUDA Graph capture 時直接 return，註解明確指出 host-side blocking wait不能在 full-graph capture內執行。這代表 `LayerMaterializationEpoch` 還必須帶 `BarrierSubstrate`：HOST_STATUS、CUDA_EVENT、STREAM_WAIT、GRAPH_CAPTURE_ORDERING等。

### 3. CUDA Graph mode會改變可用同步機制
current vLLM module offloader顯示 capture內可用 `current_stream().wait_event(copy_done_event)` 對 capture內 prefetch建立 graph-compatible dependency；capture外若 event有效也使用 wait_event，否則 fallback到 `wait_stream(copy_stream)`。這提供一個可泛化的 device-side witness模型：`producer stream records event → consumer compute stream waits event → subsequent kernel launch`。

因此新增：
`DeviceReadinessWitness = ProducerCompletionEvent + ConsumerStreamWait + PostWaitAttentionLaunch`。

注意：這是 offloader已確認的同步模式；不能直接推論所有 KV connector都已採用相同實作。

### 4. NIXL/Mooncake no-op 不代表沒有 readiness，只代表 readiness位於不同層
**已確認工程實作**：NIXL與Mooncake connector facade的 `wait_for_layer_load` 都是 no-op；它們的完成資訊經 worker `get_finished/get_transfer_results` 與 scheduler/request admission路徑處理。因此 provenance必須允許 `RequestScopedMaterializationWitness`，而不是硬要求每個 layer都有 wait callback。

新的 join：
`ConnectorCapability + RequestTransferSuccess + SchedulerAdmission + PhysicalLeaseValid → RequestScopedReadableWitness`。

只有 connector宣告/實作 layerwise path時，才額外要求 `LayerBarrierWitness`。

### 5. LMCache layerwise path暴露 TOCTOU 與 stream/device identity為 provenance的一部分
2026 issue報告 layerwise lookup→retrieve在 eviction壓力下可能出現 lookup命中但retrieve token不足；另有 DP+EP issue出現 CUDA event device與recording stream device不一致。這些是 issue evidence，不是普遍定律，但說明 readiness witness必須帶 `DeviceIdentity + StreamIdentity + TransferEpoch + Pin/RetentionEpoch`，不能只記 layer name與完成布林值。

## Architecture Breakdown
### Connector-specific Readiness Adapter
`KVConnector`
→ `CapabilityDetect`
→ `RequestScopedBarrier | LayerScopedBarrier`
→ `BarrierSubstrate`
→ `TransferEpoch`
→ `Device/Stream Identity`
→ `PhysicalLeaseEpoch`
→ `TranslationCommitEpoch`
→ `AttentionLaunch`
→ `ReadableKVWitness`

LMCache:
`start_load_kv → layerwise retriever generators → wait_for_layer_load → next(retriever) → returned token mask → layer advances`。

MoRIIO:
`READ transfer → per-layer transfer status → host polling wait_for_layer_load → success/failure/timeout`; FULL graph capture不執行 host blocking wait。

NIXL/Mooncake:
`request transfer → worker completion → scheduler barrier → model admission`; layer wait目前 no-op。

## Bottom-Level Logic
對 layer `l` 的可讀性不能由函式名稱決定，而應由 evidence決定：

`Readable(r,l,a) =`
`LeaseValid(r)`
`∧ TranslationCommitted(r,l)`
`∧ TransferEpochMatches(r,l)`
`∧ BarrierSatisfied(r,l, connector_capability)`
`∧ DeviceIdentityMatches`
`∧ StreamOrderingSatisfied`
`∧ AttentionLaunchAfterBarrier(a)`。

若 barrier substrate是 CUDA event，理想 witness為：
`copy_stream writes KV → record Event E → compute_stream wait(E) → attention kernel launch K`。
這建立 device execution ordering；host `finished_recving` 本身只證明 control-plane completion，不自動等價於上述 GPU happens-before。

若 connector只有 request-scoped completion，Hermes必須標記 witness granularity為 REQUEST，而不能偽裝成 LAYER/BLOCK precision。

## Visual Simulation Idea
### KV Barrier Substrate & Happens-Before Viewer
三條泳道：Transfer/Copy Stream、Host/Scheduler、Compute Stream。

`COPY STREAM: KV DMA ── record E17`
`HOST: finished_recv → cache commit → schedule`
`COMPUTE: ........ wait E17 ── Attention L18`

connector selector顯示：LMCache / MoRIIO / NIXL / Mooncake；每個 connector自動切換實際 barrier semantics與 evidence precision。錯誤狀態：`NO_LAYER_BARRIER_EXPECTED`、`HOST_COMPLETE_DEVICE_ORDER_UNKNOWN`、`EVENT_DEVICE_MISMATCH`、`STREAM_IDENTITY_MISMATCH`、`LAYER_WAIT_SKIPPED_FULL_GRAPH`、`LOOKUP_RETRIEVE_TOCTOU`。

## Code / GitHub
值得看的 current source：
- `vllm/distributed/kv_transfer/kv_connector/v1/lmcache_integration/vllm_v1_adapter.py`: layerwise retriever advancement。
- `vllm/distributed/kv_transfer/kv_connector/v1/moriio/moriio_connector.py`: per-layer host polling與FULL graph exception。
- `vllm/distributed/kv_transfer/kv_connector/v1/nixl/connector.py`: layer wait no-op，證明request-scoped connector class存在。
- `vllm/distributed/kv_transfer/kv_connector/v1/mooncake/mooncake_connector.py`: layer wait no-op與worker transfer results。
- `vllm/model_executor/offloader.py`: CUDA event / stream wait在capture/eager下的同步策略，可作 device happens-before reference design。

## Papers / Engineering Evidence
本輪重點是原始碼差異驗證，沒有為了湊數重複加入前輪論文。延續追蹤 SmartGen/Lynx，但本輪的新工程證據來自 current vLLM connector implementations與LMCache 2026 issues。Issue evidence僅用於風險/假說，不提升成官方保證。

## Unknown / Open Questions
1. LMCache `layerwise_retriever` 的底層 generator在哪個精確點等待/同步 H2D stream，能否取得 event/stream handle作硬 witness？
2. NIXL/Mooncake request completion之前，底層 transfer library對 GPU memory visibility的完成定義是否等價於 consumer compute stream可立即讀？需要追 worker implementation與NIXL/Mooncake completion semantics。
3. FULL CUDA Graph下 connector-specific external KV load如何在 replay前建立 device ordering，且不依賴capture內 host blocking？

## 下一輪研究
`LMCache layerwise generator internals`
→ `load_stream / CUDA event / synchronize exact point`
→ `NIXL worker completion semantics`
→ `Mooncake worker completion semantics`
→ `Device/Stream identity`
→ `DeviceReadinessWitness`
→ `Attention visibility policy`
→ `VisibleLogicalPositionSet`
→ `ExpectedPhysicalKVReadSet`
→ `ZERO/REPLACE KV`
→ `ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction`。

## Knowledge Graph 新增 Node / Edge
Nodes:
- `ConnectorReadinessCapability`
- `BarrierSubstrate`
- `RequestScopedMaterializationWitness`
- `LayerBarrierWitness`
- `DeviceReadinessWitness`
- `ProducerCompletionEvent`
- `ConsumerStreamWaitWitness`
- `DeviceIdentity`
- `StreamIdentity`
- `BarrierEvidenceGranularity`
- `GraphCaptureBarrierCompatibility`
- `LookupRetrieveTOCTOUState`

Edges:
- `ConnectorImplementation → declares/implements → ConnectorReadinessCapability`
- `ProducerCompletionEvent → waited_by → ConsumerStream`
- `ConsumerStreamWaitWitness → precedes → AttentionLaunch`
- `DeviceReadinessWitness + LeaseValid + TranslationCommit → supports → LocalReadableKVContentWitness`
- `NIXL/Mooncake wait_for_layer_load → no_op → LayerBarrierWitness`
- `LMCache wait_for_layer_load → advances → LayerwiseRetriever`
- `MoRIIO wait_for_layer_load → host_polls → LayerTransferStatus`
- `wait_for_layer_load_called --does_not_prove→ DeviceReadableKV`
- `HostTransferComplete --does_not_prove→ ConsumerStreamOrdered`

## 本輪結束判斷
缺哪一層：LMCache/NIXL/Mooncake底層真正的 CUDA event/stream completion semantics。
最淺節點：`DeviceReadinessWitness` 的 connector-specific production instance。
仍只是名詞：`ObservedPhysicalKVReadSet`；我們現在能更嚴格證明「何時可讀」，但仍未逐 load觀測「實際讀了哪裡」。
最值得讀原始碼：LMCache layerwise retriever/gpu connector、NIXL worker、Mooncake recv worker。
需追引用：下一輪優先不追新論文，先把 device-side completion原始碼閉合；SmartGen/Lynx保留為 partial/progressive materialization對照。
最適合視覺模擬：KV Barrier Substrate & Happens-Before Viewer。
最值得實作的 Agent 架構：`State-grounded Planner + Runtime Provenance Verifier + Connector Capability Adapter + Device Happens-Before Verifier + Residency/Lease Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。
