# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 10:53（Asia/Taipei）**  
**本輪主題：Dynamic Multimodal Memory × Visual KV × Evidence Reactivation × Re-observation Runtime**

> 本輪接續上一輪「Visual Evidence Retention × Projector/Pruning Loss × LLM Visual Utilization × Grounding Failure Attribution」。上一輪已確認 complex reasoning 中 visual evidence relevance 會隨 decoding step 改變，因此 input-time 一次性 pruning 可能把後段才重要的 evidence 永久刪除。本輪刻意不重複 visual pruning taxonomy，而專門回答：**被壓縮、被 eviction、或不在當前 context 的視覺證據，如何重新變成 Agent 可讀的工作記憶？Visual KV、cross-attention memory、state-space memory、persistent visual memory、streaming visual memory 與 re-observation 到底有何不同？**

---

## 本小時新發現

### 新論文 / 新架構 / 新 GitHub

1. **VisCache: Visual KV Cache Pruning for Efficient Vision Large Language Model Inference**（Lyuke Wang, Zhuo Li, Guangxu Zhu；2026-08-25；arXiv:2608.24063）
   - URL: https://arxiv.org/abs/2608.24063
   - Code: https://github.com/Wlklk/VisCache
   - Architecture: 小型 VLM 先做 keyframe filtering，再由 PruneKV 對 target VLM 做 layer-wise KV compression。
   - Bottom-level mechanism: parabolic layer-wise token budget + asymmetric KV policy：**Key 直接 prune、Value 以 attention-weighted fusion 保留部分被刪 token 的資訊**。
   - 論文結果: 在其長視覺 context 設定中只保留約 19–28% KV cache，最高報告約 2.35× speedup；數字不可直接外推到其他模型。
   - 改變: 「visual KV compression」不一定等於 K/V 同步刪除；K 與 V 可以承擔不同記憶角色。

2. **RetentiveKV: State-Space Memory for Uncertainty-Aware Multimodal KV Cache Eviction**（Sihao Liu, YuFan Xiong, Zhonghua Jiang, Zhaode Wang, Chengfei Lv, Shengyu Zhang；ACL Findings 2026）
   - URL: https://aclanthology.org/2026.findings-acl.934/
   - arXiv: https://arxiv.org/abs/2605.04075
   - Architecture: entropy-driven eviction + State Space Memory + query-conditioned retrieval。
   - Contribution: 指出 visual token 有 **deferred importance**：早期 attention 低，不代表後期 decoding 不重要。被 eviction 的資訊不是直接丟棄，而是寫入連續 state-space memory，之後可依 query/reactivation 再讀出。
   - 論文結果: 報告約 5× KV compression 與約 1.5× decoding acceleration；實際比例受模型、task、budget 影響。
   - 改變: KV eviction 從 irreversible delete 變成 **memory-state transition**。

3. **Persistent Visual Memory: Sustaining Perception for Deep Generation in LVLMs**（Siyuan Huang et al.; 2026-05；arXiv:2605.00814）
   - URL: https://arxiv.org/abs/2605.00814
   - Code: https://github.com/huaixuheqing/PVM
   - Architecture: 在部分 LLM layers 的 FFN 旁增加 PVM branch，以 text hidden state 當 Query、原始 visual embeddings 當 K/V，做獨立 cross-attention retrieval。
   - Contribution: 處理 Visual Signal Dilution：generated text 越長，原始 visual tokens 在 self-attention 分母中的相對權重可能逐漸降低。
   - 改變: 視覺 evidence 不必永遠透過 autoregressive self-attention context 被讀取；可以有一條 **distance-agnostic visual retrieval path**。

4. **FOVEA: Focused On-Demand Visual Evidence Adaptation for Cache-Friendly Multimodal Speculative Decoding**（Hengjie Zhu et al.; 2026-08-24；arXiv:2608.22883）
   - URL: https://arxiv.org/abs/2608.22883
   - Architecture: reusable visual memory + state-conditioned retrieval + bounded subset + gated residual correction。
   - 關鍵設計: 取回的 visual evidence **不重新插入 autoregressive token context**；而是在 LM head 前修改 current draft hidden state。
   - 論文結果: 在其 multimodal speculative decoding 設定中最高報告約 2.13× end-to-end speedup。
   - 改變: Evidence reactivation 可以是 hidden-state correction，而不一定是 re-prefill 或 append visual tokens。

