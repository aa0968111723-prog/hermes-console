# 【AI Agent × Multimodal Research Report】

**時間：2026-09-23 05:53（Asia/Taipei）**  
**主題：Fence Authority Epoch × Disaster Restore × MCP Tool Safety Capability Contract**

## 本小時新發現

本輪接續上一輪 `Fence Authority × Monotonicity × Linearizability`，不再重複比較 etcd/ZooKeeper/PostgreSQL/Redis，而是補上最淺節點 `FenceAuthorityEpoch`，並開始把 fencing / idempotency / receipt 能力前移到 MCP Tool Selection。

核心新結論：**revision/generation 只在它的 authority epoch/domain 內有意義。** etcd snapshot restore 會建立新的 logical cluster identity；若 restore 到較舊 snapshot，revision 甚至可能倒退。`--bump-revision` 可以把數字向前推並配合 `--mark-compacted` 使 watchers/cache 失效，但「把 revision 加大」不是 cryptographic 或 semantic continuity proof。因此 Hermes 不應把裸 `revision` 當跨 disaster-recovery 的永久 fence identity。

新的 fence identity：

`FenceToken = { authorityId, authorityEpoch, resourceScope, generation }`

比較規則不是單純 `incoming.generation > current.generation`，而是先驗證 epoch：

`incoming.authorityId == resource.authorityId`
`∧ incoming.authorityEpoch == resource.authorityEpoch`
`∧ incoming.generation > resource.maxAcceptedGeneration`

跨 epoch 的 token預設不可比較，必須經明確 epoch-transition admission。

## 本小時最重要 5 個發現

### 1. etcd restore 會建立新的 logical cluster；裸 revision 不能跨 restore 當永久 fence

**已確認官方資訊。** etcd v3.7 disaster recovery 文件指出 snapshot restore 會覆寫 member ID 與 cluster ID，避免 restored member誤加入舊 cluster；restore 應啟動新的 logical cluster。若 snapshot 比故障前舊，clients會看到 revision倒退。

因此新增 invariant：

`SameRevisionNumberAcrossRestore --does_not_prove→ SameFenceGeneration`

以及：

`ClusterRestore --must_create→ NewFenceAuthorityEpoch`

來源：etcd Disaster Recovery, https://etcd.io/docs/v3.7/op-guide/recovery/

### 2. revision bump 是 cache/watch invalidation technique，不是 authority continuity proof

**已確認官方資訊 + 原始碼。** etcd 官方建議 restore 時使用 `--bump-revision`，並在 Kubernetes/watch consumers 情境搭配 `--mark-compacted`，避免舊 cache 誤以為 restore 後沒有更新。current source `etcdutl/snapshot/v3_snapshot.go` 的 restore path在 `MarkCompacted && RevisionBump > 0` 時呼叫 `modifyLatestRevision()`；該函式 bump buckets revision並把最新 revision標記 compacted。

因此：

`RevisionBumped --does_not_prove→ PreFailureFenceHistoryPreserved`

`RevisionBumped --does_help→ MonotonicRevisionAppearance / WatchCacheInvalidation`

這個差異對 Agent fencing 很重要：安全性不能靠運維人員「猜一個夠大的 bump」。

原始碼：https://github.com/etcd-io/etcd/blob/main/etcdutl/snapshot/v3_snapshot.go

### 3. Fence Authority 必須從 scalar generation 升級成 epoch-qualified token

**工程建模 / 合理推論。** 上述 restore semantics意味 Hermes 的 `FencedEffectManifest` 至少應攜帶：

```text
fenceAuthorityId
fenceAuthorityEpoch
fenceResourceScope
fenceGeneration
fenceIssuedAt
fenceEvidenceRef
```

Resource Admission Gate：

`authority mismatch → REJECT_UNKNOWN_AUTHORITY`
`epoch < currentEpoch → REJECT_STALE_EPOCH`
`epoch > currentEpoch → REJECT_UNADMITTED_EPOCH`
`epoch == currentEpoch && generation <= maxAccepted → REJECT_STALE_GENERATION`
`epoch == currentEpoch && generation > maxAccepted → continue CAS/idempotency/authority checks`

這使 DR restore 後的 safety 不再依賴 revision數字是否碰巧比舊 cluster大。

### 4. MCP 現有 Tool annotations 是 routing/UX hints，不是安全證明

