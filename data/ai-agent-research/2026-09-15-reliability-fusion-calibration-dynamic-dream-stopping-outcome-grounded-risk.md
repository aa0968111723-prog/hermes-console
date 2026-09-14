# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 04:54（Asia/Taipei）**  
**主題：Reliability Fusion × Calibration × Dynamic Dream Stopping × Outcome-Grounded Risk**

## 與歷史研究比較

上一輪已建立 `WorldModelUncertainty`、`RolloutReliabilityCertificate`、`DreamStoppingRule`、`RealityAnchorPolicy` 等節點，但仍停留在「有多個 reliability signals，卻不知道如何融合、校準，以及如何和真正 task risk 分離」的階段。本輪不重複討論 world model hallucination 類型，而是專注在四個尚未補齊的 operational layers：

1. **Reliability signal fusion**：cross-seed variance、ensemble disagreement、round-trip residual、OOD、horizon、action-consistency 怎麼合成一個可用判斷。
2. **Calibration**：signal 高低怎麼對應到真正的 rollout error / decision failure probability，而非把 raw score 當概率。
3. **Dynamic dream stopping**：何時繼續 rollout，何時停止、縮短 horizon、要求 reality anchor。
4. **Outcome-grounded risk**：把「模型不確定」和「任務危險」分離，避免用錯 proxy。

---

## 本小時新發現

### 新架構：RISE — Refining Imagination through SElective Rollout

RISE（2026）不是固定 rollout horizon，而是讓 scheduler 在每一步做 `ROLL / STOP` 決策。其公開原始碼把 gating 問題明確寫成「**預測下一步 imagination 的 marginal utility**」。

論文：RISE: Adaptive Imagination for World Action Models  
Authors: Hongbo Lu, Liang Yao, Chenghao He, Hao Han, Fan Liu, Wenlong Liao, Tao He, Pai Peng  
Year: 2026  
URL: https://arxiv.org/abs/2608.20430  
Code: https://github.com/COOWAI/RISE  
Dataset: CounterDrive + NAVSIM + nuScenes  
Architecture: World Action Model + Latent Evaluator + Sequential Rollout Gate  
Contribution: 把 imagination depth 從全域 hyperparameter 改成每個 scene、每一步的動態 decision。  
Limitations: driving-domain centric；learned gate 的 calibration、OOD generalization 與跨 model portability 仍需獨立驗證。

### 新機制：CVoI / marginal-compute utility gate

RISE 公開程式碼中的 supervision target：

```text
utility(h) = task_score(h) - λ_compute · compute_cost(h)

best_future(h)
= max_{k>h} utility(k)

Δutility(h)
= best_future(h) - utility(h)

ROLL iff Δutility(h) > 0
```

其 `SequentialRolloutGate` 並不是單純 classifier；它預測 marginal utility，而且把 `lambda_compute` 限制成單調 compute penalty：

```text
predicted_delta
=
benefit(state)
-
softplus(slope(state)) · λ_compute
```

因此在 online state 完全相同時，提高 compute penalty 不可能提高繼續 rollout 的預測效益。這是一個非常值得 Hermes 採用的 structural constraint。

核心原始碼：
- `app/vjepa_cowa_world_model/training/sequential_budget_control.py`
- `app/vjepa_cowa_world_model/training/sequential_gate_training.py`
- `app/vjepa_cowa_world_model/training/cvoi_gate_pipeline.py`
- `app/vjepa_cowa_world_model/evaluation/cvoi_direct_epdms.py`

### 新論文：Horizon-Calibrated Uncertainty World Model（HAUWM）

