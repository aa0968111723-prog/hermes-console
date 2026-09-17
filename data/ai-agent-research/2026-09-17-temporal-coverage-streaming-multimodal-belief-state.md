# 【AI Agent × Multimodal Research Report】

**時間：2026-09-17 19:54（Asia/Taipei）**  
**主題：Temporal Coverage Proof × Streaming Multimodal Alignment × Recursive Belief State × Dynamic Invariants**

## 與歷史研究比較

上一輪已建立 Execution Plane + Evidence Plane，並把最淺節點定位為 `TemporalCoverageProof`：多模態 evidence 不只要知道 source/crop/encoder，也要能證明某個 claim 在時間上被實際觀察覆蓋。本輪不再重複 provenance schema，而向下追兩條底層路徑：

1. Microsoft AgentRx `dynamic_invariant_generator.py`：確認 dynamic invariant 如何依「截至目前 step 的 trajectory state」產生可執行 constraint。
2. Recursive Multimodal Agent (ReMA) 原始碼 + streaming multimodal papers：追 timestamped frame → memory → inspect/search → belief/action，以及 streaming input/output 如何共享 temporal grid。

## 本小時新發現

### 新 bottom-level mechanism：Dynamic Invariant 是 prefix-state assertion

AgentRx `dynamic_invariant_generator.py` 明確要求 generator 取得 task instruction、static invariants、以及「full agent trajectory up to current step」，並產生 step-specific invariant。其 focus 包含 computation、context-specific business logic、cross-tool data validation；輸出 invariant 還帶 `event_trigger(step_index/substep_index/role_name)`、`invariant_type`、`check_type` 與可執行 Python check。

這表示 dynamic invariant 不應建模成事後 report，而是：

```text
Trajectory Prefix S[0:t]
→ derive assertion I_t
→ bind trigger E_t
→ execute checker against S[0:t]
→ PASS / FAIL / UNKNOWN
→ evidence
```

對 Hermes 的直接意義：TemporalCoverageProof 也可以成為 dynamic invariant，而不是只存在 UI annotation。

### 新 GitHub 深讀：Recursive Multimodal Agent (ReMA)

Repository: https://github.com/cg1177/Recursive-Multimodal-Agent

核心檔案：
- `run.py`：Agent loop、video reader、memory、tool registration、tool-call execution。
- `utils/tools.py`：`video_inspect_tool`、`memory_search_tool`、timestamped frame sampling、memory write-back。
- `utils/video_reader.py`：下一輪需追 frame index ↔ timestamp semantics。
- `utils/memory.py` / `utils/global_caption.py`：下一輪需追 memory compression / recursive belief implementation。

原始碼確認 `FFmpegVideoReader(... fps_cached=2.0)`；`video_inspect_tool` 對指定 time ranges 呼叫 `sample_frames_by_fps(..., 2, ...)`，每個 frame 被包成 `[HH:MM:SS] + image` 後送入 VLM。VLM caption 可帶局部 timestamp，之後另一個 model call 將 timestamp 加上 clip start offset，再把結果寫回 memory，metadata 至少含 `start_time/end_time/question/mem_type=video_info`。

因此真實 evidence chain 已可還原：

```text
Requested interval [a,b]
→ sample_frames_by_fps(2 fps)
→ Frame_i + timestamp_i
→ resize/base64
→ VLM inspection
→ timestamp-normalization (+ clip offset)
→ caption
→ memory.add(start_time=a,end_time=b,...)
→ memory search
→ Agent next decision
```

### 新論文：Aero Realtime

