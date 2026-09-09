# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 17:51（Asia/Taipei）**

**本輪主題：Action Model × Affordance × Preconditions/Effects × PDDL/BDDL × Learned Transition Model × Execution Verification**

本輪接續上一輪 `Object-Centric World Model × Relation Persistence × Dynamic Scene Graph × Causal State Transition`，刻意不再重複 scene graph / entity identity，而往下一層追：**世界狀態已經存在之後，Agent 到底如何知道「現在可以做什麼」、某個 action 需要哪些前提、會改變哪些狀態，以及執行後如何驗證 effect？**

核心鏈：

```text
World Belief B_t
↓
Goal / Intent
↓
Action Candidate Generator
↓
Affordance Filter
↓
Precondition Evaluator
↓
Permission / Safety Gate
↓
Feasibility Check
↓
Action Execution
↓
Predicted Effect
↓
Observed Effect
↓
Effect Verifier
↓
Belief Revision
↓
B_t+1
```

---

## 本小時新發現

1. **PDDL/STRIPS 與 BDDL 在 Agent Runtime 中扮演不同角色。** PDDL action schema 明確包含 parameters、precondition、effect；BDDL（BEHAVIOR Domain Definition Language）則以 object list、`:init`、`:goal` 描述活動狀態，而且官方明確稱它 process-agnostic。也就是 BDDL 更像「任務 / world-state specification」，而不是完整的 classical action model。
2. **OmniGibson 的 action primitive runtime 已直接實作 precondition error 與 postcondition error。** `symbolic_semantic_action_primitives.py` 的 `OPEN/CLOSE/GRASP/TOGGLE/PLACE` 等 primitive 不只執行 action，還會先檢查「手是否空、物件是否 openable/toggleable」，執行後再重新讀 object state，若沒有達到預期狀態就拋 `POST_CONDITION_ERROR`。
3. **Affordance 不應等同 Action Precondition。** Affordance 表示 object/action pair 具有可操作可能性；precondition 則表示這一刻執行某 action 所需的世界條件已成立。2026 AGWM 更進一步把 action prerequisite dependencies 建成 DAG，追蹤 action 的 dynamic executability。
4. **Learned world model 最大風險之一，是把「action 與 outcome 常一起出現」誤學成無條件轉移。** AGWM 將這個問題明確化：若忽略 prerequisites，multi-step imagined rollout 會在錯誤 affordance state 上繼續模擬並累積 error。
5. **World Action Model 正把 `action generation` 與 `future effect prediction` 合在同一模型中，但仍需要 reality verification。** `τ0-WM` 同時產生 action chunks 與 predicted future video/task progress；`When to Trust Imagination` 則把 predicted future 和真實 observation 比較，用來決定是否繼續執行剩餘 action chunk 或提早 replan。

---

# 本小時最重要 5 個發現

## 1. Action Model 的最小 primitive 是 `Precondition → Transition → Effect`，不是 action label

### 是什麼

在 classical planning 裡，一個 action 不只是：

```text
OPEN(cabinet)
```

而是：

```text
ActionSchema
├ name
├ parameters
├ preconditions
└ effects
```

PDDL / STRIPS 可以表示：

```text
(:action open
 :parameters (?x)
 :precondition (and
   (openable ?x)
   (closed ?x)
   (hand-empty)
 )
 :effect (and
   (open ?x)
   (not (closed ?x))
 )
)
```

### Bottom-level mechanism

對世界狀態 `S_t` 與 action `a`：

```text
Executable(a, S_t)
=
Preconditions(a) ⊆ Facts(S_t)
```

若成立：

```text
S'_t
=
(S_t - DeleteEffects(a))
∪ AddEffects(a)
```

但在真實 Agent runtime 中不能直接把 `S'_t` 當真實世界；它只是 predicted state：

```text
S_t
+
a_t
↓
Action Model
↓
Predicted S_hat(t+1)

Environment
↓
Observed O(t+1)
↓
State Estimator
↓
Observed S_obs(t+1)

Compare:
S_hat(t+1) vs S_obs(t+1)
```

### 為什麼重要

LLM 只輸出 action name 時，Agent 不知道：

```text
為何能做？
為何不能做？
哪個條件缺失？
成功後應該改哪個 relation？
```

Action model 讓失敗可以被歸因成：

