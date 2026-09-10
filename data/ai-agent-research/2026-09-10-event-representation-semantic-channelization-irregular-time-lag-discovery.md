# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-10 22:51 Asia/Taipei

## 本輪主題
**Event Representation × Semantic Channelization × Multimodal State-Space Compression × Irregular-Time Lag Discovery**

本輪承接上一輪 `Online Influence Estimation × System Identification × Dynamic Gain Matrix G_t`。上一輪已經回答「如何從 runtime trace 估計 influence」，但留下更底層的空缺：**原始 Agent trace 到底要怎麼轉成穩定、可比較、可做時序因果分析的 state channels？**

歷史研究已涵蓋 multimodal event sourcing、artifact identity、cross-modal entity resolution、feedback stability 與 online influence estimation，因此本輪刻意不重做事件儲存或 influence estimator，而專注在兩者中間缺失的 representation layer：

```text
Raw Runtime Events
↓
Universal Event Envelope
↓
Temporal Normalization
↓
Semantic Channelization
↓
State Projection / Compression
↓
Irregular-Time Representation
↓
Lag Discovery
↓
Dynamic Gain Matrix G_t
```

---

# 本小時新發現

## 新架構：OpenTelemetry-style Runtime Event Plane
OpenTelemetry 將 telemetry 分成 traces、metrics、logs/events，並以 semantic conventions 統一跨系統屬性。對 Hermes 最重要的是 Event 語義：event 是具有意義的 point-in-time occurrence；長時間操作則應用 span 表示。Event 還同時區分 `Timestamp`（事情真正發生的時間）與 `ObservedTimestamp`（SDK/Collector 看見或收到事件的時間）。

這提供 Agent Runtime 一個重要底座：**Agent semantic time 不應只存一個 timestamp。**

## 新 bottom-level mechanism：Continuous-Time State Encoding
Neural Controlled Differential Equations（Neural CDE）直接針對 irregularly sampled、partially observed multivariate time series。它不強迫所有資料先塞進固定 100 ms / 1 s time bins，而是先由離散 observation 建 continuous control path `X(t)`，再用：

`dz(t) = f(t,z(t)) dX(t)`

讓 hidden state 隨 irregular observation 持續更新。

這非常適合 Agent Runtime，因為 token、MCP result、browser event、camera frame、audio、GPU telemetry 本來就不是同頻率。

## 新 lag discovery：Irregular-time PCMCI+ extension
2026 的 `Causal Discovery on Irregular Time Series` 把標準固定離散 lag 改成 predefined temporal windows，在 irregular event stream 上聚合 causal influence。這代表 Hermes 不應只問：

`event j 是否在 event i 前 3 steps？`

而應問：

`source event 在 target 前 0–100 ms / 100–500 ms / 0.5–2 s 的哪個真實時間窗內具有條件依賴？`

## 新 event type：Interval-Based Events
AAAI 2026 的 Niagara 工作指出，很多 event 不只是單一 timestamp，而是具有 duration，且因果作用可能取決於「某事件是否仍持續中」。因此 Hermes 的 representation 最終不能只有 Point Event；至少需要：

- Point Event
- Duration Operation / Span
- Semantic Interval State

## 新 multimodal 時間觀念：Synchronization ≠ Shared Semantic Timeline
2026 `The Missing Temporal Link` 顯示，audio 與 video 可能彼此同步，卻同時偏離 script 所要求的 semantic timeline。其 Temporal Context Routing（TCR）把 script timing 映射到共享 audio-video temporal axis。對 Hermes 的重要啟示是：**兩個 modality 看起來同步，不代表它們與 Agent action / tool state / task semantics 對齊。**

---

# 本小時最重要 5 個發現

## 1. Agent Event 必須同時保存 Occurrence Time 與 Observation Time

### 概念
一個 ToolResult 可能 10:00:00.100 在遠端完成，但 10:00:01.400 才被 Agent Runtime 收到。如果只存後者，因果分析會把 1.3 秒 transport/queue delay 誤當成 Tool 本身的 effect lag。

### 底層如何運作

```text
External World
↓
Event actually occurs
occurrence_time = t_e
↓
Network / queue / scheduler
↓
Runtime receives event
observed_time = t_o
↓
Agent consumes event
consumed_time = t_c
```

