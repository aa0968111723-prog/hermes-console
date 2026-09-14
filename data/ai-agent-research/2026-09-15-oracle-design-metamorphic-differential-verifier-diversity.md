# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 07:53（Asia/Taipei）**  
**主題：Oracle Design × Metamorphic Testing × Differential Verification × Verifier Diversity**

## 與歷史研究的差異

上一輪已建立：

```text
World Model
→ Red-Team Search
→ Counterexample
→ Independent Oracle
→ Failure Minimizer
→ Safety Regression
```

但 `Independent Oracle` 仍只是抽象節點。本輪專門把它拆成可執行、可追溯、可組合的驗證層，回答：

> 當 World Model、Planner、Tool Runtime、Agent Judge 都可能犯錯時，到底誰有資格說「這是一個真的 failure」？

本輪不重複 counterexample generation，而是補齊 **oracle problem**。

---

# 本小時新發現

### 新論文 / 架構

1. **Semantic Invariance in Agentic AI**（I. de Zarzà, J. de Curtò, Jordi Cabot, Pietro Manzoni, Carlos T. Calafate；2026）
   - URL: https://arxiv.org/abs/2603.13173
   - Architecture: semantic-preserving metamorphic transformations → agent execution → invariance comparison
   - Contribution: 對七種 foundation models 套用八類語義保持 transformation，包括 paraphrase、fact reordering、expansion、contraction、context shifts 等。
   - Result: robustness 不隨模型大小單調增加；代表 fixed benchmark accuracy 不能代表 semantic stability。
   - Limitation: 主要集中在 reasoning-input transformations，尚未完整覆蓋 tool/MCP/runtime/world-state metamorphic relations。

2. **PBT-Bench: Benchmarking AI Agents on Property-Based Testing**（Lucas Jing, Xinqi Wang, Liao Zhang, Simon S. Du；2026）
   - URL: https://arxiv.org/abs/2605.15229
   - Dataset: 40 個真實 Python libraries、100 個 PBT problems、365 個 injected semantic bugs。
   - Architecture: documentation → semantic invariant extraction → Hypothesis strategy synthesis → stochastic search → violation.
   - Contribution: 把「從規格推導 invariant + 生成能打到 bug trigger region 的輸入分布」獨立成 Agent 能力測試。
   - Limitation: 主要是 software API，不直接等於 multimodal / physical-world oracle。

3. **Agentic Property-Based Testing: Finding Bugs Across the Python Ecosystem**（Muhammad Maaz, Liam DeVoe, Zac Hatfield-Dodds, Nicholas Carlini；2025）
   - URL: https://arxiv.org/abs/2510.09907
   - Code: https://github.com/mmaaz-git/agentic-pbt
   - Contribution: Agent 從 docs/source 推導 property、生成 Hypothesis tests、執行、triage、縮減反例並形成 bug report。
   - Result: 對 100 popular Python packages 的自動 bug reports，人工複核後 56% 為有效 bug；高分 21 件中 86% 有效。
   - Limitation: property 本身若推導錯，仍可能形成錯誤 oracle。

4. **Kaizen: Metamorphic Fuzzing and Differential Testing for LLM-Translated HPC Applications**（2026）
   - URL: https://arxiv.org/abs/2607.04058
   - Architecture: semantic-preserving source mutation + grammar fuzzing + original/translated differential execution.
   - Contribution: 編譯成功、既有 unit tests 通過仍不足；需比較 semantic-equivalent programs 的動態結果。
   - 改變：把 metamorphic testing 和 differential testing 串成同一驗證鏈。

5. **Correlated Errors in Large Language Models**（Elliot Kim, Avi Garg, Kenny Peng, Nikhil Garg；ICML 2025）
   - URL: https://arxiv.org/abs/2506.07962
   - Scale: 超過 350 個 LLM。
   - Contribution: 顯示模型錯誤存在顯著 correlation；其中一個 leaderboard 上，當兩模型都錯時，有約 60% 情況錯在相同位置。
   - Implication: 多 Judge agreement 不是獨立證據；shared architecture/provider 會增加 failure correlation，且大型高準確模型仍可能高度相關。