Title: Learning to Be Uncertain: Pre-training World Models with Horizon-Calibrated Uncertainty  
Authors: Shenghua Wan, Le Gan, De-Chuan Zhan  
Institution: Nanjing University / associated authorship context  
Year: 2026, ICLR 2026  
URL: https://proceedings.iclr.cc/paper_files/paper/2026/hash/ad222e6e38e26e3f00d85829b9e02f43-Abstract-Conference.html  
Architecture: probabilistic ensemble + future-horizon sampling + Horizon-Calibrated Uncertainty loss  
Contribution: 直接把「越往遠期，predictive uncertainty 應合理增加」納入 training objective，而不是 rollout 完才用 heuristic 估 uncertainty。  
Limitations: horizon calibration 本身不等於 task-risk calibration，也不保證 safety constraint 邊界被正確建模。

### 新架構：ELVIS — uncertainty-aware soft truncation

Title: ELVIS: Ensemble-Calibrated Latent Imagination for Long-Horizon Visual MPC  
Authors: Yurui Du, Pinhao Song, Yutong Hu, Renaud Detry  
Institution: KU Leuven / Flanders Make  
Year: 2026, RSS 2026  
URL: https://arxiv.org/abs/2605.04709  
Code: https://github.com/RILEY-REEDUS/ELVIS  
Dataset/Tasks: 14 DeepMind Control visual tasks + real-world sand-spraying setup  
Architecture: Dreamer-style RSSM + Gaussian-Mixture MPPI + critic ensemble + adaptive λ-return  
Contribution: 不必硬 STOP，使用 critic ensemble uncertainty 調整 `λ_t`，讓遠期 imagination 在不可靠時更快轉向 bootstrap，形成 **soft dream truncation**。  
Limitations: critic disagreement 是 value uncertainty proxy，不代表真正 task hazard；依然可能 shared-bias / confidently-wrong。

### 新風險觀念：model uncertainty 不能直接當 task risk

Title: Learning from World Feedback: Why Model Uncertainty Fails as a Risk Signal in Model-Based RL  
Author: Zhaohui Wang  
Year: 2026, RLxF @ ICML  
URL: https://arxiv.org/abs/2607.16591  
Contribution: 實驗顯示 dynamics uncertainty 與 collision-risk constraint 的 correlation 很低（論文報告 r < 0.15）；使用 model uncertainty penalty 甚至可能提高 collision，而 sensor/outcome-grounded risk signals 更有效。  
Limitations: 結論來自特定 control setting，不能推廣成「uncertainty 沒用」；更精確的結論是 **uncertainty 是 model reliability signal，不是任務 consequence 的普適 surrogate**。

這和 knowledge-boundary 類工作並不衝突：ensemble disagreement 可以很好地判斷「模型是否超出自己熟悉的 prediction support」，但不能直接回答「這條 trajectory 是否撞車、洩漏隱私、造成不可逆工具操作」。

---

# 本小時最重要 5 個發現

## 1. Reliability 必須是多軸向量，不應過早壓成單一 scalar

### 概念

目前不同 uncertainty signal 測量的是不同 failure mode：

```text
Cross-seed variance
→ stochastic predictive instability

Ensemble disagreement
→ epistemic / model disagreement proxy

Round-trip residual
→ representation-manifold mismatch

Action consistency
→ action-conditioning fidelity

OOD / coverage
→ support mismatch

Horizon
→ compounding-error exposure

Prediction-Reality gap
→ realized calibration evidence
```

### 底層如何運作

Hermes 應先保留：

```text
ReliabilityVector_t = {
  u_seed,
  u_ensemble,
  u_roundtrip,
  u_ood,
  u_action,
  u_drift,
  horizon,
  grounding_distance
}
```

再由 task-specific calibrator 估：

```text
P(prediction_error > δ | ReliabilityVector, domain, horizon)
```

而不是：

```text
reliability = 1 - average(all_uncertainty_scores)
```

### 為什麼重要

不同 signal 的尺度、failure sensitivity、domain dependence 完全不同，簡單平均會讓一個「表現正常」的 signal 抵消另一個真正 catastrophic warning。

### 限制

Calibration dataset 若缺少 failure cases，fusion model 一樣會變成 confidently wrong。

