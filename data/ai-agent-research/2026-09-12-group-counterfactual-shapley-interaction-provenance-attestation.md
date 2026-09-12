# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 11:51（Asia/Taipei）**  
**本輪主題：Group Counterfactual Attribution × Shapley Interaction × Minimal Support Hypergraph × Provenance Attestation × Influence Certificate**

---

## 0. 與歷史研究比較：本輪刻意不重複什麼

上一輪已建立：

```text
Observed Provenance
→ Candidate Influence Edge
→ Single Evidence Counterfactual Replay
→ Minimal Verifiable Support
→ Provenance Coverage
```

並留下明確缺口：

```text
E1 alone may be unnecessary
E2 alone may be unnecessary
but {E1,E2} may be jointly necessary
```

因此本輪不再重做 runtime read tracing、單點 ablation、event log、dynamic slice 或基本 cryptographic hashing，而專注五個問題：

1. 多個 evidence/tool/memory 如何產生 interaction effect？
2. 怎麼把單點 influence 升級成 coalition / Shapley attribution？
3. 怎麼表示多個等價 minimal support sets，而不是假設只有一條 provenance path？
4. attestation 究竟能證明什麼、不能證明什麼？
5. Hermes 如何產出一份可驗證但不誇大因果性的 Influence Certificate？

本輪核心結論：Hermes 下一層需要的是 `Interaction-Aware Counterfactual Runtime + Minimal Support Hypergraph + Attested Lineage Envelope`。

---

# 本小時新發現

## 新論文 / 新架構 / 新 GitHub

### A. Causal Agent Replay (CAR)

**Title**: Causal Agent Replay: Counterfactual Attribution for LLM-Agent Failures  
**Author**: Jaineet Shah  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2606.08275  
**Architecture**: structural causal model over agent run + do-intervention over steps + stochastic forward replay + contrastive estimator + budget-bounded Monte-Carlo Shapley estimator  
**Contribution**: 不只問「哪一步附近出錯」，而是介入 execution step 後重新往前跑，觀察 outcome distribution 改變；另外以 Monte-Carlo Shapley 分攤 interacting steps 的 credit。  
**Reported result**: 在 planted synthetic SCM 中，Shapley 能恢復 two-step interaction，論文摘要報告約 `(0.44, 0.45, ~0)`，efficiency sum 0.909，接近 analytic 0.91。  
**Limitations**: attribution 依賴 intervention definition、outcome function、replay policy、sample budget；Shapley 公平分攤 contribution，不自動等於真實機制因果。

CAR 對 Hermes 最大改變：

```text
Single-step replay
→ Group replay
→ Outcome distribution
→ Coalition marginal contribution
→ Interaction-aware attribution
```

---

### B. AgentSHAP

**Title**: AgentSHAP: Interpreting LLM Agent Tool Importance with Monte Carlo Shapley Value Estimation  
**Authors**: Miriam Horovicz et al.  
**Year**: 2025  
**URL**: https://arxiv.org/abs/2512.12597  
**Code**: https://github.com/GenAISHAP/TokenSHAP  
**Dataset**: API-Bank  
**Architecture**: agent as black box + tool coalition sampling + response utility/similarity + Monte-Carlo Shapley estimation  
**Contribution**: 將 tool importance 從「有沒有被 call」改成 coalition-level marginal contribution。  
**Limitations**: value function 決定 attribution 的語義；若 value 是「和 baseline answer 多像」，baseline 本身錯誤時仍可能得到穩定但錯方向的 attribution。

本輪實際讀原始碼：`token_shap/agent_shap.py`。

核心執行不是 README 描述，而是：

```text
All tools
→ baseline response

For every tool:
→ essential leave-one-out coalition

+ random additional coalitions
→ execute full agent loop under each available-tool subset
→ embedding similarity to baseline
→ SHAP calculation
```

程式還會記錄每個 coalition 的真實 tool usage，而不只 availability。

值得看的檔案：

```text
token_shap/agent_shap.py
  coalition construction
  leave-one-out essentials
  random coalition sampling
  agent execution
  similarity construction

 token_shap/base.py
  model interface
  generate_with_tools()
  Shapley calculation base

 token_shap/tools.py
  tool abstraction

 experiments/agentshap/
  consistency
  faithfulness
  scalability
  irrelevant-tool injection
  cross-domain
  model comparison
```

