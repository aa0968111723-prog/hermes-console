# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 17:53（Asia/Taipei）**  
**主題：Unknown-Unknown Detection × Sequential Conformal Calibration × Selective Acting × Active Real Verification × Twin Coverage Expansion**

---

## 0. 與歷史研究比較：本輪不重複什麼

上一輪已完成：

```text
World-model uncertainty
→ Aleatoric / Epistemic decomposition
→ OOD transition detection
→ Multi-step uncertainty propagation
→ Planner sensitivity
→ Counterfactual outcome confidence
```

上一輪回答的是：

> 「這段 simulated future 有多可信？」

本輪往下一層追問：

> 「當模型自己知道不夠時，何時應停止 acting / simulation？何時要真的向外部世界查一次？要查哪個 state-action transition 才最值得？」

因此本輪新增的是 **online/sequential calibration + abstention + verification acquisition**，不是再次做一般 OOD 或 ensemble uncertainty。

---

# 本小時新發現

## 新論文 / 新方法

1. **Testing For Distribution Shifts with Conditional Conformal Test Martingales** — Shalev Shaer, Yarin Bar, Drew Prinster, Yaniv Romano, 2026.  
   URL: https://arxiv.org/abs/2602.13848  
   核心：以固定 reference dataset 建 conditional conformal test martingale，避免傳統 sequential detector 在 shift 發生後把 post-shift data 混入 reference、稀釋 evidence。主張 anytime-valid type-I error control、asymptotic power 1、bounded expected detection delay。

2. **Conformal Selective Prediction with General Risk Control (SCoRE)** — Tian Bai, Ying Jin, 2026.  
   URL: https://arxiv.org/abs/2603.24704  
   核心：把 conformal inference、generalized e-values 與 hypothesis testing 結合，對「系統選擇要回答/要信任的 cases」控制 selective risk，而不是只校準 prediction set。

3. **Conformal Selective Acting: Anytime-Valid Risk Control for RLVR-Trained LLMs** — Hamed Khosravi, Xiaoming Huo, 2026.  
   URL: https://arxiv.org/abs/2605.20270  
   核心：把 selective risk control 推到 online acting stream；以 per-threshold e-process、anytime-pathwise validity 與 max-certified-threshold rule 決定每一輪是否可 action。

4. **Conformal Risk-Averse Decision Making with Action Conditional Guarantee** — Zihan Zhu, Shayan Kiyani, George Pappas, Hamed Hassani, 2026.  
   URL: https://arxiv.org/abs/2606.05551  
   核心：不是只給 marginal safety，而是條件於「Agent 最後真的採取哪一個 action」提供 action-conditional guarantee。

5. **Online Shift Detection and Conformal Adaptation for Deployed Safety Classifiers** — Jun Wen Leong, 2026.  
   URL: https://arxiv.org/abs/2606.11949  
   核心：online calibrated sequential shift detector + conformal abstention；研究同時暴露 density-ratio reweighting 在高維 embedding shift 下可能 collapse。

6. **AgentAbstain: Do LLM Agents Know When Not to Act?** — Xun Liu et al., 2026.  
   URL: https://arxiv.org/abs/2607.10059  
   核心：263 paired tasks、42 executable sandbox environments，專門測試「應該做」與「應該 abstain」兩邊是否都能判斷；指出一般 task-solving ability 與 abstention ability 並不等價。

7. **Online Conformal Inference with Retrospective Adjustment for Faster Adaptation to Distribution Shift** — Jungbin Jun, Ilsang Ohn, Pattern Recognition 2026.  
   Code: https://github.com/jungbinary/OnlineConformalRetroAdj  
   核心：online conformal 在 distribution shift 後要更快恢復 local coverage；repo 直接比較 DtACI / AgACI / ACI / SF-OGD / SAOCP。

