# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-12 00:54（Asia/Taipei）  
**本輪主題**：Cluster-Dependent Sequential Inference × Shadow→Live Calibration × Temporal Autocorrelation × Unknown Interference Graph × Exposure-Scoped Rollout Evidence  
**承接上一輪**：`2026-09-11-sequential-anytime-valid-shadow-paired-interference.md`

---

## 0. 與歷史研究比較

上一輪已建立：

```text
Production Request
↓
Stable / Canary / Shadow Assignment
↓
Assignment Provenance
↓
Exposure Recorder
↓
Trajectory / Effects / Final State
↓
Verifier
↓
Paired Shadow Comparator
↓
Anytime-Valid Sequential Evidence
↓
Interference Analyzer
↓
PROMOTE / HOLD / ROLLBACK
```

但上一輪仍留下四個未解問題：

1. 多筆 trajectory 若屬於同一 user、session、MCP server、shared memory、GPU pool 或時間窗口，並不是 iid observations；
2. 一般 e-process / confidence-sequence 的 validity 依賴 filtration 與資料生成假設，不能把不同資訊流的 evidence 直接無條件相乘或平均；
3. shadow suppress side effects，因此 shadow trajectory 與 live canary trajectory 的 data-generating process 不完全相同；
4. shared-resource graph 常未知，Agent runtime 不知道真正的 spillover edges 在哪裡。

本輪因此不再重複「為什麼要 anytime-valid inference」，而往下一層研究：

> **Hermes 如何在有 user/session/resource/time dependence 的 production telemetry 上累積 sequential evidence；如何把 shadow evidence 校準到 live-effect domain；以及如何從 runtime telemetry 主動發現未知 interference graph。**

---

# 1. 本小時新發現

## 新論文 / 方法

### A. Combining Evidence Across Filtrations
- Authors: Yo Joong Choe, Aaditya Ramdas
- Journal: Journal of the Royal Statistical Society Series B
- Year: 2026 journal publication / earlier arXiv
- DOI / URL: https://doi.org/10.1093/jrsssb/qkag058
- arXiv: https://arxiv.org/abs/2402.09698
- 核心：同一 null hypothesis 下，不同 filtration 建立的 e-process 不能直接假設在更細 filtration 中仍 valid；提出 adjuster 將 coarse-filtration e-process lift 到 fine filtration，再做 combine。
- 改變了什麼：對 Hermes 來說，不同 evidence streams（session-level、resource-level、shadow-level、live-level）不能只因為都是 e-values 就直接合併。
- 限制：adjustment 帶來 evidence growth cost；需要清楚定義各 evidence stream 可以看到的資訊集合。

### B. Adaptive Policy Learning Under Unknown Network Interference
- Authors: Aidan Gleich, Eric Laber, Alexander Volfovsky
- Year: 2026
- arXiv: https://arxiv.org/abs/2605.11191
- Architecture: Thompson sampling + latent interference-network learning + Gibbs posterior sampling
- Contribution: 在 interference graph 未知時，同時學 graph 與 treatment allocation；對 additive spillover 給出 Bayesian regret bound，general neighborhood interference 使用 explore-then-commit graph discovery。
- 對 Hermes 的意義：不要把 shared-resource graph 當成部署前就已完整知道；runtime 可以把 graph discovery 和 rollout policy learning接在一起。
- Limitations: 該研究的 treatment/outcome model 與 Agent tool/runtime 的高維語意 effect 仍有差距。

### C. Causal Graph Transformer for Treatment Effect Estimation Under Unknown Interference (CauGramer)
- Authors: Anpeng Wu, Haiyi Qiu, Zhengming Chen, Zijian Li, Ruoxuan Xiong, Fei Wu, Kun Zhang
- Venue: ICLR 2025
- URL: https://proceedings.iclr.cc/paper_files/paper/2025/hash/f7397355f68fa42e5d4739c2eb9b4cf6-Abstract-Conference.html
- Code: https://github.com/anpwu/CauGramer
- Architecture: graph attention over covariates + treatment-aware graph representation + potential-outcome heads + optional attention/propensity components
- Contribution: 不把 interference mechanism 固定等同於 observed social graph，而用 Graph Transformer 表示 unknown interference aggregation。
- Limitations: 不是 production runtime monitor，也不直接提供 sequential anytime-valid rollout gate。

