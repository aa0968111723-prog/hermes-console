# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 02:52（Asia/Taipei）**  
**主題：Causal State Sufficiency × Negative Controls × Proxy Validation × Multimodal Causal Representation × Agent Causal Falsification**

---

## 0. 與歷史研究比較：本輪避免重複什麼

前幾輪已建立：

- Sequential Ignorability / Hidden Confounding / Positivity
- Proximal Causal Inference 與 treatment-inducing / outcome-inducing proxy
- `CausalStateSufficiencyCertificate`
- `ProximalProxyContract`
- CausalGame / CausaLab 類「介入式機制辨識」的初步概念
- Query / Information Action 作為 intervention

但仍有四個未補齊的底層問題：

1. **一個 LLM/VLM/Voice embedding 什麼時候能被視為 causal state，而不只是 predictive representation？**
2. **一個 proxy 怎麼被驗證不是 outcome / treatment 的直接原因，而是真的只透過 latent confounder 提供資訊？**
3. **negative control 是否可以成為 Agent runtime 的 falsification primitive，而不是離線統計技巧？**
4. **multimodal representation 的「資訊完整」是否等價於「因果充分」？**

本輪專門研究這四個缺口。

---

# 1. 本小時新發現

## 新論文 / 方法

### A. Causal Survival Forests with Negative Controls

- **Title**: Causal Survival Forests with Negative Controls
- **Authors**: Zijun Gao, Kyounggeui Hong, Leyi Ma, Qianli Wu, Zachary Izzo, Ruishan Liu
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2608.19749
- **Architecture**: Negative controls / proximal bridge + causal survival forest + Neyman-orthogonal loss + nuisance estimation / clipping
- **Contribution**: 將 negative-control proxies 直接納入 heterogeneous treatment effect learner，處理 hidden confounding 與 censoring。
- **Limitations**: proxy validity、completeness、support 仍是 structural assumptions；模型表現好不能反向證明 proxy 合法。
- **改變了什麼**: negative controls 不再只是「檢查偏差」，而可直接進入可訓練的 causal learner。

### B. Spatiotemporal Proximal Causal Inference under Hidden Confounding and Interference

- **Authors**: Omar Faruque, Pavan Raj Ravi, Jianwu Wang
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2608.01352
- **Architecture**: spatiotemporal transformer proxy encoders + conditional mutual-information critic + moment-matching bridge network + stabilized weighting
- **Contribution**: 在 hidden confounding + interference 下學 treatment / outcome inducing proxies；用 critic 約束 exclusion，用 moment equation 約束 bridge。
- **Limitations**: proxy exclusion / completeness 仍需結構假設；目前主要實驗為 synthetic setting。
- **改變了什麼**: learned representation 不再只靠 prediction loss，而可被「bridge equation + exclusion test」共同約束。

### C. Causal Complete Cause (C³) for Multi-Modal Representation Learning

- **Title**: Towards the Causal Complete Cause of Multi-Modal Representation Learning
- **Authors**: Jingyao Wang, Siyu Zhao, Wenwen Qiang, Jiangmeng Li, Changwen Zheng, Fuchun Sun, Hui Xiong
- **Institution**: Institute of Software CAS / UCAS / Tsinghua / HKUST
- **Year**: 2025, ICML
- **URL**: https://proceedings.mlr.press/v267/wang25ey.html
- **Code**: https://github.com/WangJingyao07/Multi-Modal-Base
- **Architecture**: twin network；real-world branch 用 IV 評估 sufficiency；hypothetical-world branch 用 counterfactual gradient 評估 necessity；以 C³ risk regularize representation。
- **Contribution**: 將 multimodal representation 從「一致＋特異」提升成「causally sufficient + necessary」。
- **Limitations**: C³ 的識別仍依賴 IV 等條件；適用於任意 Agent state 尚未被證明。

### D. CausalGame: Benchmarking Causal Thinking of LLM Agents in Games

