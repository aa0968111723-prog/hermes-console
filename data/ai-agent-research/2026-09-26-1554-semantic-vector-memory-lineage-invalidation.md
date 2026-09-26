# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-26 15:54 Asia/Taipei

## 主題
Semantic / Vector Memory Consistency → Bi-temporal Validity → Source-Version Lineage → Embedding Invalidation → Derived-Memory Dependency Graph → Selective Recomputation

## 與歷史研究比較
上一輪 `2026-09-26-1452-multi-agent-memory-mvcc-occ.md` 已建立 `ReadSnapshot → ReadSet → Reasoning → WriteSet → OCC Validation`，解決「Agent 推理期間 source world state 改變」的 stale reasoning。9/24 的 context-lineage 研究已建立 `RetrievedContextItemIdentity` 與 `NextModelInvocationWitness`；9/22 已建立 memory origin/authority/consolidation lineage。

本輪不重複 MVCC/OCC 或一般 RAG 流程，而補上仍缺的 derived-data correctness：**source record 更新後，舊 chunk、舊 embedding、舊 summary、舊 KG edge、舊 retrieval cache 何時失效，以及如何只重算真正受影響的 derived artifacts。**

## 本小時新發現
1. 2026 MemStrata 顯示 cosine similarity 本身無法可靠區分「被新事實取代的舊事實」與「語義重述」；論文 calibrated dataset 中 contradiction-vs-duplicate AUROC 只有 0.59。它以 deterministic subject-relation-object supersession + bi-temporal ledger 直接退休 stale fact，而不是靠 similarity threshold 或 LLM reranker。
2. 2026 SmartVector 將 temporal validity、confidence、relational dependency 明確加入 embedding lifecycle，並提出 dependency propagation / selective re-embedding；其 synthetic benchmark 報告 single-word edit re-embedding cost 可降低 77%。這是論文結果，不代表 Hermes 可直接得到同等數字。
3. 2026 LineageRAG 顯示 evidence discovery 與 source grounding應顯式連接；每個 query-derived evidence demand建立 lineage，最後綁到 verbatim source span。這可補 Hermes 的「retrieved node → exact source generation/span」。
4. Vector index 是 source data 的 derived materialized view，而不是 authority source。Source update 成功、ANN index仍可查詢，不代表 index 已與 source generation一致。
5. Hermes current `lib/server/research-notes.ts` 目前將 research Markdown 讀成簡單 `ResearchNode`，`updatedAt` 只由檔名日期推得，confidence 固定 `local_notes`，沒有 source generation、supersession、derived dependency、embedding/index generation 或 invalidation state。這是本輪最直接可落地的 runtime gap。

## 本小時最重要 5 個發現

### 1. Vector similarity 不是 temporal validity
普通 RAG：
`Query → Embed → ANN → Top-K → Rerank → Context`

動態知識需要：
`Query → Candidate Retrieval → SourceIdentity → Valid-Time Filter → Transaction-Time Filter → Supersession Filter → Authority/Policy Filter → Rerank → Context`

因此新增 invariant：
`HighSimilarity --does_not_prove→ CurrentlyValid`

MemStrata 的核心價值是把 supersession 從 probabilistic semantic judgement 移到 deterministic temporal ledger。

### 2. Embedding 必須綁定 source generation
定義：
`EmbeddingIdentity = H(SourceArtifactID, SourceGeneration, ChunkRange, ChunkerGeneration, EmbeddingModelGeneration, VectorDigest)`

source 從 G41 → G42 時：
`Embedding(G41)` 不應因仍存在 ANN index 就被視為 current。

需要：
`SourceGenerationChange → InvalidationEvent → DependencyTraversal → {Retire | Recompute | Preserve}`

### 3. Derived memory 需要 Dependency DAG，而不只是 provenance string
Derived artifacts 包含：
`Chunk → Embedding → ANN posting → RetrievedEvidence → Summary → ConsolidatedMemory → KG edge → CachedContext`

若 source chunk改變，應沿 reverse dependency edges 找出受影響 artifacts，而不是 full rebuild，也不能只更新最底層 vector。

新增：
`DerivedMemoryDependencyGraph`
`InvalidationFrontier`
`SelectiveRecomputationPlan`

### 4. Bi-temporal memory能區分「世界何時成立」與「系統何時知道」
Memory record至少應有：
`valid_from / valid_to`（world validity）
`observed_at / superseded_at`（system knowledge timeline）

因此 Agent 可回答：
- 「現在的規則是什麼？」
- 「昨天 10:00 當時系統知道的規則是什麼？」
- 「這個決策當時依據哪一版資料？」

這對 replay/audit 特別重要。

### 5. Retrieval result需要 Consistency Witness
提出：
`RetrievalConsistencyWitness = H(QueryGeneration, SnapshotGeneration, CandidateIDs, SourceGenerations, IndexGeneration, TemporalFilterGeneration, RerankGeneration)`