6. **Galápagos: Automated N-Version Programming with LLMs**（Javier Ron, Diogo Gaspar, Javier Cabrera-Arteaga, Benoit Baudry, Martin Monperrus；2025/2026）
   - URL: https://arxiv.org/abs/2408.09536
   - Architecture: LLM 生成多個 diverse implementation → functional equivalence verification → N-version runtime redundancy。
   - Contribution: 真正重要的不是「數量」，而是 **functional equivalence + implementation diversity**。

7. **DiffTestGen: Change-Directed LLM-Based Testing for Exposing Behavioral Differences**（Huimin Hu, Cristian Cadar, Michael Pradel；2026）
   - URL: https://arxiv.org/abs/2607.16024
   - Architecture: code change → call graph/doc analysis → target entry points → iterative tests → union coverage feedback → old/new differential execution。
   - Result: 463 PRs 中揭露 78.2% 的 behavioral differences，average union coverage 90.7%。

---

# 本小時最重要 5 個發現

## 1. Oracle 應該是「契約集合」，不是一個 Judge

### 是什麼

單一 LLM Judge：

```text
trajectory
↓
LLM judge
↓
PASS / FAIL
```

缺點是 judge 本身會受 prompt、model family、語言表達、position/self-preference 等因素影響。

Hermes 更適合：

```text
trajectory
↓
Oracle Router
├ Schema Oracle
├ Property / Invariant Oracle
├ Metamorphic Oracle
├ Differential Oracle
├ Real-Execution Oracle
├ Symbolic / Formal Oracle
├ Cross-Family Model Oracle
└ Human Oracle
↓
Evidence Fusion
↓
VERIFIED / DISPUTED / INCONCLUSIVE
```

### 為什麼重要

如果 counterexample 是被同一個 foundation model 生成、評分、解釋，再由相同 family 的另一 prompt「確認」，那不是三份獨立驗證。

### 限制

不同 Oracle 也可能共同依賴錯誤 specification。因此 `OracleContract` 必須記錄來源與權威層級。

---

## 2. Metamorphic Testing 是解 Oracle Problem 的核心方法

很多 Agent / World Model 任務沒有唯一 ground truth output。

例如問：

```text
planner(state) = trajectory
```

你未必知道唯一正確 trajectory，但可以知道 transformation 前後應保持某些關係。

形式化：

```text
x' = T(x)
```

如果 T 是 semantic-preserving transformation，則某個 relation R 應成立：

```text
R(F(x), F(T(x))) = true
```

Agent 可用的 MR（Metamorphic Relation）例如：

```text
Paraphrase(goal)
→ tool choice / final outcome 應保持語義一致

Reorder(independent facts)
→ final decision 不應改變

Add irrelevant DOM node
→ browser-agent target action 不應改變

Brightness / benign image transform
→ grounded object identity 應保持

Reorder independent tool schemas
→ semantic tool selection 不應改變

Rename irrelevant memory IDs
→ plan 不應改變

Duplicate idempotent read-only observation
→ world belief 不應發生不合理跳變
```

Metamorphic testing 的價值在於：

```text
Unknown Exact Answer
≠ No Test Oracle
```

---

## 3. Property-Based Testing 把「規格」變成可搜尋的反例空間

agentic-pbt 原始碼值得 Hermes 直接借鏡。

Repository 結構的重要部分：

```text
run.py
hypo.md
scoring.py
hypo-plugin/
example_packages/
```

`run.py` 不是單次 prompt，而是建立 sandbox-like worker directories、per-package venv，限制 Claude tool permissions，並收集 bug reports / generated test artifacts。

核心 execution：

```text
Target API
↓
Read implementation + docs
↓
Infer explicitly claimed properties
↓
Generate Hypothesis strategy
↓
pytest execution
↓
Hypothesis shrinking
↓
Reproducibility / legitimacy / impact triage
↓
Bug report
```

`hypo.md` 特別重要的工程原則：

- property 必須由 docstring/comments/callers 支持，不能自由幻想。
- strategy 要 sound，避免用無效 input 製造 false positive。
- failure 要先做 reproducibility check。
- counterexample 要縮成 minimal standalone reproduction。

