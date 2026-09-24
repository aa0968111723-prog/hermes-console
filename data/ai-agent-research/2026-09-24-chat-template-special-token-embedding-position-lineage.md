# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 12:51（Asia/Taipei）

## 本小時研究主題
**Context Assembly → Chat Template → Role/Control Tokens → Token IDs → Embedding Lookup → Position/RoPE → Model Semantic State**

本輪直接承接上一輪 `NextModelInvocationWitness` 的缺口，不再重複 RAG/compaction，而是追查：**即使 ordered context items 完全正確，模型實際接收的 token sequence 與初始 hidden-state semantics 是否仍可能不同？**

---

## 與歷史研究比較
上一輪已建立：

`Session/Memory/RAG → Compaction/Truncation → Ordered Context → TokenizedModelInputGeneration → NextModelInvocationWitness`

並明確留下缺口：

`exact model-input items → chat template/control tokens → embedding/position semantic binding`

本輪填補這一段：

`Ordered Context Items → Template Selection → Template Variables → Rendered Prompt → Special/Control Tokens → Tokenizer Generation → Token IDs → Embedding Rows → Position IDs/RoPE → Initial Model Semantic State`

因此本輪不是「Tokenizer 是什麼」的概論，而是建立 **Prompt Compilation / Semantic Binding provenance**。

---

# 本小時新發現

## 1. Chat template 是 prompt compiler，不只是字串格式化
**狀態：官方資訊 + 工程實作確認。**

Hugging Face Transformers 官方文件明確說明，chat model 底層仍是 continuation language model；chat template 會把 `role/content` messages 轉成模型訓練時預期的 control-token sequence。`add_generation_prompt` 還會加入 assistant-response 起始 token。若 template 已加入 BOS/EOS，再次 tokenization 時又自動加入 special tokens，會造成 duplicated special tokens 並傷害模型表現。

來源：
- https://huggingface.co/docs/transformers/main/chat_templating
- https://huggingface.co/docs/transformers/v4.44.2/chat_templating
- https://github.com/huggingface/transformers/blob/f324707307757d9c0b8dac1c4462eceff911fa2f/docs/source/en/chat_templating.md

因此：

`Same Messages --does_not_prove→ Same Token Sequence`

需要：

`ChatTemplateGeneration = H(template bytes, template engine/version, special-token map, default kwargs, request overrides)`

以及：

`PromptCompilationWitness = H(ordered context items, template generation, template variables, rendered prompt digest, tokenization policy)`

---

## 2. vLLM current runtime 允許 per-request template override；tools/documents/kwargs 都能改變 prompt
**狀態：原始碼確認。**

current vLLM Rust HF renderer 顯示，template application context 不只含 messages，也包含：

- `add_generation_prompt`
- `continue_final_message`
- `tools`
- `documents`
- `template_kwargs`
- `special_tokens`

而 current source 亦支援 request-level `chat_template` override。這表示即使 session/context snapshot 完全相同，request-local template 或 kwargs 變化也可能產生不同 prompt semantics。

值得看的原始碼：
- `rust/src/chat/src/renderer/hf/mod.rs`
- `vllm/tokenizers/mistral.py`
- `vllm/transformers_utils/processors/*`

來源：
- https://github.com/vllm-project/vllm/blob/70fc359d257a984903b7ab9e123fbc45085c5254/rust/src/chat/src/renderer/hf/mod.rs

新增 edge：

`SameContextSnapshot + DifferentTemplateOverride --can_produce→ DifferentModelInput`

`ToolSchemaGeneration --injected_via→ ChatTemplateGeneration`

`RAGDocumentGeneration --can_be_rendered_by→ ChatTemplateGeneration`

---

## 3. Role identity 必須一路綁到 control-token identity
**狀態：官方資訊 + 合理架構推論。**

