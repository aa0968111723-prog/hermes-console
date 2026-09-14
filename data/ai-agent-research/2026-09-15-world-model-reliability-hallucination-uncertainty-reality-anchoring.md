# 【AI Agent × Multimodal Research Report】

## 時間

2026-09-15 03:53（Asia/Taipei）

## 本小時研究主題

**World Model Reliability × Hallucination Detection × Uncertainty Propagation × Reality Anchoring**

本輪直接承接上一輪 `Latent World Model × Dream Rollout × Predictive Observation Simulation × Model-Based Agent Planning` 的缺口，不重複 Dreamer/RSSM 基礎，而專注回答：

> Agent 怎麼知道自己的 dream rollout 已開始不可信？

研究鏈：

```text
Real Observation
↓
Grounded Latent / Belief
↓
World Model
↓
Dream Rollout
↓
Reliability Signals
↓
Hallucination Classification
↓
Risk / Task Relevance
↓
Reality Anchor Gate
↓
Continue Dream / Re-observe / Reject / Escalate
```

---

# 本小時新發現

## 新論文 / Benchmark

### 1. Hallucination in World Models is Predictable and Preventable
- Authors: Nicklas Hansen, Xiaolong Wang
- Institution: UC San Diego
- Year: 2026
- URL: https://arxiv.org/abs/2606.27326
- Code: https://github.com/nicklashansen/mmbench2
- Dataset: MMBench2
- Scale: 427 hours, 210 tasks, 10 domains, ~23M frames, 65.6K trajectories
- Architecture: ~350M generative world model，Dreamer-4-style；~100M causal video tokenizer + ~250M block-causal transformer dynamics
- Contribution: 將 world-model hallucination 拆成 perceptual / action-marginalized / scene-diverging 三類，並提出 runtime signals 預測 hallucination；再用 coverage-aware sampling 與 curiosity-driven targeted data collection 修補 coverage gap。
- Limitation: 主要證據來自視覺 continuous-control world models；不能直接假設同一 predictor 對 symbolic / LLM world model、real-world open-world agents 完全成立。

### 2. Perceiving the Knowledge Boundary: Uncertainty-Guided Exploration and Imagination for World Models
- Authors: Zhenxian Liu, Peixi Peng, Yangru Huang, Yonghong Tian
- Institutions: Peking University / Peng Cheng Laboratory
- Venue: AAAI 2026
- URL: https://ojs.aaai.org/index.php/AAAI/article/view/39576
- Benchmarks: CARLA, DeepMind Control Suite, Atari, MemoryMaze
- Architecture: ensemble lightweight predictors around a learned world model
- Contribution: 以 ensemble disagreement 近似 world model 的 knowledge boundary，將高 uncertainty 區域同時用於 exploration curiosity 與 imagined-rollout filtering。
- Limitation: ensemble disagreement 是 epistemic uncertainty proxy，不等同 task risk，也不保證所有 OOD 都被偵測。

### 3. Learning to Be Uncertain: Pre-training World Models with Horizon-Calibrated Uncertainty
- Authors: Shenghua Wan, Le Gan, De-Chuan Zhan
- Venue: ICLR 2026
- URL: https://proceedings.iclr.cc/paper_files/paper/2026/hash/ad222e6e38e26e3f00d85829b9e02f43-Abstract-Conference.html
- Architecture: probabilistic ensemble + horizon-conditioned prediction
- Contribution: 明確要求 predictive uncertainty 隨 prediction horizon 成長，避免 deterministic single-future world model 對遠期預測過度自信。
- Benchmarks: MetaWorld, DeepMind Control Suite, RoboDesk
- Limitation: uncertainty calibration 仍與 downstream task risk 分離。

### 4. Learning from World Feedback: Why Model Uncertainty Fails as a Risk Signal in Model-Based RL
- Author: Zhaohui Wang
- Year: 2026 preprint
- URL: https://arxiv.org/abs/2607.16591
- Contribution: 指出 dynamics uncertainty 與 safety risk 可能幾乎不相關；其實驗中 model-uncertainty penalty 甚至增加 collision，而 sensor-derived / outcome-supervised world feedback 更能降低碰撞。
- Limitation: 單篇近期 preprint，需等待更廣泛 replication。

