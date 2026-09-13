# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-13 18:55 Asia/Taipei  
**主題**：Late Evidence Revision × Delayed Feedback Calibration × Certificate Supersession × Feedback Corruption Repair × Revision-Safe Agent Runtime

## 0. 與歷史研究比較 / 本輪避免重複

本輪承接：
- `2026-09-13-asynchronous-multimodal-event-time-dependence-sequential-calibration.md`
- `2026-09-13-multimodal-observation-reliability-belief-update-calibration.md`
- `2026-09-13-state-abstraction-belief-state-pomdp-sequential-evidence.md`
- 先前 append-only ledger / counterfactual replay / certificate invalidation 系列研究。

上一輪已完成：Event Time vs Arrival Time、clock offset posterior、watermark、late observation、Evidence Dependence Graph、dependence-aware fusion、event-time belief revision 的概念層。

**本輪不再研究「晚到資料是什麼」，而研究晚到 truth / feedback 到達之後，如何安全修復 calibration state、belief、permission certificate 與 downstream action history。**

核心問題：

```text
Prediction / Agent decision at t
↓
certificate issued
↓
action executed
↓
feedback not yet available
↓
future thresholds / beliefs continue updating
↓
late truth arrives at t+τ
↓
它應更新「現在」？
還是回寫「當時」？
是否要重播中間 calibration state？
已發出的 certificate 是否 supersede？
已執行外部 action 是否補償？
```

---

# 1. 本小時新發現

## 1.1 新論文：Adaptive Conformal Inference Under Delayed Feedback

**Title**: Adaptive Conformal Inference Under Delayed Feedback: Coverage Guarantees and a Delay-to-Memory Diagnostic  
**Authors**: Lama El Halabi, Adam Brandt  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2609.07251  
**Code**: 本輪未找到公開 runtime code；第三方索引仍標示 Request Code。  
**Dataset**: 主要為 AR(1)、GARCH(1,1)、Markov switching、abrupt mean/variance shift 等 simulation regimes。  
**Architecture**: delayed ACI recursion → τ interleaved ACI-like sequences → delay-aware coverage analysis。  
**Contribution**: 給出 finite-sample long-run empirical coverage bound，並提出 delay-to-memory ratio `r = τ/L`。  
**Limitations**: `r` 對不同 temporal dependence 的解釋力並不一致；結果是 ACI delayed-feedback theorem，不等於任意 Agent certificate rollback theorem。

這篇的核心不是「延遲會變差」這種一般結論，而是把固定 horizon `τ` 的 delayed update 拆成 **τ 條交錯更新流**：

```text
τ = 3

thread 0: 0 → 3 → 6 → 9 ...
thread 1: 1 → 4 → 7 → 10 ...
thread 2: 2 → 5 → 8 → 11 ...
```

這表示 delayed calibration 的正確 runtime abstraction 不一定是：

```text
所有 feedback 一到
→ 直接改 global threshold
```

而可以是：

```text
prediction round
↓
assign feedback lane / horizon class
↓
late truth arrives
↓
只更新對應 calibration thread
↓
thread state 再參與下一次 threshold construction
```

對 Hermes 的直接影響：需要 `DelayedFeedbackLane`，而不能只在 observation 上放 `delay_ms`。

來源：
- https://arxiv.org/abs/2609.07251

---

## 1.2 Bottom-level mechanism：延遲與系統記憶時間尺度的比值才是真正風險指標

論文提出：

```text
r = τ / L
```

其中：
- `τ`：feedback delay / prediction horizon
- `L`：驅動 non-exchangeability 的 residual memory time scale

直觀上：

```text
τ << L
→ truth 雖晚，但到達時過去 residual pattern 仍具資訊

τ ≈ L
→ feedback 開始接近過期

τ >> L
→ truth 到達時，當前 environment 可能已經換 regime
```

因此 Hermes 應新增：

```text
FeedbackUsefulness
├ delay
├ estimated_memory_timescale
├ delay_to_memory_ratio
├ environment_epoch_at_prediction
├ environment_epoch_at_feedback
└ revision_scope
```

重要否定：

```text
Late truth
≠ Always useful current calibration evidence
```

一筆 truth 可以仍然是「當時 decision 是否正確」的 factual evidence，但已不一定適合直接調現在的 threshold。

---

## 1.3 新論文：Online Conformal Prediction with Corrupted Feedback

