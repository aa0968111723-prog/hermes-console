# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-11 03:54 Asia/Taipei

## 本輪研究主題
**Material Identity × Conservation Law × Contact / Containment Graph × Physical Causal State × Material-Aware World Models**

本輪承接上一輪「Entity State Transition × Physical Transformation × Identity Lineage」。上一輪已能表示物件的 SPLIT / MERGE / DETACH / ATTACH / MATERIAL_TRANSFER，但最淺的節點仍是：當物體不再是剛體、當材料可變形、流動、混合或透過接觸傳遞力時，單一 PersistentEntityID 與幾何 bbox 已不足以描述真實世界。

核心問題從：

```text
這是不是同一個物件？
```

往下推成：

```text
這些 material elements 從哪裡來？
現在在哪裡？
哪些量應守恆？
哪些接觸造成狀態轉移？
哪些變化只是外觀，哪些是物理狀態真的改變？
```

---

# 本小時新發現

## 新論文 / 架構

### 1. PhysCoRe: Physics-Corrected Residual World Models for Material-Aware Deformable Dynamics
- Authors: Haocheng Yin, Shuohan Tao, Yongsheng Chen, Lu Gan
- Institution: Georgia Institute of Technology
- Year: 2026
- URL: https://arxiv.org/abs/2607.20653
- Code: 本輪未找到可驗證的官方公開 code repository；不能把二手整理當成官方實作
- Dataset: real deformable-object manipulation sequences（paper-described）
- Architecture: differentiable Material Point Method (MPM) + Material from Motion (MfM) + Residual from Dynamics (RfD)
- Contribution: 從視覺觀測估計 per-particle elasticity，並用 neural residual 修正解析 simulator 的系統誤差；可做 novel-object online material identification
- Limitation: 仍依賴 MPM modeling assumptions；material parameter uncertainty 與真实 material identity / composition lineage 並不是同一問題
- 改變了什麼: 把 world model 從「預測幾何怎麼動」推成「先辨識材料參數，再用 physics prior + learned residual 預測材料動態」

### 2. Visuo-Tactile World Models
- Authors: Carolina Higuera, Sergio Arnaud, Byron Boots, Mustafa Mukadam, Francois Robert Hogan, Franziska Meier
- Institution: University of Washington / Meta（依公開頁面）
- Year: 2026
- URL: https://arxiv.org/abs/2602.06001
- Code: 本輪尚未找到已驗證官方完整 repo
- Architecture: multi-task visuo-tactile world model
- Contribution: 將觸覺納入 world imagination，處理 contact-rich manipulation
- Reported result: paper reports 33% better object permanence、29% better compliance with laws of motion in autoregressive rollouts，zero-shot real-robot planning up to 35% higher success
- Limitation: 接觸感知提升不等同於顯式的 contact mechanics certificate；world model 仍可能只是在 latent space 學到有效統計規律
- 改變了什麼: 明確證明 vision-only world state 對 contact / occlusion 可嚴重欠定，Touch 是 physical state 的額外觀測通道，不只是附加 modality

### 3. PointWorld: Scaling 3D World Models for In-The-Wild Robotic Manipulation
- Authors: Wenlong Huang, Yu-Wei Chao, Arsalan Mousavian, Ming-Yu Liu, Dieter Fox, Kaichun Mo, Li Fei-Fei
- Institutions: NVIDIA / Stanford 等（以論文為準）
- Year: 2026
- URL: https://arxiv.org/abs/2601.03782
- Code: https://github.com/NVlabs/PointWorld
- Dataset: 約 2M trajectories / 500 hours，跨 Franka 與 bimanual humanoid，real + simulation
- Architecture: state 與 action 都映射到 shared 3D point-flow representation；scene evolution 以 per-point 3D displacement 預測
- Contribution: 把 action representation 從 embodiment-specific joint space 提升到幾何共享的 3D point flow，並展示 real-time (~0.1 s) MPC integration
- Limitation: 3D point flow 很適合幾何運動，但「同一批 material mass 是否守恆」「接觸力如何傳遞」「材質參數是什麼」並非由 point-flow representation 自動保證
- 改變了什麼: 提供 Hermes 一個很好的 geometric physical-state layer，但仍需要 material/contact layer 疊在上方