### 5. Current Agents Fail to Leverage World Model as Tool for Foresight
- Authors: Cheng Qian et al.
- Venue: ACL 2026
- URL: https://aclanthology.org/2026.acl-long.623/
- Contribution: 即使 agent 有 world-model simulator，也常不知道何時用、怎麼解讀、如何整合 predicted rollout；world model availability 本身不等於可靠 foresight。
- Limitation: 評估重點在 agent 使用 simulator 的能力，而不是 world-model internal calibration 本身。

---

# 本小時最重要 5 個發現

## 1. World-model hallucination 不是單一錯誤，而至少要分三層定位

【論文結果 + 官方程式碼確認】MMBench2 把 hallucination 分成：

```text
PERCEPTUAL HALLUCINATION
Input / tokenizer representation 已失真

ACTION-MARGINALIZED HALLUCINATION
預測未充分條件化 action

SCENE-DIVERGING HALLUCINATION
前幾步合理，但 rollout error 累積後脫離真實 dynamics
```

這意味 Hermes 不應只有：

```text
world_model_confidence = 0.63
```

而應輸出：

```text
WorldModelFailureProfile
├ perceptual_risk
├ action_conditioning_risk
├ rollout_divergence_risk
├ horizon
├ grounding_distance
└ evidence
```

為什麼重要：三種 failure 的修復方法不同。

```text
Perceptual
→ re-observe / higher-resolution / better tokenizer

Action-marginalized
→ stronger action conditioning / intervention consistency test

Scene-diverging
→ shorten rollout / reality anchor / refresh posterior
```

---

## 2. MMBench2 的 uncertainty.py 揭露一個很實用的 bottom-level mechanism：同一 action 的多 seed prediction divergence

【工程實作，官方 GitHub】`src/uncertainty.py` 對 diffusion / flow-based dynamics 使用不同 noise seeds：

```text
same past state
+
same candidate action
+
multiple random denoising seeds
↓
prediction_1
prediction_2
prediction_3
...
↓
variance
```

原始碼 `CrossSeedScorer` 實際計算：

```text
u_s = mean( Var_seed(predicted_latent) )
```

假設是：

```text
well-covered region
→ different seeds converge
→ low variance

poorly-covered region
→ different seeds disagree
→ high variance
```

這是一種 reward-free、無需改 dynamics architecture 的 uncertainty proxy。

但 Hermes 必須保留：

```text
High Cross-Seed Variance
≠ High Task Risk
```

因為它描述的是 prediction-space instability，而不是「執行這個 action 是否危險」。

---

## 3. Tokenizer round-trip residual 可以偵測「模型開始離開自己可表徵的 manifold」

【工程實作，官方 GitHub】MMBench2 的 `URNormScorer`：

```text
predicted latent z_pred
↓ decode
predicted image
↓ encode
z_recon
↓ compare
round-trip residual
```

公式：

```text
u_r = RMS(z_pred - encode(decode(z_pred)))
```

但作者沒有直接使用 raw residual，而會除以 predicted motion：

```text
motion = RMS(z_pred - z_prev)

u_r_norm = u_r / max(motion, eps)
```

原因非常重要：如果場景本身移動很大，raw residual 可能只是在測 motion，而不是 hallucination。

因此新增 Hermes bottom-level rule：

```text
Reliability Signal
→ Must Separate Model Error From Legitimate Environment Change
```

可泛化到 Agent：

```text
State Difference
≠ Model Error

Tool Result Changed
≠ World Model Hallucinated
```

必須有 normalized / conditional residual。

---

## 4. 「Uncertainty」必須與「Risk」正式分成兩張 graph

【交叉驗證】
- AAAI 2026 knowledge-boundary 工作顯示 ensemble disagreement 很適合偵測 world-model competence boundary。
- 2026 world-feedback preprint 則指出 dynamics uncertainty 可能和 collision risk 幾乎不相關，甚至 uncertainty penalty 會降低安全。

這不是矛盾，而是 target 不同：

