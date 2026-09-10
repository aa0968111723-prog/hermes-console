# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 02:50 Asia/Taipei**  
**本輪主題：Entity State Transition × Physical Transformation × Identity Lineage × World-Model Update**

## 與歷史研究比較

上一輪已處理 Cross-Modal Grounded Entity Identity × Object Permanence × 3D Re-Identification × Affordance Identity，核心問題是：Camera observation、Memory record、3D node、語言 referent、action target 如何綁定到同一個 persistent physical entity。

上一輪鏈：

```text
Camera / RGB-D / Video
→ Detection / Segmentation
→ 2D→3D lifting
→ Multi-evidence Re-ID
→ PersistentEntityID
→ Object permanence belief
→ Part / Affordance graph
→ Action target
```

本輪不再重複「遮擋後是不是同一個物件」，而處理更難的下一層：**物件在真實交互中被切割、剝皮、倒出、拆解、組裝、變形、容器轉移或接觸後，PersistentEntityID 應該如何更新？一對一 identity 何時失效？世界模型如何區分「同一實體的 state change」與「新實體誕生／舊實體終止」？**

本輪核心結論：

> **Object Permanence ≠ Transformation Lineage。**
>
> 物件沒有消失，不代表 identity 可以永遠以單一 ID 延續；真實世界需要 `EntityState + TransformationEvent + LineageEdge + ConservationConstraint`。

---

# 本小時新發現

## 1. 新架構：Track Any State / TubeletGraph 把 tracking 從「同外觀 instance」提升為「跨 transformation 的 state graph」

論文：**Tracking and Understanding Object Transformations**  
Authors: Yihong Sun, Xinyu Yang, Jennifer J. Sun, Bharath Hariharan  
Institution: Cornell University  
Venue: NeurIPS 2025  
Year: 2025 / arXiv v2 2026  
URL: https://arxiv.org/abs/2511.04678  
Project: https://tubelet-graph.github.io/  
Dataset: VOST-TAS  
Dataset URL: https://huggingface.co/datasets/yihongs/VOST-TAS  
Code: project page links code; exact repository was not independently reproduced in this round.

### Architecture

Track Any State（TAS）重新定義 tracking 問題：

```text
Initial object mask
↓
Base video object tracker
↓
Track failure / missing segment
↓
Search overlooked tubelets
↓
Semantic prior + proximity prior
↓
Recover / attach candidate tracks
↓
Detect transformation event
↓
Multimodal reasoning
↓
Action label + resulting-object labels
↓
Transformation State Graph
```

VOST-TAS 明確包含 transformation start/end frame、action description、以及多個 resulting object descriptions。公開 dataset card 顯示 57 video instances、108 transformations、293 resulting objects。

### 底層意義

傳統 MOT / VOS 隱含假設：

```text
Entity_t
→ same visual instance
→ Entity_t+1
```

Transformation tracking 必須允許：

```text
Entity A
--CUT-->
├ Entity B
└ Entity C
```

或：

```text
Entity A + Entity B
--ASSEMBLE-->
Entity C
```

因此 identity 結構應從 single chain 升級成 lineage DAG。

### 已確認事實

- TubeletGraph 是 zero-shot system，用 semantic/proximity priors 恢復 transformation 後遺失的 tracks。
- 系統建立描述 transformation 的 state graph。
- VOST-TAS 對 transformation 的時間區間、action、resulting objects 提供顯式 annotation。

### 限制

- transformation localization 仍困難，特別是沒有造成 tracking failure 的弱變化。
- state graph 的 semantic interpretation 仍依賴 multimodal model。
- graph 描述「觀察到的變化」，不等於完整物理 causal model。
- 對質量、體積、材料、拓樸等 conservation relation 沒有 formal certificate。

### 改變了什麼

從：

```text
Persistent Object ID
```

推進成：

```text
Persistent Entity Lineage
+
Transformation Event
+
Resulting Entities
```

來源：
- https://arxiv.org/abs/2511.04678
- https://tubelet-graph.github.io/
- https://huggingface.co/datasets/yihongs/VOST-TAS

---

## 2. 新 World-Model Architecture：ActWorld 把「造成物件狀態改變的關鍵 interaction frame」從一般歷史中獨立保存

