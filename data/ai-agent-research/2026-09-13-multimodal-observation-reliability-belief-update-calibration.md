# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-13 16:55 Asia/Taipei  
**主題**：Multimodal Observation Reliability × Missing/Conflict-Aware Fusion × Calibrated Belief Update × Observation Contract × Permission Gate

## 0. 與歷史研究比較 / 本輪避免重複

本輪承接：
- `2026-09-13-state-abstraction-belief-state-pomdp-sequential-evidence.md`
- `2026-09-13-bellman-martingale-transition-residual-sequential-certificate.md`
- `2026-09-12-streaming-multimodal-predictive-state-active-perception-world-registers.md`
- `2026-09-11-cross-modal-grounded-entity-identity-object-permanence-affordance.md`

歷史研究已處理：Belief State、Predictive State、State Aliasing、Markov Sufficiency、Active Sensing、Streaming Multimodal State。  
**本輪不再重講 belief state 是什麼，而專注 belief update 前的一層：每個 multimodal observation 到底能不能被當成可靠 evidence。**

核心新問題：

```text
Camera / Screenshot / OCR / Voice / Tool / MCP / Text
↓
不是直接 concat
↓
Observation Reliability Contract
↓
Missingness / Conflict / Staleness / Calibration / Provenance
↓
Likelihood Construction
↓
Belief Update
↓
State / Risk Certificate
↓
Planner Permission
```

---

# 1. 本小時新發現

## 1.1 新論文：Conformal Fusion Under Missing Modalities

**Title**：Conformal Fusion Under Missing Modalities  
**Author**：Alireza Moayedikia  
**Year**：2026  
**URL**：https://arxiv.org/abs/2608.07183  
**Code**：本輪未找到公開程式碼  
**Architecture**：modality dropout backbone → per-modality evidential Dirichlet heads → Dempster-Shafer fusion → modality-mask-conditioned Mondrian conformal calibration  
**Contribution**：把 missing-modality robustness 與 calibrated uncertainty 綁在同一個架構；缺失模態以 vacuous evidence 進入 fusion，而不是填補假資料；對每個非空 modality subset 提供 group-conditional finite-sample coverage。  
**Limitation**：formal coverage 是針對其 calibration / prediction regime；不能直接推成 POMDP belief state 的 sequential anytime-valid guarantee，也沒有自動解決 modality conflict、staleness、timestamp misalignment。

改變了什麼：

```text
Missing modality
≠ zero vector
≠ hallucinated imputation

Missing modality
→ vacuous / absent evidence
→ uncertainty should increase structurally
```

---

## 1.2 新論文：MRUF

**Title**：MRUF: Multi-granularity Routing with Uncertainty-Aware Fusion for Robust Multimodal Sentiment Analysis  
**Authors**：Haoran Ma, Yinfeng Yu, Liejun Wang  
**Year**：2026  
**URL**：https://arxiv.org/abs/2607.10599  
**Architecture**：multi-granularity routing → modality uncertainty prediction → inverse-variance reweighting → invariant contrastive alignment  
**Contribution**：在 utterance level 根據 modality-wise uncertainty 動態降低低品質 modality 的 fusion 權重。  
**Limitation**：任務為 multimodal sentiment；不是 Agent belief filter theorem，也不等於 calibrated Bayesian likelihood。

對 Hermes 的意義：

```text
Modality present
≠ Modality reliable
```

Camera 有 frame 不代表 frame 沒 blur；Voice 有 transcript 不代表 ASR confidence 足夠；Tool 有 response 不代表 freshness / provenance 沒問題。

---

## 1.3 新論文：EvidentialRAG