對 Hermes 的直接映射：

```text
PropertySource
├ official spec
├ tool schema
├ MCP contract
├ API docs
├ invariants
└ observed stable behavior

↓
PropertyGenerator
↓
Input / State Strategy
↓
Execution
↓
Counterexample Shrinker
```

因此：

```text
Test Generator
≠ Oracle

Input Strategy
≠ Property

Property Violation
≠ Confirmed Real-World Bug
```

三者必須分開。

---

## 4. Differential Verification 的關鍵不是 majority vote，而是「共同規格下的行為差異」

基本形式：

```text
same input/state
↓
Implementation A
Implementation B
Implementation C
↓
behavior traces
↓
Differential Comparator
```

但：

```text
2 models agree, 1 model disagrees
```

不能直接推論 majority 正確。

更成熟流程：

```text
Differential disagreement
↓
Find distinguishing state/input
↓
Check specification / invariant
↓
Execute trusted implementation if available
↓
Classify which variant violates contract
```

DiffTestGen 的重要工程 insight 是：input generation 要受到 **changed code reachability** 與 coverage feedback 引導，而不是隨機 fuzzing。

Hermes 對 World Model 可建立：

```text
State S + Action A
↓
WorldModel_A → O_A
WorldModel_B → O_B
WorldModel_C → O_C
TrustedSimulator → O_T   (若可用)
Real Environment → O_R   (若成本允許)
```

再產生：

```text
DifferentialWorldModelEvent
```

---

## 5. Verifier Diversity 應該測「錯誤相關性」，不是只記 provider 名稱

Correlated Errors in LLMs 的結果非常關鍵：即使模型來自不同 provider / architecture，也不保證 error independence。

所以 Hermes 不該只存：

```text
judge_1 = OpenAI
judge_2 = Anthropic
judge_3 = Google
```

而應存：

```text
VerifierProfile
├ provider
├ model_family
├ architecture_family
├ training_relationship_if_known
├ judge_prompt_family
├ evidence_access
├ tools_access
├ modality_access
├ historical_error_vector
└ pairwise_error_correlation
```

然後建立：

```text
VerifierDiversityScore
```

更接近：

```text
Diversity
= f(
  model_family_distance,
  oracle_type_distance,
  evidence_source_independence,
  historical_error_correlation,
  execution_independence
)
```

這比「三個模型投票」更可靠。

---

# Architecture Breakdown

## Hermes Trusted Verification Layer

```text
Counterexample / Candidate Failure
↓
Oracle Contract Resolver
├ what property is being tested?
├ who defined it?
├ scope?
├ tolerance?
├ temporal constraints?
└ authority?
↓
Oracle Planner
├ deterministic check possible?
├ property-based check possible?
├ metamorphic relation available?
├ differential counterpart available?
├ trusted tool/simulator available?
└ human escalation required?
↓
Parallel Verifier Runtime
├ Schema Oracle
├ Invariant Oracle
├ Metamorphic Oracle
├ Differential Oracle
├ Symbolic Oracle
├ Real Execution Oracle
├ Cross-Family LLM Judge
└ Human Oracle
↓
Evidence Normalizer
↓
Oracle Disagreement Graph
↓
Evidence Fusion
↓
Verdict
├ VERIFIED_FAILURE
├ VERIFIED_SAFE
├ DISPUTED
├ INCONCLUSIVE
└ NEEDS_REALITY_CHECK
↓
Safety Regression Case
```

---

# Bottom-Level Logic

## 1. Property oracle

```text
Property P(x)
```

Test:

```text
sample x ~ Strategy(D)
execute F(x)
assert P(x, F(x))
```

Hypothesis 類 shrinking：

```text
failing x
↓
reduce dimensions / values / sequence length
↓
minimal x*
```

要求：

```text
P 必須有 provenance
D 必須符合真實 input domain
```

否則是 false-positive generator。

## 2. Metamorphic oracle

```text
x' = T(x)
y  = F(x)
y' = F(x')
```

驗證：

```text
R(x, x', y, y')
```

例如：

```text
T = reorder independent facts
R = semantic action equivalence
```