因此 Hermes 建議最少保存：

```text
TemporalStamp
├ occurrence_time
├ observed_time
├ consumed_time?
├ monotonic_time?
├ sequence_no
├ trace_id
├ span_id
└ parent_event_id
```

可以推導：

```text
transport_delay = observed_time - occurrence_time
agent_queue_delay = consumed_time - observed_time
```

### 為什麼重要
上一輪要估 `G_t` 與 lag。如果 timestamp 本身錯，Transfer Entropy、PCMCI、Granger-style estimator 都可能量到 queueing artifact，而非 semantic influence。

### 限制
跨機器時鐘可能有 skew；真正 distributed ordering 還需 monotonic clock、trace parent、logical ordering 或 clock-correction metadata。

### 證據層級
- 官方資訊：OpenTelemetry Event conventions 明確區分 Timestamp 與 ObservedTimestamp。
- 工程推論：Hermes 再增加 consumed/monotonic time 以分離 runtime scheduling delay。

---

## 2. Point Event、Span、Interval State 是三種不同的時間物件

### 是什麼
OpenTelemetry 建議：有 duration 與明確 operation boundary 的工作使用 Span；point-in-time checkpoint/state change 使用 Event。Niagara 則指出，某些 domain causal semantics 必須直接建模 interval-based events。

### Hermes 建模

```text
POINT
ToolResultArrived @ 10:00:01.4
MemoryWriteCommitted @ 10:00:01.7

SPAN
LLMCall [10:00:00.0, 10:00:01.2]
BrowserNavigation [10:00:02.0, 10:00:05.4]

INTERVAL STATE
BrowserAuthenticated [10:00, 10:30]
RateLimitActive [10:02, 10:03]
ObjectVisible [frame 881, frame 954]
AgentLeaseValid [t1, t2]
```

### 為什麼重要
例如 `RateLimitActive` 對 ToolCall 的影響不是「rate-limit-start event 距離 tool call 幾 steps」，而是 ToolCall 發生時是否落在 interval 內。

### 限制
Interval start/end 有時本身是 uncertainty estimate，尤其 Camera/VLM 的 `ObjectVisible`。

### 關鍵否定

```text
Event Timestamp ≠ Operation Duration
Span ≠ Persistent Semantic State
Point Event ≠ Interval Event
```

---

## 3. Multimodal Agent Runtime 本質上是 irregular multi-rate system

### 是什麼
不同訊號頻率可能差數個數量級：

```text
Audio samples        ~kHz–tens of kHz
Camera frames        ~10–60 Hz
Token decode         ms–100 ms scale
GPU telemetry        ms–seconds
Tool/MCP response    irregular 10 ms–minutes
Human input          seconds–hours
Memory consolidation event-driven
```

若全部 naive resample 成固定 time grid：

```text
Raw streams
→ every 100 ms bucket
→ fill-forward / zero-fill
```

可能創造假的 simultaneous event、抹掉真正 lag、或把 missingness 當零值。

### Neural CDE 底層
Neural CDE 對離散觀察建立 interpolation path：

```text
{(t0,x0),(t1,x1),...}
↓
Interpolation
├ Hermite cubic
├ Linear
└ Rectilinear
↓
Continuous control X(t)
↓
Hidden dynamics

dz/dt = f(t,z) dX/dt
↓
latent state z(t)
```

`torchcde` 原始工程還提供 rectilinear interpolation 處理 online / multivariate missing-data 情境，並可用 log-ODE/logsignature windows 以「增加 channels」換取「縮短 sequence length」。

### Hermes 意義
這提供一種 State-Space Compression：

```text
10000 heterogeneous events
↓
continuous hidden trajectory z(t)
↓
query z(t*) when planner/tool/risk estimator needs state
```

### 限制
- latent state 不具天然可解釋性
- solver 成本
- interpolation policy 會改變 dynamics
- 若直接把所有 semantic channels embed 成 dense vector，model/version drift 會破壞長期比較

因此 Hermes 應採 hybrid state：typed sparse state + optional dense latent。

---

## 4. Lag Discovery 應基於真實時間窗，不應只基於 Event Index

### 問題
若序列為：

```text
E1 @ 0 ms
E2 @ 5 ms
E3 @ 5000 ms
E4 @ 5002 ms
```

