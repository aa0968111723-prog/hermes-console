# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 07:52（Asia/Taipei）**  
**本輪主題：Dynamic Hypothesis Registry × Online FDR Wealth × Dynamic e-Closure × Persistent Decisions × Certificate Supersession / Retraction**

> 本輪延續上一輪「Evidence Composition Algebra × Versioned Evidence Continuation」。上一輪已解決「同一證據流跨版本是否能合法延續」；本輪改處理更高一層問題：**當 Agent 持續新增、刪除、替換 verifier / safety hypothesis / multimodal checks 時，整個 hypothesis family 本身是動態的，錯誤率財富如何分配？舊拒絕是否仍有效？何時是 statistical reversal，何時是真正 certificate invalidation？**

---

## 一、本小時新發現

### 新論文 / 新架構

1. **Dynamic e-closure for online hypotheses with any-time-valid evidence: closure principles and projective mergers** — Rianne de Heide, 2026, arXiv:2608.09927.  
   URL: https://arxiv.org/abs/2608.09927  
   核心：同時處理「新 hypothesis 持續出現」與「舊 hypothesis evidence 持續演化」兩條 online 軸；以 future-extension coherence 取得 simultaneous stopped-FDR；若 certificate time-monotone，進一步得到 simultaneous SupFDR 與 setwise persistence。  
   重要性：這是 Hermes `DynamicHypothesisRegistry` 最直接的理論骨架。

2. **Improving online FDR procedures via online analogs of e-closure and compound e-values** — Ziyu Xu, Lasse Fischer, Aaditya Ramdas, UAI 2026.  
   URL: https://proceedings.mlr.press/v337/xu26a.html  
   核心：online e-closure + compound e-values / donations，在 arbitrary dependence 下維持 FDR control，並能以 O(log t) 算法更新 rejection decision。  
   重要性：Dynamic registry 不一定只能用傳統 LORD/SAFFRON；e-value closure 可以支撐更強 dependence robustness 與增量運算。

3. **Feedback-Enhanced Online Multiple Testing with Applications to Conformal Selection** — Lin Lu, Yuyang Huo, Haojie Ren, Zhaojun Wang, Changliang Zou, JMLR 2026.  
   URL: https://www.jmlr.org/papers/v27/25-2123.html  
   核心：Generalized alpha-investing with feedback (GAIF)，允許 hypothesis 決策後才收到 delayed / full / bandit feedback，再動態調整 future thresholds，同時提供 finite-sample FDR / mFDR guarantees。  
   重要性：Hermes verifier 執行後常會晚一段時間才知道「這個 safety alarm 是否真的成立」，feedback-aware wealth 比只有 p-value stream 更符合 Agent runtime。

4. **Carefree multiple testing with e-processes** — Yury Tavyrikov, Jelle J. Goeman, Rianne de Heide, Electronic Journal of Statistics 2026.  
   DOI: https://doi.org/10.1214/26-EJS2546  
   核心：單純把 e-BH 套在各 e-process 的 suprema 上並不能自動給 FDR control；提出使用 adjuster / running-supremum-compatible constructions，並強調 rejection persistence 問題。  
   重要性：Hermes UI 不應把「先前 rejected，後來不 rejected」全部當作 verifier failure。

### 新 GitHub / 工程實作

5. **OliverHennhoefer/online-fdr** — Python online multiple testing implementation.  
   URL: https://github.com/OliverHennhoefer/online-fdr  
   不只 README：實際追到 `online_fdr/p_values/investing/lord/plus_plus.py`、`online_fdr/core/state.py`、`online_fdr/core/utils/sequence.py`、`online_fdr/e_values/`、`online_fdr/p_values/async_methods/`。  
   `LordPlusPlus.test_one()` 真的依 hypothesis index 計算 gamma-weighted alpha，並追蹤 first / subsequent rejections；每次 test 先 spend `alpha_t`，若 reject 再獲得 reward。這可直接映射成 Hermes 的 `MultiplicityWealthLedger`。

---

## 二、本小時最重要 5 個發現

### 發現 1：Hypothesis Identity 必須是一級 runtime object，不是字串 label

#### 是什麼
Hermes 未來可能同時有：

- `H_vision_hallucination`
- `H_mcp_write_unsafe`
- `H_memory_poisoned`
- `H_user_intent_uncertain`
- `H_tool_output_schema_invalid`
- `H_agent_policy_regressed`

