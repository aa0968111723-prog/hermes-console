# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 09:55（Asia/Taipei）**  
**本輪主題：Legitimate Retroactive Wealth Update × SCORE Overshoot Refund × Counterfactual Multiplicity Replay × Replay Validity Certificate × Forward-Safe Repair**

---

## 本小時新發現

本輪延續上一輪 `Append-Only Multiplicity Ledger × Tainted-Wealth Propagation × Selective Replay`，但修正一個過度保守的結論：**「retroactive alpha-wealth update」並非一律不合法。** ICML 2026 的 SCORE（Sequential Control with Overshoot Refund for E-values）證明，在其特定 e-value / dependence / update-rule 條件下，可以對過去已鎖住的 error-budget 做 retroactive refresh，同時維持 finite-sample FDR control。

這與「某 verifier 後來被發現有 bug，因此任意把舊 reward 扣回去」是完全不同的操作。

本輪因此新增最重要的區分：

```text
THEOREM-GOVERNED RETROACTIVE REFUND
≠
SEMANTIC-INVALIDATION ROLLBACK
```

前者是統計 procedure 本身的一部分；後者是 runtime audit / repair 問題，不能直接借用前者的 guarantee。

### 新論文 / 新結果

1. **SCORE: A Unified Framework for Overshoot Refund in Online FDR Control**  
   Authors: Qi Kuang, Bowen Gang, Yin Xia  
   Institution: Fudan University（作者資訊依公開頁面）  
   Year: 2026 / ICML 2026  
   URL: https://arxiv.org/abs/2601.20386  
   Code: 本輪未找到官方公開 GitHub repository  
   Architecture: e-value online FDR → overshoot refund → SCORE-LOND / SCORE-LORD / SCORE-SAFFRON → optional retroactive wealth refresh  
   Contribution: 用 `I(y ≥ 1) ≤ y - (y-1)_+` 回收超過 rejection threshold 的 e-value evidence；在額外依賴條件下，可使用 global denominator / retroactive update。  
   Limitation: retroactive validity 依賴特定 conditional dependence 與 update monotonicity；不能直接外推到 verifier semantic invalidation。

2. **Feedback-Enhanced Online Multiple Testing with Applications to Conformal Selection**  
   Authors: Lin Lu, Yuyang Huo, Haojie Ren, Zhaojun Wang, Changliang Zou  
   Year: 2026  
   URL: https://www.alphaxiv.org/abs/2509.03297v2  
   Contribution: GAIF 使用決策後獲得的 full / bandit / delayed truth feedback 更新未來 testing thresholds，並保持 finite-sample FDR/mFDR control。  
   Limitation: 「truth feedback」和「先前 test 本身因 software/verifier bug 不合法」仍是不同問題。

### 新工程原始碼

深入讀取：`OliverHennhoefer/online-fdr`

值得看的核心檔案：

```text
online_fdr/p_values/investing/lord/plus_plus.py
online_fdr/core/
online_fdr/p_values/investing/
online_fdr/e_values/
```

`LordPlusPlus.test_one()` 具體做：

```text
past rejection indices
↓
gamma(index - reject_time)
↓
alpha_t
↓
min(alpha_t, current wealth)
↓
test p_t
↓
spend alpha_t
↓
if reject:
  wealth += reward
  update rejection history
```

也就是 rejection history 是未來 testing level 的真正上游 state，而不是 UI 裡的一個標籤。

---

# 本小時最重要 5 個發現

## 1. Retroactive Update 本身不一定破壞 FDR；關鍵是它是不是 procedure 定義的一部分

### 是什麼

SCORE 的核心不是「發現錯了再改歷史」，而是：原本 e-value rejection 只使用是否跨過 threshold，超出的 evidence 被浪費。SCORE 把 overshoot 視為可回收資源。

底層不等式：

```text
I(y ≥ 1) ≤ y - (y - 1)_+
```

