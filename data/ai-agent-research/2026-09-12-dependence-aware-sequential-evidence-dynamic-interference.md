# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 01:51 Asia/Taipei**  
**主題：Cluster-Aware E-Processes × Markov/Temporal Dependence × Multi-Way Clustering × Dynamic Interference Graph × Evidence Validity Runtime**

---

## 0. 與歷史研究的差異

上一輪已建立：

```text
Assignment Router
→ Cluster Resolver
→ Exposure Mapper
→ Filtration Registry
→ Sequential Evidence
→ Shadow→Live Calibration
→ Interference Graph Learner
→ Exposure-Aware Rollout Gate
```

但仍留下四個沒有真正解掉的問題：

1. cluster 只是標記，尚未定義「cluster 內相關」如何進 sequential evidence。
2. temporal dependence 仍近似成 time block，沒有建 Markov transition structure。
3. user × session × MCP × time 是 multi-way overlap，不是一個單一 cluster ID。
4. interference graph 仍接近 static graph，沒有 edge birth/death、lag、regime 與 uncertainty。

本輪不重複 canary / e-value 基礎，而專注把「證據本身如何在相依資料下成立」變成 runtime architecture。

---

# 一、本小時新發現

## 新論文 / 方法

### 1. Asymptotically Optimal Sequential Testing with Markovian Data
- Authors: Alhad Sethi, Kavali Sofia Sagar, Shubhada Agrawal, Debabrota Basu, P. N. Karthik
- Venue/Year: ICML 2026
- URL: https://arxiv.org/abs/2602.17587
- Code: https://github.com/Alhad-Sethi/Sequential-Markovian-Testing
- Architecture: ergodic finite-state Markov chain + sequential stopping rule
- Contribution: sequential testing under Markov dependence; lower bound depends on stationary distribution and transition structure, not just marginal variance.
- Limitation: assumes finite-state ergodic Markov structure; cannot直接覆蓋任意 long-memory / nonstationary Agent telemetry。
- 改變了什麼：證據單位從 observation count 升級為 transition information。

### 2. Carefree multiple testing with e-processes
- Authors: Yury Tavyrikov, Jelle J. Goeman, Rianne de Heide
- Institutions: Vrije Universiteit Amsterdam; Leiden University Medical Center; University of Twente / CWI
- Year: 2026
- URL: https://doi.org/10.1214/26-EJS2546
- Contribution: multiple e-processes 在 adaptive data collection 下，直接對 suprema 使用普通 e-BH 並不保證原本 FDR；adjusters 可在 arbitrary dependence 下恢復 FDR-sup control。
- Limitation: 解的是 multiple testing/e-process aggregation，不等於直接解 single-stream cluster dependence。
- 改變了什麼：Hermes 不能任意把 quality / safety / resource / security 的 e-process 合併。

### 3. Cross-Fitting-Free Debiased Machine Learning with Multiway Dependence
- Authors: Kaicheng Chen, Harold D. Chiang
- Year: 2026
- URL: https://arxiv.org/abs/2602.11333
- Contribution: 對 general multiway clustered dependence 建立推論理論；有效 sample size 受 independent clusters 而非 raw row count 支配。
- Limitation: asymptotic DML/GMM，不是 anytime-valid e-process。
- 改變了什麼：提供 Hermes multi-way dependence 的建模語言，但不能直接拿來當 sequential stopping rule。

### 4. Wild Bootstrap Inference with Multiway Clustering and Serially Correlated Time Effects
- Authors: Ulrich Hounyo, Jiahao Lin
- Venue: Journal of Business & Economic Statistics 44(2), 2026
- DOI: 10.1080/07350015.2025.2546454
- Contribution: multiway clustering + serially correlated common time effects。
- Limitation: fixed-sample/bootstrap inference，不是 Agent runtime 直接的 anytime engine。
- 改變了什麼：證明「multi-way cluster + serial correlation」必須同時處理，不能互相替代。

