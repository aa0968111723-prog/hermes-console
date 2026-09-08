# AI Agent × Multimodal AI 底層研究 — Multimodal Token → Runtime → GPU

時間：2026-09-08

## 本輪定位

延續既有 Agent Runtime → Memory/Context → KV Cache 研究，本輪專注補齊：

`Image / Video → Vision Encoder → Multimodal Embeddings/Tokens → LLM Prefill → KV Cache → GPU Runtime`

並將結果以 Hermes Console 可直接讀取的研究資料形式匯入，不新增第二代理。

## 已確認事實

### 1. 多模態推理至少存在兩種不同 cache

vLLM V1 的 `EncoderCacheManager` 專門管理圖片等 multimodal input 經 encoder 計算後的 embeddings；它和 decoder LLM 的 KV cache 不是同一種資料。相同 multimodal item 可藉由 hash 跨 request 分享 encoder embeddings，避免重算 encoder。

資料流：

`Image → preprocess → Vision Encoder → encoder embeddings → Encoder Cache → projection/input sequence → LLM prefill → per-layer K/V → KV Cache → decode`

### 2. Visual token 的成本會同時影響 prefill 與 KV footprint

圖片/影片被轉成大量視覺表示後，若這些位置進入 decoder sequence，它們會增加 prefill 計算，並使 attention/KV 狀態增長。這就是多圖、多幀 Agent 常見 latency/VRAM 壓力的直接來源之一。

### 3. Qwen2.5-VL 使用 dynamic-resolution ViT + Window Attention

Qwen 官方說明其 ViT 支援 native dynamic resolution；大部分 vision layers 使用 Window Attention，僅少數使用 Full Attention，以降低高解析度視覺輸入的計算負荷。

### 4. vLLM 已將 multimodal encoder budget 納入 scheduler/runtime

`compute_mm_encoder_budget()` 根據 scheduler configuration 與每種 modality 的最大 token/input budget 決定 encoder compute/cache capacity。這表示多模態 serving 並非單純「先跑 vision model 再丟給 LLM」，而是必須被 runtime scheduler 納入資源調度。

### 5. 2026 研究開始從「刪 visual token」進一步做到 layer/cache 結構優化

Q Cache (2026) 觀察不同 decode layers 的 visual attention 存在冗餘，提出跨 layer 共用 query/attention pattern 的 Lazy Attention/Q Cache；論文報告可降低 >35% KV cache 使用並提升約 1.5× throughput，代價約 1% performance。這是該論文實驗結果，不應視為所有模型的通用倍率。

VisCache (2026-08) 則針對影片/視覺長 context 做 keyframe filtering + layer-wise visual KV pruning，顯示 multimodal inference optimization 正從 encoder token reduction 延伸到 decoder KV cache。

## Architecture Breakdown

```text
User / Agent
   ↓
Image / Video / Audio input
   ↓
Multimodal Preprocessor
   ├ resize / normalize
   ├ frame sampling
   └ modality hashing
   ↓
Vision / Audio Encoder
   ↓
Multimodal Embeddings
   ↕
Encoder Cache
   ↓
Projection / Modality Adapter
   ↓
Text + Multimodal Sequence
   ↓
LLM Prefill
   ↓
Transformer Layers
   ↓
KV Cache
   ↓
Autoregressive Decode
   ↓
Agent Runtime
   ├ Tool Call
   ├ MCP
   ├ Memory
   └ Final Output
```

### 最重要區分

`Encoder Cache != KV Cache != Agent Memory`

- Encoder Cache：避免同一圖片/影片 encoder 重算。
- KV Cache：保存 decoder Transformer 已計算的 attention K/V tensors。
- Agent Memory：保存可被未來 run 檢索的語義/事件/偏好/任務狀態。

## Bottom-Level Logic

一張圖真正進入 VLM 的抽象流程：

```text
Pixels
→ preprocessing
→ patches / visual units
→ Vision Transformer
→ visual embeddings
→ projection/alignment
→ multimodal positions in LLM input
→ Q/K/V projection per decoder layer
→ KV cache allocation
→ logits
→ sampling
```

