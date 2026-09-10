# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 01:50 Asia/Taipei**  
**本輪主題：Cross-Modal Grounded Entity Identity × Object Permanence × 3D Re-Identification × Affordance Identity**

## 與歷史研究比較

上一輪已處理 Semantic Identity × Anchor Governance × Concept Drift × Ontology Migration，核心問題是「概念本身在不同版本中如何維持 semantic lineage」。本輪不再處理 ontology version，而往真實世界再下一層：**Camera 看到的一個物件、VLM 對它的描述、Memory 裡的 object record、3D scene graph node、語言中的『那個杯子』、以及 Robot/Tool 的 grasp target，到底如何被判定為同一個真實世界 entity？**

上一輪鏈：

```text
Representation
→ Semantic Identity Registry
→ Ontology Version Graph
→ Concept / Relation Migration
```

本輪補上：

```text
Camera / RGB-D / Video / Voice / Text
→ Detection / Segmentation
→ Geometry Lifting
→ Object Hypothesis
→ Data Association / Re-ID
→ Persistent World Entity ID
→ Object State / Relation / Affordance
→ Language Reference
→ Agent Memory / Planner
→ Tool / Robot Action Target
```

核心新結論：

> **Concept Identity ≠ Physical Entity Identity ≠ Observation Identity ≠ Affordance Identity。**

「杯子」是 ontology concept；桌面上的某個杯子是 persistent physical entity；Camera frame 42 裡的 mask_7 只是一次 observation；「可握的杯把」又是這個 entity 的 affordance region。四者不可共用同一種 ID。

---

# 本小時新發現

## 1. 新架構：EPOS-VLM 將 persistent object identity 直接放進 VLM autoregressive loop

論文：**Memory-Augmented Vision-Language Agents for Persistent and Semantically Consistent Object Captioning**  
Authors: Tommaso Galliena, Stefano Rosa, Tommaso Apicella, Pietro Morerio, Alessio Del Bue, Lorenzo Natale  
Institution: Italian Institute of Technology; University of Genoa  
Year: 2026  
URL: https://arxiv.org/abs/2603.24257  
Project: https://hsp-iit.github.io/epos-vlm/  
Code: https://github.com/hsp-iit/epos-vlm  
Dataset / Environment: Habitat, HM3D, Gibson  
Architecture: Qwen3-VL-2B + RGB observation + top-down explored map + serialized object episodic memory

EPOS-VLM 的重要性是它不再把 object association 當成外部固定 preprocessing，而是把以下三件事放到同一 autoregressive policy：

```text
Current RGB observation
+
Explored map
+
Object-level episodic memory
↓
VLM
↓
[MATCH] detection → persistent object ID / NEW_ID
+
Object caption
+
Navigation action
```

Object memory 被序列化成 object-level tokens（例如 scene/object/caption-history 結構），因此模型可以在新的 viewpoint 下使用歷史 object identity 和描述重新判斷當前 detection 是舊物件還是新物件。

論文/專案報告：相較 baseline，caption metrics 最高改善 +11.86%，同一物件跨視角 caption self-similarity 最高改善 +7.39%。

### 改變了什麼

傳統 pipeline：

```text
Detector
→ Re-ID
→ Memory
→ VLM Caption
```

EPOS-VLM：

```text
Detection + Memory + Exploration
→ one autoregressive policy
→ association + caption + action
```

### 限制

- 仍依賴 external segmenter。
- 主要在 simulated/static 3D environments 驗證。
- Persistent ID 是 learned data association result，不等於具有 formal identity certificate。
- 複雜動態遮擋、物體拆分/合併、多人移動與長期跨日 re-identification 仍未解決。

來源：
- https://arxiv.org/abs/2603.24257
- https://hsp-iit.github.io/epos-vlm/

---

## 2. System Architecture 深拆：Embodied VideoAgent Persistent Object Memory

論文：**Embodied VideoAgent: Persistent Memory from Egocentric Videos and Embodied Sensors Enables Dynamic Scene Understanding**  
Authors: Yue Fan, Xiaojian Ma, Rongpeng Su, Jun Guo, Rujie Wu, Xi Chen, Qing Li  
Institution: BIGAI / USTC / Tsinghua / Peking University  
Venue: ICCV 2025 Spotlight  
URL: https://embodied-videoagent.github.io/  
Code: https://github.com/Embodied-VideoAgent/embodied-videoagent

Architecture：

