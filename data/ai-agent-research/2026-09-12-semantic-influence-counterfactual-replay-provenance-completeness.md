# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 10:56（Asia/Taipei）**  
**本輪主題：Semantic Influence Attribution × Counterfactual Replay × Verifiable Provenance × Tool-Internal Lineage × Provenance Completeness**

---

## 0. 與歷史研究比較：本輪刻意不重複什麼

前一輪已建立：

```text
Execution Event Stream
→ Runtime Read/Write Instrumentation
→ Typed Causal Provenance DAG
→ Dynamic Slice
→ Selective Replay
→ Compensation Safety
```

並留下核心缺口：

```text
Read ≠ Influence
Prompt Presence ≠ Decision Use
Tracked Provenance ≠ Complete Provenance
```

因此本輪不再重做 event log、read-set、dynamic slicing、late-event repair 或 compensation DAG，而是專注回答五個更底層問題：

1. 一個 memory/tool result 被讀入後，怎麼證明它真的影響了決策？
2. 黑盒 LLM 沒有 attention/activation 可看時，怎麼做 semantic influence attribution？
3. provenance 怎麼從「來源看起來合理」升級成「可重現原輸出」？
4. tool 內部與 denied action 的資訊流怎麼納入 provenance？
5. 怎麼量化「這張 provenance graph 到底完整到什麼程度」？

本輪結論：Hermes 下一層不能只有 `ObservedReadEdge`，需要建立 `CounterfactualInfluenceEdge + VerifiableSupportSet + ProvenanceCoverage`。

---

# 本小時新發現

## 新論文 / 新架構

### A. AttriGuard — Action-level Causal Attribution

**Title**: AttriGuard: Defeating Indirect Prompt Injection in LLM Agents via Causal Attribution of Tool Invocations  
**Authors**: Yu He, Haozhe Zhu, Yiming Li, Shuo Shao, Hongwei Yao, Zhihao Liu, Zhan Qin  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2603.10749  
**Architecture**: teacher-forced shadow replay + hierarchical control attenuation + fuzzy survival criterion  
**Contribution**: 把 indirect prompt injection 防禦從「判斷輸入內容是否惡意」改成「判斷 proposed action 究竟是被 user intent 還是 untrusted observation 因果驅動」。  
**Limitations**: 反事實 replay 有額外推理成本；測到的是 action-level causal dependence，不是完整 mechanistic causality；對 stochastic model 必須採 fuzzy criterion。

它對 Hermes 最重要的改變不是安全防禦本身，而是提供一個黑盒 semantic influence test：

```text
Original trajectory
H = (U, O1, A1, O2, A2, ...)

Candidate action At
↓
固定過去 actions A1:t-1
只 attenuation / replace 某組 observations
↓
Shadow Replay
↓
At survives?
```

若 action 在削弱某 evidence 後不再成立，該 evidence 對 action 的 influence 比單純 `READ_FROM` 更強。

---

### B. BLIP — Bolt-on Verifiable Provenance

**Title**: Bolt-on, Verifiable Provenance for LLM-Powered Data Processing  
**Authors**: Yiming Lin, Sepanta Zeighami, Aditya G. Parameswaran  
**Institution**: UC Berkeley  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2608.25210  
**Code**: paper reports a BLIP GitHub artifact; this run verified the paper but did not locate a sufficiently authoritative code repository through GitHub search to audit source internals.  
**Datasets**: seven datasets reported in the paper; public summaries mention Qasper, HotpotQA, CUAD among evaluated workloads.  
**Architecture**: black-box subset search + answer-equivalence verifier + minimality search + adaptive strategy + multi-provenance extension.  
**Contribution**: provenance 不再只是 embedding similarity 或讓 LLM 自己說「我是根據哪段」，而是找一個 input subset，使同一 black-box LLM 在 subset 上仍能 reproduce original answer。  
**Limitations**: reproducibility ≠ factual correctness；semantic-equivalence judge 本身可能錯；最小 provenance 也不一定是人類語義上的唯一真正原因。

