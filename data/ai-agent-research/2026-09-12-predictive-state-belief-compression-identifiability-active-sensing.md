# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 03:55（Asia/Taipei）**  
**本輪主題：Predictive State Representation × Belief Compression × Latent-State Identifiability × State Aliasing Attribution × Active Sensing × Decision-Sufficient State**

> 研究定位：本輪直接承接上一輪「Hidden-State Dependence × Belief-State Engine × HMM/HSMM × State Aliasing × Active Measurement」。上一輪建立了 latent state / belief posterior，但仍留下三個關鍵缺口：1) latent state label 是否真的可識別？2) belief 太高維時如何壓縮而不破壞決策？3) predictive accuracy 是否足以證明 state representation 正確？本輪集中解這三層，並把 PSR、belief compression、identifiability test 與 active sensing 合成 Hermes 的 Decision-Sufficient State Runtime。

---

## 本小時新發現

### 新論文 / 新架構

1. **Toward Learning POMDPs Beyond Full-Rank Actions and State Observability** — Seiji Shaw, Travis Manderson, Chad Kessens, Nicholas Roy, 2026, arXiv:2601.18930  
   URL: https://arxiv.org/abs/2601.18930  
   核心：從 action-observation sequence 學離散 POMDP；結合 Predictive State Representation 與 tensor decomposition，把 transition / observation model 恢復到 similarity transform / state partition 的層級。論文同時構造「所有 observation distribution 相同、但 latent dynamics 不同」的 POMDP，證明僅靠 sequential observational data 無法突破某些 state partition。  
   **改變了什麼：** 把「hidden state learning」的上限明確化：有些 latent states 本質上不可由現有 observation stream 區分，Agent 不應假裝自己已經辨認出真實 hidden state。

2. **What Capable Agents Must Know: Selection Theorems for Robust Decision-Making under Uncertainty** — Aran Nayebi, 2026, arXiv:2603.02491  
   URL: https://arxiv.org/abs/2603.02491  
   Institution: Carnegie Mellon University（作者公開資料）  
   核心：低 regret 的 competent agent 在特定 action-conditioned predictive task family 下，會被迫實作 predictive structured internal state；在 partial observability 下導出 belief-like memory / predictive state 的必要性。  
   **改變了什麼：** 把 belief/PSR 從「一種可行設計」推向「對某些 task distributions 而言，功能上不可避免的內部結構」。

3. **Why Does the Future Branch? Identifiable Closure Tests for Stochastic Physical World Models** — Yibin Dong, 2026, arXiv:2608.00591  
   URL: https://arxiv.org/abs/2608.00591  
   核心：即使 probabilistic predictor 完美，ordinary transition data 也無法辨認 forecast uncertainty 是 state aliasing 還是 process noise；提出 ClosurePairs，以 compatible microstates × repeated exogenous disturbances 的配對干預和 two-way variance decomposition，把 state aliasing、process noise 與 interaction 分開。  
   **結果：** 在論文報告的 likelihood-equivalent Gaussian setting 中，paired supervision 讓 alias-fraction error 改善 15.96×；18 個 nonlinear Langevin conditions 中 attribution MAE 從 0.372 降至 0.051。  
   **改變了什麼：** prediction/calibration 不再足以作為 world-state representation certification；需要 interventional identifiability test。

4. **CompressedBeliefMDPs.jl: A Julia Package for Solving Large POMDPs with Belief Compression** — Logan Mondal Bhamidipaty, Mykel J. Kochenderfer, JOSS 2025  
   URL: https://joss.theoj.org/papers/10.21105/joss.07346  
   Code: https://github.com/JuliaPOMDP/CompressedBeliefMDPs.jl  
   核心：把 belief compression pipeline 抽象成 Sampling → Compression → Compressed Belief MDP Construction → Planning，可用 PCA / VAE / manifold compressor 等方法降低 belief-space 維度。  
   **改變了什麼：** Hermes 的 belief store 不應永遠保存完整 posterior；可以建立可逆性/決策保真度受監控的 compressed belief state。