5. **POINTS-Long: Adaptive Dual-Mode Visual Reasoning in MLLMs**（Haicheng Wang et al.; CVPR 2026；arXiv:2604.11627）
   - URL: https://arxiv.org/abs/2604.11627
   - Project: https://anakin-skywalker-joseph.github.io/POINTS-Long-Webpage/
   - Architecture: Focus mode + Standby mode + dynamically detachable KV cache。
   - Streaming memory: 保持短期 high-fidelity focus window，同時把壓縮後的 standby KV 遷移到 long-term memory bank。
   - 改變: Streaming visual context 不必是一條無限增長的單一 KV cache；可以有 **hot / cold visual memory tiers**。

6. **Scaling the Long Video Understanding of Multimodal Large Language Models via Visual Memory Mechanism (FlexMem)**（Tao Chen et al.; 2026-03；arXiv:2603.29252）
   - URL: https://arxiv.org/abs/2603.29252
   - Architecture: video clips iterative processing + local/context memory + long-term memory bank + memory retrieval。
   - 核心: 把 visual KV cache 視為 memory source，透過 dual-pathway compression 做 memory writing，再依任務做 memory reading。
   - 改變: Visual KV 不只是 inference acceleration artifact，而可以升級成 **episodic visual memory representation**。

7. **VL-Cache: Sparsity and Modality-Aware KV Cache Compression for Vision-Language Model Inference Acceleration**（Tu et al.; ICLR 2025）
   - URL: https://proceedings.iclr.cc/paper_files/paper/2025/hash/00db17c36b5435195760520efa96d99c-Abstract-Conference.html
   - Contribution: 區分 visual/text token 的 attention sparsity、做 layer-adaptive cache budget 與 modality-aware token scoring。
   - 改變: 建立 Visual KV management 應該是 modality-aware、layer-aware，而不是套用純 LLM cache policy 的基礎證據。

---

# 本小時最重要 5 個發現

## 1. Visual Memory 至少有 5 種完全不同的「儲存形態」

### 已確認事實 + 架構整合

目前常把所有東西都叫 visual memory，但其實至少應拆成：

```text
A. AUTOREGRESSIVE VISUAL KV
Image tokens 已進 LLM context
→ 每層 K/V 留在 decoder KV cache

B. EXTERNAL VISUAL EMBEDDING MEMORY
Encoder / projector features
→ 獨立保存
→ cross-attention / retrieval 時再讀

C. COMPRESSED STATE MEMORY
Evicted / low-salience information
→ State Space / recurrent state
→ query-conditioned reactivation

D. STREAMING MEMORY BANK
Older frames / clips / KV fragments
→ long-term bank
→ index / retrieve / migrate

E. WORLD RE-OBSERVATION
真正重新截圖 / camera frame / ROI encode
→ 建立全新的 evidence
```

因此：

```text
Visual KV Cache
≠ Visual Memory Bank
≠ Cross-Attention Memory
≠ State-Space Memory
≠ Re-observation
```

它們最大差異是：

```text
儲存的是什麼表示？
是否可逆？
是否依賴 position / RoPE？
讀回後要不要 re-prefill？
是否能看見環境已發生的新變化？
```

這是本輪 Knowledge Graph 最重要的基礎拆分。

---

## 2. KV Eviction 不應再理解成「刪除」；2026 開始變成 Memory Transition

### 論文結果

傳統 pruning：

```text
KV token
↓ low score
DELETE
↓
不可恢復
```

RetentiveKV 指出 multimodal setting 的核心問題是 Deferred Importance：

```text
Token X
at step 1: attention = low
at step 20: suddenly relevant
```

如果 step 1 就永久刪除：

```text
Future evidence demand
→ cannot recover
```

其核心思想改成：

