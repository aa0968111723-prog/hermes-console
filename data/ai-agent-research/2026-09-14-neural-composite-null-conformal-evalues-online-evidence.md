# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-14 09:55（Asia/Taipei）  
**本輪主題**：Neural Composite Null × Conformal/Predictive E-values × Conditional Online Evidence × Multimodal Evidence Provenance  
**研究位置**：承接上一輪 `Composite-Null E-Process × Universal Inference × Multimodal Evidence Fusion`，本輪刻意不再重複 UI / RIPr / generic e-merging，而處理「沒有 tractable likelihood 的 neural world model，如何把 predictive residual 轉成可連續監控、可合併、可追溯來源的統計證據」。

---

## 0. 本輪與歷史研究的差異

上一輪已經確立：

```text
Reject one fitted model
≠ Reject composite model class

Two modalities
≠ Two independent pieces of evidence

Representation fusion
≠ Evidence fusion
```

但仍留下三個缺口：

1. VLM / LLM / voice / tool-health model 往往沒有可直接計算的 likelihood，Universal Inference 不一定可直接套用。
2. Conformal prediction 可給 marginal / finite-sample coverage，但 marginal validity 並不自動變成 sequential conditional validity。
3. 多模態 evidence 的依賴性不是只有 correlation；真正重要的是它們是否共享 calibration set、raw event、encoder、context、memory、controller、model checkpoint。

本輪將這三個缺口整合成：

```text
Neural predictor
↓
Nonconformity / predictive residual
↓
Calibration regime
↓
Conformal p-value / risk score
↓
P→E / test-safe conversion
↓
Conditional validity audit
↓
Per-modality evidence certificate
↓
Evidence provenance graph
↓
Dependence-aware fusion
↓
Global anytime model-class evidence
```

---

# 1. 本小時新發現

## 新論文 / 新方法

### A. Set-Preserving Calibration from Conformal P-Values to E-Values
- **Title**：Set-Preserving Calibration from Conformal P-Values to E-Values
- **Authors**：Nabil Alami, Jad Zakharia, Souhaib Ben Taieb
- **Year**：2026
- **URL**：https://arxiv.org/abs/2606.03600
- **Code**：https://github.com/Nabil-Ala/P2E_calibration
- **Architecture / Method**：conformal p-value → specially constructed P2E calibrator → e-value；目標是保留原 conformal prediction set，同時取得 e-value 在 merging / randomization 上的彈性。
- **Contribution**：指出經典 p-to-e calibrator 在 conformal prediction 中可能破壞 prediction-set efficiency；提出 set-preserving P2E calibrator，並應用到 cross-conformal prediction / conformal aggregation。
- **Limitations**：其 validity 仍依賴 conformal setup 的交換性 / calibration assumptions；「每一筆 conformal e-value 合法」不自動推出「跨時間乘積是合法 e-process」。
- **改變了什麼**：讓 Hermes 有一條不用 neural likelihood 也能把 predictive uncertainty 轉成 e-value 的工程路徑，但必須額外建立 sequential validity layer。

### B. Anytime-Valid Federated Conformal RAG for LLM Swarms
- **Authors**：Prasanjit Dubey, Xiaoming Huo
- **Year**：2026 preprint
- **URL**：https://arxiv.org/abs/2605.29139
- **Dataset / evaluation**：MMLU, DBpedia, AG News；GPT-2-small + MiniLM swarm
- **Architecture**：federated conformal RAG + calibration-good event + truncated betting e-process + predictable adaptive controller。
- **Contribution**：直接指出 naive composition 失敗：固定時點的 marginal conformal coverage 不足以保證 betting process 是 supermartingale；作者用 summable calibration-deviation budget 把 marginal guarantee 升級成可供 time-uniform alarm 使用的條件結構。
- **Limitations**：是特定 FC-RAG setup；不能直接當作 arbitrary multimodal agent 的通用定理。
- **改變了什麼**：Hermes 必須新增 `CalibrationRegimeContract`，明確區分 `MARGINAL_VALID` 與 `CONDITIONAL_SEQUENTIAL_VALID`。

