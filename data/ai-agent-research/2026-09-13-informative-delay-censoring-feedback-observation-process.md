# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-13 21:53 Asia/Taipei

## 本輪研究主題
**Informative Delay × Censoring Hazard × Feedback Observation Process × IPCW × Missing-Outcome Sequential Evidence × Agent Permission Gate**

本輪承接上一輪的 `Admission-Time Filtration`、`EvidenceEpochFork` 與 `RevisionValidityAuditor`，但刻意不重複 optional skipping、out-of-order arrival、fixed-delay ACI 或 certificate supersession。本輪集中回答：

> 如果 feedback 是否出現、何時出現，本身就和 outcome、action、risk、user satisfaction 或 tool failure 有關，Agent 還能不能把「目前看得到的 feedback」當成代表全部真實世界？缺失 outcome 要如何進入 sequential evidence？

---

# 本小時新發現

## 新論文 / 理論線
1. **History-Aware Conformal Prediction Sets for Censored Time-to-Event Outcomes** — Yuyao Wang, Alexander W. Levis, Shu Yang, Larry Han, 2026, arXiv:2605.06581。以 time-varying history + inverse probability of censoring weighting（IPCW）處理 right censoring，並提出 doubly robust extensions；其核心提醒是 censoring mechanism 必須成為 inference object，而不是把未觀察 outcome 當成 ordinary missing value。
2. **Can Probabilistic Feedback Drive User Impacts in Online Platforms?** — Dai et al., AISTATS 2024。證明不同 action/content 的 observable feedback rate 本身就會改變 online learner 的 engagement；即使 objective 沒有刻意偏差，feedback visibility 差異仍可形成 downstream behavior bias。
3. **Causal inference with outcome-dependent missingness and self-censoring** — Chen, Malinsky, Bhattacharya, UAI 2023。當 outcome 直接影響自身是否被觀察時，self-censoring 會造成嚴重識別問題，不能只假設 missing-at-random。
4. **Mirror Online Conformal Prediction with Intermittent Feedback** — Wang, Zecchin, Simeone, 2025。可在 intermittent feedback 下維持 long-run coverage，但這與 outcome-dependent informative censoring 是不同 regime，不能直接等同。
5. **Adaptive Conformal Inference Under Delayed Feedback** — El Halabi & Brandt, 2026。fixed-delay ACI 可分解為 interleaved sequences；本輪將它定位為 `delay known / feedback eventually observed` 的較窄 regime，不足以涵蓋 informative missingness。

## 新 GitHub / 工程實作
**sebp/scikit-survival** 的 `sksurv/nonparametric.py` 直接實作 `CensoringDistributionEstimator.predict_ipcw()`：

```text
Ghat = estimated censoring-survival probability
weight_i = event_i / Ghat(time_i)
```

而且當 `Ghat == 0` 時直接丟出錯誤；這是一個很重要的工程訊號：

```text
IPCW correction
需要 censoring positivity / support
```

不是所有被 censor 的資料都能靠權重魔法修回來。

值得看的核心檔案：

```text
sksurv/nonparametric.py
  └ CensoringDistributionEstimator
      └ predict_ipcw()

sksurv/metrics.py
  └ fit censoring estimator
  └ transform test samples to IPCW
```

官方原始碼：
https://github.com/sebp/scikit-survival/blob/main/sksurv/nonparametric.py

---

# 本小時最重要 5 個發現

## 1. `No Feedback Yet` 本身可能是一個 observation

### 概念
上一輪把 feedback 分成 pending / delayed / corrected，但還隱含一個風險假設：尚未抵達的 feedback 只是「還沒看到」。

真正部署中的 Agent 常不是這樣：

```text
成功 → 使用者可能沉默
失敗 → 使用者很快抱怨
工具成功 → 沒 webhook
工具失敗 → 立即 error callback
高風險交易 → settlement 很慢
低風險讀取 → 立即完成
```

於是：

```text
Feedback arrival process
```

本身就和 latent outcome 有關。

### 底層如何運作
令：

