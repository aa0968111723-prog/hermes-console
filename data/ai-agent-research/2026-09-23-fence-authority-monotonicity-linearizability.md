# 【AI Agent × Multimodal Research Report】

**時間：2026-09-23 04:53（Asia/Taipei）**  
**主題：Fence Authority × Monotonicity × Linearizability × Failover Safety**

## 本小時新發現

本輪接續上一輪 `Overlapping Activity Attempts × Resource-Enforced Fencing`，不再重複「為何需要 fencing」，而是回答更底層問題：**哪一種 generation/revision 真的足以當 Agent side-effect fencing token？**

研究比較：etcd cluster revision / create_revision、ZooKeeper zxid、PostgreSQL sequence、Redis INCR/replication offset，以及 lease/lock identity。結論是「數字遞增」遠遠不夠；production fence authority 至少需要：

`Unique ∧ Monotonic ∧ ConsensusOrdered ∧ DurableAfterAcknowledgement ∧ FailoverSafe ∧ ResourceEnforced`

並新增最重要 invariant：

`MonotonicNumber --does_not_prove→ SafeFencingToken`

## 本小時最重要 5 個發現

### 1. etcd revision 最接近可直接用於 Fence Authority 的 generation source

**已確認官方資訊。** etcd v3.7 的 KV API 定義 cluster-wide 64-bit store revision；每次 keyspace mutation 增加 revision，revision 是 global logical clock。Range 預設為 linearizable；serializable read 則可能 stale。etcd data model 也明確指出 revisions 在 cluster lifetime 中 monotonically increasing。

**原始碼驗證。** `client/v3/concurrency/mutex.go` 的 Mutex 不只是 lease key：它保存 `myRev`，acquire 時以 transaction 建立 lease-bound key，使用 create revision 排序 waiters；`IsOwner()` 以 `CreateRevision(myKey) == myRev` 驗證 ownership。值得繼續讀：`client/v3/concurrency/{mutex.go,session.go,election.go,stm.go}`。

底層鏈：

`Raft consensus → KV mutation → cluster revision → lock-key create_revision → ownership generation → resource request fence → resource maxAcceptedFence`

但 **etcd lock ownership 本身仍不是 external resource fencing**。如果 downstream DB/API 不檢查 revision，stale worker仍可能寫入。

### 2. ZooKeeper zxid 是 total-order transaction stamp，但 zxid 本身仍需要 resource-side admission

**已確認官方資訊。** ZooKeeper 為每個 state change 指派 zxid；zxid 唯一且提供所有 changes 的 total order，proposal 經 quorum acknowledgement 後 commit。znode 的 version/cversion/aversion 也隨對應修改增加。

因此 zxid 很適合作為 coordination-domain ordering witness：

`zxid1 < zxid2 → change1 precedes change2`

但安全 fence仍需要：

`ExternalResource.accept(request) iff request.fence >= resource.maxAcceptedFence`

否則 zxid 只是一個「知道誰比較新」的 metadata，而不是「舊 writer 寫不進去」的 enforcement。

### 3. PostgreSQL sequence 是 atomic unique generation，但不能直接宣稱 failover-safe fencing authority

**已確認官方資訊。** `nextval()` 原子地提供不同 sequence values；rollback 不回收，因此會有 gaps。更重要的是 PostgreSQL 文件警告：若 cluster crash 發生在含 `nextval` 的 transaction commit 前，sequence state 是否已持久化是不確定的；若 sequence value 要用於 database 外部的持久用途，應先 commit `nextval` 所在 transaction。

因此：

`nextval() returned --does_not_prove→ fence generation durably committed`

以及：

`Gapless --is_not_required_for→ Fencing`

fencing需要 strict newer-generation rejection，不需要連續無洞號碼。

建議 DB-native fence不要只拿 sequence value後去外部使用；應在同一 authoritative DB transaction 中執行：

`allocate/validate fence → compare resource.last_fence → mutation → persist last_fence → receipt`

