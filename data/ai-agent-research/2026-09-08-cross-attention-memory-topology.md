# AI Agent × Multimodal Research Report — Cross-Attention Memory Topology

時間：2026-09-08 13:56（Asia/Taipei）

## 本輪定位

延續既有研究：

1. `2026-09-08-multimodal-runtime.md`：Encoder Cache / KV Cache / GPU runtime
2. `2026-09-08-multimodal-fusion.md`：Projector、token injection、interleaving、cross-layer fusion

本輪避免重複前述內容，專門補上一輪留下的缺口：

**Token Concatenation vs Separate Vision Memory + Cross-Attention**，以及 Flamingo 的 Perceiver Resampler、BLIP-2 的 Q-Former 如何改變 multimodal memory/cache topology。

---

# 本小時新發現

## 1. Cross-Attention 架構不是另一種「projector」而已

在 token-concatenation 類模型中，視覺表示通常被映射到 LLM hidden dimension 後直接放進 decoder sequence：

```text
Visual embeddings + Text embeddings
→ one decoder sequence
→ self-attention
→ decoder KV cache
```

Flamingo 類架構則不同：

```text
Image / Video
→ Vision Encoder
→ Perceiver Resampler
→ fixed-size visual latents
→ separate visual memory

Text
→ frozen/autoregressive LLM
→ inserted Gated Cross-Attention blocks
→ Query(text hidden state) attends visual K/V
```

因此「視覺資訊」不必佔據與文字完全相同的 decoder sequence positions。

已確認事實：Flamingo 論文提出 Perceiver Resampler 與 gated cross-attention，並支援任意交錯的 image/text sequence；OpenFlamingo 原始碼中 `MaskedCrossAttention` 明確以 text hidden state 產生 Q、以 media features 產生 K/V。

---

## 2. Perceiver Resampler 的核心不是單純降維，而是把可變長 vision features 轉成固定 latent interface

OpenFlamingo 原始碼：

```text
input x shape:
(b, T_media, F_frames, V_visual_tokens, D)

flatten frame + spatial:
(b, T_media, F*V, D)

learnable latents:
num_latents = 64 (default)

PerceiverAttention:
latents attend input visual features

output:
(b, T_media, num_latents, D)
```

因此它建立了一個重要系統抽象：

```text
Variable visual input size
→ fixed visual memory slots
```

這和 token pruning 不同。Token pruning 是「從既有 visual tokens 中挑掉一些」；Perceiver Resampler 是透過 learnable latent queries 重新讀取並壓縮輸入。

### Knowledge Graph Node

`Perceiver Resampler`
- input: variable visual features
- query: learnable latent slots
- operation: cross-attention + FFN
- output: fixed latent set
- system role: modality bottleneck / fixed memory interface

---

## 3. Flamingo 的 Cross-Attention 有自己的 media K/V 路徑

OpenFlamingo `MaskedCrossAttention`：

```text
text hidden state x
→ LayerNorm
→ to_q(x)

media latents
→ flatten media/time
→ to_kv(media)
→ K,V

Q_text × K_media
→ attention
→ weighted V_media
→ projection
```

這與 decoder self-attention：

```text
Q_text × K_text
→ V_text
```

是不同的 memory topology。

概念上應拆成：

```text
Decoder Self-Attention Memory
├ text/self K
└ text/self V

Vision Cross-Attention Memory
├ media K
└ media V
```

Hugging Face IDEFICS（Flamingo-style）文件也明確指出 `past_key_values` 可包含 self-attention blocks 與 cross-attention blocks 的預計算 K/V。

因此上一輪的疑問可以部分回答：

**Cross-attention VLM 可以存在獨立於文字 self-KV 的 visual cross-attention K/V，而不必把所有 visual units 都當成 decoder sequence token。**

但不同實作是否真的 cache media K/V、cache 的粒度與生命週期仍需逐模型原始碼驗證。

---

## 4. Flamingo 的 media mask 其實是「跨模態 causal routing」

OpenFlamingo 不只是普通 cross-attention。

原始碼先從 text sequence 裡的 media token locations 建立 `text_time`，再對 visual media 建立 `media_time`。

若 `only_attend_immediate_media=True`：

```text
text token
只能 attend 最近一個 preceding media
```

否則：

```text
text token
可 attend 所有 earlier media
```

所以 multimodal sequence 的 causal structure 不只由 language causal mask 決定，還有另一張：

```text
Text-to-Media Attention Mask
```

新增知識節點：

`Multimodal Causal Routing`
- language causal mask
- media location mask
- text-to-media routing
- immediate-media policy
- all-previous-media policy

