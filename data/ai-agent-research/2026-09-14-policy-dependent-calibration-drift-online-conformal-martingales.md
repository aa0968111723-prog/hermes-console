# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 10:53（Asia/Taipei）**  
**本輪主題：Policy-Dependent Calibration Drift × Weighted Conformal Martingales × Online Recalibration × Evidence Certificate Migration**

---

## 0. 與歷史研究的差異

前幾輪已建立：

1. neural confidence ≠ statistical evidence；
2. marginal conformal validity ≠ sequential conditional e-validity；
3. evidence 需要 provenance / ancestry；
4. composite null 與 multimodal evidence fusion 必須處理 nuisance 與 dependence；
5. model / encoder 更新可能讓舊 calibration / causal certificates 失效。

本輪不再重複「如何把 score 轉成 p/e-value」，而追下一層問題：**Agent 的 policy、retrieval、tool routing、abstention、query selection、sensor activation 本身會改變下一輪資料分布，因此 calibration data 不是被動流入，而是 policy-shaped data。**

核心新問題：

```text
Policy π_t
→ selects what is observed
→ changes X_t / modality availability / label availability
→ changes calibration population
→ changes conformal score distribution
→ changes evidence validity
→ changes permission
→ changes next policy π_{t+1}
```

所以 production Agent 的 calibration runtime 必須處理一個 feedback loop，而不是只處理 exogenous distribution shift。

---

# 一、本小時新發現

## 新論文 / 新架構

### 1. WATCH: Adaptive Monitoring for AI Deployments via Weighted-Conformal Martingales
- **Authors:** Drew Prinster, Xing Han, Anqi Liu, Suchi Saria
- **Year:** 2025, ICML
- **URL:** https://proceedings.mlr.press/v267/prinster25a.html
- **Code:** https://github.com/aaronhan223/watch
- **Architecture:** weighted conformal test martingales (WCTM) + online adaptation + changepoint / harmful-shift diagnosis
- **Contribution:** 將 conformal test martingale 從「檢測 exchangeability/IID violation」推進到可在 mild covariate shift 下繼續適應、同時對 concept shift 或 out-of-support shift 發警報。
- **Limitations:** 仍需對 weighting / shift model 與可適應範圍做明確假設；不能把任何 policy-induced shift 都自動視為可安全 importance-weight correction。

### 2. Optimal training-conditional regret for online conformal prediction
- **Authors:** Jiadong Liang, Zhimei Ren, Yuxin Chen
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2602.16537
- **Architecture:** drift detection + adaptive calibration-set update；online-trained score 時依賴 algorithmic stability 而非單純 permutation symmetry
- **Contribution:** 對 abrupt changepoint / smooth drift 建立 training-conditional cumulative regret guarantees；顯示 online conformal 在模型持續更新時，「穩定性」可能比 exchangeability 更接近可用的底層條件。
- **Limitations:** 主要理論範圍仍是特定資料生成與 drift family，不能直接等價成 arbitrary agent feedback loop 保證。

### 3. Model-Agnostic Online Certificate-Driven Calibration for Time Series Forecasting Under Distribution Shift
- **Authors:** Chenfeng Huang, Zixuan Ma, George Michailidis
- **Year:** 2026, UAI
- **URL:** https://proceedings.mlr.press/v337/huang26b.html
- **Architecture:** online martingale PAC-Bayesian certificate + gated residual correction head + predict-then-update protocol
- **Contribution:** 把 certificate 本身放進 online calibration loop；certificate 包含 source risk anchor、posterior shift、target mismatch，並在 outcome 到達後才更新下一輪。
- **Limitations:** time-series forecasting setting 與 generic multimodal agent runtime 仍有距離；尤其 tool/query policy 會改變資料可見性與標記機制。

### 4. CAP: Calibration after Adaptive Pick
- **Authors:** Yajie Bao, Yuyang Huo, Haojie Ren, Changliang Zou
- **Year:** 2025, JMLR
- **URL:** https://www.jmlr.org/papers/v26/24-0452.html
- **Architecture:** adaptive selection → conditionally valid calibration set construction → conformal interval → online FCR control
- **Contribution:** 直接處理「先選樣本，再做 prediction」的 post-selection 問題。這對 Agent 很重要，因為 Agent 幾乎永遠在做 selection：只對某些事件詢問、某些工具驗證、某些 modality 開啟高成本分析。
- **Limitations:** selection-conditional coverage ≠ arbitrary adaptive agent-policy feedback validity。

