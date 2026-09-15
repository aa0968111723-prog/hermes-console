# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 09:56（Asia/Taipei）**  
**本輪主題：Active Calibration × Calibration Drift × Gold-Anchor Selection × Verification Budget Allocation**

## 與歷史研究比較

上一輪已建立 `OracleCalibrationProfile → EvidenceIndependenceGraph → TruthDiscoveryEngine → VerificationVoI → Human/Reality Escalation`，但仍把 calibration 視為一份「已存在且可信的 profile」。本輪不重複 Dawid–Skene / judge dependence，而是往前追問：**calibration profile 何時失效、怎麼知道失效、哪些 gold anchors 最值得重測、有限驗證預算如何分配？**

新增主鏈：

```text
Judge Contract
(model snapshot + rubric + prompt hash + tool/schema versions)
↓
Gold Anchor Bank
↓
Anchor Scheduler
↓
Judge Re-score
↓
Judge↔Gold Residual Stream
↓
Drift Detector / Attribution
↓
Calibration State
├ VALID
├ SUSPECT
├ STALE
└ INVALID
↓
Verification Budget Controller
├ reuse calibration
├ sample more anchors
├ request human labels
├ run reality/tool oracle
└ quarantine eval
↓
Recalibration / Migration
```

---

## 本小時新發現

### 新論文 / 新架構

1. **Who Drifted: the System or the Judge? Anytime-Valid Attribution in LLM Evaluation Pipelines** — Yitao Li, 2026.  
   URL: https://arxiv.org/abs/2606.15474  
   Architecture: production score stream + fixed human-labeled anchor stream + separate betting e-processes + guard-window attribution.  
   Contribution: 將「產品變差」與「Judge 自己漂移」分離；固定 anchors 只會被 Judge 改變，因此提供 one-way identification。論文報告 silent judge version bump 在 60/60 runs 被判為 judge drift，且沒有誤判成 system drift；strict-prompt contamination 在 guard width 300 時 110/120 正確歸因。  
   Limitation: 依賴 anchor representativeness；anchor stream 太稀會比主監控更晚發現漂移。

2. **On the Shelf Life of Fine-Tuned LLM-Judges: Future-Proofing, Backward-Compatibility, and Question Generalization** — Janvijay Singh, Austin Xu, Yilun Zhou, Yefan Zhou, Dilek Hakkani-Tür, Shafiq Joty; Salesforce AI Research / UIUC / Dartmouth; ICLR 2026.  
   URL: https://openreview.net/forum?id=fVTqNpny5r  
   Code: https://github.com/iamjanvijay/judge-training-analysis  
   Dataset: DeepScaleR + MMLU-Pro derived judge pairs.  
   Architecture: question distribution `Q` × response distribution `R×R` 的 dual-distribution evaluation；weak/strong generators × SFT/DPO/SFT+DPO judges.  
   Contribution: judge shelf life 不是單一時間衰退，而至少包含 response-generator shift 與 question shift；weak-trained judge 對 stronger future responses 普遍退化，而 unseen-question generalization 更差。  
   Limitation: 主要是可驗證 reasoning datasets，未證明可直接外推到開放式、多模態、agent trajectory judging。

3. **Can We Trust LLM Judges: A Study of Capability-Dependent Biases and Multi-Judge Ensemble for Bias Calibration** — Gemma Zhang et al., 2026.  
   URL: https://arxiv.org/abs/2609.12002  
   Contribution: judge capability 與 judging accuracy 高度相關，但 stronger examinees 仍獲系統性較寬鬆判斷；提出依 online FP/FN estimates 加權的 calibrated weighted majority voting，並在 shifting-task simulation 中接近知道真實 error rates 的 oracle。  
   Limitation: label-free error-rate estimation 仍依賴 inter-judge agreement structure，若 judges 共用盲點可能高估可信度。

