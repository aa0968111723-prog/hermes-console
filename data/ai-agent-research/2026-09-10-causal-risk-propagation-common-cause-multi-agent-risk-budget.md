# 【AI Agent × Multimodal Research Report】

時間：2026-09-10 19:50 Asia/Taipei

## 本輪研究主題
**Causal Risk Propagation × Common-Cause Failure × Dependency Graph × Multi-Agent Shared Risk Budget**

本輪承接上一輪 `Sequential Risk Budget × Risk Composition × Critical-Step Allocation`。上一輪已建立 step risk、trajectory risk、tail risk、critical reserve 與 anytime certificate；本輪處理更深一層問題：**當多個 Agent、Memory、Tool、MCP、VLM observation 其實共同依賴同一個錯誤來源時，系統如何避免把同一風險重複計算？反過來，如何避免因只看單一 Agent 分數而低估整個依賴圖上的 blast radius？安全 authority 又如何在 delegation / handoff 中受限地傳遞？**

---

## 本小時新發現

### 新論文 / 新架構
1. **Before Agents Speak: Pre-hoc Failure Risk Inference in Multi-Agent Systems (HalluProp)** — Shi Lin et al., 2026, arXiv:2607.26836。以 agent intrinsic risk + semantic influence + communication topology 建立 propagation-aware pre-hoc inference，並用 differentiable Noisy-OR 聚合 system-level hallucination risk。論文報告平均 AUROC 84.6%，且相較 post-hoc 方法可達 65× 以上速度提升。
   - URL: https://arxiv.org/abs/2607.26836
2. **From Spark to Fire: Modeling and Mitigating Error Cascades in LLM-Based Multi-Agent Collaboration** — Yizhe Xie et al., 2026, arXiv:2603.04474。把 multi-agent collaboration 抽象成 directed dependency graph，分析 cascade amplification、topological sensitivity、consensus inertia，並以 genealogy-graph governance layer 壓制錯誤擴散。
   - URL: https://arxiv.org/abs/2603.04474
3. **AgentTrace: Causal Graph Tracing for Root Cause Analysis in Deployed Multi-Agent Systems** — Zhaohui Geoffrey Wang, AIWILD @ ICLR 2026, arXiv:2603.14688。從 execution logs 重建 causal graph、由 failure manifestation 反向追溯 root cause；作者頁面報告 550 scenarios 中 Hit@1 94.9%，約 0.12s 診斷 latency。
   - URL: https://arxiv.org/abs/2603.14688
4. **EDGE: Error Dependency Graph-Guided Multi-Error Attribution in Multi-Agent LLM Systems** — Jun Hou, Priya Pitre, Yi Fang, Xuan Wang, EMNLP 2026 / arXiv:2609.01360。9 月最新工作：把 error events 建成 dependency graph，再以 counterfactual rollout 驗證 causal subset，而不是只找單一 root cause。
   - URL: https://arxiv.org/abs/2609.01360
5. **Emergent Social Intelligence Risks in Generative Multi-Agent Systems** — Yue Huang et al., 2026, arXiv:2603.27771。指出 collective risk 不能簡化成 individual-agent risk，collusion-like coordination、conformity 等 emergent failure 可在共享資源、handoff、aggregation 等 interaction regime 中出現。
   - URL: https://arxiv.org/abs/2603.27771
6. **AgentFlow: Building Agent Dependency Graphs for Static Analysis of Agent Programs** — 2026, arXiv:2607.01640。提出 framework-agnostic Agent Dependency Graph（ADG），將 agents、prompts、models、tools/capabilities、memory、control policy 建成 typed nodes/edges，補足 runtime trace 之外的 static dependency view。
   - URL: https://arxiv.org/abs/2607.01640

---

## 本小時最重要 5 個發現

### 1. 多個錯誤表象可能只有一個 Evidence Root

**已確認事實 / 論文共識：** HalluProp、Spark-to-Fire、AgentTrace、EDGE 都指向同一件事：multi-agent failure 具有 propagation structure，不能逐 agent 獨立判斷。

例如：