5. **Active Measuring in Reinforcement Learning With Delayed Negative Effects** — Daiqi Gao, Ziping Xu, Aseel Rawashdeh, Predrag Klasnja, Susan A. Murphy, AISTATS 2026  
   URL: https://proceedings.mlr.press/v300/gao26d.html  
   Code: https://github.com/StatisticalReinforcementLearningLab/Active-Measuring  
   核心：AOMDP 讓 agent 同時選 control action 與 measurement action；measurement 會揭露 latent state，但可能有 cost 和 delayed negative effect。以 sequential Monte Carlo 近似 unknown parameters + hidden state posterior。  
   **改變了什麼：** Hermes 的「查 quota / probe health / inspect queue / verify world state」應被正式建模成 action，而不是 debug side channel。

6. **Predictive Representations for Skill Transfer in Reinforcement Learning** — Ruben Vereecken, Luke Dickens, Alessandra Russo, 2026, arXiv:2604.07016  
   URL: https://arxiv.org/abs/2604.07016  
   核心：Outcome-Predictive State Representations（OPSR）以 task-independent outcome predictions 建立 compact abstraction，並把其上 skills/options 做跨任務 transfer。  
   **改變了什麼：** predictive state 不只可做 filtering，也能作為跨任務 reusable skill 的 interface。

---

## 本小時最重要 5 個發現

### 1. Hidden State Identity ≠ Decision-Relevant State

上一輪 Hermes 開始維護：

```text
Belief(State_A)=0.41
Belief(State_B)=0.33
Belief(State_C)=0.26
```

但本輪發現更根本的一層：`State_A / B / C` 的 label 未必有可識別的世界語義。

PSR 的觀點是不要先問：

```text
我到底身處哪個 latent state？
```

而是問：

```text
如果我執行 action sequence α，
未來 observation event W 發生的機率是多少？
```

定義 predictive test：

```text
T = (a1,o1,a2,o2,...,ak,ok)
```

predictive coordinate：

```text
p_T(h)
= P(o1,...,ok | history=h, do(a1,...,ak))
```

Hermes 因此應新增兩個 state layer：

```text
Latent Belief State
b_t(s)=P(S_t=s|h_t)

Predictive State
q_t=[p(T1|h_t),...,p(Tm|h_t)]
```

兩者不是互斥：

```text
Belief State
→ interpretable hidden-world hypotheses

Predictive State
→ observable future consequences
```

**重要限制：** Shaw et al. 2026 證明有些 POMDP latent states 從 sequential data 最多只能恢復到 observationally equivalent partition。這表示：

```text
State Label Confidence
≠
State Identifiability
```

Hermes 不應把 clustering 出來的 latent label 自動命名成「provider degraded」「quota-limited」並當真實世界 ontology。

---

### 2. Predictive Accuracy ≠ Identifiability

如果模型預測：

```text
Next outcome variance = 10
```

這 10 可能來自：

```text
A. State Aliasing
同一 observation 底下混了不同 hidden worlds

B. Process Noise
hidden world 已完全確定，但世界本身 stochastic

C. A × B interaction
```

而 ordinary transition data 可能讓 A 與 B 完全 likelihood-equivalent。

因此：

```text
Low NLL
Good calibration
Accurate next-token/outcome prediction
```

都不能回答：

```text
Should I sense more?
OR
Should I branch / sample more futures?
```

ClosurePairs 的 operational implication 非常適合 Hermes：

```text
If uncertainty ≈ aliasing
→ MEASURE / VERIFY / ASK TOOL

If uncertainty ≈ process noise
→ BRANCH / MONTE CARLO / ROBUST PLAN
```

所以 Hermes 要新增：

```text
UncertaintyAttribution
├ epistemic_state_aliasing
├ aleatoric_process_noise
├ model_error
├ interaction
└ unresolved
```

以及：

```text
PredictionConfidence
≠
UncertaintySourceConfidence
```

---

