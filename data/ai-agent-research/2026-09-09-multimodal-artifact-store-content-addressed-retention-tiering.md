# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-09 22:52（Asia/Taipei）

## 本輪研究主題
**Multimodal Artifact Store × Content-Addressed Storage × Deduplication × Retention Policy × GPU/CPU/NVMe/Object Storage Tiering × Replay Materialization**

本輪直接承接上一輪「Multimodal Event Sourcing × Artifact Identity × Encoder Versioning × Replay Boundary」，不再重複討論 raw image → tensor → encoder feature → visual token 的 identity，而是處理下一個缺口：**這些 artifact 到底要保存哪些、如何去重、放在哪一層、何時淘汰、replay 時如何 materialize。**

---

## 本小時新發現

### 新架構 / 系統
1. **SGLang HiCache**：將 KV cache 組織成 GPU L1、Host Memory L2、Distributed Storage L3，並在原始碼中由 `HiRadixCache` + `HiCacheController` 協調 write-through、load-back、prefetch、ongoing write/load 狀態。
2. **vLLM OffloadingConnector / TieringOffloadingSpec**：GPU ↔ CPU primary tier，CPU 再連 filesystem/object-store/P2P secondary tiers；只有 CPU primary 可以直接和 GPU 傳輸，secondary tier 必須經 CPU staging。
3. **LMCache**：把 KV cache 從 inference engine process 解耦成獨立 persistent cache subsystem，可跨 request/session/process reuse，支援 CPU/local/remote storage tier；repository 內可追 `lmcache/v1/cache_engine.py` 與 developer architecture/storage backend 文件。
4. **Tutti (2026)**：GPU-centric SSD-backed KV cache store，將 SSD I/O control/data path 從 CPU-centric 改成 GPU-centric，使用 GPU-native object abstraction、GPU io_uring 與 slack-aware I/O scheduling。
5. **KVDrive (2026)**：GPU + Host DRAM + SSD 的 holistic multi-tier KV cache management，聯合 cache placement、pipeline scheduling、cross-tier coordination。

### 新底層觀念
- **Reuse Identity ≠ Historical Artifact Identity**
- **Cache Eviction ≠ Evidence Deletion**
- **Content Deduplication ≠ Semantic Equivalence**
- **Tier Placement ≠ Retention Decision**
- **Materialization Cost 必須納入 replay policy**

---

# 本小時最重要 5 個發現

## 1. 多模態 Artifact Store 應拆成「Content Address」與「Execution Address」兩套 identity

### 概念
Content-addressed storage（CAS）使用內容 hash 作為 artifact identity；IPFS / Merkle-DAG 類系統證明 identical bytes 可以自然 deduplicate，同時保留 versioned DAG lineage。

但對 AI runtime 而言，只記：

```text
sha256(bytes)
```

是不夠的。

同一份 raw image bytes 經過不同：

```text
processor revision
resize policy
frame sampler
encoder revision
dtype
projector revision
```

會生成不同 tensor / feature / token artifact。

因此 Hermes 應同時保存：

```text
ContentAddress
= hash(payload bytes)

ExecutionAddress
= hash(
    parent artifact IDs
  + transform type
  + transform config
  + model/processor revision
  + dtype/backend
)
```

### 底層如何運作

```text
raw.jpg
│
├─ content_hash = H(raw bytes)
│
└─ preprocess(config=v1)
      ↓
   tensor_A
   execution_hash = H(raw_hash + preprocess_v1 + config)

raw.jpg
└─ preprocess(config=v2)
      ↓
   tensor_B
   execution_hash = H(raw_hash + preprocess_v2 + config)
```

### 為什麼重要
CAS 可以解決 byte-level dedup，但 event-sourced Agent 還需要知道「當時到底跑了哪一條 transform chain」。

### 限制
Content hash 無法表示近似相同內容；perceptual hash / embedding similarity 可支援 approximate dedup candidate，但不能當 canonical historical identity。

