# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 22:54（Asia/Taipei）**

## 本輪研究主題
**Causal State Discovery × Negative Controls × Proximal Causal Bridges × Hidden-Confounder Sensitivity × Representation Drift**

> 本輪承接上一輪 `Causal History Compression × Sequential Ignorability Diagnostics × Support Repair`，不再重複討論「如何把 history 壓短」，而是追問更深一層：**壓縮後的 state 到底只是 predictive/control state，還是真的足以做 causal adjustment？若 latent confounder 沒被觀察，Hermes 能否利用 negative-control / proxy variables 做 falsification、bridge identification 或 sensitivity bounds？當 representation encoder 更新後，舊 propensity / calibration / support certificate 是否仍有效？**

---

# 本小時新發現

## 新架構
1. **Proximal Causal State Runtime**：把 Agent history encoder 從單純 compressed state 升級為 `Observed State + Treatment-Inducing Proxy + Outcome-Inducing Proxy + Bridge Functions + Sensitivity Envelope`。
2. **Causal State Contract**：任何被標記為 causal-adjustment state 的 representation，必須同時攜帶 action sufficiency、proxy validity、negative-control diagnostics、sensitivity bounds、encoder version 與 drift status。
3. **Representation Drift Invalidation Graph**：encoder / summarizer / tool-schema / memory-policy 任一更新後，沿依賴圖判斷哪些 propensity、risk、OPE、support、calibration certificate 必須失效重估。

## 新 GitHub / 原始碼
### `syanga/proxci`
核心目錄：

```text
proxci/
├── minimax.py
├── minimax_core.py
├── point_metrics.py
├── proxci_dataset.py
└── proximal_inference.py
```

值得看的核心檔案：
- `proxci/minimax_core.py`
- `proxci/proximal_inference.py`
- `proxci/proxci_dataset.py`

實作不是一般 propensity regression；`minimax_core.py` 直接解 RKHS minimax 的 KKT system，用兩組 Gram matrices 學 bridge nuisance functions；`proximal_inference.py` 分別估計 `h` 與 `q`，再提供 POR、PIPW 與 doubly-robust proximal estimator。

---

# 本小時最重要 5 個發現

## 1. Predictive State ≠ Causal Adjustment State

### 概念
上一輪已確認：representation 可同時需要 Markov sufficiency、action sufficiency、tool-selection sufficiency。這一輪進一步確認：

```text
State 足以預測下一步
≠
State 足以阻斷 treatment/action 與 outcome 間的 hidden confounding
```

Action-Sufficient Goal Representations 顯示 value sufficiency 不推出 action sufficiency；同理，action sufficiency 也沒有自動推出 ignorability。

### 底層如何運作
Hermes 應分三種 state contract：

```text
PredictiveState
ControlState
CausalAdjustmentState
```

其中 `CausalAdjustmentState` 需要額外記錄：

```text
CausalAdjustmentStateCertificate
├ observed_covariates
├ action_sufficiency_score
├ negative_control_set
├ proxy_role_assignments
├ bridge_identification_status
├ sensitivity_bound
├ positivity_status
├ encoder_version
└ drift_status
```

### 為什麼重要
否則 Hermes 可能用一個控制表現很好的 embedding 去估 propensity / causal effect，卻漏掉只有 policy 能看到、encoder 沒保存的 latent confounder。

### 限制
沒有任何一般-purpose representation test 可以「證明」不存在 hidden confounding；這只能累積 evidence、做 falsification、proximal identification 或 sensitivity analysis。

---

## 2. Negative Controls 不是裝飾性 sanity check，而是 hidden-confounding sensor

### 概念
Negative-control exposure/outcome 的目的，是找一個在 causal graph 上**理論上不應有指定因果路徑**的變數；若調整後仍看到系統性 association，代表 causal state / adjustment set 可能漏掉 confounding、selection 或 measurement mechanism。

### Agent 映射
Hermes 可建立：

```text
NegativeControlOutcome
例如：某 action 理論上不應改變的 audit-only field

NegativeControlExposure
例如：不應影響目標 outcome 的 irrelevant tool metadata
```

### Runtime

```text
Candidate Causal State Z_t
↓
fit action / outcome models
↓
run negative-control tests
↓
residual association?
├ NO  → evidence supportive, NOT proof
└ YES → confounding / leakage / selection alarm
```

### 為什麼重要
這比只看 balance 或 predictive accuracy 更接近「模型是不是漏掉了不該漏的東西」。

### 限制
Negative control 本身必須有 domain-credible exclusion restriction；選錯 negative control 會產生假警報或假安全感。

---

