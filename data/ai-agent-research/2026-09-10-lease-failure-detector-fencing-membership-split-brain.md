# 【AI Agent × Multimodal Research Report】

時間：2026-09-10 03:51 Asia/Taipei

主題：Lease × Failure Detector × Fencing Token × Membership Epoch × Split-Brain Safety × Global Safe Epoch Progress

## 與歷史研究比較

上一輪已建立：Distributed MVCC → HLC → Closed/Resolved/Applied Watermark → Reader/Replay Low Watermark → Global Safe Epoch。本輪不再重複時間排序與 snapshot safety，而是處理上一輪留下的核心 liveness/correctness 缺口：如果某個 reader / replay worker / GPU materializer 斷線，Global Safe Epoch 是否永遠卡死？如果逾時後把它視為失效，它之後又復活，如何防止 stale worker 再度修改 Artifact DAG 或外部世界？

本輪把問題拆成：Failure Detection（判斷可疑）→ Session Lease（暫時授權）→ Lease Expiration（停止續約）→ Fencing Token（拒絕 stale authority）→ Membership Epoch（拒絕舊 cluster identity）→ Safe-Epoch Recalculation（讓回收水位繼續前進）。

---

## 本小時新發現

### 1. Failure detector 不提供真實死亡證明，只提供 suspicion

【論文確認】Chandra & Toueg, 1996 將 unreliable failure detector 以 completeness / accuracy 描述；在非同步分散式系統中，failure detector 可以犯錯但仍能支援更高層協定。

因此 Hermes 不能建立：

```text
heartbeat timeout
→ worker definitely dead
```

而應建立：

```text
Missing Heartbeats
↓
Suspicion Score / Timeout
↓
Lease Renewal Stops
↓
Authority Eventually Expires
↓
Old Authority Must Be Fenced
```

也就是：

```text
Failure Detector
≠
Authority Revocation
```

### 2. Lease 解決「多久仍有權」，但不能單獨解決 stale worker resurrection

【官方確認】etcd Lease API：cluster grant 一個 TTL；若在 TTL 內未收到 keepAlive，lease 會到期，掛在 lease 上的 keys 會被刪除。ZooKeeper session expiration 也由 cluster 管理，session 過期後 ephemeral nodes 被刪除；重要的是，partition 中的 client 甚至可能直到重新連線才得知自己已 expired。

所以典型故障：

```text
Worker A owns lease L
↓
A network partition / GC pause
↓
cluster expires L
↓
Worker B acquires new authority
↓
A resumes but still believes old local state
```

如果 external artifact store 只相信「我曾拿過 lease」，A 仍可能寫壞世界。

### 3. Fencing token 是「Lease 的缺失半邊」

【工程實作＋經典工程論證】每次新 authority grant 產生單調遞增 token：

```text
A → token 41
lease expires
B → token 42
```

所有 state-changing request 必須攜帶 token：

```text
write(resource, token=42) → ACCEPT
write(resource, token=41) → REJECT_STALE_AUTHORITY
```

Protected resource 必須保存：

```text
highest_accepted_fence(resource)
```

並驗證：

```text
request.fence >= highest_accepted_fence
```

Martin Kleppmann 的 fencing 分析明確指出：storage/resource server 本身必須參與 token check；否則 lock service 無法阻止 pause 後復活的 stale client。

【官方 etcd 補強】etcd 2026 文件也明確指出：revision number 可作為 fencing/sequencer 類機制；如果要保護 etcd 之外的外部資源，該資源本身必須提供版本驗證。etcd lock 本身不能替外部系統完成此安全性。

### 4. Raft term / consensus epoch 可以阻止舊 leader proposal，但不自動保護所有外部副作用

【原始碼確認】etcd `server/lease/lessor.go` 的註解直接說明：短時間內可能同時存在兩個 primary lessor / leader，但舊 primary 的 proposal 具有較小 Raft term，因此不能被 committed。

這表示 consensus log 內部可利用 term 避免 stale leader commit：

```text
Old Leader(term=17)
New Leader(term=18)
↓
term 17 proposal
→ cannot commit in current consensus
```

但如果 stale worker 越過 consensus layer，直接呼叫：

```text
S3 delete
payment API
GPU artifact delete
external DB write
```

