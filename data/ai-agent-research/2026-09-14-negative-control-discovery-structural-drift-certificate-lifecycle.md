# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 03:52（Asia/Taipei）**  
**主題：Automated Negative-Control Discovery × Representation-Induced Structural Drift × Causal Invariance × Certificate Expiry / Revalidation**

---

## 與歷史研究比較：本輪刻意避免重複

前兩輪已經建立：
- `Predictive State ≠ Causal Adjustment State`
- Negative Control 可用於 falsification，但本身需要 exclusion restriction；
- proximal proxy / bridge、hidden-confounder sensitivity、representation drift invalidation graph；
- `ProxyValidationCertificate` 與 `MultimodalCausalStateCertificate`。

因此本輪**不再重複介紹 negative control / proximal inference 是什麼**，而專注四個尚未真正補齊的缺口：

1. **Negative Control 如何自動「發現」，而不只人工指定？**
2. **Multimodal encoder 更新後，究竟是一般 distribution drift，還是 causal structure 被 representation 改寫？**
3. **跨環境 invariance 何時有用、何時會是假 invariance？**
4. **Causal certificate 要怎麼失效、隔離、重驗證，而不是永久有效？**

---

# 本小時新發現

## 新論文 / 架構

1. **DANCE — Data-driven Automated Negative Control Estimation**（JMLR 2024）提供真正 data-driven 的 disconnected negative-control 搜尋與驗證流程，不要求所有 NC 都先靠 domain expert 手工指定。
2. **CARL: Preserving Causal Structure in Representation Learning**（ICLR 2026）直接把 cross-modal representation 的風險描述成 **representation-induced structural drift**：非線性 representation mapping 可能建立不存在的依賴，也可能移除 mediator / Markov-boundary 所需變數，使原本可識別的 causal query 在 latent space 失去 identifiability。
3. **CmIR**（ACL 2026）將每個 modality 分成 causal-invariant 與 environment-specific spurious representation，並結合 invariance、mutual-information 與 reconstruction constraints，凸顯「跨環境穩定」需要和 information preservation 一起考慮。
4. **Causal Representation Learning from General Environments under Nonparametric Mixing**（AISTATS 2025）提醒：很多 causal representation identification theorem 依賴 intervention / environment assumptions；不能因為 latent 在兩個資料集上看似 invariant 就宣稱恢復了 causal variables。
5. 2025 的 **Double Negative Control Inference with Some Invalid NCEs** 顯示 automatic candidate mining 後不能假定候選全部合法；在該特定 continuous-outcome framework 中，只要多數 NCE 有效，可利用 robust selection / aggregation 做估計。這支持 Hermes 必須將「candidate discovery」與「validity certification」拆開。

---

# 本小時最重要 5 個發現

## 1. Negative Control 可以部分自動發現，但「搜尋」與「證明有效」是兩回事

### 已確認事實
DANCE 的公開實作 `Find_NegativeControls.R` 並不是先提供一組已知有效 NCE/NCO 後直接估 effect；它先從 treatment/outcome 以外的候選變數集合中找 triplets，再利用 conditional-independence filters 與 vanishing-tetrad tests 找出符合 disconnected-negative-control 結構的 seeds。

程式中的主要 pipeline：

```text
all candidate variables
↓
(optional) connectedness filter
↓
(optional) measured-screen filter
↓
choose candidate triplets
↓
conditional-independence checks
↓
vanishing tetrad checks
↓
validated NC seed triplets
```

DANCE 程式也明確標註：目前 tetrad test 是 Wishart test，**假設 linearity + Gaussianity**。

### Bottom-level mechanism：Vanishing Tetrad

DANCE 對四個變數 `x,y,z,w` 計算 correlation submatrix determinant：

```text
D = det( Corr[{x,y},{z,w}] )
```

接著以 Wishart-based variance 建立：

```text
ratio = D / SD(D)
p = 2 Φ(-|ratio|)
```

若 tetrad 接近 0，就支持某類 latent/common-cause factorization constraint；再結合多組 CI / tetrad pattern 判斷 triplet 是否可能形成 disconnected negative-control structure。