**Title**: Online Conformal Prediction with Corrupted Feedback  
**Authors**: Bowen Wang, Matteo Zecchin, Osvaldo Simeone  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2605.20515  
**Code**: 本輪未確認官方 code repository。  
**Dataset**: 文中包含 CIFAR-100 classification 等 real-world experiments。  
**Architecture**: OCP threshold update → corrupted binary feedback → F-ROCP filtering / AC-ROCP active compensation。  
**Contribution**: 顯式分析 corrupted coverage feedback 如何污染 OCP，並提出 filtering 與 active compensation 兩種 robust scheme，給出 explicit miscoverage guarantees。  
**Limitations**: corruption model 聚焦 coverage-indicator corruption；不能直接視為 multimodal semantic correction 或 causal replay 的完整解法。

標準 OCP 的底層 update 是：

```text
e_t = 1{Y_t ∉ C_t(X_t; r_t)}

g_t = α - e_t

r_{t+1}
= r_t - η g_t
```

如果真正 feedback `e_t` 被污染成 `ē_t`：

```text
ḡ_t = α - ē_t
```

那麼錯誤不是只存在 dashboard label，而是**直接進 threshold state machine**。

文中 theorem 顯示 miscoverage bound 額外受到 feedback flip imbalance 影響；換言之：

```text
wrong feedback
↓
wrong gradient
↓
wrong threshold
↓
future prediction sets change
↓
future feedback distribution / action changes
```

因此 Hermes 不能把：

```text
feedback corrected
```

只實作成：

```text
UPDATE feedback_row
SET correct = true
```

而應標示 calibration descendants。

來源：
- https://arxiv.org/abs/2605.20515

---

## 1.4 Delayed feedback、missing feedback、corrupted feedback 必須分開

另有 2025 的 **Mirror Online Conformal Prediction with Intermittent Feedback**，研究的是 feedback 不一定每次可取得，但仍希望保留 long-term coverage 與 sub-linear regret。

來源：
- https://arxiv.org/abs/2503.10345

本輪因此建立新的 feedback taxonomy：

```text
FeedbackRegime
├ ON_TIME_TRUSTED
├ DELAYED_TRUSTED
├ INTERMITTENT_MISSING
├ PARTIAL_SELECTION_BIASED
├ CORRUPTED
├ REVISED_AFTER_CORRUPTION
└ UNKNOWN
```

這些狀態不能共用同一個 repair policy：

```text
DELAYED_TRUSTED
→ schedule / lane-aware update

INTERMITTENT_MISSING
→ missing-feedback algorithm

CORRUPTED
→ filter / compensate / quarantine

REVISED_AFTER_CORRUPTION
→ historical state repair + supersession
```

核心否定：

```text
No feedback yet
≠ Negative feedback

Late feedback
≠ Corrupted feedback

Corrected corrupted feedback
≠ Ordinary delayed feedback
```

---

## 1.5 System architecture：Staggered Integral OCP 提供可直接抄進 Agent runtime 的 thread pattern

**GitHub**: https://github.com/dcherenson/staggered-integral-ocp

這個 repo 不只有 README；root 目前可見：

```text
controller.py
main.py
ocp.py
plant.py
ssml.py
test_ocp.py
scenarios/
```

其中 `ocp.py` 的 `StaggeredDriftScoreOCP` 真正保存：

```text
self.N = N_threads
self.qs = per-thread quantiles
self.k_step
```

更新時：

```text
j = k_step % N
indicator = 1{S_k > q_j}
q_j ← max(0, q_j + η(indicator - α))
k_step += 1
```

也就是每個 horizon / phase 使用自己的 calibration thread，避免 prediction 與其 eventual truth realization 在同一 update lane 中重疊。

這是很值得 Hermes 借用的 production pattern：

```text
DelayedCalibrationRuntime
├ lane_count
├ lane_selector
├ per_lane_threshold_state
├ outstanding_feedback_registry
├ truth_arrival_router
└ lane_merge_policy
```

來源：
- https://github.com/dcherenson/staggered-integral-ocp
- https://github.com/dcherenson/staggered-integral-ocp/blob/main/ocp.py
- https://dasc-lab.github.io/papers/2026/2026-siocp/

但要注意：它處理的是特定 control / integral drift-score setting，不代表把 Agent feedback 任意 modulo 分 thread 就自動有 theorem guarantee。

---

# 2. 本小時最重要 5 個發現

## 發現 1 — Revision 應該是 append-only event，不是 overwrite

### 是什麼
一筆 truth 晚到或先前 feedback 被修正時，不應直接覆寫過去紀錄。

