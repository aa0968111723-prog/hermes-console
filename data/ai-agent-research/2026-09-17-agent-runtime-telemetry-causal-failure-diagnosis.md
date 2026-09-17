# 【AI Agent × Multimodal Research Report】

**時間：2026-09-17 17:52（Asia/Taipei）**  
**主題：Agent Runtime Telemetry × Causal Failure Localization × Typed Invariants × Recovery Gate**

## 與歷史研究比較

上一輪已把 NIXL/etcd 的 Watcher object、stream liveness、revision coverage 與 metadata freshness 拆開，得到 `WatcherObjectPresent ≠ WatchStreamAlive ≠ RevisionCoverageProven ≠ MetadataFresh`。本輪不再重複 Watcher 細節，而把這個 correctness pattern 上推到 Agent Runtime：**HTTP 200、tool call completed、agent step emitted、甚至 final answer produced，都不能證明整條 execution trajectory 正確。**

本輪以三套 2026 failure-diagnosis 工作交叉驗證：AgentChaosBench（runtime telemetry + fault injection）、AgentRx（trajectory constraints + auditable validation log）、AGENTSCOPE（behavioral abstraction + neural invariants）。它們共同指出 Agent reliability 應建模為「整條 execution 的可觀測 invariant」，而非只看最終答案。

## 本小時新發現

### 新架構：Telemetry → Typed Event Graph → Invariant Engine → Causal Diagnosis → Recovery

Hermes 可建立統一 execution observability plane：

```text
Raw Runtime Events
  ├ model call
  ├ tool/MCP call
  ├ A2A delegation
  ├ guardrail
  ├ memory/context mutation
  ├ browser/computer action
  └ infrastructure/capability event
        ↓
Canonical Typed Event IR
        ↓
Dependency / Causality Graph
        ↓
Invariant Evaluation
        ↓
Candidate Failure Set
        ↓
Root / Decisive Failure Localization
        ↓
Recovery Policy
        ↓
Retry / Replan / Rebind / Resnapshot / Human Escalation
```

### 新 benchmark：AgentChaosBench

**Title:** When Agentic Executions Fail: Detecting and Localizing Runtime Faults from Telemetry  
**Authors:** Chenkai Zhang, Yiran Li, Yifang Tian, Michalis Bachras, Hans-Arno Jacobsen  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2608.14680  
**Code:** https://github.com/kevinzck8k/agentic-fault-diagnosis  
**Dataset:** 275 sanitized traces；250 faulty + 25 no-fault controls  
**Architecture:** 5 heterogeneous A2A/MCP applications + telemetry capture + ten operational fault types + RCA evaluation  
**Contribution:** 將 unavailable/slow tool、corrupted/oversized response、delayed/looped/misrouted delegation、guardrail bypass 等 runtime faults 變成可重現的 detect-and-localize benchmark。  
**Limitations:** zero-shot LLM diagnosis 仍弱；single trace 對 reference-dependent faults 特別困難。

### 新論文：AgentRx

**Title:** AgentRx: Diagnosing AI Agent Failures from Execution Trajectories  
**Authors:** Shraddha Barke, Arnav Goyal, Alind Khare, Avaljot Singh, Suman Nath, Chetan Bansal  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2602.02475  
**Code:** https://github.com/microsoft/AgentRx  
**Dataset:** 115 annotated failed trajectories，涵蓋 API workflows、incident management、web/file tasks  
**Architecture:** trajectory → synthesized constraints → stepwise validation → auditable violation log → LLM judge → critical failure step/category  
**Contribution:** 把 failure attribution 從「讓 LLM 看整段 log 猜原因」改成 constraint-driven evidence accumulation。  
**Limitations:** 仍依賴 LLM 做部分 constraint synthesis / judgment，且 benchmark 規模有限。

### 新論文：AGENTSCOPE

**Title:** Diagnosing with Insights: Structured Analysis of Agent Failures via Behavioral Abstractions  
**Authors:** Jiayi Bi, Yanjie Gao, Yuanmin Xie, Liqun Li, Tianyin Xu, Fan Yang, Mao Yang  
**Institution:** Microsoft Research 等作者機構  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2609.02371  
**Dataset:** Who&When + AgentErrata  
**Architecture:** raw trajectory → structured behavioral representation / Reasoning-Action Graph → neural invariants → LLM-guided decisive error judgment  
**Contribution:** 使用 neuro-symbolic abstraction 避免 monolithic LLM judge 在長 trajectory 中混淆症狀與 root cause。  
**Limitations:** neural invariant 本身仍是 learned/semantic judgment，不具有傳統 formal invariant 的硬保證。

