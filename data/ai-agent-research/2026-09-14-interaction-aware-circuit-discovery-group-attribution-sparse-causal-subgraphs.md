# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 22:17（Asia/Taipei）**  
**主題：Interaction-Aware Circuit Discovery × Group Attribution × Sparse Causal Subgraphs × Combinatorial Intervention Search**

---

## 本小時新發現

本輪承接上一輪 `Attribution Calibration × CausalProxyCertificate`，不再重複 attention / gradient / activation patching 的基本定義，而是追問一個更底層問題：

> 如果真正的 mechanism 不是由單一 head / feature / token 決定，而是「一組元件共同存在時才產生效果」，Hermes 要如何在巨大的組合空間中找到它？

上一輪已知：

```text
Attribution score
≠ causal probability

Activation patching
≠ interaction-free ground truth
```

本輪補上的核心層是：

```text
Cheap component / edge scores
↓
Candidate subgraph
↓
Interaction diagnostics
↓
Group / path interventions
↓
Sparse causal subgraph search
↓
Faithfulness validation
↓
CircuitCertificate
```

### 新論文 / 新架構 / 新 GitHub

1. **Active Circuit Discovery (ACD, Sathish, Ahsan, Latifi, 2026)**：把 circuit discovery 建模成 POMDP active-inference problem，以 attribution graph 為 backend，agent 主動選下一個介入。重要負面結果是 direct EAP ranking 本身已是強 baseline，完整 agent 並未穩定勝出；這提醒「更複雜 search agent」不等於更好的 circuit discovery。
2. **CircuitLasso (2026)**：以 sparse linear regression 學習 feature circuit，在 SAE 高維 feature space 中避免逐一 intervention 的巨大成本；價值在於把 exhaustive intervention 問題轉成 sparse structure learning，再用 intervention 做驗證。
3. **PIE / FAP-Synergy (2026)**：Cross-Layer Transcoder-native pipeline 採 `prune first → interpret → evaluate`，並加入 synergy-aware reranking，直接回應「單一 feature attribution 可能錯失 cooperative groups」。
4. **EAP-GP (NeurIPS 2025)**：gradient-based EAP 會遇到 zero-gradient / saturation；GradPath 透過 integration path 改善 attribution，六個資料集、GPT-2 Small/Medium/XL 上報告 circuit faithfulness 最高改善 17.7%。
5. **Hybrid Attribution and Pruning (HAP, 2025)**：先用 attribution 快速找 high-potential subgraph，再用 edge pruning 做 faithful extraction；報告比 baseline 快 46%，且在 IOI case study 能保留 attribution-only pruning 容易丟掉的 cooperative S-inhibition heads。
6. **Anthropic Circuit Tracing / Attribution Graphs**：以 cross-layer transcoders 建 local replacement model，將 active features、error nodes、tokens、logits 組成 attribution graph；官方方法明確說明 replacement-model attribution 是 indirect，需要 perturbation validation，而且早期 graph 對 attention-QK interaction 不完整，後續才補上 attention computation tracing。
7. **Lorsa (ICLR 2026)**：以 Low-Rank Sparse Attention 分解注意力 superposition，指出 interaction 不只發生在 MLP/SAE features，attention-mediated feature interaction 本身也需要 sparse decomposition。

主要來源：
- https://www.mdpi.com/2073-8994/18/6/1043
- https://arxiv.org/abs/2606.16939
- https://www.alphaxiv.org/abs/2604.16889
- https://papers.nips.cc/paper_files/paper/2025/hash/d029c97ee0db162c60f2ebc9cb93387e-Abstract-Conference.html
- https://arxiv.org/abs/2510.03282
- https://transformer-circuits.pub/2025/attribution-graphs/methods.html
- https://www.transformer-circuits.pub/2025/attention-qk/index.html
- https://proceedings.iclr.cc/paper_files/paper/2026/hash/7e57d4c3bb2bd2396a551e7aeea19aed-Abstract-Conference.html

