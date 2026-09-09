# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 23:54（Asia/Taipei）**  
**本輪主題：Artifact Granularity × Chunking × Hash Index × Merkle DAG × Reference Graph × Safe Garbage Collection**

## 歷史比較與本輪定位

上一輪已建立 `Multimodal Artifact Store → Content Address → Dedup → Retention → Tier Placement → Materialization → Replay`。本輪不重複 storage tiering，而是往下一層追問：**一個 artifact 到底要切多細、如何建立可定位/可去重/可回收的 metadata graph，以及在 replay branch、pin、checkpoint、cache 共存時，GC 如何避免誤刪仍可達的歷史證據。**

本輪核心問題：

```text
30 FPS video
× raw / decoded / tensor / feature / visual-token stages
× temporal chunks
× replay branches
× cache copies
↓
數百萬～數十億個潛在 artifact/block references
```

因此 production-grade Multimodal Agent Store 不能只有「hash + object storage」，而需要：

```text
Artifact Granularity Policy
→ Chunker
→ Content/Execution Hash
→ Merkle/Reference DAG
→ Reachability Roots
→ Reference Index
→ GC Epoch
→ Mark
→ Sweep
→ Tombstone / Compact
```

---

# 本小時新發現

## 新架構 / 系統

1. **vLLM Automatic Prefix Caching / BlockPool**：KV cache 以固定 token block 為粒度；block identity 不是只 hash 當前 tokens，而會包含 parent hash、block tokens，以及 LoRA、multimodal input hash、cache salt 等 extra keys。新版文件也提供 `sha256_cbor` 這種 canonical serialization + SHA-256，讓跨語言/跨環境 hash 更可重現。
2. **IPFS / UnixFS / Boxo chunker**：同一個 content-addressed DAG 可使用 fixed-size、Rabin 或 Buzhash content-defined chunking。這證明「content address」與「chunk boundary」是兩個不同設計選擇；相同原始檔在不同 chunking 策略下可形成不同 DAG/CID。
3. **Kubo GC**：原始碼直接採 mark-and-sweep：先從 recursive pins、direct pins、internal pins、MFS/best-effort roots 建立 marked set，再遍歷 blockstore，刪除不在 marked set 的 blocks。GC 前還要取得 GC lock，避免 concurrent write 在 root snapshot 與 sweep 之間被誤刪。
4. **PagedAttention / vLLM**：把 KV cache 從 sequence-contiguous allocation 改成固定大小 blocks，類似 virtual memory paging；這提供 Agent Artifact Store 一個重要原則：**storage/compute object 的邏輯連續性，不必等同物理連續性。**
5. **FastCDC**：Content-Defined Chunking 的關鍵不是單純「每 N bytes 切一次」，而是 rolling/content fingerprint 找 cut point；FastCDC 透過 cut-point skipping、hash judgment 簡化、chunk-size normalization 加速 CDC，同時維持接近 Rabin CDC 的去重能力。

---

# 本小時最重要 5 個發現

## 1. Artifact Granularity 是 correctness primitive，不只是 storage optimization

### 是什麼

如果 multimodal artifact 永遠以「整支影片」作為一個 object：

```text
video.mp4
→ hash
```

任何一個 frame 改變，都會讓整體 artifact identity 改變；而 replay 只需要其中 2 秒的視覺 token 時，也必須重新 materialize 大型 artifact。

如果切太細：

```text
frame
→ patch
→ layer
→ head
→ token
```

則 metadata、hash index、reference edges、GC 成本會爆炸。

因此 artifact granularity 本身決定：

```text
Dedup Radius
Replay Locality
Invalidation Radius
Metadata Cost
Transfer Cost
GC Traversal Cost
```

### 底層如何運作

Hermes 應區分至少五種粒度：

```text
G0 Source Object
   image / audio / video file

G1 Temporal/Spatial Chunk
   GOP / time window / ROI / tile

G2 Transform Output
   decoded frames / tensor batch

G3 Model Feature Chunk
   encoder feature temporal chunk

G4 Inference Block
   visual tokens / KV cache block
```

### 為什麼重要

「哪一層要 content-addressed」不能一刀切。Raw media 適合較大 chunks；GPU KV 適合固定 token blocks；長影片則可能適合 temporal/content-aware chunks。

