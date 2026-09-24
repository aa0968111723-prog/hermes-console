# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 08:51 Asia/Taipei

## 本小時研究主題
**Committed Token → Detokenization → Stop Semantics → Streaming Chunk → RequestOutput → UI-visible Text Lineage**

本輪承接上一輪 `TokenGenerationWitnessV2`，避免重複 sampling/KV/GPU provenance，向 output boundary 下鑽：模型已經 commit 的 token IDs，如何變成使用者或 Agent 真正看到的文字，以及 stop logic、incremental decoding、special tokens、stream aggregation 如何改變 observable output。

---

## 本小時新發現

### 1. Committed token sequence 不等於 UI-visible text
**已確認事實 / 官方文件 + 原始碼。** Hugging Face tokenizer `decode()` 本身依 vocabulary/tokenizer generation 與 `skip_special_tokens` 等設定把 IDs 轉成字串；不同 decoder（ByteLevel、WordPiece、Metaspace）有不同 reconstruction 規則。vLLM current `FastIncrementalDetokenizer` 使用 tokenizers `DecodeStream`，slow path 則使用 `detokenize_incrementally()`。

因此：

`CommittedTokenGeneration --does_not_prove→ VisibleTextGeneration`

新增：

`TokenizerDecodeGeneration = H(tokenizerArtifact, vocab, addedTokens, decoderType/config, skipSpecialTokens, spacesBetweenSpecialTokens)`

### 2. Incremental detokenization 是 state machine，不是逐 token 字串 lookup
**已確認工程實作。** vLLM fast path用 `DecodeStream`，以 prompt IDs prefill decoder state，然後逐 token `step()`；遇到 invalid-prefix edge case甚至會 reset stream。slow path保存 `tokens / prefix_offset / read_offset`，用前序狀態進行 incremental detokenization。

因此：

`TokenID[n] → TextFragment[n]`

不是純函式；更接近：

`DecoderState[n-1] + TokenID[n] → DecoderState[n] + TextDelta[n]`

新增 `IncrementalDecoderStateGeneration`。

### 3. Stop-string policy 能讓 token stream 與 visible text stream 分岔
**已確認工程實作。** vLLM `BaseIncrementalDetokenizer.update()` 先 detokenize，再執行 stop-string check；若 stop string不包含於 output，會 truncate `output_text`。若 engine 已以 stop token 終止且 `include_stop_str_in_output=False`，最後 token仍可進 token history，但被排除於 detokenization。為避免 streamed text 提前洩漏可能形成 stop string 的 suffix，vLLM保留 `max_stop_length - 1` chars 的 buffer。

因此：

`OutputTokenIds ≠ VisibleCharacterSequence`

在設計上是合法狀態，不應被 Hermes 誤判為資料遺失。

新增 `StopPolicyGeneration`、`StopMatchWitness`、`VisibleTextTruncationGeneration`。

### 4. speculative decoding 讓 stop ordering 成為明確語意
**已確認工程實作。** current `check_stop_strings()` 對一次加入多個 tokens/characters 的情況，選擇「最早完成」的 stop string，使結果等價於逐 token append；若 completion endpoint相同則以 stop-list order tie-break。

所以：

`Same decoded buffer + Different stop list order`

在特定 tie case可能有不同 `stop_reason`，即使 visible prefix相同。

新增 `StopResolutionOrderIdentity`。

### 5. Streaming output 有另一層 aggregation/ordering semantics
**已確認工程實作。** vLLM `RequestOutputCollector`在 DELTA mode下可在 producer跑得比 consumer快時 merge outputs；`RequestState._new_completion_output()`又依 DELTA / non-DELTA決定回傳增量文字或完整文字，並以 `_last_output_text_offset`維護已送出的字元 offset。`stream_interval`可使多個 generated tokens合併後才形成 output。

因此：

`GenerationStep ≠ NetworkChunk ≠ UIChunk`

新增 `OutputChunkGeneration`、`StreamAggregationGeneration`、`RequestOutputBindingWitness`。