```text
Egocentric RGB Video
+
Depth
+
Camera 6D Pose
↓
Detector / Segmenter
↓
2D → 3D Lifting
↓
Object3D candidates
↓
Static / Dynamic classifier
↓
3D Re-ID
↓
Persistent Object Memory
├ ID + category
├ STATE
├ Related Objects
├ 3D bbox
├ Object visual feature
└ Context visual feature
↓
LLM Tools
├ query_db
├ temporal_loc
├ spatial_loc
└ vqa
↓
Embodied Action Primitives
```

官方 project page 報告在 Ego4D-VQ3D、OpenEQA、EnvQA 分別改善 4.9%、5.8%、11.7%，並展示被箱子遮住的 apple 仍可透過 persistent object memory 找回位置。

### 原始碼追蹤

值得看的核心檔案：

```text
object_memory.py
object3d.py
reid.py
control.py
llm_function.py
two_agent_pipeline.py
prompt/
env/
```

`object_memory.py` 實際初始化：

```text
YOLOWorld
SAM2
CLIP ViT-L/14
DINOv2 ViT-g/14
```

每 frame 的底層流程：

```text
RGB
↓
YOLOWorld detection
↓
SAM mask
↓
Object crop
├ CLIP feature
└ DINOv2 feature

Depth + Camera Pose + FOV
↓
Depth pixels → world XYZ
↓
mask ∩ valid-depth
↓
Object surface point cloud
↓
remove foreground/background outliers
↓
3D AABB min_xyz / max_xyz
↓
Object3D candidate
```

接下來：

```text
Existing objects
↓
check_dynamic()
├ Static objects
└ Dynamic objects

Static objects
→ static_object_reid()

Dynamic objects
→ dynamic_object_reid()
```

### Bottom-level Re-ID mechanism

Static Re-ID 主要依賴 3D spatial overlap：

```text
IoU(object_new, object_old)
MaxIoS(object_new, object_old)
Category match
↓
weighted bipartite graph
↓
NetworkX max_weight_matching
```

Dynamic Re-ID 則改用：

```text
Visual similarity
+
3D volume similarity
↓
threshold gate
↓
max-weight bipartite matching
```

原始碼中：

```text
visual_similarity
= 0.15 × transformed_CLIP_similarity
+ 0.85 × DINOv2_cosine
```

並要求：

```text
visual_similarity >= 0.45
AND
bbox_volume_similarity >= 0.7
```

`Object3D.merge()` 再以 moving-average-style ratio（預設 0.2）更新 bbox、CLIP、DINOv2 與 context feature。

### 為什麼重要

這是很好的 Hermes bottom-level reference，因為 persistent identity 並不是：

```text
VLM says "same cup"
→ same ID
```

而是至少需要：

```text
Appearance
+
Geometry
+
Temporal continuity
+
Motion state
+
Assignment constraint
```

共同決定。

### 限制

- threshold 是 engineering constants，不是 calibrated posterior。
- AABB/volume similarity 對 deformable object、旋轉、部分遮擋可能弱。
- Visual similarity 仍受 viewpoint、lighting、occlusion、encoder drift 影響。
- max-weight matching 強迫 pairwise assignment，無法自然表達 SPLIT/MERGE/UNCERTAIN identity hypotheses。
- Persistent ID 缺乏 provenance/evidence graph。

來源：
- https://embodied-videoagent.github.io/
- https://github.com/Embodied-VideoAgent/embodied-videoagent

---

## 3. 新 bottom-level mechanism：Object Permanence 應建模成 latent entity persistence，而不是 visibility persistence

真正的 object permanence 不應是：

```text
visible(object) = false
→ object deleted
```

而是：

```text
Entity existence belief
+
last known pose
+
motion model
+
occlusion hypothesis
+
interaction history
+
scene constraints
→ predicted latent state while unobserved
```

所以：

```text
Not Visible ≠ Does Not Exist
Not Detected ≠ Object Removed
Different View ≠ New Entity
Same Category ≠ Same Entity
```

對 Hermes，PersistentWorldEntity 建議至少包含：

```text
PersistentWorldEntity
├ entity_id
├ ontology_concept_id
├ existence_belief
├ pose_belief
├ geometry_state
├ appearance_state
├ dynamic_state
├ affordance_state
├ relation_state
├ observation_ids[]
├ evidence_root_ids[]
├ identity_hypotheses[]
├ last_observed_at
├ occlusion_state
├ motion_model
├ lineage
└ identity_certificate
```

