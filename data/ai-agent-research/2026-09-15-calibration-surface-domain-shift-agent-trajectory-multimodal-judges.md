# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 10:55（Asia/Taipei）**  
**主題：Calibration Surface × Domain Shift × Agent-Trajectory Judge × Multimodal Judge Reliability**

## 與歷史研究比較

前一輪已建立 Active Calibration、Calibration Drift、Gold Anchor 與 Verification Budget。本輪不再重複「Judge 是否漂移」，而是回答更底層的問題：**即使同一個 Judge 沒有版本漂移，它的可靠度是否會隨 evidence topology、agent trajectory difficulty、modality、task category、generator capability 改變？**答案是會。因此單一 `judge_accuracy` 或單一 confusion matrix 不足，Hermes 應維護條件化的 **Calibration Surface**。

---

## 本小時新發現

### 新論文 / benchmark

1. **AgentJudgeBench: A Multi-Difficulty Benchmark for Evaluating LLM Judges on Agentic Tool-Calling** — Abhigya Verma, Amit Kumar Saha, Seganrasan Subramanian, Sai Harshitha Aluru, 2026. URL: https://arxiv.org/abs/2608.26623  
   - 3,808 instances，六種 workflow DAG topology、三種 difficulty。
   - 五個 generators、六個 judges，比較有 / 無 ground truth。
   - Judge alignment 隨 difficulty 單調下降；無 ground truth 時下降約快 1.5×；hard queries 下六個 judges 聚集於 77–82% band，顯示 capacity scaling 無法消除 structural ceiling。
   - structured rubric 最多改善 6.5 pp，但不 uniformly generalize。

2. **trajectory-judge: What Outcome-Only LLM Judges Miss on Agent Trajectories** — Hadi Mohammadi, 2026. URL: https://github.com/mohammadi-hadi/trajectory-judge  
   - deterministic tool environment + scripted oracle policy + six-type fault injector。
   - 400 trajectories；outcome-only judge 對 loud faults recall 84%，對 silent faults 45%，且對 clean trajectories 有 33% false alarms；step-rubric 對 silent faults recall 77%、zero false alarms，但成本約 3×。
   - 核心改變：evaluation target 必須從 final outcome 擴張為 trajectory evidence topology。

3. **VLM Judges Can Rank but Cannot Score: Task-Dependent Uncertainty in Multimodal Evaluation** — Divake Kumar, Sina Tayebati, Devashri Naik, Ranganath Krishnan, Amit Ranjan Trivedi, 2026. URL: https://arxiv.org/abs/2604.25235  
   - 3 VLM judges、14 visual task categories。
   - 使用 conformal prediction 將 point score 轉成 calibrated interval。
   - aesthetics / natural image 的 interval 約覆蓋 score range 40%，chart / mathematical reasoning 約 70%。
   - 發現 ranking–scoring decoupling：能可靠排序，不代表能給可靠 absolute score。

4. **MM-JudgeBias: A Benchmark for Evaluating Compositional Biases in MLLM-as-a-Judge** — Sua Lee, Sanghee Park, Jinbae Im, 2026. URL: https://arxiv.org/abs/2604.18164  
   - 1,800+ samples、29 source benchmarks、26 MLLMs、九種 compositional bias。
   - 對 Query / Image / Response 做 controlled perturbation，揭露 modality neglect 與 asymmetric evaluation。

5. **Calibrating LLM Judges: Linear Probes for Fast and Reliable Uncertainty Estimation** — ACL 2026 Industry. URL: https://aclanthology.org/2026.acl-industry.14/  
   - 從 reasoning judge hidden states 訓練 Brier-loss linear probes；提供低額外 compute 的 calibrated uncertainty。
   - 對 unseen evaluation domains 有一定 generalization，但估計較 conservative；顯示 calibration mechanism 本身也有 domain-dependent tradeoff。

---

## 本小時最重要 5 個發現

### 1. Judge reliability 是 surface，不是一個 scalar

**已確認事實 / 論文結果：** AgentJudgeBench 與 VLM judge 研究都顯示 reliability 會隨 task difficulty / modality category 改變。

因此：

```text
JudgeAccuracy
≠ Stable Judge Property

JudgeReliability
= f(
  domain,
  modality,
  workflow_topology,
  difficulty,
  generator,
  evidence_visibility,
  rubric,
  risk_slice
)
```

Hermes 應建立：

```text
CalibrationSurface[domain][modality][difficulty][evidence_mode][generator]
→ confusion matrix
→ calibration error
→ uncertainty interval
→ sample count
→ validity
```

