# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 11:52 Asia/Taipei

## 主題
Context Re-entry → History/Memory/RAG → Compaction/Truncation → Role/Order → Tokenization → Next Model Invocation Witness

## 與歷史研究比較
上一輪已建立 `ToolResultCorrelationWitness` 與 `ContextAppendCommitWitness`，回答 tool effect 是否只執行一次、result 是否回到正確 run/branch。本輪不重複 tool execution，而往下一個 causal boundary：已正確 commit 的 result，如何與 system/developer/user/history/memory/RAG 組成「模型實際看到的下一次 context」。

核心新問題：`ContextAppendCorrect --does_not_prove→ NextModelContextCorrect`；`AllFactsPresent --does_not_prove→ ModelUsesFactsEqually`。

## 本小時新發現
- OpenAI Agents SDK current Session 在下一 run 前取回歷史並 prepend；local RunContext 與 LLM-visible context 是不同 plane，local context 不會自動送入模型。
- OpenAI Responses compaction session 會對 stored history 建立 compaction candidate，current Python source 排除 user messages與既有 compaction items；automatic compaction有 mutation generation/lock，若 run append 後 history又被其他 mutation改變，會跳過 stale compaction。
- Anthropic 2026 context-engineering guidance把 context視為有限 attention budget，長任務主要靠 compaction、structured memory、sub-agent architecture；其 engineering guidance明確警告 aggressive compaction可能丟失之後才顯得重要的細節。
- Long-context能力不是「放得下就等於能用」；Lost in the Middle顯示 relevant information位置改變會顯著改變 retrieval/QA performance，常見 U-shaped positional sensitivity。
- RAG/memory不只是 recall layer，也是 trust boundary。2025 MemoryGraft與2026 PIDP-Attack分別展示 persistent experience-memory poisoning與 prompt-injection + database-poisoning的複合攻擊面。

## 本小時最重要 5 個發現

### 1. Stored History Identity 與 Model Input Identity 必須分離
**已確認/工程實作：** OpenAI Agents SDK session會保存歷史，下一次 run再讀回並 prepend。LLM-visible context只來自真正送給模型的 conversation/instructions/retrieval等內容；local app context不是模型可見 context。

底層應拆成：
`PersistedHistory → SessionReadSnapshot → ContextSources → AssemblyPolicy → OrderedModelItems → Tokenization → ModelInvocation`

提出：
`SessionHistoryGeneration = H(sessionId, orderedItemDigests, storeGeneration)`
`ContextAssemblyGeneration = H(run, turn, sourceSnapshotSet, assemblyPolicy, orderedItems)`

因此：
`SessionHistoryCorrect --does_not_prove→ ModelInputCorrect`

### 2. Compaction 是 semantic transformation，不是 lossless storage optimization
**已確認/工程實作：** OpenAI Agents SDK `OpenAIResponsesCompactionSession`會呼叫 Responses compaction並以 compacted items取代可見 history；current source有 mutation lock/generation以避免 stale replacement覆蓋較新的 history。

**官方工程觀察：** Anthropic指出 compaction的關鍵是保留/丟棄選擇，過度 aggressive可能遺失之後才重要的細節。

所以新增：
`CompactionGeneration = H(sourceHistoryGeneration, compactionModel, compactionPolicy, compactedItemsDigest)`
`CompactionCoverageWitness = sourceItems → {preserved | summarized | omitted}`

關係：
`CompactionSucceeded --does_not_prove→ CausalFactsPreserved`

Hermes高風險 context應保留原始 artifact references，使 summary可回溯，而不是只剩不可逆 summary。

### 3. Context Window 的風險不只有 truncation，還有 position-dependent utilization
**論文結果：** Liu et al., 2023 `Lost in the Middle`在 multi-document QA與key-value retrieval中發現，relevant information放在 context中間時 performance可顯著下降；開頭/結尾通常較佳。

因此：
`SameContextItemSet + DifferentOrdering --can_change→ ModelBehavior`

新增：
`ContextPositionBindingWitness = H(itemIdentity, ordinal, tokenStart, tokenEnd, role, sourcePriority)`

Hermes不能只顯示「哪些資料進 context」，還必須顯示「它在哪裡、前後有哪些 competing tokens、距離 generation frontier 多遠」。

### 4. Memory/RAG injection 必須攜帶 provenance 與 trust class
RAG底層仍應拆成：
`Query → QueryRewrite? → Embedding/BM25 → Candidate Retrieval → Similarity/lexical scores → Top-K → Rerank → Selected Chunks → Contextualization → Context Injection`

