# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 06:52 Asia/Taipei**  
**本輪主題：Observability × Identifiability × Fisher Information × Safe Active Experiment Design × Terminal Controllability**

## 與歷史研究比較

上一輪已建立：

```text
Hidden Physical Variable θ
→ Belief p(θ)
→ Probe Candidate
→ Expected Information Gain
→ Physical Interaction
→ Telemetry
→ System Identification
→ Posterior Update
```

但這個鏈仍暗含一個危險假設：**只要主動量測，就一定能把未知參數辨識出來。** 本輪專門補這個缺口，不再重複「如何主動 probe mass/friction/stiffness」，而是回答：

1. 目前 sensor + action + horizon 下，哪些 latent states / parameters 根本不可觀測？
2. 哪些參數只在某些 excitation 下才可辨識？
3. Fisher Information Matrix（FIM）有 rank 不等於數值上好估；如何檢查 condition number、small eigenvalues、parameter coupling？
4. 如何設計新的 excitation 去打開 unidentifiable subspace？
5. 如何避免「非常有資訊，但危險或把 robot 帶到任務無法完成的 terminal state」？

因此這輪將 active probing 升級為：

```text
Unknown θ
→ Observability / Identifiability Analysis
→ Unidentifiable Subspace
→ Excitation Design
→ Fisher / Bayesian Information Objective
→ Safety + Task Compatibility + Terminal Controllability Gate
→ Execute Probe
→ Posterior Calibration
→ Re-test Identifiability
```

---

# 本小時新發現

## 新論文 / 新架構

### 1. ASID — Active Exploration for System Identification in Robotic Manipulation
- **Title:** ASID: Active Exploration for System Identification in Robotic Manipulation
- **Authors:** Marius Memmel, Andrew Wagenmaker, Chuning Zhu, Patrick Yin, Dieter Fox, Abhishek Gupta
- **Institution:** University of Washington / WEIRD Lab ecosystem
- **Year:** 2024, ICLR 2024 Oral
- **Paper:** https://arxiv.org/abs/2404.12308
- **Project:** https://weirdlabuw.github.io/asid/
- **Code:** https://github.com/WEIRDLabUW/asid
- **Core architecture:** randomized simulator → Fisher-information exploration policy → one/few real trajectories → SysID → refined simulator → task-policy training → zero-shot real deployment
- **Contribution:** 把「探索」本身的 objective 從 state coverage / curiosity 改成 parameter sensitivity / Fisher information。
- **Limitation:** 使用 simulator parameter perturbation 與 local sensitivity；對 model misspecification、partial observability、contact-mode switching、safety/terminal feasibility 的保證有限。

### 2. SPI-Active — Sampling-Based System Identification with Active Exploration for Legged Robot Sim2Real Learning
- **Authors:** N. Sobanbabu, G. He, T. He, Y. Yang, G. Shi
- **Venue:** CoRL 2025 Oral / PMLR 305
- **Paper:** https://proceedings.mlr.press/v305/sobanbabu25a.html
- **Project:** https://lecar-lab.github.io/spi-active_/
- **Code:** https://github.com/LeCAR-Lab/SPI-Active
- **Architecture:** omni locomotion controller → optimize command sequence for FIM → collect real trajectory → massively parallel simulation-based parameter search → sim-to-real policy
- **Contribution:** 把 FIM-based active excitation 延伸到 contact-rich legged system，並結合 sampling-based identification。
- **Reported result:** 對多項 locomotion transfer baselines 提升約 42–63%。
- **Limitation:** 公開 repository 的 active SysID guide 目前仍標示 data-collection 與後續 identification 指引「Stay tuned」，故完整 reproducibility 仍不完整。

### 3. Online Bayesian Experimental Design for Partially Observed Dynamical Systems
- **Authors:** Sara Pérez-Vieites, Sahel Iqbal, Simo Särkkä, Dominik Baumann
- **Year:** 2026
- **Paper:** https://arxiv.org/abs/2511.04403
- **Core idea:** 在 nonlinear state-space model 中，latent state 本身不可直接觀測，因此 EIG 必須 marginalize latent states；方法建立可在線更新 posterior 與 design 的 EIG / gradient estimator。
- **Why important:** Hermes 的 camera/contact/tool traces 本質上也是 partial observations；不能假設 observation 就是 full state。

### 4. System Identification under Constraints and Disturbance: A Bayesian Estimation Approach
- **Authors:** Sergi Martinez, Steve Tonneau, Carlos Mastalli
- **Year:** 2026
- **Paper:** https://arxiv.org/abs/2602.16358
- **Architecture:** joint state trajectory + physical parameter estimation，並加入 inverse dynamics、contact、loop closure、friction、disturbance 與 equality/inequality priors。
- **Contribution:** 特別強調 energy-based regressors 改善 parameter observability，並用 equality-constrained Riccati recursion 保持時間 horizon 的線性複雜度。
- **Why important:** observability 不只由 sensor 決定，也由「你量什麼 regression signal」決定。

