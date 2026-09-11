# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-11 23:55（Asia/Taipei）  
**本輪主題**：Sequential Experimentation × Always-Valid Inference × E-Values × Shadow Paired Evaluation × Exposure-Dependent Effects × Network Interference  
**承接上一輪**：`2026-09-11-gradual-drift-mixture-regimes-canary-traffic-splitting.md`

---

## 0. 與歷史研究比較

上一輪已建立：

```text
Stable / Canary / Shadow
↓
Assignment Provenance
↓
Per-Regime Telemetry
↓
Cohort-Aware Causal Comparator
↓
PROMOTE / HOLD / ROLLBACK
```

但留下四個未解底層問題：

1. rollout 每個 stage 都重看 metrics，固定樣本 p-value 在 optional stopping / repeated peeking 下會失真；
2. Shadow evaluation 雖避免 side effects，但若不是「同一 production input 的 paired comparison」，variance 很高且容易被 cohort composition 汙染；
3. Agent shared memory、MCP state、database quota、multi-agent coordination 會讓一個 request 的 treatment 影響另一個 request，傳統 SUTVA/independence 假設可能失效；
4. 1% canary 與 100% rollout 不只是樣本量不同，而可能是不同 **exposure regime**，因 shared-resource contention、rate limit、cache、queue、memory 等出現 exposure-dependent behavior。

本輪因此不再研究「怎麼分流」，而是研究：

> **Hermes 如何在 rollout 過程中持續觀看資料、隨時停止，又不因 repeated peeking 產生假的安全結論；同時如何利用 shadow pairing 降低 variance，並在有 interference 時避免錯誤因果歸因。**

---

# 1. 本小時新發現

## 新論文 / 方法

### A. Anytime Validity Is Free: Inducing Sequential Tests
- Year: 2026
- Venue: Journal of the Royal Statistical Society Series B
- Published: 2026-02-21
- 核心：給定最大樣本數 N，可以把固定 horizon valid test 轉成 anytime-valid sequential test，並在 N 時匹配原測試；anytime validity 不必然意味著終點 power 損失。
- URL: https://doi.org/10.1093/jrsssb/qkag050

### B. SPRT-z: A Practical Approach for Online Experimentation
- Authors: Derek L. Ho, Emma G. Thomas
- Year: 2026
- arXiv: 2606.24871
- 核心：將 sequential probability ratio testing 做成適合大規模 online experimentation 的 z-statistic workflow，同時處理 efficacy、futility、maximum horizon 與 early-stopping estimation bias。
- URL: https://arxiv.org/abs/2606.24871

### C. E-valuator: Reliable Agent Verifiers with Sequential Hypothesis Testing
- Authors: Shuvom Sadhuka, Drew Prinster, Clara Fannjiang, Gabriele Scalia, Bonnie Berger, Aviv Regev, Hanchen Wang
- Year: 2025/2026 code release & current usage
- URL: https://arxiv.org/abs/2512.03109
- Code: https://github.com/shuvom-s/e-valuator
- 核心：把 black-box verifier score 轉成 sequential decision rule，在 trajectory 持續生成過程中控制 false alarms，允許提前終止高風險 / 高失敗機率 trajectories。

### D. AgentLens: Production-Assessed Trajectory Reviews for Coding Agent Evaluation
- Authors: Andrey Podivilov et al.
- Year: 2026
- arXiv: 2607.06624
- Code: https://github.com/agent-lens/agent-lens-bench
- 核心：同時使用 formal verification + trajectory-level LLM review + side-by-side comparison，比單一 pass/fail 更適合 agent version regression evaluation。

### E. Network interference / SUTVA violation
- 2026 research on local causal inference under network interference 與 misspecified interference networks 提醒：outcome 可能依賴「其他單位的 treatment / network exposure」，不能假設每個 request 完全獨立。
- 這對 shared-memory / shared-tool / multi-agent runtime 特別直接。

---

# 2. 本小時最重要 5 個發現

## 發現 1：Repeated Peeking ≠ Valid Evidence

