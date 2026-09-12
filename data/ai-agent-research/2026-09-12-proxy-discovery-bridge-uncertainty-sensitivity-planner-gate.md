# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 23:53（Asia/Taipei）**

## 本輪研究主題
**Proxy-Role Discovery × Invalid Negative-Control Selection × Bridge Epistemic Uncertainty × Hidden-Confounder Sensitivity × Causal Planner Gate**

> 本輪承接上一輪 `Causal State Discovery × Negative Controls × Proximal Causal Bridges × Hidden-Confounder Sensitivity × Representation Drift`。上一輪已回答「hidden confounder 無法直接觀測時，可用 negative controls / proxies / bridge functions 做 falsification 或 proximal identification」。這輪不再重複 bridge 基礎，而是追問更實際的 runtime 問題：**哪些 observation channel 有資格成為 proxy / negative control？候選 proxy 中混有 invalid variables 時怎麼辦？bridge 本身的不確定性如何量化？當 hidden-confounding sensitivity 足以翻轉 Agent action 時，Planner 是否應該拒絕執行？**

---

# 本小時新發現

## 新論文 / 新機制
1. **Double Negative Control Inference with Invalid NCEs (2025)**：不要求預先知道每個 candidate NCE 都有效；在特定條件下，只要候選 NCE 中超過 50% 有效，可用 L1 程序選擇有效 NCE 並一致估計 causal effect。
2. **Instrumental and Proximal Causal Inference with Gaussian Processes (UAI 2026)**：用 Deconditional Gaussian Process（DGP）把 proximal / IV kernel estimator 升級成 probabilistic causal estimator；posterior mean 對應既有 kernel estimator，而 posterior variance 提供 epistemic uncertainty。
3. **Off-policy Predictive Control with Causal Sensitivity Analysis (UAI 2025)**：部分可觀測 / hidden confounding 下，不必硬輸出 point causal prediction；可在 sensitivity model 下建立 interventional outcome bounds，並讓 controller 基於 bounds 規劃。
4. **Delphic Offline RL**：將 hidden-confounding uncertainty 與 aleatoric / epistemic uncertainty 分開；當多個與 observational data 相容的世界模型對 action value 有顯著分歧時，這是一種額外的 `delphic uncertainty`。
5. **causalrl runtime**：實作上已出現很接近 Hermes 所需的 epistemic contract：`IDENTIFIED / BOUNDED / EMPIRICAL` certificate、explicit assumptions、witness / hedge、provenance，以及 `certify_policy()` 在 hidden confounding sensitivity + finite-sample downside gate 不通過時拒絕 policy。

---

# 本小時最重要 5 個發現

## 1. Proxy Candidate ≠ Valid Proxy：Proxy discovery 必須分成「候選生成」與「角色認證」

### 已確認事實
Negative control / proximal causal methods 依賴 proxy 的 causal role，而不是單純 correlation。有效 NCE 不應直接造成 outcome；有效 NCO 不應被 exposure/action 因果影響。

2025 `Double Negative Control Inference With Some Invalid Negative Control Exposures for Continuous Outcome` 更進一步指出：現實中 NCE validity 很難完全知道；作者在已知 valid NCO + 一組候選 NCE 的設定下，提出在超過 50% NCE 有效時的識別與 L1 selection procedure。

### 對 Hermes 的底層拆解
Hermes 不應：

```text
Tool metadata strongly correlates with Action
→ declare Treatment-Inducing Proxy
```

而應建立：

```text
Observation Channels
├ Context fields
├ Memory fields
├ Browser metadata
├ Tool outputs
├ MCP resources
├ Runtime metadata
├ Vision features
├ Audio features
└ User interaction traces
        ↓
Candidate Generator
        ↓
Role Hypothesis
├ NCE candidate
├ NCO candidate
├ Treatment-Inducing Proxy Z
├ Outcome-Inducing Proxy W
└ Ordinary Covariate X
        ↓
Validity Tests / Domain Constraints
        ↓
Bridge Fit + Residual Diagnostics
        ↓
Sensitivity / Invalid-Candidate Robustness
        ↓
Proxy Validity Contract
```

### 建議的 ProxyValidityContract

