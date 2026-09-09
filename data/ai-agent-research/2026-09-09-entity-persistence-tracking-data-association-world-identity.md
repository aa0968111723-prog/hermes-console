# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 14:56（Asia/Taipei）**

## 本小時新發現

本輪承接上一輪 `Multimodal Episodic Memory × Spatiotemporal Addressing × Memory Write Policy`，不再重複 Memory namespace，而是補最深缺口：`Observation → Persistent Entity ID → Episode Boundary → World-State Identity`。

本輪主題：**Entity Persistence × Multi-Object Tracking × Data Association × Streaming Memory × Embodied Object Identity**。

核心新發現：

1. 「同一個物體」不是 VLM 自然就知道的語意，而是 detection / segmentation、motion prediction、appearance/geometry matching、track state、memory update 共同形成的 runtime 結果。
2. ByteTrack 證明低 confidence detection 不應直接丟掉；被遮擋的真實物體常落在低分 detection 中，第二階段 association 可以恢復 identity。
3. SAM 2 顯示另一種 object-persistence topology：current features 不只看當前 frame，而是 cross-attend streaming memory，且 memory 中可包含 object pointer tokens。
4. 2026 EPOS-VLM 將 persistent object ID、caption history、3D position serialized 成 object-level episodic tokens，並讓同一個 autoregressive VLM 同時預測 data association、caption、action。
5. 對 Agent memory 而言，`Track ID`、`Semantic Entity ID`、`World Object ID` 必須區分；短期 tracker ID 可能在 occlusion/re-entry 後斷裂，而 persistent agent identity 需要跨 episode / viewpoint / observation version 的 re-identification 與 belief revision。

---

## 本小時最重要 5 個發現

### 1. Persistent Entity ID 是一個 state machine，不是一個 embedding label

**已確認工程實作：ByteTrack**

ByteTrack source 中每個 `STrack` 具有：

```text
track_id
state
frame_id
start_frame
tracklet_len
mean / covariance
score
```

並且 state 至少經過：

```text
NEW
↓ activate
TRACKED
↓ unmatched
LOST
↓ match again
RE-ACTIVATE
↓ too long missing
REMOVED
```

核心 loop：

```text
Detections
↓
High-score detections
↓
Tracked + Lost track pool
↓
Kalman predict
↓
IoU distance / score fusion
↓
Linear assignment
↓
Matched → update / reactivate
↓
Unmatched tracked
↓
Second association with low-score detections
↓
Still unmatched → LOST
↓
Unmatched high-score detection → NEW TRACK
```

來源：
- Paper: ByteTrack: Multi-Object Tracking by Associating Every Detection Box, ECCV 2022
  https://www.ecva.net/papers/eccv_2022/papers_ECCV/html/315_ECCV_2022_paper.php
- Code: `FoundationVision/ByteTrack/yolox/tracker/byte_tracker.py`
  https://github.com/FoundationVision/ByteTrack/blob/main/yolox/tracker/byte_tracker.py

**為什麼重要：**
Agent 若只把「目前 detector 看見的 boxes」當 world state，遮擋一次就會把同一物體變成新物體。Persistent entity 必須存在於 observation 之外。

**限制：** ByteTrack 的 baseline association 很依賴 motion/IoU 與短時間 continuity；對長時間消失、跨房間、強 viewpoint change、外觀相似物體，不等於真正 semantic object permanence。

---

### 2. `Low detection confidence ≠ entity disappeared`

ByteTrack 的關鍵不是更大的 detector，而是重新定義 association policy：

```text
Detector Score High
→ first association

Detector Score Low but > floor
→ second association

Low score + compatible track trajectory
→ recover object
```

這使 Agent Knowledge Graph 新增：

```text
Observation Confidence
≠
Entity Existence Probability
```

更合理的 belief update 應該是：

```text
Detection confidence
+
track prediction
+
appearance similarity
+
spatial feasibility
+
historical existence
↓
Entity belief
```

而不是：

```text
No high-confidence detection
→ object no longer exists
```

這對 Computer Agent 也成立：DOM element 暫時沒渲染、button 被 overlay 擋住、lazy loading、scroll off-screen，都不代表 entity 已從 world model 消失。

---