### 已確認事實
固定 horizon test 假設你在預先指定的樣本數做一次 inference；如果每分鐘、每 stage 都重新看 p-value，並在「看起來夠好」時停止，nominal Type-I error 不再有原本意義。

Hermes 目前 rollout 若做：

```text
1%   → inspect
5%   → inspect
10%  → inspect
25%  → inspect
50%  → inspect
100% → inspect
```

不能把每一次都當成獨立固定樣本檢定。

### 底層機制

Sequential inference 應維護一個隨時間更新、對 stopping time 仍然有效的 evidence process：

```text
Observation y1
↓
Evidence E1
↓
Observation y2
↓
Evidence E2
↓
...
↓
Et
```

在 e-value / e-process 架構下，可把 evidence 想成對 null 的「資本增長」：

```text
E_t >= 0
E_null[E_t] <= 1
```

利用 Ville-type bounds，可在任意 stopping time 做 valid rejection，而不需要預先知道你第幾次看 dashboard。

### 為什麼重要
Agent rollout 幾乎天然是 sequential：traffic 不斷進來、metrics 不斷更新、風險出現就要 rollback。

因此：

```text
Continuous Monitoring
≠ Statistical Sin
```

前提是使用 **anytime-valid statistic**，不是 repeated fixed-horizon inference。

### 限制
Anytime-valid 不自動修復 selection bias、confounding、network interference、metric misspecification。

---

## 發現 2：Verifier Score ≠ Calibrated Stop Rule

E-valuator 的重要性在於，它不是假設 LLM judge 的 `0.82` 就代表「82% 成功率」。

它把歷史 trajectory verifier-score prefixes：

```text
s_1
s_1,s_2
s_1,s_2,s_3
...
```

分 step 建模，估計 successful / unsuccessful trajectory 下 score-prefix distribution 的 ratio，形成 sequential evidence。

實際原始碼 `src/evaluator/evaluator.py` 包含：

```text
EValuator
├ _fit_step_models()
├ _compute_e_vals_for_variant()
├ _upper_tolerance_bound()
└ PAC / Ville / RandVille variants
```

每個 step 可訓練 LogisticRegression 或 SVC，並用：

```text
Pr(score-prefix | Y=0)
-----------------------
Pr(score-prefix | Y=1)
```

類型的 density ratio 建立 evidence。

程式還明確處理：某 step 若 calibration 資料不足，就沿用 last ratio，而不是硬訓練不可靠模型。

### 對 Hermes 的直接設計
不要：

```text
judge_score < 0.4
→ ROLLBACK
```

應：

```text
Trajectory / Canary Metric Stream
↓
Verifier
↓
Calibrated Sequential Evidence
↓
False-Alarm Budget
↓
STOP / CONTINUE / PROMOTE / ROLLBACK
```

新增概念：

```text
SequentialVerifierCertificate
├ verifier_id
├ calibration_dataset
├ target_false_alarm_rate
├ evidence_method
├ score_feature_schema
├ horizon assumptions
└ validity_scope
```

### 限制
如果 deployment distribution 與 calibration distribution 大幅 drift，原 calibration guarantee 需要重新檢查。

---

## 發現 3：Shadow Evaluation 最強的地方不是「不影響使用者」，而是可以形成 Paired Counterfactual Approximation

普通 unpaired evaluation：

```text
Stable receives users A,B,C
Canary receives users X,Y,Z
```

結果差異可能同時包含：

```text
agent difference
+
user/task mix difference
+
context difference
+
time difference
```

Shadow duplication 則可以：

```text
Same production request x
        ├── Stable(x) → real path
        └── Canary(x) → shadow path, no effect
```

因此比較：

```text
Δ_i = Metric(Canary, x_i) - Metric(Stable, x_i)
```

同一 request 成為自己的 control，能顯著降低 task heterogeneity 造成的 variance。

AgentLens 的 side-by-side comparison 已採「相同 task instance 比兩個 agent trajectory」的思想；它還把 formal verifier 與 trajectory review 分開，這很適合 Hermes shadow pipeline。

### 但 Shadow 有硬限制

```text
Shadow Safe
≠ Canary Safe
```

