# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 20:51（Asia/Taipei）**  
**主題：Effect Capability Contracts × MCP Mutation Semantics × Outbox/Inbox × Provider Reconciliation × Long-Horizon Idempotency**

## 與歷史研究比較
上一輪已建立 `SemanticOperationID / DurableEffectLedger / UnknownToolOutcome / Stable Idempotency Key / Reconcile-before-Retry`。本輪不再重複 crash window，而追問更底層的 interoperability 問題：**Agent Runtime 在 dispatch 前，究竟能從 Tool/MCP 得知多少「副作用語意」？哪些是協定事實、哪些只是 hint、哪些能力目前根本沒有標準欄位？**

## 本小時新發現
- **官方 MCP 現況：ToolAnnotations 只有風險/行為 hints，不是 execution contract。** 2025-11-25 schema 的 `readOnlyHint / destructiveHint / idempotentHint / openWorldHint` 全部明確標為 hints；不可信 server 的 annotations 不應直接驅動 tool-use decision。
- **關鍵缺口：`idempotentHint=true` 只回答「同 arguments 重呼叫是否無額外 effect」，沒有描述 dedupe key、scope、TTL、status query、compensation、commit protocol。** 因此它不足以支撐 crash recovery 的 safe replay。
- **MCP 已開始把 execution metadata 與 annotations 分離。** `Tool.execution.taskSupport` 表示 long-running task 支援，但仍沒有 mutation settlement/reconciliation contract。
- **工程實作已證明 annotations 有價值但必須有 hard controls。** Zscaler MCP 從 action verb 導出 annotations，且 server-side write allowlist / delete confirmation 才是 authoritative controls；這正好證明 Hint ≠ Contract。
- **Outbox 的本質是跨系統 reliable handoff，不是 distributed atomicity。** Temporal 社群對 DB + workflow 的說明很清楚：兩個獨立系統不能同時原子更新，但可以透過 transactional outbox + idempotent start 確保可靠傳遞。

## 本小時最重要 5 個發現

### 1. MCP `idempotentHint` 不是 Idempotency Contract
**官方已確認：** MCP schema 定義 `idempotentHint?: boolean` 為：相同 arguments 重複呼叫時不產生額外 effect；但整個 `ToolAnnotations` 被規範明確標為 hints，server 可描述錯誤，client 不可把 untrusted annotations 當安全保證。

底層區分：
`Behavior Hint → likely safe UX/policy signal`
而不是
`Retry Contract → stable key + scope + TTL + parameter binding + durable dedupe state`。

因此：
`idempotentHint=true ≠ crash-safe replay capability`
`idempotentHint=true ≠ exactly-once effect`
`same arguments ≠ same semantic operation identity`。

**為什麼重要：** Agent crash recovery 若只看 `idempotentHint` 就自動重送，可能跨 provider TTL、resource version 或 hidden state 造成錯誤。

### 2. Hint / Capability / Contract / Enforcement 必須四層分離
建議 Hermes 正式建立：

```text
Tool Description
↓
Behavior Hint
  readOnly / destructive / idempotent / openWorld
↓
Effect Capability
  provider actually supports what?
↓
Effect Contract
  scope / TTL / query / compensation / version semantics
↓
Runtime Enforcement
  WAL / authority / sandbox / outbox / fencing / reconciliation
```

MCP 官方 2026 Tool Annotations 文章也明確指出：annotations 可以 feed policy engine，但不是 enforcement；需要保證的事應落在 authorization、transport、sandbox/runtime，而不是 boolean hint。

### 3. Mutation Tool 需要「Capability Contract」，目前 MCP core 尚未提供完整標準
本輪提出 Hermes 內部 `EffectCapabilityContract`：

