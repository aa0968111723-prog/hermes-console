# 【AI Agent × Multimodal Research Report】

## 時間

2026-09-12 07:51（Asia/Taipei）

## 本輪主題

**Event-Time Semantics × Watermarks × Out-of-Order Multimodal Streams × Asynchronous Modality Clocks × Temporal Join × Late-Event State Repair × Compensating Actions**

本輪承接上一輪的缺口：`Multimodal State Reliability × State Commit / Rollback` 已經處理「觀測可靠嗎、衝突嗎、可不可以 commit」，但仍隱含假設所有證據描述的是同一個 world-state instant。真實 Agent runtime 並不是這樣：camera、audio、tool telemetry、MCP、memory、UI、robot sensor 各自有不同 clock、sampling rate、network latency、buffering 與 processing delay，因此「衝突」很可能只是 temporal misalignment。

本輪核心目標是把 Hermes 的世界狀態從：

```text
Observation
→ Reliability
→ Conflict
→ Commit
→ WorldState V43
```

升級成：

```text
Observation
→ Event-Time Normalization
→ Clock / Latency Model
→ Out-of-Order Buffer
→ Watermark / Completeness Frontier
→ Temporal Join
→ Reliability / Conflict
→ Timeline State Commit
→ Late Event
→ Historical State Repair
→ Forward Recompute / Compensating Action
```

---

# 本小時新發現

## 新系統架構

1. **Event-Time World-State Runtime**：將 Agent runtime 內的 sensor/tool/MCP events 明確拆為 event time、ingest time、processing time、commit time。
2. **Temporal Completeness Frontier**：借鑑 stream-processing watermark，表示「對某個 world-time t，目前已經有多大把握不會再收到更早的重要事件」。
3. **Versioned Timeline State**：World state 不再只有 V42→V43，而是 `State(t, revision)`；同一 event-time window 可因 late event 產生 revision。
4. **Causal State Repair Engine**：晚到事件不直接覆寫 current state，而是定位受影響時間區段、重建 downstream derived state，必要時發出 compensating action。
5. **Asynchronous Modality Clock Runtime**：不同 modality 以自己的 sensor/native rate 更新 latent buffer；planner 讀的是 timestamped per-modality state，不強迫同步刷新。

## 新論文 / 技術方向

- **DAM-VLA: Decoupled Asynchronous Multimodal Vision Language Action model** (2026)：不同 modality 以各自 native rate 更新 latent buffers，再由 action head 持續讀取；直接挑戰 synchronous multimodal clock 假設。
- **Asynchronous Multimodal Diffusion Policy Composition via Latency-Aware Guidance Fusion (LAG-Fusion)** (2026)：不同 modality inference latency 下，延遲 guidance 必須先做 reference-frame rebasing 再融合。
- **The Missing Temporal Link: Temporal Context Routing for Script-Driven Audio-Video Generation** (2026)：即使 audio/video 彼此同步，也可能一起偏離外部 script timeline，說明「跨模態同步」不等於「對外部時間語義對齊」。
- **Multimodal Self-Attention Network with Temporal Alignment for Audio-Visual Emotion Recognition** (2026)：TaRoPE + Cross-Temporal Matching 直接處理 audio/video frame-rate mismatch。
- **Apache Flink 2.3 event-time / watermark / late-data improvements**：2026-06-25 release 強化 watermark alignment，並允許 Process Table Functions 對 late records 做自訂反應，而非一律靜默丟棄。

---

# 本小時最重要 5 個發現

## 1. Multimodal Conflict ≠ Same-Time Conflict

### 概念

上一輪若看到：

```text
Camera: person_A outside
Audio:  person_A speaking in room
Badge:  exit recorded
```

可能被判定為 sensor conflict。

但如果真實 timestamp 是：

```text
Audio chunk:  07:50:08.1–07:50:10.4
Badge event:  07:50:10.8
Camera frame: 07:50:11.2
```

三者其實完全一致：A 先說話，再刷卡，再出門。

### 底層如何運作

Hermes 每個 observation 應至少記：

```text
TemporalObservation
├ event_time_start
├ event_time_end
├ source_clock_id
├ source_sequence
├ ingest_time
├ processing_time
├ observed_latency
├ timestamp_uncertainty
├ modality
├ provenance
└ payload
```

不能只有：

```text
{ modality, payload, timestamp }
```

因為單一 timestamp 無法表示 audio/video interval、sensor clock uncertainty 或 delayed tool event。

### 為什麼重要

若時間語義不先處理，後面的 reliability、Dempster-Shafer fusion、conformal commit gate 都可能對「其實不同時間的資料」做錯誤融合。

### 限制

event_time 本身也可能不可信：source clock drift、server clock skew、client clock manipulation、device sleep/resume 都可能產生錯誤 timestamp。

### 來源與驗證

