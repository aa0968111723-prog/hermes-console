# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 04:56（Asia/Taipei）**

**本輪主題：Action-State Causal Credit × Contact Event Attribution × Counterfactual Physics × Intervention-Grounded World Models**

本輪接續前一輪「Material Identity × Conservation Law × Contact Graph × Physical Causal State」，不再重複物質狀態或接觸圖本身，而是補上下一個缺口：**當世界狀態改變時，如何判斷是哪個 action、哪段 contact trajectory、哪個 force/constraint interaction 真正造成了變化，而不是只因時間相鄰就被誤認成原因。**

---

## 本小時新發現

### 新論文 / 新架構

1. **ContactFlow: A video action conditioning that transfers across embodiments** — Sami Azirar, Enrico Pallotta, Jan Nogga, Jürgen Gall, Sven Behnke, Hermann Blum, 2026。以「actor 與 target object 的 3D contact-point trajectory」作為 embodiment-agnostic action representation，將人類與不同機器人示範對齊，並放進 propose → imagine → verify → act pipeline。論文使用 DROID 與真實桌面 manipulation 評估。來源：https://arxiv.org/abs/2607.26579
2. **Causal-JEPA: Learning World Models through Object-Level Latent Interventions** — Heejeong Nam, Quentin Le Lidec, Lucas Maes, Yann LeCun, Randall Balestriero，Brown University / NYU / Mila，2026。使用 object-level masking 迫使模型從其他 objects 推回被遮蔽 object state，形成 latent intervention / causal inductive bias；CLEVRER counterfactual reasoning 約 +20% absolute，Push-T planning 使用約 1% patch-based latent features 仍能維持相近表現。來源：https://arxiv.org/abs/2602.11389；Code：https://github.com/galilai-group/cjepa
3. **V-JEPA 2 / V-JEPA 2-AC** — Meta FAIR，2025。先以 internet-scale video self-supervised pretraining，再用少於 62 小時 DROID robot video post-train action-conditioned latent predictor，並在 Franka 上用 image-goal planning 做 zero-shot pick/place。來源：https://arxiv.org/abs/2506.09985

### 新 GitHub 原始碼觀察

C-JEPA repository 並非只提供 README。`src/` 已確認包含 `cjepa_predictor.py`、`plan/`、`world_models/`、`train/`；`src/plan/` 進一步包含 `run.py`、`solver/`，而 `solver/` 有 `cem.yaml` 與 `gd.yaml`，顯示其 world model 會被接進實際規劃 loop，而不是只做 representation benchmark。

---

# 本小時最重要 5 個發現

## 1. Temporal adjacency ≠ physical causality

**概念**：World state 在 action 後改變，不代表 action 就是唯一真正原因。

底層應拆成：

```text
Action Command
→ Actuator / Controller
→ End-effector motion
→ Contact established?
→ Contact geometry
→ Force / impulse / friction / constraint transmission
→ Object/material response
→ Observed state transition
```

真正需要估的是：

```text
P(ΔS | do(A=a), C, Θ)
```

而不是只有：

```text
P(ΔS | A=a)
```

其中 `C` 是 contact / constraint state，`Θ` 是 material and dynamics parameters。

**重要性**：若杯子同時被另一隻手撞到，或桌子移動，單看 action→next frame 會錯誤 credit assignment。

**限制**：真實世界多數 force/contact 隱藏，只有 RGB 時通常只能做部分識別。

**分類**：上述 decomposition 是工程建模；intervention distinction 與 world-model planning 概念則與 C-JEPA、V-JEPA 2 的 intervention/action-conditioned direction 一致。

---

## 2. Contact trajectory 比 embodiment-specific motor command 更接近 transferable causal action representation

ContactFlow 的關鍵不是單純增加一種 action token，而是把不同 embodiment 的 command：

```text
Human hand trajectory
Robot A joint command
Robot B gripper command
```

