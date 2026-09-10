# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-10 20:59（Asia/Taipei）  
**主題**：Feedback Stability × Cyclic Risk Propagation × Spectral Radius × Lyapunov / Circuit-Breaker Control × Multi-Agent Safety

## 與歷史研究比較

前幾輪已建立 Sequential Risk Ledger、EvidenceRootID、Risk Dependency Graph、Common-Cause Failure、Counterfactual Root Validation 與 Multi-Agent Risk Authority Tree。本輪不再重複 DAG 式因果傳播，而專門補上此前最淺的一層：**當 Agent / Planner / Memory / Tool / 多代理之間形成循環依賴時，小誤差會衰減、震盪，還是被持續放大？Runtime 要怎麼在失控前判定並切斷 feedback loop？**

---

## 本小時新發現

### 新論文 / 架構
1. **Self-Correction as Feedback Control: Error Dynamics, Stability Thresholds, and Prompt Interventions in LLMs** — Aofan Liu, Jingxiang Meng, 2026, arXiv:2604.22273。把反覆 self-correction 視為 closed-loop feedback，使用 Correct/Incorrect 二狀態 Markov model，以 Error Introduction Rate（EIR）和 Error Correction Rate（ECR）建立可測 deployment threshold：只有在 `ECR/EIR > Acc/(1-Acc)` 時才應繼續反覆修正。作者在 7 個模型、GSM8K/MATH/StrategyQA 測試；verify-first intervention 將 GPT-4o-mini 的 EIR 從 2% 降到 0%，把 -6.2pp degradation 轉成 +0.2pp。來源：https://arxiv.org/abs/2604.22273
2. **Collective Hallucination in Multi-Agent LLMs: Modeling and Defense** — Saeid Jamshidi, 2026, arXiv:2606.07941。把 hallucination 視為 communication graph 上的 time-evolving propagation process，使用 spectral / reproduction-number 類指標描述 recursive amplification；HPR-Adaptive 透過 trust weighting、external verification、interaction regulation、selective isolation，把實驗中的 reproduction number 從 1.08 壓至 0.81，讓 propagation 從自我維持轉成 attenuation。來源：https://arxiv.org/abs/2606.07941
3. **From Spark to Fire: Modeling and Mitigating Error Cascades in LLM-Based Multi-Agent Collaboration** — Yizhe Xie et al., 2026, arXiv:2603.04474。將 collaboration 建成 directed dependency graph，指出 cascade amplification、topological sensitivity、consensus inertia，並用 genealogy-graph message-layer governance 壓制 error seed 的擴散。來源：https://arxiv.org/abs/2603.04474
4. **Lyapunov-guided cooperative games enable stable constraint fusion in LLM-based multi-agent autonomous systems** — Zeling Xu, Qianqi Zhang, Dagang Li, Yuntao Zou et al., npj Artificial Intelligence, 2026。Hong Kong University of Science and Technology / Macau University of Science and Technology / Huazhong University of Science and Technology。把多代理 constraint fusion 建成 dynamical-system stability problem，以 Lyapunov function 彙整 constraint deviation、model predictive control 搜尋 Pareto-improving direction，再透過 token probability penalty 執行介入；nuScenes + Llama3:8B 中 constraint satisfaction rate 相較最佳 baseline 提高 7.0%。來源：https://www.nature.com/articles/s44387-026-00110-5
5. **Consensus and Cooperation in Networked Multi-Agent Systems** — Olfati-Saber, Fax, Murray, Proceedings of the IEEE, 2007。是本輪的 control-theory 基礎來源：network topology、matrix spectrum、directed information flow、delay 與 consensus convergence 之間存在可分析的結構關係。來源：https://doi.org/10.1109/JPROC.2006.887293

### 新 GitHub / 工程實作
- `topcheer/ggcode/internal/agent/self_correction_gate.go` 已將 EIR/ECR stability gate 實作成 Agent runtime 控制：累積 NEW / RESOLVED / PERSISTENT errors，至少 3 個 correction rounds 後才判定，ratio 過低時發出停止盲目 self-correction 的 guidance。它是一個有價值的工程參考，但其固定 threshold `1.2` 是專案方基於假設做出的工程調整，不等於原論文定理本身。
- 同 repo 的 `verify_regression.go`、`recurring_error.go`、`loop_detect.go` 值得下一輪繼續讀，因為它們分別對應 regression classification、same-error persistence 與 identical-tool/error streak；三者結合才接近真正 feedback loop observability。

