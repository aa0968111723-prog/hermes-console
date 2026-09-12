# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 02:54（Asia/Taipei）**

## 本輪研究主題
**Sensitivity-Evidence Fusion × Data-Driven Partial Identification × Confounding Falsification × State-Level Identifiability × Transport-Drift Gate**

> 本輪承接 `2026-09-13-sensitivity-budget-adversarial-world-search-causal-regret.md`。上一輪已建立 Gamma Envelope、Adversarial Compatible-World Search、Causal Decision Regret 與 Temporal Cross-Fit Contract。本輪不重複 MSM / Γ / minimax-regret 基礎，而集中補上四個仍未封閉的問題：**(1) Γ 除了 observed-covariate benchmark，能否有資料驅動的 reference bound；(2) 如何主動 falsify「無未量測混雜」而不是只做 sensitivity；(3) 全域不可識別時，特定 Agent state 是否仍可識別；(4) certificate 在 environment / outcome distribution shift 後，應如何轉成 transport-sensitive certificate。**

---

# 本小時新發現

1. **Information-Theoretic Causal Bounds under Unmeasured Confounding（CLeaR 2026）**：建立資料驅動的 f-divergence bound，將 observational `P(Y|A=a,X=x)` 與 interventional `P(Y|do(A=a),X=x)` 的差距以 propensity score 的函數上界，不需要外部 Γ、proxy、IV 或完整 SCM。這可作為 Hermes `GammaEnvelope` 之外的第二條 reference-bound path。
2. **Falsification of Unconfoundedness by Testing Independence of Causal Mechanisms（ICML 2025）**：跨多 environment 分別擬合 treatment mechanism 與 outcome mechanism，若兩組 mechanism parameter 在環境間呈依賴，可反證 unconfoundedness。這不是證明 ignorability，而是 runtime falsification sensor。
3. **RickardKarl/falsification-unconfoundedness GitHub**：`src/ours/method.py` 真正逐 environment 擬合 outcome model 與 treatment model、bootstrap coefficients，最後對兩組 coefficient 做 permutation / bootstrapped independence test；不是只比較 environment-wise ATE。
4. **On the Granularity of Causal Effect Identifiability（UAI 2026）**：variable-level causal effect 不可識別時，某些具體 state-to-state effects 在有 context-specific independence / state constraints 時仍可能可識別。這對 Agent 很重要：不能因「整個 MCP_WRITE effect 不可識別」就把所有具體 state 一律 BLOCK。
5. **Sharp Bounds for Treatment Effect Generalization under Outcome Distribution Shift（CLeaR 2026）**：以 likelihood-ratio sensitivity `Lambda >= 1` 表示 target 與 source outcome distribution 的 transportability violation，並得到 sharp target-effect bounds；這可獨立於 hidden-confounding Γ，成為 Hermes 的 `TransportSensitivityEnvelope`。
6. **Sensitivity analysis for causal mediation: bridge score, sharp sensitivity bounds, and calibration（2026）**：提供 observed-covariate benchmark 與 residual-budget calibration，支持把 sensitivity budget 從單一主觀數字轉成可追 provenance 的 evidence fusion。

---

# 本小時最重要 5 個發現

## 1. Γ 不應是唯一 sensitivity axis；Hermes 需要 Data-Driven Reference Bound

### 已確認事實
Jung & Kang（CLeaR 2026）提出 information-theoretic sharp partial-identification framework，其關鍵結果是：

```text
P(Y | A=a, X=x)
       vs
P(Y | do(A=a), X=x)
```

之間的 f-divergence 可以由 propensity score 的函數上界。該框架不要求外部 sensitivity parameter、proxy、IV 或完整 SCM，並提供 Neyman-orthogonal semiparametric estimator。

### 對 Hermes 的新結構

```text
SensitivityEvidenceFusion
├ MSM Gamma envelope
├ observed-covariate benchmark
├ negative-control discrepancy
├ randomized verification gap
├ residual-budget calibration
└ information-theoretic data-driven bound
        ↓
CausalUncertaintyEnvelope
```

