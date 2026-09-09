# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-10 06:55 Asia/Taipei

## 本輪主題
Unified Speculation Budget × Admission Control × Tail Prediction × Backpressure × Resource Amplification × Branch Externality

## 與歷史研究比較

上一輪已建立：Speculative Group → Candidate Validation → Atomic Winner Commit → Loser Cancellation → Late Loser Suppression。本輪不重複 winner/loser correctness，而專注下一個 production 缺口：當 model hedge、tool speculation、RAG prefetch、sandbox prewarm、multi-agent branch、GPU generation 同時發生時，如何避免「每一層都局部合理、全系統卻資源爆炸」。

歷史節點：
- Speculative Execution
- Hedged Execution
- Winner Commit Gate
- Effect-Aware Speculation
- Late Result Fencing

本輪新增中心問題：

```text
Local Speculation Benefit
≠
Global Speculation Benefit
```

以及：

```text
2× model hedge
× 2× tool hedge
× 3× branch width
× 2× GPU candidate
= 24× potential work amplification
```

---

## 本小時新發現

### 新架構：TAPER — Per-step Branch Admission

論文：Regulating Branch Parallelism in LLM Serving（Swapnil Gandhi, Siva Hari, William J. Dally, Christos Kozyrakis, Stanford, 2026）
URL: https://arxiv.org/abs/2605.06914

TAPER 不把 branch parallelism 當固定寬度，而將額外 branch 視為 opportunistic work。核心概念是 branch externality：新增 branch 雖然可能加速自己的 request，但會拉長 shared decode step，傷害同 batch 其他 request。TAPER 依 batch composition、context length、累積 slack，每一個 decoding step 都重新判斷是否允許增加 branch。

論文結果：Qwen3-32B 上相對 IRP-Off goodput 1.77×、相對 IRP-Eager 1.48×，SLO attainment 維持 >95%。這是論文特定 workload / model 結果，不能泛化成所有 serving 系統。

### 新架構：AOSpec — Action/Observation Co-Speculation

論文：AOSpec: Action and Observation Co-Speculation for Low-Latency Agent Serving（Hao Mark Chen, Jinnan Guo, Wayne Luk, Hongxiang Fan, 2026）
URL: https://arxiv.org/abs/2608.00881

AOSpec 將 speculation 從「猜下一個 action」推進到 action + observation。Expected Value Decoding 不是最大化 prediction hit-rate，而是優先猜能隱藏最多 latency 的 observation；對只有真正執行才能得到的 outcome，先在 isolated fork 中執行，再用 Joint Action-State Verification 同時驗證 action 與它起源的 state。

論文報告：Terminal-Bench serving settings 下 mean E2E latency 降低 11.8–32.5%，p99 最高降低 42.8%。

### 新底層：Adaptive Concurrency ≠ Fixed Rate Limit

Netflix concurrency-limits：
https://github.com/Netflix/concurrency-limits

值得讀核心檔：
- concurrency-limits-core/src/main/java/com/netflix/concurrency/limits/limit/Gradient2Limit.java
- concurrency-limits-core/src/main/java/com/netflix/concurrency/limits/limit/VegasLimit.java
- concurrency-limits-core/src/main/java/com/netflix/concurrency/limits/limiter/AbstractLimiter.java

Gradient2 不是限制 RPS，而以 current RTT 相對 long-term RTT 的 gradient 判斷 queue 是否正在形成，再調整 concurrency window。其核心近似：

```text
gradient = clamp(longRtt / currentRtt, 0.5, 1.0)
newLimit = gradient × currentLimit + queueAllowance
smoothed = old × (1-s) + new × s
```

這對 Agent 很重要：speculation admission 的資源單位應更接近「同時在飛的昂貴工作」，而不是單純 requests/sec。

### 新工程實作：Envoy Adaptive Concurrency

核心原始碼：
- source/extensions/filters/http/adaptive_concurrency/controller/gradient_controller.cc
- source/extensions/filters/http/adaptive_concurrency/controller/gradient_controller.h
- api/envoy/extensions/filters/http/adaptive_concurrency/v3/adaptive_concurrency.proto
- test/extensions/filters/http/adaptive_concurrency/controller/gradient_controller_test.cc

