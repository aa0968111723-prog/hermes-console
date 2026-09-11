# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 04:55（Asia/Taipei）**  
**本輪主題：Core Predictive Test Discovery × Hankel Rank × Spectral PSR × Reward/Decision Sufficiency × Active Test Acquisition**

## 與上一輪的差異

上一輪已建立：Belief State ≠ Predictive State，並把核心缺口收斂到「到底應選哪些 future tests 才能形成 decision-sufficient predictive state」。本輪不再重複 latent-state / belief compression，而專門研究：

1. 如何從大量 action-observation future tests 中找到最小但足夠的 core tests；
2. Hankel / system-dynamics matrix 的 rank 到底代表什麼；
3. spectral PSR 如何從可觀測統計量建立 predictive state；
4. 為什麼 predictive sufficiency 仍不等於 reward / safety / decision sufficiency；
5. Hermes Runtime 應如何主動取得新的 predictive tests，而不是固定一組 test bank 永久使用。

---

## 本小時新發現

### 新論文 / 新方向

- **Toward Learning POMDPs Beyond Full-Rank Actions and State Observability** — Seiji Shaw, Travis Manderson, Chad Kessens, Nicholas Roy, WAFR 2026 / arXiv:2601.18930。作者從 PSR 出發，在較弱 rank 假設下恢復 POMDP observation / transition structure到 observationally equivalent state partition，並證明某些 hidden distinctions 從 sequential data 根本不可辨識。  
  URL: https://arxiv.org/abs/2601.18930
- **Generalized Eluder Coefficient: A Unified Framework for Interactive Decision Making in MDP, POMDP, and Beyond** — Han Zhong et al., Mathematics of Operations Research, online 2026-06-15。PSR 被放進更一般 interactive decision making framework，重點轉向「什麼結構使 exploration / identification sample-efficient」。  
  URL: https://pubsonline.informs.org/doi/10.1287/moor.2023.0195
- **Provably Efficient UCB-type Algorithms For Learning Predictive State Representations** — Ruiquan Huang, Yingbin Liang, Jing Yang, ICLR 2024。將 PSR low-rank structure 與 online/offline UCB exploration 接起來，給出 tractable learning 與 last-iterate policy 保證。  
  URL: https://proceedings.iclr.cc/paper_files/paper/2024/hash/cbfa01fae7875353d954429795d954f5-Abstract-Conference.html
- **Reconciling Rewards with Predictive State Representations** — Andrea Baisero, Christopher Amato, IJCAI 2021。證明 observation-predictive PSR 並不自動保證 reward accuracy，提出 R-PSR。  
  URL: https://www.ijcai.org/proceedings/2021/299

### 新 GitHub / 原始碼

深入閱讀：**abaisero/rl-rpsr**  
URL: https://github.com/abaisero/rl-rpsr

值得看的核心目錄與檔案：

```text
rl_rpsr/
├── core.py
├── linalg.py
├── psr/
│   ├── search.py          # core-test basis discovery
│   ├── model.py           # PSR operators / state update
│   ├── env.py
│   └── value_iteration.py
├── rpsr/
│   ├── search.py          # reward-predictive core search
│   ├── model.py
│   └── value_iteration.py
├── metrics.py
└── tests/
```

工程上最重要的事實是：`psr/search.py` 並不是靠語義名稱或 frequency 挑 core tests，而是把每個 candidate test 映射成 outcome vector，檢查它是否相對目前 basis 線性獨立；BFS/DFS 會持續 prepend action-observation interaction，直到沒有新增獨立方向。`psr/model.py` 則用 core-test outcome matrix `U`、pseudo-inverse `U_PI`、operator `M_aoQ` / `m_ao` 建 predictive-state update：

```text
state_{t+1}
=
(state_t @ M_{a,o})
/
(state_t @ m_{a,o})
```

這提供 Hermes 一個非常具體的「Predictive State Compiler」原型。

---