### 底層如何運作

```text
PREDICTION_ISSUED
CERTIFICATE_ISSUED
ACTION_EXECUTED
FEEDBACK_PENDING
...
FEEDBACK_RECEIVED_LATE
REVISION_EVENT
CALIBRATION_REPAIR_STARTED
CERTIFICATE_SUPERSEDED
```

### 為什麼重要
否則無法回答：
- 系統當時為什麼做那個 action？
- 當時可用資訊是什麼？
- 新 truth 改變了哪一段 state？

### 限制
Append-only 只保證 auditability，不自動提供 statistical validity。

---

## 發現 2 — Late truth 有兩個時間角色：historical truth 與 current calibration signal

### 是什麼
同一筆晚到 truth 可以：
1. 修正過去 decision 的 factual correctness；
2. 作為現在 threshold adaptation 的一筆 training/calibration signal。

兩者不能混成同一件事。

### 底層如何運作

```text
truth_at_event_time
↓
Historical Revision Engine

truth_arrival_at_now
↓
Calibration Admission Gate
├ memory-timescale check
├ environment-epoch check
└ delay regime
```

### 為什麼重要
即使 truth 對歷史是 100% 正確，若 environment 已變，它可能不適合直接推動 current threshold。

### 限制
memory timescale `L` 本身需要估計，且依 dependence regime 改變。

---

## 發現 3 — 修 calibration state 必須追 state descendants

### 是什麼
若先前錯誤 feedback 已經更新 threshold，後續 threshold 都可能受到污染。

### 底層如何運作

```text
feedback_t
↓
threshold_{t+1}
↓
prediction set_{t+1}
↓
feedback_{t+1}
↓
threshold_{t+2}
```

這其實是一條 calibration-state dependency graph。

### 為什麼重要
只修 `feedback_t` 不等於修 `threshold_{t+1:}`。

### 限制
如果 prediction sets 又改變 human/tool behavior，就會升級成前幾輪已研究的 causal replay 問題。

---

## 發現 4 — Staggered lanes 是 delayed feedback runtime 的強工程模式

### 是什麼
把 delay/horizon 相同的 feedback 放進獨立 state lane。

### 底層如何運作

```text
round t
↓
lane = t mod τ
↓
issue prediction using lane state
↓
τ steps later truth arrives
↓
update same lane
```

### 為什麼重要
它避免一個尚未取得 truth 的 prediction state 被後面 unrelated feedback 混亂更新。

### 限制
只在相符 theorem assumptions / fixed horizon structure 下成立；Agent tool feedback 常是 variable delay。

---

## 發現 5 — Certificate 必須有 supersession semantics

### 是什麼
舊 certificate 不能在 late evidence 到達後悄悄改內容；需要保留版本關係。

### 底層如何運作

```text
Certificate C17
status = ISSUED
↓
late truth F22
↓
recompute
↓
Certificate C31
supersedes = C17

C17.status = SUPERSEDED
```

若 C17 曾授權外部 action：

```text
C17
↓ authorized
WRITE_EXTERNAL #42
↓
late evidence invalidates C17
↓
CompensationPlanner
```

### 為什麼重要
把 uncertainty research 真正接到 Tool/MCP real-world effects。

### 限制
supersession 不等於能 undo 世界；外部不可逆 action 只能補償或人工處置。

---

# 3. Architecture Breakdown

```text
Prediction / Agent Decision
↓
Certificate Issuance
↓
Pending Feedback Registry
├ prediction_event_time
├ expected_feedback_time
├ feedback_lane
├ environment_epoch
└ certificate_id
↓
Agent continues operating
↓
Feedback Arrival Router
├ ON_TIME
├ DELAYED
├ INTERMITTENT
├ CORRUPTED_SUSPECTED
└ CORRECTION
↓
Feedback Admission Gate
├ identity match
├ event-time match
├ corruption screening
├ delay-to-memory diagnostic
└ epoch compatibility
↓
Revision Router
├ CURRENT_UPDATE_ONLY
├ HISTORICAL_REVISION_ONLY
├ HISTORICAL_AND_CURRENT
├ QUARANTINE
└ CAUSAL_REPLAY_REQUIRED
↓
Calibration State Repair
├ lane update
├ threshold recomputation
├ corrupted-gradient compensation
└ state replay
↓
Belief / Certificate Recompute
↓
Supersession Graph
↓
Permission Diff
↓
Operational Compensation if needed
```

新增的核心 runtime object：

