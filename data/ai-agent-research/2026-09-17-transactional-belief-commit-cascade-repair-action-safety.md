# 【AI Agent × Multimodal Research Report】

**時間：2026-09-17 22:56（Asia/Taipei）**  
**主題：Transactional Belief Commit × Cascade Repair × Action-Safety Gate × Revisable Execution**

## 與歷史研究比較

上一輪已建立 `ExpectedOutcome → Observation → Verification → BeliefRevision → Plan invalidation → Compensation`，並把 `CompensationPolicy` 標成最淺節點。本輪避免重複 09/08、09/11、09/15 已研究過的 Cordon / Saga / Atomix transaction 基礎，而專注新的缺口：**belief 本身何時才可以成為可驅動不可逆 action 的 committed state，以及 belief 被撤回後如何保證所有 downstream 派生物都被修復。**

## 本小時新發現

### 1. Memory write ≠ Belief commit

2026-07 的 MemTX 提出 Transactional Belief Commit：共享 memory 中一筆 accepted write 不應立即被當成可驅動 action 的真實 belief。每筆 record 帶 evidence、permissions、provenance、validity；寫入先進 snapshot-isolated transaction，再經 validate-and-commit，且 irreversible tool calls 會被 in-flight belief state gate。

這補上 Hermes 目前很關鍵的一個 missing boundary：

```text
Observation / Tool Result
→ Candidate Memory Write
→ Evidence + Provenance + Validity
→ STAGED BELIEF
→ Validate
→ COMMITTED BELIEF
→ Planning
→ Tool Intent
→ Action Safety Gate
→ External Effect
```

因此：

```text
MemoryWriteAccepted ≠ BeliefCommitted ≠ ActionAuthorized
```

### 2. Belief retraction 必須是 cascading repair，而不是只改 memory text

MemTX 的核心不是只有 commit；當 belief 被 retract 時，它會觸發 typed cascading repair，處理 derived records 與 tool side effects。論文提出 action-safety gating 與 cascade-repair completeness 兩個 invariants，並以 property-based testing + bounded exhaustive enumeration 驗證 protocol state space。

Hermes 因此把上一輪的 BeliefRevision 擴成：

```text
Retract Belief B7
→ traverse DERIVED_FROM / DEPENDS_ON edges
→ invalidate Claim C9
→ invalidate Memory M12
→ invalidate Plan P4
→ inspect Action A8
   ├ not executed → CANCEL
   ├ reversible → ROLLBACK
   ├ compensable → COMPENSATE
   └ irreversible → STOP + ESCALATE + INCIDENT RECORD
→ recompute descendants from surviving evidence
```

新的 correctness target：

```text
CascadeRepairComplete(B)
=
no active descendant may still depend exclusively on retracted B
```

### 3. Revisability 有硬上限：Irreversible action 不能靠更好的 reasoning 消除

2026-04 `Revisable by Design` 將 streaming agent actions 分成 Idempotent / Reversible / Compensable / Irreversible，並指出 agent flexibility 受 reversibility 限制；conflicting irreversible actions 使完整 revision satisfaction 在一般情況下不可能。

因此 Hermes 不應把所有 recovery 都畫成「rollback」。應明確區分：

```text
IDEMPOTENT    → replay-safe
REVERSIBLE    → inverse operation
COMPENSABLE   → semantic counter-action; 不保證還原原世界
IRREVERSIBLE  → cannot undo; only contain/escalate/future correction
```

這也修正上一輪 `ActionReversibility = REVERSIBLE | PARTIAL | IRREVERSIBLE`：`COMPENSABLE` 應是獨立 semantic class，而不是模糊放在 PARTIAL。

### 4. Provenance 應同時 gate belief commit 與 action commit

2026 ProvenanceGuard 把 proposed tool call 是否由 context 中可追溯 evidence 支持，轉成 pre-execution alignment gate。這與 MemTX 可組成雙 commit barrier：

```text
Evidence
→ Belief Commit Barrier
→ Committed Belief
→ Plan / Action Proposal
→ Action Provenance Barrier
→ Effect Transaction / Commit
```

如果 evidence 後來被撤回：

```text
Evidence retract
→ Belief retract
→ Action lineage traversal
→ compensation / escalation
```

因此 provenance 不只是「解釋為什麼做」，而是 transaction dependency graph 的一部分。

### 5. Agent runtime 需要把 cognitive state 與 effect state 分成兩個 transaction plane

