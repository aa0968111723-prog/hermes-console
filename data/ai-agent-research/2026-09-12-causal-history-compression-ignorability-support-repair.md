# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-12 21:55 Asia/Taipei

## 本輪研究主題
**Causal History Compression × Sequential Ignorability Diagnostics × Action-Sufficient State × Safe Exploration × Trajectory Support Repair**

本輪承接上一輪 `Trajectory-Level Selection Correction × Sequential Doubly Robust Estimation × Verification-as-Intervention`，專門處理上一輪留下的核心問題：

> 多步 Agent 的 propensity / causal adjustment 需要 history `H_t`，但 `H_t` 若保留太少會漏掉 confounder；全部保留又幾乎每條 history 都唯一，造成 overlap / positivity 崩潰。究竟應該保留什麼？怎麼知道壓縮後仍足以做決策與因果校正？如果某些 trajectory 缺乏 support，應如何安全地補資料？

---

# 本小時新發現

## 新論文 / 新架構

1. **Integrating Causal DAGs in Deep RL: Activating Minimal Markovian States with Multi-Order Exposure**  
   - Authors: Jiamin Xu, Jacqueline Maasch, Kyra Gan  
   - Institution: Cornell Tech / Cornell University context  
   - Year: 2026  
   - URL: https://arxiv.org/abs/2605.07057  
   - Architecture: causal DAG → minimal Markovian state construction → Multi-Order State Exposure (MOSE) → shared Q-function  
   - Contribution: 給定 longitudinal causal DAG，構造 provably minimal Markovian state；但實驗發現「最小」在 deep RL 不必然最好，因此加入多階 history 的 controlled redundancy。  
   - Limitation: 依賴 causal graph / state construction 假設；目前重點是 RL state，不是直接針對 LLM Agent 的 tool/memory history。  
   - 改變了什麼：把「History Compression = 越短越好」推翻成「History Compression = 保留足夠因果狀態 + 可學習的受控冗餘」。

2. **Action-Sufficient Goal Representations**  
   - Authors: Jinu Hyeon, Woobin Park, Hongjoon Ahn, Taesup Moon  
   - Institution: Seoul National University / Trillion Labs  
   - Year: ICML 2026  
   - URL: https://arxiv.org/abs/2601.22496  
   - Code: https://github.com/action-sufficient/action-sufficient  
   - Dataset / Benchmarks: OGBench robotic manipulation; discrete cube analysis; repository lists 100M-scale play datasets and 1M visual datasets.  
   - Architecture: high-level subgoal planner → compressed goal representation `Z=φ(S,G)` → low-level actor.  
   - Contribution: 定義 Action-Sufficiency Gap `Δ_A = I(A;G | S,Z)`，證明 value sufficiency 不保證 action sufficiency；actor NLL 可直接驅動 action-sufficient representation。  
   - Limitation: 研究主要是 goal representation，不等於完整 Agent history compression；也沒有直接證明 representation 同時足以處理 causal adjustment / sequential ignorability。  
   - 改變了什麼：Hermes 不能只測「壓縮後是否能預測 value/outcome」，還要測「壓縮後是否保留 action-selection 所需資訊」。

3. **Off-Policy Safe Reinforcement Learning with Constrained Optimistic Exploration (COX-Q)**  
   - Authors: Guopeng Li, Matthijs T. J. Spaan, Julian F. P. Kooij  
   - Institution: TU Delft-related research group  
   - Year: ICLR 2026  
   - URL: https://arxiv.org/abs/2603.23889  
   - Code: https://github.com/RomainLITUD/COXQ  
   - Benchmarks: Safe Velocity, Safe Navigation, SMARTS autonomous driving.  
   - Architecture: off-policy safe RL + reward/cost distributional critics + constrained optimistic action-space exploration + adaptive trust region.  
   - Contribution: 在「收集新資料本身也有風險」的情況下，以 cost-bounded exploration 補 coverage，而不是 unrestricted exploration。  
   - Limitation: RL continuous-control 假設比一般 LLM Agent 的 tool/MCP action space結構化；需工程映射。  
   - 改變了什麼：Support repair 不應等於「到未知區域多探索」，而應是「在安全預算內、有目的地增加 trajectory support」。

