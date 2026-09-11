# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 06:55（Asia/Taipei）**

**主題：Multimodal State Reliability × Sensor Conflict × Evidential Fusion × State Commit / Rollback × Versioned World-State Register**

---

## 本小時新發現

### 新論文 / 架構

1. **Multimodal Learning on Low-Quality Data with Conformal Predictive Self-Calibration (CPSC)** — Xun Jiang, Yufan Gu, Disen Hu, Yuqing Hou, Yazhou Yao, Fumin Shen, Heng Tao Shen, Xing Xu, CVPR 2026。核心不是直接相信每個 modality，而是用 conformal predictor 估 reliability，進行 representation self-calibration 與 gradient self-calibration。Code: https://github.com/XunCHN/CPSC
2. **To Fuse or to Drop? Dual-Path Learning for Resolving Modality Conflicts in Multimodal Emotion Recognition** — Yangchen Yu et al., 2026。提出「可解衝突 soft calibration / 不可解衝突 hard arbitration」雙路徑；嚴重衝突時允許放棄 fused prediction，退回較可靠 unimodal path。URL: https://arxiv.org/abs/2605.04877
3. **Multimodal Learning with Uncertainty Quantification based on Discounted Belief Fusion** — Grigor Bezirganyan, Sana Sellami, Laure Berti-Equille, Sébastien Fournier, AISTATS 2025。以 evidential / subjective-logic 表示 belief + uncertainty，當 modalities 互相衝突且本身 confident 時，降低不可信 evidence 的 mass，而不是盲目平均。Code: https://github.com/bezirganyan/DBF_uncertainty
4. **MRUF: Multi-granularity Routing with Uncertainty-Aware Fusion for Robust Multimodal Sentiment Analysis** — Haoran Ma, Yinfeng Yu, Liejun Wang, 2026。以 modality/subspace routing + uncertainty-aware inverse-variance weighting，在樣本級動態處理不同 modality quality。URL: https://arxiv.org/abs/2607.10599
5. **Trustworthy Multi-Modal Ultrasound Fusion via Uncertainty Calibration and Conflict Resolution** — Peng Wan et al., IEEE TMI 2025/2026 publication cycle。把 per-modality uncertainty 與 cross-modal consistency 一起用於 credibility-aware fusion。DOI: 10.1109/TMI.2025.3615589

---

# 本小時最重要 5 個發現

## 1. Multimodal Fusion ≠ Multimodal State Commit

前一輪 Hermes 已建立：

```text
Observation Selection
→ Multimodal Encode
→ Cross-Modal Prediction
→ World-State Register
```

但真正 production runtime 還缺一道關鍵邊界：

```text
Fused Representation
≠
Committed World State
```

模型可以先融合資訊，卻不代表融合後的內容應直接寫入 persistent state。

Hermes 應拆成：

```text
Raw Observation
↓
Per-Modality Evidence
↓
Reliability Estimation
↓
Conflict Detection
↓
Fusion / Drop / Verify Decision
↓
State Update Proposal
↓
Commit Gate
├ COMMIT
├ PARTIAL_COMMIT
├ VERIFY
├ HOLD
└ REJECT / ROLLBACK
↓
Versioned World-State Register
```

**重要性：** 防止一次錯誤影像、ASR hallucination、過期 memory 或異常 tool telemetry 直接污染長期世界模型。

**限制：** 目前文獻多半在 classification / emotion / medical fusion，從「分類輸出 reliability」轉移到「persistent agent state write reliability」仍屬工程推論，需要 Hermes 自己驗證。

---

## 2. Confidence ≠ Reliability；Reliability 應拆成 Evidence + Uncertainty + Conflict

Discounted Belief Fusion 的底層實作非常值得 Hermes 借鏡。其 `model.py` 對每個 view 先產生 non-negative evidence，再轉成：

```text
belief_k = evidence_k / total_strength
uncertainty = num_classes / total_strength
```

接著比較 modalities 的 prediction discrepancy，並結合各自 uncertainty 形成 conflict quantity，再計算 discount factor：

```text
per-modality evidence
↓
belief / probability / uncertainty
↓
pairwise prediction conflict
×
confidence compatibility
↓
agreement / discount
↓
discounted belief
↓
uncertainty mass increases
↓
fused evidence
```

這有一個對 Agent state 很重要的設計思想：

> 當來源互相衝突時，不一定要把 mass 重新硬分給其中一邊；可以把一部分 mass 回收到「不知道」。

Hermes 應建立：