### 5. Conformal Inference for Online Prediction with Arbitrary Distribution Shifts
- **Authors:** Isaac Gibbs, Emmanuel Candès
- **Year:** 2024, JMLR
- **URL:** https://www.jmlr.org/beta/papers/v25/22-1218.html
- **Architecture:** adaptive conformal inference + dynamic step-size adaptation
- **Contribution:** 讓 online conformal 對不同型態與速度的 distribution shift 更快反應，避免過度依賴久遠歷史 calibration data。
- **Limitations:** 對 agent-induced observation policy、missing-not-at-random modalities 與 tool-selection feedback 仍需要更上層建模。

---

# 二、本小時最重要 5 個發現

## 發現 1：Policy Drift 可以製造 Calibration Drift

### 概念

傳統 calibration 流程常畫成：

```text
World distribution shifts
↓
calibration scores shift
↓
recalibrate
```

但 Agent 真正的資料流是：

```text
World
↓
Agent policy π_t
├ decide which user to query
├ decide which sensor/modality to activate
├ decide which document to retrieve
├ decide which tool result to verify
├ decide when to abstain
└ decide which actions create labels/outcomes
↓
Observed stream D_t^π
↓
Calibration set
```

因此：

```text
Observed Calibration Distribution
=
Environment
×
Policy
×
Selection
×
Label Availability
```

### 底層如何運作

假設真實 world input 是 `X_t`，Agent 以 policy `π_t` 決定是否收集某 modality：

```text
S_t ~ π_t(S | H_{t-1}, X_t observed-so-far)
```

真正進 calibration 的資料是：

```text
X_t^obs = g(X_t, S_t)
```

若 policy 從：

```text
π_old: 所有 camera frames 都送 VLM
```

改成：

```text
π_new: 只有 confidence < .6 才送 VLM
```

即使 world 完全不變，VLM calibration stream 也會從 population distribution 變成 hard-case conditional distribution。

所以：

```text
No Environment Drift
≠
No Calibration Drift
```

### 為什麼重要

如果 Hermes 只監控 raw feature drift，會把 policy-induced drift 誤判為 model degradation；反過來也可能在 selection mechanism 改變後沿用舊 calibration certificate。

### 限制

僅知道 policy version 改變，仍不足以修正 shift；需要知道 selection probability、support、labeling mechanism 以及哪些 covariates 是 policy decision 前可見。

---

## 發現 2：Weighted Conformal Martingales 可以「適應 benign shift」，而不是遇到任何 shift 都報警

WATCH 的關鍵不是單純 changepoint detector，而是把 weighted conformal p-values / martingale monitoring 和可適應的 covariate shift 結合。

### 底層流程

```text
Calibration / reference data
↓
Density-ratio / weighting model
↓
Weighted conformal p-values
↓
Betting strategy
↓
Conformal test martingale
↓
wealth process
↓
Alarm / no alarm
```

其 deployment 意義是把 shift 分兩類：

```text
ADAPTABLE SHIFT
mild covariate shift
→ reweight / adapt
→ keep monitoring

HARMFUL / UNSUPPORTED SHIFT
concept shift or extreme support violation
→ martingale wealth grows
→ alarm
```

這比 Hermes 目前單純：

```text
shift detected → revoke everything
```

更合理。

### 核心原則

```text
Distribution Shift
≠
Certificate Failure Automatically
```

真正需要的是：

```text
Shift
↓
Is it covered by adaptation contract?
├ YES → reweight / recalibrate
└ NO  → quarantine / revoke
```

---

## 發現 3：Calibration Certificate 必須綁 Policy Epoch，而不只是 Model Epoch

前幾輪我們已經建立：

```text
Encoder update
→ may expire calibration certificate
```

本輪補上另一條同等重要的 dependency：

```text
Policy update
→ may expire calibration certificate
```

例如：

```text
Model: VLM-v8 (unchanged)
Calibrator: C-12 (unchanged)

π_old:
all screenshots evaluated

π_new:
only screenshots selected by text-agent suspicion score
```

模型沒換，但 calibration population 已變。

新增 runtime object：

