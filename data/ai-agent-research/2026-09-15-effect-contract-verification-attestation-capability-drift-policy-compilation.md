# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 21:53（Asia/Taipei）**  
**主題：Effect Contract Verification × Safe Conformance Probes × MCP Trust/Attestation × Capability Drift × Runtime Policy Compilation**

## 與歷史研究比較
上一輪已建立 `BehaviorHint → EffectCapability → EffectCapabilityContract → RuntimeEnforcement`，並確認 MCP `ToolAnnotations` 只是 hints，不能直接當 crash-safe / retry-safe contract。本輪不重複 idempotency/outbox，而追問：**server 宣稱的 capability 如何升級成 Runtime 可以信任的 capability？tool 定義或實際行為改變後，舊批准何時失效？自然語言 policy 如何變成真正位於 dispatch boundary 的硬規則？**

## 本小時新發現
- MCP 官方再次明確：annotations 是 untrusted hints，不是 enforcement；沒有可信 server 身分時，`readOnlyHint=true` 也不能成為安全保證。
- 2026 `Attested Tool-Server Admission` 提出 signed clearance assertion + pinned trust root + deny-by-default per-server allowlist + tamper-evident audit，補的是 **server admission/provenance**，不是 tool behavioral correctness。
- `enclawed-oss` 已有可讀原始碼：`mcp-attested` 在 dispatch 前驗證 server clearance，並在 registered bridge 上強制 `allowedTools`；clearance assertion 會驗 signer、expiry、clearance tier、signature 與 endpoint binding。
- `Methods for Formal Verification of Agent Skills` 提出四級 verification lattice（unverified / declared / tested / formal），並用 script-side abstract interpretation + refinement-typed dispatch + bounded model checking，把 capability containment 變成 machine-checkable proof；LLM 本身仍被視為 nondeterministic/adversarial oracle。
- MCP rug-pull 類攻擊證明「批准一次」不是持續信任：tool description/schema/parameter metadata 變動必須造成 capability profile drift，舊 approval / conformance result 應失效。

## 本小時最重要 5 個發現

### 1. Attestation 證明「誰發布」，不等於證明「它會怎麼做」
**官方/工程事實：** MCP annotations 是 hints；`mcp-attested` 類機制可以驗證 server assertion 的簽章、trust root、clearance、expiry、endpoint binding，再以 allowlist 限制可呼叫工具。

但必須分離：

```text
Identity / Provenance Attestation
≠
Behavioral Capability Verification
```

合法 signer 可以簽一個有 bug 的 server；合法 server 也可能在新版本改變副作用。因此 Hermes 不應把 `SIGNED` 直接映射成 `SAFE`。

建議 verification state：

```text
UNVERIFIED
→ DECLARED
→ ATTESTED
→ TESTED
→ FORMALLY_CONTAINED
→ RUNTIME_OBSERVED
```

這些不是單一路徑的信任分數，而是不同 evidence dimensions。

### 2. Capability verification 必須把 LLM-side 與 script/tool-side 分開
`Methods for Formal Verification of Agent Skills` 的重要建模是：LLM 不需要被形式驗證；把它當任意 envelope producer，真正要保證的是 **dispatch boundary 無法讓 undeclared capability 穿過去**。

```text
LLM / Planner
  arbitrary proposal
↓
Typed Tool Envelope
↓
Capability Containment Gate
↓
Tool / Script
↓
Host API
```

Script-side 可做 static effect analysis；dispatch envelope 可用 refinement/type/policy constraints；有限 transaction horizon 可做 bounded model checking。

因此：

```text
Model Alignment
≠ Runtime Capability Containment
```

這對 Hermes 很重要：即使 prompt injection 完全控制 reasoning，只要所有 side effects 都經單一 enforcement point，仍可限制可達 effect set。

### 3. Safe Conformance Probe 不能直接拿 production resource 試「你是不是 destructive」
本輪提出 `ConformanceProbePlanner`，依 effect class 選擇 probe：

```text
READ
→ known canary resource
→ compare observed read-set

ADDITIVE / UPDATE
→ shadow namespace / sandbox tenant
→ before snapshot
→ invoke
→ after snapshot
→ derive write-set

IDEMPOTENCY
→ same semantic operation + same args
→ repeated inside isolated resource
→ compare effect cardinality / state delta

DELETE / IRREVERSIBLE
→ NEVER probe on production
→ require provider test environment, formal evidence,
   signed contract, or remain UNVERIFIED
```