4. **CATAL: Causally Disentangled Task Representation Learning for Offline Meta-RL**  
   - Authors: Shan Cong, Chao Yu, Xiangyuan Lan  
   - Institutions: Sun Yat-sen University, Pengcheng Laboratory  
   - Year: AAAI 2026  
   - URL: https://ojs.aaai.org/index.php/AAAI/article/view/39200  
   - Contribution: 將 task representation 的 latent dimensions 對齊環境動態 / reward 變化的因果因素，以提升 OOD generalization。  
   - Limitation: task-level representation ≠ longitudinal causal-history sufficiency。  
   - 改變了什麼：History compression 應考慮 latent representation 是否把多個因果機制纏在一起。

5. **Sequential ignorability / exchangeability sensitivity work (2025–2026)**  
   - 近期文獻再次強調 conditional/sequential exchangeability 常無法由 observational data 本身證明；應搭配 sensitivity analysis、proxy/negative-control 類診斷，不能把 balance diagnostics 當成 ignorability proof。  
   - Representative sources:  
     - Zheng, *Identifying Unmeasured Confounders in Panel Causal Models: A Two-Stage LM-Wald Approach* (2025), https://arxiv.org/abs/2508.10342  
     - Zou & Hu et al., *Bayesian Sensitivity Analysis for Causal Estimation With Time-Varying Unmeasured Confounding* (2026), Statistics in Medicine.  
   - 改變了什麼：Hermes 應輸出 `IGNORABILITY_SUPPORTED_BY_DIAGNOSTICS`，不能輸出 `IGNORABILITY_VERIFIED`。

---

# 本小時最重要 5 個發現

## 1. Minimal History ≠ Learnable State

### 概念
理論上足夠的最小 Markovian state，不一定是神經網路最容易利用的表示。

### 已確認事實 / 論文結果
MOSE 的核心結果是：由 longitudinal causal DAG 建出的 provably minimal Markovian state 在 deep RL 中不一定提升表現；將不同 order 的 history 一起餵給同一 Q-function 的 controlled redundancy 反而更有效。

### 底層如何運作
概念流程：

```text
Raw longitudinal history
H_t = {X_0,A_0,O_0,...,X_t}
↓
Causal DAG
↓
Find variables/history fragments required for Markov property
↓
Minimal causal state S_t^min
↓
Construct multi-order state views
S_t^(1), S_t^(2), ..., S_t^(W)
↓
Shared Q-function / policy representation
```

對 Hermes 的工程映射：

```text
Full Agent History
↓
Causal Slice
├ current user goal
├ unresolved commitments
├ relevant tool observations
├ memory dependencies
├ policy/security state
└ world state
↓
Minimal Causal History
+
Controlled Redundant Views
├ recent raw turns
├ action-only anchor stream
├ tool-effect summary
└ compressed memory state
↓
History State Encoder
```

### 為什麼重要
如果 Hermes 只追求最短 context，可能得到理論上 sufficient、實際上卻難被 model 利用的 state representation。

### 限制
MOSE 是 RL setting；把它轉成 LLM/Agent context compiler 是合理工程推論，不是原論文已驗證結果。

### 來源
- https://arxiv.org/abs/2605.07057

---

## 2. Outcome/Value Sufficiency ≠ Action Sufficiency

### 概念
一個 history representation 即使足以預測 outcome/value，也可能把「需要不同下一步 action」的 histories 壓成同一個 embedding。

### 已確認事實
Action-Sufficient Goal Representations 定義：

```text
Δ_A = I(A ; G | S, Z)
```

`Δ_A = 0` 才表示 representation `Z` 已保留 optimal action 所需資訊。論文明確證明 value sufficiency 不推出 action sufficiency。

### 原始碼驗證
官方 JAX repo：

