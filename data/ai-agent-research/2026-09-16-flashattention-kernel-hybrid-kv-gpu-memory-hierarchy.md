# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 05:53（Asia/Taipei）

主題：FlashAttention × PagedAttention Kernel × GPU Memory Hierarchy × Hybrid KV Groups × Full/Sliding/Mamba Attention

## 與歷史研究比較

上一輪已建立 Logical KV Block → Block Table/Radix Prefix → Physical KV Block/HBM 的映射。本輪不重複 allocator/scheduler，而是往下回答：physical KV block 進入 attention kernel 後，GPU 到底如何搬資料、計算 attention，以及 hybrid attention model 為什麼使 cache layout 變複雜。

## 本小時新發現

1. FlashAttention 的核心不是近似 attention，而是 exact attention 的 IO-aware tiling：避免顯式 materialize N×N attention matrix 到 HBM，將 Q/K/V tiles 搬到較快的 on-chip SRAM，利用 online softmax 分塊累積。
2. PagedAttention 與 FlashAttention 解不同問題：PagedAttention 解 KV 的非連續 physical placement / block-table addressing；FlashAttention 解 attention 計算過程的 HBM↔on-chip IO。實際 serving kernel 必須同時處理「paged gather + tiled attention」。
3. vLLM hybrid KV manager 已把 full attention、sliding-window、Mamba/local attention 分成 KVCacheGroup；group 內 attention type 相同且 page size 必須統一。Full attention 要保存全部歷史；sliding window 只需近期 window；Mamba 保存 recurrent state，資源語義並非傳統 K/V。
4. Hybrid model 的 prefix-cache hit 不能只查一套 prefix：full + sliding-window 需要取各 group 可用 prefix 的交集；目前 vLLM 文件明確限制 hybrid prefix coordinator 的支援範圍，主要是 full + X 兩類 attention。
5. 最新 vLLM cache configuration 已出現 ReplaySSM / KDA RecoverSSM 等 state-space decode cache，顯示「KV Cache」這個節點需要升級為更一般的 ModelStateCache。

## 本小時最重要 5 個發現

### 1. FlashAttention = IO complexity optimization

已確認論文結果：標準 attention 會產生/讀寫大型 score/probability matrices；FlashAttention 透過 tiling 降低 HBM IO，同時維持 exact attention。

底層：
Q,K,V in HBM → tile load to on-chip memory → QK^T tile → running max / running normalizer → exp-weighted V accumulation → output tile → HBM。

為什麼重要：GPU FLOPS 很高，但 attention 常受 memory movement 限制；減少 HBM round trips 可直接改善 wall-clock。

限制：kernel performance 仍受 head dimension、sequence length、dtype、GPU architecture、occupancy、register/shared-memory pressure 影響。

來源：Dao et al., FlashAttention (2022), arXiv:2205.14135；vLLM attention backend/kernel implementation。

### 2. PagedAttention ≠ FlashAttention

工程確認：vLLM 的 block table 提供 logical token/block 到 physical KV blocks 的間接 addressing；attention backend/kernel再使用這些 mappings 執行 paged decode/prefill。

模型：
Token position → logical block → block_table[logical] → physical block id → KV address → attention tile。

PagedAttention 處理「KV 在哪裡」；FlashAttention 處理「怎麼少搬資料完成 attention」。兩者可組合，不應在 Knowledge Graph 合併成同一概念。

### 3. Hybrid attention 需要 layer-type-aware cache semantics

官方 vLLM Hybrid KV Cache Manager：Full attention、sliding-window、local attention、Mamba 的 state retention 規則不同。為統一 physical allocator，vLLM 建 KVCacheGroup 並嘗試統一 page size；不規則 layer ratio 可能產生 padding waste，Mamba state size 差異甚至會迫使 attention block_size 放大。

限制：官方文件明示功能仍在演進；某些 hybrid prefix caching / context-parallel combinations 有限制。

### 4. Prefix-cache correctness 是 attention-type dependent

Full attention cache hit 要求完整 prefix 的 KV 尚存；sliding-window 只需最近 window 所需 tokens。Full+SW hybrid 因此要先求 full 的最長 hit，再在其範圍內找 SW 可成立的 hit。

這代表 PrefixCacheHit 不是單一 boolean，而應是：
PrefixCacheEvidence{group_id, attention_type, reusable_range, required_state, hit_length}。

### 5. KV Cache 應泛化成 ModelStateCache

