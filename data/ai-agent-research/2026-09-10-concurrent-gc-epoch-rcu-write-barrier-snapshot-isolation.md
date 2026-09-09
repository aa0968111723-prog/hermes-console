# 【AI Agent × Multimodal Research Report】

**時間：2026-09-10 01:51（Asia/Taipei）**  
**本輪主題：Concurrent Artifact GC × Epoch/RCU × Write Barrier × Snapshot Isolation × Race-Free Artifact Mutation**

## 歷史比較與本輪定位

上一輪已建立：Branch Root Registry → Mutation Log → Incremental Reachability → Generational Artifact Memory → Cruft/Grace → Physical Reclamation。本輪不重複「怎麼找垃圾」，而是研究：**當 Agent、Vision Encoder、Replay Runtime、Artifact Materializer 與 GC 同時修改/讀取 Artifact DAG 時，如何保證 GC 不會把仍被使用的 artifact 刪掉？**

歷史鏈條：

```text
Content-addressed Artifact DAG
→ Branch-aware Roots
→ Incremental Reachability
→ Generational GC
→ Concurrent Mutation Problem   ← 本輪
→ Write Barrier / Snapshot Isolation / Epoch
→ Race-free Reclamation
```

---

## 本小時新發現

### 1. Concurrent GC 的真正難題不是掃描速度，而是「collector 看見的 graph 是否仍是合法 snapshot」

**已確認事實：** Go 的 concurrent tri-color collector將 heap 視為 white/grey/black graph；在 mutator 同時改 pointer 時，write barrier 用來避免 collector 已掃過的 black object 指向未被發現的 white object。官方 Go GC 文章明確把「no black → white edge」列為 write barrier 維護的核心 invariant。

來源：
- Go, *Go GC: Prioritizing low latency and simplicity*: https://go.dev/blog/go15gc
- Go, *Getting to Go: The Journey of Go's Garbage Collector*: https://go.dev/blog/ismmkeynote

對 Hermes 的對應：

```text
black artifact
= collector 已完成掃描的 artifact

white artifact
= 尚未被 collector 發現

Agent mutation:
black_parent → new_white_child
```

如果沒有 barrier：

```text
Collector 已掃過 parent
↓
Agent 新增 parent → child
↓
Collector 永遠沒看到 child
↓
child 被錯誤 sweep
```

所以 Hermes 的 Artifact DAG 需要一級 runtime primitive：

```text
artifact_write_barrier(parent, old_edge, new_edge, gc_epoch)
```

它不是 database transaction 的同義詞，而是「mutation 必須向 concurrent reachability collector 留證據」。

---

### 2. SATB（Snapshot-at-the-Beginning）不是凍結整個世界，而是保留 collector 開始時仍可達的舊 reference

**已確認工程實作：** OpenJDK G1 的 SATB barrier 在 marking active 時，把 field 被覆寫前的 old reference 放進 SATB mark queue。`G1BarrierSetRuntime::write_ref_field_pre_entry` 會把原本 field 裡的 reference enqueue 到 thread-local SATB queue；`satbMarkQueue.*` 明確維護這些可能 stale 的 object pointers。

值得看的原始碼：

```text
openjdk/jdk
src/hotspot/share/gc/shared/satbMarkQueue.hpp
src/hotspot/share/gc/shared/satbMarkQueue.cpp
src/hotspot/share/gc/g1/g1BarrierSet.cpp
src/hotspot/share/gc/g1/g1BarrierSet.inline.hpp
src/hotspot/share/gc/g1/g1BarrierSetRuntime.cpp
```

GitHub：https://github.com/openjdk/jdk

對 Hermes 可轉化成：

```text
GC Epoch E starts
↓
Snapshot root-set R_E
↓
Agent removes edge A → B
↓
SATB Artifact Barrier records OLD edge A → B
↓
B remains markable for epoch E
```

因此：

```text
REMOVE_EDGE
≠
Immediately make child reclaimable
```

而應該：