## 3. Proximal Causal Inference：當 confounder 看不到時，用兩類 proxy bridge 取代直接觀測 U

### 核心概念
Proximal causal inference 不要求 latent confounder `U` 被直接觀察，而使用兩類 proxy：

```text
Z = treatment/action-inducing proxy
W = outcome-inducing proxy
```

並尋找 bridge functions，使 proxy 的 conditional moment equation 把 U 的影響間接消掉。

### proxci 原始碼拆解
`ProximalInference` 先估 `h`：

```text
r1, r2, A, Y
↓
g1 = -1(A=a)
g2 = Y·1(A=a)
↓
MinimaxRKHSCV
↓
h_a(r1)
```

再估 `q`：

```text
swap r1/r2
↓
g1 = -1(A=a)
g2 = 1
↓
MinimaxRKHSCV
↓
q_a(r2)
```

最後 DR estimator 實際組合：

```text
I1·(Y-h1)·q1 + h1
-
[I0·(Y-h0)·q0 + h0]
```

### Bottom-Level Mechanism：RKHS Minimax KKT
`minimax_core.py` 求：

```text
h = argmin_h max_f
E[f(r2)·(h(r1)·g1 + g2) - f(r2)^2]
+ regularization
```

實作層把 h、f 放進 RKHS，以 Gram matrices 組 KKT linear system，再解 `alpha, beta`。

這不是「把 proxy 丟進神經網路」；它是在解 conditional moment / integral-equation 類型的 bridge estimation 問題。

### 對 Hermes 的意義
若 Agent runtime 存在：
- policy 看不到但影響 action 的 hidden user intent
- tool/backend hidden state
- external world latent regime

而 history 中有可信的不同 proxy channels，Hermes 可以研究 proximal bridge，而不是直接宣告 ignorability。

### 限制
Proxy validity、bridge existence/identification、support/regularity 仍是強條件；proximal ≠ hidden confounding automatically solved。

---

## 4. Proximal Reinforcement Learning 把 bridge idea 延伸到 POMDP / sequential decision

### 概念
Proximal Reinforcement Learning 研究的正是：behavior policy 可能依賴未觀察 state，僅看到 partial observations 時，如何做 target-policy value identification / OPE。

### Agent architecture 對應

```text
Latent World U_t
↓
Observed History H_t
├ proxy channel Z_t
├ proxy channel W_t
├ action A_t
└ reward/outcome Y_t
↓
Sequential Bridge Functions
↓
Policy Value Estimator
```

因此上一輪的：

```text
Full history
→ compressed causal state
```

應被改寫成：

```text
Full history
→ learned state representation
→ proxy-role discovery
→ bridge feasibility test
→ proximal/sequential estimator
→ sensitivity envelope
```

### 為什麼重要
這直接對應長期 Agent：observed context 從來不保證是 full world state；tool APIs、browser、user、memory 都只是 observation channels。

### 限制
Proximal RL 的識別條件仍不是免費得到；工程上更難的是從真實 Agent telemetry 中找到可信 proxy role，而不是事後任意指定。

---

## 5. Representation Drift 會讓舊的 causal certificate 失效，即使 task accuracy 沒掉

### 概念
若 history encoder / summarizer / memory compactor 從 `φ_v17` 更新成 `φ_v18`：

```text
Raw history H
↓ φ_v17
Z17

Raw history H
↓ φ_v18
Z18
```

即使兩者 task success 都 90%，以下東西可能全部改變：

```text
P(A|Z)
proxy relationships
balance
support
negative-control residual
bridge solution
risk calibration
```

### Hermes 需要

```text
RepresentationVersion
↓
Dependency Graph
├ propensity model
├ support map
├ negative-control test
├ bridge functions
├ OPE estimator
├ risk calibrator
└ trajectory certificate
```

encoder 更新後：

```text
Representation Drift Auditor
↓
which downstream invariants changed?
↓
KEEP / REWEIGHT / RECALIBRATE / REFIT / INVALIDATE
```

### 新指標

```text
RepresentationDriftProfile
├ latent_distribution_shift
├ action_conditional_shift
├ proxy_role_stability
├ negative_control_residual_delta
├ support_overlap_delta
├ bridge_residual_delta
├ calibration_delta
└ certificate_invalidation_count
```

### 關鍵原則

```text
Task Accuracy Stable
≠
Causal Semantics Stable
```

---

# Architecture Breakdown

