# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 20:54 Asia/Taipei

## 本小時新發現
本輪承接上一輪 `TMA Signaling Ownership × Elect-One Scope × Barrier Multiplicity`，不再重複 per-warp / per-task election，而是深入 **cluster / multicast TMA 下 barrier 到底存在於哪一個 CTA、complete_tx 被送到哪些 barrier replica，以及一份 HBM read 如何 fan-out 成多個 CTA 的 shared-memory readiness**。

核心新結論：`BarrierInstanceIdentity` 不能只用 `barrier address + phase + stage`。在 cluster-scoped TMA 中，相同 CTA-relative shared-memory offset 可以在多個 CTA 各有一份 mbarrier；multicast TMA 會依 `ctaMask` 把資料與 mbarrier signal fan-out 到目的 CTA。因此必須加入 `ClusterRank / BarrierReplicaTopology / MulticastMaskGeneration`。

已確認（NVIDIA PTX / CUTLASS 官方文件）：
- `cp.async.bulk ... shared::cluster.global ... multicast::cluster` 的 `ctaMask` 每個 bit 對應一個 destination CTA；資料會被 multicast 到每個目的 CTA 相同的 CTA-relative shared-memory offset，mbarrier signal 也會 multicast 到每個目的 CTA相同 offset 的 mbarrier。
- CUTLASS primitives 明確區分兩種 topology：shared-tile multicast（leader 發一次 TMA，fan-out 到多 CTA）與 per-CTA unicast。這兩者不是等價的；把 multicast 拆成多個 unicast 會改變 HBM traffic 與 barrier topology。
- 對一般 cluster multicast，可採每 CTA local mbarrier：每個 CTA 初始化/arm 自己的 barrier，leader 發 TMA，hardware 將 complete_tx multicast 到每個 destination CTA 的 barrier replica。
- 對特定 2-CTA / downstream MMA reuse topology，可使用 leader/collapsed barrier，使 complete_tx 路由到 group leader 的 mbarrier；這與 per-CTA replica topology不同。
- CUTLASS `PipelineTmaUmma` 明確包含 `is_leader_cta`、`cta_group`、multicast arrival mask計算與 `enable_multicast_signaling`，表示 CTA leadership / group topology 是 production pipeline contract的一部分。

合理推論：Hermes 必須把 `BarrierTopologyContract` 與 `BarrierSignalOwnershipContract` 分離。前者回答 signal 要去哪一份 barrier；後者回答誰有權註冊/發出 signal。兩者任一錯誤都可能 deadlock 或 premature-ready。

## 本小時最重要 5 個發現

### 1. Cluster TMA 的 barrier 是「replica topology」，不是單一地址
**概念：** 相同 CTA-relative SMEM offset在不同CTA代表不同 physical barrier instance。

**底層：**
`Cluster → CTA rank → local SMEM → same relative mbar offset → barrier replica`。

multicast TMA：
`leader issue → ctaMask → data fanout + complete_tx fanout → destination barrier replicas`。

**重要性：** 只記錄 `mbar_ptr=0x...` 不足以唯一辨識 barrier；runtime trace必須同時記錄 CTA/cluster rank。

**限制：** 真實 physical shared-memory addressing仍需 SASS/runtime trace確認。

### 2. `ctaMask` 是 correctness provenance，不只是 routing metadata
`ctaMask` 同時決定資料接收 CTA 與 mbarrier completion signal 的 destination set。因此新增 `MulticastMaskGeneration` 與 `ExpectedBarrierReplicaSet`。

若 mask漏掉等待中的CTA：該CTA永遠收不到 complete_tx → deadlock。
若 mask包含不該接收的CTA：可能造成非預期 replica ready / stale stage attribution。

### 3. Multicast 與 per-CTA unicast 的 HBM/readiness語義不同
shared-tile multicast是一筆 source read fan-out到多CTA；per-CTA unicast則是多筆獨立copy。不能把：
`DestinationCTASet size = N` 推論成 `HBMReadMultiplicity = N`。

新增：`SourceReadMultiplicity`、`DestinationFanoutMultiplicity`，並建立否定 edge：
`DestinationFanoutMultiplicity --does_not_equal→ SourceReadMultiplicity`。

### 4. 2-CTA collapsed/leader barrier 是另一種 barrier topology
CUTLASS primitives指出特定2-CTA topology可讓 leader init/arm/wait，complete_tx重導向leader barrier；一般multicast則可讓每CTA擁有local replica並各自wait。因此新增：
`BarrierReplicaTopology = PER_CTA_REPLICA | GROUP_LEADER_COLLAPSED | LOCAL_SINGLE_CTA | UNKNOWN`。

這不能由 `cluster_size` 單獨推導，還需要 pipeline / group mode / multicast signaling policy。

### 5. Blackwell pipeline provenance必須納入 CTA group identity
FlashAttention-4等Blackwell pipeline使用2-CTA MMA、TMEM與fully asynchronous MMA；CUTLASS `PipelineTmaUmma`也直接建模CTA group與leader。這使 `CTAGroupIdentity` 從performance detail升級成 correctness node。

