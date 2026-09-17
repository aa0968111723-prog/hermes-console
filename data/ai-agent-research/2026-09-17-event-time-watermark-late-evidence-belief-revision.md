# 【AI Agent × Multimodal Research Report】

**時間：2026-09-17 20:54（Asia/Taipei）**  
**主題：Event-Time Watermark × VFR Timestamp Fidelity × Late Evidence × Belief Revision**

## 與歷史研究比較

上一輪已把多模態時間拆成 SourceTime / ArrivalTime / ModelApplyTime，並把最缺的一層定位為 Clock Domain Normalization + Late/Out-of-Order Evidence Policy。本輪不重複 TemporalCoverageProof 定義，而往下驗證 ReMA 的 frame timestamp 是如何產生，再借用成熟 stream-processing 的 event-time/watermark 語義，建立可供 Agent Runtime 使用的 Late Evidence / Belief Revision state machine。

## 本小時新發現

### 1. ReMA 的 cached frame identity 並非原始 frame PTS identity

直接讀 `utils/video_reader.py`：`FFmpegVideoReader` 用 ffprobe 的 `avg_frame_rate` 取得 nominal fps，但 LMDB cache 實際透過 FFmpeg `-vf fps={target_fps}` 重採樣，輸出 rawvideo；LMDB key 是 cache 後的連續 `frame_id`。`sample_frames_by_fps()` 再以 `int(sec * fps_cached)` 算 frame index，timestamp 則用 `(fid-start_idx)/fps_cached` 合成。

因此 current path 的時間身份更接近：

```text
Original container timestamps / decode timeline
→ FFmpeg fps filter
→ resampled CFR-like cache positions
→ synthetic frame_id
→ synthetic relative timestamp = index / fps_cached
```

而不是：

```text
original frame PTS
→ preserved evidence timestamp
```

對 CFR、穩定來源可能足夠；但對 VFR、timestamp discontinuity、frame duplication/drop、seek 邊界，不能把 synthetic timestamp 當成原始 capture provenance。

### 2. `actual_indices` 與 `timestamps` 可能表達不同 identity

`sample_frames_by_fps()` 在 requested frame key 缺失時會找 nearest cached frame，`actual_indices` 記錄實際 nearest frame；但 `timestamps` 仍由 requested `fid` 計算。這意味著 evidence node 若只保存 timestamp，可能不知道真正 decode/display 的是哪個 cached frame。

Hermes 應保存：

```text
RequestedSampleIndex
ActualSampleIndex
SyntheticSampleTime
OriginalMediaPTS?   // 若可取得
```

並加入 invariant：

```text
if RequestedSampleIndex != ActualSampleIndex:
    evidence.identity_substituted = true
```

### 3. Global caption 會把離散 sample 壓縮成連續時間區間

`global_caption.py` 每 300 秒 clip 以 1 fps sample，VLM 產生 caption 後，Memory 只保存 `start_time/end_time/mem_type` 與文字 caption。原始 sampled frame IDs、actual_indices、sample timestamps 沒有一起寫進 Mem0 metadata。

因此存在 provenance compression boundary：

```text
Sampled Frames + timestamps + actual_indices
→ VLM caption
→ [start,end] + text
→ vector embedding / reranker
```

這是工程實作確認，不等於論文方法必然如此。Hermes 應避免把 `[start,end]` 視為 continuous evidence coverage。

### 4. Event-time watermark 可成為 Agent 的「暫時完整性」模型

Apache Flink 將 event time 定義為事件在 source 發生的時間；watermark(t) 表示 runtime 認為 timestamp <= t 的事件應已大致到齊。多輸入 operator 的 current watermark 由最落後 active input 控制；晚於 watermark 才到達的資料是 late event。這是一個成熟的 stream-processing correctness pattern，可映射到 multimodal Agent，但這是 Hermes architecture proposal，不是 Flink 對 AI Agent 的官方設計。

Hermes MultimodalWatermark：

```text
Camera watermark Wc
Audio watermark Wa
Tool-observation watermark Wt
Sensor watermark Ws

FusionWatermark = min(active Wc, Wa, Wt, Ws)
```

