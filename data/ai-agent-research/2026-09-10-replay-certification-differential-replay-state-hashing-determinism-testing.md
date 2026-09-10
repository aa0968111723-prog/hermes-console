# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-10 12:53 Asia/Taipei

## 本小時新發現

本輪承接上一輪「Event-Sourced Agent State × Log Compaction × Schema Evolution × Replay Compatibility」，不再重複 snapshot / upcaster / compaction，而是專攻下一個缺口：**Replay Certification × Differential Replay × State Hashing × Determinism Testing × Historical Runtime Certification**。

核心問題：

```text
Runtime R4 準備部署
↓
舊歷史仍可 deserialize
↓
不代表 replay semantics 等價
↓
如何在部署前證明：
新 Runtime 對歷史 event / tool result / branch / memory / effect boundary 的解讀仍安全？
```

本輪核心結論：

> **Replay Compatibility 是一個 property；Replay Certification 則是把這個 property 轉成可重複、可量測、可阻擋部署的驗證流程。**

---

# 本小時最重要 5 個發現

## 1. 「Replay 不報 nondeterminism」≠「Agent 最終狀態等價」

**已確認事實 / 官方與工程實作：** Temporal 的 WorkflowReplayer 以既有 Workflow History 重新驅動目前程式碼，若 command/event sequence 不符合 deterministic replay 約束就會失敗。Java SDK 中 `WorkflowReplayer` 的註解直接寫明用途是 backwards compatibility testing；官方學習文件也建議把真實 Event History 放進 replay test，以驗證新版 Workflow code 是否仍與舊 execution histories 相容。

但 Agent Runtime 需要比 Temporal-style command compatibility 再多一層。

Temporal 類檢查主要回答：

```text
History H
+
Current Workflow Code R2
↓
會不會產生不相容的 command sequence？
```

Hermes 還要回答：

```text
Old Runtime R1 replay(H)
vs
New Runtime R2 replay(H)
↓
Agent State 是否等價？
Knowledge Graph 是否等價？
Artifact roots 是否等價？
Memory visibility 是否等價？
Branch winner 是否等價？
Effect boundary 是否等價？
```

因此：

```text
NoReplayException
≠
SemanticStateEquivalent
```

本輪提出 Replay Certification 至少要同時檢查：

```text
Command/Event Compatibility
State Equivalence
Graph Equivalence
Effect Equivalence
Invariant Preservation
```

**為什麼重要：** Agent Runtime 很可能在 command sequence 看似合法時，因 ranking、default value、tool-schema normalization、memory projection 或 branch policy 改變，而悄悄重建出不同世界。

**限制：** 完全 byte-identical state 並不總是必要；某些 cache、timestamp、telemetry 可以不同，因此需要 Canonical State Definition。

Sources:
- https://github.com/temporalio/sdk-java/blob/main/temporal-testing/src/main/java/io/temporal/testing/WorkflowReplayer.java
- https://github.com/temporalio/temporal-learning/blob/main/docs/tutorials/java/background-check/durable-execution.mdx

---

## 2. Replay Certification 的核心不是單一 hash，而是「Canonical State Hash Tree」

**工程推論，建立於 event-sourcing deterministic projection 與 replay verification：** 直接對整個 JSON `SHA256(state)` 雖然能抓 divergence，但很難定位差異，也容易被非語義欄位污染。

Hermes 應改為多層 canonical hashing：

```text
Canonical Agent State
├ Planner State Hash
├ Memory State Hash
├ Knowledge Graph Hash
├ Artifact Root Hash
├ Branch / DAG Hash
├ Effect Watermark Hash
└ Tool Contract State Hash
        ↓
      Merkle Root
```

每個 projection 都先 canonicalize：

```text
Remove volatile telemetry
Normalize map ordering
Normalize floats if policy allows
Resolve stable IDs
Sort unordered sets
Strip wall-clock-only fields
↓
Canonical Serialization
↓
Component Hash
```

最後：

```text
ReplayCertificateRoot =
Hash(
  planner_hash,
  memory_hash,
  kg_hash,
  artifact_hash,
  branch_hash,
  effect_hash
)
```

這樣 R1 / R2 若 divergence：

```text
Root mismatch
↓
Memory hash mismatch
↓
Memory shard M17 mismatch
↓
Event E88321 first divergence
```

比單一 state hash 更適合大型 Agent history。

**新關係：**

```text
State Hash
≠
Replay Proof
```

