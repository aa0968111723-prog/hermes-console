# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-14 04:54（Asia/Taipei）  
**本輪主題**：Causal Representation Equivalence × Certificate Migration × Intervention Invariance Testing × Drift Calibration  
**與上一輪差異**：上一輪建立「Structural Drift → Certificate Expiry / Revalidation」；本輪不再重複 drift detection，而是研究 **舊 representation 與新 representation 在什麼條件下可視為因果等價，以及舊 causal certificate 能否安全遷移**。

---

## 本小時新發現

### 新論文 / 理論

1. **Unifying Causal Representation Learning with the Invariance Principle** — Dingling Yao, Dario Rancati, Riccardo Cadei, Marco Fumero, Francesco Locatello；ISTA；ICLR 2025。  
   URL: https://arxiv.org/abs/2409.02772  
   官方研究頁: https://research-explorer.ista.ac.at/record/19010  
   核心改變：指出許多 CRL 方法的 identification，本質上是把 representation 對齊不同 data pockets 的 symmetry / invariance；被識別的通常是 **equivalence class**，不一定是一組唯一座標，也不一定每個 invariance 都是 causal。這直接改變 certificate migration 的設計：migration 不應要求 embedding coordinates byte-level / dimension-level identity，而應檢查「允許的 symmetry class 下，與下游 causal claim 相關的結構是否保存」。

2. **Beyond identifiability: Learning causal representations with few environments and finite samples** — Inbeom Lee, Tongtong Jin, Bryon Aragam；2026。  
   URL: https://arxiv.org/abs/2603.25796  
   Code：本輪未找到作者公開 code。  
   Architecture：linear latent causal factor model + multi-environment unknown multi-node interventions + covariance-subspace recovery。  
   Contribution：在有限樣本下，以僅約 logarithmic number of intervention environments，恢復 latent causal graph、mixing matrix / representation 與未知 intervention targets。  
   Limitation：理論聚焦線性 causal factor model，不能直接視為一般 nonlinear VLM/LLM embedding migration theorem。

3. **Learning Robust Intervention Representations with Delta Embeddings** — Panagiotis Alimisis, Christos Diou；ICLR 2026。  
   URL: https://arxiv.org/abs/2508.04492  
   Dataset / benchmark：Causal Triplet；實驗亦包含 EPIC-Kitchens。  
   Architecture：從 pre/post intervention image pair 學習 sparse、scene/object-invariant 的 intervention representation。  
   Contribution：把 intervention 本身表示成 latent delta，而不是只表示 world state；OOD intervention classification 顯著優於 baselines。  
   Limitation：intervention-delta robustness 不等於完整 causal-state equivalence，也不能單獨證明 old certificate 可遷移。

4. **Learning Causal Markov Boundaries with Mixed Observational and Experimental Data** — Konstantina Lelova, Gregory F. Cooper, Sofia Triantafillou；PGM 2024。  
   URL: https://proceedings.mlr.press/v246/lelova24a.html  
   Contribution：以 observational + limited experimental data 學 experimental-distribution 下的 Interventional Markov Boundary。  
   對 Hermes 的意義：certificate migration 應比較 **interventional relevance set**，而不只是 observational feature importance。

### 新 GitHub / 原始碼

本輪深入 `palimisis/causaltriplet`（Causal Triplet benchmark fork / experiment code）：  
https://github.com/palimisis/causaltriplet

值得讀的目錄 / 檔案：

```text
main.py
├ dataset loading / IID-OOD split
├ paired-image training loop
├ action critic
├ state critic
├ block-sparsity loss
└ embedding / t-SNE evaluation

model/
├ respair.py
├ clippair.py
├ grouppair.py
├ slotpair.py
└ adversary.py

sparsity/
└ block.py
```

已確認 `main.py` 的 training loop 不是單純 image classifier：它將 `(first_img, second_img)` 送入 pair model，輸出 action prediction、pair feature、`p1/p2` state embeddings；同時可訓練 object critics，並以 adversarial objective 降低 action feature / state embedding 中的 object information，再以 `sparse_criterion_with_label(p1, p2, block)` 約束 intervention-related latent block sparsity。