- **Authors**: Zhenhao Chen, Yongqiang Chen, Chenxi Liu, Junchi Yu, Xiangchen Song, Zijian Li, Jialin Li, Philip Torr, Bo Han, Kun Zhang
- **Institution**: MBZUAI / CMU / HKBU / Oxford / NYU Abu Dhabi
- **Year**: 2026, ICML Oral
- **URL**: https://arxiv.org/abs/2607.04293
- **Code**: https://github.com/CausalGame/CausalGame
- **Dataset / Environment**: 14 SCM-driven interactive scenarios；selection bias / hidden confounding / noisy measurements / environment shift
- **Contribution**: 把「得到高 reward」與「真的恢復 hidden causal mechanism」拆開。
- **Paper Result**: 30 個 LLM agents 中，最佳 survival 約 68%，低於 78–85% analytical optimum；只有少數 session 在 causal-reasoning rubric 得分。
- **限制**: controlled synthetic game；不能直接代表真實世界 causal identifiability。

---

# 2. 本小時最重要 5 個發現

## 發現 1 — Predictive State Sufficiency ≠ Causal State Sufficiency

### 是什麼

一個 representation `Z_t` 可以對未來 observation / reward 有極高預測力：

```text
History H_t
↓ Encoder
Z_t
↓ Predictor
Y_{t+1}
```

但要拿它做 causal adjustment，至少需要更強的條件：

```text
A_t ⟂ Y_future(a) | Z_t
```

或在 sequential setting 中近似：

```text
Potential future trajectory
⊥
Action assignment
|
Causal state Z_t
```

### 為什麼重要

LLM / VLM embedding 很容易把下列東西壓進同一個向量：

- 真正 confounder
- action descendant
- collider
- style / source / device artifact
- outcome leakage
- future-derived summary

因此：

```text
High next-token / reward prediction accuracy
≠
Valid adjustment set
```

### Hermes 新 primitive

```text
CausalStateSufficiencyContract
├ representation_id
├ source_history_cutoff
├ forbidden_descendants[]
├ treatment_prediction_score
├ outcome_prediction_score
├ negative_control_tests[]
├ invariance_tests[]
├ intervention_tests[]
├ overlap_status
├ leakage_status
├ causal_sufficiency_status
└ allowed_causal_uses[]
```

### 結論分類

- **已確認事實**：predictive sufficiency 本身不足以證明 causal identification。
- **工程推論**：Hermes 不應允許任意 embedding 直接進 OPE / causal permission engine。

---

## 發現 2 — Negative Control 最有價值的用途是「Falsification」，不是自動修正

### 底層邏輯

設：

- `A` = treatment / agent action
- `Y` = target outcome
- `U` = latent confounder
- `Z` = negative-control exposure / treatment-inducing proxy
- `W` = negative-control outcome / outcome-inducing proxy

理想 negative control 有結構性限制，例如：

```text
Z ↛ Y     (沒有直接 causal effect)
A ↛ W     (treatment 不直接造成 W)
```

但：

```text
Z ← U → Y
A ← U → W
```

使 Z/W 仍能攜帶 U 的資訊。

這讓 negative controls 有兩種完全不同角色：

```text
ROLE A: FALSIFICATION
如果本來不該有關聯，卻出現穩定 effect
→ 暗示 unmeasured confounding / model misspecification

ROLE B: PROXIMAL IDENTIFICATION
在 completeness / bridge assumptions 成立時
→ 用 Z/W 解 bridge equation
→ identification without observing U
```

### Hermes 不應做的事

```text
找到一個與 U 很像的 embedding
↓
叫它 negative control
↓
直接進 proximal estimator
```

應改成：

```text
Candidate Proxy
↓
Structural Role Declaration
↓
Forbidden-edge audit
↓
Negative-control falsification
↓
Bridge solvability / completeness diagnostics
↓
Sensitivity
↓
才允許 causal use
```

### 新 primitive

```text
NegativeControlContract
├ variable_or_representation_id
├ role: NCE | NCO
├ target_action
├ target_outcome
├ forbidden_direct_paths[]
├ allowed_latent_common_causes[]
├ temporal_ordering
├ leakage_check
├ falsification_tests[]
├ validity_status
└ allowed_estimators[]
```

---

## 發現 3 — Learned Proxy 必須接受「排除限制測試」，不只看 representation quality

2026 spatiotemporal proximal work 的一個重要工程方向，是使用：

```text
Raw spatiotemporal observations
↓
Transformer proxy encoders
↓
Z, W
↓
Conditional Mutual Information Critic
→ enforce / diagnose exclusion-like dependence restrictions
↓
Moment Matching Network
→ solve bridge moment equation
```

這提供 Hermes 很重要的設計模式：

```text
Representation Learning
≠
Proxy Validation
```

Hermes 可要求每個 learned proxy 同時通過：

