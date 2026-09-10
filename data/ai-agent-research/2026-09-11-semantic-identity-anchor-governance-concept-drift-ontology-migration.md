# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 00:53 Asia/Taipei**  
**本輪主題：Semantic Identity × Anchor Governance × Concept Drift × Ontology Migration × Dynamic Ontology Kernel**

## 與歷史研究比較

上一輪已處理 Representation Drift × Encoder Epoch × Cross-Version Latent Alignment，核心問題是「同一語義在不同 encoder 座標系中如何比較」。本輪不重複 encoder alignment，而專門處理更下一層：**如果改變的不是座標系，而是概念本身、ontology schema、relation 定義或 entity identity，系統如何知道這是真正的 semantic evolution，而不是 representation drift？**

上一輪鏈：

```text
Raw Observation
→ Versioned Encoder
→ Encoder Epoch
→ Alignment
→ Canonical Semantic Universe
```

本輪補上：

```text
Canonical Semantic Universe
→ Semantic Identity Registry
→ Ontology Version Graph
→ Concept Drift Detector
→ Entity/Relation Migration
→ Compatibility Contract
→ Agent Runtime
```

核心新結論：

> **Representation Drift ≠ Concept Drift ≠ Ontology Drift ≠ Entity Identity Change。**

如果 Hermes 不把四者分離，模型升級、概念演化、schema migration 與真正的 entity replacement 會被混成同一種「embedding 變了」。

---

## 本小時新發現

### 1. 新架構：Ontology-as-a-Kernel（OaK）

論文：**Toward Effective and Reliable LLM Agents via Dynamic Ontology**  
Authors: Xiaohui Zhang, Zequn Sun, Chengyuan Yang, Yuanning Cui, Lingbing Guo, Wei Hu  
Year: 2026  
Institution: Nanjing University 等作者團隊  
URL: https://arxiv.org/abs/2608.22974  
Code: 本輪未找到可公開驗證的完整官方程式庫，僅確認論文與作者研究頁。  
Benchmarks: TravelPlanner, CRMArenaPro, ToolQA

OaK 的重要性不在「Agent 使用 knowledge graph」，而在於把 ontology 建模為：

```text
K = (S, F)

S = Task-Oriented Schema
F = Executable Reasoning Functions
```

流程不是：

```text
Prompt
→ LLM
→ Answer
```

而是：

```text
Task Requirements + Training Examples
↓
Schema Construction
↓
Formal Consistency Validation
↓
Knowledge Graph Instantiation
↓
Task-Adaptive Function Generation
↓
Judge Feedback
↓
Schema / Function Refinement
↓
Ontology Kernel
↓
Agent Reasoning
```

公開說明指出 schema 會轉為 OWL，並使用 HermiT 類 formal reasoner 檢查 disjointness、restriction、property domain/range、unsatisfiable classes 與 global consistency。這代表 ontology 不只是 retrieval metadata，而開始成為 Agent 的 **runtime semantic control plane**。

來源：
- https://arxiv.org/abs/2608.22974
- https://sunzequn.github.io/

### 2. 新 ontology versioning 機制：OM4OV

論文：**OM4OV: Leveraging Ontology Matching for Ontology Versioning**  
Authors: Zhangcheng Qiang, Kerry Taylor, Weiqing Wang  
Journal version: Transactions on Graph Data and Knowledge, 2026-09-03  
DOI: 10.4230/TGDK.4.2.6  
URL: https://drops.dagstuhl.de/entities/document/10.4230/TGDK.4.2.6  
Preprint: https://arxiv.org/abs/2409.20302  
Code: https://github.com/qzc438/ontology-versioning  
Dataset/Testbed: derived from OAEI Anatomy, Conference, MSE tracks

OM4OV 把 ontology evolution 拆成四種操作：

```text
Old Ontology O
New Ontology O'
↓
Entity Alignment
↓
REMAIN
UPDATE
ADD
DELETE
```

概念上：

```text
matched && exact
→ REMAIN

matched && semantically changed
→ UPDATE

new only
→ ADD

old only
→ DELETE
```

這比單純 Git diff 更接近 semantic migration，因為 URI、label 或結構改變不一定代表 entity identity 消失。

