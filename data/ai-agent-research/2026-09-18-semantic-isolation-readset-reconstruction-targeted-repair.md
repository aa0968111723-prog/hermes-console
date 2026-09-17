# AI Agent × Multimodal Research Report

時間：2026-09-18 04:55 Asia/Taipei

主題：Semantic Isolation × Read-Set Reconstruction × Stale-Generation × Targeted Repair

## 與歷史研究比較

09/08 已建立 Multi-Agent Shared-State Concurrency 的基本分類：Agent-local、message-carried、runtime shared、external shared mutable state，並比較 AutoGen message passing 與 LangGraph reducer。09/18 03:55 已建立 CrossProviderCausalWitness / SettlementVector，處理 effect 已發生後的 causal settlement。

本輪不重複上述內容，而補兩者中間缺失的一層：**Agent 在數十秒推理期間讀到的 premise 如何被 Runtime 重建、如何判定已 stale，以及 conflict 發生時應整個 abort 還是只修復依賴該 premise 的 reasoning/plan subgraph。**

---

## 本小時新發現

### 新 system architecture：S-Bus / Observable-Read Isolation

S-Bus 把普通 HTTP GET traffic 轉成 server-side DeliveryLog，於 commit 時重建 agent effective read-set；若 agent 曾讀過的其他 shard version 已改變，commit 被拒絕。這把「Agent 看過什麼」從 prompt 內隱資訊提升成 Runtime 可驗證的 concurrency metadata。

原始碼確認：`read_shard()` 在 delivery 時記錄 `(agent_id,key,version)`；`commit_delta()` 將 explicit read_set 與 DeliveryLog 合成 effective read set，逐 shard 比對 current version，若不同且 ORI 開啟則回 CrossShardStale；target shard 自身另用 expected_version 防 lost update。核心檔案：

- `sbus-server/src/bus/engine.rs`
- `sbus-server/src/bus/registry.rs`
- `sbus-server/src/bus/types.rs`
- `sbus-server/src/api/`
- `sbus-server/src/raft/`

### 新 architecture：CoAgent / MTPO

CoAgent 把每個長推理 Agent 視為 long-running transaction，但不採長時間 lock，也不在 conflict 後整個 OCC abort。其 MTPO 固定 serialization rank，讓 writes 可先作用於 live state；當較低 rank 的 write 使較高 rank Agent 的 premise 過期時，Runtime 通知 Agent，由 LLM 判斷 conflict 是否真正 invalidate plan，若有影響只 targeted repair dependent operations。

這提供一個重要分工：**mechanical conflict detection 應由 Runtime 做；semantic relevance / repair scope 可以交給 model，但 repair 後仍需 deterministic invariant / settlement verification。**

### 新 formal taxonomy：stale-generation 不只是 stale read

2026 Verified Detection and Prevention of Concurrency Anomalies 將 shared memory/tool registry 的 long-running read-generate-write 建模，區分 stale-generation、phantom-tool、causal-cascade、tool-effect reordering。關鍵是 Agent 不是 read 後立刻 write，而是：

Read State@v7 → tokens/context → 40s reasoning → generated plan → tool call

所以真正受污染的是整段 derivation，而不只某一個 database read。

### 新 read-set reconstruction：S-Bus 的優勢與邊界

DeliveryLog 能捕捉 HTTP-observable reads，避免要求 Agent SDK 自己正確宣告 read set；但它只能證明 middleware 看得到的 projection。LLM provider 內部 cache、browser screenshot、local file read、MCP server internal read、embedding retrieval 若沒有進同一 observation ledger，仍可能形成 HiddenReadSet。

因此 Hermes 不應直接把 ORI 當 universal serializability，而應建立 ObservableReadSet 與 HiddenReadSetRisk。

### 新底層機制：Read → Premise → Derivation → Plan lineage

若只保存 `(resource,version)`，Runtime 知道 stale，卻不知道應修哪一段 reasoning。Hermes 需要把 read-set 與前幾輪 provenance graph 接起來：

ResourceVersion R@v7
→ Observation O12
→ Premise P9
→ Claim C14
→ PlanStep S3
→ ToolIntent T8

當 R 更新到 v8：

