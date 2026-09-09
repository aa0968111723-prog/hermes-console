# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 15:53（Asia/Taipei）**  
**本輪主題：Cross-Modal Entity Resolution × Canonical Entity Graph × Identity Repair × Object-Centric World Model**

> 研究定位：本輪接續上一輪「Detection ID → Track ID → Persistent Entity」的缺口，不再重複 MOT/ByteTrack/SAM2，而是研究 Tracklet、視覺身份、文字/語音名稱、3D object、工具/DOM 局部 ID 如何被對齊成可長期維護的 canonical entity，以及錯誤綁定後如何 repair。

---

## 一、本小時新發現

### 1. 新系統：ReflectWorld-MM（2026）把記憶單位從 frame 改成 persistent entity

ReflectWorld-MM 明確指出，將長影片記憶組織成 frame/token/flat feature store，會削弱「同一個人/物跨不連續時間再次出現」的辨識能力。它的三層架構是：

```text
Open-ended audiovisual stream
↓
Perception front-end
↓
Entity-resolved observations
↓
Hierarchical long-term memory
├ Multi-scale episodic memory
├ Evolving entity-centric semantic memory
└ Procedural memory
↓
Assistant / reasoning
```

論文：ReflectWorld-MM: An Entity-Oriented Multimodal Memory System for Open-Ended Video Streams  
Authors: Xiaokang Ma, Yifan Sun, Zhihong Jin, Jie Gu, Yudong Luo, Shenyi Shao, Chu Tang, Jingmin Chen, Li Pu  
Year: 2026  
URL: https://arxiv.org/abs/2607.09759  
Code: https://github.com/addxai/ReflectWorld

**已確認事實 / 論文結果：** 論文報告在六個 long-video / lifelong-memory benchmarks 上均取得該實驗設定中的最佳結果。  
**限制：** 這不能直接證明其 identity resolver 對所有物體類型、跨攝影機、跨 app/tool namespace 都可靠；公開工程實作目前對 person ReID / identity safety 的支援尤其具體。

### 2. 新 architecture connection：ConceptGraphs 提供「2D observation → canonical 3D object node」的跨視角路徑

ConceptGraphs 將 posed RGB-D sequence 中的 instance regions 投影到 3D，再用 multi-view association 將不同 frame/view 的 observation 漸進融合成 object-centric nodes：

```text
2D Instance Region
↓
Semantic feature + geometry
↓
Project into 3D
↓
Spatial similarity
+
Visual similarity
↓
Association
↓
Merge observation into existing 3D object
or
Create new object node
↓
3D Scene Graph
```

Paper: ConceptGraphs: Open-Vocabulary 3D Scene Graphs for Perception and Planning  
Authors: Qiao Gu et al.  
Institutions: MIT, Université de Montréal, University of Toronto, JHU/JHU APL, UMass Amherst, DEVCOM ARL 等  
Year: ICRA 2024 (arXiv 2023)  
URL: https://arxiv.org/abs/2309.16650  
Code: https://github.com/concept-graphs/concept-graphs  
Dataset / environments: 包含 Replica 等場景評估與機器人實驗  
Contribution: open-vocabulary, object-centric 3D scene graph；把多視角觀測由 point/feature representation 提升到 persistent object graph。  
Limitations: 依賴 pose/RGB-D 與 association quality；object merge error 會污染後續 graph。

### 3. 新 entity-linking bridge：KGMEL 顯示「視覺+文字 mention → KB canonical entity」不應只靠 image/text cosine

KGMEL 將 multimodal entity linking 拆成：

```text
Mention text + image
↓
VLM generates structured triples
↓
Joint mention/entity representation
↓
Candidate retrieval
↓
KG-aware reranking
↓
Canonical KB Entity
```

Paper: KGMEL: Knowledge Graph-Enhanced Multimodal Entity Linking  
Authors: Juyeon Kim, Geon Lee, Taeuk Kim, Kijung Shin  
Institutions: KAIST / Hanyang University  
Year: SIGIR 2025  
URL: https://arxiv.org/abs/2504.15135  
Code: https://github.com/juyeonnn/KGMEL  
Datasets: WikiMEL, WikiDiverse, RichpediaMEL  
Architecture: Generation → Retrieval → Reranking  
Contribution: 將 KG triples 納入 multimodal entity linking，而不是只做 visual/text embedding matching。  
Limitations: 主要是已知 KB entity linking，不等於 open-world physical object persistence。

