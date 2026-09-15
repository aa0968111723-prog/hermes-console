# 【AI Agent × Multimodal Research Report】

時間：2026-09-15 13:53（Asia/Taipei）

主題：Retrieval Sufficiency × Hidden-Evidence Probes × Compression Certificates × Multimodal Provenance

## 本小時新發現

本輪承接上一輪 Evaluation Memory × Evidence Provenance × Temporal Validity × Retrieval Reliability，不再重複「如何保存 memory」，而是研究：系統如何知道目前取回的 evidence 已經足夠、壓縮後是否仍保留決策所需資訊，以及 image/page/region 等多模態 evidence 如何成為可追蹤的一級證據。

新論文/架構：S2G-RAG（ACL 2026）、PAGE-RAG（2026-08-30）、GranuRAG（ACL Findings 2026）、Utility-Oriented Visual Evidence Selection（ACL 2026）、MEG-RAG（2026）。

## 本小時最重要 5 個發現

### 1. Retrieval stopping 應由 Sufficiency + Missing Gap 控制，而不是固定 Top-K

已確認事實 / 論文結果：S2G-RAG 把 iterative RAG 的停止條件顯式化。S2G-Judge 每輪讀取 Question + accumulated Evidence Context，輸出 sufficient 與 structured missing facts；不足時 missing facts 會被轉成下一輪 query。

底層：
Question → Evidence Context → Sufficiency Gate → {SUFFICIENT | INSUFFICIENT + GapItems} → Gap-to-Query → Retriever → Sentence Selector → Evidence Memory → Re-evaluate Sufficiency。

工程實作：官方 nianaaa/S2G-RAG 的 inference_e5.py 真的實作 call_suff_gate_batch；解析 JSON sufficient 與 missing facts。build_query_from_missing 把 target/slot/description 轉成 query。主 loop 在每輪先 gate，再只讓 insufficient items 進 retrieval。

限制：Sufficiency Gate 本身仍是 learned/model judgment，可能 false-positive，尤其「不知道自己缺什麼」時會過早停止。因此 production Hermes 不能把 sufficient=true 當 certificate，而要附 calibration、coverage probe 與 adversarial hidden-evidence test。

### 2. Evidence Sufficiency ≠ Retrieval Confidence；必須測「缺失證據是否仍能改變決策」

合理建模：真正的 sufficiency 應接近 decision sufficiency，而非 cosine/top-k confidence。

定義候選：
DecisionSufficient(E) iff 對所有仍具合理機率的 missing evidence e，加入 e 後關鍵 decision / answer 不會超過 tolerance 改變。

可操作近似：
E → Current Decision D
→ Generate plausible missing-gap hypotheses G
→ Retrieve/probe evidence for G
→ Counterfactual decision D'
→ 若高權威新 evidence 可大幅改變 D，則原 evidence 不 sufficient。

因此新增 HiddenEvidenceProbe：主動生成「若目前答案錯，最可能缺哪一類 evidence？」再搜尋一次。這是從 passive sufficiency judge 升級到 falsification-oriented sufficiency。

### 3. Fixed reader budget 下，provenance-aware minimal sufficient selection 比單純擴大 retrieval 更合理

論文結果：PAGE-RAG（2026-08-30）指出 candidate connectivity 不等於 answer support，稱為 connectivity-support gap。它建立 query-local graph，將 connection 當 support hypothesis，而非 support 本身，再綜合 relevance、source tracing、specificity、hubness、noise、coherence，在固定 reader budget 下做 minimal sufficient selection。論文報告三個 multi-hop QA benchmark 的 weighted-average support F1 +10.4、answer F1 +3.3。

Hermes 映射：
Broad Retrieval Pool → Query-local Evidence Graph → Provenance-aware Path Scoring → Minimal Sufficient Evidence Set → Reader/Judge Context。

關鍵：Graph edge 是「候選關係」，不能直接被誤當成 evidence support。

### 4. Multimodal provenance 必須從 page/image 下沉到 element/region

論文結果：GranuRAG 將 visual elements 當 first-class retrieval units：element detection/classification → multi-granularity cross-modal alignment → attribution-constrained generation；GranuVistaVQA 專門涵蓋不同 viewpoint 只觀察到部分 entity 的 partial-observation 問題。論文報告相對六個 strong baselines 最高 29.2% 改善。

Hermes 應將 multimodal evidence node 從：
ImageEvidence(image_id)
升級為：
VisualEvidenceRegion {asset_id, page/frame, bbox/mask, detector/model, observation_time, source_hash, parent_asset, extracted_entities, transform_history}。

如此 claim 才能連到精確 region，而不是模糊地說「來源是這張圖」。

### 5. Similarity ≠ Evidence Utility；Compression Certificate 必須保證決策資訊沒有被壓掉