若 `y` 是 scaled e-value，右側把 threshold 以上的 excess evidence 分離出來。

### 底層如何運作

```text
incoming e-value e_t
↓
scale by testing threshold / allocation
↓
rejection indicator
+
overshoot term
↓
refund unused conservative budget
↓
future alpha allocation increases
```

SCORE 進一步討論 global denominator `R_t ∨ 1`；當未來新增 discoveries 時，先前各項 FDP contribution 的 effective denominator 可變大，因此過去被鎖住的 wealth 可以 refresh。

### 為什麼重要

這直接修正上一輪 Hermes 的規則：

```text
Retroactive Wealth Update ≠ Automatically Invalid
```

更精確的規則應是：

```text
Retroactive Wealth Update
├ THEOREM_GOVERNED_REFUND → 可能合法
├ FEEDBACK_GOVERNED_UPDATE → 視 procedure theorem
└ SEMANTIC_INVALIDATION_REPAIR → 需另證明
```

### 限制

SCORE 的 retroactive strategy 不是任意 replay；其證明依賴 conditional validity / positive dependence 與 coordinate-wise monotone update 等條件。不能拿它當作「bug rollback theorem」。

### 來源

- https://arxiv.org/abs/2601.20386
- ICML 2026 公開 paper summaries / PDF excerpts

---

## 2. Conditional validity 才是 online testing runtime 的真正邊界，不是單次 p/e-value 看起來有效

SCORE 附錄強調：對 e-values，僅 marginal validity 不夠；需要與 filtration 對應的 conditional e-validity。對 p-values，則需要 conditional super-uniformity。其模擬還特別比較 conditional p-values 與 marginal p-values，在 dependent stream 中後者可能不保有原 guarantee。

Hermes 應新增：

```text
SequentialEvidenceValidity
├ marginal_validity
├ conditional_validity
├ filtration_id
├ dependence_contract
├ update_monotonicity
└ theorem_regime
```

底層機制：

```text
F_{t-1}
↓
choose threshold / betting rule
↓
observe evidence_t
↓
require null-conditional validity given F_{t-1}
↓
update wealth / rejection history
```

如果 verifier 在看完目前 observation 後才改 threshold，或 model upgrade 讓 filtration 偷偷包含未來資訊，歷史 wealth replay 即使 deterministic，也未必統計有效。

核心否定關係：

```text
Deterministic Replay
≠
Valid Sequential Replay
```

---

## 3. Counterfactual Multiplicity Replay 必須重播「decision policy」，不只是重算 wealth 數字

上一輪的 shadow replay 需要進一步收斂。

錯誤做法：

```text
historical wealth = .032
remove invalid reward .01
corrected wealth = .022
```

這會漏掉：舊 reward 改變了 `alpha_8`，而 `alpha_8` 又改變 H8 是否 rejection，接著 H8 可能又產生 reward，形成 path dependence。

真正 replay：

```text
corrected event prefix
↓
procedure code hash
↓
gamma / threshold sequence
↓
for t = repair_start ... now:
    recompute alpha_t
    reuse only admissible historical evidence_t
    recompute R_t
    recompute wealth_t
↓
new rejection history
↓
new descendant certificates
```

因此新增：

```text
CounterfactualMultiplicityReplay
├ replay_start_event
├ procedure_hash
├ parameter_hash
├ admissible_evidence_snapshot
├ original_decisions
├ replayed_decisions
├ alpha_path_diff
├ wealth_path_diff
└ rejection_path_diff
```

這是 system architecture 層的重要推進：repair 的最小單位不是一個 number，而是一段 adaptive state machine trajectory。

---

## 4. SCORE-style refund 與 verifier invalidation 的「因果來源」不同，必須在 ledger 中使用不同 event type

Hermes 的 append-only ledger 應禁止兩者共用 `WEALTH_ADJUSTED` 這種模糊 event。

建議 event taxonomy：