```text
StateEvidence
├ support
├ uncertainty
├ conflict_mass
├ provenance
├ modality
├ timestamp
└ calibration_scope
```

因此新的核心關係：

```text
High Confidence ≠ High Reliability
Conflict ≠ Choose One Immediately
Conflict Can Increase Explicit Unknown Mass
```

---

## 3. Conflict 有兩種：Resolvable Conflict 與 Irreconcilable Conflict

DCR（To Fuse or to Drop?）把 conflict 分成很實用的兩類：

### Resolvable

```text
video blurred
+ audio clear
+ text partial
```

可透過 cross-modal calibration / complementarity 改善。

### Irreconcilable

```text
video indicates person left room
microphone still attributes current speech to same person
identity tracker says unknown
```

此時強制平均可能比退回單一可信來源更危險。

因此 Hermes 應把 Conflict Resolver 變成 action selector：

```text
Conflict State
↓
Resolver
├ FUSE
├ DOWNWEIGHT
├ DROP modality
├ REQUEST MORE OBSERVATION
├ QUERY TOOL
├ WAIT
└ ESCALATE UNKNOWN
```

而不是只有：

```text
weighted_sum(modalities)
```

DCR 甚至把 hard arbitration 建成 contextual bandit，代表「選 fusion 還是 unimodal」本身就是 decision problem。

對 Hermes 的合理工程延伸：

```text
ConflictResolutionUtility(a)
=
Expected Decision Improvement
- State Pollution Risk
- Observation Cost
- Latency
```

---

## 4. Conformal Calibration 可以變成 State-Write Calibration Layer

CPSC 的原始碼並不是概念 demo。`CPSC_CREMAD/CPSC_cremad.py` 中有 `CPThresholdCalibrator`：

```text
validation examples
↓
unimodal class probabilities
↓
nonconformity = 1 - P(true class)
↓
sort nonconformity scores
↓
quantile threshold
↓
conformal acceptance set
```

訓練階段再對 audio/video feature variants：

```text
feature variants
↓
CP model prediction
↓
conformal set membership
↓
rank-based reliability
↓
Top-K reliable variants
↓
feature fusion
```

更進一步，程式還會依 reliability 對 encoder gradient 做縮放。

這對 Hermes 有一個新用途：

# Conformal State Commit Gate

例如某 observation proposal：

```text
"door is open"
```

不要直接 commit，而是建立：

```text
calibration stratum
= camera_model × lighting × region × task_type

nonconformity score
↓
calibrated acceptance threshold
↓
COMMIT / VERIFY / UNKNOWN
```

重要 caveat：標準 conformal coverage 需要 exchangeability 或相應 extension；streaming、drift、adaptive sensing 下不能把 offline coverage 保證直接照搬。

所以 Hermes 必須存：

```text
CalibrationCertificate
├ calibration_dataset
├ environment_scope
├ modality_scope
├ score_function
├ alpha
├ calibration_time
├ drift_status
└ validity_assumptions
```

---

## 5. Persistent State 需要 Transaction Semantics，而不只是 Memory Write

目前多數 multimodal paper 關心的是 prediction output；Hermes 要處理的是：

```text
Observation_t
→ State_t+1
→ Future reasoning / planning / tool use
```

一旦錯誤 state 被寫入，它會有 feedback：

```text
Bad Observation
↓
Bad State Commit
↓
Future Attention / Retrieval conditioned on bad state
↓
Bad Plan
↓
Tool Action
↓
World Effect
↓
New Observations consistent with own mistake
```

因此 state update 應接近 database transaction：

```text
BEGIN STATE_TX
↓
Read current register version V42
↓
Propose delta Δ
↓
Attach evidence + reliability + conflicts
↓
Validate invariants
↓
Conflict check
↓
COMMIT V43
or
ABORT
↓
Post-commit monitor
↓
ROLLBACK V42 if contradicted
```

Hermes 應建立：

```text
WorldStateVersion
├ version_id
├ parent_version
├ delta
├ supporting_evidence
├ rejected_evidence
├ uncertainty
├ conflict_set
├ commit_policy
├ committed_at
└ rollback_target
```

這把「AI memory」從 append-only text history 提升成真正可驗證、可回滾的 world-state store。

---

# Architecture Breakdown

## Reliability-Gated Versioned World-State Runtime

