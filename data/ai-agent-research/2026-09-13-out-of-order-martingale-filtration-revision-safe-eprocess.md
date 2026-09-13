# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-13 20:52 Asia/Taipei

## 本輪研究主題
**Out-of-Order Martingale × Optional Skipping × Filtration Revision × Revision-Safe E-Process × Evidence Epoch Forking**

本輪承接前一輪留下的 `RevisionSafeEProcess`、`FeedbackAttribution`、`OptimizerStateLineage`、`EventNativeFiltration`，避免重複 Engagement Process、fixed-delay ACI、SI-OCP、multimodal lateness 與 certificate supersession。本輪集中回答：

> 當 truth / feedback 不是依 causal order 抵達，而且舊 evidence increment 後來被修正時，原本的 martingale / e-process 還能不能繼續？哪些資料可以合法跳過？哪些修正必須 fork 新 evidence epoch，而不能改寫歷史 wealth？

---

# 本小時新發現

## 新底層機制
1. **Predictable Optional Skipping**：對 martingale increment 的採用/跳過必須在看到該 increment 前，由過去 filtration 決定；事後依 outcome 選擇性刪除會破壞 martingale validity。
2. **Admission-Time Filtration**：非同步 Agent 的統計 filtration 應以「目前已合法 admission 的資訊」定義，而不是 event-time 排序後的理想歷史。
3. **Evidence Epoch Forking**：若 late correction 改變了過去已用來選 bet / lambda / action 的資料，通常不能單純 retroactively rewrite 原 e-process；較安全的 production abstraction 是保留舊 epoch、標記 superseded，並從合法 state fork 新 evidence epoch。
4. **Outcome-Independent Reordering vs Outcome-Dependent Reordering**：若 arrival/reordering mechanism 與未觀察 outcome 無關，某些重排可以重新表達；若 arrival 本身依 outcome、風險或 action 而變，則必須顯式建模 censoring / selection。
5. **Revision Blast Radius for Sequential Evidence**：修正一筆 historical truth 不只影響該筆 e-value，還可能影響之後所有 predictable betting stakes、nuisance estimates、model states、permission certificates。

## 新架構
**Revision-Safe Sequential Evidence Runtime**

```text
Event Stream
↓
Admission-Time Filtration F^adm_t
↓
Pending Evidence Registry
↓
Predictable Admission / Skip Gate
↓
Sequential E-Value Constructor
↓
E-Process Epoch
↓
Late Truth / Correction
↓
Revision Validity Auditor
├ NO_EFFECT
├ FUTURE_ONLY_UPDATE
├ OPTIONAL_SKIP_COMPATIBLE
├ EPOCH_FORK_REQUIRED
└ CAUSAL_REPLAY_REQUIRED
↓
Evidence Epoch Graph
↓
Certificate Supersession
↓
Permission / Compensation
```

---

# 本小時最重要 5 個發現

## 1. Optional stopping 安全，不等於事後 revision 安全

### 概念
E-process 的 anytime-valid 優勢來自：在 null 下 wealth process 仍維持 nonnegative supermartingale / test martingale 結構，故可以 optional stop / continue。但這不代表可以在看到晚到 outcome 後任意重寫歷史 increment。

### 底層如何運作
對 additive martingale transform，可寫：

```text
Z_n = Z_0 + Σ_{i=1}^n S_i (Y_i - Y_{i-1})
```

其中 `S_i` 必須是 predictable：在第 i 個結果揭露前，只依賴過去資訊決定是否下注/跳過。

對 multiplicative e-process，可對應成：

```text
M_t = M_{t-1} × G_t(E_t)
```

其中 `G_t`（例如 stake λ_t）必須在 `E_t` 被揭露前由 `F_{t-1}` 決定。

因此：

```text
先決定 SKIP
→ 合法候選

先看到 bad outcome
→ 再刪掉該 increment
→ 非 predictable revision
```

### 為什麼重要
Hermes 的 late correction 不可以做：

```text
historical e-values
↓
刪掉後來證明不利的項
↓
重新乘一次
```

否則等同 hindsight selection。

### 限制
Optional skipping theorem 本身不直接解 arbitrary delayed-feedback Agent；Hermes 還需要把 arrival process、feedback attribution、policy adaptation 與 filtration 明確化。

