# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 08:51 Asia/Taipei**  
**本輪主題：Model-Class Discovery × Equation Discovery × Mechanism Induction × Symbolic/Neural Hybrid Dynamics**

## 與歷史研究比較

上一輪已建立：

```text
Prediction
→ Observation
→ Structured Residual
→ Misspecification Detection
→ Missing Cause Hypothesis
→ Model Bank
→ Discriminating Experiment
→ Model Posterior
```

但仍假設候選模型 M1/M2/M3 由人先提供。本輪不再重複 residual diagnostics，而專門回答：

1. Agent 如何從 residual 與 transition evidence 自己提出「少了哪個 state / term / interaction / equation form」？
2. 如何從連續資料建立可執行的 symbolic dynamics，而不是只訓練黑箱 predictor？
3. LLM 應該直接寫 equation，還是只負責控制 search space？
4. 如何避免 symbolic regression 找到數值上漂亮、物理上錯誤的公式？
5. Agent 如何把「候選機制 → 驗證 → 失敗 → 修正 → 新實驗」變成 runtime loop？

核心新鏈：

```text
Residual / Transition Conflict
→ Structural Hypothesis Generator
→ Candidate State / Interaction Terms
→ Candidate Function Library / Program Search Space
→ Sparse / Symbolic / Program Discovery
→ Multi-Trajectory Verification
→ Physical / Causal Admissibility Gate
→ Counterexample Preservation Test
→ Discriminating Experiment
→ Mechanism Certificate
→ Executable World Model
```

---

# 本小時新發現

## 1. Verifier-Guided Model Discovery for Physical Dynamical Systems with Pretrained Symbolic Transformers
- **Authors:** Farbod Faraji, Francesco Belardinelli
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2608.02662
- **Architecture:** pretrained symbolic transformer (ODEFormer) 產生多個 equation candidates → multi-trajectory pool → dynamical verifier + physical-admissibility verifier → selected reduced-order model。
- **Contribution:** 把「生成 equation」與「相信 equation」完全分離。候選可以由 pretrained symbolic transformer 提出，但 retention 要靠 dynamics / physics verifier。
- **重要結果:** 在 Van der Pol 與 vortex shedding 上，verifier-guided workflow 能從 latent/reduced coordinates 中篩出可跨 initial condition / parameter regime 泛化的方程；單看 reconstruction fidelity 不足以預測 symbolic discoverability。
- **限制:** latent coordinates 若與 symbolic backbone 預訓練分布不相容，equation discovery 仍會失效；因此 latent representation 本身成為 discovery bottleneck。
- **改變了什麼:** 前一輪 Hermes 的 Model Bank 是人工候選；這篇顯示可以把 `candidate generation` 交給 symbolic model，但必須外掛 verifier。

## 2. Language models guide symbolic equation discovery by controlling search (LLM-PySR)
- **Authors:** Zikai Xie, Wenmei Li, Man Luo, Jun Jiang, Linjiang Chen
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.04156
- **Code:** https://github.com/XieZikai/LLM-PySR
- **Dataset:** 74 AI-Feynman equations + 7 complex formula-recovery tasks + independent battery dataset
- **Architecture:** Search Space Planner Agent → PySR symbolic search → Candidate Reviewer → deterministic metric gate → Experience Memory Agent → next search plan。
- **Contribution:** LLM 不直接負責 equation 最終真偽，而是提出 variables/operators/transforms/search depth；PySR 負責 enumeration/constant fitting；最終保留仍由 numerical metrics 約束。
- **結果:** paper 報告 search-controller role 在 accuracy / complexity / stability / cost 之間表現最好，並在 battery dataset 找到 compact piecewise-linear relation。
- **限制:** LLM search prior 仍可能漏掉真正 operator / state variable；deterministic gates 也只能驗證已觀測資料與選定 metric。
- **改變了什麼:** Hermes 的 LLM 最適合扮演 `Hypothesis/Search Controller`，而不是 `Equation Judge`。

