# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 00:51（Asia/Taipei）

主題：LLMbda Formal Semantics × Implicit/Control Flow × Multi-Agent IFC × Multimodal Prompt Injection × Policy-Carrying A2A

## 本小時新發現

本輪承接上一輪 Fides Gateway / Context Partition / Multimodal Taint，但避免重複 field-level labels；焦點轉向「即使沒有直接複製 secret/untrusted bytes，控制決策本身是否已洩漏或被污染」。新來源包括 LLMbda Calculus（2026）、SafeFlow（2026）、Information-Theoretic Privacy Control for Sequential Multi-Agent LLM Systems（2026）、MMPIBench（2026-09），並再次 code-level 驗證 Microsoft Fides Gateway 的 lattice 與 policy engine。

來源：
- LLMbda Calculus: https://llmbdacalculus.github.io/
- University of Copenhagen COPLAS description: https://di.ku.dk/english/events/event-calendar-2026/coplas-talk-the-llmbda-calculus-ai-agents-conversations-and-information-flow/
- SafeFlow: https://arxiv.org/abs/2607.25255
- Sequential multi-agent privacy: https://arxiv.org/abs/2603.05520
- MMPIBench: https://arxiv.org/abs/2609.09404
- Fides Gateway: https://github.com/microsoft/fides-gateway

## 本小時最重要 5 個發現

### 1. Explicit data flow 不是完整 information flow：control dependence / implicit flow 必須成為一級節點

已確認（論文/形式系統）：LLMbda 把 agentic execution 放入一個帶 dynamic IFC 的 lambda calculus；value 帶 label，conversation 可 fork/clear，並給出 termination-insensitive noninterference 性質。這代表安全分析不能只追 `secret string -> tool argument`，還要追 secret/untrusted input 是否改變了 branch、tool choice、recipient、termination 或 delegation topology。

底層拆解：

Input(label L)
→ Model/Program predicate
→ branch condition inherits pc-label
→ selected branch / tool choice becomes control-dependent
→ produced value/effect must include pc influence
→ sink policy checks value-label + control-label

例：
`if secret_is_positive: send("OK") else send("NO")`
即使輸出不含 secret bytes，輸出仍洩漏一 bit。對 Agent 等價於：secret 影響「是否呼叫 Tool B」，Tool trace 本身就是 observable channel。

重要性：前一輪的 semantic taint 若只貼在 payload，會漏掉 tool-selection channel、agent-routing channel、retry/abort channel。

限制：LLMbda 的形式化核心是抽象語義；部署模型的 stochasticity、外部時間、side channel 與 arbitrary multimodal encoders 不等於已被完整證明。

### 2. Conversation fork / clear 應被視為 IFC primitive，而不只是 context UX

已確認（LLMbda）：formal language 把 prompt-response conversation、fork、clear 納入語義。工程推論：Hermes Context Manager 應把「建立隔離子對話」建模為 security primitive。

建議 runtime：
Trusted Planner Context
→ fork()
→ Untrusted Reader Context
→ read web/image/email
→ produce constrained artifact
→ endorsement/declassification gate
→ import allowed artifact only
→ clear/discard raw untrusted conversation

這比把所有內容塞回單一 long context 更容易維持 provenance 與 integrity boundary。

### 3. Multi-Agent privacy 是 compositional property；每個 Agent 局部安全不代表 pipeline 安全

論文結果：Information-Theoretic Privacy Control for Sequential Multi-Agent LLM Systems 用 mutual information 描述 sequential agent pipeline 的 compositional leakage，主張局部 privacy constraint 不能推出 system-level privacy。

底層模型：
Sensitive S
→ Agent A output Z1
→ Agent B output Z2
→ ...
→ Agent N output Zn

即使每一跳 I(S; Zi | Zi-1) 很小，整條 trajectory 的 observable transcript / decisions 仍可能累積可推斷資訊。

Hermes 因此需要 `FlowBudget` / `DisclosureBudget` 隨 delegation 傳遞，而不是每個 agent 重新從零判斷。

