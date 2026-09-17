# 【AI Agent × Multimodal Research Report】

**時間：2026-09-17 16:51（Asia/Taipei）**  
**主題：NIXL etcd Watcher Object Liveness × Re-arm Ownership × Freshness Failure × Agent Failure Diagnosis**

## 本小時新發現

本輪延續上一輪 `AsyncWatchAction → Watch failure → freshness`，但把研究焦點上移到 **Watcher object ownership 與 recovery ownership**，並加入 2026-09 最新 Agent failure diagnosis 研究，避免只在 transport/control-plane 層循環。

### 已確認事實

1. NIXL `setupAgentWatcher(agent_name)` 以 `agentWatchers_` map 作為「每 peer 只有一個 watcher」的註冊 gate；只要 key 已存在就直接 return。
2. Watch callback 遇到 `!response.is_ok()` 時只記錄 error 並 return；該 callback path 沒有 erase `agentWatchers_[agent]`、沒有 re-arm、沒有 resnapshot，也沒有 freshness state transition。
3. 正常 DELETE path 則不同：callback 把 agent 放進 `invalidatedAgents_`；`processInvalidatedAgents()` 稍後會 `agentWatchers_.erase(agent)`，再 `invalidateRemoteMD(agent)`。所以「DELETE lifecycle」有 ownership cleanup，但「watch transport failure lifecycle」在目前讀到的程式碼中沒有同等 cleanup。
4. `fetchRemote()` 成功 fetch/load metadata 後才呼叫 `setupAgentWatcher()`；因此 metadata materialization 與 persistent watch establishment 是兩個分離步驟。
5. etcd-cpp-apiv3 官方 README 明確把 watcher reconnect 責任交給 application；範例使用 `Watcher::Wait(...)`，在 stream 結束後建立新的 Watcher。它不是透明自癒 watcher。
6. NIXL build scripts 多處以 `git clone --depth 1` 取得 etcd-cpp-apiv3；這使 dependency provenance/version pin 需要另外驗證，不能假設所有 build 都固定在單一 commit。

### 工程推論（尚需 reproducer）

目前程式碼形成一個高價值 failure candidate：

```text
agentWatchers_[A] = W7
→ W7 stream fails
→ callback logs error + returns
→ map still contains A/W7
→ metadata G7 may remain loaded
→ later setupAgentWatcher(A)
→ map contains A
→ "Watcher already registered"
→ no W8 created
```

這不能僅靠 source inspection 宣稱為 production bug，因為仍需確認 etcd::Watcher failure 後 object state、callback/Wait lifecycle，以及 NIXL 是否有其他未讀路徑移除 watcher；但它已足以定義 deterministic reproducer。

---

## 本小時最重要 5 個發現

### 1. Watcher existence ≠ Watch coverage

`agentWatchers_` 中存在物件只能證明 C++ object 被保存，不能證明 underlying gRPC watch stream 仍覆蓋 metadata history。

```text
WatcherObjectPresent
≠ WatchStreamAlive
≠ RevisionCoverageProven
≠ MetadataFresh
```

這是上一輪 `PersistentWatcherFreshness` 最重要的具體化。

### 2. Normal invalidation 與 transport failure 使用不同 cleanup path

DELETE：

```text
DELETE event
→ invalidatedAgents_.push_back(A)
→ serviceEvents
→ erase watcher A
→ invalidateRemoteMD(A)
```

Watch failure：

```text
!response.is_ok()
→ log
→ return
```

因此 Runtime 必須把「remote agent 被刪除」與「失去觀察 remote agent 的能力」都視為 correctness event；後者不是普通 telemetry error。

### 3. Re-arm 必須帶 revision，而不是只重建 socket

etcd-cpp-apiv3 README 的 reconnect pattern證明 application 必須主動重建 watcher。但對 AI capability control plane，單純 `new Watcher(prefix)` 不夠：若斷線期間可能發生 DELETE/PUT，就需要 LastAppliedRevision / snapshot boundary。

推薦抽象：

