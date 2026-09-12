# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 16:53（Asia/Taipei）**  
**主題：World-Model Uncertainty Propagation × OOD State Detection × Sim-to-Real Calibration × Learned Tool Twin × Counterfactual Outcome Confidence**

## 與歷史研究比較

上一輪已完成：可 fork 的 executable digital twin、stateful DB/browser/world branch、virtual time、response authority ladder、twin calibration envelope。上一輪最大的未解缺口是：**當 counterfactual trajectory 離開已驗證 state-action support 時，Twin 的輸出還能信多少？**

本輪不再重複 snapshot/fork，而是專注把「Twin 可執行」推進到「Twin 的不確定性可量化、可傳播、可拒絕 extrapolation」。

核心新增鏈：

```text
Real Logs / Tool Traces
↓
State-Action Dataset
↓
Learned / Deterministic Twin
↓
Transition Distribution
├ aleatoric uncertainty
└ epistemic uncertainty
↓
OOD / support test
↓
Multi-step uncertainty propagation
↓
Planner sensitivity
↓
Sim-to-real calibration
↓
Counterfactual Outcome Confidence
↓
ACCEPT / SHORTEN / VERIFY / BLOCK
```

---

## 本小時新發現

### 新論文 / 架構

1. **Uncertainty-Aware Robotic World Model Makes Offline Model-Based Reinforcement Learning Work on Real Robots** — Chenhao Li, Andreas Krause, Marco Hutter, 2026.  
   - 核心：ensemble recurrent dynamics，分離 aleatoric / epistemic uncertainty；以 uncertainty penalty 約束 imagination rollout。  
   - Paper: https://arxiv.org/abs/2504.16680  
   - Code: https://github.com/leggedrobotics/robotic_world_model_lite

2. **Uncertainty-Aware World Model for Aerial Image-Goal Navigation (UA-NWM)** — Deyi Zhu et al., Tsinghua University, 2026.  
   - 核心：把 trajectory scoring 重新定義成 conditional OOD detection，利用 Hierarchical Error Projection (HEP) 建立 uncertainty subspace，將 goal discrepancy 分成可解釋與不可解釋 residual。  
   - Paper: https://arxiv.org/abs/2608.05597  
   - Code: https://github.com/DurYi/UA-NWM  
   - Dataset: AirGoal-10k

3. **ProPlay: Procedural World Models for Self-Evolving LLM Agents** — Yijun Ma et al., 2026.  
   - 核心：把 Agent 經驗抽象成 procedure graph；edge 維護 global reliability 與 task-conditioned reliability record。  
   - Paper: https://arxiv.org/abs/2606.12780  
   - Code: https://github.com/antman9914/proplay  
   - Benchmarks: ScienceWorld / PlanCraft / τ-bench

4. **WOMBET: World Model-based Experience Transfer for Robust and Sample-efficient Reinforcement Learning** — Mintae Kim, Koushil Sreenath, 2026.  
   - 核心：uncertainty-penalized planning + 高 return / 低 epistemic uncertainty trajectory filtering，指出 distribution mismatch 是 transfer 的主要誤差來源之一。  
   - Paper: https://arxiv.org/abs/2604.08958

5. **Uncertainty-Aware Navigation World Model / Conditional OOD direction** 進一步說明：OOD 不必只用 ensemble variance；也可以把「預測誤差中無法被 learned uncertainty subspace 解釋的 residual」當成超出模型 support 的訊號。

---

# 本小時最重要 5 個發現

## 1. World-Model Uncertainty 至少要拆成 Aleatoric 與 Epistemic

### 是什麼

```text
Aleatoric uncertainty
= 世界本身具有隨機性 / noise

Epistemic uncertainty
= 模型沒學好 / 沒看過 / data support 不足
```

RWM-U 的 autoregressive evaluation 明確同時回傳：

```text
state_pred
aleatoric_uncertainty
epistemic_uncertainty
```

而 imagination runtime 會把 epistemic uncertainty 寫進每個 rollout step，並以 `uncertainty_penalty_weight` 直接修改 imagined reward。

