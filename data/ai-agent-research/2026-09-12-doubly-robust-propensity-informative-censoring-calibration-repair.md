# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 19:51（Asia/Taipei）**  
**本輪主題：Doubly-Robust Calibration × Verification Propensity × Informative Censoring × Positivity/Overlap × Incremental Late-Label Repair**

> 本輪承接上一輪 `Delayed Feedback × Selective Labels × Bitemporal Calibration Repair`，不再重複「標籤會延遲／驗證樣本有選擇偏差」這個結論，而是往下一層拆解：**如何把 Agent 自己的 verification policy 視為 logging policy，顯式記錄 propensity，並用 IPS / AIPW / doubly robust correction 修復 calibration；以及何時這些修正根本無法識別。**

---

## 一、本小時新發現

### 新論文 / 新方法

1. **Doubly robust and efficient calibration of prediction sets for right-censored time-to-event outcomes** — Rebecca Farina, Arun Kumar Kuchibhotla, Eric J. Tchetgen Tchetgen；Biometrika 2026。  
   URL: https://academic.oup.com/biomet/article/113/3/asag036/8706430  
   核心：對 dependent right censoring 使用 IPCW 與 augmented IPCW（AIPCW）；augmented 方法的 coverage error 具有 second-order mixed-bias / doubly robust 性質。  
   對 Hermes 的改變：`Outcome observed?` 不能只是 boolean，而應建模 `P(observed | history, action, state)`，並讓 calibration residual 同時有 outcome model 與 observation/censoring model 兩條修正路徑。

2. **History-Aware Conformal Prediction Sets for Censored Time-to-Event Outcomes** — Yuyao Wang, Alexander W. Levis, Shu Yang, Larry Han；2026。  
   URL: https://arxiv.org/abs/2605.06581  
   核心：使用 decision-time 前的 covariate history、IPCW，以及兩個 doubly robust extensions。  
   對 Hermes 的改變：verification / feedback propensity 應條件於**完整可用歷史**，不是只看當下 risk score。

3. **Spatially Robust Inference with Predicted and Missing at Random Labels** — Stephen Salerno, Zhenke Wu, Tyler McCormick；2026。  
   URL: https://arxiv.org/abs/2603.11368  
   核心：在 MAR sparse labels 下使用 cross-fit doubly robust estimator；同時指出 cross-fitting 本身會引入 fold-level correlation，必須對 variance estimate 額外修正。  
   對 Hermes 的改變：即使 point estimate 經 DR correction，**certificate uncertainty** 仍需另外建模，不能只修平均風險。

4. **Optimal and Adaptive Off-policy Evaluation in Contextual Bandits** — Yu-Xiang Wang, Alekh Agarwal, Miroslav Dudík；ICML 2017。  
   URL: https://proceedings.mlr.press/v70/wang17a.html  
   核心：IPS / DR 的 bias–variance 結構、SWITCH estimator；importance weights 在 low-overlap 區域會爆炸。  
   對 Hermes 的改變：verification propensity 很小時，`1/p` 不是「更正確」，而是可能造成巨大 variance；需要 clipping / switch / abstention。

5. **The Decaying Missing-at-Random Framework** — Yuqian Zhang, Abhishek Chakrabortty, Jelena Bradic；2023。  
   URL: https://arxiv.org/abs/2305.12789  
   核心：研究 labeling propensity 隨樣本數下降的 partially labeled setting，並討論弱 positivity。  
   對 Hermes 的改變：不能把 positivity 當成永遠成立；某些 action family 可能實際上幾乎永不被真實驗證。

### 新 GitHub / 原始碼

**Open Bandit Pipeline (OBP)**  
Repo: https://github.com/st-tech/zr-obp  
本輪不是只看 README，而是追進：

```text
obp/ope/
├ estimators.py
├ estimators_tuning.py
├ regression_model.py
├ helper.py
├ meta.py
└ estimators_* .py
```

值得看的核心檔案：

- `obp/ope/estimators.py`
  - `DoublyRobust`
  - `DoublyRobustWithShrinkage`
  - Switch-DR 相關估計
- `obp/ope/estimators_tuning.py`
  - DR shrinkage / tuning
- `obp/ope/regression_model.py`
  - reward / outcome nuisance model

DR 原始碼的底層就是：