**Title**：EvidentialRAG: Quantifying and Mitigating Information Conflict in Multi-Source Retrieval-Augmented Generation via Evidential Deep Learning  
**Authors**：S M Asif Hossain, Ruksat Khan Shayoni, M. F. Mridha  
**Year**：2026  
**URL**：https://arxiv.org/abs/2607.10491  
**Architecture**：retrieved chunks → claim/evidence evaluator → Dirichlet evidence → conflict-preserving Dempster-Shafer fusion → answer/caution/abstain router  
**Contribution**：不同來源相衝突時，不強行 normalized 成單一答案，而把 unresolved disagreement 保留成 epistemic uncertainty。  
**Limitation**：RAG multi-source conflict 不等於 sensor likelihood conflict；paper result 不能直接外推至 multimodal POMDP。

重要新規則：

```text
Conflict
≠ Noise to average away

Conflict
→ Evidence object
→ Epistemic uncertainty
→ information-seeking / abstention trigger
```

---

## 1.4 新架構：Visual-Seeker

**Title**：Visual-Seeker: Towards Visual-Native Multimodal Agentic Search via Active Visual Reasoning  
**Authors**：Zhengbo Zhang et al.  
**Institution**：CASIA 等  
**Year**：2026  
**URL**：https://arxiv.org/abs/2606.15231  
**Code**：https://github.com/ZhengboZhang/Visual-Seeker  
**Dataset**：5K synthesized multimodal trajectories；另公開 Visual-Seeker training data  
**Architecture**：visual-native search trajectory → active fine-grained visual perception → dynamic visual evidence harvesting → cross-modal multi-hop reasoning  
**Contribution**：把 image 從「一次性 prompt input」提升成 search loop 中可以主動再取證的 evidence source。  
**Limitation / GitHub 驗證結果**：本輪直接檢查 GitHub repository，目前 root 僅有 `README.md`、`LICENSE`、`figs/`；README 仍列 `Model / Data Demo / Evaluation Code` 為 TODO，因此現在不能宣稱可從 repository 追到完整 runtime / agent loop implementation。

這個 repo 的「沒有 code」本身也是重要研究結果：

```text
Paper says Code URL exists
≠ Runtime implementation is currently inspectable
```

---

## 1.5 經典但本輪直接讀原始碼：Multimodal Sensor Fusion with Differentiable Filters

**Paper**：Michelle A. Lee, Brent Yi, Roberto Martín-Martín, Silvio Savarese, Jeannette Bohg, IROS 2020  
**URL**：https://arxiv.org/abs/2010.13021  
**Code**：https://github.com/brentyi/multimodalfilter

本輪不是只看 README，而是追：

```text
crossmodal/
├ base_models/
│  ├ crossmodal_kf.py
│  ├ crossmodal_pf.py
│  ├ unimodal_kf.py
│  └ utility.py
├ door_models/
├ push_models/
├ tasks/
├ train_helpers.py
└ eval_helpers.py
```

`crossmodal_kf.py` 的核心工程實作確認：
- 每個 modality 有自己的 unimodal filter state / covariance。
- `CrossmodalKalmanFilterWeightModel` 由 observation 產生 modality × batch × state-dimension 權重。
- fusion 對 state 做 weighted average，對 covariance 也用 modality-derived weighting 組合。
- runtime 有 `enabled_models`，可以明確 disable modality。
- 若 modality 被 disable，程式不是自動 hallucinate 該 modality，而是從 active model subset 做 fusion。

這提供 Hermes 一個很好的底層參考：**multimodal fusion 應該保存 per-modality estimate / uncertainty / enable-status，而不是只保存 fused embedding。**

---

# 2. 本小時最重要 5 個發現

## 發現 1 — Missing、Unreliable、Conflicting、Stale 是四種不同 observation state

### 是什麼

Hermes 目前需要的不是 `modality_available: bool`，而是至少：

```text
ObservationStatus
├ PRESENT_RELIABLE
├ PRESENT_UNCERTAIN
├ PRESENT_CONFLICTING
├ PRESENT_STALE
├ MISSING_EXPECTED
├ MISSING_BY_DESIGN
└ INVALID
```

### 底層如何運作

Belief filtering 的 update 本質：

```text
b_t(s)
∝
p(o_t | s) · Σ_{s'} P(s|s',a_{t-1}) b_{t-1}(s')
```

多模態不能簡單寫成：