```text
PRECONDITION_FALSE
PERMISSION_DENIED
PHYSICAL_INFEASIBLE
EXECUTION_FAILED
POSTCONDITION_FALSE
WORLD_CHANGED
```

### 限制

符號 action schema 需要 predicate ontology；連續物理世界中的摩擦、接觸、碰撞、幾何可達性很難全部離散化成 predicates。

### 來源

- PDDL action / precondition / effect reference: https://users.cecs.anu.edu.au/~patrik/pddlman/writing.html
- AI-Planning PDDL parser: https://github.com/AI-Planning/pddl

---

## 2. BDDL 與 PDDL 不應混為一談：Goal Specification ≠ Action Model

### 已確認事實

BEHAVIOR-1K 的 BDDL README 明確說：BDDL 是受 PDDL 啟發但不同的 domain-specific language。每個 activity problem 主要由：

```text
:objects
:init
:goal
```

構成，而且 BDDL 是 **process-agnostic**：描述 Agent 最終要讓 simulator 到達什麼狀態，而不是規定 Agent 必須使用哪一套 action transition rules。

因此：

```text
BDDL
≈ Task / State Specification
```

而：

```text
PDDL Domain
≈ Predicate + Action Schema + Transition Specification
```

### 為什麼重要

如果 Hermes 只把 BDDL goal 當作 planner action model，會產生缺口：

```text
Goal:
(cooked potato)

但：
到底哪些 action 能導致 cooked？
需要 stove on 嗎？
potato 必須 inside pan 嗎？
多久？
失敗怎麼判斷？
```

在 BEHAVIOR runtime，這些細節部分落在：

```text
OmniGibson/
├ action_primitives/
├ object_states/
├ transition_rules.py
├ tasks/
├ controllers/
└ simulator physics
```

### GitHub 原始碼驗證

`symbolic_semantic_action_primitives.py` 明確定義：

```text
GRASP
PLACE_ON_TOP
PLACE_INSIDE
OPEN
CLOSE
TOGGLE_ON
TOGGLE_OFF
SOAK_UNDER
SOAK_INSIDE
WIPE
CUT
PLACE_NEAR_HEATING_ELEMENT
NAVIGATE_TO
RELEASE
```

並在 primitive runtime 中真的做 pre/post checks。

例如 `OPEN/CLOSE`：

```text
if hand contains object
→ PRE_CONDITION_ERROR

if target not Open-capable
→ PRE_CONDITION_ERROR

set Open state
↓
settle
↓
read Open state again
↓
if mismatch
→ POST_CONDITION_ERROR
```

這是 Agent action semantics 很值得借鑑的工程模式。

### 來源

- BDDL README: https://github.com/StanfordVL/BEHAVIOR-1K/blob/main/bddl3/README.md
- BEHAVIOR task docs: https://github.com/StanfordVL/BEHAVIOR-1K/blob/main/docs/behavior_components/behavior_tasks.md
- OmniGibson action primitives: `OmniGibson/omnigibson/action_primitives/symbolic_semantic_action_primitives.py`

---

## 3. Affordance ≠ Precondition ≠ Permission ≠ Feasibility

這輪正式拆成四個不同節點。

### Affordance

```text
object × action
→ 這種 interaction 是否有意義 / 可能？
```

例如：

```text
cup affords grasp
button affords click
cabinet affords open
```

### Action Precondition

```text
此時此刻世界是否滿足 action 所需條件？
```

例如：

```text
cabinet affords OPEN
```

但：

```text
robot holding a large box
→ OPEN precondition false
```

### Permission

即使 affordance + precondition 都成立：

```text
DELETE production database
```

仍可能：

```text
permission denied
```

### Physical / Runtime Feasibility

符號上：

```text
GRASP(cup)
```

可能合法，但：

```text
cup outside robot reach
collision path blocked
gripper too small
network tool unavailable
```

使 execution 不可行。

因此 Hermes 應使用：

```text
Candidate Action
↓
Affordance Gate
↓
Precondition Gate
↓
Permission Gate
↓
Feasibility Gate
↓
Execute
```

而不是單一 `can_do=true`。

### AGWM 提供的關鍵補充

AGWM 指出 affordance state 會被過去 action 改變。它把 prerequisite dependencies 建成 DAG：

```text
A ─prerequisite→ B ─prerequisite→ C
```

只有前置結構成立，後續 action 才 executable。

