# AI Agent × Multimodal Research Report — World State × Observation Memory × Verification Runtime

時間：2026-09-08 15:54 Asia/Taipei

## 與歷史研究比較

本輪接續既有四份研究：

- `2026-09-08-multimodal-runtime.md`
- `2026-09-08-multimodal-fusion.md`
- `2026-09-08-cross-attention-memory-topology.md`
- `2026-09-08-computer-agent-perception-grounding-action.md`

上一輪已建立：

```text
Environment
→ Observation
→ Perception
→ Grounding
→ Executable Action
→ Environment Transition
→ New Observation
```

但仍存在核心缺口：**Agent 怎麼知道 action 真正達成了使用者目標？**

因此本輪不重複 perception / grounding，而是深入研究：

```text
Goal
→ Expected State
→ Action
→ Actual Environment State
→ Evidence Acquisition
→ Verification
→ State Update / Replan
```

本輪核心結論：

> `No exception`、`click succeeded`、`new screenshot exists` 都不是 task success。可靠 Computer Agent 需要把 Verification 建模成獨立 Runtime，而且 Verification 本身可能需要再次使用 GUI、system tools、application tools、files 或 APIs 主動取得證據。

---

# 本小時新發現

## 新架構：Propose → Probe → Verify

Interactive Reward Agent (IRA, 2026) 提出 propose-then-verify：先根據 task instruction 產生完成條件，再從執行後環境主動取得證據，透過 system tools、application tools、GUI tools 驗證。其核心不是看 trajectory 最後一張 screenshot 猜成功與否，而是把 verification 當成可互動的 environment investigation。

架構可抽象成：

```text
Task Goal
↓
Completion Condition Compiler
↓
Expected State / Predicates
↓
Evidence Planner
↓
Probe Environment
├ GUI
├ Application API
├ System State
├ Files
└ Settings
↓
Evidence Ledger
↓
Verifier
├ satisfied
├ violated
└ unknown
↓
Success / Replan / More Probe
```

這使 Verification 與 Tool Calling、Computer Use 再次匯合：Verifier 本身也是一個 tool-using agent/runtime。

## 新 benchmark / 系統訊號：OSWorld 2.0 的長任務失敗已從「點錯」轉向「忘記驗證與 hidden state」

OSWorld 2.0（2026）包含 108 個長任務 workflow，人類完成時間中位數約 1.6 小時，Claude Opus 4.7 的平均執行約 318 tool calls。論文特別指出 frontier agents 在長任務中會遺失 constraint、忽略中途新增資訊、猜測 hidden state、跳過 verification。

這代表：

```text
GUI Grounding Accuracy
```

已不足以代表可靠 Computer Agent。

新的核心能力是：

```text
State Tracking
+
Evidence Recovery
+
Outcome Verification
+
Replanning
```

## 新工程實作：OSWorld 2.0 Maestro 把 Evaluator 做成 Controller 的 Quality Gate

OSWorld-V2 repo 的 `mm_agents/maestro/maestro/evaluator.py` 中，Evaluator 讀取完整 `NewGlobalState`，依 trigger code 選擇不同 evaluator role：

```text
WORKER_SUCCESS
WORKER_STALE_PROGRESS
PERIODIC_CHECK
FINAL_CHECK
```

Evaluator 的輸入不只是一個 final answer，而包括：

- task / subtask
- global state
- screenshot
- command history
- artifacts
- supplement

最後產生 `GateCheck`，寫回 global state，控制後續 workflow。

因此可確認：在實際 multi-module Computer Agent 架構裡，Verification 可以是 Runtime control-flow 的一級 component，而不是 answer generation 後的附帶 prompt。

---

# 本小時最重要 5 個發現

## 1. Environment State、Observation、Belief State、Expected State 必須分開

這四個概念不能再混在一起。

### Environment State

真實世界此刻的狀態：

```text
S_t
```

例如：

```text
file exists = true
spreadsheet cell B7 = 42
browser logged_in = true
email sent = true
setting.dark_mode = false
```

這些可能根本不完全出現在螢幕上。

### Observation