```text
importance_weight
= evaluation_policy_probability / logging_policy_probability

DM baseline
= E_a~pi_e [ q_hat(x,a) ]

residual correction
= importance_weight * (reward - q_hat(x,a_logged))

DR estimate
= DM baseline + residual correction
```

這個結構可直接映射到 Hermes：

```text
verification propensity
≈ logging policy probability

outcome model
≈ q_hat

observed final outcome residual
≈ reward - q_hat
```

---

# 二、本小時最重要 5 個發現

## 1. Verification Policy 必須成為 first-class logging policy

### 已確認事實
Off-policy / missing-label correction 的前提之一，是知道或可估計「某筆 outcome 為什麼被觀察」。IPS/DR 使用 logging propensity 對被選中的資料重新加權；Open Bandit Pipeline 的 `DoublyRobust` 原始碼直接以：

```text
w(x,a) = pi_e(a|x) / pi_b(a|x)
```

計算 importance weight，再加上 reward-model residual correction。

### Hermes 映射
上一輪有：

```text
VERIFY_FIRST
ABSTAIN
ACT
HUMAN
```

現在必須在 decision 發生**當下**紀錄：

```text
VerificationDecision
├ candidate_id
├ context_digest
├ action_family
├ proposed_action
├ verify_probability
├ sampled_decision
├ policy_version
├ random_seed / random_draw id
├ cost_budget
├ risk_before_verification
└ timestamp
```

不能事後只記：

```text
verified = true
```

因為事後已無法知道：

```text
P(verified | context, action, history)
```

### 為什麼重要
如果 Hermes 總是驗證 high-risk cases，則：

```text
P(label observed | risk=.9)
>>
P(label observed | risk=.1)
```

被驗證集合不是部署人口；沒有 propensity，後續 calibration repair 很難辨識 selection bias。

### 限制
若 verification policy 是完全 deterministic，某區域 probability=0，則一般 inverse weighting 沒有 overlap 可以利用。

---

## 2. Doubly Robust ≠ Magic：它需要 identification 條件

DR 的重要形式可寫成：

```text
m_hat(x)
+
R / p_hat(x) * (Y - m_hat(x))
```

其中：

```text
R = outcome 是否被觀察
p_hat = observation / verification propensity
m_hat = outcome model
Y = final outcome
```

它的工程價值是：

```text
Outcome model 好
OR
Propensity model 好
```

其中一路正確時，估計仍可能一致／穩健（精確保證依具體 estimator 與假設而定）。2026 Biometrika 的 AIPCW 結果就是 censored calibration 的重要實例。

但 Hermes 必須明列三個邊界：

```text
Double robustness
≠ no assumptions

Double robustness
≠ positivity-free everywhere

Double robustness
≠ valid under arbitrary MNAR
```

如果未被驗證的結果仍取決於某個**未觀察變數**：

```text
Y → Verification
```

即使給定所有 recorded context 仍不能阻斷 selection，MAR / conditional-independent censoring 不成立，單純 AIPW 不足以恢復真實 population calibration。

因此新增：

```text
SelectionIdentifiabilityStatus
├ MAR_PLAUSIBLE
├ MNAR_SUSPECTED
├ POSITIVITY_WEAK
├ POSITIVITY_VIOLATED
└ UNIDENTIFIED
```

---

## 3. Positivity / Overlap 是 Agent verification 系統的硬底層限制

### Bottom-level mechanism

假設：

```text
verify_probability = 0.01
```

則單筆 observed outcome 的 IPS weight 約為：

```text
1 / .01 = 100
```

若：

```text
verify_probability = .001
```

則：

```text
weight = 1000
```

這表示少量 observation 可以支配整個 calibration update。

所以 runtime 要額外監控：

```text
PropensityHealth
├ min_propensity
├ p01 / p05 propensity
├ max_weight
├ effective_sample_size
├ clipped_fraction
├ unsupported_state_fraction
└ overlap_by_action_family
```

常見 ESS：

```text
ESS = (Σ w_i)^2 / Σ w_i^2
```

例如 nominal labels = 1000，但 ESS 可能只剩 43。

### 新工程規則
Hermes 不應在 weak-overlap region 假裝 certificate 很精準，而應：

```text
GOOD OVERLAP
→ DR calibration

WEAK OVERLAP
→ clipped/SWITCH estimator + wider bound

NO OVERLAP
→ cannot identify
→ targeted exploration / real verification required
```