### 5. When Identifiability Is Not Enough: Terminal Controllability in Task-Compatible Active Calibration
- **Author:** Jun Kobayashi
- **Institution:** Kyushu Institute of Technology
- **Year:** 2026
- **Paper:** https://doi.org/10.64898/2026.06.11.731593
- **Architecture:** two-phase calibration → task execution；比較 task-only、action information gain、null-space information gradient、finite-step task-compatible probing、posture regularization。
- **Key result:** finite-step probing 可以把 parameter RMSE 降得很好、消除 calibration failure，但仍可讓後續 task failure 達 44%；短 horizon terminal rollout risk 比 parameter RMSE 或 static singularity 更能預測下游失敗。
- **Limitation:** 主要是簡化的 kinematic redundant arm stress test；尚未涵蓋 contact、latency、actuator limits、full dynamics safety。

### 6. Amortized Safe Active Learning for Real-Time Data Acquisition
- **Authors:** Cen-You Li, Marc Toussaint, Barbara Rakitsch, Christoph Zimmer
- **Venue:** AISTATS 2026, PMLR 300
- **URL:** https://proceedings.mlr.press/v300/li26b.html
- **Contribution:** safe active learning 若每一步都重新做 GP update + constrained acquisition optimization 會太慢，因此把 acquisition policy amortize 成預訓練 neural policy；提供「安全探索必須進入 runtime latency budget」的工程訊號。

---

# 本小時最重要 5 個發現

## 發現 1 — Observability、Structural Identifiability、Practical Identifiability 是三層不同問題

### 是什麼

Hermes 不能只有：

```text
posterior uncertainty high
→ probe again
```

必須先問：

```text
這個 unknown 在目前 dynamics + sensors + controls 下
理論上有沒有可能被分辨？
```

可以先區分：

```text
Observability
= hidden state 是否能由 input/output history 重建

Structural Identifiability
= 在理想無限精確資料下，不同 θ 是否能產生唯一不同 output behavior

Practical Identifiability
= 在有限、含噪、有限 horizon 的真實資料下，θ 是否能被穩定估計
```

### 底層如何運作

對局部非線性 parameter estimation，可把 measurement model 在當前 θ 周圍線性化：

```text
y = h(x, θ, u)

Sensitivity:
Sθ = ∂y / ∂θ
```

若多個 parameter 的 sensitivity columns 幾乎共線：

```text
∂y/∂θ1 ≈ c · ∂y/∂θ2
```

則即使 y 對兩個參數都「敏感」，仍難區分到底是哪一個參數造成改變。

這會表現在：

```text
rank(Sθ) < dim(θ)
```

或帶 noise covariance R 時：

```text
FIM ≈ Sθᵀ R⁻¹ Sθ
```

出現小 eigenvalue / rank deficiency。

2025 practical-identifiability framework甚至從理論上把 practical identifiability 與 FIM invertibility 建立等價關係，並進一步處理 coordinate-wise identifiability。

來源：
- https://advanced.onlinelibrary.wiley.com/doi/full/10.1002/advs.202504346
- https://arxiv.org/abs/2501.01283

### 為什麼重要

Agent 若不先分析 identifiability，可能一直重複做更多同類 probe：

```text
push
push harder
push longer
```

但 mass/friction 仍在同一 observation direction 上糾纏，得到更多資料卻沒有增加可辨識維度。

### 限制

- Local rank / FIM 只描述局部 geometry。
- Nonlinear/global ambiguity 可能在局部 FIM 看似良好時仍存在。
- Model misspecification 下，「可辨識」的可能只是錯誤模型的參數。

### 狀態
**已確認理論 + 工程推論。**

---

## 發現 2 — Fisher Information 不是一個數，而是一個「parameter sensitivity geometry」

### 是什麼

常見錯誤是只顯示：

```text
Fisher score = 8.3
```

真正該看的至少是：

```text
FIM eigenvalues
rank
condition number
parameter correlation
null-space directions
```

### ASID 的實際底層實作

這輪直接讀 `WEIRDLabUW/asid`，公開 repository 的重要結構包括：

```text
train.py
env/
  robot/
  wrappers/
    asid_reward.py
    asid_vec.py
    asid_wrapper.py
    base_vec_env.py
configs/
utils/
```

其中 `env/wrappers/asid_reward.py` 沒有只寫抽象 Fisher 公式，而是直接對 simulator parameter 做 central finite difference：

