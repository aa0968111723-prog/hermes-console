# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 07:53 Asia/Taipei**  
**本輪主題：Model Misspecification × Residual Diagnostics × Reality Gap × Out-of-Model Cause Discovery**

## 與歷史研究比較

上一輪已建立：

```text
Unknown θ
→ Observability / Identifiability
→ Fisher Geometry
→ Weak Direction
→ Safe Active Experiment
→ Posterior Calibration
```

但即使 FIM full-rank、condition number 良好、posterior 很窄，仍然可能發生：

```text
真正世界：mass + friction + compliance + backlash
模型：     mass + friction
```

此時 estimator 會把缺失的 compliance / backlash 錯誤吸收到 mass / friction，形成：

```text
precise posterior
+
wrong model class
=
confidently wrong agent
```

因此本輪不再重複「如何提高 identifiability」，而專門回答：

1. 如何知道 residual 只是 measurement/process noise，還是 model class 本身錯了？
2. 如何把 residual 的時間、狀態、action、modality 結構轉成 missing-cause hypothesis？
3. 如何避免 model-discrepancy function 與 physical parameter 互相 confound？
4. Active experiment 在 misspecified model 下為何可能越量越偏？
5. Agent 如何從單模型 posterior 升級成 model-class posterior / discrepancy-aware runtime？

核心新鏈：

```text
Prediction
→ Observation
→ Residual
→ Residual Structure Diagnostics
→ Misspecification Hypothesis
→ Missing Cause Candidates
→ Alternative Model Classes
→ Discriminating Experiment
→ Model Posterior
→ Parameter Re-identification
→ Runtime Gate
```

---

# 本小時新發現

## 1. Bayesian Experimental Design for Model Discrepancy Calibration: An Auto-Differentiable Ensemble Kalman Inversion Approach
- **Authors:** Huchen Yang, Xinghao Dong, Jin-Long Wu
- **Institution:** University of Wisconsin–Madison ecosystem
- **Journal:** Journal of Computational Physics, Volume 545, Article 114469
- **Publication date:** 2026-01-15
- **DOI:** https://doi.org/10.1016/j.jcp.2025.114469
- **arXiv:** https://arxiv.org/abs/2504.20319
- **Architecture:** low-dimensional physical parameters handled with standard Bayesian experimental design; high-dimensional discrepancy parameters handled with auto-differentiable Ensemble Kalman Inversion (AD-EKI); design optimization is outer-loop differentiable.
- **Contribution:** 不再假設 simulator model 完整；把 physical parameter inference 與 high-dimensional model discrepancy calibration 分離。
- **Limitation:** discrepancy representation 本身仍需選定；若 discrepancy model 太自由，可能與 physical parameters confound。

## 2. Active Learning of Model Discrepancy with Bayesian Experimental Design
- **Authors:** Huchen Yang, Chuanqi Chen, Jin-Long Wu
- **Year:** 2025
- **Paper:** https://arxiv.org/abs/2502.05372
- **DOI:** https://doi.org/10.1016/j.cma.2025.118198
- **Architecture:** sequential BED → collect data → learn discrepancy → update design → repeat.
- **Contribution:** 顯示 model discrepancy 不只是 inference 後的補丁；它可以直接參與「下一筆資料去哪裡收」的 active loop。
- **Limitation:** numerical convection-diffusion examples 與 embodied multi-contact Agent 仍有巨大距離。

## 3. Detecting Model Misspecification in Bayesian Inverse Problems via Variational Gradient Descent
- **Authors:** Qingyang Liu, Matthew A. Fisher, Zheyang Shen, Katy Tant, Xuebin Zhao, Andrew Curtis, Chris J. Oates
- **Year:** 2025/2026 research cycle
- **Paper:** https://arxiv.org/abs/2512.01667
- **Core idea:** compare a standard Bayesian posterior with a Predictively Oriented mixture distribution Q. 在 well-specified model 下，Q 應傾向 concentration；misspecified setting 下則不一定，兩者差異可作為 model-misspecification diagnostic。
- **Contribution:** 把「模型可能錯」本身做成可計算 diagnostic，而不是只靠 residual plot 人工猜。
- **Limitation:** inverse-problem demonstrations；如何映射到 hybrid/contact-rich Agent runtime 尚需工程化。

