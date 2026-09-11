# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 22:50（Asia/Taipei）**  
**本輪主題：Gradual Drift × Mixture-of-Regimes × Canary Rollout × Traffic Splitting × Regime-Scoped Certification**

## 與歷史研究比較

上一輪已建立：Streaming Behavioral Telemetry → Bayesian Change-Point Detection → Behavioral Regime → Causal Drift Attribution → Recertification。上一輪主要假設「某一時間點前屬於 regime A，之後屬於 regime B」。本輪專門補上真實 production 中更常見的情境：A 與 B 在一段時間內同時存在，而且同一個 tool/model endpoint 可能依 traffic split、feature flag、user cohort、region、sticky routing、router policy 被分配到不同 regime。

因此本輪不重複單一 change-point detection，而是處理：

```text
Single Regime(t)
    ↓
Mixture of Regimes(t)
    ↓
Traffic Assignment / Cohort / Route
    ↓
Per-Regime Evidence
    ↓
Regime-Scoped Certificate
```

---

## 本小時新發現

### 新論文 / 架構

1. **ICAN-Deploy: Identity-Stable Canary Deployment for Safety-Critical Embodied Agents**（2026）
   - Authors: Xue Qin, Simin Luan, John See, Zeyd Boukhers, Cong Yang, Zhijun Li
   - Institution: 本輪搜尋結果未可靠暴露完整 affiliation，暫不猜測；需下一輪直接讀 arXiv PDF metadata/author affiliations。
   - URL: https://arxiv.org/abs/2605.28097
   - Code: 搜尋頁未找到公開 code repository，標記 `NOT VERIFIED`。
   - Dataset / environment: Franka Panda in MuJoCo；100 次真實 canary cycles（依作者摘要）。
   - Architecture: frozen capability-name identity + mutable capability-version runtime state；canary state machine 維持 identity hash invariant。
   - Contribution: 把「部署版本變化」與「被認證 agent identity」分離，指出安全關鍵 embodied agent 的 canary rollout 不能只沿用一般 stateless service 的 version identity 模型。
   - Limitation: 本輪可驗證資訊集中於摘要；對大規模 heterogeneous traffic、LLM prompt/model routing mixture 的一般化仍需進一步驗證。

2. **Gradual Drift Detection in Process Models Using Conformance Metrics**（ACM TKDD, 2025）
   - Authors: Víctor Gallego-Fontenla, Pedro Gamallo-Fernandez, Juan C. Vidal, Manuel Lama
   - Institution: 與 CITIUS / Universidade de Santiago de Compostela 研究環境高度相關，但本輪頁面未完整顯示 author affiliation，標記 `PARTIALLY VERIFIED`。
   - URL: https://doi.org/10.1145/3716169
   - Dataset: 120 synthetic event logs + real logs。
   - Architecture: sliding windows → process model discovery → fitness/precision conformance metrics → regression/statistical tests → sudden/gradual classification。
   - Contribution: 將 gradual drift 明確定義為 old/new behavior 在一段時間內重疊共存，而非單一 change point。
   - Limitation: offline；固定 trace-count window 對 arrival-rate shift 敏感；極慢 drift / long tails 檢測較弱；同時重疊多個 change 的情境仍困難。

3. **A Predictive View on Streaming Hidden Markov Models**（2026）
   - Author: Gerardo Duran-Martin
   - Institution: 本輪 arXiv 搜尋結果未可靠暴露 affiliation，標記 `NOT VERIFIED`。
   - URL: https://arxiv.org/abs/2604.09208
   - Architecture: regime-specific predictive models + fixed transition prior + top-S posterior path mixture / beam-style truncation。
   - Contribution: 不要求完整 posterior path recovery，而是以受限 hypothesis budget 保留最重要的 regime path mixture，適合 Hermes 的 online mixture-regime inference。
   - Limitation: 它解的是 streaming HMM predictive inference，不直接等於 tool causal mechanism certification。

### 新 GitHub / 工程實作