## 3. Baba in Wonderland: Online Self-Supervised Dynamics Discovery for Executable World Models
- **Authors:** SeungWon Seo, DongHeun Han, SeongRae Noh, HyeongYeop Kang
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.16725
- **System:** Alice
- **Architecture:** persistent executable program → observed transition → candidate code update → preservation test → rejected update產生 counterexamples → hypothesis-class split → class-aware exploration → next update。
- **Contribution:** 「更新失敗」不是垃圾，而是結構訊號。若新 program 能解釋新 transition 卻破壞舊 transition，lost set 代表目前程式把不同 dynamics 錯誤合併。
- **結果:** 在 semantically remapped Baba in Wonderland 中，Alice 報告 online All Accuracy 0.982、Balanced Accuracy 0.973；WorldCoder 對應為 0.568 / 0.198。
- **限制:** deterministic / discrete / symbolic environment；exact replay verification 可行，尚不能直接等同連續 stochastic physical world。
- **改變了什麼:** Hermes 的 residual/conflict 可以進一步形成 `Mechanism Split Evidence`，不是只有 anomaly score。

## 4. Data-driven Progressive Discovery of Physical Laws — Chain of Symbolic Regression (CoSR)
- **Authors:** Mingkun Xia, Weiwei Zhang
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2603.13727
- **Architecture:** 將一個巨大 end-to-end symbolic search 拆成多個具有物理意義的 knowledge units，逐步串接成 law discovery chain。
- **Contribution:** 直接指出 one-shot symbolic regression 容易產生長、無物理意義、泛化差的式子；progressive discovery 更接近科學實際形成理論的方式。
- **案例:** Kepler → universal gravitation、Rayleigh–Bénard convection、pipe flow、laser-metal interaction、aircraft aerodynamic scaling。
- **限制:** knowledge-unit decomposition 仍需要 structural bias；不保證未知領域能自動找到正確 decomposition。
- **改變了什麼:** Hermes 的 mechanism graph 應支援「局部機制節點逐步組合」，而不是只存一條最終 equation string。

## 5. PySINDy / Sparse Identification of Nonlinear Dynamics
- **Code:** https://github.com/dynamicslab/pysindy
- **Current package architecture:** `pysindy/_core.py`, `pysindy/_sindypi.py`, `pysindy/_weak.py`, `differentiation/`, `feature_library/`, `optimizers/`, `utils/`。
- **核心工程事實:** `_BaseSINDy` 將 `feature_library` 與 `optimizer` 明確分離；預設為 `PolynomialLibrary` + `STLSQ`。`predict()` 先用 feature library transform，再把 feature matrix 交給 optimizer；`coefficients()` 直接讀 sparse coefficient matrix。
- **Contribution:** 提供非常乾淨的 `state data → candidate features Θ(X) → sparse coefficient matrix Ξ → executable differential equations` runtime pattern。
- **限制:** candidate library 若缺真正 term，稀疏回歸永遠不可能發現；數值微分對 noise 很敏感，因此 weak formulation / smoothing / robust differentiation 很重要。

---

# 本小時最重要 5 個發現

## 發現 1：Model Discovery 必須拆成「提出」與「驗證」兩個不同權限

### 是什麼

```text
Hypothesis Generator
≠
Hypothesis Verifier
```

LLM / symbolic transformer 可以提出 candidate，但不應自己宣告真實。

### 底層如何運作

```text
Residual pattern
→ candidate missing terms
→ equation/program proposals
→ rollout on training trajectories
→ rollout on held-out trajectories
→ invariance / constraint checks
→ intervention tests
→ retain / reject
```

Verifier 至少需要：

```text
Numerical Fit
Generalization
Stability
Physical Constraints
Conservation
Causal / Intervention Compatibility
Complexity / Parsimony
```

### 為什麼重要
上一輪已證明「fit 好 ≠ model 真」。本輪再往前一步：即使 candidate 是由高階 LLM 提出，也不能跳過 deterministic / physical verification。

### 限制
Verifier 本身也可能 misspecified；因此 verifier 應 versioned，並保存 evidence roots。

### 狀態
- **已確認事實:** Verifier-Guided Model Discovery 明確採候選產生與 verifier 分離。
- **工程推論:** Hermes 應將 generator 與 verifier 分成不同 runtime capability / permission boundary。

---

## 發現 2：LLM 最適合控制搜尋空間，而不是直接寫最後公式

LLM-PySR 提供一個很適合 Agent Runtime 的分工：