```text
agents/
├ gciql.py
├ gcivl.py
├ ota.py
└ ota_flow.py
```

`agents/ota.py` 在 `use_actor_rep` 時：

```text
goal_reps = goal_rep(..., params=grad_params)
if not use_actor_rep:
    goal_reps = stop_gradient(goal_reps)
...
actor_loss = -(exp_advantage * log_prob(action)).mean()
```

也就是 actor-representation 模式會讓低階 action NLL / policy loss 的梯度直接塑造 representation；其他模式則阻斷這條 gradient path。

### Hermes 對應
History encoder 不應只有：

```text
Predict future outcome loss
Predict task success loss
```

還需要：

```text
Action Sufficiency Probe
= can compressed history preserve next-action distribution?
```

建議至少同時測：

```text
L_outcome
L_action
L_tool_selection
L_risk_gate
L_memory_retrieval
```

### 新否定關係

```text
Predictive Sufficiency ≠ Decision Sufficiency
Value Sufficiency ≠ Action Sufficiency
Good Summary ≠ Good Control State
```

### 來源
- https://arxiv.org/abs/2601.22496
- https://github.com/action-sufficient/action-sufficient

---

## 3. Sequential Ignorability 不能被單一 diagnostic「證明」

### 概念
上一輪需要估：

```text
P(A_t | H_t)
P(V_t | H_t)
```

這依賴 history `H_t` 包含足夠 confounders。

但若有未觀測 `U_t` 同時影響 action 與 outcome：

```text
U_t → A_t
U_t → Y
```

那麼壓縮後的 `Z_t = f(H_t)` 可能看起來 balance 很好，卻仍不是 causal sufficient state。

### 已確認事實
近期 causal-inference 文獻仍把 sequential/conditional exchangeability 視為強假設；有研究提出 diagnostics 或 sensitivity methods 去偵測/量化 unmeasured confounding，但「觀測資料上的平衡很好」本身不能證明沒有 hidden confounder。

### Hermes 應建立 Ignorability Diagnostic Stack

```text
Compressed History Z_t
↓
1. Propensity predictability
2. Covariate balance after weighting
3. Residual action predictability
4. Negative-control tests
5. Proxy / latent-confounder probes
6. Sensitivity analysis
7. Policy-version invariance checks
↓
IgnorabilityEvidenceProfile
```

不要輸出：

```text
IGNORABILITY = TRUE
```

而應輸出：

```text
IgnorabilityStatus
├ assumption_required = true
├ observed_balance = 0.93
├ residual_predictability = 0.08
├ negative_control_alert = false
├ sensitivity_robustness = moderate
└ status = SUPPORTED_NOT_VERIFIED
```

### 新否定關係

```text
Balance ≠ No Hidden Confounding
Low Propensity Error ≠ Sequential Ignorability
Representation Compression ≠ Causal Sufficiency
```

### 來源
- https://arxiv.org/abs/2508.10342
- https://pmc.ncbi.nlm.nih.gov/articles/PMC12975701/
- related 2025–2026 exchangeability sensitivity literature

---

## 4. Support Repair 必須是 Safe Exploration，不是「去未知區域亂跑」

### 概念
上一輪遇到：

```text
UNSUPPORTED_VERIFICATION_PATH
UNSUPPORTED_ACTION
UNIDENTIFIED
```

真正問題是如何補資料。

### COX-Q 的底層機制
COX-Q 原始碼 `SafeVelocity/sac/cox_explore.py` 直接實作 action-space constrained optimistic shift：

```text
reward-UCB gradient g_r
cost-LCB improvement gradient g_c
↓
Σ-metric conflict resolution
sigma_mgda_cone_two(...)
↓
reward/cost conflict-free direction v*
↓
KL radius bound
↓
Cost-cap slack / violation slope
↓
shrink step size η
↓
Δa = η Σ v*
```

重要細節：
- reward 與 cost gradient 衝突時會投影到可接受 cone / boundary。
- exploration step 同時受 KL trust region 和 cost cap 控制。
- 若方向會增加 cost，會利用剩餘 slack 縮小 step。

