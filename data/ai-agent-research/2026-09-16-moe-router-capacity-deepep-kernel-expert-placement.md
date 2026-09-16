# 【AI Agent × Multimodal Research Report】

**時間：2026-09-16 09:51（Asia/Taipei）**  
**本輪主題：MoE Router Internals × Capacity/Token Drop × DeepEP Hybrid Dispatch Kernel × Expert Placement × Tail Latency**

> 本輪接續上一輪 `MoE Router × Expert Parallelism × All-to-All × DeepEP`，避免重複「MoE 會把 token 送到遠端 expert」的概念介紹，改為追到三個更底層問題：① router 的語意選擇如何與 load balance 衝突；② overload 到底在何處變成 token drop/reroute/straggler；③ DeepEP V2 如何把 token routing 具體映射成 SM、warp、channel、QP、TMA、NVLink/RDMA 操作。

## 本小時新發現

### 新架構 / GitHub
- DeepEP V2 `hybrid_dispatch_impl`：單一 GPU kernel 內明確分出 Notify warps、Scale-out warps、Forward warps；**一個 warp 就是一個 communication channel**，channel 再映射到 NCCL Gin QP。來源：https://github.com/deepseek-ai/DeepEP/blob/main/deep_ep/include/deep_ep/impls/hybrid_dispatch.cuh
- DeepEP V2 已由 NVSHMEM 轉向 NCCL Gin，支援 scale-up + scale-out hierarchical EP，README 宣稱可到 EP2048，並以 analytical SM/QP sizing 取代 auto-tuning。來源：https://github.com/deepseek-ai/DeepEP

### 新論文 / 新方向
- Capacity-Aware Inference（ICLR 2026）：把 MoE straggler 直接改寫成 expert capacity control，使用 Capacity-Aware Token Drop / Expanded Drop 限制 overloaded expert 對 layer latency 的支配。來源：https://proceedings.iclr.cc/paper_files/paper/2026/hash/94e845868a9ace4bc239d0c529d32f4c-Abstract-Conference.html
- Scaling Multi-Node MoE Inference Using Expert Activation Patterns（2026）：超過 100k expert activation traces 顯示 expert popularity 具有 domain dependence，且 prefill/decode activation 有相關性，可用於 micro-batch grouping 與 expert placement。來源：https://arxiv.org/abs/2604.23150
- When Are Experts Misrouted?（2026）：counterfactual equal-compute routes 顯示，標準 top-k router 在 fragile reasoning tokens 上可能沒有選到 frozen model 中更好的 route，指出「load-balanced」與「route-quality-optimal」不是同一目標。來源：https://arxiv.org/abs/2605.07260
- Alloc-MoE（ACL 2026）：把 expert activation 數量視為 budget，分 layer sensitivity 與 token routing score 兩層分配。來源：https://aclanthology.org/2026.acl-long.437/
- Auxiliary-Loss-Free Load Balancing / DeepSeek-V3：routing bias 只改 top-k selection boundary，最終 gate weight 仍由原始 affinity score 決定，將 load-balancing feedback 與 LM gradient 部分解耦。來源：https://arxiv.org/abs/2408.15664

# 本小時最重要 5 個發現

## 1. Router optimization 至少有三個互相拉扯的目標

**已確認 / 論文 + 官方技術報告：**

傳統理解：

```text
Hidden h_t
→ Router projection / expert affinity
→ scores s_i,t
→ Top-K
→ experts
```

真正 deployment objective 至少是：

```text
Semantic Route Utility
↕
Expert Load Balance
↕
Physical Locality / Communication Cost
```

DeepSeek 的 loss-free balancing 使用 expert bias `b_i` 改變 Top-K selection，但 gate value 仍使用原始 affinity；因此「選誰」與「選中後給多少權重」可以分離。Counterfactual routing 研究又指出，aggregate balance 好並不代表 fragile reasoning token 的 expert route 已是 utility-optimal。

**為什麼重要：** Hermes Knowledge Graph 不應把 `MoERouter` 建成單一 argmax 節點，而要拆成 `AffinityEstimator → BalanceController → RouteSelector → GateWeight → PlacementResolver`。

**限制：** Counterfactual route utility 使用特定模型/trajectory 評估，不能直接推論所有 MoE router 都普遍 misroute。

## 2. Capacity 是 model semantics 與 system tail latency 的交界

**論文結果：** Capacity-Aware Inference 把每個 expert 可接收 token 數設為 runtime constraint。overload 不再只是 metric，而會觸發 drop / expanded candidate / reroute。