**mizcausevic-dev/agent-canary**

值得看的核心目錄與檔案：

```text
src/agent_canary/
├ canary.py
├ decision.py
├ metrics.py
├ rollout.py
└ shadow.py

examples/progressive_rollout.py

tests/
├ test_canary.py
├ test_decision.py
├ test_metrics.py
├ test_rollout.py
└ test_shadow.py
```

實作層觀察：
- `decision.py` 使用 sticky key + hash bucket，避免同一 user/session 在 stable/canary 間 flapping。
- `rollout.py` 將流量階段建模成 `1% → 5% → 25% → 50% → 100%`，promotion 依 min duration、min samples、success threshold、可選 p95 latency。
- `canary.py` 同時維護 stable/canary metrics，並以 canary 相對 stable 的 success-rate degradation 做 rollback gate。
- 目前此 repo 的判斷核心仍偏 service-style KPI；沒有 causal attribution、task-conditioned quality、tool-effect contract、per-cohort semantic safety、regime posterior。

---

## 本小時最重要 5 個發現

### 1. Gradual Drift ≠ Slow Single-Regime Transition

最重要的底層修正：

```text
錯誤模型：
A ─────── slowly morphs ───────→ B

更常見 production 模型：
P(A|t) = 0.99, P(B|t) = 0.01
↓
P(A|t) = 0.75, P(B|t) = 0.25
↓
P(A|t) = 0.50, P(B|t) = 0.50
↓
P(A|t) = 0.00, P(B|t) = 1.00
```

在 gradual canary rollout 中，不是「一個 mechanism 慢慢改變」，而可能是**兩個相對穩定 mechanism 的 mixture weight 在改變**。

因此只看 aggregate telemetry：

```text
success_rate(t)
latency(t)
error_rate(t)
```

可能誤把 mixture-weight shift 判定為 mechanism drift。

應拆成：

```text
Observation_t
← Σ_k w_k(t) · P(Y | X, Regime=k)
```

其中 `w_k(t)` 可能由 rollout controller、feature flag、sticky bucket、region、account cohort 或 router policy 控制。

**為什麼重要：** 如果不知道 traffic assignment，Hermes 可能重新認證一個其實完全沒改變的 stable tool，只因為 canary 比例從 5% 升到 50%。

**限制：** 當 regime identity 不可觀測時，需要 HMM/mixture inference，存在 label switching 與 identifiability 問題。

---

### 2. Aggregate KPI ≠ Per-Regime Safety

Argo Rollouts / Flagger 的成熟 progressive-delivery 核心是：控制 traffic weight、跑 analysis、依 success/latency/custom metrics 做 promote/rollback。

這對一般服務非常重要，但 Agent 需要多一層：

```text
HTTP 200
≠
Task Correct
≠
Tool Safe
≠
Policy Aligned
≠
Causal Contract Preserved
```

Hermes 應把 rollout evidence 拆成：

```text
Per-Regime Metrics
├ task success
├ semantic quality
├ hallucination / unsupported claim
├ tool-call distribution
├ argument drift
├ read-set drift
├ write-set drift
├ side-effect violations
├ provenance breaks
└ safety-policy violations
```

也就是 rollout gate 從：

```text
success_rate > 0.99
```

提升成：

```text
P(candidate worse than stable on critical metric | evidence) < ε
AND
No critical effect-contract violation
AND
No unauthorized new capability
```

---

### 3. Traffic Assignment 本身是因果變數，不是部署細節

Canary routing 不能只記「20% 去 canary」。

真正需要紀錄：

```text
AssignmentEvent
├ request_id
├ user/session/cohort
├ stable_or_canary
├ assignment_probability
├ router_policy_version
├ sticky_key_hash
├ region
├ experiment_id
└ timestamp
```

原因：如果 premium users 更常進 canary、某 region 流量偏新版本、或 sticky routing 導致 cohort composition 不同，直接比較 stable vs canary outcome 會有 selection bias。

所以：