```text
WEALTH_SPENT
DISCOVERY_REWARD_GRANTED
OVERSHOOT_REFUND_GRANTED
RETROACTIVE_SCORE_REFRESH
TRUTH_FEEDBACK_RECEIVED
CERTIFICATE_INVALIDATED
WEALTH_TAINT_DECLARED
REPLAY_EPOCH_STARTED
REPLAY_DECISION_RECOMPUTED
FORWARD_SAFE_EPOCH_STARTED
```

其中：

```text
OVERSHOOT_REFUND_GRANTED
```

必須附：

```text
theorem_id
validity_regime
dependence_contract
source_evalue_ids
refund_formula
```

而：

```text
WEALTH_TAINT_DECLARED
```

必須附：

```text
invalidation_reason
semantic_bug_id
first_affected_event
causal_descendant_closure
```

重要性：只有這樣 Console 才能回答：「這次改變 wealth 是合法的統計 refund，還是事故修復？」

---

## 5. Forward-Safe Repair 應輸出 Replay Validity Certificate，而不是只有 corrected wealth

本輪提出新的最重要工程物件：

```text
ReplayValidityCertificate
├ replay_id
├ source_epoch
├ corrected_epoch
├ procedure_name
├ procedure_code_hash
├ theorem_regime
├ filtration_schema_hash
├ hypothesis_semantic_hashes
├ evidence_snapshot_hash
├ correction_events
├ path_recomputed_from
├ conditional_validity_status
├ dependence_assumption_status
├ replay_determinism_status
├ historical_action_diff
├ unresolved_statistical_gap
└ verdict
```

Verdict：

```text
THEOREM_PRESERVING_REPLAY
PROCEDURE_VALID_BUT_NOT_RETROACTIVE_THEOREM
STATISTICAL_GUARANTEE_UNKNOWN
SEMANTIC_ONLY_REPAIR
REPLAY_INVALID
```

這避免 Hermes 產生危險敘述：

```text
"we replayed successfully, so FDR is restored"
```

真正應該說：

```text
runtime state 已成功重建
但 statistical guarantee 是否延續
必須由 ReplayValidityCertificate 另行判定
```

---

# Architecture Breakdown

## System Architecture：Repair-Aware Online Evidence Runtime

```text
Verifier / Tool / Vision / MCP Evidence
↓
Hypothesis Registry
↓
Evidence Validity Contract
↓
Online Testing Engine
├ e-LORD / e-SAFFRON / SCORE
├ LORD++ / SAFFRON / ADDIS
└ custom verifier family
↓
Append-Only Multiplicity Ledger
↓
Wealth + Rejection State
↓
Certificate Graph
↓
Planner
↓
Memory / MCP / External Actions

            ↓ later event

Correction / Feedback / Invalidation Router
├ legitimate overshoot refund
├ delayed truth feedback
├ statistical reversal
└ semantic verifier invalidation
↓
Repair Semantics Classifier
├ THEOREM_GOVERNED_UPDATE
├ FEEDBACK_GOVERNED_UPDATE
└ COUNTERFACTUAL_REPLAY_REQUIRED
↓
Replay Engine
↓
Replay Validity Verifier
↓
Historical-vs-Corrected Diff
↓
Forward-Safe Epoch
↓
Planner Repair / Compensation
```

### 最重要的 state machine

```text
ACTIVE
↓
CORRECTION_EVENT
↓
CLASSIFY
├ SCORE_REFUND
│   ↓
│ APPLY THEOREM-GOVERNED REFUND
│   ↓
│ ACTIVE
│
├ DELAYED_FEEDBACK
│   ↓
│ UPDATE VIA FEEDBACK PROCEDURE
│   ↓
│ ACTIVE
│
└ SEMANTIC_INVALIDATION
    ↓
  QUARANTINE
    ↓
  COUNTERFACTUAL REPLAY
    ↓
  VALIDITY CHECK
    ├ PASS → FORWARD_SAFE
    └ UNKNOWN → CONSERVATIVE_NEW_EPOCH
```

