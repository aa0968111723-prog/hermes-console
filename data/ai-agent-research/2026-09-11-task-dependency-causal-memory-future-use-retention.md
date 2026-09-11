# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-11 12:53 Asia/Taipei  
**主題**：Task Graph × Dependency Closure × Future-Use Prediction × Causal Memory Retention × Execution-State Memory  
**承接上一輪**：`2026-09-11-state-abstraction-bisimulation-memory-retention-eviction.md`

---

## 0. 本輪與歷史研究比較：避免重複

上一輪已建立：

```text
Predictive State
→ Task-Conditional Bisimulation
→ Abstraction Certificate
→ Retain / Summarize / Offload / Evict
→ Restore-Counterfactual Audit
```

但留下最重要缺口：

> 一段 memory 現在看起來不重要，不代表 30–50 個步驟後不會成為某個 tool call、subgoal 或 authorization check 的必要 prerequisite。

所以本輪不再研究「兩個 state 是否可合併」，而是研究：

```text
Task / Subgoal
→ Dependency
→ Evidence
→ Tool Argument / Constraint
→ Future Outcome
```

以及 retention policy 如何預測 **future use**，避免在 retrieval 發生之前就把 reasoning chain 上游節點刪掉。

核心新分界：

```text
Semantic Relevance
≠ Structural Dependency
≠ Future-Use Probability
≠ Causal Retention Value
≠ Safe-to-Evict
```

---

# 本小時新發現

## 1. When Retrieval Fails Before It Begins: Structurally Indirect Prerequisite Eviction as a Retention Failure in Agentic Memory
- **Author**：Minkyu Song
- **Year**：2026
- **URL**：https://arxiv.org/abs/2608.20400
- **Code**：https://github.com/smkgenesis/dsgc
- **Architecture**：Dependency-aware Semantic Garbage Collection (DSGC)
- **Problem**：query similarity 很低的 upstream prerequisite 在固定 budget 下被 eviction，造成 retrieval 根本沒有機會恢復完整 chain。
- **Contribution**：在主實驗中，DSGC 將 full-chain retention 從 lexical encoder 的 0.03 提升到 0.90，sentence encoder 從 0.23 提升到 1.00。
- **Limitations**：公開 paper-facing implementation 主要是 one-hop dependency propagation；深層、多型別、動態 dependency graph 仍未解決。
- **改變了什麼**：Hermes 的 retention unit 必須帶 dependency edges，不能只帶 embedding / timestamp。

## 2. Learning What to Remember: Observability-Safe Memory Retention via Constrained Optimization for Long-Horizon Language Agents
- **Authors**：Qingcan Kang, Liu Mingyang, Shixiong Kai, Kaichao Liang, Tao Zhong, Mingxuan Yuan
- **Year**：2026
- **URL**：https://arxiv.org/abs/2606.10616
- **Architecture**：OSL-MR (Observability-Safe Learning for Memory Retention)
- **Core**：把 retention 建模為 constrained partially observable sequential optimization，而非單步 relevance ranking。
- **Cost terms**：budget、miss penalty、reacquisition delay、stale-information risk。
- **Contribution**：嚴格區分 online-observable features 與 offline-available supervision；小型可精確解 instances 顯示 perfect single-step optimizer 仍可顯著落後 dynamic optimum。
- **Limitations**：evidence learner 仍主要從 realized evidence supervision 學未來價值；不直接提供 explicit task dependency closure。
- **改變了什麼**：Memory retention 是 sequential control problem，不是 ranking problem。

## 3. Beyond Semantic Organization: Memory as Execution State Management for Long-Horizon Agents
- **Authors**：Yaoqi Chen et al.
- **Institutions**：Microsoft / USTC / collaborators（依公開研究頁）
- **Year**：2026
- **URL**：https://arxiv.org/abs/2606.06090
- **Architecture**：MAGE hierarchical execution-state tree
- **Operations**：Grow → Compress → Maintain → Revise
- **Agent state**：active root-to-current execution path + subgoal summaries + recent raw traces + prior-branch hints。
- **Results**：MemoryArena 平均 task success 相較 baselines 提升 7.8–20.4 percentage points，token consumption 降低 55.1%。
- **Limitations**：tree 結構非常適合 branch/error isolation，但不是一般 DAG dependency closure；cross-branch shared prerequisite 仍需要額外 graph layer。
- **改變了什麼**：Memory 不只是知識庫，而是 execution-state data structure。

