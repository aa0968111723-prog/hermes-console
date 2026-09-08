# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 03:52（Asia/Taipei）**  
**本輪主題：Tokenizer × Chat Template × Special Tokens × Tool Protocol × Byte/Token Boundary**

> 本輪承接上一輪 `Logits → Sampling → Token ID → Tool Parser` 的缺口，專注回答：**一串人類可見的文字、JSON、圖片佔位符與 tool delimiter，到底如何變成模型看見的 Token IDs；模型輸出的 Token IDs 又如何在 streaming 條件下安全地還原成文字與 ToolCall。**

---

## 一、本小時新發現

### 新架構：Chat Template 應視為「Protocol Compiler」，而不是 UI 格式化器

Hugging Face Transformers 的正式文件與原始碼顯示，chat template 會把 `messages`、`tools`、`documents`、special tokens、generation prompt，甚至 multimodal placeholder，一起編譯成模型實際看到的 tokenizable sequence。現行 Transformers 會把 `chat_template.jinja` 與額外 named templates 當成 tokenizer / processor artifact 的一部分；若有多個模板，在傳入 tools 時可選擇 `tool_use` template。

這表示 Agent 的輸入協議其實是：

```text
Structured Conversation
├ system
├ user
├ assistant
├ tool
├ tools[]
├ documents[]
└ multimodal content[]
        ↓
Chat Template / Processor
        ↓
Model-specific Protocol String
        ↓
Tokenizer
        ↓
Token IDs
```

而不是：

```text
messages[] → tokenizer
```

**已確認事實（官方文件 / 原始碼）：**
- Hugging Face 將 chat template 定義為 Jinja template，並明確要求格式必須匹配模型訓練時使用的格式。
- Multimodal chat template 通常先輸出 `<|image|>` / `<|video|>` 之類 placeholder，再由 processor 展開成實際 image/video token sequence。
- `tools` 會以 JSON schema 形式傳入 template，但 template 可重新排版成模型訓練時所需的其他表示。

來源：
- https://huggingface.co/docs/transformers/main/chat_templating_writing
- https://github.com/huggingface/transformers/blob/main/docs/source/en/chat_templating_writing.md
- https://github.com/huggingface/transformers/blob/main/src/transformers/tokenization_utils_base.py

### 新 failure mode：Streaming Tool Parser 的問題可能發生在「字元 delta 邊界」，即使模型 tokenizer 把 delimiter 視為單一 special token

vLLM 在 2026-08 的實際 issue 中已出現：tool special token 在 upstream proxy / re-chunking 後被切在不同 delta，導致 parser 把 marker 洩漏成一般 content。這個案例非常重要，因為它說明：

```text
Model Token Boundary
≠ Network Chunk Boundary
≠ UTF-8 Character Boundary
≠ Parser Semantic Boundary
```

vLLM 現行 Hermes parser 已明確加入 `partial_tag_overlap()`，在 `<tool_call>` 尚未完整出現時先保留可能是 delimiter 前綴的尾端字串，避免提早把它串流出去。

來源：
- https://github.com/vllm-project/vllm/blob/main/vllm/tool_parsers/hermes_tool_parser.py
- https://github.com/vllm-project/vllm/issues/51701

### 新研究節點：Tokenizer Fertility 應納入 Agent Cost Model

Tokenizer 不只是模型前處理。對不同語言、程式碼、JSON、special protocol，其 token 數量差異會直接傳導到：

```text
Tokenizer Fertility
→ Context Consumption
→ Prefill FLOPs
→ KV Cache Size
→ TTFT
→ Serving Cost
→ Agent Iteration Cost
```

2025 的 multilingual tokenizer 研究仍觀察到高 fertility 與額外成本 / performance 差距；Dolma tokenization analysis 也顯示 code data 的 fertility 可顯著高於一般自然語言資料。

來源：
- https://arxiv.org/abs/2509.05486
- https://arxiv.org/abs/2511.03237
- https://arxiv.org/abs/2402.00159

---

# 二、本小時最重要 5 個發現

## 發現 1：Tokenizer 前面還有一層 Protocol Compilation

### 概念

模型不是直接看到：

```json
{
  "role": "user",
  "content": "幫我查天氣"
}
```

而可能看到類似：

```text
<|system|>
...
<|user|>
幫我查天氣<|eot_id|>
<|assistant|>
```