R@v7 STALE
→ traverse descendants
→ 找到最小受污染 derivation cut
→ re-read R@v8
→ regenerate dependent claim/plan only
→ invariant check
→ effect admission

---

# 本小時最重要 5 個發現

## 1. Agent concurrency 的核心單位不是「檔案被改過」，而是 Premise Version

已確認工程事實：S-Bus 的 DeliveryLog 保存 agent 實際取得的 shard version，commit 前比較 current version。

Hermes 擴展模型：

PremiseRef {
  source_resource
  observed_revision
  observation_id
  consumer_claim_ids[]
  consumer_plan_ids[]
}

重要性：Agent 可能沒有再次讀取 resource，但其後 30 秒所有 reasoning 都建立在舊 premise 上。

限制：HTTP-observable read-set 不等於完整 cognitive read-set。

來源：S-Bus paper + `sbus-server/src/bus/engine.rs`。

## 2. Stale-generation 比 stale-read 更適合描述 LLM Agent

底層：

Read(v1)
→ Context Injection
→ Attention / token generation
→ latent/textual reasoning
→ Plan
→ Action

Concurrent Write(v2)
→ v1 premise invalid
→ generated downstream artifacts potentially tainted

重要性：修復不能只重新 GET；必須知道哪些 Claim / Plan / ToolIntent 由 v1 衍生。

限制：black-box model 內部 token-to-premise attribution仍不可靠，所以 Runtime 最實際的是追 observation-to-explicit-claim/plan lineage，而不是假裝知道每個 hidden-state neuron 的因果來源。

## 3. Conflict Detection 與 Semantic Repair 必須分層

Runtime：版本、read-set、write-set、effect identity、dependency edge。

Model：這個變更是否真的影響目標？需要改哪些 reasoning/plan？

Verifier：repair 後 invariant、postcondition、settlement 是否成立？

這比「讓 LLM 自己判斷有沒有 race」安全，也比所有 conflict 都 full abort 更省推理成本。

來源：CoAgent + S-Bus + verified anomaly paper。

## 4. Read-set 有可觀測性邊界

ObservableReadSet = Runtime 確實觀測並記錄的 read。

PotentialHiddenReadSet 包含 browser screenshot、local FS、MCP internal state、LLM-side retrieval/cache、unwrapped shell command 等。

新 invariant：

IsolationClaim(scope) MUST NOT exceed ObservableReadCoverage(scope)

也就是 Hermes UI 不應在只攔到 HTTP reads 時顯示「Serializable」。應顯示 coverage 與 blind spots。

## 5. Targeted Repair 應由 dependency graph 決定候選範圍，再由 LLM 做 semantic pruning

新流程：

ConflictEvent
→ Mechanical Descendant Closure
→ CandidateTaintedSet
→ SemanticRelevanceJudge
→ MinimalRepairSet
→ Re-read / Re-reason / Re-plan
→ Deterministic Verification
→ Effect Gate

LLM 不能自行縮小 mechanical candidate set，否則可能漏修；它只能在 Runtime 已證明的 tainted descendants 中判定哪些仍語義有效。

---

# Architecture Breakdown

Hermes Semantic Isolation Plane：

User Goal
→ Agent Context Compiler
→ Observation Gateway
   → HTTP / MCP / Browser / FS / DB
→ Observation Ledger
   → resource_id
   → revision
   → provenance
   → read_scope
→ Premise Graph
→ Reasoning / Planning
→ Tool Intent
→ Pre-Commit Isolation Gate
   → read-set validation
   → write conflict validation
   → stale-generation detection
→ Targeted Repair Engine
→ Invariant Verifier
→ Effect Commit Gate
→ Settlement Graph

這一層正好接在前序的 Belief/Provenance 與 SettlementVector 中間。

---

# Bottom-Level Logic

S-Bus 原始碼實際路徑：

GET shard
→ `read_shard(key, agent_id)`
→ registry read current version
→ `delivery_log.record(agent_id,key,version)`

COMMIT
→ explicit read_set
→ `build_effective_read_set(agent_id,target,explicit)`
→ for each non-target observed shard
→ registry current version
→ `cur != observed_version`
→ `CrossShardStale`

TARGET WRITE
→ compare `expected_version`
→ optional ownership token
→ apply_delta
→ version increment
→ WAL append

Hermes 應再加：

