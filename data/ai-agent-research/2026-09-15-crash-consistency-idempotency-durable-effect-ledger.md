# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 19:52（Asia/Taipei）**  
**主題：Crash Consistency × Idempotency × Exactly-Once Illusion × Durable Effect Ledger × Recovery/Reconciliation**

## 與歷史研究比較
上一輪已建立 `TransactionEpoch / ResourceFrontier / EffectSettlement / TOCTOU / Compensation`，但仍留下最危險 crash window：外部 API 已完成副作用、Agent Runtime 尚未 durable-record outcome 就崩潰。本輪不再討論 transaction 是否應 commit，而專注「commit/execution 跨 crash 邊界如何恢復，而且不重複做事」。

## 本小時新發現
- **新架構：Durable Effect Ledger + Unknown Outcome Recovery**：durable workflow 的 exactly-once recording 不等於 external physical execution exactly once；外部操作可能在 crash window 重複，因此 runtime 必須保留 UNKNOWN outcome、idempotency、reconciliation/compensation。
- **新工程模式：Provider-scoped idempotency**：Stripe / AWS 均以 client-generated idempotency key/token 讓 retry 在特定 scope + TTL 內不產生額外 effect；相同 key 搭配不同 parameters 應 conflict，而非默默重用。
- **新安全機制：Durable authorization consumption**：CapLease 指出單次 token 不足以阻止 Agent replanning/retry 後重新發 token造成 semantic replay；需要 canonical action + confirmation + remaining execution budget 的 durable monotonic state。
- **新 GitHub：AgentLedger**：runtime reliability layer，repo 明確分出 contracts/docs/examples/go/rust/typescript/packages；packages 包含 LangGraph、MCP、Postgres/MySQL、S3、OTel、sandbox 等 adapters。其 README 把 Tool Ledger、event WAL、leases/fencing、checkpoints、idempotency、pending-verification 與 replay-safe evidence 放在 execution path。

## 本小時最重要 5 個發現

### 1. Exactly-once 是分層語意，不是一句保證
**已確認工程事實：** durable runtime 可以保證「一個 settlement record 被接受一次」，但 external API physical execution 仍可能重複。Effect Agent 的 durability 文件直接區分 exactly-once recording 與 external execution；普通 tool 若 worker 在完成後、record 前消失，結果應標 `UnknownToolOutcome`，不能安全推斷失敗再盲目 replay。

底層：
`INTENT_DURABLE → REQUEST_SENT → EXTERNAL_EFFECT? → CRASH → OUTCOME_NOT_DURABLE`

恢復時真正狀態不是 FAILED，而是 UNKNOWN。

**重要性：** 把 UNKNOWN 當 FAILED 是 double-send/double-charge/double-delete 的根源。  
**限制：** runtime 無法替不支援 idempotency/query-by-key 的外部服務憑空製造 exactly-once physical effect。

### 2. Idempotency key 必須綁「語意操作」，不是綁 retry attempt
Stripe v1 會保存第一個 request 的 status/body；相同 key retry 取得同結果，parameter mismatch 會拒絕。AWS EBS/ECS 同樣用 client token，且 token 有 scope/TTL。

Hermes 應使用：
`semantic_operation_id = hash(goal_lock + canonical_tool + canonical_args + authority_epoch + transaction_id)`

而不是：
`idempotency_key = random_uuid_per_retry`

否則每次 retry 都變成全新的副作用。

### 3. Durable authorization 與 durable effect 必須共用 causal identity
CapLease 的核心問題是 **semantic replay**：即使 token identifier single-use，Agent replanning 可重新取得新 token，仍可能把同一份 user authorization 消耗多次。它要求 durable state 記錄 canonical action、confirmation、execution budget，並採 Issue→Prepare→Commit。

新增：
`AuthorizationInstance --AUTHORIZES--> SemanticOperation --MATERIALIZES_AS--> ToolAttempt`

多個 ToolAttempt 只能消耗同一 SemanticOperation 的允許 budget。

### 4. Crash recovery 需要 Effect Ledger，而不只是 Agent checkpoint
Checkpoint 回答「Agent 想到哪裡」；Effect Ledger 回答「世界可能已經被改到哪裡」。AgentLedger 把 durable state machine、Tool Ledger、event-level WAL、payload archive、leases、fencing token、side-effect status 與 replay 分開，並把這層放在 framework/Tool/MCP boundary，而非事後 trace。

建議 lifecycle：
`PROPOSED → INTENT_DURABLE → DISPATCHED → ACKED | UNKNOWN → VERIFIED → SETTLED`

只有 `VERIFIED/SETTLED` 可在 replay 時直接跳過；`UNKNOWN` 必須 reconciliation。

