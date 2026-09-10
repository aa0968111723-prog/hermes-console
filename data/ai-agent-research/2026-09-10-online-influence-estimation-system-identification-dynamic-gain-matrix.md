# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-10 21:56 Asia/Taipei

## 本輪主題
**Online Influence Estimation × Intervention-Based System Identification × Dynamic Gain Matrix × Conditional Transfer Entropy**

本輪承接上一輪 `Feedback Stability × Cyclic Risk Propagation × Spectral Radius`。上一輪已建立 SCC、EIR/ECR、error reproduction number、local spectral diagnostic 與 damping/circuit-breaker 控制；本輪專門補上上一輪最薄弱的一層：**Hermes 要如何從黑箱 LLM、Memory、Tool、MCP、VLM、Child Agent 的 runtime trace 中，實際估出「誰正在影響誰、影響多大、是否隨時間變化」的 G_t？**

---

## 本小時新發現

### 新架構：CASPIAN dynamic causal influence matrix
CASPIAN（2026）把 LLM multi-agent cascade attack 視為跨 channel 的動態 causal propagation 問題。其公開說明指出，它以 **late-interaction conditional transfer entropy (LI-CTE)** 估計 unified dynamic causal influence matrix，並在線辨識 origin、bridge、amplifier agents 與主要 propagation pathways。這直接提供上一輪 `G_t` 的一種可操作估計路徑。

### 新 bottom-level mechanism：Conditional Transfer Entropy
Schreiber 的 transfer entropy 原始定義目的，是排除 shared history / common input 後，量化一個時間序列對另一個時間序列未來狀態所提供的額外資訊。對 Hermes 而言，可把節點訊號定義為 agent-message state、tool-call state、belief delta、risk score、memory mutation、multimodal observation embedding 等，再估：

`TE(X→Y) = I(X_past ; Y_future | Y_past)`

而 conditional TE 再額外 conditioning 其他共同來源 Z，降低把 common-cause 誤判成 direct influence 的風險。

### 新系統辨識路線：SINDy / sparse dynamics identification
PySINDy 將 system identification 建模成：從 measurement data 推回 governing dynamics。其核心 package 已分成 `_core.py`、`differentiation/`、`feature_library/`、`optimizers/` 等層；這表示 Hermes 可借鑑「先抽狀態變數 → 建 candidate interaction library → sparse regression → 得到可解釋 dynamics」的工程結構，而不必只靠 LLM judge 猜 influence。

### 新因果區分：Predictive Influence ≠ Interventional Effect
Granger causality / transfer entropy 都屬 observation-based time-directed dependence。即使 X 有助預測 Y，也不能直接等價於 `do(X=x)` 對 Y 的真實 causal effect。2026 的 interventional dynamical causality 工作也明確區分 constructive/observational dynamical causality 與 intervention-oriented causal effect。因此 Hermes 必須把 influence 分成至少兩級：`observational influence` 與 `intervention-validated influence`。

### 新 runtime 策略：Passive Estimate → Active Probe → Counterfactual Replay
本輪提出 Hermes 的分層估計：先用 production trace 被動估 influence；只對高不確定、critical edge 執行 sandbox perturbation / replay intervention，再更新 edge confidence。如此可避免對 production 直接做危險探索。

---

# 本小時最重要 5 個發現

## 1. Dynamic Gain Matrix 可以由 runtime trace 估，而不是只能手工指定

### 是什麼
上一輪的 `G_t[i,j]` 只是抽象 influence coefficient；本輪得到第一條具體實作路徑：把 runtime interaction 切成 time-indexed channels，再以 conditional transfer entropy / predictive influence 估算有向 edge。

### 底層如何運作

```text
Runtime Event Stream
↓
Channelization
├ agent_message[A]
├ agent_message[B]
├ tool_result[T]
├ memory_delta[M]
├ belief_delta[BELIEF]
├ risk_signal[R]
└ multimodal_observation[V]
↓
Temporal Windowing
↓
Condition on target history
↓
Condition on known common parents
↓
Estimate additional predictive information
↓
Dynamic Influence Weight G_t[i,j]
↓
Confidence / significance / sample support
```

