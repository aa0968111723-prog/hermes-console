# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 09:52 Asia/Taipei**  
**本輪主題：Latent State Discovery × State-Space Expansion × Hybrid Regime Discovery × Guard/Event Boundary Induction**

## 與歷史研究比較

上一輪已建立：

```text
Residual / Transition Conflict
→ Structural Hypothesis Generator
→ Candidate State / Interaction Terms
→ Symbolic / Sparse / Program Discovery
→ Verifier Plane
→ Mechanism Certificate
→ Executable Mechanism Graph
```

但上一輪仍隱含假設「目前 state vector 已足以形成 Markov state」。本輪不重複 equation discovery，而專門回答：

1. 如果兩段歷史在當前 observation 上幾乎一樣，未來卻不同，是否代表缺 latent state？
2. 如何區分「少一個 state variable」與「其實是 discrete regime / mode 切換」？
3. event boundary / guard 到底如何從 trajectory 中被估計？
4. latent representation 是為 prediction 足夠，是否就代表對 control / planning 足夠？
5. Agent Runtime 如何把非 Markov residual 轉成 state-space expansion，而不是一直往 equation 裡加 term？

本輪核心新鏈：

```text
History h_t
+ current observation o_t
+ action u_t
↓
Current model prediction
↓
History-conditioned residual test
↓
Non-Markov evidence
↓
State insufficiency hypothesis
├ missing continuous latent state?
├ missing discrete mode?
├ missing delay / memory state?
└ missing event / contact regime?
↓
Candidate state augmentation
↓
Markov sufficiency / predictive / control tests
↓
Hybrid regime discovery
↓
Guard + reset / gluing structure
↓
State-Space Expansion Certificate
↓
Versioned World State ABI
```

---

# 本小時新發現

## 1. Latent State Design for World Models under Sufficiency Constraints
- **Author:** Keon Woo Kim
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.01694
- **Architecture / viewpoint:** 將 world-model latent state 依功能區分為 predictive embedding、recurrent belief state、object/causal structure、latent action interface、grounded planning interface、memory substrate。
- **Contribution:** 明確區分 predictive sufficiency 與 control/planning sufficiency；world state 不是「保留越多越好」，而是必須對 downstream function 足夠。
- **限制:** 主要是 taxonomy / analysis framework，不是單一可直接部署的 state-discovery algorithm。
- **改變了什麼:** Hermes 不應只有 `LatentState`，而要保存 `StateSufficiencyProfile`，說明該 state 對 prediction / control / causal / memory 等功能是否通過驗證。

## 2. Embedding Hybrid Systems into Continuous Latent Vector Fields / CHyLL++
- **Authors:** Sangli Teng, Hang Liu, Koushil Sreenath
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2606.10596
- **Code:** https://github.com/SangliTeng/Continuous-Hybrid-System-Learning
- **Architecture:** encoder `x→z` → continuous latent vector field `dz/dt = V(z)` → ODE integration → decoder `z→x`；用 gluing / consistency / anti-collapse 等 losses 把 observation-space discontinuity 轉成 latent-space continuous flow。
- **理論結果:** 對 n 維 hybrid system，在文中條件下，若 latent dimension `m > 2n`，可存在把 hybrid dynamics 嵌到 continuous latent vector field 的 embedding。
- **Contribution:** hybrid jump 不一定要直接被表示成「state discontinuity」；也可以把 reset-before / reset-after states 在 latent topology 中 glue 起來。
- **限制:** continuous latent representation 可能把 mode boundary 隱藏掉；若 Hermes 需要 symbolic guard、permission boundary 或因果 event semantics，不能只靠 smooth latent flow。

