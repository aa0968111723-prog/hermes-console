# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 11:51（Asia/Taipei）**  
**本輪主題：Off-Policy Calibration × Selective Labels × Logged Propensity × Counterfactual Evidence × Policy-Safe Deployment**

---

## 0. 與歷史研究的差異

上一輪已建立：Agent policy 會改變觀測分布、modality activation、label availability，因此 calibration 必須綁定 policy epoch / selection rule；並建立 weighted conformal、multi-timescale martingale、support audit 與 certificate migration。

本輪不再重複「policy update 會造成 calibration drift」，而往下一層追：

> **如果新 policy 尚未部署，能不能只用舊 policy 的 logged data，估計新 policy 下 calibration / prediction interval / evidence runtime 是否仍有效？**

因此本輪研究的是 counterfactual / off-policy calibration，而不是一般 exogenous distribution shift。

核心問題：

```text
Historical behavior policy π_b
↓
logged X, A, Y_obs
↓
selection / label mechanism
↓
Target policy π_e (not deployed yet)
↓
Can we reconstruct target-policy calibration law?
↓
Prediction / Evidence Certificate
↓
DEPLOY / PILOT / COLLECT SUPPORT / BLOCK
```

---

# 一、本小時新發現

## 新論文 / 新架構 / 新 GitHub