```text
LLM
↓
variables / operators / transforms / depth
↓
Symbolic Search Engine
↓
Candidate Equations
↓
Deterministic Metrics
↓
LLM Semantic Review / Memory
↓
Next Search Plan
```

這和一般「叫 LLM 猜 equation」有本質差別。

Hermes 可建立：

```text
MechanismSearchPlan
├ target_state
├ candidate_latent_states[]
├ allowed_operators[]
├ allowed_interactions[]
├ dimensional_constraints[]
├ symmetry_constraints[]
├ max_complexity
├ forbidden_terms[]
├ evidence_roots[]
└ search_budget
```

新的關鍵否定：

```text
LLM Plausibility ≠ Equation Validity
LLM Equation Generation ≠ Scientific Discovery
```

---

## 發現 3：SINDy 的真正底層是「候選函數空間 + 稀疏支持集選擇」

對 state：

```text
X = [x1, x2, ...]
```

先建立 candidate feature library：

```text
Θ(X) = [1, x1, x2, x1², x1x2, sin(x1), ...]
```

再求：

```text
X_dot ≈ Θ(X) Ξ
```

其中 `Ξ` 應該 sparse。

也就是 equation discovery 實際分成：

```text
State Measurement
→ Derivative / Weak Form
→ Feature Library
→ Design Matrix Θ
→ Sparse Regression
→ Active Terms
→ Equation
→ Rollout Verification
```

真正的 model-class discovery 發生在兩層：

1. **Library discovery:** 哪些 candidate terms 應存在？
2. **Support discovery:** 候選中哪些 term 的 coefficient 應非零？

因此：

```text
Sparse Regression
≠ Full Model-Class Discovery
```

如果真正機制是 `contact_mode × velocity`，但 Θ 裡從未出現它，再好的 sparse optimizer 也找不到。

Hermes 必須讓上一輪的 residual engine 反向擴充 feature library。

---

## 發現 4：更新失敗可以直接當成「機制應分裂」的證據

Alice 提供很重要的 runtime pattern：

```text
Candidate Q
explains new transition
BUT
breaks old transitions
```

不能只做：

```text
reject Q
```

而應：

```text
lost transitions
↓
find common context
↓
current mechanism class conflates two regimes
↓
split hypothesis class
↓
learn conditional dynamics
```

物理 Agent 例子：

```text
原模型：F_friction = μN
```

某候選能解釋低速資料卻破壞高速資料，可能不是 coefficient 錯，而是需要：

```text
STATIC_FRICTION mode
DYNAMIC_FRICTION mode
```

或：

```text
stick
slip
```

因此本輪新增：

```text
PreservationConflict
MechanismSplitEvidence
RegimeHypothesis
TransitionClass
```

---

## 發現 5：最終 world model 不應只有 equation，而應是「可執行 Mechanism Graph」

單條：

```text
x_dot = f(x,u)
```

不足以描述大型 Agent world。

更適合的是：

```text
Mechanism Graph

Action
  ↓
Contact Regime
  ↓
Force Transmission
  ↓
Material Response
  ↓
State Transition
```

每個節點可以是：

```text
Symbolic equation
Discrete program rule
Neural residual
State machine
Constraint
Learned latent transition
```

並且每個 edge 帶：

```text
condition
confidence
regime
intervention evidence
counterexamples
model epoch
```

這形成：

> **Symbolic / Neural Hybrid Executable World Model**

而不是強迫所有未知現象都變成一條漂亮公式。

---

# Architecture Breakdown

## Mechanism Discovery Runtime

```text
Multimodal Observation Bus
├ Vision / Video
├ Audio
├ Tool / MCP traces
├ Robot proprioception
├ Contact / Force
└ Runtime telemetry
        ↓
Belief / World State
        ↓
Existing Executable Model
        ↓
Prediction
        ↓
Observation
        ↓
Residual + Preservation Conflicts
        ↓
Structural Hypothesis Generator
├ missing latent state?
├ missing interaction edge?
├ missing nonlinear term?
├ wrong regime boundary?
├ wrong equation form?
└ wrong execution order?
        ↓
Mechanism Search Controller (LLM)
├ variables
├ operators
├ transformations
├ invariants
├ dimensions
├ priors
└ complexity budget
        ↓
Candidate Discovery Engines
├ PySINDy / Weak SINDy
├ PySR
├ Symbolic Transformer
├ Program Synthesis
├ State-Machine Induction
└ Neural Residual
        ↓
Candidate Pool
        ↓
Verifier Plane
├ held-out trajectories
├ multi-initial-condition rollout
├ physical admissibility
├ conservation
├ causal intervention
├ counterexample preservation
├ stability
└ complexity
        ↓
Mechanism Posterior / Model Competition
        ↓
Discriminating Experiment Designer
        ↓
Safety / Permission Gate
        ↓
World Interaction
        ↓
New Evidence
        ↓
Mechanism Certificate
        ↓
Executable World Model / Knowledge Graph
        ↺
```

