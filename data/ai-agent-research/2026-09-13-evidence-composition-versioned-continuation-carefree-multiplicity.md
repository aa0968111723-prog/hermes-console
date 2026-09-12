# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 06:51（Asia/Taipei）**  
**本輪主題：Evidence Composition Algebra × Cross-Filtration E-Lifting × Carefree Multiplicity × Versioned Evidence Continuation × Evidence Epoch Runtime**

> 研究狀態標記：**[已確認事實]**＝論文/官方原始碼直接支持；**[工程實作]**＝可由現有理論直接落地；**[合理推論]**＝由理論外推到 Agent runtime；**[尚未驗證假說]**＝需要後續實驗或形式化證明。

---

## 一、本小時新發現

### 新論文 / 新結果

1. **Carefree multiple testing with e-processes** — Yury Tavyrikov, Jelle J. Goeman, Rianne de Heide；Vrije Universiteit Amsterdam / Leiden University Medical Center / University of Twente & CWI；2026；Electronic Journal of Statistics 20(2), DOI 10.1214/26-EJS2546。  
   URL: https://doi.org/10.1214/26-EJS2546  
   Code: 論文附錄提供模擬；本輪未發現獨立官方 repo。  
   Dataset: synthetic correlated e-process simulations。  
   Architecture: parallel e-processes → running suprema → adjuster → e-BH。  
   Contribution: 證明直接對 running maxima 套 e-BH 不保證 FDR-sup；用 adjuster 後可在 arbitrary dependence 下恢復 FDR-sup control。  
   Limitation: adjuster 付出 power/logarithmic cost；解的是 evidence validity，不是 causal identification。

2. **Combining Evidence Across Filtrations** — Yo Joong Choe, Aaditya Ramdas；INSEAD / Carnegie Mellon University；2026；JRSSB，DOI 10.1093/jrsssb/qkag058。  
   URL: https://doi.org/10.1093/jrsssb/qkag058  
   Code: https://github.com/yjchoe/CombiningEvidenceAcrossFiltrations  
   Dataset: exchangeability / randomness examples與金融資料實驗。  
   Architecture: coarse-filtration e-process → running maximum → adjuster/e-lift → fine-filtration e-process → weighted averaging。  
   Contribution: 證明不同 filtration 的 e-process 不能直接平均；adjuster 可把 coarse evidence lift 到 fine filtration，且在特定意義下是必要機制。  
   Limitation: lifting 有 logarithmic evidence cost；要求相同 null/estimand 才能直接視為同一 evidence target。

3. **Anytime-valid FDR control with the stopped e-BH procedure** — Hongjian Wang, Sanjit Dandapanthula, Aaditya Ramdas；2025；Statistics & Probability Letters 226。  
   URL: https://arxiv.org/abs/2502.08539  
   Architecture: local e-processes + global stopping rule → filtration-globalization condition → stopped e-BH。  
   Contribution: 指出 local e-process 對 local stopping 有效，不代表對 global filtration stopping 仍有效；提出排除 past confounding 的 causal condition。  
   Limitation: causal/global-filtration condition 必須被 runtime 實際驗證或由設計保證。

4. **False Discovery Rate Control with E-values** — Ruodu Wang, Aaditya Ramdas；University of Waterloo / Carnegie Mellon University；2022；JRSSB 84(3):822–852。  
   URL: https://doi.org/10.1111/rssb.12489  
   Code: https://github.com/ruoduwang/e-BH  
   Architecture: K e-values → descending order → e-BH threshold K/(αk) → rejection set。  
   Contribution: fixed-time e-BH 在 arbitrary dependence 的 e-values 下控制 FDR。  
   Limitation: 這個 fixed-time guarantee 不能自動外推成「反覆監控多條 e-process 就仍 anytime-valid」。

5. **E-values: Calibration, combination, and applications** — Vladimir Vovk, Ruodu Wang；2021；Annals of Statistics 49(3):1736–1754。  
   URL: https://arxiv.org/abs/1912.06116  
   Contribution: arbitrary dependence 下 e-values 可用 convex averaging 合併；產品則需更強 independence/sequential-conditional validity。這提供 Evidence Composition Algebra 的最基本型別規則。

