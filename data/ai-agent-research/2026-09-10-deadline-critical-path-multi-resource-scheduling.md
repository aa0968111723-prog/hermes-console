# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-10 07:54 Asia/Taipei

## 本輪主題
Deadline-Aware Scheduling × Critical Path × Multi-Resource Reservation × Priority Inversion × Agent Workflow SLO

## 與歷史研究比較

上一輪已建立：Unified Speculation Budget → Adaptive Admission → Backpressure → Winner Commit Gate。本輪不再重複「哪些 speculative work 值得啟動」，而是往下一個 production 缺口推進：當 Hermes 同時有 LLM prefill/decode、MCP tool、RAG、CPU sandbox、GPU vision/video、network transfer 與 multi-agent branch 時，誰先執行才真正縮短使用者看到的端到端完成時間？

上一輪中心問題：

```text
Can extra work be admitted safely?
```

本輪中心問題：

```text
Given admitted work,
which ready stage should run next,
on which resource,
and with what reservation/preemption policy?
```

本輪新增核心否定關係：

```text
High Request Priority
≠
Critical-Path Urgency

Shortest Local Stage
≠
Shortest Workflow Completion Time

GPU Idle Time
≠
Globally Idle Capacity

Fair Share
≠
Deadline Feasibility
```

---

## 本小時新發現

### 新論文 / 新架構 1：MARS — GPU/CPU Co-Scheduling for Agentic Systems

**Title**: MARS: Efficient, Adaptive Co-Scheduling for Heterogeneous Agentic Systems  
**Authors**: Yifei Wang, Hancheng Ye, Yechen Xu, Cong Guo, Chiyue Wei, Qinsi Wang, Dongting Li, Tingjun Chen, Hai “Helen” Li, Danyang Zhuo, Yiran Chen  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2604.26963  
**Architecture**: external control plane + unified GPU/CPU information stream + internal agent-centric scheduler + adaptive KV retention  
**Contribution**: 把 agentic serving 從 GPU-only inference scheduling 擴大成 GPU inference + CPU tool execution 的共同調度，並直接以 end-to-end critical path 為優先。  
**Reported result**: 論文摘要報告端到端 latency 最高降低 5.94×；整合 OpenHands 後 task completion time 最高改善 1.87×。這是論文特定 workload/hardware 結果，不能直接泛化。  
**Limitations**: 公開摘要不足以證明所有 workload 都由同一 critical-path heuristic 最佳化；source code 在摘要中寫「will be publicly available soon」，本輪未找到可驗證公開 repo。

### 新論文 / 新架構 2：HexAGenT — Workflow- and Heterogeneity-Aware Agent Scheduling

**Title**: HexAGenT: Efficient Agentic LLM Serving via Workflow- and Heterogeneity-Aware Scheduling  
**Authors**: You Peng, Youhe Jiang, Wenshuang Li, Xu Xu, Ke Zhou, Jiawei Jiang, Chen Wang, Binhang Yuan  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2605.16637  
**Architecture**: online workflow-aware scheduler over heterogeneous prefill/decode-disaggregated serving clusters.  
**Contribution**: 明確把 user-visible objective 從單一 LLM call latency 提升到整個 agent workflow latency；scheduler 必須處理 runtime 才逐步揭露的 dependencies、KV reuse、不同 prompt/output 長度與 heterogeneous GPUs。  
**Limitations**: DAG 並非完整預先已知，因此 classical static critical-path scheduling 不能原封不動套用；必須做 online re-estimation。

### 新論文 / 新架構 3：FATE — Future-State-Aware Workflow Scheduling

**Title**: FATE: Future-State-Aware Scheduling for Heterogeneous LLM Workflows  
**Authors**: Zirui Huang, Yi-Xiang Hu, Feng Wu, Xiangyang Li  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2605.07238  
**Architecture**: CP-SAT-backed ready-frontier planner + horizon-aware scoring + bounded multi-device shard execution + state-conditional cost estimation.  
**Contribution**: scheduler 不能只看當前 queue；目前 placement 會改變 downstream model residency、prefix reuse、parent-output locality、future device reachability。  
**Reported result**: real-DAG benchmark 中 normalized makespan / P95 latency 比 RoundRobin 分別降低約 32.5% / 32.3%，比其最強 non-FATE baseline 約改善 8.9% / 8.8%。  
**Limitations**: CP-SAT / horizon planning 本身有 control-plane overhead；需要限制 planning frontier，否則 agent DAG 大時 solver cost 可能反噬 latency。