DeliveryLog
→ ObservationLedger
→ PremiseLineage
→ DerivationTaintPropagation
→ RepairSet

---

# Visual Simulation Idea

## Semantic Isolation & Targeted Repair Microscope

四條同步 timeline：

RESOURCE
R1 v7 ───────────────→ v8 by Agent B

AGENT A
read v7 → context → reason → claim C4 → plan P3 → intent T9

VALIDATION
                         stale-generation detected

REPAIR
R1 v8 → repair C4/P3 only → verify → continue

互動控制：
- inference duration
- Agent count
- resource contention
- hidden-read percentage
- read-set coverage
- conflict notification delay
- semantic judge false-negative rate
- full abort vs targeted repair
- reversible/irreversible effect

即時顯示：
- Observable Read Set
- Hidden Read Risk
- Premise Age
- Tainted Derivation Graph
- Candidate Repair Set
- Semantic Repair Set
- Isolation Coverage
- wasted tokens avoided
- unresolved conflict cut

---

# Code / GitHub

S-Bus: https://github.com/sajjadanwar0/sbus

值得繼續讀：
- `sbus-server/src/bus/engine.rs`：read delivery、effective read-set、ORI validation、version check、WAL、rollback
- `sbus-server/src/bus/registry.rs`：DeliveryLog / shard registry
- `sbus-server/src/bus/types.rs`：CommitRequest / error / config IR
- `sbus-server/src/api/`：HTTP observation boundary
- `sbus-server/src/raft/`：distributed state path
- companion `sbus-formals`：TLA+/TLAPS/Dafny proof

目前未找到可可靠確認的 CoAgent 官方 GitHub artifact，因此本輪不虛構其 repository/file structure；CoAgent 的架構細節以論文資料為準。

---

# Papers

## S-Bus: Automatic Read-Set Reconstruction for Multi-Agent LLM State Coordination
Author: Sajjad Khan
Year: 2026
URL: https://arxiv.org/abs/2605.17076
Code: https://github.com/sajjadanwar0/sbus
Dataset: https://huggingface.co/datasets/sajjadanwar0/sbus-benchmarks
Architecture: HTTP middleware + DeliveryLog + effective read-set + ORI commit validation
Contribution: 無 SDK 修改下重建 HTTP-observable read-set；形式驗證與大量 contention experiments。
Limitation: ORI 僅覆蓋 observable projection；single-shard collaborative writing 等 topology 可能不適合。
Changed: 把「Agent 看過什麼」變成可機械驗證的 concurrency metadata。

## CoAgent: Concurrency Control for Multi-Agent Systems
Authors: Hongtao Lyu, Dingyan Zhang, Mingyu Wu, Xingda Wei, Haibo Chen
Institution: Shanghai Jiao Tong University（paper metadata）
Year: 2026
URL: https://arxiv.org/abs/2606.15376
Architecture: MTPO + rank-filtered reads + conflict notification + LLM targeted repair + reversible tool handling
Contribution: 以 semantic targeted repair 取代 long lock / full OCC restart。
Limitations: semantic relevance judgment 本身具有 model error；opaque/unreversible tools 仍是難點。
Changed: concurrency recovery 從 transaction abort 提升成 plan-level selective repair。

## Verified Detection and Prevention of Concurrency Anomalies in Multi-Agent Large Language Model Systems
Author: Sajjad Khan
Year: 2026
URL: https://arxiv.org/abs/2606.17182
Architecture: TLA+ anomaly specs + verified runtime/detectors
Contribution: stale-generation、phantom-tool、causal-cascade、tool-effect reordering 的 machine-checked hierarchy。
Limitations: deterministic-generation / durable replay modeling assumptions 不涵蓋所有 production nondeterminism。
Changed: 將 multi-agent concurrency anomaly 從經驗問題提升成可形式驗證 correctness levels。

## TOKI: A Bitemporal Operator Algebra for Contradiction Resolution in LLM-Agent Persistent Memory
Author: Ziming Wang
Year: 2026
URL: https://arxiv.org/abs/2606.06240
Architecture: bitemporal memory operators + isolation preconditions + provenance audit row
Contribution: 把 memory contradiction resolution 明確視為 write-time concurrency control。
Limitations: 聚焦 persistent memory，不等同 live external-effect isolation。
Changed: belief/memory conflict 也必須聲明 isolation contract，而非只靠 LLM judge。