### 限制

目前沒有一個主流標準能統一 image/video/audio/tensor/KV 的 chunk ABI；以下是 Hermes 工程建模，不是既有標準。

### 來源

- vLLM Prefix Caching: https://docs.vllm.ai/en/latest/design/prefix_caching/
- IPFS Kubo add/chunking: https://github.com/ipfs/kubo/blob/master/core/commands/add.go
- FastCDC: https://www.usenix.org/conference/atc16/technical-sessions/presentation/xia

---

## 2. Content-Defined Chunking 解決的是「插入位移造成固定 chunk 全部失效」

### 已確認工程事實

IPFS Boxo 的 `chunker/rabin.go` 直接使用 Rabin fingerprints；`NewRabin()` 會從平均 block size 推導 min/max，再建立 rolling chunker。Kubo 同時支援 fixed-size、Rabin、Buzhash chunker。

### Bottom-level mechanism

Fixed-size：

```text
ABCDE|FGHIJ|KLMNO|...
```

前面插入一個 byte：

```text
XABCD|EFGHI|JKLMN|...
```

後續幾乎所有 chunk hash 改變。

CDC：

```text
Byte Stream
↓
Rolling Fingerprint Window
↓
fingerprint matches boundary rule?
↓ yes
CUT
```

插入局部資料後，rolling hash 在一段距離後通常重新同步 cut points，因此大量舊 chunks 仍可 reuse。

FastCDC 的論文貢獻可抽象為：

```text
Gear-style rolling hash
+
skip impossible/sub-minimum boundaries
+
normalized boundary probability
↓
faster CDC with similar dedup ratio
```

### Hermes 推論

對「會持續 append/edit 的 Agent artifact」：

```text
conversation archive
long video
large trace bundle
knowledge snapshot
```

CDC 可能比 fixed-size 更利於版本間 dedup。

但對：

```text
KV cache
fixed-shape tensor tiles
GPU memory pages
```

fixed-size block 往往更容易 scheduler / DMA / allocation。

因此：

```text
One Chunking Policy For All Artifacts
= wrong abstraction
```

---

## 3. vLLM 的 block hash 已經接近「AI-specific Merkle chain」

### 已確認工程實作

vLLM 的 prefix caching 將 block hash 組成：

```text
BlockHash_i = H(
    ParentHash_{i-1},
    BlockTokens_i,
    ExtraKeys_i
)
```

Extra keys 可以包含 multimodal input hash、LoRA ID、cache salt 等。

其 `BlockPool` 還維護：

```text
block_id
block_hash
ref_cnt
free_block_queue
hash → block map
```

並在 block full 後才 cache。實作特別註明目前可能存在相同 hash 的 duplicate physical blocks，原因是 v1 block table 採 append-only，不能為了 dedup 任意替換已配置 block ID。

### 重要區分

```text
Logical Dedup Identity
≠
Physical Allocation Identity
```

也就是：兩個 block 可以語義/內容相同，hash 一樣，但 runtime 暫時仍保留兩份 physical blocks。

這對 Hermes 很重要：

```text
Artifact CID
≠
Storage Replica ID
≠
GPU Allocation ID
```

### 安全性

vLLM 文件指出 non-cryptographic hash collision 在 multi-tenant cache 可能造成未定義行為甚至資訊外洩；因此新版預設 SHA-256，另可用 cache salt 做租戶/信任域隔離。

這意味 Hermes 的 hash index 也必須加入：

```text
Hash Algorithm
Serialization Canonicalization
Tenant/Trust Domain Salt
Collision Policy
```

---

## 4. Safe GC 的核心不是 ref_count，而是「從 durable roots 計算 reachability」

### System architecture：Kubo GC

Kubo `gc/gc.go` 的流程：

```text
Acquire GC Lock
↓
Snapshot best-effort roots
↓
Recursive Pins ─┐
Direct Pins ────┼→ MARKED SET
Internal Pins ──┤
MFS Roots ──────┘
↓
Traverse descendants in Merkle DAG
↓
Enumerate all blockstore keys
↓
if block NOT marked:
    DeleteBlock
↓
Datastore GC
```