Anthropic Contextual Retrieval實驗顯示 contextual embeddings + BM25 + reranking可降低 retrieval failure；但 retrieval品質提升不等於安全性提升。

2025 MemoryGraft顯示 agent experience memory可被植入惡意「成功經驗」，之後透過 semantic retrieval持久影響行為；2026 PIDP-Attack則把 prompt injection與RAG database poisoning結合。

提出：
`RetrievedContextItemIdentity = H(sourceArtifact, sourceGeneration, chunkRange, retrieverGeneration, queryGeneration)`
`ContextTrustClass ∈ {SYSTEM_AUTHORITY, USER_INPUT, TOOL_OBSERVATION, VERIFIED_MEMORY, UNTRUSTED_RETRIEVAL, EXTERNAL_CONTENT}`

關係：
`HighRetrievalScore --does_not_prove→ HighAuthority`

### 5. Next Model Invocation 需要完整 Context Lineage Witness
形成：
`NextModelInvocationWitness = H(modelGeneration, tokenizerGeneration, instructionGeneration, sessionSnapshotGeneration, compactionGeneration?, memoryRetrievalWitnesses, RAGRetrievalWitnesses, orderedContextItemDigests, positionBindings, truncationDecision, tokenizedInputDigest, run/turn/branch generation)`

這個 witness的目的不是聲稱模型 reasoning可被完整證明，而是證明「這次模型究竟被餵了什麼」。

## Architecture Breakdown
### Context assembly architecture
`ContextAppendCommit`
→ `Session/Conversation Snapshot`
→ `System/Developer Instructions`
→ `User Input`
→ `Tool Results`
→ `Structured Memory Retrieval`
→ `RAG Retrieval/Reranking`
→ `Compaction/Summary Artifacts`
→ `Trimming/Truncation Policy`
→ `Role + Ordering Assembly`
→ `Tokenizer`
→ `Position IDs / Context Window`
→ `Model Invocation`

### OpenAI Agents SDK current path
`Session.get_items()` → prior history prepended → new run input → agent instructions/model input. `OpenAIResponsesCompactionSession` wraps a backing Session, chooses compaction candidates, calls compaction, and replaces eligible stored history while protecting against stale concurrent replacement with mutation generation/lock.

值得看的 current source：
- `openai-agents-python/src/agents/memory/openai_responses_compaction_session.py`
- `openai-agents-python/src/agents/memory/session.py`
- runner/model input preparation paths

### Anthropic long-horizon pattern
`Working Context → Compaction + Structured Notes + Artifact References → Fresh Context / Subagent → Retrieval of needed state`

這表示 session/history、external memory、artifact store、model context window應被視為四種不同 storage/visibility plane。

## Bottom-Level Logic
一次 next-turn context不應被建模為單一字串，而應建模為 ordered typed items：

`ContextItem = {identity, role, authority, source, sourceGeneration, contentDigest, trustClass, ordinal, tokenRange, transformationLineage}`

Context transformation DAG：
`RawMessage/ToolResult/MemoryArtifact`
→ `Selection`
→ `Retrieval`
→ `Reranking`
→ `Summarization/Compaction`
→ `Trimming`
→ `Role Assignment`
→ `Ordering`
→ `Chat Template / API serialization`
→ `Tokenizer`
→ `Token Sequence`

關鍵 invariants：
1. `role/authority`不可由 retrieved text內容自行提升。
2. summary必須能追溯 source generation。
3. truncation/compaction必須產生 explicit omission record。
4. retrieved memory必須攜帶 provenance/trust，不以 similarity score替代 authority。
5. model invocation必須綁定 exact ordered tokenized input，而非只綁 session ID。

## Visual Simulation Idea
### Context Assembly & Causal Lineage Microscope
互動面板：
`System | Developer | User | Tool | Memory | RAG | Compaction | Truncation | Ordered Items | Token Positions | Model Input`

每個 item顯示：source、role、trust class、generation、digest、token range、是否 summarized、是否 omitted、retrieval score、rerank score。

