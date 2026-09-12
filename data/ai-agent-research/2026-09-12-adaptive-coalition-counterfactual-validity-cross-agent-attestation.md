# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 12:51（Asia/Taipei）**  
**本輪主題：Adaptive Coalition Search × Interaction Sparsity × Counterfactual Validity × Graph-Guided Attribution × Cross-Agent/MCP Attestation Chain**

---

## 與歷史研究的差異

上一輪已建立：Group Counterfactual Attribution、Monte-Carlo Shapley、Minimal Support Hypergraph、Provenance Attestation。

本輪不重複「Shapley 是什麼」，而專門補上兩個 production 缺口：

1. coalition space 指數爆炸：N 個 evidence / steps 有 2^N 個 coalition，不能 exhaustive replay。
2. 可執行的 counterfactual 不代表合理：把 tool、memory、agent message 任意刪除可能創造現實中不可能出現的 trajectory。

因此本輪研究主鏈：

Trace → Dependency Graph → Candidate Slice → Adaptive Coalition Search → Counterfactual Validity Gate → Budgeted Replay → Interaction Estimate → Attestation Join → Influence Certificate

---

# 本小時新發現

## 新論文 / 架構

### 1. EDGE: Error Dependency Graph-Guided Multi-Error Attribution in Multi-Agent LLM Systems
- Authors: Jun Hou, Priya Pitre, Yi Fang, Xuan Wang
- Year: 2026
- URL: https://arxiv.org/abs/2609.01360
- Architecture: observed error events → error dependency graph → counterfactual rollout validation → reliable causal subset → attribution/repair
- Contribution: 從「找單一 root cause」推進到多錯誤、相互依賴的 error graph；只有部分 graph edges/nodes 經 intervention 驗證。
- Limitation: graph construction 仍含 LLM/judge inference；intervention-valid subset 不等於完整 causal graph。

### 2. DCFA: Dual-view Causal-inspired Attribution for Failure Reasoning in LLM-based Multi-agent Systems
- Authors: Zehao Wang, Lanjun Wang, Shilong Jin, Junjie Chen, Yanghua Xiao
- Institutions: Tianjin University / Fudan University 等
- Year: 2026
- URL: https://arxiv.org/abs/2609.04749
- Benchmark: Who&When
- Architecture: global structured dependency graph → candidate decisive error → local counterfactual-inspired refinement
- Contribution: 將長 trace 先結構化，再局部分析；六個 LLM 上 step-level accuracy 相對既有 baseline 最高提升 8.27%。
- Limitation: 「causal-inspired」不等同執行真正 do-intervention；依賴 graph 與 local reasoning 仍可能錯。

### 3. Adaptive Influence Graphs for Failure Attribution in Multi-Agent Systems
- Authors: Yarden Bakish et al.
- Year: 2026
- URL: https://arxiv.org/abs/2608.24361
- Architecture: failed trace → adaptive influence graph construction → agent-directed graph traversal → critical error
- Contribution: 顯示 attribution 效能不只取決於 diagnosing model，也高度取決於 trace representation 與 traversal policy；在 Who&When 建立新的強基線。
- Limitation: influence graph 主要是 attribution search prior，不應直接解讀成已被 intervention 證明的 causal graph。

### 4. Causal Agent Replay (CAR)
- Author: Jaineet Shah
- Year: 2026
- Paper: https://arxiv.org/abs/2606.08275
- Code: https://github.com/jaineet17/causal-agent-replay
- Architecture: recorded trajectory → SCM view → do_resample / do_action / do_observation / do_context / do_policy → stochastic forward replay → outcome distribution → contrastive / Shapley attribution
- Contribution: distributional counterfactual attribution；point-of-commitment；budget-bounded Monte-Carlo Shapley；synthetic planted-ground-truth validation。
- Limitation: real side-effecting tools 不在主要 validation scope；Shapley 最壞仍是昂貴；hosted model replay 存在 nondeterminism。

### 5. Cross-Agent / MCP provenance proof layer
- Signet: https://github.com/Prismer-AI/signet
- provenance-mcp: https://github.com/nirholas/provenance-mcp
- 共同方向：tool call / response / delegation / policy decision 以簽章 receipt 與 trace parent linkage 建立 tamper-evident provenance。
- Limitation: signature 只能證明 payload/issuer/chain 沒被竄改，不證明 payload factual、模型使用了它、也不證明它造成某決策。

