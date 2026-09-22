# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-23 07:56（Asia/Taipei）

## 本小時研究主題
**Tool Capability Conformance Evidence × Authorization Binding × Pre/Post Execution Guard Contract**

本輪承接上一輪 `ToolWriteCapabilityAttestation → Conformance Test Evidence → Runtime Observed Behavior → Authorization Token → tools/call → Side-Effect Receipt`，刻意不重複既有的 ToolAnnotations、fencing、receipt evidence，而補上「宣告能力如何被測試證據取代」以及「OAuth 授權如何與 semantic effect 綁定」兩個缺口。

---

## 本小時新發現

### 1. MCP ToolAnnotations 是 claim，不是 conformance proof（已確認：規格 + SDK 原始碼）
MCP 2026-07-28 TypeScript schema仍保留 `readOnlyHint / destructiveHint / idempotentHint / openWorldHint`。SDK corpus更直接寫明所有 ToolAnnotations 都是 hints，不保證忠實描述 tool behavior，client 不應基於不可信 server 的 annotation 做 tool-use 決策。

因此：

`ToolAnnotationClaim != ToolBehaviorEvidence`

以及：

`idempotentHint=true --does_not_prove→ DuplicateInvocationNoAdditionalEffect`

Hermes 必須把 capability registry 分成：

`Claim → Static Evidence → Conformance Evidence → Runtime Evidence → External Receipt Evidence`

### 2. Authorization Token 與 Effect Authorization 是不同 identity domain（已確認 + 工程推論）
MCP HTTP authorization以 OAuth resource-server boundary運作：Bearer token先在 transport/HTTP boundary驗證，成功後 auth info 才傳到 request handler。SDK e2e requirements也測試「valid token auth info is exposed to request handlers」。

但：

`BearerTokenValid --does_not_prove→ RequestedSemanticEffectAuthorized`

Token證明 caller擁有某些 scope/resource access，不自動證明：
- 這個 tool call 是使用者批准的那一次 call；
- arguments沒有在 approval後被替換；
- retry仍在原批准範圍；
- side effect digest與原始意圖相同。

Hermes 因此需要：

`AuthorizationBindingWitness = bind(principal, scopes, resource, toolDeployment, semanticCommitId, effectDigest, approvalGeneration, expiry)`

### 3. Guardrail 的執行位置會改變 side-effect safety（已確認：OpenAI Agents SDK官方文件）
OpenAI Agents SDK現在支援 function-tool input/output guardrails；input guardrail可在 execution前阻擋，output guardrail則在 execution後處理結果。若工具需要 human approval，input guardrail預設在 approval後、真正 execution前執行，也可以設定 pre-approval檢查並在 approval後再次檢查。

重要邊界：output guardrail即使拒絕輸出，也不能撤銷已經發生的 external side effect。

所以：

`OutputGuardrailRejected --does_not_prove→ SideEffectReverted`

`HumanApprovalPassed --must_be_revalidated_before→ ToolExecution`

這提供 Hermes 一個很實際的 TOCTOU 模型：

`Plan → pre-approval policy → Approval → context/tool metadata may change → pre-execution revalidation → execute`

### 4. Guard coverage 本身必須成為 capability evidence（已確認）
OpenAI Agents SDK 的 tool guardrail coverage不是全域一致：custom function tools與轉換後的 local MCP tools可走 guardrail pipeline，但 handoff、hosted MCP、部分 hosted/built-in execution tools不走同一 pipeline。

因此：

`FrameworkHasGuardrails --does_not_prove→ EveryExecutionPathGuarded`

Hermes新增 `GuardCoverageEvidence`，按 execution path紀錄：

`toolKind + adapter + transport + preExecutionGate + postExecutionGate + approvalGate + receiptGate`

這比「框架支援 guardrails」更接近可驗證事實。

### 5. MCP 2026-07-28 stateless + cacheable catalog 使 conformance evidence 必須綁 deployment generation（已確認）
Modern MCP移除 protocol-level session，版本隨 request攜帶；list結果可帶 cache hints。這改善 scale/cache，但也代表 capability evidence不能只綁 `toolName`。

必須至少綁：

`serverIdentity + deploymentIdentity + toolName + schemaDigest + implementationDigest/evidenceGeneration + protocolVersion`

否則部署替換後，舊 conformance result可能錯誤套用到新 implementation。

---

# Architecture Breakdown

## System Architecture：Evidence-Backed Tool Safety Router

