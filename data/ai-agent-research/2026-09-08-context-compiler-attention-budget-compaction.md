# 【AI Agent × Multimodal Research Report】

時間：2026-09-08 22:50（Asia/Taipei）

主題：Context Engineering × Context Compiler × Attention Budget × Compaction × LLM-visible Context

歷史比較：本輪接續上一輪「Authorization IR × Policy Engine × Enforcement」。前一輪解決 action proposal 在真正執行前如何被形式化、授權與攔截；本輪轉向整條 AI Agent OS 中仍較淺的 `UI → Agent → Context → Model` 區段，專注研究「哪些資訊真正進入模型、如何被排序與壓縮、何時被丟棄、與 runtime/session state 如何分離」。不重複先前 Memory/RAG 的一般定義，而是建立可驗證的 Context Compiler 與 Attention Budget 模型。

---

## 本小時新發現

1. OpenAI Agents SDK 明確區分 `RunContext`（應用程式本地 runtime state）與 LLM-visible conversation context；模型真正可見的資訊必須被放進 instructions/input，或透過 tools/retrieval 在需要時取得。Session 又是另一層持久 conversation state。這證明「Agent state」「conversation history」「model-visible context」不能混成同一個 memory。
2. OpenAI Agents SDK 的 `OpenAIResponsesCompactionSession` 原始碼範例顯示 compaction 只是 decorator：底層 session 仍負責 history persistence，compaction 可獨立決定何時觸發。也就是 `storage ≠ selection ≠ compaction`。
3. Anthropic 將 context engineering 定義成有限 token 資源的配置問題，而非單純 prompt wording；官方長任務策略包含 compaction、structured note-taking、multi-agent，而最新 managed-agent 工程文又特別提醒 session 不等於 context window，過度不可逆壓縮可能使未來所需資訊永久遺失。
4. 2025–2026 研究開始把 context management 從 heuristic 提升成可學習/可呼叫 runtime：ACON 同時壓縮 observation 與 interaction history；CAT 把 context management 本身變成 agent 可呼叫 tool；HyMem 則將 planning context、execution context、isolated reasoning 拆層。
5. 1M-token model 並沒有消除 context engineering。OpenAI GPT-6 Astra / GPT-5.6 Terra 與 Anthropic Opus/Sonnet 4.6 都已提供約 1M token context，但官方仍保留 compaction、context management 或長上下文價格分段；這說明可放入 ≠ 應全部放入。

---

# 本小時最重要 5 個發現

## 1. Model-visible Context 只是 Agent State 的投影，不是 Agent State 本身

### 是什麼
一個可靠 Agent 應至少分出：

```text
Runtime State
├ Task DAG
├ Permissions
├ Transactions
├ Verification
├ Tool handles
└ Local variables

Persistent State
├ Session history
├ Long-term memory
├ Files / notes
├ Knowledge graph
└ Event log

LLM-visible Context
├ Instructions
├ Current user input
├ Selected history
├ Retrieved memory
├ Tool schemas
├ Relevant observations
└ Compacted summaries
```

OpenAI Agents SDK 官方 Context Management 明確說明：`RunContext` 是目前 run 的 local application state；conversation state 是另一個問題，而 LLM 只能看到真正被送入 conversation history 的內容。額外資訊需要放進 instructions/input，或透過 function tools / retrieval 按需取得。

### 為什麼重要
如果 Hermes 把所有 runtime state 直接序列化到 prompt：
- token 成本暴增；
- prompt injection surface 變大；
- stale state 會污染推理；
- model 會被迫重新推理 deterministic runtime facts。

因此應新增核心 edge：

```text
Agent State
--compiled into-->
LLM-visible Context
```

而不是：

```text
Agent State
=
Context Window
```

### 確認層級
- 官方資訊：OpenAI Agents SDK Context Management / Sessions。
- 工程推論：Hermes 應建立 explicit Context Compiler，而不是將 session dump 直接拼接進 prompt。

來源：
- https://openai.github.io/openai-agents-js/guides/context/
- https://openai.github.io/openai-agents-js/guides/sessions/

---

