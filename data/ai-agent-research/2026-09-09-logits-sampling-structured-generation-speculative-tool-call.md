# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 02:53（Asia/Taipei）**

**本輪主題：Logits × Sampling × Structured Generation × Speculative Decoding × Tool-Call Token Path**

## 與歷史研究比較

本輪直接接續 `2026-09-09-gpu-kernel-hbm-tensorcore-moe-communication.md`。上一輪已把 Transformer 執行拆到 GPU kernel、HBM、Tensor Core、FlashAttention、Tensor Parallel 與 MoE communication；本輪不再重複 GPU execution，而是接著上一輪留下的黑盒：

```text
Transformer Final Hidden State
↓
LM Head
↓
Logits
↓
???
↓
Token
```

往 Agent Runtime 方向完整拆成：

```text
Final Hidden State
↓
LM Head
↓
Logits [vocab]
↓
Logits Processor
├ allowed-token / grammar mask
├ bad-word / min-token mask
├ logit bias
└ repetition / frequency / presence penalty
↓
Temperature
↓
Top-k / Top-p / Min-p
↓
Probability Distribution
↓
Sampler
↓
Token ID
↓
Tokenizer Decode
↓
Protocol Parser
├ text
├ JSON
├ tool call
└ control token
↓
Agent Runtime
```

本輪另外將「一 token 一次 target forward」的 decode path 與 speculative decoding 串起，回答：**模型從 GPU 產生 logits 後，究竟怎麼變成文字、JSON、tool call，以及 speculative decoding 為什麼可以一次接受多個 token 卻仍保持 target distribution。**

---

# 本小時新發現

1. **Production sampling 不是單一 `softmax → random()`。** vLLM V1 sampler 的實際順序包含 allowed-token whitelist、bad words、非 argmax-invariant logits processors、repetition/frequency/presence penalties、temperature、argmax-invariant processors、top-k/top-p，最後才 sample；greedy path 又會跳過 random sampling。
2. **Structured Generation 的本質不是「模型比較會輸出 JSON」，而是在每一步把不符合 grammar/schema 的 token logits mask 成不可選。** 這使 tool-call syntax reliability 可以從 prompt-level soft constraint 升級為 decoding-time hard constraint；但 schema-valid 不代表 semantic-correct。
3. **XGrammar 2（2026）把 structured decoding 從固定 grammar 推向 Agent 動態 grammar。** 新增 TagDispatch、JIT compilation、cross-grammar caching、Earley-parser path，瞄準 tool calling / conditional structured generation 這類每 request 都可能改變允許結構的 workload。
4. **Speculative decoding 的核心不是「小模型回答、大模型檢查答案」，而是 draft proposal + target parallel scoring + acceptance/rejection + recovery distribution。** 正確 rejection sampling 可以維持 target model 的分布；EAGLE-3 則用 multi-layer feature fusion + direct token prediction 提高 draft 命中率。
5. **Tool Call 在底層仍是 token sequence。** 模型不是直接執行 Python function；它先產生符合 tool protocol 的 token，API/runtime parser 把 token sequence 解析成 `tool_name + arguments`，之後才進入前幾輪研究建立的 Authorization IR → PEP/PDP → Transaction → Tool/MCP Execution。

---

# 本小時最重要 5 個發現

## 1. Logits 並不是「答案」，它只是下一 token 的未正規化分數

### 概念
Transformer 最後一層得到 hidden state：

```text
h_t ∈ R^d
```

LM head 將其投影到 vocabulary：

```text
z = W_vocab h_t + b

z ∈ R^|V|
```

`z_i` 就是 token `i` 的 logit。

softmax 才把 logits 轉成機率：

```text
p_i = exp(z_i) / Σ_j exp(z_j)
```

但 production runtime 通常不會立刻對原始 logits 做 softmax，而是先經過多種 processor。

### 已確認工程實作：vLLM V1 Sampler
目前 `vllm/v1/sample/sampler.py` 的 class docstring 直接列出順序：

```text
raw logits
↓
float32
↓
allowed token whitelist
↓
bad words exclusion
↓
logit processors
↓
repetition / frequency / presence penalties
↓
greedy? yes → argmax
↓ no
temperature
↓
min-p / argmax-invariant processors
↓
top-k / top-p
↓
random sample
```

Source:
https://github.com/vllm-project/vllm/blob/main/vllm/v1/sample/sampler.py

### Temperature 的底層
vLLM 目前實作本質上是：

```python
logits = logits / temperature
```

所以：

```text
T < 1
→ logit gap 被放大
→ distribution 更尖

T > 1
→ logit gap 被縮小
→ distribution 更平

T → 0
→ runtime 通常切 greedy argmax
```

這不是「提高 AI 創意值」那麼簡單，而是直接修改 token probability geometry。

### Top-k
只保留最高 k 個 token：

```text
Vocab = 128K
↓
Top-k = 50
↓
其餘 token probability = 0
↓
重新正規化
```

### Top-p / nucleus
排序 token probability 後，找累積機率至少達到 `p` 的最小集合：

```text
p(token1) = .40
p(token2) = .25
p(token3) = .15
p(token4) = .08
...

top_p=.80
→ {1,2,3}
```