**已確認官方 SDK 資訊。** MCP tool annotations目前包含 `readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint`。官方 Python SDK明確警告：annotations 是 hints，不是 security mechanism，不能假設 client一定遵守。

因此：

`idempotentHint=true --does_not_prove→ StableExternalIdempotencyBinding`

`destructiveHint=false --does_not_prove→ NoIrreversibleSideEffect`

`readOnlyHint=true --does_not_prove→ ServerCannotMutateState`

來源：https://py.sdk.modelcontextprotocol.io/v2/de/servers/tools/ ；TypeScript SDK：https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/mcp.html

這是本輪最重要的 Agent Runtime bridge：Hermes不能直接把 MCP annotations當 dispatch authorization或 retry safety evidence。

### 5. Tool Selection 應加入可驗證的 Write Capability Profile

**工程建模。** 建議在 Hermes runtime建立獨立於 MCP annotation 的 attested capability layer：

```text
ToolWriteCapability {
  toolIdentity
  capabilityGeneration
  effectClass
  readOnly
  idempotency: NONE | ARGUMENT_STABLE | EXTERNAL_KEY_BOUND | RECEIPT_BOUND
  fencing: NONE | CALLER_TOKEN | RESOURCE_ENFORCED
  fenceAuthorityId?
  fenceEpoch?
  conditionalMutation: NONE | ETAG | VERSION_CAS | TRANSACTIONAL
  receiptStrength: NONE | RESPONSE | POSTCONDITION | IDEMPOTENCY_RECORD | TRANSACTION_RECEIPT
  compensation: NONE | BEST_EFFORT | VERIFIED
  openWorld
  attestationSource
}
```

Planner/Router不再只做：

`Intent → Tool Schema → Tool Selection`

而是：

`Intent → Effect Risk Classification → Required Safety Profile → Candidate Tool Schema → Capability Evidence → Authority/Data Policy → Safe Tool Selection → Arguments → SemanticCommitEnvelope → Execution`

高風險 side effect要求：

`RESOURCE_ENFORCED fencing ∧ EXTERNAL_KEY_BOUND/RECEIPT_BOUND idempotency ∧ strong receipt`

否則 runtime應 downgrade為 `MANUAL_APPROVAL / NON_RETRYABLE / RECONCILIATION_REQUIRED`。

## Architecture Breakdown

### Fence Epoch-aware Agent Runtime

`User Intent`
→ `Planner`
→ `Effect Risk Classifier`
→ `Tool Registry`
→ `MCP Tool Schema + Hints`
→ `Attested ToolWriteCapability`
→ `Safety Requirement Matcher`
→ `SemanticCommitEnvelope`
→ `FenceAuthority.allocate(authorityId, epoch, resourceScope)`
→ `FencedEffectManifest`
→ `MCP Tool Adapter`
→ `Resource Admission Gate`
→ `epoch validation`
→ `generation validation`
→ `CAS/idempotency validation`
→ `External Mutation`
→ `ReceiptVerifier`
→ `Observation Commit Gate`

### Disaster Recovery transition

`Epoch E1 / generation 9000`
→ `snapshot at revision 7000`
→ `catastrophic quorum loss`
→ `restore creates new logical etcd cluster`
→ `new AuthorityEpoch E2`
→ optional `revision bump + mark compacted`
→ `resource admission explicitly installs E2`
→ all `E1/*` tokens become stale regardless of numeric generation
→ new E2 tokens admitted

重要：epoch切換本身是高權限 control-plane side effect，必須留下 `FenceEpochTransitionReceipt`。

## Bottom-Level Logic

### etcd restore path

官方 recovery流程：snapshot → restore → new logical cluster metadata。restore到舊 snapshot可能讓 revision倒退；`--bump-revision N --mark-compacted` 可把 latest revision向前推並使包含 bump 的 revisions視為 compacted，迫使 watchers重新同步。

current source：

`Restore()`
→ `saveDB()`
→ if `MarkCompacted && RevisionBump > 0`
→ `modifyLatestRevision(RevisionBump)`
→ `unsafeGetLatestRevision()`
→ `unsafeBumpBucketsRevision()`
→ `unsafeMarkRevisionCompacted()`
→ `saveWALAndSnap()`