```text
p(camera,text,voice,tool | s)
=
全部 encoder embedding concat 後 softmax
```

更合理的是先保存：

```text
modality mask
measurement likelihood
quality score
calibration regime
freshness
source identity
cross-modal dependence
conflict score
```

再決定 fusion operator。

### 為什麼重要

否則缺一張 screenshot、ASR 噪音、Tool response 過期、camera 和 text 相衝突，都可能被模型壓進同一個 latent embedding，最後 Planner 看不到不確定性的來源。

### 限制

目前沒有單一 theorem 能一次涵蓋 neural multimodal encoder + missingness + conflict + asynchronous arrival + POMDP sequential filtering。

---

## 發現 2 — 缺模態應該改變 uncertainty regime，而不是只改 feature tensor

MCCF 的重要啟發：每個 modality-presence mask 應有自己的 calibration group。

Hermes 可建立：

```text
ModalityPresenceMask
Camera  ✓
Voice   ✕
Tool    ✓
Text    ✓
Depth   ✕
```

對應：

```text
CalibrationRegime = CAMERA_TOOL_TEXT
```

而不是仍拿 FULL_MODAL calibration confidence。

核心否定：

```text
Full-modal calibration
≠ Partial-modal calibration
```

---

## 發現 3 — Conflict 應保留成 belief uncertainty，不應被 attention 平均掉

假設：

```text
Camera: button = ENABLED
DOM:    button = DISABLED
Tool:   auth = EXPIRED
```

錯誤做法：

```text
embedding fusion
→ strongest modality wins
→ WRITE
```

Hermes 應該：

```text
cross-modal contradiction
↓
Conflict Object
↓
epistemic uncertainty ↑
↓
active verification
↓
refresh DOM / auth / screenshot
↓
再更新 belief
```

因此新增：

```text
CrossModalConflictCertificate
├ involved_modalities
├ conflicting_claim
├ per_source_support
├ conflict_mass
├ freshness_delta
├ identity_alignment_status
├ resolvable_by_observation
└ permission_effect
```

---

## 發現 4 — Learned fusion weight 不是 calibrated likelihood

2020 crossmodal differentiable filter 的 code 很清楚地證明工程上可以學：

```text
observation
↓
weight model
↓
per-modality state weight
↓
fused estimate
```

但：

```text
Attention / gating weight
≠ Bayesian posterior probability
≠ reliability probability
≠ calibrated likelihood ratio
```

所以 Hermes UI 不能把：

```text
Vision weight = 0.8
```

直接標成：

```text
Vision confidence = 80%
```

除非另有 calibration certificate。

---

## 發現 5 — Active multimodal reasoning 應改寫成「選下一個 observation」

Visual-Seeker 顯示一個重要方向：vision 不是靜態 prompt，而是 agentic search loop 中可重新擷取的 evidence。

Hermes 的 Multimodal Agent Loop 應寫成：

```text
Current belief b_t
↓
uncertainty decomposition
├ object identity uncertain
├ auth state uncertain
├ screen stale
├ voice intent ambiguous
└ tool status conflict
↓
Observation Planner
↓
選擇下一個 sensing action
├ screenshot crop
├ DOM inspect
├ tool health
├ ask user
├ replay audio
└ fetch fresh resource
↓
new observation
↓
reliability gate
↓
belief update
```

因此：

```text
Planning
≠ only choosing world action

Planning
also chooses information action
```

---

# 3. Architecture Breakdown

## Multimodal Observation Reliability Runtime

```text
Camera / Screenshot / Voice / Text / Tool / MCP / Sensor
↓
Observation Adapter Layer
├ timestamp normalization
├ entity grounding
├ source identity
├ raw quality metrics
└ presence mask
↓
Per-Modality Evidence Heads
├ prediction / likelihood
├ aleatoric uncertainty
├ epistemic/vacuity estimate
└ calibration metadata
↓
Observation Reliability Gateway
├ missingness classifier
├ staleness checker
├ contradiction detector
├ calibration router
├ cross-modal dependence contract
└ provenance verifier
↓
Fusion Router
├ Bayesian product / update
├ weighted differentiable filter
├ Dempster-Shafer conflict-preserving fusion
├ conformal set fusion
└ NO_FUSION / request-more-info
↓
Belief / Predictive State Engine
↓
Belief Calibration + State Sufficiency Auditor
↓
Planner View Firewall
↓
Risk / Permission Gate
↓
Action OR Active Observation Request
```

