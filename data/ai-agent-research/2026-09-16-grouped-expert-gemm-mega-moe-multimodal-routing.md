# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 10:55（Asia/Taipei）

主題：Grouped Expert GEMM × Expert-Major Layout × Mega MoE × FP8/FP4 × Router-to-Kernel Critical Path × Multimodal MoE Routing

## 與歷史研究比較

前一輪已追到 MoE Router → capacity/drop/reroute → DeepEP warp/channel/QP → expert-major buffer。本輪不再重複 routing/dispatch，而從「expert-major buffer 已形成」往下追：每個 expert 不同 token count 如何成為 grouped GEMM 的 M 維、prefill/decode 為何需要不同 layout、如何把 dispatch + L1 + SwiGLU + L2 + combine 融成 mega-kernel，以及多模態 token phase 如何改變 expert role。

## 本小時新發現

1. DeepGEMM 現行 grouped GEMM 專門把 MoE 的 group 放在 M 軸；N/K 固定，符合 experts 共用 FFN shape、但每個 expert token 數不同的結構。
2. Prefill/training 適合 contiguous expert-major layout；decode + CUDA Graph 下 CPU 未必知道各 expert 實際 token count，因此 masked grouped GEMM 只計算 mask 內有效區域。
3. DeepGEMM 2026 Mega MoE 已把 EP dispatch、Linear1、SwiGLU、Linear2、EP combine 融合/重疊到單一 mega-kernel，使用 symmetric memory，顯示 MoE optimization 正從 operator fusion 進入 communication-compute co-scheduling。
4. MegaMoE scheduler 原始碼不是單純依 expert 排 GEMM：TaskInfo 直接攜帶 BlockPhase、local_expert_idx、m_block_idx、n_cluster_idx、pool_block_idx、valid_m、shape_n、shape_k；L1/L2 之間還以 readiness mask / ring generation 管 dependency，並計算 L1 warmup waves 防止 L1→L2 deadlock。
5. 2026 MonoMoE 指出 decode 的 grouped/batched GEMM token-major 組織在每 expert token 很少時會產生 padding、短 grid 與低 bandwidth utilization，改採 weight-major persistent megakernel，把整個 decode token tile 放在 tensor-core N 維並沿 expert weight tiles 分 CTA。
6. Multimodal MoE 不能只統計全域 expert frequency。RoleMerge 指出 image-context、question、answer 三個 phase 的 routing distribution 不同，而 image token 數通常遠多於文字 query/answer，global aggregation 會遮蔽 phase-conditioned expert role。

## 本小時最重要 5 個發現

### 1. Expert token count 就是 grouped GEMM 的動態 M

已確認工程實作：對 expert e，若 routed token 數為 m_e，FFN 第一層可寫成：

X_e[m_e, H] × W1_e[H, 2I] → U_e[m_e, 2I]
SwiGLU(U_e) → V_e[m_e, I]
V_e[m_e, I] × W2_e[I, H] → Y_e[m_e, H]

不同 expert 的 H/I 相同，但 m_e 不同。因此 grouped GEMM 的真正問題不是一般 batched GEMM，而是 ragged M dimension。

底層：Router → histogram(tokens/expert) → prefix offsets / expert-major layout → grouped GEMM task descriptors → CTA tiles。

重要性：Router skew 最後不是抽象的「負載不均」，而是某些 expert 的 M 很大、某些 M 很小，直接改變 tile occupancy、padding、grid lifetime 與 tail latency。

限制：不同 kernel/backend 對 alignment、mask、no-pad 的支援不同，不能把一個 library 的 layout 規則泛化成所有 MoE runtime。

來源：DeepGEMM README/API/kernel；MonoMoE 2026。

### 2. Prefill 與 Decode 需要不同 Expert Layout

工程實作：DeepGEMM contiguous layout 將不同 expert tokens 串成一個 tensor，expert segment 需符合 GEMM M-block alignment；masked layout則讓 decode 在 CUDA Graph、CPU 不知道動態 token count 時，由 mask 指定有效範圍。

模型：
Prefill → many tokens/expert → contiguous packing → large grouped GEMM
Decode → few tokens/expert → sparse/irregular groups → masked/persistent strategy

重要性：同一個 MoE layer 在 prefill/decode 可能需要不同 kernel plan，Inference Runtime 不應只以 model architecture 固定選 backend。

限制：masked layout仍可能有預留最大 shape 的成本；persistent/weight-major kernel也有模型 shape 與硬體 specialization 成本。

### 3. Mega MoE 把「網路與 GEMM」變成同一個 scheduler 問題