Agent 當下看得到的投影：

```text
O_t = Observe(S_t)
```

例如：

```text
screenshot
DOM
a11y tree
terminal output
tool result
```

Observation 通常是不完整的。

### Belief State

Agent 根據歷史 observation/action 推測出的內部狀態：

```text
B_t = Update(B_t-1, A_t-1, O_t)
```

例如：

```text
「我認為檔案已經儲存」
「我認為使用者已登入」
```

Belief 可能是錯的。

### Expected State

根據 task goal 推導出應該成立的狀態：

```text
E_goal
```

例如使用者要求：

```text
把報告另存為 report.pdf 並寄給 Alice
```

可編譯成：

```text
C1: report.pdf exists
C2: report.pdf is latest version
C3: recipient == Alice
C4: attachment == report.pdf
C5: message status == sent
```

真正成功判定是：

```text
Actual Environment State
≈ satisfies
Expected State / Conditions
```

而不是：

```text
Model says "done"
```

### Knowledge Graph 修正

```text
World State
≠ Observation
≠ Belief State
≠ Expected State
```

這是本輪最重要的底層拆分。

---

## 2. Verification 的第一步其實是「Goal → Predicates」

不能直接拿一句自然語言 goal 與 screenshot 做 binary judge。

更可靠的 pipeline：

```text
User Goal
↓
Constraint Extraction
↓
Completion Condition Compiler
↓
Predicates
↓
Evidence Requirements
↓
Verification Plan
```

例如：

```text
Goal:
「把 Q3 預算改成 120 萬並存檔」
```

先拆：

```text
P1: workbook target == correct workbook
P2: Q3 budget == 1,200,000
P3: formula dependencies are valid
P4: file/save state persisted
```

再為每個 predicate 指定 evidence source：

```text
P1 → workbook metadata / title
P2 → cell value
P3 → formula / error scan
P4 → file modified timestamp / save state
```

因此 verification 不是單一 LLM classification，而可以形式化成：

```text
Goal
→ Condition Set
→ Evidence Mapping
→ Probe
→ Predicate Evaluation
→ Aggregate Decision
```

這正是 IRA propose-then-verify 的底層精神。

---

## 3. Screenshot-only Verification 對 hidden state 天生不完整

Screenshot 能驗證：

```text
modal appears
button state changes
text visually rendered
page navigation
```

但不一定能驗證：

```text
file actually persisted
email actually sent
system configuration committed
DB row updated
attachment exact bytes
background job completed
hidden form state
```

因此可靠驗證需要 adaptive sensing：

```text
Condition
↓
What evidence is sufficient?
↓
Choose probe
├ Screenshot
├ DOM
├ App tool
├ File read
├ Database query
├ System command
└ API
```

這建立新的 Agent OS component：

```text
Evidence Router
```

與上一輪的 `Action Router` 對稱：

```text
Action Router
→ decides how to change world

Evidence Router
→ decides how to inspect world
```

兩者共同形成完整 environment interaction runtime。

---

## 4. Step Verification 與 Final Verification 是兩種不同控制迴路

WorldGUI 提出的 Step-Check，以及 OSWorld 2.0 Maestro 的 periodic / worker-success / final-check gate，都顯示 Verification 不應只在最後執行一次。

### Step-level verification

```text
Action A_t
↓
Expected local delta ΔE_t
↓
Execute
↓
Observe ΔO_t
↓
Check local transition
↓
continue / retry / replan
```

例如：

```text
Expected:
Login modal disappears + dashboard appears

Actual:
Login modal stays + error toast appears
```

此時應立即 replan，不要繼續後面 20 個 action。

### Final verification

```text
All subtasks completed
↓
Re-read global goal
↓
Collect final evidence
↓
Evaluate all constraints
↓
fulfilled / incomplete
```

這兩層可以減少兩種 failure：

```text
Error Propagation
```

與：

```text
Premature Termination
```

因此 Agent Loop 應從：

```text
Observe → Reason → Act → Observe
```

升級成：

```text
Observe
→ Update Belief
→ Plan
→ Predict Expected Delta
→ Act
→ Observe
→ Verify Delta
→ Update State
→ Continue / Replan
```