- Apache Flink 官方把 processing time 與 event time 分開；event time 能在 out-of-order arrival 下維持語義一致性。
- Apache Beam 官方同樣把 element timestamp、processing time、watermark 分離，並把 watermark 視為 stream completeness 的估計。

Sources:
- https://flink.apache.org/2015/12/04/introducing-stream-windows-in-apache-flink/
- https://beam.apache.org/documentation/basics/

**確認程度：官方資訊 + 工程實作。**

---

## 2. Arrival Time ≠ World Time；Agent 需要 Watermark-like「完整度前緣」

### 概念

對 Agent 世界模型而言，最危險的假設之一是：

```text
received later
=
happened later
```

實際上：

```text
Event A happened 10:00:01, arrived 10:00:05
Event B happened 10:00:03, arrived 10:00:03.2
```

如果只按 arrival order，會得到 B→A；world order 實際是 A→B。

### Stream-processing bottom-level mechanism

Flink `WatermarkStrategy` 原始碼清楚拆出：

```text
TimestampAssigner
+
WatermarkGenerator
```

並提供：

```text
forBoundedOutOfOrderness(B)
```

其語義是：看到 timestamp T 後，若設定 out-of-order bound B，可以假設不再期待早於 `T-B` 的資料。Flink 也有 idleness detection，避免沒有事件的 partition 永久拖住 global watermark；以及 watermark alignment，避免快 source 遠超慢 source，導致下游 state 無限制增長。

核心 source files：

```text
flink-core/src/main/java/org/apache/flink/api/common/eventtime/
├ WatermarkStrategy.java
├ WatermarkGenerator.java
├ TimestampAssigner.java
├ BoundedOutOfOrdernessWatermarks.java
├ WatermarkStrategyWithIdleness.java
└ WatermarksWithWatermarkAlignment.java
```

值得特別注意 `WatermarkStrategy.java`：

- `createWatermarkGenerator(...)`
- `createTimestampAssigner(...)`
- `withIdleness(...)`
- `withWatermarkAlignment(...)`
- `forBoundedOutOfOrderness(...)`

### Hermes 對應

提出：

```text
TemporalCompletenessFrontier[source/group]
```

例如：

```text
video watermark = 07:50:11.0
audio watermark = 07:50:10.7
MCP   watermark = 07:50:09.2
```

則 cross-modal join 的安全 frontier 不應超過慢 source：

```text
joined_frontier ≈ min(active source watermarks)
```

若某 source 被判定 idle，才能暫時不讓它卡死整體 frontier。

### 為什麼重要

這提供一個比 `sleep(500ms)` 或「等資料差不多到了」更明確的語義：何時可以暫時認為某段 world-time 足夠完整、可以產生 state revision。

### 限制

Watermark 不是 truth，只是 completeness estimate。Beam 官方直接把 watermark 描述為對「資料大概已完整到哪裡」的估計；late data 仍可能出現。

### 最新工程變化

Apache Flink 2.3.0（2026-06-25）重新設計 watermark alignment backlog behavior，並讓 PTF 對 late records 做自訂處理；這代表 late-data semantics 已從「例外情況」繼續往一等 runtime concern 發展。

Sources:
- https://flink.apache.org/2026/06/25/apache-flink-2.3.0-release-announcement/
- https://flink.apache.org/what-is-flink/flink-applications/
- https://github.com/apache/flink/blob/master/flink-core/src/main/java/org/apache/flink/api/common/eventtime/WatermarkStrategy.java
- https://beam.apache.org/documentation/basics/

**確認程度：官方資訊 + GitHub 原始碼。**

---

## 3. Synchronous Multimodal Clock ≠ Physical Runtime；不同 modality 應保留 native clock

### 概念

DAM-VLA 指出一般 VLA 從 VLM 預訓練繼承「共同 synchronous clock」，但 physical system 內：

```text
Language      ~ episode-level constant
Vision        ~ 10–30 Hz
Depth         ~ 30–60 Hz
Force/Torque  ~ 100–1000 Hz
Control       ~ 50–1000 Hz
```

如果強迫全部同步：

- slow modality 被 oversample；
- fast modality 被 undersample；
- control frequency 被最慢 pipeline 綁住。

DAM-VLA 的關鍵做法是：

```text
Vision ──native rate──→ Vision Latent Buffer ─┐
Language ─────────────→ Language Buffer       ├→ Gated Cross-Attention → Action Head
Fast sensor ─100Hz────→ Sensor Buffer         ┘
```

各 modality 分別更新，action head 隨時讀最新有效 latent，而不是每次等待全部 modality 形成 batch。

論文報告在 7 個 contact-rich real-world manipulation tasks 上，平均成功率 95.2%，對比最強 synchronous baseline 40.95%，並維持 100 Hz reactive control。

### 交叉驗證