這是本輪最重要的 bottom-level mechanism：

```text
Negative-control discovery
≠ embedding similarity search

而是
observed covariance constraints
+ conditional-independence constraints
+ latent-structure assumptions
```

### 對 Hermes 的映射
Hermes 可以建立：

```text
NegativeControlCandidateMiner
├ schema / causal-role filter
├ temporal legality filter
├ forbidden-descendant filter
├ CI tests
├ tetrad / rank constraints
├ environment replication
└ candidate confidence
```

但候選找到後只能標成：

```text
CANDIDATE_NEGATIVE_CONTROL
```

不能直接變成：

```text
VALID_NEGATIVE_CONTROL
```

### 限制
DANCE 的現有公開 implementation 主要對線性/Gaussian setting 中的 disconnected NC 結構有依據；直接把此 tetrad algorithm 套到 LLM embeddings、非線性 VLM latent 或高維 Agent memory 沒有一般性 validity guarantee。

來源：
- Paper: https://jmlr.org/papers/v25/22-1062.html
- Code: https://github.com/imjaewon07/DANCE

---

## 2. Automatic NC mining 最危險的錯誤，是把「容易通過統計測試」誤認成「有可信 causal role」

### 論文結果
2025 的 double-negative-control work 專門處理部分 Negative Control Exposures 無效的情況，因為實務上 NCE 的 validity 往往比 NCO 更難確認。該論文在特定設定下證明：若候選 NCE 中有超過一半有效，可以利用 robust selection / median 類 aggregation 做一致估計。

### Hermes 新原則
因此自動 discovery runtime 必須是兩階段：

```text
Stage A — Candidate Discovery
statistical constraints / graph patterns / time ordering

Stage B — Causal Validation
exclusion restriction
no forbidden causal path
temporal legality
source lineage
intervention / environment replication
negative-control falsification
```

新增：

```text
NegativeControlCandidateRecord
├ variable_or_representation_id
├ candidate_role: NCE | NCO
├ discovery_algorithm
├ discovery_environment
├ CI_test_summary
├ tetrad_or_rank_summary
├ lineage
├ temporal_position
├ downstream_of_action?
└ status = CANDIDATE
```

以及：

```text
NegativeControlValidityCertificate
├ exclusion_claim
├ graph_role
├ temporal_legality
├ environment_replication
├ sensitivity_to_candidate_set
├ invalid-control-robustness
├ encoder_version
└ validity_status
```

### 新的否定 edge

```text
Statistically Discovered Negative Control
≠ Valid Negative Control
```

這條 edge 比上一輪的「negative control pass ≠ proof」更前一步：**連 candidate role 本身都要版本化與審核。**

---

## 3. Representation Drift 要分成「數值漂移」與「結構漂移」

### CARL 帶來的關鍵觀念
一般 drift monitoring 常看：

```text
mean / variance shift
embedding distance
PSI
MMD
classification performance
```

但 CARL 指出的更底層問題是：cross-modal nonlinear mapping 可能在 latent space 中：

```text
原本 X ⟂ Y | Z
↓ encoder
變成
f(X) NOT⟂ f(Y) | f(Z)
```

或把 causal identification 必須保存的 mediator / Markov-boundary variable 壓掉。

所以：

```text
Small Embedding Drift
≠ Small Causal Structural Drift
```

甚至 encoder 可能數值分布很穩定，但 conditional-independence / Markov-boundary relationship 已改變。

### Hermes 應新增三層 drift

```text
RepresentationDriftClass
├ DISTRIBUTIONAL
│  ├ mean/covariance
│  ├ density
│  └ modality missingness
├ SEMANTIC
│  ├ class / retrieval neighborhood
│  └ grounding behavior
└ CAUSAL_STRUCTURAL
   ├ conditional-independence change
   ├ Markov-boundary change
   ├ mediator loss
   ├ collider introduction
   ├ IV validity loss
   └ backdoor-set validity loss
```

### 為什麼重要
如果 Hermes 只做 embedding cosine drift：

```text
encoder_v17 → encoder_v18
cosine similarity = .97
```