### C. Conformal Selective Acting: Anytime-Valid Risk Control for RLVR-Trained LLMs
- **Authors**：Hamed Khosravi, Xiaoming Huo
- **Year**：2026 preprint
- **URL**：https://arxiv.org/abs/2605.20270
- **Architecture**：每個 trust threshold 維護 e-process，在 RLVR filtration 下允許 predictable updates，最後用 max-certified-threshold 決定是否 act / abstain。
- **Contribution**：把 conformal/e-process 從 prediction set 推進到「Agent 是否有資格行動」的部署側 wrapper。
- **Limitations**：方法依賴其 selective-risk 與 calibration assumptions；不代表任意 LLM confidence score 都能直接轉成合法 e-factor。
- **改變了什麼**：提供 Hermes `Evidence → Permission` 的直接工程對照：evidence wealth 不只是 dashboard 指標，而可以成為 risk-gated action release condition。

### D. NxN E-valuation: Hypothesis Certification via a Conformal CRT Null
- **Authors**：Bin Wang, Yan Zhong
- **Year**：2026 preprint
- **URL**：https://arxiv.org/abs/2608.06621
- **Architecture**：利用資料樣本互相作為 conditional-randomization-style null reference，為 LLM 生成 hypothesis 建立 e-value certification。
- **Contribution**：特別針對 LLM-based exploration：LLM 負責 proposal，不再讓同一 LLM 做 circular self-verification；把「產生假說」與「認證假說」分離。
- **Limitations**：要求足夠資料且 hypothesis 能作用到 individual samples；仍不是 arbitrary causal/mechanistic truth certification。
- **改變了什麼**：支援 Hermes 的重要 runtime 原則：`Generator ≠ Certifier`。

### E. The E-measure
- **Author**：Nick W. Koning
- **Year**：2026 preprint
- **URL**：https://arxiv.org/abs/2604.20788
- **Method**：把單一 hypothesis 的 e-value 推廣到 hypothesis classes，並用 infimum-style compatibility 建立 evidence map。
- **Contribution**：對 Hermes 很重要，因為真實世界的 Agent 並不是只有 `model correct / wrong`，而是一整個 partial-order hypothesis family（tool healthy、camera calibrated、memory fresh、policy safe…）。
- **Limitations**：概念層到 production multimodal runtime 還有很大距離。

---

# 2. 本小時最重要 5 個發現

## 發現 1：Neural residual 不能直接叫 evidence

### 概念
LLM / VLM / speech / tool model 通常輸出：

```text
prediction
confidence
logit
embedding distance
reconstruction loss
nonconformity score
```

它們最多先是 **score**。

### 底層如何運作
真正要從 neural predictor 得到可驗證 evidence，至少需要：

```text
Input X_t
↓
Neural predictor f_θ
↓
Prediction Ŷ_t / distribution surrogate
↓
Nonconformity score S_t
↓
Calibration reference {S_i}
↓
Conformal rank / p-value
↓
P-to-E calibration or test-safe construction
↓
E_t
```

其中 split conformal 的基本邏輯可抽象為：

```text
p_t
≈
(1 + #{i : S_i ≥ S_t})
─────────────────────
(n_cal + 1)
```

然後 P2E 將 conformal p-value 經特定 calibrator 映射成 e-value。

### 為什麼重要
Hermes 不應把：

```text
VLM cosine drift = .42
```

直接升級成：

```text
E = 5.7
```

中間需要可稽核的 calibration chain。

### 限制
Conformal validity 本身依賴 exchangeability 或對應的非交換式 extension；若 calibration distribution 已過期，p-value/e-value lineage 也會失效。

### 來源
- https://arxiv.org/abs/2606.03600
- https://github.com/Nabil-Ala/P2E_calibration

---

## 發現 2：Marginal conformal validity ≠ sequential e-process validity

### 概念
這是本輪最重要的底層修正。

### 底層如何運作
假設每一輪都有：

```text
P(error_t ≤ threshold) ≥ 1 - α
```

這通常只是 marginal statement。

但要合法連乘：

