# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 05:52（Asia/Taipei）**

**本輪主題：Hidden Physical Variable Inference × Active System Identification × Expected Information Gain × Physics-Informed Exploration**

本輪接續上一輪「Action-State Causal Credit × Contact Event Attribution × Counterfactual Physics」。上一輪已能回答「哪個 action/contact 造成了 state change」，但仍留下更底層的不可觀測變數：mass、friction、stiffness、damping、compliance、latent force。這輪不重複 contact graph，而是研究 Agent 如何主動設計 interaction，把不可見的物理參數從 hidden state 變成可更新的 belief。

---

## 本小時新發現

### 新論文 / 新架構

1. **PhysCaP: Grounding Code-as-Policy Agent with Physics-Informed Exploration** — Chen-Yu Lin et al., National Taiwan University / NVIDIA Research / Google DeepMind / National Yang Ming Chiao Tung University, 2026-08-21。將 Code-as-Policy 加入 Planner + Prioritizer + training-free PhysX probes，能從 proprioception 主動估 mass / stiffness。URL: https://arxiv.org/abs/2608.21031；Project: https://physcap.github.io/
2. **System Identification under Constraints and Disturbance: A Bayesian Estimation Approach** — Sergi Martinez, Steve Tonneau, Carlos Mastalli, 2026。共同估 state trajectory 與 physical parameters，將 inverse dynamics、contact、loop closure、nonlinear friction 作為 constrained estimation 問題，並導出線性隨 horizon 成長的 equality-constrained Riccati recursion。URL: https://arxiv.org/abs/2602.16358
3. **Real2Sim based on Active Perception with automatically VLM-generated Behavior Trees** — Alessandro Adami, Sebastian Zudaire, Ruggero Carli, Pietro Falco, 2026。VLM 根據使用者 simulation goal 找出缺失物理參數，生成 Behavior Tree 主動量測 mass、surface height、friction-related quantities，再建立 MuJoCo physics-aware replica。URL: https://arxiv.org/abs/2601.08454
4. **An Approximate Bayesian Approach to Optimal Input Signal Design for System Identification** — Piotr Bania, Anna Wójcik, AGH University of Krakow, Entropy 2025。將 parameter-observation mutual information 作為 input design utility，以可計算 lower bound 近似 Expected Information Gain，處理 nonlinear/stochastic SysID。DOI: https://doi.org/10.3390/e27101041
5. **SaPaVe** — Mengzhen Liu et al., Peking University / Beihang University / BAAI, CVPR 2026 Highlight。雖非 physical-parameter SysID，但證明 active perception action 與 manipulation action 應分離但協同；ActiveViewPose-200K 提供 200k image-language-camera movement pairs。URL: https://arxiv.org/abs/2603.12193

### 新 GitHub / 原始碼觀察

PhysCaP 的公開 repository `physcap/physcap.github.io` 雖不是完整 robot stack，但不是只有 README；`static/codes/` 已公開多組 generated Code-as-Policy traces，包括 `avo_05_ours_code.py`、`can_03_planner_code.py`、`cubes_02_phyX_code.py` 等。實際程式會呼叫 `get_weight/get_stiffness/get_object_pose/goto_pose/breakpoint_code_block`，並根據量測結果決定繼續探索或完成任務。這證實 PhysX 在 agent loop 中是可呼叫的 tool abstraction，而不是只存在 paper diagram。

---

# 本小時最重要 5 個發現

## 1. Passive perception 無法辨識所有 decision-relevant state；interaction 本身必須成為 sensor

**已確認事實 / 論文結果：** PhysCaP 專門處理 camera 無法直接恢復的 latent physical property。官方 project page 顯示 mass 由 fixed-lift 前後 joint torque difference + end-effector Jacobian估計；stiffness 則由 gripper displacement + normalized motor effort，經 repeated measurements / majority vote 分級。

底層鏈：

```text
Task intent
→ Identify missing physical variable θ
→ Select candidate object
→ Execute probing action u_probe
→ Read proprioception y
→ Physical estimator
→ θ estimate / belief update
→ Re-plan
```

因此：

```text
Sensor ≠ only Camera/Microphone
Action can be a measurement operator
```

