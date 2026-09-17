# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 00:55（Asia/Taipei）

主題：Effect Settlement Proof × Authoritative Reconciliation × Tool-Boundary Anomalies × Durable Receipt State Machine

## 本小時新發現

本輪延續上一輪 Semantic Recoverability / EffectWitness / SettlementProof，但不重複 checkpoint/replay，而是往「External Effect 到底如何被證明已發生」深入。新核心來源包括 2026-09-14 的 *When Tool Calls Succeed but Workflows Fail*、Proof of Execution、TraceGrant，以及 durable-agent-outbox 原始碼/文件。

### 新論文 / 架構

1. **When Tool Calls Succeed but Workflows Fail: Anomalies at the Agent-Tool Boundary** — Artem Trofimov, Boris Novikov, 2026, arXiv:2609.15397. 建立 effect-history model，明確分離 external-world effect 與 runtime observation，整理 8 類 external-effect anomaly；並調查 98,291 個 MCP tools，指出現有 annotations 只是 coarse hints，無法完整表達 outcome resolution、staging、compensation、coordination 等 transactional capability。
2. **Proof of Execution: Runtime Verification for Governed AI Agent Actions** — James Rhodes, George Kang, 2026, arXiv:2607.05397. Execution = Contract + Execution Causal Event Stream + Replay Context，將 authorization/effect/history/replay 綁成 validator-checkable object。
3. **TraceGrant** — Bohao Liao et al., 2026, arXiv:2608.21126. 以 Contract 連接 trusted intent、runtime evidence、tool execution 與 verified task completion。
4. **durable-agent-outbox** — 實作型 state machine，把 READY/LEASED/ATTEMPTING/IN_DOUBT/NOT_LANDED/EXECUTED 等狀態定義為「外部世界的事實」，而非 requester 的意圖。

## 本小時最重要 5 個發現

### 1. Tool Response != External Effect

底層：
Intent → durable intent record → dispatch → provider may commit effect → response transport → runtime observation。

Provider effect 與 response 位於不同 failure domains。若 provider 已執行但 response 丟失，runtime 只能得到 UNKNOWN；若 runtime 看到 OK 但本地 commit 前 crash，也可能恢復成 UNKNOWN。因此「tool call 成功」不能作為 workflow settlement proof。

### 2. IN_DOUBT 必須是一級 Runtime State

可靠狀態機不是 SUCCESS/FAILED，而至少是：
READY → LEASED → ATTEMPTING → {EXECUTED | IN_DOUBT | READY/FAILED}。

只有 authoritative receipt=LANDED 才能將 IN_DOUBT 推進 EXECUTED；receipt=NOT_LANDED 才能證明 retry 安全。timeout/receipt absence 只能表示 NOT_YET_KNOWN，不能推導 NOT_LANDED。

### 3. Strong Receipt Contract 是 SettlementProof 的底層必要條件

每個 provider-recorded call 都必須產生 durable settlement record，不只 UNKNOWN calls。否則存在：provider effect landed → caller response lost / local CAS lost → runtime IN_DOUBT → provider 無 receipt → 永久無法安全判斷 retry。

因此：
EffectReceiptCompleteness = every recorded provider attempt eventually yields authoritative LANDED/NOT_LANDED evidence.

### 4. MCP Tool Annotation 不是 Transaction Contract

2026-09-14 論文對 98,291 MCP tools 的 census 顯示 annotations 雖廣泛存在，但仍主要是 call-level advisory hints。它們不能普遍提供 logical operation identity、authoritative status lookup、prepare/commit、compensation verification、dependency/visibility semantics。因此 Hermes 必須把 ToolSchema 與 EffectContract 分離。

### 5. SettlementProof 必須來自 authoritative external state，而非 Agent 自述

提出 Hermes IR：
EffectIntent → DispatchWitness → ProviderReceipt → ProviderReadback → PostconditionCheck → SettlementProof。

其中 provider receipt 與 readback 可以互補：receipt 證明 logical operation outcome；readback 驗證現在的 authoritative state。兩者都不能由 LLM completion text 取代。

## Architecture Breakdown

```text
User Intent
→ Agent Plan
→ Tool Intent
→ Canonical Effect Identity
→ Effect Contract
→ Durable Intent Commit
→ Dispatch
→ MCP / API / SaaS Provider
→ External Effect
   ├─ Response OK
   ├─ Response FAILED
   └─ Response LOST / UNKNOWN
→ Receipt Reconciliation
→ Provider Read-back
→ Postcondition Verifier
→ SettlementProof
→ EffectWitnessLog
→ Belief / Plan continuation
```

Failure path：

```text
ATTEMPTING
→ crash / timeout / lost response
→ IN_DOUBT
→ NO BLIND RETRY
→ poll authoritative receipt/status
   ├─ LANDED → EXECUTED
   ├─ NOT_LANDED → retry admissible
   └─ unresolved → ESCALATE / reconcile
```

## Bottom-Level Logic

新增 EffectSettlementRecord：

```text
EffectSettlementRecord {
  logical_effect_id
  idempotency_key_fingerprint
  provider
  operation
  canonical_arguments_hash
  attempt_id
  dispatch_time
  runtime_observation
  provider_receipt_id
  provider_outcome: LANDED | NOT_LANDED | UNKNOWN
  provider_observed_at
  readback_evidence_ids[]
  postcondition_verdict: PASS | FAIL | UNKNOWN
  settlement_state
}
```

核心 invariant：

```text
RetrySafe(E) := authoritative_outcome(E) == NOT_LANDED
Settled(E) := authoritative_outcome(E) == LANDED AND required_postconditions(E) verified
ReceiptAbsence DOES_NOT_IMPLY NOT_LANDED
RuntimeOK DOES_NOT_IMPLY Settled
CheckpointRestore DOES_NOT_DELETE EffectSettlementRecord
```