## 2. Storage、Retrieval、Selection、Compaction 是四個不同機制

### OpenAI Agents SDK 原始碼驗證

值得看的檔案：

```text
openai/openai-agents-js
├ packages/agents-core/src/sandbox/capabilities/compaction.ts
├ packages/agents-core/src/runStateLegacyCompaction.ts
├ examples/memory/oai-compact.ts
├ examples/docs/sessions/responsesCompactionSession.ts
└ .agents/references/conversation-state-ownership.md
```

`examples/memory/oai-compact.ts` 明確建立：

```ts
new OpenAIResponsesCompactionSession({
  underlyingSession: new FileSession(),
  shouldTriggerCompaction: (...)
})
```

程式註解直接指出：

```text
compaction decorator
→ handles compaction only

underlying session
→ stores history
```

因此應拆：

```text
Storage
= 所有原始資訊放在哪裡

Retrieval
= 從 storage 找哪些候選資料

Selection
= 這次 model call 真正選哪些候選

Compaction
= 如何把高 token 資料轉成低 token 表示
```

這四者若混在一起，就無法回答「某資訊到底是沒存、沒找到、被排除，還是被壓縮掉」。

### Hermes Failure Taxonomy 新增

```text
Context Failure
├ Storage Loss
├ Retrieval Miss
├ Selection Miss
├ Priority Error
├ Compression Loss
├ Truncation Loss
├ Stale Context
└ Context Pollution
```

來源：
- https://github.com/openai/openai-agents-js/blob/main/examples/memory/oai-compact.ts
- https://openai.github.io/openai-agents-js/guides/sessions/

---

## 3. Context Compiler 的核心不是「塞滿 token」，而是做 Utility-per-Token Optimization

Anthropic 將 context engineering 描述為：有限 context token 下，最佳化哪些 token 最能產生期望行為；即使 context window 很大，仍會遇到 context pollution / relevance 問題。

因此 Hermes Context Compiler 可以形式化為：

```text
Candidates C = {c1 ... cn}

每個 ci:
- token_cost(ci)
- relevance(ci)
- authority(ci)
- freshness(ci)
- evidence_value(ci)
- dependency(ci)
- security_risk(ci)
- compression_loss(ci)
```

在 budget B 下：

```text
maximize Σ utility(ci)
subject to Σ token_cost(ci) <= B
```

但實務上不只是 knapsack，因為 context 有順序、instruction hierarchy、dependency 與不可刪除條件。

更合理是：

```text
Hard Constraints
├ system/developer instructions
├ current user goal
├ required tool schema
├ unresolved transaction state
└ mandatory evidence

Soft Candidates
├ old conversation
├ retrieved memory
├ tool outputs
├ previous observations
└ background docs
```

先固定 hard constraints，再對 soft candidates 做 ranking / compression。

### 新增概念

```text
Context Utility Score
≈ relevance
× freshness
× authority
× expected future usefulness
÷ token cost
```

這是工程模型，不是已被單一論文證明的 universal formula。

來源：
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

---

## 4. Compaction 是有損編碼，不等於 Memory

Anthropic 官方 compaction 做法是：history 接近 context limit 時，用模型總結重要內容，再在新 context window 中繼續；Claude Code 會保留架構決策、未解 bug、實作資訊，丟棄重複 tool output / message。

但 2026 managed-agent 工程文特別提醒：任何選擇性保留/丟棄都是不可逆決策，未來哪個 token 會重要通常事前無法完全知道。

因此：

```text
Raw History
↓
Compactor
↓
Summary
```

本質上是：

```text
high-dimensional trace
→ lossy semantic representation
```

不能把 summary 當作原始 memory 的等價替代。

Hermes 應採：

```text
Raw Event Store   ← durable / recoverable
        ↓
Compacted Context ← temporary model-facing projection
```

而不是 compaction 後刪掉唯一原始證據。

### 研究交叉驗證

ACON（2025）針對 long-horizon agent 同時壓縮 environment observations 與 interaction histories，在 AppWorld、OfficeBench、Multi-objective QA 的實驗中報告 peak-token memory 降低 26–54%，且大致維持 task performance。這是特定 benchmark 結果，不代表任何壓縮器都能安全壓縮 50%。