```text
1. Relevance
   Proxy must carry information about latent confounding structure

2. Exclusion
   Proxy must not introduce forbidden direct causal path

3. Temporal legality
   Must be available before the action/outcome being evaluated

4. Bridge solvability
   Moment residual must be acceptably small

5. Support / completeness diagnostics
   Proxy variation must be rich enough

6. Stability
   Role should remain plausible across epochs/environments
```

新增：

```text
ProxyValidationCertificate
├ relevance_score
├ exclusion_test
├ conditional_mutual_information
├ bridge_residual
├ support_score
├ temporal_legality
├ environment_stability
├ sensitivity_result
└ identification_status
```

核心否定：

```text
Embedding similarity to hidden state
≠ Valid proxy

High mutual information with outcome
≠ Valid negative-control proxy

Good downstream accuracy
≠ Exclusion restriction
```

---

## 發現 4 — Multimodal Representation 應同時驗證 Sufficiency 與 Necessity

ICML 2025 C³ 提醒一個很容易被 Agent 系統忽略的點：

### 只有 sufficiency 不夠

如果 representation 裡包含：

```text
true causal signal
+
source watermark
+
device ID
+
background shortcut
```

模型仍可能對 outcome 很有預測力。

### 只有 necessity 也不夠

某個 feature 被移除後 performance 下降，不表示它是完整且足夠的 causal state。

因此可建立：

```text
Causal Representation Quality
=
Sufficiency
+
Necessity
+
No-forbidden-path constraints
+
Intervention invariance
```

對 Hermes multimodal state：

```text
Camera embedding
Voice embedding
DOM embedding
Tool telemetry embedding
Memory embedding
↓
Fusion State Z_t
```

不能只問：

```text
Can Z_t predict action success?
```

還要問：

```text
If suspected causal information is intervened / removed,
does the decision change correctly?

If spurious modality signal is changed,
does the decision remain invariant?
```

新增：

```text
MultimodalCausalStateCertificate
├ modality_sources[]
├ causal_sufficiency_score
├ causal_necessity_score
├ spurious_dependency_tests[]
├ modality_conflict_tests[]
├ intervention_invariance[]
├ negative_control_results[]
└ permission_scope
```

---

## 發現 5 — CausalGame 顯示「更多 reasoning」仍可能只是在更精緻地追相關性

CausalGame 的結果非常適合 Hermes：

```text
Agent
↓
Observational history
↓
surface correlation
↓
LLM reasoning
↓
high-confidence hypothesis
```

若沒有：

```text
Experiment design
↓
Intervention
↓
Mechanism falsification
↓
Alternative SCM elimination
```

reasoning token 增加並不保證 causal recovery。

### 直接讀原始碼後的 architecture

CausalGame repository 不是單純 prompt benchmark：

```text
agent/
├ orchestrator.py
├ base.py
├ client.py
├ tools/
└ sandbox/

api/modules/environment/
├ scm_base.py
├ scm_registry.py
├ antenna_trap_scm.py
├ deployment_zone_trap_scm.py
├ weather_noise_scm.py
└ ...
```

`agent/orchestrator.py` 實作：

```text
LLM
↓ ReAct thought
Tool Calls
↓ APIToolExecutor
Environment API
↓ Observation
Analysis Sandbox
↓
Next LLM Step
```

並有 deployment budget / turn budget / early-submit guard。

`antenna_trap_scm.py` 則明確建立 latent weather confounder 與 structural equations：

```text
weather_pattern (latent)
├→ wind_speed
│   └→ antenna_damage
├→ humidity
├→ temperature
└→ detection environment

antenna_hp
→ signal_strength
→ detection_probability
```

最關鍵是 Agent 可以看到 observable weather proxies，但如果只做 surface association，就可能錯解 antenna 與 survival 的關係。

### 對 Hermes 的意義

CausalGame 可以成為 `Causal State Sufficiency Test Harness` 的藍本：

```text
Candidate State Representation
↓
Generate hidden-SCM scenario
↓
Provide biased observations
↓
Ask Agent for policy
↓
Permit limited interventions
↓
Score:
  reward
  mechanism recovery
  confounder recognition
  experiment quality
  abstention when unidentified
```

核心：

```text
Task Reward
≠ Causal Understanding Score
```

---

# 3. Architecture Breakdown

## Hermes：Causal Representation Validation Runtime

