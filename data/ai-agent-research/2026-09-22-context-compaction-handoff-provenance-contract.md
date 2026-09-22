# 【AI Agent × Multimodal Research Report】

時間：2026-09-22 20:51 Asia/Taipei

主題：Context Compaction × Multi-Agent Handoff × Provenance/Authority Preservation Contract

## 與歷史研究比較
上一輪已建立 MemoryOriginIdentity、MemoryAuthorityEnvelope、AuthorityPreservationWitness，缺口是 provenance/authority 經過 context compaction、summarization 與 multi-agent handoff 後如何存活。本輪不重複 memory write/retrieval，而專注 transformation boundary：`Memory/RAG → Context Assembly → Compaction → Handoff → Receiving Agent → Tool Sink`。

## 本小時新發現
- 新論文：The Compaction Cliff in Long-Running AI Agent Memory（Zerhoudi, Mitrovic, Granitzer；University of Passau；2026；arXiv:2608.22752；CIKM 2026）。
- 新架構：Knowledge Triage：TypeCompact / TypeDecompose / TypeRetrieve，以 knowledge type 決定 distortion tolerance，而不是所有內容等比例摘要。
- 新原始碼：searchsim-org/cikm26-knowledge-triage；核心目錄 `knowledge_triage/`，值得追 `operators.py`, `classifier.py`, `classifier_cascade.py`, `preservation.py`, `safety_margin.py`, `kb.py`。
- 新 runtime evidence：OpenAI Agents SDK handoff history implementation：`src/agents/handoffs/history.py` 明確區分 summary-only items 與 lossless model input，並保留 nested-history owned-item provenance；同時官方文件警告 nesting 不是 redaction mechanism。
- 新 multi-agent對照：DeLM（Mao, Mirhoseini, 2026）以 shared verified context + task queue 讓多 agent 非同步寫回 compact verified updates；這證明 compact shared state 可以是 coordination substrate，但「verified」仍需與 authority / data-flow policy 分開建模。

## 本小時最重要 5 個發現

### 1. Compaction 是 security transformation，不只是 token optimization
已確認論文結果：Compaction Cliff 報告 Sonnet 4.6 `/compact` 對 safety rules 一輪只保留 53%，五輪降到 10%；Knowledge Triage 的 TypeCompact 五輪仍達 96% recall。這表示 uniform summarization 會直接破壞 enforcement state。

底層鏈：`ContextItem → KnowledgeType → FidelityRequirement → CompactionOperator → PreservationCheck → CompactedItemGeneration`。

新增 invariant：
`CompactionSafe = RequiredConstraintsPreserved ∧ AuthorityNotElevated ∧ ProvenanceRecoverable ∧ SinkRelevantLabelsPreserved`

### 2. Exact constraint preservation 與 semantic summary 必須分 lane
Knowledge Triage 原始碼的 `type_compact()` 會 pin CONSTRAINT，dedupe PROCEDURAL；若 constraints+procedures 已超出 budget，回傳 `COMPACTION_UNSAFE`，而不是偷偷丟掉 hard constraints。Belief / preference / episodic 才依剩餘 budget 降級。

這導出：
`TokenBudgetExceeded --must_not_imply→ ConstraintLoss`
`CompactionFailure --should_surface→ ExplicitUnsafeState`

### 3. Handoff summary 不是 redaction，也不是 provenance-preserving security boundary
OpenAI Agents SDK current `nest_handoff_history()` docstring明確說會從 input_history、pre_handoff_items、new_items 建 transcript；tool arguments/outputs可能留在生成 summary 中，僅過濾 `input_items` 不足以移除敏感內容。implementation還建立 exact provenance for items moved into default history。

因此：
`HandoffSummaryCreated --does_not_prove→ SensitiveDataRemoved`
`SummaryTextEquivalent --does_not_prove→ AuthorityEquivalent`

需要：`HandoffTransformWitness = SourceItemSet + TransformIdentity + DestinationAgent + RedactionPolicy + AuthorityProjection + DataLabelProjection`。

### 4. Receiving agent 應取得 projected authority，而不是 sender 全部 authority
Handoff 本質上是 delegation boundary。內容可傳遞，不代表權限可自動傳遞。Receiving agent 的 effective authority應為：
`ReceiverAuthority = SenderDelegatedAuthority ∩ TaskScope ∩ DestinationPolicy ∩ DataFlowPolicy`