### 3. SAM 2 的 streaming memory 是「current frame 查歷史 object memory」而非單純 frame-by-frame segmentation

**官方資訊 / 原始碼已確認：**
SAM 2 是一個具有 streaming memory 的 promptable image/video segmentation architecture。官方 paper 說明其 video model 使用 streaming memory 進行 real-time video processing。

其 `memory_attention.py` 明確做：

```text
Current features
↓ self-attention
↓
Query
↓
Cross-Attention
↑
Memory features + memory position
↓
Residual
↓
FFN
```

實作核心：

```text
q = current state + current position
k = memory + memory position
v = memory
CrossAttention(q,k,v)
```

同時 `sam2_base.py` 還會從 conditioning frames 與其他 frames 收集 `object pointers`，並限制送入 encoder 的 object pointer 數量。

來源：
- Meta official SAM 2 research page: https://ai.meta.com/research/publications/sam-2-segment-anything-in-images-and-videos/
- Code: `sam2/modeling/memory_attention.py`
  https://github.com/facebookresearch/sam2/blob/main/sam2/modeling/memory_attention.py
- Code: `sam2/modeling/sam2_base.py`
  https://github.com/facebookresearch/sam2/blob/main/sam2/modeling/sam2_base.py

**改變了什麼：**
Persistent visual identity 不一定只能存在 tracker table 裡；它也可以以 memory features / object pointer representation 存在 neural runtime 裡，讓當前 observation 直接 cross-attend 過去 object state。

**限制：** segmentation identity / pointer persistence 不等於 semantic world identity；SAM 2 不會自動替 Agent 建立「這是使用者昨天拿過的同一個紅杯子」這種 long-term semantic entity。

---

### 4. EPOS-VLM 把 Data Association 本身變成 VLM 的 autoregressive output

**2026 新架構：EPOS-VLM (Embodied Persistent Object Semantics)**

Title: Memory-Augmented Vision-Language Agents for Persistent and Semantically Consistent Object Captioning

Authors: Tommaso Galliena, Stefano Rosa, Tommaso Apicella, Pietro Morerio, Alessio Del Bue, Lorenzo Natale

Institutions: Italian Institute of Technology; University of Genoa

Year: 2026

URL: https://arxiv.org/abs/2603.24257

Project: https://hsp-iit.github.io/epos-vlm/

Architecture:

```text
Current RGB frame + detected instances
+
Top-down explored map
+
Object-level episodic memory
↓
Qwen3-VL-2B backbone
↓
autoregressive structured output
├ [MATCH] current detection → persistent ID / NEW_ID
├ [CAPTION] object semantic description
└ [ACTION] navigation action
```

Memory entry 概念上包含：

```text
Persistent Object ID
3D Position
Caption History + frequency
```

並被 serialized 成：

```text
[SCENE-START]
  [OBJ-ID] ...
  [POS] ...
  [CAP-HISTORY] ...
[SCENE-END]
```

**Contribution：** 把 exploration、data association、semantic caption consistency 放進同一個 memory-conditioned autoregressive policy，而不是 detector → tracker → captioner → planner 四個完全獨立 pipeline。

**結果：** project page 報告在 HM3D manually annotated test 上，EPOS-VLM 的跨 viewpoint caption consistency 與 object caption metrics 明顯優於無 memory 版本；其公開結果包含 Mean CS 89.37 vs w/o memory 52.12。這是該論文設定，不能泛化成所有 embodied VLM。

**限制：** 依賴 external instance segmentation；主要在 photorealistic simulated static environments；dynamic-object identity、long absence、real-world noisy sensors 仍是缺口。

---

### 5. Tracker ID、Semantic Entity ID、World Object ID 必須拆開

這是本輪最重要的 Hermes 工程建模。

```text
Detection ID
= 這一 frame 的局部 detection index

Track ID
= 短時間 observation stream 中的 trajectory identity

Semantic Entity ID
= Agent 認為「語意上是同一個實體」的 identity

World Object ID
= belief graph 中跨 episode / viewpoint / state version 的 persistent physical entity
```

一個常見錯誤：

```text
Frame 1: detection #7 → track 12
Frame 50: occlusion
Frame 300: new track 81

如果直接：
track_id == entity_id

Agent 會認為：
track12 ≠ track81
```