### 4. ABot-PhysWorld
- Authors: Yuzhi Chen et al.
- Year: 2026
- URL: https://arxiv.org/abs/2603.23376
- Architecture: 14B Diffusion Transformer + physics-aware annotation + DPO-based post-training + decoupled discriminators + parallel context block
- Contribution: 專門降低 object penetration、anti-gravity 等 physically implausible video rollout
- Limitation: physical plausibility discriminator ≠ explicit conservation/contact-state model；生成「看起來物理合理」仍不等同可供控制系統採信的物理 certificate

### 5. ConservationBench / Vision Language Models Cannot Reason About Physical Transformation
- Authors: Dezhi Luo et al.
- Year: 2026
- URL: https://arxiv.org/abs/2603.07109
- Dataset/Benchmark: 23,040 questions, 112 VLMs, number / length / volume / size conservation
- Contribution: 顯示 current VLMs 對 transformation-invariant physical property 的推理接近系統性失效；增加 temporal resolution、prompting、curated sampling 都沒有消除問題
- 改變了什麼: 給 Hermes 一條重要設計規則：**VLM verbal judgment 不能直接當 Conservation Certificate。**

### 6. FolDeX
- Year: 2026
- URL: https://arxiv.org/abs/2609.10243
- Dataset: 2,000+ hours real-robot data, 20+ tasks, 10+ embodiments
- Focus: long-horizon deformable-object manipulation / garment folding
- Importance: 這是本輪很新的 benchmark 訊號，補上 rigid-object benchmark 對長時程可變形物體不足的問題
- Limitation: benchmark 本身不是 material-state representation；但很適合未來驗證 Hermes 的 Material/Contact State Runtime

---

# 本小時最重要 5 個發現

## 發現 1 — Object Identity 不等於 Material Identity

### 是什麼
一個物件可被切割、熔化、揉捏、混合、倒入另一容器。Object-level lineage 只能回答：

```text
Entity A → Entity B/C
```

但無法完整回答：

```text
A 的哪些 material constituents
現在進入 B？
哪些進入 C？
有多少？
```

因此需要新的中間層：

```text
MaterialParcelID
MaterialFieldID
CompositionState
```

### 底層如何運作
建議把 rigid/deformable/substance 分層：

```text
PersistentEntity
├ Geometry
├ Pose
├ Parts
└ MaterialContent
     ├ MaterialParcel / Field
     ├ composition
     ├ mass/volume proxy
     ├ constitutive parameters
     ├ temperature/state-of-matter
     └ provenance
```

當切割發生：

```text
Entity #5
MaterialParcel M7
↓ CUT
Entity #101 gets M7a
Entity #102 gets M7b

M7a + M7b derives_from M7
```

當倒水：

```text
Water material M20
Container A --CONTAINS→ M20
↓ POUR
Container B --CONTAINS→ M20'
```

此時 container identity 沒變，但 containment edge 與 material spatial support 改變。

### 為什麼重要
如果 Planner 只記 `cup contains water = true/false`，在多步驟任務中很容易丟掉「水究竟去哪裡」的 lineage。

### 限制
MaterialParcelID 是本輪工程抽象，不是現有論文統一標準；流體/粉末實際上更適合 field / distribution，而非可數 parcel。

### 來源
PhysCoRe、ConservationBench、上一輪 Entity Lineage research。

---

## 發現 2 — Contact 是 Physical Causality 的關鍵中介變數

### 是什麼
視覺中「機械手靠近物體」和「機械手真正施力推動物體」可能非常相似，但物理因果上差很多。

應拆成：