這對 Agent 很重要：多張截圖、多頁文件、多 frame observation 不是只需要「塞進 context」，還要定義哪段 text/action state 能讀取哪個 observation。

---

## 5. Gating 是 Flamingo 能安全插入 frozen LLM 的關鍵 runtime/training interface

OpenFlamingo 的 `GatedCrossAttentionBlock`：

```text
attn_gate = Parameter(0)
ff_gate   = Parameter(0)

x = tanh(attn_gate) * cross_attention(x, media) + x
x = tanh(ff_gate)   * FFN(x) + x
```

初始 gate 為 0，代表新增 multimodal block 一開始幾乎不擾動原本 frozen LLM path；訓練後 gate 再逐步學習開啟視覺訊號。

這是一個比「projector 把維度對齊」更深的系統概念：

```text
Pretrained Language Prior
+
New Multimodal Path
↓
Learnable Gate
↓
Controlled Integration
```

新增 Knowledge Graph node：`Residual Modality Gate`。

---

# Architecture Breakdown

## A. Token Concatenation / Injection

```text
Image
↓
Vision Encoder
↓
Projector / Merger
↓
Visual embeddings
      +
Text embeddings
↓
One decoder sequence
↓
Self-Attention
↓
Self KV Cache
```

特性：
- vision/text 共用 decoder sequence
- implementation path 相對單純
- visual token 數直接影響 prefill length
- decoder attention 必須處理 visual+text positions

---

## B. Flamingo-style Cross-Attention

```text
Image / Video
↓
Vision Encoder
↓
Variable visual features
↓
Perceiver Resampler
↓
Fixed visual latents
↓
Visual Memory
       ↘
        Gated Cross-Attention ← Text hidden states
       ↗
Frozen / pretrained LLM layers
↓
Text output
```

Memory topology：

```text
Vision Encoder Output
→ Resampler Latents
→ Cross-Attention K/V

Text Context
→ Decoder Self-Attention K/V
```

因此視覺與文字 memory 可以分開管理。

---

## C. BLIP-2 Q-Former

```text
Image
↓
Frozen Vision Encoder
↓
Image features
      ↑
Learnable Query Tokens
      ↓ cross-attention
Q-Former
↓
Small fixed set of query outputs
↓
Projection
↓
Frozen LLM input
↓
Generation
```

LAVIS 原始碼 `init_Qformer()`：

```text
add_cross_attention = True
cross_attention_freq = 2
query_length = num_query_token
query_tokens = learnable parameter
```

因此 Q-Former 是「在 LLM 前」先做一次 task/representation bottleneck；Flamingo 則在 LLM 多層內反覆插入 cross-attention。

兩者不能都簡化成「vision adapter」。

---

# Bottom-Level Logic

## Cross-Attention 到底算什麼

對一層 Flamingo-style cross-attention：

```text
text hidden state h_t
↓
Q_t = h_t W_Q

visual latent m_i
↓
K_i = m_i W_K
V_i = m_i W_V

score(t,i) = Q_t K_i^T / sqrt(d)
↓
media routing mask
↓
softmax
↓
Σ attention(t,i) V_i
↓
W_O
↓
visual contribution
↓
residual gate
↓
h'_t
```

重要區分：

```text
Self Attention
Q=text, K=text, V=text

Cross Attention
Q=text, K=vision, V=vision
```

因此如果 visual K/V 能跨 decode steps 重用，理論上每個新文字 token 不必重新執行完整 vision encoder/resampler，也不必重新生成所有 visual K/V；但具體 cache policy 取決於 implementation。

---

# Perceiver Resampler vs Q-Former

| 維度 | Perceiver Resampler | BLIP-2 Q-Former |
|---|---|---|
| 核心輸入 | Vision features | Vision features + learnable query tokens，training 時也能結合 text objective |
| 核心操作 | latent queries cross-attend visual inputs | Query Transformer cross-attends frozen image encoder |
| 輸出大小 | fixed latent slots | fixed query outputs |
| 與 LLM 結合位置 | LLM 多層 gated cross-attention | 通常投影後放在 LLM input 前綴 |
| 系統角色 | visual memory compressor/interface | modality bridge + information extractor |
| Frozen LLM | Flamingo 原始設計是 | BLIP-2 是 |
| Fusion depth | deep / repeated | mostly pre-LLM bridge |

共同點：

```text
Large variable visual representation
↓
small learned query set
↓
compact interface to language system
```

不同點：它們把 cross-modal interaction 放在不同深度。

---

# Agent Runtime Implication

對 Browser / Computer / Embodied Agent：

每一步都可能得到新的 screenshot/frame。

如果採 token concatenation：

```text
Screenshot
→ many visual tokens
→ decoder context
→ self-KV grows
```

如果採 separate vision memory：