```text
WatchFailure(R_last)
→ Freshness UNKNOWN
→ if replay available:
     Watch(R_last + 1)
   else:
     Snapshot @ R_new
     Rebuild Generation
     Watch(R_new + 1)
→ Probe
→ Freshness PROVEN
```

### 4. Dependency reproducibility 是 correctness graph 的一部分

NIXL 多個 build path 使用 `git clone --depth 1` 取得 etcd-cpp-apiv3。若沒有 ref/commit pin，Watcher semantics 或 failure behavior可能隨 dependency HEAD 改變。因此 Knowledge Graph 不應只有 runtime nodes，也要有：

```text
SourceRevision
→ DependencyRevision
→ RuntimeSemantics
→ ReproducerValidity
```

### 5. Agent failure diagnosis 應從「raw trajectory」升級成「behavioral invariants」

2026-09 的 **Diagnosing with Insights: Structured Analysis of Agent Failures via Behavioral Abstractions**（Jiayi Bi et al.）提出 AGENTSCOPE：將長 Agent trajectory 轉為結構化 behavioral representation，並用 neural invariants + LLM-guided reasoning定位 failure step/type；在 Who&When 與新 AgentErrata dataset 上報告優於既有 diagnosis baselines。

對 Hermes 的直接意義：底層 runtime 已經開始建立 `FreshnessInvariant / GenerationInvariant / ToolPermissionInvariant`，這些 invariant 可以與 Agent trajectory 的 Reasoning→Action→Observation graph 合流，而不是分成「LLM debugging」與「distributed systems debugging」兩套完全不同介面。

---

## Architecture Breakdown

### System Architecture：Freshness-aware Watch Ownership

```text
Etcd MVCC
  ↓
Snapshot R100
  ↓
Remote Metadata G8
  ↓
Watcher Registry
  ├─ object identity W8
  ├─ start revision R101
  ├─ stream state
  ├─ last delivered revision
  └─ last applied revision
  ↓
Freshness State Machine
  ├─ FRESH
  ├─ UNKNOWN
  ├─ RESYNCING
  └─ STALE
  ↓
Generation Gate
  ↓
Transfer Probe
  ↓
ServingReady
```

建議 ownership 不再只是：

```text
map<agent, unique_ptr<Watcher>>
```

而在 Hermes Digital Twin 中表示成：

```text
WatchLease {
  peer
  watcher_generation
  snapshot_revision
  start_revision
  last_delivered_revision
  last_applied_revision
  stream_state
  freshness_state
}
```

這是建模建議，不是宣稱 NIXL 已採用此 struct。

---

## Bottom-Level Logic

### Watch failure 到 capability publication 的完整 gate

```text
1. GET metadata
2. obtain SnapshotRevision R
3. deserialize remote metadata
4. materialize RemoteGeneration G
5. establish Watch at R+1
6. receive Watch events
7. update WatchDeliveredRevision
8. enqueue side effect with event revision
9. worker applies side effect
10. update RuntimeAppliedRevision
11. prove coverage: [R+1, RuntimeAppliedRevision]
12. permit G through FreshnessGate
13. transfer probe
14. publish ServingReady
```

Failure：

```text
watch stream error
→ mark WatchLease DEAD
→ Freshness UNKNOWN
→ stop new capability publication
→ retain/revoke existing transfer according to policy
→ remove dead watcher registry entry
→ reconnect etcd
→ replay from LastAppliedRevision+1
→ if compacted: full snapshot
→ establish new WatchGeneration
→ reconcile generations
→ transfer probe
→ ServingReady
```

這裡特別區分：

```text
Model reasoning failure
≠ Agent planning failure
≠ Tool action failure
≠ Runtime freshness failure
≠ Transport failure
```

但它們可以共用同一個 failure graph / invariant diagnosis UI。

---

## Visual Simulation Idea

### Watch Lease + Agent Failure Invariant Simulator

畫面分五條泳道：

