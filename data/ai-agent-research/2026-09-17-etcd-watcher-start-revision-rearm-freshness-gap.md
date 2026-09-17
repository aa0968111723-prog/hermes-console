# 【AI Agent × Multimodal Research Report】

**時間：2026-09-17 14:52（Asia/Taipei）**  
**本輪主題：etcd-cpp-apiv3 Watcher Start Revision × NIXL Re-arm Gap × Compaction/Freshness Recovery**

## 本小時新發現

本輪延續上一輪 Snapshot→Watch/Compaction 研究，不重複停留在「etcd 有 revision」；直接追到 etcd-cpp-apiv3 `Watcher.cpp` 與 NIXL `nixl_etcd_metadata_backend.cpp`。

已確認：etcd `WatchCreateRequest.start_revision` 是 **inclusive**。etcd-cpp-apiv3 `Watcher` 若 `fromIndex >= 0`，直接把 `params.revision = fromIndex` 傳給底層 AsyncWatchAction，沒有自動 +1。其 README 的 continuous-watch 範例反而明確由 caller 使用 `index + 1`。

NIXL `waitForMetadataFromEtcd()` 目前先 GET，取得 `response.index()`，然後直接 `Watcher(..., watch_index, ...)`。因此它是在 snapshot/header revision 本身開始 inclusive watch，而不是明確的 R+1。這通常可避免 GET→Watch 缺事件，但可能重播 R 上的事件；callback 的 `promise_set` 讓這條一次性等待路徑只接受第一個事件。

更重要的是 persistent agent watcher：`setupAgentWatcher(remote_name)` 使用沒有 revision 的 Watcher constructor，也就是 watch from "now"；而它是在 `ctx_.loadRemoteMD(blob)` 成功之後才建立。這形成一個值得驗證的 freshness window：metadata fetch/load 完成與 persistent invalidation watch 真正建立之間，如果 agent prefix 被 DELETE，是否可能錯過 invalidation，取決於 watcher create 時 server revision 與事件發生順序。這不是已證明 bug，而是原始碼可見的 correctness gap candidate。

## 本小時最重要 5 個發現

### 1. Watch start revision 是 inclusive，而不是 exclusive
- **已確認事實 / 官方 API**：etcd `start_revision` 從指定 revision **inclusive** 開始。
- **工程實作**：etcd-cpp-apiv3 `Watcher::doWatch()` 將 `fromIndex` 原樣寫入 `params.revision`。
- **為什麼重要**：Snapshot@R 後若希望只接後續事件，caller 應明確選擇 R 或 R+1，並理解 replay/dedup semantics。
- **限制**：不同 client wrapper 可能自行調整 revision；本結論特指 etcd-cpp-apiv3 當前原始碼。

### 2. NIXL 一次性 wait path 選擇 GET response.index() → inclusive Watch(R)
底層流程：
`GET(key) → response.index()=R → Watcher(key,R) → params.revision=R → first event → promise_set → Cancel()`。
這偏向 at-least-once/replay-safe，而不是 exactly-once。若 R 的事件被重播，consumer 必須能容忍。

### 3. Persistent invalidation watcher 沒有綁 snapshot revision
NIXL `fetchRemote()`：
`fetchOrWaitForMetadata → loadRemoteMD → verify name → setupAgentWatcher()`。
`setupAgentWatcher()` 使用 `Watcher(client,prefix,callback)`，沒有 `fromIndex`，因此沒有顯式 SnapshotRevision→WatchStartRevision fencing。
合理推論：這裡應研究 `Snapshot R → Watch R+1` 或 transaction/watch barrier，避免 metadata materialization 與 invalidation subscription 之間的 freshness proof 缺口。

