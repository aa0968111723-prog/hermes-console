# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 12:54（Asia/Taipei）**  
**主題：Evaluation Memory × Evidence Provenance × Temporal Validity × Retrieval Reliability**

## 與歷史研究的差異

前一輪已建立 EvaluationEvidencePlanner、CriticalStepSelector、EvidenceBudgetController，回答「Judge 應看哪些證據」。本輪不再重複 critical-step selection，而追問下一層：**被保存的 evidence 日後還能否被正確找回、辨識版本、追溯來源，並確認仍然有效？**

新的主鏈：

`Critical Evidence → Provenance-Preserving Memory Write → Version/Validity Ledger → Multi-route Retrieval → Causal/Temporal Expansion → Sufficiency Check → Source Rehydration → Judge Context`

---

## 本小時新發現

### 1. AMA-Bench / AMA-Agent：Agent memory 的主要失敗不只是「忘記」，而是 similarity retrieval 丟掉 causality 與 objective information

**已確認論文結果。** AMA-Bench（Zhao et al., 2026，ICML 2026）用真實 agentic trajectories 與可任意延長的 synthetic trajectories 評估長期記憶。論文報告現有 memory systems 的主要限制包含 similarity-based retrieval 的 lossy nature，以及 causal / objective information 缺失；AMA-Agent 用 causality graph + tool-augmented retrieval，平均 57.22%，比 strongest memory-system baseline 高 11.16 個百分點。

Paper: https://arxiv.org/abs/2602.22769  
Code: https://github.com/AMA-Bench/AMA-Bench

### 2. AMA-Agent 原始碼顯示 retrieval 本身就是 agent loop

**已確認工程實作。** `src/method/ama_agent.py` 保存 `state_mem / causal_graph / text_mem / embed_mem / trajectory`；`ama_agent_core/retrieve.py` 的 pipeline 不是一次 vector top-k：

`Question → similarity top-k seeds → explicit step pinning → LLM sufficiency judgment → NEED_GRAPH / NEED_CODE → graph/range/turn expansion or generated search → evidence synthesis`

而且 sufficiency loop 有 iteration/time budget，顯示 retrieval 是有狀態、有成本、有停止條件的 execution loop。

值得繼續讀：
- `src/method/ama_agent.py`
- `src/method/ama_agent_core/construct.py`
- `src/method/ama_agent_core/retrieve.py`
- `src/method/ama_agent_core/tool.py`
- `src/method/ama_agent_core/utils.py`

### 3. Temporal validity 不能靠 embedding similarity 解決

**論文結果，需後續更多獨立 reproduction。** MemStrata（Yadav, 2026）指出，contradicted stale fact 與 current fact 可能在 embedding space 仍非常接近；其 calibrated dataset 中 cosine similarity 區分 contradicted fact 與 duplicate 的 AUROC 僅 0.59。方法改用 `(subject, relation, object)` supersession + bi-temporal ledger，使舊值被 retired 而不是從歷史刪除。

Paper: https://arxiv.org/abs/2606.26511

這代表：

`Semantic Similarity ≠ Temporal Validity`

Evaluation memory 必須同時回答：
- evidence 是什麼？
- 何時觀察？
- 何時寫入？
- 哪個版本有效？
- 被誰 supersede？

### 4. Provenance 必須把 evidence 與 belief 分離

**研究方向交叉支持。** 2026 的 evidence-tracing survey 將 execution provenance 定義為 agent execution 的 typed graph，evidence tracing 則是 evidence-support relations 的投影；Eywa 進一步提出 evidence-before-belief：先保存 immutable source evidence，再導出 canonical facts，避免把 source、extraction、retrieval 與 answer policy 混成一條不可診斷 prompt path。

Survey: https://arxiv.org/abs/2606.04990  
Eywa: https://arxiv.org/abs/2605.30771

因此 Hermes 應區分：

`SourceEvidence → Extraction → DerivedClaim → MemoryFact → RetrievedEvidence → JudgeClaim`

不能只存：

`memory_text = "X is true"`

### 5. Retrieval reliability 必須在 corpus growth 下測，而不是只測固定 snapshot accuracy