Hugging Face chat template 範例清楚展示 `system/user/assistant` role 會被渲染為不同 control-token regions，例如 `<|im_start|>user` 與 `<|im_start|>assistant`。因此 message object 的 role 並不是直到 model forward 都以 JSON metadata 存在；它通常在 template stage 被**編譯進 token sequence**。

所以：

`RoleMetadataCorrect --does_not_prove→ RoleControlTokensCorrect`

Hermes 應新增：

`RoleControlTokenBindingWitness = H(message identity, declared role, template region, emitted control-token IDs, token span)`

若 system message 被錯誤 template 成 user region，文字完全相同但模型看到的 conditioning 不同。

---

## 4. Token ID identity 必須綁 tokenizer/vocabulary generation，再綁 embedding matrix generation
**狀態：工程機制確認 + Hermes architecture proposal。**

模型 forward 不會讀「文字」；它讀 token IDs，接著 lookup embedding rows。故真正的底層 binding 是：

`Rendered Text → Tokenizer → Token IDs → Embedding Matrix Rows → Residual Stream`

同一 token ID 只有在 tokenizer vocabulary 與 model embedding table 是同一 generation 時才具有可驗證語意。

提出：

`TokenSemanticBinding = H(tokenizerGeneration, vocabularyGeneration, tokenId, tokenString/bytes, modelGeneration, embeddingMatrixGeneration, embeddingRowIndex)`

以及：

`EmbeddingLookupWitness = MerkleRoot(ordered TokenSemanticBindings)`

重要關係：

`SameTokenId --does_not_prove→ SameTokenSemantics`

`TokenizerCompatible --does_not_prove→ EmbeddingMatrixCompatible`

Hugging Face TRL 的 `clone_chat_template` 甚至會在加入新 special tokens 時 resize model embedding layer，直接證明 template/tokenizer mutation 與 embedding shape/rows 有工程耦合。

來源：
- https://huggingface.co/docs/trl/chat_template_utils

---

## 5. Position identity 是 token semantic identity 的第二維；multimodal template 更會產生 media placeholders
**狀態：論文結果 + 官方文件 + 工程實作。**

RoFormer（Su et al., 2021）提出 RoPE，以 rotation matrix 將 absolute position 注入 query/key，同時讓 attention 具 explicit relative-position dependency。因此：

`Same Token IDs + Different Positions --does_not_prove→ Same Attention Semantics`

來源：
- https://arxiv.org/abs/2104.09864

更重要的是 multimodal chat template：Transformers 官方文件指出 multimodal template 通常先 emit `<|image|>` / `<|video|>` 等 placeholder，再由 processor 展開成 image/video token sequence。因此多模態真正的 input compilation 是：

`Message Content → Template Placeholder → Processor → Media Tokens/Features → Text/Media Token Alignment → Position Assignment`

來源：
- https://huggingface.co/docs/transformers/chat_templating_writing
- https://github.com/vllm-project/vllm/blob/70fc359d257a984903b7ab9e123fbc45085c5254/docs/features/multimodal_inputs.md

所以新增：

`MultimodalPlaceholderBindingWitness`
`MediaTokenExpansionGeneration`
`PositionAssignmentGeneration`

---

# 本小時最重要 5 個發現

### 1. Prompt compilation 是新的 trust boundary
**是什麼：** structured messages 被 chat template 編譯成 model-specific sequence。

**底層如何運作：** `Messages → Jinja/renderer → role/control tokens → rendered prompt → tokenizer → IDs`。

**為什麼重要：** context provenance 正確，不代表 compiled prompt 正確。

**限制：** 不同 model family template 語法、tool schema、thinking/reasoning fields 不同。

### 2. Special-token duplication 可以在文字不變時改變 model input
**底層：** template 可能已放 BOS/EOS/control tokens；第二次 tokenizer 若再 `add_special_tokens=True`，token stream 會多出 control IDs。

**重要性：** 這是 model-input semantic drift，而不是 UI formatting bug。

### 3. Role semantics 最後是 token semantics
**底層：** JSON role → template control tokens → token IDs → embeddings。