```text
Top-K assignment
→ Count tokens / expert
→ Capacity C_e
├ count <= C_e → execute
└ count > C_e
   ├ drop low-priority overflow
   └ expand/reroute toward underloaded local expert
→ bounded max expert work
→ lower synchronization tail
```

ICLR 2026 論文摘要報告：OLMoE 某設定下約 30% speedup / 0.9% degradation；Mixtral-8x7B-Instruct Expanded Drop 約 1.85× inference speedup，且平均 task metric +0.2%。這些都是 paper-specific measurements，不可外推成固定收益。

**底層意義：**

```text
Router Skew
→ Expert Queue Length
→ GEMM M dimension
→ Rank Runtime
→ Barrier/Combine Wait
→ Layer Tail Latency
```

Capacity controller 是第一個能直接截斷這條因果鏈的節點。

## 3. DeepEP V2 已把「token dispatch」具體映射到 warp/channel/QP

**原始碼確認：** `hybrid_dispatch_impl` template 明確定義：

```text
kNumNotifyWarps
kNumScaleoutWarps
kNumForwardWarps
kNumChannelsPerSM = kNumScaleoutWarps
kNumChannels = kNumScaleoutWarps × kNumSMs
```

並直接註記：

```text
a warp is a channel
(different channels may share QPs)
```

kernel 內三種 warp role：

```text
Notify Warps
→ count destination ranks / experts
→ GPU reduction
→ exchange rank/expert counts
→ prefix sums

Scale-out Warps
→ each warp/channel walks tokens
→ TMA preload hidden state
→ read Top-K expert IDs/weights
→ deduplicate destination scale-out ranks
→ local bypass OR NCCL Gin RDMA put
→ update channel tail

Forward Warps
→ consume scale-out receive buffers
→ decode destination scale-up rank
→ allocate destination slots
→ TMA store into symmetric NVLink-visible buffer
→ preserve metadata for combine
```

這比上一輪的 `Token → NVLink/RDMA → Expert` 再深一層：**routing decision 最後真的會變成 lane-level Top-K load、warp-level destination dedup、channel tail、QP selection 與 TMA/NCCL Gin memory operations。**

## 4. Hierarchical EP 是兩段 routing，不是一個 All-to-All 黑盒

DeepEP V2 hybrid path 可以建模為：

```text
Global Expert ID
→ scale-out rank = expert / experts_per_scaleout
→ RDMA / rail domain
→ receiving forward warp
→ local expert-relative ID
→ scale-up rank = local_expert / experts_per_rank
→ NVLink / symmetric memory
→ local expert buffer slot
```

其中 local scale-out rank 可以 bypass RDMA；forward phase 再對 scale-up ranks deduplicate，並用 atomic counter 分配 destination slot。

**新知識邊：**

```text
ExpertID
  ├─MAPS_TO→ ScaleOutRank
  └─MAPS_TO→ ScaleUpRank

ScaleOutWarp
  ─OWNS→ CommunicationChannel
CommunicationChannel
  ─USES→ NCCLGinQP
ForwardWarp
  ─FORWARDS_TO→ SymmetricScaleUpBuffer
```

這表示 Expert Placement 不是 deployment 後才附加的 metadata；它會直接決定 router assignment 被翻譯成哪條 physical fabric path。

## 5. Expert activation pattern 可以反向控制 placement，而不只是被動觀察

2026 multi-node profiling 工作收集超過 100k expert activation traces，觀察到：
- load imbalance 隨 workload 改變；
- expert popularity 有 domain-specific shift；
- prefill 與 decode expert activation 有顯著可利用相關性。

因此 deployment 可以形成新的 feedback loop：

```text
Runtime Activation Trace
→ Popularity Matrix P(expert | workload/domain)
→ Micro-batch Grouping
→ Expert Placement / Replication
→ Token Locality ↑
→ Cross-node All-to-All ↓
→ New Runtime Trace
```

論文摘要報告其 placement/grouping 可讓 all-to-all communication data 最多降低約 20×；這是該實驗環境的上限結果，不是一般性保證。

# Architecture Breakdown — DeepEP V2 Hybrid Dispatch