---

# Bottom-Level Logic

## A. SINDy mechanism

```text
samples X(t)
↓
X_dot(t)
↓
Θ(X,U)
↓
solve sparse Ξ
↓
X_dot = Θ Ξ
```

Sparse objective 可抽象為：

```text
Ξ* = argmin_Ξ ||X_dot - ΘΞ||² + λ R_sparse(Ξ)
```

PySINDy current source 中 `_BaseSINDy` 明確把 `feature_library` 和 `optimizer` 分開；預設 optimizer 是 STLSQ、library 是 PolynomialLibrary。predict path 則是：

```text
x
→ feature_library.transform(x)
→ optimizer.predict(features)
```

這非常適合 Hermes 將「library proposal」交給 Agent，而把 sparse fitting 交給 deterministic engine。

## B. Weak Form

Noise 很大時：

```text
numerical derivative
```

本身可能把 noise 放大。因此 Weak SINDy 類方法不直接依賴 pointwise derivative，而是把 dynamics 乘 test functions 後在時間/空間 window 積分，將微分搬到較平滑的 test function 上。

對 Hermes 的意義：

```text
Raw residual high
```

先不要立刻增加新 mechanism，必須先排除 derivative-estimation artifact。

## C. Regime discovery

完整機制可能不是單一 smooth ODE，而是：

```text
if contact == false:
    dynamics = free_motion
elif stick:
    dynamics = static_contact
elif slip:
    dynamics = dynamic_contact
```

因此 model discovery 還要支援：

```text
Continuous Equation Discovery
+
Discrete Regime Discovery
+
Transition Boundary Discovery
```

## D. Candidate Verification

對 candidate M_i：

```text
Score(M_i)
=
w_fit Fit
+w_gen Generalization
+w_phys PhysicalValidity
+w_int InterventionConsistency
+w_pres Preservation
-w_comp Complexity
-w_unst Instability
```

但最終不應壓成單一 scalar 後遺失結構；應保存完整 vector certificate。

---

# Visual Simulation Idea

# **Mechanism Discovery & Equation Induction Lab**

畫面左側：真實 trajectory / residual。

```text
Observed velocity
────────────╲____
Predicted velocity
───────────────╲_

Residual spike begins at CONTACT_ON
```

中央顯示 candidate feature library：

```text
[✓] velocity
[✓] normal_force
[ ] velocity²
[ ] normal_force × velocity
[ ] contact_mode × velocity
[ ] temperature × friction
```

使用者可以開啟：

```text
AUTO EXPAND LIBRARY
```

系統顯示：

```text
Residual conditioned on CONTACT_ON
→ propose:
  contact_mode × velocity
  compliance_state
```

接著右側即時顯示 sparse coefficient path：

```text
λ high
velocity                 ███
contact×velocity         0
compliance               0

λ lower
velocity                 ███
contact×velocity         ██
compliance               ▏
```

再切換：

```text
SINDy
Weak SINDy
PySR
LLM-Controlled PySR
Symbolic Transformer
Program Induction
```

最後顯示 verifier dashboard：

```text
Candidate M7

Training fit            PASS
Held-out rollout        PASS
Conservation            PASS
Counterfactual          PASS
Old-transition preserve FAIL

Lost cases:
STATIC CONTACT only

→ SUGGEST REGIME SPLIT
```

再自動生成：

```text
REGIME A: FREE / SLIP
REGIME B: STATIC CONTACT
```

這個模擬器能把「AI 如何從資料長出規則」真正視覺化。

---

# Code / GitHub

## 1. PySINDy
**Repository:** https://github.com/dynamicslab/pysindy

