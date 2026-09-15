# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 16:51（Asia/Taipei）**

**本輪主題：Alignment Uncertainty × Modality-Conditioned Calibration × Cross-Modal Conflict × Decision-Level Risk Bounds**

## 與歷史研究比較

前一輪已建立 CrossModalEvidenceUnit、VideoEvidenceUnit、VisualEvidenceRegion、TemporalEvidenceInterval、CrossModalEvidenceGraph 與 DecisionRiskCertificate，解決「證據單位是什麼、如何追到來源、如何從 coarse index rehydrate 到 fine evidence」。本輪不重複 granularity / provenance，而補下一個缺口：**跨模態 evidence 已對齊，不代表 alignment 本身可信；confidence 也不能只是一個 scalar。**

本輪把系統推進為：

```text
Cross-Modal Evidence Units
→ Alignment Hypotheses
→ Alignment Uncertainty
→ Modality-Specific Confidence
→ Cross-Modal Conflict Detection
→ Evidence Arbitration
→ Risk-Controlled Decision Gate
→ EXECUTE / VERIFY / ABSTAIN / ESCALATE
```

## 本小時新發現

### 新論文 / 架構

1. **VL-Calibration: Decoupled Confidence Calibration for Large Vision-Language Models Reasoning** — Wenyi Xiao, Xinchi Xu, Leilei Gan, ACL 2026. 核心是把單一 confidence 拆成 visual confidence 與 reasoning confidence；visual certainty 結合 image perturbation 下的 KL divergence 與 token entropy，並用 token-level advantage reweighting 做 RL calibration。Code: https://github.com/Mr-Loevan/VL-Calibration
2. **Uncertainty-Calibrated Elastic Alignment for Multimodal Sentiment Analysis with Missing Modalities (EASE)** — Kang He et al., Findings ACL 2026. 用 probabilistic imputation 表示跨模態 ambiguity，再以 uncertainty 控制 elastic alignment 強度，避免在 ambiguous region 強制 rigid alignment；並以 cross-view predictive consistency 穩定 modality degradation 下的 decision boundary。
3. **When Image and Text Disagree: Cross-Modal Evidence Conflict in Multimodal RAG / CMC-Bench** — MAGMaR 2026. 3,768 instances，四種 conflict（factual / temporal / entity / granularity）與四種 evidence condition；跨模態衝突使 accuracy 相對 aligned evidence 下跌約 0.17–0.46，且模型常呈現 modality lean，而非可靠 arbitration。
4. **Controlling Uncertainty and Hallucination Risk in Multi-Agent Fact Verification** — Adam Kostka, Jarosław A. Chudziak, UAI 2026 / PMLR 337. 以 Score Deviation penalty 處理 correlated disagreement，再用 Learn-Then-Test calibration 產生可控制 expected FDR 的 threshold；在 2% risk budget 報告 71.7% recall，相較 naive baseline 47.4%。
5. **VLM Judges Can Rank but Cannot Score** — 2026. 用 conformal prediction 將 VLM judge point score 轉成 calibrated interval；不同 task 的 interval width 差異大，aesthetics/natural image 約佔 score range 40%，chart/math reasoning 可到約 70%，證明 ranking correlation 與 absolute-score reliability 可脫鉤。

## 本小時最重要 5 個發現

### 1. Alignment 是 latent hypothesis，不是事實

跨模態系統常隱含假設：

```text
Text span T
↔ Image region R
↔ Video interval V
```

但真正應保存的是：

```text
AlignmentHypothesis
├ source_unit_A
├ source_unit_B
├ relation_type
├ alignment_score
├ aleatoric_uncertainty
├ epistemic_uncertainty
├ perturbation_stability
├ temporal_consistency
├ entity_consistency
└ calibration_slice
```

EASE 的重要啟示是：uncertainty 高時應**放鬆 alignment constraint**，而不是逼不同 modality 一定進入同一 deterministic representation。

**底層：** modality input → probabilistic representation/imputation → uncertainty estimate → uncertainty-conditioned alignment strength → cross-view consistency → fused decision。

**限制：** EASE 是 multimodal sentiment / missing-modality setting，不能直接宣稱其 alignment guarantee 可泛化到 agent tool evidence。

### 2. Perception uncertainty 與 reasoning uncertainty 必須拆開

VL-Calibration 指出單一 confidence 混合了兩種 failure：

```text
Image → 看錯 → reasoning 合理
Image → 看對 → reasoning 推錯
```