8. **Improved Online Conformal Prediction via Strongly Adaptive Online Learning** — Bhatnagar et al.; official code: https://github.com/salesforce/online_conformal  
   核心：實作 SAOCP、SF-OGD、FACI、split conformal、non-exchangeable conformal；提供可讀的 online update loop。

---

# 本小時最重要 5 個發現

## 1. OOD score 只能說「不像以前」，不能證明「現在已經危險」

### 已確認事實

上一輪的 OOD residual / epistemic uncertainty 很適合當 signal，但 signal 本身沒有直接提供 operational false-alarm guarantee。

Conditional Conformal Test Martingale 的重要性在於把：

```text
nonconformity / atypicality
```

升級成：

```text
streaming evidence
→ e-value / betting score
→ test martingale / e-process
→ threshold crossing
→ shift alarm
```

而且它刻意使用固定 null reference set，避免：

```text
shift occurs
↓
post-shift samples are added to reference
↓
reference itself drifts
↓
evidence gets diluted
```

### Hermes 應拆成

```text
TwinStepCertificate
├ epistemic
├ OOD residual
├ support score
└ transition error proxy
        ↓
Conformal Nonconformity Score
        ↓
Sequential Evidence Process
        ↓
ANYTIME SAFE / SHIFT SUSPECT / SHIFT CONFIRMED
```

### 為什麼重要

Agent 是 sequential system。你不能只在單一步說：

```text
OOD = 0.71
```

而要知道：

```text
這是偶發 outlier？
還是持續 shift？
alarm 的 false-positive budget 是多少？
```

### 限制

Conformal guarantee 依方法而定；exchangeability、conditional validity、non-exchangeable settings 不可混為一談。即使 detector 是 anytime-valid，也不代表 downstream world model prediction 本身正確。

### 新 Knowledge Edge

```text
High OOD Score
≠
Certified Distribution Shift
```

---

## 2. 「知道自己不知道」最後必須轉成 Selective Acting，而不是只顯示 uncertainty

### 論文結果

SCoRE 將 selective prediction 定義成：系統不必每一個 case 都回答，而是在 accepted/trusted subset 上控制使用者指定 risk。

Conformal Selective Acting 更進一步把它變成 sequential action gate：

```text
Agent proposes action
↓
risk / uncertainty evidence
↓
certification process
↓
ACT or ABSTAIN
```

AgentAbstain 則從 benchmark 面直接證明：「會解題」不代表「知道什麼時候不該做」。它還特別指出 post-hoc abstention：Agent 已先執行 irreversible action，之後才發現不該做。

### Hermes 應新增三個時間點

```text
PRE-ACTION ABSTENTION
  action 尚未產生 external effect

MID-EXECUTION ABSTENTION
  tool chain 執行中，發現新風險

POST-EFFECT ESCALATION
  effect 已發生，只能 repair / compensate
```

其中真正的安全目標是把更多 failure 往前移到 PRE-ACTION。

### Action gate 不應只看一個 confidence

應該是：

```text
ActionProposal
↓
Twin uncertainty
+ OOD evidence
+ planner sensitivity
+ effect reversibility
+ policy risk
+ conformal certification state
↓
ActionGate

CERTIFIED_ACT
VERIFY_FIRST
ABSTAIN
HUMAN_ESCALATE
BLOCK
```

### 限制

Selective acting 必然有 coverage / utility trade-off。若過度保守，Agent 會一直 abstain，失去實用性。因此 Hermes UI 需要同時顯示：

```text
risk control
answer/action coverage
verification cost
latency
```

---

## 3. Marginal calibration 不夠：Agent 需要 Action-Conditional Calibration

這是本輪非常重要的新節點。

假設 Agent 有三種 action：

```text
A = READ_ONLY_SEARCH
B = SEND_EMAIL
C = CHARGE_CARD
```

整體平均 risk 5% 不代表：

```text
risk(C) = 5%
```

有可能：