### 底層如何運作

典型 ensemble world model：

```text
Input history H_t + action a_t
↓
Shared recurrent representation
↓
Ensemble heads b = 1...B
↓
μ_b(s_{t+1}), σ²_b(s_{t+1})
```

可粗分：

```text
Aleatoric ≈ E_b[σ²_b]
Epistemic ≈ Var_b[μ_b]
```

### 為什麼重要

Hermes Tool Twin 若只輸出：

```text
confidence = 0.82
```

會失去關鍵語義。

應改為：

```text
TransitionUncertainty
├ aleatoric
├ epistemic
├ support_score
├ OOD_score
├ calibration_scope
└ horizon
```

### 限制

Ensemble disagreement 只是 epistemic proxy；如果所有 ensemble member 因相同 inductive bias 一起錯，它仍可能低估 uncertainty。

### 來源

- https://arxiv.org/abs/2504.16680
- https://github.com/leggedrobotics/robotic_world_model_lite

---

## 2. Multi-Step Twin Error 不是單步 error 的簡單相加，而會沿 trajectory 改變輸入分布

### 概念

Autoregressive Twin：

```text
ŝ_{t+1} = T̂(ŝ_t, a_t)
ŝ_{t+2} = T̂(ŝ_{t+1}, a_{t+1})
...
```

第 1 步的小錯誤會使第 2 步輸入變成訓練資料中較少見的 state；第 2 步又增加模型誤差，形成 compounding distribution shift。

### RWM-U 原始碼證據

其 `_autoregressive_prediction()` 會把前一步 `state_pred` 直接作為下一步 dynamics input，同時逐步保存 aleatoric / epistemic uncertainty。evaluation 還特別測 `traj_autoregressive_error` 與 injected-noise 後的 autoregressive error。

### Hermes 新規則

```text
OneStepTwinAccuracy
≠
MultiStepCounterfactualReliability
```

應建立：

```text
RolloutConfidence_t
= f(
    TransitionUncertainty_1..t,
    support_distance_1..t,
    calibration_error_1..t,
    planner_sensitivity_1..t
  )
```

而不是：

```text
final_confidence = average(step_confidence)
```

### 工程建議

每一步都要保存：

```text
TwinStepCertificate
├ state_id
├ action
├ predicted_next_state
├ aleatoric
├ epistemic
├ OOD_score
├ calibration_bin
├ cumulative_horizon_error
└ authority
```

---

## 3. OOD Detection 應該問「這個 transition 是否仍在模型能解釋的 uncertainty manifold」

UA-NWM 的 HEP 是本輪最值得拆的 bottom-level mechanism。

### 底層流程

```text
Predicted future feature mean
+
Goal feature
↓
normalized discrepancy e
↓
coarse-to-fine grids
1 → 2 → 7 → 14
↓
每個 cell 預測低秩 basis S
↓
project error onto S
↓
remove explainable component
↓
retain orthogonal residual r⊥
↓
OOD / incompatibility cost
```

原始碼中 `HierarchicalErrorProjection.ortho_cost()` 實際：

1. 計算 normalized target - normalized mean。
2. 在多個空間 scale 上生成 rank-r basis。
3. 用 Gram matrix 解 projection coordinates。
4. 從 residual 持續扣除可由 basis 解釋的方向。
5. 最後用 `||r_perp||² / ||e||²` 當 normalized cost。

### 對 Hermes 的意義

Tool Twin 可建立類似：

```text
KnownTransitionSubspace
```

把新 action/state 的 prediction error 分解成：

```text
expected variation
+
unexplained residual
```

未解釋 residual 高時，應視為：

```text
TWIN_EXTRAPOLATION
```

而不是單純「模型 variance 大」。

### 關鍵差異

```text
High Aleatoric
≠ OOD

Low Ensemble Variance
≠ In-Distribution

Large Raw Error
≠ Untrustworthy
```

如果 error 落在已學到的 uncertainty subspace，可能只是已知 variability。

---

