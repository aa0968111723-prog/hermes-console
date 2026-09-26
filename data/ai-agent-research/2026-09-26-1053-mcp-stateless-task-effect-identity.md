# 【AI Agent × Multimodal Research Report】

時間：2026-09-26 10:53（Asia/Taipei）

主題：MCP 2026-07-28 Stateless Lifecycle × Task Recovery Ownership × Exactly-Once Tool Execution

## 與歷史研究比較
上一輪（2026-09-26 09:51）已建立 LogicalOperationID、StableIdempotencyKey、ToolEffectContract、RemoteEffectLedger、ExactlyOnceCommitGate。本輪避免重複「annotations 只是 hints」與一般 idempotency 原則，改追 2026-07-28 MCP modern lifecycle 與 Tasks extension：當 MCP 不再依賴 session handshake 時，execution identity、recovery ownership、tool capability 與 effect identity 應如何重新綁定。

## 本小時新發現
1. MCP 2026-07-28 modern lifecycle 移除 initialize handshake 與 Mcp-Session-Id；protocol revision、capabilities、client identity 改由每個 request 自帶 envelope。這代表「transport/session identity」不再適合當 logical operation identity。
2. modern lifecycle 以 server/discover 做 discovery；server 可逐 request 判斷 capability。Hermes 應將 CapabilitySnapshot 綁到每次 execution，而不是只在連線建立時快取。
3. MCP Tasks 對 tools/call 提供 task-backed execution，task 有 taskId、status、createdAt、lastUpdatedAt、ttlMs、pollIntervalMs，並支援 progress、input_required、cancellation、recovery。
4. Tasks SDK 的 recovery 明確檢查 ownership：同一 task identity 已有 active local owner 時會拒絕；endpoint/generation mismatch 也會拒絕。這提供了「ExecutionOwnershipLease」的工程先例。
5. task TTL 是 recovery evidence 的 retention boundary：TTL 到期後 task 不再 retained。這與 exactly-once 的 dedup/result retention window不同；若 effect 可能晚於 task record 存活期被觀察，TaskRecovery ≠ EffectRecovery。

## 本小時最重要 5 個發現

### 1. Sessionless MCP 迫使 identity 分層
已確認官方資訊：2026-07-28 request 自帶 version/capabilities/client identity，移除 session ID。
底層：
Request → Envelope(version, capabilities, client identity) → method/tool → execution。
重要性：Hermes 不可再以 MCP session ID 當 stable dedup key。
限制：protocol request identity仍不是 provider semantic effect identity。

### 2. Capability 必須成為 per-request snapshot
已確認工程實作：modern server依每個 request宣告能力決定是否可要求 input。
推論：Hermes需要 CapabilitySnapshotHash，讓 retry/recovery能判斷「同一 logical op 是否在不同 capability contract 下執行」。
Invariant：Replay requires compatible CapabilitySnapshot, not merely same tool name.

### 3. Task ID 是 execution handle，不是 semantic operation ID
Tasks可恢復、poll、handoff，但 task expiry後狀態可消失。
因此：
TaskID != LogicalOperationID
TaskCompletion != SemanticCommitWitness
TaskTTL != IdempotencyRetentionWindow

### 4. Recovery ownership 是防止雙 executor 的必要層
Tasks SDK已有 active local owner衝突、endpoint/generation mismatch拒絕。
Hermes對應：
LogicalOperationID → ExecutionOwnershipLease → AttemptGeneration → Executor。
Invariant：At most one active execution owner per recovery generation；但這仍不足以保證外部effect exactly-once。

### 5. Tool annotation 與 execution contract仍是兩層
MCP的 readOnly/destructive/idempotent/openWorld 是 hints；官方明確說不可信server的annotation不可當hard guarantee。
新結論：modern per-request capability negotiation解決「能不能使用某feature」，不解決「這次 mutation 是否已commit」。
需要額外：
EffectContract + IdempotencyKey + DurableCompletionRecord + RemoteEffectLedger。

## Architecture Breakdown
User Intent
→ Agent Plan
→ LogicalOperationID
→ MCP server/discover / per-request capability declaration
→ CapabilitySnapshotHash
→ Tool Definition + ToolAnnotations
→ EffectContract Adapter
→ StableIdempotencyKey
→ tools/call
→ ImmediateResult OR TaskBackedExecution
→ TaskID
→ ExecutionOwnershipLease
→ AttemptGeneration
→ working/input_required/completed/failed/cancelled
→ DurableCompletionRecord / Provider Receipt
→ RemoteEffectLedger
→ SemanticCommitWitness
→ ExactlyOnceCommitGate

Recovery：
persist TaskReference
→ resumeTask
→ verify endpoint
→ verify generation
→ acquire ownership
→ inspect task/effect evidence
→ SAME LogicalOperationID
→ SAME StableIdempotencyKey
→ NEW AttemptGeneration if execution must resume/retry
→ commit gate。

