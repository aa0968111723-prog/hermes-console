# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 15:54（Asia/Taipei）**  
**主題：Cross-Modal Evidence Units × Video Temporal Provenance × Granularity Decoupling × Decision-Risk Certificates**

## 與歷史研究比較

上一輪已建立 `DecisionRequirementGraph → CandidateRetrieval → ConformalEvidenceFilter → EvidenceRelationGraph → CoverageCertificate → SequentialStopController`，並明確區分 `Retrieval Coverage ≠ Claim Coverage ≠ Dependency Coverage ≠ Decision Completeness`。本輪不再重複 stopping calibration，而補上下一個缺口：**文字 passage、圖片 region、影片 temporal interval、字幕 span、tool response field 等異質 evidence，如何變成同一套可追蹤、可重取、可做 decision-risk 計算的 evidence unit？**

核心結論：`Retrieval Unit ≠ Evidence Unit ≠ Reasoning Unit`。高效系統可以用粗粒度索引定位，但必須能 rehydrate 回細粒度原始證據；而 decision-risk certificate 不能把 retrieval coverage 直接當成 action correctness guarantee。

---

## 本小時新發現

### 新論文 / 架構

1. **VideoStir: Understanding Long Videos via Spatio-Temporally Structured and Intent-Aware RAG** — Honghao Fu, Miao Xu, Yiwei Wang, Dailing Zhang, Jun Liu, Yujun Cai, ACL 2026. 將長影片表示為 clip-level spatio-temporal graph，再以 multi-hop retrieval 聚合遠距但相關的事件，並以 MLLM-backed intent-relevance scorer 補足純 semantic similarity 無法抓到的 reasoning-intent cues。Dataset: IR-600K. Code: https://github.com/RomGai/VideoStir. Paper: https://aclanthology.org/2026.acl-long.1656/
2. **From Scenes to Elements: Multi-Granularity Evidence Retrieval for Verifiable Multimodal RAG (GranuRAG)** — Guanhua Chen et al., Findings ACL 2026. 將 visual element 升為 first-class evidence unit，經 element detection/classification → multi-granularity cross-modal alignment → attribution-constrained generation，使 claim 可追到具體視覺元素，而非整張 image。Paper: https://aclanthology.org/2026.findings-acl.509/
3. **MAGE-RAG: Multigranular Adaptive Graph Evidence for Agentic Multimodal RAG in Long-Document QA** — Yilong Zuo et al., 2026. Offline 建 page + element evidence graph，保留 containment、reading order、layout adjacency、section hierarchy、semantic-neighbor relations；online controller 在 budget 下 activate/open/search/prune evidence。Paper: https://arxiv.org/abs/2606.15906 Code: https://github.com/laonuo2004/MAGE-RAG
4. **Coarse Indexing, Fine Evidence: Decoupling Temporal Granularity in Long-Video RAG** — 2026. Density-Aware Graph Construction 將 query-independent coarse retrieval index 與原始 fine-grained temporal evidence 分離；粗節點命中後再展開回原 chunk。報告只保留約 40–50% graph nodes、1.3–1.7× wall-clock acceleration，同時約保留 99% QA performance。Paper: https://arxiv.org/abs/2608.23011
5. **Bayesian Conformal Prediction as a Decision Risk Problem** — Fanyi Wu, Veronika Lohmanova, Samuel Kaski, Michele Caprio, 2026. 將 conformal prediction 從固定 quantile threshold 推向 decision-risk optimization；重要啟示是 coverage set 本身與 downstream decision loss 必須分開建模。Paper: https://arxiv.org/abs/2602.03331

---

## 本小時最重要 5 個發現

### 1. Retrieval Unit、Evidence Unit、Reasoning Unit 必須分離

**已確認（論文）**：長影片 RAG 若固定使用同一 temporal granularity 做 indexing 與 downstream reasoning，會浪費索引成本或損失細節。2026 的 coarse-index/fine-evidence 工作明確主張 coarse representation 可用於定位 temporal region，但 fine-grained evidence 仍需保留供 reasoning。

底層：

```text
Raw Video
↓ segmentation
Fine Temporal Units F={f1...fn}
↓ density-aware merge / graph construction
Coarse Index Units C={c1...cm}, m<n
↓ query retrieval
Selected coarse node cj
↓ provenance mapping
Expand(cj) → {fk...fr}
↓ fine evidence rerank / reasoning
Evidence subset E
```

