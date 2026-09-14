# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-14 16:52（Asia/Taipei）

## 本小時研究主題
**Replay Sufficiency × Hidden Nondeterminism × Deterministic State Fold × Snapshot/Event Compaction × Cross-Version Replay**

本輪承接上一輪 `Causal Event Sourcing × Happens-Before Clocks × Deterministic Replay × Side-Effect Barriers × Counterfactual Scheduler`，不再重複「為什麼需要 event log / happens-before / idempotency」，而是深入下一個更難的問題：

> 一份 event history 到底要記到什麼程度才「足夠」重播？
> 當 code、prompt、model、tool schema、MCP server、retriever、encoder 甚至 snapshot schema 都改版後，舊歷史仍能支持哪些 replay？
> 哪些資訊可以壓縮掉，哪些一旦丟掉，就永久失去 debug / fork / counterfactual 能力？

本輪核心結論：

```text
State Reconstruction Sufficiency
≠
Behavior Replay Sufficiency
≠
Counterfactual Replay Sufficiency
≠
Forensic / Causal Sufficiency
```

這四種「足夠」必須分開管理。

---

# 本小時新發現

## 新論文 / 架構 / GitHub

1. **The Log is the Agent: Event-Sourced Reactive Graphs for Auditable, Forkable Agentic Systems** — Yohei Nakajima, Untapped Capital, 2026, arXiv:2605.21997。ActiveGraph 把 append-only log 當 source of truth、working graph 當 deterministic projection，直接把 replay/fork/lineage 提升為 agent substrate。
   - Paper: https://arxiv.org/abs/2605.21997
   - Code: https://github.com/yoheinakajima/activegraph

2. **Deterministic Replay for AI Agent Systems** — Rasheed Mudasiru, 2026, arXiv:2607.16200。`agrepl` 透過 MITM proxy 記錄 HTTP/LLM interactions，在隔離環境中 zero outbound network replay；研究報告 250 次 replay、F=1.0，並報告 median per-step latency reduction 98.3%。
   - Paper: https://arxiv.org/abs/2607.16200
   - Code: https://github.com/Taiwrash/agrepl

3. **DelAct: A Replayable Boundary Runtime for Auditable and Governed LLM Agent Workflows** — IEEE/ACM IWQoS 2026。把 deliberation 與 actuation 分開，用 commitment hash、idempotency / in-doubt verification / compensation + append-only observability plane 建 replay-to-live boundary。
   - DOI: 10.1109/IWQoS70441.2026.11661202

4. **Foundational Abstractions for Core Entities and Query Mechanisms in Event-Sourced Systems** — Ihor Yankin, Yurii Gunchenko, Odesa I. I. Mechnikov National University, 2026。把 event / stream / aggregate / projection / snapshot / version 與 reconstruction、temporal、cross-stream、retroactive replay query formalize 成明確契約，強調版本 normalization 與 replay-equivalent semantics。
   - DOI: https://doi.org/10.31891/csit-2026-2-19

5. **ActiveGraph v1.5+ compaction implementation** — 本輪實際追到 `activegraph/store/sqlite.py` 與 `activegraph/store/retention.py`，不是只看 README。它已實作 snapshot sidecar、archive tier、state hash verification、pin set、pre-snapshot fork restriction，提供非常具體的 production trade-off 範例。

6. **Temporal Workflow Versioning / Replay Testing** — 官方文件再次確認：相同 history 下 workflow orchestration 必須產生相同 command sequence；code change 若改變 command shape/order，需 Worker Versioning 或 patch marker。它也明確提醒 runtime replay compatibility checking 並不是 semantic-equivalence proof。
   - Docs: https://docs.temporal.io

---

# 本小時最重要 5 個發現

## 1. 「Replay sufficient」不是單一 Boolean，而是 4 層能力

### 概念
很多系統只說：

```text
replay_supported = true
```

但這太粗。

本輪建議 Hermes 改成四層：

```text
ReplaySufficiencyLevel

L0 NONE
L1 STATE_RECONSTRUCTABLE
L2 BEHAVIOR_REPLAYABLE
L3 COUNTERFACTUAL_FORKABLE
L4 FORENSIC_CAUSAL_REPLAYABLE
```

### L1 — State Reconstruction Sufficiency
只要求：

```text
Event/Snapshot History
↓
Fold
↓
Current projected state
```

例如：

```text
objects
relations
memory state
approval state
```

能重建即可。

### L2 — Behavior Replay Sufficiency
除了 state，還要能重播原 execution 的 deterministic boundary：