### 5. From Causal Discovery to Dynamic Causal Inference in Neural Time Series (DCNAR)
- Authors: Valentina Kuskova, Dmitry Zaytsev, Michael Coppedge
- Year: 2026
- URL: https://arxiv.org/abs/2603.20980
- Architecture: Stage 1 sparse causal discovery → Stage 2 time-varying causal network autoregression
- Contribution: causal graph 不只要 discovery，edge influence 還必須 time-varying；評估也不只看 prediction，而看 causal necessity / temporal stability / structural-change sensitivity。
- Limitation: scientific time-series framework，不是 production Agent interference 專用。
- 改變了什麼：Hermes 的 interference graph 應是 G_t 而非單一 G。

### 6. Transportable Causal Effect Estimation across Networks under Interference
- Authors: Xiaojing Du, Jiuyong Li, Lin Liu, Debo Cheng, Jixue Liu, Thuc Duy Le
- Year: 2026
- URL: https://arxiv.org/abs/2608.18932
- Contribution: network topology shift 與 covariate shift 分離，將 direct/spillover/total effects transport 到不同 deployment network。
- Limitation: 需要明確 selection assumptions；production Agent shared-resource topology 可能只能部分觀測。
- 改變了什麼：一張 environment A 驗證的 interference certificate 不能無條件 transport 到 environment B。

---

# 二、本小時最重要 5 個發現

## 發現 1：Raw trajectory count 不是 sequential information clock

### 概念
Agent telemetry 的時間軸不能再寫成：

```text
t = number of trajectories
```

如果 sequence 具有 Markov dependence，真正資訊與：

```text
state occupancy
transition counts
stationary distribution
transition divergence
```

有關。

### 底層如何運作
對 finite-state Markov stream：

```text
X_1 → X_2 → ... → X_t
```

維護：

```text
N_ij(t) = # transitions i → j
N_i(t)  = Σ_j N_ij(t)
P_hat(i,j) = N_ij / N_i
```

sequential evidence 不應只看：

```text
Σ reward_t
```

而應比較 competing transition mechanisms：

```text
H0: P ∈ script_P
H1: P ∈ script_Q
```

並根據 observed transition path 累積 evidence。

### 為什麼重要
同一個 MCP server 連續 timeout 20 次，和 20 個獨立 MCP servers 各 timeout 一次，不能當成同一份證據。

### 限制
Agent runtime 多數不是已知有限 Markov state，需要先做 state abstraction。

### 來源
Sethi et al., ICML 2026, Asymptotically Optimal Sequential Testing with Markovian Data.

---

## 發現 2：Cluster dependence、Markov dependence、filtration dependence 是三種不同問題

不能再統稱：

```text
dependent data
```

Hermes 應明確區分：

### A. Cluster dependence
```text
same user
same account
same session
same MCP tenant
```
cluster 內 correlated，cluster 間較接近 independent。

### B. Temporal / Markov dependence
```text
failure_t
→ retry_t+1
→ queue_t+1
→ timeout_t+2
```
未來資料分布直接依賴前一狀態。

### C. Filtration dependence
Quality verifier 可能只看到 trajectory；Security verifier 看到 trajectory + hidden policy + resource state。

```text
F_quality ⊂ F_security ⊂ F_full
```

即使各自的 e-process 在自己的 filtration 下成立，也不能隨意乘起來當新的 evidence。

### Runtime implication
Hermes 需要：

```text
DependenceModel
├ cluster_dimensions[]
├ temporal_model
├ filtration_id
├ exchangeability_assumption
├ stationarity_scope
└ validity_method
```

---

## 發現 3：Multi-way clustering 不能壓成「一個 cluster key」

production execution 常同時屬於：

```text
user = U17
session = S5
MCP server = M2
time block = T91
GPU pool = G3
```

兩筆 request 只要共享任一 dimension，就可能相關。

因此錯誤做法：

```text
cluster_id = hash(user, session, mcp, time)
```

這會把 overlap structure 消失掉。

正確表示更接近 hypergraph：

```text
Execution e17
├ MEMBER_OF UserCluster U17
├ MEMBER_OF SessionCluster S5
├ MEMBER_OF ResourceCluster M2
├ MEMBER_OF TimeCluster T91
└ MEMBER_OF InfraCluster G3
```

### 關鍵否定
```text
Unique composite key
≠ Independent cluster
```

### Runtime implication
證據 engine 應先決定：