4. **Rethinking Verbalized Confidence for LLM-as-a-Judge: A Compatibility Shift on Post-2025 Proprietary Models** — Yu-Chung Hsiao, 2026.  
   URL: https://arxiv.org/abs/2609.10996  
   Contribution: 對 post-2025 proprietary judges，verbalized confidence 在其實驗中比過去常推薦的 logprob soft scoring 更 robust；這表示 calibration mechanism 本身也有「模型世代相容性」。  
   Limitation: proprietary-model behavior 會變，不能把本結論當永久規則。

5. **Self-Anchoring Calibration Drift in Large Language Models** — Harshavardhan, 2026.  
   URL: https://arxiv.org/abs/2603.01239  
   Contribution: multi-turn self-anchoring 能改變 expressed confidence / calibration error，且不同模型方向不同。這提醒 Agent Judge 的 calibration 不只受 model version/domain 影響，也可能受 trajectory/context history 影響。  
   Limitation: 研究的是 verbalized confidence drift，不能直接等同 classification error drift。

---

## 本小時最重要 5 個發現

### 1. Calibration 不是 Judge 的永久屬性，而是「版本化條件狀態」

**已確認事實：** fine-tuned judge 的效能會隨 question distribution 與 response-generator distribution 改變；較強的新 generator responses 對舊 judge 特別構成 future-proofing 問題。

因此 Hermes 不應保存：

```text
JudgeA.accuracy = 0.91
```

而應保存：

```text
CalibrationProfile
├ judge_model_snapshot
├ judge_prompt_hash
├ rubric_version
├ tool_schema_hash
├ target_model_family
├ question_domain
├ response_distribution_signature
├ modality
├ timestamp
├ anchor_set_version
├ confusion_matrix
├ calibration_error
├ uncertainty_interval
└ validity_state
```

**工程推論：** 任一 conditioning variable 改變，都可能使 profile 變成 stale，而不是直接沿用。

### 2. 「System drift」與「Judge drift」必須使用不同 evidence stream 才能歸因

`Who Drifted` 的核心 architecture 是：

```text
Production stream
System_t → Judge_t → score_t
          ↓
      main e-process

Fixed human anchors
Anchor_i → Judge_t → residual(judge, human)
          ↓
      anchor e-process
```

如果 production score 變差，但 frozen anchors 對 human gold 仍穩定，比較支持 **system drift**；如果 anchors 自己也移動，則支持 **judge drift**。

**底層重要性：** 單一 score time series 無法識別「被測物變了」還是「量測儀器變了」。

### 3. Gold Anchor 不應只是 random sample，而要覆蓋「最容易翻轉決策」的 calibration surface

Gold bank 應至少分層：

```text
Domain
× difficulty
× class / score range
× near-decision-boundary
× known bias slice
× generator family
× modality
× tool / agent failure type
```

Anchor utility 可建模為：

```text
AnchorValue(i)
≈ DriftSensitivity(i)
× DecisionImpact(i)
× CoverageGap(i)
× IndependenceGain(i)
- LabelCost(i)
- LeakageRisk(i)
```

**合理推論：** near-boundary anchors 通常比大量 easy anchors 更能早期發現會改變 PASS/FAIL 的 calibration drift，但不能只選 boundary，否則會失去全域 calibration coverage。

### 4. Gold anchors 自己也有 attack / contamination surface

既有 crowdsourcing 研究已證明固定 gold questions 可被辨識與針對；對 API Judge 更大的風險是 anchor leakage、provider training contamination、prompt memorization。

因此：

```text
Gold Anchor
≠ 永久真實且不可被污染的神諭
```

Hermes 應區分：

```text
IMMUTABLE_CORE_ANCHOR
ROTATING_PRIVATE_ANCHOR
FRESH_HUMAN_ANCHOR
SYNTHETIC_STRESS_ANCHOR
```

並記錄 exposure / reuse count / leakage suspicion。

### 5. Calibration budget 本質上也是 Active Perception / Value-of-Information 問題

前幾輪的 Active Perception 公式可直接重用：