論文：**ActWorld: From Explorable to Interactive World Model via Action-Aware Memory**  
Authors: Zhexiao Xiong, Yizhi Song, Hao Kang, Qing Yan, Liming Jiang, Jenson Yang, Zhoujie Fu, Stathi Fotiadis, Angtian Wang, Zichuan Liu, Bo Liu, Yiding Yang, Xin Lu, Nathan Jacobs  
Year: 2026  
URL: https://arxiv.org/abs/2606.17730  
Project: https://interactwm.github.io/ActWorld/  
Dataset: 100K interaction videos, 40 action categories  
Benchmark: I-Bench  
Architecture: chunk-autoregressive DiT + Hierarchical Action-Aware Memory + persistent event/object token bank + dual-branch camera conditioning

### 問題：action-forgetting pathology

一般長影片 world model 常用 recency-biased history compression：

```text
old frames
↓
evicted / heavily compressed
↓
recent navigation dominates context
```

如果「杯子被拿起」發生在很早之前，但中間走了很久：

```text
PICKUP cup
→ walk
→ walk
→ turn
→ walk
→ PLACE cup
```

若 pickup 的 transition frame 被丟掉，world model 可能忘記杯子現在應該在手上，而不是原桌面。

ActWorld 的解法：

```text
Past observation chunks
↓
Event-Aware Frame Re-assignment (EAFR)
↓
Local memory bank
+
Persistent memory bank
    ├ event-update tokens
    └ object-identity tokens
↓
Action-Conditioned History Amplification (ACHA)
↓
Autoregressive DiT generation
```

persistent bank 讓 interaction-critical event 與 object identity 在 sliding window eviction 之後仍保留。

### 對 Hermes 的直接啟示

Memory 不應只存：

```text
Object #17 = cup
```

而應存：

```text
Entity #17
State v31
Event PICKUP
State v32
Event CARRY
State v33
Event PLACE
State v34
```

也就是 **Action-Native State Trail**。

### 限制

- ActWorld 的 state 主要仍存在生成模型 latent / token memory 中，不等於可審計 symbolic physical state。
- persistent FIFO event/object token 是否正確綁定真實 entity，仍受 perception / generation error 影響。
- realistic-looking transition 不保證 conservation law 正確。

來源：
- https://arxiv.org/abs/2606.17730
- https://interactwm.github.io/ActWorld/

---

## 3. Bottom-Level Mechanism：HCLSM 把連續物理變化、離散事件、抽象目標拆成不同時間尺度

論文：**HCLSM: Hierarchical Causal Latent State Machines for Object-Centric World Modeling**  
Authors: Jaber Jaber, Osama Jaber  
Year: 2026  
URL: https://arxiv.org/abs/2603.29090  
Code: https://github.com/RightNow-AI/hclsm  
Dataset / Benchmark: PushT / Open X-Embodiment-derived setup  
Architecture: object-centric decomposition + Level-0 selective SSM + Level-1 sparse event Transformer + Level-2 compressed goal Transformer + causal interaction graph

### 原始碼確認

本輪不是只讀 README，已直接檢查 repository。核心 package：

```text
hclsm/
├ causality/
├ dynamics/
│  ├ event_detector.py
│  ├ hierarchy_manager.py
│  ├ level0_ssm.py
│  ├ level1_event.py
│  ├ level2_goal.py
│  └ temporal_unet.py
├ inference/
├ kernels/
├ memory/
├ objects/
├ perception/
├ training/
└ model.py
```

值得看的核心檔：

```text
hclsm/dynamics/event_detector.py
hclsm/dynamics/level0_ssm.py
hclsm/dynamics/level1_event.py
hclsm/dynamics/level2_goal.py
hclsm/dynamics/hierarchy_manager.py
hclsm/causality/
hclsm/objects/
hclsm/model.py
```

### event_detector.py 底層機制

原始碼實際計算多時間尺度 temporal features：

```text
for scale in [1, 2, 4]:
    diff = state[t] - state[t-scale]
    magnitude = ||diff||
    acceleration = diff[t] - diff[t-scale]
```

然後：

```text
multi-scale temporal features
↓
causal dilated Conv1D
  dilation 1
  dilation 2
  dilation 4
↓
MLP
↓
sigmoid event probability
↓
learnable threshold
↓
hard event mask with straight-through estimator
```

而且它加入 event-rate regularization：

```text
min_event_rate = 0.1
max_event_rate = 0.5
```

避免：

```text
no events at all
```

或：

```text
every frame is an event
```

