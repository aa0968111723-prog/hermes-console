# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-10 11:53 Asia/Taipei

## 本小時新發現

本輪承接上一輪「Message Logging × Deterministic Replay × External Effect Replay Boundary」，不再重複 checkpoint/message logging，而是專攻長期運行後一定會遇到的 production 問題：**Event-Sourced Agent State × Log Compaction × Snapshot Projection × Schema Evolution × Replay Compatibility**。

本輪核心問題：

```text
Agent event history 持續增長
↓
數十萬 / 數百萬 / 數十億 events
↓
不能每次啟動都從 event 1 replay
↓
需要 Snapshot / Projection / Compaction
↓
但 Runtime code、Event schema、Tool schema、Model interface 又會持續升級
↓
如何保證舊歷史仍能被新 Runtime 解讀？
```

本輪得到的核心結論：

> **Event Log 是歷史證據；Snapshot 是加速器；Projection 是可重建視圖；Compaction 是保留語義而非保留所有 bytes；Replay Compatibility 則是證明「目前這版 Runtime 還能理解當年的 Agent 世界」。**

---

# 本小時最重要 5 個發現

## 1. Snapshot ≠ Source of Truth

**已確認事實 / 官方資訊：** Akka Persistence 的 EventSourcedBehavior 以 journal events 恢復 actor state；snapshot 是 optional acceleration path。EventSourcingDB 也明確把 read model 視為 derivation 而非 source of truth，並說 snapshot 的用途是從某個狀態點開始，只 replay 後續 events。

Agent 對應：

```text
Canonical Event Log
E1 → E2 → E3 → ... → E900000

Snapshot S800000
↓
state_after(E800000)

Recovery:
load S800000
↓
apply E800001 ... E900000
```

因此 Snapshot 至少必須攜帶：

```text
snapshot_id
stream_id
last_event_id
last_event_offset
schema_version
projection_version
runtime_compatibility_id
state_hash
artifact_root_hash
```

如果 Snapshot 與 event offset 沒有明確綁定，就無法知道從哪裡安全接續 replay。

**為什麼重要：** Agent state 包含 plan、memory、branch、tool-result lineage、artifact references；如果 snapshot 被誤當 canonical truth，projection bug 可能永久寫死錯誤狀態。

**限制：** Snapshot 只是 replay optimization，無法取代外部 effect journal、determinant log、audit lineage。

---

## 2. Kafka-style Log Compaction ≠ Event-Sourcing History Compaction

**已確認事實 / 官方與原始碼：** Kafka log compaction 對 keyed mutable state 保留每個 key 至少最新值；LogCleaner 會先建立 `key -> last_offset`，重寫 segment 時省略已有較高 offset 更新的舊 record。Tombstone 表示 delete，並依 retention 規則後續清理。Kafka LogCleaner 原始碼也明確區分 clean / dirty / cleanable / uncleanable segments，active segment 永遠不可清理，transactional records 也受 last stable offset 約束。

Kafka：

```text
user42 → state A
user42 → state B
user42 → state C

compaction
↓
user42 → state C
```

但 Agent Event Sourcing 常是：

```text
GoalCreated
↓
PlanGenerated
↓
ToolSelected
↓
ToolResultObserved
↓
MemoryWritten
↓
BranchSelected
```

這些 events **不是同一 key 的「最新值覆蓋舊值」**，而是因果歷史。

因此 Hermes 必須把 compaction 分為：

```text
STATE COMPACTION
→ 可丟棄被覆蓋的 materialized state

EVENT COMPACTION
→ 只有在有語義等價證明時才能縮減

ARTIFACT COMPACTION
→ dedupe / GC / generational retention

AUDIT LOG
→ 可能完全不可壓縮
```

本輪提出：

```text
CompactionSafe(segment) =
    CoveredByValidatedSnapshot(segment)
∧   NoReplayDependency(segment)
∧   NoAuditRetention(segment)
∧   NoEffectReconciliationNeed(segment)
∧   NoSchemaMigrationNeed(segment)
```

這是 Hermes 工程模型，不是既有標準公式。

---

## 3. Event Schema Compatibility ≠ Replay Compatibility