```text
primary independent unit
secondary dependence dimensions
```

再決定 block / cluster / Markov-aware estimator。

---

## 發現 4：Dynamic interference graph 應是 edge posterior over time，不是固定 adjacency

上一輪：

```text
Canary A → MCP-X → Stable B
```

本輪升級：

```text
P(A → B | t, lag, regime, resource)
```

每條 edge 要包含：

```text
DynamicInterferenceEdge
├ source
├ target
├ mediator_resource
├ lag_distribution
├ edge_probability
├ effect_sign
├ effect_strength
├ regime_scope
├ first_seen
├ last_verified
└ evidence_version
```

### 為什麼重要
例如：

```text
Canary A → shared quota → Stable B latency
```

只在：

```text
traffic > 40%
region = asia-east
peak hour
```

出現。

固定 graph 會錯誤地把它當成 permanent edge，或完全漏掉。

### 底層模型
建議：

```text
G_t = (V, E_t)
```

其中：

```text
P(E_t | E_t-1, telemetry_t)
```

由 streaming observations 更新。

---

## 發現 5：Agent rollout 需要 Evidence Validity Runtime，而不只是 Statistical Utility

目前工具通常提供：

```text
e_value
p_value
confidence_interval
```

但 Hermes 真正需要：

```text
EvidenceRecord
├ claim
├ statistic
├ method
├ filtration_id
├ dependence_model_id
├ cluster_schema_version
├ temporal_model_version
├ exposure_graph_version
├ valid_domain
├ assumptions[]
├ violations[]
└ evidence_value
```

因為同一個 `e=30` 若來自錯誤 independence assumption，不能和合法 `e=4` 比較大小。

因此：

```text
Evidence Magnitude
≠ Evidence Validity
```

Hermes 的 rollout gate 必須先判 validity，再判 strength。

---

# 三、Architecture Breakdown

## Dependence-Aware Evidence & Dynamic Interference Runtime

```text
Production Events
↓
Execution Identity Resolver
↓
Multi-Way Cluster Hypergraph
├ User
├ Session
├ Account
├ MCP / Tool
├ Memory
├ GPU / Queue
└ Time Block
↓
Temporal State Encoder
├ raw state
├ Markov state
├ retry state
├ queue state
└ regime state
↓
Dependence Classifier
├ approximately independent
├ clustered
├ serially correlated
├ Markov
├ multi-way clustered
└ unknown
↓
Filtration Registry
↓
Evidence Method Router
├ iid e-process
├ Markov sequential test
├ cluster-level aggregation
├ block-based method
├ adjusted multi-e-process
└ QUARANTINE: assumptions unresolved
↓
Sequential Evidence Ledger
↓
Exposure / Shared Resource Graph
↓
Dynamic Interference Learner
├ edge candidate
├ lag search
├ intervention
├ spillover posterior
└ regime scope
↓
Dynamic G_t
↓
Evidence Validity Checker
↓
Rollout Decision
├ PROMOTE
├ HOLD
├ ROLLBACK
├ TARGETED PROBE
└ INVALID_EVIDENCE
↓
Versioned Certificate
```

---

# 四、Bottom-Level Logic

## 4.1 Markov-aware evidence clock

將 raw events 壓成有限 operational state：

```text
S_t = {
  OK,
  HIGH_LATENCY,
  TIMEOUT,
  RETRYING,
  QUOTA_LIMITED,
  RECOVERING
}
```

每次 transition：

```text
S_t → S_t+1
```

更新：

```text
C[S_t,S_t+1] += 1
```

得到 empirical transition matrix：

```text
P_hat[i,j] = C[i,j] / Σ_k C[i,k]
```

Hermes 的 hypothesis 不再只是：

```text
mean latency canary > stable
```

而可變成：

```text
H0:
P(TIMEOUT → RETRYING) <= stable baseline

H1:
P(TIMEOUT → RETRYING) materially increased
```

這能直接抓到「failure cascade semantics」。

---

## 4.2 Multi-way cluster hypergraph

```text
Execution e_i
  ↓
membership vector
c_i = [user, session, tenant, resource, time, region]
```

建立 incidence matrix：

```text
B[e, cluster] ∈ {0,1}
```

