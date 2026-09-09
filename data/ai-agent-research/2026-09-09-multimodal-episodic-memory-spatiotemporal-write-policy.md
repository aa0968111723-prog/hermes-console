# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 13:54（Asia/Taipei）**

## 研究主題

**Multimodal Episodic Memory × Spatiotemporal / Entity / Causal Addressing × Memory Write Policy × Belief Revision**

本輪接續前一輪：

- `2026-09-09-memory-addressing-admission-kv-semantic-connector.md`
- `2026-09-09-dynamic-visual-memory-kv-reactivation-reobservation.md`
- `2026-09-09-kv-position-rebinding-cache-splicing-context-surgery.md`

本輪刻意不再重複「KV exact address vs semantic retrieval」；新的問題是：

> **一段多模態 experience 應該如何被寫成可長期追蹤的 episode？如果 Agent 問「三分鐘前畫面右下角那個紅色 Submit 按鈕後來去哪裡了？」，Memory Runtime 要如何同時使用時間、空間、實體、視覺、動作與世界狀態來找回正確 evidence？**

---

# 本小時新發現

## 新架構

1. **WorldMM — Dynamic Multimodal Memory Agent for Long Video Reasoning**
   - episodic memory：多時間尺度事件圖
   - semantic memory：持續更新的高階關係 / 習慣 knowledge graph
   - visual memory：visual embedding + timestamped frames
   - iterative retrieval agent：每輪決定 search / answer、選 memory type、形成新 query

2. **Cognitive-structured Multimodal Agent / CMA-Harness**
   - Perceptual Abstraction Engine
   - Episodic Visual Memory
   - Cognitive Retrieval Engine
   - Multimodal Executive Controller
   - 核心思想：不把所有歷史圖片一直留在 context，而是外部化成可選擇性 reactivation 的 visual episodes。

3. **AdaMem — preference-conditioned memory write control**
   - 不把「寫記憶」視為固定 extraction，而是由可更新 Memory Policy 控制。
   - policy 可以隨 feedback / QA failure 改變下一輪應優先寫入的資訊。

## 新 benchmark / failure signal

4. **SpaMEM — Spatial Memory from Action Sequences**
   - 把 embodied spatial memory 拆成：atomic perception → textual temporal reasoning → raw-visual end-to-end belief maintenance。
   - 重要診斷：很多 VLM 在有 oracle textual state history 時能做 temporal reasoning，但從 raw visual stream 維持同一套 state/belief 時明顯掉分。

5. **Temporal KG memory / time-aware memory**
   - 對 long-lived Agent，時間不應只是 `created_at` metadata；世界狀態中的 relation 具有不同 volatility，舊 fact 可能被 supersede 而不是單純 deleted。

---

# 本小時最重要 5 個發現

## 1. Multimodal Episodic Memory 不應只有「embedding + timestamp」；它更像一個 versioned event record

### 已確認事實

WorldMM 的 visual memory 對每個 video clip 保存：

```text
id
video_path
start_time
end_time
date
clip_start_sec
clip_end_sec
embedding
```

並支援兩種 retrieval：

```text
Natural-language query
→ query embedding
→ similarity search
→ visual clips
```

以及：

```text
Explicit time-range query
→ parse DAY/H:M:S range
→ retrieve corresponding frames
```

WorldMM source：
- https://github.com/wgcyeo/WorldMM/blob/main/src/worldmm/memory/visual/memory.py
- https://github.com/wgcyeo/WorldMM/blob/main/src/worldmm/memory/memory.py

### 底層拆解

若 Agent experience 只有：

```text
embedding = [ ... ]
timestamp = 13:20
```

它回答不了：

```text
「三分鐘前我按的按鈕」
「剛剛右下角那個紅色物件」
「移動之後消失的杯子」
「造成頁面跳轉的 click」
```

更合理的 episode schema：