```text
MODEL UNCERTAINTY
Question:
「模型知不知道未來會怎樣？」

TASK RISK
Question:
「如果這條未來是真的，會不會造成高損失？」
```

Hermes 不能做：

```text
risk = uncertainty
```

應拆成：

```text
WorldModelReliability
├ epistemic uncertainty
├ aleatoric uncertainty
├ rollout drift
├ coverage score
└ calibration

TaskRisk
├ safety constraint
├ irreversible side effect
├ privacy
├ money
├ physical harm
└ mission failure
```

然後決策：

```text
ActionDecision
=
f(WorldModelReliability, TaskRisk, ValueOfInformation, Cost)
```

這是本輪對 production Agent 最重要的系統結論之一。

---

## 5. Reality Anchoring 不應只是固定每 N 步重新觀察，而要由 rollout reliability 動態觸發

【合理建模，基於前述論文/實作】

固定：

```text
simulate 10 steps
→ observe reality
```

太粗糙。

應變成：

```text
Grounded State
↓
Dream step 1
↓ reliability check
Dream step 2
↓ reliability check
Dream step 3
↓
Reliability < threshold
OR task risk × uncertainty > threshold
↓
REALITY ANCHOR
↓
Camera / Tool / Sensor / Environment observation
↓
Posterior correction
↓
Resume planning
```

因此新增：

```text
RealityAnchorPolicy
├ trigger_signal
├ reliability_threshold
├ risk_multiplier
├ max_grounding_distance
├ observation_action
├ posterior_update
└ rollout_invalidation_scope
```

重要區分：

```text
Reality Anchor
≠ Restart Entire Agent
```

只需要 invalidation 受到新 observation 影響的 imagined descendants。

這可以直接和前面已建立的 causal trace / dynamic replay infrastructure 結合。

---

# Architecture Breakdown

## Hermes World Model Reliability Stack

```text
REAL WORLD
├ camera
├ microphone
├ browser
├ tool result
├ sensor
└ user feedback
↓
Grounded Observation Registry
↓
Encoder / Tokenizer
↓
Grounded Latent / Belief State
↓
─────────────────────────────────────
WORLD MODEL
├ transition predictor
├ observation predictor
├ reward predictor
├ termination predictor
└ action conditioning
─────────────────────────────────────
↓
Dream Rollout Engine
↓
Reliability Instrumentation
├ tokenizer round-trip residual
├ inter-seed variance
├ ensemble disagreement
├ action-conditioning consistency
├ rollout drift
├ OOD / coverage score
├ horizon-calibrated uncertainty
└ prediction-reality residual
↓
WorldModelHallucinationClassifier
├ PERCEPTUAL
├ ACTION_MARGINALIZED
├ SCENE_DIVERGING
└ UNKNOWN
↓
WorldModelReliabilityGraph
↓
TaskRiskGraph
↓
RealityAnchorGate
├ CONTINUE_DREAM
├ SHORTEN_HORIZON
├ BRANCH_MORE
├ REQUEST_REAL_OBSERVATION
├ REJECT_ROLLOUT
└ HUMAN_ESCALATION
↓
Planner
↓
Real Action
↓
Prediction-Reality Comparator
↓
Coverage / Memory / Model Update
```

---

# Bottom-Level Logic

## A. Cross-seed predictive variance

```text
z_{t+1}^{(i)} ~ WorldModel(z_t, a_t, ε_i)
```

```text
u_seed
=
mean_j Var_i[z_{t+1,j}^{(i)}]
```

使用：
- epistemic / stochastic instability proxy
- candidate action ranking
- curiosity data collection

限制：
- 多 seed 同錯時 variance 仍可能低
- aleatoric multimodality 可能造成高 variance，但不代表模型無知

所以：

```text
Low disagreement
≠ model is correct
```

---

## B. Round-trip manifold residual

```text
z_pred
↓ Decoder
x_pred
↓ Encoder
z_roundtrip
```

```text
u_roundtrip = ||z_pred - z_roundtrip||
```

motion normalized：

```text
u_norm
=
u_roundtrip / max(||z_pred-z_prev||, ε)
```