合理工程推論：如果 summary 把「tool observation」重寫成普通 assistant prose而丟掉 origin/type，receiving agent可能無法區分 observation、instruction與delegated authority。這需 production trace 驗證，暫不標成 framework 已知 bug。

### 5. Shared verified context 仍需要 typed provenance
DeLM 的 system architecture：`Task Queue → Agent Claim → Read Shared Verified Context → Local Reasoning/Tool Work → Compact Verified Update → Shared Context`。論文在 SWE-bench Verified 報告最高可比 strongest baseline 提升 10.5 percentage points，且 cost/task 約減半；LongBench-v2 Multi-Doc QA最高提升 5.7 points。

但：`VerifiedFact --does_not_prove→ AuthorizedInstruction`。因此共享 context item 應至少帶：`Origin + Evidence + KnowledgeType + AuthorityClass + DataLabel + WriterAgent + Generation`。

## Architecture Breakdown
`Source Observation/Memory`
→ `Origin + Integrity + Authority + DataLabel binding`
→ `Context Assembler`
→ `Knowledge-Type Classifier`
→ `Typed Compaction Planner`
→ `Constraint Lane (lossless/pinned)` / `Procedure Lane` / `Belief-Preference-Episodic lossy lanes`
→ `Preservation Verifier`
→ `CompactedContextGeneration`
→ `Handoff Filter/Redactor`
→ `Authority Projection`
→ `Data-Label Projection`
→ `HandoffTransformWitness`
→ `ReceivingAgentContextGeneration`
→ `Planner/Reasoning`
→ `Tool Argument Construction`
→ `Sink PEP`
→ `Side-Effect Commit`.

## Bottom-Level Logic
### Typed compaction
`Item → classify(type) → determine fidelity floor → compute pinned budget → if hard floor > budget: COMPACTION_UNSAFE → else allocate soft budget → transform/drop soft items → verify constraint/procedure preservation → emit generation`.

### Handoff
`Sender ContextGeneration → choose destination → select source items → sanitize/redact → optionally summarize/nest → bind source-item provenance → project authority → project IFC labels → construct receiver model input → receiver reasoning`.

Critical distinction：
`ContentGeneration ≠ ProvenanceGeneration ≠ AuthorityGeneration ≠ DataLabelGeneration`。

## Visual Simulation Idea
**Context Compaction & Multi-Agent Handoff Provenance Microscope**

六欄：Source Context / Type Classifier / Compactor / Handoff Transformer / Receiver Context / Tool Sink。
每個 item 顯示 Type、Origin、Authority、DataLabel、Generation、Transformation lineage。
可注入：`CONSTRAINT_DROPPED_BY_COMPACTION`、`TOOL_OUTPUT_LEAKED_IN_NESTED_SUMMARY`、`AUTHORITY_LAUNDERED_BY_SUMMARY`、`CONFIDENTIAL_LABEL_DROPPED_ON_HANDOFF`、`RECEIVER_AUTHORITY_EXPANSION`、`SHARED_CONTEXT_FACT_BECOMES_INSTRUCTION`。

關鍵 UI：`Semantic Fidelity ✓ | Constraint Preservation ✓ | Provenance ✓ | Authority Projection ✗ | Sink Commit BLOCKED`。

## Code / GitHub
- searchsim-org/cikm26-knowledge-triage：`knowledge_triage/operators.py` 是核心 operators；`classifier*.py` 做 knowledge typing；`preservation.py` / `safety_margin.py` 值得下一輪深讀。
- openai/openai-agents-python：`src/agents/handoffs/history.py` 是 handoff compaction/nesting核心；`src/agents/handoffs/__init__.py` 定義 handoff/input filter contract。