### 為什麼 ref_count 不夠

Agent store 會遇到：

```text
branch A → artifact X
branch B → artifact X
checkpoint → artifact X
cache copy → artifact X
```

如果 branch A 被刪除，而 ref-count transaction 更新失敗/延遲，就可能誤刪 X；更複雜的是某些 references 是 transitive，不是直接 refs。

Reachability model：

```text
Roots
↓
Graph Traverse
↓
Live Set
```

更符合 Event Sourcing / Replay branches。

### Hermes 應定義 GC Roots

```text
Pinned Research Report
Active Conversation Head
Replay Branch Head
Audit Hold
Legal Hold
Current World Snapshot
Model Evaluation Snapshot
Durable Checkpoint
In-flight Materialization Lease
```

而普通 inference cache：

```text
Cache Residency
```

不一定需要成為 durable GC root。

### Concurrency

Kubo GC 使用 GC lock，並在取得 lock 後再 snapshot MFS roots，以避免 concurrent PinLock holder 在 sweep 中被誤刪。Hermes 也需要：

```text
WRITE / PIN / MATERIALIZE LEASE
vs
GC EPOCH
```

否則：

```text
writer writes child blocks
↓
root edge 尚未 commit
↓
GC starts
↓
child looks unreachable
↓
deleted
```

---

## 5. Chunk Boundary、Merkle Node 與 Physical Block 不應綁成同一概念

從 IPFS、vLLM、PagedAttention 三者交叉比較，可以得到一個統一模型：

```text
Logical Artifact
↓
Chunk Boundary Policy
↓
Logical Chunk
↓
Content / Execution Hash
↓
Reference DAG Node
↓
Physical Replica(s)
├ GPU allocation
├ CPU allocation
├ NVMe object
└ Object-store blob
```

### 關鍵結果

```text
Logical Chunk ID
≠ Physical Block ID
```

```text
Merkle Reference
≠ Residency
```

```text
Evict Replica
≠ Delete Artifact
```

```text
Delete Branch
≠ Immediately Delete Children
```

這一層是上一輪「Cache Eviction ≠ Historical Deletion」的更底層版本。

---

# Architecture Breakdown

```text
MULTIMODAL SOURCE
Camera / Image / Video / Audio / Screen / Tool Trace
↓
Artifact Classifier
├ immutable source
├ append-only stream
├ editable blob
├ tensor
├ encoder feature
├ visual token
└ KV cache
↓
Granularity Policy
├ Whole-object
├ Fixed-size bytes
├ Fixed token block
├ Temporal window
├ GOP
├ Spatial tile / ROI
└ Content-defined chunking
↓
Chunker
↓
Logical Chunk
↓
Identity Builder
├ content hash
├ parent hash
├ execution hash
├ model/processor revision
├ multimodal hash
├ tenant salt
└ schema version
↓
Merkle / Reference DAG
↓
Hash Index
├ hash → logical chunk
├ logical chunk → replicas
├ parent → children
├ branch → root
└ root → reachability epoch
↓
Replica Manager
├ GPU
├ CPU
├ NVMe
├ object store
└ archive
↓
GC Root Registry
├ pins
├ branches
├ audit holds
├ replay heads
├ snapshots
└ leases
↓
GC Epoch
↓
MARK
↓
SWEEP candidates
↓
Tombstone grace period
↓
Physical deletion
↓
Index compaction
```

---

# Bottom-Level Logic

## A. Fixed block

```text
chunk_i = bytes[offset : offset + B]
CID_i = H(chunk_i)
```

優點：O(1) addressing、scheduler 簡單、GPU friendly。  
缺點：front insertion 造成 widespread boundary shift。

## B. Content-defined chunk

概念化：

```text
for byte in stream:
    fp = rolling_hash(window)
    if size >= min and boundary(fp):
        CUT
    if size >= max:
        FORCE CUT
```

FastCDC 透過更快 hash judgment、skip 小 chunk 區域、boundary normalization 降低 CPU overhead。

## C. Merkle-style chained block identity

vLLM 類型：

```text
H_i = H(H_{i-1}, tokens_i, extra_i)
```

Hermes 擴展：