因為 shadow suppresses effects，無法完整驗證：

```text
real write contention
rate limits
external settlement
MCP side effects
physical actions
real authorization edges
```

因此 Shadow 主要回答：

> 在同一 input 下，新 runtime / model / prompt / planner 的「決策、tool choice、arguments、predicted effects」跟 stable 有何差異？

真正 side-effect safety 還要接前幾輪的 Effect Contract / Transaction Runtime。

---

## 發現 4：Request Independence ≠ Production Agent Reality

傳統 A/B reasoning 常假設 SUTVA 類條件：一個 unit 的 outcome 不受另一個 unit treatment 影響。

Agent runtime 很容易違反：

```text
User A → Canary agent
          ↓
       writes shared memory
          ↓
User B → Stable agent reads same memory
```

或：

```text
Canary traffic ↑
↓
MCP quota saturation
↓
Stable latency ↑
```

此時 treatment spillover 出現：

```text
Y_i
=
f(T_i, T_neighbors, shared_state, load)
```

而不再是：

```text
Y_i = f(T_i)
```

2026 network-interference causal inference work正處理 outcome 依賴 network neighbors / exposure configuration 的問題；另一篇 2026 work也指出如果 interference network specification 錯誤，causal estimates 會有 bias。

### Hermes 必須新增 Exposure Graph

```text
Request
↓
Agent Instance
↓
Shared Resources
├ Memory Store
├ Vector DB
├ MCP Server
├ Queue
├ GPU Pool
├ Rate Limit Bucket
├ Cache
└ External Account
```

每個 observation 不只記：

```text
assigned_variant = canary
```

還要記：

```text
exposure_vector = {
  canary_fraction_on_shared_resource,
  concurrent_agent_count,
  queue_depth,
  shared_memory_version,
  model_pool_load,
  MCP_rate_limit_state
}
```

---

## 發現 5：Safe @ Low Exposure ≠ Safe @ High Exposure

上一輪已提出：

```text
1% Safe ≠ 100% Safe
```

本輪把它進一步 formalize 成 **Exposure-Dependent Effect**。

工具/Agent 行為可以寫成：

```text
Effect = f(Input, Version, Exposure)
```

而不是：

```text
Effect = f(Input, Version)
```

例如：

```text
Canary 1%
→ no queue contention
→ task success 99%

Canary 70%
→ shared queue saturates
→ timeout
→ retry
→ duplicated external effects
```

所以 rollout certificate 應包含：

```text
ExposureDomain
├ traffic_weight_range
├ concurrency_range
├ shared_resource_load_range
├ region
├ cohort
├ tool quota state
└ memory topology
```

Certificate validity 應變成：

```text
Valid(version, regime, exposure_domain)
```

而不是全域 bool。

---

# 3. Architecture Breakdown

## Sequential-Causal Rollout Inference Plane

```text
Incoming Production Request
↓
Assignment Router
├ Stable
├ Canary
└ Shadow Duplicate
↓
Assignment Provenance
↓
Exposure Recorder
├ cohort
├ traffic weight
├ shared resource IDs
├ concurrent load
└ network/interference neighborhood
↓
Agent Runtime
├ Context
├ Reasoning
├ Planning
├ Memory
├ Tool / MCP
└ Transaction Runtime
↓
Trajectory + Effects + Final State
↓
Evaluator Layer
├ Formal Verifier
├ State Verifier
├ Trajectory Judge
├ Tool/Effect Contract Checker
└ Safety/Policy Checker
↓
Paired Shadow Comparator
↓
Sequential Evidence Engine
├ e-process / e-value
├ confidence sequence
├ SPRT-like evidence
└ futility boundary
↓
Interference / Exposure Analyzer
↓
Rollout Decision Engine
├ CONTINUE
├ PROMOTE
├ HOLD
├ ROLLBACK
├ QUARANTINE
└ TARGETED PROBE
↓
Regime + Exposure Scoped Certificate
```

---

# 4. Bottom-Level Logic

## 4.1 Paired shadow evidence

對同一 production request `x_i`：

```text
S_i = score(stable(x_i))
C_i = score(canary_shadow(x_i))
D_i = C_i - S_i
```