論文結果：Utility-Oriented Visual Evidence Selection 把 visual evidence utility 定義成 evidence 對模型 output distribution 造成的 information gain，並用 latent helpfulness + surrogate model 做 training-free approximation；MEG-RAG 則指出表面相關 evidence 不一定支援 answer semantic core，提出 semantic-aware Multi-modal Evidence Grounding。

因此 Hermes 的 CompressionCertificate 不應只有 compression ratio，而應記：
source_hash、transform、retained_claims、retained_entities、retained_numeric_values、retained_tool_arguments、retained_visual_regions、decision_delta_test、rehydration_pointer、coverage_status。

核心 invariant：如果壓縮前後在同一 decision probe 上產生重大 decision delta，壓縮不可被標記為 decision-preserving。

## Architecture Breakdown

Evaluation / Agent Query
→ Evidence Requirement Graph
→ Multi-route Retrieval
  ├ semantic/vector
  ├ causal/trajectory
  ├ temporal/version
  ├ entity
  ├ graph/path
  └ multimodal region
→ Candidate Evidence Pool
→ Provenance Resolver
→ Evidence Utility / Support Scorer
→ Minimal Sufficient Evidence Selector
→ Sufficiency Gate
  ├ sufficient
  └ missing gaps
→ Hidden-Evidence Probe
→ Gap-guided Retrieval Loop
→ Compression Planner
→ Compression Certificate
→ Context Builder
→ Judge / Reasoner
→ Decision
→ Source Rehydration if challenged

## Bottom-Level Logic

S2G-RAG 官方 runtime 的具體機制：
1. evidence_context_so_far 初始化為空。
2. call_suff_gate_batch(question, context) 用 deterministic generation 產生 JSON。
3. JSON 解析為 sufficient 與 missing_facts。
4. 第一輪若空 evidence 卻被判 sufficient，should_force_first_retrieval 強制至少 retrieval 一次。
5. build_query_from_missing 將 missing facts 的 target/slot/description 拼入 query。
6. E5/BM25 retrieval 取得 documents。
7. 文件切成 sentence；selector 依 question + missing facts 選最多若干 evidence sentences。
8. merge_evidence_only 只把選中 sentences 追加到 evidence context。
9. 回到 sufficiency gate；直到 sufficient 或 max_turns。

這證明 retrieval controller 可以被實作成明確 state machine，而非「LLM 自己一直搜」。

Hermes 下一步應加入：
SufficiencyPosterior = f(gate verdict, gap coverage, provenance authority, retrieval diversity, hidden-evidence probe, temporal validity, calibration surface)。

## Visual Simulation Idea

### Evidence Sufficiency Observatory × Multimodal Provenance Lab

左側顯示 Query → Retrieval → Evidence Graph。每個 evidence node 可展開到 document/page/image/frame/region/tool observation。中間顯示 Sufficiency Meter，不只一個百分比，而拆成 Required Facts Covered、Source Authority、Temporal Validity、Independent Corroboration、Hidden-Gap Risk、Compression Loss Risk。右側是 Missing Gap Queue。

互動：使用者可把 Top-K 從 2 拉到 50，看 evidence noise 增加；切換 fixed Top-K / S2G gap-guided / PAGE minimal sufficient；故意隱藏一個關鍵 region，觀察 HiddenEvidenceProbe 是否發現；將 raw tool/image evidence 壓成 summary，直接比較壓縮前後 decision delta；點任何 claim 反向追到原始 page/frame/bbox/tool execution。

## Code / GitHub

重點原始碼：nianaaa/S2G-RAG。

值得看的結構：
- run_S2G-RAG.py：generation → prepare_training → training → inference pipeline。
- inference/inference_e5.py：完整 iterative retrieval runtime。
- inference/inference_bm25.py：BM25 variant。
- utils/prompt_template.py：Sufficiency/Selector prompts。
- utils/text_processing.py：gap/evidence/answer parsing。
- training/：S2G-Judge training pipeline。

核心檔案優先順序：inference/inference_e5.py → utils/prompt_template.py → training/ → generation/。

## Papers

1. S2G-RAG: Structured Sufficiency and Gap Judging for Iterative Retrieval-Augmented QA — Minghan Li, Junjie Zou, Xinxuan Lv, Chao Zhang, Guodong Zhou — ACL 2026. Architecture: explicit sufficiency/gap controller + sentence evidence context + iterative retrieval. Contribution: 將停止/缺口顯式結構化。Limitations: gate 本身仍可能 miscalibrate；主要 text QA。

2. PAGE-RAG: Provenance-Aware Graph Evidence Promotion for Fixed-Budget Multi-hop Retrieval-Augmented Generation — Haokun Deng, Xunkai Li, Hongchao Qin, Rong-Hua Li — 2026. Architecture: query-local graph + provenance-aware path scoring + minimal sufficient promotion. Contribution: 明確指出 connectivity-support gap。Limitations: 目前結果集中 multi-hop QA。