底層定義可寫成：

```text
Full input X
LLM(X) = y

find P ⊆ X
such that
Equivalent(LLM(P), y) = true

and P is minimal
```

這讓 Hermes 可把：

```text
SUPPORTED_BY
```

升級成：

```text
REPRODUCIBLY_SUPPORTED_BY
```

---

### C. From Agent Traces to Trust — 2026-09-10 更新版

**Title**: From Agent Traces to Trust: A Survey of Evidence Tracing and Execution Provenance in LLM Agents  
**Authors**: Yiqi Wang et al.  
**Year**: 2026  
**Latest version observed this run**: 2026-09-10  
**URL**: https://arxiv.org/abs/2606.04990  
**Contribution**: 將 execution provenance 定義成 typed execution graph，並將 evidence tracing 視為其中 evidence-support relation 的投影；把 retrieval、tool、memory、intermediate claim、action、final output 納入同一 provenance 視角。

對 Hermes 的影響：要區分「完整 execution graph」與「特定 claim/action 的 evidence projection」。不是每個 trace node 都需要進最終 explainability view。

---

### D. Causality Laundering / Agentic Reference Monitor

**Title**: Causality Laundering: Denial-Feedback Leakage in Tool-Calling LLM Agents  
**Author**: Mohammad Hossein Chinaei  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2604.04035  
**Architecture**: Agentic Reference Monitor (ARM) + provenance graph + field-level provenance + denied-action nodes + integrity lattice + counterfactual edges.  
**Contribution**: denied action 本身也可能產生資訊。即使沒有 tool output，`DENIED` 這個結果仍可能改變後續 benign action，因此 provenance 不能只追 successful dataflow。

---

## 新 GitHub / 工程實作：Causari

**Repository**: https://github.com/croviatrust/causari

本輪不是只讀 README，而是追進：

```text
src/
├ audit.rs
├ capture.rs
├ commit.rs
├ dag.rs
├ index.rs
├ object.rs
├ proof.rs
├ repo.rs
├ seal.rs
├ skill.rs
├ snapshot.rs
└ commands/
```

### `src/object.rs`

其 `Event` schema 已實際保存：

```text
parent
agent
model
tool
message
prompt
reasoning
reads[]
writes[]
tokens_in/out
cost_usd
pre_snapshot
post_snapshot
exit_code
created_at
```

並且 object 採 content-addressing，structured object canonical JSON 後使用 BLAKE3 hash。這非常適合作為 Hermes 的 immutable provenance substrate。

### `src/dag.rs`

Causari 的 event graph 實際上目前仍是：

```text
每個 event 一個 parent
多個 child 可以形成 fork
多 session tips 可共享 ancestry
```

`walk_all()` 會從所有 session tip 回溯、去重 shared ancestry，並建立 parent → children map。

重要限制：

```text
Single Parent Event DAG
≠
Semantic Multi-Parent Causal DAG
```

也就是一個 Planner Decision 同時依賴 memory + tool + vision + policy 時，不能只靠 event.parent 表達完整 dependency。這正好驗證 Hermes 上一輪需要額外 typed causal edge store，而不是直接把 event ancestry 當 semantic causality。

---

# 本小時最重要 5 個發現

## 1. `Read` 只能建立候選 influence，不能建立 semantic influence

### 概念

Agent runtime instrumentation 可以知道：

```text
Memory M7 was read
Tool result T4 was inserted into prompt
Policy P1 was checked
```

但這只能建立：

```text
CandidateInfluenceEdge
```

不能直接建立：

```text
SemanticInfluenceEdge
```

### 底層如何運作

Hermes 應建立三層 edge strength：

```text
LEVEL 1 OBSERVED_ACCESS
X was read / injected / returned

LEVEL 2 BEHAVIORAL_ASSOCIATION
X appears before and correlates with downstream D

LEVEL 3 COUNTERFACTUAL_INFLUENCE
intervene(X) changes D under controlled replay
```

### 為什麼重要

