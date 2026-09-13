# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-14 07:56（Asia/Taipei）  
**本輪主題**：Anytime-Valid Model-Class Falsification × Adaptive Revalidation × Predictable Intervention Policy × E-Process × Hypothesis Expansion  
**歷史銜接**：上一輪已建立 Robust Causal Experiment Design / OUT_OF_MODEL branch / Adversarial Revalidation。本輪不再研究「挑哪個 experiment 最有資訊」，而是處理更底層的統計問題：**Agent 自己根據過去結果持續挑下一個 intervention、反覆查看 residual，什麼時候才有資格正式宣告目前 model class 被拒絕？**

---

## 本小時新發現

### 新論文 / 理論

1. **Game-Theoretic Statistics and Safe Anytime-Valid Inference** — Aaditya Ramdas, Peter Grünwald, Vladimir Vovk, Glenn Shafer, Statistical Science, 2023.  
   URL: https://doi.org/10.1214/23-STS894  
   核心：e-process / test martingale 在任何 stopping time 都保持 type-I error 控制；關鍵是測試因子必須滿足條件期望限制，且 betting rule 必須 predictable。

2. **E-values for Adaptive Clinical Trials: Anytime-Valid Monitoring in Practice** — Alexandra Sokolova, Vadim Sokolov, 2026.  
   URL: https://arxiv.org/abs/2602.06379  
   核心：adaptive design、interim monitoring、optional continuation 可用 e-values/e-processes做 anytime-valid 監控，但必須保留有效的條件結構，不能把任意 data-dependent adaptation 都視為免費。

3. **Anytime validity is free: inducing sequential tests** — JRSSB, 2026.  
   URL: https://doi.org/10.1093/jrsssb/qkag050  
   核心：給定固定上限樣本 N，可把固定樣本 valid test 誘導成 anytime-valid sequential test，說明 sequential validity 不必然等於最終 power 損失。

4. **Continuous time asymptotic representations for adaptive experiments** — Karun Adusumilli, 2026.  
   URL: https://arxiv.org/abs/2601.00739  
   核心：對 fully adaptive experiment 建立 allocation-process / diffusion 表示，並討論 anytime / any-experiment valid inference；對 Hermes 很重要，因為 intervention policy 本身就是 adaptive allocation process。

5. **Anytime-Valid Federated Conformal RAG for LLM Swarms** — Prasanjit Dubey, Xiaoming Huo, 2026.  
   URL: https://arxiv.org/abs/2605.20636  
   核心：predictable adaptive controller 可以在 sequential validity 下調整 bandwidth / recalibration / model refresh，但 naive composition 會失效；作者使用 calibration-deviation budget + truncated betting e-process 維持 time-uniform validity。這提供 Agent runtime 中「控制器可以改，但證據生成條件不能被偷換」的直接類比。

### 新 GitHub / 工程實作

**kherarudransh-oss/anytime-valid-hypo-testing-sae-feature-validation**  
GitHub: https://github.com/kherarudransh-oss/anytime-valid-hypo-testing-sae-feature-validation

值得看的目錄 / 檔案：

```text
src/savt/
├ driver.py
├ experiments.py
├ interventions.py
├ effects.py
├ models.py
├ synthetic.py
└ tests/
   ├ e_process.py
   ├ e_bh.py
   ├ knockoffs.py
   └ permutation.py
```

其中 `src/savt/tests/e_process.py` 明確實作：

```text
E_t = E_{t-1} × (1 + λ_t X_t)
```

而且 **λ_t 在把 X_t 放進 history 前先計算**。程式內明確把這件事視為 e-process validity 的 critical detail。

---

# 本小時最重要 5 個發現

## 1. Adaptive Experiment Selection 本身不必破壞 validity；真正不能破壞的是 predictability / conditional calibration

上一輪 Hermes 已有：

```text
history
↓
choose intervention I_t
↓
observe residual R_t
↓
choose next intervention
```

真正需要的 filtration 是：

```text
F_{t-1}
=
all information available before round t result
```

Agent 可以用 `F_{t-1}` 決定：