---

## 5. Verification Runtime 可以直接成為 Reward Generator

IRA 的重要研究價值不只在「評測」。它把 environment-grounded verification 產生的結果作為訓練 reward signal；論文在 GUI-RewardBench 報告 86.9% evaluator accuracy，並將其用於 GUI agent RL，報告 OSWorld success rate 34.0%。這些是該論文的實驗結果，不應直接泛化到所有 GUI Agent。

底層鏈：

```text
Agent Trajectory
↓
Post-execution Environment
↓
Verification Runtime
↓
Outcome / Predicate Scores
↓
Reward
↓
Policy Update
```

因此同一個 Verification Runtime 可以同時服務：

```text
Runtime Reliability
Evaluation
Benchmark Grading
Test-time Scaling
Reinforcement Learning
Regression Testing
```

這意味 Hermes Console 未來若把 verification event 結構化保存，就不只是 UI debug 資料，也可能成為後續 agent training/evaluation dataset。

---

# Architecture Breakdown

## Reliable Computer Agent Verification Runtime

```text
User Goal
↓
Goal / Constraint Parser
↓
Completion Condition Compiler
↓
Expected State Model
├ predicate P1
├ predicate P2
├ predicate P3
└ invariant I1
↓
Agent Runtime
↓
Plan
↓
Expected Local State Delta
↓
Action Router
├ GUI
├ MCP
├ API
└ Code
↓
Environment
↓
Observation Acquisition
├ Screenshot
├ DOM
├ A11y
├ Tool Result
├ File/System State
└ Application State
↓
Observation Delta Extractor
↓
Belief State Update
↓
Step Verifier
├ pass → continue
├ fail → diagnose / replan
└ unknown → evidence probe
↓
...
↓
Final Verifier
↓
Evidence Router
├ GUI probe
├ system probe
├ app tool
├ file read
└ API query
↓
Evidence Ledger
↓
Predicate Evaluation
↓
Task Status
├ fulfilled
├ incomplete
└ uncertain
```

### Runtime responsibility boundaries

```text
Planner
→ what should happen

Action Router
→ how to change environment

Environment
→ what actually happens

Observer
→ what can be sensed

Belief Manager
→ what Agent currently thinks is true

Evidence Router
→ how to obtain stronger proof

Verifier
→ whether evidence satisfies expected state
```

這套分層比「Agent 自我反思一下有沒有完成」更可測量，也更容易 debug。

---

# Bottom-Level Logic

## Expected State vs Actual State 的最小可執行模型

將自然語言 goal 編譯成條件集合：

```text
C = {c1, c2, ..., cn}
```

每個條件不是只有 `true/false`，實務上應至少允許三值：

```text
TRUE
FALSE
UNKNOWN
```

原因：Observation 不完整。

例如：

```text
c1 = file_exists("report.pdf")
c2 = spreadsheet("Budget.xlsx", "Q3") == 1200000
c3 = email_sent(to="alice@example.com", attachment="report.pdf")
```

Verifier 執行：

```text
for condition in C:
    evidence = evidence_router.acquire(condition)
    status = evaluate(condition, evidence)

    if status == UNKNOWN:
        evidence = acquire_more_specific_evidence(condition)
```

最後：

```text
SUCCESS iff
all required conditions == TRUE
and no hard invariant == FALSE
```

而不是：

```text
SUCCESS iff
last action returned 200 OK
```

### State transition verification

每一步可以建立預測：

```text
S_t
+
A_t
↓
Expected ΔS_t+1
```

執行後：

```text
Environment
↓
O_t+1
↓
Observed Δ
```

比較：

```text
Expected Delta
vs
Observed Delta
```

若不一致：

```text
Mismatch
↓
Failure Classifier
├ action did not execute
├ wrong target
├ unexpected popup
├ hidden state changed
├ external condition changed
└ observation insufficient
↓
Retry / Replan / Probe
```

這其實是 Computer Agent 的 lightweight world-model loop。

