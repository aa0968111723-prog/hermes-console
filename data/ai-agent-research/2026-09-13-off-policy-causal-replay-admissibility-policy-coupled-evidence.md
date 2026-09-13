# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 10:52（Asia/Taipei）**  
**本輪主題：Off-Policy / Causal Replay Admissibility × Policy-Coupled Evidence × Support / Positivity × Active Non-Stationarity × Counterfactual Replay Boundary**

---

## 本小時新發現

本輪延續上一輪 `Legitimate Retroactive Wealth Update × Counterfactual Multiplicity Replay × Replay Validity Certificate`，集中處理上一輪最重要但仍未完成的問題：

> 當 corrected policy 與 historical policy 不同時，歷史 evidence 到底哪些可以直接重用、哪些只能 importance reweight、哪些只能經模型推估、哪些根本不能合法重建？

本輪最重要的修正是：

```text
Same Historical Observation
≠
Valid Counterfactual Observation
```

更精確地說，一筆歷史資料 `o_t, a_t, r_t` 是由歷史 policy 與環境共同產生。當 corrected policy 改變先前 action 時，後續 observation distribution 也可能改變；若環境還具有 active non-stationarity，過去 action 甚至可能改變更長期的 environment regime。此時「把歷史 observation 原封不動餵回 corrected policy」不是 off-policy evaluation，而是在偷渡不存在的 counterfactual trajectory。

本輪因此建立一個新核心元件：

```text
Replay Admissibility Gateway
```

它在 Counterfactual Multiplicity Replay 前先判斷 evidence 的可重用層級：

```text
EXACT_REPLAYABLE
ON_POLICY_CONTINUATION
OFF_POLICY_REWEIGHTABLE
MODEL_ASSISTED_ONLY
CAUSAL_MODEL_REQUIRED
NON_IDENTIFIABLE
EXTERNAL_IRREVERSIBLE
```

這使 Hermes 從「能重播 event log」進一步變成「知道哪些歷史 evidence 在 corrected world 裡具有統計/因果資格」。

### 與歷史研究比較

前一輪已建立：

```text
historical rejection
→ alpha / wealth path changes
→ planner action changes
→ future evidence changes
```

以及 `ReplayValidityCertificate`。

本輪補上當時缺少的第二層：

```text
procedure replay validity
≠
evidence replay admissibility
```

即使 LORD / SAFFRON / e-process 的程式重播完全 deterministic，如果輸入 replay engine 的 observation 本身是在不同 policy 下產生、且 corrected policy 會改變後續 state，則重播結果仍可能沒有 counterfactual 意義。

---

# 本小時最重要 5 個發現

## 1. Off-policy replay 的底層不是「重用資料」，而是 likelihood-ratio change of measure

### 是什麼

標準 off-policy evaluation 的核心不是假裝 trajectory 是由 target policy 產生，而是利用 behavior policy `μ` 下收集的 trajectory，經 likelihood ratio 重新加權來估計 target policy `π` 下的期望。

對 trajectory `τ=(s_0,a_0,r_0,...,s_T)`，典型 trajectory importance weight 為：

```text
w(τ)
=
Π_t π(a_t | h_t) / μ(a_t | h_t)
```

其中 `h_t` 是當時 policy 可用的 history / state information。

SCOPE-RL 的 `estimators_base.py` 原始碼實際把 behavior policy 的 step-wise propensity 以 cumulative product 累積，evaluation policy 也針對歷史實際 action 取 `π(a_t|s_t)` 再 cumulative product；也就是程式層真的在構造 trajectory / step-wise likelihood ratios，而不是把 log 直接視為 target-policy trajectory。

核心檔案：

```text
scope_rl/ope/estimators_base.py
scope_rl/ope/discrete/basic_estimators.py
scope_rl/ope/discrete/marginal_estimators.py
scope_rl/ope/weight_value_learning/
```

Repository: https://github.com/hakuhodo-technologies/scope-rl

### 底層如何運作