### 關鍵否定關係

```text
More Importance Weight
≠ More Information
```

---

## 4. Informative Censoring 需要和 Verification Selection 分開建模

Agent outcome 缺失至少可能來自兩個機制：

```text
A. Verification selection
「我有沒有主動去查」

B. Outcome censoring
「即使查了／追蹤了，結果是否在觀察窗內出現」
```

例如：

```text
send_email()
↓
是否選擇人工追蹤？   ← verification propensity
↓
48h 內是否收到回覆？ ← censoring process
```

不能把兩者合成一個：

```text
label_observed_probability
```

更好的 schema：

```text
OutcomeObservationMechanism
├ verification_propensity
├ followup_policy
├ censoring_survival_probability
├ observation_window
├ delay_distribution
├ censor_reason
└ finality_status
```

2026 Biometrika 的 AIPCW 與 HAPS 的 IPCW/DR extension 說明：對 right-censored outcome，要顯式估計 censoring mechanism，而不是把尚未觀察到的 outcome 當成 failure。

Hermes 因此應將：

```text
SelectionWeight
```

與：

```text
CensoringWeight
```

分開，再決定 estimator 如何組合。

---

## 5. Late Label Repair 應從 full replay 升級成 Calibration Causal Slice

上一輪提出 bitemporal repair：late ground truth 到達後回填 valid time。

這輪往下一步：**不需要每次重算全部 calibration history。**

建立依賴圖：

```text
Late Outcome Y_42
↓
Observation Model Residual
↓
DR Sufficient Statistic
↓
Action-Risk Profile: payment/refund
↓
Calibration State v181
↓
Certificates C181..C197
```

只 replay affected slice。

建議 calibration state 儲存可增量更新的 sufficient statistics：

```text
CalibrationAccumulator
├ weighted_count
├ weighted_error_sum
├ weighted_sq_error_sum
├ propensity_weight_sum
├ propensity_weight_sq_sum
├ censor_weight_sum
├ nuisance_model_version
├ calibration_epoch
└ dependency_ids
```

late label 來時：

```text
1. 定位原 event-time record
2. 找當時 propensity / censoring model version
3. 建立 outcome residual
4. 更新 DR/AIPW contribution
5. invalidate affected aggregate nodes
6. replay only descendants
7. compare old/new risk certificate
8. emit CertificationDivergenceEvent
```

這把上一輪的：

```text
Bitemporal Calibration Repair
```

升級成：

```text
Incremental Causal Calibration Repair
```

---

# 三、Architecture Breakdown

```text
Agent Runtime
↓
Proposed Action
↓
Risk / OOD / Planner Sensitivity
↓
Verification Policy
├ probability distribution
├ sampled verify decision
└ policy version
↓
Propensity Logger
↓
Action Execution
↓
Outcome Lifecycle
├ pending
├ provisional
├ censored
└ final
↓
Observation Mechanism Model
├ selection propensity model
└ censoring / delay model
↓
Outcome Model
↓
DR / AIPW Calibration Engine
↓
Overlap & ESS Monitor
↓
Calibration State
↓
Action-Conditional Risk Bound
↓
ACT / VERIFY / ABSTAIN / HUMAN / BLOCK

Late outcome arrives
↓
Bitemporal Event Join
↓
Calibration Causal Slice
↓
Incremental DR Repair
↓
Certificate Diff
↓
Historical Safety Audit
```

---

# 四、Bottom-Level Logic

## 4.1 Propensity logging

真正正確的順序：

```text
Context X_t
↓
Verification policy μ_v(. | X_t)
↓
store full probability / propensity BEFORE sampling
↓
R_t ~ μ_v
↓
if R_t = 1 → query real label eventually
```

錯誤作法：

```text
R_t observed
↓
事後猜 propensity
```

因為 policy 可能更新、context 可能變動、randomization state 已消失。

## 4.2 IPS correction

```text
weighted_loss_i
=
R_i / p_i * loss_i
```

但 `p_i → 0` 時 variance 爆炸。

## 4.3 Augmented / doubly robust correction

概念性 Agent 版本：

```text
DRLoss_i
=
m_hat(X_i)
+
R_i / p_hat(X_i)
  * (Loss_i - m_hat(X_i))
```

再把 delayed/censored outcome 擴成：

```text
selection correction
× censoring correction
+ augmentation term
```