投影到共同的物理中介：

```text
3D Contact Point Trajectory
```

因此可以改寫成：

```text
Embodiment Command
→ ContactFlow
→ Object Response
```

而不是：

```text
Robot-specific command
→ pixels
```

這代表 Hermes 的 Physical Causal State 應新增：

```text
ContactTrajectoryID
ContactPatchID
ContactPhase
ContactVelocity
ContactNormal?
ContactDuration
```

並讓 action credit 優先落在「產生作用的 contact event」而不是只落在 high-level command。

**限制**：3D contact trajectory 仍不等於完整 mechanics；如果不知道 normal force、friction、compliance，同一 contact path 仍可能產生完全不同 outcome。

因此新增否定關係：

```text
Contact Trajectory ≠ Force History
Contact Presence ≠ Effective Causal Influence
```

---

## 3. Counterfactual world-model verification 必須比較 outcome delta，而不只是生成漂亮的 alternate video

本輪提出 Hermes runtime probe：

```text
Observed transition:
S_t --A,C--> S_t+1

Counterfactual 1:
do(A = NO-OP)
→ Ŝ_t+1^0

Counterfactual 2:
do(C = no-contact)
→ Ŝ_t+1^nc

Counterfactual 3:
do(force = 0.5×)
→ Ŝ_t+1^half
```

然後計算：

```text
Action Causal Effect
ACE_state = D(Ŝ_t+1^0, Ŝ_t+1^A)

Contact Mediation Effect
CME = D(Ŝ_t+1^nc, Ŝ_t+1^A)
```

`D` 不應只用 pixel distance，而應由多個 physical state distance 組成：

```text
D = w_pose D_pose
  + w_velocity D_velocity
  + w_contact D_contact
  + w_material D_material
  + w_topology D_topology
  + w_lineage D_lineage
```

這是本輪工程建模，尚不是標準統一 metric。

**為什麼重要**：同樣最終畫面可能由不同 action sequence 造成；pixel-level equality 無法證明 action 因果一致。

---

## 4. C-JEPA 顯示「移除自身歷史，逼模型靠其他 objects 推理」是一種實用的 causal inductive bias

C-JEPA 把 patch masking 提升成 object-level masking。核心不是直接宣稱已得到完整 interventionist causality，而是：

```text
Object i history hidden
+ identity anchor retained
+ other object trajectories visible
↓
Predict masked object state
↓
Model 被迫使用 inter-object influence neighborhood
```

這非常適合 Hermes 的 Contact Attribution：

```text
Hide target object's direct post-contact trajectory
↓
保留 actor/contact/neighbor states
↓
Predict target response
```

或反過來：

```text
Remove candidate contact edge
↓
Replay latent dynamics
↓
Target response disappears?
```

這能提供「candidate cause necessity」的 proxy。

但必須清楚區分：

```text
Latent intervention-like masking
≠ Real-world do-intervention
```

C-JEPA 論文本身提供 causal inductive bias 與 counterfactual reasoning evidence，但不能因此把模型內部所有 attention edge 當成真實物理因果。

---

## 5. Action-State Causal Credit 應被建成一張 mediation graph，而不是單一 score

本輪建議 Hermes 新增：

```text
Action #A17
 ↓ commands
Controller motion #M41
 ↓ establishes
Contact #C9
 ↓ transmits
Impulse #I3 / Constraint #K2
 ↓ modifies
Entity State #S82
 ↓ produces
Observation #O95
```

並且每條 edge 具有：

```text
CausalEdgeEstimate
├ source
├ target
├ mechanism_type
├ temporal_support
├ observational_support
├ counterfactual_support
├ intervention_support
├ confidence
├ evidence_roots[]
├ state_version_before
├ state_version_after
└ model_epoch
```

這樣 Hermes 才能回答：

> 「為什麼這個杯子移動？」

而不是只回答：