contrastive event loss 則要求 event probability 與實際 latent state discontinuity 對齊。

### 為什麼重要

這為本輪的 transformation runtime 提供一個非常實際的分層：

```text
Level 0: continuous state evolution
位置、速度、姿態、形變的小變化

Level 1: transformation event
切、拿、放、碰撞、開啟、拆離

Level 2: goal / phase transition
完成拿取、完成組裝、完成搬運
```

因此：

> **State change ≠ Event ≠ Goal transition。**

### 限制

- HCLSM 仍主要在受控 manipulation benchmark 驗證。
- latent discontinuity ≠ semantic physical transformation，仍需 grounding。
- event detector 的 state 是 mean-pooled object states；對 object split/merge 的 topology change 還需更明確 lineage mechanism。

來源：
- https://arxiv.org/abs/2603.29090
- https://github.com/RightNow-AI/hclsm

---

## 4. 關鍵反證：VLM 並沒有可靠的 physical transformation invariance

論文：**Vision Language Models Cannot Reason About Physical Transformation**  
Authors: Dezhi Luo, Yijiang Li, Maijunxian Wang, Tianwei Zhao, Bingyang Wang, Siheng Wang, Pinyuan Feng, Pooyan Rahmanzadehgervi, Ziqiao Ma, Hokin Deng  
Venue: ICML 2026  
Year: 2026  
URL: https://arxiv.org/abs/2603.07109  
OpenReview: https://openreview.net/forum?id=1xZeIkqDPs  
Benchmark: ConservationBench  
Scale: 23,040 questions, 112 VLMs, 4 physical properties

ConservationBench 專門問：在 transformation 前後，某個 physical property 是否保持不變。

測試包含：

```text
number
length
volume
size
```

並用 conserving / non-conserving paired scenarios 避免模型只靠「物理量應該守恆」的文字先驗作弊。

### 結果

論文報告大量模型表現接近 chance；改善 conservation question 的模型，常同時在 non-conserving control 上下降。增加 temporal resolution、prompting 或 curated sampling 也沒有解掉核心問題。

### 對 Hermes 的直接結論

不能做：

```text
video
→ VLM
→ "same amount / same object"
→ write memory as fact
```

需要：

```text
Before State
+
Transformation Event
+
After State
↓
Explicit invariant / conservation probes
↓
Geometry / count / volume / topology evidence
↓
Transformation Certificate
↓
Memory commit
```

因此新增：

```text
VLM transformation description
≠ Physical State Certificate
```

### 限制

ConservationBench 的物理 properties 是受控有限集合；它證明 VLM 的重要缺陷，但不是完整 robotics physics benchmark。

來源：
- https://arxiv.org/abs/2603.07109
- https://openreview.net/forum?id=1xZeIkqDPs

---

## 5. World state 不能只保留最新 snapshot：WorldLines / ObsMem 顯示 action-native state trail 對長期 embodied memory 很重要

論文：**WorldLines: Benchmarking and Modeling Long-Horizon Stateful Embodied Agents**  
Authors: Yehang Zhang, Jianchong Su, Haojian Huang, Yifan Chang, Tianhao Zhou, Xinli Xu, Yingjie Xu, Yinchuan Li, Zexi Li, Ying-Cong Chen  
Year: 2026  
URL: https://arxiv.org/abs/2606.18847  
Framework: ObsMem  
Benchmark: long-horizon household traces with dialogue, action, feedback, object/device state changes

WorldLines 的重要性不是另一個 language memory benchmark，而是把：

```text
dialogue
+
action
+
execution feedback
+
object/device state changes
```

串成 evidence-linked long-horizon traces。

ObsMem 特別維護 visibility-aware memory 與 action-native state trails，用來處理：

```text
partial observability
state overwritten by later events
multi-hop state history
```

### 對 Hermes 的意義

不能只存：

```text
cup.location = shelf
```

而應：

```text
Entity #17
├ t1 observed on table
├ t2 robot PICKUP → believed held
├ t3 PLACE shelf → observed success
├ t4 not visible
├ t5 external change possible
└ current state = shelf with confidence / evidence lineage
```

更進一步，若 transformation 改變 entity lineage：

```text
Apple #5
├ CUT event
├ Slice #101
├ Slice #102
└ Core #103
```

舊的 `Apple #5.state` 不能直接被最後一個 resulting object 覆寫。

