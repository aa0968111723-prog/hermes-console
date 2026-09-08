# 【AI Agent × Multimodal Research Report】

時間：2026-09-09 05:53（Asia/Taipei）

主題：**Visual Projector × Resampler × Q-Former × Visual Token Compression × Multimodal Bottleneck**

## 本輪定位與歷史比較

本輪接續上一輪 `Token ID → Embedding → Residual Stream`，補上多模態路徑中尚未被充分拆深的：

`Image → Vision Encoder → Visual Features → Projector/Resampler → LLM Hidden Space → Decoder Residual Stream`

歷史研究 `2026-09-08-multimodal-fusion.md` 已建立 Projector / Interleaving / Cross-Attention / Cross-Layer / Native 五類 fusion taxonomy。本輪不重複該分類，而是把其中最常見、也最容易被一句「projector 對齊視覺與文字」帶過的 **bridge bottleneck** 拆到底：它到底改維度、改 token 數、改語意抽象程度，還是同時做三件事？

---

## 本小時新發現

- 新研究節點：**QMoP: Query Guided Mixture-of-Projector for Efficient Visual Token Compression**（2026），開始把 projector 從固定元件變成 query-conditioned router。
- 新 benchmark 節點：**VTCBench**，專門測 visual-token compression 帶來的資訊損失，而非只看一般 VQA aggregate score。
- 新理論/診斷節點：**DeCo** 提出「compression 與 semantic abstraction 應解耦」，指出 Q-Former 類 compressive projector 可能造成 double abstraction。
- 新 runtime 節點：visual token count 會直接放大 LLM prefill、decoder KV residency、position occupancy 與 multimodal serving latency。
- 新工程結論：**Projection ≠ Compression ≠ Selection ≠ Fusion**，四者應成為 Knowledge Graph 的不同 node。

---

# 本小時最重要 5 個發現

## 1. Projector 最底層首先是一個「座標系/維度轉換器」，不是神祕的跨模態理解模組

### 已確認事實 / 原始碼

Hugging Face 現行 `LlavaMultiModalProjector` 直接實作為：

```text
D_vision
↓ Linear
D_llm
↓ activation
↓ Linear
D_llm
```

也就是：

```python
linear_1: vision_hidden × num_feature_layers → text_hidden
activation
linear_2: text_hidden → text_hidden
```

之後 projected image features 會取代 input sequence 中 image placeholder 對應的 embedding，才真正送進 language model。

PaliGemma 更簡單：`PaliGemmaMultiModalProjector` 是單一 Linear：

```text
Vision hidden size
↓ Linear
Projection / language-compatible size
```

之後同樣透過 placeholder mask，把 image features 寫入 `inputs_embeds`。

### Bottom-level meaning

如果 vision encoder 輸出：

```text
V ∈ R^(N_v × D_v)
```

projector 做：

```text
P(V) ∈ R^(N'_v × D_l)
```

其中：

- `D_v`：vision representation dimension
- `D_l`：LLM hidden dimension
- `N_v`：vision token count
- `N'_v`：projector 後 token count

最單純 MLP projector 通常主要改 `D_v → D_l`，不一定改 token 數。

所以它首先是在回答：

> 「vision encoder 的向量，如何變成 language decoder 可以直接當 hidden-state input 讀取的向量？」

而真正的大規模 vision↔text interaction，對 input-injection 架構而言，多半是在後續 decoder self-attention 中發生。

### 為什麼重要

把 projector 叫成「fusion layer」會混淆兩個不同問題：

```text
Representation Alignment
≠
Cross-modal Interaction
```

Projector 可以只做 alignment；fusion 則可能稍後才在 Transformer attention 發生。

### 限制

實際模型中 projector 也可能同時做 token pooling、resampling、merging、query conditioning，因此不能把所有 projector 都視為純 Linear/MLP。

### Sources

- Hugging Face LLaVA implementation: https://github.com/huggingface/transformers/blob/main/src/transformers/models/llava/modeling_llava.py
- Hugging Face PaliGemma implementation: https://github.com/huggingface/transformers/blob/main/src/transformers/models/paligemma/modeling_paligemma.py
- PaliGemma architecture overview: https://developers.googleblog.com/en/gemma-explained-paligemma-architecture/