```text
Episode
├ episode_id
├ observation_id
├ world_state_version
├ start_time / end_time
├ parent_action_id
├ source modality
├ raw evidence refs
│  ├ screenshot/frame
│  ├ audio segment
│  ├ depth
│  └ sensor
├ semantic summary
├ entities[]
├ entity tracks[]
├ spatial relations[]
├ OCR spans[]
├ actions[]
├ before_state
├ after_state
├ embeddings
└ provenance / confidence
```

### 為什麼重要

**Memory query 的真正地址不只是一個 vector。**

對 multimodal Agent，地址可能是：

```text
semantic
+ temporal
+ spatial
+ entity
+ causal/action
+ state-version
```

### 限制

目前 mainstream Agent memory 尚沒有跨框架統一的 Multimodal Episode ABI。以上完整 schema 是基於 WorldMM、SpaMEM、embodied memory requirements 所建立的 Hermes 工程模型，而不是既有標準。

---

## 2. Retrieval 應從「一個向量 index」升級成 Multi-Index Addressing

### 已確認事實

WorldMM 已經實際使用不同 memory namespace：

```text
Episodic Memory
→ HippoRAG-style event retrieval

Semantic Memory
→ PPR graph retrieval

Visual Memory
→ embedding similarity / timestamp retrieval
```

其 `WorldMemory.answer()` 是 iterative retrieval loop：

```text
Question
↓
Reasoning Agent
↓
search or answer?
↓
select episodic / semantic / visual
↓
form search query
↓
retrieve
↓
append retrieval history
↓
next reasoning round
```

Source：
https://github.com/wgcyeo/WorldMM/blob/main/src/worldmm/memory/memory.py

### Hermes 建模

真正可泛化的 episodic query router：

```text
User Query / Agent Need
↓
Query Decomposition
├ What?       → Semantic Index
├ Who?        → Entity Index
├ Where?      → Spatial Index
├ When?       → Temporal Index
├ After what? → Causal / Action Index
└ Which state?→ World-State Version Index
↓
Parallel Candidate Retrieval
↓
Candidate Fusion
↓
Consistency Check
↓
Admission Gate
↓
Evidence Reconstruction
```

例如：

```text
「三分鐘前畫面右下角那個紅色 Submit 按鈕」
```

不應只做：

```text
embed(query)
→ top-k vector
```

而應拆成：

```text
time ≈ now - 3 min
region = bottom-right
color = red
entity/text = Submit
modality = screen/image
```

然後：

```text
Temporal Index
∩ Spatial Index
∩ OCR/Entity Index
∩ Visual Similarity
→ candidate episode
```

### 為什麼重要

它能把上一輪的：

```text
Address → Resolve → Validate → Admit
```

進一步具體化為：

```text
Query Decomposition
→ Multi-Index Resolve
→ Candidate Fusion
→ State Consistency
→ Admission
```

### 限制

多 index 會產生 reconciliation 問題：各 index 的 top-k、score calibration、時間範圍與 entity resolution 可能互相衝突。

---

## 3. Memory Write Policy 是 Memory Runtime 的第一道瓶頸；Retrieval 再強也救不了「根本沒寫進去」的 evidence

### 已確認事實

AdaMem 將 memory write 定義成 preference-conditioned write control，而不是 uniform extraction。

Paper：
https://arxiv.org/abs/2606.21144

Code：
https://github.com/galaxyChen/AdaMem

其公開 `run_adamem.py` 直接維護：

```python
policy = {
  "general_policy": ...,
  "by_character": {
    "Name": "focused extraction rule"
  }
}
```

並形成：

```text
Week N interaction
↓
Policy-controlled extraction
↓
Memory Store
↓
QA
↓
Feedback / wrong answer
↓
Reflect
↓
Policy PATCH
↓
Week N+1 write behavior changes
```

其中 reflection 不是整份重寫，而是 patch semantics：

```text
old_policy
+
feedback / QA failures
↓
{
  general_policy?,
  set?: {Name: rule}
}
↓
new_policy
```