集合大小不是固定的，會隨 distribution entropy 改變。

### 為什麼對 Agent 重要
對一般聊天，sampling 主要影響語氣與多樣性；對 Agent control tokens / tool calling，sampling 會直接影響：

```text
選工具 A 或工具 B
參數 key 的 token
數字 token
結束 JSON 的 brace
是否進入 tool-call channel
```

因此 Agent reliability 不能只在 prompt 層討論；decode policy 也是控制面的一部分。

### 限制
不能把 sampling randomness 等同於 model reasoning uncertainty。即使 temperature=0，模型仍可能穩定地選錯 tool；反過來，較高 temperature 也不表示模型「思考更多」。

---

## 2. Structured Generation = 在每一 decode step 動態限制「哪些 token 有資格被 sample」

### 不能只說「JSON schema 讓輸出符合格式」
真正底層應拆成：

```text
JSON Schema / Regex / CFG
↓
Grammar Compiler
↓
Parser State
↓
Current Prefix
↓
Allowed Next Tokens
↓
Vocab Mask
↓
logits[invalid_tokens] = -∞
↓
Temperature / Top-k / Top-p
↓
Sample among valid tokens
↓
Update Parser State
↓
Next decode step
```

### 例子
Schema：

```json
{
  "type": "object",
  "properties": {
    "city": {"type": "string"},
    "days": {"type": "integer"}
  },
  "required": ["city", "days"]
}
```

當 prefix 已經是：

```text
{"city":"Taipei","days":
```

grammar engine 此時應禁止：

```text
"hello"
{
[
true
```

並只允許能開始合法 integer 的 token（加上 grammar 所允許的 whitespace/sign 等）。

### 已確認官方資訊：OpenAI Structured Outputs
OpenAI Structured Outputs 以 developer-provided JSON Schema 約束輸出；function calling 設 `strict: true` 時，supported schema subset 下 arguments 會符合 tool definition。官方同時明確提醒：schema matching **不保證 JSON 裡的值本身是正確的**。

Source:
https://openai.com/index/introducing-structured-outputs-in-the-api/
https://help.openai.com/en/articles/8555517-function-calling-in-the-openai-api

### 已確認工程實作：vLLM
vLLM 最新 structured outputs 已使用 `structured_outputs` API，支援：

```text
choice
regex
json
grammar
```

且 source tree 有獨立 runtime：

```text
vllm/v1/structured_output/
├ __init__.py
├ backend_xgrammar.py
├ backend_guidance.py
├ backend_outlines.py
├ backend_lm_format_enforcer.py
├ backend_types.py
├ request.py
└ utils.py
```

Source:
https://docs.vllm.ai/en/latest/features/structured_outputs/
https://github.com/vllm-project/vllm/tree/main/vllm/v1/structured_output

### XGrammar：為何 grammar decoding 需要專門系統
XGrammar 2024 的核心觀察是：naïve CFG decoding 若每一步都對整個 vocabulary 做 parser traversal，會有顯著 CPU overhead。

它將 token 分成：

```text
Context-independent tokens
→ 可預先檢查 / cache

Context-dependent tokens
→ runtime parser 檢查
```

並用 persistent stack 等機制降低 mask generation 成本；論文在其 benchmark 報告相較既有方案最高約 100× grammar-engine speedup，整合 inference engine 後接近 near-zero end-to-end overhead。這是論文特定 workload 結果，不可泛化成所有 schema 都零成本。

Paper:
**XGrammar: Flexible and Efficient Structured Generation Engine for Large Language Models**
Authors: Yixin Dong, Charlie F. Ruan, Yaxing Cai, Ruihang Lai, Ziyi Xu, Yilong Zhao, Tianqi Chen
Institution: MLC / research collaborators
Year: 2024
URL: https://arxiv.org/abs/2411.15100
Code: https://github.com/mlc-ai/xgrammar
Dataset/Benchmark: JSON Schema / CFG structured-generation workloads described in paper
Architecture: Grammar Compiler → token classification/cache → persistent parsing stack → bitmask generation → inference-engine overlap
Contribution: 將 grammar mask generation 從 decoding bottleneck 降低到可與 GPU execution overlap
Limitations: grammar-valid ≠ semantic-valid；compile/cache behavior 依 grammar dynamicity 而變

### 2026 新節點：XGrammar 2
Agentic tool calling 的 grammar 不再總是 request-start 時就固定。

XGrammar 2 新增：

```text
TagDispatch
JIT Compilation
Cross-Grammar Cache
Earley-parser-based mask generation
Repetition Compression
```

核心目標是 dynamic structured generation，例如 tool calling、conditional schema。論文報告 mask generation 相較當時 engines 超過 6× speedup，並在 inference integration 中接近 near-zero overhead；仍應視為論文 benchmark 結果。

