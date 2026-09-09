# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-09 11:53 Asia/Taipei

## 本小時新發現

本輪接續上一輪「Dynamic Visual Memory × Visual KV × Evidence Reactivation × Re-observation Runtime」，專門補足最深缺口：**Archived Visual Memory → Active Transformer KV 時，position / RoPE / M-RoPE / block identity / attention mask 如何維持一致**。

本輪新增重點：

1. 2026 論文 **Position Rebinding Cache Reuse: Replay-Free Visual Revisiting for Interleaved Multimodal Reasoning (PRCR)**：直接指出歷史 visual KV 已被原始 position 綁定，若直接插入後續 decoding context，會造成 stale positional binding、attention distortion，甚至 autoregressive collapse；解法不是單純 copy KV，而是保存 raw visual cache + 原始 spatial coordinates，重新分配與當前 context 相容的位置並重綁 key。
2. vLLM 最新 KV cache runtime：`KVCacheManager → KVCacheCoordinator → SingleTypeKVCacheManager`，block allocation、computed-block lookup、prefix reuse、eviction、connector/offload 都以 block identity / prefix semantics 管理。
3. SGLang RadixAttention / HiCache：prefix KV 以 radix tree 管理，HiCache 再把 residency 擴展成 GPU/CPU/distributed storage hierarchy；這解決「同一 prefix 的 KV 在哪裡」，但不等於解決「舊 KV 插入新位置時如何重新綁位置」。
4. Qwen2/Qwen3-VL M-RoPE：multimodal token position 不只有單一 sequence index，而是 temporal / height / width 三軸；因此 visual cache restore 不是單純把 position 加一個 offset。
5. 形成新的 Hermes runtime abstraction：**KV Restoration 必須拆成 Identity Restore、Residency Restore、Position Restore、Mask Restore、Semantic Freshness Restore 五層。**

---

# 本小時最重要 5 個發現

## 1. Cached KV 不是純粹「內容」，Key 已攜帶 position binding

### 是什麼
在 RoPE 架構中，Key/Query 會在 attention 前被位置旋轉。概念上：

```text
q_p = R(p) q
k_p = R(p) k

attention(q_p, k_s)
∝ qᵀ R(p)ᵀ R(s) k
= qᵀ R(s-p) k
```

因此 RoPE 的相對位置效果建立在 **Q/K 被正確綁定到當前 position**。

### 底層如何運作
若某 visual token 原本位於位置 `s_old`：

```text
raw key
↓
RoPE(s_old)
↓
k_old
↓
寫入 KV cache
```

後來 agent reasoning 到新的位置，希望把它重新當作最近 evidence 使用：

```text
current decode position = p_new

直接 copy k_old
↓
attention 仍把它解讀成 s_old 的位置關係
```

所以：

```text
Content Correct
+
Position Stale
=
Attention Semantics Wrong
```

PRCR 2026 專門證實這個 failure，並提出 Position Rebinding：保存可以重新定位的 visual KV / coordinate metadata，再為當前 context 重建 position-compatible key。

### 為什麼重要
這直接回答上一輪最深問題：

```text
Archived KV 找回來
≠
可以直接 append 到 active KV
```

### 限制
PRCR 的結果屬特定 interleaved multimodal reasoning 設定；需要進一步確認不同 RoPE scaling、GQA、paged KV、FlashAttention、M-RoPE implementation 的相容性。

### 來源
- Position Rebinding Cache Reuse: Replay-Free Visual Revisiting for Interleaved Multimodal Reasoning, 2026, arXiv:2606.26631
- Qwen2-VL / Qwen3-VL M-RoPE implementation/design docs

---

## 2. KV Restore 必須拆成五種「一致性」，不是一個 memcpy

### 是什麼
本輪建立新的 restore model：

```text
Archived Memory
↓
1 Identity Restore
2 Residency Restore
3 Position Restore
4 Attention/Mask Restore
5 Freshness Restore
↓
Active Transformer State
```