```text
model output
HTTP/tool response
clock value
random value
retriever result
scheduler choice
user interrupt
```

否則是 state restore，不是 behavior replay。

### L3 — Counterfactual Forkability
要求能在某一事件以前保留足夠歷史，然後：

```text
replay prefix
↓
fork at event e
↓
replace policy/model/tool/scheduler choice
↓
run new tail
```

這需要比「重建 current state」更多的 prefix evidence。

### L4 — Forensic / Causal Replayability
要求能回答：

```text
哪個 observation 被誰看見？
哪個 state version 被讀？
哪個 model/tool version 產生結果？
哪一個 event causally enabled 下一個 event？
哪些 side effects 已經 commit？
```

這才適合事故調查與因果 debug。

### 為什麼重要
ActiveGraph compaction 是非常好的真實例子。它的 phase-1 compaction 會：

```text
snapshot current projected state
↓
archive pre-snapshot prefix
↓
post-snapshot replay remains possible
```

但設計文件明確指出，**pre-snapshot fork point 會拒絕**，因為 replay cache / fork semantics 依賴舊 prefix。也就是：

```text
State still reconstructable
but
Historical branchability reduced
```

所以：

```text
Snapshot correctness
≠
Full historical replay capability
```

### 新 Runtime Contract

```text
ReplaySufficiencyCertificate
├ run_id
├ horizon_event_id
├ state_reconstructable
├ behavior_replayable
├ counterfactual_forkable
├ causal_audit_complete
├ required_artifacts[]
├ missing_artifacts[]
├ snapshot_id
├ archive_locations[]
└ expiry_conditions[]
```

---

## 2. Snapshot 是「語義承諾」，不是單純效能快取

### 已確認工程實作：ActiveGraph
`activegraph/store/sqlite.py` 的 event store 使用：

```text
events
runs
meta

events_archive
snapshots
```

其中：

```text
snapshot
├ state_hash
├ canonical state blob
└ replay suffix
```

`retention.py` 的 canonical snapshot blob 包含 projected objects + relations，排序後 JSON canonicalization，再做 SHA-256：

```text
blob = canonical_json(projected_state)
state_hash = SHA256(blob)
```

load 時若 snapshot blob 與 event 裡的 state hash 不一致，直接 `SnapshotIntegrityError`。

更重要的是：

```text
verify_snapshot()
```

會重新 replay archived prefix，建立 scratch projection，再比較 snapshot hash。

所以 snapshot 不是：

```text
「快一點的 cache」
```

而是：

```text
Historical Prefix
→ Deterministic Projection
→ Canonical Blob
→ Cryptographic Commitment
```

### Bottom-level mechanism
Hermes 應採：

```text
S_t = Fold(S_0, e_1 ... e_t)

Snapshot_t = Canonicalize(S_t)

H_t = Hash(
  snapshot_schema_version,
  projection_code_version,
  canonicalization_version,
  Snapshot_t
)
```

注意 ActiveGraph 目前 hash 主要覆蓋 canonical blob bytes；Hermes 若要做跨版本 replay，應額外把 projection semantics/version 放入 commitment contract，否則：

```text
same bytes
```

不必然代表：

```text
same semantic interpretation under future code
```

### 新 edge

```text
Snapshot Integrity
≠
Snapshot Semantic Compatibility
```

以及：

```text
Byte-Identical State
≠
Behaviorally Equivalent Runtime
```

---

## 3. Hidden nondeterminism 比 LLM sampling 大很多

### 問題
上一輪已經知道 LLM output 必須 journal；本輪更進一步整理：真正 Agent replay 會被下列 hidden nondeterminism 破壞：

```text
Time
├ wall clock
├ timezone
├ monotonic clock
└ timeout boundary

Randomness
├ model sampling
├ application PRNG
├ UUID
└ randomized retry jitter

Environment
├ env vars
├ feature flags
├ locale
├ filesystem ordering
├ package/runtime version
└ GPU/kernel/library behavior

External State
├ API response
├ browser DOM
├ DNS/CDN headers
├ retrieval index state
├ vector DB mutation
├ MCP server state
└ permissions

Concurrency
├ task scheduling
├ race winner
├ message arrival order
├ async completion order
└ cancellation timing

Model Infrastructure
├ model checkpoint
├ tokenizer
├ system prompt
├ tool schema
├ decoding config
├ model router
└ fallback model
```