影片再多一層：

```text
Video
→ frame sampling / temporal chunking
→ frame encoder
→ temporal representation
→ visual token sequence
→ LLM prefill
→ KV cache
```

因此影片成本通常不只來自「檔案比較大」，而是 temporal sampling 後產生更多 encoder work 與 multimodal sequence positions。

## Visual Simulation Idea — Multimodal Runtime X-Ray

建議 Hermes Console 後續增加一個可視化研究面板：

`上傳圖片/影片 → 顯示 preprocess → encoder → visual token count → encoder cache → LLM prefill → KV cache → decode`

互動欄位：
- image resolution / video frames
- estimated visual tokens
- encoder cache hit/miss
- prefill tokens
- KV cache estimated footprint
- latency breakdown
- tool/agent continuation

使用者切換「Agent Memory / Encoder Cache / KV Cache」時，畫面明確顯示三者完全不同。

## Knowledge Graph 新增節點

```text
Multimodal Runtime
├ Multimodal Preprocessor
├ Vision Encoder
├ Audio Encoder
├ Multimodal Embedding
├ Projection / Adapter
├ Encoder Cache
├ Multimodal Scheduler Budget
└ Visual KV Cache

Inference State
└ KV Cache

Agent State
└ Long-Term Memory
```

新增 Edge：

`Image --encoded by--> Vision Encoder`
`Vision Encoder --produces--> Multimodal Embedding`
`Multimodal Embedding --cached by--> Encoder Cache`
`Multimodal Embedding --projected into--> LLM Input Sequence`
`LLM Input Sequence --prefill creates--> KV Cache`
`KV Cache --consumes--> GPU VRAM`
`Agent Runtime --coordinates--> Multimodal Runtime`

## Papers / Code

### Q Cache: Visual Attention is Valuable in Less than Half of Decode Layers for Multimodal Large Language Model
- Authors: Jiedong Zhuang et al.
- Year: 2026
- Core: Lazy Attention + Q Cache, cross-layer reuse of visual attention/query patterns.
- Limitation: reported gains are model/benchmark dependent.
- URL: https://arxiv.org/abs/2602.01901

### VisCache: Visual KV Cache Pruning for Efficient Vision Large Language Model Inference
- Authors: Lyuke Wang, Zhuo Li, Guangxu Zhu
- Year: 2026
- Core: keyframe filtering + visual KV pruning for long-context VLLM inference.
- URL: https://arxiv.org/abs/2608.24063

### LightVLM
- Authors: Lianyu Hu et al.
- Year: 2025
- Core: pyramid token merging during encoding + KV compression during decoding.
- URL: https://arxiv.org/abs/2509.00419

### vLLM
值得繼續閱讀：
- `vllm/v1/core/encoder_cache_manager.py`
- multimodal config/runtime
- scheduler
- KV cache manager

## Unknown / Open Questions

1. 不同 VLM architecture 中，visual embeddings 在進入 decoder 後是否全部形成等價的 per-layer KV footprint？需要依模型 projector/fusion 架構逐一驗證。
2. Encoder Cache 與 decoder KV Cache 如何在 disaggregated multimodal serving 中共同調度？
3. 影片 Agent 最佳的 temporal compression 應在 frame sampling、vision encoder、visual token、還是 decoder KV 層完成？

## Hermes Console 導入建議

本輪先以研究資料檔導入，避免破壞現有 runtime。後續產品實作應沿現有 `lib/runtime.ts` / server event contract 加入：

- `research.run.created`
- `research.finding.created`
- `research.node.upserted`
- `research.edge.upserted`
- `research.simulation.proposed`

前端只渲染這些 structured events；不要新增第二個研究 Agent，也不要顯示 hidden reasoning。

## 下一輪

優先研究：

`Multimodal Fusion Architecture`：LLaVA projector vs Qwen-VL style adapter/fusion vs cross-attention/early fusion；並把「visual token 到底如何進 decoder」拆成可比較的 architecture matrix。
