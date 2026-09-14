# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 18:53（Asia/Taipei）**  
**主題：Field-Level Provenance × Information Flow × Provenance Semirings × Claim-Level Evidence Lineage × Multimodal Taint**

---

## 本小時新發現

本輪承接上一輪的 `Semantic Replay Equivalence × Minimal Sufficient Trace × Causal Responsibility`，不再重複 trace slicing，而是往它真正依賴的底層前提追：**Agent runtime 到底如何產生可信的 field-level dependency graph？**

本輪交叉閱讀了：

- OpenTelemetry Semantic Conventions / GenAI observability：建立跨系統 trace、span、event 與 structured GenAI message/tool telemetry。
- OpenInference 規格與原始碼：已能對 LLM、tool、retrieval、embedding、multimodal message 建立細粒度 span attributes，並支援 image/audio/video message contents。
- Siddiqui et al., *Permissive Information-Flow Analysis for Large Language Models*（TMLR 2025）：提出不要將所有輸入 taint 無條件傳到 LLM output，而只傳真正有 influence 的來源標籤。
- Green, Karvounarakis, Tannen, *Provenance Semirings*（PODS 2007）：提供可組合的 why-provenance algebra，適合成為 Agent provenance expression 的形式底座。
- Liu et al., *Beyond Accuracy: Auditing Spatial Provenance in Visual Token Pruning for OCR-Critical MLLM Inference*（2026）：顯示答案正確不代表視覺 token 還保有可追溯到實際 OCR supporting region 的 spatial provenance。
- Wang et al., *From Agent Traces to Trust: Evidence Tracing and Execution Provenance in LLM Agents*（2026）：將 retrieval、tool、memory、environment observation、claim、action 與 final answer 的 provenance 統一視為 Agent trust layer。
- AgentRaft（2026）與 NeuroTaint（2026）：代表 field-level / semantic information flow 已直接進入 Agent cross-tool privacy、memory persistence、prompt injection 與 tool execution security 問題。

本輪新增的核心命題：

```text
Telemetry
≠ Provenance
≠ Information Flow
≠ Causal Influence
≠ Evidence Support
```

一個 span 能告訴我們「LLM 使用了某段 prompt」，不代表 prompt 每個欄位都影響 output；一條 tool-call trace 能告訴我們「工具被呼叫」，不代表 tool response 的全部欄位都支持 final claim。

---

# 本小時最重要 5 個發現

## 1. Observability trace 是 provenance 的 substrate，不是 provenance 本身

### 已確認事實
OpenTelemetry 將 operation 表示成 span，distinct occurrence 可表示成 event，並用 semantic conventions 統一 attributes。GenAI conventions 可記錄 model、input/output messages、token usage、finish reason、tool calls 等。

OpenInference 再把 Agent/LLM workload 專門化：`LLM`、`EMBEDDING`、`CHAIN`、`TOOL` 等 span kind，以及 `llm.input_messages.*`、`llm.output_messages.*`、`input.value`、`output.value`、retrieval/tool attributes。

OpenInference 的 multimodal 規格甚至已明確表示：

```text
llm.input_messages.0.message.contents.0.message_content.type = text
llm.input_messages.0.message.contents.1.message_content.type = image
llm.input_messages.0.message.contents.2.message_content.type = audio
llm.input_messages.0.message.contents.3.message_content.type = video
```

並支援任意 span kind 的 `input.images.* / output.images.*`。

### 但還缺什麼
它們通常告訴我們：

```text
Span A consumed input X
Span A produced output Y
```

但 Hermes 真正需要：

```text
X.field[3]
→ transformed_by T
→ influenced Y.claim[2]
→ used_by Planner decision D
→ justified ToolCall K
```

所以新節點：

```text
TelemetrySpan
FieldProvenanceEdge
EvidenceSupportEdge
CausalInfluenceEdge
```

四者必須分開。

### 為什麼重要
如果把 telemetry parent-child 關係直接當成 evidence lineage，就會得到大量 false dependencies：整個 100KB tool response 都可能被標成支持 final answer，即使模型實際只使用其中一句。