```text
E_T = ∏ e_t
```

需要接近：

```text
E[e_t | F_{t-1}] ≤ 1
```

也就是 conditional-on-history 的條件控制。

如果 calibration sample 在某些 realization 下特別差，可能出現：

```text
marginally valid across calibration draws
but
conditional expectation > 1
on adverse calibration draws
```

此時 naive product 就不再是 nonnegative supermartingale。

### 為什麼重要
Agent 天生是 adaptive：

```text
上一輪 evidence
→ 決定這輪要查 Camera / Tool / Memory
→ 得到新 observation
→ 再改下一輪行動
```

所以固定時點的 coverage 遠遠不夠。

### 限制
如何對 arbitrary neural multimodal agent 建立 generic conditional validity 仍未解。

### 來源
- https://arxiv.org/abs/2605.29139
- Anytime-valid sequential testing background：https://doi.org/10.1093/jrsssb/qkag050

新增核心否定 edge：

```text
Marginal Conformal Validity
≠
Sequential Conditional E-Validity
```

---

## 發現 3：Predictable controller 是 Agent 自適應與統計有效性之間的接口

### 概念
Agent 可以 adaptive，但本輪 decision rule 必須只看過去。

### 底層如何運作
令：

```text
F_{t-1} = 所有到 t-1 為止已看見的事件
```

則：

```text
threshold_t
bandwidth_t
retrieval_budget_t
model_route_t
bet_t
```

都可以是 `F_{t-1}` 的函數。

但不能：

```text
先看 O_t
↓
再回頭挑最有利 threshold_t / calibrator_t / modality weight_t
```

因此 Hermes 應固定：

```text
PredictableEvidencePlan
├ filtration_hash
├ selected_modalities
├ calibration_snapshot
├ p_to_e_calibrator
├ modality_weights
├ fusion_rule
├ release_threshold
└ frozen_before_observation
```

### 為什麼重要
這是 Agent Planner 和 Evidence Runtime 的 boundary。

```text
Planner
可以自由適應

Evidence construction at round t
必須 pre-outcome frozen
```

### 來源
- https://arxiv.org/abs/2605.29139
- https://arxiv.org/abs/2605.20270

---

## 發現 4：Generator ≠ Certifier，尤其對 LLM hypothesis generation

### 概念
LLM 很擅長：

```text
propose explanation
propose causal edge
propose anomaly reason
propose tool-failure hypothesis
```

但讓同一 reasoning trace 再說「我驗證過了」會產生 circular verification。

### 底層如何運作
應拆成：

```text
LLM / Agent Generator
↓
Hypothesis H
↓
Certification Dataset / Null Mechanism
↓
Statistical Certifier
↓
E-value / rejection evidence
↓
Knowledge Graph admission
```

NxN E-valuation 的核心精神就是把 hypothesis generation 與 e-value certification 分開。

### Hermes 對應
新增：

```text
KnowledgeNodeAdmissionContract
├ proposed_by
├ hypothesis_text
├ operational_test
├ certification_dataset
├ null_family
├ evidence_value
├ certifier_id
├ data_reuse_status
└ admission_status
```

### 限制
Statistical certification 不等於 mechanistic truth；如果 hypothesis operationalization 本身錯誤，certifier 只能驗證錯誤問題。

### 來源
- https://arxiv.org/abs/2608.06621

---

## 發現 5：Evidence dependency 應追「共同祖先」，不能只估 correlation

### 概念
上一輪已有 `MultimodalEvidenceDependencyGraph`，本輪把依賴根因再往下拆。

### 底層如何運作
以下四份 evidence：

```text
Camera e-value
Voice e-value
DOM e-value
Tool e-value
```

可能表面低相關，但實際共享：

```text
same user action
same timestamp
same retrieved context
same base VLM
same calibration set
same world-model residual
same planner decision
```

因此 dependence provenance 應追：

```text
Raw Event
↓
Sensor Observation
↓
Encoder
↓
Representation
↓
Predictor
↓
Calibration Set
↓
Conformal Score
↓
E-value
```