```text
CalibrationPopulationContract
├ policy_epoch
├ selection_rule_hash
├ modality_activation_rule
├ label_observation_rule
├ source_population
├ target_population
├ density_ratio_model
├ support_region
├ calibration_window
├ drift_assumptions
└ validity_scope
```

Certificate 必須依賴：

```text
Predictor Version
+
Score Function Version
+
Calibration Snapshot
+
Policy Epoch
+
Selection Rule
+
Target Population
```

因此：

```text
Same Model Version
≠
Same Calibration Validity
```

---

## 發現 4：Online Recalibration 需要 Predict-Then-Update Boundary

2026 certificate-driven calibration 工作特別值得 Agent runtime 借用的一點，是嚴格：

```text
Past data
↓
predict / certify current round
↓
FREEZE
↓
current outcome arrives
↓
update state for next round
```

也就是：

```text
F_{t-1}
→ prediction / calibration / certificate at t
→ observe Y_t
→ F_t
```

不能：

```text
observe Y_t
→ secretly tune current calibration threshold
→ claim round-t certificate valid
```

這與前幾輪 `PreOutcomeEvidenceContract` 完全一致。

新增：

```text
CalibrationUpdateTransaction
├ prior_calibration_state
├ current_prediction_id
├ frozen_threshold
├ frozen_weight_model
├ observed_outcome
├ realized_nonconformity
├ drift_signal
├ next_calibration_state
└ effective_from_round
```

核心 edge：

```text
Outcome at t
→ may update calibration for t+1

Outcome at t
↛ retroactively validate threshold used at t
```

---

## 發現 5：Online-trained Nonconformity Model 需要追「Algorithmic Stability」，不能只追 Exchangeability

2026 Liang–Ren–Chen 的結果有一個對 Agent 很深的啟示：當 nonconformity score function 自己也在線上訓練時，傳統 permutation symmetry 不一定是最自然的基礎；其 full-conformal style approach 改以 fitting algorithm stability 支撐 nonstationary analysis。

Hermes 裡真正的 score 很可能來自：

```text
VLM anomaly head
Tool verifier
Retrieval consistency model
Memory conflict classifier
Safety critic
```

而這些都可能持續更新。

因此未來 certificate 不能只問：

```text
Calibration samples exchangeable?
```

還要問：

```text
If one training/calibration point changes,
how much can score function f_t change?
```

新增：

```text
ScoreModelStabilityContract
├ score_model_version
├ training_window
├ update_algorithm
├ replacement_stability
├ temporal_stability
├ parameter_drift
├ score_drift
└ guarantee_scope
```

核心新 edge：

```text
Online Model Update
≠ Automatic Loss of All Conformal Validity
```

但也：

```text
Stable Average Accuracy
≠ Stable Conformity Scores
```

---

# 三、Architecture Breakdown

本輪形成新的 Hermes **Policy-Aware Calibration Runtime**：

```text
UI / Camera / Voice / Video / DOM / Tool / MCP / Memory
↓
Raw Event Ledger
↓
Policy / Selection Ledger
├ policy_epoch
├ selection probabilities
├ modality activation
├ tool routing
├ abstention
└ label observation mechanism
↓
Predictor / Score Model
↓
Nonconformity Score
↓
Calibration Population Contract
↓
Shift Decomposer
├ environment covariate shift
├ concept shift
├ policy-induced covariate shift
├ selection shift
├ label-observation shift
└ out-of-support shift
↓
Adaptation Router
├ KEEP
├ IMPORTANCE_REWEIGHT
├ UPDATE_CALIBRATION_WINDOW
├ UPDATE_THRESHOLD
├ RETRAIN_SCORE_MODEL
├ NEW_CERTIFICATE_EPOCH
└ REVOKE
↓
Weighted / Online Conformal Layer
↓
Conformal p / evidence factor
↓
Weighted Conformal Martingale
↓
Anytime Monitor
↓
Calibration Certificate State
├ VALID
├ ADAPTED
├ STALE
├ SUPPORT_VIOLATION
├ CONCEPT_SHIFT_ALARM
└ REVOKED
↓
Permission Gate
```

---

# 四、Bottom-Level Logic

## 4.1 Policy-induced density ratio

若 reference calibration population 為：

```text
P_ref(X)
```

而 deployment 在新 policy 下形成：

```text
P_target^π(X)
```

importance weight 理想形式為：