```text
Historical trajectory τ ~ P_μ
↓
retrieve logged behavior propensity μ(a_t|h_t)
↓
compute target propensity π(a_t|h_t)
↓
ratio ρ_t = π/μ
↓
trajectory ratio Πρ_t
或 per-decision ratio Π_{k≤t}ρ_k
↓
weighted reward / DR correction
↓
estimate E_π[R]
```

### 為什麼重要

Hermes 必須區分：

```text
Counterfactual expectation estimation
≠
Literal counterfactual trajectory reconstruction
```

Importance sampling 可以在條件成立時估計 target policy 的 expected return，但它沒有告訴你：

```text
「如果當時採用 corrected action，
使用者下一句話一定會是什麼？」
```

### 限制

trajectory product 很容易造成高 variance；horizon 越長、policy 差異越大，weight degeneracy 越嚴重。SCOPE-RL 因此同時提供 PDIS、self-normalized、DR、marginal importance sampling、DICE 類 weight/value learning，而不是只依賴 trajectory-wise IS。

### 來源

- SCOPE-RL: https://github.com/hakuhodo-technologies/scope-rl
- SCOPE-RL docs: https://scope-rl.readthedocs.io/

---

## 2. Support / Positivity 是「歷史 evidence 能否支撐 corrected policy」的第一道硬門

### 是什麼

如果 target policy 在某 history 下可能選 action `a`，但 behavior policy 對該 action 的概率為 0，則：

```text
π(a|h) > 0
μ(a|h) = 0
```

importance ratio 無法定義；歷史資料沒有提供該 action 的 factual support。

`Off-Policy Evaluation for Action-Dependent Non-Stationary Environments` 明確採用標準 support assumption：target policy 可能採取的 action 必須在每個 data-collection policy 下具有足夠概率，並要求 `π/β_i` 有界。

### 底層如何運作

Hermes 可在 replay 前建立：

```text
ReplaySupportContract
├ target_policy_id
├ behavior_policy_id
├ state_or_history_signature
├ logged_propensity
├ target_propensity
├ importance_ratio
├ max_ratio
├ effective_sample_size
├ support_status
└ extrapolation_status
```

判斷：

```text
μ > 0 and ratio controlled
→ OFF_POLICY_REWEIGHTABLE

μ very small
→ WEAK_SUPPORT / HIGH_VARIANCE

μ = 0 and model available
→ MODEL_ASSISTED_ONLY

μ = 0 and no identifying model
→ NON_IDENTIFIABLE
```

### 為什麼重要

這直接修正 Agent replay 常見的錯誤直覺：

```text
Log 裡有相似 state
≠
Log 支援 corrected action
```

2026 的 `Logging Policy Design for Off-Policy Evaluation` 也把 logging policy 的 coverage 視為 OPE error 的核心來源，指出 concentrating probability on high-reward actions 與保留 target-action coverage 之間存在根本 tradeoff。

### 限制

「有 support」只是最低必要條件，不代表 variance 小、沒有 hidden confounding、environment stationary，或 target-policy future state distribution 已被歷史 log 覆蓋。

### 來源

- Logging Policy Design for Off-Policy Evaluation, Connor Douglas, Joel Persson, Foster Provost, 2026: https://arxiv.org/abs/2605.15108
- OPEN / action-dependent non-stationarity: https://arxiv.org/abs/2301.10330

---

## 3. Adaptive policy deployment 要保存 round-specific behavior policy，而不是只有一個 `policy_version`

### 是什麼

AISTATS 2026 的 **Sequential Off-Policy Learning with Logarithmic Smoothing** 研究反覆 update / redeploy policy 的情況：每一輪新 policy 收集新 interactions，下一輪又使用所有過去資料學習。這比傳統「單一固定 behavior policy 產生整包 batch」更接近 Hermes 的長期 Agent runtime。

論文：