Claim 對時間窗 [a,b] 若要求所有 modality 都完整，只有 `FusionWatermark > b` 後才能說「不再預期有正常時序 evidence 補進來」。

### 5. Late evidence 不應只有 DROP；Agent 需要 revision semantics

Stream processor 可以 drop、side-output 或 allowed-lateness 後重新 fire window。Agent 的語義更敏感：late camera/audio/tool evidence 可能推翻已形成的 belief 或已執行的 plan。

Hermes 建議：

```text
LateEvidence arrives
→ attach to original event-time window
→ compare against active beliefs/claims
→ no contradiction: enrich evidence
→ contradiction: invalidate claim support
→ revise belief
→ recompute dependent plan
→ if action not yet executed: cancel/re-plan
→ if action executed: emit compensating/recovery action candidate
```

這把 streaming lateness 與上一輪的 BeliefRevision 真正接起來。

## 本小時最重要 5 個發現

1. **Frame timestamp fidelity**：ReMA cache 使用 FFmpeg fps filter + synthetic index/fps timestamp；不是原始 PTS provenance。重要性：VFR 或 drop/dup 時可能把 evidence 時間畫得比實際精確。限制：尚未 fault-test 真實 VFR fixture。
2. **Requested vs actual sample identity**：nearest-frame fallback 可能讓 requested timestamp 與 actual frame identity分離。重要性：claim attribution 必須指向真正 frame。限制：LMDB 正常完整 cache 時不一定觸發。
3. **Memory provenance compression**：sample-level identity 在 caption→Mem0 boundary 被壓成 `[start,end]+text`。重要性：後續 RAG 可以找 caption，但無法單靠 memory record證明 frame-level coverage。
4. **Watermark as evidence completeness frontier**：成熟 stream systems用 watermark管理 out-of-order event；Agent 可用 per-modality watermark 建 provisional completeness。限制：watermark 是 policy/assumption，不是世界真相。
5. **Late evidence must trigger belief revision**：對 Agent 而言 late event 可能需要撤銷 claim、re-plan，甚至產生 compensating action，而不只是 dropped record。

## Architecture Breakdown

```text
Camera / Mic / Video / Tool / Sensor
→ Native Clock / PTS / Sequence
→ Decode / Capture
→ Clock Normalizer
→ EventTime
→ Arrival Queue
→ Per-source Watermark
→ Active-source Minimum Watermark
→ Sampling / Encoder
→ Fusion
→ Evidence Node
→ Claim
→ Belief
→ Plan
→ Action

Late Evidence
→ Original Event-Time Window
→ Dependency lookup
→ Claim revalidation
→ Belief Revision
→ Plan Revision
→ Action Recovery
```

### System architecture：Multimodal Evidence-Time Runtime

核心資料結構：

```text
EvidenceEvent {
  evidence_id
  source_id
  clock_domain
  source_time
  normalized_event_time
  arrival_time
  model_apply_time
  requested_sample_index?
  actual_sample_index?
  original_pts?
  transform_chain[]
  watermark_at_apply
}
```

```text
BeliefRevision {
  old_belief_id
  new_belief_id
  triggering_evidence_id
  contradiction_type
  affected_claim_ids[]
  affected_plan_ids[]
  action_status
}
```

## Bottom-Level Logic

### ReMA video path

```text
ffprobe avg_frame_rate
→ ffmpeg -vf fps=target_fps
→ raw BGR frames
→ JPEG encode
→ LMDB sequential frame_id
→ requested index = int(sec * fps_cached)
→ nearest frame fallback if key missing
→ synthetic relative timestamp = (requested fid-start_idx)/fps_cached
→ image + timestamp to VLM
→ caption
→ caption timestamp offset rewrite
→ memory.add([start,end], text)
```

重要差異：FFmpeg 官方文件說明 CFR/VFR 類同步策略可能 duplicate/drop frame，而 passthrough 才是沿用 demuxer timestamp；因此任何經 fps resampling 的 pipeline 都應顯式保存「media-native timestamp」與「sample-grid timestamp」兩種 identity。