```text
ProxyValidityContract
├ variable_id
├ source_channel
├ proposed_role
├ temporal_order
├ exclusion_claim
├ domain_justification
├ negative_control_test
├ bridge_residual
├ invalid-candidate-robustness
├ encoder_version
├ schema_version
└ status
   ├ CANDIDATE
   ├ SUPPORTED
   ├ WEAK
   ├ INVALIDATED
   └ UNKNOWN
```

### 為什麼重要
LLM Agent 的 observation channels 很多，容易自動產生數百個「看似有用」的 proxy candidate。若只以 mutual information / feature importance 排序，很可能選到 action 後才產生、直接影響 outcome、或被 tool side-effect 污染的變數。

### 新否定關係

```text
Proxy Correlation ≠ Proxy Validity
Feature Importance ≠ Negative-Control Validity
Candidate Selection ≠ Causal Role Identification
```

---

## 2. Invalid Negative Controls 可以被「容忍與選擇」，但不是無條件自動化 discovery

### 論文
**Title:** Double Negative Control Inference With Some Invalid Negative Control Exposures for Continuous Outcome  
**Authors:** Qingqing Yang, Jinzhu Jia  
**Institution:** Department of Biostatistics, Peking University  
**Year:** 2025  
**URL:** https://doi.org/10.1002/sim.70276  
**Code:** supporting material published with article; no general Agent-runtime implementation verified this round  
**Dataset/Application:** simulations + UK Biobank application  
**Architecture:** valid NCO + candidate NCE set → sparse validity selection → double-negative-control estimation  
**Contribution:** causal effect can remain identifiable under some invalid NCEs; authors give L1-based selection and robust estimators under stated assumptions.  
**Limitation:** relies on structural assumptions including a majority-valid regime; does not solve arbitrary proxy discovery.

### Bottom-Level Logic
概念上可以映射為：

```text
Candidate NCE vector Z = [Z1 ... Zp]
↓
Moment / structural equations
↓
Sparse invalidity vector β
↓
L1 regularization
↓
Select/support candidate validity pattern
↓
Causal effect estimator
```

Hermes 的工程化版本不應直接照搬統計模型，而應吸收其核心原則：

```text
不要要求所有自動發現的 proxy 都完全正確
↓
讓候選池保留冗餘
↓
估計哪一些候選違反 role assumptions
↓
對 proxy-set corruption 做 robustness test
```

### 建議新增

```text
ProxySetRobustnessProfile
├ candidate_count
├ supported_count
├ invalidated_count
├ assumed_min_valid_fraction
├ leave-one-proxy-out effect shift
├ sparse-invalid fit
├ effect interval
└ action-flip-under-proxy-removal
```

### 工程推論
對 Agent 而言，「多個 proxy」不是越多越好；應量測：移除某個 proxy 後 causal conclusion 是否翻轉。若一個候選變數決定整個 action sign，這代表 proxy-role contract 很脆弱。

---

## 3. Bridge Point Estimate ≠ Bridge Knowledge：UAI 2026 DGP 補上 proximal causal 的 epistemic uncertainty

### 論文
**Title:** Instrumental and Proximal Causal Inference with Gaussian Processes  
**Authors:** Yuqi Zhang, Krikamol Muandet, Dino Sejdinovic, Edwin Fong, Siu Lun Chau  
**Year:** 2026, UAI 2026 / PMLR 337  
**URL:** https://proceedings.mlr.press/v337/zhang26f.html  
**Code:** 本輪未驗證公開官方 code repo，因此不虛構 code link  
**Dataset:** synthetic / benchmark experiments described in paper  
**Architecture:** Deconditional Gaussian Process for IV / Proxy causal learning  
**Contribution:** posterior mean recovers popular kernel estimators；posterior variance provides epistemic uncertainty；marginal log-likelihood enables model selection。  
**Limitations:** uncertainty quality depends on kernel / GP model assumptions and does not itself validate proxy exclusion restrictions.

### Bottom-Level Logic
上一輪的 RKHS minimax bridge 可寫成「求一個 h/q」。這輪要再加一層：

```text
Observed proxy data D
↓
Kernel / conditional embedding operator
↓
Deconditional operator
↓
GP posterior over bridge / causal function
↓
Posterior mean μ(x)
+
Posterior variance σ²(x)
↓
Causal prediction distribution
```