來源：
- https://arxiv.org/abs/2409.20302
- https://drops.dagstuhl.de/entities/document/10.4230/TGDK.4.2.6

### 3. 新身份問題：Knowledge Update ≠ Agent Identity Mutation

論文：**Episodic-to-Semantic Consolidation Without Identity Drift**  
Authors: Xue Qin, Simin Luan, Cong Yang, Zhijun Li  
Year: 2026  
URL: https://arxiv.org/abs/2607.01988

該工作把 long-running agent 的 semantic memory consolidation 與 agent identity manifest 分離：

```text
Episodic Memory
↓ deterministic consolidation
Semantic Memory

Agent Identity Manifest
───────────────┘
不把 semantic-memory content 納入 identity hash input
```

對 Hermes 的啟發不是照搬其 cryptographic identity 定義，而是：

> **Knowledge state 可變，但 Agent operational identity、permission contract、policy identity 與 audit identity 不應因每次知識更新而自動改寫。**

因此需要明確分離：

```text
AgentIdentity
KnowledgeState
OntologyState
ModelState
PolicyState
```

來源：
- https://arxiv.org/abs/2607.01988

### 4. 新 Concept Drift detector：Label-Free Semantic Shift

論文：**Label-Free Visual Concept Drift Detection via Classifier Two-Sample Tests and Characteristic Function Embeddings**  
Authors: Gurgen Hovakimyan, Jorge Miguel Bravo  
Institution: NOVA IMS, Universidade NOVA de Lisboa  
Year: 2026  
DOI: 10.31181/jscda41202686

其主要問題是：傳統高維 distance heuristic 對自然 semantic shift 不一定敏感。方法使用：

```text
Reference Window
Current Window
↓
Deep Representation
↓
Characteristic Function Embedding bottleneck
↓
Classifier Two-Sample Test
↓
Distribution Shift Score
```

對 Hermes 的重要限制：這仍主要回答：

```text
P_t(X) != P_t+1(X) ?
```

而不自動回答：

```text
「Tool」這個概念的定義是不是改了？
```

因此 **Distribution Drift Detector ≠ Semantic Identity Resolver**。

來源：
- https://www.jscda-journal.org/index.php/jscda/article/view/86
- https://novaresearch.unl.pt/en/publications/label-free-visual-concept-drift-detection-via-classifier-two-samp/

### 5. W3C OWL 的版本語義提供最低層 provenance contract

OWL 2 規範把 ontology series 與 version-specific IRI 分離：同一 ontology series 有穩定 ontology IRI，而每個版本可有不同 version IRI。OWL 也提供 `owl:priorVersion`、`owl:backwardCompatibleWith`、`owl:incompatibleWith` 等版本關係；deprecation 則允許舊概念仍存在但不建議新系統使用。

因此 Hermes 不應只存：

```text
ontology_version = "v8"
```

而應保存 version graph：

```text
OntologySeries
├ version v7
│  └ compatible_with v6
└ version v8
   ├ prior_version v7
   ├ breaks Relation:R12
   └ deprecates Concept:C19
```

來源：
- https://www.w3.org/TR/owl2-syntax/
- https://www.w3.org/2007/OWL/wiki/Ontology_Versions.html

---

# 本小時最重要 5 個發現

## 發現一：Semantic Identity 不能由 embedding proximity 決定

### 是什麼

一個 concept 的 identity 應由多種證據共同決定：

```text
Stable ID
Definition
Relations
Constraints
Behavioral Tests
Provenance
Temporal Continuity
External Cross-References
```

而不是：

```text
cosine(old_embedding, new_embedding) > 0.9
→ same concept
```

### 底層如何運作

建議建立：

```text
SemanticIdentityRecord
├ semantic_id
├ canonical_name
├ definitions[]
├ ontology_series_id
├ valid_from
├ valid_to?
├ predecessor_ids[]
├ successor_ids[]
├ aliases[]
├ external_refs[]
├ invariants[]
├ behavioral_probes[]
├ representation_epochs[]
└ provenance[]
```

### 為什麼重要

