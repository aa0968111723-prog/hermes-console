# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 05:50（Asia/Taipei）**  
**本輪主題：Minimal Distinguishing Interventions × Active Certificate Revalidation × Goal-Oriented Causal Experiment Design × Intervention Budgeting**

---

## 0. 與歷史研究的差異 / 去重

前一輪已建立：

```text
Encoder v17 → Encoder v18
↓
Causal Representation Equivalence
↓
Intervention Signature Comparison
↓
Certificate Migration
```

但仍有 production 缺口：**不可能為每次 encoder / VLM / fusion / tool schema 更新，把所有 intervention 全部重跑。**

因此本輪不再問「怎麼判斷兩個 representation 是否等價」，而改問：

> 如果只能做 3–5 個 intervention，該挑哪幾個，才能最有效區分「舊 certificate 仍成立」與「舊 certificate 已失效」？

這把問題從 **causal equivalence testing** 推進成 **causal experiment design**。

---

# 本小時新發現

本輪找到四條可以直接拼成 Hermes revalidation runtime 的研究線：

1. **Minimum-cost identification**：JMLR 2025《Optimal Experiment Design for Causal Effect Identification》把「為了識別特定 causal effect，最少要做哪些 intervention」連到 minimum hitting set，並證明一般問題 NP-complete。
2. **Minimum intervention set for DAG orientation**：AAAI 2025《Causal Discovery by Interventions via Integer Programming》用 integer programming 設計最小 intervention set，使 causal structure 可被識別。
3. **Goal-oriented sequential design**：2025《Goal-Oriented Sequential Bayesian Experimental Design for Causal Learning》（GO-CBED）不要求重建完整 causal model，而直接最大化對 user-specified causal quantity 的 expected information gain，並使用非 myopic sequential design。
4. **Agent benchmark / runtime evidence**：`qpiai/Active-Causal-Discovery-Bench` 已將 `observe → intervene → submit` 做成具 intervention budget 的 Agent environment，同時由 evaluator 計算 CPDAG 與 oracle minimum intervention set，可作為 Hermes Active Revalidation Harness 的工程參考。

主要來源：
- JMLR 2025: https://www.jmlr.org/beta/papers/v26/22-1516.html
- AAAI 2025: https://ojs.aaai.org/index.php/AAAI/article/view/33810
- GO-CBED: https://arxiv.org/abs/2507.07359
- Active Causal Discovery Bench: https://github.com/qpiai/Active-Causal-Discovery-Bench
- Nature Machine Intelligence active intervention design: https://www.nature.com/articles/s42256-023-00719-0

---

# 本小時最重要 5 個發現

## 1. 最少 intervention 不是「測越多越好」，而是 hitting-set / identifiability 問題

### 已確認事實

Akbari, Etesami, Kiyavash（JMLR 2025）研究的是：已知 observational information 不足以識別 target causal effect 時，如何用**最低 intervention cost**補足識別性。該工作證明一般設計問題 NP-complete，並建立與 minimum hitting set 的連結，提供 exact、log-factor approximation 與 polynomial heuristics。

### 底層邏輯

假設目前 certificate `C` 依賴多組尚未排除的 causal ambiguity：

```text
A1 = {I_camera, I_light}
A2 = {I_voice, I_user_prompt}
A3 = {I_camera, I_tool_schema}
```

每個 ambiguity 只要被至少一個 intervention 擊中，就能被區分。

因此問題可寫成：

```text
Choose S ⊆ candidate interventions

minimize     Σ cost(I)

subject to   ∀ ambiguity A_j:
             S ∩ A_j ≠ ∅
```

這就是 Hermes 可以使用的 **Minimal Distinguishing Intervention Set (MDIS)** 原型。

### 為什麼重要

上一輪的 `InterventionSignatureMatrix` 假設 intervention set 已經存在；本輪補上「怎麼挑 intervention」。

### 限制

JMLR 的 theorem 是 causal-effect identification 設計，不能直接宣稱等價於 learned representation certificate migration。Hermes 的 MDIS 是 architecture transfer / 合理推論，需要額外定義 certificate-specific distinguishing constraints。

---

## 2. Full causal discovery 和 Certificate Revalidation 的 objective 不一樣

### 已確認事實