**已確認事實 / 官方資訊：** Confluent Schema Registry 將 compatibility 分成 BACKWARD、FORWARD、FULL 與 transitive variants。Backward 表示新 consumer 能讀舊 data；Forward 表示舊 consumer 能讀新 data；transitive 則對所有歷史版本檢查，而非只比上一版。

但 Agent replay 多一層：即使 JSON/Avro/Protobuf **可以 deserialize**，新程式碼也可能對同一 event 產生不同 state transition。

例：

```text
Event v1:
ToolResultObserved {
  text: "..."
}
```

新 Runtime 增加：

```text
if confidence < 0.7:
    retry_tool()
```

舊 event 根本沒有 `confidence`。

Schema 層可能靠 default value 讀進來：

```text
confidence = 0
```

但 replay semantics 已改變：

```text
old runtime:
ToolResult → continue

new runtime:
ToolResult(confidence=0) → retry
```

因此：

```text
DeserializeCompatible
≠
ReplaySemanticallyCompatible
```

Hermes 應把 compatibility 拆成：

```text
Wire Compatibility
→ 能否 deserialize

Event Semantic Compatibility
→ event 的意思是否仍相同

Projection Compatibility
→ 新 projection 是否產生等價 state

Workflow Compatibility
→ control-flow 是否仍能 replay

Effect Compatibility
→ 是否會錯誤重做外部副作用
```

---

## 4. Temporal 顯示「程式碼版本」本身也必須成為 History 的一部分

**已確認工程實作 / GitHub 原始碼：** Temporal Go SDK 的 `GetVersion` 設計明確指出，running workflow 的 code 不能直接無版本修改，否則 replay determinism 會破壞；第一次執行會選擇版本並把 marker 記錄到 workflow history，之後 replay 使用 history 中記錄的版本。`internal_event_handlers.go` 也明確有首次非 replay 時建立 marker command 的路徑。

因此 Agent 的真正 event envelope 不應只有：

```text
{
  type,
  payload,
  timestamp
}
```

而應至少變成：

```text
AgentEventEnvelope {
  event_id
  stream_id
  sequence
  event_type
  event_schema_version
  runtime_semantics_version
  projection_version
  tool_contract_version
  model_contract_version
  capability_epoch
  payload
  causal_parents[]
  integrity_hash
}
```

這讓 replay engine 能回答：

```text
這個歷史是由哪一代 semantics 產生？
現在的程式能不能安全解讀？
是否需要 compatibility shim / upcaster？
```

重要新關係：

```text
Code Deployment Version
≠
Replay Semantics Version
```

同一個 deployment 可以同時需要支援多個歷史 semantics。

---

## 5. Upcasting / Event Adapter 比 Rewrite History 更安全

**已確認官方實作：** Akka Persistence 支援 EventAdapter / SnapshotAdapter，在 recovery 時將舊 persisted representation 轉換成目前 domain event/state；EventSourcingDB 也建議 breaking event change 使用新的 event type/version，讓不同版本 coexist，而不是修改既有歷史。

因此 Hermes 應採：

```text
Stored Event v1
↓
Deserializer
↓
Upcaster v1→v2
↓
Upcaster v2→v3
↓
Canonical Runtime Event v3
↓
Projection
```

而不是：

```text
直接把舊 log 全部 rewrite 成 v3
```

因為 rewrite 會破壞：

```text
Auditability
Event identity
Hash chain
Historical reproducibility
External references
Forensic comparison
```

更好的策略：

```text
Immutable Raw Event
+
Versioned Interpretation Layer
```

---

# Architecture Breakdown

本輪將 Hermes Event-Sourced Agent Runtime 建模為：

```text
User / Camera / Voice / Tool / GPU Result
↓
Agent Runtime
↓
Command / Observation Boundary
↓
Agent Event Envelope
├ event schema version
├ runtime semantics version
├ projection version
├ tool contract version
├ model contract version
└ causal lineage
↓
Append-Only Canonical Event Store
↓
Event Integrity / Hash Validation
↓
Replay Compatibility Gate
├ wire schema compatibility
├ semantic compatibility
├ runtime code compatibility
├ tool/model contract compatibility
└ effect boundary compatibility
↓
Event Adapter / Upcaster Chain
↓
Projection Engine
├ Agent State
├ Memory Brain
├ Knowledge Graph
├ Artifact Graph
├ UI Timeline
└ Audit View
↓
Snapshot Builder
↓
Snapshot Validation
├ last_event_offset
├ state_hash
├ projection_version
└ replay test
↓
Snapshot Store
↓
Compaction Planner
├ snapshot coverage
├ retention policy
├ audit requirement
├ causal dependency
└ effect reconciliation requirement
↓
Safe Segment Retirement
```

