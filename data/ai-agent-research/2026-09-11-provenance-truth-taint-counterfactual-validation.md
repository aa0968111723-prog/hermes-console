# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-11 14:52（Asia/Taipei）  
**主題**：Provenance Truth × Taint Propagation × Counterfactual Dependency Verification × Denial-Feedback Causality  
**延續上一輪**：Automatic Dependency Discovery × Provenance Graph × Tool/MCP Dataflow × Dynamic Dependency Invalidation  

## 0. 本輪與歷史研究比較：避免重複

上一輪已完成：

```text
Source / Framework / Tool Schema / MCP Trace
→ Automatic Dependency Discovery
→ Typed Provenance Graph
→ Dynamic Invalidation
```

但仍留下一個更底層問題：

```text
Candidate Edge X → Y
```

到底代表：

```text
時間先後？
值真的流過去？
語意被模型使用？
只是同時相關？
被拒絕動作產生的資訊影響？
真正因果必要條件？
```

因此本輪不再研究「如何產生 provenance edge」，而是建立 **Provenance Truth / Dependency Verification Plane**：

```text
Observed Trace
+ Static Dataflow
+ Runtime Value Flow
+ Taint Labels
+ Source Identity
+ Counterfactual Replay
↓
Dependency Verification
↓
VERIFIED / REJECTED / AMBIGUOUS
↓
Dependency Certificate
↓
Policy / Memory / Tool Gate
```

---

# 本小時新發現

## 新論文 / 架構 / GitHub

1. **Causality Laundering: Denial-Feedback Leakage in Tool-Calling LLM Agents** — Mohammad Hossein Chinaei, 2026, arXiv:2604.04035。提出一個 flat provenance / ordinary taint tracking 會漏掉的隱性資訊流：Agent 從被拒絕 tool call 的結果推回敏感資訊，再透過後續看似無關的允許工具外洩。論文提出 Agentic Reference Monitor（ARM），把 denied actions 也建成 first-class provenance nodes，並加入 counterfactual edges。
2. **VIPER-MCP: Detecting and Exploiting Taint-Style Vulnerabilities in Model Context Protocol Servers** — Pengyu Sun, Qishu Jin, Enhao Huang, Zifeng Kang, Xin Liu, Dakun Shen, Song Li, 2026, arXiv:2605.21392。以 two-pass static analysis 找 source-to-sink taint path，再用 feedback-driven prompt evolution 動態確認 exploitability；掃描 39,884 個開源 MCP repos，報告 106 個 confirmed 0-days，67 個 CVE IDs。
3. **MCPHunt: An Evaluation Framework for Cross-Boundary Data Propagation in Multi-Server MCP Agents** — Haonan Li, Tianjun Sun, Yongqing Wang, Qisheng Zhang, 2026, arXiv:2604.27819。用 format-authentic synthetic canaries 做 objective taint tracking，區分 task-mandated propagation 與 policy-violating propagation；公開 code 包含 `agent_loop.py`、`canary_registry.py`、`actual_sink.py`、`labeling.py`、`mcp_driver.py` 等，可直接追 runtime。
4. **Safeguarding LLM Agents from Misalignment through Provenance Analysis** — Yining She, Yiliang Liang, Eunsuk Kang, ASE 2026 / arXiv:2607.01236。把 pre-execution tool-call alignment 定義成「action 是否能由 context 中可追溯證據支持」，以 provenance-based multi-stage pipeline 取代單純 LLM-as-a-judge。
5. **ProvenanceGuard: Source-Aware Factuality Verification for MCP-Based LLM Agents** — Ander Alvarez, Santhiya Rajan, Samuel Mugel, Román Orús, 2026, arXiv:2606.18037。指出 pooled factuality 仍會漏掉 cross-source conflation：claim 可能在某處有證據，但 attribution 到錯的 source。Verifier 保持 tool ID / source ID / raw output identity，做 claim decomposition、source routing、support checking 與 attribution checking。
6. **LEDGER: Claim-to-Evidence Trace Graphs for Auditing LLM Agents** — Daehong Kim, Haichao Miao, Shusen Liu, 2026, arXiv:2608.18398。將 raw trace records 提升成 Evidence Nodes / Workflow Nodes，並把 artifacts 當成 evidence anchors，以 typed semantic edges 連 claims、actions、artifacts、validation checks。
7. **From Agent Traces to Trust: Evidence Tracing and Execution Provenance in LLM Agents** — Yiqi Wang et al., 2026, arXiv:2606.04990。系統整理 execution provenance / evidence tracing，並指出 unified trace schema、claim-level semantic provenance、provenance-aware safety 與 recovery-oriented evaluation 仍是主要缺口。