CAT（2025）則把 context maintenance 變成 agent 可主動呼叫的 tool，而不是被動等 token 超限才壓縮。

來源：
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://www.anthropic.com/engineering/managed-agents
- https://arxiv.org/abs/2510.00615
- https://arxiv.org/abs/2512.22087

---

## 5. 長 Context Window 解決容量，不解 Context Scheduling

### 已確認事實
2026 現行 frontier model 已出現約 1M token context：
- OpenAI GPT-6 Astra：1,050,000 context window。
- OpenAI GPT-5.6 Terra：1,050,000 context window。
- Anthropic Claude Opus 4.6 / Sonnet 4.6：1M context beta。

但：
- OpenAI 對超過 272K input 的部分模型採更高費率；
- Anthropic Opus 4.6 仍提供 automatic context compaction；
- Anthropic 明確指出 context pollution / relevance 問題不會因 window 變大而消失。

因此：

```text
Context Capacity
≠
Context Quality
≠
Context Cost
≠
Attention Usefulness
```

### WebAgent 實證
2025 的 long-context WebAgent benchmark 將 interaction history 擴展到 25K–150K tokens，論文報告部分模型 task success 從基準約 40–50% 降至長上下文條件下低於 10%，常見失敗是 loop 與遺忘原始目標。這是該 benchmark 與模型組合的結果，不應泛化成所有 2026 model，但證明「能接受長 prompt」與「Agent 能持續正確使用長 history」不是同一能力。

來源：
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://www.anthropic.com/news/claude-opus-4-6
- https://www.anthropic.com/news/claude-sonnet-4-6
- https://arxiv.org/abs/2512.04307

---

# Architecture Breakdown

## System Architecture：Hermes Context Compiler v1

```text
User Message
↓
Context Build Request
↓
Context Source Registry
├ System / Developer Instructions
├ Current User Goal
├ Conversation Session
├ Task DAG / Runtime State
├ Memory Store
├ RAG / Knowledge Graph
├ Tool Schemas
├ MCP Resources
├ Current Observations
├ Verification Evidence
└ Files / Notes
↓
Candidate Normalizer
├ source type
├ timestamp
├ authority
├ task relation
├ provenance
├ token estimate
└ security label
↓
Hard Constraint Resolver
├ instruction hierarchy
├ must-include goal
├ mandatory state
└ required tool schemas
↓
Context Ranker
├ relevance
├ freshness
├ authority
├ future utility
└ evidence value
↓
Budget Allocator
├ instructions budget
├ task/state budget
├ evidence budget
├ memory budget
├ tool-schema budget
└ free workspace
↓
Compression Router
├ raw
├ trim
├ summarize
├ structured note
├ extract fields
└ retrieve-on-demand pointer
↓
Ordering / Packing
↓
Tokenizer
↓
Token Count Check
↓
Final LLM-visible Context
↓
Prefill
↓
Transformer Attention
```

### Runtime sidecar

```text
Raw Event Store
↕
Context Compiler

Context Compiler output
→ ephemeral model projection

Raw Event Store
→ remains recoverable
```

這樣才能把「永久狀態」與「這次 inference 的 context projection」分開。

---

# Bottom-Level Logic

## 從一段 Agent History 到真正進 GPU 的 Token

假設 history：

```text
H = 180k tokens
```

模型 window：

```text
W = 256k
```

預留 output / reasoning headroom：

```text
R = 32k
```

則可用 input budget：

```text
B = W - R
  = 224k
```

但 Context Compiler 不應等到：

```text
H > 224k
```

才突然 trim。

應先估：

```text
system          6k
current goal    2k
runtime state   8k
active files   60k
tool schemas   12k
recent trace   40k
retrieved mem  20k
```

總候選：148k。

若新增大量 browser observation：+120k，則超 budget。

Compiler：

```text
Browser screenshots / tool outputs
↓
classify information value
↓
remove duplicate raw outputs
↓
extract state deltas
↓
retain latest high-fidelity observation
↓
summarize older observations
↓
store raw refs outside context
```