相比 separate cohorts：

```text
mean(C) - mean(S)
```

paired `D_i` 能消掉大量 request/task baseline difficulty。

Hermes 應保存：

```text
PairRecord
├ request_id
├ stable_trace_id
├ shadow_trace_id
├ input_snapshot_hash
├ context_equivalence
├ stable_score
├ shadow_score
├ tool_call_diff
├ argument_diff
├ effect_prediction_diff
└ judge_evidence
```

## 4.2 Sequential update

每來一對 observation：

```text
D_t
↓
Evidence Update
↓
E_t
```

Decision 示意：

```text
if E_harm(t) >= 1/alpha_harm:
    ROLLBACK
elif E_benefit(t) >= 1/alpha_gain and safety_evidence_valid:
    PROMOTE_STAGE
else:
    CONTINUE
```

實作時不能只使用單一平均 quality metric；至少要把 safety-critical metrics 設為 separate guardrails。

## 4.3 Multi-metric alpha/evidence budget

Agent rollout 往往監控：

```text
Task Success
Hallucination
Policy Violation
Tool Misuse
Write-Set Drift
Latency
Cost
```

若每個 metric 都獨立不停檢查，需要控制 family-wise / multiple monitoring risk。

Hermes 應有：

```text
EvidenceBudget
├ global_budget
├ safety_budget
├ utility_budget
├ metric_allocations
└ adaptive_reallocation_policy
```

## 4.4 Interference-aware outcome

單位 outcome 改成：

```text
Y_i(T_i, G_i)
```

其中 `G_i` 為 exposure mapping：

```text
G_i = g(
  neighbors' treatment,
  shared queue load,
  shared memory writes,
  MCP quota,
  model pool load
)
```

這讓 Hermes 能比較：

```text
Direct Treatment Effect
vs
Spillover Effect
vs
Load/Exposure Effect
```

---

# 5. Visual Simulation Idea

# **Sequential Canary & Shadow Evidence Lab**

### Panel A — Live evidence trajectory

```text
Canary Weight   1% → 5% → 25%

E_harm
1 ────────╮
          ╰───╮
              ╰──────── 3.2

Rollback Threshold: 20
Status: CONTINUE
```

使用者拖動時間軸，看到：

```text
fixed-horizon p-value
vs
always-valid evidence
```

在 repeated peeking 下的差異。

### Panel B — Paired Shadow Viewer

```text
Request #A17

Stable                          Shadow Canary
────────                        ─────────────
search_web                      search_web
fetch_doc                       fetch_doc
summarize                       call_extra_tool ⚠
answer                          answer

Task score      0.87            0.91
Tool risk       LOW             MEDIUM
External effect REAL            SUPPRESSED
```

下面顯示：

```text
Paired Δ quality  +0.04
Paired Δ risk     +0.21
```

### Panel C — Interference Network

```text
          Shared MCP Server
          /      |       \
Stable A         Canary B        Stable C
   \               |              /
         Shared Memory
```

把 canary weight 從 5% 拉到 70%，即時模擬：

```text
queue depth ↑
MCP quota ↓
stable latency ↑
retry rate ↑
```

讓使用者看到：

> 「Canary 只改自己的 request」這個假設何時失效。

### Panel D — Exposure Certificate

```text
Agent Version: v31

Certified:
traffic        0–25%
concurrency    0–120
queue depth    0–40
MCP quota      >30%

Current:
traffic        50%     ✕
concurrency    181     ✕

STATUS:
OUTSIDE CERTIFIED EXPOSURE DOMAIN
```

---

# 6. Code / GitHub

## 6.1 shuvom-s/e-valuator

Repository:
https://github.com/shuvom-s/e-valuator

值得看的目錄：

```text
src/evaluator/
├ __init__.py
├ evaluator.py
└ utils.py

baselines/
data/
demos/
tests/
```

### 核心檔案：`src/evaluator/evaluator.py`

重要 class / function：

```text
EValuator
├ _new_model()
├ _upper_tolerance_bound()
├ _fit_step_models()
├ _compute_e_vals_for_variant()
└ _compute_pac_thresholds()
```

