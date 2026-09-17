# 【AI Agent × Multimodal Research Report】

**時間：2026-09-17 13:52（Asia/Taipei）**  
**本輪主題：NIXL etcd Snapshot→Watch Boundary × Compaction Recovery × Revision Fencing × Watch Authorization Boundary**

## 本小時新發現

本輪承接上一輪「etcd revision × ABA prevention」，不重複討論 UCX endpoint generation，而是深入 NIXL 的 etcd metadata control plane，確認 snapshot、watch、queued invalidation、compaction 與 security boundary 如何共同影響 distributed AI capability freshness。

### 已確認事實

1. etcd 的一般 Range/Get 預設是 linearizable；Watch 本身不是 linearizable，但提供 ordered / unique / reliable-within-history / atomic-by-revision / resumable 等事件保證。client 必須使用 revision 將 watch stream 與其他操作建立 ordering。
2. NIXL `fetchMetadataFromEtcd()` 讀取 metadata 時可以看到該 key 的 `modified_index()`，但目前 API 只把 blob 回傳給上層，沒有把 source revision 納入 remote metadata identity。
3. NIXL `waitForMetadataFromEtcd()` 先 GET key，取 `response.index()`，再以該 index 建立 watcher，目的是避免「先查不到、建立 watch 前 key 才出現」的典型 lost wakeup。
4. persistent agent invalidation watcher 收到 DELETE 時可以看到 `event.kv().modified_index()`，但 enqueue 到 `invalidatedAgents_` 時只保存 `agent_name`；worker 稍後呼叫 `invalidateRemoteMD(agent)` 時 revision 已遺失。
5. NIXL 官方文件確認：successful `fetchRemoteMD` 後會建立 persistent prefix watcher；DELETE 被 callback 放入 invalidation queue，communication worker 再呼叫 `invalidateRemoteMD()`，清除 cached metadata 並 disconnect remote backend。
6. etcd compaction 會讓舊 revision 不再可讀；broken watch 只有在 last revision 尚在 history window 時才能精確 resume。若 revision 已 compact，runtime 必須重新建立 fresh snapshot，而不能假設 incremental replay 仍可完成。
7. 2026-07-23 etcd 公開安全公告 CVE-2026-73499：受影響版本的 Watch API open-ended range (`WithFromKey`) 存在 RBAC authorization bypass。已修復於 etcd 3.5.33 / 3.6.14 / 3.7.1。這表示 AI metadata watcher 不只是 freshness primitive，也是 security capability boundary。

## 本小時最重要 5 個發現

### 1. Snapshot→Watch 的真正 correctness primitive 是 revision handoff

不能只畫：

`GET → Watch`

應拆成：

`Linearizable GET → Snapshot Revision R → Materialize G(R) → Watch from R/R+1 semantics → Apply events > LastAppliedRevision`

底層目的不是「監聽更新」，而是證明 snapshot 與 incremental event stream 之間沒有無法解釋的時間洞。

**重要性：** Agent/GPU peer 的 metadata 若在這個 boundary 遺失 DELETE/PUT，Runtime 可能把 stale rkey、endpoint、prepared transfer 或 engine handshake 當成 current generation。

**限制：** NIXL 使用的 `etcd-cpp-apiv3` Watcher start-index semantics 仍需要直接追 library source/test，不能只從 NIXL call site 推斷 R 與 R+1 的精確 inclusive/exclusive 行為。

### 2. NIXL 已觀察 revision，但尚未把 revision變成 capability identity

目前資料流：

`etcd KV → modified_index → debug log → metadata blob → loadRemoteMD`

以及：

`DELETE event(revision) → debug log → invalidatedAgents_.push_back(agent_name) → worker → invalidateRemoteMD(agent)`

因此 revision 存在於 storage protocol，卻沒有一路傳到 application-side revocation decision。

Hermes 建議 abstraction：

`RemoteCapability = {peer_id, incarnation_id, source_revision, metadata_hash, backend_generation}`

`Invalidate = {peer_id, observed_revision, source}`

只有 event 對 current capability generation 仍有效時才撤銷。