若兩個 e-value 共享上游 ancestry，Hermes 至少應標記為：

```text
DEPENDENCE_UNKNOWN
or
SHARED_SOURCE
```

而不是直接 product。

### 新 primitive

```text
EvidenceAncestryRecord
├ evidence_id
├ raw_event_ids[]
├ sensor_ids[]
├ encoder_versions[]
├ predictor_versions[]
├ calibration_snapshot_ids[]
├ context_snapshot_id
├ memory_snapshot_id
├ planner_round_id
└ parent_evidence_ids[]
```

### 為什麼重要
「在線學 correlation」本身仍可能漏掉 conditional dependence。真正 production-safe 的融合首先需要 lineage，統計 dependence estimation 是第二層。

---

# 3. Architecture Breakdown

## Neural Composite-Null Evidence Runtime

```text
USER / CAMERA / IMAGE / VOICE / VIDEO
DOM / TOOL / MCP / MEMORY
↓
Raw Event Ledger
↓
Evidence Provenance + Ancestry Graph
↓
┌─────────────────────────────────────┐
│ Neural Predictive Models            │
│ VLM / ASR / Tool Health / RAG / KG  │
└─────────────────────────────────────┘
↓
Predictive Output
↓
Nonconformity / Risk / Residual Layer
├ classification residual
├ ranking residual
├ reconstruction residual
├ calibration error
├ intervention-response residual
└ policy-risk score
↓
Calibration Regime Contract
├ EXCHANGEABLE_SPLIT
├ CROSS_CONFORMAL
├ ONLINE_CONDITIONAL
├ SHIFT_ADJUSTED
├ FEDERATED
└ UNSUPPORTED
↓
Conformal p-value / calibrated score
↓
Evidence Constructor Router
├ P2E_SET_PRESERVING
├ SAFE_COMPOSITE_E
├ CONDITIONAL_E_FACTOR
├ UNIVERSAL_SPLIT_E
├ SEQUENTIAL_MC_E
└ HEURISTIC_ONLY
↓
Per-Evidence Validity Certificate
↓
PredictableEvidencePlan
↓
Evidence Dependency / Ancestry Graph
↓
Fusion Router
├ sequential conditional product
├ independent product
├ valid e-merge
├ source-cluster merge
└ DO_NOT_MERGE
↓
Global Model-Class E-Process
↓
Model / Hypothesis Certificate
↓
Knowledge Graph Admission
+
Permission Gate
```

---

# 4. Bottom-Level Logic

## 4.1 P2E calibrator 的工程意義

官方 `Nabil-Ala/P2E_calibration` code 中，`e-ccp/eccp_utils.py` 真的不是只放模型訓練，而明確實作：

```python
get_C_s(alpha, n_calib)
f_p_to_e(x, alpha, C, s)
set_cc(...)
set_cc_eval(...)
```

其中 calibrator 使用 numerically stable logistic，並解一個 calibration equation 取得 `C, s`；之後：

```text
p
↓
logistic[C(p-s)]
↓
normalize by α · f(α)
↓
e-value
```

而 prediction set 則由：

```text
p > α
```

對應為 e-value 空間中的：

```text
e < 1/α
```

這就是「set-preserving」對 Hermes 最重要的工程直覺：

```text
換 evidence representation
不一定要改變原本 prediction / abstention boundary
```

官方 code 結構：

```text
P2E_calibration/
├ README.md
├ e-ca/
└ e-ccp/
   ├ data_loader.py
   ├ datasets/
   ├ eccp_utils.py
   ├ main.py
   ├ plot_cross_vs_tree.py
   └ requirements.txt
```

值得優先看的檔案：

```text
e-ccp/eccp_utils.py
  ├ get_C_s
  ├ f_p_to_e
  ├ set_cc
  ├ set_cc_eval
  └ cross-conformal methods

e-ccp/main.py
  └ experiment orchestration
```

## 4.2 Hermes 需要的「雙 validity」

每份 evidence 至少要有兩個不同欄位：

```text
PointwiseValidity
SequentialValidity
```

例如：