```text
READ_ONLY_SEARCH   1%
SEND_EMAIL         3%
CHARGE_CARD       28%
```

而平均仍看起來「不差」。

2026 action-conditional conformal work 的核心價值，就是把 guarantee 綁到實際 action。

### Hermes 應建立

```text
ActionRiskProfile
├ action_family
├ tool
├ state_region
├ environment/version
├ calibration_count
├ empirical_loss
├ conformal_bound
├ drift_state
└ certificate_status
```

### 工程推論

對 Agent tool use，校準 key 應至少是：

```text
(tool_id,
 action_family,
 side_effect_class,
 state_region,
 policy_context)
```

而不是：

```text
whole-agent-global-confidence
```

### 重要否定關係

```text
Globally Calibrated Agent
≠
Every Action Is Calibrated
```

以及：

```text
Prediction Coverage
≠
Action Safety Guarantee
```

---

## 4. Online calibration 本身必須被當成一個 runtime state machine

### GitHub 原始碼觀察：salesforce/online_conformal

值得看的核心檔案：

```text
online_conformal/
├ base.py
├ faci.py
├ ogd.py
├ saocp.py
├ nex_conformal.py
├ split_conformal.py
├ utils.py
└ model_sigma.py
```

`BasePredictor` 的 runtime loop 很清楚：

```text
model.forecast()
↓
predict interval from current residual state
↓
observe y_t
↓
update(...)
↓
next time step
```

它不是「離線算一次 calibration 然後永遠使用」，而是 observation 到達後持續 update wrapper state。

Repo：https://github.com/salesforce/online_conformal

### GitHub 原始碼觀察：OnlineConformalRetroAdj

值得看的核心檔案：

```text
R/
├ baseKRR.R
├ conformalRetroAdj.R
├ forwardKRR.R
├ forwardMOA.R
└ forwardRiver.R
```

`conformalRetroAdj()` 實作的流程是：

```text
KRR initialization
↓
for each online step:
    compute jackknife+ residual structure
    compute beta_t
    optionally downdate sliding window
    update KRR with new ground truth
↓
DtACI / AgACI / ACI / SF-OGD / SAOCP
↓
adaptive alpha_t
↓
construct interval
↓
coverage / length / error sequence
```

尤其重要的是它同時更新：

```text
predictive model state
+
conformal calibration state
```

這直接支持 Hermes 將 twin learning 與 calibration 拆成不同 timescale。

### Hermes Runtime 應新增

```text
CalibrationState
├ target_risk
├ current_threshold
├ error_history
├ nonconformity_history
├ reference_window
├ shift_eprocess
├ effective_sample_size
├ calibration_method
├ action_condition
└ last_verified_at
```

### 重要新原則

```text
Model Update
≠
Calibration Update
```

也就是：

- Twin/model 可以 slow update。
- Safety/calibration wrapper 可以 fast update。

這會比每次 uncertainty 變高就 retrain world model 更便宜、也更穩定。

---

## 5. 真正的 Active Verification 不是「最不確定就查」；要最大化 Decision-Relevant Information Gain

這部分是本輪最重要的 Hermes engineering synthesis。

### 問題

上一輪到：

```text
Twin confidence low
→ REAL VERIFY
```

但如果一次真正 Browser/API/MCP query 有：

```text
money cost
latency
rate limit
privacy cost
human effort
side-effect risk
```

Hermes 必須決定：

> 到底查哪一個 transition？

### 不能只做 uncertainty sampling

純 uncertainty：

```text
choose argmax epistemic(x)
```

可能會浪費查詢在「很不確定但完全不影響最後 decision」的 state。

### 應改成 Decision-Relevant Verification Value

```text
VerificationValue(q)
=
ExpectedRiskReduction(q)
+
ExpectedPlannerEntropyReduction(q)
+
ExpectedCoverageExpansion(q)
+
SafetyCriticality(q)
-
QueryCost(q)
-
LatencyCost(q)
-
SideEffectRisk(q)
```

