# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 16:51（Asia/Taipei）**

**本輪主題：Object-Centric World Model × Relation Persistence × Dynamic Scene Graph × Causal State Transition**

本輪接續上一輪「Cross-Modal Entity Resolution × Canonical Entity Graph × Identity Repair」，避免再重複 entity matching。本輪進一步回答：**當 Agent 已知道「這是同一個世界實體」之後，它如何持續維護「物體彼此是什麼關係」、動作如何改變關係，以及舊關係何時失效？**

核心鏈：

```text
Canonical Entity
↓
Relation Observation
↓
Relation Association
↓
Belief / Confidence Update
↓
Persistent Relation
↓
Action Preconditions
↓
Action
↓
Predicted Relation Delta
↓
New Observation
↓
Effect Verification
↓
World-State Revision
```

---

## 本小時新發現

1. **GSR / RoBoSR 類架構把 Scene Graph 從「輔助 perception」提升成真正的 decision state space。** GSR 明確把世界建模成 `SG_t=(O_t,E_t)`，並訓練 `(SG_t,A_t)→ΔSG_edge`、`(SG_t,G)→A_t` 與跨狀態 action-sequence prediction，因此 Agent reasoning 可以直接操作「關係變化」而不是只操作影像 embedding。
2. **Persistent world model 需要把 stable baseline 和 revisable delta 分層。** 2026 PBD-AG 將固定 fixture 與可移動 object/event 分開管理，並對 geometry、semantics、identity、existence、support relation 維持 reliability-weighted belief；這比單一 scene graph snapshot 更接近長期 Agent 記憶。
3. **Relation persistence 不是「邊存在/不存在」二元值，而至少要有 validity interval、confidence、provenance、observation support、last verified time。** 這是由 PBD-AG 的 reliability/visibility gate、DynamicGSG/DovSG 的 localized update，以及 GSR 的 step-wise transition共同推導出的工程結論。
4. **動態場景更新應該做局部 graph surgery，而不是每次重建整張世界圖。** DovSG 的 repository 已將 `perception/`、`memory/`、`task_planning/`、`navigation/`、`manipulation/` 分開，並以 localized scene-graph update 支援長期 mobile manipulation；DynamicGSG 也將 dynamic update 與 multi-layer scene graph construction 做成公開 runtime。
5. **Action consequence 應拆成「預測效果」與「觀察驗證」兩條路徑。** `Predicted ΔSG` 只是 model expectation；真正 world belief 必須由 post-action observation 再驗證，否則 tool/robot 執行失敗會把錯誤 effect 寫成真實世界狀態。

---

# 本小時最重要 5 個發現

## 1. Scene Graph 可以成為 Agent 的 primary world state，而不只是視覺摘要

### 是什麼

GSR（Grounded Scene-graph Reasoning）將 perception 輸出的 3D scene graph 定義為：

```text
SG_t = (O_t, E_t)

O_t = objects / articulated parts / functional keypoints
E_t = typed spatial / state relations
```

例如：

```text
cup_4
├ type: mug
├ pose
├ handle_keypoint
└ state

cup_4 --ON--> table_2
cup_4 --LEFT_OF--> plate_1
```

### 底層如何運作

GSR 的 training objective 不只學「下一步 action」，而是至少包含：

```text
1. Forward planning
(SG_t, SG_t+n)
→ A_t ... A_t+n-1

2. World modeling
(SG_t, A_t)
→ ΔSG_edge

3. Goal-conditioned planning
(SG_t, Goal)
→ A_t
```

也就是把「世界狀態如何被 action 改變」直接放進 supervision。

### 為什麼重要

傳統 VLA：

```text
Pixels
→ latent
→ action
```

Agent 很難知道：

```text
到底是哪個 precondition 不成立？
哪個 edge 應該被刪除？
哪個 relation 是這個 action 的 effect？
```

GSR 則允許：

```text
Goal:
cup ON shelf

Current:
cup ON table
robot NOT_HOLDING cup

Precondition:
GRASP cup

Effect:
DELETE cup ON table
ADD cup HELD_BY robot
```

再接下一步：

```text
PLACE cup shelf
↓
DELETE cup HELD_BY robot
ADD cup ON shelf
```

### 限制