### 底層意義

Memory 系統其實有兩個不同 decision：

```text
WRITE DECISION
「這件事值不值得成為長期 memory？」

READ DECISION
「目前任務要不要把這個 memory 取回？」
```

所以：

```text
Memory Quality
≈ Write Precision × Write Recall × Retrieval Quality × Admission Quality
```

若 write recall = 0：

```text
Retrieval Recall
= 0
```

### Multimodal 延伸

對 screen/vision agent，write policy 不能只是「記住使用者偏好」，還應能依 episode novelty / action effect / uncertainty / future utility 來決定：

```text
Observation
↓
Write Scorer
├ Novelty
├ Task relevance
├ Action consequence
├ State change magnitude
├ Entity persistence
├ Uncertainty
├ User preference
├ Safety / provenance
└ Storage cost
↓
WRITE / UPDATE / MERGE / DISCARD
```

這是 Hermes 工程推論。

### 限制

AdaMem 自己也指出：即使 policy 是合理的，自然語言 extraction model 仍不一定能可靠執行 selective writing。因此「學到 policy」與「policy execution fidelity」是兩個不同 failure layer。

---

## 4. Spatial Memory 的核心不是「記得畫面」，而是 Belief State 持續更新

### 論文結果

SpaMEM：
https://arxiv.org/abs/2604.22409

其核心設定用 action-conditioned transforms：

```text
spawn
place
remove
```

讓 world state 持續變動，並分三層測試：

```text
Level 1
Single Observation
→ Atomic Spatial Perception

Level 2
Oracle Textual State History
→ Temporal / Spatial Reasoning

Level 3
Raw Visual Stream
→ Perception + Memory + Belief Update
```

Paper 報告 representative open VLM 在 Level 2 → Level 3 有明顯落差，表示 textual bookkeeping 可以支撐 reasoning，但 raw visual evidence → long-horizon state maintenance 是另一個 bottleneck。

### Bottom-level mechanism

正確 embodied memory 不應只是 append observations：

```text
Obs1
Obs2
Obs3
Obs4
```

而是：

```text
Belief State B_t
+
Observation O_t
+
Action A_(t-1)
↓
Entity Association
↓
State Delta
↓
Conflict Detection
↓
Belief Revision
↓
B_(t+1)
```

例如：

```text
t0: cup on table
A0: robot moves cup
O1: cup on shelf
```

Memory 不應保留兩個同權重 fact：

```text
cup → on → table
cup → on → shelf
```

而應有 versioned fact：

```text
[cup, on, table]
valid: t0 → t1
superseded_by → [cup, on, shelf]
valid: t1 → now
```

### 為什麼重要

這把「Memory」與「World Model」真正接起來：

```text
Episodic Memory
→ stores observations/events

Belief State
→ stores current best estimate of world
```

兩者不能混為一談。

---

## 5. Multi-timescale Memory 比固定 chunk size 更接近真實 Agent experience

### 已確認事實

WorldMM 的 episodic memory不是只用固定單一時間窗，而是 multi-scale event structure；visual memory則保存 timestamped visual clips / frames。WorldMM 將 episodic、semantic、visual memory 分開，retrieval agent 可以跨多 round、跨 memory type 補 evidence。

Project：
https://worldmm.github.io/

Paper：
https://arxiv.org/abs/2512.02425

其公開 project page 報告：WorldMM 在五個 long-video QA benchmarks 上平均比 previous SOTA 高 8.4%；此數字只適用於該 paper 設定，不能外推成任何 Agent 的通用 memory 增益。

### 底層拆解

同一事件可以有多個 temporal address：

```text
Frame
→ 1 sec

Micro-event
→ 5–30 sec

Episode
→ minutes

Session
→ hours

Routine / habit
→ days / weeks
```

因此 query：

```text
「我有沒有關瓦斯？」
```

需要 fine-grained event；

而：