也就是驗證 candidate q 必須回答：

1. 查完後，ActionGate 會不會從 `ABSTAIN` 變 `CERTIFIED_ACT`？
2. 查完後，planner 的 action distribution 會不會大幅收斂？
3. 這筆 ground truth 能否擴張 Twin 在重要 state-action region 的 coverage？
4. 這是一個 reversible read，還是有外部 effect？
5. Query cost 是否值得？

### 新 runtime loop

```text
Counterfactual Rollout
↓
Uncertainty / OOD increases
↓
Sequential Shift Evidence
↓
Action cannot be certified
↓
Generate Verification Candidates
↓
Estimate Verification Value
↓
Choose q*
↓
Real / trusted observation
↓
Update:
  Twin dataset
  Calibration state
  Shift detector
  Action-risk profile
↓
Replan
```

### 這才是真正的 Active Twin Learning

不是：

```text
collect random more data
```

而是：

```text
collect the one real transition
that most changes the decision boundary
```

---

# Architecture Breakdown

```text
User / Goal
↓
Agent Planner
↓
Proposed Tool / Browser / MCP Action
↓
World Fork / Tool Twin
↓
Predicted Transition Distribution
├ mean / candidates
├ aleatoric
├ epistemic
├ support
└ OOD residual
↓
Sequential Calibration Layer
├ nonconformity score
├ fixed/reference calibration pool
├ online residual stream
├ conformal quantile
├ e-value / e-process
└ shift state
↓
Action-Conditional Risk Layer
├ tool family
├ action family
├ side-effect class
└ state region
↓
Planner Sensitivity Probe
↓
Selective Action Gate
├ CERTIFIED_ACT
├ VERIFY_FIRST
├ ABSTAIN
├ HUMAN_ESCALATE
└ BLOCK

VERIFY_FIRST
↓
Verification Candidate Generator
↓
Value-of-Verification Scorer
↓
Trusted Real Query
↓
Ground Truth Transition
↓
Twin Update
+
Calibration Update
+
Shift Detector Update
+
Coverage Map Update
↓
Replan
```

---

# Bottom-Level Logic

## A. Conformal residual / nonconformity flow

對 world transition：

```text
S_t + A_t
↓
Twin predicts Ŝ_{t+1}
↓
Real verified S_{t+1}
↓
score_t = nonconformity(Ŝ_{t+1}, S_{t+1})
↓
append score_t to calibration state
↓
update quantile / threshold
```

如果 state 是高維，可拆：

```text
state residual
observation residual
effect residual
timing residual
```

並用 task/action-specific score，而不是硬塞成一個 Euclidean distance。

## B. Adaptive calibration update

概念上：

```text
error_t = 1[ground truth outside certified region]

alpha_{t+1}
=
adapt(alpha_t, target_alpha, error_t)
```

distribution shift 後，閾值會動態調整，而不是沿用過期 calibration set。

## C. Sequential shift state

```text
z_t = conformal/e-value evidence for step t
E_t = update_eprocess(E_{t-1}, z_t)

if E_t > alarm_threshold:
    SHIFT_CONFIRMED
```

重要：這裡的 threshold 要跟 detector 的 formal guarantee 綁定，不應用 UI 任意魔術數字取代。

## D. Selective action gate

```text
certified = action_risk_bound <= risk_budget

if certified:
    ACT
elif verification_value > verify_threshold:
    VERIFY_FIRST
elif reversible and policy permits conservative fallback:
    FALLBACK
else:
    ABSTAIN / HUMAN / BLOCK
```

## E. Active verification acquisition

候選 q：

```text
q = (state, action, tool, query)
```

估計：

```text
VOI(q)
≈
E_before[risk]
-
E_after_query[E[risk | observation]]
```

Hermes 工程版可近似成：