GO-CBED 的核心是：不必最大化對整個 causal model 的 information gain，而可以直接針對 user-specified causal quantity / QoI 最大化 EIG；其設計還是 sequential 與 non-myopic。

### 對 Hermes 的映射

如果目前只想重新驗證：

```text
Certificate CSC-8:
"Visual representation 可用於 WRITE_EXTERNAL risk adjustment"
```

則不必恢復完整 multimodal SCM：

```text
Camera
Voice
DOM
Tool
Memory
User
Latency
Policy
...
```

只需要最大化對：

```text
Claim C =
P(certificate remains valid | evidence)
```

或 downstream estimand：

```text
ψ = policy risk under new encoder
```

的辨識力。

因此：

```text
Full-Model Information Gain
≠
Certificate-Relevant Information Gain
```

Hermes 新增 acquisition objective：

```text
CertificateEIG(I)
=
Expected reduction in uncertainty
about certificate-validity claim C
under intervention I
```

再扣：

```text
Risk(I)
Latency(I)
UserBurden(I)
Token/API Cost(I)
Physical Cost(I)
PrivacyCost(I)
```

最後：

```text
Score(I)
=
CertificateEIG(I)
- λ1 Cost(I)
- λ2 Risk(I)
- λ3 Latency(I)
```

### 限制

GO-CBED 的 published setting 是 causal learning / QoI，不是 AI model certificate lifecycle。本輪是把其 goal-oriented experiment design 原則映射到 Hermes。

---

## 3. Minimum sufficient intervention set 可以成為 Agent efficiency oracle

### GitHub 原始碼確認

`qpiai/Active-Causal-Discovery-Bench` 的 `src/causal_discovery/equivalence/theory.py` 實際實作：

```python
compute_minimum_intervention_set(dag, cpdag)
```

其流程不是 heuristic：

```text
for size = 0..d
  enumerate combinations(nodes, size)
  ↓
  orient incident ambiguous edges
  ↓
  apply Meek closure
  ↓
  test whether completed graph == true DAG
  ↓
  first success = lexicographically first minimum set
```

也就是 benchmark evaluator 持有一個真正的 minimum sufficient intervention oracle。

程式還明確把 intervention target 所 incident 的 undirected edges 按 true DAG 定向，接著執行 Meek closure，直到判斷是否完全匹配 DAG。

### Hermes 借用方式

對 synthetic / replay environment，Hermes 可以離線計算：

```text
Oracle MDIS size = 3
Agent used        = 7

Revalidation Efficiency = 3 / 7
```

production 世界沒有 true SCM oracle，但可使用：

```text
Known dependency graph
+ competing causal hypotheses
+ certificate claim set
```

建立近似 minimal distinguishing set。

### 核心區分

```text
Intervention Budget Used
≠
Intervention Efficiency
```

---

## 4. Active revalidation 應該是閉環，不是一次性 test suite

### 已確認事實

GO-CBED 使用 sequential non-myopic experimental design；Nature Machine Intelligence 的 active intervention design 也採 Bayesian update → acquisition → intervention → update 的 active-learning loop。

### Hermes runtime

不應：

```text
Model upgrade
↓
run fixed 20 tests
↓
PASS / FAIL
```

而應：

```text
Certificate Hypothesis Set H_0
↓
Generate Candidate Interventions
↓
Estimate Discrimination / EIG
↓
Risk + Cost Gate
↓
Choose I_t
↓
Execute in shadow / sandbox / canary
↓
Observe Δ response
↓
Update H_t
↓
Recompute remaining ambiguity
↓
Stop if certificate decision is identified enough
```

新增停止條件：

```text
STOP when

P(MIGRATE | evidence) > τ_migrate

or

P(EXPIRE | evidence) > τ_expire

or

remaining budget < minimum safe experiment cost
```

### 為什麼重要

如果第一個 intervention 已經明確打破 certificate，後面 19 個測試沒有必要繼續；反之如果第一個結果讓某些 hypotheses 更難區分，下一個 test 應該改變。

---

## 5. Production intervention 必須區分「辨識力」與「安全可執行性」

### 已確認事實

Active experiment design 文獻通常優化 information、identification 或 target intervention performance；但 Hermes 的 intervention 可能是：