---

## 2. Visual Token Compression 的真正 trade-off 是「prefill/KV 成本」對「可供後續 reasoning 取用的視覺資訊」

高解析圖片很容易產生大量 patch features：

```text
Image
↓ Patchify
N_v visual patches
↓ Vision Transformer
N_v visual hidden states
```

如果把全部視覺 token 直接送進 LLM：

```text
N_total = N_text + N_visual
```

LLM 必須對更長 sequence 做 prefill，且每一層都會對這些 multimodal positions 建 K/V cache。

所以 visual token count 不是只有「vision encoder 比較慢」；它會一路向下污染：

```text
Visual Token Count ↑
→ LLM Prefill Tokens ↑
→ Attention Work ↑
→ KV Cache Residency ↑
→ Memory / Latency ↑
```

這也是為什麼 projector/resampler 從早期「對齊維度」逐步變成「同時壓縮 token」的 runtime 元件。

### Paper result

TokenPacker（2024）指出單純 MLP one-to-one projection 會保留大量冗餘 visual token；其 coarse-to-fine projector 在論文實驗中壓縮約 75%–89% visual tokens，同時維持或提升多項 benchmark 表現。這些數字屬於該模型與 benchmark 設定，不能視為普遍常數。

### 2026 更新

QMoP 進一步把問題改寫成：

> 不同 query 需要的視覺資訊粒度不同，因此固定 compression policy 本身就是限制。

它設計三條 branch：

```text
Pooling branch
Resampler branch
Pruning branch
      ↑
Query-Guided Router
```

然後由文字 query + visual input 動態決定壓縮策略。

### Sources

- TokenPacker: https://arxiv.org/abs/2407.02392
- Code: https://github.com/CircleRadon/TokenPacker
- QMoP: https://arxiv.org/abs/2603.21232

---

## 3. MLP Projector、Q-Former、Perceiver Resampler 解的是不同 bottleneck，不能只用「Connector」一詞包掉

### A. MLP / Linear Projector

```text
Visual Token 1 → MLP → Visual Token 1'
Visual Token 2 → MLP → Visual Token 2'
...
```

特性：

- token 對 token，容易保留細節
- architecture 簡單
- visual token 數通常不降低
- 高解析度時 LLM token cost 高

LLaVA 是這類典型。

### B. BLIP-2 Q-Former

BLIP-2 用一組 learned query tokens 去 query frozen image encoder features：

```text
Learned Queries
        ↓ Q
Cross Attention
        ↓ K/V
Image Features
        ↓
Compact Query Representations
        ↓
LLM
```

它的核心不是逐 patch 線性轉換，而是用固定數量 query embeddings 從大量 visual features 抽取資訊。

BLIP-2 的重要工程意義：可以讓 frozen image encoder + frozen LLM 透過輕量中介層對接，減少重新訓練巨大 backbone 的需求。

### C. Flamingo Perceiver Resampler

Flamingo 則把變長的 image/video features resample 成固定大小 latent set，再透過 gated cross-attention 注入 frozen LM：

```text
Variable Visual Features
↓
Learned Latent Queries
↓ Cross Attention
Fixed-size Visual Latents
↓
Gated Cross Attention into LM
```

所以 Q-Former 與 Perceiver Resampler 雖然都使用 learned queries，但系統位置與訓練角色不同：BLIP-2 的 Q-Former 是 modality bridge/pretraining bottleneck；Flamingo resampler 則主要把 variable visual sequence 變成固定視覺記憶，再被語言層反覆 cross-attend。

### 為什麼重要

應將「Connector」拆成至少三個軸：

```text
1. Dimension Alignment
2. Token Compression
3. Semantic Selection / Querying
```

否則一個 Linear projector 和一個 cross-attention resampler 會被錯誤畫成同一種元件。

### Sources

