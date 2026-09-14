# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-14 08:56（Asia/Taipei）  
**本輪主題**：Composite-Null E-Process × Universal Inference × Nuisance Parameters × Dependence-Aware Multimodal Evidence Fusion × Model-Class Rejection  
**歷史銜接**：上一輪已建立 Anytime-Valid Model-Class Falsification、`PreOutcomeEvidenceContract`、E-process、Model-Class Rejection Certificate 與 Hypothesis Expansion Boundary。本輪不再重複「optional stopping 為什麼可處理」，而處理更底層的兩個問題：**(1) Hermes 真正要拒絕的通常不是一個固定 checkpoint，而是一整個 composite model class；(2) Camera / Voice / DOM / Tool / Memory 等多模態證據彼此常高度相依，如何融合而不 double count。**

---

## 本小時新發現

### 新論文 / 理論

1. **E-Values for Exponential Families: the General Case** — Yunda Hao, Peter Grünwald, 2024.  
   URL: https://arxiv.org/abs/2409.11134  
   核心：系統比較 composite exponential-family null 下的 reverse information projection（RIPr）、conditional e-variable（COND）、universal inference（UI）與 sequentialized RIPr e-process。重要結果：在一般 d 維情況，UI 的 e-power 相較 COND 會有約 `(d/2) log n + O(1)` 的損失，因此「universal」不代表效率最優。

2. **Safe Testing** — Peter Grünwald, Rianne de Heide, Wouter Koolen, JRSSB, 2024.  
   URL: https://academic.oup.com/jrsssb/article/86/5/1091/7623686  
   核心：對 composite null / alternative 與 nuisance parameters 建立 growth-rate optimal e-values；safe tests 可在 optional continuation 下維持 type-I guarantees，並把 e-value 解讀為對 null 的 betting wealth。

3. **Universal Inference** — Larry Wasserman, Aaditya Ramdas, Sivaraman Balakrishnan, PNAS, 2020.  
   URL: https://doi.org/10.1073/pnas.1922664117  
   核心：split likelihood ratio 透過 data splitting，把 alternative estimator 與 evaluation data 分離，形成 finite-sample-valid tests / confidence sets，且可延伸到 nuisance parameters 與 sequential settings。

4. **Generalized Universal Inference on Risk Minimizers** — Neil Dey, Ryan Martin, Jonathan P. Williams, JRSSB, 2025/2026 volume.  
   URL: https://academic.oup.com/jrsssb/article/88/3/756/8284721  
   Code: https://github.com/neil-dey/universal-inference  
   核心：把 universal-inference 思想擴展到風險最小化器；offline GUe 是 e-value，online GUe 是 e-process，在 strong central condition 下得到 finite-sample validity / anytime-validity。

5. **Universal Inference for model selection on networks** — Eric Yanchenko, Jonathan P. Williams, Ryan Martin, 2026.  
   URL: https://arxiv.org/abs/2606.30981  
   Code: https://github.com/eyanchenko/network_model_selection  
   核心：即使 network data 具依賴且常只有單一 realization，也能透過 edge sampling 形成 UI 型 e-value；說明 composite/model-selection inference 可以延伸到非 i.i.d. 結構，但必須明確處理 dependency construction。

6. **A simple geometric proof for the characterisation of e-merging functions** — Eugenio Clerico, 2026.  
   URL: https://arxiv.org/abs/2512.09708  
   核心：處理多個、甚至可能相依的 e-values 如何 merge 成單一有效 e-value；強調「證據聚合規則」本身也是需要 validity guarantee 的統計物件。

### 新 GitHub / 工程實作

**neil-dey/universal-inference**  
GitHub: https://github.com/neil-dey/universal-inference

實際檢查 `final_code/`，不只 README。值得看的檔案包括：

```text
final_code/
├ anova.py
├ bestcase.py
├ cherrypicking.py
├ ci_width.py
├ heavy_tail.py
├ kmeans.py
├ lr_condition.py
├ lr_power.py
├ lr_samplesize.py
├ millikan.py
├ quantile.py
├ ramdas_comparison.py
└ ramdas_comparison_closedform.py
```

其中 `cherrypicking.py` 清楚分開：

```text
data
↓
train half / test half
↓
train half learns estimator / learning-rate calibration
↓
test half evaluates excess risk
↓
offline GUe
```