Hash 只能指出結果不同；Certification 還需要證明輸入歷史、runtime build、schema/upcaster/tool/model contract 都被固定與記錄。

---

## 3. Differential Replay 必須找「第一個語義分歧點」，而不是只比較 final output

**已確認相關系統思路：** deterministic replay / record-and-replay 研究長期使用固定 nondeterministic inputs 重建 execution。2026 的 Distributed Order Recording work 進一步研究如何低成本記錄 ordering，以便重播多執行緒/HPC execution。FoundationDB 則把整個 cluster 放進 single-thread deterministic simulation，用固定 seed 重現 network、machine、disk、clock 等故障。

Hermes 的 Differential Replay 應：

```text
History H
↓
Replay R_old
→ State trace S0,S1,S2...Sn

History H
↓
Replay R_new
→ State trace S0',S1',S2'...Sn'

↓
Locate first k where
CanonicalHash(Sk) != CanonicalHash(Sk')
```

然後分類 divergence：

```text
SCHEMA_DIVERGENCE
CONTROL_FLOW_DIVERGENCE
TOOL_CONTRACT_DIVERGENCE
MODEL_CONTRACT_DIVERGENCE
MEMORY_PROJECTION_DIVERGENCE
BRANCH_POLICY_DIVERGENCE
EFFECT_BOUNDARY_DIVERGENCE
ORDERING_DIVERGENCE
```

這使測試從：

```text
PASS / FAIL
```

升級成：

```text
FAIL
first divergence = E143920
old transition = ToolResult→Continue
new transition = ToolResult→Retry
cause = confidence default changed
blast radius = Memory M33, Branch B12, Artifact A91
```

**為什麼重要：** 百萬 event history 若只看到 final hash mismatch，工程上幾乎不可診斷。

Sources:
- https://arxiv.org/abs/2602.15995
- https://apple.github.io/foundationdb/testing.html
- https://apple.github.io/foundationdb/engineering.html

---

## 4. FoundationDB Simulation 顯示「歷史重播」之外，還需要 seeded world simulation

**已確認官方架構：** FoundationDB Simulation 能在 single-thread process 裡 deterministic 模擬整個 cluster，包含 network、machine、disk、clock 與 failure modes。測試使用 deterministic random generator；失敗時可用同一 seed 重跑。官方文件也明確提醒，多 thread 等外部 nondeterminism 會破壞 reproducibility。

這給 Hermes 一個重要啟發：

```text
Historical Replay
```

只能驗證「曾發生過的 history」。但部署新 Agent Runtime 還要測：

```text
尚未發生但可能發生的 interleaving / failure world
```

因此 Replay Certification 應分兩層：

```text
L1 HISTORICAL CERTIFICATION
→ 對真實 production histories 重播

L2 SEEDED SIMULATION CERTIFICATION
→ 產生 network delay / tool timeout / model straggler / crash / retry / partition
```

Agent-specific deterministic simulation world：

```text
Simulated Clock
Simulated RNG
Simulated MCP
Simulated Browser
Simulated Model Latency
Simulated Tool Error
Simulated GPU Completion
Simulated Network Ordering
Simulated Worker Crash
```

每個 run 保存：

```text
seed
runtime_build
scenario
failure_schedule
result_root_hash
invariants
```

如此才能做到：

```text
seed 428812
↓
100% reproduce
「MCP timeout + branch handoff + late GPU completion」bug
```

這一層非常適合 Hermes Console 未來的 Agent OS 驗證環境。

Sources:
- https://apple.github.io/foundationdb/testing.html
- https://apple.github.io/foundationdb/client-testing.html
- FoundationDB source worth reading: `fdbserver/workloads/`, `fdbrpc/simulator.h`, `flow/DeterministicRandom.h`

---

## 5. Production histories 必須用「分層抽樣 + 風險導向 corpus」，不能只隨機抽 100 條

**合理工程推論，結合 Temporal history replay 與 distributed simulation practice：** 真實 Agent history 具有高度長尾性；最危險的 histories 往往包含版本邊界、多工具、副作用、重試、跨模型、多人/多 Agent 分支與長時間執行。

所以 Certification Corpus 應分：

```text
A. Golden Histories
→ 人工標記的重要 workflow

B. Recent Production Histories
→ 最近版本真實流量

C. Version-Boundary Histories
→ 跨 R1→R2 / schema v2→v3

D. Failure Histories
→ timeout / crash / retry / partition / cancellation

E. Effectful Histories
→ GitHub / Gmail / Drive / external write tools

F. Multimodal Histories
→ image / audio / video / GPU artifact branches

G. Long-Horizon Histories
→ huge context / memory compaction / snapshot restore

H. Fuzzed / Seeded Histories
→ generated failure interleavings
```