```text
Y_i = 真實 outcome
R_i(t) = 到時間 t 前是否已觀察到 outcome
H_i(t) = 當時已知 history
```

若：

```text
P(R_i(t)=1 | Y_i, H_i(t))
```

仍直接依賴未觀察的 `Y_i`，則 missingness / delay 是 informative。

此時：

```text
R_i(t)=0
```

不是沒有資訊；它可能改變對 `Y_i` 的 posterior。

### 為什麼重要
Hermes 如果用：

```text
observed feedback only
↓
accuracy / reward / calibration
```

可能把「容易被回報的 cases」錯當成全體世界。

### 限制
只有在給定足夠 history 後 censoring/observation mechanism 可被建模，IPCW 等 correction 才有識別基礎；若 outcome 直接造成 self-censoring、且沒有額外可識別結構，問題可能根本不可識別。

### 來源
- Dai et al., *Can Probabilistic Feedback Drive User Impacts in Online Platforms*, AISTATS 2024: https://proceedings.mlr.press/v238/dai24b.html
- Chen et al., *Causal inference with outcome-dependent missingness and self-censoring*, UAI 2023: https://proceedings.mlr.press/v216/chen23f.html

**狀態：已確認理論事實 + Agent 工程映射。**

---

## 2. Feedback 必須拆成「Outcome Process」與「Observation Process」

### 概念
Hermes 不能再只保存：

```text
Action → Feedback
```

應拆成：

```text
Action
↓
Latent Outcome Process Y(t)
↓
Feedback Observation / Censoring Process R(t)
↓
Observed Feedback
```

### Architecture primitive
新增：

```text
FeedbackObservationModel
├ target_event_id
├ outcome_type
├ feedback_channel
├ observation_hazard
├ censoring_hazard
├ action_dependence
├ state_dependence
├ outcome_dependence_status
├ environment_epoch
├ positivity_status
└ model_validity_regime
```

### 底層如何運作
若 observation mechanism 在給定 history 下可視為 conditionally non-informative：

```text
Y ⫫ R | H
```

則可以估：

```text
G_i(t)
= P(feedback still unobserved beyond t | H_i)
```

或等價的 feedback-observation probability。

進而建立 inverse probability correction。

### 為什麼重要
這把前一輪的 `PendingFeedbackRegistry` 從 queue 升級成真正的 statistical object；等待多久、是否沉默、是否 callback 都可成為 inference input。

### 限制
`Y ⫫ R | H` 是否成立不能只靠 code assert；它是 causal/statistical assumption，需要 observable diagnostics、domain contract 或 sensitivity analysis。

### 來源
- Willems et al., *Correcting for dependent censoring ... using IPCW*, Statistical Methods in Medical Research: https://doi.org/10.1177/0962280216628900
- Rotnitzky & Robins, *Inverse Probability Weighting in Survival Analysis*: https://doi.org/10.1002/9781118445112.stat06031

**狀態：理論事實已知；Hermes schema 為新工程建模。**

---

## 3. IPCW 的底層不是「補值」，而是重新加權仍可觀察的世界

### 概念
IPCW 不需要假造 censored outcome。

對可觀察 event，典型權重形式為：

```text
w_i
=
δ_i / Ghat(T_i | H_i)
```

其中：

```text
δ_i = outcome/event 是否在 censoring 前觀察到
Ghat = censoring survival / observation probability
```

### 工程實作驗證
`scikit-survival` 的 `predict_ipcw()` 實際做：

```text
Ghat = self.predict_proba(time[event])
weights[event] = 1.0 / Ghat
```

且 `Ghat == 0` 時拒絕繼續。

這意味：

```text
沒有 support
→ 不能靠巨大 weight 假裝恢復資訊
```

### Hermes 對應
新增：

```text
FeedbackIPCWCertificate
├ observation_model_id
├ Ghat
├ raw_weight
├ clipped_weight
├ effective_sample_size
├ max_weight
├ positivity_status
├ tail_warning
├ target_estimand
└ allowed_use
```

並區分：