**重要性：** Hermes 必須證明 system/user/tool role 的編譯結果，而不只證明 message object。

### 4. Tokenizer generation 必須與 embedding matrix generation 綁定
**底層：** token ID 是 embedding row address；vocab/added-token mutation可能改變有效 token space，新增 special tokens甚至需要 resize embeddings。

**重要性：** tokenizer/model mismatch 是 input ABI mismatch。

### 5. Multimodal prompt compilation 比 text-only 多一層 placeholder expansion
**底層：** `<|image|>/<|video|>` → processor → media token/features → alignment/positions。

**重要性：** 多模態 lineage 必須追「哪張圖/哪段影片」被展開到「哪一段 model positions」。

---

# Architecture Breakdown

```text
ContextAssemblyGeneration
  ↓
Ordered Context Items
  ↓
ChatTemplateSelection
  ↓
TemplateOverride / TemplateKwargs / Tools / Documents
  ↓
PromptCompilationGeneration
  ↓
Role / Control / BOS / EOS / Generation-Prompt Tokens
  ↓
RenderedPromptGeneration
  ↓
TokenizerGeneration
  ↓
Ordered Token IDs
  ↓
TokenSemanticBinding
  ↓
Embedding Matrix Lookup
  ↓
PositionAssignmentGeneration
  ↓
RoPE / positional transform
  ↓
Initial Residual Stream
  ↓
Transformer Layer 0
```

Multimodal branch：

```text
Image / Video / Audio content
  ↓
Template Media Placeholder
  ↓
Processor Generation
  ↓
Media Decode / Preprocess / Encoder Input
  ↓
Media Token/Feature Expansion
  ↓
Text-Media Alignment
  ↓
Position Assignment
  ↓
Fusion / Transformer Input
```

---

# Bottom-Level Logic

## Text path

```text
Message(role, content)
→ template selection
→ Jinja/template execution
→ role delimiters
→ special/control tokens
→ rendered bytes/string
→ tokenizer normalization/pre-tokenization
→ subword encoding
→ token IDs
→ embedding[token_id]
→ position index
→ RoPE/position transform
→ residual stream
```

## Multimodal path

```text
Message(content=[text,image/video/audio])
→ chat template
→ media placeholder
→ processor
→ media preprocessing
→ encoder/tokenizer
→ media features/tokens
→ placeholder expansion/alignment
→ position IDs
→ fusion/model input
```

---

# Visual Simulation Idea

## Prompt Compiler → Embedding & Position Microscope

互動面板：

1. **Structured Context**：system/developer/user/tool/memory/RAG items。
2. **Template Source**：實際 Jinja/template bytes、version、request override。
3. **Rendered Prompt**：role/control-token boundaries。
4. **Tokenizer Trace**：text span → token ID。
5. **Embedding Map**：token ID → embedding row。
6. **Position/RoPE**：position ID、RoPE angle/rotation視覺化。
7. **Multimodal Lane**：image/video placeholder → media token span。
8. **Witness Panel**：每一 transformation 的 parent/output digest。

故障注入：

- `CHAT_TEMPLATE_OVERRIDE_CHANGED`
- `SYSTEM_ROLE_RENDERED_AS_USER`
- `ADD_GENERATION_PROMPT_DISABLED`
- `BOS_EOS_DUPLICATED`
- `ADDED_TOKEN_MAP_CHANGED`
- `TOKENIZER_MODEL_GENERATION_MISMATCH`
- `EMBEDDING_MATRIX_NOT_RESIZED`
- `POSITION_IDS_SHIFTED`
- `ROPE_CONFIG_CHANGED`
- `IMAGE_PLACEHOLDER_BOUND_TO_WRONG_MEDIA`
- `MEDIA_TOKEN_EXPANSION_LENGTH_CHANGED`

---

# Code / GitHub

## vLLM
值得繼續讀：