以及 online 版本：

```text
history up to n
↓
lagged estimator / bootstrap tuning
↓
next observation loss difference
↓
sequential accumulation
```

這對 Hermes 很重要，因為它直接對應：**用同一筆 observation 同時選 model、校正 evidence rule、再宣告 evidence，會產生 data reuse 風險；需要 split / lagged / predictable construction。**

---

# 本小時最重要 5 個發現

## 1. Composite Null 不是「把 θ 換成很多個 θ」；它改變了 evidence 的定義

上一輪的簡化版本可以寫成固定 null：

```text
H0 : P = P0
```

此時 likelihood-ratio 型 e-factor 很自然：

```text
E(x)
=
q(x) / p0(x)
```

若：

```text
E_{P0}[E(X)] ≤ 1
```

就可當 e-value / conditional e-factor。

但 Hermes 真正的世界模型通常是：

```text
H0
=
{
  world_model(θ, η),
  θ ∈ Θ,
  η ∈ NuisanceSpace
}
```

例如：

```text
θ = causal mechanism parameters
η = sensor noise / calibration / user-state / latency / environment nuisance
```

要拒絕整個 class，需要：

```text
sup_{P ∈ H0} E_P[E] ≤ 1
```

而不是只對某個方便的：

```text
P_{θ_hat}
```

成立。

因此新增核心否定關係：

```text
Reject One Fitted Model
≠
Reject Composite Model Class
```

以及：

```text
Large Likelihood Ratio vs θ_hat
≠
Valid Composite-Null Evidence
```

對 Hermes 的直接含義：`OUT_OF_MODEL` 不能只問「目前最佳 checkpoint 的 prediction residual 是否很大」，而應問：

```text
Is the observed evidence incompatible
with ALL models still admissible under H0?
```

---

## 2. Bottom-Level Mechanism：Universal-Inference / Split Evidence 如何處理 nuisance 與 adaptive fitting

Universal Inference 的核心不是「神奇地不需要 assumptions」，而是利用 **independence / data splitting** 把兩個角色分開：

```text
D_train
↓
fit alternative / flexible estimator
↓
q_hat

D_test
↓
compare q_hat
against best null fit on D_test
```

典型 split-LR 結構可抽象為：

```text
E_split
=
L(q_hat(D_train); D_test)
──────────────────────────
sup_{θ ∈ H0} L(θ; D_test)
```

關鍵是：

```text
q_hat
```

在 evaluation half 被視為「事前已固定」。因此即使 q_hat 是複雜 estimator，也避免同一份 test data 先挑最有利 alternative、再拿自己挑出的 alternative 對自己評分。

Hermes 對應版本：

```text
Past / Shadow Data
↓
learn challenger model Q_t
↓
FREEZE challenger
↓
new multimodal event O_t
↓
compare challenger evidence
against entire admissible null family
↓
conditional e-factor
```

這與上一輪 `PreOutcomeEvidenceContract` 完全接起來。

新增 runtime object：

```text
CompositeNullEvidenceContract
├ model_class_id
├ nuisance_parameter_space
├ null_envelope_method
├ challenger_model_id
├ challenger_fit_data_hash
├ evaluation_scope
├ fitting_evaluation_separation
├ conditional_validity_assumption
├ e_factor_constructor
├ calibration_version
└ evidence_epoch
```

最重要的新 edge：

```text
Flexible Challenger Model
+ Fresh Evaluation Data
→ Can Be Compatible With Valid Evidence
```

但：

```text
Fit Challenger On Current Outcome
+ Score Same Current Outcome
→ Evidence Reuse Risk
```

---

## 3. Universal Inference 是保底機制，不等於最有效率的 composite-null e-process

Hao & Grünwald 對 exponential families 的比較非常重要：

```text
RIPr
COND
UI
Sequentialized RIPr
```

都可以是 composite-null safe evidence constructions，但 e-power 不相同。

其結果顯示 UI 在 d 維 null/alternative 的一般情況下，相對 conditional e-variable 可能損失約：

```text
(d / 2) log n + O(1)
```

的 e-power。

因此 Hermes 的 `EvidenceRouter` 不應永遠：

```text
unknown problem
→ universal inference
```

而應是：

