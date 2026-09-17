# 【AI Agent × Multimodal Research Report】

時間：2026-09-17 15:51（Asia/Taipei）

主題：etcd-cpp-apiv3 AsyncWatchAction × compact_revision × NIXL watcher failure × Serving Freshness State Machine

## 與歷史研究比較

上一輪已確認：etcd Watch `start_revision` 是 inclusive；NIXL persistent agent watcher 在 `fetch/loadRemoteMD` 後才建立，且沒有傳 explicit revision，因此存在 Snapshot→Watch freshness gap candidate。本輪不重複該結論，而是向下一層追 `etcd-cpp-apiv3` 的 `AsyncWatchAction`，確認 compaction / cancellation 如何被轉成 C++ `Response`，再對照 NIXL callback 是否真的消費這些 failure semantics。

## 本小時新發現

1. `AsyncWatchAction` 直接把 `parameters.revision` 寫進 `WatchCreateRequest.start_revision`；client library 沒有額外 fencing、沒有自動 +1。
2. callback-mode watcher 收到 `reply.canceled()` 且 `compact_revision != 0` 時，會先 `ParseResponse()` 再 callback 給應用程式。
3. `AsyncWatchResponse::ParseResponse()` 將 compaction 映射成 `grpc::StatusCode::OUT_OF_RANGE`，訊息為 `required revision has been compacted`，並保存 `compact_revision`。因此 compaction 並沒有被 library 吞掉；NIXL 有能力辨識它。
4. NIXL persistent watcher callback 對所有 `!response.is_ok()` 目前只 log + return；沒有依 `compact_revision` 做 resnapshot/re-arm，也沒有撤銷 Serving freshness。
5. NIXL DELETE callback 雖可讀 `event.kv().modified_index()`，enqueue 到 `invalidatedAgents_` 時仍只保存 agent name；revision 在 application side-effect boundary 被丟失。

## 本小時最重要 5 個發現

### 1. Compaction 是可觀測的 typed failure，不是黑盒斷線

**已確認工程實作：** etcd-cpp-apiv3 在 watch response `canceled && compact_revision != 0` 時建立錯誤 Response；`AsyncWatchResponse::ParseResponse` 使用 OUT_OF_RANGE 並保存 compact revision。

底層流程：

```text
Watch(start=R100)
→ etcd history 已 compact 到 R500
→ WatchResponse{canceled=true, compact_revision=R500}
→ AsyncWatchAction
→ ParseResponse
→ Response.error = OUT_OF_RANGE
→ Response.compact_revision = R500
→ application callback
```

重要性：Runtime 可以精確區分「暫時網路錯誤」與「增量歷史已不可恢復」。後者必須 resnapshot，而不是盲目 reconnect。

限制：本輪確認的是 etcd-cpp-apiv3 main；NIXL build 實際 pin 的 dependency commit/version仍需下一輪核對。

### 2. NIXL 目前沒有把 typed watch failure 升級成 freshness state transition

**已確認工程實作：** NIXL `setupAgentWatcher()` callback 遇到 `!response.is_ok()` 只輸出錯誤並 return。

因此目前可見路徑是：

```text
WatcherFailure / ErrCompacted
→ log
→ return
```

而不是：

```text
WatcherFailure
→ Freshness UNKNOWN
→ ServingReady revoke
→ resume or resnapshot
→ rebuild generation
→ probe
→ republish
```

**合理推論：** 若 watcher 終止而已載入的 remote metadata 仍留在 runtime，應用層可能缺乏「我已無法證明這份 metadata 仍新鮮」的顯式狀態。這不是在宣稱已證實 stale transfer bug；需要 failure-injection reproducer。

### 3. Watcher correctness 至少需要兩種 recovery，而不是一個 retry loop

**官方語意 + 工程模型：** etcd 支援從歷史 revision watch；但 start revision 若已 compact，server 取消 watcher並回 compact_revision。

因此 recovery state machine 必須分支：

```text
WATCH_FAILED
├─ history still available
│  → Watch(lastAppliedRevision + 1)
│  → replay
│  → FRESH
└─ OUT_OF_RANGE / compacted
   → FRESHNESS_UNKNOWN
   → linearizable snapshot
   → rebuild runtime projection
   → Watch(snapshotRevision + 1)
   → probe
   → FRESH
```

### 4. Revision 在 etcd→NIXL side-effect boundary 被降維

NIXL callback 能看到：

```text
DELETE peer=A @ revision R101
```

但 queue 目前是：

```text
invalidatedAgents_.push_back("A")
```