故障注入：
- `TOOL_RESULT_APPENDED_TO_CORRECT_SESSION_BUT_TRUNCATED`
- `MEMORY_FROM_OLD_PROJECT_GENERATION`
- `RAG_POISONED_CHUNK_HIGH_SIMILARITY`
- `SUMMARY_DROPS_NEGATION`
- `SYSTEM_FACT_PRESERVED_BUT_MOVED_BEHIND_LARGE_TOOL_DUMP`
- `STALE_COMPACTION_OVERWRITE_ATTEMPT`
- `CROSS_BRANCH_MEMORY_RETRIEVAL`
- `ROLE_DOWNGRADE_SYSTEM_TO_USER`
- `SAME_ITEMS_DIFFERENT_ORDER`
- `TOKEN_BUDGET_TRIMS_ONLY_RECEIPT_EVIDENCE`

## Code / GitHub
### OpenAI Agents SDK
Current source確認：
- `select_compaction_candidate_items()`排除 user messages與 compaction items。
- default compaction threshold為 10 candidate items。
- compaction wrapper使用 `_mutation_lock` 與 `_mutation_generation`；若 expected generation不符，stale compaction會被 skip。
- 支援 `previous_response_id / input / auto` compaction mode。

這些機制解決 concurrency/ownership的一部分，但不證明 summary semantic completeness，因此 Hermes應額外建立 CompactionCoverageWitness。

## Papers
### 1. Lost in the Middle: How Language Models Use Long Contexts
- Authors: Nelson F. Liu, Kevin Lin, John Hewitt, Ashwin Paranjape, Michele Bevilacqua, Fabio Petroni, Percy Liang
- Institution: Stanford / affiliated collaborators
- Year: 2023
- URL: https://arxiv.org/abs/2307.03172
- Architecture/Eval: multi-document QA + key-value retrieval over long contexts
- Contribution: 系統性展示 relevant information位置會影響 long-context使用能力
- Limitation: 模型世代較早；不等於所有2026模型有相同幅度，但 positional/context-utilization問題仍是 context engineering重要風險
- 改變了什麼：把 context correctness從「資料有沒有放進去」推進到「資料放在哪裡、模型是否能可靠利用」。

### 2. MemGPT: Towards LLMs as Operating Systems
- Authors: Charles Packer, Sarah Wooders, Kevin Lin, Vivian Fang, Shishir G. Patil, Ion Stoica, Joseph E. Gonzalez
- Institution: UC Berkeley ecosystem
- Year: 2023
- URL: https://arxiv.org/abs/2310.08560
- Code/Data: paper公開實作/資料
- Architecture: OS-inspired hierarchical/virtual context management
- Contribution: 將有限 context window與外部 memory tier間的資料移動建模為 virtual context management
- Limitation: memory movement policy本身會成為新的 correctness/security boundary
- 改變了什麼：證明「模型記憶」更接近 runtime-managed memory hierarchy，而非單一無限 prompt。

### 3. MemoryGraft: Persistent Compromise of LLM Agents via Poisoned Experience Retrieval
- Authors: Saksham Sahai Srivastava, Haoyu He
- Year: 2025
- URL: https://arxiv.org/abs/2512.16962
- Code: https://github.com/Jacobhhy/Agent-Memory-Poisoning
- Architecture: experience-memory/RAG poisoning against agent behavior
- Contribution: 展示惡意 experience可被持久化並在後續相似任務被 retrieval，造成跨 session behavioral drift
- Limitation: specific evaluated agent/model setup；需要跨框架 replication
- 改變了什麼：memory從 reliability feature變成 persistent security boundary。

### 4. PIDP-Attack: Combining Prompt Injection with Database Poisoning Attacks on Retrieval-Augmented Generation Systems
- Authors: Haozhen Wang et al.
- Year: 2026
- URL: https://arxiv.org/abs/2603.25164
- Dataset: Natural Questions, HotpotQA, MS-MARCO
- Architecture: inference-time prompt injection + poisoned retrieval passages
- Contribution: compound attack比單一 poisoning更有效，顯示 retrieval pipeline與 prompt channel不能分開做 trust analysis
- Limitation: attack/defense結果依 retriever/model/config而異
- 改變了什麼：RAG provenance必須追到 query、index generation、retrieved chunks與context injection，而非只驗 vector DB來源。

## Unknown / Open Questions
1. 如何建立 `CompactionCoverageWitness`，在不保留全部 tokens於 active context的前提下，仍可證明 summary沒有遺失 future-critical causal facts？
2. 如何量化 `ContextPositionRisk`，把 role/position/token distance/context competition映射成可觀測的模型利用風險？
3. Memory/RAG item的 authority如何跨 agent/handoff/subagent維持，避免 retrieved instruction文字被誤升級成 system-like authority？

