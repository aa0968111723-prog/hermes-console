# 【AI Agent × Multimodal Research Report】

時間：2026-09-26 13:55（Asia/Taipei）

## 本小時新發現

本輪承接上一輪 Effect DAG / Saga Compensation，但不重複「compensation 不是 rollback」；焦點推進到 **Effect DAG isolation → concurrent sagas → semantic lock / reread / versioning → durable replay boundary**。

證據層級：
- 已確認官方資訊：Azure Saga pattern 明確指出 Saga 沒有跨服務內建 isolation，會出現 lost update、dirty read、fuzzy/nonrepeatable read；官方列出的 countermeasures 包含 semantic lock、commutative update、pessimistic view、reread value、version file、risk-based concurrency。
- 工程實作：Temporal durable execution 以 Event History 重建 workflow state；replay 不重新執行已完成工作，而是重放 history 來重建 deterministic workflow state。
- 論文結果：2022 Enhanced Saga Pattern 指出傳統 Saga 缺乏 isolation，提出 quota cache + commit-sync service，將部分 transaction 暫存在 memory/cache layer，待整體條件成立後再同步 commit。
- 合理推論：Hermes 的 Effect DAG 應將「dependency ordering」與「conflict ordering」分開，新增 Conflict Graph / Semantic Lock Lease / Version Witness。
- 尚未驗證假說：跨 MCP / Browser / REST provider 是否能建立統一 machine-readable ConflictKey / VersionWitness contract。

## 本小時最重要 5 個發現

### 1. Effect DAG 只描述因果依賴，不能描述並行衝突
兩個 DAG node 可以沒有 dependency edge，卻同時修改同一 remote resource。因此：
EffectDAG != ConflictGraph。
Hermes 需要第二張圖：
Operation -> ConflictKey(resource/business invariant) -> conflicting operation。
限制：ConflictKey 很多時候只能由 tool/provider contract 提供，LLM 推測不能作 hard correctness evidence。

### 2. Saga isolation anomaly 必須成為 runtime failure class
Azure 官方列出 lost update、dirty read、fuzzy/nonrepeatable read。這些不是 transport failure，也不是 model reasoning failure，而是 **ConcurrentEffectConflict**。
底層：
Read(version=v1) -> concurrent mutation -> write based on stale v1 -> lost update / stale decision。
因此 Agent Failure taxonomy 應加入：
TransportFailure / ExecutionFailure / SemanticUnknown / ConcurrentEffectConflict / CompensationFailure。

### 3. Semantic Lock 是 business-state fence，不等於 mutex
Azure 的 semantic lock 是 application-level semaphore，標示 compensable transaction 正在修改資料。對 Hermes 更適合抽象為：
ConflictKey + LeaseGeneration + OwnerLogicalOperationID + State(IN_PROGRESS/SETTLED)。
它必須有 generation/fencing token，否則 lease timeout 後舊 owner 仍可能 late-write，形成 ABA。

### 4. Reread + Version Witness 可以把 stale reasoning 變成可驗證 precondition
在 write 前重新讀值/版本：
Read(v1) -> Reason/Plan -> PreWriteReread(v2) -> compare(v1,v2)。
若 v1 != v2，不能直接執行舊 plan，必須 replan/reconcile。
這對 Agent 特別重要，因為 reasoning 本身可能耗時數秒到數分鐘；「模型想完」時世界狀態可能已變。

### 5. Durable replay 與 external effects 必須分離
Temporal Event History 能重建 workflow state並避免重跑已完成 workflow steps，但 external side effect correctness 仍需 Activity/tool 的 idempotency、effect record 或 reconciliation。
因此：
WorkflowReplayWitness != RemoteEffectWitness。
Hermes 應保存：
DecisionEvent + EffectIntent + DispatchEvent + ProviderReceipt + EffectWitness + VersionWitness。

## Architecture Breakdown

User Intent
-> Agent Context
-> Reasoning
-> Plan
-> Effect DAG Compiler
-> Dependency Graph
-> Conflict-Key Extraction
-> Conflict Graph
-> Version Snapshot
-> Semantic Lock / Lease Acquisition
-> Tool/MCP Dispatch
-> Remote Effect
-> Provider Receipt
-> Post-effect Version Witness
-> Node Settlement
-> Release/Fence Semantic Lock
-> DAG Settlement Watermark
-> Event History Checkpoint
-> Recovery Replay

Concurrent path：
DAG-A Node X -> ConflictKey(customer:42)
DAG-B Node Y -> same ConflictKey
-> conflict policy
-> serialize / reread / commute / reject / manual reconcile。

## Bottom-Level Logic

新增核心 invariant：

SafeMutation(op) =
DependencySatisfied(op)
AND ConflictPolicySatisfied(op)
AND VersionPreconditionValid(op)
AND EffectIdentityStable(op)

Optimistic path：
Read(resource, version=v)
-> reason
-> prepare mutation(expected_version=v)
-> provider compare-and-set / conditional write
-> success OR VERSION_CONFLICT
-> on conflict: reread -> replan。

