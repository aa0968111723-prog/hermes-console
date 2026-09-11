# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 20:53（Asia/Taipei）**  
**主題：Adaptive Causal Probing × Black-Box System Identification × Expected Information Gain × Minimal Intervention × Hidden Dependency Attribution**

---

## 本小時新發現

本輪承接上一輪 `Causal Read-Set Discovery × Tool Behavior Drift × Contract Recertification`，不再重做 exhaustive intervention matrix，而是解決：

```text
100 resources × 10 interventions × repetitions
= too expensive
```

核心轉向：

```text
Candidate Dependencies
↓
Belief Distribution over hypotheses
↓
Choose Probe with highest expected information value
↓
Run one controlled intervention
↓
Observe output / side-effect / branch / latency
↓
Posterior Update
↓
Stop when certificate confidence is sufficient
```

### 新論文 / 架構

1. **CausaLab: A Scalable Environment for Interactive Causal Discovery Toward AI Scientists** — Junlin Yang, Dylan Zhang, Xiangchen Song, Qirun Dai, Xiao Liu, Yuen Chen, Aniket Vashishtha, Jing Shi, Chenhao Tan, Hao Peng (2026). 互動式 causal discovery benchmark；隱藏資料生成程序是隨機 SCM，agent 必須透過 intervention 同時恢復 graph 與 structural equations。純觀察 6-node 設定中 GPT-5.2-high task accuracy 92%，但 all-edge F1 僅 0.471；mixed observation/intervention 可達 task accuracy 與 all-edge F1 皆 80%。重要限制：強模型仍不擅長設計 informative interventions，且有 premature stopping。
2. **Calibrate-Then-Act: Cost-Aware Exploration in LLM Agents** — Wenxuan Ding et al. (2026). 把 agent exploration 明確建模為 latent environment state 下的 sequential decision problem；提供 prior/calibration 後，agent 可做更合理的 cost-benefit exploration。
3. **Discovering What You Can Control: Interventional Boundary Discovery for Reinforcement Learning** (2026). 用 intervention 而非觀察 correlation 找 agent 的 causal sphere of influence；提醒 read-set / controllability discovery 必須區分 observational association 與 causal effect。
4. **Causal Discovery in Action: Learning Chain-Reaction Mechanisms from Interventions** (CLeaR 2026). 對 directional cascade 系統證明 blocking intervention 可識別結構，且在特定假設下 sample complexity 可為 logarithmic；這提供「不要全面 probe，每次挑最能切分 hypothesis set 的 blocking test」的理論直覺。
5. **Contract2Tool: Learning Preconditions and Effects for Reliable Tool-Augmented LLM Agents** (2026). 從 metadata、schema、documentation、execution traces 推論 normalized symbolic tool contracts；hybrid evidence 的 downstream success 0.980，接近 gold contract 0.990。它補上 prior learning，但不是 causal verification 的終點。

---

## 本小時最重要 5 個發現

### 1. Prediction Accuracy ≠ Causal Identification

**已確認論文結果：** CausaLab 顯示 agent 可以靠錯誤或不完整 causal hypothesis 仍做出正確 prediction。

因此 Hermes 的 tool certification 不能只測：

```text
Tool prediction / outcome correct?
```

而要分開：

```text
Outcome Accuracy
Graph Recovery
Structural Equation Recovery
Intervention Consistency
Counterfactual Consistency
```

這直接修正上一輪 `ReadDependencyConfidence` 的定義：confidence 不能主要由 predictive agreement 組成。

### 2. Exhaustive Probing ≠ Good Experimental Design

真正要優化的不是「多跑幾個 probe」，而是每一步選擇能最大縮小 hypothesis space 的 probe。

對候選 hypothesis `H` 與 probe `a`：

```text
EIG(a)
= H[P(H)]
- E_y H[P(H | y, do(a))]
```

Hermes 可再加入成本與風險：