> 「因為 Agent 剛才執行了 push。」

---

# Architecture Breakdown

```text
User / Planner Intent
↓
Action Proposal
↓
Controller / Tool / Robot Command
↓
Execution Trace
↓
Contact Event Detector
↓
Contact / Constraint Graph
↓
Physical State Estimator
↓
Observed Transition
↓
Candidate Cause Generator
├ action command
├ contact event
├ external disturbance
├ support loss
├ human intervention
└ latent material change
↓
Counterfactual World Model
├ do(no action)
├ do(no contact)
├ do(lower force)
├ do(alternate direction)
├ do(other material θ)
└ do(remove external cause)
↓
Outcome Delta Analyzer
↓
Causal Mediation Graph
↓
Action-State Credit Allocator
↓
Causal Certificate
↓
Memory / Knowledge Graph / Planner Update
```

核心 runtime object：

```text
PhysicalCausalCertificate
├ transition_id
├ pre_state_version
├ post_state_version
├ candidate_causes[]
├ contact_path[]
├ counterfactual_rollouts[]
├ direct_effect
├ mediated_effects[]
├ alternative_causes[]
├ confidence
├ model_epoch
├ evidence_roots[]
└ unresolved_variables[]
```

---

# Bottom-Level Logic

Hermes 若要從「Action 發生」走到「Action 造成結果」，建議完整拆成：

```text
1 Intent
2 Motor / Tool Command
3 Command timing
4 Actuator realization
5 End-effector trajectory
6 Contact onset
7 Contact patch / point trajectory
8 Relative velocity
9 Contact persistence
10 Force / impulse / friction proxy
11 Constraint propagation
12 Object / material response
13 State-transition segmentation
14 Alternative-cause enumeration
15 Counterfactual rollout
16 Outcome delta
17 Mediation attribution
18 Confidence calibration
19 Physical causal certificate
20 World-state commit
```

這也補上之前研究鏈中缺失的一層：

```text
Planner
→ Action
→ Contact
→ Physical Cause
→ State Change
→ Observation
→ Belief Update
```

過去常直接從 `Action → State Change` 跳過中間 mechanics。

---

# Visual Simulation Idea

## Counterfactual Contact & Causal Credit Lab

主畫面同時呈現 observed timeline 與三條 counterfactual branches：

```text
OBSERVED
Push A17
 ↓
Contact C9
 ↓
Block moves +18 cm

CF-1 NO ACTION
No contact
→ Block +0.6 cm

CF-2 SAME MOTION / NO CONTACT
Near-miss
→ Block +0.9 cm

CF-3 HALF CONTACT FORCE
→ Block +8.4 cm
```

右側顯示：

```text
Direct Action Effect       0.08
Contact-Mediated Effect    0.79
External Disturbance       0.05
Unexplained                0.08

Causal Confidence          0.86
```

使用者可以拖動：

```text
Contact point
Contact duration
Force proxy
Friction
Mass
Action direction
External disturbance
```

並立即查看：

```text
predicted next state
contact graph
entity lineage
conservation residual
causal credit distribution
```

這個模擬可以直接回答一般使用者：

> 「AI 為什麼認為這個動作造成了這個結果？」

---

# Code / GitHub

## C-JEPA

Repository：https://github.com/galilai-group/cjepa

值得優先閱讀：

```text
src/cjepa_predictor.py
src/world_models/
src/plan/run.py
src/plan/solver/cem.yaml
src/plan/solver/gd.yaml
src/train/
```

`src/plan/` 中已有 CEM 與 gradient-descent solver 設定，值得下一輪繼續追實際 rollout cost、latent goal distance、action optimization path。

## V-JEPA 2

Official code / architecture 值得追：action-conditioned predictor、latent planning、DROID data adapter、planning objective，以及 robot deployment pipeline。

## ContactFlow