## Architecture Breakdown

### System architecture：Cluster-Multicast TMA → UMMA consumer
```text
Request / ForwardEpoch
→ AttentionExecutionContract
→ PageTableGeneration
→ TensorMapGeneration
→ ClusterIdentity
→ CTAGroupIdentity
→ LeaderCTAIdentity
→ MulticastMaskGeneration
→ BarrierReplicaTopology
→ ExpectedBarrierReplicaSet
→ per-replica expect_tx / arrival setup
→ leader TMA issue
→ one source tile read
→ cluster fanout
→ per-destination shared tile
→ complete_tx routed to expected barrier replica(s)
→ replica phase transition
→ CTA/group consumer wait
→ UMMA/MMA consumer
→ Attention output
```

### 與上一輪比較
上一輪回答：
`誰有權 signal？signal 幾次？`

本輪回答：
`signal 應該送去哪一份 barrier？一筆 TMA completion 應該讓哪些 CTA ready？`

因此：
```text
ClusterTMAReadyWitness =
  CorrectSignalerOwnership
  ∧ CorrectMulticastMaskGeneration
  ∧ CorrectBarrierReplicaTopology
  ∧ ExpectedBarrierReplicaSet == CompletionDestinationReplicaSet
  ∧ CorrectTxBytesPerReplica
  ∧ CorrectPhasePerReplica
  ∧ ConsumerWaitTargetsAuthorizedReplica
```

## Bottom-Level Logic

### Topology A：Per-CTA barrier replicas
```text
CTA0 mbar[s] expect N
CTA1 mbar[s] expect N
CTA2 mbar[s] expect N
CTA3 mbar[s] expect N
        ↓
Leader CTA issues one multicast TMA with mask 1111
        ↓
source tile read once / hardware fanout
        ↓
SMEM tile copied into CTA0..3
complete_tx delivered to mbar[s] in CTA0..3
        ↓
each CTA wait(local mbar[s], phase)
        ↓
all consumers may read their local tile
```

### Topology B：2-CTA group-leader collapsed barrier
```text
CTA0 leader barrier armed
CTA1 follower does not own independent completion barrier
→ TMA/group completion routed to leader barrier
→ leader observes ready
→ downstream 2-CTA protocol consumes/reuses readiness
```

### Failure A：multicast mask omission
```text
Expected CTA set = {0,1,2,3}
ctaMask = 0b0111
CTA3 waits on local barrier
→ no data / no complete_tx to CTA3 replica
→ MULTICAST_DESTINATION_OMISSION_DEADLOCK
```

### Failure B：hard-coded group mask
```text
cluster contains multiple 2-CTA groups
issuer group != group0
mask hard-coded to ranks 0,1
→ completion delivered to wrong replicas
→ intended group stalls
→ MULTICAST_GROUP_MASK_ALIAS
```

### Failure C：replica/collapsed topology confusion
```text
producer arms per-CTA replicas
consumer waits only leader-collapsed barrier
(or reverse)
→ readiness evidence cannot join
→ BARRIER_REPLICA_TOPOLOGY_MISMATCH
```

## Visual Simulation Idea
### Cluster TMA Fanout & Barrier Replica Map
Hermes Console 顯示 cluster grid：
```text
             Global KV tile
                  │
          Leader CTA TMA issue
                  │ ctaMask=1111
        ┌─────────┼─────────┬─────────┐
        ↓         ↓         ↓         ↓
      CTA0      CTA1      CTA2      CTA3
     SMEM P     SMEM P     SMEM P     SMEM P
     mbar[s]    mbar[s]    mbar[s]    mbar[s]
        ↓         ↓         ↓         ↓
      READY     READY     READY     READY
```
可切換：cluster size、CTA group、leader、mask、per-CTA vs collapsed barrier、stage/phase、bytes。直接產生：
- `MULTICAST_DESTINATION_OMISSION_DEADLOCK`
- `MULTICAST_GROUP_MASK_ALIAS`
- `BARRIER_REPLICA_TOPOLOGY_MISMATCH`
- `COMPLETION_TO_UNAUTHORIZED_REPLICA`
- `CONSUMER_WAIT_WRONG_CTA_REPLICA`
- `FANOUT_SOURCE_READ_MULTIPLICITY_MISATTRIBUTED`

## Code / GitHub
優先閱讀：
1. NVIDIA CUTLASS `PipelineTmaUmma`：`is_leader_cta`、`cta_group`、`_compute_mcast_arrival_mask`、`enable_multicast_signaling`。
2. CUTLASS primitives cluster TMA：`cp_async_bulk_tensor_shared_cluster_global`、multicast mask、CTA_1/CTA_2 group handling。
3. FlashInfer / FlashAttention-4 CuTe DSL：找實際2-CTA / multicast TMA callsites，確認paged KV decode是否採per-CTA或group-leader topology。
4. PTX `cp.async.bulk(.tensor).shared::cluster.global...multicast::cluster` lowering，追 `ctaMask + mbar` operands。