例如 MCP 中 `tool` 可能從單純 RPC function，逐步包含 authorization、resources、streaming、sampling 等新語義。如果 Hermes 只靠舊文字 embedding 判定「Tool 還是同一個 Tool」，可能漏掉 runtime contract 已改變。

### 限制

「同一概念何時變成新概念」本身可能無唯一客觀答案，需要 domain governance。

---

## 發現二：UPDATE 是 ontology migration 最難的一類

OM4OV 的工程價值是把：

```text
DELETE old + ADD new
```

與：

```text
UPDATE same semantic lineage
```

分開。

其公開 source `generate_cross_reference.py` 不是單純名稱匹配；它保存 cross-reference row identity，產生 old/new reference copies，針對 add/delete/update 更新 mapping，最後重新 merge 成 prior alignment。程式中特別避免直接用 partner entity join，因為 partner entity 非唯一時會製造假的 rename mapping。

值得看的檔案：

```text
generate_cross_reference.py
generate_dataset_ops.py
generate_dataset_copy.py
find_ontology_metadata.py
ov_run_config.py
alignment/
data_versioning/
```

這個原始碼細節非常值得 Hermes 吸收：

> **Semantic migration 的 mapping key 必須有 lineage/provenance identity，不能只用 surface entity value。**

---

## 發現三：Stable Anchor 與 Mutable Concept 必須分級治理

上一輪把 semantic anchor 當作 cross-version alignment 的校準點，但本輪發現 anchor 自己也可能 drift。

所以 anchor 需要分級：

```text
AnchorTier
├ T0 Physical / mathematical invariants
├ T1 Stable system primitives
├ T2 Versioned technical concepts
├ T3 Domain conventions
└ T4 Task-local mutable concepts
```

例如：

```text
T0: integer, timestamp ordering
T1: event_id, cryptographic hash
T2: MCP Tool, Agent Memory
T3: organization role taxonomy
T4: campaign-specific audience segment
```

T0/T1 可以作 alignment reference；T3/T4 不應被默認為永遠穩定。

這是本輪的**工程建模**，不是既有標準。

---

## 發現四：Ontology Kernel 應版本化 reasoning function，而不只版本化 schema

OaK 提出 ontology kernel `K=(S,F)` 後，一個更深層推論是：

```text
Schema v8
+
Reasoning Functions F7
```

可能是不合法組合。

因此 Hermes 應保存：

```text
OntologyKernelRelease
├ schema_version
├ reasoning_function_bundle
├ KG_snapshot_version
├ validator_version
├ tool_schema_version
├ compatibility_matrix
└ migration_plan
```

這與傳統 ontology repository 很不同，因為 Agent ontology 是 executable ontology。

---

## 發現五：Concept Drift 需要 Drift Attribution，而不只 Drift Detection

觀察到：

```text
retrieval accuracy ↓
embedding distribution changed
```

可能有四種來源：

```text
A Encoder Drift
B Data Distribution Drift
C Concept Definition Drift
D Ontology / Schema Migration
```

因此真正需要的是：

```text
Drift Signal
↓
Attribution
├ Encoder-only?
├ Distribution-only?
├ Semantic definition changed?
├ Relation constraints changed?
├ Entity split/merge?
└ Unknown
↓
Migration Policy
```

這讓前一輪 Representation Compatibility Plane 與本輪 Semantic Governance Plane 接起來。

---

# Architecture Breakdown

## Hermes Semantic Governance & Ontology Migration Plane

```text
Raw Knowledge / Tool Specs / MCP / Memory / Papers
↓
Semantic Extraction
↓
Canonical Entity Resolver
↓
Semantic Identity Registry
↓
Ontology Version Graph
├ Concept versions
├ Relation versions
├ Constraint versions
├ aliases
├ deprecated nodes
└ external cross-references
↓
Drift Monitor
├ Representation drift
├ Distribution drift
├ Definition drift
├ Relation drift
├ Behavioral drift
└ Schema drift
↓
Drift Attribution Engine
↓
Ontology Matcher
↓
Migration Classifier
├ REMAIN
├ UPDATE
├ SPLIT
├ MERGE
├ ADD
├ DELETE
├ DEPRECATE
└ INCOMPATIBLE
↓
Formal / Behavioral Validator
↓
Ontology Kernel Release
├ Schema S
└ Functions F
↓
Compatibility Certificate
↓
Agent Runtime / RAG / Memory / Tool Router / Knowledge Graph
```