`agrepl` 2026 的核心正是把 external interaction boundary 放到 transport layer：HTTP/LLM interaction 被錄下，在 isolated replay 中 lookup 回原 response，而不是重打網路。

### 關鍵新概念
Hermes 應建：

```text
NondeterminismManifest
├ source_id
├ category
├ captured_value_ref
├ capture_layer
├ replay_mode
├ stable_key
├ matching_policy
├ ignored_noise_fields[]
└ completeness_status
```

### Replay matching 也有風險
如果 matching 太嚴：

```text
request timestamp/header 改一點
→ replay miss
```

如果 matching 太鬆：

```text
two semantically different calls
→ accidentally reuse same recording
```

所以：

```text
Replay Key Robustness
↔
Replay False-Match Risk
```

Hermes 不應只有 `request_hash`，而應拆：

```text
ReplayKey
├ semantic identity fields
├ volatile ignored fields
├ model/tool/schema version
├ context dependency hash
└ matching confidence
```

### 新 edge

```text
Captured External Response
≠
Complete Determinism
```

因為 scheduler / local clock / env / filesystem / policy branch 一樣可能改變 call sequence。

---

## 4. Cross-version replay 的核心不是「舊 log 能不能 parse」，而是「舊 history 對新 runtime 的語義還成立嗎」

### Temporal 提供非常清楚的 production lesson
Temporal replay 要求：

```text
same history
↓
workflow code
↓
same command sequence
```

如果舊 workflow 是：

```text
Timer
→ Activity
```

新 code 改成：

```text
Activity
→ Timer
```

replay 會因 command/history mismatch 被判定 non-deterministic。

因此 Temporal 用：

```text
Worker Versioning
或
Patch Markers
```

讓 old history 留在 old semantic branch，而新 run 使用新 branch。

### 但 Agent 更難
Agent 的版本維度遠多於 workflow code：

```text
AgentRuntimeVersion
PromptVersion
PolicyVersion
ModelVersion
TokenizerVersion
ToolSchemaVersion
MCPServerVersion
MemorySchemaVersion
EmbeddingModelVersion
RetrieverVersion
ProjectionVersion
SafetyPolicyVersion
```

所以 cross-version replay 需要：

```text
HistoryCompatibilityMatrix
```

例如：

| Historical artifact | New runtime | Compatibility |
|---|---|---|
| tool response v1 | tool schema v2 additive | ADAPTABLE |
| tool response v1 | tool semantics changed | INVALID |
| snapshot schema v2 | projection v3 with upcaster | MIGRATABLE |
| model output old | new model checkpoint | REPLAY_AS_RECORDED only |
| old prompt + old result | new prompt | COUNTERFACTUAL_ONLY |
| embedding vector v1 | embedding model v2 | RE-EMBED REQUIRED |

### 新 Runtime Contract

```text
ReplayCompatibilityContract
├ history_schema_version
├ runtime_version
├ projection_version
├ model_dependency_versions
├ tool_schema_versions
├ MCP_contract_versions
├ prompt_versions
├ adapters[]
├ semantic_breaks[]
└ replay_mode
```

`replay_mode`：

```text
STRICT_RECORDED
MIGRATED_STATE_ONLY
BEHAVIOR_COMPATIBLE
COUNTERFACTUAL_FORK
AUDIT_ONLY
UNSUPPORTED
```

### 重要新 edge

```text
Schema Parse Compatibility
≠
Replay Semantic Compatibility
```

以及：

```text
Command-Sequence Compatibility
≠
Business-Semantic Equivalence
```

Temporal 官方文件也明確提醒 runtime nondeterminism checks 並非完整 semantic checker；例如某些 argument-only changes 可能不一定由低階 replay matching 完整捕捉。因此 Hermes 需要 semantic dependency/version contract，而不能只相信「replay 沒報錯」。

---

## 5. Compaction 必須以「未來想回答什麼問題」決定，不是只用 event age

### 一般錯誤
很多 retention 系統的想法是：

```text
事件 > 30 天
→ snapshot
→ 刪掉 / 冷藏
```

但對 self-debugging / self-improving Agent，歷史價值不是均勻的。

例如：

```text
LLM response
Tool response
Approval decision
Policy version marker
Model migration marker
Safety veto
External write receipt
Fork point
Promotion provenance
```

這些 event 即使很舊，也可能仍是：

```text
replay evidence
counterfactual branch root
causal provenance
safety evidence
regression baseline
```

ActiveGraph 的 retention pin set 已經實作類似思路：

```text
promoted-from fork
live lineage
pending approval
proposed patch
```