形式上：

```text
G_t[i,j] ≈ CTE(X_j,past → X_i,future | X_i,past, Z_common)
```

### 為什麼重要
它讓「Agent A 好像影響 Agent B」變成可測的 time-varying signal，之後才能做 SCC gain、cascade onset、bridge agent、amplifier agent 與 damping control。

### 限制
CTE 仍是 observational dependence；conditioning set 不完整時仍可能受 latent common cause 影響。

### 狀態
- 已確認事實：CASPIAN 採 dynamic causal influence matrix + LI-CTE。
- 工程推論：Hermes 可把不同 runtime channel 映射為同類矩陣。
- 尚未驗證：哪一種 discretization / embedding 對 Hermes trace 最穩定。

---

## 2. Transfer Entropy 比單純 correlation 更適合 feedback Agent，但仍不等於 do-causality

### 底層

```text
Correlation:
X_t ↔ Y_t
```

只看共變。

```text
Transfer Entropy:
Y_past
vs
(Y_past + X_past)
→ X 是否降低 Y_future uncertainty？
```

Schreiber 2000 特別指出，time-delayed mutual information 無法排除 shared history / common inputs，而 transfer entropy 透過 conditional transition probabilities 處理這點。

對 Gaussian variables，Granger causality 與 transfer entropy 有正式等價關係；但在 nonlinear / non-Gaussian Agent trace 中，兩者不必等價。

### Hermes 意義
`Planner → Tool`、`Tool → Observation`、`Observation → Memory`、`Memory → Planner` 都是時間導向，因此 time-directed information flow 比 static similarity 更貼近 Agent loop。

### 限制
- finite sample bias
- nonstationarity
- irregular event timing
- high-dimensional embeddings
- hidden confounders
- tool retries 造成 duplicated temporal signal

---

## 3. 真正可部署的 influence estimator 應是 Hybrid，而不是單一方法

本輪比較四種估計器：

| 方法 | 能回答 | 優點 | 主要限制 |
|---|---|---|---|
| Finite-difference intervention | 改 X 後 Y 變多少 | 接近真正 intervention | 成本高、production 危險 |
| Counterfactual replay | 同 history 改一個節點後 downstream 差異 | 可定位 causal blast radius | 依賴 digital twin / replay fidelity |
| Transfer entropy / CTE | X 是否提供 Y future 額外資訊 | model-free、適合 online | observation ≠ intervention |
| Sparse system identification / SINDy | 哪些 interaction term 可解釋 dynamics | 可解釋、可得到方程 | state representation 很關鍵 |

因此建議：

```text
Passive Monitor
→ TE / CTE / predictive estimator
↓
High-confidence benign edge
→ keep monitoring

High-impact uncertain edge
→ Counterfactual Replay
↓
Still ambiguous + sandbox available
→ Controlled Perturbation
↓
Update Interventional Edge Posterior
```

重要否定關係：

```text
Predictive Influence ≠ Interventional Effect
```

---

## 4. G_t 必須有 confidence、provenance 與 decay，不能只是一個 float

本輪新增 runtime object：

```text
InfluenceEdgeEstimate
├ source_node
├ target_node
├ channel
├ window_start
├ window_end
├ estimator_type
├ influence_value
├ direction
├ lag
├ confidence
├ sample_count
├ conditioning_set[]
├ evidence_roots[]
├ intervention_id?
├ counterfactual_support?
├ distribution_state
└ decay_rate
```

原因是 Agent 系統 time-varying：prompt 更新、模型切換、tool version、memory mutation、MCP latency 都會改變 influence。

所以：

```text
G_t ≠ G_{t+1000}
```

甚至同一 edge：

```text
Planner → Tool
```

在正常模式與攻擊模式下，gain 可能完全不同。

### 重要推論
Spectral analysis 應使用 `G_t` 或 local-window `G_[t-k:t]`，而不是永久靜態矩陣。

---

## 5. Online system identification 必須服務「控制」，不是只做漂亮圖