```text
Etcd MVCC | R100 snapshot --- R101 DELETE --- R102 PUT
Watcher   | W7 alive ------- X dead ---------------- W8
Runtime   | G7 FRESH -------- UNKNOWN ---- RESYNC --- G8
Agent     | plan → tool → observation → next decision
Invariant | coverage✓ ------- coverage✗ ------------ coverage✓
```

互動控制：

- Kill Watch Stream
- Keep Dead Watcher Object
- Retry `setupAgentWatcher`
- DELETE During Gap
- PUT New Generation
- Compact History
- Replay From Revision
- Full Resnapshot
- Inject Tool Failure
- Inject Wrong Agent Decision

使用者可切換兩種 diagnosis：

```text
Raw Timeline
↕
Behavior / Runtime Invariant Graph
```

這會讓 Hermes Console 首次把 AgentScope 類的 behavioral diagnosis 與 distributed runtime capability correctness 放在同一張圖上。

---

## Code / GitHub

### NIXL

值得繼續讀：

- `src/core/nixl_etcd_metadata_backend.cpp`
  - `setupAgentWatcher`
  - `processInvalidatedAgents`
  - `fetchRemote`
  - `serviceEvents`
- build/dependency paths：
  - `.gitlab/build.sh`
  - `.gitlab/build-rocm.sh`
  - `contrib/Dockerfile*`
  - `.ci/dockerfiles/*`

本輪 source-level 核心：

```text
setupAgentWatcher:
  if map contains agent → return
  callback failure → log + return

DELETE callback:
  enqueue agent

processInvalidatedAgents:
  erase watcher
  invalidateRemoteMD
```

### etcd-cpp-apiv3

值得繼續讀：

- `src/Watcher.cpp`
- `src/v3/AsyncGRPC.cpp`
- Watcher `Wait()` / `Cancelled()` lifecycle
- `tst/RewatchTest.cpp`

官方 README reconnect example 已明確顯示：reconnect policy屬 application responsibility。

---

## Papers

### Diagnosing with Insights: Structured Analysis of Agent Failures via Behavioral Abstractions

- **Authors:** Jiayi Bi, Yanjie Gao, Yuanmin Xie, Liqun Li, Tianyin Xu, Fan Yang, Mao Yang
- **Year:** 2026
- **arXiv:** 2609.02371
- **Architecture:** trajectory → structured behavioral abstraction → neural invariants → LLM-guided diagnosis
- **Dataset:** Who&When + AgentErrata
- **Contribution:** 將長 trajectory failure localization / attribution 從純 LLM judge 轉成 neuro-symbolic diagnosis
- **Limitations:** invariant quality、trajectory instrumentation、failure labels仍會影響診斷；paper 的 AgentScope 名稱也不應與既有 AgentScope framework / AgentSCOPE privacy benchmark混淆。
- **對 Hermes 的改變:** 新增 `InvariantDiagnosisLayer`，讓 runtime invariants 與 reasoning/action trajectory 使用同一 diagnosis graph。

### Belayer: Efficient Fault Tolerance for LLM Agentic RL Training

- **Authors:** Jiecheng Zhou, Qinghao Hu, Peng Sun, Xingcheng Zhang, Weiming Zhang
- **Year:** 2026
- **arXiv:** 2608.14635
- **Architecture:** rollout engine recovery + stateful environment checkpoint/restore + prefix consistency
- **Contribution:** 把 LLM context 與 environment side effects 視為必須共同恢復的一致性狀態；報告 worker recovery 相對 full engine cold start最高 42×，environment recovery 1.5–3.5×。
- **對 Hermes 的改變:** 支持 `ContextGeneration ↔ EnvironmentGeneration` 也應進入 generation/freshness graph，而不只是 GPU metadata。

---

## Unknown / Open Questions