如果 retrieval 使用的 index generation落後 source watermark：
`IndexWatermark < RequiredSourceWatermark`
則 runtime應標：
`STALE_INDEX_RISK`
而不是把 Top-K 當作完整 current evidence。

## Architecture Breakdown
`Source Artifact / Tool Observation`
→ Source Version Store
→ Chunker
→ Chunk Generation
→ Embedding Model
→ Embedding Generation
→ ANN / lexical / KG indices
→ Index Watermark
→ Query
→ Candidate Retrieval
→ Temporal + Supersession Filter
→ Authority Filter
→ Rerank
→ Evidence Lineage
→ Context Injection
→ Model Reasoning
→ Derived Summary / Memory
→ Dependency registration

更新路徑：
`Source G_n → Source G_n+1`
→ compute changed ranges/facts
→ emit InvalidationEvent
→ reverse dependency traversal
→ retire stale facts/vectors
→ selectively recompute affected chunks/embeddings/summaries/KG edges
→ advance index watermark
→ publish new retrieval snapshot.

## Bottom-Level Logic
### Memory record
`{record_id, subject, relation, object, source_id, source_generation, valid_from, valid_to, observed_at, superseded_at, authority, content_hash}`

### Derived artifact
`{derived_id, kind, transform_generation, input_ids[], input_generations[], output_hash, valid_state, recompute_policy}`

### Safe retrieval
`RetrievalSafe(q) = SnapshotBound(q) ∧ TemporalValidityChecked ∧ SupersessionChecked ∧ AuthorityChecked ∧ IndexWatermarkSufficient`

### Invalidation
`ChangedSourceSet → ReverseDependencyClosure → InvalidationFrontier → MinimalRecomputeSet`

關鍵 invariants：
- `VectorPresent ≠ SourceCurrent`
- `IndexHealthy ≠ IndexFresh`
- `SourceDeleted ≠ DerivedArtifactErased`
- `SemanticSimilarity ≠ TemporalValidity`
- `ProvenanceKnown ≠ DependencyComplete`

## Visual Simulation Idea
### Memory Lineage & Stale-RAG Invalidation Simulator
四層：
1. Source timeline
2. Chunk / embedding / index generations
3. Derived summary / KG / consolidated memory dependency DAG
4. Query → Top-K → context

故障注入：
- `SOURCE_UPDATED_VECTOR_NOT_REEMBEDDED`
- `OLD_FACT_HIGHER_SIMILARITY_THAN_NEW_FACT`
- `SUMMARY_DEPENDS_ON_RETIRED_CHUNK`
- `KG_EDGE_SURVIVES_SOURCE_DELETE`
- `INDEX_WATERMARK_LAGS_SOURCE`
- `CACHED_CONTEXT_FROM_OLD_SNAPSHOT`
- `SOFT_DELETE_VECTOR_PHYSICALLY_REMAINS`

UI 狀態：
`CURRENT` / `SUPERSEDED` / `STALE-DERIVED` / `RECOMPUTE-QUEUED` / `INDEX-LAG` / `SAFE-TO-INJECT`。

## Code / GitHub
### Hermes current gap
`lib/server/research-notes.ts` current implementation:
- filesystem scan `data/ai-agent-research/*.md`
- `ResearchNode = {id,title,source,finding,confidence,updatedAt,relation}`
- `updatedAt` 由檔名日期推得
- 60 秒 process-local cache
- relevance ranking後直接回傳 nodes

尚未表達：
`sourceGeneration`, `validFrom/validTo`, `supersedes`, `derivedFrom`, `embeddingGeneration`, `indexGeneration`, `invalidationState`, `dependencyEdges`。

建議下一實作切片：
`ResearchNodeV2`
+ append-only generation manifest
+ supersession edges
+ derived dependency table
+ index watermark
+ stale-node exclusion at retrieval time。

## Papers
### Temporal Validity in Retrieval Memory: Eliminating Stale-Fact Errors for AI Agents over Evolving Knowledge
- Author: Neeraj Yadav
- Year: 2026
- URL: https://arxiv.org/abs/2606.26511
- Architecture: MemStrata; deterministic S-R-O supersession + bi-temporal ledger
- Dataset: six local benchmarks / evolving-knowledge evaluation harness
- Contribution: isolates stale-fact failure; paper reports RAG stale-answer rate 15–40%, MemStrata approximately 0% in evaluated setting
- Limitation: single-paper result; deterministic S-R-O extraction/supersession may be harder for ambiguous open-domain claims
- 改變：把 RAG freshness從 ranking問題改成 explicit validity-state problem。