### 4. Watcher 斷線不會由 etcd-cpp-apiv3 自動恢復
- **官方 client README**：Watcher 因 server restart/network failure 中斷時，由使用者決定是否 reconnect；範例用 `Wait()` callback 重建 watcher。
- **NIXL 現況**：persistent watcher callback 對 `!response.is_ok()` 只 log error；本輪讀到的 `setupAgentWatcher` 沒有看到 automatic re-arm/resnapshot state machine。
- **影響**：watch failure 後若仍把 remote metadata 視為 fresh，ServingFreshnessProof 可能失效。

### 5. Compaction failure 必須升級成 resnapshot，而不是盲目 rewatch
etcd WatchResponse 在 requested revision 已 compact 時提供 `compact_revision` 並 cancel watcher；官方要求不要再用同一 start_revision 建 watch。正確 recovery 應是：
`Watch failure/compacted → freshness UNKNOWN → revoke serving publication → fresh linearizable snapshot → rebuild metadata generation → establish new watch boundary → transfer probe → republish`。

## Architecture Breakdown

### System Architecture：Revision-Fenced Metadata Watch Runtime

```text
etcd/Raft/MVCC
  ↓ linearizable snapshot
Snapshot G8 @ revision R
  ↓
Metadata Materializer
  ↓
RemoteSection / Endpoint / RKey capability
  ↓
Watch Boundary(start_revision)
  ↓
Watch Stream
  ↓
RuntimeAppliedRevision
  ↓
Freshness Gate
  ↓
Transfer Probe
  ↓
ServingReady
```

Failure path：

```text
watch disconnect / ErrCompacted
→ FreshnessProof LOST
→ stop publishing G8 as trusted
→ snapshot current state @ R2
→ rebuild generation G9
→ establish watch from explicit boundary
→ probe G9
→ ServingReady
```

## Bottom-Level Logic

### `Watcher(fromIndex)` 真正發生什麼

```text
Caller fromIndex
→ Watcher ctor stores fromIndex
→ doWatch()
→ ActionParameters.params.revision = fromIndex
→ AsyncWatchAction
→ etcd WatchCreateRequest.start_revision
→ server streams events revision >= start_revision
```

因此：

```text
Snapshot revision = R
Watch(R)   = inclusive replay boundary
Watch(R+1) = strict post-snapshot boundary
Watch(no revision) = current watch-creation boundary, not snapshot-bound
```

對 distributed AI control plane，這三種不是同義詞。

## Visual Simulation Idea

### Snapshot–Watch Freshness Gap Microscope

四泳道：`etcd MVCC | NIXL fetch/load | Watcher | Serving capability`。

互動事件：
- GET snapshot @ R100
- load G8
- DELETE peer @ R101
- delay watcher creation
- create Watch(now)
- create Watch(R100)
- create Watch(R101)
- network disconnect
- compact to R150
- reconnect from old revision
- resnapshot

UI 顯示三個 watermark：`SnapshotRevision / WatchStartRevision / RuntimeAppliedRevision`，並顯示 `Freshness = PROVEN / UNKNOWN / STALE`。

## Code / GitHub

### etcd-cpp-apiv3
值得持續讀：
- `src/Watcher.cpp`：constructor、`doWatch()`、Cancel/Wait、fromIndex 傳遞。
- `src/v3/AsyncGRPC.cpp/.hpp`：`AsyncWatchAction` 如何建立 WatchCreateRequest、如何把 compact/cancel/error 轉成 Response。
- `tst/RewatchTest.cpp`：client reconnect pattern。

### NIXL
- `src/core/nixl_etcd_metadata_backend.cpp`
  - `fetchMetadataFromEtcd`
  - `waitForMetadataFromEtcd`
  - `fetchOrWaitForMetadataFromEtcd`
  - `setupAgentWatcher`
  - `processInvalidatedAgents`
  - `fetchRemote`

## Papers / foundational references

