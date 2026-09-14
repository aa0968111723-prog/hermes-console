# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 02:54（Asia/Taipei）**  
**本輪主題：Latent World Model × Dream Rollout × Predictive Observation Simulation × Model-Based Agent Planning**

---

## 0. 本輪與歷史研究的差異

上一輪已建立：

```text
Hidden World State
↓
Belief State
↓
Transition Model T(s'|s,a)
↓
Observation Model O(o|s',a)
↓
Belief Update
↓
Expected Information Gain
↓
Perception / Tool / Physical Action
```

本輪不再重複「如何維護 belief」或「該去哪裡觀察」，而是往下一層問：

> Agent 能不能在真正執行 action 之前，先在 learned world model 裡生成多條可能未來，評估 reward / risk / termination，再把結果交給 policy 或 planner？

因此本輪核心鏈變成：

```text
Real Observation
↓
Encoder / Tokenizer
↓
Latent State / Belief State
↓
Learned Dynamics
↓
Candidate Action
↓
Imagined Latent Transition
↓
Predicted Reward / Continuation / Observation
↓
Multi-step Dream Rollout
↓
Return / Risk / Uncertainty
↓
Policy Update or Action Selection
↓
Real Environment
↓
Prediction Error
↓
World Model Update
```

本輪最重要的區分：

```text
World Model Can Generate Future
≠ Future Is Accurate Enough For Planning

One-Step Prediction Accuracy
≠ Long-Horizon Planning Reliability

Pixel-Realistic Video
≠ Decision-Sufficient Dynamics

LLM Foresight Text
≠ Calibrated Latent Dynamics Model

Planning In Imagination
≠ Planning Is Safe In Reality
```

---

# 1. 本小時新發現

## 新架構 1：DreamerV3 — RSSM latent imagination

**Paper:** Mastering Diverse Control Tasks through World Models  
**Authors:** Danijar Hafner, Jurgis Pasukonis, Jimmy Ba, Timothy Lillicrap  
**Publication:** Nature, 2025（工作最早以 DreamerV3 preprint 於 2023 發布）  
**Code:** https://github.com/danijar/dreamerv3  
**Architecture:** Encoder → RSSM → Decoder/Reward/Continue → Actor/Critic → latent imagination

DreamerV3 的核心不是「生成漂亮影片」，而是建立足以讓 policy 在 latent space 中學習的動態模型。

其 RSSM state 由兩部分構成：

```text
h_t = deterministic recurrent state
z_t = stochastic categorical state

latent state = (h_t, z_t)
```

真實 observation 路徑：

```text
o_t
↓ Encoder
embedding e_t
↓
RSSM deterministic transition
h_t = f(h_{t-1}, z_{t-1}, a_{t-1})
↓
Posterior q(z_t | h_t, e_t)
↓
Latent state s_t
```

想像路徑則不再讀真實 observation：

```text
s_t
↓ policy
imagined action a_t
↓ dynamics core
h_{t+1}
↓ prior p(z_{t+1} | h_{t+1})
↓ sample
s_{t+1}
↓ reward / continue / value
```

這個 distinction 非常關鍵：

```text
Posterior State
= grounded by real observation

Prior State
= predicted without seeing next observation
```

Dreamer 的 planning/training 之所以叫 imagination，就是 policy 的未來 training signal 主要來自 prior rollout，而不是每一步都重新讀真實 sensor。

### 原始碼確認

`dreamerv3/rssm.py` 的 `observe()` 明確把 encoder tokens 與 deterministic state 合成 posterior logits；`imagine()` 則只使用 current latent state、policy action、dynamics core 與 prior distribution 推下一步 latent。

值得看的核心檔案：

```text
dreamerv3/
├ agent.py
├ rssm.py
├ configs.yaml
└ main.py
```

`agent.py` 的 training loop 會：

```text
real replay sequence
↓
encoder + RSSM observe
↓
select latent start states
↓
dyn.imagine(..., H)
↓
predicted reward / continuation
↓
actor / value imagination loss
```