### 5. Recovery 的核心不是 Retry，而是 Reconcile-Then-Retry
恢復算法：
`Load durable ledger → fence stale worker → enumerate unfinished effects → classify provider capability → query external state/idempotency result → verify postcondition → settle if found → retry with SAME semantic idempotency key if safe → compensate/escalate if ambiguous`。

因此：
`Crash Recovery ≠ Replay Everything`
`Workflow Exactly Once ≠ External Effect Exactly Once`
`At-Least-Once + Idempotent Sink ≈ Practical Exactly-Once Effect`
但最後一式只在 idempotency scope/TTL/parameter binding 仍有效時成立。

## Architecture Breakdown — Crash-Safe Agent Effect Kernel

```text
Agent Plan
↓
Canonical Action Builder
↓
Semantic Operation ID
↓
Authority / Budget Check
↓
Durable Intent Record (WAL)
↓
Idempotency Capability Resolver
├ Native provider key
├ Query-by-operation-id
├ Local outbox/dedupe proxy
└ No safe dedupe
↓
Dispatch Attempt
↓
External World
↓
Durable Outcome Record
↓
Postcondition Verification
↓
SETTLED

CRASH anywhere
↓
Recovery Scanner
↓
Fence stale attempt
↓
UNKNOWN-effect reconciliation
├ observe external state
├ provider replay by same key
├ compensate
└ human escalation
```

## Bottom-Level Logic
### WAL-before-effect invariant
對不可逆或昂貴 mutation，必須先 durable write intent，再 dispatch：
`fsync(Intent{semantic_op_id,args_hash,authority,idempotency_key}) → external_call()`。
這只能保證「知道曾想做」，仍不能消除 external success → outcome log crash window。

### Outcome ambiguity state machine
`NOT_SENT / SENT_UNKNOWN / CONFIRMED_SUCCESS / CONFIRMED_FAILURE / COMPENSATED / RECONCILIATION_REQUIRED`。

### Fencing
每個 recovery worker 取得更高 epoch/fencing token；舊 worker 即使復活，也不得 append 新 settlement，避免 zombie worker 與 replacement 同時完成同一 effect。

## Visual Simulation Idea — Crash Window Microscope × Effect Ledger Replay Lab
畫一條時間軸：`Intent WAL → HTTP Send → Provider Commit → HTTP Response → Outcome WAL → Postcondition`，提供 crash slider 可在每個微小窗口 kill worker。右側顯示 Agent checkpoint、Effect Ledger、Provider State、Idempotency Cache、Authority Budget。使用者切換 `No Key / Random Retry Key / Stable Semantic Key / Query+Reconcile`，直接觀察 duplicate email/payment/file mutation 次數與 UNKNOWN state。

## Code / GitHub
### AgentLedger
值得繼續讀：
- `contracts/`：language-neutral runtime contract / conformance semantics
- `packages/agentledger-mcp/`：MCP governance boundary
- `packages/agentledger-langgraph/`：workflow integration
- `packages/agentledger-postgres/`, `agentledger-mysql/`：durable state backend
- `packages/agentledger-s3/`：blob/evidence durability
- `examples/showcase/duplicate_side_effect_crash/`：最直接的 crash/duplicate effect experiment
- `docs/QUERY_EXAMPLES.md`, `docs/BENCHMARKS.md`, `docs/ADAPTER_VALIDATION.md`

Repo architecture 顯示它不是 planner，而是放在 agent/framework 與 model/tool/storage 之間的 reliability substrate；README 明列 durable execution、Tool Ledger、evidence/replay、leases/fencing、checkpoint、idempotency 與 pending verification。

## Papers / Technical Sources
### Beyond Single-Use Tokens: Durable Authorization State for Replay-Resistant LLM Agent Actions
- Authors: Jinghan Xu, Longze Fan, Zeyuan Wang, Xinjin Li, Hankai Liu
- Year: 2026
- Architecture: CapLease; canonical action binding + durable authorization-consumption state + Issue/Prepare/Commit
- Contribution: 定義 semantic replay；證明 identifier-local single-use token 無法阻止 fresh reissuance
- Limitation: duplicate external effect 的最後一層仍依賴 idempotent sink / server ledger
- URL: https://arxiv.org/abs/2608.01710

### Temporary Authority, Permanent Effects: Commit-Time Authorization for LLM Agents
- Author: Igor Santos-Grueiro
- Year: 2026
- Contribution: 將 authority freshness/rebinding/eligibility 放到 durable commit boundary；區分 endpoint success 與 authorized completion
- URL: https://arxiv.org/abs/2607.10487