OM4OV 原始四類 REMAIN/UPDATE/ADD/DELETE 對 Hermes 還不夠，因此本輪工程上擴充 SPLIT、MERGE、DEPRECATE、INCOMPATIBLE。

---

# Bottom-Level Logic

## 1. Drift Attribution

```text
Same semantic anchors?
├ NO → anchor/concept drift candidate
└ YES
   ↓
Representation alignment succeeds?
├ YES → likely encoder coordinate drift
└ NO
   ↓
Definition / relation / behavior changed?
├ YES → semantic/ontology drift
└ NO → unresolved distribution or model drift
```

不能將此 decision tree 當成正式統計證明；它是 Runtime triage architecture。

## 2. Semantic Entity Migration

```text
Old Concept C_old
New Concept candidates {C1...Cn}
↓
Lexical match
Structural relation match
External cross-reference
Definition entailment
Behavioral probe
Temporal lineage
↓
Migration evidence
↓
REMAIN / UPDATE / SPLIT / MERGE / DELETE
↓
Human/formal validation when high-impact
```

## 3. Relation Migration

Concept 沒變，relation 本身也可能改：

```text
Tool --requires--> Permission
```

可能變成：

```text
Tool --requires_scope--> CapabilityGrant
```

因此 migration graph 必須把 relation 當一級 versioned entity。

## 4. Compatibility

建議：

```text
Compatible(old,new)
=
IdentityContinuity
∧ ConstraintPreservation
∧ BehavioralProbePass
∧ RequiredRelationsMapped
```

但這是工程 contract，不是 OWL 規範公式。

---

# Visual Simulation Idea

## Semantic Identity & Ontology Migration Lab

UI 左右兩側顯示 ontology v7 / v8：

```text
Ontology v7                    Ontology v8

[Agent]                        [Agent]
  │                              │
  ├ uses → [Tool]        →        ├ uses → [Capability]
  │                              │           ├ Tool
  └ has → [Memory]               │           └ Resource
                                 └ has → [MemorySystem]
```

中央 migration engine 動畫：

```text
Tool(v7)
↓
Similarity      0.91
Structure       0.72
Behavior probe  0.58
Cross-ref       yes
↓
UPDATE ?
```

如果一個 concept 拆兩個：

```text
Memory(v7)
├→ EpisodicMemory(v8)
└→ SemanticMemory(v8)

Migration type: SPLIT
```

使用者可以切換：

```text
LEXICAL VIEW
RELATION VIEW
BEHAVIOR VIEW
VERSION GRAPH
DRIFT ATTRIBUTION
AGENT IMPACT
```

其中 `AGENT IMPACT` 最重要：點擊 `Tool → Capability` migration 後，直接顯示哪些：

```text
RAG indexes
Agent prompts
Tool schemas
MCP policies
Memory records
Risk edges
Simulation nodes
```

需要 migration。

---

# Code / GitHub

## qzc438/ontology-versioning

Repository: https://github.com/qzc438/ontology-versioning

已確認根目錄包含：

```text
alignment/
data/
data_versioning/
combine_csv.py
find_ontology_metadata.py
generate_all.py
generate_cross_reference.py
generate_dataset_copy.py
generate_dataset_ops.py
```

本輪深入 `generate_cross_reference.py`：

```text
true_pairs.csv
↓
insert RefRow provenance key
↓
copy old/new reference
↓
apply ADD/DELETE/UPDATE changes
↓
merge old/new using RefRow
↓
cross_reference_alignment.csv
```

其重要工程細節是：不能用非唯一 partner entity 當 join key，否則會 cross-join 並製造不存在的 rename。這正好支持 Hermes 必須有 `SemanticLineageID / MigrationEvidenceID`。

### 值得下一步讀的核心檔案