```text
Screenshot
→ encoder
→ compressed visual memory
→ cached media K/V

Agent text/action trace
→ separate decoder KV
```

可能的工程優勢（合理推論，需 benchmark 驗證）：
- 可分離 observation memory 與 language/action memory
- 同一 screenshot 在多個 decode step 可重用 visual representation
- 可對舊 observation 做獨立 eviction/compression
- 可建立 perception cache policy，而不一定重寫整段 text context

可能的代價：
- cross-attention block 額外 FLOPs
- additional visual K/V residency
- multimodal cache synchronization 更複雜
- media masking / temporal routing 變複雜

這正好連到 Hermes Console 未來的 runtime visualizer：不能只顯示「context tokens」，需要分開顯示 **Text KV / Visual Memory / Encoder Cache / Agent Memory**。

---

# Visual Simulation Idea

## Multimodal Memory Topology Simulator

畫面讓使用者切換三種架構：

### Mode 1 — Token Injection

```text
Image → ViT → 576 visual tokens ┐
                               ├→ Decoder Sequence → Self KV
Text  → tokenizer ─────────────┘
```

即時顯示：
- visual sequence length
- text sequence length
- prefill tokens
- estimated self-KV footprint

### Mode 2 — Flamingo

```text
Image → ViT → N patches
             ↓
       Perceiver Resampler
             ↓
       64 visual latents
             ↓
       Visual Cross-KV
             ↕
Text → LLM Self-KV → Gated Cross Attention
```

即時顯示：
- raw visual units
- resampled latents
- visual K/V
- text K/V
- gate value
- which text tokens can attend which image

### Mode 3 — BLIP-2

```text
Image → Frozen ViT
          ↑
    32 learnable queries
          ↓
       Q-Former
          ↓
     32 query outputs
          ↓
       Projector
          ↓
       LLM Prefix
```

即時顯示：
- image features
- query count
- attention map query→image
- compressed output count
- LLM prefix size

### 核心教育功能

同一張圖片、同一句問題：

```text
「圖片裡的人正在做什麼？」
```

讓使用者看三種架構的資料流，而不是只比較 benchmark。

---

# Code / GitHub

## OpenFlamingo

Repo：`mlfoundations/open_flamingo`

核心檔案：

```text
open_flamingo/src/helpers.py
├ PerceiverAttention
├ PerceiverResampler
├ MaskedCrossAttention
└ GatedCrossAttentionBlock

open_flamingo/src/flamingo.py
└ Flamingo model orchestration
```

值得研究的原始碼事實：
- `PerceiverResampler` default `num_latents=64`
- frame/spatial dimensions 先 flatten 再由 latent queries 讀取
- `MaskedCrossAttention`：Q 來自 text、K/V 來自 media
- media routing mask 可限制 text 只 attend immediate preceding media
- `GatedCrossAttentionBlock` gate 初始化為 0 並經 tanh

## Salesforce LAVIS / BLIP-2

Repo：`salesforce/LAVIS`

值得看：

```text
lavis/models/blip2_models/blip2.py
lavis/models/blip2_models/blip2_qformer.py
lavis/models/blip2_models/blip2_vicuna_instruct.py
```

核心：
- Q-Former 基於 BERT configuration
- 插入 cross-attention
- learnable query tokens
- frozen vision encoder
- query outputs 經 projection 給 LLM

---

# Papers

## Flamingo: a Visual Language Model for Few-Shot Learning

Authors：Jean-Baptiste Alayrac et al.
Institution：DeepMind
Year：2022
Architecture：Vision Encoder + Perceiver Resampler + gated cross-attention inserted into pretrained LM
Contribution：把 arbitrarily interleaved image/text few-shot prompting 與 frozen pretrained components 結合
Limitations：大型模型、training data/compute 成本高；原始完整模型未公開
Knowledge Graph：

```text
Multimodal Fusion
→ Perceiver Resampler
→ Separate Vision Memory
→ Gated Cross-Attention
```

## BLIP-2: Bootstrapping Language-Image Pre-training with Frozen Image Encoders and Large Language Models

Authors：Junnan Li, Dongxu Li, Silvio Savarese, Steven Hoi
Institution：Salesforce Research
Year：2023
Architecture：Frozen Image Encoder + Q-Former + Frozen LLM
Contribution：以少量 trainable bridge 連接 frozen vision 與 frozen language model；two-stage pretraining
Limitations：Q-Former bottleneck 可能丟失高密度/細粒度視覺資訊；實際能力受 frozen backbones 強烈影響
Knowledge Graph：

```text
Multimodal Bridge
→ Learnable Queries
→ Q-Former
→ Visual Information Bottleneck
```

## InstructBLIP

