# 【AI Agent × Multimodal Research Report】

時間：2026-09-10 02:54 Asia/Taipei

主題：Distributed MVCC × Hybrid Logical Clock × Global Safe Epoch × Cross-Process Snapshot × Distributed Artifact Reclamation

## 與歷史研究比較

前兩輪已建立：1) Branch-aware generational Artifact GC；2) 單機 concurrent GC，包含 SATB/write barrier、MVCC snapshot visibility、reader epoch、RCU grace period 與 physical delete fence。本輪不重複單機 GC，而是補上跨 process / 跨 node 的時間、snapshot 與 safe-reclamation 層。

核心問題：當 Agent Runtime、Vision Worker、GPU Server、MCP Host、Replay Worker 與 Artifact Store 同時在不同節點讀寫歷史 artifact 時，沒有單一 process 能直接知道「所有舊 reader 都已離開」；因此 local epoch 不能直接當 global safe epoch。

## 本小時新發現

1. Chandy–Lamport distributed snapshot 的關鍵不是「同時 freeze 所有節點」，而是在不停止分散式計算的情況下，記錄一個 consistent global state：process state + channel state。這對 Hermes 的 cross-process replay snapshot 很重要，因為只有 local snapshot 而沒有 in-flight message / RPC 邊界，可能得到不存在於任何真實 execution cut 的混合狀態。

2. Hybrid Logical Clock（HLC）提供「接近 physical time」與「保留 happens-before」的 compact timestamp。它比純 wall-clock 適合做 artifact version / event ordering；但 HLC 本身不等於 global safe time：某事件 timestamp 很小，不代表所有節點都已經 apply / observe 完它。

3. CockroachDB 的 closed timestamp 是一種 promise：低於某 timestamp 不再接受新的 writes，因此 follower 可以安全在該 timestamp 做讀取。這比單純 `min(node_clock)` 更接近 Hermes 所需的 safe-reclamation primitive：安全點要來自「未來不會再冒出更舊寫入」的協議承諾。

4. TiKV 把 resolved-ts 與 safe-ts 分開：leader 的 resolved-ts 表示低於它的 transaction 已處理到可解析狀態；follower 還必須確保 apply index 已追上，才能把 resolved-ts 提升為自己的 safe-ts。這直接證明 `globally resolved` 與 `locally materialized/safe` 是不同狀態。

5. Distributed GC 需要至少三種 watermark：write-resolved watermark、reader/snapshot low-watermark、replica-apply watermark。單一 timestamp 無法同時代表「不會再有舊寫入」「沒有舊 reader」「replica 已經 materialize」。

## 本小時最重要 5 個發現

### 1. Global Safe Epoch 不是 `min(local_epoch)`

合理的 Hermes 工程模型應是：

```text
GlobalSafeEpoch = min(
  GlobalWriteResolved,
  GlobalReaderLowWatermark,
  GlobalReplicaApplied,
  GlobalReplayPinFloor,
  GlobalLeaseFloor
)
```

其中每一項語義不同。只有 artifact 的 retire epoch 小於 GlobalSafeEpoch，而且沒有 audit hold / legal hold / branch pin，才進入 physical reclamation 候選。

限制：這是從 distributed DB / memory reclamation 概念映射到 Agent Artifact Runtime 的工程模型，不是既有標準。

### 2. HLC 解決 ordering，不直接解決 visibility

HLC 可表示：

```text
HLC = (physical_component, logical_counter)
```

若 A causally happens-before B，系統可維持 HLC(A) < HLC(B)，同時 timestamp 與 wall time 保持接近。

但：

```text
HLC(A) < HLC(B)
≠
Every node has applied A before B is read
```

因此 Hermes 不能只用 HLC 判斷 artifact 可刪除；還需要 apply/resolved/read watermarks。

### 3. Resolved Time 與 Safe Time 必須拆開