Paper:
**XGrammar 2: Dynamic and Efficient Structured Generation Engine for Agentic LLMs**
Authors: Linzhang Li, Yixin Dong, Guanjie Wang, Ziyi Xu, Alexander Jiang, Tianqi Chen
Year: 2026
URL: https://arxiv.org/abs/2601.04426
Code: https://github.com/mlc-ai/xgrammar
Architecture: Dynamic Dispatch → JIT Grammar Compile → Cross-Grammar Cache → Earley/PDA parsing → Token Mask
Contribution: 把 structured generation engine 往動態 Agent protocol 推進
Limitations: 仍只約束 syntax/structure；tool semantics、permission、side effect 不在 grammar engine 內

### 最重要區分

```text
Syntactic Validity
≠
Semantic Validity
≠
Authorization Validity
≠
Execution Success
```

合法 JSON：

```json
{"tool":"delete_all_files","path":"/"}
```

依然可能是完全不應執行的 action。

因此 Hermes 必須保留：

```text
Grammar Constraint
↓
Protocol Parse
↓
Authorization IR
↓
PDP / PEP
↓
Transaction
↓
Execution
```

而不能把 `strict JSON` 當成 security boundary。

---

## 3. Tool Calling 的底層其實是「受協議約束的 token sequence → parser → action proposal」

### 常見誤解

```text
LLM
→ calls function
```

這個圖太粗。

### 更正確的路徑

```text
User Goal
↓
Context Compiler
├ tool definitions
├ JSON schemas
└ instructions
↓
Tokenizer
↓
Transformer
↓
Logits
↓
Sampling / Structured Mask
↓
Token IDs
↓
Protocol-specific token stream
↓
Tool-call Parser
↓
ToolCall IR
├ tool_name
├ arguments
├ call_id
└ metadata
↓
Runtime Validation
↓
Authorization
↓
Execution
```

例如模型可在 token 層產生類似：

```text
<tool_call>
{"name":"search","arguments":{"query":"..."}}
</tool_call>
```

實際 protocol syntax 取決於模型 chat template / API contract，不應假設所有模型相同。

### Tool Schema 的真正角色

Tool schema 同時影響兩層：

```text
A. Model Context
→ 告訴模型有哪些 tool / arguments

B. Structured Decoder
→ 可選擇性限制合法 token path
```

這兩者不能混為一談。

只有 A：

```text
Prompt says use JSON
→ 模型可能輸出 invalid JSON
```

A+B：

```text
Schema in context
+
Grammar mask
→ syntax path 被硬限制
```

但 tool selection 本身仍可能語意錯。

### Parallel Tool Calls
若模型一次產生多個 tool calls，底層問題變成：

```text
Token Stream
↓
Parse ToolCall[0..N]
↓
Dependency / Conflict Analysis
↓
Permission per call
↓
Parallelizable?
↓
Scheduler
```

因此前幾輪研究的 DAG Planning / Transaction Conflict 仍然是必要層；structured output 只保證可 parse，不能判定兩個 side effects 是否能並行。

### Hermes 新增的 canonical ToolCall IR 建議

```text
ToolCallProposal
├ call_id
├ protocol
├ tool_namespace
├ tool_name
├ raw_arguments
├ parsed_arguments
├ schema_version
├ source_model
├ generation_mode
│  ├ unconstrained
│  └ constrained
├ grammar_state_hash
├ logprob / confidence evidence (optional)
├ semantic_effect
└ trace_id
```

**合理工程推論：**保存 `schema_version + grammar_state_hash + raw token span` 會讓 tool-call debugging 與重播更可驗證；這不是目前通用標準，需要 Hermes 自己實驗。

---

## 4. Speculative Decoding：一次產生多 token 的關鍵是「draft 便宜、target 一次平行驗證多位置」

### 標準 autoregressive decode

```text
Target LLM forward
→ token 1

Target LLM forward
→ token 2

Target LLM forward
→ token 3
```

每個 token 都需要一次 sequential target-model step。

### Speculative Sampling

```text
Draft Model
→ d1 d2 d3 d4

Target Model
→ 一次平行 scoring 多個 proposed positions

Acceptance Test
├ accept d1
├ accept d2
├ reject d3
└ stop / recover
```

關鍵是 target forward 仍然決定最終 distribution，不是把 target model 換掉。

### Lossless rejection sampling 的概念
若 draft distribution 為 `q(x)`，target 為 `p(x)`，draft token 可依：

```text
accept probability
= min(1, p(x) / q(x))
```

被接受。

若被拒絕，從 correction / recovery distribution 抽樣；經正確構造後，最終 sample 仍遵循 target distribution。

這是 speculative sampling 最關鍵的 correctness property。

Paper:
**Accelerating Large Language Model Decoding with Speculative Sampling**
Authors: Charlie Chen, Sebastian Borgeaud, Geoffrey Irving, Jean-Baptiste Lespiau, Laurent Sifre, John Jumper
Institution: DeepMind
Year: 2023
URL: https://arxiv.org/abs/2302.01318
Architecture: Draft Model → speculative tokens → Target parallel scoring → modified rejection sampling → accepted/recovered/bonus token
Contribution: 在不改 target distribution 的前提下減少 expensive target decode steps
Reported result: Chinchilla 70B distributed setup 約 2–2.5× decoding speedup
Limitations: speedup 高度依賴 draft cost、acceptance rate、batch size、hardware、verification overhead

### vLLM 現行原始碼驗證
`vllm/v1/sample/rejection_sampler.py` 明確區分：