### Watermark / late evidence mechanism

```text
maxObservedEventTime[source]
→ WatermarkStrategy(source)
→ W_source

W_fusion = min(W_active_sources)

if event.time <= W_fusion when it arrives:
    event = LATE
```

但 Agent policy 不應預設 drop：

```text
LATE
→ still relevant?
→ supports current belief: merge
→ contradicts current belief: revise
→ affects pending plan: re-plan
→ affects completed irreversible action: surface recovery/compensation
```

## Visual Simulation Idea

### Multimodal Watermark & Belief Revision Simulator

六條同步 lane：

```text
VIDEO EVENT TIME   F1 --- F2 --- F3 -------- F4
AUDIO EVENT TIME   A1 ------ A2 --- A3
ARRIVAL            F1 A1 F3 A2 ---- F2(late)
WATERMARK          W1 ---- W2 -------- W3
BELIEF             B1 -------- B2 ---- B3(revised)
ACTION              plan P1 ----- cancel → P2
```

Controls：VFR/CFR、fps resampling、clock drift、jitter、max out-of-orderness、idle source、allowed lateness、nearest-frame substitution、memory compression。點擊任何 belief 可反查 supporting evidence；注入 late frame 後即時顯示 Claim invalidation → Belief revision → Re-plan。

## Code / GitHub

### Recursive Multimodal Agent
Repository: https://github.com/cg1177/Recursive-Multimodal-Agent

本輪深讀：
- `utils/video_reader.py`
  - `_probe()`
  - `_get_fps()`
  - `_cache_to_lmdb()`
  - `sample_frames_by_fps()`
  - `cut_segment()` / audio extraction
- `utils/memory.py`
  - Mem0 + FAISS + embedding + LLM reranker config
- `utils/global_caption.py`
  - 1 fps global caption sampling
  - CaptionStore
  - caption → Mem0 import boundary

值得下一輪追：
- FFmpeg fps filter timestamp behavior on VFR fixture
- original PTS extraction path (`ffprobe -show_frames` / decoder timestamps)
- Mem0 record update/history semantics
- actual belief revision implementation versus simple memory append

## Papers / Technical Sources

1. **Timely Stream Processing / Event Time and Watermarks**, Apache Flink official documentation. Architecture concept: event-time timestamps + per-source watermarks + downstream minimum watermark + late-event policy. Contribution to Hermes: provides a tested vocabulary for completeness frontier under out-of-order streams. Limitation: dataflow semantics, not semantic belief revision.
2. **A Study of Belief Revision Postulates in Multi-Agent Systems (Extended Version)** — Michael Thielscher, Tran Cao Son, 2026, arXiv:2605.02249. Contribution: generalizes classical AGM belief revision postulates to multi-agent epistemic planning and studies iterated revision. Limitation: symbolic epistemic models, not multimodal timestamp/provenance runtime.
3. **FFmpeg Documentation** — official technical documentation. Relevant mechanism: passthrough/CFR/VFR timestamp/frame handling and frame duplication/drop semantics.

## 已確認 / 官方 / 論文 / 工程 / 推論 / 假說

**已確認工程實作：** ReMA `video_reader.py` 以 `-vf fps=` 建 LMDB cache；sample timestamp 由 cache index/fps 合成；nearest fallback 保存 actual index但 timestamp仍依 requested fid；global caption memory只保存 start/end/text等 metadata。

**官方資訊：** FFmpeg文件區分 passthrough、CFR、VFR的 timestamp/frame handling；Flink官方文件定義 event time、watermark、late event、allowed lateness與多輸入 minimum watermark。

**論文結果：** Thielscher/Son 2026研究 multi-agent belief revision postulates；其形式化結果可作 belief-revision correctness參考，但不是多模態 runtime benchmark。

**合理工程推論：** synthetic sample-grid timestamp若被 UI 當原始 PTS，VFR/dup/drop場景可能造成錯誤的 temporal provenance；需要 fixture 驗證誤差大小。

**尚未驗證假說：** 以 watermark-driven late-evidence revision gate 能顯著降低 streaming multimodal Agent 的 stale-belief action error；需建立 benchmark/fault injection。

