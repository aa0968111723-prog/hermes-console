# 【AI Agent × Multimodal Research Report】

**時間：2026-09-23 06:55（Asia/Taipei）**

**本輪主題：MCP Tool Safety Capability Attestation × Risk-Aware Tool Router × Modern Stateless MCP**

## 歷史研究比較

上一輪已建立 `FenceAuthorityEpoch` 與 `ToolWriteCapability` 概念，並指出 MCP `readOnlyHint / destructiveHint / idempotentHint / openWorldHint` 只是 hints。本輪不重複 fencing correctness，而是往前推進到「工具被模型選中以前，runtime 如何把 claimed metadata、runtime evidence、authorization、approval 與 side-effect guarantees 編譯成可執行的安全決策」。

研究鏈：

`User Intent → Candidate Tools → tools/list metadata → Claimed Capability → Server Trust → Capability Evidence → Risk Requirement → Policy Match → Approval Gate → tools/call → Schema Validation → Handler → Side Effect Adapter → Receipt → Observation`

---

## 本小時新發現

### 1. MCP ToolAnnotations 是風險詞彙，不是 enforcement contract【官方資訊】

MCP 2026 官方 Tool Annotations 說明再次明確區分 hint 與 contract：`readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint` 都是 server 宣告的 behavior hints；未受信任 server 可以說謊。安全保證應放在 authorization、transport、sandbox、runtime policy 或 resource enforcement，而不是 boolean annotation。

因此：

`ToolAnnotationClaim --does_not_prove→ ToolBehaviorGuarantee`

`idempotentHint=true --does_not_prove→ ExternalIdempotencyKeyBound`

`readOnlyHint=true --does_not_prove→ NoSideEffectPossible`

### 2. TypeScript SDK 原始碼/文件確認 annotations 不改變 tool execution【工程實作】

MCP TypeScript SDK 的 `registerTool(name, config, handler)` 將 schema 用於模型可見 JSON Schema、argument validation 與 handler typing；`outputSchema` 可驗證 structured output。但 annotations 僅描述工具給 client，SDK 文件明確指出 annotations 不會改變 SDK 如何執行工具。官方範例甚至將 destructive `clear-catalog` 標成 `idempotentHint: true`，說明「destructive」與「idempotent」是正交維度。

值得讀的核心路徑：

- `docs/servers/tools.md`
- `examples/guides/servers/tools.examples.ts`
- `packages/server/src/server/mcp.ts` (`registerTool`)
- `test/e2e/scenarios/tools.test.ts`（metadata round-trip）
- `test/e2e/requirements.ts`（tools/list conformance expectations）

### 3. MCP 2026-07-28 stateless core 改變 capability freshness 問題【官方資訊】

2026-07-28 MCP 已改為 stateless protocol core：移除 initialize/session dependency，每個 request 攜帶 protocol version、client identity/capabilities；`server/discover` 可選。`tools/list` 等 list response 也加入 cache hints。

這使 Hermes 必須新增：

`ToolCatalogGeneration`

`ToolCapabilityEvidenceFreshness`

因為 cached `tools/list` metadata 與真正 `tools/call` 時 server deployment/configuration 可能已不同。

因此：

`CachedToolMetadata --does_not_prove→ CurrentToolBehavior`

高風險 write tool 不應只依賴過期 catalog annotation；attestation 必須有 issuer、subject、deployment identity、issuedAt/expiresAt 或可驗證 generation。

### 4. Schema validation 與 safety validation 是不同層【工程實作 + 架構推論】

MCP SDK 可以在 handler 執行前拒絕不符合 input schema 的 arguments；OpenAI Agents SDK function tools同樣可從函式簽名/schema建立並驗證輸入，且其 tool runtime 還可包含 context injection、guardrails、timeouts、failure handling、tracing。OpenAI Agents SDK另提供 `needsApproval`/interruptions，使 sensitive tool call 可以在 execution 前暫停等待批准。

但：

`SchemaValid(args) --does_not_prove→ EffectAuthorized(args)`

`HumanApproved(toolCall) --does_not_prove→ RetrySafe(toolCall)`

`ToolRuntimeGuardrailPassed --does_not_prove→ ExternalCommitExactlyOnce`

