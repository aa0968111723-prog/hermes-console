# AI Agent × Multimodal Research Report

## 時間
2026-09-10 16:55 Asia/Taipei

## 本輪主題
**Active Perception × Value of Information × Uncertainty Calibration × Information-Gain Planning**

本輪承接上一輪 `Partial Observability × Belief State × Epistemic Control`。上一輪已建立：Observation ≠ World State、Belief-supported planning ≠ Belief-authorized effect；本輪進一步回答：**Agent 已經知道自己「不確定」之後，到底應該查什麼、問誰、看哪裡、花多少成本取得資訊，以及何時應停止查詢直接行動。**

---

# 本小時新發現

## 新論文 / 架構 / 方法

1. **Value of Information: A Framework for Human–Agent Communication** (ACL 2026)
   - Authors: Yijiang River Dong, Tiancheng Hu, Zheng Hui, Caiqi Zhang, Ivan Vulić, Andreea Bobu, Nigel Collier
   - Year: 2026
   - URL: https://aclanthology.org/2026.acl-long.1987/
   - Architecture: belief/decision state → candidate clarification → expected downstream utility → user/cognitive cost → ask-or-act decision
   - Contribution: 把「要不要問使用者」從固定 confidence threshold 改成 decision-theoretic Value of Information。
   - Reported result: across 20 Questions, medical diagnosis, flight booking, e-commerce, VoI matched or exceeded tuned baselines; paper reports up to +1.36 utility points in high-cost settings.
   - Limitation: 主要焦點是 human-agent clarification；尚未直接涵蓋 camera movement、MCP query、browser inspection、sensor repositioning 等 broader active perception actions。
   - Code: authors state code will be available at https://github.com/dong-river/VOI_communication ; repository availability/content should be rechecked before relying on it.

2. **Active Task Disambiguation with LLMs** (ICLR 2025)
   - Authors: Katarzyna Kobalczyk, Nicolas Astorga, Tennison Liu, Mihaela van der Schaar
   - Year: 2025
   - URL: https://arxiv.org/abs/2502.04485
   - Code: https://github.com/kasia-kobalczyk/active-task-disambiguation
   - Benchmarks / tasks: 20 Questions; code-generation experiments include HumanEval/APPS in the public code repository.
   - Architecture: viable hypothesis/solution set → generate candidate queries → simulate/estimate answer partitions → maximize information gain → obtain answer → filter hypotheses → repeat.
   - Contribution: formally frames ambiguous task clarification as Bayesian Experimental Design rather than free-form question generation.
   - Limitation: hypothesis quality itself is generated/approximated by LLMs; information-gain estimates are only as good as the represented hypothesis set and answer model.

3. **Uncertainty of Thoughts: Uncertainty-Aware Planning Enhances Information Seeking in Large Language Models** (NeurIPS 2024)
   - URL: https://arxiv.org/abs/2402.03271
   - Code: https://github.com/zhiyuanhubj/UoT
   - Architecture: possibility space → candidate questions → simulate answer branches → uncertainty-based reward → expected reward backup → choose question.
   - Contribution: treats information seeking as a lookahead planning problem rather than one-step uncertainty thresholding.
   - Reported repository summary: average successful-task-completion improvement of 57.8% over direct prompting across tested LLM settings; this is setting-specific and should not be generalized to arbitrary agents.
   - Limitation: tree simulation can become expensive; open-set possibility construction is itself model-dependent.

4. **Object-Level Verbalized Confidence Calibration in Vision-Language Models via Semantic Perturbation** (2025)
   - Authors: Yunpu Zhao, Rui Zhang, Junbin Xiao, Ruibo Hou, Jiaming Guo, Zihao Zhang, Yifan Hao, Yunji Chen
   - URL: https://arxiv.org/abs/2504.14848
   - Architecture: perturb key object regions with controlled Gaussian noise → create ambiguity/confidence mapping → supervised fine-tuning → preference optimization → verbalized-confidence calibration.
   - Contribution: demonstrates that VLM verbal confidence can be systematically misaligned with correctness and can be improved using controlled visual uncertainty.
   - Limitation: calibration focuses object-centric visual queries and verbalized confidence; not a full agent action-risk calibration mechanism.

