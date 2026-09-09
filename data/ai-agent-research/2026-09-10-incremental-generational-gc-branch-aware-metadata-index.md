# 【AI Agent × Multimodal Research Report】

**時間：2026-09-10 00:52（Asia/Taipei）**  
**本輪主題：Incremental / Generational Artifact GC × Branch-Aware Reachability × Geometric Compaction × Billion-Scale Metadata Index**

## 歷史比較與本輪定位

上一輪已完成：`Artifact Granularity → Chunk Boundary → Content/Execution Hash → Merkle Artifact DAG → GC Roots → Mark/Sweep`，並明確指出完整 GC 在多模態 Agent 長期運行後可能遇到數十億 artifact/reference nodes 的成本問題。本輪不重複「什麼是 Mark/Sweep」，而是研究：

```text
Full DAG Traversal 太貴
↓
如何只處理最近變動區域？
↓
如何讓新 artifact 常整理、舊 artifact 少重寫？
↓
如何保留 replay branches / reflog-like historical heads？
↓
如何讓 metadata lookup / delete / compaction 可擴展？
```

本輪核心結論：**Hermes Artifact Store 不應只做單一 Full Mark/Sweep；更合理的是 Branch-Aware Root Set + Generational/Geometric Object Groups + Incremental Reachability Delta + LSM-style Metadata Index + Grace-period Cruft Generation。**

---

# 本小時新發現

## 新架構 / 系統

1. **Git geometric maintenance（2026）**：Git 現行 maintenance 已提供 `geometric` strategy，官方明確推薦大型 repository 使用；它依 pack object count 維持幾何級數，較新的小 packs 較常被合併，較深/較大的 packs 較少重寫。這和「Artifact Generations」高度相似。
2. **Incremental MIDX chain**：新版 Git `git repack --write-midx=incremental` 可建立多層 MIDX chain；新 tip layer 可以 append，而不必每次重寫完整 index。當 tip layer 累積到一定比例時再做 geometric merge，使 layer 數量對總物件數保持近似 logarithmic。
3. **Cruft Pack**：Git 不會把所有 unreachable object 立刻刪除，而是先放入 cruft pack，使用 `.mtimes` 保存 per-object age，再依 expiration window 後刪除。這提供 Agent Artifact GC 一個重要模型：`UNREACHABLE ≠ IMMEDIATELY DELETABLE`。
4. **RocksDB Bloom / LSM metadata path**：RocksDB 會為 SST 建 Bloom filter，在 lookup 時先判斷「一定不存在 / 可能存在」，降低大量 SST 掃描成本；但 Bloom filter 是 probabilistic negative index，不能直接當 authoritative reachability proof。
5. **DumpKV / VGKV / Scavenger+**：近期 KV-separated LSM research 持續證明 GC 不應只依固定 threshold；lifetime prediction、variable-granularity GC、load-aware scheduling、space-aware compaction 都能降低 GC/compaction write cost。這支持 Hermes 未來以 artifact lifetime / branch activity / replay criticality 做 GC scheduling，而不是所有 object 一視同仁。

---

# 本小時最重要 5 個發現

## 1. Branch Head 應該像 Git refs / reflogs 一樣成為第一級 GC Root

### 是什麼

多模態 Agent 有很多不是「目前主線」但仍可能需要 replay 的歷史：

```text
conversation/main
conversation/fork/model-B
research/branch-42
world-model/snapshot-119
human-review/checkpoint-7
```

如果 GC 只把 current conversation head 當 root，歷史 branch 可能被誤刪。

### 底層如何運作

Hermes 應維護：

```text
RootRegistry
├ Active Branch Heads
├ Durable Checkpoints
├ Replay Pins
├ Audit Holds
├ World Snapshot Heads
├ In-flight Leases
└ Expiring Historical Heads
```

每個 branch root 再有 retention horizon：

```text
BranchRoot
├ root_artifact_id
├ created_at
├ last_access
├ retention_class
├ expiry_at
└ legal/audit hold
```

### 為什麼重要