**Title:** Sequential Off-Policy Learning with Logarithmic Smoothing  
**Authors:** Maxime Haddouche, Otmane Sakhi  
**Venue:** AISTATS 2026, PMLR 300:1846-1854  
**Year:** 2026  
**URL:** https://proceedings.mlr.press/v300/haddouche26a.html  
**Code:** 本輪未在官方頁面確認獨立 code repository  
**Architecture:** repeated deployment rounds → logged interactions from multiple behavior policies → LS estimator → online PAC-Bayes adjustment → updated policy  
**Contribution:** 把 OPL 從 single logging policy batch 擴展到 sequentially redeployed policies，並對多輪 adaptive data collection 提供 principled adjustment。  
**Limitations:** 其問題設定仍是 off-policy learning 的統計框架，不等同於 agent semantic rollback；不會自動解決 tool side-effect、memory mutation 或 active non-stationary user behavior。

### Hermes 的新資料結構

```text
BehaviorPolicyTrace
├ event_id
├ deployment_round
├ policy_semantic_hash
├ model_hash
├ prompt_hash
├ tool_registry_hash
├ memory_snapshot_hash
├ available_context_hash
├ action_distribution
├ selected_action
└ propensity
```

只記：

```text
agent_version = v13
```

不夠，因為 propensity 取決於當時真正可見的 context、tool set、memory、router 與 policy stochasticity。

### 核心否定關係

```text
Same Model Version
≠ Same Behavior Policy
```

```text
Same Agent Name
≠ Same Action Propensity
```

---

## 4. Active non-stationarity 使「重用未來 observation」比一般 OPE 更危險

### 是什麼

OPEN 論文明確區分：

```text
Passive non-stationarity
→ environment 因外部因素變化

Active non-stationarity
→ environment 的未來變化受到 Agent 過去 action 影響

Hybrid
→ 兩者都有
```

這對 Hermes 非常關鍵。

例如：

```text
H7 certificate
↓
MCP_WRITE
↓
使用者看到新資料
↓
使用者下一輪輸入改變
↓
Memory 被寫入不同內容
↓
Browser query 改變
```

若 corrected replay 判斷 H7 不應允許 `MCP_WRITE`，那麼 historical H8/H9 的 user/tool observations 就是由另一條 action-history 產生。

### 底層如何運作

OPEN 把未來 environment regime 看成可被過去 interaction history 影響的 transition：

```text
M_i
+
H_i(action/reward/observation history)
↓
M_{i+1}
```

因此 corrected replay 要問的不是只有：

```text
Can I reuse reward_t?
```

而是：

```text
Did corrected action history alter
P(M_{i+1}, O_{i+1}, User_{i+1}) ?
```

### 新 Hermes 分類

```text
EvidencePolicyCoupling
├ EXOGENOUS
├ ACTION_LOCAL
├ TRAJECTORY_COUPLED
├ ENVIRONMENT_COUPLED
├ HUMAN_RESPONSE_COUPLED
└ UNKNOWN
```

其中：

```text
EXOGENOUS
→ 通常較可安全重用

ACTION_LOCAL
→ 可考慮 per-decision OPE / DR

TRAJECTORY_COUPLED
→ 需 trajectory OPE / model

ENVIRONMENT_COUPLED
→ 需 non-stationary / causal dynamics model

HUMAN_RESPONSE_COUPLED
→ literal replay 通常不成立
```

### 為什麼重要

這使 Hermes 能正式標記：

```text
Historical user response
≠ Counterfactual user response
```

以及：

```text
Historical tool output after side effect
≠ Corrected-policy tool output
```

### 來源

Yash Chandak et al., **Off-Policy Evaluation for Action-Dependent Non-Stationary Environments**, 2023: https://arxiv.org/abs/2301.10330

---

## 5. Counterfactual annotations / simulations 不能被當作 factual data 等權輸入 replay

### 是什麼

CHIL 2026 的 **CANDOR: Counterfactual ANnotated DOubly Robust Off-Policy Evaluation** 處理一個對 Agent replay 很相似的問題：資料 coverage 不足時，可以加入專家提供的 counterfactual annotation，但 annotation 可能錯，甚至使 estimator 比完全不用 annotation 更差。

