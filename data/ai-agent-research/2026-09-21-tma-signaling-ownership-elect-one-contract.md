# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 19:51 Asia/Taipei

## 本小時新發現
本輪承接上一輪 `mbarrier Transaction-Byte Accounting × Phase Ownership`，但不再重複「barrier 不是 boolean」。本輪深入的是 **誰有權對 barrier 註冊 arrival / expected transaction bytes，以及同一個 logical TMA producer 被多少 warp/lane 重複 signal**。核心結論：TMA correctness 不只取決於 byte count 與 phase，還取決於 **signaling ownership / multiplicity**。

已確認（NVIDIA CUTLASS / CuTe DSL 官方文件）：
- Pipeline config 明確包含 `producer_signaling_threads` / `consumer_signaling_threads`；pipeline stage state 不只是 stage index，而有 opening/closing counters，`advance_on_acquire` / `advance_on_wait` 可讓 acquire/wait 先推進，commit/release 由 lagging state 關閉舊 stage。
- `mbarrier_arrive_expect_tx` 是「software arrive + expected transaction bytes registration」的 fused operation；對 `mbarrier_init(count=1)` 的 TMA pipeline，通常只應由一個被選出的 thread 執行。
- CUTLASS task-scheduling 文件特別指出：普通 CuTe DSL TMA pipeline 的 `producer_acquire` 內 `arrive_and_expect_tx` 只受 per-warp `elect_one` 保護；當多個 producer warps 被映射到同一 full barrier 時，如果每個 warp 都執行，會重複 arrival / transaction registration。因此 task-scheduling 另引入 `TaskWarpLeader`，讓只有 task 的第一個 producer warp 對 full barrier 做 transaction arrive。
- TMA copy 的 DSL 本身會處理單-thread issue；barrier setup / expect-tx 才需要正確的 elect-one ownership。對 multicast TMA，額外手動把 `cute.copy` 包進 `elect_one()` 甚至可能造成 deadlock。

合理推論：Hermes 的 barrier provenance 必須新增 `BarrierSignalOwnershipContract`，不能只驗證 `ExpectedTransactionBytes == CompletedTransactionBytes`。若相同 logical transfer 被兩個 warp 重複註冊，即使每筆 TMA 本身 bytes 正確，barrier 仍可能因 expected count 被放大而永遠不 ready；反之若多 producer 應各自貢獻但 ownership 過度收斂，也可能 premature-ready。

## 本小時最重要 5 個發現

### 1. Barrier transaction accounting 有「所有權」而非只有「數值」
**是什麼：** `arrive_expect_tx(barrier, nbytes)` 同時做 software arrival 與 expected-byte registration。

**底層如何運作：**
`Logical Producer Group → Elect Signaler → arrive_expect_tx(bytes) → TMA issue → HW complete_tx(bytes) → phase transition`。

**為什麼重要：** 同一 bytes 被兩個 warp 重複 expect，會形成 `expected=2N / completed=N`；反之漏掉 producer contribution 會形成 `expected<N`，可能讓 consumer過早看到 ready。

**限制：** source abstraction 到 generated PTX/SASS 的實際 signal multiplicity仍需 binary trace驗證。

**來源：** NVIDIA CUTLASS Pipeline Types、Primitives、Task Scheduling Pipeline 官方文件。

### 2. `elect_one` 的 scope 是 correctness contract
**是什麼：** lane-level elect-one、warp-level producer leadership、task-level warp leadership不是等價概念。

**底層如何運作：**
`CTA → producer warps → per-warp elected lane → optional task-warp leader gate → full barrier transaction arrive`。

**為什麼重要：** per-warp `elect_one` 只能保證每 warp 一人，不能保證整個 task / producer group只有一個 signaler。

**限制：** 不同 CUTLASS pipeline class的 signaling policy不同，不能硬編碼單一規則。

### 3. Pipeline state 有 opening/closing 雙生命週期
`advance_on_acquire` / `advance_on_wait` 允許 opening state先移到下一 stage，而 commit/release仍關閉較舊 stage。故：
`PipelineStateCounter --does_not_uniquely_identify→ ActiveStageOwnership`。
需要 `OpenStageEpoch` 與 `CloseStageEpoch` 分離。

### 4. TMA issue ownership與 barrier signaling ownership不是同一件事
CuTe DSL可自動處理TMA single-thread issue，但 barrier init / expected transaction setup仍需 elect-one。故新增：
`TMAIssuerIdentity ≠ BarrierSignalerIdentity`（兩者可重合但不可假定）。
這對 source→PTX instrumentation 很重要：只 trace `cp.async.bulk.tensor` 的 issuer不能推導誰註冊了 expected bytes。

### 5. Blackwell attention pipeline正在把這些 ownership contract變成核心性能/正確性問題
FlashAttention-4（Zadouri et al., MLSys 2026）針對 Blackwell 使用 fully asynchronous MMA、更大 tile、Tensor Memory、2-CTA MMA；官方/論文報告 B200 BF16最高 1613 TFLOP/s、71% utilization、相對 cuDNN 9.13最高1.3×。這類更深的 producer/consumer overlap讓 barrier ownership、stage lifetime與 async completion更值得被一級建模，而非當作 kernel implementation detail。