```text
REMOVE_EDGE
→ record old reference for active GC epoch
→ complete epoch mark
→ only later test reclamation
```

**重要限制：** SATB 保護的是「cycle 開始時可達的東西不要漏掉」，不是自動保證新建立的所有邊都正確被追蹤；具體 barrier strategy 仍依 collector invariant 而異。

來源交叉驗證：
- OpenJDK G1 SATB source: https://github.com/openjdk/jdk/tree/master/src/hotspot/share/gc/g1
- Vechev & Bacon, *Write Barrier Elision for Concurrent Garbage Collectors*, ISMM 2004: https://www.sri.inf.ethz.ch/publications/vechev2004write

---

### 3. RCU 解的是「remove 已完成，但 reader 可能還拿著舊 pointer」；這和 reachability mark 是不同問題

**官方資訊：** Linux RCU 把 destructive update 分成 removal 與 reclamation 兩階段。Updater 可先讓新 reader 看不到被移除項目，再等待 grace period，直到所有 pre-existing RCU readers 離開 critical section，才真正 free object。

```text
UNLINK artifact
↓
new readers cannot acquire it
↓
old readers may still hold it
↓
wait grace period
↓
physical reclaim
```

Linux Kernel 官方文件：
- https://docs.kernel.org/next/RCU/rcu.html
- https://docs.kernel.org/6.2/RCU/Design/Requirements/Requirements.html

Hermes 對應：

```text
Artifact removed from Root/Index
≠
No runtime still has pointer to Artifact
```

可能還存在：

```text
Replay worker
Vision materializer
GPU transfer task
Tool executor
UI inspector
Background verifier
```

所以即使 graph reachability 已判定 dead，也要有：

```text
logical_unlink_epoch
↓
reader epochs / leases
↓
minimum_active_epoch
↓
reclamation eligibility
```

可定義：

```text
SafeToReclaim(A) =
  !ReachableFromAnyRoot(A)
  AND A.retire_epoch < MinActiveReaderEpoch
  AND !HasLease(A)
  AND !AuditPinned(A)
```

**關鍵區分：**

```text
Tracing GC
→ 發現 graph reachability

RCU / Epoch Reclamation
→ 保證 reader 不再握有舊 reference
```

兩者不是替代關係。

---

### 4. Snapshot Isolation / MVCC 提供的是「reader 看一致版本」，並直接影響舊 artifact 何時可被 GC

**已確認工程資訊：** RocksDB snapshot 以 sequence number 固定 point-in-time view。Flush/compaction 會知道所有 snapshots，保留仍對任何 snapshot 可見的資料；官方文件也指出 snapshot 數量很大時，尋找 earliest visible snapshot 會增加 compaction 成本。

來源：
- RocksDB Snapshot: https://github.com/facebook/rocksdb/wiki/Snapshot
- RocksDB Terminology: https://github.com/facebook/rocksdb/wiki/Terminology

Hermes 對應：

```text
Branch / Replay Snapshot S@epoch=120
↓
artifact version v7 visible

Current world @epoch=150
↓
artifact version v9 visible
```

只因 v7 已不是 current version，不代表可以刪：

```text
Old Version
≠
Garbage
```

真正回收條件要同時考慮：

```text
visibility_to_live_snapshots
+
root reachability
+
active readers
+
retention policy
```

這讓 Artifact GC 從單純 graph collector 變成：

```text
MVCC Reachability Collector
```

---

### 5. 最合理的 Hermes 架構不是選「SATB vs RCU vs MVCC」，而是分層組合

**工程推論（由上述官方/原始碼機制建模，不是現有標準）：**

```text
Layer 1: MVCC Snapshot
確保 reader 看到一致歷史版本

Layer 2: Concurrent Reachability GC
判斷 artifact 是否仍從任何 durable root 可達

Layer 3: Write Barrier
讓 mutator 的 graph changes 不破壞 collector invariant

Layer 4: Epoch / RCU Reclamation
確保所有拿著 old pointer 的 reader 都已退出

Layer 5: Lease / Pin / Audit Fence
處理 GPU transfer、replay、audit 等非普通 graph reader

Layer 6: Tombstone / Grace / Physical Delete
最後才真正回收 storage replica
```