```text
change prompt framing
change tool schema
change memory state
switch camera input
simulate failed auth
change MCP permission
inject stale retrieval
change multimodal modality availability
```

其中部分 intervention 可以在 shadow/sandbox 做，部分會改真實世界。

### 新增 Intervention Safety Class

```text
InterventionSafetyClass
├ OFFLINE_REPLAY
├ SYNTHETIC
├ SHADOW
├ SANDBOX
├ READ_ONLY_LIVE
├ REVERSIBLE_CANARY
├ EXTERNAL_SIDE_EFFECT
└ PROHIBITED
```

所以真正 acquisition 應是 constrained optimization：

```text
I* = argmax_I DistinguishingPower(I)

subject to
  Permission(I) = ALLOW
  Risk(I) <= R_max
  Cost(I) <= Budget
  Privacy(I) <= P_max
```

因此：

```text
Most Informative Intervention
≠
Best Production Intervention
```

---

# Architecture Breakdown

## Active Certificate Revalidation Runtime

```text
Model / Encoder / Fusion / Tool Change
↓
Certificate Dependency Graph
↓
Affected Claims Extractor
↓
Competing Causal Hypothesis Builder
↓
Candidate Intervention Generator
├ replay
├ modality ablation
├ sensor perturbation
├ tool-schema perturbation
├ MCP permission perturbation
├ context/memory perturbation
├ environment shift
└ user-query perturbation
↓
Intervention Safety Classifier
↓
Distinguishing-Power Engine
├ hypothesis elimination
├ expected information gain
├ expected certificate entropy reduction
├ estimand uncertainty reduction
└ structural signature distance
↓
Cost / Risk / Latency / Privacy Model
↓
Minimal Distinguishing Intervention Planner
├ exact hitting-set / IP when tractable
├ greedy set cover
├ goal-oriented EIG
└ sequential non-myopic policy
↓
Shadow / Sandbox / Canary Executor
↓
Observation Ledger
↓
Hypothesis / Certificate Posterior Update
↓
Replan
↓
Stop Rule
├ MIGRATE
├ SCOPED_MIGRATION
├ REVALIDATE_MORE
├ EXPIRE
└ BLOCK
↓
Permission Diff
↓
Commit / Rollback
```

---

# Bottom-Level Logic

## A. Distinguishing matrix

對 competing certificate hypotheses：

```text
H = {H1, H2, ..., Hm}
```

和 intervention candidates：

```text
I = {I1, I2, ..., In}
```

建立：

```text
D[k,a,b] =
1 if intervention I_k is expected to distinguish H_a from H_b
0 otherwise
```

目標：找最小集合 `S`，使所有 certificate-relevant hypothesis pairs 都至少被區分一次：

```text
∀(a,b) relevant to certificate:
Σ_{k∈S} D[k,a,b] ≥ 1
```

## B. Soft / probabilistic distinguishing power

真實 multimodal system 不會是 deterministic：

```text
D[k,a,b]
→
KL(
  P(O | do(I_k),H_a)
  ||
  P(O | do(I_k),H_b)
)
```

或使用 Jensen-Shannon / expected posterior entropy reduction：

```text
EIG(I_k)
=
H(H | history)
-
E_o[H(H | history,I_k,o)]
```

## C. Claim-scoped utility

不是所有 hypothesis difference 都會影響 certificate：

```text
Weight(a,b,C)
=
1 if H_a and H_b imply different certificate decision
0 otherwise
```

所以：

```text
CertificateDistinguishingPower(I)
=
Σ_{a<b}
Weight(a,b,C) × Divergence_I(a,b)
```

這是本輪最核心的 Hermes mechanism。

## D. Sequential update

```text
Prior over hypotheses
↓
Choose I1
↓
Observe O1
↓
Posterior H | O1
↓
Remove / downweight hypotheses
↓
Recalculate candidate intervention values
↓
Choose I2
...
```

因此：

```text
Static Minimal Test Set
≠
Sequentially Optimal Test Policy
```

---

# Visual Simulation Idea

## Minimal Distinguishing Intervention Lab

左側：Certificate Dependency Graph

```text
Encoder v18
├ Visual Latent
│  ├ NCO-12
│  └ Proxy-7
├ CSC-8
└ OPE-31
   └ WRITE_EXTERNAL
```