---

# 本小時最重要 5 個發現

## 1. Circuit discovery 的真正搜尋單位不應永遠是單一 component

傳統 ranking：

```text
score(A)
score(B)
score(C)
↓
keep Top-K
```

會漏掉：

```text
Δ(A) ≈ 0
Δ(B) ≈ 0

Δ(A+B) ≫ 0
```

這不是小誤差，而是機制層級錯置。

因此 Hermes 新增：

```text
GroupEffectRecord
├ group_id
├ members[]
├ intervention_contract
├ individual_effects{}
├ joint_effect
├ additive_prediction
├ synergy
├ redundancy
├ target_observable
└ confidence
```

簡單二階 synergy：

```text
Synergy(A,B)
=
Δ(A,B) - Δ(A) - Δ(B)
```

若接近 0，可近似 additive；若顯著非 0，單點 ranking 不足。

### 為什麼重要

HAP 的 IOI 案例顯示 cooperative S-inhibition components 可能被 attribution-only high-sparsity pruning 丟掉；PIE/FAP-Synergy 也直接把 synergy-aware reranking 納入 pipeline。

核心 edge：

```text
Low Individual Effect
≠ Low Group Importance
```

---

## 2. Attribution graph 是 candidate mechanism graph，不等於 causal circuit

Anthropic-style circuit tracer 的底層不是直接對原始模型所有 nonlinearity 做完整 intervention，而是建立 prompt-specific **local replacement model**。

其 `attribution.py` 的 algorithm 可拆為：

```text
Original Transformer
↓
Cross-layer / per-layer transcoder features
↓
Local replacement model
↓
Freeze / bypass selected nonlinear mechanisms
↓
Forward cache active features + residual/error/token vectors
↓
Custom backward gradient injection
↓
Direct linear effect A_source→target
↓
Dense adjacency matrix
↓
Graph pruning
```

原始碼開頭直接把 graph 定義成：

```text
"direct, linear effects"
```

並說明 gradients 只穿過線性組件、bypass attention mechanism、MLP nonlinearity 與 layer-norm scales 後，再組裝 Graph。

這代表：

```text
Attribution Graph Edge
=
local replacement-model direct effect
```

而不是：

```text
Attribution Graph Edge
=
original model globally certified causal edge
```

Anthropic 方法文章自己也要求 perturbation experiments 驗證 attribution-graph mechanism。

Hermes 因此新增：

```text
CircuitEvidenceLevel
├ ATTRIBUTION_ONLY
├ REPLACEMENT_MODEL_VALIDATED
├ ORIGINAL_MODEL_SINGLE_INTERVENTION
├ GROUP_INTERVENTION_VALIDATED
├ PATH_VALIDATED
└ BEHAVIORALLY_FAITHFUL_SUBGRAPH
```

---

## 3. Graph pruning 的「累積 influence」會壓縮圖，但不自動解決 interaction

Anthropic-compatible `graph.py` 的 pruning 流程可以拆成：

```text
adjacency_matrix A
↓
abs(A)
↓ row normalize
↓
compute influence:
A + A² + A³ + ...
↓
logit-weighted node influence
↓
node cumulative threshold
↓
prune rows / columns
↓
edge influence
↓
edge cumulative threshold
↓
iteratively remove dangling nodes
```

`compute_influence()` 等價地迭代：

```text
wA + wA² + wA³ + ...
```

`prune_graph()` 再用 `node_threshold` / `edge_threshold` 保留指定比例 influence。

這對「找高 influence 路徑」非常有效，但它仍然是 additive graph propagation 的世界觀。

因此：

```text
Graph Influence Pruning
≠ Interaction Discovery
```

Hermes 應該在 pruning 後增加：

```text
Candidate graph
↓
Interaction probe
↓
Group/path intervention
↓
Graph correction
```

新增：