問題是 verifier 升版後，名字相同不代表統計上還是同一個 null。

#### 底層如何運作
需要：

```text
HypothesisIdentity
├ hypothesis_id
├ null_definition_hash
├ estimand_id
├ population_scope
├ event_schema_hash
├ verifier_family
├ verifier_version
├ filtration_id
├ arrival_time
├ retirement_time
├ replacement_of
└ semantic_equivalence_status
```

只有在 `null_definition + estimand + population + event semantics` 保持等價時，才可以把它視為同一條 hypothesis history。

#### 為什麼重要
Online FDR 的 alpha allocation 是依「過去測過哪些 hypothesis / 哪些被 reject」演化的。如果 verifier v2 實際換了 null，卻沿用 v1 的 hypothesis ID，整個 wealth history 會被污染。

#### 限制
論文通常假定 hypothesis sequence `H1,H2,...` 已定義清楚；production Agent 的 semantic identity 判定需要額外工程規則。

#### 狀態
- **已確認事實：** online multiple testing threshold 依序列歷史與 rejection history 決定。
- **工程推論：** Hermes 必須把 semantic hypothesis identity 納入 ledger。

---

### 發現 2：Alpha Wealth 是「全域共享風險預算」，不是每個 verifier 自己的 confidence

#### 底層機制：LORD++
實際 Python implementation `online_fdr/p_values/investing/lord/plus_plus.py` 中：

```text
index = num_hypotheses + 1
alpha_t = wealth0 * gamma(index)

if first_reject exists:
  alpha_t += (alpha0 - wealth0) * gamma(index-first_reject)

for subsequent rejection r:
  alpha_t += alpha0 * gamma(index-r)

alpha_t = min(alpha_t, wealth)
wealth -= alpha_t
if rejected:
  wealth += reward
```

這表示：

```text
past decisions
↓
current wealth
↓
current test level α_t
↓
current reject / no-reject
↓
future wealth
```

#### Hermes 映射

```text
MultiplicityWealthLedger
├ family_id
├ target_error_rate
├ wealth_before
├ allocated_alpha
├ wealth_after
├ reward_source
├ procedure
├ dependency_regime
└ evidence_epoch
```

Agent 每新增一個 verifier hypothesis，不應任意給 `p < .05`；它必須先向 family ledger 取得合法 `α_t`。

#### LORD / SAFFRON / ADDIS 的角色差異
- **LORD：** 主要利用 rejection history 回補 alpha wealth。
- **SAFFRON：** 另外利用 candidate threshold，集中資源在較可能非 null 的 hypothesis。
- **ADDIS：** 再對大 p-value / conservative null 做 principled discarding，改善 wealth 使用效率。

#### 重要否定關係

```text
Verifier Confidence
≠
Family Error Budget
```

---

### 發現 3：Rejection Disappeared ≠ Certificate Invalidated

這是本輪最重要的 production 區分。

#### 類型 A：Statistical Reversal / Non-persistence
`Carefree multiple testing with e-processes` 指出，在 evidence 持續演化的多重測試中，某 hypothesis 在時間 t 被 reject，之後可能因其他 stream 繼續收資料而不再位於 rejection set；普通 e-BH / running evidence 的組合不能自動保證持久性。

這不代表：

```text
舊 verifier 被證明錯誤
```

而可能只是：

```text
procedure 的當前 global rejection set 改變
```

#### 類型 B：Semantic / Validity Invalidation
例如：

```text
Verifier v7 發現 event label 定義錯誤
Null changed
Outcome transform 有 future leakage
Tool schema 更改後舊 observation 不再同義
Filtration contract 失效
```

這才是舊 certificate 真正失效。

#### 因此新增狀態機

```text
CertificateStatus
├ ACTIVE_REJECTED
├ ACTIVE_NOT_REJECTED
├ PERSISTENT_REJECTED
├ STATISTICALLY_REVERSED
├ SUPERSEDED
├ INVALIDATED
├ RETRACTED
├ QUARANTINED
└ HISTORICAL_ONLY
```

以及原因：

```text
CertificateTransitionReason
├ NEW_EVIDENCE
├ MULTIPLICITY_REALLOCATION
├ FAMILY_EXPANSION
├ VERIFIER_REPLACED
├ NULL_CHANGED
├ EVENT_SCHEMA_CHANGED
├ FILTRATION_BREACH
├ DATA_CORRECTION
└ MANUAL_REVIEW
```