### 新論文 / 新架構 4：SCORPIO — SLO-Oriented LLM Serving

**Title**: SCORPIO: Serving the Right Requests at the Right Time for Heterogeneous SLOs in LLM Inference  
**Authors**: Yinghao Tang, Tingfeng Lan, Xiuqi Huang, Hui Lu, Wei Chen  
**Year**: 2025  
**URL**: https://arxiv.org/abs/2505.23022  
**Architecture**: TTFT Guard + least-deadline-first reordering + infeasible-request rejection + TPOT Guard + predictive module.  
**Contribution**: deadline 不只是 queue sort key。若 request 已經不可能達成 SLO，仍讓它佔用昂貴 GPU capacity 可能同時拖累其他可救的 requests，因此 admission 与 scheduling 必須一起看 feasibility。  
**Reported result**: 論文摘要報告 goodput 最高 14.4×、SLO adherence 最高改善 46.5%。  
**Limitations**: 單次 LLM serving SLO 與 multi-stage Agent workflow deadline 不完全相同；Hermes 必須把 deadline 往 DAG 內傳播，而不是只套 least-deadline-first。

### 新論文 / 新架構 5：RPS-Serve — Modality-Aware Scheduling

**Title**: Rocks, Pebbles and Sand: Modality-aware Scheduling for Multimodal Large Language Model Inference  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2603.26498  
**Architecture**: modality-aware request classification / scheduling；video、image、text 具有數量級不同的 preprocessing/encoding/memory demand。  
**Contribution**: 多模態 request 不應在同一 FCFS queue 被視為同質工作；長 video request 可能形成 head-of-line blocking。  
**Limitations**: modality class 只是 resource-demand proxy，不等同真正 deadline / critical path；同一 video 任務內仍可能有不同 urgency。

---

## 本小時最重要 5 個發現

### 1. Agent Runtime 的 scheduling unit 應從 Request 提升到 Workflow Stage

**已確認事實**：vLLM 主線目前 request queue 至少明確提供 FCFS 與 PRIORITY；priority queue 依 `(priority, arrival_time)` 排序。其核心 scheduler 是 request-centric，而不是完整 agent workflow critical-path scheduler。

核心原始碼：
- `vllm/v1/core/sched/request_queue.py`
- `vllm/v1/core/sched/scheduler.py`

Hermes 需要將 scheduling object 升級：

```text
Request
↓
Workflow
↓
Stage DAG
├ LLM_PREFILL
├ LLM_DECODE
├ RAG_FETCH
├ MCP_TOOL
├ CPU_SANDBOX
├ VISION_ENCODE
├ VIDEO_GENERATE
├ NETWORK_TRANSFER
└ SYNTHESIS
```

每個 ready stage 都不是只帶 `priority`，而應帶：

```text
StageSchedulingMetadata
├ workflow_id
├ stage_id
├ deadline
├ earliest_start
├ latest_finish
├ remaining_path_cost
├ slack
├ resource_vector
├ preemptibility
├ state_locality
└ effect_class
```

**為什麼重要**：同一個高優先 workflow 內，有些 stage 並不在 critical path；搶先執行它可能不會讓使用者更早拿到結果，反而阻塞真正 critical continuation。

### 2. Critical Path Priority 必須動態重算，而不是 DAG 建立時算一次

Classical DAG：

```text
remaining_path_cost(v)
=
service_time(v)
+
max(remaining_path_cost(child))
```

workflow deadline `D` 下：

```text
predicted_finish(v)
=
now
+ queue_delay(v)
+ remaining_path_cost(v)

slack(v)
=
D - predicted_finish(v)
```

但 Agent DAG 是在線展開：

```text
Planner
→ Tool
→ Observation
→ 才知道下一步 branch
```

所以 Hermes 需要：

```text
Completion Event
or New Edge Discovered
↓
Update service-time posterior
↓
Update ready frontier
↓
Recompute descendant criticality
↓
Recompute slack
↓
Rescore scheduling priority
```

**已確認論文方向**：MARS 以 agent-centric critical path 最小化端到端 latency；HexAGenT 明確處理 runtime 逐步揭露依賴；FATE 以 horizon-aware ready-frontier planning 避免只看 immediate queue。