```text
Camera / Image / Voice / Video / Tool / MCP / Memory
                         ↓
                Observation Normalizer
                         ↓
              Per-Modality Evidence Encoder
                         ↓
                  Reliability Layer
        ├ predictive uncertainty
        ├ conformal nonconformity
        ├ source freshness
        ├ provenance quality
        └ historical calibration
                         ↓
                  Conflict Graph
        ├ agreement
        ├ contradiction
        ├ redundancy
        ├ missingness
        └ temporal inconsistency
                         ↓
               Conflict Resolution Policy
        ├ FUSE
        ├ DISCOUNT
        ├ DROP
        ├ VERIFY
        └ DEFER
                         ↓
                State Update Proposal
                         ↓
                  State Commit Gate
        ├ invariant check
        ├ safety relevance
        ├ decision impact
        ├ evidence threshold
        └ calibration validity
                         ↓
                 Versioned Register
                         ↓
             Reasoning / Planning / Tools
                         ↓
                Post-Commit Evidence
                         ↓
          Confirm / Amend / Rollback / Fork
```

---

# Bottom-Level Logic

## A. Evidential reliability

對 modality `m` 的 evidence vector `e_m ≥ 0`：

```text
alpha_m = e_m + 1
S_m = Σ_k alpha_m,k
b_m,k = e_m,k / S_m
u_m = K / S_m
```

其中：

```text
b = committed belief mass candidate
u = explicit uncertainty mass
```

兩 modality 的 conflict 可以用 distribution distance，再乘 confidence compatibility；高 conflict 時降低 belief mass，把被 discount 的部分回收到 uncertainty。

對 Hermes 的關鍵不是一定使用 Dempster-Shafer，而是保留這個 invariant：

```text
support + uncertainty = accounted mass
```

而不是讓 softmax 永遠假裝總有一個答案。

## B. State conflict graph

每個 observation proposal 成為 node：

```text
O_camera
O_audio
O_tool
O_memory
```

edges：

```text
AGREES_WITH
CONTRADICTS
REFINES
TEMPORALLY_PRECEDES
DERIVED_FROM
DUPLICATES
```

計算：

```text
ConflictScore(i,j)
=
SemanticContradiction
× SourceConfidence
× TemporalOverlap
× StateRelevance
```

## C. Commit decision

```text
CommitUtility(Δ)
=
DecisionValue(Δ)
+ SafetyValue(Δ)
+ EvidenceStrength(Δ)
- ConflictRisk(Δ)
- StatePollutionRisk(Δ)
- VerificationOpportunityCost(Δ)
```

不是所有 observation 都值得 permanent write。

---

# Visual Simulation Idea

# **Multimodal State Commit & Rollback Lab**

畫面左側是 live multimodal evidence：

```text
CAMERA
person_A left room
reliability .82

AUDIO
person_A speaking now
reliability .61

TOOL: badge_reader
person_A exit recorded
reliability .97

MEMORY
person_A usually stays until 18:00
freshness LOW
```

中央建立 conflict graph：

```text
Camera ───── agrees ───── Badge
   │                        │
   └──── contradicts ─── Audio

Memory ─ weak prior ───────┘
```

右側顯示：

```text
STATE UPDATE PROPOSAL
person_A.location = outside

support         .91
uncertainty     .07
conflict_mass   .18
safety impact   MEDIUM

[COMMIT]
[PARTIAL]
[VERIFY AUDIO ID]
[HOLD]
```

再顯示 state history：

```text
V41 ─ V42 ─ V43 ─ V44
              ▲
              │ contradiction discovered
              └──── rollback → V42 + corrected delta
```

互動模式可以故意加入：

```text
camera blur
ASR corruption
stale memory
spoofed tool event
clock skew
```

看不同 reliability policy 是否會污染 world state。

---

# Code / GitHub

## XunCHN/CPSC

Repo: https://github.com/XunCHN/CPSC

值得看的結構：

```text
CPSC_CREMAD/
├ CPSC_cremad.py
├ data/
├ dataset/
├ hypergrad/
├ model/
│  ├ AudioVideo.py
│  └ Resnet.py
└ utils/
```

核心檔案：

- `CPSC_CREMAD/CPSC_cremad.py`
  - `CPThresholdCalibrator`
  - nonconformity quantile calibration
  - feature-variant reliability selection
  - top-3 reliable feature aggregation
  - reliability-conditioned gradient scaling
- `CPSC_CREMAD/model/AudioVideo.py`
  - audio/video classifier + feature variants

對 Hermes 的價值：把 reliability 從 static score 推到 calibrated gate。

## bezirganyan/DBF_uncertainty

Repo: https://github.com/bezirganyan/DBF_uncertainty

核心：

```text
model.py
loss_function.py
main.py
data.py
```

`model.py` 的 `DBFModel`：

