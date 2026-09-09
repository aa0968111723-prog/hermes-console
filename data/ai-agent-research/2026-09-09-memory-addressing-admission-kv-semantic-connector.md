# 【AI Agent × Multimodal Research Report】

時間：2026-09-09 12:53（Asia/Taipei）

## 本輪定位

本輪接續：

- `2026-09-09-dynamic-visual-memory-kv-reactivation-reobservation.md`
- `2026-09-09-kv-position-rebinding-cache-splicing-context-surgery.md`
- `2026-09-08-cross-attention-memory-topology.md`

上一輪已確認：把歷史 KV 重新插回 self-attention 不是單純 memcpy，而需要 identity、residency、position、mask 與 freshness 一致性；更早一輪也已研究 Flamingo-style separate cross-attention memory。

因此本輪刻意避免重複「cross-attention topology」，轉向更底層且目前知識圖譜仍缺失的一層：

# Memory Addressing × Admission × Connector Semantics

核心問題不是「Agent 有沒有記憶」，而是：

1. 一份 memory 到底用什麼 address 找到？
2. Exact KV cache lookup 與 semantic memory retrieval 是否其實是兩種完全不同的 addressing system？
3. Memory 命中後是否應直接進模型，還是必須再經 admission / trust gate？
4. External memory connector 的最小 ABI 應該攜帶哪些 metadata，才能安全支援 Agent、VLM 與 production inference？

本輪 system architecture：**LMCache multi-tier KV memory + MemGate semantic memory admission**。

本輪 bottom-level mechanism：**prefix/content-address hashing vs embedding similarity + query-conditioned gating**。

---

# 本小時新發現

## 1. 「Memory Retrieval」其實包含至少兩種完全不同的 address space

第一類是 **exact / content-addressed execution memory**。

LMCache/vLLM 類 KV cache 的 lookup 不是問：

> 哪一段歷史和現在語意最像？

而是問：

> 這段 token prefix 對應的、與目前 model/runtime metadata 相容的 KV block 是否已經算過？

底層可寫成：

```text
Token IDs
↓
Chunking
↓
Prefix Hash Chain
↓
CacheEngineKey
├ model_name
├ world_size / worker identity semantics
├ chunk_hash
├ kv_dtype
└ request config metadata
↓
Exact Cache Lookup
↓
KV Hit / Miss
```

LMCache `TokenDatabase` 原始碼明確把 input tokens 轉成 cache engine keys；`ChunkedTokenDatabase` 以 prefix hash 處理 token chunks，而 `CacheEngineKey` 會包含 model、world size/worker、chunk hash、KV dtype 與 request configs。原始碼也特別處理分散式 hashing 一致性，甚至警告 builtin hash 若未固定 `PYTHONHASHSEED`，不同 process 可能產生不一致 key。

來源：
- https://github.com/LMCache/LMCache/blob/dev/lmcache/v1/token_database.py
- https://docs.lmcache.ai/v0.3.7/developer_guide/architecture.html

這是一種：

```text
Execution Address Space
```

而不是 semantic search。

第二類則是 **semantic / episodic memory address space**：

```text
Query
↓
Embedding
↓
Vector Search
↓
Similarity
↓
Top-K memories
```

所以 Knowledge Graph 必須正式區分：

```text
Memory Addressing
├ Exact Prefix Addressing
├ Content-addressed Block Lookup
├ Semantic Similarity Addressing
├ Symbolic / Graph Addressing
└ Agent-directed Hierarchical Addressing
```

關鍵結論：

> KV cache 命中與 RAG memory 命中雖然都叫「cache/retrieval」，但它們的 address function、correctness condition、failure mode 與 trust semantics 完全不同。

---

## 2. Exact cache correctness 的核心不是「相關」，而是「可重用等價性」

Semantic retrieval 允許：

```text
query != memory text
```

只要 embedding proximity 足夠高。

但 KV reuse 要求的不是 similarity，而是更接近：

```text
same effective prefix computation
+
compatible model/runtime state
```

LMCache source 中 `_make_key_by_hash()` 會將 chunk hash 與 model/runtime metadata 組成 `CacheEngineKey`；其 multimodal cache-key design 也明確指出 key schema 必須擴充 per-chunk `extra_keys`，避免 multimodal inputs 在只看 text token IDs 時出現錯誤 collision / reuse。