所以：

```text
Unreachable
≠
Invisible to snapshot
≠
No active reader
≠
Safe to physically delete
```

這是本輪最重要的 Knowledge Graph 分層。

---

# 本小時最重要 5 個發現

## 1. Write Barrier 是 concurrent graph correctness primitive

**是什麼：** mutator 每次改 Artifact DAG reference 時產生 collector-visible 訊號。  
**底層：** 維護 tri-color 或 SATB invariant，避免 graph edge 在 concurrent marking 中被漏掉。  
**重要性：** 沒有它，incremental GC 可能把仍活著的 multimodal artifact 回收。  
**限制：** barrier 會增加 mutation overhead，需要 batch/thread-local queue。  
**來源：** Go GC 官方文章 + OpenJDK G1 SATB source。

## 2. SATB Queue 應映射成 Artifact Old-Edge Log

**是什麼：** mutation 刪除或覆蓋 edge 時，保留舊 reference。  
**底層：** pre-write barrier → old edge → epoch-local queue → mark.  
**重要性：** collector 可以近似掃描「cycle 開始時的 graph」。  
**限制：** 可能產生 floating garbage，即 cycle 中已變 dead 的 artifact 延後一輪回收。  
**來源：** OpenJDK `satbMarkQueue.*`, `g1BarrierSet*`。

## 3. RCU Grace Period 應成為 Physical Delete Fence

**是什麼：** logical unlink 後延後 physical reclaim。  
**底層：** retire_epoch + active reader epochs → grace period.  
**重要性：** 避免 replay/materializer 仍持有 artifact pointer 時發生 use-after-delete。  
**限制：** 長時間 reader 會拖慢 reclaim，造成 memory/storage retention。  
**來源：** Linux Kernel RCU 官方文件。

## 4. Snapshot 會讓歷史版本維持「活著」

**是什麼：** point-in-time branch/replay view。  
**底層：** sequence/epoch visibility rules 決定哪個 artifact version 可被某 reader 看見。  
**重要性：** old version 不能因 current pointer 被更新就被刪。  
**限制：** snapshot 太多會增加 retention 與 compaction/GC metadata 成本。  
**來源：** RocksDB Snapshot / sequence-number implementation docs。

## 5. GC correctness 要用「多條件 terminal predicate」而不是單一 refcount

建議：

```text
PhysicallyDeletable(A) =
  Unreachable(A)
  ∧ NotVisibleToLiveSnapshot(A)
  ∧ RetireEpoch(A) < MinActiveReaderEpoch
  ∧ NoLease(A)
  ∧ NoAuditHold(A)
  ∧ GraceExpired(A)
```

這是合理工程模型，不是某單一 framework 的既有 API。

---

# Architecture Breakdown

```text
Agent / Vision / Replay / UI Mutators
↓
Artifact DAG Mutation API
↓
Write Barrier
├ ADD_EDGE barrier
├ REMOVE_EDGE/SATB old-edge log
├ ROOT_ADD
├ ROOT_REMOVE
└ VERSION_REPLACE
↓
Mutation WAL
↓
MVCC Artifact Index
├ commit_epoch
├ valid_from
├ valid_until
└ snapshot visibility
↓
Concurrent Marker
├ Root Snapshot
├ Grey Queue
├ SATB Queue
├ Remembered Set
└ Reachability Bitmap
↓
Candidate Retire Set
↓
Logical Unlink
↓
Retire Epoch
↓
Reader Epoch Registry
├ Replay Runtime
├ GPU Materializer
├ Tool Runtime
├ UI Inspector
└ Verifier
↓
RCU / Epoch Grace Period
↓
Lease / Pin / Audit Check
↓
Tombstone
↓
Cruft / Quarantine Generation
↓
Grace Expiry
↓
Physical Replica Delete
↓
Metadata Compaction
```