```text
VerificationVoI(a)
=
Expected Decision Loss Before
- E[Decision Loss After a]
- VerificationCost(a)
```

候選 action：

```text
REUSE_PROFILE
SAMPLE_CORE_ANCHORS
SAMPLE_BOUNDARY_ANCHORS
SAMPLE_DOMAIN_SLICE
ASK_HUMAN
RUN_REAL_TOOL
RUN_SYMBOLIC_ORACLE
FULL_RECALIBRATION
QUARANTINE
```

所以不是「每小時固定重跑 200 gold cases」，而是依 drift probability、decision risk、domain novelty、profile age 與 evidence independence 動態分配 budget。

---

## Architecture Breakdown

### Active Calibration Runtime

```text
Incoming Evaluation Case
↓
Calibration Contract Resolver
├ judge snapshot
├ prompt/rubric hash
├ target distribution signature
├ modality
└ tool/runtime version
↓
Calibration Profile Lookup
↓
Validity Estimator
├ profile age
├ anchor residual drift
├ domain distance
├ generator distance
├ judge-version change
├ prompt/rubric change
└ context/trajectory shift
↓
Calibration State
↓
Active Anchor Selector
↓
Gold / Human / Reality Evidence
↓
Drift Attribution Engine
├ system drift
├ judge drift
├ both
└ inconclusive
↓
Recalibration Engine
↓
Truth Discovery / Oracle Router
↓
Decision Gate
```

### System architecture insight

這一層應放在 `TruthDiscoveryEngine` **之前**。如果 Oracle calibration 已失效，再精密的 evidence fusion 只是在融合 stale likelihoods。

---

## Bottom-Level Logic

### A. Judge confusion matrix under condition c

```text
C_j,c[y_true, y_judge]
= P(y_judge | y_true, judge=j, condition=c)
```

`condition c` 不應只是一個 domain 字串，而是：

```text
c = (
  model_snapshot,
  rubric,
  prompt,
  target_generator,
  question_domain,
  modality,
  trajectory_context
)
```

### B. Drift residual

對固定 gold anchor `i`：

```text
r_i,t = loss(Judge_t(x_i), y_i^gold)
```

監控的不是單次錯誤，而是 residual distribution 隨時間的改變。

### C. Sequential evidence / e-process intuition

建立非負 evidence process `E_t`，在 null hypothesis（例如 judge calibration 沒變）成立時保持受控；當 `E_t` 持續增長並跨過預設門檻，才宣告 drift。關鍵優點是支援 continuous monitoring，而不是每小時反覆做未校正的固定-window significance test。

### D. Calibration TTL 不應只是 wall-clock TTL

```text
EffectiveCalibrationAge
=
f(
 wall_clock_age,
 model_version_delta,
 prompt_delta,
 domain_shift,
 target_model_shift,
 observed_anchor_drift
)
```

因此同一份 profile 可能 30 天仍有效，也可能一次 model alias silent update 後立刻失效。

---

## Visual Simulation Idea

# Calibration Drift Observatory × Gold-Anchor Budget Lab

左側顯示 Judge contract：

```text
Judge snapshot       J-2026-09-01
Rubric               r17
Prompt hash          8f4a…
Anchor bank          G12
Calibration age      14h
State                SUSPECT
```

中央是 calibration surface：

```text
                 Easy   Boundary   Hard
Code              .96      .82      .71
Research          .94      .79      .68
Tool-use          .92      .61 ⚠    .55 ⚠
Multimodal        .89      .58 ⚠    .49 ⚠
```

右側顯示下一個 verification action：

```text
Action                  Expected VoI   Cost
20 random anchors           .07          20
10 boundary anchors         .24          10
5 tool-use anchors          .31           5
1 real sandbox replay       .38          14
Human adjudication          .43          40
```

Agent 選：

```text
SAMPLE 5 TOOL-USE ANCHORS
```

若 anchor residual stream 顯著漂移：

```text
JUDGE_DRIFT suspected
↓
QUARANTINE CURRENT EVAL
↓
FULL RECALIBRATION
↓
new CalibrationProfile
```