```text
I_t
model prediction
residual score function
bet λ_t
```

但在看見 `O_t` / `R_t` 後，不能回頭修改這一輪的 test factor。

因此：

```text
Adaptive Intervention
≠ Invalid Sequential Test automatically
```

但：

```text
Post-outcome Retuning of Current Bet
→ Invalidates martingale argument
```

這是 Hermes 要正式記錄的 temporal contract。

---

## 2. Bottom-Level Mechanism：Predictable E-Factor

設定 model class null：

```text
H0:
current model class M remains adequate
under all allowed adaptive interventions
```

第 t 輪 Agent 在 `F_{t-1}` 下先決定 intervention：

```text
I_t = π_exp(F_{t-1})
```

模型先給 predictive law：

```text
P_M(O_t | F_{t-1}, do(I_t))
```

觀察結果後產生 discrepancy：

```text
X_t = s(O_t, prediction_t)
```

若可保證 under H0：

```text
E[X_t | F_{t-1}] ≤ 0
```

並且事前選定 `λ_t`，可建立：

```text
E_t
=
E_{t-1}(1 + λ_t X_t)
```

滿足 nonnegative supermartingale 條件。

當：

```text
E_t ≥ 1/α
```

即可用 Ville-type argument 在 level α 下拒絕 H0，即使：

```text
- 每一步都看結果
- 自己決定何時停止
- 自己依過去結果挑下一個 intervention
```

前提是 adaptation 是 predictable，且 conditional null 真正成立。

---

## 3. 「Residual 很奇怪」不是 e-value；需要 Residual → E-factor 的校準層

目前 Hermes 的 `OutOfModel Surprise` 仍偏 architecture concept。

例如：

```text
predicted probability = 0.8
observed = 0
residual = -0.8
```

這本身不是統計證據。

需要：

```text
Raw discrepancy
↓
Null-conditional calibration
↓
bounded / likelihood-ratio / conformal score
↓
E-factor
↓
E-process
```

可能路線：

### A. Likelihood-ratio e-factor

```text
e_t
=
q_t(O_t) / p_t(O_t)
```

其中 `p_t` 是 null model conditional law，`q_t` 是 predictable alternative / mixture。

### B. Betting residual

```text
X_t ∈ [-B,B]
E[X_t | F_{t-1}] ≤ 0

factor_t = 1 + λ_t X_t
```

### C. Conformal / calibration score → martingale

將 calibrated p-values 轉成 test martingale；但 exchangeability / conditional calibration assumptions 必須額外列出。

因此新增：

```text
Large Residual
≠ Valid E-factor
```

---

## 4. Agent 的 Experiment Planner 必須和 Evidence Constructor 分層

不能讓同一模組做：

```text
挑最想證偽的 intervention
+
看完 outcome 再設計當輪 test
```

Hermes 應拆成：

```text
Experiment Planner
↓
Pre-Outcome Evidence Contract Freezer
↓
Executor
↓
Observation
↓
Evidence Updater
```

本輪新增 runtime object：

```text
PreOutcomeEvidenceContract
├ round_id
├ filtration_hash
├ intervention_id
├ null_model_version
├ predictive_distribution_hash
├ discrepancy_function_hash
├ bet_strategy
├ lambda_t
├ bound_B
├ calibration_version
├ alpha_budget
└ frozen_at
```

只有 contract freeze 後才允許執行 intervention。

這樣能審計：

```text
Did the Agent choose evidence rule
before seeing the evidence?
```

---

## 5. Model-Class Rejection 與 Hypothesis Expansion 必須是兩階段

當 e-process crossing：

```text
E_t ≥ 1/α
```

可支持：

```text
REJECT CURRENT MODEL CLASS
```

但不能直接支持：

```text
ACCEPT H_new
```

原因是：

```text
Current class wrong
≠ Proposed replacement correct
```

因此 Hermes 應：

```text
Model-Class Rejection Certificate
↓
Certificate Quarantine
↓
Hypothesis Expansion / Model-Class Builder
↓
NEW validation epoch
↓
new e-process starts fresh
```

