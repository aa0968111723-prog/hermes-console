# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 18:54（Asia/Taipei）**  
**主題：Delayed Feedback × Selective Labels × Verification Bias × Bitemporal Calibration Repair × Partial-Feedback Conformal Control**

---

## 0. 與歷史研究比較：本輪不重複什麼

上一輪已完成：

```text
World/Twin uncertainty
→ Sequential conformal monitor
→ Action-conditional risk
→ Selective acting
→ Value-of-verification
→ Real verification
→ Twin / calibration update
```

上一輪回答的是：

> 「Agent 不夠確定時，應不應該行動？如果要查真實世界，哪一次查詢最值得？」

本輪往下一層追：

> 「如果只有被 Agent 主動挑中驗證的案例才有標籤，而且 outcome 可能晚幾分鐘、幾小時甚至幾天才回來，校準器還能把這些 labels 當成 unbiased、current ground truth 嗎？」

答案是：**不能直接這樣做。**

這一輪新增的是：

```text
Selective Verification
+
Delayed Outcome
+
Observation-Time / Event-Time mismatch
↓
Biased calibration stream
↓
Bitemporal label ledger
↓
Delay-aware + selection-aware calibration repair
```

---

# 本小時新發現

## 新論文 / 新架構 / 新程式碼

### 1. Adaptive Conformal Inference Under Delayed Feedback: Coverage Guarantees and a Delay-to-Memory Diagnostic

- **Authors:** Lama El Halabi, Adam Brandt
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2609.07251
- **Date:** 2026-09-07
- **Architecture:** delayed ACI recursion → τ interleaved ACI-like sequences → finite-sample long-run coverage analysis
- **Contribution:** 提出 delay-to-memory ratio `r = τ / L`，其中 τ 是 feedback delay，L 是 residual process 的記憶時間尺度；delay 的危害應相對於「舊資訊還有用多久」理解，而不是只看延遲秒數。
- **Limitations:** ratio 在 AR(1) 下最有組織力；在 GARCH / Markov switching 等動態中對整體 performance 的解釋力較弱，不能視為 universal scalar。

### 2. Online Conformal Prediction Beyond Feedback

- **Authors:** Joar Skalse, Edoardo Pona, Osvaldo Simeone, Nicola Paoletti
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2608.07139
- **Architecture:** partial monitoring game；每輪二選一：`PREDICT` 或 `QUERY_LABEL`
- **Contribution:** OCPQ 在 deployed prediction 永遠沒有直接 label feedback 的情況下，仍能以 query action 取得稀疏 labels，並提供 expected coverage / regret guarantees。
- **Limitations:** 它處理的是理論化 partial-monitoring protocol；真實 Agent 的 label availability、cost、delay、selection policy、side-effect safety 會更複雜。

### 3. Online Conformal Prediction with Adversarial Semi-bandit Feedback via Regret Minimization

- **Authors:** Junyoung Yang, Kyungmin Kim, Sangdon Park
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2604.17984
- **Architecture:** candidate prediction sets as bandit arms；label 僅在部分 feedback channel 中可觀察
- **Contribution:** 把 partial feedback conformal calibration 明確連接到 adversarial bandit regret。
- **Limitations:** partial label protocol 仍比 Agent 的 self-selected verification stream 乾淨；selection propensity 本身若未知或 model-dependent，還要額外處理。

### 4. Stochastic Online Conformal Prediction with Semi-Bandit Feedback

- **Authors:** Haosen Ge, Hamsa Bastani, Osbert Bastani
- **Institution:** University of Pennsylvania（paper author affiliations）
- **Year:** ICML 2025
- **URL:** https://proceedings.mlr.press/v267/ge25a.html
- **Architecture:** online conformal + semi-bandit feedback；true label 只有在特定 prediction-set event 下可見
- **Contribution:** 證明在 partial feedback 下仍可追求 calibrated set quality，且取得 sublinear regret。
- **Limitations:** selection mechanism 被 protocol 明確定義；若 Hermes 的 verification policy 自己持續變動，必須紀錄 policy/propensity version。

### 5. CAP: A General Algorithm for Online Selective Conformal Prediction with FCR Control