部署 Gate 不該只看 pass ratio，而應：

```text
Critical corpus: 100% pass
Effectful corpus: no unsafe divergence
Version-boundary corpus: 100% interpretable
General corpus: threshold + no invariant break
```

這比：

```text
random sample 100 histories
→ 97 pass
→ deploy
```

安全得多。

---

# Architecture Breakdown

本輪把 Hermes Replay Certification System 建模為：

```text
Git Commit / Runtime Candidate
↓
Certification Coordinator
↓
History Corpus Resolver
├ Golden
├ Recent Production
├ Version Boundary
├ Failure
├ Effectful
├ Multimodal
└ Long Horizon
↓
Environment Freezer
├ runtime build
├ event schema registry
├ upcaster chain
├ tool contract registry
├ model contract registry
└ canonicalization policy
↓
Dual Replay Engine
├ Baseline Runtime
└ Candidate Runtime
↓
Determinism Boundary
├ clock
├ RNG
├ tool observations
├ model outputs
├ message order
├ branch winner
└ user interrupts
↓
State Trace Recorder
↓
Canonical State Hasher
↓
Differential Analyzer
├ first divergent event
├ component diff
├ graph diff
├ effect diff
└ invariant diff
↓
Replay Certificate
↓
Deployment Gate
├ PASS
├ PASS_WITH_MIGRATION
├ QUARANTINE_HISTORY
└ BLOCK_DEPLOY
```

再加第二條：

```text
Candidate Runtime
↓
Seeded Agent World Simulator
↓
Fault Schedule
↓
Invariant Checker
↓
Simulation Certificate
```

最終部署必須：

```text
Historical Replay Certificate
+
Seeded Simulation Certificate
+
Schema / Contract Compatibility
+
Effect Safety
→ Release Eligible
```

---

# Bottom-Level Logic

## A. Replay certification pipeline

```text
Select history H
→ Verify event integrity
→ Resolve baseline runtime R_old
→ Resolve candidate runtime R_new
→ Freeze contract versions
→ Load deterministic inputs
→ Replay R_old(H)
→ Replay R_new(H)
→ Emit state trace checkpoints
→ Canonicalize each checkpoint
→ Compute component hashes
→ Compare roots
→ If mismatch: binary-search first divergent event
→ Classify divergence
→ Compute dependency blast radius
→ Run invariants
→ Generate certificate
```

## B. Canonical equivalence

本輪提出：

```text
Equivalent(S1,S2,policy) =
  PlannerEquivalent
∧ MemoryEquivalent
∧ GraphEquivalent
∧ ArtifactRootsEquivalent
∧ BranchEquivalent
∧ EffectBoundaryEquivalent
∧ RequiredInvariantEquivalent
```

非必要：

```text
telemetry timestamp
cache hit counters
trace IDs
wall-clock debug fields
```

必須先透過 policy 移除，不能讓這些值造成 false positive。

## C. First divergence search

若保存 periodic hashes：

```text
E0     hash same
E10k   same
E20k   same
E30k   different
```

則 replay engine 可：

```text
20k..30k
↓ binary search
25k same
27.5k diff
...
↓
first semantic divergence = E27183
```

讓百萬級 history 的診斷成本大幅下降。

## D. Certification result

```text
ReplayCertificate {
  history_set_id
  baseline_runtime
  candidate_runtime
  schema_registry_digest
  upcaster_digest
  tool_contract_digest
  model_contract_digest
  canonicalization_policy
  passed_histories
  failed_histories
  first_divergences[]
  invariant_failures[]
  effect_safety_failures[]
  root_hash
  decision
}
```

---

# Visual Simulation Idea

## Replay Certification & Differential State Lab

畫面左右兩個 runtime：

```text
OLD RUNTIME R3                 NEW RUNTIME R4
      │                              │
E1 ───┼──────────────────────────────┼──
E2 ───┼──────────────────────────────┼──
...
E27182 hash ✓                 hash ✓
E27183 hash A                 hash B
          \                    /
           FIRST DIVERGENCE
```

點 E27183：

```text
Event:
ToolResultObserved v2

R3:
confidence missing
→ Continue

R4:
confidence missing
→ default=0
→ Retry
```

右側顯示 blast radius：

```text
Plan N88      changed
Memory M17    changed
Branch B9     changed
Artifact A31  changed
Effect        unchanged
```