```text
ProbeUtility(a)
= ExpectedInformationGain(a)
- λ * MonetaryCost(a)
- μ * Latency(a)
- ν * SideEffectRisk(a)
- ξ * Irreversibility(a)
```

因此：

```text
Maximum Intervention Count ≠ Maximum Knowledge
```

### 3. Mixed Observation + Intervention 往往比 Pure Intervention 更好

**CausaLab 論文結果：** pure intervention 策略並沒有自然勝出，mixed observation-intervention 反而改善 structural fidelity。

Hermes 因此不該把 recertification 寫成：

```text
always actively perturb everything
```

而應先吸收廉價 evidence：

```text
Schema
Documentation
Historical Trace
Telemetry
Natural Drift
Existing Failures
↓
Posterior Prior
↓
Only then active intervention
```

這與 Contract2Tool 的 hybrid documentation + trace evidence 可以直接結合。

### 4. Premature Stopping 是 Active Causal Agent 的核心 Failure Mode

CausaLab repository 的 README 與 experiment notes 都指出 runs 常留下相當比例 intervention budget 未使用；agent 會在 causal hypothesis 尚未充分驗證時提交。

因此停止條件不應是：

```text
LLM says "I am confident"
```

而應是 machine-checkable：

```text
Stop if:
PosteriorEntropy < ε
AND
CriticalEdgesConfidence > τ
AND
No high-value probe remains
AND
Hypothesis consistent with all past interventions
```

新增 `ProbeStopCertificate`，避免 verbal confidence 取代 evidence threshold。

### 5. Causal Probe 應優先切分「決策相關」Hypotheses，而不是完整世界模型

對 Hermes 而言，不必先恢復外部 SaaS / MCP 的完整 hidden implementation。

需要的是：

```text
Does resource R change:
- tool selection?
- argument construction?
- side effect?
- safety gate?
- outcome verification?
```

所以 probe objective 應是 **task-weighted causal identification**：

```text
TaskWeightedEIG(a)
= Σ_h P(h) * DecisionImpact(h) * InformationGain(a,h)
```

這把「black-box system identification」限制在 Agent 真正需要的 causal boundary，降低成本。

---

## Architecture Breakdown

### Adaptive Causal Certification Runtime

```text
Unknown / Drifted Tool
↓
Evidence Collector
├ Schema
├ Docs
├ Tool annotations
├ Historical traces
├ Runtime telemetry
└ Previous certificates
↓
Hypothesis Generator
├ candidate read dependencies
├ candidate preconditions
├ candidate effects
├ candidate failure modes
└ candidate hidden dependencies
↓
Belief State over Contracts
↓
Probe Planner
├ Expected Information Gain
├ Cost
├ Latency
├ Safety
├ Reversibility
└ Task relevance
↓
Controlled Intervention
↓
Multi-Channel Observer
├ return value
├ downstream arguments
├ side effects
├ latency
├ error
├ selected branch
└ postcondition
↓
Bayesian / likelihood update
↓
Consistency Checker
↓
Stop Criterion
├ confidence threshold
├ entropy threshold
├ critical-edge coverage
└ no worthwhile remaining probe
↓
Minimal Effect / Read-Set Certificate
↓
Transactional Runtime
```

### 與歷史研究接合

```text
Tool Descriptor
→ Contract Prior
→ [本輪] Adaptive Causal Probe Planner
→ Causal Read Set
→ Effect Certificate
→ Capability Gate
→ Semantic Transaction
→ Tool / MCP
→ Effect Truth
→ Provenance
```

---

## Bottom-Level Logic

### Mechanism 1 — Hypothesis-space elimination

假設目前對 Resource R 有三個 competing hypotheses：

```text
H1: tool never reads R
H2: tool reads R only when premium=true
H3: tool always reads R
```

不要先做十種 perturbation。

挑一個能最好分裂三者的 probe：

```text
set premium=false
mutate R
invoke tool
```

如果 outcome 不變：