否則 prompt 裡 100 個 retrieved chunks 全都會被誤標成「原因」。這會把 RAG provenance、memory attribution、tool attribution 全部膨脹成沒有判別力的 graph。

### 限制

Counterfactual replay 本身也不是哲學上的因果真理；它依賴 intervention design、model stochasticity、history freezing 與 evaluator。

---

## 2. Semantic influence 的 production 版本應該是「Teacher-Forced Counterfactual Fork」

### 概念

若直接從某個歷史節點重新讓 Agent 自由跑，後續 action sequence 可能完全漂移，無法知道差異是因為被測 evidence，還是因為早期 stochastic branch。

### 底層機制

```text
Original Run
U, O1, A1, O2, A2, O3 → Proposed A3

Counterfactual Fork
U, O1', [force A1], O2', [force A2], O3'
                     ↓
               evaluate A3
```

也就是 replay 歷史 action，使 attribution intervention 只作用在 candidate evidence/control channel。

Hermes 可設計：

```text
CounterfactualReplaySpec
├ target_decision_id
├ frozen_action_prefix[]
├ intervention_targets[]
├ intervention_type
│  ├ REMOVE
│  ├ MASK
│  ├ ATTENUATE_CONTROL
│  ├ CORRECT_VALUE
│  └ SUBSTITUTE
├ seeds[]
├ model_version
├ context_compiler_version
└ evaluator_version
```

### Influence Score

對 stochastic agent 不應只跑一次：

```text
Influence(X → D)
≈ divergence(
    P(D | original),
    P(D | do(attenuate X))
  )
```

可以同時追：

```text
action_survival_rate
argument_divergence
plan_divergence
risk_divergence
cost_divergence
```

---

## 3. Provenance 應從「看起來相關」升級成「可重現」

### 概念

BLIP 的核心提醒是：

```text
Embedding similarity
≠
Verifiable provenance
```

以及：

```text
LLM says "I used passage X"
≠
X can actually reproduce output
```

### Hermes 版本

對 final claim / plan / tool call 可建立：

```text
VerifiableSupportSet
├ source_nodes[]
├ target_output
├ replay_spec
├ equivalence_criterion
├ minimal
├ alternative_support_sets[]
└ verified_at
```

例如：

```text
Claim C17:
"quota is exhausted"

Full context:
M1 M2 T1 T2 T3 P1

Minimal reproducible support:
T2 + P1
```

UI 就能把其他 context 顯示成：

```text
present-but-not-required-for-reproduction
```

而不是全部畫粗線。

### 重要限制

```text
Reproducible Support
≠
Truth
≠
Unique Human Explanation
≠
Mechanistic Neural Cause
```

這個 distinction 必須永久保留在 Knowledge Graph。

---

## 4. Tool-Internal Provenance 不能只停在 ToolCall → ToolResult

目前多數 Agent tracing 只看到：

```text
Agent
→ call search(query)
→ result
```

但真正 tool 內部可能是：

```text
query
↓
API Router
↓
DB shard A + DB shard C
↓
filter
↓
reranker
↓
policy redaction
↓
serialized result
```

因此 Hermes 應允許 tool 回傳 optional lineage envelope：

```text
ToolResultEnvelope
├ value
├ tool_call_id
├ internal_provenance
│  ├ source_records[]
│  ├ transforms[]
│  ├ filters[]
│  ├ policy_decisions[]
│  └ subtool_calls[]
├ integrity
└ provenance_coverage
```

MCP 可進一步擴展為：

```text
Tool Invocation
→ Tool Result
→ optional provenance resource URI / lineage object
```

這是工程提案，不是目前 MCP 標準已定義的必備欄位。

### Denial 也要進 lineage

```text
REQUEST TOOL X
↓
DENIED_BY Policy P
↓
Agent learns "condition probably true"
↓
Calls Tool Y
```

所以：

```text
DeniedToolCall
IS_AN
Information-Bearing Event
```

---

## 5. Hermes 需要正式的 `Provenance Completeness Model`

目前最大的錯覺是：

