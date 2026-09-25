# 【AI Agent × Multimodal Research Report】

時間：2026-09-25 15:52（Asia/Taipei）

## 本小時新發現
本輪承接上一輪 LogicalTransactionGeneration / ExecutionAttemptGeneration / CommitCapability，直接閱讀 OpenUCX current source，第一次把「failed request 如何 restart」與「endpoint flush 如何 failover」落到具體函式與 request state。

已確認：
1. `ucp_proto_request_restart_or_complete()`：FAILOVER endpoint 且 EP 未 fully failed 時，失敗 request 不完成，而呼叫 `ucp_proto_request_restart(req)`。
2. `ucp_proto_request_restart()`：先呼叫當前 protocol 的 `reset(req)`；若 datatype iterator 已不在 begin，加入 `UCP_PROTO_SELECT_OP_FLAG_RESUME`；重新 protocol lookup/init 後再 `ucp_request_send(req)`。
3. endpoint flush failure 不是建立新 request object；同一 `ucp_request_t` 由 oneshot callback 執行 `ucp_ep_flush_request_reset()`，清 status/lane/completion count/started lanes/software flags，然後重新 progress。
4. flush 在 lane failure 時會 schedule `ucp_ep_set_lanes_failed_schedule()`；live lanes 改變後，flush progress 動態調整 expected completion count。
5. recovery retry exhaustion 不必等於 endpoint fully failed：測試顯示若仍有 live lanes，recovery_arg 可被清除、failed lanes 保留，而資料仍能經 live lane 流動。

## 本小時最重要 5 個發現

### 1. Request identity 與 Attempt identity 明確分離
同一 `ucp_request_t` 可以跨 protocol reset/reselection/re-send 存活。
因此：
`RequestPointer == LogicalOperationIdentity`（可近似）
但
`RequestPointer != ExecutionAttemptIdentity`。

### 2. restart 是 reset → resume-aware reselection → init → send
source-level state machine：
`transport/protocol error → restart_or_complete → proto.reset(req) → preserve iterator progress → add RESUME if partial → protocol lookup/init → request_send`。
這比「retry」更精確：已完成的 datatype progress可能被保留，新的 protocol attempt從剩餘進度繼續。

### 3. Flush failover 會重用 request object並重建內部 completion accounting
`ucp_ep_flush_request_reset()` 將 live lanes 重新取樣，重建 `uct_comp.count`、`all_lanes`、`started_lanes`、`sw_started/sw_done`。
因此 pointer、request object甚至 logical flush identity都不能作為 attempt epoch。

### 4. Flush completion 的舊 transport completion 有明確 discard-flow accounting
source comment 明確指出：started lane 已由 flush error、同步 OK decrement，或「pending UCT completion delivered via discard flow」計入。這表示 discard不是抽象概念，而是 completion accounting的一部分。
但目前仍未看到 explicit integer attempt epoch；安全性看起來主要由 reset/discard/order/state machine組合維持。

### 5. Recovery exhaustion ≠ endpoint death
`recovery_retries_exhausted_live_lanes` 測試證明：recovery retries耗盡後，只要還有live lane，endpoint不觸發總體 error callback，failed lane仍可維持failed，而新資料走live lane。
所以：
`RecoveryRound exhausted → degraded-but-live`
與
`Endpoint fully failed`
必須是不同Knowledge Graph節點。

## Architecture Breakdown
`Logical UCP Request
→ Protocol Attempt A_g
→ protocol error
→ restart_or_complete
→ protocol.reset
→ DatatypeIteratorProgressWitness
→ RESUME flag (if partial)
→ protocol reselection
→ protocol init
→ Attempt A_(g+1)
→ request_send
→ accepted terminal completion`

Flush：
`Logical Flush Request
→ live-lane snapshot
→ per-lane UCT flush
→ lane failure
→ mark lane failed
→ discard-flow completion accounting
→ oneshot restart
→ reset flush accounting against current live lanes
→ progress new flush attempt
→ logical flush completion`

## Bottom-Level Logic
新增建模：

`LogicalRequestGeneration = stable request lifetime`

`ExecutionAttemptGeneration = changes on protocol restart/failover`

`DatatypeProgressGeneration = iterator progress carried across attempts`

`FlushAccountingGeneration = {live_lane_snapshot, started_lanes, comp_count, sw_started, sw_done}`

最重要 invariant：