LAG-Fusion 從 diffusion-policy 方向得到相同問題：不同 modality 不只有 sampling rate 不同，**inference latency 也不同**。因此較晚到的 guidance 必須先 rebasing 到 current reference frame，才能參與 fusion。

### Hermes 對應

提出：

```text
PerModalityTemporalBuffer
├ modality
├ native_rate
├ last_event_time
├ last_processing_time
├ valid_until
├ interpolation_policy
├ extrapolation_policy
├ clock_model
└ latent_state
```

Planner 在 t 決策時不問：

```text
所有 modality 有沒有同一 frame index？
```

而問：

```text
每個 modality 對 world-time t 的 best available state 是什麼？
其 temporal uncertainty 多大？
```

### 限制

非同步 buffer 解決 timing mismatch，但也引入 stale latent、不同 reference frame 與 representation age 問題。因此每個 latent 必須攜帶 age / validity / rebasing metadata。

Sources:
- DAM-VLA, 2026: https://arxiv.org/abs/2606.12105
- Project: https://intuitive-robots.github.io/DAM-VLA/
- LAG-Fusion, 2026: https://arxiv.org/abs/2607.17257

**確認程度：論文結果；DAM-VLA 官方完整 source repo 本輪未找到，故不把論文架構誤稱為已做 source audit。**

---

## 4. Audio-Video Synchronized ≠ Aligned With External Timeline

### 概念

2026-09-02 的 **The Missing Temporal Link: Temporal Context Routing for Script-Driven Audio-Video Generation** 揭露一個非常適合 Hermes 的時間語義問題：

```text
Video ↔ Audio
可以彼此同步
```

但仍可能：

```text
(Video + Audio) ≠ Script Timeline
```

例如 script 指定：

```text
00:03.2 door opens
00:04.0 line starts
```

生成模型即使 lip-sync 完美，也可能在 00:06 才做這些事。

### 底層機制

Temporal Context Routing (TCR) 把 structured script timing 映射到 audio/video 共用 temporal axis，並把 prompt guidance routing 到對應時間區域。

論文報告 200 個 test scripts 上：

```text
Shot Boundary MAE:
1.11 s → 0.042 s

Dialogue Acc@0.5s:
28.3% → 84.1%
```

### Hermes 對應

Hermes 的時間對齊至少有三層：

```text
Layer 1: intra-modality temporal coherence
Layer 2: cross-modality alignment
Layer 3: external semantic/event timeline alignment
```

因此：

```text
Camera ↔ Audio aligned
```

不代表：

```text
Camera/Audio ↔ MCP event ↔ user instruction timeline aligned
```

### 另一個相關機制

2026 Audio-Visual Emotion Recognition work 提出 TaRoPE：不是讓不同 frame rate 硬共享 token index，而是把 temporal position embedding 改成對實際時間更敏感的 aligned form，再用 Cross-Temporal Matching loss 拉近時間上接近的跨模態 pair。

### 為什麼重要

Hermes 若未來把 video/audio/tool event 一起丟進 Transformer，不能只相信 sequence token position 自然代表物理時間。Token index 與 world-time 是不同概念。

Sources:
- TCR: https://arxiv.org/abs/2609.02367
- TaRoPE/CTM: https://arxiv.org/abs/2603.11095

**確認程度：論文結果；TCR 為非常新的 preprint，需後續等待 code / peer review / replication。**

---

## 5. Late Event ≠ Simple Rollback；需要 Historical Repair + Forward Consequence Analysis

### 概念

假設 Hermes 在 10:00:05 已 commit：

```text
State@10:00:03 r1:
payment_status = FAILED
```

因此 Agent 在 10:00:04 做：

```text
retry_payment()
```

但 10:00:08 才收到 event-time=10:00:02.8 的 late event：

```text
payment provider:
ORIGINAL PAYMENT SUCCEEDED
```

此時不能只把 current state 改成 `SUCCESS`。

因為 world 已經發生：

```text
original payment success
+
retry payment possibly success
```

### 正確 repair chain

```text
Late Event
↓
Locate affected event-time interval
↓
Rebuild historical state
↓
Diff old revision vs repaired revision
↓
Find derived decisions/actions
↓
Classify side effects
├ reversible state derivation
├ idempotent tool action
├ compensatable external action
└ irreversible external action
↓
Recompute / Compensate / Escalate
```

因此需要區分：

```text
STATE ROLLBACK
≠
WORLD ROLLBACK
```

### State representation

提出：

```text
WorldStateRevision
├ world_time
├ revision
├ derived_from_events
├ completeness_frontier
├ assumptions
├ state_hash
├ supersedes
└ commit_time
```

例如：

```text
State(t=10:00:03, r1)
↓ late event
State(t=10:00:03, r2)
```

然後 downstream：