```text
ExecutionChunkID_i = H(
    ParentExecutionID,
    ContentCID,
    TransformRevision,
    ModelRevision,
    ChunkSchema,
    SecurityDomain
)
```

## D. Safe mark-sweep

```text
Live = ∅
queue = GC_ROOTS

while queue:
    node = pop(queue)
    if node not in Live:
        Live.add(node)
        queue.extend(children(node))

for object in ObjectIndex:
    if object not in Live
       and lease_expired(object)
       and tombstone_grace_passed(object):
        delete_replicas(object)
```

### Hermes 額外安全條件

```text
GCEligible(x)
=
NotReachable(x)
∧ NoActiveLease(x)
∧ NotAuditHeld(x)
∧ OlderThanGracePeriod(x)
∧ MetadataEpochStable(x)
```

這是 Hermes 工程建模，不是 Kubo 原始公式。

---

# Visual Simulation Idea

## **Artifact DAG, Chunking & Garbage Collector Lab**

使用者拖入一支 30 秒影片：

```text
video_v1
```

可以切換：

```text
WHOLE FILE
FIXED 1 MB
FIXED 256 KB
RABIN CDC
TEMPORAL 1 s
GOP-AWARE
FEATURE-CHUNK
TOKEN-BLOCK
```

畫面立即長出不同 DAG：

```text
video_v1
├ c01
├ c02
├ c03
└ c04
```

接著把影片中間插入 2 秒片段，顯示：

```text
Fixed-size:
changed chunks: 81%

CDC:
changed chunks: 14%
```

（數值應由 simulator 實算，不硬編 benchmark。）

第二模式：Replay Branches

```text
              branch_A
             /        \
root → a → b → c        d
             \
              branch_B → e
```

刪掉 `branch_A`：

```text
GC MARK
root, a, b, c, e = LIVE

d = UNREACHABLE
```

但如果 d 有：

```text
Audit Hold
```

畫面顯示：

```text
UNREACHABLE
BUT PINNED_BY_AUDIT
→ NOT DELETED
```

第三模式：Race Injection

```text
WRITE CHILD
GC START
WRITE ROOT
```

讓使用者開/關 GC lock / write lease，直接看是否產生 dangling artifact。

### 可視化指標

```text
Dedup Ratio
Changed Chunk Ratio
Metadata Nodes
Reference Edges
Index RAM
Mark Traversal Cost
Sweep Candidates
Pinned Bytes
Reconstructible Bytes
GPU/CPU/NVMe Replicas
```

---

# Code / GitHub

## vLLM

Repository: https://github.com/vllm-project/vllm

值得繼續讀：

```text
vllm/v1/core/block_pool.py
vllm/v1/core/kv_cache_utils.py
vllm/v1/core/kv_cache_manager.py
vllm/distributed/kv_events.py
vllm/utils/hashing.py
```

本輪原始碼確認：

- `BlockHashToBlockMap` 支援一個 hash 對應一個或多個 physical `KVCacheBlock`。
- `KVCacheBlock` 有 `block_id`, `ref_cnt`, `_block_hash`, `_block_hash_num_tokens`。
- `FreeKVCacheBlockQueue` 使用 intrusive doubly-linked list，支援 O(1) 中間移除。
- full block cache event 會攜帶 parent block hash、token range、LoRA、extra keys、session 等 metadata。

## IPFS Boxo

Repository: https://github.com/ipfs/boxo

值得看：

```text
chunker/rabin.go
chunker/buzhash.go
chunker/splitting.go
chunker/parse.go
ipld/unixfs/
ipld/merkledag/
blockstore/
```

`chunker/rabin.go` 已確認使用 degree-53 Rabin polynomial 與 min/avg/max chunk bounds。

## Kubo

Repository: https://github.com/ipfs/kubo

值得看：

```text
gc/gc.go
core/commands/add.go
repo/
blocks/blockstoreutil/
```

`gc/gc.go` 是本輪最值得讀的 GC 實作：真正做 recursive root marking + full blockstore sweep，而不是只靠 ref-count。

---

# Papers

## 1. FastCDC: A Fast and Efficient Content-Defined Chunking Approach for Data Deduplication