```text
USE_FOR_DESCRIPTIVE_CORRECTION
USE_FOR_FIXED_HORIZON_INFERENCE
USE_FOR_SEQUENTIAL_EVIDENCE
REJECT
```

### 為什麼重要
若只看回來的 feedback：

```text
success 90%
```

但 success cases 比 failure cases 快 10 倍回報，raw 90% 可能完全沒有代表性。

### 限制
極小 observation probability 會造成 extreme weights、variance explosion；scikit-survival 的 zero-probability guard 只能防 `Ghat=0`，不能解決 near-zero variance instability。

### 來源
- scikit-survival source: https://github.com/sebp/scikit-survival/blob/main/sksurv/nonparametric.py
- HAPS 2026 使用 IPCW 處理 time-varying censoring: https://arxiv.org/abs/2605.06581

**狀態：工程實作 + 論文結果已交叉驗證。**

---

## 4. `IPCW Estimate` 仍然不等於 `Anytime-Valid E-Process`

### 概念
這是本輪最重要的 sequential gap。

離線/固定 horizon 可以計算：

```text
X_i^IPCW
= R_i Y_i / p_i
```

但 Hermes 若要持續 monitoring，需要更強的 predictable construction。

### Sequential candidate
在 admission time `t`，先用 `F_{t-1}` freeze：

```text
p_hat_t
= P(feedback will be observed | H_t; F_{t-1})

λ_t
= predictable bet
```

只有在 feedback observation mechanism 的條件期望假設成立時，才能嘗試構造：

```text
X_t
=
R_t / p_hat_t × residual_t
```

並要求：

```text
E[X_t | F_{t-1}] ≤ 0
```

之後才有資格進：

```text
betting factor
→ nonnegative supermartingale
→ e-process
→ permission certificate
```

### 為什麼重要
不能做：

```text
先看到哪些 feedback 回來
↓
事後 fit observation model
↓
同批資料重新加權
↓
直接宣稱 anytime-valid
```

因為 observation model / nuisance estimate 自身也必須符合 predictability / sample-splitting / theorem contract。

### 限制
本輪沒有找到一個可以直接套用到一般 Agent arbitrary informative delay 的 production-ready `IPCW e-process` theorem。因此：

```text
CensoringAwareEProcess
```

目前仍是 research gap，而不是已確認 capability。

### 來源
- Ramdas et al., *Admissible anytime-valid sequential inference must rely on nonnegative martingales*: https://arxiv.org/abs/2009.03167
- HAPS / IPCW literature only supplies censoring-adjusted fixed/asymptotic inference in its own stated regime，不能自動升級成 e-process。

**狀態：重要否定結論已確認；generic Agent construction 尚未驗證。**

---

## 5. Agent Permission 應考慮「未觀察 outcome 的選擇偏誤」，而不只是 pending 數量

### 概念
上一輪提出：

```text
PendingEvidenceRiskBudget
```

本輪把它升級為：

```text
FeedbackSelectionRiskBudget
├ pending_count
├ outcome_observation_probability
├ estimated_censoring_hazard
├ informative_delay_status
├ effective_sample_size
├ extreme_weight_mass
├ silent_success_hypothesis
├ silent_failure_hypothesis
├ unidentifiable_mass
└ permission_escalation_allowed
```

### 為什麼重要
假設：

```text
READ_MCP
1000 次
feedback 回來 950 次

WRITE_EXTERNAL
100 次
feedback 只回來 20 次
```

不能因為：

```text
20/20 都沒人抱怨
```

就認為 external write 安全。

若 external write 的 feedback channel 本身高度 censored，應降低 permission confidence。

### 與 probabilistic feedback 的關係
Dai et al. 顯示不同 feedback probability 可改變 online algorithm 對不同 arms 的 engagement，即便 learner 是 no-regret。這支持 Hermes 把：

```text
feedback visibility
```

視為 policy-dynamics 的一部分，而不是單純 observability metadata。

### 限制
這個 risk budget 是 Hermes architecture 提案，不是該論文提供的 safety theorem。