**重要界線**：此 repository 可作為 Causal Triplet 的 benchmark / paired-intervention representation 工程參考；本輪沒有驗證它就是 2026 Causal Delta Embeddings 論文的正式完整 implementation，因此不能把兩者宣稱成同一 codebase。

---

# 本小時最重要 5 個發現

## 1. Causal Representation Equivalence ≠ Coordinate Equality

### 概念

舊 encoder：

```text
X
↓ f_old
Z_old
```

新 encoder：

```text
X
↓ f_new
Z_new
```

最天真的 migration check 是：

```text
cosine(Z_old, Z_new) > 0.95
→ migrate certificate
```

這是不夠的。

ICLR 2025 invariance-principle 工作指出，很多 CRL identification 只把 latent representation 識別到某個 **equivalence class / symmetry class**。因此可能存在：

```text
Z_new = P D Z_old
```

其中 `P` 是 permutation、`D` 是 allowed scaling；座標完全不同，但在該 theorem / application contract 下仍代表同一 latent causal variables。

反過來也可能：

```text
cosine(Z_old, Z_new) ≈ 0.99
```

但某個關鍵 mediator、negative control role 或 intervention response 已被壓掉。

### 底層如何運作

Hermes 應把 equivalence 定義成「相對於一個 causal contract 的等價」：

```text
CausalRepresentationEquivalence(
  Z_old,
  Z_new,
  allowed_symmetry_group,
  intervention_set,
  downstream_estimand_set,
  environment_scope
)
```

而不是全域 `equal / not equal`。

### 為什麼重要

否則每次 encoder/VLM 升級都會出現兩種錯誤：

```text
False Expiry:
座標改了 → 全部證書失效
但其實只是 permutation/scaling

False Migration:
向量很像 → 全部證書沿用
但 causal role 已改變
```

### 限制

「允許的 symmetry group」依理論設定而異。線性模型可有 permutation / scaling 類的可識別性；nonlinear foundation-model latent 不可直接套用。

### 來源

- Yao et al., ICLR 2025: https://arxiv.org/abs/2409.02772
- Lee et al., 2026: https://arxiv.org/abs/2603.25796

**狀態**：前者為論文結果；把 equivalence contract 轉成 Hermes certificate migration 是工程推論。

---

## 2. Certificate Migration 應比較 Intervention Signature，而不只 observational similarity

### 概念

如果 representation 真正要支援 causal action，migration 最重要的問題不是：

```text
「看同一張圖時，兩個 encoder embedding 像不像？」
```

而是：

```text
「做同一個 intervention 時，兩個 representation 是否以同樣的 causal variables / structure 回應？」
```

### Bottom-level mechanism：Intervention Signature Matrix

對 intervention `I_k` 定義：

```text
Δ_old(k)
=
E[Z_old | do(I_k)]
-
E[Z_old | baseline]

Δ_new(k)
=
E[Z_new | do(I_k)]
-
E[Z_new | baseline]
```

把多個 intervention 疊成：

```text
D_old = [Δ_old(1), ..., Δ_old(K)]
D_new = [Δ_new(1), ..., Δ_new(K)]
```

接著在 **allowed transformation family** 中尋找 alignment `A*`：

```text
A*
=
argmin_A || D_new - A D_old ||
```

但這裡的 `A` 不能任意是 unrestricted neural mapper，否則任何 representation 幾乎都能被 post-hoc 對齊，失去 causal meaning。

因此 contract 必須寫明：

```text
allowed A
├ permutation only
├ permutation + scaling
├ orthogonal
├ block-wise permutation
└ theorem-specific group
```

再比較：

```text
intervention support pattern
sign / direction
relative effect magnitude
sparsity pattern
cross-environment stability
```

2026 Causal Delta Embeddings 的核心觀念提供工程支持：intervention representation 應該盡量對 scene/object 不敏感、並稀疏對應受 intervention 影響的 causal variables。