本輪提出 Hermes architecture：

```text
COGNITIVE TRANSACTION PLANE
Evidence
→ Candidate Claim
→ Candidate Belief
→ Validate
→ Belief Commit

EFFECT TRANSACTION PLANE
Committed Belief
→ Plan
→ Tool Intent
→ Validate authority/provenance/reversibility
→ Stage Effect
→ Commit Effect
```

兩者透過 lineage edge 相連：

```text
Effect E17
AUTHORIZED_BY Belief B7
DERIVED_FROM Evidence V4
```

當 B7 被 retract，Runtime 才能知道究竟要修哪些 downstream effects，而不是依賴 LLM 回頭閱讀長對話猜測。

## 本小時最重要 5 個發現

1. **Transactional Belief Commit**：memory entry 進入 context 前/後都不代表它已成為可安全驅動 action 的 committed belief。
2. **Cascade Repair Completeness**：belief retraction 後所有仍 active 的 dependent claims/plans/actions 必須可被列舉並處理。
3. **Four-way reversibility taxonomy**：Idempotent / Reversible / Compensable / Irreversible 是 runtime recovery policy 的基本型別。
4. **Double Commit Barrier**：先 commit belief，再 commit external effect；兩層都需要 provenance/validity evidence。
5. **Lineage is executable recovery metadata**：provenance graph 不只是 audit visualization，而能直接決定 invalidate / rollback / compensate / escalate 範圍。

## Architecture Breakdown

### System Architecture：Transactional Belief-to-Effect Runtime

```text
Camera / Audio / Tool / MCP / Memory
→ Evidence Node
→ Provenance + Time + Freshness + Permission
→ Candidate Claim
→ STAGED BELIEF
→ Belief Validator
→ COMMITTED BELIEF
→ Planner
→ Action Proposal
→ Provenance / Authority / Reversibility Validator
→ STAGED EFFECT
→ Commit Barrier
→ External System
→ Effect Receipt / Postcondition
```

Revision path：

```text
Late / contradictory evidence
→ retract evidence/claim
→ retract committed belief
→ Cascade Repair Engine
→ dependency traversal
→ invalidate future plans
→ classify already-executed effects
→ rollback / compensate / contain
→ re-plan from surviving committed state
```

### Runtime objects

```text
BeliefRecord {
  belief_id
  statement
  status: STAGED | COMMITTED | RETRACTED
  evidence_ids[]
  provenance_root_ids[]
  valid_time_range
  permissions
  revision
  descendants[]
}

EffectRecord {
  effect_id
  tool_call_id
  authorized_by_belief_ids[]
  provenance_ids[]
  status: PROPOSED | STAGED | COMMITTED | COMPENSATED | CONTAINED
  reversibility: IDEMPOTENT | REVERSIBLE | COMPENSABLE | IRREVERSIBLE
  inverse_or_compensation_ref
  receipt
  postcondition
}
```

## Bottom-Level Logic

### Belief commit

```text
Raw Observation
→ normalize identity/time
→ provenance validation
→ freshness/coverage check
→ claim extraction
→ contradiction check against committed beliefs
→ permission/authority check
→ stage candidate
→ validator verdict
→ atomic belief commit + lineage edges
```

### Action commit

```text
Intent
→ Tool Schema
→ Tool Selection
→ Arguments
→ derive supporting Belief IDs
→ provenance/alignment check
→ classify side effect
→ classify reversibility
→ stage if possible
→ authorization / commit gate
→ execute/release effect
→ Observation / Receipt
→ Postcondition Verification
→ append EffectRecord
```

### Cascade repair

```text
Retract B
→ graph traversal descendants(B)
→ mark dependent uncommitted nodes invalid
→ for each committed effect:
   switch reversibility:
     IDEMPOTENT   → no duplicate repair; verify final state
     REVERSIBLE   → execute inverse + verify
     COMPENSABLE  → execute semantic compensation + verify business postcondition
     IRREVERSIBLE → contain downstream propagation + escalate
→ rebuild beliefs/plans from surviving roots
→ verify no active node has sole dependency on B
```

## Visual Simulation Idea

### Belief Commit & Cascade Repair Simulator

Dual-plane UI：