---

# 4. Bottom-Level Logic

## 4.1 Prediction → Observation Update

```text
prior belief
b_{t|t-1}(s)
=
Σ P(s|s',a) b_{t-1}(s')
```

有 modalities `m ∈ M_t`：

```text
L_m(s) = p(o_t^m | s, q_t^m, freshness_t^m)
```

不能自動假設：

```text
p(o^1,...,o^M|s)=Π p(o^m|s)
```

因為 Camera screenshot、OCR、DOM 可能來自同一畫面，條件獨立假設會 double-count evidence。

所以需要：

```text
CrossModalDependenceContract
```

若 independence 不成立：

```text
conditional fusion model
or
joint likelihood
or
conflict-preserving evidence fusion
```

## 4.2 Missingness

如果 modality 缺失：

```text
NO OBSERVATION
```

不應被改寫成：

```text
o_m = zero
```

也不一定要 impute。

應該：

```text
presence_mask[m] = 0
likelihood contribution = vacuous / neutral
calibration regime changes
uncertainty widens
```

## 4.3 Staleness

Tool observation：

```text
t_observed = 10:00:00
t_decision = 10:03:20
```

如果 state transition 很快，old observation 不能等同 current state。

因此：

```text
EffectiveLikelihood
=
ObservationLikelihood
×
FreshnessModel
```

更嚴格地說，不是單純乘一個 heuristic weight，而是先 propagate belief through dynamics 再判斷 observation 對 current state 的可用性。

## 4.4 Conflict

如果 modalities 支持不同 hypotheses：

```text
Vision → H1
DOM    → H2
Tool   → H2
```

Hermes 應保存 disagreement，而不是只保存 fused argmax。

```text
ConflictMass > threshold
↓
permission downgrade
↓
VERIFY / ASK / REFRESH
```

---

# 5. Visual Simulation Idea

# Multimodal Belief Fusion × Conflict Observatory

左側：即時 modality cards

```text
CAMERA
present ✓
freshness 0.92
quality 0.84
supports: auth_valid .78

DOM
present ✓
freshness 0.99
quality 0.97
supports: auth_expired .91

VOICE
missing ✕

TOOL
present ✓
freshness 0.62 ⚠
supports: auth_expired .73
```

中間：Evidence Fusion Graph

```text
CAMERA ─────┐
            ├→ CONFLICT NODE → belief
DOM ────────┤
TOOL ───────┘
VOICE ── vacuous
```

右側：Permission impact

```text
READ_MCP        ALLOW
WRITE_LOCAL     VERIFY
WRITE_EXTERNAL  BLOCK
ASK_USER        ALLOW
REFRESH_AUTH    RECOMMENDED
```

可切換 simulation：

```text
[All modalities]
[Voice missing]
[Camera stale]
[DOM corrupted]
[Camera/DOM conflict]
[Tool delayed 5 min]
```

並即時畫 belief entropy / conformal set width / conflict mass / action permissions。

---

# 6. Code / GitHub

## A. brentyi/multimodalfilter

Repository：https://github.com/brentyi/multimodalfilter

值得看的目錄：

```text
crossmodal/base_models/
├ crossmodal_kf.py      ← 核心：多個 unimodal EKF state/covariance + crossmodal learned weights
├ crossmodal_pf.py      ← Particle-filter fusion path
├ unimodal_kf.py        ← individual modality baseline
└ utility.py
```

值得看的核心物件：

```text
CrossmodalKalmanFilterWeightModel
CrossmodalKalmanFilter
CrossmodalVirtualSensorModel
enabled_models
calculate_unimodal_states
calculate_weighted_states
```