下方顯示 hash tree：

```text
ROOT ✗
├ Planner ✗
├ Memory  ✗
├ KG      ✓
├ Artifact✗
├ Branch  ✗
└ Effect  ✓
```

第二模式：FoundationDB-style Agent Simulation：

```text
SEED 428812

[Tool latency +2s]
[GPU completion reorder]
[MCP worker crash]
[Network partition]
[Late result]
```

按 REPLAY SAME SEED：

```text
same failure schedule
same branch order
same divergence
```

非常適合用來回答：

> 「為什麼新版 Agent 在一般測試正常，但在某個很稀有的 Tool/GPU interleaving 下會壞掉？」

---

# Code / GitHub

## Temporal Java SDK

值得看的核心檔案：

```text
temporal-testing/src/main/java/io/temporal/testing/
├ WorkflowReplayer.java
└ WorkflowHistoryLoader.java

temporal-sdk/src/test/java/io/temporal/internal/testing/
└ WorkflowReplayerTest.java

temporal-sdk/src/test/java/io/temporal/workflow/versionTests/
├ GetVersionTest.java
├ GetVersionOutOfOrderFailTest.java
└ GetVersionInterleavedUpdateReplayTest.java
```

尤其 `GetVersionOutOfOrderFailTest` 與 2026 年 interleaved-update replay 問題值得研究，因為它證明 replay correctness 不只是 API 設計，state-machine event ordering 的細微交錯也會製造實際 replay bug。

## FoundationDB

值得看的目錄：

```text
fdbserver/workloads/
├ Cycle.cpp
├ Rollback.cpp
├ ClogTlog.cpp
├ DataLossRecovery.cpp
└ ConsistencyCheckUrgent.cpp

fdbrpc/
└ simulator.h

flow/
├ DeterministicRandom.h
└ Knobs.cpp

tests/
└ fast / rare / slow / restart ...
```

FoundationDB workoad 原始碼廣泛使用 `deterministicRandom()`，simulation 則透過 simulator abstraction 注入 process / network / failure world，這比單純 unit-test Agent loop 更接近「Agent OS simulation」。

---

# Papers

## 1. Distributed Order Recording Techniques for Efficient Record-and-Replay of Multi-threaded Programs
- Authors: Xiang Fu, Shiman Meng, Weiping Zhang, Luanzheng Guo, Kento Sato, Dong H. Ahn, Ignacio Laguna, Gregory L. Lee, Martin Schulz
- Year: 2026
- URL: https://arxiv.org/abs/2602.15995
- Architecture: Distributed Clock / Distributed Epoch order recording integrated with ReOMP / ReMPI
- Contribution: 減少為 deterministic replay 記錄 ordering 所需的同步成本；論文報告代表性 HPC workload 中相對傳統每次 shared-memory access 同步方案約 2–5× 更有效率
- Limitations: HPC / OpenMP + MPI，並非 LLM Agent runtime；需重新抽象成 Agent nondeterminism/event ordering

## 2. ESAA: Event Sourcing for Autonomous Agents in LLM-Based Software Engineering
- Author: Elzo Brito dos Santos Filho
- Year: 2026
- URL: https://arxiv.org/abs/2602.23193
- Architecture: LLM agent intentions → deterministic orchestrator → append-only activity log → materialized projection → replay verification/hash
- Contribution: 把 event sourcing / deterministic orchestration / replay verification 直接帶入 autonomous software agents
- Dataset / evaluation: 兩個 case studies，包含 multi-agent clinical dashboard workflow
- Limitation: 規模與 production heterogeneity 仍有限，對跨 tool/GPU/MCP external-effect certification 尚不足

## 3. Deterministic Replay: A Survey
- Venue: ACM Computing Surveys
- Year: 2015
- DOI: 10.1145/2790077
- Contribution: deterministic replay taxonomy；整理 log size、record slowdown、replay slowdown、implementation cost、probe effect
- Importance to Hermes: 可作為 Replay Recorder / Determinant Boundary 的 foundational taxonomy

## 4. Deterministic Replay for Transparent Recovery in Component-Oriented Middleware
- Authors: Rob Strom, Chitra Dorai, Thomas Huining Feng, Zheng Wei
- Institution: IBM Research
- Year: 2009
- Venue: ICDCS
- Architecture: component checkpoint + replay；message augmented with virtual time，依 virtual-time order 排程
- Contribution: 在 stateful component network 中建立 transparent deterministic recovery
- Limitation: 不含今日 LLM model sampling、GPU latent/KV、MCP/tool effects