Git 的 reachability 本質也是「從 refs / reflogs / kept objects 出發決定 reachable object」。Git cruft-pack 設計還特別保留 grace period，避免 concurrent writes / newly referenced objects 因過早 pruning 被破壞。

### 限制

Git object model 比 AI Artifact DAG 單純：AI 還有 encoder version、external effect evidence、audit policy、privacy retention 等額外 root 類型。

### 來源

- Git gc / cruft pack: https://git-scm.com/docs/git-gc
- Git cruft pack: https://git-scm.com/docs/cruft-packs.html

---

## 2. Generational GC 在 Artifact Store 應理解成「不同改寫頻率」，不是照搬 JVM Young/Old Heap

### 是什麼

AI Artifact Store 可分：

```text
Generation 0 / HOT
- 最近一小時的新 frames
- 最新 tool observations
- 新 branch artifacts

Generation 1 / WARM
- 最近數日 replay 仍常用
- finalized encoder features

Generation 2 / COLD
- pinned historical runs
- archived raw media
- audit evidence
```

### 底層如何運作

核心不是 object age 本身，而是：

```text
PromotionScore =
Age
+ ReplayFrequency
+ BranchStability
+ RecomputeCost
+ AuditCriticality
- MutationRate
```

高 mutation / 新 artifact 留在 hot generation；穩定的老 artifact 逐步 compact 到更少、較大的 segment。

Git 2026 的 geometric repack 正好給一個 production analogy：小/新 packs 常 merge；大/老 packs 保持不動，避免每次 maintenance 全量 rewrite。

### 為什麼重要

如果每小時研究都產生一批 artifacts，Full GC 每次掃完整歷史會讓 GC 成本隨總歷史線性成長；generation-based maintenance 則讓成本更接近「與近期變更量相關」。

### 限制

Artifact graph 可以從老 object 指向新 derived object，因此不能只靠 age 決定 reachability；仍需 remembered edge / mutation log。

### 來源

- Git maintenance geometric strategy: https://git-scm.com/docs/git-maintenance.html
- Git repack geometric / incremental MIDX: https://git-scm.com/docs/git-repack

---

## 3. Incremental Reachability 需要 Mutation Log / Remembered Set

### 問題

若完整 mark set 是昨天計算的：

```text
Root A → B → C
```

今天新發生：

```text
C → NEW_X
Branch B → NEW_Y
```

不能重掃全部 graph 才知道 X/Y reachable。

### Hermes 工程模型

```text
Graph Mutation
↓
Append MutationLog
├ ADD_EDGE
├ REMOVE_EDGE
├ ADD_ROOT
├ REMOVE_ROOT
├ PIN
└ UNPIN
↓
RememberedSet
↓
Incremental Mark Queue
↓
Reachability Delta
```

可定義：

```text
Reachable_t
=
Reachable_(t-1)
+ NewlyReachable
- CandidateUnreachable
```

但 `CandidateUnreachable` 不能立刻 delete，因為 edge removal 可能讓整個 subtree 變成「需要重新驗證是否仍由其他 branch 到達」。

因此安全流程：

```text
REMOVE_EDGE
↓
Potentially Dead Region
↓
Reverse-reference / root reachability check
↓
Cruft Generation
↓
Grace Period
↓
Final Sweep
```

### 為什麼重要

這是從「stop-the-world Full Mark」走向長期常駐 Agent Storage Runtime 的必要一步。

### 限制

真正 incremental tracing GC 的 write barrier / tri-color invariant 比上述工程模型更嚴格；Hermes 需要在實作時明確設計 concurrency invariant。

---

## 4. Billion-scale Metadata Index 應拆成 Authoritative Index + Probabilistic Filter

### 是什麼

對數十億 artifact hashes，如果每次 materialize / GC 都掃 object store listing 不可行。

可建：

```text
Artifact CID
↓
Bloom / Cuckoo Filter
↓
Maybe Exists?
├ NO → stop
└ MAYBE → authoritative index lookup
             ↓
          LSM / RocksDB
             ↓
      ArtifactMetadata
```

### 底層如何運作