```text
CameraResidualE-17

pointwise:
CONFORMAL_VALID

sequential:
NOT_ESTABLISHED
```

這種 evidence 可以用於：

```text
single-round warning
single snapshot diagnostics
```

但不能自動用於：

```text
wealth_t = wealth_{t-1} × e_t
```

新的證書：

```text
EvidenceValidityCertificate
├ evidence_id
├ null_scope
├ calibration_regime
├ pointwise_validity
├ conditional_validity
├ anytime_validity
├ filtration_scope
├ exchangeability_scope
├ shift_scope
├ data_reuse_status
├ allowed_composition_rules[]
└ expiration_conditions[]
```

---

# 5. Visual Simulation Idea

# Neural Evidence Factory × Conformal-to-E × Anytime Validity Lab

## 畫面 1：從 neural score 到 evidence

```text
VLM prediction
"tool panel is healthy"
confidence .93
        ↓
nonconformity score
0.18
        ↓
calibration ranks
[ .04 .08 .11 ... .72 ]
        ↓
conformal p = .21
        ↓
P2E calibrator
        ↓
e = 2.7
```

UI 在每一層標：

```text
MODEL OUTPUT
SCORE
CALIBRATED P
EVIDENCE
```

避免使用者把四者混為一談。

## 畫面 2：Marginal vs Sequential

左邊開關：

```text
Calibration assumption
[✓] Exchangeable fixed-horizon
[ ] Conditional online validity
```

畫面：

```text
Round 1 e = 1.8
Round 2 e = 2.3
Round 3 e = 1.9

Naive product = 7.866
```

若只有 marginal validity：

```text
⚠ PRODUCT DISABLED
Reason:
conditional E[e_t | F_{t-1}] ≤ 1
not established
```

切換成 valid sequential calibration 後才允許：

```text
GLOBAL WEALTH = 7.866
```

## 畫面 3：Evidence ancestry

```text
User Event U-91
├ Camera frame F-21
│  └ VLM-8
│     └ CalSet-C3
│        └ E_cam
├ Voice chunk A-88
│  └ AudioModel-5
│     └ CalSet-C3
│        └ E_voice
└ DOM snapshot D-4
   └ Parser-9
      └ CalSet-C3
         └ E_dom
```

三者共享 `CalSet-C3`，因此 UI 顯示：

```text
DEPENDENCE RISK:
SHARED CALIBRATION SOURCE

naive product: BLOCKED
```

## 畫面 4：Agent permission

```text
Global evidence          9.4
Anytime validity         PASS
Evidence independence    PARTIAL
Risk bound               PASS

READ_ONLY                ALLOW
WRITE_INTERNAL           ALLOW
WRITE_EXTERNAL           VERIFY
DELETE / TRANSFER        BLOCK
```

這能把統計 evidence 直接連到 Agent runtime，而不是停在論文展示。

---

# 6. Code / GitHub

## 本輪深入 repository

### `Nabil-Ala/P2E_calibration`
URL：https://github.com/Nabil-Ala/P2E_calibration

不是只讀 README，本輪實際追到：

```text
e-ccp/eccp_utils.py
```

其中 code 明確包含：

```text
# p-to-e conversion through P2E calibrator
get_C_s(...)
f_p_to_e(...)
```

以及兩種 prediction-set constructor：

```text
set_cc       → p > α
set_cc_eval  → e < 1/α
```

對 Hermes 最值得借用的不是直接複製其 regression benchmark，而是抽成 runtime interface：

```text
class EvidenceCalibrator:
    fit(calibration_scores, alpha)
    p_value(score)
    e_value(p)
    validity_contract()
    expiration_conditions()
```

### 建議 Hermes 新目錄

```text
src/evidence/
├ provenance/
│  ├ ancestry.ts
│  ├ source-cluster.ts
│  └ calibration-lineage.ts
├ calibration/
│  ├ conformal.ts
│  ├ p2e.ts
│  └ regime-contract.ts
├ sequential/
│  ├ predictable-plan.ts
│  ├ eprocess.ts
│  └ filtration.ts
├ fusion/
│  ├ dependency-graph.ts
│  ├ merge-router.ts
│  └ safe-product.ts
└ certificates/
   ├ evidence-validity.ts
   └ model-class-evidence.ts
```