- **Authors:** Yajie Bao, Yuyang Huo, Haojie Ren, Changliang Zou
- **Year:** JMLR 2025
- **URL:** https://www.jmlr.org/beta/papers/v26/24-0452.html
- **Architecture:** adaptive selection → selection-aware calibration-set construction → conformal interval → online FCR control
- **Contribution:** 明確指出「先 selection、再報 interval」會改變 inference target；CAP 針對被選中的 units 做 selection-conditional coverage / FCR control。
- **Limitations:** 它研究 prediction selection，不等同於「只對高風險 Agent action 查 ground truth」，但其 selection-aware calibration principle 可直接借鑑。

### 6. DEFUSE：Asymptotically Unbiased Estimation for Delayed Feedback Modeling via Label Correction

- **Authors:** Yu Chen et al.
- **Year:** 2022
- **Paper:** https://arxiv.org/abs/2202.06472
- **Code:** https://github.com/ychen216/DEFUSE
- **Dataset / domain:** delayed conversion feedback（Criteo-style streaming CVR）
- **Architecture:** stream dataset → immediate/delayed/fake-negative decomposition → auxiliary delay models → importance/label correction → online-ish stream training
- **Contribution:** 不把尚未轉換的 delayed positives 一律當真 negative，而是顯式估計 fake-negative structure，再修正 loss weighting。
- **Limitations:** 廣告 CVR 的 delayed-label mechanism 比 general Agent outcome 簡單；仍很適合當「pending outcome 不能立即寫死為 failure」的工程參考。

---

# 本小時最重要 5 個發現

## 1. Pending Label ≠ Negative Label

### 已確認事實

Delayed feedback 問題的核心，不是「label 晚到」而已，而是系統很容易把：

```text
NOT YET OBSERVED
```

錯寫成：

```text
NEGATIVE / FAILURE
```

DEFUSE 的 loss 實作不是只有 README 概念。`src/loss.py` 實際拆出 delayed-positive / fake-negative / real-negative 權重；`unbiased_defuse_loss()` 會用 `tn_logits`、`dp_logits` 估計 delayed/fake-negative structure，再組成不同 loss components，而不是把 observed zero 直接當真 negative。

Hermes 對 Agent action outcome 應採：

```text
OutcomeStatus
├ PENDING
├ PROVISIONAL_SUCCESS
├ PROVISIONAL_FAILURE
├ FINAL_SUCCESS
├ FINAL_FAILURE
├ CENSORED
└ UNKNOWN
```

而不能：

```text
no feedback yet
→ failure = 1
```

### Agent 例子

```text
18:00 send_email()
18:01 no reply
```

不能推出：

```text
email failed
```

同理：

```text
payment pending
human review pending
browser conversion pending
long-running MCP job pending
```

都必須保留 censoring / pending semantics。

### 新 Knowledge Edge

```text
Missing Outcome
≠ Negative Outcome

Delayed Outcome
≠ Failed Action
```

---

## 2. Delay 的危害取決於「delay / memory」，不是只看 delay 長度

最新 2026-09-07 delayed ACI 論文提出：

```text
r = τ / L
```

其中：

- `τ` = label / outcome delay
- `L` = residual / environment dependency 的有效記憶時間尺度

這對 Hermes 很重要。

例如同樣延遲 10 分鐘：

```text
System A: world changes every 5 seconds
→ 10 min label 很舊

System B: state stable for 2 days
→ 10 min label 幾乎即時
```

所以應新增：

```text
DelayMemoryDiagnostic
├ feedback_delay
├ environment_memory_scale
├ delay_to_memory_ratio
├ calibration_age
└ expected_staleness
```

### Bottom-level decomposition

```text
Prediction / Action at t_event
↓
Outcome occurs at t_valid
↓
Outcome becomes observable at t_observed
↓
Calibration update at t_system
```

四個時間點不可混成一個 timestamp。

### 新 Knowledge Edge

```text
Long Wall-Clock Delay
≠ High Calibration Damage

Calibration Damage
DEPENDS_ON
Delay / Environment Memory
```

---

## 3. Selective Verification 會創造 Selective Labels：越只查危險案例，越不能把已查資料當全體代表

上一輪提出：

```text
VERIFY_FIRST
→ choose highest-value verification query
```

但這會造成新的閉環：

```text
Agent uncertainty / risk
↓
Verification policy
↓
Only some outcomes observed
↓
Calibration dataset
↓
Future risk estimate
↓
Verification policy
```