5. **Decision-Aware Uncertainty Evaluation of Vision-Language Model-Based Early Action Anticipation for Human-Robot Interaction** (2026)
   - Authors: Zhaoda Du, Michael Bowman, Qiaojie Zheng, Xiaoli Zhang
   - URL: https://arxiv.org/abs/2603.10061
   - Architecture: temporal-prefix partial observations → VLM action prediction → uncertainty evaluation → calibration/selective prediction → confidence-gated downstream HRI.
   - Contribution: explicitly evaluates uncertainty under partial observations where premature confident action prediction can be unsafe.
   - Limitation: evaluation paper rather than a general-purpose active perception controller.

6. **Multi-UAV Active Sensing with Information Gain-based Planning and Belief Fusion** (2026)
   - Authors: S. Habibi, L. Marques
   - URL: https://arxiv.org/abs/2606.10986
   - Architecture: probabilistic belief map → candidate sensing paths → expected information gain → path planning → sensor observations → Bayesian/log-odds/Dempster–Shafer belief fusion.
   - Contribution: real-world active sensing evidence that information-gain planning can reduce map entropy/error relative to non-informative path strategies.
   - Limitation: spatial binary terrain mapping, not language-agent tool ecosystems.

---

# 本小時最重要 5 個發現

## 1. Confidence Threshold ≠ Value of Information

### 是什麼
很多 Agent 現在的策略像：

```text
if confidence < 0.7:
    ask_user()
else:
    act()
```

這個規則忽略三件事：

- 這次不確定是否真的會影響決策？
- 多取得資訊可以改善多少 expected utility？
- 問人、查工具、移動 camera、跑 VLM、呼叫 MCP 的成本是多少？

### 底層如何運作
理想的決策不是比較 `confidence`，而是比較：

```text
Current belief b
↓
Candidate epistemic action q
↓
Possible observations o₁...oₙ
↓
Posterior beliefs b₁...bₙ
↓
Best downstream action under each posterior
↓
Expected utility after information
− current best expected utility
− information acquisition cost
= Net VoI(q)
```

可寫成工程化形式：

```text
EVSI(q)
= E_o [ max_a E[U(a,s) | b, q, o] ]
  - max_a E[U(a,s) | b]

NetVoI(q)
= EVSI(q)
  - Cost(q)
  - LatencyPenalty(q)
  - UserInterruptionCost(q)
  - PrivacyCost(q)
  - ResourceCost(q)
```

其中 EVSI = Expected Value of Sample Information。

### 為什麼重要
同樣是 60% confidence：

```text
選背景顏色
→ 錯了成本很低
→ 不值得問

刪除 production database
→ 錯了成本極高
→ 即使 95% confidence 也可能值得再驗證
```

所以真正控制詢問行為的是：

```text
uncertainty × decision consequence × information usefulness × acquisition cost
```

不是 uncertainty 單獨一項。

### 限制
Agent 要計算 VoI，需要至少近似：world belief、observation likelihood、utility、cost。若這些數值本身嚴重錯估，VoI 也會錯。

### 證據狀態
- 【論文結果】ACL 2026 VoI framework：以 decision-theoretic utility 取代 brittle confidence thresholds。
- 【論文結果】Active Task Disambiguation：Bayesian Experimental Design / information gain 對 ambiguity reduction 有效。
- 【合理工程推論】Hermes 可將 query/tool/camera/human clarification 統一成 EpistemicAction，使用 NetVoI 排序。

---

## 2. Information Gain ≠ Decision Value

### 是什麼
最能降低 entropy 的問題，不一定最有助於完成任務。

假設 Agent 的 belief：

```text
File A is correct version 0.45
File B is correct version 0.45
File C is correct version 0.10
```

問題 Q1 可以非常有效區分 A/B，因此 information gain 很高；但如果 A、B 最終都會導向完全相同的 action，而只有 C 會導向危險 action，那麼 Q1 對決策幾乎沒價值。

### 底層
純資訊增益：

```text
IG(q)
= H(Before)
  - E_o[H(After | o)]
```

決策敏感 VoI：

```text
VoI(q)
= E_o[V*(b_after)]
  - V*(b_before)
  - cost(q)
```

這兩者不同。

### Hermes 應建立兩層評分

```text
Candidate epistemic action
↓
InformationGainScore
↓
DecisionImpactScore
↓
RiskReductionScore
↓
AcquisitionCost
↓
Net Epistemic Utility
```

