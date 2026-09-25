# AI Agent × Multimodal Research Report — 2026-09-25 14:51 TST

## 本輪主題
UCP failover semantics → recovery rounds → logical operation / physical attempt separation → Hermes commit-capability model.

## 新發現
1. UCX 1.22.0 (2026-08-02) officially added fault-tolerance recovery foundation, AM/zcopy/multi/PSN protocol failover, endpoint flush failover, and first-fragment retransmission.
2. UCP_ERR_HANDLING_MODE_FAILOVER is explicitly defined as best-effort protocol-layer recovery: after a transport error it tries the next available communication channel; if it cannot recover, semantics fall back to PEER-style failure handling.
3. RECOVERY_RETRIES is a first-class UCP runtime control. Recovery occurs in rounds after KEEPALIVE_INTERVAL and applies only to FAILOVER endpoints. Therefore recovery is a temporal state machine, not a single retry edge.
4. Logical operation identity must survive physical-attempt replacement. A retry/failover attempt must not inherit commit authority merely because request pointers, lane IDs, QPNs, WQE counters, or sequence numbers are reused.
5. Hermes can reuse this exact model above transport: Agent task / tool call / MCP call / model call should have LogicalTransactionGeneration plus one or more ExecutionAttemptGeneration values, with commit authority explicitly revoked when an attempt closes.

## Architecture Breakdown
User → UI → Agent LogicalTransaction → Context/Memory → Reasoning/Planning → Model Invocation → UCP LogicalOperation → Protocol Attempt A_g → UCT Lane/Endpoint → Transport → completion/error → AttemptDomainClosure or success → RecoveryRound → alternate channel/protocol Attempt A_g+1 → AcceptedTerminalWitness → logical commit → output.

## Bottom-Level Logic
UCP FAILOVER semantics imply:
TransportError(A_g)
→ ProtocolRecoveryDecision
→ RecoveryRound(r)
→ if recoverable: close(A_g), choose next available communication channel, create(A_g+1)
→ else: terminal peer-style failure.

Proposed Hermes invariant:
Commit(c) iff
c.logical_generation == active_logical_generation
AND c.attempt_generation == active_attempt_generation
AND active_attempt.commit_capability == GRANTED
AND active_attempt.domain_state == OPEN.

On failure/discard:
AttemptDomainClosureWitness(A_g)
→ revoke commit capability
→ all later completions/callbacks attributed to A_g become diagnostic-only.

## System Architecture Insight
The important abstraction is no longer "retry". It is a two-level transaction:
Logical lifetime: one user-visible operation.
Physical lifetime: zero or more replaceable execution attempts.

This applies to transport failover and to Agent Runtime:
ToolCall T
→ Attempt 0 (browser) fails
→ revoke Attempt 0 commit capability
→ Attempt 1 (API) succeeds
→ exactly one AcceptedTerminalWitness commits T.

## Visual Simulation Idea
"Logical Transaction / Attempt Failover Simulator"
Columns:
Logical Transaction | Recovery Round | Attempt Epoch | Route/Lane | Domain State | Commit Capability | Completion/Event | Accepted/Rejected.

Fault injection:
LATE_CALLBACK_AFTER_ATTEMPT_CLOSE
SAME_POINTER_NEW_ATTEMPT
FLUSH_FAILOVER
NO_MORE_CHANNELS
RECOVERY_RETRY_EXHAUSTED
OLD_TOOL_RESULT_AFTER_ROUTE_SWITCH

## Code / GitHub to inspect next
OpenUCX:
- src/ucp/api/ucp_def.h — UCP_ERR_HANDLING_MODE_FAILOVER semantics
- src/ucp/core/ucp_context.c — RECOVERY_RETRIES / KEEPALIVE_INTERVAL
- src/ucp/proto/ — protocol failover lifecycle
- src/ucp/core/ucp_ep.c — endpoint failure/recovery state
- wireup/proxy endpoint code — channel replacement and discard

## Papers / technical lineage
Baseline: Shamis et al., "UCX: An Open Source Framework for HPC Network APIs and Beyond" (HOTI 2015).
Current architectural delta: UCX 1.22.0 adds explicit recovery/failover mechanisms, changing the runtime model from one physical path per operation toward logical operation + replaceable protocol attempts.

## Unknown / Open Questions
1. Which concrete UCP request/protocol fields revoke completion eligibility for a discarded attempt?
2. How does endpoint-flush failover prevent a late completion from satisfying a newer flush attempt?
3. Does UCP expose enough generation evidence to prove stale callback rejection, or must Hermes synthesize an explicit epoch?

## Knowledge Graph — New Nodes
RecoveryPolicyGeneration
RecoveryRoundGeneration
LogicalTransactionGeneration
ExecutionAttemptGeneration
CommitCapability
CommitCapabilityRevocationWitness
AcceptedTerminalWitness
DiagnosticOnlyCompletion
RecoveryExhaustionWitness

## Knowledge Graph — New Edges
LogicalTransactionGeneration --has_attempt→ ExecutionAttemptGeneration
TransportError --starts→ RecoveryRoundGeneration
RecoveryRoundGeneration --may_create→ ExecutionAttemptGeneration(g+1)
AttemptDomainClosureWitness --revokes→ CommitCapability(g)
ClosedAttemptCompletion --classified_as→ DiagnosticOnlyCompletion
AcceptedTerminalWitness --commits→ LogicalTransactionGeneration

## 與歷史研究比較
前幾輪集中在 mlx5 WQE/CQE、completion frontier、error purge 與 CompletionAttributionDomain。本輪沒有重複那些硬體細節，而是首次把官方 FAILOVER API semantics 與 RECOVERY_RETRIES runtime policy接起來，將 generation fencing提升成可直接套用到 Hermes Agent Runtime 的 logical-transaction/physical-attempt model。

## 下一輪
Direct source trace:
failed UCT lane → UCP protocol failure object → discard/reset → recovery round → alternate lane/protocol selection → request restart → callback eligibility → endpoint flush failover → accepted logical completion.

## 本輪結論
缺的層：UCP protocol-request failover object lifecycle.
最淺節點：CommitCapabilityRevocationWitness 對應到 UCX concrete field/object 的證據。
仍只是名詞：portable stale-callback rejection epoch across transports.
最值得讀原始碼：OpenUCX src/ucp/proto and ucp_ep.c.
最值得追引用：UCX 1.22 fault-tolerance implementation commits/PRs.
最適合視覺模擬：Logical Transaction / Attempt Failover Simulator.
最值得實作的 Agent 架構：Event-sourced Agent Runtime + LogicalTransactionGeneration + ExecutionAttemptGeneration + explicit CommitCapability + Recovery Fence.