中央：Competing hypotheses

```text
H1  Fully equivalent
H2  Camera causal role shifted
H3  Tool proxy invalid
H4  Negative control invalid
H5  Only risk-ranking remains valid
```

右側：candidate intervention matrix

| Intervention | H1/H2 | H1/H3 | H1/H4 | H1/H5 | Cost | Risk |
|---|---:|---:|---:|---:|---:|---:|
| Camera occlusion | .91 | .12 | .06 | .33 | 1 | Low |
| Tool schema shift | .05 | .94 | .14 | .44 | 2 | Low |
| NCO perturbation | .18 | .21 | .96 | .38 | 2 | Low |
| Live external write | .50 | .61 | .70 | .88 | 9 | High |

按下：

```text
OPTIMIZE 3 TESTS
```

Console 顯示：

```text
Selected:
1. Camera occlusion
2. Tool schema shift
3. NCO perturbation

Predicted certificate entropy:
1.84 bits → 0.21 bits

Coverage:
96%

Live-world risk:
0
```

執行第一個 test 後：

```text
Observed:
Camera response shifted strongly

Posterior:
H1 .05
H2 .81
H3 .07
H4 .04
H5 .03
```

Planner 即時重算：

```text
Cancel Tool schema shift
Run Camera lighting intervention instead
```

這就是 **Active Certificate Revalidation**，而不是固定 regression suite。

---

# Code / GitHub

## Active-Causal-Discovery-Bench

Repository:
https://github.com/qpiai/Active-Causal-Discovery-Bench

值得深讀：

```text
src/causal_discovery/
├ equivalence/
│  ├ cpdag.py
│  └ theory.py
├ runtime/
│  └ session.py
├ benchmark/
├ scoring/
├ scm/
├ sampling/
├ agents/
└ baselines/
```

### `equivalence/theory.py`

值得借用：

```text
dag_to_cpdag()
compute_minimum_intervention_set()
_orient_with_intervention_targets()
_apply_meek_closure()
```

其 minimum set search 目前是組合枚舉，適合作為小型 synthetic oracle / correctness reference；不適合直接擴展到大型 production intervention space。

### `runtime/session.py`

runtime 真正實作：

```text
observe()
↓
intervene(var, value)
↓
remaining_budget -= 1
↓
submit_graph()
↓
sealed session
```

重要工程 primitive：

```text
remaining_budget
interventions_used
session sealed state
observe-once contract
```

Hermes 可擴展成：

```text
RevalidationSession
├ remaining_cost_budget
├ remaining_risk_budget
├ interventions_used[]
├ posterior_history[]
├ affected_certificates[]
├ stop_reason
└ final_migration_decision
```

---

# Papers

## 1. Optimal Experiment Design for Causal Effect Identification

- **Authors:** Sina Akbari, Jalal Etesami, Negar Kiyavash
- **Institution:** EPFL / TUM
- **Year:** 2025
- **Venue:** JMLR 26
- **URL:** https://www.jmlr.org/beta/papers/v26/22-1516.html
- **Architecture / Method:** causal effect identification + minimum-cost intervention design + minimum hitting set
- **Contribution:** 將 target-effect identification 的 intervention design 化為可最佳化的成本問題，證明 NP-complete，提供 exact / approximation / heuristic 解法。
- **Limitations for Hermes:** 假設 causal graph / identification setup 與 AI learned-representation migration 不完全相同。
- **改變了什麼:** 讓「應做哪些實驗」從 heuristic test selection 變成 identification-aware optimization。

## 2. Causal Discovery by Interventions via Integer Programming

- **Authors:** Abdelmonem Elrefaey, Rong Pan
- **Institution:** Arizona State University
- **Year:** 2025
- **Venue:** AAAI 2025
- **URL:** https://ojs.aaai.org/index.php/AAAI/article/view/33810
- **Architecture / Method:** integer-programming intervention design
- **Contribution:** 設計 minimal intervention set 以保證 causal structure identifiability，並可納入不同 constraints。
- **Limitations:** 目標主要是 graph identification，而非 certificate-specific learned representation validation。
- **改變了什麼:** 提供「minimal sufficient interventions」精確最佳化方向。