# 本小時最重要 5 個發現

## 1. Core Test Discovery 本質上是「找能張成 predictive future space 的 basis」，不是挑最常見事件

### 是什麼

PSR 的 test 是 future action-observation sequence，例如：

```text
τ =
(query_quota, HIGH)
→ (wait_30s, RECOVERED)
```

一個 core-test set `Q={q1,...,qr}` 必須讓任意 future test 的 probability 都可由 `p(Q|history)` 表示。

### 底層如何運作

建立 system-dynamics / Hankel-like matrix：

```text
                histories h
           h1    h2    h3   ...
tests q1  p11   p12   p13
tests q2  p21   p22   p23
...
```

其中 entry 為可觀測 conditional/joint future probability。若此矩陣有效 rank 為 `r`，理論上只需要 `r` 個獨立 predictive directions。

`rl-rpsr` 的實作把 candidate test 轉成 outcome vector，透過 `linearly_independent(vectors, vector)` 決定是否加入 `Q`。所以 core discovery 更接近：

```text
Candidate Test
↓
Outcome Vector
↓
Project onto Existing Basis
↓
Residual / Linear Independence
↓
ADD or REJECT
```

### 為什麼重要

Hermes 不可能枚舉：

```text
500 tools
× observations
× sequence length
```

所以需要 basis discovery，而不是 fixed test catalogue。

### 限制

`rl-rpsr` 這份程式碼在 core search 時直接存取已知 POMDP model 的 `G` matrices，屬於 model-aware core search；production Hermes 面對的是 black-box tool/runtime，不能直接複製，必須改成用 empirical Hankel / predictive estimates。

### 來源

- Singh et al., Learning Predictive State Representations, ICML 2003: https://www.cs.utexas.edu/~pstone/Papers/bib2html/b2hd-ICML03.html
- `abaisero/rl-rpsr/rl_rpsr/psr/search.py`

---

## 2. Hankel Rank 是「可預測行為維度」，不是 hidden-state 數量的天然真相

### 是什麼

若完整 dynamics matrix/Hankel object 的 rank 為 `r`，表示 histories 對 future tests 造成的差異最多存在 `r` 個線性獨立方向。

### 底層如何運作

```text
H(T,H)
≈ U Σ Vᵀ
```

保留 non-negligible singular directions：

```text
σ1 ≥ σ2 ≥ ... ≥ σr >> σr+1
```

得到 predictive dimension `r`。

Spectral learning 的核心不是先猜 latent state，而是：

```text
Observed trajectories
↓
Estimate test-history statistics
↓
Construct Hankel submatrix
↓
SVD / low-rank factorization
↓
Predictive coordinates
↓
Observable operators
↓
Recursive state update
```

### 為什麼重要

它提供一個可以真正量測的 runtime 指標：Hermes 的 internal state 到底需要幾個 predictive degrees of freedom。

### 限制

有限資料時 rank 不是乾淨整數；會遇到：

- rare-test estimation noise；
- singular-value threshold 敏感；
- poor conditioning；
- basis coverage不足；
- selected histories/tests 不是完整 span。

因此：

```text
Observed Numerical Rank
≠
True Predictive Rank
```

2026 Shaw et al. 更進一步指出，即使 predictive model 足夠，也可能只辨認到 observational equivalence partition，而非唯一 latent world decomposition。

### 來源

- Shaw et al. 2026: https://arxiv.org/abs/2601.18930
- Spectral basis-selection literature: https://arxiv.org/abs/1612.09076

---

## 3. Predictive Sufficiency ≠ Decision Sufficiency；這是上一輪 Decision-Sufficient State 最重要的數學補強

### 是什麼

一組 tests 可能完美預測 observations，卻不足以決定 rewards、risk 或 irreversible effect。

### 已確認論文結果