## 4. LLM Agent 世界模型可以是 Procedure Graph，但 reliability 必須 task-conditioned

ProPlay 不是 pixel/robot world model，而是 Agent procedural world model。

### 原始碼結構

```text
WorkflowNode
= reusable procedure

WorkflowEdge
= observed transition
```

edge 保存：

```text
count
success_count
emb_weighted_sum
emb_weight_sum
```

global reliability：

```text
success_count / count
```

task-conditioned reliability 則用：

```text
cosine(task_embedding, reward-weighted edge centroid)
```

### 對 Hermes 的重要性

Tool Twin 的 reliability 不能只存在：

```text
POST /refund = 96% accurate
```

應是：

```text
Reliability(
  tool,
  state_region,
  action_family,
  task_context,
  version
)
```

也就是：

```text
Global Twin Reliability
≠
Conditional Twin Reliability
```

某個 tool twin 在「正常退款」資料很多，但在「多幣別 + dispute + partial refund」區域可能完全沒 support。

---

## 5. Planner 不應只看 Twin prediction；還要看「決策對 Twin error 有多敏感」

即使 Twin state prediction 有誤差，如果 planner 的 action 在誤差範圍內不變，該誤差對 decision 可能不重要。

相反地：

```text
refund probability = 0.499 / 0.501
```

即使模型 error 很小，也可能導致完全不同 action。

因此 Hermes 要新增：

```text
PlannerSensitivity
```

可以做局部 perturbation：

```text
predicted state ŝ
↓
uncertainty set U(ŝ)
↓
replan across samples / bounds
↓
action distribution
```

例如：

```text
P(cancel) = .91
P(refund) = .07
P(escalate) = .02
```

代表 decision robust。

若：

```text
cancel .42
refund .39
escalate .19
```

即使 Twin uncertainty 中等，也應要求 verification。

因此：

```text
Twin Prediction Confidence
≠
Decision Confidence
```

---

# Architecture Breakdown

本輪形成 Hermes 的新架構：

```text
Real Tool / MCP / Browser Logs
↓
State-Action-NextState Dataset
↓
Twin Training / Deterministic Model
↓
Transition Predictor
├ mean / mode
├ aleatoric uncertainty
└ epistemic uncertainty
↓
Conditional Support Model
├ state region
├ action family
├ task embedding
├ tool version
└ provenance
↓
OOD / Extrapolation Detector
↓
World Fork
↓
Counterfactual Rollout
↓
Per-Step Twin Certificate
↓
Uncertainty Propagator
↓
Planner Sensitivity Probe
↓
Counterfactual Outcome Distribution
↓
Sim-to-Real Calibration Layer
↓
Counterfactual Outcome Confidence
↓
ACCEPT
SHORTEN HORIZON
QUERY REAL WORLD
HUMAN VERIFY
BLOCK
```

---

# Bottom-Level Logic

## A. Ensemble uncertainty

```text
for b in ensemble:
    μ_b, σ²_b = model_b(history, action)

aleatoric  = mean_b(σ²_b)
epistemic  = var_b(μ_b)
```

## B. Autoregressive propagation

```text
ŝ_0 = real/snapshot state

for t in 0..H:
    p(ŝ_{t+1}|ŝ_t,a_t)
    u_epi[t]
    u_alea[t]
    ood[t]
    ŝ_{t+1} becomes next input
```

不能假設 step uncertainties independent。

## C. Conditional OOD residual

Hermes 可借 HEP 的概念：

```text
prediction discrepancy e
↓
learn uncertainty basis S(state,action,context)
↓
projection e_parallel
↓
r_perp = e - e_parallel
↓
OOD_score = ||r_perp||² / ||e||²
```

## D. Outcome confidence

建議不要先硬壓成單一 scalar；內部保留 vector：

```text
CounterfactualConfidence
├ transition_epistemic
├ transition_aleatoric
├ OOD_risk
├ horizon_risk
├ calibration_error
├ planner_sensitivity
├ twin_authority
├ real_data_distance
└ unknown_unknown_flag
```

UI 可以額外顯示 summary，但 source vector 必須保留。

