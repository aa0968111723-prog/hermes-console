# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-15 22:53 Asia/Taipei

## 本小時新發現

本輪接續上一輪 Effect Contract Verification / Capability Drift，研究焦點從「Tool 是否可信、能做什麼」推進到更底層的問題：**資料本身從哪裡來、經過哪些 Agent/Memory/Tool、最後流向哪個 privileged sink？**

本輪新增主題：Runtime Information Flow × Semantic Taint × Cross-Tool Exfiltration × Persistent Memory Flow × Least-Privilege Capability Leasing。

已確認的重要來源：

1. **Ghost in the Agent: Redefining Information Flow Tracking for LLM Agents** — Yuandao Cai, Wensheng Tang, Cheng Wen, Shengchao Qin, 2026. 提出 NeuroTaint 與 TaintBench（400 scenarios / 20 real-world agent frameworks），指出傳統 exact-value taint 無法覆蓋 LLM 的 semantic transformation、causal influence、cross-session memory persistence。
2. **Securing AI Agents with Information-Flow Control** — Manuel Costa et al., Microsoft, 2025. 提出 Fides，以 confidentiality/integrity labels 與 deterministic IFC enforcement 控制 Agent planner 可見資訊及工具行為。
3. **VIPER-MCP: Detecting and Exploiting Taint-Style Vulnerabilities in MCP Servers** — Pengyu Sun et al., 2026. 對 39,884 個 open-source MCP server repositories 掃描，報告 106 個經 end-to-end exploit trace 確認的 0-day vulnerabilities；重點是自然語言參數可以沿 MCP handler call chain 到達 command/file/network 等敏感 sink。
4. **FlowGuard: From Signals to Evidence for MCP Security Detection** — Baichao An et al., 2026. 將 semantic triage、schema-valid probes 與 runtime evidence 結合，在 1,880-case executable benchmark 驗證 command injection/file-system access 等風險。
5. **From Storage to Steering: Memory Control Flow Attacks on LLM Agents** — Zhenlin Xu et al., 2026. 指出 Memory 不只是 storage；retrieved memory 可以長期改變 Agent tool-selection/control flow，形成 persistent steering channel。

## 本小時最重要 5 個發現

### 1. Agent Information Flow 不能只做字串級 taint

傳統 taint：

```text
source bytes
→ variable
→ assignment
→ function argument
→ sink
```

LLM Agent 的實際 flow：

```text
Untrusted Web / Email / Image / Tool Result
→ Context Tokens
→ Attention / Hidden Representation
→ Semantic Transformation
→ Reasoning / Planning
→ Tool Arguments
→ Privileged Sink
```

甚至：

```text
Untrusted Source
→ Summary
→ Memory
→ Future Session Retrieval
→ New Plan
→ External Tool
```

因此：

```text
Exact Content Flow
≠ Semantic Influence Flow
≠ Causal Decision Flow
```

NeuroTaint 的重要改變，是把 taint reconstruction 從 exact string propagation 擴張成 semantic evidence + causal reasoning + persistent-context tracking。限制是它主要做 offline trace auditing；這不能直接取代 pre-action runtime enforcement。

### 2. Janus 的 runtime seam 證明 source→session→sink gate 可落地，但 granularity 仍偏粗

本輪直接閱讀 `Agentic-AI-Risk-Mitigation/Janus` 原始碼，而非只讀 README。

值得追的目錄：

```text
janus/
├ agent.py
├ adapters/
├ tools/
└ policy/
   ├ enforcer.py
   ├ provenance.py
   ├ session.py
   ├ taint.py
   ├ endorsement.py
   ├ decision.py
   └ pde/
```

`janus/policy/taint.py` 的核心設計：

```text
POST TOOL EXECUTION
record_output(tool, output)
↓
source label introduced
↓
monotonic session taint
↓
PRE TOOL EXECUTION
check(next_tool)
↓
ALLOW / DENY
```

例如：