```text
Observed Canary Degradation
≠
Version Causal Effect
```

需要估：

```text
ATE / CATE / paired shadow difference
```

或至少做 stratification / propensity-aware comparison。

**工程推論：** 對 Agent rollout，traffic router 應成為 provenance graph 的一等節點。

---

### 4. Sticky Routing 解決 flapping，但會引入 persistent cohort bias

`agent-canary` 的 `CanaryRouter` 用 sticky key hash bucket，這是合理工程設計：同一 user/session 不會來回切 stable/canary。

但這會帶來新的統計問題：

```text
Sticky Assignment
→ stable cohort / canary cohort 長時間固定
→ user population 差異可能累積
→ naive KPI comparison 有偏
```

因此 Hermes 的 rollout analyser 必須同時保留：

```text
Routing Stability
+
Cohort Balance
```

並加：

```text
CovariateBalanceScore
Overlap / Positivity Check
Per-Cohort Treatment Effect
```

這是前幾輪「Hidden Confounder」研究和本輪 canary routing 的直接接點。

---

### 5. Certificate 應綁定 Regime × Traffic Policy × Cohort Scope

上一輪只有：

```text
BehaviorCertificate(tool, regime)
```

本輪要升級：

```text
RegimeScopedBehaviorCertificate
├ tool_identity
├ capability_version
├ regime_id
├ traffic_policy_id
├ cohort_scope
├ assignment_mechanism
├ exposure_range
├ read_set
├ write_set
├ effect_contract
├ semantic_metrics
├ causal_comparison
├ evidence_window
├ confidence
└ invalidation_conditions
```

因為：

```text
Candidate works at 1% random traffic
≠
Candidate works at 100% traffic
```

可能有 load-dependent behavior、rate limiting、cache effects、tool contention、multi-agent shared state race、user-cohort distribution shift。

因此 rollout promotion 本質上不是單純「提高百分比」，而是逐步擴張 certificate 的 validity domain。

---

## Architecture Breakdown

### Mixture-Regime Progressive Certification Runtime

```text
Incoming Request
↓
Traffic / Experiment Router
├ stable
├ canary-v1
├ canary-v2
└ shadow
↓
Assignment Provenance
↓
Agent Runtime
├ Context
├ Planner
├ Memory
├ Tools / MCP
└ Model
↓
Outcome + Effect + Trace
↓
Per-Regime Telemetry
↓
Mixture / Regime Inference
├ known assignment → supervised regime
└ unknown assignment → HMM / mixture posterior
↓
Causal Comparator
├ stable vs canary
├ cohort adjustment
├ paired shadow comparison
└ critical effect-contract comparison
↓
Rollout Gate
├ promote
├ hold
├ rollback
├ quarantine
└ request targeted probe
↓
Regime-Scoped Certificate Registry
↓
Next Traffic Weight
↺
```

### Known-assignment path

```text
request
↓
router chooses candidate B with p=0.05
↓
record assignment metadata
↓
execute B
↓
collect outcome
↓
compare B against A under matched/cohort-adjusted evidence
```

### Unknown-assignment / latent-regime path

```text
stream y_1:t
↓
Regime hypotheses {S1,S2,...}
↓
transition model
↓
emission / predictive likelihood
↓
filter posterior
↓
P(S_t=k | y_1:t)
↓
beam / top-S regime paths
↓
per-regime contract inference
```

---

## Bottom-Level Logic

### 1. Mixture observation model

```text
P(y_t | x_t)
=
Σ_k w_k(t, cohort, route)
  P(y_t | x_t, z_t=k)
```

其中：
- `z_t`：實際 behavior regime。
- `w_k`：routing / rollout / latent mixture weight。
- `P(y|x,z)`：regime-specific behavior。

### 2. 推廣判斷不能直接比較 aggregate mean

錯誤：

```text
mean(candidate) < mean(stable)
→ rollback
```

更合理：