1. `generate_dataset_ops.py`：ontology change operation 生成方式。
2. `ov_run_config.py`：version matching runtime orchestration。
3. `alignment/`：ontology matching pipeline 與 Agent-OM interface。
4. `generate_cross_reference.py`：prior alignment / provenance reuse。
5. `combine_csv.py`：evaluation aggregation。

---

# Papers

### A. Toward Effective and Reliable LLM Agents via Dynamic Ontology
- Authors: Xiaohui Zhang, Zequn Sun, Chengyuan Yang, Yuanning Cui, Lingbing Guo, Wei Hu
- Year: 2026
- URL: https://arxiv.org/abs/2608.22974
- Code: 未驗證到官方公開完整 repo
- Dataset/Benchmarks: TravelPlanner, CRMArenaPro, ToolQA
- Architecture: ontology kernel K=(S,F), KG instantiation, typed reasoning functions, iterative judge refinement
- Contribution: 把 ontology 從被動 schema 推成 Agent 可執行 semantic kernel
- Limitation: 動態 ontology 自身的 long-term version governance / migration 仍不是其核心問題

### B. OM4OV: Leveraging Ontology Matching for Ontology Versioning
- Authors: Zhangcheng Qiang, Kerry Taylor, Weiqing Wang
- Journal: TGDK 2026
- URL: https://drops.dagstuhl.de/entities/document/10.4230/TGDK.4.2.6
- Code: https://github.com/qzc438/ontology-versioning
- Dataset: OAEI-derived Anatomy, Conference, MSE testbeds
- Architecture: ontology matching → remain/update/add/delete → cross-reference optimisation
- Contribution: 將 ontology versioning 重構成 matching + migration classification 問題
- Limitation: update detection 仍然最困難；四類 change model 對 Agent runtime schema evolution仍偏粗

### C. Episodic-to-Semantic Consolidation Without Identity Drift
- Authors: Xue Qin, Simin Luan, Cong Yang, Zhijun Li
- Year: 2026
- URL: https://arxiv.org/abs/2607.01988
- Architecture: deterministic episodic→semantic consolidation while excluding semantic store from certified identity hash
- Contribution: 明確分離 mutable knowledge 與 stable operational identity
- Limitation: identity manifest 定義高度依賴特定 autonomic deployment assumption

### D. Label-Free Visual Concept Drift Detection via Classifier Two-Sample Tests and Characteristic Function Embeddings
- Authors: Gurgen Hovakimyan, Jorge Miguel Bravo
- Institution: NOVA IMS
- Year: 2026
- URL: https://www.jscda-journal.org/index.php/jscda/article/view/86
- Architecture: sliding windows → deep features → CFE bottleneck → C2ST
- Contribution: label-free high-dimensional semantic distribution drift detection
- Limitation: distribution shift detection 本身不能識別 ontology-level semantic identity migration

---

# Unknown / Open Questions

## 1. Semantic identity 到底由誰授權？

LLM 可以提出 `same / update / split / merge`，但 high-impact ontology migration 是否應由 formal rule、benchmark、human steward、consensus 或 cryptographic governance 決定，目前仍缺統一 ABI。

## 2. 如何證明 UPDATE 而不是 DELETE+ADD？

這需要 lexical、structural、behavioral、temporal、external-reference 多證據融合；尚未有適合 general Agent OS 的統一 calibrated posterior。

## 3. 跨模態 concept identity 怎麼維持？

`door` 在 text ontology、VLM visual prototype、3D geometry、robot affordance、audio cue 中不是同一 representation。如何證明它們是同一 semantic entity，仍然是 Multimodal Agent 的深層缺口。

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Semantic Identity
Semantic Identity Registry
Semantic Lineage ID
Ontology Version Graph
Ontology Kernel
Ontology Kernel Release
Concept Drift
Definition Drift
Relation Drift
Constraint Drift
Ontology Drift
Drift Attribution
Anchor Governance
Anchor Tier
Stable Anchor
Mutable Anchor
Ontology Migration
Migration Evidence
REMAIN
UPDATE
SPLIT
MERGE
ADD
DELETE
DEPRECATE
INCOMPATIBLE
Behavioral Semantic Probe
Ontology Compatibility Certificate
Reasoning Function Version
Schema-Function Compatibility
Agent Identity Manifest
Knowledge Identity Separation
```

## 新增 Edges

```text
SemanticIdentity
→ represented_by
RepresentationEpoch

