# AI Agent × Multimodal AI 底層研究 — Multimodal Fusion Architecture

時間：2026-09-08 12:56（Asia/Taipei）

## 本輪定位

延續前一輪 `Image/Video → Vision Encoder → Encoder Cache → LLM Prefill → KV Cache → GPU`，本輪只研究尚未補齊的 Fusion 層：**視覺表示究竟在什麼位置、以什麼資料形式進入語言模型，以及不同 fusion 設計如何改變 inference/runtime。**

研究來源以官方模型文件、技術報告與實際原始碼為主；以下明確區分 confirmed facts、paper results 與 engineering inference。

## 本輪最重要 5 個發現

### 1. 「Vision Encoder + Projector + LLM」其實是一種 one-to-one bridge，而不是所有 Multimodal AI 的通則

LLaVA/InternVL 類架構的基本形式為：

`Image → Vision Encoder → selected visual hidden states → MLP/Projector → LLM embedding space → replace/insert image placeholder positions → Decoder Transformer`

InternVL 官方原始碼 `modeling_internvl_chat.py` 可直接看到 `vit_embeds → reshape → self.mlp1(vit_embeds)`，確認其 vision feature 經 MLP bridge 後再進 language model。

這種架構的優點是能大量重用 pretrained LLM；限制則是視覺資訊通常先被壓成一組固定/單次產生的 language-compatible embeddings，LLM 後續層只能從這組表示中取得視覺訊息。

### 2. Qwen2.5-VL 仍然可被理解為「visual sequence 注入 decoder」，但 bridge 本身包含 patch merger

Hugging Face 的 Qwen2.5-VL 實作顯示 Vision Transformer 的 hidden states 會通過 `self.merger(hidden_states)`；模型再建立 visual module 與 language model。Qwen 官方同時說明 dynamic resolution、window attention 與 visual token 數量會依輸入改變。

因此資料流更準確地畫成：

`Pixels → Dynamic ViT → visual hidden states → Patch Merger → visual embeddings → multimodal sequence positions → decoder layers`

這不是傳統「圖片轉文字 caption 再給 LLM」，而是 image-derived continuous embeddings 直接佔據 language-model input sequence 的位置。

### 3. Molmo 2 證明「interleaving」本身就是 fusion policy

Ai2 官方說明 Molmo 2 使用 vision encoder 將 image/video frame 轉成 visual tokens，再由 lightweight connector 將 visual tokens 與 timestamps、image indices、text 交錯，交由 Qwen3/OLMo language backbone 一起處理。

因此 fusion 不一定是一個獨立 `FusionLayer`；它也可能是 **sequence construction policy**：

`[text] [image-index] [visual tokens] [timestamp] [text] ... → one decoder stream`

這對 Agent Runtime 很重要，因為 sequence packing、position metadata、video timestamp 都會直接成為 context engineering 的一部分。

### 4. 新一代研究正在突破「只在 LLM input layer 接一次視覺」的 bottleneck

FUSION (2025) 提出 Text-Guided Unified Vision Encoding + Context-Aware Recursive Alignment Decoding：文字資訊不只在 decoder 末端與 vision interaction，而是反過來參與 vision encoding，且 decoding 過程持續依文字 context 聚合 visual features。

CLI (ECCV 2026) 更直接把傳統 one-to-one bridge 定義為 visual feature bottleneck，改成 many-to-many：多個 vision encoder layers 經 Adaptive Multi-Projection 對齊後，可被多個 LLM decoder layers 透過 Adaptive Gating Fusion 動態選取注入。

這代表 fusion architecture 的研究單位應從「projector 長什麼樣」提升成：

`Which vision layer → which language layer → when → by what gate/attention → with what token/cache cost`

### 5. Native MLLM 與 compositional MLLM 應建立成兩個不同知識節點

NaViL (2025) 明確把既有「pretrained vision encoder + pretrained LLM + continuous multimodal training」稱為 compositional paradigm，並研究 end-to-end native MLLM scaling。其研究指出 visual encoder 與 LLM scale 應共同考慮，而且較大的 vision encoder 可促進更早的 cross-modal interaction。

因此不能把所有 VLM 都畫成：

`Vision Encoder → Projector → Frozen/Pretrained LLM`

更完整分類是：

`Compositional MLLM`：獨立 pretrained components 透過 bridge/alignment 組合。

`Native MLLM`：vision-language architecture 與 training 被視為一個共同 scaling / optimization system。

## Architecture Breakdown — Fusion Taxonomy