Scene graph 的 predicates 仍依賴 perception/grounding quality；symbolic relation 也可能過度離散化連續物理狀態。GSR 本身也依賴 scene graph generator 與 action expert，並不是 end-to-end 解掉所有 perception/control 問題。

### 來源

- GSR paper: https://arxiv.org/abs/2602.01693
- Project: https://klmmotion.github.io/gsr.github.io/
- GSR-bench: https://github.com/KLMmotion/GSR-bench

---

## 2. World model 的真正 primitive 應是 State Transition，不是 Static Fact

### 是什麼

上一輪建立了：

```text
Canonical Entity
```

這輪補上：

```text
Canonical Entity
+
Persistent Relations
+
Transition History
```

例如：

```text
State S0:
cup ON table
cabinet CLOSED

Action:
OPEN cabinet

State S1:
cup ON table
cabinet OPEN
```

World state 不能只存：

```text
cabinet OPEN
```

還應保存：

```text
RelationVersion
predicate = OPEN
entity = cabinet_3
valid_from = t1
replaced = CLOSED@t0
caused_by = action_217
verified_by = observation_891
confidence = 0.97
```

### Bottom-level mechanism

Hermes 統一工程模型：

```text
B_t = current world belief graph
A_t = executed action
Fθ(B_t, A_t) = predicted transition
O_t+1 = new observation
U(B_t, Fθ, O_t+1) = revised belief
```

也就是：

```text
Prediction path:
B_t + A_t
→ expected ΔG

Evidence path:
Sensor observation
→ measured ΔG

Consistency check:
expected ΔG vs measured ΔG

↓
Commit / Reject / Ambiguous / Re-observe
```

### 為什麼重要

Tool/robot action 可能失敗：

```text
Agent: click Submit
Tool reports command sent
BUT webpage did not transition
```

若系統直接寫：

```text
form SUBMITTED = true
```

就會產生 world-model hallucination。

因此：

```text
Action issued
≠
Action succeeded
≠
World state changed as predicted
```

### 限制

不同 domain 的 effect model 差異很大：DOM click、robot grasp、MCP API call、browser navigation 都需要不同 verifier。

---

## 3. Relation Persistence 需要 baseline / delta / validity，而不是每幀重新判斷

### 是什麼

PBD-AG（2026-08-11）提出 Persistent Baseline-Delta Active Graph：

```text
BASELINE
stable fixtures / structural anchors

+

DELTA
movable / revisable objects and events
```

它維護 geometry、semantics、identity、existence、support relation 的 reliability-weighted state，並使用 geometric visibility gate 避免「被遮擋 = 被刪除」的錯誤。

### 底層邏輯

對 relation `cup ON table`，不應每個 frame 都：

```text
not detected
→ DELETE EDGE
```

而是：

```text
Prior edge belief
+
visibility
+
occlusion likelihood
+
new observation
+
source reliability
↓
posterior relation belief
```

Hermes 可建模：

```text
RelationRecord
├ subject_id
├ predicate
├ object_id
├ confidence
├ valid_from
├ valid_until
├ last_verified_at
├ support_evidence[]
├ contradicting_evidence[]
├ source
└ status
   ├ ACTIVE
   ├ STALE
   ├ HYPOTHESIZED
   ├ SUPERSEDED
   └ RETRACTED
```

### 為什麼重要

長期 Agent 必須區分：

```text
not currently observed
vs
believed absent
vs
confirmed removed
```

同樣地：

```text
relation not visible
≠
relation false
```

### 來源

- PBD-AG: https://arxiv.org/abs/2608.10449
- Project: https://shuobao214.github.io/PBD-AG/

---

## 4. Dynamic Scene Graph 應該做 Localized Update，而不是 Full Rebuild

### 是什麼

DovSG（RA-L 2025）與 DynamicGSG（IROS 2025）都將長期 world representation 的更新做成 dynamic/local graph update。

DovSG repository 的實際結構：

```text
dovsg/
├ controller.py
├ perception/
├ memory/
├ task_planning/
├ navigation/
├ manipulation/
├ scripts/
└ utils/
```

表示其工程上確實將 perception → memory → planning → execution 分層，而不是只有 README demo。

DynamicGSG repository 則包含：