那麼 `lag=1 event` 同時可能代表 5 ms 或 5 s，語義完全不同。

### 標準 PCMCI+
PCMCI+ 用 lagged variables 與 optimized conditioning sets 研究 autocorrelated time series 中的 lagged + contemporaneous causal links。

### 2026 irregular extension
新的 irregular-time 工作改成 temporal-window aggregation：

```text
Target event Y @ t

Window W1: t-100ms ... t
Window W2: t-500ms ... t-100ms
Window W3: t-2s ... t-500ms

↓
Aggregate source influence per temporal window
↓
Conditional independence testing
↓
Candidate causal lag window
```

### Hermes 意義
對 Agent Tool loop：

```text
ToolResult
→ Planner change
```

可以估：

```text
0–100 ms       immediate parser/router influence
100–500 ms     model/context build influence
0.5–3 s        LLM reasoning/inference response
3–30 s         child-agent/tool orchestration
```

而不是只用「前 1/2/3 個 event」。

### 限制
window boundaries 本身是 hyperparameter；過粗會 merge 因果，過細則樣本不足。

---

## 5. Semantic Channel 必須是分層、版本化、帶 provenance 的，不能只是 embedding dimension

### 問題
Raw trace 可能包括：

```text
text token
agent message
MCP JSON
memory mutation
image frame
ASR transcript
video segment
GPU HBM pressure
browser DOM mutation
```

若直接做：

```text
all events → embedding → vector[1536]
```

三個問題會立刻出現：

1. embedding dimension 沒有 stable semantic identity；
2. encoder/model upgrade 後座標系改變；
3. target/command/effect/observation 等不同角色會被混在一起。

### 建議 Semantic Channel hierarchy

```text
RuntimeChannel
├ USER
│  ├ intent
│  └ clarification
├ MODEL
│  ├ generation
│  ├ uncertainty
│  └ token_usage
├ AGENT
│  ├ plan
│  ├ delegation
│  └ message
├ TOOL
│  ├ intent
│  ├ arguments
│  ├ execution
│  ├ effect
│  └ observation
├ MEMORY
│  ├ read
│  ├ write
│  └ consolidation
├ MULTIMODAL
│  ├ visual_entity
│  ├ audio_entity
│  ├ speech
│  ├ spatial_relation
│  └ temporal_relation
└ INFRA
   ├ gpu_pressure
   ├ kv_cache
   ├ queue
   └ network
```

每個 channel 再帶：

```text
schema_version
encoder_version?
provenance
entity_refs[]
evidence_root_ids[]
missingness
confidence
```

### 為什麼重要
這樣上一輪的 `G_t[i,j]` 才是：

```text
Tool.Observation → Agent.Plan
Memory.Write → Agent.Plan
GPU.Queue → Model.Latency
Visual.Entity → Tool.Target
```

而不是無法解釋的：

```text
dimension_481 → dimension_1022
```

---

# Architecture Breakdown

## System Architecture：Hermes Unified Temporal State Plane

```text
UI / User Text
Camera / Image / Video
Voice / Audio
LLM Runtime
Agent Runtime
Tool / MCP
Memory / RAG / KG
Browser / Computer
GPU / Queue / Network
↓
Ingestion Adapters
↓
Universal Event Envelope
├ identity
├ trace ancestry
├ semantic type
├ modality
├ source
├ occurrence_time
├ observed_time
├ interval?
├ payload/artifact ref
├ provenance
├ confidence
└ schema version
↓
Temporal Normalizer
├ clock-domain mapper
├ occurrence/observed separation
├ monotonic ordering
├ duplicate/retry marking
└ missingness mask
↓
Semantic Channelizer
├ USER
├ MODEL
├ AGENT
├ TOOL
├ MEMORY
├ MULTIMODAL
└ INFRA
↓
Hybrid State Projector
├ Typed Sparse State
├ Entity/Relation Graph
├ Dense Feature State
└ Provenance Mask
↓
Irregular-Time Encoder
├ event windows
├ interpolation
├ Neural CDE
└ logsignature compression
↓
Lag Discovery
├ fixed lag only for regular channels
├ temporal-window PCMCI+
├ interval overlap model
└ conditional independence tests
↓
Dynamic Influence Estimator
↓
G_t
↓
Stability / Risk / Causal Controller
```