### 來源
- Doob optional skipping theorem 的 predictability/no-clairvoyance條件：Cambridge obituary summary, https://doi.org/10.1239/jap/1110381384
- Grünwald/de Heide/Koolen, *Safe Testing*, arXiv:1906.07801
- Ramdas/Wang, *Hypothesis testing with e-values*, arXiv:2410.23614

**狀態：已確認理論事實 + Hermes 工程映射。**

---

## 2. Out-of-order arrival 時，真正重要的是 Admission Filtration，不是把資料硬排回 Event Time

### 概念
上一輪已建立 event-time / arrival-time separation。本輪進一步指出 sequential validity 所依賴的是：某個 bet / estimator 在做決定時「到底已經知道什麼」。

應記錄：

```text
F^adm_t = σ(
  observations admitted by t,
  actions already initiated,
  tool results admitted by t,
  model/runtime state available by t,
  feedback legally admitted by t
)
```

而不是假設：

```text
F_t = 所有 event_time ≤ t 的資料
```

因為有些 event_time 很早，但 truth 是幾分鐘後才抵達，當時根本不可能被 betting rule 使用。

### 底層如何運作
對每一個 evidence increment 保存：

```text
SequentialEvidenceIncrement
├ event_id
├ event_time
├ arrival_time
├ admission_time
├ filtration_hash_before
├ predictor_hash
├ betting_rule_hash
├ nuisance_state_hash
├ e_value
└ filtration_hash_after
```

這能回答：

> 當時 λ_t / predictor / action 是不是在 outcome 尚未可見時決定？

### 為什麼重要
Out-of-order feedback 不一定破壞 validity；真正危險的是 future leakage 或事後基於 outcome 改 decision rule。

### 限制
如果 feedback arrival 本身具有 informative censoring，例如「失敗結果比較慢回來」，單純 admission-time ordering仍不足，還需要 missingness / delay model。

### 來源
- *Engagement Process: Rethinking the Temporal Interface of Action and Observation*, Li et al., 2026, arXiv:2605.11484（前輪背景）
- *Adaptive Conformal Inference Under Delayed Feedback*, El Halabi & Brandt, 2026, arXiv:2609.07251（前輪 delayed update 背景）
- Safe testing / conditional e-variable framework supports constructing new conditional evidence using currently available history, provided the conditional safety property is satisfied.

**狀態：理論原則已確認；AdmissionFiltration schema 為工程建模。**

---

## 3. Revision 最安全的預設不是「重寫 wealth」，而是 Evidence Epoch Fork

### 概念
如果 historical correction 只改 metadata、且沒有改變後續 stakes / model / action，可能局部修正即可。

但若 correction 改變第 k 步 evidence，而：

```text
λ_{k+1}
λ_{k+2}
...
```

曾依賴過去 wealth / history，那第 k 步之後所有 betting choices 都可能不同。

### 底層因果
原始：

```text
E_k
↓
M_k
↓
λ_{k+1}=f(F_k)
↓
E_{k+1}
↓
M_{k+1}
```

若後來：

```text
E_k → E'_k
```

不能只做：

```text
M'_k = M_{k-1} × E'_k
然後保留舊 λ_{k+1}
```

除非能證明後續 bet 與被修正資訊無關。

所以新增：

```text
EvidenceEpoch
├ epoch_id
├ parent_epoch_id
├ fork_event_id
├ filtration_root_hash
├ betting_policy_hash
├ model_state_hash
├ validity_regime
├ status
└ supersedes_epoch_id
```

典型流程：

```text
Epoch E7
↓ correction invalidates historical filtration
E7 → SUPERSEDED
↓
Fork E12
↓
只使用在新 filtration 下合法 admissible evidence
```

### 為什麼重要
這避免 production 系統產生「看似修正後仍有完整 anytime-valid guarantee」的假證據。

### 限制
何時能 mathematically replay historical e-process、何時必須完全 restart，仍取決於具體 theorem；目前不能宣稱 generic repair theorem 已存在。

### 來源
- Grünwald et al. conditional e-variable / optional continuation principle
- Ramdas & Wang e-process framework
- `jakorostami/expectation` 實作顯示 sequential wealth會使用 past e-values 決定 betting λ，並以 multiplicative increment 更新；若 past values改變，adaptive bet lineage也可能跟著變。

**狀態：工程推論，基於已確認 e-process predictability requirement。**

---

## 4. 現有 e-process 程式碼多半是 append-only，不具 revision semantics

### GitHub 深讀
Repository：`jakorostami/expectation`

值得看的核心目錄：