**狀態：論文事實 + 合理工程推論。**

---

# Architecture Breakdown

本輪提出：

# **Censoring-Aware Feedback Evidence Runtime**

```text
Agent Action / Tool / MCP / External Write
↓
Outcome Obligation Created
↓
Latent Outcome Process
├ success
├ failure
├ partial consequence
└ unresolved
↓
Feedback Observation Process
├ immediate callback
├ delayed callback
├ human reply
├ passive telemetry
├ settlement
└ never observed
↓
Observation / Censoring Hazard Model
↓
Informative-Delay Gate
├ NON_INFORMATIVE_GIVEN_HISTORY
├ ACTION_DEPENDENT
├ STATE_DEPENDENT
├ OUTCOME_DEPENDENT_SUSPECTED
├ SELF_CENSORING
└ UNRESOLVED
↓
Positivity / Support Gate
↓
Correction Router
├ NO_CORRECTION
├ IPCW
├ AUGMENTED / DOUBLY ROBUST
├ SENSITIVITY_ANALYSIS
└ UNIDENTIFIABLE
↓
Fixed-Horizon Evidence
or
Sequential-Evidence Constructor
↓
Feedback Selection Risk Budget
↓
Permission Gate
├ ALLOW
├ VERIFY
├ WAIT_FOR_MATURITY
├ ACTIVE_QUERY
├ SIMULATE_ONLY
└ BLOCK
```

---

# Bottom-Level Logic

## 1. Outcome 與 Observation 要分開

```text
Y_i
= latent outcome

R_i(t)
= 1 if Y_i observable by time t
```

Agent 真正看到的是：

```text
O_i(t)
=
R_i(t) × Y_i
```

但 `R_i(t)` 可能不是 random。

---

## 2. Censoring / feedback hazard

可建：

```text
h_R(t | H_t, A, Z)
=
P(feedback arrives at t | not arrived before t, history)
```

並從 hazard 得 observation survival：

```text
G(t | H)
=
P(feedback not yet observed through t | H)
```

Agent 所需的不是單一：

```text
average delay = 3.2s
```

而是：

```text
P(feedback observable by maturity horizon | action, state, channel, epoch)
```

---

## 3. IPCW correction

當 identifying assumptions 成立：

```text
weighted residual
≈
R_i / p_i × residual_i
```

讓低 observation probability 的已觀察 case 代表更多未觀察同類 case。

但若：

```text
p_i → 0
```

則：

```text
weight → ∞
variance → unstable
```

所以必須同時監控：

```text
max_weight
effective_sample_size
tail regime
positivity
```

---

## 4. Self-censoring

最危險情況：

```text
Y
→ R
```

例如：

```text
使用者只有非常不滿意才會回覆
```

此時就算知道 action / context，`R` 仍直接包含 outcome-dependent selection。

如果沒有額外 instrument / shadow variable / structural assumption：

```text
full outcome distribution
```

可能無法識別。

Hermes 必須允許輸出：

```text
UNIDENTIFIABLE
```

而不是永遠強迫產生 confidence score。

---

# Visual Simulation Idea

# **Feedback Censoring × Selection Bias × Evidence Weight Lab**

畫面左側：真實但部分不可見的 outcome：

```text
100 Agent Actions

True world:
SUCCESS 70
FAILURE 30
```

中間加入 feedback observation mechanism：

```text
Success feedback probability = .20
Failure feedback probability = .90
```

Console 顯示實際可見：

```text
Observed success ≈ 14
Observed failure ≈ 27

Naive observed success rate
= 14 / 41
≈ 34%
```

而真實 success rate 是 70%。

使用者可調：

```text
feedback probability
feedback delay
outcome dependence
weight clipping
maturity horizon
```

右側即時顯示：

```text
Naive estimate
IPCW estimate
Effective sample size
Max weight
Positivity warning
Identifiability status
Permission state
```

第二個模式可反過來模擬：

```text
Successes silently disappear
Failures always complain
```

讓使用者直觀看懂：

> 「沒有抱怨」和「沒有失敗」是兩件完全不同的事。

