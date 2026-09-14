# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 06:55（Asia/Taipei）**  
**主題：Simulator Red Team × Counterexample Generation × Safety Regression × Adversarial World-Model Testing**

## 與歷史研究比較

上一輪已建立 `Planner Model Exploitation → Robust/Pessimistic Evaluation → Reality → World Model Repair`，並指出強 Planner 會主動找到 simulator 的 optimistic blind spot。本輪不再重複討論「模型可能被利用」，而是補上下一個缺失層：**如何系統化地主動尋找反例、驗證反例、保存成安全回歸測試，並在模型/Planner/Prompt/Tool 版本更新後持續重播。**

因此本輪把研究焦點由被動防禦推進成：

```text
World Model / Simulator
↓
Red-Team Planner
↓
Counterexample Search
↓
Trusted / Real Verification
↓
Failure Minimization
↓
Exploitability Corpus
↓
Safety Regression Suite
↓
Repair
↓
Replay Before Release
```

這一層是上一輪 `ModelExploitationEvent` 與 `WorldModelRepair` 之間缺失的可重現測試基礎設施。

---

## 本小時新發現

### 新論文 / 新架構

1. **World Models as Adversaries: Multi-Agent Self-Play Fine-Tuning for Robust Motion Planning** — Tong Nie, Yuewen Mei, Junlin He, Yihong Tang, Jian Sun, Wei Ma, 2026.  
   URL: https://arxiv.org/abs/2607.10630  
   核心：把 planner 自己的 predictive world model 轉換成 role-conditioned adversary；inner minimization 產生 sparse、scene-adaptive attack coalition，outer maximization 讓 ego planner 以 regret-aware robust best response 學習。這表示「world model」不只可以預測，也可以被正式重新角色化成 red-team adversary。

2. **CounterScene: Counterfactual Causal Reasoning in Generative World Models for Safety-Critical Closed-Loop Evaluation** — Bowen Jing, Ruiyang Hao, Weitao Zhou, Haibao Yu, 2026.  
   URL: https://arxiv.org/abs/2603.21104  
   核心：不做無結構亂擾動，而是先找 causal-critical agent / conflict type，再對真正關鍵的 agent 做 minimal counterfactual intervention，讓危險透過互動自然傳播。這對 Hermes 很重要，因為 counterexample 應追求「最小、可解釋、可重播」，不是單純最大破壞。

3. **Agent2World: Learning to Generate Symbolic World Models via Adaptive Multi-Agent Feedback** — Mengkang Hu et al., 2025.  
   URL: https://arxiv.org/abs/2512.22336  
   Code: https://github.com/DeepExperience/agent2world  
   核心：Deep Researcher → Model Developer → Testing Team；Testing Team 同時做 unit/contract testing 與 simulation/play testing，失敗 feedback 回到 Model Developer 進行修正。它提供「world model 應該像軟體一樣被測」的具體工程模板。

4. **AutoControl Arena: Synthesizing Executable Test Environments for Frontier AI Risk Evaluation** — 2026.  
   URL: https://arxiv.org/abs/2603.07427  
   核心：logic-narrative decoupling；將 deterministic state 固定在 executable code，把 generative narrative/dynamics 留給 LLM，降低純 LLM simulator 的 logic hallucination。對 safety regression 的關鍵啟示是：**oracle 與 state invariant 應儘量由可執行邏輯承擔，而非再交給被測模型自己判分。**

5. **SafeAgent: Safeguarding LLM Agents via an Automated Risk Simulator** — Xueyang Zhou et al., ACL 2026.  
   URL: https://aclanthology.org/2026.acl-long.1501/  
   核心：把 automated risk simulator 用於 LLM agent safety，而不是只靠靜態 prompt benchmark。這使本輪 red-team layer 可從 embodied/world-model 延伸到 Browser / Coding / MCP / Tool Agent。

### 新 GitHub / 工程實作

**DeepExperience/agent2world** 的實際結構：

```text
src/
├ agentic_world_model/
│  ├ agentic_world_framework.py
│  ├ mcts_gen.py
│  ├ text2world_gen.py
│  ├ bytesized32_gen.py
│  └ consistency/
├ toolkits/
└ models/
```

