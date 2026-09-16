# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 08:52（Asia/Taipei）

主題：MoE Router × Expert Parallelism × All-to-All × DeepEP × NVLink/RDMA × Parallel Folding

## 本小時新發現

本輪接續上一輪「Tensor Parallel × NCCL × NVLink」，刻意不再重複 dense Transformer collective，而是追問：當 FFN 從 dense SwiGLU 變成 sparse Mixture-of-Experts（MoE）後，一個 token 如何被 Router 選中、跨 GPU 移動到 expert、完成 GEMM，再被送回原 token stream。

已確認的核心鏈：

```text
Hidden State
→ Router logits
→ Top-K expert selection
→ Routing probabilities
→ Token permutation / expert-major packing
→ Expert Parallel dispatch
→ All-to-All / AllGather-V
→ Remote GPU expert
→ Grouped GEMM / SwiGLU expert compute
→ Combine communication
→ inverse permutation
→ weighted merge
→ residual stream
```

這代表 MoE 的底層成本不能只寫成「只啟動少數 experts，所以比較省算力」；稀疏計算把部分 FLOPs 成本換成 routing、packing、load imbalance、跨 GPU communication 與 combine。

## 本小時最重要 5 個發現

### 1. Expert Parallelism 是 token movement，不只是 weight sharding

Dense Tensor Parallel 通常讓同一批 token 留在 TP group，對 weight shard 做 local GEMM，再用 AllReduce / ReduceScatter 合併 partial tensor。MoE Expert Parallel 則反過來：expert weights 分散在不同 rank，Router 決定 token 應該被送到哪個 rank。

```text
Dense TP:
Token stays → Weight shards compute → Partial outputs communicate

MoE EP:
Router chooses expert → Token communicates → Expert computes → Output communicates back
```

因此 EP 的關鍵 collective 通常是 All-to-All 類型，而不是單純 AllReduce。

限制：具體 collective 會依 framework、training/inference、CUDA graph、hardware 而變。Megatron Core inference 已提供 NCCL AllGather/ReduceScatter 與 Hopper NVLS variable-count AllGather-V/ReduceScatter-V 路徑，因此「MoE 一律使用 All-to-All」並不成立。

### 2. MoE Dispatcher 本身就是一個 runtime subsystem

Megatron Core 的 dispatcher 不是一個 `all_to_all()` 呼叫而已，而是：

```text
routing_map / probs
→ dispatch_preprocess
→ local permutation + metadata extraction
→ token_dispatch
→ inter-device communication
→ dispatch_postprocess
→ expert-major tensor
→ expert compute
→ combine_preprocess
→ token_combine
→ restore original token order
```

這說明 Hermes Knowledge Graph 應把 `MoETokenDispatcher` 當成獨立 execution node，而不是把它藏在 FFN 裡。

### 3. DeepEP V2 已把 scale-up NVLink 與 scale-out RDMA 當成不同 physical domains

DeepEP V2 repository 顯示其 runtime 已切到 NCCL Gin backend；NCCL communicator 會解析 NVLink domain (`ncclTeamLsa`) 與 RDMA ranks，再建立 scale-up / scale-out rank mapping。它還註冊 symmetric memory window，取得各 NVLink peer 的 mapped pointer。

因此更精確的 EP physical path 是：

```text
Token
→ local packing
→ scale-up NVLink domain
→ possible scale-out RDMA domain
→ destination expert rank
→ expert compute
→ reverse combine path
```

這比抽象的「GPU A → GPU B」多了一層 topology-aware routing。

### 4. Communication kernel 也會與 expert compute 爭 SM

DeepEP V2 的重要工程方向之一，是在維持 bandwidth 的同時降低 communication kernel 使用的 SM 數；官方 README 報告 V3-like legacy training 的通信 SM 使用可從 24 降到約 4–6，並提供 analytical SM/QP count calculation。

所以 MoE throughput 的真正資源競爭是：