再增加 sequential panel：

```text
time
↓
pending outcomes
↓
feedback arrivals
↓
observation hazard estimate
↓
IPCW-adjusted evidence
↓
wealth / CS（只有 theorem regime 合法時啟用）
```

---

# Code / GitHub

## sebp/scikit-survival
Repository:
https://github.com/sebp/scikit-survival

### 值得看的核心檔案

```text
sksurv/nonparametric.py
├ CensoringDistributionEstimator
└ predict_ipcw

sksurv/metrics.py
└ censoring-adjusted evaluation metrics
```

### `predict_ipcw()` 核心邏輯

```python
Ghat = self.predict_proba(time[event])
if (Ghat == 0.0).any():
    raise ValueError(...)
weights[event] = 1.0 / Ghat
```

### Hermes 可借用的工程思想
不是直接複製 survival API，而是借它的 invariant：

```text
1. censoring distribution 是一級模型
2. 每個 observation 有 censoring weight
3. support/positivity failure 必須 fail loudly
4. correction metadata 必須與 metric / evidence 綁定
```

### 不可直接照搬之處
scikit-survival 的 IPCW API 是 survival-analysis / fixed-dataset runtime；它沒有：

```text
admission-time filtration
online feedback hazard update
predictable nuisance freeze
revision-safe e-process
certificate supersession
Agent permission gate
```

所以它是底層 correction primitive，不是完整 Agent evidence runtime。

---

# Papers

## 1. History-Aware Conformal Prediction Sets for Censored Time-to-Event Outcomes
- **Authors:** Yuyao Wang, Alexander W. Levis, Shu Yang, Larry Han
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.06581
- **Code:** 本輪未確認官方可檢查 runtime repo
- **Dataset:** 論文報告包含兩個 public benchmark datasets
- **Architecture:** time-varying history → censoring model/IPCW → conformal prediction set；並提供 doubly robust extensions
- **Contribution:** 把 prediction-at-decision-time 與 history-aware right censoring correction 結合
- **Limitations:** 保證依賴 censoring-weight consistency / 所述 asymptotic regime；不能直接當 generic Agent e-process
- **改變了什麼:** 讓「尚未發生或尚未觀察到 outcome」可在 prediction set 中被正式建模，而不是忽略 censored samples

## 2. Can Probabilistic Feedback Drive User Impacts in Online Platforms?
- **Authors:** Jessica Dai, Bailey Flanigan, Nika Haghtalab, Meena Jagadeesan, Chara Podimata
- **Institution:** 多機構合作；AISTATS 2024
- **Year:** 2024
- **URL:** https://proceedings.mlr.press/v238/dai24b.html
- **Code:** 本輪未確認官方 code
- **Dataset:** 主要為理論 online-learning setting
- **Architecture:** multi-armed bandit + arm-dependent probabilistic feedback
- **Contribution:** feedback probability 的差異本身能改變 learner engagement 與 downstream impacts
- **Limitations:** 不是 Agent safety / sequential inference theorem
- **改變了什麼:** 證明「feedback visibility」不是 neutral data-pipeline detail，而是 learning dynamics 的一部分

## 3. Causal inference with outcome-dependent missingness and self-censoring
- **Authors:** Jacob M. Chen, Daniel Malinsky, Rohit Bhattacharya
- **Year:** 2023
- **Venue:** UAI
- **URL:** https://proceedings.mlr.press/v216/chen23f.html
- **Architecture:** outcome-dependent missingness graph + randomized incentive/shadow-variable style identification test
- **Contribution:** 處理 outcome 直接影響自身 missingness 的 self-censoring
- **Limitations:** 需要額外 identification assumptions / variables；不能無條件恢復 missing outcomes
- **改變了什麼:** 告訴 Agent runtime 必須允許 `UNIDENTIFIABLE`，不能把所有 missing feedback 都視為 MAR