這表示 action space 不是固定集合：

```text
AvailableActions_t
≠
AvailableActions_t+1
```

### 來源

- AGWM: https://arxiv.org/abs/2605.06841
- AGWM authors: Qinshi Zhang, Weipeng Deng, Zhihan Jiang, Jiaming Qu, Qianren Li, Weitao Xu, Ray LC
- Affiliations reported by paper index: UC San Diego, University of Hong Kong, Columbia University, Amazon, City University of Hong Kong
- Year: 2026
- Code: 本輪未找到作者正式 code repository；需下一輪持續追蹤
- Dataset/environment: game-based simulated compositional prerequisite environments
- Contribution: dynamic affordance DAG + structure-changing events
- Limitation: 是否能直接擴展到 open-world robotics / browser / tool agents 尚未證實

---

## 4. Symbolic Transition 與 Learned Transition 應並存，而不是二選一

### Symbolic transition

```text
OPEN(cabinet)
Pre:
closed(cabinet)
hand_empty

Effect:
open(cabinet)
¬closed(cabinet)
```

優點：

```text
可檢查
可解釋
可搜尋
可驗證
```

缺點：

```text
難描述 continuous dynamics
難覆蓋未知 interaction
人工 ontology 成本高
```

### Learned transition model

```text
Observation / Latent State
+
Action
↓
Neural Dynamics Model
↓
Future State / Video / Latent
```

優點：

```text
可學 complex physical effects
可利用 raw multimodal experience
不需全部手寫 predicates
```

缺點：

```text
可能 hallucinate impossible effect
可能忽略 prerequisite
難保證 constraint consistency
```

### 2026 WAM 代表架構：τ0-WM

`τ0-WM` 將：

```text
Multi-view Observation
+ Language
+ Robot State
↓
Shared Video Diffusion Backbone
├ Video Action Model
│  → future visual latents
│  → continuous action chunks
│
└ Action-conditioned Video Simulator
   → candidate action rollout
   → predicted future video
   → dense task-progress score
```

接在一起。

Inference：

```text
Sample candidate actions
↓
Predict / score futures
↓
Rank candidates
↓
Rectify low-quality candidates
↓
Execute
```

### Paper metadata

- Title: τ0-WM: A Unified Video-Action World Model for Robotic Manipulation
- Authors: Pengfei Zhou, Shengcong Chen, Di Chen, Jiaxu Wang, Rongjun Jin, Bingwen Zhu, Yike Pan, Songen Gu, Kuanning Wang, Shufeng Nan, Xingyu Qiu, Chenhao Qiu, Pu Yang, Yunuo Cai, Jianxiong Gao, Yifan Li, Yanwei Fu, Xiangyu Yue, Zhi Chen, Jianlan Luo
- Year: 2026
- URL: https://arxiv.org/abs/2606.01027
- Code: 本輪搜尋結果未確認正式 GitHub source；持續追蹤
- Dataset: 約 27,300 小時 real-robot teleoperation、UMI-style interaction、egocentric human videos、rollout/failure trajectories（依論文摘要）
- Architecture: shared video diffusion backbone + video-action head + action-conditioned simulator/evaluator
- Contribution: 在同一 future-predictive framework 聯合 action generation、future prediction、action evaluation
- Limitation: video diffusion inference 成本高；world-model fidelity 尤其 contact-rich failure cases 仍是核心風險

---

## 5. Predicted Effect 不能直接當成 Reality；需要 Future-Reality Verifier

### 問題

World Action Model 可能預測：

```text
Action chunk:
reach → grasp → lift → place

Imagined future:
cup successfully placed
```

但真實世界：

```text
gripper slips at grasp
```

如果 Agent 固定執行整個 action chunk：

```text
prediction error
→ 後續 action 仍照舊執行
→ failure compounding
```

### 2026 `When to Trust Imagination`

此研究把 WAM execution 變成 future-reality verification：

```text
Predicted Future Actions
+
Predicted Visual Dynamics
+
Real Observation
+
Language Goal
↓
FFDC Verifier
↓
Trust remaining rollout?
├ YES → continue longer chunk
└ NO  → replan early
```

其 RoboTwin 實驗報告：相對 short-chunk baseline，forward passes 減少 69.10%、execution time 減少 34.02%，success rate 提升 2.54%；真實世界實驗 success rate 提升 35%。這些數字僅限該論文設定，不能直接泛化到其他机器人 / Agent。

