# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-13 17:51 Asia/Taipei  
**主題**：Asynchronous Multimodal Event-Time × Latent Clock Offset × Evidence Dependence × Late Observation Revision × Sequential Calibration

## 0. 與歷史研究比較 / 本輪避免重複

本輪承接上一輪：
- `2026-09-13-multimodal-observation-reliability-belief-update-calibration.md`
- `2026-09-13-state-abstraction-belief-state-pomdp-sequential-evidence.md`
- `2026-09-12-streaming-multimodal-predictive-state-active-perception-world-registers.md`

上一輪已處理：missing modality、staleness、cross-modal conflict、per-modality reliability、modality-mask calibration、Evidence Lineage DAG 的概念。

**本輪不重複「缺模態/衝突怎麼融合」，而往下一層處理：不同 observation 根本不是同一個時間點、時間戳本身可能有偏差、事件會晚到，而且相依來源不能被當成獨立 evidence 重複計算。**

新的核心問題：

```text
Camera @ event-time 10.02
Voice  @ event-time 10.31
DOM    @ event-time 10.40
Tool   @ event-time 11.18

arrival-time 又可能是：
10.20 / 10.35 / 10.90 / 11.21

↓
哪一些 observation 描述的是「同一個世界狀態」？
↓
clock offset / transport delay / processing latency / stale state
↓
如何對齊、何時允許 fusion、晚到 evidence 是否能改寫既有 belief / permission？
```

---

# 1. 本小時新發現

## 1.1 System architecture：Event Time 必須與 Processing / Arrival Time 分離

Apache Flink 的 event-time runtime 提供一個非常適合 Agent multimodal runtime 借用的工程抽象：**event time 是事件在來源端實際發生的時間，而 processing time 是 runtime 實際處理它的時間；watermark 用來表示 event-time 的進度，並明確允許 out-of-order / late events。**

來源：
- https://nightlies.apache.org/flink/flink-docs-stable/docs/concepts/time/

ROS 2 `message_filters.ApproximateTimeSynchronizer` 也明確根據 message header timestamp 做 approximate synchronization，提供 `slop` 與 subscriber `queue_offset`；官方文件特別警告，不應優先改用 arrival time，因為 arrival delay 不可預測。

來源：
- https://docs.ros.org/en/ros2_packages/rolling/api/message_filters/message_filters.html

對 Hermes 的直接結論：

```text
Observation.timestamp
不能只有一個欄位。
```

至少需要：

```text
ObservationClock
├ source_event_time
├ source_clock_id
├ source_clock_uncertainty
├ ingest_time
├ processing_time
├ estimated_transport_delay
├ estimated_clock_offset
├ corrected_event_time
└ lateness_class
```

核心否定：

```text
Arrival Time
≠ Event Time

Same Processing Batch
≠ Same World State
```

---

## 1.2 Bottom-level mechanism：時間偏移應視為 latent parameter，而不是固定 preprocessing 常數

**Paper**：Temporal and Rotational Calibration for Event-Centric Multi-Sensor Systems  
**Authors**：Jiayao Mai, Xiuyuan Lu, Kuan Dai, Shaojie Shen, Yi Zhou  
**Year**：2025  
**URL**：https://arxiv.org/abs/2508.12564  
**Code**：https://github.com/NAIL-HNU/EvMultiCalib

論文架構不是先假設 event camera / RGB / LiDAR / IMU 已同步，而是：

```text
heterogeneous sensor motion observations
↓
initial temporal / rotational alignment
↓
continuous-time motion representation
↓
joint nonlinear optimization
↓
estimated time offset + extrinsic rotation
```

本輪直接讀 GitHub，而不是只看 README。Repository `src/` 實際包含：

```text
src/
├ calibration.cpp
├ event_angular_velocity_estimator.cpp
├ lidar_rotation_estimator.cpp
├ normal_flow.cpp
├ rgb_rotation_estimator.cpp
├ ros_node.cpp
└ utils.cpp
```

`include/calibration.h` 保存 `imu_time_offset_ / rgb_time_offset_ / lidar_time_offset_`；`calibration.cpp` 將 `time_offset_bound_` 傳入 angular-velocity cost functor，並透過 Ceres nonlinear optimization 共同估計；`config/calib_params.yaml` 也顯式包含 `time_offset_bound` 與 spline knot interval。

這代表對 Hermes 而言：