## Architecture Breakdown

### System architecture：Blackwell/CuTe asynchronous attention pipeline
```text
Request / Forward Epoch
  → AttentionExecutionContract
  → PageTableGeneration
  → TensorMapGeneration
  → Producer Task / Warp Group
  → BarrierSignalOwnershipContract
      → Signaler Election Scope
      → ExpectedTransactionContribution
  → TMAIssuerIdentity
  → cp.async.bulk.tensor
  → HW complete_tx(bytes)
  → BarrierPhaseTransition
  → Consumer Wait Ownership
  → SharedTileReadable
  → Async MMA / UMMA
  → Softmax / PV
  → Attention Output
```

### 與上一輪比較
上一輪：
`ExpectedTxBytes → complete_tx(bytes) → BarrierPhase → ConsumerStageOwnership`

本輪新增：
`ProducerGroup → SignalerElectionScope → BarrierSignalMultiplicity → ExpectedTxContributionOwnership`

因此完整 barrier readiness 應提升為：
```text
BarrierReadyWitness =
  CorrectBarrierGeneration
  ∧ CorrectPhaseParity
  ∧ CorrectSignalerSet
  ∧ CorrectSignalMultiplicity
  ∧ CorrectExpectedTxContributionPerProducer
  ∧ ΣCompletedTxBytes == ΣExpectedTxBytes
  ∧ ConsumerWaitTargetsSameBarrierEpoch
```

## Bottom-Level Logic

### 正常路徑
```text
mbarrier_init(arrival_count=1)
→ producer group selects exactly one authorized signaler
→ signaler arrive_expect_tx(N)
→ TMA issuer submits N-byte tile
→ hardware complete_tx(N)
→ expected tx reaches zero + arrival condition satisfied
→ phase flips
→ consumer wait(parity) succeeds
→ consumer owns ready stage
→ MMA consumes shared tile
→ consumer release
```

### Failure A：per-warp election誤當 task-level election
```text
Producer Warp 0 elect_one → arrive_expect_tx(N)
Producer Warp 1 elect_one → arrive_expect_tx(N)
Only one logical N-byte TMA transfer
→ Expected = 2N
→ Completed = N
→ barrier cannot complete
→ PIPELINE_SIGNAL_MULTIPLICITY_OVERCOUNT
```

### Failure B：過度收斂 signaler
```text
Two independent producers each deliver N bytes
Only one N-byte contribution registered
→ Expected = N
→ first transfer completes
→ barrier may transition before second producer data ready
→ PIPELINE_SIGNAL_MULTIPLICITY_UNDERCOUNT
```

### Failure C：stage opening/closing epoch混淆
```text
acquire(stage k) advances opening state to k+1
commit/release still refers to k
trace only records one pipeline counter
→ event incorrectly attributed to k+1
→ OPEN_CLOSE_STAGE_EPOCH_MISMATCH
```

## Visual Simulation Idea
### Barrier Signaling Ownership & Multiplicity Microscope
Hermes Console 顯示：
```text
Producer Task
 ├ Warp0 → lane elected ─┐
 ├ Warp1 → lane elected ─┼→ ownership gate → arrive_expect_tx
 └ Warp2 → lane elected ─┘

Expected-byte ledger       Completed-byte ledger
P0 +4096                   TMA0 -4096
P1 +4096 ?                 TMA1 -4096 ?

Stage 0: OPEN → ARMED → IN_FLIGHT → READY → CONSUMED → RELEASED
Stage 1: ...
```
可互動切換 per-lane/per-warp/per-task election、producer warp數、TMA數、bytes、stage depth、advance_on_acquire/wait，直接產生：
- `DUPLICATE_EXPECT_TX_REGISTRATION`
- `MISSING_PRODUCER_TX_CONTRIBUTION`
- `SIGNALER_SCOPE_MISMATCH`
- `OPEN_CLOSE_STAGE_EPOCH_MISMATCH`
- `TMA_ISSUER_SIGNALER_ATTRIBUTION_GAP`

## Code / GitHub
優先閱讀：
1. NVIDIA CUTLASS Python DSL pipeline / task-scheduling pipeline：`PipelineTmaAsync`、`MbarrierArray.arrive_and_expect_tx`、`TSPipelineTmaAsync`、TaskWarpLeader signaling logic。
2. FlashInfer paged GQA decode / TMA loader：追 producer acquire、barrier handle、TMA issue、consumer wait/release的實際 call graph。
3. 下一步需對 generated PTX/SASS建立 source-map：`arrive.expect_tx`、`cp.async.bulk.tensor`、`mbarrier.try_wait/test_wait`、MMA consumer。