**合理工程推論**：Hermes 應使用 online critical-path estimator，而不是靜態 CPM。

### 3. Prefill / Decode 必須被視為不同資源行為的子階段

Sarathi-Serve 的重要底層觀察：

```text
Prefill
→ 高 parallelism
→ compute-bound
→ 單次 iteration 可能很長

Decode
→ 1 token / sequence / step
→ memory-bandwidth / KV intensive
→ 對 Time-Between-Tokens 敏感
```

Sarathi-Serve 的 chunked-prefill：

```text
Long Prefill
↓
Chunk_1
Chunk_2
Chunk_3
...
```

stall-free schedule：

```text
1. 先放 ongoing decodes
2. 再放 bounded prefill chunk
3. 總 token 數受 iteration token budget τ 限制
```

這使 iteration latency 更可控制；Microsoft Research 公開說明其在指定測試中，Mistral-7B 單 A100 serving capacity 最高 2.6×、Yi-34B 雙 A100 最高 3.7×，pipeline parallel Falcon-180B 最高 5.6×。

**Hermes 推論**：critical-path scheduler 不應只把 `LLM_CALL` 當一個不可分 task，而應至少拆：

```text
LLM_CALL
├ PREFILL
└ DECODE_CONTINUATION
```

否則 scheduler 無法知道「長 prefill 正在拖住 20 條 deadline-critical decodes」。

### 4. Multi-Resource Scheduling 不能只用 GPU utilization

Agent stage 的真正 resource vector：

```text
r(stage) = [
  GPU_compute,
  GPU_memory,
  KV_cache,
  CPU,
  RAM,
  network,
  tool_QPS,
  sandbox_slots,
  storage_IO
]
```

Dominant Resource Fairness (DRF) 提供非常好的 fairness baseline：每個使用者看自己需求比例最高的 dominant share，以 max-min-like 方式做異質資源公平分配。原始論文作者為 Ali Ghodsi, Matei Zaharia, Benjamin Hindman, Andrew Konwinski, Scott Shenker, Ion Stoica（UC Berkeley / NSDI 2011）。

但 Hermes 必須明確區分：

```text
DRF
→ answers fairness

Deadline scheduler
→ answers urgency / feasibility
```

因此推薦兩層：

```text
Tenant / Project Fairness Plane
→ DRF-like entitlement / quota
↓
Workflow Urgency Plane
→ deadline + critical path + slack
```

不能讓 urgency 永久突破 tenant fairness，也不能讓公平分配導致 safety-critical deadline 一律 miss。

### 5. Priority Inversion 在 Agent Runtime 會跨 GPU / CPU / Tool 發生

經典 priority inversion 的 Agent 版：

```text
High-priority Workflow H
↓ needs
MCP tool result X

X 正被 Low-priority Workflow L 的 tool worker / lock / sandbox slot 佔住

Medium-priority Workflows M1..Mn
持續吃 CPU/GPU
↓
L 無法完成
↓
H 間接被 M 阻塞
```

因此：

```text
High Priority Waiting
on Low Priority Holder
↓
Priority Donation / Inheritance
↓
Temporarily boost holder L
↓
Release dependency
↓
Restore base priority
```

在 Hermes 不只 lock：任何 dependency-bearing resource 都可能造成 inversion：

```text
MCP session
browser lease
sandbox slot
GPU KV residency
artifact materialization
model loading
network transfer
```

新的 runtime primitive：

```text
DependencyBoost(
  blocked_workflow,
  blocking_stage,
  inherited_deadline,
  inherited_urgency
)
```

注意：這是從 OS priority-inheritance 機制推到 Agent workflow 的工程模型，本輪未發現成熟 Agent framework 已完整標準化此 abstraction。

---

## Architecture Breakdown