工程啟發：

```text
raw modalities
↓
per-modality estimators
↓
per-modality covariance
↓
context-dependent fusion weights
↓
fused recursive state
```

但要補的 production layer：calibration、missing-mask-conditioned guarantee、conflict semantics、timestamp/freshness、source provenance。

## B. ZhengboZhang/Visual-Seeker

Repository：https://github.com/ZhengboZhang/Visual-Seeker

本輪實際檢查 repository root：目前只有 README、LICENSE、figs；paper 宣稱 code/data URL，但 repo 目前沒有可追的 agent runtime / training / evaluation source tree。

因此狀態：

```text
PAPER_ARCHITECTURE_CONFIRMED
CODE_RUNTIME_NOT_YET_INSPECTABLE
```

---

# 7. Papers

1. **Conformal Fusion Under Missing Modalities** — Alireza Moayedikia, 2026.  
   https://arxiv.org/abs/2608.07183

2. **MRUF: Multi-granularity Routing with Uncertainty-Aware Fusion for Robust Multimodal Sentiment Analysis** — Haoran Ma, Yinfeng Yu, Liejun Wang, 2026.  
   https://arxiv.org/abs/2607.10599

3. **EvidentialRAG: Quantifying and Mitigating Information Conflict in Multi-Source Retrieval-Augmented Generation via Evidential Deep Learning** — Hossain et al., 2026.  
   https://arxiv.org/abs/2607.10491

4. **Visual-Seeker: Towards Visual-Native Multimodal Agentic Search via Active Visual Reasoning** — Zhengbo Zhang et al., 2026.  
   https://arxiv.org/abs/2606.15231

5. **Multimodal Sensor Fusion with Differentiable Filters** — Michelle A. Lee, Brent Yi, Roberto Martín-Martín, Silvio Savarese, Jeannette Bohg, IROS 2020.  
   https://arxiv.org/abs/2010.13021

---

# 8. Unknown / Open Questions

## Q1 — 如何把 modality-conditioned conformal coverage 變成 sequential belief guarantee？

MCCF 提供 subset-conditioned finite-sample coverage，但 Agent 是持續觀測、持續決策；還缺：

```text
modality mask changes over time
↓
sequential calibration
↓
optional stopping
↓
belief update certificate
```

## Q2 — 如何防止 correlated modalities double-count evidence？

Screenshot、OCR、DOM、VLM caption 可能全部來自同一 UI frame。

```text
4 observations
≠ 4 independent evidence sources
```

需要建立 `EvidenceLineageDAG + DependenceContract`。

## Q3 — 如何在 asynchronous multimodal stream 中定義 current belief？

```text
Camera @ t=10.0
Voice  @ t=10.3
DOM    @ t=10.4
Tool   @ t=11.2
```

需要 continuous/event-time filtering，而不是所有 inputs 強制對齊成單一 prompt timestep。

---

# 9. 下一輪研究

下一輪最值得進入：

# **Asynchronous Multimodal Filtering × Evidence Lineage × Cross-Modal Dependence × Sequential Calibration**

研究鏈：

```text
Asynchronous Event Stream
↓
Timestamp / Clock Model
↓
Evidence Lineage DAG
↓
Same-Origin / Correlation Detection
↓
Continuous-Time / Event-Time Belief Update
↓
Modality-Conditioned Sequential Calibration
↓
Conflict-Aware E-process / CS
↓
Permission Gate
```

重點要回答：
1. Screenshot + OCR + DOM 是否在統計上被重複計算？
2. 不同 latency 的 observations 如何投影到同一 current latent state？
3. modality mask 會隨時間變化時，coverage / anytime validity 怎麼保持？
4. conflict mass 能否轉成可 sequential monitoring 的 evidence process？

---

# 10. Knowledge Graph 新增 Node / Edge

## Nodes