- LLaVA / Visual Instruction Tuning: https://arxiv.org/abs/2304.08485
- BLIP-2: https://arxiv.org/abs/2301.12597
- Flamingo: https://arxiv.org/abs/2204.14198

---

## 4. 「壓縮得越聰明」不一定越好：DeCo 指出 compressive projector 可能造成 Double Abstraction

### 論文結果

DeCo（2024）分析 visual semantic flow，指出 Q-Former 類 compressive projector 可能先把原始 patch features 抽象成有限 semantic concepts；之後 LLM 又依 instruction 做第二次 semantic extraction。

形成：

```text
Raw Visual Patch
↓ Vision Encoder abstraction
Visual Feature
↓ Projector semantic abstraction
Compressed Concept
↓ LLM instruction-conditioned abstraction
Answer-relevant Concept
```

作者稱之為：

```text
Double Abstraction
```

其主張是：compression 與 semantic abstraction 應解耦。

因此 DeCo 使用較簡單、parameter-free 的 2D adaptive pooling 做 patch-level token reduction，把「這次問題真正需要什麼語意」留給 LLM 做。

### 知識圖譜修正

Projector 要拆成：

```text
Projection
├ Dimension Transform
├ Token Compression
├ Semantic Abstraction
└ Query-conditioned Selection
```

其中四個能力可同時存在，但不應默認綁在一起。

### 為什麼重要

這讓「projector 越複雜越聰明越好」變成可驗證假說，而不是設計直覺。

尤其 OCR、圖表、細小物件、空間定位等任務，需要保留 local evidence；過早語意壓縮可能把日後才知道有用的細節丟掉。

### Source

- DeCo: https://arxiv.org/abs/2405.20985

---

## 5. 下一代 Projector 正從 static bridge 變成 task/query-aware information router

QMoP（2026）是本輪最值得新加入的架構節點。

傳統：

```text
Every Image
↓
Same Projector
↓
Same Compression Ratio / Logic
```

QMoP：

```text
Image Features ───────────────┐
                              │
Text Query → Query Router ────┼→ choose/weight
                              │
             ┌ Pooling ───────┤
             ├ Resampler ─────┤→ Mixture Fusion → Visual Tokens
             └ Pruning ───────┘
```

這代表 visual context compilation 開始和上一輪建立的 `Context Compiler` 概念接起來：

```text
Text Context Compiler
↕
Visual Context Compiler
```

兩者本質上都在做有限 budget 下的資訊選擇。

### 合理工程推論（尚未驗證）

Hermes 未來可以把 multimodal context budget 做成統一控制器：

```text
Task
↓
Modality Relevance Estimator
↓
Budget Allocation
├ Text tokens
├ Image tokens
├ Video frames/tokens
└ Audio tokens
↓
Per-modality Compressor
↓
Shared LLM Context
```

這比固定「每張圖 576 tokens」更符合 Agent 長任務、多工具、多圖片情境。

但 adaptive compression 若依 query 決定，就必須防止：

- query 誤導造成關鍵視覺 evidence 被丟棄
- prompt injection 影響 token selection
- router instability
- benchmark overfitting

### Source

- QMoP: https://arxiv.org/abs/2603.21232

---

# Architecture Breakdown

## System Architecture：Vision-to-Language Bridge Runtime

```text
Camera / Image
↓
Image Processor
├ resize / crop
├ normalize
└ patchify
↓
Vision Encoder
↓
Visual Feature Tensor
[N_v, D_v]
↓
Bridge Router
├ Linear / MLP Projector
├ Pooling Compressor
├ Query Resampler
├ Token Pruner
├ Patch Merger
└ Mixture-of-Projector
↓
Projected / Compressed Visual Tokens
[N'_v, D_llm]
↓
Placeholder / Sequence Assembler
↓
Text Embeddings + Visual Embeddings
↓
LLM Residual Stream
↓
Decoder Self-Attention
↓
Vision ↔ Text Interaction
↓
LM Head
↓
Output Tokens
↓
Agent
```

### Runtime data objects 建議

