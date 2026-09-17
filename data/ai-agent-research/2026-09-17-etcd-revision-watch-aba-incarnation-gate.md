# 【AI Agent × Multimodal Research Report】

時間：2026-09-17 12:54（Asia/Taipei）

## 本小時新發現

本輪延續上一輪 Remote Metadata Invalidation / Recovery Transaction，專門驗證 etcd revision、watch ordering 與 ABA（舊 DELETE / invalidation 是否可能誤傷新 incarnation）。重點不是新聞，而是把 NIXL metadata control plane 拆到事件版本與 watcher 實作。

### 已確認事實 / 官方資訊

1. etcd watch 事件依 revision 有序、唯一、可靠、atomic、可 resume；但 watch 本身不是 linearizable，client 必須檢查 revision 才能與其他操作建立正確 ordering。官方 API guarantees 明確如此定義。
2. NIXL `storeMetadataInEtcd()` 在 PUT 成功時可以取得並記錄 `modified_index()`；`fetchMetadataFromEtcd()` GET 成功也能取得 `modified_index()`。
3. NIXL persistent agent watcher 收到 DELETE 時也取得並 log `event.kv().modified_index()`，但目前 enqueue 到 `invalidatedAgents_` 的內容只有 `agent_name`，revision 沒有一起保存。
4. `processInvalidatedAgents()` 後續只以 agent name 呼叫 `invalidateRemoteMD(agent)`；因此在目前讀到的這條 path 中，DELETE revision 沒有進入 invalidation decision。
5. NIXL watcher DELETE callback 與真正 invalidation 是兩階段：callback enqueue → communication worker `serviceEvents()` → `processInvalidatedAgents()` → `invalidateRemoteMD()`。這降低 callback 內直接 teardown 的 race，但也引入「事件觀察時間」與「實際撤銷時間」之間的窗口。

### 工程實作 / 已觀察風險

vLLM 2026-04 issue #38840 報告 same-node worker restart 後，新 engine ID 與 stale handshake metadata 衝突；這是 framework-level evidence，證明 logical host/port identity 不足以代表 incarnation identity，但不能直接證明 NIXL etcd watcher 存在 ABA bug。

## 本小時最重要 5 個發現

### 1. Revision 存在，但目前沒有成為 invalidation capability

底層資料流：

```text
etcd DELETE key @ revision r10
→ Watch callback sees modified_index=r10
→ invalidatedAgents_.push_back(agent_name)
→ revision discarded
→ worker later processes agent_name
→ invalidateRemoteMD(agent_name)
```

為什麼重要：如果同一 logical agent name 已經發布新 incarnation G8，而舊 DELETE 對應 G7，撤銷決策若沒有 generation/revision 條件，就缺少「這個 invalidation 究竟撤銷哪一代」的顯式證據。

限制：本輪沒有證明實際 etcd event delivery 會讓舊 DELETE 在新 PUT 之後被同一 watcher 逆序送達；etcd 對單一 watch 保證 revision ordering。真正風險更可能出現在 callback→queue→worker 的延遲、watcher teardown/re-arm、跨來源 invalidation（P2P + etcd）或 application-level publication ordering。

### 2. etcd ordered watch ≠ application state linearizability

```text
etcd log: DELETE r10 → PUT r11
watch: guaranteed ordered

但 application:
watch callback DELETE r10
→ enqueue invalidation
→ another path fetches/publishes G8 from r11
→ worker later drains queued invalidation r10
→ invalidate by agent name only
```

這是本輪最重要的 system reasoning：storage event ordering 正確，不代表 asynchronous application side effects 仍按同一順序 materialize。

### 3. ABA prevention 應綁定 incarnation，而不是 peer name

Hermes correctness model（合理工程推論，非宣稱 NIXL 已有此欄位）：

```text
IncarnationToken =
  LogicalPeerID
+ Engine/ProcessGeneration
+ MetadataRevision
```

conditional invalidation：