```text
FeedbackRevisionEvent
├ feedback_id
├ prediction_id
├ original_feedback_state
├ revised_feedback_state
├ event_time
├ arrival_time
├ revision_time
├ delay
├ delay_to_memory_ratio
├ corruption_status
├ environment_epoch_match
├ affected_calibration_state_ids
├ affected_certificate_ids
└ repair_route
```

以及：

```text
CertificateSupersession
├ old_certificate_id
├ new_certificate_id
├ supersession_reason
├ evidence_revision_ids
├ historical_permission
├ corrected_permission
├ executed_actions
├ compensation_status
└ audit_status
```

---

# 4. Bottom-Level Logic

標準 ACI / OCP 可以抽象成：

```text
r_{t+1}
=
r_t + η(e_t - α)
```

其中：

```text
e_t ∈ {0,1}
```

是 coverage error。

### 4.1 Delayed trusted feedback

如果 `e_t` 在 `t+τ` 才看到：

```text
prediction t
↓
feedback pending
↓
t+τ receives e_t
↓
route to calibration lane
```

這和：

```text
在 t 使用 e_t = 0
```

完全不同。

因此：

```text
PENDING
≠ COVERED
```

### 4.2 Corrupted feedback

若系統先看到：

```text
ē_t ≠ e_t
```

則已執行：

```text
r'_{t+1}
=
r_t + η(ē_t - α)
```

日後 truth 修正時，至少存在 local delta：

```text
Δr
=
η(e_t - ē_t)
```

但 production runtime 不能因此直接宣稱：

```text
r_current += Δr
```

就完整修復，因為中間 thresholds 已影響未來 prediction sets / decisions。

因此 repair 需要分：

```text
LOCAL_COMPENSATION
vs
STATE_REPLAY
vs
CAUSAL_REPLAY
```

### 4.3 Revision-safe calibration state

Hermes 應保存：

```text
CalibrationStateSnapshot
├ algorithm
├ parameter_hash
├ threshold_state
├ lane_states
├ update_count
├ accepted_feedback_ids
├ pending_feedback_ids
├ environment_epoch
└ state_hash
```

只有這樣才能：

```text
snapshot before bad feedback
↓
replay accepted feedback in event-time order
↓
construct corrected state
↓
diff historical state
```

---

# 5. Visual Simulation Idea

## Late Evidence × Calibration Replay × Certificate Supersession Lab

第一層畫 prediction / feedback timeline：

```text
Event time
10:00 P1 issued
10:01 P2 issued
10:02 P3 issued
10:03 P4 issued

Arrival
10:01 truth P1
10:04 truth P4
10:07 truth P2  ⚠ late
10:09 correction P1 ⚠ corrupted earlier feedback
```

第二層顯示 calibration threshold history：

```text
Historical threshold
r0 .42
r1 .49
r2 .47
r3 .54
r4 .61

Corrected replay
r0 .42
r1 .35  ← P1 corrected
r2 .33
r3 .40
r4 .47
```

第三層顯示 certificate diff：

```text
C17 @ 10:03
WRITE_EXTERNAL
ALLOW

corrected C31
WRITE_EXTERNAL
BLOCK

C17 → SUPERSEDED
Action #92 already executed
→ COMPENSATION REQUIRED
```

第四層可以切：

```text
Feedback mode
[ on-time trusted ]
[ delayed trusted ]
[ intermittent ]
[ corrupted ]
[ late correction ]
```

並顯示：

```text
coverage trajectory
threshold drift
pending feedback count
revision depth
number of superseded certificates
irreversible descendants
```

---

# 6. Code / GitHub

## dcherenson/staggered-integral-ocp

URL: https://github.com/dcherenson/staggered-integral-ocp

值得看的核心檔案：

```text
ocp.py
→ StaggeredDriftScoreOCP
→ N independent calibration threads
→ per-thread quantile update

main.py
→ simulation / controller orchestration

controller.py
→ safe controller / MPC side

ssml.py
→ adaptive model side

test_ocp.py
→ OCP behavior tests
```

`ocp.py` 是本輪最值得直接映射到 Hermes runtime 的部分：它不是只描述 staggered idea，而是真的用 `j = k_step % N` 選擇 active lane，並只更新對應 `q_j`。

工程結論：

```text
DelayedFeedbackLane
```

值得做成 Hermes runtime primitive，而不是只做 dashboard metadata。

---

# 7. Papers

