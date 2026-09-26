# AI Agent × Multimodal Research Report — 2026-09-26 09:51 Asia/Taipei

## 本輪主題
Exactly-once side effects in LLM agents：從 RDMA transport witness 推進到 Agent Harness × Tool Contract × Idempotency Key × Late Commit。

## 與歷史研究比較
前幾輪已建立 Resource/Session/Capability Generation、RX-token/PSN delivery classification、RemoteEffectLedger，以及 Varuna 的 pre/post-failure classification。本輪不再重複 transport delivery，而回答更上一層問題：對 LLM Agent 的 Tool/MCP/Browser mutation，exactly-once 應由 model、agent harness 還是 tool contract 負責？

## 本小時新發現
新論文：Jiapeng Li, “Where Does Exactly-Once Live? Model, Harness, and Tool-Contract Effects on Duplicate Side Effects in LLM Agents”, arXiv:2609.29095, 2026-09-24。
新 benchmark/system：LIMBO，六種 deterministic sandbox services、12 種 service-boundary fault modes、25,930 episodes，直接以 committed-effect ledger 評分 duplicate side effects。
歷史橋接：Varuna 用 responder completion log 區分已執行/未執行 RDMA operation；RIFL 則要求 unique RPC ID、durable completion record、retry rendezvous、garbage collection。三者共同指向：exactly-once 不是模型單點能力，而是跨 caller/runtime/tool contract 的 protocol。

## 本小時最重要 5 個發現
1. **Tool contract 在不可觀測故障下比模型推理更重要。** LIMBO 報告：當 immediate read-back 可辨識 effect 時，frontier models 在 lost-ack 情境 duplicate 約 0.5%；但 request 仍 in-flight 或 transport redelivery 時，duplicate 分別升至 56% / 74%，contract 解釋 81% variance。這是論文結果，不是 Hermes 實測。
2. **Idempotency key 是跨 harness 可移植的 correctness primitive。** 論文中的 guard 只要替 write 附加 key，就能跨 harness 使用；提供每次 write idempotency key 將 aggregate duplicate rate 從 28% 降到 4%。因此 Hermes 應把 key generation 放在 runtime/harness，不依賴模型記得產生。
3. **Verification-only policy 對 late commit 不可能普遍 exactly-once。** 如果 write timeout 後先 read-back，再決定是否 retry，late commit 可能發生在 read-back 之後。沒有已知 in-flight bound 時，「查不到 → 重試」仍可能 duplicate。
4. **Completion record 必須和 effect 有原子/持久關係。** RIFL 的核心要求是 completion record 包含 RPC ID 與 result，且必須和 operation mutation 原子建立、具相似 durability。這比單純 Agent event log 強：event log 若和遠端 effect 分離，仍存在 crash gap。
5. **Exactly-once 應分成三個責任域。** Model：在可觀測狀態下做 reconciliation；Harness：穩定 LogicalOperationID / IdempotencyKey / retry state；Tool Contract：dedup + durable result/effect record。缺任一層，都只能宣稱較弱語義。

## Architecture Breakdown
User Intent
→ Agent Plan
→ Tool Mutation Intent
→ Runtime assigns LogicalOperationID
→ Runtime derives stable IdempotencyKey
→ Tool Contract capability discovery
→ AttemptGeneration
→ Dispatch
→ Tool-side Dedup Lookup
→ if existing: return StoredResult
→ if new: execute mutation
→ atomically persist Effect + CompletionRecord
→ return Result
→ Hermes RemoteEffectLedger
→ SemanticCommitWitness
→ ExactlyOnceCommitGate

Timeout/failure path：
Timeout
→ classify contract capability
→ [provider supports idempotency] retry SAME key
→ [read-back is authoritative + no late-commit ambiguity] reconcile
→ [late commit possible, no key] WAIT/QUARANTINE
→ bounded in-flight expiry if contract defines bound
→ otherwise Human/Provider Reconciliation
→ NEVER blind-retry non-idempotent unknown effect.

## Bottom-Level Logic
新的 operation identity：
LogicalOperationID != AttemptID。
所有 retry 必須維持：
same LogicalOperationID
same IdempotencyKey
new AttemptGeneration。

Effect state：
NOT_DISPATCHED
→ IN_FLIGHT
→ ACK_LOST_OR_TIMEOUT
→ {CONFIRMED_NOT_APPLIED | CONFIRMED_APPLIED | UNKNOWN_LATE_COMMIT}
→ {SAFE_REPLAY | RETURN_STORED_RESULT | QUARANTINE}。

核心 invariant：
Replay(non_idempotent_op) requires
  ProviderDedup(SameIdempotencyKey)
  OR ConfirmedNotApplied with a contract-defined observation boundary.

禁止：
ReadBackMiss ⇒ NotApplied
Timeout ⇒ NotApplied
NewAttempt ⇒ NewLogicalOperation
ModelSaysSuccess ⇒ SemanticCommitWitness

## Visual Simulation Idea
**Agent Exactly-Once Contract Simulator**

欄位：
LogicalOperationID | IdempotencyKey | AttemptGen | Tool Contract | In-flight Bound | Dispatch | Service Commit | ACK | Read-back | CompletionRecord | Ledger State | Retry Decision | Duplicate Effect | Commit Eligible