因此 Hermes 不應只保存：

```text
bridge_effect = +0.18
```

而應保存：

```text
BridgePosterior
├ mean_effect
├ posterior_variance
├ credible_interval
├ kernel_config
├ marginal_likelihood
├ training_support
├ proxy_contract_ids
└ representation_version
```

### 為什麼重要
先前 Hermes 已有：
- aleatoric uncertainty
- epistemic uncertainty
- OOD
- delphic / hidden-confounding risk（概念上）

現在可以進一步分：

```text
Twin Epistemic Uncertainty
≠
Bridge Epistemic Uncertainty
≠
Hidden-Confounding Sensitivity
```

`Bridge EU` 是「在既定 proxy / identification model 下，bridge function 還有多少資料/模型不確定性」；`Sensitivity` 則是「如果 identification assumption 被違反一定程度，結論會變多少」。兩者不能混成一個 confidence。

### 新否定關係

```text
Bridge Residual Small ≠ Bridge Certain
Posterior Variance Small ≠ Proxy Valid
Precise Causal Estimate ≠ Identified Causal Estimate
```

---

## 4. Hidden confounding 應該輸出「decision bounds」，不是只輸出風險分數

### 論文
**Title:** Off-policy Predictive Control with Causal Sensitivity Analysis  
**Authors:** Myrl G. Marmarelis, Ali Hasan, Kamyar Azizzadenesheli, R. Michael Alvarez, Anima Anandkumar  
**Year:** 2025, UAI 2025  
**URL:** https://proceedings.mlr.press/v286/marmarelis25a.html  
**Architecture:** partial-observation predictive model → generalized causal sensitivity model over action/state trajectories → interventional outcome bounds → model-predictive controller  
**Contribution:** sensitivity model accommodates hidden confounding with memory and produces tractable bounds used in control.  
**Limitations:** result depends on chosen/calibrated sensitivity budget; bound validity does not mean the true confounding strength is known.

### 對 Hermes 的關鍵轉換
以前：

```text
hidden_confounder_risk = .72
```

新的 Planner API 應是：

```text
Action Causal Value Bounds

SEARCH       [0.41, 0.56]
ASK_USER     [0.38, 0.61]
MCP_WRITE    [-0.22, 0.49]
COMMIT       [-0.51, 0.44]
```

若 safety threshold = 0：

```text
SEARCH     certified positive
ASK_USER   certified positive
MCP_WRITE  sign uncertain
COMMIT     sign uncertain
```

因此 Planner 不應用 posterior mean 排序，而應加入 worst-case / bound-aware gate：

```text
candidate action
↓
nominal value
↓
proximal / sensitivity bound
↓
bridge epistemic interval
↓
side-effect cost
↓
robust lower bound
↓
ACT / VERIFY / ABSTAIN / HUMAN / BLOCK
```

### Action Flip Risk
新增核心量：

```text
HiddenConfounderActionFlipRisk
=
P / possibility that preferred action ranking changes
within allowed hidden-confounding + bridge-uncertainty envelope
```

這比「causal confidence = 0.8」更接近 planner 真正需要的資訊。

---

## 5. GitHub 原始碼：`causalrl` 已出現可直接借鑑的 Causal Certificate Runtime

### GitHub
**Repo:** https://github.com/raphaelrrcoelho/causalrl

本輪不只讀 README，實際追到：

```text
src/causalrl/
├ agents/
├ bounds/
├ certify/
│  ├ __init__.py
│  ├ adapters.py
│  ├ certificate.py
│  └ routines.py
├ conformal/
├ discovery.py
├ estimate/
├ identification/
├ ope/
│  ├ bounds.py
│  ├ certify.py
│  ├ ipw.py
│  └ sequential.py
└ scm/
```

### `certify/certificate.py`
核心 `Kind` 明確區分：

```text
IDENTIFIED
BOUNDED
EMPIRICAL
```

`Certificate` 同時保存：

```text
claim
estimand
kind
value
confidence interval
assumptions
method
witness
hedge
provenance
```

這與 Hermes 需要的「永遠區分已確認事實 / 論文結果 / 工程推論 / 假說」高度一致：**epistemic status 必須進資料結構，而不是只寫在自然語言。**