```text
EvidenceRouter
├ Exact conditional e-variable available?
├ RIPr / information projection tractable?
├ Composite-null safe test available?
├ Universal split evidence fallback?
└ Only heuristic anomaly score?
```

新增狀態：

```text
EvidenceConstructionStatus
├ EXACT_SAFE
├ CONDITIONAL_SAFE
├ RIPR_SAFE
├ UNIVERSAL_SPLIT_SAFE
├ CONSERVATIVE_MERGE_SAFE
├ HEURISTIC_ONLY
└ INVALID
```

對 Agent runtime 很重要，因為：

```text
Validity
≠ Efficiency
```

與：

```text
Universal
≠ Power-Optimal
```

要同時存在於 knowledge graph。

---

## 4. Multimodal Evidence Fusion 最大的坑不是「模態品質不同」，而是 evidence dependence / double counting

Hermes 最終會同時收到：

```text
Camera
Voice
DOM
Tool telemetry
MCP response
Memory retrieval
User feedback
```

最直覺、但危險的做法是：

```text
E_total
=
E_camera
× E_voice
× E_tool
× E_memory
```

只有在合適的 conditional/sequential 結構成立時，乘積才自然維持 e-value / e-process validity。

現實中常見：

```text
Shared latent event U
├→ Camera embedding
├→ Voice prosody
├→ DOM state
└→ Tool response
```

甚至：

```text
same foundation model
same context window
same retrieved memory
same timestamp
same preprocessing
```

因此模態 e-values 不是獨立 replication。

若直接乘：

```text
Correlated Evidence
→ Treated As Independent Evidence
→ Artificial Wealth Explosion
```

所以新增：

```text
MultimodalEvidenceDependencyGraph
├ evidence_node_id
├ source_event_id
├ raw_sensor_id
├ encoder_id
├ context_id
├ memory_snapshot_id
├ model_id
├ shared_parent_events[]
├ temporal_overlap
└ dependence_class
```

證據融合策略必須依結構選：

```text
A. Sequential conditional factors
   E[E_t | F_{t-1}] ≤ 1
   → multiply sequentially

B. Truly independent studies/modalities
   → product may be valid

C. Arbitrary / unknown dependence
   → use valid e-merging construction
      rather than naive product

D. Same raw event transformed twice
   → treat as one evidence family / shared-source cluster
```

這輪的最重要否定 edge 之一：

```text
Two Modalities
≠
Two Independent Pieces of Evidence
```

以及：

```text
Different Encoders
≠
Independent Evidence Automatically
```

---

## 5. Multimodal Evidence Runtime 應區分「感知融合」與「統計證據融合」

現在很多 VLM / multimodal systems 做的是：

```text
image tokens
+
audio tokens
+
text tokens
↓
Fusion Transformer
↓
shared latent
↓
prediction
```

這叫：

```text
Representation Fusion
```

但 Hermes 需要另一層：

```text
Camera evidence validity
Voice evidence validity
Tool evidence validity
Memory evidence validity
↓
Dependence / Source Lineage
↓
Evidence Fusion
↓
Model-Class Rejection
```

也就是：

```text
Representation Fusion
≠
Evidence Fusion
```

第一層問：

```text
「模型怎麼把多模態資訊整合成 latent？」
```

第二層問：

```text
「這些觀察能提供多少統計上合法的新證據？」
```

如果 Camera 與 Voice 被同一個 VLM 壓成一個 fused state，再從該 fused state 產生兩個 head：

```text
camera_head_evalue
voice_head_evalue
```

不能因 head 名字不同就當成兩次獨立 evidence。

因此新增：

```text
EvidenceProvenanceContract
├ raw_event_ids[]
├ transformation_graph
├ learned_representation_ids[]
├ scoring_heads[]
├ calibration_dataset_ids[]
├ shared_dependencies[]
└ merge_eligibility
```

---

# Architecture Breakdown

本輪形成新的 Hermes：

## Composite Model-Class × Multimodal Sequential Evidence Runtime