## 4. Learning What Not to Forget: Long-Horizon Agent Memory from a Few Kilobytes of Learning
- **Authors**：Nusrat Jahan Lia, Aritra Mazumder
- **Year**：2026（v2 於 2026-09-03 更新）
- **URL**：https://arxiv.org/abs/2606.20954
- **Architecture**：Learned Relevance Eviction (LRE)
- **Contribution**：kilobyte-scale、CPU-only scorer，在 future query 尚未知時預測 load-bearing history units；agent aggregate accuracy 約保留 full-history 的 93%，worst-case peak prompt 減少 52%。
- **Limitations**：learned relevance 本身未顯式保證完整 prerequisite chain。
- **改變了什麼**：future-use prediction 可以很便宜，但最好與 structural dependency propagation 結合。

## 5. MAGE + DSGC + OSL-MR 的互補關係

```text
MAGE
= execution path integrity / rollback / branch isolation

DSGC
= dependency-aware prerequisite survival

OSL-MR
= delayed-cost / future-demand retention optimization

LRE
= cheap online future-use scorer
```

本輪推論：Hermes 不應只選其中一種，而應組成：

```text
Execution Tree
+
Dependency DAG
+
Future-Use Predictor
+
Budgeted Sequential Retention Controller
```

---

# 本小時最重要 5 個發現

## 1. Retrieval failure 可能在 retrieval 前就已經發生

一般 pipeline：

```text
History
→ Eviction
→ Query
→ Retrieval
→ Reasoning
```

若 prerequisite 在 eviction 階段已刪除：

```text
Evidence A ─prerequisite→ Evidence B ─supports→ Answer
```

而 query 只與 B 語意接近，A 可能先被刪除。

因此：

```text
Bad Retrieval
≠ Retrieval Algorithm Failure
```

還可能是：

```text
Retention Failure
→ Irrecoverable Retrieval Failure
```

DSGC 的研究以 deterministic benchmark 明確隔離出這個 failure boundary；主實驗 full-chain retention 的大幅差距也支持 prerequisite survival 必須獨立量測。

### Hermes 新 metric

```text
Prerequisite Survival Rate
Full Dependency-Chain Retention
Dependency Cut Count
Irrecoverable Pre-Retrieval Loss
```

來源：
- https://arxiv.org/abs/2608.20400
- https://github.com/smkgenesis/dsgc

---

## 2. DSGC bottom-level mechanism：把 downstream relevance 回傳給 upstream prerequisite

我直接閱讀公開 code。

`DependencyGraph` 的 edge convention：

```text
(i, j)
=
block i depends on block j
```

也就是：

```text
Dependent → Prerequisite
```

`MinimalDSGCPolicy.step()`：

```text
query
↓
encode query
↓
dot(block_embedding, goal_embedding)
↓
softmax relevance
↓
for each prerequisite:
    propagated[prerequisite]
    += relevance[dependent]
↓
score
= relevance
+ λπ × propagated_relevance
↓
score / token_cost^density_exponent
↓
rank
↓
greedy keep under L1 token budget
```

公開 code：
- `src/core/graph.py`
- `src/benchmarking/policy.py`
- `src/experiments/run_calibration.py`
- `src/experiments/run_main_suite.py`

值得注意：paper-facing implementation 是 **one-hop** propagation。

所以：

```text
A → B → C
```

若 query 只強烈相關 C，最簡版只會直接回傳到 C 的 prerequisite；要真正做 Dependency Closure，Hermes 應擴充為多跳、帶衰減、帶 edge type 的 propagation。

建議：

```text
R_dep(v)
=
R_sem(v)
+
Σ_{u depends-on v}
  λ(type(u,v)) · decay(depth) · R_dep(u)
```

並加 cycle detection / SCC condensation。

---

## 3. Future-use retention 是 partially observable sequential control，不是單步 scoring

OSL-MR 的核心 state 可理解為：