值得看的核心檔案：

```text
src/agentic_world_model/agentic_world_framework.py
src/agentic_world_model/mcts_gen.py
src/toolkits/*
```

`agentic_world_framework.py` 實際建立四類 runtime component：research、code、play、pytest，外加 sandbox。生成 world model 後，`play` agent 透過 `play_env` 做 behavior-level execution，`pytest` agent 做 contract/invariant test；若任一失敗，feedback 會回到 code agent，最多迭代數輪。這比「LLM 自己檢查自己寫的 simulator」強，因為失敗表面被拆成不同 tester。

---

# 本小時最重要 5 個發現

## 1. Red Team 必須攻擊「Policy Ordering」，不只是預測誤差

### 是什麼

上一輪已知道 world model exploitation 的核心不是單點 state error，而是：

```text
Model:
π_A > π_B

Reality / Trusted Oracle:
π_B > π_A
```

因此 red-team objective 不應只最大化：

```text
prediction_error
```

而應優先最大化：

```text
PlannerWorldModelGap
=
PredictedPolicyAdvantage
-
TrustedPolicyAdvantage
```

### 底層如何運作

對候選 trajectory / policy `τ`：

```text
V_model(τ)
V_trusted(τ)

ExploitGap(τ)
=
V_model(τ) - V_trusted(τ)
```

更強版本不是只找大 gap，而是找 policy ordering inversion：

```text
sign[V_model(πa)-V_model(πb)]
≠
sign[V_trusted(πa)-V_trusted(πb)]
```

### 為什麼重要

平均 next-state accuracy 可以很好，但 planner 只要找到少數「錯得非常有利」的區域，就可能完全改變決策。

### 限制

Trusted oracle 在真實世界往往昂貴、有限，不能對所有 rollout 做 ground-truth verification。

### 來源

- Imperfect World Models are Exploitable, 2026: https://arxiv.org/abs/2605.15960
- World Models as Adversaries, 2026: https://arxiv.org/abs/2607.10630

---

## 2. 最有價值的 counterexample 往往是「最小介入」，不是最大破壞

### 是什麼

隨機 noise 或極端攻擊很容易找到 failure，但這種 case 通常：

```text
不真實
難定位原因
難修復
容易 overfit
```

CounterScene 的方向更適合 Hermes：

```text
Safe scene
↓
Causal interaction graph
↓
critical actor / variable
↓
minimal intervention
↓
unsafe outcome
```

### Bottom-level mechanism

可定義：

```text
CounterexampleScore(x')
=
FailureSeverity(x')
- λdist · Distance(x', x)
- λimplaus · Implausibility(x')
```

也就是：

```text
maximize failure
subject to minimal semantic / causal change
```

對 Tool Agent 可等價成：

```text
原本正常 MCP response
↓
只改一個 permission field / stale timestamp / schema optionality
↓
Agent 是否走入錯誤 branch？
```

### 為什麼重要

Minimal counterexample 可以直接轉成 regression fixture，並指出真正敏感的 causal edge。

### 限制

「最小」依賴距離函數；pixel L2、token edit distance、semantic distance、causal intervention count 會得到不同結果。

### 來源

CounterScene: https://arxiv.org/abs/2603.21104

---

## 3. Simulator 的 Unit Test 與 Behavioral Simulation Test 必須分開

### 是什麼

Agent2World 原始碼提供非常清楚的工程分解：

```text
Code Agent
↓
Generated World Model
├ Pytest Agent
│  └ contract / invariant / executable correctness
└ Play Agent
   └ behavior / trajectory / interaction correctness
↓
feedback
↓
Code Agent repair
```

### 底層如何運作

Hermes 可對 world model 建四層 oracle：

```text
L0 Schema Oracle
- action 是否合法
- output 是否符合型別

L1 Invariant Oracle
- conservation / permission / state constraints

L2 Behavioral Oracle
- sequence 是否符合 specification
- reward / terminal 是否合理

L3 Decision Oracle
- planner ranking 是否與 trusted system 一致
```

