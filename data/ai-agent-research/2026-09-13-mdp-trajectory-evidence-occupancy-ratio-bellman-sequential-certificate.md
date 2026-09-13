# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 13:52（Asia/Taipei）**  
**本輪主題：MDP Trajectory Evidence × Occupancy-Ratio Correction × Bellman-Flow Certificate × Online MDP Confidence Sequence × Agent Permission Gate**

> 本輪承接 `2026-09-13-sequential-evidence-transformer-ope-eprocess-agent-risk-gating.md` 留下的 `MDP / longitudinal trajectory sequential evidence` 缺口，但刻意避免重複 `2026-09-12-trajectory-selection-sequential-dr-verification-intervention.md` 已做過的 trajectory propensity、PDIS 與 sequential DR。新的核心問題是：**當 Agent 的 action 會改變後續 state distribution 時，如何從「整條 trajectory 的 importance-weight 連乘」升級為「occupancy / Bellman-flow correction」，再把 MDP 層的不確定性接入 anytime-valid evidence 與 permission gate？**

---

# 一、本小時新發現

## 新論文 / 新架構 / 新 GitHub

### 1. Confidence Sequences for Online Statistical Model Checking of Markov Decision Processes
- **Authors:** Konstantin Kueffner, Tobias Meggendorfer, Maximilian Weininger, Patrick Wienhöft
- **Institutions:** Institute of Science and Technology Austria、Lancaster University Leipzig、Ruhr-University Bochum、TUD Dresden University of Technology（依公開論文資訊）
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2606.25797
- **Code:** 論文宣稱提供 efficient tool；本輪未確認到可穩定對應的作者 GitHub repository，因此不把第三方 notebook 當官方 code。
- **Dataset / Benchmark:** MDP statistical model checking benchmarks
- **Architecture:** Transition sampling → per-transition probability confidence sequences → uncertain MDP model → model checking / value bound → continue sampling if interval too wide
- **Contribution:** 將 fixed-time CI 換成真正適合重複 online inference 的 confidence sequences；論文報告其實作平均比 previous state of the art 少約 50× samples。
- **Limitations:** 它主要解的是 unknown transition probabilities 下的 statistical model checking；不是直接解 behavior-policy → target-policy 的 off-policy causal replay，也沒有自動給 Hermes 一個 trajectory e-process。
- **改變了什麼:** **MDP evidence 不一定要先估一個 policy value scalar；也可以先對 transition kernel 本身建立 time-uniform evidence，再將 transition uncertainty propagate 到 value / reachability。**

來源：
- https://arxiv.org/abs/2606.25797
- https://www.alphaxiv.org/abs/2606.25797

---

### 2. Fitted Occupancy-Ratio Evaluation without Bellman Completeness (FORE)
- **Authors:** Lars van der Laan, Nathan Kallus
- **Institutions:** Stanford University；Netflix / Cornell University（依 arXiv v2 公開 PDF metadata）
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.05375
- **Code:** 本輪未找到作者正式 code release
- **Dataset:** offline RL / OPE experiments
- **Architecture:** discounted occupancy ratio → adjoint Bellman fixed point → KL-projected fitted recursion → direct reward reweighting / weighted FQE / DR
- **Contribution:** 不再要求 Bellman completeness；主要近似條件改成 discounted occupancy ratio 本身可被 ratio class 表示。並提出 coverage-stopped FORE：coverage 失效時停止 occupancy accumulation，對 nonnegative reward 給保守 lower bound。
- **Limitations:** 是 offline fixed-dataset OPE 方法，不是 anytime-valid sequential inference；learned ratio 的估計誤差不能直接假裝成 e-process。
- **改變了什麼:** **「沒有完整 trajectory support」不一定只能整個 OPE 報廢；可以把 coverage failure 變成明確 stopping boundary，輸出 conservative partial value。**

來源：
- https://arxiv.org/abs/2607.05375

---

### 3. Q-MMR: Off-Policy Evaluation via Recursive Reweighting and Moment Matching
- **Authors:** Xiang Li, Nan Jiang
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.06474
- **Code:** 本輪未確認作者正式 code release
- **Architecture:** finite-horizon MDP → per-data-point scalar weights → top-down recursive moment matching against value-function discriminator class → reward reweighting
- **Contribution:** 在 general function approximation 下，僅以 `Q^π` realizability 建立 data-dependent finite-sample guarantee，並給 dimension-free bound；把 coverage 問題重新表達成可檢查的 moment-matching / reweighting 問題。
- **Limitations:** finite-horizon OPE；不是 sequential monitoring theorem，不能直接接 LORD/e-BH。
- **改變了什麼:** **MDP correction 不只有 trajectory IS 與 stationary ratio；也可用 recursive moment matching 建出 data-adaptive weights。**