### 4. ReflectWorld 原始碼含真正的 Identity Write Safety，而不只是 ReID matching

值得看的核心檔案：

```text
packages/percept/src/
├ identity-resolver.ts
├ did-registry.ts
├ working-memory.ts
├ semantic-context.ts
├ face-reid-policy.ts
├ anonymous-matcher.ts
├ analyzers/
│  ├ adaface.ts
│  ├ clip-reid.ts
│  ├ body-reid-entry.ts
│  ├ face-body-associator.ts
│  ├ reid-accumulator.ts
│  └ unified-reid-matcher.ts
└ pipeline/
   ├ reid.ts
   ├ subjects.ts
   └ runtime.ts
```

`identity-resolver.ts` 的工程行為特別重要：

- Stable binding key 被明確分成 `target:<id>`、`entity:<id>`、`track:<id>`。
- Identity name evidence 不是一律接受，而是依來源分成 `confirmed / hint / reject`。
- visible nameplate / visible text / self-introduction 等證據才可在條件成立時持久化。
- inherited working-memory match 不足以單獨把名字永久綁進 stable entity。
- 同一 binding scope 出現多個名字，或同一名字同時對應多個互不相交 scope，會被判為 conflict，禁止寫入長期身份。
- resolver 將「可顯示」與「可寫入 stable ReID/entity」分離，存在 `identity_write_safe`、`visual_identity_only`、`reid_unsafe_reason` 等概念。

這是一個重要底層規律：

```text
VLM says same person
≠
Safe to mutate canonical identity
```

### 5. Identity 必須是可修正圖，而不是 immutable label

綜合 MOT、ReflectWorld、ConceptGraphs、KGMEL，本輪建立 Hermes 工程模型：

```text
Local Observation ID
↓
Association Hypothesis
↓
Canonical Entity Candidate
↓
Evidence accumulation
↓
Commit / keep ambiguous / create new
↓
Canonical Entity Graph
```

錯誤不可用 destructive overwrite 解決，而應保留 provenance：

```text
ATTACH_ALIAS
MERGE_ENTITY
SPLIT_ENTITY
REBIND_ALIAS
SUPERSEDE_FACT
RETRACT_EDGE
REOPEN_IDENTITY
```

**合理工程推論：** entity identity 應視為 versioned belief graph，而不是單一 UUID + mutable name。

---

## 二、本小時最重要 5 個發現

### Finding 1 — Local ID 不是世界身份

**概念：Scoped Identity**

任何來源 ID 都要附 namespace / scope / version：

```text
LocalRef = {
  adapter,
  session_or_scene,
  document_or_world_version,
  local_id
}
```

例如：

```text
VisionTrack: camera_1/track_81
DOM: page_version_44/node_238
Tool: inventory/item_0042
3D: map_v12/object_97
Voice: segment_991/speaker_2
```

它們都不是天然 global ID。

**底層原因：** tracker 可能換 track ID；DOM reload 後 node ID 失效；3D map 重建會產生新 object IDs；ASR speaker diarization ID 只在單段/session 有意義。

**重要性：** 若 Agent 直接把局部 ID 當 canonical identity，跨 session / reload / occlusion 後會產生 identity corruption。

**限制：** 不同 adapter 的 scope semantics 尚無統一標準。

---

### Finding 2 — Cross-modal entity resolution 是 heterogeneous evidence fusion，不是單一 cosine

**Hermes 統一工程抽象（非某篇論文固定公式）：**

```text
Score(obs, entity) =
  w_v   · visual_reid
+ w_txt · text/coreference
+ w_sp  · spatial/3D consistency
+ w_t   · temporal feasibility
+ w_act · action/causal continuity
+ w_kb  · KG compatibility
+ w_src · source trust
- conflict penalties
```

然後：

```text
Candidates
↓
Calibrated score / posterior
↓
if high confidence + no conflict → ATTACH
if ambiguous → HYPOTHESIZED_SAME_AS
if incompatible → CREATE_NEW
```

**交叉驗證：** ConceptGraphs 實際同時使用 spatial 與 visual similarities 做 multi-view association；KGMEL 則證明結構化 KG evidence 可改善 multimodal mention/entity matching。

**限制：** 異質 score calibration 是 open problem；cosine、IoU、time distance、LLM score 不在同一 probability space。