#### 最重要規則

```text
Not Currently Rejected
≠
Old Certificate Invalid
```

---

### 發現 4：Dynamic e-Closure 提供「新假設加入後，舊證書仍 coherent」的正式骨架

#### 問題
Agent family 不是固定 K 個 hypotheses：

```text
t=1  Vision verifier

t=2  + MCP verifier

t=3  + Voice verifier

t=4  + New safety model
...
```

當 family 擴充時，若舊 reject certificate 的邏輯依賴「當時只有 3 個 hypotheses」，新 hypothesis 出現後可能破壞全域 coherence。

#### Dynamic e-closure 的關鍵概念
2026 dynamic e-closure 同時處理：

```text
Hypothesis axis:
H1 → H2 → H3 → ...

Evidence-time axis:
E1(t), E2(t), E3(t), ...
```

透過 **future-extension coherence**，目前 active true-null intersection 的 certificate 能與未來 terminal family 對齊；若 certificate 進一步 time-monotone，得到 setwise persistence / simultaneous SupFDR 類保證。

#### Hermes 對應
新增：

```text
HypothesisFamilyEpoch
├ family_epoch_id
├ active_hypotheses
├ future_extension_policy
├ merger_weights
├ padding_neutrality
├ closure_certificate
└ persistence_level
```

以及：

```text
PersistenceLevel
├ POINTWISE_ONLY
├ STOPPED_FDR_VALID
├ SUPFDR_VALID
└ SETWISE_PERSISTENT
```

#### 重要限制
Dynamic e-closure 是 2026 preprint，且完整 production computational strategy、權重設計與 dynamic verifier semantics 仍需工程化；不能把它宣稱為 Hermes 已被形式證明。

---

### 發現 5：Delayed Feedback 應進入 wealth allocator，而不是只寫入 audit log

#### 問題
Agent safety verifier 常有晚到 feedback：

```text
08:00 MCP write 被 safety verifier reject
08:20 human review = false alarm
09:10 downstream outcome = actually safe
```

傳統 online testing 常在 test 當下只看 p-value / rejection history。

#### 2026 GAIF
Feedback-Enhanced Online Multiple Testing 讓 truth / outcome feedback 在 decision 後才抵達，甚至可 delay、full feedback 或 bandit feedback；feedback 可改變後續 alpha-investing threshold，同時仍追求 finite-sample error guarantees。

#### Hermes 架構

```text
Hypothesis Decision
↓
Provisional Certificate
↓
Delayed Outcome / Human / Environment Feedback
↓
Feedback Attribution
↓
Multiplicity Wealth Update
↓
Future Threshold Policy
```

新增：

```text
FeedbackEvent
├ hypothesis_id
├ feedback_time
├ feedback_type
├ truth_label
├ attribution_confidence
├ delay
├ source
└ eligible_for_wealth_update
```

#### 關鍵否定關係

```text
Historical Outcome Feedback
≠
Permission To Rewrite Past α_t
```

正確作法通常是影響未來 allocation / calibration，而不是事後竄改「當時合法的 test level」。

---

## 三、Architecture Breakdown

```text
User / Goal
↓
Agent Runtime
↓
Verifier Trigger Engine
↓
Dynamic Hypothesis Registry
├ register hypothesis
├ resolve semantic identity
├ family assignment
├ hypothesis version
└ retirement / replacement
↓
Evidence Epoch Registry
↓
Multiplicity Router
├ p-value family
│  ├ LORD / LORD++
│  ├ SAFFRON
│  └ ADDIS
├ e-value family
│  ├ e-BH
│  ├ e-LOND
│  ├ online e-closure
│  └ dynamic e-closure
└ FWER-critical family
   ├ alpha spending
   └ online fallback / closure
↓
Online Risk Wealth Ledger
↓
Test-Level Allocation α_t / e-threshold
↓
Verifier Evidence
↓
Reject / No Reject
↓
Certificate Builder
├ validity contract
├ multiplicity certificate
├ filtration certificate
├ family epoch
└ persistence class
↓
Planner Gate
↓
Tool / MCP / Browser / Multimodal Action
↓
Delayed Feedback
↓
Feedback-Aware Wealth Update
↓
Certificate Status Engine
├ ACTIVE
├ PERSISTENT
├ STATISTICALLY_REVERSED
├ SUPERSEDED
├ INVALIDATED
├ RETRACTED
└ QUARANTINED
↓
Historical Audit Graph
```