```text
Invalidate(peer, observed_revision=r10)
ONLY IF
PublishedGeneration(peer).source_revision <= r10
```

若 current generation 已來自 r11，r10 invalidation 應成為 stale event，而不是撤銷 G8。

### 4. Watch resume / compaction 是 recovery correctness 的另一層

etcd 官方保證 broken watch 可從 last revision resume，只要 revision 仍在 history window；compaction 後舊 revision 可能不可讀。因此可靠 metadata manager 需要：last-applied revision、resume revision、compaction recovery（重新做 linearizable snapshot，再建立 watch），不能只做「重新連 watcher」。

### 5. ServingReady 應要求 control-plane freshness proof

建議 Digital Twin：

```text
ProcessReady
→ MetadataSnapshotLoaded(rev=r11)
→ WatchEstablished(after r11)
→ GenerationToken=G8/r11
→ TransferProbePassed
→ ServingReady
```

而不是 Pod/Process ready 就接受 transfer。

## Architecture Breakdown

```text
Remote Agent G7
→ publish metadata PUT r9
→ consumer fetch r9
→ RemoteSection G7
→ persistent watch

G7 dies
→ DELETE r10
→ watcher callback
→ InvalidationEvent(peer, r10)   [理想模型]

G8 starts
→ PUT r11
→ fetch metadata r11
→ RemoteSection G8

worker processes queued event
→ compare r10 vs current source revision r11
→ r10 < r11 ? DISCARD STALE INVALIDATION
             : REVOKE CURRENT GENERATION
```

目前 NIXL 已確認實作較接近：

```text
DELETE r10
→ callback logs r10
→ queue(peer)
→ worker
→ invalidateRemoteMD(peer)
```

revision-aware conditional revoke 尚未在本輪讀到的 path 中看到。

## Bottom-Level Logic

### etcd

```text
PUT/DELETE
→ Raft/MVCC revision
→ Watch event
→ ordered revision stream
→ client callback
```

### NIXL

```text
Watcher callback
→ validate response
→ require exactly one event
→ DELETE?
→ log modified_index
→ lock invalidatedAgentsMutex
→ push agent name
→ return

serviceEvents
→ move invalidation queue
→ erase watcher
→ ctx.invalidateRemoteMD(agent)
→ erase RemoteSection
→ disconnect backend
→ retire old remote capabilities
```

## Visual Simulation Idea

### Metadata Revision / ABA Timeline Simulator

四條泳道：etcd Revision、Watcher Callback、NIXL Worker、Published Capability。

互動事件：
- Publish G7 @ r9
- DELETE G7 @ r10
- Delay worker queue
- Publish/fetch G8 @ r11
- Drain old invalidation r10
- Toggle `revision-aware gate ON/OFF`
- Simulate watch disconnect
- Simulate compaction
- Resume from last applied revision

OFF 時顯示「stale invalidation candidate」；ON 時 r10 對 G8/r11 顯示 `STALE EVENT — DROP`。

## Code / GitHub

值得繼續讀：
- `ai-dynamo/nixl/src/core/nixl_etcd_metadata_backend.cpp`
  - `storeMetadataInEtcd`
  - `fetchMetadataFromEtcd`
  - `waitForMetadataFromEtcd`
  - `setupAgentWatcher`
  - `processInvalidatedAgents`
- `ai-dynamo/nixl/src/core/nixl_agent.cpp`
  - `invalidateRemoteMD`
  - `loadRemoteSections`
- vLLM NIXL connector / pull worker
  - handshake lock
  - `_remote_agents`
  - `_recving_metadata`
  - failure recovery

## Papers / Primary References

本輪核心不是新論文，而是官方 consistency contract + production source code。下一輪應補 distributed-systems literature：ABA prevention、epoch/fencing token、lease fencing、watch/snapshot consistency，並將其映射到 Agent/GPU capability generations。

## Unknown / Open Questions