## Papers
### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling
- Authors: Ted Zadouri, Markus Hoehnerbach, Jay Shah, Timmy Liu, Vijay Thakkar, Tri Dao
- Year: 2026
- URL: https://arxiv.org/abs/2603.05451
- Architecture: Blackwell-oriented fully asynchronous attention pipeline, larger tiles, TMEM, 2-CTA MMA
- Contribution: B200 BF16最高1613 TFLOP/s、71% utilization；相對cuDNN 9.13最高1.3×
- Limitation: architecture-specific；論文本身不等於cluster TMA barrier correctness proof
- 改變了什麼：讓CTA group / 2-CTA execution identity必須進AttentionExecutionContract。

### Microbenchmark-Driven Analytical Performance Modeling Across Modern GPU Architectures
- Authors: Aaron Jarmusch, Sunita Chandrasekaran
- Year: 2026
- URL: https://arxiv.org/abs/2605.04178
- Architecture: B200與MI300A microbenchmark-driven analytical model；Blackwell模型顯式納入TMEM、TMA、5th-gen tensor cores
- Contribution: B200 21 kernels報告1.31% MAE，顯示TMA/TMEM不能用傳統roofline粗略替代
- Limitation: performance model，不直接驗證barrier topology
- 改變了什麼：支持Hermes把TMA topology與architecture-specific execution evidence獨立建模。

## Unknown / Open Questions
1. FlashInfer current paged decode在SM100上是否實際啟用cluster multicast / 2-CTA group，哪些kernel variant仍是local CTA TMA？
2. generated PTX/SASS trace能否穩定取得 `cluster_ctarank + ctaMask + mbar relative offset + phase + tx bytes`，形成唯一 `BarrierReplicaIdentity`？
3. 2-CTA MMA下，leader-collapsed readiness如何傳遞到follower consumer；是否還有額外 tcgen05 / cluster barrier edge需要加入？

## 下一輪研究
```text
FlashInfer / FlashAttention-4 / CUTLASS
→ 2-CTA / cluster execution variant selection
→ cta_layout_vmnk
→ CTAGroupIdentity
→ LeaderCTAIdentity
→ multicast mask construction
→ barrier replica topology
→ cp.async.bulk.tensor.shared::cluster
→ complete_tx destination replicas
→ consumer wait / tcgen05 commit
→ generated PTX/SASS
→ runtime cluster-rank attribution
→ KV causal probe
→ ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction
```

## Knowledge Graph 新增 Node / Edge
### Nodes
- `ClusterIdentity`
- `CTAGroupIdentity`
- `LeaderCTAIdentity`
- `MulticastMaskGeneration`
- `ExpectedDestinationCTASet`
- `BarrierReplicaTopology`
- `BarrierReplicaIdentity`
- `ExpectedBarrierReplicaSet`
- `CompletionDestinationReplicaSet`
- `SourceReadMultiplicity`
- `DestinationFanoutMultiplicity`
- `ClusterTMAReadyWitness`
- `MulticastDestinationOmissionState`
- `MulticastGroupMaskAliasState`
- `BarrierReplicaTopologyMismatchState`

### Edges
- `MulticastMaskGeneration --selects→ ExpectedDestinationCTASet`
- `ExpectedDestinationCTASet --maps_to→ ExpectedBarrierReplicaSet`
- `TMAIssueWitness --fans_out_to→ DestinationCTASet`
- `TMACompletionWitness --signals→ CompletionDestinationReplicaSet`
- `BarrierReplicaIdentity --includes→ ClusterRank`
- `DestinationFanoutMultiplicity --does_not_equal→ SourceReadMultiplicity`
- `SameCTArelativeBarrierOffset --does_not_imply→ SameBarrierReplicaIdentity`
- `ClusterSize --does_not_uniquely_determine→ BarrierReplicaTopology`
- `LeaderCTAIdentity --participates_in→ GroupLeaderCollapsedBarrierTopology`

## 本輪結束判定
- **缺哪一層：** cluster TMA source topology → generated PTX/SASS multicast operands → runtime destination replica trace。
- **哪個節點最淺：** `BarrierReplicaIdentity` 的 runtime witness。
- **哪個概念仍只是名詞：** request-scoped `CompletionDestinationReplicaSet`。
- **哪個系統值得讀原始碼：** CUTLASS `PipelineTmaUmma` + FlashAttention-4 / FlashInfer CuTe DSL 2-CTA callsites。
- **哪篇論文需追引用：** FlashAttention-4，特別是2-CTA MMA / TMEM / CuTe DSL後續實作與引用。
- **哪個概念最適合視覺模擬：** Cluster TMA Fanout & Barrier Replica Map。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Cluster/CTA Topology Verifier + TMA/Barrier Contract Verifier + Binary Instrumentation Controller + Request Trace Attribution Joiner + Causal KV Probe + Causal Evidence Gate + Tool Executor`。

本輪最大的推進：**Hermes 現在不只知道「誰 signal barrier」，而開始建模「一筆 cluster TMA completion 到底應該讓哪幾個 CTA 的哪一份 barrier replica ready」。這把 GPU correctness 從 thread/warp ownership再提升到 cluster-level routing topology。**