重要區分：這裡的 `World Model` 不一定是獨立訓練的 neural world model；最初可以只是 structured expected-transition model + belief state manager。

---

# Observation Memory：本輪正式定義

上一輪 Observation Memory 還只是一個名稱。本輪可進一步拆成四層：

```text
Observation Memory
├ Raw Observation Store
│  ├ screenshot
│  ├ DOM snapshot
│  └ tool result
│
├ Delta / Event Memory
│  ├ button changed
│  ├ file appeared
│  └ page navigated
│
├ Belief State
│  ├ current app
│  ├ selected file
│  ├ login state
│  └ inferred task state
│
└ Evidence Ledger
   ├ condition
   ├ evidence source
   ├ timestamp
   ├ confidence
   └ status
```

### 為什麼不能只保存 screenshot history？

因為長任務若保存每一張畫面：

```text
hundreds of actions
×
high-resolution screenshots
```

會快速增加 storage、retrieval、vision encoder 與 context 成本。

因此更合理的 runtime 可以：

```text
Raw screenshot
↓
Delta Extraction
↓
Semantic Event
↓
Belief Update
↓
Evidence Ledger
```

只在需要 forensic verification / re-grounding 時重新取 raw observation。

這是工程設計推論，仍需要 benchmark 比較 raw-history vs event-state memory 的可靠度與成本。

---

# Visual Simulation Idea

## World State & Verification X-Ray

Hermes Console 可建立一個互動式「狀態差異與證據」模擬器。

左側：使用者 Goal

```text
把 Budget.xlsx 的 Q3 改成 1,200,000，存檔後寄給 Alice。
```

中間自動生成 Expected State：

```text
□ P1 correct workbook opened
□ P2 Q3 == 1,200,000
□ P3 workbook persisted
□ P4 recipient == Alice
□ P5 correct attachment
□ P6 message sent
```

右側顯示 Actual / Evidence：

```text
P1 TRUE
source: window metadata

P2 TRUE
source: spreadsheet cell read

P3 UNKNOWN
source: screenshot insufficient
→ PROBE FILE STATE

P4 TRUE
source: compose fields

P5 FALSE
source: attachment metadata

P6 NOT EVALUATED
```

下方 Timeline：

```text
State S0
↓
Action A1
↓
Expected Δ1
↓
Observed Δ1
✓ verified

Action A2
↓
Expected Δ2
↓
Observed Δ2
✕ mismatch
↓
Diagnose
↓
Replan
```

### 可切換的檢視模式

```text
Raw Observation
Belief State
Expected State
Environment Evidence
State Diff
Verification Gate
```

### Failure Injection

可模擬：

```text
Save silently failed
Attachment is stale version
Email remained in drafts
Popup intercepted click
Network request pending
File path changed
DOM says success but backend failed
```

目的：讓一般人直接看懂：

> Agent 說「完成」不是成功；成功必須是可驗證的 environment state transition。

---

# Code / GitHub

## OSWorld 2.0 / Maestro

Repo：`xlang-ai/OSWorld-V2`

值得看的目錄：

```text
mm_agents/maestro/
├ maestro/
│  ├ evaluator.py
│  ├ new_global_state.py
│  ├ controller / manager related modules
│  └ sub_worker/
└ prompts/module/
   ├ evaluator/
   │  ├ worker_success_role.txt
   │  ├ periodic_role.txt
   │  └ final_check_role.txt
   └ system_architecture.txt
```

### `evaluator.py`

確認的工程模式：

```text
Controller trigger
↓
Evaluator.quality_check()
↓
read NewGlobalState
↓
build prompt by trigger
↓
include screenshot + task/history/state
↓
Evaluator model
↓
GateDecision
↓
GateCheck persisted into global state
```

這是一個很好的 `Verification Runtime as Control Plane` 實例。

### 值得注意的限制

目前這種 evaluator 仍高度依賴 LLM interpretation + screenshot/global-state context。與 IRA 的 environment-state probe 相比，後者更進一步把「驗證缺乏證據」轉成下一個工具動作。

因此 Hermes 可以融合兩者：

```text
Maestro-style Gate Runtime
+
IRA-style Active Evidence Acquisition
```

