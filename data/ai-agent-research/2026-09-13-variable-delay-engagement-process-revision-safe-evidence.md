# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-13 19:53 Asia/Taipei

## 本輪研究主題
**Variable-Delay Feedback Queue × Engagement Process × Revision-Safe Sequential Evidence × Delayed VLA Adaptation × Certificate Compensation**

本輪承接前一輪的 `Late Evidence Revision / Delayed Feedback Calibration / Certificate Supersession`，但刻意避免重複固定延遲 ACI、SI-OCP 與 corrupted feedback 的既有結論。本輪往下追問：**如果 action、observation、reasoning、tool result、human feedback 根本不在同一回合抵達，Agent runtime 的基本抽象是否仍應是 step-based loop？**

---

## 本小時新發現

### 新架構：Engagement Process (EP)
2026 年的 *Engagement Process: Rethinking the Temporal Interface of Action and Observation* 將 POMDP 的 action-observation 配對介面改成同一時間軸上的兩條解耦事件流。它明確建模 deliberation latency、delayed feedback、persistent actions、interruptions 與 multi-rate coordination。

來源：https://arxiv.org/abs/2605.11484

### 新模型：Delayed-feedback Vision-Language-Action adaptation
CVPR 2026 的 *Test-Time Perturbation Learning with Delayed Feedback for Vision-Language-Action Models* 使用實際環境結果作為 delayed feedback，只更新輕量 perturbation head，而凍結 VLA backbone。論文在 LIBERO 報告 +7.4% success rate、Atari +10.3 human-normalized score。

來源：https://arxiv.org/abs/2604.18107  
Code：https://github.com/zhoujiahuan1991/CVPR2026-PDF

### 新延遲資源觀點：Pending feedback 是有限資源
*Capacity-Constrained Online Learning with Delays* 顯式研究只能同時追蹤有限數量 pending rounds 的情況，說明 delayed-feedback runtime 不應假設「所有未完成 feedback 都可永久免費保存」。

來源：https://proceedings.mlr.press/v291/ryabchenko25a.html

### 新安全觀點：Delay 會改變保守/探索切換時機
2026 的 *Prudent-Banker* 在 adversarial bandits with delays 中指出，任意 delay 會讓安全 baseline 與 exploration 的切換時機失真，因此導入 delay-calibrated restart threshold。

來源：https://arxiv.org/abs/2605.23351

### 最新延遲校準補充
2026-09-07 的 *Adaptive Conformal Inference Under Delayed Feedback* 顯示固定 `τ` delayed ACI 可拆成 `τ` 條 interleaved ACI-like sequences，並提出 delay-to-memory ratio `r = τ/L`。本輪把它重新定位為 **固定延遲特例**，而非一般 Agent runtime 的完整時間模型。

來源：https://arxiv.org/abs/2609.07251

---

# 本小時最重要 5 個發現

## 1. Step-Based Agent Loop 不足以表示真實 Agent 時序

### 概念
傳統 Agent 常寫成：

```text
Observation_t
→ Reasoning_t
→ Action_t
→ Feedback_t
→ Observation_{t+1}
```

但 Engagement Process 指出，真實互動更接近：

```text
TIME ──────────────────────────────────────────────→

Observation:   o1        o2  o3              o4
Reasoning:       [ reasoning A──────── ]
Action:                 a1──────────────┐     a2
Tool:                     [API call─────┘ result]
Human:        msg1                       correction
Feedback:                              f(a1)
```

Action 與 observation 並不天然一一配對。

### 底層如何運作
EP 仍保留 POMDP 的 state / transition / observation / policy 結構，但把 interaction interface 改成 tick/event time：

```text
s_{t+1} ~ F(. | s_t, A_t)
Y_t     ~ O(. | s_t)
A_t     ~ π(. | w_t)
```

其中 `A_t` 可為空集合、多個 intervention，`Y_t` 也可沒有事件、單一事件或多事件；環境即使 agent 不動也可繼續演化。

### 為什麼重要
Hermes 若仍以「一個 chat turn = 一個世界 step」建模，會把：
- LLM reasoning latency
- browser/tool latency
- voice streaming
- async MCP result
- delayed human correction
- persistent external action
全部錯誤序列化。