來源：
- https://arxiv.org/abs/2605.06474

---

### 4. DualDICE: Behavior-Agnostic Estimation of Discounted Stationary Distribution Corrections
- **Authors:** Ofir Nachum, Yinlam Chow, Bo Dai, Lihong Li
- **Institution:** Google AI / Google Research（論文公開資訊）
- **Year:** 2019
- **URL:** https://arxiv.org/abs/1906.04733
- **Code:** https://github.com/google-research/google-research/tree/master/dual_dice
- **Dataset:** GridWalk / offline RL experiments
- **Architecture:** offline transitions → Bellman-flow / Fenchel-dual objective → `ν` + density-ratio `ζ` → discounted stationary distribution correction → OPE
- **Contribution:** 直接估 `d^π(s,a)/d^D(s,a)`，不要求知道 behavior policy，並避免直接使用長 trajectory importance weights。
- **Limitations:** density-ratio function approximation / optimization 仍可能錯；原始方法本身不是 anytime-valid uncertainty certificate。
- **改變了什麼:** **長 horizon distribution shift 可以在 state-action occupancy 層修正，而不是永遠依賴 `∏ π/μ`。**

來源：
- https://research.google/pubs/dualdice-behavior-agnostic-estimation-of-discounted-stationary-distribution-corrections/
- https://papers.nips.cc/paper_files/paper/2019/hash/cf9a242b70f45317ffd281241fa66502-Abstract.html
- https://github.com/google-research/google-research/tree/master/dual_dice

---

### 5. Breaking the Curse of Horizon: Infinite-Horizon Off-Policy Estimation
- **Authors:** Qiang Liu, Lihong Li, Ziyang Tang, Dengyong Zhou
- **Year:** 2018
- **URL:** https://arxiv.org/abs/1810.12429
- **Code / data:** 作者頁提供 code/data link：https://zt95.github.io/papers/18breaking/
- **Architecture:** behavior trajectories → stationary state-distribution ratio estimation → stationary reweighting → target policy value
- **Contribution:** 指出 trajectory IS 的 variance 隨 horizon 爆炸，在 infinite horizon 甚至可能無界；改在 stationary state-visitation distribution 上做 correction。
- **Limitations:** stationary / ergodic assumptions 與 state representation sufficiency 很關鍵；POMDP 或 non-stationary Agent runtime 不能直接套用。
- **改變了什麼:** 奠定本輪最重要的工程判斷：**Horizon problem 本質不只是數值 overflow，而是 pathwise likelihood ratio 的統計 variance 結構。**

來源：
- https://arxiv.org/abs/1810.12429

---

# 二、本小時最重要 5 個發現

## 發現 1：Contextual-Bandit Evidence ≠ MDP Trajectory Evidence

### 已確認事實
Contextual bandit 的基本資料生成可寫成：

```text
X_t
↓
A_t ~ μ(.|X_t)
↓
R_t
```

其中 action 不必改變下一筆 context 的 causal state。

MDP 則是：

```text
S_t
↓
A_t
↓
(R_t, S_{t+1})
↓
A_{t+1}
↓
...
```

所以 target policy 改變的不只是 action probability，也改變未來 **state visitation distribution**。

### Bottom-level mechanism
trajectory IS：

```text
ρ_t
=
π(A_t|S_t)
/
μ(A_t|S_t)

W_t
=
Π_{k=0}^t ρ_k
```

`W_t` 同時 correction：

```text
action mismatch
+
由前面 actions 造成的 downstream state-distribution mismatch
```

但代價就是 variance 可以隨 horizon 爆炸。

### Hermes 映射
Hermes 的：

```text
READ_MCP
WRITE_MCP
ASK_USER
MEMORY_WRITE
BROWSER_CLICK
```

會直接改變後續 observation，因此不能再把每個 decision event 當成互不影響的 contextual-bandit sample。

### 新 Knowledge Edge
```text
One-Step Policy Ratio
≠
State-Distribution Correction
```

### 為什麼重要
上一輪的 `SequentialEvidenceTransformer` 若直接把 contextual-bandit DR evidence 延伸到 Tool/MCP trajectory，會漏掉「policy 改變 state distribution」這一層。

來源交叉驗證：Jiang & Li 2016 sequential DR + Liu et al. 2018 stationary correction。

---