---

## 四、Bottom-Level Logic

### 4.1 Online multiple testing 不是「每次各做一次 0.05 test」

錯誤版本：

```text
for verifier in verifiers:
    if p < .05:
       alarm()
```

當 verifier 無限加入時，family false-discovery risk 會失控。

正確抽象：

```text
history_{t-1}
↓
wealth / procedure state
↓
choose α_t predictably
↓
observe p_t
↓
R_t = 1[p_t ≤ α_t]
↓
update procedure state
```

`α_t` 必須由過去資訊決定，不能先看到 `p_t` 再調整到剛好 reject。

### 4.2 Hypothesis arrival 與 evidence evolution 是兩個時鐘

```text
arrival clock:
H1 ---- H2 ------- H3 --- H4

evidence clock:
E1(1) E1(2) E1(3) E1(4)...
      E2(2) E2(3) E2(4)...
                   E3(3)...
```

Hermes runtime 必須保存：

```text
hypothesis_arrival_index
observation_time
certificate_time
family_epoch
```

不能只用一個 timestamp。

### 4.3 Rejection persistence 是額外 guarantee

```text
R_t(H_i)=1
```

不能自動推出：

```text
∀s>t, R_s(H_i)=1
```

只有 procedure 有 persistence / SupFDR / setwise persistent 類保證時，UI 才能顯示：

```text
PERSISTENT_REJECTED
```

否則應顯示：

```text
CURRENTLY_REJECTED
```

### 4.4 Dynamic family expansion 需要 future-extension coherence

family 從：

```text
F_t={H1,H2,H3}
```

變成：

```text
F_{t+1}={H1,H2,H3,H4}
```

不能任意重算一個與舊 certificate 不相容的新 closure。需要明確 family-extension contract，使 old certificate 在 future family 下有可追蹤的 projection / embedding。

### 4.5 Retraction 必須可追溯

真正的 certificate retraction 至少要保存：

```text
CertificateRetraction
├ certificate_id
├ prior_status
├ new_status
├ effective_time
├ reason_code
├ invalidated_assumptions
├ affected_actions
├ affected_descendant_certificates
├ requires_replay
└ provenance
```

若 certificate 曾經允許不可逆 action：

```text
MCP_WRITE
EMAIL_SEND
DEPLOY
DELETE
```

retraction 不能「撤銷已發生的世界」，而應觸發：

```text
impact analysis
↓
compensating action
↓
human escalation if irreversible
```

---

## 五、Visual Simulation Idea

# Dynamic Hypothesis Registry × Online Error Wealth Observatory

### 畫面 A：Hypothesis Stream

```text
07:00 H1 Vision hallucination
07:02 H2 MCP unsafe write
07:08 H3 Tool schema mismatch
07:11 H4 Memory poisoning
07:25 H5 Voice intent mismatch
```

每個節點顯示：

```text
family
null version
verifier version
arrival index
current status
p/e evidence
```

### 畫面 B：Alpha-Wealth River

```text
wealth
0.05 ───────╮
            ╰─ spend H1
0.046 ──────╮
            ├ reject H2 → reward
0.071 ──────╯
        ↓ H3
        ↓ H4
```

切換：

```text
LORD++
SAFFRON
ADDIS
GAIF
Dynamic e-closure
```

讓使用者直觀看到同一組 verifier evidence 在不同 error-control assumptions 下，哪些 alarm 合法、哪些不合法。

### 畫面 C：Certificate Timeline

```text
H2 MCP unsafe write

07:02 CURRENTLY_REJECTED
07:05 PERSISTENT_REJECTED
08:00 verifier v8 deployed
08:01 SUPERSEDED
08:03 semantic-equivalence check failed
08:04 INVALIDATED
08:05 downstream certificates QUARANTINED
```

點擊 `INVALIDATED` 顯示：

```text
Reason:
Event schema changed

Affected:
certificate C201
planner decision P88
MCP action A19
```

### 畫面 D：Statistical Reversal vs True Retraction

左右雙欄：

```text
STATISTICAL REVERSAL
procedure set changed
old evidence still valid
no semantic corruption

TRUE INVALIDATION
null changed
verifier bug
future leakage
schema mismatch
```

這是最重要的教育視覺。

---

## 六、Code / GitHub