```text
InteractionAwarePruneRecord
├ original_nodes
├ attribution_kept_nodes
├ interaction_recovered_nodes
├ interaction_pairs_tested
├ groups_tested
├ final_nodes
└ faithfulness_delta
```

---

## 4. 組合搜尋不能暴力窮舉，應採「Screen → Group → Intervene → Refine」

若 candidate components 有 N 個，pair interaction 已是：

```text
O(N²)
```

k-way groups 更是：

```text
O(2^N)
```

所以 production circuit discovery 需要分層。

本輪建議 Hermes 採：

```text
Stage 1 — Cheap screen
Attribution / AP / EAP / EAP-GP / sparse regression
↓
Stage 2 — Topology grouping
same path / same token position / same layer band /
shared downstream target / SAE semantic cluster
↓
Stage 3 — Interaction diagnostic
pairwise or small-group interventions
↓
Stage 4 — Search
beam / greedy forward / backward elimination /
active-inference / Bayesian experimental design
↓
Stage 5 — Original-model validation
ablate outside / retain only / patch group /
compare behavior
↓
Stage 6 — stability
prompt variants / dataset / checkpoint / model family
```

ACD 的 2026 結果特別重要：POMDP active agent 是合理方向，但 direct EAP ranking 是很強 baseline，完整 agent 不一定穩定勝出。

所以 Hermes 應把 search policy 本身也 benchmark：

```text
SearchPolicyBenchmark
├ interventions_used
├ wall_clock
├ GPU_seconds
├ circuit_faithfulness
├ circuit_sparsity
├ interaction_recall
└ uncertainty_reduction
```

核心 edge：

```text
Smarter Search Agent
≠ Better Circuit Discovery Automatically
```

---

## 5. 「Sparse」與「Faithful」是兩個不同目標，最小 circuit 甚至可能不是唯一

Circuit discovery 常寫成：

```text
Find smallest C
such that
Behavior(M_C) ≈ Behavior(M)
```

但在存在 redundant pathways 時：

```text
Circuit C1 → task works
Circuit C2 → task works
C1 ≠ C2
```

可能同時成立。

因此 circuit certificate 不能只有：

```text
nodes = 37
accuracy = 95%
```

Hermes 新增：

```text
CircuitCertificate
├ target_behavior
├ candidate_graph_version
├ node_set[]
├ edge_set[]
├ group_mechanisms[]
├ intervention_method
├ retain_only_score
├ ablate_circuit_score
├ full_model_score
├ sparsity
├ interaction_coverage
├ redundancy_notes[]
├ prompt_support
├ dataset_support
├ checkpoint_support
├ causal_evidence_level
└ known_alternative_circuits[]
```

至少要雙向驗證：

```text
Sufficiency:
retain circuit only
→ behavior preserved?

Necessity-like evidence:
ablate circuit
→ behavior degraded?
```

但 redundancy 存在時，單純 necessity test 仍可能失敗，因此需記錄 alternative sufficient circuits。

核心 edge：

```text
Sparse Circuit
≠ Unique Mechanism

Sufficient Circuit
≠ Individually Necessary Components
```

---

# Architecture Breakdown

本輪建議 Hermes 加入完整的 **Interaction-Aware Circuit Runtime**：

```text
Model / Prompt / Multimodal Input
↓
Target Behavior Contract
├ next-token
├ claim
├ reasoning step
├ tool choice
└ task outcome
↓
Representation Layer
├ heads
├ MLP neurons
├ SAE features
├ transcoder features
├ attention Q/K/V factors
└ multimodal encoder features
↓
Cheap Attribution Layer
├ AP
├ EAP
├ EAP-GP
├ gradients
├ attribution graph
└ sparse regression
↓
Candidate Causal Graph
↓
Topology / Semantic Grouper
↓
Interaction Probe Scheduler
↓
Group / Path Intervention Engine
↓
Sparse Subgraph Search
↓
Original-Model Faithfulness Validator
↓
Cross-Prompt / Cross-Model Stability
↓
CircuitCertificate
↓
Knowledge Graph
```