```text
「我通常早餐後做什麼？」
```

需要 semantic / habitual consolidation。

所以 Memory Writer 應該包含：

```text
Raw Event Stream
↓
Temporal Segmentation
↓
Micro Episodes
↓
Episode Consolidation
↓
Cross-Episode Pattern Detection
↓
Semantic Memory
```

而不是：

```text
every 30 seconds → one vector
```

---

# Architecture Breakdown

本輪建立的 Multimodal Episodic Memory Runtime：

```text
Camera / Screen / Audio / Video / Sensors
↓
Observation Manager
├ Observation ID
├ Timestamp
├ World-State Version
├ Parent Action
└ Modality
↓
Perception
├ Vision Encoder
├ OCR
├ Object / Entity Detection
├ Audio / ASR
├ Depth / Spatial
└ Sensor Parsing
↓
Episode Builder
├ Temporal Segmentation
├ Entity Association
├ Spatial Graph
├ Action Link
├ Before / After State
└ Confidence / Provenance
↓
WRITE POLICY
├ Novelty
├ User / Task Preference
├ State Change
├ Action Consequence
├ Uncertainty
├ Future Utility
└ Storage Cost
↓
Decision
├ WRITE NEW
├ UPDATE EXISTING
├ MERGE
├ CONSOLIDATE
└ DISCARD
↓
Multimodal Episode Store
├ Raw Evidence Store
├ Semantic Index
├ Entity Index
├ Temporal Index
├ Spatial Index
├ Action / Causal Index
├ Visual Vector Index
└ World-State Version Index
↓
Query
↓
Query Decomposer
├ what
├ who
├ where
├ when
├ after/before what
└ which state
↓
Multi-Index Retriever
↓
Candidate Fusion
↓
Belief / Version Consistency Check
↓
Admission Gate
↓
Evidence Reconstruction
├ text summary
├ raw crop/frame
├ entity state
├ spatial relation
└ causal path
↓
Context Compiler / Memory Connector
↓
LLM Reasoning
↓
Planning
↓
Action
↓
Environment Changes
↓
Belief Revision
```

---

# Bottom-Level Logic

## A. Episode write

```text
O_t = current multimodal observation
A_(t-1) = action that preceded it
B_(t-1) = previous belief state
```

先形成：

```text
features = perceive(O_t)
entities = associate(features, B_(t-1))
delta = compare(B_(t-1), entities)
```

再估計 write utility：

```text
U_write =
  α·Novelty
+ β·TaskRelevance
+ γ·StateChange
+ δ·ActionConsequence
+ ε·FutureUtility
+ ζ·UserPreference
- λ·StorageCost
```

這個公式是 Hermes 工程建模，不是 AdaMem 原論文公式。

若：

```text
U_write > threshold
```

並不一定只做 INSERT；還要判斷：

```text
same entity + same episode + changed state
→ UPDATE / VERSION

same repeated pattern across episodes
→ CONSOLIDATE to semantic memory

near duplicate
→ MERGE
```

## B. Multi-index retrieval

Query：

```text
「剛剛按下 Submit 後出現的紅色警告是什麼？」
```

解析：

```text
Temporal: recent
Action: click(Submit)
Causal: after(click)
Visual: red warning
Entity/OCR: warning message
```

各 index 返回：

```text
Temporal → E12, E13, E14
Action   → E13
Visual   → E13, E51
OCR      → E13, E77
```

Fusion：

```text
score(E) =
  w_t·temporal
+ w_a·action
+ w_v·visual
+ w_e·entity
+ w_s·spatial
+ w_c·causal
```

最後：

```text
E13
→ verify world-state / provenance
→ admission
→ raw screenshot crop + text + state delta
```

## C. Belief revision

```text
B_t
+
Episode(E_t)
↓
Conflict?
├ NO  → extend state
└ YES
   ↓
   compare observation freshness / confidence / causal order
   ↓
   supersede / branch / retain uncertainty
↓
B_(t+1)
```