```text
fetch_page
→ label:web
→ Agent reasoning
→ send_email
→ gate sees web taint
→ DENY / require verified provenance or OOB approval
```

Janus 明確承認 source-granular 而非 per-datum：當 vendor subprocess 只暴露 pre/post tool hooks 時，runtime 無法證明 tool output 的哪些 bytes 真正影響了下一個 argument，所以採保守 session-level monotonic taint。

這產生重要 trade-off：

```text
Sound conservative blocking
↔
Precision / utility
```

### 3. Tool allowlist 不足以阻止 cross-tool exfiltration

危險 architecture：

```text
Tool A = read_email       ALLOWED
Tool B = send_email       ALLOWED
```

單獨看都合法，但 trajectory：

```text
read attacker-controlled email
→ injected instruction enters context
→ read secret
→ send secret externally
```

真正安全條件必須是：

```text
Allowed(Tool A)
AND Allowed(Tool B)
AND Allowed(InformationFlow A→B | current labels, goal, authority)
```

因此 Hermes Policy Engine 要從 tool-level ACL 升級成 flow-level policy。

### 4. MCP security 有兩種 taint layer，不能混在一起

**Layer A — Agent semantic flow**

```text
MCP Resource / Tool Result
→ Agent Context
→ Reasoning
→ Next Tool Call
```

**Layer B — MCP implementation code flow**

```text
Natural-language / JSON Argument
→ MCP Tool Handler
→ parser / helper
→ shell / fs / SQL / HTTP sink
```

VIPER-MCP 的研究重點主要是 Layer B：從 tool parameters 沿程式 call chain 找 vulnerable sink，並動態產生可觸發 exploit 的 prompt。FlowGuard 則進一步要求 execution-related risk 要有 runtime evidence，而非只因看到 credential-like string 就判 leakage。

Hermes 因此需要兩張 graph：

```text
AgentInformationFlowGraph
MCPImplementationTaintGraph
```

並透過 `ToolCall` node 接起來。

### 5. Memory 必須成為 information-flow boundary

Memory Control Flow Attacks 說明：

```text
Untrusted Input
→ Memory Write
→ Persistent State
→ Future Retrieval
→ Planner
→ Tool Selection
```

因此 Memory 不可只記：

```text
text
embedding
timestamp
```

而要保存：

```text
MemoryNode
├ provenance
├ confidentiality_labels
├ integrity_labels
├ trust_domain
├ taint_sources
├ semantic_influence_refs
├ allowed_consumers
├ allowed_sinks
├ persistence_scope
└ declassification_authority
```

這也補上前幾輪 Provenance Graph 與 Runtime Policy 的連接。

## Architecture Breakdown

### Hermes Information-Flow Security Kernel

```text
INPUT SOURCES
├ User
├ Web
├ Email
├ Image / Video / Audio
├ MCP Resource
├ Tool Result
├ Memory
└ Agent Message
      ↓
Source Classifier
      ↓
Information Labeler
├ Confidentiality
├ Integrity
├ Trust Domain
├ Sensitivity
└ Origin
      ↓
Context Compiler
      ↓
Model / Agent Reasoning
      ↓
Semantic Influence Tracker
      ↓
Plan / Tool Intent
      ↓
Flow Policy Engine
├ current taint
├ provenance
├ GoalLock
├ authority
├ destination
├ capability lease
└ declassification rules
      ↓
ALLOW / REDACT / CONFIRM / ISOLATE / DENY
      ↓
Tool / MCP Dispatch
      ↓
External Sink
      ↓
Runtime Observation
      ↓
Flow Audit Graph
```

### Information-flow state

建議 runtime state：

```text
FlowState_t = {
  active_labels,
  provenance_frontier,
  sensitive_entities,
  untrusted_sources,
  memory_influences,
  active_capability_leases,
  permitted_sinks,
  declassification_events
}
```

### Least-Privilege Capability Leasing

不要給 Agent 長期的：

```text
send_email = forever
filesystem.write = forever
network.egress = forever
```

改為：