**Title:** CANDOR: Counterfactual ANnotated DOubly Robust Off-Policy Evaluation  
**Authors:** Aishwarya Mandyam, Shengpu Tang, Jiayu Yao, Jenna Wiens, Barbara E. Engelhardt  
**Venue:** Conference on Health, Inference, and Learning 2026, PMLR 333  
**Year:** 2026  
**URL:** https://proceedings.mlr.press/v333/mandyam26a.html  
**Code:** 官方 PMLR 頁面本輪未列獨立 repository  
**Dataset:** multiple healthcare tasks，包含 real-world EHR data  
**Architecture:** factual logged contextual-bandit data + imperfect counterfactual annotations → DR estimator family → annotations injected into different estimator components  
**Contribution:** 在 mild assumptions 下，將 annotations 只放入 Direct Method component 具有較佳 theoretical properties；實驗上對 reward model misspecification 與 annotation error 較 robust。  
**Limitations:** contextual bandit / healthcare OPE；不能直接等同長 horizon Agent causal replay。

### 對 Hermes 的意義

LLM simulator、world model、human guess、counterfactual tool emulator 都不應寫成：

```text
observation.source = factual
```

而應：

```text
CounterfactualEvidence
├ source_type
│  ├ HUMAN_ANNOTATION
│  ├ WORLD_MODEL
│  ├ TOOL_EMULATOR
│  ├ SCM_SIMULATION
│  └ LLM_SIMULATION
├ factual_support
├ model_version
├ calibration_status
├ uncertainty
├ injection_role
└ provenance
```

CANDOR 特別提醒一件事：

```text
More counterfactual samples
≠ Better OPE automatically
```

錯誤 synthetic counterfactuals 可能增加 bias。

---

# Architecture Breakdown

本輪建議 Hermes 新增：

# **Policy-Coupled Causal Replay Runtime**

```text
Append-Only Agent Event Ledger
↓
Correction / Invalidation Event
↓
Historical Policy Trace Resolver
↓
Corrected Policy Constructor
↓
Replay Admissibility Gateway
├ Semantic equivalence check
├ Support / positivity check
├ Behavior propensity reconstruction
├ Target propensity computation
├ Hidden-confounding check
├ Policy-coupling classifier
├ Non-stationarity classifier
└ Irreversible-side-effect classifier
↓
Evidence Partition
├ EXACT_REPLAYABLE
├ OFF_POLICY_REWEIGHTABLE
├ MODEL_ASSISTED_ONLY
├ CAUSAL_MODEL_REQUIRED
├ NON_IDENTIFIABLE
└ IRREVERSIBLE
↓
Counterfactual Reconstruction
├ deterministic event replay
├ IS / PDIS / DR
├ marginal OPE
├ world-model simulation
├ SCM counterfactual
└ abstain
↓
Multiplicity / Certificate Replay
↓
Historical-vs-Corrected Decision Diff
↓
Forward-Safe Epoch
↓
Planner
```

### 關鍵：兩個 Replay Engine 必須拆開

```text
Event Replay Engine
→ 重建「歷史系統做過什麼」

Counterfactual Policy Replay Engine
→ 推估「corrected policy 可能會怎樣」
```

兩者不能再共用 `replay()` 一個函數語意。

---

# Bottom-Level Logic

## 1. Step-wise importance ratio

```text
ρ_t
=
π_c(a_t | h_t)
/
μ_h(a_t | h_t)
```

其中：

- `π_c`：corrected / evaluation policy
- `μ_h`：historical behavior policy
- `h_t`：歷史當時真正可見的 information set

## 2. Per-decision cumulative ratio

```text
W_t = Π_{k=0}^t ρ_k
```

可用於 PDIS 類估計：

```text
V̂_PDIS
=
Σ_t γ^t W_t r_t
```

核心直覺：只讓 reward `r_t` 承擔到 `t` 為止的 policy mismatch，而不是整條 trajectory 的完整 ratio。

## 3. Support gate

```text
π_c(a|h) > 0
and
μ_h(a|h) = 0
↓
NO SUPPORT
↓
importance weighting prohibited
```

## 4. Effective support / weight degeneracy

即使 `μ>0`：

```text
ρ_t >> 1
↓
trajectory product explodes
↓
ESS collapses
↓
replay estimate unreliable
```

Hermes 應輸出：