```text
Camera Frame F17（誤辨識）
        ↓
VLM Observation O31
        ├→ Planner A
        │    ↓
        │  Tool target = wrong
        │
        ├→ Memory M8
        │    ↓
        │  Agent B retrieves M8
        │
        └→ Agent C receives summary
             ↓
          Final consensus wrong
```

表面看起來有：

```text
Planner failure
Memory failure
Tool-target failure
Agent-B failure
Agent-C failure
```

但真正根因可能只有：

```text
EvidenceRootID = frame:F17
```

因此：

```text
5 downstream errors ≠ 5 independent risks
```

這是上一輪 risk ledger 尚未解決的 double-counting 問題。

---

### 2. Risk Propagation 應建成 typed dependency graph，而不是簡單加總

本輪建議 Hermes 使用 **Risk Dependency Graph (RDG)**：

```text
Node Types
├ Evidence
├ Observation
├ Belief
├ Memory
├ Plan
├ Agent
├ ToolCall
├ MCP Result
├ Artifact
├ Branch
└ External Effect

Edge Types
├ derives_from
├ reads
├ summarizes
├ delegates_to
├ conditions_on
├ authorizes
├ propagates_to
└ commits_as
```

底層流程：

```text
Root evidence risk
→ edge influence
→ downstream dependency
→ common-cause grouping
→ local risk update
→ blast-radius calculation
→ critical-action gate
```

HalluProp 使用 semantic influence + communication topology；Spark-to-Fire 將 collaboration 抽象成 directed dependency graph；AgentTrace 由 logs reconstruct causal graph；EDGE 更進一步用 counterfactual intervention 驗證 error-dependency subset。這四個來源共同支持：**graph topology 是 system-level risk 的必要結構資訊。**

限制：論文方法主要針對 hallucination/error attribution；Hermes 若延伸到 permissions、tool effects、GPU/multimodal evidence，仍需工程泛化。

---

### 3. Noisy-OR 適合「至少一個原因導致 failure」的近似，但不是完整因果模型

HalluProp 使用 differentiable Noisy-OR 結合 individual risk 與 propagation risk。

典型形式可理解為：

```text
P(failure) ≈ 1 - Π_i (1 - p_i · w_i)
```

其中：

```text
p_i = upstream risk
w_i = influence / transmission strength
```

它比直接相加好，因為不會輕易超過 1，也能表示多來源共同增加 failure 機率。

但 Hermes 不能把它誤當完整 SCM：

```text
Noisy-OR
≠ causal identification
≠ dependence-free truth
≠ counterfactual proof
```

若兩個 downstream nodes 都依賴同一個 F17，仍需要 `EvidenceRootID` / causal lineage，否則 Noisy-OR 仍可能把高度相關風險當成兩個來源。

因此建議：

```text
Risk propagation score
= graph model

Causal root validation
= intervention / counterfactual replay
```

這與 EDGE 的設計方向一致：先建 dependency graph，再以 counterfactual rollout 驗證 causal subset。

---

### 4. Multi-Agent delegation 不能複製 risk authority，只能 lease / subdivide

**工程建模（本輪提出，尚非既有標準）：**

假設 Parent Agent 擁有：

```text
Critical Risk Authority = 0.10
```

它 spawn 三個 child agents 時不能變成：

```text
A = 0.10
B = 0.10
C = 0.10
```

否則 authority 被憑空放大三倍。

Hermes 應採：

```text
Parent Authority
↓
Risk Lease Allocator
├ Child A lease 0.03
├ Child B lease 0.02
└ Child C lease 0.01

Reserved / unspent = 0.04
```

並且每個 lease 包含：

```text
RiskLease
├ lease_id
├ parent_authority_id
├ principal_agent
├ child_agent
├ max_risk_authority
├ allowed_effect_classes
├ allowed_tool_scopes
├ evidence_roots[]
├ expires_at
├ generation
└ fencing_token
```

核心 invariant：

```text
Σ active_child_authority + parent_reserved
≤ parent_authority
```

以及：

```text
Child cannot delegate more authority than it currently owns.
```

這可直接接回 Hermes 既有 delegated-authority / zero-trust / fencing-token 研究。

---

### 5. Consensus 不是風險消除器；相關錯誤可形成 False Consensus

