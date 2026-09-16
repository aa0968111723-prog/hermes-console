# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 15:51 Asia/Taipei

## 本小時新發現

本輪接續上一輪 `Request Shape Bucketing × CUDA Graph × ExecutionPlanCache`，刻意避開已完成的 text decoder graph bucketing，轉入多模態 encoder 的 dynamic geometry。核心新架構是 vLLM 的 `EncoderCudaGraphManager`：vision encoder CUDA Graph 與 decoder graph 分離，以「encoder output token budget」而非單純 image H×W 作 capture/replay key；新設計也支援 image/video、mixed image+video，以及 DeepSeek-OCR 類 two-tower global/local multi-path graph。

本輪新增研究主題：Vision Encoder CUDA Graph、EncoderItemSpec、BudgetGraphMetadata、Multi-Path Graph、Vision Token Geometry、Video Frame Axis、Encoder Cache、Dynamic Token Pruning vs Static Graph Envelope。

## 本小時最重要 5 個發現

### 1. Multimodal CUDA Graph 的 shape abstraction 可以是 token budget，而不是 raw pixels

已確認官方資訊／工程實作：vLLM `EncoderCudaGraphManager` 在初始化時預先 capture 多個 token budget（例如 2048/4096/8192/13824）；runtime 先取得每個 image/video item 的 `EncoderItemSpec`，再選能容納 total output tokens 的最小 budget，將實際 input copy/pad 到固定 buffers 後 replay graph。

底層：
`Image/Video → processor/grid metadata → EncoderItemSpec(output_tokens) → greedy packing → smallest fitting token budget → fixed replay buffers → CUDA Graph → encoder embeddings`。

重要性：raw resolution/frame count 是外部幾何；真正進 GPU graph compatibility 的是模型轉換後的 token geometry、batch item count、frame axis 與 path-specific output size。

限制：budget padding 仍可能產生無效 encoder compute；部分 model-specific geometry 需要 device→host metadata read。

來源：vLLM docs/design/cuda_graphs_multimodal.md；`vllm/v1/worker/encoder_cudagraph.py`。

### 2. 多塔 Vision Encoder 不應被壓成單一 monolithic graph

已確認官方資訊：DeepSeek-OCR 類 global + local patch path 的 token profile 不同。vLLM multi-path graph 為 global/local 各 capture 一套 budgets，允許一條 path graph hit、另一條 eager fallback。

底層：
`Image → Global Path → global token budget → graph/eager`
`      ↘ Local Tiles → local token budget → graph/eager`
`→ postprocess → patch grid + global embedding + separators → LLM visual sequence`。

為什麼重要：如果把兩條 path 強迫進同一固定 graph，untiled image 會浪費 zero-padded local buffers，而且 variable crop geometry 會破壞 capture compatibility。

限制：multi-path 增加 graph 數量、capture memory 與 planner state。

### 3. Video graph 多了一個「frame axis」，且 data-dependent pruning 與 CUDA Graph 天生衝突

已確認官方資訊：video 使用 `pixel_values_videos` / `video_grid_thw`，且每個 video item 由多個 temporal sequences/frames 構成，所以 graph metadata 除 token budget、max batch size 外還需 `max_frames_per_batch`。vLLM 明確指出 EVS/VidCom2 類 video token pruning 啟用時會停用 video CUDA Graph，原因是 pruning 使 token count data-dependent。

底層：
`Video → frame sampling → T×H×W grid → patch/tubelet tokens → optional token pruning → encoder sequence length`。

若 pruning 在 runtime 才決定：`content → retained token set → dynamic shape`，會破壞固定 graph envelope。

重要性：這揭示一個通用衝突：**adaptive perception** 想依內容改計算量；**static execution optimization** 想固定 shape/addresses/control flow。

合理工程推論：未來 planner 需要「pruning bucket」或 masked-static-envelope，而不是二選一 graph/eager。

### 4. Vision Encoder Cache 與 LLM KV Cache 是不同 state system

已確認工程實作：vLLM `EncoderCacheManager` 以 multimodal item hash 管理 encoder output embeddings，可跨 request/stage 避免重算；cache 容量按 encoder embeddings 計，不包含 multimodal embeddings 之間的 break/text tokens。allocation 時在空間不足下優先 eviction 零引用的舊 entry。

底層：
`Media bytes/content → hash → encoder-cache lookup`
`hit → cached vision embeddings → multimodal placeholder merge`
`miss → vision encoder → embeddings → cache allocation → merge`
`→ decoder prefill → KV cache`。

因此應建立兩個不同 Knowledge Graph state：`PerceptionStateCache` 與 `DecoderModelStateCache`。

限制：content hash、processor/model revision、preprocessing config 若未被正確納入 identity，會形成 stale/semantic mismatch 風險；這點需要後續讀 cache-key 原始碼驗證。

### 5. Vision token 數量本身已是 runtime 的一級成本變數