### 6.1 OliverHennhoefer/online-fdr
Repository: https://github.com/OliverHennhoefer/online-fdr

值得讀的目錄：

```text
online_fdr/
├ core/
│  ├ state.py
│  └ utils/sequence.py
├ p_values/
│  ├ investing/
│  │  ├ lord/
│  │  ├ saffron/
│  │  └ alpha/
│  ├ async_methods/
│  └ spending/
└ e_values/
```

最重要檔案：

```text
online_fdr/p_values/investing/lord/plus_plus.py
```

工程觀察：

- `LordPlusPlus` 保存 `wealth0`, current `wealth`, `first_reject`, subsequent rejection list。
- `test_one(p_val)` 先根據 index 與 rejection positions 計算 `alpha_t`。
- `alpha_t` 受 current wealth 上限限制。
- 每次 test spend alpha；reject 後獲得 `reward = alpha`。
- gamma sequence 在 `core/utils/sequence.py` 抽象化。

這顯示 production runtime 最少必須把：

```text
procedure state
hypothesis index
rejection history
wealth
sequence params
```

持久化，而不能每次 service restart 後從零重算。

### 6.2 onlineFDR R package
Docs: https://dsrobertson.github.io/onlineFDR/

值得比對：

```text
LOND
LORD / LORDdep
SAFFRON
ADDIS
LORDstar / SAFFRONstar
Alpha_spending
online_fallback
ADDIS_spending
```

尤其 asynchronous methods 對 Hermes tool jobs 很重要，因為 verifier 不一定同時開始、同時完成。

---

## 七、Papers

### Paper A
**Title:** Dynamic e-closure for online hypotheses with any-time-valid evidence: closure principles and projective mergers  
**Authors:** Rianne de Heide  
**Institution:** University of Twente / CWI research context  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2608.09927  
**Code:** 本輪未確認官方 code  
**Dataset:** 理論工作，非 dataset-driven  
**Architecture:** dynamic online hypothesis family + evolving e-process evidence + closure / projective mergers  
**Contribution:** simultaneous stopped-FDR；在 time-monotone certificate 下提供 simultaneous SupFDR 與 setwise persistence；future-extension coherence。  
**Limitations:** preprint；production computation、dynamic semantic hypothesis identity 與 Agent-runtime versioning 需另行工程化。  
**改變了什麼：** 把「online testing」由單純 `H1,H2,...` 擴張為「hypotheses arrival × evidence evolution」雙軸問題。

### Paper B
**Title:** Improving online FDR procedures via online analogs of e-closure and compound e-values  
**Authors:** Ziyu Xu, Lasse Fischer, Aaditya Ramdas  
**Institution:** UAI/PMLR research affiliations  
**Year:** 2026  
**URL:** https://proceedings.mlr.press/v337/xu26a.html  
**Code:** 本輪未確認官方 code  
**Dataset:** synthetic + real-data evaluations  
**Architecture:** online e-closure + compound e-values via donations  
**Contribution:** arbitrary-dependence FDR control、strict power improvements、O(log t) update algorithm。  
**Limitations:** hypothesis semantics / software verifier invalidation 不在理論模型內。  
**改變了什麼：** closure-based global consistency 不一定意味昂貴的全量重算，可轉成增量線上算法。

### Paper C
**Title:** Feedback-Enhanced Online Multiple Testing with Applications to Conformal Selection  
**Authors:** Lin Lu, Yuyang Huo, Haojie Ren, Zhaojun Wang, Changliang Zou  
**Institutions:** Shanghai Jiao Tong University / Nankai University 等  
**Year:** 2026  
**URL:** https://www.jmlr.org/papers/v27/25-2123.html  
**Code:** 本輪未確認  
**Dataset:** simulations + real-data applications  
**Architecture:** GAIF / adaptive feedback alpha investing / conformal testing  
**Contribution:** delayed/full/bandit feedback 可納入 threshold adaptation，維持 finite-sample FDR/mFDR guarantees。  
**Limitations:** production Agent 的 feedback attribution、label noise、semantic drift 還需另外處理。  
**改變了什麼：** outcome feedback 不再只是分析用 metadata，而可成為 future multiplicity allocation 的正式輸入。