```text
MoE hidden states x
+ topk_idx
+ topk_weights
        │
        ▼
┌───────────────────────────────┐
│ hybrid_dispatch_impl          │
│ one CUDA block per SM         │
├───────────────────────────────┤
│ Notify warps                  │
│  expert/rank counts           │
│  reductions                   │
│  prefix sums                  │
├───────────────────────────────┤
│ Scale-out warps               │
│  1 warp = 1 channel           │
│  TMA preload                  │
│  rank dedup                   │
│  NCCL Gin rail put / bypass   │
├───────────────────────────────┤
│ Forward warps                 │
│  consume RDMA recv slots      │
│  local rank resolution        │
│  NVLink symmetric TMA store   │
│  destination slot metadata    │
└───────────────────────────────┘
        │
        ▼
GPU barrier / arrival guarantee
        │
        ▼
Expert-major receive buffers
        │
        ▼
Grouped Expert GEMM
        │
        ▼
Combine / inverse routing
```

DeepEP V2 README 同時說明它已改用 NCCL Gin、支援 analytical SM/QP sizing，並把 high-throughput / low-latency API 統一到 ElasticBuffer；V3-like legacy training 的官方 benchmark 宣稱在維持相當或更高效能下，communication kernel SM 使用可由 24 降到 4–6。這是官方 benchmark，不應視為任意硬體/模型都能達到。

# Bottom-Level Logic — 一個 token 如何真的離開 GPU

```text
1 Hidden token in global memory
2 TMA load → shared memory staging buffer
3 lane 0..K-1 load topk expert IDs
4 expert ID → destination scale-out rank
5 warp deduplicates repeated destination ranks
6 channel allocates destination slot/tail
7 TMA store → local send buffer
8 if destination is remote:
      NCCL Gin put → RDMA rail
   else:
      local bypass
9 remote forward warp observes signaled tail
10 TMA load received token → shared memory
11 expert ID → destination scale-up/NVLink rank
12 deduplicate local ranks
13 atomicAdd allocates expert-buffer slot
14 symmetric pointer resolution
15 TMA store → destination GPU buffer
16 barrier ensures arrival
17 expert GEMM consumes expert-major tokens
```

**底層新節點：** `WarpChannel`, `ChannelTail`, `QPSharingMode`, `TMAStagingBuffer`, `RankDeduplication`, `DestinationSlotAllocator`, `ScaleOutBypass`, `SymmetricScaleUpBuffer`。

# Visual Simulation Idea — MoE Router-to-Fabric Microscope

Hermes Console 可新增一個真正從「語意 routing」一路看到「GPU fabric」的互動模擬：

```text
Token semantic space
↓
Router score matrix [tokens × experts]
↓
Top-K / Bias / Capacity controller
↓
Expert load histogram
↓
Expert → GPU placement map
↓
SM
├ Notify warps
├ Scale-out warp/channel
└ Forward warp/channel
↓
NVLink / RDMA animated fabric
↓
Expert GEMM timeline
↓
Combine barrier / tail latency
```

可調參數：`top_k`、router skew、loss-free bias、expert capacity、drop/reroute policy、expert placement、EP size、scale-up ranks、scale-out ranks、SM count、QP count、NVLink/RDMA bandwidth。

即時顯示：route utility proxy、tokens/expert、Gini、overflow tokens、dropped/rerouted tokens、locality ratio、RDMA bytes、NVLink bytes、channel utilization、QP sharing、expert GEMM M-size、straggler gap、layer tail latency。

最有教育價值的動畫是同一批 tokens 切換：

```text
A. semantic-only Top-K
B. loss-free balancing bias
C. capacity-aware drop/reroute
D. workload-aware placement
```

讓使用者看到「模型品質、負載平衡、通訊 locality、tail latency」不是同一個 optimization target。

# Code / GitHub

## DeepEP
Repository: https://github.com/deepseek-ai/DeepEP

本輪最值得繼續讀：
- `deep_ep/include/deep_ep/impls/hybrid_dispatch.cuh` — hybrid dispatch 主 kernel；warp roles、channel、TMA、Gin、scale-up/scale-out。
- `deep_ep/include/deep_ep/impls/dispatch.cuh` — direct dispatch path，用於和 hybrid hierarchy 比較。
- `deep_ep/include/deep_ep/common/comm.cuh` — QP mode、GPU barrier、communication primitive glue。
- `deep_ep/include/deep_ep/common/layout.cuh` — TokenLayout / BufferLayout / WorkspaceLayout，決定 token bytes 在 buffer 中的 physical organization。
- `deep_ep/csrc/nccl.cu` — NCCL communicator / topology / Gin integration。
- `tests/elastic/test_ep.py` — 從 API 到 dispatch/combine 的 end-to-end correctness/performance 路徑。

