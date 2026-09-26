# 【AI Agent × Multimodal Research Report】

時間：2026-09-26 14:52（Asia/Taipei）

## 本小時新發現

本輪延續 13:55 的 Effect DAG + Conflict Graph + VersionWitness，但不重複 Saga/isolation 基礎；焦點下鑽到「Multi-Agent Shared Memory / Blackboard 的一致性模型」，並把資料庫的 MVCC/OCC 概念映射到 Agent 的長推理時間。

新論文：Yu et al., *Multi-Agent Memory from a Computer Architecture Perspective: Visions and Challenges Ahead* (2026) 把 multi-agent memory 視為 computer architecture problem，區分 shared/distributed memory，提出 I/O-cache-memory 三層，並指出 cache sharing 與 structured access control 是協議缺口，multi-agent memory consistency 是核心 open challenge。

## 本小時最重要 5 個發現

1. **Agent reasoning 必須綁定 ReadSnapshot。** Agent 從共享記憶讀取 facts 後可能推理數秒甚至數分鐘；若期間其他 agent 更新相同 state，模型推理本身可以邏輯正確，但其 preconditions 已過期。因此 ReadSnapshotVersion 必須進入 plan provenance。
2. **Blackboard 不能只是 mutable JSON。** Production shared memory 至少需要 per-record version、append-only event/WAL 或 MVCC snapshot、conditional write/CAS、conflict policy。否則 concurrent agent writes 會 overwrite intermediate state。
3. **MVCC 比全域鎖更適合 read-heavy Agent Memory。** Reader 固定讀 snapshot S；writer 建立新 version，不阻塞舊 reader。Agent commit 前再驗證 read-set versions；若變化則 re-read/replan。
4. **OCC 的 validation failure 應成為 Agent Runtime 的一級事件，而非 generic tool error。** 流程應是 ReadSet -> Reason -> ProposedWriteSet -> Validate(ReadSet versions) -> Commit 或 StaleContext -> Replan。
5. **CRDT/commutativity 只能用於有可證明 merge semantics 的 memory。** append evidence、set union、monotonic counters 可並行；plan text、唯一 owner、支付狀態等不可因「可 merge」就盲目 LWW。

## Architecture Breakdown

User input
→ Context Manager
→ Memory Query
→ MVCC Snapshot S
→ ReadSet {key, version, provenance}
→ Model Reasoning
→ Plan
→ Proposed WriteSet
→ Conflict-Key extraction
→ OCC Validation
→ if valid: conditional commit / append event
→ new Snapshot S+1
→ downstream Agent notification

若 validation fail：
VersionConflict → mark StaleReasoningState → invalidate affected derived nodes → selective context refresh → replan，而不是整個 Agent 從零重跑。

## Bottom-Level Logic

核心資料：
MemoryRecord = {key, value, version, writer, provenance, confidence, valid_from, supersedes?}
ReasoningSnapshot = {snapshot_id, read_set_hash, read_versions}
Mutation = {logical_operation_id, expected_versions, write_set, merge_policy}

安全提交：
CommitAllowed(op) = all current_version(key) == expected_version(key) for strict keys AND merge policy valid for commutative keys.

新增 invariant：
ReasoningCorrectAt(S) != ActionSafeAt(S+n)
ReadSuccess != CommitPermission
LWW != SemanticMerge
VectorSimilarity != MemoryConsistency

## Visual Simulation Idea

**Multi-Agent Memory MVCC Simulator**

左側 3-8 個 agents，中間 Blackboard/MVCC store，右側 version timeline。可注入 STALE_REASONING_WRITE、LOST_UPDATE、APPEND_ONLY_SAFE、CAS_CONFLICT、LWW_SEMANTIC_LOSS、CRDT_SAFE_MERGE、AGENT_CRASH_BEFORE_COMMIT。

每個 agent 顯示 Snapshot、ReadSet、Reasoning duration、WriteSet、Validation result。使用者可拖動另一 agent 的 write 到 reasoning window 中，觀察 stale context 如何產生。

## Code / GitHub

Hermes 現有 data/ai-agent-research 已由 lib/server/research-notes.ts 讀取，FINALIZATION_AUDIT 也記錄本地研究筆記可被 Hermes 搜尋。下一步不應只增加研究文件，而應在 runtime memory layer 引入 snapshot/version contract。

值得追的實作方向：
- append-only decision/effect event history
- versioned memory record
- compare-and-swap write API
- per-key conflict/merge policy
- stale-context selective invalidation

## Papers

Yu, Zhongming; Yu, Naicheng; Zhang, Hejia; Ni, Wentao; Yin, Mingrui; Yang, Jiaying; Zhao, Yujie; Zhao, Jishen. *Multi-Agent Memory from a Computer Architecture Perspective: Visions and Challenges Ahead*. 2026. arXiv:2603.10062.
Architecture: shared/distributed memory + I/O/cache/memory hierarchy.
Contribution: reframes agent memory consistency as systems/architecture problem.
Limitations: position paper; does not provide a complete production consistency protocol or benchmarked MVCC runtime.

MCP ToolAnnotations were also checked as a boundary reference: readOnly/destructive/idempotent/openWorld are hints, not trusted concurrency/effect contracts. They cannot replace version preconditions or conflict keys.

## Unknown / Open Questions

1. What machine-readable schema should declare a tool's ConflictKey and version precondition?
2. How should semantic/vector memory invalidate derived embeddings/summaries when source versions change?
3. Which memory classes should use strict OCC, append-only logs, CRDT merge, or single-writer ownership?

## 下一輪研究

Semantic/vector memory consistency → source-version lineage → embedding invalidation → RAG stale retrieval → derived-memory dependency graph → selective recomputation → multi-agent knowledge graph consistency.

## Knowledge Graph 新增 Node / Edge

Nodes: ReadSnapshot, ReadSet, WriteSet, SnapshotVersion, MVCCMemory, OCCValidation, VersionConflict, StaleReasoningState, ConditionalMutation, MergePolicy, CommutativeMemory, DerivedMemoryLineage.

Edges:
ReadSnapshot -> freezes -> ReadSet
ReadSet -> conditions -> Reasoning
Reasoning -> proposes -> WriteSet
OCCValidation -> compares -> ReadSetVersions
VersionConflict -> causes -> StaleReasoningState
StaleReasoningState -> requires -> SelectiveReplan
CommutativeMemory -> permits -> ParallelMerge
DerivedMemoryLineage -> enables -> SelectiveInvalidation

結論：缺的層是 derived semantic memory 的版本 lineage；最淺節點是 machine-readable ConflictKey/VersionPrecondition contract；仍只是名詞的是跨 Tool/MCP 的 consistency contract；最值得讀原始碼的是 Hermes memory/context manager + durable workflow/MVCC store；最適合視覺模擬的是 Multi-Agent Memory MVCC Simulator；最值得實作的 Agent 架構是 Event-sourced Runtime + MVCC Shared Memory + OCC Validation + Conflict Graph + RemoteEffectLedger。