```text
Robot Motion
→ Contact Establishment
→ Force / Constraint Transmission
→ Object Acceleration / Deformation
→ New State
```

不是：

```text
Robot pixels moved
→ Object pixels moved
```

### 底層如何運作
新的 ContactGraph 應至少有：

```text
ContactEdge
├ body_a
├ body_b
├ contact_region
├ contact_start/end
├ normal/tangent frame
├ penetration/deformation proxy
├ force/torque estimate
├ confidence
├ sensing_source
└ evidence roots
```

並建立：

```text
TOUCHES
SUPPORTS
GRASPS
PUSHES
PULLS
CONSTRAINS
ATTACHED_TO
CONTAINS
```

這些不是普通 knowledge-graph semantic relation，而是**帶時間與物理 state 的 dynamic relation**。

### 為什麼重要
VT-WM 顯示觸覺讓 world model 在 object permanence 與 laws of motion 上明顯改善；這支持「Contact state 不是 vision feature 可完全替代的隱變量」。

### 限制
Tactile observation ≠ precise force/contact state；soft contact、friction、distributed pressure 仍有 observability 問題。

### 來源
Visuo-Tactile World Models；Robot-Factored World Models（depth/geometry 對 contact/occlusion 的提示）；PointWorld。

---

## 發現 3 — Material parameter identification 應成為 World Model 的在線 belief

### 是什麼
對 deformable object，世界狀態不應只有位置 x、速度 v，還要有未知材料參數 θ：

```text
θ = elasticity, stiffness, damping, friction, ...
```

PhysCoRe 的 Material from Motion 正是在從觀察到的 deformation 反推 per-particle elasticity。

### 底層如何運作
建議 Hermes 表示：

```text
P(S_t, θ | O_1:t, A_1:t-1)
```

並執行：

```text
Observe deformation
→ infer θ posterior
→ physics rollout
→ compare predicted vs observed motion
→ residual
→ update θ / residual model
→ decide whether more probing action is useful
```

這本質上是：

```text
State Estimation
+
System Identification
+
Active Experiment Design
```

### 為什麼重要
一個軟海綿和一塊硬塑膠即使 shape 一樣，也不能用相同 action model。

### 限制
MfM 的 elasticity estimate 是 model-conditioned material parameter，不等同化學上的真實材料 identity。

### 來源
PhysCoRe。

---

## 發現 4 — Conservation 應是 executable probe，而不是語言判斷

### 是什麼
ConservationBench 已顯示 VLM 對 number/length/volume/size transformation invariance 不可靠。

Hermes 因此應把 conservation 從 prompt 問答改成 runtime checker：

```text
Pre-State
+
Transformation
+
Post-State
↓
Measured/estimated invariant
↓
Conservation residual
↓
PASS / UNCERTAIN / FAIL
```

### Bottom-level
例如 material mass proxy：

```text
r_mass = |Σ m_before - Σ m_after|
```

volume：

```text
r_volume = |V_before - V_after|
```

但不同 transformation 要啟用不同 rule：

```text
CUT:
  material mass ≈ conserved
  object count NOT conserved

MELT:
  material mass ≈ conserved
  shape NOT conserved

POUR:
  source containment NOT conserved
  global material amount ≈ conserved

EVAPORATE:
  local visible volume NOT conserved
  closed-system total mass may be conserved
```

### 為什麼重要
若沒有 transformation-conditioned invariant，系統會犯「所有特徵都應不變」的錯。

### 限制
真實 sensor measurement 有噪音；開放系統中 mass/heat/material 可能跨 observation boundary，因此 certificate 必須標明 system boundary。

### 來源
ConservationBench；PhysCoRe；ABot-PhysWorld。

---

## 發現 5 — 3D Point Flow 是非常強的幾何 state/action substrate，但不是完整 physics state

### 是什麼
PointWorld 把 observation 與 robot action 都轉成 shared 3D point-flow space：

```text
RGB-D scene
→ 3D points

Robot command
→ robot 3D point flow

World Model
→ predicted scene point flow
```