```text
Multimodal Observation Contract
Observation Reliability Gateway
Modality Presence Mask
Modality Calibration Regime
Missing Modality
Vacuous Evidence
Unreliable Modality
Stale Observation
Observation Freshness
Cross-Modal Conflict
Conflict Mass
CrossModalConflictCertificate
Per-Modality Evidence Head
Per-Modality Vacuity
Per-Modality Uncertainty
Cross-Modal Dependence Contract
Evidence Lineage DAG
Same-Origin Evidence
Double-Counting Risk
Learned Fusion Weight
Calibrated Likelihood
Missing-Aware Fusion
Conflict-Preserving Fusion
Mondrian Modality Calibration
Active Observation Planner
Information Action
Multimodal Permission Certificate
```

## Positive Edges

```text
Missing Modality
→ Vacuous Evidence

Modality Presence Mask
→ Calibration Regime

Cross-Modal Conflict
→ Epistemic Uncertainty

Epistemic Uncertainty
→ Active Observation Planner

Per-Modality Uncertainty
→ Fusion Router

Observation Freshness
→ Observation Reliability Gateway

Evidence Lineage DAG
→ Cross-Modal Dependence Contract

Belief Uncertainty
→ Permission Gate
```

## Negative / corrective Edges

```text
Modality Present
≠ Modality Reliable

Missing Modality
≠ Zero-Valued Observation

Missing Modality
≠ Imputed Observation Automatically

Attention Weight
≠ Calibrated Reliability

Fusion Weight
≠ Posterior Probability

Full-Modality Calibration
≠ Partial-Modality Calibration

Cross-Modal Agreement
≠ Independent Evidence

Multiple Derived Views Of Same Screenshot
≠ Multiple Independent Sensors

Conflict
≠ Noise To Average Away

Fresh Observation
≠ Correct Observation

Old Correct Observation
≠ Current-State Observation

Paper Code Link Exists
≠ Inspectable Runtime Code Exists
```

---

# 11. 本輪結束判定

**缺哪一層**：`Observation Reliability / Dependence / Sequential Calibration Layer`。  
**哪個節點最淺**：`CrossModalDependenceContract`、`EvidenceLineageDAG`、`Sequential Modality Calibration`、`Asynchronous Observation Freshness Model`。  
**哪個概念仍只是名詞**：production 級 `Conflict-Aware Belief E-Process`。  
**哪個系統值得讀原始碼**：`brentyi/multimodalfilter`，下一步應再深讀 `crossmodal_pf.py` 與 task-specific weight models；`Visual-Seeker` 目前 repo source 尚未釋出，應持續追蹤。  
**哪篇論文需追引用**：`Conformal Fusion Under Missing Modalities`，尤其追 sequential conformal / online conformal / missing-modality calibration 延伸。  
**哪個概念最適合視覺模擬**：`Multimodal Belief Fusion × Conflict Observatory`。  
**哪個 Agent 架構最值得實作**：

```text
Observation Adapter
→ Reliability Gateway
→ Conflict / Missing-Aware Fusion Router
→ Belief Engine
→ Active Observation Planner
→ Permission Gate
```

---

# 12. 對「AI 到底怎麼運作」新增的一層

過去可以畫：

```text
Camera / Voice / Tool
→ Encoder
→ Tokens
→ Fusion
→ Reasoning
```

本輪證明這還太粗。

更接近真實的架構應是：

```text
Camera / Voice / Tool / DOM / MCP
↓
Raw Observation
↓
Timestamp + Source + Entity Grounding
↓
Per-Modality Encoder
↓
Per-Modality Evidence + Uncertainty
↓
Missing / Conflict / Staleness / Dependence Check
↓
Calibrated Fusion / Likelihood
↓
Belief State Update
↓
State Sufficiency + Risk
↓
Planner
↓
Action OR Request More Information
```

因此「Multimodal AI」真正的核心不只是把 image/audio/text embedding 放在一起，而是：**決定每一個 observation 在什麼時間、對哪個 latent state、以多少可靠性、與哪些其他 observations 有依賴關係，才能合法改變 Agent 對世界的 belief。**