目前本輪已確認論文架構與 DROID / real-world evaluation；下一輪若公開 repository 完整可得，應優先追：contact extraction、3D trajectory representation、video-model conditioning injection、propose-imagine-verify-act loop。

---

# Papers

## ContactFlow: A video action conditioning that transfers across embodiments

- Authors: Sami Azirar, Enrico Pallotta, Jan Nogga, Jürgen Gall, Sven Behnke, Hermann Blum
- Year: 2026
- URL: https://arxiv.org/abs/2607.26579
- Dataset: DROID + real-world tabletop manipulation
- Architecture: 3D contact-point trajectory → embodiment-agnostic conditioning → video generative world model → propose/imagine/verify/act
- Contribution: 將 action abstraction 從 embodiment-specific motor command 提升到 contact-centered physical interaction representation
- Limitation: contact geometry 仍不是完整 force/material mechanics；verification 依賴 VLM 也不等於 formal physical certificate
- 改變了什麼: 提供跨人類/機器人 embodiment 的共同 action representation，使 contact 成為 world model control 的核心中介

## Causal-JEPA: Learning World Models through Object-Level Latent Interventions

- Authors: Heejeong Nam, Quentin Le Lidec, Lucas Maes, Yann LeCun, Randall Balestriero
- Institutions: Brown University, NYU, Mila / Université de Montréal
- Year: 2026
- URL: https://arxiv.org/abs/2602.11389
- Code: https://github.com/galilai-group/cjepa
- Datasets / tasks: CLEVRER, Push-T
- Architecture: object-centric encoder → object-level masking → JEPA predictor → future latent prediction → MPC
- Contribution: object-level masking forces interaction-aware prediction，提升 counterfactual reasoning，並大幅減少 planning latent feature count
- Limitations: object extractor quality limits system；latent intervention 不等於真實 do-intervention；主要 benchmark 仍偏結構化 / manipulation setting
- 改變了什麼: 把 causal inductive bias 直接放進 representation/prediction training，而不是事後才做 causal graph analysis

## V-JEPA 2: Self-Supervised Video Models Enable Understanding, Prediction and Planning

- Authors: Mahmoud Assran et al., Meta FAIR
- Year: 2025
- URL: https://arxiv.org/abs/2506.09985
- Dataset: web-scale video pretraining；<62h DROID robot videos for V-JEPA 2-AC post-training
- Architecture: masked latent video prediction → action-conditioned latent world model → latent planning
- Contribution: 從大量無標註影片學動態 representation，再用少量 robot interaction data 形成可規劃 world model
- Limitation: latent future fidelity 不自然等同 full contact/force causality；主要 real-robot result 聚焦 pick/place
- 改變了什麼: 顯示「video representation → action-conditioned latent predictor → real-world planning」可形成可落地 world model pipeline

---

# Unknown / Open Questions

1. **Contact mediation 的 ground truth 怎麼取得？** 只有 RGB-D 時，force/impulse/friction 常不可觀測；是否要引入 tactile/FT sensor 或 learned latent-force estimator？
2. **Counterfactual rollout 怎麼校準？** 若 world model 在 OOD intervention 下 hallucinate，causal credit 可能比 observational attribution 更糟。
3. **一個 transition 可以同時有多個必要原因時，credit 怎麼分？** 例如 two-hand manipulation、support removal + gravity、human/robot collaborative manipulation；需要 Shapley-style causal contribution 還是 structural mediation decomposition？

---

# 下一輪研究

下一層缺口：

## Hidden Physical Variable Inference × Latent Force × Friction / Mass Identification × Active Experiment Design

下一輪要回答：

```text
Camera 看不到 force
Camera 看不到 friction
Camera 不直接知道 mass
Camera 不直接知道 compliance

那 Agent 怎麼知道：
「要推多大力？」
「為什麼滑掉？」
「為什麼同一 contact trajectory 結果不同？」
```

建議研究鏈：