---

# 本小時最重要 5 個發現

## 1. Token lineage 必須跨過 tokenizer boundary
**概念：** `TokenizerDecodeGeneration`

**底層：**
`Committed token IDs → tokenizer/vocab → added-token map → decoder → Unicode string`

**重要性：** 相同 token IDs若配上不同 tokenizer artifact / added tokens / decoder config，不保證相同文字。

**限制：** 尚未把 tokenizer artifact hash與 model generation做強制 binding。

## 2. Incremental decoder state 是 provenance node
**概念：** `IncrementalDecoderStateGeneration`

**底層：**
`Prompt decode state → token step → partial Unicode-safe text → next decoder state`

**重要性：** streaming decode不能只保存 token ID與最後字串；要能重建 decoder state transition。

**限制：** Fast/slow tokenizer path並非同一 implementation。

## 3. Stop logic 是 output transformation，不只是 termination flag
**概念：** `StopMatchWitness`

**底層：**
`Decoded text → newly-generated-char window → stop search → earliest completion → include/exclude policy → truncation`

**重要性：** 最終 visible text可能不是 committed tokens完整 decode。

**限制：** token-stop、string-stop、EOS、length stop仍需統一建模。

## 4. Streaming transport需要獨立 generation
**概念：** `StreamAggregationGeneration`

**底層：**
`Generated token steps → detokenized deltas → holdback buffer → stream interval → RequestOutputCollector merge → consumer`

**重要性：** UI看到的 chunk boundary不是 model generation boundary。

**限制：** 本輪尚未深入 SSE/WebSocket/HTTP transport與前端 render ordering。

## 5. Agent observation不能直接等於 model token output
**概念：** `AgentObservationGeneration`

**底層：**
`TokenGenerationWitness → DecodeWitness → StopWitness → StreamWitness → Transport/UI witness → Observation`

**重要性：** 對 tool-using agent，下一輪 reasoning吃的是 observation text；如果 output boundary provenance斷裂，後續 planning/tool call lineage也斷裂。

**限制：** tool-call structured parser尚未納入。

---

# Architecture Breakdown

```text
TokenGenerationWitnessV2
  ↓
CommittedTokenSequenceGeneration
  ↓
TokenizerDecodeGeneration
  ├─ tokenizer artifact
  ├─ vocabulary
  ├─ added tokens
  ├─ decoder config
  ├─ skip_special_tokens
  └─ spaces_between_special_tokens
  ↓
IncrementalDecoderStateGeneration
  ↓
DecodedTextGeneration
  ↓
StopPolicyGeneration
  ↓
StopMatchWitness / VisibleTextTruncationGeneration
  ↓
OutputChunkGeneration
  ↓
StreamAggregationGeneration
  ↓
RequestOutputBindingWitness
  ↓
Transport/UI (next gap)
  ↓
AgentObservationGeneration
```

## System architecture 深拆：vLLM output boundary

```text
EngineCoreOutput.new_token_ids
 → RequestState
 → IncrementalDetokenizer.update()
 → DecodeStream.step() / detokenize_incrementally()
 → output_text
 → check_stop_strings()
 → get_next_output_text(finished, delta)
 → CompletionOutput(text, token_ids, finish_reason, stop_reason)
 → RequestOutput
 → RequestOutputCollector
 → async consumer
```

這條 pipeline證明 serving runtime的 output並不是「model token直接送到 UI」。它是一個有 state、policy、buffering、request binding與 aggregation的 runtime subsystem。

---

# Bottom-Level Logic

## Fast incremental decode

```text
PromptTokenIds
 → DecodeStream(ids=prompt)
 → next_token_id
 → stream.step(tokenizer, token_id)
 → text fragment or None
 → output_text += fragment
```

Special/added token spacing policy可再改寫 fragment。

## Slow incremental decode

```text
all_input_ids
 + prev_tokens
 + prefix_offset
 + read_offset
 + tokenizer config
 → detokenize_incrementally()
 → new_tokens
 → decoded_text
 → new prefix/read offsets
```