已確認原始碼：DeepGEMM Mega MoE README 說明融合/重疊 EP dispatch、Linear1、SwiGLU、Linear2、EP combine；scheduler 的 TaskInfo 明確包含 Linear1/Linear2 phase、expert、M/N block、pool block、valid M。scheduler 還計算 L1 warmup waves，並使用 L1 completion mask 讓 L2 K blocks 在資料 ready 後啟動。

Architecture：
Dispatch → L1 tile ready → L1 Tensor Core → intermediate pool/ring → L2 readiness → L2 Tensor Core → combine

不再是：Dispatch 完 → launch GEMM1 → launch activation → launch GEMM2 → combine。

重要性：communication latency 可以藏在 expert compute 後面，中間 activation 也不必反覆 materialize 到全域記憶體。

限制：mega-kernel 增加 scheduling/correctness 複雜度，且高度依賴 SM100/symmetric-memory 等硬體/runtime capability。

### 4. Decode 的核心問題可能從 token-major 轉成 weight-major

論文結果：MonoMoE（2026）將 quantized MoE decode 改為 weight-major persistent megakernel，融合 routing/top-k/quantization/two projections/activation/reduction；論文在 H200 的指定模型/批次上報告 routed-MoE operator 最多 1.54× 相對 vLLM Triton Grouped GEMM，端到端 output-token time 最多下降 18.7%。這些不是通用固定收益。

底層原因：decode 時 m_e 很小，token-major grouped GEMM 很容易 tile padding 且 grid 太短；weight-major 讓 CTA 沿 expert weight tiles 保持持續工作。

### 5. Multimodal Router 必須帶 phase/modality 語意

論文結果：RoleMerge（2026）指出 MoE-VLM 的 image-context / question / answer routing roles 不同；若只做 global routing aggregation，數量巨大的 image-context tokens 會主導統計。MoE-GRPO 則把 VLM expert selection 視為 sequential decision，並加入 modality-aware router guidance。

因此 Hermes 的 RouterTrace 應增加：
modality、phase、token_source、expert_ids、routing_weights、expert_role_profile。

重要性：同一 expert「常被圖片 token 使用」與「在 answer decoding 對 reasoning 關鍵」是不同角色；不能只用 activation frequency 做 expert pruning/placement/merging。

限制：phase-conditioned routing role 是否可跨 model 泛化仍需更多模型與原始碼驗證。

## Architecture Breakdown

### System Architecture：Router-to-Mega-MoE Execution

Input hidden states
→ Router logits
→ Top-K expert IDs + weights
→ tokens/expert histogram
→ expert-major permutation / offsets
→ EP dispatch
→ symmetric receive buffer
→ MegaMoE Scheduler
  → Linear1 TaskInfo
  → L1 tile scheduling
  → Tensor Core GEMM
  → intermediate pool/ring
  → L1 completion mask
  → Linear2 readiness
  → SwiGLU / quantized intermediate
  → Linear2 TaskInfo
  → Tensor Core GEMM
→ EP combine
→ inverse routing merge
→ original token order

### Bottom-Level Mechanism：Ragged M → CTA Tiles

對 expert e：m_e = routed token count。

m_blocks_e = ceil(m_e / BLOCK_M)
valid_m(last block) = m_e mod BLOCK_M

每個 task 至少需要：expert id、m block、n tile/cluster、valid_m、phase、pool/intermediate block。

因此：
Router probability distribution
→ m_e distribution
→ number of CTA tiles/expert
→ grid balance
→ Tensor Core occupancy
→ straggler
→ layer tail latency。

DeepGEMM MegaMoE scheduler 更進一步讓 L1/L2 task 交錯，利用 dependency mask 表達「L2 的某 K block 所需 L1 N blocks 是否已完成」。這是 model dataflow 被編譯成 GPU readiness state machine 的具體例子。

## Visual Simulation Idea

### MoE Router → Tensor Core Tile Microscope

四層同步動畫：

1. Semantic/Multimodal layer：Image / Question / Answer tokens，以 phase 標記。
2. Router layer：Top-K matrix + expert histogram。
3. Layout layer：token-major → expert-major contiguous/masked/weight-major 三種布局切換。
4. GPU layer：每個 expert 的 M×N tiles 映射到 CTA/SM/Tensor Core；顯示 L1/L2 task、pool block、readiness mask、dispatch/combine traffic。

互動參數：batch、image token ratio、top-k、router skew、BLOCK_M、expert count、FP8/FP4、contiguous/masked/weight-major、fusion on/off。

指標：padding FLOPs、valid-M ratio、CTA count、SM occupancy、expert straggler、dispatch bytes、intermediate bytes、kernel launches、tail latency。

最值得看的動畫是：把某一批 image tokens 加入後，Router histogram 改變 → expert M 維改變 → tile grid 改變 → 某 GPU 成為 straggler。

## Code / GitHub

### DeepGEMM