```text
User Goal
↓
Workflow Builder
↓
Dynamic Execution DAG
├ LLM Prefill
├ LLM Decode
├ RAG
├ MCP Tool
├ CPU Sandbox
├ Vision Encoder
├ GPU Generation
├ Network Transfer
└ Synthesis
↓
Deadline Manager
├ request deadline
├ stage budget
├ TTFT target
├ TPOT/TBT target
└ workflow completion SLO
↓
Online Cost Estimator
├ service-time distribution
├ output-length posterior
├ queue delay
├ transfer time
├ warm/cold state
└ model/tool availability
↓
Critical Path Engine
├ remaining path cost
├ latest finish
├ slack
├ downstream fan-in
└ uncertainty
↓
Fairness / Entitlement Plane
├ tenant quota
├ DRF-like dominant share
└ priority class
↓
Multi-Resource Reservation
├ GPU compute
├ VRAM/KV
├ CPU
├ network
├ tool QPS
└ sandbox
↓
Ready Frontier Scheduler
├ EDF-like urgency
├ slack
├ criticality
├ locality
├ preemption cost
└ future-state score
↓
Per-Resource Executors
├ vLLM-like GPU scheduler
├ tool worker pool
├ browser pool
├ sandbox pool
└ transfer engine
↓
Completion Event
↓
DAG / Cost / Slack Recompute
↓
Next Scheduling Decision
```

### 三層 scheduler 建議

```text
L0 — Admission / Budget
Can this workflow or speculative branch enter?

L1 — Workflow Scheduler
Which ready stage is globally most urgent?

L2 — Resource-local Scheduler
How should GPU/tool/CPU execute selected stages efficiently?
```

這三層不能混成單一 priority queue。

---

## Bottom-Level Logic

### A. Dynamic critical-path score

Hermes 建議初版：

```text
RemainingPath(v)
=
E[Service(v)]
+
max_child RemainingPath(child)
```

若 dependency 尚未揭露，加入 uncertainty margin：

```text
RiskAdjustedPath(v)
=
RemainingPath(v)
+ k × PathStdDev(v)
```

```text
Slack(v)
=
WorkflowDeadline
- now
- ExpectedQueueDelay(v)
- RiskAdjustedPath(v)
```

最簡單 urgency：

```text
Urgency(v) = -Slack(v)
```

但 production score 還需 locality / preemption / fairness：

```text
Score(v) =
  w1 × Criticality(v)
+ w2 × DeadlineRisk(v)
+ w3 × StateLocalityBenefit(v)
- w4 × PreemptionCost(v)
- w5 × DominantResourceDebt(v)
```

此公式是 Hermes 工程建模，非既有論文標準公式。

### B. Deadline propagation

假設 workflow：

```text
A(LLM) 400ms
↓
B(Tool) 1200ms
↓
C(LLM) 600ms
↓
D(Output) 100ms
```

user deadline = 3000ms。

剩餘 path：

```text
D = 100
C = 700
B = 1900
A = 2300
```

若 now 已耗 900ms：

```text
Slack(A continuation)
= 3000 - 900 - 2300
= -200ms
```

表示 deadline 已進 infeasible zone。

此時 scheduler 不應只是提升 priority，還應觸發 policy：

```text
INFEASIBLE
↓
Drop speculation
Use faster model route
Skip optional refinement
Hedge critical read-only tool
Escalate priority
Return partial result if policy permits
```

因此：

```text
Deadline Scheduler
≠
EDF Queue Only
```

而是一個 degradation / routing policy trigger。

### C. Multi-resource reservation

對 stage `v`：

```text
Need(v)
=
GPU=0.6
VRAM=8GB
CPU=2 cores
Network=200MB/s
ToolQPS=1
```

reservation 不能只問 GPU：

```text
reserve(v)
↓
check all required resources atomically / via bounded hold
↓
READY_TO_RUN
```

否則常見 failure：

```text
GPU reserved
↓
Tool slot unavailable
↓
GPU idle while holding scarce memory
```

建議將「不可立即取得所有必要資源」的 stage 留在 `WAIT_RESOURCE`，並避免長時間 hold-and-wait。

### D. Priority inheritance through dependency edges

```text
H(deadline 100ms)
↓ waiting_on
L-tool
```

scheduler 應計算：

```text
InheritedUrgency(L-tool)
=
max(
  BaseUrgency(L),
  Urgency(H)
)
```

若 L 又等 X：

```text
H → L → X
```

boost 必須沿 dependency chain 傳播，並在 edge 消失後撤回。

---

## Visual Simulation Idea

# Agent Critical Path & Multi-Resource Scheduler Lab

### 主畫面

中央是一張動態 Agent DAG：

```text
            ┌→ RAG ─────────┐
User → Plan ┤                ├→ Synthesis → Output
            └→ MCP → Vision ┘
```

每個 stage 顯示：

```text
service p50/p95
resource vector
remaining path
slack
deadline risk
queue delay
locality
```