最後：

```text
Context Items
↓
Chat Template
↓
Tokenizer
↓
Token IDs
↓
Embedding Lookup
↓
Prefill Pass
↓
Q/K/V for every retained token
↓
KV Cache
```

因此 context selection 會直接影響：
- prefill FLOPs；
- KV cache size；
- memory bandwidth；
- first-token latency；
- API token cost；
- attention pollution。

這把本輪 Context Compiler 正式接回之前研究的 KV Cache / GPU Runtime。

---

# Context Budget 不應只有一個數字

新增：

```text
Context Budget
├ Capacity Budget
├ Cost Budget
├ Latency Budget
├ Evidence Budget
├ Instruction Budget
└ Risk Budget
```

例如某 1M-window model 雖可容納 900k input，但如果：
- latency SLA 只有 3 秒；
- token cost 超專案預算；
- 500k 是低價值 logs；

Context Compiler 仍應壓縮/檢索，而不是全部塞入。

這是合理工程建模；具體 budget 要依 model/provider benchmark 決定。

---

# Context Strategy 比較

## Strategy A：Append-Only

```text
Turn1
+ Turn2
+ Turn3
+ Tool outputs
+ ...
```

優點：資訊保真。
缺點：token 無界成長、pollution、prefill 成本。

## Strategy B：Sliding Window

```text
keep last N tokens/messages
```

優點：簡單、deterministic。
缺點：會切掉早期 goal / constraint。

## Strategy C：Summary Compaction

```text
old history
→ summary
+ recent raw context
```

優點：高壓縮率。
缺點：information loss / summary drift。

## Strategy D：Retrieval-backed Context

```text
full history outside model
↓
query
↓
retrieve relevant pieces
```

優點：window 可控、可恢復原文。
缺點：retrieval miss 會變成 hidden context loss。

## Strategy E：Hierarchical Context

HyMem 類：

```text
Planning Context
├ stable goal
├ milestones
└ task progress

Execution Context
├ current subtask
└ recent observations

Isolated Reasoning
└ temporary complex trace
```

2026 HyMem 在 GAIA / Browsecomp-plus 的特定 DeepSeek-V4 實驗中報告較 strongest baseline 提升 6.1 / 4.7 percentage points；這是論文結果，不應直接推廣到其他模型。

來源：
- https://arxiv.org/abs/2608.15703

---

# Visual Simulation Idea

## Context Compiler X-Ray

Hermes Console 建議增加一個可互動模擬器：

```text
[ ALL AGENT STATE ]
  412,840 tokens equivalent
        ↓
[ SOURCE REGISTRY ]
        ↓
[ RANK / FILTER ]
        ↓
[ BUDGET ALLOCATOR ]
        ↓
[ COMPRESSION ROUTER ]
        ↓
[ FINAL CONTEXT ]
  168,230 tokens
        ↓
[ TOKENIZER ]
        ↓
[ PREFILL / KV CACHE ]
```

每個 context block 顯示：

```text
Source
Tokens
Priority
Freshness
Authority
Relevance
Compression Ratio
Included / Excluded
Reason
Recoverable Raw Ref
```

### 可切換策略

```text
Append-All
Sliding Window
Summary
RAG
Hierarchical
Adaptive Compiler
```

### 動態指標

```text
Input Tokens
Dropped Tokens
Compressed Tokens
Retrieval Hits
Estimated Prefill Cost
Estimated KV Footprint
Context Pollution Score
Critical Constraint Coverage
Evidence Coverage
```

### Failure Injection

```text
old goal removed
wrong summary
stale tool result retained
critical evidence ranked low
retrieval miss
malicious tool output promoted
context budget overflow
```

視覺上應讓使用者看到：

```text
「資訊存在系統裡」
≠
「資訊存在這次模型 context 裡」
≠
「模型真的有效使用了它」
```

---

# Code / GitHub

## OpenAI Agents SDK

本輪真正追原始碼/範例，不只讀文件：