## 與 OpenTelemetry Collector 的架構對照
OpenTelemetry Collector 的 Service 建 pipeline graph，典型 telemetry pipeline 是：

```text
Receiver
→ Processor(s)
→ Exporter
```

Hermes 可借用的不是「照搬 observability product」，而是 componentized ingestion pipeline：

```text
OTel Receiver      → Hermes Modality/Runtime Adapter
OTel Processor     → Temporal Normalizer / Channelizer
OTel Exporter      → Event Store / KG / State Estimator
OTel PipelineGraph → Hermes Unified Trace Plane
```

需要特別注意：OpenTelemetry 的目的是 telemetry interoperability；Hermes 的目標還包含 causal/state semantics，因此必須增加 interval state、entity identity、evidence lineage、belief/memory semantics 與 causal channel schema。

---

# Bottom-Level Logic

## Universal Event Envelope

```text
AgentEventEnvelope
├ event_id
├ event_type
├ semantic_channel
├ modality
├ source_component
├ trace_id
├ span_id
├ parent_span_id
├ parent_event_ids[]
├ occurrence_time
├ observed_time
├ consumed_time?
├ interval_start?
├ interval_end?
├ sequence_no
├ payload_ref
├ payload_hash
├ artifact_ref?
├ entity_refs[]
├ evidence_root_ids[]
├ confidence?
├ missingness_mask?
├ schema_version
├ encoder_version?
└ provenance
```

## 從 Raw Event 到 G_t 的完整流程

```text
Raw event
→ Parse
→ Identity assignment
→ Trace/parent linkage
→ Timestamp normalization
→ Point/Span/Interval classification
→ Semantic role/channel classification
→ Payload normalization
→ Entity resolution
→ Evidence root attachment
→ Typed sparse projection
→ Optional dense encoding
→ Missingness preservation
→ Irregular-time alignment
→ State-window construction
→ Lag candidate discovery
→ Conditional dependence / influence estimation
→ Intervention validation for critical edges
→ Dynamic G_t update
```

## 關鍵工程規則

```text
if occurrence_time unknown:
    do not silently replace with observed_time
    mark temporal_provenance = OBSERVED_ONLY
```

```text
if event is retry duplicate:
    preserve retry relation
    do not treat duplicate observation as independent evidence
```

```text
if encoder_version changes:
    dense state cannot be compared as same coordinate system
    require bridge/projection/re-encoding or new representation epoch
```

```text
if channel is irregular:
    prefer real-time window / continuous-time representation
    avoid event-index lag semantics
```

---

# Visual Simulation Idea

## Temporal State & Semantic Channel Lab

### 主畫面：多時鐘 runtime

```text
TIME ─────────────────────────────────────────────→

USER     ● message
MODEL      [──────── LLM CALL ────────]
TOKENS       ●●●●●●●●●●●●●
TOOL                         [──CALL──] ●result
MEMORY                                  ●write
VIDEO    ▥▥▥▥▥▥▥▥▥▥▥▥▥▥▥▥▥▥▥▥▥▥
AUDIO    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
GPU        ▁▂▇████▆▃▂▁
```

點擊 ToolResult 顯示：

```text
Occurrence   22:51:10.105
Observed     22:51:10.892
Consumed     22:51:10.941

Transport delay  787 ms
Queue delay       49 ms
```

使用者可切換：

```text
OBSERVED TIME
OCCURRENCE TIME
SEMANTIC TIME
EVENT INDEX
```

如果用 EVENT INDEX 算到：

```text
ToolResult → Plan lag = 1
```

切真實時間後顯示：

```text
ToolResult → Plan lag = 1.82 s
```

### Channel Compression View

```text
RAW 12,481 events
↓
742 typed semantic events
↓
96 temporal windows
↓
continuous state z(t)
```

可以切換：

- raw events
- typed sparse state
- dense latent
- hybrid

並即時觀察 influence graph 是否穩定。

### Interval Causality View

```text
RateLimitActive   [================]
ToolCall                ●
ToolFailure             ●
```

讓使用者理解：

`interval overlap` 比 `前一個 event 是什麼` 更能表達某些 runtime causality。

---

# Code / GitHub

## 1. OpenTelemetry Collector
Repo: https://github.com/open-telemetry/opentelemetry-collector