如果支援 tools，則還可能插入：

```text
<tools>
{...JSON Schema...}
</tools>
```

不同模型可能使用完全不同 delimiter、角色標記、tool schema 表示與 generation header。

### 底層如何運作

```text
messages[]
+
tools[]
+
documents[]
+
multimodal content[]
+
add_generation_prompt
        ↓
Jinja / model-specific chat template
        ↓
Rendered protocol text
        ↓
Special-token-aware tokenizer
        ↓
Token IDs
```

### 為什麼重要

如果 Chat Template 與模型訓練協議不一致，可能出現：

```text
Wrong Role Boundary
Wrong EOS
Wrong Tool Format
Wrong Assistant Start Token
Extra Whitespace
Missing Image Placeholder
```

這些問題不一定會 crash；更危險的是模型仍能生成，但 tool calling、reasoning channel、stop behavior 或角色遵循率悄悄下降。

### 限制

Chat template 本身不是標準化 wire protocol；同一套 OpenAI-style API 仍可能被不同模型 backend 編譯成不同 token protocol。

### 來源

官方 Hugging Face chat templating 文件與 Transformers 原始碼。

---

## 發現 2：Special Token 是「Vocabulary Control Symbol」，不是普通字串

### 概念

像：

```text
<|assistant|>
<tool_call>
</tool_call>
<|image|>
<|eot_id|>
```

在某些模型中可能被註冊成 single token；在另一些模型中可能被拆成多個普通 token。

### 底層如何運作

一般 BPE path：

```text
Unicode text
↓ UTF-8
bytes
↓ regex / pre-tokenization
byte spans
↓ ranked merges
BPE token bytes
↓ vocab lookup
Token IDs
```

Special-token path：

```text
Input text
↓ special-token scan
Recognized control symbol
↓ direct vocabulary mapping
Single special Token ID
```

OpenAI `tiktoken` 的 Rust core 直接在 byte sequence 上做 `byte_pair_encode(piece: &[u8], ranks...)`；它的 Python/Rust bridge 也需要處理 UTF-8 與 byte-level encoding 的邊界。

來源：
- https://github.com/openai/tiktoken/blob/main/src/lib.rs
- https://github.com/openai/tiktoken/blob/main/src/py.rs

### 為什麼重要

如果 tool delimiter 被設定為 special token，但 server 先做 `skip_special_tokens=True`，那 parser 甚至還沒看到 delimiter，它就已被 detokenizer 刪掉。

vLLM 的 Hermes parser 現在明確在 tool calling 啟用時設定：

```text
skip_special_tokens = False
```

因為部分 Hermes model 的 `<tool_call>` token 被 tokenizer 標成 special token；若提前 skip，tool parsing 直接失效。

### 限制

「special token = single token」只對實際 tokenizer config 成立；不能看到字串長得像 `<...>` 就假設它是 special token。

---

## 發現 3：Detokenization 不是簡單的 Token → Character 1:1 映射

### 概念

Byte-level tokenizer 的 token 可能對應：
- 一個完整 Unicode 字元
- 半個 multi-byte UTF-8 字元
- 多個字元
- 空白 + 子詞
- JSON punctuation + prefix

因此 streaming decode 必須處理：

```text
Token Boundary
≠ Character Boundary
```

例如一個 UTF-8 字元在 byte 層可能由多個 bytes 組成；若某個 tokenizer token 分割恰好跨越該字元 byte sequence，單獨 decode token 可能無法形成完整可見字元。

### 底層如何運作

```text
Token ID
↓ vocab[token_id]
Byte Sequence
↓ concatenate with prior pending bytes
UTF-8 decoder
↓ only emit complete code points
Text Delta
```

所以 robust streaming 系統應保留：

```text
pending_bytes
pending_special_prefix
pending_tool_json
```

三種不同 buffer。

### 為什麼重要

若 parser 只看每個 network delta：

```text
Delta 1 = "<tool_"
Delta 2 = "call>"
```

第一段可能被錯誤送到 UI；同理 JSON string escape、Unicode、delimiter 都可能跨 chunk。

### 工程實作證據