### D. The Conflict Graph Design: Estimating Causal Effects under Arbitrary Neighborhood Interference
- Authors: Vardis Kandiros, Charilaos Pipis, Constantinos Daskalakis, Christopher Harshaw
- Year: 2024/2025 line of work
- arXiv: https://arxiv.org/abs/2411.10908
- Contribution: 用 conflict graph 表示某 causal estimand 下 treatment/exposure 的 fundamental unobservability，並設計 modified Horvitz-Thompson estimator；variance bound 與 conflict graph adjacency spectral radius 有關。
- 對 Hermes：resource-sharing relation 不只是一張 observability graph，也會決定哪些 stable/canary units 無法被乾淨比較。

### E. Causal Inference for Quantifying Noisy Neighbor Effects in Multi-Tenant Cloud Environments
- Authors: Philipe S. Schiavo et al.
- Year: 2026
- arXiv: 2604.03145
- Contribution: 以 controlled experiments + multi-stage causal inference 分析 Kubernetes multi-tenant noisy-neighbor，並觀察 CPU/memory/disk/network contention 的不同 degradation signatures。
- 對 Hermes：GPU pool、vector DB、MCP quota、queue、network bandwidth 都可能是 Agent rollout 的 hidden spillover channel。

### F. Causal Mediation Analysis for Network Data with Graph Neural Network
- Authors: Peikai Wu, Zhiguo Xiao
- Year: 2026
- arXiv: https://arxiv.org/abs/2608.13274
- Contribution: 在單一大型 network 中同時允許 treatment spillover 與 mediator spillover，並用 network HAC variance 處理 weak network dependence。
- 對 Hermes：Agent variant 的影響可能透過 mediator 傳播，例如 `canary → queue_depth → retry_rate → duplicate_effect`，不能只估 direct version effect。

---

# 2. 本小時最重要 5 個發現

## 發現 1：Trajectory Count ≠ Effective Sample Size

### 已確認事實
Agent production telemetry 天然帶有 cluster/dependence：

```text
User U1
├ request 1
├ request 2
└ request 3

Session S9
├ turn 1
├ turn 2
└ turn 3

MCP Server M
├ request A
├ request B
└ request C
```

同一 user 的偏好、同一 session 的 memory、同一 server 的 quota/cache、同一 GPU batch 的 load 都能產生 within-cluster correlation。

所以：

```text
10,000 trajectories
≠
10,000 independent observations
```

### 底層如何運作
對 rollout evidence，先建立 cluster key：

```text
ClusterKey
├ user_id_hash
├ session_id
├ account_id
├ shared_memory_id
├ mcp_server_id
├ rate_limit_bucket
├ gpu_pool
└ temporal_block
```

再把 evidence 分兩層：

```text
Raw Trajectory Evidence
↓
Within-Cluster Aggregator
↓
Cluster Evidence Unit
↓
Across-Cluster Sequential Evidence
```

Hermes 不應讓一個活躍使用者在短時間內產生 500 requests，就把 rollout confidence 當成多了 500 個獨立樣本。

### 工程推論
可以先使用 conservative policy：

```text
unit_of_evidence = max(
  user-session cluster,
  shared-resource cluster,
  temporal block
)
```

再逐步導入 dependence-aware calibration。

### 限制
cluster 邊界本身可能未知或重疊；multi-way clustering（user × MCP × time）不能簡化成唯一 partition。

---

## 發現 2：E-Process Validity 是相對於 Filtration，不是看到任何新資訊都自動 valid

### 論文結果
`Combining Evidence Across Filtrations` 的核心是：

若：

```text
G_t ⊂ F_t
```