### 來源
- https://opentelemetry.io/docs/specs/semconv/general/trace/
- https://opentelemetry.io/docs/specs/semconv/general/events/
- https://opentelemetry.io/blog/2026/genai-observability/
- https://arize-ai.github.io/openinference/spec/
- https://github.com/Arize-ai/openinference/blob/main/spec/multimodal_attributes.md

---

## 2. 傳統 taint propagation 對 LLM 太保守：LLM 需要 influence-conditioned label propagation

### 論文結果
Siddiqui et al. 的 *Permissive Information-Flow Analysis for Large Language Models* 指出，傳統 dynamic information-flow 常採：

```text
Output label
=
join(all input labels)
```

例如：

```text
public input
+
confidential memory
+
untrusted web page
↓
LLM
↓
output = CONFIDENTIAL + UNTRUSTED
```

這對 LLM Agent 往往太保守，因為某些 input 根本沒有實際影響 output。

其方向改為：

```text
Inputs
↓
Influence estimation
↓
select influential samples
↓
propagate only their labels
↓
output information-flow label
```

作者探索 prompt-based retrieval augmentation 與 kNN-LM 版本，並報告在 Agent setting 中 permissive propagator 在超過 85% cases 改善 baseline label quality。

### Hermes 推論
這非常適合升級成：

```text
InfluenceAwareTaintPropagator
├ source_field_ids[]
├ candidate_labels[]
├ influence_estimator
├ influence_score{}
├ retained_sources[]
├ dropped_sources[]
└ uncertainty
```

但需明確區分：

```text
Low estimated influence
≠ Proven no causal influence
```

所以任何 dropping 都應附 certificate，而不能直接刪除 provenance。

### 來源
- https://www.microsoft.com/en-us/research/publication/permissive-information-flow-analysis-for-large-language-models/
- https://arxiv.org/abs/2410.03055

---

## 3. Provenance semiring 適合把「多條支持路徑」變成可計算 expression

### 經典機制
Green–Karvounarakis–Tannen 的 provenance semiring 將資料來源標註成 symbol，並利用代數運算追蹤 query output 如何由 inputs 組成。

對 Hermes 可借用直覺：

```text
+
= alternative support / alternative derivation

×
= joint requirement / composition
```

例如 final claim C 同時可由兩條替代 evidence path 支持：

```text
C
=
(SearchA × ExtractA)
+
(SearchB × ExtractB)
```

若 claim 必須同時依賴 vision region R 與 user constraint U：

```text
C
=
R × U
```

這比單純 adjacency list 更有價值，因為它可以表達：

```text
alternative evidence
redundant support
joint support
shared ancestry
```

### Hermes 建議
建立：

```text
ProvenanceExpression
├ source_symbols[]
├ operator: PLUS | TIMES | TRANSFORM
├ expression_tree
├ simplification_rules
├ provenance_version
└ interpretation
```

但必須避免直接宣稱：

```text
Semiring provenance
= Actual causality
```

它更像 derivational provenance；實際 causal responsibility 仍要靠 intervention/replay 驗證。

### 來源
- Green, Karvounarakis, Tannen, Provenance Semirings, PODS 2007
- DOI: 10.1145/1265530.1265535
- https://provsql.org/lean-docs/Provenance.html

---

## 4. Multimodal provenance 不能停在「用了這張圖」；要追 region/token/span ancestry

### 新研究證據
Liu et al. 2026 的視覺 token pruning 研究指出：MLLM 在 OCR-critical task 上，即使 final answer accuracy 幾乎不下降，也可能已經沒有任何 retained token 可局部追溯到實際支持答案的 OCR region。

這建立一個很重要的新 edge：

```text
Correct Answer
≠ Supporting Visual Provenance Preserved
```

以及：

```text
Visual Token Survived
≠ Supporting Region Survived
```

### Hermes 多模態 lineage 應拆成

```text
Raw Image
↓
Region / crop / patch
↓
Vision encoder patch token
↓
Pruning / merging / resampler
↓
Projected multimodal token
↓
Cross/self attention
↓
Generated claim token
↓
Claim
```

Audio：

```text
Waveform
↓
Time span
↓
Acoustic frame
↓
Encoder token
↓
Transcript / semantic token
↓
Claim
```

Video：

```text
Video
↓
Frame interval
↓
Spatial region
↓
Patch/token
↓
Temporal fusion
↓
Claim
```

