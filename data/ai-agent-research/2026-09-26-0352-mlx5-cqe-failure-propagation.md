# AI Agent × Multimodal Research Report — 2026-09-26 03:52 Asia/Taipei

## 本輪主題
Remote stale-rkey failure witness: mlx5 CQE syndrome → UCS error → endpoint/session failure boundary.

## 與歷史研究比較
上一輪已確認 LOCAL_INV WQE + successful completion 可作為 local revocation-completion witness，並區分 DestroyAndQuarantine 與 InvalidateAndReuse。這輪不再重複 invalidate/reuse，而追「舊 remote capability 真被使用時，錯誤如何向 runtime 上傳」。

## 本小時最重要 5 個發現
1. **mlx5 error CQE 是具體 failure witness。** OpenUCX `src/uct/ib/mlx5/ib_mlx5_log.c` 將 `MLX5_CQE_SYNDROME_REMOTE_ACCESS_ERR` 標成 "Remote access error"，並映射為 `UCS_ERR_CONNECTION_RESET`。因此 stale/invalid remote access 若由 HCA 以此 syndrome 回報，已不是模糊 timeout，而是 transport-visible connection failure。
2. **Remote operation error 同樣映射 connection reset。** `MLX5_CQE_SYNDROME_REMOTE_OP_ERR` → `UCS_ERR_CONNECTION_RESET`。這說明 UCX 將部分 remote capability/operation violations提升成 endpoint/session 級故障，而不是只讓單一 WQE 局部失敗。
3. **Timeout 是另一種 failure class。** `TRANSPORT_RETRY_EXC_ERR`、`RNR_RETRY_EXC_ERR`、`REMOTE_ABORTED_ERR` 被映射為 `UCS_ERR_ENDPOINT_TIMEOUT`；因此 Hermes 不應把「remote access violation」與「peer unreachable/retry exhausted」混成同一 retry reason。
4. **CQE parser 還會定位到實際 WQE。** 對 request error CQE，OpenUCX 取得 offending WQE 並 dump remote QP / WQE metadata。這建立了 `FailureWitness → PhysicalOperation` 的可觀測邊，適合直接搬進 Hermes trace model。
5. **不能把所有 RDMA error 都叫 stale-rkey。** 工程案例可看到 RDMA_READ / RDMA_WRITE 的 rkey/lkey 與 syndrome，但 transport retry exceeded (0x15) 是 timeout 類，不足以證明 stale rkey；只有 remote-access/protection 類 syndrome 加上對應 operation/context 才能升級為 capability failure evidence。

## Architecture Breakdown
`Remote Capability Generation`
→ RDMA WQE (rkey)
→ mlx5 HCA
→ success OR error CQE
→ syndrome classifier
→ `UCS_ERR_CONNECTION_RESET | UCS_ERR_ENDPOINT_TIMEOUT | UCS_ERR_CANCELED | ...`
→ UCT endpoint error path
→ UCP endpoint/failover policy
→ SessionGeneration transition
→ outstanding operation resolution
→ retry/restart under new capability/session generation
→ generation-aware logical commit.

新的三層 failure taxonomy：
- Capability/remote-access failure → connection reset class
- Reachability/retry exhaustion → endpoint timeout class
- Local teardown/QP error flushing → canceled class

## Bottom-Level Logic
已確認 source-level mapping：
- `REMOTE_ACCESS_ERR → UCS_ERR_CONNECTION_RESET`
- `REMOTE_OP_ERR → UCS_ERR_CONNECTION_RESET`
- `TRANSPORT_RETRY_EXC_ERR → UCS_ERR_ENDPOINT_TIMEOUT`
- `RNR_RETRY_EXC_ERR → UCS_ERR_ENDPOINT_TIMEOUT`
- `WR_FLUSH_ERR → UCS_ERR_CANCELED`

新增 invariant：
`Commit(result) requires result.session_generation == active.session_generation AND result.capability_generation == active.capability_generation`.

新增證據規則：
`RemoteStaleKeyFailureWitness` 不能只由 timeout 推定；至少需要 remote-access/protection-class error + offending operation/capability context，或更直接的 hardware/transport evidence。