TiKV 的設計提供很好的直接類比：leader 維護 resolved-ts，但 follower 只有在自己的 apply index 足以對應該 resolved-ts 時，才可把它轉成 safe-ts。

Hermes 映射：

```text
Artifact Event Resolved
≠
Artifact Materialized Everywhere
≠
Artifact Safe For Every Reader
```

例如 Vision Worker 已完成 artifact write 並產生 HLC=120，但 Replay Worker 的 metadata stream 只 apply 到 112，則 `120` 不能直接成為全球 GC fence。

### 4. Cross-process snapshot 必須包含 in-flight channel state

Chandy–Lamport snapshot 將 global state 定義為 local process states 加上 communication channel states。對 Hermes 而言，channel state 對應：

```text
MCP RPC in flight
Artifact upload in flight
Tool result not yet consumed
GPU feature transfer
Replay pin update
Branch-head mutation
```

只 checkpoint 每個服務自己的 DB，可能得到：sender 認為已發出、receiver snapshot 卻尚未收到，或相反的 inconsistent cut。

### 5. Closed Timestamp 的「不再允許舊寫入」語義比 wall clock 更重要

CockroachDB closed timestamp 的重點是 leaseholder 對 replicas 作出承諾：某 timestamp 以下不再 evaluate 新 writes。這是 protocol guarantee，不只是 clock reading。

Hermes 因此應建立：

```text
ArtifactClosedEpoch(range / shard)
```

語義：該 shard 不再接受 commit_epoch <= closed_epoch 的 artifact mutation。只有 closed epoch 穩定推進後，舊 snapshot / GC 才能依此建立確定性。

## Architecture Breakdown

```text
UI / Agent Runtime / MCP Host / Vision Worker / GPU Server / Replay Worker
        │
        ├─ local HLC
        ├─ local applied epoch
        ├─ local reader floor
        ├─ local lease floor
        └─ branch / replay pins
        ↓
Distributed Artifact Metadata Log
        ↓
Shard Leaders / Consensus
        ↓
Resolved-Write Tracker
        ↓
Closed / Resolved Epoch per Shard
        ↓
Replica Apply Tracker
        ↓
Reader & Snapshot Registry
        ↓
Global Watermark Aggregator
        ↓
Global Safe Epoch
        ↓
Retire Queue
        ↓
Audit / Lease / Branch Pin Fence
        ↓
Quarantine / Grace Period
        ↓
Physical Reclamation
```

Cross-process snapshot path：

```text
SNAPSHOT REQUEST
↓
Marker / Barrier
↓
Record Local State
↓
Record In-Flight Channel State
↓
Collect Consistent Cut
↓
Snapshot ID + HLC Cut
↓
Pin Artifact Roots
↓
Replay / Audit / Fork
```

## Bottom-Level Logic

### HLC receive/update intuition

Local event：

```text
physical = wall_clock_now
l = max(l, physical)
if l unchanged from previous logical time:
    c = c + 1
else:
    c = 0
```

Receive remote timestamp `(l_r, c_r)`：

```text
l_new = max(local_physical, l_local, l_r)
```

logical counter 依哪一個 component 最大而更新，以避免 causally later event 取得更小 timestamp。

重要：精確實作依系統而異；此處是機制級摘要。

### Global reclamation predicate

```text
SafeDelete(A) =
  A.retire_hlc < GlobalWriteResolved
  ∧ A.retire_hlc < GlobalReaderLowWatermark
  ∧ A.retire_hlc < GlobalReplicaApplied
  ∧ A.retire_hlc < GlobalReplayPinFloor
  ∧ no_active_lease(A)
  ∧ no_audit_hold(A)
  ∧ grace_expired(A)
```

其中 `GlobalReplicaApplied` 應對每個相關 shard / replica set 求安全下界，而不是對整個 cluster 無差別使用單一數值。

## Visual Simulation Idea

### Distributed Safe Epoch & Snapshot Observatory

畫面放六個節點：