**Title:** Aero Realtime: Fully Aligned Input-Output Streams for Low-Latency Streaming Multimodal Generation  
**Authors:** Kaichen Zhang, Wei Huang, Keming Wu, Bo Li, Xiaojuan Qi  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2608.08469  
**Architecture:** video/audio/text output 對齊到 shared temporal grid；約 80-ms audio slot 預測 lexical token 或 silence token；inference 只 append 最新 multimodal slot，沿用 output state 並 reuse KV cache。  
**Contribution:** 把「何時回應」與「回應什麼」放入同一 autoregressive objective，而非外部 polling/gate。  
**Reported result:** 四張 NVIDIA A6000 上連續 20 分鐘 video stream 的 processing lag median 84 ms、P95 173 ms。  
**Limitations:** shared slot grid 解決 alignment/serving 結構，不自動等於 semantic evidence provenance，也不保證 agent action 的 temporal grounding。

### 新架構：AViLA Query–Evidence Asynchrony

**Title:** AViLA: Asynchronous Vision-Language Agent for Streaming Multimodal Data Interaction  
**Authors:** Gengyuan Zhang et al.  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2506.18472  
**Architecture:** comprehensive memory retention → evidence identification → evidence-grounded trigger。  
**Contribution:** 明確建模 query 與 supporting evidence 不同時抵達；Agent 必須保留 past observations、持續讀 present/future stream，並在 evidence 足夠時才回答。  
**Limitations:** temporal trigger correctness 仍依 evidence identification 品質；不是底層 clock synchronization protocol。

### 新長時記憶架構：ReMA / MM-Lifelong

**Title:** Towards Multimodal Lifelong Understanding: A Dataset and Agentic Baseline  
**Authors:** Guo Chen et al.  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2603.05484  
**Code:** https://github.com/cg1177/Recursive-Multimodal-Agent  
**Dataset:** MM-Lifelong，181.1 hours，Day/Week/Month scales。  
**Architecture:** dynamic memory management + recursive belief state + memory search + targeted video inspection。  
**Contribution:** 論文辨識兩個 failure modes：end-to-end MLLM 的 Working Memory Bottleneck，以及 agentic baseline 在 sparse long timeline 的 Global Localization Collapse。  
**Limitations:** repository 的 current inspection path 以 sampled frames/captions/memory 為主；timestamped caption 並不等同 frame-level provenance proof。

## 本小時最重要 5 個發現

### 1. Temporal coverage 必須區分 Requested Range、Observed Samples、Claimed Range

不能把 memory metadata 的 `[start_time,end_time]` 直接當成「整段都被模型看過」。在 ReMA inspection path 中，interval 會先被 frame sampling；真正被 VLM 看見的是離散 frames。

Hermes 應建模：

```text
RequestedRange = [a,b]
ObservedSamples = {t1,t2,...,tn}
ClaimTemporalSupport = [c,d] or {events}

TemporalCoverageProof(claim) requires
ClaimTemporalSupport
  ↔ reachable ObservedSamples
  ↔ sampling policy / tolerance
```

若只保存 `[a,b]` caption metadata，會把 sampling gaps 誤畫成 continuous observation coverage。

### 2. Streaming multimodal alignment 有三種不同的「時間」

```text
SourceTime       camera/audio/video media timestamp
ArrivalTime      runtime 收到 chunk 的時間
ModelTime        chunk/slot 真正進 encoder/LM/KV state 的時間
```

Aero Realtime 的 shared temporal grid主要約束 model-side aligned slots；Hermes 還需保存 source/arrival/model 三者，才能診斷 network jitter、late chunk、queue backlog、model lag。

新增 invariant candidate：

```text
SourceTime(e) <= ArrivalTime(e) <= ModelApplyTime(e)
```

以及 latency：

```text
ObservationLag = ModelApplyTime - SourceTime
```

但跨裝置時鐘未同步時，第一條只能在 clock-domain normalization 後使用。

### 3. Query–Evidence Asynchrony 代表「不知道」本身是合法 runtime state

AViLA 的問題不是單純 retrieve past video，而是 evidence 可能尚未抵達。因此 Agent state 應允許：

```text
QUERY_RECEIVED
→ EVIDENCE_INSUFFICIENT
→ OBSERVING
→ SUPPORT_FOUND
→ TEMPORAL_COVERAGE_PROVEN
→ RESPOND
```

