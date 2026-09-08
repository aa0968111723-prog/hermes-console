# AI Agent × Multimodal Research Report

時間：2026-09-08 17:54（Asia/Taipei）

## 本輪定位

本輪接續既有研究鏈：Agent Runtime → Memory/Context → Multimodal Runtime/Fusion → Computer Agent Grounding → World State/Verification → Permission/Transaction/Security。本輪不再重複上述節點，正式補上 **Model Reasoning × System Reasoning × Planning Runtime × DAG Scheduling**。

核心問題不是「哪個 prompt 比較會思考」，而是：

1. 哪些決策必須在模型內逐步產生？
2. 哪些依賴關係應由 Runtime 顯式保存？
3. 哪些子任務可以並行？
4. 哪些 observation 會使原計畫失效並觸發 replan？
5. Planning 如何與上一輪建立的 Permission / Transaction / Verification 邊界接起來？

---

## 本小時新發現

### 1. ReAct 是「Observation-coupled planning」

ReAct 的核心不是單純 CoT，而是把 Reasoning 與 Action/Observation 交錯：

```text
State S_t
↓
Model Reasoning
↓
Action A_t
↓
Environment / Tool
↓
Observation O_t+1
↓
重新進 Model
↓
下一步 Reasoning
```

優點是每一步能利用最新 observation 處理例外；缺點是控制路徑高度串行，每次 tool latency 後通常又需要一次 model inference。

### 2. ReWOO 把 Planning 與 Observation Consumption 拆開

ReWOO 的重要架構變化：先由 Planner 生成含 tool dependencies 的 blueprint，再讓 Worker 執行工具，最後 Solver 整合 evidence。

```text
Goal
↓
Planner
↓
Plan / Evidence Slots
↓
Worker executes tools
↓
Observations fill slots
↓
Solver
```

因此「Reason → Tool → Reason → Tool」不再是唯一 Agent loop；Reasoning 可以被前置編譯成執行藍圖。

### 3. LLMCompiler 把 plan 升級成可排程 DAG

LLMCompiler 的 source code 直接顯示 runtime 分成 Planner、TaskFetchingUnit、Executor/Joiner。Planner 生成 task 與 dependency；TaskFetchingUnit 持有 `tasks_done` events，只有 dependencies 全部完成的 task 才能 executable，並用 `asyncio.create_task()` 並行執行。

```text
Planner
↓
Task DAG
↓
Task Fetching Unit
├ ready(T1) → run
├ ready(T2) → run in parallel
└ T3 waits for T1,T2
↓
Joiner
↓
Finish / Replan
```

這代表真正的 System Reasoning 可以存在於 Runtime scheduler，而不是全塞在模型 token stream 裡。

### 4. 2026 ADK 已明確把「LLM Agent」與「Workflow/Graph control flow」分開

Google ADK 文件區分 LLM-driven agent 與 deterministic workflow；Sequential / Parallel / Loop workflows 的控制順序不是由模型決定。ADK 2.0 Python/Go 又把重心轉向 graph-based / dynamic workflows。

因此現代 Agent OS 應正式區分：

```text
Model Policy
= 根據 context 提議下一步 / plan

Runtime Control Flow
= 執行順序、依賴、並行、loop、timeout、retry、permission、transaction
```

### 5. Multi-Agent handoff 很多時候只是另一種 Runtime dispatch

OpenAI Agents SDK 的 handoff 會以 tool 形式暴露給模型，例如 `transfer_to_refund_agent`；manager-style orchestration 則把 specialist agent 轉成 tool。也就是：

```text
Model chooses delegation action
↓
Runtime validates structured handoff/tool call
↓
Runtime changes active agent or starts nested run
```

所以 Multi-Agent 不必被神秘化為「多個 AI 大腦互相討論」；很多 production implementation 本質是 **dispatch + context boundary + nested execution**。

---

# 本小時最重要 5 個發現

## 1. Reasoning 必須拆成 Model Reasoning 與 System Reasoning

### Model Reasoning

```text
Context
↓
Transformer inference
↓
latent / hidden reasoning process
↓
structured action / plan / answer
```