```text
EvidenceCollector per view
↓
Dirichlet-like evidence
↓
belief + uncertainty
↓
pairwise discrepancy
↓
confidence-weighted conflict
↓
discount
↓
uncertainty redistribution
↓
fused evidence
```

特別值得看：

- `get_doc_belief_fusion`
- `get_weighted_doc_belief_fusion`
- `get_dempsters_combination`
- `EvidenceCollector`

---

# Papers

## 1. Multimodal Learning on Low-Quality Data with Conformal Predictive Self-Calibration

- **Authors:** Xun Jiang, Yufan Gu, Disen Hu, Yuqing Hou, Yazhou Yao, Fumin Shen, Heng Tao Shen, Xing Xu
- **Year:** 2026
- **Venue:** CVPR 2026
- **URL:** https://arxiv.org/abs/2605.03820
- **Code:** https://github.com/XunCHN/CPSC
- **Datasets:** CREMA-D, NYU Depth V2, SUN RGB-D, MVSA and others
- **Architecture:** representation self-calibration + gradient self-calibration + self-updating conformal predictor
- **Contribution:** unified handling of modality imbalance/noise through calibrated reliability
- **Limitation for Hermes:** designed primarily for supervised multimodal learning; streaming state-write guarantees are not provided.

## 2. Multimodal Learning with Uncertainty Quantification based on Discounted Belief Fusion

- **Authors:** Grigor Bezirganyan, Sana Sellami, Laure Berti-Equille, Sébastien Fournier
- **Institution:** research affiliations listed in AISTATS paper
- **Year:** 2025
- **Venue:** AISTATS 2025
- **URL:** https://proceedings.mlr.press/v258/bezirganyan25a.html
- **Code:** https://github.com/bezirganyan/DBF_uncertainty
- **Architecture:** evidential predictions + subjective-logic uncertainty + conflict discounting
- **Contribution:** order-invariant conflict-aware uncertainty fusion, explicitly avoids underestimating uncertainty under conflict
- **Limitation:** classification-centric; source provenance, temporal consistency and persistent-state rollback are outside scope.

## 3. To Fuse or to Drop? Dual-Path Learning for Resolving Modality Conflicts in Multimodal Emotion Recognition

- **Authors:** Yangchen Yu, Qian Chen, Jia Li, Zhenzhen Hu, Jinpeng Hu, Lizi Liao, Erik Cambria, Richang Hong
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.04877
- **Architecture:** Affective Fusion Distiller + contextual-bandit Affective Discernment Agent
- **Contribution:** explicitly distinguishes conflicts that should be calibrated from conflicts that should bypass fusion
- **Limitations:** domain-specific emotion recognition; arbitration reward design may not transfer directly to tool/world-state decisions.

## 4. MRUF: Multi-granularity Routing with Uncertainty-Aware Fusion for Robust Multimodal Sentiment Analysis

- **Authors:** Haoran Ma, Yinfeng Yu, Liejun Wang
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.10599
- **Architecture:** subspace/modality routing + uncertainty-aware reweighting + contrastive alignment
- **Contribution:** instance-level modality quality routing
- **Limitation:** learned fusion reliability is not equivalent to calibrated persistent-state reliability.

---

# 與歷史研究比較

前一輪做到：

```text
Active Perception
+ Cross-Modal Predictive Alignment
+ World/Event Split
+ State Update Budget
```

本輪新增的不是重做 fusion，而是補上：

```text
State Update Proposal
↓
Reliability
↓
Conflict
↓
Commit Transaction
↓
Version
↓
Rollback
```

因此研究鏈現在變成：

```text
Should I observe?
↓
What did each modality say?
↓
How reliable is each source?
↓
Do sources conflict?
↓
Should I fuse, drop, or verify?
↓
Should this information modify persistent state?
↓
Can that write later be rolled back?
```

---

# Unknown / Open Questions

1. **Coverage under adaptive sensing:** conformal calibration 在 observation policy 本身依 past observations 動態改變時，如何維持有效 coverage？
2. **Conflict attribution:** camera/audio/tool 衝突時，如何判斷是 sensor corruption、semantic mismatch、clock skew、identity mismatch，還是真的世界發生了快速 state transition？
3. **Rollback semantics:** 已基於錯誤 V43 執行的 external effects，rollback world-state register 本身並不能 rollback 真實世界 side effects；需要 compensating transaction / causal repair。

---

# 下一輪研究

下一輪優先：

# **Temporal Alignment × Event-Time Semantics × Out-of-Order Multimodal Streams × Causal State Repair**