```text
H3 probability ↓
H1 / H2 remain
```

再挑下一個 maximal-discrimination probe。

### Mechanism 2 — Observation model

Black-box causal inference 必須明確建立：

```text
P(observation | hypothesis, intervention)
```

否則所謂 `information gain` 只是語意猜測。

Hermes 可先用 empirical likelihood：

```text
N(h,a,y) + α
----------------
N(h,a) + α|Y|
```

後續再換 learned surrogate / Bayesian model。

### Mechanism 3 — Stop rule

```text
if max_probe_utility < probe_cost_threshold
and all critical dependencies > confidence_threshold
and hypothesis_history_consistency == true:
    CERTIFY
else:
    PROBE
```

注意：

```text
Low Global Entropy ≠ Critical Edge Verified
```

即使整體模型很確定，只要高風險 write / auth / safety dependency 仍不確定，就不能發 certificate。

---

## Visual Simulation Idea

# Adaptive Causal Probe Planner

左側顯示 hypothesis graph：

```text
customer_profile → price ? 0.63
premium_policy   → price ? 0.51
inventory        → price ? 0.08
weather          → price ? 0.05
```

中間顯示可選 probe：

```text
Probe A: mutate customer_profile
EIG 0.71 | cost $0.02 | risk LOW

Probe B: deny premium_policy
EIG 0.64 | cost $0.01 | risk LOW

Probe C: delete inventory
EIG 0.30 | risk HIGH
```

系統自動選：

```text
NEXT PROBE → A
```

執行後 posterior 動畫：

```text
customer_profile → price
0.63 → 0.94

premium_policy → price
0.51 → 0.39
```

再顯示：

```text
Remaining uncertainty: 0.22 bits
Estimated next-probe value: 0.03
Critical edges verified: YES

STOP → ISSUE CERTIFICATE
```

另一個重要視圖：

```text
Task success  ✓
Causal model  ✕
```

用紅色提醒使用者：

> 正確答案不代表 Agent 真的理解底層機制。

---

## Code / GitHub

### DylanZSZ/CausaLab-Benchmark

實際 repository 結構包含：

```text
agents/
causal_graph_configs/
causalab_reeval/
discoveryworld/
examples/
release/
scripts/
```

`agents/recoma/` 中實際存在 ReAct controller、memory controller、causal tool 與多組 causal DSL prompts。

值得看的核心檔案：

```text
agents/recoma/react_controller.py
agents/recoma/causal_tool.py
agents/recoma/prompts/react_simple_memory_prompt_dsl*.txt
agents/recoma/EXPERIMENTS_CAUSAL_SCALING.md
scripts/vis_backend/visualize_causal_graphs_dsl.py
```

`react_controller.py` 顯示 runtime 明確維護 Action / Observation history；memory controller 另外維護 `latest_past_data_obj`、`latest_hypothesis`、`pending_experiment`、`last_observed_entry`，並可掛上 `OnlineInterventionCausalTool`。這是一個真正可參考的 hypothesis → experiment → observation → hypothesis-update loop，而不是只在 prompt 說「做因果推理」。

Repo experiment notes 也記錄：agent intervention 次數、提交時點、提交前 hypothesis 與 past data consistency，這幾個 metric 很適合搬進 Hermes 的 causal certification telemetry。

---

## Papers

### CausaLab: A Scalable Environment for Interactive Causal Discovery Toward AI Scientists
- Authors: Junlin Yang, Dylan Zhang, Xiangchen Song, Qirun Dai, Xiao Liu, Yuen Chen, Aniket Vashishtha, Jing Shi, Chenhao Tan, Hao Peng
- Institutions: UIUC / Tsinghua / CMU / University of Chicago / Adobe 等
- Year: 2026
- URL: https://arxiv.org/abs/2605.26029
- Code: https://github.com/DylanZSZ/CausaLab-Benchmark
- Dataset: 950 synthetic causal graph configurations / 19 JSONL suites（repo release dataset）
- Architecture: synthetic SCM lab + agent interventions + explicit causal DSL hypothesis + held-out prediction
- Contribution: 把 LLM agent causal reasoning 變成 interactive experimental science，而不只是 static QA
- Limitation: pure intervention strategy 表現仍弱；premature stopping；synthetic setting 與真實 APIs 還有 domain gap
- 改變了什麼：證明 task success 與 causal mechanism recovery 必須分開評估