```text
accepted tokens
recovered tokens
bonus tokens
output = accepted + recovered + bonus
```

並接收：

```text
draft_probs
target logits
bonus token
sampling metadata
```

目前 implementation 也必須重新套用 temperature/top-k/top-p 等 sampling constraints，顯示 speculative decode 不能脫離原本 sampler semantics。

Source:
https://github.com/vllm-project/vllm/blob/main/vllm/v1/sample/rejection_sampler.py

### Medusa
Medusa 不一定維護一個完整獨立 draft LLM，而是增加多個 decoding heads 預測未來 token，形成 tree candidates，target backbone 再用 tree attention 平行驗證。

Paper:
**Medusa: Simple LLM Inference Acceleration Framework with Multiple Decoding Heads**
Authors: Tianle Cai, Yuhong Li, Zhengyang Geng, Hongwu Peng, Jason D. Lee, Deming Chen, Tri Dao
Year: 2024
URL: https://arxiv.org/abs/2401.10774
Code: https://github.com/FasterDecoding/Medusa
Architecture: Backbone hidden state → multiple future-token heads → candidate tree → tree attention verification
Contribution: 避免維護完全獨立 draft model 的一種 speculative family
Reported result: paper 中 Medusa-1 >2.2×，Medusa-2 約 2.3–3.6×（特定模型/設定）
Limitations: 需要額外 heads / tuning；speedup 仍受 candidate acceptance 與 batch regime 影響

### EAGLE-3
EAGLE-3 從 earlier EAGLE 的 feature prediction constraint 轉向 direct token prediction，並融合 target model 多層 feature。

```text
Target multi-layer features
↓
Feature Fusion
↓
Draft Predictor
↓
Candidate Tokens / Tree
↓
Target Verification
```

Paper:
**EAGLE-3: Scaling up Inference Acceleration of Large Language Models via Training-Time Test**
Authors: Yuhui Li, Fangyun Wei, Chao Zhang, Hongyang Zhang
Year: 2025
URL: https://arxiv.org/abs/2503.01840
Code: https://github.com/SafeAILab/EAGLE
Architecture: Multi-layer feature fusion → direct-token draft model → tree speculation → target verification
Contribution: 提高 draft-target alignment，讓 draft model 更能從 training-data scaling 受益
Reported result: paper 最高 speedup ratio 6.5×；SGLang batch=64 報告約 1.38× throughput improvement
Limitations: headline single-request speedup 與 serving throughput speedup不同；需要額外 training / integration

### 2026 新節點：Speculation 本身也開始 adaptive
2026 `AdaptiveSpec` 類研究開始讓 draft tree depth/width/node-count 與 acceptance policy隨每 step confidence / acceptance history 動態變化。這顯示 speculative decoding 未來不只是固定 `k draft tokens`，而會變成 inference scheduler 的動態控制問題。

這一層目前屬新研究方向，Hermes Knowledge Graph 應標為：

```text
Adaptive Speculation Policy
├ draft budget
├ tree depth
├ tree width
├ observed acceptance
├ target/draft confidence
└ latency objective
```

而不是當成已成熟 production standard。

---

## 5. Structured Generation × Speculative Decoding × Agent Tool Calling 其實會交會在同一個 token verifier

這是本輪最值得後續實作的新整合點。

### 如果只看 Structured Generation

```text
Target logits
↓
Grammar Mask
↓
Sample valid token
```

### 如果只看 Speculative Decoding

```text
Draft tokens
↓
Target logits
↓
Accept / Reject
```

### 真正 Agent tool-call workload

```text
Draft proposes:
{"tool":"search","arguments":{...}}
↓
Target verifies token probabilities
↓
Grammar verifies syntactic legality
↓
Sampling constraints
↓
Accepted token prefix
↓
Tool-call parser
```

這產生一個重要工程要求：

> **Draft acceptance 不能讓 token 繞過 structured-output grammar state。**

如果 draft token 在 target probability 上可接受、但對目前 grammar state 不合法，就不能 commit。

因此更完整的 acceptance gate 應概念化為：

```text
Draft Candidate
↓
Target Distribution Check
∩
Grammar / Allowed-Token Check
∩
Sampling Policy
↓
COMMIT TOKEN
```

這裡的「∩」是 Hermes 建模用語，不代表所有 inference engines 都以完全相同順序或同一 kernel 實作。

### 為什麼這對 Agent 特別重要
Agent 常輸出大量 predictable structured tokens：

```text
{"name":"...","arguments":{...}}
```

這種 syntax-heavy prefix 可能是 speculative decoding 高 acceptance 的候選 workload；但 tool name、數字參數、resource ID 又是 semantic high-impact token。

因此 Hermes 應建立另一個**尚未驗證假說**：

```text
Syntax Tokens
→ aggressive speculation

Semantic Effect Tokens
→ conservative verification / richer logging
```

這不是現有 EAGLE/XGrammar 的標準做法，需要後續 benchmark。

---

# Architecture Breakdown

## 從 Transformer 到 Agent Tool Execution 的完整輸出架構