### Hermes 對應
Support repair 可變成：

```text
Unsupported Trajectory Region
↓
Candidate Probe / Tool / Verification Actions
↓
Expected Coverage Gain
+
Expected Information Gain
+
Risk / Side-effect Cost
↓
Safe Exploration Gate
↓
SHADOW
SANDBOX
READ_ONLY_REAL
LIMITED_REAL
HUMAN_APPROVED
↓
New ground-truth transitions
↓
Support Map Update
```

新的目標函式可概念化：

```text
SupportRepairValue(q)
=
α CoverageGain
+ β DecisionUncertaintyReduction
+ γ ConfounderDisambiguation
- λ SafetyCost
- μ SideEffectRisk
- ν MonetaryCost
```

### 新否定關係

```text
Unknown Region ≠ Exploration Permission
Coverage Gain ≠ Safe Data Collection
High Information Gain ≠ Acceptable Intervention
```

### 來源
- https://arxiv.org/abs/2603.23889
- https://github.com/RomainLITUD/COXQ

---

## 5. History Compression 應成為「多目標 sufficiency contract」

### 合理工程推論
把 MOSE、Action Sufficiency、Sequential Ignorability 與上一輪 trajectory support 合併後，Hermes 不應用單一 summary quality score 判斷 context compression。

應建立：

```text
HistoryCompressionContract
├ MarkovSufficiency
├ ActionSufficiency
├ ToolSelectionSufficiency
├ RiskGateSufficiency
├ ConfounderRetention
├ PropensityStability
├ MemoryDependencyCoverage
├ SecurityContextCoverage
└ Learnability / CompressionCost
```

例如一個摘要：

```text
「使用者要退款，API 顯示訂單存在。」
```

可能對 task summary 足夠，但若刪掉：

```text
- 先前 payment 已部分退款
- user explicitly 禁止二次扣款
- tool result 來自低信任 MCP server
- verification policy 曾問過人類
```

就可能同時破壞：

```text
Action Sufficiency
Risk Sufficiency
Causal Adjustment Sufficiency
Security Sufficiency
```

所以 Context Compiler 應問的不是：

```text
「哪些 token 最重要？」
```

而是：

```text
「刪掉這段 history，哪一個 downstream decision / causal identification condition 會被破壞？」
```

---

# Architecture Breakdown

## Hermes Causal History Runtime

```text
Raw Agent Event Stream
├ user messages
├ multimodal observations
├ model decisions
├ memory reads/writes
├ tool calls/results
├ MCP resources
├ verification events
├ external effects
├ policy versions
└ world-state transitions
↓
Typed Temporal Causal Graph
↓
Dynamic Causal Slice
↓
History Candidate Set
↓
Multi-Objective History Encoder
├ minimal causal state
├ recent raw window
├ action anchors
├ unresolved commitments
├ world-state summary
└ security/provenance state
↓
History Sufficiency Auditor
├ Markov probe
├ Action-sufficiency probe
├ Outcome/value probe
├ Tool-selection probe
├ Risk-gate probe
└ Confounder-retention diagnostics
↓
Ignorability Diagnostic Stack
↓
Trajectory Support Map
↓
Support Gate
├ SUPPORTED
├ WEAK_SUPPORT
├ PREFIX_ONLY
└ UNIDENTIFIED
↓
Safe Support Repair Planner
├ sandbox experiment
├ shadow action
├ read-only probe
├ active verification
└ human-approved real action
↓
New Evidence
↓
History Encoder / Support Map Update
```

---

# Bottom-Level Logic

## A. History state 的三層表示

建議把 `H_t` 拆成三層，而不是「全 history vs summary」二選一：

### Layer 1 — Immutable Raw Event Log

```text
E_0, E_1, ..., E_t
```

永遠保存，可 audit / replay。

### Layer 2 — Causal State

```text
C_t = f_causal(H_t)
```