PySINDy 對 system identification 的定義是由 measurement data 推估 governing dynamics，並可用於 prediction、control 與 theoretical analysis。這對 Hermes 很關鍵：如果估 influence 最後只畫圖，價值有限；真正 runtime 需要把 identification 接回 controller。

```text
Trace
→ Influence Estimator
→ Dynamic G_t
→ SCC / spectral / reproduction analysis
→ Controller
   ├ damp edge
   ├ add verifier
   ├ reduce retry
   ├ freeze memory write
   ├ isolate child agent
   ├ reroute tool
   └ circuit-break
→ New Trace
→ Re-identify G_{t+1}
```

這本身又形成另一個閉環：

```text
Identify → Control → Observe → Re-identify
```

因此 Hermes 最終不是 static safety graph，而是 adaptive control runtime。

---

# Architecture Breakdown

## Online Causal Influence Identification Plane

```text
UI / User / Camera / Voice
↓
Agent Runtime
├ Planner
├ Reasoner
├ Memory
├ Context Manager
├ Child Agents
├ Model Router
├ Tool Router
└ MCP Runtime
↓
Unified Runtime Trace Bus
↓
Temporal Channelizer
├ messages
├ observations
├ tool calls
├ tool results
├ memory mutations
├ belief changes
├ artifact changes
├ risk events
└ multimodal embeddings
↓
Influence Estimator Ensemble
├ Conditional Transfer Entropy
├ Granger-style predictor
├ Sparse System ID / SINDy
├ Counterfactual Replay
└ Controlled Intervention
↓
Influence Fusion / Confidence
↓
Dynamic Gain Matrix G_t
↓
Graph Analyzer
├ SCC
├ bridge
├ amplifier
├ propagation spine
├ spectral proxy
└ R_error
↓
Adaptive Stability Controller
├ damp
├ verify
├ rewire
├ isolate
├ rollback
└ circuit-break
↓
Runtime
↺
```

### System architecture 深入拆解：CASPIAN
CASPIAN 的核心概念鏈可拆成：

```text
Multi-Agent Interaction
↓
Cross-channel signals
↓
Late-interaction representation
↓
Conditional Transfer Entropy
↓
Dynamic Causal Influence Matrix
↓
Cascade Structural Signal
↓
Online Detection
↓
Attribution
├ origin agent
├ bridge agent
├ amplifier agent
└ principal propagation path
```

公開 README 顯示其 benchmark/evaluation 設計涵蓋 AutoGen、CrewAI、MetaGPT、LLMDebate，並以 detection 與 attribution metrics 評估。但截至本輪檢查，公開 GitHub 根目錄只有 `LICENSE`、`README.md`、`images/`，尚未提供 README 所描述的 experiments/eval/configs 原始碼，因此目前只能確認架構與宣稱，不能完整 code-level reproduction。這一點必須明列為 reproducibility limitation。

---

# Bottom-Level Logic

## Mechanism A：Conditional Transfer Entropy

對兩個 runtime process X、Y：

```text
1. 收集 X/Y time series
2. 決定 lag / history length
3. 建 Y_future
4. 建 Y_past
5. 建 X_past
6. 加入 conditioning variables Z
7. 估 H(Y_future | Y_past, Z)
8. 估 H(Y_future | Y_past, X_past, Z)
9. 相減得到 conditional information transfer
10. significance / bootstrap / permutation test
11. 寫入 G_t[X→Y]
```

概念式：

```text
CTE(X→Y | Z)
=
H(Y_future | Y_past, Z)
-
H(Y_future | Y_past, X_past, Z)
```

如果加入 X 的過去能明顯降低 Y 未來 uncertainty，就得到正向 predictive influence。

## Mechanism B：Intervention-Based Finite Difference

對 critical edge X→Y：

```text
Baseline Replay
X = x
→ Y = y

Intervention Replay
X = x + δ
→ Y = y'

Local Influence
≈ ΔY / ΔX
```

對離散 Agent state 可改成：

```text
remove message M17
replace observation O9
freeze memory write
change tool result
change child-agent output
```

再比較 downstream canonical state delta。

## Mechanism C：Sparse System Identification