---

# 本小時最重要 5 個發現

## 1. DAG Risk Propagation ≠ Cyclic Risk Stability

前一輪可以表示：

```text
Evidence E
→ Observation
→ Plan
→ Tool
→ Effect
```

但真實 Agent runtime 更常是：

```text
Planner
→ Tool
→ Observation
→ Memory
→ Planner
```

或：

```text
Agent A
→ Agent B
→ Agent C
→ Agent A
```

因此真正的 stability 問題不是「錯誤會傳到誰」，而是：

```text
error_t
→ feedback gain
→ error_t+1
→ feedback gain
→ error_t+2
```

若 local linearization 近似為：

```text
x_{t+1} = G x_t + ε_t
```

則 `G` 的 dominant modes 決定 perturbation 是否衰減。控制理論中 spectral radius / eigenstructure 是分析 network feedback 的核心工具；但對 LLM Agent，`G` 通常不是固定線性矩陣，而是由 prompt、confidence、topology、context、tool outcomes 共同形成的時變、非線性 operator。因此 **spectral radius 在 Hermes 中應被視為局部 / 近似 diagnostic，不應假裝成完整穩定性證明。**

## 2. Self-Correction 本身就是 Feedback Controller

Self-correction loop：

```text
Draft
→ Critique
→ Revision
→ Critique
→ Revision
```

並不天然穩定。底層可拆成：

```text
Current correctness state
→ Reviewer observation
→ Correction action
→ New correctness state
```

EIR 表示 correction round 新增錯誤的機率 / 率；ECR 表示 correction 能消除既有錯誤的能力。當 correction 對 error 的「負回饋」小於自己引入的新 error，loop 會成為 net-positive error generator。

重要性：Reflection / Reflexion / self-review / repair loop 不應預設「多跑幾輪一定更好」。

限制：二狀態 Markov abstraction 無法完整表示不同錯誤類型、shared evidence root、severity、tool-side effects，以及 multi-agent recursive coupling。

## 3. Reproduction Number 是比「單步風險」更直觀的 Cascade 指標

Multi-agent hallucination propagation 可以借 epidemic / branching intuition：

```text
R_error < 1
→ 一個 error 平均衍生不到一個持續 error
→ 衰減

R_error ≈ 1
→ critical / long-lived

R_error > 1
→ self-sustaining cascade
```

`Collective Hallucination` 的實驗把 reproduction number 壓到 0.81，對 Hermes 很有啟發：可以把 `Effective Error Reproduction Number` 做成 runtime dashboard。但它必須由 evidence lineage / adoption / propagation events 估計，不能直接拿模型 confidence 拼一個看似精確的數字。

## 4. Stability Control ≠ 把 Agent 全部關掉

可用的控制手段至少分成：

```text
DAMP
降低 peer influence / memory trust / retry gain

VERIFY
引入外部 evidence，破除 self-referential loop

ISOLATE
暫時切斷高-risk node / edge

REWIRE
改變 communication topology

RESET
回到 last grounded checkpoint

CIRCUIT BREAK
停止 loop / effect authority
```

Nature 2026 的 Lyapunov-guided framework 特別重要：不是只做 end-of-run checker，而是在 generation / coordination 過程中持續測 constraint deviation，並透過控制介面把系統拉回 feasible region。這提示 Hermes 的 stability controller 應該位於 runtime control plane，而不是最後才做 report。

## 5. Feedback Gain 必須追到「資訊來源與控制作用」兩個方向

同一條 edge 應有至少兩種權重：

```text
Information Influence Gain
Agent A 的輸出多大程度改變 B 的 belief / context

Control / Effect Gain
B 的改變多大程度會影響真實世界或再回饋到 A
```

例如：

```text
VLM hallucination
→ Planner target
→ Browser click
→ New screenshot
→ VLM
```

這裡不是單純 semantic error propagation，而是 **perception-action feedback loop**：錯誤 perception 造成 action，action 改變下一個 perception，形成 embodied / computer-agent closed loop。多模態 Agent 因此尤其需要 feedback stability，而不只是文字 consensus safety。

