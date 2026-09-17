# 【AI Agent × Multimodal Research Report】

**時間：2026-09-18 02:55（Asia/Taipei）**

**本輪主題：Workflow Settlement Frontier × Causal Proof Composition × Multi-Provider Effect Graph**

## 與歷史研究比較

上一輪已建立 `ConsistencyClass / ReadFreshnessBound / ProviderRevision / SettlementProofStrength / EffectContract / RetryAdmissibility`，回答「單一 provider 的 read-back 何時足以把 IN_DOUBT 升級為 SETTLED」。本輪不再重複單一 effect settlement，而往下一層：一個 Agent workflow 同時跨 MCP、SaaS、DB、Email、Payment 等 provider 時，什麼條件才允許整個 workflow 宣告完成？

歷史缺口是：`Provider A = SETTLED`、`Provider B = PENDING`、`Provider C = COMPENSATED` 時，沒有一個明確的 causal frontier / proof composition model。

---

## 本小時新發現

### 新架構：Workflow Settlement Graph（Hermes proposal）

把 workflow 從「tool call list」改成 effect DAG：

```text
User Intent
  ↓
Plan
  ↓
E1: reserve inventory ───────┐
  ↓                          │ causal dependency
E2: charge payment           │
  ↓                          │
E3: create shipment          │
  ↓                          │
E4: send confirmation ←──────┘
```

每個 Effect node 不只保存 runtime status，而保存 provider-native settlement evidence：

```text
EffectNode {
  effect_id
  provider
  logical_effect_key
  dependencies[]
  runtime_status
  provider_native_state
  settlement_verdict
  proof_strength
  provider_revision
  proof_observed_at
  freshness_bound
  compensation_of?
}
```

### 新底層機制：Settlement Frontier

定義：在 effect DAG 中，所有 predecessors 都已有足夠 settlement proof，且目前 node 本身也達到其 EffectContract 要求時，frontier 才能向後推進。

```text
SettledPrefix(W)
= maximal causally closed subgraph
  whose required effects have valid settlement proofs
```

這不是 wall-clock frontier；它是 **causal + evidence frontier**。

---

## 本小時最重要 5 個發現

### 1. 單點 settled 不代表 workflow settled

**已確認事實 + architecture inference。**

`durable-agent-outbox` 的核心 state machine 是 per-action correctness kernel：`IN_DOUBT` 只能由 authoritative receipt 推向 `EXECUTED` 或 `NOT_LANDED`，`ACKED` 為 terminal；它非常適合單一 external effect，但沒有宣稱解決跨多 provider 的 workflow completion proof。

來源：
- https://github.com/mstevens843/durable-agent-outbox
- `packages/core/src/transitions.ts`
- `packages/core/src/ports.ts`

因此 Hermes 必須在 per-effect settlement 之上增加 workflow composition layer。

### 2. ReceiptSource 的強 contract 揭示「證據 completeness」也是 liveness 條件

**原始碼確認。**

`ReceiptSource` contract 要求：每個 tool 已記錄的 call 都必須最終有 receipt；receipt authoritative、可重讀；absence 只能代表 `not yet`，不能代表 `did not happen`；receipt 還必須 authentic。這說明 settlement 不只是 safety（不要重複 effect），也是 liveness（不能永遠 stranded in doubt）。

底層：

```text
Call issued
→ response UNKNOWN
→ IN_DOUBT
→ poll authoritative receipt
→ LANDED / NOT_LANDED
→ terminal progress
```

若 receipt feed 不 complete：

```text
IN_DOUBT
→ forever UNKNOWN
```

因此 workflow-level proof 必須同時保存：

```text
SafetyProof
+
Progress/CompletenessObligation
```

### 3. Workflow completion 應是 causal closure，不是「所有 API 回 200」

**Hermes architecture proposal，受 transactional-agent work 交叉支持。**

Atomix 將 agent workflow 的 reads/effects 記錄後，在 footprint sealed 且 per-resource progress frontier 排除更早 conflicting work 後才 commit；Cordon 則以 task-level semantic transaction staging external effects。兩者都支持一個方向：workflow correctness 需要跨 call 的 boundary，而非每個 RPC 各自判斷。

來源：
- Atomix: arXiv:2602.14849
- Cordon: arXiv:2606.17573

Hermes 新 invariant：

```text
WorkflowSettled(W)
:=
∀ required effect E ∈ W:
  Settled(E)
∧
∀ dependency A → B:
  Proof(A) causally precedes admissible completion of B
∧
no unresolved required compensation
∧
no IN_DOUBT effect lies on a required path
```

### 4. Compensation 必須成為新 Effect，而不是把舊 Effect 改成「沒發生」

**合理推論，與 durable audit semantics / Saga 類模型一致。**

若：

```text
E2 = charge payment [LANDED]
C2 = refund payment [LANDED]
```

不能把 E2 改寫為 NOT_LANDED。真實歷史是兩個 effect：

```text
E2 --COMPENSATED_BY--> C2
```