### 3. Compaction recovery 不是 watch reconnect，而是 state re-bootstrap

正確模型：

`Watch broken at LastApplied=R100 → try resume R101 → ErrCompacted → linearizable snapshot @ R500 → rebuild remote state → establish watch after snapshot boundary → publish freshness proof`

不能：

`ErrCompacted → reconnect watcher → assume local cache current`

這是 controller / agent runtime 很重要的 bottom-level mechanism：incremental log 已不可證明完整時，必須丟棄「我已同步」的假設，重新 snapshot。

### 4. Storage ordering 與 application side-effect ordering 必須分開

etcd 可以正確地依 revision 發送：

`DELETE G7 @ r10 → PUT G8 @ r11`

但 NIXL callback 會把 DELETE 轉成 asynchronous queue item；worker 何時執行 invalidation 是另一條 timeline。

所以：

`etcd Event Order ≠ Worker Side-effect Order ≠ Capability Publication Order`

這就是 ABA / delayed revocation 的真正來源之一。

### 5. Watcher 同時是 consistency primitive 與 security principal

2026 的 CVE-2026-73499 顯示 watch range authorization 若實作錯誤，具有單 key READ 權限的 principal 可能越界看到更大的 keyspace。對 AI Runtime 而言，metadata 可能包含 connection information、registered memory descriptors、agent identity，因此 Watch 必須納入 MCP/Agent security graph，而不是只被當作 service-discovery plumbing。

建議 Hermes Security Graph：

`Agent Identity → etcd Credential → Allowed Key Range → Watch Range → Metadata Visibility → Remote Capability Materialization`

並加入版本 gate：`etcd >= 3.5.33 / 3.6.14 / 3.7.1`（依使用 branch）。

## Architecture Breakdown

### NIXL etcd metadata lifecycle

```text
Local Agent
  → serialize local registered-memory/backend metadata
  → etcd PUT
  → MVCC revision R

Remote Agent
  → fetchRemoteMD
  → etcd GET
  → metadata blob + observed modified_index
  → loadRemoteMD
  → publish RemoteSection / backend metadata
  → setupAgentWatcher(peer prefix)

Remote removal
  → etcd DELETE prefix
  → watcher callback(event revision)
  → invalidatedAgents_ queue(agent only)
  → communication worker
  → invalidateRemoteMD(agent)
  → erase remote sections
  → disconnect backends
  → retire prepared remote capabilities
```

### 建議的 revision-aware architecture

```text
Linearizable Snapshot
  → SnapshotRevision R
  → Build Generation G8@R
  → WatchBoundary R
  → WatchEstablished
  → Publish ServingFreshnessProof

Event E@R+n
  → Verify E.revision > LastAppliedRevision
  → Verify E targets current incarnation
  → Apply mutation/revocation
  → LastAppliedRevision = E.revision

ErrCompacted
  → revoke freshness proof
  → stop new generation-dependent transfers
  → fresh linearizable snapshot
  → rebuild state
  → new watch boundary
  → probe
  → republish ServingReady
```

## Bottom-Level Logic

### Snapshot + Watch

```text
Range/Get
→ Raft-confirmed current state (linearizable default)
→ Response revision
→ Deserialize metadata
→ Build runtime capability
→ Establish watch from known revision boundary
→ Receive revision-ordered events
→ Compare against LastAppliedRevision
→ Apply / drop stale event
→ advance freshness watermark
```

### Compaction

```text
Watcher disconnected
→ LastAppliedRevision = R
→ request replay from R+1
→ if history available: replay
→ if ErrCompacted:
   incremental proof lost
   → fresh snapshot
   → replace local projection
   → new revision watermark
   → new watch
```

### ABA example

```text
G7 published @ r9
DELETE G7 @ r10
callback queues {peer=A}       # revision discarded today
G8 published @ r11
worker drains old {peer=A}
invalidateRemoteMD(A)
```

Potential Hermes fencing:

```text
queue {peer=A, observed_revision=r10, incarnation=G7}
current = G8@r11
r10 < current.source_revision
→ stale invalidation
→ DROP
```