### 為什麼重要

一個 simulator 可以 API 全部通過，但 dynamics 仍完全錯；也可以 trajectory 看起來自然，但 deterministic invariant 已被破壞。

### 限制

Behavior oracle 很難完全自動化，尤其 open-world multimodal environment。

### 工程實作確認

Agent2World `agentic_world_framework.py` 中確實建立：

```text
research agent
code agent
play agent
pytest agent
sandbox
```

並把 `play_report`、`pytest_report` 回饋給下一輪 code generation。

---

## 4. Counterexample 必須升級成可版本化的 Safety Regression Artifact

找到 failure 但沒有保存，就不是真正的工程安全系統。

Hermes 應新增：

```text
SafetyRegressionCase
├ case_id
├ source_model_version
├ planner_version
├ environment_version
├ prompt / goal
├ initial_state
├ action_sequence
├ observations
├ expected_invariants
├ expected_safe_outcome
├ failure_signature
├ minimal_counterexample
├ oracle_type
├ verification_source
├ severity
├ reproducibility
└ first_seen_commit
```

每次 world model / agent runtime 更新：

```text
New Build
↓
Replay historical exploitability corpus
↓
PASS / FAIL / CHANGED
↓
Regression Diff
```

不能只跑「最新 benchmark average」。

### 新的重要區分

```text
Benchmark Score Improved
≠ Historical Safety Regressions Fixed
```

以及：

```text
Failure Fixed Once
≠ Failure Class Eliminated
```

需要對 counterexample 做 mutation / neighborhood generation，避免只記住單一 case。

---

## 5. World Model 可以同時是 Simulator、Adversary、Teacher 與 Test Generator

AWM 的重要意義不是只在 autonomous driving，而是 role transformation：

```text
Predictive World Model
↓ role condition
Adversarial World Model
↓
produces hard scenarios
↓
Planner learns robust response
```

Agent2World 則形成另一種閉環：

```text
Generated Simulator
↓
Testing Team
↓
Failure Feedback
↓
Simulator Repair
↓
Training Trajectory
```

因此 Hermes 可把同一底層 world-model interface 定義成：

```text
simulate(state, action)
adversarially_simulate(state, goal, constraints)
mutate(counterexample)
verify(trajectory, oracle)
minimize_failure(trajectory)
```

這比建立一個額外孤立「red team app」更合理。

### 重要限制

若 red-team adversary 和 planner 共用完全相同 blind spot，可能產生：

```text
shared-model blind spot
↓
red team 也看不見真正失敗
```

所以高嚴重度 case 必須引入異質 verifier：另一模型、symbolic oracle、真 simulator、真 tool execution 或 human review。

---

# Architecture Breakdown

本輪建議 Hermes 新增完整的 **Simulator Safety Validation Runtime**：

```text
User Goal / Task
↓
Grounded Initial State
↓
World Model / Simulator
↓
Baseline Planner
↓
Nominal Trajectory
↓
────────────────────────────
Simulator Red-Team Runtime
├ Search Objective
│  ├ policy-order inversion
│  ├ safety invariant violation
│  ├ reward exploit
│  ├ terminal exploit
│  ├ permission exploit
│  └ hidden-state inconsistency
│
├ Counterexample Generator
│  ├ action mutation
│  ├ state mutation
│  ├ observation mutation
│  ├ causal actor intervention
│  ├ tool-result mutation
│  └ multimodal evidence mutation
│
├ Search Engine
│  ├ beam search
│  ├ MCTS
│  ├ evolutionary search
│  ├ gradient / latent search
│  ├ self-play
│  └ LLM test agent
│
└ Constraint Layer
   ├ realism
   ├ semantic distance
   ├ allowed perturbation
   └ compute budget
────────────────────────────
↓
Candidate Failure
↓
Oracle Stack
├ Schema Oracle
├ Invariant Oracle
├ Behavioral Oracle
├ Trusted Simulator
├ Alternative World Model
└ Real Tool / Human Verification
↓
Verified Counterexample
↓
Failure Minimizer
↓
SafetyRegressionCase
↓
Exploitability Corpus
↓
Repair / Retraining
↓
Full Regression Replay
```