---

# 本小時最重要 5 個發現

## 1. Dataflow Provenance ≠ Causal Influence

### 概念

普通 provenance 常建立：

```text
ToolResult A
--VALUE_FLOWS_TO→
ToolArgument B
```

如果沒有 value copy，就假設沒有 dependency。

Causality Laundering 顯示這不夠。

例如：

```text
Agent → read(secret_resource)
Reference Monitor → DENY
Agent observes DENY
Agent infers: resource exists / policy state / protected condition
Agent → send_email("resource is protected")
```

這裡：

```text
secret bytes
≠ flowed into email
```

但：

```text
DENIAL EVENT
→ changed Agent belief
→ changed later action
```

因此：

```text
No Direct Dataflow
≠ No Information Flow
```

### 底層如何運作

Hermes 的 provenance edge 必須至少分成：

```text
VALUE_FLOW
CONTROL_FLOW
EVIDENCE_SUPPORT
AUTHORIZATION_DEPENDENCY
DENIAL_FEEDBACK
COUNTERFACTUAL_INFLUENCE
SEMANTIC_USE
```

其中 `DENIAL_FEEDBACK` 是本輪最重要的新 edge type。

### 為什麼重要

如果只做 field-level taint：

```text
secret → output
```

會漏掉：

```text
policy decision
error shape
latency
existence / non-existence
allow / deny
```

所形成的 covert / implicit information channel。

### 限制

Denial-feedback 是否「真的」影響後續行為，單靠 trace 仍無法完全證明，必須再用 counterfactual replay 或 controlled perturbation。

### 狀態

**論文結果**：已被 2026 Causality Laundering 論文提出並在三種代表情境測試。  
**工程推論**：Hermes 應把 denied tool call、policy decision、error response 都保留為 provenance node，不得視為失敗後即可丟棄的 log。

---

## 2. Taint Tracking 要從「值標記」升級成「來源 × 信任 × 邊界 × Sink」

### MCPHunt 的 bottom-level mechanism

公開 `canary_registry.py` 顯示它刻意使用接近真實 credential 格式的 synthetic canaries，例如：

```text
sk_live_*
ghp_*
AKIA*
xoxb-*
```

並非使用很容易被模型辨識為測試資料的固定 sentinel prefix。

Detection 使用：

```text
Known Canary Registry
↓
Exact / fragment substring detection
↓
Cross-boundary sink observation
↓
Propagation label
```

因此它不是問：

```text
LLM 說自己有沒有洩漏？
```

而是把 taint detection 轉成 objective runtime observation。

### Hermes 的 TaintLabel 建議

```text
TaintLabel
├ source_id
├ source_type
├ trust_domain
├ confidentiality_class
├ integrity_class
├ canary_id?
├ introduced_at
├ transformation_chain[]
├ boundary_crossings[]
└ sink_class
```

### 新的底層鏈

```text
Untrusted / Sensitive Source
↓
Read
↓
Context Injection
↓
Transformation
↓
Tool Argument Construction
↓
MCP Boundary
↓
Sink
↓
Propagation Classification
```

### 為什麼重要

跨 MCP server 的風險不是「哪個單一 tool 惡意」，而可能是：

```text
Server A: read credential
+
Server B: network write
+
Agent faithful composition
=
Cross-boundary propagation
```

這是 workflow topology 問題。

### 限制

Canary tracking 對「verbatim / fragment propagation」非常強，但對 semantic paraphrase、latent inference、denial feedback、encrypted/encoded transformations 不足。

因此：

```text
Canary Not Found
≠ No Leakage
```

---

