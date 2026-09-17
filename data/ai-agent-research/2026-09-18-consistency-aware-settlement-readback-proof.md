# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 01:55（Asia/Taipei）

主題：Consistency-Aware Settlement × Authoritative Read-back × Proof Freshness × MCP Effect Contract

## 本小時新發現

本輪延續上一輪 External Effect Settlement，但不重複「HTTP 200 不等於世界已完成」。新問題是：即使 Agent 已經做 provider read-back，這個 read 是否足以證明 effect settled？答案取決於 provider 的 consistency semantics、read freshness、effect identity 與 postcondition。

已確認事實：Google Cloud Spanner 的 strong read 會看到 read 開始前所有已 commit transaction；external consistency 進一步讓 transaction serialization order 與可觀察 commit order一致。這提供一個重要對照：只有當 provider 提供足夠強的 read semantics，read-back 才能直接成為高強度 settlement evidence。

官方 MCP 資訊：現行 tool annotations 提供 readOnly/destructive/idempotent/openWorld 等風險 hints；MCP 官方 2026-03 文章明確提醒 annotations 是 risk vocabulary，不是 deterministic safety guarantee，並討論 response/runtime annotations 的未來方向。因此 Hermes 不應把 idempotentHint 當成 EffectSettlementProof。

工程推論：對 eventual-consistent SaaS，單次 GET 沒看到 effect 不能推出 NOT_LANDED；需要 receipt、effect identifier、version/ETag/revision、poll/reconcile frontier 或 terminal provider state。

## 本小時最重要 5 個發現

### 1. Authoritative Read-back 不是 Boolean，而是 consistency-qualified evidence

底層：
Effect Intent → Dispatch → Provider Commit? → Read-back → Consistency Contract → Freshness Bound → Postcondition → Settlement Verdict。

強讀取可提供較直接的 proof；eventual/stale read 只能提供 bounded/weak evidence。限制：不同 provider 對 read-after-write、list、webhook、cache 的語義不同。

### 2. 「沒有讀到」不能脫離 consistency model 解讀

對 eventual consistency：
Read(E)=ABSENT at t1 ≠ NOT_LANDED。

只有在 provider 能證明 read 覆蓋 effect commit frontier，或提供 authoritative terminal receipt，才能把 absence 升級成 retry-safe NOT_LANDED。

### 3. SettlementProof 必須保存 Proof Freshness

新增：
SettlementProof {
 effect_id,
 provider,
 observed_state,
 read_mode,
 provider_revision,
 observed_at,
 freshness_bound,
 postcondition,
 verdict,
 evidence_ids
}

舊 proof 可能被後續 external mutation supersede，所以 SETTLED 也不是永久真理；長任務 Agent 要能判斷 proof 是否仍 current。

### 4. MCP ToolAnnotations 與 EffectContract 必須分層

ToolAnnotations：模型/host 用來做風險提示與 UX/orchestration。
EffectContract：Runtime 用來決定 retry、reconciliation、receipt、read-back、postcondition、compensation。

建議 Hermes EffectContract 至少包含：logicalEffectKey、idempotencyScope、receiptMode、readbackTool、consistencyClass、terminalStates、postconditionSchema、compensationTool、settlementTimeout。

### 5. Provider-specific adapters 比 Universal Outcome 猜測更可靠

合理架構不是強迫所有 SaaS 假裝同一 consistency model，而是：Provider Adapter → Provider Native State → Normalized Settlement IR。

Normalized verdict 可統一為 LANDED / NOT_LANDED / IN_DOUBT / SETTLED / SUPERSEDED，但必須保留 native receipt/revision/status，避免 normalization 丟失證據。

## Architecture Breakdown

User Intent
→ Agent Plan
→ Tool Intent
→ MCP Tool Schema
→ EffectContract
→ Logical Effect Identity
→ Durable Intent
→ Dispatch Witness
→ Provider
→ Native Receipt / Status
→ Provider Read-back
→ Consistency Adapter
→ Freshness Evaluation
→ Postcondition Verifier
→ SettlementProof
→ Durable EffectWitness
→ Belief / Memory Update

若 timeout/crash：
ATTEMPTING → IN_DOUBT → Reconciliation Adapter → {LANDED, NOT_LANDED, UNKNOWN} → retry/replay/block。

## Bottom-Level Logic

### Consistency-aware settlement predicate

Settled(E) := IdentityMatched(E) ∧ AuthoritativeEnough(Read(E)) ∧ FreshEnough(Read(E)) ∧ Postcondition(E)=PASS。

RetrySafe(E) := authoritative_outcome(E)=NOT_LANDED。