```text
User Intent
  ↓
Planner / Effect Classifier
  ↓
Tool Candidate Retrieval
  ↓
Tool Catalog Claim Layer
  ↓
Capability Evidence Registry
  ├─ static schema evidence
  ├─ conformance test evidence
  ├─ runtime observed evidence
  ├─ authorization evidence
  └─ external receipt evidence
  ↓
Risk Requirement Compiler
  ↓
Safety Matcher
  ↓
Approval Gate
  ↓
Pre-Execution Revalidation
  ↓
SemanticCommit + EffectDigest
  ↓
MCP tools/call / Framework Tool Adapter
  ↓
Resource-side Enforcement
  ↓
Side-Effect Receipt
  ↓
Post-Execution Evidence Collector
  ↓
Observation Commit Gate
```

### Router核心判斷

`SafeToolSelection = SemanticFit ∧ DeploymentIdentityMatch ∧ EvidenceFresh ∧ AuthorityFit ∧ GuardCoverageFit ∧ IdempotencyFit ∧ FenceFit ∧ ReceiptFit ∧ ApprovalFresh`

高風險 write若缺任一 required witness，預設 fail closed。

---

# Bottom-Level Logic

## Tool Capability Conformance Harness

### A. READ_ONLY_CONFORMANCE
1. snapshot observable state
2. call tool with controlled arguments
3. observe declared resource + filesystem/network/database side channels
4. compare state digest
5. 若 mutation detected → `READ_ONLY_VIOLATION`

限制：無法觀察所有外部 side effect，因此「測不到 mutation」不是數學證明，只是 bounded evidence。

### B. IDEMPOTENCY_CONFORMANCE

`Call(args, semanticCommit=S)` twice under same controlled state

比較：
- resource version
- transaction count
- emitted events
- external receipts
- final state digest

判定：

`Same EffectDigest + repeated call + one semantic effect → observed-idempotent`

不能直接升格為 universal idempotence，需標記測試範圍與 retention window。

### C. TIMEOUT_AFTER_COMMIT
1. dispatch call
2. inject response loss after external commit
3. retry same SemanticCommit
4. 驗證是否 duplicate effect

這是 Agent runtime最重要的 write-side conformance case。

### D. CONCURRENT_DUPLICATE
同時發出兩個相同 semantic commit，驗證 external idempotency / CAS / fence 是否在 resource boundary生效。

### E. APPROVAL_TO_EXECUTION_MUTATION
1. capture approval effect digest
2. approval granted
3. mutate context/tool deployment/arguments
4. pre-execution revalidate
5. mismatch必須 block

新增 invariant：

`Approval(effectDigest=A) --does_not_authorize→ Execution(effectDigest=B)`

---

# Visual Simulation Idea

## Tool Conformance & Authorization Binding Microscope

九條 timeline：

`Planner | Catalog | Evidence Registry | OAuth/Auth | Human Approval | Guardrail | MCP Adapter | External Resource | Receipt`

互動故障注入：
- `SERVER_LIES_READONLY`
- `IDEMPOTENT_HINT_BUT_DUPLICATE_CHARGE`
- `APPROVAL_ARGUMENT_MUTATION`
- `TOKEN_VALID_WRONG_RESOURCE`
- `SCOPE_VALID_EFFECT_NOT_APPROVED`
- `DEPLOYMENT_CHANGED_AFTER_CONFORMANCE`
- `OUTPUT_GUARDRAIL_AFTER_SIDE_EFFECT`
- `HOSTED_TOOL_BYPASSES_EXPECTED_GUARD_PIPELINE`
- `TIMEOUT_AFTER_COMMIT_RETRY`

UI 顯示：

`Claimed | Tested | Runtime Observed | Authorized | Approved | Enforced | Receipted`

每一欄獨立，不再用單一綠色「Safe」徽章掩蓋不同證據層。

---

# Code / GitHub

## modelcontextprotocol/typescript-sdk
值得繼續讀：
- `packages/core-internal/src/types/spec.types.2026-07-28.ts`
- `packages/core/src/schemas.ts`
- `packages/core-internal/src/wire/rev2026-07-28/buildSchemas.ts`
- `packages/server/test/server/scopeChallengeModern.test.ts`
- `test/e2e/scenarios/hosting-entry-auth.test.ts`
- `test/e2e/requirements.ts`

本輪原始碼確認：2026-07-28 ToolAnnotations schema仍只有 risk hints；SDK corpus明文警告 annotations不保證 behavior；auth e2e測試則證明 Bearer驗證後 auth info會進 handler。

## OpenAI Agents SDK
值得對照：
- tool input/output guardrail execution pipeline
- pre-approval vs post-approval/pre-execution validation
- local MCP converted tool guardrails
- hosted/built-in/handoff guard coverage gaps

---

# Papers / Standards / Official Sources

