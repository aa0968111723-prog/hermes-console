# 【AI Agent × Multimodal Research Report】

時間：2026-09-15 23:54（Asia/Taipei）

主題：Fides Gateway × Scope-Bound Declassification × Context Partitioning × Multi-Agent IFC × Multimodal Taint

## 本小時新發現

本輪承接上一輪 Runtime Information Flow / Semantic Taint，不再重複「Tool Permission ≠ Data Permission」，而是研究五個尚未閉合的問題：IFC 如何真正進 MCP runtime、如何安全 declassify、如何避免 persistent context 再污染 planner、multi-agent 如何限制二次轉傳，以及 image/audio 等非文字來源如何進入同一 flow graph。

已確認的新系統包括 Microsoft Fides Gateway、SPA（Plan-First Information-Flow Control）、GIF（Geometric Information Flow）與 MNC（Minimum-Necessary Communication）。其中 Fides Gateway 已有可讀原始碼；GIF/MNC/SPA 為論文級結果，不能外推成 production universal guarantee。

## 本小時最重要 5 個發現

### 1. Fides 已從概念 IFC 走到 MCP Gateway enforcement point

官方 Fides Agent Framework 說明將 confidentiality / integrity label 作為 first-class middleware，label 隨 tool calls 傳遞，敏感工具執行前做 deterministic policy enforcement。Fides Gateway 則是 multi-server MCP proxy：每個 upstream server 被掛在 gateway 下，tool call 的 IFC labels 放在 `_meta["com.github.ifc/labels"]`，以 RFC 9535 JSONPath 指向 name、arguments 或 nested field；Rego policy 可透過 `eval_policy` 對 proposed call 做判斷。

原始碼值得看的檔案：
- `fastmcp_proxy.py`：proxy / eval_policy tool wiring
- `middleware.py`：Tool annotations 與 policy middleware
- `policy_engine.py`：labelled MCP call、effective label resolution、Rego evaluation
- `lattice.py`：IFC lattice / join
- `label_conversion.py`：跨 gateway label translation
- `mcp_result.py`：structured result extraction
- `policies/`：policy artifacts

Bottom-level flow：

MCP Tool Result → structured value → JSONPath label → Context / next tool argument → labelled ToolCall → effective-label resolution → Rego predicate → ALLOW / DENY → upstream MCP call。

重要限制：Fides Gateway 的 result-side `LabeledToolResult` 在目前 `policy_engine.py` 註解中仍標示 runtime 未直接 parse 使用；因此不能把目前 prototype 描述成完整 end-to-end field-sensitive IFC proof。

來源：https://devblogs.microsoft.com/agent-framework/fides/ ; https://github.com/microsoft/fides-gateway

### 2. Declassification 不能等於「LLM 改寫一下」；必須綁 scope

MNC（Xu, Fan, Wang, Li, Liu, 2026）提出 Minimum-Necessary Communication。核心不是單純 redact，而是從 application-authored candidate family 選 task-sufficient disclosure，並綁定 recipient、purpose、forwarding、lifetime、logging、memory scopes，再由 reference monitor 持續 enforce。

因此 Hermes 應新增：

DeclassificationGrant {
 source_labels,
 disclosed_semantics,
 recipient_scope,
 purpose_scope,
 forwarding_scope,
 logging_scope,
 memory_scope,
 expires_at,
 authority,
 history_budget
}

關鍵關係：
Summarization ≠ Sanitization ≠ Declassification；Declassification ≠ Unlimited Reuse。

論文結果顯示，同樣的 receipt text 下，scope-bound mediation 能阻止未授權 forwarding、logging、durable storage 與 expiration 後 retrieval；但這是其 controlled experiments / MAGPIE executions 的結果，不是任意 agent ecosystem 的形式化保證。

Paper：MNC: Scope-Bound Semantic Declassification for Private LLM-Agent Communication；Authors: Jinghan Xu, Longze Fan, Zeyuan Wang, Xinjin Li, Hankai Liu；Year: 2026；URL: https://arxiv.org/abs/2608.01719

### 3. Persistent Agent 最安全的 Context 不一定是「把所有過去內容重新塞給 Planner」

SPA（Girrens, Wang, 2026）採 plan-first architecture：每 query planner 先產生完整 declarative plan，再由 dual-lattice IFC 追 confidentiality / integrity 的 explicit flows 與 control dependencies。持久化結果存成 labelled artifacts；後續 planning 只揭露 semantic metadata，避免把原始 untrusted payload 再次送回 planner。

因此 Hermes 的 Context Manager 應區分：
RAW_ARTIFACT / LABELLED_ARTIFACT / SEMANTIC_METADATA / PLANNER_VISIBLE / EXECUTOR_VISIBLE。

新原則：Memory Available ≠ Planner Visible。

這可以降低 delayed prompt injection 經 memory 在下一 query 重新控制 planner 的風險。SPA 在 AgentDojo 與其 AgentDojo-MQ multi-query extension 上報告 tool_knowledge attack 下 ASR 分別降到 0 與 0.2%；此數字只代表該 benchmark/configuration。