```text
User / Camera / Voice / Video / DOM / Tool / MCP / Memory
↓
Raw Event Ledger
↓
Source + Lineage Graph
↓
Representation / Encoder Layer
↓
Per-Channel Predictive Distribution
↓
┌──────────────────────────────────────────┐
│      Evidence Construction Router        │
├──────────────────────────────────────────┤
│ Exact / Conditional e-value              │
│ RIPr / Safe-test e-value                 │
│ Universal split e-value                  │
│ Sequential conditional e-factor          │
│ Heuristic score only                     │
└──────────────────────────────────────────┘
↓
Composite Null Envelope
├ structural parameters
├ nuisance parameters
├ calibration uncertainty
├ environment variants
└ sensor/noise variants
↓
Per-Evidence Validity Certificate
↓
Evidence Dependency Graph
↓
Dependence-Aware Fusion Router
├ sequential product
├ independent product
├ e-merging
├ source-cluster merge
└ DO_NOT_MERGE
↓
Global Model-Class E-Process
↓
Model-Class Rejection Certificate
↓
Certificate Quarantine / Permission Gate
↓
Hypothesis Expansion Boundary
```

---

# Bottom-Level Logic

## A. Composite-null condition

Hermes 最終要維持：

```text
∀ P ∈ H0,
E_P[E_t | F_{t-1}] ≤ 1
```

而不是只：

```text
E_{P_hat}[E_t] ≤ 1
```

如果每輪 factor 滿足條件式 composite-null validity：

```text
E_t ≥ 0
```

則 global evidence wealth：

```text
W_T
=
∏_{t=1}^T E_t
```

可形成對整個 model class 的 sequential evidence process。

## B. Nuisance envelope

例如 Camera residual 的 null 不是固定：

```text
R_camera ~ N(0, σ²)
```

而可能：

```text
σ ∈ [σ_min, σ_max]
lighting ∈ L
camera_calibration ∈ C
```

Evidence builder 必須考慮：

```text
worst / projected / conditional null
```

而不是把：

```text
σ_hat
```

當已知真值。

## C. Multimodal factorization audit

假設：

```text
E_cam
E_voice
E_tool
```

欲使用：

```text
E_total = E_cam E_voice E_tool
```

Runtime 先問：

```text
Is E_voice a conditional e-factor
given everything used for E_cam?
```

即：

```text
E[E_voice | F_after_camera] ≤ 1 ?
```

如果不是，不能只靠：

```text
corr(E_cam, E_voice) ≈ 0
```

宣告可乘。

因為：

```text
Low empirical correlation
≠ Conditional e-validity
```

---

# Visual Simulation Idea

## **Composite Null × Multimodal Evidence Fusion Lab**

### 左側：Model Class

```text
Current Null Model Class H0

World Model
├ θ_causal        unknown
├ σ_camera        [0.2, 0.6]
├ σ_voice         [0.1, 0.7]
├ user_state      latent
├ network_latency variable
└ tool_health     {healthy, degraded}
```

使用者可把 nuisance range 拉大：

```text
σ_camera
0.2 ─────●──── 0.6
```

即時看：

```text
Point-null e-value          12.4
Composite-null safe e-value  3.1
```

視覺上直接解釋：

```text
More Nuisance Flexibility
→ Null Harder To Reject
```

### 中央：Multimodal Evidence Graph

```text
Shared Event U-91
├──────── Camera frame C31 ── Encoder V8 ── E_cam=4.2
├──────── Voice chunk A19  ── Encoder A5 ── E_voice=3.7
└──────── DOM D11          ── Parser P2  ── E_dom=2.1

Tool call T52
└────────────────────────────────────────── E_tool=5.0
```

點擊 `NAIVE PRODUCT`：

```text
4.2 × 3.7 × 2.1 × 5.0
=
163.17
```

畫面警告：

```text
INVALID / UNJUSTIFIED FUSION
Camera + Voice + DOM share source event U-91.
```

切換：

```text
DEPENDENCE-AWARE MERGE
```

顯示：

```text
Shared-source cluster S1
{camera, voice, DOM}
↓
merged evidence 4.9

Independent/sequential tool evidence
5.0

Global evidence
24.5
```

### 右側：Evidence Construction Mode

```text
Camera   CONDITIONAL_SAFE
Voice    UNIVERSAL_SPLIT_SAFE
DOM      HEURISTIC_ONLY
Tool     EXACT_SAFE
Memory   INVALID_FOR_MERGE
```

若使用者勾：

```text
Treat heuristic anomaly score as e-value
```

立刻顯示：