```text
w_π(x)
=
P_target^π(x) / P_ref(x)
```

但 Agent 更真實的 selection 是：

```text
S ~ π(S | H, X_partial)
```

所以真正需要記錄的是：

```text
P(S=1 | pre-selection state)
```

而不是只事後估一個黑箱 density ratio。

若：

```text
P_ref(S=1 | x) = 0
```

但新 policy 需要該區域：

```text
P_new(S=1 | x) > 0
```

則是 support failure，而非「多給一點 importance weight」就能修。

```text
Reweightable Shift
≠
Support Violation
```

## 4.2 Weighted conformal p-value → martingale

底層可抽象成：

```text
score_t
↓
weighted rank against calibration scores
↓
p_t^w
↓
betting function b_t(p_t^w)
↓
M_t = M_{t-1} × b_t(p_t^w)
```

在有效 null / weighting contract 下，`M_t` 才能被解讀為合法的 anytime evidence process。

## 4.3 WATCH 原始碼中值得看的真正模組

官方 code repository：
https://github.com/aaronhan223/watch

值得優先讀：

```text
src/
├ main.py
├ main_mnist_cifar.py
├ p_values.py
├ martingales.py
├ utils.py
├ resnet.py
└ podkopaev_ramdas/
```

`martingales.py` 真正包含：

```text
ville_procedure
cusum_procedure
shiryaev_roberts_procedure
simple_jumper_martingale
composite_jumper_martingale
cautious_simple_jumper_martingale
```

其中 Simple Jumper 維護三種 betting states：

```text
C_-1, C_0, C_1
```

每輪先按 jump rate `J` 混合資本，再根據 conformal p-value 更新：

```text
C_-1 *= 1 - (p-.5)
C_0  *= 1
C_1  *= 1 + (p-.5)
```

最後：

```text
C = C_-1 + C_0 + C_1
```

Composite Jumper 同時維護：

```text
J ∈ {0.0001, 0.001, 0.01, 0.1, 1}
```

再取平均，等於讓 monitor 同時對多種 changepoint / shift timescale 保留敏感度。

這直接啟發 Hermes：

```text
One Drift Timescale
≠
All Agent Runtime Drift
```

Camera drift、tool schema drift、user preference drift、memory contamination 的速度可能完全不同，因此 monitor 應做 mixture / multi-timescale monitoring。

---

# 五、Visual Simulation Idea

## Policy Feedback × Calibration Drift × Martingale Monitor Lab

### 左側：Agent Policy

```text
Policy Epoch 17

Camera activation     100%
Voice activation       80%
Tool verification      25%
Ask-user               10%

            ↓ change

Policy Epoch 18

Camera activation      35%
Voice activation       80%
Tool verification      70%
Ask-user               25%
```

### 中央：Distribution Decomposer

```text
World covariate drift      LOW
Policy-induced drift       HIGH
Concept drift              LOW
Support overlap            0.82
Label-observation drift    MEDIUM
```

使用者可按：

```text
IGNORE POLICY CHANGE
```

畫面顯示：

```text
Calibration coverage
90% → 71%

False shift alarms ↑
Certificate invalid
```

切換：

```text
POLICY-AWARE WEIGHTING
```

則：

```text
Effective sample size  812 → 341
Weighted coverage      89.2%
Support warning        moderate
```

### 右側：Martingale Wealth

```text
M_t
1
1.2
1.1
2.4
3.9
4.1
...
```

若只是 mild reweightable covariate shift：

```text
ADAPT
NO ALARM
```

若出現 concept shift：

```text
M_t > 1/α
↓
CONCEPT SHIFT ALARM
↓
Calibration certificate → QUARANTINE
```

### 教學模式最重要的對照

```text
WORLD CHANGED
vs
AGENT CHANGED WHAT IT LOOKS AT
```

這可以非常直覺地說明：

> AI 看到的世界分布，部分是世界本身造成的，部分是 AI 自己的 policy 造成的。

---

# 六、Code / GitHub

## A. WATCH 官方程式
https://github.com/aaronhan223/watch

### Directory structure

```text
Podkopaev & Ramdas Code/
Podkopaev_Ramdas_Code/
datasets/
dd_results/
figs/
notebooks/
scripts/
src/
WATCH_TutorialExample.ipynb
```

### 核心檔案

