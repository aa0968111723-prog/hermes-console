# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 01:52（Asia/Taipei）

主題：Counterfactual Control Dependence × Opaque Model Boundary × Disclosure Budgets × Issue-Time Privacy × Agent Side Channels

## 與歷史研究比較

上一輪已建立 ProgramCounterLabel、ControlDependenceFlow、A2AFlowEnvelope、DisclosureBudget 與 EffectiveActionLabel，但最大缺口是：黑箱 LLM 不暴露內部 control-flow，Runtime 如何知道「哪一段 untrusted context 實際改變了下一個 action」？本輪不再重複 IFC lattice，而是集中研究可觀測的 counterfactual causal diagnostics、trajectory-level inference leakage，以及 speculation / destination / timing 等 side channels。

## 本小時新發現

1. **AgentSentry（2026）**：把 indirect prompt injection 建模成 temporal causal takeover，在 tool-return boundary 做 controlled counterfactual re-execution，定位下一個 action 是由 user goal 還是 tool/retrieval context 主導，再做 causally gated context purification。論文在 AgentDojo、四個 task suites、三種 IPI attack families、多個 black-box LLM 上報告 ASR 0%，平均 Utility Under Attack 74.55%。這是論文 benchmark 結果，不是 production guarantee。
   - Paper: https://arxiv.org/abs/2602.22724
   - Authors: Tian Zhang, Yiwei Xu, Juan Wang, Keyan Guo, Xiaoyang Xu, Bowen Xiao, Quanlong Guan, Jinlin Fan, Jiawei Liu, Zhiquan Liu, Hongxin Hu
   - Year: 2026
   - Dataset/Benchmark: AgentDojo
   - Code: 本輪未找到可確認為作者官方 implementation 的公開 repository，因此不把第三方重現當官方 code。

2. **OCELOT（2026）**：privacy 不是單次 release filter，而是 trajectory-level posterior-risk budget。Witness-Verified Declassification 讓 untrusted defender model 提出 labeled atoms / declassification operators，再由 deterministic verifier 計費 min-entropy cost，並將 sink trust 與累積 disclosure 記錄到 tamper-evident ledger。
   - Paper: https://arxiv.org/abs/2606.12341
   - Authors: Jin Xie, Songze Li
   - Year: 2026

3. **Ghost Tool Calls（2026）**：speculative tool execution 即使最後 branch 被丟棄，外部 provider 已經觀察到 query / destination / timing；因此 read-only 不等於 privacy-safe。論文提出 Speculative Tool Privacy Contracts，將「observation before commitment」視為獨立 effect class。
   - Paper: https://arxiv.org/abs/2606.02483
   - Authors: Bardia Mohammadi, Lars Klein, Akhil Arora, Laurent Bindschaedler
   - Year: 2026

4. **AgentFlow（2026）**：Agent source code 的 dependency 不只 AST control/data flow，還包含 framework semantics：agent constructor、tool decorator、handoff、memory、prompt/model binding。Agent Dependency Graph（ADG）把 agents/prompts/models/capabilities/memory/control policies 變成 typed nodes；論文在 5,399 個 real-world agent programs 上找到 238 個 taint-style prompt-to-tool risks。
   - Paper: https://arxiv.org/abs/2607.01640
   - Authors: Shenao Wang, Xinyi Hou, Yanjie Zhao, Xiao Cheng, Haoyu Wang
   - Year: 2026
   - Dataset: AgentZoo (5,399 programs)

5. **Communication-graph metadata 本身是 action side channel**：A2A/MCP payload 即使加密，誰在什麼時間聯絡哪個 capability-labeled endpoint，也可能洩漏 workflow class 與即將執行的 action。這意味著 Agent privacy 必須同時看 content plane 與 metadata/control plane。
   - Paper: https://arxiv.org/abs/2606.07150

## 本小時最重要 5 個發現

### 1. 黑箱 LLM 的 control dependence 可以用 counterfactual behavior 近似

已確認的論文方法：AgentSentry 不需要讀取 attention、hidden states 或 chain-of-thought；它在 tool-return boundary 固定 user goal 與 trajectory prefix，只改變/遮蔽候選 untrusted context，再重新執行下一步決策，觀察 action 是否改變。

可抽象為：

