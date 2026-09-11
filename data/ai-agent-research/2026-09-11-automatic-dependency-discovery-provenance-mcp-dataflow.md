# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-11 13:56（Asia/Taipei）  
**主題**：Automatic Dependency Discovery × Provenance Graph × Tool/MCP Dataflow × Dynamic Dependency Invalidation  
**延續上一輪**：Task Graph × Dependency Closure × Future-Use Prediction × Causal Memory Retention  
**核心問題**：上一輪已建立「若 dependency graph 已知，如何利用 dependency closure 做安全 retention」；本輪追問更底層的問題：**dependency graph 到底如何從 Agent 程式、Tool/MCP schema、runtime trace、artifact flow、claim evidence 中自動長出來？它又如何隨資料、權限、工具版本與任務生命週期動態失效？**

---

## 0. 本輪與歷史研究比較：避免重複

過去幾輪已完成：

```text
Predictive State
→ State Aliasing
→ Bisimulation / State Abstraction
→ Memory Retention / Eviction
→ Task Dependency DAG
→ Dependency Closure
→ Future-Use Prediction
```

上一輪仍假設：

```text
Task A --REQUIRES→ Evidence B
Tool C --PRODUCES→ Artifact D
```

這些 edges 已存在。

本輪不再研究 retention scoring 本身，而是專注：

```text
Source Code
+ Agent Framework Semantics
+ Tool / MCP Schema
+ Runtime Spans
+ Tool Arguments / Results
+ Artifact IDs / URIs
+ Claim-Level Evidence
+ Permissions / Versions
↓
Automatic Dependency Discovery
↓
Typed Provenance Graph
↓
Confidence / Verification
↓
Dynamic Invalidation / Supersession
↓
Task Dependency Closure / Memory Retention
```

因此本輪補的是上一輪缺失的 **Dependency Discovery Plane**。

---

# 本小時新發現

## 新論文 / 新架構

1. **AgentFlow: Building Agent Dependency Graphs for Static Analysis of Agent Programs** — Shenao Wang, Xinyi Hou, Yanjie Zhao, Xiao Cheng, Haoyu Wang, 2026, arXiv:2607.01640。提出 Agent Dependency Graph（ADG），把 agents、prompts、models、capabilities/tools、memory、control policies 建成 typed nodes，並恢復 component / control-flow / data-flow dependencies。作者在五種代表性 agent frameworks 上實作，並以 AgentZoo 5,399 個真實 agent programs 評估；報告找到 238 個 taint-style prompt-to-tool risks。
2. **AgentTrails: Towards Trust and Reuse for Agentic Tasks** — Eden Wu, Sonia Castelo, Yurong Liu, Cláudio T. Silva, Juliana Freire, 2026, arXiv:2607.18816。將 chronological agent trajectories 轉成 structured provenance graphs：tool calls 作為 computational actions，inputs/outputs 作為 data artifacts；並可把多個 runs 對齊成 joined quotient graph，做重複模式、差異與 skill abstraction。
3. **TRACER: Verifiable Generative Provenance for Multimodal Tool-Using Agents** — Bihui Yu et al., 2026, arXiv:2605.09934。把 provenance 從「tool-call log」推進到「claim-level support graph」：每個 answer sentence 同時輸出 supporting tool turn、evidence unit、relation type（Quotation / Compression / Inference），再做 schema、alignment、source authenticity、relation rationality verification。
4. **OpenTelemetry Semantic Conventions for GenAI / MCP** — 官方規格目前仍標示 Development。它已定義 `invoke_agent`、`execute_tool`、MCP client/server spans、`mcp.method.name`、`gen_ai.tool.name`、`jsonrpc.request.id`、`mcp.resource.uri`、`mcp.session.id`，並明確規範跨 MCP transport 的 trace context propagation。
5. **Governing Dynamic Capabilities: Cryptographic Binding and Reproducibility Verification for AI Agent Tool Use** — Ziling Zhou, 2026, arXiv:2603.14332。提出 capability identity gap：Agent 授權後 tool/capability 可能改變；以 capability manifest hash、interaction ledger 等方式將能力版本與 runtime evidence 綁定。這對本輪的 Dynamic Dependency Invalidation 很重要。