都會阻止 compact/retire，因為 archive/compaction 可能破壞 lineage / machinery。

### Hermes 應再擴充成 capability-aware retention

```text
RetentionPin
├ PROVENANCE_REQUIRED
├ REPLAY_CACHE_REQUIRED
├ COUNTERFACTUAL_FORK_REQUIRED
├ SAFETY_AUDIT_REQUIRED
├ EXTERNAL_EFFECT_RECEIPT
├ OPEN_INCIDENT
├ MODEL_MIGRATION_BASELINE
├ KNOWLEDGE_CERTIFICATE_DEPENDENCY
└ LEGAL_RETENTION
```

而 compaction planner 應輸出：

```text
CompactionImpactReport
├ storage_saved
├ replay_cost_after
├ lost_fork_points[]
├ lost_behavior_replay_scope[]
├ causal_queries_degraded[]
├ certifications_affected[]
└ safe_to_compact
```

### 新 edge

```text
Old Event
≠
Low-Value Event
```

以及：

```text
Storage Optimization
→ Can Reduce Epistemic / Debugging Capability
```

---

# Architecture Breakdown

本輪形成新的 Hermes：

## **Replay Sufficiency & Cross-Version History Runtime**

```text
UI / User / Camera / Voice / Browser
Models / Tools / MCP / Memory / Scheduler
↓
Event Interceptors
↓
Canonical Event Envelope
↓
Nondeterminism Capture Layer
├ model outputs
├ tool responses
├ HTTP/MCP responses
├ clock
├ random
├ env/config
├ scheduler decisions
├ race outcomes
├ user interrupts
└ retrieval / sensor observations
↓
Append-Only Event Log
↓
Causal / Version Dependency Graph
↓
Replay Sufficiency Analyzer
├ state reconstruction
├ behavior replay
├ counterfactual fork
└ forensic causal audit
↓
Snapshot Builder
├ canonical projection
├ state hash
├ projection version
└ covered horizon
↓
Retention / Pin Analyzer
↓
Archive / Snapshot
↓
Cross-Version Compatibility Router
├ strict recorded replay
├ adapter/upcast
├ version-pinned replay
├ migrated state replay
├ counterfactual fork
└ unsupported
↓
Divergence Detector
↓
Replay / Fork / Regression Certificate
```

---

# Bottom-Level Logic

## A. Deterministic fold

```text
S_0
↓ e_1
S_1
↓ e_2
S_2
...
↓ e_t
S_t
```

形式：

```text
S_t = F_v(S_(t-1), Normalize_v(e_t))
```

其中：

```text
F_v = projection function at semantic version v
Normalize_v = event upcaster / adapter chain
```

所以 cross-version replay 真正是：

```text
Old immutable event
↓
Version adapter chain
↓
Current normalized semantic event
↓
Projection F_v
↓
State
```

但若 adapter 改變真正 business meaning，就不是 upcast，而是 semantic rewrite，必須拒絕 silent replay。

## B. Snapshot replay

```text
Snapshot at e_k
+
e_(k+1) ... e_t
↓
Current State
```

Valid snapshot 至少需：

```text
Hash(snapshot_blob) == recorded_hash
```

Hermes 建議再加：

```text
projection_semantics_version compatible
canonicalization_version compatible
required provenance preserved
```

## C. Replay completeness

定義 runtime 所需 nondeterministic source set：

```text
N = {n_1, n_2, ... n_m}
```

歷史 capture set：

```text
C ⊆ N
```

若：

```text
N - C ≠ ∅
```

則 deterministic replay 只能是 conditional guarantee：

```text
Deterministic
GIVEN uncaptured sources do not affect branch/output
```

所以應輸出：

```text
ReplayCompletenessScore
+
MissingNondeterminismSources
```

而不是「100% replayable」的單一布林值。

## D. Version compatibility

```text
History H_v1
+
Runtime R_v2
↓
Compatibility(H_v1, R_v2)
```

分解：

```text
Syntax compatibility
Schema compatibility
Projection compatibility
Command compatibility
Tool semantic compatibility
Model dependency compatibility
Safety-policy compatibility
Counterfactual comparability
```

只有全部符合 requested replay mode 所需的最低條件，才能發 certificate。

---

# Visual Simulation Idea

## **Replay Sufficiency × History Compaction × Version Migration Lab**

Hermes Console 直接顯示一條完整 run：

```text
E1 UserInput
E2 PromptBuild
E3 LLMResponse
E4 ToolCall
E5 ToolResponse
E6 MemoryWrite
E7 SafetyCheck
E8 ExternalWrite
E9 FinalAnswer
```