### 為什麼重要

Hermes 之後可得到：

```text
Encoder v17 → v18

observational similarity: HIGH
intervention equivalence: FAIL

→ certificate migration BLOCK
```

或反過來：

```text
coordinate similarity: LOW
intervention equivalence: PASS under permutation

→ scoped migration possible
```

### 限制

如果 intervention set 太少，就只是在有限 probes 上「看起來等價」。不能宣稱 global causal equivalence。

### 來源

- Alimisis & Diou, ICLR 2026: https://arxiv.org/abs/2508.04492
- Lee et al., 2026 finite-environment recovery: https://arxiv.org/abs/2603.25796

**狀態**：intervention invariance / finite-environment recovery 是論文結果；`InterventionSignatureMatrix` 為本輪提出的 Hermes runtime abstraction。

---

## 3. Equivalence 一定要是 Task-Scoped / Certificate-Scoped

### 概念

兩個 representations 可能對「風險分類」等價，但對「backdoor adjustment」不等價。

例如：

```text
Z_old
contains {C, M, Y-predictive shortcut}

Z_new
contains {C, Y-predictive shortcut}
```

若下游只是：

```text
RiskRanking
```

可能表現幾乎沒變。

但若某 certificate 依賴 mediator `M`：

```text
MediationAnalysis
```

它已不能遷移。

### 新 primitive

```text
CertificateMigrationContract
├ source_certificate_id
├ source_representation_version
├ target_representation_version
├ causal_claim_type
├ required_causal_roles[]
├ allowed_symmetry_group
├ required_interventions[]
├ required_environments[]
├ downstream_estimands[]
├ tolerances
└ migration_scope
```

遷移輸出：

```text
FULLY_EQUIVALENT
TASK_EQUIVALENT
ESTIMAND_EQUIVALENT
PARTIALLY_EQUIVALENT
INSUFFICIENT_INTERVENTION_COVERAGE
STRUCTURALLY_NON_EQUIVALENT
NOT_IDENTIFIED
```

### 為什麼重要

這避免：

```text
「一張 Causal State Certificate」
→ 被所有下游用途濫用
```

應改成：

```text
Representation Certificate
×
Causal Claim
×
Environment Scope
×
Intervention Scope
```

### 交叉驗證

ICLR 2025 invariance work 強調不同 assumptions 對應不同 equivalence classes；Interventional Markov Boundary 工作則顯示 experimental distribution 下與 outcome 有關的 causal feature set 可以和純 observational relevance 不同。

來源：
- https://arxiv.org/abs/2409.02772
- https://proceedings.mlr.press/v246/lelova24a.html

---

## 4. Finite-Sample Drift Calibration：PASS / FAIL 必須帶 uncertainty margin

### 概念

上一輪已建立 structural drift fingerprints，但如果測試都用有限樣本：

```text
CI_old ≈ CI_new
Intervention signature old ≈ new
Markov Boundary old ≈ new
```

不能把測到的一點差異直接當成真正 structural change。

2026 `Beyond identifiability` 的價值就在這裡：它把 CRL 從 population-level identifiability 推進到 finite-sample estimation，並用 covariance subspace / projection 的 perturbation analysis 給 recovery guarantees。

### 底層 mechanism（論文中的重要例子）

population 下，共同 subspace 可由 covariance column-space intersection 表示；有限樣本時，sample covariances 幾乎不會精確相交，因此改用 projection matrices 與 near-1 eigenvalue counting 估 shared subspace dimension。

這給 Hermes 一個重要設計原則：

```text
exact structural equality test
→ brittle
```

應改成：

```text
structural statistic
+
finite-sample uncertainty
+
predeclared tolerance
→ migration decision
```

新增：

```text
StructuralDriftCalibration
├ statistic_name
├ source_value
├ target_value
├ uncertainty_interval
├ tolerance
├ sample_size
├ environment_coverage
├ intervention_coverage
├ power_estimate
└ decision
```

### 為什麼重要

避免：