- **Title**: FastCDC: A Fast and Efficient Content-Defined Chunking Approach for Data Deduplication
- **Authors**: Wen Xia, Yukun Zhou, Hong Jiang, Dan Feng, Yu Hua, Yuchong Hu, Qing Liu, Yucheng Zhang
- **Institution**: Huazhong University of Science and Technology; University of Texas at Arlington; related industry affiliations
- **Year**: 2016
- **Venue**: USENIX ATC 2016
- **URL**: https://www.usenix.org/conference/atc16/technical-sessions/presentation/xia
- **Code**: paper itself does not define one canonical official production repo; related Gear/FastCDC implementations exist separately
- **Dataset / Workload**: data deduplication workloads used in the paper
- **Architecture**: content-defined chunker using Gear-style hashing + cut-point skipping + chunk-size normalization
- **Contribution**: paper reports about 10× speedup over the best open-source Rabin-based CDC it evaluated, ~3× over Gear/AE-based CDC, with near-Rabin dedup ratio in its tests
- **Limitations**: storage dedup workloads, not multimodal tensor/KV-specific; chunk policy must be re-evaluated for GPU locality and model feature semantics
- **改變了什麼**: 讓 content-defined chunking 從「去重效果好但 CPU 貴」走向更可 productionize 的高速方法。

## 2. Efficient Memory Management for Large Language Model Serving with PagedAttention

- **Title**: Efficient Memory Management for Large Language Model Serving with PagedAttention
- **Authors**: Woosuk Kwon, Zhuohan Li, Siyuan Zhuang, Ying Sheng, Lianmin Zheng, Cody Hao Yu, Joseph E. Gonzalez, Hao Zhang, Ion Stoica
- **Institution**: UC Berkeley / collaborators
- **Year**: 2023
- **Venue**: SOSP 2023
- **URL**: https://arxiv.org/abs/2309.06180
- **Code**: https://github.com/vllm-project/vllm
- **Dataset / Workload**: LLM serving benchmarks / model serving workloads
- **Architecture**: PagedAttention + vLLM block-based KV memory manager
- **Contribution**: avoids contiguous KV over-reservation/fragmentation, supports sharing; paper reports 2–4× throughput improvement over evaluated baselines at similar latency
- **Limitations**: focus is LLM KV serving, not historical artifact retention / content-defined media chunking
- **改變了什麼**: 把 KV cache memory management 類比 virtual memory paging，證明「logical sequence ≠ physical contiguous allocation」。

---

# 已確認事實 / 推論 / 假說分離

## 已確認事實

- vLLM prefix cache 使用 block hash chain，hash input 包含 parent、tokens 與 extra keys；multimodal hash 可進 extra keys。
- vLLM `BlockPool` 有 hash index、ref count、free queue、LRU-style eviction ordering。
- IPFS/Kubo 支援 fixed-size 與 content-defined chunking。
- Kubo GC 實作為 mark-and-sweep，且有 GC lock / pin synchronization。
- FastCDC 是 CDC 加速設計，論文報告明顯 throughput 改善。

## 合理工程推論

- Multimodal Agent Store 應依 artifact class 選不同 chunking policy，而非統一固定大小。
- Replay-safe GC 應以 reachability roots 為主，ref count 只作 optimization。
- Content CID 與 Execution CID 應拆開，以避免「相同 bytes、不同 model transform」被錯誤視為同一 replay representation。

## 尚未驗證假說

- 對長影片的 encoder features，content-aware temporal feature chunking 是否會比 GOP/time-fixed chunking得到更佳 dedup / replay latency tradeoff。
- 跨 encoder revision 是否能使用 learned feature equivalence 進行 dedup，而不破壞 strict replay。
- Artifact GC 的最適 epoch / grace policy 能否以 agent replay probability 預測模型動態調整。

---

# Unknown / Open Questions