```text
Raw Agent Event Stream
↓
Typed Temporal Graph
↓
History Encoder φ_v
↓
Multi-View State
├ predictive view
├ control/action view
├ risk/security view
└ proxy candidate views
↓
Causal State Discovery Layer
├ action sufficiency
├ temporal sufficiency
├ negative-control diagnostics
├ proxy-role tests
└ support checks
↓
Proximal Bridge Layer
├ treatment/action bridge q
├ outcome bridge h
└ minimax conditional-moment solver
↓
Sensitivity Layer
├ hidden-confounder stress test
├ partial-identification bound
└ unsupported-assumption registry
↓
Sequential / Policy Estimation
↓
Causal State Certificate
↓
Agent Risk / OPE / Verification Policy
↓
Representation Drift Monitor
↓
KEEP / RECALIBRATE / REFIT / INVALIDATE
```

---

# Bottom-Level Logic

## A. Negative-control falsification

```text
Observed state Z
↓
fit adjusted causal model
↓
choose NC outcome Y_nc
↓
test residual association A ↔ Y_nc | Z
↓
association remains?
├ yes → state likely misses confounding / selection / leakage
└ no  → assumption survives this falsification only
```

**重要：** `negative-control test passes ≠ ignorability proven`。

## B. Proximal bridge estimation

```text
Action A
Outcome Y
Observed X
Treatment-inducing proxy Z
Outcome-inducing proxy W
↓
construct conditional moment equations
↓
RKHS kernels K1,K2
↓
Gram matrices
↓
min_h max_f objective
↓
KKT linear system
↓
bridge h / q
↓
proximal DR estimator
```

## C. Representation drift invalidation

```text
φ_v17 → φ_v18
↓
re-embed audit replay buffer
↓
measure conditional drift
↓
re-run NC / proxy / overlap / bridge residual diagnostics
↓
trace dependency graph
↓
certificate status:
VALID
STALE
RECALIBRATE
REFIT
INVALID
```

---

# Visual Simulation Idea

## **Causal State Discovery × Hidden Confounder Lab**

左側：完整 trajectory graph

```text
U_t  (hidden)
│ ↘
│   Action A_t
│      ↓
├→ Proxy Z_t
├→ Proxy W_t
│      ↓
└──────── Outcome Y
```

中央讓使用者切換 encoder：

```text
φ_v16
φ_v17
φ_v18
```

右側即時顯示：

```text
Action sufficiency          .94
Outcome prediction          .91
Negative-control residual   .03
Proxy role stability        .88
Bridge residual             .06
Overlap                     GOOD
Sensitivity bound           [-.08,.14]

CAUSAL STATE STATUS:
SUPPORTED / NOT PROVEN
```

若更新 encoder：

```text
φ_v18
Negative-control residual  .03 → .22   ⚠
Bridge residual            .06 → .31   ✕
Support overlap            GOOD → WEAK
```

畫面直接將舊 certificate 標為：

```text
STALE — REFIT REQUIRED
```

第二個互動頁可做 **Proxy Bridge Viewer**：拖動 `Z/W` 角色，觀看 minimax bridge residual、DR estimate、sensitivity interval 如何改變。

---

# Code / GitHub

## `syanga/proxci`
**值得閱讀順序：**
1. `proxci/proximal_inference.py` — h/q nuisance estimation 與 POR/PIPW/DR estimator
2. `proxci/minimax_core.py` — RKHS minimax KKT system；本輪最重要 bottom-level code
3. `proxci/minimax.py` — kernel/CV wrapper
4. `proxci/proxci_dataset.py` — proxy dataset / crossfit structure
5. `datagen.py` — synthetic data generating assumptions

### 原始碼觀察
- bridge functions 並不是一般 supervised target；它們透過 moment violation 的 adversarial/minimax criterion 被估。
- h/q 在不同 proxy views 上估計，最後 DR 結合 outcome residual 與 bridge weights。
- cross-fitting 是 first-class option，避免同一資料同時估 nuisance 與 evaluation functional 時產生額外 bias。

---

# Papers

## 1. Causal Inference Under Unmeasured Confounding With Negative Controls: A Minimax Learning Approach
- **Authors:** Nathan Kallus, Xiaojie Mao, Masatoshi Uehara
- **Institution:** Cornell / collaborators
- **Year:** 2021–2022
- **URL:** https://arxiv.org/abs/2103.14029
- **Architecture:** negative controls → two bridge functions → minimax estimation → causal functional
- **Contribution:** 將 negative-control bridge functions 的識別/估計從 parametric/completeness-heavy做法推到 minimax general function classes。
- **Limitations:** negative-control/proxy validity 與 identification assumptions 仍需外部論證。
- **改變了什麼:** hidden confounding 不再只剩「假設 ignorability」或「放棄估計」兩條路，而可透過 proxy bridge 建立另一種識別路徑。