這表示 DreamerV3 並不是 traditional MPC 每次 deployment 都暴力搜尋大量 action sequence，而是 **利用 imagination rollout 訓練 actor-critic，最後讓 actor 本身成為 amortized planner**。

---

## 新架構 2：Dreamer 4 — scalable transformer video world model + imagination RL

**Paper:** Training Agents Inside of Scalable World Models  
**Authors:** Danijar Hafner, Wilson Yan, Timothy Lillicrap  
**Year:** 2025  
**Paper:** https://arxiv.org/abs/2509.24527

Dreamer 4 把 Dreamer 系列從 recurrent latent RSSM 往 scalable generative world model 推進。

官方論文指出，它使用高效率 transformer world model 與 shortcut forcing objective，在單 GPU 可進行 real-time interactive inference；並在 Minecraft 中以純 offline data 建立能支援 agent imagination training 的 world model，最終完成需要超過 20,000 mouse/keyboard actions 的 diamond task。

概念架構：

```text
Video / Observation Frames
↓
Causal Tokenizer
↓
Compressed visual latents
↓
Action-conditioned Transformer Dynamics
↓
Future latent prediction / denoising
↓
Reward / continuation / policy/value heads
↓
Imagined trajectories
↓
RL inside world model
```

與 DreamerV3 的最大結構差異：

```text
DreamerV3:
RSSM recurrent deterministic + stochastic categorical latents

Dreamer4:
causal tokenizer + scalable block-causal transformer dynamics
```

目前可檢查的 `nicklashansen/dreamer4` 是 **非官方 PyTorch implementation**，因此只能當工程參考，不能把實作細節當作官方 reproduction 證據。其 repository 顯示 tokenizer 與 interactive dynamics 都採 block-causal transformer，dynamics 讀取 action、shortcut noise/step 與 tokenizer representations。

本輪建立：

```text
WorldModelArchitectureVersion
├ RSSM_LATENT
├ TRANSFORMER_LATENT
├ VIDEO_GENERATIVE
├ DIFFUSION_LATENT
├ LLM_SYMBOLIC
└ HYBRID
```

避免未來把所有 world model 混為一談。

---

## 新架構 3：Genie / Genie 2 — interactive generative environment ≠ planning world model

**Genie:** Generative Interactive Environments  
**Institution:** Google DeepMind  
**Year:** 2024  
**Architecture:** spatiotemporal video tokenizer + autoregressive dynamics + latent action model

Genie 的重要突破是：從大量沒有 action label 的網路影片中，學到 latent action space，再生成 action-controllable environment。

```text
Internet Video
↓
Spatiotemporal Tokenizer
↓
Latent Video Tokens
↓
Latent Action Model
↓
Action-conditioned Dynamics Model
↓
Interactive Generated Future
```

Genie 2 進一步生成 action-controllable 3D environment；官方描述其 generated worlds 多數示例維持約 10–20 秒，部分可達約 1 分鐘。

但這裡必須建立一條非常重要的 edge：

```text
Interactive World Generation
≠ Reliable Planning Simulator
```

原因：一個模型能產生視覺上連續、可控制的未來，不代表它對 reward-critical object permanence、rare failure、contact dynamics、hidden state、long-horizon causality 都有足夠準確度。

Hermes 因此需要把：

```text
VisualRealism
DynamicsAccuracy
DecisionSufficiency
RiskCalibration
```

分開記錄。

---

## 新研究 4：WorldEvolver — LLM Agent world model 需要 selective foresight

**Paper:** Self-Evolving World Models for LLM Agent Planning  
**Authors:** Xuan Zhang, Wenxuan Zhang, See-Kiong Ng, Yang Deng  
**Year:** 2026  
**Paper:** https://arxiv.org/abs/2606.30639

WorldEvolver 特別重要，因為它把 world model 從 embodied latent dynamics 接到 LLM Agent planning。

它不是讓 LLM 每步直接相信自己對未來的文字預測，而是加入：