本輪核心不是新論文，而是 protocol/runtime verification layer；優先來源：
1. MCP 2026-07-28 specification / changelog — stateless core、cacheable list、authorization演進。
2. MCP Tool Annotations risk vocabulary — annotations是 hints，非 security guarantee。
3. MCP TypeScript SDK source — schema、auth e2e、scope challenge。
4. OpenAI Agents SDK Guardrails/HITL — tool pre/post execution gate與approval revalidation。
5. OAuth Protected Resource Metadata / MCP authorization implementation — transport authentication與resource boundary。

下一輪應補 capability security / proof-carrying authorization / remote attestation 研究論文，避免目前 attestation schema只停在工程設計。

---

# Knowledge Graph 新增 Node / Edge

## Nodes
- `ToolConformanceRunGeneration`
- `ToolConformanceEvidence`
- `ToolImplementationDigest`
- `ToolSchemaDigest`
- `ObservedIdempotencyWitness`
- `ObservedReadOnlyWitness`
- `GuardCoverageEvidence`
- `AuthorizationBindingWitness`
- `ApprovalEffectDigest`
- `PreExecutionRevalidationWitness`
- `ToolDeploymentMutationGeneration`
- `ConformanceEvidenceScope`
- `ConformanceEvidenceExpiry`

## Edges
- `ToolDeploymentIdentity --has→ ToolImplementationDigest`
- `ToolConformanceRunGeneration --tests→ ToolDeploymentIdentity`
- `ToolConformanceRunGeneration --produces→ ToolConformanceEvidence`
- `ToolConformanceEvidence --supports→ AttestedToolCapability`
- `AuthorizationToken --does_not_imply→ SemanticEffectAuthorization`
- `ApprovalGeneration --binds→ ApprovalEffectDigest`
- `PreExecutionRevalidationWitness --compares→ ApprovalEffectDigest`
- `GuardCoverageEvidence --qualifies→ ExecutionPathRiskGeneration`
- `ToolDeploymentMutationGeneration --invalidates→ PriorConformanceEvidence`
- `SideEffectReceipt --strengthens→ RuntimeCapabilityEvidence`

---

# Unknown / Open Questions

1. **Capability attestation root of trust**：誰簽 ToolWriteCapability？server self-sign、CI provenance、TEE/remote attestation、第三方 conformance service，各自可信度如何量化？
2. **Bounded conformance → production guarantee**：測試只能證明特定 inputs/environment；如何將 evidence scope與 planner risk requirement做形式化匹配？
3. **Authorization-binding portability**：OAuth scope通常太粗；如何在 MCP / OpenAI / ADK / LangGraph 間攜帶 `semanticCommitId + effectDigest + approvalGeneration` 而不破壞 interoperability？

---

# 下一輪研究

鎖定：

`ToolConformanceEvidence → Supply-chain provenance / SLSA → signed deployment artifact → TEE/remote attestation → capability attestation root-of-trust → planner evidence scoring`

並追：
- SLSA provenance / Sigstore
- confidential computing remote attestation（TPM/TEE）
- proof-carrying authorization / macaroons / capability tokens
- MCP server deployment identity如何與 executable artifact digest綁定
- conformance evidence如何在新 deployment時自動失效

---

# 本輪結束判斷

**缺哪一層：** Tool implementation artifact → signed deployment identity → runtime instance → MCP server identity 的可驗證供應鏈鏈結。

**哪個節點最淺：** `ToolImplementationDigest → RunningInstanceAttestation`。

**哪個概念仍只是名詞：** portable `ToolWriteCapabilityAttestation` root-of-trust。

**哪個系統值得讀原始碼：** MCP TypeScript SDK authorization/hosting path，接著讀 Sigstore/SLSA provenance verification實作。

**哪篇研究需追引用：** capability-based security、proof-carrying authorization與remote attestation；下一輪需補正式論文與標準來源。

**哪個概念最適合視覺模擬：** Tool Conformance & Authorization Binding Microscope。

**哪個 Agent 架構最值得實作：**

`Risk-aware Planner + Evidence-backed Capability Registry + Authorization/Approval Binding + Pre-Execution Revalidation + SemanticCommit + Resource Enforcement + ReceiptVerifier`

最終鏈目前推進為：

`UI → Agent → Context → Reasoning → Planning → Effect Risk → Candidate Tools → Claims → Conformance Evidence → Authorization/Approval Binding → Pre-Execution Revalidation → SemanticCommit → MCP Tool → Resource Enforcement → External Commit → Receipt → Observation → Context → Output`

本輪核心改變：**Hermes 不再把「工具有 annotation / token / approval」視為安全證明，而是把 claim、authorization、approval、conformance、runtime enforcement、receipt 分成可獨立驗證的 witness。下一步要證明的不是 tool 說自己是誰，而是目前正在執行的那份 binary/container，是否真的就是通過 conformance test 的那一份 implementation。**