---

### Finding 3 — Identity write path 必須比 read/display path 更保守

ReflectWorld 原始碼呈現一個非常值得 Hermes 採用的原則：

```text
Display hypothesis
≠
Persist identity
```

可以允許 UI 暫時顯示：

```text
「可能是 Alex」
```

但長期 memory write 必須有更強 gate：

```text
Identity claim
↓
Evidence source check
↓
Current-segment anchor
↓
Binding-scope consistency
↓
Conflict check
↓
WRITE_SAFE ?
```

**重要性：** 一次 VLM hallucination 若寫入 canonical entity，會沿 episodic memory、semantic memory、future retrieval 擴散。

**限制：** 現有 resolver policy 仍偏 domain/task specific。

---

### Finding 4 — Canonical Entity Graph 應保留 alias provenance

不應：

```text
track81 → cup_42
然後把 track81 消掉
```

更合理：

```text
CanonicalEntity cup_42
├ observed_as → track81 @ camera1, t1-t2
├ observed_as → track12 @ camera2, t8-t9
├ referred_as → "我的紅色杯子"
├ tool_ref → inventory:item_0042
├ spatial_ref → map_v12:obj97
└ kb_ref → product SKU / external entity (若有)
```

每條 edge 保存：

```text
source
confidence
valid_from
valid_until
evidence_id
resolver_version
```

這使 identity repair 成為「改邊」而不是「重寫歷史」。

---

### Finding 5 — Identity Repair 是 world-model correctness 的必要 primitive

三個典型 failure：

```text
False Merge:
Alice + Bob → person_7

Fragmentation:
cup_track12 + cup_track81
其實同一物體

Stale Binding:
DOM node_238 reload 後
已不是原本 Submit button
```

修復操作：

```text
FALSE MERGE
→ SPLIT entity_7
→ repartition aliases / episodes / facts

FRAGMENTATION
→ MERGE entity_12 + entity_81
→ preserve old aliases

STALE BINDING
→ expire old local ref
→ REBIND to current scoped ref
```

**尚未驗證假說：** 將 merge/split/rebind 做成 Agent runtime primitive，可能比讓 LLM直接修改 memory documents 更可審計、更安全。

---

## 三、Architecture Breakdown

```text
Camera / Screen / Voice / Text / 3D / Tools
↓
Modality Adapters
├ Vision detector / tracker
├ Face / body ReID
├ OCR
├ ASR + speaker diarization
├ Text coreference / NER
├ DOM / Accessibility adapter
├ Tool resource adapter
└ 3D scene mapper
↓
Scoped Local References
├ track_id
├ speaker_id
├ mention_id
├ dom_node_id
├ resource_id
└ map_object_id
↓
Observation Normalizer
├ time
├ source
├ coordinates
├ appearance
├ semantic labels
├ actions
└ provenance
↓
Candidate Generator
├ semantic retrieval
├ spatial neighborhood
├ temporal window
├ visual ReID
├ graph neighbors
└ exact external IDs
↓
Cross-Modal Entity Resolver
├ visual similarity
├ text/coreference
├ spatial consistency
├ temporal feasibility
├ action continuity
├ KG compatibility
└ trust / provenance
↓
Identity Safety Gate
├ conflict detection
├ current evidence anchor
├ write-safe policy
└ ambiguity threshold
↓
Identity Operation
├ ATTACH_ALIAS
├ CREATE_ENTITY
├ KEEP_AMBIGUOUS
├ MERGE_ENTITY
├ SPLIT_ENTITY
├ REBIND_ALIAS
└ RETRACT / SUPERSEDE
↓
Canonical Entity Graph
↓
Entity Timeline + Episodic Memory
↓
World Belief
↓
Reasoning / Planning
↓
Tool or Physical Action
↓
New Observation
```

### System Architecture 深拆：ReflectWorld-MM

```text
Stream
↓
perception front-end
↓
Detection / ReID / VLM analysis
↓
Working Memory
↓
identity resolver
├ track/entity/target scopes
├ ReID evidence
├ name evidence
├ binding conflict gate
└ write safety
↓
entity-resolved observations
↓
Long-term Memory
├ episodic
├ entity semantic
└ procedural
↓
assistant integration
```

它與上一輪 ByteTrack 的差異：