Envoy 已將 minRTT sampling、RTT buffer、concurrency update interval、max/min concurrency 做成 production filter；超出限制可回 503。這提供 Hermes Admission Gate 的實作參考。

### 新研究：Speculate with Memory

論文：Speculate with Memory: Lossless Acceleration for LLM Agents（Yu Li et al., 2026）
URL: https://arxiv.org/abs/2607.12236

其 transition table、episodic memory、confusion tracker 顯示 speculation probability 本身可以在線學習，不應永遠是固定 rule；但本輪進一步提出：prediction confidence 只能決定「值得候選」，不能單獨決定「值得花資源」。後者必須與 budget / queue / deadline / externality 聯合判斷。

---

## 本小時最重要 5 個發現

### 1. Speculation Admission 應以 Expected Net Value 為核心

**已確認事實**：TAPER 以 predicted branch externality 與 slack budget 做 per-step admission；AOSpec 以 expected latency benefit 決定 observation speculation 優先度。

Hermes 工程模型：

```text
ExpectedNetValue(c) =
    P(useful_c) × LatencySaved_c × SLAWeight
  - ComputeCost_c
  - MemoryCost_c
  - QueueExternality_c
  - VerificationCost_c
  - CancellationWaste_c
  - EffectRisk_c
```

Admission：

```text
ExpectedNetValue > 0
AND BudgetAvailable
AND EffectPolicyAllows
AND DeadlineSlackAllows
→ ADMIT
```

限制：各項量綱不同，需要 normalize / learned value function；這是工程建模，不是現有標準公式。

### 2. Branch Externality 是 Speculation 最容易漏掉的成本

一個 candidate 的成本不是只有自己用掉多少 GPU token，而是它讓 shared batch step 變慢多少。

```text
Candidate Cost
=
Direct Compute
+
Direct Memory
+
Queue Delay
+
Batch Externality
+
Downstream Contention
```

TAPER 已經證明固定 eager branch width 會傷害共批 serial stages。因此 Hermes 不能讓 Model Router、Tool Router、Multi-Agent Orchestrator 各自無限制 fan-out。

### 3. Global Budget 必須跨 speculation layers 統一結算

應建立一級 runtime object：

```text
SpeculationBudget
├ request_id
├ deadline
├ latency_slack_ms
├ max_extra_gpu_ms
├ max_extra_tokens
├ max_extra_tool_calls
├ max_extra_network_bytes
├ max_extra_sandboxes
├ max_parallel_branches
├ risk_budget
└ cost_budget
```

每層都向同一 budget ledger 申請：

```text
Model Hedge ─┐
RAG Prefetch ├→ Global Budget Ledger
Tool Spec ───┤
Sandbox ─────┤
GPU Gen ─────┤
Multi-Agent ─┘
```

而不是六套互不知道彼此的 local controller。

### 4. Admission Control 與 Backpressure 必須分開

Admission：新工作能不能進。
Backpressure：下游已壅塞時，上游要如何減速。

建議：

```text
Telemetry
├ queue_sojourn
├ current_concurrency
├ p50/p95/p99 latency
├ timeout rate
├ rejection rate
├ GPU KV pressure
├ tool pool saturation
└ provider quota pressure
↓
Adaptive Limit Controller
↓
Admission Gate
↓
Backpressure Signal
↓
Planner / Router 降低 speculation width
```

Netflix Gradient2 與 Envoy adaptive concurrency 都支持以 latency / queueing feedback 動態調 concurrency，而不是固定 RPS threshold。

### 5. Tail Prediction 必須回答「現在要不要 hedge」，不是只預測 latency

真正 controller：

```text
Primary Start
↓
Tail Risk Estimator
├ elapsed time
├ historical percentile
├ queue gradient
├ provider load
├ context length
├ predicted output tokens
├ tool class
└ batch state
↓
P(primary misses deadline)
↓
Compare Hedge Expected Benefit vs Extra Load
↓
HEDGE / WAIT / DROP SPECULATION
```

這與固定 hedge delay 不同。固定 p90 hedge 可以作 baseline；production 版本應逐步加入 per-resource tail risk。

---

## Architecture Breakdown