```text
voice_delay = 300ms
```

不應永遠只是硬編碼 metadata，而可能是需要持續估計的 latent state：

```text
Δ_camera(t)
Δ_voice(t)
Δ_tool(t)
Δ_remote_agent(t)
```

尤其 network / browser / MCP / remote agent 的 delay 會漂移。

---

## 1.3 新論文：Asynchronous fusion 應 joint-estimate temporal misalignment

**Title**：Target Tracking in Asynchronous Sensor Networks Under Temporal Misalignment  
**Venue**：IEEE Transactions on Signal Processing  
**Year**：2026  
**Publication date**：2026-03-04  
**DOI**：10.1109/TSP.2026.3670489  
**URL**：https://ieeexplore.ieee.org/document/11421001/

該工作處理 temporal misalignment 未知的 asynchronous sensor network，將時間 offset 與 multi-sensor fusion 放在同一個 inference problem 中，以 logarithmic opinion pool 融合並透過 MAP 估計 time offset；同時討論 recursive centralized / distributed fusion。

改變 Hermes 的地方：

```text
先對齊時間
→ 再 fusion
```

並不總是合理。

更一般的形式是：

```text
p(x_t, Δ_1,...,Δ_M | observations)
```

也就是 **state 與 clock-offset posterior 一起更新**。

限制：這是 tracking / sensor-density framework，不能直接宣稱適用 LLM/VLM/Tool observation；但它提供可驗證的底層模式：temporal offset 是 inference variable，而非永遠已知的 preprocessing parameter。

---

## 1.4 Evidence Dependence：未知相關性時，不能 naïve product / repeated Bayes update

上一輪建立了 Evidence Lineage DAG，但本輪補上真正的 fusion 問題：即使兩份 observation 的來源名稱不同，也可能存在未知 correlation。

2025 IEEE SSP 的 **Generalising Covariance Intersection for multiple posterior densities in multi-sensor fusion** 研究多 posterior fusion，在 measurement error 高相關或 correlation 不確定時比較 generalized covariance-intersection 類方法；其核心工程意義是：**若不知道 cross-source correlation，直接把 posterior 當獨立來源相乘會過度自信。**

來源：
- https://discovery.ucl.ac.uk/id/eprint/10217482/
- DOI: 10.1109/SSP64130.2025.11073391

對 Hermes 最典型的 double-counting：

```text
Screenshot S
├→ OCR(S)
├→ VLM Caption(S)
├→ UI Detector(S)
└→ LLM summary(OCR(S), Caption(S))
```

如果 runtime 做：

```text
posterior × OCR evidence × caption evidence × detector evidence × summary evidence
```

等於把同一個原始 pixel event 重複放大。

因此本輪把 `EvidenceLineageDAG` 升級成：

```text
EvidenceDependenceGraph
├ common_ancestor_event
├ derivation_edges
├ conditional_independence_claims
├ unknown_correlation_groups
├ shared_model_ancestor
├ shared_prompt_ancestor
└ fusion_policy
```

新規則：

```text
Different Model Outputs
≠ Independent Evidence

Different Modalities
≠ Independent Evidence Automatically
```

---

## 1.5 Sequential calibration：長期 coverage 不等於當下每個 belief update 都 calibrated

本輪比較兩類 online conformal work：

### Error-quantified Conformal Inference (ICLR 2025)
Authors：Junxi Wu, Dongjian Hu, Yajie Bao, Shu-Tao Xia, Changliang Zou  
URL：https://proceedings.iclr.cc/paper_files/paper/2025/hash/cab5ae2704d3e01f06a92512a5376b87-Abstract-Conference.html

它對 temporal dependence / distribution shift 下的 online intervals，以 error-quantified feedback 更新 threshold，提供 long-term coverage guarantee。

### Online Localized Conformal Prediction (2026)
Authors：Yuheng Lai, Garvesh Raskutti  
URL：https://www.alphaxiv.org/abs/2605.05497v1

它將 online adaptation 與 covariate-localized calibration 結合，避免單一 global calibration 對 heterogeneous regimes 過度粗糙。

對 Hermes 的真正結論不是「直接套 conformal 就安全」，而是要保存 guarantee semantics：

```text
CalibrationGuarantee
├ FINITE_SAMPLE_EXCHANGEABLE
├ GROUP_CONDITIONAL_MASK
├ LONG_RUN_ONLINE_COVERAGE
├ LOCALIZED_LONG_RUN_COVERAGE
├ FIXED_HORIZON_ONLY
└ UNVERIFIED
```