### 3. Belief Compression 必須保「Decision Sufficiency」，不能只保 reconstruction

完整 belief：

```text
b ∈ R^10000
```

壓縮：

```text
z = C(b)
z ∈ R^32
```

最容易犯的錯是只最小化：

```text
||b - Decode(C(b))||
```

但 Agent 真正在意的是：

```text
π*(b) ≈ π*(z)
Q(b,a) ≈ Q(z,a)
Risk(b,a) ≈ Risk(z,a)
MeasurementValue(b) ≈ MeasurementValue(z)
```

因此 Hermes 的壓縮 objective 應拆成：

```text
L_total
=
λ_rec L_reconstruction
+ λ_pred L_future_prediction
+ λ_act L_action_consistency
+ λ_risk L_risk_consistency
+ λ_probe L_measurement_value_consistency
```

**已確認工程實作：** CompressedBeliefMDPs.jl 的 pipeline 確實是：

```text
Sample beliefs
→ fit Compressor
→ encode belief
→ construct compressed-belief MDP
→ solve base policy
```

`src/cbmdp.jl` 的 `encode/decode/gen` 把 compressed state 直接當 MDP state；`src/solver.jl` 再用 Local Approximation Value Iteration / nearest-neighbor function approximation 做 planning。

但程式也留下值得 Hermes 注意的限制：為方便解碼，它把 compression 結果以 first-come-first-served cache 當成 effectively bijective；這是工程技巧，不代表 compressor 在數學上真的是 injective。

因此：

```text
Reconstructable Cache
≠
Information-Preserving Representation
```

---

### 4. Active Sensing 的核心不是「entropy 最大就量測」，而是 Value of Decision Improvement

上一輪提出 measurement utility，本輪透過 Active-Measuring source code 把底層再拆一層。

其 repo 中：

```text
src/predictor.py
```

明確維護 Gaussian posterior parameter inference；而：

```text
src/rlsvi_query.py
```

不是單純 threshold entropy，而是建立 measurement/query action 的 Q approximation，並在 latent outcome belief 的 samples / weights 上積分未觀測 state 的 value。

底層形式應接近：

```text
Measurement Value
=
E_{o ~ P(o|belief,measure)}
[
  max_a Q(belief', a)
]
-
max_a Q(belief,a)
-
measurement_cost
-
delayed_effect_cost
```

所以 Hermes 不應只做：

```text
if entropy > 0.5:
    probe()
```

而是：

```text
Measure only when
expected downstream decision improvement
>
cost + delay + side-effect risk
```

例如：

```text
Belief:
REQUEST_APPLIED 0.48
NOT_APPLIED     0.52
```

如果下一步是 irreversible payment retry：

```text
verify transaction id
```

價值極高。

但如果下一步只是讀取 weather：

```text
額外 health probe
```

可能完全不值得。

---

### 5. Hermes 應從「Belief State Engine」升級成「Decision-Sufficient State Compiler」

本輪把四種 state representation 統一起來：

```text
Raw History
h_t
│
├─ Bayesian Belief State
│  P(hidden world | history)
│
├─ Predictive State
│  P(future tests | history)
│
├─ Compressed State
│  low-dimensional summary
│
└─ Task / Risk Features
   effects, authority, resource state
```

再編譯成：

```text
DecisionSufficientState D_t
```

定義不是「能重建所有 history」，而是：

```text
D_t 足以近似保持
├ next-action ranking
├ safety constraints
├ effect/retry decision
├ measurement value
├ future predictive tests
└ recovery policy
```

這與 Nayebi 2026 的 selection-theorem 方向一致：對足夠廣的 predictive decision tasks，低 regret 會迫使 agent 保存能區分未來結果的內部結構。

Hermes 因此不應把「Memory」「World Model」「Belief」「Context」視為四個散落模組，而應把它們編譯成決策所需的最小資訊狀態。

---

## Architecture Breakdown

### Decision-Sufficient Predictive Belief Runtime