```text
small sample
→ noisy CI / covariance estimate
→ false certificate expiry
```

也避免：

```text
wide uncertainty
→ pretend PASS
```

正確狀態可以是：

```text
INCONCLUSIVE
→ COLLECT_MORE_INTERVENTIONAL_DATA
```

### 限制

Lee et al. 的 guarantees 是線性模型 setting；Hermes 對 nonlinear multimodal embedding 只能借用「finite-sample calibration」原則，不能直接借 theorem。

來源：
- https://arxiv.org/abs/2603.25796

---

## 5. Model Upgrade 應成為 Causal Migration Transaction，而不是單一版本切換

### 概念

現在一般 ML deployment：

```text
encoder_v17
↓ deploy
encoder_v18
```

Hermes 應改成：

```text
PROPOSE v18
↓
Shadow Representation
↓
Alignment Discovery
↓
Intervention Replay
↓
Structural Fingerprint Compare
↓
Finite-Sample Calibration
↓
Certificate Migration Plan
↓
Scoped Permission Migration
↓
CANARY
↓
COMMIT / ROLLBACK
```

### 新 runtime object

```text
CausalMigrationTransaction
├ source_model_epoch
├ target_model_epoch
├ source_representation_version
├ target_representation_version
├ alignment_map
├ allowed_symmetry_group
├ intervention_replay_set
├ structural_test_results
├ migrated_certificates[]
├ expired_certificates[]
├ scoped_certificates[]
├ unresolved_certificates[]
├ permission_diff
├ canary_result
└ rollback_pointer
```

### 為什麼重要

Model update 不只改：

```text
accuracy
latency
VRAM
```

還可能改：

```text
causal adjustment state
negative controls
proximal proxy role
intervention representation
OPE support
permission decision
```

所以：

```text
Model Version Migration
≠
Causal Certificate Migration
```

---

# Architecture Breakdown

## Causal Representation Migration Runtime

```text
Current Runtime
├ Encoder v17
├ Fusion v9
├ Representation Z_old
└ Certificates C1...Cn

Target Runtime
├ Encoder v18
├ Fusion v10
└ Representation Z_new

            ↓

Shadow Dual-Encoding Layer
├ same raw events → Z_old
└ same raw events → Z_new

            ↓

Equivalence Contract Builder
├ claim scope
├ environment scope
├ intervention scope
├ allowed symmetry
└ tolerances

            ↓

Alignment Layer
├ permutation matching
├ scaling matching
├ block matching
└ theorem-scoped transform

            ↓

Intervention Replay Engine
├ baseline
├ known interventions
├ synthetic interventions
└ archived real intervention episodes

            ↓

Causal Fingerprint Comparator
├ InterventionSignatureMatrix
├ CI fingerprint
├ Interventional Markov Boundary
├ negative-control roles
├ proxy roles
├ bridge residuals
└ downstream causal estimands

            ↓

Finite-Sample Drift Calibrator
├ uncertainty
├ power
├ coverage
└ INCONCLUSIVE state

            ↓

Certificate Migration Planner
├ FULL MIGRATION
├ SCOPED MIGRATION
├ REVALIDATE
├ COLLECT MORE DATA
├ EXPIRE
└ BLOCK

            ↓

Permission Diff
↓
Canary Runtime
↓
Commit / Rollback
```

### 系統層級重點

Hermes 不應建立：

```text
model_version → certificate_valid: bool
```

而應建立 dependency graph：

```text
Model Epoch
↓
Representation Version
↓
Causal Role / Fingerprint
↓
Identification Claim
↓
Certificate
↓
Permission
```

migration 是沿 dependency graph 做 selective transport，而不是 global copy。

---

# Bottom-Level Logic

## 1. Representation alignment

給定 paired samples：

```text
{z_old_i, z_new_i}
```

先只在 contract 允許的 transformation family `G` 中尋找：

```text
A* = argmin_{A∈G} Σ_i d(z_new_i, A z_old_i)
```