一個在 coarse filtration `G` 下 valid 的 e-process，並不代表 experimenter 在 fine filtration `F` 中根據更多資訊決定 stopping 時，它仍可原封不動視為 valid。

### 對 Hermes 的直接映射
Hermes 同時有：

```text
F_user      = user/session evidence
F_shadow    = shadow trajectory evidence
F_live      = real side-effect evidence
F_resource  = MCP/GPU/DB telemetry
F_security  = policy/taint evidence
F_full      = all runtime telemetry
```

不能做：

```text
E_total = E_user × E_shadow × E_live × E_resource
```

然後假設一定 valid。

應建立：

```text
EvidenceStream
├ null_hypothesis
├ filtration_id
├ observable_fields
├ stopping_scope
├ calibration_source
└ validity_domain
```

如果 evidence 是在較粗 filtration 建立，但 rollout gate 使用更細的資訊決定停止，就需要：

```text
Coarse E-Process
↓
Filtration Adjuster / Lifting
↓
Fine-Filtration-Compatible Evidence
↓
Combine
```

### 新否定關係

```text
E-Value Valid Alone
≠
Arbitrarily Combinable With Every Evidence Stream
```

### 為什麼重要
Hermes 未來會同時有 safety verifier、quality verifier、effect checker、tool drift monitor、resource monitor。若全部自行產生 evidence，但沒有 information-boundary metadata，會形成「每個 component 都 valid、組起來卻不 valid」的系統性錯誤。

---

## 發現 3：Shadow→Live 不是單純 Bias Correction，而是 Intervention-Domain Transfer

### 已確認工程事實
Shadow path 通常：

```text
Same Request
↓
Candidate Agent
↓
Tool planning
↓
SIDE EFFECT SUPPRESSED
↓
Offline verifier
```

Live canary 則：

```text
Same Request Distribution
↓
Candidate Agent
↓
REAL tool / MCP / DB / external API effects
↓
World changes
↓
Future observations change
```

所以 shadow 與 live 的 structural equations 不完全相同。

### 關鍵機制
可把 domain 定義成：

```text
D_shadow:
  effect_externalization = 0

D_live:
  effect_externalization = 1
```

因此要學的是：

```text
P(Y_live | X, AgentVersion)
```

而 shadow 只直接給：

```text
P(Y_shadow | X, AgentVersion)
```

Hermes 需要一個 `ShadowToLiveCalibrationModel`：

```text
Shadow paired delta
+
Small live canary observations
+
Exposure vector
+
Effect class
↓
Calibration mapping
↓
Predicted Live Risk / Quality
```

建議依 Effect Type 分層：

```text
PURE / READ_ONLY
    shadow→live gap small

BUFFERABLE_WRITE
    medium

EXTERNAL / COMPENSATABLE
    larger

IRREVERSIBLE / PHYSICAL
    shadow evidence insufficient alone
```

### 新否定關係

```text
Shadow Pairing ≠ Counterfactual Live Outcome
```

Shadow 是低風險 proxy，不是真正 live counterfactual。

### 實作建議
建立：

```text
ShadowLiveGap
├ metric
├ effect_class
├ exposure_bin
├ cohort
├ stable_version
├ candidate_version
├ mean_gap
├ uncertainty
└ drift_timestamp
```

這份 gap 本身也要持續 recertify。

---

## 發現 4：Interference Graph 應由 Shared-Resource Graph 當 Prior，再用 Spillover Evidence 修正

### 問題
Hermes 可以從 runtime 直接知道一些 structural relations：

```text
Agent A → MCP Server X
Agent B → MCP Server X
Agent C → Memory Store Y
```

但：

```text
Shares Resource
≠
Has Causal Spillover
```

例如兩個 Agent 共用同一 DB，若 capacity 遠未達上限，可能沒有可測量 spillover；反之兩個表面不共用 service 的 Agent，可能透過 hidden rate-limit bucket 或 shared model provider 發生干擾。

### 本輪架構
先建立 `CandidateInterferenceGraph`：