```text
r1 → plan P1 → action A1
r2 → plan P2
```

若 `A1 != P2.expected_action`，就產生：

```text
HistoricalDecisionDivergence
```

進入 repair planner。

### Stream processing 對照

Flink 官方明確支援 late event 更新先前完成的結果；Beam trigger model 也允許 watermark 之後仍為 late data 再 trigger refinement。這證明「結果已輸出」並不必然等於「事件時間上的事實不可再修訂」。

但 Agent 比 stream aggregation 更難，因為它可能已經把結果轉成外部副作用。

### Hermes 新規則

```text
Late Data Correction
≠
External Side-Effect Compensation
```

因此每個 action 必須綁：

```text
ActionRecord
├ causal_state_revision
├ input_event_frontier
├ idempotency_key
├ reversibility_class
├ compensation_handler
└ external_effect_receipt
```

Sources:
- https://flink.apache.org/what-is-flink/flink-applications/
- https://beam.apache.org/documentation/basics/
- https://beam.apache.org/blog/timely-processing/

**確認程度：stream semantics 為官方工程事實；將其擴展成 Agent causal state repair 是本輪工程推論 / architecture proposal。**

---

# Architecture Breakdown

## Event-Time Causal World-State Runtime

```text
Camera / Video / Audio / Depth / UI / Tool / MCP / Memory / External APIs
│
├ event timestamp
├ ingest timestamp
├ processing timestamp
├ source sequence
└ source clock
↓
Temporal Normalizer
├ Clock Offset Estimator
├ Clock Drift Estimator
├ Interval Normalizer
└ Timestamp-Uncertainty Estimator
↓
Per-Source Reorder Buffer
↓
Per-Source Watermark Generator
├ bounded out-of-order
├ learned lateness distribution
├ idle-source detector
└ anomaly guard
↓
Watermark Alignment / Temporal Completeness Frontier
↓
Temporal Join Engine
├ interval overlap
├ nearest temporal neighbor
├ causal-before relation
├ tolerance window
└ reference-frame rebase
↓
Reliability / Conflict Engine
↓
State Update Proposal
↓
Timeline Commit Gate
↓
Versioned World-State Timeline
│
├ State(t1,r1)
├ State(t2,r1)
├ State(t3,r1)
└ ...
↓
Planner / Tool / MCP / External Action
↓
Action Ledger
↓
Late Event Arrives
↓
Historical Repair Engine
├ affected interval discovery
├ state recomputation
├ decision divergence detection
└ side-effect impact analysis
↓
REVISE STATE / COMPENSATE / VERIFY / ESCALATE
```

---

# Bottom-Level Logic

## A. Four clocks must be separated

For every event `e`:

```text
t_event(e)      = world/source time the event represents
t_ingest(e)     = runtime first receives the event
t_process(e)    = operator/model processes it
t_commit(e)     = state revision becomes visible
```

Useful derived quantities:

```text
transport_lag = t_ingest - t_event
queue_lag     = t_process - t_ingest
commit_lag    = t_commit - t_process
end_to_end    = t_commit - t_event
```

A single `timestamp` field destroys this decomposition.

## B. Watermark as bounded epistemic claim

For source s:

```text
W_s(t) = current completeness frontier
```

A simple bounded-out-of-order estimator:

```text
W_s = max_seen_event_time_s - B_s
```

but production Hermes should let `B_s` vary with observed lateness distribution:

```text
B_s(t) = Q_p(lateness | source, regime, network, load)
```

where `Q_p` may be a conservative high quantile.

## C. Cross-source aligned frontier

Naive:

```text
W_join = min_s W_s
```

but idle source should be excluded only after explicit idleness detection.

Flink source explicitly implements idleness because an inactive partition otherwise freezes downstream event-time progress.

## D. Interval-valued multimodal events

Audio/video are often intervals, not instants:

```text
AudioChunk = [t_a0, t_a1]
VideoClip  = [t_v0, t_v1]
```

Temporal relation should use:

```text
BEFORE
AFTER
OVERLAPS
CONTAINS
DURING
NEAR(Δ)
```

rather than exact timestamp equality.

## E. Temporal join uncertainty

Define:

```text
TemporalMatchScore(i,j)
=
exp(-|center_i-center_j| / τ)
× interval_overlap
× clock_confidence
× source_reliability
```

The output is not merely a paired record; it should retain temporal uncertainty.

## F. Late-event repair

Given late event `e_late`:

```text
1. locate earliest affected state time t0
2. identify prior revision chain R_old[t0:now]
3. replay relevant immutable events in event-time order
4. construct R_new[t0:now]
5. compute StateDiff(R_old, R_new)
6. retrieve decisions/actions whose causal_state_revision ∈ changed region
7. classify external consequences
8. apply compensation or escalation
```

This is close to event sourcing + stream replay, but Agent runtime additionally needs action-side causal lineage.