模型適合：
- 理解模糊自然語言目標
- 形成候選子目標
- 處理未結構化 observation
- 遇到意外後診斷與重規劃

### System Reasoning

```text
Explicit Plan State
↓
Dependency Graph
↓
Scheduler
↓
Permission / Transaction Rules
↓
Execution
↓
Verification
```

Runtime 適合：
- DAG dependency enforcement
- parallel scheduling
- timeout
- retry policy
- deterministic loops
- approval gates
- transaction boundaries
- completion-condition evaluation

重要結論：

```text
「Agent 會規劃」
不能只看模型 prompt。
```

真正可靠的 planning 是 **Model proposes structure + Runtime enforces structure**。

---

## 2. ReAct、ReWOO、LLMCompiler 的根本差異是 Observation Coupling

建立新軸：

```text
Observation Coupling Spectrum

Strong coupling
ReAct
Reason → Act → Observe → Reason

Medium coupling
LLMCompiler
Plan DAG → Execute ready tasks → Join → Replan if needed

Weak coupling
ReWOO
Plan blueprint → execute evidence slots → solve
```

這比只比較 benchmark 更有架構價值。

Strong coupling：適合 dynamic environment，但 latency 高、較難並行。

Weak coupling：適合可預測、工具依賴可事先描述的任務，但如果外部世界快速變動，plan 容易 stale。

DAG planning：折衷方案；先編譯已知 dependency，同時保留 Join/Replan checkpoint。

---

## 3. Planner output 應該是 IR（Intermediate Representation），不是自由文字計畫

自然語言 plan：

```text
先搜尋，再比較，最後整理。
```

Runtime 很難知道依賴與並行。

更好的 Planning IR：

```json
{
  "tasks": [
    {"id": "T1", "op": "search", "args": {"q": "A"}, "deps": []},
    {"id": "T2", "op": "search", "args": {"q": "B"}, "deps": []},
    {"id": "T3", "op": "compare", "args": {"a": "$T1", "b": "$T2"}, "deps": ["T1", "T2"]}
  ]
}
```

Runtime 才能：

```text
compile
→ validate
→ authorize
→ schedule
→ trace
→ checkpoint
→ replan
```

新增核心節點：

```text
Agent Planning IR
```

它相當於模型與 execution engine 之間的「中間語言」。

---

## 4. Parallelism 的安全前提不是「可以同時呼叫工具」，而是 dependency + side-effect independence

LLMCompiler source 的 scheduler 會檢查 task dependencies，dependencies 完成才把 task 加入可執行集合。

Hermes 還需要再多一層上一輪建立的 Transaction / Permission metadata：

```text
Ready by Dependency
AND
No transaction conflict
AND
Permission granted
AND
Resource lock available
↓
Runnable
```

例如：

```text
Search source A      ┐
Search source B      ├ parallel safe
Search source C      ┘
```

但：

```text
Read spreadsheet
↓
Update same row
↓
Send result
```

不能因為模型一次產生三個 tool calls 就盲目 parallelize。

所以真正 Agent Scheduler 應與 database scheduler 一樣考慮 hazard：

```text
RAW  Read After Write
WAR  Write After Read
WAW  Write After Write
External side-effect conflict
```

這是合理的 system-design 推論，需後續在 Agent runtime 實驗驗證。

---

## 5. Replan 不是「重新問一次模型」，而是 Plan Patch / Graph Revision 問題

LLMCompiler 的 engine 已有 `max_replans`，Joiner 會輸出 Finish 或 Replan；舊 plan/observations 會被格式化回 replanner context。

但更完整的 Agent OS 應保存：

```text
Plan Version v1
├ T1 DONE
├ T2 DONE
├ T3 FAILED
└ T4 BLOCKED

Observation:
API B unavailable

↓ Replanner

Plan Patch v2
- remove T3
+ add T3b fallback_search
T4 depends on T3b
```

而不是整張 graph 丟掉重建。

這樣才能：
- 保留已完成 side effects
- 不重跑昂貴工具
- 不復活已消耗 authority
- 與 checkpoint / transaction ledger 對齊