避免「同一批用來發現新假說的資料，又拿來無條件驗證新假說」。

---

# Architecture Breakdown

## Anytime-Valid Adaptive Revalidation Runtime

```text
Model / Encoder / Tool / MCP / Policy Change
↓
Affected Certificate Set
↓
Current Model Class M
↓
Adaptive Experiment Planner
   uses only F_{t-1}
↓
Candidate intervention I_t
↓
Safety Gate
↓
PreOutcomeEvidenceContract FREEZE
├ predictive law
├ score function
├ alternative / bet
├ λ_t
└ validity assumptions
↓
Sandbox / Shadow / Canary execution
↓
Observation O_t
↓
Discrepancy X_t
↓
E-factor
↓
E_t = E_{t-1} × factor_t
↓
┌──────────────────────────────┐
│ E_t < warning                │ → continue
│ warning ≤ E_t < 1/α          │ → intensify safe probing
│ E_t ≥ 1/α                    │ → reject current class
└──────────────────────────────┘
↓
Model-Class Rejection Certificate
↓
Certificate Quarantine
↓
Hypothesis Expansion
↓
Fresh Validation Epoch
```

---

# Bottom-Level Logic

## Filtration legality

對第 t 輪：

```text
F_{t-1}
contains:
- previous interventions
- previous observations
- previous e-values
- previous model outputs
- current budgets
- current certificate states
```

允許：

```text
I_t = f(F_{t-1})
λ_t = g(F_{t-1})
```

禁止：

```text
λ_t = g(F_{t-1}, O_t)
```

除非重新推導不同的 valid construction。

## Evidence update

```text
factor_t ≥ 0
E[factor_t | F_{t-1}] ≤ 1 under H0

E_t = Π_{i=1}^t factor_i
```

則：

```text
P_H0(sup_t E_t ≥ 1/α) ≤ α
```

這正是 Agent 「邊看、邊選 experiment、邊決定是否停」仍可控制 false rejection 的核心。

---

# Visual Simulation Idea

## Adaptive Falsification E-Process Lab

左側顯示 Agent 當前 model class：

```text
M0
├ H1 camera equivalent
├ H2 tool proxy stable
├ H3 NCO stable
└ H4 memory pathway stable
```

中央每輪：

```text
Round 1
History → Planner
→ Camera Occlusion

λ₁ frozen = 0
Observation arrives
X₁ = +0.31
factor₁ = 1.00
E₁ = 1.00

Round 2
Planner sees round 1
→ NCO perturbation
λ₂ frozen = .22
Observation arrives
X₂ = +1.6
factor₂ = 1.352
E₂ = 1.352
```

右側顯示：

```text
E-process wealth      1.35
Rejection threshold  20.0   (α=.05)
Warning threshold     5.0
```

加入一個「作弊模式」按鈕：

```text
[ ] choose λ after seeing outcome
```

一旦打開，介面直接顯示：

```text
INVALID EVIDENCE PATH
Predictability contract violated
Anytime-valid guarantee removed
```

另一個模式模擬 optional stopping：

```text
STOP WHEN:
E_t > 7
or
budget exhausted
or
permission flips
```

顯示：

```text
Stopping rule can adapt
Evidence contract still valid
```

這可以非常直覺地教會使用者：

> 「可以邊看邊停，但不能看完本輪結果才決定本輪原本下注多少。」

---

# Code / GitHub

## Repository

https://github.com/kherarudransh-oss/anytime-valid-hypo-testing-sae-feature-validation

### 最值得讀

```text
src/savt/tests/e_process.py
```

關鍵工程結構：

```text
_next_lambda_agrapa()
_next_lambda_ons()
_next_lambda()
update(x)
```

`update(x)` 的時間順序：

```text
lam = _next_lambda()      # only history
factor = 1 + lam*x
append x to observations
update wealth
```

這個 ordering 本身就是 production 級 evidence-system 很值得借用的 pattern。

### 其他值得讀

```text
src/savt/interventions.py
src/savt/experiments.py
src/savt/effects.py
src/savt/tests/e_bh.py
```