```text
ReplayWeightDiagnostics
├ max_weight
├ mean_weight
├ effective_sample_size
├ clipped_weight_fraction
├ support_violations
└ horizon_weight_decay
```

## 5. Policy-coupled observation boundary

設：

```text
O_{t+1} = f(S_t, A_t, U_{t+1})
```

如果 corrected action：

```text
A_t^c ≠ A_t^h
```

則一般不能假設：

```text
O_{t+1}(A_t^c)
=
O_{t+1}(A_t^h)
```

除非：

- observation 對 action exogenous；或
- 已知 structural model 並能使用同一 exogenous noise / valid abduction-action-prediction；或
- 只在估計期望值，不是在重建單一 factual-like path。

因此新的核心否定關係：

```text
Off-Policy Estimable
≠ Pathwise Counterfactual Recoverable
```

---

# Visual Simulation Idea

# **Causal Replay Boundary × Off-Policy Support Explorer**

Hermes Console 可做三層互動視覺化。

## A. Historical vs Corrected Timeline

```text
Historical
H6 ─ ASK ─ UserReplyA ─ H7 ─ WRITE ─ ToolObsB ─ H8

Corrected
H6 ─ ASK ─ UserReplyA ─ H7 ─ BLOCK ─ ???????? ─ H8'
```

`????????` 區段以紅色表示：

```text
COUNTERFACTUAL OBSERVATION UNKNOWN
```

不是把 `ToolObsB` 複製過去。

## B. Replay admissibility heatmap

```text
Evidence/Event        Support  Coupling      Reuse
---------------------------------------------------------
Clock timestamp       n/a      exogenous     EXACT
Public web fact       high     low           REQUERY/EXACT
LLM token output      policy   high          MODEL ONLY
User reply            weak     human         CAUSAL MODEL
Tool read result      high     action-local  OPE/REQUERY
MCP write result      path     environment   NO LITERAL REPLAY
Sensor frame          path     embodied      MODEL REQUIRED
```

## C. Importance weight waterfall

```text
step      μ(a|h)   π(a|h)   ρ
1         .40      .45      1.13
2         .30      .55      1.83
3         .08      .60      7.50
4         .02      .70     35.00  ← support warning

trajectory weight = 542.8
ESS ↓↓↓
```

使用者可以直接看到：

> 為什麼某條歷史 trajectory 雖然 technically 有 support，實際上仍幾乎不能可靠地代表 corrected policy。

---

# Code / GitHub

## 1. SCOPE-RL

Repository: https://github.com/hakuhodo-technologies/scope-rl

本輪不是只讀 README，而是追入：

```text
scope_rl/ope/
├ estimators_base.py
├ input.py
├ online.py
├ ope.py
├ ops.py
├ discrete/
│  ├ basic_estimators.py
│  ├ cumulative_distribution_estimators.py
│  └ marginal_estimators.py
└ weight_value_learning/
```

值得 Hermes 優先讀的核心：

### `scope_rl/ope/estimators_base.py`

實際負責：

```text
behavior pscore reshape
↓
cumulative product
↓
trajectory-wise / step-wise propensity

historical selected action
+
evaluation policy action distribution
↓
π(a_t|s_t)
↓
cumulative product
```

### `scope_rl/ope/discrete/basic_estimators.py`

值得追：

```text
DirectMethod
TrajectoryWiseImportanceSampling
PerDecisionImportanceSampling
DoublyRobust
SelfNormalized...
```

### `scope_rl/ope/discrete/marginal_estimators.py`

值得追：state / state-action marginal ratios，因為它可降低完整 trajectory-product 所造成的 horizon variance 問題。

### `scope_rl/ope/weight_value_learning/`

值得追：DICE / minimax weight/value learning 類方法，適合 Hermes 後續研究「無法可靠取得完整 behavior propensity 時，能否直接學 density ratio / value」。

## 2. Open Bandit Pipeline

Repository: https://github.com/st-tech/zr-obp

價值：

- real-world logged bandit dataset
- 真實 propensity scores
- 多 behavior policy data
- OPE estimator benchmark

對 Hermes 的用途：建立 `Replay Admissibility Benchmark` 的 contextual-bandit 最小實驗場。