---

# 本小時最重要 5 個發現

## 1. Adaptive Coalition Search 應先利用 dependency graph 縮小玩家集合

上一輪若直接對 N 個 evidence 做 Shapley：

```text
Evidence E1...EN
↓
2^N coalitions
↓
Counterfactual replay
```

在 Agent runtime 幾乎不可行。

EDGE、DCFA、Adaptive Influence Graphs 的共同訊號是：先用 graph 表示 dependencies / suspected influence，再在局部 candidate slice 內做更昂貴 attribution。

Hermes 可改成：

```text
Full Trace
↓
Typed Provenance DAG
↓
Backward Slice(target outcome)
↓
Graph Centrality / Error Dependency / Read-From / Control Dependencies
↓
Candidate Players C  (|C| << N)
↓
Adaptive Coalition Search(C)
```

**已確認事實：** 近期 multi-agent attribution 工作確實朝 structured graph + local refinement / intervention validation 前進。  
**工程推論：** Hermes 可把 graph 當「search prior」，而不是把 graph edge 當 causal proof。

---

## 2. CAR 原始碼顯示真正瓶頸是 rollout budget，不只是 2^N 理論複雜度

CAR `src/car/attribute/shapley.py` 已實作：

```text
random permutation
↓
walk coalition prefixes
↓
每個 coalition 呼叫 fresh rollout
↓
marginal contribution
↓
reverse permutation antithetic pair
↓
confidence interval
```

重要工程細節：

- 不跨 permutation cache v(S)，避免把 marginal variance 人工壓成 0。
- antithetic reverse-permutation pairing 降低 variance。
- 每次 rollout 都計入 `Budget`。
- budget 用完會 cleanly truncate，保留 partial result。
- `estimate_rollouts()` 可在執行前估算成本：

```text
rollouts
≈ n_permutations
× (2 if antithetic else 1)
× (n_steps + 1)
× samples_per_eval
```

所以 production Hermes 不該問：

```text
Can we compute exact Shapley?
```

而應問：

```text
Given budget B,
which coalition evaluation gives the highest expected information gain?
```

這把問題正式轉成 **budgeted active attribution**。

---

## 3. Counterfactual Validity 必須成為 attribution 的一級 runtime object

下列 intervention 表面上都能執行，但語義完全不同：

```text
remove(tool result)
replace(tool result = null)
make tool unavailable
preserve tool but force agent not to call it
correct tool result
replace upstream world state
```

例如：若移除 `payment_status=SUCCESS`，但仍保留後續「根據 SUCCESS 生成的 receipt ID」，就創造不一致 counterfactual。

因此 Hermes 應新增：

```text
CounterfactualValidity
├ structural_consistency
├ temporal_consistency
├ tool_precondition_consistency
├ state_invariant_consistency
├ policy_consistency
├ causal_parent_consistency
├ environment_replay_fidelity
└ plausibility_score
```

Intervention pipeline：

```text
Proposed intervention
↓
Identify causal descendants
↓
Invalidate stale derived state
↓
Recompute environment/model boundary
↓
Invariant checks
↓
VALID / PARTIAL / INVALID / UNKNOWN
```

關鍵否定：

```text
Executable Counterfactual
≠
Plausible Counterfactual
```

---

## 4. Sparse interaction discovery 比全域 Shapley 更適合 Agent debugging

Agent failure 通常不是所有 evidence 全互動，而是局部 sparse clusters：

```text
Prompt Injection
× Untrusted Tool Output
× Weak Policy Gate
→ unsafe action
```

而其他 200 個 memory/tool nodes 可能無關。

因此可採階層搜尋：

```text
Level 0: single-node screen
↓
Level 1: graph-neighbor pairs
↓
Level 2: high-residual groups
↓
Level 3: split / merge coalition
↓
Stop when posterior / CI stable or budget exhausted
```

候選 coalition utility：

```text
SearchUtility(S)
=
Expected Attribution Uncertainty Reduction
+ Interaction Residual
+ Safety Relevance
+ Graph Prior
- Replay Cost
- Side-Effect Risk
```