```text
expectation/
├ seqtest/
│  └ sequential_e_testing.py
└ modules/
   ├ eprocessupdater.py
   ├ hypothesistesting.py
   ├ martingales.py
   ├ boundaries.py
   └ calibrators.py
```

`sequential_e_testing.py` 維護：

```text
previous_log_e_cumulative
history
lambda_history
rejection_times
intrinsic_time
```

並從 cumulative log e-value 的差值構造 sequential increment。

`eprocessupdater.py` 則實際：

```text
process.values.append(e_value)
λ_t = combiner.compute_lambda(process.values[:-1], t)
increment = combiner.compute_increment(e_value, λ_t)
M_t = M_{t-1} × increment
```

這個 runtime 很清楚地顯示：

```text
past e-values
→ λ_t
→ next wealth
```

但它沒有：

```text
late correction
historical increment replacement
filtration lineage
epoch fork
supersession
```

### 為什麼重要
Hermes 不能把一般 sequential-testing library 直接包成 revision-safe runtime；需要額外一層 evidence ledger / epoch semantics。

### 限制
`expectation` README 也標示 pre-release；此外某些 test implementation 自身仍含 TODO/validation caveat，因此應視為工程參考，不是 theorem source。

### Code
https://github.com/jakorostami/expectation

**狀態：GitHub 原始碼已確認。**

---

## 5. Delayed / dependent sequence 有時可用 blocking/subsequence 恢復近似 martingale，但不能泛化成任意 revision

### 概念
*Linear Bandits with Non-i.i.d. Noise*（Abélès, Clerico, Flynn, Neu, 2025）研究 dependent noise；其方法透過 delayed-feedback game / blocking，把 rounds 拆成間隔 d 的 subsequences，使依賴衰減後可建立近似 supermartingale 型控制。

這提供 Hermes 一個重要 pattern：

```text
所有事件混在一條 stream
≠ 唯一選擇

可以依 delay / dependence structure
→ partition into evidence lanes
```

### Hermes 映射
例如：

```text
EvidenceLane
├ immediate tool truth
├ human delayed truth
├ external transaction settlement
├ multimodal sensor confirmation
└ policy-evaluation truth
```

每條 lane 可以有自己的 filtration / delay model / validity regime。

### 為什麼重要
這比硬要求所有 evidence 進單一 global e-process 更合理。

### 限制
Blocking theorem依賴特定 mixing assumptions；不能直接聲稱 Agent 任意事件拆 lane 後就有效。

### 來源
- Baptiste Abélès, Eugenio Clerico, Hamish Flynn, Gergely Neu, *Linear Bandits with Non-i.i.d. Noise*, 2025, arXiv:2505.20017

**狀態：論文結果已確認；Hermes EvidenceLane 為合理工程推論。**

---

# Architecture Breakdown

## System Architecture：Revision-Safe Sequential Evidence Runtime

```text
UI / Camera / Voice / Tool / MCP / Human Feedback
↓
Event Ledger
↓
Event Attribution
↓
Admission-Time Filtration Builder
↓
Pending Evidence Registry
↓
Predictable Admission / Optional-Skip Gate
├ ADMIT_NOW
├ SKIP_BY_PREDECLARED_RULE
├ WAIT_FOR_MATURITY
├ QUARANTINE
└ REJECT
↓
Evidence Lane Router
├ immediate lane
├ delayed-human lane
├ transaction-settlement lane
├ multimodal-confirmation lane
└ policy-evaluation lane
↓
Conditional E-Value Constructor
↓
E-Process Epoch
↓
Permission Certificate
↓
ALLOW / VERIFY / WAIT / ASK / BLOCK

Late correction arrives
↓
Revision Validity Auditor
├ Was original increment already observed?
├ Was skip/revision rule predictable?
├ Did downstream λ depend on corrected evidence?
├ Did nuisance/model state depend on it?
├ Did permission/action depend on it?
└ Did external world change?
↓
RevisionBoundary
├ LOCAL_METADATA_ONLY
├ FUTURE_ONLY_UPDATE
├ OPTIONAL_SKIP_COMPATIBLE
├ EPOCH_FORK_REQUIRED
└ CAUSAL_REPLAY_REQUIRED
↓
Evidence Epoch Graph
↓
Certificate Supersession
↓
Compensation
```

## 與歷史研究比較

歷史已完成：

```text
Late observation
Delayed feedback
Calibration replay
Certificate supersession
Engagement event stream
Temporal obligation graph
```