## Papers
### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling
- Authors: Ted Zadouri, Markus Hoehnerbach, Jay Shah, Timmy Liu, Vijay Thakkar, Tri Dao
- Venue/Institution context: MLSys 2026；FlashAttention/CuTe ecosystem
- Year: 2026
- Architecture: Blackwell-oriented fully asynchronous attention pipeline, larger tiles, Tensor Memory, 2-CTA MMA, software-emulated exponential, conditional softmax rescaling
- Contribution: 將Blackwell非matmul瓶頸納入algorithm-kernel co-design；B200 BF16最高1613 TFLOP/s（71% utilization），相對cuDNN 9.13最高1.3×
- Code: FlashAttention ecosystem / CuTe DSL implementation（需下一輪逐檔案追）
- Dataset: kernel benchmark，不是傳統ML dataset
- Limitations: 強烈architecture-specific；不能直接把Blackwell pipeline contract泛化到Hopper/Ampere
- 改變了什麼：證明attention runtime provenance必須納入GPU architecture、async MMA、TMEM與multi-CTA pipeline identity。

### Evaluating CUDA Tile for AI Workloads on Hopper and Blackwell GPUs
- Authors: Divakar Kumar Yadav, Tian Zhao, Deepak Kumar
- Year: 2026
- Architecture: CuTile tile-centric kernels跨H100/B200/RTX PRO 6000比較
- Contribution: 顯示相同tile abstraction在不同GPU的效能差異很大；B200 fused attention可達1007 TFLOP/s，但RTX PRO 6000同類kernel僅約FlashAttention-2的53%
- Limitation: 主要是效能/可攜性研究，不直接證明barrier correctness
- 改變了什麼：支持 `GPUArchitecture` / backend lowering 必須進入 ExecutionContract。

## Unknown / Open Questions
1. FlashInfer current CuTe paged decode lowering後，實際是哪些 warp/lane執行 `arrive_expect_tx`？是否存在task-level leader gate？
2. generated PTX/SASS能否穩定把 `barrier address + phase + tx bytes + issuer lane/warp` trace回 request/layer/page generation？
3. Blackwell multi-CTA / multicast TMA 下，remote CTA barrier signaling與local barrier ownership如何形成唯一 BarrierInstanceIdentity？

## 下一輪研究
```text
FlashInfer/CUTLASS source
→ PipelineTmaAsync / task-scheduling pipeline
→ producer group topology
→ elect_one scope
→ TaskWarpLeader gate
→ arrive_expect_tx contribution
→ generated PTX
→ barrier address / phase / tx bytes
→ cp.async.bulk.tensor issuer
→ runtime binary trace
→ request/layer/page attribution
→ MMA consumer
→ ZERO/REPLACE KV
→ ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction
```

## Knowledge Graph 新增 Node / Edge
### Nodes
- `BarrierSignalOwnershipContract`
- `SignalerElectionScope`
- `AuthorizedBarrierSignalerSet`
- `BarrierSignalMultiplicity`
- `ExpectedTxContributionOwnership`
- `TMAIssuerIdentity`
- `TaskWarpLeaderIdentity`
- `ProducerWarpGroupIdentity`
- `OpenStageEpoch`
- `CloseStageEpoch`
- `DuplicateExpectTxRegistrationState`
- `MissingProducerTxContributionState`
- `SignalerScopeMismatchState`

### Edges
- `ProducerWarpGroupIdentity --elects→ AuthorizedBarrierSignalerSet`
- `AuthorizedBarrierSignalerSet --registers→ ExpectedTxContributionOwnership`
- `ExpectedTxContributionOwnership --increments→ ExpectedTransactionBytes`
- `TMAIssuerIdentity --issues→ TMAIssueWitness`
- `TMAIssuerIdentity --does_not_uniquely_identify→ BarrierSignalerIdentity`
- `PerWarpElectOne --does_not_prove→ SingleTaskLevelSignaler`
- `DuplicateExpectTxRegistrationState --can_cause→ BarrierTransactionDeadlockState`
- `MissingProducerTxContributionState --can_cause→ PrematureBarrierReadyState`
- `OpenStageEpoch --does_not_equal→ CloseStageEpoch`

## 本輪結束判定
- **缺哪一層：** source-level producer/signaler ownership → generated PTX/SASS lane/warp identity → runtime barrier event trace。
- **哪個節點最淺：** `AuthorizedBarrierSignalerSet` 的 production/runtime witness。
- **哪個概念仍只是名詞：** request-scoped `BarrierSignalerIdentity` 與 `TaskWarpLeaderIdentity` 的實際trace join。
- **哪個系統值得讀原始碼：** CUTLASS task-scheduling pipeline + FlashInfer CuTe paged decode。
- **哪篇論文需追引用：** FlashAttention-4，尤其CuTe DSL implementation與2-CTA pipeline後續工作。
- **哪個概念最適合視覺模擬：** Barrier Signaling Ownership & Multiplicity Microscope。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + TMA/Barrier Contract Verifier + Signaling Ownership Verifier + Binary Instrumentation Controller + Request Trace Attribution Joiner + Causal KV Probe + Causal Evidence Gate + Tool Executor`。

## 本輪核心結論
Hermes 現在不能只問「barrier 預期多少 bytes、完成多少 bytes」，還必須回答：**是誰註冊這些 bytes、以什麼 election scope 註冊、同一 logical producer 是否被多個 warp 重複計數、以及 opening/closing stage epoch是否被正確歸屬。** 這把 GPU pipeline correctness 從 byte/phase state machine再推進到 signaling ownership state machine。