Recovery：

```text
Select Compatible Snapshot
↓
Verify snapshot state/hash/version
↓
Load Snapshot
↓
Fetch Events After Snapshot Offset
↓
Upcast
↓
Replay Projection
↓
Compare State Hash / Invariants
↓
Resume Agent
```

---

# Bottom-Level Logic

## A. Replay pipeline

不能只說「讀 event 再 replay」，必須拆：

```text
Locate Stream
→ Select Snapshot
→ Verify Snapshot Integrity
→ Read Snapshot Offset
→ Fetch Event Range
→ Deserialize Event
→ Resolve Event Schema Version
→ Resolve Runtime Semantics Version
→ Apply Upcaster Chain
→ Validate Causal Parent Availability
→ Apply Deterministic Projection
→ Validate Effect Boundary
→ Advance Replay Cursor
→ Compute State Hash
→ Compare Invariants
→ Mark Replay Compatible
```

## B. Snapshot validity

本輪提出：

```text
SnapshotValid(S) =
    IntegrityValid(S)
∧   ProjectionVersionSupported(S)
∧   EventOffsetStillResolvable(S)
∧   ArtifactRootsAvailable(S)
∧   EffectWatermarkValid(S)
∧   ReplayTailPasses(S)
```

## C. Semantic replay compatibility

```text
ReplayCompatible(history, runtime) =
    AllSchemasReadable
∧   AllRequiredUpcastersAvailable
∧   AllSemanticsVersionsSupported
∧   AllToolContractsInterpretable
∧   DeterministicProjectionMatches
∧   ExternalEffectsNotBlindlyReplayed
```

## D. Projection versioning

Projection 不應覆寫 canonical log：

```text
Event Log
├ Projection v1 → old UI
├ Projection v2 → current Agent State
├ Projection v3 → Knowledge Graph
└ Projection audit → forensic timeline
```

可以：

```text
DROP projection
↓
REBUILD from canonical events
```

但不能：

```text
DROP event history
↓
期待 projection 幫你還原原始因果
```

---

# Visual Simulation Idea

## Event Log Evolution & Replay Compatibility Lab

### 左側：Canonical History

```text
E1 GoalCreated          schema v1
E2 PlanGenerated        schema v1
E3 ToolCall             schema v1
E4 ToolResult           schema v1
E5 MemoryWritten        schema v2
...
E900000
```

### 中央：Runtime Versions

```text
Runtime R1
Runtime R2
Runtime R3 (current)

Upcasters:
v1 → v2 ✓
v2 → v3 ✓
v1 → v3 indirect ✓
```

### 右側：Snapshots

```text
S100k  projection v1
S400k  projection v2
S800k  projection v3
```

使用者可以按：

```text
DEPLOY NEW RUNTIME
ADD REQUIRED FIELD
RENAME EVENT
CHANGE TOOL SCHEMA
REMOVE UPCASTER
CREATE SNAPSHOT
COMPACT LOG
DELETE OLD SNAPSHOT
REPLAY FROM ZERO
REPLAY FROM SNAPSHOT
```

例如移除 `v1→v2` upcaster：

```text
Runtime R3
↓
load S800k
↓
只 replay E800001+
→ PASS
```

但按：

```text
FULL REPLAY / AUDIT REBUILD
```

就會：

```text
E1 schema v1
↓
NO COMPATIBILITY PATH
↓
REPLAY BROKEN
```

這會直接揭露一個很重要的 production 問題：

> 「平常服務啟動成功」不代表「完整歷史仍可重建」。

### Compaction 視覺模式

畫出：

```text
[HOT HEAD] [WARM HISTORY] [SNAPSHOT-COVERED] [AUDIT-LOCKED]
```

每個 segment 顯示：

```text
snapshot covered? YES
replay dependency? YES
external effect unresolved? NO
audit retention? 7 years
schema migration dependency? YES

COMPACTABLE = NO
```

---

# Code / GitHub

## Apache Kafka

值得繼續讀：