## 3. Goal-Oriented Sequential Bayesian Experimental Design for Causal Learning

- **Authors:** Zheyu Zhang, Jiayuan Dong, Jie Liu, Xun Huan
- **Institution:** University of Michigan 等
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2507.07359
- **Code:** 本輪未確認正式 code repository，因此不虛構。
- **Dataset:** synthetic SCM + semi-synthetic gene regulatory settings（論文摘要所述）
- **Architecture:** transformer policy + normalizing-flow variational posterior + variational EIG objective
- **Contribution:** goal-oriented、non-myopic sequential causal experimental design；直接針對 target causal QoI，而非整個 model。
- **Limitations:** amortized design 的泛化依賴訓練分布與 causal model family；尚不能直接保證 Hermes production safety。
- **改變了什麼:** 強化「certificate-specific experiment design」的理論方向。

## 4. Active Learning for Optimal Intervention Design in Causal Models

- **Authors:** Jiaqi Zhang, Louis Cammarata, Chandler Squires, Themistoklis P. Sapsis, Caroline Uhler et al.
- **Institution:** MIT / Broad / Harvard
- **Year:** 2023
- **Venue:** Nature Machine Intelligence
- **URL:** https://www.nature.com/articles/s42256-023-00719-0
- **Dataset:** synthetic + Perturb-CITE-seq
- **Architecture:** Bayesian update + causally informed acquisition function + sequential interventions
- **Contribution:** 以較少、精選 intervention 找到最佳 target intervention；有 information-theoretic / consistency results（其設定下）。
- **Limitations:** 線性 causal model / known graph 等 theorem conditions不能直接轉成 general multimodal Agent runtime。

---

# Fact / Engineering / Inference / Hypothesis 分層

## 已確認事實

- JMLR 2025 已把 minimum-cost causal-effect-identification intervention design 連到 hitting set。
- AAAI 2025 已提出 minimum intervention set 的 integer-programming設計。
- GO-CBED 明確是 goal-oriented、sequential、non-myopic causal experimental design。
- Active-Causal-Discovery-Bench 的原始碼確實有 intervention budget 與 exact small-graph minimum intervention oracle。

## 工程實作已確認

- `BenchmarkEnv.intervene()` 每次實際扣除 intervention budget。
- `compute_minimum_intervention_set()` 逐 size enumeration candidate node sets，並以 intervention orientation + Meek closure 檢查是否完整恢復 DAG。

## 合理推論 / 架構映射

- 把 target causal QoI 映射成 `certificate validity claim`。
- 把 hitting set 映射成 Minimal Distinguishing Intervention Set。
- 把 EIG acquisition 映射成 certificate entropy reduction。

## 尚未驗證假說

- 一個 generic neural multimodal representation certificate 是否能用統一的 MDIS theorem 處理。
- GO-CBED 型 amortized experiment policy 能否跨不同 model families / MCP / multimodal runtime 可靠泛化。
- intervention-signature divergence 應使用 KL、JS、Wasserstein 還是 task-specific discrepancy，目前沒有 universal answer。

---

# Unknown / Open Questions 1–3

## 1. Learned Representation 的「minimal distinguishing set」是否可有一般保證？

DAG orientation 有明確 graph-theoretic structure；neural representation certificate 常是 nonlinear / partially identified。

缺：

```text
Certificate claim
↓
finite hypothesis class / causal ambiguity set
↓
provable minimal separating experiments
```

## 2. Sequential EIG 是否會被 model misspecification 騙？

如果 planner 的 hypothesis family 根本漏掉真實 failure mode：

```text
high predicted EIG
≠
actually informative intervention
```

需要 robust / adversarial acquisition。

## 3. 如何把 risk budget 與 information budget 放進同一 optimizer？

理想：

```text
maximize certificate discrimination
subject to
risk
latency
privacy
API/tool quota
human interruption
```

但不同 constraint 的 units 與 tail risk 尚未統一。

---

# 下一輪研究

下一輪應進入：

# Robust Causal Experiment Design × Model Misspecification × Safe Exploration × Adversarial Revalidation

重點：