```text
EVIDENCE CONTRACT VIOLATION
```

---

# Code / GitHub

## `neil-dey/universal-inference`

最值得 Hermes 讀的不是 UI，而是 evidence construction 和 data-use boundaries。

### `final_code/cherrypicking.py`

工程上可看到 offline / online GUe 的差異：

```text
OFFLINE
split data
↓
train estimator / tuning
↓
evaluate held-out excess risk

ONLINE
history-dependent estimator
↓
lagged / sequential loss comparison
↓
accumulate evidence
```

這可映射到 Hermes：

```text
Shadow replay data
↓
fit challenger
↓
freeze challenger
↓
live observation
↓
score challenger vs composite null
```

### `final_code/lr_power.py`

實作 sequential risk-minimizer experiment：

```text
historical estimator θ_hat(t)
↓
loss difference on observation t
↓
learning rate ω_t
↓
log GUe accumulation
↓
threshold log(1/α)
```

值得特別注意：repo 主要是研究模擬 / 實驗程式，而不是 production library；其中 tuning、bootstrap 與某些變數使用方式需要當作 paper-reproduction code 解讀，不能直接搬進 production runtime。

## `AlexanderLyNL/safestats`

GitHub: https://github.com/AlexanderLyNL/safestats  
用途：production-oriented safe-test API 的另一種參考。其重點是把 safe test / e-value 設計與實際 study workflow 封裝，而非 generic Agent runtime。

## `eyanchenko/network_model_selection`

GitHub: https://github.com/eyanchenko/network_model_selection  
用途：dependency-rich structured data 下 UI model-selection 的新案例。值得下一輪深入 `functions.R`，因為它可能提供「不是 i.i.d. modality streams 時如何構造 split」的工程啟發。

---

# Papers

## Paper 1

**Title**：E-Values for Exponential Families: the General Case  
**Authors**：Yunda Hao, Peter Grünwald  
**Year**：2024  
**URL**：https://arxiv.org/abs/2409.11134  
**Architecture / Method**：RIPr / conditional e-variable / universal inference / sequentialized RIPr  
**Contribution**：統一比較 composite exponential-family null 下主要 e-value / e-process constructions 與 e-power。  
**Limitations**：結果聚焦 exponential-family 結構；不能直接等同 arbitrary neural multimodal world model。  
**改變了什麼**：把「有 validity 就夠」推進成「composite-null evidence constructor 也要做效率 routing」。

## Paper 2

**Title**：Safe Testing  
**Authors**：Peter Grünwald, Rianne de Heide, Wouter Koolen  
**Institution**：CWI / Leiden-related safe statistics research line  
**Year**：2024  
**URL**：https://academic.oup.com/jrsssb/article/86/5/1091/7623686  
**Architecture**：e-values、GRO e-variables、information projection、test martingales  
**Contribution**：處理 composite null/alternative、nuisance parameters、optional continuation。  
**Limitations**：把一般 Agent neural world model 映射成有 tractable safe-test family，仍需額外建模。  
**改變了什麼**：讓 Hermes 的 model-class evidence 不必只靠 universal split fallback。

## Paper 3

**Title**：Universal Inference  
**Authors**：Larry Wasserman, Aaditya Ramdas, Sivaraman Balakrishnan  
**Institution**：Carnegie Mellon University  
**Year**：2020  
**URL**：https://doi.org/10.1073/pnas.1922664117  
**Architecture**：Data split → flexible fit → held-out likelihood ratio → finite-sample test / confidence set  
**Contribution**：不依賴 regular asymptotics 的 generic finite-sample inference framework。  
**Limitations**：split data 會損失 power；nuisance / repeated split / high-dimensional problems 有效率問題。  
**改變了什麼**：提供 Hermes 在沒有專門 e-value construction 時的安全 fallback blueprint。

## Paper 4

**Title**：Generalized Universal Inference on Risk Minimizers  
**Authors**：Neil Dey, Ryan Martin, Jonathan P. Williams  
**Year**：2025/2026 journal volume  
**URL**：https://academic.oup.com/jrsssb/article/88/3/756/8284721  
**Code**：https://github.com/neil-dey/universal-inference  
**Architecture**：Risk minimizer / excess-loss e-values / online GUe e-process  
**Contribution**：把 UI 思想接到 ML risk minimization；online 版本具 anytime-validity。  
**Limitations**：需要 strong central condition 與 learning-rate construction；不能無條件套到 arbitrary loss / Agent behavior。  
**改變了什麼**：讓 Hermes 能把「world-model likelihood」以外的 prediction/risk mechanism 也納入 evidence runtime。