```text
Observation History
+ Action History
+ Contact Events
↓
Hidden Physical Parameter Posterior
├ mass
├ friction
├ stiffness
├ damping
├ compliance
└ latent force
↓
Candidate Probe Action
↓
Expected Information Gain
↓
Active Experiment
↓
New Observation
↓
Posterior Update
↓
Safer Planning
```

要特別連回先前的 System Identification Plane，形成：

```text
Semantic / Agent System Identification
+
Physical Parameter System Identification
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

- Action-State Causal Credit
- Physical Causal Certificate
- Contact Mediation
- Contact Trajectory
- Contact Patch
- Contact Phase
- Effective Contact
- Counterfactual Physics
- Counterfactual Rollout
- No-Action Intervention
- No-Contact Intervention
- Force Intervention
- Outcome Delta
- Physical Mediation Graph
- Action Causal Effect
- Contact-Mediated Effect
- Alternative Physical Cause
- External Disturbance Cause
- Mechanism Edge
- Causal Credit Distribution
- Intervention Fidelity

## Edges

```text
Action --COMMANDS→ Controller Motion
Controller Motion --ESTABLISHES→ Contact
Contact --MEDIATES→ Force/Constraint Transmission
Force/Constraint --CAUSES→ Material/Object Response
Response --PRODUCES→ State Transition
Counterfactual Intervention --REMOVES→ Candidate Cause
Counterfactual Rollout --ESTIMATES→ Outcome Delta
Outcome Delta --SUPPORTS→ Causal Edge
Physical Causal Certificate --JUSTIFIES→ World-State Commit
```

## Negative / distinction edges

```text
Temporal Adjacency ≠ Physical Causality
Action Command ≠ Physical Effect
Contact Presence ≠ Effective Cause
Contact Trajectory ≠ Force History
Visual Motion ≠ Mechanism
World-Model Prediction ≠ Causal Proof
Latent Intervention ≠ Real do-Intervention
Pixel Difference ≠ Physical Outcome Difference
Same Final Frame ≠ Same Causal Path
High Planning Success ≠ Correct Causal Attribution
```

---

# 本輪結束判定

- **缺哪一層：** Hidden Physical Variable Inference / active identification
- **哪個節點最淺：** calibrated Contact-Mediated Effect 與 multi-cause credit allocation
- **哪個概念仍只是名詞：** Universal `PhysicalCausalCertificate ABI`、ContactTrajectoryID、Intervention Fidelity Score
- **哪個系統值得讀原始碼：** C-JEPA 的 `src/cjepa_predictor.py`、`src/plan/run.py`、`src/world_models/`；其次 V-JEPA 2 action-conditioned planning code
- **哪篇論文需追引用：** ContactFlow、Causal-JEPA、V-JEPA 2
- **哪個概念最適合視覺模擬：** Counterfactual Contact & Causal Credit Lab
- **哪個 Agent 架構最值得實作：** `Intervention-Grounded Embodied Agent Runtime = Physical State Estimator + Contact Event Graph + Counterfactual World Model + Causal Mediation Graph + Action-State Credit + Physical Causal Certificate + Active Verification Gate`

---

# 本輪對「AI 到底怎麼運作」新增的一層

目前鏈條可再細化為：

```text
User Intent
→ Planner
→ Action Proposal
→ Controller
→ Physical Motion
→ Contact
→ Force / Constraint Mediation
→ Object / Material Response
→ State Transition
→ Camera / Touch / Force Observation
→ Encoder
→ World-State Belief
→ Counterfactual Replay
→ Causal Attribution
→ Memory / Knowledge Graph
→ Next Decision
```

也就是：**成熟的 embodied Agent 不應只知道「我做了什麼，之後看到了什麼」，還要知道「我的命令是否真的造成接觸、接觸透過什麼物理機制改變世界、如果沒有這個 action/contact 世界會怎樣，以及這個因果判斷的可信度有多高」。**