因此新增：

```text
Plan Versioning
Plan Patch
Dependency Reconciliation
```

---

# Architecture Breakdown

## Hybrid Reasoning & Planning Runtime

```text
User Goal
↓
Goal Parser
↓
Model Planner
↓
Planning IR Compiler
├ task id
├ operation
├ arguments
├ dependencies
├ expected output
├ risk class
├ reversibility
└ completion predicate
↓
Plan Validator
├ schema
├ dependency cycle check
├ tool availability
├ permission constraints
└ transaction conflicts
↓
Execution Graph
↓
Scheduler
├ READY
├ RUNNING
├ BLOCKED
├ DONE
├ FAILED
└ UNKNOWN
↓
Action Router
├ MCP
├ API
├ GUI
├ Code
└ Agent-as-Tool
↓
Environment
↓
Observation / Evidence
↓
Verifier
↓
Join / State Reducer
├ continue graph
├ request more evidence
├ patch plan
└ finish
↓
Replanner
↓
Plan vN+1
```

這一層直接把之前研究到的 Runtime 全串起來：

```text
Planning
→ Permission
→ Transaction
→ Execution
→ Verification
→ Replan
```

---

# Bottom-Level Logic

## DAG Scheduler 到底如何跑

Plan：

```text
T1 search(A) deps=[]
T2 search(B) deps=[]
T3 compare($T1,$T2) deps=[T1,T2]
T4 write_report($T3) deps=[T3]
```

Runtime 初始化：

```text
T1 READY
T2 READY
T3 BLOCKED
T4 BLOCKED
```

Event loop：

```text
READY SET = {T1,T2}
↓
async execute T1,T2
↓
T1 DONE → emit observation O1
T2 DONE → emit observation O2
↓
Dependency Resolver
↓
T3 deps satisfied
↓
replace $T1 → O1
replace $T2 → O2
↓
T3 READY
```

LLMCompiler 的 `TaskFetchingUnit` 原始碼就是使用 task completion `asyncio.Event` 來判斷所有 dependency 是否完成，並透過 `asyncio.create_task()` 啟動 executable tasks；dependency placeholder 例如 `${1}` 會在執行前用先前 observation 替換。

這個機制非常重要，因為它證明：

> 「等待上一個工具結果」不一定需要再做一次 LLM reasoning；Runtime 可以自己處理 dependency resolution。

---

# Model Reasoning vs Runtime Reasoning X-Ray

## Visual Simulation Idea

Hermes Console 新增 **Reasoning Runtime X-Ray**：

左側顯示 Model：

```text
GOAL
「研究三個框架並比較」

MODEL OUTPUT
T1 research LangGraph
T2 research ADK
T3 research Agents SDK
T4 compare T1,T2,T3
```

中間顯示 Compiler：

```text
Natural-language Plan
↓
Planning IR
↓
Dependency DAG
```

主畫面：

```text
       ┌─ T1 ─┐
Goal ──├─ T2 ─┼─→ T4 Compare → T5 Report
       └─ T3 ─┘
```

每個節點即時顯示：

```text
STATE
READY / RUNNING / BLOCKED / DONE / FAILED

OWNER
Model / Runtime / Tool / Human

RISK
read / write / irreversible

INPUT
context refs

OUTPUT
observation refs
```

切換三個模式：

### ReAct Mode

```text
Reason
↓
Tool
↓
Observation
↓
Reason
↓
Tool
```

### ReWOO Mode

```text
Plan all
↓
Execute evidence slots
↓
Solve
```

### Compiler/DAG Mode

```text
Plan
↓
Compile DAG
↓
Parallel schedule
↓
Join
↓
Patch / Finish
```

右側顯示即時成本：

```text
Model calls
Tool calls
Critical path latency
Parallelism ratio
Tokens
Replans
Failed nodes
```

這會讓使用者直接看到：

> **「AI 思考更多」與「系統排程得更好」是兩種完全不同的能力。**

---

# Code / GitHub