所以 Hermes 不能把 JSON Schema、approval、authorization、idempotency、fencing 混成同一個「safe」boolean。

### 5. Tool safety 必須從單工具屬性升級成 execution-path property【官方資訊 + 架構推論】

MCP maintainer 的 2026 Tool Annotations文章指出風險常來自工具組合：private-data access + untrusted content + external communication 的組合可能形成 exfiltration path。單一工具 annotation 無法完整描述 session/path risk。

因此 Hermes 新增：

`ExecutionPathRisk = f(ContextTaint, DataLabels, CandidateToolCapabilities, PriorToolOutputs, Destination, Authority)`

Tool router不只回答「哪個工具最符合語意」，而要回答：

`Which tool can satisfy intent while meeting required safety invariants under the current taint/authority state?`

---

## 本小時最重要 5 個發現

1. **Claimed capability ≠ attested capability**：MCP annotations 可做 preflight UX/risk vocabulary，但不能當 hard security guarantee。
2. **Schema safety ≠ effect safety**：argument validation只證明 shape/type合法，不證明 action authorized、idempotent、fenced 或可驗證。
3. **Approval ≠ commit safety**：human approval可授權意圖，但 timeout/retry後仍需 semantic commit identity、idempotency、fencing、receipt。
4. **Stateless MCP需要 capability freshness**：2026-07-28 request/session模型與 list caching意味 tool catalog metadata需要 generation/freshness binding。
5. **風險是 path property**：tool selection必須納入 context taint/data-flow，而不是只看單一 tool description。

---

## Architecture Breakdown

### Hermes Risk-Aware Tool Router v0

`User Intent`
→ `Intent/Effect Classifier`
→ `Candidate Tool Retrieval`
→ `Tool Catalog Snapshot`
→ `Claimed Metadata Parser`
→ `Server/Deployment Trust Resolver`
→ `Capability Evidence Resolver`
→ `Required Safety Profile Compiler`
→ `Path/Data-Flow Risk Evaluator`
→ `Policy Matcher`
→ `Approval Requirement Resolver`
→ `SemanticCommit Compiler`
→ `Tool Invocation`
→ `Resource-side Enforcement`
→ `Receipt Verification`
→ `Observation Commit`

### ToolWriteCapabilityAttestation v0

```text
ToolWriteCapabilityAttestation {
  attestationId
  issuer
  subject: { serverIdentity, deploymentIdentity, toolName, toolVersion }
  catalogGeneration
  issuedAt
  expiresAt
  claims: {
    readOnly
    destructive
    openWorld
    externalIdempotency: NONE | ARGUMENT_STABLE | SERVER_RECORD | EXTERNAL_TRANSACTION
    conditionalMutation: NONE | ETAG | VERSION | CAS
    fencing: NONE | PROCESS_LOCAL | CONSENSUS_EPOCH_GENERATION | RESOURCE_ENFORCED
    receiptStrength: MODEL_OUTPUT | TRANSPORT | POSTCONDITION | IDEMPOTENCY_RECORD | EXTERNAL_TRANSACTION
    compensation: NONE | BEST_EFFORT | VERIFIED
  }
  evidenceRefs[]
  signature
}
```

### ToolSafetyRequirementProfile v0

```text
ToolSafetyRequirementProfile {
  effectClass
  riskTier
  requiredAuthority
  requiredDataPolicy
  requireApproval
  minimumIdempotency
  minimumFencing
  minimumReceiptStrength
  requireCompensation
  maxCapabilityAge
}
```

### Planner Safety Matching Algorithm

```text
1. infer Intent + intended Effect
2. classify risk and data sensitivity
3. retrieve semantic candidate tools
4. parse claimed annotations/schema
5. resolve trusted/attested capability evidence
6. reject stale/mismatched deployment attestations
7. compute current execution-path taint
8. compare RequiredSafetyProfile against AttestedCapability
9. require approval if policy says so
10. compile SemanticCommitEnvelope
11. execute through enforcement adapter
12. accept observation only after required receipt evidence
```

Safety predicate:

`Selectable(tool) = SemanticFit ∧ AuthorityFit ∧ DataFlowFit ∧ CapabilityFresh ∧ IdempotencyFit ∧ FencingFit ∧ ReceiptFit ∧ ApprovalSatisfied`