```text
Node
├ AgentExecution
├ MCPServer
├ MemoryStore
├ DB
├ Queue
├ GPU Pool
├ Provider Account
└ External Resource

Edge prior
├ SHARES_RESOURCE
├ SAME_ACCOUNT
├ SAME_QUOTA_BUCKET
├ SAME_SESSION
├ SAME_MEMORY
└ SAME_TIME_BLOCK
```

再收集 observational spillover signature：

```text
Canary exposure on node j ↑
↓
Stable outcome on node i changes
```

接著做 targeted probe：

```text
hold input/task constant
change only candidate exposure on resource R
↓
measure stable neighbor outcomes
↓
posterior edge probability update
```

可以得到：

```text
P(j → i spillover | telemetry, interventions)
```

### 論文對應
CauGramer 提醒 interference mapping 不應硬編碼等同 observed network；Adaptive Policy Learning Under Unknown Network Interference 進一步把 graph discovery 和 adaptive treatment allocation放在一起。

### 限制
純 observational correlation 很容易把 common load spike 誤判成 spillover edge；需要 controlled perturbation / natural experiment / instrumental variation。

---

## 發現 5：真正的 Rollout Unit 應從 Request 升級為 Exposure Cluster

如果：

```text
Request A (canary)
↓
MCP quota consumption
↓
Request B (stable) latency↑
```

那麼 Request B 雖然 treatment label 是 `stable`，它實際已經受到 canary exposure。

所以 treatment representation 應從：

```text
T_i ∈ {stable, canary}
```

升級成：

```text
ExposureState_i =
(
  own_variant,
  neighbor_canary_fraction,
  shared_resource_load,
  queue_depth,
  memory_version,
  quota_state,
  temporal_regime
)
```

結果模型：

```text
Y_i = f(X_i, T_i, ExposureState_i)
```

### 對 Certificate 的影響
上一輪的 `ExposureScopedCertificate` 應再加 cluster / dependence metadata：

```text
DependentExposureCertificate
├ agent_version
├ traffic_range
├ cluster_definition
├ temporal_block_size
├ interference_graph_version
├ exposure_mapping_version
├ supported_resource_load_range
├ shadow_live_calibration_version
├ evidence_filtration
├ sequential_method
├ confidence / evidence state
└ invalidation_conditions
```

### 重要結論

```text
Stable Request
≠
Unexposed Request
```

這是 production Agent causal evaluation 很容易犯的分類錯誤。

---

# 3. Architecture Breakdown

本輪提出：

# Dependency-Aware Sequential Rollout Runtime

```text
Incoming Request
↓
Assignment Router
├ Stable
├ Canary
└ Shadow
↓
Execution Identity
↓
Cluster Resolver
├ user/session
├ account
├ memory
├ MCP server
├ quota bucket
├ GPU pool
└ time block
↓
Exposure Mapper
↓
Agent Runtime
├ Context
├ Reasoning
├ Planning
├ Memory
├ Tools / MCP
└ Model Runtime
↓
Trajectory + Effect + Resource Telemetry
↓
Evidence Partition
├ user/session stream
├ shadow stream
├ live stream
├ resource stream
└ security stream
↓
Filtration Registry
↓
Within-Cluster Evidence Aggregator
↓
Filtration Adjust / Lift
↓
Across-Cluster Sequential Evidence
↓
Shadow→Live Calibration
↓
Interference Graph Learner
↓
Exposure-Aware Causal Comparator
↓
Rollout Gate
├ CONTINUE
├ PROMOTE
├ HOLD
├ ROLLBACK
├ QUARANTINE
└ TARGETED PROBE
↓
Dependent Exposure Certificate Registry
```

### 為什麼這比上一輪更完整

上一輪的 `Sequential Evidence Engine` 暫時把 incoming observations 看成相對乾淨的 stream。

本輪加上：

```text
Observation
↓
Who/what is it dependent with?
↓
Which information filtration produced it?
↓
Is it shadow or live domain?
↓
Which neighboring executions may it influence?
↓
Then update evidence
```