### 限制
EP 是 interaction formalism，不等於自帶 anytime-valid statistical certificate，也沒有直接解掉 feedback corruption / calibration revision。

### 來源類型
**論文結果 / 新 formalism**：https://arxiv.org/abs/2605.11484

---

## 2. Pending Feedback Queue 應升級為 Temporal Obligation Graph，而不是 FIFO

### 概念
前一輪 Hermes 已有 `PendingFeedbackRegistry`，但 variable-delay / asynchronous world 中，單純 FIFO 不夠。

應改成：

```text
TemporalObligationGraph
├ prediction/action event
├ expected truth type
├ causal target
├ earliest valid feedback time
├ maturity condition
├ deadline / expiry
├ censoring possibility
├ revision policy
├ descendants already executed
└ capacity priority
```

### 底層如何運作
每個 action 發出後建立 obligation：

```text
ActionEvent A17
├ waits_for: tool_result:R8
├ waits_for: human_confirmation:H3
├ truth_maturity: payment_settled
├ timeout: 10 min
└ risk_class: EXTERNAL_WRITE
```

收到一個 observation 時不能只做：

```text
pop(oldest_pending)
```

而應：

```text
Observation
→ identity / correlation match
→ event-time match
→ semantic truth-type match
→ causal parent match
→ maturity check
→ revision eligibility
→ update one or more obligations
```

### 為什麼重要
在多工具、多代理、多模態環境裡，feedback 可能 out-of-order、一個 feedback 對應多個 action、或一個 action 等待多個 partial feedback。

Capacity-constrained delayed learning 進一步提醒：pending items 不是免費無限資源，因此 runtime 還需要 retention/scheduling policy。

### 限制
Online-learning regret result 不能直接轉成 Agent certificate theorem；這裡是 architecture transfer。

### 來源類型
**論文結果 + 工程推論**：
- https://proceedings.mlr.press/v291/ryabchenko25a.html
- https://arxiv.org/abs/2605.11484

---

## 3. Delayed Feedback 可直接改寫模型 policy，因此 correction 可能越過「校準層」進入「模型參數層」

### 概念
前幾輪主要研究 delayed truth 如何改 calibration threshold；PDF 顯示 delayed feedback 還可以直接更新 policy-side module。

### 原始碼拆解
`zhoujiahuan1991/CVPR2026-PDF/pdflibero/pdf.py` 的 episode runtime 是：

```text
image/state
→ OpenVLA predict_with_p_head_io()
→ augmented views
→ action-token majority vote
→ env.step(action)
→ episode success/failure
→ delayed feedback
→ optimize perturbation head
```

程式只讓 `pdf.*` parameters requires_grad，VLA backbone 保持 frozen。

在 `_optimize_p_head()`：

```text
advantage = feedback - baseline

if advantage <= 0:
    no update

base logits
+ perturbation head output
→ perturbed logits
→ selected action log-prob
→ REINFORCE-like loss
+ KL(base || perturbed)
→ optimizer.step()
```

而目前公開 LIBERO 實作中，成功 augmented rollout 才以 `feedback=1.0` 觸發 P-head optimization；baseline 再用 momentum 更新。

### 為什麼重要
這代表 delayed feedback 的 descendant 不一定只是：

```text
feedback
→ threshold
```

也可能是：

```text
feedback
→ model parameter update
→ all future action logits
→ future trajectories
```

因此 Hermes 的 revision graph 必須追：

```text
FeedbackEvent
→ CalibrationState?
→ MemoryState?
→ RouterState?
→ Adapter/LoRA/P-head parameters?
→ PolicySemanticHash
```

### 限制
PDF 論文展示的是 task-level delayed success feedback，不是 arbitrary variable delay，也不是 formal revision-safe guarantee。公開程式同樣沒有通用 pending-feedback queue 或 rollback of optimizer history。

### 來源類型
**論文結果 + 原始碼確認**：
- https://arxiv.org/abs/2604.18107
- https://github.com/zhoujiahuan1991/CVPR2026-PDF/blob/main/pdflibero/pdf.py

---

## 4. Revision-Safe Runtime 必須區分 Statistical State、Policy State、World State 三種後果