不能推出：

```text
old proximal proxy certificate still valid
old OPE adjustment set still valid
old IV still valid
```

因為 causal certificate 依賴的是 structural relations，而不是單純 vector closeness。

來源：CARL, ICLR 2026
https://proceedings.iclr.cc/paper_files/paper/2026/hash/d63cf0622eed012a17fe88fced64dcb8-Abstract-Conference.html

---

## 4. 「跨環境不變」不是一個單一測試；invariance 必須帶 environment contract

### CmIR
CmIR 將 modality representation 分成：

```text
raw modality
↓
causal-invariant representation
+
environment-specific spurious representation
```

並同時加入：
- invariance constraint
- mutual-information constraint
- reconstruction constraint

原因很直接：如果只最大化 invariance，模型可以學到一個幾乎沒有資訊的 constant representation；如果只保留 information，又可能把 environment shortcut 一起保留。

### General-environments causal representation result
AISTATS 2025 的工作則強調，causal representation identifiability 依賴 environments 如何改變資料生成機制。換句話說：

```text
invariant across observed environments
≠ invariant under all relevant interventions
```

### Hermes 新增 Environment Contract

```text
CausalInvarianceContract
├ environments_seen[]
├ intervention_types[]
├ modalities_present[]
├ policy_epochs[]
├ tool_schema_versions[]
├ user_population_scope
├ invariance_tests[]
├ violations[]
└ extrapolation_scope
```

Causal certificate 必須明確寫：

```text
VALID UNDER:
  camera=v5
  voice_encoder=v2
  tool_schema=2026-09-14
  environments={lab_A, mobile_A, web_prod_A}

UNKNOWN UNDER:
  camera=v6
  new locale
  unseen MCP server
```

因此：

```text
Invariant Representation
≠ Globally Causal Representation
```

來源：
- CmIR / ACL 2026: https://aclanthology.org/2026.acl-long.2119/
- General environments / AISTATS 2025: https://proceedings.mlr.press/v258/ng25a.html

---

## 5. Causal Certificate 必須有「依賴圖＋失效條件」，不能只有 valid=true

本輪把先前的 `Representation Drift Invalidation Graph` 具體化為 production primitive：

```text
CausalCertificateDependencyGraph
```

例如：

```text
CameraEncoder v17
↓
VisualState Z_v17
↓
Negative Control NCO-12
↓
ProxyValidationCertificate PVC-42
↓
CausalStateCertificate CSC-8
↓
OPE Certificate OPE-31
↓
WRITE_EXTERNAL Permission P-19
```

當：

```text
CameraEncoder v17 → v18
```

不是全部立刻重算，也不是全部繼續相信，而是做 blast-radius traversal：

```text
change event
↓
which representations changed?
↓
which structural tests depended on them?
↓
which NC / proxy roles depended on them?
↓
which identification claims depended on those roles?
↓
which policy / permission certificates depend on claims?
```

### 新的 lifecycle

```text
ISSUED
↓
VALID
↓
STALE_PENDING_REVALIDATION
├→ REVALIDATED
├→ SCOPE_REDUCED
├→ SUPERSEDED
└→ REVOKED
```

### 建議失效 triggers

```text
encoder weights changed
fusion architecture changed
modality added/removed
context compiler changed
memory summarizer changed
tool schema changed
policy changed environment occupancy
data source / sensor firmware changed
negative-control variable lineage changed
conditional-independence test fails
Markov boundary changed
```

### 新的重要 edge

```text
Model Version Compatible
≠ Causal Certificate Compatible
```

`semver` 沒有辦法描述 causal validity。

---

# Architecture Breakdown

## Causal Representation Validation & Lifecycle Runtime