```text
score(q)
=
w1 * planner_flip_probability
+w2 * epistemic
+w3 * OOD
+w4 * safety_criticality
+w5 * coverage_gap
-w6 * monetary_cost
-w7 * latency
-w8 * external_effect_risk
```

---

# Visual Simulation Idea

## **Selective Acting × Active Verification Control Room**

這個視覺模擬應接續上一輪 World-Model Uncertainty Lab。

### 畫面 1：Trajectory Certification Timeline

```text
S0 ─A0→ S1 ─A1→ S2 ─A2→ S3 ─A3→ S4
       ✓       ✓       ⚠       ✕

risk bound
.02     .04     .08     .19

shift e-process
1.1     1.8     5.4    18.7
```

UI 在 crossing point 顯示：

```text
SHIFT SUSPECT
ACTION NOT CERTIFIED
```

### 畫面 2：Act / Verify / Abstain Gate

```text
Proposed action: charge_card

Epistemic            0.41
OOD residual          0.62
Action risk upper     0.17
Risk budget           0.05
Planner flip risk     0.73
Effect class          COMPENSATABLE

[ ACT ]        blocked
[ VERIFY ]     recommended
[ ABSTAIN ]    safe
```

### 畫面 3：Verification Candidate Map

```text
Candidate                         Value   Cost
------------------------------------------------
Query payment_status              .91     low
Verify account balance            .74     low
Refresh customer profile          .26     medium
Ask human to review               .63     high
Retry charge API                  .12     dangerous
```

點選 `Query payment_status` 後：

```text
Trusted observation arrives
↓
planner entropy ↓
OOD ambiguity ↓
action conditional certificate updated
↓
ACT becomes certified
```

### 畫面 4：Calibration Health

```text
Target risk       5%
Observed risk     4.7%
Action coverage   71%
Abstain rate      18%
Verify rate       11%

READ tools        ✓ calibrated
SEND_EMAIL        ✓ calibrated
PAYMENT           ⚠ insufficient support
DELETE            ✕ uncertified
```

### 畫面 5：Unknown-Unknown Radar

不是宣稱「已找到所有 unknown unknown」，而是顯示 proxies：

```text
OOD residual ↑
sequential shift evidence ↑
calibration error ↑
ensemble disagreement ↑
planner sensitivity ↑
low state-action support ↑
```

當多個 channel 同時惡化：

```text
UNKNOWN-UNKNOWN SUSPECT
NOT A PROOF OF UNKNOWN UNKNOWN
```

這個 wording 很重要。

---

# Code / GitHub

## 1. salesforce/online_conformal

Repo: https://github.com/salesforce/online_conformal

值得看的檔案：

```text
online_conformal/base.py
online_conformal/faci.py
online_conformal/saocp.py
online_conformal/ogd.py
online_conformal/nex_conformal.py
online_conformal/utils.py
```

值得借的不是 forecast model 本身，而是：

```text
predict
→ observe ground truth
→ update calibration state
→ next prediction
```

這個 online wrapper lifecycle。

## 2. jungbinary/OnlineConformalRetroAdj

Repo: https://github.com/jungbinary/OnlineConformalRetroAdj

Directory：

```text
R/
├ baseKRR.R
├ conformalRetroAdj.R
├ forwardKRR.R
├ forwardMOA.R
└ forwardRiver.R

aci/
experiments/
├ main/
└ appendix/
```

`conformalRetroAdj.R` 值得 Hermes 借鏡的底層點：

1. Sliding KRR state 可 `downdate` 再 `update`。
2. 每輪先產生 residual/J+ interval structure。
3. 將 sequential residual summary 轉成 `beta_t`。
4. 再交由 DtACI/AgACI/ACI/SF-OGD/SAOCP 更新 `alpha_t`。
5. prediction model adaptation 與 uncertainty calibration 是兩套不同 state。

## 3. 2026 DistMatch code

Repo: https://github.com/YeoJiSu/dist_match_conformal_

