# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 00:54（Asia/Taipei）**  
**主題：Visual Evidence Sufficiency × Value of Information × Selective Prediction × Risk-Aware Active Perception**

---

## 0. 與歷史研究的差異

上一輪已建立：

```text
Physical Evidence
→ Visual Patches
→ Encoder Features
→ Compression / Pruning / Merge
→ VisualTokenSurvivalGraph
→ Surviving Visual Tokens
→ LLM
```

並指出：

```text
Token Retention Rate
≠ Evidence Retention Rate
≠ Task-Sufficient Information
```

本輪不再重複 token pruning / token survival，而是往下一層追：

```text
目前已看到的 evidence
↓
到底夠不夠回答？
↓
如果不夠，下一次觀察的預期資訊價值是多少？
↓
追加 crop / zoom / high-res / frames 是否值得成本？
↓
如果成本不值得，應該回答還是 abstain？
```

本輪核心新命題：

```text
Uncertainty
≠ Evidence Insufficiency

Evidence Insufficiency
≠ Automatically Acquire More

Acquire More
≠ Always Better

Confidence
≠ Visual Evidence Quality
```

---

# 1. 本小時新發現

## 新論文 / benchmark

1. **SIEVES: Selective Prediction Generalizes through Visual Evidence Scoring** — Hector G. Rodriguez, Marcus Rohrbach, 2026.  
   arXiv: https://arxiv.org/abs/2604.25855  
   GitHub: https://github.com/hector-gr/SIEVES

2. **An Exam for Active Observers / ActiveVision** — Jiarui Zhang, Muzi Tao, Shangshang Wang, Ollie Liu, Xuezhe Ma, Willie Neiswanger, USC, 2026.  
   arXiv: https://arxiv.org/abs/2607.16165  
   GitHub: https://github.com/saccharomycetes/ActiveVision

3. **Starve to Perceive: Taming Lazy Perception in VLMs with Constrained Visual Bandwidth** — Yuhuan Wu, Cong Wei, Fangzhen Lin, Wenhu Chen, Haozhe Wang, 2026.  
   arXiv: https://arxiv.org/abs/2605.18603

4. **AdaptVision: Efficient Vision-Language Models via Adaptive Visual Acquisition** — Zichuan Lin, Yicheng Liu, Yang Yang, Lvfang Tao, Deheng Ye, Tencent Hunyuan, CVPR 2026 Highlight.  
   Project: https://adaptvision.github.io/  
   GitHub: https://github.com/AdaptVision/AdaptVision

5. **Selective “Selective Prediction”: Reducing Unnecessary Abstention in Vision-Language Reasoning (ReCoVERR)** — Tejas Srinivasan et al., Findings of ACL 2024.  
   Paper: https://aclanthology.org/2024.findings-acl.767/  
   Code: https://github.com/tejas1995/ReCoVERR

## 新架構

本輪建立：

```text
Risk-Aware Active Perception Runtime
```

而不是只有：

```text
Visual Tool Calling Runtime
```

---

# 2. 本小時最重要 5 個發現

## 發現 1 — Selective prediction 應從「answer confidence」升級成「evidence quality」

### 已確認事實

SIEVES 的核心不是直接使用 reasoner 的 logit confidence，而是要求模型提供 **localized visual evidence**，再由 selector 評估 localization quality / evidence coherence，決定接受或拒絕回答。

論文在 V* Bench、HR-Bench-8k、MME-RealWorld-Lite、VizWiz、AdVQA 等 OOD benchmarks 報告，相較非 grounding selector，可將 coverage 提高最多約 3 倍；而且 selector 可套用在無法取得內部 logits 的 proprietary reasoners。

### 底層拆解

普通 selective prediction：

```text
Image + Question
↓
Reasoner
↓
Answer
↓
Confidence Score
↓
score > τ ?
├ YES → Answer
└ NO  → Abstain
```

Evidence-aware selective prediction：

```text
Image + Question
↓
Reasoner
├ Answer
└ Localized Evidence
      ↓
Evidence Selector
├ localization quality
├ evidence-answer coherence
├ image clarity / support
└ OOD-robust features
      ↓
Risk Score
      ↓
Accept / Abstain
```

### 為什麼重要

對 Hermes：

```text
Model says “I am 93% confident”
```

不應被視為：

```text
Visual evidence is sufficient
```

新增 Knowledge Graph edge：

