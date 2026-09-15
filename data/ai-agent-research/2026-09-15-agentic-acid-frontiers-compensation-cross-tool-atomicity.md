# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 18:50（Asia/Taipei）**

**本輪主題：Agentic ACID × Progress Frontiers × Compensation × Cross-Tool Atomicity × TOCTOU**

## 與歷史研究比較

上一輪已建立 `SelectiveExecution → RuntimeContract → SemanticTransaction → CommitGate → Rollback`，並確認單一 tool call 安全不等於 task-level transaction 安全。本輪不重複 selective execution，而往更底層追問：多個 Agent、分支與異質工具同時改變世界時，runtime 如何知道「何時可以安全 settlement」、哪些 effect 能 rollback、哪些只能 compensate，以及 classical ACID 到 agent workflow 後哪些性質仍成立。

## 本小時新發現

1. **Atomix (2026)** 把 tool execution 與 effect settlement 分離：transaction 使用 epoch，記錄 read/effect scopes，並以 per-resource frontier 判斷較早衝突工作是否已耗盡後才 commit。
2. **Agentic Transaction / ACID-Agent (2026)** 將 ACID 重述為 Semantic Atomicity / Consistency / Isolation / Durability，並公開 ACID-Agent 原始碼。
3. **Cordon (2026)** 與 Atomix 解不同層：Cordon 側重 task-scoped semantic transaction、lineage、shadow state、effect outbox；Atomix更偏 settlement ordering、speculation/contention、effect class。
4. **MT-AgentRisk / ToolShield (ICML 2026)** 再次支持 trajectory-level safety：multi-turn tool setting 的 ASR 平均增加約 16.1%，說明 turn-local guard 不足。
5. 真正的 `CrossToolAtomicity` 不能被宣稱已解決：如果多個外部 endpoint 沒有共同 transaction protocol，runtime 無法 magically 提供真正 distributed atomic commit；只能 buffer、gate、idempotency、compensation、reconciliation 或 human escalation。

## 本小時最重要 5 個發現

### 1. Tool return ≠ effect settlement

**已確認論文結果 / system design：** Atomix 指出 common orchestrator 把 tool return 當作 effect 已完成，但 speculative branch、retry 或 concurrent agent 可能讓 losing branch 的副作用已經外洩。

底層應拆成：

`Intent → Tool Call → Execute → Effect Record → Seal Footprint → Frontier Check → Settle(COMMIT/ABORT)`

因此 Hermes 新增：

`ToolExecution ≠ EffectSettlement`

**重要性：** 模型已經取得 tool result，不代表世界狀態應立即永久化。

**限制：** Atomix 是 runtime prototype；不能由此推論 heterogeneous remote services 已具 distributed exactly-once 或 true 2PC。

來源：Atomix arXiv https://arxiv.org/abs/2602.14849

### 2. Progress Frontier 是 concurrency safety 的底層機制

Atomix 為 transaction 配 epoch，對 resource 維護 frontier。概念上 transaction `T(e)` 只有在所有 touched resource 的 frontier 都已跨過 `e`，runtime 才能確認較早衝突工作不會再出現。

`Agent branches → epochs → read/effect scopes → per-resource frontier → progress predicate → settlement`

這與單純 lock 不同：它把「哪一批 effect 屬於一起」與「何時舊工作已耗盡」拆成兩個問題。

新增 Node：`TransactionEpoch`, `ResourceFrontier`, `ProgressPredicate`, `SettlementSafety`。

### 3. Effect 必須依可逆性與可延遲性分類

合理的 production taxonomy：

- `BUFFERABLE`：先 stage，commit 才外顯；abort 直接丟棄。
- `REVERSIBLE`：可先執行，但 abort 需要 inverse/compensation。
- `REVERSIBLE_WITH_COST`：能補償但有費用/資訊洩漏/延遲。
- `IRREVERSIBLE_GATED`：commit 前不能真正 externalize。
- `IRREVERSIBLE_UNGATED`：高危，不能假裝 rollback；需要預先 approval 或禁止 speculative execution。