## Paper 5

**Title**：A simple geometric proof for the characterisation of e-merging functions  
**Author**：Eugenio Clerico  
**Year**：2026  
**URL**：https://arxiv.org/abs/2512.09708  
**Architecture**：e-merging functions / concave-envelope geometry  
**Contribution**：研究多個可能相依 e-values 如何被 merge；證明 e-merging function class 的結構性質。  
**Limitations**：e-merging 解決的是「已有效 e-values 怎麼合」，不會替每個 modality 自動建立有效 e-value，也不會自動解開 shared-source causal dependence。  
**改變了什麼**：讓 Multimodal Evidence Fusion 從 heuristic weighting 升級成有 validity contract 的統計層。

---

# 已確認事實 / 工程推論 / 尚未驗證假說

## 已確認事實

- E-value 對 null 的核心要求是非負且 null expectation ≤ 1；conditional e-factor 可透過乘積形成 sequential evidence。  
- Safe testing 明確處理 composite null / alternative 與 nuisance parameters。  
- Universal inference 使用 data splitting 建 finite-sample-valid inference，避免 evaluation data 同時自由 fitting alternative。  
- Generalized UI 的 online GUe 是 e-process；offline GUe 僅是 e-value，兩者 sequential properties 不同。  
- 2024 exponential-family比較顯示 UI validity 並不代表 e-power 最佳。  
- 2026 e-merging研究明確處理多個可能相依 e-values 的有效聚合。

## 工程實作推論

- Hermes 應將 `Representation Fusion` 與 `Evidence Fusion` 分成不同 runtime services。  
- 每個 evidence object 必須有 raw-event lineage，不然無法判斷 camera/voice/DOM 是否其實是同一事件的重複證據。  
- `CompositeNullEvidenceContract` 應與 `PreOutcomeEvidenceContract` 串接，讓 null family、challenger fitting data 與 evaluation event 都可 audit。  
- 若無法證明各 modality e-factor conditional validity，應預設 `DO_NOT_PRODUCT`，而不是假設獨立。

## 尚未驗證假說

- Arbitrary VLM multimodal latent residual 是否能建立實用、非過度保守的 generic composite-null e-process，目前沒有通用解。  
- e-merging 在高維 shared-latent evidence streams 上是否能保持足夠 power，需要 Agent-specific benchmark。  
- 用 foundation-model likelihood / calibrated energy score 當 modality e-factor 的條件與 failure modes，需要下一輪做 deeper model-based calibration research。

---

# Unknown / Open Questions 1–3

1. **Neural composite null 要怎麼表示？**  
   Production world model 不是低維 θ family；可能是 checkpoint ensemble、LoRA family、latent-state simulator family、environment perturbation family。如何定義 tractable null envelope 而不讓 null 太寬、永遠無法拒絕？

2. **多模態相依怎麼 online 學、又不破壞 validity？**  
   如果 dependence graph 本身是從同一串資料學出來，再用它選 evidence merging rule，會產生新的 adaptive calibration 問題。

3. **何時該 merge evidence，何時該保留 vector evidence？**  
   一個 scalar global wealth 對 permission gate 很方便，但可能掩蓋「只有 camera 壞、tool 正常」的局部結構。可能需要 `EvidenceVector + Safe Global E-Process` 雙軌。

---

# 下一輪研究

下一輪收斂到：

# **Neural Composite Null × Conformal / Predictive E-Values × Dependence Graph Learning × Modality-Conditional Evidence**

要回答：

```text
Neural world-model family
↓
Predictive distribution / nonconformity score
↓
Calibration set
↓
Conformal / predictive e-value
↓
modality-conditional validity
↓
learned dependence graph
↓
Safe fusion / e-merging
↓
Global model-class e-process
```

並且特別研究：

```text
Camera residual
Voice residual
Tool residual
Memory contradiction
```

