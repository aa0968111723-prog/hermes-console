# 【AI Agent × Multimodal Research Report】

**時間：2026-09-22 21:51 Asia/Taipei**  
**本輪主題：A2A Handoff × Task/Context Identity × Delegated Authority × Provenance Contract**

## 與歷史研究比較

上一輪已建立 `CompactedContextGeneration → HandoffTransformGeneration → ReceivingAgentContextGeneration`，並指出 `HandoffAuthorityProjection` 與 `StructuredProvenanceSidecar` 尚缺跨框架、跨程序的 production contract。本輪不再重複 compaction，而是跨越 process/framework boundary，研究 A2A v1.0 類型的 remote-agent delegation：handoff 一旦離開同一 runtime，`sender agent / receiver agent / context / task / message / artifact / credential / authority` 必須拆成不同 identity domain。

本輪核心問題：**Agent A 把任務交給 Agent B 時，B 如何知道「這是同一個使用者意圖的哪一代任務、哪些 context 可以相信、哪些權限真的被委派、哪些內容只是資料而不是 instruction」？**

---

## 本小時新發現

### 新架構：A2A v1.0 作為 Agent-to-Agent horizontal orchestration layer

A2A Protocol 於 2026-03-12 宣布 v1.0 production-ready。官方將 A2A 定位為 agent-to-agent 的 horizontal orchestration layer，而 MCP 偏向 agent-to-tool/context 的 vertical integration layer。v1.0 支援多 protocol bindings、version negotiation、multi-tenancy、signed Agent Cards，以及 polling / streaming / webhooks 等非同步交付模式。

來源：
- https://a2a-protocol.org/dev/blog/2026/03/12/a2a-protocol-ships-v10-production-ready-standard-for-agent-to-agent-communication/
- https://a2a-protocol.org/dev/specification/

### 新 security architecture：WebMCP-Phalanx

**Title:** WebMCP-Phalanx: Enforcing and Characterizing Trust Boundaries for Browser-Integrated LLM Agents  
**Authors:** Lin-Fa Lee, Yi-Yu Chang, Kuo-Hui Yeh  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2608.24017  
**Architecture:** browser-native trust anchor + provenance labels + Quarantine LLM (no tool authority) + Privileged LLM  
**Contribution:** 將 provenance/ownership 與 semantic inspection 分層，避免檢查 untrusted tool metadata 的模型同時持有 privileged tool authority。  
**Reported result:** browser ownership mechanism 將 revocation/overwrite attacks 由 100% 降至 0%；dual-agent runtime 對 tool-description injection 阻擋 80/80，但 adaptive attacker 可利用 tool-name/call timing 繞過，顯示必須有 pre-invocation timing gate。  
**Limitation:** browser/WebMCP 特定場景；semantic filter 仍不是 deterministic proof。

### 新 multi-agent provenance研究：Delegation Contracts

**Title:** The Provenance Paradox in Multi-Agent LLM Routing: Delegation Contracts and Attested Identity in LDP  
**Author:** Sunil Prakash  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2603.18043  
**Architecture:** delegation contract + claimed-vs-attested identity + typed failure semantics  
**Contribution:** 顯示 routing 不應相信 delegate 自報 quality；delegation contract應顯式限制 objective、budget、failure policy。  
**Limitation:** controlled routing experiments；尚不能視為通用 production authority protocol。

---

## 本小時最重要 5 個發現

### 1. `contextId` 不是 authority identity

A2A 的 `contextId` 用於邏輯群組多個 Task/Message，讓 server 維持 conversational continuity；`taskId` 則識別 stateful work unit。規格要求 taskId/contextId mismatch 應拒絕。

但：

`SameContextId --does_not_prove→ SameAuthorityGeneration`

`SameTaskId --does_not_prove→ SameUserApprovalGeneration`

原因是 context/task 解決的是 correlation/state continuity，不是 authorization provenance。Receiver 必須另外取得 delegated authority envelope。