因此：

`Rollback ≠ Compensation ≠ Reconciliation`

刪除 shadow file 可以 rollback；退款是 compensation；寄錯 email 通常只能 follow-up/reconcile，不能真的 undo。

### 4. Classical ACID 到 Agent 世界必須變成 semantic guarantees

**已確認官方論文：** Tsinghua 的 *Agentic Transaction: Towards ACID-Compliant Agent Systems* 將 ACID 改寫成 Semantic Atomicity、Semantic Consistency、Semantic Isolation、Semantic Durability，並以 exploration-execution-validation、transactional skill hubs、confidence-divergence validation、semantic dependency-aware isolation、transaction-aware semantic state management 實作 ACID-Agent；論文報告在其 benchmark 設定下較 SOTA（含 Claude Code）改善 10.6%。

來源：https://arxiv.org/abs/2608.13900
Code：https://github.com/TsinghuaDatabaseGroup/ACID-Agent

**工程原始碼確認：** repo 的 `da_agent/` 明確分為 `agent/`, `controllers/`, `envs/`, `review/`, `utils/`, `configs/`；`controllers/python.py` 在 Docker workspace 執行 Bash/Python/SQL，保存 stdout/stderr/exit code/execution metadata，說明 execution environment 本身就是 transaction architecture 的一層，而非 LLM prompt 的附屬品。

### 5. Cross-tool atomicity 的真正邊界在 external systems

**合理系統推論，尚非 universal theorem：** Gmail、GitHub、Drive、payment API、Browser、MCP server 若沒有共同 prepare/commit protocol，Hermes 無法只靠 Agent runtime 創造真正 atomic externalization。

因此 Hermes 應顯示 `AtomicityLevel`：

`LOCAL_ATOMIC → BUFFERED_ATOMIC → COMPENSATABLE → RECONCILABLE → IRREVERSIBLE`

並且 transaction planner 要優先把不可逆 effect 排到最後：

`Read/Explore → reversible mutations → verify → prepare → human/authority gate → irreversible release`

## Architecture Breakdown

### Hermes Transaction Kernel v2

```text
User Goal
↓
Goal / Authority Lock
↓
Planner
↓
Semantic Transaction Begin
↓
Dependency Graph Builder
├ read scopes
├ write/effect scopes
├ resource identities
└ irreversible boundaries
↓
Execution Scheduler
├ transaction epoch
├ speculative branches
└ concurrency dependencies
↓
Tool Adapter Layer
├ BUFFERABLE
├ REVERSIBLE
├ REVERSIBLE_WITH_COST
└ IRREVERSIBLE_GATED
↓
Effect Ledger + Result Lineage
↓
Transaction Seal
↓
Cross-Step Semantic Validation
↓
Resource Frontier / Freshness Validation
↓
TOCTOU Revalidation
↓
Commit Planner
├ release staged effects
├ finalize reversible effects
└ fire gated irreversible effects LAST
↓
Postcondition Verification
↓
Durable Audit / Recovery State
```

## Bottom-Level Logic

### A. Frontier settlement

```text
T1 epoch=41 writes Drive:fileA
T2 epoch=42 reads Drive:fileA and writes GitHub:issue7
T3 epoch=43 writes Drive:fileA

T2 cannot safely settle based only on its own completion.
Runtime needs evidence that relevant earlier conflicting work on touched resources is exhausted.
```

### B. TOCTOU window

Agent safety check at time `t0` is insufficient if state changes before commit at `t1`:

`Observe State(t0) → Plan → Risk Check → WAIT → State changes → Commit using stale assumption`

Hermes 應新增：

`PreconditionSnapshotHash`, `AuthorityVersion`, `ResourceVersion`, `CommitTimeRevalidation`。

Commit 前：

`current(resource_version) == validated(resource_version)`

否則：`ABORT / REPLAN / REAUTHORIZE`。

### C. Compensation dependency order

如果：

`A creates resource → B modifies it → C publishes reference`