所以：

```text
Index Granularity
≠ Evidence Granularity
≠ Reasoning Granularity
```

**為什麼重要**：Hermes 可以讓 vector/graph index 保持便宜，但不能因此刪掉 raw evidence pointer。

**限制**：99% performance retention 是特定 benchmark / pipeline 的 empirical result，不是跨模態保證。

來源：https://arxiv.org/abs/2608.23011 ; https://aclanthology.org/2026.acl-long.1656/

### 2. Video evidence 的核心不是 frame，而是具有 temporal lineage 的 interval / event

**已確認（論文 + 原始碼）**：VideoStir 不把長影片視為獨立 frame bag，而先建立 spatio-temporal graph，再做 multi-hop retrieval。其公開 `pipeline.py` 先抽 visual embeddings、cluster/segment、export segments、compute video features、build spatiotemporal graph，再 retrieve top-k segments 與 rerank frames。

底層：

```text
Video
↓ visual embedding sampling
Frames
↓ change-point / clustering segmentation
Temporal Segments
↓ segment features
SpatioTemporalGraph
├ temporal edges
└ spatial/semantic relations
↓ query intent
Graph retrieval
↓ temporal-neighbor expansion
Candidate segments
↓ frame reranking
Fine evidence frames
```

原始碼另外把 subtitle entries 依 start/end time attach 到 segment，subtitle hit 後還能沿 temporal edges 擴展鄰近 clips。這證明 cross-modal provenance 至少要保存：`video → segment → frame` 與 `subtitle span → segment` 的時間對齊關係。

**工程推論**：Hermes 的 `VideoEvidenceUnit` 不應只有 frame JPEG，而應至少是 `(asset_id, start_sec, end_sec, frame_ids, subtitle_spans, parent_segment, source_hash)`。

來源：https://github.com/RomGai/VideoStir/blob/main/inference/pipeline.py ; https://aclanthology.org/2026.acl-long.1656/

### 3. Visual evidence 必須能落到 element/region，而非只引用整張 image

**已確認（論文）**：GranuRAG 把 visual elements 當 first-class retrieval units，解決不同 viewpoints 僅包含部分 entities 的 partial-observation 問題，並透過 attribution-constrained generation提升可驗證性。

底層：

```text
Image / Scene
↓ element detector
Regions / Elements
↓ classification
Typed Visual Elements
↓ cross-modal alignment
Query ↔ Element scores
↓ retrieval
Element Evidence Set
↓ attribution-constrained generation
Claim → exact visual element
```

Hermes 應建立：

```text
VisualEvidenceRegion
├ asset_id
├ page/frame
├ bbox/mask
├ detector_version
├ extracted_entity
├ source_hash
├ transform_history
└ parent_asset
```

並允許：

```text
Claim
→ SUPPORTED_BY
VisualEvidenceRegion
→ PART_OF
Frame
→ PART_OF
Video
```

來源：https://aclanthology.org/2026.findings-acl.509/

### 4. Multimodal evidence graph 應同時保存 containment 與 sequence，而非全部轉成文字 chunk

**已確認（論文）**：MAGE-RAG 的 offline graph 同時保存 page node 與 element node，以及 containment、reading order、layout adjacency、section hierarchy、semantic-neighbor relations；query-time controller 再在 budget 下 activate/open/search/prune。

這揭示一個通用 CrossModalEvidenceGraph：

```text
Document
├ PAGE_CONTAINS → ChartRegion
├ PAGE_CONTAINS → TextBlock
├ READING_ORDER → TextBlock
└ SECTION_PARENT → Page

Video
├ TEMPORAL_NEXT → Segment
├ CONTAINS → Frame
├ ALIGNED_WITH → SubtitleSpan
└ SAME_ENTITY → Region

ToolExecution
├ PRODUCED → ResponseField
└ OBSERVED_AT → Timestamp
```

**為什麼重要**：若全部 flatten 成 text embeddings，layout、temporal order、source identity 與 field-level authority 會丟失。

**限制**：Graph relation 增多也會增加 indexing、更新與 retrieval planner complexity。

來源：https://arxiv.org/abs/2606.15906 ; https://aclanthology.org/2026.findings-acl.509/

### 5. Decision-risk certificate 必須以「錯誤行動損失」為目標，而非把 conformal coverage 當答案信心

**已確認（方法方向）**：Bayesian Conformal Prediction 把 conformal prediction formulation 直接放進 decision-risk optimization，提醒 coverage set 的效率與 downstream loss 是不同層級。