值得繼續讀：
- deep_gemm/include/deep_gemm/scheduler/mega_moe.cuh — MegaMoE TaskInfo、L1/L2 phase scheduling、warmup/dependency/ring logic。
- deep_gemm/include/deep_gemm/impls/sm100_fp8_fp4_mega_moe.cuh — FP8×FP4 MegaMoE compute implementation。
- deep_gemm/include/deep_gemm/impls/sm100_bf16_mega_moe.cuh — BF16 path。
- deep_gemm/layout/mega_moe.cuh / sym_buffer.cuh — intermediate/symmetric memory layout。
- csrc/apis/mega_moe.hpp — API/runtime boundary。
- csrc/jit_kernels/heuristics/mega_moe.hpp — kernel configuration heuristic。
- csrc/jit_kernels/impls/sm90_fp8_gemm_1d2d.hpp — grouped contiguous/masked GEMM launch path。
- tests/test_mega_moe.py — correctness/performance model與 symmetric-memory usage。

已確認 API 同時暴露 grouped contiguous 與 masked FP8/FP4 paths；Mega MoE README 明確說明 communication + L1/SwiGLU/L2 + combine 的融合/重疊。

### FlashInfer MonoMoE

值得下一輪讀：csrc/fused_moe/monomoe，特別是 persistent grid、weight-major tile mapping、readiness flags、quantized weight stream。

## Papers

### MonoMoE: An Efficient Fused Mega-kernel for Quantized MoE Decoding
Authors: Yu Gong, Kailash Budhathoki, Taeho Kim, Haipeng Li, Ashish Khetan
Year: 2026
URL: https://arxiv.org/abs/2609.04244
Code: https://github.com/flashinfer-ai/flashinfer/tree/main/csrc/fused_moe/monomoe
Architecture: weight-major persistent mega-kernel
Contribution: 消除 decode expert-local token materialization/padding，融合 routing、top-k、quantization、兩層 expert projection、activation、reduction。
Limitations: H200/量化 MoE/特定 shapes；需要 generated specialization/offline tuning。
改變：把 MoE decode 的主要執行單位從 token-major expert group 改成 persistent expert-weight stream。

### Scalable Training of Mixture-of-Experts Models with Megatron Core
Authors: Zijie Yan et al.
Institution: NVIDIA / Megatron Core team
Year: 2026
URL: https://arxiv.org/abs/2603.07685
Architecture: integrated MoE memory/communication/Grouped-GEMM/fusion/parallel folding stack
Contribution: 說明 MoE 需要 memory×communication×compute co-design。
Limitations: 主要聚焦 training 與 NVIDIA stack。
改變：把 grouped GEMM、dispatcher、overlap、low precision、parallel folding放進統一 systems design。

### Beyond Global Routing Aggregation: Phase-Aware Expert Merging for MoE Vision-Language Models
Authors: Hongyu Zhang, Cheng Yan, Xiang Xia, Wuyang Zhang
Year: 2026
URL: https://arxiv.org/abs/2608.04454
Architecture: Routing Role Profile / phase-normalized expert role
Contribution: image-context/question/answer 分 phase 統計 expert role，避免 image-token count 主導 global aggregation。
Limitations: expert merging 場景；需驗證是否能直接轉成 serving placement policy。
改變：multimodal expert identity 從 global frequency 變成 phase-conditioned role。

### MoE-GRPO: Optimizing Mixture-of-Experts via Reinforcement Learning in Vision-Language Models
Authors: Dohwan Ko, Jinyoung Park, Seoung Choi, Sanghyeok Lee, Seohyun Lee, Hyunwoo J. Kim
Year: 2026
URL: https://arxiv.org/abs/2603.24984
Architecture: RL-based sequential expert selection + modality-aware guidance
Contribution: 讓 expert selection 可探索而非固定 deterministic Top-K。
Limitations: RL training cost、router stability、對 serving locality 的影響未必最佳。
改變：router 從單步分類器提升成可由 reward 最佳化的 routing policy。

## 已確認 / 推論 / 假說分界

已確認官方/原始碼：DeepGEMM grouped GEMM 有 contiguous/masked layouts；Mega MoE 融合/重疊 dispatch、L1、SwiGLU、L2、combine；MegaMoE scheduler 具 BlockPhase/TaskInfo/readiness/warmup/ring dependency。

論文結果：MonoMoE、Megatron Core、RoleMerge、MoE-GRPO 的數字與結論限於各自實驗設定。

合理工程推論：Hermes 可以把 RouterTrace 與 KernelTrace 接成 RouterToTensorCoreTrace，並用 m_e→CTA count 建立可解釋 tail-latency 模型。

尚未驗證假說：phase-conditioned multimodal expert role 是否足以直接驅動 runtime expert placement；需要 workload trace + placement experiment。