---

# 本小時最重要 5 個發現

## 1. Chronological Trace ≠ Dependency Graph

### 是什麼

一般 Agent log 會長成：

```text
T1 LLM
T2 tool.search
T3 LLM
T4 tool.fetch
T5 tool.write
T6 answer
```

這只表示時間順序。

真正 dependency 需要回答：

```text
T5 的 write
到底使用了 T2 search 的哪個 result？
還是使用 T4 fetch 的 artifact？
T6 answer 的第 3 句
到底依賴哪個 evidence？
```

### 底層如何運作

本輪把 runtime event 拆成：

```text
Operation
├ inputs[]
├ outputs[]
├ control_parent
├ schema
├ tool_identity
├ capability_version
├ session
├ trace/span
└ evidence references
```

再建立：

```text
Artifact A --USED_BY→ ToolCall B
ToolCall B --GENERATES→ Artifact C
Artifact C --SUPPORTS→ Claim D
Permission P --AUTHORIZES→ ToolCall B
Schema S --VALIDATES→ Arguments X
```

AgentTrails 直接指出 chronological trajectory 會遮蔽 underlying dataflow；AgentFlow 則從 source code 靜態恢復 agent-specific dependencies。兩者互補：

```text
Static Graph
= what may depend on what

Runtime Provenance
= what actually depended on what in this run
```

### 為什麼重要

Memory retention、debugging、security taint、artifact reuse、rollback、replay 都不能只靠 timestamp。

### 限制

Runtime tracing 只能看到被 instrumentation 捕捉的 flow；LLM 內部語意依賴並不天然可觀測。

### 狀態

**已確認事實**：OpenTelemetry/MCP 可標準化 operation trace。  
**論文結果**：AgentFlow / AgentTrails 顯示 static + provenance graph 能恢復比 chronological log 更完整的 dependency。  
**合理推論**：Hermes 應將 trace graph 與 dependency graph 分離儲存。

---

## 2. Static Dependency Discovery 與 Runtime Provenance 必須雙軌合併

### AgentFlow 的核心抽象

```text
Source Code
↓
Host-language AST / CFG / DFG
+
Framework Semantics
↓
Agent Dependency Graph (ADG)
```

ADG nodes：

```text
Agent
Prompt
Model
Capability / Tool
Memory State
Control Policy
```

ADG edges：

```text
COMPONENT_DEPENDENCY
CONTROL_FLOW
DATA_FLOW
```

AgentFlow 的關鍵價值在於：agent dependencies 常被框架語意藏在 decorators、agent constructors、handoff declarations、tool registration 等結構裡，傳統 AST/CFG 看不到完整 agent meaning。

### Hermes 應如何用

```text
Compile-time / Deploy-time
Source
→ Static Dependency Extractor
→ PotentialDependencyGraph

Runtime
OTel/MCP spans
→ Runtime Provenance Extractor
→ ActualDependencyGraph

Merge
Potential ∩ Actual
→ ObservedDependency
Potential - Actual
→ DormantCapability
Actual - Potential
→ Dynamic / Unexpected Dependency
```

### 新的重要概念

```text
Potential Dependency
≠ Actual Dependency
```

例如 source code 宣告 tool A，但本次 execution 沒呼叫，不應把 A 的所有 dependencies 當成本輪的 causal chain。

反過來，如果 runtime 出現 source static graph 沒有的 MCP tool：

```text
Actual - Potential ≠ harmless
```

它可能代表 dynamic registration、runtime plugin、capability drift，甚至 security anomaly。

---

## 3. OpenTelemetry + MCP 已足以當「事件骨架」，但還不是完整 provenance graph

### 官方規格目前能記什麼

MCP semantic conventions 已包含：

```text
mcp.method.name
jsonrpc.request.id
mcp.resource.uri
mcp.protocol.version
mcp.session.id
gen_ai.operation.name
gen_ai.tool.name
network.transport
error.type
rpc.response.status_code
```