## Paper A
**Adaptive Conformal Inference Under Delayed Feedback: Coverage Guarantees and a Delay-to-Memory Diagnostic**  
Authors: Lama El Halabi, Adam Brandt  
Year: 2026  
URL: https://arxiv.org/abs/2609.07251  
Code: 未確認公開  
Architecture: delayed ACI → τ interleaved sequences  
Contribution: finite-sample delayed-feedback coverage analysis、delay-to-memory diagnostic  
Limitation: 不是 revision / corruption / causal rollback theorem。

## Paper B
**Online Conformal Prediction with Corrupted Feedback**  
Authors: Bowen Wang, Matteo Zecchin, Osvaldo Simeone  
Year: 2026  
URL: https://arxiv.org/abs/2605.20515  
Code: 本輪未確認  
Dataset: CIFAR-100 等  
Architecture: OCP + corrupted feedback → filtering / active compensation  
Contribution: explicit corruption-induced miscoverage analysis and robust schemes  
Limitation: coverage-indicator corruption ≠ arbitrary multimodal semantic correction。

## Paper C
**Mirror Online Conformal Prediction with Intermittent Feedback**  
Authors: Bowen Wang, Matteo Zecchin, Osvaldo Simeone  
Year: 2025  
URL: https://arxiv.org/abs/2503.10345  
Architecture: mirror online conformal update under intermittent feedback  
Contribution: feedback 不完整時仍保留 long-run coverage + sub-linear regret  
Limitation: missing feedback 不是 delayed truth correction。

## Paper D
**Staggered Integral Online Conformal Prediction for Safe Dynamics Adaptation with Multi-Step Coverage Guarantees**  
Authors: Daniel M. Cherenson, Dimitra Panagou  
Year: 2026  
URL: https://dasc-lab.github.io/papers/2026/2026-siocp/  
Code: https://github.com/dcherenson/staggered-integral-ocp  
Architecture: integral drift score + staggered OCP threads + robust tube MPC  
Contribution: multi-step / delayed feedback 以 staggered calibration threads 處理  
Limitation: control-specific score and dynamics assumptions；不可直接外推 Agent tool semantics。

---

# 8. 已確認事實 / 工程推論 / 假說

## 已確認事實
- Delayed ACI 可以在固定 delay 下分解為多條 interleaved ACI-like sequences，並有 delay-dependent coverage analysis。
- Corrupted OCP feedback 會透過錯誤 gradient 改變 threshold dynamics，並可破壞標準 calibration behavior。
- Staggered Integral OCP 的公開程式確實實作多 thread / per-thread quantile state。
- Intermittent feedback 與 corrupted feedback 已有不同的 online conformal frameworks。

## 工程推論
- Hermes 應把 `PENDING / DELAYED / CORRUPTED / REVISED` 分成不同 feedback state。
- Late truth 應分成「historical revision」與「current calibration admission」兩個用途。
- Certificate 應 append-only supersede，而不是原地覆寫。

## 尚未驗證假說
- 可否把 delayed ACI 的 lane decomposition 推廣到 variable-delay Tool/MCP feedback。
- 如何在 multimodal evidence dependence 下建立 revision-safe conformal/e-process guarantee。
- correction 後是否能只重播 calibration state，而不進入完整 causal world replay，需要可檢查的 sufficient condition。

---

# 9. Unknown / Open Questions

## Q1. Variable delay 如何做 lane？

固定 `τ` 可以：

```text
lane = t mod τ
```

但 Agent feedback 常是：

```text
100ms
2s
30s
10min
never
```

下一步需要研究 asynchronous / variable-delay calibration queue，而不是固定 modulo threads。

## Q2. Late correction 能否只修 calibration state？

如果 threshold 只影響 UI uncertainty display，也許 local replay 即可；但如果 threshold 決定：

```text
ASK_USER vs WRITE_MCP
```

則 action 已改變 future observations，必須進 causal replay。

需要正式定義：

```text
CalibrationReplayBoundary
```

## Q3. 如何讓 revision 本身 anytime-valid？

已有 delayed / intermittent / corrupted feedback coverage results，但 Hermes 最終需要：

```text
late truth
↓
revision process
↓
updated e-process / confidence process
↓
certificate supersession
```

且 repeated revision / arbitrary stopping 仍保持可證明 validity。

---

# 10. 下一輪研究

下一輪應聚焦：

# **Variable-Delay Feedback Queue × Revision-Safe E-Process × Calibration Replay Boundary × Certificate Compensation**

拆解鏈路：