```text
openai/openai-agents-js
├ packages/agents-core/src/sandbox/capabilities/compaction.ts
├ packages/agents-core/src/runStateLegacyCompaction.ts
├ packages/agents-core/src/items.ts
├ packages/agents-core/src/events.ts
├ examples/memory/oai-compact.ts
├ examples/docs/sessions/responsesCompactionSession.ts
└ .agents/references/
   ├ conversation-state-ownership.md
   └ session-persistence.md
```

值得看的核心點：
1. compaction 被建模成獨立 capability/item/event；
2. `OpenAIResponsesCompactionSession` 包裝 underlying session，而不是取代 storage；
3. compaction trigger 可以自訂；
4. history compaction 與 interrupted RunState / session ownership 是不同 concern。

來源：
- https://github.com/openai/openai-agents-js/blob/main/examples/memory/oai-compact.ts

## LangGraph / LangMem

值得下一步追：

```text
message trimming
summary replacement
checkpoint history
beforeModel middleware
state reducers
```

LangGraph 官方文件目前將 short-term memory 超 window 的常見方法列為 trim、delete、summarize 與 custom strategy；這很適合作為 Context Compiler 的 baseline policy 層。

來源：
- https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/add-memory.mdx

---

# Papers

## ACON: Optimizing Context Compression for Long-horizon LLM Agents

Authors：Minki Kang, Wei-Ning Chen, Dongge Han, Huseyin A. Inan, Lukas Wutschitz, Yanzhi Chen, Robert Sim, Saravan Rajmohan
Year：2025
URL：https://arxiv.org/abs/2510.00615
Datasets / Benchmarks：AppWorld、OfficeBench、Multi-objective QA

Architecture：

```text
Full Agent Trajectory
↓
Observation + History Compressor
↓
Compressed Context
↓
Failure Analysis on paired trajectories
↓
Natural-language compression guideline optimization
↓
Optional distillation to smaller compressor
```

Contribution：把 agent context compression 從固定 heuristic 變成基於成功/失敗 trajectory 迭代最佳化的 compression policy。

Limitations：額外 compressor 本身有推理成本；壓縮品質與 benchmark/task distribution 綁定；不能保證所有 future-critical detail 都被保留。

---

## Context as a Tool: Context Management for Long-Horizon SWE-Agents

Authors：Shukai Liu, Jian Yang, Bo Jiang, Yizhi Li, Jinyang Guo, Xianglong Liu, Bryan Dai
Year：2025
URL：https://arxiv.org/abs/2512.22087
Benchmark：SWE-Bench-Verified

Architecture：

```text
stable task semantics
+
condensed long-term memory
+
high-fidelity short-term interactions
↓
Context Workspace
↓
Agent may call context-management action
```

Contribution：把 context maintenance 從 passive threshold heuristic 變成 agent policy/action space 的一部分。

Limitations：目前主要驗證 SWE agent；讓 model 決定何時 compact 也可能增加 policy error，需要 runtime guardrail。

---

## HyMem: Hierarchical Context Management for Long-Horizon Agents via Information Isolation

Authors：XinQi Wang, Jinwei Xiao, Sijia Cui, Hongming Zhang, Yanna Wang, Qingyang Zhang, Bo Xu
Year：2026
URL：https://arxiv.org/abs/2608.15703
Benchmarks：GAIA、Browsecomp-plus

Architecture：

```text
High-level Planning Context
+
Execution Context
+
Isolated Reasoning Module
+
Structured Memory Refresh
```

Contribution：不只壓縮 flat history，而是依功能隔離 context，避免 execution trace 淹沒 planning state。

Limitations：目前模型/benchmark 組合有限；context layer 的最佳分法不一定通用。

---

## Evaluating Long-Context Reasoning in LLM-Based WebAgents

Authors：Andy Chung, Yichi Zhang, Kaixiang Lin, Aditya Rawal, Qiaozi Gao, Joyce Chai
Year：2025
URL：https://arxiv.org/abs/2512.04307

Architecture / Evaluation：

```text
Dependent Web Subtasks
+
Injected Irrelevant Trajectories
↓
25K → 150K context
↓
Long-context WebAgent evaluation
```

Contribution：證明 WebAgent 的長 history 使用能力應被單獨測，不應只看 base model context-window spec。