Opt-in 還可記：

```text
gen_ai.tool.call.arguments
gen_ai.tool.call.result
```

跨 transport tracing：

```text
MCP request
params._meta.traceparent
params._meta.tracestate
params._meta.baggage
↓
server extracts remote parent
↓
MCP client span → MCP server span
```

這比單純 HTTP trace 更準確，因為一個 Streamable HTTP connection 可能承載多個 MCP requests，而單一 MCP request 也可能跨多個 transport attempts/retries。

### 但缺什麼

OTel span 主要回答：

```text
what operation happened?
where?
when?
how long?
which tool?
which error?
```

它不天然回答：

```text
which field in result
became which argument later?

which claim
was supported by which evidence?

which permission token
is still load-bearing?
```

因此：

```text
Distributed Trace
≠ Provenance Graph
```

### Hermes 的推導層

```text
OTel / MCP Trace
↓
Span Normalizer
↓
Argument / Result Field Extractor
↓
Artifact Identity Resolver
↓
Value / ID / URI Flow Matcher
↓
Dependency Edge Proposer
↓
Verifier
↓
Provenance Graph
```

---

## 4. Claim-level Provenance 是「回答依賴圖」與「工具依賴圖」之間缺失的橋樑

TRACER 指出，多模態 tool-using agent 即使保存完整 tool trajectory，也通常不知道「哪一句 answer 由哪個 tool observation 支持」。

它把每句生成改為：

```text
Sentence
+
ProvenanceRecord
├ supporting_tool_turn
├ evidence_unit
└ relation
   ├ Quotation
   ├ Compression
   └ Inference
```

再驗證：

```text
Schema Check
→ Tool-Turn Alignment
→ Source Authenticity
→ Relation Rationality
```

Hermes 因此不應只建立：

```text
ToolCall → ToolResult
```

而應一路連到：

```text
ToolResult.field
→ EvidenceUnit
→ IntermediateBelief
→ PlanDecision
→ ToolArgument
→ FinalClaim
```

### 為什麼重要

如果 Answer Claim C 依賴 Evidence E，而 E 被 invalidated：

```text
E INVALID
↓
Claim C DIRTY
↓
Dependent Plan / Memory Summary DIRTY
↓
Recompute / Reverify
```

這是下一步做 dynamic invalidation 的基礎。

### 論文結果

TRACER 在 TRACE-Bench 上報告 Qwen3-VL-8B 達到 78.23% answer accuracy 與 95.72% summary accuracy，並比 tool-only SFT 減少 total test-set tool calls（4949 → 3486）。

### 限制

Claim-level provenance record 仍可能被模型錯綁，因此 provenance 不能只有 generation，還要 verifier。

---

## 5. Dependency Graph 必須是 versioned、typed、可失效的動態結構

上一輪 graph 偏向：

```text
A REQUIRES B
```

本輪加入 lifecycle semantics：

```text
A REQUIRES B@v3
B@v3 SUPERSEDED_BY B@v4
Permission P EXPIRES
Tool schema S@12 CHANGED_TO S@13
Resource URI R UPDATED
MCP capability manifest HASH CHANGED
```

因此 edge 必須有：

```text
DependencyEdge
├ type
├ source_id
├ target_id
├ created_at
├ observed_at
├ confidence
├ derivation_method
├ valid_from
├ valid_until
├ version_scope
├ evidence_span_ids[]
├ verifier_status
└ invalidation_policy
```

### Invalidation bottom-level loop

```text
Resource / Tool / Permission / Artifact Changes
↓
Identity + Version Resolver
↓
Find dependent edges
↓
Transitive Reverse Closure
↓
Mark nodes
├ STALE
├ INVALID
├ NEEDS_REVERIFY
└ UNAFFECTED
↓
Planner / Memory / Claims
↓
Selective Recompute
```

### 關鍵安全問題

2026 capability-governance 研究指出，MCP/A2A 的 dynamic capabilities 可能在 authorization 後改變，造成 capability-identity gap。