```text
θ_i + δ
→ reset same full state
→ execute same action
→ obs_plus

θ_i - δ
→ reset same full state
→ execute same action
→ obs_minus

s_i = (obs_plus - obs_minus) / (2δ)
```

把每個 `s_i` 組成 gradient/sensitivity matrix `G`，reward 實際使用：

```text
reward = trace(Gᵀ G)
```

也就是鼓勵 action 讓 observation 對 parameter perturbation 有大 sensitivity。

### 一個重要的「論文/網站 vs code」差異

ASID project page 用 Fisher information 的概念表達：

```text
argmin trace(I(θ,π)^-1)
```

這更接近 A-optimal design：減少 parameter covariance 的總量。

但公開 `asid_reward.py` 的 instantaneous reward 是：

```text
trace(GᵀG)
```

較接近「總 sensitivity energy」。兩者不是同一個 objective。

這個差異很重要，因為：

```text
G = [[100, 100],
     [  0,   0]]
```

`trace(GᵀG)` 可以非常大，卻只有 rank 1：兩個參數仍完全糾纏。

因此：

> **Large Fisher-like sensitivity reward ≠ Full Parameter Identifiability**

### Hermes 應新增

```text
FisherGeometry
├ matrix
├ eigenvalues[]
├ effective_rank
├ min_eigenvalue
├ condition_number
├ logdet
├ trace_inverse
├ parameter_correlation
└ nullspace_basis[]
```

### 狀態
**GitHub 原始碼已確認。**

Code:
- https://github.com/WEIRDLabUW/asid/blob/main/env/wrappers/asid_reward.py
- https://github.com/WEIRDLabUW/asid/blob/main/train.py

---

## 發現 3 — 好的 Probe 應該「打開最弱 eigen-direction」，而不只是提高總 sensitivity

假設：

```text
θ = [mass, friction]
```

當前 FIM：

```text
λ1 = 120
λ2 = 0.03
```

代表有一條 parameter combination 已經量得很好，但另一條方向幾乎看不清。

如果新 probe 又只讓：

```text
λ1: 120 → 240
λ2: .03 → .04
```

它在 total trace 上看似非常有資訊，但 identifiability 幾乎沒改善。

因此 experiment design 可比較不同 optimality criteria：

```text
A-optimal: minimize trace(F^-1)
→ 降低平均 parameter variance

D-optimal: maximize log det(F)
→ 壓縮 uncertainty volume

E-optimal: maximize λ_min(F)
→ 提升最弱可辨識方向

Conditioning-aware:
minimize κ(F)
→ 避免極端 ill-conditioning
```

對 Hermes 的 active physical probe，**E-optimal / condition-aware objective 特別重要**，因為我們的目標不是只量得更多，而是消除 parameter ambiguity。

SPI-Active 的公開 active SysID guide 顯示它實際採用：

```text
omni locomotion controller
→ CMA-ES command sequence optimization
→ FIM objective
→ select command dimensions
→ finite-difference auxiliary envs
→ optimized best_commands.npz
```

其中 `delta_param=0.1`，並可以指定 `exploration_params=[mass]` 等參數；文件建議至少 1024 parallel environments 以取得較穩定 FIM estimation。

來源：
- https://github.com/LeCAR-Lab/SPI-Active/blob/main/active_sysid.md
- https://proceedings.mlr.press/v305/sobanbabu25a.html

### 重要限制

SPI-Active repository 現在的 guide 對「data collection」與「system identification pipeline」仍標示下一版本才提供完整操作，因此目前能確認 active command optimization，但不能宣稱已讀到完整 end-to-end real-data SysID code。

### 狀態
**論文結果 + 官方公開工程實作部分確認。**

---

## 發現 4 — Partial Observability 下，EIG 必須經過 latent state；不能把 sensor value 當 full state

上一輪 Hermes 使用：

```text
p(θ)
→ candidate probe
→ EIG
```

本輪要修成：

```text
latent state x_t
unknown θ
control u_t
observation y_t

x_{t+1} ~ p(x_{t+1}|x_t,u_t,θ)
y_t ~ p(y_t|x_t,θ)
```

Probe 的 information value 應計算：

```text
I(θ ; Y_future | history, probe)
```

但 `Y_future` 還依賴 latent trajectory：

```text
X_{t:t+H}
```

因此必須：

```text
p(Y | θ,u)
=
∫ p(Y,X | θ,u) dX
```

2026 的 Online Bayesian Experimental Design for Partially Observed Dynamical Systems 就專門處理這一點：在 nonlinear state-space model 中明確 marginalize latent states，再估 EIG 與 gradient。

這對 Hermes 尤其重要：

```text
Camera pixels
≠ object state
Force sensor
≠ contact mode
Tool log
≠ hidden runtime state
GPU metric
≠ model internal state
```

因此 active experiment planner 應和前面研究建立的：