這代表 Hermes 不應只有：

```text
Γ = 1.5
```

而要同時回答：

```text
User / domain assumption says: Γ ∈ [1.2,1.8]
Observed-covariate benchmark: equivalent Γ ≈ 1.4
Data-driven divergence reference: effect ∈ [L_info,U_info]
Negative controls: confounding alarm = medium
```

### 為什麼重要
如果 Γ 完全由人拍值，Agent 的 `ROBUST_ACT / VERIFY / BLOCK` 會高度依賴單一未驗證 assumption。加入 data-driven partial-identification bound，可以形成「假設型 bound」與「資料型 reference bound」的交叉檢查。

### 限制
Information-theoretic bound 並沒有消滅 hidden confounding，也不等於它直接估出真實 Γ；它提供的是另一種 partial-identification constraint。

### 新否定關係

```text
Data-Driven Bound ≠ No Hidden Confounding
No External Γ ≠ Point Identification
Γ Envelope ≠ Only Valid Causal Uncertainty Model
```

---

## 2. Ignorability 應被 Falsify，而不是 UI 顯示 True/False

### 已確認事實
Karlsson & Krijthe（ICML 2025）利用多個 heterogeneous environments。核心思想：若沒有 unmeasured confounding，treatment mechanism 與 outcome mechanism 的跨環境變化應符合特定 independence 結構；未量測混雜可能使兩者的環境變化呈依賴，因此可以設計 independence test 來**反證** unconfoundedness。

### 原始碼拆解
Repository：`RickardKarl/falsification-unconfoundedness`

值得看的目錄：

```text
src/ours/
├ method.py
├ independence_tests.py
├ linear_regression_jax.py
└ utils.py
experiments/
```

`method.py` 實際流程：

```text
for each environment e:
    X_e, T_e, Y_e
       ↓
fit outcome model Y ~ phi(X,T)
       ↓
store outcome coefficients beta_Y,e
       ↓
fit treatment model T ~ phi(X)
       ↓
store treatment coefficients beta_T,e
       ↓
bootstrap both coefficient sets

all environments
       ↓
IndependenceTest(
  {beta_Y,e},
  {beta_T,e}
)
       ↓
p-value
```

這比單純：

```text
ATE_environment_1 != ATE_environment_2
```

更底層，因為它直接看 causal mechanisms 的 environment-level co-movement。

### Hermes 新節點

```text
ConfoundingFalsificationMonitor
├ environment_id
├ treatment_mechanism_embedding
├ outcome_mechanism_embedding
├ bootstrap_uncertainty
├ mechanism_dependence_pvalue
├ transport_violation_flags
└ status
```

UI 狀態應是：

```text
NOT_FALSIFIED
FALSIFICATION_WARNING
FALSIFIED_UNDER_TEST
INSUFFICIENT_ENVIRONMENTS
```

而不是：

```text
NO_HIDDEN_CONFOUNDING = TRUE
```

### 限制
無法拒絕 independence 並不代表沒有 confounding；test power、environment diversity、mechanism representation 都會影響結果。

### 新否定關係

```text
Not Falsified ≠ Proven Ignorable
Environment Diversity ≠ Randomization
Mechanism Independence Test ≠ Identification Proof
```

---

## 3. Global Unidentifiability ≠ Every Agent State Unidentifiable

### 已確認事實
Chen & Darwiche（UAI 2026）研究 state-based causal effect identifiability，證明在加入 context-specific independence 或 state constraints 後，某個具體 treatment state → outcome state effect 可能可識別，即使對應的 variable-level effect 不可識別。

### 對 Agent 的直接映射
以前 Hermes 可能有：

```text
MCP_WRITE
global causal status = UNIDENTIFIED
→ BLOCK all MCP_WRITE
```

新架構應允許：