```text
src/main.py
src/p_values.py
src/martingales.py
src/main_mnist_cifar.py
src/utils.py
```

### 值得 Hermes 借用的設計

1. p-value construction 與 martingale betting 分開；
2. density-ratio / weighted-p machinery 不和 alarm rule 混在一起；
3. Simple / Composite / Cautious betting strategies 可切換；
4. monitoring 與 change diagnosis 是獨立層；
5. simulation、vision benchmark、real deployment pipeline 分開。

### 不應直接照抄的地方

Hermes 是 multimodal agent runtime，需要補：

```text
policy epoch
selection propensity
modality ancestry
tool execution side effects
label missingness
agent-created environment shift
```

WATCH 原始碼本身不是 agent policy feedback simulator。

## B. Salesforce online_conformal
https://github.com/salesforce/online_conformal

值得讀的原因：同時實作 SAOCP、SF-OGD、FACI、non-exchangeable conformal 等方法，可以用來比較「固定 window / online gradient / strongly adaptive」在不同 drift timescale 下的行為。

---

# 七、Papers

## Paper A
**WATCH: Adaptive Monitoring for AI Deployments via Weighted-Conformal Martingales**  
Prinster, Han, Liu, Saria. ICML 2025.  
https://proceedings.mlr.press/v267/prinster25a.html

**Architecture:** weighted conformal p-values → conformal test martingale → online shift adaptation / alarm diagnosis.  
**Changed:** 讓 continual monitoring 不再假設任何 shift 都是 failure；可以 adapt benign covariate shift 並對 harmful shift 告警。  
**Limitation:** weighting validity / support / shift family 仍需建模。

## Paper B
**Optimal training-conditional regret for online conformal prediction**  
Liang, Ren, Chen. 2026.  
https://arxiv.org/abs/2602.16537

**Architecture:** drift detection → dynamic calibration data → split/full online conformal.  
**Changed:** 把評估從 time-average marginal coverage 推到 training-conditional cumulative regret；online score training 改從 stability 切入。  
**Limitation:** arbitrary adaptive policy-induced data collection 尚未完全涵蓋。

## Paper C
**Model-Agnostic Online Certificate-Driven Calibration for Time Series Forecasting Under Distribution Shift**  
Huang, Ma, Michailidis. UAI 2026.  
https://proceedings.mlr.press/v337/huang26b.html

**Architecture:** base forecaster + gated residual Bayesian head + online martingale PAC-Bayes certificate.  
**Changed:** certificate 不只是部署前報告，而可以成為 online calibration 控制訊號。  
**Limitation:** forecasting-specific，Agent 的 selection / tool feedback 更複雜。

## Paper D
**CAP: A General Algorithm for Online Selective Conformal Prediction with FCR Control**  
Bao, Huo, Ren, Zou. JMLR 2025.  
https://www.jmlr.org/papers/v26/24-0452.html

**Architecture:** adaptive pick → conditional calibration set → prediction interval → FCR control.  
**Changed:** 正面處理 selection-before-prediction。  
**Limitation:** generic agent policy feedback 仍需要額外 causal / sequential layer。

## Paper E
**Conformal Inference for Online Prediction with Arbitrary Distribution Shifts**  
Gibbs, Candès. JMLR 2024.  
https://www.jmlr.org/beta/papers/v25/22-1218.html

**Architecture:** adaptive significance / learning-rate tuning under nonstationarity.  
**Changed:** 不要求先知道 drift rate；更快速追蹤 local shift。  
**Limitation:** coverage adaptation 不等於證明 model causal/mechanistic validity。

---

# 八、Unknown / Open Questions

## 1. Policy-induced shift 與 environment shift 可以完全識別嗎？

通常只有 observational telemetry：

```text
π changed
+
data changed
```

但這不保證能拆出：

```text
policy effect
vs
world effect
```

需要 policy randomization、logged propensity、shadow policy 或 causal adjustment。

## 2. Selection probabilities 可以被 LLM policy 精確記錄嗎？

LLM tool/query selection 通常不是乾淨的 closed-form propensity。若 API 只回 final action 而沒有 calibrated action probability，importance weighting 會缺一個關鍵量。

## 3. Multimodal missingness 本身是不是資訊？

例如：

```text
Agent decides NOT to open camera
```