---

## 2. Dream stopping 本質上是 sequential decision，而不是 uncertainty threshold

RISE 公開程式碼正式提供可實作版本：

```text
Current prefix state
↓
Estimate marginal future utility
↓
Subtract marginal compute cost
↓
ROLL iff expected Δutility > 0
```

其 gate features 包含：

```text
pooled_observed
pooled_prefix
field_value
stop_value
stop_value_slope
normalized_horizon
current_cost
next_cost
lambda_compute
```

而 `should_roll()` 的 runtime rule 是：

```text
if horizon == max_horizon:
    STOP
else:
    ROLL iff predicted_delta > 0
```

### 新 edge

```text
High Uncertainty
≠ Automatically Stop

Low Uncertainty
≠ Automatically Continue
```

因為「再多想一步是否值得」同時依賴：預期決策增益、成本、風險、剩餘 budget。

---

## 3. Hard STOP 與 Soft Truncation 應該同時存在

RISE 偏：

```text
ROLL / STOP
```

ELVIS 偏：

```text
continuous trust allocation
via uncertainty-adaptive λ-return
```

因此 Hermes 應有兩級控制：

```text
Level 1: SOFT TRUST CONTROL
→ downweight distant imagination
→ bootstrap earlier
→ reduce branch authority

Level 2: HARD ROLLOUT CONTROL
→ STOP
→ REQUEST REAL OBSERVATION
→ REJECT TRAJECTORY
```

### 為什麼重要

只用 hard threshold 容易不穩定；只用 soft downweight 又可能讓明顯不可信 trajectory 仍殘留決策權。

---

## 4. Horizon calibration 是 world model reliability 的必要結構，但不是 risk certificate

HAUWM 的核心價值是讓 model training 本身具有：

```text
horizon ↑
→ predictive variance should ↑
```

這比 rollout-time heuristic 更 principled。

但是：

```text
Calibrated predictive uncertainty
≠ Calibrated task risk
```

例如世界模型可能非常確定：

```text
Action X
→ vehicle collides in 1.2 sec
```

此時 model uncertainty 很低，但 task risk 極高。

反之，模型可能不確定遠處樹葉怎麼晃，但對車輛安全完全無關。

因此 Hermes 要維護兩張 graph：

```text
WorldModelReliabilityGraph
TaskConsequenceRiskGraph
```

最後才在 decision gate 融合。

---

## 5. 真正的 calibration target 應該來自 Prediction→Reality outcome，而不是只靠 internal proxy

世界模型部署後每次執行真實 action，都產生一筆天然 supervised sample：

```text
Predicted state / reward / risk
↓ execute
Actual observation / outcome
↓ compare
Prediction-Reality Error
```

所以 Hermes 應持續建立：

```text
ReliabilitySignal
→ PredictedFailureProbability
→ ActualOutcome
→ CalibrationUpdate
```

例如：

```text
predicted rollout failure probability = .20

在歷史 1000 筆同 bucket：
actual failure rate = .47

→ severe under-confidence calibration error
```

應建立 ECE / Brier / NLL / reliability diagram，而不是只存 uncertainty number。

---

# Architecture Breakdown