```text
VisionFeatureBatch
├ source_id
├ encoder_id
├ feature_layer
├ token_count_in
├ hidden_dim_in
├ spatial_layout
└ tensor_ref

ProjectedVisionContext
├ projector_id
├ compression_mode
├ token_count_out
├ hidden_dim_out
├ compression_ratio
├ query_conditioned
├ spatial_map
├ provenance_map
└ tensor_ref
```

這使 visual token 不再只是不可追蹤的 `image_hidden_states`。

---

# Bottom-Level Logic

以 LLaVA 類 MLP injection 為例：

```text
1. RGB image
2. resize / normalize
3. patchify
4. ViT patch embedding
5. Vision Transformer layers
6. 選取某一層 hidden states
7. 可移除 CLS token
8. Projector Linear D_v → D_llm
9. Activation
10. Linear D_llm → D_llm
11. 找出 input sequence 的 image placeholder positions
12. 將 projected visual vectors 寫入 inputs_embeds
13. 建立完整 multimodal sequence
14. LLM Layer 1 產生 Q/K/V
15. text query 可以 attend visual positions
16. visual positions 也成為 decoder residual state 的一部分
17. 每層產生 visual-position KV
18. decode 時新 token 可再次 attend cached visual K/V
```

以 query-resampler 類為例，多出：

```text
Visual Features
↓
Learned Queries
↓
Q = Query Latents
K/V = Visual Features
↓
Cross Attention
↓
M compact latent tokens
↓
Project to LLM dimension
```

因此 compression ratio：

```text
r = N_visual_in / N_visual_out
```

但真正重要的不只是 r，而是：

```text
Information Retention(task)
Latency(r)
KV Memory(r)
Spatial Fidelity(r)
OCR Fidelity(r)
```

這是一個 task-conditioned Pareto frontier，而不是單一最佳比例。

---

# Visual Simulation Idea — Visual Token Bottleneck X-Ray

Hermes Console 建議新增一個高度互動的 **Visual Token Bottleneck X-Ray**。

左側顯示圖片 patch grid：

```text
[■][■][■][■][■][■]
[■][■][■][■][■][■]
[■][■][■][■][■][■]
...
```

中間可切換：

```text
MLP Projector
Q-Former
Perceiver Resampler
2D Pooling
TokenPacker
Query-Guided Mixture
```

右側顯示送入 LLM 的 visual tokens：

```text
576 → 576
576 → 144
576 → 64
576 → 32
```

每個 output visual token 點擊後，高亮其來源 patch / attention region：

```text
Visual Token #18
← receives evidence from
patches (12,13,19,20,21)
```

旁邊即時顯示：

```text
Input visual tokens
Output visual tokens
Compression ratio
Estimated LLM prefill tokens
Estimated KV bytes
Spatial coverage
Query relevance
Evidence lost
```

再提供四種問題：

```text
「這張圖在做什麼？」          global semantics
「右下角小字寫什麼？」        OCR/local detail
「紅球在藍盒子的哪一邊？」    spatial relation
「哪個按鈕可以送出？」        GUI grounding
```

使用者會直接看到：同一張圖片、同一壓縮率，對不同 query 的資訊損失完全不同。

### Failure Injection

```text
Over-compression
Wrong query routing
Remove fine patches
Random pruning
Spatial shuffle
Projector dimensional mismatch
Placeholder/token-count mismatch
```

其中 `placeholder/token-count mismatch` 在 PaliGemma/LLaVA 現行實作都有明確 runtime check，是很適合用來解釋「model protocol 與 multimodal tensor shape 必須吻合」的 failure。

---

# Code / GitHub

## 1. Hugging Face Transformers — LLaVA

Repo: `huggingface/transformers`

核心檔：

`src/transformers/models/llava/modeling_llava.py`

值得追：

- `LlavaMultiModalProjector`
- `get_image_features()`
- vision hidden-layer selection
- CLS removal policy
- `get_placeholder_mask()`
- `masked_scatter()` visual embedding insertion
- language-model `inputs_embeds` path

核心事實：現行 projector 是 two-layer MLP；visual embedding 實際透過 placeholder mask 寫入 LLM input embeddings。