```text
Transformer Layer N
↓
Final Norm
↓
Hidden State h_t
↓
LM Head
↓
Logits [batch, vocab]
↓
Logits Processing Plane
├ allowed-token mask
├ structured grammar mask
├ bad words
├ penalties
└ logit bias
↓
Sampling Plane
├ greedy / argmax
├ temperature
├ min-p
├ top-k
└ top-p
↓
Speculative Plane (optional)
├ draft proposal
├ target verify
├ rejection / recovery
└ bonus token
↓
Committed Token IDs
↓
Tokenizer Decode / Incremental Decoder
↓
Protocol Parser
├ assistant text
├ reasoning/control channel
├ structured response
└ tool call
↓
ToolCall Proposal IR
↓
Schema Validation
↓
Authorization IR
↓
PDP / PEP
↓
Transaction Gate
↓
MCP / API / GUI / Code Tool
↓
Observation
↓
Context Compiler
↓
Next Model Turn
```

這一輪正式把過去兩條長鏈接在一起：

```text
GPU
→ Model
→ Logits
→ Token
→ Tool Call
→ Agent Runtime
```

以及：

```text
Tool Schema
→ Context
→ Structured Decoder
→ ToolCall IR
→ Security Runtime
```

---

# Bottom-Level Logic

## A. 單 token decode 的真正步驟

假設 vocabulary size = 128K。

```text
1. hidden state h_t
2. LM head → 128K logits
3. cast / normalize dtype if needed
4. mask disallowed token IDs
5. apply protocol / grammar mask
6. apply logit bias / penalties
7. if greedy: argmax → token
8. else divide by temperature
9. min-p / top-k / top-p filtering
10. softmax / normalized probability
11. random draw
12. token ID committed
13. token appended to sequence
14. K/V for token retained
15. incremental parser consumes token/text bytes
16. repeat
```

其中第 4/5 與第 15 形成 feedback loop：

```text
Parser State_t
↓
Allowed Tokens_t
↓
Sample Token_t
↓
Parser State_t+1
```

所以 structured decoding 本質上是 **model decode loop + formal-language state machine** 的耦合。

## B. Tool Call 不等於 Tool Execution

```text
Token Sequence
↓
Parser
↓
ToolCall(name,args)
↓
VALIDATE
↓
AUTHORIZE
↓
APPROVE?
↓
TRANSACTION
↓
EXECUTE
```

因此如果畫面上看到模型「開始生成工具 JSON」，仍不能把 UI 顯示成工具已執行。

Hermes UI 建議至少顯示：

```text
PROPOSING
PARSING
VALIDATING
AUTHORIZED
EXECUTING
VERIFIED
```

## C. Speculative decode 的 commit boundary

```text
Draft:
[d1 d2 d3 d4]

Target verifies:
[p1 p2 p3 p4 + bonus]

Acceptance:
d1 ✓
d2 ✓
d3 ✕

Committed:
[d1 d2 recovered_token]

Discard:
d3 d4 draft state
```

所以 speculative KV / draft state 與 committed sequence state 不能混為一談。

vLLM sampler source 甚至明確區分 committed `output_token_ids` 與 `spec_token_ids`；例如 thinking-budget logic 只把 committed outputs 當正式狀態，draft tokens 保留在 speculative side path。

Source:
https://github.com/vllm-project/vllm/blob/main/vllm/v1/sample/sampler.py

這對 Agent trace 很重要：**未被 target 接受的 draft tool-call token 不應進入 audit trail 當成 Agent 已提出的真實 action。**

---

# Visual Simulation Idea

# **Logits → Tool Call X-Ray**

這輪最適合 Hermes Console 的互動模擬，應該把 vocabulary、grammar、sampling、speculation 與 tool parser 放在同一張動態圖。

## 畫面 1：Vocabulary Logit Landscape

```text
Token                Raw Logit   Mask   Temp   Final P
------------------------------------------------------
search               9.81        ✓      .2     .71
write_file           9.44        ✓      .2     .21
send_email           8.92        ✕      -      0
"                    8.55        ✓      .2     .03
}                    7.10        ✕      -      0
```

使用者可以切換：

```text
Raw Logits
After Grammar Mask
After Penalty
After Temperature
After Top-k/p
Final Probability
```

## 畫面 2：Grammar State Machine

```text
START
 ↓ {
OBJECT
 ↓ "name"
COLON
 ↓ "search"
COMMA
 ↓ "arguments"
...
```

每一步顯示：

```text
Allowed token count: 128,000 → 43
Grammar state
Parser stack depth
Mask generation µs
Cache hit/miss
```

## 畫面 3：Speculative Tree

```text
             {
             │
          "name"
          /     \
     "search"  "write_file"
       │            │
   "arguments"  "path"
```

節點顯示：

```text
Draft Probability
Target Probability
Grammar Valid?
Accepted?
Committed?
```

## 畫面 4：Tool Boundary

一旦 token sequence parse 完：

```text
MODEL OUTPUT
↓
TOOL PROPOSAL
↓
AUTHORIZATION
↓
EXECUTION
```

UI 用不同顏色/狀態，不讓使用者誤以為「模型產生 JSON = 已經動作」。

## 可注入故障