這比「append facts to vector DB」更接近 embodied / computer Agent 真實需求。

---

# Visual Simulation Idea

# **Multimodal Episode & Belief Memory Lab**

## 1. Live Episode Timeline

```text
13:40:01  OBS#91  checkout page
13:40:04  ACT#44  click Submit
13:40:05  OBS#92  red validation alert appears
13:40:11  ACT#45  edit address
13:40:13  OBS#93  alert disappears
```

每個 episode 點開：

```text
Episode E92
├ Screenshot
├ ROI: bottom-right
├ OCR: "Postal code invalid"
├ Entity: validation_alert_1
├ Color: red
├ Parent Action: click Submit
├ Spatial: right-of(form)
├ State Delta: alert absent → present
├ World-State Version: 92
└ Confidence
```

## 2. Multi-Index Address Viewer

使用者輸入：

```text
「剛剛 Submit 後面的紅色錯誤」
```

畫面同時顯示：

```text
Semantic    E92 .81
Temporal    E92 .97
Entity      E92 .88
Spatial     E92 .91
Action      E92 1.00
Causal      E92 1.00
```

然後動畫：

```text
Candidate Intersection / Fusion
→ E92
```

## 3. Write Policy Simulator

同一段 interaction 讓使用者切：

```text
Remember Everything
Task-Relevant
Novelty-Based
Action-Effect-Based
AdaMem-style Adaptive Policy
```

同步顯示：

```text
Raw Observations        120
Written Episodes         34
Merged                    8
Discarded                78
Storage                  46 MB
Later QA Recall          91%
```

可故意製造：

```text
WRITE POLICY MISS
→ future retrieval impossible
```

## 4. Belief State Diff

```text
Before
cup → on → table

Action
move(cup, shelf)

After
cup → on → shelf
```

圖譜動畫顯示：

```text
old edge
valid_until=t1
↓
SUPERSEDED

new edge
valid_from=t1
```

## 5. Memory vs Current World

讓使用者把 UI 再改一次：

```text
Memory Episode:
Submit at bottom-right

Live Screen:
Submit moved top-right
```

系統顯示：

```text
EPISODIC MEMORY VALID AS HISTORY
CURRENT BELIEF OUTDATED
→ REOBSERVE / BELIEF UPDATE
```

---

# Code / GitHub

## 1. WorldMM

Repository：
https://github.com/wgcyeo/WorldMM

值得看的目錄：

```text
src/worldmm/memory/
├ memory.py
├ episodic/
├ semantic/
└ visual/

preprocess/
├ build_memory.py
├ episodic_memory/
│  ├ extract_episodic_triples.py
│  └ generate_fine_caption*.py
├ semantic_memory/
│  ├ extract_semantic_triples.py
│  └ consolidate_semantic_memory.py
└ visual_memory/
   └ extract_visual_features.py
```

### 核心檔案

`src/worldmm/memory/memory.py`

值得追：

```text
WorldMemory
retrieve_from_episodic()
retrieve_from_semantic()
retrieve_from_visual()
answer()
```

它已實作：

```text
Reasoning Agent
→ select memory type
→ retrieve
→ accumulate retrieved context
→ repeat
→ answer
```

`src/worldmm/memory/visual/memory.py`

值得追：

```text
VideoClipEntry
FrameEntry
_parse_time_range()
_is_time_range_query()
VisualMemory.index()
VisualMemory.retrieve()
```

這裡直接展示 temporal addressing + embedding retrieval 如何共存。

## 2. AdaMem

Repository：
https://github.com/galaxyChen/AdaMem

核心檔案：

```text
run_adamem.py
run_m0.py
common.py
analysis/
results/
repro/
```

最值得看的底層：

```text
REFLECT_PROMPT
DEFAULT_GENERAL_POLICY
_render_policy_as_instructions()
_apply_policy_patch()
_update_policy()
```