## 4. Mirror Online Conformal Prediction with Intermittent Feedback
- **Authors:** Bowen Wang, Matteo Zecchin, Osvaldo Simeone
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2503.10345
- **Architecture:** online conformal calibration + intermittent feedback + mirror-style update
- **Contribution:** intermittent feedback 下維持 long-run coverage / regret properties
- **Limitations:** intermittent feedback regime 不等同 outcome-dependent censoring
- **改變了什麼:** 提供「有些回合沒有 feedback」時 calibration runtime 的參考，但不能取代 censoring model

## 5. Adaptive Conformal Inference Under Delayed Feedback
- **Authors:** Lama El Halabi, Adam Brandt
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2609.07251
- **Architecture:** delayed ACI recursion → τ interleaved sequences
- **Contribution:** 顯式把 fixed delay 與 residual memory time scale 關聯
- **Limitations:** 固定/結構化 delay；不解 outcome-dependent missingness
- **改變了什麼:** 幫助本研究把「delay」與「censoring/selection」正式拆成兩個不同問題

---

# 已確認事實 / 論文結果 / 工程實作 / 推論 / 假說分層

## 已確認事實
- Censoring / missingness 若依 outcome 或與 outcome 共享 predictors，naive complete-case analysis 可偏誤。
- IPCW 需要 observation/censoring probability，且 positivity/support 是必要風險點。
- Feedback rate differences 可以改變 online learning dynamics。
- Anytime-valid sequential inference 不能因為用了 IPCW 名稱就自動成立；仍需 martingale / e-process contract。

## 官方 / 工程實作
- scikit-survival 實作 censoring distribution estimator 與 IPCW；`Ghat=0` 時拒絕計算。

## 論文結果
- HAPS 報告 history-aware censored conformal intervals 在其實驗中顯著縮短 interval，同時接近 nominal coverage；這是其設定下的實驗結果，不可泛化為任意 Agent feedback。
- Dai et al. 證明 probabilistic feedback rates 可影響 no-regret online algorithms 的 engagement behavior。

## 合理工程推論
- Hermes 應新增 `FeedbackObservationModel`、`FeedbackIPCWCertificate` 與 `FeedbackSelectionRiskBudget`。
- Permission escalation 應因高 censoring / low observability 降級。

## 尚未驗證假說
- 可以為 arbitrary outcome-dependent Agent feedback 建一個通用、practical、revision-safe `CensoringAwareEProcess`。
- `FeedbackObservationHazard × e-process` 可在 model-assisted nuisance estimation 下保持實務可用的 finite-sample anytime validity。

---

# Unknown / Open Questions 1-3

## 1. Informative Delay 與 Censoring 的 sequential identification boundary
如果：

```text
feedback arrival time
```

不只是 missingness，而是 outcome-dependent continuous random variable，應用 counting-process martingale、IPCW 還是 joint outcome-arrival likelihood 比較自然？目前未收斂。

## 2. Revision-safe censoring model
如果 `Ghat` 後來因 delayed truth / corrected metadata 更新，舊 IPCW sequential increments 是否必須像上一輪一樣 fork evidence epoch？大概率需要，但 generic theorem boundary 尚未建立。

## 3. Active feedback solicitation
Agent 若主動：

```text
ASK_USER "剛剛有成功嗎？"
```

會改變 observation process。此時 feedback acquisition 本身是 action，需和 policy / propensity / cost 一起建模，不能把它當被動 sensor。

---

# 下一輪研究

下一輪已收斂到：

# **Active Feedback Acquisition × Query Policy × Verification as Action × Value of Information × Observation-Policy Counterfactual**

研究鏈：

```text
Action executed
↓
Outcome latent
↓
Feedback may be censored
↓
Agent chooses whether to query / verify
↓
Observation propensity now action-dependent
↓
Cost of verification
↓
Value of information
↓
Belief update
↓
OPE / counterfactual evaluation of verification policy
↓
Permission escalation
```

要回答：