## 3. Learning Neural Hybrid Surrogates for Gradient-Based Falsification
- **Authors:** Lasse Kötz, Knut Åkesson
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.07541
- **Architecture:** trajectory segmentation → latent mode encoder → mode-conditioned Neural ODE vector fields → guard regression → differentiable surrogate → gradient-based falsification → original system verification。
- **Bottom-level mechanism:** 以 softmax mode probabilities `p^k`，forward 用 hard mode、backward 用 weighted soft probabilities 的 straight-through style；並加入 adjacent segment mode-separation penalty。guard 先嘗試線性 hyperplane，線性不足再升級 nonlinear。
- **重要限制:** 需要假設 mode 數量 M，且需要 transition time observer 或 change-point heuristic；這正是 Hermes 下一步要自動化的缺口。
- **改變了什麼:** `latent continuous state` 與 `discrete regime state` 應分開建模；不是所有 non-Markov evidence 都應被塞進連續 embedding。

## 4. Identifying latent state transition in non-linear dynamical systems
- **Authors:** Çağlar Hızlı, Çağatay Yıldız, Matthias Bethge, ST John, Pekka Marttinen
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2406.03337
- **Architecture:** VAE-based latent state model + nonlinear transition dynamics；利用 nonlinear-ICA-inspired identifiability structure同時恢復 latent states 與 nonlinear transition function。
- **Contribution:** latent state discovery 不只做 representation compression，而要把 transition law 一起納入，否則 latent coordinate 可能重建得好但 dynamics 不可識別。
- **限制:** 主要驗證在可控制的 synthetic / dynamical settings；真實多模態 Agent 的 latent confounder 與 tool/runtime event 更複雜。

## 5. Chronos: Full-history non-Markovian manipulation（2026）
- **Paper:** arXiv:2606.30318
- **Core finding:** 對 memory-dependent long-horizon manipulation，相同/近似當前 observation 可能因歷史不同而需要不同 action；因此 observation 本身不是 Markov state。Chronos 將 observation + proprioception 按物理時間形成 state-representative tokens，使用 selective state-space model 維護 full-history causal state。
- **Contribution:** 對 Agent Runtime 很重要：若 `o_t` 無法決定 action / future，state 不應等於當前 frame，而應包含 compressed causal history。
- **限制:** history representation 很強，但 history token 本身不自動提供可解釋的 symbolic latent variable / guard condition。

---

# 本小時最重要 5 個發現

## 發現 1：真正的 State Discovery 起點不是 Autoencoder，而是 Markov Sufficiency Failure

Agent 不應因為 reconstruction loss 很高就盲目增加 latent dimension。

更有意義的觸發條件是：

```text
同一 / 相似 current state representation s_t
+
相同 / 相似 action u_t
↓
卻出現系統性不同的 future distribution
```

形式化工程測試：

```text
P(Y_{t+1:t+H} | s_t, u_t)
vs
P(Y_{t+1:t+H} | s_t, u_t, history summary h_t)
```

若加入歷史後 prediction / calibration 顯著改善：

```text
I(Y_future ; H_past | S_t, U_t) > threshold
```

則產生：

```text
NonMarkovEvidence
```

這是 Hermes 應建立的第一個 `StateExpansionTrigger`。

### 狀態區分
- **已確認研究方向:** partial observability / recurrent belief state / full-history models 都在處理 current observation 非 Markov 的問題。
- **工程建模:** 用 conditional residual / predictive information 建立 Hermes runtime trigger。
- **尚未驗證假說:** 一個跨模態 universal threshold 可以泛化所有 task。

---

## 發現 2：Missing State ≠ Missing Equation Term

上一輪若 residual 出現：

```text
r_t = y_t - ŷ_t
```

可能有兩種完全不同原因：

### A. equation class 不夠
```text
state 已完整
但少了 nonlinear term
```

例如：
```text
dv/dt = -μv
```
實際需要：
```text
dv/dt = -μv - c v|v|
```

### B. state 本身不完整
```text
同一 x,v
但 contact preload 不同
→ future 不同
```

此時再加 `x², xv, sin(x)` 都沒有用。
真正需要：

```text
s_t = [x, v, preload]
```

或：

```text
s_t = [x,v,q]
q ∈ {stick, slip}
```

Hermes 因此需要把 structural hypothesis 分成：

```text
MechanismExpansion
StateExpansion
ModeExpansion
HistoryExpansion
SensorExpansion
```

這是本輪最重要的 architecture change。

---

## 發現 3：Hybrid State 至少要拆成 Continuous State + Discrete Mode + Guard + Reset