---

# System Architecture Deep Dive: Apache Flink Event-Time Runtime

## Why it matters to Hermes

Flink is not an Agent framework, but it has solved a production problem that Agent runtimes are starting to rediscover: distributed events arrive out of order, partitions progress unevenly, delayed data can revise prior results, and stateful computation must still remain semantically coherent.

## Source-code audit

Official repository: `apache/flink`

Key path:

```text
flink-core/src/main/java/org/apache/flink/api/common/eventtime/
```

`WatermarkStrategy.java` confirms:

- Watermark generation and timestamp assignment are separate interfaces.
- `withIdleness(Duration)` prevents inactive partitions from blocking watermark progress.
- `withWatermarkAlignment(...)` can pause sources/tasks/partitions that are too far ahead of a watermark group.
- `forBoundedOutOfOrderness(Duration)` formalizes an upper bound B where after seeing T, records earlier than `T-B` are no longer expected under the chosen strategy.

This is directly useful for Hermes because modality streams behave like uneven partitions: microphone may be continuous while MCP events are sparse; high-frequency force sensors can run far ahead of slow VLM processing; memory events may be effectively idle for long stretches.

## 2026 Flink 2.3 changes

Flink 2.3.0 release notes (2026-06-25) report:

- redesigned watermark alignment buffering to avoid artificial backlog speed caps;
- PTF late-data reaction instead of silent discard;
- ordered table arguments to provide deterministic temporal order inside partitions.

These are important because they show correctness and throughput are coupled: excessively conservative alignment causes state growth/backlog; excessively aggressive watermarks increase late corrections.

## Hermes adaptation

Do not embed Flink itself into Hermes as the default runtime. Instead extract semantic primitives:

```text
EventTime
Watermark
Idleness
Alignment
LateData
Revision
StateReplay
```

and implement them inside the Agent world-state/event ledger.

---

# Multimodal Architecture Deep Dive: DAM-VLA / Async Native-Rate State

## Paper

**Title:** DAM-VLA: Decoupled Asynchronous Multimodal Vision Language Action model  
**Authors:** Pankhuri Vanjani, Zhuoyue Li, Jakub Suliga, Moritz Reuss, Gianluca Geraci, Xinkai Jiang, Rudolf Lioutikov  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2606.12105  
**Project:** https://intuitive-robots.github.io/DAM-VLA/  
**Code:** official source repo not verified in this round  
**Dataset / Tasks:** seven contact-rich real-world manipulation tasks (paper)  
**Architecture:** per-modality latent buffers refreshed at modality-native rates; action head reads buffers continuously; new high-frequency modalities integrated with gated cross-attention.  
**Contribution:** removes single synchronous multimodal clock bottleneck.  
**Limitations:** physical robotics domain; source-level audit unavailable this round; does not by itself solve event-time correction or late-data replay.

### What changed

Traditional:

```text
wait vision
wait language
wait sensor
→ synchronized batch
→ model
→ action
```

DAM-VLA-like:

```text
vision update ─→ vision buffer ─┐
language once ─→ lang buffer   ├→ action query @ control clock
sensor 100Hz ─→ sensor buffer  ┘
```

For Hermes this implies that state read time and state update time need not coincide.

---

# Paper: Asynchronous Multimodal Diffusion Policy Composition via Latency-Aware Guidance Fusion

**Year:** 2026  
**URL:** https://arxiv.org/abs/2607.17257  
**Architecture:** independent modality-specific diffusion policies; guidance arrives asynchronously; delayed guidance is rebased to a common current action reference before fusion.  
**Contribution:** treats sensing/inference latency as a first-class fusion variable, not merely timestamp metadata.  
**Limitation:** policy diffusion setting; direct generalization to LLM/VLM tool agents is an engineering inference.

### Hermes lesson

```text
Late representation
≠ stale garbage
```

It may be usable if it can be transformed/rebased into the current reference frame and if uncertainty remains acceptable.

---

# Paper: The Missing Temporal Link — Temporal Context Routing

**Title:** The Missing Temporal Link: Temporal Context Routing for Script-Driven Audio-Video Generation  
**Authors:** Yichen Liu, Quanwei Zhang, Haozhe Wang, Donghao Zhou, Xiaojie Li, Yang Shi, Jiaming Liu, Ruihua Huang, Yingtian Zou, Daquan Zhou  
**Year:** 2026  
**Published:** 2026-09-02  
**URL:** https://arxiv.org/abs/2609.02367  
**Architecture:** structured script timeline → shared audio/video temporal axis → temporally routed prompt guidance.  
**Contribution:** identifies that AV synchronization and script timing adherence are different alignment problems.  
**Results:** Shot Boundary MAE 1.11s→0.042s; Dialogue Acc@0.5s 28.3%→84.1% on 200 test scripts, per paper.  
**Limitations:** very recent preprint; code/independent replication not yet established this round.