因此 Hermes 應使用：

```text
MultimodalConfidenceVector
├ perception_confidence
├ grounding_confidence
├ alignment_confidence
├ reasoning_confidence
├ retrieval_confidence
└ action_confidence
```

VL-Calibration 的 visual certainty signal 可拆成：

```text
Original Image
→ model token distribution P

Perturbed Image
→ model token distribution Q

KL(P || Q)
+
vision-token entropy
→ visual certainty / instability signal
```

原始碼 `verl/utils/extract_vision_reverse_kl.py` 會先定位 `<vision>...</vision>` token range，再比較 original 與 augmented log-probs；`extract_vision_entropy.py` 對同一 vision token range 計算 entropy。這證明 calibration signal 實際落到 token-level，而不只是 prompt 裡要求模型「說信心」。

### 3. Cross-modal disagreement 需要 arbitration，不應直接 fusion

CMC-Bench 顯示 image/text 衝突時，VLM 常表現為 modality lean。這意味：

```text
Fusion
≠ Arbitration
```

Hermes 應先建立：

```text
Image Claim
Text Claim
Tool Claim
Audio Claim
↓
Conflict Classifier
├ factual
├ temporal
├ entity
├ granularity
└ scope
↓
Authority + Freshness + Provenance + Calibration
↓
Arbitration
```

例如即時 UI screenshot 與昨天文字文件衝突時，不應以 embedding similarity 或 modality prior 決定，而應比較 observation time、source authority、directness 與 calibration。

### 4. Risk bound 的 scope 必須明確

UAI 2026 的工作展示 Learn-Then-Test 可以把 penalized uncertainty score 轉成對 expected False Discovery Rate 有控制的 threshold。對 Hermes 的啟示不是「Agent action 已被證明安全」，而是：**可以對明確定義的 acceptance event 與 calibration distribution 建立 risk-controlled gate。**

因此 DecisionRiskCertificate 必須包含：

```text
DecisionRiskCertificate
├ action
├ target_error_event
├ risk_metric
├ risk_budget
├ calibration_distribution
├ calibration_n
├ modality_slice
├ conflict_slice
├ threshold
├ validity_conditions
├ shift_status
└ guarantee_scope
```

必須避免：

```text
FDR ≤ 2% on calibrated fact-verification acceptance
⇒ action failure probability ≤ 2%   # 錯誤外推
```

### 5. Judge ranking reliability 與 scoring reliability 是不同能力

VLM judge 可以正確排序 A>B，卻無法給出窄且可靠的 absolute score interval。因此 Hermes 的 evaluation API 應區分：

```text
PAIRWISE_RANK
ABSOLUTE_SCORE
PASS_FAIL
RISK_GATE
```

每種 task 有自己的 calibration profile，而不是共用 `judge_confidence`。

## Architecture Breakdown

### Uncertainty-Aware Cross-Modal Decision Runtime

```text
Camera / Image / Video / Audio / Text / Tool / MCP
↓
Modality Encoders / Parsers
↓
Evidence Units
├ TextSpan
├ VisualRegion
├ TemporalInterval
├ AudioSpan
├ ToolResponseField
└ MCPResourceVersion
↓
Alignment Hypothesis Generator
↓
Alignment Uncertainty Estimator
├ perturbation stability
├ entropy
├ temporal mismatch
├ entity mismatch
└ missing-modality uncertainty
↓
Cross-Modal Conflict Graph
↓
Modality-Conditioned Calibration Resolver
↓
Evidence Arbitration Engine
↓
Reasoning / Planning
↓
Decision Risk Gate
├ EXECUTE
├ VERIFY_MORE
├ ABSTAIN
└ ESCALATE
↓
Action
```

## Bottom-Level Logic

### Perturbation-based visual grounding signal

```text
x = image
T(x) = semantics-preserving perturbation

P_t = p(token_t | x, context)
Q_t = p(token_t | T(x), context)

D_t = KL(P_t || Q_t)
H_t = token entropy
```

若語義應保持不變，但 vision-related token distribution 對輕微 perturbation 高度不穩定，這是一個 perception/grounding uncertainty signal。它不是 correctness proof；它只是 evidence sensitivity measurement。

### Cross-modal conflict arbitration

```text
Claim c
↓
Evidence e_img, e_text, e_tool
↓
For each e:
  provenance
  freshness
  directness
  modality calibration
  alignment uncertainty
  authority
↓
Conflict graph
↓
Posterior support / refute / unknown
↓
Decision gate
```