### 2. Final-answer correctness 與 process correctness 是不同 latent variables

trajectory-judge 的 controlled fault injection 顯示「最後答案看起來正確」可能遮蔽 skipped precondition、wrong tool、ignored observation 等 silent process faults。

底層：

```text
Goal
↓
Agent State
↓
Tool Call
↓
Observation
↓
Next Decision
↓
...
↓
Final Answer
```

Outcome-only judge 只看到：

```text
Goal → Final Answer
```

Step judge 則看到：

```text
Goal
→ Intent
→ Tool Schema
→ Tool Selection
→ Arguments
→ Execution
→ Observation
→ Context Update
→ Next Decision
→ Final Answer
```

因此新增：

```text
OutcomeCorrectness
≠ TrajectoryCorrectness
```

### 3. Ground truth exposure 不是單調改善 Judge

AgentJudgeBench 報告部分 frontier judges 在提供 ground truth 後 alignment 反而下降，與 over-anchoring 一致。因此：

```text
More Reference Evidence
≠ Better Judgment
```

合理推論：Hermes 的 Oracle Router 不能只做 `ground_truth_available ? inject : omit`，而應測量 **Evidence Intervention Effect**：同一 case 在不同 evidence package 下 verdict 是否產生非預期偏移。

### 4. Multimodal calibration 必須 condition on task category 與 modality integrity

VLM judge 的 conformal interval 在不同視覺任務差異很大；MM-JudgeBias 又顯示 Query/Image/Response 的 compositional perturbation 可造成 modality neglect。

因此：

```text
Image Present
≠ Image Used

High Ranking Correlation
≠ Reliable Absolute Score
```

Hermes 應記錄：

```text
ModalityEvidenceProfile
├ image_required
├ image_used_probe
├ text_only_counterfactual
├ image_only_counterfactual
├ modality_ablation_delta
└ calibrated_score_interval
```

### 5. Calibration 必須對 trajectory slice，而不是只對 task label

AgentJudgeBench 的 DAG topology 與 trajectory-judge 的 silent/loud fault 分層共同指出：同一「tool-use」domain 內仍有不同 evidence geometry。

建議 Calibration key：

```text
(domain,
 modality,
 topology,
 trajectory_length,
 dependency_depth,
 fault_family,
 outcome_survival,
 evidence_visibility,
 generator_family)
```

這比單純 `domain=tool-use` 更接近 production reliability。

---

## Architecture Breakdown

```text
Candidate Agent Run
↓
Evaluation Context Builder
├ final answer
├ full trajectory
├ tool schemas
├ observations
├ reference / ground truth
└ multimodal evidence
↓
Slice Classifier
├ domain
├ modality
├ DAG topology
├ dependency depth
├ difficulty
├ generator family
├ silent/loud risk
└ evidence mode
↓
Calibration Surface Resolver
↓
Judge / Oracle Router
↓
Raw Verdict + Confidence
↓
Conditional Calibrator
├ confusion matrix
├ conformal interval
├ calibration head/probe
└ historical anchor residual
↓
Counterfactual Evidence Tests
├ remove image
├ remove trajectory
├ remove ground truth
├ reorder irrelevant evidence
└ swap equivalent representation
↓
Evidence Sensitivity Graph
↓
Calibrated Evaluation Result
├ P(correct verdict)
├ score interval
├ process-fault probability
├ outcome-fault probability
├ evidence sufficiency
└ escalation recommendation
```

---

## Bottom-Level Logic

### Conditional calibration

對 slice `z`：

```text
z = (domain, modality, difficulty, topology, evidence_mode, generator)
```

維護：

```text
P(Y=true | J=j, z)
```

而不是全域：

```text
P(Y=true | J=j)
```

若 slice 樣本不足，應 hierarchical backoff：

```text
exact slice
↓ insufficient N
parent slice
↓
domain × modality
↓
global prior
```

但必須增加 uncertainty，不能假裝 fallback 與 exact calibration 等價。

### Multimodal conformal interval

概念上：

```text
Judge score s(x)
↓
Calibration residuals on matched slice
↓
Conformal quantile q_(1-α)
↓
Prediction interval
[s-q, s+q]
```

關鍵不是 interval 本身，而是 calibration set 必須與 task/modality slice 足夠 exchangeable；domain shift 時 coverage guarantee 不能直接照搬。

### Trajectory evidence intervention

```text
V_full = Judge(goal, trajectory, answer)
V_outcome = Judge(goal, answer)
V_no_obs = Judge(goal, tool_calls, answer)
V_no_ref = Judge(goal, trajectory, answer, no_reference)
```

建立：