## 發現 2：Trajectory Product Weight ≠ 唯一的 MDP Distribution Correction

### 已確認事實
定義 discounted occupancy：

```text
d^π_γ(s,a)
=
(1-γ)
Σ_{t≥0}
γ^t
P_π(S_t=s, A_t=a)
```

若 offline dataset 的 state-action distribution 為 `d^D(s,a)`，可以定義：

```text
ζ(s,a)
=
d^π_γ(s,a)
/
d^D(s,a)
```

然後用：

```text
E_D[ ζ(S,A) R ]
```

來重建 target occupancy 下的 reward，而不是對每一條 trajectory 計算長連乘 likelihood ratio。

### 這不是魔法
occupancy ratio 只是把 correction 從：

```text
path-space likelihood ratio
```

改寫成：

```text
state-action visitation ratio
```

仍需要 coverage：

```text
d^π(s,a) > 0
⇒
d^D(s,a) > 0
```

或某種可接受的 restricted support / conservative stopping。

### 為什麼重要
這給 Hermes 一個真正的新 Replay Router：

```text
short / well-supported horizon
→ PDIS / sequential DR

long horizon / stationary-ish runtime
→ occupancy-ratio route

coverage break
→ partial / stopped certificate
```

### 新 Knowledge Edge
```text
Avoiding Trajectory IS
≠
Avoiding Coverage Assumption
```

來源交叉驗證：DualDICE 2019 + Breaking the Curse of Horizon 2018 + FORE 2026。

---

## 發現 3：DualDICE 的底層其實是在解 Bellman-flow constraint，不只是「另一個 OPE 模型」

### GitHub 原始碼確認
本輪直接追：

```text
google-research/google-research/
└ dual_dice/
   ├ algos/
   │  ├ dual_dice.py
   │  └ neural_dual_dice.py
   ├ transition_data.py
   ├ policy.py
   └ run.py
```

### TabularDualDice
`algos/dual_dice.py` 不是逐 trajectory 乘 weight；它先累積：

```text
td_residuals
initial_weights
total_weights
```

核心更新包含：

```text
ν(s,a)
-
γ E_{a'~π(.|s')} ν(s',a')
```

形成 TD / Bellman residual matrix，最後：

```text
solve linear system
↓
ν
↓
ζ
↓
estimate value from density ratios
```

值得注意的是 code 也允許：

```text
state density ratio
vs
state-action density ratio
```

而註解指出 tabular setting 下 state ratio 通常更快、low-data regime 更準。

### NeuralDualDice
`algos/neural_dual_dice.py` 則建立兩個 network：

```text
ν-network
ζ-network
```

並計算：

```text
Δν = ν - γ ν_next
```

state-only ratio route 才額外乘 policy ratio。

再透過 Fenchel conjugate：

```text
Δν * ζ
- f*(ζ)
- (1-γ)ν_initial
```

形成 saddle-style objective，Adam 同時更新 `ν` 與 `ζ`。

原始碼甚至直接警告 optimization 可能不穩，deterministic environment 下可避開部分 Fenchel-dual simultaneous optimization。

### 為什麼重要
這使 Hermes 可以把：

```text
Trajectory Evidence Engine
```

拆成：

```text
Likelihood-Ratio Engine
Occupancy-Balance Engine
Bellman-Residual Engine
```

而不是所有 counterfactual evidence 都塞入同一種 `importance_weight` 欄位。

### 工程實作 vs 論文結果
- **論文已確認：** DualDICE 估 discounted stationary distribution correction，behavior-policy agnostic。
- **原始碼已確認：** tabular solver 組 TD residual matrix；neural solver 明確有 `ν / ζ` network + Fenchel objective。
- **合理推論：** Hermes 可以把 Bellman residual 當 evidence lineage 中的中介 object。
- **尚未驗證假說：** learned `ζ` residual 可以不經額外 theorem 直接轉成 anytime-valid e-process。**目前不能這樣做。**

---

## 發現 4：MDP 的 anytime-valid 路線可以先 certify transition kernel，再 certify value

### 2026 新工作
Kueffner et al. 的 `Confidence Sequences for Online Statistical Model Checking of Markov Decision Processes` 提出 online MDP statistical model checking 使用 confidence sequences，而不是：

```text
sample
↓
fixed-time CI
↓
solve
↓
再 sample
↓
重新 fixed-time CI
```

因為不斷 peeking / 重算 fixed-time CI 容易破壞保證。

更合理的 architecture 是：