所以 labeled stream 不再是自然抽樣，而是由 Agent 自己的 policy 生成。

Selective-label literature 的核心問題正是：outcome observation 是既有 decision 的結果；因此 labeled subset 可以和 full deployment population 顯著不同。Online selective-label decision research 甚至指出 exploration 本身是必要的 learning action，而不是資料收集的附屬品。

Hermes 應讓每個 ground-truth observation 同時保存：

```text
VerificationRecord
├ case_id
├ verification_policy_id
├ verification_policy_version
├ query_probability / propensity
├ query_reason
├ risk_before_query
├ action_family
├ state_region
├ query_cost
├ event_time
├ observed_time
└ label
```

### 如果 propensity 不記錄

未來你只看到：

```text
500 verified samples
```

卻不知道：

```text
它們是不是全部來自最高風險 1%
```

那 calibration accuracy 很可能只是「在被挑中的世界」成立。

### 新 Knowledge Edge

```text
Verified Dataset
≠ Deployment Population

High Verification Quality
≠ Unbiased Calibration Stream
```

---

## 4. Partial feedback 不是 calibration failure；但 calibration algorithm 必須明確知道「哪些 labels 永遠看不到」

OCPQ、semi-bandit OCP 與 intermittent-feedback OCP 都在告訴同一件事：

```text
Full feedback
```

不是 online calibration 的唯一可行形式。

真正重要的是 protocol 要被模型化：

```text
Which round can reveal label?
Why was label revealed?
Was reveal probability known?
Was prediction deployed or query substituted?
```

Hermes 可以把 calibration feedback channel 正式分成：

```text
FeedbackMode
├ FULL
├ DELAYED_FULL
├ INTERMITTENT
├ SEMI_BANDIT
├ QUERY_ONLY
├ SELECTIVE_VERIFY
└ CENSORED
```

然後禁止所有模式共用同一個 naïve updater。

### 新 Runtime Rule

```text
if feedback_mode == FULL:
    ordinary online update

elif feedback_mode == DELAYED_FULL:
    delay-aware update + late repair

elif feedback_mode in {SEMI_BANDIT, SELECTIVE_VERIFY, QUERY_ONLY}:
    selection-aware / propensity-aware updater
```

### 重要否定關係

```text
No Immediate Label
≠ No Possible Calibration Guarantee

Partial Feedback
≠ Full Feedback With Missing Rows Dropped
```

---

## 5. Late ground truth 應修復「當時版本」的 calibration state，而不是只更新現在

這一點和前幾輪建立的 bitemporal state、event-time repair 正式接起來。

例如：

```text
18:00 Action A issued
18:00 Risk estimate = .04
18:00 Agent ACT

18:40 Ground truth arrives: FAILURE
```

如果 calibration runtime 只做：

```text
current_calibrator.update(failure)
```

會遺失一個更重要的問題：

> 18:00 那一刻的 calibration model，如果知道這筆 ground truth，本來應該長什麼樣？從 18:00 到 18:40 之間哪些 certification / action decisions 受影響？

因此 Hermes 應採：

```text
CalibrationEvent
├ prediction_id
├ action_id
├ valid_time
├ observed_time
├ system_time
├ label_status
├ label_revision
├ selection_propensity
├ calibrator_version_at_prediction
└ policy_version_at_prediction
```

Late label 到達時：

```text
Late Ground Truth
↓
Locate original prediction event
↓
Reconstruct calibrator-at-that-time
↓
Apply event-time correction
↓
Forward repair affected calibration states
↓
Check certification divergence
↓
Flag historically affected actions
```

這是 **Bitemporal Calibration Repair**。

### 新 Knowledge Edge

```text
Late Label Update
≠ Current-State-Only Update

Observed Time
≠ Outcome Valid Time
```

---

# Architecture Breakdown

```text
User / Goal
↓
Agent Planner
↓
Proposed Action
↓
Risk / Uncertainty / Twin
↓
Selective Action Gate
├ ACT
├ VERIFY_FIRST
├ ABSTAIN
└ BLOCK
↓
Verification Policy
↓
Verification Selection Record
├ propensity
├ reason
├ policy version
└ state region
↓
Outcome Lifecycle Ledger
├ PENDING
├ PROVISIONAL
├ FINAL
└ CENSORED
↓
Delayed Ground Truth Ingest
↓
Bitemporal Label Store
├ valid_time
├ observed_time
└ system_time
↓
Feedback-Mode Router
├ delayed-full updater
├ intermittent updater
├ semi-bandit updater
└ selection-aware updater
↓
Calibration State Repair
↓
Action-Conditional Risk Model
↓
Certification Divergence Detector
↓
Historical Impact Graph
↓
Replan / repair / policy update
```