```text
Camera / Voice / Text / Video / DOM / Tool / MCP / Memory
↓
Raw Event + Source Lineage Ledger
↓
Encoder / Fusion Version Registry
↓
Candidate Representation Builder
↓
Causal Role Miner
├ adjustment-state candidate
├ mediator candidate
├ IV candidate
├ NCE candidate
├ NCO candidate
└ proximal-proxy candidate
↓
Automatic Negative-Control Discovery
├ connectedness / graph filter
├ temporal filter
├ conditional independence
├ tetrad / rank constraint
└ cross-environment replication
↓
Causal Validation Suite
├ exclusion tests
├ negative-control tests
├ bridge residual
├ CI preservation
├ Markov-boundary preservation
├ intervention invariance
└ support / positivity
↓
Causal Representation Certificate
↓
Certificate Dependency Graph
↓
Runtime Drift Monitor
├ distribution drift
├ semantic drift
└ structural drift
↓
Expiry / Revalidation Router
├ KEEP_VALID
├ REVALIDATE_LOCAL
├ REVALIDATE_FULL
├ REDUCE_SCOPE
├ QUARANTINE
└ REVOKE
↓
Identification Router
↓
Permission Gate
```

---

# Bottom-Level Logic

## A. DANCE-style automated NC discovery

```text
Candidates V = observed variables - {A,Y}
↓
choose triplets (v1,v2,v3)
↓
check CI patterns
↓
check tetrad constraints against A and Y
↓
retain seed triplets
↓
pair candidates as Z/W
↓
negative-control effect estimator
↓
aggregate over validated pairs
```

公開 `effect_est.R` 的工程流程是：

```text
FindNegativeControls(df, "A", "Y")
↓
for each ordered candidate pair (W,Z)
↓
solve estimating equations for beta0, beta, ATE
↓
weight pair by frequency it appears in validated NC sets
↓
weighted ATE aggregation
```

這代表 automatic discovery 並不是最後一步，而只是 estimator 前的 structure-selection stage。

## B. Structural drift detection

對 certificate 建立一個 reference causal fingerprint：

```text
CausalFingerprint_v
├ CI matrix / selected CI tests
├ Markov boundary set
├ mediator set
├ IV candidates
├ negative-control relations
├ bridge residual distribution
├ environment invariance score
└ support region
```

新 encoder 產生：

```text
CausalFingerprint_v+1
```

比較不應只有：

```text
||Z_v - Z_v+1||
```

而應：

```text
ΔCI
ΔMarkovBoundary
ΔMediator
ΔIVValidity
ΔNegativeControlValidity
ΔBridgeResidual
ΔSupport
```

概念上的 structural drift score：

```text
D_struct
=
λ1 D_CI
+ λ2 D_MB
+ λ3 D_NC
+ λ4 D_bridge
+ λ5 D_support
```

**注意：這是 Hermes 的工程建模提案，不是目前已有通用 theorem 的標準公式。**

---

# Visual Simulation Idea

## **Causal Representation Drift × Negative-Control Discovery × Certificate Expiry Lab**

畫面左側：原始 multimodal causal graph

```text
User Intent U
├→ Voice
├→ Text
├→ Action Choice
└→ Outcome

Camera → UI State → Outcome
Tool Health → Tool Result → Outcome
```

中央：Encoder v17 / v18 切換

```text
v17:
Voice + Text → Z1
Camera + UI → Z2
Tool → Z3

v18:
Voice + Text + Tool → Z1'
Camera + UI → Z2'
```

右側即時顯示：

```text
Distribution drift        LOW
Semantic drift            LOW
CI structural drift       HIGH ⚠
Markov boundary changed   YES ⚠
NCO-12 validity           FAIL
Proxy bridge residual     0.03 → 0.21

Certificate CSC-8
VALID → STALE_PENDING_REVALIDATION

Dependent OPE-31
QUARANTINE

WRITE_EXTERNAL
ALLOW → VERIFY
```

再加一個「Auto NC Discovery」按鈕：

```text
Candidate X17
CI pattern     PASS
Tetrad         PASS
Temporal role PASS
Cross-env      FAIL

→ CANDIDATE ONLY
```

使用者可以直接看到：

> **「找到一個看似 negative control 的變數」與「這個變數有資格支撐 causal identification」是兩個完全不同的階段。**

---

# Code / GitHub

## `imjaewon07/DANCE`
Repo：
https://github.com/imjaewon07/DANCE