```text
configs/
data_collect/
datasets/
scripts/
submodules/
utils/
viz_scripts/
vlm_utils/
```

並公開 dynamic update、multi-layer scene graph construction prompts 與 RealSense D455 deployment path。

### 底層如何運作

更合理的更新策略：

```text
New Observation
↓
Changed ROI / Entity Set
↓
Affected Nodes
↓
Affected Edges
↓
Local Association
↓
Patch Graph
↓
Recompute only dependent relations
```

而不是：

```text
New frame
↓
Rebuild entire graph
↓
Replace old graph
```

### 為什麼重要

Full rebuild 容易造成：

```text
Entity ID churn
Relation flicker
History loss
Computational waste
Conflict with long-term memory
```

Localized graph surgery 才能和上一輪 Canonical Entity / Identity Repair 接起來。

### 來源

- DovSG: https://github.com/BJHYZJ/DovSG
- DynamicGSG: https://github.com/GeLuzhou/Dynamic-GSG

---

## 5. Causal State Transition 必須區分「關聯變化」與「Action Effect」

### 是什麼

場景中 edge 改變，不一定是 Agent action 造成。

例如：

```text
before:
cup ON table

after:
cup ON shelf
```

可能原因：

```text
Agent moved it
Human moved it
Perception correction
Identity re-resolution
Camera localization drift
Previous observation wrong
```

因此：

```text
ΔGraph
≠
Causal Effect
```

### Hermes 工程模型

新增：

```text
TransitionEvent
├ before_state
├ after_state
├ delta_nodes
├ delta_edges
├ candidate_causes[]
├ parent_action_id?
├ external_actor?
├ observation_ids[]
├ causal_confidence
└ verification_status
```

再由：

```text
Temporal order
+
Action log
+
Entity continuity
+
Physical feasibility
+
Tool execution result
+
Post-action observation
↓
Causal Attribution
```

### 為什麼重要

Agent planning 需要的不是：

```text
「以前杯子有移動過」
```

而是：

```text
「執行 PICK(cup) 通常使 ON(table) 消失並建立 HELD_BY(robot)」
```

這才是 action model / world model 可以泛化的結構。

### 限制

Observation-only causal attribution 很難識別 hidden actor 與未觀測 intervention；不能把所有 temporal correlation 當 causal relation。

---

# Architecture Breakdown

```text
Camera / Screen / Audio / Depth / Tool Events
↓
Perception Layer
├ Detection / Segmentation
├ OCR / ASR
├ Depth / Pose
├ DOM / Accessibility
└ Tool Result
↓
Canonical Entity Resolver
↓
Object-Centric World Model
├ Entity Nodes
├ Attributes
├ Spatial Relations
├ Functional Relations
├ Containment / Support
├ Ownership / Agent Relations
└ State Predicates
↓
Relation Belief Manager
├ confidence
├ provenance
├ validity interval
├ visibility
├ last verified
└ contradiction set
↓
Persistent Dynamic Scene Graph
├ Stable Baseline
└ Revisable Delta
↓
Goal Interpreter
↓
Precondition Checker
↓
Action Planner
↓
Action Expert / Tool Runtime
↓
Predicted Effect Model
(SG_t, A_t) → ΔSG_pred
↓
Environment
↓
Post-Action Observation
↓
Measured ΔSG_obs
↓
Effect Verifier
├ MATCH
├ PARTIAL
├ FAILED
├ AMBIGUOUS
└ EXTERNAL_CHANGE
↓
Belief Revision
↓
SG_t+1
↓
Transition / Episode Memory
```

這層開始把之前建立的：

```text
Entity Identity
Memory
Observation Version
Action
World-State Version
```

真正連成一個可更新 world model。

---

# Bottom-Level Logic

## A. Relation inference

```text
(entity_i, entity_j)
↓
geometry features
semantic features
support / contact cues
language predicates
historical relation
↓
relation candidate logits
↓
calibration
↓
relation belief
```

Hermes 統一抽象：

```text
P(r_ij | O_t, B_t)
∝
PerceptionEvidence
× HistoricalPrior
× GeometryCompatibility
× SemanticCompatibility
× VisibilityModel
```

這不是特定 paper 的固定公式，而是工程模型。