## Unknown / Open Questions

1. ReMA 在真實 VFR / timestamp discontinuity影片上，synthetic timestamp 與 original PTS 最大偏差是多少？
2. 多模態 source watermark 應由 fixed bounded lateness、learned delay model、還是 device-specific SLA 產生？
3. Late evidence推翻已執行 action時，Agent recovery policy如何區分可補償、不可逆與安全關鍵行為？

## 下一輪研究

```text
Build VFR timestamp fixture model
→ original PTS
→ ffmpeg fps filter output
→ cached frame_id
→ ReMA synthetic timestamp
→ quantify drift / substitution

Then
Mem0 history/update semantics
→ belief append vs revise
→ provenance-preserving belief revision
→ dependent-plan invalidation
→ compensating action model
```

並比較 Dataflow/Flink watermark、robot sensor timestamp synchronization、streaming VLM token/slot timestamp 三層能否統一成 Hermes `EvidenceTime` IR。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `MediaNativeTimestamp`
- `SyntheticSampleTimestamp`
- `RequestedSampleIndex`
- `ActualSampleIndex`
- `SampleIdentitySubstitution`
- `ProvenanceCompressionBoundary`
- `EventTime`
- `PerSourceWatermark`
- `FusionWatermark`
- `LateEvidence`
- `AllowedLatenessPolicy`
- `EvidenceCompletenessFrontier`
- `BeliefDependency`
- `BeliefInvalidation`
- `PlanInvalidation`
- `CompensatingAction`

### Edges
```text
FFmpegFPSResampling → produces → SyntheticSampleTimestamp
OriginalFramePTS → differs_from → SyntheticSampleTimestamp
RequestedSampleIndex → may_substitute_to → ActualSampleIndex
CaptionCompression → drops_identity_of → SampleEvidence
PerSourceWatermark → contributes_to → FusionWatermark
FusionWatermark → defines → EvidenceCompletenessFrontier
LateEvidence → may_invalidate → Claim
Claim → supports → Belief
BeliefInvalidation → triggers → PlanInvalidation
PlanInvalidation → may_trigger → CompensatingAction
```

## 本輪結束判斷

- **缺哪一層：** 真實 media PTS / device clock → normalized EventTime 的可測量 clock mapping。
- **哪個節點最淺：** `CompensatingAction` 與 `WatermarkStrategyForAgent`。
- **哪個概念仍只是名詞：** learned/semantic watermark；目前沒有足夠證據可把它當可靠 completeness proof。
- **哪個系統值得讀原始碼：** FFmpeg fps filter timestamp path、Mem0 history/update、streaming VLM input scheduler。
- **哪篇論文需追引用：** multi-agent belief revision postulates，以及 Dataflow/event-time/watermark lineage。
- **哪個概念最適合視覺模擬：** Multimodal Watermark & Belief Revision Simulator。
- **哪個 Agent 架構最值得實作：** `Evidence-Time Gate → Claim → Belief Revision → Plan Invalidation → Recovery`，作為 ReAct/Plan-and-Execute 外層的 runtime correctness loop。

## 對「AI 到底怎麼運作」的新增鏈

```text
Camera / Mic / Video
→ Native PTS / Device Clock
→ Decode / Capture
→ Clock Normalization
→ Event Time
→ Watermark / Completeness Frontier
→ Sampling
→ Encoder
→ Multimodal Tokens
→ Fusion
→ Evidence
→ Claim
→ Belief
→ Reasoning / Planning
→ Action

Late Evidence
→ Claim Revalidation
→ Belief Revision
→ Re-plan / Recovery
```

核心結論：**多模態 Agent 不只需要知道 evidence 的 timestamp，還需要知道 timestamp 是原始媒體時間、重採樣後時間，還是 runtime 合成時間；並且必須有一個明確政策處理「以為已經看完整，後來卻有舊時間點 evidence 才抵達」的情況。Watermark 提供的是可操作的 completeness frontier，而 Belief Revision 才把 late evidence 轉成 Agent correctness。**