Semantic-lock path：
Acquire(ConflictKey, LeaseGeneration=g)
-> mutate
-> obtain EffectWitness
-> settle
-> release(g)。

所有 late write 必須攜帶 fencing generation；provider 若無法驗證 generation，該 lock 只能是 advisory lock，不能稱為 correctness fence。

## Visual Simulation Idea

**Concurrent Agent Effect DAG / Isolation Simulator**

同時顯示兩個或多個 Agent DAG：
- dependency edges
- conflict edges
- resource version
- semantic lock owner/generation
- effect state
- compensation state
- event-history replay cursor

故障/競爭注入：
LOST_UPDATE
DIRTY_READ
FUZZY_READ
STALE_REASONING_WRITE
LEASE_EXPIRES_OLD_OWNER_WRITES
COMMUTATIVE_UPDATE
VERSION_CONFLICT
COMPENSATION_RACES_NEW_SAGA

UI 必須能顯示：
DEPENDENCY SAFE / CONFLICT UNSAFE
STALE PLAN
FENCED OLD OWNER
REPLAN REQUIRED
COMMUTATIVE / PARALLEL SAFE

## Code / GitHub

值得 Hermes 下一步落地的模組：
- runtime/effect-dag：Effect DAG 與 node lifecycle
- runtime/conflict：ConflictKey、ConflictGraph、VersionWitness
- runtime/leases：SemanticLockLease + fencing generation
- runtime/effects：RemoteEffectLedger
- runtime/history：Decision/dispatch/effect event history
- simulators：Concurrent Effect DAG Isolation Simulator

本輪 repository 歷史比對確認 data/ai-agent-research 已有大量底層研究，因此本輪避免重複 context/KV/MCP 基礎內容，新增 concurrency/isolation layer。

## Papers

1. Garcia-Molina, H.; Salem, K. “Sagas.” SIGMOD 1987. Architecture：long-lived transaction -> local transactions + compensating transactions。Contribution：用 semantic compensation 取代長時間 distributed atomic transaction。Limitation：不提供傳統 transaction isolation。
2. “Enhancing Saga Pattern for Distributed Transactions within a Microservices Architecture.” Applied Sciences 12(12):6242, 2022. Architecture：quota cache + commit-sync service。Contribution：針對 Saga isolation weakness。Limitation：額外 cache/coordination layer 與特定 microservice transaction model，不能直接視為通用 Agent solution。
3. Temporal Event History / Durable Execution engineering docs。Contribution：deterministic history replay 與 crash recovery。Limitation：workflow replay correctness 不自動等於 external semantic exactly-once。

## Unknown / Open Questions

1. MCP / Tool schema 是否應標準化 ConflictKey、expectedVersion、idempotency scope、compensation contract？
2. Browser/computer agent 沒有 provider-side CAS 時，如何建立強 VersionWitness，而不是 screenshot heuristic？
3. 多 Agent 共用 memory / RAG knowledge node 時，應採 MVCC、CRDT、semantic lock，還是 risk-based hybrid？

## 下一輪研究

鎖定：
**Agent world-state concurrency -> MVCC / optimistic concurrency control -> CRDT/commutativity -> shared Memory/RAG write conflicts -> multi-agent blackboard consistency -> ConflictKey machine-readable Tool Contract**。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
ConcurrentEffectConflict
ConflictGraph
ConflictKey
SemanticLockLease
LeaseGeneration
FencingToken
VersionWitness
StaleReasoningState
PreWriteReread
OptimisticEffectCommit
CommutativeEffect
WorkflowReplayWitness

新增 Edges：
EffectDAG --does_not_capture--> ConflictGraph
EffectNode --touches--> ConflictKey
ConflictKey --orders--> ConflictingEffectNodes
SemanticLockLease --guards--> ConflictKey
LeaseGeneration --fences--> StaleOwner
VersionWitness --validates--> MutationPrecondition
PreWriteReread --detects--> StaleReasoningState
CommutativeEffect --permits--> ParallelExecution
WorkflowReplayWitness --does_not_imply--> RemoteEffectWitness

## 本輪結束判斷

缺的層：Agent world-state 的通用 concurrency-control layer。
最淺節點：ConflictKey contract。
仍只是名詞：跨 provider 的 VersionWitness / fencing-token enforcement。
最值得讀原始碼：Temporal history replay/activity execution，以及具 MVCC/CAS 的 durable workflow/state engines。
最需追引用：Saga isolation、semantic locking、optimistic concurrency、CRDT 在 agent/shared-memory 的映射。
最適合視覺模擬：Concurrent Agent Effect DAG / Isolation Simulator。
最值得 Hermes 實作：Event-sourced Agent Runtime + EffectDAG + ConflictGraph + VersionWitness + Fenced SemanticLockLease + RemoteEffectLedger + DAGSettlementWatermark。