## B. State transition

```text
Current graph G_t
+
Action A_t
↓
Transition model
↓
Predicted edge operations

ADD(edge)
DELETE(edge)
UPDATE(attribute)
CREATE(entity)
REMOVE(entity)
```

## C. Verification

```text
Predicted operations
vs
Observed operations
↓
Graph Diff
↓
Commit verified changes
Retain uncertain changes
Reject contradicted changes
Trigger re-observation if needed
```

## D. Relation validity

```text
ACTIVE
↓ no verification for long period
STALE
↓ new confirming evidence
ACTIVE

ACTIVE
↓ contradictory evidence
CONFLICTED
↓ resolved
SUPERSEDED / RETRACTED
```

這比傳統：

```text
edge = true / false
```

更適合 Agent 長期運行。

---

# Visual Simulation Idea

## **Object-Centric World Model & Causal Graph Simulator**

主畫面分成三層。

### 1. Live Scene

```text
[robot]   [cup]   [table]   [shelf]
```

### 2. World Graph

```text
cup_4 --ON(0.98)--> table_2
robot --NEAR(0.92)--> cup_4
cabinet_1 --CLOSED(0.99)
```

每條 edge 顯示：

```text
confidence
valid_from
last_verified
source
world_state_version
```

### 3. Transition Timeline

使用者執行：

```text
PICK cup_4
```

系統先顯示「預測世界」：

```text
Expected ΔG
- DELETE cup ON table
+ ADD cup HELD_BY robot
```

然後播放真實 observation。

Case A：成功

```text
Observed ΔG == Expected ΔG
→ EFFECT VERIFIED
```

Case B：grasp 失敗

```text
Observed:
cup still ON table

→ ACTION EXECUTED
→ EFFECT NOT VERIFIED
→ WORLD STATE NOT UPDATED
```

Case C：人類突然拿走杯子

```text
Observed:
cup disappeared
robot not holding cup

→ EXTERNAL WORLD CHANGE
→ causal attribution ambiguous
```

### 可調參數

```text
Relation confidence threshold
Occlusion probability
Observation noise
Action failure rate
Graph staleness threshold
Re-observation cost
Baseline vs Delta classification
```

### 可視化重點

最重要的是讓使用者看到：

```text
Perception
≠ Belief
≠ Prediction
≠ Verified State
```

這比一般 Scene Graph Viewer 更接近「AI 到底怎麼維持一個世界」。

---

# Code / GitHub

## 1. GSR-bench

Repository:
https://github.com/KLMmotion/GSR-bench

值得看的目錄：

```text
3Ddesk/
langgraph_agent/
├ core/
│  └ agent_reflect.py
├ prompts/
├ tools/
├ utils/
├ main.py
└ start_agent.py
report_analysis/
```

README 明確表示 simulator 與 agent 透過 ROS2 topics 如 `/scene_graph`、`/task_cmd` 互動；`langgraph_agent` 是實際可執行的 LangGraph/ROS2 Agent runtime。

## 2. DovSG

Repository:
https://github.com/BJHYZJ/DovSG

值得看的核心：

```text
dovsg/controller.py
dovsg/perception/
dovsg/memory/
dovsg/task_planning/
dovsg/navigation/
dovsg/manipulation/
```

這個 repo 最適合下一步研究「dynamic scene graph 如何被 localized update，再交給 task planner」。

## 3. DynamicGSG

Repository:
https://github.com/GeLuzhou/Dynamic-GSG

值得看的核心：

```text
configs/
scripts/
utils/
vlm_utils/
viz_scripts/
data_collect/
supplementary_materials/
```

適合研究 3D Gaussian representation、scene graph hierarchy、dynamic update 與 object retrieval 怎麼接起來。

---

# Papers

## GSR: Learning Structured Reasoning for Embodied Manipulation