這證明 bump是 restore-time database transformation，而不是對舊 cluster未被 snapshot捕捉之 commits 的恢復。

### Epoch-qualified comparison

錯誤做法：

`accept iff incomingFence > maxFence`

安全做法：

`accept iff authority matches`
`AND epoch == admittedEpoch`
`AND generation > maxAcceptedGeneration`
`AND semanticCommit/effectDigest/idempotency/CAS checks pass`

跨 epoch不能靠 scalar大小比較。

### MCP safety capability separation

MCP annotation回答「tool宣稱的行為特性」；Hermes capability evidence回答「runtime能否驗證這個 tool真的提供所需安全 primitive」。

`ToolDescription/Annotation → Claim`
`Adapter Test + Receipt Contract + Resource Enforcement → Evidence`

所以：

`ClaimedToolCapability ≠ AttestedToolCapability`

## Visual Simulation Idea

### Fence Epoch Restore & Tool Safety Router Simulator

左半部顯示 DR timeline：

`Cluster E1 rev 7000 → writes to 9000 → snapshot restore → new E2 rev 7000 → bump → resource epoch transition`

右半部顯示 Tool Router：

`MCP annotations → Attested Capability → Risk Requirement → Dispatch Decision`

故障注入：

- `RESTORE_WITHOUT_NEW_FENCE_EPOCH`
- `REVISION_BUMP_TOO_SMALL`
- `OLD_EPOCH_TOKEN_NUMERICALLY_LARGER`
- `OLD_CLUSTER_STILL_ALIVE_AFTER_RESTORE`
- `MCP_IDEMPOTENT_HINT_FALSE_CLAIM`
- `TOOL_SUPPORTS_IDEMPOTENCY_BUT_NOT_FENCING`
- `RESOURCE_SUPPORTS_FENCE_BUT_RECEIPT_WEAK`
- `EPOCH_TRANSITION_WITHOUT_RESOURCE_ACK`

UI核心狀態：

`Authority E2 | Resource admitted E2 | token E1/9500 → BLOCKED (STALE EPOCH)`

以及：

`Tool says idempotent ✓ | External key binding ? | Fence ✗ | Receipt Tier 1 | High-risk retry → BLOCKED`

## Code / GitHub

### etcd
Repository: `etcd-io/etcd`

本輪值得看的核心檔案：

- `etcdutl/snapshot/v3_snapshot.go` — snapshot restore、revision bump、mark compacted。
- 後續應讀 server MVCC apply / backend revision path，確認 normal operation revision與restore-transformed revision的完整 lifecycle。

原始碼驗證：restore path只在 `MarkCompacted && RevisionBump > 0` 時修改 latest revision，並明確呼叫 bump + mark compacted；這與官方 disaster recovery文件一致。

### MCP SDK

值得追：

- TypeScript SDK Tool annotations type/registration path
- Python SDK `ToolAnnotations`
- server-side tool registration與call dispatch

下一步不只是看 schema，而是追 `tools/list → annotations → tools/call → server execution`，確認 annotations在哪些 runtime層真正被消費，以及哪些層完全不 enforce。

## Papers / Standards / Technical Sources

### 1. etcd Disaster Recovery (official technical documentation)
- **Organization:** etcd / CNCF
- **Version context:** v3.7
- **URL:** https://etcd.io/docs/v3.7/op-guide/recovery/
- **Architecture:** Raft-backed KV snapshot/restore + revision bump/compaction invalidation
- **Contribution:** 明確定義 restore後 logical cluster identity與 revision rollback/cache問題
- **Limitation:** revision bump不是 application-level fencing protocol
- **改變了什麼:** 迫使 Hermes把 `FenceGeneration` 升級成 `AuthorityEpoch + Generation`。

### 2. Model Context Protocol Tool Annotations (official SDK/spec surface)
- **Organization:** Model Context Protocol project
- **URLs:** https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/mcp.html ; https://py.sdk.modelcontextprotocol.io/v2/de/servers/tools/
- **Architecture:** tool name/description/schema + behavioral annotations
- **Contribution:** 提供 read-only/destructive/idempotent/open-world hints給 clients
- **Limitation:** hints不是 security enforcement或 capability attestation
- **改變了什麼:** Hermes需要在 MCP schema之上增加 evidence-backed `ToolWriteCapability`。

## Unknown / Open Questions 1–3