也就是證據在進入 sequential test 前，要先通過 **Dependency / Filtration / Domain / Exposure normalization**。

---

# 4. Bottom-Level Logic

## 4.1 Clustered evidence

最簡化版本：

```text
trajectory scores s_1 ... s_n
↓
partition by cluster c
↓
aggregate each cluster → z_c
↓
sequential process over z_1, z_2, ...
```

不要直接：

```text
for every request:
    E *= likelihood_ratio(request)
```

如果 requests 在同 session 高度 correlated，這會把重複訊息當成新證據。

---

## 4.2 Multi-way dependence

真實 Agent telemetry 常同時屬於多個 cluster：

```text
request r
├ user U
├ session S
├ MCP M
├ GPU G
└ minute block T
```

所以 Hermes 需要保留 multi-membership，而不是只選一個 cluster id。

工程第一版可用 conservative blocker：只要兩個 execution 共享高風險 resource，就不能當成完全獨立 evidence units。

---

## 4.3 Filtration-aware evidence composition

定義：

```text
EvidenceProcess EP
├ null
├ filtration F
├ observable_schema
├ update_rule
└ stopping_validity
```

若：

```text
EP_shadow valid under F_shadow
```

但 rollout policy 在：

```text
F_full = F_shadow + live + resource + security
```

上 adaptive stopping，就不能無條件假設 `EP_shadow` 在 F_full 中同樣 valid。

需要 adjust/lift 或重新建構 full-filtration process。

---

## 4.4 Shadow-to-live calibration

設：

```text
Δ_shadow(x) = candidate_shadow(x) - stable_shadow(x)
Δ_live(x)   = candidate_live(x)   - stable_live(x)
```

需要學：

```text
Gap(x,e) = Δ_live - Δ_shadow
```

其中 `e` 是 exposure / effect context。

最值得先做的是分層 calibration：

```text
Gap ~ effect_class
    + concurrency_bin
    + MCP_load_bin
    + cohort
    + tool_family
```

避免假設一個全域常數 bias。

---

## 4.5 Unknown interference graph posterior

建立 candidate edge：

```text
j --shares R--> i
```

prior：

```text
P(j→i) = p0(resource_type, topology, load)
```

observational update：

```text
canary_exposure_j changes
stable_outcome_i changes
```

intervention update：

```text
do(exposure_j = high/low)
while holding task mix approximately fixed
```

最後維護：

```text
InterferenceEdge
├ source
├ target
├ mediator_resource
├ posterior_probability
├ direct_or_mediated
├ lag_distribution
├ evidence_count
├ last_probe
└ validity_regime
```

---

# 5. Visual Simulation Idea

# Clustered Evidence & Interference Graph Lab

## View A — Effective Evidence

畫面顯示：

```text
Raw requests:        12,480
Unique users:         1,203
Unique sessions:      1,847
MCP resource groups:     14
Temporal blocks:         96
```

並可切換：

```text
[Raw Samples]
[Session Clusters]
[User Clusters]
[Resource Clusters]
[Effective Evidence]
```

例如：

```text
Naive evidence strength        42.8
Dependency-adjusted evidence   11.6
```

讓使用者直接看到「12,480 requests 為什麼不是 12,480 個獨立證據」。

---

## View B — Filtration Map

```text
User Evidence ──────┐
Shadow Evidence ────┼──→ F_full
Live Effects ───────┤
Resource Telemetry ─┤
Security Signals ───┘
```

點某個 evidence stream 可顯示：

```text
Valid under: F_shadow
Rollout stopping uses: F_full

⚠ REQUIRES LIFT / RECALIBRATION
```

---

## View C — Shadow→Live Transfer

```text
Metric: duplicate-effect risk

Shadow Δ      +0.01
Live Δ        +0.14
Gap           +0.13
```

再用 effect class 分解：

```text
READ_ONLY       gap 0.01
BUFFERABLE      gap 0.03
EXTERNAL_WRITE  gap 0.13
IRREVERSIBLE    insufficient evidence
```

---

## View D — Interference Graph Discovery