```text
Prediction / certificate
↓
pending-feedback queue
↓
variable delay / missing / correction
↓
event-time ordered revision
↓
which state is replayable?
↓
calibration-only replay
vs
causal replay
↓
revision-safe e-process
↓
supersession certificate
↓
compensation policy
```

優先搜尋：
- delayed online learning with arbitrary / adversarial delays
- confidence sequences with delayed observations
- e-process with delayed feedback
- asynchronous conformal calibration
- event-sourced online learning rollback
- safe control / runtime assurance with delayed state estimation

---

# 11. Knowledge Graph 新增 Node / Edge

## Nodes

```text
Delayed Feedback
Trusted Delayed Feedback
Intermittent Feedback
Corrupted Feedback
Feedback Correction
Feedback Revision Event
Delayed Feedback Lane
Staggered Calibration Thread
Pending Feedback Registry
Feedback Arrival Router
Feedback Admission Gate
Delay-to-Memory Ratio
Residual Memory Timescale
Historical Truth Role
Current Calibration Signal Role
Calibration State Snapshot
Calibration State Replay
Calibration Replay Boundary
Threshold Descendant Graph
Revision Depth
Certificate Supersession
Supersession Graph
Operational Compensation Trigger
Revision-Safe Calibration
Variable-Delay Calibration Queue
```

## Positive Edges

```text
Delayed Feedback
→ routed_by
Delayed Feedback Lane

Delayed Feedback Lane
→ updates
Per-Lane Calibration State

Feedback Correction
→ may_trigger
Calibration State Replay

Calibration State Replay
→ produces
Corrected Certificate

Corrected Certificate
→ supersedes
Historical Certificate

Historical Certificate
→ may_have_authorized
External Action

External Action
→ may_require
Operational Compensation
```

## Negative / distinction edges

```text
Feedback Pending
≠ Coverage Success

Delayed Feedback
≠ Corrupted Feedback

Missing Feedback
≠ Negative Feedback

Historical Truth
≠ Automatically Current Calibration Signal

Corrected Feedback Row
≠ Corrected Calibration Trajectory

Certificate Supersession
≠ Historical Event Deletion

Calibration Replay
≠ Causal World Replay Automatically

Local Threshold Compensation
≠ Full State Repair Automatically
```

---

# 12. 本輪結束判定

**缺哪一層？**  
`Variable-Delay Revision-Safe Sequential Evidence Layer`。

**哪個節點最淺？**  
`CalibrationReplayBoundary`、`RevisionSafeEProcess`、`VariableDelayCalibrationQueue`。

**哪個概念仍只是名詞？**  
Production 級 `Revision-Safe Agent Certificate`；目前已有組件論文，但尚未形成完整 Agent theorem/runtime。

**哪個系統值得讀原始碼？**  
`dcherenson/staggered-integral-ocp`，先讀 `ocp.py`，再追 `main.py` 如何把 OCP bound 接到 controller。

**哪篇論文需追引用？**  
`Adaptive Conformal Inference Under Delayed Feedback: Coverage Guarantees and a Delay-to-Memory Diagnostic`，因為它是 2026-09-07 的新工作，最直接補目前 delayed calibration 缺口。

**哪個概念最適合視覺模擬？**  
`Late Evidence × Calibration Replay × Certificate Supersession Lab`。

**哪個 Agent 架構最值得實作？**

```text
Pending Feedback Registry
↓
Feedback Arrival + Admission Router
↓
Delayed / Corrupted / Revision Classifier
↓
Calibration State Replay
↓
Certificate Supersession
↓
Compensation Gate
```

---

# 13. 對「AI 到底怎麼運作」新增的一層

從使用者一句話到 Agent action，不只存在：

```text
UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tools / MCP
→ Model / GPU
→ Output
```

現在還必須補上 feedback time axis：

```text
Action
↓
世界稍後才揭露 outcome
↓
feedback 可能延遲、缺失、污染、被修正
↓
calibration state 改變
↓
future confidence / permission 改變
↓
舊 certificate 可能被 supersede
↓
若真實世界 action 已發生
→ compensation
```

因此真正長期運作的 AI 不只是「根據目前資訊做決定」，而是持續維護一套 **pending truth → delayed truth → corrected truth → calibration revision → certificate supersession** 的時間化證據系統。沒有這層，Agent 的 uncertainty 一旦遇到晚到真值，就只能覆寫歷史或假裝舊決定從沒發生；有了這層，Hermes 才能同時回答「當時為什麼允許」與「現在知道更多之後，這個允許是否仍成立」。