若 ReadMode=EVENTUAL 且沒有 bounded staleness/version frontier：ABSENT 只能得到 UNKNOWN。

### Proof strength ladder

L0 Runtime response only
L1 provider receipt
L2 provider read-back
L3 read-back + effect identity/version
L4 strong/externally-consistent read + postcondition
L5 independent reconciliation + durable witness

此 ladder 是 Hermes architecture proposal，不是業界標準。

## Visual Simulation Idea

### Consistency-Aware Settlement Microscope

五條 timeline：Agent / MCP / Provider Commit / Replica Read / Receipt-Reconciliation。

可注入：response lost、replica lag、stale cache、webhook delay、duplicate retry、provider status transition、effect superseded。

UI 顯示：Runtime Status、Native Provider State、Read Consistency、Freshness Bound、Proof Strength、Settlement Verdict、Retry Admissibility。

## Code / GitHub

Hermes Console 歷史研究已建立 EffectSettlement/ProviderReadback 節點；本輪新增 consistency-qualified proof，而非重複前一輪。

值得下一輪追的原始碼：durable-agent-outbox transitions/reduce/ports/audit；以及實際 provider adapter 如何將 native receipt/readback 映射到 terminal outcome。

## Papers / Official Sources

1. Google Cloud Spanner TrueTime and External Consistency — 官方文件。Architecture：MVCC + transaction commit timestamps + TrueTime；Contribution：strong reads/external consistency 提供可推理的 read-after-commit semantics；限制：不能直接代表一般 SaaS API。
2. Model Context Protocol Blog, Tool Annotations as Risk Vocabulary (2026-03-16) — 官方 MCP 文章。Contribution：釐清 annotations 的能力與限制；限制：annotations 不是 transactional effect contract。
3. MCP 2026-07-28 release/SDK docs — Tool schema 持續演進，但 settlement/readback semantics 仍需要 application/runtime layer 補足。

## Unknown / Open Questions

1. 如何用最小 Provider Adapter schema 同時表示 strong、bounded-stale、eventual、webhook-only provider？
2. SettlementProof 被後續 external mutation supersede 時，哪些 Belief/Plan 必須重新驗證？
3. 跨兩個 provider 的 action chain，如何建立共同 settlement frontier，而不是各自 SETTLED 就宣稱 workflow complete？

## 下一輪研究

深入 multi-provider settlement frontier：A effect settled → B effect pending/unknown → workflow completion proof；研究 version vector / causal dependency / saga receipt chain；讀 durable-agent-outbox transition reducer 與 legality audit；建立 Provider Adapter IR 與 EffectContract schema。

## Knowledge Graph 新增 Node / Edge

Nodes：ConsistencyClass、StrongReadProof、EventualReadEvidence、ReadFreshnessBound、ProviderRevision、ConsistencyAdapter、SettlementProofStrength、EffectContract、ProviderNativeState、NormalizedSettlementIR、ProofSupersession、RetryAdmissibility。

Edges：ProviderReadback QUALIFIED_BY ConsistencyClass；StrongReadProof SUPPORTS SettlementProof；EventualReadEvidence MAY_REMAIN IN_DOUBT；SettlementProof HAS FreshnessBound；ToolAnnotation DOES_NOT_REPLACE EffectContract；ProviderNativeState NORMALIZED_BY ConsistencyAdapter；ProofSupersession INVALIDATES SettlementProof；AuthoritativeNOT_LANDED ENABLES RetryAdmissibility。

## 與歷史研究比較 / 本輪收尾

缺哪一層：multi-provider causal settlement frontier。
最淺節點：ProofSupersession 與跨 provider SettlementProof composition。
仍只是名詞：Universal AuthoritativeOutcome IR；應改成 provider-native evidence + normalized verdict。
最值得讀原始碼：durable-agent-outbox reducer/legality + provider adapter。
需追引用：agent external-effect anomaly / settlement 類工作與 transaction/recoverability 工作的後續引用。
最適合視覺模擬：Consistency-Aware Settlement Microscope。
最值得實作的 Agent 架構：Evidence/Belief Commit + EffectContract + IN_DOUBT Reconciler + Settlement Gate 的 transactional Agent Runtime。

最終鏈新增：UI → Agent → Context → Reasoning → Planning → Belief → Tool Intent → MCP → EffectContract → Provider → Receipt/Readback → Consistency/Freshness → SettlementProof → Memory/Next Action；多模態 evidence 仍沿 Camera/Image/Voice/Video → Encoder → Tokens → Fusion → Evidence/Belief，再接同一 Effect Settlement path。