這與 Hermes 上輪的 `PASS | FAIL | UNKNOWN` 完全接得起來：`UNKNOWN` 不是 checker failure，而可能代表 stream 尚未提供足夠 evidence。

### 4. Recursive belief state 必須帶 source revision / temporal support，否則 memory compression 會切斷 provenance

ReMA 透過 caption → memory → search → inspect 來處理長時間範圍。Hermes 若只保存壓縮後文字，會失去「這個 belief 是由哪些 frames / intervals 支撐」。因此 belief update 應為：

```text
Belief B_t {
  statement
  source_evidence_ids[]
  source_time_ranges[]
  transform_chain[]
  confidence
  supersedes[]
}
```

更新不是覆寫：

```text
B_t + new evidence E_(t+1)
→ B_(t+1)
→ edge: derived_from(B_t,E_(t+1))
```

這是 Hermes architecture proposal，不是宣稱 ReMA repo 已保存完整 graph。

### 5. Dynamic invariant engine 可直接成為 streaming evidence gate

AgentRx 已證明 step-prefix → executable invariant 的工程 pattern。Hermes 可把 streaming claim gate 寫成：

```text
on ClaimProposed(C):
  derive TemporalCoverageInvariant(C)
  derive ProvenanceInvariant(C)
  derive FreshnessInvariant(C)

  hard checks → synchronous
  neural semantic support → async / confidence-bearing

  if hard FAIL:
      block / re-observe
  elif UNKNOWN:
      continue observing/searching
  else:
      allow reasoning/action
```

這把「多模態 provenance viewer」推進成真正 runtime control primitive。

## Architecture Breakdown

### Temporal Evidence Runtime

```text
Camera / Mic / Video / Sensor
→ Source Clock + Sequence ID
→ Capture
→ Decode
→ Arrival Queue
→ Clock Normalization
→ Sampling / Windowing
→ Encoder
→ Multimodal Slot / Token
→ Fusion / KV State
→ Grounding
→ Evidence Node
→ Claim
→ Dynamic Invariant Gate
→ Belief State
→ Planner
→ Tool / Embodied Action
```

### Evidence state machine

```text
UNSEEN
→ CAPTURED
→ ARRIVED
→ DECODED
→ SAMPLED
→ ENCODED
→ GROUNDED
→ ACTIVE_EVIDENCE
→ SUPPORTS_CLAIM
→ RETIRED / SUPERSEDED
```

### Query state machine

```text
QUERY_RECEIVED
→ SEARCH_MEMORY
→ INSUFFICIENT
→ INSPECT_STREAM / VIDEO
→ EVIDENCE_FOUND
→ COVERAGE_CHECK
→ CLAIM_GROUNDED
→ ANSWER / ACTION
```

## Bottom-Level Logic

### Video temporal path

```text
container PTS/DTS
→ decoder frame
→ source timestamp
→ frame sampler (e.g. 2 fps)
→ selected frame timestamps
→ resize/encode transport representation
→ VLM visual embeddings
→ textual/structured grounding
→ caption / claim
→ memory record
```

Important: `2 fps` means an interval's semantic coverage is sampled, not continuous. A transient event between selected frames can be missed. Therefore `memory.start_time/end_time` is a search/index range, not by itself a proof that every moment was observed.

### Streaming slot path (Aero-style)

```text
incoming audio/video
→ aligned temporal slot
→ newest multimodal slot append
→ reuse prior autoregressive/KV state
→ lexical token OR silence token
→ advance timeline
```

This reduces repeated prefill and makes response timing part of generation, but Hermes still needs provenance from output token/claim back to contributing slots.

### Dynamic invariant path (AgentRx-style)

```text
Task Instruction
+ Static Invariants
+ Trajectory Prefix through Step t
→ LLM invariant generator
→ JSON invariant
→ event trigger
→ Python/NL checker
→ violation/evidence
```

For Hermes, generator-produced checks must never be treated as trusted merely because code was generated; generated checker code requires sandboxing/versioning and deterministic test fixtures.