**重要性：** Agent 若只把 action 當「改變世界」，就無法主動學習看不到的 mass、friction、stiffness。

**限制：** PhysCaP 目前主要是 narrow task probes；mass/stiffness estimator 的可移植性取決於 robot calibration、object grasp、trajectory 與 controller。

---

## 2. Hidden physical state 應表示成 posterior，而不是一次量測後寫死成 fact

上一輪 Hermes 已有 `PhysicalCausalCertificate`；本輪建議新增：

```text
PhysicalParameterBelief
├ parameter_id
├ entity_id
├ parameter_type
├ posterior / interval
├ estimator
├ observation_ids[]
├ probe_action_ids[]
├ contact_ids[]
├ model_epoch
├ calibration_epoch
├ confidence
├ last_updated_at
└ observability_status
```

Bayesian SysID 的核心是共同估：

```text
p(x_1:T, θ | y_1:T, u_1:T)
```

而不是只求：

```text
θ = point estimate
```

**為什麼重要：** 若 mass 與 friction 對同一 motion 都能產生類似 effect，單次 observation 通常不可識別；posterior 可以保留 ambiguity。

新增原則：

```text
Physical Estimate ≠ Physical Fact
Low residual ≠ Parameter identifiability
```

---

## 3. Active System Identification 的核心不是「多試幾次」，而是選最有資訊的 probe

將候選 probe `u` 視為 experiment design：

```text
Prior p(θ)
+ candidate probe u
+ predictive observation p(y | θ,u)
↓
Expected posterior p(θ | y,u)
↓
Expected Information Gain
EIG(u) = E_y[ KL(p(θ|y,u) || p(θ)) ]
```

Hermes 不應只最大化資訊，而應做 utility：

```text
U(u)
= α EIG(u)
- β physical_risk(u)
- γ time_cost(u)
- δ energy_cost(u)
- ε irreversible_change(u)
```

**論文支撐：** Bayesian optimal input design 明確以 parameter-observation mutual information 作 utility；PhysCaP 則以 Planner/Prioritizer 減少 unnecessary interactions。兩者一個偏 formal experiment design、一個偏 agent engineering，方向互補。

**合理推論 / 工程建模：** PhysCaP 官方稱 Prioritizer 依 expected information gain 排序，但公開頁面呈現的是 heuristic/VLM prioritization；不能把它等同於已計算完整 Bayesian EIG integral。

因此新增：

```text
Heuristic Priority ≠ Bayesian Expected Information Gain
```

---

## 4. Bottom-level mass identification 可以直接從 torque residual → wrench → gravitational parameter

PhysCaP 的 mass probe 可拆成：

```text
Empty lift trajectory
→ τ_empty(q)

Loaded same trajectory
→ τ_loaded(q)

Δτ = τ_loaded - τ_empty
→ isolate added gravitational load

End-effector Jacobian J
→ joint-space torque ↔ Cartesian wrench mapping
→ vertical gravitational component
→ mass estimate m_hat
```

公開技術摘要給出的 estimator：

```text
m_hat = (J_z · Δτ) / (g ||J_z||²)
```

這是本輪至少一個真正的 bottom-level mechanism：從 actuator telemetry 經 robot kinematics 反推出 latent physical parameter。

但需要明列：

```text
Torque Difference ≠ Pure Object Gravity
```

因為還可能含 acceleration transient、controller error、joint friction、grasp shift、sensor bias。因此更成熟的 Hermes 應把 Bayesian constrained SysID 的 friction/contact/disturbance model接進來，而不是只做單一 algebraic estimator。

---

## 5. System architecture 應從「Agent→Tool」升級成「Agent→Probe Designer→Estimator→Belief→Planner」閉環

本輪提出：

```text
User Goal
↓
Task Planner
↓
Decision-Relevant Unknown Detector
↓
Physical Parameter Belief
↓
Observability Analyzer
↓
Probe Candidate Generator
↓
Probe Utility Evaluator
├ expected information gain
├ safety
├ cost
├ reversibility
└ task relevance
↓
Probe Executor
↓
Sensor / Proprioception / Force / Vision Trace
↓
System Identifier
↓
Posterior Update
↓
Stop / Probe Again / Execute Task
↺
```