```text
Real Multimodal Observation
↓
Grounded Belief / Latent State
↓
World Model
↓
Candidate Action
↓
Dream Step t
↓
────────────────────────────────────
Reliability Instrumentation
├ CrossSeedDisagreement
├ EnsembleDisagreement
├ RoundTripResidual
├ OOD / Coverage Score
├ ActionConditioningConsistency
├ RolloutDrift
├ Horizon
├ GroundingDistance
└ Prediction-Reality Calibration Memory
────────────────────────────────────
↓
ReliabilityVector
↓
Domain/Horizon Calibrator
↓
RolloutReliabilityDistribution
↓
────────────────────────────────────
Task Consequence Model
├ collision
├ constraint violation
├ privacy leakage
├ irreversible tool side effect
├ financial cost
└ human harm / operational risk
────────────────────────────────────
↓
OutcomeGroundedRisk
↓
Marginal Planning Gain Estimator
↓
Compute / Latency / Token / GPU Cost
↓
Sequential Dream Controller
├ CONTINUE_FULL
├ CONTINUE_SOFT_TRUNCATED
├ REDUCE_BRANCHES
├ SHORTEN_HORIZON
├ STOP
├ REQUEST_REAL_OBSERVATION
└ HUMAN_ESCALATION
↓
Planner
↓
Real Action
↓
Actual Outcome
↓
Prediction-Reality Comparator
↓
Calibration Memory Update
```

---

# Bottom-Level Logic

## 1. Reliability calibration

令 raw reliability features 為：

```text
x_t = [u_seed, u_ensemble, u_roundtrip, u_ood,
       u_action, u_drift, horizon, grounding_distance]
```

calibrator：

```text
p_fail(t)
=
Calibrator(x_t, domain, model_version, task_family)
```

可以使用：

```text
Platt / logistic calibration
Isotonic calibration
Temperature scaling
Conformal thresholding
Small neural calibrator
```

但 calibration scope 必須記錄，不能跨 model/domain 無條件共用。

## 2. Sequential marginal utility

RISE-inspired：

```text
U(h)
=
TaskValue(h)
- λ_compute C(h)
- λ_risk Risk(h)
- λ_model P_model_failure(h)
```

再算：

```text
ΔU(h)
=
E[max_{k>h} U(k)] - U(h)
```

```text
ΔU(h) > 0
→ ROLL

ΔU(h) ≤ 0
→ STOP
```

## 3. Outcome-grounded risk

不能：

```text
Risk := Uncertainty
```

而應：

```text
Risk(a)
=
Σ_c P(consequence_c | rollout, state, action)
    · Severity(consequence_c)
```

world-model reliability 則作為：

```text
confidence modifier / evidence-quality term
```

例如：

```text
ExpectedDecisionLoss
=
ExpectedConsequenceLoss
+
λ_rel · ReliabilityPenalty
```

## 4. Dynamic horizon

```text
H_{t+1}
=
f(
    current reliability,
    marginal planning gain,
    task risk,
    compute budget,
    observed calibration error
  )
```

因此 horizon 不再是固定：

```text
H = 32
```

而是 scene-specific / step-specific：

```text
simple scene → 2
occluded scene → 7
high-risk branching → 12
OOD high-uncertainty → reality anchor after 3
```

---

# Visual Simulation Idea

## Reliability Fusion × Dream Budget Control Room

Hermes Console 顯示同一條 rollout：

```text
Step       0    1    2    3    4    5
Seed U    .04  .06  .10  .21  .39  .61
Ensemble  .03  .05  .09  .18  .31  .58
RoundTrip .02  .02  .05  .11  .32  .44
OOD       .01  .02  .03  .08  .22  .40
Risk      .11  .13  .17  .42  .71  .88
```

下方同時畫：

```text
P(model failure)
P(task failure)
Marginal planning gain
Compute cost
Net marginal utility
```

例如 step 4：

```text
Model failure       .38
Task risk           .71
Planning gain       +.12
Compute cost        -.05
Reliability penalty -.16

Net Δutility        -.09

→ STOP DREAM
→ REQUEST REAL OBSERVATION
```

UI 允許切換：

```text
Fixed Horizon
Uncertainty Threshold
ELVIS Soft Truncation
RISE Sequential Gate
Outcome-Grounded Hybrid
```

直接看到 planning performance / compute / reality-anchor 次數如何改變。

### 更重要的互動：Reliability Diagram

選某一 signal：

```text
Predicted failure probability
vs
Observed rollout failure frequency
```

讓使用者直觀看到：

```text
raw ensemble disagreement ≠ calibrated probability
```