因此：

```text
Tool Name Same
≠ Tool Capability Same
```

Hermes 應保存至少：

```text
tool_name
server_identity
schema_hash
capability_manifest_hash
protocol_version
permission_scope
observed_behavior_version
```

---

# Architecture Breakdown

## Hermes Dependency & Provenance Plane v0

```text
              ┌─────────────────────────────┐
              │  Agent Source / Framework   │
              └──────────────┬──────────────┘
                             ↓
                 Static Dependency Extractor
                             ↓
                 Potential Agent Dependency Graph
                             │
                             │
User / UI                    │
↓                            │
Agent Runtime                │
├ LLM                        │
├ Planner                    │
├ Memory                     │
├ Tool Router                │
└ MCP Host/Client            │
↓                            │
OpenTelemetry / MCP Spans    │
↓                            │
Runtime Trace Normalizer     │
↓                            │
Operation / Artifact Events  │
↓                            │
Argument-Result Dataflow Extractor
├ exact ID/URI match
├ structured field match
├ schema lineage
├ artifact hash
├ semantic support
└ explicit provenance refs
↓
Dependency Edge Proposer
↓
Dependency Verifier
├ schema-valid?
├ temporally possible?
├ source authentic?
├ dataflow consistent?
├ claim support valid?
└ permission valid?
↓
Typed Provenance Graph
├ Agent nodes
├ ToolCall nodes
├ ModelCall nodes
├ Artifact nodes
├ Resource nodes
├ Permission nodes
├ Claim nodes
├ Memory nodes
└ Task/Subgoal nodes
↓
Dynamic Invalidation Engine
├ update
├ revoke
├ supersede
├ expire
├ schema change
└ capability drift
↓
Reverse Dependency Closure
↓
Selective Recompute / Reverify
↓
Memory Retention + Context Compiler
```

---

# Bottom-Level Logic

## A. Tool dependency discovery

不能只說「Agent 呼叫工具」，需要拆成：

```text
Intent
→ Tool Schema Discovery
→ Tool Selection
→ Argument Construction
→ Tool Call
→ MCP / Function Execution
→ Structured Result
→ Result Field Selection
→ Context Injection
→ Next Decision
```

真正 dataflow edge 應落在欄位級：

```text
search.result[2].url
--FLOWS_TO→
fetch.arguments.url
```

而不是粗糙地：

```text
search --BEFORE→ fetch
```

## B. Field-level provenance matcher

Hermes 可採分層 confidence：

```text
Level 1: Explicit ID / URI / hash match
confidence ≈ very high

Level 2: Structured field copy / normalized value match
confidence = high

Level 3: Schema + temporal + semantic alignment
confidence = medium

Level 4: LLM-inferred dependency
confidence = low until verified
```

候選 edge：

```text
score(e)
=
α exact_identity
+ β structural_match
+ γ temporal_validity
+ δ schema_compatibility
+ ε semantic_support
+ ζ explicit_reference
```

但：

```text
High score ≠ Causal Proof
```

## C. Dependency verification

```text
Candidate edge X → Y
↓
Counterfactual replay if possible
Remove / replace X
↓
Re-run Y
↓
Y output changes materially?
```

可分：

```text
ObservedDependency
InferredDependency
VerifiedDependency
CounterfactuallySupportedDependency
```

這延續前面研究的核心原則：

```text
Temporal adjacency ≠ causality
```

## D. Dynamic invalidation

如果：

```text
Resource R@v1
→ Summary M
→ Plan P
→ ToolCall T
→ Claim C
```

後來：

```text
R@v1 SUPERSEDED_BY R@v2
```

則：

```text
invalidate(R@v1)
↓
reverse_closure(R@v1)
↓
M = NEEDS_REVERIFY
P = STALE
T = HISTORICAL_VALID_BUT_NOT_REPLAY_SAFE
C = NEEDS_REVERIFY
```

不能把所有 downstream node 都直接刪掉，因為「當時正確」與「現在仍有效」是兩種語義。

新增：