工程重要點：
- 每個 trajectory step 可有獨立 density-ratio model；
- 支援 logistic / SVM；
- PAC mode 將 calibration split 成 training / threshold calibration；
- Ville / randomized Ville 走 anytime threshold 路徑；
- step 資料不足時不硬 fit，保留上一步 evidence；
- 對 PAC threshold 使用 one-sided distribution-free tolerance bound。

### Hermes 借用方向
不是直接複製 package，而是抽象出：

```text
BlackBoxMetric
↓
SequentialEvidenceAdapter
↓
AnytimeDecisionGate
```

讓：
- LLM judge
- formal verifier
- state checker
- safety scorer
- effect-contract violation score

都能掛 sequential calibration。

---

## 6.2 agent-lens/agent-lens-bench

Repository:
https://github.com/agent-lens/agent-lens-bench

值得看的目錄：

```text
agent_lens/
├ agent_server/
└ eval/

idea-plugin/
leaderboard/
.github/workflows/
```

重要 entry points：

```text
agent_lens/eval/cli/run_agent_bench.py
agent_lens/eval/cli/compare_2_runs.py
agent_lens/eval/metrics/
agent_lens/eval/reporting/
```

它的價值不是 statistical sequential testing，而是提供：

```text
Formal verification
+
Trajectory review
+
Same-task side-by-side comparison
```

正好可當 Hermes shadow-paired evaluator 的 observation generator。

---

## 6.3 gostevehoward/confseq

Repository:
https://github.com/gostevehoward/confseq

用途：confidence sequences / uniform boundaries / always-valid p-values。

對 Hermes 的價值：rollout dashboard 不只顯示 point estimate，而可以顯示隨時間收縮、仍具 time-uniform validity 的 confidence sequence。

---

# 7. Papers

## Paper 1
**Title**：Always Valid Inference: Continuous Monitoring of A/B Tests  
**Authors**：Ramesh Johari, Pete Koomen, Leonid Pekelis, David Walsh  
**Institution / Context**：Stanford / industrial experimentation lineage  
**Year**：2021/2022 journal publication  
**URL**：https://doi.org/10.1287/opre.2021.2135  
**Code**：not central  
**Dataset**：large-scale experimentation context  
**Architecture**：always-valid p-values / confidence intervals / sequential hypothesis testing  
**Contribution**：使 continuous monitoring 與 data-dependent stopping 仍有 valid inference  
**Limitation**：不處理 agent-specific trajectory semantics、network interference、LLM judge calibration  
**改變了什麼**：把「peeking 一定破壞統計」改成「用正確 sequential object 可以合法持續監控」。

## Paper 2
**Title**：Anytime validity is free: inducing sequential tests  
**Year**：2026  
**URL**：https://doi.org/10.1093/jrsssb/qkag050  
**Contribution**：證明在固定最大 horizon 下，可以由 valid fixed-sample test 誘導 anytime-valid sequential test，並在 horizon 保有匹配性  
**Limitation**：仍需滿足相應統計模型；不能自動處理 interference / confounding  
**改變了什麼**：降低「anytime-valid 一定犧牲很多 power」的直覺障礙。

## Paper 3
**Title**：E-valuator: Reliable Agent Verifiers with Sequential Hypothesis Testing  
**Authors**：Shuvom Sadhuka et al.  
**Year**：2025/2026 active code  
**URL**：https://arxiv.org/abs/2512.03109  
**Code**：https://github.com/shuvom-s/e-valuator  
**Architecture**：black-box verifier score → prefix model → density ratio / e-value → sequential stop rule  
**Contribution**：把 sequential testing 真正接到 agent trajectories  
**Limitation**：calibration shift / verifier shift 仍是問題  
**改變了什麼**：證明 agent evaluation 不必等 trajectory 結束，也不必直接相信 raw judge score。