### 時間軸

下方同時顯示：

```text
GPU 0   [prefill][decode][vision       ][decode]
GPU 1   [video generation......................]
CPU     [tool][sandbox][tool]
MCP     [search........][fetch]
NET     [artifact transfer]
```

使用者切換 scheduler：

- FCFS
- STATIC PRIORITY
- EDF
- SRPT-like
- DRF FAIRNESS
- CRITICAL-PATH FIRST
- DEADLINE + CRITICAL PATH + RESOURCE AWARE

### 可以注入事件

- LONG VIDEO ARRIVES
- MCP TOOL STALLS
- GPU OOM PRESSURE
- HIGH-PRIORITY REQUEST ARRIVES
- TOOL RATE LIMIT
- MODEL COLD LOAD
- NETWORK SLOWDOWN
- NEW AGENT BRANCH DISCOVERED
- OUTPUT LENGTH DOUBLES

### Priority inversion demo

```text
H(high) waits on L(tool lock)
M1/M2 keep running
```

關閉 inheritance：

```text
H deadline missed
```

開啟 inheritance：

```text
L boosted
→ tool released
→ H resumes
```

### 最重要的視覺比較

同時顯示：

```text
Request Priority
Stage Urgency
Critical Path
Resource Pressure
```

讓使用者直接理解：

> 最高 priority 的 request，不代表它每一個 stage 都應先跑。

---

## Code / GitHub

### vLLM
Repository: https://github.com/vllm-project/vllm

本輪實際追讀：
- `vllm/v1/core/sched/request_queue.py`
- `vllm/v1/core/sched/scheduler.py`

確認的核心抽象：

```text
SchedulingPolicy
├ FCFS
└ PRIORITY
```

`PriorityRequestQueue` 使用 heap，較小 `priority` 先出；同 priority 下較早 `arrival_time` 先處理。

值得下一輪繼續讀：
- `vllm/v1/core/sched/scheduler.py`
- KV cache manager / preemption path
- disaggregated serving proxy scheduling examples

### Llumnix
Repository: https://github.com/llumnix-project/llumnix-ray
OSDI artifact: https://github.com/alibaba/llm-scheduling-artifact

值得讀：
- manager / scheduler / instance state tracking
- request migration
- KV migration backend
- priority / load-balancing policy
- simulator

Llumnix 的重要 system idea：像 OS context switch 一樣讓 request / KV state 在 model instances 之間 live migrate，從而做 runtime rescheduling，而不是 dispatch 後就永遠固定在單一 instance。

### Sarathi-Serve
Repository: https://github.com/microsoft/sarathi-serve

值得讀：
- scheduler
- chunked prefill logic
- token budget
- stall-free batching
- Vidur simulator integration

特別值得將 Sarathi 的 per-iteration token budget 與 Hermes 的 workflow-level deadline/slack 接起來。

---

## Papers

### 1. MARS: Efficient, Adaptive Co-Scheduling for Heterogeneous Agentic Systems
- Authors: Yifei Wang et al.
- Year: 2026
- URL: https://arxiv.org/abs/2604.26963
- Architecture: GPU/CPU co-scheduling + external control plane + agent-centric critical-path scheduler
- Contribution: 把 CPU tool execution 納入 agent end-to-end critical path
- Limitation: 本輪未找到可驗證公開 code；結果需視 workload/hardware 解讀

### 2. HexAGenT: Efficient Agentic LLM Serving via Workflow- and Heterogeneity-Aware Scheduling
- Authors: You Peng et al.
- Year: 2026
- URL: https://arxiv.org/abs/2605.16637
- Architecture: online workflow scheduler over heterogeneous P/D-disaggregated cluster
- Contribution: workflow-level latency objective + runtime-revealed dependencies
- Limitation: dynamic DAG uncertainty 使 static scheduling methods 不足

### 3. FATE: Future-State-Aware Scheduling for Heterogeneous LLM Workflows
- Authors: Zirui Huang, Yi-Xiang Hu, Feng Wu, Xiangyang Li
- Year: 2026
- URL: https://arxiv.org/abs/2605.07238
- Architecture: CP-SAT frontier planner + future-state scoring
- Contribution: 將 model residency / locality / prefix reuse 的 downstream consequence 納入 scheduling
- Limitation: solver overhead；需 bounded horizon