## Stop string

```text
output_text
 + new_char_count
 + stop strings
 → search only relevant suffix window
 → earliest finishing match
 → include_stop_str ? end-of-stop : beginning-of-stop
 → truncate visible output
```

## Streaming

```text
visible output_text
 → stop suffix holdback
 → DELTA offset
 → stream_interval gate
 → CompletionOutput
 → RequestOutputCollector merge
 → consumer
```

---

# Visual Simulation Idea

## Token → Visible Text Lineage Microscope

互動欄位：

`Committed Tokens | Tokenizer/Vocab | Decode State | Unicode/Text | Stop Matcher | Holdback Buffer | Stream Chunks | Request Binding | UI/Agent Observation`

可注入故障：

- `TOKENIZER_GENERATION_CHANGED`
- `ADDED_TOKEN_MAP_CHANGED`
- `SKIP_SPECIAL_TOKENS_CHANGED`
- `FAST_SLOW_DECODER_DIVERGENCE`
- `INVALID_PREFIX_STREAM_RESET`
- `STOP_STRING_SPLIT_ACROSS_CHUNKS`
- `STOP_LIST_ORDER_CHANGED`
- `STOP_SUFFIX_LEAKED_BEFORE_MATCH`
- `DELTA_OFFSET_REPLAYED`
- `REQUEST_OUTPUT_MERGED_WRONG_INDEX`
- `STREAM_CHUNK_DUPLICATED`
- `STREAM_CHUNK_REORDERED`

視覺上同時畫兩條 timeline：

1. **semantic timeline**：token → decoded chars → visible chars
2. **delivery timeline**：visible chars → chunks → transport → UI

---

# Code / GitHub

## vLLM
值得持續閱讀：

- `vllm/v1/engine/detokenizer.py`
  - `IncrementalDetokenizer`
  - `BaseIncrementalDetokenizer.update`
  - `FastIncrementalDetokenizer`
  - `SlowIncrementalDetokenizer`
  - `check_stop_strings`
- `vllm/v1/engine/output_processor.py`
  - `RequestState`
  - `RequestState._new_completion_output`
  - `RequestOutputCollector`
- `vllm/tokenizers/detokenizer_utils.py`
- 下一輪：API server SSE/stream response、structured output/tool parser

## Hugging Face Tokenizers / Transformers
值得看的底層：

- tokenizer `decode / batch_decode`
- `AddedToken`
- ByteLevel decoder
- WordPiece decoder
- Metaspace decoder
- Rust tokenizers DecodeStream implementation

---

# Papers / Technical References

本輪重點主要是 serving/tokenizer工程原始碼而非新增模型論文。應補追的研究線：

1. **Neural Machine Translation of Rare Words with Subword Units** — Sennrich, Haddow, Birch, 2016。BPE/subword背景；限制：不是現代 serving incremental-detokenization研究。
2. **SentencePiece: A simple and language independent subword tokenizer and detokenizer for Neural Text Processing** — Kudo & Richardson, 2018。Institution: Google；提供 language-independent tokenizer/detokenizer；限制：不處理 LLM streaming output lineage。
3. 後續應研究 byte-level tokenizer、UTF-8 streaming correctness與 structured generation/parser consistency。

---

# 已確認 / 推論 / 未驗證

**已確認事實：** vLLM current output pipeline包含 incremental detokenization、stop-string truncation、stop suffix holdback、DELTA/full output與 output collector aggregation；Hugging Face decode semantics受 tokenizer與 decode options影響。

**工程架構推論：** Hermes應把 tokenizer/decoder/stop/streaming各自建成 generation，而不是只保存 final text。

**尚未驗證假說：** 可以用低成本 rolling hash/Merkle event stream，在不保存完整敏感文字的前提下證明 token→visible-text transformation lineage。

---

# Unknown / Open Questions