```text
有 graph
=
有完整 provenance
```

錯。

應拆成 coverage dimensions：

```text
ProvenanceCoverage
├ runtime_event_coverage
├ context_read_coverage
├ memory_read_coverage
├ tool_call_coverage
├ tool_internal_coverage
├ policy_decision_coverage
├ denial_feedback_coverage
├ external_effect_coverage
├ multimodal_source_coverage
├ counterfactual_validation_coverage
└ integrity_coverage
```

例如：

```text
runtime_event       100%
context_read         94%
tool call           100%
tool internal        22%
denial feedback      100%
external effect      61%
counterfactual       14%
```

那 UI 就不應宣稱：

```text
CAUSAL GRAPH VERIFIED
```

而應說：

```text
Observed provenance coverage: HIGH
Semantic influence coverage: LOW
Tool-internal coverage: LOW
```

---

# Architecture Breakdown

```text
UI / User Goal
↓
Agent Runtime
↓
Context Compiler
├ Memory
├ RAG
├ Tool Results
├ MCP Resources
├ Policies
└ Multimodal Evidence
↓
Observed Provenance Instrumentation
├ READ
├ WRITE
├ TOOL CALL
├ TOOL RESULT
├ DENIAL
├ MODEL CALL
├ STATE READ/WRITE
└ EXTERNAL EFFECT
↓
Typed Provenance Graph
↓
Candidate Influence Extractor
↓
Counterfactual Fork Manager
├ Freeze history actions
├ Remove evidence
├ Correct evidence
├ Attenuate control channel
├ Substitute source
└ Repeat over seeds
↓
Semantic Influence Evaluator
├ Action survival
├ Argument divergence
├ Plan divergence
├ Risk divergence
└ Output equivalence
↓
Verifiable Support Search
├ Greedy prune
├ Batch prune
├ Adaptive strategy
└ Multiple minimal support sets
↓
Tool-Internal Lineage Join
↓
Provenance Completeness Auditor
↓
Causal Slice Confidence
↓
Repair / Security / Explainability / Compensation
```

---

# Bottom-Level Logic

## Mechanism A — Counterfactual Influence Test

輸入：

```text
Target decision D
Candidate evidence set E = {e1...en}
Original trajectory H
```

對每個 evidence `ei`：

```text
1. Fork H before target decision
2. Freeze historical actions
3. Apply intervention I(ei)
4. Reconstruct allowed observations/context
5. Query same model/runtime version
6. Repeat K times / seeds
7. Compare decision distribution
8. Save influence edge + confidence + intervention scope
```

概念公式：

```text
I(e → D)
=
Distance(
  P(D | H),
  P(D | do(I(e)), H\e)
)
```

不要把單一 deterministic diff 當唯一指標。

---

## Mechanism B — Minimal Verifiable Support

```text
Full Evidence Set E
↓
Target output y
↓
Try removing subsets
↓
Replay target operation
↓
Equivalent(output, y)?
├ YES → continue pruning
└ NO  → evidence required for this candidate support
↓
minimal support P
```

Hermes 可以把此機制用在：

```text
RAG answer
Planner decision
Tool selection
Safety refusal
Memory-conditioned response
Final claim
```

但 external irreversible action 的 replay 必須在 shadow/sandbox 中完成，不能真的重執行副作用。

---

# Visual Simulation Idea

# **Semantic Influence & Provenance Completeness Lab**

左邊顯示原始 context：

```text
User Goal            █████████  1.00
Memory M7            ██████     read
RAG R2               █████      read
Tool T4              █████████  read
Policy P1            ████████   checked
Denied Tool D3       ███        denial feedback
```

中間切換：

```text
[Observed Reads]
[Counterfactual Influence]
[Minimal Reproducible Support]
[Tool-Internal Lineage]
```

### Observed Reads

```text
M7 ─┐
R2 ─┼→ Planner D9
T4 ─┤
P1 ─┘
```

### Counterfactual Influence