兩 execution 的 dependency prior：

```text
D_ij = Σ_k w_k B[i,k] B[j,k]
```

注意：這只是 dependency prior，不是 correlation proof。

---

## 4.3 Dynamic interference edge update

對候選 edge：

```text
A_t → B_t+lag
```

維護：

```text
prior edge probability
↓
observational residual dependence
↓
controlled / natural intervention
↓
posterior update
↓
regime compatibility
↓
edge active / dormant / revoked
```

edge lifecycle：

```text
CANDIDATE
→ OBSERVED
→ INTERVENTION_SUPPORTED
→ VERIFIED
→ DORMANT
→ REVOKED
```

這能避免把舊 rollout 的 interference edge 永久留在知識圖譜。

---

## 4.4 Evidence validity first

```text
Evidence Update
↓
Check:
  dependence assumption?
  filtration compatible?
  stationarity scope valid?
  graph version valid?
  cluster schema changed?
↓
YES → accumulate evidence
NO  → freeze / branch / restart evidence process
```

關鍵：

```text
Regime / dependency model changed
→ evidence process version should change
```

不能把兩種不同 data-generating process 的 evidence 無條件連乘。

---

# 五、Visual Simulation Idea

## **Evidence Dependency & Dynamic Interference Lab**

### View A — Raw Count vs Effective Evidence Structure

```text
Raw trajectories            20,000
Users                         1,900
Sessions                      2,840
MCP tenants                      12
Temporal regimes                  3
```

畫成 multi-layer hypergraph，點 execution 可看到：

```text
E1927
├ user U18
├ session S92
├ MCP tenant M2
├ queue Q1
└ time block T51
```

切換：

```text
[Naive iid]
[Cluster-aware]
[Markov-aware]
[Multi-way]
```

UI 即時計算：

```text
Naive evidence       31.2
Valid evidence       8.7
Validity status      WARN
```

### View B — Markov Failure Cascade Viewer

```text
OK ─────────────→ OK
│                 ↑
│                 │
↓                 │
TIMEOUT → RETRY → RECOVER
   │         │
   └→ QUOTA ←┘
```

滑動 stable / canary 比較：

```text
P(TIMEOUT→RETRY)
Stable  0.41
Canary  0.79
```

### View C — Dynamic Interference Graph

```text
Time t1:
Canary A ─→ MCP-X ─→ Stable B

Time t2:
Canary A ─→ MCP-X ─→ Stable B
                └──→ Stable C

Time t3:
A→B edge dormant
A→C still active
```

edge thickness = posterior spillover strength；
edge color由 UI theme 決定，不在模型資料層硬編碼。

### View D — Evidence Validity Inspector

點一個 e-process：

```text
Claim:
Canary increases failure risk

Evidence:
e = 18.4

Assumptions:
✓ filtration compatible
✕ iid violated
✓ Markov state model valid
? MCP cluster overlap unresolved

STATUS:
PARTIALLY VALID
```

這比只顯示「e=18.4」更符合 Hermes 的核心研究目標。

---

# 六、Code / GitHub

## A. Alhad-Sethi/Sequential-Markovian-Testing
https://github.com/Alhad-Sethi/Sequential-Markovian-Testing

目錄核心：

```text
G1_MCMC.ipynb
G2_MDP.ipynb
G3_ParametricFamily.ipynb
G4_Baselines1.ipynb
G4_Baselines2.ipynb
README.md
```

值得讀的不是 README，而是四類 experiment notebook：

- `G1_MCMC.ipynb`：model misspecification detection
- `G2_MDP.ipynb`：MDP transition structure testing
- `G3_ParametricFamily.ipynb`：parametric Markov family
- `G4_Baselines*.ipynb`：與 baseline sequential tests 比較，第二份包含 GPU/CuPy baseline 路徑

目前 repo 主要以 self-contained notebook 呈現，還不是 production reusable runtime。Hermes 應抽象其 Markov sequential primitive，而不是直接嵌 notebook。

## B. jakorostami/expectation
https://github.com/jakorostami/expectation

核心 Python package：