---

# Visual Simulation Idea

## **World-Model Uncertainty & OOD Rollout Lab**

### 主畫面：Counterfactual timeline

```text
Real S0
 │
 ├─ A0 → S1   epi .08  OOD .04  ✓
 │
 ├─ A1 → S2   epi .13  OOD .11  ✓
 │
 ├─ A2 → S3   epi .28  OOD .37  ⚠
 │
 └─ A3 → S4   epi .61  OOD .82  ✕
```

### Uncertainty decomposition

```text
Step 3

Aleatoric          ███░░ 0.31
Epistemic          ████░ 0.44
OOD residual       █████ 0.71
Planner sensitivity████░ 0.63
```

### Reliability manifold

使用 2D latent map：

```text
● training states
○ validated real states
△ simulated rollout
× OOD branch
```

Counterfactual trajectory 一旦離開 support region，畫面由實線變虛線。

### Planner sensitivity mode

使用 slider 改變 Twin uncertainty scale：

```text
0.5×  → REFUND 94%
1.0×  → REFUND 73%
1.5×  → REFUND 51%
2.0×  → ESCALATE 48%
```

讓不懂 ML 的使用者直接看到：

> 「不是世界模型有誤差就一定不能用；真正重要的是這個誤差會不會改變 Agent 的行動。」

---

# Code / GitHub

## 1. leggedrobotics/robotic_world_model_lite

值得讀：

```text
scripts/model_training.py
scripts/policy_training.py
scripts/envs/base.py
scripts/configs/
assets/models/pretrain_rnn_ens.pt
```

確認到的工程實作：

- autoregressive rollout 直接回饋 aleatoric / epistemic uncertainty。
- imagination runtime 為每個 env 綁定 ensemble model id。
- epistemic uncertainty 直接加入 reward penalty。
- evaluation 額外測 autoregressive error 與 noise robustness。

Repo: https://github.com/leggedrobotics/robotic_world_model_lite

## 2. DurYi/UA-NWM

值得讀：

```text
uanwm/models/world_model.py
uanwm/models/hep.py
uanwm/models/causal_transformer.py
uanwm/models/delta_tokenizer.py
uanwm/models/token_fuser.py
uanwm/train_hep.py
uanwm/eval/
deploy/
```

`hep.py` 是本輪底層機制重點。

Repo: https://github.com/DurYi/UA-NWM

## 3. antman9914/proplay

值得讀：

```text
proplay/graph.py
benchmarks/*/preplay.py
benchmarks/*/induction.py
benchmarks/*/agent.py
benchmarks/*/pipeline.py
```

`graph.py` 已確認 edge reliability 不只保存 global success ratio，也保存 reward-weighted task embedding centroid。

Repo: https://github.com/antman9914/proplay

---

# Papers

## Paper A
**Uncertainty-Aware Robotic World Model Makes Offline Model-Based Reinforcement Learning Work on Real Robots**  
Authors: Chenhao Li, Andreas Krause, Marco Hutter  
Institution: ETH Zurich / ETH AI Center  
Year: 2026  
URL: https://arxiv.org/abs/2504.16680  
Code: https://github.com/leggedrobotics/robotic_world_model_lite  
Architecture: recurrent dynamics ensemble + autoregressive imagination + uncertainty-aware MOPO-PPO  
Contribution: 把 epistemic uncertainty 沿長 horizon propagation，並用於 imagination reward penalty。  
Limitations: ensemble disagreement 不是完整 OOD proof；長 horizon 仍有 model bias / common-mode error。

## Paper B
**Uncertainty-Aware World Model for Aerial Image-Goal Navigation**  
Authors: Deyi Zhu, Haoyu Fan, Yinan Zhu, Weichen Zhang, Shilin Ma, Xinlei Chen, Yansong Tang  
Institution: Tsinghua University  
Year: 2026  
URL: https://arxiv.org/abs/2608.05597  
Code: https://github.com/DurYi/UA-NWM  
Dataset: AirGoal-10k  
Architecture: DINO latent world model + Hierarchical Error Projection + CEM/MPC planning  
Contribution: 將 trajectory ranking 視為 conditional OOD detection，使用低秩 uncertainty subspace 解釋合理 future variation。  
Limitations: navigation-specific latent geometry；是否可直接移植 tool-state transition 仍需驗證。