值得讀：

```text
service/service.go
service/internal/graph/graph.go
service/pipelines/config.go
receiver/
processor/
exporter/
```

已確認 `Service.initGraph()` 會建立 pipeline graph；pipeline config 會驗證 receiver / exporter。Hermes 值得借的是 pipeline/component graph 與 receiver→processor→exporter 分層。

## 2. torchcde
Repo: https://github.com/patrick-kidger/torchcde

值得讀：

```text
torchcde/
README.md
examples/
```

關鍵 API / mechanism：

```text
linear_interpolation_coeffs
hermite_cubic_coefficients_with_backward_differences
rectilinear interpolation
CubicSpline / LinearInterpolation
cdeint
```

最值得 Hermes 實驗的是：將 `semantic_channel × event value × missingness × time` 做成 control path，再比較 Neural CDE state 對 downstream lag/influence estimation 是否比 fixed-bin resampling 穩定。

## 3. Tigramite
Repo: https://github.com/jakobrunge/tigramite

已確認核心 source structure：

```text
tigramite/
├ pcmci.py
├ pcmci_base.py
├ jpcmciplus.py
├ lpcmci.py
├ rpcmci.py
├ causal_effects.py
├ causal_mediation.py
├ data_processing.py
├ graphs.py
├ models.py
├ independence_tests/
└ plotting.py
```

下一步最值得深入：

```text
data_processing.py
pcmci.py
pcmci_base.py
independence_tests/
```

因為 Hermes 的下一個工程問題正是：irregular/missing multimodal channel 怎麼組 dataframe、怎麼定 lag window、怎麼處理 mask，再餵 causal discovery。

---

# Papers

## Paper A — Neural Controlled Differential Equations for Irregular Time Series
- **Title**: Neural Controlled Differential Equations for Irregular Time Series
- **Authors**: Patrick Kidger, James Morrill, James Foster, Terry Lyons
- **Institution**: University of Oxford / Oxford-related research group（本輪由 Oxford 官方研究頁驗證）
- **Year**: 2020, NeurIPS
- **URL**: https://arxiv.org/abs/2005.08926
- **Code**: https://github.com/patrick-kidger/torchcde
- **Dataset**: 論文含多個 irregular time-series benchmarks；本輪不將未逐項核對的 dataset 名稱硬寫成已驗證事實
- **Architecture**: discrete irregular observations → interpolation path X(t) → Neural CDE vector field f → hidden continuous state z(t)
- **Contribution**: 將 continuous-time CDE 用作 irregular partially observed multivariate sequence model
- **Limitations**: interpolation choice、ODE solver 計算成本、latent state 可解釋性
- **改變了什麼**: 讓「不規則事件一定先 resample 成固定格子」不再是唯一選項

## Paper B — Discovering contemporaneous and lagged causal relations in autocorrelated nonlinear time series datasets
- **Authors**: Jakob Runge
- **Institution**: DLR / causal time-series research line
- **Year**: 2020, UAI
- **URL**: https://proceedings.mlr.press/v124/runge20a.html
- **Code**: https://github.com/jakobrunge/tigramite
- **Dataset**: synthetic time-series experiments + benchmark-style evaluations
- **Architecture**: PCMCI+ conditional independence framework for lagged and contemporaneous causal links
- **Contribution**: 提升 autocorrelated nonlinear time-series 下 lagged/contemporaneous causal discovery 的可行性
- **Limitations**: 對 stationarity、causal sufficiency 等仍有 assumptions；irregular timing 並非原始 PCMCI+ 的核心情境
- **改變了什麼**: 提供上一輪 dynamic influence graph 一個比 correlation 更有結構的 lag discovery 前端

## Paper C — Causal Discovery on Irregular Time Series
- **Authors**: Martim Penim, Ricardo Ribeiro Pereira, Jacopo Bono, Hugo Ferreira, Mário A. T. Figueiredo, Pedro Bizarro
- **Institution**: 本輪未完成逐作者 affiliation 的獨立核對，因此不猜測
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2607.15108
- **Code**: 本輪未驗證到官方 code URL
- **Dataset**: synthetic irregular event streams（由摘要層資訊確認）
- **Architecture**: PCMCI+ extension；將固定 discrete lag 改為 predefined temporal-window influence aggregation
- **Contribution**: 把 causal discovery 顯式推向 irregularly sampled time series
- **Limitations**: temporal windows 需預先定義；主要公開結果依賴 synthetic irregular settings
- **改變了什麼**: 對 Hermes 直接回答「event-index lag 不足時怎麼辦」