---

# Bottom-Level Logic

## A. Ordinary LORD++ path dependence

從讀到的 `LordPlusPlus.test_one()` 可直接抽象：

```text
alpha_t
=
wealth0 * gamma(t)
+
contribution(first rejection)
+
sum contribution(later rejections)
```

然後：

```text
alpha_t = min(alpha_t, wealth_t-1)
R_t = 1[p_t ≤ alpha_t]
wealth_t = wealth_t-1 - alpha_t + alpha0 * R_t
```

所以如果早期 `R_j` 改變，所有後續 `alpha_t` 都可能改變。

## B. SCORE overshoot mechanism

概念上：

```text
scaled evidence y
↓
standard procedure只保留 I(y≥1)
↓
SCORE 利用 y-(y-1)+ 上界 rejection indicator
↓
(y-1)+ 成為可退款的 overshoot
```

它不是「修改 observation」，而是改進 FDP / wealth accounting 的保守程度。

## C. Retroactive global-denominator intuition

Local accounting：

```text
cost_j ∝ C_j / (R_{j-1}+1)
```

Retroactive global accounting：

```text
cost_j(t) ∝ C_j / (R_t ∨ 1)
```

當 `R_t` 增加，舊 cost 的 effective share 下降，因此释放 budget。

但這只有在 SCORE 指定的 dependence / conditional-validity regime 中才被證明安全。

## D. Semantic invalidation counterfactual

Verifier bug 的 replay 不是：

```text
R_j : 1 → 0
wealth -= reward_j
```

而是：

```text
R_j := recompute under corrected evidence
for k=j+1...t:
  alpha_k := f(corrected history_{<k})
  R_k := test(evidence_k, alpha_k)
  wealth_k := update(...)
```

這是 **counterfactual state-machine replay**。

---

# Visual Simulation Idea

## Retroactive Wealth × Replay Validity Lab

Console 左側顯示 Historical Path：

```text
H1  α=.004  no
H2  α=.005  YES  reward +.05
H3  α=.011  no
H4  α=.015  YES
H5  α=.019  no
```

中間切換 correction type：

```text
[ A ] SCORE overshoot refund
[ B ] delayed truth feedback
[ C ] verifier semantic invalidation
```

如果選 A：

```text
THEOREM REGIME: PASS
CPQD / conditional validity: PASS
retroactive refresh: ALLOWED
```

如果選 C：

```text
THEOREM REGIME: NOT APPLICABLE
wealth tainted from H2
counterfactual replay required
```

右側顯示：

```text
             Historical   Corrected Replay
H3 alpha        .011          .006
H4 reject       YES           NO
H5 alpha        .019          .005
Planner         MCP_WRITE     ASK_USER
```

底部顯示：

```text
Replay Validity
Runtime deterministic      ✓
Evidence snapshot complete ✓
Conditional validity       ?
Dependence theorem         ✕
Statistical guarantee      UNKNOWN
```

這個視覺化的核心價值是：讓使用者一眼區分「合法回收」與「事故回滾」。

---

# Code / GitHub

## `OliverHennhoefer/online-fdr`

本輪值得讀：

```text
online_fdr/p_values/investing/lord/plus_plus.py
```

核心 runtime pattern：

```text
state:
  wealth
  first_reject
  last_reject[]
  gamma sequence

step(p_t):
  alpha_t ← history-dependent rule
  alpha_t ← min(alpha_t, wealth)
  reject ← p_t <= alpha_t
  wealth -= alpha_t
  if reject:
      wealth += alpha
      rejection_history.append(t)
```

這個實作非常適合拿來做 Hermes 的 `CounterfactualMultiplicityReplay` baseline，因為 state 小、path dependence 明確、可 deterministic replay。

### 下一批值得追的檔案