```text
ByteTrack
Detection → Track continuity

ReflectWorld-MM
Observation / ReID / semantic claims
→ Identity persistence safety
→ Long-term entity memory
```

它與 ConceptGraphs 的差異：

```text
ConceptGraphs
multi-view geometry + visual features
→ persistent 3D object node

ReflectWorld-MM
video/person ReID + working/semantic memory
→ persistent entity identity
```

兩者互補，正好構成 Hermes 的「physical canonical entity」底層。

---

## 四、Bottom-Level Logic

### 4.1 Candidate Generation

```text
Observation o
↓
retrieve candidate entities C(o)
by:
- visual embedding ANN
- spatial radius / 3D overlap
- temporal continuity
- name/coreference
- tool exact ID
- entity graph neighbors
```

### 4.2 Evidence Matrix

```text
                E1       E2       NEW
visual          .91      .73       -
spatial         .88      .12       -
temporal        .95      .61       -
text/name       .40      .92       -
action          .87      .22       -
conflict        .00      .65       -
```

不是把所有值直接平均，而是經 task/source-specific calibration。

### 4.3 Decision State

```text
P(E1 | evidence) > τ_attach
AND no hard conflict
→ attach alias to E1

max score < τ_new
→ create new entity

scores close / contradictory
→ keep ambiguous hypotheses
```

### 4.4 Identity Repair

應保留 reversible journal：

```text
IdentityOp#938
operation: MERGE
entities: [E12, E81]
result: E42
reason: cross-view ReID + 3D consistency
confidence: .94
provenance: [obs17, obs88, map5]
```

若後續出現矛盾：

```text
IdentityOp#1021
operation: SPLIT
parent: E42
children: [E42a, E42b]
reassign:
  aliases [...]
  episodes [...]
  facts [...]
```

**工程推論：** Identity operations 應 event-sourced，才能 audit / rollback / replay。

---

## 五、Visual Simulation Idea

# Canonical Entity Resolver & Identity Repair Lab

畫面左側放來源：

```text
CAMERA
track_81  [red cup]

TEXT
"我的紅色杯子"

VOICE
speaker says: "把我的杯子拿來"

3D MAP
obj_97 @ kitchen table

TOOL
inventory:item_0042

DOM
product_row_18
```

中央顯示 Candidate Matrix：

```text
                  cup_0042   cup_0091   NEW
Visual ReID          .91        .74
Spatial              .95        .21
Temporal             .82        .67
Language             .89        .71
Tool exact           1.00        0
Conflict              0         .55
────────────────────────────────────
Posterior             .97        .34    .08
```

使用者可手動改變：

```text
camera angle
occlusion
same-looking duplicate
name evidence
DOM reload
map rebuild
time gap
wrong VLM name
```

右側 canonical graph 即時變化：

```text
               Canonical Entity
                   cup_0042
              /       |       \
        track81    obj97    "my cup"
           |                     |
      camera#1               voice#44
```

再按下模擬錯誤：

```text
FORCE FALSE MERGE
```

系統顯示：

```text
IDENTITY CONFLICT DETECTED

Two simultaneous observations
cannot be same physical entity.

→ SPLIT SUGGESTED
```

並動畫展示 episodes / facts 如何重新分配。

這會讓使用者真正理解：

> AI 所謂「知道這是同一個人/物」其實不是名字比對，而是多來源 evidence 在時間中持續建構、驗證與修復的一張身份圖。

---

## 六、Code / GitHub

### ReflectWorld（本輪最值得讀）

Repo: https://github.com/addxai/ReflectWorld

```text
packages/percept/src/identity-resolver.ts
```
- 約 80KB，identity resolution / write safety 核心。
- `GalleryCandidate` 同時保存 `did / entity_id / embedding / quality / pose / trust`。
- `identityBindingKeys()` 把 stable scope 拆成 target/entity/track。
- `classifyTargetIdentityNamePersistence()` 將身份名稱證據分 confirmed/hint/reject。
- `resolveNameIdentityBindings()` 檢查一對多、多對一 name/scope conflict。
- `resolveNameIdentityScope()` 避免 secondary/ambiguous bbox 錯綁 event-local target。

其他核心：