### Paper metadata

- Title: When to Trust Imagination: Adaptive Action Execution for World Action Models
- Authors: Rui Wang, Yue Zhang, Jiehong Lin, Kuncheng Luo, Jianan Wang, Zhongrui Wang, Xiaojuan Qi
- Year: 2026
- URL: https://arxiv.org/abs/2605.06222
- Dataset/Benchmark: RoboTwin + real-world manipulation
- Architecture: Future Forward Dynamics Causal Attention (FFDC) verifier + Mixture-of-Horizon Training
- Contribution: 將 action chunk length 變成 prediction-vs-reality consistency 的動態決策
- Limitation: verifier 本身也可能誤判；需要 calibration、failure detection 與安全停止策略

因此 Hermes 應正式新增：

```text
Action Issued
≠
Action Executed
≠
Predicted Effect
≠
Observed Effect
≠
Verified Goal Progress
```

---

# Architecture Breakdown

本輪形成的統一 Action Runtime：

```text
User Goal / Agent Goal
↓
Goal Compiler
↓
World Belief B_t
↓
Candidate Action Generator
├ Symbolic planner
├ LLM planner
├ Skill graph
├ VLA / policy
└ Tool router
↓
Affordance Model
├ Which object?
├ Which interaction?
└ Which region / handle / control?
↓
Precondition Evaluator
├ Predicate state
├ prerequisite DAG
├ temporal condition
└ resource condition
↓
Permission / Safety Gate
├ user authorization
├ tool capability
├ data scope
└ physical safety
↓
Feasibility Layer
├ IK / collision
├ gripper geometry
├ browser/UI availability
├ network / API availability
└ resource locks
↓
Action Executor
├ Tool Call
├ Browser / Computer
├ Robot Controller
└ Code Runtime
↓
Action Receipt
↓
Predicted Effect Model
├ STRIPS / PDDL transition
├ simulator
├ latent world model
└ video world model
↓
Environment
↓
Post-Action Observation
↓
Observed Effect Extractor
↓
Effect Verifier
├ MATCH
├ PARTIAL
├ FAILED
├ UNEXPECTED_EFFECT
├ WORLD_CHANGED
└ UNCERTAIN
↓
Belief Revision
↓
B_t+1
↓
Replan / Continue
```

---

# Bottom-Level Logic

## A. Symbolic precondition evaluation

```text
P(a) = required predicates
B_t = current belief predicates

Executable_symbolic(a)
=
∀p ∈ P(a): Truth(p | B_t) ≥ threshold
```

注意 Agent belief 不是完美真值，因此比 classical planning 更需要三值或 probabilistic logic：

```text
TRUE
FALSE
UNKNOWN
```

`UNKNOWN` 不應自動當 TRUE。

## B. Dynamic affordance state

```text
Affordance_t(a)
=
f(object state,
   tool state,
   prerequisite graph,
   current goal,
   physical context)
```

Structure-changing action：

```text
A_t
→ modifies
AffordanceGraph_t
→ AffordanceGraph_t+1
```

例如：

```text
unlock door
↓
ENABLE open-door
↓
open door
↓
ENABLE enter-room
```

## C. Effect verification

```text
ExpectedEffects(a_t) = E_hat
ObservedDelta(O_t, O_t+1) = E_obs

Verifier(E_hat, E_obs)
→ status + confidence + discrepancy
```

不能只驗證 action executor return code：

```text
HTTP 200
≠ task effect succeeded
```

同理：

```text
Robot controller returned success
≠ object actually moved as intended
```

## D. Hybrid Action Model（Hermes 工程模型）

```text
Action Schema
├ symbolic preconditions
├ permission requirements
├ physical/runtime constraints
├ symbolic effects
├ learned effect predictor
├ verifier probes
└ recovery policy
```

範例：

```text
OPEN(cabinet_3)

Affordance:
openable(cabinet_3)

Precondition:
closed(cabinet_3)
hand_empty(robot)

Permission:
robot may manipulate cabinet_3

Feasibility:
reachable(handle)
collision_free(path)

Predicted symbolic effect:
OPEN(cabinet_3)
¬CLOSED(cabinet_3)

Learned physical prediction:
door rotates +72°

Verifier:
vision/encoder says door-angle > threshold
object_state.Open == true

Recovery:
retry → reposition → reobserve → abort
```