```text
remove M7 → same action        influence .04
remove R2 → same action        influence .02
remove T4 → action changes     influence .88
remove P1 → forbidden action   influence .91
```

Graph 自動變成：

```text
T4 ═════╗
        ╠══→ D9
P1 ═════╝

M7 ─ ─ ─→ D9   weak
R2 ─ ─ ─→ D9   weak
```

### Minimal Support

```text
Original context nodes: 47
Minimal reproducible support: 3

[T4, P1, UserGoal]
```

### Coverage Panel

```text
Runtime events       100% ✓
Context reads         96% ✓
Tool calls           100% ✓
Tool internals        18% ⚠
Policy/denials       100% ✓
External effects      72% ⚠
Counterfactual edges  12% ⚠

STATUS:
Trace complete-ish
Semantic causality partially verified
```

這個 UI 能讓非技術使用者真正理解：

> 「AI 看過哪些資料」和「哪些資料真的改變了 AI 的決策」不是同一件事。

---

# Code / GitHub

## 1. Causari

Repo: https://github.com/croviatrust/causari

值得繼續讀：

```text
src/object.rs
src/dag.rs
src/capture.rs
src/audit.rs
src/snapshot.rs
src/proof.rs
src/commands/
examples/real-session/
```

### 本輪已確認的工程特徵

`object.rs`：
- content-addressed objects
- canonical JSON
- BLAKE3
- Event 保存 prompt/reasoning/reads/writes/pre/post snapshot
- claimed writes 可和 snapshot diff 驗證

`dag.rs`：
- event 有單一 parent
- 多 session tips
- fork ancestry
- `walk_all()` 跨 session 去重並建立 children map

### 值得 Hermes 借鏡

```text
Immutable event object
+
pre/post state snapshot
+
content addressing
```

非常適合做 counterfactual fork 的底層 substrate。

### 不可直接照搬的限制

```text
Event Parent DAG
≠
Semantic Causal DAG
```

Hermes 仍需額外 multi-parent typed edge store。

---

## 2. ChainProof（補充比較）

工程定位是 tamper-evident provenance ledger：收集 event、hash-chain、verify/export，並明確區分 OBSERVED / REPORTED / IMPORTED / DERIVED。

對 Hermes 的主要提醒：

```text
Integrity
≠
Truth
≠
Completeness
≠
Causal Influence
```

這四個維度必須分開顯示。

---

# Papers

## Paper 1
**AttriGuard: Defeating Indirect Prompt Injection in LLM Agents via Causal Attribution of Tool Invocations**  
Authors: Yu He et al.  
Year: 2026  
URL: https://arxiv.org/abs/2603.10749  
Architecture: teacher-forced shadow replay / hierarchical control attenuation / fuzzy survival.  
Change: 把安全判斷從 input semantics 移到 action causality。  
Limitation: replay overhead；仍是 intervention-defined causal attribution。

## Paper 2
**Bolt-on, Verifiable Provenance for LLM-Powered Data Processing**  
Authors: Yiming Lin, Sepanta Zeighami, Aditya G. Parameswaran  
Institution: UC Berkeley  
Year: 2026  
URL: https://arxiv.org/abs/2608.25210  
Architecture: black-box minimal subset search + answer equivalence + adaptive strategies.  
Change: provenance 從 heuristic relevance 升級成 output-reproducibility。  
Limitation: reproduce wrong answer 仍然是 wrong answer；verifiable support ≠ causal truth。

## Paper 3
**From Agent Traces to Trust: A Survey of Evidence Tracing and Execution Provenance in LLM Agents**  
Authors: Yiqi Wang et al.  
Year: 2026; latest version observed 2026-09-10  
URL: https://arxiv.org/abs/2606.04990  
Change: 統一 evidence tracing / execution provenance / tool / memory / retrieval / claims / actions 的 process-accountability vocabulary。

## Paper 4
**Causality Laundering: Denial-Feedback Leakage in Tool-Calling LLM Agents**  
Author: Mohammad Hossein Chinaei  
Year: 2026  
URL: https://arxiv.org/abs/2604.04035  
Change: denied action 本身也是 causal information channel；flat successful-tool provenance 不夠。