```text
User / Environment Event
↓
Observation Encoder
├ text
├ image
├ audio
├ tool return
├ MCP resource
├ runtime telemetry
└ external effect observation
↓
History / Provenance Ledger
↓
Belief Filter
├ HMM / HSMM
├ particle filter
├ switching state-space model
└ Bayesian hypothesis set
↓
Predictive State Engine
├ define predictive tests
├ estimate p(test | history)
├ action-conditioned futures
└ intervention-conditioned futures
↓
Identifiability Auditor
├ observational equivalence
├ state partition
├ alias score
├ process-noise score
└ unresolved uncertainty
↓
Belief / Predictive Compressor
↓
Decision Sufficiency Validator
├ action consistency
├ risk consistency
├ effect consistency
├ measurement-value consistency
└ future-test consistency
↓
Decision-Sufficient State
↓
Planner
├ ACT
├ MEASURE
├ BRANCH
├ VERIFY
├ WAIT
├ ROLLBACK
└ REPLAN
↓
Tool / MCP / Model / World
↓
New Observation
↺
```

---

## Bottom-Level Logic

### A. Predictive State Update

選一組 core tests：

```text
Q = {T1,T2,...,Tk}
```

internal predictive state：

```text
q_t(i)=P(T_i succeeds | h_t)
```

新 action-observation `(a,o)` 到來後：

```text
q_{t+1}
=
Update(q_t, a, o)
```

對 linear PSR 可寫成 operator update 的形式；Hermes 初期不必先完整實作 spectral PSR，可以先做 learned predictive probes：

```text
Test: retry_same_operation → duplicate effect?
Test: wait_30s → quota recovers?
Test: switch_region → latency normalizes?
Test: requery_resource → value changes?
```

這些 test probability 本身就具有高度 Agent-runtime 語義。

### B. State-Aliasing Attribution

對同一 observation class `z`：

```text
collect compatible microstates/history groups
↓
apply controlled interventions
↓
repeat future disturbance / matched environment
↓
variance decomposition
```

Hermes 可先用 practical proxy：

```text
Total Future Variance
≈
Between-Belief-Cluster Variance
+
Within-Cluster Repeat Variance
+
Interaction
```

若 between-cluster 高：

```text
state aliasing likely
→ sensing valuable
```

若 within-cluster repeated randomness 高：

```text
process stochasticity likely
→ branching / robust planning valuable
```

### C. Decision-Sufficiency Test

對 candidate compressed state `z=C(b,q,h)`：

```text
For counterfactual probe set A:

compare
π_full(h)
vs
π_compressed(z)

compare
risk_full(h,a)
vs
risk_compressed(z,a)

compare
P(test|h)
vs
P(test|z)
```

只有在 critical decisions 上差異低於 threshold 才能簽發：

```text
DecisionSufficiencyCertificate
```

---

## Visual Simulation Idea

# Predictive Belief & State Identifiability Lab

### 模式 1：Belief vs Predictive State

左邊：

```text
Hidden-State Belief

PROVIDER_DEGRADED   42%
RATE_LIMITED        31%
NETWORK_TRANSIENT   17%
UNKNOWN             10%
```

右邊：

```text
Predictive Tests

retry now → success       28%
wait 30s → success        81%
switch region → success   73%
query quota → high        86%
```

讓使用者看到：

```text
「我認為世界是什麼」
vs
「不同 action 下未來會發生什麼」
```

### 模式 2：Uncertainty Attribution

畫面：

```text
Future uncertainty 100%

State Aliasing      ███████████ 57%
Process Noise       ██████      31%
Interaction         ██          12%
```

按：

```text
[MEASURE]
```

模擬 observation resolution 後：

```text
Aliasing uncertainty 57% → 14%
```

按：

```text
[BRANCH 32 FUTURES]
```

只降低 process-noise planning uncertainty。

### 模式 3：Belief Compression Viewer

```text
Full belief       4096 dimensions
↓ PCA/VAE/learned compressor
Compressed state    32 dimensions
```

同時顯示：