### 4. Redis INCR 的單節點 atomicity不足以推出 failover-safe fence

**已確認官方資訊。** Redis replication 預設 asynchronous；`WAIT` 可等待 replica acknowledgement，但官方明確說 WAIT 不會把 Redis 變成 strongly-consistent store，failover仍可能遺失已 acknowledged/synchronously replicated write。`WAITAOF` 強化 durability，但官方同樣說並不使 Redis 成為 strongly consistent store。

所以：

`Redis INCR atomic --does_not_prove→ Fence survives failover`

`WAIT success --does_not_prove→ LinearizableFenceAuthority`

因此 Hermes 不應把普通 Redis INCR 當高風險 external side-effect 的唯一 fencing authority；它可以做低風險 generation/cache/coordinator hint，但高風險 commit gate應使用具備 consensus ordering或 resource-native CAS 的 authority。

### 5. Lease、Lock、Fence 是三個不同安全 primitive

Gray & Cheriton 的經典 Leases 工作把 lease定義為有限期間的權利；failure會影響 performance，但在其假設下不應破壞 consistency。Chubby則是 production distributed lock service，重點在 coarse-grained locking與可靠低量 storage。

Hermes 必須保持：

`Lease → who may act during interval`

`Lock → mutual exclusion / ownership coordination`

`Fence → which generation may still commit at resource`

因此：

`LeaseValid --does_not_prove→ OldHolderCannotCommitAfterPause`

`LockAcquired --does_not_prove→ PreviousHolderPhysicallyStopped`

只有 resource-enforced fence才能封住 GC pause、network partition、heartbeat timeout 後復活的 stale attempt。

## Architecture Breakdown

推薦 Hermes 的 Fence Authority architecture：

`SemanticCommitEnvelope`
→ `Durable Workflow Attempt`
→ `FenceAuthority.allocate()`
→ `Consensus/Transactional Generation`
→ `FencedEffectManifest`
→ `MCP/Tool Adapter`
→ `Resource Admission Gate`
→ `compare incomingFence vs maxAcceptedFence`
→ `CAS/version check`
→ `External Mutation`
→ `persist maxAcceptedFence + receipt`
→ `Observation Commit Gate`

**高風險 production rule：** fence generation 的 authority domain 與真正修改 resource 的 admission domain之間，必須存在可驗證 binding；單獨產生一個更大的數字沒有安全效果。

## Bottom-Level Logic

### etcd-backed Fence Authority

`Txn(create /fences/<resource>/<lease>)`
→ `Raft ordered commit`
→ `header.revision/create_revision = fenceGeneration`
→ `worker receives fence`
→ `tool request carries fence`
→ `resource transaction checks fence >= last_fence`
→ `mutation + last_fence update atomic`

注意：serializable etcd read可能 stale，因此 safety-critical admission/ownership verification不能隨意把 linearizable read換成 serializable read。

### PostgreSQL-native Fence Gate

概念 transaction：

`BEGIN`
→ `SELECT/allocate generation`
→ `UPDATE resource SET ..., last_fence=:f WHERE id=:id AND last_fence < :f AND version=:expected`
→ `rows_affected == 1`
→ `INSERT side_effect_receipt(...)`
→ `COMMIT`

若 rows=0，必須區分 `STALE_FENCE` 與 `VERSION_CONFLICT`，不能讓 LLM自行猜測後 retry。

### Redis generation caveat

`INCR fence:key → n` 在當前 primary可提供原子遞增，但 asynchronous replication/failover意味 `n` 的 durable global ordering不等同 consensus-committed generation。對付款、刪除、發布、security change等高風險操作，不應只依賴這個 generation。

## Visual Simulation Idea

### Fence Authority Consistency Microscope

五條 authority lanes：

`etcd Revision | ZooKeeper zxid | PostgreSQL Sequence/Row Fence | Redis INCR | External Resource`

互動故障注入：