---

# 7. Papers

## 1. Set-Preserving Calibration from Conformal P-Values to E-Values
- Authors：Nabil Alami, Jad Zakharia, Souhaib Ben Taieb
- Year：2026
- Institution：以論文正式版本為準，本輪不從作者 affiliation 做額外推測
- URL：https://arxiv.org/abs/2606.03600
- Code：https://github.com/Nabil-Ala/P2E_calibration
- Dataset：code 含 synthetic / regression-style cross-conformal experiments
- Architecture：Conformal p-values → P2E calibrator → e-value prediction sets
- Contribution：set-preserving p-to-e calibration；支援 e-based cross conformal / aggregation
- Limitations：依賴 conformal calibration assumptions；非通用 online e-process constructor
- 改變了什麼：讓 likelihood-free neural predictive wrapper 有一條可工程化的 p→e 路線

## 2. Anytime-Valid Federated Conformal RAG for LLM Swarms
- Authors：Prasanjit Dubey, Xiaoming Huo
- Year：2026 preprint
- URL：https://arxiv.org/abs/2605.29139
- Dataset：MMLU / DBpedia / AG News
- Architecture：FC-RAG + calibration-deviation budget + truncated betting e-process + predictable adaptive controller
- Contribution：說明 marginal conformal guarantee 不能 naive sequential compose；提供 time-uniform alarm construction
- Limitations：specialized RAG/swarm assumptions，尚需獨立複核與後續同行評議
- 改變了什麼：直接補上 Hermes `marginal → conditional sequential` 的缺口

## 3. Conformal Selective Acting: Anytime-Valid Risk Control for RLVR-Trained LLMs
- Authors：Hamed Khosravi, Xiaoming Huo
- Year：2026 preprint
- URL：https://arxiv.org/abs/2605.20270
- Dataset：論文報告多 specialist benchmarks、adversarial shifts、online LoRA / expert iteration cells
- Architecture：e-process per threshold → selective-risk certification → max-certified-threshold action rule
- Contribution：把 anytime evidence 直接映射到 act/abstain deployment decision
- Limitations：依賴 paper 定義的 filtration / calibration / monotonic risk assumptions
- 改變了什麼：提供 Evidence Runtime → Permission Gate 的具體模板

## 4. NxN E-valuation: Hypothesis Certification via a Conformal CRT Null
- Authors：Bin Wang, Yan Zhong
- Year：2026 preprint
- URL：https://arxiv.org/abs/2608.06621
- Architecture：LLM hypothesis generator → conformal/CRT-style null certification → e-value
- Contribution：避免 LLM circular self-verification
- Limitations：需要 dataset structure 支援；statistical certification 不等於完整 causal truth
- 改變了什麼：支援 Hermes Knowledge Graph 的「proposal / certification separation」

## 5. Safe Testing
- Authors：Peter Grünwald, Rianne de Heide, Wouter Koolen
- Year：2024
- URL：https://doi.org/10.1093/jrsssb/qkae011
- Architecture：composite null / alternative → GRO e-variable / safe test → optional continuation
- Contribution：提供 composite null、nuisance parameter、optional continuation 的基礎 e-value theory
- Limitations：對 neural likelihood-free model 仍需其他 constructor / calibration layer
- 改變了什麼：本輪所有 neural/conformal evidence constructor 的 validity 最終都必須回到「對 null family 的 expectation / optional continuation guarantee」，不能只看 heuristic score。

---

# 8. 已確認事實 / 工程實作 / 推論 / 假說分離

## 已確認事實（由論文 / 官方 code 支持）

- P2E paper 提出 set-preserving conformal p→e calibration。
- 官方 P2E repository 的 `eccp_utils.py` 實作 `get_C_s`、`f_p_to_e`、`set_cc`、`set_cc_eval`。
- Anytime-FC-RAG preprint 明確指出 naive composition of marginal conformal validity 不能直接得到 supermartingale validity。
- CSA preprint 建立 threshold-specific e-process 作為 selective acting wrapper。
- Safe Testing 正式處理 composite null / nuisance / optional continuation 下的 e-values。