```text
Answer Confidence
≠ Evidence Sufficiency
```

### 限制

SIEVES 主要回答「accept / abstain」，本身不等同「接下來應該看哪裡」。因此還需要 acquisition policy。

---

## 發現 2 — Active perception 目前仍是 frontier MLLM 的明顯能力缺口

### 已確認事實

ActiveVision 2026 將「active observation」獨立成 benchmark，共 17 tasks / 3 categories，要求模型反覆觀察、掃描、追蹤與比較，而不是一次看完圖片後文字推理。

論文報告最高模型只有 10.6% accuracy，3 位 human participants 平均 96.1%；即使允許 agent 自己寫 vision code，能力缺口仍然很大。官方 GitHub 的 agent track 顯示最強 tool-using coding agent 約 50.6%。

### 底層意義

這表示：

```text
Strong Reasoning Model
+
Vision Tool Access

≠
Strong Active Perception
```

真正 active observer 需要：

```text
Hypothesis_t
↓
Observation Need_t
↓
Action_t = where/how to look
↓
Observation_(t+1)
↓
Belief Update
↓
New Hypothesis
↓
repeat
```

而不是：

```text
See once
↓
Think longer
```

### 新 edge

```text
More Reasoning Compute
≠ Better Active Observation
```

---

## 發現 3 — Tool call 存在不代表模型真的依賴 tool observation

### 已確認事實

Starve to Perceive 將一個重要 failure mode 命名為 **lazy perception**：模型會生成 zoom / crop 等主動視覺動作，但最終答案實際上仍主要依賴 coarse global view 與 language prior。

其訓練思路是限制每一次 observation 的 visual bandwidth，使單次 observation 不足以完成任務，迫使 agent 真正透過多步視覺搜索才能得到 reward。

### 底層拆解

表面上的 active perception：

```text
Global Image
↓
<tool_call crop>
↓
Crop Observation
↓
Answer
```

不代表 causal dependence：

```text
Answer(original)
vs
Answer(tool observation masked/replaced)
```

如果幾乎不變：

```text
Tool Call Performed
≠ Tool Evidence Used
```

因此 Hermes 應新增：

```text
PerceptionActionDependencyTest
```

```text
Recorded Run
↓
replace / mask acquired observation
↓
replay descendants
↓
measure claim/action delta
↓
functional dependence score
```

這能直接接回前幾輪建立的 counterfactual replay runtime。

---

## 發現 4 — AdaptVision 已把「是否再看」實作成正式 multi-turn visual tool policy

### 官方 / 原始碼確認

AdaptVision 的 runtime 不只是 image resize preprocessing，而是正式定義 visual tools：

```text
request_high_res_image
request_local_region(bbox_2d)
```

`verl/workers/rollout/vllm_rollout/function_tools.py` 會解析 tool call、驗證 bbox、crop 原始影像，並使用 `smart_resize` 建立新的 observation。

其訓練 script 明確使用：

```text
algorithm.adv_estimator=dtpo
```

`core_algos.py` 中存在 `compute_DTPO_advantage()`，並以 turn-level rewards 與 outcome-level rewards 分離 credit assignment。

### Architecture

```text
Low-resolution Global Observation
↓
Reasoning Turn 1
↓
Policy Decision
├ ANSWER
├ request_high_res_image
└ request_local_region(bbox)
      ↓
High-resolution Observation
      ↓
Reasoning Turn 2
      ↓
Final Answer
```

AdaptVision project page 把 objective 分成：

```text
Outcome Reward
├ accuracy
├ format
└ balance

Tool Reward
├ crop quality
└ area penalty
```

### 本輪新推論

這其實已非常接近：

```text
Expected Utility of Observation
```

但其 policy objective 仍是透過 learned reward 間接學出，不是 runtime 明確計算：

```text
expected information gain
-
visual-token cost
-
latency cost
-
risk cost
```

因此 Hermes 下一步可以把這層顯式化。

---

## 發現 5 — 最合理的 runtime decision unit 是 Value of Information（VoI），而不是「uncertain → zoom」

### 合理推論 + decision theory 建模

對每個 perception action `a`：

```text
crop(region)
zoom(region)
request_high_res
request_more_frames
change_viewpoint
run_OCR
run_detector
```

Agent 應估計：

```text
VoI(a)
≈
Expected Risk Before Observation
-
Expected Risk After Observation a
```