這把 Agent loop 從：

```text
Intent→Tool Schema→Selection→Arguments→Execution→Observation→Context→Next Decision
```

再拆成 physical-learning version：

```text
Intent
→ Unknown θ
→ Probe schema
→ Experiment selection
→ Safe execution
→ Raw telemetry
→ Residual extraction
→ Parameter likelihood
→ Posterior
→ Information gain
→ Stop decision
→ Task action
```

---

# Architecture Breakdown

## Physics-Informed Active Identification Plane

```text
UI / Goal
↓
Agent Planner
↓
Task Dependency Graph
↓
Unknown Physical Variable Resolver
├ mass
├ friction
├ stiffness
├ damping
├ compliance
├ center of mass
└ latent external force
↓
Physical Belief Store p(θ)
↓
Observability / Identifiability Check
↓
Experiment Designer
├ heuristic PhysCaP-style ranking
├ Fisher-information proxy
└ Bayesian EIG
↓
Safety / Permission Gate
↓
Probe Action
↓
Robot Runtime / Tool Runtime
↓
Telemetry Bus
├ joint torque
├ joint position/velocity
├ motor effort
├ gripper displacement
├ RGB-D
├ tactile/force if available
└ contact state
↓
Estimator
├ algebraic PhysX
├ Bayesian constrained SysID
└ hybrid differentiable physics
↓
Posterior Update
↓
Information Gain / Residual / Confidence
↓
Planner
```

對 Hermes 的意義：`get_mass()` 不應只是普通 tool call，而應留下完整 `ProbeEpisode`，保存 probe design、prior、telemetry、estimator、posterior、risk/cost 與 evidence lineage。

---

# Bottom-Level Logic

## Hidden mass

```text
Known robot state q, dq
→ repeatable empty trajectory
→ baseline torque τ0
→ grasp object
→ same trajectory
→ loaded torque τ1
→ Δτ
→ Jacobian projection
→ gravitational load estimate
→ likelihood p(y|m)
→ posterior p(m|y)
```

## Hidden stiffness

```text
Open gripper
→ incremental close
→ effort rise
→ backoff validation of real contact
→ reference displacement d0
→ increase normalized effort toward target f*
→ deformation Δd
→ repeat N times
→ classify / fit stiffness proxy
→ posterior / ordinal confidence
```

## Hidden friction（Hermes 下一階段應實作）

```text
Contact established
→ controlled tangential excitation
→ detect slip onset
→ estimate normal/tangential load
→ friction likelihood
→ posterior over μ
```

這最後一段是工程設計方向，不宣稱為 PhysCaP 現有功能。

---

# Visual Simulation Idea

## Hidden Physics & Active Experiment Lab

左側顯示「AI 看得到什麼」：

```text
Camera:
red can
closed lid
same shape
same apparent size

Unknown:
mass ?
friction ?
stiffness ?
```

中央是 posterior：

```text
Mass belief
0–100 g     0.38
100–300 g   0.45
300–800 g   0.17
Entropy     1.48
```

右側列候選 probes：

```text
LIFT 15 cm
EIG 0.91 | risk .08 | time 4.2 s

PUSH 2 cm
EIG 0.36 | risk .05 | time 2.1 s

SQUEEZE
EIG 0.05 | risk .22 | time 5.4 s
```

按下 LIFT 後即時播放：

```text
τ_empty(t)
τ_loaded(t)
Δτ(t)
Jacobian projection
↓
mass posterior
↓
Entropy 1.48 → 0.22
```

並同步顯示：

```text
Information gained     +1.26
Physical risk          low
Task ambiguity         resolved
Next decision          PICK CAN #3
```

這會把「Agent 為什麼要摸、推、抬一個東西」從黑箱行為轉成可視化的信息獲取。

---

# Code / GitHub

## PhysCaP project repository

Repository: https://github.com/physcap/physcap.github.io

已確認值得看的路徑：

```text
static/codes/
├ avo_02_phyx_code.py
├ avo_03_planner_code.py
├ avo_05_ours_code.py
├ can_02_planner_code.py
├ can_03_planner_code.py
├ can_05_ours_code.py
├ cubes_02_phyX_code.py
└ cubes_03_planner_code.py
```