實際目錄：

```text
DANCE/
├── Find_NegativeControls.R
├── effect_est.R
├── simluation_code.R
└── README.md
```

### 最值得讀：`Find_NegativeControls.R`
核心內容：
- `ci()`：透過 `bnlearn::ci.test` 做 conditional-independence test；
- `connectedness()` / `CFilter()`：先做 treatment/outcome connectedness screening；
- `vtet()`：Wishart vanishing-tetrad test；
- `vcheck3.all()`：triplet + treatment/outcome 的 CI/tetrad validity checks；
- `FindSeeds()`：枚舉 candidate triplets 並篩 seed；
- `FindNegativeControls()`：public pipeline。

### `effect_est.R`
不是單純挑一對 NC；它會：
- 找 validated NC sets；
- 對不同 `(W,Z)` pair 建 estimating equations；
- 估各 pair 的 ATE；
- 依 pair 在 validated sets 中出現頻率加權聚合。

### 工程限制
- 目前公開程式相當 research-grade；
- `FindSeeds()` triplet combinatorics 對高維 candidate space 會快速變貴；
- 原始碼自己也註記 tetrad implementation 假設線性/Gaussian；
- 不可直接當作 neural embedding causal validator。

---

# Papers

## 1. Data-driven Automated Negative Control Estimation (DANCE)
- **Title**: Data-driven Automated Negative Control Estimation (DANCE): Search for, Validation of, and Causal Inference with Negative Controls
- **Authors**: Erich Kummerfeld, Jaewon Lim, Xu Shi
- **Institution**: authors associated with University of Minnesota / University of Washington research contexts;以 JMLR author record 為準
- **Year**: 2024
- **URL**: https://jmlr.org/papers/v25/22-1062.html
- **Code**: https://github.com/imjaewon07/DANCE
- **Dataset**: simulations + real observational application
- **Architecture**: candidate NC search → validation test → pairwise NC causal estimation → aggregation
- **Contribution**: 把 special disconnected NC 從 subject-matter-only discovery 推到 data-driven search / validation。
- **Limitations**: 特定 structural assumptions；公開 code 的 tetrad test 依賴 linear/Gaussian approximation；不是一般 neural-latent NC discovery theorem。
- **改變了什麼**: Hermes 的 `NegativeControlCandidateMiner` 有了可落地的統計原型，而不再只是概念節點。

## 2. CARL: Preserving Causal Structure in Representation Learning
- **Authors**: Yulong Li, Xiwei Liu, Feilong/Barrett Tang（官方 ICLR 頁面作者版本需依最終稿）, Zhixiang Lu, Ming Hu, Yichen Li, Haochen Xue, Peixin Guo, Jionglong Su, Yutong Xie, Eran Segal, Imran Razzak
- **Institutions**: MBZUAI, Xi’an Jiaotong-Liverpool University, Monash University 等
- **Year**: 2026, ICLR
- **URL**: https://proceedings.iclr.cc/paper_files/paper/2026/hash/d63cf0622eed012a17fe88fced64dcb8-Abstract-Conference.html
- **Architecture**: cross-modal representation + conditional-independence preservation + information-bottleneck regularization + monotonic alignment consistency + Markov-boundary preservation
- **Contribution**: 將 representation-induced structural drift 明確變成 cross-modal representation 的設計目標，並直接關聯 causal query identifiability。
- **Limitations**: structural preservation tests 仍依賴資料、graph assumptions 與 proxy tests；不等於 arbitrary multimodal foundation-model latent 已被完整因果化。
- **改變了什麼**: Hermes drift monitor 從「向量分布漂移」升級成「CI / Markov boundary / identifiability 漂移」。

## 3. Learning Invariant Modality Representation for Robust Multimodal Learning from a Causal Inference Perspective (CmIR)
- **Authors**: Sijie Mai, Shiqin Han
- **Year**: 2026, ACL
- **URL**: https://aclanthology.org/2026.acl-long.2119/
- **Code**: https://github.com/TmacMai/CmIR （目前公開 repo 主要只有 README，尚不能視為完整可審查 implementation）
- **Architecture**: modality causal-invariant representation + environment-specific spurious representation + invariance / MI / reconstruction objectives
- **Contribution**: 表明 multimodal robustness 需要把 environment-specific factor 顯式拆出，而非只有一般 fusion regularization。
- **Limitations**: empirical invariance / OOD robustness 不自動等於 causal identification。