來源：
- https://github.com/LMCache/LMCache/blob/dev/lmcache/v1/token_database.py
- https://github.com/LMCache/LMCache/blob/dev/docs/design/integration/vllm/multimodal_cache_keying.md

因此對 Multimodal Agent：

```text
same textual placeholder tokens
≠
same visual evidence
```

如果：

```text
<image>
```

在兩次 request 都佔相同 placeholder token，但 image bytes / vision hash 不同，單看文字 prefix 不能安全 reuse 對應 KV。

所以 Exact Memory 的 correctness predicate 應包含：

```text
ReuseCompatible(memory, request) =
  ModelCompatible
∧ TokenPrefixCompatible
∧ ModalityIdentityCompatible
∧ PositionCompatible
∧ KVLayoutCompatible
∧ PrecisionCompatible
```

這是從 production cache source 推導出的工程模型。

---

## 3. Semantic similarity 不是 memory admission 的充分條件

2026 年 **Beyond Similarity: Trustworthy Memory Search for Personal AI Agents** 將 long-term memory 明確視為一個 trust boundary。

其核心問題：

```text
semantically related
≠
contextually appropriate
≠
safe to influence action
```

論文測試 A-Mem、Mem0、MemOS 與具 persistent state/tool use 的 agent environment，指出 similarity-driven memory 可能造成 cross-domain leakage、sycophancy、tool-call drift、memory-induced jailbreak 等問題。

MemGate 的核心 topology：

```text
User Query
↓
Query Embedding q

Vector Store
↓
Candidate Memory v

Intent / task state z
↓
Query-conditioned Gate
↓
Admit / attenuate memory
↓
Backbone LLM
```

論文：
- Title: Beyond Similarity: Trustworthy Memory Search for Personal AI Agents
- Authors: Jiawen Zhang, Kejia Chen, Jiachen Ma, Yangfan Hu, Lipeng He, Yechao Zhang, Jian Liu, Xiaohu Yang, Tianwei Zhang, Ruoxi Jia
- Year: 2026
- URL: https://arxiv.org/abs/2606.06054
- Code: https://github.com/Kevin-Zh-CS/MemGate
- Benchmarks / settings: representative long-term-memory frameworks + persistent-agent settings described by the paper
- Contribution: inserts a lightweight query-conditioned admission layer between retrieved memory and the LLM
- Limitation: published threat/utility results apply to its evaluated memory frameworks and benchmarks; not a universal guarantee for all agents

---

## 4. MemGate 原始碼證實 admission 不是單一 cosine threshold，而是 feature-wise bilateral gating

本輪直接讀 `Kevin-Zh-CS/MemGate/memgate/big_module.py`。

核心 `BIGGateNetwork` 的輸入不是只有 similarity score，而是：

```text
q
v
q ⊙ v
z_intent
```

concatenate 後：

```text
[q ⊕ v ⊕ (q⊙v) ⊕ z_iota]
↓
Linear
↓
LayerNorm
↓
SiLU
↓
Linear
↓
SiLU
↓
Dropout
↓
Linear
↓
Sigmoid
↓
g ∈ [0,1]^d
```

也就是 gate 是 **embedding dimension-wise** 的，不只是：

```text
if cosine > 0.8: keep
```

原始碼註解直接寫：

```text
Input = [q ⊕ v ⊕ (q⊙v) ⊕ z_iota]
Output = g ∈ [0,1]^d
```

另外 repository 的 intent path 會先把 request 分進 safe/system-override/harmful/benign-personal 等類別，再映射為 dense intent representation。

來源：
- https://github.com/Kevin-Zh-CS/MemGate/blob/main/memgate/big_module.py

因此 semantic memory pipeline 應從：

```text
Query
→ Similarity Search
→ Top-K
→ Context Injection
```

升級為：

```text
Query
→ Candidate Generation
→ Relevance
→ Intent Compatibility
→ Trust / Domain Compatibility
→ Freshness
→ Admission Gate
→ Context Injection
```

這與前幾輪建立的 `Visual Evidence Freshness` 可以統一到同一個更一般的概念：

```text
Evidence Admission
```

---

## 5. Production KV connector 與 Agent semantic-memory connector 應分成 control plane / data plane

LMCache architecture 已是實際的 multi-tier KV memory system：

```text
GPU
↓
CPU DRAM / pinned memory
↓
Local Disk / NVMe
↓
Remote Store
```

它的 operations 包含：

```text
lookup
store
retrieve
```