```text
Belief State
Persistent Entity State
Physical Causal State
```

真正接起來，而不是直接對 raw sensor 做 EIG。

### 狀態
**2026 論文結果 + Hermes 架構推論。**

來源：
- https://arxiv.org/abs/2511.04403

---

## 發現 5 — Identifiable ≠ Safe ≠ Task-Compatible ≠ Terminally Controllable

這是本輪最重要的系統層結論。

即使 probe 能讓 FIM full rank：

```text
rank(F) = p
```

仍可能：

```text
碰撞
超 torque
讓物件掉落
進入不可逆狀態
耗盡 energy budget
離 task state 太遠
探索結束後任務 horizon 不夠回復
```

2026 的 terminal-controllability work 給了非常清楚的反例：

```text
Calibration RMSE 很低
≠ downstream task success
```

其 finite-step probing 消除了 calibration failure，但 plain downstream controller 在特定設定仍有 44% task failure；parameter RMSE 與 static singularity 對 task failure 幾乎沒有預測力，但短 horizon terminal rollout risk 可完美分離該實驗中的成功/失敗（AUC 1.0）。

來源：
- https://doi.org/10.64898/2026.06.11.731593

因此 Probe utility 應從上一輪的：

```text
U = α·EIG - β·risk - γ·time
```

升級成：

```text
U(probe)
=
 α · InformationGain
+ β · WeakDirectionGain
- γ · SafetyRisk
- δ · TaskDeviation
- ε · EnergyCost
- ζ · Irreversibility
- η · TerminalRolloutRisk
```

並增加 hard constraints：

```text
SafetyConstraint(probe) = true
TerminalFeasible(post_probe_state) = true
PermissionAllowed(probe) = true
```

### 狀態
**2026 paper result + Hermes runtime design。**

---

# Architecture Breakdown

本輪建議 Hermes 增加一個獨立的：

# **Observability & Experiment Design Plane**

```text
User Goal / Planner Goal
↓
Unknown / Uncertain Variable Detector
↓
Physical / Runtime Belief Store
↓
State-Space Model
├ latent state x
├ unknown parameter θ
├ action u
├ observation y
└ noise / disturbance
↓
Observability Analyzer
├ state observability
├ parameter sensitivity
├ sensor contribution
└ horizon contribution
↓
Identifiability Analyzer
├ structural ambiguity candidates
├ practical FIM
├ rank
├ eigen spectrum
├ condition number
├ correlation
└ null-space basis
↓
Weak-Direction Targeter
↓
Probe Candidate Generator
├ contact probe
├ motion probe
├ sensor-query probe
├ tool/API probe
└ multimodal observation probe
↓
Experiment Scorer
├ A-opt
├ D-opt
├ E-opt
├ Bayesian EIG
├ goal-oriented EIG
└ robust / worst-case information
↓
Task + Safety Gate
├ collision
├ force/torque
├ energy
├ irreversible state
├ permission
├ task deviation
└ terminal rollout feasibility
↓
Probe Executor
↓
Telemetry / Observation Bus
↓
Posterior + FIM Update
↓
Identifiability Re-check
├ SOLVED → ACT
├ PARTIAL → TARGET WEAK DIRECTION
└ UNIDENTIFIABLE → CHANGE SENSOR / MODEL / ACTION FAMILY
↺
```

---

# Bottom-Level Logic

## 1. Sensitivity Jacobian

對 unknown parameters：

```text
θ = [θ1, θ2, ... θp]
```

在 horizon H 收集 observation：

```text
Y = [y1, y2, ... yH]
```

local sensitivity：

```text
S = ∂Y / ∂θ
```

可用：

```text
autodiff
finite difference
adjoint sensitivity
simulator perturbation
learned local Jacobian
```

估計。

ASID code 使用 central finite difference：

```text
S_i ≈ [Y(θ+δe_i)-Y(θ-δe_i)]/(2δ)
```

---

## 2. Fisher Information Matrix

若 observation noise covariance = R：

```text
F = Sᵀ R⁻¹ S
```

解讀：

```text
large λ_i
→ 對某個 parameter combination 很敏感

small λ_i
→ 弱可辨識 direction

λ_i ≈ 0
→ local unidentifiable direction
```

但：

```text
F full rank
≠ numerically well-conditioned
```

因此至少檢查：

```text
rank(F)
λ_min(F)
κ(F)=λ_max/λ_min
logdet(F)
trace(F^-1)
```

---

## 3. Parameter Correlation / Coupling

若：

```text
mass ↑ + friction ↓
```

和：

```text
mass ↓ + friction ↑
```

產生近似 trajectory，則 posterior 呈長條 ridge。

不能用：

```text
σ_mass small?
σ_friction small?
```