---

# Bottom-Level Logic

## 1. Red-team search objective

一般 adversarial search：

```text
a* = argmax_a FailureScore(T_model(s,a))
```

但更好的 exploitation objective：

```text
τ* = argmax_τ [
    V_model(τ)
    - V_trusted(τ)
    + λrisk SafetyViolation(τ)
    - λdist PerturbationDistance(τ)
]
```

這會偏好「模型覺得很好、可信系統覺得很糟」的 trajectory。

## 2. Counterexample minimization

找到 failure `x_fail` 後，不應直接存整個複雜 scenario，而應做 delta-debugging 型縮減：

```text
failure scenario
↓
remove one perturbation
↓
still fails?
├ YES → keep removed
└ NO  → restore
↓ repeat
minimal failure core
```

Agent trajectory 版本：

```text
120-step failure
↓
remove prefix / branch / tool result
↓
找到最短 still-failing trace
```

## 3. Metamorphic testing

沒有精確 oracle 的 open-world task 可使用 metamorphic relation：

```text
MR1: irrelevant visual background change
→ answer / plan should remain invariant

MR2: tool result reorder without semantic change
→ plan should remain invariant

MR3: permission downgrade
→ privileged action must disappear

MR4: additional contradictory evidence
→ confidence should not increase unchecked
```

因此：

```text
No Exact Ground Truth
≠ No Test Oracle
```

## 4. Regression signature

不要只比較 final answer：

```text
FailureSignature
├ violated_invariant
├ first_divergence_step
├ bad_action
├ bad_tool_call
├ bad_world_state
├ policy_order_inversion
├ reward_gap
└ causal_failure_node
```

這能避免「輸出碰巧改對了，但內部同一漏洞仍在」。

---

# Visual Simulation Idea

## Simulator Red-Team Arena × Counterexample Regression Lab

主畫面同時顯示：

```text
NORMAL PLANNER                 RED-TEAM PLANNER
     │                               │
     ▼                               ▼
 nominal tree                  adversarial tree
     │                               │
     └──────── WORLD MODEL ──────────┘
                     │
                     ▼
              TRUSTED VERIFIER
```

每個 branch 顯示：

```text
Predicted Return
Trusted Return
Exploit Gap
Safety Risk
Realism
Perturbation Distance
Oracle Status
```

找到 failure 後，右側進入 **Counterexample Minimizer**：

```text
Original failure
18 agents
64 actions
6 perturbations

↓ MINIMIZE

Minimal failure
2 agents
7 actions
1 timing change
```

最後自動產生 regression card：

```text
CASE WM-EXP-0042

Failure:
Planner selects trajectory A
because model predicts +82
trusted simulator reports -37

Minimal trigger:
NPC_B delay +420 ms

Severity: HIGH
Reproducibility: 10/10

v1.8.2 FAIL
v1.8.3 FAIL
v1.9.0 PASS
v1.9.1 PASS
```

最有價值的互動控制：

```text
Search Budget
Planner Strength
Perturbation Distance
Realism Constraint
Trusted Oracle
Model Version
```

讓使用者看到：Planner 越強時，新的 exploit 是否反而增加。

---

# Code / GitHub

## 1. DeepExperience/agent2world

Repository: https://github.com/DeepExperience/agent2world

### 值得看的目錄

```text
src/agentic_world_model/
src/toolkits/
src/models/
scripts/
```

### 最值得看的檔案

```text
src/agentic_world_model/agentic_world_framework.py
src/agentic_world_model/mcts_gen.py
src/agentic_world_model/consistency/*
```

### 原始碼確認到的 runtime loop

`initialize_agent()` 建立：

```text
research
code
play
pytest
sandbox
```

`agent2world_gen_code()`：

```text
research_report
↓
code generation
↓
save executable world model
↓
play_env test
+
pytest test
↓
feedback
↓
reset agents
↓
repair code
```

最大迭代輪數受控，因此不是無限 self-debug loop。

### Hermes 值得借的不是 UI，而是 testing decomposition