1. **Dead watcher registry:** etcd::Watcher stream failure後，NIXL `agentWatchers_` 是否確實持有一個無法再 deliver event 的 object，且沒有其他 cleanup path？需要 fault-injection reproducer。
2. **Gap severity:** `fetchRemote → loadRemoteMD → setupAgentWatcher(now)` 間的 DELETE 是否可穩定遺失？需要真 etcd + barrier-controlled test。
3. **Unified invariant:** `WatchCoverageInvariant`、`EndpointGenerationInvariant`、`AgentActionInvariant` 是否能共用一個 typed invariant IR，而不是三套 evaluator？

---

## 下一輪研究

下一輪優先：

```text
etcd-cpp-apiv3 RewatchTest
→ Watcher::Wait implementation
→ failed Watcher object lifecycle
→ NIXL agentWatchers_ ownership
→ deterministic network-cut reproducer
→ DELETE-in-gap reproducer
→ revision-aware InvalidationEvent prototype
```

同時開始把 Agent failure diagnosis 接入 Hermes：

```text
Agent trajectory
→ Reasoning/Action Graph
→ Runtime Event Graph
→ Typed Invariants
→ Violation
→ Causal Failure Step
→ Recovery Action
```

---

## Knowledge Graph 新增 Node / Edge

### Nodes

- `WatcherObjectPresent`
- `WatchStreamAlive`
- `WatcherGeneration`
- `WatchLease`
- `WatchCoverageInvariant`
- `DeadWatcherRegistryEntry`
- `RearmOwnership`
- `DependencyRevision`
- `RuntimeSemanticRevision`
- `InvariantDiagnosisLayer`
- `BehavioralAbstraction`
- `NeuralInvariant`
- `ContextEnvironmentGeneration`

### Edges

```text
WatcherObjectPresent -/-> implies -> WatchStreamAlive
WatchStreamAlive -> enables -> RevisionCoverageProof
WatchFailure -> invalidates -> WatchCoverageInvariant
WatchCoverageInvariant -> required_by -> ServingReady
DeadWatcherRegistryEntry -> may_block -> WatcherRearm
DependencyRevision -> determines -> WatcherFailureSemantics
RuntimeEventGraph -> joins -> AgentTrajectoryGraph
TypedInvariant -> detects -> FailureStep
ContextGeneration -> must_match -> EnvironmentGeneration
```

---

## 本輪結束判斷

- **缺哪一層：** watcher failure 的 ownership/re-arm transaction，以及它到 ServingReady revocation 的實際 bridge。
- **哪個節點最淺：** `RearmOwnership`。
- **哪個概念仍只是名詞：** `Unified Typed Invariant IR`。
- **哪個系統最值得讀原始碼：** etcd-cpp-apiv3 `Watcher.cpp` / `RewatchTest.cpp` + NIXL `nixl_etcd_metadata_backend.cpp`。
- **哪篇論文需追引用：** `Diagnosing with Insights`，特別是 Reasoning-Action Graph / neural invariant 的 formalization 與 AgentErrata construction。
- **哪個概念最適合視覺模擬：** Watch Lease + Runtime/Agent Invariant Simulator。
- **哪個 Agent 架構最值得實作：** `Trajectory + Runtime Event Graph + Typed Invariant + Recovery Action` 的可觀測 Agent Runtime，而不是再增加一個只會 ReAct 的 agent loop。

最終主鏈現在擴充為：

```text
User
→ UI
→ Agent Trajectory
→ Context / Reasoning / Planning
→ Tool / MCP / Environment
→ Model
→ KV / Multimodal State
→ Distributed Metadata
→ Snapshot Revision
→ Watch Lease
→ Freshness / Generation Invariants
→ NIXL / UCX / GPU
→ Attention / Logits
→ Output

並行診斷：
Agent Trajectory + Runtime Event Graph
→ Typed Invariants
→ Failure Localization
→ Recovery
```

**本輪核心結論：Runtime 中「有一個 Watcher 物件」與「仍持續知道世界發生什麼」完全不是同一件事。AI Agent 的可靠性需要把 observation channel 本身也當成有 generation、coverage、freshness 與 ownership 的 capability；失去觀察能力時，應像 endpoint failure 一樣撤銷可信度並恢復，而不是只留下一行 error log。**