再扣除成本：

```text
NetValue(a)
=
VoI(a)
- λ_token C_token(a)
- λ_latency C_latency(a)
- λ_gpu C_gpu(a)
- λ_privacy C_privacy(a)
- λ_action C_action(a)
```

Runtime：

```text
max_a NetValue(a) > AcquisitionThreshold
?
├ YES → acquire best observation
└ NO
   ↓
   current risk < answer threshold ?
   ├ YES → answer
   └ NO  → abstain / ask user / escalate
```

這比：

```text
confidence low → zoom
```

更適合作為 production agent runtime。

---

# 3. Architecture Breakdown

本輪建立新的：

```text
Risk-Aware Active Perception Runtime
```

完整架構：

```text
User Question / Agent Goal
↓
Initial Observation
├ low-res image
├ sampled video frames
├ camera view
└ existing multimodal memory
↓
Evidence Inventory
↓
Evidence Sufficiency Estimator
├ answer uncertainty
├ visual grounding quality
├ evidence consistency
├ missing evidence categories
├ OOD score
└ task risk
↓
Candidate Perception Actions
├ ANSWER_NOW
├ ABSTAIN
├ REQUEST_HIGH_RES
├ CROP_REGION
├ ZOOM
├ REQUEST_MORE_FRAMES
├ CHANGE_VIEWPOINT
├ RUN_OCR
└ RUN_SPECIALIST_MODEL
↓
Expected Value-of-Information Estimator
↓
Cost / Risk Model
├ token cost
├ latency
├ GPU/VRAM
├ API cost
├ privacy exposure
└ physical-action risk
↓
Perception Policy
↓
New Observation
↓
VisualTokenSurvivalGraph
↓
Evidence Update
↓
Belief / Claim Update
↓
repeat until stopping condition
↓
Answer / Abstain / Human Escalation / Agent Action
```

---

# 4. Bottom-Level Logic

## 4.1 Selective risk

令：

```text
ŷ = candidate answer
r(x, ŷ) = estimated probability / cost of error
```

Selective prediction：

```text
Answer if r < τ_risk
Else abstain
```

但 active perception 加入：

```text
Observation action a
→ random future observation O_a
→ updated state b'
→ new risk r'
```

---

## 4.2 Expected information value

理想化：

```text
VoI(a)
=
R_current
-
E_o~P(O|a)[R_after(o)]
```

也可以看 entropy reduction：

```text
IG(a)
=
H(Y | E)
-
E_o[H(Y | E, O_a=o)]
```

但：

```text
Entropy Reduction
≠ Task Utility Improvement
```

因為有些 observation 雖然降低 uncertainty，但不會改變最終 action。

因此 production agent 應更偏：

```text
Expected Decision Value
```

而不是只有 entropy。

---

## 4.3 Risk-weighted acquisition

對低風險任務：

```text
「這張照片大概是什麼？」
```

可能：

```text
small uncertainty
→ answer directly
```

但對高風險：

```text
「前方交通號誌現在是否允許通行？」
```

相同 uncertainty 應導致：

```text
request high-res / more frames / alternate viewpoint
```

所以：

```text
Same Uncertainty
≠ Same Perception Action
```

新增：

```text
TaskRiskProfile
```

---

## 4.4 Stopping rule

Active perception 必須有停止條件，否則會無限觀察：

```text
STOP if
1. current evidence risk < answer threshold
OR
2. max expected NetValue(additional observation) <= 0
OR
3. budget exhausted
OR
4. safety / privacy gate blocks observation
OR
5. maximum observation horizon reached
```

注意：

```text
Budget Exhausted
≠ Evidence Sufficient
```

此時應：

```text
ABSTAIN / ESCALATE
```

而不是 forced answer。

---

# 5. System Architecture Deep Dive — AdaptVision

## GitHub

https://github.com/AdaptVision/AdaptVision

## 值得看的 directories / files

```text
AdaptVision/
├ cookbooks/
│  └ adaptvision.ipynb
├ scripts/
│  ├ run_adaptvision.sh
│  └ vllm_adaptvision.py
├ verl/
│  ├ trainer/
│  │  ├ constants.py
│  │  └ ppo/
│  │     ├ core_algos.py
│  │     ├ ray_trainer.py
│  │     └ ray_trainer_bbox.py
│  ├ utils/reward_score/
│  │  └ gpt_judge_score.py
│  └ workers/rollout/vllm_rollout/
│     └ function_tools.py
└ patches/
```