### 為什麼重要
這可以避免 Agent 變成「很愛查資料但任務沒有更接近完成」的 research loop。

### 限制
Decision value 依賴 utility model，比 Shannon entropy 更難客觀定義。

### 證據狀態
- 【已確認理論】information gain 與 decision-theoretic value 是不同 objective。
- 【論文實作】Active Task Disambiguation 主要以 hypothesis-disambiguation / information gain 選 query。
- 【論文實作】VoI 2026 進一步把 task utility 與 communication cost 納入。

---

## 3. Verbal Confidence ≠ Calibrated Probability

### 是什麼
VLM/LLM 說：「我有 90% 把握」不能直接轉成 `p(correct)=0.9`。

2025 VLM calibration work 與 2026 decision-aware uncertainty evaluation 都指出 multimodal confidence calibration 在視覺 ambiguity、partial observation 等環境中仍有系統性問題。

### 底層必須拆開

```text
Raw model signal
├ token log-probabilities
├ predictive entropy
├ sample disagreement
├ semantic entropy
├ verbalized confidence
├ attention dispersion
├ ensemble disagreement
└ external verifier score
↓
Calibration model
↓
Calibrated risk estimate
↓
Selective / epistemic policy
```

可用 calibration table / isotonic regression / temperature scaling / conformal-style risk control 等方式建立 empirical mapping；但不同 modality、task、domain shift 應有不同 calibration profile。

### Hermes 需要的不是一個 confidence 欄位

```text
UncertaintyEstimate
├ source
├ metric
├ raw_score
├ calibrated_probability
├ calibration_dataset
├ calibration_version
├ domain
├ modality
├ sample_count
├ ECE / Brier metadata
└ OOD_flag
```

### 為什麼重要
若 calibration 壞掉，下一層的：

```text
Belief Update
VoI
Ask-vs-Act
Commit Gate
```

全部會被錯誤機率污染。

### 限制
Calibration 常受 distribution shift 破壞；單一 global ECE 也可能掩蓋 class / subgroup / scenario-specific miscalibration。

### 證據狀態
- 【論文結果】VLM verbalized confidence 常 miscalibrated。
- 【論文結果】partial temporal observation 下，需要 decision-aware calibration / selective prediction。
- 【合理工程推論】Hermes 必須保存 calibration provenance/version，而不能只保存 confidence number。

---

## 4. Active Perception 應統一 Human / Tool / Camera / Browser / MCP

### 是什麼
目前 Agent framework 常把以下東西分散在不同模組：

```text
ask_user()
search_web()
inspect_screen()
read_file()
query_database()
move_camera()
run_test()
check_git_status()
```

但它們在 epistemic 層其實有共同目的：

> **花成本取得 observation，更新 belief，讓下一個 task action 更安全或更有效。**

### 統一抽象

```text
EpistemicAction
├ action_id
├ acquisition_type
│  ├ HUMAN_QUERY
│  ├ MCP_READ
│  ├ SENSOR
│  ├ CAMERA_MOVE
│  ├ BROWSER_INSPECT
│  ├ RAG_QUERY
│  ├ TEST_EXECUTION
│  └ SIMULATION
├ expected_observation_space
├ predicted_information_gain
├ predicted_decision_value
├ monetary_cost
├ latency_cost
├ interruption_cost
├ privacy_cost
├ permission_required
└ reliability_model
```

### 完整底層 loop

```text
Goal
→ Current Belief
→ Candidate Task Action
→ Required Preconditions
→ Missing / uncertain predicates
→ Generate Epistemic Actions
→ Predict possible observations
→ Estimate posterior belief
→ Information gain
→ Decision value
→ Cost
→ Select epistemic action
→ Execute sensor/query/tool
→ Observation Envelope
→ Calibrate reliability
→ Bayesian / approximate belief update
→ Re-evaluate task action
```

### 為什麼重要
如此 Hermes 才能回答：

```text
應該再問使用者一次？
還是先讀 GitHub？
還是自己跑測試？
還是看 screenshot？
還是 camera 換角度？
還是直接做？
```

而不是靠 hard-coded tool priority。

### 證據狀態
- 【論文結果】human clarification 的 VoI 已有直接證據。
- 【論文結果】Multi-UAV active sensing 顯示 belief-driven information-gain planning 可指導 sensor paths。
- 【合理工程推論】跨 Human/Tool/Sensor 的統一 EpistemicAction ABI 是 Hermes-specific architecture，目前不是既有標準。