### 來源
- IPFS / Merkle-DAG content addressing design
- 上一輪 Multimodal Artifact Hash Ladder

---

## 2. Tiering 是 latency/capacity 問題；Retention 是 replay/audit 問題，不能混成同一個 LRU

SGLang HiCache、vLLM Offloading 與 LMCache 都證明現代 inference runtime 已經採用 hierarchical cache：

```text
GPU VRAM
↓
CPU / pinned host memory
↓
NVMe / filesystem / object store / distributed store
```

vLLM OffloadingConnector 的官方架構甚至明確限制：

```text
GPU ↔ CPU primary tier
CPU ↔ secondary tiers
```

secondary tier 不能直接 GPU access。

SGLang HiCache 原始碼 `HiRadixCache` 也實際維護：

```text
ongoing_write_through
ongoing_load_back
ongoing_prefetch
write_through_threshold
load_back_threshold
```

代表 tier transition 是 runtime state machine，而不只是資料庫搬檔案。

但 Agent replay 不能直接使用普通 cache eviction 規則：

```text
LRU cache says:
很久沒用 → delete
```

因為某個 visual feature 即使命中率低，也可能是：

```text
唯一能證明 Decision D
使用 Encoder Revision X 的中間 evidence
```

所以應拆：

```text
ReusePolicy
├ hit probability
├ recompute cost
├ transfer cost
├ size
└ latency SLO

ReplayRetentionPolicy
├ audit importance
├ irreproducibility
├ source availability
├ transform reproducibility
├ legal retention
├ decision criticality
└ branch references
```

結論：

```text
Cache Eviction
≠
Historical Evidence Deletion
```

---

## 3. 完整 Artifact Lifecycle 應該是 DAG + State Machine，不只是 Blob Store

上一輪 Artifact DAG：

```text
Raw
→ Decoded
→ Tensor
→ Encoder Feature
→ Visual Token
→ Fused Context
```

這輪補上 storage lifecycle：

```text
CREATED
↓
HASHED
↓
DEDUP_CHECKED
↓
MATERIALIZED
↓
PINNED / HOT / WARM / COLD
↓
DEMOTED
↓
EVICTED_CACHE_ONLY
↓
RECONSTRUCTIBLE_METADATA_ONLY
or
ARCHIVED_IMMUTABLE
```

其中非常重要的是：

```text
EVICTED_CACHE_ONLY
```

不應等於：

```text
ARTIFACT HISTORY DELETED
```

如果 artifact 可以由 parent + deterministic transform 重建，可以只保留 recipe：

```text
ArtifactRecipe
├ parent_hashes[]
├ transform_id
├ transform_revision
├ config_hash
├ expected_output_hash
└ reproducibility_class
```

Replay 時：

```text
Artifact missing
↓
Check recipe
↓
Can deterministically rematerialize?
├ YES → recompute + verify hash
└ NO  → replay degraded / historical artifact required
```

這使 storage cost 與 replay fidelity 可以解耦。

---

## 4. Materialization 本身應成為 Agent Runtime 的一級操作

LMCache / SGLang / vLLM 的 cache promotion 已經非常接近這個概念：冷 tier 命中後，cache block 會被 load/prefetch 回較快 tier。

Hermes 應泛化成：

```text
materialize(artifact_id, target_tier)
```

例如：

```text
visual_token_778
目前：OBJECT_STORAGE

Agent 要 replay Decision D
↓
Materialization Planner
↓
是否直接載 token？
是否載 encoder feature 再 projector？
是否載 raw image 重跑全部？
↓
選最低成本且滿足 replay fidelity 的路徑
```

可以定義工程成本模型：

```text
MaterializationCost(path)
=
TransferLatency
+ ComputeLatency
+ GPUOpportunityCost
+ EnergyCost
+ FidelityRiskPenalty
```

例如三條路：

```text
A. Object Store → Visual Tokens → GPU
B. NVMe Encoder Feature → Projector → GPU
C. Raw Image → Decode → Preprocess → Encoder → Projector
```