```text
Transition observations
↓
P(s'|s,a) confidence sequences
↓
Time-uniform transition uncertainty set
↓
MDP value / reachability solver
↓
Value interval
↓
continue sampling if too wide
```

論文報告其 implementation 在 benchmarks 上平均約少 50× samples，相較 previous SOTA。這是論文 empirical result，不應外推成所有 MDP 都 50×。

### Hermes 意義
這給 `Sequential Evidence Transformer` 第二條完全不同的路：

```text
A. Value-first route
trajectory → OPE → value CS/evidence

B. Dynamics-first route
transition events → transition CS
→ uncertain world model
→ robust value bound
```

對 Tool/MCP agent 很重要，因為很多風險其實是：

```text
WRITE_EXTERNAL
↓
某種 failure state 的 transition probability
```

而不只是單一 scalar reward。

### 新 Knowledge Edge
```text
Anytime Policy-Value Evidence
≠
Only Direct OPE
```

---

## 發現 5：最新研究正在把「coverage failure」從黑盒失敗變成可輸出的 certificate

### FORE 2026
FORE 用 adjoint Bellman recursion + KL projection 估 discounted occupancy ratio，只要求 ratio realizability，而非 Bellman completeness。

特別重要的是 coverage-stopped FORE：

```text
start
↓
accumulate discounted occupancy
↓
first uncovered (s,a)
↓
STOP
↓
對 nonnegative reward
輸出 conservative lower bound
```

這對 Agent permission 非常有用。

原本：

```text
coverage failed
→ OPE ERROR
```

可以變成：

```text
coverage failed at state-action frontier
↓
known-safe value lower bound
+
unknown continuation value
↓
ASK / VERIFY / BLOCK
```

### Q-MMR 2026
Q-MMR 又補另一條線：透過 recursive reweighting + moment matching 學 data-point weights，只要求 `Q^π` realizability，並給 finite-sample data-dependent guarantee。

### 新結論
```text
Coverage
```

不應只是 boolean：

```text
PASS / FAIL
```

Hermes 應升級成：

```text
TrajectoryCoverageCertificate
├ full_trajectory_support
├ occupancy_support
├ first_unsupported_state_action
├ supported_discounted_mass
├ target_mass_outside_support
├ conservative_value_lower_bound
├ extrapolation_required
└ permission_implication
```

### 限制
FORE / Q-MMR 的 finite-sample OPE guarantee **不等於** anytime-valid sequential evidence guarantee。若 Hermes 每小時重算 ratio / weights，再依結果決定下一步 sampling，必須重新處理 filtration、predictability 與 repeated monitoring。

---

# 三、Architecture Breakdown

## MDP Trajectory Evidence Runtime

```text
User Goal / Agent Task
↓
Planner proposes candidate policy π
↓
Trajectory Event Ledger
├ state/context
├ action
├ tool/MCP observation
├ reward / safety event
├ human response
└ next state
↓
Causal State Sufficiency Gate
├ MARKOV_SUFFICIENT
├ HISTORY_STATE_REQUIRED
├ BELIEF_STATE_REQUIRED
├ POMDP_UNRESOLVED
└ NON_STATIONARY
↓
Behavior / Target Policy Resolver
↓
Trajectory Correction Router
├ PDIS / Sequential DR
│   └ short horizon / known propensity
├ Occupancy-Ratio Correction
│   ├ DualDICE
│   ├ FORE
│   └ stationary-density methods
├ Recursive Moment Matching
│   └ Q-MMR
└ Transition-Kernel Evidence
    └ MDP confidence sequences
↓
Coverage & Model-Validity Gate
↓
Sequential Evidence Constructor
├ exact finite-sample
├ anytime-valid transition CS
├ fixed-dataset OPE bound
├ asymptotic evidence
└ model-assisted only
↓
Trajectory Evidence Certificate
↓
Multiplicity Compatibility
↓
Permission Gate
├ ALLOW
├ VERIFY
├ ASK_USER
├ SIMULATE_ONLY
└ BLOCK
↓
Action
↓
new state / new evidence
```

---

# 四、Bottom-Level Logic

## 4.1 Path-space correction

```text
ρ_t = π(A_t|H_t) / μ(A_t|H_t)

W_t = ∏_{k=0}^t ρ_k
```

優點：直接、概念清楚。

缺點：

```text
horizon ↑
↓
variance ↑↑
↓
ESS ↓
```

甚至 infinite horizon 下 variance 可能無界。

---

## 4.2 Occupancy-space correction

```text
d^π_γ(s,a)
=
(1-γ)Σ_t γ^t P_π(S_t=s,A_t=a)

ζ(s,a)
=
d^π_γ(s,a)/d^D(s,a)
```