它把 write control 變成一個 explicit, feedback-updatable runtime policy。

## 3. CMA-Harness

Repository：
https://github.com/caseclose/cma-harness

目前公開 repo 主要提供論文 / benchmark / demo / harness 資訊；可作為 Episodic Visual Memory + retrieval + executive control 的 system-architecture reference，但目前不應假設它像 WorldMM 一樣完整開放所有底層 runtime implementation。

---

# Papers

## 1. WorldMM: Dynamic Multimodal Memory Agent for Long Video Reasoning

- **Authors:** Woongyeong Yeo, Kangsan Kim, Jaehong Yoon, Sung Ju Hwang
- **Institutions:** KAIST, Nanyang Technological University, DeepAuto.ai
- **Year:** 2026 (CVPR 2026; arXiv first submitted 2025)
- **URL:** https://arxiv.org/abs/2512.02425
- **Code:** https://github.com/wgcyeo/WorldMM
- **Dataset / Benchmarks:** long-video QA benchmarks including EgoLifeQA / Video-MME pipeline support
- **Architecture:** episodic + semantic + visual memory, iterative memory-selection/retrieval agent
- **Contribution:** 把 long-video memory 從單一 text-summary memory 升級成 complementary multimodal memory hierarchy。
- **Limitations:** 主要研究 long-video QA；不能直接證明其 memory topology 對 browser/computer/robot action loop 都是最佳設計。

## 2. Cognitive-structured Multimodal Agent for Multimodal Understanding, Generation, and Editing

- **Authors:** Feng Wang, Canmiao Fu, Zhipeng Huang, Chen Li, Jing Lyu, Ge Li
- **Institutions:** Peking University, WeChat Vision / Tencent
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.08497
- **Code / Harness:** https://github.com/caseclose/cma-harness
- **Architecture:** Perceptual Abstraction Engine → Episodic Visual Memory → Cognitive Retrieval Engine → Multimodal Executive Controller
- **Contribution:** 將 long-horizon visual history 外部化並 selective reactivation；同時以 generated scenario + retrieval annotation 訓練 memory use。
- **Limitations:** paper 中 retrieval accuracy / latency 數字只適用其 benchmark / setup；公開 harness 與完整 production runtime 的開放程度需分開看待。

## 3. AdaMem: Learning What to Remember with Adaptive Memory Policies for Personalized Agents

- **Authors:** Xingyu Chen, Rui Wang, Zhaopeng Tu, Liefeng Bo
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2606.21144
- **Code:** https://github.com/galaxyChen/AdaMem
- **Dataset:** AdaMem-Bench
- **Architecture:** policy-conditioned extraction + periodic feedback reflection + patch-style policy update
- **Contribution:** 把 write policy 本身變成可學習 / 可更新 Agent state。
- **Reported result:** average QA 由 Mem0 80.0% → 84.35%，persistent memory 減少 9.27%（paper setting）。
- **Limitations:** natural-language policy execution 仍不穩定；研究重點是 personalized textual memory，而非完整 multimodal episodic state。

## 4. SpaMEM: Benchmarking Dynamic Spatial Reasoning via Perception-Memory Integration in Embodied Environments

- **Authors:** Chih-Ting Liao, Xi Xiao, Chunlei Meng, Zhangquan Chen, Yitong Qiao, Weilin Zhou, Tianyang Wang, Xu Zheng, Xin Cao
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2604.22409
- **Dataset:** 10,601,392 images；RGB / depth / instance / semantic segmentation；25k+ interaction sequences；1,000 procedurally generated houses
- **Architecture / Benchmark:** L1 perception → L2 oracle textual state history → L3 raw-visual belief maintenance
- **Contribution:** 把「空間 reasoning 失敗」拆成 perception、temporal reasoning、visual memory / belief integration 三層。
- **Limitations:** diagnostic benchmark，不是完整 Agent memory runtime implementation。

## 5. Temporal Knowledge-Graph Memory in a Partially Observable Environment