## 下一輪研究
鎖定：
`NextModelInvocationWitness → Chat Template / Tokenizer → Embedding → Position/RoPE → Transformer Layer → Residual Stream → Attention/MLP/MoE → final hidden state`

但不重複先前 GPU compiler provenance；下一輪重點是「Context Item semantic identity如何進入 token/position representation，並在 Transformer residual stream中傳遞」。特別追：chat templates、special/control tokens、role delimiters、embedding lookup、RoPE position binding、residual stream與MoE routing。

核心問題：即使 Hermes已證明 exact ordered context items，如何證明 role boundaries、special tokens、position IDs與chat template沒有把相同文字轉成不同模型語意？

## Knowledge Graph 新增 Node
- `SessionHistoryGeneration`
- `SessionReadSnapshotGeneration`
- `ContextSourceSnapshot`
- `ContextAssemblyPolicyGeneration`
- `ContextAssemblyGeneration`
- `ContextItemIdentity`
- `ContextTrustClass`
- `ContextPositionBindingWitness`
- `CompactionGeneration`
- `CompactionCoverageWitness`
- `TruncationDecisionGeneration`
- `MemoryRetrievalGeneration`
- `RetrievedContextItemIdentity`
- `RAGQueryGeneration`
- `RAGCandidateSetGeneration`
- `RAGRerankGeneration`
- `ContextInjectionGeneration`
- `TokenizedModelInputGeneration`
- `NextModelInvocationWitness`

## Knowledge Graph 新增 Edge
- `ContextAppendCommitWitness → contributes_to → SessionHistoryGeneration`
- `SessionHistoryGeneration → snapshotted_as → SessionReadSnapshotGeneration`
- `MemoryArtifact → retrieved_as → RetrievedContextItemIdentity`
- `RAGQueryGeneration → produces → RAGCandidateSetGeneration`
- `RAGCandidateSetGeneration → reranked_by → RAGRerankGeneration`
- `RetrievedContextItemIdentity → injected_into → ContextAssemblyGeneration`
- `SessionReadSnapshotGeneration → compacted_by → CompactionGeneration`
- `CompactionGeneration → covered_by → CompactionCoverageWitness`
- `ContextAssemblyGeneration → ordered_by → ContextPositionBindingWitness`
- `ContextAssemblyGeneration → reduced_by → TruncationDecisionGeneration`
- `ContextAssemblyGeneration → tokenized_as → TokenizedModelInputGeneration`
- `TokenizedModelInputGeneration → consumed_by → NextModelInvocationWitness`
- `HighRetrievalScore --does_not_prove→ HighAuthority`
- `CompactionSucceeded --does_not_prove→ CausalFactsPreserved`
- `SameContextItemSet + DifferentOrdering --can_change→ ModelBehavior`

## 本輪結束判斷
- **缺哪一層：** exact model-input items → chat template/control tokens → embedding/position semantic binding。
- **哪個節點最淺：** `CompactionCoverageWitness`；目前缺少可攜、可驗證的 semantic coverage定義。
- **哪個概念仍只是名詞：** `ContextPositionRisk` 與 portable `NextModelInvocationWitness`。
- **哪個系統值得讀原始碼：** OpenAI Agents SDK compaction/session + Hugging Face Transformers chat templating/tokenizer + vLLM input preprocessing。
- **哪篇論文需追引用：** `Lost in the Middle`，並追 positional-bias、context rot、long-context retrieval後續工作；安全線追 `MemoryGraft`。
- **哪個概念最適合視覺模擬：** `Context Assembly & Causal Lineage Microscope`。
- **哪個 Agent 架構最值得實作：** `Event-sourced Agent Runtime + Provenance-aware Memory/RAG + Reversible Compaction + Explicit Context Assembly DAG + NextModelInvocationWitness`。

## 目前端到端還原進度
`User → UI → Agent → Observation → Tool/Effect → Result Correlation → Context Commit → Session/Memory/RAG → Compaction/Truncation → Ordered Context → Tokenized Model Input → [下一輪：Chat Template/Embedding/Position] → Transformer → GPU → Output`

多模態對應下一步：
`Image/Voice/Video artifact → modality encoder/reference → multimodal context item → position/modality delimiters → fusion tokens → model invocation`；後續需把 modality artifact generation與context assembly provenance接上。