## Papers
1. **The Compaction Cliff in Long-Running AI Agent Memory** — Saber Zerhoudi, Jelena Mitrovic, Michael Granitzer; University of Passau; 2026; arXiv:2608.22752; code: searchsim-org/cikm26-knowledge-triage; dataset: AgentArtifactCorpus (396,934 configurations / 54,628 public GitHub repos); architecture: typed context management; contribution: TypeCompact/TypeDecompose/TypeRetrieve; limitation: type classification錯誤與跨-agent authority semantics仍非主要研究目標。
2. **Decentralized Multi-Agent Systems with Shared Context** — Yuzhen Mao, Azalia Mirhoseini; Stanford; 2026; arXiv:2606.10662; architecture: decentralized agents + task queue + shared verified context; benchmarks: SWE-bench Verified, LongBench-v2; limitation: verified shared information不等於完整 security provenance / delegated authority model。
3. **Agent Zero Memory: Provenance-Aware Long-Term Memory for LLM Agents** — Ming Wu, Pengyuan Zhu; 2026; arXiv:2608.29606; architecture: episodic events + entity-event KG + citation-locked HDM; benchmarks: LongMemEval, LoCoMo; contribution: provenance-first multi-store memory；限制：authority/IFC與handoff enforcement仍需另建。

## Unknown / Open Questions
1. 如何讓 provenance/authority labels 經 LLM-generated summary 後仍能 machine-verifiable，而不是依賴 summary 自述？
2. Multi-agent handoff 的最小可攜 `AuthorityEnvelope` schema 應包含哪些 fields，才能跨 OpenAI Agents SDK / LangGraph / AutoGen / MCP？
3. server-managed conversation 無法套 handoff input filter時，production isolation boundary 應如何建立與驗證？

## 下一輪研究
`HandoffTransformWitness → ReceivingAgent Context → DelegatedAuthorityEnvelope → Subagent ToolCall → MCP Invocation → Sink Classification → SideEffectCommit`，比較 OpenAI Agents SDK、LangGraph Command/handoff、AutoGen message routing，並追「structured provenance sidecar」如何與自然語言 summary 分離。

## Knowledge Graph 新增 Node / Edge
Nodes：`KnowledgeTypeIdentity`, `CompactionGeneration`, `CompactionSafetyWitness`, `ConstraintFidelityFloor`, `CompactionUnsafeState`, `HandoffTransformGeneration`, `HandoffSourceItemSet`, `HandoffRedactionWitness`, `HandoffAuthorityProjection`, `HandoffDataLabelProjection`, `ReceivingAgentContextGeneration`, `SharedVerifiedContextGeneration`, `StructuredProvenanceSidecar`。

Edges：
- `SourceContextGeneration --transformed_by→ CompactionGeneration`
- `ConstraintFidelityFloor --constrains→ CompactionGeneration`
- `CompactionSafetyWitness --authorizes→ CompactedContextPublication`
- `CompactedContextGeneration --filtered_by→ HandoffTransformGeneration`
- `HandoffSourceItemSet --provenance_bound_to→ StructuredProvenanceSidecar`
- `SenderAuthority --projected_into→ HandoffAuthorityProjection`
- `HandoffAuthorityProjection --bounds→ ReceivingAgentAuthority`
- `HandoffDataLabelProjection --constrains→ ToolSinkPolicy`
- `SharedVerifiedContextGeneration --does_not_imply→ AuthorizedInstruction`

## 本輪結束判斷
- 缺哪一層：structured provenance/authority sidecar 如何穿越 summary/handoff 到 receiving agent tool invocation。
- 最淺節點：`HandoffAuthorityProjection` 的跨-framework production implementation。
- 仍只是名詞：portable `StructuredProvenanceSidecar` schema。
- 最值得讀原始碼：OpenAI Agents SDK `handoffs/history.py` + Knowledge Triage `operators.py/preservation.py`，下一輪接 LangGraph handoff/runtime。
- 最需追引用：The Compaction Cliff，因為它把 context compression 從效能問題提升為可量測的 safety invariant 問題。
- 最適合視覺模擬：Context Compaction & Multi-Agent Handoff Provenance Microscope。
- 最值得實作 Agent 架構：`State-grounded Planner + Typed Context Compiler + Lossless Constraint Lane + Structured Provenance Sidecar + Authority-Preserving Handoff + IFC Tracker + Non-LLM Sink PEP + Side-Effect Transaction Manager`。

最終鏈條推進為：`User → Agent → Memory/RAG → typed Context → safe Compaction → provenance/authority-preserving Handoff → Receiver Agent → Tool/MCP → Policy Gate → Side Effect`。