```text
MCP_WRITE global = UNIDENTIFIED

State S1:
read-only workspace
known schema
no external recipient
reversible write
context-specific independencies satisfied
→ IDENTIFIED / BOUNDED

State S2:
external recipient
unknown auth chain
side-effectful webhook
→ UNIDENTIFIED
```

### 新 certificate

```text
StateCausalCertificate
├ variable_level_status
├ state_signature
├ context_specific_constraints
├ state_constraints
├ state_level_identifiability
├ transport_scope
├ effect_bounds
└ provenance
```

### 為什麼重要
這能避免安全系統陷入「全域一個 unknown → 整類工具永久封鎖」的過度保守；同時又不會把局部可識別性誤擴張到所有 state。

### 限制
State-level identifiability 仍依賴額外 context-specific knowledge；如果這些 constraint 是 LLM 猜的，就不能當正式證據。

### 新否定關係

```text
Variable-Level Unidentified ≠ Every State Unidentified
State-Level Identified ≠ Global Effect Identified
Context-Specific Claim ≠ Verified Constraint
```

---

## 4. Hidden-Confounding Γ 與 Transport-Shift Λ 必須分開

### 已確認事實
Asiaee et al.（CLeaR 2026）研究 randomized/source population 到 target population 的 outcome-distribution shift。其 sensitivity model 用：

```text
Lambda >= 1
```

限制 target/source outcome density 的 likelihood ratio；`Lambda=1` 對應標準 transportability，並可導出 sharp target-effect bounds。其求解具有 threshold structure，可用排序與重新分配 probability mass 做 `O(n log n)` 計算。

### Hermes 應正式拆開

```text
GammaConfounding
= logging / action assignment hidden bias

LambdaTransport
= source → current environment outcome-distribution shift
```

這兩者不應混成：

```text
uncertainty = 0.6
```

新資料結構：

```text
TransportSensitivityEnvelope
├ source_environment
├ target_environment
├ lambda_low
├ lambda_reference
├ lambda_high
├ shift_features
├ target_support
├ valid_from
├ valid_until
└ certificate_status
```

### Agent runtime

```text
Historical causal certificate
↓
New tool/model/user/environment regime
↓
Transport shift detector
↓
Lambda envelope
↓
Transported action-value bounds
↓
Ranking stable?
├ YES → certificate retained with narrower scope
└ NO  → RECALIBRATE / VERIFY / BLOCK
```

### 新否定關係

```text
Hidden Confounding ≠ Distribution Shift
Gamma ≠ Lambda
Source-Safe ≠ Target-Safe
Temporal Cross-Fit ≠ Transportability Guarantee
```

---

## 5. World-Search Coverage 需要「結構覆蓋」與「最佳化覆蓋」兩張證明

### 上一輪缺口
上一輪已有：

```text
Adversarial World Search
→ search worst-case compatible world
→ no counterexample found within budget
```

但 `search_coverage` 尚未被拆開。

### 本輪新建模

```text
WorldSearchCoverageCertificate
├ structural_coverage
│  ├ confounding family covered
│  ├ proxy failure modes covered
│  ├ transport shift covered
│  ├ censoring mechanisms covered
│  └ state constraints covered
│
├ optimization_coverage
│  ├ random restarts
│  ├ objective gap
│  ├ convergence diagnostics
│  ├ frontier diversity
│  └ unresolved basins
│
├ state_granularity_coverage
├ gamma_range_covered
├ lambda_range_covered
└ certificate_level
```

Certificate levels：

```text
SEARCHED_ONLY
STRUCTURALLY_COVERED
OPTIMIZATION_STABLE
STATE_LOCAL_CERTIFIED
UNRESOLVED
```

### 核心原則
即使 optimizer 找到很穩定的 minimum：

```text
optimization coverage = high
```

如果 causal model family 根本沒包含「outcome transport shift」：

```text
structural coverage = low
```

仍然不能說 robust。

反過來，model family 很完整，但 adversarial solver 只跑一次：

```text
structural coverage = high
optimization coverage = low
```

也不能升級證明。

### 新否定關係