### Bottom-Level Logic

#### 1. Identity Restore
回答：

```text
這塊 KV 是誰的？
```

至少需要：

```text
request/session
model revision
layer
kv head/group
block/token span
modality
source observation
```

#### 2. Residency Restore
回答：

```text
KV 現在在哪裡？
```

可能位於：

```text
GPU HBM
CPU RAM
Distributed KV store
Persistent visual memory
External object store
```

vLLM offload manager與 SGLang HiCache 已處理這類 tier movement。

#### 3. Position Restore
回答：

```text
它現在應該被模型視為在哪個位置？
```

這是 PRCR 的核心。

#### 4. Attention/Mask Restore
回答：

```text
新插入的 block，哪些 token 可以 attend 它？
它又可以 attend 誰？
```

若 causal mask / block table / cache slot mapping 不同步，position 正確仍可能錯。

#### 5. Freshness Restore
回答：

```text
這份 evidence 還代表現在世界嗎？
```

這接回上一輪的：

```text
Reactivation ≠ Re-observation
```

### 為什麼重要
這讓 Hermes 不再用一個模糊的 `restore_cache()` 覆蓋多種完全不同 failure。

### 來源
- vLLM KVCacheManager / KVCacheCoordinator design
- SGLang RadixAttention / HiCache design
- PRCR 2026

---

## 3. Prefix Cache Reuse 與 Mid-Context Cache Splicing 是兩種不同 runtime 問題

### Prefix Cache
vLLM / SGLang 的典型 reuse：

```text
Prompt A:
[SYSTEM][USER_PREFIX][suffix A]

Prompt B:
[SYSTEM][USER_PREFIX][suffix B]

shared prefix
↓
reuse already-computed KV
```

前提：

```text
same token prefix
same positional history
same model/cache semantics
```

### Mid-Context Cache Splicing
Agent dynamic memory 想做的是：

```text
old visual evidence
        ↓
current sequence: A B C D E F G ...
                 ↑
          在 reasoning 中途重新插入
```

這會改變：

```text
position
causal order
mask topology
block table
relative distance
```

所以：

```text
Prefix Cache Hit
≠
Arbitrary Context Surgery
```

### 為什麼重要
如果 Hermes 未來要支援「把舊 screenshot evidence 在 reasoning step 42 重新喚醒」，不能直接把 prefix-cache API 當成 visual-memory restore API。

### 工程實作
vLLM 的 runtime 值得看的核心：

```text
vllm/v1/core/kv_cache_manager.py
vllm/v1/core/kv_cache_coordinator.py
vllm/v1/core/single_type_kv_cache_manager.py
vllm/v1/kv_cache_interface.py
vllm/v1/kv_offload/
```

SGLang 值得看的核心：

```text
python/sglang/srt/mem_cache/
├ radix_cache.py / radix_cache_cpp.py
├ unified_cache/
├ hicache related runtime
└ registry / cache init
```

---

## 4. M-RoPE 讓 multimodal cache restore 比文字 RoPE 更難

### 是什麼
Qwen2-VL / Qwen3-VL 類 M-RoPE 將位置分成多軸：

```text
Text token:
sequence-like position

Image / Video token:
T = temporal
H = height
W = width
```

因此 visual token 並非只有：

```text
position = 1821
```

而更像：

```text
position = (t, h, w)
```

### Restore 問題
假設一個 ROI 原本是：

```text
frame 4
row 10
col 7
```

當它被重新喚醒時至少有三種可能 policy：

```text
A. Preserve original spatial coordinate
B. Rebind textual timeline only
C. Rebase all multimodal coordinates into a new local frame
```

三者 attention geometry 都不同。

### 新的 Hermes Node

```text
Multimodal Position Restoration Policy
├ Preserve Spatial Geometry
├ Rebind Temporal Context
├ Local Coordinate Rebase
└ Hybrid Position Remap
```