```text
expectation/
├ conformal/
├ confseq/
├ ksample/
├ modules/
├ parametric/
├ seqtest/
│  └ sequential_e_testing.py
├ par_seqtest.py
└ utils/
```

`sequential_e_testing.py` 已把：

```text
TestType
AlternativeType
BoundaryType
SequentialTestResult
SequentialTesting
EProcess
EProcessUpdater
EToPCalibrator
```

拆成 reusable components。

特別值得 Hermes 借鏡的工程點：

```text
previous_log_e_cumulative
```

用來從 cumulative log e-process 還原 step-wise sequential e-value；以及 boundary / mixture / betting strategy 被拆成獨立 config。

但 limitation 是：它的通用 sequential API 並不自動辨識 cluster / Markov / interference assumptions。Hermes 要在它上方多加 Evidence Validity Runtime。

---

# 七、Papers

| Title | Year | Architecture / Mechanism | Contribution | Hermes relevance |
|---|---:|---|---|---|
| Asymptotically Optimal Sequential Testing with Markovian Data | 2026 | finite-state ergodic Markov sequential test | transition-aware optimal stopping | Markov telemetry evidence |
| Carefree multiple testing with e-processes | 2026 | e-process supremum + adjusters | dependence-safe multiple testing | verifier/evidence aggregation |
| Cross-Fitting-Free DML with Multiway Dependence | 2026 | multiway clustered GMM/DML | multi-dimensional cluster dependence | user/session/resource overlap |
| Wild Bootstrap Inference with Multiway Clustering and Serially Correlated Time Effects | 2026 | multiway bootstrap + serial dependence | joint cluster/time dependence | Agent production telemetry |
| From Causal Discovery to Dynamic Causal Inference in Neural Time Series | 2026 | sparse causal discovery + time-varying autoregression | dynamic causal influence | G_t interference graph |
| Transportable Causal Effect Estimation across Networks under Interference | 2026 | network selection diagram + doubly robust transport | direct/spillover/total effect transport | certificate portability |

---

# 八、Unknown / Open Questions

## 1. Cluster-aware e-process 的 production 形式
目前仍沒有一個可直接宣稱：

```text
arbitrary multi-way clustering
+
optional stopping
+
finite-sample anytime validity
+
streaming production updates
```

全部同時滿足的通用 primitive。

因此 Hermes 不應假裝 `ClusterAwareEProcess` 已解；目前它仍是研究缺口。

## 2. State abstraction 會不會破壞 Markov property？
真實 runtime：

```text
raw state
→ compress into {OK,TIMEOUT,RETRY,...}
```

壓縮後未必還是 Markov。

需要研究：

```text
state aliasing
higher-order Markov
semi-Markov
hidden Markov
```

## 3. Dynamic interference graph 如何與 intervention budget 結合？
每條 edge 都做 live intervention 太昂貴且危險。

需要：

```text
edge posterior
× expected information gain
× rollout risk
× intervention cost
```

選最值得驗證的 spillover edge。

---

# 九、下一輪研究

下一輪最值得研究：

# **Hidden-State Dependence × HMM/Semi-Markov Runtime × State Aliasing × Dynamic Graph Intervention Scheduling**

原因：本輪把 Markov dependence 帶入 Hermes 後，最大的假設變成：

```text
我們看得到真正 state
```

但 Agent runtime 的真正 latent state 很可能不可見：

```text
provider degradation
hidden rate-limit bucket
backend model pool
memory contamination
router state
queue scheduler state
```

下一輪應研究：

```text
Observed Telemetry
↓
Latent State Inference
├ HMM
├ HSMM
├ switching state-space model
└ predictive state representation
↓
State Aliasing Test
↓
Dependence Model
↓
Sequential Evidence
↓
Dynamic Interference Graph
↓
Active Probe Scheduler
```

並特別回答：

```text
如果 latent state 不可直接觀測，
任何 time-uniform / e-process validity 能保留到什麼程度？
```

---

# 十、Knowledge Graph 新增 Node / Edge

## Nodes