則 Raft term 本身不會神奇地阻止副作用。

因此：

```text
Consensus Stale-Leader Safety
≠
External Side-Effect Fencing
```

### 5. Membership change 本身也是 authority change

【官方確認】etcd runtime reconfiguration 要求 quorum；新 member 可先加入 learner，等 Raft log 追上 leader 後才 promote 為 voting member。已被移除的 member 使用舊 data directory 嘗試回到 active cluster 時會退出。

這意味 Hermes 應把 membership 當成版本化 authority：

```text
ClusterMembershipEpoch
```

每個 worker capability / reader lease 可綁定：

```text
Authority = {
  cluster_epoch,
  session_id,
  lease_id,
  fence_token,
  capability_scope,
  expiry
}
```

若 membership epoch 已變：

```text
request.cluster_epoch < current_cluster_epoch
→ FENCE
```

---

## 本小時最重要 5 個發現

### 發現 1 — Failure detection 是 epistemic hint，不是 reclaim proof

是什麼：failure detector 回答「這個 process 看起來可能壞了」。

底層：heartbeat / timeout / adaptive arrival distribution → suspicion；Chandra–Toueg 的 completeness / accuracy 描述 detector 能力，而非給出完美 crash oracle。

重要性：Global Safe Epoch 不能因一次 timeout 直接忽略 reader。

限制：非同步網路下 silence 可能是 crash、partition、pause 或 congestion。

來源：
- https://research.ibm.com/publications/unreliable-failure-detectors-for-reliable-distributed-systems
- https://www.cs.cornell.edu/info/people/sam/FDpapers.html

### 發現 2 — Lease expiry 可以釋放 coordination ownership，但 stale process 仍可能活著

是什麼：etcd lease / ZooKeeper session 是 cluster-owned lifetime mechanism。

底層：Grant TTL → KeepAlive → server expiry → attached key / ephemeral node removal。

重要性：Reader/worker 不需要永久卡住 safe epoch；authority 可在 lease expiry 後被 cluster 收回。

限制：client 可能晚於 cluster 知道自己 expired。

來源：
- https://etcd.io/docs/v3.6/learning/api/
- https://zookeeper.apache.org/doc/r3.6.2/zookeeperProgrammers.html

### 發現 3 — Fencing token 才真正防 stale resurrection

是什麼：每次新 ownership 取得更大的 monotonic token。

底層：grant → token++ → propagate token → resource-side high-watermark validation。

重要性：即使舊 worker 復活，舊 token 仍無法再寫。

限制：protected resource 若無法驗 token，fencing 就無法成立。

來源：
- https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html
- https://etcd.io/docs/v3.6/learning/why/

### 發現 4 — Consensus epoch 與 external effect fence 是不同安全層

是什麼：Raft term 可拒絕舊 leader proposal，但只保證 consensus-controlled state machine。

底層：proposal carries term → quorum / current-term rules → stale-term operation 無法 commit。

重要性：Hermes 的 MCP/tool/external artifact write 必須另外攜帶 authority token。

限制：沒有 downstream validation 的 external service 仍可能被 stale worker 改寫。

來源：etcd 原始碼 `server/lease/lessor.go` + fencing literature。

### 發現 5 — Global Safe Epoch 需要 Lease Floor，而 Lease Floor 必須可 fencing

上一輪：

```text
GlobalSafeEpoch = min(
  WriteResolved,
  ReplicaApplied,
  ReaderFloor,
  ReplayPinFloor,
  LeaseFloor
)
```

本輪修正：LeaseFloor 不應是任意 worker 回報，而應只由「仍有效且未被 fencing 的 authority」貢獻：

```text
EffectiveReaderFloor = min(
  reader_epoch of sessions where
  LeaseValid
  ∧ MembershipEpochCurrent
  ∧ FenceTokenCurrent
)
```

過期 session：

```text
Lease expires
↓
Authority retired
↓
New fence issued
↓
Old worker no longer constrains GlobalSafeEpoch
```

但若舊 worker重現：

```text
old token
→ stale request rejected
```

這是安全與 liveness 同時成立的關鍵。

---

## Architecture Breakdown