## Paper 5（補充）
**SkillTrace: Multi-Trace Provenance Auditing for LLM-Agent Skill Reuse**  
Authors: Jialuo Chen et al.  
Year: 2026  
URL: https://arxiv.org/abs/2608.05204  
Architecture: Expression Trace + Implementation Trace + Operational Trace / Skill Operational Graph.  
Reported benchmark: 820 transformed reuse positives over 100 anchors + 751 negatives; AUROC 0.938, F1 0.898.  
Change: provenance 不一定只有 code identity；agent skill 的 operational procedure/resource-flow 也可成為獨立 trace。

---

# 已確認事實 / 工程實作 / 合理推論 / 未驗證假說

## 已確認事實

- AttriGuard 提出 parallel counterfactual tests、teacher-forced shadow replay、control attenuation。
- BLIP 定義 minimal verifiable provenance，目標是 subset 可以重現原答案。
- Causality Laundering 指出 denied-action feedback 可形成資訊洩漏。
- Causari `Event` 實際有 reads/writes/pre_snapshot/post_snapshot 等欄位。
- Causari `dag.rs` 的 event 只有單一 parent，但多 session 可 fork/shared ancestry。

## 工程實作推論

- Hermes 可以把 immutable event snapshot substrate 和 counterfactual fork 結合。
- 可以對 planner/tool-call/final claim 分別維護 minimal reproducible support set。
- provenance UI 應分開呈現 integrity / coverage / semantic influence。

## 尚未驗證假說

1. `CounterfactualInfluenceScore` 是否能在不同 model version / temperature 下穩定比較。
2. BLIP-style minimal support 是否能直接擴展到多步 agent trajectory，而不造成 combinatorial explosion。
3. Tool-internal provenance 若由第三方 MCP server 自報，如何驗證其 completeness 與 honesty。

---

# Unknown / Open Questions

## 1. Counterfactual intervention 要改多少才不會破壞 task semantics？

完全刪掉 tool result 可能讓 prompt distribution 變得不自然；只 redact instruction 又可能殘留控制訊號。需要建立 intervention taxonomy 與 fidelity metric。

## 2. 多個 evidence 有 interaction 時，單點 ablation 會不會錯判？

可能出現：

```text
E1 alone not necessary
E2 alone not necessary
but {E1,E2} jointly necessary
```

需要 group intervention / Shapley-like approximation / minimal-support search。

## 3. Tool internal lineage 的 trust root 在哪裡？

Tool 自己聲稱：

```text
result came from DB row 17
```

不等於真的來自 row 17。未來需 signed provenance、TEE/attestation、database-native lineage 或 independently observed subtool telemetry。

---

# 下一輪研究

下一輪最值得進入：

# **Group Counterfactual Attribution × Interaction Effects × Shapley/Causal Contribution × Provenance Attestation**

研究鏈：

```text
Candidate Evidence Set
↓
Single-Node Ablation
↓
Group Ablation
↓
Interaction Detection
↓
Minimal Support Hypergraph
↓
Causal Contribution Approximation
↓
Signed / Attested Tool Lineage
↓
Semantic Influence Certificate
```

具體要追：

- evidence interaction / causal contribution approximation
- black-box Shapley-style attribution 對 LLM agent action 的成本控制
- tool result / MCP lineage attestation
- signed provenance envelope
- database/dataflow lineage 與 Agent provenance 的橋接
- semantic influence drift across model/runtime versions

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Semantic Influence Attribution
Candidate Influence Edge
Counterfactual Influence Edge
Teacher-Forced Counterfactual Replay
Shadow Attribution Replay
Control Attenuation
Action Survival Rate
Decision Distribution Divergence
Argument Divergence
Verifiable Provenance
Minimal Verifiable Support
Alternative Support Set
Reproducible Support Edge
Tool-Internal Provenance
Tool Lineage Envelope
Denial Feedback Provenance
Information-Bearing Denial
Provenance Coverage
Semantic Influence Coverage
Tool-Internal Coverage
Provenance Integrity
Provenance Completeness
Influence Certificate
```

## 新增 Edges

```text
ObservedRead
→ CANDIDATE_FOR
SemanticInfluence