```text
Low-attention KV
↓
Entropy / uncertainty estimate
↓
State transition
↓
Compressed continuous memory S_t
↓
Later query becomes relevant
↓
Query-conditioned retrieval
↓
Reactivated evidence
```

因此 Hermes 應新增一個狀態：

```text
ACTIVE
→ COMPRESSED
→ DORMANT
→ REACTIVATED
→ ACTIVE
```

而不是只有：

```text
KEEP / DROP
```

這對 Agent 特別重要，因為 long-horizon reasoning 的 evidence requirement 本來就是非平穩的。

---

## 3. PVM 證明「讓模型重新看圖」不一定需要把圖片 token 再塞回 Context Window

### GitHub 原始碼確認

PVM 官方 repo `modeling_file/modeling_qwen3_vl.py` 不只新增一個名字叫 memory 的模組，而是真的改 Transformer layer。

其 `PVMCrossAttention`：

```text
Query = Text hidden state
Key   = Visual context
Value = Visual context
```

並在縮小後的 `pvm_hidden_size` bottleneck 中計算 cross-attention，再投影回原 hidden dimension，透過 gated residual 更新原 residual stream。

也就是：

```text
Text Residual x_l
├→ Normal Self-Attention / FFN
│
└→ PVM Query
    × Persistent Visual Embeddings
    ↓
    Visual Readout
    ↓
    Gated Residual Injection
    ↓
    x_l + Δvisual
```

PVM source tree 也直接包含：

```text
modeling_file/
├ configuration_qwen3_vl.py
└ modeling_qwen3_vl.py

training_file/
└ SFT.py
```

而 training code 明確追蹤特定 layers 的 `pvm_block.gate_alpha`，例如 layer 8 / 16 / 24。

### 為什麼重要

如果視覺 evidence 永遠只存在原本的 autoregressive prefix：

```text
[image tokens][prompt][generated text ............]
```

生成越長，視覺訊號要和越來越多 text tokens 競爭 attention。

PVM 改成：

```text
current hidden state
↓ direct query
persistent visual memory
```

因此 retrieval path 的距離不再隨生成序列長度增加。

這提供 Hermes 一個非常重要的新 runtime primitive：

```text
READ_VISUAL_MEMORY(query_state)
```

而不是只有：

```text
APPEND_VISUAL_TOKENS()
```

---

## 4. Visual KV 裡的 Key 和 Value 不一定應該一起被同樣處理

### GitHub 原始碼確認：VisCache

本輪直接讀 `Wlklk/VisCache/smallandbig/compression.py`。

Repository 核心目錄：

```text
smallandbig/
├ compression.py
├ keyframe.py
├ pipeline.py
├ config.py
└ compat.py
```

`compression.py` 真正實作了三個值得看的底層機制：

### (a) Parabolic layer budget

```text
monotonic_parabolic_allocation()
```

不同 layers 不是保留相同 token 數，而是依 layer index 做單調、拋物線式 allocation。

### (b) Key pruning

```text
top-k visual indices
↓
K_visual
→ gather selected K only
```

### (c) Value fusion

被 drop 的 Value 不完全消失：

```text
Dropped V
↓ attention score
select high-value dropped subset
↓ softmax weights
weighted fused value
↓
V_keep ← V_keep + α (V_fused - V_keep)
```

也就是：

```text
Key
→ routing / addressability

Value
→ content payload
```

因此可以採：

```text
K: aggressive structural pruning
V: softer semantic fusion
```

這不是 universally optimal，但它揭露一個很重要的底層事實：

> **KV cache 的 K 與 V 在 memory system 裡扮演的角色不同，cache compression 不必強迫兩者採完全相同 policy。**

這值得直接加入 Hermes KV Simulator。

---

## 5. 對 Agent 而言，「Reactivation」和「Re-observation」必須嚴格分開

### 架構建模

這兩者常被混在一起：

```text
Evidence missing
→ look again
```

但其實有兩種完全不同情況。

### A. Reactivation

環境沒變，只是舊 evidence 不在 active context：