## 2. Hugging Face Transformers — PaliGemma

核心檔：

`src/transformers/models/paligemma/modeling_paligemma.py`

值得追：

- `PaliGemmaMultiModalProjector`
- `vision_tower`
- `get_image_features()`
- placeholder count 與 image feature count consistency check
- prefix bidirectional / suffix causal masking

PaliGemma projector 比 LLaVA 更簡單，是很好的 baseline。

## 3. TokenPacker

Repo: `CircleRadon/TokenPacker`

目錄：

```text
TokenPacker/
├ README.md
├ llava/
├ scripts/
├ docs/
└ assets/
```

下一步應深入追 `llava/` 中 projector builder、multimodal encoder integration 與 region-to-point injection 實作，不應只看 README。

## 4. BLIP-2 / LAVIS

建議後續追：`salesforce/LAVIS`

重點：Q-Former、learned query tokens、image-grounded representation learning、vision-to-language generative stage。

## 5. Flamingo / OpenFlamingo

建議後續追：`mlfoundations/open_flamingo`

重點：Perceiver Resampler、gated cross-attention layers、media-conditioned attention mask、interleaved image/text sequence handling。

---

# Papers

## 1. Visual Instruction Tuning

- Title: Visual Instruction Tuning
- Authors: Haotian Liu, Chunyuan Li, Qingyang Wu, Yong Jae Lee
- Institution: University of Wisconsin–Madison / Microsoft Research (paper affiliations)
- Year: 2023
- URL: https://arxiv.org/abs/2304.08485
- Code: https://github.com/haotian-liu/LLaVA
- Dataset: machine-generated multimodal instruction-following data + downstream datasets
- Architecture: vision encoder + projector + LLM
- Contribution: 將通用 visual instruction tuning 與簡單 projector bridge 推成主流 MLLM recipe。
- Limitations: one-shot input bridge 會把大量 visual-token processing 責任交給 LLM；高解析輸入成本高。
- 改變了什麼：證明「強 vision encoder + 強 LLM + 輕量 projector + instruction tuning」可以成為有效通用 VLM 基線。

## 2. BLIP-2: Bootstrapping Language-Image Pre-training with Frozen Image Encoders and Large Language Models

- Authors: Junnan Li, Dongxu Li, Silvio Savarese, Steven Hoi
- Institution: Salesforce Research
- Year: 2023
- URL: https://arxiv.org/abs/2301.12597
- Code: LAVIS / Salesforce Research ecosystem
- Dataset: 多種 image-text pretraining corpus（詳見 paper）
- Architecture: frozen image encoder + Q-Former + frozen LLM
- Contribution: 用 lightweight Querying Transformer bridge 兩個 frozen pretrained modalities。
- Limitations: query bottleneck 本身可能成為資訊壓縮點；細粒度 evidence 是否保留取決於 learned queries。
- 改變了什麼：把 multimodal adaptation 的訓練成本從 end-to-end backbone training 移到 connector learning。

## 3. Flamingo: a Visual Language Model for Few-Shot Learning

- Authors: Jean-Baptiste Alayrac et al.
- Institution: DeepMind
- Year: 2022
- URL: https://arxiv.org/abs/2204.14198
- Architecture: frozen vision encoder + Perceiver Resampler + gated cross-attention + frozen LM
- Contribution: variable image/video features → fixed visual latents，並支援 interleaved multimodal in-context learning。
- Limitations: cross-attention injection 與 resampler 增加 architecture/runtime complexity，且 fixed latent budget 本身仍是一種 bottleneck。
- 改變了什麼：讓 vision 不必單次 concat 進 LLM input，而可作為獨立 visual memory 被 LM layers condition。

## 4. DeCo: Decoupling Token Compression from Semantic Abstraction in Multimodal Large Language Models