---

# Architecture Breakdown

## Hermes Feedback-Stability Control Plane

```text
User / Camera / Voice / Browser / MCP
↓
Observation + EvidenceRootID
↓
Belief / Context / Memory
↓
Planner / Agent Network
↓
Candidate Action
↓
Tool / MCP / Computer
↓
Environment State
↓
New Observation
↺
```

旁路建立：

```text
Runtime Trace
↓
Feedback Graph Builder
↓
Strongly Connected Component Detector
↓
Loop State Estimator
├ error introduction
├ error correction
├ semantic drift
├ tool retry recurrence
├ belief oscillation
├ effect recurrence
└ resource amplification
↓
Local Gain Estimator
↓
Stability Diagnostics
├ EIR/ECR
├ R_error
├ SCC amplification
├ spectral proxy
├ oscillation score
└ convergence rate
↓
Stability Controller
├ PASS
├ DAMP
├ VERIFY
├ REWIRE
├ ISOLATE
├ ROLLBACK
└ CIRCUIT_BREAK
↓
Commitment Gate
```

### 最重要的新 runtime object

```text
FeedbackLoopState
├ loop_id
├ scc_nodes[]
├ scc_edges[]
├ evidence_roots[]
├ error_introduction_rate
├ error_correction_rate
├ effective_reproduction_number
├ local_gain_estimate
├ spectral_proxy
├ oscillation_score
├ convergence_rate
├ resource_growth_rate
├ critical_effects[]
├ last_grounded_checkpoint
└ control_mode
```

---

# Bottom-Level Logic

## 一個 feedback loop 應如何被辨認

```text
Runtime events
→ Build directed dependency graph
→ Update temporal edges
→ Run SCC decomposition
→ Keep SCCs with recurrent execution
→ Measure state/error deltas per round
→ Estimate gain / correction / reproduction
→ Detect:
   - convergence
   - persistent limit cycle
   - amplification
   - retry storm
   - semantic drift
→ choose control
```

### SCC 是關鍵

若 graph 是 DAG，就不存在真正的 feedback cycle。對任一 runtime dependency graph：

```text
Strongly Connected Component size > 1
```

或 self-loop：

```text
node → same node
```

才形成結構上的 feedback 候選。

但是：

```text
SCC exists
≠ unstable
```

穩定的 iterative refinement 也是 SCC。真正需要再量：

```text
error magnitude round-to-round
state distance
belief KL / semantic drift
new-vs-resolved errors
repeated tool/effect pattern
resource growth
```

## 局部 spectral diagnostic

工程上可對 SCC 建一個 influence matrix：

```text
G_ij = estimated influence from node j to node i
```

然後估：

```text
ρ(G)
```

初步解讀：

```text
ρ < 1   → local perturbation likely attenuates
ρ ≈ 1   → near-critical / slow convergence
ρ > 1   → amplification risk
```

但必須標記為：**合理工程近似 / local diagnostic，不是對非線性 stochastic LLM runtime 的全域穩定性保證。**

## Error Reproduction Number

```text
R_error(t)
=
new dependent erroneous states at t+1
/
active causal erroneous states at t
```

再用 EvidenceRootID 去重，避免同一錯誤被 downstream copies 人為放大計數。

## Multi-Modal Closed Loop

```text
Camera Frame
→ Vision Encoder / VLM
→ Observation Hypothesis
→ Belief
→ Planner
→ Robot / Browser Action
→ Environment Change
→ Camera Frame'
```

底層至少要量兩個 gain：

```text
Perception Gain:
world perturbation → observation error

Action Gain:
observation error → action deviation
```

兩者相乘才接近 perception-action loop 的 effective gain。

---

# Visual Simulation Idea

## Feedback Stability & Spectral Loop Lab

主視覺是一個會動的 Agent feedback graph：

```text
[Camera]
   ↓ .6
[VLM]
   ↓ .8
[Planner]
   ↓ .9
[Browser]
   ↓
[Page State]
   └────────→ [Camera]
```

右側即時顯示：

