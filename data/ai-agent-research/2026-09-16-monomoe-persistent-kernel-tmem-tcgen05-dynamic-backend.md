# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 11:53（Asia/Taipei）

主題：MonoMoE Persistent Kernel × Split-Phase TMA/WGMMA × DeepGEMM SM100 TMEM/TCGen05 × FP8/FP4 × Dynamic MoE Backend Selection

## 與歷史研究比較

上一輪已建立 Router → tokens/expert → ragged M → expert-major layout → grouped GEMM / MegaMoE 的鏈，並提出 DynamicMoEBackendSelector。本輪不再重複 grouped GEMM，而直接讀 FlashInfer MonoMoE 與 DeepGEMM SM100 MegaMoE 原始碼，把「persistent/mega kernel」拆成可驗證的 GPU state machine，並比較 Hopper WGMMA/TMA 與 Blackwell TCGen05/TMEM 的資料路徑。

## 本小時新發現

1. FlashInfer MonoMoE 現行主 kernel 對 BS<=8 明確採五階段 pipeline：routing+prefetch → quantize → up-projection → down-projection → writeback；不是論文摘要中的抽象 mega-kernel，而是實際 split-phase TMA+WGMMA persistent execution。
2. MonoMoE Phase 1 已把 routing 與 BF16 input TMA prefetch 分給不同 warps；Phase 2 再把 routing-table prepare 與 BF16→FP8 quantization 平行化，顯示 router/control work 與 data movement 已在同一 kernel 內 overlap。
3. MonoMoE Phase 3→4 不再依賴 grid-wide barrier，而以 data-path readiness sentinel：producer 在 FP8 payload 後 release-publish scale cell，down-projection consumer 只 polling 自己需要的 cell。這把同步粒度從「整個 expert/group ready」縮到「consumer 真正依賴的資料 ready」。
4. Phase 4→5 因 down_partial_out 使用 atomicAdd，資料本身不能當 sentinel，所以改成 parity-selected arrival counters；只有該 output stripe 的 writer polling 到 DOWN_GROUPS，避免所有 blocks mutual spin。
5. DeepGEMM SM100 MegaMoE 已把 Blackwell Tensor Memory（TMEM）當 accumulator / scale-factor staging 的一級資源；使用 2-CTA MMA、ClusterTransactionBarrier、TMA descriptor prefetch、可調 warp-group register allocation，並讓 dispatch、MMA non-epilogue、epilogue warps有不同 register budgets。
6. NVIDIA CUTLASS 官方文件確認 Blackwell TCGen05 MMA 將 accumulator 直接放在 TMEM；A 可來自 SMEM/TMEM、B 使用 SMEM descriptor，並支援 CTA-pair cooperation與 FP4/FP6/FP8 block-scaled MMA。這表示 Blackwell MoE kernel 的 bottleneck model 必須加入 TMEM capacity/traffic，而不能只看 HBM/SMEM/register。
7. DeepGEMM dispatch path 已可觀察到 Router metadata → expert token count → destination rank → symmetric memory → remote token pull → local ring buffer → expert pool block 的完整物理映射。

## 本小時最重要 5 個發現

### 1. MonoMoE 是「五階段 persistent state machine」，不是單一 GEMM

已確認原始碼：`csrc/fused_moe/monomoe/src/moe.cuh` 的 `moe_kernel_topk_impl` 對 BS<=8 要求 TMA+WGMMA，並直接標記五階段：

Routing + BF16 Prefetch
→ Prepare + Quantize
→ Up Projection
→ Down Projection
→ FP32→BF16 Writeback

Phase 1 中 prefetch warps 發 TMA bulk loads；calc warps同時跑 Top-K routing。Phase 2 warp 0 建 routing tables，其他 warps等待 TMA mbarrier後量化 BF16→FP8。

重要性：MoE decode 的 routing、量化、資料搬運與 Tensor Core GEMM 已經不是 runtime 的五個 operator，而是 kernel 內的 producer/consumer pipeline。