當物件離開視野：

```text
Last observation
↓
Motion / world-model prediction
↓
Occlusion-aware existence belief
↓
Future detection
↓
Association likelihood
↓
Posterior identity update
```

這比只把最後一張 image embedding 存進向量資料庫更接近 persistent world model。

Embodied VideoAgent 的實作已提供這個方向的工程證據：它將 3D bounding box、visual/context features 與 dynamic/static object lists 保存於 object memory；EPOS-VLM 則從另一方向證明 object-level episodic history 可以直接提升跨 viewpoint semantic consistency。

---

## 4. 新 3D identity mechanism：EmbodiedSAM 展示「2D mask → persistent 3D query → cross-view matching」

論文：**EmbodiedSAM: Online Segment Any 3D Thing in Real Time**  
Authors: Xiuwei Xu, Huangxing Chen, Linqing Zhao, Ziwei Wang, Jie Zhou, Jiwen Lu  
Institution: Tsinghua University / Nanyang Technological University  
Venue: ICLR 2025 Oral  
URL: https://arxiv.org/abs/2408.11811  
Project: https://xuxw98.github.io/ESAM/  
Code: https://github.com/xuxw98/ESAM  
Datasets: ScanNet, ScanNet200, SceneNN, 3RScan

核心流程：

```text
Streaming RGB-D frame
↓
SAM 2D masks
↓
Geometric-aware query lifting
↓
3D-aware object queries
↓
Dual-level query decoder
↓
Fine-grained point-wise 3D masks
↓
Cross-view query similarity matrix
↓
Fast query merging
↓
Persistent online 3D instances
```

這對 Entity Identity 的最大啟發是：

> **跨視角 identity 不必只能在 image embedding 層做 matching，也可以把 object representation 先提升到 3D query/state，再做 temporal association。**

專案報告 ESAM 在 ScanNet200 的 AP/AP50/AP25 為 13.7/19.2/23.9，對照其列出的 SAI3D 9.6/14.7/19.0；並強調 streaming setting 中未來 frames 不可用，因此更接近 embodied runtime。

### 限制

- instance segmentation identity 仍不等於 semantic/functional identity。
- 同一物件發生外觀、形狀或部件狀態改變時，query merge 仍可能錯配。
- 3D instance ID 未直接解決「語言指稱→實體→affordance region→action」的完整鏈。

來源：
- https://xuxw98.github.io/ESAM/
- https://github.com/xuxw98/ESAM

---

## 5. Affordance Identity：『同一物件』還不夠，Agent 必須知道『要作用在哪一部分』

物理 Agent 的 target identity 至少有三層：

```text
Object Identity
↓
Part Identity
↓
Affordance Identity
```

例如：

```text
Cup #17
├ body
├ rim
└ handle
   └ affordance: GRASP
```

因此：

```text
Correct object
≠
Correct action target
```

2026 年的 **CompassAD: Intent-Driven 3D Affordance Grounding in Functionally Competing Objects** 專門研究多個物件擁有相似 affordance 時，如何依自然語言 intent 選到正確 object/region。其 CompassAD benchmark 包含 30 組 confusing object pairs、16 種 affordance、6,422 scenes、88K+ query-answer pairs；CompassNet 使用 Instance-bounded Cross Injection 限制語言—幾何訊息在 instance 邊界內流動，降低跨物件 semantic leakage，並以 Bi-level Contrastive Refinement 強化 object/point discrimination。

論文：
- https://arxiv.org/abs/2604.02060

2026 **VideoAfford** 更指出 affordance 不只是靜態外觀，而可從 human-object interaction 的時間/動作線索取得。其 VIDA dataset 包含約 38K HOI videos、16 affordance types、38 object categories、22K point clouds，並使用 latent action encoder + spatial-aware loss 將 dynamic interaction prior 投入 3D affordance grounding。

論文：
- https://arxiv.org/abs/2602.09638

2026-08 的 **AffordAny** 再將問題推向 open-world、monocular RGB：由單張 RGB 建立 text-conditioned 3D part supervision，凍結 VLM feature 後透過 spatial projection、instruction-conditioned semantic compression、geometry-semantics interaction 做 affordance grounding。公開摘要報告 benchmark 有 5,334 objects、10,633 part-level samples、473 categories；self-training 後 unseen-object IoU 0.428、unseen-category IoU 0.315。

論文：
- https://arxiv.org/abs/2608.20720