---

# Papers

## Paper A — Sequential Off-Policy Learning with Logarithmic Smoothing

- **Title:** Sequential Off-Policy Learning with Logarithmic Smoothing
- **Authors:** Maxime Haddouche, Otmane Sakhi
- **Institution:** 官方 PMLR 頁面未在摘要頁列 affiliation，本輪不推測
- **Year:** 2026
- **Venue:** AISTATS 2026, PMLR 300
- **URL:** https://proceedings.mlr.press/v300/haddouche26a.html
- **Code:** 未於官方摘要頁確認
- **Dataset:** 官方摘要頁未列明，本輪不補猜
- **Architecture:** sequential deployment → multi-round logged data → logarithmic smoothing → online PAC-Bayes → new policy
- **Contribution:** 正式處理多輪 adaptive policy redeployment 的 off-policy learning，而不是固定 logging policy 的單次 batch。
- **Limitations:** 不涵蓋 Agent tool side effects、semantic invalidation、counterfactual human response reconstruction。
- **改變了什麼:** 對 Hermes 的直接改變是 behavior policy 必須 round-specific/versioned，而且「歷史資料來自多個 policies」不該被壓成一個 static dataset。

## Paper B — Logging Policy Design for Off-Policy Evaluation

- **Authors:** Connor Douglas, Joel Persson, Foster Provost
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.15108
- **Architecture:** choose logging distribution to optimize downstream OPE accuracy under different information regimes
- **Contribution:** 明確化 reward exploitation vs target-policy coverage tradeoff。
- **Limitations:** OPE logging-design 問題，不處理長 horizon Agent environment mutation。
- **改變了什麼:** Hermes 應把「可修復性 / 未來 OPE coverage」納入 exploration/logging policy 設計，而不是只追求當下 reward。

## Paper C — CANDOR

- **Authors:** Aishwarya Mandyam, Shengpu Tang, Jiayu Yao, Jenna Wiens, Barbara E. Engelhardt
- **Year:** 2026
- **Venue:** CHIL 2026, PMLR 333
- **URL:** https://proceedings.mlr.press/v333/mandyam26a.html
- **Dataset:** healthcare tasks including real-world EHR
- **Architecture:** imperfect counterfactual annotations + DR OPE
- **Contribution:** counterfactual annotations 放進 DM component 較 robust；錯誤 annotations 可能降低 estimator quality。
- **Limitations:** contextual bandit，非完整 sequential Agent runtime。
- **改變了什麼:** Hermes 應把 simulated / annotated counterfactual evidence 與 factual log 分層，不能混成同等權重 observation。

## Paper D — Off-Policy Evaluation for Action-Dependent Non-Stationary Environments

- **Authors:** Yash Chandak, Shiv Shankar, Nathaniel D. Bastian, Bruno Castro da Silva, Emma Brunskill, Philip S. Thomas
- **Year:** 2023
- **URL:** https://arxiv.org/abs/2301.10330
- **Architecture:** sequence of POMDP regimes + action-dependent environment evolution → double counterfactual reasoning → importance-weighted IV regression → future policy performance
- **Contribution:** 明確處理 active / hybrid non-stationarity；過去 policy action 會影響未來 environment。
- **Limitations:** 需要 higher-order stationarity structure；若 environment changes arbitrary，future performance estimation 可能不可行。
- **改變了什麼:** Hermes 的 rollback/replay 不能只假設 environment 被動存在；Agent action 本身可能是 future evidence distribution 的原因。

---

# 已確認事實 / 工程實作 / 合理推論 / 尚未驗證假說

## 已確認事實（論文 / 官方原始碼）

1. OPE 的 importance weighting 需要 behavior propensity / target propensity 並依 support assumption 運作。
2. SCOPE-RL 原始碼實際使用 cumulative behavior/evaluation policy probabilities 建構 trajectory/step-wise propensity。
3. sequential OPL 已有 2026 AISTATS 正式研究，處理反覆 policy deployment 與歷史 data reuse。
4. active non-stationarity 下，過去 action 可影響未來 environment regime。
5. CANDOR 顯示 imperfect counterfactual annotations 若使用方式不當可使 OPE 更差。