`avo_05_ours_code.py` 實際使用 `get_stiffness()`，若 stiffness <= 2 則進行 pick/place，否則 `breakpoint_code_block()` 取得下一輪 observation，再探測下一顆 avocado。

`can_03_planner_code.py` 顯示較 naive 的 sequential probing：逐罐 `get_weight()`，以 threshold `<0.1` 判斷 empty，再決定是否搬運；非常適合作為 Hermes「heuristic search vs information-efficient prioritization」的可視化比較 baseline。

**重要限制：** 公開 repository 目前主要是 project-page + generated code traces；尚未確認完整 robot-control / PhysX implementation source。因此不可宣稱已讀到 `get_mass`、`get_stiffness` 的完整底層實作。

---

# Papers

## PhysCaP: Grounding Code-as-Policy Agent with Physics-Informed Exploration
- Authors: Chen-Yu Lin et al.
- Institutions: National Taiwan University, NVIDIA Research, Google DeepMind, National Yang Ming Chiao Tung University
- Year: 2026
- URL: https://arxiv.org/abs/2608.21031
- Code/Project: https://physcap.github.io/ ; https://github.com/physcap/physcap.github.io
- Dataset/Benchmark: 3 real tabletop tasks + LIBERO hidden-property task
- Architecture: Planner → Prioritizer → Coding Agent → PhysX probe → observation → next decision
- Contribution: 將 latent physical properties 變成 Agent 可主動呼叫的 information-seeking tools
- Limitations: narrow property set、heuristic prioritization、完整 PhysX runtime source 未確認公開
- 改變了什麼: 把 embodied agent 的 perception 從被動 camera observation 推進成「主動物理量測」

## System Identification under Constraints and Disturbance: A Bayesian Estimation Approach
- Authors: Sergi Martinez, Steve Tonneau, Carlos Mastalli
- Year: 2026
- URL: https://arxiv.org/abs/2602.16358
- Architecture: constrained Bayesian trajectory + parameter estimation, inverse dynamics, friction/contact constraints, Riccati recursion
- Contribution: 將 state、inertial/friction parameters、disturbance consistency 放入共同 physically constrained estimator
- Limitations: 偏 robot dynamics SysID，不是通用 LLM-agent planner
- 改變了什麼: 補足 PhysCaP heuristic probe 後面的 rigorous parameter-belief layer

## Real2Sim based on Active Perception with automatically VLM-generated Behavior Trees
- Authors: Alessandro Adami, Sebastian Zudaire, Ruggero Carli, Pietro Falco
- Year: 2026
- URL: https://arxiv.org/abs/2601.08454
- Architecture: user objective + incomplete simulation + RGB → VLM → Behavior Tree over atomic actions → compliant robot measurements → MuJoCo replica
- Contribution: task-specific autonomous physical parameter acquisition
- Limitations: VLM-generated BT correctness、安全與 parameter identifiability 仍需 external constraints
- 改變了什麼: 將「哪些參數值得量」與 user’s simulation goal 綁定

## An Approximate Bayesian Approach to Optimal Input Signal Design for System Identification
- Authors: Piotr Bania, Anna Wójcik
- Institution: AGH University of Krakow
- Year: 2025
- DOI: https://doi.org/10.3390/e27101041
- Architecture: nonlinear/stochastic system + Bayesian parameter prior + MI lower-bound utility → optimal input design
- Contribution: 用 Expected Information Gain formalize「下一個 probe 應怎麼選」
- Limitations: 非 Agent / robotics-specific，實際 EIG approximation 仍可能昂貴
- 改變了什麼: 為 Hermes Probe Utility 提供比 heuristic ranking 更嚴格的數學基礎

---

# Unknown / Open Questions

1. **Joint identifiability**：mass、friction、center-of-mass、controller bias 可能同時解釋同一段 torque residual；Hermes 如何知道「目前 probe 根本分不開這些參數」？
2. **Safe information gain**：最高 EIG 的 experiment 可能也是最危險、最不可逆；如何把 safety constraint、permission、damage probability 放進 probe design，而不是事後阻擋？
3. **Model discrepancy**：若 simulator / inverse dynamics 本身錯誤，posterior 可能很窄但很錯；需要同時估 physical parameters 與 model discrepancy / residual dynamics。