因為：

```text
long-run 95% coverage
≠ 每一次 permission decision 都有 95% conditional correctness
```

尤其晚到 observation 導致 belief revision 時，舊 calibration score 是否仍屬同一 regime，需要重新判斷。

---

# 2. 本小時最重要 5 個發現

## 發現 1 — Agent 需要 Event-Time Runtime，而不只是 async queue

一般 Agent runtime 常記：

```text
received_at
processed_at
```

但 multimodal belief 真正需要：

```text
world event time
source clock
clock uncertainty
offset estimate
arrival delay
processing delay
```

否則一個 800 ms 前的 screenshot 與現在的 DOM/tool state 可能被錯當同時證據。

---

## 發現 2 — Temporal alignment 本身是一個 inference problem

底層模型可以寫成：

```text
o_m ~ p_m(o | x(t_m - Δ_m))
```

其中：
- `x(t)`：continuous-time latent world state
- `t_m`：source timestamp
- `Δ_m`：source clock / transport offset

若 `Δ_m` 不確定，正確 belief 更接近：

```text
p(x_t | o)
=
∫ p(x_t, Δ | o) dΔ
```

而不是用單一 point-aligned frame 強制 fusion。

---

## 發現 3 — Late evidence 不是單純「過期資料」；它可能要求 belief revision

Flink watermark 的工程啟發很重要：runtime 可以宣告「event time 已前進」，但仍可能有 late event，因此系統必須定義 late-event policy。

Hermes 應增加：

```text
LateObservationPolicy
├ IGNORE_FOR_CURRENT_ACTION
├ UPDATE_MEMORY_ONLY
├ REVISE_CURRENT_BELIEF
├ INVALIDATE_CERTIFICATE
├ TRIGGER_COUNTERFACTUAL_REPLAY
└ HUMAN_REVIEW
```

例如：

```text
10:00 screenshot → auth valid
10:01 WRITE_EXTERNAL allowed
10:02 late tool event arrives，event_time=09:59.8
      auth actually revoked
```

這不只是 staleness，而可能觸發上一系列研究建立的 certificate invalidation / replay graph。

---

## 發現 4 — Dependence graph 必須決定 fusion operator

新的 Fusion Router 不只看 modality type，而要看 dependence regime：

```text
DependenceRegime
├ CONDITIONALLY_INDEPENDENT
├ KNOWN_COVARIANCE
├ UNKNOWN_CORRELATION
├ SAME_ORIGIN_DERIVATION
├ SHARED_MODEL_DEPENDENCE
└ UNRESOLVED
```

對應：

```text
independent      → product / Bayesian update candidate
known covariance → joint Gaussian / explicit joint likelihood
unknown corr.    → covariance-intersection / conservative fusion class
same-origin      → lineage-aware de-dup / single evidence family
unresolved       → do not claim confidence gain
```

---

## 發現 5 — Calibration 也要跟「時間 regime」一起路由

上一輪已有 modality-presence mask：

```text
CAMERA + TOOL + TEXT
```

本輪補成：

```text
CalibrationContext
├ modality_mask
├ delay_bucket
├ lateness_regime
├ clock_offset_uncertainty
├ conflict_bucket
├ dependence_regime
└ environment_epoch
```

也就是：

```text
Same modality subset
≠ Same calibration regime
```

Camera+Tool 同時到達，和 Camera 晚 2 秒、Tool 晚 50 ms，不應自動共用同一 confidence interpretation。

---

# 3. Architecture Breakdown

## Event-Time Multimodal Evidence Runtime

```text
Camera / Audio / UI / DOM / Tool / MCP / Remote Agent
↓
Observation Ingress
├ source event timestamp
├ source clock id
├ ingest timestamp
├ processing timestamp
└ raw provenance
↓
Clock & Delay Estimator
├ clock offset posterior
├ transport delay posterior
├ jitter
└ drift
↓
Event-Time Normalizer
↓
Watermark / Lateness Manager
├ on-time
├ bounded-late
├ severely-late
└ clock-uncertain
↓
Evidence Lineage + Dependence Graph
├ common source ancestors
├ derivative observations
├ shared models/prompts
└ correlation regime
↓
Temporal Alignment Router
├ exact timestamp match
├ approximate window
├ continuous-time interpolation
├ latent-offset marginalization
└ NO_ALIGNMENT
↓
Fusion Router
├ independent likelihood
├ joint likelihood
├ covariance-aware fusion
├ conservative unknown-correlation fusion
├ conflict-preserving fusion
└ no-fusion / active re-observe
↓
Belief Revision Engine
↓
Sequential Calibration Router
↓
Belief / Permission Certificate
↓
ALLOW / VERIFY / ASK / REFRESH / BLOCK
```