```text
Malformed JSON
Unknown tool
Wrong argument type
Grammar masks intended token
Tool schema version drift
High temperature tool mis-selection
Speculative draft diverges at tool name
Draft token valid by probability but invalid by grammar
Parser sees complete JSON but authorization denies
```

## 可比較模式

```text
Prompt-only JSON
vs
Grammar Constrained

Greedy
vs
Top-p Sampling

No Speculation
vs
Speculative Decoding

Text Answer
vs
Tool Call
```

顯示指標：

```text
Tokens/sec
Target forward count
Draft acceptance length
Grammar mask overhead
Invalid syntax rate
Schema-valid rate
Tool semantic accuracy
Authorization-deny rate
End-to-end task success
```

這樣就可以非常直觀地看到：

> **格式可靠、模型判斷正確、工具被允許、工具執行成功，是四種不同 reliability。**

---

# Code / GitHub

## 1. vLLM sampling path

Repository:
https://github.com/vllm-project/vllm

值得讀：

```text
vllm/v1/sample/
├ sampler.py
├ rejection_sampler.py
├ metadata.py
├ thinking_budget_state.py
├ logits_processor/
└ ops/
```

### `sampler.py`
核心價值：
- 定義 production sampling processor 的順序
- greedy vs random path
- temperature
- top-k/top-p
- allowed token IDs
- penalties
- raw vs processed logits/logprobs
- speculative bonus-token integration

### `rejection_sampler.py`
核心價值：
- draft probs / target logits
- accepted / recovered / bonus tokens
- speculative output composition
- sampling constraints on target logits
- speculative logprob handling

這兩個檔案應在 Hermes Code Explorer 做成一組「Token Commit Pipeline」。

## 2. vLLM structured output runtime

```text
vllm/v1/structured_output/
├ backend_xgrammar.py
├ backend_guidance.py
├ backend_outlines.py
├ backend_lm_format_enforcer.py
├ backend_types.py
├ request.py
└ utils.py
```

重點不是 backend 數量，而是看 structured-output request 怎麼被 compile、cache、映射到 token mask，最後如何和 scheduler/sample path 交會。

## 3. XGrammar

Repository:
https://github.com/mlc-ai/xgrammar

值得追：

```text
cpp/
├ grammar_compiler.cc
├ compiled_grammar.cc
├ earley_parser.cc
├ fsm.cc
├ fsm_builder.cc
├ grammar.cc
└ grammar_builder.cc
```

目前 source tree 已同時存在 Earley parser、FSM、grammar compiler 等層，符合 XGrammar 2 往動態 grammar / richer parser path 演進的方向。

## 4. EAGLE

Repository:
https://github.com/SafeAILab/EAGLE

下一次 Code 深挖應追：

```text
Draft Model
Tree Construction
Target Verification
KV / Cache handling
Acceptance path
SGLang integration
```

尤其要分清楚論文 headline speedup 與 production batched throughput gain。

---

# Papers

## Paper 1 — Speculative Sampling

**Title:** Accelerating Large Language Model Decoding with Speculative Sampling  
**Authors:** Charlie Chen, Sebastian Borgeaud, Geoffrey Irving, Jean-Baptiste Lespiau, Laurent Sifre, John Jumper  
**Institution:** DeepMind  
**Year:** 2023  
**URL:** https://arxiv.org/abs/2302.01318  
**Code:** paper did not make a single canonical production engine the contribution; multiple engines now implement the method  
**Dataset/Workload:** Chinchilla inference workloads described in paper  
**Architecture:** Draft → parallel target scoring → modified rejection sampling → accepted/recovered token  
**Contribution:** lossless speculative sampling preserving target distribution  
**Limitations:** acceptance rate / draft overhead / batch behavior determine real benefit  
**改變了什麼：**把 autoregressive decode 從「每個 output token 一次 expensive target step」改成「一次 target step 可驗證多個 candidate positions」。

## Paper 2 — Medusa

**Title:** Medusa: Simple LLM Inference Acceleration Framework with Multiple Decoding Heads  
**Authors:** Tianle Cai et al.  
**Year:** 2024  
**URL:** https://arxiv.org/abs/2401.10774  
**Code:** https://github.com/FasterDecoding/Medusa  
**Architecture:** Backbone → multiple decoding heads → candidate tree → tree attention target verification  
**Contribution:** 用 extra heads 形成 speculative candidates，降低獨立 draft model 維護成本  
**Limitations:** training/integration complexity；不同 serving batch 下收益不同  
**改變了什麼：**把 speculative proposal 從「另一個完整 LLM」擴展成「target backbone 附加多個 future-token heads」。

## Paper 3 — EAGLE-3

**Title:** EAGLE-3: Scaling up Inference Acceleration of Large Language Models via Training-Time Test  
**Authors:** Yuhui Li, Fangyun Wei, Chao Zhang, Hongyang Zhang  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2503.01840  
**Code:** https://github.com/SafeAILab/EAGLE  
**Architecture:** target multi-layer features → fusion → direct token draft prediction → tree verification  
**Contribution:** 改善 EAGLE draft prediction 的 scaling 與 acceptance  
**Limitations:** 需要特定 draft training；單 request speedup 與 serving throughput 要分開讀  
**改變了什麼：**從 earlier feature prediction constraint 往 multi-layer fusion + direct token prediction 演化。