### Self-Aware Vector Embeddings for Retrieval-Augmented Generation
- Author: Naizhong Xu
- Year: 2026
- URL: https://arxiv.org/abs/2604.20598
- Architecture: SmartVector; temporal + confidence + relational metadata and lifecycle
- Dataset: reproducible synthetic versioned-policy benchmark
- Contribution: explicit dependency/temporal-aware vector lifecycle與 selective re-embedding
- Limitation: synthetic benchmark、單作者預印本；需外部 replication
- 改變：embedding不再被視為沒有 lineage 的 immutable float array。

### LineageRAG: Harnessing GraphRAG by Constructing Evidence Lineages with Source Grounding
- Authors: Linyao Zheng, Xuhang Shi, Zhifang Mao, Sai Zhou, Shuaixian An, Xiuquan Hou, Jinze Li
- Year: 2026
- URL: https://arxiv.org/abs/2608.16004
- Datasets: HotpotQA, 2WikiMultiHopQA, MuSiQue
- Architecture: query evidence demands → demand-conditioned graph retrieval → evidence lineage → verbatim source grounding
- Contribution: explicit evidence lineage；paper reports average R@5/EM/F1 improvements of 3.51/5.96/5.22 points over compared GraphRAG baselines
- Limitation: source-grounding correctness不等同 temporal freshness；仍需 generation/validity layer
- 改變：把 evidence path與 source span的關係變成 first-class artifact。

## Unknown / Open Questions
1. 如何在 arbitrary prose / multimodal memory中可靠產生 supersession keys，而不把「補充」誤判成「取代」？
2. Dependency DAG 如何跨 embedding、summary、KG edge、multimodal derived artifact維持低成本 reverse index？
3. Source/index watermark lag 多大時應 block Agent action，而不是只降低 retrieval confidence？

## 下一輪研究
鎖定：
`Derived-Memory Dependency Graph → Incremental View Maintenance → Change Data Capture → Multimodal artifact lineage → image/audio/video embedding invalidation → selective re-encoding → cross-modal consistency witness`

## Knowledge Graph 新增 Node
- `BiTemporalMemoryRecord`
- `SourceGeneration`
- `SupersessionEdge`
- `EmbeddingGeneration`
- `IndexGeneration`
- `IndexWatermark`
- `DerivedMemoryDependencyGraph`
- `DerivedArtifactGeneration`
- `InvalidationEvent`
- `InvalidationFrontier`
- `SelectiveRecomputationPlan`
- `RetrievalConsistencyWitness`
- `TemporalValidityFilter`
- `EvidenceLineage`
- `StaleDerivedArtifact`

## Knowledge Graph 新增 Edge
- `SourceGeneration → derives → EmbeddingGeneration`
- `SourceGeneration → supersedes → SourceGeneration`
- `EmbeddingGeneration → published_into → IndexGeneration`
- `IndexGeneration → advances → IndexWatermark`
- `SourceGenerationChange → emits → InvalidationEvent`
- `InvalidationEvent → traverses → DerivedMemoryDependencyGraph`
- `DerivedMemoryDependencyGraph → computes → InvalidationFrontier`
- `InvalidationFrontier → produces → SelectiveRecomputationPlan`
- `RetrievalConsistencyWitness → binds → SourceGeneration + IndexGeneration`
- `SemanticSimilarity --does_not_prove→ TemporalValidity`
- `IndexHealthy --does_not_prove→ IndexFresh`

## 本輪結束判斷
- **缺哪一層：** source change 到所有 derived multimodal artifacts 的 incremental invalidation/recompute protocol。
- **哪個節點最淺：** `InvalidationFrontier`；目前缺跨 heterogeneous derived stores 的統一演算法與成本模型。
- **哪個概念仍只是名詞：** portable `RetrievalConsistencyWitness` 與 machine-readable supersession contract。
- **哪個系統值得讀原始碼：** Hermes `lib/server/research-notes.ts` + production vector/KG incremental-index pipelines；下一輪應追 CDC/materialized-view engines與 multimodal index更新。
- **哪篇論文需追引用：** MemStrata（temporal validity）與 LineageRAG（evidence lineage），並追 incremental view maintenance / temporal DB 文獻。
- **哪個概念最適合視覺模擬：** Memory Lineage & Stale-RAG Invalidation Simulator。
- **哪個 Agent 架構最值得實作：** `Event-sourced Runtime + MVCC Source Memory + BiTemporal Validity + DerivedMemoryDependencyGraph + Versioned Retrieval Index + RetrievalConsistencyWitness + OCC Action Gate`。

## 端到端還原進度
`User → UI → Agent → Context → Memory/RAG Query → Versioned Source Snapshot → Retrieval Index → Temporal/Supersession Filter → Evidence Lineage → Reasoning → Plan → OCC Validation → Tools/MCP → Remote Effect → Output`

本輪補上的核心是：**Agent 能取回「相關資料」還不夠；必須能證明取回的是由哪個 source generation 推導、目前仍有效，而且所有會影響 action 的 derived memory 都沒有落後於 source truth。**