```text
EVIDENCE PLANE
Frame F4 ─ Tool T2 ─ Memory M3
    \        |        /
     → Candidate Belief B7 [STAGED]
              ↓ validate
          B7 [COMMITTED]

EFFECT PLANE
B7 → Plan P4 → Action A8 → External Effect E17

LATE EVIDENCE
F9 contradicts B7
        ↓
B7 [RETRACTED]
        ↓
P4 invalidated
        ↓
E17 classify: COMPENSABLE
        ↓
Compensation C18
```

Controls：late evidence、stale tool result、memory poisoning、belief validator threshold、effect type、reversibility、effect already committed、compensation failure、irreversible action。UI 即時顯示 `STAGED / COMMITTED / RETRACTED / COMPENSATED / CONTAINED` 與 cascade coverage percentage。

## Code / GitHub

本輪優先方向：後續應追 MemTX 若公開 code 的 transaction manager / belief record / cascade repair implementation；同時比較既有 Hermes 歷史已研究的 Cordon、Atomix 與 LangGraph durable execution，避免再重做 transaction 定義。

歷史研究已涵蓋：
- `2026-09-11-effect-semantics-idempotency-toctou-saga-recovery-verification.md`
- `2026-09-15-agentic-acid-frontiers-compensation-cross-tool-atomicity.md`
- `2026-09-15-selective-execution-semantic-transactions-runtime-risk.md`

值得繼續讀的 implementation categories：transaction/effect outbox、idempotency key、checkpoint/replay、compensation registry、lineage graph、postcondition verifier。

## Papers

### 1. MemTX: Transactional Belief Commit for Stateful Agent Memory
Authors: Xiaoyang Li, Yiqi Wang, Haohui Lu, Zhi Chen, Mo Li, Pingan Song, Taotao Cai  
Year: 2026  
URL: https://arxiv.org/abs/2607.23929  
Architecture: snapshot-isolated belief transactions + validate-and-commit + irreversible-action gate + typed cascading repair.  
Contribution: separates memory write from belief commit and connects belief retraction to downstream repair.  
Reported verification: property-based testing and bounded exhaustive enumeration over 5.5M protocol states for action-safety gating and cascade-repair completeness.  
Limitation: research protocol/evaluation does not imply arbitrary real-world APIs possess valid inverse/compensation operations.

### 2. Revisable by Design: A Theory of Streaming LLM Agent Execution
Authors: Zhiyuan Zhai, Ming Li, Xin Wang  
Year: 2026  
URL: https://arxiv.org/abs/2604.23283  
Architecture: streaming execution + reversibility taxonomy + Revision Absorber / Earliest-Conflict Rollback.  
Contribution: formalizes the boundary imposed by irreversible actions and adaptation cost of compensable conflicts.  
Limitation: theoretical/action-model assumptions still require tool-specific recovery semantics in production runtimes.

### 3. Safeguarding LLM Agents from Misalignment through Provenance Analysis
Authors: Yining She, Yiliang Liang, Eunsuk Kang  
Year: 2026  
URL: https://arxiv.org/abs/2607.01236  
Architecture: provenance-based multi-stage pre-execution tool-call gate.  
Contribution: turns action support from opaque LLM judgment into traceable context/evidence analysis.  
Limitation: pre-execution alignment gating does not itself solve post-commit external-world compensation.

### 4. Cordon / Atomix / SagaLLM — historical comparison only
Hermes 已在前幾輪深入整理 semantic transaction、effect staging、frontier-gated commit、Saga compensation；本輪只把它們作為 effect-plane reference，不重複當作新發現。

## 已確認 / 官方 / 論文 / 工程 / 推論 / 假說

**論文結果：** MemTX 提出 transactional belief commit、action-safety gate、cascade repair；Revisable by Design 提出四類 reversibility 與 streaming revision theory；ProvenanceGuard 在 action execution 前做 provenance-based alignment analysis。

**歷史已確認研究：** Hermes repo 已在 09/11、09/15 多輪研究 Cordon/Saga/Atomix，因此本輪不把 transaction/effect staging 本身當新節點。

**合理工程推論：** cognitive belief transaction 與 external effect transaction 應分成兩層，但由 provenance/lineage graph 相連，才能讓 late evidence 觸發精準 cascade repair。

**尚未驗證假說：** `BeliefCommitBarrier + EffectCommitBarrier + CascadeRepairCompleteness` 能顯著降低 delayed multimodal evidence 導致的 irreversible downstream harm；需 fault-injection benchmark 驗證。

## Unknown / Open Questions