只保留對未來 transition、action selection、risk、confounding adjustment 仍有 causal relevance 的變數。

### Layer 3 — Learnability Views

```text
L_t = {
  C_t,
  recent_window,
  action_anchor_history,
  selected_raw_evidence
}
```

這就是 MOSE 類「controlled redundancy」在 Hermes 的對應。

---

## B. Action Sufficiency Probe

壓縮前：

```text
π_full(A_t | H_t)
```

壓縮後：

```text
π_comp(A_t | Z_t)
```

可以監控：

```text
KL(
  π_full(.|H_t)
  ||
  π_comp(.|Z_t)
)
```

若 KL 高，代表 compression 改變了下一步 action distribution。

但此 probe 只能測「相對 full policy 的 decision preservation」，不能證明 full policy 本身正確。

---

## C. Causal Sufficiency / Confounder Retention Probe

對每個被丟棄的 candidate history feature `X`：

```text
X
↓
Does it improve action / verification assignment prediction?
↓
Does it predict future outcome conditional on compressed Z?
↓
Does adding X materially change estimated treatment/action effect?
```

如果三者任一顯著，則標記：

```text
POTENTIAL_OMITTED_CONFOUNDER
```

這是 diagnostic，不是 causal proof。

---

## D. Support Repair Loop

```text
Find unsupported region R
↓
Generate candidate experiment q
↓
Estimate:
  coverage_gain(q)
  action_sufficiency_gain(q)
  confounder_information(q)
  safety_cost(q)
  external_effect_risk(q)
↓
Choose q under safety budget
↓
Execute in safest admissible mode
↓
Record propensity + intervention type
↓
Update state/action support
↓
Recompute certificates
```

重要：support repair data 本身也是 policy-selected data，因此必須接回上一輪的 selection / propensity logging，而不能直接混進 unbiased dataset。

---

# Visual Simulation Idea

## **Causal History Compressor × Support Repair Lab**

### 視圖 1：History Layer Explorer

畫面左側是完整 Agent trajectory：

```text
U0 → M0 → T0 → O0 → A0 → U1 → V1 → T1 → O1 → A1
```

使用者可切換：

```text
RAW
MINIMAL CAUSAL
MULTI-ORDER
CURRENT PRODUCTION CONTEXT
```

被刪除的節點以灰色顯示；但如果刪除造成 probe fail，立即紅色亮起。

### 視圖 2：Sufficiency Matrix

```text
                      Full  Minimal  MOSE-like  Current
Markov sufficiency      ✓      ✓        ✓          ✓
Action preservation     ✓      ⚠        ✓          ✓
Tool selection          ✓      ✕        ✓          ⚠
Risk gate               ✓      ✕        ✓          ✓
Confounder retention    ✓      ?        ✓          ⚠
Token cost            100%    18%      34%         29%
```

### 視圖 3：Ignorability Evidence Panel

```text
Observed balance            0.94
Residual action prediction  0.07
Negative control alert      false
Sensitivity robustness      medium
Hidden-confounder proof      unavailable

STATUS:
SUPPORTED_NOT_VERIFIED
```

### 視圖 4：Trajectory Support Heatmap

```text
                        SEARCH   ASK_USER   MCP_WRITE   COMMIT
state cluster A           ✓         ✓          ⚠          ✕
state cluster B           ✓         ⚠          ✕          ✕
state cluster C           ✓         ✓          ✓          ⚠
```

點擊 `✕` 後顯示 Support Repair Planner：

```text
Experiment                 Coverage   Risk    Mode
sandbox MCP_WRITE            .81       .02    SANDBOX
shadow MCP_WRITE             .74       .04    SHADOW
read-only server probe       .52       .01    REAL_READ
real write                   .92       .71    BLOCKED
```

這個 UI 可以把非常抽象的「sequential ignorability / history compression / support」變成非研究者也看得懂的視覺模型。

---

# Code / GitHub

## 1. action-sufficient/action-sufficient
https://github.com/action-sufficient/action-sufficient