RocksDB Bloom Filter：

```text
Key
↓
multiple hash probes
↓
任一 bit = 0
→ definitely absent

all bits = 1
→ maybe present
→ read SST/index
```

因此：

```text
Bloom Negative = useful
Bloom Positive ≠ proof
```

Authoritative metadata 可保存：

```text
ArtifactMeta
├ cid
├ execution_hash
├ parents[]
├ generation
├ branch_refs
├ ref_summary
├ storage_replicas[]
├ tombstone_epoch
├ last_access
└ retention_class
```

### 為什麼重要

這讓 runtime 的 `resolve(cid)`、dedup、GC candidate lookup 不必掃全 store。

### 限制

LSM compaction 本身會造成 write amplification；因此 GC metadata tombstone 與 compaction scheduler 不能分開設計。

### 來源

- RocksDB Bloom Filter: https://github.com/facebook/rocksdb/wiki/RocksDB-Bloom-Filter
- RocksDB compaction: https://github.com/facebook/rocksdb/wiki/Compaction

---

## 5. GC 應分「Logical Death」與「Physical Reclamation」

### 是什麼

Artifact 變 unreachable 後，至少經過：

```text
LIVE
↓
UNREACHABLE_CANDIDATE
↓
TOMBSTONED
↓
CRUFT / QUARANTINE
↓
EXPIRED
↓
PHYSICAL_DELETE
↓
INDEX_COMPACTED
```

### 為什麼不是直接 delete

因為可能存在：

```text
concurrent branch creation
late root registration
in-flight replay
metadata/index lag
object-store eventual consistency
human audit hold
```

Git cruft pack 的設計正是在「unreachable」與「expired/deletable」之間加入時間維度；RocksDB DeleteRange 也使用 tombstone，實體空間真正回收要等 compaction。

### 重要結論

```text
Logical Deletion
≠
Physical Reclamation
```

且：

```text
Tombstone Written
≠
Disk Space Reclaimed
```

### 來源

- Git cruft pack / expiration
- RocksDB DeleteRange / compaction

---

# Architecture Breakdown

```text
Agent / Multimodal Runtime
↓
Artifact Creation
↓
Content / Execution Address
↓
Metadata Write-Ahead Log
↓
HOT Metadata Memtable
↓
LSM Metadata Index
├ Bloom/Ribbon filter
├ SST index
└ Tombstones
↓
Branch Root Registry
├ active heads
├ replay heads
├ checkpoints
├ audit pins
└ leases
↓
Mutation Log
↓
Incremental Reachability Engine
├ root delta
├ edge delta
├ remembered set
└ mark queue
↓
Generation Classifier
├ HOT
├ WARM
├ COLD
└ ARCHIVE
↓
Geometric Compactor
├ merge recent small segments
├ keep large stable segments
└ update global object index
↓
Unreachable Candidate Set
↓
Cruft / Grace Generation
↓
Expiry Verifier
↓
Physical Sweep
↓
Metadata Tombstone
↓
LSM Compaction
```

---

# Bottom-Level Logic

## A. Branch-aware reachability

```text
Roots_t = ActiveHeads ∪ ReplayPins ∪ AuditHolds ∪ Checkpoints ∪ Leases

Reachable_t = Traverse(ArtifactDAG, Roots_t)
```

Incremental approximation：

```text
DeltaRoots = Roots_t - Roots_(t-1)
DeltaEdges = MutationLog(t-1,t)

NewMarks = TraverseFrom(DeltaRoots + newly-linked reachable parents)
```

而 root removal 不能直接反向 unmark；必須先把 affected region 放入 `maybe_dead` queue，再檢查其他 incoming live paths。

## B. Geometric generation compaction

若 segment object counts：

```text
8, 12, 31, 70, 160
```

期望 ratio factor = 2，若小 segments 破壞幾何級數，就只 roll-up 最小必要集合，而不是重寫 160-object 老 segment。

這正是 Git geometric repack 的核心思想，可轉成：

```text
frequently mutate tip generations
↓
occasionally merge downward
↓
old stable generations rewritten rarely
```