### 左側：Nondeterminism Coverage

```text
LLM output          ✓ captured
Tool response       ✓ captured
Clock               ✓ captured
Random              ✓ captured
Env flags           ✗ missing
Retriever version   ✓ captured
Scheduler race      ✗ missing
GPU/kernel          ? unknown
```

顯示：

```text
State Replay        100%
Behavior Replay      83%
Counterfactual Fork  71%
Forensic Causality   76%
```

### 中央：Compaction slider

使用者把 snapshot horizon 從 E1 拖到 E6：

```text
Before
9 hot events
all fork points available

After
snapshot@E6
E1–E6 archived
E7–E9 hot
```

Console 立即顯示：

```text
Storage cost        ↓ 64%
State rebuild cost  ↓ 72%

Fork @ E8           AVAILABLE
Fork @ E3           ARCHIVE REQUIRED / BLOCKED
LLM replay cache E3 COLD
Causal audit        archive-dependent
```

讓使用者看到：

> 「壓縮 log」不是免費優化，而是在交換未來可回答問題的範圍。

### 右側：Version Migration

```text
Recorded Runtime
agent-runtime 1.8
prompt P17
model M4
ToolSchema payment@v2
Projection v3

New Runtime
agent-runtime 2.1
prompt P22
model M7
ToolSchema payment@v3
Projection v4
```

逐層顯示：

```text
Event parse          PASS
Projection adapter   PASS
Tool schema          WARNING
Prompt compatibility COUNTERFACTUAL ONLY
Model replay         RECORDED OUTPUT ONLY
Safety semantics     FAIL
```

最後：

```text
STRICT CROSS-VERSION REPLAY
BLOCKED

STATE MIGRATION
ALLOWED

COUNTERFACTUAL FORK AFTER E6
ALLOWED IN SANDBOX
```

---

# Code / GitHub

## 1. yoheinakajima/activegraph
https://github.com/yoheinakajima/activegraph

本輪實際追的檔案：

```text
activegraph/store/sqlite.py
activegraph/store/retention.py
compaction-design.md
activegraph/core/graph.py
CHANGELOG.md
CONTRACT.md
```

### `activegraph/store/sqlite.py`
值得看的底層點：

```text
seq INTEGER PRIMARY KEY AUTOINCREMENT
```

被當作 projection ordering authority，而不是 timestamp。

另有：

```text
events_archive
snapshots
schema_version
```

### `activegraph/store/retention.py`
已實作：

```text
compact()
retire()
pins()
verify_snapshot()
_canonical_state_blob()
state_hash_of()
```

這是本輪最值得 Hermes 直接借鑑的 code。

`compact()` 的實際流程：

```text
check pins
↓
Runtime.load
↓
project current graph
↓
canonical JSON blob
↓
SHA-256
↓
emit runtime.snapshot
↓
put snapshot sidecar
↓
archive prefix
```

`verify_snapshot()` 則：

```text
archived prefix
↓
scratch graph replay
↓
canonical state
↓
hash
↓
compare recorded snapshot hash
```

### ActiveGraph 目前清楚的限制
phase-1 design 明列：

- archive tier 目前仍在同一 store file；
- causal chain archive support 有 phase boundary；
- pre-snapshot fork point 會被限制；
- patch history 的 projected reconstruction 並非完整保留。

這非常適合 Hermes 用來定義 `ReplaySufficiencyCertificate`，而不是泛稱「支援 replay」。

## 2. Taiwrash/agrepl
https://github.com/Taiwrash/agrepl

值得繼續看的方向：

```text
MITM interception
trace serialization
request matching key
noise-aware HTTP diff
offline network isolation
```

它適合補 Hermes 的 transport-level nondeterminism capture，但不足以單獨解決 scheduler/state/model-version semantics。

## 3. Temporal documentation/runtime
值得 Hermes 借鑑：

```text
history → deterministic command sequence
version-pinned workers
patch markers
replay tests before deployment
```

Hermes 應將其概念擴展到：

```text
PromptVersion
ModelVersion
ToolSchemaVersion
MCPVersion
ProjectionVersion
Evidence/CalibrationVersion
```

---

# Papers