實際 production estimator 必須依 feedback mechanism 選擇，不能把上式直接視為 universally valid。

## 4.4 Weight stabilization

至少支援：

```text
raw IPS
self-normalized IPS
clipped IPS
Switch-DR
DR with shrinkage
```

Open Bandit Pipeline 的 `DoublyRobustWithShrinkage` 原始碼會將重要性權重收縮，以控制 MSE；Switch 類方法則在極端 importance region 改變 estimator，這對 Agent verification 很有實務價值。

---

# 五、Visual Simulation Idea

## **Verification Bias × Doubly Robust Calibration Lab**

### 視圖 A：Deployment Population vs Verified Population

```text
Deployment
○ ○ ○ ○ ○ ○ ○ ○ ○ ○
○ ○ ● ● ● ● ● ● ● ●

● = verified
```

右側即時顯示：

```text
Population high-risk rate      11%
Verified high-risk rate        69%

Selection shift              HIGH
```

### 視圖 B：Propensity / Weight map

每個 state-action node 顯示：

```text
verify p=.84  → weight 1.19
verify p=.30  → weight 3.33
verify p=.04  → weight 25
verify p=.002 → weight 500 ⚠
verify p=0    → UNIDENTIFIED ✕
```

使用者可切：

```text
Naive
IPS
Clipped IPS
DR
Shrinkage DR
Switch-DR
```

觀看 risk estimate / CI / ESS 如何變化。

### 視圖 C：Censoring timeline

```text
18:00 send_email
│
├ 18:01 verification selected p=.22
│
├ 24h no response  → PENDING
│
├ 48h window end   → CENSORED
│
└ 72h reply arrives → LATE FINAL SUCCESS
```

Late label 到達後動畫顯示 affected calibration DAG：

```text
Late Label
   ↓
DR contribution
   ↓
Email-action calibration
   ↓
3 historical certificates changed
```

### 視圖 D：Overlap heatmap

```text
                    Verification propensity
state/action        p05     median    p95
refund              .18       .61     .94
charge              .02       .19     .71
publish             .00       .03     .26  ✕
delete               .00       .00     .11  ✕
```

這讓非統計背景的使用者能直接看懂：

> **沒有被觀察過的世界，統計方法不能憑空證明。**

---

# 六、Code / GitHub

## Open Bandit Pipeline
https://github.com/st-tech/zr-obp

### 最值得看的目錄

```text
obp/ope/
├ estimators.py
├ estimators_tuning.py
├ regression_model.py
├ helper.py
└ meta.py
```

### `DoublyRobust` 核心工程結構

```text
importance weight
↓
reward regression baseline
↓
logged residual
↓
weighted residual correction
↓
round reward estimate
↓
mean policy value
```

### Hermes 應借，不應照抄的部分

可借：

- logging propensity 的 first-class data model
- outcome / reward nuisance model
- IPS / DR / shrinkage / switch estimator family
- ESS / variance / tuning 概念

不能直接照抄：

- 一般 contextual-bandit 假設沒有 Agent 多步 history、delayed feedback、censoring、tool side effects
- evaluation action probability 與 verification probability 在 Hermes 是不同 policy object
- Agent label missingness 可能 MNAR
- safety certificate 需要 sequential / action-conditional risk，不只是 scalar policy value

---

# 七、Papers

## Paper 1
**Title:** Doubly robust and efficient calibration of prediction sets for right-censored time-to-event outcomes  
**Authors:** Rebecca Farina, Arun Kumar Kuchibhotla, Eric J. Tchetgen Tchetgen  
**Institution:** 作者跨統計 / 因果推論研究機構；詳見正式論文 affiliation  
**Year:** 2026  
**URL:** https://academic.oup.com/biomet/article/113/3/asag036/8706430  
**Code:** 本輪未確認官方 code  
**Dataset:** survival / censored outcome simulations + empirical evaluation  
**Architecture:** IPCW + augmented IPCW / efficient influence-function style correction  
**Contribution:** censored prediction-set calibration 的 doubly robust coverage-error 結構  
**Limitations:** 仍依賴 conditional-independent censoring 等 identification assumptions；不可直接等同任意 Agent MNAR feedback。