本輪確認值得深入的核心：

```text
pysindy/
├ _core.py
├ _sindypi.py
├ _weak.py
├ differentiation/
├ feature_library/
├ optimizers/
└ utils/
```

### 最值得讀
- `pysindy/_core.py`：SINDy orchestration、feature transform、optimizer coupling、predict / equations。
- `pysindy/_weak.py`：weak formulation，直接關係 noisy/irregular observations。
- `pysindy/feature_library/`：candidate model-class vocabulary。
- `pysindy/optimizers/`：STLSQ / SR3 / SINDyPI 等 support-selection engine。
- `pysindy/_sindypi.py`：implicit dynamics discovery。

### 對 Hermes 最值得借用的 abstraction

```text
FeatureLibrary
Optimizer
Differentiator
Verifier
```

應拆開，不要做一個黑盒 `discover_equation()`。

## 2. LLM-PySR
**Repository:** https://github.com/XieZikai/LLM-PySR

本輪確認 root `src/` 包含：

```text
src/
├ agents/
├ app/
├ runtime/
├ config.py
├ run_from_yaml.py
└ example_config.yaml
```

`src/runtime/` 已確認：

```text
llm_client.py
llm_pipeline.py
pysr_runner.py
```

其中 `llm_pipeline.py` 超過 120 KB，表示真正 agent loop / orchestration 已落在 runtime，而 `pysr_runner.py` 單獨封裝 symbolic engine。這正符合 Hermes 所需的：

```text
Agent Search Controller
≠ Numerical Discovery Engine
```

下一輪值得繼續追：
- `src/runtime/llm_pipeline.py`
- `src/runtime/pysr_runner.py`
- `src/agents/`

---

# Papers

## Paper A
**Title:** Verifier-Guided Model Discovery for Physical Dynamical Systems with Pretrained Symbolic Transformers  
**Authors:** Farbod Faraji, Francesco Belardinelli  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2608.02662  
**Architecture:** ODEFormer candidate pool → dynamical/physical verification → model selection  
**Contribution:** symbolic candidate generator 與 verifier 解耦，支援 high-dimensional physical data 經 reduced coordinates 做 interpretable model discovery。  
**Limitations:** latent-coordinate compatibility 仍是 bottleneck；symbolic discoverability 不等於 reconstruction quality。

## Paper B
**Title:** Language models guide symbolic equation discovery by controlling search  
**Authors:** Zikai Xie, Wenmei Li, Man Luo, Jun Jiang, Linjiang Chen  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2607.04156  
**Code:** https://github.com/XieZikai/LLM-PySR  
**Dataset:** AI-Feynman 74 equations; 7 complex tasks; battery dataset  
**Architecture:** LLM Search Planner → PySR → Candidate Review → deterministic retention → Memory  
**Contribution:** 證明 LLM 作 search controller 比直接 equation author 更適合作為 discovery orchestration。  
**Limitations:** search-space proposal 仍可能漏掉未知 variable/operator。

## Paper C
**Title:** Baba in Wonderland: Online Self-Supervised Dynamics Discovery for Executable World Models  
**Authors:** SeungWon Seo, DongHeun Han, SeongRae Noh, HyeongYeop Kang  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2605.16725  
**Dataset/Environment:** Baba in Wonderland / Baba Is You transition dynamics  
**Architecture:** executable program → update → preservation conflict → hypothesis class refinement → class-aware exploration  
**Contribution:** rejected updates 反向提供 structure discovery evidence。  
**Limitations:** deterministic/discrete/exactly verifiable environment。

## Paper D
**Title:** Data-driven Progressive Discovery of Physical Laws  
**Authors:** Mingkun Xia, Weiwei Zhang  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2603.13727  
**Architecture:** Chain of Symbolic Regression (CoSR)  
**Contribution:** physics law discovery 由 knowledge units progressive composition，而不是 one-shot giant expression search。  
**Limitations:** knowledge decomposition / ordering 仍帶 structural priors。