```text
Old Screenshot
↓
Memory Bank still has representation
↓
Retrieve old ROI / KV / embedding
↓
Resume reasoning
```

### B. Re-observation

外部世界可能已改變：

```text
Agent clicked button
↓
UI changed
↓
Old visual memory is stale
↓
Must capture NEW screenshot
↓
Vision encode again
```

因此 Agent Runtime 應先做：

```text
Evidence Missing
↓
Is evidence expected to be temporally stable?
│
├ YES
│  → REACTIVATE_MEMORY
│
└ NO / UNKNOWN
   → REOBSERVE_ENVIRONMENT
```

這帶出新節點：

```text
Visual Memory Freshness
Visual State Version
Observation Timestamp
Action→Observation Dependency
```

如果沒有這層，Agent 可能犯一種非常危險的錯：

```text
Memory recall correct
but world state already changed
→ action wrong
```

因此對 Browser / Computer / Robot Agent：

```text
Memory Accuracy
≠ World-State Freshness
```

這是本輪最重要的 Agent-runtime 工程推論。

---

# Architecture Breakdown

## Dynamic Visual Memory Runtime

```text
Camera / Browser / Screen / Video
↓
Observation Versioner
├ frame_id
├ timestamp
├ environment_state_id
└ action_parent_id
↓
Vision Encoder
↓
Raw Visual Evidence
↓
Visual Memory Writer
│
├ HOT MEMORY
│  ├ current visual tokens
│  └ active decoder KV
│
├ WARM MEMORY
│  ├ compressed KV
│  ├ retained visual embeddings
│  └ ROI features
│
└ COLD MEMORY
   ├ long-term visual memory bank
   ├ clip-level memories
   └ external index
↓
Reasoning Step t
↓
Evidence Demand Estimator
↓
Memory Controller
│
├ Active evidence exists?
│  └ YES → continue
│
├ Old memory sufficient + fresh?
│  └ YES → reactivate
│
├ Old memory exists but stale?
│  └ re-observe
│
└ Evidence never captured?
   └ ROI / high-resolution re-observe
↓
Evidence Reader
├ KV restore
├ State-space recall
├ Cross-attention read
├ Hidden-state correction
└ Token append / re-prefill
↓
Residual Stream
↓
Reasoning / Planning
↓
Action
↓
Environment changes
↓
New Observation Version
```

---

# Bottom-Level Logic

## 1. Full Re-prefill

```text
Need old ROI
↓
Retrieve image / pixels
↓
Vision Encoder
↓
Projector
↓
Append visual tokens
↓
Re-prefill affected context
↓
new KV
```

優點：最接近原生 multimodal path。  
缺點：昂貴，會改變 sequence position / context length，且可能需要大量重新計算。

## 2. KV Restore

```text
Archived visual KV blocks
↓
Reserve destination KV slots
↓
Restore / transfer K,V
↓
Attention can see memory again
```

優點：不需重新跑 vision encoder。  
缺點：必須處理 layer、position、RoPE、cache layout、model revision 一致性；不是任意 KV block 都能無條件搬回任何位置。

## 3. Cross-Attention Memory

```text
Current hidden state Q
×
Persistent visual K,V
↓
Visual readout
↓
Residual injection
```

優點：不污染 autoregressive context length，對長 generation 特別合理。  
缺點：通常需要模型架構修改 / training；不是純 runtime patch。

## 4. State-Space Reactivation

```text
Evicted evidence e_t
↓
state update
S_t = f(S_{t-1}, e_t)
↓
future query q_k
↓
read(S_t, q_k)
↓
reactivated memory
```

優點：能保存 deferred-importance evidence，不必保留全部原始 KV。  
缺點：compressed state 可能無法精準還原 pixel-level / coordinate-level evidence。

## 5. Hidden-State Visual Correction

FOVEA 類架構：

```text
Current draft hidden h_t
↓ query memory
visual readout r_t
↓
h'_t = h_t + gate(h_t, r_t)
↓
LM Head
```

而不是：

```text
visual tokens
→ append context
```

這是一種重要的新 memory injection topology。

---

# Visual Simulation Idea