### 概念
一筆 late/corrected truth 到來時，不能只有 `recompute=true`。

應先判斷它改的是哪一層：

```text
RevisionImpactClass
├ STATISTICAL_ONLY
├ POLICY_INTERNAL
├ MEMORY_CONTEXT
├ TOOL_PERMISSION
├ EXTERNAL_WORLD
└ MIXED_CAUSAL
```

### Bottom-level
例如：

```text
Late feedback F9
↓
原本「成功」其實是「失敗」
```

Case A：只改 conformal threshold

```text
F9
→ calibration replay
→ certificate supersession
```

Case B：曾更新 P-head / LoRA

```text
F9
→ optimizer descendant graph
→ affected parameter epochs
→ later action distributions invalidated
→ policy replay / retraining required
```

Case C：錯誤 certificate 曾允許外部寫入

```text
F9
→ certificate supersession
→ executed external action exists
→ world cannot be un-executed
→ compensation workflow
```

### 為什麼重要
這正式把前幾輪的 `CalibrationReplayBoundary` 擴張成：

```text
RevisionBoundaryRouter
```

### 限制
對 neural parameter updates 做 exact counterfactual rollback 通常不可能只靠 inverse optimizer step；若後續資料與 action 都因此改變，真正問題成為 causal replay。

### 來源類型
**合理工程推論，基於 EP + PDF + 前輪 replay research**。

---

## 5. 「任意延遲」的安全問題不是只有 evidence 變舊，而是 decision timing 本身會錯

### 概念
Prudent-Banker 的重要啟示是：未觀測 feedback 不只降低資訊量，也會讓「何時從保守 baseline 切到積極 policy」發生 timing distortion。

對 Agent 可映射：

```text
Pending high-risk feedback ↑
↓
uncertainty about whether current policy is better/safe
↓
不能照原 exploration / permission escalation schedule
```

Hermes 應新增：

```text
PendingEvidenceRiskBudget
├ unresolved_high_risk_count
├ unresolved_causal_mass
├ max_delay
├ delay_distribution
├ stale_policy_evidence
└ permission_escalation_allowed
```

permission escalation 應能因 pending truth 暫停：

```text
READ → WRITE_LOCAL → WRITE_EXTERNAL
```

不是「目前沒有看到失敗」就一路升級。

### 重要 distinction

```text
No Failure Observed Yet
≠ Evidence Of Success

Pending Feedback
≠ Positive Feedback

Safe Under Immediate Feedback
≠ Safe Under Arbitrary Delay
```

### 來源類型
**論文結果 + Agent architecture transfer**：https://arxiv.org/abs/2605.23351

---

# Architecture Breakdown

## Variable-Delay Event-Native Hermes Runtime

```text
User / Camera / Voice / Browser / MCP / Tool / Remote Agent
↓
Event Ingress
↓
Event-Time Normalizer
↓
Engagement Timeline
├ Observation Stream
├ Reasoning Stream
├ Action Stream
├ Tool/Process Stream
└ Feedback/Truth Stream
↓
Temporal Obligation Graph
├ pending truth
├ partial truth
├ maturity
├ timeout
├ censoring
└ capacity priority
↓
Feedback Matcher
↓
Feedback Admission Gate
├ identity
├ timestamp/event-time
├ semantic type
├ source reliability
├ corruption status
└ environment epoch
↓
Revision Impact Classifier
├ STATISTICAL_ONLY
├ POLICY_INTERNAL
├ MEMORY_CONTEXT
├ TOOL_PERMISSION
├ EXTERNAL_WORLD
└ MIXED_CAUSAL
↓
Revision Boundary Router
├ calibration replay
├ evidence/e-process replay
├ policy-state repair
├ counterfactual trajectory replay
└ compensation-only
↓
Certificate Supersession Graph
↓
Permission Gate
↓
ALLOW / VERIFY / ASK / WAIT / INTERRUPT / BLOCK / COMPENSATE
```

### 與舊 architecture 的差異
舊：

```text
turn_id → action → feedback
```

新：

```text
causal_event_id
+ event_time
+ process lifetime
+ parent/descendant edges
+ feedback obligation
```