## 工程實作建議（Hermes-specific）

- `CalibrationRegimeContract`
- `EvidenceValidityCertificate`
- `EvidenceAncestryRecord`
- `PredictableEvidencePlan`
- `KnowledgeNodeAdmissionContract`

這些是本輪根據文獻抽象出的 Hermes runtime objects，並非上述論文已存在的 API。

## 合理推論

- 對 neural model，`score → conformal p → calibrated e` 是比「直接把 neural confidence 當 e-value」更可稽核的工程路徑。
- Evidence fusion 應優先追 ancestry 再做 empirical dependence estimation。
- Knowledge Graph 應區分 proposal confidence 與 statistical certification evidence。

## 尚未驗證假說

- 能否建立對 arbitrary multimodal neural world model 都實用且高-power 的 conformal/e-value constructor。
- 能否在 severe nonexchangeability + adaptive retraining 下仍維持實用的 anytime-valid evidence。
- 是否能在線自動學 dependency graph 且不因 graph estimation error 破壞 global e-process validity。

---

# 9. Unknown / Open Questions

## Open Question 1：如何處理 calibration set 也被 Agent policy 污染？

Agent 會主動挑資料：

```text
current evidence
↓
select difficult samples
↓
recalibrate
```

這可能使 calibration set selection 與未來 residual 強烈相依。

下一步需要研究：

```text
adaptive conformal
weighted conformal
martingale conformal
policy-aware calibration
```

並明確分辨哪些方法只有 marginal validity、哪些有 conditional/time-uniform validity。

## Open Question 2：multimodal e-values 的 conditional factorization 怎麼證？

即使已知 ancestry graph：

```text
Camera ⟂ Voice | U ?
```

實際 encoder/context 可能重新導入 dependency。

需要把：

```text
causal/source graph
+
statistical conditional dependence tests
+
valid conservative merge
```

接起來。

## Open Question 3：Neural model retraining 後 evidence certificate 如何遷移？

前幾輪已建立 causal certificate migration；本輪需要再增加：

```text
CalibrationCertificateMigration
```

因為 encoder / score function / residual distribution 任一改變，都可能使舊 conformal calibration 失效。

---

# 10. 下一輪研究

下一輪最值得鎖定：

# Adaptive Calibration Drift × Online Conformal Martingales × Policy-Dependent Data × Evidence Certificate Migration

研究 pipeline：

```text
Agent policy
↓
changes data collection distribution
↓
calibration drift
↓
exchangeability failure
↓
weighted / online conformal layer
↓
predictive e-factor
↓
anytime validity audit
↓
model retraining / encoder update
↓
calibration certificate migration
↓
permission stability
```

優先問題：

1. **Policy-aware calibration**：Agent 主動蒐集的資料能否合法拿來更新 calibrator？
2. **Online conformal martingales / betting**：如何把 nonconformity rank 直接變成可時間監控的 evidence。
3. **Calibration drift detection**：什麼情況只需 reweight、什麼情況必須 revoke certificate。
4. **Model-update migration**：score function 改了後，舊 calibration set 是否可 transport。
5. **Multimodal conditional evidence**：Camera / Voice / Tool conditional e-factor 如何安全組成 global process。

---

# 11. Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Neural Composite Null
Neural Evidence Constructor
Nonconformity Score
Conformal P-Value
P2E Calibrator
Set-Preserving P2E Calibration
Calibration Regime
CalibrationRegimeContract
Marginal Conformal Validity
Conditional Sequential Validity
Predictable Evidence Plan
EvidenceValidityCertificate
Evidence Ancestry
EvidenceAncestryRecord
Shared Calibration Source
Calibration Lineage
Conformal E-Factor
Selective Acting Certificate
Generator-Certifier Separation
KnowledgeNodeAdmissionContract
Hypothesis Certification Evidence
Calibration Certificate Migration
```

## 新增核心 Edges

```text
Neural Confidence
≠ Statistical Evidence