## **Dynamic Visual Memory & Re-observation Lab**

### 主視圖

```text
LIVE SCREEN
   │
   ▼
[HOT VISUAL KV] ──evict──> [WARM MEMORY] ──compress──> [COLD BANK]
      ▲                         │                         │
      │                         └──── reactivate ─────────┘
      │
      └──────── new observation ─────── Environment
```

### 每個 evidence node 顯示

```text
Evidence ID
Source frame
ROI
Timestamp
World-state version
Representation type
├ Pixels
├ Vision Embedding
├ Visual Token
├ Decoder KV
└ State Memory

Current relevance
Future uncertainty
Freshness
Memory tier
Bytes
Restore latency
```

### 使用者可切換 Memory Policy

```text
KEEP ALL KV
VISUAL KV PRUNING
K PRUNE + V FUSION
STATE-SPACE RETENTION
PERSISTENT CROSS-ATTENTION MEMORY
HOT/WARM/COLD STREAMING MEMORY
```

### 最重要的互動實驗

任務：

```text
1. 看購物網站
2. 記住商品 A 價格
3. 捲動很多頁
4. 比較商品 Z
5. 回頭按商品 A 的購買鍵
```

在第 4 步突然顯示：

```text
EVIDENCE DEMAND SHIFT
```

如果商品 A 的 visual KV 已 eviction：

```text
Policy A: permanent prune
→ FAIL

Policy B: Retentive memory
→ REACTIVATE

Policy C: screenshot memory
→ RETRIEVE OLD OBSERVATION

Policy D: world may have changed
→ REOBSERVE
```

再故意讓商品價格在背景更新：

```text
Old memory says $399
Live page says $429
```

介面必須標：

```text
MEMORY VALID
WORLD STATE STALE
→ REOBSERVATION REQUIRED
```

這會把 Agent Memory 最容易混淆的問題直接視覺化。

---

# Code / GitHub

## 1. VisCache

Repository:
https://github.com/Wlklk/VisCache

值得看的目錄：

```text
smallandbig/
├ compression.py   # KV selection / layer budget / V fusion
├ keyframe.py      # temporal keyframe filtering
├ pipeline.py      # end-to-end orchestration
├ config.py
└ compat.py        # DynamicCache / legacy cache compatibility
```

### 核心檔案：`compression.py`

值得追的 functions：

```text
monotonic_parabolic_allocation()
selective_attention_fusion()
select_visual_tokens()
prune_kv_layerwise()
create_compatible_cache()
```

工程意義：Visual KV management 已直接操作 Transformers `DynamicCache` / layer-wise K,V tensor，而不是只在 input token 層做 pruning。

## 2. Persistent Visual Memory (PVM)

Repository:
https://github.com/huaixuheqing/PVM

值得看的目錄：

```text
modeling_file/
├ configuration_qwen3_vl.py
└ modeling_qwen3_vl.py

training_file/
└ SFT.py
```

### 核心類別

```text
PVMCrossAttention
PVMMLP
PVMMemoryBlock
```

### 已確認 source 行為

```text
Query  = reduced text hidden state
Key/V  = reduced visual context
↓
Cross Attention
↓
PVM MLP
↓
Expand to original hidden size
↓
Gated Residual
```

configuration 也直接支援 `pvm_layers`，因此 persistent visual retrieval 不是每層強制加入，而是可選 layer topology。

---

# Papers

## 1. RetentiveKV
- Title: RetentiveKV: State-Space Memory for Uncertainty-Aware Multimodal KV Cache Eviction
- Authors: Sihao Liu, YuFan Xiong, Zhonghua Jiang, Zhaode Wang, Chengfei Lv, Shengyu Zhang
- Venue: Findings of ACL 2026
- URL: https://aclanthology.org/2026.findings-acl.934/
- Code: 本輪未確認官方公開 code repository
- Dataset/Benchmarks: 論文涵蓋 multimodal QA / document 等 settings；具體 dataset 應下一輪直接讀 PDF tables 驗證
- Architecture: entropy-driven metric + state-space memory + query-conditioned retrieval
- Contribution: deferred importance + reversible-style reactivation
- Limitations: compressed continuous state 不等同原始 KV 精確恢復；對 pixel coordinate evidence 的 fidelity 仍需測