`turn_id` 只適合作為 UI grouping，不再是底層因果單位。

---

# Bottom-Level Logic

## 1. Event-native information state

定義在 wall/event time `t` 可用的資訊集合：

```text
F_t = σ(
  observations arrived and admissible by t,
  actions initiated by t,
  action completions by t,
  reasoning/model states exposed by t,
  valid feedback admitted by t
)
```

關鍵是：

```text
feedback truth event time
≠ feedback arrival time
```

且 policy 在 action time 只能使用當時 `F_t` 可得資訊。

## 2. Variable-delay object

```text
FeedbackDelay D_i = T_feedback_arrival_i - T_target_event_i
```

但真正需要保存的不只 scalar `D_i`：

```text
DelayRecord
├ target_event_id
├ truth_event_time
├ arrival_time
├ admission_time
├ delay_known_at_action_time?
├ delay_censored?
├ delay_distribution_epoch
└ environment_epoch
```

## 3. Revision depth

```text
revision_depth(event)
=
max causal path length from corrected event
through derived states/certificates/actions
```

可粗分：

```text
0  metadata only
1  local statistic
2  calibration/evidence state
3  policy/memory/router
4  tool permission/action choice
5+ external-world trajectory
```

Revision depth 越深，越不能用 local patch 假裝完成修復。

## 4. Delayed policy adaptation lineage

對 PDF 類 runtime：

```text
Feedback F_i
→ advantage_i
→ loss_i
→ optimizer step_i
→ parameter epoch θ_{i+1}
→ logits_{future}
→ actions_{future}
```

所以應保存：

```text
PolicyUpdateCertificate
├ feedback_event_ids
├ parameter_parent_hash
├ optimizer_state_hash
├ loss_definition_hash
├ update_batch_hash
├ parameter_child_hash
├ validity_epoch
└ rollback_class
```

---

# Visual Simulation Idea

## **Engagement Timeline × Pending Feedback Queue × Revision Blast-Radius Lab**

主視圖是一條真正的時間軸，而非 chat turn list：

```text
19:00.000 user asks task
19:00.120 reasoning R1 starts ──────────────┐
19:00.300 camera O1                         │
19:00.550 MCP read A1 ──────┐              │
19:01.100 voice correction O2              │
19:01.800 MCP result F1 ◄───┘              │
19:02.400 reasoning R1 ends ◄──────────────┘
19:02.600 WRITE_EXTERNAL A2 ───────┐
19:08.200 human truth F2: A2 was wrong ◄──┘
```

點擊 `F2` 後，自動畫出 blast radius：

```text
F2
├ supersedes Certificate C21
├ invalidates Calibration Epoch E8
├ invalidates Policy Update P4
├ affects Actions A3 A4 A7
└ A2 already externalized
   → COMPENSATION REQUIRED
```

另一側顯示 pending queue：

```text
Pending 17
High-risk 3
Mature-but-unresolved 2
Censored/unknown 4
Oldest 18m 42s
Tracking capacity 20/32
```

再切換兩種 runtime：

```text
STEP LOOP
vs
ENGAGEMENT PROCESS
```

讓使用者直觀看到 step loop 如何錯誤地把 asynchronous events 排成假的 observation-action pairs。

---

# Code / GitHub

## 深入閱讀：zhoujiahuan1991/CVPR2026-PDF

Repository：
https://github.com/zhoujiahuan1991/CVPR2026-PDF

### 值得看的目錄 / 檔案

```text
pdflibero/
├ pdf.py                 ← rollout + delayed feedback + P-head update 核心
├ prismatic/             ← OpenVLA/prismatic model integration
└ utils/

scripts/
└ start_*.sh             ← LIBERO suite experiments
```

### `pdflibero/pdf.py` 重要 runtime

```text
_run_episode()
├ env.reset / set_init_state
├ image + robot state
├ prepare_inputs
├ predict_with_p_head_io
├ image augmentation
├ action-token voting
├ token → continuous action
└ env.step

_optimize_p_head()
├ feedback - baseline
├ frozen base lm logits
├ P-head perturbation
├ REINFORCE-like selected log-prob loss
├ KL regularization
└ optimizer.step

collect()
├ rollout augmented episode
├ task-level success feedback
├ save successful samples
├ optimize P-head
└ momentum baseline update
```