## 4. Causal Representation Learning from General Environments under Nonparametric Mixing
- **Authors**: Ignavier Ng, Shaoan Xie, Xinshuai Dong, Peter Spirtes, Kun Zhang
- **Year**: 2025, AISTATS
- **URL**: https://proceedings.mlr.press/v258/ng25a.html
- **Contribution**: 系統研究更一般 environment 與 nonparametric mixing 下的 causal representation identifiability，降低對過度理想化 intervention assumptions 的依賴。
- **限制**: identification 依然需要明確 environment / mechanism assumptions；不能直接套成 production certificate。

## 5. Double Negative Control Inference With Some Invalid Negative Control Exposures for Continuous Outcome
- **Authors**: Qingqing Yang, Jinzhu Jia
- **Institution**: Peking University
- **Year**: 2025
- **URL**: https://doi.org/10.1002/sim.70276
- **Contribution**: 在特定 framework 中容許部分 NCE invalid，並在多數有效的條件下進行 robust estimation。
- **限制**: continuous outcome / 特定模型與理論設定；不是 generic neural-agent NC robustification theorem。

---

# 已確認事實 / 推論 / 假說分離

## 已確認事實
- DANCE 公開 code 確實執行 CI + Wishart tetrad 的 NC candidate validation；
- CARL 的研究目標明確是避免 representation-induced structural drift，並保存 conditional independence / Markov-boundary 類 causal structure；
- CmIR 明確拆 causal-invariant 與 environment-specific representation；
- automatic negative-control discovery 已有 formal statistical literature，但 validity 依賴 structural assumptions。

## 工程推論
- Hermes 應將 NC discovery、validity certificate、encoder version、environment contract、certificate dependencies 分成不同 runtime objects；
- encoder 更新後應沿 dependency graph 做 targeted revalidation，而不是全有或全無。

## 尚未驗證假說
- 是否能對 LLM/VLM embedding 建立可靠的 nonlinear/generalized tetrad 或 rank-constraint NC discovery；
- `D_struct` 這類統一 structural-drift score 是否有足夠校準性可直接進 permission gate；
- 自動生成 Tool/MCP/Memory negative controls 是否能在 production Agent 中長期保持 exclusion restriction。

---

# Unknown / Open Questions 1–3

## 1. Neural Negative-Control Discovery
如何從高維 representation 中找 NC？

```text
raw candidate field
vs.
learned latent direction
vs.
subspace
```

如果 NC 本身是 latent direction，exclusion restriction 要如何被驗證？目前仍無通用答案。

## 2. Structural Drift Threshold
CI / Markov-boundary / bridge residual 到底變多少才要：

```text
WARN
REVALIDATE
QUARANTINE
REVOKE
```

目前 Hermes 還缺 calibration layer。

## 3. Certificate Migration
如果 encoder v18 與 v17 可建立可信的 causal-preserving map：

```text
Z17 ↔ Z18
```

舊 certificate 能不能「遷移」而不是重做？需要 representation transport / equivalence 的 formal contract。

---

# 下一輪研究

下一輪應研究：

# **Causal Representation Equivalence × Certificate Migration × Intervention Invariance Testing × Drift Calibration**

研究鏈：

```text
Encoder / Fusion Update
↓
Old causal state Z_old
New causal state Z_new
↓
Can causal relations be transported?
↓
CI equivalence
Markov-boundary equivalence
Intervention-response equivalence
Bridge-function transport
Negative-control role stability
↓
Certificate migration?
├ YES: scoped migration
├ PARTIAL: reduced scope + revalidation
└ NO: revoke + rebuild
↓
Permission Gate
```