- **Authors:** Taewoon Kim, Vincent François-Lavet, Michael Cochez
- **Institution:** Vrije Universiteit Amsterdam
- **2026 revision**
- **URL:** https://arxiv.org/abs/2408.05861
- **Architecture:** temporal KG memory with time/access qualifiers under partial observability
- **Contribution:** 顯示 memory entry 應同時有 temporal state / access history，而不只是 semantic triple。
- **Limitations:** symbolic / RDF-style setting，與 raw multimodal perception 尚有 representation gap。

---

# 已確認事實 vs 工程推論 vs 尚未驗證假說

## 已確認事實

- WorldMM production-like research code實際分 episodic / semantic / visual memory，並由 iterative reasoning loop 選 memory type。
- WorldMM visual memory同時支援 text embedding search 與 explicit timestamp-range retrieval。
- AdaMem 實際以 natural-language Memory Policy 控制 extraction，並用 feedback patch 更新 policy。
- SpaMEM 顯示 oracle textual history 與 raw-visual long-horizon belief maintenance 之間存在明顯能力差距。

## 工程推論

Hermes 應建立：

```text
Multimodal Episode Record
+
Multi-Index Addressing
+
Write Policy
+
Belief Revision
+
Admission Gate
```

作為統一 memory runtime，而不只是一個 vector DB wrapper。

## 尚未驗證假說

1. `Semantic + Temporal + Spatial + Action/Causal` joint retrieval 是否能穩定超越單一 multimodal embedding retrieval，需要專門 benchmark。
2. Write utility 中加入 `action consequence / state change magnitude` 是否能顯著提升 Computer Agent 長任務成功率，尚未有統一實驗。
3. 是否能定義跨 browser / robot / desktop 的標準 `Episode ABI`，仍是 open problem。

---

# Unknown / Open Questions

## 1. Episode Boundary 到底由誰決定？

```text
fixed time chunk?
scene change?
action boundary?
entity state transition?
LLM semantic segmentation?
hybrid?
```

如果 episode 太細：memory explosion。
如果太粗：causal / spatial evidence 被混在一起。

## 2. Multi-Index score 怎麼校準？

```text
cosine .91
spatial IoU .73
time distance 12 sec
causal path depth 1
```

這些 score 不在同一尺度，不能直接相加。

## 3. Belief Revision 如何保留「過去是真的、現在不是真的」？

不能把 old fact 直接 delete，因為 Agent 仍可能回答：

```text
「剛才杯子原本在哪裡？」
```

需要：

```text
valid_from
valid_until
superseded_by
observation_version
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Multimodal Episodic Memory Runtime
├ Episode Builder
├ Episode Boundary
├ Episode ID
├ Observation ID
├ World-State Version
├ Parent Action
├ Raw Evidence Reference
├ Semantic Summary
├ Entity Track
├ Spatial Relation
├ Temporal Range
├ Causal Link
├ Before State
├ After State
├ Provenance
└ Confidence
```

```text
Memory Write Runtime
├ Write Policy
├ Write Utility
├ Novelty
├ Task Relevance
├ User Preference
├ State Change
├ Action Consequence
├ Future Utility
├ Storage Cost
├ Write
├ Update
├ Merge
├ Consolidate
└ Discard
```

```text
Multi-Index Memory Addressing
├ Semantic Index
├ Entity Index
├ Temporal Index
├ Spatial Index
├ Action Index
├ Causal Index
├ Visual Vector Index
└ World-State Index
```

```text
Belief State Runtime
├ Current Belief
├ State Delta
├ Conflict Detection
├ Fact Version
├ valid_from
├ valid_until
├ superseded_by
└ Uncertainty
```

## Edges