值得追：用 KS-based distribution matching 建 adaptive bins / local exchangeability region，而不是只靠 importance reweighting。在 Hermes，可轉化成「依 state-action residual distribution 把 Twin operating region 自動切成 local calibration cells」。

## 4. CoFact

Repo: https://github.com/huzr1999/CoFact

研究價值：LLM factuality under distribution shift 的 conformal calibration，可作為後續「Tool observation / RAG evidence factuality calibration」支線，而非直接等同於 action safety。

---

# Papers

## Paper A

**Title:** Testing For Distribution Shifts with Conditional Conformal Test Martingales  
**Authors:** Shalev Shaer, Yarin Bar, Drew Prinster, Yaniv Romano  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2602.13848  
**Architecture:** fixed null reference → conformal score → conditional test martingale → sequential alarm  
**Contribution:** 避免 post-shift contamination；提供 anytime-valid sequential shift detection。  
**Limitations:** shift detection ≠ downstream model correctness；reference quality 與 nonconformity design 仍重要。

## Paper B

**Title:** Conformal Selective Prediction with General Risk Control  
**Authors:** Tian Bai, Ying Jin  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2603.24704  
**Architecture:** model score → generalized e-values → hypothesis testing → trusted subset  
**Contribution:** 對「被選擇信任的 cases」控制 general bounded risk。  
**Limitations:** guarantee scope 必須與 deployment assumptions 對齊；不能直接把 selective prediction claim 擴張成 arbitrary agent safety。

## Paper C

**Title:** Conformal Selective Acting: Anytime-Valid Risk Control for RLVR-Trained LLMs  
**Authors:** Hamed Khosravi, Xiaoming Huo  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2605.20270  
**Architecture:** threshold grid → per-threshold e-process → max certified threshold → act/abstain  
**Contribution:** 直接把 certification 拉到 online action stream。  
**Limitations:** paper setting 是特定 RLVR-trained specialist LLM deployment；Hermes 泛用 tool-agent 需要重新定義 loss、filtration、action condition。

## Paper D

**Title:** Conformal Risk-Averse Decision Making with Action Conditional Guarantee  
**Authors:** Zihan Zhu, Shayan Kiyani, George Pappas, Hamed Hassani  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2606.05551  
**Contribution:** action-conditional guarantee；非常適合 Agent tool family risk calibration。  
**Limitations:** 從 benchmark decision problem 移植到 heterogeneous tool runtime 需要新的 state/action partition。

## Paper E

**Title:** AgentAbstain: Do LLM Agents Know When Not to Act?  
**Authors:** Xun Liu et al.  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2607.10059  
**Dataset/Benchmark:** 263 paired tasks, 42 executable sandbox environments, 8 abstention scenarios。  
**Contribution:** 正式把 agent abstention 當獨立能力評估；顯示 task-solving 與 abstention 不同。  
**Limitations:** benchmark ability ≠ formal calibration guarantee。

## Paper F

**Title:** Online Conformal Inference with Retrospective Adjustment for Faster Adaptation to Distribution Shift  
**Authors:** Jungbin Jun, Ilsang Ohn  
**Institution:** Inha University  
**Journal/Year:** Pattern Recognition, 2026  
**Code:** https://github.com/jungbinary/OnlineConformalRetroAdj  
**Architecture:** sliding model update + retrospective residual structure + adaptive conformal alpha  
**Contribution:** 更快適應 distribution shift；repo 提供 DtACI/AgACI/ACI/SF-OGD/SAOCP comparisons。  
**Limitations:** 主要是 prediction interval setting；Hermes 必須重新定義 structured tool-state nonconformity。

---

# Fact / Inference / Hypothesis Boundary

## 已確認事實