這不是目前某一篇論文完整提供的算法，而是由 CAR 的 budget-bounded Shapley + EDGE/DCFA/AIG graph narrowing 推出的 Hermes engineering synthesis。

---

## 5. Cross-Agent Attestation Chain 需要與 Semantic Influence Graph 分層

多 Agent / MCP workflow 可能形成：

```text
Agent A
  ↓ signed request
MCP Server X
  ↓ signed response
Agent B
  ↓ transformed summary
Agent C
  ↓ final action
```

Signet / provenance-mcp 類系統可以驗：

```text
WHO signed?
WHAT payload?
WHICH parent receipt?
WHICH delegation/policy scope?
Was payload modified?
```

但不能直接回答：

```text
Did Agent C actually rely on Agent A's result?
Would C choose differently without it?
Was A's result true?
```

所以 Hermes 必須維護兩個 graph：

```text
Cryptographic Attestation Graph
            │
            │ join by event/tool/result IDs
            ▼
Semantic Influence Hypergraph
```

只有兩者 join 後，才能生成：

```text
InfluenceCertificate
├ evidence_ids
├ attestation_status
├ coalition_support
├ counterfactual_effect
├ confidence_interval
├ interaction_terms
├ replay_fidelity
├ validity_status
└ factual_truth_status = NOT_ESTABLISHED / EXTERNALLY_VERIFIED
```

---

# Architecture Breakdown

```text
User / UI / Camera / Voice / Tools / MCP / Agents
↓
Event + Provenance Capture
↓
Typed Provenance DAG
├ READ_FROM
├ RESULT_OF
├ DERIVED_FROM
├ CONTROL_DEP
├ POLICY_DEP
├ DELEGATED_BY
└ EFFECT_OF
↓
Attestation Join Layer
├ signature verify
├ issuer identity
├ delegation chain
├ policy receipt
└ parent receipt chain
↓
Target Outcome / Failure
↓
Dynamic Backward Slice
↓
Adaptive Influence Graph
↓
Candidate Coalition Manager
├ single screen
├ graph-neighbor grouping
├ sparse interaction hypotheses
└ active next-coalition selection
↓
Counterfactual Validity Gate
↓
Replay Engine
↓
Outcome Distribution
↓
Budgeted Shapley / Interaction Estimator
↓
Minimal Support Hypergraph
↓
Influence Certificate
↓
Repair / Security / Explanation / Training Signal
```

---

# Bottom-Level Logic

## A. Adaptive coalition selection

Instead of uniform permutation sampling only:

```text
Initialize candidate set C from backward causal slice
Initialize uncertainty U_i, U_ij

while budget remains:
    generate candidate coalition S
    estimate:
        expected variance reduction
        interaction residual
        graph relevance
        replay cost
    choose S* with max acquisition score
    run validated counterfactual replay(S*)
    update attribution posterior / CI
    prune low-value nodes and interactions
```

Acquisition score:

```text
A(S)
=
α · ExpectedVarianceReduction(S)
+ β · InteractionResidual(S)
+ γ · SafetyCriticality(S)
+ δ · GraphPrior(S)
- λ · ReplayCost(S)
```

## B. Counterfactual validity gate

```text
Intervention I
↓
Check target exists at factual time
↓
Check intervention type semantics
↓
Invalidate derived descendants
↓
Replay deterministic environment glue
↓
Check tool/state preconditions
↓
Check bitemporal/causal consistency
↓
Run stochastic policy continuation
↓
Return outcome distribution + replay fidelity
```

## C. Sparse interaction residual

For pair i,j:

```text
I(i,j)
=
v({i,j}) - v({i}) - v({j}) + v(∅)
```

Large positive residual → synergy candidate.  
Large negative residual → redundancy/substitution/conflict candidate.

Higher-order groups should only be explored around large residual clusters, not globally.

---

# Visual Simulation Idea

## Adaptive Coalition & Counterfactual Validity Lab

### View 1 — Search Space Collapse

```text
Raw evidence nodes:       246
Backward slice:            31
High-priority candidates:   9
Tested coalitions:         27
Exact coalition space:    512
```

Graph visually dims pruned nodes.

### View 2 — Attribution Budget