```text
Reconstruction error       0.07
Future-test error          0.03
Action disagreement        0.00
Risk disagreement          0.00
Measurement-value error    0.02
```

如果 reconstruction 很好但 action disagreement 很高：

```text
⚠ NOT DECISION SUFFICIENT
```

---

## Code / GitHub

### 1. JuliaPOMDP/CompressedBeliefMDPs.jl

Repository: https://github.com/JuliaPOMDP/CompressedBeliefMDPs.jl

值得繼續讀：

```text
src/cbmdp.jl
src/solver.jl
src/compressors/
docs/src/compressors.md
scripts/kl.jl
scripts/l2.jl
scripts/recon.jl
```

實際 architecture：

```text
Sampler
↓
Belief Samples
↓
Compressor.fit!
↓
CompressedBeliefMDP
↓
Local / Base Solver
↓
CompressedBeliefPolicy
```

`cbmdp.jl` 的 `encode/decode/gen` 是最值得 Hermes 借鏡的 abstraction boundary；`solver.jl` 則顯示 compressed belief state 如何無縫接回標準 planning API。

### 2. StatisticalReinforcementLearningLab/Active-Measuring

Repository: https://github.com/StatisticalReinforcementLearningLab/Active-Measuring

值得繼續讀：

```text
src/predictor.py
src/rlsvi_control.py
src/rlsvi_query.py
src/bam_qmdp_agent.py
experiments/exp_active.py
robustness/predictor_correct.py
```

`predictor.py`：Gaussian posterior parameter inference。  
`rlsvi_query.py`：measurement/query policy 的 value approximation，並在 latent outcome belief samples 上積分未觀測 state 的 downstream value。

這比單純 entropy-based sensing 更接近 Hermes 需要的：

```text
Value-of-Measurement
```

---

## Papers

### Paper A
- **Title:** Toward Learning POMDPs Beyond Full-Rank Actions and State Observability
- **Authors:** Seiji Shaw, Travis Manderson, Chad Kessens, Nicholas Roy
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2601.18930
- **Code:** 本輪未確認官方 code release
- **Dataset:** numerical POMDP experiments（非大型 benchmark dataset）
- **Architecture:** PSR + tensor decomposition + state partition recovery
- **Contribution:** 在較弱可觀測 / rank 條件下恢復 explicit observation/transition likelihood 到可識別 partition
- **Limitations:** 某些 latent states 從 sequential data 本質上不可區分；只能恢復到 observational equivalence partition
- **證據層級:** arXiv preprint

### Paper B
- **Title:** What Capable Agents Must Know: Selection Theorems for Robust Decision-Making under Uncertainty
- **Author:** Aran Nayebi
- **Institution:** Carnegie Mellon University
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2603.02491
- **Code:** 未確認
- **Dataset:** 理論工作，非 dataset-driven
- **Architecture:** structured predictive betting tasks → regret bounds → predictive state / belief-like memory necessity
- **Contribution:** 從「belief state 足夠」推進到「特定能力要求會迫使 predictive internal state 出現」
- **Limitations:** necessity 取決於 task family / margins / assumptions；不能直接推出任何現有 LLM 已具有 calibrated belief state
- **證據層級:** arXiv theoretical preprint

### Paper C
- **Title:** Why Does the Future Branch? Identifiable Closure Tests for Stochastic Physical World Models
- **Author:** Yibin Dong
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2608.00591
- **Code:** 本輪未確認公開 code
- **Dataset:** synthetic Gaussian systems, nonlinear Langevin conditions, pixel-conditioned recurrent experiments
- **Architecture:** ClosurePairs + paired microstate/disturbance protocol + variance decomposition
- **Contribution:** 讓 state aliasing vs process noise 的來源 attribution 從 observationally non-identifiable 變成可由 paired intervention 測量
- **Limitations:** 需要 compatible paired microstates / disturbance reuse 或 independent-repeat approximation；production SaaS 未必能取得這種控制權
- **證據層級:** 最新 arXiv preprint