Limitations：模型版本是 2025 frontier set；結果不直接代表 2026 新模型。

---

# Unknown / Open Questions

1. **Context Compiler 的 ranking target 到底是什麼？** 單步 answer accuracy、整體 task success、future usefulness、token cost、latency 彼此可能衝突，需要 multi-objective policy。
2. **Compression Loss 如何被驗證？** Summary 通常沒有 ground-truth；Hermes 需要建立 `raw source → compacted representation → later retrieval/decision` 的 trace，才能知道哪個壓縮決策造成 failure。
3. **Model attention 真正如何利用已選 context？** Compiler 只能控制送入哪些 token，不能保證模型會 attend/使用；下一層需接 Attention Sink、position effects、RoPE/long-context training、prefill/KV 與 context utilization benchmark。

---

# 下一輪研究

下一輪應深入：

## Long-Context Attention × RoPE × Position × KV Cache × Context Utilization

完整追：

```text
Context Compiler Output
↓
Tokenizer
↓
Position IDs
↓
RoPE / Position Encoding
↓
Q/K/V
↓
Attention Scores
↓
Prefill
↓
KV Cache
↓
Decode
```

研究問題：
- 1M-token context 在 Transformer 底層如何被 position encoding 支撐？
- RoPE extrapolation / scaling 真正改了什麼？
- 長 context 為何可能出現 lost-in-the-middle / retrieval degradation？
- Attention Sink / StreamingLLM 類方法與 Agent sliding context 有何關係？
- Prefill latency、KV VRAM 與 context budget 如何量化？
- Prompt caching / prefix caching 與 Context Compiler 應如何協同？

---

# Knowledge Graph 新增 Node / Edge

新增：

```text
Context Runtime
├ Context Source Registry
├ Context Compiler
├ Context Candidate
├ Hard Constraint Resolver
├ Context Ranker
├ Budget Allocator
├ Compression Router
├ Context Packer
└ Context Trace
```

新增：

```text
Context State Layers
├ Runtime State
├ Persistent State
├ Session State
├ Retrieved State
└ LLM-visible Context
```

新增：

```text
Context Failure
├ Storage Loss
├ Retrieval Miss
├ Selection Miss
├ Compression Loss
├ Truncation Loss
├ Stale Context
└ Context Pollution
```

新增核心 edges：

```text
Agent State
--projected by-->
Context Compiler

Persistent Memory
--retrieved into-->
Context Candidate Set

Context Candidate
--ranked by-->
Context Ranker

Token Budget
--constrains-->
Context Packing

Compaction
--reduces-->
Visible Token Cost

Context Size
--increases-->
Prefill Cost

Context Tokens
--populate-->
KV Cache

Raw Event Store
--preserves evidence for-->
Compaction Recovery
```

---

# 本輪結束檢查

- **缺哪一層：** Context Compiler → Transformer Attention 的實際 utilization layer。
- **哪個節點最淺：** Context Utility / ranking objective。
- **哪個概念仍只是名詞：** Attention Budget；下一輪需要用 Q/K/V、RoPE、position 與 long-context benchmark 真正落地。
- **哪個系統值得讀原始碼：** OpenAI Agents SDK compaction/session internals、LangGraph/LangMem summarize/trim path；下一輪再追 vLLM / SGLang prefix caching 與 long-context KV 管理。
- **哪篇論文需追引用：** ACON、CAT、HyMem，尤其要追後續是否有 cross-domain benchmark 驗證。
- **哪個概念最適合視覺模擬：** Context Compiler X-Ray。
- **哪個 Agent 架構最值得實作：** `Raw Event Store + Versioned Structured State + Adaptive Context Compiler + Recoverable Compaction`，而不是單純 append-only conversation 或反覆摘要。

本輪核心結論：

> **Context Window 不是 Agent 的記憶體；它只是每一次模型推理時，由 Runtime 從更大的 Agent State 中編譯出來的一個暫時性、有限、具有成本且可能有損的視圖。真正可靠的長任務 Agent，必須把「保存資訊」與「讓模型此刻看到哪些資訊」徹底分開。**