```text
Real Action Transitions
↓
Episodic Memory

Prediction ↔ Observation Mismatch
↓
Semantic Memory / Rules

World Model Prediction
↓
Confidence / Reliability Filtering
↓
Selective Foresight
↓
Downstream Agent Context
```

研究顯示一個非常重要的現象：

```text
More Foresight
≠ Better Agent
```

不可靠 world-model prediction 被塞進 agent context 時，反而可能降低決策品質。

本輪新增：

```text
SelectiveForesightGate
```

只有通過 uncertainty / calibration / relevance 檢查的 imagined future，才應進 planning context。

---

## 新研究 5：SR²AM — Planning frequency 與 planning horizon 應分離

**Paper:** Efficient Agentic Reasoning Through Self-Regulated Simulative Planning  
**Authors:** Mingkai Deng et al.  
**Year:** 2026  
**Paper:** https://arxiv.org/abs/2605.22138

SR²AM 把 Agent 拆成：

```text
System I  = reactive execution
System II = simulative reasoning / world-model planning
System III = self-regulation
```

System III 決定：

```text
要不要 plan？
plan 幾步？
什麼時候停止 simulation？
```

其結果顯示 RL 後 planning horizon 增加約 22.8%，但 planning frequency 只增加約 2.0%。

這給 Hermes 一個非常重要的新設計：

```text
PlanningFrequency
≠ PlanningDepth
```

更好的 agent 不一定「更常想」，而可能是只在必要時「想得更遠」。

---

# 2. 本小時最重要 5 個發現

## 發現 1：World model 的核心不是「重建世界」，而是「保留決策需要的 dynamics」

### 是什麼

Planning world model 最重要的 objective 不一定是 pixel reconstruction fidelity，而是：

```text
Given current state + action
↓
能否預測 decision-relevant future state / reward / termination / risk？
```

### 底層如何運作

DreamerV3 同時學：

```text
latent transition
observation reconstruction
reward prediction
continuation prediction
```

但 actor 真正在 imagination 中使用的是 latent features + reward/continue/value，而不是每一步必須 decode 回 pixels。

### 為什麼重要

這意味：

```text
Pixel-perfect Future
不是 planning 的必要條件
```

反之：

```text
Pretty Video
但錯誤 reward dynamics
```

對 Agent 反而非常危險。

### 限制

如果 representation objective 過度 task-specific，也可能漏掉之後新任務需要的 hidden factors。

### 新 edge

```text
Observation Fidelity
≠ Decision Dynamics Fidelity
```

---

## 發現 2：Dream rollout 的誤差會隨 horizon 累積，形成 Model Bias Accumulation

真實 dynamics：

```text
s_{t+1} ~ P*(s'|s_t,a_t)
```

learned model：

```text
ŝ_{t+1} ~ Pθ(s'|ŝ_t,a_t)
```

一步誤差可能很小：

```text
ε_1 small
```

但 imagined state 會成為下一步輸入：

```text
ŝ_t
→ prediction
→ ŝ_{t+1}
→ prediction
→ ŝ_{t+2}
```

因此：

```text
ε_1
→ state distribution drift
→ ε_2 increases
→ further drift
→ ε_H
```

這是 **compounding model error / model bias accumulation**。

所以：

```text
Longer Imagination Horizon
≠ Better Planning
```

Hermes 應追蹤：

```text
ImaginationHorizonRecord
├ horizon
├ one_step_error
├ multi_step_error
├ latent_drift
├ reward_error
├ terminal_error
├ uncertainty_growth
└ reliability_horizon
```

---

## 發現 3：Posterior-grounded state 與 Prior-imagined state 必須分開

在 Dreamer 類架構中：

```text
Posterior q(z_t | h_t, observation)
```

是看過真實 evidence 後的 belief-like latent；

而：

```text
Prior p(z_{t+1} | h_{t+1})
```

是沒有看下一個 observation 的 prediction。

因此一個 rollout 可能出現：

```text
Grounded State
↓
Imagined
↓
Imagined
↓
Imagined
↓
Imagined
```

越往後越需要清楚標記：

```text
Grounding Distance
```

本輪新增：