```text
Agent Runtime / Vision Worker / Replay Worker / MCP Worker
↓
Failure Detector
├ heartbeat
├ timeout
└ suspicion score
↓
Session Authority Manager
├ session_id
├ lease_id
├ TTL
├ membership_epoch
└ capability_scope
↓
Consensus-backed Lease Store
↓
Fencing Sequencer
↓
Authority Token
{
  membership_epoch,
  lease_generation,
  fence_token
}
↓
Worker Request
↓
Resource-Side Fence Validator
├ Artifact Store
├ Event Store
├ Tool Gateway
├ MCP Executor
└ External Side-Effect Adapter
↓
ACCEPT CURRENT AUTHORITY
or
REJECT STALE AUTHORITY
↓
Reader / Replay Lease Registry
↓
Effective Reader Low Watermark
↓
Global Safe Epoch Aggregator
↓
Reclamation Candidate
↓
Fence Recheck
↓
Physical Delete
```

### Critical authority lifecycle

```text
SESSION_CREATED
↓
LEASE_GRANTED
↓
ACTIVE(token=71)
↓
SUSPECTED
↓
KEEPALIVE_MISSED
↓
LEASE_EXPIRED
↓
AUTHORITY_RETIRED
↓
NEW_LEASE(token=72)
↓
OLD SESSION RETURNS
↓
TOKEN 71 < 72
↓
FENCED
```

---

## Bottom-Level Logic

### Failure detector

```text
heartbeat_i timestamps
↓
inter-arrival model / timeout
↓
Suspect(worker)
```

但：

```text
Suspect(worker)
≠
ProofOfCrash(worker)
```

### Lease validity

```text
LeaseValid(s,t) =
  cluster_now < lease_expiry(s)
  ∧ membership_epoch(s) == current_epoch
```

### Fencing safety

對 resource R：

```text
AcceptWrite(R, token) iff
  token >= HighestAcceptedFence(R)
```

成功後：

```text
HighestAcceptedFence(R) = max(old, token)
```

### Distributed artifact reclaim predicate v2

```text
PhysicallyDeletable(A) =
  Unreachable(A)
  ∧ retire_epoch(A) < GlobalSafeEpoch
  ∧ NoCurrentLeaseReferences(A)
  ∧ NoReplayPin(A)
  ∧ NoAuditHold(A)
  ∧ NoInFlightMaterialization(A)
  ∧ FenceGenerationStable(A)
```

其中：

```text
GlobalSafeEpoch = min(
  GlobalWriteClosed,
  GlobalReplicaApplied,
  EffectiveReaderFloor,
  EffectiveReplayFloor
)
```

`Effective*Floor` 只統計仍有 current authority 的 sessions。

### Split-brain rule

兩個 worker 都「以為」自己是 active 並不可怕；真正要求是：

```text
At most one authority generation
can mutate protected resource.
```

也就是把 correctness 從：

```text
Only one process believes it is leader
```

轉成：

```text
Only current fenced authority can commit effects
```

---

## Visual Simulation Idea

# Lease, Failure Detector & Fencing Split-Brain Lab

介面左側建立三個 worker：

```text
Replay A
lease=991
fence=41
reader_epoch=100

Replay B
lease=992
fence=42
reader_epoch=130

GPU C
lease=880
fence=58
reader_epoch=125
```

中央顯示：

```text
Global Safe Epoch = 100
```

使用者按：

```text
PARTITION REPLAY A
```

畫面動畫：

```text
Heartbeat Lost
↓
SUSPECTED
↓
Lease TTL 8 → 7 → ... → 0
↓
LEASE EXPIRED
↓
Reader A removed from effective floor
↓
Global Safe Epoch
100 → 125
```

接著按：

```text
RECONNECT OLD A
```

A 嘗試：

```text
DELETE artifact_77
fence=41
```

Artifact Store 顯示：

```text
highest accepted fence = 42
41 < 42

REJECTED: STALE_AUTHORITY
```

第二模式：關閉 fencing validation，再重播同一事故：

```text
old A reconnects
↓
old request accepted
↓
LIVE ARTIFACT DELETED
↓
SPLIT-BRAIN CORRUPTION
```

這能非常直接解釋：「為什麼 timeout、lease、leader election 都還不夠」。

---

## Code / GitHub

### etcd

值得讀：

```text
server/lease/
├ lease.go
├ lease_queue.go
├ lessor.go
├ lessor_test.go
├ leasehttp/
└ leasepb/
```