This is a proposed correctness abstraction, not a claim that NIXL main already implements this exact token.

## Visual Simulation Idea

### Snapshot–Watch–Compaction Digital Twin

Four synchronized lanes:

1. **etcd / Raft / MVCC** — revisions r9…r500, PUT/DELETE, compaction watermark.
2. **Watch stream** — connected, delayed, disconnected, replay, ErrCompacted, progress watermark.
3. **NIXL worker** — callback queue, loadRemoteMD, invalidateRemoteMD, backend disconnect.
4. **AI serving capability** — G7/G8, endpoint/rkey/prepared-transfer validity, ServingReady.

Interactive fault injections:

- DELETE r10 callback delayed until after PUT r11
- Watch disconnect before DELETE
- Resume revision compacted
- Serializable snapshot instead of linearizable snapshot
- Duplicate peer name + new engine ID
- Drop revision before invalidation queue
- RBAC exact-key watch vs prefix/from-key watch

The simulator should show three independent watermarks:

`StoreRevision / WatchDeliveredRevision / RuntimeAppliedRevision`

Only when runtime has a freshness proof should `ServingReady` turn green.

## Code / GitHub

### NIXL

Repository: https://github.com/ai-dynamo/nixl

Worth reading next:

- `src/core/nixl_etcd_metadata_backend.cpp`
  - `fetchMetadataFromEtcd()`
  - `waitForMetadataFromEtcd()`
  - `fetchOrWaitForMetadataFromEtcd()`
  - `setupAgentWatcher()`
  - `processInvalidatedAgents()`
- `fern/docs/pages/user-guide/etcd-metadata-exchange.md`
- next: `subprojects/etcd-cpp-apiv3` / dependency revision and Watcher implementation, to prove start-index semantics and compaction callback behavior.

### vLLM production evidence

Issue #38840 documents a same-node NIXL worker restart where a new `engine_id` conflicts with stale handshake metadata. This supports the need for incarnation-aware identity, but does **not** prove the root cause is NIXL etcd revision handling.

https://github.com/vllm-project/vllm/issues/38840

### Fresh 2026 security evidence

etcd CVE-2026-73499 / GHSA-xg4h-6gfc-h4m8: Watch API authorization bypass through open-ended range requests in affected versions. Patched in 3.5.33, 3.6.14, 3.7.1.

https://github.com/etcd-io/etcd/security/advisories/GHSA-xg4h-6gfc-h4m8

## Papers

### In Search of an Understandable Consensus Algorithm

- **Title:** In Search of an Understandable Consensus Algorithm
- **Authors:** Diego Ongaro, John Ousterhout
- **Institution:** Stanford University
- **Year:** 2014
- **URL:** https://raft.github.io/raft.pdf
- **Code / spec:** Raft ecosystem and TLA+ references at https://raft.github.io/
- **Dataset:** N/A; algorithm/system paper
- **Architecture:** replicated state machine; leader election; log replication; safety; membership changes
- **Contribution:** provides the consensus substrate conceptually beneath systems such as etcd; separates consensus into understandable mechanisms while retaining fault tolerance comparable to Paxos.
- **Limitations for this research:** Raft explains consensus/log replication, not NIXL's application-side snapshot/watch fencing, capability generation, or GPU transfer lifetime.
- **What it changes here:** clarifies that storage revision order is derived from a replicated state-machine history, but application correctness still requires preserving that ordering information after events leave the storage layer.

## Unknown / Open Questions

1. **Exact Watcher start-index semantics:** does the specific `etcd-cpp-apiv3` version vendored/used by current NIXL interpret `watch_index` inclusively, exclusively, or with special zero/current behavior? Need source + tests.
2. **Compaction handling:** when a persistent NIXL watcher falls behind past compaction, what exact callback/error is produced, and does NIXL rebuild a snapshot or merely log the watcher error and leave cached remote metadata resident?
3. **Cross-source fencing:** P2P `INVL`, etcd DELETE, UCX endpoint error, scheduler engine replacement may all refer to the same logical peer. There is not yet a verified single incarnation token spanning these failure detectors.