Baisero & Amato (IJCAI 2021) 證明 PSR 與 POMDP 在 observation generative process 上可以 indistinguishable，但普通 PSR 不一定能精確表示 reward。作者提出 reward-predictive PSR (R-PSR)，並展示 approximate PSR reward 可造成 optimal-policy mismatch，而 R-PSR 能恢復正確 policy。

### Hermes 的對應

所以 Hermes 的 test bank 不應只有：

```text
Will observation X happen?
```

還必須納入：

```text
Will external write occur?
Will irreversible effect occur?
Will policy violation occur?
Will retry duplicate effect?
Will user goal succeed?
Will cost exceed budget?
```

因此定義：

```text
TaskScopedCoreTestSet
=
Predictive Basis
∪ Reward Basis
∪ Safety Basis
∪ Effect Basis
```

### 為什麼重要

這直接否定：

```text
Low prediction error
→ state representation is sufficient
```

更準確應是：

```text
SufficientFor(Observations)
≠
SufficientFor(Reward)
≠
SufficientFor(Safety)
≠
SufficientFor(Control)
```

### 限制

「所有未來 task 都 decision-sufficient」會讓 representation 再度爆炸；因此 certificate 必須 task-scoped / safety-scoped，而不是宣稱 globally sufficient。

### 來源

- Baisero & Amato, IJCAI 2021: https://www.ijcai.org/proceedings/2021/299
- Code: https://github.com/abaisero/rl-rpsr

---

## 4. Spectral PSR 的真正價值是把 hidden-state learning 轉成 observable linear algebra，但 conditioning 是關鍵瓶頸

### Architecture / Bottom-level mechanism

理想化流程：

```text
Histories H
+
Future Tests T
↓
P_{T,H}
↓
SVD
P_{T,H} ≈ U Σ Vᵀ
↓
Select predictive rank r
↓
Build low-dimensional state coordinates
↓
Estimate action-observation operators B_{a,o}
↓
Recursive Filter
q_{t+1}
∝
B_{a_t,o_{t+1}} q_t
```

`rl-rpsr/model.py` 的 concrete form 是利用 core outcome matrix `U` 與 pseudo-inverse `U_PI` 建 operator，然後以 normalization update predictive state。

### 為什麼重要

這種 state 每一維理論上可對應 future observable quantity，較容易放進 Hermes Console 做 visualization / verification。

### 但限制更值得注意

當 core basis 幾乎 collinear：

```text
σ_min → 0
```

pseudo-inverse 會放大 estimation noise。

所以 Hermes 不能只有：

```text
rank = 12
```

還應追：

```text
PredictiveBasisHealth
├ numerical_rank
├ singular_spectrum
├ condition_number
├ minimum_singular_value
├ test_support
├ estimation_variance
└ drift_since_last_fit
```

這也與 modern PSR 理論裡的 well-conditioned PSR 假設相呼應；ICLR 2024 UCB-type work 即依賴 low-rank / well-conditioned structure，才能得到 tractable sample-efficient learning。

### 來源

- Huang, Liang, Yang, ICLR 2024: https://proceedings.iclr.cc/paper_files/paper/2024/hash/cbfa01fae7875353d954429795d954f5-Abstract-Conference.html
- `abaisero/rl-rpsr/rl_rpsr/psr/model.py`

---

## 5. Core tests 不應一次選完；production Hermes 需要 Active Predictive Test Acquisition

### 問題

固定 test bank 在 nonstationary runtime 會逐漸失效：

```text
new MCP tool
new side effect
new provider regime
new policy constraint
new multimodal channel
```

都可能產生新的 predictive direction。

### 本輪提出的工程模型

```text
Runtime History
↓
Current Core Test Bank Q
↓
Prediction Residual Monitor
↓
Candidate Test Generator
↓
Estimate Marginal Span Gain
+
Decision Relevance
+
Safety Relevance
+
Information Gain
-
Probe Cost
-
Risk
↓
SELECT TEST
↓
Execute / Observe
↓
Update Hankel Sketch
↓
Rank / Basis Update
↓
Recertify Decision Sufficiency
```