```text
Agent        HLC 128  applied 124  readerFloor 121
Vision       HLC 131  applied 130  readerFloor 129
MCP          HLC 126  applied 125  readerFloor 123
GPU          HLC 133  applied 118  readerFloor 132
Replay       HLC 127  applied 127  readerFloor 109
Artifact DB  HLC 132  resolved 126 closed 124
```

Simulator 即時計算：

```text
write-resolved   = 126
replica-applied  = 118
reader-floor     = 109
closed-epoch     = 124
GLOBAL SAFE      = 109
```

artifact retire epoch = 115 時顯示：

```text
Reachability      PASS
Write-resolved    PASS
Closed-epoch      PASS
Replica-applied   PASS
Reader-safe       FAIL (Replay reader @109)
Physical Delete  BLOCKED
```

按「END REPLAY READER」後 reader floor 推到 120，global safe epoch 變 118；直到 GPU replica applied watermark 推進到 >115 才變為可回收。

第二模式做 Chandy–Lamport snapshot：在 nodes 間顯示 marker 與 in-flight messages，讓使用者看到「每個 node 各自拍照」和「consistent global cut」的差別。

## Code / GitHub

### CockroachDB
值得深入：

- `pkg/kv/kvserver/replica_closedts_test.go`
- closed timestamp provider / side transport / follower-read paths
- `pkg/util/hlc/`
- transaction uncertainty / observed timestamp implementation

CockroachDB RFC 與測試展示 closed timestamp 與 HLC 的耦合：closed timestamp 是對未來 command 的約束，而不是只反映過去狀態。

### TiKV
值得深入：

- resolved-ts resolver
- `RegionReadProgress` / safe-ts maintenance
- CDC resolved-ts / lock tracking
- Raft apply index 與 stale read path

官方文件確認 resolved-ts 由 leader 維護，safe-ts 還取決於 follower apply progress。

## Papers

### Distributed Snapshots: Determining Global States of a Distributed System
- Authors: K. Mani Chandy, Leslie Lamport
- Institution: University of Texas / SRI-era collaboration context；論文頁以作者為準
- Year: 1985
- URL: https://www.microsoft.com/en-us/research/publication/distributed-snapshots-determining-global-states-distributed-system/
- Code: N/A
- Dataset: N/A
- Architecture: asynchronous distributed processes + FIFO channels + marker protocol
- Contribution: without stopping computation, capture a consistent global state including channel state
- Limitation: classical model assumptions; production systems still need failure, membership, non-FIFO transport and storage integration
- 改變了什麼：把「distributed snapshot」從需要全域同步的直覺，轉成可用 causal marker 建立 consistent cut。

### Logical Physical Clocks / HLC
- Authors: Sandeep S. Kulkarni, Murat Demirbas, Deepak Madeppa, Bharadwaj Avva, Marcelo Leone
- Institution: Michigan State University / University at Buffalo affiliations in publication lineage
- Year: 2014
- URL: https://www.cse.msu.edu/~sandeep/publications/hlc.pdf （若鏡像變動可追 DOI / OPODIS publication）
- Code: 多個第三方實作；production 參考 CockroachDB HLC
- Dataset: N/A
- Architecture: physical-time-adjacent logical clock `(l,c)`
- Contribution: preserve causality while remaining close to physical time and compact enough for DB timestamp use
- Limitation: HLC timestamp alone不保證 replica visibility / safe reclamation
- 改變了什麼：使 MVCC、snapshot 與 causality 不必在「純 physical clock」和「大型 vector clock」二選一。

## 已確認事實 / 工程推論分離

已確認：Chandy–Lamport snapshot 記錄 consistent global state；HLC 結合 physical proximity 與 logical causality；CockroachDB closed timestamp 限制某 timestamp 以下不再出現新 writes；TiKV resolved-ts 與 follower safe-ts 不同，safe-ts 受 apply progress 約束。