**論文結果。** 2026 scale-conditioned memory evaluation 將 task evidence 固定，再逐步加入 irrelevant sessions，觀察 usable-scale boundary；結果顯示可靠度下降可能來自 retrieval loss、memory-call burden 或 agent budget violation，而不是單一「memory accuracy」。AMA-Bench 同樣指出長 horizon agent trajectory 對現有 similarity memory 特別困難。

因此新增：

`EvidenceStored ≠ EvidenceRetrievable`

`EvidenceRetrievable ≠ EvidenceSelected`

`EvidenceSelected ≠ EvidenceStillValid`

`EvidenceValid ≠ EvidenceSufficientForDecision`

---

## 本小時最重要 5 個發現

### 發現 1 — Memory Retrieval 是一個 Tool-Using Agent Loop

底層：

`Query → Seed Retrieval → Sufficiency Test → Retrieval Action Selection → Graph/Keyword/Temporal Expansion → Observation → Context Update → Next Retrieval Decision → Stop`

重要性：evaluation memory 不應只是 vector DB wrapper，而應有 retrieval policy、budget、stop rule 與 failure telemetry。

限制：LLM sufficiency judge 本身會錯，因此後續需 calibration / retrieval certificate。

### 發現 2 — Causal retrieval 與 semantic retrieval 解的是不同問題

Semantic top-k 回答「文字像不像」；causal graph 回答「這個 decision 是由哪些 observation / action / prior state 導致」。對 Agent trajectory，後者直接關係到 process verification。

限制：causal edges 若由 LLM 自動抽取，也可能產生錯誤因果。

### 發現 3 — Stale evidence 是 lifecycle 問題，不是 ranking 問題

`old API endpoint` 與 `new API endpoint` 可能語義高度相似。若 memory 沒有 valid-time / transaction-time / supersession relation，再好的 embedding 也可能把舊值排前面。

### 發現 4 — Compression 必須保留可逆 provenance pointer

合理推論：Critical evidence 若只被摘要成文字，之後 Judge 無法知道摘要遺漏了什麼。因此每個 compressed evidence node 應保留 source pointer、source hash、compression transform、version、coverage relation，必要時 rehydrate 原始 observation。

### 發現 5 — Retrieval failure 應被拆成多個 failure stage

建議 failure taxonomy：

`WRITE_LOSS → INDEX_LOSS → RETRIEVAL_MISS → RANKING_MISS → VALIDITY_MISS → PROVENANCE_BREAK → COMPRESSION_LOSS → CONTEXT_DROP → JUDGE_NONUSE`

這比單一 Recall@K 更適合 Agent runtime debugging。

---

## Architecture Breakdown

```text
Tool / MCP / Environment / Human Observation
↓
Evidence Capture
├ raw payload
├ timestamp
├ source identity
├ tool/version
├ execution id
└ content hash
↓
Provenance Graph Writer
├ DERIVED_FROM
├ CAUSED_BY
├ OBSERVED_AT
├ SUPERSEDES
├ SUPPORTS
└ CONTRADICTS
↓
Temporal Validity Ledger
├ valid_from / valid_to
└ recorded_at / retired_at
↓
Evaluation Memory
├ immutable raw evidence
├ structured facts
├ causal graph
├ temporal graph
├ entity graph
└ compressed summaries + source pointers
↓
Retrieval Planner
├ semantic seed
├ lexical exact
├ temporal filter
├ causal traversal
├ entity traversal
└ direct step/id lookup
↓
Evidence Sufficiency Gate
↓ insufficient
Retrieval Expansion Loop
↓
Source Rehydration
↓
Evidence Coverage Certificate
↓
Judge / Oracle
```

---

## Bottom-Level Logic

### Provenance-preserving write

For evidence `e`:

`id = hash(source_id || execution_id || payload || timestamp)`

Store immutable raw evidence first. Derived memory fact `m` must carry:

`m.provenance = {e1, e2, ...}`

Compression `c = Compress(E)` must not replace E; it creates:

`c --DERIVED_FROM--> E`

### Bi-temporal validity

Each fact should distinguish:

- **valid time**: fact is true in the represented world from `t_valid_start` to `t_valid_end`
- **transaction time**: system learned/stored it at `t_recorded`

When a new fact supersedes an old one:

`old --SUPERSEDED_BY--> new`

The old evidence remains auditable but should not be returned as current truth unless query explicitly asks history.

### Retrieval reliability decomposition

For required evidence set `E*`:

`P(usable evidence)` approximately depends on:

`P(written) × P(indexed|written) × P(retrieved|indexed) × P(valid|retrieved) × P(preserved|compressed) × P(included|selected) × P(used|included)`

This is not an independence claim; it is a diagnostic factorization for locating failure stages.

---

## Visual Simulation Idea

# Evidence Lineage Memory Lab

左側顯示 Agent trajectory；中央顯示 provenance/temporal graph；右側顯示 retrieval pipeline。

互動：
- 將 corpus noise 從 1× 拉到 100×，看 required evidence 是否掉出 top-k。
- 把 API fact 從 v1 更新到 v2，看 semantic retrieval 是否仍抓到 stale v1。
- 切換 `semantic only / semantic+temporal / semantic+causal / full provenance`。
- 點 compressed memory node，可沿 `DERIVED_FROM` rehydrate 原始 tool output。
- 模擬 source deletion / tool version change / summary corruption，觀察 provenance certificate 斷在哪一層。

每次 query 顯示：

`Required Evidence → Retrieved → Valid → Provenance Verified → Context Included → Judge Used`

並標記第一個 failure stage。

---

## Code / GitHub

### AMA-Bench / AMA-Agent
https://github.com/AMA-Bench/AMA-Bench

核心檔案：
- `src/method/ama_agent.py` — memory object + public construction/retrieval interface
- `src/method/ama_agent_core/construct.py` — state memory / causal graph construction
- `src/method/ama_agent_core/retrieve.py` — multi-stage retrieval agent loop
- `src/method/ama_agent_core/tool.py` — retrieval tools
- `src/method/ama_agent_core/utils.py` — similarity / graph / keyword / truncation utilities

### TRACE
https://github.com/Peregrine123/TRACE_official

值得後續比較：TRACE 用 Compressor→latent evidence state→Reader 保存 dispersed long-horizon risk cues；它代表另一種「不可直接 audit 的 latent compression」，正好可和 provenance-preserving symbolic memory 做對照。

---

## Papers

### AMA-Bench: Evaluating Long-Horizon Memory for Agentic Applications
- Authors: Yujie Zhao et al.
- Institution: multi-author research collaboration
- Year: 2026
- Venue: ICML 2026
- URL: https://arxiv.org/abs/2602.22769
- Code: https://github.com/AMA-Bench/AMA-Bench
- Dataset: real agentic trajectories + expert QA; arbitrarily scalable synthetic trajectories + rule-based QA
- Architecture: benchmark + AMA-Agent causality graph / tool-augmented retrieval
- Contribution: moves memory evaluation from dialogue-centric recall to machine-generated agent-environment trajectories
- Limitation: AMA-Agent absolute accuracy remains far from solved; retrieval agent and causal extraction introduce their own model dependence

### Temporal Validity in Retrieval Memory
- Author: Neeraj Yadav
- Year: 2026
- URL: https://arxiv.org/abs/2606.26511
- Architecture: bi-temporal ledger + deterministic supersession
- Contribution: isolates stale-fact error as a structural failure of similarity-only memory
- Limitation: requires structured contradiction/supersession representation; broader independent reproduction needed

### From Agent Traces to Trust: Evidence Tracing and Execution Provenance in LLM Agents
- Authors: Yiqi Wang et al.
- Year: 2026
- URL: https://arxiv.org/abs/2606.04990
- Architecture: survey / unified typed provenance graph framework
- Contribution: connects claim support, retrieval grounding, memory lineage, tool use, audit and recovery
- Limitation: conceptual synthesis rather than a single production implementation