---

# Bottom-Level Logic

## Tri-color invariant

```text
WHITE = unseen
GREY  = discovered, children not fully scanned
BLACK = scanned
```

Desired invariant:

```text
BLACK --X--> WHITE
```

or, more generally, every new edge that could hide a reachable white object must be represented in the collector's work set/barrier protocol.

### Artifact example

Before:

```text
A(BLACK)
B(WHITE)
```

Mutator:

```text
A.children += B
```

Without barrier:

```text
collector never rescans A
→ B remains WHITE
→ B may be swept
```

With barrier:

```text
write_barrier(A,B)
→ grey(B) or record mutation
→ B enters mark queue
```

## SATB old-edge rule

Before overwrite:

```text
A.child = B
```

Mutator wants:

```text
A.child = C
```

Pre-barrier:

```text
SATB.enqueue(B)
A.child = C
```

Thus B cannot disappear from epoch-E snapshot merely because the edge was overwritten during marking.

## Epoch reclamation rule

```text
retire_epoch(A) = 42
active readers = [40, 44, 47]
```

Because reader@40 could still have acquired A before unlink:

```text
MinActiveReaderEpoch = 40
42 < 40 ? NO
→ cannot reclaim
```

After reader@40 exits:

```text
active = [44,47]
Min = 44
42 < 44
→ epoch fence passes
```

Still must check snapshot/pin/lease policy.

---

# Visual Simulation Idea

## **Concurrent Artifact GC Race Lab**

畫面左側：Mutators

```text
Agent Planner
Vision Encoder
Replay Worker
UI Viewer
```

中央：Artifact DAG

```text
Root
 ↓
 A(BLACK) → B(GREY) → C(WHITE)
```

右側：Collector

```text
Epoch = 42
Grey Queue
SATB Queue
Reader Epochs
Lease Table
```

使用者可在 collector 掃描中按：

```text
ADD EDGE
REMOVE EDGE
CREATE BRANCH
DROP BRANCH
PIN REPLAY
START GPU LOAD
END READER
```

### Race 1：沒有 write barrier

```text
Collector scans A → BLACK
↓
Agent adds A → C
↓
C stays WHITE
↓
SWEEP
↓
BUG: LIVE ARTIFACT DELETED
```

### Race 2：SATB barrier

```text
A → B removed
↓
old B enters SATB queue
↓
B marked for current epoch
↓
SAFE, but possibly floating garbage
```

### Race 3：RCU

```text
Branch unlink artifact X
↓
Replay reader still holds X
↓
retire_epoch=50
reader_epoch=48
↓
PHYSICAL DELETE BLOCKED
```

### Race 4：Snapshot

```text
current branch uses v9
replay snapshot still sees v7
↓
v7 remains retained
```

Simulator 最後顯示：

```text
Reachability Safe?      YES/NO
Snapshot Safe?          YES/NO
Reader Epoch Safe?      YES/NO
Lease Safe?             YES/NO
Audit Safe?             YES/NO
Physical Delete Safe?   YES/NO
```

---

# Code / GitHub

## OpenJDK G1 / SATB

Repository: https://github.com/openjdk/jdk

值得讀：

```text
src/hotspot/share/gc/shared/satbMarkQueue.hpp
src/hotspot/share/gc/shared/satbMarkQueue.cpp
src/hotspot/share/gc/g1/g1BarrierSet.cpp
src/hotspot/share/gc/g1/g1BarrierSet.inline.hpp
src/hotspot/share/gc/g1/g1BarrierSetRuntime.cpp
```

核心工程線索：
- SATB queues 只在 marking cycle active。
- pre-write barrier 取得 old value。
- old reference enqueue 至 thread-local SATB queue。
- queue overflow 有 runtime slow path。

## Linux RCU

Source/docs: https://github.com/torvalds/linux/tree/master/Documentation/RCU

值得追：

```text
Documentation/RCU/
kernel/rcu/
include/linux/rcupdate.h
```