1. NIXL etcd watcher 在 DELETE 後 erase watcher，再由後續 fetch re-arm；若 G8 在 watcher erase/re-arm 窗口發布，snapshot+watch 是否能完整避免 missed reincarnation？
2. P2P INVL 與 etcd DELETE 同時到達時，是否存在共同 incarnation/revision token，還是兩者只靠 agent name 匯流？
3. vLLM/SGLang 的 engine_id 是否能作為跨 NIXL metadata backend 的 fencing token，還是應由 NIXL core 自己產生 incarnation ID？

## 下一輪研究

鎖定：`snapshot + watch atomicity × watcher re-arm gap × etcd compaction recovery × fencing token × vLLM engine_id handshake generation × P2P/etcd cross-source invalidation ordering`。

要驗證：

```text
linearizable GET snapshot @ r11
→ establish watch from r11+1
→ publish GenerationToken(peer, engine_id, r11)
→ accept only events newer than lastAppliedRevision
→ conditional revoke by incarnation
```

以及 NIXL 現有 `waitForMetadataFromEtcd()` 使用 GET `response.index()` 建 watch 的 exact semantics，是否已形成無縫 GET→watch boundary。

## Knowledge Graph 新增 Node / Edge

Nodes:
- `EtcdMVCCRevision`
- `WatchRevisionOrder`
- `LastAppliedRevision`
- `QueuedInvalidationEvent`
- `StaleInvalidationEvent`
- `MetadataSourceRevision`
- `IncarnationToken`
- `ConditionalCapabilityRevocation`
- `WatchResumeRevision`
- `CompactionRecovery`
- `SnapshotWatchBoundary`
- `ServingFreshnessProof`

Edges:
- `EtcdMVCCRevision → orders → WatchEvent`
- `WatchEvent → enqueues → QueuedInvalidationEvent`
- `QueuedInvalidationEvent → mayLagBehind → MetadataPublication`
- `MetadataSourceRevision → versions → RemoteSectionGeneration`
- `IncarnationToken → fences → CapabilityUse`
- `ConditionalCapabilityRevocation → prevents → ABARevocation`
- `LastAppliedRevision → resumes → WatchStream`
- `Compaction → requires → SnapshotRecovery`
- `ServingFreshnessProof → gates → ServingReady`

## 本輪結束判斷

- 缺哪一層：snapshot/watch/re-arm 與 cross-source invalidation 的完整 fencing protocol。
- 哪個節點最淺：`CompactionRecovery`。
- 哪個概念仍只是名詞/抽象：`IncarnationToken` 與 `ConditionalCapabilityRevocation` 在 NIXL core 的具體 schema。
- 哪個系統值得讀原始碼：NIXL etcd metadata backend + vLLM NIXL handshake/recovery。
- 哪篇論文需追引用：下一輪補 fencing token / lease / ABA 與 watch consistency 經典與近期工程文獻。
- 哪個概念最適合視覺模擬：Metadata Revision / ABA Timeline Simulator。
- 哪個 Agent 架構最值得實作：把 `Detect → Fence → Revoke → Drain → Snapshot → Watch → Probe → Republish → Retry` 實作成 Hermes Runtime 通用 Recovery Transaction，可同時套用 MCP session、browser session、remote agent、GPU transfer endpoint。

## 對「AI 到底怎麼運作」新增的一層

```text
User
→ Agent Runtime
→ Model / KV State
→ Remote Capability Discovery
→ Metadata Snapshot
→ Revision / Incarnation Gate
→ Prepared Transfer
→ GPU/NIC Execution
→ Failure Event
→ Ordered Watch
→ Conditional Revocation
→ New Generation
→ Transfer Probe
→ ServingReady
→ Attention / Reasoning
→ Output
```

核心結論：可靠 AI Runtime 不只需要知道「peer 是誰」，還要知道「現在看到的是 peer 的哪一代、來自哪個 metadata revision」。etcd 可以保證事件本身有序，但如果 runtime 把 revision 丟掉，只留下 peer name，application-level capability lifecycle 仍可能失去 fencing 資訊。