- `rust/src/chat/src/renderer/hf/mod.rs` — current HF template renderer；messages/tools/documents/template kwargs/special tokens真正進 template context的位置。
- `vllm/tokenizers/mistral.py` — Mistral-specific template/tokenizer path。
- `vllm/transformers_utils/processors/` — multimodal processor specializations。
- `docs/features/multimodal_inputs.md` — multimodal prompt/processor examples。

## Hugging Face Transformers

- `src/transformers/utils/chat_template_utils.py`
- `src/transformers/tokenization_utils_base.py`（下一輪應追）
- model-specific `processing_*.py`（multimodal）
- `docs/source/en/chat_templating.md`

工程觀察：current vLLM Rust renderer將 `tools`, `documents`, `template_kwargs`, `special_tokens` 一起送入 template execution；因此 template generation 必須成為完整 provenance object，而不能只記 template filename。

---

# Papers

## RoFormer: Enhanced Transformer with Rotary Position Embedding
- **Title:** RoFormer: Enhanced Transformer with Rotary Position Embedding
- **Authors:** Jianlin Su, Yu Lu, Shengfeng Pan, Ahmed Murtadha, Bo Wen, Yunfeng Liu
- **Year:** 2021
- **URL:** https://arxiv.org/abs/2104.09864
- **Code/Integration:** Hugging Face RoFormer integration（論文頁指向 Transformers）
- **Dataset:** long-text classification tasks（論文實驗）
- **Architecture:** Transformer + rotary position embedding
- **Contribution:** 用 rotation matrix 編碼 absolute position，並在 self-attention 中形成 relative-position dependency。
- **Limitations:** 原始 RoPE 並不自動解決所有超長 context extrapolation；後續出現多種 scaling/extension 方法。
- **改變了什麼：** position 不再只是額外 additive vector；position直接進 Q/K geometry，因此 position generation 是 attention semantics 的一部分。

## 後續追蹤：MrRoPE（2026）
- **Title:** MrRoPE: Mixed-radix Rotary Position Embedding
- **Authors:** Qingyuan Tian, Wenhong Zhu, Xiaoran Liu, Xiaofeng Wang, Rui Wang
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2601.22181
- **Contribution:** 用 mixed-radix觀點統一多種 RoPE extension，提出 training-free extensions。
- **本研究意義:** `RoPEGeneration` 不應只記「使用 RoPE」，而必須記 scaling/extension policy 與 model generation。

---

# Knowledge Graph 新增 Node / Edge

## Nodes
- `ChatTemplateGeneration`
- `ChatTemplateOverrideGeneration`
- `TemplateVariableSetIdentity`
- `PromptCompilationGeneration`
- `PromptCompilationWitness`
- `RenderedPromptGeneration`
- `ControlTokenGeneration`
- `RoleControlTokenBindingWitness`
- `SpecialTokenPolicyGeneration`
- `GenerationPromptGeneration`
- `TokenizerModelCompatibilityWitness`
- `TokenSemanticBinding`
- `EmbeddingMatrixGeneration`
- `EmbeddingLookupWitness`
- `PositionAssignmentGeneration`
- `RoPEConfigurationGeneration`
- `InitialResidualStreamGeneration`
- `MultimodalPlaceholderGeneration`
- `MultimodalPlaceholderBindingWitness`
- `MediaProcessorGeneration`
- `MediaTokenExpansionGeneration`
- `TextMediaAlignmentWitness`