SemanticIdentity
→ versioned_in
OntologyVersion

OntologyVersion
→ prior_version
OntologyVersion

ConceptVersion
→ evolves_to
ConceptVersion

ConceptVersion
→ splits_into
ConceptVersion

ConceptVersion
→ merges_into
ConceptVersion

OntologyKernel
→ contains
Schema

OntologyKernel
→ contains
ReasoningFunctionBundle

MigrationEvidence
→ supports
SemanticLineage

OntologyMigration
→ invalidates_or_updates
AgentRuntimeDependency
```

## 新增否定關係

```text
Representation Drift ≠ Concept Drift
Concept Drift ≠ Ontology Drift
Embedding Similarity ≠ Semantic Identity
Same Label ≠ Same Concept
Different Label ≠ Different Concept
Ontology Version ≠ Encoder Epoch
Knowledge Update ≠ Agent Identity Mutation
Distribution Shift ≠ Semantic Definition Change
RENAME ≠ Necessarily New Entity
DELETE + ADD ≠ Necessarily Identity Break
Schema Compatibility ≠ Reasoning Function Compatibility
Stable Anchor ≠ Permanently Immutable Concept
```

---

# 下一輪研究

本輪之後最深缺口變成：

# **Cross-Modal Semantic Identity × Grounded Entity Resolution × Affordance Identity × Object Permanence**

因為現在已經能把：

```text
Encoder Epoch
→ Representation Alignment
→ Semantic Identity
→ Ontology Version
```

串起來，但多模態 Agent 還有下一個問題：

```text
Camera 看見的杯子
Text 裡的「那個杯子」
Memory 中 object:17
3D map 中 mesh_302
Robot grasp target #5
```

到底是不是**同一個真實世界 entity**？

下一輪應研究：

```text
Object permanence
Entity resolution
Re-identification
Vision-language grounding
Scene graph
3D grounding
Affordances
Open-vocabulary detection
Tracking
Referential identity
Temporal identity
Embodied memory
```

完整下一鏈：

```text
Camera / Image / Voice / Video
↓
Encoder
↓
Tokens / Features
↓
Perceptual Object Hypotheses
↓
Cross-Modal Entity Resolver
↓
Persistent World Entity ID
↓
Ontology Concept
↓
Affordances / Relations
↓
Belief State
↓
Reasoning
↓
Agent Action
```

---

# 本輪收斂回答

- **缺哪一層：** Cross-Modal Grounded Entity Identity / Object Permanence。
- **哪個節點最淺：** Semantic Identity authority 與 UPDATE vs DELETE+ADD 的 calibrated decision。
- **哪個概念仍只是名詞：** Universal Semantic Identity ABI、SemanticLineageID、Schema-Function Compatibility Certificate。
- **哪個系統值得讀原始碼：** `qzc438/ontology-versioning`，優先 `generate_dataset_ops.py`、`alignment/`、`ov_run_config.py`。
- **哪篇論文需追引用：** OM4OV、OaK、Episodic-to-Semantic Consolidation Without Identity Drift。
- **哪個概念最適合視覺模擬：** Semantic Identity & Ontology Migration Lab。
- **哪個 Agent 架構最值得實作：**

> **Versioned Semantic Agent Runtime = Encoder Epoch Registry + Semantic Identity Registry + Ontology Version Graph + Drift Attribution Engine + OM4OV-style Migration Classifier + Formal/Behavioral Validator + Ontology Kernel Release + Compatibility Gate**

本輪最大的底層進展可以濃縮成一句：

> **上一輪解決「模型換了，座標系變了怎麼辦」；本輪開始解決更難的問題——「如果概念真的變了，AI 要如何知道是同一個概念演化、概念分裂、概念合併，還是舊概念真的消失」。只有把 representation version、semantic identity、ontology version 與 agent identity 分開治理，長期運作的 Agent OS 才不會把世界的變化、模型的變化與自己的變化混為一談。**