更合理：

```text
track12 ─┐
         ├─ re-identification / geometry / history
track81 ─┘
          ↓
WorldEntity cup_0042
```

因此 Persistent Identity Runtime 應該有兩階段：

```text
ONLINE TRACKING
current detection ↔ active track

LONG-TERM ENTITY RESOLUTION
tracklet ↔ persistent world entity
```

這是**工程推論**，但被 MOT、SAM2 streaming memory、EPOS-VLM persistent object memory、embodied scene memory 的共同需求支持。

---

## Architecture Breakdown

```text
Camera / Screen / Video / RGB-D
↓
Detector / Segmenter
↓
Observation Regions
├ bbox
├ mask
├ confidence
├ OCR
├ appearance feature
├ depth
└ local transient ID
↓
Motion / Geometry Predictor
├ Kalman state
├ optical / camera motion
├ 2D geometry
└ 3D pose
↓
ONLINE DATA ASSOCIATION
├ IoU
├ motion consistency
├ appearance similarity
├ mask overlap
├ semantic compatibility
└ confidence
↓
Track State Machine
├ NEW
├ TRACKED
├ LOST
├ REACTIVATED
└ REMOVED
↓
Tracklet Bank
↓
LONG-TERM ENTITY RESOLVER
├ re-identification
├ 3D location consistency
├ semantic history
├ object pointer / neural memory
├ temporal gap
├ causal continuity
└ world-state compatibility
↓
Persistent Entity ID
↓
Entity Memory
├ observation history
├ captions
├ properties
├ spatial relations
├ parent actions
├ last-seen state
├ confidence
└ provenance
↓
Belief Revision
↓
World-State Graph
↓
Episode Builder
↓
Agent Reasoning / Planning / Action
```

---

## Bottom-Level Logic

### A. Online Association Cost

Hermes 可視化模型可用：

```text
C(i,j) =
  α · (1 - IoU(track_i, det_j))
+ β · MotionDistance(i,j)
+ γ · AppearanceDistance(i,j)
+ δ · SemanticMismatch(i,j)
+ ε · Spatial3DError(i,j)
```

再解 bipartite matching：

```text
Tracklets × Detections
↓ cost matrix
Hungarian / linear assignment
↓
Matches + unmatched tracks + unmatched detections
```

此公式是 Hermes 工程抽象，不是 ByteTrack 原始固定公式；ByteTrack baseline 主要使用 IoU distance、score fusion 與 Kalman prediction。

### B. Long-Term Entity Association

```text
Tracklet T_new
↓
Candidate Persistent Entities
↓
Appearance ReID
+ Semantic Consistency
+ 3D Location / room topology
+ Last-known state
+ Temporal plausibility
+ Action continuity
↓
Posterior identity belief
```

```text
P(Entity=e | observations)
∝
Appearance
× Geometry
× Semantics
× History
× World constraints
```

### C. Identity Conflict

若兩個 active observations 同時被 assign 到一個 physical entity，但空間上不可能：

```text
Entity e
├ obs A at room 1, t=10.0
└ obs B at room 9, t=10.1

movement impossible
→ identity conflict
→ split hypothesis
```

所以 identity 是 belief，不應是不可修改的永久 label。

---

## Visual Simulation Idea

# Persistent Entity Identity Lab

畫面左側：video / agent screenshot timeline。

```text
Frame 001  red cup visible
Frame 020  partly occluded
Frame 030  detector confidence ↓
Frame 040  fully hidden
Frame 080  visible again
Frame 500  seen from opposite side
```

中間顯示 association matrix：

```text
            det7   det8   det9
track12     .12    .91    .82
track19     .93    .18    .76
```

可切換：

```text
IoU only
Motion + IoU
Appearance ReID
SAM2 memory
3D geometry
Semantic memory
Hybrid Agent Identity
```

右側顯示 identity genealogy：

```text
Detection 7
   ↓
Track 12 ─────────┐
                  ├→ Entity cup_0042
Track 81 ─────────┘
   ↑
Detection 203
```

並即時顯示：

```text
Track Confidence
Entity Confidence
Identity Switch Count
Occlusion Duration
Last Seen
World-state Consistency
Semantic Drift
```