新增：

```text
MultimodalFieldRef
├ modality
├ artifact_id
├ text_char_range
├ image_bbox
├ audio_time_range
├ video_time_range
├ frame_range
├ patch_ids[]
├ token_ids[]
└ encoder_version
```

### 來源
- https://arxiv.org/abs/2608.00077
- https://github.com/Arize-ai/openinference/blob/main/spec/multimodal_attributes.md

---

## 5. Agent security 的真正 enforcement 單位應逐步從 tool-level 下沉到 field-level data flow

### 新研究方向
AgentRaft（2026）直接針對 cross-tool Data Over-Exposure：建 Function Call Graph、生成觸發 tool chains 的 prompts、runtime taint tracking，再檢查敏感 data 是否超出 functional necessity 傳遞。

NeuroTaint（2026）更指出 LLM Agent 的 taint 不只 explicit copy，還包括：

```text
semantic transformation
causal influence on decisions
cross-session persistence via memory
```

這非常符合 Hermes 現有的：

```text
Memory
Tool
MCP
Planner
Replay
Provenance
```

因此 policy gate 應該能回答：

```text
Which exact source fields
are flowing into
which exact sink fields?
```

例如：

```text
GoogleContact.phone
↓
LLM hidden transformation
↓
email_tool.body
```

即使電話號碼不是 verbatim copy，也可能仍產生 semantic leakage。

所以新 architecture：

```text
Source Field Labels
↓
Runtime Read-Set
↓
LLM Influence Propagator
↓
Derived Field Labels
↓
Tool Argument Builder
↓
Sink Policy Check
↓
ALLOW / REDACT / ASK / BLOCK
```

### 來源
- AgentRaft, arXiv:2603.07557
- NeuroTaint / Ghost in the Agent, arXiv:2604.23374

---

# Architecture Breakdown

本輪提出 Hermes 的 **Field-Level Provenance Runtime**：

```text
User / Camera / Voice / Video / DOM
Memory / Retriever / Tool / MCP
↓
Canonical Input Artifact
↓
Field/Region/Span Segmenter
↓
SourceLabelRegistry
├ privacy
├ trust
├ evidence
├ origin
├ retention
└ permission
↓
Runtime Read/Write Instrumentation
↓
Telemetry Adapter
├ OpenTelemetry
└ OpenInference
↓
Field Dependency Recovery
├ explicit copy
├ structured transformation
├ retrieval selection
├ tool argument mapping
├ memory read/write
├ LLM influence approximation
└ multimodal region/token mapping
↓
Provenance Expression Builder
↓
Information-Flow Label Propagator
↓
Claim-Level Evidence Lineage
↓
Causal Validation / Intervention
↓
Policy Enforcement + TraceSliceCertificate
```

關鍵原則：

```text
Telemetry first
→ Candidate dependency
→ Influence analysis
→ Provenance expression
→ Intervention when needed
→ Certified dependency / support edge
```

不要：

```text
Span parent-child
→ directly label as causal support
```

---

# Bottom-Level Logic

## 1. Field addressing

所有輸入先轉成 canonical field reference：

```text
FieldRef = (
  artifact_id,
  modality,
  selector,
  version
)
```

例：

```text
text://prompt#chars=140:212
json://tool_response#/results/3/title
image://screen23#bbox=0.31,0.22,0.52,0.30
video://clip7#t=12.2:15.4&bbox=...
audio://mic9#t=4.1:6.9
memory://item88#/claim
```

## 2. Runtime dependency edge

```text
FieldDependencyEdge
├ source: FieldRef
├ sink: FieldRef
├ transform_id
├ dependency_type
├ observed_read
├ observed_write
├ influence_score
├ evidence_role
├ taint_labels[]
└ validation_status
```

`dependency_type`：

```text
EXPLICIT_COPY
STRUCTURED_MAP
RETRIEVAL_SELECT
SUMMARIZE
SEMANTIC_TRANSFORM
MODEL_INFLUENCE
ATTENTION_HINT
MEMORY_DERIVATION
TOOL_ARGUMENT_FLOW
MULTIMODAL_FUSION
```

## 3. Label propagation

傳統：

```text
L(output) = ⊔ L(all inputs)
```

Hermes 建議：