## 4. Representative, Informative, and De-Amplifying: Requirements for Robust Bayesian Active Learning under Model Misspecification
- **Authors:** Roubing Tang, Sabina J. Sloman, Samuel Kaski
- **Venue:** AISTATS 2026, PMLR 300
- **URL:** https://proceedings.mlr.press/v300/tang26d.html
- **Contribution:** active design 不能只追 informativeness；misspecification 下，train-design distribution 和實際 test distribution 的 covariate shift 可能放大錯誤，因此 design 還要兼顧 representativeness 與 de-amplification。
- **Why important:** Hermes 上一輪使用 EIG/Fisher 選 probe；本輪證明 `max information` 本身不是 robust objective。

## 5. Model-free Anomaly Detection for Dynamical Systems with Gaussian Processes
- **Authors:** Alejandro Penacho Riveiros, Nicola Bastianello, Matthieu Barreau
- **Year:** 2026
- **Paper:** https://arxiv.org/abs/2604.11629
- **Architecture:** nominal dynamical trajectories → GP dynamics model → predictive uncertainty → online residual compatibility test → false-positive-controlled anomaly decision.
- **Contribution:** residual 大不一定就是 model error；必須拿 residual 和 predictive/process/measurement uncertainty 一起標準化。
- **Limitation:** anomaly detection ≠ automatic missing-cause identification；它主要回答「不相容」，還沒有回答「缺的是 friction 還是 contact mode」。

## 6. DexNDM: Closing the Reality Gap for Dexterous In-Hand Rotation via Joint-Wise Neural Dynamics Model
- **Authors:** Xueyi Liu, He Wang, Li Yi
- **Affiliations:** Tsinghua University / Peking University / Shanghai Qi Zhi Institute / Galbot
- **Venue:** ICLR 2026
- **Paper:** https://arxiv.org/abs/2510.08556
- **Project:** https://meowuu7.github.io/DexNDM/
- **Contribution:** 將 contact-rich dexterous sim-to-real discrepancy 交給 joint-wise neural dynamics model，並將 system-wide influence 壓縮成 low-dimensional variables，再修正 sim policy action。
- **Why important:** 提供一種 reality-gap correction architecture：不是把所有 discrepancy 都強塞回 simulator physical parameters，而是學一個 residual/adaptation dynamics layer。

## 7. Dynestyx: A Probabilistic Programming Library for Dynamical Systems
- **Authors:** Daniel Waxman et al.
- **Year:** 2026
- **Paper:** https://arxiv.org/abs/2606.16985
- **Code:** https://github.com/BasisResearch/dynestyx
- **Contribution:** state-space models 作為 first-class probabilistic objects，統一 state/parameter inference API。
- **Why important:** Hermes 的 misspecification runtime 最後需要 model class、latent state、parameters 與 posterior predictive checks 共存；Dynestyx 的模型/推論分離值得作 runtime 參考。

---

# 本小時最重要 5 個發現

## 發現 1 — Narrow Posterior ≠ Correct World Model

### 底層

設真實系統：

```text
y_t = f_real(x_t,u_t) + ε_t
```

Agent 的 simulator：

```text
ŷ_t = f_model(x_t,u_t,θ)
```

若 model class 缺少 mechanism：

```text
f_real = f_model + δ(x,u,t)
```

則 calibration 會嘗試找：

```text
θ* = argmin residual
```

但 θ* 可能只是 pseudo-true parameter，而不是實際物理參數。

Residual：

```text
r_t = y_t - ŷ_t
```

真正應拆成：

```text
r_t
=
measurement noise
+ process noise
+ discretization error
+ parameter error
+ model discrepancy
+ unobserved disturbance
```

如果 Hermes 只有 parameter posterior，它會把後四項錯誤互相混掉。

### 為什麼重要

前一輪的 Fisher / EIG 只在**選定 model class 內**有效。

因此新增核心否定關係：

```text
Identifiable Parameters
≠ Correct Model Class

Small Posterior Variance
≠ Small Model Bias

High FIM
≠ Reality Validity
```

### 來源
- Yang et al., JCP 2026: model discrepancy calibration
- Brynjarsdóttir & O'Hagan, 2014: model discrepancy can bias calibration if ignored

### 狀態
**已確認理論；Agent runtime mapping 為工程推論。**

---

## 發現 2 — Residual 不是一個 scalar error，而是一個可做 causal hypothesis generation 的 structure

單純：

```text
RMSE = 0.12
```

幾乎沒有 diagnostic power。

Hermes 應建立 Residual Tensor：