這比 joint vector 更直接把 embodiment geometry 放進 world dynamics。

### GitHub 原始碼確認
官方 repo 已公開，root 包含：

```text
pointworld/
ptv3/
dataset_components/
evaluation/
scene_featurizer.py
robot_sampler.py
train.py
eval.py
```

`pointworld/` 內包含：

```text
base.py
embeddings.py
losses.py
metrics.py
norm_stats.py
checkpoint_contract.py
```

因此它不是只有論文/README；已有 training/evaluation code path。

### 為什麼重要
Hermes 可以借它建立：

```text
Geometric State Plane
```

再疊：

```text
Material State Plane
Contact State Plane
Constraint State Plane
```

### 限制
Point displacement 沒有自動帶出 contact force、material identity、mass conservation、friction law；這些需要額外 state/constraint。

### 來源
PointWorld paper + official NVlabs GitHub。

---

# Architecture Breakdown

## Proposed: Physical Causal State Runtime

```text
Camera / RGB-D / Video
Tactile / Force-Torque
Audio
Robot proprioception
        ↓
Multimodal Observation Bus
        ↓
Persistent Entity Resolver
        ↓
Geometry State Plane
├ point cloud
├ surface / mesh
├ pose / velocity
└ point flow
        ↓
Material State Plane
├ MaterialParcel / Field
├ composition
├ elasticity
├ stiffness
├ friction
├ damping
├ temperature
└ uncertainty
        ↓
Dynamic Relation Plane
├ Contact Graph
├ Containment Graph
├ Support Graph
├ Attachment Graph
└ Articulation / Constraint Graph
        ↓
Physical Causal State
        ↓
Action-Conditioned Dynamics Model
├ analytic simulator
├ learned world model
├ physics-corrected residual
└ multimodal latent dynamics
        ↓
Conservation / Constraint Probes
        ↓
Predicted Post-State
        ↓
Planner / MPC / VLA
        ↓
Action
        ↓
World
        ↓
Observed Post-State
        ↓
Residual + State/Parameter Update
        ↺
```

## 關鍵設計原則

Hermes 不應只保存：

```text
object = cup
location = table
```

而要逐步能保存：

```text
WorldEntity #17
├ geometry_state_version = G41
├ material_state_version = M12
├ contact_state_version = C31
├ containment_state_version = CT9
├ motion_state_version = K28
├ evidence_roots = [...]
└ physical_certificate = PC77
```

---

# Bottom-Level Logic

## 1. Material Point Method 對本研究的意義

PhysCoRe 的底層機制是 MPM 類 hybrid Eulerian-Lagrangian simulation。簡化理解：

```text
Particles
(material mass, velocity, deformation, parameters)
↓ P2G
Grid
(accumulate mass / momentum)
↓
Grid physics update
(forces, stress, boundary/contact)
↓ G2P
Particles
(updated velocity / deformation)
```

與純 pixel/video prediction 最大差異是：particle 帶有 material state，grid 負責處理 interaction / dynamics。

PhysCoRe 再加入：

```text
Visual observation
↓
Material from Motion
↓
per-particle material estimate
↓
Differentiable MPM
↓
physics prediction
↓
Residual from Dynamics
↓
corrected dynamics
```

因此可視為：

```text
Structured Physics Prior
+
Learned Parameter Identification
+
Learned Residual Correction
```

而不是「神經網路自己學所有物理」。

## 2. Physical Causal State

建議 state 不再寫成單一：

```text
S_t
```

而拆成：

```text
S_t = {
  E_t,   entity state
  G_t,   geometry
  M_t,   material field
  C_t,   contact graph
  N_t,   containment/support network
  K_t,   kinematics/dynamics
  Θ_t,   material/dynamics parameters
  L_t    lineage
}
```

Action-conditioned transition：

```text
P(S_{t+1}, Θ_{t+1} | S_t, Θ_t, A_t, O_{t+1})
```