```text
Canary Agent A ──→ MCP-X ──→ Stable Agent B
                  │
                  └──────→ Stable Agent C
```

edge 顯示 posterior：

```text
A → B via MCP-X   0.87
A → C via MCP-X   0.31
```

按：

```text
[RUN DISAMBIGUATING PROBE]
```

系統建議：

```text
Hold request mix fixed
Increase A traffic 5% → 15%
Keep MCP-X account constant
Observe B latency/retry
Expected information gain: 0.62
Risk: LOW
```

---

# 6. Code / GitHub

## 深入：anpwu/CauGramer

Repository：
https://github.com/anpwu/CauGramer

實際目錄：

```text
CauGramer/
├ README.md
├ src/
│  ├ __init__.py
│  ├ layers.py
│  └ model.py
└ utils/
```

最值得看的核心檔案：

### `src/model.py`
`CauGramer.forward()` 實際拆成：

```text
adj + x + treatment t
↓
XREP
├ XGraphMultiHeadAttention
└ or XGraphConvolution
↓
TREP
├ TGraphMultiHeadAttention
└ or TGraphConvolution
↓
concat(Xrep, Trep, neighborAverageT)
↓
Potential Outcome Heads
├ pred_y0
└ pred_y1
↓
observed pred_y = where(t > 0, pred_y1, pred_y0)
```

程式中特別計算：

```python
neighbors = torch.sum(adj, 1)
neighborAverageT = torch.div(torch.matmul(adj, t.reshape(-1)), neighbors)
```

並把 `neighborAverageT` 與 learned X/T graph representations 串接進 outcome prediction。

這對 Hermes 的可借鏡點不是直接複製模型，而是：

```text
own treatment
+
neighbor treatment/exposure
+
node features
+
learned graph representation
→ outcome
```

這比：

```text
outcome = f(own_variant)
```

更接近 shared-resource Agent runtime。

### `src/layers.py`
值得下一輪繼續讀，因為 unknown interference representation 的 attention mechanics 主要在這層。

### 需要避免的直接套用
CauGramer 的 adjacency graph 仍然是明確輸入；Hermes production 更棘手的是：

```text
observed shared-resource graph
≠
true causal interference graph
```

所以還需要 graph posterior / active graph discovery layer。

---

# 7. Papers

## Paper 1
**Title**: Combining Evidence Across Filtrations  
**Authors**: Yo Joong Choe, Aaditya Ramdas  
**Institution**: Carnegie Mellon University / University of Chicago affiliations in publication line  
**Year**: 2026 journal publication  
**URL**: https://doi.org/10.1093/jrsssb/qkag058  
**arXiv**: https://arxiv.org/abs/2402.09698  
**Architecture / Mechanism**: e-process + adjuster + filtration lifting + adjust-then-combine  
**Contribution**: 解決不同 information filtrations 下 evidence process 合併的 validity 問題。  
**Limitations**: lift/adjust 有 evidence-growth 成本；需要 filtration 被明確建模。

## Paper 2
**Title**: Adaptive Policy Learning Under Unknown Network Interference  
**Authors**: Aidan Gleich, Eric Laber, Alexander Volfovsky  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2605.11191  
**Architecture**: Thompson sampling + posterior interference network + adaptive treatment assignment  
**Contribution**: 同時做 unknown interference graph learning 與 policy optimization。  
**Limitations**: 真實 Agent runtime 的 treatment/effect 空間比一般 network experiment 更高維、更非平穩。

## Paper 3
**Title**: Causal Graph Transformer for Treatment Effect Estimation Under Unknown Interference  
**Authors**: Anpeng Wu, Haiyi Qiu, Zhengming Chen, Zijian Li, Ruoxuan Xiong, Fei Wu, Kun Zhang  
**Venue**: ICLR 2025  
**URL**: https://proceedings.iclr.cc/paper_files/paper/2025/hash/f7397355f68fa42e5d4739c2eb9b4cf6-Abstract-Conference.html  
**Code**: https://github.com/anpwu/CauGramer  
**Architecture**: Graph Transformer + interference representation + potential outcome heads  
**Contribution**: 不需要把 observed graph 直接視為真實 interference mapping。  
**Limitations**: 並非 sequential rollout / online graph discovery system。