這些結果共同支持：

```text
Physical Entity ID
→ Part Graph
→ Task-conditioned Affordance ID
→ Action Target
```

不能直接：

```text
Object label
→ Action
```

---

# 本小時最重要 5 個發現

## 發現一：Persistent Identity 必須是 latent world entity，不是 frame-level detection ID

### 是什麼

每一幀的 `mask_7`、`bbox_4` 都只是 observation-local identifier。

### 底層如何運作

```text
Detection
↓
Feature extraction
├ appearance
├ geometry
├ context
└ category
↓
Temporal prediction
↓
Candidate old entities
↓
Association likelihood
↓
Assignment / hypothesis update
↓
Persistent entity ID
```

### 為什麼重要

如果 Agent 把 observation ID 當 entity ID：

```text
Frame 41 cup_2
Frame 42 cup_5
```

Memory 會錯誤建立兩個杯子，導致計數、導航、語言 referent 與 robot target 全部漂移。

### 限制

目前多數實作仍以 heuristic threshold / matching 取代 calibrated belief over identity hypotheses。

---

## 發現二：Cross-modal identity 應以 evidence fusion 做，而不是讓單一 VLM 決定

Hermes 建議：

```text
P(E_j = detection_i | evidence)
∝
Appearance likelihood
× Geometry likelihood
× Motion likelihood
× Context likelihood
× Semantic likelihood
× Relation consistency
× Action-history consistency
```

實務上不一定真能假設各 evidence independent，因此上式只應視為工程 factorization 起點。

應保存：

```text
IdentityHypothesis
├ candidate_entity_id
├ appearance_score
├ geometry_score
├ motion_score
├ context_score
├ semantic_score
├ relational_score
├ action_consistency
├ contradiction_count
├ calibrated_identity_probability
└ evidence_root_ids[]
```

### 核心否定

```text
VLM agreement ≠ Entity identity proof
High cosine ≠ Same object
3D overlap ≠ Same object
Same category ≠ Same object
```

---

## 發現三：Object Permanence 是 belief maintenance 問題

### 正確 loop

```text
Observed Entity
↓
World State
↓
Object becomes occluded
↓
Existence remains latent
↓
Predict pose/state distribution
↓
New evidence appears
↓
Re-identification
↓
Posterior state correction
```

所以它和前幾輪研究的 POMDP / Belief State 正式接上：

```text
Object identity
⊂
Belief state over world entities
```

而不是 object tracker 的附加欄位而已。

---

## 發現四：Object identity 和 affordance identity 必須分層

語言：

```text
「拿起杯子」
```

不能只解析成：

```text
TARGET = Cup#17
```

真正 execution 需要：

```text
Intent: PICK_UP
↓
Object: Cup#17
↓
Candidate parts
├ body
├ rim
└ handle
↓
Affordance: graspable region
↓
Pose / contact constraints
↓
Robot end-effector target
```

### 為什麼重要

Tool Agent 也存在同構結構：

```text
Tool identity
→ Argument identity
→ Effect affordance
```

例如 browser button、file path、recipient/account 都是「作用在哪一個實體/部件」的問題。

---

## 發現五：Persistent World Entity 應成為 Hermes 中間層 ABI

本輪提出工程建模：

```text
Observation
≠ Entity

Entity
≠ Concept

Entity
≠ Affordance

Affordance
≠ Action
```

因此 Hermes 可以新增：

```text
ObservationID
PersistentEntityID
SemanticConceptID
PartID
AffordanceID
ActionTargetID
```

並用 typed edges 串接：

```text
OBSERVES
ASSOCIATES_WITH
INSTANCE_OF
HAS_PART
AFFORDS
TARGETS
OCCLUDED_BY
MOVED_BY
STATE_CHANGED_BY
```

---

# Architecture Breakdown

## Grounded Persistent World Model

```text
Camera / Video / RGB-D / Depth / Voice / Text
                    ↓
              Sensor Adapters
                    ↓
          Observation Event Envelope
                    ↓
       Detection / Segmentation / ASR
                    ↓
        Observation-local Hypotheses
                    ↓
             Geometry Lifting
          2D mask → 3D object state
                    ↓
             Feature Extraction
     appearance / geometry / context / text
                    ↓
            Motion / Occlusion Model
                    ↓
             Entity Resolver
        ┌───────────┼────────────┐
        ↓           ↓            ↓
     MATCH       NEW ENTITY    UNCERTAIN
        ↓           ↓            ↓
         Persistent World Entity Registry
                    ↓
              Entity State Graph
      ┌─────────────┼──────────────┐
      ↓             ↓              ↓
   Ontology        Parts        Relations
      ↓             ↓              ↓
 Concept ID      Affordances     Scene Graph
       \            |             /
        \           |            /
              Language Grounder
                    ↓
                Planner
                    ↓
             Action Targeter
                    ↓
      MCP / Browser / Robot / Tool
                    ↓
                World Change
                    ↓
              New Observation
                    ↺
```