工程實作顯示 hybrid Mamba/SSM layers 保存的不是標準 K/V history，而是 recurrent/state-space state；最新 vLLM config 也包含 ReplaySSM/KDA RecoverSSM 路徑。因此 Hermes 圖譜若只用 KVCache 作所有 inference state 的父節點會失真。

建議：ModelStateCache → AttentionKVCache / SlidingWindowKV / MambaState / MultimodalEncoderCache / SpeculativeState。

## Architecture Breakdown

User/Agent
→ Model Router
→ Inference Server
→ Scheduler
→ KV/State Cache Manager
→ KVCacheGroup Coordinator
→ Block Table
→ Attention Backend
→ Kernel Launch
→ GPU
  → HBM: Q/K/V, KV pages, output
  → L2 cache
  → on-chip shared memory/SRAM + registers
  → warp/SM matrix operations
→ tiled QKᵀ
→ online softmax
→ tiled P·V
→ output
→ logits
→ sampling
→ next token

Hybrid model path：
Layer i
→ AttentionType
  ├ FullAttention → all-history KV
  ├ SlidingWindow → recent-window KV
  ├ LocalChunk → local state
  └ Mamba/SSM → recurrent state
→ KVCacheGroup / ModelStateGroup
→ unified allocator/page constraints
→ backend-specific kernel。

## Bottom-Level Logic

Standard conceptual attention：
S = QKᵀ / √d
P = softmax(S)
O = PV

問題不是只有 arithmetic O(N²)，還有 S/P 中間矩陣造成大量 HBM traffic。

FlashAttention tiled online-softmax：對 K/V blocks j 逐塊處理，維護每個 query row 的 running maximum m、normalizer l、accumulator O；新 tile 到來時用新的 max 重縮放舊 accumulator，再加入新 exp(score-m)·V，因此不需把完整 S/P 寫回 HBM。

Paged KV decode：
query token
→ sequence block table
→ physical KV block ids
→ gather/read K,V tiles
→ attention reduction across blocks/partitions
→ normalize/reduce
→ output。

因此 serving 的真實瓶頸需同時觀察：HBM bytes、cache locality、block-table indirection、shared-memory/register pressure、occupancy、kernel launch/scheduling，而不能只看 TFLOPS。

## Visual Simulation Idea

### Attention IO Microscope × Hybrid State Cache Viewer

左：Sequence/Layer map，可切 Full / Sliding / Mamba。
中：Logical block table → physical HBM page grid，動畫顯示 paged gather。
右：GPU memory hierarchy：HBM → L2 → Shared/SRAM → Registers → SM，顯示每個 FlashAttention tile 的資料搬移。

互動：sequence length、head dim、MHA/GQA、block size、window size、HBM bandwidth、SRAM tile size、hybrid layer ratio。

指標：HBM bytes read/write、estimated arithmetic intensity、KV footprint、page padding waste、prefix reusable range、tile count、TTFT/ITL proxy。

最重要的教學模式：切換 Naive Attention / FlashAttention，直接看到 N×N score matrix 是否寫回 HBM；切換 contiguous KV / paged KV，看到 address mapping 差異；切換 Full / SW / Mamba，看到 state retention 差異。

## Code / GitHub