### Engineering references
- Stripe Idempotent Requests: https://docs.stripe.com/api/idempotent_requests
- AWS EBS Idempotency: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-direct-api-idempotency.html
- Effect Agent Durability: https://effect-agent.com/concepts/durability
- AgentLedger: https://github.com/yaogdu/AgentLedger

## 已確認 / 推論 / 假說界線
- **官方/工程已確認：** Stripe/AWS idempotency token 有明確 scope、parameter-binding 與 retention/TTL；durable execution 不自動等於 external exactly-once。
- **論文結果：** CapLease 指向 durable authorization state 對 replay-resistant agent execution 的必要性；Commit-Time Authorization 顯示 endpoint success 與 authorized durable commit 可大幅分離。
- **合理工程推論：** Hermes 應把 semantic operation identity 同時綁到 idempotency、authority、ledger、postcondition evidence。
- **尚未驗證假說：** 對任意 MCP/tool provider，可否透過統一 proxy/outbox 層提供接近 exactly-once 的效果；對無 query API、無 idempotency key 的不可逆工具尤其未知。

## Unknown / Open Questions
1. MCP protocol 是否應標準化 mutation tool 的 `idempotency_scope / dedupe_ttl / query_status / compensation` capability metadata？
2. Provider idempotency TTL 過期後，長期 Agent crash/resume 如何避免 semantic operation 被再次 materialize？
3. 多代理 delegated execution 中，semantic operation ID 如何跨 agent/process/org 邊界保持唯一、不可偽造又可 audit？

## 下一輪研究
**Effect Capability Contracts × MCP Mutation Semantics × Outbox/Inbox × Provider Reconciliation × Long-Horizon Idempotency**。優先追 MCP 是否有 mutation/retry 語意缺口、Temporal/Restate/DBOS 的 durable activity boundary，以及 AgentLedger duplicate-side-effect crash example 的實際 source path與 storage schema。

## Knowledge Graph 新增 Node / Edge
### Nodes
`SemanticOperationID`, `DurableEffectLedger`, `EffectIntentRecord`, `EffectOutcomeRecord`, `UnknownToolOutcome`, `IdempotencyCapability`, `IdempotencyScope`, `IdempotencyTTL`, `ParameterBinding`, `SemanticReplay`, `DurableAuthorizationConsumption`, `RecoveryScanner`, `ReconciliationProbe`, `FencingEpoch`, `DuplicateEffectRisk`, `PracticalExactlyOnce`.

### Edges
- `ToolAttempt --MATERIALIZES--> SemanticOperation`
- `SemanticOperation --IDENTIFIED_BY--> SemanticOperationID`
- `AuthorizationInstance --AUTHORIZES--> SemanticOperation`
- `EffectIntentRecord --PRECEDES--> ExternalEffect`
- `ExternalEffect --MAY_HAVE--> UnknownToolOutcome`
- `RecoveryScanner --RECONCILES--> UnknownToolOutcome`
- `IdempotencyCapability --REDUCES--> DuplicateEffectRisk`
- `IdempotencyTTL --BOUNDS--> PracticalExactlyOnce`
- `FencingEpoch --INVALIDATES--> StaleWorker`
- `PostconditionEvidence --SETTLES--> DurableEffectLedger`

## 本輪結束檢查
- **缺哪一層：** provider/tool capability contract + reconciliation protocol。
- **哪個節點最淺：** `PracticalExactlyOnce`, `IdempotencyTTL`, `ReconciliationProbe`。
- **哪個概念仍只是名詞：** heterogeneous MCP ecosystem 的 universal `ExactlyOnceEffect`。
- **哪個系統值得讀原始碼：** AgentLedger 的 duplicate-side-effect crash showcase、Tool Ledger/storage/recovery paths。
- **哪篇論文需追引用：** CapLease（semantic replay / durable authorization state）。
- **最適合視覺模擬：** Crash Window Microscope × Effect Ledger Replay Lab。
- **最值得實作的 Agent 架構：** `Durable Intent WAL + Semantic Operation ID + Stable Idempotency Key + Fenced Recovery + Reconcile-before-Retry`。

## 對「AI 到底怎麼運作」新增的一層
`UI → Agent → Reasoning → Plan → Semantic Operation → Durable Intent WAL → Authority/Idempotency Gate → Tool/MCP Dispatch → External World → Outcome/Postcondition → Durable Effect Ledger → Memory`。真正可靠的 Agent 不只要記得「自己做到哪裡」，還要能回答「外部世界到底有沒有被我改過」。Crash 之後最危險的不是忘記推理，而是**世界已改、記錄未寫**；因此 UNKNOWN 必須是一級狀態，恢復策略必須先 reconciliation，再決定是否 retry。