## 2. Persistent Visual Memory
- Title: Persistent Visual Memory: Sustaining Perception for Deep Generation in LVLMs
- Authors: Siyuan Huang, Xiaoye Qu, Yafu Li, Tong Zhu, Zefeng He, Muxin Fu, Daizong Liu, Wei-Long Zheng, Yu Cheng
- Year: 2026
- URL: https://arxiv.org/abs/2605.00814
- Code: https://github.com/huaixuheqing/PVM
- Architecture: parallel FFN-side bottleneck cross-attention memory branch
- Contribution: mitigate visual signal dilution in long generation
- Limitations: requires architectural modification/training；persistent embedding memory 本身不會自動知道 world state 已變

## 3. FOVEA
- Title: FOVEA: Focused On-Demand Visual Evidence Adaptation for Cache-Friendly Multimodal Speculative Decoding
- Authors: Hengjie Zhu et al.
- Year: 2026
- URL: https://arxiv.org/abs/2608.22883
- Architecture: reusable memory + state-conditioned retrieval + gated residual correction near LM head
- Contribution: dynamic evidence demand can be handled without reinserting visual tokens into autoregressive context
- Limitations: 目前主要驗證 speculative drafter；是否能直接改善 long-horizon Agent planning 尚未證實

## 4. POINTS-Long
- Title: POINTS-Long: Adaptive Dual-Mode Visual Reasoning in MLLMs
- Authors: Haicheng Wang et al.
- Venue: CVPR 2026
- URL: https://arxiv.org/abs/2604.11627
- Architecture: Focus/Standby modes + detachable KV + streaming visual memory
- Contribution: 把 short-term high-fidelity perception 與 long-term compressed memory分層
- Limitations: streaming video memory ≠ interactive Agent world-state memory；action-driven state invalidation仍是額外 runtime 問題

## 5. FlexMem
- Title: Scaling the Long Video Understanding of Multimodal Large Language Models via Visual Memory Mechanism
- Authors: Tao Chen, Kun Zhang, Qiong Wu, Xiao Chen, Chao Chang, Xiaoshuai Sun, Yiyi Zhou, Rongrong Ji
- Year: 2026
- URL: https://arxiv.org/abs/2603.29252
- Architecture: iterative clip processing + dual-pathway compression + local/context memory + long-term bank + retrieval
- Contribution: 將 visual KV 轉成可寫入/檢索的長影片 memory substrate
- Limitations: video QA 的 memory semantics 和 Browser/Robot Agent action-conditioned state semantics不同

---

# Unknown / Open Questions 1–3

## 1. Reactivated memory 如何保證 spatial / positional correctness？

若把舊 KV block 搬回 active cache：

```text
Old K,V
+ old RoPE position
+ new context position
```

究竟應：

```text
preserve old position?
rebase position?
recompute K from hidden state?
```

對 RoPE / M-RoPE / multimodal position 的 cache restore，這一層目前仍最淺。

## 2. Memory Recall 何時應升級成 Re-observation？

需要一個：

```text
Freshness / Staleness Model
```

可能依：

```text
time elapsed
actions since observation
DOM/UI mutation
sensor motion
external events
confidence
```

決定舊 memory 還能不能直接使用。

## 3. 怎麼量測「被壓縮的 evidence 還能不能支持正確 action」？

目前 cache papers 多看：

```text
QA accuracy
latency
memory
```

Agent 更需要：

```text
Evidence Reactivation Success
Grounding Preservation
Action Success After Recall
World-State Freshness Error
Re-observation Cost
```