```text
Optimizer Converged ≠ World Family Complete
World Family Rich ≠ Worst World Found
No Counterexample Found ≠ Structural Coverage
Search Budget Large ≠ Certificate Strong
```

---

# Architecture Breakdown

```text
User / Multimodal Input
↓
Agent Context + Causal State
↓
Candidate Action Set
↓
State-Level Identifiability Analyzer
├ variable-level status
├ state constraints
└ context-specific independencies
↓
Confounding Evidence Stack
├ Gamma benchmark
├ negative controls
├ randomized verification
├ mechanism-independence falsification
└ information-theoretic reference bound
↓
Sensitivity Evidence Fusion
↓
Gamma Envelope
↓
Transport Shift Analyzer
↓
Lambda Envelope
↓
Compatible World Constraint Builder
↓
Adversarial World Search
↓
WorldSearchCoverageCertificate
↓
Action Value Bounds
↓
Causal Decision Regret
↓
Planner Gate
├ ROBUST_ACT
├ STATE_LOCAL_ACT
├ VERIFY_FIRST
├ ASK_USER
├ HUMAN
├ ABSTAIN
└ BLOCK
↓
Tool / MCP / Browser / Computer Runtime
↓
Outcome + New Environment Evidence
↓
Falsification / Transport / Sensitivity update
```

---

# Bottom-Level Logic

## A. Sensitivity Evidence Fusion

不要直接平均 Γ，而是保留不同 evidence 的語意：

```text
E_gamma = {
  benchmark covariate,
  negative control,
  trusted randomized slice,
  residual budget,
  proxy mismatch
}

E_info = data-driven partial-identification reference
E_transport = Lambda outcome-shift envelope
```

Planner 看到的是：

```text
CausalEvidenceState
= (GammaEnvelope,
   InfoTheoreticBound,
   LambdaEnvelope,
   FalsificationStatus,
   StateIdentifiability)
```

而不是單一 confidence。

## B. Mechanism Falsification

```text
Environment e
↓
Treatment mechanism theta_T,e
Outcome mechanism theta_Y,e
↓
Across environments:
Test theta_T ⟂ theta_Y
↓
Reject independence?
├ YES → unconfoundedness falsification warning
└ NO  → assumption survives this test only
```

## C. State-Local Gate

```text
Global action A unidentified
↓
Current state s
↓
Apply state/context-specific constraints
↓
Is P(Y=y | do(A=a), S=s) identifiable/bounded?
├ YES → issue state-local certificate
└ NO  → remain unidentified
```

## D. Two-Axis Sensitivity

```text
Confounding axis Γ
×
Transport axis Λ
↓
V(a ; Γ,Λ,ω)
```

新 Planner 應至少探索：

```text
min_{Γ∈G, Λ∈L, ω∈Ω(Γ,Λ)} V(a)
```

以及：

```text
WorstCaseRegret(a)
= max_{Γ,Λ,ω}
  [max_b V(b;Γ,Λ,ω)-V(a;Γ,Λ,ω)]
```

---

# Visual Simulation Idea

## **Causal Certificate Observatory：Γ × Λ × State × Falsification**

### 1. 雙軸 sensitivity surface

```text
              Lambda transport shift
             1.0   1.2   1.5   2.0
Gamma 1.0   COM   COM   ASK   ASK
      1.3   COM   ASK   ASK   VER
      1.6   ASK   ASK   VER   VER
      2.0   ASK   VER   VER   BLOCK
```

### 2. State-level identifiability map

```text
MCP_WRITE
├ state A  IDENTIFIED     ✓
├ state B  BOUNDED        ⚠
├ state C  UNIDENTIFIED   ✕
└ state D  STALE          ↻
```

### 3. Mechanism falsification panel

```text
Environment     Treatment mech   Outcome mech
v1/tool4             ●               ▲
v2/tool4             ●               ▲
v2/tool5             ○               ■
v3/tool5             ◇               ◆

mechanism dependence p = 0.008
STATUS: FALSIFICATION_WARNING
```

### 4. World-search coverage panel