value：

```text
V(π)
≈
E_D[ζ(S,A)R] /(1-γ)
```

（具體 normalization 依 paper / estimator 定義）

與 trajectory IS 的關鍵差異：

```text
trajectory IS
→ 對 path likelihood correction

occupancy ratio
→ 對 target policy 最終造成的 discounted visitation distribution correction
```

---

## 4.3 Bellman-flow moment

occupancy ratio 並不是自由函數；它必須滿足 target policy 的 discounted flow conservation。

抽象地，對 test function `f`：

```text
E_D[
  ζ(S,A)
  ( f(S,A)
    - γ E_{A'~π(.|S')} f(S',A') )
]
≈
(1-γ)
E_{S0,A0~π}[f(S0,A0)]
```

DualDICE 的 `ν` 可以視為用來刻畫這個 Bellman-flow constraint 的 function，而 `ζ` 是 density-ratio solution。

因此：

```text
small Bellman residual
```

代表「ratio 與 flow equation 較一致」，但：

```text
small training residual
≠
true ratio certified
```

仍需 finite-sample / function-class / optimization uncertainty。

---

## 4.4 從 Bellman residual 到 e-process：目前缺的 theorem bridge

Hermes 最終想要：

```text
Bellman / occupancy evidence
↓
E_t(H0)
↓
Ville threshold
↓
permission certificate
```

一個候選研究方向是建立 predictable residual increments：

```text
F_{t-1}
↓
freeze ζ_hat_{t-1}, ν_hat_{t-1}, λ_t
↓
observe (S_t,A_t,R_t,S_{t+1})
↓
construct residual X_t
↓
ensure under H0:
E[X_t | F_{t-1}] ≤ 0
↓
betting factor L_t(X_t)
↓
E_t = E_{t-1} L_t
```

但目前不能直接聲稱 DualDICE / FORE 的 learned residual 自動具有這個 property。

需要另外證明：

```text
1. nuisance models are predictable
2. state representation is sufficient
3. Markov / mixing condition fits theorem
4. support holds
5. reward / residual tail condition holds
6. repeated ratio refitting does not leak future data
7. multiplicity composition remains valid
```

所以本輪正式新增：

```text
BellmanEvidenceRegime
├ OFFLINE_POINT_ESTIMATE
├ FINITE_SAMPLE_FIXED_DATA_BOUND
├ TRANSITION_ANYTIME_VALID
├ BELLMAN_MARTINGALE_CANDIDATE
└ E_PROCESS_CERTIFIED
```

---

# 五、Visual Simulation Idea

# **Trajectory Weight × Occupancy Flow × MDP Evidence Lab**

## Panel A：同一個 Agent trajectory

```text
S0
│ ASK_USER
▼
S1
│ READ_MCP
▼
S2
│ WRITE_MCP
▼
S3
│ VERIFY
▼
S4
```

每一步可點擊：

```text
μ(a|s)
π(a|s)
reward
next-state probability
source provenance
```

---

## Panel B：Path Weight Explosion

```text
t    π/μ      cumulative W
0    1.20         1.20
1    2.10         2.52
2    4.00        10.08
3    5.50        55.44  ⚠
4    3.00       166.32  ⚠⚠
```

即時顯示：

```text
ESS
max weight
log-weight
variance proxy
```

---

## Panel C：Occupancy Flow Map

視覺化 target vs logged visitation：

```text
        Logged d^D       Target d^π
S0       █████            ████
S1       ███████          ██
S2       ██               ███████
S3       █                █████
```

再顯示：

```text
ζ(S0)=0.8
ζ(S1)=0.3
ζ(S2)=3.5
ζ(S3)=5.0 ⚠ weak coverage
```

---

## Panel D：Bellman Flow Residual

```text
State     flow-in   flow-out   residual
S0        .31       .30        .01
S1        .18       .19       -.01
S2        .42       .35        .07 ⚠
S3        .09       .16       -.07 ⚠
```

使用者調整：

```text
policy
γ
state abstraction
coverage threshold
```

立即看到 residual / value bound 如何變化。

---

## Panel E：Evidence Route Toggle

```text
[Trajectory IS]
[PDIS / DR]
[DualDICE]
[FORE]
[Transition CS]
```

同一份 data 直接比較：

```text
Point estimate
Uncertainty type
Support requirement
Anytime-valid?
Model assumption
Permission verdict
```

---

## Panel F：Permission Gate

例如：