## Paper E
**Title:** Machine Learning Hamiltonian Dynamical Systems with Sparse and Noisy Data  
**Authors:** Vedanta Thapar, Abhinav Gupta  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2604.17470  
**Architecture:** structure-preserving ASRNN → data generation / trajectory modeling → SINDy / PySR symbolic recovery  
**Contribution:** 顯示 neural structure-preserving model 可以成為 symbolic discovery 的資料橋樑，在 sparse/noisy/irregular observations 下避免直接 derivative estimation 崩潰。  
**Limitations:** Hamiltonian structure 是強 prior；不能直接涵蓋 arbitrary dissipative/contact-rich agent worlds。

---

# 已確認事實 / 工程實作 / 合理推論 / 尚未驗證假說

## 已確認事實
- PySINDy current code 將 feature library 與 optimizer 分離，預設 `PolynomialLibrary + STLSQ`。
- LLM-PySR repository 有獨立 `runtime/llm_pipeline.py` 與 `runtime/pysr_runner.py`。
- LLM-PySR paper 主張 LLM search-controller role 優於讓 LLM 直接決定公式。
- Verifier-Guided Model Discovery 將 pretrained symbolic transformer candidate generation 與 physics/dynamics verification 分離。
- Alice 使用 rejected update / preservation conflict 形成 hypothesis classes 並驅動 exploration。

## 工程實作建議
- Hermes 加入 `Mechanism Search Controller`、`Candidate Discovery Engine`、`Verifier Plane`、`Mechanism Certificate` 四個獨立 runtime service。
- Residual Diagnostics 不只輸出 anomaly score，也輸出可供 library expansion 的 conditioned signatures。
- Mechanism Graph 同時容納 symbolic equation、program rule、state machine、neural residual。

## 合理推論
- Agent world model 應從 parameter posterior / model-bank posterior 再升級為 `mechanism-structure posterior`。
- Preservation conflict 可視為 regime split / latent-state split 的訊號，但需要連續 stochastic domain 專用統計版本。

## 尚未驗證假說
- 是否能用一套 unified `Mechanism IR` 同時表示 ODE、hybrid automata、tool/runtime rules、multi-agent protocols 與 neural residual。
- 是否能從 multimodal residual 直接自動提出「新 latent state」而非僅新 equation term。
- LLM-controlled feature-library expansion 是否在 agent runtime telemetry 上比純 neural system identification 更樣本有效。

---

# Unknown / Open Questions

## 1. 如何發現「缺了一個 state variable」而不只是「缺了一個 term」？
SINDy / PySR 多半假設 state variables 已知。真正 Agent 常見的是 latent queue pressure、contact compliance、memory saturation、human intent 等根本未被 state representation 捕捉。

## 2. Hybrid / discontinuous dynamics 如何穩定發現？
Tool failure、contact stick-slip、rate-limit、permission denied、human interruption 都是 regime transition。單一 smooth equation 不足；需要 hybrid automata / change-point / guard discovery。

## 3. Mechanism discovery 的「驗證真實性」如何避免 verifier overfit？
Verifier 如果只看既有資料，仍可能接受 spurious but predictive equation。需要 intervention / OOD / invariance / adversarial counterexample generation。

---

# 下一輪研究

下一個最深缺口已變成：

# **Latent State Discovery × State-Space Expansion × Hybrid Regime Discovery × Guard / Event Boundary Induction**

因為目前：

```text
Residual
→ 新 term
→ 新 equation
```

仍假設 state vector 已完整。

但真正 Agent 更常發生：

```text
observable x
不夠 Markov
```

例如：

```text
同樣的 position + velocity
```

在：

```text
contact preloaded
vs
contact relaxed
```

下一步卻不同。

這代表不是 coefficient 錯，而是：

```text
缺 latent state
```

下一輪應建立：

```text
History
↓
Non-Markov Residual Test
↓
Latent State Hypothesis
↓
State Augmentation
↓
Regime / Change-Point Detector
↓
Guard Condition Discovery
↓
Hybrid Automaton
↓
Counterfactual / Intervention Validation
↓
State-Space Expansion Certificate
```