## Paper 4
**Title**: The Conflict Graph Design: Estimating Causal Effects under Arbitrary Neighborhood Interference  
**Authors**: Vardis Kandiros, Charilaos Pipis, Constantinos Daskalakis, Christopher Harshaw  
**Year**: 2024+  
**URL**: https://arxiv.org/abs/2411.10908  
**Architecture**: conflict graph experimental design + modified Horvitz-Thompson estimator  
**Contribution**: 讓 experiment design 顯式依賴 interference structure 與 causal estimand。  
**Limitations**: 需對 network / exposure structure 有相當程度掌握。

## Paper 5
**Title**: Causal Mediation Analysis for Network Data with Graph Neural Network  
**Authors**: Peikai Wu, Zhiguo Xiao  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2608.13274  
**Architecture**: GNN nuisance models + exposure/mediator mapping + network HAC variance  
**Contribution**: 分開 treatment spillover 與 mediator spillover，並對 network dependence 做 variance estimation。  
**Limitations**: identification 仍依賴 strengthened conditional independence / approximate neighborhood interference assumptions。

---

# 8. Unknown / Open Questions

## 1. 如何建構真正的 Cluster-Aware E-Process？
目前能確定「不能把 correlated requests 當 iid」，但 production Hermes 最終需要的是：

```text
multi-way clustered
+
time-dependent
+
adaptive assignment
+
network interference
```

下仍可計算、可校準的 sequential evidence primitive。

目前 `ClusterAwareEProcess` 仍只是設計節點，尚未有 universal implementation。

## 2. Shadow→Live Gap 是否可 transfer？
如果 gap 在版本、tool、exposure、cohort 間高度異質：

```text
Gap(v1, MCP-A, low load)
```

可能不能用於：

```text
Gap(v2, MCP-B, high load)
```

需要建立 transferability certificate，而不是全域 correction factor。

## 3. Interference Graph 如何區分 direct spillover 與 common-cause load？

```text
Canary A latency ↑
Stable B latency ↑
```

可能是：

```text
A → shared resource → B
```

也可能只是：

```text
external traffic spike → A
external traffic spike → B
```

因此 edge discovery 仍需要 controlled intervention / natural experiment / instrumentation。

---

# 9. 下一輪研究

下一個最大缺口：

# Cluster-Aware E-Processes × Markov/Temporal Dependence × Multi-Way Clustering × Dynamic Interference Graph

下一輪應研究：

```text
Raw Runtime Events
↓
Temporal Dependence Model
├ Markov
├ mixing process
├ block dependence
└ session persistence
↓
Multi-Way Cluster Graph
↓
Cluster-Level Evidence Construction
↓
Anytime-Valid Dependence-Aware Process
↓
Dynamic Interference Graph
↓
Lagged Spillover Discovery
↓
Cluster/Network-Aware Rollout Certificate
```

應優先追：

1. e-process / confidence sequence 在 dependent, Markov, mixing data 的 constructions；
2. multi-way clustered sequential testing；
3. network HAC / graph-dependent variance estimation；
4. lagged interference / dynamic spillover graph discovery；
5. Shadow→Live transferability under domain shift；
6. production usable implementation 是否存在。

---