注意：

```text
Input semantics preserved
≠ Internal trajectory 必須 byte-identical
```

因此 comparison 要選 semantic level，而非 token/string level。

## 3. Differential oracle

```text
D_ij(x)
= distance(F_i(x), F_j(x))
```

只有：

```text
D_ij > threshold
```

代表 disagreement，不代表誰錯。

需第二層：

```text
spec / property / reality oracle
```

## 4. Evidence fusion

不要簡化成 majority vote。

建議每個 evidence：

```text
OracleEvidence
├ oracle_id
├ oracle_type
├ verdict
├ confidence
├ contract_id
├ evidence_source
├ independence_group
├ calibration_profile
├ reproducibility
└ artifact_refs
```

最終 verdict：

```text
weighted evidence
- correlated-evidence discount
- oracle calibration penalty
- contract ambiguity penalty
```

即：兩個高度相關 Judge 的票不應等價於兩個獨立 physical / symbolic oracle。

---

# Visual Simulation Idea

## Oracle Observatory × Differential Verification Lab

中心顯示一個 Candidate Failure：

```text
Agent：DELETE project X
Expected：READ-ONLY operation 不得造成 mutation
```

右側展開驗證器：

```text
Schema Oracle             FAIL
MCP Permission Oracle     FAIL
Metamorphic Replay        FAIL
World Model B             PASS
World Model C             FAIL
LLM Judge A               FAIL
LLM Judge B               FAIL
Real Sandbox Execution    FAIL
```

UI 同時畫出 independence groups：

```text
LLM Judge A ─┐
LLM Judge B ─┴─ same-family correlation = .74

Schema Oracle ─ independent
Sandbox       ─ independent
```

因此：

```text
7 / 8 raw votes fail
```

不是最重要的資訊。

真正 UI 應顯示：

```text
Independent evidence groups: 4
High-authority failures: 3
Contract ambiguity: LOW
Reproducibility: 10/10

VERIFIED FAILURE
```

使用者可以切換：

```text
Raw Votes
Independent Evidence
Oracle Graph
Metamorphic Relations
Differential Trace
Property Counterexample
Regression History
```

### 另一個互動模式：Metamorphic Relation Editor

```text
SOURCE RUN
Goal: 找到最近醫院

Transformation:
[✓] paraphrase
[✓] reorder irrelevant context
[✓] rename DOM ids
[ ] alter physical location

Expected relation:
FINAL_DESTINATION_EQUIVALENT
TOOL_CATEGORY_EQUIVALENT
```

再即時跑 agent trajectories 並把 divergence node 高亮。

---

# Code / GitHub

## 1. mmaaz-git/agentic-pbt

https://github.com/mmaaz-git/agentic-pbt

值得讀：

```text
run.py
hypo.md
scoring.py
hypo-plugin/
```

### run.py

重要點：
- per-package virtual environment
- parallel workers
- tool permission restriction
- generated test artifacts 收集
- bug report + auxiliary files lifecycle

### hypo.md

核心 agent loop：

```text
Analyze Target
→ Understand Implementation
→ Propose Evidence-Backed Properties
→ Generate Hypothesis Tests
→ Execute
→ Triage
→ Minimize
→ Report
```

這個結構比「LLM 看 code 後直接猜 bug」可靠很多。

## 2. kevinshao-pku/Metamorphic-Testing-for-DRL

https://github.com/kevinshao-pku/Metamorphic-Testing-for-DRL

Repository 直接將 metamorphic relations 實作成多個獨立測試，例如：

```text
MR_action_drop_interval_rew.py
MR_action_drop_prob_rew.py
MR_action_noise_interval_rew.py
MR_action_noise_prob_rew.py
MR_bellman_consistency.py
MR_brightness_act.py
MR_brightness_rew.py
MR_color_inversion_rew.py
MR_frame_drop_interval_rew.py
MR_frame_lag_rew.py
...
```

非常適合作為 Hermes `MetamorphicRelationRegistry` 的工程參考：relation 應該是 first-class artifact，而不是藏在 prompt 裡。

---

# Papers