## 3. Static Taint Alert ≠ Exploitable Vulnerability；Dynamic Confirmation 才接近 Verified Dependency

VIPER-MCP 的重要點不是只有 static taint analysis，而是：

```text
Pass 1
Repository-level source/sink scan
↓
Pass 2
Anchor Query
↓
Specific MCP tool handler
↓
Vulnerability-anchored call chain
↓
Prompt Evolution
├ tool-selection correction
└ parameter-penetration deepening
↓
Concrete exploit trace
```

這形成一個非常值得 Hermes 借用的 verification pattern：

```text
Candidate Dependency
↓
Static Evidence
↓
Runtime Stimulus
↓
Observed Sink Effect
↓
Verified Path
```

Hermes 的一般化版本不是用來產生 exploit，而是做防禦性 validation：

```text
Candidate edge X → Y
↓
Controlled replay
├ remove X
├ redact X
├ replace X
├ mutate X
└ preserve everything else
↓
Observe Y
↓
Effect size / path stability
```

然後：

```text
if Y consistently changes:
  COUNTERFACTUALLY_SUPPORTED
else if unchanged:
  REJECT / DOWNGRADE
else:
  AMBIGUOUS
```

### 新的重要分界

```text
Static Reachability
≠ Runtime Reachability
≠ Exploitability
≠ Causal Necessity
```

這四個一定要分開存。

---

## 4. Provenance Truth 還包含「來源正確性」，不是只判 claim 有沒有 evidence

Source-aware ProvenanceGuard 指出：

```text
Claim C
```

可能在 pooled evidence 中確實被某個來源支持，但回答卻說：

```text
Source A says C
```

而實際是 Source B 支持 C。

這叫 cross-source conflation。

所以：

```text
Claim Supported
≠ Attribution Correct
```

### Hermes 應拆成兩個 verifier

```text
SupportVerifier
Claim → Evidence

AttributionVerifier
Claim Attribution → Source Identity
```

並要求 source identity 穿過完整 MCP pipeline：

```text
MCP Server
→ Tool ID
→ Resource URI / Source ID
→ Raw Output
→ Evidence Unit
→ Claim
```

而不是 context injection 後全部扁平化成普通文字。

### 為什麼重要

如果 provenance 在 context compiler 階段被去識別化：

```text
Evidence A + Evidence B
→ plain text
```

模型即使 factual，也可能 source attribution 錯誤。

因此：

```text
Context Compression
≠ Provenance Erasure
```

每個 summary / memory / RAG chunk 應保存 source lineage。

---

## 5. Provenance 可以成為 Tool Execution Gate，而不是事後 audit UI

Provenance-based misalignment research 的核心觀念是：

```text
Proposed Tool Call
```

在執行前必須能回答：

```text
哪個 User Intent 支持這個 action？
哪個 evidence 支持這些 arguments？
哪個 context item 造成 privilege escalation？
是否有 untrusted instruction 進入 control path？
```

因此 Hermes 的 tool loop 應從：

```text
Intent
→ Tool Selection
→ Arguments
→ Execution
```

升級成：

```text
Intent
→ Tool Selection
→ Arguments
→ Provenance Slice
→ Taint / Alignment / Policy Check
→ EXECUTE or DENY
→ Denial Event Provenance
→ Observation
→ Next Decision
```

注意最後：

```text
DENY
```

也必須寫回 graph，因為 denial 本身是 information-bearing event。

---

# Architecture Breakdown

## Provenance Truth & Taint Verification Plane

```text
User Intent / System Policy
        ↓
Agent Planner
        ↓
Proposed Tool / MCP Call
        ↓
Argument Provenance Builder
├ user-derived
├ memory-derived
├ RAG-derived
├ tool-derived
├ model-generated
└ unknown
        ↓
Taint Propagator
├ confidentiality
├ integrity
├ trust domain
└ boundary history
        ↓
Provenance Slice
        ↓
Pre-Execution Reference Monitor
├ user-intent support
├ source trust
├ sink policy
├ privilege
├ cross-boundary flow
└ denied-action influence
        ↓
ALLOW / DENY / REQUIRE_VERIFY
        ↓
Tool / MCP Runtime
        ↓
Result + Error + Policy Decision
        ↓
Runtime Provenance Graph
        ↓
Dependency Verifier
├ static reachability
├ exact value flow
├ source attribution
├ canary propagation
├ semantic support
└ counterfactual replay
        ↓
Dependency Certificate
        ↓
Memory / Claim / Planner / Security Policy
```