**禁止**用 unrestricted deep network 當 `A` 後宣稱 equivalence；那只能證明「可預測轉換」，不是「因果表示等價」。

## 2. Intervention-response matching

```text
for intervention I_k:
    delta_old[k] = E[z_old | do(I_k)] - E[z_old | base]
    delta_new[k] = E[z_new | do(I_k)] - E[z_new | base]
```

比較：

```text
support(delta)
direction(delta)
magnitude ratios
block sparsity
cross-environment variance
```

## 3. Structural fingerprint matching

```text
Fingerprint(Z)
=
{
  CI relations,
  Markov-boundary membership,
  NCE/NCO roles,
  proxy roles,
  intervention signatures,
  downstream estimands
}
```

migration test：

```text
Fingerprint(Z_old)
≈_{contract,tolerance}
Fingerprint(Z_new)
```

## 4. Estimand-level equivalence

若 certificate 真正支援的是某 causal estimand：

```text
τ = E[Y | do(A=1)] - E[Y | do(A=0)]
```

則最終至少要比較：

```text
τ_old ± uncertainty
vs
τ_new ± uncertainty
```

也就是：

```text
Representation Equivalence
≠
Required

Estimand Equivalence
may be sufficient
```

這是一個很重要的 scope reduction：Hermes 不應為了遷移單一 downstream certificate，強迫證明整個 latent world model 全域等價。

---

# Visual Simulation Idea

## Causal Representation Migration Lab

### 左側：Model Upgrade

```text
Encoder v17              Encoder v18
    │                         │
    ▼                         ▼
  Z_old                     Z_new
```

使用者可切換 alignment：

```text
[ ] coordinate identity
[✓] permutation
[✓] scaling
[ ] unrestricted linear
[ ] neural mapper
```

### 中央：Intervention Signature Viewer

```text
          I_camera  I_voice  I_tool  I_user
Zold_1       █        ·        ·       ·
Zold_2       ·        █        ·       ·
Zold_3       ·        ·       █       █

          ↓ alignment

Znew_7       █        ·        ·       ·
Znew_2       ·        █        ·       ·
Znew_9       ·        ·       █       █
```

如果只是 latent permutation：

```text
Coordinate similarity: LOW
Intervention equivalence: HIGH
```

### 右側：Certificate Migration Graph

```text
CSC-8  Causal Adjustment
PASS → MIGRATE

PVC-42 Proximal Proxy
NCO changed
→ REVALIDATE

OPE-31 Policy Value
Estimand shift within bound
→ SCOPED MIGRATION

WRITE_EXTERNAL
old: ALLOW
new: VERIFY
```

### Drift Calibration slider

使用者可調：

```text
sample size
number of intervention environments
noise level
alignment family
migration tolerance
```

畫面顯示：

```text
Observed structural distance   .07
95% uncertainty               [.03,.15]
Migration tolerance            .10

Result:
INCONCLUSIVE

Next best action:
COLLECT 3 MORE INTERVENTION ENVIRONMENTS
```

這個 simulator 能非常直覺地解釋：

> 「模型更新後，不能只問 embedding 像不像，而要問：對這張 certificate 所依賴的 causal claim，它們是否仍在同一個可接受 equivalence class。」

---

# Code / GitHub

## palimisis/causaltriplet

URL: https://github.com/palimisis/causaltriplet

### 已讀核心路徑

```text
main.py
model/
sparsity/
dataset.py
```

### `main.py` 值得 Hermes 參考的部分

1. **Pair input**

```text
first_img, second_img
↓
pair model
↓
action prediction + feat + p1 + p2
```

2. **Object-information critic**

action feature `feat` 可被 object classifier 測試；當 `critic_action > 0` 時，主模型 loss 會反向抑制 object-identifying signal。

3. **State critic**

`p1/p2` state embeddings 也可被 object classifier 測試 / adversarially suppress。

4. **Block sparsity**

```text
verb label
↓
verb_block
↓
one-hot block
↓
sparse_criterion_with_label(p1,p2,block)
```