Paper：SPA: Securing Persistent LLM Agents Across Queries with Plan-First Information-Flow Control；Authors: Dylan Girrens, Guangjing Wang；Year: 2026；URL: https://arxiv.org/abs/2608.27234

### 4. 傳統 monotonic taint 在 LLM 內會 taint explosion；GIF 嘗試量化「真的影響了多少」

GIF（Storek, Holzer, Zhang, Jana, 2026）把 input span 對 output 的 influence 建模成局部資訊流。核心物件是 Fisher pullback：
M_T(x)=J_T(x)^T W^T F_softmax W J_T(x)

Influence proxy：tr(M_T)。更完整 capacity：0.5 log det(I + τM_T)。系統用 Hutch++ 估 trace，避免完整 Jacobian/Fisher matrix 成本。論文提供 Lean 4 mechanized local soundness argument，並報告小 surrogate model 的 flow estimate 可轉移到更大模型；但 soundness 是 local/asymptotic，並不等於 global semantic noninterference。

這給 Hermes 一個混合策略：
Conservative Source Taint → potential flow；GIF-like influence → estimated causal/semantic contribution；Declassifier → allowed semantic release；Runtime IFC → final deterministic gate。

Paper：GIF: Locally Sound Geometric Information Flow Control for LLMs；Authors: Adam Storek, Nikolaus Holzer, Zhuo Zhang, Suman Jana；Year: 2026；URL: https://arxiv.org/abs/2606.23277

### 5. Multimodal taint 必須貼在 evidence unit，而不是只貼文字 token

2026 ACL Reference Attack 顯示 malicious instruction 可藏在 image/spreadsheet，再靠 text 中 recursive symbolic reference 讓 MLLM 重建指令；AudioAgentSecurity 類研究也顯示 ambient/concurrent audio 可成為 prompt-injection source。因此 Hermes 的 IFC source unit 必須延伸：

ImageRegionLabel {asset_id,bbox,source,integrity,confidentiality}
VideoIntervalLabel {asset_id,t0,t1,regions,source,...}
AudioIntervalLabel {asset_id,t0,t1,speaker/source,...}
DocumentCellLabel {sheet,page,cell/region,...}
ToolFieldLabel {execution_id,jsonpath,...}

Cross-modal alignment 產生的新 representation 不應自動變 trusted。Encoder/Fusion/Caption/Summary 應建立 DERIVED_FROM edges，預設 integrity 取 join / conservative propagation，除非有明確 declassification/endorsement authority。

## Architecture Breakdown

建議 Hermes 新增 `Information Flow Security Kernel`：

Sources (User/Web/Email/Image/Audio/Video/MCP/Memory)
→ Evidence-unit Labels
→ Provenance Graph
→ Context Partitioner
→ Planner View (metadata/minimum necessary)
→ Plan IR
→ Executor
→ Semantic Influence Estimator (optional)
→ Declassification Monitor
→ Tool Argument Labels
→ Fides-like MCP Policy Gateway
→ Capability Lease / Transaction Kernel
→ Tool/MCP
→ Labelled Result
→ Persistent Artifact Store

Multi-Agent 時，每個 A2A message 都應是 typed flow object，而非裸字串：sender, recipient, purpose, labels, forwarding policy, memory policy, expiry, provenance refs。

## Bottom-Level Logic

完整安全路徑應拆成：
Source → modality-specific evidence unit → provenance label → confidentiality/integrity lattice → context partition → planner-visible metadata → plan → data/control dependency → semantic influence estimate → declassification check → destination/purpose check → labelled tool argument → Rego/runtime IFC decision → tool execution → labelled observation → persistent-state policy。

Model reasoning 與 System reasoning 必須分開：模型可以提出任意文字/計畫；真正 IFC enforcement 由 deterministic runtime reference monitor 完成。

## Visual Simulation Idea

### Multimodal Information-Flow Microscope × Declassification Lab

左側顯示來源：Email、Web、Image bbox、Video interval、Audio interval、MCP field、Memory artifact；中間顯示 Context → Planner → Agent A → Agent B → Tool 的 flow graph；每條 edge 顯示 confidentiality/integrity、semantic influence、purpose、expiry。

互動控制：
- 切換 RAW vs METADATA planner view
- 在 image bbox / audio interval 注入 untrusted instruction
- 調整 monotonic taint vs GIF-like influence threshold
- 建立一次性 DeclassificationGrant
- 嘗試 forward / log / memory write / external egress
- 模擬 grant expiry 與 cross-session retrieval

右側同時顯示：Tool Permission、Data Flow Permission、Declassification Scope、Memory Scope、Forwarding Scope、Final Decision。

## Code / GitHub

首要原始碼：Microsoft Fides Gateway — https://github.com/microsoft/fides-gateway

本輪確認其 repo 不只是 README：核心包含 `fastmcp_proxy.py`, `gateway.py`, `middleware.py`, `policy_engine.py`, `lattice.py`, `label_conversion.py`, `mcp_result.py`, `output_schema.py`, `policies/`。下一輪值得繼續讀 `lattice.py` 的 lattice semantics、`fastmcp_proxy.py` 的 actual dispatch ordering，以及 policies 的 Rego rule shape。