---

## Bottom-Level Logic

MCP tool execution should be understood as:

`tools/list → tool definition/schema/annotations → model/tool router selects name → arguments generated → tools/call → protocol/SDK argument validation → registered handler dispatch → application logic → external effect → tool result → model context`

Hermes inserts deterministic gates around that flow:

`tools/list → CatalogGeneration → CapabilityEvidence → SafetyMatch → Approval/Authority Gate → SemanticCommitEnvelope → tools/call → Schema Gate → Effect Adapter → Fence/CAS/Idempotency Gate → External Commit → ReceiptVerifier → Observation Gate`

The key separation is:

- **Description/schema**: what the model may call and argument shape.
- **Annotation**: server's behavioral claim.
- **Attestation/evidence**: why Hermes believes the claim.
- **Authorization**: whether this principal may perform the action.
- **Approval**: whether user/human consent is required/satisfied.
- **Execution safety**: whether retry/concurrency/failover are safe.
- **Receipt**: whether the external effect can be proven.

---

## Visual Simulation Idea

### Tool Safety Router & Capability Evidence Microscope

Interactive columns:

`Intent | Context Taint | Candidate Tools | Claimed Hints | Evidence | Authority | Approval | Retry Safety | Fence | Receipt | Decision`

Example:

```text
Tool: delete_customer
MCP hints: destructive=true, idempotent=true, openWorld=true
Server trust: trusted
Attestation: expired
External idempotency evidence: unknown
Fence: none
Receipt: transport-only
Risk: HIGH
Decision: BLOCK
Reason: stale attestation + insufficient retry/receipt guarantee
```

Failure injection:

- `SERVER_LIES_READONLY_TRUE`
- `TOOL_CATALOG_CACHE_STALE_AFTER_DEPLOY`
- `SAME_TOOL_NAME_DIFFERENT_DEPLOYMENT`
- `APPROVED_CALL_RETRIED_WITHOUT_IDEMPOTENCY`
- `SCHEMA_VALID_BUT_AUTHORITY_INVALID`
- `PRIVATE_DATA_THEN_OPEN_WORLD_TOOL`
- `IDEMPOTENT_HINT_TRUE_EXTERNAL_API_NON_IDEMPOTENT`
- `RECEIPT_STRENGTH_BELOW_POLICY`

---

## Code / GitHub

### modelcontextprotocol/typescript-sdk

Priority files/directories:

- `docs/servers/tools.md`: registration, input/output schema, annotations semantics.
- `examples/guides/servers/tools.examples.ts`: concrete annotation/tool examples.
- `packages/server/src/server/mcp.ts`: `registerTool` implementation surface.
- `test/e2e/scenarios/tools.test.ts`: metadata round-trip behavior.
- `test/e2e/requirements.ts`: tools/list conformance expectations.

Observed engineering path:

`registerTool(config) → advertised schema/metadata → tools/list → callTool → input validation → handler → structuredContent validation → result`

### OpenAI Agents SDK comparison

Function tools derive/consume structured schemas and execute through a runtime pipeline; direct invocation of wrapped functions can bypass validation/context/guardrails/timeouts/tracing. HITL adds `needsApproval` and resumable interruption state. This is a stronger execution-policy surface than MCP annotations alone, but still does not itself establish external exactly-once semantics.

---

## Papers / Technical Sources

This round is primarily protocol/runtime architecture rather than a new-paper round. High-value sources reviewed:

1. **MCP Tool Annotations as Risk Vocabulary: What Hints Can and Can't Do** — MCP maintainers, 2026. Contribution: formal practical distinction between hints and enforcement, plus compositional/session risk. Limitation: design guidance, not a cryptographic attestation standard.
2. **MCP 2026-07-28 Specification release** — MCP project, 2026. Contribution: stateless core, self-describing requests, list caching, authorization hardening. Limitation: does not define the proposed Hermes ToolWriteCapabilityAttestation.
3. **MCP TypeScript SDK tool implementation/docs** — engineering source. Contribution: exact register/list/call/schema/annotation behavior.
4. **OpenAI Agents SDK tools + HITL docs** — engineering comparison. Contribution: schema runtime plus approval/interruption execution path.