不一定「保存最多」最好；真正目標是選擇 replay SLA 下最低總成本的 materialization plan。

這也是本輪最適合 Hermes 建模的 bottom-level mechanism。

---

## 5. Inference Cache 與 Historical Artifact Store 應該共享資料平面，但分離語義控制平面

LMCache 的一個重要 architecture insight 是：cache subsystem 可以和 inference engine 解耦，讓 KV cache 在 engine crash 後仍存在，並跨 process/session reuse。

這對 Hermes 有很直接的啟發：

```text
Inference Runtime
        ↓
Artifact API
        ↓
Unified Storage Data Plane
├ GPU Pool
├ CPU Pool
├ NVMe
├ Object Store
└ Archive
```

但控制面應分兩個：

```text
Performance Cache Controller
├ promote
├ prefetch
├ evict
├ admission
└ hit-rate optimization

Historical Artifact Controller
├ retain
├ pin
├ legal hold
├ provenance
├ hash verify
├ reconstructibility
└ replay materialization
```

這避免一個 production 常見錯誤：

```text
「cache 系統清乾淨了」
→ 同時把 audit/replay 必要證據清掉
```

---

# Architecture Breakdown

```text
Camera / Image / Video / Audio / Screen
↓
Capture Layer
↓
Content-Addressed Raw Artifact Store
├ payload hash
├ mime/type
├ timestamp
├ source identity
└ provenance
↓
Transform DAG
├ Decode
├ Resize / Crop
├ Normalize
├ Frame Sampling
├ Audio Feature Extraction
├ Vision Encoder
├ Projector
└ Fusion
↓
Derived Artifact Registry
├ content hash
├ execution hash
├ parents[]
├ transform revision
├ shape/dtype
└ reproducibility class
↓
Retention Classifier
├ ephemeral
├ cacheable
├ reconstructible
├ audit-critical
├ legal-hold
└ irreversible evidence
↓
Tier Placement Planner
├ GPU VRAM
├ CPU pinned RAM
├ CPU DRAM
├ NVMe
├ Distributed KV Store
├ Object Storage
└ Archive
↓
Runtime Cache Controller
├ admission
├ promotion
├ prefetch
├ demotion
├ eviction
└ dedup
↓
Historical Artifact Controller
├ pin
├ recipe retention
├ lineage retention
├ evidence retention
└ garbage-collection safety
↓
Replay Request
↓
Artifact Resolver
↓
Materialization Planner
├ load exact artifact
├ recompute derived artifact
├ validate hash
└ detect divergence
↓
GPU / Model Runtime
↓
Historical Replay / Fork
```

---

# Bottom-Level Logic

## 1. Content-Addressed Artifact Key

```text
CID = H(serialized_payload)
```

只做 byte identity。

## 2. Execution Artifact Key

Hermes 工程模型：

```text
EID = H(
  parent_CIDs
  || transform_name
  || transform_revision
  || normalized_config
  || model_revision
  || dtype
  || backend_class
)
```

## 3. Reconstructibility Class

```text
R0 = exact bytes retained
R1 = deterministic reconstructible + output hash known
R2 = numerically reconstructible within tolerance
R3 = semantically reconstructible only
R4 = not reliably reconstructible
```

Retention 可以根據 decision importance 選不同級別。

## 4. Retention Utility

Hermes 工程模型（不是現有論文固定公式）：

```text
RetentionUtility(a)
=
α ReplayCriticality
+ β RecomputeCost
+ γ ReuseProbability
+ δ SourceFragility
+ ε AuditValue
+ ζ BranchReferenceCount
- λ StorageCost
```

## 5. Tier Placement Score

```text
TierScore(a, tier)
=
ExpectedAccessLatency
+ ExpectedTransferCost
+ StorageCost
+ RecomputeAlternativeCost
+ SLA penalty
```

## 6. Garbage Collection Safety