```text
State_t
+ UserGoal
+ ToolReturn_t
        ↓
Observed Next Action A

Counterfactuals:
ToolReturn_t → mask/remove/controlled variant
        ↓
A_1, A_2, ... A_k
        ↓
Action Divergence
        ↓
Estimated Context Causal Dominance
```

Hermes 合理工程推論：對 opaque model，`ProgramCounterLabel` 不必假裝是模型內部真實 pc；可改名為 `ObservedControlInfluence`，由 counterfactual probes、source provenance、trajectory state 合成。

限制：counterfactual re-execution 有 token/latency 成本；模型 sampling stochasticity 會造成 action divergence，因此需要 seed/temperature control、多次 sampling 或 semantic action equivalence，而不能把一次不同輸出直接當因果證據。

### 2. DisclosureBudget 應從「資料量」升級成 inference-leakage budget

OCELOT 指出多個看似無害的小 disclosure 可以累積成對 protected secret 的強 inference。

```text
Release_1 → posterior P(S | R1)
Release_2 → posterior P(S | R1,R2)
...
Release_t → posterior risk increases
```

所以 Hermes 的 budget 不應只有 bytes/token/field count，而要有：

```text
DisclosureBudget
├ protected_secret
├ sink_identity
├ sink_trust
├ prior_risk
├ cumulative_inference_cost
├ declassification_history
├ remaining_budget
└ ledger_ref
```

限制：真實世界 secret space 很大，posterior estimation 本身可能不準；因此這層應標成 risk estimator + deterministic accounting，而非「已證明零洩漏」。

### 3. ObservationEffect 必須和 MutationEffect 分開

Ghost Tool Calls 補上前面 transaction kernel 的盲點：transaction rollback 能阻止 mutation commit，卻無法讓外部 provider 忘記已收到的 speculative query。

```text
Planner branch speculation
↓
External Search(query="sensitive intent")
↓
Provider OBSERVED
↓
Branch abandoned
↓
No state mutation committed
BUT privacy effect already irreversible
```

新增：

```text
ObservationEffect
├ argument_projection
├ destination_projection
├ timing_projection
├ size_projection
├ issue_time
├ speculative_branch
└ observer
```

因此 `READ_ONLY` 不能再直接映射成 `SAFE_TO_SPECULATE`。

### 4. Static ADG + Dynamic Causal Trace 應該合併

AgentFlow 提供 static Agent Dependency Graph；AgentSentry 類方法提供 dynamic causal evidence。Hermes 可建立：

```text
Static ADG
Agents / Prompts / Models / Tools / Memory / Handoffs
        ↓ candidate paths
Dynamic Trace
actual tool calls / messages / memory reads
        ↓
Counterfactual Causal Probe
        ↓
Observed Influence Edge
```

這比單純 tracing 更接近「為什麼這個 action 發生」。

### 5. Side channel 是 Agent architecture 的一級資料流

至少要分：

```text
CONTENT CHANNEL
arguments / messages / artifacts

CONTROL CHANNEL
tool selected / agent selected / branch taken

METADATA CHANNEL
destination / timing / ordering / request size

TERMINATION CHANNEL
continue / abort / retry / commit
```

即使 payload 完全不含 secret，`Agent A → HighRiskLoanAgent` 或在特定時間呼叫某 endpoint，本身就可能洩漏 intent。

## Architecture Breakdown：Counterfactual Control-Flow Guard

```text
User Goal / GoalLock
↓
Planner Context
├ trusted instructions
├ untrusted web/email/image/audio/tool outputs
└ labelled memory
↓
Opaque LLM
↓
Candidate Action
↓
Control-Dependence Guard
├ identify newly introduced untrusted sources
├ generate controlled counterfactual contexts
├ shadow re-execute next-decision step
├ normalize actions to semantic equivalence classes
├ estimate action divergence / causal dominance
└ attach ObservedControlInfluence edges
↓
Policy Gate
├ ALLOW
├ PURIFY_CONTEXT
├ REPLAN
├ CONFIRM
└ DENY
↓
Issue-Time Privacy Gate
├ committed vs speculative
├ observer/destination
├ disclosure budget
└ observation effect
↓
Transaction Kernel
↓
Tool / MCP / A2A
↓
External World
```

### Runtime insertion point

最重要的 insertion point 是：

```text
Tool Result incorporated
↓
BEFORE next external action is issued
```

而 speculation 則更早：