單獨判斷，而需保留 covariance：

```text
Σ_θ
```

以及 correlation graph：

```text
mass ↔ friction  ρ=.94
mass ↔ damping   ρ=.21
```

Hermes 的 `PhysicalParameterBelief` 必須由 scalar confidence 升級為 joint belief。

---

## 4. Weak-Direction Probe Design

先做 eigendecomposition：

```text
F = V Λ Vᵀ
```

最弱方向：

```text
v_min = eigenvector(λ_min)
```

接著對每個 candidate action sequence u：

```text
Predict S(u)
→ F_candidate(u)
→ Evaluate increase along v_min
```

例如：

```text
Gain_weak(u)
=
v_minᵀ F_candidate(u) v_min
```

這比「讓 trace 最大」更直接地打開 blind direction。

---

## 5. Bayesian EIG

Local Fisher 是 curvature approximation；若 posterior 很 nonlinear / multi-modal，改用：

```text
EIG(u)
=
E_y [ KL(p(θ|y,u) || p(θ)) ]
```

但 partial observation 下需：

```text
p(y|θ,u)
=
∫ p(y,x|θ,u) dx
```

這也是 Online Bayesian Experimental Design 2026 的主要難點。

---

## 6. Safe Experiment Set

Probe 不只要有資訊：

```text
u ∈ U_info
```

還必須：

```text
u ∈ U_safe
∩ U_permission
∩ U_task_compatible
∩ U_terminal_feasible
```

最後選：

```text
u* = argmax U_info(u)
subject to all safety/task constraints
```

若 online constrained optimization 太慢，可參考 AISTATS 2026 amortized safe active learning，把安全 acquisition policy 在模擬階段預訓練，再進 runtime 做快速 action selection。

來源：
https://proceedings.mlr.press/v300/li26b.html

---

# Visual Simulation Idea

# **Observability & Active Experiment Design Lab**

這個模擬比上一輪 Hidden Physics Lab 再深一層，不只顯示 posterior，而是顯示「為什麼某些參數根本分不開」。

## View A — Parameter Geometry

```text
Parameter Space

mass ↑
     │        posterior ridge
     │      /////////
     │    /////////
     │  /////////
     └────────────────→ friction
```

旁邊顯示：

```text
Fisher eigenvalues
λ1  █████████████  124.2
λ2  ▏                .018

Rank              2/2
Condition number  6900
Status            PRACTICALLY ILL-CONDITIONED
```

直接教育使用者：

```text
Full rank
≠ good identifiability
```

## View B — Probe Comparison

```text
Probe         Trace(F)   λmin   Cond#   Risk   Terminal Risk
------------------------------------------------------------
Push fast       220      .02   9300    .21      .16
Lift             84      .71    118    .08      .03
Slide+turn      103     1.14     67    .12      .05
Squeeze          61      .09    680    .42      .07
```

Hermes 應選：

```text
Slide+turn
```

即使它不是最大 `Trace(F)`。

## View C — Eigenvector / Parameter Coupling

使用者點 `λmin`：

```text
Blind direction

+0.73 mass
-0.68 friction
+0.04 damping
```

Console 自動翻成：

> 目前資料無法區分「更重但更滑」和「更輕但更黏」。

然後顯示：

```text
Recommended excitation:
LIFT + controlled lateral slide
```

原因：lift 對 mass 強、lateral slip 對 friction 強，可把 sensitivity vectors 旋轉成較正交。

## View D — Terminal Controllability

Probe 之前：

```text
Task rollout success probability  .94
```

Probe candidate 後：

```text
Push fast     .51   REJECT
Lift          .91   PASS
Slide+turn    .88   PASS
```

這把「知道更多」和「還做得完任務」放進同一個可視化。

---

# Code / GitHub

## WEIRDLabUW/asid

Repo:
https://github.com/WEIRDLabUW/asid

值得讀的目錄 / 核心檔案：

```text
env/wrappers/asid_reward.py
  - central finite-difference parameter perturbation
  - observation sensitivity matrix
  - trace(G^T G) reward

env/wrappers/asid_wrapper.py
  - ASID environment/runtime wrapper

env/wrappers/asid_vec.py
  - vectorized environment construction

train.py
  - SAC exploration-policy training loop
  - parallel train/eval environments

configs/
  - inertia / friction / robot DoF / horizon / safety configuration
```

### 關鍵工程讀法

```text
Simulator Parameter θ
→ +δ / -δ auxiliary rollouts
→ observation difference
→ sensitivity gradient
→ Fisher-like reward
→ SAC policy
→ exploration trajectory
```

這裡的 reward 是 local sensitivity proxy，不要在 Hermes 文件裡誤稱成完整 Bayesian information gain。

---

## LeCAR-Lab/SPI-Active