```text
Structural coverage
Confounding          92%
Proxy failure        71%
Transport shift      84%
Censoring            43%  ⚠
State constraints    89%

Optimization coverage
Restarts             24
Frontier stable      YES
Unresolved basins    3
```

使用者看到的不是「AI 信心 72%」，而是：

> 哪一種 hidden bias、哪一種 environment shift、哪一個具體 state，會讓 causal certificate 改變；以及目前 adversarial search 到底漏了哪些 world family。

---

# Code / GitHub

## 1. RickardKarl/falsification-unconfoundedness
URL: https://github.com/RickardKarl/falsification-unconfoundedness

### 值得看的目錄與核心檔案

```text
src/ours/method.py
src/ours/independence_tests.py
src/ours/linear_regression_jax.py
src/ours/utils.py
experiments/run.py
experiments/notebooks/
```

### Runtime 抽象

```text
multi-environment logs
→ fit treatment mechanisms
→ fit outcome mechanisms
→ bootstrap mechanism parameters
→ independence test across environments
→ falsification p-value
```

### Hermes 可借鑑處
- 把 `policy version / tool version / user segment / deployment epoch` 當 environment。
- mechanism representation 不應只是一個 scalar ATE；應保留 treatment-policy 與 outcome-model parameter/embedding。
- bootstrap uncertainty 必須一起進 falsification dashboard。

### 限制
目前 repo 實作重點在較受控的 tabular / regression setting；直接套到高維 Agent latent state 需要 representation layer 與更強 independence test。

---

# Papers

## Paper A
**Title:** Information-Theoretic Causal Bounds under Unmeasured Confounding  
**Authors:** Yonghan Jung, Bogyeong Kang  
**Institution:** 本輪未從公開 HTML 驗證 affiliation，避免推測  
**Year:** 2026  
**URL:** https://proceedings.mlr.press/v323/jung26a.html  
**Code:** 本輪未確認官方 code  
**Dataset:** 論文頁說明含 simulation 與 real-world applications；本輪未從 HTML 驗證資料集名稱  
**Architecture:** observational conditional distribution + propensity → f-divergence constraint → sharp conditional causal bounds → Neyman-orthogonal estimator  
**Contribution:** 不需要外部 sensitivity parameter 即可取得 data-driven partial-identification bound  
**Limitations:** 仍是 partial identification；不能解讀成無 hidden confounding  
**改變了什麼：** Hermes 的 sensitivity stack 不再只能依賴人工 Γ，可以加入 data-driven reference-bound path。

## Paper B
**Title:** Falsification of Unconfoundedness by Testing Independence of Causal Mechanisms  
**Authors:** Rickard Karlsson, Jh Krijthe  
**Institution:** 本輪未從公開 HTML 驗證 affiliation，避免推測  
**Year:** 2025  
**URL:** https://proceedings.mlr.press/v267/karlsson25a.html  
**Code:** https://github.com/RickardKarl/falsification-unconfoundedness  
**Dataset:** simulated + semi-synthetic / real-world experiments（公開頁面描述）  
**Architecture:** heterogeneous environments → treatment/outcome mechanism estimation → mechanism-independence test → falsification  
**Contribution:** 無需 randomized data，即可在多環境下反證 unconfoundedness  
**Limitations:** 不拒絕 null 不等於證明沒有 confounding；依賴 environment richness/test power  
**改變了什麼：** Hermes 增加 `ConfoundingFalsificationMonitor`，把 ignorability 從靜態 assumption 變成可被持續攻擊的 hypothesis。

## Paper C
**Title:** On the Granularity of Causal Effect Identifiability  
**Authors:** Yizuo Chen, Adnan Darwiche  
**Institution:** 本輪未從公開 HTML 驗證 affiliation，避免推測  
**Year:** 2026  
**URL:** https://proceedings.mlr.press/v337/chen26c.html  
**Code:** 本輪未確認官方 code  
**Dataset:** empirical studies；公開 HTML 未列 dataset 名稱  
**Architecture:** variable-level identifiability → context-specific/state constraints → state-level effect identification  
**Contribution:** 證明 variable-level effect 不可識別時，state-based effect 仍可能可識別  
**Limitations:** 需要額外 context-specific / state knowledge  
**改變了什麼：** Hermes Planner 可從 global BLOCK 升級成 state-local certificate。