```text
ResidualRecord
├ timestamp
├ state_region
├ action_type
├ tool/contact mode
├ modality
├ entity_id
├ predicted_mean
├ predicted_covariance
├ observed_value
├ standardized_residual
├ model_epoch
├ sensor_epoch
└ evidence_roots
```

接著跑：

```text
Residual
├ mean bias
├ variance inflation
├ autocorrelation
├ cross-correlation
├ residual × state
├ residual × action
├ residual × contact mode
├ residual × modality
├ residual × time
└ residual × model version
```

典型 pattern：

```text
residual correlates with velocity
→ missing damping / friction hypothesis

residual spikes only at contact transitions
→ missing hybrid contact-mode hypothesis

residual biased only at high torque
→ actuator saturation / torque calibration hypothesis

vision residual normal
force residual abnormal
→ sensor/contact model mismatch hypothesis

autocorrelated residual
→ missing dynamics / latent state hypothesis
```

這不是「證明原因」，但能把 residual 從 failure metric 變成 missing-cause proposal engine。

### 來源
- GP dynamical anomaly detection 2026：predictive uncertainty + residual compatibility
- model-error review 2026：model error 可來自 unmodeled physics、idealization、numerical approximation

### 狀態
**來源確認；pattern-to-cause mapping 屬工程假說，需 discriminating experiment 驗證。**

---

## 發現 3 — Model discrepancy 與 physical parameter 有 confounding，不能無限制加一個 neural residual 就算解決

如果直接寫：

```text
y = f(x,u,θ) + δφ(x,u)
```

且 δφ 是非常強的 neural network，則可能：

```text
θ 錯很多
δφ 全部補掉
```

最後 prediction 很準，但 physical parameter 完全失真。

反過來若禁止 discrepancy：

```text
δ = 0
```

則 simulator 缺失機制又會被硬塞進 θ。

因此 Hermes 應保存兩層 uncertainty：

```text
Physical Parameter Belief p(θ)
+
Model Discrepancy Belief p(δ)
```

並加：

```text
DiscrepancyRegularization
StructuralPrior
LocalityPrior
SmoothnessPrior
CausalSupport
Cross-regime validation
```

重要原則：

```text
Better Predictive Fit
≠ Better Physical Identification
```

JCP 2026 的 AD-EKI framework 正是將 low-dimensional physics parameters 與 high-dimensional discrepancy parameters 分開處理，而不是全部塞在一個 posterior 中。

### 狀態
**論文確認。**

---

## 發現 4 — Active Experiment 在 misspecified model 下可能主動放大錯誤

上一輪我們寫：

```text
probe* = argmax EIG
```

但 EIG 是根據當前 predictive model 計算：

```text
p(y | θ, probe, M)
```

如果 M 錯，則 Agent 可能一直挑「在錯模型裡最有資訊」的 probe。

新的 robust design objective 應至少考慮：

```text
U(probe)
=
InformationGain(parameter)
+ InformationGain(model-class)
+ Representativeness
- MisspecificationAmplification
- SafetyRisk
- TerminalRisk
```

AISTATS 2026 的 robust Bayesian active learning 指出，misspecification + active acquisition 導致的 covariate shift 可以放大 generalization error；因此 informativeness、representativeness、de-amplifying 都必須一起考慮。

這對 Hermes 很重要：

```text
Probe for parameter identification
≠ Probe for model discrimination
```

前者問：

```text
mass 是 300g 還是 400g？
```

後者問：

```text
這真的是 rigid-body + Coulomb friction 嗎？
還是存在 compliance / stiction / backlash？
```

### 狀態
**論文結果 + runtime engineering design。**

---

## 發現 5 — Misspecification Runtime 應從 single-model estimator 升級成 Model-Class Competition

Hermes 不應只有：

```text
Model M
→ θ posterior
```

而應：

```text
M1 rigid friction
M2 friction + compliance
M3 friction + backlash
M4 neural residual hybrid
M5 unknown/unmodeled
```

每個 model 有：

```text
ModelHypothesis
├ model_id
├ structural_assumptions
├ latent_states[]
├ parameters[]
├ discrepancy_model?
├ predictive_score
├ residual_signature
├ posterior_weight
├ falsification_tests[]
└ evidence_roots[]
```

然後：

```text
Observation
↓
Posterior Predictive Check
↓
Residual Diagnostics
↓
Model Score Update
↓
Discriminating Probe
↓
Observation
↓
Model Posterior Update
```

這讓 System Identification 從：

```text
「哪個 θ 最好？」
```

升級成：

```text
「哪個 dynamics hypothesis 最能解釋世界？」
```