vLLM Hermes parser 會：
1. 對完整 `current_text` 重跑 parsing。
2. 用 `partial_tag_overlap` 暫存可能的 `<tool_call>` 前綴。
3. 使用累積的 `streamed_args_for_tool` 對 tool arguments 做 diff。
4. 對尚未完整的 JSON 區域持續判斷 `is_complete_json()`。

這是一個典型的 incremental semantic parser，而不是單純 regex-on-delta。

來源：
- https://github.com/vllm-project/vllm/blob/main/vllm/tool_parsers/hermes_tool_parser.py

---

## 發現 4：Tool Calling 有「兩個 Parser」，不能混成一個

Agent Tool Call 的完整資料路徑應拆成：

```text
Tool Definitions
↓
Input-side Tool Protocol Compiler
↓
Tokenizer
↓
Model
↓
Generated Token IDs
↓
Detokenizer
↓
Output-side Tool Protocol Parser
↓
Structured ToolCall
↓
Schema Validator
↓
Authorization
↓
Executor
```

第一個 parser/compiler 是：

```text
Structured tools[]
→ model-specific prompt protocol
```

第二個 parser 是：

```text
model-specific generated protocol
→ Structured ToolCall
```

這兩者格式必須互相匹配模型訓練時的 contract。

### 為什麼重要

API 看起來可能都是：

```json
{"tools": [...]}
```

但是 backend 可能轉成：

```text
<tools> JSON </tools>
```

或 Python-like signatures、XML、special control tokens、function markers。

Hugging Face 官方文件甚至明確指出，Command-R 類模型可能將傳入的 JSON Schema 轉成 Python function header，因為那才是模型訓練時看過的格式。

所以：

```text
API Tool Schema
≠ Model Tool Protocol
```

### 限制

目前沒有跨所有模型一致的 internal token-level tool protocol；OpenAI API compatibility 只能標準化外部 schema，無法保證內部 token grammar 相同。

---

## 發現 5：Multimodal Placeholder 是 text protocol 與 encoder token topology 的交界

### 概念

Multimodal message：

```text
[{type:"text", ...}, {type:"image", ...}]
```

通常不是直接把 pixel 塞給 tokenizer。

Hugging Face 的 multimodal template 文件描述的是：

```text
Message
↓
Chat Template emits <|image|>
↓
Processor
↓
Image preprocessing / encoder preparation
↓
<|image|> expands to image/video token sequence or placeholder topology
↓
Language model input assembly
```

因此多模態總鏈應修正為：

```text
Camera/Image
→ Vision Processor
→ Image Embeddings / Tokens
        ↘
Text → Chat Template → Text Tokens
        ↓
Multimodal Input Assembly
→ Transformer
```

而不是簡化成：

```text
image → tokenizer
```

### 為什麼重要

這個 placeholder 會同時影響：
- text token positions
- image token positions
- RoPE / multimodal position IDs
- context length accounting
- prefix caching
- attention topology

因此 `<|image|>` 看起來只有一個字串，但 runtime 最後可能代表數百到數千個模型內部 tokens / embeddings。

### 來源

Hugging Face 官方 multimodal chat template 文件。

---

# 三、Architecture Breakdown

本輪將「使用者一句話」到 Token IDs 的路徑正式還原為：

```text
User Input
↓
UI Message Object
↓
Agent Message Normalizer
↓
Conversation State
├ System Instructions
├ User Messages
├ Assistant Messages
├ Tool Results
├ Tool Schemas
├ Retrieved Documents
└ Multimodal Parts
↓
Protocol Compiler
├ Chat Template
├ Role Mapping
├ Tool Definition Renderer
├ Generation Prompt
├ Special Token Insertion
└ Multimodal Placeholder Insertion
↓
Rendered Model Protocol
↓
Tokenizer Front-End
├ Unicode normalization? (tokenizer-specific)
├ Regex / Pre-tokenizer
├ Byte conversion
└ Special-token matcher
↓
Subword Algorithm
├ BPE
└ Unigram / SentencePiece
↓
Vocabulary Lookup
↓
Token IDs
↓
Embedding Lookup
↓
Transformer
↓
LM Head / Logits
↓
Sampler
↓
Generated Token IDs
↓
Incremental Detokenizer
├ Token bytes
├ UTF-8 reconstruction
├ Special-token handling
└ Pending-byte buffer
↓
Protocol Stream Parser
├ Content parser
├ Tool delimiter detector
├ Partial-tag buffer
├ Incremental JSON parser
└ Reasoning/channel parser
↓
Structured Model Output
├ content
├ reasoning
└ tool_calls[]
↓
Agent Runtime
```