```text
online_fdr/p_values/investing/saffron/
online_fdr/p_values/investing/addis/
online_fdr/e_values/
online_fdr/core/state.py
```

目的：比較 LORD++、SAFFRON、ADDIS、e-value procedures 的 replay dependency graph 是否可共用一個 IR。

---

# Papers

## Paper 1

**Title:** SCORE: A Unified Framework for Overshoot Refund in Online FDR Control  
**Authors:** Qi Kuang, Bowen Gang, Yin Xia  
**Institution:** Fudan University（依公開作者頁 / conference metadata）  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2601.20386  
**Code:** 本輪未確認官方 code  
**Dataset:** simulation + real-data experiments（paper）  
**Architecture:** e-value online FDR → overshoot refund → SCORE-enhanced LOND/LORD/SAFFRON → optional retroactive refresh  
**Contribution:** 將 threshold overshoot 轉成可利用的 wealth；證明特定 dependence 條件下 retroactive update 可保持 FDR。  
**Limitations:** theorem regime 狹義；無法直接處理 verifier semantic bug / corrupted historical evidence / external side effects。  
**改變了什麼:** 把「retroactive update 必然危險」改成「必須區分 theorem-governed retroactivity 與 repair-driven retroactivity」。

## Paper 2

**Title:** Feedback-Enhanced Online Multiple Testing with Applications to Conformal Selection  
**Authors:** Lin Lu, Yuyang Huo, Haojie Ren, Zhaojun Wang, Changliang Zou  
**Year:** 2026  
**URL:** https://www.alphaxiv.org/abs/2509.03297v2  
**Architecture:** online test → later truth feedback → feedback-enhanced generalized alpha investing → future threshold update  
**Contribution:** delayed truth information 可以合法改進未來 allocation。  
**Limitations:** feedback assumes historical testing event 本身有定義清楚的 statistical semantics；不等價於修復 software-semantic invalidity。

---

# 與歷史研究比較：避免重複

前幾輪已建立：

```text
Dynamic Hypothesis Registry
Online FDR Wealth
Certificate Retraction
Append-Only Ledger
Tainted Wealth
Validity-Causality Graph
Selective Replay
Forward-Safe Epoch
```

本輪**沒有重做**上述架構，而是補上它們最缺的理論分類：

```text
Retroactive update
到底何時可以是合法 procedure？
```

新的分叉是：

```text
Retroactivity
├ SCORE / theorem-defined refund
├ delayed-feedback-defined update
└ semantic-invalidation repair
```

上一輪只有第三類；本輪補齊前兩類，並明確禁止把三類 guarantee 混用。

---

# Unknown / Open Questions

## 1. Semantic invalidation 後能否用某種「safe refund theorem」而不全量 replay？

目前未找到成熟結果能說：

```text
invalidated earlier discovery
↓
計算某個 correction/refund
↓
直接延續原 procedure
↓
仍保原 FDR theorem
```

SCORE 的 retroactive theorem 不回答這個問題。

## 2. Corrected replay 中 evidence 是否仍可原樣重用？

若原 evidence generator 本身會依 historical threshold / planner action 改變，則：

```text
recompute alpha path
```

之後，原來觀察到的 evidence stream 可能已不再是 counterfactual world 會產生的資料。

因此 replay 必須區分：

```text
OFF-POLICY REPLAYABLE EVIDENCE
POLICY-COUPLED EVIDENCE
ACTION-DEPENDENT EVIDENCE
```

這是目前最深的新缺口。

## 3. External action 造成的 data-generating process 改變如何 replay？

如果 H7 rejection 讓 Agent 真正執行 MCP write，導致之後使用者行為、Memory、Tool state 都改變，則 statistical replay 已變成 counterfactual policy evaluation 問題，而非純 log replay。

---

# 下一輪研究

下一輪應聚焦：

# **Off-Policy Replay Validity × Policy-Coupled Evidence × Counterfactual Testing Reconstruction × Causal Replay Boundary**