```text
EffectCapabilityContract
├ effect_class: READ | ADDITIVE | UPDATE | DELETE | EXTERNAL_SEND
├ idempotency
│  ├ supported
│  ├ key_field
│  ├ scope
│  ├ ttl
│  └ parameter_binding
├ reconciliation
│  ├ status_query_supported
│  ├ lookup_by_operation_id
│  └ observable_postconditions
├ compensation
│  ├ supported
│  ├ compensation_tool
│  └ compensation_limits
├ concurrency
│  ├ resource_version_field
│  ├ compare_and_swap
│  └ fencing_supported
├ authority
│  ├ required_scope
│  └ commit_time_reauth
└ trust
   ├ server_identity
   ├ contract_source
   └ verification_level
```

**合理工程推論，不是 MCP 現有標準：** 可先放 namespaced `_meta`，但 Runtime 必須把它視為 provider claim，經 trusted-server policy / conformance probe 後才升級成可執行 contract。

### 4. Outbox/Inbox 解的是「可靠交接」，不是魔法 exactly-once
跨 DB、MCP server、GitHub、Gmail 等異質系統沒有共同 transaction coordinator 時：

```text
Local DB Transaction
├ write business state
└ write Outbox{semantic_op_id, payload_hash}
COMMIT
↓
Outbox Dispatcher
↓
Provider Call with stable semantic identity
↓
Inbox / Provider Dedupe / Status Query
↓
Outcome Ledger
```

若 dispatcher 在 provider success 後、ack 前 crash：同一 outbox message 可以重送，但只有在 downstream 有 stable dedupe/idempotency contract 時才安全。否則必須進 `UNKNOWN → RECONCILE`。

所以：
`Transactional Outbox ≠ External Exactly Once`
`Outbox + Idempotent Receiver ≈ Reliable At-Least-Once Handoff`

### 5. Long-Horizon Agent 的 idempotency 必須跨 TTL 退化成 Reconciliation
Provider dedupe cache 可能只有有限 TTL；Agent 卻可能幾天、幾週後 resume。因此 Runtime 應保存：

```text
semantic_op_id
provider_key
provider_key_issued_at
provider_ttl
args_hash
resource_version
postcondition_probe
settlement_evidence
```

恢復時：
`within TTL → replay SAME key if contract permits`
`TTL uncertain/expired → do NOT blind retry → query status/postcondition → reconcile`
`no query + irreversible → human/escalation`。

這把上一輪的 `PracticalExactlyOnce` 明確限制為 **time-bounded capability**，不是永久性質。

## Architecture Breakdown — Effect Contract Resolver × Durable Handoff Kernel

```text
Agent Intent
↓
Canonical Semantic Operation
↓
MCP Tool Descriptor
├ ToolAnnotations (untrusted hints)
├ Tool.execution.taskSupport
└ namespaced provider metadata
↓
Trust Resolver
↓
Effect Capability Resolver
├ static contract
├ provider adapter
├ conformance history
└ runtime probes
↓
Risk / Authority Gate
↓
Durable Intent + Outbox
↓
Dispatch Adapter
├ native idempotency key
├ operation-id propagation
├ version/CAS
└ no-safe-retry mode
↓
Provider / MCP Server
↓
Result + Postcondition Evidence
↓
Inbox / Outcome Ledger
↓
SETTLED

Crash / timeout / ambiguous result
↓
UNKNOWN
↓
Capability-aware Reconciliation
├ status query
├ replay same key (only inside valid scope/TTL)
├ observe postcondition
├ compensate
└ escalate
```

## Bottom-Level Logic
### MCP annotation semantics
`readOnlyHint=false` is conservative default; `destructiveHint=true`, `idempotentHint=false`, `openWorldHint=true` are likewise pessimistic defaults in current schema. Crucially, schema states every annotation property is a hint.

### Long-running task support is orthogonal
`Tool.execution.taskSupport = forbidden | optional | required` answers whether task-augmented execution is supported. It does **not** tell Runtime whether a mutation can be safely replayed, queried by operation ID, compensated, or deduplicated.