- `ETCD_SERIALIZABLE_STALE_READ`
- `ETCD_LEASE_EXPIRES_OLD_WORKER_RESUMES`
- `ZOOKEEPER_SESSION_EXPIRES_STALE_WRITER`
- `POSTGRES_NEXTVAL_RETURNED_BEFORE_CRASH`
- `REDIS_PRIMARY_ACK_THEN_FAILOVER_LOSES_INCREMENT`
- `RESOURCE_DOES_NOT_ENFORCE_FENCE`
- `NEW_FENCE_VALID_BUT_CAS_VERSION_CONFLICT`

UI顯示：

`Generated | Consensus Ordered | Durable | Failover Safe | Resource Enforced | SAFE FENCE?`

## Code / GitHub

### etcd
Repository: `etcd-io/etcd`

值得看的目錄與核心檔案：

- `client/v3/concurrency/mutex.go` — lease-bound lock key、create revision ownership、`IsOwner()` compare。
- `client/v3/concurrency/session.go` — session/lease lifecycle。
- `client/v3/concurrency/election.go` — election generation/leadership。
- `client/v3/concurrency/stm.go` — revision-based optimistic concurrency。

原始碼觀察：Mutex 的 `tryAcquire()` 用 Txn 建立帶 lease 的 key，保存 response/header revision；owner由 prefix 下最早 create revision決定。這是一個很好的 coordination generation，但 Hermes 還要把 generation帶到 external resource admission。

## Papers

### 1. Leases: An Efficient Fault-Tolerant Mechanism for Distributed File Cache Consistency
- **Authors:** Cary G. Gray, David R. Cheriton
- **Institution:** Stanford University
- **Year:** 1989
- **Venue:** SOSP
- **Code/Dataset:** 無現代 reference code；評估使用 V distributed system file-access characteristics
- **Architecture:** time-bounded lease rights + server/client consistency protocol
- **Contribution:** 建立 lease作為 failure-tolerant consistency primitive的經典模型
- **Limitations:** 依賴 clock/failure assumptions；lease不等於 resource-side fencing
- **改變了什麼:** 讓「暫時 ownership」可以在 partial failure下被形式化分析，但現代 Agent side-effect還需 fence generation補足 stale holder問題。

### 2. The Chubby Lock Service for Loosely-Coupled Distributed Systems
- **Author:** Mike Burrows
- **Institution:** Google
- **Year:** 2006
- **Venue:** OSDI
- **Architecture:** replicated distributed lock service + reliable low-volume storage
- **Contribution:** 大規模 production lock/coordination service經驗
- **Limitations:** lock service本身不是所有 external resource的 write fence；client/resource protocol仍決定 stale-holder safety
- **改變了什麼:** 證明 consensus-backed coordination service可成為 production control plane，但不應把「持有 lock」誤當「舊 process已停止」。

## 比較矩陣

| Source | Unique/Monotonic | Consensus/Strong Ordering | Failover Caveat | 適合作 Fence Authority |
|---|---|---|---|---|
| etcd cluster revision | 是，cluster lifetime monotonic | 預設 KV operation linearizable | serializable read可 stale | **高**，仍需 resource enforcement |
| ZooKeeper zxid | 是，state changes total ordered | quorum committed proposal ordering | session/holder仍可能 stale execution | **高**，仍需 resource enforcement |
| PostgreSQL sequence | atomic unique；可有 gaps | DB內 atomic generator | crash前未 commit不宜拿去 DB 外作 durable identity | **中高**，最好與 resource row transaction綁定 |
| Redis INCR | primary內 atomic increment | 普通 replication非 strong consistency | acknowledged increment failover仍可能遺失 | **低～中**，不宜單獨保護高風險 side effect |
| Timestamp / wall clock | 可能碰撞/clock skew | 否 | clock rollback/skew | **低，不應使用** |
| Temporal attempt number | runtime generation metadata | 由 workflow history管理 | downstream resource不認識它 | **觀測/綁定用，不是單獨 fence** |

## Unknown / Open Questions 1–3