`AttemptReset(A_g) MUST revoke mutation/commit authority of A_g before A_(g+1) is allowed to commit`.

但 source 顯示 UCX 不一定以顯式 epoch 整數實作；可能透過 protocol reset、discard completion、callback ordering與request state共同建立 happens-before fence。這一點仍需下一輪驗證。

## Visual Simulation Idea
**UCP Request Restart / Resume / Flush Failover Microscope**

欄位：
`Logical Request | Request Pointer | Proto | Attempt | DT Iterator Offset | RESUME | Lane Map | Failed Lanes | Flush Count | Started Lanes | Discard Completion | Commit Eligibility`

故障注入：
`PARTIAL_ZCOPY_FAIL`
`FAIL_AFTER_ITERATOR_ADVANCE`
`FLUSH_LANE_FAIL`
`LATE_DISCARD_COMPLETION`
`RECOVERY_RETRIES_EXHAUSTED_WITH_LIVE_LANE`
`ALL_LANES_FAILED`

## Code / GitHub
OpenUCX值得看的核心檔案：
- `src/ucp/proto/proto_common.inl`: `ucp_proto_request_restart_or_complete`
- `src/ucp/proto/proto_common.c`: `ucp_proto_request_restart`, protocol reset/reselection
- `src/ucp/rma/flush.c`: lane failure、flush accounting reset、oneshot failover restart
- `src/ucp/core/ucp_ep.c`: failed lanes、discard、recovery state
- `test/gtest/ucp/test_ucp_fault_tolerance.cc`: recovery semantics與live-lane behavior

## Papers / 技術演進
基礎：Shamis et al., “UCX: An Open Source Framework for HPC Network APIs and Beyond”, HOTI 2015。
本輪關鍵工程演進：UCX 1.22.0（2026-08-02）加入 fault-tolerance recovery foundation、AM/zcopy/multi/PSN failover、endpoint flush failover、first-fragment retransmission。

## Unknown / Open Questions
1. `proto->reset(req)` 如何保證舊 UCT callbacks 在新 attempt init/send 後不能錯誤提交？
2. discard flow 的 completion 與 `ucp_ep_flush_request_reset()` 之間，最小 happens-before fence 在哪個 callback/refcount/state？
3. partial datatype iterator resume 對 AM/zcopy/multi/PSN 各 protocol 的「已傳輸片段 ownership」如何證明不重複/不遺漏？

## 下一輪研究
追：
`proto->reset implementations → zcopy/multi/PSN reset → outstanding UCT completion cancellation/discard → datatype iterator rewind/preserve → RESUME protocol selection → first-fragment retransmission → exactly-once logical completion`。

## Knowledge Graph 新增 Node / Edge
Nodes:
- `ProtocolResetWitness`
- `DatatypeIteratorProgressWitness`
- `ResumeProtocolSelectionGeneration`
- `FlushAccountingGeneration`
- `DiscardCompletionAccountingWitness`
- `DegradedLiveEndpointState`
- `RecoveryExhaustionWitness`
- `RequestObjectAttemptAlias`

Edges:
- `LogicalRequestGeneration --has_many→ ExecutionAttemptGeneration`
- `ProtocolFailure --triggers→ ProtocolResetWitness`
- `ProtocolResetWitness --preserves_or_rewinds→ DatatypeIteratorProgressWitness`
- `DatatypeIteratorProgressWitness --selects→ ResumeProtocolSelectionGeneration`
- `LaneFailure --changes→ FlushAccountingGeneration`
- `DiscardFlow --contributes_to→ FlushAccountingGeneration`
- `RecoveryExhaustionWitness --may_transition_to→ DegradedLiveEndpointState`
- `RequestPointerReuseAcrossAttempts --does_not_imply→ AttemptIdentity`

## 本輪結束判斷
缺的層：各 protocol reset implementation 到 UCT callback/discard 的完整 happens-before。
最淺節點：`ProtocolResetWitness → stale callback rejection`。
仍只是名詞：portable `AttemptCommitRevocationEpoch`。
最值得讀原始碼：OpenUCX zcopy/multi/PSN protocol reset與discard flow。
最值得追引用：UCX 1.22 fault-tolerance implementation commits/PR。
最適合視覺模擬：Request Restart / Resume / Flush Failover Microscope。
最值得 Hermes 實作：`Event-sourced Agent Runtime + stable LogicalRequest + explicit ExecutionAttemptEpoch + resumable progress cursor + revocable CommitCapability`。