### 1. Conformal Off-Policy Prediction
- **Authors:** Yingying Zhang, Chengchun Shi, Shikai Luo
- **Institution:** East China Normal University / LSE-related publication trail (authors' affiliations should be checked from paper metadata before relying on institution-specific claims)
- **Year:** 2023, AISTATS
- **URL:** https://proceedings.mlr.press/v206/zhang23c.html
- **Code:** https://github.com/yyzhangecnu/COPP
- **Architecture:** behavior policy → target policy → pseudo policy → target-like subsample → weighted conformal prediction
- **Contribution:** 不只估 target policy 的平均 return，而構造 target-policy potential outcome 的 prediction interval；核心是設計 pseudo policy，讓被選中的 logged samples 更接近 target-policy outcome law，再用 weighted conformal 做有限樣本不確定性量化。
- **Limitations:** 需要 consistency / sequential ignorability / positivity；multi-stage 有 curse of horizon / support shrinkage；propensity model misspecification 會直接污染 weights。

### 2. Conformal Off-Policy Prediction in Contextual Bandits
- **Authors:** Muhammad Faaiz Taufiq, Jean-Francois Ton, Rob Cornish, Yee Whye Teh, Arnaud Doucet
- **Institution:** University of Oxford 等
- **Year:** 2022, NeurIPS
- **URL:** https://proceedings.neurips.cc/paper_files/paper/2022/hash/cc84bfabe6389d8883fc2071c848f62a-Abstract-Conference.html
- **Architecture:** logged behavior-policy data → target-policy distribution correction → conformal predictive interval
- **Contribution:** 將 OPE 從 expected value 推進到 target-policy outcome distribution / predictive interval；對 Hermes 更重要，因為 permission gate 通常關心 tail risk，而不是只有 mean reward。
- **Limitations:** contextual-bandit assumptions 與通用 long-horizon Agent runtime 仍有距離。

### 3. Conformal Off-Policy Prediction for Multi-Agent Systems
- **Authors:** Tom Kuipers, Renukanandan Tumu, Shuo Yang, Milad Kazemi, Rahul Mangharam, Nicola Paoletti
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2403.16871
- **Architecture:** policy switch → multi-agent trajectory distribution shift → joint conformal prediction region
- **Contribution:** 把 OPP 從 single-agent scalar outcome 推到 multi-agent joint trajectories；對 Hermes 的 multi-agent orchestration / tool delegation 很重要。
- **Limitations:** trajectory-space、density-ratio estimation 與 interaction dynamics 複雜度高，仍不是 arbitrary LLM-agent proof system。

### 4. Learning under Selective Labels with Data from Heterogeneous Decision-makers: An Instrumental Variable Approach
- **Authors:** Jian Chen, Zhehao Li, Xiaojie Mao
- **Year:** 2023
- **URL:** https://arxiv.org/abs/2306.07566
- **Architecture:** selective-label mechanism + heterogeneous decision-makers as IV → point identification or sharp risk bounds
- **Contribution:** 當 label selection 與 outcome 同時受 unobserved factor 影響時，單純 propensity correction 不夠；decision-maker heterogeneity 有時能成為 instrument，否則只能報 bounds。
- **Limitations:** instrument relevance / exclusion 等假設很強，不能把任何「不同 agent / 不同 operator」自動視為 IV。

### 5. Robust Design and Evaluation of Predictive Algorithms under Unobserved Confounding
- **Authors:** Ashesh Rambachan, Amanda Coston, Edward Kennedy
- **Year:** 2025 publication trail / earlier arXiv versions
- **URL:** https://arxiv.org/abs/2212.09844
- **Architecture:** selective labels + unobserved confounding → sensitivity / partial-identification bounds
- **Contribution:** 當 selected vs unselected units 在 latent outcome risk 上仍不同時，應該輸出 robust performance region，而不是虛假的 point estimate。
- **Limitations:** bounds 的 informativeness 依 sensitivity model 與可用 proxy / IV 而定。

---

# 二、本小時最重要 5 個發現

## 發現 1：Off-policy calibration 不是「把 calibration weights 換掉」這麼簡單

已確認事實：COPP 明確指出，若只從 target policy π_e 抽 pseudo action E，然後保留 logged action T=E 的樣本，selected response distribution 一般不等於 target potential outcome distribution；只有特殊情況（例如 target deterministic 或 behavior uniform random）才會自然吻合。

因此真正流程是：

```text
Behavior policy π_b(a|x)
+
Target policy π_e(a|x)
↓
Construct pseudo-action distribution π_a
↓
Sample pseudo action A
↓
Keep / reweight logged transitions compatible with A
↓
Target-like calibration population
↓
Conformal score
↓
Weighted conformal quantile
↓
Target-policy predictive interval
```

這和上一輪「weighted conformal under policy drift」最大的不同，是本輪把 **policy-induced sample-generation mechanism** 本身納入 calibration architecture。

核心新 edge：

```text
Target Policy Weighting
≠
Counterfactual Calibration Automatically
```

---

## 發現 2：底層機制是 Behavior Propensity × Target Policy × Pseudo Policy

COPP 官方 `Figure2/conformalCI.R` 的工程流程非常值得 Hermes 直接拆解：

```text
Input:
X, Y, T
↓
Sample split
↓
fit behavior propensity P(T=1|X)
↓
compute target policy probability π_e(1|X)
↓
construct pseudo-action probability
↓
A ~ Bernoulli(π_a)
↓
O = I(T == A)
↓
fit outcome / quantile model on selected compatible records
↓
compute calibration nonconformity score
↓
construct behavior/target-related weights
↓
weighted conformal interval
```

程式碼不是只傳一個 generic weight vector。它實際計算 behavior propensity、target policy probability、pseudo-action probability，再依 single-weight / double-weight variants 決定 calibration sample 與 `1/ps_val` / `1/ps_test` 型 weighting。

這表示 Hermes 未來的 counterfactual calibration 需要明確保存：

```text
LoggedPolicyContract
├ behavior_policy_id
├ behavior_propensity
├ target_policy_id
├ target_propensity
├ pseudo_policy
├ action_support
├ propensity_model_version
├ calibration_selection_rule
└ weight_construction_rule
```

而不是只保存：

```text
weight = 3.42
```

因為 weight 沒有 provenance，就無法知道它究竟是在修 covariate shift、action-policy shift、selection mechanism，還是 estimated observation probability。

---

## 發現 3：Selective labels 把問題從 covariate shift 升級成 missing potential outcomes

Agent 系統常見：

```text
Action = VERIFY
→ 才得到真實 tool outcome

Action = ASK_USER
→ 才得到 clarification label

Action = OPEN_CAMERA
→ 才有 visual observation

Action = RUN_TEST
→ 才知道 code test result
```

所以 label availability 本身依 action / policy 決定。

這不是普通：

```text
P_old(X) ≠ P_new(X)
```

而可能是：

```text
R = label observed indicator
R ← policy action
R ← latent difficulty
Y ← latent difficulty
```

此時：

```text
Observed calibration labels
≠ random sample from target population
```

若 selection 與 outcome 在 observed X 給定後仍有 latent common cause：

```text
U → Selection
U → Outcome
```

則 IPS / weighted CP 不能自動解決；必須進入：

```text
IV identification
or
proximal identification
or
sensitivity bounds
or
partial identification
```

因此 Hermes 新增概念：

```text
LabelObservationMechanism
├ always_observed
├ action_revealed
├ delayed
├ censored
├ selectively_observed
├ proxy_observed
└ never_observed_under_logged_policy
```

核心 edge：

```text
Covariate Shift Correction
≠
Selective-Label Identification
```

---

## 發現 4：Positivity 對 Agent 應拆成 Action Support 與 Label Support

以前已經研究過 positivity，但本輪發現 counterfactual calibration 至少需要兩種 support：

### Action Support

```text
π_b(a|x) > 0
for actions that π_e may choose
```

### Label / Outcome Support

即使 behavior policy 曾選過 action，也不代表 outcome / label 一定可用：

```text
P(R=1 | x,a) > 0
```

因此新 policy 若進入：

```text
π_b(a|x) ≈ 0
```

或：

```text
P(label observed | x,a) ≈ 0
```

counterfactual calibration 不應把 weight 無限放大，而應回傳：

```text
UNSUPPORTED
COLLECT_EXPLORATION_DATA
RANDOMIZED_PILOT
BLOCK_HIGH_RISK_PERMISSION
```

新增：

```text
CounterfactualSupportCertificate
├ action_overlap
├ label_overlap
├ modality_overlap
├ effective_sample_size
├ max_importance_weight
├ unsupported_regions[]
└ deployment_scope
```

重要新 edge：

```text
Finite Importance Weight
≠
Adequate Effective Support
```

---

## 發現 5：Agent deployment 應增加 Off-Policy Evidence Gate

Hermes 現在已有 causal certificate、calibration certificate、e-process、permission gate 的研究路線。

本輪可再加一層：

```text
Candidate Policy π_new
↓
Historical Policy Ledger
↓
Off-Policy Identifiability Audit
├ sequential ignorability?
├ action positivity?
├ label positivity?
├ hidden confounding?
└ outcome observability?
↓
Counterfactual Calibration Builder
↓
Prediction / Evidence Certificate
↓
Tail-risk / coverage check
↓
Permission diff
↓
DEPLOY
LIMITED PILOT
EXPLORE FIRST
RECALIBRATE
NOT IDENTIFIED
BLOCK
```

這是比普通 OPE 更適合安全 Agent 的原因：

```text
Expected return under π_new = 8.2
```

不代表：

```text
π_new is safe
```

Hermes 更需要：

```text
Under π_new:
90% outcome interval = [...]
coverage certificate = ...
unsupported state mass = ...
selective-label risk = ...
worst-case bound = ...
```

---

# 三、Architecture Breakdown

## Counterfactual Calibration Runtime

```text
UI / User / Camera / Voice / DOM / Tool / MCP / Memory
↓
Raw Event Ledger
↓
Policy / Selection Ledger
├ action chosen
├ action propensity
├ modality activation
├ verification decision
├ abstention decision
└ label-observation event
↓
Historical Behavior Policy Model π_b
↓
Candidate Target Policy π_e
↓
Off-Policy Assumption Auditor
├ consistency
├ sequential ignorability
├ action support
├ label support
├ hidden confounding
└ interference
↓
Target-Population Constructor
├ pseudo-policy subsampling
├ importance weighting
├ density-ratio weighting
├ IV / proxy route
└ partial-identification route
↓
Counterfactual Calibration Population
↓
Nonconformity / residual layer
↓
Weighted / off-policy conformal
↓
OffPolicyEvidenceCertificate
↓
Permission Gate
```

### System reasoning 與 model reasoning 的分離

**Model reasoning:**
```text
LLM/VLM predicts outcome / score / tool success
```

**System reasoning:**
```text
Which policy produced this sample?
Was outcome observable under that policy?
Does target policy have support?
Can the calibration set be transported?
Is hidden confounding unresolved?
What certificate is still identifiable?
```

這是 system reasoning，不能只靠 language model chain-of-thought 代替。

---

# 四、Bottom-Level Logic

## A. Logged trajectory

對每筆 agent interaction：

```text
H_t = history / context
A_t = executed action/tool/query
μ_t(A_t|H_t) = logging propensity
R_t = whether label/outcome became observable
Y_t = observed outcome if available
```

Target policy：

```text
π_t(a|H_t)
```

普通 action importance ratio：

```text
ρ_t = π_t(A_t|H_t) / μ_t(A_t|H_t)
```

trajectory ratio：

```text
ρ_1:T = Π_t ρ_t
```

但 counterfactual calibration 還必須納入：

```text
P(R_t=1 | H_t,A_t,...)
```

以及 selective-label assumptions。

## B. Weight instability

當：

```text
μ(a|h) → 0
```

則：

```text
ρ → ∞
```

因此有效樣本量可快速崩潰：

```text
ESS = (Σw_i)^2 / Σw_i^2
```

對 Hermes 而言，ESS 應進 certificate，而不是只在 research notebook 裡看。

## C. Counterfactual conformal conceptual pipeline

```text
Logged samples
↓
construct target-like weighted / pseudo-policy sample law
↓
fit / freeze predictor
↓
compute nonconformity scores
↓
apply target-policy weights
↓
weighted empirical quantile
↓
prediction set for Y^{π_e}
```

## D. Selective labels route

```text
Outcome fully observed?
├ YES → standard off-policy calibration route
└ NO
   ↓
Selection independent of Y given observed state/action?
├ YES → weighting / MAR-like correction may be possible
└ NO
   ↓
Valid IV / proxy available?
├ YES → IV/proximal identification route
└ NO
   ↓
Sensitivity / partial-identification bounds
```

---

# 五、Visual Simulation Idea

## **Off-Policy Calibration × Selective Label Simulator**

左側：Behavior policy

```text
π_old
VERIFY      20%
ASK_USER    10%
OPEN_CAMERA 35%
AUTO_ACT    35%
```

使用者拖成 target policy：

```text
π_new
VERIFY      60%
ASK_USER     5%
OPEN_CAMERA 20%
AUTO_ACT    15%
```

中央即時顯示：

```text
Action overlap            0.88
Label overlap             0.54
ESS                        312 / 2400
Max weight                18.2
Unsupported state mass     7.4%
Hidden-confounding audit   UNKNOWN
```

右側 comparison：

```text
NAIVE CALIBRATION
90% interval coverage estimate: 72%

ACTION-WEIGHTED
estimated: 88%

ACTION + LABEL AWARE
estimated: 90%

Hidden confounding ON
→ POINT IDENTIFICATION REMOVED
→ BOUND: 81%–92%
```

再讓使用者打開：

```text
π_old(VERIFY|hard cases) = 0
```

畫面立即顯示：

```text
POSITIVITY FAILURE

No amount of reweighting can synthesize
unobserved outcomes in this region.

Recommended action:
RANDOMIZED PILOT
```

這個模擬可以很直覺地教會使用者：

> **歷史資料很多，不代表新 policy 的反事實資料很多。**

---

# 六、Code / GitHub

## yyzhangecnu/COPP

Repository：
https://github.com/yyzhangecnu/COPP

值得看的目錄：

```text
Figure1/
├ DirectM.R
├ SamplingM.R
├ AOPM.R
├ conformal_utils.R
└ genY.R

Figure2/
├ conformalCI.R
├ conformalCI_TS.R
├ conformal_learners.R
├ conformal_utils.R
├ propensityscore.R
├ samplesplit.R
├ SS_low_IPWE.R
├ SS_*_BootSweight.R
└ SS_*_BootDweight.R
```

最值得深讀：

### `Figure2/conformalCI.R`

實作順序：

```text
sample split
→ behavior propensity estimation
→ target policy probability
→ pseudo-action probability
→ pseudo action sampling
→ compatible-record selection
→ outcome model
→ calibration score
→ single/double weighting
→ weighted conformal interval
→ optional bootstrap interval aggregation
```

工程上特別值得 Hermes 借用的是：

1. behavior policy model 與 outcome model 分開；
2. training / calibration 分開；
3. target policy explicitly enters weight construction；
4. single-weight / double-weight variants明確分流；
5. multi-stage 另有 `conformalCI_TS.R`，表示 sequential policy shift 不能直接偷用 single-stage logic。

## predict-idlab/crepes-weighted

Repository：
https://github.com/predict-idlab/crepes-weighted

核心：

```text
src/crepes_weighted/
├ base.py
└ extras.py
```

`base.py` 會保存 `likelihood_ratios_cal`，並在 weighted predictive-distribution / conformal logic 中使用 calibration likelihood ratios。這可以作為 Hermes 通用 weighted-conformal primitive 的工程參考；但它主要是 covariate-shift工具，**不能單獨解 selective labels 或 hidden confounding**。

---

# 七、Papers

## Paper 1
**Title:** Conformal Off-Policy Prediction  
**Authors:** Yingying Zhang, Chengchun Shi, Shikai Luo  
**Year:** 2023  
**URL:** https://proceedings.mlr.press/v206/zhang23c.html  
**Code:** https://github.com/yyzhangecnu/COPP  
**Dataset:** synthetic + short-video real-data experiments  
**Architecture:** pseudo policy + subsampling + weighted conformal prediction  
**Contribution:** individual target-policy outcome uncertainty，而不只是平均 OPE  
**Limitations:** positivity / ignorability / horizon / propensity estimation

## Paper 2
**Title:** Conformal Off-Policy Prediction in Contextual Bandits  
**Authors:** Taufiq et al.  
**Year:** 2022  
**URL:** https://proceedings.neurips.cc/paper_files/paper/2022/hash/cc84bfabe6389d8883fc2071c848f62a-Abstract-Conference.html  
**Architecture:** conformal prediction under behavior→target policy shift  
**Contribution:** finite-sample target-policy predictive intervals  
**Limitations:** contextual-bandit scope

## Paper 3
**Title:** Learning under Selective Labels with Data from Heterogeneous Decision-makers: An Instrumental Variable Approach  
**Authors:** Jian Chen, Zhehao Li, Xiaojie Mao  
**Year:** 2023  
**URL:** https://arxiv.org/abs/2306.07566  
**Architecture:** heterogeneous decision-maker IV → point ID / bounds  
**Contribution:** selective-label learning under latent confounding  
**Limitations:** IV assumptions

## Paper 4
**Title:** Robust Design and Evaluation of Predictive Algorithms under Unobserved Confounding  
**Authors:** Ashesh Rambachan, Amanda Coston, Edward Kennedy  
**URL:** https://arxiv.org/abs/2212.09844  
**Architecture:** sensitivity model + robust bounds  
**Contribution:** selected-label performance under unobserved confounding  
**Limitations:** bound width depends on sensitivity assumptions

## Paper 5
**Title:** Conformal Off-Policy Prediction for Multi-Agent Systems  
**Authors:** Kuipers et al.  
**Year:** 2024  
**URL:** https://arxiv.org/abs/2403.16871  
**Architecture:** multi-agent target-policy shift → joint trajectory prediction region  
**Contribution:** extends OPP to interacting multi-agent trajectories  
**Limitations:** joint density ratios / high-dimensional trajectory space

---

# 八、Unknown / Open Questions

## 1. 如何建立真正 production 級的 `Policy-Safe Multimodal Conformal E-Process`？

目前 off-policy conformal 與 sequential e-process 是兩條已存在但尚未自然統一的理論線。Hermes 真正需要：

```text
logged propensity
+
selective modality / label mechanism
+
off-policy calibration
+
conditional e-factor
+
anytime-valid accumulation
```

這仍是最重要缺口。

## 2. Propensity model 錯了時，coverage certificate 怎麼退化？

production 中 `μ(a|h)` 幾乎一定是 estimated，而不是 known randomized logging probability。

需要：

```text
propensity uncertainty
→ weight uncertainty
→ coverage uncertainty
→ evidence uncertainty
→ permission uncertainty
```

而不是把 point propensity 當 ground truth。

## 3. LLM Agent 的「action」如何定義才適合 OPE？

如果 action 空間是：

```text
free-form text
arbitrary tool JSON
browser trajectory
code patch
multi-agent delegation
```

則 classical discrete-action propensity 幾乎不可直接估。

需要研究：

```text
action abstraction
hierarchical propensity
semantic action equivalence
option / macro-action OPE
structured tool-policy logging
```

---

# 九、Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Off-Policy Calibration
Counterfactual Calibration Population
Logged Policy Contract
Behavior Propensity
Target Policy Propensity
Pseudo Policy
Pseudo Action
Policy Transport Weight
Action Support
Label Support
Modality Support
Selective Label
Label Observation Mechanism
CounterfactualSupportCertificate
OffPolicyEvidenceCertificate
Target-Policy Prediction Interval
Propensity Provenance
Effective Support
Policy-Safe Calibration
Policy-Safe Evidence Gate
Randomized Calibration Pilot
```

## 新 Edges

```text
Policy Change
→ Counterfactual Calibration Shift

Behavior Propensity
+
Target Policy
→ Policy Transport Weight

Target Policy Weighting
≠ Counterfactual Calibration Automatically

Covariate Shift Correction
≠ Selective-Label Identification

Action Support
≠ Label Support

Finite Importance Weight
≠ Adequate Effective Support

Selective Labels
+
Hidden Confounding
→ Point Identification May Fail

Support Failure
→ Cannot Be Fixed By Reweighting

Support Failure
→ Randomized Pilot / Data Collection

Off-Policy Mean Estimate
≠ Target-Policy Safety Certificate

Target-Policy Predictive Distribution
→ Supports Tail-Risk Permission Gate
```

---

# 十、下一輪研究

下一輪應聚焦：

# **Structured Action Propensity × LLM Tool Policies × Hierarchical Off-Policy Evaluation × Semantic Action Abstraction**

因為 classical OPE 假設 action 是清楚的離散 / 連續變數，但 Agent 真實 action 是：

```text
Intent
↓
Tool family
↓
Tool schema
↓
Arguments
↓
Execution strategy
↓
Retries
↓
Browser / computer sub-actions
↓
Observation
```

核心下一輪：

```text
Raw Agent Trace
↓
Action Abstraction Graph
├ intent
├ tool family
├ tool ID
├ schema version
├ argument region
├ execution mode
└ sub-action trajectory
↓
Hierarchical Logging Propensity
↓
Target Policy Ratio
↓
Support Audit at each abstraction level
↓
Off-Policy Calibration / OPE
↓
Permission Certificate
```

需要回答：

> **「LLM 產生一段 tool call / browser trajectory」的 propensity 到底是什麼？如果 exact action 幾乎永遠只出現一次，應該在哪一層抽象 action 才能做可靠 counterfactual evaluation？**

---

# 十一、本輪結束判定

**缺哪一層：** Structured Agent Action / Logging-Propensity Layer。  
**哪個節點最淺：** `HierarchicalAgentPropensity`、`SelectiveLabelConformalEProcess`、`PropensityUncertaintyCertificate`。  
**哪個概念仍只是名詞：** production 級 `Policy-Safe Multimodal Conformal E-Process`。  
**哪個系統值得讀原始碼：** `yyzhangecnu/COPP`，優先 `Figure2/conformalCI.R → conformalCI_TS.R → propensityscore.R → conformal_utils.R`。  
**哪篇論文需追引用：** Zhang–Shi–Luo 2023 COPP，並沿 citations 追 long-horizon / sequential off-policy predictive inference。  
**哪個概念最適合視覺模擬：** Off-Policy Calibration × Selective Label Simulator。  
**哪個 Agent 架構最值得實作：** `Policy/Selection Ledger → Off-Policy Assumption Auditor → Counterfactual Calibration Builder → Support Certificate → OffPolicyEvidenceCertificate → Permission Gate`。

---

# 最終底層定位

這輪對「AI 到底怎麼運作」補上的核心是：

> **AI Agent 不只會因自己的 policy 改變「看到什麼資料」；它還會改變「哪些結果有機會被知道」。因此當我們想在部署新 policy 前用舊資料驗證安全性，真正的問題不是把舊 calibration set 重新加權就結束，而是要重建：歷史 policy 如何選 action、哪些 action 讓 label 出現、target policy 將如何重新分配 action，以及歷史資料是否真的覆蓋 target policy 需要的反事實世界。若沒有 support，就不存在任何演算法可以從零資料憑空創造可靠 counterfactual evidence。**