### 4. SCORPIO: Serving the Right Requests at the Right Time for Heterogeneous SLOs in LLM Inference
- Authors: Yinghao Tang, Tingfeng Lan, Xiuqi Huang, Hui Lu, Wei Chen
- Year: 2025
- URL: https://arxiv.org/abs/2505.23022
- Architecture: TTFT Guard + deadline-aware reorder/rejection + TPOT Guard
- Contribution: SLO feasibility 與 admission/batch scheduling 聯合
- Limitation: request-level，不等於 agent DAG-level deadline propagation

### 5. Taming Throughput-Latency Tradeoff in LLM Inference with Sarathi-Serve
- Authors: Amey Agrawal, Nitin Kedia, et al.
- Institution: Microsoft Research / collaborators
- Year: 2024
- URL: https://arxiv.org/abs/2403.02310
- Code: https://github.com/microsoft/sarathi-serve
- Architecture: chunked prefill + stall-free hybrid batching
- Contribution: 降低長 prefill 對 ongoing decode 的 stall
- Limitation: inference-engine local scheduling；不處理完整 Agent workflow multi-resource DAG

### 6. Llumnix: Dynamic Scheduling for Large Language Model Serving
- Authors: Biao Sun, Ziming Huang, Hanyu Zhao, Wencong Xiao, Xinyi Zhang, Yong Li, Wei Lin
- Year: 2024
- URL: https://arxiv.org/abs/2406.03243
- Code: https://github.com/llumnix-project/llumnix-ray
- Dataset/workload: ShareGPT-derived request length distribution / Poisson arrivals in public evaluation description
- Architecture: KV-aware load balancing + request live migration across instances
- Contribution: dispatch 後仍可 reschedule
- Limitation: 原始 priority model/workload abstraction 比完整 Agent workflow 簡化

### 7. Dominant Resource Fairness: Fair Allocation of Multiple Resource Types
- Authors: Ali Ghodsi, Matei Zaharia, Benjamin Hindman, Andrew Konwinski, Scott Shenker, Ion Stoica
- Institution: UC Berkeley
- Year: 2011
- URL: https://amplab.cs.berkeley.edu/publication/dominant-resource-fairness-fair-allocation-of-multiple-resources-types/
- Architecture: dominant-share max-min fairness
- Contribution: heterogeneous multi-resource fairness baseline
- Limitation: fairness objective，不處理 deadline / DAG criticality

---

## 已確認事實 / 工程推論 / 尚未驗證假說

### 已確認事實
- vLLM current source exposes FCFS / PRIORITY request queues and orders priority by priority then arrival time.
- Sarathi-Serve splits long prefills into chunks and uses bounded token-budget stall-free schedules.
- Llumnix uses request/KV live migration for cross-instance dynamic rescheduling.
- MARS/HexAGenT/FATE 2026 research all explicitly move toward workflow/agent/heterogeneous-resource-aware scheduling.
- DRF solves heterogeneous-resource fairness, not deadlines.

### 合理工程推論
- Hermes scheduler should use three levels: Admission → Workflow Criticality → Resource-local Execution.
- Deadline should propagate to dynamic workflow stages as slack/risk rather than remain only request metadata.
- Priority inheritance should extend across Agent dependency edges, not only mutex locks.

### 尚未驗證假說
- `Deadline + Dynamic Critical Path + DRF Debt + Locality` 的 combined score 是否優於 simpler two-stage scheduler，需要 simulator benchmark 驗證。
- Cross-resource atomic reservation 是否值得其 control-plane cost，可能需要改成 optimistic reservation + compensation。
- Priority donation through long MCP/GPU dependency chains 是否會導致新的 starvation，需要 aging / cap。

---

## Unknown / Open Questions

1. Agent DAG 在 runtime 才出現新 branch，如何估計 `remaining_path_cost` 而不讓 predictor error 造成頻繁 priority oscillation？
2. GPU decode 是細粒度、MCP tool 可能數十秒不可搶占；跨這兩種 preemption granularity，要如何定義統一 scheduler tick / reservation contract？
3. Critical-path-first 與 tenant fairness 衝突時，應使用 deadline admission、priority debt、DRF entitlement，還是 hierarchical token bucket 做邊界？

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
Agent Workflow Scheduler
Dynamic Execution DAG
Workflow Deadline
Stage Deadline
Remaining Path Cost
Risk-Adjusted Critical Path
Slack
Deadline Risk
Ready Frontier
Multi-Resource Reservation
Resource Vector
Dominant Resource Share
Fairness Debt
Workflow Feasibility
Stage Preemptibility
Dependency Boost
Priority Inheritance
Priority Inversion
Prefill Chunk
Decode Continuation
Stall-Free Batch
State Locality
Future-State Cost
```

### Edges

```text
Workflow Deadline
→ propagates_to
Stage Slack