Authors：Wenliang Dai et al.
Year：2023
Architecture：BLIP-2 + instruction-aware Query Transformer
Contribution：讓 query feature extraction 本身受到 user instruction 影響
Knowledge Graph：

```text
Instruction
→ Visual Retrieval Queries
→ Task-conditioned Visual Compression
```

---

# Knowledge Graph 新增 Node / Edge

新增 Nodes：

```text
Multimodal Memory Topology
├ Unified Decoder Sequence
├ Separate Vision Memory
├ Decoder Self-KV
├ Visual Cross-KV
├ Encoder Cache
└ Observation Memory

Visual Bottleneck
├ Perceiver Resampler
├ Learnable Latents
├ Q-Former
└ Learnable Query Tokens

Cross-Modal Routing
├ Media Location Mask
├ Immediate-Media Attention
└ Previous-Media Attention

Fusion Control
└ Residual Modality Gate
```

新增 Edges：

```text
Vision Encoder
--produces-->
Raw Visual Features

Raw Visual Features
--compressed by-->
Perceiver Resampler

Perceiver Latents
--become-->
Visual Cross-Attention Memory

Text Hidden State
--queries-->
Visual K/V

Media Location Mask
--controls-->
Text-to-Vision Attention

Q-Former
--extracts-->
Task-relevant Visual Queries

Fusion Architecture
--determines-->
Cache Topology

Cache Topology
--affects-->
GPU VRAM + Latency

Agent Observation
--can map to-->
Separate Vision Memory
```

---

# 已確認事實 / 推論分界

## 已確認
- Flamingo 使用 Perceiver Resampler 與 gated cross-attention。
- OpenFlamingo source 中 text produces Q、media produces K/V。
- OpenFlamingo Resampler 預設固定 latent count 為 64。
- OpenFlamingo gating parameters 初始為 0。
- BLIP-2 Q-Former 具有 learnable query tokens 與 cross-attention。
- IDEFICS API 描述 cache 可包含 self-attention 與 cross-attention K/V。

## 合理工程推論，尚需 benchmark
- Separate vision memory 對長時間 Computer Agent 可能比全量 visual-token concatenation 更利於 observation cache/eviction。
- Cross-attention 架構可能減少 decoder sequence growth，但未必降低總 VRAM，因為仍需保存 visual memory/cross-KV。
- Browser agent 可將 screenshot memory 與 action/text trace memory 分離調度。

---

# Unknown / Open Questions

1. 在 IDEFICS / Flamingo-style production serving 中，visual cross-KV 是否跨所有 decode steps cache？具體 cache tensor shape、layout、eviction policy 為何？
2. Token concatenation 與 separate cross-attention 在相同 visual information budget 下，prefill latency、decode latency、VRAM、quality 的公平 benchmark 結果如何？
3. 對 Computer Use Agent 的連續 screenshot，最佳 observation memory 是：frame diff、visual token pruning、Perceiver latent memory、cross-KV reuse，還是 world-state extraction？

---

# 下一輪研究

下一輪優先進入：

## Computer / Browser Agent Perception Runtime

研究路徑：

```text
Screenshot / DOM / Accessibility Tree
↓
Perception
↓
Visual / Structured State
↓
Observation Memory
↓
Planning
↓
Action
↓
Environment Transition
↓
New Observation
```

重點比較：
- screenshot-only agent
- DOM / accessibility-tree agent
- hybrid browser agent
- vision-language computer-use agent

並連接：

```text
Observation
→ Multimodal Cache
→ Agent State
→ World Model
→ Action Grounding
```

### 下一輪要回答
- Agent 到底是在「看畫面」還是在「讀 DOM」？
- cursor coordinate 如何從 model output 變成 OS/browser action？
- screenshot history 是否應進 long-term context？
- action failure 如何被新的 observation 偵測？
- perception error 與 planning error 如何區分？

---

# 本輪進化檢查

- 最缺的一層：Computer/Browser Agent 的 perception → action grounding runtime。
- 理解最淺節點：cross-attention KV 在現代 serving engine 中的具體 caching lifecycle。
- 仍偏名詞化：Observation Memory、Visual World State。
- 最值得繼續讀原始碼：OpenFlamingo cross-attention caching path、IDEFICS cache implementation、Computer-use/browser agent runtimes。
- 最值得追引用：Flamingo → OpenFlamingo / IDEFICS → newer cross-attention VLM serving work。
- 最適合視覺模擬：Multimodal Memory Topology Simulator。
- 最值得 Hermes Console 實作：把 `Agent Memory / Text KV / Encoder Cache / Visual Cross-KV` 顯示成四個不同可觀測 memory pools，而不是統稱為 Context 或 Memory。