## Paper C
**ProPlay: Procedural World Models for Self-Evolving LLM Agents**  
Authors: Yijun Ma, Zehong Wang, Yiyang Li, Ziming Li, Xiaoguang Guo, Weixiang Sun, Chuxu Zhang, Yanfang Ye  
Year: 2026  
URL: https://arxiv.org/abs/2606.12780  
Code: https://github.com/antman9914/proplay  
Benchmarks: ScienceWorld / PlanCraft / τ-bench  
Architecture: procedure graph + pre-play + execution + refine loop  
Contribution: 讓 LLM Agent 的 memory 與 planning 共享一個 procedural world model，edge 帶 reliability。  
Limitations: reliability 主要是 success history / embedding similarity，不等於 calibrated transition probability。

## Paper D
**WOMBET: World Model-based Experience Transfer for Robust and Sample-efficient Reinforcement Learning**  
Authors: Mintae Kim, Koushil Sreenath  
Year: 2026  
URL: https://arxiv.org/abs/2604.08958  
Architecture: source-world-model → uncertainty-penalized planning → trajectory filtering → target fine-tuning  
Contribution: 把 epistemic uncertainty 與 distribution mismatch 納入 transfer error。  
Limitations: continuous-control domain；與 tool/MCP discrete state transition 的映射尚需工程驗證。

---

# 已確認事實 / 推論分層

## 已確認（官方原始碼 / 論文）

- RWM-U runtime 同時輸出 aleatoric / epistemic uncertainty。
- RWM-U imagination reward 可直接以 epistemic uncertainty penalty 修正。
- UA-NWM HEP 的確執行低秩 projection，保留 orthogonal residual 作 normalized cost。
- ProPlay edge 確實保存 count / success_count / reward-weighted task embedding accumulator。

## 工程推論（Hermes synthesis）

- 將 HEP-style residual 用於 Tool Twin state-action OOD detection。
- 將 ProPlay task-conditioned reliability 擴展到 tool/version/state-region conditional calibration。
- 建立 PlannerSensitivity 作 Counterfactual Outcome Confidence 的獨立維度。
- 建立逐步 `TwinStepCertificate` 並把 horizon uncertainty 傳播到最終 action confidence。

## 尚未驗證假說

1. HEP-style learned uncertainty subspace 在 discrete API/tool state transition 上能否比 ensemble disagreement 更準確地預測 OOD failure。
2. Planner sensitivity 是否能有效預測「模型誤差何時真正會造成 action flip」。
3. 不同 uncertainty sources 是否可以安全整合成單一 decision gate，而不造成 calibration collapse。

---

# Unknown / Open Questions

1. **Unknown unknown**：若所有 ensemble models 共享相同錯誤 inductive bias，如何偵測低 disagreement 但高真實 error？
2. **Horizon calibration**：如何將 one-step coverage / calibration guarantee 擴展到 adaptive multi-step Agent planning？
3. **Discrete Tool Twin OOD**：對 JSON/schema state、policy state、MCP resource state，最合適的 support-distance / representation 到底是 embedding、structured distance、graph distance 還是 hybrid？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
World Model Uncertainty
Aleatoric Uncertainty
Epistemic Uncertainty
Ensemble Disagreement
Conditional Support
State-Action Coverage
OOD Transition
Twin Extrapolation
Uncertainty Subspace
Explained Error Component
Unexplained Residual
Hierarchical Error Projection
Autoregressive Error Accumulation
Horizon Risk
Conditional Twin Reliability
Task-Conditioned Reliability
Planner Sensitivity
Action Flip Risk
Twin Step Certificate
Counterfactual Outcome Distribution
Counterfactual Outcome Confidence
Selective Real Verification
```

## Edges

```text
Aleatoric Uncertainty
IS_NOT
Epistemic Uncertainty