這條鏈把先前研究的：

```text
Context Compiler
→ Tokenizer
→ Transformer
→ GPU
→ Logits
→ Sampling
→ Token
→ Tool Call
```

第一次補完整。

---

# 四、Bottom-Level Logic

## 4.1 Byte-level BPE

以簡化 BPE 為例：

```text
"lowest"
↓ UTF-8 bytes
[l][o][w][e][s][t]
↓ merge rank lookup
[lo][w][e][s][t]
↓
[low][e][s][t]
↓
[low][est]
↓ vocab
[id_1, id_2]
```

真實 GPT-style byte BPE 通常還會先經 regex/pre-tokenization，並以 byte sequence 而非 Unicode character 作為 merge 的基礎單位。

`tiktoken` core 的 `byte_pair_encode()` 直接接受 `&[u8]`，證實 merge 層的原始物件就是 bytes。

## 4.2 SentencePiece / Unigram

SentencePiece 的重要差異是可以從 raw sentences 直接訓練 subword model，而不是要求上游已經先用語言特定 word tokenizer 切詞；它支援 BPE 與 unigram language model 類 subword segmentation。

來源：
- Taku Kudo, John Richardson, **SentencePiece: A simple and language independent subword tokenizer and detokenizer for Neural Text Processing**, 2018.
- https://arxiv.org/abs/1808.06226
- Code: https://github.com/google/sentencepiece

## 4.3 Special-token fork

Tokenizer 實際更像：

```text
Input
↓
Find next allowed special token
├ found → emit dedicated special ID
└ not found
    ↓
    ordinary tokenizer path
    ↓
    regex → bytes → BPE → IDs
```

所以 special token 其實是 tokenizer vocabulary 裡的一條控制平面。

## 4.4 Streaming Tool Call

Hermes-style：

```text
Generated IDs
↓
Decoded accumulated text
↓
"I'll check...<tool_call>{\"name\":\"search\",\"arguments\":{..."
↓
Parser State
├ content sent until delimiter
├ tool name recognized
├ args prefix recognized
└ JSON incomplete
↓ next tokens
"}}</tool_call>"
↓
JSON complete
↓
ToolCall object
```

在 parser state 尚未確定 `<tool_call>` 是否完整時，應 hold back suffix，而不能直接送到 user-visible content。

---

# 五、System Architecture 深拆：vLLM Hermes Tool Parser

本輪選定 `vllm-project/vllm` 的 Hermes parser 作為 system architecture 深拆。

值得看的核心檔案：

```text
vllm/
├ tool_parsers/
│  ├ abstract_tool_parser.py
│  ├ hermes_tool_parser.py
│  ├ utils.py
│  └ ...model-specific parsers
├ entrypoints/
│  └ openai/
│     └ chat_completion/
└ tokenizers/
```

`Hermes2ProToolParser` 的重要 runtime 行為：

```text
adjust_request()
↓
if tools active:
    skip_special_tokens = False

extract_tool_calls()
↓
non-streaming full-text parse

extract_tool_calls_streaming()
↓
accumulated current_text
↓
_extract_content()
├ detect full <tool_call>
└ hold partial prefix with partial_tag_overlap
↓
_extract_tool_call_jsons()
├ complete region
└ incomplete region
↓
_extract_tool_name()
↓
_compute_args_diff()
↓
DeltaToolCall
```

這個架構的重要意義：

> **Tool streaming parser 必須以 protocol state 為中心，而不能假設 network delta、token delta 或 JSON field boundary 彼此對齊。**

### 已確認工程實作

目前 vLLM Hermes parser 對 streaming 使用累積 `current_text` 再解析，而非只解析 `delta_text`；同時維護已送出的 content index 與每個 tool 的 arguments 長度，以輸出增量 diff。

### 限制

這類 parser 仍高度 model-specific，Hermes、Jamba、Cohere、FunctionGemma、GigaChat 等都維護不同 parser。這反映目前 tool protocol 還未在 model-token layer 統一。

---

# 六、Visual Simulation Idea

## Token / Protocol X-Ray

建議 Hermes Console 新增一個可互動視覺模擬器：