## Paper D
**Title:** Sharp Bounds for Treatment Effect Generalization under Outcome Distribution Shift  
**Authors:** Amir Asiaee, Samhita Pal, Cole Beck, Jared Davis Huling  
**Institution:** 本輪未從公開 HTML 驗證 affiliation，避免推測  
**Year:** 2026  
**URL:** https://proceedings.mlr.press/v323/asiaee26a.html  
**Code:** 本輪未確認官方 code  
**Dataset:** simulation studies；公開 HTML 未列具體 dataset  
**Architecture:** source outcomes + target sensitivity Lambda → sharp likelihood-ratio bounds → threshold/greedy optimization  
**Contribution:** 將 transportability violation 轉成可計算 sharp bounds，求解 `O(n log n)`  
**Limitations:** Lambda 仍是一個 sensitivity specification；不能與 hidden-confounding Γ 混為一談  
**改變了什麼：** Hermes 新增 `TransportSensitivityEnvelope`，certificate 明確帶 source/target scope。

## Paper E
**Title:** Sensitivity analysis for causal mediation: bridge score, sharp sensitivity bounds, and calibration  
**Authors:** Yuki Ohnishi, Fan Li  
**Institution:** 本輪未從公開 HTML 驗證 affiliation，避免推測  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2605.18724  
**Code:** 本輪未確認  
**Dataset:** 本輪未驗證  
**Architecture:** bridge score → sharp pointwise envelope → observed-covariate / residual-budget calibration → Bayesian g-computation  
**Contribution:** sensitivity parameter 可藉 benchmark / residual variation 做 operational calibration  
**Limitations:** mediation setting不可無條件直接等同 Agent policy setting，需要抽象層轉譯  
**改變了什麼：** 支持 Hermes 的 sensitivity-budget provenance，而非 hard-coded Γ。

---

# Unknown / Open Questions

1. **Data-driven information-theoretic bound 與 MSM Γ envelope 如何安全融合？** 兩者的 uncertainty set 語意不同，不能直接取平均；需要 intersection/union/refutation logic。
2. **Mechanism falsification 如何用在高維 Agent representation？** `beta_T` / `beta_Y` 在 LLM/Tool runtime 中可能需改成低維 mechanism embedding，而 embedding 本身又會 drift。
3. **State-local identifiability 如何跨時間 transport？** 今天 state `S` 可識別，不代表 tool schema/model/user distribution 更新後仍成立，需要 versioned context-specific constraints。

---

# 下一輪研究

下一輪建議主題：

**Causal Evidence Reconciliation × Bound Intersection/Conflict × Mechanism Embedding Drift × State-Certificate Invalidation**

研究 loop：

```text
MSM Gamma bound
+
Information-theoretic bound
+
Proximal / proxy bound
+
Negative-control result
+
Mechanism falsification
+
Transport Lambda bound
↓
Evidence reconciliation
↓
Do bounds agree?
├ YES → tighten certificate
├ PARTIAL → retain union / robust envelope
└ CONFLICT → assumption-debugging graph
↓
Locate conflicting assumption
↓
choose verification / experiment
↓
repair certificate
```

下一輪至少要回答：
- 多種 causal bounds 發生不相交時，Hermes 應相信哪一個？
- 如何把 conflict 定位到 `proxy validity / hidden confounding / transport shift / state constraint / model misspecification`？
- 哪一個最小 verification query 能最大幅縮小 causal evidence conflict？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Sensitivity Evidence Fusion
Information-Theoretic Causal Bound
Data-Driven Divergence Bound
Confounding Falsification Monitor
Causal Mechanism Independence
Treatment Mechanism Embedding
Outcome Mechanism Embedding
Falsification Environment
State-Level Identifiability
State Causal Certificate
Context-Specific Independence
State Constraint
Transport Sensitivity Envelope
Transport Lambda
Outcome Distribution Shift
World Search Structural Coverage
World Search Optimization Coverage
World Search Coverage Certificate
State-Granularity Coverage
```

## Edges

```text
Information-Theoretic Bound
  --constrains--> Causal Uncertainty Envelope