```text
storage/src/main/java/org/apache/kafka/storage/internals/log/
├ LogCleaner.java
├ LogCleanerManager.java
├ UnifiedLog.java
├ LogSegment.java
└ OffsetMap / cleaner-related structures
```

本輪確認 `LogCleaner.java` 的實際流程：

```text
clean / dirty / cleanable / uncleanable segments
↓
key → last_offset map
↓
recopy segments
↓
omit superseded records
↓
swap cleaned segment into log
```

以及：

```text
active segment = uncleanable
transactional cleaning stops at last stable offset
null payload = tombstone/delete
```

這非常值得 Hermes 借用其 **segment lifecycle**，但不能直接借用其「key latest value」語義作為 Agent event history compaction。

## Temporal Go SDK

值得繼續讀：

```text
internal/workflow.go
internal/internal_event_handlers.go
workflow/workflow.go
```

核心是：

```text
GetVersion
↓
首次執行選版本
↓
marker 寫入 history
↓
replay 使用歷史版本
```

這是 Hermes `runtime_semantics_version` 的直接工程參考。

## Akka Persistence

值得繼續讀：

```text
EventSourcedBehavior
EventAdapter
SnapshotAdapter
RetentionCriteria
persistence schema evolution
```

重點是：

```text
Persisted Representation
↓ EventAdapter
Current Domain Event
```

使 storage schema 與 current domain model 解耦。

---

# Papers / Technical Sources

## 1. Event Sourcing
- Title: Event Sourcing
- Author: Martin Fowler
- Institution: Thoughtworks / martinfowler.com
- Year: 2005（後續持續更新）
- Architecture: immutable event sequence → rebuild application state
- Contribution: 將「狀態」視為 event history 的投影，而不是唯一真相
- Limitation: 不直接解決大型歷史 replay、schema evolution、external effect correctness

## 2. Temporal Workflow Replay / Versioning（工程系統）
- Institution: Temporal
- Code: `temporalio/sdk-go`
- Architecture: Workflow code + durable event history + deterministic replay + version marker
- Contribution: 把 code-version choice 寫進 workflow history，讓長時間 workflow 可跨 deployment replay
- Limitation: Temporal 的 Workflow/Activity boundary 不等同一般 multimodal Agent 的 model/tool/GPU/artifact runtime，需要額外 abstraction

## 3. Kafka Log Compaction（工程系統）
- Institution: Apache Software Foundation
- Code: `apache/kafka`
- Architecture: partitioned append log + segment cleaner + key/offset deduplication + tombstones
- Contribution: 長期保留 keyed state 的最新 representation，同時控制 storage growth
- Limitation: compaction semantic 主要適用 keyed mutable state；不能直接拿來刪除因果型 Agent history

## 4. Akka Persistence Schema Evolution（工程系統）
- Institution: Lightbend / Akka
- Architecture: journal + event adapter + snapshot adapter + event sourced behavior
- Contribution: persisted data model 可以透過 adapter 演進，不必 rewrite immutable history
- Limitation: 仍需要應用自己維護長期 migration path，adapter chain 本身也可能變成技術債

## 5. Confluent Schema Compatibility（工程規格）
- Institution: Confluent
- Architecture: Schema Registry + compatibility policy
- Contribution: backward/forward/full/transitive compatibility 可自動檢查 wire-level schema evolution
- Limitation: 通過 schema compatibility 不代表 Agent replay/control-flow semantic compatibility

---

# Unknown / Open Questions

## 1. Upcaster chain 可以保留多久？

如果：

```text
v1 → v2 → v3 → ... → v38
```

永久保留所有 adapter 會增加測試與維運成本；刪除又可能讓 full-history replay 失效。

需要研究：

```text
Canonical Intermediate Representation
Event Re-basing
Verified Rewrite
Compatibility Archive Runtime
```

## 2. Snapshot 如何證明與 full replay 等價？

目前最需要的是：

```text
FullReplay(events[1..N])
==
Snapshot(N-k) + Replay(events[N-k+1..N])
```

應用 property-based testing / differential replay / state hash verification。

## 3. Model / Tool version 是否也算 replay schema？

例如歷史中：

```text
model=gpt-X revision A
```

現在 revision A 已不存在。

Replay 應：

```text
注入 historical output
```

還是：

```text
重新呼叫新版 model
```