### 尚未完全驗證
目前沒有證據顯示存在跨主流 VLM 的統一 M-RoPE cache-splicing ABI；應視為 open problem。

---

## 5. Cache Block Identity 必須從「記憶體位置」升級成「語意+位置+來源身份」

Production serving 現在通常把 block identity 用在：

```text
prefix hashing
block lookup
refcount
LRU/ARC eviction
connector/offload
```

但 Agent visual memory 需要更強 metadata。

本輪提出 Hermes 工程模型：

```text
KVBlockIdentity
├ model_revision
├ tokenizer/protocol_revision
├ layer_id
├ kv_group
├ token_span
├ source_observation_id
├ world_state_version
├ modality
├ spatial_extent
├ original_position
├ current_binding_position
├ rope_scheme
├ attention_mask_epoch
└ freshness_epoch
```

這是工程推論，不是既有標準。

但沒有這層，debug 時無法回答：

```text
內容對嗎？
位置對嗎？
世界版本對嗎？
模型版本對嗎？
mask 對嗎？
```

---

# Architecture Breakdown

本輪建立：**Position-Aware Dynamic KV Restoration Runtime**

```text
Visual Observation
↓
Vision Encoder
↓
Projected Visual Tokens
↓
Transformer Prefill
↓
Per-Layer KV
↓
KV Archive Writer
├ Raw/Pre-RoPE K metadata if available
├ Post-RoPE K
├ V
├ Spatial Coordinates
├ Original Position
├ Observation Version
└ Block Identity
↓
Memory Tier
├ GPU
├ CPU
├ Distributed KV
└ Persistent Visual Memory

──── later reasoning step ────

Evidence Demand
↓
Memory Lookup
↓
Freshness Check
├ stale → REOBSERVE
└ valid → REACTIVATE
↓
Restore Planner
├ Identity Restore
├ Residency Restore
├ Position Policy
├ RoPE / M-RoPE Rebinding
└ Mask / Block Allocation
↓
KV Reconstruction
↓
Cache Splice / Cache Append
↓
Attention
↓
Residual Stream
↓
Reasoning
↓
Action
```

---

# Bottom-Level Logic

## RoPE Rebinding

概念模型：

```text
Raw Key k
Original position s_old

k_old = R(s_old) k
```

若 raw/pre-RoPE key 可取得：

```text
k_new = R(s_new) k
```

若只有 post-RoPE key，可理論上考慮：

```text
k ≈ R(-s_old) k_old
k_new = R(s_new) k
```

即：

```text
k_new = R(s_new) R(-s_old) k_old
```

但 production precision、RoPE scaling、partial rotary dimensions、multi-axis RoPE、quantized KV、kernel layout 都可能使這個操作不能直接當成通用工程方案。

**確認事實**：PRCR 類工作證明 stale position binding 是真實問題。

**合理推論**：Hermes restore layer 應保存足夠 metadata，使 key 能被重新 position-bind，而非只存 opaque KV bytes。

**尚未驗證假說**：跨 vLLM/SGLang/Qwen-VL 建立統一 `rebind_kv_position()` ABI 是否可行。

---

# Visual Simulation Idea

## KV Position Rebinding & Context Surgery Lab

畫面分四層：

### Layer 1 — Original Timeline

```text
0   1   2   3   4   5 ... 100
TXT IMG IMG IMG TXT ... reasoning
        └ ROI A ┘
```

顯示 ROI A：

```text
Original Position
M-RoPE (T,H,W)
Layer-wise KV bytes
Observation ID
World State Version
```

### Layer 2 — Archive

```text
ACTIVE KV
   ↓ evict
CPU / Distributed / Visual Memory
```

### Layer 3 — Restore at Step 300

讓使用者切換：

```text
DIRECT COPY
POSITION OFFSET ONLY
ROPE REBIND
M-ROPE REBIND
FULL REPLAY
RE-OBSERVE
```

即時顯示：

```text
Attention Map
Relative Position Error
Spatial Geometry Error
Decode Stability
Restore Latency
HBM Transfer
Recompute FLOPs
```

