# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 04:51（Asia/Taipei）**  
**主題：Embedding × Residual Stream × RMSNorm × Weight Tying × LM Head**

> 本輪接續上一輪 `Tokenizer × Chat Template × Special Tokens × Tool Protocol × Byte/Token Boundary`，專注補齊 `Token ID → Embedding → Residual Stream → Norm → Transformer Layer → Final Norm → LM Head → Logits`。不重複 tokenizer、RoPE、KV cache、sampling 與 tool parser。

---

## 本小時新發現

1. **RMSNorm 的核心不是「比較快的 LayerNorm」而已**：它拿掉 re-centering，只保留 re-scaling，對 hidden vector 做 RMS normalization。這改變的是每層進入 Attention / MLP 前的尺度控制方式，而非語意內容本身。原始論文：Biao Zhang, Rico Sennrich, *Root Mean Square Layer Normalization* (NeurIPS 2019 / arXiv 1910.07467)。
2. **Residual stream 應視為整個 decoder 的共享「資訊總線」**：Attention 與 MLP 通常不是彼此覆寫，而是把更新向量加回同一 hidden state。這使「某層到底存了什麼」不能用單一 neuron 解釋，資訊可分散於多個方向與多層累積。
3. **Weight tying 不是無條件免費午餐**：Press & Wolf (2016) 奠定 input embedding / output unembedding tying 的經典做法，但 2026 年研究 *Weight Tying Biases Token Embeddings Towards the Output Space* 提供機制證據，指出 tied matrix 可能因輸出梯度主導而更偏向 unembedding 需求，損害早層 input representation。這代表「省參數 + regularization」與「輸入/輸出角色衝突」之間存在實際 trade-off。
4. **現代 decoder 原始碼非常明確地把 token embedding、pre-norm、residual add、final norm、lm_head 分成不同算子**。Hugging Face Llama family 中 `LlamaRMSNorm`、`embed_tokens`、decoder layer residual add 與 `lm_head` 都是可追蹤的獨立程式路徑。
5. **Embedding matrix 與語意向量不能畫上等號**。Token embedding 是 lookup table 的某一列；真正可用於下一 token prediction 的表徵是多層 Attention/MLP 對 residual stream 反覆讀寫後的 contextual hidden state。

---

## 本小時最重要 5 個發現

### 1. Token ID 變成向量的第一步只是矩陣 lookup

已確認機制：

```text
Token ID t
↓
Embedding Matrix E ∈ R^(V×d)
↓
x₀ = E[t]
```

其中：

```text
V = vocabulary size
d = hidden size
```

一個 token ID 本身只有離散索引意義，直到 lookup 後才得到 `d` 維 floating-point vector。

**重要性**：這是 `Tokenizer → Transformer` 的真正數值邊界。

**限制**：`E[t]` 並不是完整語意。相同 token 在不同上下文的初始 embedding 一樣，但進入 transformer 後 hidden state 會因上下文而改變。

來源：Hugging Face Transformers 原始碼中的 `nn.Embedding(config.vocab_size, config.hidden_size)`；Press & Wolf 2016。

---

### 2. Residual Stream 是 decoder block 之間持續存在的 shared state

典型 pre-norm decoder layer 可以抽象成：

```text
x_l
↓
RMSNorm
↓
Attention
↓
Δ_attn
↓
x'_l = x_l + Δ_attn
↓
RMSNorm
↓
MLP / MoE
↓
Δ_mlp
↓
x_(l+1) = x'_l + Δ_mlp
```

這裡真正持續穿過所有層的是：

```text
Residual Stream x
```

Attention / MLP 更像：

```text
read(x)
→ compute update
→ write(update)
→ residual add
```

而不是每一層都建立一份全新的「語意記憶」。

**為什麼重要**：這提供一個更好的視覺模型：Transformer layer 是一組讀寫 shared vector state 的 operators。

**限制**：Residual stream 的 feature 通常不是單一座標可直接解讀。Anthropic Transformer Circuits 的研究指出理論上 residual basis 沒有天然語意，但實務又觀察到 basis-aligned outliers，且 2023 的工作將 Adam 的 per-dimension normalization 視為可能來源之一。