### 與 Agent runtime 的連接

這一層不是只能解釋單一 LLM token；未來可以往 Agent system reasoning 映射：

```text
Model Circuit
↓
Reasoning Feature Group
↓
Tool-selection logit
↓
Tool Call
↓
Agent Option
↓
External Action
```

也就是把「model reasoning」和前幾輪的「system reasoning / event causal graph」接起來。

---

# Bottom-Level Logic

## 1. 一階 component effect

```text
Δ_i = m(do(component_i ← alternative)) - m(original)
```

## 2. Pair interaction

```text
INT(i,j)
=
Δ_{i,j} - Δ_i - Δ_j
```

## 3. k-way Möbius-style interaction intuition

對 group G：

```text
JointEffect(G)
```

不能只用：

```text
Σ individual effects
```

而應逐層扣除 lower-order subsets，才能估計純 interaction contribution。

實務上不能對大 N 做完整 power-set，所以用：

```text
attribution screen
→ candidate groups
→ pair / small-group tests
→ adaptive expansion
```

## 4. Circuit search objective

可寫成多目標：

```text
min_C
  λ1 * |C|
+ λ2 * compute(C)
+ λ3 * instability(C)
+ λ4 * unexplained_interaction(C)
+ λ5 * faithfulness_loss(C)
```

不是只追求最少 node。

## 5. Faithfulness gap

```text
Full model metric      = M_full
Circuit-retained metric = M_keep
Circuit-ablated metric  = M_drop
```

Hermes 應同時追：

```text
SufficiencyGap = |M_full - M_keep|
AblationEffect = |M_full - M_drop|
```

並另外記錄 interaction coverage，否則高 faithfulness 可能只是保留太大的 subgraph。

---

# Visual Simulation Idea

## **Circuit Interaction Observatory × Sparse Causal Subgraph Lab**

### 左側：候選 graph

```text
Token / Image patch
   ↓
Feature A ──→ Feature C ──→ Logit
   ↘              ↑
     Feature B ───┘
```

node 上同時顯示：

```text
single attribution
single intervention
uncertainty
layer / token position
```

### 中央：Interaction Matrix

| pair | A | B | C | D |
|---|---:|---:|---:|---:|
| A | — | +0.41 | +0.02 | -0.11 |
| B | +0.41 | — | +0.36 | +0.01 |
| C | +0.02 | +0.36 | — | +0.27 |
| D | -0.11 | +0.01 | +0.27 | — |

點 `A+B`：

```text
A alone      +0.03
B alone      +0.02
A+B          +0.46

Synergy       +0.41
```

UI 顯示：

```text
⚠ COOPERATIVE MECHANISM
single-node ranking would miss this pair
```

### 右側：Search Budget

```text
Candidate components     1,240
Full pair search       767,?xx
Tested pairs               220
Tested groups               41
GPU intervention budget    18%
Faithfulness                94.6%
Sparsity                     2.3%
Interaction coverage        87%
```

提供 search mode：

```text
Top-K only
Greedy
Beam
Active inference
Sparse regression + validate
Hybrid attribution + pruning
```

### 最下方：Circuit certificate

```text
Behavior: IOI / ToolChoice / ClaimGeneration

ATTRIBUTION ONLY        PASS
SINGLE INTERVENTION     PASS
GROUP INTERVENTION      PASS
RETAIN-ONLY             93.8%
ABLATE-CIRCUIT          -72.4%
PROMPT STABILITY        81%
OOD STABILITY           54% ⚠

CERTIFICATE:
VALID ON SPECIFIED SUPPORT ONLY
```

---

# Code / GitHub

## Anthropic-compatible Circuit Tracer mirror

本輪實際深入：