本輪新增的不是另一個 queue，而是：

```text
哪些 historical evidence 操作仍保持 martingale/e-process validity？
```

也就是從「runtime repair」進入「statistical legality of repair」。

---

# Bottom-Level Logic

## 1. Predictable skip

令 `I_t ∈ {0,1}` 表示第 t 個 evidence 是否被採用。

安全候選條件是：

```text
I_t is F_{t-1}-measurable
```

即：

```text
I_t
必須在看到本步 outcome / e-value 前決定
```

若原 increment `X_t` 滿足：

```text
E[X_t | F_{t-1}] = 0
```

則 predictable transform：

```text
I_t X_t
```

仍保留對應 martingale structure（在適當 integrability 條件下）。

## 2. Multiplicative e-process

若：

```text
E_t ≥ 0
E[E_t | F_{t-1}] ≤ 1
```

使用 predictable stake `λ_t`：

```text
G_t = (1-λ_t) + λ_t E_t
```

則：

```text
M_t = Π_{i≤t} G_i
```

可維持 test-supermartingale 型結構（具體條件依 theorem）。

Hermes 的 audit 重點不是只存 `E_t`，而是存：

```text
λ_t chosen_at
filtration_hash_before
E_t observed_at
```

## 3. Revision invalidation condition

若 correction `C_k` 改變 past state，而存在某個 `t>k`：

```text
λ_t = f(F_{t-1})
```

且 `F_{t-1}` 包含被 correction 改變的內容，則：

```text
old λ_t
```

不是 corrected filtration 下重新執行所得的 bet。

因此：

```text
replace E_k only
≠ valid replay automatically
```

## 4. Evidence epoch fork

建議 production invariant：

```text
issued evidence history is append-only
```

correction 不 mutate 舊 epoch：

```text
Correction
↓
Supersede old epoch
↓
Fork new epoch
↓
New filtration root
↓
New sequential evidence
```

## 5. Out-of-order arrival

資料物件：

```text
EvidenceArrival
├ causal_event_time
├ arrival_time
├ admission_time
├ source_id
├ target_obligation_id
├ content_hash
├ outcome_visibility_before_admission
├ informative_delay_status
└ dependence_group
```

核心問題：

```text
arrival ordering
是否本身透露 outcome？
```

若 yes，delay mechanism 必須成為 model的一部分。

---

# Visual Simulation Idea

## **Filtration Time-Machine × Revision-Safe E-Process Lab**

畫面一：三條時間軸

```text
EVENT TIME
E1────E2────E3────E4────E5

ARRIVAL TIME
E1────E3────E2────────E5──E4

ADMISSION TIME
A1────A3────A2────────A5──A4
```

畫面二：每一步 wealth

```text
step   admitted event   λ_t   e_t   wealth
1      E1               .20   1.3   1.06
2      E3               .25   2.0   1.33
3      E2               .30   .4    1.09
4      E5               .18   3.1   1.50
```

點擊「E2 later corrected」後顯示：

```text
Was correction rule predictable?      NO
Did λ4 depend on old E2?               YES
Did permission C8 depend on wealth?    YES
Was external action executed?          YES

REVISION VERDICT
EPOCH_FORK_REQUIRED
+ CERTIFICATE SUPERSESSION
+ COMPENSATION CHECK
```

另一個互動切換：

```text
Skip E2 decided BEFORE arrival
→ OPTIONAL_SKIP_COMPATIBLE

Skip E2 decided AFTER seeing e2=.4
→ INVALID HINDSIGHT SELECTION
```

這是最直接讓使用者理解 optional stopping、optional skipping、revision 三者差異的視覺模型。

---

# Code / GitHub

## 1. `jakorostami/expectation`
URL: https://github.com/jakorostami/expectation

### 值得看的目錄/檔案

```text
expectation/seqtest/sequential_e_testing.py
expectation/modules/eprocessupdater.py
expectation/modules/hypothesistesting.py
expectation/modules/martingales.py
expectation/modules/boundaries.py
expectation/modules/calibrators.py
```

### 核心工程發現
`EProcessUpdater.update()` 是 append-only：先 append e-value，再由 past e-values 算 λ_t，再 multiplicatively update wealth。這很適合當 Hermes 的「正常 forward path」參考，但沒有 historical revision semantics。

### Hermes 要補的層

```text
FiltrationLedger
EvidenceEpochGraph
RevisionValidityAuditor
PredictableSkipGate
EvidenceLaneRouter
SupersessionGraph
```