```text
Contract Tester
Behavior Tester
Red-Team Tester
Oracle Verifier
Regression Manager
```

---

## 2. QwenLM/Qwen-AgentWorld

Repository: https://github.com/QwenLM/Qwen-AgentWorld

目前公開 repository 主要可見：

```text
eval/
prompts/
assets/
README.md
```

Qwen-AgentWorld 將 language world model 延伸到 MCP、Search、Terminal、SWE、Android、Web、OS 等 agent environment，研究上值得下一輪深入它的 evaluation interface，因為這代表本輪 counterexample/regression 概念可直接跨出 robotics，進入「工具與電腦 Agent 的世界模型」。

目前不應假設 repository 已公開完整 training runtime；本輪只把可公開驗證的 eval/prompt surface 納入。

---

# Papers

## 1. World Models as Adversaries

- **Title:** World Models as Adversaries: Multi-Agent Self-Play Fine-Tuning for Robust Motion Planning
- **Authors:** Tong Nie, Yuewen Mei, Junlin He, Yihong Tang, Jian Sun, Wei Ma
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.10630
- **Dataset / Benchmark:** nuPlan, InterPlan
- **Architecture:** role-conditioned adversarial world model + sparse adaptive attack coalition + regret-aware robust best response
- **Contribution:** 將 predictive world model 本身轉成 self-play adversary，不需完全依賴外部 scenario generator。
- **Limitations:** 主要驗證於 motion planning；對 Web/MCP/LLM tool runtime 的可轉移性仍需實驗。
- **改變了什麼:** world model 從 passive simulator 變成 active adversarial test generator。

## 2. CounterScene

- **Title:** CounterScene: Counterfactual Causal Reasoning in Generative World Models for Safety-Critical Closed-Loop Evaluation
- **Authors:** Bowen Jing, Ruiyang Hao, Weitao Zhou, Haibao Yu
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2603.21104
- **Dataset:** nuScenes；zero-shot transfer 到 nuPlan
- **Architecture:** causal adversarial agent identification + interaction graph + conflict-aware world model + stage-adaptive counterfactual guidance
- **Contribution:** 對 causally critical actor 做最小 counterfactual intervention，在 realism 與 adversarial effectiveness 間取得更好的平衡。
- **Limitations:** driving-specific causal representation；不同 task 的 causal-distance 定義要重建。
- **改變了什麼:** red team 從 heuristic perturbation 升級成 causal counterexample generation。

## 3. Agent2World

- **Title:** Agent2World: Learning to Generate Symbolic World Models via Adaptive Multi-Agent Feedback
- **Authors:** Mengkang Hu et al.
- **Institution:** Hong Kong / industrial-academic collaboration（依論文作者機構）
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2512.22336
- **Code:** https://github.com/DeepExperience/agent2world
- **Benchmarks:** Text2World, ByteSized32, Code World Models Benchmark
- **Architecture:** Deep Researcher → Model Developer → Testing Team → Repair
- **Contribution:** execution-grounded multi-agent validation；Testing Team 產生的 repair trajectories 亦可用於 SFT，論文報告 fine-tuning 後平均 relative gain 30.95%。
- **Limitations:** generated simulator 是否具有 adversarial robustness 並非主要研究目標；tester 與 developer 仍可能共享 LLM blind spots。
- **改變了什麼:** world-model generation 從 one-shot code synthesis 變成 software-style adaptive test-and-repair process。

## 4. AutoControl Arena

- **Title:** AutoControl Arena: Synthesizing Executable Test Environments for Frontier AI Risk Evaluation
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2603.07427
- **Architecture:** executable deterministic logic + generative narrative/dynamics + multi-agent test-environment synthesis
- **Contribution:** logic-narrative decoupling，降低 LLM simulator logic hallucination；將 Stress / Temptation 系統化作為風險控制軸。
- **Limitations:** executable logic 本身仍可能 specification-incomplete。
- **改變了什麼:** 提醒 safety simulator 的 oracle 不應與 narrative generator 綁死。

## 5. Security of World-Model-Based Embodied AI