## Visual Simulation Idea

### Temporal Coverage & Streaming Fusion Microscope

Five synchronized lanes:

```text
SOURCE      frame F1 ---- F2 ---- F3 ---- F4
ARRIVAL       F1 -- F2 -------- F4 -- F3(late)
SAMPLER       keep F1 ----- keep F3
MODEL SLOT    S1 ---------- S2
CLAIM         -------- "person fell" --------
```

UI controls:
- source FPS / sampler FPS
- network jitter
- out-of-order chunk
- clock drift
- audio delay
- frame drop
- memory compression
- query arrival before/after evidence
- max observation lag

UI overlays:
- Requested Range
- Actually Observed Samples
- Claim Support Window
- Source/Arrival/Model timestamps
- Provenance edges
- PASS / FAIL / UNKNOWN TemporalCoverageProof

A click on a claim should highlight exactly which frames/audio chunks/slots support it, not merely the parent video interval.

## Code / GitHub

### Microsoft AgentRx
https://github.com/microsoft/AgentRx

本輪讀：
- `agentrx/invariants/dynamic_invariant_generator.py`

值得續追：
- dynamic generator 的 actual class methods / prompt parsing / assertion reuse
- judge causal attribution
- checker sandbox boundary

### Recursive Multimodal Agent
https://github.com/cg1177/Recursive-Multimodal-Agent

本輪讀：
- `run.py`
- `utils/tools.py`

確認的重要 implementation：
- ReAct-style loop + function calling
- `memory_search_tool` / `video_inspect_tool` / `finish`
- timestamped sampled frames
- parallel frame encoding / inspection workers
- inspected caption write-back into memory with temporal metadata

下一輪值得讀：
- `utils/video_reader.py`
- `utils/memory.py`
- `utils/global_caption.py`
- `utils/openai_client.py`

## Papers

1. **Aero Realtime: Fully Aligned Input-Output Streams for Low-Latency Streaming Multimodal Generation** — Kaichen Zhang, Wei Huang, Keming Wu, Bo Li, Xiaojuan Qi, 2026. https://arxiv.org/abs/2608.08469
2. **AViLA: Asynchronous Vision-Language Agent for Streaming Multimodal Data Interaction** — Gengyuan Zhang et al., 2025. https://arxiv.org/abs/2506.18472
3. **Towards Multimodal Lifelong Understanding: A Dataset and Agentic Baseline** — Guo Chen et al., 2026. https://arxiv.org/abs/2603.05484 ; code https://github.com/cg1177/Recursive-Multimodal-Agent

## 已確認 / 官方 / 論文 / 推論 / 假說

**已確認工程實作：** AgentRx dynamic generator 使用 current trajectory prefix 建 step-specific invariant；ReMA repo 的 `video_inspect_tool` 對指定時間區間抽樣 timestamped frames、送 VLM、校正 caption timestamps，並把 temporal metadata 寫入 memory。

**論文結果：** Aero Realtime 將 video/audio/output 對齊 shared temporal grid並報告低延遲 continuous streaming；AViLA 建模 Query-Evidence Asynchrony；MM-Lifelong/ReMA 報告 Working Memory Bottleneck 與 Global Localization Collapse。

**合理工程推論：** Hermes 應把 RequestedRange、ObservedSamples、ClaimSupport 分開；memory interval 不能直接等同 continuous evidence coverage。

**尚未驗證假說：** 用 dynamic invariant 在 runtime 阻擋 temporal-unsupported claims，是否能在不顯著增加 latency 的情況下降低 streaming multimodal hallucination，需要 benchmark/fault injection。

## Unknown / Open Questions

1. ReMA `FFmpegVideoReader.sample_frames_by_fps` 對 VFR video、PTS、rounding、seek boundary 的精確 semantics 是什麼？
2. Audio/video 來自不同 clock domains 時，TemporalCoverageProof 應如何攜帶 clock uncertainty / drift estimate，而非假設 timestamp 可直接比較？
3. Streaming fusion 中，一個 output claim 到底應保存 token-level slot attribution、window-level provenance，還是 external grounding evidence，才能兼顧可驗證性與成本？