論文結果：LLaVA-Mini（Zhang, Fang, Yang, Feng；2025）指出大量 vision tokens 是 LMM 成本來源之一，透過 modality pre-fusion 將送入 LLM backbone 的 vision token 極端壓到 1 個；其論文在 11 image + 7 video benchmarks 報告相對 LLaVA-v1.5 的效率收益。這些數字只代表該架構與測試設定。

PruMerge（Shang, Cai, Xu, Lee, Yan；2024）則用 visual encoder attention sparsity + key similarity 做 adaptive visual-token selection/merge，論文報告平均約 14× token compression 並維持相近任務表現。

改變了什麼：multimodal execution planner 不應只把 vision encoder 當 preprocessing；`visual token count` 同時影響 encoder compute、encoder graph bucket、LLM prefill length、attention FLOPs、KV allocation、CUDA graph eligibility。

## Architecture Breakdown

```text
Camera / Image / Video
→ Decode / Resize / Normalize / Frame Sample
→ Spatial-Temporal Geometry (T,H,W)
→ Patchify / Tubelet
→ Vision Encoder Input Tokens
→ Encoder Graph Planner
   ├ modality
   ├ item count
   ├ output token geometry
   ├ path (global/local/default)
   ├ frame axis
   └ token budget
→ CUDA Graph Budget
   ├ hit → padded fixed buffers → replay
   └ miss → eager encoder
→ Vision Embeddings
→ Encoder Cache
→ Projector / Merger / Separator Tokens
→ Multimodal Placeholder Replacement
→ LLM Prefill Tokens
→ Decoder CUDA Graph / Attention Backend
→ KV / Model State Cache
→ Decode
→ Agent Reasoning / Tool / MCP / Action
```

### System architecture：Multimodal Static-Envelope Runtime

`PerceptionExecutionPlan = f(modality, content geometry, processor, encoder architecture, path geometry, token budget, frame budget, pruning mode, graph inventory, encoder cache state, GPU)`。

這一層位於 Media Processor 與 LLM Decoder PhysicalExecutionPlan 之間，是上一輪 planner 缺少的多模態前半段。

## Bottom-Level Logic

本輪深入 mechanism：budget-based encoder CUDA graph replay。

```text
1 Media processor 產生 pixel tensors + grid metadata
2 Model-specific get_encoder_cudagraph_item_specs()
3 得到每 item output_tokens/path_output_tokens
4 Scheduler/manager 對 items greedy pack
5 尋找 smallest budget >= packed output tokens
6 prepare_encoder_cudagraph_replay_buffers()
7 將實際 tensors slice-copy/pad 進 capture 時固定地址 buffers
8 torch.cuda.CUDAGraph.replay()
9 讀固定 output buffer
10 按 item 真實 token counts 切回 outputs
11 model-specific postprocess 組回 patch/global/separator geometry
12 寫入 encoder output cache
13 merge 到 decoder input sequence
```

關鍵機制不是「CUDA Graph 加速 ViT」這個名詞，而是 **variable multimodal geometry → bounded static token envelope → fixed-address replay → unpadding/postprocess**。

## Visual Simulation Idea

### Multimodal Geometry → GPU Graph Simulator

左側輸入：image resolution、image count、video frames/FPS、global/local tiling、patch size、token pruning ratio。

中央同步顯示：
`Pixels → Grid THW → Patch Tokens → Encoder Output Tokens → Path Token Budgets → Graph Packing`。

右側 GPU timeline：
`Graph Hit / Partial Hit / Eager`、padding tokens、frame padding、capture memory、encoder latency、encoder-cache hit、LLM prefill token count、KV bytes。

最有價值的互動：同一張圖從 512² 拉到 2048²，使用者能看到 raw pixels 如何變成 tiles/patches，再跨過 budget boundary 導致不同 CUDA Graph；打開 adaptive pruning 時 graph 從 hit 變 eager，直觀看見「模型適應性 vs runtime static optimization」的衝突。

## Code / GitHub

### vLLM
值得繼續讀：
- `vllm/v1/worker/encoder_cudagraph.py`：EncoderCudaGraphManager、BudgetGraphMetadata、budget selection/replay。
- `vllm/v1/worker/gpu/mm/encoder_runner.py`：encoder execution、cache profiling。
- `vllm/v1/core/encoder_cache_manager.py`：multimodal embedding cache lifecycle。
- `vllm/multimodal/encoder_budget.py`：每 modality max tokens/item 與 encoder compute/cache budget。
- `docs/design/cuda_graphs_multimodal.md`：single/multi-path image/video architecture。

原始碼已確認 `EncoderCudaGraphManager` 位於 `vllm/v1/worker/encoder_cudagraph.py`；`EncoderCacheManager` 位於 `vllm/v1/core/encoder_cache_manager.py`，scheduler 直接引用它。

## Papers