---

# Visual Simulation Idea

## **Action Preconditions, Affordance & Effect Verification Lab**

Hermes Console 可直接做一個 action X-ray。

畫面左側：World State

```text
robot
├ hand_empty = true
└ near(cabinet_3) = true

cabinet_3
├ openable = true
├ closed = true
├ locked = true
└ reachable = true
```

中間：Action候選

```text
OPEN cabinet_3
```

逐層 Gate：

```text
Affordance        PASS
Precondition      FAIL
Permission        PASS
Feasibility       PASS

Reason:
locked(cabinet_3)=true
```

Dependency Graph 動畫：

```text
UNLOCK cabinet
      ↓
OPEN cabinet
      ↓
GRASP cup
```

執行 `UNLOCK` 後：

```text
Affordance Graph
OPEN cabinet:
DISABLED → ENABLED
```

再執行 OPEN：

```text
Expected Effect
closed=false
open=true

Observed Effect
closed=false
open=false

POSTCONDITION MISMATCH
→ REOBSERVE / RETRY
```

第二模式可切：

```text
SYMBOLIC MODEL
NEURAL WORLD MODEL
HYBRID MODEL
```

並顯示：

```text
Predicted next-state confidence
Precondition certainty
Affordance certainty
Permission status
Execution status
Effect-match score
World-model discrepancy
```

此 simulator 可以讓不懂 AI 的使用者直接看到：

> **AI 決定「做一件事」以前，應該先回答能不能做、為什麼能做、做完預期什麼會改變，以及世界到底有沒有真的改變。**

---

# Code / GitHub

## 1. StanfordVL/BEHAVIOR-1K

值得繼續讀：

```text
bddl3/
├ README.md
├ activity definitions / logic evaluator
└ backend interface

OmniGibson/omnigibson/
├ action_primitives/
│  ├ symbolic_semantic_action_primitives.py
│  └ starter_semantic_action_primitives.py
├ object_states/
├ transition_rules.py
├ tasks/
├ controllers/
└ systems/
```

核心觀察：

- BDDL 負責 task/init/goal predicate specification。
- simulator backend 負責 predicate grounding / checking。
- action primitive 負責 executable operation。
- transition rules 負責 simulator-native physics之外的複雜轉換，例如 washing / slicing / recipes。
- symbolic primitive 原始碼已直接區分 pre-condition 與 post-condition failure。

## 2. AI-Planning/pddl

值得讀：

```text
PDDL Domain
├ predicates
├ action parameters
├ preconditions
└ effects
```

此 repo 支援 STRIPS、typing、negative/disjunctive/quantified preconditions、conditional effects、fluents、durative actions、action costs 等 PDDL 3.1 features。

## 3. codezakh/onelife

OneLife 公開 repo 不是只有 README；source tree 包含：

```text
runbook/
├ 01_generate_exploration_trajectory.py
├ 02_synthesize_laws.py
└ 03_optimize_and_evaluate.py

src/onelife/
├ balrog_client.py
├ balrog_components.py
├ balrog_crafter.py
├ balrog_evaluator.py
├ crafter_environment_factory.py
└ evaluator/
```

這套系統的價值在於：從單次 unguided exploration 中推斷 executable symbolic world laws，將世界動態寫成帶 precondition-effect 結構的 probabilistic / executable laws，而不是假設 action model 已知。

---

# Papers

## Paper A — AGWM

- **Title:** AGWM: Affordance-Grounded World Models for Environments with Compositional Prerequisites
- **Authors:** Qinshi Zhang, Weipeng Deng, Zhihan Jiang, Jiaming Qu, Qianren Li, Weitao Xu, Ray LC
- **Institution:** UC San Diego / University of Hong Kong / Columbia University / Amazon / City University of Hong Kong（依公開論文索引）
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.06841
- **Code:** 本輪未確認作者官方 code
- **Dataset/Environment:** compositional prerequisite game-based simulated environments
- **Architecture:** learned world model + affordance prerequisite DAG + structure-changing events
- **Contribution:** 把「action 是否 executable」變成動態 world-state component
- **Limitations:** abstract environment；open-world robotics / browser-agent transfer 尚未驗證
- **改變了什麼:** 從 `state + action → next state` 擴成 `state + action + prerequisite structure → executable? → next state`