限制：現行此 path 明確限制 BS<=8、特定 WGMMA/TMA configuration；不能直接泛化到大 prefill batch。

來源：FlashInfer MonoMoE `moe.cuh`; MonoMoE arXiv 2609.04244。

### 2. Readiness protocol 比「大 barrier」更接近真正 dependency graph

MonoMoE Phase 3→4 使用 sentinel/data readiness：producer release-publish activation scale cell，consumer polling exact cells 後才讀/TMA-load payload。Phase 4→5 因 partial output 是 atomicAdd accumulator，改用 per-stripe arrival counter + parity double buffer。

因此同步模型應從：

Kernel A done → global barrier → Kernel B

改成：

Data tile produced → release marker → dependent consumer acquire → next tile compute

這與 Agent runtime 的 event-driven dependency graph 在抽象上相似，但此處是 GPU memory-ordering/correctness mechanism，不應混為同一層。

限制：sentinel/flag correctness 依賴 memory ordering、launch parity、producer/consumer集合與 co-residency invariant，錯誤會形成極難診斷的 stale-marker/deadlock。

### 3. Blackwell 把 Tensor Memory（TMEM）加入 MoE 的 memory hierarchy

NVIDIA CUTLASS 官方：SM100 `tcgen05.mma` 的 accumulator D 位於 TMEM；TMEM 是與 TMA 不同的新 on-chip data locale。TCGen05 支援 1/2 CTA group、FP4/FP6/FP8 block-scaled formats。

DeepGEMM `sm100_fp8_fp4_mega_moe.cuh` 直接使用 `cute::TMEM::Allocator2Sm`，計算 accumulator、SFA、SFB 所需 TMEM columns，並用 cluster sync 協調 2-CTA TMEM allocation。

底層路徑：

GMEM/Symmetric Buffer
→ TMA
→ SMEM A/B + scale factors
→ TCGen05 MMA
→ TMEM accumulator
→ epilogue
→ output / combine

重要性：上一輪的 `CTA → Tensor Core` 中間還缺一層 accumulator locality。Blackwell 可以讓 accumulator 不佔大量 general-purpose registers，改變 register pressure、warp specialization 與 pipeline設計。

限制：TMEM/TCGen05 是 Blackwell-specific；Hopper MonoMoE仍主要是 WGMMA + SMEM/register 路徑。

### 4. DeepGEMM 已把 Router metadata 編譯成物理 token transport

原始碼 dispatch warps先統計 `expert_token_count`，取得每 expert send offset，將 source token-topk index寫入 destination rank 的 symmetric workspace，再經 grid/NVLink barrier。pull階段依 expert/rank count做 round-robin rank selection，從 remote symmetric buffer取得 source token，TMA分 chunks 拉 hidden bytes到 local L1 ring buffer，同時搬 scale factor與 top-k weight。

可還原為：

TopK expert ID
→ expert token counter
→ destination rank
→ remote source-index table
→ rank-aware slot
→ symmetric-memory address
→ TMA remote pull
→ ring block
→ expert pool token
→ L1 GEMM task

重要性：這是「語意 routing → network address → physical buffer → Tensor Core task」的直接證據。

限制：此路徑高度依賴 DeepGEMM symmetric-memory / NVLink execution model；跨節點 RDMA與其他 dispatcher backend需另外建模。

### 5. Dynamic MoE Backend Selection 現在可以從抽象變成可量測 policy

目前至少有四種 execution regimes：

- large/ragged prefill：contiguous grouped GEMM
- graph-friendly irregular decode：masked grouped GEMM
- tiny-token decode：MonoMoE persistent weight-major
- SM100 communication-heavy expert parallel：DeepGEMM MegaMoE

因此 runtime selector 不應只看 model name，而應輸入：

phase, batch/tokens, tokens_per_expert histogram, router skew, top_k, quantization, expert_parallel_size, interconnect, GPU arch, SM count, HBM/SMEM/TMEM budget, kernel specialization availability。