可研究 causal intervention → effect score → e-process → multiple feature validation 的完整呼叫鏈。

---

# Papers

## 1. Game-Theoretic Statistics and Safe Anytime-Valid Inference

- Authors: Aaditya Ramdas, Peter Grünwald, Vladimir Vovk, Glenn Shafer
- Institution: Carnegie Mellon University / CWI-Leiden / Royal Holloway / Rutgers
- Year: 2023
- URL: https://doi.org/10.1214/23-STS894
- Architecture: test martingale / e-process / confidence sequence
- Contribution: 統一 safe anytime-valid inference，允許 optional stopping / continuation
- Limitations: validity 仍依賴正確的 null-conditional / supermartingale construction；不是所有 adaptive score 都自動合法
- 改變了什麼：把「反覆看資料會破壞 p-value」轉成原生可持續監控的 evidence primitive

## 2. E-values for Adaptive Clinical Trials: Anytime-Valid Monitoring in Practice

- Authors: Alexandra Sokolova, Vadim Sokolov
- Year: 2026
- URL: https://arxiv.org/abs/2602.06379
- Architecture: adaptive trial + betting martingale + e-process
- Contribution: 說明 design adaptation / interim monitoring 如何與 anytime-valid inference 整合
- Limitations: 臨床 trial abstraction 不能直接等同任意 Agent intervention runtime
- 改變了什麼：提供 adaptive controller 與 evidence process 分層的實務模板

## 3. Anytime validity is free: inducing sequential tests

- Year: 2026
- Venue: JRSSB
- URL: https://doi.org/10.1093/jrsssb/qkag050
- Contribution: fixed-horizon valid test 可被誘導成 sequential anytime-valid test 且終點 power 可匹配
- Limitations: 不代表任意已有 heuristic score 可直接轉 e-process
- 改變了什麼：降低「anytime validity 必然犧牲大量 power」的直覺障礙

## 4. Continuous time asymptotic representations for adaptive experiments

- Author: Karun Adusumilli
- Year: 2026
- URL: https://arxiv.org/abs/2601.00739
- Architecture: adaptive allocation process → diffusion limit experiment
- Contribution: 建立 any-time / any-experiment validity 的 adaptive-experiment 理論方向
- Limitations: asymptotic framework；與有限樣本 neural Agent runtime 尚有距離
- 改變了什麼：把 adaptive policy 本身納入 inference object，而不是當 nuisance

---

# 已確認 / 推論 / 尚未驗證

## 已確認事實

- e-process / test martingale 可提供 optional-stopping-safe sequential testing。
- e-process betting strategy 必須對當輪 outcome 保持 predictable。
- SAE 2026 repository 的 `e_process.py` 確實在加入當輪 observation 前先算 lambda。
- adaptive data collection 本身不必然破壞 anytime validity，但 construction 必須保留條件期望 / supermartingale 性質。

## 工程推論

- Hermes 的 experiment planner 與 evidence updater 應分成不同 runtime stages。
- 每輪應落盤 `PreOutcomeEvidenceContract`，才能做可審計證據鏈。
- model-class rejection 後應重啟 validation epoch，而不是沿用舊 e-process 直接支持新 model class。

## 尚未驗證假說

- 是否能為 arbitrary multimodal neural world model 定義通用的 bounded discrepancy `X_t`，同時具高 power 與可靠 conditional mean property。
- 是否能把 structural residual、intervention signature drift、negative-control violation 統一到單一 e-process，而不造成嚴重 power dilution。
- Agent 自己生成新 hypotheses 時，如何在 hypothesis expansion 後重用過去資料而不產生 double use / selective inference 問題。

---

# Unknown / Open Questions