- Authors: Linli Yao, Lei Li, Shuhuai Ren, Lean Wang, Yuanxin Liu, Xu Sun, Lu Hou
- Year: 2024
- URL: https://arxiv.org/abs/2405.20985
- Architecture: parameter-free 2D adaptive pooling compressor
- Contribution: 提出 double abstraction 診斷，主張 compression 與 semantic abstraction 分離。
- Limitations: 結論依其模型族、下游任務與 semantic-flow analysis 方法；不能直接證明所有 query-based projectors 都有相同程度問題。
- 改變了什麼：把 projector 設計問題從「哪個模組更強」轉成「應在哪一層做語意抽象」。

## 5. TokenPacker: Efficient Visual Projector for Multimodal LLM

- Authors: Wentong Li, Yuqian Yuan, Jian Liu, Dongqi Tang, Song Wang, Jie Qin, Jianke Zhu, Lei Zhang
- Year: 2024
- URL: https://arxiv.org/abs/2407.02392
- Code: https://github.com/CircleRadon/TokenPacker
- Architecture: low-resolution point query + high-resolution region-to-point feature injection
- Contribution: coarse-to-fine visual token compression，試圖同時保留 global semantics 與 fine detail。
- Limitations: 多層 vision feature / region injection 帶來額外 bridge compute，且 benchmark 成績不能等同所有 task 的 evidence fidelity。
- 改變了什麼：把 projector 由純 alignment 模組推成 explicit efficiency architecture。

## 6. QMoP: Query Guided Mixture-of-Projector for Efficient Visual Token Compression

- Authors: Zhongyang Li, Yaqian Li, Faming Fang, Rinyoichi Takezoe, Zi-Hao Bo, Cheng Qian, Mo Guang, Guixu Zhang, Kaiwen Long
- Institutions: East China Normal University; Li Auto Inc.
- Year: 2026
- URL: https://arxiv.org/abs/2603.21232
- Dataset/Benchmark: VTCBench + standard MLLM evaluation suites
- Architecture: pooling + resampler + pruning branches with query-guided router and mixture fusion
- Contribution: 將 static visual compression 轉為 input/query-adaptive compression。
- Limitations: 新方法需要更廣泛跨模型、跨 video/audio、對抗性 query 與 production serving benchmark；router 本身也新增 failure surface。
- 改變了什麼：Projector 開始從「固定 bridge」演化成「multimodal context routing policy」。

---

# 已確認 / 推論 / 假說分層

## 已確認事實

- LLaVA 現行 Transformers implementation 使用 two-layer MLP multimodal projector。
- PaliGemma 現行 implementation 使用 Linear multimodal projector。
- 兩者都將 projected visual features 寫入/替換 LLM input embedding sequence 的 image placeholder positions。
- BLIP-2 使用 Q-Former bridge frozen image encoder 與 frozen LLM。
- Flamingo 使用 Perceiver Resampler + gated cross-attention。

## 論文結果

- TokenPacker 報告可大幅壓縮 visual tokens，同時在其 benchmark 維持/提升效能。
- DeCo 報告 compressive semantic projectors 存在 double-abstraction 問題，並以簡單 pooling 改善其實驗設定。
- QMoP 報告 query-adaptive mixture compression 可改善 efficiency/performance trade-off。

## 合理工程推論

- Hermes 應將 text context compression 與 visual token compression 放入同一 Context Budget Manager。
- visual token provenance map 對 debug multimodal hallucination、compression loss 與 GUI grounding failure 很有價值。

## 尚未驗證假說

- Agent 可以依 task risk 動態調高 visual token budget，例如「讀小字/GUI點擊」自動採低壓縮，「場景摘要」採高壓縮。
- 對高風險 computer-use action，應禁止 query-only router 在無 evidence coverage check 下過度 pruning。

---

# Unknown / Open Questions

1. **Compression loss 如何在線估計？** 模型尚未生成答案前，runtime 如何知道某次 576→64 是否已丟失 OCR/座標/GUI affordance 所需 evidence？
2. **Visual provenance 如何跨 projector 保留？** 一個 resampled token 可能混合數十個 patches；若 Agent 最後點錯 UI，能否反推出是哪個 source region 被錯誤抽象？
3. **Query-conditioned compression 的安全性如何處理？** 若文字 prompt 本身被 injection，能否誘使 router 刪除真正安全關鍵的 visual tokens？