因此 `tested` 也必須有 scope：`tested_on_version / endpoint / sandbox / arguments-domain / time`。測過一個 canary 不代表所有參數都安全。

### 4. Capability Drift 是 Tool TOCTOU
MCP tool poisoning / rug-pull 的本質是：

```text
Approve ToolDefinition Hash H0
↓
time passes
↓
Live ToolDefinition Hash H1
↓
H1 != H0
↓
Old approval no longer binds live behavior
```

所以 Hermes 應建立 `CapabilityProfileHash`，至少 canonicalize：

```text
server identity
server build/version
transport endpoint
name
input schema
output schema
annotations
execution metadata
provider effect contract
allowed authority scopes
```

每次 discovery / session resume / pre-commit 都比較 live hash。漂移後：

```text
TRUSTED → DRIFTED
DRIFTED → BLOCK / REPROBE / REATTEST / REAPPROVE
```

不能只在安裝時掃描一次。

### 5. Policy 必須 compile 成 dispatch-time predicate，而不是塞進 system prompt
Solver-aided tool policy research把自然語言 operational policy 轉成 SMT constraints over observable state + tool arguments，然後在 tool dispatch 前判定。這與 AgentSpec / formal-skill verification 的方向一致：

```text
Natural-language Policy
↓
Policy IR
↓
Static checks / SMT / CEL / Cedar / OPA-like predicate
↓
Compiled Runtime Guard
↓
Tool Envelope + Current State
↓
ALLOW / DENY / REQUIRE_CONFIRM / REQUIRE_PROBE
```

所以：

```text
Policy in Context
≠ Policy Enforcement
```

Hermes 應保存 `PolicySource → PolicyIR → CompiledGuard → EnforcementDecision` lineage，讓每次拒絕/批准可 audit。

## Architecture Breakdown — Verified Tool Admission & Runtime Policy Kernel

```text
MCP Discovery
↓
Tool Descriptor Snapshot
↓
Canonical Fingerprint
↓
Server Identity / Attestation Verifier
├ signer
├ trust root
├ expiry
├ endpoint binding
└ build/version
↓
Declared Capability Extractor
↓
Verification Planner
├ static analysis
├ sandbox conformance probe
├ signed provider evidence
├ historical runtime observations
└ formal containment proof
↓
Verified Capability Profile
├ evidence
├ scope
├ confidence/level
├ valid_from
└ invalidation conditions
↓
Policy Compiler
↓
Dispatch Guard
↓
Agent Tool Envelope
↓
ALLOW / DENY / CONFIRM / PROBE
↓
Execution
↓
Observed Effects
↓
Capability Drift Detector
↓
Update / Quarantine / Re-verify
```

## Bottom-Level Logic

### Capability profile is evidence-backed, not a boolean
```text
VerifiedCapabilityProfile
├ declared_effects
├ observed_effects
├ forbidden_effects
├ authority_scope
├ verification_level
├ evidence_refs
├ tool_definition_hash
├ server_artifact_hash
├ endpoint_binding
├ tested_argument_domain
├ valid_until
└ invalidation_rules
```

### Fingerprint ≠ behavioral proof
Hash pinning detects definition drift, but a stable malicious definition remains malicious；runtime behavior can also change behind a stable descriptor. Therefore fingerprint must combine with artifact/version attestation, sandbox observation, provider contract, and runtime effect telemetry.

### Formal containment ≠ semantic correctness
A proof that tool effects stay inside declared capability set does not prove the tool achieved the user's goal correctly. `fs.write:/tmp/x` may be allowed but contain wrong content. Capability containment belongs to safety boundary; postcondition/evidence verification belongs to semantic correctness.

## Visual Simulation Idea — Tool Trust Lattice × Capability Drift Observatory
Hermes Console 顯示每個 MCP/tool 的 trust stack：

```text
Server Identity        ATTESTED
Definition Hash        MATCH
Declared Capability    fs.read, net.egress
Sandbox Tested         PARTIAL
Formal Containment     PASS
Runtime Observation    18 clean / 0 violation
Last Verified          21:51
Drift State            STABLE

Effective Runtime Policy:
READ       AUTO
WRITE      CONFIRM
DELETE     DENY
EGRESS     ALLOWLIST ONLY
```

互動注入：`change description / add hidden parameter / widen schema / change endpoint / signer expires / server adds tool / observed write outside declared scope`。畫面即時顯示 `STABLE → DRIFTED → QUARANTINED`，並指出是哪一份 evidence 失效。