---

# 4. Bottom-Level Logic

## 4.1 四種時間不能混成一個 timestamp

對 observation `o_i`：

```text
t_event   = world/source event time
t_ingest  = runtime receives data
t_process = model actually processes data
t_action  = action consuming the belief
```

估計：

```text
delay_i = t_ingest - t_event_corrected
age_at_action = t_action - t_event_corrected
```

而 source clock correction：

```text
t_event_corrected
=
t_source + Δ_clock(t_source)
```

若 `Δ_clock` 不是確定值，則 alignment 本身帶 uncertainty。

## 4.2 Asynchronous belief update

不是：

```text
concat(o_camera, o_voice, o_tool)
→ Transformer
```

而更接近：

```text
predict state from previous event time τ_prev to τ_i
↓
receive o_i at corrected event time τ_i
↓
check lineage/dependence
↓
measurement update
↓
advance event-time belief
```

對晚到 observation `o_j` 且 `τ_j < current_watermark`：

```text
late observation
↓
check revision horizon
↓
reconstruct state at τ_j
↓
apply evidence
↓
propagate corrected belief forward
↓
diff certificates / actions
```

這和 earlier research 的 counterfactual replay 接起來。

## 4.3 Dependence-aware evidence accumulation

錯誤：

```text
P(H|OCR) × P(H|VLM-caption) × P(H|detector)
```

如果三者都有共同 ancestor screenshot `S`。

應先查：

```text
EvidenceDependenceGraph
```

如果：

```text
OCR ← S
Caption ← S
Detector ← S
```

則三者屬於：

```text
EvidenceFamily(S)
```

可以融合 feature / inference，但不能無條件宣稱獲得三份獨立 statistical evidence。

---

# 5. Visual Simulation Idea

# Asynchronous Evidence Timeline × Lineage DAG × Belief Revision Lab

主畫面分三層。

### Layer A — Event Time vs Arrival Time

```text
World/Event time
09.90 ─ Camera frame A
10.00 ─ Auth revoked
10.05 ─ DOM update
10.10 ─ Voice command

Arrival time
10.02 ─ Camera frame A arrives
10.12 ─ Voice arrives
10.15 ─ DOM arrives
10.80 ─ Auth revoke tool-event arrives  ⚠ LATE
```

使用者可以拖曳 delay / jitter / clock offset。

### Layer B — Evidence Lineage

```text
Screenshot A
├→ OCR
├→ VLM Caption
└→ UI Detector

Tool Auth Event ─ independent source? → check shared backend lineage
```

UI 即時顯示：

```text
Independent evidence count: 2
Derived evidence views: 3
Unknown-correlation group: 1
```

### Layer C — Belief / Permission Revision

```text
Before late event:
P(auth_valid)=.91
WRITE_EXTERNAL → ALLOW

Late auth-revoke arrives:
P(auth_valid)=.07
WRITE_EXTERNAL → BLOCK

Historical certificate:
SUPERSEDED

External action already executed:
COMPENSATION REQUIRED
```

這個 simulator 能把過去幾輪的 `Event Ledger → Evidence Lineage → Belief → Certificate → Replay / Compensation` 真正串成一條可視化世界線。

---

# 6. Code / GitHub

## EvMultiCalib

Repository：https://github.com/NAIL-HNU/EvMultiCalib

本輪已直接追入：

```text
src/calibration.cpp
src/event_angular_velocity_estimator.cpp
src/lidar_rotation_estimator.cpp
src/rgb_rotation_estimator.cpp
src/normal_flow.cpp
include/calibration.h
include/optimization_cost_functor.h
config/calib_params.yaml
```

值得繼續看的核心：
1. `include/optimization_cost_functor.h`：time-offset 如何進入 continuous-time control-point selection / residual。
2. `src/calibration.cpp`：initial correlation → Ceres joint optimization 的完整控制流。
3. `src/event_angular_velocity_estimator.cpp`：event stream 如何轉成可與其他 sensor 比較的 motion evidence。
4. `src/ros_node.cpp`：runtime 如何輸出 calibration state。