## Papers

1. GIF: Locally Sound Geometric Information Flow Control for LLMs — Adam Storek, Nikolaus Holzer, Zhuo Zhang, Suman Jana — 2026 — https://arxiv.org/abs/2606.23277 — Contribution: quantitative/local-sound LLM information-flow signal；Limitation: local/asymptotic, not global noninterference.
2. MNC: Scope-Bound Semantic Declassification for Private LLM-Agent Communication — Jinghan Xu, Longze Fan, Zeyuan Wang, Xinjin Li, Hankai Liu — 2026 — https://arxiv.org/abs/2608.01719 — Contribution: typed minimum-necessary disclosure + reuse scopes；Limitation: candidate-family/application policy dependence.
3. SPA: Securing Persistent LLM Agents Across Queries with Plan-First Information-Flow Control — Dylan Girrens, Guangjing Wang — 2026 — https://arxiv.org/abs/2608.27234 — Contribution: plan-first dual-lattice IFC + labelled persistent artifacts；Limitation: strict integrity has utility tradeoff and benchmark scope.
4. Reference Attack: A New Cross-Modal Jailbreaking Attack against Multimodal Large Language Models — Yulong Wang, Yifei Fu, Jiayi Gao — ACL 2026 — https://aclanthology.org/2026.acl-long.812/ — Contribution: cross-modal recursive reference attack；Limitation: attack evaluation does not itself provide an IFC solution.

## Unknown / Open Questions

1. 如何把 GIF 類 local influence signal 與 deterministic lattice IFC 結合，而不讓 probabilistic estimator 成為安全 bypass？
2. Declassification 的「minimum necessary」如何在開放式 Agent 任務中自動產生 candidate family，同時避免 LLM 自己擴張授權？
3. Image/audio/video 經 encoder、OCR、ASR、caption、fusion 後，什麼粒度的 lineage 才能兼顧 soundness、VRAM/token cost 與 runtime latency？

## 下一輪研究

優先研究 `Fides Gateway lattice/policy dispatch internals × LLMbda formal semantics × control-dependence taint × declassification authority × A2A forwarding policy`，並把 information-flow layer 接回 Hermes 的 Transaction Kernel：資訊可以流到某 Tool，不代表 Tool effect 已被授權；反之 Tool 有 authority，也不代表當前資料有資格流入該 Tool。

## Knowledge Graph 新增 Node / Edge

Nodes：FidesGateway, LabeledMCPCall, FieldSensitiveLabel, ContextPartition, PlannerVisibleMetadata, ScopeBoundDeclassification, DeclassificationGrant, ForwardingScope, MemoryScope, PurposeScope, HistoryAwareDisclosureBudget, GeometricInformationFlow, FisherPullback, LocalFlowCapacity, MultimodalTaintUnit, ImageRegionLabel, AudioIntervalLabel, VideoIntervalLabel, A2AFlowEnvelope, PersistentLabelledArtifact。

Edges：EvidenceUnit --DERIVED_FROM--> Source；DerivedRepresentation --INHERITS_LABEL_FROM--> EvidenceUnit；PlannerView --EXPOSES_METADATA_OF--> PersistentArtifact；DeclassificationGrant --AUTHORIZES_FLOW_TO--> Recipient/Purpose；A2AMessage --FORWARDABLE_UNDER--> ForwardingScope；ToolArgument --LABELLED_BY--> IFCLabel；RuntimePolicy --GATES--> ToolCall；GIFSignal --ESTIMATES_INFLUENCE_FROM--> SourceSpan；MCPResult --PERSISTS_AS--> LabelledArtifact。

## 本輪結束判斷

缺哪一層：formal control-dependence / implicit-flow enforcement 與 production-grade declassification authority。

哪個節點最淺：HistoryAwareDisclosureBudget、MultimodalTaintUnit、A2AFlowEnvelope。

哪個概念仍只是名詞：跨模態、跨模型、跨 Agent 的 global Semantic Noninterference。

哪個系統值得讀原始碼：Microsoft Fides Gateway，下一步讀 `lattice.py → policy_engine.py → fastmcp_proxy.py → policies/`。

哪篇論文需追引用：GIF 與 MNC；GIF 連接 quantitative information flow / formal semantics，MNC 連接 declassification / multi-agent privacy。

哪個概念最適合視覺模擬：Multimodal Information-Flow Microscope × Scope-Bound Declassification。

哪個 Agent 架構最值得實作：Plan-first Context Partition + labelled artifacts + Fides-like MCP gateway + scope-bound declassification reference monitor。

最終鏈路新增：Camera/Image/Voice/Video → Encoder/OCR/ASR → Evidence Units → Labels/Provenance → Context Partition → Planner Metadata → Reasoning/Plan → Semantic Influence → Declassification → Tool Argument Labels → MCP IFC Gateway → Transaction Kernel → Action → Labelled Observation → Memory。