```text
Expert GEMM wants SM / Tensor Core
        ↕
Dispatch/Combine kernel wants SM
        ↕
NVLink/RDMA wants communication progress
```

不能只最大化 network bandwidth；如果 communication kernel 吃掉太多 SM，expert GEMM 反而變慢。

### 5. Parallelism 應依 layer type 分開，而不是整個模型一套固定 TP/EP

MoE Parallel Folding（2025）提出五維 hybrid parallelism：TP、EP、CP、DP、PP，核心是讓 Attention 與 MoE layer 使用不同的 parallel mapping，而不是強迫全模型共用一組 mapping。論文在 H100、最高 1024 GPU、長序列設定中報告 Mixtral 8x22B 最高 49.3% MFU、Qwen2-57B-A14B 39.0% MFU；這是其特定 training setup 的結果。

這形成 Hermes 的新抽象：

```text
LayerExecutionPlan
├ AttentionParallelPlan
│  ├ TP
│  ├ CP
│  └ sequence partition
└ MoEParallelPlan
   ├ EP
   ├ expert placement
   ├ dispatcher backend
   └ communication topology
```

## Architecture Breakdown

### MoE Transformer Layer

```text
x
↓
RMSNorm
↓
Attention
↓
Residual
↓
RMSNorm
↓
Router Linear
↓
Router logits [tokens, experts]
↓
Top-K
↓
Expert IDs + Routing Weights
↓
Permutation / Packing
↓
EP Dispatcher
├ local expert tokens
└ remote expert tokens
      ↓
   NVLink / RDMA
      ↓
Grouped Expert GEMM
Gate + Up → SwiGLU → Down
↓
Combine
↓
Inverse permutation
↓
Weighted expert sum
↓
Residual
```

### DeepEP V2 runtime decomposition

值得持續追的 repository 路徑：

```text
deep_ep/
csrc/
├ elastic/
├ indexing/
├ jit/
├ kernels/
│  ├ backend/
│  │  ├ nccl.cu
│  │  ├ nvshmem.cu
│  │  ├ symmetric.hpp
│  │  └ api.cuh
│  └ elastic/
└ utils/
```

目前已確認 `csrc/kernels/backend/nccl.cu` 包含 communicator 建立、physical/logical NVLink/RDMA domain mapping、NCCL device communicator、GIN context requirements、symmetric-memory window registration 與 LSA peer pointers。

## Bottom-Level Logic

### Router

對 token hidden state `h`：

```text
z = W_router h
p = softmax(z)
E = TopK(p, k)
```

Router 產生的是 expert assignment 與 weight，不會自己執行 expert。Runtime 接下來必須把 token 依 expert/rank 重新排列。

### Dispatch

概念化：

```text
for token t:
  for expert e in topk(t):
    dst = placement[e]
    append(t, e, weight[t,e]) to send_buffer[dst]

exchange(send_buffer)
→ receive_buffer
→ group by local expert
```

### Expert compute

每個 expert 本質仍可是一個 SwiGLU FFN：

```text
u_e = W_up,e x
g_e = W_gate,e x
y_e = W_down,e (SiLU(g_e) ⊙ u_e)
```

但多 expert 可以透過 grouped GEMM 合併 kernel launch / 提升 GPU utilization。

### Combine

```text
expert outputs
→ inverse communication
→ inverse permutation
→ per-token Top-K outputs
→ routing-weighted sum
```

因此一個 MoE layer 至少存在兩次跨 rank movement：dispatch 與 combine。

## Visual Simulation Idea

### MoE Token Router × GPU Fabric Simulator

畫面分四層：

```text
TOKEN LAYER
T0 T1 T2 T3 ...

ROUTER LAYER
Top-K probability matrix

GPU / EXPERT LAYER
GPU0: E0 E1
GPU1: E2 E3
GPU2: E4 E5
GPU3: E6 E7

FABRIC LAYER
NVLink / NVSwitch / RDMA
```