```text
GroundingDistance
= number of model-only transitions since last real observation
```

這對 LLM Agent 也一樣：

```text
real tool result
↓
LLM predicts future action consequence
↓
predicts consequence of predicted consequence
```

不能和真正 environment observation 混為同等 evidence。

---

## 發現 4：Agent 應有 Selective Foresight，不應把所有 imagined futures 都送進 reasoning

基本流程不應是：

```text
World Model
→ Prediction
→ Planner blindly trusts it
```

而應是：

```text
World Model
↓
Predicted future
↓
Uncertainty / OOD / horizon / provenance checks
↓
Foresight Reliability Score
↓
SelectiveForesightGate
├ ACCEPT
├ DOWNWEIGHT
├ REQUEST_REAL_OBSERVATION
└ REJECT
```

例如：

```text
Predicted tool outcome:
"API call will probably succeed"

confidence = low
OOD = high
side effect = irreversible
```

Hermes 應直接阻止這個 prediction 被當作 action-safe evidence。

---

## 發現 5：Planning compute 應該動態配置，而不是固定 horizon

傳統固定 imagination horizon：

```text
H = 15
```

對某些任務可能過長，對另一些任務又太短。

更合理的 Agent architecture：

```text
Current State
↓
Decision Difficulty Estimator
↓
Planning Need
↓
Adaptive Horizon
↓
Simulation
↓
Marginal Value of Additional Rollout
↓
continue / stop
```

新增：

```text
PlanningBudgetController
├ planning_frequency
├ rollout_horizon
├ branch_count
├ simulation_model
├ uncertainty_threshold
├ token_budget
├ GPU_budget
└ stopping_rule
```

這也把 LLM reasoning tokens、world-model GPU rollout 與 real-tool cost 放進同一資源模型。

---

# 3. Architecture Breakdown

本輪後，Hermes 的 world-model planning stack 可以正式拆成：

```text
User Goal
↓
Real Multimodal Observation
↓
Encoder / Tokenizer
↓
Grounded Latent / Belief State
↓
────────────────────────────────
World Model Core
├ State Transition Model
├ Observation Predictor
├ Reward Predictor
├ Continuation / Termination Predictor
├ Risk Predictor
└ Uncertainty Estimator
────────────────────────────────
↓
Candidate Action Generator
↓
Dream Rollout Engine
├ latent rollout
├ video rollout
├ symbolic/LLM rollout
└ hybrid rollout
↓
Planning Rollout Graph
↓
Rollout Evaluator
├ expected return
├ task success
├ risk
├ uncertainty
├ model bias
├ grounding distance
└ cost
↓
SelectiveForesightGate
↓
Planner / Actor / Policy
↓
Action
↓
Real Environment
↓
Observation
↓
Prediction-vs-Reality Comparator
↓
World Model Memory / Update
```

對 Hermes Console 應明確把三類 simulation 分開：

```text
LATENT_SIMULATION
VIDEO_SIMULATION
SYMBOLIC_LLM_SIMULATION
```

因為它們的成本、可視化方式、uncertainty 與 failure mode 完全不同。

---

# 4. Bottom-Level Logic

## 4.1 RSSM observation update

簡化表示：

```text
h_t = fθ(h_{t-1}, z_{t-1}, a_{t-1})

z_t ~ qφ(z_t | h_t, e_t)

e_t = Encoder(o_t)
```

這是 grounded update。

---

## 4.2 RSSM imagination update

不讀 observation：

```text
h_{t+1} = fθ(h_t, z_t, a_t)

z_{t+1} ~ pθ(z_{t+1} | h_{t+1})
```

再由 heads 預測：

```text
r̂_t = RewardHead(h_t,z_t)
ĉ_t = ContinueHead(h_t,z_t)
V̂_t = ValueHead(h_t,z_t)
```

---

## 4.3 Imagined return

典型 λ-return 可以概念化為：

```text
G_t^λ
=
r̂_t
+
γ ĉ_t [(1-λ)V̂_{t+1} + λG_{t+1}^λ]
```