### Risk-controlled acceptance

```text
Calibration examples
↓
uncertainty / disagreement score
↓
Learn-Then-Test threshold selection
↓
threshold τ satisfying target risk criterion
↓
new case score s
↓
if s passes τ and validity conditions hold:
    ACCEPT
else:
    VERIFY / ABSTAIN
```

## Visual Simulation Idea

# Multimodal Alignment Uncertainty Observatory × Decision Risk Gate

中央畫出一個 claim，例如：`目前設備狀態 = SAFE`。

左側來源：

```text
Image region      SUPPORT .82
Text manual       SUPPORT .91
Video interval    REFUTE  .64
Tool field        REFUTE  .98
```

每條 alignment edge 顯示：

```text
alignment confidence
perturbation stability
freshness
source authority
calibration interval
```

使用者可切換：

```text
remove image
blur image
shift video ±2s
replace stale text
hide tool response
```

UI 即時更新：

```text
Perception confidence  .71
Alignment confidence   .58
Reasoning confidence   .89
Cross-modal conflict   HIGH
Expected action risk   .13
Risk budget            .02

→ VERIFY_MORE
```

這可以把「模型不確定」拆成到底是看不清楚、對不齊、來源互相衝突，還是 reasoning 本身不穩。

## Code / GitHub

### Mr-Loevan/VL-Calibration

值得看的目錄 / 檔案：

```text
examples/
scripts/
verl/
  models/
    transformers/qwen2_vl.py
    transformers/qwen3_vl.py
  trainer/
    core_algos.py
    ray_trainer.py
    metrics.py
  utils/
    extract_vision_entropy.py
    extract_vision_reverse_kl.py
```

Repository 基於 veRL / EasyR1；`verl` 內含 Qwen2-VL/Qwen3-VL model integration、trainer、distributed controller 與 vision uncertainty extraction utilities。

最值得下一輪繼續追：`trainer/core_algos.py` 與 `ray_trainer.py`，確認 visual certainty 如何真正進入 advantage/reward weighting，以及 reasoning confidence 的 loss path。

## Papers

### VL-Calibration
- Title: VL-Calibration: Decoupled Confidence Calibration for Large Vision-Language Models Reasoning
- Authors: Wenyi Xiao, Xinchi Xu, Leilei Gan
- Year: 2026
- Venue: ACL 2026 Main
- URL: https://aclanthology.org/2026.acl-long.2074/
- Code: https://github.com/Mr-Loevan/VL-Calibration
- Architecture: decoupled visual/reasoning confidence + RL calibration
- Contribution: 把 multimodal confidence failure source 分解，visual certainty 使用 perturbation KL + token entropy
- Limitation: calibration 仍受 distribution/model/task shift 影響；不能視為 universal correctness probability

### EASE
- Title: Uncertainty-Calibrated Elastic Alignment for Multimodal Sentiment Analysis with Missing Modalities
- Authors: Kang He et al.
- Year: 2026
- Venue: Findings ACL 2026
- URL: https://aclanthology.org/2026.findings-acl.260/
- Architecture: probabilistic imputation + uncertainty-driven elastic alignment + cross-view consistency
- Contribution: 不確定區域降低 rigid alignment pressure
- Limitation: sentiment/missing modality domain，不等於通用 agent evidence alignment

### Controlling Uncertainty and Hallucination Risk in Multi-Agent Fact Verification
- Authors: Adam Kostka, Jarosław A. Chudziak
- Institution: Warsaw University of Technology
- Year: 2026
- Venue: UAI 2026 / PMLR 337
- URL: https://proceedings.mlr.press/v337/kostka26a.html
- Architecture: disagreement-aware score + Learn-Then-Test calibration
- Contribution: 對明確 acceptance error event 建立 expected FDR risk control
- Limitation: fact verification setting；不能直接轉譯成 arbitrary agent action safety guarantee

### VLM Judges Can Rank but Cannot Score
- Year: 2026
- URL: https://arxiv.org/abs/2604.25235
- Architecture: score-token log-probabilities + conformal prediction intervals
- Contribution: 揭露 task-dependent multimodal judge uncertainty 與 ranking-scoring decoupling
- Limitation: judge score calibration 不等於 agent trajectory/action calibration

## 已確認 / 推論 / 尚未驗證