```text
Replay Budget      ███████░░ 73%
CI width           0.21 → 0.08
Top attribution    Tool T4 0.42 ± .05
Top interaction    T4 × P1 +0.31
```

User can switch:

```text
[Uniform Shapley]
[Graph-Guided]
[Safety-Weighted]
[Variance-Reduction]
```

and see which coalition is selected next.

### View 3 — Counterfactual Validity

```text
Intervention:
remove PaymentAPI result

Structural consistency      ✓
Temporal consistency        ✓
Derived-state invalidation  ✓
Receipt dependency          ✕
Replay fidelity             0.91

STATUS: INVALID UNTIL RECEIPT DESCENDANT IS RECOMPUTED
```

### View 4 — Dual Proof Graph

Left:

```text
SIGNED RECEIPT CHAIN
Agent A → MCP X → Agent B → Agent C
✓        ✓       ✓        ✓
```

Right:

```text
SEMANTIC INFLUENCE
A result ━━━ 0.78 ━━━→ C decision
B summary ━━ 0.44 ━━━→ C decision
```

Bottom explicitly shows:

```text
Integrity: VERIFIED
Influence: 0.78 ± 0.06
Factual Truth: NOT ESTABLISHED
```

---

# Code / GitHub

## Causal Agent Replay
Repository: https://github.com/jaineet17/causal-agent-replay

值得看的目錄 / 檔案：

```text
src/car/attribute/
├ contrastive.py
├ effects.py
├ sampling.py
└ shapley.py

src/car/replay/
src/car/record/
src/car/budget/
src/car/outcome/
src/car/schemas/
src/car/synthetic.py
```

`shapley.py` 已確認：
- permutation sampling
- antithetic reverse permutations
- fresh coalition evaluations
- CLT confidence interval
- budget truncation
- rollout pre-estimation

這是目前最值得 Hermes 直接借鑑的 attribution runtime。

## Signet
https://github.com/Prismer-AI/signet

值得後續 source audit：
- receipt schema
- trace_id / parent_receipt_id linkage
- delegation chain verification
- MCP proxy request/response signing
- policy attestation representation

## provenance-mcp
https://github.com/nirholas/provenance-mcp

值得後續 source audit：
- append action path
- ERC-191 signing/recovery
- action query verification
- owner-scoped authorization boundary

---

# Papers

1. **Causal Agent Replay: Counterfactual Attribution for LLM-Agent Failures** — Jaineet Shah — 2026  
   https://arxiv.org/abs/2606.08275  
   Code: https://github.com/jaineet17/causal-agent-replay

2. **EDGE: Error Dependency Graph-Guided Multi-Error Attribution in Multi-Agent LLM Systems** — Jun Hou, Priya Pitre, Yi Fang, Xuan Wang — 2026  
   https://arxiv.org/abs/2609.01360

3. **DCFA: Dual-view Causal-inspired Attribution for Failure Reasoning in LLM-based Multi-agent Systems** — Zehao Wang et al. — 2026  
   https://arxiv.org/abs/2609.04749

4. **Adaptive Influence Graphs for Failure Attribution in Multi-Agent Systems** — Yarden Bakish et al. — 2026  
   https://arxiv.org/abs/2608.24361

5. **AttriGuard: Defeating Indirect Prompt Injection in LLM Agents via Causal Attribution of Tool Invocations** — Yu He et al. — 2026  
   https://arxiv.org/abs/2603.10749

---

# Unknown / Open Questions

## 1. 如何證明 counterfactual intervention 沒有破壞 environment semantics？
目前需要明確的 environment invariant / precondition / causal descendant invalidation protocol。

## 2. 如何做 interaction-aware attribution 又不讓 replay cost 爆炸？
需要 adaptive acquisition + sparse interaction prior；應研究 bandit / Bayesian experimental design / group-testing 類方法能否直接套到 coalition replay。

## 3. 如何把不同 Agent/MCP server 的簽章 receipt 與 semantic causal edge 對齊？
需要 stable event identity、content hash、parent receipt、tool call ID、result ID 與 bitemporal timestamp join protocol。

---

# 下一輪研究

下一輪最值得進入：