## Visual Simulation Idea

**External Effect Settlement Microscope**

五條 timeline：Agent Runtime / Network / Provider / Receipt Feed / Authoritative State。

可注入：response lost、provider commit then crash、runtime crash after OK、duplicate retry、receipt delay、weak receipt feed、provider readback stale、compensation failure。

畫面狀態：READY / ATTEMPTING / IN_DOUBT / LANDED / NOT_LANDED / SETTLED / RECONCILIATION_REQUIRED。

重點視覺：讓使用者直接看到「runtime 看見的 history」與「external world 真正發生的 history」何時分叉、何時透過 receipt/readback 重新收斂。

## Code / GitHub

值得繼續讀：
- mstevens843/durable-agent-outbox/docs/STATE_MACHINE.md
- docs/RECEIPT_CONTRACT.md
- packages/core/src/transitions.ts
- packages/core/src/reduce.ts
- packages/core/src/ports.ts
- packages/core/src/audit/legality.ts
- packages/postgres/stress/

已確認工程機制：durable intent 在 CALL_TOOL 前 commit；ATTEMPTING 表示 effect 可能已發生；crash recovery 進 IN_DOUBT；只有 receipt 可把 ambiguity 解成 LANDED/NOT_LANDED；weak receipt feed 會造成不可安全恢復的永久 ambiguity。

## Papers

### When Tool Calls Succeed but Workflows Fail
Authors: Artem Trofimov, Boris Novikov. Year: 2026. URL: https://arxiv.org/abs/2609.15397. Architecture: effect-history / agent-tool boundary capability model. Dataset: MCP registry census, 98,291 tools. Contribution: 8 external-effect anomalies + required boundary capabilities. Limitation: analysis/protocol study，不代表現有 MCP server 已具有 transactional semantics。

### Proof of Execution
Authors: James Rhodes, George Kang. Year: 2026. URL: https://arxiv.org/abs/2607.05397. Architecture: Contract + ECES + Replay Context + validator invariants. Contribution: 將 authorization、effect、history、replay 變成可驗證 execution object。Limitation: prototype/assumption-bound guarantees，不能取代 external provider settlement protocol。

### TraceGrant
Authors: Bohao Liao, Jingchao Wang, Qipeng Song, Jin Cao, Jieling Wang, Boyu Deng. Year: 2026. URL: https://arxiv.org/abs/2608.21126. Architecture: trusted request → Contract → admitted evidence → governed tool execution → completion verification. Contribution: task-effect lifecycle governance. Limitation: Contract quality與真實 heterogeneous provider semantics 仍是部署邊界。

## Unknown / Open Questions

1. 不同 SaaS/API/MCP provider 如何映射成統一 AuthoritativeOutcome IR，而不假裝所有 provider 都有 receipt/status endpoint？
2. provider readback 本身若 eventual-consistent，SettlementProof 的 freshness/consistency level 如何表示？
3. compensation receipt 是否需要形成新的 effect lineage，而不能覆蓋原 effect？答案目前傾向是「必須新增 lineage node」，下一輪驗證。

## Knowledge Graph 新增 Node / Edge

Nodes：ExternalWorldEffect、RuntimeObservation、EffectHistory、EffectContract、LogicalEffectIdentity、DispatchWitness、AuthoritativeReceipt、ReceiptCompleteness、ProviderReadback、PostconditionVerifier、SettlementState、ReconciliationRequired、WeakReceiptFeed、StrongReceiptFeed、ExternalEffectAnomaly。

Edges：RuntimeObservation OBSERVES ExternalWorldEffect；AuthoritativeReceipt RESOLVES IN_DOUBT；ReceiptAbsence DOES_NOT_PROVE NOT_LANDED；StrongReceiptFeed ENABLES EffectSettlementProof；ProviderReadback SUPPORTS SettlementProof；SettlementProof EXTENDS EffectWitness；MCPAnnotation DOES_NOT_IMPLY EffectContract；CheckpointRestore MUST_PRESERVE EffectWitnessLog。

## 與歷史研究比較

上一輪停在 SemanticRestoreAdmissibility / EffectWitness / SettlementProof 名詞層。本輪補上 SettlementProof 的底層 state machine、receipt completeness、authoritative readback 與 tool-boundary anomaly，將「世界發生了什麼」從抽象節點變成可實作的 runtime protocol。

## 下一輪研究

直接讀 durable-agent-outbox `transitions.ts / reduce.ts / ports.ts / audit legality / postgres stress`，建立完整 receipt fault-injection matrix；再研究 provider readback 的 linearizable/eventual consistency 對 SettlementProof 的影響，以及 compensation-as-new-effect 的 lineage/settlement semantics。

## 本輪結束判斷

缺哪一層：Provider-specific authoritative readback / consistency semantics。
最淺節點：PostconditionVerifier 與跨 provider SettlementProof。
仍只是名詞：Universal AuthoritativeOutcome IR。
最值得讀原始碼：durable-agent-outbox core reducer + receipt ports + stress harness。
需追引用：When Tool Calls Succeed but Workflows Fail (2609.15397)。
最適合視覺模擬：External Effect Settlement Microscope。
最值得實作的 Agent 架構：Effect-aware durable agent loop：Plan → Effect Contract → Durable Intent → Tool → Reconcile → Settlement Gate → Next Decision。

最終鏈新增：
User → UI → Agent → Context → Reasoning → Planning → Tool Intent → Effect Contract → MCP/API → External Effect → Receipt/Readback → SettlementProof → Memory/Belief Update → Next Action → Output。