```text
WRITE_EXTERNAL

Path-IS estimate        0.81
Weight diagnostic       FAIL
Occupancy lower bound   0.62
Transition-risk upper   0.07
Coverage frontier       S3

→ VERIFY / BLOCK
```

重點是讓使用者直接看到：

> **不是「模型覺得危險」，而是哪一條 trajectory / occupancy / transition evidence 阻止了 action。**

---

# 六、Code / GitHub 深讀

## Google Research DualDICE

Repo：
https://github.com/google-research/google-research/tree/master/dual_dice

### 值得看的核心目錄 / 檔案

```text
dual_dice/
├ algos/
│  ├ base.py
│  ├ dual_dice.py
│  └ neural_dual_dice.py
├ policy.py
├ transition_data.py
├ run.py
└ README.md
```

### `algos/dual_dice.py`
值得追：

```text
TabularDualDice.solve()
_get_index()
estimate_average_reward()
```

實際流程：

```text
iterate transitions
↓
γ^time weighting
↓
build td_residuals
↓
target-policy next-action expectation
↓
initial-state target-policy weighting
↓
linear solve for ν
↓
derive ζ
↓
density-ratio value estimate
```

### `algos/neural_dual_dice.py`
值得追：

```text
_build_graph()
_compute_values()
_nu_network()
_zeta_network()
```

實際 graph：

```text
(state, action)
↓
ν-network
ζ-network

(next_state, π(.|next_state))
↓
Eπ[ν_next]

Δν = ν - γν_next
↓
Fenchel objective
↓
Adam(ν)
Adam(ζ)
```

### 值得 Hermes 借用的不是 TensorFlow code 本身
而是 object separation：

```text
TransitionData
Policy
ν function
ζ ratio
Bellman residual
Value estimate
```

Hermes 應映射成：

```text
TrajectoryLedger
BehaviorPolicyTrace
TargetPolicy
FlowCritic
OccupancyRatio
FlowResidualCertificate
TrajectoryValueCertificate
```

---

# 七、Papers

## Paper A
**Confidence Sequences for Online Statistical Model Checking of Markov Decision Processes**  
Authors: Konstantin Kueffner, Tobias Meggendorfer, Maximilian Weininger, Patrick Wienhöft  
Year: 2026  
URL: https://arxiv.org/abs/2606.25797  
Key change: MDP transition uncertainty 可以用 time-uniform CS 持續更新，而不是 repeatedly reuse fixed-time CI。  
Limitation: 不是 off-policy trajectory replay theorem。

## Paper B
**Fitted Occupancy-Ratio Evaluation without Bellman Completeness**  
Authors: Lars van der Laan, Nathan Kallus  
Year: 2026  
URL: https://arxiv.org/abs/2607.05375  
Key change: adjoint Bellman + KL projected fitted ratio；只要求 occupancy-ratio realizability；coverage-stopped conservative bound。  
Limitation: fixed-dataset OPE，不是 anytime-valid monitoring。

## Paper C
**Q-MMR: Off-Policy Evaluation via Recursive Reweighting and Moment Matching**  
Authors: Xiang Li, Nan Jiang  
Year: 2026  
URL: https://arxiv.org/abs/2605.06474  
Key change: finite-horizon recursive reweighting + moment matching；只要求 `Q^π` realizability 的 finite-sample framework。  
Limitation: 尚未解 adaptive repeated monitoring / e-process。

## Paper D
**DualDICE: Behavior-Agnostic Estimation of Discounted Stationary Distribution Corrections**  
Authors: Ofir Nachum, Yinlam Chow, Bo Dai, Lihong Li  
Year: 2019  
URL: https://arxiv.org/abs/1906.04733  
Code: https://github.com/google-research/google-research/tree/master/dual_dice  
Key change: behavior-policy agnostic stationary ratio correction，不直接依賴 trajectory importance weights。  
Limitation: learned ratio ≠ sequential statistical certificate。

## Paper E
**Breaking the Curse of Horizon: Infinite-Horizon Off-Policy Estimation**  
Authors: Qiang Liu, Lihong Li, Ziyang Tang, Dengyong Zhou  
Year: 2018  
URL: https://arxiv.org/abs/1810.12429  
Key change: stationary state-distribution IS 避免 trajectory ratio 的 horizon curse。  
Limitation: stationary / ergodic / state sufficiency assumptions。

## Paper F
**Doubly Robust Off-policy Value Evaluation for Reinforcement Learning**  
Authors: Nan Jiang, Lihong Li  
Year: 2016  
URL: https://proceedings.mlr.press/v48/jiang16.html  
Key change: bandit DR → sequential decision process，透過 stepwise model control variate 降低 IS variance。  
Limitation: long horizon / weak support 仍困難；不是 automatically anytime-valid。