```text
[ Structured Messages ]
        ↓
[ Chat Template ]
        ↓
[ Rendered Protocol ]
        ↓
[ UTF-8 Bytes ]
        ↓
[ Tokenizer Merge Tree ]
        ↓
[ Token IDs ]
        ↓
[ Model Output IDs ]
        ↓
[ Streaming Bytes/Text ]
        ↓
[ Tool Parser State ]
        ↓
[ Structured ToolCall ]
```

### 左側：Input Protocol Compiler

使用者輸入：

```json
{
  "role": "user",
  "content": "幫我搜尋台北天氣"
}
```

工具：

```json
{
  "name": "search_weather",
  "parameters": {
    "city": "string"
  }
}
```

畫面逐步顯示：

```text
messages + tools
↓ Jinja
<|user|>幫我搜尋台北天氣...<tools>...</tools><|assistant|>
↓ tokenizer
[128006, 882, ...]
```

### 中央：Tokenizer Viewer

對每個 token 顯示：

```text
Token ID
Byte Sequence
Decoded Fragment
Special?
Merge Parents
Token Cost
Position
```

可點選中文、emoji、JSON、英文、code，看 fertility 差異。

### 右側：Streaming Tool Protocol

動畫：

```text
Delta #1:  "<tool_"
Parser: HOLD

Delta #2:  "call>{\"name\""
Parser: TOOL MODE

Delta #3:  ":\"search_weather\",\"arguments\":{"city":"台"
Parser: partial JSON

Delta #4:  "北\"}}</tool_call>"
Parser: COMPLETE
```

並提供 failure injection：

```text
Split UTF-8 byte
Split special token string
Drop special tokens
Wrong chat template
Wrong EOS
Duplicate BOS
Extra whitespace
Malformed JSON
Proxy re-chunking
```

### 最有教育價值的模式

**Same API, Different Model Protocol**

```text
OpenAI-style messages/tools
↓
Model A template
→ token sequence A

OpenAI-style messages/tools
↓
Model B template
→ token sequence B
```

讓使用者直觀看到：

> **API 相同，不代表模型實際看到的 token protocol 相同。**

---

# 七、Code / GitHub

## 1. OpenAI tiktoken

Repository: https://github.com/openai/tiktoken

值得看：

```text
src/
├ lib.rs
└ py.rs
```

核心：
- byte-level BPE merge
- special token handling
- ordinary encode / decode bridge
- UTF-8 ↔ raw byte 邊界

## 2. Hugging Face Transformers

Repository: https://github.com/huggingface/transformers

值得看：

```text
src/transformers/
├ tokenization_utils_base.py
├ processing_utils.py
└ tokenization_mistral_common.py

docs/source/en/
└ chat_templating_writing.md
```

核心：
- chat template loader
- standalone `.jinja` template
- named `tool_use` template
- `tools` / `documents`
- multimodal processor template
- special token map

## 3. vLLM

Repository: https://github.com/vllm-project/vllm

值得看：

```text
vllm/tool_parsers/
├ abstract_tool_parser.py
├ hermes_tool_parser.py
├ gigachat3_tool_parser.py
├ functiongemma_tool_parser.py
└ utils.py
```

核心：
- special-token preservation
- accumulated streaming parsing
- partial delimiter detection
- partial JSON
- tool argument incremental diff

## 4. Google SentencePiece

Repository: https://github.com/google/sentencepiece

值得研究：
- BPE vs Unigram
- normalization
- byte fallback
- raw sentence training

---

# 八、Papers

## Paper 1 — SentencePiece

**Title:** SentencePiece: A simple and language independent subword tokenizer and detokenizer for Neural Text Processing  
**Authors:** Taku Kudo, John Richardson  
**Institution:** Google  
**Year:** 2018  
**URL:** https://arxiv.org/abs/1808.06226  
**Code:** https://github.com/google/sentencepiece  
**Dataset:** English–Japanese NMT experimental corpora（論文驗證）  
**Architecture:** raw text → normalization → subword segmentation (BPE / Unigram) → IDs  
**Contribution:** 讓 tokenizer 可直接從 raw sentences 訓練，降低對語言特定 pre-tokenizer 的依賴。  
**Limitations:** tokenizer vocabulary 仍是固定離散單位；不同語言 / domain 的 fertility 仍會不同。