### `certify/routines.py`
`msm_policy_value_bounds_certified()` 不會把 sensitivity result 偽裝成 point identification，而是建立：

```text
kind = BOUNDED
assumption = MSM(gamma)
value = [lower, upper]
```

同時 `identify_effect_certified()` 會把不可由資料驗證的 graph parent-completeness assumption 明列為 `checkable=False`。

### `ope/certify.py`
`certify_policy()` 的 runtime 邏輯更值得 Hermes 直接借鑑：

```text
confounded logs
↓
learned policy target actions
↓
MSM hidden-confounding robustness
↓
policy-value contrast certificate
↓
(optional) finite-sample conformal downside LCB
↓
若 evidence 不足 → REFUSE
```

原始碼甚至明確採用：

```text
no evidence is not evidence of safety
```

這不是 UI slogan，而是 runtime behavior：effectively weighted samples 不足時 LCB 保持 `-inf`，gate 會拒絕而不是放行。

### 對 Hermes 的 Architecture 啟示

```text
CausalInferenceResult
必須升級為
CausalDecisionCertificate
```

推薦 schema：

```text
CausalDecisionCertificate
├ claim
├ target_action
├ estimand
├ epistemic_kind
│  ├ IDENTIFIED
│  ├ BOUNDED
│  ├ EMPIRICAL
│  └ UNIDENTIFIED
├ nominal_value
├ robust_interval
├ bridge_uncertainty
├ confounding_sensitivity
├ proxy_contracts[]
├ assumptions[]
├ diagnostics[]
├ witness
├ hedge
├ provenance
├ representation_version
└ planner_verdict
   ├ ACT
   ├ VERIFY
   ├ ABSTAIN
   ├ HUMAN
   └ BLOCK
```

---

# Architecture Breakdown

```text
User / Goal
↓
Agent Context + World Observation
↓
Causal State Encoder
↓
Observation Channel Registry
├ Context
├ Memory
├ Browser
├ Tool
├ MCP
├ Vision
├ Audio
└ Runtime metadata
↓
Proxy Candidate Discovery
↓
Temporal / Exclusion Constraint Filter
↓
Role Assignment
├ X ordinary covariate
├ Z action-inducing proxy
├ W outcome-inducing proxy
├ NCE
└ NCO
↓
Proxy Set Robustness
├ invalid-candidate selection
├ leave-one-proxy-out
├ negative-control tests
└ role-stability test
↓
Proximal / Sensitivity Inference
├ h bridge
├ q bridge
├ bridge posterior
└ hidden-confounding sensitivity bounds
↓
Causal Decision Certificate
├ IDENTIFIED
├ BOUNDED
├ EMPIRICAL
└ UNIDENTIFIED
↓
Planner Robustness Gate
├ ACT
├ VERIFY
├ ABSTAIN
├ HUMAN
└ BLOCK
↓
Tool / MCP / Browser Action
↓
Observed outcome
↓
Update proxy contracts + bridge posterior + certificate
```

---

# Bottom-Level Logic

## A. Proxy-role discovery pipeline

```text
Raw variable V_i
↓
Temporal ordering check
↓
Can action cause V_i?
Can V_i directly cause target outcome?
Is V_i observed before action?
↓
Conditional independence / residual tests
↓
Negative-control role hypothesis
↓
Bridge fit
↓
Bridge residual / support / uncertainty
↓
Sensitivity to dropping V_i
↓
ProxyValidityContract
```

### 禁止的捷徑

```text
high correlation → proxy
LLM says plausible → proxy
feature importance high → proxy
embedding similarity → proxy
```

這些只能做 candidate generation，不能完成 role certification。

## B. Bridge uncertainty composition

Hermes 應把 causal action value 拆成至少三層：

```text
Q_causal(a)
├ central estimate
├ bridge epistemic interval
└ hidden-confounding sensitivity envelope
```

最終 robust interval 概念上：

```text
I_action
=
Union over plausible bridge models
and allowed confounding models
of
E[Y | do(A=a)]
```

而不是把各種 uncertainty 直接加成一個 score。

## C. Planner ranking under partial identification