```text
CapabilityLease
├ operation
├ resource_scope
├ destination_scope
├ purpose / GoalLock
├ max_calls
├ valid_from
├ expires_at
├ allowed_information_labels
├ forbidden_taint_labels
└ revocation_epoch
```

例如：

```text
send_email
recipient = team@company
max_calls = 1
expires = +120 sec
forbid = {untrusted_web, secret, credential}
```

因此：

```text
Tool Permission
≠ Data Permission
```

Agent 有權使用 `send_email`，不代表它有權把目前 Context 裡所有資料寄出去。

## Bottom-Level Logic

### Semantic Taint Propagation

Hermes 不應只有 boolean `tainted=true`，而應形成 label set：

```text
L(x) = {
  source:web:example.com,
  integrity:untrusted,
  confidentiality:public
}
```

多來源融合：

```text
L(context)
=
JOIN(L(source_1), L(source_2), ..., L(source_n))
```

Tool output：

```text
ToolResult
→ provenance label
→ context label join
```

Memory write：

```text
Context labels
→ MemoryNode labels
```

Memory read：

```text
MemoryNode labels
→ active FlowState
```

Sink decision：

```text
ALLOW
iff
FlowPolicy(
  active_labels,
  sink,
  args,
  authority,
  goal,
  lease
) = PASS
```

### Declassification 不能由 LLM 自己決定

危險：

```text
LLM: "I summarized the secret, so it is safe now"
```

但 semantic transformation 不會自然消除敏感性。

因此：

```text
Summarization
≠ Sanitization
≠ Declassification
```

只有 trusted deterministic transformer、approved redactor、human authority 或 explicit policy primitive 可以產生 declassification edge。

## Visual Simulation Idea

### Information Flow Microscope × Exfiltration Path Simulator

Hermes Console 建議新增互動視圖：

```text
[Web Page: UNTRUSTED]
       ↓ red edge
[Context]
       ↓
[Agent Reasoning]
   ↙          ↘
[Memory]     [read_secret]
   ↓             ↓
 future       SECRET label
 session          ↓
       ↘       [Context]
             ↓
        [send_email]
             ↓
          BLOCKED
```

UI 可切換：

- exact-string flow
- semantic influence flow
- provenance flow
- confidentiality labels
- integrity labels
- capability lease
- persistent memory flow

可注入事件：

1. Web prompt injection
2. Email indirect injection
3. Image/OCR instruction injection
4. Tool output injection
5. Memory poisoning
6. Multi-agent propagation
7. MCP handler command injection
8. Secret read → HTTP egress

右側即時顯示：

```text
Current Taint
UNTRUSTED_WEB      ACTIVE
SECRET             ACTIVE
MEMORY_POISON      INACTIVE

Requested Sink
send_email

Tool Permission       ALLOW
Data Flow Permission  DENY
Capability Lease      VALID
Goal Match            PASS

FINAL
BLOCK: SECRET → EXTERNAL_EGRESS
```

## Code / GitHub

### Janus
Repository: https://github.com/Agentic-AI-Risk-Mitigation/Janus

值得繼續讀：

```text
janus/policy/taint.py
janus/policy/provenance.py
janus/policy/enforcer.py
janus/policy/session.py
janus/policy/endorsement.py
janus/policy/pde/
janus/adapters/
```

已確認 `taint.py` 實作 source label → monotonic session taint → pre-execution sink gate，並保留 taint/gate-denial event audit trail。

### Fides
Repository: https://github.com/microsoft/fides

下一輪 code audit 應聚焦 planner 如何實作 confidentiality/integrity labels、selective hiding primitives，以及 policy enforcement 與 planner expressiveness 的關係。

### 其他值得比較

- AgentBrake — tool-level monotonic taint + signed audit receipt；優點簡單、便宜，限制是 tool-call granularity 與 conservative session taint。
- LLMFirewall — MCP proxy 層攔截 tools/resources/prompts，做 taint-aware write/egress gating。
- Invariant Guardrails — graph/path rule 可描述 tool A → tool B 的 contextual guardrail。