這種「介入只應改變少數 latent blocks」的工程形式，和 Causal Delta Embedding 的 sparse intervention representation 思路方向一致，但本輪不把兩個 codebase 宣稱為同一正式實作。

### Hermes 值得借用的不是整個模型，而是測試 scaffold

```text
paired pre/post observation
↓
representation delta
↓
nuisance/object leakage critic
↓
sparsity
↓
IID vs OOD intervention evaluation
```

可直接演化成：

```text
old/new encoder
×
pre/post intervention pairs
→ Causal Migration Test Harness
```

---

# Papers

## Paper A

**Title**: Unifying Causal Representation Learning with the Invariance Principle  
**Authors**: Dingling Yao, Dario Rancati, Riccardo Cadei, Marco Fumero, Francesco Locatello  
**Institution**: Institute of Science and Technology Austria (ISTA)  
**Year**: ICLR 2025  
**URL**: https://arxiv.org/abs/2409.02772  
**Code**: 本輪未驗證官方 code 連結  
**Dataset**: real high-dimensional ecological treatment-effect application + paper experimental settings  
**Architecture**: invariance / data-pocket symmetry unification framework  
**Contribution**: 將許多 CRL identification settings 統一成 representation 對 known invariances / symmetry classes 的 alignment。  
**Limitations**: invariance 不必然等於 causality；equivalence class 與可識別範圍依 assumptions 而變。  
**改變了什麼**：讓 Hermes certificate migration 從「coordinate equality」轉為「contract-scoped equivalence class preservation」。

## Paper B

**Title**: Beyond identifiability: Learning causal representations with few environments and finite samples  
**Authors**: Inbeom Lee, Tongtong Jin, Bryon Aragam  
**Institution**: 本輪 retrieved abstract 未可靠確認完整 affiliation，因此不臆測  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2603.25796  
**Code**: 未找到 verified public implementation  
**Dataset**: theoretical / simulated multi-environment latent causal factor setting  
**Architecture**: linear latent DAG + mixing model + unknown multi-node interventions + covariance subspace methods  
**Contribution**: finite-sample guarantees；約 logarithmic intervention environments 可恢復 graph、mixing representation 與未知 intervention targets。  
**Limitations**: linear setting；不能直接當 nonlinear foundation representation migration theorem。  
**改變了什麼**：把 equivalence / drift checking 從 population theorem 拉到 finite-sample uncertainty 與 intervention coverage 問題。

## Paper C

**Title**: Learning Robust Intervention Representations with Delta Embeddings  
**Authors**: Panagiotis Alimisis, Christos Diou  
**Institution**: 本輪不從非正式頁面推定完整 affiliation  
**Year**: ICLR 2026  
**URL**: https://arxiv.org/abs/2508.04492  
**Code**: 未驗證正式 CDE code repository  
**Dataset**: Causal Triplet; EPIC-Kitchens  
**Architecture**: image-pair → latent states → sparse scene-invariant intervention delta  
**Contribution**: 把 intervention representation 本身設為 object/scene invariant 且 sparse，提升 OOD intervention recognition。  
**Limitations**: OOD intervention classification performance 不足以證明完整 causal equivalence。  
**改變了什麼**：提供「intervention signature」比 raw embedding similarity 更適合作為 migration primitive 的直接實驗動機。

## Paper D

**Title**: Learning Causal Markov Boundaries with Mixed Observational and Experimental Data  
**Authors**: Konstantina Lelova, Gregory F. Cooper, Sofia Triantafillou  
**Year**: 2024  
**URL**: https://proceedings.mlr.press/v246/lelova24a.html  
**Architecture**: observational + limited experimental data → Interventional Markov Boundary discovery  
**Contribution**: 用 mixed data 改善 experimental-distribution 下 causal feature selection 與 personalized effect estimation。  
**Limitations**: specific statistical setting；不是 neural representation migration framework。  
**改變了什麼**：支持 Hermes 在 migration 中比較 interventional relevance / Markov boundary，而非純 predictive importance。

---

# 已確認事實 / 工程實作 / 推論 / 假說分層