## 2. Minimax Kernel Machine Learning for a Class of Doubly Robust Functionals with Application to Proximal Causal Inference
- **Authors:** AmirEmad Ghassami, Andrew Ying, Ilya Shpitser, Eric Tchetgen Tchetgen
- **Institution:** UPenn / Johns Hopkins 等
- **Year:** AISTATS 2022
- **URL:** https://proceedings.mlr.press/v151/ghassami22a.html
- **Code:** https://github.com/syanga/proxci
- **Architecture:** conditional moment equations → RKHS nuisance functions → minimax optimization → doubly robust functional
- **Contribution:** 對 integral-equation nuisance functions 建立 minimax kernel estimator 與 DR estimating equations。
- **Limitations:** kernel scaling、regularization、proxy/bridge identification 條件與高維 representation 對工程落地仍是挑戰。
- **改變了什麼:** 把 proximal bridge 從概念推到可執行 kernel/KKT solver。

## 3. Proximal Reinforcement Learning: Efficient Off-Policy Evaluation in Partially Observed Markov Decision Processes
- **Authors:** Andrew Bennett, Nathan Kallus
- **Institution:** Cornell Tech
- **Year:** Operations Research 2024（arXiv 2021/2023 revisions）
- **URL:** https://arxiv.org/abs/2110.15332
- **Dataset/experiments:** simulation + sepsis management
- **Architecture:** partially observed trajectories → sequential bridge functions → target-policy value estimator
- **Contribution:** 把 proximal identification 延伸到 POMDP / offline RL。
- **Limitations:** bridge assumptions 與 proxy construction 在一般 Agent telemetry 中不會自動滿足。
- **改變了什麼:** 直接打破「OPE 一定需要 fully observed Markov state」的工程直覺。

## 4. Unifying Causal Representation Learning with the Invariance Principle
- **Authors:** Dingling Yao, Dario Rancati, Riccardo Cadei, Marco Fumero, Francesco Locatello
- **Year:** 2024/2025 line of work
- **URL:** https://arxiv.org/abs/2409.02772
- **Architecture:** latent representation discovery through symmetry/invariance alignment
- **Contribution:** 指出許多所謂 causal representation 方法的共同核心可理解為 representation 對已知 data symmetries 的 alignment；不應把 representation identification 過度解讀成 causal-variable discovery。
- **Limitations:** invariance chosen incorrectly 時，representation 仍可能保留錯誤 equivalence classes。
- **改變了什麼:** 對 Hermes 很重要：`representation invariance ≠ causal sufficiency`。

## 5. Action-Sufficient Goal Representations
- **Authors:** Jinu Hyeon, Woobin Park, Hongjoon Ahn, Taesup Moon
- **Institution:** Seoul National University / Trillion Labs
- **Year:** ICML 2026
- **URL:** https://arxiv.org/abs/2601.22496
- **Code:** https://github.com/action-sufficient/action-sufficient
- **Architecture:** goal representation → actor/value sufficiency gaps → actor-derived representation
- **Contribution:** 證明 value sufficiency 不保證 action sufficiency。
- **Limitations:** action sufficiency 本身仍不是 causal ignorability。
- **改變了什麼:** 幫助 Hermes 把 `control representation` 與 `causal adjustment representation` 明確分層。

---

# 已確認事實 / 工程實作 / 合理推論 / 尚未驗證假說

## 已確認 / 論文結果
- negative controls / proximal bridge functions 可在特定識別條件下處理 latent confounding。
- Proximal RL 已把此框架延伸到 partial-observation sequential policy evaluation。
- action/value sufficiency 不是同一件事。

## 已確認工程實作
- `proxci` 真實實作 RKHS minimax KKT solver、h/q nuisance functions、cross-fitting、POR/PIPW/DR estimators。

## 合理工程推論
- Hermes 應把 Agent telemetry 中不同 modalities/tool channels 視為候選 proxy views，再經 domain constraints / graph rules 驗證，而不是把所有 embedding dimension 自動視為 proxy。
- representation encoder version 應成為 propensity/OPE/calibration certificate 的 dependency key。

## 尚未驗證假說
- 一般-purpose LLM Agent 是否能自動從 event graph discovery 出可靠 negative controls / proximal proxy roles，目前沒有足夠 evidence。
- 直接在 learned high-dimensional Agent embeddings 上解 proximal bridge，是否會比 typed low-dimensional proxy variables 更穩定，尚待實驗。

---

# Unknown / Open Questions