---

# Papers

## Paper 1
**Title:** Safe Testing  
**Authors:** Peter Grünwald, Rianne de Heide, Wouter M. Koolen  
**Institution:** CWI / Leiden University / Vrije Universiteit Amsterdam / University of Twente（作者版本所列 affiliations）  
**Year:** 2019 preprint；2024 JRSS-B publication  
**URL:** https://arxiv.org/abs/1906.07801  
**Code:** safestats ecosystem: https://github.com/AlexanderLyNL/safestats  
**Dataset:** 不以單一 dataset 為核心  
**Architecture:** Conditional e-values → optional continuation → safe test  
**Contribution:** 建立 e-value safe testing 與 optional continuation 理論。  
**Limitations for Hermes:** 並非針對 asynchronous Agent revision、external actions、policy updates 設計。

## Paper 2
**Title:** Hypothesis testing with e-values  
**Authors:** Aaditya Ramdas, Ruodu Wang  
**Institution:** Carnegie Mellon University / University of Waterloo（公開資料所示）  
**Year:** 2024–2025  
**URL:** https://arxiv.org/abs/2410.23614  
**Code:** 非單一官方 runtime  
**Dataset:** N/A  
**Architecture:** e-variable → e-process → optional stopping/continuation → multiple testing / confidence sequences  
**Contribution:** 系統化 e-value / e-process 理論與操作。  
**Limitations:** 不提供 generic late-correction wealth-rewrite theorem。

## Paper 3
**Title:** Linear Bandits with Non-i.i.d. Noise  
**Authors:** Baptiste Abélès, Eugenio Clerico, Hamish Flynn, Gergely Neu  
**Institution:** 包含 Pompeu Fabra University（公開 metadata 顯示 Neu affiliation；完整 affiliations 應再由論文 PDF核對）  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2505.20017  
**Code:** 本輪未確認官方 code  
**Dataset:** synthetic / bandit experiments（需後續逐節核對）  
**Architecture:** dependent noise → delayed online-learning game → blocking/subsequence → approximate martingale control  
**Contribution:** 在非 i.i.d. noise 下建立 anytime confidence / regret analysis pattern。  
**Limitations:** mixing/blocking assumptions不等於 arbitrary asynchronous Agent feedback。

## Paper 4
**Title:** Adaptive Conformal Inference Under Delayed Feedback: Coverage Guarantees and a Delay-to-Memory Diagnostic  
**Authors:** Lama El Halabi, Adam Brandt  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2609.07251  
**Code:** 本輪未發現已公開官方 code  
**Dataset:** simulation regimes including AR(1), GARCH(1,1), Markov switching, abrupt shifts  
**Architecture:** τ-delayed ACI → τ interleaved update sequences → delay-to-memory ratio τ/L  
**Contribution:** 把 feedback delay 與 temporal memory timescale聯繫。  
**Limitations:** 不處理 arbitrary historical correction / e-process wealth revision。

## Paper 5
**Title:** Engagement Process: Rethinking the Temporal Interface of Action and Observation  
**Authors:** Jialian Li, Yuchen Cao, Junhong Liu, Weiran Guo, Xutao Wang, Jiaming Song, Jiahao Zhang, Jie Chen  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2605.11484  
**Architecture:** POMDP-like decision structure + decoupled time-indexed action/observation streams  
**Contribution:** 把 Agent runtime 從 synchronous step 升級成 shared-time event process。  
**Limitations:** 本身不提供 revision-safe e-process theorem。

---

# Unknown / Open Questions 1–3

## 1. Generic Revision-Safe E-Process theorem 是否可能？
目前最安全工程規則是「old epoch immutable + supersede + fork」。但是否存在實用條件，可在 correction 後局部重算 historical wealth，同時保證 corrected process 的 anytime validity，需要更精確的 filtration surgery theorem。

## 2. Informative delay / censoring 如何進 e-process？
若 bad outcomes 比較慢、human只在不滿意時回饋、tool failure 才會補送事件，arrival mechanism 本身就是訊息。下一輪需要研究 inverse-probability-of-observation、censoring martingale、survival / delayed-outcome e-process。

## 3. Policy/model update 後，統計 epoch 與 policy epoch 如何耦合？
如果 feedback 改了 LoRA、memory、router 或 tool permission，新的 sequential evidence 是否必須跟著開新的 policy-conditioned epoch？目前只建立工程概念，還缺 formal contract。