因此 actor 不必等真實 environment 每步回傳 reward，便可以從 dreamed trajectories 得到 training signal。

---

## 4.4 Model bias

定義真實 one-step transition 與 model transition：

```text
P*(s'|s,a)
Pθ(s'|s,a)
```

若模型誤差：

```text
D(P*, Pθ) = ε(s,a)
```

multi-step rollout 的 state distribution 會逐步離開 real data manifold。

所以 Hermes 不能只記：

```text
prediction_confidence = 0.91
```

應記：

```text
WorldModelRolloutStep
├ step
├ grounding_distance
├ predicted_state
├ predicted_reward
├ predicted_continue
├ uncertainty
├ OOD_score
├ ensemble_disagreement
└ reliability_tier
```

---

## 4.5 Planning objective

對 candidate rollout τ：

```text
Score(τ)
=
ExpectedReturn(τ)
- λrisk Risk(τ)
- λunc Uncertainty(τ)
- λbias ModelBias(τ)
- λcost SimulationCost(τ)
```

不是單純：

```text
maximize predicted reward
```

否則 agent 很容易找到 world-model bug 並 exploitation。

---

# 5. World Model Exploitation：Agent 可能學會「利用模型錯誤」

這是本輪必須加入的核心 failure mode。

如果 world model 錯誤預測：

```text
Action A
→ huge reward
```

但真實環境：

```text
Action A
→ failure
```

那麼在 imagination 中訓練太久的 policy 可能主動走向模型錯誤區域。

即：

```text
Policy Optimization
↓
Searches high predicted reward
↓
Finds model blind spots
↓
Model exploitation
```

這和 adversarial optimization 非常像。

Hermes 新增：

```text
WorldModelExploitationRisk
```

以及：

```text
High Predicted Return
+
High Model Uncertainty
→ Suspected Model Exploitation
```

對 high-risk Agent 應要求：

```text
Dream success
↓
Real / higher-fidelity verification
↓
then execute
```

---

# 6. Visual Simulation Idea

# **Dream Rollout Observatory × World Model Reliability Lab**

這輪最值得直接加入 Hermes Console。

## 左側：真實世界 timeline

```text
REAL

Obs #42
↓
Agent state
↓
selected action
↓
Obs #43
```

## 中間：Dream Tree

```text
                    current state
                    /     |      \
                 A1       A2      A3
                / \       |      / \
              s1  s2     s3    s4  s5
             /             \
           ...             ...
```

每一條 edge 顯示：

```text
Predicted reward
Uncertainty
Grounding distance
OOD
Latency
GPU cost
```

## 右側：Reality Gap

實際 action 執行後：

```text
Predicted next state
vs
Observed next state
```

顯示：

| Metric | Value |
|---|---:|
| latent prediction error | 0.12 |
| reward error | 0.03 |
| termination error | 0 |
| observation divergence | 0.21 |
| accumulated rollout drift | 0.46 |

## 互動模式

使用者可以調：

```text
Horizon      1 ───────── 64
Branches     1 ───────── 32
Risk weight  low ─────── high
Use model    RSSM / Video / LLM
```

例如 horizon 從 5 拉到 30：

```text
Expected reward      ↑
Uncertainty          ↑↑
Model drift          ↑↑↑
Planning reliability ↓
```

直接可視化：

> 想得更遠，不一定代表看得更準。

---

# 7. Code / GitHub 深讀

## 7.1 `danijar/dreamerv3`

**Repository:** https://github.com/danijar/dreamerv3

值得看的核心檔案：

```text
dreamerv3/rssm.py
```

### `observe()`

真正 observation-conditioned posterior path：

```text
previous latent
+ action
↓ _core
new deterministic state
+ encoded observation tokens
↓ obs network
posterior logits
↓ categorical sample
stochastic state
```

### `imagine()`

真正 model-only rollout：

```text
policy(carry)
↓
action
↓ _core
next deterministic
↓ _prior
prior logits
↓ sample
next stochastic
```

這兩個函式是理解 Dreamer 底層最值得看的核心。

---