abort 時不能任意 compensation；應沿 dependency DAG 反向：

`compensate(C) → compensate(B) → compensate(A)`

且每個 compensation 自己也必須有 outcome evidence 與 retry/idempotency state。

## Visual Simulation Idea

### Transaction Frontier Observatory × Cross-Tool Failure Lab

畫面左側：Agent branches / tool calls timeline；中央：每個 resource 的 frontier；右側：effect ledger。

可互動注入：

- speculative branch loses
- duplicate retry
- stale Drive version
- GitHub write contention
- permission revoked between check/commit
- email irreversible send
- compensation failure
- process crash after external effect but before local acknowledgement

每個 effect 顯示：

`EXECUTED / STAGED / EXTERNALIZED / SEALED / FRONTIER-SAFE / COMMITTED / COMPENSATING / RECONCILE_REQUIRED`

使用者可切換 `Immediate RPC`, `Saga`, `Cordon-style semantic transaction`, `Atomix-style frontier settlement`, `Hermes hybrid`，觀察 residue、stale write、latency、compensation count 與 irreversible leak。

## Code / GitHub

### ACID-Agent
https://github.com/TsinghuaDatabaseGroup/ACID-Agent

值得繼續看的路徑：

- `da_agent/agent/` — agent loop / orchestration
- `da_agent/controllers/` — execution controller
- `da_agent/envs/` — persistent execution environment
- `da_agent/review/` — validation/review
- `run_kramabench.py` — benchmark runtime / traces
- `Kramabench/benchmark/executor.py` — task execution
- `Kramabench/benchmark/evaluator.py` — outcome evaluation

已確認 `controllers/python.py` 使用 Docker workspace 執行 Bash/Python/SQL 並捕捉 execution metadata。

### Atomix
論文：https://arxiv.org/abs/2602.14849

本輪沒有找到可被可靠確認為該論文官方實作的 GitHub repository，因此不偽造 code-level audit；下一輪繼續追作者/論文 artifact。

## Papers

### Atomix: Timely, Transactional Tool Use for Reliable Agentic Workflows
Authors: Bardia Mohammadi, Nearchos Potamitis, Lars Klein, Akhil Arora, Laurent Bindschaedler  
Institutions: MPI-SWS / Aarhus University / EPFL  
Year: 2026  
URL: https://arxiv.org/abs/2602.14849  
Architecture: epoch + scope + frontier + effect-aware settlement  
Contribution: 將 execution 與 settlement 分離，處理 speculation/contention/irreversible effects。  
Limitations: prototype runtime；heterogeneous irreversible endpoints 不等於有 distributed atomic commit。

### Agentic Transaction: Towards ACID-Compliant Agent Systems
Authors: Zhaoyan Sun, Xiaoxiao Wang, Guoliang Li  
Institution: Tsinghua University  
Year: 2026  
URL: https://arxiv.org/abs/2608.13900  
Code: https://github.com/TsinghuaDatabaseGroup/ACID-Agent  
Architecture: semantic ACID + exploration/execution/validation + semantic state management  
Contribution: 把 database transaction guarantees 系統性轉譯到 long-horizon agents。  
Limitations: data-agent/benchmark context，不代表任意 browser/robot/payment workflow 已獲 ACID guarantee。

### Cordon: Semantic Transactions for Tool-Using LLM Agents
Authors: Zheng Chen et al.  
Year: 2026  
URL: https://arxiv.org/abs/2606.17573  
Architecture: task-level transaction manager + result lineage + shadow state + effect outbox + recovery metadata  
Contribution: containment boundary 高於 per-call guardrail。  
Limitations: semantic transaction 不等於所有 remote services 支援原生 atomic rollback。

### Unsafer in Many Turns: Benchmarking and Defending Multi-Turn Safety Risks in Tool-Using Agents
Authors: Xu Li et al.  
Venue: ICML 2026  
URL: https://openreview.net/forum?id=iSuqYRmG4A  
Benchmark: MT-AgentRisk  
Contribution: multi-turn tool-use safety benchmark；報告 ASR 平均增加約 16.1%，ToolShield 平均降低 ASR 約 30%。  
Limitations: benchmark / judge setup 與 production transaction correctness 不同。