合理工程推論：selector objective應同時最小化 `launch + padding + weight-stream + dispatch + synchronization + tail`，並受 correctness/capability constraints約束。

尚未驗證：跨 backend在線切換是否能穩定勝過 per-model offline tuning，需要實測。

## Architecture Breakdown

### System Architecture：MoE Decode Execution Planner

Multimodal/Text Token
→ Router logits
→ Top-K experts
→ Runtime statistics
  → tokens/expert histogram
  → phase=prefill/decode
  → GPU architecture
  → EP topology
  → precision
→ DynamicMoEBackendSelector
  ├ contiguous grouped GEMM
  ├ masked grouped GEMM
  ├ MonoMoE persistent kernel
  └ SM100 MegaMoE
→ backend-specific execution trace
→ Expert FFN
→ weighted combine
→ next Transformer layer

### Bottom-Level Logic A：MonoMoE Hopper persistent path

Router logits
→ calc warp TopK
∥ prefetch warp TMA BF16 input
→ routing table prepare
∥ BF16→FP8 quantization
→ expert-group up projection (WGMMA/TMA)
→ per-data sentinel publish
→ down projection starts as soon as its expert rows ready
→ FP32 partial atomicAdd
→ per-stripe arrival counter
→ BF16 writeback

### Bottom-Level Logic B：DeepGEMM Blackwell path

TopK metadata
→ dispatch warp token counts
→ symmetric-memory rank slots
→ remote token pull
→ L1 ring buffer
→ TaskInfo scheduler
→ TMA A/B/SF stages
→ 2-CTA TCGen05 MMA
→ TMEM accumulator
→ epilogue / SwiGLU / scale handling
→ L2 readiness
→ TCGen05 L2
→ combine

## Visual Simulation Idea

### Persistent MoE Pipeline × GPU Memory Microscope

同步顯示五個視圖：

1. Router：tokens→experts matrix。
2. Kernel timeline：Routing/Prefetch/Quantize/L1/L2/Writeback。
3. Warp roles：calc/prefetch/dispatch/non-epilogue/epilogue。
4. Memory hierarchy：HBM → symmetric buffer → TMA → SMEM → TMEM/register → Tensor Core。
5. Dependency graph：mbarrier、sentinel、arrival counter、ring-slot readiness。

互動切換 Hopper vs Blackwell、MonoMoE vs MegaMoE、BS 1/2/4/8、top-k、router skew、FP8/FP4、SM count、TMEM columns、ring size。

指標：TMA bytes、WGMMA/TCGen05 active cycles、SMEM/TMEM occupancy、register budget、sentinel wait、arrival-counter wait、padding FLOPs、expert tail、output-token latency。

最有教育價值的動畫：同一組 tokens 在 Hopper MonoMoE 顯示 accumulator/register/SMEM pipeline；切到 Blackwell MegaMoE 後顯示 2-CTA cooperation + TMEM accumulator，讓使用者看到硬體世代如何改變同一 MoE dataflow 的 physical execution。

## Code / GitHub

### FlashInfer MonoMoE
Repository: https://github.com/flashinfer-ai/flashinfer
值得看的目錄/檔案：
- `csrc/fused_moe/monomoe/src/moe.cuh` — 主五階段 persistent pipeline、sentinel/counter handoff。
- `moe_routing.cuh` — Top-K/routing。
- `moe_scale_inputs.cuh` — input quantization/scales。
- `moe_up_projection.cuh` — up projection WGMMA/TMA。
- `moe_down_projection.cuh` — down projection、consumer readiness。
- `moe_tma.cu`, `moe_tma.h` — TMA descriptors/data movement。
- `moe_internal.h` — shared/scratch state與 kernel configuration。