Repo:
https://github.com/LeCAR-Lab/SPI-Active

值得讀：

```text
active_sysid.md
spigym/run_active_sysid.py
spigym/config/algo/active_sysid.yaml
spigym/config/env/active_sysid_openloop.yaml
spigym/
isaac_utils/
```

目前可確認 architecture：

```text
Omni Controller
→ command sequence parameterization
→ CMA-ES / Optuna-style search
→ finite-difference perturbation environments
→ FIM scoring
→ best_commands.npz
```

需特別標記：

```text
Active command optimization       CONFIRMED
FIM-oriented guide               CONFIRMED
Full real data collection code   PARTIALLY / NOT YET VERIFIED
Complete SysID stage             PARTIALLY / NOT YET VERIFIED
```

因為官方 guide 仍明確寫 Data Collection 與 System Identification Pipeline 的後續指引尚未完整發布。

---

# Papers

## Paper A — ASID
**Title:** ASID: Active Exploration for System Identification in Robotic Manipulation  
**Authors:** Marius Memmel, Andrew Wagenmaker, Chuning Zhu, Patrick Yin, Dieter Fox, Abhishek Gupta  
**Year:** 2024  
**URL:** https://arxiv.org/abs/2404.12308  
**Code:** https://github.com/WEIRDLabUW/asid  
**Dataset:** task-specific simulation + real robot trajectories; no single general dataset  
**Architecture:** Simulator → Fisher exploration → Real rollout → SysID → Rebuild simulator → Task policy  
**Contribution:** parameter-sensitive exploration instead of generic exploration.  
**Limitations:** local simulator sensitivity、model mismatch、safety/terminal feasibility 未完整統一。  
**改變了什麼：** 讓「動作是為了收集辨識參數的資訊」成為可訓練 policy objective。

## Paper B — SPI-Active
**Title:** Sampling-based System Identification with Active Exploration for Legged Sim2Real Learning  
**Authors:** N. Sobanbabu, G. He, T. He, Y. Yang, G. Shi  
**Year:** 2025  
**URL:** https://proceedings.mlr.press/v305/sobanbabu25a.html  
**Code:** https://github.com/LeCAR-Lab/SPI-Active  
**Dataset:** robot real/sim locomotion trajectories  
**Architecture:** massive parallel sampling SysID + FIM-maximizing command optimization  
**Contribution:** 將 active SysID 帶入 legged contact-rich Sim2Real。  
**Limitations:** public end-to-end instructions/code 仍部分未發布。  
**改變了什麼：** 說明 Fisher excitation 不只適用簡單 manipulation，也能作用於高維 locomotion input sequence。

## Paper C — Online Bayesian Experimental Design for Partially Observed Dynamical Systems
**Authors:** Sara Pérez-Vieites, Sahel Iqbal, Simo Särkkä, Dominik Baumann  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2511.04403  
**Architecture:** nonlinear state-space model + latent-state marginalization + online posterior/design optimization  
**Contribution:** 在 partial observability 下估 EIG，而不是假裝 latent state 已知。  
**Limitations:** 計算成本與 approximation quality 仍是 runtime bottleneck。  
**改變了什麼：** 把 active experiment design 真正接到 belief-state systems。

## Paper D — System Identification under Constraints and Disturbance
**Authors:** Sergi Martinez, Steve Tonneau, Carlos Mastalli  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2602.16358  
**Architecture:** constrained Bayesian estimation + inverse dynamics + friction + contact + disturbance + Riccati recursion  
**Contribution:** joint trajectory/parameter estimation 並主動改善 observability。  
**Limitations:** 依賴明確 dynamics structure；對完全未知 world model 仍需 learned layer。  
**改變了什麼：** observability 不只看 sensor selection，也可以透過 regressor / energy signal design 改善。

## Paper E — When Identifiability Is Not Enough
**Author:** Jun Kobayashi  
**Institution:** Kyushu Institute of Technology  
**Year:** 2026  
**URL:** https://doi.org/10.64898/2026.06.11.731593  
**Architecture:** finite-step task-compatible calibration + terminal rollout-risk analysis  
**Contribution:** 明確分離 identifiability、task-compatible exploration、terminal controllability。  
**Limitations:** simplified kinematic study；未覆蓋 full physical contact/safety。  
**改變了什麼：** 顯示「估準了」仍不代表「任務做得完」。

## Paper F — Amortized Safe Active Learning
**Authors:** Cen-You Li, Marc Toussaint, Barbara Rakitsch, Christoph Zimmer  
**Year:** 2026  
**URL:** https://proceedings.mlr.press/v300/li26b.html  
**Architecture:** offline simulated safe-AL tasks → neural acquisition policy → low-latency online selection  
**Contribution:** 把 safe experimental design 的 expensive online optimization amortize。  
**Limitation:** regression-oriented setting，不是完整 embodied-agent contact dynamics。  
**改變了什麼：** 顯示安全實驗設計必須同時考慮 computation deadline。