來源：
- https://arxiv.org/abs/2606.18847

---

# 本小時最重要 5 個發現

## 發現 1 — Persistent ID 必須升級為 Lineage Graph

**是什麼**：真實物件 transformation 會產生一對多、多對一、part detach/attach，而不是永遠一對一 tracking。

**底層如何運作**：

```text
EntityState_t
+
Action / Interaction
+
Observation_{t+1}
↓
Transformation Detector
↓
Hypothesis Set
├ SAME_ENTITY_STATE_UPDATE
├ SPLIT
├ MERGE
├ PART_DETACH
├ PART_ATTACH
├ MATERIAL_TRANSFER
├ CREATE
└ DESTROY
↓
Evidence Scoring
↓
Lineage Commit
```

**為什麼重要**：Memory、RAG、KG、Planner 若仍使用 single mutable object row，會把歷史 identity overwrite 掉。

**限制**：沒有通用 benchmark 可涵蓋所有物理 transformation。

**來源**：TubeletGraph/VOST-TAS + WorldLines。

---

## 發現 2 — Event boundary 是世界模型中「連續物理」與「離散語義」之間的橋

**是什麼**：HCLSM 的 multi-scale event detector 顯示，可以從 latent state 的 diff / magnitude / acceleration 中學習 discontinuity，再把它提升到 event-level processing。

**底層**：

```text
state sequence
→ Δstate at 1/2/4 steps
→ magnitude
→ acceleration
→ causal dilated temporal conv
→ event probability
→ event mask
```

**重要性**：Hermes 可以不需要每一 frame 都跑重型 VLM semantic reasoning，只在 transformation candidate event 發生時升級到昂貴的 grounding / verification。

**限制**：latent discontinuity 不自動等於物理語義。

**來源**：HCLSM paper + GitHub `event_detector.py`。

---

## 發現 3 — World model memory 應保留 causally-critical transition frames/tokens，而非單純最近歷史

**是什麼**：ActWorld 指出 recency compression 會造成 action-forgetting pathology。

**底層**：

```text
history
→ event-aware ranking
→ local compressed memory
+
persistent event/object tokens
→ current action-conditioned retrieval/amplification
→ next chunk
```

**重要性**：真正影響 current object state 的關鍵可能是幾十秒前的 pickup/open/cut，而不是最近一秒的 navigation frame。

**限制**：token memory 仍不是 formal symbolic world state。

**來源**：ActWorld paper/project。

---

## 發現 4 — Transformation reasoning 需要 explicit invariants，不可只信 VLM 描述

**是什麼**：ConservationBench 顯示 112 VLMs 在物理 transformation invariance 上有系統性失敗。

**底層**：應增加：

```text
pre-state measurement
→ transformation
→ post-state measurement
→ invariant comparison
→ uncertainty
→ certificate
```

而不是：

```text
VLM sentence
→ fact
```

**重要性**：world model 若把 visually plausible 但 physically impossible transition 寫進 Memory，後續 Planner 會建立在錯世界上。

**限制**：量測本身也可能受 perception error 影響。

**來源**：ConservationBench + ABot-PhysWorld 對物理不合理 manipulation generation 的研究動機形成交叉支持。

---

## 發現 5 — Action 與 Verification 必須共享同一份 object state

POT-VLA（Closing the Loop in Humanoid VLA）將 role-indexed persistent 3D object records 同時供 action expert 與 geometric predicate supervisor 使用，論文在 Unitree G1 的 8 類真實任務中由 39/80 提升到 71/80 successes。

這指出一個重要 runtime invariant：

```text
State used to ACT
=
State used to VERIFY
```

至少應來自同一 versioned state registry，否則會產生 object-state divergence：Agent 用舊 target state 執行，Verifier 卻用另一份 scene interpretation 判斷成功。

來源：
- https://arxiv.org/abs/2607.18016

---

# Architecture Breakdown

本輪提出 Hermes 的新控制面：

## Transformation-Aware World State Runtime