### 原始碼級限制
公開 LIBERO implementation 的 feedback 基本上是 episode-level success/failure；成功 augmented rollout 才更新 P-head。它不是通用 arbitrary-delay runtime，沒有 feedback identity matcher、variable-delay queue、optimizer rollback、certificate supersession 或 causal replay。

因此這個 repository 值得 Hermes 借的是：

```text
delayed real-world outcome
→ lightweight policy adapter update
```

而不是直接照搬其 feedback semantics。

---

# Papers

## 1. Engagement Process: Rethinking the Temporal Interface of Action and Observation
- **Authors**: Jialian Li, Yuchen Cao, Junhong Liu, Weiran Guo, Xutao Wang, Jiaming Song, Jiahao Zhang, Jie Chen
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2605.11484
- **Code**: 本輪未確認到官方 runtime repository
- **Architecture**: POMDP-derived explicit-time action/observation event streams
- **Contribution**: 將 deliberation、persistent action、delayed observation、interruptions 變成 interaction model 的一級概念
- **Limitation**: 不直接提供 delayed-feedback sequential inference / calibration theorem
- **改變了什麼**: 把「Agent interaction = alternating turns」改寫成「Agent interaction = asynchronous engagement timeline」

## 2. Adaptive Conformal Inference Under Delayed Feedback: Coverage Guarantees and a Delay-to-Memory Diagnostic
- **Authors**: Lama El Halabi, Adam Brandt
- **Year**: 2026-09-07
- **URL**: https://arxiv.org/abs/2609.07251
- **Code**: 本輪未找到官方 code release
- **Architecture**: fixed-τ delayed ACI, τ interleaved recursions
- **Contribution**: finite-sample long-run empirical coverage bound with explicit delay dependence；提出 `r=τ/L`
- **Limitation**: 固定 delay；不是任意 heterogeneous feedback graph
- **改變了什麼**: 延遲的危害要相對環境 memory time scale 判斷，而非只看 wall-clock delay

## 3. Test-Time Perturbation Learning with Delayed Feedback for Vision-Language-Action Models
- **Authors**: Zehua Zang, Xi Wang, Fuchun Sun, Xiao Xu, Lixiang Lium, Jiahuan Zhou, Jiangmeng Li
- **Institution**: 第一作者與部分作者公開資料顯示 Institute of Software, Chinese Academy of Sciences；完整 affiliation 以論文 PDF 為準
- **Year**: 2026 / CVPR 2026
- **URL**: https://arxiv.org/abs/2604.18107
- **Code**: https://github.com/zhoujiahuan1991/CVPR2026-PDF
- **Dataset/Benchmark**: LIBERO, Atari
- **Architecture**: frozen VLA + perturbation head + uncertainty augmentation/voting + delayed environmental feedback
- **Contribution**: 用 delayed actual outcome 修正 test-time policy，而非只用 entropy/self-confidence
- **Limitations**: delayed feedback 沒有 formal revision-safe guarantee；公開 LIBERO code 主要是 episode-success feedback
- **改變了什麼**: 證明 delayed feedback 不只屬於監控/校準層，也可以直接改變 multimodal action policy

## 4. Capacity-Constrained Online Learning with Delays: Scheduling Frameworks and Regret Trade-offs
- **Authors**: Alexander Ryabchenko, Idan Attias, Daniel M. Roy
- **Year**: 2025 / COLT
- **URL**: https://proceedings.mlr.press/v291/ryabchenko25a.html
- **Architecture**: delayed online learning + bounded pending-tracking capacity + schedulers
- **Contribution**: 定量研究 pending feedback tracking capacity 對 regret 的影響
- **Limitations**: online-learning loss model，不是 agent causal certificate
- **改變了什麼**: pending observations 被正式視為需要 scheduling 的有限 runtime resource