Nonconformity Score
≠ E-Value

Conformal P-Value
→ May Be Calibrated To E-Value

Marginal Conformal Validity
≠ Sequential Conditional E-Validity

Pointwise E-Validity
≠ Product E-Process Validity

Predictable Adaptation
→ Can Preserve Sequential Validity

Current-Outcome-Dependent Calibration Choice
→ Breaks Predictability

Different Modalities
≠ Independent Evidence

Different Encoders
≠ Independent Evidence

Shared Calibration Set
→ Evidence Dependence

Shared Raw Event
→ Evidence Dependence

LLM Hypothesis Generation
≠ Hypothesis Certification

Generator
→ Proposes Knowledge Node

Independent Certifier
→ Gates Knowledge Node Admission

Model Update
→ May Expire Calibration Certificate
```

---

# 12. 本輪結束必答

**缺哪一層？**  
目前最缺的是 `Policy-Dependent Online Calibration Layer`：neural evidence constructor 已開始成形，但 Agent 主動選資料、重訓、改 retrieval / tool route 後，交換性與 conditional validity 如何維持仍是最大缺口。

**哪個節點最淺？**  
`CalibrationCertificateMigration`、`ModalityConditionalEFactor`、`OnlineDependencySafeFusion`。

**哪個概念仍只是名詞？**  
Production 級、對 arbitrary VLM/LLM/Tool/Memory 都通用的 `Neural Composite-Null E-Process` 仍主要是 architecture concept。

**哪個系統值得讀原始碼？**  
本輪最值得繼續讀 `Nabil-Ala/P2E_calibration`，優先 `e-ccp/eccp_utils.py → main.py → e-ca/`；下一輪再找 online conformal martingale / adaptive conformal 的正式 codebase。

**哪篇論文需追引用？**  
第一優先 `Set-Preserving Calibration from Conformal P-Values to E-Values`；第二優先 `Anytime-Valid Federated Conformal RAG for LLM Swarms`，因為它直接暴露「marginal guarantee 無法 naive sequential compose」這個 Hermes runtime 容易踩的坑。

**哪個概念最適合視覺模擬？**  
`Neural Evidence Factory × Marginal-vs-Sequential Validity Lab`：讓使用者親眼看到 neural confidence → nonconformity → conformal p → e-value → e-process，並在不滿足 conditional validity 時阻止 product。

**哪個 Agent 架構最值得實作？**  

```text
Raw Event Ledger
↓
Neural Predictor
↓
Nonconformity Layer
↓
CalibrationRegimeContract
↓
P/E Evidence Constructor
↓
EvidenceValidityCertificate
↓
Evidence Ancestry Graph
↓
Predictable Evidence Plan
↓
Dependence-Aware Fusion
↓
Global Model-Class E-Process
↓
Knowledge Admission + Permission Gate
```

---

# 13. 對「AI 到底怎麼運作」新增的一層

從使用者對 AI 說一句話開始，真正可驗證的路徑現在可以再補成：

```text
User says something
↓
UI / Voice / Camera / DOM Event
↓
Encoder / Model
↓
Tokens / Latent Representation
↓
Agent Context / Reasoning / Planning
↓
Prediction / Tool Decision
↓
Residual / Nonconformity
↓
Calibration
↓
Statistical Evidence
↓
Sequential Evidence Runtime
↓
Knowledge / Permission Decision
↓
Action
```

核心結論：

> **模型輸出的 confidence 不是證據；conformal p-value 也還不等於可隨時間連乘的證據。可驗證 Agent 需要一個獨立 Evidence Runtime，知道每份 evidence 是怎麼從 raw event、encoder、predictor、calibration set 產生，知道它只在單一時點有效還是具 conditional anytime validity，也知道 Camera、Voice、DOM、Tool 的「多模態」究竟是四份新證據，還是同一件事被四個感測器重複看見。只有走完這一層，AI 才有資格把『我很有信心』升級成『我有可稽核、可組合、可持續監控的證據』。**