而 NVIDIA Dynamo 的 production disaggregated serving 更進一步把：

```text
KV storage/offload
```

與：

```text
Prefill → Decode KV transfer
```

拆成不同 connector/transport。Dynamo FlexKV 文件指出，在 disaggregated serving 中 prefill worker 可以用 `PdConnector` 包裝 `FlexKVConnectorV1` 與 `NixlConnector`：前者處理 offload/onboard，後者負責 P/D KV transfer。

來源：
- https://docs.nvidia.com/dynamo/v1.1.0/integrations/flex-kv
- https://docs.nvidia.com/dynamo/dev/knowledge-base/concepts/system-architecture/disaggregated-serving
- https://docs.nvidia.com/dynamo/v1.2.1/backends/v-llm/kv-cache-offloading

這揭示一個重要系統原則：

```text
Memory Location
≠
Memory Identity
≠
Memory Transport
≠
Memory Admission
```

所以 Hermes 的 External Memory Connector 不應設計成單一：

```text
memory.get(query)
```

而更合理是拆成：

```text
Memory Control Plane
├ resolve address
├ validate identity
├ check freshness
├ authorize access
├ score/admit evidence
└ choose restore path

Memory Data Plane
├ transfer bytes / tensors
├ decode representation
├ place GPU block
├ append context
├ cross-attention read
└ residual injection
```

此架構是本輪基於 LMCache/Dynamo/MemGate 的工程綜合，不是現有統一標準。

---

# 本小時最重要 5 個發現

## 發現 1 — Exact KV memory 與 semantic Agent memory 是兩個不同 address space

### 是什麼

KV：prefix/content exact address。

Semantic memory：embedding/symbolic/agent-directed address。

### 底層如何運作

```text
KV:
Tokens → chunk → prefix hash → CacheEngineKey → exact hit

Semantic:
Query → embedding → ANN search → candidate memories
```

### 為什麼重要

若把兩者統一成抽象的 `retrieve()`，很容易忽略 correctness condition：KV 錯誤 reuse 會破壞模型計算；semantic memory 錯誤 admission 則會污染 reasoning / action。

### 限制

實際 CacheEngineKey 欄位、hash algorithm、cache layouts 會隨 vLLM/LMCache version 改變。

### 來源

LMCache source + architecture docs。

---

## 發現 2 — Multimodal KV key 必須包含 modality identity

### 是什麼

同一組 text placeholder 不能代表同一張 image/video。

### 底層如何運作

```text
text prefix hash
+
multimodal extra key / modality hash
↓
cache identity
```

### 為什麼重要

否則可能把 A 圖片 prefill 的視覺計算誤 reuse 到 B 圖片。

### 限制

不同 serving engines 的 multimodal cache keying 還沒有單一標準 ABI。

### 來源

LMCache multimodal cache-key design。

---

## 發現 3 — Similarity Search 只能產生 candidate，不能自動等於 memory truth/admission

### 底層如何運作

```text
ANN Top-K
↓
Candidate Set
↓
Context / Intent / Domain / Trust Gate
↓
Admitted Evidence
```

### 為什麼重要

Agent memory 是 durable control channel；被寫入過的 memory 可持續改變之後的 tool selection、planning 與 personalization。

### 限制

MemGate 是特定設計；需要更多跨 framework / multilingual / multimodal validation。

### 來源

MemGate paper + code。

---

## 發現 4 — Admission 本身可以是 learned differentiable function

### 底層如何運作

```text
q, v, q⊙v, intent
↓
MLP
↓
Sigmoid gate vector
↓
gated memory representation
```

### 為什麼重要

它讓「memory 是否能影響當前 decision」成為 runtime 可觀察、可訓練、可測量的一層。

### 限制

learned gate 本身也可能 distribution shift，也需要 audit/logging/fallback policy。

### 來源

MemGate `BIGGateNetwork` source。

---

## 發現 5 — Memory connector 應拆成 identity/control plane 與 transport/data plane

### 底層如何運作

```text
resolve
→ validate
→ authorize
→ admit
→ choose representation
→ transfer
→ inject/read
```

### 為什麼重要

KV offload、P/D transfer、semantic retrieval、visual evidence recall、re-observation 都可放在同一 memory runtime，而不必混成單一 cache function。

### 限制

Hermes Memory Connector ABI 是工程推論，目前沒有跨 vLLM/SGLang/agent frameworks 的統一規範。