1. `FenceAuthorityEpoch` 應由哪個 root of trust簽發？cluster ID、deployment generation、KMS-signed epoch certificate，還是 resource-native epoch transaction？
2. multi-region active-active resource若兩區都可寫，epoch transition如何避免 split-brain admission？需要 global consensus authority、per-resource home region，或 CRDT-compatible effect class？
3. MCP capability attestation應如何標準化，才能避免 server只靠 annotation自我宣稱 `idempotent/fenced/receipt-strong`？

## 下一輪研究

下一輪鎖定：

`MCP tools/list → Tool annotations → tools/call → server dispatch → auth context → side effect adapter`

並比較：

`MCP ToolAnnotations ↔ OpenAI tool/function schema ↔ Google ADK tool metadata ↔ LangGraph tool execution`

目標是建立第一版：

`Tool Safety Capability Matrix + ToolWriteCapability attestation schema + planner safety matching algorithm`

同時開始回答：**Agent在真正呼叫工具以前，能不能從 schema + runtime evidence判斷這次 write是否具備 idempotency、fencing、CAS、receipt與compensation，而不是等出錯後才補救？**

## Knowledge Graph 新增 Node / Edge

### Nodes
- `FenceAuthorityEpochIdentity`
- `FenceEpochTransitionGeneration`
- `FenceEpochTransitionReceipt`
- `RestoredLogicalClusterIdentity`
- `RevisionBumpGeneration`
- `WatchCacheInvalidationWitness`
- `EpochQualifiedFenceToken`
- `ResourceAdmittedFenceEpoch`
- `ClaimedToolCapability`
- `AttestedToolCapability`
- `ToolWriteCapabilityGeneration`
- `ToolSafetyRequirementProfile`
- `ToolCapabilityEvidenceSet`

### Edges
- `ClusterRestore --creates→ RestoredLogicalClusterIdentity`
- `RestoredLogicalClusterIdentity --requires→ FenceAuthorityEpochIdentity`
- `RevisionBumpGeneration --does_not_prove→ FenceEpochContinuity`
- `FenceAuthorityEpochIdentity --qualifies→ FenceAuthorityGeneration`
- `ResourceAdmittedFenceEpoch --rejects→ PriorEpochFenceToken`
- `MCPToolAnnotation --claims→ ClaimedToolCapability`
- `ClaimedToolCapability --does_not_prove→ AttestedToolCapability`
- `ToolCapabilityEvidenceSet --supports→ AttestedToolCapability`
- `ToolSafetyRequirementProfile --filters→ AttestedToolCapability`
- `AttestedToolCapability --gates→ ToolDispatch`

## 本輪結束判定

- **缺哪一層：** multi-region / split-brain 時 `FenceAuthorityEpoch` 的 root-of-trust 與 resource admission protocol。
- **哪個節點最淺：** `ToolCapabilityEvidenceSet`，目前已定義結構但尚未跨 framework實測。
- **哪個概念仍只是名詞：** portable `ToolWriteCapability` attestation / signature contract。
- **哪個系統值得讀原始碼：** MCP TypeScript/Python SDK 的 `tools/list → tools/call → dispatch` 全路徑，其次 etcd MVCC restore/apply path。
- **哪篇論文/技術來源需追引用：** etcd disaster-recovery/revision-bump設計背後的 Kubernetes informer/watch correctness，以及 capability-based security與remote attestation文獻。
- **哪個概念最適合視覺模擬：** `Fence Epoch Restore & Tool Safety Router Simulator`。
- **哪個 Agent 架構最值得實作：** `Risk-aware Planner + Attested Tool Capability Registry + SemanticCommitEnvelope + Epoch-qualified Fence Authority + Resource-native Admission Gate + ReceiptVerifier`。

本輪將整條鏈推進為：

`UI → Agent → Plan → Effect Risk → Tool Capability Evidence → MCP Tool → SemanticCommit → FenceAuthority(epoch,generation) → Resource Admission → External Commit → Receipt → Observation → Context → UI`

核心結論：**Agent tool safety不能只問「工具叫什麼、參數是什麼、它自己說是否 idempotent」，而必須知道該能力屬於哪個 authority epoch、是否由真正的 resource enforce，以及 disaster recovery後舊世代的 Agent 是否仍可能拿著數字更大的舊 token 回來寫入。**