不是：

```text
InvalidationEvent {
  peer: A,
  observedRevision: R101,
  incarnation: G7
}
```

這使 storage ordering information 無法直接參與稍後的 conditional revocation。這是上一輪 ABA 問題的更具體底層原因。

### 5. ServingReady 應是 freshness proof 的衍生狀態

Hermes 建議的 unified state：

```text
UNINITIALIZED
→ SNAPSHOT_LOADED(R)
→ WATCH_BOUND(R+1)
→ FRESH
→ DEGRADED / WATCH_FAILED
→ UNKNOWN
→ RESYNCING
→ PROBED
→ FRESH
```

`ServingReady` 不應只依賴 process health；應依賴：

```text
ProcessReady
∧ MetadataGenerationValid
∧ WatchCoverageProven
∧ RuntimeAppliedRevision >= requiredRevision
∧ TransferProbePassed
```

這是 Hermes correctness model，並非宣稱 NIXL/vLLM/SGLang 已如此實作。

## Architecture Breakdown

### etcd-cpp-apiv3 Watch path

```text
Watcher
→ ActionParameters{key, prefix, revision}
→ AsyncWatchAction
→ grpc AsyncWatch stream
→ WatchCreateRequest
   ├ key/range
   ├ prev_kv=true
   └ start_revision=parameters.revision
→ CompletionQueue
→ WatchResponse
   ├ events[]
   ├ canceled
   └ compact_revision
→ AsyncWatchResponse::ParseResponse
→ etcd::Response
→ application callback
```

### NIXL metadata control path

```text
fetchRemote(peer)
→ fetchOrWaitForMetadataFromEtcd
→ loadRemoteMD(blob)
→ verify loaded_name
→ setupAgentWatcher(peer)
→ etcd::Watcher(prefix, callback)
→ DELETE event
→ invalidatedAgents_[peer]
→ serviceEvents
→ processInvalidatedAgents
→ erase watcher
→ invalidateRemoteMD(peer)
```

Failure branch currently observed:

```text
Watcher Response !is_ok
→ log
→ return
```

## Bottom-Level Logic

### Compaction mapping

```text
server MVCC history compacted
→ WatchCreateRequest(start_revision < compact_revision)
→ WatchResponse.canceled = true
→ WatchResponse.compact_revision = C
→ AsyncWatchAction callback path detects C != 0
→ ParseResponse
→ error_code = OUT_OF_RANGE
→ compact_revision = C
→ application receives typed failure
```

### Correct resynchronization primitive

```text
watch failure
→ classify(error)
→ if resumable:
     start = LastAppliedRevision + 1
     replay
  else if compacted:
     revoke freshness proof
     linearizable GET snapshot
     SnapshotRevision = response.header.revision
     rebuild generation
     Watch(SnapshotRevision + 1)
→ wait until watch boundary established
→ transfer/metadata probe
→ publish ServingReady
```

## Visual Simulation Idea

### Watch Failure & Freshness State Machine Simulator

五條泳道：

```text
etcd MVCC | R100 ---- compact(C=500) ---- R501
Watcher   | watch100 → OUT_OF_RANGE ----- watch502
NIXL      | G7 loaded → log/error → resnapshot → G8
Freshness | FRESH ---- UNKNOWN ---------- PROVING → FRESH
Serving   | READY ---- REVOKED ---------- PROBE → READY
```

互動控制：`Disconnect Watch`、`Delay Consumer`、`Compact History`、`DELETE Peer`、`PUT New Generation`、`Resume LastApplied+1`、`Resnapshot`、`Inject Old Invalidation`。UI 同時顯示 SnapshotRevision、WatchStartRevision、WatchDeliveredRevision、RuntimeAppliedRevision、CompactRevision。

## Code / GitHub

### etcd-cpp-apiv3

值得看的核心檔案：
- `src/v3/AsyncGRPC.cpp`：`AsyncWatchAction` constructor、callback `waitForResponse()`、`AsyncWatchResponse::ParseResponse()`。
- `src/Watcher.cpp`：Watcher 封裝與 Action 建立。
- `etcd/Response.hpp` / `src/Response.cpp`：`compact_revision()` 暴露到 application layer。
- `tst/RewatchTest.cpp`：library 官方 reconnect pattern。

### NIXL

核心檔案：
- `src/core/nixl_etcd_metadata_backend.cpp`
  - `setupAgentWatcher()`
  - `processInvalidatedAgents()`
  - `fetchRemote()`
  - `waitForMetadataFromEtcd()`