### 2. Agent Card 能證明「對方是誰/宣告什麼」，不能證明「這次可以做什麼」

A2A v1.0 加入 signed Agent Cards，提升 remote-agent identity/capability metadata 的可驗證性。但 signed card 最多建立：

`AgentIdentity + DeclaredCapabilities + Endpoint/Protocol Metadata`

不能直接推出：

`TaskSpecificAuthority`

因此新增：

`SignedAgentCard --does_not_prove→ AuthorizedDelegationForTask`

### 3. Handoff payload 必須把 content 與 authority 分離

實際 A2A/Teams handoff 範例會傳 structured payload，包括 user identity、tenant/service endpoint 與 conversation summary。這證明 remote handoff 本質上不是只傳一段 prompt，而是 identity + routing + summary 的 structured transfer。

Hermes 需要再往前一步：summary 不得自行攜帶 authority。

建議 wire-level contract：

```text
HandoffEnvelope = {
  delegation_id,
  sender_agent_identity,
  receiver_agent_identity,
  user_principal_ref,
  source_context_id,
  source_task_id,
  handoff_generation,
  task_objective,
  allowed_actions,
  resource_constraints,
  budget_constraints,
  expiry,
  approval_requirements,
  provenance_sidecar_ref,
  data_labels,
  summary_content,
  signature_or_attestation
}
```

其中 `summary_content` 永遠是 data；只有 `delegated_authority` 結構可形成 executable authority。

### 4. Remote-agent handoff 是 distributed state transition，不是一條 message edge

真正流程應拆成：

`Sender Task State`
→ `Handoff Decision`
→ `Receiver Discovery / AgentCard Verification`
→ `Delegation Contract Construction`
→ `Authority Projection`
→ `Context/Provenance Projection`
→ `A2A Message Transport`
→ `Receiver Admission Gate`
→ `Receiver Task Creation`
→ `Receiver Local Planning`
→ `Tool/MCP Invocation`
→ `Artifact/Result Publication`
→ `Sender Observation Commit`

這裡至少有三個 commit boundary：

1. Delegation commit
2. Receiver task admission commit
3. Result/artifact observation commit

因此：

`MessageDelivered --does_not_prove→ DelegationAccepted`

`DelegationAccepted --does_not_prove→ SideEffectAuthorized`

`RemoteTaskCompleted --does_not_prove→ ResultCommittedIntoSenderContext`

### 5. Multi-agent routing quality本身也需要 provenance

Delegation Contracts 研究顯示 self-claimed quality 可能使 routing 比 random 更差，而 attested routing 表現較佳。Hermes 因此不能只保存：

`AgentSkill(description="expert in X")`

還要分：

`ClaimedCapability`
`ObservedCapability`
`AttestedCapability`
`BenchmarkEvidence`
`CapabilityEvidenceGeneration`

新增 invariant：

`RoutingDecision = TaskRequirements × AttestedCapabilities × AuthorityCompatibility × DataPolicyCompatibility × Cost/LatencyBudget`

而非只做 semantic similarity。

---

# Architecture Breakdown

## A2A Delegation Architecture

```text
User Intent
  ↓
Trusted Task/Authority Compiler
  ↓
Sender Agent Runtime
  ├─ ContextGeneration
  ├─ TaskGeneration
  ├─ ProvenanceSidecar
  └─ AuthorityEnvelope
  ↓
Agent Discovery
  ↓
AgentCard Verification
  ↓
Receiver Selection
  ↓
Delegation Contract
  ↓
A2A Transport
  ↓
Receiver Admission PEP
  ├─ Sender Identity Verify
  ├─ Delegation Signature/Attestation Verify
  ├─ Expiry/Budget Verify
  ├─ Authority Projection Verify
  ├─ Data Label / Sink Policy Verify
  └─ Task/Context Correlation Verify
  ↓
Receiver Task State Machine
  ↓
Local Planner / Model
  ↓
MCP / Tool PEP
  ↓
Side Effect Transaction
  ↓
Artifact / Task Result
  ↓
Result Provenance Verification
  ↓
Sender Observation Commit
```