3. From Scenes to Elements: Multi-Granularity Evidence Retrieval for Verifiable Multimodal RAG — Guanhua Chen et al. — Findings ACL 2026. Dataset: GranuVistaVQA. Architecture: element detection/classification → cross-modal multi-granularity retrieval → attribution-constrained generation. Contribution: visual element 成為 first-class evidence unit。Limitations: domain/benchmark generalization 尚需驗證。

4. Utility-Oriented Visual Evidence Selection for Multimodal Retrieval-Augmented Generation — Weiqing Luo et al. — ACL 2026. Architecture: information-gain utility + latent helpfulness + lightweight surrogate. Contribution: evidence utility 與 semantic similarity 解耦。Limitations: utility 仍依 model/surrogate distribution。

5. MEG-RAG: Quantifying Multi-modal Evidence Grounding for Evidence Selection in RAG — Xihang Wang et al. — 2026. Architecture: semantic certainty anchors + multimodal evidence grounding + reranker. Contribution: 評估 evidence 是否支援答案 semantic core。Limitations: semantic anchors 仍依 answer/reference formulation。

## Unknown / Open Questions

1. Sufficiency Gate 如何校準成可比較的 P(missing decision-changing evidence)，而不只是 binary verdict？
2. 對 image/video/audio，如何定義跨模態 Compression Certificate，證明 crop/summary/transcript 沒有刪掉 decision-critical signal？
3. HiddenEvidenceProbe 如何避免無限生成 speculative gaps，並以 verification VoI 決定何時停止？

## 下一輪研究

主題：Decision-Sufficient Retrieval × Retrieval Stopping Calibration × Evidence Coverage Certificates × Cross-Modal Rehydration。

優先研究：sufficiency calibration、adaptive retrieval stopping、coverage certificates、counterfactual evidence omission、region/frame/audio-span provenance、source rehydration latency/cost、retrieval regression tests。

## Knowledge Graph 新增 Node / Edge

Nodes：RetrievalSufficiency、DecisionSufficiency、SufficiencyGate、StructuredEvidenceGap、HiddenEvidenceProbe、GapGuidedRetrieval、MinimalSufficientEvidenceSet、ConnectivitySupportGap、EvidenceUtility、MultimodalEvidenceGrounding、VisualEvidenceRegion、CrossModalProvenance、CompressionCertificate、DecisionPreservingCompression、SourceRehydration、EvidenceCoverageRisk。

Edges：
- TopKConfidence ≠ EvidenceSufficiency
- SemanticSimilarity ≠ EvidenceUtility
- GraphConnectivity ≠ EvidenceSupport
- SufficiencyGate → Emits StructuredEvidenceGap
- StructuredEvidenceGap → Guides RetrievalQuery
- HiddenEvidenceProbe → Challenges SufficiencyClaim
- MinimalSufficientEvidenceSet → Reduces Context Noise
- VisualEvidenceRegion → DERIVED_FROM → SourceAsset
- CompressedEvidence → MUST_RETAIN_PROVENANCE → SourceEvidence
- DecisionDeltaAfterCompression → Invalidates DecisionPreservingCompression
- SourceRehydration → Restores ImmutableSourceEvidence

## 本輪結束判定

缺哪一層：Decision-Sufficient Retrieval Calibration / Coverage Certification。

哪個節點最淺：CompressionCertificate、HiddenEvidenceProbe、CrossModalProvenance。

哪個概念仍只是名詞：跨 domain、跨模態、可統計保證的 Evidence Completeness Certificate。

哪個系統值得讀原始碼：S2G-RAG 的 inference_e5.py 與 training pipeline；下一輪應再追 GranuRAG / utility-mrag code。

哪篇論文需追引用：S2G-RAG、PAGE-RAG、GranuRAG。

哪個概念最適合視覺模擬：Evidence Sufficiency Observatory × Multimodal Provenance Lab。

哪個 Agent 架構最值得實作：Sufficiency-Gated Evidence Agent：Requirement Graph → Multi-route Retrieval → Minimal Evidence Selection → Sufficiency/Gaps → Hidden-Evidence Probe → Rehydrate → Decide。

## 對「AI 到底怎麼運作」新增的答案

可靠 Agent 的 retrieval 不是「搜尋一次、拿 Top-K、塞進 Context」。它更接近一個受控感知迴圈：先根據任務建立 evidence requirements，搜尋候選證據，辨認哪些 evidence 真正支援決策，再判斷目前證據是否足夠；若不足，明確指出缺口並發動下一輪 retrieval。對多模態資料，證據還必須能一路追到 image region、video frame、audio span 或 tool observation。只有當系統能回答「我為什麼認為證據夠了，以及每個 claim 到底來自哪裡」，Retrieval 才從相似度搜尋升級成可驗證的 Agent perception layer。