## Semantic Invariance in Agentic AI
- Authors: I. de Zarzà, J. de Curtò, Jordi Cabot, Pietro Manzoni, Carlos T. Calafate
- Institution: Luxembourg Institute of Science and Technology / Barcelona Supercomputing Center / Universidad Pontificia Comillas 等
- Year: 2026
- URL: https://arxiv.org/abs/2603.13173
- Architecture: semantic-preserving transformations + invariance evaluation
- Contribution: 建立 agent semantic invariance 的 metamorphic evaluation
- Limitation: 仍需擴展到工具、runtime、physical-world transformations

## PBT-Bench
- Authors: Lucas Jing, Xinqi Wang, Liao Zhang, Simon S. Du
- Year: 2026
- URL: https://arxiv.org/abs/2605.15229
- Dataset: 100 problems / 40 libraries / 365 bugs
- Architecture: spec/docs → invariant → Hypothesis strategy → counterexample
- Contribution: 將 Property-Based Testing 拆成獨立 Agent competency
- Limitation: software-centric

## Agentic Property-Based Testing
- Authors: Muhammad Maaz, Liam DeVoe, Zac Hatfield-Dodds, Nicholas Carlini
- Year: 2025
- URL: https://arxiv.org/abs/2510.09907
- Code: https://github.com/mmaaz-git/agentic-pbt
- Contribution: end-to-end autonomous property inference / execution / triage
- Limitation: inferred property quality 仍是 oracle weak point

## Correlated Errors in Large Language Models
- Authors: Elliot Kim, Avi Garg, Kenny Peng, Nikhil Garg
- Year: 2025, ICML
- URL: https://arxiv.org/abs/2506.07962
- Dataset: >350 LLMs across leaderboards + resume screening
- Contribution: empirical evidence of correlated LLM failure
- Limitation: correlation statistics 不可直接等同某個特定 Hermes verifier ensemble 的 correlation，需要本地校準

## Galápagos
- Authors: Javier Ron, Diogo Gaspar, Javier Cabrera-Arteaga, Benoit Baudry, Martin Monperrus
- Year: 2025/2026
- URL: https://arxiv.org/abs/2408.09536
- Architecture: LLM variant generation → formal equivalence → N-version redundancy
- Contribution: diversity 必須與 functional equivalence 一起驗證
- Limitation: software implementation domain，不直接解 physical simulator truth problem

## DiffTestGen
- Authors: Huimin Hu, Cristian Cadar, Michael Pradel
- Year: 2026
- URL: https://arxiv.org/abs/2607.16024
- Architecture: static change analysis → targeted LLM test generation → union coverage optimization → differential execution
- Contribution: disagreement search 應由 coverage / reachability 引導
- Limitation: old/new program versions有明確對照；open-world agent 不一定有 reference implementation

---

# Unknown / Open Questions

## 1. Oracle contract 誰來定義？

如果 property 本身由同一個 Agent 生成：

```text
Agent creates behavior
+
Agent invents property
+
Agent judges property
```

可能形成 closed-loop self-confirmation。

需要：

```text
PropertyProvenance
PropertyAuthority
ContractReviewState
```

## 2. 沒有 ground truth / trusted simulator 時怎麼 adjudicate differential disagreement？

需要研究：

```text
partial order of oracle authority
probabilistic truth discovery
multi-view consistency
human escalation
reality sampling
```

## 3. 如何量化真正的 verifier independence？

Provider 不同不是充分條件。

需要從歷史 regression corpus 學：

```text
pairwise failure correlation matrix
conditional error overlap
oracle-family blind spot
```

---

# 下一輪研究

## Oracle Calibration × Truth Discovery × Evidence Independence × Human/Reality Escalation

目前已經有：

```text
Candidate Failure
↓
Multiple Oracles
↓
Multiple Evidence
```

下一個問題：

> 當 Oracles 互相衝突，而且不存在絕對 ground truth 時，Hermes 如何決定要相信誰？

下一輪優先研究：

```text
Bayesian truth discovery
Dawid-Skene style annotator reliability
judge calibration
oracle confusion matrix
correlated evidence discounting
human-in-the-loop escalation
active verification
verification value-of-information
formal / real execution authority hierarchy
```