---

## Unknown / Open Questions

1. How should an attestation cryptographically bind `toolName + server identity + deployment digest + behavior evidence` without making every tool ecosystem vendor-specific?
2. What is the minimum conformance test suite that can upgrade a capability from `CLAIMED` to `OBSERVED` or `ATTESTED`, especially for idempotency and read-only behavior?
3. How should path-level taint/data-flow state survive multi-agent handoff and MCP stateless requests without being laundered by summaries?

---

## Knowledge Graph 新增 Node / Edge

### Nodes

- `ToolCatalogGeneration`
- `ToolDeploymentIdentity`
- `ToolCapabilityClaimGeneration`
- `ToolCapabilityAttestationGeneration`
- `ToolCapabilityEvidenceFreshness`
- `ToolSafetyRequirementProfile`
- `ToolSafetyMatchWitness`
- `ExecutionPathRiskGeneration`
- `ContextTaintGeneration`
- `ToolApprovalGeneration`
- `ToolSchemaValidationWitness`
- `ToolCapabilityMismatchWitness`
- `ToolCatalogStalenessWitness`

### Edges

- `ToolAnnotationClaim --does_not_prove→ ToolBehaviorGuarantee`
- `SchemaValid --does_not_prove→ EffectAuthorized`
- `ApprovalSatisfied --does_not_prove→ RetrySafe`
- `CachedToolMetadata --does_not_prove→ CurrentToolBehavior`
- `ToolCapabilityAttestation --bound_to→ ToolDeploymentIdentity`
- `ToolSafetyRequirementProfile --matched_against→ ToolCapabilityAttestation`
- `ContextTaintGeneration --constrains→ ToolSelection`
- `ToolSafetyMatchWitness --authorizes_preflight→ SemanticCommitCompilation`

---

## 下一輪研究

下一輪應沿著：

`ToolWriteCapabilityAttestation → conformance test evidence → runtime observed behavior → signed deployment identity → authorization token → tools/call → side-effect receipt`

深入比較 MCP 2026 authorization/request identity、OpenAI approval/guardrail pipeline、Google ADK confirmation/tool context、LangGraph ToolNode execution，並開始定義 `Tool Capability Conformance Harness`：自動測試 read-only、idempotency、duplicate invocation、timeout-after-commit、concurrent calls、stale deployment metadata 與 open-world data-flow。

---

## 本輪結束判斷

- **缺哪一層：** claimed MCP metadata → cryptographically/runtime-attested behavior 的 evidence layer。
- **哪個節點最淺：** `ToolCapabilityEvidenceFreshness` 與 attestation revocation。
- **哪個概念仍只是名詞：** portable `ToolWriteCapabilityAttestation` signature/evidence format。
- **哪個系統值得讀原始碼：** MCP TypeScript SDK `packages/server/src/server/mcp.ts` 與 protocol types；下一輪再進 authorization/transport dispatch。
- **哪篇/技術來源需追引用：** MCP Tool Annotations 2026 discussion及其後續 SEPs，尤其 runtime/dynamic annotations與session composition risk。
- **哪個概念最適合視覺模擬：** Tool Safety Router & Capability Evidence Microscope。
- **哪個 Agent 架構最值得實作：** `Risk-aware Planner + Attested Tool Capability Registry + Path-level Data-Flow/Taint Engine + Approval/Authority Gate + SemanticCommit Compiler + Resource Enforcement + ReceiptVerifier`。

最終鏈條因此再補上一段：

`UI → Agent → Context → Reasoning/Planning → Intent/Effect Risk → Tool Candidate Retrieval → Capability Evidence → Safe Tool Selection → Approval/Authority → SemanticCommit → MCP tools/call → Resource Enforcement → External Commit → Receipt → Observation → Context → Output`

本輪的核心推進是：**工具安全不能由模型閱讀 description 後自行判斷，也不能由 server 自稱 `idempotent=true` 就成立。Hermes 必須把「工具宣稱什麼、我們為什麼相信、證據是否仍新鮮、目前資料流是否已被污染、這次操作要求多強的安全保證」分成不同 runtime objects，再由 deterministic router 決定工具是否有資格被模型真正執行。**