```text
Camera / RGB-D / Video / Audio
↓
Observation Event
↓
Persistent Entity Resolver
↓
Pre-State Snapshot
↓
Continuous Dynamics Tracker
↓
Event Boundary Detector
↓
Transformation Hypothesis Generator
├ STATE_UPDATE
├ SPLIT
├ MERGE
├ PART_DETACH
├ PART_ATTACH
├ MATERIAL_TRANSFER
├ CREATE
└ DESTROY
↓
Action / Contact / Tool Context
↓
Post-State Entity Resolver
↓
Invariant & Conservation Probes
├ count
├ geometry
├ volume proxy
├ topology
├ containment
├ attachment
├ support/contact
└ role continuity
↓
Transformation Certificate
↓
Entity Lineage Graph Commit
↓
World State Registry
↓
Memory / KG / Planner / VLA
↓
Action
↓
Verification
↺
```

---

# Bottom-Level Logic

## 1. Entity state 不應是單一 mutable record

建議：

```text
EntityStateVersion
├ entity_id
├ state_version
├ valid_from
├ valid_to?
├ pose
├ geometry
├ parts[]
├ material_state?
├ relations[]
├ affordances[]
├ visibility
├ confidence
├ evidence_root_ids[]
├ caused_by_event_id?
└ supersedes_state_version?
```

## 2. Transformation event

```text
TransformationEvent
├ event_id
├ event_type
├ start_time
├ end_time
├ actor_ids[]
├ tool_ids[]
├ input_entity_ids[]
├ output_entity_ids[]
├ action_label
├ contact_evidence[]
├ before_state_versions[]
├ after_state_versions[]
├ invariant_checks[]
├ confidence
└ certificate_id
```

## 3. Lineage edge

```text
EntityLineageEdge
├ parent_entity_id
├ child_entity_id
├ transformation_event_id
├ lineage_type
│  ├ CONTINUES_AS
│  ├ SPLIT_INTO
│  ├ MERGED_INTO
│  ├ PART_OF_RESULT
│  ├ DETACHED_FROM
│  ├ ATTACHED_TO
│  ├ MATERIAL_FROM
│  └ CREATED_FROM
├ material_fraction_estimate?
├ geometric_overlap?
├ semantic_support
├ physical_support
└ uncertainty
```

## 4. Identity update rule（工程建模）

```text
if topology_same
and object_count_same
and continuity_high
and transformation_is_reversible_state_change:
    CONTINUES_AS same PersistentEntityID

elif one_input → multiple_outputs:
    terminate current state
    preserve parent lineage
    mint child PersistentEntityIDs

elif multiple_inputs → one_output:
    mint / resolve merged entity
    connect all parents

elif evidence insufficient:
    DO NOT force identity commit
    create TransformationHypothesisSet
    request active perception / verification
```

這是本輪提出的工程 runtime 規則，不是既有論文的標準演算法。

---

# 與 World Model 的連接

真正的 world model state transition 應逐步變成：

```text
Belief_t
+
Action_t
+
Entity Lineage_t
↓
World Transition Model
↓
Distribution over:
    State_{t+1}
    Event_{t+1}
    EntityBirths
    EntityDeaths
    Split/Merge topology
    Relations_{t+1}
↓
Observation_{t+1}
↓
Posterior update
```

即：

```text
P(S_{t+1}, L_{t+1}, E_{t+1} | S_t, L_t, A_t)
```

其中：
- `S` = physical/semantic entity states
- `L` = entity lineage graph
- `E` = discrete transformation events
- `A` = action / interaction

### 關鍵新區分

```text
Pixel prediction
≠ State transition prediction

State transition prediction
≠ Entity lineage prediction

Entity lineage prediction
≠ Conservation validation
```

---

# Visual Simulation Idea

## **Entity Transformation & Lineage World Lab**

畫面左側播放真實/生成影片：

```text
APPLE #5
   ↓ CUT
 ┌───────┬───────┐
Slice #101   Slice #102
      + Core #103
```

時間軸：

```text
t0  apple intact
│
│ State v1
│
t1  knife contact
│   event probability .44
│
t2  cut boundary
│   event probability .93
│   TRANSFORMATION EVENT
│
t3  tracker loses original mask
│
t4  3 result tubelets discovered
│
t5  lineage committed
```

右側顯示：

```text
Transformation Hypotheses

SAME ENTITY     .04
SPLIT           .91
DESTROY+CREATE  .05

Invariant checks
material continuity    PASS
count                  1 → 3
volume proxy           0.94 retained
spatial continuity     PASS
temporal continuity    PASS
```

使用者可以切：

```text
RAW VIDEO
TRACK IDs
ENTITY IDs
STATE VERSIONS
EVENT BOUNDARIES
LINEAGE GRAPH
CONSERVATION CHECKS
WORLD MODEL PREDICTION
```