Spark-to-Fire 特別指出 `consensus inertia`；Emergent Social Intelligence Risks 也顯示 group-level pathology 不能用 individual safeguard 消除；Misinformation Propagation in Benign Multi-Agent Systems 亦顯示錯誤資訊可在 debate 中持續存在，robustness 依賴 group composition 與 decision protocol。

因此：

```text
5 agents agree
```

如果五者共同讀到：

```text
same retrieval
same memory
same VLM frame
same corrupted MCP observation
```

那並不是五份 independent evidence。

Hermes 應加入：

```text
Consensus Independence Score
```

例如：

```text
Agent A evidence roots = {R1,R2}
Agent B evidence roots = {R1,R2}
Agent C evidence roots = {R1,R3}
```

雖然 3/3 agree，真正獨立 evidence roots 只有：

```text
{R1,R2,R3}
```

且核心判斷高度集中於 R1。

因此：

```text
Agent Count ≠ Evidence Count
Consensus Size ≠ Evidence Independence
```

---

# Architecture Breakdown

## Hermes Causal Risk Control Plane

```text
User / Camera / Voice / Browser / MCP / Tool
↓
Evidence Ingestion
↓
Evidence Root Registry
├ source
├ modality
├ provenance
├ calibration profile
├ timestamp
├ integrity
└ root risk
↓
Runtime Trace / Static ADG
↓
Risk Dependency Graph
├ Evidence nodes
├ Agent nodes
├ Memory nodes
├ Tool nodes
├ Plan nodes
├ Artifact nodes
└ Effect nodes
↓
Propagation Engine
├ semantic influence
├ communication topology
├ dependency strength
├ common-cause grouping
└ temporal ordering
↓
Causal Validator
├ backward tracing
├ intervention
└ counterfactual replay
↓
Blast Radius
↓
Risk Authority Allocator
├ parent budget
├ child leases
├ critical reserve
└ fencing token
↓
Commit Gate
↓
External Effect
```

### Runtime + Static graph 合併

AgentFlow 類 ADG 可以在執行前提供：

```text
possible dependency graph
```

AgentTrace / runtime event log 提供：

```text
actual dependency graph
```

所以 Hermes 應使用：

```text
Static ADG
∪ Runtime Causal Trace
→ Effective Risk Dependency Graph
```

Static graph 能預測「可能擴散到哪裡」，runtime graph 能回答「這次實際擴散到哪裡」。

---

# Bottom-Level Logic

## 1. Evidence lineage

```text
Raw Evidence
→ assign EvidenceRootID
→ observation transform
→ derived state
→ memory write
→ message handoff
→ child-agent input
→ tool argument
→ effect
```

每次 transform 不應丟掉 lineage：

```text
DerivedObject
├ object_id
├ parent_ids[]
├ evidence_root_ids[]
├ transform_id
├ confidence
└ integrity_hash
```

## 2. Common-cause grouping

```text
If node A and node B share EvidenceRootID R:
    mark correlated(A,B,R)
```

而不是：

```text
risk(A)+risk(B)
```

直接當成兩個獨立來源。

## 3. Risk propagation

工程近似可分兩層：

```text
Pre-hoc:
IntrinsicRisk(node)
+ topology
+ semantic influence
→ predicted propagation risk

Post-observation:
Execution trace
+ actual dependencies
+ counterfactual intervention
→ causal attribution
```

## 4. Counterfactual validation

對 candidate root `R`：

```text
Observed run
R = corrupted
→ downstream failure F

Counterfactual run
intervene(R = corrected / removed)
→ replay affected subgraph
→ F disappears?
```

若 failure 消失，R 的 causal support 增強。

注意：

```text
Correlation edge ≠ causal edge
Dependency edge ≠ sufficient cause
```

## 5. Risk authority delegation

```text
Parent Agent
→ decides delegation
→ computes required lease
→ signs lease/generation
→ child acts within lease
→ child returns evidence + unspent authority
→ parent reconciles ledger
```

遇到 retry / stale child：

```text
new generation issued
→ old fencing token invalid
→ stale child cannot commit
```

---