研究鏈：

```text
Historical Agent Policy π_h
↓
produced actions
↓
changed future observations
↓
invalidated verifier event
↓
Corrected testing policy π_c
↓
Would future evidence still be the same?
├ YES → deterministic statistical replay
└ NO
   ↓
 off-policy / causal reconstruction required
   ↓
 importance weighting / doubly robust / model-based world replay
```

要回答：

```text
哪一段可以 deterministic replay？
哪一段只能 statistical reweight？
哪一段需要 world model？
哪一段根本不可識別？
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Theorem-Governed Retroactive Update
Overshoot Refund
SCORE
SCORE-LORD
SCORE-SAFFRON
Retroactive Wealth Refresh
Conditional Positive Quadrant Dependence
Conditional Negative Quadrant Dependence
Conditional Sequential Validity
Repair Semantics Classifier
Counterfactual Multiplicity Replay
Replay Validity Certificate
Replay Theorem Regime
Historical Alpha Path
Corrected Alpha Path
Rejection Path Diff
Procedure Code Hash
Admissible Evidence Snapshot
Off-Policy Replayability
Policy-Coupled Evidence
Action-Dependent Evidence
Causal Replay Boundary
```

## Edges

```text
Retroactive Update
≠ Invalid Statistical Procedure Automatically

SCORE Retroactive Refresh
≠ Verifier Bug Rollback

Overshoot Refund
≠ Reward Deletion

Deterministic Replay
≠ Statistical Validity

Corrected Wealth Number
≠ Corrected Testing Trajectory

Same Evidence Log
≠ Valid Counterfactual Evidence Log

Delayed Truth Feedback
≠ Semantic Invalidation

Conditional Validity
→ Required By Sequential Guarantee

Procedure Hash
→ Determines Replay Semantics

Action-Dependent Evidence
→ Limits Deterministic Replay
```

---

# 本輪結束判定

**缺哪一層：** `Off-Policy / Causal Replay Validity Layer`。  
**哪個節點最淺：** `ReplayValidityCertificate`、`OffPolicyReplayability`、`CausalReplayBoundary`。  
**哪個概念仍只是名詞：** production-grade `Semantic-Invalidation-Safe Wealth Repair`；目前沒有足夠理論支持。  
**哪個系統值得讀原始碼：** `OliverHennhoefer/online-fdr` 的 SAFFRON / ADDIS / e-value paths，建立共同 replay IR。  
**哪篇論文需追引用：** SCORE（ICML 2026），尤其 retroactive update、CPQD/CNQD 與後續引用工作。  
**哪個概念最適合視覺模擬：** `Retroactive Wealth × Replay Validity Lab`。  
**哪個 Agent 架構最值得實作：** `Repair-Aware Online Evidence Runtime`。

---

# 對「AI 到底怎麼運作」新增的一層

長期 Agent 的 verification 並不是：

```text
證據 → 判斷 → 永久結束
```

而是：

```text
證據流
→ sequential testing
→ error-wealth accounting
→ rejection 改變後續 threshold
→ threshold 改變 Agent 的 permission / action
→ action 又改變未來資料
```

因此當歷史 evidence 後來被修正時，AI 不能只「改一格資料庫」。它必須先判斷修正屬於哪一種：是統計理論允許的 retroactive refund、合法 delayed feedback，還是上游 verifier semantic failure。只有前兩者可以直接套用既有 theorem；第三種必須進入 counterfactual replay，且一旦 Agent 過去的 action 已改變未來 observation，問題就從單純 deterministic replay 升級成 off-policy / causal reconstruction。

**本輪核心答案：合法的「回頭更新」確實存在，但不是所有 rollback 都一樣。AI runtime 必須保存 theorem regime、filtration、procedure code、rejection trajectory 與 action-causality，才能知道一個歷史修正究竟是在做合法 refund，還是在重建另一條本來沒有發生過的世界線。**