```text
for critical cohort c:
    estimate Δ_c = Outcome(candidate,c) - Outcome(stable,c)

if P(Δ_c < -margin) > threshold:
    rollback
```

### 3. Mixture weight change 與 mechanism change 分開

```text
if P(Y|X,Z=k) stable
but P(Z=k) changes:
    MIXTURE SHIFT

if P(Y|X,Z=k) itself changes:
    MECHANISM DRIFT
```

這是本輪最關鍵的識別式。

### 4. Canary promotion = validity-domain expansion

```text
C_1%   valid on exposure domain D1
↓
C_5%   validate additional load/cohort region D2
↓
C_25%
↓
C_50%
↓
C_100%
```

每一步都不是重新從零驗證，而應更新：

```text
Certificate_{n+1}
=
Certificate_n
+ New Exposure Evidence
+ New Cohort Coverage
+ New Load Regime
```

---

## Visual Simulation Idea

# Mixture-of-Regimes & Canary Causal Observatory

### 模式 A：Traffic Mixture Timeline

```text
Time ─────────────────────────→

Stable A  ████████████████ 90%
Canary B  ██               10%

↓

Stable A  ████████         50%
Canary B  ████████         50%

↓

Stable A                   0%
Canary B  ████████████████ 100%
```

UI 同時顯示：

```text
Aggregate success: 96%

Stable regime: 99%
Canary regime: 93%
```

使用者可切換：

```text
[ Aggregate View ]
[ Per-Regime View ]
[ Per-Cohort View ]
```

### 模式 B：Mixture Shift vs Mechanism Drift

Scenario 1:

```text
A behavior unchanged
B behavior unchanged
B traffic 5% → 50%

Classification:
MIXTURE-WEIGHT SHIFT
```

Scenario 2:

```text
B traffic fixed at 10%
B tool arguments suddenly change

Classification:
WITHIN-REGIME MECHANISM DRIFT
```

### 模式 C：Canary Certificate Expansion

```text
Certificate B@1%
✓ low load
✓ cohort: students
? enterprise
? high concurrency

PROMOTE 5%
```

到 50% 時：

```text
✓ students
✓ enterprise
✓ mobile
⚠ high concurrency: write-conflict +12%

Decision:
HOLD / TARGETED PROBE
```

### 模式 D：Routing Bias Viewer

```text
CANARY COHORT
Premium users   61%
Mobile          78%
Region TW       85%

STABLE COHORT
Premium users   22%
Mobile          42%
Region TW       31%

⚠ Naive comparison invalid
```

按下：

```text
ADJUST FOR COHORT
```

顯示 adjusted treatment estimate。

---

## Code / GitHub

### mizcausevic-dev/agent-canary

**核心檔案：**

1. `src/agent_canary/decision.py`
   - sticky-key deterministic routing
   - hash bucket → stable/canary decision
   - 值得 Hermes 借：assignment stability
   - Hermes 需補：assignment provenance、cohort metadata、propensity/weight

2. `src/agent_canary/rollout.py`
   - staged traffic schedule
   - min duration / min samples / success / p95 gate
   - 值得 Hermes 借：明確 rollout state machine
   - Hermes 需補：semantic metrics、effect contract metrics、causal comparison、Bayesian sequential gate

3. `src/agent_canary/canary.py`
   - stable/canary metric registry
   - rollback / promote / hold
   - stage promotion 後 reset canary metric window
   - 風險：stage reset 若沒有 durable cross-stage evidence ledger，會失去 longitudinal causal evidence

4. `src/agent_canary/shadow.py`
   - 下一輪值得深讀；shadow traffic 是 Agent candidate certification 的低 blast-radius 機制。

### Argo Rollouts / Flagger

官方工程模式值得當 Hermes production adapter：
- percentage traffic shifting
- header / cohort routing
- traffic mirroring
- experiments baseline vs canary
- analysis gates
- rollback / promotion

但 Hermes 不應把它們的 service KPI model 直接當 Agent safety model；應將 Argo/Flagger 當 **delivery control plane**，Hermes 提供 **semantic / causal certification plane**。