`lessor.go` 已確認：
- Lessor 擁有 grant/revoke/renew/checkpoint/recover。
- Primary lessor 管理 expiry / renew。
- lease remaining TTL 會 checkpoint 到 consensus log。
- leader change 時存在很短的雙 primary window，但舊 leader 的低 term proposal 無法 commit。
- revoke lease 時，lease metadata delete 與 leased KV delete 被要求放在同一 backend transaction，避免 server failure 導致 half-revoke。

Source:
https://github.com/etcd-io/etcd/blob/main/server/lease/lessor.go

### ZooKeeper

值得讀：

```text
zookeeper-recipes/
└ zookeeper-recipes-lock/
```

官方 lock recipe 以 ephemeral + sequential znode 建立全域同步 lock；sequential suffix 可提供 monotonically ordered acquisition identity，但若要把 lock 拿去保護 ZooKeeper 之外的 external storage，仍需要 resource-side fencing semantics。

Source:
https://zookeeper.apache.org/doc/r3.7.2/recipes.html

---

## Papers

### Unreliable Failure Detectors for Reliable Distributed Systems
- Title: Unreliable Failure Detectors for Reliable Distributed Systems
- Authors: Tushar Deepak Chandra, Sam Toueg
- Institution: IBM / Cornell（作者當時 affiliations）
- Year: 1996
- Venue: Journal of the ACM 43(2), 225–267
- DOI: 10.1145/226643.226647
- URL: https://research.ibm.com/publications/unreliable-failure-detectors-for-reliable-distributed-systems
- Code: N/A
- Dataset: N/A
- Architecture/Mechanism: abstract unreliable failure detector classes characterized by completeness and accuracy; used to solve consensus/atomic broadcast under crash assumptions.
- Contribution: 把「偵測故障」從完美 oracle 改成可正式推理的不可靠 abstraction。
- Limitations: 理論 failure-detector model 不直接給 production timeout/lease/fencing implementation。
- 改變了什麼：Hermes 不再把 heartbeat timeout 當成 crash proof，而是把它放到 authority-revocation pipeline 的最前端。

### Fencing Tokens / Distributed Lock Safety（工程論證）
- Author: Martin Kleppmann
- Year: 2016
- URL: https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html
- Architecture: lease/lock service → monotonic fencing token → protected resource validation.
- Contribution: 明確展示 stop-the-world pause / lease expiry 後 stale client resurrection；提出 resource-side fencing。
- Limitation: blog/engineering argument，不是 formal consensus paper；實際 token semantics 仍取決於 resource adapter。
- 改變了什麼：Hermes 的 authority correctness 從「lock held」升級成「downstream accepts only current generation」。

---

## 已確認事實 / 工程實作 / 合理推論 / 未驗證假說

### 已確認事實
- etcd lease 到期會刪除 attached keys；keepAlive 延長 TTL。
- ZooKeeper session expiration 由 cluster 決定；ephemeral nodes 會被刪除；disconnected client 可能較晚才知道 session 已 expired。
- etcd lessor 原始碼承認短暫雙 primary 可能存在，但舊 term proposal 不能被 commit。
- etcd 官方文件明確指出，etcd lock/lease 不能單獨保護 etcd 之外的 external resource，外部資源需版本驗證。

### 工程實作
- `server/lease/lessor.go` 使用 lease map、expiry notifier、checkpoint heap、primary promotion/demotion 與 consensus-backed checkpoint。
- etcd membership 可加入 learner，catch up 後再 promote voter。

### 合理推論
- Hermes 可使用 `(membership_epoch, lease_generation, fencing_token)` 做 Unified Authority Generation。
- Global Safe Epoch 的 reader floor 應忽略已 expired 且被 fenced 的 sessions。
- Tool Gateway / Artifact Store / External Effect Adapter 都應成為 fencing enforcement points。

### 尚未驗證假說
- 是否能用同一個 fencing token namespace 同時涵蓋 Artifact Store、MCP execution 與外部 SaaS side effects；不同 downstream resource 很可能需要 per-resource fence domain。
- 如何在多 shard / 多 region 下高效維護 monotonically ordered fence 而不造成 central bottleneck。

---

## Unknown / Open Questions 1–3