### 4. Multi-Agent harmful intent 也會被「分片」而消失於局部視角

論文結果：SafeFlow 把 malicious cross-agent propagation 視為 semantic information-flow problem，將 structured semantic taints 從 root request 沿 dynamic collaboration graph 傳遞，並在 irreversible action 前做 workflow-level validation。

Architecture：
Root Goal
→ semantic risk labels
→ delegation A/B/C
→ local transformations
→ A2A envelopes preserve labels + provenance
→ global workflow reconstruction
→ irreversible-action gate

重要性：一個 agent 看到「找地址」、另一個看到「整理時間」、第三個看到「發送訊息」都可能局部合理，但組合後可能是未授權行動。因此 risk semantics 必須沿 A2A edge 保存。

### 5. Multimodal injection 的真正安全指標應是 propagation depth，不只是 attack completion

新近論文 MMPIBench（2026-09-08）測六種 visual carrier，並把攻擊從 perception → planning → tool call 分階段記錄。摘要報告 720 runs 中 completion 約 1%，attempt 12.8%；audio 覆蓋較窄但在可到達的配置中風險顯著更高。這支持 Hermes 不應只記「最後有沒有出事」，而要記：

PERCEIVED
→ INTERPRETED_AS_INSTRUCTION
→ ENTERED_PLAN
→ SELECTED_TOOL
→ ARGUMENT_INFLUENCE
→ EXECUTION_ATTEMPT
→ EFFECT_COMMITTED

限制：這些百分比是特定 framework/model/carrier 組合的 benchmark 結果，不應外推成所有 multimodal agents 的一般攻擊率。

## Architecture Breakdown

### Proposed Hermes IFC Kernel v2

Camera/Image/Audio/Video/Web/Email/MCP
→ Evidence Unit + Provenance Label
→ Modality Parser / Encoder
→ Derived Artifact (inherits source label)
→ Context Partition Manager
→ Conversation Fork
→ Planner
→ Program-Counter / Control Influence State
→ A2A Delegation Envelope
   - confidentiality
   - integrity
   - semantic-risk labels
   - disclosure budget
   - provenance refs
   - declassification grants
→ Agent / Executor
→ Tool Intent
→ Fides-like Field IFC
→ Control-Dependence Gate
→ Transaction Kernel
→ Effect
→ Labelled Observation / Memory

System-level invariant candidate:
`observable_effect` may depend only on information authorized to flow to that effect's observer/destination, except through explicit scoped declassification.

## Bottom-Level Logic

### Fides lattice code audit

Code-level confirmed from `microsoft/fides-gateway/lattice.py`:
- abstract bounded lattice defines `leq`, `join`, `meet`;
- integrity lattice orders TRUSTED < UNTRUSTED;
- confidentiality is represented using an inverse powerset of authorized readers;
- product lattice combines integrity and confidentiality;
- joins conservatively combine labels.

This is important because field labels are not arbitrary tags; they have algebraic flow semantics.

### Fides effective-label resolver audit

Code-level confirmed from `policy_engine.py`:
- labelled MCP calls carry labels in `_meta["com.github.ifc/labels"]`;
- labels address fields via RFC 9535 singular JSONPath;
- effective labels are computed bottom-up;
- unlabeled parents inherit the join of labelled descendants;
- an explicit parent label that is less restrictive than descendants causes a validation error;
- designated roots require total label coverage or evaluation fails.

New gap found: this is strong for data-structure flow, but a separate control-dependence state is still needed to represent cases where a high/untrusted value affects *which* tool is called without appearing in its arguments.

### Control influence proposal

At decision step t:
`PC_t = join(PC_parent, labels(inputs_used_by_decision_t), semantic_influence_labels)`

For action a:
`EffectiveActionLabel(a) = join(labels(arguments_a), PC_t, delegated_risk_labels)`

Then enforce:
`EffectiveActionLabel(a) <= AllowedSinkLabel(destination_a)`

This is a proposed Hermes model, not a claim that current Fides Gateway implements pc-label tracking.

## Visual Simulation Idea