```text
Carried Memory
+
Freshness / validity
+
Current interaction state
+
New memories
```

決策：

```text
x_i ∈ {KEEP, DROP}
```

約束：

```text
Σ x_i · size_i ≤ Budget
```

但真正成本不是當下，而是未來：

```text
Immediate Storage Cost
+
Future Miss Cost
+
Reacquisition Cost
+
Staleness Cost
```

因此單步：

```text
keep top-K relevance
```

無法等價於：

```text
maximize long-horizon task utility
```

### Hermes FutureUseValue

```text
FutureUseValue(m)
=
P(needed in future | observable state)
× Expected Failure Cost
+
Dependency Centrality
+
Reacquisition Cost
+
Irreversibility Cost
-
Staleness Risk
```

最重要的是不能用未來 gold query 偷看，所以 training 與 runtime 必須做 observability separation。

來源：https://arxiv.org/abs/2606.10616

---

## 4. Task tree 不等於 dependency graph：Hermes 需要雙結構

MAGE 的 state tree 很適合：

```text
root
├ successful branch
│  └ active path
└ failed branch
```

它能做到：

```text
Grow
Compress
Maintain
Revise
```

並將錯誤 branch 與 active state 隔離。

但真實 agent dependency 通常不是純 tree：

```text
Login token ───────┐
                   ├→ Upload file
Resolved file path ┤
                   └→ Later API call
```

同一 evidence 可支援多個 future subgoals；不同 branch 也可能共享同一 credential / constraint。

所以 Hermes 應同時維護：

```text
Execution Tree
= 我走過哪條路？哪條 branch 已失敗？

Dependency DAG
= 哪些 facts / artifacts / permissions 是哪些 future actions 的 prerequisites？
```

來源：https://arxiv.org/abs/2606.06090

---

## 5. Causal retention value 應以「刪除後造成什麼決策損失」定義

上一輪已用 restore-counterfactual 區分 retrieval 與 eviction failure。

本輪再向前一步：每個 memory unit 應可估計：

```text
ΔSuccess(m)
=
P(success | retain m)
-
P(success | evict m)
```

若 memory 本身與 query 不相關，但它位於 dependency closure 中：

```text
m → tool argument → subgoal → final outcome
```

則其 causal retention value 仍可能很高。

### 建議新增離線 supervision

```text
Run A: retain m
Run B: evict m
↓
compare
- tool failure
- loop count
- subgoal completion
- final success
- reacquisition cost
```

這能讓 future-use predictor 從「相關性」升級到「decision consequence」。

**注意**：這是本輪提出的 Hermes 工程推論；不是上述論文已證明的統一公式。

---

# Architecture Breakdown

## Task-Dependency Causal Memory Runtime

```text
User Goal
↓
Planner
↓
Task / Subgoal Graph Builder
├ goal
├ subgoal
├ tool call
├ artifact
├ permission
├ constraint
└ expected evidence
↓
Execution-State Tree
├ active branch
├ completed branch
├ failed branch
└ rollback checkpoints
↓
Evidence Dependency DAG
├ SUPPORTS
├ REQUIRES
├ PRODUCES
├ AUTHORIZES
├ RESOLVES
├ INVALIDATES
└ SUPERSEDES
↓
Dependency Closure Engine
↓
Future-Use Predictor
├ online semantic relevance
├ task phase
├ unresolved dependencies
├ lifecycle state
├ dependency centrality
├ reacquisition cost
└ learned evidence-use probability
↓
Sequential Retention Controller
├ RETAIN VERBATIM
├ SUMMARIZE
├ OFFLOAD
├ REACQUIREABLE DROP
└ PIN
↓
Token / KV / Storage Budget
↓
Context Compiler
↓
Reasoning / Tool Calling
↓
Outcome + Evidence Usage Log
↓
Offline Future-Use Learner
↓
Counterfactual Retention Auditor
↺
```

---

# Bottom-Level Logic

## A. Dependency Closure

令 `G=(V,E)`，edge：

```text
u → v
= u requires v
```

對 active future tasks `T_active`：

```text
RequiredClosure(T_active)
=
all transitive prerequisites reachable from T_active
```