## 5. Prudent-Banker: No Extra Fees for Baseline Safety in Adversarial Bandits With and Without Delays
- **Authors**: Ting Hu, Luanda Cai, Emmanouil-Vasileios Vlatakis-Gkaragkounis
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2605.23351
- **Architecture**: delay-adapted OMD + phased aggression + safe comparator
- **Contribution**: 在 arbitrary delay 下同時維持 minimax-scale regret 與 baseline-safety regret；引入 delay-calibrated restart threshold
- **Limitation**: adversarial bandit setting，不可直接等同 Tool/MCP safety
- **改變了什麼**: delay 被視為會扭曲「何時能安全升級 policy」的因素，而非純粹 feedback latency

---

# 已確認事實 / 工程實作 / 推論 / 假說分層

### 已確認事實 / 官方或原始碼
- EP 將 action / observation 解耦為同一時間軸上的 event streams。
- PDF 官方 GitHub 存在可讀的 `pdflibero/pdf.py` runtime。
- PDF code 凍結主模型，只讓 `pdf.*` parameters 可訓練。
- PDF code 用 delayed episode success signal 驅動 P-head optimization。
- fixed-τ delayed ACI 論文於 2026-09-07 發布。

### 論文結果
- PDF：LIBERO +7.4% success rate；Atari +10.3 HNS（作者實驗）。
- delayed ACI：固定 τ 可分解為 τ interleaved ACI-like sequences，且 delay effect 與 `τ/L` 有關。
- capacity-constrained delayed learning：有限 tracking capacity 仍可取得具理論界線的 regret trade-off。
- Prudent-Banker：delay-aware safety/learning trade-off。

### 合理工程推論
- Hermes 應以 Temporal Obligation Graph 取代單純 pending FIFO。
- certificate 應掛在 causal event graph，而非 chat turn。
- corrected delayed feedback 若曾觸發 neural policy update，修復範圍可能包含 parameter epoch 與 future policy lineage。

### 尚未驗證假說
- 是否能建立一般性的 **Revision-Safe E-Process**，允許 arbitrary out-of-order feedback arrival 後局部 supersede 而不破壞 optional-stopping validity。
- 是否可從 Engagement Process formalism 構造自然 filtration 與 predictable betting process，用於 Agent permission certificate。
- neural adapter parameter rollback 是否能在某些 convex/local approximation 下得到可證明的 bounded correction，而非完整 replay。

---

# Unknown / Open Questions 1-3

## 1. Revision-Safe E-Process
若 e-process 在 feedback 缺席時持續運作，late truth 到來後是否能合法：

```text
replace historical increment
→ repair current wealth
```

還是必須建立新的 evidence epoch？需要找 delayed/out-of-order martingale、optional skipping、filtration enlargement 相關理論。

## 2. Neural Policy Update Reversal
若錯誤 delayed feedback 已觸發 LoRA/P-head optimizer step，如何判斷：

```text
inverse optimizer correction
vs
retrain from checkpoint
vs
full causal replay
```

哪個才有語義意義？

## 3. Event-to-Feedback Matching Under Ambiguity
真實 Agent 可能收到「這不對」「剛才那個改掉」等人類 feedback。它可能無法唯一匹配 action。需要研究：

```text
semantic feedback attribution
+ temporal attribution
+ causal attribution
+ uncertainty over parent event
```

而不是強制綁最近一個 action。

---

# 下一輪研究

下一輪應收斂到：

## **Out-of-Order Martingale × Optional Skipping × Filtration Revision × Revision-Safe E-Process**

研究鏈：

```text
Engagement event stream
↓
filtration F_t
↓
pending / censored truth
↓
out-of-order feedback
↓
optional skipping / delayed observation martingale
↓
can historical increment be revised?
↓
wealth repair vs new epoch
↓
revision-safe e-process
↓
certificate supersession
↓
permission / compensation
```

同時追第二線：

```text
Delayed feedback
↓
P-head / LoRA / memory update
↓
parameter-state lineage
↓
policy-semantic versioning
↓
rollback class
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Engagement Process
Engagement Timeline
Action Event Stream
Observation Event Stream
Reasoning Event Stream
Feedback Event Stream
Persistent Action
Deliberation Latency
Temporal Obligation Graph
Feedback Obligation
Feedback Maturity Condition
Variable Delay Record
Censored Feedback
Partial Feedback
Feedback Attribution
Pending Feedback Capacity
Pending Evidence Risk Budget
Revision Impact Class
Revision Boundary Router
Policy-Internal Revision
Parameter Epoch
Policy Update Certificate
Optimizer State Lineage
Delayed VLA Adaptation
Perturbation Head
Revision Blast Radius
Revision Depth
Permission Escalation Delay
Feedback-Causal Descendant
Event-Native Filtration
```