```text
for each action a:
    certificate[a] = causal_certify(a)

if certificate[a].kind == UNIDENTIFIED:
    block or verify

robust_lower[a] = lower(certificate[a].robust_interval)
robust_upper[a] = upper(certificate[a].robust_interval)

choose ACT only when:
    robust_lower[a] > safety_floor
    and action ranking is stable enough
    and side-effect constraints pass
```

新增 `ActionRankingStability`：

```text
A dominates B only if:
Lower(A) > Upper(B)
```

如果 intervals overlap：

```text
A [0.21, 0.63]
B [0.18, 0.59]
```

Hermes 應標記：

```text
CAUSALLY AMBIGUOUS
```

而不是假裝 0.42 > 0.38 就有明確最佳 action。

---

# Visual Simulation Idea

## **Proxy Discovery × Causal Action Gate Lab**

### View 1：Observation → Proxy Role Graph

```text
                  latent U
               ↙     ↓      ↘
BrowserMeta ──?→ Action ─────→ Outcome
ToolTrace   ──?→   │            ↑
UserSignal  ──?→   │            │
MemoryFeat  ──?────┴────────────?
```

每個變數可以點擊，顯示：

```text
Candidate role: NCE
Temporal order: PASS
Direct-effect exclusion: UNVERIFIED
Negative-control residual: 0.04
Bridge contribution: 0.17
Leave-one-out effect shift: +0.02
Status: WEAKLY SUPPORTED
```

### View 2：Invalid Proxy Stress Test

slider：

```text
Assumed invalid proxy fraction
0% ───────── 50% ───────── 100%
```

即時看到 causal effect / action ranking：

```text
SEARCH    [0.42, .58]
ASK_USER  [0.39, .64]
MCP_WRITE [-.12, .51]
```

### View 3：Causal Certificate Stack

```text
ACTION: MCP_WRITE

Point estimate                 +0.31
Bridge epistemic interval      [+0.12,+0.49]
Hidden-confounding bound       [-0.09,+0.55]
Proxy-set robustness           WEAK
Negative control               PASS_WITH_WARNING
Identification kind            BOUNDED

Planner verdict                VERIFY FIRST
```

### View 4：Action Flip Map

X 軸：hidden-confounding sensitivity Γ  
Y 軸：bridge uncertainty scale  
顏色：preferred action

```text
Γ low                     Γ high
SEARCH SEARCH ASK_USER | VERIFY
SEARCH ASK_USER ASK_USER | VERIFY
ASK    ASK     UNKNOWN  | BLOCK
```

這會讓使用者直接看懂：**不是 AI「沒自信」而已，而是某些合理 hidden-world assumptions 一改，最佳 action 真的會換。**

---

# Code / GitHub

## 1. `raphaelrrcoelho/causalrl`
URL: https://github.com/raphaelrrcoelho/causalrl

### 值得繼續看的目錄

```text
src/causalrl/certify/
src/causalrl/ope/
src/causalrl/identification/
src/causalrl/bounds/
src/causalrl/discovery.py
src/causalrl/conformal/
```

### 本輪已實讀核心檔案
- `src/causalrl/certify/certificate.py`
- `src/causalrl/certify/routines.py`
- `src/causalrl/ope/certify.py`

### 對 Hermes 最值得借鑑
1. epistemic `Kind` 進入正式 schema。
2. assumptions 不只文字備註，而是 serialized fields。
3. witness / hedge 區分「為什麼成立」和「為什麼拒絕」。
4. sensitivity bound 與 finite-sample safety gate 可以共同決定 policy 是否放行。
5. `no evidence → refuse` 的 fail-closed behavior。

---

# Papers

## Paper A
**Title:** Instrumental and Proximal Causal Inference with Gaussian Processes  
**Authors:** Yuqi Zhang, Krikamol Muandet, Dino Sejdinovic, Edwin Fong, Siu Lun Chau  
**Venue/Year:** UAI 2026, PMLR 337  
**URL:** https://proceedings.mlr.press/v337/zhang26f.html  
**Code:** 未驗證官方 public code，本輪標記 `UNKNOWN`  
**Architecture:** Deconditional GP for IV / proximal causal learning  
**Contribution:** kernel-style point estimator + principled posterior epistemic uncertainty + marginal-likelihood model selection  
**Limitations:** uncertainty conditional on modeling assumptions; does not validate causal proxy roles by itself  
**改變了什麼:** 把「proximal bridge 估出一個值」提升成「bridge / causal function 有 posterior uncertainty」，可直接供 decision rejection / abstention 使用。