### Calibrate-Then-Act: Cost-Aware Exploration in LLM Agents
- Year: 2026
- URL: https://arxiv.org/abs/2602.16699
- Contribution: 將 exploration cost / latent environment state 顯式化，證明 prior calibration 能改變 agent 的探索策略
- Limitation: 非專門為 MCP/tool causal certification 設計

### Discovering What You Can Control: Interventional Boundary Discovery for Reinforcement Learning
- Year: 2026
- URL: https://arxiv.org/abs/2603.18257
- Architecture: action intervention + two-sample test + binary causal relevance mask
- Contribution: 將 causal controllability 與 observational correlation 分離
- Limitation: RL observation dimensions 與 SaaS/MCP typed resource graph 不同

### Causal Discovery in Action: Learning Chain-Reaction Mechanisms from Interventions
- Year: 2026
- URL: https://arxiv.org/abs/2603.22620
- Venue: CLeaR 2026
- Contribution: 在 chain-reaction structural assumptions 下，blocking intervention 可高效率識別因果結構
- Limitation: identifiability 依賴 cascade 結構假設

### Contract2Tool: Learning Preconditions and Effects for Reliable Tool-Augmented LLM Agents
- Year: 2026
- URL: https://arxiv.org/abs/2606.07904
- Contribution: 從 docs/schema/traces 學 symbolic tool contracts，適合作為 Hermes causal probing 的 prior
- Limitation: trace-derived contract correctness 不等於 intervention-verified causality

---

## 已確認 / 工程實作 / 合理推論 / 未驗證假說

### 已確認事實 / 論文結果
- CausaLab 顯示 prediction accuracy 與 causal edge recovery 可明顯分離。
- Mixed observation-intervention 在其 6-node setting 比 pure observation/pure intervention 更能兼顧 task 與 structural fidelity。
- CausaLab authors 明確指出 informative intervention design 與 premature stopping 仍是 agent 弱點。
- Contract2Tool 的 hybrid docs+trace evidence 可學到有 downstream utility 的 symbolic contract。

### 工程實作已確認
- CausaLab repo 有實際 ReAct controller、memory/hypothesis state、pending experiment 與 online intervention causal tool integration。

### 合理推論
- Hermes 可用 Contract2Tool 類 evidence 形成 prior，再用 adaptive intervention 做 causal verification，比 exhaustive perturbation 更省成本。
- Certificate stop rule 應該是 deterministic threshold + critical-edge coverage，而不是模型自報 confidence。

### 尚未驗證假說
- Expected Information Gain 是否在真實 MCP 工具上優於 heuristic uncertainty sampling。
- LLM 是否能可靠產生 hypothesis set；可能需要 symbolic/learned surrogate 代替自由文字 hypotheses。
- 對 nondeterministic remote services，單一 posterior model 是否足以分離 drift、noise 與真正 causal dependency。

---

## Unknown / Open Questions 1–3