---

## 5. Active Perception 自己也需要 Budget、Stopping Rule、Critical Path

### 是什麼
「不確定就多查」會製造另一種 Agent failure：

```text
query
→ still uncertain
→ query
→ still uncertain
→ inspect
→ simulate
→ ask
→ search
→ ...
```

形成 epistemic loop。

### 應建立停止條件

```text
Continue acquiring information iff:

max_q NetVoI(q) > 0
AND deadline_slack > acquisition_time
AND epistemic_budget_remaining > 0
AND expected_risk_reduction is material
```

否則：

```text
ACT
ABSTAIN
ASK USER
RETURN PARTIAL
ESCALATE
```

### 與前面研究接合

```text
Global Speculation Budget
        ↓
Epistemic Budget
├ max queries
├ max user interruptions
├ max sensor moves
├ max tool reads
├ max simulation rollouts
├ max tokens
└ max latency
```

再接 Deadline-Aware Scheduler：

```text
High VoI query
但耗時 20s
而 deadline slack 只有 3s
→ 不應執行
```

### 為什麼重要
資訊取得不是免費 computation；對 production Agent，它會消耗 API quota、token、network、GPU、使用者注意力與時間。

### 證據狀態
- 【論文結果】VoI 明確把 human cognitive/interaction cost 納入 ask-or-act。
- 【論文結果】UoT 使用 expected-reward planning，但 tree search 本身有計算成本。
- 【合理工程推論】Hermes 應把 epistemic acquisition 納入既有 Global Speculation Budget / deadline architecture。

---

# Architecture Breakdown

本輪提出 Hermes 的 **Active Epistemic Control Plane**：

```text
User Goal
↓
Belief State
├ hypotheses
├ probabilities / scores
├ evidence graph
├ contradictions
├ unknown mass
└ staleness
↓
Candidate Task Action
↓
Precondition Analyzer
↓
Uncertain Decision-Relevant Predicates
↓
Epistemic Action Generator
├ Ask User
├ Query MCP
├ Read RAG
├ Inspect Browser
├ Run Test
├ Move Camera
├ Query Sensor
├ Simulate Counterfactual
└ Cross-check Model
↓
Observation Predictor
↓
Posterior Simulator
↓
Epistemic Scoring
├ Expected Information Gain
├ Expected Decision Value
├ Expected Risk Reduction
├ Reliability
├ Latency Cost
├ Resource Cost
├ User Interruption Cost
├ Privacy Cost
└ Critical-path impact
↓
Epistemic Budget / Admission Gate
↓
SELECT / ACT / ABSTAIN / ESCALATE
↓
Acquisition Runtime
↓
Observation Envelope
↓
Calibration Layer
↓
Belief Update
↓
Grounded Commitment Gate
↓
Task Action
```

Hermes 應新增 4 個明確 plane：

```text
Belief Plane
→ 我現在相信什麼？

Epistemic Plane
→ 我還應該知道什麼？

Acquisition Plane
→ 我怎麼取得它？

Commitment Plane
→ 證據是否足以授權真實 action？
```

---

# Bottom-Level Logic

## A. Belief Entropy
對離散 hypothesis：

```text
H(B) = - Σ_i p_i log p_i
```

注意：這只在 `p_i` 是有意義、近似校準的 belief weight 時才有可解釋性。

## B. Expected Information Gain

```text
EIG(q)
= H(B)
- Σ_o P(o|q,B) H(B | q,o)
```

完整流程：

```text
q
→ enumerate / sample possible observations o
→ estimate P(o | q, B)
→ compute posterior B'
→ compute H(B')
→ expectation
→ entropy reduction
```

## C. Decision-sensitive Value of Information

```text
V(B) = max_a E_{s~B}[U(a,s)]

EVSI(q)
= E_o[V(B_{q,o})] - V(B)

NetVoI(q)
= EVSI(q)
- C_query
- C_latency
- C_user
- C_privacy
- C_resource
```

## D. Expected Risk Reduction
對高風險 tool action：

```text
Risk(a,B)
= Σ_s B(s) Loss(a,s)

ERR(q,a)
= Risk(a,B)
- E_o[min_a' Risk(a',B_{q,o})]
```