工程推論：Hermes 的 Global Safe Epoch 應取 write-resolved、reader floor、replica-applied、replay pin、lease 等多個 watermark 的安全下界；這是基於上述系統機制建立的 Agent Artifact Runtime 設計，不是現成標準。

## Unknown / Open Questions

1. 多 shard Artifact DAG 的 Global Safe Epoch 應採 cluster-wide minimum，還是 per-shard / per-dependency-subgraph safe epoch，以避免最慢 shard 阻塞所有 GC？
2. Replay Pin 如何跨資料中心與暫時離線 client 安全租約化，避免永久壓低 reader low-watermark？
3. GPU/CPU materialization pipeline 中的 ephemeral pointer/handle 是否應加入 distributed reader registry，還是只由 local lease proxy 對 cluster 發布單一 floor？

## 下一輪研究

下一輪應研究：`Distributed Safe Epoch → Lease / Failure Detector → Node Crash → Orphan Reader → Membership Change → Fencing Token → Reclamation`。

核心問題是：若某 Replay Worker 在 reader epoch=100 時斷線，cluster 不能永遠把 global safe epoch 卡在 100；但也不能單純 timeout 就假設舊 reader 不再使用 object。應深入 lease、fencing token、session epoch、failure detector、ZooKeeper/etcd lease、Raft term、distributed lock fencing 與 split-brain reclamation。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- Hybrid Logical Clock
- Distributed Snapshot
- Consistent Cut
- Channel State
- Closed Timestamp
- Resolved Timestamp
- Safe Timestamp
- Replica Applied Watermark
- Reader Low Watermark
- Global Safe Epoch
- Artifact Closed Epoch
- Distributed Replay Pin
- Global Watermark Aggregator
- Cross-Process Snapshot Barrier

新增 Edges：

```text
HLC → orders → Artifact Mutation
HLC → approximates → Physical Time
Closed Timestamp → forbids → Older Future Writes
Resolved Timestamp → bounds → Unresolved Transactions
Replica Apply Progress → constrains → Safe Timestamp
Reader Low Watermark → constrains → Global Safe Epoch
Replay Pin → lowers → Global Safe Epoch
Consistent Cut → includes → Channel State
Global Safe Epoch → permits → Distributed Reclamation

HLC Ordering ≠ Replica Visibility
Resolved Timestamp ≠ Follower Safe Timestamp
Local Snapshot ≠ Consistent Global Snapshot
Local Epoch ≠ Global Safe Epoch
Unreachable ≠ Globally Reclaimable
```

## 本輪結束判定

- 缺哪一層：Node failure / lease expiration / fencing 與 membership change 下的 safe epoch 推進。
- 哪個節點最淺：Distributed Replay Pin lease semantics。
- 哪個概念仍只是名詞：Unified Global Artifact Safe Epoch ABI。
- 哪個系統值得讀原始碼：CockroachDB closed timestamp + HLC；TiKV resolved-ts/safe-ts。
- 哪篇論文需追引用：Chandy–Lamport 1985、HLC 2014，以及 production MVCC safe-time 系統論文。
- 哪個概念最適合視覺模擬：Distributed Safe Epoch & Snapshot Observatory。
- 哪個 Agent 架構最值得實作：`Distributed Event-Sourced Agent + HLC Artifact Versions + Per-Shard Closed Epoch + Replica Apply Watermark + Reader/Replay Low-Watermark + Global Reclamation Fence`。

核心結論：Distributed Agent Memory 的安全刪除，不能由單機 GC 或 wall-clock 決定。HLC 能提供因果相容的時間標記，但「時間已過」不等於「所有 replica 都看到了」「所有 reader 都離開了」或「不會再出現舊寫入」。真正 production-grade 的 Hermes Artifact Runtime 需要把 closed/resolved time、replica apply progress、reader snapshot floor、replay pins 與 leases 聚合成可證明的 Global Safe Epoch，才可以跨 process 安全地回收多模態歷史 artifact。