## Paper 4 — XGrammar

**Title:** XGrammar: Flexible and Efficient Structured Generation Engine for Large Language Models  
**Authors:** Yixin Dong, Charlie F. Ruan, Yaxing Cai, Ruihang Lai, Ziyi Xu, Yilong Zhao, Tianqi Chen  
**Year:** 2024  
**URL:** https://arxiv.org/abs/2411.15100  
**Code:** https://github.com/mlc-ai/xgrammar  
**Architecture:** CFG/Schema → compile → context-independent token precheck + context-dependent parsing → persistent stack → token bitmask  
**Contribution:** 大幅降低 constrained decoding grammar overhead  
**Limitations:** syntax constraint 不保證 semantic truth / safe action  
**改變了什麼：**讓 structured generation 從 application-side retry/validate 更靠近 inference engine first-class primitive。

## Paper 5 — XGrammar 2

**Title:** XGrammar 2: Dynamic and Efficient Structured Generation Engine for Agentic LLMs  
**Authors:** Linzhang Li, Yixin Dong, Guanjie Wang, Ziyi Xu, Alexander Jiang, Tianqi Chen  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2601.04426  
**Code:** https://github.com/mlc-ai/xgrammar  
**Architecture:** TagDispatch + JIT + cross-grammar caching + Earley parsing + repetition compression  
**Contribution:** 針對 tool calling / conditional generation 的 dynamic grammar workload  
**Limitations:** dynamic syntax solved more efficiently, but semantics/security/execution remain external  
**改變了什麼：**structured generation 從「固定 response schema」正式往 Agent runtime 的動態 protocol control 發展。

---

# 已確認事實 / 論文結果 / 工程實作 / 合理推論 / 尚未驗證假說

## 已確認事實
- autoregressive decoder 的 LM head 產生 vocabulary logits；sampling 再決定 next token。
- structured decoding 可以利用 grammar/schema 約束可選 token。
- function-call argument schema valid 不代表 tool choice 或 argument value 在任務語意上正確。

## 官方資訊
- OpenAI Structured Outputs `strict: true` 在支援條件下約束 function arguments 符合 supplied schema。
- vLLM 最新 structured-output interface 已轉向 `structured_outputs`，支援 json/regex/choice/grammar 等。

## 工程實作
- vLLM V1 sampler 現行 source 明確定義 allowed tokens、bad words、penalties、temperature、top-k/top-p 的 processing order。
- vLLM 有獨立 `rejection_sampler.py` 實作 speculative acceptance/recovery path。
- vLLM 有獨立 `v1/structured_output/` backend architecture。
- XGrammar repo 有 compiler、FSM、Earley parser 等 source 層。

## 論文結果
- Speculative Sampling、Medusa、EAGLE-3、XGrammar、XGrammar 2 的 speedup 均是特定模型、硬體、資料與 workload 結果，不應當成 universal speedup。

## 合理工程推論
- Hermes 應把 ToolCallProposal IR 與 actual Tool Execution 分離，並保存 protocol/schema/trace metadata。
- structured tool-call token 可望具有較高 predictable syntax，可能適合 speculation，但需 benchmark。

## 尚未驗證假說
- 「Syntax tokens aggressive speculation + semantic-effect tokens conservative verification」是否能在 tool-call workload 同時提升吞吐與降低 semantic action risk，目前沒有足夠證據，應列為 Hermes 實驗而非結論。

---

# Unknown / Open Questions

## 1. Structured decoding 與 speculative decoding 的最佳融合邊界在哪？

可能方案：

```text
A. Draft 也受同一 grammar mask
B. Draft unconstrained，target verification 再套 grammar
C. Grammar-aware draft tree pruning
```

需要測：
- acceptance rate
- grammar overhead
- end-to-end throughput
- cache behavior

## 2. Tool-call semantic error 能不能在 logits/token 階段被辨識？

現在 grammar 主要保證 syntax。如果：

```json
{"amount": 1000000}
```

schema 合法但任務不合理，還是要後面的 policy/verification。

尚不清楚是否值得建立：

```text
Semantic constrained decoder
```

或應維持 decode 與 authorization 的明確 separation。

## 3. Sampling policy 是否應依 Agent phase 動態改變？

例如：

```text
Natural-language brainstorming
→ stochastic

Planner IR / ToolCall
→ lower entropy / constrained

Final prose
→ moderate stochasticity
```