vLLM 值得繼續讀：
- csrc/rocm/attention.cu：native paged-attention kernel/partition reduction 路徑。
- vllm/v1/attention/ops/chunked_prefill_paged_decode.py：chunked prefill + paged decode orchestration。
- vllm/v1/attention/backends/*：backend dispatch、KV cache split/layout。
- vllm/v1/core/kv_cache_utils.py：hybrid KV group/page-size construction。
- vllm/v1/core/kv_cache_coordinator.py：full/Mamba/hybrid group coordination與限制。
- vllm/config/cache.py：block/window/ReplaySSM 等 cache semantics。

後續要與 SGLang/FlashInfer/Triton attention kernels 做相同層級比較，而不是只比較 README benchmark。

## Papers

### FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness
Authors: Tri Dao, Daniel Y. Fu, Stefano Ermon, Atri Rudra, Christopher Ré
Institution: Stanford University / University at Buffalo (authors affiliations依原論文)
Year: 2022
URL: https://arxiv.org/abs/2205.14135
Code: https://github.com/Dao-AILab/flash-attention
Dataset/benchmarks: BERT/GPT-2/Long Range Arena 等論文 workloads
Architecture: tiled exact attention + online softmax + IO-aware GPU memory algorithm
Contribution: 把 attention optimization 從只看 FLOPs 改成 HBM↔SRAM IO complexity。
Limitations: 硬體/shape/backend-sensitive；原論文不解決 serving KV allocator/prefix cache/multi-tenant scheduler。
改變了什麼：建立「IO-aware exact attention」作為現代高效 Transformer kernel 的核心設計原則。

## 已確認 / 推論界線

已確認：FlashAttention 是 exact IO-aware tiled attention；vLLM hybrid KV manager 的 group/page-size/prefix規則；vLLM repository存在 paged-attention kernel與chunked-prefill/paged-decode路徑。
工程推論：Hermes 應把 KVCache 泛化為 ModelStateCache，並把 page addressing 與 tile IO 分成不同圖譜節點。
尚未驗證：不同 GPU 架構上各 backend 真實 HBM/L2/shared-memory hit ratio與 occupancy；需要 profiler/Nsight 或 kernel benchmark。

## Unknown / Open Questions

1. vLLM CUDA/FlashInfer/Triton 不同 attention backend 在相同 paged-KV workload 下，block-table indirection、L2 locality、register pressure差多少？
2. Hybrid Full+SW+Mamba 在更複雜 attention-type 組合下，如何避免統一 page-size造成 padding/fragmentation浪費？
3. Agent workload 的 tool-pause/resume 是否應影響 kernel/backend selection，或只停留在 scheduler/cache residency 層？

## 下一輪研究

優先進入：FlashAttention-2/3 × Warp/CTA work partition × Tensor Core × HBM/L2/Shared Memory/Register × Roofline/Arithmetic Intensity × GQA/MQA × KV quantization。並比較 vLLM FlashInfer/Triton/CUDA backend，建立「一個 token 在 GPU 上如何完成一層 attention」的可視化 execution trace。

## Knowledge Graph 新增 Node / Edge

Nodes：FlashAttention、AttentionTile、OnlineSoftmax、HBMTraffic、OnChipSRAM、RegisterPressure、AttentionBackend、PagedKVKernel、BlockTableIndirection、KVCacheGroup、HybridKVCacheCoordinator、FullAttentionState、SlidingWindowState、MambaState、ModelStateCache、PrefixCacheEvidence、PagePaddingWaste、AttentionIOComplexity。

Edges：PagedAttention --LOCATES--> PhysicalKVBlock；FlashAttention --REDUCES--> HBMTraffic；AttentionTile --LOADED_FROM--> HBM；AttentionTile --STAGED_IN--> OnChipSRAM；BlockTable --ADDRESSES--> PhysicalKVBlock；AttentionBackend --EXECUTES--> PagedKVKernel；KVCacheGroup --HAS_ATTENTION_TYPE--> AttentionType；SlidingWindowState --RETAINS--> RecentTokens；FullAttentionState --RETAINS--> AllHistoryTokens；MambaState --IS_A--> ModelStateCache；PrefixCacheEvidence --DEPENDS_ON--> AttentionType。

## 本輪結束判斷

缺哪一層：GPU warp/CTA/Tensor Core 實際 execution mapping與memory transaction profiling。
最淺節點：OnChipSRAM、RegisterPressure、backend-specific PagedKVKernel。
仍只是名詞：跨 backend 的統一 AttentionExecutionTrace。
最值得讀原始碼：vLLM attention backends + FlashInfer/Triton kernels。
需追引用論文：FlashAttention → FlashAttention-2 → FlashAttention-3，以及 serving-specific paged attention kernel工作。
最適合視覺模擬：Attention IO Microscope。
最值得實作架構：ModelStateCache + AttentionBackend execution graph，銜接既有 Scheduler/KV simulator。

## AI 到底怎麼運作：本輪新增鏈

UI → Agent → Context → Reasoning → Planning → Model Router → Scheduler → Tokenizer → Transformer Layer → Q/K/V → ModelState/KV Cache → Block Table → Physical HBM Pages → Attention Backend → HBM-to-on-chip Tiles → QKᵀ → Online Softmax → PV Accumulation → Layer Output → FFN → … → Logits → Sampling → Output Token → Agent → Tool/MCP → Action。

多模態路徑則在 Encoder 產生 visual/audio representations 後進入 model token/state flow；下一階段需進一步把 multimodal encoder cache、cross-attention與GPU kernel路徑接到同一張 execution graph。