```text
Historical Validity
≠ Current Validity
```

---

# Visual Simulation Idea

## **Agent Provenance & Dependency Graph Lab**

### View 1：Chronological Trace

```text
13:01 LLM plan
13:01 search_web
13:02 fetch_page
13:02 MCP read_resource
13:03 write_file
13:03 final_answer
```

使用者按：

```text
CONVERT TO DEPENDENCY GRAPH
```

### View 2：Dataflow / Provenance Graph

```text
Query Q
  ↓
Search Call S
  ↓
URL artifact U ─────────────┐
                           ↓
                      Fetch Call F
                           ↓
                      Evidence E
                           ↓
             ┌─────────────┴────────────┐
             ↓                          ↓
         Claim C1                  Plan P2
                                      ↓
                               MCP Tool Call T
                                      ↓
                                Artifact A
```

### View 3：Static vs Runtime Overlay

```text
STATIC POTENTIAL     RUNTIME ACTUAL
Tool A  ────────     Tool A ✓
Tool B  ────────     Tool B unused
Tool C  absent       Tool C ⚠ dynamic
```

顯示：

```text
Unexpected Runtime Capability
Tool C
source: dynamic MCP registration
schema hash: 94a...
permission: inherited
risk: NEEDS REVIEW
```

### View 4：Invalidation Ripple

使用者點：

```text
REVOKE Resource R@v1
```

圖上即時傳播：

```text
R@v1        INVALID
 ↓
Summary M   NEEDS REVERIFY
 ↓
Plan P      STALE
 ↓
Claim C     NEEDS REVERIFY
```

但：

```text
Historical Tool Call T
= PRESERVED AS HISTORICAL RECORD
```

### View 5：Claim-level provenance

點 answer sentence：

```text
「MCP resource 已在本輪更新。」
```

展開：

```text
Claim
↓ INFERENCE
Evidence Unit #E18
↓ FROM
MCP tools/call span #s44
↓ RESULT FIELD
result.version
↓ SOURCE
server X / resource URI Y
```

---

# Code / GitHub

## 1. OpenTelemetry `semantic-conventions-genai`

**Repository**：https://github.com/open-telemetry/semantic-conventions-genai  
**本輪已深入讀取**：`docs/gen-ai/mcp.md`

值得繼續追：

```text
docs/gen-ai/mcp.md
docs/gen-ai/gen-ai-spans.md
docs/registry/attributes/mcp.md
docs/registry/attributes/gen-ai.md
```

已確認的重要工程語義：

```text
MCP client/server spans
params._meta trace propagation
execute_tool compatibility
mcp.method.name
gen_ai.tool.name
jsonrpc.request.id
mcp.resource.uri
mcp.session.id
protocol / transport attributes
```

**重要限制**：官方文件明確標示 GenAI/MCP convention 仍為 Development；Hermes 若採用必須保存 schema/spec version，不能假設欄位永久不變。

## 2. AgentFlow

Paper：https://arxiv.org/abs/2607.01640  
Code：本輪公開搜尋未確認到作者官方 code repository，因此不能假稱已讀到其 implementation。  
值得未來追：framework adapters、ADG node/edge IR、taint analysis pipeline。

## 3. AgentTrails

Paper：https://arxiv.org/abs/2607.18816  
核心工程抽象：trajectory → computational actions + artifacts → provenance graph → multi-run alignment / quotient graph。  
本輪未確認官方公開 code，因此將其架構視為論文結果，不當成已驗證 implementation。

## 4. TRACER

Paper：https://arxiv.org/abs/2605.09934  
Dataset：TRACE-Bench  
核心：sentence-level provenance reconstruction from multimodal tool trajectories。  
本輪未確認官方 repo，因此 code 欄標記 **未驗證**。

---

# Papers

## Paper A — AgentFlow