```text
A. Projector / Input Injection
Image
→ Vision Encoder
→ Projector / Patch Merger
→ Visual Embeddings
→ LLM input positions
→ Decoder
Examples: LLaVA, InternVL, Qwen2.5-VL (implementation details differ)

B. Interleaved Sequence Fusion
Image / Video
→ Vision Encoder
→ Visual Tokens + metadata
→ interleave with text/timestamps/image index
→ Decoder
Example: Molmo 2

C. Recursive / Deep Fusion
Text ↔ Vision Encoder
       ↓
context-conditioned visual features
       ↕
multiple decoder stages
Example: FUSION

D. Cross-Layer Many-to-Many Injection
Vision layer 1 ─┐
Vision layer 2 ─┼→ multi-projection → gated injection → LLM layer 1/2/.../N
Vision layer N ─┘
Example: CLI (ECCV 2026)

E. Native Multimodal Training
Visual pathway + Language pathway
→ jointly designed / end-to-end trained multimodal system
→ early cross-modal interaction can emerge across layers
Example: NaViL
```

## Bottom-Level Logic — visual embedding 如何真的進 decoder

以 input-injection VLM 為例：

```text
1. processor 產生 text input_ids + image placeholder
2. image tensor 進 Vision Transformer
3. 得到 visual hidden states [N_visual, D_vision]
4. merger/projector：D_vision → D_llm，並可能降低 token 數
5. token embedding table 先把文字 input_ids → [N_text, D_llm]
6. image placeholder 對應位置由 projected visual embeddings 取代/插入
7. 組成 inputs_embeds [N_text + N_visual, D_llm]
8. Decoder Layer 1 產生 Q/K/V
9. text positions 與 visual positions 開始透過 self-attention 互相讀取
10. 每一層的新 K/V 進 KV Cache
11. decode token 的 query 可重新 attend 到先前 visual positions
```

所以對這類模型而言，真正 fusion 並不是只發生在 projector；projector 只做 **representation alignment/bridge**。真正大量 text↔vision interaction 通常在 decoder self-attention 中發生。

## Runtime Implication

Fusion design 會直接改變 serving architecture：

- Input injection：主要成本為 visual token prefill + decoder KV。
- Interleaving：Runtime 必須維護 modality ordering、timestamp/image-index metadata、position encoding。
- Cross-attention/deep fusion：可能需要額外保存 vision-side features，且 decoder layer 可能反覆讀取，cache 策略不同於單純 concat tokens。
- Cross-layer injection：需要 vision intermediate-layer feature storage / projection / gating，新增 memory bandwidth 與 per-layer execution path。
- Native MLLM：不能假設可獨立替換 vision encoder 或 LLM 而不破壞 alignment。

## Visual Simulation Idea — Multimodal Fusion X-Ray

Hermes Console 可增加同一張圖的五種 architecture mode：

`Projector` / `Interleaved` / `Cross-Attention` / `Cross-Layer` / `Native`

使用者放入一張圖片與一句問題後，動畫顯示：

- 哪一層產生 visual representations
- visual token 數
- bridge/projector 是否壓縮
- visual data 在哪一個 LLM layer 第一次與 text interaction
- 是一次 injection 還是每層重新讀 vision features
- 需要保存 Encoder Output / Decoder KV / Intermediate Vision Features 哪些 cache
- 預估 prefill / memory / latency 變化

核心教學訊息：**Projection ≠ Fusion；Projection 是對齊，Fusion 是 modalities 真正互相影響 hidden state 的位置與機制。**

## Code / GitHub Targets

### InternVL
Repo: `OpenGVLab/InternVL`
核心檔：`internvl_chat/internvl/model/internvl_chat/modeling_internvl_chat.py`
重點：`vit_embeds`, `pixel_shuffle`, `mlp1`, language model input integration。

### Qwen2.5-VL / Transformers
Repo: `huggingface/transformers`
核心檔：`src/transformers/models/qwen2_5_vl/modular_qwen2_5_vl.py`
重點：Vision Transformer、window index、`merger(hidden_states)`、visual model → language model 的 embedding path。

### Molmo
Repo: `allenai/molmo`
重點：vision encoding、connector、multimodal input construction、training/evaluation code；官方 Molmo 2 架構特別值得追 connector 如何編排 visual tokens/timestamps/image index。

### CLI
Repo: `codefuse-ai/CLI`
重點：Adaptive Multi-Projection (AMP)、Adaptive Gating Fusion (AGF)，研究 many-to-many vision-layer → LLM-layer injection。

## Papers