### 來源

LMCache + NVIDIA Dynamo + MemGate。

---

# Architecture Breakdown

## A. Execution Memory / KV Address Space

```text
Prompt / Multimodal Input
↓
Tokenizer / Processor
↓
Token IDs + modality identity
↓
Chunker
↓
Prefix Hash Chain
↓
Cache Key Builder
├ model revision
├ kv dtype
├ layout
├ chunk hash
├ modality extra keys
└ request compatibility metadata
↓
KV Index
↓
Location Resolver
├ GPU
├ CPU
├ NVMe
└ Remote
↓
Transfer
↓
GPU KV Residency
↓
Attention
```

Correctness target：**computational reuse equivalence**。

---

## B. Semantic / Episodic Memory Address Space

```text
Agent Query / Current State
↓
Query Representation
↓
Candidate Generator
├ Vector ANN
├ Keyword
├ Graph
├ Hierarchical Tree
└ Agent-directed search
↓
Candidates
↓
Admission Pipeline
├ relevance
├ domain compatibility
├ intent compatibility
├ provenance
├ trust
├ freshness
└ permission
↓
Admitted Evidence
↓
Injection Policy
├ Prompt Context
├ Memory Tokens
├ Cross-Attention
├ Residual Injection
└ Tool/Planner State
↓
Reasoning / Action
```

Correctness target：**decision-useful and contextually valid evidence**。

---

## C. Unified Hermes Memory Runtime

```text
Reasoning Step t
↓
Memory Demand
↓
Address Classifier
├ EXACT_EXECUTION
├ SEMANTIC_EPISODIC
├ STRUCTURED_GRAPH
├ VISUAL_EVIDENCE
└ LIVE_REOBSERVE
↓
Resolver
↓
Candidate / Exact Match
↓
Compatibility Validator
↓
Freshness Validator
↓
Authorization
↓
Admission Gate
↓
Representation Router
├ KV
├ Embedding
├ Text
├ Graph substructure
├ Visual latent
└ Raw observation
↓
Transport / Materialization
↓
Injection Path
↓
Model / Agent State
```

---

# Bottom-Level Logic

## 1. Prefix hash chain

設 token chunks：

```text
C1, C2, C3 ...
```

概念上：

```text
H0 = NONE_HASH
H1 = Hash(H0, C1)
H2 = Hash(H1, C2)
H3 = Hash(H2, C3)
```

所以 chunk 3 的 address 不只依賴 `C3`，也依賴其 prefix history。

這種結構非常適合 prefix cache：

```text
A B C D
A B C E
```

可以共享前面已計算 prefix blocks。

但這和 semantic vector：

```text
cos(E(query), E(memory))
```

沒有等價關係。

---

## 2. Query-conditioned memory gate

MemGate source 的核心可抽象為：

```text
q = query embedding
v = candidate memory embedding
z = intent embedding

x = concat(q, v, q⊙v, z)

g = sigmoid(MLP(x))
```

然後 memory influence 可視為：

```text
v' = g ⊙ v
```

或由 downstream module 使用 gate score/representation 做 admission。

這使：

```text
retrieved
```

與：

```text
allowed to influence model
```

成為兩個不同 event。

---

## 3. Address vs Location

```text
Address
= 我在找哪一份 memory？

Location
= 那份 memory 現在在哪裡？
```

例如：

```text
CacheEngineKey = K
```

可能映射到：

```text
K → GPU Block 192
```

也可能：

```text
K → CPU pinned buffer
```

或：

```text
K → remote LMCache/FlexKV backend
```

因此 routing 應分成：

```text
Identity Resolution
↓
Placement Resolution
↓
Transport Planning
```

---

# Code / GitHub

## 1. LMCache

Repository:
https://github.com/LMCache/LMCache

值得持續讀的目錄 / 核心檔案：

```text
lmcache/v1/token_database.py
→ token chunking / prefix hash / CacheEngineKey

lmcache/v1/storage_backend/storage_manager.py
→ storage backend orchestration

lmcache/v1/distributed/storage_manager.py
→ distributed storage manager

docs/design/integration/vllm/multimodal_cache_keying.md
→ multimodal cache identity design

docs/design/v1/hidden_state_store.md
→ hidden-state caching direction

docs/design/sdk/context.md
→ retrieve/edit/store style cache context API
```

