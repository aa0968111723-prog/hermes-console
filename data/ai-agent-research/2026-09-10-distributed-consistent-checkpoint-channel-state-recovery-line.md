# 【AI Agent × Multimodal Research Report】

時間：2026-09-10 09:55 Asia/Taipei

## 本小時新發現

主題：Distributed Consistent Checkpoint × Channel State × Checkpoint Barrier × Coordinated/Uncoordinated Recovery × Recovery Line × Domino Effect

歷史比較：上一輪已研究單一 Continuation Capsule、KV/Tool state migration、resume cursor 與 exactly-once continuation commit。本輪不再討論單一 worker 如何保存自己，而是研究多元件 Agent Runtime 如何取得一致的全域 checkpoint，以及 crash 後如何選出可安全恢復的 recovery line。

## 本小時最重要 5 個發現

### 1. Local Checkpoint Set ≠ Consistent Global State
【已確認事實】Chandy–Lamport distributed snapshot 的核心不是讓所有 process 在同一 wall-clock 時刻存檔，而是取得一個 consistent global cut；全域狀態包含 process local state 與 communication-channel state。

對 Hermes：
Agent Runtime、LLM Server、MCP Host、GPU Worker、Browser Worker、Artifact Store 各自 checkpoint，若沒有描述正在傳輸中的 ToolResult、TokenChunk、ArtifactRef、CommitAck，這組 checkpoint 可能對應不到任何真實 execution history。

### 2. Checkpoint Barrier 是「前/後歷史」的分界，不只是 save() 觸發器
【官方資訊 / 工程實作】Apache Flink 的 CheckpointBarrier 從 source 傳入拓撲。Operator 收到某 input 的 barrier 後，就知道該 channel 上 barrier 之前屬於 pre-checkpoint、之後屬於 post-checkpoint；收到所有 input barriers 後才能完成 aligned checkpoint。

Hermes 對應：
CheckpointCoordinator → inject barrier(checkpoint_id) → Agent/MCP/GPU/Artifact channels → 每個 runtime component snapshot local state → 記錄或阻擋跨 barrier 的 channel traffic → checkpoint manifest commit。

### 3. Aligned Checkpoint 與 Unaligned Checkpoint 的差異本質是「等待 channel 變乾淨」還是「把 channel buffer 本身納入 checkpoint」
【官方資訊】Flink aligned checkpoint 為 exactly-once 會等待 barrier alignment；unaligned checkpoint 則把 network buffers/channel state 納入 checkpoint，讓 barrier 可越過 backlog，因此在 backpressure 下 checkpoint latency 較不受目前 throughput 影響。

Hermes 推論：
- Aligned：適合 Tool/MCP channel 可快速 drain 的情境，snapshot 較乾淨。
- Unaligned：適合大量 token stream、video frame、artifact transfer、GPU pipeline backlog；需保存 in-flight envelope 與 replay cursor。

### 4. Exactly-Once State ≠ Exactly-Once External Effect
【官方資訊】Flink 明確區分 operator state exactly-once 與 end-to-end exactly-once；若要讓 source→sink 的外部結果也 exactly-once，source 必須 replayable，sink 必須 transactional 或 idempotent。

Hermes 對應：
Agent internal checkpoint correctness 並不能保證 Email/MCP write/DB mutation/payment-like side effect 不重複。外部工具仍需 EffectJournal、idempotency key、transaction/fencing 或 reconciliation。

### 5. Recovery Line 是跨元件「最大一致 checkpoint 集」，不是每個元件各自取最新 checkpoint
【已確認研究方向 + 工程建模】早期 distributed recovery 研究以 checkpoint + message logging 恢復 consistent global state；uncoordinated checkpointing 若任意選各 process 最新 checkpoint，可能因跨 checkpoint message dependency 被迫逐步回滾，產生 domino effect。

Hermes RecoveryLine 應為：
RecoveryLine = max consistent set { checkpoint_i(component) }
subject to message/effect causality constraints.

例：
Agent@14 已把 ToolCall#71 記成 sent；MCP@11 尚未收到；若直接拼 Agent@14 + MCP@11，恢復後 ToolCall#71 可能遺失或重送語義不明。需選 Agent@12 或同時恢復 channel/message log。

## Architecture Breakdown