# Multi-Agent Shared Risk Budget

本輪提出 Hermes 的 **Risk Authority Tree**：

```text
Global Safety Authority
└ Session Authority
   ├ Orchestrator Reserve
   ├ Agent A Lease
   │  ├ A1 Lease
   │  └ A2 Lease
   ├ Agent B Lease
   └ Critical Effect Reserve
```

重要區分：

```text
Risk Estimate
≠ Risk Authority
```

- `Risk Estimate`：目前認為 failure probability / severity 多高。
- `Risk Authority`：runtime policy 允許某 agent 承擔多少風險與 effect scope。

即使模型估計風險低：

```text
estimated risk = 0.01
```

如果 child 沒有 `DELETE` authority：

```text
DELETE = blocked
```

因此：

```text
Low estimated risk ≠ permission
```

---

# Multimodal Common-Cause Failure

多模態系統尤其容易出現 shared-root failure：

```text
Camera Frame F17
↓
Vision Encoder
↓
Visual Tokens V17
↓
VLM caption
├ Agent Planner
├ Memory
├ Object Detector Adapter
├ Navigation Agent
└ Safety Agent
```

如果 encoder / frame 本身錯：

```text
所有 downstream modules 同時錯
```

不能當作五份獨立 evidence。

另一個例子：

```text
ASR transcript T9
├ Intent classifier
├ Planner
├ Memory
└ Tool arguments
```

一個 mishearing 可以同時污染四層。

因此 multimodal pipeline 應追：

```text
Camera / Image / Voice / Video
→ Encoder
→ Token / Feature Root
→ Fusion
→ Observation
→ Belief
→ Plan
→ Tool
→ Effect
```

並保存跨模態 root provenance。

---

# Visual Simulation Idea

## Causal Risk Propagation & Multi-Agent Budget Graph Lab

主畫面是一個可互動 network：

```text
[Camera F17] risk .18
      ↓
[VLM O31]
  ↙   ↓    ↘
[A]  [Memory] [B]
 ↓      ↓      ↓
Plan   [C]   Tool Arg
  \     |      /
   \    |     /
    [SEND EMAIL]
```

當使用者點 `Camera F17`：

```text
Blast Radius = 7 nodes
Dependent Agents = 3
Critical Effects = 1
Common-Cause Cluster = C-17
```

如果使用者把 F17 設為 corrected：

```text
COUNTERFACTUAL REPLAY
↓
wrong target disappears
↓
SEND EMAIL risk .41 → .06
```

### 第二模式：Risk Authority Lease

```text
Session Risk Authority 0.10
├ Agent A 0.03
├ Agent B 0.02
├ Agent C 0.01
└ Critical Reserve 0.04
```

Agent B 嘗試 spawn B1/B2：

```text
requested leases = .015 + .015 = .03
owned = .02
```

UI：

```text
AUTHORITY CREATION BLOCKED
Reason: child leases exceed parent authority
```

### 第三模式：False Consensus

```text
A ✓
B ✓
C ✓
D ✓
E ✓
```

表面：5/5 consensus。

切換 `Show Evidence Roots`：

```text
A → R1
B → R1
C → R1
D → R1
E → R1
```

UI 改顯示：

```text
Agent Consensus: 100%
Independent Evidence Roots: 1
Consensus Independence: LOW
```

這非常適合教育一般使用者理解「多 Agent 一致」為何不等於「多份獨立證據」。

---

# Code / GitHub

## AgentTrace
論文作者頁提供的 source-code GitHub 連結目前回傳 404，因此本輪無法可靠列出該論文 repo 的 directory structure；這點標記為 **尚未驗證 / repository unavailable**，不以同名第三方 AgentTrace repository 冒充論文原始碼。

值得持續追：
- causal graph reconstruction
- event/span schema
- backward root-cause tracing
- ranking function
- benchmark scenario generator

## AgentFlow
值得追原始碼的目標：
- framework parsers
- ADG node/edge schema
- control/data-flow extraction
- framework adapters
- static dependency analysis

## HalluProp
若官方 code 公開，優先讀：
- intrinsic hallucination-risk estimator
- semantic influence matrix
- communication topology encoder
- Noisy-OR aggregation
- pre-hoc diagnosis pipeline