已確認原始碼重點：
- token → chunks → cache engine keys
- prefix hash
- distributed hash consistency concerns
- model/KV dtype metadata included in key construction
- multimodal cache key需要 extra identity semantics

---

## 2. MemGate

Repository:
https://github.com/Kevin-Zh-CS/MemGate

目錄：

```text
memgate/
└ big_module.py

PS-Bench/
PersistBench/
benchmarks/
examples/
scripts/
```

核心檔案：

```text
memgate/big_module.py
```

已確認原始碼：

```text
IntentEncoder
BIGGateNetwork
```

`BIGGateNetwork`：

```text
[q, v, q⊙v, z_iota]
→ MLP
→ Sigmoid
→ feature-wise gate
```

---

## 3. NVIDIA Dynamo / KV serving

Documentation:
- https://docs.nvidia.com/dynamo/dev/knowledge-base/concepts/system-architecture/disaggregated-serving
- https://docs.nvidia.com/dynamo/v1.2.1/backends/v-llm/kv-cache-offloading
- https://docs.nvidia.com/dynamo/v1.1.0/integrations/flex-kv

值得持續追：

```text
PrefillRouter
KV-aware routing
KVBM
FlexKVConnectorV1
NixlConnector
PdConnector
```

核心 system lesson：

```text
KV indexing
≠ storage/offload
≠ P/D transport
≠ request routing
```

---

# Papers

## Paper 1 — Beyond Similarity: Trustworthy Memory Search for Personal AI Agents

- Authors: Jiawen Zhang, Kejia Chen, Jiachen Ma, Yangfan Hu, Lipeng He, Yechao Zhang, Jian Liu, Xiaohu Yang, Tianwei Zhang, Ruoxi Jia
- Year: 2026
- URL: https://arxiv.org/abs/2606.06054
- Code: https://github.com/Kevin-Zh-CS/MemGate
- Architecture: Vector Memory → MemGate → Backbone LLM
- Contribution: 將 semantic memory retrieval 視為 trust boundary；以 query-conditioned neural admission gate 降低 memory-induced threats
- Limitations: empirical scope 受 benchmark/framework/model selection 限制；gate 仍需面對 distribution shift
- 改變了什麼：把「Top-K retrieval」從 memory pipeline 的終點改成 candidate stage，正式增加 admission stage。

## Paper 2 — ByteRover: Agent-Native Memory Through LLM-Curated Hierarchical Context

- Authors: Andy Nguyen et al.
- Year: 2026
- URL: https://arxiv.org/abs/2604.01599
- Architecture: Agent-curated hierarchical Context Tree + progressive retrieval
- Contribution: 不依賴外部 vector/graph DB，以同一 agent/LLM curate hierarchy、provenance、lifecycle 並分層 retrieval
- Benchmark: LoCoMo, LongMemEval
- Limitations: results belong to its implementation/task setup；LLM-curated memory 仍會承擔 model-generated structural errors
- 改變了什麼：指出 semantic vector address 並非 agent memory 唯一 address model；hierarchical symbolic paths 也是可行 memory namespace。

## Paper 3 — Memory-Orchestrated Semantic System (MOSS): An Auditable Agentic Memory Architecture

- Authors: Serge Lacasse, Jérémie Hatier, Alex Baker
- Year: 2026
- URL: https://arxiv.org/abs/2607.04391
- Architecture: relational / semantic memory with agent-driven query formulation and deterministic retrieval execution
- Contribution: 強調可 audit、可重現的 symbolic retrieval 與長期 sovereign memory
- Limitations: reported deployment is unusual and valuable but does not automatically establish universal benchmark superiority
- 改變了什麼：進一步證明 Agent memory address space 不能只建模成 embedding vector space。

---

# Visual Simulation Idea

# Memory Address Space & Admission Lab

主畫面分成兩條完全不同的 memory lane。

## Lane A — Exact KV Address

```text
Prompt:
"Analyze document A ..."

Token IDs
↓
[chunk 0]
[chunk 1]
[chunk 2]
↓
Prefix Hash
↓
CacheEngineKey
↓
Index
↓
GPU / CPU / NVMe / Remote
```

UI 顯示：

```text
Key identity        MATCH
Model revision      MATCH
KV dtype            MATCH
Multimodal hash     MATCH
Position semantics  MATCH
Cache location      CPU
Transfer latency    2.4 ms
RESULT              EXACT REUSE ALLOWED
```

故意換圖片：