## Unknown / Open Questions

1. **Cross-service commit protocol**：沒有 tool-side prepare/commit 時，Hermes 如何量化「看似 atomic、實際只是 compensatable」？
2. **TOCTOU + authority drift**：permission/resource/version 在 human confirmation 與真正 commit 之間變化時，哪一層負責 revalidation？
3. **Crash consistency**：外部 effect 已成功，但 Agent runtime 在 durable log 前 crash，如何做 idempotent recovery 與 reconciliation？

## 下一輪研究

**Crash Consistency × Idempotency Keys × Exactly-Once Illusion × Durable Effect Ledger × Recovery/Reconciliation**

下一輪優先追：write-ahead logging、outbox/inbox、idempotency keys、at-least-once vs exactly-once、external side-effect acknowledgement、crash window、distributed saga recovery，並映射到 MCP/Browser/GitHub/Drive/Email agent tools。

## Knowledge Graph 新增 Node / Edge

### Nodes

`TransactionEpoch`, `ResourceScope`, `ReadScope`, `EffectScope`, `ResourceFrontier`, `ProgressPredicate`, `EffectSettlement`, `EffectClass`, `BufferableEffect`, `ReversibleEffect`, `CostlyCompensation`, `IrreversibleGatedEffect`, `SemanticAtomicity`, `SemanticConsistency`, `SemanticIsolation`, `SemanticDurability`, `AtomicityLevel`, `TOCTOUWindow`, `CommitTimeRevalidation`, `CompensationDAG`, `ReconciliationState`, `CrossToolAtomicityBoundary`.

### Edges

`ToolExecution → PRECEDES → EffectSettlement`  
`TransactionEpoch → ORDERED_BY → ResourceFrontier`  
`ProgressPredicate → GATES → Commit`  
`EffectClass → DETERMINES → AbortStrategy`  
`IrreversibleEffect → REQUIRES → PreCommitGate`  
`Compensation → IS_NOT → Rollback`  
`SemanticTransaction → CONTAINS → ToolCalls`  
`Commit → REQUIRES → TOCTOURevalidation`  
`CrossToolAtomicity → LIMITED_BY → ExternalEndpointSemantics`  
`TrajectorySafety → CANNOT_BE_REDUCED_TO → StepSafety`

## 本輪結束檢查

**缺哪一層：** crash consistency / durable recovery / idempotency layer。  
**哪個節點最淺：** `CrossToolAtomicityBoundary`, `SemanticDurability`, `ReconciliationState`。  
**哪個概念仍只是名詞：** heterogeneous external systems 上真正的 `ExactlyOnceEffect`。  
**哪個系統值得讀原始碼：** ACID-Agent 的 `agent/`, `review/`, `run_kramabench.py`；若 Atomix artifact 公開則優先讀 transaction manager / progress tracker / adapters。  
**哪篇論文需追引用：** Atomix、Agentic Transaction、Cordon。  
**最適合視覺模擬：** Transaction Frontier Observatory × Cross-Tool Failure Lab。  
**最值得實作的 Agent 架構：** `Semantic Transaction Manager + Effect-Class Adapter + Frontier/Version Gate + TOCTOU Revalidation + Compensation/Reconciliation Engine`。

## 對「AI 到底怎麼運作」新增的一層

從使用者一句話到現實副作用，現在可再補成：

`UI → Agent → Context → Reasoning → Planning → Tool Intent → Transaction Kernel → Tool Adapter → Execution → Effect Ledger → Frontier/Version Validation → Commit → External World → Postcondition Evidence → Memory`。

關鍵不是讓 LLM 學會說「rollback」。真正可靠的 Agent 必須在模型之外有 runtime machinery，知道哪些副作用尚未 settlement、哪些可以撤銷、哪些只能補償、哪些永遠不能提前釋放，以及世界在檢查與 commit 之間是否已經改變。