## Framework/protocol comparison

### A2A
強項：跨 framework/process、Agent Card、Task lifecycle、Message/Part/Artifact、async delivery。  
缺口：core protocol 的 context/task correlation 不等同 fine-grained task authority or information-flow proof。

### LangGraph-style local handoff
強項：graph state、explicit routing/state transition、checkpoint causality。  
缺口：local graph transition本身不證明跨 trust-domain delegation authority。

### AutoGen-style message routing
強項：agent-to-agent conversational routing與tool/code execution abstraction。  
缺口：message sender/recipient與conversation context不應被當作完整 authorization provenance。

### MCP
強項：Agent→Tool/Resource boundary、transport/auth/tool contract。  
與 A2A 關係：A2A 解決 peer agent delegation；MCP 解決 receiver agent 內部向 tools/context 的 vertical integration。兩者交界正是 Hermes 應追的 authority propagation boundary。

---

# Bottom-Level Logic

## Remote handoff admission algorithm

```text
Receive A2A envelope
→ Parse transport identity
→ Resolve sender AgentCard
→ Verify card/signature/endpoint binding
→ Resolve delegation_id
→ Verify delegation attestation
→ Verify expiry / replay nonce
→ Resolve user principal
→ Validate source context/task correlation
→ Canonicalize task objective
→ Intersect sender delegated authority with receiver policy
→ Intersect data labels with receiver/sink policy
→ Validate budget / delegation depth
→ Create ReceiverTaskGeneration
→ Bind provenance sidecar
→ Expose only admitted context to receiver model
→ Model proposes action
→ Non-LLM PEP rechecks authority at tool boundary
→ MCP/tool execution
→ Durable side-effect receipt
→ Result provenance binding
→ A2A artifact/result
→ Sender verifies result provenance
→ ObservationCommit
```

核心公式：

```text
ReceiverEffectiveAuthority =
  UserAuthority
  ∩ SenderDelegatedAuthority
  ∩ DelegationContract
  ∩ ReceiverPolicy
  ∩ ResourcePolicy
  ∩ DataFlowPolicy
  ∩ CurrentApprovalGeneration
```

永遠不能：

```text
ReceiverEffectiveAuthority > SenderDelegatedAuthority
```

即：

`Delegation --must_not_expand→ Authority`

## Identity domains

```text
UserPrincipalIdentity
≠ SenderAgentIdentity
≠ ReceiverAgentIdentity
≠ AgentCardGeneration
≠ DelegationIdentity
≠ A2AContextIdentity
≠ A2ATaskIdentity
≠ A2AMessageIdentity
≠ ArtifactIdentity
≠ MCPToolInvocationIdentity
≠ ExternalSideEffectReceipt
```

這些 identity 必須能 join，但不能 collapse。

---

# Visual Simulation Idea

## A2A Delegation & Authority Microscope

Hermes Console 新增互動式 8-lane timeline：

1. User / Authority
2. Sender Agent
3. Agent Discovery / AgentCard
4. A2A Transport
5. Receiver Admission PEP
6. Receiver Agent
7. MCP / Tool Runtime
8. External Side Effect / Result

每個 packet 顯示：

`contextId | taskId | delegationId | sender | receiver | authorityGeneration | provenanceGeneration | dataLabels | expiry | budget | resultReceipt`

可注入 failure：