也可以直接改 action：

```text
CUT
PEEL
POUR
ASSEMBLE
BREAK
OPEN
CLOSE
ATTACH
DETACH
```

看 lineage topology 如何不同。

### 最具教育價值的一幕

```text
Before:
Object #5

After:
Object #5 not detected
```

傳統 tracker：

```text
LOST
```

Transformation-aware runtime：

```text
Object #5 terminated as intact-state entity
↓
Transformation CUT
↓
children #101 #102 #103
↓
material / event lineage preserved
```

這能直觀解釋：

> **「追蹤不到」不一定代表「物件消失」；也可能代表世界發生了 topology-changing transformation。**

---

# Code / GitHub

## RightNow-AI/hclsm

Repo: https://github.com/RightNow-AI/hclsm

本輪已實際深入的 directory：

```text
hclsm/
├ causality/
├ dynamics/
│  ├ event_detector.py      ← 本輪最值得讀
│  ├ hierarchy_manager.py
│  ├ level0_ssm.py
│  ├ level1_event.py
│  ├ level2_goal.py
│  └ temporal_unet.py
├ memory/
├ objects/
├ perception/
├ inference/
├ kernels/
├ training/
└ model.py
```

### 最值得 Hermes 吸收的部分

1. `event_detector.py`：continuous latent state → discrete event candidate。
2. `hierarchy_manager.py`：不同 temporal level 的 routing。
3. `level0_ssm.py`：continuous dynamics。
4. `level1_event.py`：event-scale dynamics。
5. `causality/`：object interaction graph 的下一輪深入入口。

## TubeletGraph

Project: https://tubelet-graph.github.io/  
Data: https://huggingface.co/datasets/yihongs/VOST-TAS

本輪確認 benchmark 結構具有：

```text
video_id / object_id
transform_idx
transform_start_frame
transform_end_frame
action_desc
result_obj_1_desc ... result_obj_n_desc
```

這很適合直接轉成 Hermes 的 `TransformationEvent + input/output entity lineage` 測試資料格式。

---

# Papers

## Paper A — Tracking and Understanding Object Transformations

- **Title**: Tracking and Understanding Object Transformations
- **Authors**: Yihong Sun, Xinyu Yang, Jennifer J. Sun, Bharath Hariharan
- **Institution**: Cornell University
- **Year**: 2025; arXiv v2 2026
- **Venue**: NeurIPS 2025
- **URL**: https://arxiv.org/abs/2511.04678
- **Code**: linked from project page
- **Dataset**: VOST-TAS
- **Architecture**: base tracker + overlooked tubelet recovery + semantic/proximity priors + transformation state graph
- **Contribution**: 定義 Track Any State，使 tracking 能穿越 object transformation。
- **Limitations**: 依賴 transformation-caused tracker failure 作為重要訊號，weak transformations temporal grounding 仍難。
- **改變了什麼**: object tracking → object lifecycle / lineage tracking。

## Paper B — ActWorld

- **Title**: ActWorld: From Explorable to Interactive World Model via Action-Aware Memory
- **Authors**: Zhexiao Xiong et al.
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2606.17730
- **Project**: https://interactwm.github.io/ActWorld/
- **Dataset**: 100K interaction videos / 40 action categories
- **Architecture**: autoregressive DiT + EAFR + ACHA + persistent event/object memory + camera conditioning
- **Contribution**: 解決長 rollout interaction 的 action-forgetting pathology。
- **Limitations**: persistent latent tokens 不等於 formal symbolic state / physical certificate。
- **改變了什麼**: recency memory → causal interaction-aware memory。

## Paper C — HCLSM

- **Title**: HCLSM: Hierarchical Causal Latent State Machines for Object-Centric World Modeling
- **Authors**: Jaber Jaber, Osama Jaber
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2603.29090
- **Code**: https://github.com/RightNow-AI/hclsm
- **Dataset**: PushT / Open X-Embodiment-derived setup
- **Architecture**: Slot/object representation + continuous SSM + event Transformer + goal Transformer + causal graph
- **Contribution**: 把物理 dynamics 的多時間尺度顯式分層。
- **Limitations**: object topology change / split-merge lineage 仍不是核心表示。
- **改變了什麼**: flat latent temporal model → hierarchical event-aware state machine。