---

# Bottom-Level Logic

## Entity association loop

```text
1. Acquire RGB / depth / camera pose
2. Detect candidate regions
3. Segment object masks
4. Lift pixels into world coordinates
5. Build candidate 3D geometry
6. Extract appearance embeddings
7. Predict old entity state to current time
8. Gate impossible matches by geometry/motion/category
9. Compute multi-evidence association scores
10. Solve assignment OR maintain multiple hypotheses
11. Update persistent entity posterior
12. Merge appearance/geometry/state evidence
13. Preserve provenance and observation lineage
14. Update scene relations and affordance state
15. Expose entity to Memory/Planner/Tool target resolver
```

### Hermes 不應停在 hard matching

Embodied VideoAgent：

```text
if score >= threshold:
    merge
```

Hermes 長期更適合：

```text
Detection D17
├ Entity E3    p=.62
├ Entity E8    p=.31
└ NEW          p=.07
```

若 action risk 很高：

```text
Identity entropy high
↓
Epistemic Controller
↓
MOVE CAMERA / ASK / RE-SCAN / DEPTH CHECK
↓
new observation
↓
identity posterior update
```

這就把本輪與之前的 Value-of-Information research 接起來。

---

# Visual Simulation Idea

## Persistent Entity & Object Permanence Lab

畫面中央是一個真實世界 entity：

```text
               ENTITY #17
               "red mug"

Camera F41 ───────┐
mask_2            │
                  ├──→ Persistent Entity #17
Camera F42 ───────┤
mask_7            │
                  │
Voice ────────────┤
"那個紅杯子"       │
                  │
Memory object:17 ─┘

3D Node #88 ─────────→ Entity #17
Robot target #5 ─────→ handle@Entity#17
```

可切換：

```text
OBSERVATION IDS
ENTITY IDS
CONCEPT IDS
PART IDS
AFFORDANCE IDS
```

### Object Permanence 模擬

時間線：

```text
t0   visible       p(exists)=.99
     ↓
t1   moves behind box
     ↓
t2   occluded      p(exists)=.97
     predicted pose ellipse expands
     ↓
t3   no detection  p(exists)=.92
     ↓
t4   new detection candidate
     E17=.58 / E23=.34 / NEW=.08
     ↓
t5   camera move
     ↓
t6   E17=.96
```

UI 讓使用者調：

```text
Appearance Weight
3D Geometry Weight
Motion Prior
Occlusion Probability
Category Constraint
Relation Consistency
Identity Threshold
New-Entity Prior
```

然後注入：

```text
OCCLUSION
LIGHTING CHANGE
OBJECT MOVED
SAME-CATEGORY DISTRACTOR
PARTIAL VIEW
CAMERA POSE ERROR
VLM MISLABEL
DEPTH NOISE
OBJECT STATE CHANGE
```

讓使用者看到：

```text
High appearance similarity
但 geometry impossible
→ DO NOT MATCH
```

或：

```text
Low appearance similarity
但 continuous trajectory + same 3D volume + occlusion event
→ MAY STILL BE SAME ENTITY
```

### Affordance view

點 Entity #17：

```text
Cup #17
├ Body
│  └ support / contain
├ Rim
│  └ pour interface
└ Handle
   └ grasp
```

再選 task：

```text
PICK UP
→ Handle highlighted

POUR WATER
→ Rim + pose constraints highlighted
```

可直接解釋：

> **AI 不只要回答「這是什麼」，還必須知道「它是不是剛才那一個」、「它現在在哪」、「哪一部分可以做什麼」、「這次動作到底要作用在哪」。**

---

# Code / GitHub

## Embodied VideoAgent

Repo: https://github.com/Embodied-VideoAgent/embodied-videoagent

優先閱讀：

```text
object_memory.py
reid.py
object3d.py
utils.py
control.py
two_agent_pipeline.py
```

### `object_memory.py`