User/UI
↓
Agent Execution DAG
↓
Distributed Runtime Components
├ Agent Runtime
├ LLM / GPU Runtime
├ MCP Host
├ Tool Worker
├ Browser/Sandbox
├ Artifact Store
└ Replay/Event Store
↓
Checkpoint Coordinator
↓
Checkpoint Barrier(checkpoint_id, epoch)
↓
Per-Component Snapshot
├ local state
├ continuation cursor
├ capability/task generation
├ model/KV/multimodal state refs
└ effect journal watermark
↓
Channel-State Capture
├ ToolCall envelope
├ ToolResult envelope
├ token/output chunks
├ artifact transfer
├ ack/commit messages
└ retry metadata
↓
Checkpoint Manifest
↓
Consistency Validator
↓
Durable Global Checkpoint
↓ crash
Recovery Planner
↓
Recovery Line
↓
Restore Local States
↓
Replay Channel State / Message Log
↓
Effect Reconciliation
↓
Resume

## Bottom-Level Logic

### Consistent-cut rule
若 event `receive(m)` 被 global snapshot 包含，則 causally earlier `send(m)` 也必須被 snapshot history 解釋；否則是 orphan receive。

### Barrier-aligned model
channel_i:
pre-checkpoint messages → BARRIER(k) → post-checkpoint messages

operator 在所有 input 看到 BARRIER(k) 前：
1. 已看到 barrier 的 input 暫停/隔離 post-k input；
2. 其他 input 繼續處理 pre-k messages；
3. 所有 barrier 到齊後 snapshot state；
4. barrier 往 downstream 傳。

### Unaligned model
不等待 backlog drain：
1. snapshot operator state；
2. 把尚未消化的 channel buffers 一起保存；
3. recovery 時先恢復 state + channel state；
4. 再繼續 downstream execution。

### Hermes CheckpointManifest
checkpoint_id
checkpoint_epoch
component_snapshots[]
channel_snapshots[]
effect_watermark
artifact_root
branch_heads[]
capability_epoch
schema_version
integrity_hash

### Recovery safety predicate
Recoverable(G) =
  LocalSnapshotsValid(G)
∧ ChannelStateComplete(G)
∧ CausalityConsistent(G)
∧ EffectWatermarkReconcilable(G)
∧ ArtifactRootsAvailable(G)
∧ CapabilityEpochValid(G)

## Visual Simulation Idea

### Distributed Agent Checkpoint & Recovery-Line Lab

左側顯示 5 條 process timeline：
Agent | LLM | MCP | GPU | Artifact Store

中間用箭頭畫：
ToolCall → ToolResult → TokenChunk → ArtifactAck。

使用者可按：
TRIGGER CHECKPOINT
ADD BACKPRESSURE
CRASH MCP
DROP ACK
DELAY TOOL RESULT
ENABLE ALIGNED
ENABLE UNALIGNED
ENABLE MESSAGE LOG

模擬器即時畫出 barrier，并標出 channel state。

錯誤示範：
Agent checkpoint = C14
MCP checkpoint = C11
GPU checkpoint = C13
→ CONSISTENCY FAIL：orphan receive / lost send / duplicated effect risk

正確 recovery line：
Agent C12 + MCP C11 + GPU C13 + channel-log segment L11-13
→ CONSISTENT

比較面板：
Aligned checkpoint：checkpoint size ↓ / barrier wait ↑
Unaligned checkpoint：barrier wait ↓ / channel-state size ↑
Uncoordinated：runtime pause ↓ / recovery search & domino risk ↑
Coordinated：checkpoint coordination ↑ / recovery simplicity ↑

## Code / GitHub

值得繼續讀：Apache Flink
- `org.apache.flink.runtime.io.network.api.CheckpointBarrier`
- checkpoint coordinator/runtime checkpoint packages
- channel state / unaligned checkpoint implementation
- operator state backend snapshot path

本輪最值得抽取的工程模式：barrier-based consistent cut + channel-state capture，而不是照搬 stream processor UI。

Hermes 應實作的核心模組：
- `CheckpointCoordinator`
- `BarrierRouter`
- `ComponentSnapshotAdapter`
- `ChannelStateRecorder`
- `CheckpointManifestStore`
- `RecoveryLinePlanner`
- `EffectReconciler`

## Papers / Reports

1. Distributed Snapshots: Determining Global States of Distributed Systems — K. Mani Chandy, Leslie Lamport — ACM TOCS — 1985.
Architecture：marker-based distributed snapshot。
Contribution：在不停止整個 distributed computation 的情況下取得 consistent global state，包含 channel state。
Limitations：假設可靠 FIFO channels 等經典模型條件；現代 heterogeneous Agent runtime 需映射到 RPC/event log/stream semantics。