```text
User Request
↓
Goal / Deadline / Priority
↓
Planner
↓
Candidate Opportunities
├ Model Hedge
├ RAG Prefetch
├ Tool Prediction
├ Sandbox Prewarm
├ GPU Candidate
└ Multi-Agent Branch
↓
Speculation Value Estimator
├ hit probability
├ latency benefit
├ quality benefit
├ externality
├ verification cost
├ cancellation waste
└ effect risk
↓
GLOBAL SPECULATION BUDGET
├ GPU
├ Tokens
├ Memory
├ Tool QPS
├ Network
├ Sandbox
├ Branch Width
└ Monetary Cost
↓
Adaptive Capacity Controller
├ queue sojourn
├ RTT / service time
├ saturation
├ rejection
└ timeout
↓
Admission Gate
├ ADMIT
├ DELAY
├ DOWNGRADE
└ REJECT SPECULATION
↓
Execution Groups
↓
Winner / Verification / Commit Gate
↓
Loser Suppression
↓
Telemetry Feedback
↓
Online Budget / Predictor Update
```

重要分層：

```text
Correctness Plane
= Winner Commit + Result Fence

Performance Plane
= Speculation + Hedge + Prefetch

Control Plane
= Budget + Admission + Backpressure
```

三者不能混成一個 scheduler if/else。

---

## Bottom-Level Logic

### A. Budget reservation

```text
reserve(candidate):
  predicted = estimate_resources(candidate)
  value = estimate_net_value(candidate)

  if value <= 0:
      reject

  if global_budget.can_reserve(predicted) == false:
      reject_or_delay

  token = global_budget.reserve(predicted)
  launch(candidate, token)
```

### B. Reservation reconciliation

預估不會等於實際，所以 completion 後必須：

```text
Reserved 300 GPU-ms
Actual   190 GPU-ms
↓
refund 110
```

或：

```text
Reserved 300
Actual   480
↓
overrun +180
↓
future admission becomes stricter
```

### C. Hierarchical budget

```text
Cluster Budget
↓
Tenant / Project Budget
↓
Request Budget
↓
SpecGroup Budget
↓
Candidate Reservation
```

避免單一「很重要 request」把整個 GPU pool 的 speculation credit 吃完。

### D. Slack-aware branch admission

定義：

```text
Slack = Deadline - PredictedFinishWithoutExtraBranch
Externality = ΔBatchStepLatency(extra_branch)
```

若：

```text
Externality <= SlackBudget
```

才擴 branch；否則 width 收縮。

這是由 TAPER 概念抽象出的 Hermes runtime primitive。

---

## Visual Simulation Idea

# Global Speculation Budget & Tail-Control Observatory

主畫面左側是一條 request critical path：

```text
UI → LLM → RAG → Tool → LLM → GPU → Output
```

每一節點上方可產生 speculation：

```text
Model Hedge +1
RAG Prefetch +2
Tool Predict +1
Sandbox Prewarm +1
Multi-Agent Branch +3
GPU Candidate +2
```

右側顯示即時 budget：

```text
GPU budget      72% used
Token budget    41%
Tool QPS        88%
Memory          63%
Branch width    5 / 8
Cost            $0.031 / $0.05
Latency slack   820 ms
```

使用者拉高「Multi-Agent Branch」：

```text
Branch width 3 → 7
↓
GPU compute ↑
Batch step ↑
Other request p99 ↑
Global slack ↓
↓
Admission Controller
DENY branch 6/7
```

可以切換：
- NO CONTROL
- FIXED LIMIT
- TOKEN BUCKET
- GRADIENT2
- SLACK-AWARE TAPER-LIKE
- VALUE-AWARE GLOBAL BUDGET

圖表同時顯示：
- mean / p95 / p99 latency
- goodput
- SLO attainment
- wasted speculative compute
- hedge hit-rate
- queue sojourn
- total cost
- resource amplification factor

最重要教學效果：讓使用者看到「一個 request 變快」可能同時讓整批其他 request 變慢。

---

## Code / GitHub

### Netflix concurrency-limits
Repository: https://github.com/Netflix/concurrency-limits

值得讀：
- concurrency-limits-core/src/main/java/com/netflix/concurrency/limits/limit/Gradient2Limit.java
- concurrency-limits-core/src/main/java/com/netflix/concurrency/limits/limit/VegasLimit.java
- concurrency-limits-core/src/main/java/com/netflix/concurrency/limits/limiter/
- concurrency-limits-grpc/