**改變了什麼：** 把 subword tokenization 從「word-tokenized corpus 後處理」推向 end-to-end raw-text pipeline。

## Paper 2 — The Token Tax

**Title:** The Token Tax: Systematic Bias in Multilingual Tokenization  
**Authors:** Jessica M. Lundin et al.  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2509.05486  
**Dataset:** AfriMMLU，16 African languages  
**Architecture:** tokenizer fertility analysis + downstream QA evaluation  
**Contribution:** 將 multilingual tokenization inefficiency 與 accuracy / computational cost 聯繫。  
**Limitations:** 結論來自特定模型與 benchmark；不能直接推廣成所有語言與模型的因果律。

**改變了什麼：** 讓 tokenizer 從「預處理細節」升級成 fairness / cost / capability 的系統變數。

## Paper 3 — IndicSuperTokenizer

**Title:** IndicSuperTokenizer: An Optimized Tokenizer for Indic Multilingual LLMs  
**Authors:** Souvik Rana, Arul Menezes, Ashish Kulkarni, Chandra Khatri, Shubham Agarwal  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2511.03237  
**Architecture:** language-specific pre-tokenization + subword + multi-word tokenization  
**Contribution:** 針對 Indic languages 降低 fertility；論文報告其 benchmark 中的 throughput 改善。  
**Limitations:** domain / model / hardware 特定；不是通用 tokenizer 最優解。

**改變了什麼：** 強化「tokenizer design 直接影響 inference throughput」這個工程觀點。

---

# 九、Known Facts / Engineering Inference / Hypotheses

## 已確認事實

1. Chat template 會直接決定 role、EOS、assistant generation prompt、tool schema 等如何進入模型輸入。
2. Transformers 對 multimodal template 建議輸出 image/video placeholder，再交給 processor 展開。
3. tiktoken BPE core 在 byte sequence 上進行 merge。
4. vLLM Hermes parser 在 tool calling 時會避免先 skip special tokens。
5. vLLM streaming tool parser 會處理 partial tag 與 partial JSON。

## 工程推論

1. **Chat Template Version 應與 Model Revision 一起被 pin。** 否則只更新 template，也可能改變同一 API request 的 token protocol。
2. Hermes Console 應把 `protocol_hash` 納入 trace：

```text
model_id
+ tokenizer_hash
+ chat_template_hash
+ tool_parser_id
+ generation_config_hash
```

這能讓「相同 prompt 為何今天 tool call 壞了」變得可追蹤。
3. Tool parser 應以 accumulated semantic stream 為主要 truth，而不是 network chunk。

## 尚未驗證假說

1. **Agent Protocol Compatibility Benchmark**：若固定模型權重，只改 chat template / tool serializer，可量測 tool-call success 對 protocol drift 的敏感度。
2. **Tokenizer-aware Context Compiler**：context ranker 不只看 semantic utility，還應考慮 token fertility / compression cost，例如同義 structured summary 若少 40% tokens，可能在長任務具有更高 utility-per-token。
3. **Protocol Prefix Stability → Prefix Cache Hit**：固定 system/tool schema serialization 排序與 whitespace，可能提高 prefix cache reuse；需要在 Hermes 真實 serving stack benchmark 驗證。

---

# 十、Unknown / Open Questions

## 1. Protocol Versioning

目前模型、tokenizer、chat template、tool parser 常以不同 release cadence 更新。真正缺少的是：

```text
Model Protocol Manifest
├ model revision
├ tokenizer revision
├ special token map
├ chat template
├ tool parser
├ reasoning parser
└ stop tokens
```

是否應像 ABI / wire protocol 一樣正式 versioning？

## 2. Streaming Semantic Boundary

最穩定的工具串流 parser 到底應建立在：

```text
Token IDs
vs
Decoded Text
vs
Byte Stream
vs
Parser Events
```

哪一層？

Token ID 層最接近模型，但 model-specific；Text 層最通用，但會碰 UTF-8、special token stripping、proxy re-chunking。

## 3. Multimodal Placeholder Accounting

`<|image|>` 在 template 中可能只有一個 placeholder，但 processor 展開後的真正 token/embedding footprint 很大。Context Compiler 是否應在 template rendering 之前就知道其「預估展開成本」？這對 multimodal budget allocation 很重要。

---