# 10. Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Clustered Sequential Evidence
Effective Evidence Unit
Evidence Cluster
Multi-Way Cluster
Temporal Block
Filtration Registry
Evidence Filtration
Filtration Lifting
Filtration Adjuster
Shadow-Live Gap
Shadow-to-Live Calibration
Intervention Domain Transfer
Candidate Interference Graph
Causal Interference Graph
Spillover Edge
Spillover Lag
Shared-Resource Prior
Unknown Interference
Exposure Cluster
Dependent Exposure Certificate
Interference Graph Version
Calibration Transferability
```

## 新增 Edges

```text
Trajectory --BELONGS_TO→ EvidenceCluster
EvidenceCluster --SHARES→ SharedResource
EvidenceProcess --VALID_UNDER→ EvidenceFiltration
EvidenceFiltration --SUBSET_OF→ FullRuntimeFiltration
FiltrationAdjuster --LIFTS→ EvidenceProcess
ShadowOutcome --CALIBRATES_TO→ LiveOutcome
SharedResource --MEDIATES→ SpilloverEffect
CanaryExposure --INFLUENCES→ StableOutcome
InterferenceProbe --UPDATES→ SpilloverEdgePosterior
ExposureCluster --SCOPES→ BehaviorCertificate
```

## 新增重要否定關係

```text
Trajectory Count ≠ Independent Sample Size
Same Session ≠ Independent Evidence
Same User ≠ Independent Evidence
E-Process Valid Alone ≠ Arbitrarily Combinable
Shadow Pairing ≠ Live Counterfactual
Shares Resource ≠ Proven Spillover
Stable Assignment ≠ No Canary Exposure
Observed Correlation ≠ Interference Edge
Network Adjacency ≠ Causal Interference Graph
Cluster-Robust Variance ≠ Full Causal Identification
```

---

# 11. 本輪收斂回答

**缺哪一層？**  
缺 `Dependence-Aware Sequential Evidence Plane`：要同時處理 multi-way clustering、temporal dependence、adaptive stopping 與 network interference。

**哪個節點最淺？**  
`ClusterAwareEProcess`。目前已清楚知道 interface 應包含 filtration / cluster / exposure，但底層數學 construction 還沒有收斂成 Hermes 可實作 primitive。

**哪個概念仍只是名詞？**  
`DependentExposureCertificate`、`ShadowLiveTransferCertificate`、`MultiWayClusterEProcess`、`InterferenceGraphCertificate`。

**哪個系統值得讀原始碼？**  
`anpwu/CauGramer` 的 `src/layers.py` 與 `src/model.py`；下一輪要進一步拆 XGraphMultiHeadAttention / TGraphMultiHeadAttention 如何把 neighbor covariate 與 treatment exposure 編入 representation。

**哪篇論文需追引用？**  
優先：`Combining Evidence Across Filtrations` → e-process / adjuster literature；其次 `Adaptive Policy Learning Under Unknown Network Interference` → network discovery / adaptive experimentation literature。

**哪個概念最適合視覺模擬？**  
`Clustered Evidence & Interference Graph Lab`，尤其是「Raw 12,480 requests → dependency-adjusted effective evidence」與「Stable request 其實受到 Canary spillover exposure」兩個視圖。

**哪個 Agent 架構最值得實作？**

> **Dependency-Aware Sequential Rollout Runtime = Cluster Resolver + Exposure Mapper + Filtration Registry + Within-Cluster Evidence Aggregator + Filtration-Aware Sequential Evidence + Shadow→Live Calibration + Unknown Interference Graph Learner + Exposure-Aware Rollout Gate + Dependent Exposure Certificate Registry。**

---

# 12. 這輪對「AI 到底怎麼運作」補上的鏈

```text
User Request
↓
UI / Session
↓
Agent Context
↓
Reasoning / Planning
↓
Memory / Tool / MCP / Model
↓
External Effect
↓
Runtime Telemetry
↓
Cluster Resolution
↓
Exposure Mapping
↓
Sequential Evidence
↓
Interference Graph Update
↓
Shadow→Live Calibration
↓
Rollout / Safety Decision
↓
下一個 Agent Runtime Policy
```

這輪補上的核心觀念是：

> **成熟 Agent 系統不能把每一次 trajectory 都當成彼此獨立的證據。使用者、session、memory、工具、GPU、quota 與時間都會把執行串成相依網路；因此 rollout evidence 本身也必須知道「哪些資料彼此相依、它看到了哪些資訊、它屬於 shadow 還是 live 世界，以及它可能被哪些鄰居 execution 影響」。**