Artifact 只有在：

```text
No active branch references
AND
No audit pin
AND
No legal hold
AND
(Exact artifact not required OR deterministic recipe retained)
```

時才能刪除 exact payload。

---

# Visual Simulation Idea

## **Multimodal Artifact Memory Pyramid & Replay Materializer**

Hermes Console 顯示一個金字塔：

```text
        GPU VRAM
     visual_token #91
          ↑ ↓
       CPU RAM
   encoder_feature #44
          ↑ ↓
        NVMe
    tensor/keyframe
          ↑ ↓
    Object Storage
       raw video
          ↑ ↓
       Archive
```

右邊顯示 Artifact DAG：

```text
raw_video_1
├─ frame_100
│   └─ tensor_100
│      └─ vision_100
│         └─ tokens_100
└─ frame_101
    └─ tensor_101
```

使用者可調：

```text
GPU budget
CPU budget
NVMe budget
Object-store cost
Replay SLA
Retention class
```

然後模擬器即時計算：

```text
PROMOTE
DEMOTE
EVICT CACHE COPY
KEEP RECIPE
PIN EXACT ARTIFACT
ARCHIVE
```

再點：

```text
REPLAY DECISION D42
```

畫面顯示：

```text
Need visual_token_100
Exact token missing
↓
Found encoder_feature_100 on NVMe
↓
Projector revision matches
↓
Materialize
↓
Hash MATCH
↓
REPLAY CONTINUES
```

如果版本改了：

```text
encoder feature missing
raw frame retained
current encoder != historical encoder
↓
STRICT REPLAY CANNOT RECOMPUTE
↓
FORK / DEGRADED REPLAY
```

這個 simulator 可以把「記憶」「cache」「storage」「replay」四個常被混在一起的概念直觀分開。

---

# Code / GitHub

## SGLang
Repository: `sgl-project/sglang`

本輪直接讀：

```text
python/sglang/srt/mem_cache/hiradix_cache.py
```

核心值得追：

```text
HiRadixCache
HiCacheController
ongoing_write_through
ongoing_load_back
ongoing_prefetch
write_policy
storage_backend
prefetch_threshold
```

下一層值得讀：

```text
python/sglang/srt/managers/cache_controller.py
python/sglang/srt/mem_cache/pool_host/
python/sglang/srt/mem_cache/storage/
```

工程證據：`HiRadixCache` 初始化 Host KV pool、storage backend、controller，並持有 write/load/prefetch runtime state；因此 HiCache 確實是多層 cache state machine，而不是文件概念。

## LMCache
Repository: `LMCache/LMCache`

本輪搜索到的重要路徑：

```text
lmcache/v1/cache_engine.py
docs/source/developer_guide/architecture.rst
docs/source/mp/configuration.rst
```

architecture 文件描述 disk task 會 compress/save chunk，remote backend 會 spawn async upload；multi-process config 甚至提供 LRU / IsolatedLRU / noop 等 cache eviction 模式。

## Tutti
Repository: `xPU-IO/Tutti`

值得追的核心不是 README，而是之後要進一步找：

```text
GPU-native object abstraction
GPU io_uring
vLLM integration
slack-aware I/O scheduler
```

---

# Papers

## 1. KVDrive: A Holistic Multi-Tier KV Cache Management System for Long-Context LLM Inference
- Authors: Jian Lin, Jiazhi Mi, Zicong Hong, Haodong Wang, Qianli Liu, Haodyue Zhang, Peng Li, Song Guo
- Year: 2026
- URL: https://arxiv.org/abs/2605.18071
- Code: 尚需下一輪確認官方 code link
- Dataset/Benchmark: long-context serving benchmarks（paper 評估 popular LLMs）
- Architecture: GPU + Host DRAM + SSD multi-tier KV cache
- Contribution: cache placement + pipeline scheduling + cross-tier coordination 聯合設計
- Reported Result: up to 1.74× throughput improvement vs evaluated SOTA baselines
- Limitations: serving workload-specific；主要針對 KV cache，不等於 general multimodal artifact lifecycle
- 改變了什麼：把 KV cache tiering 從單純 offload 變成 placement/scheduling/co-design 問題。