### Implicit Flow & Multi-Agent Propagation Microscope

Interactive graph has two simultaneous overlays:
1. DATA FLOW: bytes/fields/evidence copied or transformed.
2. CONTROL FLOW: evidence that changed branch/tool/agent/recipient/commit decision.

Scenario:
Image region [UNTRUSTED]
→ OCR
→ Agent A
→ branch: "delegate to finance agent"
→ Agent B
→ read secret
→ Agent C
→ send external message

UI can hide the copied text and still show a red CONTROL_DEPENDENCY edge from the image region to the eventual external effect.

Controls:
- toggle explicit-flow only vs explicit+implicit flow;
- fork/merge conversations;
- clear context;
- vary disclosure budget;
- remove A2A labels to visualize laundering;
- inject image/audio instruction;
- show propagation stage: perceived / planned / attempted / committed.

## Code / GitHub

### Microsoft Fides Gateway
https://github.com/microsoft/fides-gateway

Worth reading next:
- `lattice.py`: security lattice algebra.
- `policy_engine.py`: labelled MCP payloads, JSONPath label resolution, Rego evaluation.
- `fastmcp_proxy.py`: actual proxy/dispatch path.
- `middleware.py`: label stamping/translation and policy metadata.
- `policies/`: concrete policy examples.
- `tests/test_label_extension.py`: executable semantics for explicit/implicit/ancestor/fallback label resolution.

Code audit conclusion: Fides is currently the strongest concrete bridge in this research line between formal IFC ideas and an actual MCP enforcement point. It should be treated as a runtime reference architecture, not as proof that arbitrary LLM reasoning satisfies noninterference.

## Papers

1. **The LLMbda Calculus: AI Agents, Conversations, and Information Flow** — Zac Garby, Andrew D. Gordon, David Sands — 2026. Institutions represented by authors include University of Nottingham / University of Edinburgh affiliations in project materials. URL: https://llmbdacalculus.github.io/ . Architecture: call-by-value calculus + conversations + fork/clear + dynamic IFC. Contribution: makes provenance defense and noninterference reasoning explicit at programming-language semantics level. Limitation: abstract model assumptions do not directly cover all stochastic/runtime/physical side channels.

2. **SafeFlow: Semantic Information-Flow Control for Blocking Malicious Propagation in Multi-Agent Systems** — Haowen Dai et al. — 2026. URL: https://arxiv.org/abs/2607.25255 . Architecture: semantic taints + dynamic collaboration graph + workflow-level validation. Contribution: keeps malicious intent/risk semantics visible across delegation. Limitation: semantic classification itself can be imperfect; benchmark guarantees are empirical rather than universal formal noninterference.

3. **Information-Theoretic Privacy Control for Sequential Multi-Agent LLM Systems** — Sadia Asif, Mohammad Mohammadi Amiri — 2026. URL: https://arxiv.org/abs/2603.05520 . Architecture: sequential agents + mutual-information leakage analysis + privacy-regularized training. Contribution: formalizes privacy as compositional/system-level. Limitation: information-theoretic quantities are difficult to estimate exactly in open-ended production agents.

4. **An Experimental Evaluation of Multimodal Prompt Injection Attacks on Agentic AI Frameworks (MMPIBench)** — Viet K. Nguyen, Mohammad I. Husain — 2026. URL: https://arxiv.org/abs/2609.09404 . Dataset/benchmark: 720 reported runs across frameworks/models/carriers/objectives. Contribution: measures propagation stages rather than only final completion; includes visual and audio channels. Limitation: coverage is bounded by tested frameworks/models and rapidly changing defenses.

## Unknown / Open Questions

1. How can Hermes approximate pc/control-dependence through opaque proprietary LLM calls without instrumenting hidden activations or chain-of-thought?
2. Can semantic influence estimates be made sound enough for enforcement, or must production enforcement remain conservative at conversation/source granularity?
3. How should disclosure/risk budgets compose across A2A graphs with loops, parallel branches, merges, retries and persistent memory?

## 下一輪研究