## SqueezeAILab/LLMCompiler

值得研究：

```text
src/llm_compiler/
├ planner.py
├ task_fetching_unit.py
├ llm_compiler.py
└ constants.py
```

### `task_fetching_unit.py`

核心資料結構：

```text
Task
├ idx
├ tool
├ args
├ dependencies
├ thought
├ observation
└ is_join
```

核心 runtime：

```text
_get_all_executable_tasks()
_preprocess_args()
_run_task()
schedule()
aschedule()
```

`_get_all_executable_tasks()` 只允許 dependencies 的 Event 全部 set 的 task 執行；`schedule()` / `aschedule()` 使用 `asyncio.create_task()` 並行 dispatch。

### `llm_compiler.py`

核心：

```text
Planner
→ TaskFetchingUnit
→ Joiner
→ Finish / Replan
```

`max_replans` 是顯式 runtime budget，而不是無限模型反思。

---

## Google ADK

2026 文件顯示 template workflows 清楚區分：

```text
Sequential
Parallel
Loop
```

這些 workflow 的 control flow 是 deterministic，不由 LLM 控制。ADK 2.0 Python/Go 又將 template workflow 的重心轉向 graph-based / dynamic workflows。

對 Hermes 的意義：

```text
不要讓模型負責所有 orchestration。
```

模型負責不確定性；Runtime 負責可確定的控制流。

---

## OpenAI Agents SDK

Multi-agent orchestration 的兩個核心 pattern：

```text
Manager
→ agents as tools
→ manager retains control
```

與：

```text
Handoff
→ specialist becomes active agent
```

Handoff 本身會以 tool schema 暴露給 LLM；Runtime 在模型選擇後真正切換 active agent。

因此 Hermes Knowledge Graph 應把 Handoff 放在：

```text
Delegation Decision
→ Runtime Dispatch
```

而不是當作獨立「推理能力」。

---

# Papers

## ReAct: Synergizing Reasoning and Acting in Language Models

Authors: Shunyu Yao, Jeffrey Zhao, Dian Yu, Nan Du, Izhak Shafran, Karthik Narasimhan, Yuan Cao  
Year: 2022/2023

核心：Reasoning trace 與 environment action interleave。

Knowledge Graph：

```text
Planning Architecture
→ Observation-Coupled Planning
→ ReAct
```

限制：高度 sequential；modern reasoning models 內部 reasoning 不一定以可見 Thought trace 呈現，因此不應將 ReAct 的文字 Thought 格式當作所有 production agent 的必要條件。

## ReWOO: Decoupling Reasoning from Observations for Efficient Augmented Language Models

Authors: Binfeng Xu, Zhiyuan Peng, Bowen Lei, Subhabrata Mukherjee, Yuchen Liu, Dongkuan Xu  
Year: 2023

核心：Planner → Worker → Solver；把 planning 與 observation consumption 解耦。

論文報告 HotpotQA 上約 5× token efficiency、4% accuracy improvement；這是特定 benchmark 結果，不應泛化為所有 tool environments。

Knowledge Graph：

```text
Planning Architecture
→ Observation-Decoupled Planning
→ ReWOO
```

## An LLM Compiler for Parallel Function Calling

Authors: Sehoon Kim, Suhong Moon, Ryan Tabrizi, Nicholas Lee, Michael W. Mahoney, Kurt Keutzer, Amir Gholami  
Year: 2023

核心：

```text
Function Calling Planner
→ Task Fetching Unit
→ Parallel Executor
→ Join/Replan
```

論文報告特定 benchmark 上最高約 3.7× latency speedup、6.7× cost saving、約 9% accuracy improvement over ReAct；這是論文設定結果。

Knowledge Graph：

```text
System Reasoning
→ DAG Planning
→ Runtime Scheduling
→ Parallel Tool Execution
```

## Divide-Then-Aggregate

Authors: Dongsheng Zhu et al.  
Year: 2025

核心：把 tree-like tool search path 轉成 DAG，模型學習將問題拆成可平行工具子任務，再 aggregation 決定後續 action。

Knowledge Graph：