## 2. Tutti: Making SSD-Backed KV Cache Practical for Long-Context LLM Serving
- Authors: Shi Qiu, Yifan Hu, Xintao Wang, Wenhao Zhu, Jianqin Yan, Hao Chen, Kaiqiang Xu, Kai Chen, Yiming Zhang
- Year: 2026
- URL: https://arxiv.org/abs/2605.03375
- Code: https://github.com/xPU-IO/Tutti
- Dataset: LEval, LooGLE（paper serving evaluation）
- Architecture: GPU-centric KV object store + GPU io_uring + slack-aware I/O scheduling
- Contribution: 把 SSD-backed KV I/O critical path 從 CPU-centric 移向 GPU-centric
- Reported Result: compared with evaluated GDS-enabled SSD-backed LMCache baseline, paper reports 78.3% TTFT reduction under strict SLO, ~2× achievable request rate, 27% serving cost reduction
- Limitations: 特定 hardware/runtime/serving config；不能把 benchmark 數字泛化到所有模型與 GPU
- 改變了什麼：證明 cold-tier artifact materialization 的真正 bottleneck 可能不是 SSD bandwidth，而是 CPU-driven tiny-I/O control path。

## 3. IPFS - Content Addressed, Versioned, P2P File System
- Authors: Juan Benet
- Year: 2014
- URL: https://arxiv.org/abs/1407.3561
- Architecture: content addressing + Merkle DAG
- Contribution: content hash 作為 identity，天然支援 dedup、integrity、version graph
- Limitation: 不是 AI inference runtime；沒有 encoder/version/replay semantics
- 對 Hermes 的改變：提供 Artifact DAG 的 storage identity 基礎，但必須加 execution provenance。

---

# 已確認事實 / 推論分層

## 已確認官方/工程資訊
- vLLM OffloadingConnector 支援 CPU primary tier 與 secondary filesystem/object/P2P tiers，secondary ↔ GPU 必須經 CPU。
- SGLang HiCache 使用 GPU / host / distributed storage hierarchical cache；原始碼存在 write-through、load-back、prefetch 等 runtime state。
- LMCache 支援 persistent tiered KV cache reuse，可跨 request/session/engine instance。
- Tutti paper/code 公開，architecture 是 GPU-centric SSD KV cache store。

## 論文結果
- KVDrive paper 報告最高 1.74× throughput improvement（其實驗條件）。
- Tutti paper 報告 78.3% TTFT reduction、2× achievable request rate、27% cost reduction（其 benchmark/SLO 條件）。

## Hermes 工程推論
- Artifact Store 應分離 ReusePolicy 與 ReplayRetentionPolicy。
- ContentAddress 與 ExecutionAddress 應分離。
- RetentionUtility / MaterializationCost 公式是 Hermes 建模，不是現有標準。

## 尚未驗證假說
- 一個統一 CAS 可以同時服務 vision feature、audio feature、KV cache、tool output artifact，而不造成過高 metadata/control overhead。
- 對 multimodal Agent 而言，「保存 encoder feature + transform recipe」可能是比 raw-only 或 token-only 更好的 replay/cost Pareto point；需要 benchmark 驗證。

---

# Unknown / Open Questions 1-3