來源：Anthropic Transformer Circuits, *Privileged Bases in the Transformer Residual Stream* (2023)。

---

### 3. RMSNorm 控制的是尺度，不做 mean centering

LayerNorm：

```text
μ = mean(x)
σ² = mean((x - μ)²)
y = γ ⊙ (x - μ) / sqrt(σ² + ε) + β
```

RMSNorm：

```text
rms(x) = sqrt(mean(x²) + ε)
y = γ ⊙ x / rms(x)
```

差異：

```text
LayerNorm
= re-center + re-scale

RMSNorm
= re-scale only
```

RMSNorm 原始論文的主張是 re-centering invariance 並非必要，因此可省去 mean subtraction 相關運算；論文在當時多種架構上報告 7%–64% runtime reduction，但這些數字是特定舊硬體/模型實驗，不應直接套用現代 fused LLM kernels。

現代 Llama 實作中的 `LlamaRMSNorm` 仍沿用這個核心公式。

**重要性**：Norm 直接影響 QKV / MLP projection 所看到的 hidden-state scale，因此會影響數值穩定、訓練與 inference kernel 設計。

**限制**：不能把 RMSNorm 說成「保留語意、移除雜訊」；那是沒有被公式支持的語義化敘述。

來源：Zhang & Sennrich 2019；Hugging Face `modeling_llama.py`。

---

### 4. Weight Tying = 共用 lookup matrix 與 output classifier，但它同時承受兩種不同梯度角色

若不 tying：

```text
Input:
x = E_in[token]

Output:
logits = h W_out^T
```

若 weight tying：

```text
E_in == W_out
```

因此：

```text
Input path:
Token ID → E[row]

Output path:
Hidden state h → h E^T → vocabulary logits
```

優點：

```text
parameter count ↓
embedding/output space coupled
historically often improves perplexity
```

但 2026 年 Lopardo et al. 的研究提供新機制證據：output gradients 在訓練早期可能主導 tied matrix，讓共享 embedding 更靠近 output/unembedding 的需求，導致早層 residual computation 較弱；作者以 tuned lens 與 input-gradient scaling 做因果分析。

所以 Knowledge Graph 不應再只有：

```text
Weight Tying → parameter efficiency
```

而應改成：

```text
Weight Tying
├ Parameter Sharing
├ Output-Space Bias
├ Gradient Competition
├ Input Representation Trade-off
└ Parameter Efficiency
```

**來源**：Press & Wolf 2016；Lopardo, Harish, Arnett, Gupta 2026。

---

### 5. LM Head 不是「把語意翻譯成文字」，而是把 final hidden state 投影成 vocabulary score

流程：

```text
Final Residual State h_L
↓
Final RMSNorm
↓
h_final
↓
LM Head / Unembedding
↓
logits ∈ R^V
```

若：

```text
W_U ∈ R^(V×d)
```

則：

```text
logits = h_final W_U^T
```

每個 vocabulary token 得到一個 scalar logit。

然後才接前一輪已研究的：

```text
logits
→ processors
→ grammar mask
→ temperature / top-k / top-p
→ sampler
→ token ID
```

因此完整閉環現在變成：

```text
Token ID
→ Embedding
→ Residual Stream
→ Transformer Layers
→ Final Norm
→ LM Head
→ Logits
→ Sampling
→ Next Token ID
```

---

# Architecture Breakdown

## Decoder-Only Transformer Data Path

```text
Input Token IDs
↓
Embedding Lookup
↓
Residual Stream x₀
↓
────────────────────────────
Decoder Layer 0
├ RMSNorm(x)
├ QKV Projection
├ RoPE
├ Attention
├ Output Projection
├ Residual Add
├ RMSNorm(x)
├ MLP / MoE
└ Residual Add
────────────────────────────
↓
Decoder Layer 1
↓
...
↓
Decoder Layer L-1
↓
Final RMSNorm
↓
Final Hidden State
↓
LM Head / Unembedding
↓
Vocabulary Logits
↓
Sampler / Grammar
↓
Next Token ID
```

### System architecture perspective

這一層與 Agent Runtime 的關係是：

```text
Agent Context Compiler
↓
Token IDs
↓
Model Residual Computation
↓
Logits
↓
Token Stream
↓
Protocol Parser
↓
Agent Runtime
```