核心抽象：Limit algorithm 與 enforcement limiter 分離，可作 Hermes `CapacityEstimator` / `AdmissionEnforcer` 的參考。

### Envoy adaptive_concurrency
Repository: https://github.com/envoyproxy/envoy

值得讀：
- source/extensions/filters/http/adaptive_concurrency/controller/gradient_controller.cc
- source/extensions/filters/http/adaptive_concurrency/controller/gradient_controller.h
- source/extensions/filters/http/adaptive_concurrency/adaptive_concurrency_filter.cc
- api/envoy/extensions/filters/http/adaptive_concurrency/v3/adaptive_concurrency.proto
- test/extensions/filters/http/adaptive_concurrency/controller/gradient_controller_test.cc

工程價值：production-grade runtime config、minRTT recalibration、limit update、request block metrics。

### Hermes 建議新模組

```text
src/runtime/speculation/
├ budget.ts
├ admission.ts
├ value-estimator.ts
├ tail-risk.ts
├ backpressure.ts
├ reservations.ts
├ telemetry.ts
└ policy.ts
```

建議 interface：

```text
estimate(opportunity, runtimeState) -> SpecValue
reserve(resources) -> ReservationToken
admit(opportunity, reservation) -> Decision
reconcile(token, actualUsage)
recordOutcome(prediction, result)
```

---

## Papers

### Regulating Branch Parallelism in LLM Serving
Authors: Swapnil Gandhi, Siva Hari, William J. Dally, Christos Kozyrakis
Institution: Stanford University
Year: 2026
URL: https://arxiv.org/abs/2605.06914
Code: 未確認公開 repo
Dataset/Workload: LLM serving traces / Qwen3-32B evaluation
Architecture: per-step branch admission using predicted branch externality and slack
Contribution: 把 branch parallelism 從 fixed/eager 改為動態 admission
Limitations: 評估集中 intra-request branch parallelism；尚未直接覆蓋 tool/GPU/MCP 跨層 speculation

### AOSpec: Action and Observation Co-Speculation for Low-Latency Agent Serving
Authors: Hao Mark Chen, Jinnan Guo, Wayne Luk, Hongxiang Fan
Year: 2026
URL: https://arxiv.org/abs/2608.00881
Dataset: Terminal-Bench；並報告 observation model 可轉移至 SWE-bench Verified
Architecture: EVD + isolated forks + Joint Action-State Verification
Contribution: 由單純 action speculation 擴展至 action/observation，並將 long-horizon reuse 轉成 origin-state verification
Limitations: isolated fork 的資源成本與大型多 tenant serving 下的 global budget 仍需要更完整控制

### Act While Thinking: Accelerating LLM Agents via Pattern-Aware Speculative Tool Execution
Authors: Yifan Sui, Han Zhao, Rui Ma, Zhiyuan He, Hao Wang, Jianxun Li, Yuqing Yang
Year: 2026
URL: https://arxiv.org/abs/2603.18897
Architecture: recurring control-flow + data dependency based speculative tool execution
Contribution: 隱藏 agent LLM-tool serialization latency
Limitations: speculation hit-rate 與工具資源競爭仍需要全局 admission

### Speculate with Memory: Lossless Acceleration for LLM Agents
Authors: Yu Li, Qinyuan Ye, Prafulla Kumar Choubey, Jiaxin Zhang, Chien-Sheng Wu
Year: 2026
URL: https://arxiv.org/abs/2607.12236
Architecture: transition table + episodic memory + confusion tracker
Contribution: speculator 可從歷史 trajectory 在線改善
Limitations: prediction quality 提高不等於 system-level net benefit，一樣要算 capacity/externality

### The Tail at Scale
Authors: Jeffrey Dean, Luiz André Barroso
Institution: Google
Year: 2013
URL: https://research.google/pubs/the-tail-at-scale/
Architecture: hedged requests / tail-tolerant distributed service patterns
Contribution: 說明大型 fan-out service 的小比例 straggler 如何放大全局 latency
Limitations: 原始場景不是 stateful agent/tool side effects，需要 capability / commit fencing 才能安全轉用

---

## Unknown / Open Questions 1-3