### Capability confidence
Hermes 應保存：
`CapabilityConfidence = f(server_trust, declared_metadata, adapter_knowledge, conformance_tests, observed_history)`。
Declared annotation 只能是其中一個 feature。

## Visual Simulation Idea — MCP Effect Contract Inspector × Retry Safety Lab
左側列出 session 中所有 MCP Tools，每個 tool 顯示四層：`Hint / Verified Capability / Contract / Enforcement`。點選 mutation 後顯示：

```text
idempotentHint      true
Native dedupe key   NONE
Dedupe TTL          UNKNOWN
Status query        YES
Compensation        NO
Resource version    ETag
Trust               VERIFIED SERVER

Retry after 5 sec   VERIFY_FIRST
Retry after 7 days  RECONCILE_ONLY
```

使用者可注入 `timeout / duplicate delivery / TTL expired / provider key mismatch / stale ETag / server lies about annotation`，視覺化 Runtime 為何從 RETRY 轉為 RECONCILE / ABSTAIN。

## Code / GitHub
### Model Context Protocol core
值得持續追：
- `schema/2025-11-25/schema.ts`：`ToolAnnotations`, `ToolExecution`, `Tool`, `CallToolResult`
- `blog/content/posts/2026-03-16-tool-annotations.md`：官方對 hint vs contract / trust / policy engine 的最新定位

### AgentLedger MCP adapter
本輪追到 `packages/agentledger-mcp/`，目錄包含 `README.md / examples / pyproject.toml / src / tests`；但目前 `src/agentledger_mcp/` 只有非常薄的 `__init__.py`，因此不能把它宣稱為已完成的 MCP effect-contract implementation。這是一個重要負面發現：**AgentLedger 的 MCP package 名稱存在，不等於 mutation semantics 已落地。**

### 值得比較的 production MCP server
Zscaler MCP：annotations 從 operation/action 語意導出，並明確保留 server-side write allowlist 與 delete confirmation 作 authoritative enforcement。這是 `Hint + Hard Control` 的好實作範例。

## Papers / Technical Sources
### MCP Tool Annotations as Risk Vocabulary: What Hints Can and Can't Do
- Institution/community: Model Context Protocol maintainers; contributors來自 GitHub/AWS 等
- Year: 2026-03-16
- Contribution: 明確界定 annotations 是 risk vocabulary/hints，不是 security boundary；提出 trust、tool-combination、policy-engine 視角
- Limitation: 尚未提供 crash-recovery/idempotency TTL/status-query/compensation contract
- URL: https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/

### MCP Specification 2025-11-25 Schema
- Institution: Model Context Protocol
- Architecture: Tool + ToolAnnotations + ToolExecution + JSON-RPC tool call/result
- Contribution: 標準化 readOnly/destructive/idempotent/openWorld hints；task-augmented execution metadata
- Limitation: mutation settlement/reconciliation semantics 未標準化
- URL: https://modelcontextprotocol.io/specification/2025-11-25/schema

### Durable execution / outbox engineering references
- Temporal community: transactional outbox + idempotent workflow start；明確指出兩個獨立系統無法同時原子更新
- DBOS: workflow/step state 持久化到 Postgres，crash 後從 durable state resume；適合拿來比較 Agent Runtime 的 durable orchestration，但外部副作用仍需 provider-aware idempotency/reconciliation

## 已確認 / 推論 / 假說界線
- **官方已確認：** MCP ToolAnnotations 全部是 hints；`idempotentHint` 沒有提供 TTL/scope/status/compensation；ToolExecution taskSupport 是另一個 execution metadata 維度。
- **工程已確認：** production MCP servers 已使用 annotations 做 UX/confirmation，但仍以 server-side controls 作真正 enforcement。
- **合理工程推論：** Hermes 需要獨立於 MCP annotations 的 `EffectCapabilityContract`，並把 provider adapter/conformance history 納入信任。
- **尚未驗證假說：** 未來 MCP 是否會標準化 idempotency scope、dedupe TTL、status query、compensation 或 mutation contract；目前不可假設。