---

# 下一輪研究

## 主題
**Informative Delay × Censoring Martingale × Missing-Outcome E-Process × Observation-Probability Weighting × Agent Feedback Selection Bias**

研究鏈：

```text
Action / Prediction
↓
Outcome exists in world
↓
Will feedback be observed?
├ yes quickly
├ yes late
├ only if failure
├ human-selective
└ never
↓
Observation / censoring process
↓
Inverse probability / hazard model
↓
Sequential martingale/e-process
↓
Delay-selection certificate
↓
Permission Gate
```

優先回答：

1. `Feedback Missing ≠ Random Missing` 時如何維持 anytime validity？
2. 可否對 outcome-observation probability 建 predictable inverse weighting？
3. Human feedback selection bias 如何進 Agent certificate？
4. Censoring mechanism 改變時是否要 fork evidence epoch？

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Admission-Time Filtration
Predictable Optional Skipping
Optional Skip Gate
Outcome-Dependent Skipping
Evidence Admission Policy
Evidence Epoch
Evidence Epoch Fork
Evidence Epoch Graph
Filtration Root Hash
Filtration Lineage
Filtration Revision
Revision Validity Auditor
Sequential Evidence Increment
Predictable Bet Lineage
Betting Policy Hash
Hindsight Evidence Selection
Outcome-Independent Reordering
Outcome-Dependent Reordering
Evidence Lane
Delayed Evidence Lane
Informative Delay
Revision Blast Radius
Evidence Epoch Supersession
```

## 新增 Edges

```text
Optional Stopping
≠ Historical Revision

Optional Continuation
≠ Outcome-Dependent Deletion

Predictable Skipping
→ Can Preserve Martingale Structure

Outcome-Dependent Skipping
→ Can Break Martingale Validity

Event Time
≠ Admission Filtration Time

Out-of-Order Arrival
≠ Invalid Sequential Inference Automatically

Late Correction
≠ Historical Wealth Rewrite Permission

Corrected Increment
≠ Corrected Downstream Betting Policy Automatically

Append-Only E-Process Library
≠ Revision-Safe Evidence Runtime

Evidence Epoch Fork
→ Preserves Historical Auditability

Feedback Arrival Mechanism
→ May Carry Outcome Information
```

---

# 本輪結束判定

- **缺哪一層**：`Informative Delay / Censoring-Aware Sequential Evidence Layer`
- **哪個節點最淺**：`FiltrationRevision`、`EvidenceEpochFork theorem boundary`、`OutcomeDependentReordering`、`RevisionValidityAuditor`
- **哪個概念仍只是名詞**：generic production-grade `RevisionSafeEProcess`；目前能提出安全工程不變量，但不能宣稱已有通用 wealth-repair theorem
- **哪個系統值得讀原始碼**：`jakorostami/expectation` 的 `eprocessupdater.py`、`sequential_e_testing.py`、`martingales.py`
- **哪篇論文需追引用**：`Safe Testing` 與 `Hypothesis testing with e-values` 中 conditional e-variable / optional continuation / predictable strategy 相關引用；另追 non-i.i.d. noise blocking 與 censoring martingale 文獻
- **哪個概念最適合視覺模擬**：`Filtration Time-Machine × Revision-Safe E-Process Lab`
- **哪個 Agent 架構最值得實作**：`Admission-Time Filtration Builder → Predictable Admission/Skip Gate → Evidence Epoch Graph → Revision Validity Auditor → Certificate Supersession`

---

# 對「AI 到底怎麼運作」新增的一層

真正的 Agent 不只要問「目前有哪些資料」，而要問：

```text
在做這個 decision / bet / tool action 的那一瞬間，
哪些資料已經合法可見？
哪些 truth 還沒抵達？
哪些資料是之後才知道的？
```

因此從：

```text
使用者一句話
→ UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tools/MCP
→ Model/GPU
→ Output
```

現在必須再補一條平行底層：

```text
Event
→ Arrival
→ Admission
→ Filtration
→ Predictable Decision
→ Evidence Increment
→ E-Process
→ Permission
→ Late Truth
→ Revision Audit
→ Epoch Fork / Supersession / Compensation
```

這說明 AI 系統裡的「知道」不是單純資料庫裡有沒有一筆資料，而是**那筆資料在當時是否已經可被合法使用**。對任何要聲稱 anytime-valid、可驗證或安全的 Agent，filtration 本身就是 runtime 的一級物件。