```text
Runtime State X(t)
↓
Estimate dX/dt or ΔX
↓
Feature Library Θ(X)
├ X_i
├ X_i X_j
├ nonlinear terms
├ lagged edges
└ control inputs
↓
Sparse Optimizer
↓
Ξ
↓
Learned Dynamics
ΔX ≈ Θ(X)Ξ
```

其價值是得到比 dense neural predictor 更容易讀的 coupling structure；但 Agent state 的離散/語義性意味著不能原封不動套 SINDy，需做 event-state representation。

---

# Visual Simulation Idea

## Dynamic Influence & System Identification Lab

左側顯示 live Agent loop：

```text
Camera ─→ VLM ─→ Planner ─→ Agent B ─→ Tool
              ↑         ↓                 ↓
              └── Memory ← Observation ←─┘
```

每條 edge 顯示：

```text
Planner → Agent B
CTE            0.42
Intervention   0.31
Confidence     0.87
Lag            2 events
Samples        1,284
Status         AMPLIFIER
```

時間軸可拖動：

```text
21:00  ρ(G)=0.71
21:10  ρ(G)=0.92
21:20  ρ(G)=1.08
21:24  cascade detected
```

使用者可點某條 edge 執行：

```text
COUNTERFACTUAL REMOVE
PERTURB +5%
FREEZE MEMORY
BLOCK MESSAGE
ADD VERIFIER
```

然後即時比較：

```text
Observed G_t
vs
Intervened G_t'
```

最具教育價值的畫面：

```text
A → B  TE HIGH
```

但當 conditioning common root C 後：

```text
A → B  CTE ≈ 0
C → A  HIGH
C → B  HIGH
```

UI 顯示：

**Apparent influence was common-cause contamination.**

這會直接把「相關 ≠ 因果」視覺化。

---

# Code / GitHub

## 1. CASPIAN
Repository: `caspian-detector/caspian`

目前公開根目錄：

```text
LICENSE
README.md
images/
```

README 描述但目前未公開在 root tree 的預期模組包括：

```text
experiments.run_matrix
eval.detection_eval
eval.generate_attribution_gt
eval.attribution_eval
configs/model.yaml
```

值得追蹤：若後續釋出 code，優先讀：
1. LI-CTE estimator
2. channel representation
3. dynamic influence matrix update
4. cascade onset detector
5. attribution / spine extraction
6. online windowing與latency optimization

## 2. PySINDy
Repository: `dynamicslab/pysindy`

已確認核心：

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

最值得 Hermes 讀：
- `pysindy/_core.py`：fit / predict / simulate 的主系統辨識 orchestration
- `pysindy/differentiation/`：從 noisy measurements 建 derivative
- `pysindy/feature_library/`：candidate dynamics terms
- `pysindy/optimizers/`：sparse coefficient estimation

Hermes 對應：

```text
measurement
→ Runtime Trace

differentiation
→ State Delta Extractor

feature library
→ Candidate Influence Library

optimizer
→ Sparse Dynamic Gain Estimator
```

---

# Papers

## 1. CASPIAN: Online Detection and Attribution of Cascade Attacks in LLM Multi-Agent Systems via Cross-Channel Causal Monitoring
- Authors: Kavana Venkatesh, Jafar Isbarov, Saad Amin, Murat Kantarcioglu, Jiaming Cui
- Institution: Virginia Tech
- Year: 2026
- URL: arXiv:2605.19240
- Code: https://github.com/caspian-detector/caspian/ （目前公開內容有限）
- Dataset/Benchmark: README 描述 TAMAS、ACIArena，並跨 AutoGen/CrewAI/MetaGPT/LLMDebate
- Architecture: cross-channel monitoring → LI-CTE → dynamic causal influence matrix → online cascade detection + attribution
- Contribution: 將多代理 cascade 從 local anomaly 提升成 dynamic system-level causal influence monitoring
- Limitations: 目前 GitHub code 不完整公開；從 paper/README 能確認架構但不能完整 code-level reproduction
- 改變了什麼: 為 Hermes `G_t` 提供第一個直接面向 LLM MAS 的 online estimation precedent