### DeepGEMM
Repository: https://github.com/deepseek-ai/DeepGEMM
值得看的檔案：
- `deep_gemm/include/deep_gemm/impls/sm100_fp8_fp4_mega_moe.cuh` — SM100 MegaMoE主 kernel。
- `deep_gemm/include/deep_gemm/scheduler/mega_moe.cuh` — TaskInfo / L1-L2 dependency。
- `deep_gemm/include/deep_gemm/layout/mega_moe.cuh` — buffer/ring layout。
- `deep_gemm/include/deep_gemm/layout/sym_buffer.cuh` — symmetric-memory addressing。
- `deep_gemm/include/deep_gemm/mma/sm100.cuh` — Blackwell MMA abstraction。
- `deep_gemm/include/deep_gemm/ptx/tcgen05.cuh` — TCGen05 instructions。
- `deep_gemm/include/deep_gemm/ptx/tma.cuh` — TMA primitives。

## Papers / Official References

### MonoMoE: An Efficient Fused Mega-kernel for Quantized MoE Decoding
Authors: Yu Gong, Kailash Budhathoki, Taeho Kim, Haipeng Li, Ashish Khetan
Year: 2026
URL: https://arxiv.org/abs/2609.04244
Code: https://github.com/flashinfer-ai/flashinfer/tree/main/csrc/fused_moe/monomoe
Architecture: weight-major persistent mega-kernel
Contribution: routing/top-k/quantization/up/down/activation/reduction融合，針對少 token/expert decode。
Reported result: H200指定 workload routed-MoE operator最高1.54× over vLLM Triton Grouped GEMM；output-token time最高下降18.7%。
Limitations: H200、量化模型、BS/specialized shapes與offline tuning；不能泛化為所有 MoE。
改變：decode執行單位從短 grouped-GEMM grids轉為 persistent weight stream。

### NVIDIA CUTLASS Blackwell SM100 GEMM / TCGen05 Documentation
Institution: NVIDIA
URL: https://docs.nvidia.com/cutlass/4.2.1/media/docs/cpp/blackwell_functionality.html
URL: https://docs.nvidia.com/cutlass/4.5.2/media/docs/pythonDSL/mma_docs/tcgen05_programming.html
Architecture: TCGen05 + TMEM + TMA + CTA-group MMA
Contribution: 官方定義 Blackwell Tensor Core data path與FP4/FP6/FP8 block-scaled MMA。
Limitations: 硬體/程式模型文件，不是 MoE end-to-end benchmark。
改變：把 TMEM加入 inference execution graph。

## 已確認 / 推論 / 假說分界

已確認官方/原始碼：MonoMoE五階段、TMA+WGMMA、sentinel/counter readiness；DeepGEMM SM100使用TMEM Allocator2Sm、2-CTA MMA、不同warp role/register budget、symmetric-memory dispatch；CUTLASS官方確認TCGen05/TMEM semantics。

論文結果：MonoMoE performance數字只屬其H200/模型/批次設定。

合理工程推論：Hermes可建立 DynamicMoEBackendSelector，並把 RouterTrace→MemoryTrace→KernelTrace統一成 MoEPhysicalExecutionTrace。

尚未驗證假說：online backend selector能否在變動 workload 下穩定優於offline固定kernel；TMEM pressure是否能成為跨模型統一的backend selection feature。

## Unknown / Open Questions

1. MonoMoE `moe_up_projection/down_projection` 中 WGMMA tile、warp role與weight-major persistent grid的完整 per-cycle mapping仍需再讀。
2. DeepGEMM SM100 TMEM accumulator→epilogue→TMA store 的精確 ownership/barrier protocol仍是最淺節點。
3. 如何以同一 cost model比較 Hopper WGMMA persistent kernel與Blackwell TCGen05/TMEM MegaMoE，且涵蓋EP network cost，尚未驗證。

## 下一輪研究

主題：`TCGen05/TMEM Epilogue × FP4 Scale-Factor Pipeline × MoE Kernel Cost Model × Backend Autotuning × Hopper vs Blackwell Execution Trace`。

優先讀：
- DeepGEMM `mma/sm100.cuh`, `ptx/tcgen05.cuh`, SM100 MegaMoE epilogue後半。
- FlashInfer MonoMoE `moe_up_projection.cuh`, `moe_down_projection.cuh`, `ptx_utils.h`。
- CUTLASS TCGen05/TMEM programming model。