---

## 二、本小時最重要 5 個發現

### 1. Same Null + Same Filtration 是「直接組合 e-process」的隱藏前提

**[已確認事實]** 同一 filtration 下，多個對同一 null 有效的 e-process 可透過非負權重且權重和為 1 的平均保持 e-validity；但若它們原本建立於不同 filtrations，coarse filtration 中的 optional-stopping validity 不會自動提升到 richer filtration。Choe & Ramdas 2026 提出的解法是先對 coarse process 的 running maximum 套 adjuster，再與 fine-filtration process 組合。

底層：

```text
E^G_t valid under G_t
F_t contains more information than G_t

naive:
γ E^F_t + (1-γ) E^G_t
→ may be invalid under F-stopping

safe:
M^G_t = sup_{s≤t} E^G_s
A(M^G_t) = e-lifted process valid in F

E_combined,t
= γ E^F_t + (1-γ) A(M^G_t)
```

**為什麼重要：** Hermes 的 Vision verifier、MCP verifier、user-feedback verifier、tool-health verifier 往往看到不同 information sets；UI 把它們都畫成 `evidence=...` 再平均，並不保證 sequential validity。

**限制：** e-lifting 付出 evidence growth cost；它修復 filtration validity，並不修復 estimand/null mismatch。

---

### 2. Evidence Composition 必須是「型別化代數」，不是 universal merge()

**[已確認事實 + 工程實作]** 本輪把上一輪的 StatisticalEvidenceType 往下一層變成 operator rules：

```text
E_VALUE ⊕ E_VALUE
same null + compatible filtration
→ weighted average valid

E_VALUE ⊗ E_VALUE
→ only if independence or sequential conditional e-validity is justified

E_PROCESS(coarse filtration)
⊕ E_PROCESS(fine filtration)
→ INVALID DIRECTLY
→ ADJUST → LIFT → AVERAGE

IDENTIFIED_SET ∩ SENSITIVITY_SET
→ structural/assumption restriction

CONFIDENCE_REGION + IDENTIFIED_SET
→ cannot blindly intersect point estimates
→ propagate sampling region through identification map

CONFORMAL_PREDICTION_SET + CAUSAL_PARAMETER_SET
→ different targets
→ compose only at decision/safety predicate layer
```

新規則：

```text
Numeric Shape Compatibility
≠
Semantic Composition Compatibility
```

**為什麼重要：** `[-.1,.4] ∩ [.2,.8]` 數學上可做，不代表統計語義上合法。

---

### 3. e-BH fixed-time valid ≠ repeated e-BH carefree-valid

**[已確認事實]** Wang & Ramdas 2022 證明 fixed-time e-BH 可在 arbitrary dependence 的 e-values 下控制 FDR。但 2026 Tavyrikov–Goeman–de Heide 顯示，多條 e-process 持續累積時，若希望 rejection 一旦成立就不會因後續收集「別條 stream」資料而反悔，直接把 e-BH 套在 running maxima 不控制 FDR-sup；需先對 maxima 套 adjusters。

另外 Wang–Dandapanthula–Ramdas 2025 指出 global stopping 也有另一層風險：local e-process 對自身 local filtration 有效，不代表 common global stopping time 下仍是 e-value。

因此 Hermes 要分三層：

```text
1. Single stream anytime validity
2. Cross-stream filtration validity
3. Multiple-testing-over-time validity
```

不能只標一個：

```text
ANYTIME_VALID = true
```

建議改成：

```text
AnytimeMultiplicityCertificate
├ local_process_validity
├ global_filtration_validity
├ cross_stream_dependence_mode
├ multiplicity_rule
├ running_max_adjuster
├ fdr_target
├ monotone_rejection_guarantee
└ status
```

---

### 4. Agent 版本升級不一定要 reset e-wealth；真正邊界是 Validity Contract 是否保持