```text
I = InfluenceEstimator(inputs, output)

Relevant = {x_i | I_i > threshold}

L(output)
=
⊔_{x_i ∈ Relevant} L(x_i)
```

但 threshold route 必須記錄 uncertainty，必要時 fallback 至 conservative join。

## 4. Claim lineage

```text
Claim
↓
Supporting sentence/chunk
↓
Retrieved document field
↓
Source artifact
```

若來源是 multimodal：

```text
Claim
↓
Generated token range
↓
multimodal token group
↓
vision/audio/video representation
↓
raw region/time span
```

## 5. Provenance expression

```text
Prov(claim)
=
(A × B) + (C × D)
```

代表兩條可替代 derivation。

若進一步做 intervention：

```text
Mask A
Replay descendants
↓
claim survives via C×D
```

則可辨認：A 是 derivational support，但不是單獨 but-for cause。

---

# Visual Simulation Idea

## **Multimodal Provenance Microscope × Taint Flow Lab**

畫面左側：原始 sources

```text
[User Prompt]
[Memory]
[Web Page]
[Tool JSON]
[Image]
[Voice]
```

使用者點 final claim：

```text
「活動時間是 9/24 18:00」
```

畫面自動反向高亮：

```text
Final claim chars 12–25
        ↑
Planner synthesis field
        ↑
MemoryItem#41.schedule.start
        ↑
DriveDoc#8 paragraph 17 chars 22–37
```

若 claim 來自圖片 OCR：

```text
Final Claim
↑
OCR token "18:00"
↑
vision token #831
↑
image bbox (x1,y1,x2,y2)
```

並顯示四種 overlay：

```text
BLUE   = telemetry dependency
YELLOW = inferred semantic influence
GREEN  = evidence support
RED    = sensitive taint
```

使用者可以點：

```text
MASK THIS FIELD
```

Hermes 只 replay descendants：

```text
claim changed      YES
planner changed    YES
tool call changed  NO
permission changed NO
```

再切換：

```text
Conservative taint
vs
Influence-aware taint
```

直接看到資料 exposure 差異。

這個 simulator 能把：

```text
「AI 看了哪些資料」
```

提升成：

```text
「AI 的哪一個輸出欄位，實際依賴哪一個來源欄位／影像區域／聲音時間片？」
```

---

# Code / GitHub

## 1. Arize-ai/openinference

Repository：
https://github.com/Arize-ai/openinference

值得閱讀：

```text
spec/semantic_conventions.md
spec/multimodal_attributes.md
spec/llm_spans.md
python/
js/
java/
go/
```

本輪原始碼 / spec 重點：

- `spec/multimodal_attributes.md` 已正式定義 text/image/audio/video message parts。
- multimodal items 可保持 message content ordering。
- non-LLM span 可用 `input.images` / `output.images`。
- image 可 externalize 為 content-addressed URI。
- redaction / hide-input / size limit 已納入 instrumentation。

### Hermes 可直接借用

```text
OpenInference span attributes
↓
Hermes FieldRef adapter
↓
Provenance runtime
```

而不是重新發明完整 GenAI telemetry schema。

## 2. OpenTelemetry

Repository / specs：
https://github.com/open-telemetry/semantic-conventions
https://opentelemetry.io/docs/specs/semconv/

用途：

```text
cross-process context propagation
span/event lifecycle
trace correlation
resource identity
```

Hermes 應將 OTel 當 transport/observability substrate，再加自己的 provenance extension。

## 3. 下一輪值得實際追原始碼

- OpenInference instrumentors：找 LLM/tool/retriever attributes 在 provider adapters 實際如何產生。
- AgentRaft（若官方 code release 可得）：特別追 runtime taint data structures 與 field mapping。
- 可部署 dynamic taint engines：研究哪些能低成本整合 Python/JS Agent runtime。
- ProvSQL / provenance semiring implementations：研究 provenance expression simplification 與 query。

---

# Papers

## A. Permissive Information-Flow Analysis for Large Language Models