---

# Architecture Breakdown

## Misspecification-Aware Agent Runtime

```text
Sensors / Camera / Tool / Runtime Telemetry
↓
Belief State Estimator
↓
Model Bank
├ M1 nominal physics
├ M2 alternate contact model
├ M3 alternate actuator model
├ M4 hybrid physics + residual
└ M_unknown
↓
Posterior Predictive Generator
↓
Observation
↓
Residual Bus
↓
Residual Diagnostic Engine
├ standardization by uncertainty
├ autocorrelation / whiteness
├ state-conditioned residual
├ action-conditioned residual
├ mode-conditioned residual
├ modality-conditioned residual
└ change-point / epoch analysis
↓
Misspecification Detector
↓
Missing Cause Hypothesis Generator
↓
Alternative Model Builder / Selector
↓
Discriminating Experiment Designer
↓
Safety / Permission / Terminal Gate
↓
Execute
↓
Model Posterior Update
↓
Parameter Re-identification
↓
Planner / Agent Runtime
↺
```

## Model Error Decomposition Plane

```text
Observed error
├ Sensor / Measurement Noise
├ Process Noise
├ Numerical / Solver Error
├ Parameter Error
├ Representation Error
├ Model Discrepancy
├ External Disturbance
└ Distribution / Regime Shift
```

Hermes 不應把它們全部放在 `error` 一欄。

---

# Bottom-Level Logic

## 1. Standardized innovation / residual

```text
r_t = y_t - E[y_t | history, M]
```

若 predictive covariance 為 Σ_t：

```text
z_t = Σ_t^(-1/2) r_t
```

只有把 residual 按預測不確定度標準化後，才能區分：

```text
large raw residual + huge uncertainty
```

與：

```text
small raw residual + tiny uncertainty
```

哪個其實更異常。

## 2. Whiteness test intuition

若 model 捕捉了 dynamics，ideal innovation 應接近：

```text
E[z_t] ≈ 0
Corr(z_t, z_{t-k}) ≈ 0
```

持續 autocorrelation 意味：

```text
過去 residual 能預測未來 residual
```

這通常暗示尚未建模的 state/dynamics/regime。

但：

```text
non-white residual
≠ 唯一證明 model misspecification
```

也可能是 noise model 錯、sensor filtering 或 clock misalignment。

## 3. State-conditioned discrepancy

學習：

```text
δ(x,u,m) = E[r | x,u,mode=m]
```

若 discrepancy 只集中在特定區域：

```text
high velocity
contact onset
near joint limit
high temperature
long context
specific tool
```

則可生成更具體 missing-mechanism hypotheses。

## 4. Model-class posterior

```text
p(M_i | D)
∝
p(D | M_i) p(M_i)
```

實際 runtime 不一定需要 exact Bayesian evidence；也可以用：

```text
predictive log score
WAIC / LOO-like score
held-out rollout error
calibration score
residual whiteness score
constraint violations
```

組成近似 evidence ledger。

## 5. Discriminating experiment

參數 EIG：

```text
I(θ ; Y | u,M)
```

model discrimination 則更接近：

```text
I(M ; Y | u)
```

因此 Hermes 下一代 experiment designer 應同時有：

```text
ParameterProbe
ModelDiscriminationProbe
SafetyProbe
```

---

# Code / GitHub

## BasisResearch/dynestyx

**Repo:** https://github.com/BasisResearch/dynestyx

本輪直接檢查 repository，而非只讀 README。root 已確認包含：

```text
dynestyx/
docs/
scripts/
tests/
```

而 `dynestyx/` 內已確認有：

```text
api.py
control/
diagnostics/
discretization/
evaluation/
handlers.py
inference/
models/
observation_missingness.py
simulation/
solvers/
types.py
```

這個結構對 Hermes 很有參考價值，因為它明確把：

```text
Model Definition
Inference
Simulation
Evaluation
Diagnostics
Control
```

分層，而不是把 dynamics model 與 estimator 綁死。

尤其值得注意：目前 `dynestyx/diagnostics/` 公開內容仍很薄，主要只有 plotting utility；這表示「state-space inference infrastructure 已成熟，但 model misspecification diagnostics 尚未成為同等 first-class subsystem」。

### Hermes 值得借鏡的目錄切法

```text
research-runtime/
├ models/
├ inference/
├ simulation/
├ diagnostics/
│  ├ residuals/
│  ├ calibration/
│  ├ misspecification/
│  └ model-comparison/
├ experiment_design/
└ control/
```