故障注入：
ACK_LOST_AFTER_COMMIT
LATE_COMMIT_AFTER_READBACK
TRANSPORT_REDELIVERY
PARTIAL_BATCH
SERVER_500_AFTER_COMMIT
IDEMPOTENCY_KEY_MISSING
IDEMPOTENCY_KEY_REUSED_WRONG_PAYLOAD
COMPLETION_RECORD_LOST
RESULT_LOST_EFFECT_COMMITTED

互動畫面應讓使用者切換三種 contract：
A. no idempotency/no readback
B. readback only
C. idempotency key + durable stored result
並直接看到 duplicate probability / reachable state-space 的差異。

## Code / GitHub
Hermes 建議新增：
- runtime/effects/logical-operation.ts：LogicalOperationID / AttemptGeneration
- runtime/effects/idempotency.ts：stable key derivation + payload hash binding
- runtime/effects/effect-ledger.ts：remote effect state machine
- runtime/effects/reconciliation.ts：provider-specific read-back / late-commit policy
- runtime/effects/commit-gate.ts：semantic commit gating
- runtime/tools/contracts.ts：ToolEffectContract { idempotency, readback, inflightBound, resultRecovery }
- simulator/exactly-once/：LIMBO-inspired fault injection UI

對既有 tool abstraction 的要求：schema 不只描述 arguments/result，還要描述 side-effect semantics。

## Papers
### 1. Where Does Exactly-Once Live? Model, Harness, and Tool-Contract Effects on Duplicate Side Effects in LLM Agents
Author: Jiapeng Li
Year: 2026
URL: https://arxiv.org/abs/2609.29095
Benchmark: LIMBO
Architecture: model × harness × tool-contract factorial evaluation + committed-effect ledger
Contribution: 定量區分 model reasoning、harness、tool contract 對 duplicate side effects 的責任。
Limitations: deterministic sandbox；不能直接等同所有 production APIs/MCP servers。

### 2. Varuna: Enabling Failure-Type Aware RDMA Failover
Authors: Xiaoyang Wang et al.
Year: 2026
URL: https://arxiv.org/abs/2603.28001
Architecture: request/completion evidence + selective retransmission + post-failure result recovery
Contribution: transport/responder execution evidence避免 non-idempotent blanket retransmit。
Limitations: RDMA-specific；不能直接提供 application semantic commit。

### 3. Implementing Linearizability at Large Scale and Low Latency (RIFL)
Architecture: unique RPC identifiers + durable completion records + retry rendezvous + GC
Contribution: exactly-once RPC semantics建立在 durable result/effect metadata，不是 transport reliability。
Limitation: 需要 server cooperation 與可靠 metadata；client crash/GC需額外機制。

## Knowledge Graph 新增 Node / Edge
Nodes:
AgentHarnessCorrectness
ToolEffectContract
LogicalOperationID
StableIdempotencyKey
PayloadHashBinding
LateCommitWindow
VerificationOnlyPolicy
DurableCompletionRecord
StoredResultReplay
ProviderDeduplication
UnknownLateCommitState
EffectQuarantine
ContractCapabilityDiscovery

Edges:
LogicalOperationID → owns → AttemptGeneration
LogicalOperationID → derives → StableIdempotencyKey
StableIdempotencyKey → scopes → ProviderDeduplication
ProviderDeduplication → prevents → DuplicateSemanticEffect
DurableCompletionRecord → binds → SemanticEffect + StoredResult
LateCommitWindow → invalidates → VerificationOnlyPolicy
ToolEffectContract → determines → SafeRecoveryStrategy
RemoteEffectLedger → consumes → CompletionRecord/ReadBack/Timeout evidence
UnknownLateCommitState → requires → EffectQuarantine
SemanticCommitWitness → permits → ExactlyOnceCommitGate

新增否定關係：
Timeout --does_not_imply→ NotApplied
ReadBackMiss --does_not_imply→ NotApplied when late commit is possible
ModelDecision --does_not_replace→ ToolContract
TransportExactlyOnce --does_not_imply→ SemanticExactlyOnce

## Unknown / Open Questions
1. MCP tool schema 是否應標準化 side-effect metadata：idempotency support、read-after-write authority、late-commit bound、result recovery？
2. Idempotency record 的 retention/GC 如何和 Agent 長任務、跨日 retry、session generation 對齊？
3. Batch/partial effect 如何從單一 LogicalOperationID 擴成 effect DAG，並提供 per-effect commit witness？

## 下一輪研究
MCP/Tool contract side-effect semantics → provider-native idempotency patterns → durable result cache → retention/GC → batch partial commit → effect DAG → crash-consistent Hermes RemoteEffectLedger。

## 本輪結束判斷
- 缺哪一層：Tool/MCP contract 的 machine-readable side-effect semantics。
- 最淺節點：ContractCapabilityDiscovery。
- 哪個概念仍只是名詞：跨 provider 的 EffectQuarantine / reconciliation protocol。
- 哪個系統值得讀原始碼：RIFL/RAMCloud RPC result tracking、Apache Kudu ResultTracker，以及 Hermes 現有 tool/MCP execution path。
- 哪篇論文需追引用：arXiv:2609.29095，並向 exactly-once RPC、idempotency、late-commit impossibility 文獻回溯。
- 哪個概念最適合視覺模擬：Agent Exactly-Once Contract Simulator。
- 哪個 Agent 架構最值得實作：Event-sourced Agent Runtime + stable idempotency + provider contract adapter + RemoteEffectLedger + ExactlyOnceCommitGate。