---

### C. AEX — API Boundary Attestation

**Title**: AEX: Non-Intrusive Multi-Hop Attestation and Provenance for LLM APIs  
**Author**: Yongjie Guan  
**Institution**: Zhejiang University of Technology（由公開 paper index 顯示）  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2603.14283  
**Architecture**: canonical request/output projection → cryptographic commitment → signed attestation → transform receipts → streaming hash chain / checkpoint proof  
**Contribution**: 把「client-visible request 與 response 是否真的屬於同一條受信 API lineage」變成可驗證 cryptographic relation；支援 request transform、output transform、多 hop 與 streaming。  
**Limitations**: AEX 刻意只證明 request-output relation / lineage；它不證明 output factual、模型推理正確，也不證明某 evidence 對 decision 的 semantic influence。

因此 Hermes 必須明確分離：

```text
Cryptographic Integrity
≠
Semantic Influence
≠
Factual Truth
```

---

### D. AgentPKI Provenance v0.1

**Status**: Draft, 2026-06-09  
**URL**: https://agentpki.dev/spec/provenance-v0.1/  
**Architecture**: agent identity/passport + Ed25519 signing + C2PA manifest + content binding + issuer verification  
**Contribution**: 將「哪個 agent 產生/轉換內容」綁定到 agent identity 與可驗證 content manifest；並涵蓋 plain text / JSON / code 等 C2PA 原生較弱的內容類型。  
**Limitations**: 身分與內容 lineage 被簽名，不代表 agent 的 reasoning、tool use、counterfactual influence 已被驗證。

---

# 本小時最重要 5 個發現

## 1. Single Ablation ≠ Interaction Attribution

假設：

```text
E1 = payment API says SUCCESS
E2 = ledger shows transaction id
```

Planner 規則可能是：

```text
if E1 AND E2:
    DO_NOT_RETRY
else:
    RETRY
```

對單點 ablation：

```text
remove E1, keep E2 → RETRY
remove E2, keep E1 → RETRY
```

兩者都重要。

但另一種 OR redundancy：

```text
if E1 OR E2:
    DO_NOT_RETRY
```

則：

```text
remove E1 → decision unchanged
remove E2 → decision unchanged
remove {E1,E2} → decision flips
```

所以：

```text
Individual Necessity
≠
Group Necessity
```

Hermes 必須支援 coalition intervention。

---

## 2. Shapley 的價值是公平分攤 coalition contribution，不是神奇的「因果真相」

對 evidence set N，Shapley value：

```text
φ_i = Σ_{S ⊆ N\{i}}
      |S|!(n-|S|-1)! / n!
      × [v(S∪{i}) - v(S)]
```

真正最難的不是公式，而是定義：

```text
v(S) = ?
```

AgentSHAP 目前的工程路徑主要使用「coalition response 與 all-tools baseline response 的 embedding similarity」作為 value signal。

這適合回答：

> 哪些 tools 對重現 baseline response 最重要？

但不必然回答：

> 哪些 tools 對正確、安全或真實結果最重要？

Hermes 應把 value function 做成多目標：

```text
v(S) =
  α GoalSuccess
+ β Safety
+ γ Factuality
+ δ EffectCorrectness
- λ Cost
- μ Latency
```

並分別保存 attribution，不應硬壓成一個分數。

---

## 3. Minimal Support 應該是 Hypergraph，不是單一路徑

同一 decision 可能有多個等價 support set：

```text
{Tool A, Tool B}
{Memory C, Ledger D}
{Vision V, Badge B}
```

任何一組都足以重現 decision。

因此 provenance 不應只保存：

```text
A → Decision
B → Decision
```

而應加入：

```text
SupportHyperedge H1 = {A,B} → Decision
SupportHyperedge H2 = {C,D} → Decision
SupportHyperedge H3 = {V,Badge} → Decision
```

這才能表示 redundancy、synergy 與 alternative explanation。

新增：

```text
MinimalSupportHypergraph
├ support_set
├ sufficient_for
├ minimality_checked
├ replay_count
├ success_rate
├ confidence_interval
└ interaction_score
```