### Paper D
- **Title:** CompressedBeliefMDPs.jl: A Julia Package for Solving Large POMDPs with Belief Compression
- **Authors:** Logan Mondal Bhamidipaty, Mykel J. Kochenderfer
- **Year:** 2025
- **URL:** https://joss.theoj.org/papers/10.21105/joss.07346
- **Code:** https://github.com/JuliaPOMDP/CompressedBeliefMDPs.jl
- **Architecture:** sampler → compressor → compressed belief MDP → planner
- **Contribution:** 工程化 belief compression framework，支援 PCA/VAE 等壓縮方法與 POMDPs.jl planning ecosystem
- **Limitations:** compression quality 本身不保證 decision sufficiency；Hermes 必須另外驗證 action/risk/probe preservation
- **證據層級:** peer-reviewed JOSS + source code

### Paper E
- **Title:** Active Measuring in Reinforcement Learning With Delayed Negative Effects
- **Authors:** Daiqi Gao, Ziping Xu, Aseel Rawashdeh, Predrag Klasnja, Susan A. Murphy
- **Year:** 2026
- **URL:** https://proceedings.mlr.press/v300/gao26d.html
- **Code:** https://github.com/StatisticalReinforcementLearningLab/Active-Measuring
- **Architecture:** AOMDP + Bayesian belief + SMC posterior + control/query policies
- **Contribution:** 把 sensing/measurement 正式納入 policy，並考慮 measurement 的 delayed negative effect
- **Limitations:** domain/model assumptions 明確；不能直接把醫療 intervention setup 原封不動搬進 generic Agent runtime
- **證據層級:** AISTATS 2026 + code

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
Predictive State Representation
Predictive Test
Core Test
Test Probability
Outcome-Predictive State Representation
Belief Compression
Compressed Belief State
Decision-Sufficient State
Decision-Sufficiency Loss
Decision-Sufficiency Certificate
Latent-State Identifiability
Observational Equivalence Class
State Partition
State Aliasing Attribution
Process Noise Attribution
Uncertainty Attribution
Closure Pair
Interventional Identifiability Test
Measurement Action
Value of Measurement
Measurement Side Effect
Predictive-Belief Fusion
State Representation Compiler
```

### Positive edges

```text
History
→ Predictive State

History
→ Belief State

Belief State
→ Compression
→ Decision-Sufficient State

Predictive Test
→ Future Observable Consequence

Active Measurement
→ Reduced State Aliasing

Closure Pair
→ Alias/Noise Attribution

Decision-Sufficient State
→ Planner