---

# Unknown / Open Questions

1. 如何自動捕捉 Browser screenshot、local FS、MCP internal read、shell command 所形成的 HiddenReadSet，而不要求每個 tool 手工宣告？
2. SemanticRelevanceJudge 若誤判「conflict 無關」時，哪種 deterministic invariant 能阻止錯誤 effect commit？
3. 多模態 Agent 的 read-set 是否應擴成 `(source, revision, temporal-window, transform-chain)`，讓 camera/audio evidence 的 stale-generation 也能進同一 isolation model？

---

# 下一輪研究

優先研究 **Multimodal Read-Set / Evidence Isolation**：

Camera frame revision / temporal window
→ VLM observation
→ Premise
→ Belief
→ Plan

當 late frame / newer frame / revised ASR transcript 到達：
→ 是否構成 stale-generation？
→ 如何與 HTTP/DB read-set 合成 Unified Observation Set？

並繼續讀 S-Bus `registry.rs` / `types.rs` / API middleware，確認 DeliveryLog retention、session expiry、explicit+implicit read-set merge 的精確語義；再追 CoAgent 可用 artifact / ToolSmith implementation。

---

# Knowledge Graph 新增 Node / Edge

Nodes:
- ObservableReadSet
- HiddenReadSetRisk
- DeliveryLog
- PremiseVersion
- StaleGeneration
- DerivationTaint
- CandidateTaintedSet
- SemanticRelevanceJudge
- MinimalRepairSet
- ObservableReadCoverage
- IsolationCoverage
- PremiseLineage
- SemanticIsolationPlane

Edges:
- Observation `records_revision` PremiseVersion
- DeliveryLog `reconstructs` ObservableReadSet
- ConcurrentWrite `invalidates` PremiseVersion
- StalePremise `taints` DerivationTaint
- DerivationTaint `propagates_to` Claim/Plan/ToolIntent
- CandidateTaintedSet `constrains` SemanticRelevanceJudge
- SemanticRelevanceJudge `prunes_to` MinimalRepairSet
- MinimalRepairSet `must_pass` InvariantVerifier
- ObservableReadCoverage `bounds` IsolationClaim
- IsolationGate `precedes` EffectCommitGate

---

# 本輪結束判斷

缺哪一層：**Multimodal / Browser / MCP / local-FS 的 unified observation read-set instrumentation。**

哪個節點最淺：`HiddenReadSetRisk → actual HiddenReadSet reconstruction`。

哪個概念仍只是名詞：跨 modality 的 `Unified Observation Isolation`，目前是 Hermes proposal，尚非成熟標準。

哪個系統值得讀原始碼：S-Bus，下一步 `registry.rs`、`types.rs`、API middleware、formal artifacts。

哪篇論文需追引用：CoAgent 2606.15376，尤其後續 targeted repair / semantic isolation work；S-Bus 2605.17076 的 ORI operating envelope 也需持續追。

哪個概念最適合視覺模擬：`Premise Version → Stale Generation → Derivation Taint → Targeted Repair`。

哪個 Agent 架構最值得實作：Hermes 的 **Runtime Mechanical Isolation Gate + Model Semantic Repair + Deterministic Verification** 三層架構，而不是純 LLM coordination。

最終鏈新增：

UI / Camera / Voice / Browser / Tool
→ Observation + Revision
→ Observable Read Set
→ Context / Premise
→ Reasoning
→ Planning
→ Pre-Commit Isolation Validation
→ Stale-Generation Detection
→ Targeted Repair
→ Verification
→ Effect Commit
→ MCP / Provider
→ Settlement Proof
→ Output / Next Action

核心結論：**多 Agent 的 race condition 真正污染的不是一個變數，而是 Agent 已經用舊世界狀態生成出的整段推理與計畫。可靠 Runtime 必須先機械地知道 Agent 實際看過哪些版本，再把 stale premise 沿 provenance/dependency graph 傳播，最後只讓模型在可證明的污染範圍內做 semantic repair；模型負責理解「有沒有影響」，Runtime 負責證明「你看過什麼、什麼已過期、修完後能不能安全改變世界」。**