---

# 八、已確認事實 / 推論 / 未驗證假說

## 已確認事實
- MDP policy 改變會改變 downstream state visitation。
- trajectory IS 的 cumulative ratio 會有 severe horizon variance 問題。
- stationary / discounted occupancy ratio 是另一種 distribution-shift correction abstraction。
- DualDICE official code 真的以 Bellman / TD residual 與 `ν, ζ` 解 ratio，而非長 trajectory ratio product。
- 2026 MDP statistical model checking 工作已正式把 confidence sequences 引入 unknown-transition online setting。
- FORE 2026 提出 adjoint-Bellman KL fixed-point occupancy-ratio estimation 與 coverage-stopped conservative lower bound。

## 工程實作推論
- Hermes 應加入 `TrajectoryCorrectionRouter`，依 horizon、support、stationarity、propensity availability 決定 PDIS / DR / occupancy ratio / transition-CS route。
- `Coverage` 應是一個 certificate object，不應只是 boolean。
- `Bellman residual` 應被保留在 evidence lineage 中，而不只存最後 value scalar。

## 尚未驗證假說
- DualDICE / FORE learned occupancy ratio 可以經一個通用轉換直接成 finite-sample e-process。
- 任意 neural Bellman residual 經 predictable betting 就能保證 Ville-validity。
- non-stationary LLM Agent 的 tool/MCP trajectory 可以可靠視為 stationary MDP。

**以上三項目前都不能當成已證明能力。**

---

# 九、Unknown / Open Questions

## 1. 如何把 learned occupancy-ratio uncertainty 轉成真正 anytime-valid trajectory evidence？

目前：

```text
ζ_hat
↓
value estimate
```

缺的是：

```text
ζ_hat uncertainty
+
Bellman-flow uncertainty
+
nuisance predictability
↓
martingale / e-process
↓
valid optional stopping
```

---

## 2. 非平穩 Agent runtime 還能不能用 stationary occupancy ratio？

Hermes 的：

```text
model version
memory
prompt
user intent
external APIs
world state
```

會一直改。

可能需要：

```text
local occupancy epoch
piecewise-stationary model
state augmentation
or
nonstationary occupancy measure
```

而不是一個永久 `d^π/d^D`。

---

## 3. POMDP / hidden state 下，Bellman-flow certificate 對哪個 state 成立？

若 UI context / tool output 不是 sufficient Markov state：

```text
P(S_{t+1}|S_t,A_t)
```

根本不成立。

Hermes 必須研究：

```text
History State
Belief State
Predictive State Representation
Latent World State
```

與 evidence validity 的關係。

---

# 十、下一輪研究

下一輪應專攻：

# **Bellman Martingale × Occupancy-Ratio Uncertainty × Markov / Mixing Sequential Inference × Trajectory E-Process**

研究鏈：

```text
MDP / POMDP event stream
↓
state sufficiency certificate
↓
Bellman residual process
↓
learned nuisance models frozen predictably
↓
Markov/mixing martingale conditions
↓
self-normalized / betting process
↓
trajectory e-process
↓
occupancy/value hypothesis
↓
e-BH / LORD / SCORE compatibility
↓
Agent permission certificate
```

應優先回答：

1. Bellman residual 何時是 martingale difference？
2. 單一 trajectory、Markov dependence 下應用哪一類 confidence sequence / e-process？
3. occupancy ratio 每次 refit 時，如何保證 `ζ_hat_t` 只用 `F_{t-1}`？
4. mixing time / regeneration 是否需進 certificate？
5. POMDP hidden state 會如何破壞 residual centering？
6. transition-CS route 與 occupancy-ratio route 能否組成同一 Evidence Algebra？

---

# 十一、Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
MDP Trajectory Evidence
State-Distribution Shift
Discounted Occupancy Measure
State Occupancy Ratio
State-Action Occupancy Ratio
Occupancy-Ratio Correction
Trajectory Likelihood Ratio
Horizon Variance Explosion
Bellman Flow Constraint
Adjoint Bellman Operator
Flow Critic ν
Density Ratio ζ
DualDICE
FORE
Coverage-Stopped OPE
Q-MMR
Recursive Moment Matching
Transition Confidence Sequence
Unknown-Kernel MDP
Dynamics-First Evidence
Value-First Evidence
Trajectory Correction Router
Causal State Sufficiency Gate
Trajectory Coverage Certificate
Occupancy Support Frontier
Bellman Flow Residual
Bellman Evidence Regime
Bellman Martingale Candidate
Trajectory Evidence Certificate
Local Occupancy Epoch
State Abstraction Validity
POMDP Evidence Gap
```

## 新 Edges

```text
Policy Action
→ changes
Future State Distribution