## C. Metadata lookup path

```text
CID
↓
BloomFilter
├ definitely absent → MISS
└ maybe present
      ↓
    LSM lookup
      ↓
  newest version / tombstone
      ↓
  replica locator
```

## D. GC safety predicate

Hermes 工程上可先採：

```text
SafeToPhysicallyDelete(x)
=
NotReachableFromAnyRoot(x)
∧ NoActiveLease(x)
∧ TombstoneAge > GracePeriod
∧ NoAuditHold(x)
∧ MetadataEpochStable(x)
∧ ReplicaDeletionQuorumSatisfied(x)
```

這是工程建模，不是 Git / RocksDB 官方公式。

---

# Visual Simulation Idea

# **Artifact Generational GC & Branch Reachability Observatory**

畫面左側是一張 branch graph：

```text
main ───── A ─ B ─ C ─ D
               \
model-B         └ E ─ F

replay-pin ───────── F
```

中間顯示 generation：

```text
HOT
D E F new-frame-92 new-token-41

WARM
B C feature-12

COLD
A raw-video-1

CRUFT
old-branch-X objects
```

右側顯示 metadata layers：

```text
MIDX / LSM Layer 0   12K nodes
Layer 1             230K nodes
Layer 2             4.1M nodes
Layer 3             81M nodes
```

允許使用者操作：

```text
CREATE BRANCH
DELETE BRANCH
PIN REPLAY
UNPIN
ADD ARTIFACT
RUN INCREMENTAL GC
RUN FULL GC
ADVANCE GRACE PERIOD
COMPACT INDEX
```

動畫例子：

```text
Delete model-B branch
↓
E,F become MAYBE_DEAD
↓
F still reachable from replay-pin
↓
F KEEP
↓
E has no other root path
↓
E → CRUFT
↓
72h grace expires
↓
E → SWEEP
```

還可以顯示 Full GC vs Incremental GC：

```text
Full GC nodes scanned:        81,230,442
Incremental GC nodes scanned:     18,211
```

並顯示 false-positive Bloom hit：

```text
Bloom: MAYBE
LSM: NOT FOUND
→ false positive, safe
```

這會把 Branch、Generation、Index、GC 四個抽象概念放進同一個互動模型。

---

# Code / GitHub

## Git

值得繼續讀：

```text
git/git
├ builtin/gc.c
├ builtin/repack.c
├ repack-midx.c
├ midx.c
├ pack-bitmap.c
├ reachable.c
└ builtin/prune.c
```

本輪已確認 `builtin/gc.c` 中存在 `incremental_strategy` 與新的 `geometric_strategy`；geometric strategy 會排程 commit-graph、geometric-repack、pack-refs、reflog-expire、worktree-prune 等 maintenance tasks。

`repack-midx.c` / `builtin/repack.c` 則是下一步理解 geometric split line、MIDX layer merging 與 cruft interaction 的核心檔案。

## RocksDB

值得看：

```text
facebook/rocksdb
├ db/
├ table/
├ db/compaction/
├ db/range_tombstone_fragmenter.cc
├ include/rocksdb/table.h
└ options/options.cc
```

RocksDB source 確認 `NewBloomFilterPolicy(...)`、block/index/filter caching 及 range tombstone/compaction 路徑均為 production runtime 內容，而不是文件抽象。

## DumpKV

```text
BilyZ98/DumpKV
```

它基於 RocksDB，值得下一輪直接追：lifetime feature collection、prediction、GC trigger、Blob/value-log selection 與 compaction integration，而非只讀 README。

---

# Papers

## 1. DumpKV: Learning Based Lifetime Aware Garbage Collection for Key Value Separation in LSM-Tree