- **Title:** Security of World-Model-Based Embodied AI: A Lifecycle of Threats, Defenses, and Evaluation
- **Authors:** Fazhong Liu et al.
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.28226
- **Architecture:** lifecycle threat taxonomy covering data → representation → grounding → imagination → trajectory evaluation → execution → adaptation
- **Contribution:** 把 world model 本身視為 security boundary，整理 poisoning、backdoor、sensor spoofing、trajectory manipulation 等攻擊如何跨層傳播。
- **Limitations:** survey / framework 性質，未提供單一可直接部署的 regression runtime。
- **改變了什麼:** simulator red-team 不能只測 planner output，也要追 world-model lifecycle provenance。

---

# 已確認事實 / 工程實作 / 合理推論 / 尚未驗證假說

## 已確認事實

- Agent2World 公開原始碼確實將 code generation、play test、pytest test 分成不同 agent/runtime component。
- AWM 論文將 predictive world model 轉換成 role-conditioned adversary，並採 inner adversary / outer planner 的 robust self-play 結構。
- CounterScene 使用 causal-critical agent identification 與 minimal counterfactual guidance 產生 safety-critical scenario。

## 論文結果

- Agent2World 論文報告其 repair trajectories 用於 fine-tuning 後，world-model generation 平均 relative gain 30.95%。
- CounterScene 論文報告在其 driving evaluation 中提升 adversarial collision discovery，同時維持較佳 trajectory realism。
- AWM 在 nuPlan / InterPlan 報告可產生 transferable adversarial interactions 並提升 long-tail robust planning。

## 工程推論

- Hermes 可以將 Agent2World 的 `play + pytest` decomposition 擴成 `contract + behavior + adversarial + oracle` 四測試面。
- CounterScene 的 minimal causal intervention 可泛化成 MCP schema mutation、tool-result mutation、memory-state mutation，但需要 task-specific causal graph。

## 尚未驗證假說

- 同一個 cross-domain Red-Team Planner 是否能同時有效攻擊 Browser、Coding、MCP、Robot world models。
- policy-order inversion score 是否比一般 failure rate 更適合作為 Hermes 的 universal exploitability ranking。
- 使用 LLM tester 產生 counterexample 後，再使用完全不同模型作 verifier，能否顯著降低 shared blind spot。

---

# Unknown / Open Questions

## 1. Trusted oracle 從哪裡來？

Robot 可用高保真 simulator / real replay；Coding 可執行 tests；MCP 可真正 call tool；Browser 可檢查 DOM / backend state。但 open-world planning 並沒有完整 oracle。

下一步需要建立：

```text
OracleHierarchy
├ deterministic executable
├ symbolic invariant
├ trusted simulator
├ model ensemble
├ real environment
└ human adjudication
```

## 2. 如何測 shared blind spot？

如果 Planner、World Model、Red Team、Judge 都是同一 foundation model family，整套 validation 可能共同漏掉同一 failure。

需要：

```text
VerifierDiversityScore
ModelFamilyIndependence
OracleProvenance
```

## 3. Counterexample corpus 如何避免退化成 memorization benchmark？

需要同一 failure family 產生變體：

```text
minimal seed
↓
semantic mutation
↓
causal mutation
↓
parameter sweep
↓
OOD neighborhood
```

並把「固定 case pass」與「failure family robustness」分開評分。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
SimulatorRedTeam
RedTeamPlanner
CounterexampleTrajectory
MinimalCounterexample
CounterexampleMinimizer
ExploitabilityCorpus
SafetyRegressionCase
SafetyRegressionSuite
PolicyOrderingInversionTest
PlannerWorldModelGap
TrustedOracle
OracleHierarchy
OracleProvenance
BehavioralOracle
InvariantOracle
MetamorphicOracle
FailureSignature
FirstDivergenceStep
CounterexampleMutation
FailureFamily
FailureNeighborhood
RegressionReplay
RegressionDiff
SharedBlindSpot
VerifierDiversity
AdversarialWorldModelRole
CausalScenarioIntervention
StressAxis
TemptationAxis
```

## Edges

```text
World Model
→ Can Become Adversarial Scenario Generator