---

## 4. Attestation 可以證明「這份 evidence 是誰產生、是否被改」，不能證明「它讓模型做了這個決策」

AEX 與 AgentPKI 提供非常重要但不同層的能力：

```text
Agent / API identity
↓
Canonical payload
↓
Digest / commitment
↓
Signature
↓
Transform receipts
↓
Verification
```

它回答：

```text
這份 tool result / model response
是否來自聲稱的 issuer？
中途是否被修改？
經過哪些 transform？
```

但 semantic influence 還需要：

```text
Attested Evidence
↓
Counterfactual Replay
↓
Decision Difference
↓
Influence Estimate
```

所以新的 Hermes certificate 必須同時包含「來源證明」與「影響實驗」，且不能混為一談。

---

## 5. Influence Certificate 必須是 scoped claim，而不是「AI 解釋證明」

建議資料結構：

```text
InfluenceCertificate
├ target_decision_id
├ target_action_id
├ evidence_set[]
├ coalition_definition
├ intervention_operator
├ replay_policy
├ value_functions[]
├ individual_attribution[]
├ group_interactions[]
├ minimal_support_sets[]
├ confidence_intervals[]
├ attestation_refs[]
├ provenance_coverage
├ blind_spots[]
├ model_version
├ runtime_version
└ valid_scope
```

它只能聲稱：

> 在指定 agent/model/runtime、intervention、replay policy 與 value function 下，這些 evidence coalitions 對 decision outcome 顯示多少 counterfactual contribution。

它不能直接聲稱：

> 這就是模型內部真正 mechanistic reasoning。

---

# Architecture Breakdown

```text
User / UI / Multimodal Inputs
↓
Context Compiler
├ Memory
├ RAG
├ Tools
├ MCP
├ Policy
└ Sensor Evidence
↓
Observed Provenance DAG
↓
Attestation Verifier
├ issuer identity
├ payload hash
├ transform lineage
└ signature validity
↓
Candidate Evidence Grouper
↓
Coalition Generator
├ single evidence
├ pair groups
├ typed groups
└ sampled coalitions
↓
Counterfactual Replay Engine
├ remove
├ attenuate
├ replace
├ correct
└ freeze-history / run-forward
↓
Multi-Objective Value Evaluator
├ goal success
├ safety
├ factual correctness
├ effect correctness
├ cost
└ latency
↓
Attribution Engine
├ leave-one-out
├ Monte-Carlo Shapley
├ interaction detection
└ confidence interval
↓
Minimal Support Hypergraph Builder
↓
Influence Certificate
↓
Repair / Audit / Security / Visualization
```

---

# Bottom-Level Logic

## A. Coalition intervention

```text
Evidence N = {e1,e2,...,en}

sample coalition S
↓
construct counterfactual context C(S)
↓
replay agent
↓
obtain outcome Y_S
↓
compute v(S)
```

對 tool attribution，不應只「刪掉 tool output」；至少需要區分：

```text
TOOL_UNAVAILABLE
TOOL_AVAILABLE_BUT_NOT_CALLED
TOOL_CALLED_WITH_NULL_RESULT
TOOL_RESULT_REDACTED
TOOL_RESULT_CORRECTED
```

因為這些 intervention 對 planner 的語義完全不同。

## B. Interaction score

可以先以 pairwise residual 作工程 baseline：

```text
I(i,j)
≈
v({i,j})
- v({i})
- v({j})
+ v(∅)
```

若：

```text
I >> 0
```

代表 synergy；若：

```text
I << 0
```

可能代表 redundancy / substitution / conflict。

正式部署再考慮 Shapley interaction index 或 group Shapley。

## C. Attestation envelope

```text
Canonicalize(payload)
↓
H = SHA-256(domain_tag || canonical_payload)
↓
issuer signs H + metadata
↓
Hermes verifies issuer key / passport
↓
store immutable attestation ref
↓
join with semantic influence experiment
```

安全規則：signature valid 只能提高 integrity/authenticity confidence，不能增加 semantic influence score。

---

# Visual Simulation Idea

## Interaction Attribution & Attestation Lab

### View 1 — Coalition matrix