## 本小時最重要 5 個發現

### 1. Agent reliability 是 execution property，不是 final-answer property

**已確認（論文/benchmark）：** AgentChaosBench 明確把 model calls、tool calls、guardrails、inter-agent messages 都視為 reliability surface。其 zero-shot baseline 顯示 single-trace fault-type top-1 仍很低，joint type+location 更低，說明「看完整 log 讓 LLM 猜」並不足夠。

**Hermes 推論：** Console 應將 run outcome 與 execution health 分開：

```text
TaskSuccess
ExecutionIntegrity
SafetyIntegrity
FreshnessIntegrity
PermissionIntegrity
```

final answer 正確也可能伴隨 unsafe side effect；final answer 錯也可能是 upstream tool/runtime fault，而非 model reasoning fault。

### 2. Structured telemetry 比 raw trace 更適合 causal diagnosis

AgentChaosBench GitHub 的 `rca_batch.py` 支援 raw 與 structured view；structured view 把每個 span 壓成 `span_id / kind / name / level / duration / output size / repeat count`，再要求 detector 引用 exact span/component。這是一個很實際的 bottom-level mechanism：

```text
Raw span JSON
→ canonical span identity
→ normalize duration/output/repeat metadata
→ compact structured event
→ diagnosis prompt/model
→ ranked fault candidates
→ component/span localization
```

`rca_localization.py` 又對 component name 做 canonicalization，將 `tool_call`、`a2a_call_`、`._use` 等 trace naming decoration 去掉，再算 Loc@1 / Loc@3 / Joint(type+location)。這說明 observability IR 必須先解決 identity normalization，否則同一 component 會因 instrumentation naming 而被錯判。

### 3. Invariant violation 應成為 model reasoning 與 runtime failure 的共同語言

AgentRx：constraint → step-by-step validation → violation evidence。  
AGENTSCOPE：behavior abstraction → neural invariant → decisive error judgment。  
Hermes 既有 Watcher 研究：WatchCoverageProof / RevisionCoverage / ServingFreshness 其實也是 runtime invariant。

因此可統一：

```text
Invariant
├ semantic: action aligned with intent?
├ control-flow: unexpected loop / premature stop?
├ tool: schema/arguments/result valid?
├ security: permission/guardrail preserved?
├ freshness: observation stream coverage proven?
├ distributed-state: generation/revision coherent?
└ infrastructure: capability still live?
```

### 4. Symptom step、first error、decisive error、root cause 必須分開

長 Agent trajectory 中：

```text
Tool latency fault @ step 7
→ planner receives partial/late observation @ step 8
→ wrong delegation @ step 10
→ invalid action @ step 12
→ final task failure @ step 18
```

若只標最後 invalid action，修復會錯層。Hermes 應建立：

```text
FaultInjection / RootCause
→ Propagation Edge
→ FirstObservableViolation
→ DecisiveFailure
→ UserVisibleSymptom
```

這比單一 `error=true` 更接近 causal debugging。

### 5. Reference execution 是一級診斷資源，但不是萬能

AgentChaosBench 的 paired mode 會給 detector 同一輸入的 known-normal reference，讓模型比較 errors、duration、output size、call count、routing、content。論文結果顯示 reference 對部分 relative fault 有幫助，但 guardrail bypass 仍難。

因此 Hermes 可以保存：

```text
Current Trace
+ Golden / Previous Healthy Trace
+ Expected Invariants
→ Delta Graph
→ Candidate Causes
```

但 security invariant 不能只靠「與正常 run 看起來像不像」，因為 silent guardrail bypass 可能不造成明顯 telemetry delta。

## Architecture Breakdown

### Agent Runtime Causal Observability Plane

```text
User Request
→ Run ID / Trace Root
→ Planner / Model Span
→ Context Snapshot
→ Tool Selection
→ MCP Request
→ Tool Runtime Span
→ Observation
→ Memory Mutation
→ A2A Delegation
→ Guardrail Decision
→ Next Model Decision
→ Final Output

parallel telemetry plane:
Every transition
→ Typed Event
→ entity/component identity
→ parent/span/dependency ids
→ timing
→ input/output hashes or safe summaries
→ permission/freshness/generation metadata
→ invariant engine
→ violation graph
→ causal diagnosis
```