互動參數：`num_experts`、`top_k`、EP size、expert placement、router skew、capacity、token batch、NVLink bandwidth、RDMA bandwidth、communication SM count、FP8/BF16 dispatch、dispatcher backend。

即時指標：tokens/expert、load imbalance、dispatch bytes、combine bytes、local-hit ratio、cross-node ratio、expert GEMM utilization、communication overlap、SM contention、tail expert latency。

最重要的動畫不是只畫 token 飛來飛去，而要讓使用者看到：

```text
Router skew ↑
→ hot expert queue ↑
→ one rank receives more tokens
→ grouped GEMM imbalance
→ straggler
→ combine waits
→ layer latency ↑
```

## Code / GitHub

### DeepEP

Repository: https://github.com/deepseek-ai/DeepEP

值得深讀：

- `README.md`：V2 architecture / EP2048 / analytical SM-QP sizing / NCCL Gin
- `csrc/kernels/backend/nccl.cu`：NCCL communicator、GIN、NVLink/RDMA domain、symmetric memory
- `csrc/kernels/backend/symmetric.hpp`：symmetric allocation / addressing
- `csrc/elastic/buffer.hpp`：ElasticBuffer dispatch API
- `csrc/kernels/elastic/combine.hpp`：combine kernel generation/launch
- `deep_ep/include/deep_ep/impls/*dispatch*` / `*combine*`：V2 dispatch/combine implementation

### Megatron Core

值得追：

- `core.transformer.moe.token_dispatcher`
- `core.transformer.moe.token_dispatcher_inference`
- tensor/expert process groups
- grouped GEMM
- communication overlap

## Papers

### MoE Parallel Folding: Heterogeneous Parallelism Mappings for Efficient Large-Scale MoE Model Training with Megatron Core

Authors: Dennis Liu et al.  
Institution: NVIDIA / collaborators  
Year: 2025  
URL: https://arxiv.org/abs/2504.14960  
Code: Megatron Core  
Architecture: TP + EP + CP + DP + PP with layer-type-specific mapping  
Contribution: Attention 與 MoE parallel mapping 解耦；flexible token dispatcher；支援大規模 heterogeneous parallelism。  
Limitations: 結果以 training/H100 為主；production inference 的 dynamic batching、expert hotness 與 tail latency 還需另外驗證。

### DeepSeekMoE: Towards Ultimate Expert Specialization in Mixture-of-Experts Language Models

Authors: Damai Dai et al.  
Institution: DeepSeek  
Year: 2024  
URL: https://arxiv.org/abs/2401.06066  
Architecture: fine-grained routed experts + shared experts  
Contribution: 將 expert 拆得更細並保留 shared experts，增加 expert specialization 與組合彈性。  
Limitations: 更多細粒度 expert 也提高 routing / placement / communication system complexity。

## 已確認 / 工程實作 / 推論邊界

**已確認官方/原始碼：** Megatron Core 支援 EP、MoE token dispatcher、多種 inference dispatcher；DeepEP V2 使用 NCCL Gin、NVLink/RDMA physical-domain mapping、symmetric memory，並以 dispatch/combine 為核心 EP primitive。

**論文結果：** Parallel Folding 的 MFU/scaling 數字、DeepSeekMoE 的模型品質/計算結果，只代表其論文實驗設定。

**合理工程推論：** Hermes 應把 router skew、expert placement、fabric topology 與 SM allocation 納入同一 `MoEExecutionTrace`；這是本研究提出的 architecture abstraction，不代表 DeepEP/Megatron 已有同名 API。

## Unknown / Open Questions

1. DeepEP V2 的 dispatch main kernel 如何在 warp/channel 粒度把 NVLink scale-up forwarding 與 RDMA scale-out forwarding overlap？
2. Decode batch 很小時，All-to-All、AllGather-V、NVLS 與 direct RDMA 的 crossover point 在不同 EP size / topology 下如何變化？
3. Router load imbalance 應由 model-side auxiliary loss、runtime token scheduling、expert replication，還是三者共同處理？