```text
BEFORE speculative external I/O dispatch
```

## Bottom-Level Logic：Counterfactual Action Influence

對來源 `s_i` 與下一步 action `A`，Hermes 可先使用工程近似：

```text
A_base = Policy(Context)
A_cf_i = Policy(Context \ s_i)

Influence(s_i → A)
= semantic_distance(A_base, A_cf_i)
```

若 action 是 structured tool call，distance 不應用純文字 embedding，而拆成：

```text
D_action =
w_tool * I(tool_changed)
+ w_dest * destination_distance
+ w_args * argument_semantic_distance
+ w_effect * effect_class_distance
+ w_auth * authority_scope_distance
```

多次 sampling 時：

```text
P(A | C)
vs
P(A | do(remove s_i))
```

比較 action distribution divergence，而非單一 sample。

**已確認事實**：AgentSentry 使用 controlled counterfactual re-execution 做 temporal causal diagnostics。

**合理工程推論**：上述 exact metric 與 Hermes 權重設計是本研究提出的 implementation direction，不宣稱是 AgentSentry 原公式。

## Visual Simulation Idea：Causal Control-Flow Microscope × Side-Channel Observatory

畫面分四層：

```text
1. SOURCE LAYER
User / Web / Email / Image bbox / Audio interval / Memory / MCP

2. MODEL DECISION LAYER
Context → Opaque LLM → Candidate Action

3. COUNTERFACTUAL LAYER
Original        → send_email(B)
Remove Web #3   → search_docs()
Remove Email #2 → send_email(B)
Remove Image    → send_email(A)

4. EFFECT LAYER
Content Flow
Control Flow
Metadata Flow
Observation Effect
Mutation Effect
```

互動操作：點任一 source，UI shadow-run 下一步並顯示 `Action Influence 0–1`；切換 `Committed / Speculative`；顯示 observer 能看到 argument、destination、timing 的哪些 projection；調整 DisclosureBudget，觀察 runtime 從 ALLOW → REWRITE → LOCAL_SHADOW → DELAY → DENY。

## Code / GitHub

### hermes-console 歷史研究

本輪延續：
`data/ai-agent-research/2026-09-16-llmbda-control-dependence-multi-agent-ifc-multimodal-flow.md`

### AgentSentry

本輪找到論文與多個第三方整理/issue，但未找到可確認的作者官方公開 implementation，因此不做虛假的 directory-level code audit。下一輪若 code release，優先追：counterfactual runner、action normalizer、causal diagnostic、context purifier、AgentDojo adapter。

### AgentFlow

值得追的核心不是同名 workflow libraries，而是論文所述 static-analysis implementation：framework semantic extractors、ADG node/edge schema、prompt-to-tool taint analysis、AgentZoo ingestion。由於 GitHub 上 `AgentFlow` 同名 repository 很多，本輪未把搜尋到的同名專案錯認成論文官方 code。

## Papers

| Title | Year | Core Architecture | Contribution | Limitation |
|---|---:|---|---|---|
| AgentSentry: Mitigating Indirect Prompt Injection in LLM Agents via Temporal Causal Diagnostics and Context Purification | 2026 | Counterfactual re-execution + causal purification | 黑箱模型下定位 temporal causal takeover | shadow runs 成本；benchmark scope |
| OCELOT: Inference-Leakage Budgets for Privacy-Preserving LLM Agents | 2026 | Runtime mediator + witness-verified declassification + ledger | trajectory-level cumulative inference leakage | posterior/witness estimation assumptions |
| Ghost Tool Calls: Issue-Time Privacy for Speculative Agent Tools | 2026 | Speculative Tool Privacy Contracts | observation-before-commit 是獨立 privacy effect | 需 runtime/provider integration |
| AgentFlow: Building Agent Dependency Graphs for Static Analysis of Agent Programs | 2026 | Agent Dependency Graph | static recovery of agent-specific dependencies | static graph ≠ runtime causal truth |
| From Privacy to Workflow Integrity: Communication-Graph Metadata in Autonomous Agent Interoperability | 2026 | metadata threat model | A2A/MCP communication graph 可預測 workflow | transport/privacy tradeoffs |

## Unknown / Open Questions