這比上一輪的 entity-only transition 更接近 embodied world model。

## 3. Contact-Causal update

```text
A_t
→ robot geometry trajectory
→ candidate contact
→ contact state
→ constraint/force transmission
→ material/body response
→ geometry change
→ sensor observation
→ state correction
```

因此：

```text
Action command ≠ Applied force
Applied force ≠ Effective object motion
Pixel overlap ≠ Physical contact
```

---

# Visual Simulation Idea

## Physical Causal State & Material Conservation Lab

Hermes Console 建議新增四層同步視圖。

### A. Geometry View

```text
[Robot gripper] → [soft block]
```

顯示 3D points / flow / deformation。

### B. Material Field View

```text
Soft block
┌──────────────────┐
│ stiffness map    │
│ .82 .79 .54 .31  │
│ .80 .72 .48 .28  │
└──────────────────┘
```

可切換：

```text
ELASTICITY
FRICTION
DAMPING
UNCERTAINTY
```

### C. Contact Graph

```text
Gripper L ──contact(.93)── Block
Gripper R ──contact(.95)── Block
Block     ──support(.99)── Table
```

滑桿可改：

```text
force
friction
stiffness
contact confidence
```

立即看預測 trajectory 改變。

### D. Conservation Ledger

例如 CUT：

```text
Before
Entity #5
material proxy = 1.00
count = 1

After
#101 = .47
#102 = .51
lost/unknown = .02

Material residual = .02  PASS
Object count       1→2   EXPECTED CHANGE
```

例如 POUR：

```text
Container A: 300 ml → 42 ml
Container B: 0 ml → 251 ml
Spill/unknown: 7 ml

Global residual: 0 ml
Local containment changed
```

### 最重要的互動
加入 toggle：

```text
VISION ONLY
VISION + DEPTH
VISION + TOUCH
VISION + TOUCH + FORCE
```

讓使用者直接看 Contact posterior、Physical State confidence 與 rollout stability 如何改變。

這能讓一般使用者理解：

> AI 「看到」手碰物體，和 AI 「知道發生了接觸、多少力傳進去、材料如何回應」是不同層級。

---

# Code / GitHub

## NVlabs/PointWorld
https://github.com/NVlabs/PointWorld

本輪已讀 directory structure，不只 README。

值得繼續讀：

```text
pointworld/base.py
scene_featurizer.py
robot_sampler.py
pointworld/losses.py
pointworld/metrics.py
ptv3/
dataset_components/
evaluation/
```

應優先回答：
1. scene points 怎麼 sampling / featurize；
2. robot geometry/action 如何變成 point flow；
3. temporal action condition 如何餵進 PTv3 backbone；
4. output point-flow target / normalization；
5. MPC integration 對 rollout error 的敏感性。

## PhysCoRe
本輪未找到可可靠驗證的官方 source repository，因此目前狀態：

```text
Paper architecture        CONFIRMED
Material-from-Motion      CONFIRMED FROM PAPER
Residual-from-Dynamics    CONFIRMED FROM PAPER
Official full code        NOT VERIFIED
```

不能把第三方筆記庫當官方實作證據。

## Visuo-Tactile World Models
目前：

```text
Paper claims              CONFIRMED
Reported metrics          CONFIRMED FROM PAPER
Official code internals   NOT VERIFIED THIS ROUND
```

---

# Papers

## 優先閱讀順序

### Priority A
1. **PhysCoRe** — https://arxiv.org/abs/2607.20653
   - 原因：直接連到 Material Identity / Material Parameter / Differentiable Physics。

2. **Visuo-Tactile World Models** — https://arxiv.org/abs/2602.06001
   - 原因：補 contact observability 的核心缺口。

3. **PointWorld** — https://arxiv.org/abs/2601.03782
   - Code: https://github.com/NVlabs/PointWorld
   - 原因：可直接讀原始碼、可作 Hermes Geometry State Plane 參考。