```text
circuit_tracer/
├ attribution.py
├ graph.py
├ replacement_model.py
├ transcoder/
├ frontend/
├ configs/
└ utils/
```

### `attribution.py`

值得看的核心：

```text
AttributionContext
_compute_score_hook()
_make_attribution_hooks()
compute_batch()
compute_salient_logits()
```

其核心不是 arbitrary saliency，而是對 active feature / error / token vectors 做 custom backward gradient contraction，產生 prompt-specific direct linear-effect adjacency matrix。

### `graph.py`

值得看的核心：

```text
normalize_matrix()
compute_influence()
compute_node_influence()
compute_edge_influence()
find_threshold()
prune_graph()
```

`compute_influence()` 以 iterative matrix multiplication 累積 multi-step influence；`prune_graph()` 使用 node / edge cumulative thresholds，再反覆移除失去必要 incoming/outgoing edges 的節點。

### Hermes 應擴充的位置

```text
Graph
↓
prune_graph()
↓
interaction_probe()
↓
group_intervention()
↓
sparse_subgraph_search()
↓
validate_original_model()
↓
CircuitCertificate
```

也就是不能在 `prune_graph()` 後就把結果叫作「已發現 causal circuit」。

---

# Papers

## 1. Active Circuit Discovery: A Multi-Action POMDP Agent for Causal Feature Identification in Transformer Attribution Graphs

- Authors: Sharath Sathish, Mominul Ahsan, Majid Latifi
- Year: 2026
- Venue: Symmetry 18(6):1043
- URL: https://www.mdpi.com/2073-8994/18/6/1043
- Backend: Anthropic circuit-tracer / EAP / transcoders
- Architecture: POMDP active-inference agent selects interventions based on beliefs over feature importance / layer role / causal influence
- Contribution: 把 intervention selection 轉成 active experiment design
- Limitation: direct EAP ranking 是強 baseline；multi-action agent 未穩定勝出，部分 steering improvement 與 random active-feature control 差距不顯著
- 改變了什麼：說明「主動實驗」是可行方向，但 circuit search agent 必須被 baseline 約束，不能只因有 agent loop 就宣稱更強

## 2. Scalable Circuit Learning for Interpreting Large Language Models / CircuitLasso

- Year: 2026
- URL: https://arxiv.org/abs/2606.16939
- Architecture: sparse linear regression over circuit structure
- Contribution: 在 SAE feature 高維空間降低 intervention-based discovery 的成本
- Limitation: regression-discovered relation 本身仍需 intervention / behavioral faithfulness validation
- 改變了什麼：把「全部 intervention」改成「sparse structure learning → targeted intervention」

## 3. Prune, Interpret, Evaluate / FAP-Synergy

- Authors: Qinhao Chen, Linyang He, Nima Mesgarani
- Year: 2026
- URL: https://www.alphaxiv.org/abs/2604.16889
- Architecture: CLT-native prune-first pipeline + feature attribution patching + synergy-aware reranking
- Contribution: 明確把 synergy 納入 feature prioritization
- Limitation: interaction-aware reranking 仍不是完整高階 causal subgraph identification
- 改變了什麼：從單 feature relevance 走向 cooperative feature groups

## 4. EAP-GP: Mitigating Saturation Effect in Gradient-based Automated Circuit Identification

- Authors: Lin Zhang et al.
- Venue: NeurIPS 2025
- URL: https://papers.nips.cc/paper_files/paper/2025/hash/d029c97ee0db162c60f2ebc9cb93387e-Abstract-Conference.html
- Architecture: Edge Attribution Patching + adaptive GradPath integration path
- Contribution: 緩解 zero-gradient / saturation，最高報告 17.7% faithfulness improvement
- Limitation: 改善單/edge attribution 本身，不等於解決 hidden group interactions
- 改變了什麼：cheap screening 更可信，但仍需 group intervention