### Paper D
**Title:** Carefree multiple testing with e-processes  
**Authors:** Yury Tavyrikov, Jelle J. Goeman, Rianne de Heide  
**Year:** 2026  
**URL:** https://doi.org/10.1214/26-EJS2546  
**Architecture:** multiple e-processes + running suprema / adjusted procedures  
**Contribution:** 揭露直接對 e-process suprema 使用 e-BH 的 failure；研究 persistence / carefree guarantees。  
**Limitations:** 不處理 software-version semantic invalidation。  
**改變了什麼：** `anytime-valid single stream` 不等於 `persistent multi-hypothesis rejection system`。

---

## 八、已確認事實 / 工程推論 / 尚未驗證假說

### 已確認事實
- LORD / SAFFRON / ADDIS 屬 online FDR family，threshold 依過去歷史動態更新。
- LORD++ 實作保存 wealth 與 rejection positions，並依 gamma sequence 分配 test level。
- Dynamic e-closure 2026 研究新 hypothesis arrival + evolving evidence，並提出 stopped-FDR / SupFDR / persistence 相關 guarantees。
- Carefree e-process multiple testing 顯示 persistent rejection 不是普通 e-BH 自動擁有的性質。
- GAIF 類方法可利用 post-decision feedback 調整 future online testing policy。

### 合理工程推論
- Hermes 應建立 persistent `DynamicHypothesisRegistry` 與 `MultiplicityWealthLedger`。
- verifier version change 應先做 null semantic equivalence，再決定 continue / supersede / retire。
- certificate status 應分「statistical reversal」與「semantic invalidation」。
- 不可逆 Agent action 應保留 certificate dependency graph，方便 retraction 後做 impact analysis。

### 尚未驗證假說
- 可否建立通用 `HypothesisSemanticEquivalenceChecker`，自動判定兩版本 verifier 是否對應同一 null。
- Dynamic e-closure 是否能在 Hermes 數百至數千 verifier 的 production latency budget 下即時運作。
- GAIF-style truth feedback 在 noisy human labels / partial attribution 下如何保持形式 guarantee。

---

## 九、Unknown / Open Questions

### 1. Verifier v1 → v2 到底是同一個 hypothesis，還是新 hypothesis？
需要形式化 semantic-diff：null、population、event transform、decision target 到底改多少才算 identity break。

### 2. Certificate 被 invalidated 後，之前由它觸發的 alpha reward 怎麼辦？
不能簡單 retroactively rewrite history，否則會造成 time-travel accounting；可能需要 append-only correction epoch / quarantine wealth，而不是重寫原 ledger。

### 3. Hypothesis 被退休後，是否仍占 dynamic closure 的未來權重？
Dynamic e-closure 的 padding neutrality / globally summable weights 給理論方向，但 Hermes 的 retired / replaced verifier 對 family accounting 的具體 policy 仍需正式設計。

---

## 十、下一輪研究

下一輪最值得研究：

# **Append-Only Multiplicity Ledger × Retroactive Invalidation × Alpha-Wealth Quarantine × Certificate Dependency Graph**

核心問題：

```text
H2 在 t=20 reject
↓
因此 LORD wealth 得到 reward
↓
H8/H9/H10 使用這筆 wealth 取得較高 α
↓
之後發現 H2 verifier 有 bug
↓
H2 certificate INVALIDATED
```

現在不能粗暴地：

```text
刪掉 H2
重新跑所有歷史
```

因為現實世界 action 已經發生。

應研究：

```text
Append-only evidence ledger
↓
Invalidation event
↓
Tainted-wealth propagation
↓
Descendant certificate graph
↓
Historical validity classification
↓
Quarantine / repair / replay
↓
Forward-safe wealth state
```

並深入：

- online alpha-investing 是否有「post-hoc invalidated rejection」的正式修復理論；
- dynamic e-closure / online closed testing 對 hypothesis retirement / replacement 的 projective consistency；
- event-sourcing / append-only ledgers 如何與 statistical guarantees 結合；
- 如何區分 `historically valid at decision time` 與 `currently trusted under corrected evidence`。

---

## 十一、Knowledge Graph 新增 Node / Edge

### Nodes

```text
Dynamic Hypothesis Registry
Hypothesis Identity
Hypothesis Semantic Equivalence
Hypothesis Family Epoch
Hypothesis Retirement
Hypothesis Replacement
Online Multiplicity Wealth
Multiplicity Wealth Ledger
Alpha Investing
LORD++ Wealth State
SAFFRON Candidate Threshold
ADDIS Discarding
Feedback-Aware Alpha Investing
GAIF
Dynamic e-Closure
Future-Extension Coherence
Projective Merger
Persistent Rejection
Setwise Persistence
Stopped FDR
SupFDR
Certificate Persistence Class
Statistical Reversal
Certificate Supersession
Certificate Invalidation
Certificate Retraction
Certificate Transition Reason
Delayed Truth Feedback
Feedback Attribution
Tainted Wealth
Historical Certificate Status
```