## EDGE
9 月 2026 最新，優先追：
- error event extraction
- dependency graph construction
- counterfactual rollout
- intervention-valid subgraph
- attribution evaluator

---

# Papers

### Before Agents Speak: Pre-hoc Failure Risk Inference in Multi-Agent Systems
- Authors: Shi Lin, Chenpei Wang, Peng Qian, Dezhang Kong, Minghao Li, Yufeng Li, Xun Wang
- Year: 2026
- URL: https://arxiv.org/abs/2607.26836
- Architecture: intrinsic-risk estimation + semantic influence + communication topology + differentiable Noisy-OR
- Contribution: 在 agent interaction 前預測 systemic hallucination propagation risk
- Reported Result: average AUROC 84.6%，sub-second diagnosis，>65× speedup over post-hoc methods
- Limitation: hallucination-oriented；未直接等同 general tool/effect risk

### From Spark to Fire: Modeling and Mitigating Error Cascades in LLM-Based Multi-Agent Collaboration
- Authors: Yizhe Xie, Congcong Zhu, Xinyue Zhang, Tianqing Zhu, Dayong Ye, Minfeng Qi, Huajie Chen, Wanlei Zhou
- Year: 2026
- URL: https://arxiv.org/abs/2603.04474
- Architecture: directed dependency graph + propagation dynamics + genealogy-graph governance plugin
- Contribution: formalizes cascade amplification / topology sensitivity / consensus inertia
- Limitation: propagation model 仍是 abstraction；跨真實 tool/runtime effect 的泛化需額外驗證

### AgentTrace: Causal Graph Tracing for Root Cause Analysis in Deployed Multi-Agent Systems
- Author: Zhaohui Geoffrey Wang
- Institution/Venue: AIWILD @ ICLR 2026
- Year: 2026
- URL: https://arxiv.org/abs/2603.14688
- Architecture: execution log → causal graph → backward tracing → root-cause ranking
- Contribution: 不需 debugging-time LLM inference 的快速 root-cause localization
- Limitation: post-hoc diagnosis；不等同 pre-commit prevention

### EDGE: Error Dependency Graph-Guided Multi-Error Attribution in Multi-Agent LLM Systems
- Authors: Jun Hou, Priya Pitre, Yi Fang, Xuan Wang
- Year: 2026
- URL: https://arxiv.org/abs/2609.01360
- Architecture: error dependency graph + two-stage detector + counterfactual intervention validation
- Contribution: 從 single-root attribution 推進到 related multi-error causal subset
- Dataset/Benchmark: TRAIL、MAST，並含 adapted Who&When-style evaluation
- Limitation: 很新；需要追正式 code / final EMNLP artifact

### Emergent Social Intelligence Risks in Generative Multi-Agent Systems
- Authors: Yue Huang et al.
- Year: 2026
- URL: https://arxiv.org/abs/2603.27771
- Contribution: collective interaction 可產生不能簡化成 individual risk 的 emergent social failures
- Limitation: 偏 group behavior / social interaction，不直接提供 runtime risk-control ABI

---

# Unknown / Open Questions

1. **如何在 graph 中做 correlated-risk composition 而不重複計算？**
   - Noisy-OR 是實用近似，但遇到 shared EvidenceRoot、feedback loop、latent confounder 時不足。
   - 下一步需比較 Bayesian network、factor graph、SCM、Dempster-Shafer / belief propagation 與 copula / dependency-aware risk aggregation。

2. **Risk Authority 與 probability risk 如何正式對接？**
   - 本輪的 RiskLease 是 policy/effect authority，不是 probability theorem。
   - 需要定義 authority allocation、risk estimate、severity、criticality 之間的可驗證映射。

3. **Multi-Agent feedback loop 如何避免循環放大？**
   - A 影響 B、B 回饋 A 時，簡單 DAG 不再成立。
   - 需要 SCC（strongly connected components）、feedback-gain、spectral radius 或 dynamic-system stability 指標。

---

# Knowledge Graph 新增 Node / Edge