對 Hermes 的合理建模：

```text
Evidence Certificate
├ retrieval coverage
├ claim coverage
├ temporal/region provenance
├ unresolved conflict
└ hidden-gap risk
↓
Decision Model
↓
Actions A
↓
Loss L(a,y)
↓
DecisionRisk(a)
```

對高風險 tool/MCP action，應比較：

```text
ExpectedLoss(EXECUTE | current evidence)
ExpectedLoss(VERIFY_MORE | current evidence)
ExpectedLoss(ABSTAIN | current evidence)
```

而不是：

```text
retrieval coverage = 95%
→ execute with 95% confidence
```

**尚未驗證假說**：目前沒有 universal cross-modal conformal method 能直接給 Hermes `P(action safe)≥1-α`。因此 production UI 必須把 `Coverage Guarantee` 與 `Decision Risk Estimate` 分開。

來源：https://arxiv.org/abs/2602.03331 ; 前輪 conformal-context-engineering coverage scope。

---

## Architecture Breakdown

### Cross-Modal Evidence Runtime

```text
User / Agent Goal
↓
DecisionRequirementGraph
├ textual claims
├ visual entities
├ temporal events
├ tool-state requirements
└ risk constraints
↓
CrossModalIndexRouter
├ text index
├ page/element graph
├ video coarse graph
├ audio/subtitle timeline
└ tool/MCP execution ledger
↓
Coarse Candidate Retrieval
↓
Provenance Expansion / Rehydration
├ page → region
├ coarse video node → original clips
├ clip → frames
├ frame → bbox/mask
├ subtitle → exact timestamp span
└ tool summary → raw response field
↓
Fine Evidence Selection
↓
CrossModalEvidenceGraph
↓
Claim / Dependency Coverage
↓
DecisionRiskEstimator
↓
EXECUTE / VERIFY_MORE / ABSTAIN
```

### 與上一輪差異

上一輪回答：

```text
何時停止 retrieval？
coverage certificate 到底保證什麼？
```

本輪回答：

```text
「evidence」在不同 modality 中究竟是什麼單位？
如何從便宜的 coarse index 回到可驗證的 fine source？
coverage 如何進入真正的 decision-risk 層？
```

---

## Bottom-Level Logic

### Evidence Unit Schema

```text
CrossModalEvidenceUnit
├ evidence_id
├ modality
├ source_asset_id
├ source_hash
├ source_version
├ observed_at
├ valid_from / valid_to
├ granularity
├ locator
│  ├ text: char/token span
│  ├ image: bbox/mask
│  ├ video: start/end + frame ids
│  ├ audio: start/end + channel
│  └ tool: execution_id + JSON path
├ parent_unit
├ derived_from
├ alignment_edges
├ transform_history
└ rehydration_pointer
```

### Granularity ladder

```text
VIDEO
→ coarse scene
→ clip
→ temporal interval
→ frame
→ region/object

DOCUMENT
→ document
→ page
→ block
→ sentence
→ token/span

TOOL
→ execution
→ response
→ field
→ scalar/value
```

任何 compressed / indexed representation 必須保存 reversible pointer，否則只能稱 `retrieval representation`，不能稱完整 provenance evidence。

### Decision-risk certificate

```text
DecisionRiskCertificate
├ action
├ loss_model
├ evidence_scope
├ coverage_scope
├ unresolved_requirements
├ provenance_integrity
├ modality_coverage
├ temporal_coverage
├ hidden_gap_risk
├ estimated_execute_loss
├ estimated_verify_loss
├ abstention_loss
└ recommended_action
```

---

## Visual Simulation Idea

# Cross-Modal Evidence Microscope × Decision Risk Console

左側顯示原始來源：PDF、image、video timeline、audio waveform、tool JSON。中間顯示同一個 claim 的 lineage：

```text
Claim C7
├ text span p.14
├ image region [x1,y1,x2,y2]
├ video 02:14.2–02:18.9
│  └ frames 4026–4167
├ subtitle 02:15.0–02:17.4
└ tool response $.status.current
```

使用者可拖 `Index Granularity`：

```text
Fine ───────── Coarse
```

系統即時顯示 index node count、latency、retrieval recall、rehydration cost、fine evidence coverage。

右側 Decision Risk 顯示：