## 5. Discovering Transformer Circuits via a Hybrid Attribution and Pruning Framework

- Authors: Hao Gu, Vibhas Nair, Amrithaa Ashok Kumar, Jayvart Sharma, Ryan Lagasse
- Year: 2025
- URL: https://arxiv.org/abs/2510.03282
- Architecture: attribution shortlist → edge pruning
- Contribution: 報告 46% speedup without sacrificing circuit faithfulness；IOI 中保留 cooperative circuit components
- Limitation: hybrid candidate restriction 仍可能受第一階段漏檢影響
- 改變了什麼：提供 Hermes 很實際的「便宜篩選 + 昂貴驗證」模板

## 6. Circuit Tracing: Revealing Computational Graphs in Language Models

- Institution: Anthropic
- Year: 2025
- URL: https://transformer-circuits.pub/2025/attribution-graphs/methods.html
- Architecture: cross-layer transcoders → local replacement model → prompt-specific attribution graph → pruning → perturbation validation
- Contribution: 將 feature-level mechanisms視覺化成 attribution graph
- Limitation: replacement model 可與原模型 mechanism 不同；initial graph 對 attention circuit 不完整
- 改變了什麼：提供 circuit graph 的 system architecture，但也清楚界定 attribution graph ≠ direct proof of original-model mechanism

## 7. Tracing Attention Computation Through Feature Interactions

- Institution: Anthropic
- Year: 2025
- URL: https://www.transformer-circuits.pub/2025/attention-qk/index.html
- Contribution: 補足早期 attribution graph 缺少「為什麼 attention 選這個位置」的問題，往 Q/K feature interaction 深入
- 改變了什麼：證明 attention-mediated interaction 不能被簡化成單一 feature→feature edge

---

# Unknown / Open Questions 1–3

## 1. 高階 interaction 要怎麼 scalable？

Pairwise interaction 已是 O(N²)，三階 O(N³)。需要研究：

```text
hierarchical grouping
sparse polynomial models
compressed sensing
Bayesian experimental design
active intervention selection
```

哪一種最適合 transformer feature circuit。

## 2. Circuit equivalence 怎麼定義？

如果兩個不同 subgraphs 都能產生相同 behavior：

```text
C1 ≠ C2
Behavior(C1) ≈ Behavior(C2)
```

它們是「同一 mechanism 的等價實作」還是兩條 redundant causal routes？

需要：

```text
CircuitEquivalenceContract
```

## 3. Multimodal circuit 如何跨 encoder / projector / LLM？

文字 circuit discovery 多數仍在 transformer residual / SAE / transcoder space；多模態真正需要：

```text
Image patch
↓ vision feature
↓ projector token
↓ LLM feature group
↓ reasoning token
↓ claim/tool choice
```

其中 interaction 可能跨 modality boundary，目前仍很淺。

---

# 下一輪研究

下一輪應進入：

# **Multimodal Cross-Module Circuits × Encoder→Projector→LLM Causal Paths × Modality Bottlenecks × Cross-Modal Interaction**

原因：目前已從單點 attribution 推到 group / sparse subgraph，但整體「AI 到底怎麼運作」還缺多模態模組之間的真正因果橋：

```text
Camera / Image
↓
Vision Encoder
↓
Patch / Region Features
↓
Projector / Resampler
↓
LLM Tokens
↓
Feature / Attention Circuit
↓
Reasoning
↓
Agent Action
```

下一輪應比較：

```text
CLIP / ViT-style encoder
Q-Former
Perceiver Resampler
MLP projector
cross-attention fusion
early fusion
unified-token omni models
```

並研究介入：

```text
image region ablation
vision feature patch
projector token patch
cross-attention head patch
LLM feature group intervention
```

最終建立：