---

# Bottom-Level Logic

## A. Explicit dataflow taint

```text
source s
↓
label L(s)
↓
transformation f
↓
y = f(s, x)
↓
L(y) = join(L(s), L(x))
```

在 integrity lattice / trust lattice 中，保守策略可使用最低可信 ancestry：

```text
Trust(y)
=
min Trust(all ancestors)
```

但必須注意：

```text
Lowest Ancestor Trust
≠ Semantic Control Influence
```

例如 untrusted webpage 只是提供 factual value，未必控制 tool choice；反之沒有 value flow 的 denial 可能控制下一步 action。

## B. Implicit / denial-feedback flow

```text
Protected State Z
↓
Attempt A
↓
Policy Decision D = ALLOW / DENY
↓
Agent Observation
↓
Belief Update B'
↓
Action Y
```

因此 dependency 可表示為：

```text
D --DENIAL_FEEDBACK→ B'
B' --INFLUENCES→ Y
```

而真正需要驗證：

```text
Replay with D changed / masked
↓
Does Y change?
```

## C. Counterfactual dependency score

可先建立工程版：

```text
CDS(X → Y)
=
E[ distance(Y_observed, Y_do(remove X)) ]
```

再做多介入：

```text
remove
redact
substitute
perturb
reorder
```

避免只測一次 deletion。

## D. Dependency Certificate

```text
DependencyCertificate
├ edge_id
├ source_node
├ target_node
├ relation_type
├ static_evidence[]
├ runtime_value_flow[]
├ source_identity_evidence[]
├ taint_labels[]
├ boundary_crossings[]
├ counterfactual_trials[]
├ effect_score
├ verification_status
├ confidence
├ model_epoch
├ tool_schema_hashes[]
└ unresolved_alternatives[]
```

Verification status：

```text
OBSERVED
INFERRED
VALUE_FLOW_CONFIRMED
SOURCE_CONFIRMED
COUNTERFACTUALLY_SUPPORTED
REJECTED
AMBIGUOUS
```

---

# Visual Simulation Idea

# **Provenance Truth & Taint Flow Lab**

## View 1 — Explicit Flow

```text
.env secret
   │ TAINT: SECRET
   ▼
ReadFile
   ▼
LLM Context
   ▼
Email.body
   ▼
Network Sink

STATUS: POLICY VIOLATION
```

每一條 edge 可點開：

```text
Exact value copy       YES
Substring match        YES
Source identity        VERIFIED
Cross-domain boundary  filesystem → network
```

## View 2 — Denial-Feedback Invisible Flow

畫面一開始故意沒有 dataflow edge：

```text
Protected Resource
      ✕
  READ DENIED

(no value flow)

        ...

SendEmail
```

按下：

```text
SHOW CAUSAL INFLUENCE
```

才出現：

```text
READ DENIED
   └──DENIAL_FEEDBACK──→ Agent Belief
                            ↓
                         SendEmail
```

再按：

```text
COUNTERFACTUAL REPLAY
```

左邊：

```text
Observed:
DENY → Send "protected"
```

右邊：

```text
Counterfactual:
Neutral response → No send
```

顯示：

```text
Causal Influence Score 0.84
Direct Value Flow      0.00
```

這會直接讓非資安背景的人理解：

> **資訊可以影響 Agent，即使那個資訊從來沒有以資料值的形式流過去。**

## View 3 — Source Attribution

```text
Claim:
Drug X dosage is 20 mg

Support:
Source B ✓

Agent attribution:
Source A ✕

STATUS:
FACTUALLY SUPPORTED
ATTRIBUTION INVALID
```

## View 4 — MCP Boundary Heatmap

```text
Filesystem MCP   ████ sensitive source
Database MCP     ██
Browser MCP      ███ cross-boundary relay
Email MCP        █████ privileged sink
```