### Layer 4 — Failure Injection

可故意開啟：

```text
Wrong block id
Wrong position
Wrong M-RoPE axis
Wrong causal mask
Stale world state
Wrong model revision
Quantized cache mismatch
```

Hermes UI 直接標出：

```text
CACHE CONTENT VALID
POSITION INVALID
→ REBIND REQUIRED
```

或：

```text
CACHE POSITION VALID
WORLD STATE STALE
→ REOBSERVATION REQUIRED
```

這個模擬比單純 KV Viewer 更接近「Agent 動態記憶到底怎麼接回 Transformer」。

---

# Code / GitHub

## vLLM
Repository: https://github.com/vllm-project/vllm

值得讀：

```text
vllm/v1/core/kv_cache_manager.py
vllm/v1/core/kv_cache_coordinator.py
vllm/v1/core/single_type_kv_cache_manager.py
vllm/v1/kv_cache_interface.py
vllm/v1/kv_offload/cpu/manager.py
```

關鍵概念：

```text
allocate_slots
get_computed_blocks
cache_blocks
evict_blocks
prefix cache groups
CPU offload
block pool / refcount
```

## SGLang
Repository: https://github.com/sgl-project/sglang

值得讀：

```text
python/sglang/srt/mem_cache/
python/sglang/srt/mem_cache/radix_cache_cpp.py
python/sglang/srt/mem_cache/unified_cache/
```

關鍵概念：

```text
RadixAttention
longest-prefix match
radix-tree KV identity
LRU/tree eviction
HiCache GPU→CPU→distributed tiers
```

## M-RoPE
Qwen2-VL / Qwen3-VL implementation/design paths應繼續追：

```text
M-RoPE temporal/height/width position construction
vision/text position transition
cache_position during incremental decode
```

---

# Papers

## 1. Position Rebinding Cache Reuse: Replay-Free Visual Revisiting for Interleaved Multimodal Reasoning
- Authors: Mengzhao Wang, Yanli Ji, Wangmeng Zuo, Peng Ye, Chongjun Tu
- Year: 2026
- URL: https://arxiv.org/abs/2606.26631
- Architecture: historical visual KV archive + spatial coordinate metadata + position rebinding + active cache injection
- Contribution: identifies stale positional binding as the core failure in direct visual KV reuse; proposes cache-level rebinding without full visual replay.
- Reported result: replay-level or better performance on tested multimodal reasoning benchmarks, average accuracy improvement about 5%, visual revisiting compute reduced by orders of magnitude in their setup.
- Limitation: needs independent reproduction across model families, RoPE variants, production paged-KV runtimes and quantized caches.
- 改變了什麼：把「visual cache reuse」從 memory-copy 問題提升為 position-consistency 問題。

## 2. Qwen2-VL / M-RoPE
- Year: 2024+
- Architecture: temporal-height-width multimodal rotary position encoding
- Contribution: makes image/video geometry part of rotary position semantics.
- Limitation for this research: makes cache rebinding multi-axis rather than scalar.
- 改變了什麼：證明 multimodal restore 不能只用一維 token offset 思考。

## 3. vLLM Hybrid KV Cache Manager / current KV runtime docs
- Type: official engineering architecture
- URL: https://docs.vllm.ai/en/latest/api/vllm/v1/core/kv_cache_manager/
- Architecture: KVCacheManager → Coordinator → per-type managers → block pool/offload
- Contribution: production block allocation, prefix reuse, eviction, connector/offload semantics.
- Limitation: primarily solves serving cache management, not arbitrary mid-context semantic splicing.

## 4. SGLang RadixAttention / HiCache
- Repository: https://github.com/sgl-project/sglang
- Architecture: radix-tree prefix reuse + hierarchical KV residency.
- Contribution: reusable KV prefix as first-class runtime object; multi-tier KV cache.
- Limitation: prefix identity does not by itself solve position rebinding for non-prefix inserts.