- Authors: Kewei Hu, Michael Zhang, Wei Ying, Tianhao Liu, Guoqiang Hao, Zimeng Li, Wanchan Yu, Jiajian Jing, Fangwen Chen, Hanwen Kang
- Year: 2026
- URL: https://arxiv.org/abs/2602.01693
- Code/Benchmark: https://github.com/KLMmotion/GSR-bench
- Dataset: Manip-Cognition-1.6M；另於 RLBench、LIBERO、GSR-benchmark、real-world tasks 評估
- Architecture: RGB-D → 3D Scene Graph → fine-tuned LLM reasoning → action expert
- Contribution: Scene graph 成為 primary reasoning state；jointly learns scene grounding, action planning, world-state transition, goal interpretation
- Limitation: 依賴 structured perception quality；relations/predicates 仍需要 stable grounding；action expert 與 perception failure 仍可能主導整體失敗
- 改變了什麼：從「scene graph 作為 perception auxiliary」推進到「scene graph 作為 decision/world-model state space」。

## RoBoSR: Structured Scene Representations for Embodied Robotic Reasoning

- Authors: Kewei Hu, Wanchan Yu, Fangwen Chen, Jiajian Jing, Zimeng Li, Ying Wei, Tianhao Liu, Michael Zhang, Hanwen Kang
- Year: 2026
- URL: https://arxiv.org/abs/2606.24338
- Dataset: Manip-Cognition-1.6M
- Architecture: object-centric grounded scene representation → state transitions → structured task reasoning
- Contribution: 將 manipulation formalize 成 semantically grounded scene graph 上的 step-wise state transition，強調 preconditions/effects/goal state
- Limitation: 本輪未確認完整公開 training source；目前主要依 paper/project-level evidence
- 改變了什麼：強化「reason first in structured state space，再執行」的 embodied architecture。

## PBD-AG: Persistent Baseline-Delta Active Graphs with Uncertainty-Aware Inspection for Long-Horizon Service Robots

- Authors: Shuo Bao, Wei Dong, Shuyue Zhang, Ming Shang, Yuchen Huang, Han Yu, Chengjie Xu, Yiheng Bi, Kai Sun, Fuchun Sun, Xinzhou Wang
- Year: 2026
- URL: https://arxiv.org/abs/2608.10449
- Architecture: stable baseline + revisable delta + reliability-weighted object state + visibility gate + graph-conditioned inspection
- Contribution: 將 long-horizon world model 拆成 stable structural anchor 與 dynamic events，並把 uncertainty/inspection 引入 graph maintenance
- Limitation: simulation 為主要 quantitative evidence；physical demonstration 為 qualitative
- 改變了什麼：讓「scene graph」從 snapshot 變成可長期維護、可修正的 persistent belief structure。

## DynamicGSG: Dynamic 3D Gaussian Scene Graphs for Environment Adaptation

- Authors: Luzhou Ge, Xiangyu Zhu, Zhuo Yang, Xuesong Li
- Institution: Beijing Institute of Technology
- Year: 2025, IROS
- URL/Code: https://github.com/GeLuzhou/Dynamic-GSG
- Architecture: 3D Gaussian scene representation + multi-layer scene graph + dynamic update + VLM/LLM querying
- Contribution: 對環境改變進行動態更新，並保有 scene graph 層級與語言查詢能力
- Limitations: domain/3D reconstruction quality、mapping drift 與 object association 仍會影響 graph correctness
- 改變了什麼：將 open-vocabulary 3D scene graph 從偏 static mapping 推向可更新 environment memory。

## DovSG: Dynamic Open-Vocabulary 3D Scene Graphs for Long-term Language-Guided Mobile Manipulation

- Authors: Zhijie Yan, Shufei Li, Zuoxu Wang, Lixiu Wu, Han Wang, Jun Zhu, Lijiang Chen, Jihong Liu
- Year: 2025, RA-L
- URL/Code: https://github.com/BJHYZJ/DovSG
- Architecture: perception + dynamic scene graph memory + LLM task decomposition + navigation + manipulation
- Contribution: 支援 human/environment changes 後的 localized graph updates 與 long-term manipulation
- Limitation: heavy modular stack、real-world sensing/calibration/state association complexity高
- 改變了什麼：把 dynamic world representation 接到完整 mobile-manipulation runtime，而不只做 offline map。

---

# Unknown / Open Questions

## 1. Relation ontology 要固定還是 open-vocabulary？

固定 predicate：

```text
ON / INSIDE / HOLDING / OPEN / CLOSED
```

容易規劃與驗證，但 coverage 差。

Open-vocabulary relation：