Target Policy
→ induces
Discounted Occupancy Measure

Occupancy Ratio
→ corrects
State-Action Distribution Shift

Bellman Flow Constraint
→ identifies / constrains
Occupancy Ratio

DualDICE
→ estimates
Occupancy Ratio

FORE
→ estimates via
Adjoint Bellman Fixed Point

Transition Confidence Sequence
→ bounds
Unknown Transition Kernel

Unknown Transition Kernel
→ induces
Policy Value Uncertainty

Coverage Failure
→ creates
Occupancy Support Frontier

Trajectory Evidence Certificate
→ gates
Agent Permission
```

## 新否定 Edges

```text
Contextual-Bandit OPE
≠
MDP Trajectory OPE

One-Step Policy Ratio
≠
State-Distribution Correction

Avoiding Trajectory IS
≠
Avoiding Coverage Assumption

Small Bellman Residual
≠
Certified Correct Occupancy Ratio

Occupancy-Ratio Point Estimate
≠
Anytime-Valid Evidence

Finite-Sample Offline Bound
≠
Optional-Stopping Guarantee

Transition Confidence Sequence
≠
Off-Policy Value Certificate Automatically

Stationary Occupancy Ratio
≠
Valid Non-Stationary Agent Model Automatically

Observed UI Context
≠
Markov State Automatically
```

---

# 十二、本輪結束判定

### 缺哪一層？
**Bellman / occupancy estimator → martingale / e-process 的 theorem bridge。**

### 哪個節點最淺？
`BellmanMartingaleCandidate`、`CausalStateSufficiencyGate`、`LocalOccupancyEpoch`、`TrajectoryEvidenceCertificate`。

### 哪個概念仍只是名詞？
Production 級 **Trajectory E-Process**。目前已有 contextual-bandit anytime-valid evidence、MDP transition confidence sequences、offline occupancy correction，但尚不能把它們簡單拼接後宣稱完整 theorem-valid。

### 哪個系統值得讀原始碼？
1. **Google Research DualDICE**：`dual_dice/algos/dual_dice.py`、`neural_dual_dice.py`、`transition_data.py`。
2. 下一步尋找 / 深讀 2026 MDP confidence-sequence tool 的正式 code release。
3. 若 FORE 後續釋出 code，優先追其 adjoint Bellman KL recursion。

### 哪篇論文需追引用？
**Confidence Sequences for Online Statistical Model Checking of Markov Decision Processes (2026)**，並追其 Markov-chain / transition-row confidence-sequence 引用；其次是 FORE 2026，追 occupancy-ratio fixed-point 與 coverage-stopped OPE。

### 哪個概念最適合視覺模擬？
**Trajectory Weight × Occupancy Flow × MDP Evidence Lab**。

### 哪個 Agent 架構最值得實作？
**Trajectory Correction Router + Causal State Sufficiency Gate + Permission Gate**：

```text
Agent trajectory
↓
state sufficiency
↓
choose PDIS/DR vs occupancy ratio vs transition-CS
↓
coverage / validity certificate
↓
permission
```

---

# 十三、對「AI 到底怎麼運作」補上的新層

從使用者對 AI 說一句話開始：

```text
User Input
↓
UI
↓
Agent Context / Memory
↓
Reasoning / Planning
↓
Action
↓
Tool / MCP / Human / Environment
↓
Next State
↓
New Observation
↓
Next Action
```

到了這一輪，最重要的理解是：

> **AI Agent 並不是每一回合都在同一個世界裡重新做獨立判斷。它前一個 action 會改變下一個 state、可看到的資料、使用者反應、工具狀態與風險分布。因此要回答「如果換一個 Agent policy 會怎樣」，不能只改 action probability；還必須修正 policy 所誘發的整個 state-visitation distribution。Trajectory IS 在 path-space 做這件事，但長 horizon 會產生巨大 variance；occupancy-ratio / Bellman-flow 方法則把同一個問題搬到 state-action distribution 層。下一個真正的研究關卡，是讓這種 Bellman / occupancy correction 不只給 point estimate，而能形成可持續監控、可 optional-stop、可進 multiplicity runtime、最後真正控制 Tool/MCP permission 的 sequential certificate。**