能否不用明確 parametric likelihood，也建立 finite-sample / anytime-valid evidence。

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Composite Null
Composite Model Class
Nuisance Parameter
CompositeNullEvidenceContract
Null Envelope
Universal Inference
Split Likelihood Ratio
Generalized Universal Inference
Risk-Minimizer E-Value
RIPr E-Value
Conditional E-Variable
Evidence Construction Router
EvidenceConstructionStatus
Evidence Provenance
EvidenceProvenanceContract
Multimodal Evidence Dependency Graph
Shared Evidence Source
Evidence Source Cluster
Evidence Double Counting
E-Merging Function
Dependence-Aware Evidence Fusion
Representation Fusion
Evidence Fusion
Global Model-Class E-Process
Modality-Conditional E-Factor
Composite-Null Safe Evidence
```

## 新增 Edges

```text
Reject One Fitted Model
≠ Reject Composite Model Class

Point-Null Evidence
≠ Composite-Null Evidence

Validity
≠ Efficiency

Universal Inference
≠ Power-Optimal Evidence

Two Modalities
≠ Two Independent Pieces of Evidence

Different Encoders
≠ Independent Evidence Automatically

Low Empirical Correlation
≠ Conditional E-Validity

Representation Fusion
≠ Evidence Fusion

Shared Raw Event
→ Evidence Dependence

Shared Context / Memory
→ Evidence Dependence

Composite Null
→ Requires Nuisance Handling

Fresh Evaluation Data
→ Supports Split-Evidence Validity

Unknown Dependence
→ Requires Safe Merge / No Naive Product

Heuristic Anomaly Score
≠ E-Value Automatically
```

---

# 本輪結束判定

**缺哪一層**：`Neural Composite-Null Evidence Construction Layer`，尤其是沒有 tractable likelihood 的 VLM / tool / memory residual 如何變成 valid e-factor。  

**哪個節點最淺**：`ModalityConditionalEFactor`、`NeuralNullEnvelope`、`DependenceAwareMultimodalEProcess`。  

**哪個概念仍只是名詞**：production 級 `Global Multimodal Model-Class E-Process`；目前理論元件存在，但任意 Agent stack 尚沒有通用拼裝標準。  

**哪個系統值得讀原始碼**：下一輪優先讀 `eyanchenko/network_model_selection/functions.R`，因為它直接碰到 dependent structured data 的 UI construction；同時繼續讀 `neil-dey/universal-inference` 的 online/offline GUe 實驗。  

**哪篇論文需追引用**：Hao & Grünwald《E-Values for Exponential Families: the General Case》，因為它直接回答 composite-null 下不同 e-construction 的效率差異；其次追 `Safe Testing` 的 RIPr/GRO 路線。  

**哪個概念最適合視覺模擬**：`Composite Null × Multimodal Evidence Fusion Lab`，特別是「naive product 163.17 → dependence-aware evidence 24.5」與 nuisance-range slider。  

**哪個 Agent 架構最值得實作**：

```text
Raw Event Ledger
↓
Evidence Provenance Graph
↓
Composite Null Builder
↓
Evidence Construction Router
↓
Per-Modality E-Factor Certificates
↓
Evidence Dependency Graph
↓
Dependence-Aware Fusion Router
↓
Global Model-Class E-Process
↓
Model-Class Rejection Certificate
↓
Permission Gate / Hypothesis Expansion
```

---

# 對「AI 到底怎麼運作」新增的底層答案

當使用者對 AI 說一句話，或 Camera / Voice / Tool 同時產生資料時，AI 內部不應只做：

```text
Input
→ Encoder
→ Tokens
→ Fusion
→ Model
→ Output
```

對可驗證 Agent，還需要另一條與 prediction 平行的 evidence path：

```text
Raw Events
→ Source Lineage
→ Predictive Distribution
→ Composite Null / Nuisance Envelope
→ Valid E-Factor Construction
→ Dependence Audit
→ Multimodal Evidence Fusion
→ Sequential Model-Class Evidence
→ Permission
```

**多模態模型把 Camera、Voice、DOM 融合得很好，不代表它取得了三份獨立證據；而一個 checkpoint 被 residual 擊敗，也不代表整個合理 world-model family 已被推翻。真正可驗證的 Agent 必須同時知道：「我拒絕的是哪一個模型集合？」以及「這些看似不同的觀察，究竟提供了幾份新的證據？」**