**[合理推論，直接建基於 e-process conditional-validity 理論]** 模型從 v12 換到 v13、planner 換 prompt、betting strategy 換參數，本身不必然破壞 e-process。若新一輪 factor `L_t` 是根據過去資訊可預測地選擇，而且在同一 null 與 filtration 下仍滿足：

```text
E[L_t | F_{t-1}, H0] ≤ 1
```

那麼累積：

```text
E_t = E_{t-1} × L_t
```

仍可延續。

真正應觸發 reset / quarantine 的是：

```text
null / estimand changed
population semantics changed
outcome label definition changed
observation transform uses future leakage
filtration enlarged without e-lifting/globalization
assignment/verification policy invalidates conditional e-factor proof
tool schema changes meaning of event labels
historical rows were reinterpreted after seeing outcomes
```

所以版本管理不應是：

```text
model_version changed → reset
```

而應是：

```text
ValidityContractHash changed?
↓
semantic diff
↓
CONTINUE / LIFT / BRIDGE / QUARANTINE / RESET
```

---

### 5. 跨版本 evidence 最安全的單位不是一條永生的 wealth，而是 Versioned Evidence Epoch

**[工程實作 + 尚未驗證假說]** 為避免 Hermes 把已失效的舊證據和新 runtime 強行相乘，本輪建立：

```text
EvidenceEpoch
├ epoch_id
├ null_id
├ estimand_id
├ population_id
├ filtration_schema_hash
├ event_schema_hash
├ observation_transform_hash
├ assignment_policy_hash
├ verifier_code_hash
├ betting_rule_hash
├ start_time
├ end_time
├ terminal_e_value
├ alpha_spent
├ validity_status
└ continuation_parent
```

跨 epoch 只允許四類 edge：

```text
CONTINUES_VALIDLY
E_LIFTED_INTO
MERGED_AS_E_VALUES
QUARANTINED_FROM
```

重要規則：如果無法證明 epoch 2 的 factor 對 epoch 1 延續後的 global filtration 仍 conditionally e-valid，**不要直接 `E_total = E1 × E2`**。可以 freeze `E1`，讓 `E2` 自成新 epoch，再在符合條件時用 e-merging/adjust-then-combine 處理。

---

## 三、Architecture Breakdown

### Evidence Algebra Runtime

```text
UI / Agent / Tool / MCP / Vision / Audio Events
↓
Typed Event Ledger
↓
Evidence Constructor Registry
├ e-process
├ confidence sequence
├ identified set
├ sensitivity set
├ conformal set
├ posterior
└ diagnostic
↓
Evidence Type Checker
↓
Target Alignment
├ null
├ estimand
├ population
├ time horizon
└ action semantics
↓
Filtration Graph
├ what each stream can see
├ local stopping rule
├ global stopping rule
└ cross-stream dependencies
↓
Composition Planner
├ average
├ product
├ intersection
├ projection
├ e-lift + average
├ e-BH
└ adjusted-running-max e-BH
↓
Multiplicity Ledger
↓
Version Continuation Gate
↓
Evidence Epoch Graph
↓
Decision Certificate
↓
Planner / Tool / MCP Action
```

### Version update path

```text
Agent v12
↓
Evidence Epoch E12
↓
Deploy v13
↓
Validity Contract Diff
├ only predictable strategy changed
│  → CONTINUE
├ filtration became richer
│  → attempt E-LIFT
├ same null but cannot prove conditional continuation
│  → FREEZE + NEW EPOCH + MERGE LATER
├ null/estimand/event semantics changed
│  → RESET / QUARANTINE
└ unknown
   → NO AUTOMATIC CARRYOVER
```

---

## 四、Bottom-Level Logic

### 4.1 Convex e-merging

如果對同一 null：

```text
E[E_i] ≤ 1
w_i ≥ 0
Σ w_i = 1
```

則：

```text
E_merge = Σ w_i E_i
E[E_merge] ≤ 1
```

不要求 e-values 彼此 independent。這是 Hermes 最安全的 static evidence merge primitive。

### 4.2 Product requires stronger structure

```text
E_product = Π L_t
```