```text
packages/percept/src/did-registry.ts
packages/percept/src/working-memory.ts
packages/percept/src/semantic-context.ts
packages/percept/src/face-reid-policy.ts
packages/percept/src/anonymous-matcher.ts
packages/percept/src/analyzers/reid-accumulator.ts
packages/percept/src/analyzers/face-body-associator.ts
packages/percept/src/analyzers/adaface.ts
packages/percept/src/analyzers/clip-reid.ts
packages/percept/src/pipeline/reid.ts
packages/percept/src/pipeline/subjects.ts
```

### ConceptGraphs

Repo: https://github.com/concept-graphs/concept-graphs

值得看：

```text
conceptgraph/slam/mapping.py
conceptgraph/slam/utils.py
conceptgraph/slam/streamlined_mapping.py
```

`mapping.py` 會分別計算 spatial similarity 與 visual similarity；matched observation 之後交由 `merge_obj2_into_obj1()` 把新 detection 融入既有 object。這是一個非常直接的 observation→persistent-object merge implementation。

### KGMEL

Repo: https://github.com/juyeonnn/KGMEL

```text
module/
├ generate.py
├ retrieve.py
└ rerank.py

utils/
├ encoder.py
├ embedding_processor.py
├ triple_filtering.py
└ triple_parser.py
```

值得用來研究「跨模態 mention → canonical knowledge entity」的 candidate generation / retrieval / reranking 分層。

---

## 七、Papers

### ReflectWorld-MM: An Entity-Oriented Multimodal Memory System for Open-Ended Video Streams
- Authors: Xiaokang Ma et al.
- Institution: 論文作者跨機構合作；公開報導列有 Rightly Robotics、中科院大學杭州高等研究院、浙江大學等，正式引用時應以論文 PDF affiliation 為準。
- Year: 2026
- URL: https://arxiv.org/abs/2607.09759
- Code: https://github.com/addxai/ReflectWorld
- Architecture: perception front-end → entity-resolved observations → hierarchical episodic/entity-semantic/procedural memory.
- Contribution: entity-oriented memory for unbounded/open-ended video.
- Limitations: identity resolution/generalization to arbitrary object/tool/web scopes still needs independent evaluation.
- 改變了什麼：把 long-video memory 的 primary key 從 frame/time 推向 persistent entity。

### ConceptGraphs: Open-Vocabulary 3D Scene Graphs for Perception and Planning
- Authors: Qiao Gu et al.
- Institutions: MIT, Université de Montréal, University of Toronto, JHU, UMass Amherst, DEVCOM ARL 等
- Year: ICRA 2024
- URL: https://arxiv.org/abs/2309.16650
- Code: https://github.com/concept-graphs/concept-graphs
- Dataset/Environment: Replica + robotic experiments
- Architecture: RGB-D instances → semantic/geometry features → multi-view association → object-centric 3D graph.
- Contribution: open-vocabulary persistent object representation + relations for planning.
- Limitations: association / pose / geometry errors can create bad merges.
- 改變了什麼：從 dense point-centric map 提升成 object-centric semantic world graph。

### KGMEL: Knowledge Graph-Enhanced Multimodal Entity Linking
- Authors: Juyeon Kim, Geon Lee, Taeuk Kim, Kijung Shin
- Institutions: KAIST / Hanyang University
- Year: SIGIR 2025
- URL: https://arxiv.org/abs/2504.15135
- Code: https://github.com/juyeonnn/KGMEL
- Datasets: WikiMEL, WikiDiverse, RichpediaMEL
- Architecture: triple generation → contrastive candidate retrieval → LLM reranking.
- Contribution: KG structure becomes direct evidence for multimodal entity linking.
- Limitations: closed KB candidates; not equivalent to open-world object permanence.
- 改變了什麼：entity linking 從 image/text matching 擴充到 structured graph evidence matching。

---

## 八、Unknown / Open Questions

### Q1. Multi-modal score 怎麼校準成可比較的 identity confidence？

```text
CLIP cosine .87
IoU .61
3D distance 0.14m
LLM confidence .92
speaker similarity .77
```

這些不是同一統計空間。需要 calibration / probabilistic fusion / learned gating，而不是任意 weighted sum。

### Q2. False merge 之後，semantic memory 要如何完整「拆帳」？

如果兩個人曾錯誤合成一個 entity：

```text
facts
names
episodes
preferences
relationships
tool permissions
```

哪些屬於 A、哪些屬於 B？Identity split 不只是 graph node split，而是 provenance-based memory repartition。

### Q3. Web / tool / physical world 是否能共享 canonical entity ABI？