## Code / GitHub
### enclawed/enclawed-oss — `extensions/mcp-attested`
值得看的核心檔案：
- `extensions/mcp-attested/src/client.ts`：connection admission + registered bridge `allowedTools` enforcement + audit event。
- `extensions/mcp-attested/src/server-clearance-verifier.ts`：`.well-known/enclawed-clearance.json`、manifest parse、signer trust-root lookup、signer expiry、approved clearance、Ed25519 signature、clearance threshold、endpoint binding。
- `extensions/mcp-attested/src/server-registry.ts`：下一輪值得繼續追 tool allowlist registry / bridge binding。
- `enclawed/ts/runtime.ts`：audit-aware runtime seam。

**原始碼確認：** `QClearedMcpClient.invoke()` 在 registered bridge 上先 `isToolAdmitted()`，不在 allowlist 就 audit deny；允許後才 connect / JSON-RPC `tools/call`。`verifyServerClearance()` 則在 dispatch 前完成 signed assertion verification。

### MCPTrust
值得後續比較 lockfile / drift detection / artifact pinning / signing / policy enforcement。它代表工程上「definition pinning + runtime proxy」路線，但不能把 README 宣稱等同形式保證。

## Papers / Technical Sources

### Attested Tool-Server Admission: A Security Extension to the Model Context Protocol
- Author: Alfredo Metere
- Year: 2026
- Architecture: signed clearance assertion + pinned trust root + per-server deny-by-default tool allowlist + enforcement/audit
- Contribution: 把 MCP server admission 從 self-declared trust 升級成可驗簽 admission
- Limitation: attestation 主要證明 identity/clearance/allowed tools，不證明 tool semantic correctness 或所有 runtime behavior
- Code: `enclawed/enclawed-oss`, `extensions/mcp-attested`
- URL: https://arxiv.org/abs/2605.24248

### Methods for Formal Verification of Agent Skills: Three Layers Toward a Mechanically Checkable Capability-Containment Proof
- Author: Alfredo Metere
- Institution: Lawrence Livermore National Laboratory（作者 affiliation，依公開索引）
- Year: 2026
- Architecture: abstract interpretation + refinement-typed tool envelopes + bounded model checking + proof-carrying artifact
- Contribution: 將 skill manifest 的 capability containment 從 declaration/test 提升為 machine-checkable formal level
- Limitations: runtime core itself assumed correct；read-only exfiltration、TOCTOU、operator coercion 等仍是 residual；LLM 本身不被驗證
- Code: `enclawed/enclawed-oss`
- URL: https://arxiv.org/abs/2605.23951

### MCPShield: A Security Cognition Layer for Adaptive Trust Calibration in Model Context Protocol Agents
- Authors: Zhenhong Zhou et al.
- Year: 2026
- Architecture: metadata-guided pre-invocation probing + bounded execution observation + history-based post-use trust update
- Contribution: 將 MCP trust 從一次性 static allow/deny 改成 adaptive lifecycle cognition
- Limitation: paper-reported empirical defense/generalization is not a formal capability guarantee；需要進一步追公開 implementation 才能 code-level audit
- URL: https://arxiv.org/abs/2602.14281

### Solver-Aided Verification of Policy Compliance in Tool-Augmented LLM Agents
- Authors: Cailin Winston, Claris Winston, René Just
- Year: 2026
- Architecture: natural-language policy → formal SMT-LIB constraints → runtime tool-use verification
- Contribution: 將 policy compliance 從 prompt steering 移到 solver-aided enforcement
- Limitation: guarantee scope受 formalized policy、observable state completeness、translation correctness限制
- URL: https://arxiv.org/abs/2603.20449

## 已確認 / 推論 / 假說界線
- **官方已確認：** MCP annotations 是 hints，untrusted server annotations 不可視為安全保證。
- **原始碼已確認：** enclawed `mcp-attested` 驗簽 clearance assertion、trust root、expiry、endpoint binding，且 registered bridge 有 per-tool allowlist enforcement。
- **論文結果：** formal-skill work提出 capability-containment proof pipeline；MCPShield提出 pre/during/post invocation adaptive trust；solver-aided work把 tool policy轉成 formal constraints。
- **合理工程推論：** Hermes 應把 fingerprint、attestation、conformance evidence、formal evidence、runtime observations組合成多維 `VerifiedCapabilityProfile`。
- **尚未驗證假說：** 能否對 arbitrary third-party MCP mutation tool 自動、安全、低成本建立完整 behavioral contract；不可假設。