1. **Composite Model Class E-Process**：null 不是單一模型，而是 `{M_θ : θ ∈ Θ}` 時，Hermes 應用 universal inference、mixture e-values、safe testing 還是 profile-type e-process？
2. **Cross-Modal Evidence Fusion**：Camera、Voice、Tool、Memory 各自有 e-process 時，如何合法合併，又不把同一 evidence 重複計算？
3. **Hypothesis Expansion after Rejection**：如何讓 Agent 使用 rejection evidence 生成新 model class，同時維持之後 validation 的 selection validity？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Anytime-Valid Model-Class Falsification
Adaptive Falsification Policy
Predictable Intervention Policy
Filtration
PreOutcomeEvidenceContract
Predictable Bet
E-Factor
E-Process Wealth
Test Martingale
Supermartingale Validity
Optional Stopping
Optional Continuation
Model-Class Rejection Certificate
Adaptive Goodness-of-Fit
Residual Calibration Layer
Out-of-Model E-Process
Evidence Epoch
Validation Epoch Reset
Hypothesis Expansion Boundary
Evidence Reuse Risk
Sequential Model Adequacy Monitor
```

## Edges

```text
Adaptive Experiment Selection
≠ Invalid Inference Automatically

Predictable Adaptation
→ Can Preserve E-Process Validity

Outcome-Dependent Current Bet
→ Violates Predictability

Large Residual
≠ Valid E-Factor

Optional Stopping
≠ Type-I Inflation under Valid E-Process

Current Model-Class Rejection
≠ New Model-Class Validation

Model-Class Rejection
→ Certificate Quarantine

Hypothesis Expansion
→ Requires Fresh Validation Contract

Experiment Planner
≠ Evidence Constructor

PreOutcomeEvidenceContract
→ Auditable Sequential Evidence
```

---

# 下一輪研究

下一輪應集中：

# **Composite-Null E-Process × Universal Inference × Safe Testing × Multi-Modal Evidence Fusion**

核心問題：

```text
Current model class is not one model
but M = {M_θ}
↓
intervention chosen adaptively
↓
multimodal residuals arrive
↓
need evidence against entire class
not only one fitted checkpoint
```

要拆：

```text
Composite Null
↓
Null fitting / nuisance parameters
↓
Universal inference / mixture / RIPr
↓
Per-modality e-factors
↓
Dependence-aware fusion
↓
Anytime-valid global model-class rejection
↓
Certificate / Permission
```

---

# 本輪結束判定

- **缺哪一層**：Composite Model-Class Evidence Construction Layer。
- **哪個節點最淺**：`OutOfModelEProcess`、`ResidualCalibrationLayer`、`EvidenceReuseAfterHypothesisExpansion`。
- **哪個概念仍只是名詞**：通用 production 級 `MultimodalModelClassEProcess`。
- **哪個系統值得讀原始碼**：`anytime-valid-hypo-testing-sae-feature-validation/src/savt/tests/e_process.py`，再往 `interventions.py / experiments.py / effects.py` 追完整 causal-feature pipeline。
- **哪篇論文需追引用**：Ramdas et al. 2023 SAVI；以及 2026 adaptive experiment / anytime validity 工作。
- **哪個概念最適合視覺模擬**：Adaptive Falsification E-Process Lab。
- **哪個 Agent 架構最值得實作**：`Adaptive Experiment Planner → PreOutcomeEvidenceContract → Executor → E-Process Updater → Model-Class Rejection Certificate → Hypothesis Expansion Boundary`。

---

# 對「AI 到底怎麼運作」新增的一層

真正長期運作的 AI Agent 不只是：

```text
Observation
→ Reasoning
→ Action
```

而會逐漸變成：

```text
World Model
↓
Predict outcome
↓
Choose experiment
↓
Freeze evidence rule
↓
Act / Sense / Query
↓
Observe discrepancy
↓
Update e-process
↓
Continue / Stop / Reject model class
↓
Expand hypothesis space
↓
Rebuild world model
```

最核心的新原則是：

> **Agent 可以非常主動地選擇下一個實驗，也可以隨時停止；但如果它想把「我發現模型錯了」變成可驗證的統計結論，就必須在每輪結果揭露前先鎖定這一輪如何計算證據。真正可靠的 AI 因此需要的不只是 World Model 與 Experiment Planner，還需要一個獨立的 Sequential Evidence Runtime。**