- **Authors**: Zhutao Zhuang, Xinqi Zeng, Zhiguang Chen
- **Institution**: Sun Yat-Sen University / Microsoft affiliation reported in index sources
- **Year**: PVLDB Vol.18 No.4, 2025（arXiv 2024）
- **URL**: https://doi.org/10.14778/3717755.3717778
- **Code**: https://github.com/BilyZ98/DumpKV
- **Dataset / Workload**: YCSB-style workloads
- **Architecture**: LSM KV separation + learned lifetime predictor + GC scheduling
- **Contribution**: 由 static threshold 轉向 per-key lifetime-aware GC；作者報告相對既有 KV-separated GC 顯著降低 write amplification / GC writes。
- **Limitations**: 針對 KV separation storage；預測錯誤與 workload drift 會影響效果，不能直接視為 Artifact DAG reachability algorithm。
- **改變了什麼**: GC policy 可由固定閾值進化成 workload/lifetime-aware scheduler。

## 2. VGKV: Variable Granularity Garbage Collection with SSTable Management for KV Separation

- **Authors**: Y. Cai, Y. Pan, H. Zhang
- **Venue / Year**: Future Generation Computer Systems 183, 2026
- **DOI**: 10.1016/j.future.2026.108525
- **Architecture**: fine/coarse variable-granularity GC + SSTable placement/management
- **Contribution**: 同時降低 live-value migration 與 index update/compaction overhead。
- **Limitations**: storage workload-specific；不是 graph reachability GC。
- **改變了什麼**: 證明 GC granularity 本身可動態調整，而非固定 block/segment policy。

## 3. Scavenger+: Revisiting Space-Time Tradeoffs in Key-Value Separated LSM-trees

- **Authors**: Jianshun Zhang et al.
- **Year**: 2025 preprint
- **URL**: https://arxiv.org/abs/2508.13935
- **Architecture**: I/O-efficient GC + space-aware compaction + dynamic GC scheduler
- **Contribution**: 把 GC、index space amplification、system load 一起考慮。
- **Limitations**: 並非 AI artifact workload；結果不能直接外推到 multimodal replay store。
- **改變了什麼**: GC scheduling 應與 compaction / load / space budget共同最佳化。

---

# 已確認事實 / 工程實作 / 合理推論 / 尚未驗證假說

## 已確認 / 官方

- Git 現行 maintenance 存在 `geometric` strategy，官方建議大型 repository 使用。
- Git incremental MIDX 可以 append layer，避免每次完整重寫 global MIDX。
- Git cruft pack 保留 unreachable object 的 per-object mtime 並使用 grace period。
- RocksDB Bloom filter 只能判斷 definitely-absent / maybe-present。
- RocksDB tombstone 的實體空間回收依賴 compaction。

## 工程實作確認

- `git/git:builtin/gc.c` 已含 incremental / geometric maintenance strategy。
- `git/git:repack-midx.c`、`builtin/repack.c` 含 geometric split / MIDX repack logic。
- RocksDB repo 中存在 Bloom filter、range tombstone、compaction production path。

## 合理推論 / Hermes 工程模型

- Multimodal Artifact Store 可借鑑 Git geometric packs 做 generational artifact segments。
- Branch-aware GC root registry 可借鑑 Git refs/reflogs，但需加入 replay pin / audit hold / lease。
- LSM + Bloom 可作 billion-scale artifact metadata index。
- Unreachable artifact 應先進 cruft/quarantine generation，再 physical delete。

## 尚未驗證假說

- `Geometric Artifact Segments + Incremental Reachability Delta` 是否比 full mark/sweep 在實際 Hermes multimodal workload 有顯著成本優勢。
- Bloom/Cuckoo + RocksDB 是否能在十億 artifact metadata、頻繁 branch churn 下維持可接受 tail latency。
- Lifetime-prediction GC 是否可安全用於 replay-retention；錯誤預測不能影響 correctness，只能影響優先級。

---

# Unknown / Open Questions

1. **Incremental reachability correctness**：Artifact DAG 高度並行更新時，要採 write barrier、epoch barrier、RCU 還是 snapshot-isolation 才能保證不漏標？
2. **Reverse-reference cost**：為快速確認 subtree 是否還被其他 branch 引用，是否需要 persistent reverse-edge index？其 metadata 可能與正向 edge 一樣大。
3. **Branch retention semantics**：Agent fork 的 reflog-like grace period應基於時間、storage budget、使用頻率，還是 decision/audit value？