```text
Retrieval coverage      95%
Claim coverage          91%
Temporal closure        83%
Visual region coverage  76%
Provenance integrity    100%
Hidden-gap risk         .18

EXECUTE expected loss   .27
VERIFY expected loss    .09
ABSTAIN expected loss   .14

RECOMMENDATION: VERIFY_MORE
```

最重要的是 UI 永遠不把 `95% coverage` 畫成 `95% safe`。

---

## Code / GitHub

### RomGai/VideoStir

URL: https://github.com/RomGai/VideoStir

本輪實際追讀：

```text
inference/
├ build_graph.py
├ builder.py
├ chunk_embedding.py
├ pipeline.py
├ query_intent.py
├ reranker.py
└ core/
```

`pipeline.py` 的可確認 runtime：

```text
extract_visual_embeddings
→ cluster_and_segment
→ export_segments
→ compute_video_features
→ build_spatiotemporal_graph
→ analyze_query_intent
→ retrieve_topk_segments
→ temporal/subtitle attribute merge
→ rerank_segments
→ retrieval_plan.json
```

值得特別搬進 Hermes 的不是整個 VideoStir，而是：

```text
TemporalEvidenceGraph
CoarseToFineEvidenceMapping
SubtitleTemporalAlignment
IntentAwareEvidenceScorer
EvidenceRehydrationPointer
```

### 下一步值得讀原始碼

1. `VideoStir/inference/build_graph.py`：edge type / weight 的精確建法。
2. `VideoStir/inference/reranker.py`：intent-relevance scorer 如何把 fine frames 排序。
3. `MAGE-RAG`：online evidence controller 的 activate/open/search/prune state machine。
4. GranuRAG：element detector、cross-modal alignment 與 attribution constraint 的實作。

---

## Papers

### VideoStir
- Title: VideoStir: Understanding Long Videos via Spatio-Temporally Structured and Intent-Aware RAG
- Authors: Honghao Fu, Miao Xu, Yiwei Wang, Dailing Zhang, Jun Liu, Yujun Cai
- Venue/Year: ACL 2026
- URL: https://aclanthology.org/2026.acl-long.1656/
- Code: https://github.com/RomGai/VideoStir
- Dataset: IR-600K
- Architecture: clip-level spatio-temporal graph + multi-hop retrieval + intent-relevance scorer
- Contribution: 保留 long-video temporal structure，並從 semantic relevance 提升到 reasoning-intent relevance
- Limitations: 仍需進一步驗證 provenance completeness、跨模態 temporal alignment error 與 production latency

### GranuRAG
- Title: From Scenes to Elements: Multi-Granularity Evidence Retrieval for Verifiable Multimodal RAG
- Authors: Guanhua Chen, Chuyue Huang, Yutong Yao, Shudong Liu, Xueqing Song, Lidia S. Chao, Derek F. Wong
- Venue/Year: Findings ACL 2026
- URL: https://aclanthology.org/2026.findings-acl.509/
- Dataset: GranuVistaVQA
- Architecture: element detection/classification → cross-modal alignment → attribution-constrained generation
- Contribution: 將 visual element 變成可引用 evidence unit
- Limitations: detector/classifier error 會成為 provenance chain 的上游錯誤

### MAGE-RAG
- Title: MAGE-RAG: Multigranular Adaptive Graph Evidence for Agentic Multimodal RAG in Long-Document QA
- Authors: Yilong Zuo et al.
- Year: 2026
- URL: https://arxiv.org/abs/2606.15906
- Code: https://github.com/laonuo2004/MAGE-RAG
- Benchmarks: LongDocURL, MMLongBench-Doc
- Architecture: offline page/element graph + online budgeted evidence controller
- Contribution: 以 evidence subgraph 平衡 dispersed evidence coverage、noise 與 context budget
- Limitations: graph construction / maintenance cost 與 relation extraction quality 仍是系統瓶頸

### Bayesian Conformal Prediction as a Decision Risk Problem
- Authors: Fanyi Wu, Veronika Lohmanova, Samuel Kaski, Michele Caprio
- Year: 2026
- URL: https://arxiv.org/abs/2602.03331
- Architecture: Bayesian posterior predictive + conformal risk control + HPD decision-risk optimization
- Contribution: 把 conformal set construction 直接連到 decision risk
- Limitations: 不能直接等同 Agent action safety certificate；Hermes 的 cross-modal/action-risk mapping 仍需額外研究

---

## Unknown / Open Questions