## Paper 1
**Title:** The Log is the Agent: Event-Sourced Reactive Graphs for Auditable, Forkable Agentic Systems  
**Authors:** Yohei Nakajima  
**Institution:** Untapped Capital  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2605.21997  
**Code:** https://github.com/yoheinakajima/activegraph  
**Dataset / Example:** worked diligence example / ActiveGraph runtime traces  
**Architecture:** Append-only Event Log → deterministic Graph Projection → reactive Behaviors → new Events  
**Contribution:** 把 event log 從 observability artifact 提升成 agent source-of-truth；由此提供 replay/fork/lineage。  
**Limitations:** 論文本身對 self-improvement 的更廣泛效能主要是架構論證，不代表已經證明所有長期 self-improving agent 問題。  
**改變了什麼:** 把 Agent identity 從「model + loop + memory」改寫成「history + deterministic projections + behavior contracts」。

## Paper 2
**Title:** Deterministic Replay for AI Agent Systems  
**Authors:** Rasheed Mudasiru  
**Institution:** 論文公開摘要未在本輪來源中清楚標出，暫列未驗證  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2607.16200  
**Code:** https://github.com/Taiwrash/agrepl  
**Dataset:** five workloads, n=250 replay instances（論文報告）  
**Architecture:** Agent Process → MITM Transport Interceptor → Structured Trace → isolated zero-network Replay  
**Contribution:** 把外部 HTTP / LLM interaction 捕捉放在 transport boundary，而非依賴 framework-specific instrumentation。  
**Limitations:** transport replay 不等同完整 runtime replay；local scheduler/env/filesystem/GPU/model-routing nondeterminism 仍可能需要額外 capture。  
**改變了什麼:** 提供「agent debugging = isolated deterministic environment」的具體 developer runtime。

## Paper 3
**Title:** DelAct: A Replayable Boundary Runtime for Auditable and Governed LLM Agent Workflows  
**Authors:** 本輪 IEEE 搜尋結果未完整回傳作者清單，暫不猜測  
**Institution:** 未完整驗證  
**Year:** 2026  
**Venue:** IEEE/ACM IWQoS 2026  
**URL/DOI:** https://doi.org/10.1109/IWQoS70441.2026.11661202  
**Architecture:** Control Plane + Data/Actuation Plane + Observability Plane  
**Contribution:** tool side effect 透過 commitment hash governance、in-doubt verification、idempotency 與 compensation；event log 支援 replay/replay-to-live fork。  
**Limitations:** 評估集中於 Ticket/Invoice workflow 與 fault-injection；尚不能直接推論到所有 browser/computer/multimodal Agent。  
**改變了什麼:** 將 replay-safe reasoning 與 effectful actuation 之間的 boundary 變成一級架構。

## Paper 4
**Title:** Foundational Abstractions for Core Entities and Query Mechanisms in Event-Sourced Systems  
**Authors:** Ihor Yankin, Yurii Gunchenko  
**Institution:** Odesa I. I. Mechnikov National University  
**Year:** 2026  
**DOI:** https://doi.org/10.31891/csit-2026-2-19  
**Architecture:** immutable histories + contract-defined query mechanisms + snapshots + versions  
**Contribution:** formalize reconstruction / temporal / cross-stream / retroactive replay，並把 normalization/version policy 顯式化。  
**Limitations:** 偏 event-sourcing formal foundation，不是 Agent-specific runtime；distributed time uncertainty / eventual consistency 仍列為後續方向。  
**改變了什麼:** 強化一個重要觀念：replay/query semantics 必須由 contract 定義，不能只由資料「看起來還在」決定。

---

# 已確認事實 / 工程實作 / 合理推論 / 尚未驗證假說

## 已確認事實 / 官方資訊
- Temporal 要求 workflow orchestration replay 時對同一 history 產生 compatible command sequence；不相容 code change 需要 versioning / patching。
- ActiveGraph 的 event log 是 source of truth、graph 是 deterministic projection。
- ActiveGraph 已有 SQLite hot event table、archive table、snapshot sidecar 與 snapshot verification code。

## 論文結果
- agrepl 論文報告 250 replay instances、replay fidelity F=1.0、median per-step latency reduction 98.3%。
- DelAct 論文報告其治理方案可避免測試中的 timeout-induced duplicate writes，並提供 rollback repair measurement。

## 工程實作
- ActiveGraph `compact()` 實際建立 canonical state blob + SHA-256 snapshot，然後 archive prefix。
- `verify_snapshot()` 實際透過 archived prefix replay 對 snapshot 做 hash verification。
- ActiveGraph compaction 明確限制部分 pre-snapshot fork semantics。