## Bottom-Level Logic
Identity vector：
I = {
  logical_operation_id,
  idempotency_key,
  tool_contract_version,
  capability_snapshot_hash,
  task_id?,
  task_generation?,
  attempt_generation,
  provider_effect_id?
}

安全規則：
1. task_id 只定位 execution state，不代表 semantic effect。
2. task TTL 到期不可推導 effect 未發生。
3. capability snapshot 改變時，不可 blind resume mutation。
4. recovery ownership解決 concurrent executor，不解決 duplicate provider effect。
5. exactly-once commit需要 semantic witness或provider dedup contract。

## Visual Simulation Idea
### MCP Stateless Task / Effect Identity Simulator
欄位：
LogicalOp | RequestID | CapabilitySnapshot | ToolAnnotations | EffectContract | IdempotencyKey | TaskID | TaskTTL | Owner | Generation | Attempt | ProviderEffectID | LedgerState | CommitEligible

故障注入：
SESSIONLESS_RETRY_NEW_REQUEST_ID
CAPABILITY_CHANGED_ON_RETRY
TASK_TTL_EXPIRED_EFFECT_STILL_PENDING
DOUBLE_TASK_OWNER
TASK_COMPLETED_ACK_LOST
TASK_RECORD_GONE_PROVIDER_EFFECT_EXISTS
IDEMPOTENT_HINT_FALSE_POSITIVE

關鍵視覺：四條獨立時間線
Protocol Request / Task Execution / Provider Effect / Semantic Commit。
讓使用者看到「task完成」與「世界狀態commit」不是同一事件。

## Code / GitHub
優先閱讀：
- modelcontextprotocol TypeScript SDK：server discovery、per-request envelope、tool registration/annotations
- @modelcontextprotocol/ext-tasks：client Execution、resumeTask、handoff、ownership/generation checks
- Hermes Console：下一步應搜尋 MCP tool dispatch / retry / task persistence path，加入 LogicalOperationID、CapabilitySnapshotHash、ExecutionOwnershipLease 與 RemoteEffectLedger integration。

## Papers / Standards
本輪主要是 protocol / SDK architecture，而非新論文：
- MCP protocol revision 2026-07-28：stateless modern lifecycle。
- MCP Tasks Extension / SEP-2663：task-backed tools/call、recovery、input handling、cancellation。
- 與上一輪 exactly-once tool-contract / RIFL / Varuna 線銜接：protocol execution identity仍需外部 semantic effect evidence。

## Unknown / Open Questions
1. MCP Tasks taskId 的 server-side persistence/durability最低保證到哪一層？不同server implementation是否可能只存在memory？
2. modern lifecycle下 capability snapshot變動時，task recovery是否有標準化 compatibility rule，或需Hermes自行建立 ContractVersion fence？
3. task TTL、provider idempotency retention、Hermes ledger retention三個window如何求安全下界，避免record GC後的ABA式 duplicate effect？

## 下一輪研究
Task TTL / retention
→ provider idempotency retention
→ durable completion record GC
→ tombstone / watermark
→ LogicalOperationID reuse prohibition
→ ABA-safe effect identity
→ batch partial commit
→ crash-consistent RemoteEffectLedger GC。

## Knowledge Graph 新增 Node / Edge
Nodes：
MCPModernLifecycle
PerRequestCapabilityEnvelope
CapabilitySnapshotHash
TaskBackedToolExecution
TaskID
TaskTTL
ExecutionOwnershipLease
TaskGeneration
EffectRetentionWindow
ContractVersionFence
SessionlessRetry

Edges：
MCPModernLifecycle → removes → SessionIdentityDependency
PerRequestCapabilityEnvelope → produces → CapabilitySnapshotHash
CapabilitySnapshotHash → gates → SafeResume
TaskID → identifies → TaskBackedToolExecution
ExecutionOwnershipLease → prevents → ConcurrentRecoveryOwner
TaskTTL → bounds → TaskStateRetention
TaskStateRetention --does_not_bound→ ProviderEffectLifetime
TaskCompletion --does_not_imply→ SemanticCommitWitness
LogicalOperationID → survives → SessionlessRetry
StableIdempotencyKey → survives → AttemptGeneration
RemoteEffectLedger → gates → ExactlyOnceCommitGate

## 本輪結束判斷
缺哪一層：Task retention / provider effect retention / ledger GC 的跨層安全協議。
最淺節點：EffectRetentionWindow。
仍只是名詞：ContractVersionFence 的跨 MCP server 標準語意。
最值得讀原始碼：@modelcontextprotocol/ext-tasks 的 resumeTask ownership/generation 與 server-side task store。
最需要追的標準：SEP-2663 Tasks 與 2026-07-28 stateless lifecycle。
最適合視覺模擬：MCP Stateless Task / Effect Identity Simulator。
最值得 Hermes 實作：Event-sourced Runtime + LogicalOperationID + CapabilitySnapshotHash + ExecutionOwnershipLease + StableIdempotencyKey + RemoteEffectLedger + ExactlyOnceCommitGate。