候選 test utility：

```text
TestUtility(τ)
=
α · PredictiveSpanGain(τ)
+ β · DecisionDiscrimination(τ)
+ γ · SafetyDiscrimination(τ)
+ δ · ExpectedInformationGain(τ)
- λ · Cost(τ)
- μ · Risk(τ)
```

### 合理推論（尚未驗證成 production theorem）

Hermes 最實際的 test acquisition 不應只追 global Hankel rank，而應追 **task-weighted rank gain**：如果一個新 singular direction 只解釋無關緊要的 telemetry，而完全不影響 action / safety / effect decision，可以暫不納入 online state。

因此：

```text
Predictive Rank
≠
Operational State Dimension
```

真正要的是：

```text
Decision-Critical Predictive Rank
```

---

# Architecture Breakdown

## Proposed: Predictive State Compiler & Certification Runtime

```text
Raw Runtime Trajectories
├ user observations
├ tool calls
├ MCP responses
├ memory reads/writes
├ model routing
├ external effects
├ multimodal observations
└ safety/evaluation signals
        ↓
History Encoder
        ↓
Candidate Future-Test Generator
├ action-observation tests
├ effect tests
├ reward tests
├ safety tests
└ multimodal tests
        ↓
Empirical Hankel / Dynamics Sketch
        ↓
Spectral Analyzer
├ SVD
├ numerical rank
├ conditioning
└ residual structure
        ↓
Core-Test Basis Selector
        ↓
Predictive State Filter
        ↓
Decision-Sufficiency Auditor
├ goal value
├ reward
├ safety
├ irreversible effect
├ retry semantics
└ measurement value
        ↓
Certificate
        ↓
Agent Planner
        ↓
Action
        ↓
New Observation
        ↺
```

### Certificate proposal

```text
DecisionSufficientPredictiveStateCertificate
├ task_scope
├ safety_scope
├ effect_scope
├ core_test_set_version
├ hankel_sketch_version
├ numerical_rank
├ singular_spectrum
├ conditioning
├ predictive_error
├ action_disagreement_rate
├ safety_disagreement_rate
├ reward_error
├ effect_disagreement_rate
├ test_coverage
├ unsupported_future_region
└ invalidation_conditions
```

---

# Bottom-Level Logic

## A. Hankel object

For history `h` and future test `τ`:

```text
H[τ,h] = P(τ | h)
```

或在 spectral estimation 中使用對應 joint probability form。

若：

```text
rank(H)=r
```

則理想線性 PSR 可以用 r 維 predictive coordinates 表示所有 future tests。

## B. Core test basis

找到 `Q={q1,...,qr}` 使 row/column span 足以表示其他 tests：

```text
p(τ|h)
=
w_τᵀ q(h)
```

其中：

```text
q(h)
=
[P(q1|h), ..., P(qr|h)]
```

## C. Update

執行 action `a`、收到 observation `o` 後：

```text
q(h a o)
=
Normalize(B_{a,o} q(h))
```

`rl-rpsr` 的程式實作以 `state @ M / state @ m` 完成等價 normalization。

## D. Decision certification

建立 full/teacher state representation `s*` 與 compressed predictive state `q` 的 decision comparison：

```text
Δ_action
= P( argmax_a Q(a|q) != argmax_a Q(a|s*) )

Δ_safety
= P( Safety(q) != Safety(s*) )

Δ_effect
= P( EffectDecision(q) != EffectDecision(s*) )
```

只有 predictive error 低而上述 disagreement 高時：

```text
PREDICTIVELY GOOD
BUT
NOT DECISION SUFFICIENT
```

---

# Visual Simulation Idea

## **Hankel Rank & Core Test Discovery Lab**

### Panel 1 — Future Test Matrix

以 heatmap 顯示：

```text
                histories
             h1 h2 h3 h4
query quota   .9 .8 .1 .2
retry success .2 .3 .8 .7
write occurs  .7 .7 .7 .7
...
```