所以某個 query 即使 information gain 不大，只要能排除 catastrophic state，它仍可能非常值得取得。

## E. Information Acquisition Stopping Rule

初始工程規則：

```text
BestQ = argmax_q NetVoI(q)

if NetVoI(BestQ) <= 0:
    stop acquiring
elif EpistemicBudget exhausted:
    stop / abstain
elif acquisition_latency > deadline_slack:
    stop / fallback
else:
    execute BestQ
```

這是【工程模型】，不是單一論文的既有公式。

---

# System Architecture Deep Dive: Active Task Disambiguation

Public repository:
https://github.com/kasia-kobalczyk/active-task-disambiguation

值得看的目錄 / 檔案：

```text
src/code-generation/
├ _execution.py
├ active_code_generation.py
├ code_utils.py
├ get_apps.py
├ get_zero_shot_results.py
└ reasoners.py
```

核心 `reasoners.py` 實際流程：

```text
Problem / requirements
↓
_generate_hypothesis()
↓
LLM samples candidate programs
↓
_filter_hypothesis()
↓
_generate_questions()
↓
Candidate sample inputs / tests
↓
answer_questions(program, questions)
↓
Build hypothesis × question output matrix
↓
Group answer outcomes per question
↓
Normalize counts / probabilities
↓
Compute entropy
↓
select question with maximum entropy
↓
receive oracle/user answer
↓
filter hypothesis set
↓
repeat
```

原始碼中的 `select_best_question()` 不是只呼叫 LLM 判斷「哪題最好」；它會讓候選 program hypotheses 對候選 questions 產生 outputs，建立 DataFrame，再依每題 answer-output distribution 算 entropy，選 entropy 最大的 query。

這非常適合 Hermes 借鏡，因為它把：

```text
LLM question proposal
```

與：

```text
explicit information objective
```

分開。

### 值得注意的 implementation limitations

1. hypothesis set 是 finite sample，可能漏掉真正解。
2. answer distribution 來自 candidate hypotheses，而不是真實 posterior。
3. entropy 最大不等於 downstream utility 最大。
4. sandbox execution timeout / error 會影響 answer partition。
5. code-generation setting 的 oracle answer 比真實 human/tool observation 乾淨很多。

因此 Hermes 應升級成：

```text
Candidate Epistemic Action
↓
Posterior Simulator
↓
Information Gain
+
Decision Impact
+
Risk Reduction
−
Acquisition Cost
```

---

# Multimodal Bottom-Level Logic

Active perception 在 multimodal Agent 中不能只理解成「再看一次圖片」。

## Camera / Image

```text
Current frame
↓
Vision Encoder
↓
Visual tokens/features
↓
Object / relation hypotheses
↓
Uncertainty localization
↓
Candidate perceptual actions
├ crop region
├ zoom
├ move camera
├ change viewpoint
├ increase exposure
└ request another frame
↓
Expected observation distribution
↓
Expected posterior belief
↓
VoI / information gain
↓
Select perceptual action
```

## Video

```text
Temporal prefix
↓
Action hypotheses
↓
Predictive uncertainty
↓
Candidate: WAIT 300ms / observe 10 more frames / change view
↓
Expected uncertainty reduction
↓
Delay cost vs action-risk reduction
↓
ACT / WAIT / REOBSERVE
```

這直接呼應 2026 early-action anticipation 研究：partial temporal observations 下 confidence reliability 是 downstream HRI 的核心問題。

## Audio / Voice

```text
Waveform
↓
ASR posterior / alternatives
↓
Semantic hypotheses
↓
Ambiguous slot detected
↓
Candidate actions
├ ask repeat
├ confirm critical entity
├ use context
└ continue
↓
VoI vs interruption cost
```

例如：

```text
「幫我刪掉 A 還是 B？」
```

若 ASR 對檔名有 ambiguity，刪除的 catastrophic loss 高，即使重新問一次有 user interruption cost，NetVoI 仍可能為正。

## 3D / Embodied

```text
RGB + depth + proprioception
↓
belief map
↓
unknown / occluded regions
↓
Candidate viewpoints / trajectories
↓
Expected map entropy reduction
↓
path cost + collision risk + energy
↓
Informative path planning
```

Multi-UAV active sensing 研究是這一層的直接工程對照。

---

# Visual Simulation Idea

## **Active Perception & Value-of-Information Lab**

主畫面：