## Paper D — Vision Language Models Cannot Reason About Physical Transformation

- **Title**: Vision Language Models Cannot Reason About Physical Transformation
- **Authors**: Dezhi Luo et al.
- **Year**: 2026
- **Venue**: ICML 2026
- **URL**: https://arxiv.org/abs/2603.07109
- **Benchmark**: ConservationBench
- **Dataset / Evaluation**: 23,040 questions / 112 VLMs / four physical properties
- **Architecture**: benchmark rather than new model architecture
- **Contribution**: 顯示 current VLM 缺乏可靠 transformation-invariant physical representations。
- **Limitations**: controlled conservation setting，不涵蓋完整 real-world physics。
- **改變了什麼**: 對「VLM 看影片就懂物理變換」提供直接反證。

## Paper E — Closing the Loop in Humanoid VLA

- **Title**: Closing the Loop in Humanoid VLA: Persistent 3D Object Tokens for Verifiable Loco-Manipulation
- **Authors**: Peng Ren, Haoyang Ge, Jiang Zhao, Cong Huang, Yukun Shi, Pei Chi, Kai Chen
- **Affiliations surfaced in secondary source**: BUAA, BZA, TJU, DeepCybo, ZGCI
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2607.18016
- **Code**: not confirmed released in this round
- **Robot**: Unitree G1
- **Architecture**: RGB-D persistent role-indexed 3D object records → object tokens → whole-body action expert + geometric predicate supervisor
- **Contribution**: action generation 與 verification 共用同一 persistent object state。
- **Result**: 71/80 vs direct baseline 39/80 over eight real-world task families.
- **Limitations**: 仍以固定 role/object record 為核心，複雜 split/merge material lineage 不是主要目標。
- **改變了什麼**: implicit VLA grounding → explicit actionable + verifiable object state。

## Paper F — WorldLines

- **Title**: WorldLines: Benchmarking and Modeling Long-Horizon Stateful Embodied Agents
- **Authors**: Yehang Zhang et al.
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2606.18847
- **Framework**: ObsMem
- **Architecture**: visibility-aware memory + action-native state trails
- **Contribution**: 把 household action、feedback、object/device state changes 連成可追溯長期 world-state memory。
- **Limitations**: 主要處理 stateful household memory，不是 transformation physics engine。
- **改變了什麼**: dialogue-centric memory → embodied state history。

---

# Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Entity State Version
Transformation Event
Transformation Hypothesis
Entity Lineage Graph
Entity Birth
Entity Termination
Split Event
Merge Event
Part Detachment
Part Attachment
Material Transfer
Transformation Certificate
Conservation Probe
Transformation Invariant
Action-Native State Trail
Event Boundary
Continuous Dynamics State
Discrete Event State
Goal-Level State
Action-Forgetting Pathology
Persistent Event Token
Persistent Object-Identity Token
Object-State Divergence
World Transition Model
Lineage Prediction
Topology-Changing Transformation
```

## 新 Edges

```text
EntityStateVersion --CAUSED_BY→ TransformationEvent
TransformationEvent --CONSUMES→ Entity
TransformationEvent --PRODUCES→ Entity
Entity --SPLIT_INTO→ Entity
Entity --MERGED_INTO→ Entity
Part --DETACHED_FROM→ Entity
Part --ATTACHED_TO→ Entity
Material --TRANSFERRED_FROM→ Entity
Material --TRANSFERRED_TO→ Entity
Event --UPDATES→ WorldState
Action --CAUSES_CANDIDATE→ TransformationEvent
Observation --SUPPORTS→ TransformationHypothesis
ConservationProbe --VALIDATES→ TransformationCertificate
TransformationCertificate --AUTHORIZES→ LineageCommit
StateTrail --DESCRIBES_HISTORY_OF→ Entity
```

## 新否定關係

```text
Object Permanence ≠ Transformation Lineage
Persistent ID ≠ Immutable Entity
Track Loss ≠ Entity Destruction
Appearance Change ≠ New Entity
Same Material ≠ Same Entity
Same Concept ≠ Same Physical Instance
State Change ≠ Transformation Event
Transformation Event ≠ Goal Transition
Pixel Prediction ≠ Physical State Prediction
Physical State Prediction ≠ Lineage Prediction
VLM Description ≠ Physical Transformation Certificate
Recent Context ≠ Causally Important Context
Visual Realism ≠ Physical Validity
Action State ≠ Verification State unless explicitly shared
```

---

# Unknown / Open Questions

## 1. Identity preservation 的正式判準是什麼？

切開蘋果後：

```text
Apple #5
→ Slice #101
→ Slice #102
```

`Apple #5` 是：
- terminated entity？
- parent material entity？
- abstract aggregate identity？