---

# 已確認事實 / 工程實作 / 推論 / 未驗證假說

## 已確認事實
- ASID 以 Fisher-information-oriented exploration 做 active SysID。
- ASID 公開 `asid_reward.py` 使用 finite-difference observation sensitivity，並以 `trace(G.T @ G)` 當 reward。
- SPI-Active 使用 FIM-maximizing command sequence optimization，公開 guide 提到 finite-difference auxiliary environments 與 CMA-ES/Optuna-style command optimization。
- Partial-observation BED 2026 明確處理 latent-state marginalization。
- 2026 terminal-controllability study顯示 calibration accuracy 與 downstream task executability 可分離。

## 工程實作建議
- Hermes 建 `FisherGeometry` 而非單一 Fisher score。
- Joint posterior covariance 必須保存 parameter coupling。
- Probe planner 優先修復 weakest eigen-direction，而不只追求 sensitivity sum。
- Safety 與 terminal feasibility 應成為 hard/soft constraints。

## 合理推論
- 對 Agent OS / MCP runtime 的 hidden states，也能使用 observability/identifiability 思維：不同 tool/runtime causes 若對 trace 產生相同 output signature，就不可從觀察資料單獨辨識。
- Multimodal sensor selection 本身可被視為 experiment design：決定下一步該看 camera、depth、audio、logs、GPU telemetry，等價於選 measurement channel。

## 尚未驗證假說
- `E-optimal + terminal-risk gate` 是否比純 Bayesian EIG 更適合 long-horizon embodied-agent active probing。
- 是否能建跨 modality 的 unified Fisher geometry，讓 image/depth/tactile/tool traces 共用同一 identifiability matrix。
- learned world model 的 Jacobian/Fisher geometry 在 distribution shift 下是否足以作 safety-critical design。

---

# Unknown / Open Questions

## 1. Model-based Identifiability 與 Reality Identifiability 如何區分？

若 simulator model 錯了：

```text
F_model full rank
```

只證明「在這個模型裡參數分得開」，不表示真實世界的 causal variables 真的是這些 parameter。

需要：

```text
Model Adequacy Test
Residual Structure Test
Out-of-model Cause Detector
```

## 2. Non-smooth contact dynamics 的 sensitivity 怎麼穩定估？

Contact onset / detach / friction regime switching 讓：

```text
∂y/∂θ
```

可能不連續，finite difference 對 δ 極敏感。

需要比較：
- smoothing surrogate
- generalized derivative
- sampling-based information measure
- likelihood-free Bayesian design

## 3. Multi-Objective Probe 應如何分配 information / safety / task feasibility？

固定權重：

```text
α EIG - β risk
```

太粗糙。成熟 runtime 應考慮：

```text
Constraint-first optimization
lexicographic priority
risk budget
chance constraints
CVaR
terminal viability kernel
```

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Observability
Model Observability
Parameter Observability
Structural Identifiability
Practical Identifiability
Coordinate Identifiability
Sensitivity Jacobian
Fisher Information Matrix
Fisher Eigenvalue
Effective Fisher Rank
Fisher Condition Number
Unidentifiable Subspace
Weak Parameter Direction
Parameter Coupling
Joint Parameter Posterior
A-Optimal Design
D-Optimal Design
E-Optimal Design
Goal-Oriented EIG
Partial-Observation EIG
Excitation Trajectory
Task-Compatible Excitation
Terminal Controllability
Terminal Rollout Risk
Safe Experiment Set
Observability Certificate
Identifiability Certificate
Experiment Design Certificate
```

## 新增 Edges

```text
ProbeAction --INDUCES→ SensitivityJacobian
SensitivityJacobian --DEFINES→ FisherInformation
FisherInformation --HAS_EIGEN_DIRECTION→ ParameterCombination
SmallEigenvalue --INDICATES→ WeakIdentifiability
RankDeficiency --INDICATES→ LocalUnidentifiableSubspace
ParameterCoupling --CREATES→ PosteriorRidge
ExcitationTrajectory --ROTATES→ SensitivityGeometry
ExperimentDesign --TARGETS→ WeakParameterDirection
ObservationChannel --CONTRIBUTES_TO→ Observability
TerminalState --HAS→ TerminalRolloutRisk
ProbeAction --MUST_PRESERVE→ TerminalControllability
```

## 新增否定關係

```text
High Sensitivity ≠ Identifiability
Large Trace(F) ≠ Full-Rank Information
Full-Rank FIM ≠ Well-Conditioned Estimation
Structural Identifiability ≠ Practical Identifiability
Observability ≠ Low Estimation Error
Small Posterior ≠ Correct Model
Identifiable ≠ Safe
Identifiable ≠ Task-Compatible
Identifiable ≠ Terminally Controllable
Fisher Information ≠ Bayesian EIG
Model Observability ≠ Reality Observability
One Informative Probe ≠ Global Parameter Identification
```

---

# 下一輪研究

本輪之後最大的缺口已變成：

# **Model Misspecification × Reality Gap × Residual Diagnostics × Out-of-Model Cause Discovery**

因為現在 Hermes 可以分析：

```text
在目前 model class 裡，θ 是否可辨識？
```

但還不能回答：

```text
如果真正原因根本不在 θ 裡怎麼辦？
```

例如：

```text
模型只有 [mass, friction]