```text
                     coalition value
{Memory}                  .52
{Tool}                    .55
{Policy}                  .61
{Memory,Tool}             .93
{Memory,Policy}           .63
{Tool,Policy}             .66
{M,T,P}                   .95
```

畫面直接顯示：

```text
Memory × Tool
SYNERGY +0.38
```

### View 2 — Minimal Support Hypergraph

```text
Memory M ──┐
           ├══ H1 ══→ Decision
Tool T ────┘

Ledger L ──┐
           ├══ H2 ══→ Decision
Policy P ──┘
```

可切換：

```text
[Individual]
[Coalition]
[Minimal Supports]
[Alternative Supports]
```

### View 3 — Attestation chain

```text
MCP Server
   │ signed result ✓
   ▼
Gateway Transform
   │ receipt ✓
   ▼
Hermes Context
   │ hash ✓
   ▼
Decision Replay
```

並明確分兩欄：

```text
Integrity / Authenticity     ✓
Semantic Influence           0.81 ± 0.07
Factual Truth                NOT ESTABLISHED
```

這個 UI 可以避免使用者把「有簽章」誤解為「內容是真的」或「模型一定因此做決定」。

---

# Code / GitHub

## GenAISHAP/TokenSHAP

Repository：`GenAISHAP/TokenSHAP`

本輪實際確認：

```text
token_shap/agent_shap.py
```

實作：

- baseline with all tools
- essential leave-one-out coalitions
- sampled additional coalitions
- 真實 agent tool loop
- per-coalition tool usage tracking
- embedding similarity against baseline
- shared BaseSHAP Shapley calculation

值得 Hermes 借鑑：coalition execution harness、budgeted combination sampling、tool availability vs actual usage logging。

不應直接照搬：把 baseline-response similarity 當成唯一 value function。

下一步最值得讀：

```text
token_shap/base.py
experiments/agentshap/exp2_faithfulness.py
experiments/agentshap/exp3_scalability.py
experiments/agentshap/exp4_irrelevant_injection.py
```

---

# Papers

## 1. Causal Agent Replay: Counterfactual Attribution for LLM-Agent Failures

- Author: Jaineet Shah
- Year: 2026
- URL: https://arxiv.org/abs/2606.08275
- Architecture: SCM + do-intervention + run-forward replay + contrastive estimator + Monte-Carlo Shapley
- Dataset/validation: synthetic SCM with planted attribution ground truth + agent failure evaluation described by paper
- Contribution: 直接處理 interacting agent steps 的 counterfactual credit
- Limitation: intervention/replay/value choices define what attribution means

## 2. AgentSHAP: Interpreting LLM Agent Tool Importance with Monte Carlo Shapley Value Estimation

- Authors: Miriam Horovicz et al.
- Year: 2025
- URL: https://arxiv.org/abs/2512.12597
- Code: https://github.com/GenAISHAP/TokenSHAP
- Dataset: API-Bank
- Architecture: black-box tool coalitions + Monte-Carlo Shapley
- Contribution: tool-level attribution
- Limitation: attribution is value-function dependent; tool availability and actual tool use are not identical

## 3. AEX: Non-Intrusive Multi-Hop Attestation and Provenance for LLM APIs

- Author: Yongjie Guan
- Year: 2026
- URL: https://arxiv.org/abs/2603.14283
- Architecture: JCS-style canonicalization + commitment + signature + transform receipts + stream hash chain
- Contribution: request-output / transformed-output lineage attestation across API hops
- Limitation: does not prove factuality or semantic causality

## 4. AgentPKI Provenance v0.1

- Project: AgentPKI
- Year: 2026 draft
- URL: https://agentpki.dev/spec/provenance-v0.1/
- Architecture: agent identity + Ed25519 + C2PA assertions/manifests
- Contribution: attested agent/content authorship and transformation lineage
- Limitation: identity/provenance authenticity is distinct from reasoning correctness

---

# Unknown / Open Questions

## 1. Coalition explosion

若 evidence nodes = 40：

```text
2^40
```

不可能 exhaustive replay。

需要研究：

```text
hierarchical grouping
causal-slice pruning
adaptive coalition sampling
sparse interactions
budgeted Shapley
```

## 2. Counterfactual validity