## 2. Measuring Information Transfer
- Author: Thomas Schreiber
- Institution: Max Planck Institute for the Physics of Complex Systems
- Year: 2000
- Venue: Physical Review Letters 85, 461
- Architecture/Mechanism: conditional transition probability → transfer entropy
- Contribution: 將 shared history/common input 與 time-directed information transfer 分離
- Limitation: observational information flow 不自動等於 interventional causal effect；finite-sample estimation 有偏差
- 改變了什麼: 奠定 CASPIAN 類 information-flow estimator 的底層理論

## 3. Granger Causality and Transfer Entropy Are Equivalent for Gaussian Variables
- Authors: Lionel Barnett, Adam B. Barrett, Anil K. Seth
- Institution: University of Sussex
- Year: 2009
- Contribution: 證明 Gaussian case 下 Granger causality 與 transfer entropy 等價
- Limitation: Hermes runtime 多數是 nonlinear / discrete / non-Gaussian / nonstationary，因此不可直接外推
- 改變了什麼: 建立 predictive system-ID 與 information-theoretic influence 的橋樑

## 4. An Interpretable Temporal Convolutional Framework for Granger Causality Analysis
- Authors: Aoxiang Dong, Andrew Starr, Yifan Zhao
- Institution: Cranfield University 等
- Year: 2026
- Venue: IEEE/CAA Journal of Automatica Sinica 13(3):665-679
- Architecture: temporal convolutional network based end-to-end Granger detection with interpretable time-delay estimation
- Contribution: 改善 nonlinear/high-dimensional GC 中 time-delay estimation 問題
- Limitation: 仍是 predictive causality family，不是 intervention guarantee
- 改變了什麼: 提示 Hermes edge estimator 必須估 lag，而非只估 weight

## 5. Deciphering interventional dynamical causality from non-intervention complex systems
- Authors: Jifan Shi et al.
- Institutions: Fudan University、University of Tokyo 等
- Year: 2026
- Contribution: 明確區分 constructive dynamical causality 與 interventional dynamical causality，提出 interventional embedding entropy
- Limitation: 尚需驗證對 event-driven LLM agent runtime 是否有效
- 改變了什麼: 強化 Hermes 必須把 observational influence 與 intervention-validated effect 分層保存

## 6. Discovering governing equations from data by sparse identification of nonlinear dynamical systems / PySINDy lineage
- Authors: Steven L. Brunton, Joshua L. Proctor, J. Nathan Kutz
- Institution: University of Washington
- Year: 2016
- Architecture: state measurements → candidate function library Θ(X) → sparse regression → governing equation coefficients Ξ
- Code ecosystem: dynamicslab/pysindy
- Contribution: 從 data recover sparse interpretable dynamics
- Limitation: 原始形式假設連續數值狀態；LLM Agent event graph 需自訂離散/embedding state representation
- 改變了什麼: 為 Hermes 提供從「edge detection」走向「整體 dynamics equation identification」的方向

---

# 與歷史研究比較：避免重複

上一輪已回答：

```text
有 feedback loop 時怎麼判斷可能放大？
→ SCC / EIR-ECR / R_error / spectral radius proxy
```

本輪新增回答：

```text
那些 loop edge 的 gain 從哪裡來？
→ passive temporal influence
→ conditional transfer entropy
→ sparse system ID
→ counterfactual replay
→ controlled intervention
```

因此沒有重複上一輪 spectral theory，而是補上 measurement / identification plane。

---

# Unknown / Open Questions

## 1. 怎麼把語義事件轉成穩定 numerical state？
LLM message、Memory summary、Tool result、Image embedding 都是高維且 schema 不同。若 representation 改變，G_t 可能跟著改變。

## 2. 怎麼在 nonstationary runtime 中選 window / lag？
過長 window 會掩蓋 sudden cascade；過短 window 則 estimator variance 太高。

## 3. 怎麼安全取得真正 interventional signal？
Production 不能隨便 perturb Agent/Tool；因此必須和前幾輪建立的 shadow runtime、effect virtualization、counterfactual digital twin、deterministic replay 結合。

---

# 下一輪研究

下一輪應進入：