使用者可拖動：

```text
Verification Budget
Human Cost
False-Pass Cost
False-Fail Cost
Anchor Refresh Rate
```

觀察 selector 如何改變。

---

## Code / GitHub

### `iamjanvijay/judge-training-analysis`

Repository: https://github.com/iamjanvijay/judge-training-analysis

值得看的目錄：

```text
analysis/
configs/
  evaluations/
  trainings/
eval/
  run_eval.py
  run_batched_eval.py
  print_format_errors_in_scores.py
  resolve_format_errors_in_scores.py
train/
utils/
```

本輪實際追到 `eval/run_eval.py`：

```text
input JSONL
↓
prompt + gold label
↓
vLLM generation
↓
JSON repair / verdict extraction
↓
A / B / C(format failure)
↓
accuracy + incorrect_format_rate
↓
flip-pair consistent_accuracy
```

值得注意：其 evaluation 不只算 raw accuracy；對 `pairs_flip.jsonl` 還要求一對 order-flipped examples 都答對才計入 `consistent_accuracy`。這是一個很好的「同一 judge 不能只在單一 presentation 上碰巧正確」的 bottom-level consistency check。

但這個 repo 的核心目標仍是研究 judge training / shelf life，不是 production drift monitor；Hermes 需要額外補 anchor stream、sequential detector、contract hash、active anchor selector。

---

## Papers

### Paper A
- **Title:** Who Drifted: the System or the Judge? Anytime-Valid Attribution in LLM Evaluation Pipelines
- **Authors:** Yitao Li
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2606.15474
- **Code:** 本輪未確認官方 code
- **Dataset:** 固定 human anchors + production evaluation streams；論文亦在 TL;DR summarization domain replication
- **Architecture:** main monitoring process + anchor monitoring process + guard-window attribution
- **Contribution:** continuous / anytime-valid drift attribution
- **Limitations:** anchor coverage 與 interleave rate 決定 detection power / latency
- **改變了什麼:** 從「看到 eval score drift」提升為「判斷是 system 還是 measurement instrument 漂移」。

### Paper B
- **Title:** On the Shelf Life of Fine-Tuned LLM-Judges: Future-Proofing, Backward-Compatibility, and Question Generalization
- **Authors:** Janvijay Singh, Austin Xu, Yilun Zhou, Yefan Zhou, Dilek Hakkani-Tür, Shafiq Joty
- **Institution:** Salesforce AI Research; UIUC; Dartmouth
- **Year:** 2026 / ICLR 2026
- **URL:** https://openreview.net/forum?id=fVTqNpny5r
- **Code:** https://github.com/iamjanvijay/judge-training-analysis
- **Dataset:** DeepScaleR, MMLU-Pro derived response pairs
- **Architecture:** Q × R × R distribution-shift evaluation
- **Contribution:** formalizes future-proofing / backward compatibility / question generalization
- **Limitations:** mostly verifiable reasoning; open-ended and multimodal transfer unresolved
- **改變了什麼:** Calibration validity 必須 conditioned on target distribution，而非只 conditioned on Judge identity。

### Paper C
- **Title:** Can We Trust LLM Judges: A Study of Capability-Dependent Biases and Multi-Judge Ensemble for Bias Calibration
- **Authors:** Gemma Zhang, Prachi Badarayani, Asmi Kumar, Sadid Hasan, Sulaiman Vesal
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2609.12002
- **Code:** 本輪未確認
- **Architecture:** multi-judge absolute scoring + online FP/FN weighted voting
- **Contribution:** capability-dependent judge bias + label-free online calibration
- **Limitations:** shared judge dependence / correlated blind spots remain a threat
- **改變了什麼:** Judge weight 應是動態 error profile，而不是固定 reputation score。

---

## Unknown / Open Questions