例如：

```text
screen product card
↔ DOM node
↔ Shopify product ID
↔ warehouse SKU
↔ physical package
```

它們可能是「representation of」、「instance of」、「same product model」，不一定是 `same_as`。需要 richer identity relation ontology。

---

## 九、Knowledge Graph 新增 Node / Edge

### Nodes

```text
Cross-Modal Entity Resolver
Scoped Local Reference
Canonical Entity
Identity Hypothesis
Identity Confidence
Identity Safety Gate
Identity Operation Journal
Alias Provenance
Name Evidence
Visual ReID Evidence
Spatial Identity Evidence
Temporal Identity Evidence
Causal Identity Evidence
Tool Resource Identity
DOM Identity
3D Object Identity
Identity Merge
Identity Split
Identity Rebind
Identity Retraction
World Object Graph
```

### Edges

```text
Detection / Track
→ observed_as
Canonical Entity

Text Mention
→ refers_to
Canonical Entity

Voice Mention
→ refers_to
Canonical Entity

DOM Node
→ represents
Canonical Entity

Tool Resource
→ references
Canonical Entity

3D Object Node
→ spatial_representation_of
Canonical Entity

Local Reference
→ scoped_by
Session / World Version

Identity Evidence
→ supports
Identity Hypothesis

Identity Conflict
→ blocks
Persistent Write

Alias
→ carries
Provenance

False Merge
→ repaired_by
Identity Split

Fragmentation
→ repaired_by
Identity Merge

Stale Local ID
→ repaired_by
Identity Rebind

Canonical Entity
→ owns
Entity Timeline / Episodes / Beliefs
```

重要 ontology 修正：

```text
same_as
≠ represents
≠ instance_of
≠ refers_to
≠ observed_as
```

這是避免跨 tool / UI / physical object 被錯誤 merge 的關鍵。

---

## 十、下一輪研究

下一輪最自然的缺口：

# Object-Centric World Model × Relation Persistence × Scene Graph Update × Causal State Transition

因為 Canonical Entity 解決「誰/什麼是同一個」，下一步要回答：

```text
Entity A
↓ relation
Entity B

杯子 on 桌子
人 holding 杯子
按鈕 belongs_to form
商品 represented_by DOM card
```

當 Action 發生時：

```text
cup ON table
↓ robot_pick(cup)
cup HELD_BY robot
↓ robot_place(cup,shelf)
cup ON shelf
```

要研究：

```text
Entity Graph
↓
Relation Observation
↓
Relation Association
↓
State Transition
↓
Validity Interval
↓
Conflict / Belief Revision
↓
Causal World Model
```

並比較 dynamic scene graph、3D scene graph、object-centric world model、event/state graph、robotic belief state，以及 browser/DOM state transition。

---

## 十一、本輪結束盤點

- **缺哪一層：** Canonical Entity → persistent relation/state transition。
- **哪個節點最淺：** Identity Split 後的 provenance-based memory repartition。
- **哪個概念仍只是名詞：** Unified Canonical Entity ABI / cross-domain identity ontology。
- **哪個系統最值得讀原始碼：** ReflectWorld `packages/percept/src/identity-resolver.ts`，其次 ConceptGraphs `conceptgraph/slam/mapping.py`。
- **哪篇論文需追引用：** ReflectWorld-MM（2026），因為它直接把 entity persistence 接到 lifelong multimodal memory；ConceptGraphs 用於追 object-centric 3D identity lineage。
- **哪個概念最適合視覺模擬：** Canonical Entity Resolver & Identity Repair Lab。
- **哪個 Agent 架構最值得實作：** **Versioned Canonical Entity Graph + Conservative Identity Write Gate + Merge/Split/Rebind Repair Agent**。

---

## 核心結論

> AI 真正「知道兩次看到的是同一個人/物」，不能只靠 tracker ID，也不能只靠 embedding cosine。完整流程必須是 Local Observation → Scoped Reference → Candidate Generation → Heterogeneous Evidence Fusion → Identity Safety Gate → Canonical Entity → Versioned Alias/Provenance Graph；而且 identity 必須允許 merge、split、rebind、retract。只有把身份視為可驗證、可修復的 belief graph，Multimodal Agent 才能把 Vision、Voice、Text、DOM、Tool、3D World 與 Episodic Memory 接到同一個穩定世界模型。