若每個 `L_t` 滿足：

```text
E[L_t | F_{t-1}, H0] ≤ 1
```

則乘積形成 nonnegative supermartingale / e-process。若只知道每個 factor marginally 是 e-value，但 dependence 未建模，直接相乘並不自動合法。

### 4.3 E-lifting

對 coarse-filtration e-process：

```text
M_t = sup_{s≤t} E_s
```

用 adjuster `A`，其核心積分條件為：

```text
∫_1^∞ A(e)/e² de ≤ 1
```

則 `A(M_t)` 可被 lift 成 finer filtration 中的有效 e-process。官方 code 的 default mixture adjuster 實際實作：

```text
A(e) = (e - 1 - log e) / (log e)^2
```

並先使用 `np.maximum.accumulate(e)` 建 running maximum。

### 4.4 e-BH threshold

排序 e-values `E_[1] ≥ ... ≥ E_[K]`，找最大 `k` 使：

```text
E_[k] ≥ K / (α k)
```

拒絕 top-k。官方 `ruoduwang/e-BH` R code 透過排序和 `K/alpha/(K-k+1)` threshold 實作同一結構。

### 4.5 Cross-version continuation test

本輪提出 Hermes 的工程判定：

```text
CanContinue(epoch_old, runtime_new)
=
SameTarget
∧ EventSemanticsPreserved
∧ FiltrationCompatible
∧ PredictableUpdate
∧ ConditionalEValidityPreserved
∧ NoOutcomeDependentRetroactiveRewrite
```

其中任何一項未知：

```text
UNKNOWN ≠ TRUE
```

應進入 `FREEZE_AND_NEW_EPOCH`，而不是自動 carry wealth。

---

## 五、Visual Simulation Idea

# Evidence Algebra × Version Continuation Lab

### 畫面 A：Evidence Composition Matrix

```text
              E-val   E-proc   CS   ID-set   Sens-set   Conformal
E-val           AVG     *       ✕      ✕        ✕          ✕
E-proc          *     AVG/LIFT   ✕      ✕        ✕          ✕
CS              ✕       ✕       ∩*    MAP       MAP         ✕
ID-set          ✕       ✕      MAP     ∩         ∩          ✕
Sens-set        ✕       ✕      MAP     ∩         ∩          ✕
Conformal       ✕       ✕       ✕      ✕         ✕      DECISION
```

點 `*` 顯示 prerequisite：

```text
Same null?
Same filtration?
Dependence known?
Same estimand?
Time-uniform?
```

### 畫面 B：Filtration Graph

```text
              Global F_t
          /       |        \
     Vision Gv   MCP Gm   User Gu
        |          |        |
      E_v        E_m      E_u
```

若 MCP stream 在 `Gm` 有效、但 planner 用 `F_t` 決定何時停止，畫面顯示：

```text
LOCAL VALID ✓
GLOBAL VALID ?
E-LIFT REQUIRED ⚠
```

### 畫面 C：Version Timeline

```text
v12 ────────────┐
E-wealth 38.2   │
                ├─ model update
v13 ────────────┘

Contract diff:
null              SAME ✓
filtration         CHANGED ⚠
event schema       SAME ✓
assignment policy  CHANGED ⚠

Decision:
FREEZE v12
START epoch v13
DO NOT MULTIPLY
```

### 畫面 D：Carefree Multiplicity

同時顯示：

```text
Raw e-BH
Running-max e-BH
Adjusted-running-max e-BH
```

並讓使用者逐步增加不同 stream 的資料，看 rejection set 是否出現 `rejected → unrejected` 或 FDR-sup validity warning。

---

## 六、Code / GitHub

### `yjchoe/CombiningEvidenceAcrossFiltrations`

Repo: https://github.com/yjchoe/CombiningEvidenceAcrossFiltrations

值得讀：

```text
ecombine/
├ calibrators.py
├ eprocesses.py
├ diagnostics.py
├ plotting.py
└ utils.py

nb_adjusters.ipynb
nb_exchangeability_adjuster_power.ipynb
nb_compare_kstep_forecasters.ipynb
```