Agent 的「reasoning token / tool token / answer token」在 model core 裡並不是不同物理資料型別；它們都經過相同 embedding→residual→logits 流程，差異來自 context、training、special token、grammar/parser 與上層 runtime semantics。

---

# Bottom-Level Logic

## 一個 token 在 residual stream 裡發生什麼？

```text
Token 8712
↓
E[8712]
↓
x₀ ∈ R^d
```

假設第一層：

```text
n₁ = RMSNorm(x₀)
q,k,v = linear(n₁)
attn = Attention(q,k,v)
x₁a = x₀ + W_o(attn)

n₂ = RMSNorm(x₁a)
ffn = MLP(n₂)
x₁ = x₁a + ffn
```

第二層再以 `x₁` 為輸入。

也就是：

```text
Residual Stream
= accumulated sequence of updates
```

不是：

```text
Embedding
→ 被第一層完全替換
```

這也是 residual architecture 能支持深層網路的重要原因之一。

---

## Pre-Norm 與 Post-Norm 不可混用名詞

現代多數 decoder LLM 常見 pre-norm：

```text
x
→ Norm
→ Sublayer
→ Add x
```

而原始 Transformer 常見 post-norm：

```text
x
→ Sublayer
→ Add x
→ Norm
```

兩者的 gradient / stability 行為不同，因此 Hermes 的知識圖譜應建立：

```text
Normalization Placement
├ Pre-Norm
├ Post-Norm
└ Sandwich / Variant Norm
```

不要把「RMSNorm」與「Pre-Norm」視為同一概念：一個是 normalization function，一個是 normalization placement。

---

# Visual Simulation Idea

## Residual Stream X-Ray

建議 Hermes Console 新增互動模擬：

```text
TOKEN ID
  8712
   │
   ▼
Embedding E[8712]
   │
   ▼
┌──────────────────────┐
│ Residual Stream x₀   │
└──────────────────────┘
   │
   ├─ RMSNorm → Attention → ΔA₀
   │                         │
   └────────── x₀ + ΔA₀ ◄────┘
                │
                ├─ RMSNorm → MLP → ΔM₀
                │                    │
                └────── x₁ ◄─────────┘
                         │
                         ▼
                       Layer 1
                         │
                         ▼
                     Final Norm
                         │
                         ▼
                       LM Head
                         │
                         ▼
                       Logits
```

可互動控制：

```text
Layer = 0..L
Token position
Norm on/off
PreNorm/PostNorm
Weight tying on/off
Residual update source = Attention / MLP
```

### 建議視覺指標

每層顯示：

```text
||x||₂
RMS(x)
||Δ_attention||₂
||Δ_mlp||₂
cos(x_before, x_after)
Top logit tokens
Logit entropy
```

使用者可拖曳某一 residual update 的 scale，觀察：

```text
hidden direction
→ final logits
→ sampled token distribution
```

這比「神經元亮起」更接近現代 Transformer 的真實資料流。

---

# Code / GitHub

## Hugging Face Transformers

值得追：

```text
huggingface/transformers
└ src/transformers/models/llama/modeling_llama.py
   ├ LlamaRMSNorm
   ├ LlamaAttention
   ├ LlamaMLP
   ├ LlamaDecoderLayer
   ├ LlamaModel
   └ LlamaForCausalLM
```

原始碼重點：

```text
LlamaRMSNorm
→ RMS normalization

embed_tokens
→ nn.Embedding(vocab_size, hidden_size)

decoder layer
→ norm → attention → residual add
→ norm → MLP → residual add

lm_head
→ hidden_size → vocab_size
```

另外值得比較有 tied weights 的模型類別；Transformers 原始碼中部分模型會以 `_tied_weights_keys` 將 `lm_head.weight` 綁定 `model.embed_tokens.weight`。

## 下一步值得追的核心檔案

```text
transformers/modeling_utils.py
→ tie_weights / weight initialization

models/llama/modeling_llama.py
→ residual / norm / lm_head

PyTorch nn.Embedding / nn.Linear
→ parameter layout
```

---

# Papers

## 1. Root Mean Square Layer Normalization