```text
Observation
→ forms
Episode

Action
→ parents
Next Observation

Episode
→ updates
Belief State

Write Policy
→ controls
Memory Creation

Feedback
→ updates
Write Policy

Episode
→ indexed by
Semantic / Temporal / Spatial / Entity / Causal Address

Reasoning Need
→ decomposes into
Multi-Index Query

Candidate Retrieval
→ passes through
Admission Gate

State Conflict
→ triggers
Belief Revision

Old Fact
→ superseded_by
New Fact

Episode Pattern
→ consolidates into
Semantic Memory

Raw Evidence
→ supports
Episode Provenance
```

---

# 與歷史研究的比較

前一輪已回答：

```text
KV memory 用 exact computational address
Semantic memory 用 approximate meaning address
Retrieved ≠ Admitted
```

本輪新增：

```text
Semantic Address
≠ Temporal Address
≠ Spatial Address
≠ Entity Address
≠ Causal Address
```

並再往前補一層：

```text
沒寫入 memory
→ 永遠無法 retrieve
```

因此目前完整 Memory Pipeline 應升級為：

```text
Observe
↓
Segment Episode
↓
Decide What To Write
↓
Represent
↓
Index in Multiple Address Spaces
↓
Version / Belief Update
↓
Query Decomposition
↓
Retrieve Candidates
↓
Fuse
↓
Validate
↓
Authorize
↓
Admit
↓
Materialize Evidence
↓
Inject / Read
↓
Reason
↓
Act
↓
New Observation
```

---

# 下一輪研究

下一輪最重要缺口：

# **Episode Segmentation × Entity Persistence × Data Association × Visual Object Tracking × World-State Identity**

因為本輪建立 Multi-Index Episode schema 後，最底層的新問題變成：

```text
Frame 1 的紅色杯子
Frame 20 的紅色杯子
Frame 300 的半遮擋杯子
```

Agent 怎麼知道它們是「同一個 entity」？

下一輪應拆：

```text
Frame
↓
Detection / Region Tokens
↓
Visual Embedding
↓
Tracking
↓
Data Association
├ Appearance Similarity
├ Geometry
├ Motion
├ Temporal Continuity
└ Semantic Identity
↓
Persistent Entity ID
↓
Entity State Timeline
↓
Episode / Spatial Graph
↓
Belief State
```

並比較：

```text
SORT / DeepSORT / ByteTrack 類 tracking
SAM / segmentation-based tracks
DINO / CLIP feature association
VLM-based entity resolution
3D object memory
Embodied scene graph
Computer-agent DOM / accessibility IDs vs pure vision IDs
```

---

# 本輪結束回答

**缺哪一層？** 目前最缺的是 `Observation → persistent entity identity → episode boundary`。

**哪個節點最淺？** Causal Index 與 multimodal episode boundary 還最淺。

**哪個概念仍只是名詞？** `Unified Multimodal Episode ABI`、`Future Utility Score`。

**哪個系統值得讀原始碼？** WorldMM `src/worldmm/memory/*` 與 AdaMem `run_adamem.py`；下一輪應直接讀 object tracking / embodied scene-memory runtime。

**哪篇論文需追引用？** SpaMEM（用來建立 spatial-belief failure benchmark）與 AdaMem（用來追 memory write control 的後續方法）。

**哪個概念最適合視覺模擬？** `Multimodal Episode & Belief Memory Lab`。

**哪個 Agent 架構最值得實作？** **Multi-Index Episodic Memory Agent with Adaptive Write Policy**。

---

# 本輪核心結論

> **AI 的長期記憶不能只理解成「把內容 embedding 後存進向量資料庫」。真正的 Multimodal Episodic Memory 必須先決定什麼值得寫，再把 observation 組成帶有時間、空間、實體、動作、因果與世界狀態版本的 episode，並同時建立多個 address space。之後 retrieval 才能依任務把「什麼、誰、哪裡、何時、哪個動作之後、哪個世界版本」重新組合成證據。Memory 的核心因此從 Vector Search 升級成 Episode Construction → Write Policy → Multi-Index Addressing → Belief Revision → Admission → Evidence Reconstruction。**