# Papers

## 1 Capacity-Aware Inference: Mitigating the Straggler Effect in Mixture of Experts
- Authors: Shwai He, Weilin Cai, Jiayi Huang, Ang Li
- Institution: University of Maryland / HKUST(GZ) affiliations in public metadata
- Year: ICLR 2026
- URL: https://proceedings.iclr.cc/paper_files/paper/2026/hash/94e845868a9ace4bc239d0c529d32f4c-Abstract-Conference.html
- Code: https://github.com/CASE-Lab-UMD/Capacity-Aware-MoE
- Architecture: capacity-aware token drop + expanded local candidate/drop
- Contribution: directly bounds overloaded expert work to reduce straggler tail
- Limitation: drop/reroute changes the executed computation graph and may affect quality; gains depend on model/workload/hardware.

## 2 Scaling Multi-Node Mixture-of-Experts Inference Using Expert Activation Patterns
- Authors: Abhimanyu Bambhaniya, Geonhwa Jeong, Jason Park, Jiecao Yu, Jaewon Lee, Pengchao Wang, Changkyu Kim, Chunqiang Tang, Tushar Krishna
- Year: 2026
- URL: https://arxiv.org/abs/2604.23150
- Dataset/trace: >100k expert activation traces across open MoE models/datasets
- Architecture: workload-aware micro-batch grouping + activation-aware expert placement
- Contribution: converts expert activation statistics into physical locality optimization
- Limitation: popularity shifts with workload; placement learned from one workload can become stale.

## 3 When Are Experts Misrouted? Counterfactual Routing Analysis in Mixture-of-Experts Language Models
- Authors: Youngsik Yoon, Siwei Wang, Wei Chen, Jungseul Ok
- Year: 2026
- URL: https://arxiv.org/abs/2605.07260
- Models: Qwen3-30B-A3B, GPT-OSS-20B, DeepSeek-V2-Lite, OLMoE-1B-7B
- Architecture: frozen-model counterfactual equal-compute route comparison
- Contribution: separates router confidence/aggregate balance from token-level route utility
- Limitation: counterfactual utility metric depends on verified trajectories and next-token probability.

## 4 Alloc-MoE: Budget-Aware Expert Activation Allocation for Efficient MoE Inference
- Authors: Baihui Liu, Kaiyuan Tian, Wei Wang, Zhaoning Zhang, Linbo Qiao, Dongsheng Li
- Institution: see ACL Anthology metadata
- Year: ACL 2026
- URL: https://aclanthology.org/2026.acl-long.437/
- Architecture: layer sensitivity profiling + DP budget allocation + token-level routing-score redistribution
- Contribution: treats number of expert activations as an explicit inference budget
- Limitation: budget-quality curve is model/task dependent.

## 5 Auxiliary-Loss-Free Load Balancing Strategy for Mixture-of-Experts
- Authors: Lean Wang, Huazuo Gao, Chenggang Zhao, Xu Sun, Damai Dai et al.
- Institution: DeepSeek / Peking University affiliations in paper metadata
- Year: 2024
- URL: https://arxiv.org/abs/2408.15664
- Architecture: expert-wise routing bias updated from observed load
- Contribution: balances expert selection without injecting the balancing term directly into LM optimization gradients
- Limitation: still introduces a control loop/hyperparameter for bias update; balance does not prove token-level route optimality.

# Unknown / Open Questions

1. **Router utility × system cost joint objective**：如何在不破壞語意 specialization 的情況下，把 route utility、expert capacity、placement locality、network congestion 同時放進 runtime decision？
2. **Capacity action semantics**：drop、reroute、replicate 三者何時對 hidden-state semantics 最安全？多模態 image/video tokens 是否真的能用更 aggressive capacity control，而不破壞關鍵 evidence？
3. **DeepEP kernel tail model**：`warp = channel`、channels share QPs 時，router skew 如何具體轉成 channel/QP queueing 與 tail latency？需要 Nsight/NVTX trace 才能從原始碼推進到可驗證 performance model。

# 下一輪研究

優先：**Grouped Expert GEMM × Token Permutation Layout × FP8 Expert Compute × GEMM/Dispatch Overlap × Router-to-Kernel Critical Path × Multimodal MoE Routing**。

下一輪要回答：token 已被 DeepEP 放進 expert-major buffer 後，Grouped GEMM 如何把不同 expert 的不等長 M 維度映射到 CUDA/CUTLASS/Triton kernels？communication SM 與 expert Tensor Core compute 是否真的 overlap？router skew 在 GEMM tile 層如何形成 bubbles？