最簡單規則：

```text
if memory ∈ RequiredClosure(active task):
    never evict solely because semantic similarity is low
```

### Multi-hop propagated retention score

```text
S0(v) = semantic_future_use_score(v)

S(v)
=
S0(v)
+
Σ depth d
  λ^d · Σ dependent paths p ending at v S0(source(p))
```

再加入：

```text
RetentionDensity(v)
=
[ S(v)
+ α·ReacquisitionCost(v)
+ β·Irreversibility(v)
+ γ·FailureImpact(v) ]
/
TokenCost(v)^ρ
```

## B. Closure-aware eviction

```text
Candidate Memories
↓
Mark active dependency closure
↓
Mark pinned / permission / identifier / path / unfinished task evidence
↓
Estimate future-use probability
↓
Estimate stale risk
↓
Budget optimizer
↓
Evict lowest expected long-horizon utility
```

## C. Dynamic dependency invalidation

不能永遠保留 dependency：

```text
Task completed
→ prerequisite may become releasable

Credential revoked
→ old credential becomes INVALID

New file path supersedes old path
→ old edge marked SUPERSEDED
```

因此 edge 需要 lifecycle：

```text
DependencyEdge
├ source
├ target
├ type
├ confidence
├ valid_from
├ valid_until
├ task_scope
├ branch_scope
├ evidence
└ status
```

---

# Visual Simulation Idea

## **Task Dependency & Future-Use Memory Lab**

主畫面：

```text
             FINAL SUBGOAL
                  ▲
                  │ REQUIRES
             Upload file
              ▲       ▲
              │       │
        file_path    auth_token
          ▲             ▲
          │             │
      resolved@t12   login@t03
```

右側同時顯示 semantic score：

```text
auth_token
Semantic Relevance      0.06
Dependency Value        0.94
Future Use              0.81
Reacquisition Cost      HIGH

Decision: RETAIN VERBATIM
```

再提供 `Evict Simulation`：

```text
EVict auth_token
↓
Future upload step
↓
401
↓
re-login
↓
session state lost
↓
subgoal delay +8 steps
```

與：

```text
Retain auth_token
↓
upload succeeds
```

第三個 view 顯示 DSGC propagation：

```text
Query relevance
Upload task      .88
auth token       .05

Dependency propagation
Upload task ──requires→ auth token
                   +.88×λ

Final retention score
Upload task      .88
auth token       .84
```

第四個 view 顯示 multi-hop closure：

```text
Final goal
↓
Tool call
↓
File ID
↓
Search result
↓
Original evidence
```

讓使用者直接看見：

> 「這段舊記憶雖然和現在 query 完全不像，但它是未來行為鏈不可切斷的上游節點。」

---

# Code / GitHub

## DSGC
Repo：https://github.com/smkgenesis/dsgc

### 已讀目錄

```text
src/
├ baselines/
├ benchmarking/
├ core/
├ experiments/
├ memory_config.py
├ memory_policy.py
└ memory_types.py
```

### 值得看的核心檔案

```text
src/core/graph.py
```
定義 dependency edge convention 與 in/out neighbors。

```text
src/benchmarking/policy.py
```
核心 `MinimalDSGCPolicy`：semantic relevance → one-hop propagation → density score → fixed-budget selection。

```text
src/experiments/run_calibration.py
```
比較 `similarity_only / dsgc_no_graph / dsgc`，追 full-chain retention、prerequisite retention、answer accuracy、displaced chain blocks。

```text
src/experiments/run_main_suite.py
```
固定 protocol，跨 lexical / sentence encoders、templates、seeds 統計 graph signal。

### 工程判讀

已確認：
- dependency graph 為 first-class object。
- propagation 在 selection 前完成。
- benchmark 明確把 `full_chain_retention` 與 answer accuracy 分開量。

尚未確認 / 尚未具備：
- arbitrary multi-hop closure production runtime。
- typed edges。
- dynamic invalidation。
- cross-task shared prerequisites。
- learned future-use probability 與 dependency propagation 的統一 optimizer。

---

# Papers

