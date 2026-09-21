# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 18:55（Asia/Taipei）

## 本小時新發現
本輪延續上一輪 `TensorMapGeneration → TMA issue → async proxy → mbarrier → MMA`，不再重複 TensorMap / TMA over-read，而是深入 **mbarrier transaction-byte accounting、phase ownership、producer/consumer pipeline**。核心新結論：TMA correctness 不只是「有 barrier」；barrier 必須對應正確 expected transaction bytes、正確 phase、正確 producer/consumer stage，否則可能產生 premature-ready、永不 ready、或跨 stage 誤認完成。

### 已確認事實 / 官方資訊
- PTX `cp.async.bulk.tensor` 在 async proxy 執行；global→shared TMA 可用 `mbarrier::complete_tx::bytes` 回報完成。copy 完成後有 implicit generic-async proxy fence；consumer 必須透過 mbarrier / async-group completion 機制觀察完成。
- CUTLASS primitives 明確要求 `arrive_expect_tx(mbar, nbytes)` 必須在對應 TMA copy 前建立 transaction count；TMA hardware 完成後自動 complete_tx。若同一 barrier 有多個 TMA producers，expected bytes 必須是各 producer byte contribution 的正確總和。
- CUDA async barrier具有 phase/parity；phase 會重複使用，因此等待者不能只識別 barrier address，還要識別 barrier phase / pipeline stage。

### 工程實作：FlashInfer current source
`flashinfer/cute_dsl/attention/gqa_decode_paged.py` 顯示：page table先載入 shared memory；K producer從 page table取得 `virtual_page_idx`，以 `kv_producer.acquire_and_advance()` 取得 stage handle，再用 handle 的 `barrier` 對 K TMA copy；V producer採相同 staged pipeline。MMA KQ / VP consumer不是直接吃 TMA issue，而是透過 `kv_consumer.wait_and_advance()` 取得完成 stage，使用 shared-memory fragment後再 `release()`。這形成 production-level `TMA Producer → stage barrier → consumer wait → MMA → release` contract。

## 本小時最重要 5 個發現

### 1. Transaction-byte count 是 correctness state，不只是效能 metadata
底層：`TMA tile geometry × global transaction dtype → ExpectedTransactionBytes → arrive_expect_tx → TMA complete_tx(bytes) → barrier phase completion`。
重要性：expected bytes過小可能讓 barrier過早滿足；過大則 consumer可能永遠等不到完成。限制：高階 DSL可能自動產生 accounting，仍需追 generated PTX/SASS驗證。
來源：NVIDIA PTX ISA / CUTLASS primitives。

### 2. Barrier identity 必須升級成 BarrierEpoch / PipelineStageIdentity
單純 `mbarrier address` 不足以表示一次 transfer。barrier會跨 pipeline iteration重用；CUDA也明確提供 phase/parity tracking。
新增 identity：`BarrierInstance = address + phase/parity + pipeline_stage + producer_epoch`。

### 3. FlashInfer 已存在真正的 staged K/V ownership protocol
K/V TMA producer透過 `kv_producer.acquire_and_advance()`取得 stage/barrier；MMA端透過 `kv_consumer.wait_and_advance()`等待，再在使用後 `release()`。因此 shared tile lifetime不是「copy完即可覆寫」，而是 producer/consumer ownership transfer。

### 4. TMA issue、barrier complete、MMA consumption 是三個不同 witness
`TMAIssueWitness != TMACompletionWitness != MMAConsumptionWitness`。
只有最後一個能證明該 tile已進入模型計算；而即使進入 MMA，仍不代表該元素最終具有 semantic contribution，因為 attention masking仍可能排除。

### 5. request attribution 必須 join pipeline stage與barrier phase
一筆 trace若只有 physical page / TensorMap，不足以避免 stage reuse誤歸因。最小 attribution key應升級為：
`request_id + forward_epoch + layer + kv_head + PageTableGeneration + KVLeaseEpoch + TensorMapGeneration + PipelineStageIdentity + BarrierEpoch + GraphExecIdentity`。

## Architecture Breakdown
```text
Scheduler / Forward Epoch
  → Attention Metadata
  → PageTableGeneration
  → virtual_page_idx
  → TensorMapGeneration
  → kv_producer.acquire(stage)
  → ExpectedTransactionBytes(stage)
  → TMA K/V issue(stage, barrier)
  → Async Proxy InFlight
  → complete_tx(bytes)
  → Barrier phase transition
  → kv_consumer.wait(stage)
  → SharedTileReadableWitness
  → MMA KQ / VP
  → consumer.release(stage)
  → stage reusable
```

## Bottom-Level Logic
新增 `TransactionByteAccountingWitness`：
```text
ExpectedTransactionBytes
= Σ(global bytes delivered by all TMA copies sharing this barrier phase)
```
正確 readiness：
```text
CorrectBarrierPhase
AND ExpectedTxBytesRegisteredBeforeIssue
AND CompletedTxBytes == ExpectedTxBytes
AND ConsumerWaitObservedPhaseTransition
→ SharedTileReadableWitness
```
但：
```text
SharedTileReadableWitness
--does_not_prove→ SemanticContribution
```

新增 failure states：
- `TMA_EXPECT_TX_UNDERCOUNT`
- `TMA_EXPECT_TX_OVERCOUNT`
- `BARRIER_PHASE_REUSE_MISMATCH`
- `PIPELINE_STAGE_OWNERSHIP_VIOLATION`
- `MMA_CONSUMER_BEFORE_STAGE_READY`
- `STAGE_REUSED_BEFORE_CONSUMER_RELEASE`
- `TRACE_ATTRIBUTED_TO_WRONG_BARRIER_EPOCH`