因為很多「sensor conflict」可能根本不是語義衝突，而是時間沒對齊：

```text
video frame @ t=10.2
ASR chunk @ t=8.7–11.1
MCP event emitted @ t=10.0
received @ t=12.4
memory snapshot @ t=7.0
```

下一輪應拆：

```text
Multimodal Event Stream
↓
Event Time vs Processing Time
↓
Clock / Timestamp Alignment
↓
Out-of-Order Buffer
↓
Temporal Join
↓
Causal Ordering
↓
Conflict Reclassification
↓
State Commit
↓
Late Event
↓
State Repair / Compensating Action
```

研究方向：stream processing watermark、event-time systems、temporal knowledge graph、late-data correction、causal consistency、bitemporal database、streaming sensor fusion。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Multimodal State Reliability
Modality Reliability Posterior
Evidential Uncertainty
Conflict Mass
Conflict Graph
Resolvable Conflict
Irreconcilable Conflict
Fusion Action
Drop-Modality Action
Conformal State Commit Gate
State Update Proposal
State Transaction
World-State Version
State Commit Certificate
State Rollback
State Pollution
Post-Commit Validation
Calibration Scope
Evidence Provenance
```

## Edges

```text
Observation --PROPOSES--> StateDelta
StateDelta --SUPPORTED_BY--> Evidence
Evidence --HAS_RELIABILITY--> ReliabilityPosterior
Evidence --CONFLICTS_WITH--> Evidence
Conflict --RESOLVED_BY--> FusionAction
Conflict --RESOLVED_BY--> VerifyAction
Conflict --RESOLVED_BY--> DropModalityAction
StateDelta --VALIDATED_BY--> CommitGate
CommitGate --CREATES--> WorldStateVersion
WorldStateVersion --PARENT_OF--> WorldStateVersion
ContradictingEvidence --TRIGGERS--> Rollback
Rollback --RESTORES--> PriorStateVersion
```

新增關鍵否定關係：

```text
Fusion ≠ Commit
Confidence ≠ Reliability
Softmax Certainty ≠ Calibrated Evidence
Conflict ≠ Average
Conflict ≠ Always Pick Highest Confidence
Observation ≠ Persistent State
State Write ≠ Irreversible Truth
Rollback State ≠ Rollback External World
More Modalities ≠ More Reliable State
```

---

# 本輪結束判斷

- **缺哪一層：** Temporal/Event-Time Alignment + Causal State Repair。
- **哪個節點最淺：** `StateCommitCertificate`，目前已有工程結構但缺正式 statistical/causal validity definition。
- **哪個概念仍只是名詞：** `StatePollutionRisk`、`Decision-Sufficient World Register`、`ConflictAttributionCertificate`。
- **哪個系統值得讀原始碼：** 第一優先 `XunCHN/CPSC` 的 calibrator + reliability selection；第二優先 `bezirganyan/DBF_uncertainty/model.py`；之後應找 streaming event-time / temporal database codebase。
- **哪篇論文需追引用：** CPSC（conformal multimodal reliability）與 DBF（conflict-aware evidential fusion），並追 conformal prediction under distribution shift/adaptive sampling 的後續文獻。
- **哪個概念最適合視覺模擬：** `Multimodal State Commit & Rollback Lab`。
- **哪個 Agent 架構最值得實作：**

> **Reliability-Gated Transactional World-State Runtime = Per-Modality Evidence Encoder + Calibrated Reliability Layer + Conflict Graph + Fuse/Drop/Verify Resolver + Transactional State Commit Gate + Versioned World-State Register + Post-Commit Validator + Rollback/Repair Engine。**

---

# 回到「AI 到底怎麼運作」

本輪把多模態鏈補成：

```text
Camera / Voice / Video / Tool
↓
Encoder
↓
Per-Modality Evidence
↓
Reliability / Uncertainty
↓
Cross-Modal Conflict Graph
↓
Fuse / Drop / Verify
↓
State Update Proposal
↓
Commit Gate
↓
Versioned World State
↓
Reasoning
↓
Planning
↓
Tool / MCP / Action
↓
World Effect
↓
New Evidence
↓
Confirm / Amend / Rollback
```

核心結論：**成熟多模態 Agent 不能把「模型剛剛看到了什麼」直接等同於「世界現在就是什麼」。它需要像資料庫 transaction 一樣，先評估 evidence、uncertainty、source conflict 與 calibration validity，再決定是否把新資訊 commit 成未來所有 reasoning 都會依賴的 persistent world state；而且這個 state 必須可版本化、可被新證據推翻、可 rollback。**