### FUSION: Fully Integration of Vision-Language Representations for Deep Cross-Modal Understanding
- Authors: Zheng Liu, Mengjie Liu, Jingzhou Chen, Jingwei Xu, Bin Cui, Conghui He, Wentao Zhang
- Institutions: Peking University, Shanghai AI Laboratory, Nanjing University
- Year: 2025
- Architecture: Text-Guided Unified Vision Encoding + Context-Aware Recursive Alignment Decoding
- Contribution: 把 vision-language interaction 從 late decoder interaction 推向 encoder 與 decoder 全流程。
- Limitation: reported benchmark/token efficiency results依該訓練 recipe/model family，不可直接泛化。
- URL: https://arxiv.org/abs/2504.09925
- Code: https://github.com/starriver030515/FLARE

### NaViL: Rethinking Scaling Properties of Native Multimodal Large Language Models under Data Constraints
- Authors: Changyao Tian et al.
- Year: 2025
- Architecture: native end-to-end MLLM
- Contribution: 系統研究 visual encoder / LLM 的 joint scaling 與 native multimodal design。
- Limitation: scaling observations仍受其 data constraint 與 architecture search space 限制。
- URL: https://arxiv.org/abs/2510.08565

### From One-to-One to Many-to-Many: Dynamic Cross-Layer Injection for Deep Vision-Language Fusion
- Venue: ECCV 2026
- Architecture: AMP + AGF cross-layer injection
- Contribution: 讓多個 vision layers 動態注入多個 LLM decoder layers，直接處理 single-bridge bottleneck。
- Limitation: 額外 layer feature storage/gating 與 architecture integration complexity 仍需 serving benchmark 驗證。
- Code: https://github.com/codefuse-ai/CLI

## Knowledge Graph 新增 Node

```text
Multimodal Fusion
├ Representation Alignment
│  ├ Linear Projector
│  ├ MLP Projector
│  └ Patch Merger
├ Input Injection
├ Interleaved Token Fusion
├ Decoder Self-Attention Fusion
├ Cross-Attention Fusion
├ Recursive Alignment
├ Cross-Layer Injection
├ Fusion Gate
└ Native Multimodal Architecture

MLLM Paradigm
├ Compositional MLLM
└ Native MLLM
```

## Knowledge Graph 新增 Edge

`Vision Encoder --produces--> Visual Hidden States`
`Projector --aligns--> Vision Representation to LLM Hidden Dimension`
`Visual Embeddings --occupy--> Multimodal Sequence Positions`
`Decoder Self-Attention --fuses--> Text and Visual Positions`
`Cross-Layer Injection --connects--> Vision Intermediate Layers to LLM Decoder Layers`
`Interleaving Policy --controls--> Multimodal Context Ordering`
`Fusion Architecture --determines--> Cache / Prefill / Memory Pattern`
`Native Training --couples--> Vision Scaling and Language Scaling`

## 已確認 vs 推論

### 已確認
- InternVL 原始碼存在 `vit_embeds → mlp1` bridge。
- Qwen2.5-VL Transformers 實作存在 vision hidden-state merger。
- Molmo 2 官方架構描述 visual tokens 與 timestamps/image indices/text interleave。
- FUSION、NaViL、CLI 的上述機制來自論文/官方 repo。

### 工程推論
- 不同 fusion strategy 應使用不同 cache/resource accounting；這可由架構導出，但具體 VRAM/latency 必須逐模型 benchmark。
- Cross-layer fusion 可能提高 intermediate feature residency/memory bandwidth，但實際成本依 implementation/kernel/fusion method 而定。

## Unknown / Open Questions

1. Qwen/InternVL/Molmo 在 decoder 中，visual positions 的 attention/KV life-cycle 是否完全等同 ordinary text positions？需逐 model attention mask、position IDs、cache update 原始碼驗證。
2. Cross-attention architecture 是否能讓 vision features 保留在獨立 cache，降低 decoder KV 對 visual token 數的線性壓力？需要選具代表性的 Flamingo/Perceiver-style 與 modern VLM 實測。
3. Native MLLM 的「更早 cross-modal interaction」究竟主要來自 architecture、joint training，還是 scaling/data distribution？需追 controlled ablation。

## 下一輪

優先研究：**Cross-Attention vs Token Concatenation 的 cache / GPU / context 差異**。

下一輪要從以下資料流直接比較：

`Token Concat: visual tokens → same decoder self-attention → same sequence KV`

vs

`Cross Attention: text decoder queries → separate vision features K/V`

並追 Flamingo/Perceiver Resampler、BLIP-2/Q-Former 與現代 cross-attention VLM 原始碼，建立「Multimodal Fusion → Cache Topology → GPU Cost」連線。