## Paper A
**Title**：When Retrieval Fails Before It Begins: Structurally Indirect Prerequisite Eviction as a Retention Failure in Agentic Memory  
**Author**：Minkyu Song  
**Year**：2026  
**URL**：https://arxiv.org/abs/2608.20400  
**Code**：https://github.com/smkgenesis/dsgc  
**Dataset / Benchmark**：paper-provided deterministic prerequisite-retention benchmark / calibration scenarios  
**Architecture**：DSGC  
**Contribution**：isolates pre-retrieval prerequisite eviction and demonstrates graph-aware propagation.  
**Limitations**：one-hop public minimal policy; narrow controlled failure mode.

## Paper B
**Title**：Learning What to Remember: Observability-Safe Memory Retention via Constrained Optimization for Long-Horizon Language Agents  
**Authors**：Qingcan Kang et al.  
**Year**：2026  
**URL**：https://arxiv.org/abs/2606.10616  
**Benchmarks**：LoCoMo, LongMemEval  
**Architecture**：OSL-MR  
**Contribution**：sequential retention under budget and delayed costs; observability-safe online/offline separation.  
**Limitations**：future evidence learner is not equivalent to explicit task dependency modeling.

## Paper C
**Title**：Beyond Semantic Organization: Memory as Execution State Management for Long-Horizon Agents  
**Authors**：Yaoqi Chen et al.  
**Year**：2026  
**URL**：https://arxiv.org/abs/2606.06090  
**Benchmark**：MemoryArena  
**Architecture**：MAGE  
**Contribution**：execution-state tree, active-path reconstruction, branch rollback/error isolation.  
**Limitations**：tree semantics do not cover arbitrary DAG dependency closure.

## Paper D
**Title**：Learning What Not to Forget: Long-Horizon Agent Memory from a Few Kilobytes of Learning  
**Authors**：Nusrat Jahan Lia, Aritra Mazumder  
**Year**：2026  
**URL**：https://arxiv.org/abs/2606.20954  
**Architecture**：LRE  
**Contribution**：cheap future-critical relevance prediction under deployment constraints.  
**Limitations**：does not guarantee prerequisite-chain preservation by itself.

---

# Unknown / Open Questions

## 1. Dependency edge 怎麼自動可靠地建立？
目前 DSGC benchmark dependency 是明確給定；真實 Hermes 中需要從：

```text
planner
function args
MCP/tool schema
execution trace
artifact lineage
permission check
LLM inference
```

自動建立 `REQUIRES / PRODUCES / AUTHORIZES / INVALIDATES`。

最大的風險是 hallucinated dependency edge 導致 memory 永遠不能刪。

## 2. Future-use prediction 如何校準到 50–500 step horizon？
LRE / OSL-MR 都證明 learned retention 有價值，但 extreme delayed dependency 仍是難題。

需要：

```text
short-horizon use probability
+
long-horizon task-graph reachability
+
rare catastrophic-use value
```

## 3. Dependency closure 太大時怎麼辦？
如果 active task graph 很深：

```text
closure ≈ entire history
```

系統又回到 full-context。