## Runtime tool abstraction

原始碼中：

```text
prepare_multi_tool_call_inputs()
```

限制工具型別：

```text
request_high_res_image
request_local_region
```

而 `request_local_region` 需要：

```text
bbox_2d=[x0,y0,x1,y1]
```

流程：

```text
LLM emits <tool_call>
↓
parse JSON
↓
validate bbox
↓
scale coordinates
↓
clamp image bounds
↓
check geometry
↓
crop
↓
smart_resize
↓
new visual observation
↓
next reasoning turn
```

這非常適合直接映射成 Hermes 的：

```text
PerceptionAction
→ ObservationEvent
→ EvidenceUpdate
```

---

# 6. Papers

## 6.1 SIEVES

**Title**: SIEVES: Selective Prediction Generalizes through Visual Evidence Scoring  
**Authors**: Hector G. Rodriguez, Marcus Rohrbach  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2604.25855  
**Code**: https://github.com/hector-gr/SIEVES  
**Datasets / Benchmarks**: V* Bench, HR-Bench-8k, MME-RealWorld-Lite, VizWiz, AdVQA  
**Architecture**: Reasoner produces answer + localized evidence; selector scores evidence quality for accept / reject.  
**Contribution**: OOD selective prediction through grounded visual evidence quality.  
**Limitations**: primarily acceptance / rejection, not a full sequential perception acquisition policy.

### 改變了什麼

```text
confidence-based abstention
↓
evidence-grounded selective decision
```

---

## 6.2 An Exam for Active Observers / ActiveVision

**Authors**: Jiarui Zhang, Muzi Tao, Shangshang Wang, Ollie Liu, Xuezhe Ma, Willie Neiswanger  
**Institution**: University of Southern California  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2607.16165  
**Code/Benchmark**: https://github.com/saccharomycetes/ActiveVision  
**Dataset**: 17 active-observation tasks across 3 categories  
**Contribution**: isolates iterative visual observation capability from ordinary static VQA / language reasoning.  
**Limitation**: benchmark exposes failure but does not itself supply a complete production perception-policy architecture.

### 改變了什麼

證明：

```text
MLLM reasoning strength
≠ active observation strength
```

---

## 6.3 Starve to Perceive

**Authors**: Yuhuan Wu, Cong Wei, Fangzhen Lin, Wenhu Chen, Haozhe Wang  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2605.18603  
**Architecture**: bandwidth-constrained multi-turn tool-augmented VLM training.  
**Contribution**: constrains each visual observation so active multi-step acquisition becomes functionally necessary rather than decorative.  
**Reported result**: roughly 5% average relative improvement across evaluated benchmarks.  
**Limitations**: budget schedule and domains may affect generalization; tool-use dependence still needs explicit causal tests if used in a provenance system.

---

## 6.4 AdaptVision

**Authors**: Zichuan Lin, Yicheng Liu, Yang Yang, Lvfang Tao, Deheng Ye  
**Institution**: Tencent Hunyuan  
**Venue**: CVPR 2026 Highlight  
**URL**: https://adaptvision.github.io/  
**Code**: https://github.com/AdaptVision/AdaptVision  
**Architecture**: low-resolution initial observation + optional local high-resolution visual tool use + DTPO reinforcement learning.  
**Contribution**: adaptive visual token acquisition instead of fixed-ratio compression.  
**Reported project result**: around 97.9% vanilla-model performance using ~33% visual tokens and 1.67× inference speedup.  
**Limitations**: bounding-box / high-res action set remains relatively narrow compared with general embodied active perception.

---

## 6.5 ReCoVERR

**Title**: Selective “Selective Prediction”: Reducing Unnecessary Abstention in Vision-Language Reasoning  
**Authors**: Tejas Srinivasan et al.  
**Venue**: Findings of ACL 2024  
**URL**: https://aclanthology.org/2024.findings-acl.767/  
**Code**: https://github.com/tejas1995/ReCoVERR  
**Architecture**: low-confidence answer → LLM proposes evidence questions → VLM finds clues → aggregate high-confidence evidence → answer or abstain.  
**Contribution**: evidence acquisition can reduce unnecessary abstention without lowering target accuracy in reported VQA experiments.  
**Limitations**: indirect clue gathering is not equivalent to a general sensor / camera action policy.