## 下一輪研究

鎖定：**FFmpeg PTS/DTS → frame sampling semantics × Clock Domain Normalization × Late/Out-of-Order Evidence × Belief Revision × Dynamic Invariant Runtime Gate**。

具體追：

```text
video_reader.py
→ seek / decode / timestamp
→ sample_frames_by_fps
→ VFR / frame drop / rounding

memory.py + global_caption.py
→ caption import
→ memory compression
→ search
→ source temporal range 是否保留

Streaming runtime
→ source_time / arrival_time / model_apply_time
→ watermark
→ late evidence policy
→ claim invalidation / belief revision
```

## Knowledge Graph 新增 Node / Edge

### Nodes
- `TemporalCoverageProof`
- `RequestedTemporalRange`
- `ObservedSampleSet`
- `ClaimSupportWindow`
- `SourceTimestamp`
- `ArrivalTimestamp`
- `ModelApplyTimestamp`
- `ObservationLag`
- `ClockDomain`
- `StreamingSlot`
- `QueryEvidenceAsynchrony`
- `EvidenceInsufficientState`
- `RecursiveBeliefState`
- `BeliefRevision`
- `DynamicInvariantGate`
- `SamplingGap`
- `GlobalLocalizationCollapse`
- `WorkingMemoryBottleneck`

### Edges
```text
ObservedSampleSet --supports--> ClaimSupportWindow
SamplingPolicy --determines--> ObservedSampleSet
SamplingGap --weakens--> TemporalCoverageProof
SourceTimestamp --normalized_into--> RuntimeTimeline
ArrivalTimestamp --measures--> TransportDelay
ModelApplyTimestamp --measures--> ProcessingDelay
TemporalCoverageProof --required_by--> GroundedClaim
GroundedClaim --updates--> RecursiveBeliefState
NewEvidence --causes--> BeliefRevision
TrajectoryPrefix --generates--> DynamicInvariant
DynamicInvariantGate --guards--> AgentAction
QueryEvidenceAsynchrony --creates--> EvidenceInsufficientState
```

## 本輪結束判斷

- **缺哪一層：** clock-domain normalization + late/out-of-order evidence policy。
- **哪個節點最淺：** `ClockDomain` / `BeliefRevision`。
- **哪個概念仍只是名詞：** token/slot → natural-language claim 的精確 attribution。
- **哪個系統值得讀原始碼：** ReMA `video_reader.py`、`memory.py`、`global_caption.py`；AgentRx dynamic generator/checker boundary。
- **哪篇論文需追引用：** Aero Realtime（duplex slot alignment/serving）與 AViLA（Query-Evidence Asynchrony）。
- **哪個概念最適合視覺模擬：** Temporal Coverage & Streaming Fusion Microscope。
- **哪個 Agent 架構最值得實作：** `Observe → Evidence Gate → Belief Revision → Plan → Act`，其中 UNKNOWN 會繼續觀察而不是強迫回答。

## 回到「AI 到底怎麼運作」

本輪補上的鏈條是：

```text
Camera / Mic / Video
→ source clock / PTS
→ capture/decode
→ network/runtime arrival
→ sampling/windowing
→ encoder
→ multimodal slot/token
→ fusion / KV state
→ grounding
→ evidence node
→ temporal coverage check
→ belief state
→ reasoning/planning
→ action
```

核心結論：**多模態 Agent 的「看過」不是一個布林值。Runtime 必須區分它被要求看的時間範圍、實際抽樣並送進模型的 evidence、以及 claim 真正需要的 support window；再加上 source/arrival/model 三種時間。否則一段 `[00:10,00:20]` 的 caption 很容易在 Knowledge Graph 中被錯誤放大成「AI 連續觀察了整整 10 秒」。Temporal Coverage Proof 應從可視化 metadata 升級成 Agent action 前的 runtime invariant。**