Dynamic DAG Mutation
→ invalidates
Critical Path Estimate

Critical Path
→ influences
Stage Urgency

Stage
→ consumes
Resource Vector

Tenant
→ constrained_by
Dominant Resource Share

Blocked High-Urgency Stage
→ donates_priority_to
Blocking Dependency Holder

Long Prefill
→ chunked_into
Prefill Chunks

Prefill Chunk
→ co_scheduled_with
Decode Continuation

Request Migration
→ changes
State Locality

Future State
→ affects
Downstream Scheduling Cost
```

### Important negative edges

```text
High Request Priority
≠
Critical-Path Urgency

EDF
≠
Full Workflow Scheduler

DRF Fairness
≠
Deadline Guarantee

GPU Utilization
≠
Multi-Resource Utilization

Shortest Stage
≠
Shortest Workflow Completion

Static Critical Path
≠
Dynamic Agent Critical Path
```

---

## 下一輪研究

本輪補上了「哪一個 ready stage 應先執行」，下一個最自然的缺口是：

# Preemption × Checkpointing × KV/Tool State Migration × Resume Cost × Exactly-Once Continuation

因為 deadline-aware scheduler 如果只能重新排序「尚未開始」的工作，仍然不夠。真正遇到：

```text
Low-priority video generation 已跑 40 秒
↓
High-priority critical workflow 到達
```

需要決定：

```text
PREEMPT?
├ Stop + lose 40s work
├ Checkpoint GPU state
├ Offload KV / latent
├ Migrate worker
├ Let it finish
└ Fork / duplicate elsewhere
```

下一輪應研究：

```text
Preemption Point
↓
Checkpoint Granularity
↓
State Capture
├ KV cache
├ RNG state
├ sampler state
├ tool transaction
├ browser state
├ diffusion latent
└ artifact references
↓
Migration / Offload
↓
Resume
↓
Continuation Identity
↓
Exactly-once / At-most-once Commit
```

並比較：
- vLLM preemption / recomputation
- Llumnix live migration
- prefill-decode disaggregation
- Ray actor/task checkpointing
- Temporal workflow/activity continuation semantics
- diffusion/video generation resumability

---

## 本輪結束判定

- **缺哪一層**：跨 GPU / CPU / MCP / network 的 preemptable continuation layer。
- **哪個節點最淺**：`Priority Inheritance across Agent Dependency Graph`，目前是合理工程映射但缺乏成熟 Agent runtime benchmark。
- **哪個概念仍只是名詞**：`Unified Multi-Resource Stage Reservation ABI`。
- **哪個系統值得讀原始碼**：vLLM scheduler/preemption、Llumnix migration、Sarathi-Serve chunked-prefill scheduler。
- **哪篇論文需追引用**：MARS、HexAGenT、FATE、SCORPIO。
- **哪個概念最適合視覺模擬**：Agent Critical Path & Multi-Resource Scheduler Lab。
- **哪個 Agent 架構最值得實作**：

> Deadline-Aware Agent Workflow Runtime = Dynamic DAG + Online Critical Path + Slack/Feasibility + Hierarchical Fairness + Multi-Resource Reservation + Priority Inheritance + Resource-Local Schedulers

---

## 核心結論

真正的 Agent scheduler 不能只把所有工作塞進一個 priority queue。從「使用者說一句話」到最後 Output，中間會形成一張動態 execution DAG；有些節點吃 GPU、有些卡 CPU/tool/network，有些 prefill 一次很重、有些 decode 每一步都對互動延遲敏感。成熟的 Hermes Runtime 應先用 Admission 決定哪些工作能進，再用 workflow deadline 與 online critical path 找出真正會拖慢最終輸出的 ready stage，最後交給 resource-local scheduler 執行。當高 urgency stage 被低 priority dependency 卡住時，還需要跨工具與資源的 priority inheritance。這才開始從「LLM serving scheduler」提升成真正的「Agent Operating System scheduler」。