---

# 7. Visual Simulation Idea

# **Perception Value Arena × Evidence Sufficiency Control Room**

畫面左側：Current Evidence

```text
Global Image
├ traffic light: low-res
├ pedestrian: clear
├ road sign: unreadable
└ lane marking: partial
```

中央：Belief / Risk

```text
Question:
“Can the agent safely proceed?”

Answer candidate: YES
Answer confidence: 0.81
Evidence quality: 0.54
Decision risk: HIGH
```

右側列出 perception actions：

| Action | Expected Risk ↓ | Token Cost | Latency | Privacy | Net Value |
|---|---:|---:|---:|---:|---:|
| Answer now | 0 | 0 | 0 | 0 | -0.42 |
| Crop traffic light | 0.48 | 96 | 40ms | low | +0.37 |
| Full high-res | 0.51 | 1200 | 260ms | medium | +0.08 |
| More video frames | 0.62 | 480 | 150ms | low | +0.41 |
| Abstain | safe | 0 | 0 | 0 | +0.11 |

Policy 選：

```text
REQUEST_MORE_FRAMES
```

Observation 回來後：

```text
red light clearly visible
↓
Evidence quality: 0.92
Risk: 0.03
↓
STOP OBSERVING
↓
Action: DO NOT PROCEED
```

## 互動控制

```text
Risk tolerance slider
Token budget slider
Latency budget slider
Privacy sensitivity slider
```

再讓使用者看到 policy 如何變：

```text
LOW-RISK CHAT MODE
→ answer now

AUTONOMOUS-DRIVING MODE
→ acquire more evidence
```

這能視覺化：

```text
Same model
+
Same current observation
+
Different task risk
→ Different optimal perception action
```

---

# 8. 建議 Hermes Console 實作

## 8.1 `EvidenceSufficiencyState`

```text
EvidenceSufficiencyState
├ target_claim
├ evidence_items[]
├ grounding_score
├ contradiction_score
├ OOD_score
├ answer_uncertainty
├ missing_evidence_types[]
├ task_risk
├ sufficiency_score
└ certificate_level
```

## 8.2 `PerceptionActionCandidate`

```text
PerceptionActionCandidate
├ action_type
├ region / timespan / sensor
├ expected_information_gain
├ expected_risk_reduction
├ token_cost
├ latency_cost
├ gpu_cost
├ monetary_cost
├ privacy_cost
├ physical_risk
└ net_value
```

## 8.3 `PerceptionSufficiencyCertificate`

```text
PerceptionSufficiencyCertificate
├ target
├ evidence_snapshot
├ evidence_quality
├ calibrated_error_risk
├ acquisition_options_considered[]
├ best_remaining_VoI
├ stopping_reason
├ budget_status
├ abstention_allowed
└ validity_scope
```

## 8.4 `PerceptionActionDependencyTest`

```text
Acquired Observation
↓
Mask / Replace
↓
Replay Descendants
↓
Compare
├ final claim
├ confidence
├ plan
├ tool call
└ physical action
↓
functional dependence score
```

這可以檢驗：

```text
真正 Active Perception
vs
Lazy Perception
```

---

# 9. Knowledge Graph 新增 Nodes

```text
Visual Evidence Sufficiency
EvidenceSufficiencyState
PerceptionSufficiencyCertificate
Selective Prediction
Evidence-Grounded Selective Prediction
Active Observation
Active Perception Policy
Perception Action
Visual Acquisition Action
Value of Information
Expected Decision Value
Risk-Aware Perception
TaskRiskProfile
Perception Budget
Perception Stopping Rule
Lazy Perception
PerceptionActionDependencyTest
Evidence Quality
Visual Evidence Localization Quality
Observation Utility
Observation Cost
Acquisition Threshold
Abstention Policy
Human Escalation
```

---

# 10. Knowledge Graph 新增 Edges

```text
Answer Confidence
≠ Evidence Sufficiency

Evidence Sufficiency
≠ Answer Correctness

Uncertainty
≠ Evidence Insufficiency

Evidence Insufficiency
≠ Automatically Acquire More

Tool Call Performed
≠ Tool Observation Used

More Reasoning Compute
≠ Better Active Observation

More Visual Tokens
≠ Higher Decision Value

Same Uncertainty
≠ Same Optimal Perception Action

Task Risk
→ Changes Perception Threshold

Observation Cost
→ Changes Acquisition Policy

Evidence Quality
→ Improves Selective Prediction

Perception Action
→ Produces New Observation

New Observation
→ Updates Evidence Sufficiency

Counterfactual Observation Replacement
→ Tests Functional Dependence
```