```text
Candidate causal hypotheses
↓
planner believes H

but true mechanism ∉ H
↓
EIG may be misleading
↓
Robust acquisition
├ worst-case information gain
├ distributionally robust design
├ minimax intervention
├ surprise / residual trigger
├ hypothesis-set expansion
└ safe exploration constraint
↓
Certificate Revalidation
```

核心問題：

> 如果 Hermes 用錯 world model 來決定「最值得測哪個 intervention」，它會不會一直挑到對自己既有假設有利、但永遠看不到真正 failure mode 的實驗？

---

# Knowledge Graph 新增 Node / Edge

## New Nodes

```text
Minimal Distinguishing Intervention
Minimal Distinguishing Intervention Set
Certificate-Relevant Ambiguity
Certificate Hypothesis Set
Certificate Expected Information Gain
Certificate Entropy
Distinguishing Power
Distinguishing Matrix
Probabilistic Distinguishing Matrix
Intervention Coverage
Intervention Cost Model
Intervention Risk Model
Intervention Safety Class
Active Certificate Revalidation
Revalidation Session
Revalidation Stop Rule
Goal-Oriented Causal Experiment Design
Sequential Revalidation Policy
Intervention Oracle
Intervention Efficiency
Experiment Budget
Risk Budget
Claim-Scoped Experiment Design
Hypothesis Elimination Gain
Causal Experiment Planner
```

## New Edges

```text
Full Causal Discovery
≠ Certificate Revalidation

Full-Model Information Gain
≠ Certificate-Relevant Information Gain

Most Informative Intervention
≠ Best Production Intervention

Intervention Budget Used
≠ Intervention Efficiency

Static Minimal Test Set
≠ Sequentially Optimal Test Policy

Minimum Intervention Set
→ Can Be Formulated As Combinatorial Optimization

Certificate Dependency Graph
→ Restricts Relevant Hypothesis Pairs

Relevant Hypothesis Pairs
→ Define Distinguishing Requirements

Distinguishing Requirements
→ Generate Minimal Experiment Set

Experiment Observation
→ Updates Certificate Hypothesis Posterior

Posterior Update
→ Changes Next Best Intervention

Risk Constraint
→ Can Remove Highest-EIG Intervention
```

---

# 本輪結束判定

**缺哪一層：** Robust / misspecification-aware Causal Experiment Design Layer。  
**哪個節點最淺：** `CertificateEIG`、`ProbabilisticDistinguishingMatrix`、`RobustMinimalDistinguishingInterventionSet`。  
**哪個概念仍只是名詞：** production 級 `MinimalDistinguishingInterventionSet` 對 arbitrary neural multimodal representation 仍主要是 architecture concept。  
**哪個系統最值得讀原始碼：** `qpiai/Active-Causal-Discovery-Bench` 的 `equivalence/theory.py`、`runtime/session.py`，接著追 `scoring/` 與 agent intervention policy。  
**哪篇論文需追引用：** JMLR 2025《Optimal Experiment Design for Causal Effect Identification》；它最直接連接「target claim → minimum intervention cost」。  
**哪個概念最適合視覺模擬：** Minimal Distinguishing Intervention Lab。  
**哪個 Agent 架構最值得實作：**

```text
Certificate Dependency Graph
↓
Affected Claim Extractor
↓
Hypothesis Builder
↓
Candidate Intervention Generator
↓
Safety Classifier
↓
Goal-Oriented EIG / Hitting-Set Planner
↓
Shadow-Sandbox-Canary Executor
↓
Posterior Update
↓
Adaptive Replan
↓
Migrate / Scope / Expire / Block
```

---

# 對「AI 到底怎麼運作」新增的一層

當 AI 的 Camera/Image/Voice/Text/Tool/MCP 經 Encoder / Fusion 形成 latent state，這些 representation 未來一定會因模型升級而改變。真正可驗證的 Agent 不能每次升級就重新測試整個世界，也不能只跑固定 regression suite。它需要先知道「目前哪張 causal certificate 受影響」，再把可能失效的 causal mechanisms 變成 competing hypotheses，主動選出少數最有區辨力、成本最低、風險可接受的 interventions，執行後更新 belief，再決定下一個 experiment。換句話說，成熟 AI runtime 不只是會推理、會行動，還必須會**設計實驗來驗證自己是否仍理解同一個世界**。