```text
TRUE WORLD (hidden)
         ↓
      Belief Map

A ███████ 0.48
B ██████  0.42
C ██      0.10
```

右側列 Candidate Epistemic Actions：

```text
ASK USER
IG:       0.71
VoI:      +8.2
Latency:  4.0s
Cost:     medium

READ MCP
IG:       0.45
VoI:      +10.1
Latency:  0.8s
Cost:     low

CAMERA MOVE
IG:       0.62
VoI:      +5.4
Latency:  2.1s
Cost:     medium

DO NOTHING
VoI:      0
Risk:     14.2
```

點 `READ MCP`：

```text
Observation O17
↓
Calibration
↓
Likelihood update
↓
Belief

A 0.48 → 0.83
B 0.42 → 0.14
C 0.10 → 0.03
```

然後 Decision Risk 即時下降。

### 可切換策略

```text
CONFIDENCE THRESHOLD
MAX INFORMATION GAIN
MAX RISK REDUCTION
MAX VoI
VoI + DEADLINE
VoI + GLOBAL BUDGET
```

### 可注入故障

```text
MIS-CALIBRATED VLM
STALE MCP RESULT
ASR AMBIGUITY
CAMERA OCCLUSION
USER INTERRUPTION COST ×5
DEADLINE = 2s
QUERY COST ×10
OOD INPUT
CONTRADICTORY SENSORS
```

最關鍵展示：

```text
Max Information Gain chooses Q1
but Q1 does not change optimal action

Max VoI chooses Q2
because Q2 can rule out catastrophic state
```

這能視覺化：

> **最有資訊的問題，不一定是最值得問的問題。**

---

# Code / GitHub

## 1. Active Task Disambiguation
https://github.com/kasia-kobalczyk/active-task-disambiguation

優先閱讀：

```text
src/code-generation/reasoners.py
src/code-generation/active_code_generation.py
src/code-generation/_execution.py
src/code-generation/code_utils.py
```

`reasoners.py` 最值得看：Hypothesis abstraction、candidate query generation、hypothesis filtering、answer matrix、entropy-based selection。

## 2. UoT
https://github.com/zhiyuanhubj/UoT

下一步值得追：

```text
question-tree construction
uncertainty reward
expected-reward backup
open-set possibility construction
pruning
```

## 3. ET-Agent（鄰近但不同問題）
https://github.com/asilverlight/ET-Agent

價值：研究 tool-integrated reasoning 中 redundant / insufficient tool calls 的 behavior calibration，可與本輪 Epistemic Budget 結合，但它不是直接的 VoI controller。

---

# Papers

## Paper A — Value of Information: A Framework for Human–Agent Communication
- Authors: Yijiang River Dong, Tiancheng Hu, Zheng Hui, Caiqi Zhang, Ivan Vulić, Andreea Bobu, Nigel Collier
- Venue/Year: ACL 2026
- URL: https://aclanthology.org/2026.acl-long.1987/
- Code: stated future/released location: https://github.com/dong-river/VOI_communication (verify availability before implementation)
- Dataset/tasks: 20 Questions, medical diagnosis, flight booking, e-commerce
- Architecture: decision uncertainty → clarification candidate → expected utility improvement → cognitive/interruption cost → ask/act
- Contribution: replaces universal confidence threshold with task-sensitive VoI.
- Limitation: focuses human communication rather than all sensing/tool channels.
- Changed what: moves clarification from “uncertain therefore ask” to “ask only when expected improvement exceeds cost.”

## Paper B — Active Task Disambiguation with LLMs
- Authors: Katarzyna Kobalczyk, Nicolas Astorga, Tennison Liu, Mihaela van der Schaar
- Venue/Year: ICLR 2025
- URL: https://arxiv.org/abs/2502.04485
- Code: https://github.com/kasia-kobalczyk/active-task-disambiguation
- Dataset/tasks: 20Q; code repo also exposes HumanEval/APPS code-generation experiments
- Architecture: sample viable solutions → propose query → estimate partition/information gain → ask → eliminate inconsistent solutions
- Contribution: Bayesian Experimental Design framing for LLM clarification.
- Limitation: information gain relies on quality/coverage of generated hypothesis space.
- Changed what: shifts LLM question selection from linguistic plausibility toward explicit experimental design.