### Edges

```text
Hypothesis Version
REQUIRES
Semantic Identity Check

Hypothesis Family
OWNS
Multiplicity Wealth Ledger

Past Rejection
CHANGES
Future Test Level

LORD++
USES
Rejection-Reward Wealth

Dynamic e-Closure
REQUIRES
Future-Extension Coherence

Time-Monotone Certificate
SUPPORTS
Setwise Persistence

Current Rejection Loss
MAY_BE
Statistical Reversal

Verifier Semantic Change
MAY_CAUSE
Certificate Invalidation

Certificate Invalidation
MAY_TAINT
Descendant Wealth

Delayed Feedback
MAY_UPDATE
Future Wealth Allocation
```

### 新增否定關係

```text
Same Verifier Name
≠ Same Hypothesis

p < .05
≠ Family-Valid Discovery

Verifier Confidence
≠ Multiplicity Wealth

Anytime-Valid Evidence
≠ Persistent Rejection

Currently Not Rejected
≠ Certificate Invalid

Statistical Reversal
≠ Semantic Invalidation

Verifier Upgrade
≠ Automatic Hypothesis Reset

Verifier Upgrade
≠ Automatic Hypothesis Continuation

Delayed Feedback
≠ Permission To Rewrite Past Thresholds

Past Certificate Valid At Decision Time
≠ Currently Trusted Certificate
```

---

## 十二、本輪結束判定

- **缺哪一層：** Append-Only Multiplicity Ledger + Retroactive Invalidation / Tainted-Wealth Repair。
- **哪個節點最淺：** `HypothesisSemanticEquivalence`、`CertificateRetraction`、`TaintedWealth`、`HistoricalCertificateStatus`。
- **哪個概念仍只是名詞：** production 級 `Tainted-Wealth Propagation`；目前尚未找到成熟 online-FDR 理論直接處理「先前 reward 後來因 verifier bug 被語義撤銷」的情況。
- **哪個系統值得讀原始碼：** `OliverHennhoefer/online-fdr` 的 `core/state.py`、`investing/lord/plus_plus.py`、SAFFRON / ADDIS / asynchronous implementations；再追 dynamic e-closure 是否釋出 code。
- **哪篇論文需追引用：** Rianne de Heide 2026 `Dynamic e-closure for online hypotheses with any-time-valid evidence`；它最直接連到動態 hypothesis family 與 persistent certificate。
- **哪個概念最適合視覺模擬：** `Dynamic Hypothesis Registry × Online Error Wealth Observatory`，尤其「Statistical Reversal vs True Retraction」雙欄視覺。
- **哪個 Agent 架構最值得實作：** **Multiplicity-Aware Verifier Runtime**：Dynamic Hypothesis Registry + Evidence Epoch + Online Wealth Ledger + Persistence-Aware Certificate State Machine + Feedback Loop。

---

## 十三、對「AI 到底怎麼運作」新增的一層

到目前為止，可以把一個成熟 Agent 的驗證鏈補成：

```text
User says something
↓
UI
↓
Agent state / context
↓
Planner proposes action
↓
Dynamic verifier triggers
↓
Register statistical hypotheses
↓
Assign family / null / version / filtration
↓
Online multiplicity allocator
↓
Get legal α_t / e-threshold
↓
Vision / MCP / Tool / Memory / Safety evidence
↓
Reject / no-reject
↓
Certificate + persistence class
↓
Planner action gate
↓
Action
↓
Delayed feedback
↓
Update future wealth
↓
Version / semantic changes
↓
Supersede, reverse, invalidate or retract certificate
```

**本輪核心結論：AI 的 verifier 數量會隨 Agent 能力持續增加，所以「每個 verifier 看起來都很準」仍不代表整個 Agent 的警報系統可靠。成熟 Agent 必須知道自己目前同時測了多少假設、每個假設共享多少錯誤風險預算、拒絕是否具有 persistence，以及舊 verifier 升版後，歷史證書究竟只是統計上不再活躍，還是真的因語義或 validity contract 破裂而必須撤回。**