需要研究：
- lossy prerequisite summaries
- dependency cut sets
- recoverability-aware offload
- minimum sufficient evidence set
- graph sparsification with success guarantees

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Task Graph
Subgoal Node
Execution-State Tree
Dependency DAG
Prerequisite Evidence
Dependency Closure
Future-Use Prediction
Future-Use Probability
Causal Retention Value
Reacquisition Cost
Irrecoverable Pre-Retrieval Loss
Dependency Cut
Full-Chain Retention
Dependency Centrality
Lifecycle Dependency
Shared Prerequisite
Task-Scoped Memory
Branch-Scoped Memory
Retention Counterfactual
Sequential Retention Controller
Observability Separation
```

## Edges

```text
Subgoal --REQUIRES→ Evidence
ToolCall --REQUIRES→ ToolArgument
ToolArgument --DERIVED_FROM→ Evidence
Action --PRODUCES→ Artifact
Artifact --ENABLES→ FutureSubgoal
Permission --AUTHORIZES→ ToolCall
Evidence --INVALIDATES→ OldEvidence
Evidence --SUPERSEDES→ OldEvidence
Memory --HAS_FUTURE_USE_PROBABILITY→ Score
Memory --HAS_REACQUISITION_COST→ Cost
Memory --IN_DEPENDENCY_CLOSURE_OF→ Task
Eviction --CAUSES→ DependencyCut
DependencyCut --CAUSES→ IrrecoverableRetrievalFailure
```

## 新增否定關係

```text
Semantic Relevance ≠ Structural Necessity
Retrieval Failure ≠ Retrieval-System Failure
Current Relevance ≠ Future Use
Old Memory ≠ Dead Dependency
High Similarity ≠ High Retention Value
Low Similarity ≠ Safe to Evict
Task Tree ≠ Dependency DAG
One-Hop Propagation ≠ Dependency Closure
Future-Use Predictor ≠ Causal Proof
Evidence Retained ≠ Dependency Chain Preserved
```

---

# 下一輪研究

下一個最深缺口：

# **Automatic Dependency Discovery × Provenance Graph × Tool/MCP Dataflow × Dynamic Dependency Invalidation**

因為這輪仍然假設 dependency graph 已經存在。

下一輪應拆：

```text
User Goal
↓
Planner
↓
Tool Schema / MCP Schema
↓
Arguments
↓
Execution
↓
Observation
↓
Artifact / ID / Permission / Constraint
↓
Automatic Dataflow Edge Extraction
↓
Provenance Graph
↓
Dependency Confidence
↓
Runtime Validation
↓
Invalidate / Supersede / Close Edge
```

並特別研究：
- data lineage / provenance systems
- workflow DAGs
- event sourcing
- OpenTelemetry span causality
- MCP tool/resource provenance
- program slicing / taint analysis
- dynamic dependency tracing
- agent trajectory causal graphs

---

# 本輪結束回答

**缺哪一層？**  
缺「自動建立可信 Task/Evidence Dependency Graph」這一層；現在 graph-aware retention 已合理，但 graph 本身仍需要來源。

**哪個節點最淺？**  
`Future-Use Probability`，尤其超長 horizon 與 rare-but-catastrophic dependency 的 calibration。

**哪個概念仍只是名詞？**  
`Causal Retention Value`、`Dependency Closure Certificate`、`Future-Use ABI` 尚未有統一 benchmark / interface。

**哪個系統值得讀原始碼？**  
DSGC：`src/benchmarking/policy.py`、`src/core/graph.py`、`src/experiments/run_calibration.py`；下一輪則應找有 production-grade provenance/dataflow tracing 的 repository。

**哪篇論文需追引用？**  
優先追 `When Retrieval Fails Before It Begins` → graph-aware retention，以及 OSL-MR → sequential/observability-safe memory control；MAGE 用於 execution-state branch semantics。

**哪個概念最適合視覺模擬？**  
`Task Dependency & Future-Use Memory Lab`：直接顯示一個語意低相關的 token/path/permission 如何因 dependency propagation 變成不可 eviction。

**哪個 Agent 架構最值得實作？**  

> **Task-Dependency Causal Memory Runtime = Execution-State Tree + Typed Dependency DAG + Dependency Closure Engine + Future-Use Predictor + Reacquisition/Failure Cost Model + Sequential Budgeted Retention Controller + Lifecycle Invalidation + Counterfactual Retention Auditor**

---

# 本輪對「AI 到底怎麼運作」的新增位置

目前長鏈可再補成：

```text
User says something
↓
UI
↓
Agent Runtime
↓
Goal / Planner
↓
Task Graph
↓
Predictive State
↓
Execution-State Tree
↓
Evidence Dependency DAG
↓
Memory Retention Controller
↓
Context Compiler
↓
Reasoning
↓
Tool Schema / MCP
↓
Tool Arguments
↓
Execution
↓
Observation
↓
Dependency / Provenance Update
↓
Memory Lifecycle Update
↓
Next Decision
```

本輪最關鍵的結論：

> **成熟 Agent 不只要知道「這段記憶現在跟 query 像不像」，還必須知道「未來哪個 subgoal、tool argument、permission 或 artifact 仍依賴它」。真正安全的 forgetting 不是把低相關內容刪掉，而是先證明刪除不會切斷未來的 dependency chain。**