### Hermes lesson

A multimodal Agent should maintain an external semantic timeline:

```text
user intention timeline
workflow timeline
external transaction timeline
```

not only modality-to-modality timing.

---

# Paper: Multimodal Self-Attention Network with Temporal Alignment

**Authors:** Inyong Koo, yeeun Seong, Minseok Son, Jaehyuk Jang, Changick Kim  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2603.11095  
**Code:** reported repository `quotation2520/AVEmotionRecognition`; full source audit not performed this round.  
**Datasets:** CREMA-D, RAVDESS  
**Architecture:** multimodal self-attention + Temporally-aligned RoPE (TaRoPE) + Cross-Temporal Matching (CTM) loss.  
**Contribution:** directly handles heterogeneous audio/video sampling rates instead of assuming token index equality.  
**Limitation:** emotion-recognition setting; small benchmark scope relative to general-purpose Agent runtime.

---

# Code / GitHub

## 1. apache/flink

**Verified source files:**

```text
flink-core/src/main/java/org/apache/flink/api/common/eventtime/WatermarkStrategy.java
flink-core/src/main/java/org/apache/flink/api/common/eventtime/WatermarkStrategyWithIdleness.java
```

Recommended next files:

```text
BoundedOutOfOrdernessWatermarks.java
WatermarkGenerator.java
WatermarkOutput.java
WatermarksWithWatermarkAlignment.java
WatermarkAlignmentParams.java
```

What to extract into Hermes:

```text
TimestampAssigner abstraction
WatermarkGenerator abstraction
Idleness detection
Alignment groups
Bounded out-of-order semantics
```

Do not copy Flink’s whole runtime; copy the concepts and invariants.

## 2. Apache Beam

Beam documentation confirms its model explicitly separates:

```text
What
Where in event time
When in processing time
How refinements relate
```

and lets late data retrigger refinements after event-time watermark. This is especially relevant to `WorldStateRevision` semantics.

## 3. DAM-VLA

Paper/project architecture verified, but no official source repository was found through GitHub search in this run. A third-party reproduction exists, but it should not be treated as authoritative source for architecture verification.

This is explicitly marked as a source-code gap rather than filling it with guessed files.

---

# Visual Simulation Idea

# **Event-Time World Timeline & State Repair Lab**

## View 1 — Multi-clock stream

```text
WORLD TIME ─────────────────────────────────────────→

VIDEO    ●────●────●────────●────────────●
         10.0 10.1 10.2     10.4         10.6

AUDIO    █████████ █████████ █████████
         9.9-10.2  10.2-10.5 10.5-10.8

MCP                 ▲
 event_time          10.15
 arrival_time                       10.72

MEMORY   ◆ snapshot@9.0
```

User can toggle:

```text
[EVENT TIME]
[ARRIVAL TIME]
[PROCESSING TIME]
[COMMIT TIME]
```

and visually see event order change.

## View 2 — Watermark / completeness frontier

```text
video  ────────────────| W=10.60
audio  ──────────────|   W=10.52
MCP    ──────────|       W=10.20

JOINED FRONTIER = 10.20
```

MCP becomes idle:

```text
MCP [IDLE]
JOINED FRONTIER → 10.52
```

## View 3 — False conflict reclassification

Before temporal alignment:

```text
Camera: OUTSIDE
Audio:  INSIDE SPEECH
STATUS: CONFLICT
```

After interval alignment:

```text
Audio speech      10.1–10.4
Badge exit              10.5
Camera outside              10.6

STATUS: SEQUENTIAL, NOT CONFLICT
```

## View 4 — Late-event repair

```text
Timeline revision 1
10:00 payment failed
10:01 retry
10:02 second charge
```

late event arrives:

```text
event_time=09:59.8
original payment SUCCESS
```

UI animates:

```text
STATE@10:00 r1 → INVALIDATED
STATE@10:00 r2 → SUCCESS

Affected action:
retry_payment()

External effect:
second charge confirmed

Repair options:
[REFUND DUPLICATE]
[VERIFY PROVIDER]
[ESCALATE]
```

This visualization can teach a non-expert the critical distinction between state repair and world repair.

---

# Unknown / Open Questions

## 1. How should Hermes learn dynamic lateness bounds without making watermarks unsafe?

A static `B=2s` is simple but either too conservative or too aggressive across changing networks. A learned quantile model can adapt, but then watermark semantics become probabilistic and drift-sensitive.

Need research:

```text
Conformal lateness bounds
Adaptive quantile watermarks
Distribution shift in event delay
Per-source/regime lateness models
```

## 2. How do we distinguish clock error from genuine causal reversal?

If tool A appears after tool B under timestamps, possibilities include:

```text
A truly happened later
source A clock is skewed
source B timestamp is server-generated
network retransmission
batch timestamping
```

Need `ClockProvenance` and potentially probabilistic temporal order rather than total order.

## 3. How far should historical repair propagate?

Replaying the entire Agent history after every late event is impossible. Need dependency-bounded repair:

```text
late event
→ affected state nodes
→ affected plans
→ affected actions
→ affected external effects
```

This points toward a temporal causal dependency DAG and incremental recomputation.

---

# 下一輪研究

下一輪最重要缺口：

# **Probabilistic Clock Synchronization × Temporal Causal DAG × Incremental State Repair × Compensating Transactions**

研究路徑：

```text
Source Clocks
↓
Offset / Drift Estimation
↓
Probabilistic Temporal Ordering
↓
Temporal Causal DAG
↓
Late Event
↓
Affected-Subgraph Discovery
↓
Incremental Replay
↓
Plan/Action Divergence
↓
Compensating Transaction
↓
Repair Certificate
```

應優先研究：

- Lamport clocks / vector clocks / Hybrid Logical Clocks：它們解決的是 distributed causal/order semantics，不等同 physical event time。
- Spanner TrueTime / bounded clock uncertainty：如何用 interval timestamp 表達「不知道精確時間但知道界線」。
- Temporal databases / bitemporal models：valid time vs transaction time，與 Hermes 的 event time vs commit time 高度相似。
- Incremental computation / differential dataflow：晚到資料如何只重算受影響差分。
- Saga / compensating transaction：世界已發生副作用時，不能 database rollback，只能補償。
- Temporal causal discovery：在 timestamp uncertainty 下學 causal ordering。

---

# Knowledge Graph 新增 Node

```text
Event Time
Ingest Time
Processing Time
Commit Time
World Time
Source Clock
Clock Offset
Clock Drift
Timestamp Uncertainty
Temporal Interval
Event-Time Semantics
Processing-Time Semantics
Out-of-Order Event
Reorder Buffer
Watermark
Per-Source Watermark
Aligned Watermark
Temporal Completeness Frontier
Watermark Lag
Idle Source
Watermark Alignment
Late Event
Allowed Lateness
Temporal Join
Cross-Modal Temporal Join
Temporal Match Score
Reference-Frame Rebase
Asynchronous Modality Buffer
Native Modality Rate
Latent Age
External Semantic Timeline
World-State Timeline
World-State Revision
Historical State Repair
Historical Decision Divergence
Action Causal Lineage
Compensating Action
Repair Scope
State Replay
```

# Knowledge Graph 新增 Edge

```text
Observation HAS_EVENT_TIME EventTime
Observation HAS_INGEST_TIME IngestTime
Observation HAS_PROCESSING_TIME ProcessingTime
StateRevision HAS_COMMIT_TIME CommitTime

SourceClock PRODUCES Timestamp
Timestamp HAS_UNCERTAINTY TimestampUncertainty

Watermark ESTIMATES TemporalCompletenessFrontier
IdleSource MUST_NOT_BLOCK WatermarkProgress
AlignedWatermark COORDINATES MultipleSources

LateEvent INVALIDATES StateRevision
LateEvent TRIGGERS HistoricalStateRepair
HistoricalStateRepair PRODUCES NewStateRevision
NewStateRevision SUPERSEDES OldStateRevision

Action DEPENDS_ON StateRevision
StateRevisionChange MAY_INVALIDATE ActionJustification
InvalidatedAction MAY_REQUIRE CompensatingAction

Modality HAS_NATIVE_RATE SamplingRate
Modality UPDATES PerModalityTemporalBuffer
PerModalityTemporalBuffer FEEDS Planner

TemporalJoin PRECEDES ConflictDetection
TemporalAlignment MAY_RECLASSIFY Conflict AS SequentialConsistency
```

# 重要否定關係

```text
Arrival Time ≠ Event Time
Processing Time ≠ Event Time
Token Position ≠ Physical Time
Same Frame Index ≠ Same World Time
Cross-Modal Synchrony ≠ External-Timeline Alignment
Sensor Disagreement ≠ Same-Time Conflict
Watermark ≠ Proof No Earlier Event Exists
Late Event ≠ Invalid Event
State Rollback ≠ World Rollback
State Correction ≠ Side-Effect Compensation
Synchronous Batch ≠ Correct Multimodal Fusion
Latest Latent ≠ Temporally Fresh Latent
Timestamp ≠ Trustworthy Clock
Total Order ≠ Causal Order
```

---

# 已確認事實 / 推論 / 假說分類

## 已確認官方資訊