- **Title**：AgentFlow: Building Agent Dependency Graphs for Static Analysis of Agent Programs
- **Authors**：Shenao Wang, Xinyi Hou, Yanjie Zhao, Xiao Cheng, Haoyu Wang
- **Institution**：本輪 arXiv metadata/search results 未可靠確認，避免猜測
- **Year**：2026
- **URL**：https://arxiv.org/abs/2607.01640
- **Code**：未確認官方 repository
- **Dataset / Corpus**：AgentZoo，5,399 real-world agent programs
- **Architecture**：Source code + framework semantics → typed Agent Dependency Graph → governance/security analyses
- **Contribution**：恢復傳統 AST/CFG/DFG 難以表示的 agent-specific dependencies
- **Limitations**：static analysis 只表示可能依賴，不代表本輪實際 runtime dependency；對高度動態註冊、反射、remote MCP capabilities 仍需要 runtime evidence
- **改變了什麼**：讓 Agent 系統第一次可用類似 compiler/static-analysis 的方式建立 Agent BOM 與 prompt-to-tool dependency path

## Paper B — AgentTrails

- **Title**：AgentTrails: Towards Trust and Reuse for Agentic Tasks
- **Authors**：Eden Wu, Sonia Castelo, Yurong Liu, Cláudio T. Silva, Juliana Freire
- **Year**：2026
- **URL**：https://arxiv.org/abs/2607.18816
- **Code**：本輪未確認
- **Dataset**：real-world agent trajectories（paper demo）
- **Architecture**：trajectory → action/artifact provenance graph → shared canvas → joined quotient graph → patterns / reuse
- **Contribution**：把 log timeline 轉為 artifact-centered provenance structure
- **Limitations**：trajectory 中未被捕捉的 semantic dependency 仍可能缺失；provenance extraction correctness 需要獨立 validation
- **改變了什麼**：讓多個 agent executions 可以按 dependency structure 比較，而不只比較 token log 或步驟序列

## Paper C — TRACER

- **Title**：TRACER: Verifiable Generative Provenance for Multimodal Tool-Using Agents
- **Authors**：Bihui Yu, Caijun Jia, Jing Chi, Xiaohan Liu, Yining Wang, He Bai, Yuchen Liu, Jingxuan Wei, Junnan Zhu
- **Year**：2026
- **URL**：https://arxiv.org/abs/2605.09934
- **Code**：本輪未確認
- **Dataset**：TRACE-Bench
- **Architecture**：answer sentence + provenance record → schema/alignment/authenticity/relation verifier → traceability constraint / local credit
- **Contribution**：把 tool trajectory 的 coarse provenance 推進到 claim-level support
- **Limitations**：provenance record 本身由模型產生，若 verifier 不夠強仍可形成錯誤 attribution
- **改變了什麼**：將「有引用」提升成「生成時同步產生、可驗證的支持關係」

## Paper D — Governing Dynamic Capabilities

- **Title**：Governing Dynamic Capabilities: Cryptographic Binding and Reproducibility Verification for AI Agent Tool Use
- **Author**：Ziling Zhou
- **Year**：2026
- **URL**：https://arxiv.org/abs/2603.14332
- **Architecture**：capability-bound certificates + manifest hash + verifiable interaction ledger + replay verification
- **Contribution**：處理 authorization 後 capability/tool silently changing 的 identity gap
- **Limitations**：cryptographic identity 能證明「能力 manifest 有沒有變」，不能單獨證明 tool semantic behavior 完全符合宣告
- **改變了什麼**：把 tool identity 從名稱/endpoint 提升成 versioned capability identity

---

# 已確認事實 / 官方資訊 / 論文結果 / 工程實作 / 推論 / 假說

## 已確認官方資訊

- OpenTelemetry GenAI/MCP semantic conventions 目前標示 Development。
- MCP tracing 可透過 `params._meta` 傳遞 W3C trace context。
- MCP tool calls 可與 GenAI `execute_tool` spans 對齊。
- `mcp.method.name`、`gen_ai.tool.name`、`mcp.resource.uri`、`mcp.session.id` 等可成為 runtime identity/evidence anchor。

## 論文結果