---

## WorldGUI

核心 agent modules：

```text
Planner-Critic
Step-Check
Actor-Critic
```

值得研究的重點不是 leaderboard，而是 `Step-Check` 代表 intermediate verification 已被提升成 Agent pipeline 的明確 module。

---

## Interactive Reward Agent (IRA)

Paper：arXiv:2607.25904

目前公開摘要已足以確認：

```text
Task Instruction
↓
Propose Completion Conditions
↓
Post-execution Environment
↓
System / Application / GUI Tools
↓
Verify Evidence
↓
Task Evaluation / Reward
```

下一輪應優先找到與閱讀其公開 code（若已發布），特別追：

```text
condition representation
evidence tool schema
probe planner
aggregation rule
reward conversion
```

---

# Papers

## 1. Interactive Reward Agent: GUI Task Evaluation via Environment-State Verification

**Authors:** Chenrui Shi, Yuwei Wu, Yang Liu, Ruining Feng, Zirui Shang, Zhi Gao, Lifeng Fan, Che Sun  
**Year:** 2026  
**arXiv:** 2607.25904

### Architecture

```text
Task
→ Propose Completion Conditions
→ Interactive Environment Probing
→ Evidence
→ Verification
```

### Contribution

將 GUI evaluation 從 trajectory/screenshot judge 推向 environment-state-aware interactive verification，並將 evaluator 輸出用作 training reward。

### Reported result

論文報告 GUI-RewardBench evaluator accuracy 86.9%，並用於 GUI agent RL，報告 OSWorld success rate 34.0%。這些是論文特定設定下的結果。

### Limitation / open issue

Verifier 自己也可能 tool-select 錯誤、讀錯 state、漏掉 constraint，因此「Agent-as-a-Judge」仍需要專門 benchmark。

### Knowledge Graph edges

```text
Verification Runtime
→ Evidence Acquisition
→ Environment State

Verification Runtime
→ Reward Model / RL
```

---

## 2. OSWorld2.0: Benchmarking Computer Use Agents on Long-Horizon Real-World Tasks

**Authors:** Mengqi Yuan et al.  
**Year:** 2026  
**arXiv:** 2606.29537

### Contribution

把 Computer Use 評測從短 GUI task 拉到 108 個長工作流程，加入 dynamic environment、cross-source reasoning、implicit-state inference、visual-spatial precision 等現象。

### Critical finding for this Knowledge Map

長 horizon 的核心失敗之一不是低階 click，而是：

```text
constraint loss
hidden-state inference failure
missed mid-task information
verification skipping
```

### Knowledge Graph edge

```text
Long-Horizon Planning
→ State Tracking
→ Verification
```

---

## 3. WorldGUI: An Interactive Benchmark for Desktop GUI Automation from Any Starting Point

**Year:** 2025

### Architecture contribution

```text
Planner-Critic
+
Step-Check
+
Actor-Critic
```

把「initial state 不同」視為真實 GUI Agent 的核心問題，並加入 intermediate check/correction。

### Knowledge Graph edge

```text
Dynamic Initial State
→ Step Verification
→ Replanning
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
World State
├ Environment State
├ Hidden State
└ External State
```

```text
Agent State Model
├ Observation
├ Belief State
├ Expected State
├ State Delta
└ Invariant
```

```text
Verification Runtime
├ Completion Condition Compiler
├ Evidence Planner
├ Evidence Router
├ Evidence Ledger
├ Step Verifier
├ Final Verifier
├ Gate Decision
└ Reward Generator
```

```text
Observation Memory
├ Raw Observation Store
├ Delta / Event Memory
├ Belief State Store
└ Evidence Ledger
```

## Edges

```text
User Goal
--compiled into-->
Expected State

Environment State
--projected through sensing-->
Observation

Observation History
--updates-->
Belief State

Action
--causes-->
Environment Transition

Environment Transition
--produces-->
State Delta

Expected State Delta
--compared with-->
Observed State Delta

Evidence Router
--queries-->
Environment

Evidence
--supports/refutes-->
Completion Predicate

Verifier
--controls-->
Continue / Probe / Replan / Stop

Verification Result
--can become-->
RL Reward
```