```text
EvidenceSensitivity = Δ verdict / Δ evidence
```

若 critical evidence 被拿掉但 verdict 完全不變，可能是 evidence neglect；若加入 ground truth 後反而過度翻轉，可能是 anchoring。

---

## Code / GitHub 深讀

### mohammadi-hadi/trajectory-judge

值得看的結構：

```text
src/trajectory_judge/
├ agents/
├ env/
├ judges/
│  ├ llm.py
│  ├ programmatic.py
│  └ self_consistency.py
├ metrics.py
├ mutate.py
├ report.py
├ trace.py
analysis/
bench/
data/
tests/
```

`mutate.py` 的工程設計非常值得 Hermes 借鑑：

1. mutation 先修改 call list，再對 fresh world **重新 replay**，不手寫 observation；
2. 每個 mutation 只 targeting 一個 failure family，避免 injector 本身引入 confounder；
3. outcome preservation 是 replay 後重新計算，不是假設；
4. fault applicability explicit。

六類 mutation：

```text
wrong_tool
hallucinated_argument
skipped_precondition
ignored_observation
premature_stop
unsupported_claim
```

`judges/llm.py` 則把 outcome-only 與 step-rubric 的 model、temperature、seed、schema effort 等盡量固定，主要 intervention 是 evidence visibility。OutcomeJudge 不看 steps；StepRubricJudge 看完整 trajectory，且 schema 允許 failure_step localization。

這是一個很乾淨的 **Evidence Topology Experiment**，值得直接轉成 Hermes regression framework。

---

## Papers

### AgentJudgeBench
- Authors: Abhigya Verma et al.
- Year: 2026
- URL: https://arxiv.org/abs/2608.26623
- Dataset: 3,808 agentic tool-calling instances
- Architecture: workflow-DAG based evaluation benchmark
- Contribution: difficulty / topology / ground-truth-conditioned judge reliability
- Limitation: benchmark workflow distributions不等於所有 production agent traces；structured rubric gains 不 uniform。
- 改變了什麼：把「Judge 能不能評 Agent」從 generic scoring 問題變成 workflow complexity-conditioned reliability 問題。

### trajectory-judge
- Author: Hadi Mohammadi
- Year: 2026
- URL: https://github.com/mohammadi-hadi/trajectory-judge
- Code: public repository
- Dataset: 400 controlled trajectories in reported experiment
- Architecture: deterministic environment + oracle policy + fault injection + multiple judge families
- Contribution: silent vs loud trajectory faults、step localization、fault typing、calibration/cost comparison
- Limitation: synthetic support-desk domain；fault taxonomy 有限。
- 改變了什麼：證明 final-outcome evaluation 對 silent process faults 結構性失明。

### VLM Judges Can Rank but Cannot Score
- Authors: Divake Kumar et al.
- Year: 2026
- URL: https://arxiv.org/abs/2604.25235
- Dataset: 14 visual task categories
- Architecture: VLM judge + conformal calibration
- Contribution: task-dependent uncertainty map；ranking-scoring decoupling
- Limitation: conformal validity依賴 calibration/test exchangeability；production domain shift 需額外處理。
- 改變了什麼：把 multimodal judge reliability 從單一 correlation 轉為 task-conditioned interval reliability。

### MM-JudgeBias
- Authors: Sua Lee, Sanghee Park, Jinbae Im
- Year: 2026
- URL: https://arxiv.org/abs/2604.18164
- Dataset: 1,800+ samples from 29 benchmarks
- Architecture: controlled Query/Image/Response perturbation
- Contribution: compositional bias、modality neglect diagnostics
- Limitation: controlled perturbation coverage 仍不代表 open-world multimodal trajectories。

---

## Visual Simulation Idea

# Calibration Surface Observatory × Trajectory Evidence Lab

左側是完整 Agent trace：

```text
Goal
↓
Tool A
↓ Observation A
↓
Tool B
↓ Observation B
↓
Final Answer
```

右側是一個可互動 calibration cube：

```text
X = difficulty
Y = modality
Z = evidence visibility
color = calibrated judge error
```

使用者可以切換：

```text
Outcome Only
Full Trajectory
No Observation
No Image
No Ground Truth
Full Evidence
```

即時看到：

```text
Raw verdict             PASS
Calibrated P(correct)   .61
Silent-fault recall     .44
Score interval          [5.2, 8.7]
Modality-ablation Δ     .02  ⚠ image neglect
Trajectory-ablation Δ   .31
Ground-truth Δ          .28  ⚠ anchoring risk
```

再點一個 cell，例如：

```text
Tool-use × Hard × Outcome-only
```