Priority: `Control-Dependence Enforcement × Opaque Model Boundary × A2A Label Composition × Disclosure Budget Accounting × Side Channels`.

Next code targets:
- Fides `fastmcp_proxy.py`, middleware ordering, tests;
- SafeFlow code if publicly available and verifiably linked from authors;
- LLMbda interpreter/source repository if a canonical repository can be verified;
- agent frameworks' handoff/A2A message structures to locate exact label propagation insertion points.

## Knowledge Graph 新增 Node / Edge

New Nodes:
- `ProgramCounterLabel`
- `ControlDependenceFlow`
- `ToolSelectionChannel`
- `AgentRoutingChannel`
- `TerminationChannel`
- `ConversationFork`
- `ConversationClear`
- `A2AFlowEnvelope`
- `SemanticRiskLabel`
- `CompositionalPrivacyLeakage`
- `DisclosureBudget`
- `PropagationDepth`
- `PerceptionToEffectChain`
- `EffectiveActionLabel`
- `SystemLevelNoninterference`

New Edges:
- `SensitiveEvidence --CONTROLS--> ToolSelection`
- `UntrustedEvidence --CONTROLS--> AgentRouting`
- `ConversationFork --ISOLATES--> UntrustedContext`
- `A2AFlowEnvelope --PRESERVES--> SemanticRiskLabel`
- `AgentOutput --CONSUMES_BUDGET_FROM--> DisclosureBudget`
- `ToolArguments --JOIN_WITH--> ProgramCounterLabel`
- `ProgramCounterLabel --CONTRIBUTES_TO--> EffectiveActionLabel`
- `EffectiveActionLabel --CHECKED_AGAINST--> SinkPolicy`
- `MultimodalEvidenceUnit --PROPAGATES_THROUGH--> PerceptionToEffectChain`

## 本輪結束判斷

缺哪一層：opaque LLM boundary 下可執行的 control-dependence tracking，以及跨 Agent disclosure-budget composition。

哪個節點最淺：`ProgramCounterLabel` 在 opaque model call 上的工程語義、`DisclosureBudget` 的可估計 accounting、`TerminationChannel` 的 production policy。

哪個概念仍只是名詞：對任意 multimodal multi-agent runtime 的 global semantic noninterference。

哪個系統值得讀原始碼：Microsoft Fides Gateway，下一步是 `fastmcp_proxy.py` + middleware + tests；SafeFlow 若找到作者 canonical code 再做 code audit。

哪篇論文需追引用：LLMbda Calculus，因為它把 conversation/fork/clear/IFC 放進同一 formal semantics；其次是 SafeFlow 的 cross-agent semantic flow。

哪個概念最適合視覺模擬：`Explicit Data Flow vs Implicit Control Flow` 雙層圖，尤其展示「沒有 secret bytes 出現在 argument，但 secret 決定了 recipient/tool」的情況。

哪個 Agent 架構最值得實作：`Partitioned Planner + Conversation Fork + A2A Label Envelope + Fides-like MCP Gateway + Transaction Kernel`，並在 tool-selection/agent-routing decision 加入 pc/control influence state。

## 從一句話到行動：本輪補上的位置

User / Camera / Image / Voice / Video
→ Encoder / OCR / ASR
→ Evidence Unit + Provenance
→ Context Partition
→ Conversation Fork
→ Model Reasoning
→ **Control Dependence / PC Label**
→ Planning
→ **Agent Routing / A2A Label Envelope**
→ Tool Selection
→ Field Labels + Effective Action Label
→ IFC Policy
→ Transaction Kernel
→ MCP / Tool
→ External Effect
→ Labelled Observation
→ Memory

本輪核心答案：AI 的資訊流不只存在於「它把哪些字複製到下一個 Tool」。資訊也能透過選擇、分支、路由、停止、授權與是否執行來流動。要回答「AI 到底怎麼運作」，因此必須同時畫出 data-flow graph 與 control-dependence graph；否則我們看到的只是 token 在哪裡，卻看不到某份資訊如何改變了 AI 的決策與現實世界的效果。