刪掉一個 tool result 可能產生 Agent 從未在真實 distribution 看過的 context。

所以：

```text
Counterfactual Executable
≠
Counterfactual Plausible
```

需要 `InterventionValidityScore`。

## 3. Signed lineage across MCP / subagents

真正 Hermes 會跨：

```text
UI
→ Hermes
→ Subagent
→ MCP
→ SaaS API
→ transformed response
```

若只有其中一段支援 attestation，完整 lineage 還是破的。

需要 `AttestationCoverage` 與 trust-boundary map。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Group Counterfactual Attribution
Coalition Intervention
Coalition Value Function
Monte-Carlo Shapley Attribution
Shapley Interaction
Synergistic Evidence Set
Redundant Evidence Set
Alternative Support Set
Minimal Support Hyperedge
Minimal Support Hypergraph
Intervention Validity
Counterfactual Plausibility
Attested Evidence
Attested Tool Result
Request-Output Attestation
Transform Receipt
Attestation Coverage
Integrity Confidence
Semantic Influence Confidence
Influence Certificate
```

## Edges

```text
Single Ablation ≠ Interaction Attribution
Individual Necessity ≠ Group Necessity
Tool Availability ≠ Tool Usage
Shapley Contribution ≠ Mechanistic Causality
High Attribution ≠ Factual Truth
Response Similarity ≠ Task Correctness
Signed Evidence ≠ True Evidence
Attestation ≠ Semantic Influence
Integrity ≠ Factuality
Minimal Support Set ≠ Unique Support Set
Provenance Path ≠ Provenance Hypergraph
Counterfactual Executable ≠ Counterfactual Plausible
```

---

# 下一輪研究

下一層缺口已經變成：

# **Adaptive Coalition Search × Interaction Sparsity × Counterfactual Validity × Cross-Agent Attestation Chain**

建議下一輪：

```text
Causal Slice
↓
Evidence Clustering
↓
Adaptive Coalition Search
↓
Sparse Interaction Discovery
↓
Intervention Plausibility Check
↓
Budgeted Shapley / Group Attribution
↓
Cross-Agent / MCP Attestation Join
↓
Influence Certificate
↓
Certificate Stability Across Model Versions
```

特別要研究：同一份 certificate 在 model update、prompt compiler update、tool schema update 後是否仍成立。

---

# 本輪結束回答

**缺哪一層？**  
Adaptive Coalition Search + Counterfactual Validity + Cross-Agent Attestation Chain。

**哪個節點最淺？**  
`InterventionValidityScore` 與 `AttestationCoverage`。

**哪個概念仍只是名詞？**  
`InteractionAwareInfluenceCertificate`、`MinimalSupportHypergraph ABI`、`CrossAgentAttestationJoin`、`InfluenceStabilityAcrossVersions`。

**哪個系統值得讀原始碼？**  
第一優先 `GenAISHAP/TokenSHAP` 的 `agent_shap.py / base.py / experiments/agentshap/`；第二優先尋找/追蹤 Causal Agent Replay 的完整開源實作；第三優先 AEX TypeScript reference prototype。

**哪篇論文需追引用？**  
Causal Agent Replay，因為它直接把 Monte-Carlo Shapley 放進 agent counterfactual replay；AgentSHAP 次之。

**哪個概念最適合視覺模擬？**  
Interaction Attribution & Attestation Lab：coalition heatmap + minimal support hypergraph + attestation chain。

**哪個 Agent 架構最值得實作？**  

```text
Interaction-Aware Verifiable Provenance Runtime
=
Typed Provenance DAG
+ Attestation Verifier
+ Coalition Generator
+ Counterfactual Replay Engine
+ Multi-Objective Value Evaluator
+ Monte-Carlo Shapley / Interaction Engine
+ Minimal Support Hypergraph
+ Scoped Influence Certificate
```

本輪對「AI 到底怎麼運作」補上的關鍵一層是：**一個 Agent 的行動往往不是由單一 memory、tool 或 observation 造成，而是多項證據以互補、冗餘或衝突方式共同形成決策。要真正解釋它，不能只逐項刪除資料；必須測試 evidence coalitions、量化 interaction，同時把來源完整性與 semantic influence 分開驗證。**