Interpretation：若 rollout 走到 tokenizer / representation 不熟悉的區域，decode→encode 後難以回到原 latent。

---

## C. Horizon uncertainty propagation

世界模型不確定性不應固定：

```text
U(t+1)
=
Propagate(U(t), transition uncertainty, stochasticity)
```

production simplification：

```text
U_h
=
U_0
+ Σ transition_uncertainty_i
+ interaction / drift term
```

Horizon-Calibrated Uncertainty 的核心思想是：

```text
future farther away
→ predictive distribution should normally broaden
```

因此新增：

```text
OverconfidenceAtLongHorizonEvent
```

判斷：

```text
horizon ↑
but predicted uncertainty ≈ constant / ↓
→ calibration warning
```

---

## D. Prediction-Reality residual

真正 reality anchor 後：

```text
PredictedObservation_t
vs
ActualObservation_t
```

不要只比較 pixels。

應至少分：

```text
RepresentationResidual
ObjectStateResidual
ActionEffectResidual
RewardResidual
ConstraintResidual
SemanticEventResidual
```

因為：

```text
Pixel Error Low
≠ Dynamics Correct
```

背景預測很準，但 object/action interaction 錯，仍可造成 planning failure。

---

# Visual Simulation Idea

# World Model Reliability Observatory × Reality Anchor Lab

Hermes Console 畫面中心是一棵 dream rollout tree：

```text
                    REAL STATE
                       │
               Grounding distance 0
                       │
            ┌──────────┼──────────┐
            A          B          C
            │          │          │
          t+1        t+1        t+1
          .18        .29        .11   uncertainty
            │          │          │
          t+2        t+2        t+2
          .31        .58⚠       .16
            │          │
          t+3       REALITY ANCHOR
```

點選任一 dream node 顯示：

```text
Cross-seed variance       0.41
Round-trip residual       0.33
Motion-normalized u       0.72
Coverage score            LOW
Action consistency        0.88
Grounding distance        5
Task risk                 HIGH
```

UI 再顯示：

```text
Hallucination Type:
SCENE_DIVERGING — 71%

Decision:
REQUEST REAL OBSERVATION
```

Reality observation 到來後，將 predicted / actual 疊圖：

```text
Prediction:
object remains on table

Reality:
object has fallen

Action Effect Residual: HIGH
Semantic Event Residual: HIGH
```

接著 graph 自動：

```text
invalidate descendants
↓
update posterior
↓
re-plan only affected branches
```

這個視覺模擬能把「AI 在做夢」與「AI 回到現實校正」直接可視化。

---

# Code / GitHub 深讀

## nicklashansen/mmbench2

Repository:
https://github.com/nicklashansen/mmbench2

值得看的核心檔案：

```text
src/
├ model.py
│  └ world model / tokenizer / dynamics
├ uncertainty.py
│  ├ sample_predictions_for_actions
│  ├ CrossSeedScorer
│  └ URNormScorer
├ curiosity.py
│  ├ curiosity_mpc_action
│  ├ CEM candidate search
│  └ multi-step uncertainty rollout
├ collect_data.py
│  └ closed-loop targeted data collection
├ plan_cem.py
│  └ planning
├ train_tokenizer.py
└ train_dynamics.py
```

### `uncertainty.py`

已確認：

```text
sample_predictions_for_actions()
```

會對每個 candidate action sequence 做 N 個 independent dynamics samples。

`CrossSeedScorer`：

```text
predictions.var(dim=seed).mean(...)
```

`URNormScorer`：

```text
z_pred
→ decode
→ temporal_patchify
→ encoder
→ z_recon
→ RMS residual
÷ predicted motion
```

### `curiosity.py`

不是單純選「最高 uncertainty action」；實際使用 CEM：

```text
Gaussian candidate action distribution
↓
sample K candidates
↓
world-model prediction samples
↓
uncertainty scorer
↓
Top elite actions
↓
refit μ / σ
↓
iterate
```

multi-step 時再 rollout 每個 candidate sequence，將 per-step score 聚合成：

```text
0.5 × mean uncertainty
+
0.5 × max uncertainty
```