1. MemTX 是否公開完整 source code？其 cascade repair 是 deterministic graph traversal、rule registry，還是部分依賴 LLM generation？
2. `COMPENSABLE` action 的「補償成功」應以 inverse API success、business postcondition，還是 authoritative external-state convergence 判定？
3. 一個 effect 同時依賴多個 beliefs 時，撤回其中一個 belief 的 minimal repair set 如何計算，才能避免過度 rollback？

## 下一輪研究

```text
MemTX implementation / artifacts
→ belief transaction representation
→ snapshot isolation semantics
→ cascade repair algorithm
→ property-based invariant tests

Then
Multi-belief dependency graph
→ minimal invalidation cut
→ compensation ordering
→ compensation failure
→ authoritative post-state verification
```

建立 fault fixtures：

```text
staged belief retracted before action
committed belief retracted before staged effect release
belief retracted after reversible action
belief retracted after compensable action
belief retracted after irreversible action
shared effect supported by multiple beliefs
compensation itself fails
```

## Knowledge Graph 新增 Node / Edge

### Nodes
- `CandidateBelief`
- `StagedBelief`
- `CommittedBelief`
- `RetractedBelief`
- `BeliefCommitBarrier`
- `ActionSafetyGate`
- `CascadeRepair`
- `CascadeRepairCompleteness`
- `EffectRecord`
- `EffectCommitBarrier`
- `CompensableAction`
- `IrreversibleActionContainment`
- `BeliefEffectLineage`
- `CognitiveTransactionPlane`
- `EffectTransactionPlane`

### Edges
```text
Evidence → supports → CandidateBelief
CandidateBelief → validated_by → BeliefCommitBarrier
BeliefCommitBarrier → commits → CommittedBelief
CommittedBelief → authorizes → ActionProposal
ActionProposal → gated_by → ActionSafetyGate
ActionProposal → staged_as → EffectRecord
EffectRecord → committed_by → EffectCommitBarrier
EffectRecord → authorized_by → CommittedBelief
RetractedBelief → triggers → CascadeRepair
CascadeRepair → traverses → BeliefEffectLineage
CascadeRepair → must_satisfy → CascadeRepairCompleteness
CompensableAction → repaired_by → CompensatingAction
IrreversibleAction → requires → ContainmentAndEscalation
```

## 本輪結束判斷

- **缺哪一層：** multi-belief/multi-effect dependency 下的 minimal repair set + compensation ordering + authoritative post-state verification。
- **哪個節點最淺：** `CascadeRepairCompleteness` 在真實跨 SaaS/API 世界中的判定。
- **哪個概念仍只是名詞：** `semantic compensation success`，若沒有 authoritative postcondition 仍可能只是「補償 API 回 200」。
- **哪個系統值得讀原始碼：** MemTX artifact/code（若公開）與其 invariant tests；再對照 Atomix/Cordon effect ledger。
- **哪篇論文需追引用：** MemTX 與 Revisable by Design，尤其 belief retraction → action repair 的後續工作。
- **哪個概念最適合視覺模擬：** Belief Commit & Cascade Repair Simulator。
- **哪個 Agent 架構最值得實作：** `Evidence-backed EVU + Transactional Belief Commit + Effect Commit Barrier + Cascade Repair`，比單純 ReAct/Plan-and-Execute 更接近可恢復的長期 Agent Runtime。

## 回到「AI 到底怎麼運作」

```text
Camera / Image / Voice / Video / Tool
→ Encoder / Tokens / Observation
→ Provenance / EventTime / Freshness
→ Candidate Claim
→ Candidate Belief
→ Belief Commit Barrier
→ Committed Belief
→ Reasoning
→ Planning
→ Tool Intent
→ Action Safety Gate
→ Effect Commit Barrier
→ External Action
→ Observation / Postcondition

Late / Contradictory Evidence
→ Belief Retraction
→ Cascade Repair
→ Plan Invalidation
→ Rollback / Compensation / Containment
→ Re-plan
```

核心結論：**Agent 的 memory 不是 database truth，belief 也不應一產生就具有驅動外部世界的權力。真正可靠的 Agent Runtime 需要先把 evidence 變成可驗證、可撤回的 committed belief，再讓 belief 經第二道 effect commit gate 產生外部 action；若上游 evidence 後來失效，系統必須能沿 lineage graph 找出所有 downstream claim、plan 與 effect，並證明 cascade repair 已完整收斂。**