## Paper 4
**Title**：AgentLens: Production-Assessed Trajectory Reviews for Coding Agent Evaluation  
**Authors**：Andrey Podivilov et al.  
**Year**：2026  
**URL**：https://arxiv.org/abs/2607.06624  
**Code**：https://github.com/agent-lens/agent-lens-bench  
**Architecture**：trajectory collection → formal verification → LLM review → side-by-side comparison  
**Contribution**：評估整條 agent trajectory，不只 final pass/fail  
**Limitation**：side-by-side 本身不是 anytime-valid causal test  
**改變了什麼**：讓 paired shadow evaluation 可擁有更細的 behavioral observation。

## Paper 5
**Title**：The local approach to causal inference under network interference  
**Year**：2026  
**Venue**：Quantitative Economics  
**Contribution**：在 outcome 受 network-connected units treatments 影響時，以 local network configuration 建模 treatment response  
**Limitation**：production agent resource graph 與 social network 並不完全同構  
**改變了什麼**：提供 shared-resource / multi-agent spillover 的正式因果語言，而不是把所有 request 當 iid。

---

# 8. 已確認事實 / 工程實作 / 推論 / 未驗證假說

## 已確認事實
- repeated fixed-horizon inference under adaptive stopping 會失去原有 nominal validity；
- always-valid sequential inference 可在 stopping-time 下維持統計 validity；
- E-valuator 公開 code 確實實作 stepwise models、density ratio、PAC/Ville 類 sequential decision；
- AgentLens 公開 code/project structure 確實支援 formal verifier + trajectory judge + side-by-side comparison；
- network interference 是正式 causal inference 問題，不能假設所有 treatment units 獨立。

## 工程實作建議
- Hermes rollout gate 應由 fixed-threshold metrics 升級成 sequential evidence engine；
- shadow duplicated request 應保存 pair identity；
- shared memory / MCP / queue / GPU pool 應加入 exposure graph；
- certification 應綁 exposure domain。

## 合理推論
- Agent canary rollout 最適合使用「paired shadow evidence + live canary effect evidence」雙層架構；
- safety-critical metric 應用 stricter sequential budget，utility metric 可容忍更寬鬆 evidence；
- shared resource contention 可能是 1% → 100% 安全性無法外推的主要來源之一。

## 尚未驗證假說
1. E-value based agent rollout gate 在 highly autocorrelated production trajectories 上是否需要 block/cluster correction；
2. shared-memory Agent 的最佳 exposure mapping 應是 resource-level graph、session-level graph 還是 causal learned graph；
3. paired shadow 的 trajectory judge difference 是否能穩定作為 sequential test statistic。

---

# 9. Unknown / Open Questions 1–3

### Q1. Agent observations 真的接近 iid 嗎？
很可能不是。user/session repeated measures、shared MCP、shared memory、time-of-day、region 都會產生 cluster correlation。

### Q2. Shadow 與 real canary 的 gap 要怎麼估？
Shadow suppresses effects，因此需要：

```text
Shadow Prediction
↕
Live Canary Real Effect
```

建立 `Shadow→Live Calibration`。

### Q3. Interference network 不知道時怎麼辦？
需要從 telemetry / provenance graph 學 resource-sharing graph，再用 targeted perturbation 判斷真正 spillover edges。

---

# 10. 下一輪研究

下一個最重要缺口：

# **Clustered Sequential Inference × Autocorrelation × Shadow-to-Live Calibration × Interference Graph Discovery**

下一輪應拆：

```text
Production Telemetry
↓
Session / User / Resource Clustering
↓
Temporal Dependence Detection
↓
Cluster-Aware Sequential Evidence
↓
Shadow Prediction
↓
Small Live Canary
↓
Shadow→Live Effect Calibration
↓
Shared Resource Graph
↓
Spillover Detection
↓
Interference-Aware Rollout Certificate
```

研究優先序：
1. time-uniform confidence sequences under dependence / martingale assumptions；
2. cluster-randomized / switchback / network experiments；
3. interference graph learning；
4. shadow-to-live calibration；
5. exposure-dependent safety certificate。

---

# 11. Knowledge Graph 新增 Node / Edge

## Nodes