---

# Unknown / Open Questions

## 1. Post-RoPE KV 是否能跨所有主流實作安全 rebind？
需測：

```text
standard RoPE
YaRN / dynamic scaling
partial rotary dimension
M-RoPE
quantized KV
GQA / MLA
FlashAttention-compatible cache layout
```

## 2. Cache splice 後 attention mask 應該採哪種語義？
Visual evidence 被重新喚醒時，它應被視為：

```text
歷史 token？
新插入 token？
外部 memory？
cross-attention memory？
```

不同語義應對應不同 causal mask topology。

## 3. 對 Agent 最佳的 restore 策略是否應由 runtime 動態選擇？
候選：

```text
KV restore
RoPE rebind
visual replay
ROI re-encode
cross-attention memory
full re-observation
```

需要建立 cost × accuracy × freshness router。

---

# 下一輪研究

下一輪建議：

# **Cross-Attention Memory vs Self-Attention KV Injection × External Memory Tokens × Memory Connector Architecture**

原因：本輪證明「把舊 evidence 強行 splice 進 self-attention KV」會遇到 position/mask complexity。下一輪應比較另一條路：

```text
Current Decoder State
↓
Query
↓
External Visual / Episodic Memory
↓
Cross-Attention
↓
Residual Injection
```

是否比：

```text
Old KV
↓
Position Rebind
↓
Self-Attention Cache Splice
```

更穩定、可版本化、可 freshness-aware。

將比較：

```text
Flamingo-style cross-attention memory
PVM-style persistent visual memory
Memory Transformer / recurrent memory
RAG memory tokens
Agent episodic memory
KV connector/offload runtime
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Dynamic KV Context Surgery
├ KV Block Identity
├ KV Residency
├ Position Binding
├ RoPE Rebinding
├ M-RoPE Rebinding
├ Cache Splicing
├ Attention Mask Restore
├ Observation Version
├ World-State Version
└ Restore Policy Router
```

```text
KV Restoration Consistency
├ Identity Consistency
├ Model Revision Consistency
├ Position Consistency
├ Mask Consistency
├ Quantization/Layout Consistency
└ Freshness Consistency
```

## Edges

```text
RoPE
→ binds
Key to Position

Historical KV
→ carries
Historical Position Binding

Direct KV Copy
→ may create
Stale Position Semantics

Position Rebinding
→ restores
Attention Compatibility

M-RoPE
→ expands
Position Restore into T/H/W axes

Prefix Cache
→ reuses
Same Positional Prefix

Mid-Context Cache Splice
→ requires
Position + Mask Surgery

KV Offload
→ changes
Residency

KV Restore
→ does not guarantee
World-State Freshness

Stale World State
→ requires
Re-observation
```

---

# 本輪結束判定

- 缺哪一層：**External / Archived Memory → Active Decoder 的統一 memory connector 與 mask semantics**。
- 哪個節點最淺：**M-RoPE-aware cache splicing**。
- 哪個概念仍只是名詞：**Dynamic Context Surgery ABI**。
- 哪個系統值得讀原始碼：**vLLM KVCacheManager/KV offload、SGLang RadixAttention/HiCache、Qwen VL M-RoPE implementation**。
- 哪篇論文需追引用：**PRCR 2026**。
- 哪個概念最適合視覺模擬：**KV Position Rebinding & Context Surgery Lab**。
- 哪個 Agent 架構最值得實作：**Position-Aware Evidence Reactivation Agent**。

## 本輪核心結論

> **Transformer 的 KV cache 不是可任意搬移的「記憶內容」。Key 已與它被建立時的位置結構耦合；在 multimodal M-RoPE 中，這種位置甚至包含時間、高度與寬度。真正的 Agent memory reactivation 因此必須同時恢復 block identity、residency、position、attention mask 與 world-state freshness。Prefix cache 解決的是相同前綴的重用，而動態 Agent memory 需要的是 position-aware context surgery。**