1. **Anchor selection 的最優 objective 是什麼？** 只最大化 drift detection power 可能忽略 high-risk rare slices；需要把 decision consequence 與 coverage 一起納入。
2. **如何分離 Judge drift 與 Gold drift？** 人類 rubric、政策與真實世界也會改變；immutable anchors 只能測 instrument stability，不能永遠代表 current truth。
3. **多模態 / Agent trajectory 的 calibration surface 如何定義？** 文字 pairwise judge 的 confusion matrix 遠不足以表示 video grounding、tool execution、MCP permission、long-horizon trajectory 等 conditional errors。

---

## 下一輪研究

下一輪建議：

# Calibration Surface × Domain Shift Detection × Conditional Error Models × Multimodal/Agent Judge Calibration

優先研究：

```text
DomainConditionedConfusionMatrix
CalibrationSurface
GeneratorShiftDetector
QuestionShiftDetector
ModalityShiftDetector
TrajectoryContextShift
ConditionalCoverageGap
CalibrationTransfer
CalibrationTransportability
```

核心問題：

> 一個 Judge 在「一般文字 QA」校準良好，怎麼知道它在「多模態 tool-using agent trajectory」仍然可信？

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
CalibrationContract
CalibrationProfileValidity
CalibrationTTL
EffectiveCalibrationAge
CalibrationDriftEvent
JudgeDrift
SystemDrift
GoldAnchorBank
GoldAnchorSlice
GoldAnchorSelector
AnchorExposureRisk
AnchorLeakageRisk
ActiveCalibrationPolicy
AnchorResidualStream
SequentialDriftDetector
DriftAttributionEngine
VerificationBudgetController
CalibrationQuarantine
JudgeMigration
FutureProofing
BackwardCompatibility
QuestionDistributionShift
ResponseDistributionShift
CalibrationSurface
```

### Edges

```text
Judge Identity
≠ Calibration Validity

Calibration Accuracy
→ Is Conditioned On Distribution

Question Shift
→ Can Invalidate Calibration

Response Generator Shift
→ Can Invalidate Calibration

Fixed Anchor Residual Drift
→ Evidence For Judge Drift

Production Score Drift
+
Stable Anchor Residual
→ Evidence For System Drift

Gold Anchor
≠ Permanent Ground Truth

Anchor Leakage
→ Reduces Calibration Authority

Verification Budget
→ Should Follow Expected Information Value

Model / Prompt / Rubric Change
→ Increases Effective Calibration Age

Stale Calibration
→ Must Precede Truth-Discovery Warning
```

---

## 本輪結束判定

- **缺哪一層：** `Calibration Surface + Domain/Generator/Modality Shift Detection Layer`
- **哪個節點最淺：** `GoldAnchorSelector`、`EffectiveCalibrationAge`、`VerificationBudgetController`
- **哪個概念仍只是名詞：** production 級 `CalibrationTransportability`
- **哪個系統值得讀原始碼：** `iamjanvijay/judge-training-analysis`，下一輪應繼續追 `analysis/` 與 `configs/evaluations/`，把 future-proof / compatibility 指標實際計算流程拆出來
- **哪篇論文需追引用：** `Who Drifted`；其次 `On the Shelf Life of Fine-Tuned LLM-Judges`
- **哪個概念最適合視覺模擬：** `Calibration Drift Observatory × Gold-Anchor Budget Lab`
- **哪個 Agent 架構最值得實作：** `Calibration Contract Resolver → Active Anchor Selector → Drift Attribution → Budget Controller → Recalibration/Quarantine`

## 本輪核心答案

> AI 的 verifier 不能只被問「你有多準？」；真正的問題是「你在這個模型版本、這個 prompt、這個 domain、這種 generator、這段 agent trajectory 上，現在還有多準？」Calibration 是會過期的條件狀態。成熟 Agent 因此必須像維護感測器一樣維護 Judge：持續用少量高價值 gold anchors 檢查量測儀器是否漂移，分辨到底是被測系統變差還是 Judge 自己變了，並把有限的人類與 reality-verification 預算花在最能改變決策的地方。