## Edges

```text
Engagement Process
  GENERALIZES interaction interface of
POMDP

Feedback Event
  MAY UPDATE
Calibration State

Feedback Event
  MAY UPDATE
Policy Parameters

Policy Parameter Update
  CHANGES
Future Action Distribution

Late Feedback
  MAY SUPERSEDE
Historical Certificate

Historical Certificate
  MAY HAVE AUTHORIZED
External Action

External Action
  MAY REQUIRE
Operational Compensation

Pending Feedback Capacity
  CONSTRAINS
Feedback Tracking Policy

Unresolved High-Risk Feedback
  SHOULD LIMIT
Permission Escalation
```

## 核心否定 edges

```text
Chat Turn
≠ World Step

Observation-Action Pair
≠ Natural Unit Of Real-Time Agent Interaction

Pending Feedback Queue
≠ FIFO Automatically

Feedback Arrival Order
≠ Causal Event Order

No Failure Observed Yet
≠ Evidence Of Success

Delayed Feedback
≠ Calibration-Only Update

Corrected Calibration State
≠ Corrected Policy State

Corrected Policy State
≠ Corrected External World

Inverse Optimizer Step
≠ Counterfactual Policy Replay Automatically

Fixed-τ Delayed ACI
≠ General Variable-Delay Agent Runtime
```

---

# 本輪結束判定

- **缺哪一層**：`Out-of-Order / Revision-Safe Sequential Evidence Layer`
- **哪個節點最淺**：`RevisionSafeEProcess`、`FeedbackAttribution`、`OptimizerStateLineage`、`EventNativeFiltration`
- **哪個概念仍只是名詞**：production-grade `TemporalObligationGraph` 與 theorem-backed `RevisionBoundaryRouter`
- **哪個系統值得讀原始碼**：`zhoujiahuan1991/CVPR2026-PDF`，尤其 `pdflibero/pdf.py` 與 `pdflibero/prismatic/`
- **哪篇論文需追引用**：`Engagement Process: Rethinking the Temporal Interface of Action and Observation`，特別追 asynchronous tool usage、metareasoning、semi-MDP/options 與 real-time agent papers
- **哪個概念最適合視覺模擬**：`Engagement Timeline × Pending Feedback Queue × Revision Blast-Radius Lab`
- **哪個 Agent 架構最值得實作**：

```text
Event Ingress
↓
Engagement Timeline
↓
Temporal Obligation Graph
↓
Feedback Attribution + Admission
↓
Revision Boundary Router
↓
Certificate Supersession
↓
Permission / Compensation Gate
```

---

# 對「AI 到底怎麼運作」本輪新增的核心答案

真正長時間運作的 AI Agent 不是「使用者說一句話 → AI 想完 → 做一個動作 → 世界回一句答案」的同步機器。Reasoning 需要時間、Tool 需要時間、Robot action 有持續時間、Camera/Voice 不會等 LLM 思考完、Human truth 甚至可能幾分鐘後才回來。**所以 Agent 的最底層 runtime 應是一張時間化事件與因果圖。**

新的完整鏈路應逐漸變成：

```text
User / Camera / Voice / UI / Tool events
↓
Event-Time + Lineage
↓
Observation / Feedback Admission
↓
Belief / State
↓
Reasoning + Planning (itself takes time)
↓
Action process begins
↓
Environment keeps evolving
↓
Other observations arrive concurrently
↓
Delayed truth updates calibration / memory / policy
↓
Certificate may be superseded
↓
World action may require compensation
```

因此，回答「AI 到底怎麼運作」時，**時間、延遲、未完成 action、未到 feedback、以及事後 truth，必須和 Token、Attention、Memory、Tool Calling、MCP、GPU 一樣成為底層知識圖譜的一級節點。**