不同任務可能需要不同 ontology。還缺一套 task-sensitive identity policy。

## 2. Material lineage 如何量化？

對 pour / mix / melt / dissolve：

```text
object-level ID
```

可能根本不夠，需要：

```text
material parcel / substance lineage
```

目前本輪仍只有 conceptual node，缺可部署 estimator。

## 3. World model 如何預測 topology-changing events？

現有 video diffusion 可以生成看似合理的切割、倒水，但：

```text
visual plausibility
≠
correct entity birth/death/lineage
```

還需要 object-topology-aware predictive benchmark。

---

# 下一輪研究

新的最深缺口是：

# **Material Identity × Conservation Law × Contact Graph × Physical Causal State**

因為本輪已把：

```text
Persistent Entity
→ Transformation Event
→ Lineage Graph
```

建立起來，但對以下情境仍不足：

```text
water poured A→B
flour mixed with water
ice melts
clay deforms
paper tears
liquid spills
parts assembled
battery inserted
object breaks
```

下一輪應深入：

```text
Rigid-body state
Deformable-body state
Material / substance identity
Mass / volume / count conservation
Contact graph
Support graph
Containment graph
Attachment graph
Force / impulse
Action-conditioned causal transition
Object-centric physics engines
Neural physics / differentiable simulation
Video world model physical alignment
World-model uncertainty
```

並比較：

```text
ABot-PhysWorld
Physical Object Understanding with a Physically Controllable World Model
Causal-JEPA
STICA
Embody4D
physics-native / Hamiltonian world-model directions
```

---

# 本輪結束回答

**缺哪一層？**  
Material / substance-level identity + physical conservation/control layer。

**哪個節點最淺？**  
`Material Transfer` 與 `Transformation Certificate`，目前仍缺成熟通用 estimator。

**哪個概念仍只是名詞？**  
Universal `EntityLineage ABI`、MaterialParcelID、Cross-Framework Transformation Certificate。

**哪個系統值得讀原始碼？**  
`RightNow-AI/hclsm`，下一步應深入 `causality/`、`objects/`、`hierarchy_manager.py` 與 `level1_event.py`；TubeletGraph exact public code repository 也值得下一輪定位並逐檔追。

**哪篇論文需追引用？**  
1. Tracking and Understanding Object Transformations / VOST-TAS  
2. ActWorld  
3. Vision Language Models Cannot Reason About Physical Transformation  
4. HCLSM  
5. Closing the Loop in Humanoid VLA

**哪個概念最適合視覺模擬？**  
`Entity Transformation & Lineage World Lab`：直接顯示 object 在 cut / merge / detach / pour 前後的 state、event、children/parents、conservation evidence。

**哪個 Agent 架構最值得實作？**

> **Transformation-Aware Embodied Agent Runtime = Persistent Entity Registry + Versioned Entity State + Multi-Scale Event Detector + Transformation Hypothesis Engine + Entity Lineage DAG + Conservation/Invariant Probes + Action-Native State Trail + Shared Action/Verification World State + Active Verification Gate**

---

# 本輪最核心的推進

從「AI 如何知道眼前還是同一個杯子」，推進到：

```text
AI 如何知道一個真實物件
經過 interaction 後
到底只是變了狀態，
還是已經拆成多個新實體、
與其他實體合成、
部分材料轉移、
或原 identity 已經終止？
```

最終完整 embodied chain 因此再多出一層：

```text
Camera / Image / Voice / Video
→ Encoder
→ Object Hypothesis
→ Persistent Entity
→ Versioned Physical State
→ Interaction / Action
→ Event Boundary
→ Transformation Hypothesis
→ Conservation / Invariant Verification
→ Entity Lineage Update
→ World Model Belief
→ Planner
→ Action
→ Verification
→ Memory / KG
```

**如果 Agent 沒有 transformation-aware lineage，它其實只是在追「畫面中的東西」；只有當它能表示 state transition、split/merge、part/material lineage、以及 action 前後的物理約束，它才開始真正維護一個會變化的世界。**