- **Authors**: Shoaib Ahmed Siddiqui, Radhika Gaonkar, Boris Köpf, David Krueger, Andrew Paverd, Ahmed Salem, Shruti Tople, Lukas Wutschitz, Menglin Xia, Santiago Zanella-Béguelin
- **Institution**: Microsoft Research and collaborators
- **Year**: TMLR 2025（arXiv 2024）
- **URL**: https://arxiv.org/abs/2410.03055
- **Architecture**: LLM influence-aware dynamic information-flow label propagation
- **Contribution**: 只傳 influential samples 的 labels，而非把所有 input labels 全部 join
- **Limitations**: influence estimator 並非 causal proof；效果依 retrieval / model setup 而異
- **改變了什麼**: 將 LLM taint tracking 從「最大保守」推向「基於實際 influence 的 permissive flow」

## B. Provenance Semirings

- **Authors**: Todd J. Green, Grigoris Karvounarakis, Val Tannen
- **Institution**: University of Pennsylvania 等
- **Year**: 2007
- **DOI**: 10.1145/1265530.1265535
- **Architecture**: semiring-annotated relational provenance
- **Contribution**: 用統一代數表示多種 provenance semantics
- **Limitations**: derivational provenance，不直接等於 Agent actual causality
- **改變了什麼**: 給 Hermes 一個能表達 alternative / joint support 的 provenance algebra

## C. Beyond Accuracy: Auditing Spatial Provenance in Visual Token Pruning for OCR-Critical MLLM Inference

- **Authors**: Feixiang Liu, Qiang Qiu, Hao Zhang, Xinyue Wang
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2608.00077
- **Models**: Qwen3-VL-8B, LLaVA-1.5-7B, InternVL3.5-8B 等
- **Architecture**: visual token pruning + spatial provenance audit + intervention
- **Contribution**: 顯示 accuracy/compression 之外還需追 surviving supporting-region provenance
- **Limitations**: OCR-critical visual setting，不等於一般 multimodal causal attribution
- **改變了什麼**: 將「視覺 token provenance」升級為與 accuracy 並列的 audit dimension

## D. From Agent Traces to Trust: Evidence Tracing and Execution Provenance in LLM Agents

- **Authors**: Yiqi Wang et al.
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2606.04990
- **Architecture**: conceptual framework / survey for evidence tracing and execution provenance
- **Contribution**: 統一 retrieval grounding、claim support、tool safety、memory lineage、audit、recovery
- **Limitations**: survey / framework，本身不是 production runtime
- **改變了什麼**: 提供 Hermes Knowledge Graph 的 provenance taxonomy 骨架

## E. AgentRaft: Automated Detection of Data Over-Exposure in LLM Agents

- **Authors**: Yixi Lin, Jiangrong Wu, Yuhong Nan, Xueqiang Wang, Xinyuan Zhang, Zibin Zheng
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2603.07557
- **Architecture**: Cross-Tool Function Call Graph → prompt synthesis → runtime taint → multi-LLM policy judgment
- **Dataset/Scale**: 6,675 real-world agent tools（paper report）
- **Contribution**: field-level cross-tool data exposure detection
- **Limitations**: policy judgment仍依賴 LLM/benchmark setting；taint semantics需持續驗證
- **改變了什麼**: 將 Agent taint tracking直接連到 tool argument privacy enforcement

---

# Unknown / Open Questions

## 1. LLM 內部 field dependency 能不能真正可靠 recover？

目前可用方法包括：

```text
retrieval overlap
prompt perturbation
leave-one-out intervention
attention
gradient/influence
kNN attribution
model introspection
counterfactual replay
```

但沒有任何一個可直接等價成 universal causal dependency oracle。

## 2. Multimodal fusion 後 provenance 如何保持？

image/audio/video 經：

```text
encoder
→ resampler
→ projection
→ token merge/prune
→ transformer fusion
```

來源 identity 會逐步混合。需要研究：

```text
hard ancestry
soft contribution matrix
spatial support mask
causal intervention
```

應如何共同表示。

## 3. Provenance expression 如何避免爆炸？

如果每個 output token 都存完整 polynomial lineage，長 Agent run 可能指數膨脹。需要：

```text
hash-consing
DAG sharing
canonical simplification
summary nodes
retention policy
query-driven materialization
```

---

# 下一輪研究

下一輪應進入：

# **LLM Influence Estimation × Multimodal Token Attribution × Intervention-Calibrated Provenance × Provenance Compression**

具體拆：