## Unknown / Open Questions
1. 如何對 irreversible / expensive tool 做 behavioral verification，而不真的造成 production side effect？
2. Capability profile 的 invalidation granularity 應是 server build、tool schema、tool implementation artifact、endpoint，還是每個 authority scope 分開？
3. 如何把 formal policy、attestation、runtime observations 與 learned risk model組成一個不會互相覆蓋保證 scope 的 decision procedure？

## 下一輪研究
**Runtime Effect Observation × Information-Flow Tracking × Taint Propagation × Cross-Tool Exfiltration × Least-Privilege Capability Leasing**。下一輪要追：即使 tool 本身通過 admission/verification，Agent 從 untrusted web/email/image 取得的資料如何污染 context，並透過另一個已授權 tool 被 exfiltrate；把 `Tool Trust` 推進成 `Data Flow Trust`。

## Knowledge Graph 新增 Node / Edge
### Nodes
`ServerAttestation`, `EndpointBinding`, `CapabilityVerificationLevel`, `VerifiedCapabilityProfile`, `CapabilityEvidence`, `ConformanceProbe`, `SafeProbeEnvironment`, `CapabilityProfileHash`, `CapabilityDrift`, `DriftInvalidation`, `ToolQuarantine`, `FormalCapabilityContainment`, `TypedDispatchBoundary`, `PolicyIR`, `CompiledRuntimeGuard`, `PolicyDecisionLineage`, `AttestationScope`, `BehavioralVerificationScope`.

### Edges
- `ServerAttestation --PROVES_IDENTITY_SCOPE--> MCPServer`
- `ServerAttestation --DOES_NOT_PROVE--> SemanticCorrectness`
- `ConformanceProbe --PRODUCES--> CapabilityEvidence`
- `CapabilityEvidence --SUPPORTS--> VerifiedCapabilityProfile`
- `CapabilityProfileHash --DETECTS--> CapabilityDrift`
- `CapabilityDrift --INVALIDATES--> PriorApproval`
- `FormalCapabilityContainment --BOUNDS--> ReachableEffectSet`
- `TypedDispatchBoundary --ENFORCES--> CapabilityContainment`
- `PolicySource --COMPILES_TO--> PolicyIR`
- `PolicyIR --COMPILES_TO--> CompiledRuntimeGuard`
- `CompiledRuntimeGuard --GOVERNS--> ToolDispatch`
- `RuntimeObservation --UPDATES--> VerifiedCapabilityProfile`

## 本輪結束檢查
- **缺哪一層：** runtime information-flow / taint tracking；現在知道 tool 能做什麼，但還不知道敏感資料會經哪條 tool chain 流出去。
- **哪個節點最淺：** `SafeProbeEnvironment`, `BehavioralVerificationScope`, `PolicyDecisionLineage`。
- **哪個概念仍只是名詞：** arbitrary MCP ecosystem 的 universal `Behavioral Capability Certificate`。
- **哪個系統值得讀原始碼：** `enclawed/enclawed-oss` 的 `mcp-attested`、module-trust、server registry；其次 MCPTrust 的 lockfile/drift enforcement。
- **哪篇論文需追引用：** `Methods for Formal Verification of Agent Skills`，因它把 agent skill/tool verification 與傳統 formal methods 接起來。
- **哪個概念最適合視覺模擬：** `Tool Trust Lattice × Capability Drift Observatory`。
- **哪個 Agent 架構最值得實作：** `Attested Admission → Verified Capability Profile → Compiled Dispatch Guard → Runtime Observation → Drift Reverification` 的閉環 Runtime。

## 對「AI 到底怎麼運作」新增的一層

```text
UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Tool Intent
→ Tool Discovery
→ Identity / Attestation
→ Capability Verification
→ Policy Compilation
→ Dispatch Guard
→ Tool / MCP Runtime
→ Observed Effects
→ Drift Detector
→ External World
→ Evidence / Memory
```

真正可靠的 Agent 不應問「這個 Tool 說自己安全嗎？」而是問：**誰發布它？我驗證過哪些行為？驗證適用到哪個版本/參數/時間？live definition 是否仍與批准時相同？即使 LLM 完全被 prompt injection 控制，dispatch boundary 是否仍能阻止它越過已驗證 capability set？** 這讓 Tool Trust 從一次性的 UI 勾選，升級成可驗證、可失效、可重新驗證的 Runtime 狀態。