使用者可故意製造：

```text
Occlusion
look-alike object
camera teleport
cross-room re-entry
object moved by robot
object removed from scene
```

讓系統直接顯示：

```text
TRACK LOST
but
ENTITY STILL EXISTS
```

或：

```text
TRACK RE-FOUND
but
IDENTITY AMBIGUOUS
→ NEED RE-OBSERVATION
```

---

## Code / GitHub

### ByteTrack
Repository: https://github.com/FoundationVision/ByteTrack

值得讀：

```text
yolox/tracker/
├ byte_tracker.py
├ basetrack.py
├ kalman_filter.py
└ matching.py
```

核心：
- `STrack.activate()`
- `STrack.update()`
- `STrack.re_activate()`
- `BYTETracker.update()`
- `matching.iou_distance()`
- `matching.linear_assignment()`

### SAM 2
Repository: https://github.com/facebookresearch/sam2

值得讀：

```text
sam2/modeling/
├ memory_attention.py
├ memory_encoder.py
└ sam2_base.py

sam2/
└ sam2_video_predictor*.py
```

核心：
- MemoryAttentionLayer self-attn + cross-attn
- memory positional encoding
- object pointer tokens
- conditioning-frame memory selection
- video predictor tracking state

### EPOS-VLM
Project: https://hsp-iit.github.io/epos-vlm/
Paper: https://arxiv.org/abs/2603.24257
Code URL declared by paper/project: https://github.com/hsp-iit/epos-vlm

本輪 connector 無法直接列出該 repo contents，因此其 GitHub directory structure 尚未完成原始碼驗證；架構細節以作者 project page / paper 為依據，標記為待下一輪補 source audit。

---

## Papers

### ByteTrack: Multi-Object Tracking by Associating Every Detection Box
- Authors: Yifu Zhang et al.
- Institution: Huazhong University of Science and Technology / CUHK / ByteDance 等
- Year: 2022
- Venue: ECCV 2022
- URL: https://www.ecva.net/papers/eccv_2022/papers_ECCV/html/315_ECCV_2022_paper.php
- Code: https://github.com/FoundationVision/ByteTrack
- Dataset: MOT17, MOT20, HiEve, BDD100K
- Architecture: detector + Kalman prediction + two-stage data association
- Contribution: 保留 low-score detection 做第二階段 association，降低 fragmented tracks / missed true objects。
- Limitations: 主要解短時 MOT identity；不是 long-term semantic entity memory。

### SAM 2: Segment Anything in Images and Videos
- Authors: Nikhila Ravi et al.
- Institution: Meta
- Year: 2024
- URL: https://ai.meta.com/research/publications/sam-2-segment-anything-in-images-and-videos/
- Code: https://github.com/facebookresearch/sam2
- Dataset: SA-V video segmentation data engine / released data
- Architecture: image/video segmentation transformer + streaming memory + memory attention
- Contribution: 將 promptable segmentation 延伸到 video，current frame 透過 memory attention 使用歷史 visual state。
- Limitations: object segmentation identity 不等於 high-level semantic/causal world identity。

### Memory-Augmented Vision-Language Agents for Persistent and Semantically Consistent Object Captioning
- Authors: Tommaso Galliena et al.
- Institution: IIT + University of Genoa
- Year: 2026
- URL: https://arxiv.org/abs/2603.24257
- Project: https://hsp-iit.github.io/epos-vlm/
- Code: https://github.com/hsp-iit/epos-vlm
- Dataset: Habitat / HM3D / Gibson based embodied captioning data + manually annotated object-level test
- Architecture: Qwen3-VL-2B + current RGB + explored map + serialized persistent object memory → match/caption/action
- Contribution: data association、caption consistency、exploration policy unified into one autoregressive memory-conditioned agent。
- Limitations: external segmenter；simulated/static environment；dynamic real-world object identity 尚待驗證。