```text
什麼時候 AI 應該主動查證？
查證誰？
用哪個 modality / tool？
查證成本與風險怎麼權衡？
如果 Agent 只對自己沒把握的 case 查證，新的 feedback 還能怎麼校準？
```

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Feedback Observation Process
Feedback Censoring Process
Feedback Observation Hazard
Feedback Censoring Hazard
Informative Delay
Non-Informative Delay
Outcome-Dependent Feedback
Self-Censoring Feedback
Feedback Missingness Regime
Feedback Observation Model
Feedback Positivity
Feedback Support
IPCW
Feedback IPCW
FeedbackIPCWCertificate
Extreme Censoring Weight
Censoring Effective Sample Size
Observation Probability
Feedback Selection Bias
FeedbackSelectionRiskBudget
Silent Success
Silent Failure
Intermittent Feedback
Missing-Outcome Evidence
Censoring-Aware Evidence
CensoringAwareEProcess
Observation-Model Nuisance
Observation-Model Predictability
Unidentifiable Feedback Regime
```

## 新增關係

```text
Latent Outcome
→ may influence → Feedback Observation Process

Feedback Observation Process
→ determines → Observed Feedback

History
→ conditions → Censoring Hazard

Observation Probability
→ determines → IPCW

Near-Zero Observation Probability
→ causes → Extreme Weight

Extreme Weight
→ reduces → Effective Sample Size

Feedback Selection Bias
→ can distort → Agent Policy Evaluation

Outcome-Dependent Feedback
→ violates → Naive Missing-at-Random Assumption

Censoring-Aware Evidence
→ may constrain → Permission Gate
```

## 重要否定 Edges

```text
No Feedback Yet
≠ No Failure

No Complaint
≠ Success

Pending Feedback
≠ Randomly Missing Feedback

Delay
≠ Censoring

Intermittent Feedback
≠ Outcome-Independent Missingness Automatically

IPCW Estimate
≠ Anytime-Valid E-Process

Estimated Observation Probability
≠ True Observation Probability

Ghat > 0
≠ Low-Variance Correction

Observed Feedback Distribution
≠ Outcome Distribution

More Feedback
≠ Less Selection Bias Automatically

Feedback Missingness
≠ Ignorable Missingness Automatically
```

---

# 本輪結束判定

- **缺哪一層：** `Informative Censoring → Sequential Evidence → Permission` 的 theorem/runtime bridge。
- **哪個節點最淺：** `CensoringAwareEProcess`、`ObservationModelPredictability`、`RevisionSafeIPCW`、`ActiveFeedbackAcquisition`。
- **哪個概念仍只是名詞：** generic production 級 `CensoringAwareEProcess`；目前不能宣稱已解。
- **哪個系統值得讀原始碼：** `sebp/scikit-survival`，優先 `sksurv/nonparametric.py` 與 `sksurv/metrics.py`。
- **哪篇論文需追引用：** HAPS 2026（time-varying censoring + conformal）以及 Dai et al. 2024（probabilistic feedback dynamics）。
- **哪個概念最適合視覺模擬：** `Feedback Censoring × Selection Bias × Evidence Weight Lab`。
- **哪個 Agent 架構最值得實作：**

```text
Outcome Obligation Registry
↓
Feedback Observation Model
↓
Informative-Delay / Censoring Gate
↓
IPCW / Sensitivity Router
↓
Feedback Selection Risk Budget
↓
Permission Gate
```

---

# 對「AI 到底怎麼運作」新增的一層

真正長期運作的 AI 不只是：

```text
Action
→ 等 feedback
→ 收到 feedback
→ 學習
```

而是：

```text
Action
↓
World 產生 latent outcome
↓
另一個 observation process 決定這個 outcome
是否、何時、透過哪個 channel 被 AI 看見
↓
AI 只在被選擇後的 outcome 子集合上學習
```

因此，**「AI 看到了什麼」不只是 sensor 問題，也是 selection mechanism 問題。** 如果失敗比成功更容易被回報，或高風險 action 的 truth 比低風險 action 更慢出現，那 feedback stream 本身就是 biased sensor。下一階段 Hermes 要做的不只是記錄 feedback，而是把「feedback 為什麼會出現」也變成可建模、可校準、可驗證的 runtime object。