Neural Hybrid Surrogate paper 採 hybrid automaton：

```text
H = (Q, X, E, Init, F, Inv, R, G)
```

其中：
- `Q`：discrete modes
- `X`：continuous state
- `F_q`：mode-conditioned vector fields
- `G`：guards
- `R`：reset maps

因此 Hermes 的 World State 不應只有：

```text
latent = [z1,z2,...]
```

更完整應該是：

```text
HybridWorldState
├ continuous_state z_t
├ mode_posterior p(q_t)
├ event_boundary_state
├ active_guard_candidates[]
├ reset_lineage
├ belief_uncertainty
└ evidence_roots[]
```

Mode transition：

```text
q_t = STICK
↓ guard: tangential_force > μ_s N
q_{t+1} = SLIP
```

這種離散 change 對 planning / verification / tool runtime 都很重要，不能永遠被 smooth embedding 隱藏。

---

## 發現 4：CHyLL++ 展示了另一條路——把 discontinuity「拓撲上消掉」

我直接讀了官方 repo，不只 README。

`lib/hybrid.py` 的核心其實非常乾淨：

```text
x
↓ encoder
z0
↓ torchdiffeq ODE integrate
z(t)
↓ decoder
x_pred(t)
```

程式中的 `Hybrid` 類別真的就是：

```text
encoder
vector_field
odefunc
odeint
 decoder
```

而 `hybrid_trainer.py` 會：

1. 用 finite-difference velocity magnitude 找疑似 switch intervals。
2. 對 switch pair 的 consecutive encoded states做 `gluing_loss = ||z_{t+1}-z_t||²`。
3. 同時最小化 x-space / z-space dynamics loss。
4. 加 anti-collapse variance penalty。
5. 對 encoder / vector field 加 Lipschitz regularization。

官方 `utils.py` 的 switch mask 更直接：

```text
v_k = (x_{k+1}-x_k)/(Δt+eps)
s_k = ||v_k||
threshold = quantile(s)
switch = s_k > threshold
```

這是一個很重要的 bottom-level observation：

> **Event boundary detection 可以先是非常簡單的 derivative / velocity discontinuity heuristic，再由後續模型精煉。**

但新的限制也很清楚：

```text
Large derivative ≠ Hybrid switch
Small derivative ≠ No switch
```

例如 tool permission mode、queue ownership、hidden contact state 切換，可能 observation derivative 很小。

所以 Hermes 應把 switch detector 做成多證據：

```text
Derivative jump
Prediction residual jump
Mode posterior entropy
Contact/tool event
Causal intervention evidence
Runtime event log
```

---

## 發現 5：Predictive State 與 Control State 必須分開驗證

Latent State Design 2026 的核心提醒是：一個 state 對「預測下一 frame」夠用，不代表對「選下一個 action」夠用。

Hermes 因此應新增：

```text
StateSufficiencyProfile
├ prediction_horizon_H
├ predictive_score
├ control_value_loss
├ planning_success
├ counterfactual_consistency
├ memory_recall_need
├ causal_query_support
├ uncertainty_calibration
└ tested_tasks[]
```

例如：

```text
z_video
Prediction: PASS
Control: FAIL
Counterfactual: FAIL
```

代表：

```text
不要把 z_video 當成 Universal World State
```

這也回答長期目標中的一個底層問題：

```text
Encoder output
≠ Agent state
```

真正 Agent state 是經過 sufficiency / belief / task requirements 形成的 runtime construct。

---

# Architecture Breakdown

本輪建議 Hermes 新增 **State Discovery Plane**：