```text
UI / Camera / Voice / Video / DOM / Tool / MCP / Memory
↓
Raw Event Ledger
↓
Representation Builder
├ text encoder
├ vision encoder
├ audio encoder
├ tool-state encoder
└ fused latent state
↓
Representation Lineage Auditor
├ source timestamp
├ descendants / ancestors
├ outcome leakage
├ action-descendant leakage
└ future-information leakage
↓
Causal Role Classifier
├ adjustment state candidate
├ NCE candidate
├ NCO candidate
├ IV candidate
├ mediator
├ collider
├ outcome descendant
└ unknown
↓
Negative Control / Proxy Validator
├ forbidden-path tests
├ relevance tests
├ exclusion diagnostics
├ CMI tests
├ bridge residuals
├ support / completeness diagnostics
└ sensitivity
↓
Intervention Falsification Engine
├ hold spurious factor fixed
├ intervene suspected causal factor
├ environment shift
├ modality ablation
└ counterfactual branch
↓
Causal State Sufficiency Auditor
├ sufficiency
├ necessity
├ invariance
├ overlap
└ mechanism recovery
↓
CausalStateSufficiencyCertificate
↓
Identification Router
├ ADJUSTMENT_ALLOWED
├ PROXIMAL_ALLOWED
├ RANDOMIZED_PILOT_REQUIRED
├ SENSITIVITY_ONLY
├ PREDICTION_ONLY
└ NOT_CAUSALLY_USABLE
↓
Permission Gate
```

---

# 4. Bottom-Level Logic

## 4.1 State representation 的三種 sufficiency 必須分開

### Predictive sufficiency

```text
P(Y_future | H_t)
≈
P(Y_future | Z_t)
```

表示 Z 保留預測 future 所需資訊。

### Decision sufficiency

```text
π*(A | H_t)
≈
π*(A | Z_t)
```

表示 Z 對某個 decision problem 夠用。

### Causal adjustment sufficiency

概念上需要更接近：

```text
A_t ⟂ Y_future(a) | Z_t
```

這是 identification 層要求。

因此：

```text
Predictive
→ maybe Decision
→ NOT automatically Causal
```

Hermes 應在 type system 層禁止向上偷換。

---

## 4.2 Proximal bridge 不是「還原 latent U」

理想 proximal identification 的核心是找 bridge function `h`，使：

```text
E[Y | A,Z,X]
=
E[h(W,A,X) | A,Z,X]
```

再透過：

```text
E[h(W,a,X)]
```

識別 causal estimand。

這表示：

```text
Need valid bridge
≠ Need reconstruct exact U
```

因此 Agent UI 不應把：

```text
"Hidden confounder estimate = 0.73"
```

當成 proximal inference 的必要產物。

真正應顯示的是：

```text
Proxy role valid?
Bridge residual?
Completeness/support?
Sensitivity?
Identification status?
```

---

## 4.3 Negative-control falsification flow

```text
Candidate NCO W
↓
Declare: A must not directly affect W
↓
Fit / test residual association A ↔ W | observed state
↓
Association remains?
├ NO  → does NOT prove no hidden confounding
└ YES → model / adjustment set falsified or control invalid
```

所以：

```text
Negative control passes
≠ identification proven

Negative control fails
→ strong diagnostic signal
```

這種 asymmetric semantics 非常適合 Agent runtime。

---

# 5. Visual Simulation Idea

## **Causal State Validator × Negative Control Lab**

### 左側：世界 SCM

```text
           U: latent task difficulty
          / \
         ↓   ↓
    ASK_USER  Success
       ↓
  User Answer

CameraNoise ─────→ Vision Embedding
                        ↓
                    Fused State Z
```

使用者可以把變數拖成：

- Confounder
- Treatment
- Outcome
- NCE
- NCO
- Mediator
- Collider
- Proxy

### 中間：Representation Inspector

```text
Candidate: fused_state_v17

Predictive Score       0.94
Decision Sufficiency   0.88
Outcome Leakage        ⚠ 0.31
Action Descendant      ⚠ YES
Negative Control Test  FAIL
Bridge Residual        0.17
Intervention Stability 0.54
```

### 右側：Causal permission

```text
PREDICTION               ALLOW
RISK RANKING              VERIFY
BACKDOOR ADJUSTMENT       BLOCK
PROXIMAL OPE              BLOCK
POLICY DEPLOYMENT         RANDOMIZED PILOT
```