---

## Papers

### Paper A — ICAN-Deploy
- Title: ICAN-Deploy: Identity-Stable Canary Deployment for Safety-Critical Embodied Agents
- Authors: Xue Qin, Simin Luan, John See, Zeyd Boukhers, Cong Yang, Zhijun Li
- Institution: NOT VERIFIED this round
- Year: 2026
- URL: https://arxiv.org/abs/2605.28097
- Code: NOT VERIFIED
- Dataset/Environment: MuJoCo, Franka Panda, 100 canary cycles per abstract
- Architecture: stable cryptographic identity over mutable capability versions
- Contribution: makes deployment/canary evolution compatible with a certification identity boundary
- Limitation: embodied-agent governance setting; generalisation to generic SaaS/MCP agent runtime needs validation
- Changed what: rollout is no longer only operational deployment; it becomes part of agent identity/certification semantics

### Paper B — Gradual Drift Detection in Process Models Using Conformance Metrics
- Authors: Víctor Gallego-Fontenla, Pedro Gamallo-Fernandez, Juan C. Vidal, Manuel Lama
- Institution: PARTIALLY VERIFIED; CITIUS/USC context, affiliation needs PDF-level verification
- Year: 2025
- URL: https://doi.org/10.1145/3716169
- Code/Data: synthetic logs linked from CITIUS GitLab in article
- Dataset: 120 synthetic event logs + real process logs
- Architecture: sliding-window process mining → conformance fitness/precision → statistical drift detection
- Contribution: formalises gradual drift as coexistence of old/new behavior over an interval
- Limitation: offline, fixed-count windows, overlapping multiple drifts and slow tails remain difficult
- Changed what: gives Hermes a useful conceptual distinction between abrupt regime replacement and interval coexistence

### Paper C — A Predictive View on Streaming Hidden Markov Models
- Author: Gerardo Duran-Martin
- Institution: NOT VERIFIED this round
- Year: 2026
- URL: https://arxiv.org/abs/2604.09208
- Code/Dataset: not verified this round
- Architecture: online regime-specific predictive models + top-S posterior path truncation
- Contribution: fixed compute budget for latent regime filtering
- Limitation: predictive-regime inference, not causal contract recovery
- Changed what: suggests Hermes can bound online mixture inference cost without enumerating all regime histories

---

## Unknown / Open Questions 1–3

### 1. Hidden routing variable
如果 Hermes 看不到 feature flag、router decision 或 backend version header，如何區分：

```text
latent regime mixture
vs
within-regime stochasticity
```

需要研究 identifiable mixture conditions、paired shadow execution、instrumental routing variables。

### 2. Sequential statistical validity
每 1% → 5% → 25% 重複查看指標並 promotion，若使用普通固定樣本 hypothesis test，會產生 repeated peeking / optional stopping 問題。

需要接：
- sequential probability ratio tests
- always-valid p-values / e-values
- Bayesian decision rules
- CUPED / variance reduction
- bandit-safe inference

### 3. Interaction / load effects
Candidate 可能在 1% traffic 沒問題，但在 50% 出現：
- shared-memory contention
- DB write conflict
- rate-limit
- queue saturation
- multi-agent race
- tool quota exhaustion

所以「版本 effect」可能是 exposure-dependent：