### Eywa: Provenance-Grounded Long-Term Memory for AI Agents
- Author: Resham Joshi
- Year: 2026
- URL: https://arxiv.org/abs/2605.30771
- Architecture: immutable source evidence → canonical facts → deterministic multi-route retrieval
- Contribution: evidence-before-belief and artifact-recorded retrieval path
- Limitation: reported benchmark results should be interpreted with model/config dependence and need broader reproduction

---

## Unknown / Open Questions

1. 如何量化一份 compressed evidence 的「可逆性」與 information loss，並產生 machine-checkable Compression Certificate？
2. Retrieval sufficiency judge 本身若沒有找到被漏掉的 evidence，如何知道自己「不知道自己漏了」？需要 independent coverage oracle 或 synthetic hidden-evidence probes。
3. 多模態 raw evidence（image/audio/video）如何做 stable content identity、region/time-span provenance 與版本 supersession，而不只存整檔 hash？

---

## 下一輪研究

**Retrieval Sufficiency × Hidden-Evidence Probes × Compression Certificates × Multimodal Provenance**

優先研究：
- retrieval completeness / answerability estimation
- hidden evidence injection benchmark
- provenance-aware RAG
- source span / image region / audio interval lineage
- lossy compression detection
- retrieval confidence calibration
- source rehydration policy

---

## Knowledge Graph 新增 Node / Edge

### Nodes

`EvaluationMemory`, `ImmutableSourceEvidence`, `DerivedMemoryFact`, `EvidenceProvenanceGraph`, `TemporalValidityLedger`, `BiTemporalFact`, `SupersessionEdge`, `EvidenceVersion`, `SourcePointer`, `SourceHash`, `CompressionTransform`, `CompressionCertificate`, `RetrievalPlanner`, `RetrievalSufficiencyGate`, `RetrievalExpansionLoop`, `SourceRehydration`, `RetrievalFailureStage`, `EvidenceUsability`, `CausalRetrieval`, `TemporalRetrieval`, `EvidenceCoverageCertificate`, `StaleEvidenceEvent`.

### Edges

`SourceEvidence → DERIVED_INTO → MemoryFact`  
`CompressedEvidence → DERIVED_FROM → RawEvidence`  
`NewFact → SUPERSEDES → OldFact`  
`SemanticSimilarity ≠ TemporalValidity`  
`EvidenceStored ≠ EvidenceRetrievable`  
`EvidenceRetrievable ≠ EvidenceSelected`  
`EvidenceSelected ≠ EvidenceValid`  
`EvidenceValid ≠ EvidenceSufficient`  
`CausalGraph → Enables → ProcessEvidenceRetrieval`  
`ProvenancePointer → Enables → SourceRehydration`  
`CorpusGrowth → CanIncrease → RetrievalMissRisk`

---

## 本輪結束判定

- **缺哪一層：** Retrieval Sufficiency / Provenance-Preserving Compression / Multimodal Lineage。
- **哪個節點最淺：** `CompressionCertificate`、`EvidenceCoverageCertificate`、`MultimodalProvenance`。
- **哪個概念仍只是名詞：** production-grade `Evidence Completeness Certificate`。
- **哪個系統值得讀原始碼：** AMA-Agent，下一輪繼續讀 `construct.py / tool.py / utils.py`；另比較 TRACE 的 latent Compressor。
- **哪篇論文需追引用：** AMA-Bench；其次 Evidence Tracing/Execution Provenance survey。
- **哪個概念最適合視覺模擬：** Evidence Lineage Memory Lab。
- **哪個 Agent 架構最值得實作：** `Provenance-Aware Retrieval Agent = Multi-route Retrieval + Temporal Validity + Causal Expansion + Sufficiency Gate + Source Rehydration`。

## 對「AI 到底怎麼運作」新增的答案

AI 的長期記憶不是把歷史丟進 vector database 就完成。真實 Agent 必須把 Tool、MCP、Environment、Human 與 Multimodal observations 保存成有來源、有版本、有時間有效性的 evidence；需要時先以 semantic/lexical 找 seed，再沿 causal、temporal、entity 與 explicit-step relations 擴展，檢查證據是否足夠，必要時回到原始 source rehydrate。否則「AI 記得」可能只是「某段相似但過期、被摘要失真、來源已斷裂的文字剛好被找回」。