## 合理推論
- Hermes 應把 replay ability 拆成 state / behavior / counterfactual / forensic 四層。
- Snapshot hash 應納入 projection / canonicalization semantic version，而不只 state bytes。
- Agent history retention 應以 capability dependency/pin 決定，而不是只看 age。

## 尚未驗證假說
1. 對大型 multimodal agent，完整 `NondeterminismManifest` 是否能在合理 storage overhead 下捕捉到足以提供 L3/L4 replay 的資訊。
2. 能否自動學出「最小 replay-sufficient trace」，在保留 counterfactual validity 下移除無影響事件。
3. 是否能建立跨 model/provider 的 semantic replay equivalence certificate，而不依賴 exact output equality。

---

# Unknown / Open Questions

## 1. Minimal Replay Trace 到底可不可以安全自動化？

如果最終 output 只依賴：

```text
E1 → E3 → E7 → E9
```

是否可以把：

```text
E2 E4 E5 E6 E8
```

從 replay bundle 移除？

困難是：沒影響**這次 output**，不代表不影響：

```text
counterfactual policy
future model
future safety audit
future causal query
```

因此 minimal trace 必須對「目標 query class」定義，而不是全域最小。

## 2. Semantic replay 成功應該怎麼定義？

新模型可能輸出不同文字但做出同一 decision：

```text
Exact text mismatch
but
same tool
same args
same permission
same world-state mutation
```

這算 replay divergence 還是 semantic equivalence？

未來可能需要：

```text
ReplayEquivalenceLevel
├ BYTE
├ COMMAND
├ STATE_TRANSITION
├ DECISION
├ POLICY
└ OUTCOME
```

## 3. Snapshot migration 如何避免「合法 parse、錯誤 meaning」？

Upcaster 很容易做到：

```text
v1 JSON
→ v2 JSON
```

但若 event 意義已變：

```text
status=done
```

在 v1 代表「model finished」，v2 代表「external effect committed」，純 schema adapter 會製造 silent semantic corruption。

所以 schema migration 必須和 semantic version contract 分開。

---

# Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Replay Sufficiency
ReplaySufficiencyCertificate
State Reconstruction Sufficiency
Behavior Replay Sufficiency
Counterfactual Fork Sufficiency
Forensic Causal Sufficiency
Nondeterminism Manifest
Hidden Nondeterminism Source
Replay Key
Replay Match Policy
False Replay Match
Replay Completeness Score
Snapshot Semantic Version
Snapshot Integrity
Snapshot Semantic Compatibility
Projection Version
Canonicalization Version
History Compatibility Matrix
ReplayCompatibilityContract
Version Adapter
Event Upcaster
Semantic Migration
Semantic Replay Equivalence
ReplayEquivalenceLevel
Capability-Aware Retention
Retention Pin
CompactionImpactReport
Historical Fork Horizon
Replay Horizon
Archive-Dependent Audit
```

## 新 Edges

```text
State Reconstruction
≠ Behavior Replay

Behavior Replay
≠ Counterfactual Forkability

Counterfactual Forkability
≠ Forensic Causal Sufficiency

Snapshot Integrity
≠ Snapshot Semantic Compatibility

Byte-Identical State
≠ Behaviorally Equivalent Runtime

Captured External Responses
≠ Complete Runtime Determinism

Schema Parse Compatibility
≠ Replay Semantic Compatibility

Replay Passes
≠ Business Semantics Preserved

Compaction
→ Reduces Replay Cost

Compaction
→ May Reduce Historical Forkability

Archive Removal
→ May Destroy Future Causal Evidence

Old Event
≠ Low-Value Event

Version Adapter
→ Enables Cross-Version Parse

Semantic Version Contract
→ Governs Cross-Version Meaning

Missing Nondeterminism Source
→ Weakens Replay Guarantee

Replay Matching Too Loose
→ False Match Risk