---

# 下一輪研究

下一個最深缺口：

## Observability × Identifiability × Fisher Information × Safe Active Experiment Design

本輪已建立：

```text
Unknown θ
→ Probe
→ Telemetry
→ Estimator
→ Posterior
```

下一輪要回答：

```text
什麼情況下 θ 根本不可識別？
哪個 probe 可以讓兩個 competing hypotheses 分開？
需要多少 excitation 才足夠？
如何在 safety constraint 下最大化 Fisher / Bayesian information？
```

建議下一輪完整鏈：

```text
Candidate parameters θ
↓
Sensitivity / Jacobian
↓
Observability matrix / Fisher Information
↓
Rank / condition number
↓
Unidentifiable subspace
↓
Safe probe generator
↓
Expected information gain
↓
Constrained experiment selection
↓
Execution
↓
Posterior calibration
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

- Hidden Physical Variable
- Physical Parameter Belief
- PhysicalParameterBelief ABI
- Probe Action
- Probe Episode
- Physical Property Extraction Tool
- Active System Identification
- Active Experiment Design
- Expected Information Gain
- Probe Utility
- Observability Status
- Identifiability
- Torque Residual
- Jacobian Projection
- Mass Posterior
- Stiffness Posterior
- Friction Posterior
- Calibration Epoch
- Model Discrepancy
- Exploration Stopping Rule

## Edges

```text
Task --REQUIRES_KNOWLEDGE_OF→ PhysicalParameter
PhysicalParameter --HAS_BELIEF→ Posterior
Agent --PROPOSES→ ProbeAction
ProbeAction --EXCITES→ PhysicalSystem
ProbeAction --PRODUCES→ Telemetry
Telemetry --UPDATES→ PhysicalParameterBelief
ProbeAction --HAS_EXPECTED_INFORMATION_GAIN→ EIG
ProbeAction --HAS_PHYSICAL_RISK→ Risk
ProbeEpisode --SUPPORTS→ PhysicalCausalCertificate
ParameterBelief --CONDITIONS→ PlannerAction
```

## Negative / distinction edges

```text
Passive Observation ≠ Complete Physical State
Action ≠ Only World Modification
Physical Estimate ≠ Physical Fact
Low Prediction Residual ≠ Identifiability
Heuristic Priority ≠ Bayesian EIG
Joint Torque ≠ Object Mass
Torque Difference ≠ Pure Gravity
Contact ≠ Known Friction
One Probe ≠ Calibrated Posterior
High Information Gain ≠ Safe Experiment
Narrow Posterior ≠ Correct Model
```

---

# 本輪收斂回答

- **缺哪一層：** Observability / Identifiability-aware experiment design。
- **哪個節點最淺：** `PhysicalParameterBelief` 的 calibrated posterior 與 correlated parameter representation。
- **哪個概念仍只是名詞：** Universal `ProbeEpisode ABI`、Safe EIG、cross-robot PhysicalParameterBelief ABI。
- **哪個系統值得讀原始碼：** PhysCaP 若後續公開完整 PhysX/runtime；其次是 constrained Bayesian SysID implementation，因為它能補上 friction/contact/disturbance 的嚴格 estimator。
- **哪篇論文需追引用：** PhysCaP、System Identification under Constraints and Disturbance、Bayesian optimal input signal design。
- **哪個概念最適合視覺模擬：** Hidden Physics & Active Experiment Lab。
- **哪個 Agent 架構最值得實作：** `Physics-Informed Active Identification Agent = Unknown Detector + Physical Belief Store + Observability Analyzer + Probe Designer + Safety Gate + Telemetry Bus + Bayesian/Physics Estimator + Information-Gain Stop Rule`。

本輪最大的推進是：**成熟 embodied Agent 不只要從影像推理世界，而要知道「自己不知道什麼」，把未知 mass/friction/stiffness 表示成 belief，選一個安全而有資訊量的 interaction 主動詢問物理世界，再用 proprioception/contact/vision 更新 posterior。也就是把 Action 從單純 actuator command 升級成 experiment。**