- **Title**: Root Mean Square Layer Normalization
- **Authors**: Biao Zhang, Rico Sennrich
- **Institution**: University of Edinburgh / University of Zurich-era affiliations in paper context
- **Year**: 2019
- **URL**: https://arxiv.org/abs/1910.07467
- **Code**: https://github.com/bzhangGo/rmsnorm
- **Dataset**: multiple language modeling / machine translation / sequence tasks in original study
- **Architecture**: normalization layer replacing LayerNorm's mean-centering + variance scaling with RMS-only scaling
- **Contribution**: shows re-centering invariance can be removed while retaining useful re-scaling behavior
- **Limitations**: original runtime improvements depend heavily on architecture, framework, hardware, and kernel implementation; modern fused kernels alter the trade-off
- **改變了什麼**: modern decoder LLMs can stabilize pre-norm transformer blocks without full LayerNorm centering

## 2. Using the Output Embedding to Improve Language Models

- **Title**: Using the Output Embedding to Improve Language Models
- **Authors**: Ofir Press, Lior Wolf
- **Institution**: Tel Aviv University
- **Year**: 2016
- **URL**: https://arxiv.org/abs/1608.05859
- **Code**: paper-era implementations vary
- **Dataset**: language modeling / translation benchmarks in original work
- **Architecture**: share input embedding matrix with output classifier / unembedding
- **Contribution**: establishes weight tying as an effective parameter-sharing scheme
- **Limitations**: older model scale and architecture; does not settle role-conflict behavior in modern LLMs
- **改變了什麼**: weight tying became a standard design option for parameter-efficient language models

## 3. Weight Tying Biases Token Embeddings Towards the Output Space

- **Title**: Weight Tying Biases Token Embeddings Towards the Output Space
- **Authors**: Antonio Lopardo, Avyukth Harish, Catherine Arnett, Akshat Gupta
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2603.26663
- **Architecture**: tied vs untied embedding/unembedding language models + tuned-lens analysis
- **Contribution**: provides evidence that tied embeddings are biased toward output-space optimization because output gradients dominate early training
- **Limitations**: conclusions depend on tested model scales/training settings; does not imply tying is universally harmful
- **改變了什麼**: weight tying should be modeled as a representation trade-off, not only a memory optimization

## 4. Privileged Bases in the Transformer Residual Stream

- **Title**: Privileged Bases in the Transformer Residual Stream
- **Authors**: Nelson Elhage, Robert Lasenby, Christopher Olah
- **Institution**: Anthropic
- **Year**: 2023
- **URL**: https://transformer-circuits.pub/2023/privileged-basis/index.html
- **Architecture**: transformer residual-stream analysis
- **Contribution**: investigates why residual-stream coordinates show unexpected basis-aligned outliers despite theoretical basis symmetry
- **Limitations**: mechanistic interpretation remains incomplete; evidence is about specific observed phenomena, not a complete theory of residual semantics
- **改變了什麼**: residual stream should not be naively visualized as one human concept per coordinate

---

# 已確認 / 推論 / 尚未驗證

## 已確認事實

- token embedding is a learned matrix lookup
- RMSNorm performs RMS-based re-scaling without subtracting the mean
- decoder blocks use residual addition to carry hidden state across layers
- LM head maps hidden state to vocabulary logits
- weight tying shares input embedding/output projection parameters when enabled

## 論文結果

- RMSNorm paper reports comparable task performance to LayerNorm with lower runtime in its studied settings
- Press & Wolf report benefits from tying input/output embeddings
- Lopardo et al. 2026 report output-space bias and gradient imbalance under weight tying in their studied settings

## 工程實作

- modern Llama implementations expose `LlamaRMSNorm`, `embed_tokens`, residual-add decoder layers, and `lm_head` as separate components

## 合理推論

Hermes 可建立：

```text
Residual Update Trace
```

把每層 Attention/MLP 對最終 logits 的影響做 causal attribution，會比單純 attention heatmap 更接近「模型如何逐步形成下一 token」。

## 尚未驗證假說

對 Agent tool calling 而言，某些 residual-stream directions 是否能形成穩定的「tool intent / argument construction / delimiter production」子空間，需用 activation patching / probing / causal intervention 驗證，不能僅靠 token probability correlation 下結論。

---

# Unknown / Open Questions