```text
Text placeholder    SAME
Image hash          DIFFERENT

RESULT:
CACHE REUSE DENIED
```

---

## Lane B — Semantic Memory Address

```text
Query
↓
Embedding
↓
Vector Space
↓
Top-K
```

顯示候選：

```text
Memory A similarity .92
Memory B similarity .87
Memory C similarity .81
```

然後經：

```text
Intent Compatibility
Domain Compatibility
Freshness
Permission
Provenance
MemGate
```

最後可能變成：

```text
A similarity .92 → REJECT
原因：cross-domain / unsafe influence

B similarity .87 → ADMIT

C similarity .81 → ATTENUATE
```

讓使用者直接理解：

> Most Similar ≠ Most Appropriate Memory

---

## Unified Connector Inspector

每一筆 memory card 顯示：

```text
memory_id
address_type
content_hash
embedding_id
model_revision
modality_hash
observation_version
world_state_version
provenance
owner / scope
freshness
trust
representation_type
storage_tier
transport
admission_score
```

並可切：

```text
EXACT ADDRESS
SEMANTIC ADDRESS
GRAPH ADDRESS
HIERARCHICAL ADDRESS
LIVE OBSERVATION
```

最後動畫：

```text
ADDRESS
→ RESOLVE
→ VALIDATE
→ AUTHORIZE
→ ADMIT
→ MATERIALIZE
→ INJECT
→ USE
```

這會把「AI 記憶」從一個抽象腦袋圖示，變成真正可觀察的 runtime pipeline。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Memory Address Space
├ Exact Prefix Address
├ Content Address
├ Semantic Vector Address
├ Hierarchical Address
├ Graph Address
└ Observation Address
```

```text
Memory Admission Runtime
├ Candidate Memory
├ Relevance Score
├ Intent Compatibility
├ Domain Compatibility
├ Freshness
├ Provenance
├ Permission
├ Trust Score
├ Admission Gate
└ Admitted Evidence
```

```text
Memory Connector Runtime
├ Identity Resolver
├ Placement Resolver
├ Compatibility Validator
├ Admission Controller
├ Representation Router
├ Transport Planner
├ Materializer
└ Injection Adapter
```

```text
Execution Memory Identity
├ Token Prefix Hash
├ Model Revision
├ KV DType
├ KV Layout
├ Modality Identity
├ Position Semantics
└ Request Config Identity
```

## Edges

```text
Token Prefix
→ hashes into
Execution Memory Address

Execution Memory Address
→ resolves to
KV Location

Semantic Query
→ retrieves
Candidate Memory

Similarity
→ proposes
Candidate Memory

Candidate Memory
→ passes through
Admission Gate

Admission Gate
→ controls
Memory Influence

Multimodal Input Identity
→ constrains
KV Reuse

Memory Identity
≠
Memory Location

Memory Location
→ determines
Transport Path

Transport Path
→ materializes
Representation

Admitted Evidence
→ enters
Context / Cross-Attention / Residual / Planner
```

---

# 已確認事實 / 工程實作 / 推論 / 假說

## 已確認事實

1. LMCache 將 token chunks 轉成 prefix-hash based cache engine keys，並包含 model/KV runtime metadata。
2. LMCache 是 multi-tier KV storage architecture，可跨 GPU/CPU/local/remote store。
3. Dynamo disaggregated serving 將 KV offload 與 P/D transfer 拆成可組合 connector/transport。
4. MemGate 將 query、candidate memory、interaction term 與 intent representation 送入 feature-wise sigmoid gate。
5. MemGate paper 將 memory search 明確定義為 persistent-agent trust boundary。

## 工程實作觀察

1. Exact cache address 的核心是 reuse compatibility，不是 semantic relevance。
2. Semantic memory search 的 Top-K 更合理地視為 candidate generation，而非最終 context admission。
3. Memory identity、placement、transport、admission 應拆成不同 runtime layers。

## 合理推論

Hermes 應建立統一 `MemoryEvidenceEnvelope`，至少帶：

```text
id
address_type
representation_type
source/provenance
model_revision
modality_identity
observation/world version
freshness
permission scope
trust/admission metadata
storage location
```

## 尚未驗證假說

可否建立跨：

```text
vLLM KVConnector
LMCache
SGLang HiCache
Agent vector memory
Graph memory
Visual evidence memory
```

的單一兩段式 ABI：

```text
resolve() / admit()
+
materialize() / inject()
```

目前沒有證據顯示已有這樣的產業標準。

---

# Unknown / Open Questions

## 1. Semantic memory 是否應該也有 content-address identity？

目前很多 Agent memory 只保存：

```text
text + embedding + metadata
```

但若需要可靠 audit / dedup / provenance，是否應像 execution cache 一樣額外保留 immutable content hash？

## 2. Memory Admission 應該發生在哪一層？

可能是：

```text
retrieval 前
retrieval 後
context compilation 時
model layer 內
工具執行前
```

不同層可能需要不同 trust gate。

## 3. Multimodal semantic memory 的 address function 怎麼設計？

```text
Text embedding
Image embedding
OCR
Object graph
Spatial relation
Temporal state
```

是共用一個 embedding space，還是 mixture-of-index / router？目前仍是知識圖譜的明顯缺口。

---

# 與歷史研究比較

已存在：

```text
Cross-Attention Memory Topology
→ memory 怎麼被 decoder read