```text
Prompt / Memory / Tool Fields
↓
Candidate field dependencies
↓
Attention / gradient / retrieval / perturbation estimators
↓
Counterfactual calibration
↓
Influence confidence
↓
Field lineage graph
↓
Provenance expression compression
↓
Claim/effect certificate
```

重點比較：

```text
Attention attribution
vs
Gradient attribution
vs
Occlusion / leave-one-out
vs
Retrieval provenance
vs
Counterfactual replay
```

回答：

> 哪一種 estimator 適合 production runtime？哪一些只能當 hint？哪些能作為 safety enforcement 的依據？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
FieldRef
MultimodalFieldRef
FieldDependencyEdge
Telemetry Dependency
Evidence Support Edge
Causal Influence Edge
SourceLabelRegistry
InfluenceAwareTaintPropagator
NaturalLanguageTaint
Semantic Taint
Memory-Persistent Taint
Cross-Tool Taint
Claim-Level Evidence Lineage
Spatial Provenance
Temporal Audio Provenance
Video Region-Time Provenance
ProvenanceExpression
Provenance Semiring
Alternative Support
Joint Support
Influence Certificate
Field Provenance Adapter
```

## Edges

```text
Telemetry
≠ Provenance

Provenance
≠ Causal Influence

Evidence Support
≠ Information Flow

Span Parent
≠ Field Dependency

Tool Response Consumed
≠ Every Response Field Influenced Output

LLM Input Label
≠ Automatically Output Label

Influential Input
→ May Propagate Information-Flow Label

Correct Multimodal Answer
≠ Supporting Spatial Provenance Preserved

Visual Token Retained
≠ Supporting Image Region Retained

Semantic Transformation
→ Can Preserve Sensitive Taint

Memory Write
→ Can Persist Taint Across Sessions

Provenance Semiring
→ Represents Alternative / Joint Derivations

Provenance Semiring
≠ Actual Causality
```

---

# 本輪結束判定

**缺哪一層：** `LLM / Multimodal Field Dependency Recovery Layer`。  
**哪個節點最淺：** `NaturalLanguageTaint`、`MultimodalFieldTaint`、`InfluenceCertificate`、`VideoRegionTimeProvenance`。  
**哪個概念仍只是名詞：** production-grade `Causally Certified LLM Field Dependency`；目前多數方法仍只是 influence approximation。  
**哪個系統值得讀原始碼：** `Arize-ai/openinference` instrumentors，其次 AgentRaft code release（若可取得），再往 dynamic taint engine。  
**哪篇論文需追引用：** *Permissive Information-Flow Analysis for LLMs*，其次 2026 spatial provenance audit 與 AgentRaft。  
**哪個概念最適合視覺模擬：** `Multimodal Provenance Microscope × Taint Flow Lab`。  
**哪個 Agent 架構最值得實作：**

```text
OpenTelemetry / OpenInference
↓
FieldRef Adapter
↓
Runtime Read/Write Instrumentation
↓
Influence-Aware Taint
↓
Claim-Level Provenance
↓
Counterfactual Validation
↓
Field-Level Permission Gate
```

---

# 對「AI 到底怎麼運作」新增的一層

上一輪我們已能從 final outcome 反向切出候選 trace；本輪補上真正產生這張 trace graph 的底層機制：**AI 每次讀 prompt、memory、retrieval chunk、tool JSON、DOM、image、voice 或 video 時，都應該把資料切成可定位的 field / region / time span，再記錄哪些欄位被讀取、如何被轉換、哪些 labels 隨 influence 傳播，以及最後哪個 claim / tool argument / permission decision真正依賴它。**

因此完整鏈開始變成：

```text
User / Camera / Voice / Video
↓
Raw Artifact
↓
Field / Region / Time-Span Identity
↓
Encoder / Retriever / Memory / Tool
↓
LLM Multimodal Fusion
↓
Influence + Information Flow
↓
Planner / Action
↓
Tool / MCP
↓
Claim / Side Effect
↓
Field-Level Provenance
↓
Counterfactual Validation
```

這一層是從「AI 有 trace」走到「AI 能精確回答：我的這一句話、這個 tool argument、這個決策，到底是從哪一個來源欄位、哪一個影像區域、哪一段聲音而來」的關鍵。