本輪原始碼結論：etcd-cpp-apiv3 已把 compaction signal 傳到 application；NIXL callback 目前未見 compaction-specific recovery。

## Papers

本輪沒有為了湊數重複加入既有 Raft 論文；重點是完成上一輪留下的 library/runtime source gap。下一輪若擴展到 cache/watch correctness，優先追 distributed cache consistency、materialized-view maintenance 與 fencing token 相關論文，而非重複一般 consensus 介紹。

## Unknown / Open Questions

1. NIXL 當前 build 實際使用的 etcd-cpp-apiv3 commit/version，是否與本輪 main source 的 compaction callback semantics 完全一致？
2. Watch stream 非 compaction 的 network termination 時，NIXL 的 `etcd::Watcher` object 是否仍留在 `agentWatchers_`，進而使後續 `setupAgentWatcher()` 因「already registered」而無法真正 re-arm？
3. `fetchRemote()` 的 snapshot→persistent watcher gap 是否可用 deterministic barrier reproducer 證明 DELETE event 遺失，並導致舊 RemoteSection 持續 published？

## 下一輪研究

優先：

```text
NIXL dependency pin
→ etcd-cpp-apiv3 Watcher::Wait lifecycle
→ failed watcher object state
→ agentWatchers_ ownership
→ reconnect/re-arm suppression
→ deterministic DELETE-in-gap test
→ revision-aware InvalidationEvent
→ Unified Freshness Fence
```

並設計最小測試：

```text
1. publish peer G7
2. fetch snapshot @ R100
3. pause before setupAgentWatcher
4. DELETE peer @ R101
5. resume watcher creation without explicit revision
6. observe whether R101 is delivered
7. inspect RemoteSection / Serving state
8. repeat with Watch(R101)
9. compact past lastApplied and verify resnapshot branch
```

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `WatchTypedFailure`
- `CompactionRevision`
- `WatchCoverageProof`
- `PersistentWatcherFailure`
- `FreshnessStateMachine`
- `ResumableWatchRecovery`
- `CompactionResnapshotRecovery`
- `WatcherObjectLiveness`
- `RearmSuppression`
- `RevisionAwareInvalidationEvent`
- `ServingFreshnessRevocation`

新增 Edges：

```text
CompactionRevision → invalidates → IncrementalReplayProof
WatchTypedFailure → should_trigger → FreshnessStateTransition
PersistentWatcherFailure → invalidates → WatchCoverageProof
WatchCoverageProof → required_by → ServingReady
RuntimeAppliedRevision → fences → InvalidationEvent
CompactionResnapshotRecovery → rebuilds → MetadataGeneration
WatcherObjectLiveness → may_block → WatcherRearm
```

## 本輪結束判斷

- 缺哪一層：NIXL watcher object lifecycle / reconnect ownership 到 ServingReady 的完整 failure transaction。
- 哪個節點最淺：`WatcherObjectLiveness`。
- 哪個概念仍只是名詞：`UnifiedFreshnessFence`，尚未在 NIXL 找到對應完整實作。
- 哪個系統最值得讀原始碼：NIXL `nixl_etcd_metadata_backend.cpp` + etcd-cpp-apiv3 `Watcher.cpp/AsyncGRPC.cpp`。
- 哪篇論文需追引用：本輪不重複舊論文；下一輪轉向 materialized-view/watch consistency 與 fencing literature。
- 哪個概念最適合視覺模擬：Watch Failure & Freshness State Machine。
- 哪個 Agent 架構最值得實作：對 Agent/MCP/remote-model/GPU peer 共用的 `Detect → Revoke Freshness → Resume/Resnapshot → Rebuild → Probe → Republish → Retry` recovery loop。

## 對「AI 到底怎麼運作」的新增拼圖

```text
使用者一句話
→ UI
→ Agent Runtime
→ Context / Reasoning / Planning / Memory / Tools / MCP
→ Model
→ KV / Multimodal State
→ Distributed Metadata
→ etcd Raft/MVCC
→ Snapshot Revision
→ Watch Coverage
→ Runtime Applied Revision
→ Freshness / Generation Gate
→ NIXL
→ UCX
→ GPU / NIC
→ Attention / Decoder
→ Logits
→ Output
```

本輪核心結論：**etcd-cpp-apiv3 已經把「歷史被 compact、無法再靠增量事件證明狀態」明確傳給應用層；真正的 correctness 缺口因此不在 storage 是否報錯，而在 AI Runtime 是否把這個 typed failure 轉成 freshness revocation、resnapshot、generation rebuild 與 ServingReady 的重新證明。**