- AgentFlow：ADG 可恢復 agent-specific dependencies，並於 AgentZoo 找到 238 個 prompt-to-tool taint-style risks。
- AgentTrails：provenance graph 能呈現 chronological log 隱藏的 artifact dependencies。
- TRACER：claim-level provenance + verification 可提升 grounded multimodal tool reasoning，並減少無效 tool calls。

## 已確認工程實作

- 本輪已直接讀取 OpenTelemetry `semantic-conventions-genai/docs/gen-ai/mcp.md` 原始 repository file。

## 合理推論

- Hermes 應建立 Static Potential Graph + Runtime Actual Graph + Claim Provenance Graph 三層，而不是用單一 trace graph 承載全部語義。
- Memory retention 應由 verified dependency closure 驅動；低可信 inferred edges 不應直接成為永久 pin。

## 尚未驗證假說

- 將 field-level dataflow + claim-level provenance + static ADG 合併後，是否能可靠預測 long-horizon future-use 尚未有統一 benchmark。
- 依賴 graph 的 counterfactual edge verification 在高成本 tool / irreversible action 下如何安全執行仍未解決。

---

# Unknown / Open Questions

## 1. 如何辨識「語意使用」而不是值剛好相同？

```text
Tool A output = "Taipei"
Tool B argument = "Taipei"
```

相同字串不代表 B 真的依賴 A。

需要：

```text
value flow
+
context lineage
+
explicit reference
+
counterfactual replay
```

## 2. Dependency confidence 如何校準？

需要 benchmark：

```text
Predicted edge
vs
Ground-truth causal/data dependency
```

並拆：

```text
precision
recall
false retention cost
false eviction cost
```

## 3. Dynamic MCP server/tool 更新後，哪些 downstream artifacts 必須重算？

工具版本變化不一定讓所有舊結果失效。需要：

```text
ChangeSet
→ Affected Schema/Behavior Region
→ Dependency Slice
→ Selective Revalidation
```