### Priority B
4. **Vision Language Models Cannot Reason About Physical Transformation / ConservationBench** — https://arxiv.org/abs/2603.07109
5. **ABot-PhysWorld** — https://arxiv.org/abs/2603.23376
6. **FolDeX** — https://arxiv.org/abs/2609.10243

---

# 已確認事實 / 工程推論 / 尚未驗證

## 已確認事實
- PhysCoRe 使用 differentiable MPM + MfM + RfD，並支援 online material identification。
- PointWorld 使用 shared 3D point-flow representation 表示 state/action，公開官方 NVlabs code。
- VT-WM paper reports vision+tactile 對 object permanence / motion-law compliance / planning 的提升。
- ConservationBench 對 112 VLM、23,040 questions 顯示 current VLM transformation conservation reasoning 有系統性弱點。
- FolDeX 是 2026-09 新的 real-robot long-horizon deformable benchmark，報告 2,000+ hours / 20+ tasks / 10+ embodiments。

## 工程推論 / 本輪建模
- MaterialParcelID / MaterialFieldID
- Physical Causal State ABI
- ContactGraph + ContainmentGraph 分層 runtime
- Conservation Certificate / Conservation Ledger
- Geometry State Plane + Material State Plane + Contact State Plane
- 將 material parameter posterior 納入 Hermes belief state

## 尚未驗證假說
1. 一個統一的 MaterialField + ContactGraph 表示是否能同時涵蓋 rigid、cloth、soft body、fluid、granular material，仍未證實。
2. Point-flow representation 與 MPM particle state 是否可建立低損失 bridge，需要實驗。
3. vision+tactile latent state 是否能穩定提供可校準的 contact-state posterior，需要 benchmark / calibration study。

---

# Unknown / Open Questions

## 1. Material identity 的最小持久單位到底是什麼？
對 rigid object 可用 entity；cloth/soft body 可用 mesh/particles；liquid/granular material 更像 field。Hermes 很可能需要 polymorphic representation，而不是強迫所有世界狀態共用 ObjectID。

## 2. Conservation boundary 如何自動決定？
「桌面上的水變少」可能是 spill，也可能流出 camera FOV。沒有 system boundary，就不能宣告 conservation violation。

## 3. Contact / Force 是否能從 vision-only 高可信估計？
在遮擋、微接觸、柔性材料、摩擦狀態下很可能不可識別。需要 active sensing / tactile / force-torque integration。

---

# 下一輪研究

下一個最大缺口：

# **Action-State Causal Credit × Contact Event Attribution × Counterfactual Physics × Intervention-Based World Model Verification**

本輪已建立：

```text
Action
→ Contact
→ Material Response
→ State Transition
```

下一輪要回答：

```text
觀察到的 state change
到底是不是這個 action 造成的？
如果沒碰它會怎樣？
如果施不同力會怎樣？
world model 的 predicted causal response 是否可信？
```

建議研究：

```text
Counterfactual rollout
Action intervention do(A=a)
Contact-event attribution
Causal dynamics identification
Inverse dynamics
Model predictive control
World-model ensemble uncertainty
Physics residual decomposition
Action-conditioned causal graph
Intervention consistency benchmark
```

目標架構：

```text
Observed Transition
↓
Candidate Physical Causes
↓
Counterfactual World Model
├ do(no contact)
├ do(lower force)
├ do(different direction)
└ do(different material parameter)
↓
Outcome Delta
↓
Causal Attribution
↓
Action-State Causal Certificate
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Material Identity
Material Parcel
Material Field
Material Composition State
Material Parameter Posterior
Elasticity Field
Friction State
Damping State
Physical Causal State
Geometry State Plane
Material State Plane
Contact State Plane
Contact Graph
Contact Edge
Containment Graph
Support Graph
Constraint Graph
Contact Event
Force Transmission
Material Response
Conservation Probe
Conservation Residual
Conservation Boundary
Conservation Certificate
Physics Residual
Physics-Corrected World Model
Material from Motion
Point Flow State
Point Flow Action
Tactile World State
```