這是一個很實際的 Agent Runtime 問題，但需要 task benchmark 才能決定最佳 policy。

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Token Generation Runtime
├ LM Head
├ Logit
├ Logit Processor
├ Allowed Token Mask
├ Temperature
├ Top-k
├ Top-p
├ Min-p
├ Greedy Sampler
├ Random Sampler
└ Token Commit
```

```text
Structured Generation Runtime
├ JSON Schema
├ Regex
├ CFG
├ Grammar Compiler
├ Parser State
├ Allowed Token Set
├ Bitmask
├ XGrammar
├ XGrammar 2
├ TagDispatch
├ JIT Grammar Compilation
├ Cross-Grammar Cache
└ Earley Parser
```

```text
Speculative Decoding Runtime
├ Draft Model
├ Draft Token
├ Candidate Tree
├ Target Verification
├ Acceptance Probability
├ Rejection
├ Recovery Distribution
├ Bonus Token
├ Medusa
├ EAGLE-3
└ Adaptive Speculation
```

```text
Tool Call Token Runtime
├ Tool Schema
├ Protocol Tokens
├ ToolCall Parser
├ ToolCallProposal IR
├ Schema Version
├ Grammar State
└ Commit Boundary
```

## 新增核心 Edges

```text
Final Hidden State
→ LM Head
→ Logits
```

```text
Grammar State
→ constrains
Allowed Token Set
```

```text
Allowed Token Set
→ masks
Logits
```

```text
Temperature / Top-k / Top-p
→ transforms
Sampling Distribution
```

```text
Sampling Distribution
→ produces
Token ID
```

```text
Token Sequence
→ parsed into
ToolCall Proposal
```

```text
ToolCall Proposal
→ validated by
Authorization Runtime
```

```text
Draft Model
→ proposes
Draft Tokens
```

```text
Target Model
→ verifies
Draft Tokens
```

```text
Grammar Constraint
→ must hold before
Token Commit
```

```text
Committed Tool Tokens
→ not equivalent to
Executed Tool Effect
```

---

# 對「AI 到底怎麼運作」總圖的更新

目前從使用者一句話已能走到：

```text
User
↓
UI
↓
Agent Runtime
↓
Context Compiler
↓
Tokenizer
↓
Embeddings
↓
Transformer
├ Attention
├ RoPE
├ KV Cache
├ FFN / MoE
└ GPU Kernels
↓
Final Hidden State
↓
LM Head
↓
Logits
↓
Sampling / Structured Decoder
↓
Token
↓
Protocol Parser
↓
ToolCall Proposal
↓
Authorization
↓
Transaction
↓
MCP / Tool / API / GUI
↓
Environment
↓
Observation
↓
Memory / Context Update
```

這是目前知識圖譜第一次把：

```text
GPU
→ logits
→ token
→ structured tool call
→ real-world action
```

完整接通。

---

# 下一輪研究

下一輪最值得進入：

# **Tokenizer × Chat Template × Special Tokens × Tool Protocol × Byte/Token Boundary**

因為本輪雖然已經回答：

```text
logits
→ token ID
```

但 `token ID` 如何真正變成：

```text
「你好」
JSON brace
tool-call delimiter
reasoning delimiter
image token
special control token
```

仍然是一個黑盒。

下一輪應拆：

```text
Raw Text / Tool Schema
↓
Chat Template
↓
Special Tokens
↓
Tokenizer
├ BPE
├ byte fallback
├ merge rules
└ added tokens
↓
Token IDs
↓
Embedding Lookup
```

輸出方向則反過來：

```text
Sampled Token IDs
↓
Incremental Detokenization
↓
Special-token Recognition
↓
Channel / Tool Protocol Parser
↓
UI / Agent Runtime
```

核心問題：
- 一個 JSON character 是否一定對應一個 token？不是的話 grammar engine 如何處理跨 token byte prefix？
- Tool call special token 是 vocabulary token、chat-template delimiter，還是 API-side parser convention？
- 同樣 tool schema 換 tokenizer / chat template，function-calling reliability 為什麼會變？
- Tokenizer 如何影響多語言 context cost？
- Vision/audio token 是否真的走同一 tokenizer？哪些是 encoder embedding 而不是 text token？
- incremental detokenization 如何避免 parser 在 UTF-8 / partial token 邊界誤判？

---

# 本輪結束檢查

**缺哪一層：** `Token ID ↔ byte/text ↔ chat-template/tool-protocol` 邊界。  
**哪個節點最淺：** structured decoding × speculative decoding integration。  
**哪個概念仍只是名詞：** Semantic Constrained Decoding；目前不能把它當成熟機制。  
**哪個系統值得讀原始碼：** XGrammar 2 parser/compiler、vLLM structured output + rejection sampler 的交會處。  
**哪篇論文需追引用：** XGrammar 2（2026）與 EAGLE-3，尤其 production serving / tool-calling workload 的後續工作。  
**哪個概念最適合視覺模擬：** Logits → Grammar Mask → Sampling → Speculative Acceptance → ToolCall Parser。  
**哪個 Agent 架構最值得實作：** Hermes 單主 Agent + deterministic structured decoder + ToolCallProposal IR + Authorization/Transaction Runtime；不是讓另一個 LLM 充當 JSON 修復代理。

---

# 本輪核心結論

> **模型真正輸出的不是「答案」或「工具呼叫」，而是一連串被 logits、sampling policy、grammar state 與 speculative verifier 共同決定的 token IDs。只有當這些 token 被 protocol parser 解析成 ToolCallProposal，並通過 authorization、transaction 與 execution gate 後，才會變成現實世界的 action。Structured Outputs 解的是「能不能被正確解析」，Speculative Decoding 解的是「能不能少做 expensive target decode step」，兩者都不等於 Agent 已經做對事情。**