若目標是重建歷史世界，答案通常偏向前者；若目標是 re-evaluation，則應建立新 branch，而不是污染 historical replay。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Canonical Agent Event Log
Agent Event Envelope
Event Schema Version
Runtime Semantics Version
Projection Version
Tool Contract Version
Model Contract Version
Event Upcaster
Event Adapter Chain
Snapshot Cursor
Snapshot State Hash
Replay Compatibility Gate
Wire Compatibility
Semantic Compatibility
Projection Compatibility
Workflow Compatibility
Compaction Planner
Compaction Proof
Snapshot-Covered Segment
Audit-Locked Segment
Historical Runtime Semantics
Compatibility Archive Runtime
```

## Edges

```text
Agent Event
→ persisted_in
Canonical Agent Event Log

Agent Event
→ interpreted_under
Runtime Semantics Version

Old Event
→ transformed_by
Event Upcaster

Event Upcaster
→ produces
Canonical Runtime Event

Canonical Event Log
→ projected_into
Agent State

Canonical Event Log
→ projected_into
Knowledge Graph

Snapshot
→ covers_through
Event Offset

Snapshot
→ accelerates
Replay

Replay Compatibility Gate
→ validates
Runtime Against History

Validated Snapshot
→ may_enable
Segment Compaction

Audit Requirement
→ blocks
Compaction
```

## Important negative edges

```text
Snapshot
≠
Source of Truth

Projection
≠
Canonical History

Kafka Log Compaction
≠
Agent Event Compaction

Schema Compatibility
≠
Replay Compatibility

Deserialize Success
≠
Semantic Equivalence

Code Version
≠
Replay Semantics Version

Current Service Boots
≠
Full History Is Replayable
```

---

# 下一輪研究

下一個最大缺口：

## Replay Verification × Differential Replay × State Hashing × Determinism Testing × Historical Runtime Certification

下一輪應回答：

```text
新 Runtime R4 要上線
↓
如何在 deployment 前證明：
10 萬條真實歷史 workflow
仍能 replay？
```

建議研究：

```text
Historical Event Corpus
↓
Old Runtime Projection
vs
New Runtime Projection
↓
State Hash
Graph Diff
Effect Diff
Branch Diff
↓
Compatibility Verdict
```

並深入：

- Temporal replay testing
- Event-sourcing projection rebuild tests
- Deterministic state-machine testing
- Property-based testing
- Differential testing
- Golden histories
- Replay fuzzing
- Shadow runtime
- Schema compatibility CI

最終 Hermes 可建立：

```text
REPLAY CERTIFICATION PIPELINE

PR / Runtime Update
↓
Historical Corpus
↓
Replay Old Runtime
↓
Replay New Runtime
↓
Compare Canonical Projection
↓
PASS / BREAKING / REQUIRES MIGRATION
```

---

# 本輪收斂

**缺哪一層：** Replay Verification / Certification Layer。

**哪個節點最淺：** `Compaction Proof`，尤其是「哪些因果型 Agent events 可被語義安全壓縮」。

**哪個概念仍只是名詞：** `Runtime Semantics Version ABI` 與 `Compatibility Archive Runtime`。

**哪個系統最值得讀原始碼：** Temporal `GetVersion` / replay internals、Kafka `LogCleaner.java`，其次 Akka EventAdapter / SnapshotAdapter。

**哪篇論文/資料需追引用：** Event Sourcing 的 projection/snapshot 實務、Temporal deterministic replay/versioning、以及 log-structured system 的 compaction/rebuild literature。

**哪個概念最適合視覺模擬：** `Event Log Evolution & Replay Compatibility Lab`。

**哪個 Agent 架構最值得實作：**

> **Versioned Event-Sourced Agent Runtime = Immutable Event Log + Versioned Event Envelope + Upcaster Chain + Rebuildable Projections + Validated Snapshots + Compatibility-Gated Compaction + Replay Certification**

本輪核心結論：

> **真正能活很多年的 Agent Runtime，不是「把狀態存下來」而已，而是必須讓十年前的 Agent event、今天的程式碼、未來的 schema 與不同世代的 Tool/Model contract 仍有一條可驗證的解讀路徑。Snapshot 可以讓恢復更快，Compaction 可以讓儲存更小，但只有 Replay Compatibility 才能保證 AI 的歷史沒有在升級途中失去意義。**