目標：建立可計算的 `MoEKernelCost = dispatch + weight_bytes + activation_bytes + quant/dequant + MMA + synchronization + combine + tail`，讓 DynamicMoEBackendSelector 從概念變成可模擬 policy。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：`PersistentMoEKernel`, `MonoMoEFivePhasePipeline`, `RoutingPrefetchOverlap`, `QuantizePrepareOverlap`, `DataPathSentinel`, `ParityArrivalCounter`, `StripeReadiness`, `OneBlockPerSMInvariant`, `BlackwellTensorMemory`, `TCGen05MMA`, `CTAGroupMMA`, `TMEMAccumulator`, `TMEMColumnBudget`, `WarpRoleRegisterBudget`, `SymmetricRemoteTokenPull`, `ExpertPoolRingBlock`, `MoEPhysicalExecutionTrace`, `DynamicMoEBackendSelector`, `BackendCapabilityConstraint`。

新增 Edges：
- `RouterLogits → MonoMoEFivePhasePipeline`
- `TMAInputPrefetch ↔ RoutingCompute`（overlap）
- `UpProjectionPayload → DataPathSentinel → DownProjection`
- `DownPartialAtomicAdd → ParityArrivalCounter → Writeback`
- `SymmetricRemoteTokenPull → ExpertPoolRingBlock → L1Task`
- `TMA → SMEM → TCGen05MMA → TMEMAccumulator`
- `GPUArchitecture → BackendCapabilityConstraint → DynamicMoEBackendSelector`
- `TokensPerExpertHistogram → DynamicMoEBackendSelector`
- `DynamicMoEBackendSelector → PersistentMoEKernel | GroupedGEMM | MegaMoE`

## 每輪結束檢查

- 缺哪一層：TCGen05/TMEM accumulator到epilogue/output的逐指令資料流與cost model。
- 哪個節點最淺：`TMEMAccumulator` 的 occupancy/lifetime、MonoMoE WGMMA weight stream。
- 哪個概念仍只是名詞：`DynamicMoEBackendSelector`，尚缺跨backend實測cost model。
- 哪個系統最值得讀原始碼：DeepGEMM SM100 MegaMoE epilogue + FlashInfer MonoMoE up/down projection。
- 哪篇論文需追引用：MonoMoE arXiv:2609.04244，特別追後續vLLM/FlashInfer整合與跨GPU世代結果。
- 哪個概念最適合視覺模擬：Persistent MoE Pipeline × TMEM/SMEM/TMA memory microscope。
- 哪個 Agent 架構最值得實作：本輪不是新增上層Agent loop；對Hermes最值得實作的是 `Model Router → Inference Runtime → DynamicMoEBackendSelector → GPU Execution Trace`，讓Agent workload特徵能一路映射到底層GPU execution。

## AI 到底怎麼運作：本輪新增鏈

User
→ UI
→ Agent
→ Context / Planning
→ Model Router
→ Transformer
→ MoE Router
→ Top-K Experts
→ Runtime Backend Selection
→ Persistent / Mega MoE Kernel
→ Routing + TMA Prefetch
→ Quantization
→ Expert Weight Stream
→ WGMMA（Hopper）或 TCGen05（Blackwell）
→ Register/TMEM Accumulator
→ SwiGLU / Down Projection
→ Readiness Protocol
→ Combine / Writeback
→ Next Layer
→ Logits
→ Sampling
→ Agent
→ Tool / MCP
→ Action

本輪核心結論：MoE 的「Expert routing」到最底層不是一句選專家，而是一條可觀測、可建模的 physical execution chain：routing metadata決定expert/rank與token layout；kernel再把這些依賴轉成warp roles、TMA transfers、mbarrier/sentinel、WGMMA/TCGen05與TMEM/register accumulator。不同GPU世代會改寫同一模型架構的最佳執行圖，因此 inference runtime需要把 hardware architecture納入模型執行決策。