```text
SCC-7
Nodes                 5
Evidence Roots        2
EIR                  .07
ECR                  .03
ECR/EIR              .43  FAIL
R_error              1.31  AMPLIFYING
Spectral proxy       1.18  UNSTABLE-RISK
Oscillation          HIGH
Token growth         +23% / round
Effect authority     WRITE
```

使用者可以切換：

```text
DAMP EDGE
ADD VERIFIER
REMOVE HUB
INSERT HUMAN CHECK
LOWER RETRY GAIN
FREEZE MEMORY WRITE
CUT TOOL EFFECT
ROLLBACK
```

再看指標如何變：

```text
Before
ρ ≈ 1.18
R_error = 1.31

After verification + edge damping
ρ ≈ 0.74
R_error = 0.63
```

### 最有教育價值的模擬

```text
Round 1: tiny wrong claim
Round 2: Agent B repeats it
Round 3: Agent C cites B
Round 4: Reviewer sees 3-agent consensus
Round 5: Memory writes it as fact
Round 6: Planner treats memory as ground truth
```

UI 顯示：

```text
FALSE CONSENSUS LOOP
Independent Evidence Roots = 1
Feedback Copies = 5
```

然後插入一個 external verification edge：

```text
External Evidence
→ contradiction
→ trust decay
→ R_error < 1
→ loop dies out
```

---

# Code / GitHub

## 值得讀的核心檔案

### topcheer/ggcode

```text
internal/agent/self_correction_gate.go
internal/agent/verify_regression.go
internal/agent/recurring_error.go
internal/agent/loop_detect.go
```

`self_correction_gate.go` 已做：

```text
NEW / RESOLVED / PERSISTENT
→ round aggregation
→ EIR / ECR proxy
→ ratio
→ stability warning
```

值得 Hermes 借的是「stability gate 做進 runtime」這個模式，而不是照搬固定 `1.2` threshold。

## 建議 Hermes 新增模組

```text
src/research-runtime/stability/
├ feedback-graph.ts
├ scc-detector.ts
├ loop-state.ts
├ gain-estimator.ts
├ reproduction-number.ts
├ oscillation-detector.ts
├ stability-controller.ts
├ circuit-breaker.ts
└ stability-types.ts
```

以及 UI：

```text
src/components/research/
└ FeedbackStabilityLab.tsx
```

這是架構建議，尚未在本輪修改 production code。

---

# Papers

## 1. Self-Correction as Feedback Control: Error Dynamics, Stability Thresholds, and Prompt Interventions in LLMs
- Authors: Aofan Liu, Jingxiang Meng
- Year: 2026
- Institution: 本輪來源未能可靠確認，暫不猜測
- URL: https://arxiv.org/abs/2604.22273
- Code: 未確認作者官方 code
- Dataset: GSM8K, MATH, StrategyQA
- Architecture: two-state Correct/Incorrect Markov feedback model; EIR/ECR diagnostic
- Contribution: 將 self-correction 是否值得繼續變成可測的 stability decision
- Limitation: 二狀態 abstraction；未涵蓋多代理 topology、multimodal evidence、tool effects
- 改變了什麼: Reflection 不再能被當作單調改善機制，而應受 runtime gate 控制

## 2. Collective Hallucination in Multi-Agent LLMs: Modeling and Defense
- Authors: Saeid Jamshidi
- Institution: Polytechnique Montréal（由公開作者資訊交叉確認）
- Year: 2026
- URL: https://arxiv.org/abs/2606.07941
- Code: 本輪未確認官方 code
- Dataset: TruthfulQA, TriviaQA
- Architecture: directed interaction graph + propagation / reproduction dynamics + adaptive defense
- Contribution: 把 recursive hallucination 從 node error 提升成 network propagation stability
- Limitation: 主要是 claim/factual hallucination；對 real tool/effect loops 尚不足
- 改變了什麼: 讓 R_error / reproduction number 成為 Agent runtime 可能的可觀測指標