# Knowledge Graph 新增 Node / Edge

## Nodes
- `RouterAffinityScore`
- `RoutingBalanceBias`
- `RouteUtility`
- `ExpertCapacity`
- `OverflowToken`
- `CapacityAwareDrop`
- `CapacityAwareReroute`
- `ActivationBudget`
- `ExpertActivationTrace`
- `WorkloadExpertPopularity`
- `ActivationAwarePlacement`
- `WarpChannel`
- `ChannelTail`
- `QPSharingMode`
- `TMAStagingBuffer`
- `RankDeduplication`
- `DestinationSlotAllocator`
- `ScaleOutBypass`
- `SymmetricScaleUpBuffer`
- `HierarchicalExpertRoute`
- `RouterToFabricTrace`

## Edges
```text
RouterAffinityScore ─INFLUENCES→ RouteUtility
RoutingBalanceBias ─MODIFIES_SELECTION_OF→ TopKExpertSelection
ExpertCapacity ─BOUNDS→ ExpertTokenLoad
OverflowToken ─TRIGGERS→ CapacityAwareDrop
OverflowToken ─TRIGGERS→ CapacityAwareReroute
ExpertActivationTrace ─ESTIMATES→ WorkloadExpertPopularity
WorkloadExpertPopularity ─GUIDES→ ActivationAwarePlacement
ExpertPlacement ─DETERMINES→ HierarchicalExpertRoute
ScaleoutWarp ─OWNS→ WarpChannel
WarpChannel ─SHARES→ NCCLGinQP
TMAStagingBuffer ─FEEDS→ ScaleOutDispatch
ScaleOutDispatch ─MAY_BYPASS→ RDMA
ForwardWarp ─ALLOCATES→ DestinationSlotAllocator
DestinationSlotAllocator ─TARGETS→ SymmetricScaleUpBuffer
RouterSkew ─INCREASES→ ExpertTokenLoad
ExpertTokenLoad ─INCREASES→ GroupedGEMMWork
GroupedGEMMWork ─CONTRIBUTES_TO→ LayerTailLatency
```

# 本輪結束判斷

- **缺哪一層：** DeepEP dispatch 後的 expert-major token layout → Grouped GEMM kernel → combine 的逐 kernel trace。
- **哪個節點最淺：** `RouteUtility`、`QPSharingMode` 的 queueing model、`CapacityAwareReroute` 對語意品質的 token-level effect。
- **哪個概念仍只是名詞：** Hermes 統一的 `RouterToFabricTrace`；目前已有構件，但尚未有跨 router/runtime/kernel 的共同 trace schema。
- **哪個系統值得讀原始碼：** DeepEP V2，下一步讀 `layout.cuh`、`comm.cuh`、direct dispatch/combine 與 expert GEMM integration。
- **哪篇論文需追引用：** `When Are Experts Misrouted?`，因為它直接挑戰「trained Top-K route ≈ best route」這個常被默認的假設。
- **哪個概念最適合視覺模擬：** `MoE Router-to-Fabric Microscope`。
- **哪個 Agent/模型架構最值得實作：** 對 Hermes 的模型 serving 層，最值得先實作的是 **capacity-aware + locality-aware MoE execution planner**，但只能作為 server-side execution policy，不應讓 LLM 自己任意改 expert placement/capacity。

# 從使用者一句話到 GPU：本輪新增的底層段落

```text
User
→ UI
→ Agent
→ Context
→ Model Router
→ Transformer
→ MoE hidden state
→ Router affinity
→ Balance bias / Top-K
→ Capacity controller
→ Expert ID
→ Expert placement
→ Scale-out rank
→ Warp/channel
→ TMA staging
→ NCCL Gin / RDMA
→ Forward warp
→ Scale-up rank / NVLink
→ Expert-major buffer
→ Grouped Expert GEMM
→ Combine
→ Next Transformer layer
→ Logits
→ Sampling
→ Agent
→ Tool / MCP
→ Action
```

**核心結論：MoE Router 的一個 Top-K 選擇，不只是一個神經網路 decision。它會一路變成 expert queue length、GPU rank、warp/channel、QP、TMA memory movement、NVLink/RDMA traffic 與 GEMM shape。真正完整的 MoE 底層模型，必須同時追 semantic route utility、capacity、physical placement 與 communication kernel。**