## 工程實作建議

```text
ReplayAdmissibilityGateway
BehaviorPolicyTrace
ReplaySupportContract
EvidencePolicyCoupling
ReplayWeightDiagnostics
CounterfactualEvidence
```

是本輪針對 Hermes 提出的 runtime schema，尚不是現有標準。

## 合理推論

若 corrected Agent action 會改變 user/tool/world future state，則原 historical downstream observations 通常不能被 literal replay 為 corrected-world factual observations；最多只能依適用 assumptions 做 OPE / causal model / simulator-based estimate。

## 尚未驗證假說

1. 可以建立一個 production-grade automatic classifier，可靠判斷 event 是 `OFF_POLICY_REWEIGHTABLE` 還是 `CAUSAL_MODEL_REQUIRED`。
2. 能把 online multiplicity replay 與 DR/OPE estimator 直接組成單一具有完整 end-to-end statistical guarantee 的 certificate。
3. 對 LLM-agent human conversation，可以在不建立高成本 user SCM 的情況下得到 useful pathwise counterfactual replay guarantees。

---

# Unknown / Open Questions 1–3

## 1. Policy-coupled human observations 如何處理？

對 User reply：

```text
Historical action A
→ user response Y(A)
```

corrected action B 的：

```text
Y(B)
```

通常永遠沒有被觀察。

問題：Hermes 應只保留 set-valued counterfactual bounds，還是建立 user-response world model？如何避免 LLM simulator hallucination 反過來產生假 certainty？

## 2. OPE uncertainty 如何傳入 online multiplicity replay？

如果 H8 的 evidence 在 corrected world 下不是 scalar，而是：

```text
estimated e-value / test statistic
+
OPE uncertainty interval
```

那 LORD/SCORE/e-BH 類 downstream process 該如何保證 validity？需要 robust e-value envelope、partial identification，還是 worst-case thresholding？

## 3. Active non-stationarity 的 causal replay boundary 如何自動偵測？

Agent action 可能同時改變：

```text
user belief
memory
external DB
tool cache
search result ranking
other agents
physical environment
```

哪些 dependencies 能靠 provenance graph 判斷，哪些必須建 environment dynamics model？

---

# 下一輪研究

下一輪應從 `Off-Policy Replay Admissibility` 再往下進入：

# **Doubly Robust Replay × Partial Identification × Robust e-Value / Test Reconstruction**

重點研究：

```text
Historical downstream evidence
↓
Replay admissibility
↓
IS / PDIS / DR / marginalized OPE
↓
OPE uncertainty
↓
convert to conservative evidence object
↓
reconstruct corrected e/p evidence
↓
online multiplicity procedure
↓
robust historical-certificate diff
```

具體要回答：

1. DR estimator 如何在 behavior propensity 或 reward model 其中一邊錯時提供額外 robustness？
2. OPE confidence interval / confidence sequence 如何轉成不會誇大 evidence 的 sequential test input？
3. 若 support 只部分成立，可否把 `NON_IDENTIFIABLE` 改成 partial identified interval，再交給 minimax planner？
4. 能否建立 `Replay Evidence Lower Bound`：只允許 corrected replay 使用 worst-case-valid evidence，而不是 point estimate？

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Off-Policy Replay
Causal Replay Admissibility
Replay Admissibility Gateway
Behavior Policy Trace
Behavior Propensity
Target Policy Propensity
Trajectory Likelihood Ratio
Per-Decision Importance Ratio
Support Assumption
Positivity
Weak Support
Importance Weight Degeneracy
Effective Sample Size
Replay Support Contract
Policy-Coupled Evidence
Exogenous Evidence
Action-Local Evidence
Trajectory-Coupled Evidence
Environment-Coupled Evidence
Human-Response-Coupled Evidence
Active Non-Stationarity
Hybrid Non-Stationarity
Counterfactual Evidence Annotation
Model-Assisted Replay
Pathwise Counterfactual Recovery
Off-Policy Expected-Value Recovery
Causal Replay Boundary
Sequential Off-Policy Learning
Round-Specific Behavior Policy
Logging Policy Coverage
Replay Weight Diagnostics
```

## 新增 Edges

```text
Historical Trajectory
--generated_by--> Behavior Policy