---

# 下一輪研究

下一輪最值得進：

# **Concurrent GC × Epoch / RCU × Write Barrier × Snapshot Isolation × Race-Free Artifact Mutation**

因為本輪已經把 incremental GC 建模出來，但真正 production 危險會發生在：

```text
GC 正在 mark
↓
Agent 同時建立新 branch
↓
Encoder 同時 materialize 新 artifact
↓
Memory system 同時 remove old edge
↓
哪一個 object 到底算 live？
```

下一輪要拆：

```text
Mutator
↓
Write Barrier
↓
GC Epoch
↓
Snapshot-at-the-Beginning / Incremental Update
↓
Tri-color invariant
↓
Concurrent Mark
↓
Lease / Hazard Pointer / RCU
↓
Safe Sweep
```

並比較：

```text
Stop-the-world Mark/Sweep
vs
Snapshot-at-the-Beginning
vs
Incremental-update Barrier
vs
Epoch-based Reclamation
vs
RCU / Hazard Pointer
```

再把它轉成 Agent Artifact Runtime，而不是只停留在語言 VM GC。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Branch Root Registry
Historical Head
Replay Pin
Reflog-like Root
Artifact Generation
Hot Generation
Warm Generation
Cold Generation
Cruft Generation
Mutation Log
Remembered Set
Reachability Delta
Maybe-Dead Region
Geometric Compactor
Incremental MIDX-like Index
LSM Metadata Index
Probabilistic Existence Filter
Metadata Tombstone
Grace Period
Physical Reclamation
```

## Edges

```text
Branch Head
→ acts_as
GC Root

Root Delta
→ feeds
Incremental Reachability

Graph Mutation
→ appended_to
Mutation Log

Mutation Log
→ updates
Remembered Set

Stable Artifact
→ promoted_to
Older Generation

Recent Segments
→ merged_by
Geometric Compactor

Unreachable Candidate
→ enters
Cruft Generation

Grace Period Expiry
→ permits
Physical Reclamation

Bloom Filter
→ accelerates
Metadata Absence Check

LSM Tombstone
→ represents
Logical Deletion

Compaction
→ performs
Physical Metadata Reclamation

Unreachable
≠
Immediately Deletable

Bloom Positive
≠
Object Exists

Logical Deletion
≠
Physical Reclamation
```

---

# 本輪收斂回答

- **缺哪一層**：Concurrent mutation 下的 race-free incremental GC correctness layer。
- **哪個節點最淺**：Remembered Set / reverse-reference design。
- **哪個概念仍只是名詞**：Unified Branch Retention ABI、Artifact Generation Promotion Policy。
- **哪個系統值得讀原始碼**：Git `repack-midx.c + builtin/repack.c + builtin/gc.c`，其次 RocksDB compaction/range tombstone，第三 DumpKV GC scheduler。
- **哪篇論文需追引用**：DumpKV、Scavenger+；並追 2026 VGKV 的後續引用與 code 是否釋出。
- **哪個概念最適合視覺模擬**：Artifact Generational GC & Branch Reachability Observatory。
- **哪個 Agent 架構最值得實作**：**Branch-Aware Generational Artifact Runtime = Root Registry + Mutation Log + Incremental Reachability + Geometric Compaction + LSM Metadata Index + Cruft Grace Generation**。

## 本輪核心結論

真正能長期運作的多模態 Agent Memory，不應每次都重新掃描整張歷史 Artifact DAG。更接近 production 的架構是：**新資料進 Hot Generation、穩定資料逐步 geometric compact、branch/replay/audit heads 明確成為 GC roots、graph mutation 進 append-only mutation log、reachability 以 delta 增量更新；物件失去 root 後先成為 cruft/tombstone，而不是立刻刪除。Metadata 則透過 probabilistic filter + authoritative LSM index 支援 billion-scale lookup。** 下一個真正需要補的，不再是 GC policy，而是「GC 與 Agent 同時寫入世界時，如何保證永遠不誤刪」。