### Embodied VideoAgent: Persistent Memory from Egocentric Videos and Embodied Sensors Enables Dynamic Scene Understanding
- Authors: Yue Fan et al.
- Year: 2025 (ICCV)
- URL: https://arxiv.org/abs/2501.00358
- Architecture: egocentric video + depth/pose sensing → scene memory；VLM detects object activity and updates memory
- Contribution: 將 object-related events 主動寫回 persistent scene memory，支援 dynamic scene QA/planning。
- Limitations: memory correctness strongly depends on perception/update reliability；persistent identity 的 association 機制仍值得繼續拆。

---

## Unknown / Open Questions 1–3

1. **Long-gap identity resurrection**：object 消失數分鐘甚至跨 episode 後，appearance / geometry / semantics 如何校準成可靠 posterior，而不是誤把 look-alike 當同一物體？
2. **Identity split / merge**：tracker 發生 ID switch 後，Agent memory 如何修復已經寫入的 episode、causal edge 與 semantic facts？
3. **Cross-modal entity identity**：畫面中的「紅杯子」、語音中的「我的杯子」、DOM 中的 product ID、robot grasp target，如何指向同一 canonical entity？

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
Persistent Entity Runtime
├ Detection ID
├ Instance Mask
├ Track ID
├ Tracklet
├ Track State
├ Lost Track
├ Re-activated Track
├ Object Pointer
├ Semantic Entity ID
├ World Object ID
├ Re-identification
├ Identity Hypothesis
├ Identity Confidence
├ Identity Conflict
├ Entity Timeline
└ Object Permanence
```

```text
Data Association Runtime
├ Motion Prediction
├ IoU Cost
├ Appearance Cost
├ Semantic Cost
├ 3D Spatial Cost
├ Assignment Matrix
├ Linear Assignment
├ Unmatched Detection
├ Unmatched Track
└ Second-stage Association
```

### Edges

```text
Detection
→ may associate with
Track

Track
→ may reactivate
Lost Track

Tracklet
→ may resolve to
Persistent Entity

Low Detection Confidence
≠
Entity Nonexistence

Object Pointer
→ carries
Cross-frame Visual Identity Signal

Persistent Entity
→ owns
Episode History

Action
→ may change
Entity State

Entity State Change
→ updates
World Belief

Identity Conflict
→ triggers
Split / Re-observe / Re-identify
```

---

## 下一輪研究

下一輪應進入：

# Cross-Modal Entity Resolution × Entity Linking × Identity Repair × Object-Centric World Model

直接追：

```text
Vision Track
+
OCR / text mention
+
Voice reference
+
DOM / accessibility node
+
Tool object ID
+
3D map object
↓
Entity Resolver
↓
Canonical Entity ID
↓
World Object Graph
```

核心問題：

```text
「那個紅色杯子」
「我的杯子」
Track #81
Mask #7
3D object @ (x,y,z)
Inventory item cup_0042
```

AI 要怎麼知道它們是同一個東西？

下一輪會優先研究：
- entity linking / coreference 與 multimodal grounding
- long-term ReID
- identity graph merge/split
- object-centric scene graph / 3D object memory
- DOM / vision hybrid computer-agent identity
- belief repair after wrong association

---

## 本輪收斂

- **缺哪一層：** Tracklet → cross-modal canonical entity 的 entity resolver。
- **哪個節點最淺：** Identity repair after wrong historical association。
- **哪個概念仍只是名詞：** World Object ID / Cross-Modal Canonical Entity ABI。
- **哪個系統值得讀原始碼：** SAM 2 `sam2_base.py` + ByteTrack `byte_tracker.py`；EPOS-VLM source tree 待 repo 可讀後補齊。
- **哪篇論文需追引用：** EPOS-VLM 2026，因它把 data association 直接納入 VLM structured decoding。
- **哪個概念最適合視覺模擬：** Persistent Entity Identity Lab。
- **哪個 Agent 架構最值得實作：** `Track-State + Long-Term Entity Resolver + Belief Revision` 的 Persistent Object Agent。

## 本輪核心結論

> AI 要擁有真正的「物體恆存」，不能只把每一 frame 的 detection 當成世界。底層必須先把 observation 變成 track state，再把短期 tracklet 解成跨時間的 persistent entity，並在遮擋、低 confidence、re-entry、viewpoint change、錯誤 association 後持續修正 belief。真正的 Agent world model 應該記住的是「同一個世界實體的歷史」，而不是一串互不相干的圖片框。