展開該 slice 的 confusion matrix、anchor N、ECE/Brier、false-pass rate、last calibration、generator family distribution。

---

## Unknown / Open Questions

1. **Calibration surface 如何在稀疏 slices 下估計？** exact conditioning 會造成 data fragmentation；需要 hierarchical Bayesian / shrinkage / representation-based calibration。
2. **Trajectory Judge 的 evidence sufficiency 如何自動決定？** 全 trajectory 很貴，但 outcome-only 太盲；需要 active evidence acquisition：先 outcome，再只在高-risk / uncertain case 展開 critical steps。
3. **Multimodal + tool trajectory 的 joint calibration 怎麼做？** image uncertainty、tool observation reliability、judge uncertainty 目前多半分開研究，缺少 unified conditional model。

---

## 下一輪研究

**Active Evidence Acquisition for Agent Evaluation × Critical-Step Selection × Evaluation Context Compression**

核心問題：

```text
Outcome-only 太少
Full trajectory 太貴
↓
Judge 到底應該看哪些 steps / observations / images？
```

下一輪優先研究：

```text
critical-step retrieval
trajectory segmentation
causal evidence selection
judge context compression
active evaluation
verification VoI
process reward models
step-level verifiers
long-trajectory judge failure
```

目標建立：

```text
EvaluationEvidencePlanner
CriticalStepSelector
TrajectoryEvidenceGraph
EvaluationContextBudget
JudgeEvidenceVoI
ProcessOutcomeDualVerifier
EvidenceCoverageCertificate
```

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
CalibrationSurface
ConditionalJudgeReliability
EvidenceTopology
EvidenceVisibilityMode
TrajectoryCorrectness
OutcomeCorrectness
SilentProcessFault
LoudOutcomeFault
WorkflowDAGDifficulty
GeneratorConditionedCalibration
ModalityConditionedCalibration
RankingScoringDecoupling
MultimodalConformalInterval
ModalityEvidenceProfile
EvidenceInterventionTest
EvidenceSensitivityGraph
GroundTruthAnchoringRisk
TrajectoryFaultInjector
CalibrationSliceBackoff
```

### Edges

```text
Judge Reliability
→ Depends On Domain / Modality / Difficulty / Evidence Topology

Outcome Correctness
≠ Trajectory Correctness

Final Answer Evidence
⊂ Full Trajectory Evidence

Silent Process Fault
→ Can Survive Correct Outcome

More Ground Truth Evidence
≠ Monotonic Judge Improvement

Image Present
≠ Image Used By Judge

High Ranking Correlation
≠ Reliable Absolute Score

Workflow Difficulty
→ Increases Judge Error

Evidence Ablation
→ Reveals Evidence Dependence / Neglect

Matched Calibration Slice
→ Improves Reliability Interpretation
```

---

## 本輪結束判定

- **缺哪一層：** Evaluation Evidence Planning / Critical-Step Selection Layer。
- **哪個節點最淺：** `CalibrationSliceBackoff`、`GroundTruthAnchoringRisk`、`JointMultimodalTrajectoryCalibration`。
- **哪個概念仍只是名詞：** production 級 `CalibrationTransportability`，尤其跨 generator × modality × trajectory topology。
- **哪個系統值得讀原始碼：** `mohammadi-hadi/trajectory-judge`，下一步優先 `metrics.py`、`programmatic.py`、`self_consistency.py`、`analysis/bootstrap_ci.py`。
- **哪篇論文需追引用：** AgentJudgeBench，其次 VLM Judges Can Rank but Cannot Score。
- **哪個概念最適合視覺模擬：** Calibration Surface Observatory × Trajectory Evidence Lab。
- **哪個 Agent 架構最值得實作：** `EvaluationEvidencePlanner → Conditional Calibration Surface → Dual Process/Outcome Verifier → Active Reality/Human Escalation`。

## 對「AI 到底怎麼運作」新增的核心答案

可靠 AI 不只需要一個 Judge，也不只需要知道 Judge 平均有多準。當 Agent 的行為變成長 trajectory、多工具、多模態、依賴 DAG 時，**評估器能看到什麼證據，本身就是系統架構的一部分**。只看 final answer 會漏掉「結果對、過程錯」；看完整 trajectory 又增加 token、成本與長上下文失真。下一步因此不是單純換更大的 Judge，而是讓 evaluation runtime 像 Agent 本身一樣主動規劃：先判斷目前 evidence 是否足夠，再選擇最有價值的 steps、observations、images 與 ground-truth evidence，最後用對應 slice 的 calibration surface 解讀 Judge verdict。