```text
Camera / Audio / Tool / MCP / Runtime / Proprioception
↓
Observation Envelope
↓
Current State Constructor
↓
World Model / Runtime Predictor
↓
Future Prediction
↓
Observed Future
↓
Residual Bus
↓
Markov Sufficiency Analyzer
├ residual autocorrelation
├ history-conditioned predictability
├ same-state divergent-future test
├ action-conditioned divergence
└ cross-modal inconsistency
↓
State Insufficiency Hypothesis
├ missing continuous latent variable
├ missing discrete mode
├ missing memory/delay state
├ missing sensor variable
└ wrong state abstraction
↓
Candidate State Generator
├ history encoder
├ belief filter
├ latent variable VAE/SSM
├ object/causal feature
└ runtime event state
↓
State Sufficiency Verifier
├ prediction
├ control
├ planning
├ causal/counterfactual
└ calibration
↓
Hybrid Regime Analyzer
├ change-point
├ latent mode encoder
├ vector-field clustering
└ event co-occurrence
↓
Guard / Event Boundary Learner
↓
Reset / Gluing Learner
↓
State-Space Expansion Certificate
↓
Versioned World State Registry
↓
Planner / Agent Loop / Memory / Tools
```

---

# Bottom-Level Logic

## A. Non-Markov residual test

對 current representation `s_t`：

```text
ŷ_{t+1} = f(s_t, u_t)
r_{t+1} = y_{t+1} - ŷ_{t+1}
```

若 residual 可由過去 history 預測：

```text
r_{t+1} ≈ g(h_{t-k:t})
```

則意味 current state representation 尚未吸收 history 中的 predictive information。

工程上可比較：

```text
M0: y_future ← s_t,u_t
M1: y_future ← s_t,u_t,h_t
```

若 `M1` 在 held-out trajectory 穩定提升，且不是 data leakage：

```text
state_insufficiency_score ↑
```

## B. Candidate latent state extraction

```text
history window
↓
encoder / SSM / recurrent filter
↓
latent candidate z_hidden
↓
augment state [s_t, z_hidden]
↓
re-fit transition
↓
verify future residual reduction
```

必要條件：

```text
residual reduction
+
held-out generalization
+
intervention consistency
+
state minimality
```

否則只是 history memorization。

## C. Mode discovery

trajectory 先被分成候選 segments：

```text
τ = τ1 | τ2 | τ3 | ...
```

mode encoder：

```text
p(q_k | τ_k) = softmax(ε(τ_k))
```

每個 mode 有：

```text
dx/dt = f_q(x,u,t)
```

如果同一 flow function 無法同時解釋所有 segments，而分 mode 後 held-out rollout 大幅改善，則產生 `RegimeSplitEvidence`。

## D. Guard induction

transition samples：

```text
X_transition = {x_t | q^- → q^+}
```

先測線性：

```text
a^T x + b = 0
```

不足才升級 nonlinear：

```text
g_φ(x,u,z_hidden)=0
```

但 Hermes 必須加 negative samples：

```text
nearby non-transition states
```

否則只 fit transition points 無法知道真正 decision boundary。

## E. Reset vs Gluing

兩種表示策略：

### Explicit hybrid automaton
```text
x^- --guard--> reset R(x^-) = x^+
```

### Continuous latent embedding
```text
encoder(x^-)
≈
encoder(x^+)
```

Hermes 應同時保存兩種 view：

```text
Operational Hybrid View
+
Continuous Latent View
```

前者適合 verification / tool mode / permission / physical events；後者適合 differentiable planning / long rollout。

---

# Visual Simulation Idea

## **Latent State & Hybrid Regime Discovery Lab**

### Panel 1：Same Observation, Different Future

```text
History A                         History B
... grasp preload                ... no preload
      ↓                                ↓
Current camera frame ≈ same      Current camera frame ≈ same
Current pose        ≈ same       Current pose        ≈ same
      ↓                                ↓
Future: SLIP                      Future: STICK
```

UI 顯示：

```text
Current-State Predictor Error     HIGH
History-Conditioned Error         LOW

NON-MARKOV EVIDENCE = 0.87
```

### Panel 2：Candidate Hidden State

```text
Candidate
contact_preload z3

Before augmentation:
RMSE  .31

After augmentation:
RMSE  .07

Control success:
54% → 88%
```

### Panel 3：Mode discovery

phase-space 上著色：

```text
● STICK
▲ SLIP
■ FREE
```

旁邊：

```text
Mode posterior
STICK .08
SLIP  .89
FREE  .03
```

### Panel 4：Guard viewer

可拖曳 guard：

```text
μ_s N - |F_t| = 0
```