**已確認（論文/官方原始碼）：** VL-Calibration 拆 visual/reasoning confidence；vision perturbation KL 與 entropy 有實際 utility code；EASE 用 uncertainty 控制 elastic alignment；UAI 2026 工作用 Learn-Then-Test 控制 expected FDR；CMC-Bench 顯示跨模態 conflict 造成顯著 performance degradation。

**工程推論：** Hermes 應將 AlignmentHypothesis、CrossModalConflictGraph、ModalityCalibrationProfile 與 DecisionRiskCertificate 做成 first-class runtime artifacts。

**尚未驗證假說：** 把 perturbation-based visual certainty、source provenance、cross-modal conflict 與 conformal/LTT risk calibration組成同一個 production decision gate，是否能在 browser/computer/MCP agent 上穩定降低 action failure，目前缺直接 benchmark。

## Unknown / Open Questions

1. 如何校準 `alignment_confidence`？目前多數工作校準 model output 或 modality uncertainty，alignment edge 本身仍缺通用 gold label 與 benchmark。
2. 如何處理來源權威與 modality reliability 的交互作用？高權威來源也可能 stale；即時感測器也可能 noisy。
3. 如何從「fact acceptance FDR」提升到「sequential agent action risk」而不做錯誤的統計外推？

## 下一輪研究

**主題：Decision-Level Risk Bound × Sequential Action Safety × Selective Execution × Runtime Escalation**

優先拆：

```text
calibrated evidence risk
→ action loss model
→ selective prediction / abstention
→ safe execution threshold
→ distribution-shift detector
→ runtime escalation
→ post-action feedback
→ risk calibration memory
```

並研究 conformal risk control、Learn-Then-Test、selective classification、risk-controlling prediction sets 如何與 Agent Runtime 的 irreversible tool action、MCP permission、browser/computer execution 結合。

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
AlignmentHypothesis
AlignmentUncertainty
AlignmentCalibrationProfile
PerturbationStability
VisualCertainty
ReasoningCertainty
MultimodalConfidenceVector
CrossModalConflict
CrossModalConflictGraph
ModalityLean
EvidenceArbitrationEngine
ModalityConditionedCalibration
RiskControlledDecisionGate
GuaranteeScope
TargetErrorEvent
CalibrationValidityCondition
RankingScoringDecoupling
```

### Edges

```text
CrossModalAlignment
→ Has Uncertainty

High Similarity
≠ Reliable Alignment

Perception Confidence
≠ Reasoning Confidence

Fusion
≠ Conflict Arbitration

CrossModal Conflict
→ Requires Evidence Arbitration

Ranking Reliability
≠ Absolute Score Reliability

Calibration Risk Bound
→ Applies Only Within Guarantee Scope

Fact Acceptance FDR Bound
≠ Agent Action Failure Bound

Perturbation Instability
→ Signals Possible Visual Grounding Uncertainty
```

## 本輪結束診斷

- **缺哪一層：** Decision-Level / Sequential Action Risk Calibration。
- **哪個節點最淺：** AlignmentCalibrationProfile、EvidenceArbitrationEngine、GuaranteeScope。
- **哪個概念仍只是名詞：** production 級跨 text/image/video/audio/tool 的 `Alignment Risk Certificate`。
- **哪個系統值得讀原始碼：** VL-Calibration，下一步追 `trainer/core_algos.py`、`ray_trainer.py` 與 reward/advantage path。
- **哪篇論文需追引用：** VL-Calibration、EASE、UAI 2026 risk-control paper、CMC-Bench。
- **哪個概念最適合視覺模擬：** Multimodal Alignment Uncertainty Observatory × Decision Risk Gate。
- **哪個 Agent 架構最值得實作：** `Evidence Units → Alignment Uncertainty → Conflict Graph → Modality Calibration → Evidence Arbitration → Risk-Controlled Execute/Verify/Abstain/Escalate`。

## 對「AI 到底怎麼運作」新增的答案

多模態 AI 並不是把 Camera/Image/Voice/Video 全部 encode 成 token 後就完成融合。真正可靠的系統還必須回答：某段文字究竟對應哪個 image region / video interval？這個 alignment 有多不確定？錯誤來自 perception 還是 reasoning？當圖片與文字互相矛盾時，哪個來源更新、更直接、更可信？最後，confidence 不能只是 UI 上的一個百分比，而必須進入具有明確 error event、calibration distribution、risk budget 與 validity scope 的 decision gate。只有這樣，`Encoder → Tokens → Fusion → Reasoning → Agent → Action` 才從「能產生答案」提升成「知道何時不能直接行動」的可驗證 runtime。