## Paper B
**Title:** Double Negative Control Inference With Some Invalid Negative Control Exposures for Continuous Outcome  
**Authors:** Qingqing Yang, Jinzhu Jia  
**Institution:** Peking University  
**Year:** 2025  
**URL:** https://doi.org/10.1002/sim.70276  
**Dataset:** simulation + UK Biobank application  
**Architecture:** valid NCO + candidate NCE set + L1 validity selection + robust DNC estimator  
**Contribution:** allows some invalid NCEs instead of assuming every negative control is correct  
**Limitations:** majority-valid and structural assumptions; not a general automatic proxy discovery method  
**改變了什麼:** 對 Hermes 意味著 proxy registry 可以保留候選集合，不必在 discovery 階段假裝 100% 正確，但必須顯式建模候選污染率。

## Paper C
**Title:** Off-policy Predictive Control with Causal Sensitivity Analysis  
**Authors:** Myrl G. Marmarelis, Ali Hasan, Kamyar Azizzadenesheli, R. Michael Alvarez, Anima Anandkumar  
**Year:** 2025, UAI 2025  
**URL:** https://proceedings.mlr.press/v286/marmarelis25a.html  
**Architecture:** predictive dynamics + generalized hidden-confounding sensitivity model + interventional bounds + MPC  
**Contribution:** sensitivity bounds enter control decisions rather than remaining an offline statistic  
**Limitations:** sensitivity level needs calibration / domain judgment  
**改變了什麼:** 直接支持 Hermes 把 hidden-confounder sensitivity 送入 planner action gate。

## Paper D
**Title:** Delphic Offline Reinforcement Learning under Nonidentifiable Hidden Confounding  
**Authors:** Alizée Pace, Hugo Yèche, Bernhard Schölkopf, Gunnar Rätsch, Guy Tennenholtz  
**Year:** 2023/2024 line of work  
**URL:** https://arxiv.org/abs/2306.01157  
**Architecture:** multiple observationally compatible world models → delphic uncertainty → pessimistic offline RL  
**Contribution:** hidden-confounding ambiguity is separated from aleatoric / epistemic uncertainty  
**Limitations:** nonidentifiability remains; method mitigates rather than eliminates hidden confounding  
**改變了什麼:** Hermes 的 uncertainty taxonomy 應增加 `delphic / causal ambiguity`，不能把所有未知都歸類成 epistemic。

## Paper E
**Title:** Discovering Causal Relationships using Proxy Variables under Unmeasured Confounding  
**Authors:** Yong Wu, Yanwei Fu, Shouyan Wang, Yizhou Wang, Xinwei Sun  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2510.17167  
**Architecture:** single-NCO nonparametric integral-equation identification + kernel test；必要時加入 NCE 恢復 identifiability  
**Contribution:** proxy / NCO 不只用來 effect estimation，也能用於 causal hypothesis testing / discovery under unmeasured confounding  
**Limitations:** completeness / regularity assumptions；仍需要可信 proxy roles  
**改變了什麼:** 下一步 Hermes 可把 `proxy discovery` 與 `causal-edge hypothesis testing` 接起來，而非只讓 proxy 作 adjustment input。

---

# 已確認事實 / 工程實作 / 推論 / 假說分級

## 已確認 / 論文支持
- Invalid negative controls 會造成 bias；在特定 majority-valid regime 下可設計選擇與 robust estimation。
- UAI 2026 DGP work 提供 proximal / IV causal learning 的 epistemic uncertainty。
- hidden-confounding sensitivity bounds 可以進入 predictive controller。
- hidden-confounding ambiguity可與 aleatoric / epistemic uncertainty 分開建模。
- `causalrl` 原始碼具備 IDENTIFIED / BOUNDED / EMPIRICAL certificate 與 fail-closed policy certification pattern。

## 工程實作建議
- ProxyValidityContract
- ProxySetRobustnessProfile
- BridgePosterior
- CausalDecisionCertificate
- ActionRankingStability
- HiddenConfounderActionFlipRisk