Predictive State
→ Transferable Skill Interface
```

### Critical negative edges

```text
Latent State Label ≠ Identifiable World State
Predictive Accuracy ≠ State Identifiability
Calibration ≠ Uncertainty Attribution
Low NLL ≠ Correct State Representation
Belief Reconstruction ≠ Decision Sufficiency
Compression ≠ Information Preservation
Same Observation ≠ Same Hidden State
High Entropy ≠ Measurement Automatically Valuable
Measurement ≠ Free Observation
Predictive State ≠ Explicit Causal World Model
PSR Sufficiency ≠ Reward Sufficiency For Every Task
```

---

## Unknown / Open Questions

### 1. 如何自動選 Core Predictive Tests？

若 Hermes 有 500 個 tools / resources / actions，所有 action-observation sequence 組合爆炸。

需要：

```text
Candidate tests
↓
Task relevance
↓
Safety relevance
↓
Mutual information / rank contribution
↓
Minimal core test basis
```

### 2. 如何證明 compressed state 對「新任務」仍 decision-sufficient？

今天壓縮保留：

```text
payment safety
```

未必保留明天新增的：

```text
privacy policy decision
```

所以 certificate 必須綁：

```text
Task Family / Risk Family
```

而不能宣稱 globally sufficient。

### 3. 如何在無法控制 exogenous disturbance 的 SaaS/MCP 世界做 ClosurePairs-like test？

可能需要：

```text
matched replay
shadow environment
paired accounts
synthetic twins
natural experiments
instrumental variables
```

這會是下一輪最值得研究的實務缺口。

---

## 下一輪研究

# Core Predictive Test Discovery × Hankel Rank × Predictive-State Learning × Decision-Sufficiency Certification × Counterfactual Probe Selection

下一輪應拆：

```text
Runtime Histories
↓
Candidate Future Tests
↓
Hankel / Predictive Matrix
↓
Rank / Basis Discovery
↓
Core Test Set
↓
Predictive State
↓
Task / Safety Probes
↓
Decision-Sufficiency Certification
↓
Active Counterfactual Probe
```

優先研究：

- PSR / TPSR / spectral learning 的 Hankel matrix 與 observable operator construction
- core tests 如何選、rank 如何估
- reward-predictive / task-predictive representation
- predictive state 與 neural world model latent state 的可對齊性
- compression 後 action/risk invariance 的 formal / empirical certification
- synthetic twin / paired replay 如何近似 ClosurePairs

---

## 本輪結束回答

**缺哪一層？**  
`Core Predictive Test Discovery + Decision-Sufficiency Certification`。

**哪個節點最淺？**  
`DecisionSufficiencyCertificate`：目前有清楚的工程定義，但還沒有 Hermes 專屬 formal metric / threshold / benchmark。

**哪個概念仍只是名詞？**  
`PredictiveBeliefFusion ABI`、`StateRepresentationCompiler`、`InterventionalIdentifiabilityCertificate`、`TaskScopedDecisionSufficiency`。

**哪個系統最值得讀原始碼？**  
第一優先 `JuliaPOMDP/CompressedBeliefMDPs.jl` 的 `src/cbmdp.jl`、`src/solver.jl`、`src/compressors/`；第二優先 `StatisticalReinforcementLearningLab/Active-Measuring` 的 `src/predictor.py`、`src/rlsvi_query.py`、`src/bam_qmdp_agent.py`。

**哪篇論文需追引用？**  
`Toward Learning POMDPs Beyond Full-Rank Actions and State Observability` → PSR identifiability / spectral POMDP learning；`Why Does the Future Branch?` → world-model uncertainty attribution / active sensing；`What Capable Agents Must Know` → predictive-state necessity。

**哪個概念最適合視覺模擬？**  
`Predictive Belief & State Identifiability Lab`：同畫面呈現 hidden-state belief、predictive tests、alias/noise uncertainty attribution、compression distortion 與 measurement value。

**哪個 Agent 架構最值得實作？**  

> **Decision-Sufficient Predictive Belief Runtime = Belief Filter + Predictive Test Engine + Identifiability Auditor + Belief/Predictive Compressor + Decision-Sufficiency Validator + Active Measurement Planner + Belief-Conditioned Agent Planner。**

---

## 對最終「AI 到底怎麼運作」知識圖譜的新增鏈

```text
User / Sensor Input
→ Observation Tokens
→ Context / Provenance
→ History
→ Belief over Hidden Worlds
→ Predictive Tests over Future Observables
→ Identifiability / Aliasing Check
→ Decision-Sufficient Compression
→ Reasoning / Planning
→ ACT or MEASURE or BRANCH
→ Tool / MCP / Model / GPU / World
→ New Observation
→ Belief + Predictive-State Update
→ Output
```

多模態同理：

```text
Camera / Image / Voice / Video
→ Encoder / Tokens
→ Multimodal Observation
→ Hidden-World Belief
→ Action-Conditioned Predictive State
→ Active Sensing / Camera Move / Tool Query
→ Fusion Update
→ Decision-Sufficient State
→ Agent Action
```

本輪最大的底層推進是：**成熟 Agent 的 internal state 不應被定義成「某個 latent vector」或「某個隱藏 state label」，而應被驗證為：在當前 task / risk domain 下，能保留未來可觀測結果、重要 hidden-world uncertainty、action ranking、安全限制與 measurement value 的 Decision-Sufficient State。**