## 下一輪研究

Priority:

`etcd-cpp-apiv3 Watcher source → NIXL dependency version → start revision semantics → compaction callback → persistent watcher failure lifecycle → re-arm behavior → P2P INVL ordering → unified incarnation fencing`

Concrete target state machine:

```text
SNAPSHOT_LOADING
→ SNAPSHOT_R
→ WATCH_ESTABLISHING
→ WATCHED_CURRENT
→ WATCH_BROKEN
   ├ replay available → REPLAYING → WATCHED_CURRENT
   └ compacted → FRESHNESS_UNKNOWN → RESNAPSHOT → WATCHED_CURRENT
→ generation probe
→ SERVING_READY
```

## Knowledge Graph 新增 Node / Edge

### Nodes

- `LinearizableMetadataSnapshot`
- `SnapshotRevision`
- `WatchStartRevision`
- `WatchDeliveredRevision`
- `RuntimeAppliedRevision`
- `FreshnessWatermark`
- `SnapshotWatchBoundary`
- `WatchReplay`
- `ErrCompacted`
- `ResnapshotTransaction`
- `QueuedInvalidationRevision`
- `RevisionFencingToken`
- `ServingFreshnessProof`
- `WatchAuthorizationRange`
- `MetadataVisibilityCapability`
- `EtcdWatchSecurityBoundary`

### Edges

```text
RaftCommit
→ establishes
MVCCRevision

LinearizableMetadataSnapshot
→ returns
SnapshotRevision

SnapshotRevision
→ anchors
WatchStartRevision

WatchDeliveredRevision
→ must advance
RuntimeAppliedRevision

ErrCompacted
→ invalidates
IncrementalFreshnessProof

ErrCompacted
→ requires
ResnapshotTransaction

QueuedInvalidationRevision
→ fences
CapabilityRevocation

WatchAuthorizationRange
→ bounds
MetadataVisibilityCapability

MetadataVisibilityCapability
→ enables
RemoteCapabilityMaterialization
```

## 本輪結束判斷

- **缺哪一層：** etcd-cpp-apiv3 Watcher 的 start-revision / compaction / reconnect 真實 state machine。
- **哪個節點最淺：** `ServingFreshnessProof`，目前是 Hermes 統一 correctness abstraction。
- **哪個概念仍只是名詞：** `UnifiedIncarnationFence`；尚未證明 NIXL/vLLM/SGLang 有跨 etcd/P2P/UCX 的共同 token。
- **哪個系統值得讀原始碼：** `etcd-cpp-apiv3` Watcher + NIXL metadata backend。
- **哪篇論文需追引用：** Raft extended paper，下一步沿 replicated-state-machine / watchable state machine / formal verification 方向追引用。
- **哪個概念最適合視覺模擬：** Snapshot–Watch–Compaction Digital Twin，尤其三個 revision watermarks。
- **哪個 Agent 架構最值得實作：** `Revision-fenced Recovery Agent`：Detect → Revoke Freshness → Replay/Resnapshot → Rebuild Capability → Probe → Republish → Retry。

## 最終鏈路新增的一層

```text
使用者一句話
→ UI
→ Agent Runtime
→ Context / Planning / Memory / Tools
→ Model
→ KV / Multimodal State
→ Distributed Transfer Metadata
→ etcd Raft Commit
→ MVCC Revision
→ Snapshot
→ Watch Stream
→ Runtime Applied Revision
→ Generation / Freshness Gate
→ NIXL Endpoint + rkey + Prepared Transfer
→ UCX / GPU / NIC
→ Attention / Model Forward
→ Logits
→ Output
```

本輪核心結論：**distributed AI 的 metadata correctness 不是「有 etcd 就一致」。etcd 可以提供強大的 revision 與 watch guarantees，但 Runtime 必須把 revision 從 storage event 一路保存到 capability publication/revocation；一旦 incremental history 因 compaction 不可證明完整，就必須撤銷 freshness、重新 snapshot，而不是讓舊 GPU/Agent capability 繼續服務。**