Dynamic Visual Memory
→ evidence 如何 hot/warm/cold/reactivate

KV Position Rebinding
→ dormant KV 如何重新接回 self-attention
```

本輪新增：

```text
Memory Addressing
→ 如何找到正確 memory

Memory Admission
→ 找到後是否允許影響目前 decision

Memory Connector Semantics
→ identity/location/transport/injection 如何分層
```

因此不是重複 memory topology，而是補上：

```text
FIND
↓
VERIFY
↓
ADMIT
↓
MATERIALIZE
↓
INJECT
```

這段此前最淺。

---

# 下一輪研究

下一輪最值得研究：

# Multimodal Semantic Memory × Joint Embedding Index × Spatial/Temporal Retrieval × Memory Write Policy

原因是目前已拆清楚：

```text
Exact KV
→ prefix/content address

Text episodic memory
→ semantic/symbolic address
```

但 Multimodal Agent 的歷史 observation 包含：

```text
Screenshot
Video clip
Audio
OCR
Coordinates
Object relationships
Action history
```

下一輪要回答：

```text
「我三分鐘前看過的那個紅色 Submit 按鈕」
```

到底應該如何 address？

預計拆：

```text
Observation
↓
Multimodal Memory Writer
├ raw media
├ visual embedding
├ OCR text
├ object graph
├ spatial coordinates
├ temporal index
├ action-parent edge
└ world-state version
↓
Multi-index Memory
↓
Query Router
├ semantic
├ spatial
├ temporal
├ entity
└ causal/action history
↓
Candidate Fusion
↓
Admission
↓
Evidence Reconstruction
```

並比較：
- multimodal vector DB / CLIP-like joint embedding
- ColPali / late-interaction document retrieval 類方法
- video memory / episodic embodied-agent memory
- graph + vector hybrid retrieval
- write-time memory consolidation / dedup / forgetting

---

# 本輪結束回答

**缺哪一層：** Multimodal episodic memory 的 joint address / multi-index retrieval layer。

**哪個節點最淺：** `Memory Admission Policy` 在 multimodal / tool-action context 下仍很淺。

**哪個概念仍只是名詞：** `Unified Memory Connector ABI`。

**哪個系統值得讀原始碼：** LMCache `TokenDatabase + StorageManager`、MemGate `BIGGateNetwork`；下一輪應追 multimodal retrieval index implementations。

**哪篇論文需追引用：** `Beyond Similarity: Trustworthy Memory Search for Personal AI Agents`，因為它把 memory 從 utility layer 改成 durable control/trust channel。

**哪個概念最適合視覺模擬：** `Memory Address Space & Admission Lab`。

**哪個 Agent 架構最值得實作：** `Admission-Gated Multimodal Memory Agent`。

---

# 本輪核心結論

> AI 的「記憶」不能再被畫成一個單一資料庫。至少存在兩套完全不同的 addressing logic：KV execution memory 追求的是 exact computational reuse，semantic/episodic memory 追求的是 task-relevant evidence。前者需要 identity/compatibility，後者需要 relevance 之外的 trust、freshness、domain 與 intent admission。更完整的 Agent Memory Runtime 應該把 Address → Resolve → Validate → Authorize → Admit → Materialize → Inject 分成明確階段；只有如此，才能同時理解 production KV cache、RAG、長期個人記憶、視覺 evidence 與下一步 Agent action 之間到底如何連接。