因此 workflow state 需要 append-only effect lineage：

```text
Effect
→ Receipt
→ SettlementProof
→ CompensationEffect
→ CompensationReceipt
→ CompensationSettlementProof
```

這讓 audit、replay、belief revision 與 future planning 都不會把「已發生後被補償」誤認為「從未發生」。

### 5. 多 provider proof 不能粗暴壓成同一 consistency model

**延續上一輪並進一步建模。**

DB strong read、payment receipt、email provider message-id/readback、eventual SaaS GET 的 epistemic strength 不同。更可靠的方法是：保留 provider-native evidence，再 normalize 成 verdict，而不是建立虛假的 universal consistency guarantee。

```text
ProviderNativeEvidence
→ ProviderAdapter
→ NormalizedSettlementVerdict
→ WorkflowProofComposer
```

Normalized verdict 可共用：

```text
SETTLED
NOT_LANDED
IN_DOUBT
COMPENSATED
FAILED_TERMINAL
```

但 proof 不能丟掉：

```text
native_state
revision/version
receipt signature
consistency class
freshness
postcondition evidence
```

---

## Architecture Breakdown

```text
UI / User Intent
↓
Agent Runtime
↓
Planner
↓
Effect DAG Compiler
↓
EffectContract per node
↓
MCP / Tool Router
↓
Provider Adapters
├─ DB adapter
├─ Payment adapter
├─ Email adapter
├─ SaaS adapter
└─ Local filesystem adapter
↓
Provider-native Effect
↓
Receipt / Read-back / Revision
↓
Per-Effect Settlement Proof
↓
Workflow Proof Composer
↓
Causal Settlement Frontier
↓
Workflow Completion Gate
↓
Memory / Belief / Next Plan
```

關鍵是 `Workflow Completion Gate` 不應直接讀 tool response，而應讀 proof graph。

---

## Bottom-Level Logic

### durable-agent-outbox state transition

原始碼 `transitions.ts` 將 legality table 作為 reducer 與 audit checker 的 single source of truth。`ATTEMPTING → IN_DOUBT` 表示 request 已可能越過 effect boundary；`IN_DOUBT → EXECUTED/NOT_LANDED` 只能靠 receipt；`ACKED` 無 outgoing edge。

值得讀：
- `packages/core/src/transitions.ts`
- `packages/core/src/reduce.ts`
- `packages/core/src/worker.ts`
- `packages/core/src/ports.ts`
- `packages/core/src/audit/`
- `packages/core/src/receipts/`
- `packages/core/src/idempotency.ts`

### Workflow Proof Composer pseudo-logic

```text
for effect in topological_order(workflow):
    native = adapter.read_authoritative_state(effect)
    proof = adapter.verify(effect, native)
    graph.attach(proof)

    if proof.verdict == IN_DOUBT:
        frontier.stop_at(effect)

    if proof.verdict == SETTLED:
        frontier.advance_if_all_predecessors_closed(effect)

    if proof.verdict == COMPENSATED:
        require compensation_effect.settlement == SETTLED

workflow_complete =
    all_required_terminal
    AND causal_closure
    AND no_required_in_doubt
    AND compensation_closure
```

### 新的重要區分

```text
Execution Frontier
≠
Settlement Frontier
≠
Knowledge Frontier
```

Execution Frontier：Agent 程式跑到哪。

Settlement Frontier：外部世界哪些 effect 已有足夠 proof。

Knowledge Frontier：Runtime 對世界狀態的證據已確認到哪。

Agent 可能 execution 已到 E4，但 settlement 只到 E1。

---

## Visual Simulation Idea

### Workflow Settlement Graph Simulator

畫面分成 5 層：

```text
PLAN
E1 ─→ E2 ─→ E3 ─→ E4

RUNTIME
OK    OK    TIMEOUT  OK

PROVIDER
DONE  DONE  UNKNOWN  DONE

PROOF
L4    L3    ?        L2

SETTLEMENT FRONTIER
───────────▲
```

可注入：
- provider response lost
- stale read replica
- delayed receipt
- payment settled but shipment unknown
- compensation succeeds/fails
- downstream effect executed before predecessor settled
- receipt forgery
- idempotency window expiry
- concurrent workflow conflict

互動後即時顯示：

```text
Execution Frontier
Settlement Frontier
Unresolved Cut
Proof Strength
Causal Violation
Compensation Closure
Workflow Completion = YES / NO
```

---

## Code / GitHub

### durable-agent-outbox
https://github.com/mstevens843/durable-agent-outbox

本輪直接讀 directory structure 與核心 source。它目前公開聲明 core 有 12-status state machine、pure reducer、idempotency derivation、authenticated receipts、audit legality checker，以及 conformance/storage/stress harness；README 也明確標示 pre-1.0，不能把它當 production-proven framework。

最值得繼續讀：

```text
packages/core/src/reduce.ts
packages/core/src/worker.ts
packages/core/src/audit/
packages/core/src/receipts/
packages/postgres/
packages/conformance/
```

---