因此需要新的 **Agent Visual Memory Benchmark**。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Dynamic Visual Memory Runtime
├ Visual KV Cache
├ Archived KV Block
├ Persistent Visual Embedding Memory
├ State-Space Visual Memory
├ Streaming Visual Memory Bank
├ Hot Visual Memory
├ Warm Visual Memory
├ Cold Visual Memory
├ Evidence Reactivation
├ Re-observation
├ Visual Memory Freshness
├ Observation Version
├ World-State Version
├ Memory Tier Migration
├ Query-Conditioned Recall
├ Hidden-State Visual Correction
└ Cross-Attention Memory Read
```

## Edges

```text
Visual Evidence
→ encoded into
Visual KV

Visual KV
→ may migrate to
Compressed Memory

Low Current Attention
≠
Low Future Importance

Evicted Evidence
→ may transition into
State-Space Memory

Current Query State
→ retrieves from
Persistent Visual Memory

Cross-Attention Memory
→ injects into
Residual Stream

Reasoning Step
→ changes
Evidence Demand

Evidence Demand Shift
→ may trigger
Memory Reactivation

Stale Memory
→ must trigger
Re-observation

Action
→ invalidates / updates
World-State Version

Observation Version
→ grounds
Visual Memory Freshness
```

---

# 與歷史研究比較

前一輪：

```text
Visual Evidence exists?
↓
Was it preserved?
↓
Was it used?
```

本輪新增：

```text
If evidence is no longer active:
↓
Where was it stored?
↓
Can it be reactivated?
↓
Does reactivation require re-prefill?
↓
Is old evidence still fresh?
↓
Recall or re-observe?
```

因此完整 evidence lifecycle 現在變成：

```text
OBSERVE
↓
ENCODE
↓
ACTIVATE
↓
USE
↓
COMPRESS / EVICT
↓
STORE
↓
RELEVANCE RETURNS
↓
REACTIVATE
↓
FRESHNESS CHECK
├ fresh → REUSE
└ stale → REOBSERVE
↓
ACT
↓
VERIFY
```

---

# 下一輪研究

## **Multimodal Position/KV Restoration × RoPE Rebase × Cache Splicing × Prefix Reuse × Dynamic Context Surgery**

下一輪最值得繼續往底層追：

```text
Archived visual KV
↓
如何重新接回正在 decode 的 KV sequence？
```

重點拆：

```text
KV Block Identity
RoPE Position
M-RoPE time/height/width position
Cache Position
Prefix Hash
KV Splicing
Cache Rebase
Recompute vs Restore
Attention Mask Update
Context Surgery
```

並追 production runtime：

```text
vLLM DynamicCache / KVCacheManager
SGLang RadixAttention / HiCache
prefix caching
KV connectors
multimodal encoder cache
```

真正回答：

> **一段舊的 memory representation，要怎麼安全、數學一致地重新插回正在運行的 Transformer，而不是只有「從資料庫查回文字」？**

---

# 本輪結束回答

- **缺哪一層？**：Archived visual memory → active Transformer KV 的 positional / cache-splicing semantics。
- **哪個節點最淺？**：RoPE/M-RoPE-aware KV restoration。
- **哪個概念仍只是名詞？**：Agent Visual Memory Freshness Score。
- **哪個系統值得讀原始碼？**：VisCache `compression.py`、PVM `modeling_qwen3_vl.py`；下一輪應讀 vLLM/SGLang KV cache manager。
- **哪篇論文需追引用？**：RetentiveKV、Persistent Visual Memory、FOVEA。
- **哪個概念最適合視覺模擬？**：Dynamic Visual Memory & Re-observation Lab。
- **哪個 Agent 架構最值得實作？**：**Freshness-Aware Evidence Reactivation Agent**：能在 recall、ROI re-encode、full re-observation 三者之間動態決策。

---

# 本輪核心結論

> **Multimodal Agent 的 memory 不應只被理解成「把舊文字放回 prompt」。真正的 visual memory 可能存在 decoder KV、persistent visual embeddings、state-space compressed memory、streaming memory bank 或外部觀測紀錄中。下一代 Agent Runtime 的關鍵不是單純 KEEP/DROP，而是讓 evidence 在 Active → Compressed → Dormant → Reactivated 之間移動，並在真正行動前再判斷這份 memory 是否仍代表目前世界；如果世界已變，就必須 re-observe，而不是更努力地 recall。**