1. **Counterfactual validity**：移除一段 context 可能讓 prompt distribution 本身變得不自然；如何建立 minimal intervention，而不是因 OOD context 造成假 divergence？
2. **Opaque-model stochasticity**：多少 shadow samples 才足以把 sampling noise 與真正 causal takeover 分開？是否可用 sequential testing 在 latency budget 內自適應停止？
3. **Cross-agent side-channel composition**：A2A payload labels 可以傳遞，但 destination/timing/termination metadata 的 privacy budget 如何跨多個組織與 transport accounting？

## 下一輪研究

優先研究：

```text
Counterfactual Validity
× Semantic Action Equivalence
× Sequential Causal Testing
× Speculative Execution Privacy
× KV-cache / inference side channels
× A2A metadata protection
```

特別補齊從 Agent Runtime 再往 Model/GPU infrastructure 的安全鏈：

```text
Agent Context
→ Model Router
→ Inference Server
→ Prefix/KV Cache
→ GPU Scheduler
→ Timing / Cache Side Channel
→ Cross-Tenant Observer
```

## Knowledge Graph 新增 Node / Edge

### Nodes

- `ObservedControlInfluence`
- `CounterfactualDecisionProbe`
- `ActionEquivalenceClass`
- `TemporalCausalTakeover`
- `ContextPurification`
- `InferenceLeakageBudget`
- `WitnessVerifiedDeclassification`
- `ObservationEffect`
- `IssueTimePrivacyGate`
- `SpeculativeToolPrivacyContract`
- `GhostToolCall`
- `IssuedTrace`
- `CommittedTrace`
- `MetadataSideChannel`
- `DestinationSideChannel`
- `TimingSideChannel`
- `AgentDependencyGraph`
- `StaticDynamicDependencyJoin`

### Edges

```text
UntrustedEvidence
→ MAY_CAUSALLY_INFLUENCE
CandidateAction

CounterfactualDecisionProbe
→ ESTIMATES
ObservedControlInfluence

ObservedControlInfluence
→ JUSTIFIES
ContextPurification

SpeculativeToolCall
→ CREATES
ObservationEffect

ObservationEffect
→ VISIBLE_TO
ExternalObserver

IssuedTrace
→ SUPERSET_OF
CommittedTrace

Release
→ CONSUMES
InferenceLeakageBudget

AgentDependencyGraph
→ PROPOSES_CANDIDATE_PATH_FOR
DynamicCausalTrace

DestinationSelection
→ LEAKS_VIA
MetadataSideChannel
```

## 本輪結束判斷

- **缺哪一層**：counterfactual probe 的統計校準，以及 Agent Runtime → inference server / KV cache / GPU scheduler 的 side-channel layer。
- **哪個節點最淺**：`ObservedControlInfluence`、`ActionEquivalenceClass`、`InferenceLeakageBudget` 的 production calibration。
- **哪個概念仍只是名詞**：跨 opaque multimodal models 的可證明 `Semantic Control Noninterference`。
- **哪個系統值得讀原始碼**：AgentSentry 官方 code 一旦公開最值得追；目前則優先追 AgentFlow 的 ADG extractor/analysis implementation 與現有 Fides/SPA runtime enforcement。
- **哪篇論文需追引用**：AgentSentry、OCELOT、Ghost Tool Calls。
- **哪個概念最適合視覺模擬**：Counterfactual Control-Flow Microscope，因為可以把「文字沒有流出去，但選擇被改變」直接視覺化。
- **哪個 Agent 架構最值得實作**：`Plan-first + labelled context + counterfactual pre-action guard + issue-time privacy gate + transaction kernel` 的混合 Runtime。

## 對「AI 到底怎麼運作」新增的一層

```text
User / Camera / Image / Voice / Video
→ Encoder / OCR / ASR
→ Evidence + Provenance
→ Context Partition
→ Opaque Model Reasoning
→ Candidate Action
→ Counterfactual Control-Dependence Probe
→ Agent / Tool / Destination Selection
→ Issue-Time Privacy Gate
→ Transaction Kernel
→ MCP / A2A / Tool
→ External World
→ Labelled Observation
→ Memory
```

但這還不是最底：下一輪要繼續往下追 `Model Router → Inference Server → KV Cache → GPU Scheduler`，因為即使 Agent 層 payload 與 action 都被 IFC 保護，shared inference infrastructure 的 timing/cache behavior 仍可能形成另一條資料外洩路徑。