## 7.2 `dreamerv3/agent.py`

值得看：

```text
loss()
```

實際流程：

```text
Replay batch
↓
Encoder
↓
RSSM loss
↓
Decoder + reward + continuation
↓
select latent starts
↓
dyn.imagine(..., H)
↓
reward / continuation / policy / value predictions
↓
imag_loss()
```

這個程式碼清楚證明：

```text
World Model Learning
與
Policy Learning In Imagination
```

是同一 training step 中的兩個不同區段。

---

## 7.3 `nicklashansen/dreamer4`

**Repository:** https://github.com/nicklashansen/dreamer4

必須標記：**unofficial implementation**。

值得看的：

```text
dreamer4/model.py
dreamer4/train_dynamics.py
dreamer4/interactive.py
```

其 code / README 呈現：

```text
causal tokenizer
+
block-causal transformer dynamics
+
action conditioning
+
shortcut forcing
```

這是從 RSSM transition 進一步走向 scalable video dynamics 的重要工程對照。

---

# 8. Papers

## Paper A — Mastering Diverse Control Tasks through World Models

**Authors:** Danijar Hafner, Jurgis Pasukonis, Jimmy Ba, Timothy Lillicrap  
**Institution:** Google DeepMind / collaborators  
**Published:** Nature 2025（DreamerV3 earlier preprint 2023）  
**Code:** https://github.com/danijar/dreamerv3

### Architecture

```text
Encoder
→ RSSM
→ reconstruction/reward/continuation
→ latent imagination
→ actor-critic
```

### Contribution

- fixed-hyperparameter world-model RL across diverse tasks
- latent imagination supports policy learning without repeated real environment interaction
- categorical latent dynamics + robust normalization/training tricks

### Limitation

- rollout reliability ultimately受 learned model bias 約束
- latent dynamics 不等同可解釋 causal world representation
- long-horizon imagination 可能 drift

---

## Paper B — Training Agents Inside of Scalable World Models

**Authors:** Danijar Hafner, Wilson Yan, Timothy Lillicrap  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2509.24527

### Architecture

```text
causal video tokenizer
→ scalable transformer dynamics
→ action conditioning
→ interactive future generation
→ agent imagination training
```

### Contribution

- real-time world-model inference on one GPU
- offline video knowledge + small action-conditioned data
- Minecraft diamond task from offline data only

### Limitation

- large-scale generative dynamics still會產生 model hallucination / drift
- reproduction cost 高
- world model fidelity 與 policy deployment robustness 仍需 real-world validation

---

## Paper C — Genie: Generative Interactive Environments

**Authors:** Jake Bruce et al.  
**Institution:** Google DeepMind  
**Year:** 2024

### Architecture

```text
video tokenizer
→ latent action model
→ autoregressive dynamics
```

### Contribution

從無 action label 網路影片學 action-controllable world model。

### Limitation

可互動生成與 planning correctness 並非同義。

---

## Paper D — Self-Evolving World Models for LLM Agent Planning

**Authors:** Xuan Zhang, Wenxuan Zhang, See-Kiong Ng, Yang Deng  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2606.30639

### Architecture

```text
Episodic Memory
+
Semantic Memory
+
Selective Foresight
→ LLM Agent Planner
```

### Contribution

用 real prediction-observation mismatch 在 deployment time 改善 world-model context，不需要更新 downstream agent parameters。

### 重要改變

它把 LLM world model 從：

```text
predict future
```

提升成：

```text
predict
→ compare reality
→ update memory
→ filter unreliable foresight
```

---

## Paper E — Efficient Agentic Reasoning Through Self-Regulated Simulative Planning

**Authors:** Mingkai Deng et al.  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2605.22138

### Architecture

```text
Reactive Executor
+
Simulative Planner
+
Self-Regulation Controller
```

### Contribution

把「是否規劃」與「規劃多遠」顯式拆開。

---

# 9. Known Facts / Engineering Evidence / Inference / Hypothesis

## 已確認事實