**已確認原始碼機制：**
- `calibrators.py`：`adjuster()` 預設先 `np.maximum.accumulate(e)`；提供 mixture/Koolen-Vovk/zero/kappa adjusters。
- `eprocesses.py`：`combined_exch_eprocesses()` 對 `needs_adj=True` 的 stream 先 `adjuster()`，再以 `np.mean(...)` 合併；這就是 production 可借用的 `adjust-then-combine` pattern。
- 同檔亦用 log-domain cap 計算 universal e-process，避免 e-value 指數爆炸。

### `ruoduwang/e-BH`

Repo: https://github.com/ruoduwang/e-BH

值得讀：

```text
R codes for z-tests
R codes for MAB
```

`R codes for z-tests` 中 `ReBH()` 直接排序 e-values 並逐步檢查 e-BH threshold；同一實驗亦對比 BH、BY、e-BH 與 dependence-specific boosting。

---

## 七、Papers

| Title | Authors | Institution | Year | Code | Dataset / Experiment | 改變了什麼 | 主要限制 |
|---|---|---|---:|---|---|---|---|
| Carefree multiple testing with e-processes | Tavyrikov, Goeman, de Heide | VU Amsterdam / LUMC / UTwente-CWI | 2026 | appendix simulation | correlated e-process simulations | 把 sequential multiplicity 的目標從 pointwise FDR 推到 FDR-sup，證明 running max 需 adjuster | power cost；不處理 causal target mismatch |
| Combining Evidence Across Filtrations | Choe, Ramdas | INSEAD / CMU | 2026 | yjchoe/CombiningEvidenceAcrossFiltrations | exchangeability/randomness/financial | 建立跨 filtration 的 adjust-then-combine algebra | e-lifting 有 logarithmic cost |
| Anytime-valid FDR control with stopped e-BH | Wang, Dandapanthula, Ramdas | CMU 等 | 2025 | paper | theoretical examples | 揭示 local-vs-global filtration stopping subtlety | global causal condition需成立 |
| False Discovery Rate Control with E-values | Wang, Ramdas | Waterloo / CMU | 2022 | ruoduwang/e-BH | z-tests, MAB, finance | fixed-time e-BH under arbitrary dependence | 不自動給 repeated global stopping validity |
| E-values: Calibration, combination, and applications | Vovk, Wang | Royal Holloway / Waterloo | 2021 | — | theory/examples | 建立 e-value calibration/merging 基礎 | 不等於多-stream sequential orchestration完整解法 |

---

## 八、Unknown / Open Questions

### 1. Cross-version e-wealth 的「形式化 continuation theorem」

現在可以由 supermartingale conditional-validity合理推出 continuation contract，但 Hermes 尚缺一個針對：

```text
model update
prompt update
tool update
verifier update
schema update
```

逐項可機器檢查的 sufficient conditions。

### 2. Dynamic hypothesis family

Agent runtime 會新增/刪除 verifier 與安全假設；hypothesis family `H_1,H_2,...` 本身會變。如何在這種 dynamic registry 下做 FDR/FWER/true-discovery accounting，而不是固定 K，是下一層問題。

### 3. Evidence invalidation 後的 historical decision semantics

若 v13 發現 v12 filtration contract 無效：

```text
過去 v12 的 decision certificate
要標 STALE？
RETRACTED？
VALID_AT_TIME_BUT_NOT_REUSABLE？
```

這牽涉 audit/provenance，不只是統計量 reset。

---

## 九、下一輪研究

下一輪優先：

# Dynamic Hypothesis Registry × Online FDR Wealth × Evidence Invalidation × Certificate Retraction

研究鏈：

```text
Agent adds/removes verifiers
↓
Dynamic hypothesis identities
↓
Online multiplicity ledger
↓
Alpha/evidence budget allocation
↓
Version invalidation event
↓
Which old rejections remain historically valid?
↓
Which evidence can still be reused?
↓
Certificate retraction / supersession graph
↓
Planner behavior
```