## Edges

```text
Entity --CONTAINS_MATERIAL→ MaterialField
MaterialParcel --DERIVES_FROM→ MaterialParcel
MaterialField --HAS_PARAMETER→ MaterialParameterPosterior
Body --CONTACTS→ Body
ContactEvent --TRANSMITS→ Force
Force --CAUSES_RESPONSE_IN→ MaterialField
Container --CONTAINS→ MaterialField
Body --SUPPORTS→ Body
Action --ESTABLISHES_CONTACT→ ContactEvent
ContactEvent --CAUSES→ StateTransition
Transformation --PRESERVES/VIOLATES→ PhysicalInvariant
WorldState --CERTIFIED_BY→ ConservationCertificate
Observation --UPDATES→ PhysicalCausalState
TactileObservation --EVIDENCES→ ContactEdge
PointFlow --REPRESENTS→ GeometricMotion
```

## 新增否定關係

```text
Object Identity ≠ Material Identity
Geometry Continuity ≠ Material Continuity
Pixel Overlap ≠ Contact
Contact ≠ Force Magnitude
Action Command ≠ Applied Force
Visual Plausibility ≠ Physical Validity
VLM Judgment ≠ Conservation Certificate
Point Flow ≠ Complete Physics State
Material Parameter ≠ Chemical Material Identity
Tactile Observation ≠ Exact Contact State
Local Quantity Change ≠ Global Conservation Violation
Object Count Conservation ≠ Material Conservation
```

---

# 本輪結束回答

**缺哪一層？**
Action-State causal attribution：我們已有 state/contact/material，但還缺對每次變化做 intervention-level 的 causal credit。

**哪個節點最淺？**
MaterialField / MaterialParcel 在 liquid、granular、phase-change 下的統一 representation。

**哪個概念仍只是名詞？**
Universal Physical Causal State ABI、MaterialParcelID、Conservation Certificate、Contact Certificate。

**哪個系統最值得讀原始碼？**
NVlabs/PointWorld；下一輪優先 `scene_featurizer.py`、`robot_sampler.py`、`pointworld/base.py` 與 PTv3 integration。

**哪篇論文需追引用？**
PhysCoRe（material-aware differentiable physics）、VT-WM（contact observability）、PointWorld（3D shared action/state）、ConservationBench（invariance failure）。

**哪個概念最適合視覺模擬？**
Physical Causal State & Material Conservation Lab：Geometry + Material Field + Contact Graph + Conservation Ledger 四層同步。

**哪個 Agent 架構最值得實作？**

> **Physics-Grounded Embodied Agent Runtime = Persistent Entity Registry + Geometry State Plane + Material State Plane + Dynamic Contact/Containment Graph + Material Parameter Belief + Hybrid Physics/Learned World Model + Conservation/Constraint Probes + Planner/MPC + Active Physical Verification**

---

# 本輪核心推進

上一輪 Hermes 已開始理解：

```text
「東西怎麼變」
```

本輪再往底層變成：

```text
「是哪些物質在變、接觸在哪裡發生、力/約束如何傳遞、哪些物理量應保存、哪些 world-model prediction 只是看起來合理但沒有物理保證。」
```

因此從「使用者對 AI 說一句話」到真實世界行動的完整鏈又增加一層：

```text
Camera / RGB-D / Touch / Force
→ Encoder
→ Persistent Entity
→ Geometry State
→ Material State
→ Contact / Constraint Graph
→ Physical Causal State
→ World Model
→ Reasoning / Planning
→ Action
→ Contact
→ Material Response
→ New Observation
→ Conservation / Physics Verification
→ Memory / Knowledge Graph Update
```

這一層是讓 Agent 從「看懂影片中的物件」走向「建立能被行動、感測與物理約束共同驗證的世界模型」的關鍵。