## Paper D — Causal Discovery from Interval-Based Event Sequences
- **Authors**: Lénaïg Cornanguer, Joscha Cüppers, Jilles Vreeken
- **Institution**: CISPA Helmholtz Center for Information Security
- **Year**: 2026, AAAI
- **URL**: https://ojs.aaai.org/index.php/AAAI/article/view/39160
- **Code**: 本輪未驗證官方 code
- **Dataset**: synthetic + real interval-event settings；paper page 提及 medical use case
- **Architecture**: interval-based event causal model + Niagara algorithm + MDL model selection
- **Contribution**: 將 event duration/overlap 直接納入 causal discovery
- **Limitations**: 與通用 LLM Agent runtime 的 mapping 仍需工程驗證
- **改變了什麼**: 證明「point events only」會漏掉 duration-dependent causal structure

## Paper E — The Missing Temporal Link: Temporal Context Routing for Script-Driven Audio-Video Generation
- **Authors**: Yichen Liu et al.
- **Institution**: multi-institution；本輪未完整逐作者 affiliation 驗證
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2609.01827
- **Code**: 公開摘要索引提及 code release，但本輪未獨立驗證 official repo URL
- **Dataset / evaluation**: 200 test scripts + user-study style evaluation（由論文摘要資料確認）
- **Architecture**: structured script timing → shared audio-video temporal axis → temporal routing of generation guidance
- **Contribution**: 解決 audio/video 彼此同步但共同偏離 script semantic timing 的問題
- **Reported result**: Shot Boundary MAE 1.11 s → 0.042 s；Dialogue Acc@0.5s 28.3% → 84.1%
- **Limitations**: 結果集中在 script-driven joint AV generation，不能直接推成所有 multimodal Agent 的 universal result
- **改變了什麼**: 明確區分 modality synchronization 與 task-semantic timeline alignment

---

# 與歷史研究比較：本輪真正新增什麼

歷史已經有：

```text
Multimodal Event Sourcing
→ 如何保存/重播多模態 artifact

Cross-Modal Entity Resolution
→ 不同 modality 如何指向同一 world entity

Online Influence Estimation
→ 已有 channel 後如何估 G_t
```

本輪新增中介層：

```text
Raw Runtime Event
↓
Event Temporal Semantics
↓
Point / Span / Interval
↓
Semantic Channel
↓
Hybrid State Representation
↓
Irregular-Time Alignment
↓
Lag Window
↓
Influence Estimation
```

因此本輪不是 event sourcing 的重複，也不是 G_t estimator 的重複，而是正式補齊兩者中間的 representation contract。

---

# Unknown / Open Questions

## 1. Semantic Channel Granularity 怎麼自動選？
太粗：

```text
TOOL
```

會把 target、command、observation、effect 全混在一起。

太細：

```text
tool.gmail.send.recipient.account.personal...
```

會造成極度 sparse，樣本不足。

需要研究 hierarchical channel discovery / merge-split criterion。

## 2. Dense State 如何跨 Encoder Version 保持可比較？
Encoder v1 與 v2 的 latent axes 並不是同一空間。需要：

```text
representation epoch
bridge encoder
paired calibration set
canonical semantic anchors
```

否則長期 G_t 趨勢會混入 encoder upgrade artifact。

## 3. 真正 Agent Lag 應該用哪個 clock？
候選包括：

```text
occurrence time
observed time
consumed time
model-start time
commit time
logical causal order
```

不同研究問題可能需要不同 clock domain，未來需要 Multi-Clock Causal Runtime 而非單一 global timestamp。

---

# Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Universal Agent Event Envelope
Occurrence Time
Observed Time
Consumed Time
Clock Domain
Temporal Provenance
Point Event
Duration Span
Semantic Interval State
Semantic Channel
Hierarchical Channel
Channel Granularity
Hybrid State Representation
Typed Sparse State
Dense Runtime State
Representation Epoch
Irregular Event Stream
Multi-Rate Runtime
Continuous-Time State
Neural CDE State
Interpolation Policy
Temporal Window
Real-Time Lag
Event-Index Lag
Interval Overlap
Temporal Normalization
Multimodal Shared Timeline
Semantic Timeline
Lag Discovery Plane
```

## 新 Edges

```text
Raw Runtime Event
→ normalized_as
Universal Agent Event Envelope

Event Envelope
→ classified_as
Point Event / Span / Interval State

Event Envelope
→ routed_to
Semantic Channel

Semantic Channel
→ projected_into
Hybrid State Representation

Irregular Event Stream
→ encoded_by
Continuous-Time State

Continuous-Time State
→ queried_at
Decision Time

Temporal Window
→ defines
Candidate Real-Time Lag

Lag Discovery Plane
→ constrains
Dynamic Gain Matrix G_t

Occurrence Time
→ differs_from
Observed Time

Multimodal Streams
→ aligned_on
Shared Semantic Timeline
```

## 新否定關係

```text
Event Index ≠ Real Time
Timestamp ≠ Observed Timestamp
Observed Timestamp ≠ Causal Occurrence Time
Point Event ≠ Duration Span
Span ≠ Persistent Semantic State
Audio-Video Synchronization ≠ Task Timeline Alignment
Same Trace ≠ Same Semantic Channel
Trace Ancestry ≠ Causal Influence
Dense Embedding ≠ Stable Semantic State
Resampling ≠ Neutral Transformation
Missing Value ≠ Zero
Encoder Upgrade ≠ Same Coordinate System
Temporal Correlation ≠ Causal Lag
```

---

# 下一輪研究

本輪完成後，下一個最深缺口變成：

# **Representation Drift × Encoder Epoch × Cross-Version Latent Alignment × Semantic Anchor Calibration**

因為現在 Hermes 已經能定義：

```text
Event
→ Channel
→ State
→ Lag
→ G_t
```

但如果明天：

```text
VLM v1 → VLM v2
Embedding v1 → Embedding v2
ASR model change
Tool schema change
Channel ontology change
```

那麼：

```text
state_t in representation space R1
```

與：

```text
state_t+1 in representation space R2
```

可能根本不能直接比較。

下一輪應研究：

```text
Representation Epoch
Canonical Semantic Anchors
Procrustes / CCA-style alignment
Latent bridge models
Cross-version paired calibration
Embedding drift detection
Ontology migration
Semantic checksum
Backward-compatible state projection
```

並回答：

> **AI Runtime 升級模型之後，昨天量到的 Memory / Vision / Agent state 與今天的 state，還是不是「同一個座標系裡的東西」？**

---

# 本輪結束判定

- **缺哪一層**：Cross-Version Representation Alignment / Representation Epoch Runtime。
- **哪個節點最淺**：Semantic Channel Granularity 的自動 merge/split criterion。
- **哪個概念仍只是名詞**：Unified Cross-Modal State Vector ABI、Multi-Clock Causal Runtime。
- **哪個系統值得讀原始碼**：Tigramite 的 `data_processing.py` / `pcmci.py` / `independence_tests/`；torchcde 的 interpolation 與 `cdeint`；OpenTelemetry Collector 的 pipeline graph。
- **哪篇論文需追引用**：Neural CDE、PCMCI+、Causal Discovery on Irregular Time Series、Niagara。
- **哪個概念最適合視覺模擬**：Temporal State & Semantic Channel Lab。
- **哪個 Agent 架構最值得實作**：

> **Unified Temporal-State Agent Runtime = OpenTelemetry-style Event Envelope + Multi-Clock Temporal Normalizer + Point/Span/Interval Semantics + Hierarchical Semantic Channels + Hybrid Sparse/Dense State + Irregular-Time Encoder + Temporal-Window Lag Discovery + Dynamic G_t**

本輪最大的底層進展可以濃縮成一句：

> **在問「Agent A 是否影響 Agent B」之前，系統必須先知道兩邊的事件到底何時真正發生、何時才被看見、它們屬於什麼 semantic channel，以及不同速度的文字、工具、記憶、影像、聲音與 GPU 訊號如何被映射到同一條可比較的時間軸；否則再高級的 causal/influence 演算法也只是在精確分析錯誤的 representation。**