## Nodes
- Risk Dependency Graph
- Evidence Root ID
- Common-Cause Failure
- Common-Cause Cluster
- Causal Risk Propagation
- Propagation Gain
- Blast Radius
- Semantic Influence
- Communication Topology Risk
- Agent Dependency Graph
- Runtime Causal Trace
- Static Dependency Graph
- False Consensus
- Consensus Independence
- Evidence Independence
- Causal Root Validation
- Counterfactual Risk Intervention
- Risk Authority
- Risk Lease
- Risk Authority Tree
- Parent Authority
- Child Risk Lease
- Critical Reserve Inheritance
- Budget Fencing Token
- Authority Generation
- Correlated Multimodal Evidence

## Edges
```text
EvidenceRoot
→ causes_or_influences
Observation

Observation
→ propagates_to
Belief / Memory / Plan

Agent Message
→ creates_dependency
Receiving Agent

Shared EvidenceRoot
→ induces
Common-Cause Correlation

Runtime Trace
→ instantiates
Static Agent Dependency

Counterfactual Intervention
→ validates_or_rejects
Candidate Causal Root

Parent Risk Authority
→ leases_to
Child Agent

Fencing Token
→ invalidates
Stale Delegated Authority

Consensus
→ depends_on
Evidence Independence
```

## 新增否定關係
```text
Downstream Error Count ≠ Independent Failure Count
Agent Count ≠ Evidence Count
Consensus Size ≠ Evidence Independence
Dependency ≠ Causality
Correlation ≠ Causal Root
Noisy-OR ≠ Full Causal Model
Risk Estimate ≠ Risk Authority
Delegation ≠ Authority Duplication
Shared Evidence ≠ Independent Confirmation
Static Dependency ≠ Actual Runtime Dependency
```

---

# 下一輪研究

下一輪最值得深入：

## **Feedback Stability × Cyclic Risk Propagation × Spectral Radius × Control-Theoretic Safety for Multi-Agent Loops**

因為本輪 graph 假設仍多以 directed propagation 為主，但真正 agent system 常是：

```text
Agent A
→ Agent B
→ Agent C
→ Agent A
```

或：

```text
Planner
→ Tool
→ Observation
→ Memory
→ Planner
```

下一輪需要回答：

```text
small error
↓
feedback loop
↓
amplify or decay?
```

研究重點：
- strongly connected components
- feedback gain
- spectral radius
- branching factor
- reproduction number of error
- control-theoretic stability
- damping / trust decay
- propagation cutoff
- circuit breaker
- multi-agent quarantine
- causal loop visualization

---

# 本輪結束判斷

- **缺哪一層：** Cyclic / feedback risk stability layer。
- **哪個節點最淺：** Common-Cause Risk Composition（shared-root correlation 的精確概率建模）。
- **哪個概念仍只是名詞：** Unified `RiskLease / RiskAuthority ABI` 與跨框架 `EvidenceRootID`。
- **哪個系統值得讀原始碼：** AgentFlow 的 ADG static-analysis pipeline；EDGE 的 counterfactual graph-validation code（公開後）；AgentTrace 官方論文 repo 若重新公開。
- **哪篇論文需追引用：** HalluProp、From Spark to Fire、EDGE、Emergent Social Intelligence Risks。
- **哪個概念最適合視覺模擬：** `Causal Risk Propagation & Multi-Agent Budget Graph Lab`。
- **哪個 Agent 架構最值得實作：**

> **Causally-Governed Multi-Agent Runtime = Evidence Root Registry + Static ADG + Runtime Causal Trace + Common-Cause Grouper + Propagation Engine + Counterfactual Root Validator + Risk Authority Tree + Budget Lease/Fencing + Critical Effect Gate**

本輪最大的底層進展可以濃縮成一句：

> **成熟的 Multi-Agent OS 不能把每個 Agent 的 risk score 各自計算後相加；它必須知道每個結論真正來自哪個 evidence root、錯誤如何沿通信與記憶依賴圖擴散、哪些 downstream failure 其實是同一個 common cause，以及 parent Agent 在 delegation 時究竟把多少安全 authority 租給 child，而不是把安全預算憑空複製出去。**