這是一個非常適合 Hermes 借鑑的 **Active Reality-Probing Planner** 模板。

但 production Hermes 應把 objective 從：

```text
maximize uncertainty
```

改成：

```text
maximize
Expected Model Improvement
or
Decision-Relevant Information Gain
-
Observation / Action Cost
-
Safety Risk
```

---

# Papers：本輪改變了什麼

## Hansen & Wang 2026 — Hallucination in World Models is Predictable and Preventable

改變：

```text
World-model hallucination
從「模糊的 generative failure」
↓
變成 stage-specific + measurable + data-coverage linked failure
```

尤其重要的是：

```text
same signals
→ detect hallucination
→ guide data collection
→ mitigate hallucination
```

形成 detection→repair loop。

## Liu et al. 2026 — Perceiving the Knowledge Boundary

改變：

```text
uncertainty
從 passive confidence score
↓
變成 exploration + imagination filter
```

也就是 world model 不只說「我不確定」，而是用 uncertainty 改變 Agent 下一步資料蒐集與 policy training。

## Wan et al. 2026 — Horizon-Calibrated Uncertainty

改變：

```text
single confidence
↓
uncertainty must be horizon aware
```

這對任何 long-horizon Agent 都非常重要。

## Wang 2026 — Why Model Uncertainty Fails as a Risk Signal

改變：

```text
uncertainty
≠ safety risk
```

提醒 Hermes 不可以直接用 epistemic uncertainty 當 permission / irreversible-action gate。

## Qian et al. 2026 — Current Agents Fail to Leverage World Model as Tool for Foresight

改變：

```text
having a simulator
≠ knowing how to use a simulator
```

因此 Hermes 需要 `Foresight Use Policy`，而不是只增加一個 world-model tool。

---

# Unknown / Open Questions

## 1. uncertainty signal 怎麼校準成 rollout failure probability？

目前：

```text
u_seed = 0.42
u_norm = 0.71
```

仍不能直接解讀為：

```text
71% hallucination probability
```

需要 model × task × horizon × domain calibration curve。

---

## 2. 多個 predictor 彼此衝突時怎麼融合？

例如：

```text
Cross-seed variance LOW
Round-trip residual HIGH
Action consistency LOW
```

這究竟是：
- representation OOD？
- deterministic hallucination？
- action marginalization？

需要 `WorldModelReliabilityFusion`。

---

## 3. Agent 何時應 trust internal simulation，何時必須回到真實 world？

這不是固定 threshold。

應依：

```text
uncertainty
× task risk
× irreversibility
× grounding distance
× observation cost
× action urgency
```

共同決定。

---

# Knowledge Graph 新增 Node

```text
WorldModelHallucination
PerceptualHallucination
ActionMarginalizedHallucination
SceneDivergingHallucination
WorldModelKnowledgeBoundary
WorldModelReliabilitySignal
CrossSeedVariance
TokenizerRoundTripResidual
MotionNormalizedResidual
ActionConditioningConsistency
HorizonCalibratedUncertainty
GroundingDistance
RolloutDrift
RolloutReliabilityCertificate
RealityAnchor
RealityAnchorPolicy
PredictionRealityResidual
WorldModelReliabilityFusion
WorldModelFailureProfile
OverconfidenceAtLongHorizonEvent
ActiveRealityProbing
DecisionRelevantUncertainty
OutcomeGroundedRisk
```

# Knowledge Graph 新增 Edge

```text
Low Data Coverage
→ Increases Hallucination Risk

CrossSeed Disagreement
→ Signals Predictive Instability

Tokenizer RoundTrip Residual
→ Signals Representation / Manifold Mismatch

Longer Imagination Horizon
→ Should Increase Predictive Uncertainty

Model Uncertainty
≠ Task Risk

Low Prediction Error
≠ Correct Decision Dynamics

Visual Fluency
≠ Dynamics Faithfulness

Low Disagreement
≠ Guaranteed Correctness

Reality Observation
→ Resets Grounding Distance

Prediction-Reality Mismatch
→ Updates Reliability Profile

High Risk × Low Reliability
→ Triggers Reality Anchor

Reality Anchor
→ Invalidates Affected Imagined Descendants
```