點一條 flow 顯示：

```text
source_domain
→ transformations
→ context injection
→ tool argument
→ destination_domain
```

---

# Code / GitHub

## MCPHunt

Repository：`lihaonan0716/MCPHunt`

值得持續讀的核心結構：

```text
src/mcphunt/
├ agent_loop.py
├ actual_sink.py
├ canary_registry.py
├ deviance.py
├ environments.py
├ integrity.py
├ labeling.py
├ mcp_driver.py
└ prompts.py
```

### `canary_registry.py`

已確認：
- 使用 realistic / format-authentic synthetic secret formats。
- 不依賴單一醒目的 sentinel prefix。
- 透過 known registry 做 exact / fragment-oriented detection。
- 另外建立 hard-negative values，避免只因 credential-like format 就誤判。

這提供 Hermes 一個很實際的測試基線：

```text
Synthetic Sensitive Artifact
→ MCP workflow
→ Sink
→ Objective taint detection
```

### 下一步最值得讀

1. `agent_loop.py`：模型、tool calling、observation 如何串接。
2. `mcp_driver.py`：多 server MCP transport / invocation。
3. `actual_sink.py`：真正 sink-side observation 如何定義。
4. `labeling.py`：task-mandated / policy-violating propagation 分類。
5. `integrity.py`：benchmark integrity / control checks。

## VIPER-MCP

公開論文目前足以確認 architecture：

```text
Two-pass static analysis
→ anchored vulnerable handler
→ taint call chain
→ prompt evolution
→ end-to-end dynamic confirmation
```

若後續找到官方 code repository，優先讀：
- source/sink specification
- anchor-query generation
- interprocedural taint propagation
- prompt mutator scheduler
- exploit confirmation oracle

---

# Papers

## 1. Causality Laundering: Denial-Feedback Leakage in Tool-Calling LLM Agents

- **Author**：Mohammad Hossein Chinaei
- **Year**：2026
- **URL**：https://arxiv.org/abs/2604.04035
- **Architecture**：Agentic Reference Monitor + provenance graph + integrity lattice + denied-action counterfactual edges
- **Contribution**：指出 flat provenance 對 denial-induced causal influence 的盲點。
- **Limitations**：目前是受控 attack scenarios；是否能在大型長任務 agent runtime 中低誤報運作仍需驗證。
- **改變了什麼**：把「拒絕」從普通 error log 提升成可能攜帶敏感資訊的 causal event。

## 2. VIPER-MCP

- **Authors**：Pengyu Sun, Qishu Jin, Enhao Huang, Zifeng Kang, Xin Liu, Dakun Shen, Song Li
- **Year**：2026
- **URL**：https://arxiv.org/abs/2605.21392
- **Dataset / Corpus**：39,884 real-world open-source MCP repositories
- **Architecture**：two-pass static taint analysis + anchor query + feedback-driven prompt evolution + dynamic exploit confirmation
- **Contribution**：把「static alert」推進到 end-to-end confirmed path。
- **Limitations**：專注 MCP server implementation vulnerabilities；不是完整 Agent semantic causality verifier。
- **改變了什麼**：提供「靜態候選 → 動態驗證」可泛化到 dependency verification 的設計模式。

## 3. MCPHunt

- **Authors**：Haonan Li, Tianjun Sun, Yongqing Wang, Qisheng Zhang
- **Year**：2026
- **URL**：https://arxiv.org/abs/2604.27819
- **Code**：https://github.com/lihaonan0716/MCPHunt
- **Dataset**：147 tasks、9 mechanism families；論文報告 3,615 main-benchmark traces。
- **Architecture**：multi-server MCP controlled environments + format-authentic canaries + sink tracking + CRS stratification
- **Contribution**：把 cross-boundary leakage detection 變成可客觀量測。
- **Limitations**：主要偵測 overt/verbatim or fragment-style propagation；隱性語意資訊流需要額外方法。
- **改變了什麼**：證明 benign tools + faithful composition 本身就能形成 policy-violating cross-domain flow。

## 4. Safeguarding LLM Agents from Misalignment through Provenance Analysis