## Papers

### Atomix: Timely, Transactional Tool Use for Reliable Agentic Workflows
- Authors: Bardia Mohammadi, Nearchos Potamitis, Lars Klein, Akhil Arora, Laurent Bindschaedler
- Year: 2026
- URL: https://arxiv.org/abs/2602.14849
- Architecture: progress-aware transactions + read/effect footprint + per-resource frontier
- Contribution: 將「哪些 effects 一起 settle」與「何時沒有更早 conflicting work」分離。
- Limitation: 不是 universal SaaS settlement proof；external provider 的 authoritative semantics 仍需要 adapter。

### Cordon: Semantic Transactions for Tool-Using LLM Agents
- Authors: Zheng Chen et al.
- Year: 2026
- URL: https://arxiv.org/abs/2606.17573
- Architecture: task-level semantic transaction + shadow state + effect outbox + delegated authority + audit metadata
- Contribution: tool RPC 上方加入 task-scoped containment/commit boundary。
- Limitation: 無法讓不可控制的第三方 provider magically 支援 rollback。

### A Trace-Based Assurance Framework for Agentic AI Orchestration
- Authors: Ciprian Paduraru, Petru-Liviu Bouruc, Alin Stefanescu
- Year: 2026
- URL: https://arxiv.org/abs/2603.18096
- Architecture: Message-Action Trace + contracts + deterministic replay + fault injection
- Contribution: first-violation localization、runtime governance、trace-based assurance。
- Limitation: trace correctness 本身不等於 external provider settlement finality。

---

## Unknown / Open Questions

1. **跨 provider causal ordering 怎麼證明？** Payment receipt 與 SaaS read-back 沒有共同 clock/revision；需要 vector-like causal witness，還是只靠 workflow-generated dependency token？
2. **eventual provider 的 UNKNOWN 要等多久？** timeout 是 policy，不是 truth；何時允許人工/業務規則將 UNKNOWN 升級為 terminal exception？
3. **compensation closure 如何證明？** refund landed 不代表所有 downstream consequences（email、shipment、notification、inventory）都已被修復。

---

## 下一輪研究

優先深挖：

```text
durable-agent-outbox reduce.ts / worker.ts
→ receipt ingestion
→ reducer command
→ CAS commit
→ audit append
→ crash window

然后建立：

Workflow Dependency Token
→ Cross-provider Causal Witness
→ Settlement Vector
→ Unresolved Cut
→ Compensation Closure
→ Workflow Completion Proof
```

並比較 Atomix per-resource frontier 是否能映射到 Hermes multi-provider effect DAG，而不錯誤宣稱 provider 支援同一 transaction protocol。

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `WorkflowSettlementGraph`
- `CausalSettlementFrontier`
- `WorkflowProofComposer`
- `EffectDependency`
- `ProviderAdapter`
- `ProviderNativeEvidence`
- `NormalizedSettlementVerdict`
- `ReceiptCompletenessObligation`
- `ProgressProof`
- `CompensationClosure`
- `UnresolvedEffectCut`
- `ExecutionFrontier`
- `KnowledgeFrontier`
- `SettlementFrontier`

### Edges

```text
EffectDependency --orders--> Effect
ProviderNativeEvidence --supports--> SettlementProof
SettlementProof --advances--> SettlementFrontier
IN_DOUBT --blocks--> RequiredSettlementPath
Effect --compensated_by--> CompensationEffect
CompensationEffect --requires--> SettlementProof
ReceiptCompletenessObligation --enables--> ProgressProof
WorkflowProofComposer --computes--> WorkflowCompletion
```

---

## 本輪結束判斷

- **缺哪一層：** Cross-provider causal witness / proof composition。
- **哪個節點最淺：** `CompensationClosure`、`CrossProviderCausalWitness`。
- **哪個概念仍只是名詞：** `SettlementVector`，尚未找到可直接套用到 heterogeneous SaaS/MCP 的正式標準。
- **哪個系統值得繼續讀原始碼：** `durable-agent-outbox` 的 `reduce.ts / worker.ts / audit / receipts / postgres stress`。
- **哪篇論文需追引用：** Atomix，尤其 progress frontier 與 conflicting work exhaustion 的來源。
- **哪個概念最適合視覺模擬：** `Execution Frontier vs Settlement Frontier vs Knowledge Frontier`。
- **哪個 Agent 架構最值得實作：** `Effect DAG + per-effect EffectContract + provider-native proof adapters + Workflow Completion Gate`。

## 本輪核心結論

可靠 Agent 的 workflow 完成條件不能是「所有 tool call 都跑完」，也不能只是「每個 provider 各自看起來成功」。真正的 completion proof 必須是 **causally closed**：所有 required effect 都有符合各自 provider consistency/freshness semantics 的 settlement evidence，所有 required predecessor 已完成，所有 compensation branch 已閉合，而且 required path 上不存在 IN_DOUBT。這使 Hermes 從單一 Tool Settlement 進一步走向真正的 **Workflow Settlement Graph**。