## Paper B — One Life to Learn

- **Title:** One Life to Learn: Inferring Symbolic World Models for Stochastic Environments from Unguided Exploration
- **Authors:** Zaid Khan, Archiki Prasad, Elias Stengel-Eskin, Jaemin Cho, Mohit Bansal
- **Institution:** University of North Carolina at Chapel Hill
- **Year:** ICLR 2026
- **URL:** https://onelife-worldmodel.github.io/
- **Code:** https://github.com/codezakh/onelife
- **Dataset/Environment:** Crafter-OO / stochastic object-oriented environment
- **Architecture:** single exploration trajectory → law synthesis → probabilistic mixture / optimization → executable symbolic world model
- **Contribution:** 不假設 action transition laws 已知，而從少量 experience 推斷 precondition-effect world laws
- **Limitations:** symbolic abstraction品質與 exploration coverage 仍限制可辨識的 laws
- **改變了什麼:** 從 planner consuming hand-authored action schema，進一步變成 Agent 自己 induction action/world laws

## Paper C — τ0-WM

- **Title:** τ0-WM: A Unified Video-Action World Model for Robotic Manipulation
- **Authors:** Pengfei Zhou et al.（完整 authors 見 arXiv）
- **Institution:** multi-institution robotics collaboration；本輪不對未完整核實 affiliation 做過度推斷
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2606.01027
- **Code:** 本輪未確認正式官方 repository
- **Dataset:** 約 27,300 hours heterogeneous interaction/video data（依 paper abstract）
- **Architecture:** shared video diffusion backbone + action generation + action-conditioned future simulator + progress evaluator
- **Contribution:** action 與 future consequence 在同一 future-predictive model 中聯合建模
- **Limitations:** diffusion latency / physical fidelity / failure-trajectory coverage
- **改變了什麼:** VLA `o→a` 變成 WAM `o→(a, future)`，讓 action selection有 future consequence interface

## Paper D — When to Trust Imagination

- **Title:** When to Trust Imagination: Adaptive Action Execution for World Action Models
- **Authors:** Rui Wang, Yue Zhang, Jiehong Lin, Kuncheng Luo, Jianan Wang, Zhongrui Wang, Xiaojuan Qi
- **Institution:** 需從 paper PDF 進一步核實完整 affiliation；本輪不猜測
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.06222
- **Code:** 本輪未確認作者官方 code
- **Dataset:** RoboTwin + real-world robot experiments
- **Architecture:** WAM predicted future + real observation → FFDC verifier → adaptive action horizon
- **Contribution:** 把 WAM rollout 的「要信多久」變成 evidence-based execution policy
- **Limitations:** verifier 自己可能 false positive / false negative
- **改變了什麼:** 從 fixed chunk execution 轉成 prediction-observation consistency driven replan

---

# 已確認 / 推論 / 假說分層

## 已確認事實

- PDDL action schema 可以明確表示 preconditions/effects。
- BDDL 的核心 activity structure 是 objects/init/goal，而且官方稱 process-agnostic。
- OmniGibson symbolic semantic action primitives 真的執行 pre-condition checks 與 post-condition checks。
- AGWM 明確建模 prerequisite DAG 與 dynamic executability。
- τ0-WM 聯合 future prediction/action generation/action evaluation。
- When to Trust Imagination 使用 predicted-vs-real consistency 做 adaptive execution horizon。

## 工程推論

Hermes Action Runtime 應拆成：

```text
Affordance
Precondition
Permission
Feasibility
Execution
Predicted Effect
Observed Effect
Verification
Recovery
```

而不是只有：

```text
Tool selected
→ Tool called
→ success
```

## 尚未驗證假說

1. 可以建立跨 Browser / Tool / Robot 共用的 `ActionSchema ABI`。
2. Learned WAM effect 可以自動蒸餾成 symbolic preconditions/effects 並用 observation 持續修正。
3. prerequisite DAG 可以擴展成 MCP/tool capability graph，讓 Agent 動態計算「目前哪些工具 action 可用」。

---

# Unknown / Open Questions 1–3

## 1. Precondition 從哪裡來？

```text
Hand-written schema?
Simulator rules?
LLM induction?
Experience mining?
Learned world model?
```

真實 Agent 很可能需要混合來源，並保存 provenance / confidence。