1. **Global value function 如何校準？** GPU-ms、美元、p99 latency、quality、effect risk 的權重不能靠單一固定公式，可能需要 contextual bandit / constrained optimization。
2. **跨層 reservation 如何避免 deadlock / priority inversion？** 例如 request 已拿到 GPU budget 卻等 tool slot；另一個 request 反向持有 tool slot 等 GPU。
3. **Tail prediction 在非平穩 provider / GPU workload 下多快失效？** 需要 quantile sketch + short/long window + change-point detection，不能只使用長期 p95。

---

## 下一輪研究

下一輪優先：

# Deadline-Aware Scheduling × Critical Path × Resource Reservation × Priority Inversion × Multi-Resource Fairness

具體拆：

```text
Agent Execution DAG
↓
Critical Path
↓
Per-node Service-Time Distribution
↓
Deadline Slack Propagation
↓
GPU / Tool / Network / Model Quota Reservation
↓
Priority Queue
↓
Preemption / Cooperative Yield
↓
Priority Inversion Detection
↓
Deadline Miss Prediction
```

要比較：
- EDF (Earliest Deadline First)
- SRPT / LAS
- Weighted Fair Queuing / DRF
- Dominant Resource Fairness
- token-based scheduling
- vLLM continuous batching
- multi-agent critical-path scheduler

並回答：當 Agent DAG 中「慢但關鍵的 tool」與「大量可投機 branch」競爭 GPU/API quota 時，scheduler 怎麼知道該先服務哪個？

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- Unified Speculation Budget
- Speculation Opportunity
- Speculation Reservation
- Resource Amplification Factor
- Branch Externality
- Latency Slack
- Tail Risk Estimator
- Adaptive Concurrency Limit
- Admission Gate
- Backpressure Signal
- Budget Ledger
- Cost Budget
- GPU-Time Budget
- Tool-QPS Budget
- Sandbox Budget
- Verification Cost
- Cancellation Waste
- Queue Sojourn Time
- Speculation Net Value
- Per-Step Branch Admission

### Edges

```text
Speculation Opportunity
→ consumes
Speculation Budget

Speculation Opportunity
→ creates
Branch Externality

Tail Risk
→ increases_value_of
Hedged Execution

Queue Sojourn
→ feeds
Adaptive Concurrency Controller

Adaptive Concurrency Limit
→ constrains
Admission Gate

Admission Gate
→ controls
Speculative Group Creation

Candidate Completion
→ reconciles
Budget Reservation

Branch Externality
→ consumes
Latency Slack

Local Speculation Benefit
≠
Global Speculation Benefit

Prediction Confidence
≠
Admission Decision

Rate Limit
≠
Concurrency Limit

Admission Control
≠
Backpressure

First Result
≠
Committed Winner
```

---

## 本輪收斂回答

- 缺哪一層：**Deadline-aware critical-path scheduler 與跨 GPU/Tool/API 的 multi-resource reservation。**
- 哪個節點最淺：**Speculation Net Value 的線上校準。**
- 哪個概念仍只是名詞：**Unified Cross-Layer Speculation ABI / Global Resource Amplification Contract。**
- 哪個系統值得讀原始碼：**Netflix concurrency-limits 的 Gradient2/Vegas 與 Envoy adaptive_concurrency controller；下一輪再深入 vLLM scheduler。**
- 哪篇論文需追引用：**TAPER (2026) 與 AOSpec (2026)，並回追 The Tail at Scale。**
- 哪個概念最適合視覺模擬：**Global Speculation Budget & Tail-Control Observatory。**
- 哪個 Agent 架構最值得實作：**Budgeted Speculative Agent Runtime = Opportunity Estimator + Global Budget Ledger + Adaptive Admission + Tail-Risk Hedge Controller + Winner Commit Gate。**

## 核心結論

真正 production-grade 的 Agent speculation 不是「哪裡可以並行就多跑一份」。每個候選除了直接算力成本，還會製造 queue delay、batch externality、verification cost、cancellation waste 與 downstream contention。因此 Hermes 應把所有 model hedge、tool speculation、RAG prefetch、sandbox prewarm、multi-agent branch 和 GPU candidates 收進同一個 Global Speculation Budget。每次 admission 必須看 Expected Net Value、deadline slack、effect risk 與目前 adaptive concurrency。這使 speculative execution 從局部 latency hack，升級成一個真正可受控、可觀測、可回壓的 Agent Runtime control plane。