Hermes 不應只保存線性 chat log；至少要能表示 data dependency、control dependency、delegation dependency、capability dependency。

## Bottom-Level Logic

### Tool Calling 的診斷鏈

```text
Intent
→ Tool Schema visible?
→ Tool Selection
→ Argument Construction
→ Permission Gate
→ Execution
→ Transport status
→ Result parse
→ Observation accepted
→ Context injection
→ Next decision
```

每一箭頭都可產生不同 fault：wrong tool、malformed args、permission bypass、timeout、corrupt response、oversized response、stale observation、parse loss、context omission。

### A2A delegation 的診斷鏈

```text
Task decomposition
→ target-agent selection
→ delegation message
→ route
→ remote execution
→ response
→ correlation to parent task
→ merge into planner state
```

fault 可是 delayed、looped、misrouted；這些不能只靠 final answer 定位。

### Typed Invariant evaluation

```text
Event e_i
→ normalize identity
→ resolve dependencies
→ evaluate local invariant
→ evaluate relational invariant against parent/reference
→ emit Evidence{event, invariant, status, confidence}
→ propagate downstream taint/cause candidates
```

## Visual Simulation Idea

### Agent Execution Causal Microscope

Hermes Console 顯示六條同步泳道：

```text
Reasoning | Tool/MCP | A2A | Memory/Context | Guardrail | Runtime/Infra
```

使用者可注入：Tool timeout、corrupt result、oversized response、A2A delay、delegation loop、misroute、guardrail bypass、Watcher freshness loss、stale capability。

每個 event node 顯示：

```text
Observed
Invariant OK / VIOLATED / UNKNOWN
Root-cause probability
Downstream affected nodes
Recovery candidate
```

並可切換三種視圖：Raw Trace、Structured Event Graph、Causal/Invariant Graph。

最重要的教學互動是拖曳 fault injection 時間點，觀察「root cause」如何沿 dependency edge 傳播成後續 reasoning symptom。

## Code / GitHub

### AgentChaosBench

Repository: https://github.com/kevinzck8k/agentic-fault-diagnosis

值得直接看的檔案/目錄：

- `rca_batch.py`：raw/structured trace rendering、paired healthy reference、ranked candidates、span/component evidence、AC@1/AC@3。
- `rca_localization.py`：component canonicalization、Loc@1/Loc@3、Joint(type+location)。
- `rca_probe_deepseek.py`：diagnostic prompt / conditions。
- `trace_view.py`：raw telemetry → structured view 的核心 abstraction。
- `dataset*/labels.jsonl`：fault type/location ground truth。
- `dataset_*`：不同 agent application traces。

這個 repo 對 Hermes 最值得抄的不是 UI，而是 **trace normalization + explicit component localization + paired reference evaluation**。

### AgentRx

Repository: https://github.com/microsoft/AgentRx

下一輪應繼續讀其 constraint synthesis、validation log、trajectory parser 與 evaluation pipeline，而非停在 README。

## Papers

1. **When Agentic Executions Fail: Detecting and Localizing Runtime Faults from Telemetry** — Zhang et al., 2026. AgentChaosBench；A2A/MCP runtime telemetry fault benchmark。
2. **AgentRx: Diagnosing AI Agent Failures from Execution Trajectories** — Barke et al., 2026. Constraint-driven auditable failure localization。
3. **Diagnosing with Insights: Structured Analysis of Agent Failures via Behavioral Abstractions** — Bi et al., 2026. AGENTSCOPE；structured behavioral abstraction + neural invariants。

## 已確認 / 推論 / 尚未驗證

**已確認：** AgentChaosBench 有 275 traces、10 類 injected operational faults，且公開 RCA scripts；`rca_batch.py` 明確支援 structured span view 與 paired reference；`rca_localization.py` 以 canonical component identity 計算 localization。AgentRx 使用 constraints + validation log；AGENTSCOPE 使用 structured abstraction + neural invariants。

**合理工程推論：** Hermes 可以把先前 WatchCoverageProof、GenerationCoherenceGate 與 Agent semantic invariants放進同一 Typed Invariant IR，形成跨 model/runtime/distributed-state 的 failure graph。

**尚未驗證假說：** 單一 unified invariant engine 是否能在不增加過多 latency/token cost 的前提下同時處理 semantic + hard runtime invariants；需要實作與 benchmark。

## Unknown / Open Questions