Corrected Policy
--requires--> Replay Support Contract

Off-Policy Replay
--uses--> Importance Ratio

Importance Ratio
--requires--> Positivity

Weak Support
--causes--> Weight Degeneracy

Agent Action
--may_change--> Future Observation Distribution

Agent Action
--may_change--> Environment Regime

Active Non-Stationarity
--invalidates_naive--> Literal Historical Replay

Counterfactual Annotation
--supports--> Model-Assisted Replay

Behavior Policy Trace
--provides--> Logged Propensity
```

## 新增否定 / 區分 Edges

```text
Same Historical Observation
≠ Valid Counterfactual Observation

Off-Policy Estimable
≠ Pathwise Counterfactual Recoverable

Deterministic Event Replay
≠ Causal Policy Replay

Support Exists
≠ Reliable OPE

Same Model Version
≠ Same Behavior Policy

Same Agent Name
≠ Same Action Propensity

Historical User Response
≠ Counterfactual User Response

Historical Tool Output
≠ Corrected-Policy Tool Output

Counterfactual Annotation
≠ Factual Observation

More Synthetic Counterfactual Data
≠ Better Estimate Automatically
```

---

# 本輪結束判定

**缺哪一層：** 目前最缺的是 `OPE uncertainty → sequential evidence reconstruction`，也就是如何把 off-policy estimate 的不確定性安全傳入 e-process / online FDR / certificate replay。

**哪個節點最淺：** `PolicyCoupledEvidence classifier`、`HumanResponseCoupling`、`PathwiseCounterfactualRecoverability`。

**哪個概念仍只是名詞：** production 級 `Replay Admissibility Gateway` 的自動判定邏輯目前仍是工程設計，尚無單一現成 theorem 能完整覆蓋 Agent runtime。

**哪個系統值得讀原始碼：** `hakuhodo-technologies/scope-rl`，下一輪優先深入 `basic_estimators.py`、`marginal_estimators.py`、`weight_value_learning/` 與 high-confidence OPE。

**哪篇論文需追引用：** `Sequential Off-Policy Learning with Logarithmic Smoothing`（AISTATS 2026），因為它直接處理 repeated deployment + accumulated logged data，最接近長期 Agent policy versioning。

**哪個概念最適合視覺模擬：** `Causal Replay Boundary × Off-Policy Support Explorer`。

**哪個 Agent 架構最值得實作：**

```text
Policy-Coupled Causal Replay Agent
=
Append-Only Ledger
+
Behavior Policy Trace
+
Replay Admissibility Gateway
+
OPE / DR Engine
+
Causal / World-Model Fallback
+
Replay Validity Certificate
+
Forward-Safe Planner Gate
```

---

# 對「AI 到底怎麼運作」新增的一層

長期 Agent 的真實資料流不只是：

```text
User
→ Agent
→ Action
→ Observation
```

而是：

```text
User / Environment State
↓
Context + Memory + Tools + Policy Version
↓
Behavior Policy μ(a|h)
↓
Action
↓
Environment / User Transition
↓
Observation
↓
Memory / Evidence / Certificate
↓
Next Policy Decision
```

當歷史 certificate 被修正時，真正的 corrected world 是：

```text
Corrected Policy π
↓
Different Action Distribution
↓
Potentially Different Actions
↓
Potentially Different User / Tool / Environment State
↓
Different Future Evidence Distribution
```

因此成熟 AI 不能把 event sourcing 的「可重播」誤認成因果世界的「可重建」。Event log 可以精確重建歷史；off-policy statistics 可以在 support 與 assumptions 下估計 corrected policy 的期望；structural/world models 可以再多走一步推估 counterfactual states；但只有在非常強的識別條件下，才可能談 pathwise counterfactual recovery。

**這一輪把 Hermes 的 replay 問題正式從「軟體 rollback」推進成「policy-dependent data-generating process 的因果重建問題」。**