## Paper C — Uncertainty of Thoughts
- Year: 2024
- URL: https://arxiv.org/abs/2402.03271
- Code: https://github.com/zhiyuanhubj/UoT
- Architecture: candidate question → simulated answer tree → uncertainty reward → expected reward propagation → best question
- Contribution: adds multi-step lookahead to information seeking.
- Limitation: simulation-tree cost and model-generated possibility space.

## Paper D — Object-Level Verbalized Confidence Calibration in VLMs via Semantic Perturbation
- Authors: Yunpu Zhao et al.
- Year: 2025
- URL: https://arxiv.org/abs/2504.14848
- Architecture: visual semantic perturbation → calibrated training examples → SFT → preference optimization
- Contribution: calibrates VLM verbal confidence using controlled visual ambiguity.
- Limitation: object-centric confidence rather than end-to-end agent action risk.

## Paper E — Decision-Aware Uncertainty Evaluation of VLM-Based Early Action Anticipation for HRI
- Authors: Zhaoda Du, Michael Bowman, Qiaojie Zheng, Xiaoli Zhang
- Year: 2026
- URL: https://arxiv.org/abs/2603.10061
- Architecture: partial temporal observation → prediction → confidence → calibration/selective prediction
- Contribution: uncertainty reliability under partial observations for confidence-gated HRI.
- Limitation: evaluation-oriented, not an active query policy.

---

# 已確認事實 / 論文結果 / 工程實作 / 推論 / 假說分層

## 已確認 / 官方公開內容
- ACL Anthology lists the 2026 VoI paper and its ask-vs-act decision-theoretic framing.
- Active Task Disambiguation has a public official GitHub implementation.
- Repository `reasoners.py` implements explicit candidate question generation, hypothesis execution/filtering, and entropy-based question selection.

## 論文結果
- VoI 2026 reports benefit across four task domains and up to +1.36 utility points in high-cost settings.
- Active Task Disambiguation reports information-gain-based clarification improvements over question-space-only approaches.
- VLM calibration papers report substantial miscalibration under multimodal uncertainty/partial observation.
- Multi-UAV active sensing reports entropy/error reductions from information-gain-based informative path planning compared with non-informative baselines.

## 工程實作
- Active Task Disambiguation `reasoners.py` converts hypothesis outputs over candidate questions into a distribution and computes entropy to pick a query.

## 合理推論
- Human question、MCP read、browser inspect、camera move、sensor query、test execution can share one EpistemicAction ABI.
- Epistemic action should consume the same global resource/deadline budget as speculation and tool execution.

## 尚未驗證假說
- A single calibrated NetVoI controller can outperform separate human-query/tool-query/sensor-query policies across heterogeneous Hermes workloads.
- Decision-risk-aware VoI will be more robust than entropy-only acquisition for effectful MCP/tool actions.
- Multimodal calibration profiles can be dynamically routed by modality/domain/OOD detection without introducing prohibitive latency.

---

# Unknown / Open Questions

## 1. P(o | q, B) 到底怎麼估？
VoI 最難的地方不是公式，而是 observation model。對：

```text
MCP
Browser
Human
VLM
Camera
Tool runtime
```

每個 channel 都需要不同的 response/observation probability model。

## 2. LLM/VLM uncertainty 怎麼變成可用 probability？
Token entropy、semantic entropy、sample disagreement、verbal confidence、external verifier 可能互相衝突；目前沒有一個跨 modality、跨 model、跨 task 的 universal calibrator。

## 3. VoI 如何與 critical path 合併？
一個高 VoI query 如果無法在 deadline 前回來，其 operational value 接近零。需要把 `Expected Utility Gain` 與 `Probability(result arrives before decision point)` 結合。

---

# 下一輪研究

最大缺口已變成：

## **Calibration Runtime × Conformal Risk Control × OOD Detection × Selective Action / Abstention**

下一輪應深入：

```text
Raw logits / samples / verbal confidence / VLM scores
↓
Uncertainty estimator
↓
Calibration dataset
↓
Temperature / isotonic / conformal calibration
↓
OOD / distribution-shift detector
↓
Risk-coverage curve
↓
Selective prediction
↓
ACT / ASK / VERIFY / ABSTAIN
```

並比較：

```text
ECE
Brier Score
NLL
Selective Risk
Coverage
Risk-Coverage Curve
Conformal Prediction
Semantic Entropy
Self-consistency
Ensemble / MC Dropout
Verifier-based calibration
```