## Unknown / Open Questions
1. MCP 應新增正式 `ToolEffectContract`，還是維持 core 簡潔、讓 provider 以 `_meta`/extension 宣告？
2. Runtime 如何自動 conformance-test `idempotentHint`，又不真的製造危險副作用？
3. 跨多個 MCP servers 的 semantic operation identity，如何在不洩漏敏感 goal/arguments 的情況下傳遞並可 audit？

## 下一輪研究
**Effect Contract Verification × Safe Conformance Probes × MCP Trust/Attestation × Capability Drift × Runtime Policy Compilation**。重點追「server 宣稱 idempotent/read-only，但實際行為漂移或說謊」時，Runtime 如何透過 sandbox、shadow resource、canary、postcondition、signed metadata 或歷史 observation 建立可驗證 capability profile。

## Knowledge Graph 新增 Node / Edge
### Nodes
`BehaviorHint`, `EffectCapability`, `EffectCapabilityContract`, `CapabilityConfidence`, `ContractSource`, `ProviderAdapter`, `DedupeTTL`, `StatusQueryCapability`, `CompensationCapability`, `ResourceVersionCapability`, `TransactionalOutbox`, `InboxDedupe`, `ReliableHandoff`, `LongHorizonIdempotency`, `CapabilityDrift`, `TaskSupport`, `MCPMutationSemanticGap`.

### Edges
- `ToolAnnotations --DECLARES_HINT--> BehaviorHint`
- `BehaviorHint --DOES_NOT_GUARANTEE--> EffectCapability`
- `EffectCapabilityContract --GOVERNS--> RetryPolicy`
- `DedupeTTL --BOUNDS--> LongHorizonIdempotency`
- `TransactionalOutbox --ENABLES--> ReliableHandoff`
- `InboxDedupe --REDUCES--> DuplicateEffectRisk`
- `StatusQueryCapability --ENABLES--> ReconciliationProbe`
- `CompensationCapability --MITIGATES--> IrreversibleEffectRisk`
- `ProviderAdapter --VERIFIES--> EffectCapabilityContract`
- `TaskSupport --ORTHOGONAL_TO--> IdempotencyCapability`

## 本輪結束檢查
- **缺哪一層：** capability verification / attestation / drift detection。
- **哪個節點最淺：** `CapabilityConfidence`, `InboxDedupe`, `LongHorizonIdempotency`。
- **哪個概念仍只是名詞：** ecosystem-wide standardized `ToolEffectContract`。
- **哪個系統值得讀原始碼：** MCP core schema + production server annotation generation/enforcement；AgentLedger MCP adapter目前太薄，反而值得追其後續實作。
- **哪篇論文/技術線需追引用：** MCP Tool Annotations Interest Group 的後續 SEPs；durable workflow + transactional outbox 的 agent integration。
- **最適合視覺模擬：** MCP Effect Contract Inspector × Retry Safety Lab。
- **最值得實作的 Agent 架構：** `Hint Resolver → Trusted Capability Contract → Durable Outbox → Provider-aware Dispatch → Outcome Ledger → Capability-aware Reconciliation`。

## 對「AI 到底怎麼運作」新增的一層
`UI → Agent → Reasoning → Plan → Semantic Operation → MCP Tool Description → Hint/Capability/Contract Resolution → Durable Outbox → Provider Dispatch → External World → Reconciliation → Effect Ledger → Memory`。

真正可靠的 Agent 不能只問「這個 Tool 叫什麼、schema 怎麼填」，還要問：**這個 Tool 改不改世界？重送會不會重複？這個保證有效多久？失聯後能不能查狀態？做錯能不能補償？這些資訊是 server 自稱，還是 Runtime 已驗證？** MCP 已提供第一層 risk vocabulary，但要走到可恢復、可驗證的自主 Agent，還需要一層真正的 effect capability contract。