1. **Probe outcome 非平穩時怎麼做 posterior update？** 遠端 model / ranking / feature flag 會 drift，會破壞 stationary likelihood 假設。
2. **Hidden confounder 怎麼辨認？** 如果兩個外部 resources 由同一 backend feature 控制，單 resource perturbation 可能產生錯誤 read edge。
3. **Physical / irreversible tool 如何 probe？** 必須用 shadow world、digital twin、sandbox 或 observational natural experiments，不能直接主動干預。

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
Adaptive Causal Probing
Probe Planner
Probe Utility
Expected Information Gain
Hypothesis Space
Contract Belief State
Observation Model
Posterior Contract
Minimal Intervention
Critical Dependency
Probe Stop Certificate
Premature Stopping
Mechanism Recovery
Predictive Success
Task-Weighted Causal Identification
Natural Intervention
Blocking Intervention
Active System Identification
Causal Certificate Entropy
```

### Edges

```text
ToolContractPrior --INITIALIZES→ ContractBeliefState
ContractBeliefState --SELECTS→ Probe
Probe --INTERVENES_ON→ Resource
ProbeObservation --UPDATES→ ContractBeliefState
ContractBeliefState --CERTIFIES→ ReadDependency
CriticalDependency --REQUIRES→ MinimumConfidence
ProbeStopCertificate --GATES→ EffectCertificate
HistoricalTrace --REDUCES_NEED_FOR→ ActiveProbe
```

### 重要否定關係

```text
Prediction Accuracy ≠ Causal Identification
High Confidence Language ≠ Calibrated Confidence
More Probes ≠ More Information
Pure Intervention ≠ Optimal Discovery
Observational Correlation ≠ Read Dependency
Low Global Entropy ≠ Critical Edge Verified
Contract Prior ≠ Verified Contract
Correct Final Answer ≠ Correct Mechanism
Unused Probe Budget ≠ Sufficient Evidence
```

---

## 下一輪研究

下一個最大缺口：

# Hidden Confounders × Nonstationary Tool Behavior × Bayesian Change-Point Detection × Natural Experiments

因為 adaptive probe planner 目前仍假設：

```text
P(y | h, do(a))
```

在短時間內穩定。

但真實 MCP / SaaS 可能：

```text
same tool
same schema
same args
↓
different backend model
feature flag changed
ranking changed
policy changed
regional service changed
```

下一輪應建立：

```text
Streaming Tool Telemetry
↓
Behavioral Fingerprint
↓
Change-Point Detector
↓
Stationary Segment
↓
Causal Probe Planner
↓
Confounder Test
↓
Natural Experiment / Active Intervention
↓
Drift-vs-Causality Attribution
↓
Recertification
```

---

## 本輪結束回答

**缺哪一層？**  
Nonstationary causal identification：目前 adaptive probing 假設 observation model 在 probe window 內穩定。

**哪個節點最淺？**  
`ObservationModel = P(y | h, intervention)`；真實 noisy tool / asynchronous side effects 下還沒有可靠 calibration。

**哪個概念仍只是名詞？**  
`ProbeStopCertificate`、`TaskWeightedEIG`、`MinimalReadSetCertificate`、`ContractBeliefState ABI`。

**哪個系統值得讀原始碼？**  
CausaLab 的 `react_controller.py`、`causal_tool.py`、DSL prompts、experiment scaling notes 與 causal visualization scripts。

**哪篇論文需追引用？**  
CausaLab → active causal discovery / optimal experimental design；Causal Discovery in Action → blocking intervention sample complexity；Contract2Tool → contract prior learning。

**哪個概念最適合視覺模擬？**  
Adaptive Causal Probe Planner：直接把 hypothesis entropy、probe cost、expected information gain 與 posterior updates 動畫化。

**哪個 Agent 架構最值得實作？**  

> **Adaptive Self-Certifying Tool Runtime = Evidence Prior Builder + Hypothesis Generator + Contract Belief State + Cost/Risk-Aware Probe Planner + Controlled Intervention Sandbox + Multi-Channel Observer + Posterior Updater + Critical-Edge Verifier + Probe Stop Certificate + Versioned Effect/Read-Set Certificate。**

本輪最大推進：**Hermes 不應靠「把每個資源都測一遍」理解黑盒工具，而應像真正的實驗科學家：維護多個 competing hypotheses，每一步只做最能降低決策相關不確定性的 intervention，並在證據達標時停止。**