```text
Sequential Experimentation
Anytime-Valid Inference
E-Value
E-Process
Confidence Sequence
Optional Stopping
Repeated Peeking
Sequential Verifier
SequentialVerifierCertificate
False Alarm Budget
Evidence Budget
Paired Shadow Evaluation
Shadow Pair
PairRecord
Shadow-to-Live Gap
Exposure Mapping
Exposure Vector
Exposure Domain
Exposure-Dependent Effect
Network Interference
Spillover Effect
Shared Resource Graph
SUTVA Violation
Sequential Rollout Gate
Futility Boundary
Regression Evidence
```

## Edges

```text
VerifierScore --CALIBRATED_BY→ SequentialEvidenceAdapter
SequentialEvidence --GATES→ RolloutDecision
ShadowPair --REDUCES_VARIANCE_OF→ VersionComparison
SharedResource --INDUCES→ NetworkInterference
TrafficWeight --CHANGES→ ExposureVector
ExposureVector --MODULATES→ ToolBehavior
ExposureDomain --SCOPES→ BehaviorCertificate
CanaryRequest --MAY_SPILL_OVER_TO→ StableRequest
AssignmentProvenance --SUPPORTS→ CausalComparison
```

## 新增否定關係

```text
Repeated Peeking ≠ Valid Fixed-Horizon Inference
Raw Judge Score ≠ Calibrated Sequential Evidence
Shadow Safe ≠ Live Canary Safe
Same Input ≠ Same External Effect Environment
Request Assignment ≠ Isolated Treatment
Sticky Routing ≠ No Interference
Low-Traffic Safety ≠ High-Exposure Safety
HTTP Success ≠ Agent Task Success
Paired Comparison ≠ Causal Validity Under Spillover
Anytime Validity ≠ Immunity To Confounding
```

---

# 12. 本輪收斂回答

**缺哪一層？**  
缺 `Clustered / Dependent Sequential Inference + Shadow-to-Live Calibration + Interference Graph`。

**哪個節點最淺？**  
`ExposureMapping`。目前可先由 known shared resources 建圖，但真正 causal spillover edge 尚未驗證。

**哪個概念仍只是名詞？**  
`ExposureScopedRolloutCertificate`、`ShadowToLiveCalibrationCertificate`、`ClusterAwareEProcess`。

**哪個系統值得繼續讀原始碼？**  
`shuvom-s/e-valuator/src/evaluator/evaluator.py`，其次是 `agent-lens/agent-lens-bench/agent_lens/eval/` 與 `compare_2_runs.py`。

**哪篇論文需追引用？**  
`E-valuator` → e-process / conformal / verifier calibration；`Always Valid Inference` → confidence sequences / online experimentation；network interference → clustered/network experiments。

**哪個概念最適合視覺模擬？**  
`Sequential Canary & Shadow Evidence Lab`。

**哪個 Agent 架構最值得實作？**  

> **Sequential-Causal Rollout Agent Runtime = Assignment Provenance + Paired Shadow Execution + Formal/Trajectory Verifiers + Calibrated Sequential Evidence + Exposure Graph + Interference Monitor + Exposure-Scoped Certificates + Anytime Rollout Gate。**

---

# 13. 對「AI 到底怎麼運作」總圖的新增位置

```text
User
↓
UI
↓
Agent
↓
Context
↓
Reasoning / Planning
↓
Memory
↓
Tools / MCP
↓
Models / GPU
↓
External Effects
↓
Observation / Provenance
↓
Evaluator
↓
Shadow Pair / Canary Assignment
↓
Sequential Evidence
↓
Exposure / Interference Analysis
↓
Promotion / Hold / Rollback
↓
Certificate Update
↓
下一次 Agent 執行
```

本輪最大的底層推進是：

> **Agent rollout 不應被理解成「流量慢慢加大、看 dashboard 指標」，而應被理解成一個持續進行的 sequential causal experiment：每一筆 request 都同時更新版本效果、shadow paired evidence、shared-resource exposure 與安全證書。Hermes 必須能在任何時間點停止，而不因 repeated peeking 自欺，也不能假設一個 Agent 的 treatment 不會透過 shared memory、MCP、queue 或其他共享資源影響另一個 Agent。**