## **Event Representation × State-Space Compression × Semantic Channelization × Lag Discovery**

核心問題：

```text
Raw Agent Trace
├ tokens
├ messages
├ tool arguments
├ observations
├ images
├ audio
├ memory writes
├ graph mutations
└ GPU/model telemetry
```

不能直接丟入 system identification。

必須先建立：

```text
Raw Trace
↓
Canonical Event Schema
↓
Semantic Channelizer
↓
State Vector / State Graph
↓
Temporal Alignment
↓
Lag Discovery
↓
Influence Estimation
```

下一輪應研究：
- event embedding vs symbolic state
- change-point detection
- irregular-time event alignment
- temporal point processes
- lag discovery
- state-space models
- Koopman representations
- representation drift
- multimodal synchronization
- GPU/model-runtime telemetry 與 agent-level event 對齊

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Online Influence Estimation
System Identification Plane
Dynamic Gain Matrix G_t
InfluenceEdgeEstimate
Transfer Entropy
Conditional Transfer Entropy
Late-Interaction CTE
Predictive Influence
Interventional Influence
Influence Confidence
Influence Lag
Temporal Channel
Runtime Channelizer
Sparse System Identification
Candidate Influence Library
Counterfactual Edge Probe
Controlled Perturbation
Intervention-Validated Edge
Bridge Agent
Amplifier Agent
Propagation Spine
Influence Decay
Nonstationary Gain
```

## 新增 Edges

```text
Runtime Trace
→ channelized_into
Temporal Channel

Temporal Channel
→ estimated_by
Conditional Transfer Entropy

Conditional Transfer Entropy
→ updates
Dynamic Gain Matrix

Dynamic Gain Matrix
→ analyzed_by
Feedback Stability Monitor

Counterfactual Replay
→ validates
Predictive Influence

Controlled Intervention
→ strengthens_evidence_for
Interventional Influence

SINDy-style Identification
→ estimates
Sparse Dynamic Model

Influence Lag
→ parameterizes
Dynamic Edge
```

## 新增否定關係

```text
Correlation ≠ Directed Influence
Directed Predictive Influence ≠ Interventional Causality
Transfer Entropy ≠ Full Causal Proof
Static Edge Weight ≠ Dynamic Gain
High CTE ≠ Safe To Intervene
SCC Edge ≠ Measured Gain
Spectral Radius ≠ Useful Without Identified G_t
LLM Judge Score ≠ System Identification
More Runtime Events ≠ Better Estimate
Shared Timing ≠ Direct Causation
```

---

# 本輪結束回答

- **缺哪一層：** Event Representation / Semantic Channelization / temporal alignment。
- **哪個節點最淺：** `Dynamic Gain Matrix G_t` 在高維 multimodal runtime 下的 representation robustness。
- **哪個概念仍只是名詞：** Unified Agent System Identification ABI、cross-modal influence unit、intervention-safe probe policy。
- **哪個系統值得讀原始碼：** PySINDy `_core.py`、`differentiation/`、`feature_library/`、`optimizers/`；CASPIAN 若後續釋出 estimator code，優先追 LI-CTE 與 dynamic matrix update。
- **哪篇論文需追引用：** CASPIAN 2026、Schreiber 2000 Transfer Entropy、Barnett et al. 2009、Interventional Dynamical Causality 2026、SINDy 2016。
- **哪個概念最適合視覺模擬：** Dynamic Influence & System Identification Lab。
- **哪個 Agent 架構最值得實作：** **Adaptive Identified Agent Runtime = Unified Trace Bus + Semantic Channelizer + Conditional Transfer Entropy + Sparse System ID + Counterfactual Probe + Dynamic Gain Matrix + Stability Controller**。

最核心的新進展：

> 上一輪我們知道「Agent 是一個 feedback system」；本輪開始解決更困難的工程問題——**不是先假設 Agent graph 上的 influence weight，而是從 Agent 真正在 runtime 中產生的 messages、memory mutations、tool observations、multimodal evidence 與 actions，線上辨識出一個會隨時間改變的動態系統模型，再用介入與 counterfactual replay 去確認哪些 influence 真的是 causal。**