## Paper 2
**Title:** History-Aware Conformal Prediction Sets for Censored Time-to-Event Outcomes  
**Authors:** Yuyao Wang, Alexander W. Levis, Shu Yang, Larry Han  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2605.06581  
**Code:** 本輪未確認  
**Architecture:** history-aware prediction + IPCW + doubly robust extensions  
**Contribution:** calibration / prediction 可以條件於 decision-time history  
**Limitations:** survival-time setting；Hermes 需要轉譯到 heterogeneous tool/action outcomes。

## Paper 3
**Title:** Spatially Robust Inference with Predicted and Missing at Random Labels  
**Authors:** Stephen Salerno, Zhenke Wu, Tyler McCormick  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2603.11368  
**Architecture:** cross-fit nuisance models + doubly robust estimator + variance correction  
**Contribution:** 部分標籤下 point correction 與 uncertainty estimation 必須分開處理  
**Limitations:** MAR 與 spatial dependence，非 Agent sequential policy 本身。

## Paper 4
**Title:** Optimal and Adaptive Off-policy Evaluation in Contextual Bandits  
**Authors:** Yu-Xiang Wang, Alekh Agarwal, Miroslav Dudík  
**Institution:** Microsoft Research / academic collaborators at publication time  
**Year:** 2017  
**URL:** https://proceedings.mlr.press/v70/wang17a.html  
**Code:** 可搭配 OBP 工程實作閱讀  
**Architecture:** IPS / DR / SWITCH  
**Contribution:** 清楚刻畫 importance weighting 的 bias–variance / low-overlap 問題  
**Limitations:** contextual bandit ≠ multi-step agent feedback process。

## Paper 5
**Title:** The Decaying Missing-at-Random Framework: Doubly Robust Causal Inference with Partially Labeled Data  
**Authors:** Yuqian Zhang, Abhishek Chakrabortty, Jelena Bradic  
**Year:** 2023  
**URL:** https://arxiv.org/abs/2305.12789  
**Contribution:** 研究 labeling propensity 下降與 weak positivity 的 partially labeled inference  
**Limitations:** 不是 conformal Agent calibration，但對 Hermes 的「少數 action 幾乎永不驗證」問題非常直接。

---

# 八、已確認事實 / 推論 / 假說分層

## 已確認／論文與原始碼支持

- DR/OPE 明確依賴 logging propensity 與 outcome/reward model。
- OBP `DoublyRobust` 實際計算 evaluation-policy / logging-policy importance weight，並以 reward-model residual 做 augmentation。
- 2026 Biometrika censored calibration 明確使用 IPCW + augmented IPCW，且 augmented 方法具 doubly robust coverage-error 性質。
- right censoring 與 selective label 都不能安全地把 missing 當 negative。
- low propensity 會導致 extreme importance weight / high variance 問題。

## Hermes 工程推論

- 將 Agent verification policy 視為 logging policy，是 correction selective labels 最自然的 runtime abstraction。
- `VerificationPropensity` 必須在 sampling 前寫入 immutable event log。
- Selection 與 censoring 應使用分開的 mechanism model。
- late label repair 適合沿 calibration dependency graph 做 incremental causal slice，而非全歷史重算。

## 尚未驗證假說

- `selection propensity × censoring survival probability` 的哪種 augmented estimator 最適合 Hermes heterogeneous action-risk conformal certificate，尚未完成形式化推導。
- 將 Switch-DR / DR shrinkage 直接用於 online conformal action-risk calibration 是否仍保有理想 coverage，需要新理論或 simulation benchmark。
- 多步 Agent 中 verification decision 本身會改變後續 state，因此單步 missing-data correction 是否足夠仍未知。

---

# 九、Unknown / Open Questions

1. **Sequential interference：** verification action 本身可能改變世界（例如詢問使用者會影響後續行為）。此時 propensity correction 是否需升級到 trajectory-level off-policy estimator？
2. **MNAR identification：** 若 outcome 會透過未記錄訊號影響 verification probability，應使用 sensitivity bounds、instrument、proxy，還是直接標示 `UNIDENTIFIED`？
3. **Anytime validity：** late-label DR repair 後，歷史 conformal / risk certificate 的 repeated repair 是否仍可給 anytime-valid guarantee？

---

# 十、下一輪研究

下一輪最大缺口：

# **Sequential Selection Bias × Trajectory-Level Propensity × Verification-as-Intervention × Causal Feedback Loops**

優先研究路徑：