# **Replay Determinism × Common Random Numbers × Variance Reduction × Counterfactual Replay Fidelity × Environment Snapshotting**

研究鏈：

```text
Factual Runtime
↓
Snapshot Model / Tool / Memory / Environment State
↓
Counterfactual Branch
↓
Common Randomness / Seed Control
↓
Provider Nondeterminism
↓
Replay Fidelity Metrics
↓
Effect Variance Decomposition
↓
Attribution Confidence Calibration
↓
Replay Certificate
```

理由：CAR 已明確指出 hosted inference 即使 temperature=0 仍可能 nondeterministic；若 factual branch 與 counterfactual branch 的 stochastic noise 不受控，觀察到的 outcome delta 會混入「只是重新抽樣」的差異。下一輪應把 attribution 從「有 replay」推進成「知道 replay 有多可信」。

---

# Knowledge Graph 新增 Node

```text
Adaptive Coalition Search
Attribution Budget
Coalition Acquisition Function
Interaction Sparsity
Graph-Guided Attribution
Adaptive Influence Graph
Error Dependency Graph
Candidate Causal Slice
Counterfactual Validity
Structural Counterfactual Consistency
Temporal Counterfactual Consistency
Environment Replay Fidelity
Derived-State Invalidation
Counterfactual Plausibility
Sparse Interaction Cluster
Cross-Agent Attestation Chain
MCP Receipt Chain
Delegation Attestation
Policy Attestation
Attestation-Semantic Join
Influence Certificate
```

# Knowledge Graph 新增 Edge

```text
Dependency Graph
GUIDES
Coalition Search

Counterfactual Validity Gate
PRECEDES
Replay

Signed Receipt
ATTESTS_INTEGRITY_OF
Payload

Signed Receipt
DOES_NOT_PROVE
Factual Truth

Attestation Graph
JOINS_WITH
Semantic Influence Hypergraph

High Interaction Residual
TRIGGERS
Higher-Order Coalition Search

Budget Constraint
CONTROLS
Attribution Search Depth
```

# 新增否定關係

```text
Dependency Edge ≠ Causal Proof
Graph Centrality ≠ Causal Importance
Executable Intervention ≠ Plausible Intervention
Uniform Coalition Sampling ≠ Optimal Attribution Budget Use
Exact Shapley ≠ Production Requirement
Signed Tool Result ≠ True Tool Result
Receipt Chain ≠ Semantic Influence Chain
Replay Difference ≠ Causal Effect Unless Replay Fidelity Is Controlled
```

---

# 本輪結束回答

- **缺哪一層：** Counterfactual replay fidelity / stochastic variance-control layer。
- **哪個節點最淺：** `CounterfactualValidityScore` 與 `CoalitionAcquisitionFunction`。
- **哪個概念仍只是名詞：** `AttestationSemanticJoinCertificate`、`AdaptiveInfluenceCertificate`、`InteractionSparseReplayPlanner`。
- **哪個系統值得讀原始碼：** Causal Agent Replay，優先 `src/car/attribute/shapley.py`、`sampling.py`、`replay/`、`budget/`；接著 source-audit Signet。
- **哪篇論文需追引用：** Causal Agent Replay；其次 EDGE、Adaptive Influence Graphs、DCFA。
- **哪個概念最適合視覺模擬：** Adaptive Coalition & Counterfactual Validity Lab。
- **哪個 Agent 架構最值得實作：** Graph-Guided Budgeted Counterfactual Attribution Runtime。

最值得 Hermes 實作的總架構：

> **Graph-Guided Verifiable Counterfactual Runtime = Typed Provenance DAG + Dynamic Slice + Attestation Join + Adaptive Coalition Planner + Counterfactual Validity Gate + Budgeted Replay Engine + Sparse Interaction/Shapley Estimator + Minimal Support Hypergraph + Influence Certificate。**

本輪的核心推進是：**要回答「AI 為什麼這樣做」，不能只是把所有 evidence 做昂貴的 Shapley；成熟 runtime 應先利用 dependency graph 縮小可能原因，再把有限 replay budget 主動花在最能降低 attribution 不確定性的 coalition，同時拒絕語義不合理的 counterfactual。簽章證明來源未被竄改，counterfactual replay 才負責驗證它是否真的改變了決策。**