## 已確認論文結果

- CRL 常只能識別到和 invariance / symmetry 相關的 equivalence class，而非唯一 latent coordinates。
- 線性 latent causal factor setting 中，2026 工作提供有限樣本 recovery guarantees，且可用 sublinear / logarithmic number of unknown multi-node intervention environments。
- Causal Delta Embeddings 將 intervention latent 表示設計成 sparse、scene/object-invariant，並在 Causal Triplet / EPIC-Kitchens 報告 OOD 改善。
- Interventional Markov Boundary 與 observational feature relevance 是不同的 causal target。

## 已確認工程實作

- `palimisis/causaltriplet/main.py` 具有 paired-image model、action/state critics、block sparsity、IID/OOD evaluation 與 embedding export。

## 合理工程推論

- Hermes 可將 intervention signatures、CI fingerprints、Interventional Markov Boundary、negative-control/proxy roles 與 downstream estimands 組成 `CausalRepresentationEquivalenceCertificate`。
- certificate migration 應是 selective / scoped transport，而非 model-version level 全域 copy。

## 尚未驗證假說

- 對一般 LLM/VLM hidden-state embedding，可以建立一個通用且高 power 的 neural causal equivalence test。
- 有限組 intervention replay 足以在 production environment 證明 broad causal equivalence。
- foundation-model latent 的 allowed symmetry group 能可靠自動推定。

---

# Unknown / Open Questions 1–3

## 1. Nonlinear Representation Equivalence

線性 latent model 中 permutation / scaling 類 equivalence 比較清楚；但對 nonlinear VLM/LLM latent：

```text
Z_new = g(Z_old)
```

`g` 到底允許多複雜，才仍保留 causal semantics？

如果允許任意 invertible neural transform，測試會太寬；如果只允許 permutation/scaling，又可能太窄。

**仍未解。**

## 2. Minimal Intervention Set for Migration

Production 不可能重跑所有可能 intervention。

需要研究：

```text
Certificate C
↓
依賴哪些 causal mechanisms？
↓
最小 distinguishing intervention set
↓
足以判別 migrate / expire
```

也就是 certificate-specific experiment design。

## 3. Equivalence Under Model + Policy Co-Adaptation

如果 encoder 更新同時 policy 也更新：

```text
Encoder v18
↓
Agent sees different representation
↓
policy distribution changes
↓
future data distribution changes
```

此時 representation equivalence 不能只在 static replay buffer 中判定；需要 closed-loop canary / intervention testing。

---

# 下一輪研究

## 主題

**Minimal Distinguishing Interventions × Causal Experiment Design × Active Certificate Revalidation × Closed-Loop Representation Migration**

### 下一輪研究鏈

```text
Certificate dependency graph
↓
Which mechanisms matter to this certificate?
↓
Candidate interventions
↓
Expected discrimination power
↓
Cost / risk / latency
↓
Minimal intervention set
↓
Active revalidation
↓
Closed-loop canary
↓
Migrate / expire / scope-reduce
```

下一輪要回答的真正問題：

> 「如果不能把所有 causal mechanisms 全部重測，Agent 應主動挑哪幾個 intervention，才能用最低成本判斷舊 certificate 能不能搬到新模型？」

---

# Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Causal Representation Equivalence
Causal Equivalence Class
Allowed Symmetry Group
Representation Alignment Map
Task-Scoped Equivalence
Estimand-Scoped Equivalence
Intervention Signature
Intervention Signature Matrix
Intervention Support Pattern
Intervention Direction Consistency
Intervention Magnitude Ratio
Cross-Environment Intervention Stability
CausalRepresentationEquivalenceCertificate
CertificateMigrationContract
CausalMigrationTransaction
StructuralDriftCalibration
Finite-Sample Equivalence Test
Migration Uncertainty
Migration Power
Intervention Coverage
Environment Coverage
Interventional Markov Boundary Fingerprint
Scoped Certificate Migration
Certificate Transportability
Migration Canary
Migration Rollback Pointer
```

## 新 Edges

```text
Coordinate Equality
≠ Causal Representation Equivalence