並看到哪些 transition points 被錯分。

### Panel 5：Latent gluing

Observation space：

```text
──────●        ●──────
     jump/reset
```

Latent space：

```text
────────●────────
continuous flow
```

如此可直接向使用者展示：

> 「世界看起來跳了一下」與「內部可學習 representation 必須跳一下」不是同一件事。

---

# Code / GitHub 深入

## SangliTeng/Continuous-Hybrid-System-Learning

值得繼續讀：

```text
lib/hybrid.py
lib/hybrid_trainer.py
lib/utils.py
lib/hybrid_visualizer.py
experiments/
```

### `lib/hybrid.py`
已確認：

```text
Encoder MLP
→ latent z0
→ torchdiffeq odeint
→ latent trajectory
→ Decoder MLP
```

### `lib/hybrid_trainer.py`
已確認：

```text
trajectory curriculum
switch mask preprocessing
dynamics loss in x / z
gluing loss
anti-collapse variance
Lipschitz regularization
checkpoint loop
```

### `lib/utils.py`
已確認 switch heuristic：

```text
finite difference velocity
→ norm
→ dataset quantile
→ binary switch mask
```

這是本輪最值得 Hermes 實作成 baseline 的 event boundary detector。

### 工程缺口
現有 CHyLL++ source 很適合 continuous latent embedding，但 Hermes 還應額外實作：

```text
History-conditioned residual test
Mode posterior registry
Guard learner
Reset learner
State sufficiency verifier
State version migration
```

---

# Papers

| Title | Year | 核心用途 | 主要限制 |
|---|---:|---|---|
| Latent State Design for World Models under Sufficiency Constraints | 2026 | 定義 state 的 functional sufficiency | taxonomy，非完整 discovery algorithm |
| Embedding Hybrid Systems into Continuous Latent Vector Fields | 2026 | hybrid discontinuity → continuous latent flow | mode semantics 可能被隱藏 |
| Learning Neural Hybrid Surrogates for Gradient-Based Falsification | 2026 | latent mode + mode ODE + guard learning | 需 mode count / switch timing 假設 |
| Identifying latent state transition in non-linear dynamical systems | 2024 | 同時恢復 latent states 與 nonlinear transition | 真實 Agent runtime 尚更複雜 |
| CHyLL: Learning Continuous Neural Representations of Hybrid Systems | 2025 | 不做 trajectory segmentation 的 hybrid latent embedding | 對 explicit guard semantics 支援有限 |

---

# Unknown / Open Questions

## 1. 如何判斷 latent dimension 真的需要 +1，而不是模型容量不足？
目前需要 model comparison + minimality + held-out predictive / control tests；尚缺通用 calibrated criterion。

## 2. 一個 discrete mode 是「世界的真實 regime」還是 neural model 為了方便而創造的 cluster？
必須加入 intervention / guard repeatability / cross-trajectory invariance 才能提升 semantic confidence。

## 3. 如何在 Agent Runtime 中處理 mode birth / merge / split？
長期 Agent 可能先只有 `CONTACT`，後來才發現需要拆成 `STICK / SLIP / IMPACT`。這會牽涉歷史 memory / KG / policy / benchmark state migration。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Latent State Discovery
State-Space Expansion
Markov Sufficiency
Predictive Sufficiency
Control Sufficiency
Planning Sufficiency
State Sufficiency Profile
Non-Markov Evidence
Same-State Divergent Future
History-Conditioned Residual
State Expansion Trigger
Continuous Latent State
Discrete Mode State
Mode Posterior
Hybrid Regime
Regime Split Evidence
Event Boundary
Guard Function
Reset Map
Gluing Map
Continuous Latent Embedding
State-Space Expansion Certificate
World State Version
```

## Edges

```text
History
--EXPLAINS_RESIDUAL_OF→
CurrentState

NonMarkovEvidence
--TRIGGERS→
StateExpansion

StateExpansion
--PROPOSES→
LatentState

LatentState
--AUGMENTS→
WorldState

TrajectorySegment
--ASSIGNED_TO→
HybridMode

HybridMode
--HAS_VECTOR_FIELD→
Dynamics