Low Ensemble Disagreement
DOES_NOT_PROVE
In-Distribution

One-Step Accuracy
DOES_NOT_IMPLY
Multi-Step Reliability

High Raw Prediction Error
DOES_NOT_IMPLY
OOD

Unexplained Residual
SUPPORTS
OOD Transition Detection

OOD Transition
INCREASES
Horizon Risk

Epistemic Uncertainty
PENALIZES
Imagined Reward

Task Context
CONDITIONS
Twin Reliability

Twin Prediction Confidence
IS_NOT
Decision Confidence

Planner Sensitivity
MODULATES
Counterfactual Outcome Confidence
```

---

# 下一輪研究

下一輪最大的缺口：

## **Unknown-Unknown Detection × Conformal Horizon Calibration × Selective Real Verification × Active Twin Learning**

建議研究鏈：

```text
Twin rollout
↓
OOD / uncertainty / planner sensitivity
↓
confidence too low
↓
select real-world verification query
↓
observe true transition
↓
calibration update
↓
active data selection
↓
Twin retraining
↓
coverage expansion
```

優先深挖：

1. Ensemble common-mode failure / OOD detector disagreement。
2. Conformal prediction 對 sequential / adaptive rollout 的 coverage 問題。
3. Active learning：該向 real tool 查哪一個 state-action transition 才最值得。
4. Safe exploration / query budget。
5. Learned Tool Twin 在 MCP / browser / enterprise API state 上的 representation design。

---

# 每輪結束必答

- **缺哪一層：** Unknown-unknown detection + sequential/horizon calibration + active real verification。
- **哪個節點最淺：** `CounterfactualOutcomeConfidence`、`PlannerSensitivity`、`StateActionCoverage`。
- **哪個概念仍只是名詞：** `UnknownUnknownFlag`、`SequentialCalibrationCertificate`、`SelectiveRealVerificationPolicy`。
- **哪個系統值得繼續讀原始碼：** UA-NWM `world_model.py / hep.py / eval/`；RWM-U full Isaac Lab extension 的 ensemble dynamics implementation。
- **哪篇論文需追引用：** RWM-U 與 UA-NWM；前者追 long-horizon epistemic propagation，後者追 conditional OOD / uncertainty subspace。
- **哪個概念最適合視覺模擬：** World-Model Uncertainty & OOD Rollout Lab。
- **哪個 Agent 架構最值得實作：**

> **Uncertainty-Aware Forkable Tool-World Runtime = Stateful World Fork + Learned/Deterministic Twin + Aleatoric/Epistemic Decomposition + Conditional OOD Detector + Multi-Step Uncertainty Propagation + Planner Sensitivity Probe + Sim-to-Real Calibration + Selective Real Verification Gate.**

---

## 對「AI 到底怎麼運作」新增的一層

本輪把既有鏈：

```text
User
→ UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tools/MCP
→ Model
→ GPU
→ Output
```

補上 Agent 在「想像未來」時真正缺少的一層：

```text
Current World State
↓
Candidate Action
↓
World / Tool Twin
↓
Predicted Transition Distribution
↓
Aleatoric + Epistemic Uncertainty
↓
OOD / Support Test
↓
Multi-Step Imagination
↓
Planner Sensitivity
↓
Counterfactual Outcome Confidence
↓
Act / Verify / Shorten Horizon / Block
```

多模態世界則是：

```text
Camera / Image / Voice / Video / Sensors
↓
Encoder / Tokens / Fusion
↓
World State
↓
Action-conditioned World Model
↓
Future Multimodal Latent / State
↓
Uncertainty + OOD
↓
Reasoning / Planning
↓
Action
```

**核心結論：成熟 Agent 的 world model 不能只回答「如果我這樣做，可能會發生什麼」；它還必須同時回答「我為什麼相信這個未來、這個 state-action 是否超出我真正看過的範圍、誤差會不會沿 horizon 放大，以及這個 uncertainty 是否足以改變我的決策」。**