本輪核心不是新增產品新聞，而是補 distributed-system correctness foundation。應持續追：
- Ongaro & Ousterhout, **In Search of an Understandable Consensus Algorithm (Raft)**, Stanford, 2014。貢獻：replicated log/consensus safety；限制：Raft 的 log ordering 不自動等於 application projection 的 freshness。
- etcd MVCC/Watch API guarantees：把 replicated state revision 暴露給 client，但 client 仍需自行保存 snapshot/watch/application-applied boundary。

## Unknown / Open Questions

1. etcd-cpp-apiv3 `AsyncWatchAction` 對 `compact_revision`、stream error、watch cancellation 的 Response mapping 是否保留足夠資訊讓 NIXL做精確 resnapshot？
2. NIXL persistent `setupAgentWatcher()` 在 `loadRemoteMD` 後才 Watch(now)，是否能構造可重現的 DELETE-in-gap testcase？
3. P2P `INVL` 與 etcd DELETE 若同時存在，如何建立共用 `IncarnationFence(peer,generation,revision/source-seq)` 而不讓舊事件撤銷新 generation？

## 下一輪研究

鎖定：`etcd-cpp-apiv3 AsyncWatchAction × compact_revision/error mapping × NIXL persistent watcher failure lifecycle × DELETE-in-gap reproducer × P2P/etcd unified fence`。

優先驗證：
`fetch G8@R100 → load G8 → DELETE@R101 before setupAgentWatcher → Watch(now) → 是否永遠看不到 R101 → G8 是否仍被視為有效`。

若成立，再設計 revision-aware patch；若不成立，找出 server/client 哪一層提供了隱含 barrier。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `WatchStartRevision`
- `InclusiveWatchBoundary`
- `SnapshotWatchGap`
- `PersistentWatcherFreshness`
- `WatcherFailureState`
- `WatcherRearm`
- `ResnapshotRequired`
- `FreshnessUnknown`
- `RevisionReplay`
- `ApplicationDedupBoundary`

### Edges
- `SnapshotRevision → defines candidate WatchStartRevision`
- `WatchStartRevision → constrains EventReplaySet`
- `WatcherFailure → invalidates ServingFreshnessProof`
- `Compaction → requires Resnapshot`
- `PersistentWatcherCreation → must be ordered with CapabilityPublication`
- `RuntimeAppliedRevision → gates ServingReady`

## 本輪結束判斷

- **缺哪一層**：AsyncWatchAction 的 compaction/error mapping，以及 NIXL watcher failure→resnapshot ownership。
- **哪個節點最淺**：`PersistentWatcherFreshness`。
- **哪個概念仍只是名詞**：`UnifiedIncarnationFence`，尚未確認 NIXL 有完整實作。
- **哪個系統最值得讀原始碼**：etcd-cpp-apiv3 `AsyncWatchAction` + NIXL metadata backend。
- **哪篇論文需追引用**：Raft 之後應追 MVCC/watch/client-side materialized-view consistency 文獻。
- **最適合視覺模擬**：Snapshot–Watch Freshness Gap Microscope。
- **最值得實作的 Agent 架構模式**：`Detect freshness loss → Revoke → Resnapshot → Rebuild generation → Rewatch → Probe → Republish → Retry`。

## 對「AI 到底怎麼運作」的新增還原

```text
User
→ UI
→ Agent / Planner / Memory / Tools / MCP
→ Model
→ KV / Multimodal State
→ Distributed Metadata
→ Raft Commit
→ MVCC Revision
→ Snapshot
→ Watch Start Revision
→ Event Stream
→ Runtime Applied Revision
→ Freshness / Generation Gate
→ NIXL / UCX
→ GPU / NIC
→ Attention
→ Logits
→ Output
```

**核心結論**：底層 storage 有一致性仍不夠。AI Runtime 必須把「snapshot 在哪個 revision、watch 從哪個 revision 開始、runtime 已套用到哪個 revision」變成可觀測且可驗證的 execution state；watch 一旦失聯或 history 被 compact，remote Agent/GPU capability 的 freshness 就不應被默認為仍然成立。