1. 如何定義一個 IR，讓 hard invariant（revision monotonicity）與 neural invariant（action-intent alignment）共存，但不混淆其證據強度？
2. Causal propagation 要採 explicit dependency graph、counterfactual replay、paired healthy trace，還是三者混合？
3. 多模態 Agent 的 image/audio/video observation 如何保留足夠的 provenance，使後續錯誤能追到 encoder/grounding/temporal sampling，而不是只看到文字化 observation？

## 下一輪研究

下一輪鎖定 **Unified Typed Invariant IR × AgentRx 原始碼 × AgentChaosBench trace_view × multimodal provenance**：

```text
AgentRx repository
→ trajectory parser
→ constraint synthesis
→ validation log schema
→ failure taxonomy

AgentChaosBench
→ trace_view.py
→ span hierarchy
→ A2A/MCP event representation

then
→ Hermes TypedEvent schema
→ HardInvariant / NeuralInvariant split
→ Evidence strength
→ causal edge
→ recovery policy
```

並新增多模態鏈：

```text
Camera/Image/Audio/Video
→ capture timestamp/source
→ preprocessing
→ encoder
→ token/features
→ fusion
→ grounding
→ reasoning
→ action
```

要求每一層都可攜帶 provenance / confidence / generation，讓 failure localization 能跨越 multimodal perception 與 Agent action。

## Knowledge Graph 新增 Node / Edge

### Nodes

- AgentExecutionTelemetry
- TypedRuntimeEvent
- ComponentIdentity
- StructuredTraceView
- CausalDependencyGraph
- HardInvariant
- NeuralInvariant
- InvariantEvidence
- FirstObservableViolation
- DecisiveFailure
- RootCause
- SymptomNode
- PairedHealthyReference
- TraceDeltaGraph
- FaultPropagationEdge
- RecoveryPolicy
- MultimodalProvenance

### Edges

```text
RawTrace → normalized_into → TypedRuntimeEvent
TypedRuntimeEvent → identified_by → ComponentIdentity
TypedRuntimeEvent → connected_by → CausalDependencyGraph
HardInvariant → evaluates → RuntimeState
NeuralInvariant → evaluates → SemanticBehavior
InvariantViolation → evidence_for → FailureCandidate
RootCause → propagates_via → FaultPropagationEdge
FaultPropagationEdge → produces → FirstObservableViolation
FirstObservableViolation → may_lead_to → DecisiveFailure
DecisiveFailure → produces → UserVisibleSymptom
PairedHealthyReference → compared_with → CurrentTrace
TraceDeltaGraph → supports → CausalDiagnosis
CausalDiagnosis → selects → RecoveryPolicy
WatcherFreshnessLoss → instance_of → HardInvariantViolation
ToolActionMismatch → instance_of → NeuralInvariantViolation
MultimodalProvenance → supports → CrossModalFailureLocalization
```

## 本輪結束判斷

**缺哪一層：** multimodal perception provenance → agent causal trace 的橋接層。  
**哪個節點最淺：** `MultimodalProvenance`。  
**哪個概念仍只是名詞：** `Unified Typed Invariant IR`，尚未在 Hermes 實作/benchmark。  
**哪個系統值得讀原始碼：** Microsoft AgentRx，其次 AgentChaosBench `trace_view.py`。  
**哪篇論文需追引用：** AGENTSCOPE，尤其 Who&When、Why Do Multi-Agent LLM Systems Fail、AgentRx 的關係。  
**哪個概念最適合視覺模擬：** Agent Execution Causal Microscope。  
**哪個 Agent 架構最值得實作：** `Typed Event Graph + Invariant Engine + Causal Diagnosis + Recovery Policy`，先作為 Hermes runtime observability sidecar，而不是直接侵入 planner。

## 對「AI 到底怎麼運作」的新補全

```text
User
→ UI
→ Agent Runtime
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tool/MCP/A2A
→ Observation
→ Next Decision
→ Model
→ GPU
→ Output

EVERY STEP
→ Telemetry Event
→ Dependency Edge
→ Invariant
→ Evidence
→ Causal Health State
```

因此本輪最重要的新認知是：**要真正回答 AI 怎麼運作，不能只有 forward execution graph，還需要一條與它平行的 evidence graph。Forward graph 告訴我們系統做了什麼；evidence/invariant graph 才能回答它從哪一步開始不再可信、錯誤如何傳播，以及應該在哪一層恢復。**