真實世界還有：
compliance
backlash
contact patch change
temperature
sensor bias
motor saturation
unmodeled external force
```

此時再好的 FIM 也只是把錯模型估得更精確。

下一輪建議研究：

```text
Prediction Residual
↓
Whiteness / Autocorrelation Test
↓
Residual-State Dependence
↓
Residual-Action Dependence
↓
Cross-Modal Residual Consistency
↓
Model Misspecification Detector
↓
Latent Cause Proposal
↓
Alternative Model Class
↓
Discriminating Experiment Design
↓
Model Posterior
```

需優先追：
- Bayesian model criticism
- posterior predictive checks
- likelihood-free / simulation-based calibration
- active model discrimination
- dual control under model uncertainty
- robust Bayesian experimental design
- system identification with model discrepancy
- world-model uncertainty decomposition

特別值得追 2026 的 **Maximin Robust Bayesian Experimental Design**，它把 model misspecification 納入 max-min experimental design，使用 robust information objective，而不是假設 prior/model 永遠正確：
https://arxiv.org/abs/2603.14094

---

# 本輪結束檢查

**缺哪一層？**  
Model misspecification / out-of-model latent cause detection。

**哪個節點最淺？**  
Non-smooth contact dynamics 下的 Fisher / sensitivity reliability。

**哪個概念仍只是名詞？**  
Cross-Modal Observability Certificate、Unified Agent Identifiability ABI、Terminal Viability Certificate。

**哪個系統值得讀原始碼？**  
第一優先 `WEIRDLabUW/asid/env/wrappers/asid_reward.py` 與 `asid_wrapper.py`；第二優先 `LeCAR-Lab/SPI-Active/spigym/run_active_sysid.py` 與 active SysID config/runtime。

**哪篇論文需追引用？**  
ASID → SPI-Active → 2026 Online Bayesian Experimental Design for Partially Observed Dynamical Systems；並追 Terminal Controllability paper 的 active-calibration references。

**哪個概念最適合視覺模擬？**  
`Observability & Active Experiment Design Lab`：FIM eigen-spectrum + posterior ridge + probe sensitivity vectors + safety/terminal-feasibility overlays。

**哪個 Agent 架構最值得實作？**  

> **Identifiability-Aware Active Agent Runtime = Belief State + Sensitivity/Fisher Geometry + Weak-Direction Detector + Bayesian/Optimal Experiment Designer + Safety Gate + Terminal Controllability Gate + Posterior Calibration + Re-identification Loop**

---

# 對「AI 到底怎麼運作」知識圖譜的新增位置

現在 physical / multimodal Agent 鏈可以進一步還原為：

```text
User Goal
↓
Planner
↓
World / Physical Belief
↓
Unknown Detector
↓
Observability / Identifiability Analysis
↓
Experiment Design
↓
Safe Probe Action
↓
Robot / Tool / MCP Execution
↓
Camera / Depth / Tactile / Torque / Logs
↓
Encoder / State Estimator
↓
Sensitivity + Fisher Geometry
↓
Joint Parameter Posterior
↓
World Model Update
↓
Terminal Feasibility Check
↓
Task Planning
↓
Action
```

多模態版本則變成：

```text
Camera / Image / Voice / Video / Depth / Touch
↓
Encoder
↓
Latent State Belief
↓
「哪一個 hidden variable 目前看不見？」
↓
「哪一個 sensor / action 能讓它變得可辨識？」
↓
Active Multimodal Experiment
↓
New Evidence
↓
Posterior + Identifiability Update
↓
Reasoning
↓
Agent Action
```

**本輪最核心的推進：AI Agent 不應把「不知道」只表示成一個低 confidence。成熟 Agent 還必須區分「只是還沒量到」和「照現在的 sensor/action 設計根本分不出來」。只有先找出不可辨識方向，再主動設計能打開那些方向、又不破壞安全與後續任務可行性的 experiment，Agent 才真正開始具備科學式的主動認知能力。**