---

# Code / GitHub

## COOWAI/RISE

Repository: https://github.com/COOWAI/RISE

值得深入閱讀的目錄與核心檔案：

```text
app/vjepa_cowa_world_model/
├ evaluation/
│  ├ cvoi_direct_epdms.py
│  ├ cvoi_navsim_identity.py
│  ├ action_conditioned_latents.py
│  └ navsim_agent.py
├ training/
│  ├ sequential_budget_control.py       ★
│  ├ sequential_gate_training.py        ★
│  ├ cvoi_gate_pipeline.py              ★
│  ├ cvoi_manual_navtrain_oracle.py
│  ├ cvoi_value.py
│  └ cvoi_formal_v2_navsim_e120_runtime.py
└ losses/
   ├ reward_selector.py
   └ ppo_loss.py
```

### 原始碼確認的關鍵工程細節

`compute_cvoi_targets()`：

```text
task_scores
+ compute_costs
+ lambda_compute
↓
utility curve
↓
best future utility
↓
delta utility
↓
continue_target = delta > 0
```

`SequentialRolloutGate`：

```text
state features
↓
MLP
↓
benefit, slope
↓
benefit - softplus(slope) * lambda_compute
↓
predicted marginal utility
```

`sequential_gate_loss()`：

```text
sign classification
+
Smooth-L1 marginal-utility regression
```

而且 classification sample weight 隨 `|target_delta|` 增加，代表「做錯一個 high-regret roll/stop decision」比 marginal case 更重要。

這一點很值得 Hermes 直接借鑑。

---

# Papers

## 1. RISE: Adaptive Imagination for World Action Models
- Authors: Hongbo Lu et al.
- Year: 2026
- URL: https://arxiv.org/abs/2608.20430
- Code: https://github.com/COOWAI/RISE
- Dataset: CounterDrive, NAVSIM, nuScenes
- Architecture: WAM + latent evaluator + sequential rollout gate
- Contribution: scene-/step-adaptive Roll/Stop imagination
- Limitation: task/domain transfer and calibration under distribution shift remain open
- 改變了什麼：把 imagination budget 從 fixed hyperparameter 變成 learned sequential control problem。

## 2. Learning to Be Uncertain: Pre-training World Models with Horizon-Calibrated Uncertainty
- Authors: Shenghua Wan, Le Gan, De-Chuan Zhan
- Venue: ICLR 2026
- URL: https://proceedings.iclr.cc/paper_files/paper/2026/hash/ad222e6e38e26e3f00d85829b9e02f43-Abstract-Conference.html
- Architecture: probabilistic ensemble + HCU loss
- Contribution: training-time horizon-calibrated uncertainty
- Limitation: reliability calibration does not imply task-risk calibration
- 改變了什麼：不再把 horizon uncertainty 當 post-hoc heuristic，而是變成 world-model representation learning objective。

## 3. ELVIS: Ensemble-Calibrated Latent Imagination for Long-Horizon Visual MPC
- Authors: Yurui Du, Pinhao Song, Yutong Hu, Renaud Detry
- Institution: KU Leuven / Flanders Make
- Venue: RSS 2026
- URL: https://arxiv.org/abs/2605.04709
- Code: https://github.com/RILEY-REEDUS/ELVIS
- Architecture: RSSM + GMM-MPPI + critic ensemble + uncertainty-adaptive λ-return
- Contribution: soft truncation of unreliable deep imagination
- Limitation: critic uncertainty remains an internal proxy
- 改變了什麼：把 imagination trust 從 fixed λ 變成 state-dependent dynamic trust allocation。