```text
Dependence-Aware Evidence
Evidence Validity Runtime
Evidence Filtration
Markov Evidence Clock
Transition Count
Transition Divergence
State Occupancy
Multi-Way Cluster
Cluster Hypergraph
Cluster Membership
Temporal Dependence
Serial Correlation
Dependence Model
State Abstraction
State Aliasing
Dynamic Interference Graph
Dynamic Interference Edge
Spillover Lag
Edge Posterior
Edge Lifecycle
Network Transportability
Evidence Validity Domain
```

## Edges

```text
Execution --MEMBER_OF→ Cluster
Execution --TRANSITIONS_TO→ RuntimeState
RuntimeState --GENERATES→ TransitionEvidence
Evidence --VALID_UNDER→ DependenceModel
Evidence --OBSERVED_WITHIN→ Filtration
DynamicInterferenceEdge --ACTIVE_DURING→ Regime
DynamicInterferenceEdge --MEDIATED_BY→ SharedResource
Certificate --VALID_FOR→ NetworkTopology
NetworkTopology --CHANGES→ Transportability
```

## 新增否定關係

```text
Trajectory Count ≠ Information Count
Cluster Label ≠ Dependence Correction
Composite Cluster Key ≠ Multi-Way Clustering
Serial Correlation ≠ Cluster Dependence
Markov Dependence ≠ Generic Correlation
Marginal Drift ≠ Transition Drift
High E-Value ≠ Valid Evidence
Valid E-Process Alone ≠ Valid Arbitrary Combination
Static Adjacency ≠ Dynamic Interference Graph
Shared Resource ≠ Permanent Causal Edge
Edge Observed Once ≠ Edge Valid Across Regimes
Certificate Valid In Network A ≠ Transportable To Network B
```

---

# 十一、本輪結束回答

### 缺哪一層？
**Latent Dependence State Layer**：Hermes 還沒有可靠方法從 observable telemetry 還原真正控制 serial dependence 的 hidden runtime state。

### 哪個節點最淺？
**ClusterAwareEProcess**。現在已有設計語言，但還沒有可直接宣稱 general finite-sample anytime-valid 的 production primitive。

### 哪個概念仍只是名詞？
- MultiWayClusterEProcess
- DynamicInterferenceCertificate
- EvidenceValidityCertificate
- MarkovExposureCertificate

### 哪個系統值得讀原始碼？
1. `Alhad-Sethi/Sequential-Markovian-Testing` 的 `G1_MCMC.ipynb`、`G2_MDP.ipynb`、`G4_Baselines*.ipynb`
2. `jakorostami/expectation` 的 `expectation/seqtest/sequential_e_testing.py`、`modules/eprocessupdater.py`、`par_seqtest.py`

### 哪篇論文需追引用？
優先順序：
1. **Asymptotically Optimal Sequential Testing with Markovian Data**
2. **Carefree multiple testing with e-processes**
3. multiway dependence / serial correlation literature
4. DCNAR 與 dynamic causal graph literature

### 哪個概念最適合視覺模擬？
**Evidence Dependency & Dynamic Interference Lab**。

### 哪個 Agent 架構最值得實作？

> **Dependence-Aware Sequential Rollout Runtime = Multi-Way Cluster Hypergraph + Temporal/Markov State Encoder + Filtration Registry + Evidence Method Router + Sequential Evidence Ledger + Dynamic Interference Graph + Evidence Validity Checker + Exposure/Network-Scoped Certificate Registry。**

---

# 十二、放回「AI 到底怎麼運作」總圖

這輪新增的是原本 UI→Agent→Tool→Output 之外的「證據回饋層」：

```text
User
↓
UI
↓
Agent
↓
Context / Memory
↓
Reasoning / Planning
↓
Tool / MCP / Model
↓
External World
↓
Effect / Observation
↓
Runtime Telemetry
↓
Cluster Hypergraph
↓
Temporal / Markov State
↓
Sequential Evidence
↓
Dynamic Interference Graph
↓
Evidence Validity Runtime
↓
Certificate / Rollout Decision
↓
下一次 Agent / Model / Tool Routing
```

**本輪最重要的底層推進：AI 系統不只需要知道「模型做了什麼」，還必須知道「我們用來判斷它是否變好、是否安全的證據，是在什麼相依結構與資訊邊界下成立的」。若沒有這一層，更多 telemetry 甚至可能只是更多重複、相關、不可合法累積的觀測。**