## Papers

### Ghost in the Agent: Redefining Information Flow Tracking for LLM Agents
- Authors: Yuandao Cai, Wensheng Tang, Cheng Wen, Shengchao Qin
- Year: 2026
- URL: https://arxiv.org/abs/2604.23374
- Dataset: TaintBench, 400 scenarios, 20 agent frameworks
- Architecture: offline trace audit + semantic evidence + causal reasoning + persistent context tracking
- Contribution: 把 taint 從 explicit value propagation 擴張到 semantic/causal/persistent influence
- Limitations: offline auditing 不等同於 online prevention；semantic/causal attribution 本身也可能有誤判

### Securing AI Agents with Information-Flow Control
- Authors: Manuel Costa, Boris Köpf, Aashish Kolluri, Andrew Paverd, Mark Russinovich, Ahmed Salem, Shruti Tople, Lukas Wutschitz, Santiago Zanella-Béguelin
- Institution: Microsoft Research
- Year: 2025
- URL: https://arxiv.org/abs/2505.23643
- Code: https://github.com/microsoft/fides
- Benchmark: AgentDojo
- Architecture: confidentiality/integrity labels + deterministic IFC planner + selective hiding primitives
- Contribution: 給出 Agent planner security/expressiveness 的 formal model
- Limitations: IFC policy precision 與 agent utility 有 trade-off；不能單獨解決所有 semantic deception

### VIPER-MCP
- Authors: Pengyu Sun, Qishu Jin, Enhao Huang, Zifeng Kang, Xin Liu, Dakun Shen, Song Li
- Year: 2026
- URL: https://arxiv.org/abs/2605.21392
- Dataset: 39,884 open-source MCP server repositories scanned
- Architecture: two-pass static taint analysis + anchored call chains + dynamic prompt evolution
- Contribution: 從 MCP source-to-sink static finding 走到 end-to-end exploit confirmation
- Limitations: 主要針對 MCP implementation vulnerability，不等於 Agent semantic IFC

### FlowGuard
- Authors: Baichao An, Pei Chen, Geng Hong, Yueyue Chen, Mengying Wu
- Year: 2026
- URL: https://arxiv.org/abs/2607.14754
- Dataset: 1,880 executable MCP cases
- Architecture: semantic triage → recon → schema-valid probe → runtime evidence adjudication → history refinement
- Contribution: 將 MCP scanner 從 signal detection 推到 execution evidence
- Limitations: benchmark/runtime probe coverage 仍不代表任意 server 的完整 behavioral proof

### From Storage to Steering: Memory Control Flow Attacks on LLM Agents
- Authors: Zhenlin Xu, Xiaogang Zhu, Yu Yao, Minhui Xue, Yiliao Song
- Year: 2026
- URL: https://arxiv.org/abs/2603.15125
- Architecture: MEMFLOW evaluation of persistent memory-driven tool control flow
- Contribution: 把 memory poisoning 提升為跨 session control-flow security problem
- Limitations: benchmark attack success 不應直接外推到所有 production agent architecture

## Unknown / Open Questions

1. **Semantic taint 如何 online propagation？** NeuroTaint 類 semantic/causal tracing較適合 audit；production runtime 如何低延遲判斷「這個 Tool argument 是否受到某段 untrusted evidence 實質影響」仍未解。
2. **Declassification 的安全定義？** 對文字、圖片、影片、audio、embedding、summary，何種 transformation 可以證明移除 secret/instruction influence，而非只改寫表面形式？
3. **跨 Agent / 跨 Session labels 如何持久化又不造成永久污染？** Monotonic session taint 安全但保守；長期 Hermes Memory 若永遠累積 taint，utility 會快速下降。

## Knowledge Graph 新增 Node / Edge

### Nodes