Hermes 可借用的不是 calibration domain 本身，而是其架構原則：

```text
clock offset
不是 metadata 常數
而是可以被觀測、估計、更新、持久化的 state
```

---

# 7. Papers

## Paper A
**Title**：Target Tracking in Asynchronous Sensor Networks Under Temporal Misalignment  
**Venue**：IEEE Transactions on Signal Processing  
**Year**：2026  
**DOI**：10.1109/TSP.2026.3670489  
**Architecture**：asynchronous multi-sensor densities → temporal offset inference → logarithmic opinion-pool fusion → recursive tracking  
**Contribution**：將未知 temporal misalignment 與 fusion 聯合估計。  
**Limitation**：tracking density setting；不是 LLM-Agent theorem。

## Paper B
**Title**：Temporal and Rotational Calibration for Event-Centric Multi-Sensor Systems  
**Authors**：Jiayao Mai, Xiuyuan Lu, Kuan Dai, Shaojie Shen, Yi Zhou  
**Year**：2025  
**Code**：https://github.com/NAIL-HNU/EvMultiCalib  
**Architecture**：event normal flow / heterogeneous rotation estimates → temporal/extrinsic initialization → continuous-time joint nonlinear refinement  
**Contribution**：不需要把 event camera 強制轉成 frame，再共同求 clock offset / rotation。  
**Limitation**：rigid sensor calibration；不能直接處理 semantic Tool / Voice event。

## Paper C
**Title**：Generalising Covariance Intersection for multiple posterior densities in multi-sensor fusion  
**Venue**：IEEE SSP 2025  
**DOI**：10.1109/SSP64130.2025.11073391  
**Contribution**：多 posterior、未知/高 correlation 下的 conservative fusion 思路。  
**Limitation**：posterior density fusion，不等同 neural evidence-lineage theorem。

## Paper D
**Title**：Error-quantified Conformal Inference for Time Series  
**Venue**：ICLR 2025  
**Contribution**：arbitrary temporal dependence / distribution shift 下以 continuous error feedback 做 online conformal threshold adaptation，提供 long-term coverage。  
**Limitation**：long-run coverage 不能被誤讀為每一次 Agent permission 都有 conditional guarantee。

## Paper E
**Title**：Online Localized Conformal Prediction  
**Authors**：Yuheng Lai, Garvesh Raskutti  
**Year**：2026  
**Contribution**：online adaptation + localized calibration，處理 covariate heterogeneity。  
**Limitation**：尚不能直接提供 asynchronous multimodal belief revision 的完整 certificate semantics。

---

# 8. 已確認 / 推論 / 未驗證假說

## 已確認事實
- Event time 與 processing / arrival time 在成熟 streaming runtime 中是不同概念，watermark 用於 out-of-order event-time progress。
- ROS ApproximateTime 使用 header timestamps 與可配置 slop / offset，而非把 arrival time 當理想同步來源。
- EvMultiCalib 原始碼確實保存與優化多 sensor time offsets。
- asynchronous multi-sensor fusion 文獻會直接把 temporal misalignment 視為需要估計的量。
- 未知 correlation 下的 posterior fusion不能安全地假設獨立性。

## 工程推論
- Hermes 應把 watermark / lateness / clock-offset posterior 引進 multimodal observation runtime。
- Evidence Lineage DAG 應升級為 Dependence Graph，並實際驅動 fusion operator。
- Late observation 應與既有 certificate supersession / replay / compensation runtime 連接。

## 尚未驗證假說
- 能否建立一個同時處理 uncertain timestamp、unknown cross-modal correlation、late-event revision、optional stopping 的統一 e-process / conformal certificate？
- LLM/VLM semantic evidence 的「same-origin dependence」應如何定量，而不只是 provenance rule？
- clock-offset posterior 的 uncertainty 應如何傳到高風險 Tool/MCP permission threshold？

---

# 9. Unknown / Open Questions

1. **Delayed / late labels 下的 sequential calibration**：當 ground-truth 或高可信 tool evidence 晚到，過去的 calibration state 要 forward update、retroactive revise，還是開新 epoch？
2. **Semantic dependence quantification**：相同 screenshot 經 OCR、VLM、LLM summary 之後，其有效 evidence number 應怎麼定義？
3. **Clock uncertainty → belief certificate**：時間 offset posterior 很寬時，應把 state posterior 展寬、降低 action permission，還是先主動重新同步 / observation？