## 3. From Spark to Fire: Modeling and Mitigating Error Cascades in LLM-Based Multi-Agent Collaboration
- Authors: Yizhe Xie, Congcong Zhu, Xinyue Zhang, Tianqing Zhu, Dayong Ye, Minfeng Qi, Huajie Chen, Wanlei Zhou
- Year: 2026
- URL: https://arxiv.org/abs/2603.04474
- Code: 本輪未確認官方 code
- Dataset / evaluation: 六種主流 multi-agent frameworks 的 propagation experiments
- Architecture: directed dependency graph + genealogy graph governance
- Contribution: cascade amplification / topological sensitivity / consensus inertia
- Limitation: 仍較偏 dependency propagation，真正 dynamic closed-loop stability 還需補上
- 改變了什麼: 提供從 DAG lineage 走向 cyclic stability analysis 的直接前置基礎

## 4. Lyapunov-guided cooperative games enable stable constraint fusion in LLM-based multi-agent autonomous systems
- Authors: Zeling Xu, Qianqi Zhang, Dagang Li, Yuntao Zou et al.
- Institutions: HKUST; Macau University of Science and Technology; Huazhong University of Science and Technology
- Year: 2026
- URL: https://www.nature.com/articles/s44387-026-00110-5
- Code: 本輪未確認官方 code
- Dataset: nuScenes（1000 real-world driving sequences; 6 cameras, 1 LiDAR, 5 radars）
- Model: Llama3:8B
- Architecture: Lyapunov constraint state + cooperative differential game + MPC + token-probability intervention
- Contribution: 把 multi-agent constraint coordination 改寫成 stability/convergence problem
- Limitation: 作者明確說明並非 exact Lyapunov stability certificate，而是使用 Lyapunov function 作 design tool
- 改變了什麼: 提示 Hermes stability controller 可以直接介入 generation/control plane，而非只做 post-hoc check

---

# 已確認事實 / 工程實作 / 合理推論 / 尚未驗證假說

## 已確認事實
- recursive multi-agent interaction 可能造成 error reinforcement / false consensus；2026 多篇研究已對此建立 propagation model。
- self-correction 在部分模型 / benchmark 上確實會變差，並非單調改善。
- network topology 與 consensus / diffusion dynamics 有經典 control-theory / graph-theory 理論基礎。
- Lyapunov-guided LLM multi-agent constraint fusion 已有 2026 peer-reviewed 實驗，但該工作不是 exact stability certificate。

## 工程實作
- ggcode 已把 EIR/ECR-inspired self-correction gate 做進 runtime。

## 合理推論
- Hermes 可對 runtime SCC 建 local influence matrix，再用 spectral radius 作 near-real-time amplification diagnostic。
- Effective Error Reproduction Number 可配合 EvidenceRootID 去重，作為比平均 confidence 更具系統意義的 cascade signal。

## 尚未驗證假說
- `ρ(G) > 1` 是否能在 heterogeneous LLM + tool + multimodal runtime 上穩定預測實際 failure cascade，尚未建立普適 empirical calibration。
- 各種 Agent framework 之間是否能共享同一套 influence-weight ABI，尚未驗證。
- Perception gain × action gain 是否足以描述 embodied/computer-agent loop 的實際 instability，只能視為初步 local approximation。

---

# Unknown / Open Questions

1. 如何從離散、語義型 Agent event 穩健估計 `G_ij` influence gain，而不是靠 LLM 自評？是否應用 intervention replay、ablation、Jacobian-like finite difference、mutual information，或 causal attribution？
2. 對高度非線性、time-varying、stochastic Agent graph，spectral radius 只適合 local approximation。Hermes 需要什麼更可靠的 online stability certificate？Lyapunov surrogate、contraction metric、e-process，還是 empirical fault-envelope？
3. Multi-agent quarantine / circuit breaker 如何避免把一個 critical but noisy verifier 錯誤隔離，反而讓 false consensus 更穩定？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Feedback Loop
Closed-Loop Agent Runtime
Strongly Connected Component
Feedback Gain
Influence Matrix
Spectral Radius
Local Stability Diagnostic
Oscillation
Limit Cycle
Convergence Rate
Error Reproduction Number
Self-Correction Stability
Error Introduction Rate
Error Correction Rate
Lyapunov Surrogate
Constraint Deviation State
Damping Controller
Verification Injection
Agent Isolation
Topology Rewiring
Loop Circuit Breaker
Perception-Action Loop
Perception Gain
Action Gain
Feedback Resource Amplification
```

## Edges

```text
Risk Dependency Graph
→ contains
Strongly Connected Component