## Visual Simulation Idea
**CQE → Agent Failure Propagation Simulator**

互動欄位：
`LogicalTxn | SessionGen | CapabilityGen | Attempt | WQE opcode | rkey | CQE syndrome | UCS status | EP state | Failover action | OutstandingOps | CommitEligible`

故障注入：
- REMOTE_ACCESS_ERR
- REMOTE_OP_ERR
- TRANSPORT_RETRY_EXCEEDED
- WR_FLUSH_AFTER_QP_ERROR
- LATE_SUCCESS_OLD_SESSION
- SAME_RKEY_NEW_CAPABILITY_GENERATION

使用者可看到硬體 CQE 如何一路改變 Agent runtime 的 retry/commit 決策。

## Code / GitHub
核心原始碼：
- openucx/ucx: `src/uct/ib/mlx5/ib_mlx5_log.c`
- 下一輪：RC/DC mlx5 CQ polling/error handlers、UCT endpoint error callback、UCP failover/restart path。

工程案例中可觀察到 UCX log 同時 dump RDMA_READ 的 remote VA/rkey 與 local VA/lkey；但 transport retry syndrome 0x15 應歸類 timeout，而非直接視為 stale-rkey 證據。

## Papers
基礎架構仍以 Shamis et al., *UCX: An Open Source Framework for HPC Network APIs and Beyond*, HOTI 2015 為歷史起點。current mlx5 CQE error mapping、DevX invalidation、fault-tolerance semantics屬後續工程演化，不倒推為 2015 paper 結果。

## Unknown / Open Questions
1. `UCS_ERR_CONNECTION_RESET` 從 RC/DC mlx5 completion handler 到 UCP endpoint failover/restart 的精確 callback/state transition。
2. QP 進 error state後，outstanding WQE 的 flush completion是否形成足夠強的 `RemoteEffectDrainWitness`。
3. failover/recreate endpoint時，舊 SessionGeneration 的 late completion在哪一層被 fence 掉。

## Knowledge Graph 新增 Node / Edge
Nodes:
- Mlx5ErrorCQEWitness
- RemoteAccessFailureWitness
- EndpointTimeoutWitness
- PhysicalWQEFailureAttribution
- FailureClass
- SessionFailureBoundary
- RemoteEffectDrainWitness

Edges:
- RemoteCapabilityUse → materializes_as → RDMA_WQE
- RDMA_WQE → may_produce → Mlx5ErrorCQEWitness
- REMOTE_ACCESS_ERR → maps_to → UCS_ERR_CONNECTION_RESET
- TRANSPORT_RETRY_EXC_ERR → maps_to → UCS_ERR_ENDPOINT_TIMEOUT
- Mlx5ErrorCQEWitness → attributes_failure_to → PhysicalWQE
- ConnectionResetClass → triggers → SessionFailureBoundary
- SessionGeneration → gates → CommitEligibility

重要否定關係：
- TimeoutWitness --does_not_imply→ StaleRKey
- SameRKeyValue --does_not_imply→ SameCapabilityGeneration

## 本輪結論與下一輪
缺的層：UCT endpoint error → UCP failover → outstanding-WQE purge/drain。
最淺節點：RemoteEffectDrainWitness。
仍只是名詞：跨 RC/DC/UD 與 Agent runtime 通用的 SessionFailureBoundary。
最值得讀原始碼：OpenUCX RC/DC mlx5 error completion + UCP endpoint fault-tolerance path。
最值得追引用：UCX fault-tolerance / protocol failover implementation commits。
最適合視覺模擬：CQE → Agent Failure Propagation Simulator。
最值得 Hermes 實作：Event-sourced Runtime + typed FailureWitness + SessionGeneration + CapabilityGeneration + generation-aware Commit Gate。

下一輪：
`mlx5 error CQE → RC/DC completion handler → UCT ep error callback → UCP endpoint failover → outstanding request purge/drain → new SessionGeneration → late completion fencing → exactly-once logical commit`.