值得看的目錄 / 檔案：

```text
agents/
├ ota.py
├ ota_flow.py
├ gciql.py
└ gcivl.py

discrete-cube/
envs/
ogbench/
scripts/
```

### 核心檔案：`agents/ota.py`

重點：
- `use_value_rep`：representation 由 value 路徑訓練。
- `use_actor_rep`：representation 直接接受 low-level actor gradient。
- `low_actor_loss()` 裡，在非 actor-rep 模式明確 `stop_gradient(goal_reps)`。
- 這是「representation 的學習目標會決定它究竟保留哪一類 downstream information」的直接工程證據。

## 2. RomainLITUD/COXQ
https://github.com/RomainLITUD/COXQ

值得看的路徑：

```text
SafeVelocity/
├ saferl.py
└ sac/
   ├ acting.py
   ├ cbox.py
   ├ cox_explore.py
   ├ gradient_surgery.py
   ├ losses.py
   ├ nets.py
   ├ networks.py
   ├ oac_cost.py
   └ train.py
```

### 核心檔案：`SafeVelocity/sac/cox_explore.py`

實際包含：
- `sigma_mgda_cone_two()`：在 Σ metric 中解 reward / cost gradient conflict。
- `cox_shift()`：整合 reward UCB、cost LCB、KL radius、cost cap slack 與 exploration shift。

可映射成 Hermes 的：

```text
CoverageGradient
SafetyRiskGradient
↓
Conflict Resolution
↓
Trust Region
↓
Side-Effect Budget
↓
Safe Support Probe
```

---

# Papers

## Paper A
**Integrating Causal DAGs in Deep RL: Activating Minimal Markovian States with Multi-Order Exposure**  
Authors: Jiamin Xu, Jacqueline Maasch, Kyra Gan  
Year: 2026  
URL: https://arxiv.org/abs/2605.07057  
Code: 本輪未找到可確認的官方公開 GitHub repository。  
Architecture: causal DAG → minimal Markov state → MOSE multi-order exposure → Q-learning.  
Contribution: provably minimal Markov construction + controlled redundancy.  
Limitations: graph correctness、RL domain、deep-network learnability gap。

## Paper B
**Action-Sufficient Goal Representations**  
Authors: Jinu Hyeon, Woobin Park, Hongjoon Ahn, Taesup Moon  
Institution: Seoul National University / Trillion Labs  
Year: ICML 2026  
URL: https://arxiv.org/abs/2601.22496  
Code: https://github.com/action-sufficient/action-sufficient  
Dataset: OGBench / discrete cube / visual tasks.  
Architecture: high-level planner → goal representation → low-level actor.  
Contribution: `Δ_A = I(A;G|S,Z)` action sufficiency; actor NLL learns action-relevant reps.  
Limitations: goal representation setting，不直接保證 causal-history sufficiency。

## Paper C
**Off-Policy Safe Reinforcement Learning with Constrained Optimistic Exploration**  
Authors: Guopeng Li, Matthijs T. J. Spaan, Julian F. P. Kooij  
Year: ICLR 2026  
URL: https://arxiv.org/abs/2603.23889  
Code: https://github.com/RomainLITUD/COXQ  
Benchmarks: Safe Velocity, Safe Navigation, SMARTS.  
Architecture: distributional reward/cost critics + constrained optimistic exploration.  
Contribution: training-time exploration 也受 safety cost 約束。  
Limitations: continuous-control action geometry 與 LLM Agent tool space不同。

## Paper D
**CATAL: Causally Disentangled Task Representation Learning for Offline Meta-RL**  
Authors: Shan Cong, Chao Yu, Xiangyuan Lan  
Institutions: Sun Yat-sen University / Pengcheng Laboratory  
Year: AAAI 2026  
URL: https://ojs.aaai.org/index.php/AAAI/article/view/39200  
Architecture: causal factor-aligned latent task representation.  
Contribution: 改善 simultaneous-factor OOD generalization。  
Limitations: task representation != sequential history state。