- **Authors**：Yining She, Yiliang Liang, Eunsuk Kang
- **Institution**：KAIST / research affiliation as reported by authorship context; verify exact per-author affiliation from manuscript when integrating formal bibliography.
- **Year**：2026
- **URL**：https://arxiv.org/abs/2607.01236
- **Benchmarks**：Agent-SafetyBench、WorkBench
- **Architecture**：provenance-based multi-stage pre-execution misalignment analysis
- **Contribution**：將 action alignment 轉成 traceable support problem。
- **Limitations**：provenance completeness 本身仍是前置假設。
- **改變了什麼**：讓 provenance 從 audit artifact 變成 execution gate。

## 5. ProvenanceGuard: Source-Aware Factuality Verification for MCP-Based LLM Agents

- **Authors**：Ander Alvarez, Santhiya Rajan, Samuel Mugel, Román Orús
- **Year**：2026
- **URL**：https://arxiv.org/abs/2606.18037
- **Artifact**：https://github.com/aalvsz/provenanceguard
- **Architecture**：claim decomposition → source-specific evidence routing → support verification → attribution verification → allow/block
- **Contribution**：cross-source conflation detection。
- **Limitations**：public artifact currently states reproducible code/data are not released。
- **改變了什麼**：把「有支持證據」與「來源歸屬正確」正式拆開。

## 6. LEDGER