---

# Bottom-Level Logic

## A. Delay-aware label state machine

```text
ACTION_ISSUED
↓
PENDING
↓
PROVISIONAL_LABEL? ── no ──→ still pending
↓ yes
PROVISIONAL
↓
FINAL_LABEL ARRIVES
↓
FINAL
```

禁止：

```text
PENDING → NEGATIVE
```

除非 domain semantics 明確保證 timeout 本身就等於 failure。

## B. Selection-aware calibration sample

傳統 updater：

```text
loss(y, ŷ)
```

selection-aware conceptual form：

```text
observed_i ~ Bernoulli(π_i)

weighted contribution
≈ observed_i / π_i × loss_i
```

但這裡必須保留限制：

- propensity `π_i` 若估錯，inverse weighting 可能高 variance / biased；
- unobserved confounding 可能讓簡單 IPS 不足；
- CAP / semi-bandit conformal 與 classic IPS 的 guarantees 不可混寫。

所以 Hermes 應保存 estimator type：

```text
SelectionCorrection
├ NONE
├ KNOWN_PROPENSITY
├ ESTIMATED_PROPENSITY
├ DOUBLY_ROBUST
├ SEMI_BANDIT_ALGORITHM
└ NOT_IDENTIFIED
```

## C. Bitemporal calibration replay

```text
label.valid_time = when outcome became true
label.observed_time = when system received evidence
label.system_time = when event was committed
```

late correction：

```text
insert(label @ valid_time)
↓
find calibrator snapshot before valid_time
↓
replay calibration updates in event-time order
↓
compare old/new risk bounds
↓
find certification flips
```

## D. Delay-to-memory gate

```text
r = delay / effective_memory
```

Hermes engineering interpretation：

```text
r << 1
→ delay likely tolerable

r ≈ 1
→ adaptation quality sensitive

r >> 1
→ old residual signal may be stale
```

這是工程 heuristic；不可宣稱這三個區間是論文提供的 universal thresholds。

---

# Code / GitHub

## DEFUSE — https://github.com/ychen216/DEFUSE

### 值得看的目錄

```text
src/
├ data.py
├ loss.py
├ main.py
├ metrics.py
├ models.py
├ pretrain.py
├ stream_train_test.py
└ utils.py
```

### 核心檔案

#### `src/loss.py`

值得看：

- `unbiased_fnw_loss()`
- `delay_tn_importance_weight_loss()`
- `unbiased_defuse_loss()`
- `unbiased_defer_loss()`

實際 code 把 delayed/fake-negative probabilities 放入不同 positive / negative loss weights，並大量使用 `stop_gradient()` 將 weighting signal 與主 classifier gradient 解耦。

#### `src/stream_train_test.py`

stream loop 實際是：

```text
get_criteo_dataset_stream
↓
for each time chunk
↓
construct delayed labels / in-window labels
↓
load auxiliary delay model
↓
train classifier
↓
test current chunk
↓
moving metrics
```

`DEFUSE / ES-DFM` 路徑會先用 auxiliary `esdfm` model 產生 `tn_logits` / `dp_logits`，再把這些 signals 注入 main loss。

### 對 Hermes 的價值

不是直接搬 CVR model，而是搬這個 abstraction：

```text
Observed label stream
≠ Ground-truth label stream

Need explicit latent label-status model
```

---

# Papers

## A. Adaptive Conformal Inference Under Delayed Feedback

- **Authors:** Lama El Halabi, Adam Brandt
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2609.07251
- **Code:** 本輪未確認官方 code
- **Dataset:** simulations with multiple temporal dependency regimes
- **Architecture:** τ-delayed ACI as τ interleaved recursions
- **Contribution:** finite-sample long-run coverage dependence on delay；delay-to-memory diagnostic
- **Limitations:** diagnostic strength depends on residual dynamics
- **改變了什麼:** 把「delay」從單純 latency 問題提升成「feedback latency 相對於 environment memory」的 calibration problem。