使用者可動態增加/刪除 test，立即看：

```text
Numerical Rank       7 → 8
Condition Number    18 → 96 ⚠
Decision Rank        5 → 6
Safety Rank          3 → 4
```

### Panel 2 — Singular Spectrum

```text
σ1 █████████
σ2 ███████
σ3 █████
σ4 ███
σ5 █
after σ5 → noise floor
```

拖動 rank threshold 即時看到 predictive error、action disagreement、safety disagreement。

### Panel 3 — Core Test Graph

每個 node 是 future test：

```text
[quota high?]
      │
      ├── independent → CORE
      │
[retry success?]
      │
      └── redundant → COLLAPSED
```

### Panel 4 — Predictive vs Decision Sufficiency

```text
Prediction Error       1.8%   ✓
Reward Error          13.2%   ⚠
Action Disagreement    9.7%   ⚠
Safety Disagreement    4.1%   ✕

STATUS:
Predictively Sufficient
Decision Insufficient
```

這個 simulator 很適合直接回答「為什麼 AI 的 internal state 不能只看 prediction loss」。

---

# Code / GitHub

## abaisero/rl-rpsr

Repository: https://github.com/abaisero/rl-rpsr

### `rl_rpsr/psr/search.py`
值得讀：

- `outcome(model, test)`：將 test 反向套用 interaction operators 得 outcome vector；
- `independent(...)`：測 candidate outcome vector 是否相對 core basis 線性獨立；
- `BFS_PSR_Searcher.search()`：從單步 interaction 開始，反覆 prepend interaction 擴張 test basis；
- `_search_dfs()`：DFS 版本 core discovery。

### `rl_rpsr/psr/model.py`
值得讀：

- `U = outcome_matrix(Q)`；
- `U_PI = pinv(U)`；
- `M_aoQ` / `m_ao`；
- `dynamics(state, action, observation)`；
- `observation_probs()`；
- reward projection `R`。

### 下一步值得讀

```text
rl_rpsr/rpsr/search.py
rl_rpsr/rpsr/model.py
rl_rpsr/linalg.py
rl_rpsr/metrics.py
```

目的：比較普通 PSR basis 與 reward-predictive basis 在 core dimension、policy consistency、reward fidelity 上到底差在哪。

---

# Papers

## 1. Toward Learning POMDPs Beyond Full-Rank Actions and State Observability
- **Authors:** Seiji Shaw, Travis Manderson, Chad Kessens, Nicholas Roy
- **Institution:** MIT Robust Robotics Group / collaborating robotics researchers（依 MIT RRG publication listing；作者個別 affiliation 後續再逐一核對）
- **Year:** 2026
- **Venue:** WAFR 2026 / arXiv
- **URL:** https://arxiv.org/abs/2601.18930
- **Code:** 本輪未確認官方 code release
- **Dataset:** discrete POMDP numerical experiments
- **Architecture:** PSR spectral structure + tensor decomposition + state partition recovery
- **Contribution:** 弱化 full-rank / full-observability assumptions，恢復 explicit POMDP structure 到可識別 partition
- **Limitations:** 無法突破 observational equivalence；部分 hidden-state distinctions 從 sequential data 不可識別
- **改變了什麼:** 把「PSR 可以預測」與「能否恢復 explicit latent system」之間的界線說得更清楚。

## 2. Provably Efficient UCB-type Algorithms For Learning Predictive State Representations
- **Authors:** Ruiquan Huang, Yingbin Liang, Jing Yang
- **Year:** 2024
- **Venue:** ICLR 2024
- **URL:** https://proceedings.iclr.cc/paper_files/paper/2024/hash/cbfa01fae7875353d954429795d954f5-Abstract-Conference.html
- **Architecture:** low-rank/well-conditioned PSR + optimistic UCB learning
- **Contribution:** tractable online/offline PSR learning、model accuracy、last-iterate near-optimal policy
- **Limitations:** 仍需 structural conditioning assumptions；不是任意黑盒 agent runtime 的 plug-and-play solution
- **改變了什麼:** PSR 從 representation theory 走向可計算 exploration/control algorithm。