- `SIGNED_AGENT_CARD_BUT_UNAUTHORIZED_TASK`
- `CONTEXT_ID_REUSE_WITH_NEW_AUTHORITY`
- `TASK_CONTEXT_MISMATCH`
- `HANDOFF_SUMMARY_AUTHORITY_LAUNDERING`
- `RECEIVER_AUTHORITY_EXPANSION`
- `SELF_CLAIMED_CAPABILITY_ROUTING_ATTACK`
- `STALE_DELEGATION_REPLAY`
- `REMOTE_TASK_COMPLETE_BUT_RESULT_PROVENANCE_MISSING`
- `A2A_TO_MCP_AUTHORITY_BINDING_LOST`

UI 核心狀態：

```text
Agent Identity ✓
Task Correlation ✓
Delegation Attestation ✓
Authority Projection ✓
Data Policy ✓
MCP Binding ✗
Side Effect BLOCKED
```

---

# Code / GitHub

值得追的官方/核心程式碼：

- A2A Python SDK: https://github.com/a2aproject/a2a-python
- A2A JS SDK: https://github.com/a2aproject/a2a-js
- LangGraph: https://github.com/langchain-ai/langgraph

下一輪原始碼閱讀優先：

1. A2A Python server request handler / task store / event queue
2. A2A AgentCard resolver與auth middleware
3. task/context validation與streaming event publication
4. LangGraph `Command` / graph routing / checkpoint write path
5. A2A task → receiver local graph state 的 adapter boundary

---

# Papers

## 1. WebMCP-Phalanx

- Title: WebMCP-Phalanx: Enforcing and Characterizing Trust Boundaries for Browser-Integrated LLM Agents
- Authors: Lin-Fa Lee, Yi-Yu Chang, Kuo-Hui Yeh
- Year: 2026
- URL: https://arxiv.org/abs/2608.24017
- Architecture: browser trust anchor + capability credential + provenance label + quarantine/privileged dual agent
- Contribution: 把 provenance enforcement 與 semantic inspection分層
- Limitation: semantic filtering仍可被 adaptive attack挑戰
- 改變了什麼：證明 privileged execution agent 不應直接消化所有 untrusted tool metadata；inspection與authority應分離。

## 2. The Provenance Paradox in Multi-Agent LLM Routing

- Title: The Provenance Paradox in Multi-Agent LLM Routing: Delegation Contracts and Attested Identity in LDP
- Author: Sunil Prakash
- Year: 2026
- URL: https://arxiv.org/abs/2603.18043
- Architecture: delegation contracts + claimed/attested identity + typed failure
- Contribution: routing evidence本身需要 provenance；self-claimed capability不能直接信任
- Limitation: controlled experiments，仍需更廣泛 production replication
- 改變了什麼：將 agent selection 從 semantic matching 提升成 evidence-backed delegation decision。

## 3. Agentic Electronic Design Automation: A Handoff Perspective

- Authors: Jiawei Liu, Peiyi Han, Yuntao Lu, Su Zheng, Fengyu Yan, Bei Yu
- Year: 2026
- URL: https://arxiv.org/abs/2606.19795
- Dataset/scope: survey of 115 representative systems
- Contribution: 以 handoff object provenance與consumer boundary分類 agentic systems
- Limitation: EDA domain survey，不是 general security protocol
- 改變了什麼：支持「handoff object」本身應成為 first-class architecture entity，而非只把 multi-agent 看成 message passing。

---

# Unknown / Open Questions

1. A2A v1.0 signed Agent Card identity如何與每次 delegation 的 user/task-specific authority 做標準化 cryptographic binding？Agent identity attestation 與 task authority attestation目前仍是不同層。
2. `contextId/taskId` 穿越多 agent、多 tenant、長時間 async task 時，authority expiry/revocation如何即時傳播？
3. A2A receiver 再透過 MCP 呼叫 tool 時，如何保證 `DelegationIdentity → MCPToolInvocationIdentity → ExternalReceipt` 不丟失？這是目前最關鍵缺口。

---

# 下一輪研究

鎖定：