1. **Proxy-role discovery 如何避免 circularity？** 若同一 LLM 同時生成 causal graph、挑 negative control、再判斷 test pass，可能產生 confirmation loop。
2. **Sequential bridge 的 representation 版本切換怎麼修復？** φ 更新後是否可 transport 舊 bridge，還是必須完全 refit？
3. **Hidden confounding sensitivity 如何轉成 Agent action gate？** 需要把 effect bound 映射成 action flip risk / safety budget，而不只是統計區間。

---

# 下一輪研究

下一輪最值得追：

## **Proximal Proxy Discovery × Negative-Control Search × Causal-State Sensitivity Gate × Versioned Bridge Transport**

流程：

```text
Typed Agent Event Graph
↓
Candidate proxy variables
↓
Graph-based exclusion filters
↓
Negative-control tests
↓
Proxy role scoring
↓
Bridge feasibility / residual
↓
Sensitivity bound
↓
Action decision sensitivity
↓
Causal-state certificate
↓
encoder/model update
↓
bridge transportability test
↓
KEEP / REFIT / INVALIDATE
```

需特別研究：
- proximal proxy discovery 是否能用 causal graph / multimodal channel separation 幫助識別；
- negative controls 在 Tool/MCP/Memory/Browser channels 中如何系統化生成；
- bridge residual 能否成為 runtime monitoring signal；
- representation drift 下的 bridge-function transportability；
- sensitivity bound → planner action flip probability 的映射。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Causal Adjustment State
Predictive State
Control State
Negative Control Exposure
Negative Control Outcome
Treatment-Inducing Proxy
Outcome-Inducing Proxy
Proximal Bridge Function
Outcome Bridge h
Treatment Bridge q
Conditional Moment Equation
RKHS Minimax Bridge Solver
Bridge Residual
Proximal Doubly Robust Estimator
Sequential Proximal Bridge
Proxy Validity Contract
Causal State Certificate
Representation Version
Representation Drift Profile
Bridge Transportability
Certificate Invalidation Graph
Hidden-Confounder Sensitivity Bound
```

## Edges

```text
Predictive Sufficiency ≠ Causal Sufficiency
Action Sufficiency ≠ Ignorability
Representation Invariance ≠ Causal Identification
Negative-Control Pass ≠ Ignorability Proof
Proxy Correlation ≠ Proxy Validity
Proximal Identification ≠ Assumption-Free Identification
Bridge Exists ≠ Bridge Numerically Stable
Task Accuracy Stable ≠ Causal Semantics Stable
Encoder Version Change → May Invalidate Propensity Model
Encoder Version Change → May Invalidate Bridge Function
Encoder Version Change → May Invalidate Calibration Certificate
```

---

# 本輪結束回答

- **缺哪一層？** `Proxy-role discovery + hidden-confounder sensitivity → planner decision gate`。
- **哪個節點最淺？** `BridgeTransportability`、`ProxyValidityContract`、`HiddenConfounderActionFlipRisk`。
- **哪個概念仍只是名詞？** 自動化 `ProximalProxyDiscovery`；目前只有工程方向，尚未證明在一般 Agent traces 上可靠。
- **哪個系統值得讀原始碼？** `syanga/proxci`，尤其 `minimax_core.py` 與 `proximal_inference.py`。
- **哪篇論文需追引用？** `Causal Inference Under Unmeasured Confounding With Negative Controls` 與 `Proximal Reinforcement Learning`。
- **哪個概念最適合視覺模擬？** `Causal State Discovery × Hidden Confounder Lab / Proxy Bridge Viewer`。
- **哪個 Agent 架構最值得實作？** **Proximal-Causal-State-Aware Agent Runtime**：History Encoder + Multi-View State + Negative-Control Diagnostics + Proxy Bridge Estimator + Sensitivity Envelope + Sequential OPE + Representation Drift Invalidation。

---

# 對「AI 到底怎麼運作」的新補充

目前可把 Agent 從：

```text
UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tools/MCP
→ Models/GPU
→ Output
```

再補成：

```text
Raw world/history
→ Observation channels
→ Learned representation
→ What was compressed away?
→ Hidden state / confounder
→ Proxy channels
→ Negative-control falsification
→ Bridge / sensitivity analysis
→ Decision certificate
→ Action
→ World changes
```

本輪最重要的認知是：**AI Agent 的 latent state 不是因為「壓縮得漂亮」或「控制做得好」就自然成為 causal state。真正要回答「為什麼 Agent 做這個決定、換一個決策是否會更好」時，還必須處理觀察不到的世界狀態、確認 proxy/negative-control 假設、量化 hidden-confounder sensitivity，並在 representation 更新後主動撤銷已不再成立的舊 causal certificate。**