### 最重要的互動

切換：

```text
[✓] remove outcome-derived memory
[✓] replace camera background
[✓] randomize information action
[✓] inject negative control
[✓] intervene latent mechanism proxy
```

看 representation 是否仍保持：

```text
reward
mechanism correctness
causal certificate status
```

三者的差異。

---

# 6. Code / GitHub

## A. CausalGame

Repository: https://github.com/CausalGame/CausalGame

### 值得讀的目錄

```text
agent/
api/modules/environment/
api/middleware/
experiments/
docs/
```

### 核心檔案

```text
agent/orchestrator.py
agent/base.py
agent/tools/executor.py
agent/sandbox/context.py

api/modules/environment/scm_base.py
api/modules/environment/scm_registry.py
api/modules/environment/antenna_trap_scm.py
api/modules/environment/deployment_zone_trap_scm.py
api/modules/environment/weather_noise_scm.py
```

### Hermes 借用點

不是借它的遊戲 UI，而是借：

```text
Hidden SCM
+
biased observation surface
+
limited intervention budget
+
mechanism-grounded external judge
```

形成 `Causal Agent Evaluation Sandbox`。

---

## B. Multi-Modal-Base / C³

Repository: https://github.com/WangJingyao07/Multi-Modal-Base

### 目錄

```text
backbone/
models/
train/
data/
prepross/
utils/
```

### 值得追的方向

搜尋：

```text
C3
causal
instrument
counterfactual
regularization
```

重點不是一般 multimodal fusion baseline，而是 twin-network / C³ risk 的具體實作位置。

---

# 7. Papers

## Paper 1

**Causal Survival Forests with Negative Controls**  
Gao et al., 2026  
https://arxiv.org/abs/2608.19749

**改變**：negative-control proxy + orthogonal loss 可直接形成非參數 heterogeneous-effect learner。

**限制**：proxy validity / bridge assumptions 不會因 forest predictive performance 好而自動成立。

---

## Paper 2

**Spatiotemporal Proximal Causal Inference under Hidden Confounding and Interference**  
Faruque, Ravi, Wang, 2026  
https://arxiv.org/abs/2608.01352

**改變**：把 learned spatiotemporal representation 與 proximal proxy / bridge restriction 結合；用 CMI critic 與 moment matching 增加結構約束。

**限制**：learned proxy validity 仍是最脆弱環節之一；需更多真實資料驗證。

---

## Paper 3

**Towards the Causal Complete Cause of Multi-Modal Representation Learning**  
Wang et al., ICML 2025  
https://proceedings.mlr.press/v267/wang25ey.html

**Code**: https://github.com/WangJingyao07/Multi-Modal-Base

**改變**：multimodal representation 不再只看 consistency / specificity，而加入 causal sufficiency + necessity。

**限制**：C³ identification 與 Agent runtime causal state identification 仍有距離。

---

## Paper 4

**CausalGame: Benchmarking Causal Thinking of LLM Agents in Games**  
Chen et al., ICML 2026 Oral  
https://arxiv.org/abs/2607.04293

**Code**: https://github.com/CausalGame/CausalGame

**改變**：將 reward performance 與 mechanism recovery 分開；加入 selection bias、hidden confounding、measurement error 的 agentic experiment loop。

**限制**：仍為 synthetic SCM game。

---

# 8. Unknown / Open Questions 1–3

## 1. Generic Causal State Sufficiency Test

目前沒有一個通用測試可以對任意 neural embedding 說：

```text
YES, this is a sufficient adjustment state.
```

特別是在：

```text
nonstationarity
partial observability
human interaction
multi-agent interference
learned memory
```

同時存在時。

---

## 2. Learned Negative-Control Discovery

是否能讓 Agent 自動從：

```text
Camera / Voice / DOM / Logs / Memory
```

提出 NCE / NCO candidates，再利用 intervention + temporal constraints + independence tests 驗證？

目前可視為重要研究方向，但不能宣稱已解。

---

## 3. Representation Drift 會不會使 Proxy Contract 失效？

若 encoder / model 更新：

```text
embedding_v1
→ embedding_v2
```

即使 source data 相同，proxy role 可能改變。

因此 proxy certificate 應綁定：

```text
encoder hash
model epoch
prompt/template hash
feature extraction lineage
```

而不是綁定 abstract field name。

---

# 9. 下一輪研究

下一輪最自然的方向：