## Visual Simulation Idea
### TMA Barrier Phase & Byte Counter Microscope
互動顯示：
`Page → TensorMap → Stage[n] → expected bytes counter → K/V TMA arrows → complete_tx decrements → phase flip → MMA consumer → release → Stage[n] reuse`

控制：page size、dtype、K/V tile shape、producer數、stage數、故意 under/over-count、延遲其中一筆TMA、錯 phase wait、提前 stage reuse。

視覺 failure：`PREMATURE_READY`、`DEADLOCK_EXPECT_TX_REMAINS`、`WRONG_PHASE_CONSUMPTION`、`STAGE_REUSE_RACE`。

## Code / GitHub
值得繼續追：
- `flashinfer/cute_dsl/attention/gqa_decode_paged.py`：K/V TMA dispatch、`kv_producer`、`kv_consumer`、MMA KQ/VP。
- CUTLASS/CuTe pipeline / cpasync primitives：barrier initialization、expect_tx、phase wait。
- 下一步需要取得 generated PTX/SASS，確認 DSL pipeline lowering後的 `cp.async.bulk.tensor` / `mbarrier` 指令與 transaction-byte operands。

## Papers
### Evaluating CUDA Tile for AI Workloads on Hopper and Blackwell GPUs
- Authors: Divakar Kumar Yadav, Tian Zhao, Deepak Kumar
- Year: 2026
- Architecture: Hopper H100 NVL / Blackwell B200 / RTX PRO 6000，tile-centric GPU kernels
- Contribution: 跨架構比較 CuTile、cuBLAS、Triton、WMMA、SIMT；顯示相同 tile abstraction在不同GPU的效能差距很大。
- Limitation: benchmark / portability研究，不直接提供 FlashInfer paged decode 的 barrier correctness trace。
- 改變了什麼：進一步支持 `GPUArchitecture` 必須是 execution contract的一部分，而不是只記 kernel name。

## Unknown / Open Questions
1. FlashInfer `kv_producer/kv_consumer` 最終 lowering 到哪一組 PTX mbarrier phase/parity 指令？
2. K/V 多個 TMA copy共享一個 stage barrier時，DSL實際註冊的 expected bytes如何聚合？
3. 如何以低擾動 instrumentation把 `BarrierEpoch + PipelineStageIdentity` join回 request/layer/page？

## 下一輪研究
```text
FlashInfer pipeline object definition
→ producer/consumer stage count
→ expected transaction-byte generation
→ generated PTX
→ cp.async.bulk.tensor operands
→ mbarrier arrive/expect_tx/wait parity
→ generated SASS
→ runtime trace feasibility
→ BarrierEpoch attribution
→ MMA consumer witness
→ causal KV mutation
→ ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction
```

## Knowledge Graph 新增 Node / Edge
### Nodes
- `ExpectedTransactionBytes`
- `CompletedTransactionBytes`
- `TransactionByteAccountingWitness`
- `BarrierInstanceIdentity`
- `BarrierEpoch`
- `BarrierPhaseParity`
- `PipelineStageIdentity`
- `ProducerStageOwnershipWitness`
- `ConsumerStageOwnershipWitness`
- `StageReleaseWitness`
- `PrematureBarrierReadyState`
- `BarrierTransactionDeadlockState`

### Edges
- `TMATileTransferFootprint --determines→ ExpectedTransactionBytes`
- `ExpectedTransactionBytes --registered_before→ TMAIssueWitness`
- `TMACompletionWitness --decrements→ OutstandingTransactionBytes`
- `OutstandingTransactionBytesZero + ArrivalSatisfied --advances→ BarrierEpoch`
- `BarrierEpoch --gates→ SharedTileReadableWitness`
- `SharedTileReadableWitness --permits→ MMAConsumptionWitness`
- `MMAConsumptionWitness --followed_by→ StageReleaseWitness`
- `StageReleaseWitness --permits→ PipelineStageReuse`
- `BarrierAddress --does_not_uniquely_identify→ BarrierEpoch`
- `TMAIssueWitness --does_not_prove→ TMACompletionWitness`
- `TMACompletionWitness --does_not_prove→ MMAConsumptionWitness`

## 本輪結束判斷
- 缺哪一層：CuTe pipeline abstraction → generated PTX/SASS exact barrier protocol → runtime trace。
- 哪個節點最淺：`TransactionByteAccountingWitness` 的 generated-code instance。
- 哪個概念仍只是名詞：`BarrierEpoch` 的 request-scoped runtime attribution。
- 哪個系統值得讀原始碼：FlashInfer CuTe paged GQA decode + CUTLASS pipeline/cpasync lowering。
- 哪篇論文需追引用：2026 CuTile Hopper/Blackwell cross-architecture evaluation，並繼續追 Blackwell attention/TMA pipeline研究。
- 哪個概念最適合視覺模擬：TMA Barrier Phase & Byte Counter Microscope。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Runtime Provenance Verifier + TensorMap/TMA Contract Verifier + Transaction-Byte & Barrier-Phase Verifier + Pipeline Ownership Verifier + Binary Instrumentation Controller + Request Trace Attribution Joiner + Causal Evidence Gate + Tool Executor`。

## 與歷史研究相比的實質新增
前一輪回答「TMA用哪一版TensorMap、何時完成」；本輪再把「完成」拆成 **expected byte accounting + phase transition + stage ownership + consumer release**。因此 Hermes 的 GPU provenance不再把 mbarrier當成布林值，而是把它建模成可重用、具phase、具transaction counter、具producer/consumer ownership的狀態機。