核心：read-side critical section、`synchronize_rcu()`、callback/grace period、remove/reclaim 分離。

## RocksDB Snapshot / Compaction

Repository: https://github.com/facebook/rocksdb

值得追：

```text
db/snapshot_impl.*
db/compaction/compaction_iterator.*
db/db_impl/
```

核心：sequence number、live snapshot registry、compaction visibility preservation。

---

# Papers / Technical References

### Write Barrier Elision for Concurrent Garbage Collectors
- Authors: Martin T. Vechev, David F. Bacon
- Institution: ETH Zurich / IBM Research context
- Year: 2004
- URL: https://www.sri.inf.ethz.ch/publications/vechev2004write
- Architecture: concurrent tracing GC + barrier analysis
- Contribution: 分析 incremental-update / SATB barrier 中哪些 write barriers 可被證明冗餘；其 trace-based evaluation 報告平均 54% incremental barriers、83% snapshot barriers 可消除。
- Limitation: JVM/heap GC 研究，不能直接等同於 distributed artifact store。
- 改變了什麼：說明 barrier 是 correctness primitive，但可以透過靜態/動態條件降低成本。

### Safe Memory Reclamation Techniques
- Author: Ajay Singh
- Institution: University of Waterloo / Technion context
- Year: 2025
- URL: https://arxiv.org/abs/2509.02457
- Architecture: survey/thesis-style treatment of safe reclamation mechanisms
- Contribution: 比較 epoch/timestamp/hazard-pointer 類方法的 performance、applicability 與 memory-retention trade-offs。
- Limitation: lock-free memory reclamation，不是 multimodal agent artifact GC。
- 改變了什麼：提醒「延遲回收」本身是 performance/memory-footprint trade-off，不是免費安全性。

### TSC-SIG: A Novel Method Based on the CPU Timestamp Counter with POSIX Signals for Efficient Memory Reclamation
- Authors: Chen Zhang, Zhengming Yi, Xinghui Zhu
- Institution: Hunan Agricultural University
- Year: 2025
- URL: https://www.mdpi.com/2079-9292/14/7/1371
- Architecture: timestamp-based safe memory reclamation
- Contribution: 探索硬體 timestamp counter + signal 機制改善 reclamation efficiency。
- Limitation: CPU in-memory concurrent structures，與 distributed object/artifact retention 的 latency/storage model 不同。

### Will It Fit? Verifying Heap Space Bounds of Concurrent Programs under Garbage Collection
- Authors: Alexandre Moine, Arthur Charguéraud, François Pottier
- Year: 2025
- URL: https://doi.org/10.1145/3716312
- Contribution: 指出 concurrency + tracing GC 下，長時間持有 root 的 sleeping thread 可以阻止大量 memory reclaim。
- 對 Hermes 的啟示：Replay/UI/GPU worker 的 stale root/lease 可能造成 retention amplification。

---

# Knowledge Graph 新增 Node / Edge

新增 Nodes：

```text
Concurrent Artifact Collector
Artifact Mutator
Write Barrier
Pre-Write Barrier
Post-Write Barrier
SATB Artifact Queue
Old-Edge Log
Tri-Color Invariant
Collector Epoch
Reader Epoch
Retire Epoch
Grace Period
RCU Fence
MVCC Artifact Version
Snapshot Visibility
Minimum Active Epoch
Floating Garbage
Reclamation Predicate
Physical Delete Fence
```

新增 Edges：

```text
Artifact Mutation
→ intercepted_by
Write Barrier

Pre-Write Barrier
→ preserves
Old Reference

Old Reference
→ enqueued_into
SATB Artifact Queue

Snapshot
→ retains_visibility_of
Historical Artifact Version

Logical Unlink
→ assigns
Retire Epoch

Active Reader
→ delays
Grace Period Completion

Grace Period
→ permits
Physical Reclamation

Write Barrier
→ protects
Concurrent Reachability Invariant

Unreachable
≠
Safe To Reclaim

Old Version
≠
Garbage

Logical Unlink
≠
Physical Delete

Tracing GC
≠
RCU

Snapshot Isolation
≠
Reachability
```