負責：

```text
RGB-D frame
→ detection
→ segmentation
→ CLIP/DINO features
→ world-coordinate lifting
→ Object3D creation
→ static/dynamic split
→ re-ID
→ object merge
→ memory
```

### `reid.py`

負責：

```text
static_object_reid()
dynamic_object_reid()
split_static_dynamic_objects()
remove_duplicate_objects()
```

特別值得看的是 max-weight bipartite matching，以及 static/dynamic 使用不同 association features。

### `object3d.py`

負責：

```text
Object identity
3D bbox
Position
CLIP feature
DINOv2 feature
Context feature
Spatial IoU
MaxIoS
Volume similarity
Moving-average merge
```

## EmbodiedSAM

Repo: https://github.com/xuxw98/ESAM

值得追：

```text
SAM 2D masks
→ geometric-aware query lifting
→ dual-level decoder
→ 3D query matching
→ fast query merging
```

## EPOS-VLM

Repo reported by official project:
https://github.com/hsp-iit/epos-vlm

本輪 GitHub connector 無法直接取回該 repo content，因此本輪只把官方 project page / arXiv 已公開的 architecture 與結果視為 confirmed；**未把未讀到的 repository internals 假裝成已確認原始碼事實。**

---

# Papers

## Paper A

**Title:** Memory-Augmented Vision-Language Agents for Persistent and Semantically Consistent Object Captioning  
**Authors:** Tommaso Galliena, Stefano Rosa, Tommaso Apicella, Pietro Morerio, Alessio Del Bue, Lorenzo Natale  
**Institution:** Italian Institute of Technology; University of Genoa  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2603.24257  
**Code:** https://github.com/hsp-iit/epos-vlm  
**Dataset:** HM3D / Gibson, Habitat  
**Architecture:** Qwen3-VL-2B + RGB + top-down map + serialized object episodic memory → match/caption/action  
**Contribution:** 將 data association、persistent caption semantics、exploration policy 統一於一個 autoregressive model。  
**Limitations:** external segmentation；simulated/static environments；未提供 formal identity uncertainty certificate。

## Paper B

**Title:** Embodied VideoAgent: Persistent Memory from Egocentric Videos and Embodied Sensors Enables Dynamic Scene Understanding  
**Authors:** Yue Fan, Xiaojian Ma, Rongpeng Su, Jun Guo, Rujie Wu, Xi Chen, Qing Li  
**Institution:** BIGAI / USTC / Tsinghua / Peking University  
**Year/Venue:** ICCV 2025 Spotlight  
**URL:** https://embodied-videoagent.github.io/  
**Code:** https://github.com/Embodied-VideoAgent/embodied-videoagent  
**Architecture:** RGB + depth + pose → persistent object memory + tools + LLM + embodied actions  
**Contribution:** 動態 3D scene memory、persistent object state、object re-ID 與 embodied tool use。  
**Limitations:** hand-designed thresholds、bbox simplification、limited uncertainty representation。

## Paper C

**Title:** EmbodiedSAM: Online Segment Any 3D Thing in Real Time  
**Authors:** Xiuwei Xu, Huangxing Chen, Linqing Zhao, Ziwei Wang, Jie Zhou, Jiwen Lu  
**Institution:** Tsinghua University / NTU  
**Venue:** ICLR 2025 Oral  
**URL:** https://arxiv.org/abs/2408.11811  
**Code:** https://github.com/xuxw98/ESAM  
**Datasets:** ScanNet, ScanNet200, SceneNN, 3RScan  
**Architecture:** SAM mask → geometric-aware query lifting → dual-level decoder → cross-view query merge  
**Contribution:** streaming, online, real-time 3D instance segmentation and cross-view matching。  
**Limitations:** instance persistence 不等同 semantic/functional identity。

## Paper D

**Title:** CompassAD: Intent-Driven 3D Affordance Grounding in Functionally Competing Objects  
**Authors:** Jingliang Li et al.  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2604.02060  
**Dataset:** CompassAD, 6,422 scenes / 88K+ QA / 30 confusing pairs / 16 affordances  
**Architecture:** Instance-bounded Cross Injection + Bi-level Contrastive Refinement  
**Contribution:** 讓 Agent 不只找 affordance，還要在多個可執行相同行為的物件中依 intent 選對 object。  
**Limitations:** benchmark-based affordance grounding，仍不等於長期 persistent identity。

## Paper E