1. 如何定義跨 Hugging Face fast/slow tokenizer implementation都可重播的 `DecodeStateWitness`？
2. SSE/WebSocket/HTTP2層如何建立 chunk sequence identity並偵測 duplicate/reorder/drop？
3. tool-call JSON / XML / grammar parser是在 visible-text之前還是之後建立 Agent observation？其 parser state如何與 token lineage綁定？

---

# Knowledge Graph 新增 Node / Edge

## Nodes
- `TokenizerArtifactIdentity`
- `VocabularyGeneration`
- `AddedTokenGeneration`
- `TokenizerDecodeGeneration`
- `IncrementalDecoderStateGeneration`
- `DecodedTextGeneration`
- `StopPolicyGeneration`
- `StopResolutionOrderIdentity`
- `StopMatchWitness`
- `VisibleTextTruncationGeneration`
- `OutputChunkGeneration`
- `StreamAggregationGeneration`
- `RequestOutputBindingWitness`
- `AgentObservationGeneration`

## Edges
- `CommittedTokenGeneration --decoded_by→ TokenizerDecodeGeneration`
- `TokenizerDecodeGeneration --advances→ IncrementalDecoderStateGeneration`
- `IncrementalDecoderStateGeneration --emits→ DecodedTextGeneration`
- `StopPolicyGeneration --transforms→ DecodedTextGeneration`
- `StopMatchWitness --truncates→ VisibleTextTruncationGeneration`
- `VisibleTextTruncationGeneration --chunked_as→ OutputChunkGeneration`
- `OutputChunkGeneration --aggregated_by→ StreamAggregationGeneration`
- `StreamAggregationGeneration --bound_to→ RequestOutputBindingWitness`
- `RequestOutputBindingWitness --feeds→ AgentObservationGeneration`

---

# 與歷史研究比較

上一輪回答的是：`hidden/logits → sampling → committed token`。

本輪第一次補齊：`committed token → decoded/visible text → streamed request output`。

所以不重複 sampling provenance，而是新增一個之前缺失的 **Output Semantics Plane**。目前端到端鏈變為：

```text
User
→ UI
→ Agent
→ Context
→ Model
→ GPU
→ KV/Attention
→ Logits
→ Sampling
→ Committed Token
→ Tokenizer/Decoder
→ Stop Semantics
→ Streaming Output
→ [Transport/UI gap]
→ Agent/User Observation
```

---

# 本輪結束判定

**缺哪一層：** RequestOutput → SSE/WebSocket/HTTP transport → frontend event reducer → DOM/UI text → Agent observation/tool parser。

**哪個節點最淺：** `RequestOutputBindingWitness` 到真正 transport-delivered chunk的 binding。

**哪個概念仍只是名詞：** portable `DecodeStateWitness` 與 `AgentObservationWitness`。

**哪個系統值得讀原始碼：** vLLM API streaming server + OpenAI-compatible protocol output path + structured/tool-call parser。

**哪篇論文需追引用：** SentencePiece 2018，並沿引用追 byte-level/streaming tokenizer correctness研究。

**哪個概念最適合視覺模擬：** `Token → Visible Text Lineage Microscope`。

**哪個 Agent 架構最值得實作：** `Risk-aware Agent Runtime + TokenGenerationWitness + Output Semantics Plane + Transport/Observation Witness + Tool/MCP SemanticCommit`。

---

# 下一輪研究

鎖定：

`RequestOutput → OpenAI-compatible streaming protocol → SSE event/data frame → network delivery → client parser → chunk sequence → tool-call delta assembly → structured-output parser → UI renderer / Agent Observation → ObservationGenerationWitness`

核心問題：

**即使 committed token、tokenizer decode、stop logic與 server-side RequestOutput全部可信，Hermes 如何證明 Agent/User 最終消費的文字或 tool-call arguments，確實由同一 request generation 的 ordered stream chunks組成，沒有在 transport、client aggregation、tool-call delta assembly或 UI reducer中被 duplicate、drop、reorder、cross-request mix 或重新解析成不同語意？**