- **Authors**：Daehong Kim, Haichao Miao, Shusen Liu
- **Year**：2026
- **URL**：https://arxiv.org/abs/2608.18398
- **Architecture**：Trace Records → Evidence Nodes / Workflow Nodes → artifact anchors → typed claim-support graph
- **Contribution**：讓長 horizon technical agent workflow 可做 evidence-centered audit。
- **Limitations**：auditing / review graph 不等於 causal dependency proof。
- **改變了什麼**：進一步確認 raw observability 需要語意 evidence graph 才能真正 audit。

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Provenance Truth Plane
Dependency Verification
Dependency Certificate
Explicit Information Flow
Implicit Information Flow
Denial Feedback
Denial Event
Causality Laundering
Counterfactual Dependency
Counterfactual Replay
Taint Label
Taint Source
Taint Sink
Cross-Boundary Propagation
Trust Domain
Integrity Lattice
Canary Secret
Canary Registry
Hard-Negative Canary
Source Attribution
Cross-Source Conflation
Provenance Slice
Pre-Execution Reference Monitor
Static Reachability
Runtime Reachability
Exploitability
Causal Necessity
Semantic Use
Policy Decision Provenance
```

## 新增 Edges

```text
SensitiveSource --TAINTS→ Data
Data --CROSSES_BOUNDARY→ TrustDomain
Data --FLOWS_TO→ ToolArgument
ToolArgument --REACHES→ Sink
PolicyDecision --DENIAL_FEEDBACK→ AgentBelief
AgentBelief --INFLUENCES→ ToolCall
Evidence --SUPPORTS→ Claim
Claim --ATTRIBUTED_TO→ Source
CounterfactualTrial --TESTS→ Dependency
DependencyCertificate --CERTIFIES→ Edge
```

## 新增否定關係

```text
No Direct Dataflow ≠ No Information Flow
Chronological Order ≠ Causal Dependency
Static Reachability ≠ Runtime Reachability
Runtime Reachability ≠ Exploitability
Exploitability ≠ Causal Necessity
Canary Not Found ≠ No Leakage
Claim Supported ≠ Attribution Correct
Tool Call Denied ≠ Security Risk Ended
Error Message ≠ Harmless Observation
Same Value ≠ Same Provenance
Taint Propagation ≠ Semantic Control Proof
Provenance Edge ≠ Verified Dependency
Audit Visibility ≠ Enforcement
```

---

# Unknown / Open Questions

## 1. Semantic taint 如何可靠傳播？

如果 secret 被：

```text
summarize
paraphrase
encode
aggregate
reason over
```

exact canary 消失，但敏感資訊可能仍被保留。

下一層需要：

```text
Value Taint
→ Semantic Taint
→ Derived Fact Taint
```

但不能把所有 downstream tokens 永久標 taint，否則 usable information flow 幾乎全部被封鎖。

## 2. Counterfactual replay 如何處理 stochastic LLM？

```text
remove X
→ Y changed
```

可能只是 sampling randomness。

需要：

```text
paired seeds / controlled decoding
multi-run effect distribution
causal confidence interval
trace alignment
```

而不是單次 A/B。

## 3. 如何區分 legitimate influence 與 malicious steering？

Untrusted webpage 的 factual內容可以合理改變下一步 tool argument；不能因為有 taint ancestry 就全部禁止。

真正需要：

```text
DATA influence
vs
CONTROL influence
```

也就是「這段不可信內容提供數值」和「這段不可信內容偷偷改寫 Agent 目標」必須分開。

---

# 下一輪研究

下一個最深缺口：

# **Semantic Taint × Instruction/Data Separation × Control-Flow Integrity × Prompt-Injection Information Flow**

目前已能追：

```text
value flow
source identity
trust boundary
denial feedback
counterfactual dependency
```

下一輪要回答：

```text
一段外部文字進入 context 後，
它到底只是 DATA，
還是開始控制 Agent 的 PLAN / TOOL / GOAL？
```

建議下一輪流程：

```text
Untrusted Content
↓
Instruction / Data Segmentation
↓
Semantic Taint
↓
Attention / Context Influence Proxy
↓
Planner Decision
↓
Tool Selection
↓
Argument Construction
↓
Control-Influence Test
↓
Counterfactual Prompt Removal
↓
CONTROL_TAINT / DATA_TAINT / AMBIGUOUS
↓
Policy Gate
```

優先研究：
- indirect prompt injection / tool poisoning
- instruction hierarchy / source trust
- IFC / decentralized information-flow control 對 LLM agents 的移植
- prompt-to-tool taint analysis
- MCP server/tool descriptions as untrusted control input
- multi-agent taint transfer
- memory poisoning persistence

---

# 本輪收斂回答

- **缺哪一層**：Semantic Taint / Control-Influence Verification。
- **哪個節點最淺**：`SEMANTIC_USE` 與 `COUNTERFACTUAL_INFLUENCE` 的可靠 calibration。
- **哪個概念仍只是名詞**：Universal `DependencyCertificate ABI`、`SemanticTaintLabel`、`ControlInfluenceScore`。
- **哪個系統最值得讀原始碼**：MCPHunt 的 `agent_loop.py / mcp_driver.py / actual_sink.py / labeling.py / integrity.py`；若 VIPER-MCP 官方完整 code 公開，應立刻追其 interprocedural taint engine 與 dynamic confirmation oracle。
- **哪篇論文需追引用**：Causality Laundering、VIPER-MCP、MCPHunt、Safeguarding LLM Agents from Misalignment through Provenance Analysis。
- **哪個概念最適合視覺模擬**：Provenance Truth & Taint Flow Lab，尤其「沒有 direct dataflow 但 denial 仍產生 causal influence」的雙 trace replay。
- **哪個 Agent 架構最值得實作**：

> **Provenance-Verified Agent Runtime = Provenance-Native Context + Typed Taint Labels + Cross-Boundary Flow Tracker + Pre-Execution Reference Monitor + Denial-Event Provenance + Counterfactual Dependency Verifier + Source Attribution Verifier + Dependency Certificate + Dynamic Policy Gate**

本輪真正的推進是：**Hermes 的 provenance graph 不應只回答「資料從哪裡來、流到哪裡」，還必須逐步回答「這條依賴真的存在嗎、資訊有沒有透過隱性管道影響 Agent、來源歸屬是否正確，以及在移除上游因素後 downstream 行為是否真的改變」。只有到這一層，dependency graph 才從可視化 log 升級成可驗證的 runtime truth model。**

---

## Sources

- https://arxiv.org/abs/2604.04035
- https://arxiv.org/abs/2605.21392
- https://arxiv.org/abs/2604.27819
- https://github.com/lihaonan0716/MCPHunt
- https://arxiv.org/abs/2607.01236
- https://arxiv.org/abs/2606.18037
- https://github.com/aalvsz/provenanceguard
- https://arxiv.org/abs/2608.18398
- https://arxiv.org/abs/2606.04990