## Edges
- `ContextAssemblyGeneration → compiled_by → ChatTemplateGeneration`
- `ChatTemplateGeneration → emits → ControlTokenGeneration`
- `MessageRoleIdentity → bound_to → RoleControlTokenBindingWitness`
- `RenderedPromptGeneration → tokenized_by → TokenizerGeneration`
- `TokenID → interpreted_under → VocabularyGeneration`
- `TokenSemanticBinding → indexes → EmbeddingMatrixGeneration`
- `EmbeddingLookupWitness → positioned_by → PositionAssignmentGeneration`
- `PositionAssignmentGeneration → transformed_by → RoPEConfigurationGeneration`
- `MediaIdentity → represented_by → MultimodalPlaceholderGeneration`
- `MultimodalPlaceholderGeneration → expanded_by → MediaProcessorGeneration`
- `MediaTokenExpansionGeneration → aligned_with → TextMediaAlignmentWitness`
- `SameMessages --does_not_prove→ SameTokenSequence`
- `SameTokenId --does_not_prove→ SameTokenSemantics`
- `SameTokenSequence + DifferentPositionGeneration --does_not_prove→ SameAttentionSemantics`

---

# Unknown / Open Questions

1. **Tokenizer normalization / pre-tokenization provenance如何低成本 witness？** 同一 Unicode text 在 normalization、byte fallback、added-token precedence不同時可能產生不同 IDs。
2. **Embedding matrix identity如何與 quantized/sharded/tensor-parallel weights綁定？** logical row identity與實際 distributed storage仍有缺口。
3. **Multimodal placeholder → media features 的 exact alignment如何跨 processor/model family標準化？** image tiling、video frame sampling、audio chunking都可能改變 token span與 positions。

---

# 下一輪研究

鎖定：

`TokenSemanticBinding → Embedding Matrix → Quantized/TP Weight Shards → LayerNorm/RMSNorm → QKV Projection → RoPE → Attention Head → Residual Stream → MLP/MoE`

優先追：

- Transformers embedding / model forward source
- vLLM model executor + tensor parallel embedding
- RMSNorm / QKV projection implementation
- RoPE kernels/config generation
- tensor-parallel vocabulary/embedding sharding
- quantized weight loading與logical-weight identity

核心問題：

> 即使 chat template、token IDs與 positions都完全可信，Hermes 如何證明 token ID lookup 到的是「正確 model generation 的正確 embedding row」，而 tensor-parallel sharding、quantization、LoRA/adapter、weight loading或 hot swap沒有讓同一 logical token進入另一份 physical weight state？

---

# 本輪結束判斷

- **缺哪一層：** TokenSemanticBinding → physical model-weight/embedding shard binding。
- **哪個節點最淺：** `TokenizerModelCompatibilityWitness`，目前缺少跨 tokenizer/template/model 可攜的 ABI 定義。
- **哪個概念仍只是名詞：** portable signed `PromptCompilationWitness`。
- **哪個系統值得讀原始碼：** vLLM model executor / weight loader / tensor-parallel embedding，以及 Transformers tokenizer/template → model input path。
- **哪篇論文需追引用：** RoFormer；下一輪特別追 RoPE scaling/long-context extensions與 implementation差異。
- **哪個概念最適合視覺模擬：** `Prompt Compiler → Embedding & Position Microscope`。
- **哪個 Agent 架構最值得實作：** `Event-sourced Agent Runtime + Provenance-aware Context Compiler + PromptCompilationWitness + Token/Embedding/Position Binding + ModelInvocationWitness`。

---

# 目前端到端還原進度

```text
User
→ UI
→ Agent Runtime
→ Context / Memory / RAG
→ Compaction / Truncation
→ Ordered Context Items
→ Chat Template / Control Tokens
→ Tokenizer
→ Token IDs
→ Embedding Lookup
→ Position / RoPE
→ [下一缺口：physical model weights / transformer state]
→ Attention / MLP / MoE
→ KV Cache
→ Logits
→ Sampling
→ Token
→ Decode / Stop
→ Streaming Transport
→ Agent Observation
→ Tool / MCP Effect
→ Context Re-entry
```

多模態：

```text
Camera/Image/Voice/Video
→ Message Content
→ Multimodal Template Placeholder
→ Processor
→ Media Tokens / Features
→ Text-Media Alignment
→ Positions
→ Fusion / Transformer
→ Reasoning
→ Agent
→ Action
```