1. Per-resource fencing vs global fencing：應該每個 artifact shard / capability domain 各自維護 fence，還是使用全域 authority epoch？
2. Long-running multimodal job 的 lease 已過期，但 GPU kernel / external tool 仍在執行，應如何做 preemption、completion discard 與 result fencing？
3. Membership change 與 replay branch recovery 同時發生時，舊 branch authority 如何重新取得合法 capability，而不是沿用舊 token？

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
Failure Detector
Suspicion Score
Heartbeat Stream
Session Lease
Lease TTL
Lease KeepAlive
Lease Expiration
Authority Generation
Fencing Token
Fence High Watermark
Stale Authority
Resource-Side Fence Validator
Membership Epoch
Learner Member
Voting Member
Authority Retirement
Lease-Constrained Reader Floor
Split-Brain Worker
```

### Edges

```text
Heartbeat Stream
→ feeds
Failure Detector

Failure Detector
→ produces
Suspicion

Suspicion
→ may_stop
Lease Renewal

Lease Expiration
→ retires
Authority

Authority Grant
→ increments
Fencing Token

Fencing Token
→ validated_by
Protected Resource

Stale Authority
→ rejected_by
Fence Validator

Membership Change
→ advances
Membership Epoch

Expired Session
→ no_longer_constrains
Effective Reader Floor

Effective Reader Floor
→ constrains
Global Safe Epoch
```

Negative edges:

```text
Timeout
≠
Crash Proof

Lease
≠
Fencing

Leader Election
≠
External Effect Protection

Session Expired
≠
Process Physically Dead

Mutual Exclusion Belief
≠
Side-Effect Safety
```

---

## 下一輪研究

下一輪最自然的缺口是：

# Capability Epoch × Long-Running Tool Cancellation × Result Fencing × GPU/MCP In-Flight Work

因為即使新 request 已被 fencing，還存在另一類問題：

```text
Worker A fence=41
↓
starts 15-minute video generation
↓
lease expires
↓
Worker B fence=42 becomes owner
↓
A's GPU job completes later
```

此時 A 不一定「再發起 stale write」；它可能只是把早已啟動的結果在 10 分鐘後回傳。Runtime 必須能辨識：

```text
ResultAuthority(job)
<
CurrentCapabilityEpoch
→ DISCARD / QUARANTINE / FORK
```

下一輪應研究：
- cancellation token vs distributed cancellation
- cooperative cancellation vs preemption
- orphaned tool execution
- late result fencing
- GPU kernel / batch inference cancellation
- MCP long-running task result authority
- capability epoch propagation
- result commit protocol

---

## 本輪結束回答

- 缺哪一層：Long-running in-flight execution 的 completion/result fencing。
- 哪個節點最淺：Per-resource Fence Domain 與跨 SaaS adapter 的 fence enforcement。
- 哪個概念仍只是名詞：Unified Agent Authority Generation / Capability Epoch ABI。
- 哪個系統值得讀原始碼：etcd `server/lease/lessor.go`，下一步再追 concurrency/session 與 Raft apply path；ZooKeeper lock recipe 次之。
- 哪篇論文需追引用：Chandra & Toueg 1996，並追 Phi Accrual Failure Detector 與 crash-recovery failure detector 文獻。
- 哪個概念最適合視覺模擬：Lease, Failure Detector & Fencing Split-Brain Lab。
- 哪個 Agent 架構最值得實作：

> Lease-Bound Fenced Agent Runtime = Failure Detector + Consensus Lease + Membership Epoch + Monotonic Fence + Resource-Side Validation + Lease-Constrained Global Safe Epoch

## 核心結論

真正分散式 Agent Runtime 不能把「連線斷掉」「heartbeat timeout」「lease 到期」「worker 死亡」「權限失效」當成同一件事。Failure detector 只產生 suspicion；lease 讓 authority 有有限生命；fencing token 才讓舊 authority 即使復活也不能再修改受保護資源。對 Hermes 而言，Global Safe Epoch 要能因 session expiry 繼續前進，但前提是 expired session 的所有後續 effect 都被 current fencing generation 拒絕。這樣才能同時得到 liveness（不被失聯 worker 永久卡死）與 safety（失聯 worker 復活也不會破壞世界）。