## 4. Learning from World Feedback: Why Model Uncertainty Fails as a Risk Signal in Model-Based RL
- Author: Zhaohui Wang
- Venue: RLxF @ ICML 2026
- URL: https://arxiv.org/abs/2607.16591
- Architecture: MBRL/MPC + uncertainty proxy vs world/outcome risk signals
- Contribution: empirical separation of model uncertainty and safety risk
- Limitation: specific experimental domain; not evidence that uncertainty is useless for reliability estimation
- 改變了什麼：迫使 reliability layer 與 consequence-risk layer 分離。

## 5. Current Agents Fail to Leverage World Model as Tool for Foresight
- Authors: Cheng Qian et al.
- Venue: ACL 2026
- URL: https://aclanthology.org/2026.acl-long.623/
- Contribution: world-model availability alone does not yield better agents; failure often lies in when-to-simulate / how-to-use / how-to-integrate predictions
- Limitation: evaluates current agents rather than giving a complete reliability controller
- 改變了什麼：world-model integration 被重新定義成 meta-control problem，而非單純 tool availability。

---

# 已確認事實 / 工程實作 / 合理推論 / 尚未驗證假說

## 已確認事實 / 官方或論文結果
- RISE 明確提出 sequential Roll/Stop imagination policy。
- RISE 公開 code 直接計算 marginal future utility target 並訓練 sequential rollout gate。
- HAUWM 明確以 horizon-calibrated uncertainty 作為 training objective。
- ELVIS 使用 ensemble uncertainty 動態調整 λ-return，降低遠期 imagination 的依賴。
- RLxF world-feedback 工作顯示 dynamics uncertainty 與 task collision risk 可顯著錯位。

## 工程實作
- RISE `SequentialRolloutGate` 對 `lambda_compute` 使用 `-softplus(slope)*lambda` 的單調約束。
- `sequential_gate_loss()` 同時做 sign classification 與 utility regression。
- `compute_cvoi_targets()` 用完整 horizon utility curve產生 online continuation label。

## 合理推論
- Hermes 最適合的 controller 應同時包含 soft trust modulation + hard stop/reality-anchor gate。
- world model reliability 與 task risk 應存成兩個 graph，再於 decision layer融合。
- prediction→reality feedback 可作為 online calibration data stream。

## 尚未驗證假說
- 一個統一的 ReliabilityFusionCalibrator 能否跨 latent/video/LLM world models transfer。
- calibration profile 是否能跨任務共享，或必須細分到 `(model × domain × horizon × action family)`。
- outcome-grounded risk head 是否會被 planner 反向 exploit，形成新的 Goodhart failure。

---

# Unknown / Open Questions

## 1. Reliability fusion 是否應該輸出一個 scalar？

可能更安全的是保留：

```text
P(representation failure)
P(action-conditioning failure)
P(long-horizon drift)
P(OOD)
```

而不是把所有 failure mode 壓成：

```text
reliability = 0.72
```

## 2. Calibration 的 ground truth 怎麼定義？

可能至少需要三層：

```text
state prediction error
trajectory decision error
task consequence error
```

三者不能互換。

## 3. STOP dream 後應該做什麼？

```text
STOP
├ answer now
├ choose conservative action
├ reality-anchor observation
├ invoke specialist model
├ branch alternative simulator
└ escalate human
```

因此 `DreamStoppingRule` 和 `PostStopPolicy` 應拆成兩個節點。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
ReliabilityVector
ReliabilitySignalFamily
ReliabilityFusionCalibrator
HorizonCalibration
PredictionFailureProbability
PredictionRealityCalibrationMemory
OutcomeGroundedRisk
TaskConsequenceRiskGraph
WorldModelReliabilityGraph
MarginalPlanningGain
MarginalComputeUtility
SequentialDreamController
SoftDreamTruncation
HardDreamStop
DreamBudget
DynamicImaginationHorizon
PostStopPolicy
RealityAnchorTrigger
CalibrationScope
CalibrationDrift
ReliabilityDiagram
DreamDecisionRegret
ComputePenaltyMonotonicity
```

## Edges

```text
Raw Uncertainty
≠ Calibrated Failure Probability