具體要追：
- LORD / SAFFRON / ADDIS 的 online FDR budget logic；
- e-value based online closed testing / SeqE-Guard；
- carefree multiple testing 的 adjuster power tradeoff；
- global-filtration stopped e-BH 的 causal condition如何轉成 Agent event DAG；
- evidence revocation是否需要「statistical tombstone」而非刪除歷史紀錄。

---

## 十、Knowledge Graph 新增 Node / Edge

### 新 Nodes

```text
Evidence Composition Algebra
Evidence Merge Operator
Filtration Compatibility
Filtration Graph
Coarse Filtration
Fine Filtration
E-Lifting
Adjuster
Running-Maximum E-Process
Cross-Filtration Evidence
Global Filtration Validity
Local Filtration Validity
Carefree Multiplicity
FDR-Sup
Adjusted Running-Max e-BH
Multiplicity Certificate
Versioned Evidence Continuation
Evidence Epoch
Validity Contract Hash
Continuation Gate
Evidence Quarantine
Frozen E-Wealth
Cross-Epoch E-Merging
Dynamic Hypothesis Registry
Historical Certificate Status
```

### 新 Edges

```text
Same Numeric Shape ≠ Same Statistical Semantics
Same Null ≠ Same Filtration
Local Anytime Valid ≠ Global Anytime Valid
Fixed-Time e-BH Valid ≠ Carefree Sequential e-BH Valid
Running Maximum ≠ E-Value Automatically
Model Version Change ≠ Evidence Reset Automatically
Version Continuity ≠ Validity Continuity
Marginal E-Validity ≠ Product E-Validity
Averaging E-Values ≠ Multiplying E-Values
Filtration Expansion → May Require E-Lifting
Unknown Continuation Validity → Freeze And New Epoch
Old Evidence Invalid For Reuse ≠ Historical Record Should Be Deleted
```

---

## 十一、本輪結束判定

- **缺哪一層：** Dynamic Hypothesis Registry + Online Multiplicity Wealth + Certificate Retraction Semantics。
- **哪個節點最淺：** `VersionedEvidenceContinuation`、`CrossEpochEMerging`、`HistoricalCertificateStatus`。
- **哪個概念仍只是名詞：** production 級 `ValidityContractHash` 的形式化 schema 與自動 proof checker。
- **哪個系統值得讀原始碼：** `yjchoe/CombiningEvidenceAcrossFiltrations/ecombine/calibrators.py`、`eprocesses.py`；下一輪再讀 onlineFDR / SeqE-Guard implementation。
- **哪篇論文需追引用：** 2026 **Combining Evidence Across Filtrations** 與 2026 **Carefree multiple testing with e-processes**。
- **哪個概念最適合視覺模擬：** `Evidence Algebra × Version Continuation Lab`。
- **哪個 Agent 架構最值得實作：** **Versioned Evidence Algebra Runtime**。

---

## 十二、對「AI 到底怎麼運作」新增的還原層

現在完整鏈不應只是：

```text
User
→ UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tool/MCP
→ Model/GPU
→ Output
```

還必須加入：

```text
Observation Streams
→ Evidence Constructors
→ Information Filtrations
→ Statistical Validity Contracts
→ Evidence Composition Algebra
→ Multiplicity Accounting
→ Version Continuation Gate
→ Decision Certificate
→ Planner Action
```

多模態亦同：

```text
Camera / Image / Voice / Video
→ Encoder / Tokens
→ Fusion
→ Multimodal Agent State
→ Vision/Audio/Tool Verifiers
→ separate evidence streams
→ filtration alignment
→ e-lift / merge / multiplicity control
→ decision certificate
→ Action
```

**本輪核心結論：成熟 Agent 不能只保存「證據值」，而必須保存證據的型別、null/estimand、資訊 filtration、multiplicity context 與版本 validity contract。模型升級本身不是 reset 原因；真正的 reset 邊界，是這些數學 validity conditions 是否仍成立。當不同 evidence stream 看見不同資訊時，必須先修復 filtration validity，再談 evidence fusion。**