```text
CrossModalCircuitCertificate
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Interaction-Aware Circuit Discovery
Group Attribution
Group Intervention
GroupEffectRecord
Pairwise Synergy
Higher-Order Interaction
Cooperative Mechanism
Redundant Mechanism
Sparse Causal Subgraph
Candidate Causal Graph
Interaction Probe Scheduler
GroupInterventionPlanner
InteractionAwarePruneRecord
Circuit Evidence Level
CircuitCertificate
Circuit Sufficiency
Circuit Ablation Effect
Circuit Equivalence
Alternative Sufficient Circuit
Interaction Coverage
SearchPolicyBenchmark
Active Circuit Discovery
Hybrid Attribution Pruning
Sparse Circuit Regression
Attention-Mediated Feature Interaction
```

## Edges

```text
Low Individual Effect
≠ Low Group Importance

Attribution Graph
≠ Certified Causal Circuit

Graph Influence Pruning
≠ Interaction Discovery

Sparse Circuit
≠ Unique Mechanism

Sufficient Circuit
≠ Individually Necessary Components

Cheap Attribution
→ Candidate Screening

Group Intervention
→ Interaction Validation

Hybrid Pruning
→ Reduces Expensive Search Space

Active Intervention Selection
→ Can Reduce Experimental Cost

Smarter Search Agent
≠ Better Circuit Discovery Automatically

Replacement Model Faithfulness
→ Must Be Validated Against Original Model

Attention QK Interaction
→ Extends Feature-Feature Attribution Graph
```

---

# 本輪結束判定

**缺哪一層：** `Multimodal Cross-Module Causal Circuit Layer`。

**哪個節點最淺：** `HigherOrderInteraction`、`CircuitEquivalence`、`GroupInterventionPlanner`、`InteractionCoverage`、`CrossModalCircuitCertificate`。

**哪個概念仍只是名詞：** production 級 `Minimal True Circuit`。目前最多只能在明確 behavior / prompt distribution / intervention contract 下談 sparse sufficient causal subgraph，不能宣稱找到模型唯一真實 circuit。

**哪個系統值得讀原始碼：** Anthropic circuit-tracer 的 `attribution.py → graph.py → replacement_model.py → transcoder/* → frontend/*`；接著應追 HAP / CircuitLasso / PIE 的實作，比較它們如何從 ranking 走向 subgraph extraction。

**哪篇論文需追引用：** `The Curse of Multiple Mediators` 的 interaction/circuit 後續引用，並追 `CircuitLasso` 與 `FAP-Synergy` 是否在更大模型 / 更多自然任務被獨立重現。

**哪個概念最適合視覺模擬：** `Circuit Interaction Observatory × Sparse Causal Subgraph Lab`。

**哪個 Agent 架構最值得實作：**

```text
Cheap Attribution Screen
↓
Candidate Graph
↓
Topology/Semantic Grouping
↓
Active Interaction Probe Scheduler
↓
Group / Path Intervention
↓
Sparse Subgraph Search
↓
Original-Model Faithfulness Validation
↓
CircuitCertificate
```

---

# 對「AI 到底怎麼運作」新增的一層

前幾輪已經把：

```text
Input field
→ attribution
→ intervention
→ causal proxy
```

建立起來。

本輪再往模型內部補上一個更真實的結論：

> AI 的行為通常不是「某一顆 neuron / 某一個 head / 某一個 feature 造成」。真正的 transformer mechanism 可能是多個 features、attention routes、token positions 與 nonlinear mediators共同形成的 sparse causal subgraph。單點 attribution 最多是候選線索；只有把 cooperative interaction、redundancy、path effect、retain-only faithfulness 與 group intervention 都納入，才開始接近「模型到底用哪一組計算產生這個行為」。

這使整體還原鏈進一步變成：

```text
User / Image / Voice
↓
Encoder / Tokenization
↓
Internal Features
↓
Interaction-Aware Sparse Circuit
↓
Logits / Reasoning Tokens
↓
Planner / Tool Selection
↓
Agent Runtime
↓
Action
↓
External Outcome
```