Replay Matching Too Strict
→ False Divergence Risk
```

---

# 與歷史研究比較：本輪沒有重複什麼？

上一輪已經建立：

```text
Causal Event Envelope
Happened-Before
Logical Clock
Replay Signature
Effect Receipt
Replay Barrier
Counterfactual Scheduler
```

本輪新增的不是另一套 event logging，而是回答：

```text
「這份 log 到底夠不夠？」
```

具體新增：

```text
replay sufficiency levels
hidden nondeterminism completeness
snapshot semantic commitment
compaction capability loss
cross-version compatibility
semantic replay equivalence
```

所以研究層次從：

```text
Record → Replay
```

提升成：

```text
Record
↓
What guarantee does this record actually support?
↓
Compact / migrate / version change
↓
Which guarantees survive?
```

---

# 下一輪研究

現在最自然的缺口是：

# **Semantic Replay Equivalence × Minimal Sufficient Trace × Dynamic Program Slicing × Causal Responsibility**

因為現在已經知道一份 history 可能「不需要全部事件」才能回答某個問題，但真正需要解：

```text
Final wrong answer
↓
Which events were actually necessary?
↓
Which state reads influenced the decision?
↓
Which model/tool outputs were causally relevant?
↓
Can we remove other events and preserve outcome?
↓
Minimal Replay Slice
```

下一輪應深入：

```text
Event DAG
↓
Dynamic dependency tracking
↓
Data / control / state dependency
↓
Backward slice from outcome
↓
Replay candidate slice
↓
Counterfactual deletion test
↓
Minimal sufficient trace
↓
Causal responsibility score
```

並比較：

```text
Program Slicing
Dynamic Taint
Causal Graph
Actual Causality
Counterfactual Explanation
Agent Trace Attribution
```

---

# 本輪結束回答

## 缺哪一層？
**Semantic Trace Reduction + Causal Responsibility Layer**。

現在 Hermes 已能描述 event history、version、snapshot 與 replay boundary，但還不能自動判定：

> 「這個結果真正需要 history 裡的哪 12 個事件？」

## 哪個節點最淺？

```text
MinimalReplayTrace
SemanticReplayEquivalence
ReplayCompletenessScore
SnapshotSemanticCompatibility
```

## 哪個概念仍只是名詞？
**Production-grade Counterfactual Replay Sufficiency Certificate** 仍主要是架構概念；尤其 multimodal/browser/computer agent 的完整 hidden nondeterminism manifest 尚無統一標準。

## 哪個系統最值得讀原始碼？
**ActiveGraph**：

```text
activegraph/store/retention.py
→ activegraph/store/sqlite.py
→ activegraph/core/graph.py
→ runtime load/replay/fork
→ tests/test_compaction.py
```

其次是 `agrepl`，專注 transport-layer capture / replay matching。

## 哪篇論文需追引用？
1. **The Log is the Agent** — 追 event-sourced Agent / fork / audit / self-improvement 後續。
2. **Deterministic Replay for AI Agent Systems** — 追 AI-specific replay fidelity、matching、network isolation。
3. **Deterministic Replay: A Survey** 類基礎系統研究 — 補 Agent 圈常忽略的 OS/concurrency replay 理論。

## 哪個概念最適合視覺模擬？
**Replay Sufficiency × History Compaction × Version Migration Lab**。

它可以最直覺展示：

```text
「log 還在」
≠
「什麼都還能重播」
```

## 哪個 Agent 架構最值得實作？

```text
Canonical Event Envelope
↓
Nondeterminism Manifest
↓
Append-Only Event Log
↓
Causal + Version Dependency Graph
↓
Replay Sufficiency Analyzer
↓
Snapshot + Capability-Aware Retention
↓
Cross-Version Compatibility Router
↓
Replay / Fork / Migration Certificate
```

---

# 對「AI 到底怎麼運作」本輪新增的核心

目前還原鏈已經可以再向底層補一段：

```text
User says something
↓
UI Event
↓
Agent Context / Planner
↓
Model generation
↓
Tool / MCP / Memory / Browser
↓
Async event graph
↓
Nondeterministic observations
↓
Append-only execution history
↓
Projected agent state
↓
Snapshot / archive / version migration
↓
Replay or counterfactual fork
↓
Output
```

真正成熟的 AI Agent 不只要「記得自己做過什麼」，還必須知道：

> **自己到底記得得夠不夠。**

一個 snapshot 可能足以恢復 current state，卻不足以回到三小時前改變一個 tool choice；一份 HTTP cassette 可能足以重播 network calls，卻不足以重播 scheduler race；一份舊 event log 可能仍可被新程式 parse，卻已經不再具有相同語義。

因此可驗證 Agent 下一個核心 primitive 不是更多 logging，而是：

```text
Replay Sufficiency Certificate
```

讓系統對每段歷史明確回答：

```text
我能恢復 state 到哪裡？
我能重播 behavior 到哪裡？
我能 fork counterfactual 到哪裡？
我能提供 forensic causal proof 到哪裡？
版本改變後哪些能力仍成立？
```

只有到了這一層，「AI 為什麼得到這個結果」與「如果當時換一個決定會怎樣」才開始從 trace viewer 走向真正可驗證的 runtime science。