- DreamerV3 official/open repository 的 RSSM 明確區分 observation-conditioned `observe()` 與 prior-only `imagine()`。
- DreamerV3 agent training 會從真實 replay sequence 得到 latent starts，再做多步 imagined rollout 訓練 actor/value。
- Dreamer 4 論文將 scalable world model 用於 offline imagination training。
- Genie 系列確實能生成 action-controllable interactive environments。
- 2026 WorldEvolver 明確加入 selective foresight，以降低 unreliable prediction 對 LLM Agent 的負面影響。

## 工程實作

- `danijar/dreamerv3` 可直接看到 RSSM transition、posterior/prior 與 imagination training loop。
- `nicklashansen/dreamer4` 是 unofficial reproduction，可用來研究 block-causal tokenizer/dynamics，但不能當官方 implementation 等價證據。

## 合理推論

- Hermes 應把「grounding distance」當作 dream rollout reliability 的一個核心 feature。
- world-model prediction 應有 provenance 與 safety tier，不應和 real observation 混入同一 evidence pool。
- LLM Agent 的 textual foresight 可以共用 Hermes 的 rollout graph abstraction，但不能假設與 RSSM latent state 具有相同 probabilistic semantics。

## 尚未驗證假說

- `GroundingDistance + OOD + ensemble disagreement` 是否足以構成跨模型通用的 rollout reliability estimator。
- LLM symbolic simulation 與 latent video simulation 是否能共享 calibrated uncertainty scale。
- production agent 是否能動態學會在 RSSM / video WM / LLM simulator 間 routing。

---

# 10. Unknown / Open Questions

## 1. World model 的 uncertainty 如何可靠傳到 rollout tree？

如果每一步都有 uncertainty：

```text
u_t
```

multi-step uncertainty 不能簡單：

```text
u_total = Σu_t
```

因為 transition error 高度相關，branch 之間也可能共享 bias。

需要：

```text
RolloutUncertaintyPropagation
```

---

## 2. Agent 如何判斷「model 已經開始 hallucinate」？

需要研究：

```text
ensemble disagreement
latent OOD
consistency checks
cycle prediction
multi-model disagreement
real observation anchors
```

---

## 3. 何時應停止 dream，改回真實 observation/tool execution？

需要 formalize：

```text
Marginal planning value
vs
model uncertainty
vs
real-world action cost
```

形成真正：

```text
DreamStoppingRule
```

---

# 11. Knowledge Graph 新增 Node / Edge

## Nodes

```text
LatentWorldState
GroundedLatentState
ImaginedLatentState
PosteriorState
PriorState
DreamRollout
DreamRolloutEngine
ImaginationHorizon
GroundingDistance
PlanningRolloutGraph
WorldModelBias
ModelBiasAccumulation
RolloutDrift
WorldModelUncertainty
PredictionRealityGap
RewardPrediction
ContinuationPrediction
SelectiveForesightGate
ForesightReliability
PlanningBudgetController
AdaptivePlanningHorizon
WorldModelExploitationRisk
RealityAnchor
DreamStoppingRule
WorldModelArchitectureVersion
DecisionDynamicsFidelity
ObservationFidelity
```

## Edges

```text
Real Observation
→ Grounds Posterior State

Prior State
→ Generates Imagined State

Imagined State
→ Increases Grounding Distance

Grounding Distance
→ Can Increase Rollout Risk

One-Step Accuracy
≠ Long-Horizon Reliability

Visual Realism
≠ Dynamics Accuracy

Dynamics Accuracy
≠ Decision Sufficiency

Longer Planning Horizon
≠ Better Planning

More Foresight
≠ Better Agent

World Model Error
→ Can Be Exploited By Policy

Prediction-Reality Mismatch
→ Should Update World Model Memory

High Model Uncertainty
→ Should Reduce Foresight Authority

Selective Foresight
→ Filters Imagined Evidence
```

---

# 12. 下一輪研究

下一輪最自然收斂到：

# **World Model Hallucination × Model Bias Detection × Uncertainty Propagation × Reality Anchoring**

因為現在已完成：