## B. Online Conformal Prediction Beyond Feedback

- **Authors:** Joar Skalse, Edoardo Pona, Osvaldo Simeone, Nicola Paoletti
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2608.07139
- **Code:** 本輪未確認官方 code
- **Architecture:** partial monitoring；predict vs query
- **Contribution:** deployed prediction 無 feedback 仍可藉 sparse label queries 維持 expected coverage guarantees
- **Limitations:** protocol idealized；未直接解 Agent-side delayed external effects
- **改變了什麼:** 說明「沒有每輪 label」不代表校準只能放棄；必須改 protocol / learner。

## C. Online Conformal Prediction with Adversarial Semi-bandit Feedback via Regret Minimization

- **Authors:** Junyoung Yang, Kyungmin Kim, Sangdon Park
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2604.17984
- **Architecture:** conformal prediction as adversarial bandit with partial label feedback
- **Contribution:** partial-feedback long-run coverage via regret connection
- **Limitations:** selection feedback model比 general Agent verification policy 更受控
- **改變了什麼:** 讓 Hermes 可把「feedback availability」當 runtime protocol，而非資料缺失 exception。

## D. Stochastic Online Conformal Prediction with Semi-Bandit Feedback

- **Authors:** Haosen Ge, Hamsa Bastani, Osbert Bastani
- **Year:** 2025
- **URL:** https://proceedings.mlr.press/v267/ge25a.html
- **Architecture:** stochastic semi-bandit OCP
- **Contribution:** partial label observability 下仍可學 calibrated prediction sets
- **Limitations:** explicit semi-bandit protocol；不能直接替代 self-selected verification correction

## E. CAP

- **Authors:** Yajie Bao, Yuyang Huo, Haojie Ren, Changliang Zou
- **Year:** 2025
- **URL:** https://www.jmlr.org/beta/papers/v26/24-0452.html
- **Architecture:** adaptive pick → adaptive historical calibration set → selected conformal interval
- **Contribution:** selection-conditional online predictive inference / FCR control
- **Limitations:** selection of prediction targets ≠ selection of external ground-truth queries；但 principle 高度相關

---

# Visual Simulation Idea

## Delayed Feedback × Selective Label Calibration Lab

### View 1：Outcome timeline

```text
18:00 Action A ───────────────────────────────┐
      prediction=.96                          │
      risk=.03                                │
      ACT                                     │
                                               │
18:12 provisional signal: success ?            │
                                               │
18:47 FINAL: failure ◄─────────────────────────┘
```

同時顯示三條時間軸：

```text
EVENT / VALID TIME
OBSERVED TIME
SYSTEM / CALIBRATION TIME
```

### View 2：Selection map

所有 deployed actions 畫成點：

```text
○ = no label
● = actively verified
▲ = naturally observed
□ = delayed final label
```

旁邊顯示：

```text
Deployment cases        12,840
Labels observed          1,146
Actively verified          384
High-risk among labels      71%
High-risk in population      9%
```

UI 直接提示：

```text
SELECTION SHIFT DETECTED
verified set is not representative of deployment stream
```

### View 3：Calibration before / after late repair

```text
18:00 historical risk bound   .04
18:47 label arrives           FAILURE

Repaired historical bound    .09
Action threshold              .05

CERTIFICATION FLIP
ACT → VERIFY_FIRST
```

並把 18:00–18:47 之間依賴舊 calibrator 的 actions 標紅。

### View 4：Delay-to-memory

```text
feedback delay τ        47 min
environment memory L    18 min
ratio τ/L               2.61
```

顯示：

```text
staleness risk: HIGH
```

但 UI 必須標註這是 system heuristic / diagnostic，而非 universal theorem threshold。

---

# Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Delayed Feedback
Pending Label
Provisional Label
Final Label
Censored Outcome
Fake Negative
Feedback Delay
Environment Memory Scale
Delay-to-Memory Ratio
Selective Label
Verification Selection
Verification Propensity
Verification Policy Version
Feedback Mode
Semi-Bandit Feedback
Query-Only Feedback
Intermittent Feedback
Selection-Aware Calibration
Selection-Conditional Coverage
Bitemporal Calibration Event
Calibration Valid Time
Calibration Observed Time
Calibration System Time
Late Label Repair
Calibration State Replay
Certification Divergence
Label Revision
Outcome Lifecycle Ledger
```

## 新 Edges

```text
Pending Label
≠
Negative Label