## 3. Reconciling Rewards with Predictive State Representations
- **Authors:** Andrea Baisero, Christopher Amato
- **Year:** 2021
- **Venue:** IJCAI 2021
- **URL:** https://www.ijcai.org/proceedings/2021/299
- **Code:** https://github.com/abaisero/rl-rpsr
- **Dataset:** 多個公開 POMDP domains（repo 內含 Tiger、Hallway、Aloha、Tag 等）
- **Architecture:** PSR vs Reward-Predictive PSR + value iteration
- **Contribution:** 提出 reward accuracy 的 necessary/sufficient condition 與 R-PSR
- **Limitations:** 主要是離散 POMDP / tabular-linear formulation
- **改變了什麼:** 明確證明 observation sufficiency 不等於 control/reward sufficiency。

## 4. Learning Predictive State Representations
- **Authors:** Satinder Singh, Michael L. Littman, Nicholas K. Jong, David Pardoe, Peter Stone
- **Year:** 2003
- **Venue:** ICML 2003
- **URL:** https://www.cs.utexas.edu/~pstone/Papers/bib2html/b2hd-ICML03.html
- **Contribution:** 把 PSR learning 拆成「discover good tests」與「learn predictions for tests」兩個子問題
- **Why still important:** 本輪 Hermes 的 Predictive State Compiler 幾乎就是這兩層的 production 化版本。

---

# Fact / Inference / Hypothesis Separation

### 已確認事實
- PSR state 可由 future observable test predictions 組成。
- spectral PSR 使用 low-rank Hankel/system-dynamics statistics 建 compact state。
- `rl-rpsr` 的 core search 實際依 linear independence 加入 tests。
- ordinary observation PSR 不自動保證 reward representation accuracy。

### 官方 / 論文結果
- Shaw et al. 2026：某些 latent states 只能恢復到 observational equivalence partition。
- Baisero & Amato 2021：PSR reward mismatch 可造成 policy mismatch；R-PSR 修正。
- Huang et al.：在 low-rank/well-conditioned PSR assumptions 下可做 tractable UCB-style learning。

### 工程實作
- `rl-rpsr/psr/search.py`：model-aware linear-independence core search。
- `rl-rpsr/psr/model.py`：pseudo-inverse + observable operators + normalized predictive update。

### 合理推論
- Hermes 應使用 task-weighted predictive rank，而不是 global numerical rank 作為 online state dimension。
- Core test bank 應隨 tool/MCP/model/environment drift 動態重新發現。

### 尚未驗證假說
- `Decision-Critical Predictive Rank` 能否成為跨 Agent framework 通用 runtime metric。
- 在大型 MCP/tool space 中，active test acquisition 能否以低 probe budget 維持 stable basis conditioning。

---

# Unknown / Open Questions

1. **Black-box Core Test Discovery**：沒有 POMDP `G` matrix 時，怎樣用 sparse streaming trajectories 穩定判斷「新 test 是否提供獨立 predictive direction」？
2. **Continuous / Multimodal Tests**：Image/Voice/Video observation 不是離散 symbol 時，test 要用 event classifier、embedding region、kernel feature 還是 learned observable functional？
3. **Decision-Sufficiency Bound**：如何把 singular-spectrum truncation error 轉成「最大 action / safety disagreement」的可驗證 bound？

---

# 下一輪研究

## **Streaming Hankel Sketch × Online Rank Tracking × Continuous/Multimodal Predictive Tests × Kernel/Neural PSR**

下一輪應直接解 production scalability：