```text
Effect = f(version, load, cohort, concurrency, external state)
```

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
Gradual Drift
Mixture of Regimes
Regime Weight
Traffic Assignment
Canary Cohort
Stable Cohort
Sticky Routing
Assignment Provenance
Assignment Probability
Traffic Policy
Rollout Stage
Shadow Execution
Champion-Challenger
Mixture Shift
Mechanism Shift
Cohort Shift
Selection Bias
Treatment Effect
Conditional Treatment Effect
Cohort Balance
Positivity / Overlap
Exposure Domain
Exposure-Dependent Effect
Regime-Scoped Certificate
Certificate Domain Expansion
Progressive Certification
```

### Edges

```text
TrafficPolicy --SETS_WEIGHT→ Regime
Router --ASSIGNS→ Request
Assignment --SELECTS→ ToolVersion
Assignment --HAS_PROBABILITY→ AssignmentProbability
Request --EXECUTES_UNDER→ Regime
Regime --HAS_CERTIFICATE→ RegimeScopedCertificate
RolloutStage --EXPANDS→ ExposureDomain
TrafficAssignment --CAUSES_SELECTION→ CohortComposition
MixtureWeight --CHANGES→ AggregateTelemetry
MechanismShift --CHANGES→ ConditionalBehavior
ShadowExecution --ENABLES→ PairedComparison
```

### 新增否定關係

```text
Gradual Drift ≠ Slow Single Mechanism Morphing
Aggregate Drift ≠ Within-Regime Mechanism Drift
Traffic Weight ≠ Randomization Guarantee
Sticky Routing ≠ Cohort Balance
Canary Worse Observationally ≠ Candidate Causally Worse
HTTP Success ≠ Agent Semantic Success
Schema Stable ≠ Candidate Behavior Stable
1% Safe ≠ 100% Safe
Deployment Version ≠ Agent Identity
Promotion ≠ Certification Complete
```

---

## 下一輪研究

# Sequential Experimentation × Always-Valid Inference × Shadow Paired Evaluation × Exposure-Dependent Effects

下一輪應直接解：

```text
Stable / Canary
↓
Repeated Streaming Evaluation
↓
Optional Stopping Problem
↓
Sequential Statistical Test
↓
Per-Cohort / Per-Task Effect
↓
Shadow Paired Difference
↓
Exposure / Load Interaction
↓
Promote / Hold / Rollback
↓
Statistically Valid Rollout Certificate
```

優先研究：
- sequential probability ratio test
- e-values / always-valid inference
- Bayesian sequential decision
- CUPED / variance reduction
- paired shadow evaluation
- heterogeneous treatment effect
- interference / SUTVA violations（Agent shared memory、multi-agent shared resource 特別重要）

---

## 本輪結束判斷

**缺哪一層：** Sequential-Causal Rollout Inference Plane。  
**哪個節點最淺：** AssignmentMechanism / ExposureDependentEffect。  
**哪個概念仍只是名詞：** `RolloutCertificate`、`RegimeMixtureCertificate`、`ExposureDomainCertificate`。  
**哪個系統值得讀原始碼：** `agent-canary` 的 `shadow.py`、Argo Rollouts experiment/analysis controller、Flagger analysis loop。  
**哪篇論文需追引用：** ICAN-Deploy → safety-critical progressive deployment；Gradual Drift Detection → overlapping regimes；Streaming HMM → bounded online regime inference。  
**哪個概念最適合視覺模擬：** Mixture-of-Regimes & Canary Causal Observatory。  
**哪個 Agent 架構最值得實作：**

> **Progressively Certified Agent Runtime = Assignment Provenance + Sticky/Controlled Routing + Per-Regime Telemetry + Latent Mixture Inference + Cohort-Aware Causal Comparator + Semantic/Effect Safety Metrics + Shadow Paired Evaluation + Regime-Scoped Certificates + Progressive Traffic Gate + Automatic Rollback.**

---

## 本輪核心結論

成熟 Agent runtime 不應把 canary rollout 視為外部 DevOps 細節。對 AI Agent 而言，rollout 本身就是一個動態因果實驗：不同版本、不同 cohort、不同流量比例、不同 load 共同決定觀察到的 behavior。

因此 Hermes 必須能回答：

```text
「現在看到的性能/安全變化，
到底是版本本身變了，
還是只是更多流量被導向另一個既有 regime？」
```

下一階段要讓 promotion / rollback 不再只是 KPI threshold，而是具有 sequential statistical validity、cohort-aware causal evidence、semantic safety 與 effect-contract proof 的 **progressive certification decision**。