CounterfactualReplay
→ VALIDATES
InfluenceEdge

EvidenceSubset
→ REPRODUCES
TargetOutput

DeniedAction
→ MAY_INFLUENCE
LaterAction

ToolInternalSource
→ DERIVED_INTO
ToolResult

ProvenanceCoverage
→ QUALIFIES
CausalSliceConfidence
```

## 新增重要否定關係

```text
Read ≠ Influence
Prompt Presence ≠ Decision Use
Embedding Similarity ≠ Verifiable Provenance
Model Self-Citation ≠ Provenance Verification
Reproducible Support ≠ Factual Truth
Reproducible Support ≠ Mechanistic Neural Cause
Single-Node Ablation ≠ Complete Interaction Attribution
Event Parent ≠ Semantic Causal Parent
Hash Integrity ≠ Provenance Completeness
Provenance Completeness ≠ Causal Correctness
Tool Result Provenance ≠ Tool Internal Provenance
Successful Tool Output ≠ Only Information-Bearing Tool Event
```

---

# 本輪收斂回答

**缺哪一層？** 目前最缺 `Group / Interaction-Aware Semantic Attribution + Provenance Attestation Layer`。

**哪個節點最淺？** `SemanticInfluenceCertificate` 與 `ToolInternalProvenanceCoverage`。

**哪個概念仍只是名詞？** `InfluenceCertificate`、`AttestedToolLineageEnvelope`、`MinimalSupportHypergraph`、`Cross-VersionInfluenceStability`。

**哪個系統值得讀原始碼？** 下一步第一優先是繼續讀 Causari 的 `capture.rs / audit.rs / snapshot.rs / commands/`，確認它實際如何把 hook/proxy/watch 的觀測 join 到 file mutation；其次尋找 BLIP 官方 repo 以深入其八種 minimal provenance search strategies。

**哪篇論文需追引用？** `AttriGuard` 與 `BLIP` 最值得追；前者提供 action-level counterfactual causality，後者提供 black-box verifiable support minimality。

**哪個概念最適合視覺模擬？** `Semantic Influence & Provenance Completeness Lab`：同一張 execution graph 可切換 observed-read / counterfactual-influence / minimal-support / coverage 四個視圖。

**哪個 Agent 架構最值得實作？**

> **Counterfactually-Verified Provenance Runtime = Immutable Event/Snapshot Store + Typed Observed Provenance + Counterfactual Fork Manager + Semantic Influence Evaluator + Minimal Verifiable Support Search + Tool-Internal Lineage Join + Provenance Completeness Auditor + Security/Repair/Explainability Consumers。**

---

# 對「AI 到底怎麼運作」補上的新層

現在從使用者一句話往下，可以進一步還原成：

```text
User says something
↓
UI
↓
Agent Runtime
↓
Context Compiler
├ user intent
├ memory
├ retrieval
├ tool outputs
├ policies
└ multimodal evidence
↓
Model / Planner
↓
Decision / Tool Call
↓
Observed Provenance Graph
↓
Counterfactual Replay
↓
Which context really changed the decision?
↓
Minimal Reproducible Support
↓
Tool / MCP Internal Lineage
↓
Action / External Effect
```

所以「AI 為什麼這樣做」不能只回答：

```text
因為這些資料在 prompt 裡。
```

而應逐步提升到：

```text
它看過哪些資料？
→ 哪些資料在 execution lineage 中？
→ 拿掉哪些資料決策會改變？
→ 哪一小組資料足以重現同一決策？
→ tool 結果內部又來自哪些 records / transforms？
→ 這條 provenance 有多少盲區？
```

這一輪因此把 Hermes 從「可追蹤 Agent」往「可實驗驗證 influence 的 Agent」推進了一層。