預計建立：

```text
OracleCalibrationProfile
OracleConfusionMatrix
EvidenceIndependenceGraph
TruthDiscoveryEngine
VerificationValueOfInformation
ActiveOracleSelector
OracleEscalationPolicy
OracleReliabilityCertificate
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
TrustedOracle
OracleContract
OracleContractResolver
OraclePlanner
OracleRouter
OracleEvidence
OracleProvenance
OracleAuthority
PropertyOracle
PropertyProvenance
PropertyBasedTesting
InputStrategy
CounterexampleShrinker
MetamorphicOracle
MetamorphicRelation
MetamorphicRelationRegistry
SemanticInvariance
DifferentialOracle
DifferentialWorldModelTest
DifferentialDisagreement
NVersionVerification
VerifierProfile
VerifierDiversityScore
VerifierErrorCorrelation
SharedBlindSpot
IndependenceGroup
EvidenceFusion
OracleDisagreementGraph
RealExecutionOracle
SymbolicOracle
HumanOracle
```

## Edges

```text
Unknown Exact Answer
≠ No Test Oracle

Test Generator
≠ Oracle

Property
≠ Input Strategy

Property Violation
≠ Confirmed Bug

Differential Disagreement
≠ Ground Truth

Majority Vote
≠ Correctness

Multiple LLM Judges
≠ Independent Evidence

Shared Model Family
→ Can Increase Error Correlation

Metamorphic Relation
→ Enables Testing Without Exact Output Oracle

Property-Based Testing
→ Searches Counterexamples To Invariants

Differential Testing
→ Detects Behavioral Inconsistency

Trusted Specification / Reality
→ Adjudicates Differential Disagreement

Verifier Diversity
→ Must Consider Historical Error Correlation

Verified Counterexample
→ Becomes Safety Regression Case
```

---

# 本輪結束判定

**缺哪一層：** `Oracle Calibration + Truth Discovery + Active Escalation Layer`。

**哪個節點最淺：** `OracleAuthority`、`VerifierDiversityScore`、`EvidenceFusion`、`OracleCalibrationProfile`。

**哪個概念仍只是名詞：** production-grade `Independent Oracle`；目前不能只因 provider 不同就稱為 independent。

**哪個系統最值得繼續讀原始碼：** `mmaaz-git/agentic-pbt` 的 property generation / execution / triage pipeline；其次 Metamorphic-Testing-for-DRL 的 relation registry pattern。

**哪篇論文需追引用：** `Correlated Errors in Large Language Models`，因為它直接影響多 Judge / multi-agent verifier 架構的有效性；其次 PBT-Bench。

**哪個概念最適合視覺模擬：** `Oracle Observatory × Differential Verification Lab`。

**哪個 Agent 架構最值得實作：**

```text
Candidate Failure
↓
Oracle Contract Resolver
↓
Property + Metamorphic + Differential Test Generator
↓
Parallel Heterogeneous Oracles
↓
Correlation-Aware Evidence Fusion
↓
Reality / Human Escalation
↓
Verified Regression Case
```

---

# 對「AI 到底怎麼運作」新增的核心答案

成熟 AI 系統不能只讓一個模型同時當 Planner、Simulator 和 Judge。當 AI 說「這條 trajectory 是安全的」，真正可靠的系統還要問：它違反任何可證明 invariant 嗎？在語義等價的輸入變形下結果是否保持一致？另一個獨立 implementation 是否得到相同行為？真實 sandbox / sensor / tool execution 是否支持這個結論？不同 verifier 的錯誤是否其實高度相關？

因此完整鏈逐漸變成：

```text
User
→ UI
→ Agent
→ Context / Memory / Belief
→ Reasoning / Planning
→ World Model Dream
→ Candidate Action
→ Oracle Contract
→ Property / Metamorphic / Differential / Reality Verification
→ Evidence Fusion
→ Execute / Reject / Escalate
→ Real Observation
→ Regression Memory
→ Knowledge Graph
```

AI 的可靠性不只來自「更會思考」，還來自**有一套和自己不同、能系統化證偽自己思考結果的驗證機制**。