- InformationFlowState
- SemanticTaint
- ExplicitDataFlow
- SemanticInfluenceFlow
- CausalDecisionFlow
- ConfidentialityLabel
- IntegrityLabel
- TrustDomainLabel
- PersistentTaint
- MemoryFlowBoundary
- FlowPolicyEngine
- DataPermission
- ToolPermission
- CapabilityLease
- DeclassificationAuthority
- DeclassificationEvent
- AgentInformationFlowGraph
- MCPImplementationTaintGraph
- CrossToolExfiltration
- SemanticSink
- SemanticSource
- FlowAuditEvent

### Edges

```text
UntrustedSource → TAINTS → Context
Context → INFLUENCES → Plan
Plan → MATERIALIZES_AS → ToolArguments
ToolArguments → FLOWS_TO → ExternalSink
MemoryNode → RESTORES_TAINT_INTO → FutureContext
ToolPermission → NOT_EQUIVALENT_TO → DataPermission
Summary → DOES_NOT_IMPLY → Declassification
MCPToolCall → CONNECTS → AgentInformationFlowGraph
MCPToolCall → CONNECTS → MCPImplementationTaintGraph
CapabilityLease → CONSTRAINS → ToolDispatch
FlowPolicyEngine → GATES → ExternalSink
```

## 與歷史研究比較

前幾輪已建立：Evidence Provenance → Retrieval Sufficiency → Decision Risk → Selective Execution → Semantic Transaction → Crash Consistency → Effect Capability Contract → Capability Verification。

本輪補上先前缺少的橫向維度：**即使 Tool 本身已驗證、Transaction 可恢復，資料仍可能沿一串「各自合法」的工具流到不該去的地方。**

因此 Hermes security kernel 現在應同時維護：

```text
Authority Graph
Effect Graph
Information Flow Graph
Provenance Graph
Transaction Graph
```

安全決策不是單一 graph 可以完成。

## 下一輪研究

主題收斂為：**Fides Planner Internals × Declassification × Context Partitioning × Multi-Agent IFC × Multimodal Taint**。

優先事項：

1. 深讀 microsoft/fides 原始碼，不只 README。
2. 拆 selective hiding / confidentiality-integrity labels 如何影響 planner 可見 context。
3. 研究 multi-agent message passing 的 label propagation。
4. 將 image region / video interval / audio span 納入 taint unit。
5. 建立 Context Compartment / Trusted-Untrusted dual-context architecture，降低 session-wide monotonic taint 對 utility 的傷害。

## 本輪結束回答

- **缺哪一層：** online semantic influence enforcement + safe declassification。
- **哪個節點最淺：** SemanticTaint、DeclassificationAuthority、CrossSessionFlowState。
- **哪個概念仍只是名詞：** production-grade Semantic Noninterference for LLM reasoning。
- **哪個系統值得讀原始碼：** Microsoft Fides，其次 Janus 的 provenance/enforcer/PDE。
- **哪篇論文需追引用：** Ghost in the Agent 與 Securing AI Agents with Information-Flow Control。
- **哪個概念最適合視覺模擬：** Information Flow Microscope × Exfiltration Path Simulator。
- **哪個 Agent 架構最值得實作：** Goal-Locked Agent + IFC Context Compiler + Capability Lease + Pre-Sink Flow Gate。

## 對「AI 到底怎麼運作」新增的一層

```text
User / Web / Email / Camera / MCP
→ Source Labels
→ Context
→ Model Reasoning
→ Semantic Influence
→ Planning
→ Tool Intent
→ Information-Flow Gate
→ Capability Lease
→ Transaction Kernel
→ Tool / MCP
→ External World
→ Provenance / Memory
```

核心結論：**安全 Agent 不能只控制「模型能用哪些工具」，還必須控制「哪些資訊有資格經由哪些工具流向哪裡」。Prompt injection 的真正危險不是一段文字讓模型說錯話，而是 untrusted information 能穿過 reasoning，借用 Agent 已取得的 delegated authority，把敏感資料或外部副作用送到 privileged sink。可靠 Runtime 因此需要把 Tool Permission 與 Data Permission 完全分開。**