## 下一輪研究

下一輪優先：

```text
MoE Router Internals
→ Load Balancing Loss
→ Capacity / Token Dropping
→ Expert Placement
→ Grouped GEMM
→ DeepEP dispatch kernel warp/channel mapping
→ NVLink scale-up + RDMA scale-out
→ Communication/Compute Overlap
→ MoE inference tail latency
```

並與 SGLang DeepEP backend、Megatron Flex dispatcher 比較。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：

`MoERouter`, `RouterLogits`, `TopKExpertSelection`, `RoutingProbability`, `ExpertPlacement`, `ExpertParallelGroup`, `MoETokenDispatcher`, `TokenPermutation`, `ExpertMajorPacking`, `DispatchCollective`, `CombineCollective`, `AllToAll`, `AllGatherV`, `ReduceScatterV`, `GroupedExpertGEMM`, `ExpertLoadImbalance`, `HotExpert`, `ScaleUpDomain`, `ScaleOutDomain`, `NCCLGin`, `SymmetricMemoryWindow`, `CommunicationSMBudget`, `MoEParallelFolding`, `LayerSpecificParallelPlan`, `MoEExecutionTrace`.

新增 Edges：

```text
MoERouter --SELECTS--> Expert
TopKExpertSelection --PRODUCES--> RoutingProbability
ExpertPlacement --MAPS_TO--> GPU
MoETokenDispatcher --PERMUTES--> Token
DispatchCollective --MOVES--> Token
Token --EXECUTED_BY--> Expert
GroupedExpertGEMM --COMPUTES--> ExpertOutput
CombineCollective --RETURNS--> ExpertOutput
ExpertLoadImbalance --CREATES--> Straggler
Straggler --INCREASES--> LayerTailLatency
ScaleUpDomain --USES--> NVLink
ScaleOutDomain --USES--> RDMA
CommunicationSMBudget --COMPETES_WITH--> ExpertGEMM
MoEParallelFolding --DECOUPLES--> AttentionParallelPlan
MoEParallelFolding --DECOUPLES--> MoEParallelPlan
```

## 本輪結束判斷

缺的層：Router → physical dispatch kernel 中間的 warp/channel/network packet 級 trace。  
最淺節點：`CommunicationSMBudget`、`AllGatherV` inference crossover、`ExpertPlacement` dynamic policy。  
仍只是名詞：跨 framework 的統一 `MoEExecutionTrace`。  
最值得讀原始碼：DeepEP V2 `csrc/kernels/elastic/` 與 `deep_ep/include/deep_ep/impls/`。  
最需追引用論文：MoE Parallel Folding，因為它直接把 TP/EP/CP/DP/PP 與 dispatcher 統一到 system architecture。  
最適合視覺模擬：MoE Token Router × GPU Fabric Simulator。  
最值得實作架構：Router-aware Expert Parallel Runtime，將 routing、expert placement、dispatcher backend、fabric topology、SM budget 與 tail latency 放入同一 runtime policy loop。

## 「AI 到底怎麼運作」新增的一段

```text
User
→ UI
→ Agent
→ Context
→ Model Router
→ Transformer
→ Attention
→ MoE Router
→ Top-K Experts
→ Token Permutation
→ NVLink / RDMA Dispatch
→ Remote Expert SwiGLU GEMM
→ Combine
→ Original Token Order
→ Next Transformer Layer
→ Logits
→ Sampling
→ Agent
→ Tool / MCP
→ Action
```

本輪最重要的觀念：**Sparse MoE 並不是「少算幾個 FFN」這麼簡單；它把神經網路中的 expert selection 直接轉化成 distributed-system routing 問題。模型的 Router 決定語意上該去哪個 expert，而 Runtime 必須把這個決定實體化成 GPU placement、buffer permutation、NVLink/RDMA traffic、SM allocation、expert GEMM 與 combine。從這一層開始，模型架構與資料中心網路拓撲已經不可分開。**