---

# 10. 下一輪研究

下一輪應正式研究：

# Late Evidence Revision × Delayed Feedback × Revision-Safe Sequential Calibration × Belief Certificate Supersession

鏈路：

```text
Event-time ledger
↓
watermark
↓
permission certificate issued
↓
late multimodal observation / delayed ground truth arrives
↓
revision admissibility
↓
recompute local belief
↓
propagate belief forward
↓
re-evaluate calibration state
↓
certificate supersession / invalidation
↓
action compensation if necessary
```

優先尋找：
- delayed-feedback online conformal inference
- asynchronous / delayed martingale updates
- revision-aware stream processing
- out-of-sequence measurement Kalman / Bayesian filtering
- delayed sensor fusion / OOSM
- online calibration under delayed labels

---

# 11. Knowledge Graph 新增 Node / Edge

## Nodes

```text
Event Time
Arrival Time
Processing Time
Action Consumption Time
Source Clock
Clock Offset Posterior
Clock Drift
Transport Delay
Jitter
Corrected Event Time
Watermark
Late Observation
Lateness Policy
Revision Horizon
Out-of-Sequence Measurement
Event-Time Belief Update
Temporal Alignment Router
Latent Offset Marginalization
Evidence Dependence Graph
Evidence Family
Common Ancestor Event
Unknown Correlation Group
Same-Origin Dependence
Shared-Model Dependence
Dependence Regime
Conservative Fusion
Calibration Context
Delay-Bucket Calibration
Lateness-Regime Calibration
Belief Revision Event
Temporal Permission Certificate
```

## Edges

```text
Arrival Time ≠ Event Time
Same Processing Batch ≠ Same World State
Approximate Timestamp Match ≠ True Synchronization
Known Timestamp ≠ Known Clock Offset
Different Model Outputs ≠ Independent Evidence
Different Modalities ≠ Independent Evidence Automatically
Same-Origin Derived Views ≠ Multiple Independent Observations
Long-Run Coverage ≠ Per-Decision Conditional Correctness
Late Observation ≠ Irrelevant Observation
Watermark Passed ≠ No Correction Ever Allowed
Alignment Confidence ≠ Sensor Reliability
Clock Calibration ≠ Semantic State Calibration
```

---

# 12. 本輪結束判定

**缺哪一層**：`Late Evidence Revision / Delayed Calibration / Revision-Safe Belief Certificate`。  
**哪個節點最淺**：`Semantic Dependence Quantification`、`ClockOffsetPosterior → Permission`、`Lateness-Regime Calibration`。  
**哪個概念仍只是名詞**：production 級 `Conflict/Dependence-Aware Sequential Multimodal Certificate`。  
**哪個系統值得讀原始碼**：`NAIL-HNU/EvMultiCalib`，尤其 `optimization_cost_functor.h` 與 `calibration.cpp`。  
**哪篇論文需追引用**：`Target Tracking in Asynchronous Sensor Networks Under Temporal Misalignment`，因為它直接把 temporal offset 納入 fusion inference。  
**哪個概念最適合視覺模擬**：`Asynchronous Evidence Timeline × Lineage DAG × Belief Revision Lab`。  
**哪個 Agent 架構最值得實作**：

```text
Observation Ingress
↓
Clock / Delay Estimator
↓
Event-Time Normalizer + Watermark
↓
Evidence Dependence Graph
↓
Temporal / Dependence-Aware Fusion Router
↓
Belief Revision Engine
↓
Sequential Calibration Router
↓
Permission Gate
```

本輪對「AI 到底怎麼運作」新增的核心結論：

> **Multimodal Agent 並不是在同一瞬間拿到 Camera、Voice、DOM、Tool 與 MCP。每一份 observation 都帶著自己的 event time、clock bias、transport delay、processing delay 與來源依賴。AI 若先忽略時間與 lineage，再把所有 embedding 融合，會同時犯兩種錯：把不同世界狀態當成同一狀態，以及把同一原始事件的衍生證據重複計算。真正可驗證的 multimodal runtime 必須先建立 event-time / clock-offset / dependence contract，才允許 evidence 改變 belief 與行動權限。**