Guard
--TRIGGERS→
ModeTransition

ModeTransition
--APPLIES→
ResetMap

ResetPair
--GLUED_BY→
ContinuousLatentEmbedding

StateSufficiencyProfile
--VALIDATES_FOR→
Prediction / Control / Planning / CausalReasoning
```

## 新的否定關係

```text
Observation ≠ Markov State
Encoder Output ≠ Agent State
Reconstruction Quality ≠ State Sufficiency
Prediction Sufficiency ≠ Control Sufficiency
Prediction Sufficiency ≠ Counterfactual Sufficiency
Missing Equation Term ≠ Missing State Variable
Large Residual ≠ State Insufficiency
History Dependence ≠ Necessarily Discrete Mode
Mode Cluster ≠ Physical Regime
Change Point ≠ Causal Event
Large Derivative ≠ Hybrid Switch
Small Derivative ≠ No Switch
Smooth Latent Flow ≠ No Hybrid Semantics
Latent Dimension Increase ≠ Mechanism Discovery
```

---

# 下一輪研究

下一個缺口：

# **Predictive State Representation × Belief State Filtering × Minimal Sufficient State × State Compression / State Aliasing**

因為本輪已能偵測：

```text
current state 不夠
→ 加 history / latent / mode
```

但若一路加，會變成：

```text
完整 history = state
```

這在 Agent Runtime 會爆炸。

下一輪應回答：

```text
History
↓
Which information changes future?
↓
Predictive sufficient statistic
↓
Belief state / PSR
↓
State aliasing test
↓
Minimality / compression
↓
Task-specific sufficient state
↓
Memory eviction / retention rule
```

應深入：
- Predictive State Representations (PSR)
- belief-state filtering / POMDP
- bisimulation / state abstraction
- causal states / computational mechanics
- recurrent state-space models
- JEPA/HMM state-space interpretation
- state aliasing diagnostics
- minimal sufficient representation for planning

---

# 本輪結束回答

**缺哪一層？**  
缺「如何把無限 history 壓成最小 predictive / control sufficient state」這一層，也就是 PSR / belief compression / state abstraction。

**哪個節點最淺？**  
`StateExpansionTrigger → Candidate Latent Variable` 的 calibrated proposal mechanism 最淺；現在能知道 state 不夠，但還不能可靠命名到底缺哪一個 hidden variable。

**哪個概念仍只是名詞？**  
`State-Space Expansion Certificate`、`Universal World State ABI`、`Cross-Modal Markov Sufficiency Score` 尚屬工程抽象，需要 benchmark 與實際 schema。

**哪個系統值得讀原始碼？**  
優先繼續讀 `SangliTeng/Continuous-Hybrid-System-Learning` 的 `hybrid_trainer.py / utils.py / experiments/`，並補 Neural Hybrid Automata 的 mode encoder / guard learner實作。

**哪篇論文需追引用？**  
優先追 `Embedding Hybrid Systems into Continuous Latent Vector Fields` → CHyLL → Neural Hybrid Automata，以及 `Latent State Design for World Models under Sufficiency Constraints` 對 predictive/control sufficiency 的引用網。

**哪個概念最適合視覺模擬？**  
`Latent State & Hybrid Regime Discovery Lab`：讓使用者看到「相同畫面、不同歷史 → 不同未來 → 發現 hidden state → 分裂 mode → 學 guard」。

**哪個 Agent 架構最值得實作？**  

> **State-Discovery Agent Runtime = Residual Bus + Markov Sufficiency Analyzer + History/Latent Candidate Generator + State Sufficiency Verifier + Hybrid Mode Discovery + Guard/Reset Learner + State-Space Expansion Certificate + Versioned World State Registry**

本輪最核心的推進是：**上一輪讓 Hermes 學會「我可能少了一條機制」；這一輪讓它開始學會更根本的問題——「我現在拿來思考的 state 本身，可能就不完整」。真正的 world model 不是把所有 sensor token 塞進 latent，而是持續檢查：目前 state 是否足以預測、控制與推理；如果不足，就從歷史、隱變量與 discrete regime 中找出缺的那一維。**