### LLaVA-Mini: Efficient Image and Video Large Multimodal Models with One Vision Token
Authors: Shaolei Zhang, Qingkai Fang, Zhe Yang, Yang Feng
Institution: paper affiliations需下一輪逐項核實
Year: 2025
URL: https://arxiv.org/abs/2501.03895
Code: 需下一輪核實官方 repository
Dataset/Benchmarks: 11 image-based + 7 video-based benchmarks（論文摘要）
Architecture: modality pre-fusion + compressed vision-token interface + LLM
Contribution: 將 vision token quantity 視為核心 inference cost，展示極端 token compression 路徑。
Limitations: one-token representation 的細粒度資訊保留、跨 backbone 泛化與高解析 spatial grounding 仍需逐 benchmark 驗證。

### LLaVA-PruMerge: Adaptive Token Reduction for Efficient Large Multimodal Models
Authors: Yuzhang Shang, Mu Cai, Bingxin Xu, Yong Jae Lee, Yan Yan
Year: 2024
URL: https://arxiv.org/abs/2403.15388
Code: https://llava-prumerge.github.io/
Architecture: CLS-attention importance → token selection → key-similarity clustering/merge → LLM
Contribution: content-adaptive visual-token reduction。
Limitations: adaptive token count 與 static CUDA Graph compatibility 形成 runtime tradeoff；方法結果不可直接外推所有 VLM。

## Unknown / Open Questions

1. Encoder cache identity 是否完整綁定 processor/model revision、resize/crop/frame-sampling configuration？需追 hash/cache-key 產生原始碼。
2. 能否將 data-dependent visual token pruning 編譯成少量 retention buckets + mask，保留大部分 CUDA Graph replay？
3. Encoder Graph budget、decoder graph bucket、KV budget 三者是否能由同一 end-to-end cost model聯合選擇，而不是各自 local optimum？

## 下一輪研究

`Multimodal Processor Hash/Cache Identity × Qwen VL Dynamic Resolution × Video Frame Sampling × Vision Token Pruning × Encoder Cache Correctness × Cross-Encoder/Decoder Joint Planner`。

優先追 vLLM multimodal cache-key、Qwen VL image/video grid THW 與 merge/downsample 邏輯，將 `pixel/frame → exact token count` 變成可計算公式，再接到 decoder prefill/KV bytes。

## Knowledge Graph 新增 Node / Edge

Nodes：`VisionTokenGeometry`, `EncoderItemSpec`, `EncoderCudaGraphManager`, `EncoderTokenBudget`, `BudgetGraphMetadata`, `MultiPathEncoderGraph`, `GlobalVisionPath`, `LocalPatchPath`, `VideoFrameAxis`, `GraphPacking`, `GraphPaddingWaste`, `AdaptivePerception`, `StaticExecutionEnvelope`, `PerceptionStateCache`, `EncoderEmbeddingCache`, `MultimodalPlaceholderMerge`, `VisualTokenCompression`, `PerceptionExecutionPlan`。

Edges：
- `ImageResolution → PatchGrid → VisionTokenGeometry`
- `VideoFrames → TemporalGrid → VisionTokenGeometry`
- `VisionTokenGeometry → EncoderTokenBudget → CUDA Graph Eligibility`
- `DynamicTokenPruning → DynamicShape → GraphIncompatibility`
- `MediaHash → EncoderEmbeddingCache → EncoderComputeAvoided`
- `EncoderOutputTokens → LLM PrefillLength → AttentionCost`
- `EncoderOutputTokens → DecoderKVAllocation`
- `MultiPathGeometry → IndependentGraphBudgets`
- `PerceptionExecutionPlan → DecoderPhysicalExecutionPlan`

## 本輪結束判斷

缺哪一層：`raw media → model-specific exact token geometry` 的跨模型公式層。

哪個節點最淺：`EncoderCacheIdentity`、`AdaptivePruningGraphBucket`。

哪個概念仍只是名詞：`CrossEncoderDecoderJointPlanner`。

哪個系統值得讀原始碼：vLLM `encoder_cudagraph.py + encoder_cache_manager.py + Qwen VL model/processor integration`。

哪篇論文需追引用：LLaVA-PruMerge，尤其後續 dynamic visual token pruning 與 serving/runtime papers。

哪個概念最適合視覺模擬：`Pixels/Frames → Vision Tokens → Encoder Graph Budget → LLM Prefill/KV`。

哪個 Agent 架構最值得實作：延續 Hermes 的 Request-Aware Physical Execution Planner，但新增 `PerceptionExecutionPlanner` 子層，使 multimodal request 在進入 reasoning/agent loop 前已有可解釋的 media→GPU execution trace。

## 驗證分級

已確認事實/官方資訊：vLLM encoder CUDA graph budget architecture、multi-path design、video frame budget、token-pruning incompatibility、encoder cache semantics。

論文結果：LLaVA-Mini、PruMerge 的 compression/benchmark claims，只視為各論文 workload 結果。

工程實作：vLLM `EncoderCudaGraphManager` / `EncoderCacheManager` source locations 與 runtime roles。

合理推論：pruning buckets、cross encoder-decoder joint planner、cache identity versioning schema。

尚未驗證假說：以少量 retention buckets + mask 能在不顯著犧牲 pruning efficiency 下維持 CUDA Graph hit rate；下一輪需找實證或原型。