- Online conformal methods 可以在 streaming feedback 到達後持續更新 calibration state。
- 2026 已有 conditional conformal test martingale 用來做 sequential distribution-shift detection。
- 2026 已有 selective conformal risk control 與 online selective acting 工作。
- 2026 已有 action-conditional conformal risk guarantee 工作。
- AgentAbstain 顯示 agent abstention 與一般 task solving 應分開評估。
- Salesforce `online_conformal` 與 `OnlineConformalRetroAdj` 原始碼都把 online observation → update 作為 runtime loop 的核心。

## 工程實作推論

- 將 conformal wrapper 放在 Hermes Tool Twin / World Model 之外，當成 independent runtime safety layer。
- 為每個 high-impact action family 維護 action-conditional calibration state。
- 把 sequential shift detector、planner sensitivity、twin OOD 與 effect class 合成 selective action gate。
- 用 verification value 選擇要進行哪一個 real API/MCP/browser query。

## 尚未驗證假說

1. `PlannerFlipProbability × OOD × SafetyCriticality` 是否能形成穩定的 verification acquisition function，需要 Hermes 自己的 benchmark。
2. structured world-state transition 要採哪一種 conformal nonconformity score，尚未確定。
3. 多個 correlated tool/actions 的 action-conditional calibration 是否需要 hierarchical / local conformal partition，仍待實驗。

---

# Unknown / Open Questions

## 1. Unknown-unknown 能否被「偵測」？

嚴格說不能直接偵測一個自己尚未建模的未知因素。可以偵測的是它留下的症狀：

```text
coverage break
persistent nonconformity
OOD residual
shift e-process growth
planner instability
unexplained state transition
```

因此應使用：

```text
UNKNOWN_UNKNOWN_SUSPECT
```

不要使用：

```text
UNKNOWN_UNKNOWN_CONFIRMED
```

除非 ground truth 出現後才 retrospective labeling。

## 2. Ground truth feedback 若很晚才到，online calibration 怎麼辦？

這會與前幾輪研究的：

```text
Event Time
Knowledge Time
Late Event
Bitemporal Repair
```

重新接上。Hermes 需要 `PendingCalibrationOutcome`，不能假裝每個 action 立刻有真值。

## 3. Verification query 本身會不會改變世界？

例如 GET balance 通常近 read-only；但某些 browser navigation、API call、human escalation 會造成 lock、reservation、notification 等 effect。故 verification candidate 也必須經 Effect Classifier。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Sequential Calibration
Online Conformal Calibration
Conformal Nonconformity Score
Conformal Test Martingale
Conditional Test Martingale
E-Value
E-Process
Anytime-Valid Shift Detection
Shift Alarm
Reference Contamination
Selective Prediction
Selective Acting
Pre-Action Abstention
Mid-Execution Abstention
Post-Effect Escalation
Action-Conditional Risk
Action Risk Profile
Calibration State
Calibration Drift
Coverage Breakdown
Unknown-Unknown Suspect
Verification Candidate
Verification Value
Expected Risk Reduction
Planner Entropy Reduction
Coverage Expansion Value
Selective Real Verification
Active Twin Learning
Pending Calibration Outcome
Calibration Feedback Delay
```

## Positive edges

```text
Verified Transition
→ UPDATES
Calibration State

Verified Transition
→ EXPANDS
Twin Coverage

Sequential Nonconformity
→ FEEDS
E-Process

E-Process
→ SUPPORTS
Shift Alarm

Action-Conditional Certificate
→ GATES
Agent Action

Planner Sensitivity
→ INCREASES
Verification Priority

Safety Criticality
→ INCREASES
Verification Priority

Real Verification
→ REDUCES
Epistemic Uncertainty
```

## Negative / distinction edges

```text
High OOD Score
≠
Certified Distribution Shift

Globally Calibrated Agent
≠
Every Action Is Calibrated

Prediction Coverage
≠
Action Safety Guarantee

Task-Solving Ability
≠
Abstention Ability

Uncertainty
≠
Risk Guarantee

Abstention
≠
Failure