Delayed Outcome
≠
Failed Action

Observed Label Set
≠
Deployment Population

Verified Dataset
IS_GENERATED_BY
Verification Policy

Verification Policy
MAY_CAUSE
Selection Bias

Feedback Delay
INTERACTS_WITH
Environment Memory Scale

Late Ground Truth
REPAIRS
Historical Calibration State

Calibration Repair
MAY_CHANGE
Historical Certification

Partial Feedback
REQUIRES
Feedback-Mode-Aware Updater
```

## 重要否定 Edges

```text
Missing Outcome ≠ Negative Outcome

High Verification Quality ≠ Unbiased Verification Set

Full-Feedback Calibration ≠ Valid Partial-Feedback Calibration

Current Calibrator Update ≠ Historical Calibration Repair

Observed Time ≠ Outcome Valid Time

Known Delay ≠ Corrected Selection Bias

Known Propensity ≠ Guaranteed Low-Variance Correction

Selection-Aware Coverage ≠ Causal Outcome Identification
```

---

# Unknown / Open Questions

## 1. Selection propensity 本身若由 LLM planner 決定，要怎麼可信地估？

Hermes 的 query decision 很可能不是固定 logistic policy，而是：

```text
LLM reasoning
+ risk model
+ policy rules
+ token/context state
→ VERIFY or not
```

若沒有 explicit randomized gate，很難得到穩定 `P(verify | state)`。

## 2. Late label arrival 是否也 informative？

例如失敗案例可能回報比較快，成功案例幾天後才確定。

則：

```text
P(delay | outcome, state)
```

本身也是 selection mechanism，不能假設 delay independent。

## 3. 如何讓 bitemporal calibration repair 不需要 full replay？

前幾輪已建立 causal slicing。下一步要把：

```text
Late label
→ calibration parameter delta
→ certification delta
→ action decisions
```

接到 incremental dependency graph，只 repair 受影響 windows / action families。

---

# 下一輪研究

下一輪最值得研究：

# Doubly-Robust Calibration × Informative Censoring × Propensity Logging × Incremental Late-Label Repair

建議研究鏈：

```text
Agent verification policy
↓
Explicit stochastic query gate
↓
Propensity logging
↓
Selective / delayed labels
↓
Censoring model
↓
IPS / doubly-robust correction
↓
Partial-feedback conformal calibration
↓
Late-label bitemporal repair
↓
Incremental calibration slice
↓
Certification divergence
```

並優先回答：

1. **缺哪一層：** selection mechanism identification + informative-delay correction。
2. **哪個節點最淺：** `VerificationPropensity`、`DelayMemoryScale`、`BitemporalCalibrationRepair`。
3. **哪個概念仍只是名詞：** `DoublyRobustConformalRepair`、`CalibrationCausalSlice`。
4. **哪個系統值得讀原始碼：** DEFUSE `src/data.py / loss.py / stream_train_test.py`；接著找 partial-feedback conformal 官方 code。
5. **哪篇論文需追引用：** 2026-09-07 `Adaptive Conformal Inference Under Delayed Feedback`，因為它是目前和本輪時間點最接近、直接處理 delayed ACI 的新工作。
6. **哪個概念最適合視覺模擬：** Delayed Feedback × Selective Label Calibration Lab。
7. **哪個 Agent 架構最值得實作：**

> **Bitemporal Selection-Aware Calibration Runtime = Outcome Lifecycle Ledger + Verification Propensity Log + Feedback-Mode Router + Delay/Memory Monitor + Selection-Aware Online Calibrator + Late-Label Event-Time Repair + Certification Divergence Graph。**

---

# 本輪結論

上一輪讓 Hermes 學會：

> 「不確定時不要亂做，必要時去查真實世界。」

這一輪補上的更底層問題是：

> **一旦 Agent 自己決定『哪些案例值得查』，它就同時開始控制自己的訓練與校準資料分布；而當 ground truth 又延遲到達時，資料不只缺失，還帶有 selection、censoring、time-version 三種結構。成熟 Agent 必須知道：沒有 label 不代表失敗、被驗證的案例不代表全體、今天收到的 label 可能是在修正 40 分鐘前的世界，而且這筆修正可能反過來推翻當時的安全認證。**