優先研究：
- Koopman / delay embedding / Hankel state construction
- latent SINDy / autoencoder-SINDy
- hybrid SINDy / switching dynamics
- change-point detection
- hidden semi-Markov / switching state-space model
- guard-condition induction
- neural ODE + event function
- executable hybrid world models

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Model-Class Discovery
Mechanism Discovery
Mechanism Hypothesis
Mechanism Search Plan
Mechanism Search Controller
Candidate Function Library
Feature Library Expansion
Sparse Support Discovery
Symbolic Equation Candidate
Executable Model Candidate
Program Dynamics Candidate
Verifier Plane
Physical Admissibility Verifier
Preservation Conflict
Preservation Counterexample
Mechanism Split Evidence
Regime Hypothesis
Transition Class
Mechanism Graph
Mechanism Certificate
Equation Discovery
Weak-Form Discovery
Symbolic Transformer
Search Controller Agent
Candidate Reviewer
Experience Memory Agent
Progressive Law Discovery
```

## 新增 Edges

```text
Residual
--SUGGESTS→
MechanismHypothesis

MechanismHypothesis
--EXPANDS→
CandidateFunctionLibrary

SearchController
--CONFIGURES→
DiscoveryEngine

DiscoveryEngine
--PROPOSES→
ExecutableModelCandidate

VerifierPlane
--TESTS→
ExecutableModelCandidate

RejectedUpdate
--PRODUCES→
PreservationCounterexample

PreservationCounterexample
--SUPPORTS→
MechanismSplitEvidence

MechanismSplitEvidence
--REFINES→
RegimeHypothesis

MechanismCertificate
--GOVERNS_COMMIT_TO→
ExecutableWorldModel
```

## 新增否定關係

```text
Sparse Regression ≠ Full Model-Class Discovery
Candidate Library ≠ True Mechanism Space
Good Fit ≠ Correct Mechanism
Symbolic Equation ≠ Physical Law
LLM Plausibility ≠ Equation Validity
Equation Generation ≠ Equation Verification
Reconstruction Fidelity ≠ Symbolic Discoverability
Rejected Update ≠ Useless Failure
Single Smooth ODE ≠ Complete Agent Dynamics
Neural Residual ≠ Mechanism Explanation
Executable Program ≠ Ground-Truth Dynamics
Low Complexity ≠ Correct Causality
```

---

# 本輪結束回答

**缺哪一層？**  
Latent State Discovery / State-Space Expansion：目前能長出新的 equation term，但還不能可靠判斷「state vector 本身少了一個變數」。

**哪個節點最淺？**  
`Residual Signature → Mechanism Hypothesis` 的 calibrated mapping，尤其 continuous noisy multimodal world。

**哪個概念仍只是名詞？**  
Universal `Mechanism IR`、`Mechanism Certificate ABI`、cross-modal `State-Space Expansion Certificate`。

**哪個系統值得讀原始碼？**  
第一優先 PySINDy `feature_library/`, `optimizers/`, `_weak.py`, `_sindypi.py`；第二優先 LLM-PySR `runtime/llm_pipeline.py`, `runtime/pysr_runner.py`, `agents/`。

**哪篇論文需追引用？**  
Verifier-Guided Model Discovery、LLM-PySR、Alice / Baba in Wonderland、CoSR；並回溯 SINDy / Weak SINDy / SINDy-PI 方法鏈。

**哪個概念最適合視覺模擬？**  
`Mechanism Discovery & Equation Induction Lab`：讓使用者看到 residual 如何擴充 candidate library、sparse support 如何出現、candidate 如何被 verifier 淘汰、preservation conflict 如何觸發 regime split。

**哪個 Agent 架構最值得實作？**  

> **Mechanism-Induction Agent Runtime = Residual Diagnostic Bus + Structural Hypothesis Generator + LLM Search Controller + Symbolic/Sparse/Program Discovery Engines + Physics/Causal Verifier Plane + Preservation-Conflict Analyzer + Active Discrimination Planner + Mechanism Certificate + Executable Mechanism Graph**

本輪最核心的推進是：

> **成熟 Agent 不應只在既有模型中調參，也不應只在人工 Model Bank 裡選答案。當 residual 持續顯示「世界比模型更複雜」時，它必須能提出新的 state、interaction、regime 或 equation，讓 symbolic / sparse / program discovery engine 產生可執行候選，再由獨立 verifier、舊證據 preservation test 與主動實驗決定哪些機制值得寫進世界模型。真正的「AI 理解世界」，不是生成一句合理解釋，而是產生一個可以執行、可以被反駁、可以被修改、也可以跨新情境驗證的機制。**