```text
A2A DelegationIdentity
→ ReceiverTaskGeneration
→ Receiver LangGraph/Runtime State
→ Tool Intent
→ MCP InvocationIdentity
→ OAuth/Scope
→ SideEffect Transaction
→ Durable Receipt
→ A2A ArtifactGeneration
→ Sender ObservationCommit
```

優先追 A2A Python SDK 的 server/task/event queue 原始碼，並建立跨 A2A ↔ MCP 的 end-to-end trace identity contract。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

- `A2AAgentCardGeneration`
- `A2AAgentIdentityAttestation`
- `A2ADelegationIdentity`
- `A2ADelegationContractGeneration`
- `A2AContextIdentity`
- `A2ATaskIdentity`
- `A2ATaskGeneration`
- `A2AMessageIdentity`
- `A2AArtifactGeneration`
- `ReceiverAdmissionGeneration`
- `ReceiverEffectiveAuthority`
- `DelegationAuthorityProjectionWitness`
- `DelegationReplayWitness`
- `ClaimedCapabilityGeneration`
- `AttestedCapabilityGeneration`
- `CapabilityEvidenceGeneration`
- `A2AToMCPAuthorityBindingWitness`
- `RemoteResultProvenanceWitness`

## Edges

```text
UserAuthority --bounds→ SenderDelegatedAuthority
SenderDelegatedAuthority --projected_into→ A2ADelegationContractGeneration
A2AAgentCardGeneration --attests_identity_of→ ReceiverAgentIdentity
A2ADelegationContractGeneration --does_not_equal→ A2AContextIdentity
A2AContextIdentity --groups→ A2ATaskIdentity
A2ATaskIdentity --produces→ A2AArtifactGeneration
A2ADelegationContractGeneration --bounds→ ReceiverEffectiveAuthority
ReceiverEffectiveAuthority --must_not_exceed→ SenderDelegatedAuthority
ReceiverAdmissionGeneration --verifies→ DelegationAuthorityProjectionWitness
ClaimedCapabilityGeneration --does_not_prove→ AttestedCapabilityGeneration
AttestedCapabilityGeneration --supports→ RoutingDecision
ReceiverEffectiveAuthority --must_bind_to→ MCPToolInvocationIdentity
MCPToolInvocationIdentity --produces→ ExternalSideEffectReceipt
ExternalSideEffectReceipt --provenance_bound_to→ A2AArtifactGeneration
A2AArtifactGeneration --requires→ RemoteResultProvenanceWitness
RemoteResultProvenanceWitness --authorizes→ SenderObservationCommit
```

---

# 本輪結束判斷

**缺哪一層：** `A2A DelegationIdentity → MCP ToolInvocationIdentity → ExternalSideEffectReceipt` 的 end-to-end production binding。  
**哪個節點最淺：** `A2AToMCPAuthorityBindingWitness`。  
**哪個概念仍只是名詞：** portable、cross-vendor 的 `A2ADelegationContractGeneration` schema。  
**哪個系統值得讀原始碼：** `a2aproject/a2a-python`，特別是 server request handler、task store、event queue、AgentCard/auth path。  
**哪篇論文需追引用：** WebMCP-Phalanx，其 provenance label + privileged/unprivileged model separation可直接延伸到 remote handoff。  
**哪個概念最適合視覺模擬：** A2A Delegation & Authority Microscope。  
**哪個 Agent 架構最值得實作：** `State-grounded Planner + Trusted Delegation Compiler + Signed/Attested Agent Discovery + Receiver Admission PEP + Authority Projection + Provenance Sidecar + A2A→MCP Binding + Side-Effect Transaction Manager + Result Provenance Gate`。

本輪核心結論：**Multi-Agent handoff 不是把一段 summary 丟給另一個模型。Production handoff 是一個 distributed delegation transaction。`AgentCard`、`contextId`、`taskId`、message、artifact、credential、delegated authority與external side-effect receipt都是不同 identity domain；Hermes 下一階段必須把它們串成可驗證但不可混同的 provenance chain。**