World Model Uncertainty
≠ Task Risk

Low Reliability
≠ Automatically High Consequence

High Task Risk
≠ High Model Uncertainty

Horizon
→ Should Condition Reliability Calibration

Prediction-Reality Outcome
→ Updates Reliability Calibration

Marginal Planning Gain
- Compute Cost
- Reliability Penalty
- Consequence Risk
→ Dream Continue Utility

Soft Truncation
→ Reduces Authority Of Distant Imagination

Hard Stop
→ Terminates Imagination

Hard Stop
→ Requires PostStopPolicy

Reality Anchor
→ Produces Calibration Evidence

Fixed Horizon
≠ Optimal Per-Scene Imagination Budget

More Simulation
≠ Better Decision
```

---

# 下一輪研究

下一輪應進入：

# **Planner Exploitation × Model Gaming × Adversarial Rollout Search × Safe Optimization Against Imperfect World Models**

因為一旦 Hermes 擁有：

```text
World Model
↓
Reliability Calibrator
↓
Dynamic Dream Controller
↓
Planner
```

下一個最危險的問題就是：

> Planner 是否會主動搜尋 world model 的 blind spot，找到「在模型裡分數很高、在現實裡其實失敗」的 trajectory？

下一輪應研究：

```text
model exploitation
planner overoptimization
Goodhart under learned simulators
uncertainty-aware MPC
pessimistic planning
robust MBRL
adversarial model error
constraint critics
safe fallback policies
shielding
```

預計新增：

```text
ModelExploitationDetector
PlannerWorldModelGap
AdversarialRolloutProbe
PessimisticPlanningBound
RobustTrajectoryScore
SimulatorGamingEvent
SafetyShield
FallbackPolicy
```

---

# 每輪結束檢查

**缺哪一層：** `Planner Exploitation / Safe Optimization Against Imperfect World Model Layer`。  
**哪個節點最淺：** `ReliabilityFusionCalibrator`、`OutcomeGroundedRisk`、`PostStopPolicy`、`CalibrationDrift`。  
**哪個概念仍只是名詞：** production 級 `Decision-Calibrated Rollout Reliability`；目前沒有證據支持一個跨 domain 通用 scalar。  
**哪個系統值得讀原始碼：** `COOWAI/RISE`，優先 `sequential_budget_control.py → sequential_gate_training.py → cvoi_gate_pipeline.py → cvoi_direct_epdms.py`；第二順位 `RILEY-REEDUS/ELVIS`。  
**哪篇論文需追引用：** RISE 與 HAUWM；安全方向優先追 `Learning from World Feedback`。  
**哪個概念最適合視覺模擬：** `Reliability Fusion × Dream Budget Control Room`。  
**哪個 Agent 架構最值得實作：** `Outcome-Grounded Adaptive Dream Controller`。

---

# 本輪對「AI 到底怎麼運作」新增的核心

真正成熟的 world-model Agent 不應該只是「一直想像到固定 16/32/64 步」，也不能只用一條 uncertainty threshold 決定要不要停止。每一步 imagination 都應被視為一個需要付成本、可能帶來資訊與規劃增益、也可能累積模型誤差的 sequential decision。

因此完整鏈路應變成：

```text
Reality
↓
Grounded State
↓
World Model
↓
Dream Step
↓
Reliability Vector
↓
Calibrated Prediction-Failure Estimate
        +
Outcome-Grounded Task Risk
        +
Marginal Planning Gain
        +
Compute Cost
↓
ROLL / SOFT-TRUNCATE / STOP / REALITY-ANCHOR
↓
Planner
↓
Real Action
↓
Actual Outcome
↓
Prediction-Reality Calibration Update
```

這一輪真正補上的不是「更好的 uncertainty score」，而是把 **想像多久、信多少、何時醒來、醒來後怎麼用現實校準下一次想像** 接成一個可學習、可驗證、可視覺化的閉環。