---

# 11. Unknown / Open Questions

## 1. 如何估計真正的 Expected Value of Information？

目前最大的缺口：

```text
Before taking a crop
↓
Agent does not know what crop will reveal
```

所以要建立：

```text
P(observation outcome | action, current evidence)
```

這可能需要 world model / learned observation model。

---

## 2. Evidence sufficiency 要如何校準到不同風險領域？

```text
VQA
vs
medical image
vs
driving
vs
robot manipulation
```

不能共用同一 threshold。

---

## 3. 如何證明 active perception 不是 lazy tool mimicry？

需要：

```text
acquired evidence intervention
+
replay
+
claim/action delta
```

所以這個問題必須與前面建立的 causal replay architecture 合併，而不能只看 tool-call frequency。

---

# 12. 下一輪研究

下一輪應進入：

# **Observation World Model × Expected Information Gain × Belief-State Update × POMDP Perception Planning**

現在已有：

```text
Evidence
↓
Sufficiency
↓
Candidate Perception Actions
↓
VoI
↓
Acquire / Answer / Abstain
```

但還缺最底層的：

```text
Agent 在「還沒看之前」
如何預測看了之後可能獲得什麼？
```

下一輪應拆：

```text
Hidden World State
↓
Belief State
↓
Observation Model P(o | s,a)
↓
Perception Action
↓
Bayesian / learned belief update
↓
Expected information gain
↓
POMDP planning
```

優先研究：

```text
POMDP active perception
belief-space planning
visual world models
embodied viewpoint planning
Bayesian experimental design
active sensing
observation model learning
```

並建立：

```text
BeliefState
ObservationModel
ExpectedObservationDistribution
BeliefUpdateEvent
InformationGainCertificate
PerceptionPOMDP
PerceptionPlanner
```

---

# 13. 本輪結束判定

**缺哪一層？**  
`Observation Model + Belief-State Perception Planning Layer`

**哪個節點最淺？**  
`ExpectedValueOfInformation`、`PerceptionSufficiencyCertificate`、`ObservationUtilityModel`、`RiskAwarePerceptionGate`

**哪個概念仍只是名詞？**  
production 級 `Task-Sufficient Visual Information` 仍缺跨任務可校準的 operational definition。

**哪個系統值得讀原始碼？**  
AdaptVision：

```text
verl/workers/rollout/vllm_rollout/function_tools.py
→ verl/trainer/ppo/core_algos.py
→ verl/trainer/ppo/ray_trainer_bbox.py
→ scripts/vllm_adaptvision.py
```

ActiveVision 則值得讀：

```text
eval/
data/
eval/lib/scoring.py
```

來建立真正 active-observation benchmark interface。

**哪篇論文需追引用？**  
1. An Exam for Active Observers / ActiveVision  
2. Starve to Perceive  
3. SIEVES

**哪個概念最適合視覺模擬？**  
`Perception Value Arena × Evidence Sufficiency Control Room`

**哪個 Agent 架構最值得實作？**

```text
Evidence Sufficiency Monitor
↓
Risk-Aware VoI Estimator
↓
Active Perception Policy
↓
Visual Tool Runtime
↓
Observation Dependency Validator
↓
PerceptionSufficiencyCertificate
```

---

# 14. 對「AI 到底怎麼運作」新增的答案

```text
Camera / Image / Video
↓
Encoder
↓
Visual Tokens
↓
Compression / Routing
↓
Current Evidence
↓
Evidence Sufficiency Estimation
↓
Risk + Cost + Expected Information Value
↓
Perception Decision
├ Answer
├ Crop
├ Zoom
├ More Frames
├ New Viewpoint
└ Abstain
↓
New Observation
↓
Belief Update
↓
Reasoning / Planning
↓
Agent Action
```

真正成熟的多模態 Agent 不只是「能看圖」。它必須能判斷：

> **我現在看到的證據夠不夠？如果不夠，我下一次應該看哪裡？多看的成本是否值得？如果沒有任何觀察值得追加，我是應該回答，還是承認目前無法安全回答？**

這一層才把 VLM 從被動 multimodal model 推向真正的 Active Perception Agent。