```text
Agent Runtime Stream
↓
History/Test Feature Encoder
↓
Streaming Hankel Sketch
↓
Online SVD / Rank Tracking
↓
Conditioning Monitor
↓
Candidate Test Acquisition
↓
Kernel / Neural Predictive Operators
↓
Multimodal Future Tests
↓
Decision-Sufficiency Monitor
```

尤其要研究：

- Randomized / incremental SVD；
- Nyström / sketching；
- kernel PSR / Hilbert-space embeddings；
- RFF-PSR；
- recurrent / neural predictive-state filters；
- image/audio/video future test featureization；
- singular-spectrum drift detection；
- online core-test replacement。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Predictive Test
Core Predictive Test
Core Test Basis
Test Outcome Vector
System Dynamics Matrix
Controlled Hankel Matrix
Predictive Rank
Numerical Predictive Rank
Decision-Critical Predictive Rank
Singular Spectrum
Predictive Basis Conditioning
Spectral PSR
Observable Operator
Predictive State Filter
Reward-Predictive State
Reward Sufficiency
Safety Sufficiency
Effect Sufficiency
Task-Scoped Sufficiency
Core Test Discovery
Active Predictive Test Acquisition
Predictive Span Gain
Decision Discrimination Gain
Task-Weighted Rank
Predictive State Compiler
Decision-Sufficient Predictive State Certificate
```

## Edges

```text
History --conditions--> Predictive Test Probability
Core Test Set --spans--> Predictive Future Space
Hankel Matrix --reveals--> Predictive Rank
SVD --extracts--> Predictive Coordinates
Core Test --forms--> Predictive State
Predictive State --updates_via--> Observable Operator
Reward-Predictive State --extends--> Predictive State
Active Test Acquisition --updates--> Core Test Basis
Core Test Basis --constrains--> State Dimension
Decision-Sufficiency Auditor --certifies--> Predictive State
```

## Important negative edges

```text
Predictive Rank ≠ Hidden-State Count Truth
Numerical Rank ≠ True Predictive Rank
Predictive Sufficiency ≠ Reward Sufficiency
Predictive Sufficiency ≠ Safety Sufficiency
Low Prediction Error ≠ Decision Sufficiency
Core Test Frequency ≠ Core Test Importance
More Tests ≠ Better Conditioning
Low-Dimensional State ≠ Well-Conditioned State
Observation-Equivalent ≠ Mechanistically Identical
Global Predictive Rank ≠ Operational State Dimension
```

---

# 本輪結束檢查

- **缺哪一層：** Streaming / black-box Hankel estimation layer。
- **哪個節點最淺：** `Decision-Critical Predictive Rank`，目前是工程定義，還缺正式 estimator / guarantee。
- **哪個概念仍只是名詞：** `DecisionSufficientPredictiveStateCertificate`、`TaskWeightedRank`、`PredictiveStateCompiler ABI`。
- **哪個系統值得繼續讀原始碼：** `abaisero/rl-rpsr` 的 `rpsr/search.py`, `rpsr/model.py`, `linalg.py`；下一批應讀 RFF-PSR / kernel PSR code。
- **哪篇論文需追引用：** Shaw et al. 2026（identifiability boundary）與 Huang et al. ICLR 2024（well-conditioned PSR + exploration）。
- **哪個概念最適合視覺模擬：** **Hankel Rank & Core Test Discovery Lab**。
- **哪個 Agent 架構最值得實作：**

> **Predictive-State Agent Runtime = Streaming Trajectory Encoder + Candidate Future-Test Generator + Hankel/Spectral Analyzer + Core-Test Basis Manager + Predictive State Filter + Reward/Safety/Effect Sufficiency Auditor + Active Test Acquisition + Task-Scoped Decision Certificate。**

本輪真正補上的核心觀念是：**AI internal state 不該因為「維度很小」或「預測 loss 很低」就被視為好的世界模型；它應由一組可觀測 future tests 張成，能在數值上穩定更新，而且對當前 goal、reward、safety 與 tool effects 保留足夠的決策資訊。**