Strongly Connected Component
→ forms
Feedback Loop

Feedback Loop
→ characterized_by
Feedback Gain

Influence Matrix
→ approximated_by
Runtime Intervention Data

Spectral Radius
→ indicates
Local Amplification Risk

Error Reproduction Number
→ measures
Error Self-Sustainment

Verification Injection
→ reduces
Feedback Gain

Selective Isolation
→ removes
Propagation Edge

Circuit Breaker
→ terminates
Unstable Loop

Perception Error
→ influences
Action Deviation

Action Deviation
→ changes
Next Observation
```

## 新增否定關係

```text
Dependency Propagation ≠ Feedback Stability
SCC ≠ Instability
Consensus ≠ Correctness
More Reflection ≠ Better Answer
Spectral Radius Proxy ≠ Global Stability Proof
Low Single-Step Risk ≠ Stable Closed Loop
Repeated Agreement ≠ Independent Evidence
Oscillation ≠ Random Noise
Circuit Breaking ≠ System Safety By Itself
Lyapunov-Guided Design ≠ Exact Lyapunov Certificate
```

---

# 下一輪研究

下一輪最應研究：

## **Online Influence Estimation × Intervention-Based System Identification × Causal Gain Matrix × Adaptive Stability Controller**

因為本輪已經知道「需要 G / gain / reproduction number」，但目前最大缺口是：**真實 Agent runtime 裡這些權重到底怎麼量。**

應拆成：

```text
Runtime Trace
→ Candidate Edge
→ Controlled Perturbation / Counterfactual Replay
→ Measure downstream state delta
→ Estimate causal influence
→ Confidence interval
→ Time decay
→ Dynamic Gain Matrix G_t
→ Stability diagnostic
→ Adaptive damping / verification / rewiring
```

並比較：
- finite-difference intervention
- causal mediation / attribution
- information flow metrics
- Granger-style temporal influence（僅作 predictive, 不等同 causality）
- Jacobian approximation around Agent state
- black-box system identification
- robust / adaptive control under uncertain dynamics

---

# 本輪收斂回答

- **缺哪一層**：Online Causal Influence / Gain Estimation。
- **哪個節點最淺**：`Influence Matrix G_t` 的實際 measurement / calibration。
- **哪個概念仍只是名詞**：Cross-Framework Agent Feedback Gain ABI、Global Stability Certificate。
- **哪個系統值得讀原始碼**：`topcheer/ggcode` 的 `self_correction_gate.go`、`verify_regression.go`、`recurring_error.go`、`loop_detect.go`。
- **哪篇論文需追引用**：Self-Correction as Feedback Control；Collective Hallucination；From Spark to Fire；Lyapunov-guided cooperative games；Olfati-Saber/Fax/Murray consensus paper。
- **哪個概念最適合視覺模擬**：Feedback Stability & Spectral Loop Lab。
- **哪個 Agent 架構最值得實作**：**Feedback-Stabilized Agent Runtime = Runtime Causal Trace + SCC Detector + EIR/ECR + Error Reproduction Number + Local Gain/Spectral Diagnostic + Verification/Damping/Rewiring + Circuit Breaker + Grounded Rollback。**

---

## 對最終「AI 到底怎麼運作」知識圖的新增位置

```text
使用者一句話
→ UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tools / MCP
→ Environment
→ Observation
↺ 回到 Context / Reasoning
```

以前這條總圖容易被畫成直線；本輪確認真正 Autonomous Agent 的核心其實是**閉環系統**。AI 不只是一次把輸入轉成輸出，而是反覆：

```text
Observe
→ Infer
→ Decide
→ Act
→ Change World
→ Observe Again
```

多模態則是：

```text
Camera / Image / Voice / Video
→ Encoder / Tokens
→ Fusion
→ Belief / Reasoning
→ Agent
→ Action
→ World Changes
→ New Camera / Voice / Video
↺
```

因此回答「AI 到底怎麼運作」時，除了 Transformer / Tool / Memory，還必須加入一個先前常被忽略的核心：**Feedback Dynamics。Agent 的真正能力與失敗，都不是單步函數，而是閉環互動長時間累積後的系統行為。**