核心問題：

> **Hermes 要如何把「模型內部的不確定訊號」變成一個真的可以拿來控制真實 Tool/MCP 行動權限的風險值？**

---

# Knowledge Graph 新增 Node / Edge

## New Nodes

```text
Active Perception
Epistemic Action
Epistemic Action Generator
Information Gain
Expected Information Gain
Value of Information
Expected Value of Sample Information
Decision Value
Decision-Relevant Uncertainty
Expected Risk Reduction
Acquisition Cost
User Interruption Cost
Epistemic Budget
Epistemic Stopping Rule
Observation Predictor
Posterior Simulator
Uncertainty Calibration
Calibration Profile
Verbalized Confidence
Predictive Entropy
Selective Prediction
Risk-Coverage Curve
Multimodal Active Perception
Informative Path Planning
```

## New Edges

```text
Belief State
→ proposes
Epistemic Action

Epistemic Action
→ produces
Observation

Observation
→ updates
Belief State

Epistemic Action
→ has_expected
Information Gain

Epistemic Action
→ has_expected
Decision Value

Epistemic Action
→ consumes
Epistemic Budget

Uncertainty Estimate
→ calibrated_by
Calibration Profile

Calibrated Risk
→ gates
Task Action

Expected Information Gain
→ differs_from
Value of Information

Deadline Slack
→ constrains
Epistemic Action

Decision Risk
→ increases_value_of
Verification
```

## Negative / distinction edges

```text
Confidence Threshold
≠ Value of Information

Information Gain
≠ Decision Value

Entropy Reduction
≠ Risk Reduction

Verbal Confidence
≠ Calibrated Probability

High Uncertainty
≠ Must Ask

Low Uncertainty
≠ Safe To Act

More Observation
≠ Better Decision

Active Perception
≠ Camera Only

Ask User
≠ Special Case Outside Agent Planning
```

---

# 本輪結束檢查

- **缺哪一層：** Calibration Runtime / Selective Action Risk Controller。
- **哪個節點最淺：** Observation likelihood `P(o|q,B)` 的 learned/empirical estimation。
- **哪個概念仍只是名詞：** Unified Cross-Modal EpistemicAction ABI、Decision-Relevant Uncertainty、Epistemic Budget Reservation。
- **哪個系統值得讀原始碼：** `kasia-kobalczyk/active-task-disambiguation`，尤其 `src/code-generation/reasoners.py`、`active_code_generation.py`、`_execution.py`；其次 `zhiyuanhubj/UoT` 的 question-tree / reward backup。
- **哪篇論文需追引用：** Active Task Disambiguation、Value of Information 2026、Uncertainty of Thoughts；multimodal 部分追 VLM calibration / decision-aware uncertainty。
- **哪個概念最適合視覺模擬：** Active Perception & Value-of-Information Lab，直接對比 max-confidence / max-IG / max-VoI / risk-aware VoI。
- **哪個 Agent 架構最值得實作：**

> **Value-of-Information-Guided Epistemic Agent Runtime = Belief State + Precondition Analyzer + Epistemic Action Generator + Posterior Simulator + Calibration Layer + VoI/Risk Scorer + Epistemic Budget + Grounded Commitment Gate**

---

# 本輪核心結論

成熟的 Agent 不應只問「我有多確定？」，而應問：

> **「哪一個尚未知道的資訊真的可能改變我的決策？取得它能降低多少錯誤與風險？我要付出多少時間、token、工具成本、感測成本或使用者注意力？如果答案值得，才去看、去問、去查；不值得，就停止探索並採取最合理的行動。」**

因此從「使用者說一句話」到真實行動的底層鏈，現在可以再補上一層：

```text
User / Camera / Voice / Video
↓
Encoder / Parser
↓
Observation
↓
Calibration
↓
Belief State
↓
Decision-Relevant Uncertainty
↓
Epistemic Action Candidates
↓
Expected Information Gain
↓
Value of Information / Risk Reduction
↓
Ask / Inspect / Query / Sense / Simulate / Proceed
↓
New Observation
↓
Belief Update
↓
Grounded Commitment
↓
Planner / Tool / MCP / Model / GPU
↓
Action / Output
```

這一層把「AI 知道自己不知道」再推進成「AI 知道什麼值得去知道」。