High Cosine Similarity
≠ Causal Equivalence

Low Coordinate Similarity
≠ Causal Non-Equivalence

Causal Representation Equivalence
→ Defined Relative To Allowed Symmetry Group

Causal Representation Equivalence
→ Defined Relative To Certificate Scope

Intervention Signature Preservation
→ Supports Scoped Migration

Observational Similarity
≠ Intervention-Response Similarity

Predictive Equivalence
≠ Adjustment Equivalence

Adjustment Equivalence
≠ Mediation Equivalence

Representation Equivalence
≠ Global World-Model Equivalence

Estimand Equivalence
→ May Be Sufficient For Estimand-Scoped Certificate

Finite-Sample Noise
→ Can Cause False Structural Drift

Insufficient Intervention Coverage
→ INCONCLUSIVE

Model Version Migration
≠ Causal Certificate Migration

Encoder Upgrade
→ Causal Migration Transaction
```

---

# 本輪結束判定

**缺哪一層？**  
`Causal Experiment Design / Minimal Distinguishing Intervention Layer`。現在已有 equivalence contract，但還不知道 production 中應用最少哪些 interventions 來驗證它。

**哪個節點最淺？**  
`NonlinearCausalRepresentationEquivalence`、`AllowedSymmetryGroupDiscovery`、`MinimalDistinguishingInterventionSet`。

**哪個概念仍只是名詞？**  
Production 級通用 `CausalRepresentationEquivalenceCertificate` 仍是架構概念；沒有通用 theorem 可涵蓋任意 VLM/LLM embedding。

**哪個系統值得讀原始碼？**  
`palimisis/causaltriplet`，優先順序：

```text
main.py
→ sparsity/block.py
→ model/respair.py / clippair.py
→ dataset.py
```

目的是把 paired-intervention / sparsity / nuisance critic scaffold 改造成 Hermes 的 migration test harness。

**哪篇論文需追引用？**  
首要：**Unifying Causal Representation Learning with the Invariance Principle**，因為 certificate migration 最核心的「等價」到底允許什麼 transformations，直接取決於 identifiability / symmetry literature。  
第二：**Beyond identifiability**，因為 production migration 最終一定是有限樣本問題。

**哪個概念最適合視覺模擬？**  
`Causal Representation Migration Lab`：同時顯示 coordinate alignment、intervention heatmap、structural fingerprint、certificate dependency graph 與 permission diff。

**哪個 Agent 架構最值得實作？**

```text
Shadow Dual Encoder
↓
Equivalence Contract Builder
↓
Intervention Replay Engine
↓
Causal Fingerprint Comparator
↓
Finite-Sample Drift Calibrator
↓
Certificate Migration Planner
↓
Permission Diff
↓
Canary / Rollback
```

---

# 對「AI 到底怎麼運作」新增的一層

當使用者的一句話、Camera、Voice、Video、Tool telemetry 進入 AI 後，真正 runtime 不只是：

```text
Input
→ Encoder
→ Embedding
→ Reasoning
```

還有一個長期系統常被忽略的問題：

```text
今天的 Encoder
與
明天升級後的 Encoder

是否仍在表示「同一個可用於因果決策的世界狀態」？
```

答案不能靠 embedding cosine similarity 決定。

真正成熟的 Agent 需要追：

```text
Raw Multimodal World
↓
Encoder / Fusion
↓
Latent Representation
↓
Intervention Response
↓
Causal Role / Identification
↓
Certificate
↓
Permission
```

當 Encoder 更新時，必須反向驗證：

```text
同一組 intervention
是否仍改變同一組 causal mechanisms？

同一個 causal estimand
是否仍可被識別？

舊 certificate
到底是可遷移、只可部分遷移，還是必須失效？
```

因此這輪把 AI 系統從「Model Versioning」再往下推進成：

> **Causal Representation Migration：模型可以升級，但因果能力不能靠版本號繼承。**