1. **Artifact 粒度問題**：應該 hash per-frame、per-patch、per-temporal-chunk、per-layer feature，還是 larger segment？粒度越細 dedup 越高，但 metadata/index overhead 越大。
2. **Cross-model reuse 安全性**：不同 encoder revision 的 feature 是否永遠不可 reuse？是否能建立 formally versioned adapter/transcoder？
3. **Retention Optimization**：在 storage budget 固定時，如何同時最佳化 cache hit、replay fidelity、auditability 與 recompute cost？目前缺真正 agent workload benchmark。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Multimodal Artifact Store
Content Address
Execution Address
Artifact Recipe
Artifact Reconstructibility Class
Retention Policy
Replay Retention Policy
Reuse Policy
Storage Tier
Tier Placement Planner
Materialization Planner
Artifact Promotion
Artifact Demotion
Cache Eviction
Historical Pin
Audit Pin
Garbage Collection Safety
Cold Artifact
Hot Artifact
Content Deduplication
Approximate Dedup Candidate
```

## Edges

```text
Artifact
→ identified_by
Content Address

Derived Artifact
→ identified_by
Execution Address

Execution Address
→ includes
Transform Revision

Artifact
→ may_materialize_from
Artifact Recipe

Retention Policy
→ controls
Historical Availability

Reuse Policy
→ controls
Cache Residency

Cache Eviction
≠
Historical Deletion

Content Deduplication
≠
Semantic Equivalence

Tier Placement
≠
Retention Decision

Cold Artifact
→ can_promote_to
Hot Tier

Replay Request
→ triggers
Materialization Planner

Materialization Planner
→ chooses
Load / Recompute / Fork
```

---

# 下一輪研究

下一輪應直接進入：

# **Artifact Granularity × Chunking × Hash Index × Metadata Scale × Garbage Collection × Reference Counting**

原因是現在架構已經知道：

```text
Artifact
→ CAS
→ retention
→ tiering
→ materialization
```

但真正 production bottleneck 會馬上變成：

```text
一小時 30 FPS video
× 每 frame 多層 features
× 多個 encoder layers
× 多 branch replay
```

如果每個 tensor / token block 都是一個 node，metadata graph 可能比 payload 管理還困難。

下一輪要拆：

```text
Chunk Boundary
Content-Defined Chunking
Fixed-Size Chunking
Temporal Chunking
Layer Chunking
Merkle DAG
Reference Count
Branch Pin
GC Root
Mark-and-Sweep
TTL
Compaction
Index Sharding
Bloom Filter
Cold Metadata Store
```

並比較 Git/IPFS 類 CAS、object-store chunking、KV cache block hashing、vLLM/SGLang prefix block/radix indexing、LMCache chunk management。

---

# 本輪結束判斷

- **缺哪一層：** Artifact Granularity / Chunking → Metadata Index → Safe Garbage Collection。
- **哪個節點最淺：** `ReplayRetentionPolicy` 的最佳化策略，目前只有工程模型，缺 benchmark。
- **哪個概念仍只是名詞：** `Unified Multimodal Artifact ABI`、`Cross-Model Feature Reuse Contract`。
- **哪個系統值得讀原始碼：** SGLang HiCache `hiradix_cache.py + cache_controller.py + storage/`；LMCache `cache_engine.py + storage backends`；Tutti GPU I/O path。
- **哪篇論文需追引用：** Tutti、KVDrive，尤其它們對 SSD/GPU/CPU pipeline 的後續系統工作。
- **哪個概念最適合視覺模擬：** **Multimodal Artifact Memory Pyramid & Replay Materializer**。
- **哪個 Agent 架構最值得實作：**

> **Content-Addressed Multimodal Agent Store + Separate Reuse/Replay Policies + Hierarchical Tiering + Replay Materialization Planner**

---

# 本輪核心結論

> **多模態 Agent 不可能把每一張 frame、tensor、encoder feature、visual token 都永遠留在 GPU 或甚至永久完整保存。真正的 runtime 必須把 artifact identity、cache reuse、historical retention 與 storage tiering 分開。Content-addressing 解決「這是不是同一份資料」，execution provenance 解決「它是不是同一次 transform」，hierarchical tiering 解決「現在放哪裡最快」，retention policy 解決「未來是否仍需要它」，materialization planner 則解決「replay 時要從哪一層重建」。只有這幾層接起來，Multimodal Event Sourcing 才能從研究概念變成可長期運作的 production architecture。**