```text
Agent state S_t
↓
Verification decision V_t
↓
Verification itself changes context / world
↓
Action A_t
↓
Delayed outcome Y_t
↓
future state S_t+1
↓
future verification policy
```

需要回答：

```text
單步 propensity correction
何時失效？

是否需要 trajectory importance weight？

verification 是 observation action
還是 environment intervention？

如何避免產品為了「取得 label」本身改變被測量系統？
```

下一輪應追：

- sequential doubly robust estimators / longitudinal TMLE
- off-policy evaluation with delayed outcomes
- active sensing / value of information where sensing changes dynamics
- causal missingness under adaptive data collection
- trajectory-level positivity / support
- safe randomized exploration for ground-truth collection

---

# 十一、Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Verification Logging Policy
Verification Propensity
Selection Mechanism Model
Censoring Mechanism Model
Augmented Inverse Probability Weighting
Doubly Robust Calibration
Selection Identifiability
Positivity
Overlap
Weak Overlap
Effective Sample Size
Extreme Importance Weight
Weight Clipping
Shrinkage DR
Switch-DR
Outcome Nuisance Model
Censoring Survival Probability
Propensity Health
Unsupported State Region
Calibration Causal Slice
Incremental Calibration Repair
Certification Divergence Event
```

## 新 Edges

```text
VerificationPolicy
GENERATES
VerificationPropensity

VerificationPropensity
CORRECTS
SelectiveLabelBias

CensoringMechanism
DIFFERS_FROM
VerificationSelection

OutcomeModel
AUGMENTS
InverseProbabilityCorrection

LateLabel
INVALIDATES
CalibrationDescendants

WeakOverlap
REDUCES
EffectiveSampleSize

NoOverlap
CAUSES
NonIdentification
```

## 新否定關係

```text
Verified Dataset
≠
Deployment Population

Doubly Robust
≠
Assumption Free

Doubly Robust
≠
MNAR Solved

Large Importance Weight
≠
Large Information

Propensity Estimated
≠
Positivity Satisfied

Outcome Missing
≠
Outcome Negative

Selection Probability
≠
Censoring Probability

Point Estimate Corrected
≠
Certificate Variance Corrected

Late Label Update
≠
Historical Certificate Repair
```

---

# 十二、每輪結束檢查

- **缺哪一層：** sequential / trajectory-level selection correction；目前仍主要是單 decision-event 的 propensity + censoring correction。
- **哪個節點最淺：** `SelectionIdentifiabilityStatus`、`IncrementalCalibrationRepair`、`TrajectoryPositivity`。
- **哪個概念仍只是名詞：** `DoublyRobustConformalRepair` 在 Hermes action-risk setting 尚未有完整數學定義；`CalibrationCausalSlice` 尚未實作。
- **哪個系統值得讀原始碼：** Open Bandit Pipeline 的 `obp/ope/estimators.py`、`estimators_tuning.py`、`regression_model.py`；下一輪再找 longitudinal/sequential DR 官方 code。
- **哪篇論文需追引用：** 2026 Biometrika `Doubly robust and efficient calibration of prediction sets for right-censored time-to-event outcomes`，因為它最直接連接 censoring、calibration、AIPW、double robustness。
- **哪個概念最適合視覺模擬：** `Verification Bias × Doubly Robust Calibration Lab`，尤其是 propensity heatmap + ESS + overlap holes + late-label repair animation。
- **哪個 Agent 架構最值得實作：** `Selection-Aware Calibration Runtime = Propensity Logger + Outcome/Censoring Models + DR/AIPW Engine + Overlap Monitor + Bitemporal Incremental Repair + Action-Risk Certificate`。

---

## 本輪對「AI 到底怎麼運作」補上的一層

從使用者一句話到 Agent 執行，不只存在：

```text
UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tools/MCP
→ Model/GPU
→ Action
```

執行後還有一個會反過來塑造未來 Agent 的閉環：

```text
Action
→ Outcome
→ 哪些 Outcome 被看見？
→ Verification Policy
→ Selective Labels
→ Calibration
→ Risk Gate
→ 下一次 Agent Action
```

因此一個成熟 Agent 的「自我校準」不是被動把觀察到的結果塞回模型；它必須知道：**這些結果為什麼會被看見、哪些世界幾乎從未被觀察、權重校正是否已經失去 overlap，以及晚到的真相應該改寫哪些歷史安全判斷。**