---

# Knowledge Graph 新增 Node / Edge

```text
Visual Bridge Runtime
├ Vision Feature Tensor
├ Dimension Alignment
├ Visual Projector
│  ├ Linear Projector
│  ├ MLP Projector
│  ├ Patch Merger
│  ├ Q-Former
│  ├ Perceiver Resampler
│  ├ Pooling Compressor
│  ├ Token Pruner
│  └ Mixture-of-Projector
├ Visual Token Budget
├ Compression Ratio
├ Spatial Fidelity
├ Semantic Fidelity
├ Visual Provenance Map
└ Placeholder Alignment
```

```text
Visual Information Bottleneck
├ Token Compression
├ Semantic Abstraction
├ Query-conditioned Selection
├ Double Abstraction
├ Local-detail Loss
├ OCR Loss
├ Spatial Loss
└ Runtime Savings
```

新增核心 edges：

```text
Vision Encoder
→ produces
Vision Feature Tensor

Visual Projector
→ aligns dimension to
LLM Hidden Space

Visual Compressor
→ reduces
Visual Token Count

Visual Token Count
→ increases
LLM Prefill Cost

Visual Token Count
→ increases
KV Cache Footprint

Q-Former
→ queries
Vision Features

Perceiver Resampler
→ converts
Variable Visual Features → Fixed Visual Latents

Query
→ conditions
QMoP Router

Compression
→ may cause
Evidence Loss

Projected Visual Tokens
→ enter
LLM Residual Stream
```

---

# 下一輪研究

下一輪最值得進入：

# **Vision Encoder × Patch Embedding × 2D Position × SigLIP/CLIP × High-Resolution Dynamic Tiling**

把目前仍是黑盒的：

```text
Image
↓
Vision Encoder
↓
Visual Features
```

繼續拆成：

```text
RGB Pixels
↓
Resize / Crop / Tile
↓
Patchify
↓
Patch Projection
↓
2D Position Encoding
↓
Vision Transformer
├ Q/K/V
├ Attention
├ MLP
└ Residual
↓
Multi-layer Visual Features
↓
Feature Selection
↓
Projector / Resampler
```

需要回答：

- CLIP 與 SigLIP 的 training objective 差在哪裡，為什麼會影響 VLM vision tower？
- Patch size 14/16/32 如何改變 token 數與細節？
- 224/448/896 或 dynamic resolution 如何改變 runtime？
- 2D position / RoPE 在 vision 中如何編碼 spatial relation？
- 為什麼 OCR、GUI、chart 對 resolution/token pruning 特別敏感？
- multi-layer feature selection 為什麼有時比最後一層 vision feature 更好？

---

# 本輪結束檢查

- **缺哪一層：** Pixel → Patch → Vision Transformer 的完整底層鏈。
- **哪個節點最淺：** Visual provenance / evidence retention 的可量化指標。
- **哪個概念仍只是名詞：** Multimodal Context Budget Manager。
- **哪個系統值得讀原始碼：** TokenPacker projector implementation、BLIP-2 Q-Former、OpenFlamingo Perceiver Resampler。
- **哪篇論文需追引用：** QMoP（2026）與 DeCo；前者代表 adaptive compression，後者代表 compression/abstraction 解耦。
- **哪個概念最適合視覺模擬：** Visual Token Bottleneck X-Ray。
- **哪個 Agent 架構最值得實作：** Hermes 單 Agent Runtime + query/task-aware multimodal context compiler，而非新增一個「視覺 Agent」去重複做 perception。

## 核心結論

> **Vision Encoder 的輸出不能直接等同「圖片理解」；Projector 也不能等同「多模態融合」。在主流 VLM 中，vision features 必須先被轉到 LLM hidden space，並常在這一步被壓縮、選擇或重新抽象。真正的設計問題是：哪些 visual evidence 被保留成多少 tokens、以什麼座標系進入 residual stream，以及這些資訊損失是否值得換取更低的 prefill / KV / latency。**