```text
"leaning against"
"half-covered by"
"reachable through"
```

表達力高，但 calibration、precondition/effect matching 困難。

真正需要的是不是：

```text
Canonical Predicate Layer
+
Open-Vocabulary Relation Layer
```

仍待驗證。

## 2. 如何做 causal attribution？

```text
Graph changed after action
```

不能直接推出：

```text
Action caused graph change
```

需要 intervention log、actor identity、physical model、execution telemetry 與 observation uncertainty共同判斷。

## 3. Relation memory 要保存多久？

```text
cup ON table
```

如果 3 小時沒看到，它應該是：

```text
ACTIVE?
STALE?
UNKNOWN?
```

需要 relation-type-specific TTL / decay / inspection policy，而不是統一 expiration。

---

# Knowledge Graph 新增 Node / Edge

新增 Nodes：

```text
Object-Centric World Model
Persistent Relation
Relation Belief
Relation Provenance
Relation Validity Interval
Relation Version
Relation Staleness
Baseline Graph
Delta Graph
Graph Surgery
State Transition
Transition Event
Action Precondition
Predicted Effect
Observed Effect
Effect Verification
Causal Attribution
World-State Revision
```

新增核心 Edges：

```text
Canonical Entity
→ participates in
Persistent Relation

Persistent Relation
→ belongs to
World-State Version

Action
→ requires
Precondition

Action
→ predicts
Graph Delta

Observed Graph Delta
→ verifies
Predicted Effect

Verified Effect
→ updates
World Belief

Stable Fixture
→ anchors
Baseline Graph

Dynamic Object Event
→ updates
Delta Graph

Occlusion
≠
Entity Removal

Relation Not Observed
≠
Relation False

Graph Change
≠
Causal Effect
```

---

# 下一輪研究

下一輪應直接進：

# **Action Model × Preconditions/Effects × Affordance × PDDL/BDDL × Learned Transition Model × Tool/Robot Verification**

現在最缺的不是再加 scene-graph node，而是把：

```text
World State
↓
「現在可以做什麼？」
↓
Action Preconditions
↓
Action Schema
↓
Expected Effects
↓
Execution
↓
Verification
```

拆到底。

下一輪比較：

```text
Classical symbolic action models
PDDL / STRIPS / BDDL

vs

LLM-generated action schemas

vs

Learned world-transition models

vs

VLA latent dynamics
```

並研究：

```text
AFFORDANCE
≠
ACTION PRECONDITION
≠
TOOL PERMISSION
≠
PHYSICAL FEASIBILITY
```

這會把目前知識圖譜真正從：

```text
「AI 如何知道世界是什麼」
```

推進到：

```text
「AI 如何知道世界現在允許它做什麼，以及做完後世界應該變成什麼」
```

---

# 本輪收斂回答

- **缺哪一層：** `World Relation → Action Preconditions/Effects → Execution Verification` 的統一 action semantics。
- **哪個節點最淺：** Causal Attribution；目前多數 scene-graph 系統能觀察 state difference，但對「誰造成的、是否真為 action effect」仍較弱。
- **哪個概念仍只是名詞：** Relation TTL / Relation Freshness Policy、Unified Transition ABI。
- **哪個系統值得讀原始碼：** 第一優先 `KLMmotion/GSR-bench/langgraph_agent/core/agent_reflect.py`；第二優先 DovSG `controller.py` + `memory/` + `task_planning/`。
- **哪篇論文需追引用：** GSR / RoBoSR；尤其應追 structured intermediate state 對 VLA / world model 的後續引用。
- **哪個概念最適合視覺模擬：** Object-Centric World Model & Causal Graph Simulator。
- **哪個 Agent 架構最值得實作：** `Persistent Object-Centric World Model + Relation Belief Manager + Predicted/Observed Effect Verifier`。

---

# 本輪核心結論

> **AI 真正擁有世界模型，不是因為它能列出「杯子、桌子、櫃子」，而是因為它能維護「杯子現在在哪、這個關係何時成立、證據來自哪裡、哪個動作預計改變什麼、實際是否真的改變，以及舊狀態何時被新狀態取代」。因此 Object-Centric World Model 的核心 primitive 不是 object，而是 versioned relation + verified state transition。**