- Flink 明確區分 event time / processing time，支援 watermarks、late data、idleness、watermark alignment。
- Flink `WatermarkStrategy.java` 原始碼確認 `TimestampAssigner`、`WatermarkGenerator`、bounded out-of-order、idleness 與 alignment API。
- Flink 2.3.0 在 2026-06-25 release 中改進 watermark alignment 與 late-record handling。
- Beam 明確以 watermark 表達 event-time completeness estimate，並以 triggers 支援 early/on-time/late refinement。

## 論文結果

- DAM-VLA 報告 asynchronous native-rate modality buffers 在 7 個 real-world manipulation tasks 大幅超過 synchronous baseline，並達 100Hz control。
- TCR 報告 script-timeline alignment 大幅改善 shot/dialogue timing。
- TaRoPE/CTM 工作報告顯式 temporal alignment 對 frame-rate mismatch 有效。
- LAG-Fusion 主張 delayed modality guidance 需要 reference-frame rebasing 才能做 asynchronous composition。

## 工程推論

- Watermark semantics 可映射成 Agent `TemporalCompletenessFrontier`。
- Late-data refinement 可映射成 `WorldStateRevision` + dependency-bounded repair。
- Asynchronous modality latent buffer 可成為 Hermes multimodal state ABI。

## 尚未驗證假說

- `Adaptive probabilistic watermark` 是否能在 Agent runtime 同時兼顧低延遲與安全 repair cost。
- 將 conformal bounds 應用到 per-source lateness，能否提供實用 coverage guarantee。
- `HistoricalDecisionDivergence` 能否有效決定何時需要 external compensation。

---

# 本輪收斂回答

## 缺哪一層？

**Probabilistic Clock / Temporal Causality Layer**：目前已知道事件要以 event time 排序，但還沒有解 clock offset、clock drift、uncertain ordering 與 distributed causality。

## 哪個節點最淺？

`HistoricalStateRepair`：目前已有 pipeline 但尚缺 dependency-bounded incremental replay 演算法與 production data model。

## 哪個概念仍只是名詞？

- `TemporalCompletenessCertificate`
- `HistoricalDecisionDivergence`
- `CausalStateRepairCertificate`
- `TemporalState ABI`
- `CompensationSafetyCertificate`

## 哪個系統最值得繼續讀原始碼？

1. **Apache Flink event-time runtime**：`BoundedOutOfOrdernessWatermarks`, `WatermarksWithWatermarkAlignment`, source coordinator watermark alignment。
2. **Apache Beam state/timer implementation**：尤其 watermark + trigger + late pane lifecycle。
3. **DAM-VLA**：官方 code 一旦公開/可定位，應立刻做 native-rate latent-buffer source audit。
4. 下一輪進入 **Hybrid Logical Clock / bitemporal DB / differential dataflow** 原始碼。

## 哪篇論文需追引用？

1. DAM-VLA (2026) — asynchronous multimodal control。
2. LAG-Fusion (2026) — latency-aware asynchronous fusion。
3. TCR (2026-09-02) — external semantic timeline alignment。
4. TaRoPE/CTM (2026) — heterogeneous frame-rate token alignment。

## 哪個概念最適合視覺模擬？

**Event-Time World Timeline & State Repair Lab**：它可以非常直觀地展示「arrival order 和 world order 不同」以及 late event 如何讓歷史 state revision 改寫。

## 哪個 Agent 架構最值得實作？

> **Event-Time Causal Agent Runtime = Temporal Normalizer + Per-Modality Native-Rate Buffer + Reorder Buffer + Watermark/Completeness Frontier + Temporal Join + Reliability/Conflict Engine + Versioned Timeline State + Action Causal Ledger + Late-Event Incremental Repair + Compensating-Action Planner。**

---

# 對「AI 到底怎麼運作」新增的完整鏈條

上一輪：

```text
Camera/Image/Voice/Video
→ Encoder
→ Reliability
→ Conflict
→ State Commit
→ Reasoning
→ Action
```

本輪修正為：

```text
Camera / Image / Voice / Video / Tool / MCP
↓
Source Clock + Event Time
↓
Network / Queue / Inference Latency
↓
Ingest Time
↓
Out-of-Order Buffer
↓
Watermark / Completeness Frontier
↓
Temporal Alignment / Rebase
↓
Encoder / Fusion
↓
Reliability / Conflict
↓
Versioned World-State Timeline
↓
Reasoning / Planning
↓
Tool / MCP / External Action
↓
Action Causal Ledger
↓
Late Event
↓
Historical State Repair
↓
Compensating Action / Replanning
```

最重要的新觀念是：

> **成熟多模態 Agent 不只需要知道「看到什麼」，也必須知道「這件事代表世界中的哪一段時間、目前對那段時間的資料有多完整、如果更晚才收到更早發生的事件，哪些已經形成的世界信念與外部行動需要被修正」。**

這使 Hermes 的 World State 從一般 memory/state store 升級為 **可處理時間不確定性、晚到資料與因果修訂的 event-time world model**。