2. Restoring Consistent Global States of Distributed Computations — Arthur P. Goldberg, Ajei Gopal, Andy Lowry, Rob Strom — IBM Research — 1991.
Architecture：occasional checkpoints + message logs。
Contribution：可恢復 consistent global state，並支援 rollback/replay。
Limitations：不是針對 GPU state、LLM token stream、MCP effects；需增加 artifact/effect semantics。

3. Apache Flink Fault-Tolerance / Checkpointing architecture — Apache Flink official documentation / source.
Contribution：production-grade checkpoint barrier、aligned/unaligned checkpoint、operator state exactly-once。
Limitations：stream topology 比 Agent dynamic execution DAG 更規則；Tool side effects 仍需 transactional/idempotent sink semantics。

## Unknown / Open Questions

1. Agent DAG 動態生成新 branch 時，checkpoint barrier 是否應 freeze graph epoch，還是允許 checkpoint 中途納入新 node？
2. GPU continuous decode / video diffusion 的 in-flight kernel state，應記錄成 channel state、component local state，還是只保存可重算 continuation cursor？
3. ToolCall 已送出但沒有 ack 的 `DISPATCHED_UNKNOWN` 狀態，如何與 global checkpoint 的 effect watermark 一起做 recovery-time reconciliation？

## 下一輪研究

下一輪優先：Message Logging × Deterministic Replay × Orphan Process × Pessimistic/Optimistic/Causal Logging × External Effect Replay Boundary。

研究鏈：
Checkpoint
→ Message/Event Log
→ Determinants
→ Replay Order
→ Orphan Avoidance
→ Effect Boundary
→ Deterministic / Nondeterministic Agent Replay

需要比較 event sourcing、pessimistic message logging、optimistic logging、causal logging，以及 Temporal/Ray/Flink/Kafka 類 replay semantics。

## Knowledge Graph 新增 Node / Edge

Nodes：
- Global Checkpoint
- Consistent Global Cut
- Checkpoint Barrier
- Barrier Alignment
- Unaligned Checkpoint
- Channel State
- In-Flight Message
- Checkpoint Manifest
- Recovery Line
- Domino Effect
- Orphan Receive
- Message Logging
- Effect Watermark
- Global Checkpoint Coordinator

Edges：
- Checkpoint Barrier → separates → Pre/Post Checkpoint History
- Consistent Global Cut → contains → Local State
- Consistent Global Cut → contains → Channel State
- Unaligned Checkpoint → captures → Buffered In-Flight Data
- Recovery Line → selects → Consistent Checkpoint Set
- Message Logging → reduces → Rollback Distance
- External Effect → constrained_by → Effect Watermark

Important negative relations：
- Local Checkpoint Set ≠ Consistent Global State
- Latest Checkpoint Per Component ≠ Safe Recovery Line
- Operator Exactly-Once ≠ External Exactly-Once Effect
- Component State ≠ Complete Distributed State
- Process Snapshot ≠ Channel Snapshot

## 本輪收斂

缺哪一層：Message/Event Logging 與 deterministic replay boundary。
哪個節點最淺：Effect Watermark × DISPATCHED_UNKNOWN reconciliation。
哪個概念仍只是名詞：Unified Agent Global Checkpoint ABI。
哪個系統值得讀原始碼：Apache Flink checkpoint barrier / channel-state / unaligned-checkpoint implementation。
哪篇論文需追引用：Chandy–Lamport 1985，以及後續 message-logging / rollback-recovery survey 系列。
哪個概念最適合視覺模擬：Distributed Agent Checkpoint & Recovery-Line Lab。
哪個 Agent 架構最值得實作：Barrier-Coordinated Distributed Agent Runtime = Component Snapshot + Channel-State Capture + Global Manifest + Recovery-Line Planner + Effect Reconciliation。

核心結論：成熟的 Agent Runtime 不能把「每個服務都有 checkpoint」誤認成「整個 AI 世界可恢復」。真正可恢復的狀態必須是一個 causally consistent global cut：除了 Agent、LLM、GPU、MCP、Artifact Store 各自的 local state，還要能解釋 barrier 當下正在 channel 中飛行的 ToolCall、ToolResult、Token、Artifact 與 commit/ack；否則 crash 後拼出的世界可能從未真正存在過。