Unknown-Unknown Suspect
≠
Unknown-Unknown Proof

Most Uncertain Query
≠
Most Valuable Verification Query

Model Update
≠
Calibration Update
```

---

# 下一輪研究

下一輪最合理的缺口是：

# **Delayed Feedback × Partial Ground Truth × Conformal Calibration Under Selective Labels × Verification Bias**

因為一旦 Hermes 採用：

```text
只在高 uncertainty 時 real verify
```

就會出現 selection bias：

```text
被驗證的資料
≠
實際所有 runtime state 的無偏樣本
```

再加上：

```text
payment outcome 可能幾分鐘後才知道
email effect 可能幾小時後才知道
human success 可能幾天後才知道
```

因此下輪應研究：

```text
Agent acts
↓
Outcome pending
↓
Selective verification
↓
Biased labeled stream
↓
Delayed ground truth
↓
Calibration update
↓
Inverse propensity / missing-label correction?
↓
Online coverage validity
↓
Bitemporal calibration repair
```

值得關注：

- conformal prediction with delayed / censored feedback
- selective labels / selective outcome bias
- off-policy evaluation for verification policies
- delayed bandits / active learning
- partial identification when ground truth never arrives

---

# 本輪結束回答

**缺哪一層？**  
Delayed / selectively observed ground-truth calibration layer。

**哪個節點最淺？**  
`VerificationValue`、`ActionConditionalCalibration`、`UnknownUnknownSuspect`。

**哪個概念仍只是名詞？**  
`Unknown-Unknown Certificate` 不應存在，目前最多只能有 `UnknownUnknownSuspect`；`ActiveTwinLearningPolicy` 也仍是 Hermes engineering concept。

**哪個系統最值得繼續讀原始碼？**  
`jungbinary/OnlineConformalRetroAdj` 的 `aci/`、`forwardRiver.R`、experiment runtime；其次 `salesforce/online_conformal` 的 `saocp.py / faci.py / ogd.py`。

**哪篇論文需追引用？**  
首要：*Testing For Distribution Shifts with Conditional Conformal Test Martingales*；其次 *Conformal Selective Acting* 與 action-conditional conformal decision paper。

**哪個概念最適合視覺模擬？**  
`Selective Acting × Active Verification Control Room`：把 uncertainty、shift evidence、action certificate、verify candidate、cost 與 action gate 放在一個時間軸。

**哪個 Agent 架構最值得實作？**  

> **Calibrated Selective Agent Runtime = World/Twin Uncertainty + Sequential Conformal Shift Monitor + Action-Conditional Risk Calibrator + Planner Sensitivity Probe + Selective Action Gate + Value-of-Verification Planner + Active Twin Learning Loop。**

---

# 最終還原鏈的新增位置

原本：

```text
使用者
→ UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tools / MCP
→ Models
→ GPU
→ Output
```

本輪補成：

```text
使用者
→ UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ World/Twin Prediction
→ Uncertainty / OOD
→ Sequential Calibration
→ Action-Conditional Risk
→ ACT / VERIFY / ABSTAIN
→ Tool / MCP / Browser
→ Ground Truth Feedback
→ Calibration Update
→ Twin Update
→ Memory / Knowledge Graph
→ Next Decision
```

多模態則是：

```text
Camera / Image / Voice / Video / Sensor
→ Encoder / Tokens
→ Fusion
→ World State
→ World Model
→ Uncertainty
→ Sequential Shift Evidence
→ Agent Planner
→ Action Certificate
→ ACT / VERIFY / ABSTAIN
→ External Action
→ New Multimodal Observation
→ Online Calibration
```

**本輪核心結論：成熟 Agent 不只需要知道「我不確定」，還必須有一個持續校準的 runtime，能量化何時信任、何時 abstain、何時真的向世界查證，以及有限的真實查詢預算應花在哪一個最可能改變決策的位置。**