最重要的新完整鏈：

```text
Goal
↓
Expected State
↓
Plan / Action
↓
Environment State Change
↓
Observation
↓
Belief Update
↓
Evidence Acquisition
↓
Verification
↓
Replan / Stop
```

---

# 已確認事實 / 工程實作 / 合理推論

## 已確認事實

- OSWorld 2.0 將長任務 state/constraint/verification failure 列為重要 challenge。
- IRA 採 propose-then-verify，主動使用 environment tools 取得完成證據。
- Browser/GUI runtime 的 `step(action)` 只代表環境執行了一個 timestep，不代表 goal success。

## 工程實作

- OSWorld-V2 Maestro 有獨立 `Evaluator` quality gate。
- Evaluator 依 worker-success、periodic、final-check 等 trigger 執行並把 GateCheck 寫回 global state。
- Evaluator 可以讀 screenshot、command history、artifacts 與 shared global state。

## 合理推論 / 尚需 benchmark

- Hermes 可把 Observation Memory 壓縮成 semantic delta + belief state + evidence ledger，raw screenshot 作為可回溯 cold storage。
- `Action Router` 和 `Evidence Router` 應成為對稱的 Environment I/O abstraction。
- structured expected-state verification 可能比單純 LLM self-reflection 更容易 debug、測量與建立 reward，但實際 cost/quality 需 benchmark。

---

# Unknown / Open Questions

1. **Completion Condition Compiler 如何避免漏條件？**  
   如果 goal → predicates 本身漏掉「附件必須是最新版本」，後面的 verifier 再完美也會錯判成功。

2. **Belief State 應如何處理 conflicting evidence？**  
   Screenshot 顯示成功，但 API/state probe 顯示尚未 committed 時，哪個 source 優先？需要 provenance / confidence / freshness model。

3. **Verifier 的 probe budget 應如何控制？**  
   完整驗證每個 hidden state 可能讓 Agent 成本極高。需要 risk-aware verification：高風險不可逆 action 深驗證，低風險 action 可抽樣或局部驗證。

---

# 下一輪研究

下一輪建議深入：

## Agent Safety × Permission × Transaction Runtime

因為一旦建立：

```text
Expected State
+
Verification
```

下一個真正 Agent OS 缺口是：

```text
哪些 action 可以直接做？
哪些 action 必須先批准？
哪些 action 可 rollback？
```

研究鏈：

```text
Intent
↓
Risk Classification
↓
Permission Check
↓
Precondition Verification
↓
Action
↓
Side Effect
↓
Postcondition Verification
↓
Commit / Rollback / Escalate
```

優先研究：

- Agent permission model
- capability security
- MCP authorization / least privilege
- browser/computer destructive action confirmation
- transaction / idempotency
- compensating action
- sandbox boundary
- prompt injection crossing tool boundary

並建立互動視覺 Demo：

```text
Agent Transaction Simulator
```

顯示：

```text
Plan
→ Permission
→ Precondition
→ Action
→ Side Effect
→ Verify
→ Commit / Rollback
```

---

# 本輪進化檢查

**目前最缺的一層：** Permission / Transaction / Rollback Runtime。  
**理解最淺節點：** Completion Condition Compiler。  
**仍偏名詞化的概念：** Belief-state conflict resolution。  
**最值得繼續讀原始碼：** OSWorld-V2 Maestro `Evaluator + Controller + NewGlobalState`；IRA code（公開後優先）。  
**最值得追引用：** IRA → Agent-as-a-Judge / GUI reward / environment-aware verification。  
**最值得視覺模擬：** World State & Verification X-Ray。  
**最值得 Hermes 實作的架構：** `Action Router + Evidence Router + Explicit Expected State + Verification Gate`。

本輪最重要的底層結論：

> **Reliable Agent 不是「做完 action 後自己覺得成功」，而是把自然語言目標編譯成可驗證狀態，主動從環境取得證據，再根據 Expected State × Actual State 決定 Continue / Probe / Replan / Stop。**