1. etcd cluster restore / disaster recovery 後 revision domain如何建立新的 `FenceAuthorityEpoch`，避免舊 cluster產生的高 revision與新 cluster混用？
2. 多 region active-active external resources若沒有單一 linearizable admission point，應採 per-resource epoch、quorum fence，還是把 side effect ownership限制在 single-writer region？
3. MCP tool server如何宣告 `supportsFence / fenceAuthority / fenceScope / receiptStrength`，讓 planner/runtime能在 dispatch前判斷 tool是否安全支援 write-side retry？

## Knowledge Graph 新增 Node / Edge

### Nodes
- `FenceAuthorityGeneration`
- `FenceAuthorityEpoch`
- `ConsensusOrderedFenceWitness`
- `FenceDurabilityWitness`
- `FenceFailoverSafetyWitness`
- `EtcdClusterRevision`
- `EtcdCreateRevision`
- `ZooKeeperZxid`
- `PostgresSequenceGeneration`
- `RedisIncrementGeneration`
- `ResourceMaxAcceptedFence`
- `FenceDomainBindingWitness`
- `StaleGenerationRejectionWitness`

### Edges
- `EtcdClusterRevision --can_generate→ FenceAuthorityGeneration`
- `ZooKeeperZxid --can_order→ FenceAuthorityGeneration`
- `PostgresSequenceGeneration --requires_commit_before_external_use→ FenceDurabilityWitness`
- `RedisIncrementGeneration --does_not_imply→ FenceFailoverSafetyWitness`
- `FenceAuthorityGeneration --must_bind_to→ ResourceMaxAcceptedFence`
- `ResourceMaxAcceptedFence --rejects→ StaleGeneration`
- `LeaseOwnership --does_not_imply→ StaleGenerationRejectionWitness`
- `TemporalAttemptGeneration --binds_to→ FenceAuthorityGeneration`

## 本輪結束判定

- **缺哪一層：** Fence Authority disaster-recovery epoch 與 multi-region resource admission。
- **哪個節點最淺：** `FenceAuthorityEpoch`。
- **哪個概念仍只是名詞：** portable `FencedEffectManifest` 中的 `fenceAuthority/fenceEpoch/fenceGeneration` normative schema。
- **哪個系統值得讀原始碼：** etcd `client/v3/concurrency` 後，下一輪應深入 server MVCC/Raft revision apply path與 ZooKeeper lock recipe。
- **哪篇論文需追引用：** Gray & Cheriton《Leases》與 Burrows《Chubby》，特別追 modern fencing / distributed lock correctness如何修補 lease-expiry stale client。
- **哪個概念最適合視覺模擬：** `Fence Authority Consistency Microscope`。
- **哪個 Agent 架構最值得實作：** `Durable Workflow + Consensus Fence Authority + FencedEffectManifest + Resource-native CAS/Fence Gate + ReceiptVerifier + Observation Commit Gate`。

## 下一輪研究

下一輪鎖定：

`FenceAuthorityEpoch → etcd restore/revision semantics → leader/lease failover → multi-region ownership → MCP tool capability declaration → resource-native fenced mutation → receipt`

並開始把 fence capability寫成可被 Agent Runtime理解的 tool contract：

`tool write capability = { idempotency, fenceAuthority, fenceEpoch, conditionalMutation, receiptStrength, compensation }`

最終要讓 Hermes 在 Tool Selection 階段就能判斷：**這個 tool 不只是「能不能呼叫」，而是「在 timeout、retry、worker重疊、leader failover、region failover後，還能不能安全地呼叫」。**

## Sources

- etcd v3.7 KV API / data model / API guarantees
- etcd `client/v3/concurrency/mutex.go`
- Apache ZooKeeper Programmer's Guide / internals
- PostgreSQL sequence documentation
- Redis replication / WAIT / WAITAOF documentation
- Gray & Cheriton, *Leases*, SOSP 1989
- Burrows, *The Chubby Lock Service*, OSDI 2006