Mechanism Dependence
  --falsifies--> Unconfoundedness Assumption

Context-Specific Independence
  --can-enable--> State-Level Identifiability

Transport Lambda
  --bounds--> Target-Environment Causal Effect

State Causal Certificate
  --scoped-to--> State Signature

World Search Coverage Certificate
  --qualifies--> Robust Action Certificate
```

## 新否定 Edges

```text
Data-Driven Bound ≠ No Hidden Confounding
Not Falsified ≠ Proven Ignorable
Global Unidentifiable ≠ Every State Unidentifiable
State-Level Identified ≠ Globally Identified
Gamma ≠ Lambda
Source-Safe ≠ Target-Safe
Optimizer Converged ≠ World Family Complete
World Family Rich ≠ Worst World Found
```

---

# 本輪結束判定

**缺哪一層：** `Causal Evidence Reconciliation`——Hermes 已有 Γ、proxy/proximal、information-theoretic、falsification、transport 多種證據，但還沒有正式規則處理它們互相衝突。

**哪個節點最淺：** `WorldSearchCoverageCertificate`、`StateCausalCertificate transport scope`、`MechanismEmbedding`。

**哪個概念仍只是名詞：** production-scale `HighDimensionalMechanismFalsification` 與跨證據 `CausalBoundConflictResolver`。

**哪個系統值得讀原始碼：** `RickardKarl/falsification-unconfoundedness`，下一步應深入 `src/ours/independence_tests.py` 與 bootstrap implementation，並研究如何從 regression coefficient 換成 Agent mechanism embedding。

**哪篇論文需追引用：** `Information-Theoretic Causal Bounds under Unmeasured Confounding`；它可能提供一條不用人工 Γ 的重要補充路徑，值得追後續 extension 到 sequential decision / policy learning。

**哪個概念最適合視覺模擬：** `Causal Certificate Observatory：Γ × Λ × State × Falsification`。

**哪個 Agent 架構最值得實作：**

```text
Evidence-Reconciled Causal Planner
=
State-Level Identifiability
+
Sensitivity Evidence Fusion
+
Confounding Falsification
+
Gamma × Lambda Two-Axis Robustness
+
Adversarial World Search Coverage
+
Causal Decision Regret Gate
```

---

# 對「AI 到底怎麼運作」新增的底層還原

```text
使用者輸入
↓
UI / Agent
↓
Context + Memory + Multimodal observations
↓
Causal State
↓
Planner proposes action
↓
不是立刻執行
↓
問：這個 state 的 action effect 可識別嗎？
↓
問：hidden confounding 的證據有多強？
↓
問：多 environment 是否已反證 ignorability？
↓
問：現在 environment 是否已偏離 certificate 的 source domain？
↓
Gamma × Lambda × Compatible Worlds
↓
Adversarial world search
↓
Decision regret + world-search coverage
↓
ROBUST_ACT / VERIFY / ASK / HUMAN / BLOCK
↓
Tool / MCP / Browser / Computer Runtime
↓
真實 outcome 回來
↓
更新 sensitivity、falsification、transport 與 state certificate
```

本輪核心結論：**成熟 Agent 不能把「因果不確定性」只壓成一個 Γ 或一個 confidence。它至少要分開 hidden confounding、資料驅動 partial-identification、跨環境 falsification、state-local identifiability 與 source→target transport shift；最後還要知道 adversarial world search 到底覆蓋了哪些 causal failure family。只有這些證據彼此沒有重大衝突，Planner 的 action certificate 才真正有意義。**