# **Negative-Control Discovery × Causal Representation Falsification × Invariance under Intervention × Representation Drift**

研究鏈：

```text
Raw multimodal observations
↓
Candidate causal representation
↓
Automatic negative-control candidate mining
↓
Temporal / graph role constraints
↓
Intervention / environment shift
↓
Invariant causal prediction style tests
↓
Proxy contract falsification
↓
Encoder drift
↓
Certificate expiry / revalidation
↓
Permission Gate
```

需要回答：

```text
哪一個 representation 變動會讓 causal certificate 失效？

哪種 environment shift 應觸發重新驗證？

Agent 能否主動設計 falsification experiment，
而不是只接受現成資料？
```

---

# 10. Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Predictive State Sufficiency
Decision State Sufficiency
Causal State Sufficiency
CausalStateSufficiencyContract
Representation Lineage Audit
Outcome Leakage
Action-Descendant Leakage
Future-Information Leakage
Negative Control Exposure
Negative Control Outcome
NegativeControlContract
Negative-Control Falsification
Learned Proxy
Proxy Role Declaration
Proxy Exclusion Test
ProxyValidationCertificate
Bridge Residual
Completeness Diagnostic
Multimodal Causal State
MultimodalCausalStateCertificate
Causal Necessity
Causal Sufficiency
Causal Complete Cause
Mechanism Recovery Score
Causal Agent Evaluation Sandbox
Representation Certificate Expiry
```

## 新增 Edges

```text
Predictive Sufficiency
≠ Causal Sufficiency

Decision Sufficiency
≠ Causal Adjustment Sufficiency

Embedding Similarity
≠ Valid Causal Proxy

High Outcome Mutual Information
≠ Valid Negative Control

Negative Control Pass
≠ Identification Proven

Negative Control Failure
→ Falsifies Adjustment / Proxy Assumptions

Bridge Solvability
≠ Latent Confounder Recovery

Multimodal Fusion Accuracy
≠ Causal State Validity

Task Reward
≠ Mechanism Recovery

More Reasoning Tokens
≠ Better Causal Identification

Encoder Update
→ May Expire Proxy Certificate
```

---

# 11. 本輪結束判定

**缺哪一層？**  
`Causal Representation Validation / Negative-Control Falsification Layer`。

**哪個節點最淺？**  
`GenericCausalStateSufficiencyTest`、`AutomaticNegativeControlDiscovery`、`RepresentationCertificateExpiry`。

**哪個概念仍只是名詞？**  
Production 級 `LearnedProxyAuditor`：目前已有相關方法元件，但尚沒有通用 Agent runtime 標準。

**哪個系統值得讀原始碼？**  
CausalGame：`agent/orchestrator.py`、`api/modules/environment/scm_base.py`、`antenna_trap_scm.py`。

**哪篇論文需追引用？**  
`Spatiotemporal Proximal Causal Inference under Hidden Confounding and Interference`，因為它把 learned representation、proxy exclusion、bridge moment、interference 放進同一架構。

**哪個概念最適合視覺模擬？**  
`Causal State Validator × Negative Control Lab`。

**哪個 Agent 架構最值得實作？**

```text
Representation Builder
↓
Lineage / Leakage Auditor
↓
Causal Role Classifier
↓
Negative Control / Proxy Validator
↓
Intervention Falsification Engine
↓
Causal State Sufficiency Auditor
↓
Causal Certificate
↓
Permission Gate
```

---

# 12. 「AI 到底怎麼運作」本輪補上的一層

目前整體還原鏈已可再細化：

```text
User / Camera / Image / Voice / Video / Tool
↓
Encoder
↓
Tokens / Embeddings
↓
Fusion
↓
Representation State
↓
[NEW] Representation Lineage
↓
[NEW] Causal Role Validation
↓
[NEW] Negative-Control / Proxy Falsification
↓
Belief / Reasoning / Planning
↓
Action / Information Action
↓
World
```

核心原則：

> 神經網路把很多觀測壓成一個高維向量，並不表示這個向量已經變成「世界的真正狀態」。它可能只是對目前資料分布非常好用的預測捷徑。若 Agent 要用這個 representation 來回答「如果我改做另一個 action，世界會怎樣」，就必須再經過因果角色、時間合法性、負控制、排除限制、干預穩定性與 bridge / identification 的檢查。Prediction representation 與 causal state 是不同層級的物件。