---

# Unknown / Open Questions

## 1. Model output 是否應視為 immutable historical determinant？
如果 replay 時原模型版本已不可取得，應：

```text
Inject historical model output
```

還是允許：

```text
new model regenerate
→ semantic equivalence check
```

目前兩者應分成 `FORENSIC_REPLAY` 與 `MIGRATION_REPLAY`，但 ABI 尚未定義。

## 2. Multimodal state canonicalization 怎麼做？
Image/video latent、float tensor、GPU kernel/version 可能造成 bit-level 差異，但語義結果相同。需要定義：

```text
Bitwise Equality
Numerical Tolerance
Perceptual Equality
Semantic Equality
```

不同 artifact 類型選不同 certification policy。

## 3. Tool / MCP External Effects 怎麼做 differential replay？
不能真的把 email / GitHub write / payment / browser submit 做兩遍。需要：

```text
Historical effect transcript
+
shadow adapter
+
contract verifier
```

而不是 live re-execution。

---

# 下一輪研究

下一個最大缺口：

# **Shadow Execution × Effect Virtualization × Contract Testing × Safe Production Mirroring**

因為 Replay Certification 在 production 最終會遇到：

```text
Candidate Runtime R4
↓
想用真實 workload 驗證
↓
但不能真的再寄 Email / 再寫 GitHub / 再改 Drive
```

下一輪應研究：

```text
Production Event
↓
Primary Runtime
→ real side effects

└→ Shadow Runtime
   → virtualized tools
   → historical observations
   → no external commit
↓
Compare decisions / state / effects-intent
```

並比較 shadow traffic、dark launch、recorded-response virtualization、consumer-driven contract testing、TSS-like mirrored execution，以及 effect sandbox。

---

# Knowledge Graph 新增 Node / Edge

新增 Nodes：

```text
Replay Certification
Historical Runtime Certification
Differential Replay
Canonical State
Canonical State Hash
State Hash Tree
Replay Certificate
First Divergent Event
Semantic Divergence
Certification Corpus
Golden History
Version-Boundary History
Effectful History
Seeded Agent Simulation
Fault Schedule
Simulation Seed
Invariant Checker
Deployment Replay Gate
```

新增 Edges：

```text
Runtime Candidate
→ certified_against
Historical Corpus

Historical Event Log
→ replayed_by
Baseline Runtime

Historical Event Log
→ replayed_by
Candidate Runtime

Replay Output
→ canonicalized_into
Canonical State

Canonical State
→ hashed_as
State Hash Tree

Differential Replay
→ locates
First Divergent Event

First Divergent Event
→ propagates_to
Dependency Blast Radius

Seeded Simulation
→ injects
Fault Schedule

Replay Certificate
→ gates
Deployment
```

新增重要否定關係：

```text
No Replay Exception
≠ Semantic Equivalence

State Hash
≠ Replay Proof

Deserialize Success
≠ Runtime Certification

Historical Replay
≠ Failure-Space Exploration

Random Sample
≠ Risk-Covering Corpus

Bitwise Equality
≠ Multimodal Semantic Equality
```

---

# 本輪結束判定

- **缺哪一層：** Shadow Execution / External Effect Virtualization。
- **哪個節點最淺：** Multimodal Canonical State / perceptual-semantic equivalence。
- **哪個概念仍只是名詞：** Cross-Runtime Replay Certificate ABI、Model Determinant Compatibility Class。
- **哪個系統最值得讀原始碼：** Temporal `WorkflowReplayer` + version replay tests；FoundationDB simulator + deterministic workloads。
- **哪篇論文需追引用：** Deterministic Replay survey、2026 Distributed Order Recording、ESAA。
- **哪個概念最適合視覺模擬：** Replay Certification & Differential State Lab。
- **哪個 Agent 架構最值得實作：**

> **Certified Event-Sourced Agent Runtime = Historical Corpus + Frozen Determinants + Dual Replay + Canonical State Hash Tree + First-Divergence Analyzer + Invariant Checker + Seeded Agent Simulation + Deployment Gate**

最終核心結論：

> **Agent Runtime 真正可以長期升級的關鍵，不是「新版程式可以啟動」，而是每一次部署都能提出證據：新版 Runtime 對舊 Agent 歷史仍能重建相容世界；若不相容，可以精確指出第一個語義分歧 event、受影響的 Memory/Branch/Artifact/Effect 範圍，並在 deployment 之前阻擋破壞性版本。**