## 合理推論
- Agent observation channels可作 proxy candidate pool，但 role validity必須依 temporal/exclusion/domain/bridge diagnostics 篩選。
- bridge posterior uncertainty + sensitivity interval 可以共同構成 planner robust interval。

## 尚未驗證假說
- 可完全自動、domain-free 地從任意 Agent event stream 發現可靠 Z/W proxy roles。
- LLM 本身可以可靠判斷 exclusion restriction。
- 一套單一 sensitivity parameter 能跨 Browser / MCP / User / Vision observation channel 通用。

---

# Unknown / Open Questions

## 1. Proxy role discovery 如何避免 circularity？
若同一批 data 同時用來：
- 選 proxy
- fit bridge
- test negative control
- certify action

可能導致 selection-induced optimism。需研究 sample splitting / cross-fitting / held-out proxy validation。

## 2. Sensitivity budget Γ 如何校準？
若 Γ 只是人工 slider，certificate 只是「在你選的 Γ 下成立」。需要從 observed proxy strength、domain benchmark、real intervention data 或 simulator calibration建立 Γ prior / range。

## 3. 多模態 proxy 要怎麼定義 causal role？
Vision/audio embedding 是高維 learned representation；其一個 dimension 沒有清楚語義。需要研究 representation-level negative controls、channel masking、temporal interventions，以及 proxy-role transport across encoder versions。

---

# 下一輪研究

下一輪建議聚焦：

# **Cross-Fitted Proxy Discovery × Sensitivity-Budget Calibration × Delphic Uncertainty × Robust Action Dominance**

研究流程：

```text
Agent Event Stream
↓
Proxy candidate generation
↓
Cross-fitting / held-out role validation
↓
NCE / NCO / Z / W role score
↓
Bridge posterior
↓
Sensitivity-budget calibration Γ
↓
Delphic compatible-world ensemble
↓
Action causal intervals
↓
Robust dominance / action flip analysis
↓
Planner gate
```

重點問題：
1. 如何避免 proxy selection + bridge fitting 使用同資料造成 overconfidence？
2. 如何從 real/sim intervention data 校準 Γ，而不是任意設定？
3. 如何把多个 compatible causal worlds 的 disagreement 變成 Hermes 的 `delphic uncertainty`？
4. 何時一個 action 對所有合理世界都支配其他 action？

---

# Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Proxy Candidate Pool
Proxy Role Discovery
Proxy Validity Contract
Invalid Negative Control
Majority-Valid Proxy Set
Sparse Invalid-Proxy Selection
Proxy Set Robustness
Bridge Posterior
Bridge Epistemic Uncertainty
Deconditional Gaussian Process
Causal Sensitivity Envelope
Delphic Uncertainty
Compatible Causal World
Causal Decision Certificate
Epistemic Kind
Identified Claim
Bounded Claim
Empirical Claim
Unidentified Claim
Causal Hedge
Action Ranking Stability
Robust Action Dominance
Hidden Confounder Action Flip Risk
Sensitivity Budget Gamma
```

## 新 Edges

```text
Proxy Correlation ≠ Proxy Validity
Candidate Proxy ≠ Certified Proxy
Negative-Control Candidate ≠ Valid Negative Control
Bridge Point Estimate ≠ Bridge Knowledge
Posterior Variance Small ≠ Proxy Valid
Precise Estimate ≠ Identified Estimate
Bounded ≠ Identified
Empirical ≠ Causal
Hidden-Confounding Sensitivity ≠ Epistemic Uncertainty
Delphic Uncertainty ≠ Aleatoric Uncertainty
Delphic Uncertainty ≠ Ordinary Epistemic Uncertainty
No Evidence ≠ Evidence Of Safety
Overlapping Action Bounds ≠ Stable Action Ranking
LLM Plausibility ≠ Exclusion Restriction
```

---

# 每輪結束必答

**缺哪一層？**  
缺 `Cross-Fitted Proxy Discovery + Sensitivity-Budget Calibration`：目前已能表示 proxy contract、bridge uncertainty 與 hidden-confounding bound，但還缺避免 proxy-selection overfitting 的正式資料流程，以及 Γ 的可驗證校準方法。

**哪個節點最淺？**  
`HiddenConfounderActionFlipRisk`、`ProxyRoleScore`、`SensitivityBudgetCalibration`。

**哪個概念仍只是名詞？**  
`Automatic Multimodal Proxy Discovery`。目前沒有證據支持它可以 domain-free 自動完成 exclusion / proxy-role identification。

**哪個系統值得讀原始碼？**  
`raphaelrrcoelho/causalrl`，下一輪優先讀 `src/causalrl/ope/bounds.py`、`src/causalrl/identification/decision.py`、`src/causalrl/conformal/` 與 `src/causalrl/discovery.py`。

**哪篇論文需追引用？**  
第一優先：`Instrumental and Proximal Causal Inference with Gaussian Processes`（UAI 2026），因為它直接補足 proximal causal 的 epistemic uncertainty；第二優先：`Off-policy Predictive Control with Causal Sensitivity Analysis`，因為它把 sensitivity bounds 接到控制。

**哪個概念最適合視覺模擬？**  
`Proxy Discovery × Causal Action Gate Lab`，尤其是 Action Flip Map（Γ × bridge uncertainty → preferred action）。

**哪個 Agent 架構最值得實作？**  

```text
Causally-Certified Planner Runtime
=
Causal State Encoder
+ Proxy Registry
+ Proxy Validity Contracts
+ Proximal Bridge Posterior
+ Hidden-Confounding Sensitivity Bounds
+ Delphic / Epistemic Uncertainty Separation
+ Causal Decision Certificate
+ Robust Planner Gate
```

---

# 與整體「AI 到底怎麼運作」知識圖譜的連接

目前完整鏈條再補一層：

```text
使用者一句話
↓
UI
↓
Agent Runtime
↓
Context / Memory
↓
Reasoning / Planning
↓
Tool / MCP / Browser
↓
Observed World Signals
↓
Causal State Encoder
↓
Proxy / Negative-Control Channels
↓
Latent Confounder Handling
├ proximal bridge
├ sensitivity model
└ compatible-world ambiguity
↓
Causal Action Certificate
↓
Planner Gate
↓
Action
↓
World State Transition
↓
Outcome / feedback
```

多模態則是：

```text
Camera / Image / Voice / Video
↓
Encoder
↓
Multimodal Tokens / Features
↓
Fusion
↓
Reasoning
↓
Agent State
↓
[注意：Observed Multimodal State ≠ Full World State]
↓
Proxy-role / causal-state layer
↓
Causal Planner Gate
↓
Action
```

本輪核心結論：**當 AI 的 observation 只是世界的一部分時，「我估計這個 action 很好」與「我有因果理由相信這個 action 很好」是兩件不同的事。成熟 Agent 應把 identification status、proxy validity、bridge uncertainty、hidden-confounding sensitivity 與 action-ranking stability一起編成可機器判讀的 certificate；只有 certificate 足夠強時才允許高風險 Tool/MCP/Browser action。**

---

# Sources

- Yang, Q.; Jia, J. (2025). Double Negative Control Inference With Some Invalid Negative Control Exposures for Continuous Outcome. Statistics in Medicine. https://doi.org/10.1002/sim.70276
- Zhang, Y.; Muandet, K.; Sejdinovic, D.; Fong, E.; Chau, S. L. (2026). Instrumental and Proximal Causal Inference with Gaussian Processes. UAI 2026 / PMLR 337. https://proceedings.mlr.press/v337/zhang26f.html
- Marmarelis, M. G.; Hasan, A.; Azizzadenesheli, K.; Alvarez, R. M.; Anandkumar, A. (2025). Off-policy Predictive Control with Causal Sensitivity Analysis. UAI 2025. https://proceedings.mlr.press/v286/marmarelis25a.html
- Pace, A.; Yèche, H.; Schölkopf, B.; Rätsch, G.; Tennenholtz, G. Delphic Offline Reinforcement Learning under Nonidentifiable Hidden Confounding. https://arxiv.org/abs/2306.01157
- Wu, Y.; Fu, Y.; Wang, S.; Wang, Y.; Sun, X. (2025). Discovering Causal Relationships using Proxy Variables under Unmeasured Confounding. https://arxiv.org/abs/2510.17167
- causalrl source: https://github.com/raphaelrrcoelho/causalrl