```text
Belief State
↓
World Model
↓
Dream Rollout
↓
Planning
```

但最大的 production 缺口變成：

> Agent 怎麼知道自己的夢開始不可信？

下一輪應優先追：

```text
World-model hallucination detection
ensemble world models
latent uncertainty
OOD detection
model disagreement
rollout drift
uncertainty calibration
reality anchoring
Dyna-style real/model mixture
model exploitation
safe model-based RL
```

並建立：

```text
RolloutReliabilityCertificate
RealityAnchorPolicy
ModelBiasDetector
WorldModelHallucinationEvent
UncertaintyPropagationGraph
DreamStoppingRule
ModelExploitationDetector
```

---

# 13. 本輪結束回答

## 缺哪一層？

**World Model Reliability / Hallucination Detection / Reality Anchoring Layer。**

目前 Hermes 已知道如何維護 belief，也知道如何 dream，但還不知道什麼時候應該「不要相信自己的夢」。

## 哪個節點最淺？

```text
WorldModelUncertainty
RolloutReliability
ModelBiasAccumulation
DreamStoppingRule
```

## 哪個概念仍只是名詞？

production 級：

```text
Decision-Sufficient World Model
```

目前沒有跨 domain、跨 world-model architecture 的簡單統一定義。

## 哪個系統值得讀原始碼？

第一優先：

```text
danijar/dreamerv3
├ dreamerv3/rssm.py
└ dreamerv3/agent.py
```

第二優先：

```text
nicklashansen/dreamer4
```

但必須一直保留 `unofficial implementation` 標記。

## 哪篇論文需追引用？

1. **Training Agents Inside of Scalable World Models / Dreamer 4**
2. **Self-Evolving World Models for LLM Agent Planning / WorldEvolver**
3. **Efficient Agentic Reasoning Through Self-Regulated Simulative Planning / SR²AM**

## 哪個概念最適合視覺模擬？

**Dream Rollout Observatory × World Model Reliability Lab**。

## 哪個 Agent 架構最值得實作？

```text
Real Observation
↓
Grounded Belief / Latent State
↓
World Model
↓
Multi-Branch Dream Rollout
↓
Uncertainty + Model-Bias Estimator
↓
SelectiveForesightGate
↓
Planner / Actor
↓
Real Action
↓
Prediction-Reality Comparator
↓
Reality Anchor + Memory Update
```

---

# 14. 對「AI 到底怎麼運作」新增的一層

這輪把完整鏈再補深一層：

```text
Camera / Image / Sensor / Tool Observation
↓
Encoder / Tokenizer
↓
Grounded Latent State
↓
Learned World Dynamics
↓
Agent proposes actions
↓
World model internally predicts several futures
↓
Reward / termination / risk / uncertainty
↓
Planner evaluates futures
↓
Select action
↓
Real world executes
↓
New observation arrives
↓
Prediction compared with reality
↓
Belief + world-model memory corrected
```

核心答案是：

> **真正具有 foresight 的 AI，不只是「多想幾步」。它需要一個可以根據 action 模擬未來的 world model，並且必須把真實 observation 與 imagined future 分開。Dreamer 類系統展示了 Agent 可以直接在 latent imagination 中學習行為；但越遠離最後一次真實 observation，model bias 與 uncertainty 越可能累積。因此成熟 Agent 的核心不是無限做夢，而是知道什麼時候可以在夢裡規劃、什麼時候夢已不可信，以及什麼時候必須回到真實世界重新觀察。**

---

## Sources / Verification Trail

- DreamerV3 repository: https://github.com/danijar/dreamerv3
- Dreamer 4 paper: https://arxiv.org/abs/2509.24527
- Dreamer 4 unofficial PyTorch reference: https://github.com/nicklashansen/dreamer4
- Genie official publication: https://deepmind.google/research/publications/60474/
- Genie 2 official article: https://deepmind.google/blog/genie-2-a-large-scale-foundation-world-model/
- WorldEvolver: https://arxiv.org/abs/2606.30639
- SR²AM: https://arxiv.org/abs/2605.22138