## Unknown / Open Questions

1. DeepGEMM MegaMoE 的 L1/L2 interleave 在不同 router skew 下，ring pool live-block upper bound 與實際 occupancy 的差距多大？
2. MonoMoE weight-major 與 DeepGEMM MegaMoE 在小 batch decode 的 crossover point在哪裡？哪些 shapes 應由 runtime router 自動選 backend？
3. Image/question/answer phase-conditioned routing profile 是否能同時改善 expert placement locality，而不傷 answer-quality-critical expert availability？

## 下一輪研究

優先：MonoMoE 原始碼 × persistent weight-major scheduling × DeepGEMM MegaMoE SM100 kernel × TMA/TMEM/TCGEN05 × FP8/FP4 scaling × dynamic backend selection。

再往上接：Multimodal phase-aware router → expert placement → grouped/mega kernel execution；建立同一條可觀測 trace。

## Knowledge Graph 新增 Node

GroupedExpertGEMM
RaggedExpertM
ExpertMajorLayout
ContiguousGroupedLayout
MaskedGroupedLayout
WeightMajorMoEDecode
ExpertTileGrid
ValidM
ExpertPaddingWaste
MegaMoEKernel
MegaMoEScheduler
MoEBlockPhase
Linear1Task
Linear2Task
IntermediateRingPool
L1CompletionMask
L2ReadinessDependency
MoEWarmupWave
CommunicationComputeCoScheduling
PersistentExpertWeightStream
MultimodalRoutingPhase
RoutingRoleProfile
PhaseConditionedExpertRole
RouterToTensorCoreTrace

## Knowledge Graph 新增 Edge

RouterSkew → RaggedExpertM
RaggedExpertM → ExpertTileGrid
ExpertTileGrid → SMOccupancy
ExpertTileGrid → TailLatency
ExpertMajorLayout → GroupedExpertGEMM
Dispatch → MegaMoEScheduler
Linear1Task → IntermediateRingPool
L1CompletionMask → L2ReadinessDependency
L2ReadinessDependency → Linear2Task
MegaMoEScheduler → CommunicationComputeCoScheduling
ImageContextPhase → PhaseConditionedExpertRole
QuestionPhase → PhaseConditionedExpertRole
AnswerPhase → PhaseConditionedExpertRole
PhaseConditionedExpertRole → MultimodalExpertPlacementCandidate
RouterToTensorCoreTrace → VisualSimulation

## 本輪結束判斷

缺哪一層：MegaMoE/MonoMoE 真正 CTA/warp/TMA/Tensor Core execution trace，以及 quant scale dataflow。

哪個節點最淺：PersistentExpertWeightStream、IntermediateRingPool 的實際 occupancy、phase-aware placement。

哪個概念仍只是名詞：跨 DeepGEMM/FlashInfer/vLLM 的 DynamicMoEBackendSelector。

哪個系統最值得讀原始碼：FlashInfer MonoMoE + DeepGEMM sm100_fp8_fp4_mega_moe.cuh。

哪篇論文需追引用：MonoMoE 2609.04244，因為它直接挑戰 token-major grouped GEMM 作為 decode 基本執行模型。

哪個概念最適合視覺模擬：Router → expert M → tile grid → SM/Tensor Core → tail latency。

哪個 Agent 架構最值得實作：不是新增另一種高層 Agent loop，而是在 Hermes Model Runtime 加入 RouterToKernel observability：把 agent request / modality / phase / model route 一路接到 MoE expert、GPU kernel 與 latency，形成可驗證的全棧 trace。

## 「AI 到底怎麼運作」本輪新增鏈

Camera/Image/Voice/Video
→ Modality Encoder / Tokens
→ Multimodal Fusion
→ Transformer
→ MoE Router
→ Phase-conditioned Top-K Experts
→ Expert-major Layout
→ EP Dispatch
→ MegaMoE / Grouped GEMM Scheduler
→ CTA Tiles
→ Tensor Core Expert FFN
→ SwiGLU
→ Linear2
→ EP Combine
→ Token Order Restore
→ Next Layer
→ Logits / Sampling
→ Agent
→ Tool / MCP
→ Action

本輪核心答案：MoE 的「選 expert」不是模型層結束點。Router 的機率分布會被編譯成每個 expert 的動態 M 維，再變成 expert-major memory layout、CTA tile grid、Tensor Core 工作量與通信/計算依賴。對多模態模型而言，圖片、問題、回答 token 的 routing role 又不同。因此完整 AI 執行圖必須同時保存 Semantic Routing Graph、Memory Layout Graph、GPU Task Graph 三層，才能真正回答一個 token 為什麼被某個 expert 處理，以及這個語意選擇最後如何變成 GPU 上的實際運算。