## 2. 如何將 continuous feasibility 接到 symbolic planner？

```text
PDDL says GRASP is legal
```

但 motion planner 說：

```text
no collision-free IK solution
```

這時 action model 需要支持 late-binding feasibility，而不能只有 static predicates。

## 3. Effect model 如何表示 stochastic / partial / delayed effects？

```text
click Submit
```

可能：

```text
立即成功
server 3 秒後回應
部分欄位錯誤
network timeout
duplicate submission
```

傳統 deterministic Add/Delete effects 不足，需要 probability、temporal window、expected observations 與 recovery policy。

---

# Knowledge Graph 新增 Node / Edge

新增 Nodes：

```text
Action Model
Action Schema
Action Candidate
Affordance
Dynamic Affordance
Action Prerequisite
Prerequisite DAG
Action Executability
Action Precondition
Permission Condition
Runtime Feasibility
Symbolic Effect
Learned Effect
Predicted Effect
Observed Effect
Postcondition
Effect Verifier
Action Receipt
Action Failure Taxonomy
Recovery Policy
Structure-Changing Event
World Action Model
Future-Reality Verifier
```

新增核心 Edges：

```text
World Belief
→ satisfies / violates
Action Precondition

Object State
→ enables / disables
Affordance

Action
→ changes
Affordance Graph

Precondition
→ controls
Action Executability

Permission
→ gates
Action Execution

Feasibility
→ constrains
Executable Action

Action
→ predicts
Effect

Environment
→ produces
Observed Effect

Observed Effect
→ verifies
Predicted Effect

Postcondition Failure
→ triggers
Recovery / Replan

BDDL Goal
≠
PDDL Action Model

Affordance
≠
Precondition
≠
Permission
≠
Feasibility

Executor Success
≠
World Effect Success
```

---

# 下一輪研究

下一輪最值得進：

# **Skill / Tool Graph × Action Schema Induction × Preconditions Learning × MCP Capability Planning**

因為本輪已建立：

```text
World State
→ Action Preconditions
→ Execute
→ Verify Effects
```

下一個缺口是：

```text
Agent 有幾百個 tools / skills / MCP actions
↓
它怎麼知道每個 action 的真正能力、前置條件、資源依賴、權限與副作用？
```

下一輪應拆：

```text
Tool Schema
↓
Capability Extraction
↓
Precondition Discovery
↓
Effect Discovery
↓
Dependency / Skill Graph
↓
Tool Composition
↓
Plan Compilation
↓
Runtime Verification
```

並比較：

```text
MRKL / Toolformer
OpenAI tool schemas
MCP tools/resources/prompts
LangGraph tool nodes
Google ADK tools
Semantic Kernel functions
SkillDAG / skill libraries
LLM Compiler
ReWOO
```

同時研究：

```text
Static API schema
vs
Learned executable capability model
```

---

# 每輪結束檢查

- **缺哪一層：** `Action Schema → Tool/Skill capability graph → automatic plan compilation`
- **哪個節點最淺：** stochastic / delayed effect model
- **哪個概念仍只是名詞：** Unified Action Schema ABI、Effect Confidence Calibration
- **哪個系統最值得讀原始碼：** BEHAVIOR-1K `action_primitives/ + transition_rules.py`；其次 OneLife `02_synthesize_laws.py / 03_optimize_and_evaluate.py`
- **哪篇論文需追引用：** AGWM；其次 One Life to Learn 與 When to Trust Imagination
- **哪個概念最適合視覺模擬：** Action Preconditions, Affordance & Effect Verification Lab
- **哪個 Agent 架構最值得實作：** **Hybrid Action Model Agent = Symbolic Preconditions + Learned Effect Predictor + Permission/Feasibility Gate + Reality Verifier**

---

# 本輪核心結論

> **AI 真正從「會說要做什麼」走到「真的能安全可靠地做事」，關鍵不是再增加一個 planner，而是建立 Action Model。Affordance 回答「這類互動是否可能」，Precondition 回答「此刻條件是否成立」，Permission 回答「是否被允許」，Feasibility 回答「runtime/物理上是否做得到」，Effect Model 預測「做完應該改變什麼」，而 Reality Verifier 再確認「世界真的有沒有照預期改變」。只有這些層都存在，UI → Agent → World Model → Planning → Tool/Robot → Environment → Verification 才真正形成閉環。**