1. **Cross-modal exchangeability**：text span、image region、video interval、tool field 的 nonconformity score 能否進入同一個 conformal calibration family，還是必須 modality-conditioned calibration？目前尚未確認。
2. **Alignment uncertainty**：subtitle ↔ clip、OCR ↔ region、audio ↔ event 的 alignment 本身也有 error；provenance graph 是否應讓 alignment edge 帶 probability / interval，而非 binary link？
3. **Decision-level guarantee**：如何從 evidence coverage + provenance integrity + calibrated model error，推到有明確 loss function 的 action-risk upper bound？目前仍沒有 universal solution。

---

## 下一輪研究

主題：**Alignment Uncertainty × Cross-Modal Calibration × Evidence Authority × Decision-Level Risk Bounds**

優先追：

```text
cross-modal conformal calibration
multimodal selective prediction
spatio-temporal grounding uncertainty
OCR/ASR alignment uncertainty
sensor fusion confidence
provenance edge uncertainty
risk-controlling prediction sets
selective action / abstention
```

要建立：

```text
AlignmentUncertaintyEdge
ModalityConditionedCalibrator
CrossModalCoverageProfile
EvidenceAuthorityWeight
DecisionRiskBound
RiskControlledActionGate
ProvenanceUncertaintyPropagation
```

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
CrossModalEvidenceUnit
RetrievalUnit
EvidenceUnit
ReasoningUnit
EvidenceGranularity
GranularityDecoupling
CoarseEvidenceIndex
FineEvidenceSpace
EvidenceRehydrationPointer
VideoEvidenceUnit
TemporalEvidenceInterval
VisualEvidenceRegion
SubtitleEvidenceSpan
ToolResponseFieldEvidence
CrossModalEvidenceGraph
TemporalLineage
ContainmentEdge
AlignmentEdge
DecisionRiskCertificate
ModalityCoverage
TemporalCoverage
ProvenanceIntegrity
```

### Edges

```text
RetrievalUnit
≠ EvidenceUnit

EvidenceUnit
≠ ReasoningUnit

CoarseIndexNode
→ REHYDRATES_TO
FineEvidenceUnit

VideoSegment
→ CONTAINS
Frame

Frame
→ CONTAINS
VisualEvidenceRegion

SubtitleSpan
→ TEMPORALLY_ALIGNED_WITH
VideoSegment

ToolExecution
→ PRODUCED
ToolResponseFieldEvidence

Claim
→ SUPPORTED_BY
CrossModalEvidenceUnit

RetrievalCoverage
≠ DecisionSafety

CoverageCertificate
→ INPUT_TO
DecisionRiskCertificate
```

---

## 本輪結束判斷

- **缺哪一層**：Alignment Uncertainty / Modality-Conditioned Calibration / Decision-Level Risk Bound。
- **哪個節點最淺**：`DecisionRiskCertificate`、`AlignmentEdge`、`CrossModalCoverageProfile`。
- **哪個概念仍只是名詞**：跨 text/image/video/audio/tool 的 universal `Evidence Completeness Certificate`。
- **哪個系統值得讀原始碼**：VideoStir 的 `build_graph.py + reranker.py`，其次 MAGE-RAG online evidence controller。
- **哪篇論文需追引用**：VideoStir、GranuRAG、Coarse Indexing Fine Evidence。
- **哪個概念最適合視覺模擬**：Cross-Modal Evidence Microscope × Decision Risk Console。
- **哪個 Agent 架構最值得實作**：`CrossModalIndexRouter → Coarse Retrieval → Provenance Rehydration → Fine Evidence Graph → Coverage Resolver → DecisionRiskEstimator → VERIFY/EXECUTE/ABSTAIN`。

## 對「AI 到底怎麼運作」新增的核心

多模態 AI 的證據不能被簡化成「圖片也轉成 token、影片也轉成 token」。可靠 Agent 還必須保留 token 背後的**物理來源與定位**：這句話來自哪一頁、這個視覺判斷來自哪個 bbox、這個事件發生在哪段影片、這個狀態來自哪一次 Tool/MCP execution。高效 retrieval 可以先用粗粒度 representation 找方向，但真正要做判斷時必須能回到 fine-grained source。最後，系統還要把「我找到了多少證據」和「如果我現在執行這個行動，錯誤代價有多大」分成兩個不同問題。這才是從 Multimodal RAG 走向可驗證 Agent perception/runtime 的關鍵。