1. **Residual stream 中到底哪些 feature 是跨 task 穩定、可被因果干預的？** 單純 probe 能解碼不代表 feature 被模型用來做決策。
2. **Weight tying 在大型、多模態、MoE、tool-use 模型中的 gradient-role conflict 是否仍成立？** 2026 新研究值得追更大尺度 replication。
3. **Multimodal models 如何把 vision/audio encoder output 投影到與 text residual stream 相容的 hidden space？** 這是下一個從文字 decoder 走向 multimodal fusion 的關鍵橋樑。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Embedding Runtime
├ Vocabulary Matrix
├ Token Embedding
├ Positional Transformation
└ Input Projection

Residual Stream
├ Hidden State
├ Attention Update
├ MLP Update
├ Residual Add
├ Feature Direction
└ Basis Alignment

Normalization
├ LayerNorm
├ RMSNorm
├ Pre-Norm
├ Post-Norm
└ Final Norm

Output Projection
├ LM Head
├ Unembedding Matrix
├ Weight Tying
├ Output-Space Bias
└ Vocabulary Logits
```

## Edges

```text
Token ID
→ indexes
Embedding Matrix

Embedding Vector
→ initializes
Residual Stream

RMSNorm
→ rescales
Residual Stream

Attention
→ writes update to
Residual Stream

MLP / MoE
→ writes update to
Residual Stream

Final Norm
→ prepares
LM Head Input

LM Head
→ projects to
Vocabulary Logits

Weight Tying
→ shares parameters between
Embedding Matrix ↔ LM Head

Output Gradient
→ can bias
Tied Embedding Representation
```

---

# 下一輪研究

## Multimodal Projection × Vision Encoder × Projector × Shared Residual Space

下一輪優先補目前最明顯的 multimodal bridge：

```text
Image
↓
Patchify
↓
Vision Encoder
↓
Vision Features
↓
Projector / Resampler
↓
Language Hidden Dimension
↓
Multimodal Token Sequence
↓
Shared Residual Stream
↓
Language Decoder
```

重點研究：

```text
ViT patch embedding
CLIP / SigLIP vision encoder
MLP projector
Perceiver resampler
Q-Former
cross-attention vs early fusion
image token budget
vision feature compression
spatial position encoding
video temporal tokenization
```

並比較 LLaVA、Flamingo、BLIP-2、Gemma 4 / PaliGemma 類架構。

---

# 本輪結束檢查

- **缺哪一層**：Vision/Audio feature → language residual-space projector
- **哪個節點最淺**：Residual feature causality / activation patching
- **哪個概念仍只是名詞**：Semantic direction in residual stream
- **哪個系統值得讀原始碼**：Hugging Face Llama/PaliGemma + open multimodal projector implementations
- **哪篇論文需追引用**：*Weight Tying Biases Token Embeddings Towards the Output Space* (2026)
- **哪個概念最適合視覺模擬**：Residual Stream X-Ray
- **哪個 Agent 架構最值得實作**：單一 Agent + deterministic runtime 仍優先；本輪是 model-core 可觀測性，不需要新增 agent orchestration layer

---

# 本輪核心結論

> **Token ID 進入模型後，第一步只是一個 embedding matrix lookup；真正的上下文表徵是在 residual stream 中，經過多層 Attention 與 MLP 持續讀寫、殘差累積與 RMSNorm 尺度控制後形成。最後 LM Head 只把 final hidden state 投影回 vocabulary logits。Embedding 與 unembedding 可以共用權重，但 2026 的新證據顯示這種 parameter sharing 可能同時帶來 input/output representation 的角色衝突。**

---

## 主要來源

- Zhang & Sennrich, *Root Mean Square Layer Normalization*: https://arxiv.org/abs/1910.07467
- Press & Wolf, *Using the Output Embedding to Improve Language Models*: https://arxiv.org/abs/1608.05859
- Lopardo et al., *Weight Tying Biases Token Embeddings Towards the Output Space*: https://arxiv.org/abs/2603.26663
- Anthropic Transformer Circuits, *Privileged Bases in the Transformer Residual Stream*: https://transformer-circuits.pub/2023/privileged-basis/index.html
- Hugging Face Transformers: https://github.com/huggingface/transformers