```text
Tool Learning
→ Parallel Task Decomposition
→ DAG Tool Invocation
```

---

# Knowledge Graph 新增 Node / Edge

新增：

```text
Reasoning Architecture
├ Model Reasoning
├ System Reasoning
├ Observation Coupling
└ Delegation Reasoning
```

```text
Planning Runtime
├ Goal Decomposition
├ Planning IR
├ Dependency Graph
├ DAG Compiler
├ Scheduler
├ Critical Path
├ Joiner
├ Replanner
├ Plan Version
└ Plan Patch
```

```text
Task State
├ PENDING
├ READY
├ RUNNING
├ BLOCKED
├ DONE
├ FAILED
└ UNKNOWN
```

新增 edges：

```text
Model Reasoning
--produces-->
Planning IR

Planning IR
--compiled into-->
Execution Graph

Dependency Graph
--constrains-->
Scheduler

Scheduler
--dispatches-->
Tool / Agent / GUI Actions

Observation
--updates-->
Task State

Verification Failure
--triggers-->
Replanner

Replanner
--produces-->
Plan Patch

Plan Patch
--updates-->
Execution Graph

Permission Policy
--filters-->
Runnable Tasks

Transaction Conflict
--blocks-->
Parallel Execution
```

完整 Agent OS 主幹更新為：

```text
User Goal
↓
Context / Memory
↓
Model Reasoning
↓
Planning IR
↓
Runtime Compiler
↓
Dependency Graph
↓
Scheduler
↓
Permission / Transaction
↓
Tool / MCP / GUI / Agent
↓
Environment
↓
Observation / Evidence
↓
Verification
↓
Join / Replan
↓
Plan Patch
↓
Continue / Stop
```

---

# Unknown / Open Questions

1. **Planning IR 的最佳 schema 是什麼？** DAG task list、state machine、Petri net、event-sourced command graph 各自適用不同 workload；尚無單一標準。

2. **Parallel planning 的 correctness 如何驗證？** 工具沒有顯式資料庫 transaction semantics 時，模型可能漏標 hidden dependency，造成 race condition 或 stale read。

3. **Dynamic environment 下，多久應 replan？** 每 observation 都 replan 接近 ReAct、只在 join 點 replan 接近 compiler architecture；需要 risk/uncertainty-aware trigger。

---

# 下一輪研究

下一輪應研究 **Multi-Agent × Shared State × Coordination Runtime**，但不做表面角色清單，而是追真正底層：

```text
Supervisor
↓
Task Graph
↓
Worker Lease / Ownership
↓
Shared State
↓
Message / Event Bus
↓
Concurrent Writes
↓
Conflict Resolution
↓
Result Reduction
↓
Verifier
```

要回答：
- 多 Agent 是否只是 DAG worker pool？
- Agent 間到底共享 conversation、structured state、event log 還是 memory store？
- parallel agents 如何避免 race condition？
- supervisor 是否需要 LLM，還是 deterministic scheduler 即可？
- multi-agent 的提升來自 specialization、parallelism，還是更多 test-time compute？

## 本輪進化檢查

- 目前最缺的一層：**Multi-Agent shared-state concurrency**。
- 理解最淺節點：**Planning IR standardization**。
- 仍偏名詞化：**Graph of Thoughts 與真正 execution graph 的關係**。
- 最值得繼續讀原始碼：**LLMCompiler TaskFetchingUnit / Planner、Google ADK graph runtime、LangGraph Pregel runtime**。
- 最值得追引用：**ReAct → ReWOO → LLMCompiler → DAG/parallel tool-learning**。
- 最適合視覺模擬：**Reasoning Runtime X-Ray + DAG Scheduler**。
- 最值得 Hermes 實作的架構：**Model Planner + typed Planning IR + deterministic DAG scheduler + explicit Join/Replan gate**。

本輪最重要結論：

> **可靠 Agent 不應讓 LLM 同時扮演 planner、scheduler、dependency tracker、transaction manager 與 verifier。模型最擅長處理不確定性；可確定的控制流應編譯進 Runtime。**