### 下一步值得繼續讀

```text
dynestyx/api.py
dynestyx/handlers.py
dynestyx/inference/
dynestyx/models/
dynestyx/evaluation/
```

---

# Papers

## Priority A

### Bayesian Experimental Design for Model Discrepancy Calibration
- Huchen Yang, Xinghao Dong, Jin-Long Wu
- JCP 2026
- https://doi.org/10.1016/j.jcp.2025.114469
- 必追：AD-EKI 如何在 high-dimensional discrepancy parameter 上近似 utility；physics parameters 與 discrepancy network 如何交替更新。

### Representative, Informative, and De-Amplifying
- Roubing Tang, Sabina J. Sloman, Samuel Kaski
- AISTATS 2026
- https://proceedings.mlr.press/v300/tang26d.html
- 必追：misspecification 下 active acquisition 如何造成 covariate-shift amplification。

### Detecting Model Misspecification in Bayesian Inverse Problems via Variational Gradient Descent
- Qingyang Liu et al.
- https://arxiv.org/abs/2512.01667
- 必追：Bayesian posterior vs Predictively Oriented mixture Q 的可計算 misspecification diagnostic。

## Priority B

### Active Learning of Model Discrepancy with Bayesian Experimental Design
- Huchen Yang, Chuanqi Chen, Jin-Long Wu
- https://arxiv.org/abs/2502.05372

### Model-free Anomaly Detection for Dynamical Systems with Gaussian Processes
- Alejandro Penacho Riveiros, Nicola Bastianello, Matthieu Barreau
- https://arxiv.org/abs/2604.11629

### DexNDM
- Xueyi Liu, He Wang, Li Yi
- ICLR 2026
- https://arxiv.org/abs/2510.08556

---

# Visual Simulation Idea

## Reality Gap & Model Misspecification Lab

畫面左側：**REAL WORLD TRACE**

```text
position ─────────╮____
velocity ──────╮_______
force    ___╭██╯_______
contact  ____ON_________
```

中央：**MODEL PREDICTIONS**

```text
M1 rigid+friction
M2 + compliance
M3 + backlash
M4 hybrid residual
```

下方：**RESIDUAL STRUCTURE**

```text
Residual vs Time
Residual vs Velocity
Residual vs Force
Residual vs Contact Mode
Residual ACF
Cross-modal residual
```

右側顯示：

```text
MODEL POSTERIOR
M1  0.08
M2  0.57
M3  0.11
M4  0.24
```

點擊一個 residual pattern：

```text
Residual spike at CONTACT_ON
```

系統顯示：

```text
Candidate Missing Causes
1. compliance           .71
2. impact damping       .62
3. timestamp misalign   .31
4. force sensor bias    .18
```

接著 Agent 提出 discriminating experiment：

```text
Slow approach contact
vs
Fast approach contact
```

並預估：

```text
Expected Model Information Gain
M2 vs M3 separation: 0.74
Risk: 0.08
Terminal risk: 0.02
```

執行後模型 posterior 即時改變。

這個 simulator 可以第一次把：

```text
「模型錯」
```

從一句抽象警告變成可觀察、可檢驗、可主動修正的 Agent runtime process。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Model Misspecification
Reality Gap
Model Discrepancy
Residual Record
Standardized Residual
Innovation
Residual Autocorrelation
Residual Whiteness
State-Conditioned Residual
Action-Conditioned Residual
Mode-Conditioned Residual
Cross-Modal Residual
Noise Model Mismatch
Process Model Mismatch
Missing Mechanism Hypothesis
Model Hypothesis
Model Bank
Model Posterior
Model Evidence Ledger
Discrepancy Function
Residual Dynamics Model
Hybrid Physics Residual Model
Model Discrimination Probe
Misspecification Amplification
Representativeness Objective
De-Amplification Objective
Predictively Oriented Posterior
Reality Validity Gate
```

## Positive Relations

```text
Model
--PREDICTS→ Observation

Observation
--GENERATES_WITH_MODEL→ Residual

ResidualPattern
--SUPPORTS_HYPOTHESIS→ MissingMechanism

MissingMechanism
--MOTIVATES→ AlternativeModel

AlternativeModel
--COMPETES_WITH→ CurrentModel

ProbeAction
--DISCRIMINATES_BETWEEN→ ModelHypotheses