---

# Unknown / Open Questions

1. **Distributed Write Barrier**：如果 Artifact DAG mutation 分散在多個 Hermes runtime / MCP worker / storage shard，如何把 SATB/remembered-set barrier 從單 process 擴展成 low-latency distributed protocol？
2. **Epoch Stall**：長時間 streaming VLM / browser agent / human review session 如果持續持有 snapshot，如何避免 `MinActiveEpoch` 長期不前進造成 retention explosion？
3. **GPU Artifact Pointer Safety**：當 GPU kernel / DMA transfer 已拿到 physical replica address，而 metadata side 已 logical delete，應使用 lease、fence、CUDA event 還是 allocator epoch 才能安全 reclaim GPU/NVMe buffer？

---

# 下一輪研究

下一輪最值得直接進：

# **Distributed MVCC × Vector Clocks / HLC × Cross-Process Snapshot × Distributed Write Barrier × Global Safe Epoch**

因為本輪仍假設：

```text
Collector Epoch
Reader Epoch Registry
Mutation Barrier
```

可以由單一 runtime 看見。

但真正 Hermes 會是：

```text
Web UI
Agent Runtime
MCP Host
Tool Worker
Vision Worker
GPU Inference Server
Artifact Store
Replay Worker
```

分散在不同 process / container / machine。

下一輪要研究：

```text
Local Epoch
↓
HLC / Lamport / Vector Clock
↓
Distributed Snapshot
↓
Per-shard Safe Point
↓
Global Safe Epoch
↓
Cross-node Reader Lease
↓
Distributed Retire Queue
↓
Reclaim only after global fence
```

並比較：
- Lamport Clock vs Vector Clock vs Hybrid Logical Clock
- MVCC safe timestamp / low watermark
- distributed epoch-based reclamation
- consistent cut / Chandy-Lamport snapshot
- stream processing checkpoint barrier
- Spanner-style safe time / distributed snapshot read concepts

---

# 本輪結束判斷

**缺哪一層：** 單機 concurrent GC → distributed global safe epoch / cross-node snapshot。

**哪個節點最淺：** Distributed Write Barrier；目前只有單 runtime SATB/tri-color 類比，尚未有成熟 Agent Artifact 協定。

**哪個概念仍只是名詞：** `Global Artifact Safe Epoch`、`Distributed Artifact Barrier ABI`。

**哪個系統最值得讀原始碼：** OpenJDK G1 `g1BarrierSet* + satbMarkQueue*`，其次 Linux `kernel/rcu/` 與 RocksDB `compaction_iterator` / snapshot registry。

**哪篇論文需追引用：** *Write Barrier Elision for Concurrent Garbage Collectors* 與 2025 Safe Memory Reclamation survey；前者可追 SATB/incremental-update barrier 系譜，後者可追最新 epoch/hazard-pointer 方法。

**哪個概念最適合視覺模擬：** `Concurrent Artifact GC Race Lab`。

**哪個 Agent 架構最值得實作：**

> **MVCC + SATB Artifact Barrier + Concurrent Reachability + Epoch/RCU Reclamation + Lease/Audit Fence**

---

# 本輪核心結論

**多模態 Agent 的 GC correctness 不能只靠「物件已經不在 graph 裡」。真正安全刪除至少需要四個不同判斷：collector 是否在 concurrent mutation 下仍得到合法 reachability view、歷史 snapshot 是否仍看得到該版本、是否仍有 reader/worker 持有舊 reference，以及所有 lease/audit/grace fence 是否已結束。Go tri-color/write barrier、OpenJDK SATB、Linux RCU、RocksDB MVCC snapshot 分別解了這四個問題的一部分。Hermes 最值得實作的不是複製其中任一 collector，而是把它們抽象成一個 Artifact Lifecycle Protocol：`MVCC visibility → concurrent mark + barrier → retire epoch → grace period → physical delete`。**