**Title:** VideoAfford: Grounding 3D Affordance from Human-Object-Interaction Videos via Multimodal Large Language Model  
**Authors:** Hanqing Wang et al.  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2602.09638  
**Dataset:** VIDA — 38K HOI videos / 16 affordances / 38 categories / 22K point clouds  
**Architecture:** MLLM + latent action encoder + spatial-aware 3D affordance learning  
**Contribution:** 將 temporal interaction dynamics 變成 affordance supervision。  
**Limitations:** affordance learning 不直接處理 persistent entity lineage。

## Paper F

**Title:** AffordAny: Open-World 3D Affordance Grounding from Monocular RGB Images via Vision-Language-Guided Geometric Reasoning  
**Authors:** Junqi Wu, Kaihua Tang, Xuanwen Chen, Hongzhi Li, Jianqiang Huang, Xian-Sheng Hua  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2608.20720  
**Architecture:** monocular RGB → frozen VLM features → spatial projection → semantic compression → geometry-semantics interaction → pseudo-label self-training  
**Contribution:** 由 raw RGB 推到 open-world 3D affordance，而不是要求 pre-built 3D CAD/closed taxonomy。  
**Limitations:** inferred geometry 仍可能產生 grounding error；不是 persistent multi-frame object identity system。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Physical Entity Identity
Persistent World Entity
Persistent Entity ID
Observation-local ID
Object Hypothesis
Identity Hypothesis
Identity Posterior
Object Permanence
Occlusion State
Existence Belief
Pose Belief
Motion Model
3D Re-Identification
Static Object Re-ID
Dynamic Object Re-ID
Appearance Evidence
Geometry Evidence
Context Evidence
Relation Consistency
Entity Resolver
Entity Registry
Object Part Identity
Affordance Identity
Affordance Region
Action Target ID
Grounded Referential Identity
Cross-Modal Entity Grounding
Object Lineage
Identity Certificate
```

## Edges

```text
Observation --OBSERVES→ Physical Entity
ObservationID --ASSOCIATES_WITH→ PersistentEntityID
PersistentEntity --INSTANCE_OF→ SemanticConcept
PersistentEntity --HAS_PART→ ObjectPart
ObjectPart --AFFORDS→ Affordance
Action --TARGETS→ AffordanceRegion
Entity --OCCLUDED_BY→ Entity
Entity --MOVED_BY→ Action
Entity --STATE_CHANGED_BY→ Action
Detection --SUPPORTED_BY→ EvidenceRoot
IdentityHypothesis --SUPPORTED_BY→ AppearanceEvidence
IdentityHypothesis --SUPPORTED_BY→ GeometryEvidence
IdentityHypothesis --CONTRADICTED_BY→ MotionEvidence
LanguageReferent --REFERS_TO→ PersistentEntity
MemoryRecord --DESCRIBES→ PersistentEntity
3DSceneNode --REPRESENTS→ PersistentEntity
RobotTarget --GROUNDS_TO→ AffordanceRegion
```

## 新增否定關係

```text
Observation ID ≠ Entity ID
Concept ID ≠ Entity ID
Entity ID ≠ Affordance ID
Object label ≠ Physical identity
Not visible ≠ Does not exist
Not detected ≠ Removed from world
Same category ≠ Same entity
High appearance similarity ≠ Same entity
3D overlap ≠ Same entity
VLM agreement ≠ Identity proof
Correct object ≠ Correct action region
Persistent ID ≠ Certain identity
Cross-view segmentation ≠ Semantic object permanence
```

---

# 已確認事實 / 工程實作 / 合理推論 / 尚未驗證

## 已確認論文/官方資訊

- EPOS-VLM 將 object episodic memory、data association、captioning 與 navigation action 聯合建模。
- Embodied VideoAgent 使用 egocentric video + depth + camera pose 建 persistent object memory。
- EmbodiedSAM 使用 2D SAM masks、3D-aware query lifting、dual-level decoder 與 cross-view query merging。
- CompassAD 專門處理 intent-conditioned multi-object affordance ambiguity。
- VideoAfford 使用 HOI video dynamic interaction prior 進行 3D affordance grounding。
- AffordAny 處理 monocular/open-world 3D affordance grounding。

## 已確認工程實作

Embodied VideoAgent source code：

```text
YOLOWorld detection
SAM segmentation
CLIP + DINOv2 object features
Depth-to-world transformation
3D AABB
static/dynamic split
NetworkX max-weight matching
static spatial overlap matching
dynamic appearance + volume matching
moving-average object merge
```

## 合理工程推論 / 本輪建模

以下不是現有單篇論文標準：

```text
PersistentWorldEntity ABI
IdentityHypothesis object
Identity Certificate
ObservationID / EntityID / PartID / AffordanceID 分層
Existence-belief object permanence controller
Identity entropy → Value-of-Information active perception
```

這些是把前幾輪 Belief State、VoI、Risk Certificate、Semantic Identity 與本輪 embodied object identity 統一後提出的 Hermes Runtime architecture。

## 尚未驗證假說

1. 一個統一 `PersistentWorldEntity` ABI 是否能同時覆蓋 browser DOM element、filesystem object、MCP resource 與 physical robot object？
2. 對高風險 action 而言，identity posterior 是否能被 conformal calibration 成具有可靠 coverage 的 Action Target Certificate？
3. Semantic/geometry/appearance/motion evidence 的最佳融合方式應是 factor graph、neural association model、Bayesian filter，還是 hybrid symbolic-neural model？

---

# Unknown / Open Questions 1–3

## 1. Entity Split / Merge

如果一個 physical object 被拆成兩半：

```text
Entity E17
→ E18 + E19 ?
```

是同一 identity 的 descendants，還是兩個全新 entities？需要 Physical Entity Lineage DAG。

## 2. Identity under transformation

杯子翻面、變髒、被貼標籤、裝水、破損後，哪些 attribute 變化仍保留 entity identity？需要區分：

```text
state change
appearance change
part change
identity break
```

## 3. Cross-domain grounded identity

Browser DOM、MCP resource、database row、file、3D object 是否能用同一套 resolver abstraction？它們的 evidence model 不同，但可能共享：

```text
stable entity
observations
version/state
relations
affordances/effects
```

---

# 下一輪研究

下一輪最深缺口：

# **Entity State Transition × Physical Transformation × Identity Preservation × Split/Merge Lineage**

因為本輪可以回答：

```text
「不同觀察是不是同一個東西？」
```

但還沒有完整回答：

```text
「東西被改變到什麼程度，還算同一個東西？」
```

下一輪應研究：

```text
Entity state transition
Object transformation invariants
Conservation / permanence
Part attachment-detachment
Object split / merge
Container transfer
Ownership / possession state
State transition graph
Physical identity lineage
Transformation-aware Re-ID
Action-conditioned prediction
VLM physical transformation failure
World-model state update
```

值得特別追 2026 ConservationBench 對 VLM physical transformation reasoning 的結果，以及 object-centric world model / dynamic scene graph / neural object representation 的最新工作。

---

# 每輪結束固定回答

**缺哪一層：** Transformation-aware Physical Entity Lineage / State Transition Kernel。  
**哪個節點最淺：** calibrated multi-evidence `Identity Posterior`，尤其 occlusion + dynamic object + same-category distractor 情境。  
**哪個概念仍只是名詞：** Universal PersistentWorldEntity ABI、Identity Certificate、Action Target Certificate。  
**哪個系統最值得讀原始碼：** `Embodied-VideoAgent/embodied-videoagent` 的 `object_memory.py`, `reid.py`, `object3d.py`，其次 `xuxw98/ESAM` 的 3D query lifting/merging。  
**哪篇論文需追引用：** EPOS-VLM、Embodied VideoAgent、EmbodiedSAM；affordance 線追 CompassAD / VideoAfford / AffordAny。  
**哪個概念最適合視覺模擬：** Persistent Entity & Object Permanence Lab。  
**哪個 Agent 架構最值得實作：**

> **Grounded Persistent-Entity Agent Runtime = Observation Envelope + 2D/3D Lifting + Multi-Evidence Re-ID + Persistent Entity Registry + Belief-Based Object Permanence + Part/Affordance Graph + Referential Grounding + Action-Target Gate**

---

# 本輪核心結論

> **要回答「AI 到底怎麼運作」，多模態鏈不能停在 Camera → Encoder → Tokens → VLM。真正進入 Agent 世界模型後，系統還必須把每次短暫 observation 組成 persistent entity：知道這是不是剛才那個物件、被遮住後是否仍存在、狀態是否改變、語言中的『它』指的是誰、哪一個 part 提供哪個 affordance，以及 Tool/Robot 最終到底要作用在真實世界的哪一個 target。Persistent Entity Identity 是從感知走向行動之間不可缺的中間層。**