# 十一、Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Model Protocol Layer
├ Chat Template
├ Protocol Compiler
├ Role Token
├ Generation Prompt
├ Special Token
├ Stop Token
├ Tool Definition Serializer
├ Tool Output Parser
├ Reasoning / Channel Parser
└ Protocol Version
```

```text
Tokenizer Runtime
├ Unicode Input
├ UTF-8 Bytes
├ Pre-tokenizer
├ Byte-level BPE
├ SentencePiece
├ Unigram
├ Vocabulary
├ Merge Rank
├ Token ID
├ Detokenizer
├ Pending Byte Buffer
└ Fertility
```

```text
Streaming Semantic Runtime
├ Token Delta
├ Byte Delta
├ Text Delta
├ Network Chunk
├ Partial Delimiter
├ Partial JSON
├ Parser State
└ Semantic Event
```

```text
Multimodal Protocol Bridge
├ Image Placeholder
├ Video Placeholder
├ Audio Placeholder
├ Processor Expansion
└ Encoder Token Footprint
```

## 新 Edges

```text
messages[]
→ compiled_by
Chat Template

Chat Template
→ emits
Special Tokens

Tools JSON Schema
→ serialized_by
Tool Definition Renderer

Rendered Protocol
→ encoded_by
Tokenizer

Tokenizer Fertility
→ increases
Context Cost

Token IDs
→ decoded_to
Byte Stream

Byte Stream
→ reconstructed_as
Text Stream

Text Stream
→ interpreted_by
Tool Parser

Tool Parser
→ emits
Structured ToolCall

Multimodal Placeholder
→ expanded_by
Processor

Processor Expansion
→ changes
Context Footprint
```

新增一條非常重要的否定關係：

```text
API Message Schema
≠ Model Token Protocol
```

以及：

```text
Token Boundary
≠ UTF-8 Character Boundary
≠ Network Chunk Boundary
≠ Tool Semantic Boundary
```

---

# 十二、下一輪研究

下一輪應進入：

# **Embedding × Vocabulary Matrix × Weight Tying × RMSNorm/LayerNorm × Residual Stream**

因為現在文字已經被轉成：

```text
Token ID
```

下一步就是回答：

```text
Token ID
↓
Embedding Lookup
↓
Residual Stream
↓
RMSNorm / LayerNorm
↓
Attention
↓
Residual Add
↓
FFN / MoE
↓
Residual Add
↓
Final Norm
↓
LM Head
↓
Logits
```

核心問題：
- Token embedding 到底是一列 matrix lookup，還是「理解字義」？
- Input embedding 與 LM head weight tying 改變什麼？
- Residual stream 為什麼是 Transformer 信息流的主幹？
- Pre-Norm / Post-Norm 對深層訓練穩定性差在哪？
- RMSNorm 為什麼不減 mean 仍能有效？
- hidden state 如何一步步從 token identity 變成 contextual representation？

---

# 十三、本輪結束檢查

**缺哪一層：** Token ID → Embedding → Residual Stream。  
**哪個節點最淺：** Streaming parser 應以 token/byte/text 哪一層作 canonical truth。  
**哪個概念仍只是名詞：** Model Protocol ABI / Protocol Manifest。  
**哪個系統值得讀原始碼：** Hugging Face `apply_chat_template` 全 path、vLLM `abstract_tool_parser` + Hermes/GigaChat parser、tiktoken Rust core。  
**哪篇論文需追引用：** SentencePiece 與 2025 multilingual tokenizer fertility / token-tax 系列。  
**哪個概念最適合視覺模擬：** Token / Protocol X-Ray。  
**哪個 Agent 架構最值得實作：** `Protocol Compiler → Tokenizer → Stateful Streaming Parser → Structured ToolCall`，並將 model/tokenizer/template/parser 四者版本鎖定。

---

# 本輪核心結論

> **模型不是直接理解 `messages[]`、JSON 或圖片。Agent Runtime 先用 Chat Template 把結構化對話編譯成模型專屬協議，再由 tokenizer 把 Unicode/bytes/special tokens 轉成 Token IDs；輸出時則反向經過 detokenization 與 stateful protocol parser，才重新得到 content、reasoning 與 tool calls。API schema、token boundary、network chunk、UTF-8 character、tool semantic boundary 是五個不同層，可靠 Agent Runtime 必須把它們分開。**