而不是 full invalidation。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Automatic Dependency Discovery
Potential Dependency Graph
Actual Runtime Dependency Graph
Agent Dependency Graph
Typed Provenance Graph
Provenance Record
Data Artifact
Evidence Unit
Claim Provenance
Field-Level Dataflow
Static Dependency Extractor
Runtime Provenance Extractor
Artifact Identity Resolver
Dependency Edge Proposer
Dependency Verifier
Dependency Confidence
Capability Identity
Capability Manifest Hash
Schema Version
Resource Version
Historical Validity
Current Validity
Dynamic Invalidation
Reverse Dependency Closure
Selective Reverification
Unexpected Runtime Capability
Dormant Capability
Provenance Gap
```

## Edges

```text
Agent --USES→ Tool
Prompt --CONDITIONS→ ModelCall
ToolCall --CONSUMES→ Artifact
ToolCall --GENERATES→ Artifact
Artifact.field --FLOWS_TO→ ToolArgument.field
Resource --SUPPORTS→ EvidenceUnit
EvidenceUnit --SUPPORTS→ Claim
Permission --AUTHORIZES→ ToolCall
Schema --VALIDATES→ ToolArgument
CapabilityManifest --IDENTIFIES→ ToolCapability
ResourceVersion --SUPERSEDES→ ResourceVersion
ChangeEvent --INVALIDATES→ DependencyEdge
DependencyEdge --JUSTIFIES_RETENTION_OF→ Memory
RuntimeSpan --EVIDENCES→ DependencyEdge
StaticADGEdge --PROPOSES→ PotentialDependency
CounterfactualReplay --VERIFIES→ DependencyEdge
```

## 否定 / 區分 edges

```text
Chronological Order ≠ Dependency
Trace Span ≠ Provenance Edge
Static Dependency ≠ Runtime Dependency
Value Equality ≠ Dataflow
Semantic Similarity ≠ Causal Use
Tool Name ≠ Capability Identity
Same Endpoint ≠ Same Tool Behavior
Historical Validity ≠ Current Validity
Observed Dependency ≠ Verified Dependency
Provenance Generation ≠ Provenance Verification
Artifact Retained ≠ Dependency Preserved
Distributed Trace ≠ Claim Support Graph
```

---

# 下一輪研究

本輪解決：

```text
Dependency graph 怎麼開始自動建立？
```

下一個最深缺口變成：

# **Provenance Truth × Dependency Verification × Taint Propagation × Counterfactual Dataflow Validation**

也就是不能只停在：

```text
系統猜 A → B 有 dependency
```

下一輪應深入：

```text
Candidate Dependency Edge
↓
Static Evidence
+
Runtime Value Flow
+
Trace Parentage
+
Claim Support
↓
Taint Propagation
↓
Counterfactual Replay
├ remove source
├ perturb source
├ substitute source
└ replay downstream step
↓
Effect Measurement
↓
Verified / Rejected / Ambiguous Edge
↓
Dependency Certificate
```

優先研究方向：

1. Dynamic taint tracking for tool-using agents / prompt-to-tool flows。
2. Information-flow control 與 provenance semirings。
3. OpenLineage / W3C PROV / database provenance 與 Agent provenance 的可借用結構。
4. Counterfactual replay / deterministic tool replay / artifact snapshots。
5. Prompt injection propagation：untrusted resource → context → model → tool argument 的完整 taint chain。
6. 如何將 MCP tool/resource provenance 與安全 policy enforcement 綁在同一 graph。

---

# 每輪結束必答

**缺哪一層？**  
目前最缺的是 **Dependency Verification / Provenance Truth Plane**：我們已能建立 candidate graph，但還缺可校準、可反駁的 edge truth。

**哪個節點最淺？**  
`DependencyConfidence` 最淺，尤其是「LLM 語意上使用了某段 evidence」但沒有 exact ID/field copy 時。

**哪個概念仍只是名詞？**  
`DependencyCertificate`、`SelectiveRevalidation ABI`、`CapabilityBehaviorHash` 仍是 Hermes 的工程設計概念，尚未形成跨框架標準。

**哪個系統值得讀原始碼？**  
第一優先：`open-telemetry/semantic-conventions-genai` 的 MCP / execute_tool / agent spans；若 AgentFlow 官方 code 公開，下一輪應優先讀 framework adapters 與 ADG builder。

**哪篇論文需追引用？**  
AgentFlow（static ADG）→ AgentTrails（runtime provenance）→ TRACER（claim-level provenance）這條引用鏈最值得追，因為三者剛好構成 compile-time / runtime / generation-time 三層 dependency。

**哪個概念最適合視覺模擬？**  
`Agent Provenance & Dependency Graph Lab`：尤其是「trace timeline → dependency graph → invalidation ripple」三視圖同步。

**哪個 Agent 架構最值得實作？**  

> **Provenance-Native Agent Runtime = Static ADG Extractor + OpenTelemetry/MCP Runtime Tracer + Artifact Identity Resolver + Field-Level Dataflow Extractor + Claim-Level Provenance + Dependency Verifier + Versioned Provenance Graph + Dynamic Invalidation Engine + Reverse Dependency Closure + Memory/Context Retention Interface**

---

# 本輪收斂

前一輪讓 Hermes 知道：

```text
未來任務依賴什麼，所以不要亂刪記憶。
```

本輪把問題再往下一層：

```text
這個「依賴」不能靠人手寫、時間順序或語意相似度猜。
它必須從 source、framework semantics、tool schema、MCP trace、arguments/results、artifacts、claims 與 versions 中被自動提取，並且可被驗證與失效。
```

因此真正成熟的 Agent memory / provenance / security 系統應從：

```text
LOG EVERYTHING
```

進化成：

```text
TRACE
→ RESOLVE IDENTITY
→ EXTRACT DATAFLOW
→ BUILD DEPENDENCY
→ VERIFY
→ VERSION
→ INVALIDATE
→ RECOMPUTE ONLY WHAT CHANGED
```

這一層完成後，Hermes 才能更可靠地回答：**「這個回答、這個計畫、這個 tool call、這段記憶到底是從哪裡來的；上游一旦改變，究竟哪一些 downstream 結論必須重新驗證？」**