1. **Artifact granularity optimizer**：如何同時最佳化 metadata overhead、dedup ratio、GPU locality、replay latency 與 recompute cost？
2. **Cross-stage GC dependency**：如果 raw frame 被刪除但 feature 保留，或 feature 被刪除但 raw 保留，reconstructibility graph 怎麼保證不產生「metadata 說可重建，實際缺 transform binary/model revision」？
3. **Branch-scale GC**：大量 Agent fork / counterfactual branches 時，如何讓 mark phase 不每次完整掃描數十億 edges？需要 incremental tracing GC、generation/epoch GC，還是 reference-count + periodic tracing hybrid？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Artifact Granularity Policy
Chunk Boundary
Fixed-Size Chunk
Content-Defined Chunk
Temporal Chunk
Feature Chunk
Inference Block
Logical Chunk ID
Physical Replica ID
Merkle Artifact DAG
Hash Index
GC Root
GC Epoch
Reachability Set
Materialization Lease
Audit Hold
Tombstone
GC Grace Period
Mark Phase
Sweep Phase
Metadata Compaction
```

## Edges

```text
Artifact Class
→ selects
Granularity Policy

Granularity Policy
→ produces
Chunk Boundary

Logical Chunk
→ identified_by
Content CID

Logical Chunk
→ may_have
Multiple Physical Replicas

Merkle Root
→ reaches
Child Artifact

Replay Branch Head
→ acts_as
GC Root

Audit Hold
→ prevents
Garbage Collection

GC Root
→ marks
Reachable Artifact

Unreachable Artifact
→ becomes
Sweep Candidate

Active Lease
→ blocks
Sweep

Fixed Chunk
≠
Content-Defined Chunk

Logical Chunk ID
≠
Physical Allocation ID

Cache Eviction
≠
Artifact Deletion

Ref Count Zero
≠
Safe To Delete

Content Address
≠
Chunking Strategy
```

---

# 下一輪研究

下一輪最值得進：

# **Incremental GC × Generational Artifact Memory × Branch-Aware Reachability × Bloom Filter / LSM Hash Index × Billion-Scale Metadata**

因為本輪已知道：

```text
Root
→ Mark
→ Sweep
```

但完整掃描在大規模 Agent Artifact Graph 可能太貴。

下一輪應拆：

```text
Hot Generation
Warm Generation
Cold Generation
↓
Mutation Log
↓
Incremental Mark
↓
Remembered Set
↓
Branch Root Delta
↓
Bloom Filter / Cuckoo Filter
↓
LSM / RocksDB hash index
↓
Background Compaction
```

並比較：

```text
Tracing GC
vs Reference Counting
vs Generational GC
vs Epoch GC
vs Hybrid
```

同時研究 content-addressed artifact metadata 在 billions-of-chunks 規模下的 index layout、Bloom false positives、LSM write amplification 與 object-store listing avoidance。

---

# 本輪結束判斷

- **缺哪一層**：`Merkle Artifact DAG → incremental / branch-aware GC → billion-scale metadata index`
- **哪個節點最淺**：Artifact Granularity Optimizer
- **哪個概念仍只是名詞**：Cross-Modal Chunk ABI / Unified Artifact Chunk Schema
- **哪個系統值得讀原始碼**：Kubo `gc/gc.go`、vLLM `block_pool.py + kv_cache_utils.py`、Boxo `chunker/`
- **哪篇論文需追引用**：FastCDC（追後續 CDC / dedup 系統）、PagedAttention（追 prefix cache / distributed KV evolution）
- **哪個概念最適合視覺模擬**：Artifact DAG, Chunking & Garbage Collector Lab
- **哪個 Agent 架構最值得實作**：`Content-Addressed Multimodal Artifact DAG + Class-Aware Chunker + Durable GC Roots + Lease-Protected Mark/Sweep`

## 本輪核心結論

> **多模態 Agent 的 storage scale 問題，真正的底層不是「硬碟要多大」，而是「artifact 要切在哪裡、identity 綁在哪一層、哪些 roots 仍使它可達、以及何時才真的安全刪除」。IPFS 告訴我們 content addressing、CDC、Merkle DAG 與 tracing GC 怎麼接；vLLM/PagedAttention 告訴我們 inference artifact 為什麼需要固定 block、logical/physical identity 分離與高速 hash index。Hermes 最合理的方向不是照搬其中一個，而是建立 class-aware chunking：media 可 CDC/temporal，tensor/visual-token/KV 可 fixed block，再統一進 content/execution-addressed Artifact DAG 與 reachability-based GC。**