---

# 與歷史研究比較

上一輪已建立：

```text
Grounded Latent State
→ Dream Rollout
→ PlanningRolloutGraph
→ SelectiveForesightGate
```

本輪不再討論「如何做 dream rollout」，而補上：

```text
Dream Rollout
↓
How reliable?
↓
Which failure mode?
↓
Is uncertainty decision-relevant?
↓
When must reality override simulation?
```

也就是從：

```text
World Model = Future Generator
```

推進到：

```text
World Model = Future Generator
+ Reliability Instrumentation
+ Hallucination Taxonomy
+ Reality Anchoring Runtime
```

---

# 下一輪研究

## 主題

**World Model Reliability Fusion × Calibration × Dream Stopping Rule × Outcome-Grounded Risk**

下一輪應深入：

```text
Multiple reliability signals
↓
Calibration dataset
↓
Failure probability by horizon
↓
Task-risk coupling
↓
Dynamic Dream Stopping Rule
↓
Reality Anchor Scheduling
```

優先研究：

```text
uncertainty calibration
conformal prediction for dynamics
ensemble disagreement
risk-sensitive MPC
model exploitation detection
OOD detection in latent dynamics
world-feedback / outcome feedback
adaptive horizon control
```

預計新增：

```text
ReliabilityCalibrationProfile
DreamStoppingRule
ReliabilityFusionGraph
OutcomeGroundedRiskModel
RealityAnchorScheduler
WorldModelExploitationDetector
RolloutFailureProbability
```

---

# 本輪結束回答

## 缺哪一層？

**Reliability Calibration + Risk Coupling + Dynamic Dream Stopping Layer**。

目前已能產生多個 uncertainty / hallucination signals，但還沒有一個可信的 production rule 把它們融合成「是否繼續 rollout」。

## 哪個節點最淺？

```text
RolloutReliabilityCertificate
WorldModelReliabilityFusion
DreamStoppingRule
OutcomeGroundedRiskModel
```

## 哪個概念仍只是名詞？

production 級：

```text
Decision-Sufficient World Model Reliability
```

目前沒有一個 universal scalar 可以同時代表 prediction correctness、planning usefulness 與 safety。

## 哪個系統最值得讀原始碼？

`nicklashansen/mmbench2`

優先順序：

```text
src/uncertainty.py
→ src/curiosity.py
→ src/collect_data.py
→ src/plan_cem.py
→ src/model.py
```

## 哪篇論文最需追引用？

第一優先：**Hallucination in World Models is Predictable and Preventable**。

第二優先：**Perceiving the Knowledge Boundary**。

第三優先：**Learning to Be Uncertain: Horizon-Calibrated Uncertainty**。

## 哪個概念最適合視覺模擬？

**World Model Reliability Observatory × Reality Anchor Lab**。

## 哪個 Agent 架構最值得實作？

```text
Grounded Observation
↓
Belief / Latent State
↓
World Model
↓
Multi-branch Dream Rollout
↓
Reliability Signals
↓
Hallucination Classifier
↓
Reliability × Task Risk Gate
↓
Reality Anchor / Continue Dream
↓
Planner
↓
Real Action
↓
Prediction-Reality Comparator
```

---

# 這輪對「AI 到底怎麼運作」新增的核心答案

> 有 world model 的 AI 並不是單純「在腦中看未來影片」。真正可用的 Agent 必須同時估計：這個 imagined future 是否仍位於模型熟悉的 state-action coverage、不同 stochastic rollouts 是否互相一致、latent 經 decode→encode 是否仍能回到同一 representation manifold、action 是否真的改變 prediction，以及 rollout 隨 horizon 是否正在逐步漂移。更重要的是，模型的「不知道」和現實世界的「危險」不是同一件事。成熟 Agent 必須在 world-model reliability 下降、task risk 上升或 grounding distance 過遠時主動回到真實世界重新觀察，讓 imagination 永遠受 Reality Anchor 約束，而不是讓一條看起來很合理的 hallucinated future 一路支配後續 planning。