需要優先回答：
1. 什麼叫兩個 representation 在 causal sense 上 equivalent？
2. observational equivalence 是否足夠？通常不夠；是否需要 intervention equivalence？
3. certificate expiry threshold 如何用 false-alarm / missed-drift tradeoff 校準？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Negative Control Candidate Discovery
Disconnected Negative Control
Vanishing Tetrad
Tetrad Constraint
Wishart Tetrad Test
NegativeControlCandidateRecord
NegativeControlValidityCertificate
Invalid Negative Control Candidate
Robust Negative-Control Aggregation
Representation-Induced Structural Drift
Distributional Representation Drift
Semantic Representation Drift
Causal Structural Drift
Conditional-Independence Fingerprint
Markov-Boundary Fingerprint
CausalFingerprint
CausalInvarianceContract
Environment Scope
Certificate Dependency Graph
Certificate Expiry Trigger
Certificate Revalidation
Scoped Revalidation
Certificate Scope Reduction
Certificate Migration
Causal Representation Equivalence
```

## Edges

```text
Statistically Discovered Negative Control
≠ Valid Negative Control

Vanishing Tetrad
→ Supports Particular Latent Structure Assumptions

Vanishing Tetrad
≠ General Neural Causal Validity

Small Embedding Drift
≠ Small Causal Structural Drift

Stable Predictive Accuracy
≠ Stable Causal Identifiability

Invariant Across Seen Environments
≠ Invariant Under All Relevant Interventions

Encoder Update
→ May Invalidate Negative-Control Role

Encoder Update
→ May Invalidate Proxy Certificate

Negative-Control Invalidity
→ Can Invalidate Causal State Certificate

Causal State Certificate
→ Supports OPE / Policy Certificate

Representation Structural Drift
→ Certificate Revalidation

Model-Version Compatibility
≠ Causal-Certificate Compatibility
```

---

# 本輪結束判定

**缺哪一層？**  
`Causal Representation Equivalence / Certificate Migration Layer`。

**哪個節點最淺？**  
`NeuralNegativeControlDiscovery`、`StructuralDriftCalibration`、`CertificateMigration`。

**哪個概念仍只是名詞？**  
Production 級 `CausalRepresentationEquivalenceCertificate`：目前還沒有可直接宣稱通用有效的測試規格。

**哪個系統值得讀原始碼？**  
`imjaewon07/DANCE`，優先：`Find_NegativeControls.R` → `effect_est.R` → `simluation_code.R`。

**哪篇論文需追引用？**  
優先追 CARL 的 causal-structure-preservation / representation-induced structural drift 引用鏈，以及 DANCE 之後 automated NC discovery 的擴充工作。

**哪個概念最適合視覺模擬？**  
`Causal Representation Drift × Negative-Control Discovery × Certificate Expiry Lab`。

**哪個 Agent 架構最值得實作？**

```text
Representation Version Registry
↓
Automatic NC Candidate Miner
↓
Causal Structure Validator
↓
CausalFingerprint
↓
Certificate Dependency Graph
↓
Structural Drift Monitor
↓
Expiry / Revalidation Router
↓
Permission Gate
```

---

# 對「AI 到底怎麼運作」再補上的一層

```text
Camera / Voice / Text / Tool / Memory
↓
Encoder
↓
Embedding / Fused State
```

並不是終點。

真正要安全地把這個 state 用於 Agent causal decision，還需要：

```text
Representation
↓
它保存了哪些 causal relations？
↓
哪些 relation 只是資料分布巧合？
↓
有沒有可當 negative control 的 channel？
↓
跨 environment 是否維持？
↓
encoder 更新後 relation 是否仍成立？
↓
舊 causal certificate 是否還有效？
↓
Identification / OPE / Permission
↓
Action
```

因此本輪最核心的結論是：

> **AI 的 embedding 不是一個靜態「世界狀態」。它是一個由特定 encoder、fusion、資料環境與版本共同生成的測量系統。只要測量系統變了，即使向量看起來很相似，原本的 conditional independence、negative-control role、proxy validity、backdoor/IV identifiability 都可能已改變。真正可驗證的 Agent 因此需要的不只是 model versioning，而是 causal certificate lifecycle。**