這不是普通 MCAR missingness；它由 policy 與 belief 決定。`missing modality` 本身可能攜帶 latent state 資訊，不能簡單丟棄。

---

# 九、下一輪研究

下一輪最自然的方向：

# **Feedback Covariate Shift × Logged Propensity × Selective Labels × Counterfactual Calibration × Policy-Safe Evidence**

要追：

```text
Agent policy π
↓
selection S
↓
observed multimodal stream
↓
selective labels / delayed outcomes
↓
propensity logging
↓
importance-weighted / doubly robust calibration
↓
policy counterfactual target population
↓
calibration certificate
↓
policy update
```

核心問題：

> 如果 Hermes 想比較「現在 policy」與「新 policy」的 calibration validity，但歷史資料都是舊 policy 收集的，能否在真正部署新 policy 前，用 counterfactual / off-policy calibration 預測新 policy 下 evidence runtime 是否仍有效？

---

# 十、Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Policy-Dependent Calibration Drift
Policy-Shaped Observation Stream
CalibrationPopulationContract
Policy Epoch
Selection Rule Hash
Modality Activation Policy
Label Observation Policy
Policy-Induced Covariate Shift
Selection Shift
Label-Observation Shift
Adaptable Shift
Unsupported Shift
Weighted Conformal Martingale
Multi-Timescale Drift Monitor
CalibrationUpdateTransaction
ScoreModelStabilityContract
Policy-Aware Calibration Certificate
Calibration Support Region
Effective Calibration Sample Size
Shift Decomposer
Policy-Aware Density Ratio
Calibration Certificate Epoch
```

## 新增 Edges

```text
Policy Update
→ May Change Calibration Population

Policy Update
→ May Expire Calibration Certificate

Same Model Version
≠ Same Calibration Validity

No Environment Drift
≠ No Calibration Drift

Distribution Shift
≠ Certificate Failure Automatically

Reweightable Shift
≠ Support Violation

Adaptive Selection
→ Changes Observation Distribution

Adaptive Selection
→ Can Change Label Availability

Outcome at t
→ May Update Calibration at t+1

Outcome at t
↛ Retroactively Validate Round-t Threshold

Online Model Update
≠ Automatic Loss of All Conformal Validity

Stable Accuracy
≠ Stable Nonconformity Distribution

Policy Epoch
→ CalibrationPopulationContract

CalibrationPopulationContract
→ EvidenceValidityCertificate
```

---

# 十一、本輪結束判定

**缺哪一層：** Policy Feedback / Selection Mechanism Calibration Layer。  
**哪個節點最淺：** `PolicyAwareDensityRatio`、`CounterfactualCalibrationCertificate`、`SelectiveLabelCalibration`。  
**哪個概念仍只是名詞：** production 級 `Policy-Safe Multimodal Conformal E-Process`。  
**哪個系統值得讀原始碼：** WATCH，尤其 `src/p_values.py → src/martingales.py → src/main.py`。  
**哪篇論文需追引用：** WATCH，其次 Liang–Ren–Chen 2026。  
**哪個概念最適合視覺模擬：** Policy Feedback × Calibration Drift × Martingale Monitor Lab。  
**哪個 Agent 架構最值得實作：**

```text
Policy / Selection Ledger
↓
Calibration Population Contract
↓
Shift Decomposer
↓
Support / Propensity Auditor
↓
Weighted / Online Conformal Layer
↓
Multi-Timescale Martingale Monitor
↓
Certificate Migration Router
↓
Permission Gate
```

---

# 十二、對「AI 到底怎麼運作」新增的一層

從使用者一句話到 AI action 的完整還原，現在必須補上一條以前常被忽略的 feedback path：

```text
User / World
↓
UI / Sensor / Tool Inputs
↓
Agent Belief
↓
Policy decides what to inspect
↓
Only selected observations enter Context
↓
Model / Memory / Reasoning
↓
Action
↓
Action changes world AND future data collection
↓
Calibration stream changes
↓
Evidence validity changes
↓
Permission changes
↓
next Agent policy
```

核心結論：

> **AI 不是被動看見世界。Agent 會主動決定看哪裡、問誰、呼叫哪個工具、何時要求標記、何時忽略事件。因此 AI 之後拿來校準自己的資料，本身就是 AI policy 的產物。真正可驗證的 Agent 必須同時監控「世界是否變了」和「我是否改變了自己看世界的方式」。**