ModelPosterior
--GATES→ Planner
```

## Negative / Distinction Edges

```text
Parameter Uncertainty ≠ Model Uncertainty
Measurement Noise ≠ Model Discrepancy
Large Residual ≠ Model Misspecification
Small Residual ≠ Correct Model
Narrow Posterior ≠ Correct Physics
High FIM ≠ Reality Validity
Predictive Accuracy ≠ Physical Parameter Accuracy
Neural Residual ≠ Causal Explanation
Anomaly Detection ≠ Missing-Cause Identification
Parameter Probe ≠ Model-Discrimination Probe
More Informative ≠ More Representative
Model Fit ≠ Model Truth
```

---

# Unknown / Open Questions

## 1. 如何避免 discrepancy model 吸收真正 physical parameter？

需要研究：

```text
orthogonality constraint
physics-informed discrepancy basis
causal regularization
cross-regime validation
intervention-based separation
```

## 2. Residual pattern → Missing cause 能否自動化？

目前最合理做法可能是：

```text
Residual features
→ hypothesis library / KG
→ candidate mechanisms
→ discriminating experiment
```

但尚不能把 correlation 直接當原因。

## 3. Multimodal Agent 如何區分 model error 與 representation/sensor error？

例如 VLM object pose error 可能看起來像 simulator error，因此需要：

```text
Perception Model Posterior
Physical Model Posterior
Sensor Model Posterior
Runtime Model Posterior
```

而不是單一 model-confidence。

---

# 下一輪研究

下一個最深缺口：

# **Model-Class Discovery × Equation Discovery × Mechanism Induction × Symbolic/Neural Hybrid Dynamics**

因為本輪仍假設：

```text
Alternative model candidates
```

已經有人先定義好。

但真正更強的 Agent 必須能從 residual 進一步問：

```text
我是不是少了一個 state？
是不是少了一個 interaction edge？
是不是 dynamics equation 本身形式錯？
是否存在新的 contact mode？
```

下一輪應研究：

```text
Residual
↓
Candidate Latent Variable
↓
Candidate Interaction / Term Library
↓
Sparse Equation Discovery / SINDy
↓
Neural ODE / Hybrid Dynamics Candidate
↓
Symbolic Regression
↓
Model Selection
↓
Intervention / Discriminating Experiment
↓
Mechanism Certificate
```

優先追：
- SINDy / PySINDy 的 model selection 與 weak formulation
- causal equation discovery
- hybrid dynamical system / switching dynamics discovery
- neural residual → symbolic distillation
- object-centric causal world models
- model structure uncertainty under active experiment design

---

# 本輪結束回答

**缺哪一層：** 自動 `Model-Class / Mechanism Discovery`。目前已能偵測 current model 不夠，但尚未完整解決「缺的是哪條方程或哪個 latent state」。

**哪個節點最淺：** `Residual Pattern → Missing Mechanism Hypothesis` 的 calibrated mapping。

**哪個概念仍只是名詞：** Universal `RealityValidityCertificate`、`ModelEvidenceLedger ABI`、跨模態 `Misspecification Attribution`。

**哪個系統值得讀原始碼：** `BasisResearch/dynestyx` 的 `api.py / handlers.py / inference/ / models/ / evaluation/`；另外下一輪應回到 PySINDy 深挖 equation discovery pipeline。

**哪篇論文需追引用：** JCP 2026 `Bayesian Experimental Design for Model Discrepancy Calibration`、AISTATS 2026 `Representative, Informative, and De-Amplifying`、`Detecting Model Misspecification...`。

**哪個概念最適合視覺模擬：** `Reality Gap & Model Misspecification Lab`。

**哪個 Agent 架構最值得實作：**

> **Misspecification-Aware Active Agent Runtime = Model Bank + Posterior Predictive Checks + Residual Diagnostic Bus + Missing-Cause Hypothesis Engine + Discrepancy Model + Model-Discrimination Experiment Designer + Safety Gate + Model Posterior + Reality Validity Gate**

---

## 本輪最核心推進

上一輪回答的是：

> 「在我相信的模型裡，哪些參數其實量不出來？」

本輪再往下一層回答：

> **「如果我相信的模型本身就是錯的呢？」**

成熟 AI Agent 不能只會降低 parameter uncertainty。它還必須持續檢查 prediction error 是否具備結構、判斷錯誤來自 sensor/noise/parameter 還是 missing physics，主動提出 competing model hypotheses，再設計能區分模型的安全 experiment。只有這樣，System Identification 才不會退化成「在錯誤世界觀裡越量越有自信」。