Planner Search Pressure
→ Supplies Red-Team Objective

Policy Ordering Inversion
→ Defines High-Value Counterexample

Minimal Causal Intervention
→ Improves Counterexample Interpretability

Counterexample
→ Must Be Independently Verified

Verified Counterexample
→ Becomes Safety Regression Case

Safety Regression Case
→ Persists Across Model Versions

Historical Benchmark Improvement
≠ Safety Regression Closure

Unit-Test Pass
≠ Behavioral Correctness

Behavioral Correctness
≠ Policy-Ordering Safety

Same-Model Tester
→ Can Share Blind Spots

Verifier Diversity
→ Reduces Shared-Blind-Spot Risk

Failure Minimization
→ Improves Root-Cause Localization

Counterexample Mutation
→ Tests Failure-Family Robustness
```

---

# 下一輪研究

下一輪應進入：

# **Oracle Design × Metamorphic Testing × Differential World Models × Cross-Model Verifier Diversity**

現在已經有：

```text
World Model
↓
Red-Team Search
↓
Counterexample
↓
??? trusted verification
↓
Regression
```

真正下一個瓶頸是 `???`。

要深入研究：

```text
metamorphic testing
property-based testing
symbolic invariants
differential testing
N-version world models
cross-family model judging
real-tool execution oracle
simulation-to-reality oracle gap
human escalation criteria
```

並建立：

```text
OracleContract
OracleHierarchy
DifferentialWorldModelTest
MetamorphicRelationRegistry
VerifierDiversityCertificate
OracleDisagreementEvent
OracleCalibrationProfile
```

---

# 每輪結束判定

**缺哪一層：** 目前最缺 `Trusted Oracle / Differential Verification Layer`。  

**哪個節點最淺：** `TrustedOracle`、`SharedBlindSpot`、`FailureFamilyRobustness`、`VerifierDiversity`。  

**哪個概念仍只是名詞：** production 級跨 domain `Universal Simulator Exploitability Score`；目前不同環境仍需要不同 reward/risk/oracle contract。  

**哪個系統值得讀原始碼：** `DeepExperience/agent2world`，下一步優先讀 `mcts_gen.py`、`consistency/`、toolkit 的 `play_env`，再比較 AutoControl Arena 是否公開 executable environment synthesis runtime。  

**哪篇論文需追引用：** `World Models as Adversaries` 與 `CounterScene`；前者回答 adversarial self-play，後者回答 causal/minimal counterexample。  

**哪個概念最適合視覺模擬：** `Simulator Red-Team Arena × Counterexample Regression Lab`。  

**哪個 Agent 架構最值得實作：**

```text
Baseline Planner
        ↕
World Model
        ↕
Red-Team Planner
        ↓
Counterexample Generator
        ↓
Independent Oracle
        ↓
Failure Minimizer
        ↓
Safety Regression Suite
        ↓
Repair / Retraining
        ↓
Release Gate
```

---

# 對「AI 到底怎麼運作」新增的答案

前幾輪已還原：

```text
Observation
→ Belief
→ World Model
→ Dream Rollout
→ Planner
→ Action
```

這輪補上「可靠 AI 為何不能只會規劃」：

```text
AI 先建立世界模型
↓
Planner 在模型裡找最佳未來
↓
另一個 Red-Team Planner 刻意找模型最可能被利用的未來
↓
Trusted Oracle 驗證那個未來到底是真的好，還是 simulator 幻覺
↓
找到最小反例
↓
反例永久進入 Regression Suite
↓
之後每次模型更新都重播
```

因此真正成熟的 AI 系統不只是「會想像未來」，而是還要有一套**持續攻擊自己的想像、驗證自己的想像、記住自己曾經錯過哪些危險未來**的機制。

從系統工程角度看，這表示 World Model 不能只是一個 neural module；它最終需要像正式軟體 runtime 一樣，擁有測試、反例、版本、回歸、oracle 與 release gate。只有這樣，「Agent 在腦中模擬世界」才能從聰明的 demo，逐步接近可驗證的決策基礎設施。