## Paper E
**Identifying Unmeasured Confounders in Panel Causal Models: A Two-Stage LM-Wald Approach**  
Author: Bang Quan Zheng  
Year: 2025  
URL: https://arxiv.org/abs/2508.10342  
Contribution: 對 sequential ignorability violation 提供 diagnostic route。  
Limitations: panel causal model，不是 Agent-specific；diagnostic power 依模型假設。

---

# 已確認事實 / 工程實作 / 合理推論 / 尚未驗證假說

## 已確認事實
- MOSE 論文主張 causal DAG 可構造 minimal Markovian state，且 controlled redundancy 在 deep RL 實驗優於單純 minimal representation。
- Action-Sufficient paper 證明 value sufficiency 不推出 action sufficiency。
- Action-Sufficient 官方 repo 中 actor-representation 路徑讓 actor loss gradient 進入 representation；其他模式會 stop gradient。
- COX-Q code 中存在 reward/cost gradient conflict resolution、KL-bound exploration step 與 cost-cap constraint。
- Sequential ignorability / exchangeability 是 causal identification assumption，hidden confounding 不能只靠普通 balance checks 排除。

## 官方 / 原始碼資訊
- `action-sufficient/action-sufficient` 為官方 JAX implementation。
- `RomainLITUD/COXQ` 為 ICLR 2026 COX-Q code repository。

## 合理工程推論
- Hermes 應把 history compression 改為 multi-objective sufficiency contract。
- MOSE 的 controlled redundancy 可映射到 LLM Agent context compiler 的「minimal causal state + recent/raw/action-anchor views」。
- COX-Q 的 constrained exploration 思想可映射到 Agent trajectory support repair。

## 尚未驗證假說
- Action-sufficient representation 是否同時能保留 sequential ignorability 所需 confounders。
- 將 action-KL preservation 作為 Agent history compression metric 是否能直接預測真實 tool-use success。
- Controlled redundancy 在大 context LLM Agent 中是否一定優於 minimal causal state；可能受到 attention dilution / context length 限制。

---

# Unknown / Open Questions

## 1. Causal History 的「最小充分集合」如何在線更新？
Agent 的 tool schema、policy、memory topology 會變，今天的 sufficient state 明天可能不 sufficient。需要 versioned causal-state contract。

## 2. 如何區分「模型需要的冗餘」與「會造成 attention dilution 的噪音」？
MOSE 說 controlled redundancy 有幫助，但 LLM context 的冗餘也可能導致 lost-in-the-middle / distraction。需要 end-to-end compression frontier：`decision preservation vs token cost vs causal sufficiency`。

## 3. Sequential ignorability 無法被完全驗證時，什麼時候應停止 off-policy causal claim？
Hermes 應有明確 gate：若 sensitivity 太高、negative controls fail、support too weak，就將 status 改成 `UNIDENTIFIED`，而不是輸出漂亮但無識別基礎的 effect estimate。

---

# 下一輪研究

下一輪最高優先：

# **Causal State Discovery × Negative Controls × Sensitivity Bounds × Representation Drift**

研究路徑：

```text
Raw Agent History
↓
Candidate causal variables
↓
Learned history representation
↓
Action / outcome / risk sufficiency tests
↓
Negative-control construction
↓
Hidden-confounder sensitivity
↓
Representation drift detection
↓
Versioned Causal State Contract
↓
When to invalidate old propensity / calibration models
```

應追的細節：
- Negative control exposure/outcome 如何映射到 Agent tools / memory / policy logs。
- Proximal causal inference 是否能用 MCP/tool observations 當 proxies 補 hidden confounder。
- Representation drift 發生後，舊 propensity model / DR estimator 是否應全部失效。
- 多模態 Agent 的 camera/audio/video history 要如何壓成 causal state，而不是只靠 semantic summary。

---

# Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Causal History Compression
Causal History State
Minimal Markovian State
Controlled History Redundancy
Multi-Order State Exposure
Learnability View
Action Sufficiency
Action Sufficiency Gap
Decision Sufficiency
Tool Selection Sufficiency
Risk-Gate Sufficiency
Confounder Retention
History Compression Contract
History Sufficiency Auditor
Ignorability Evidence Profile
Residual Action Predictability
Negative-Control Diagnostic
Sensitivity Robustness
Trajectory Support Map
Support Repair
Safe Support Repair
Coverage Gain
Support Repair Value
Representation Drift
Versioned Causal State Contract
```

## 新 Edges

```text
Full Agent History
→ compressed_into
Causal History State

Causal DAG
→ identifies
Minimal Markovian State

Minimal Markovian State
→ augmented_by
Controlled History Redundancy

Controlled History Redundancy
→ improves_learnability_of
Policy / Q / Agent Runtime

Action Loss
→ trains
Action-Sufficient Representation

History Compression
→ must_preserve
Action Sufficiency

History Compression
→ must_preserve
Confounder Retention

Trajectory Support Gap
→ triggers
Safe Support Repair

Safe Support Repair
→ expands
Trajectory Support Map

Support Repair Data
→ generated_by
Selection Policy

Selection Policy
→ requires
Propensity Logging
```

## 新否定 / 區分 Edges

```text
Minimal State ≠ Best Learnable State

Value Sufficiency ≠ Action Sufficiency

Predictive Sufficiency ≠ Decision Sufficiency

Good Summary ≠ Good Control State

Balanced Covariates ≠ No Hidden Confounding

Low Residual Action Predictability ≠ Proven Ignorability

History Compression ≠ Causal Sufficiency

Unknown Region ≠ Exploration Permission

Coverage Gain ≠ Safe Exploration

Weight / Propensity Correction ≠ Support Creation

Controlled Redundancy ≠ Arbitrary Long Context
```

---

# 本輪結束回答

### 缺哪一層？
**Causal State Discovery + Hidden-Confounder Sensitivity Layer**。我們已知道 history 不能全留也不能只做普通 summary，但「哪些 latent/observed variables 才是足夠的 causal state」仍沒有 production-grade 自動發現器。

### 哪個節點最淺？
`ConfounderRetentionScore`、`IgnorabilityEvidenceProfile`、`SupportRepairValue`。

### 哪個概念仍只是名詞？
`VersionedCausalStateContract` 目前主要是 Hermes 工程設計概念，尚未有一套可直接套用到 LLM Agent runtime 的既有標準。

### 哪個系統最值得讀原始碼？
1. `action-sufficient/action-sufficient` 的 `agents/ota.py` / `ota_flow.py`；研究 representation gradient path。  
2. `RomainLITUD/COXQ` 的 `SafeVelocity/sac/cox_explore.py`、`losses.py`、`train.py`；研究如何將 exploration 受 cost constraint 約束。

### 哪篇論文需追引用？
第一優先：**Integrating Causal DAGs in Deep RL: Activating Minimal Markovian States with Multi-Order Exposure (2026)**。它直接切中下一步「如何由 longitudinal causal structure 建 state」。  
第二優先：**Action-Sufficient Goal Representations (ICML 2026)**。

### 哪個概念最適合視覺模擬？
**Causal History Compressor × Support Repair Lab**：同時把 raw history、minimal causal state、controlled redundancy、sufficiency probes、trajectory support heatmap 與 safe exploration 顯示在一個互動圖上。

### 哪個 Agent 架構最值得實作？

> **Causal-State-Aware Agent Runtime = Immutable Event Log + Temporal Causal Graph + Multi-View History Encoder + Action/Tool/Risk Sufficiency Auditor + Ignorability Diagnostics + Trajectory Support Map + Safe Support Repair Planner。**

它會讓 Hermes 從「把長 context 壓短」進化成：

> **知道哪些歷史資訊對下一步 action、風險判斷、因果校正與世界狀態仍然不可刪；知道何時目前資料不足以支持新的 Agent policy；並能在安全約束下主動補齊 support。**
