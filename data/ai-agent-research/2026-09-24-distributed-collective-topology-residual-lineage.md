# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 15:50（Asia/Taipei）

## 本小時新發現

本輪承接上一輪 `MoELayerResidualWitness → ExpertParallelCollectiveGeneration`，不再重複 MoE router / expert selection，而是往下一層追：**logical route 與 expert compute 都正確之後，跨 GPU collective 是否仍可能改變 model semantic state？**

本輪 system architecture：**Distributed Transformer Execution Plane**。

本輪 bottom-level mechanism：**All-to-All / All-Gather / Reduce-Scatter / All-Reduce 的 communicator、rank membership、operation ordinal、token permutation、floating-point reduction order、fault/shrink generation。**

研究鏈：

`MoE Expert Output → Token Combine → All-to-All/Reduce-Scatter → Rank-local Partial Tensor → TP All-Reduce/Reduce-Scatter → Collective Result → Residual Add → Next Layer`

與歷史研究相比，本輪新增的是「communication execution lineage」，不是 weights、router 或 expert identity。

---

## 本小時最重要 5 個發現

### 1. Correct local tensors ≠ correct distributed tensor

**已確認事實 / 官方資訊**：NCCL collective 是 communicator-scoped operation；AllReduce 將 communicator 內所有 ranks 的 inputs reduction 後複製到各 rank。Megatron-Core 的 TP mapping 也直接把 `_reduce`、reduce-scatter、all-gather、all-to-all 視為 Transformer tensor semantics 的一部分。

底層鏈：

`LocalPartialTensor → ProcessGroup/Communicator → Rank Membership → Collective Type → Count/DType → Reduction/Exchange → Rank-local Result`

所以：

`CorrectLocalPartialTensor --does_not_prove→ CorrectDistributedResidual`

Hermes 新增：

`CollectiveCommunicatorGeneration = H(backend, communicatorId/hash, orderedRanks, rankToDevice, worldSize, topologyGeneration, configGeneration)`

`CollectiveOperationWitness = H(communicatorGeneration, operationOrdinal, collectiveType, inputTensorGenerations, count/dtype, streamGeneration, outputTensorGeneration)`

來源：
- NVIDIA NCCL Collective Communication Methods: https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/nccl4py/communicator/collectives.html
- Megatron-Core TP mappings: https://docs.nvidia.com/megatron-core/developer-guide/latest/apidocs/core/core.tensor_parallel.mappings.html

限制：NCCL API-level success 只證明 collective API 的完成狀態；不等同 Hermes 所需的 semantic provenance。

### 2. vLLM 的 MoE communication backend 本身就是可變 runtime semantics

**工程實作 / 原始碼確認**：current vLLM `vllm/distributed/device_communicators/all2all.py` 不只有一條 All-to-All。至少存在 AG/RS-based manager、DeepEP high-throughput、DeepEP low-latency、NIXL EP、FlashInfer NVLink two-sided / one-sided 等路徑。

AG/RS manager 的 dispatch 會 gather `hidden_states + topk_weights + topk_ids`，combine 則使用 reduce-scatter；DeepEP LL 會建立 RDMA/NVLink buffer；NIXL EP 更支援 rank connect/disconnect、active rank mask 與 staged/committed EP size。

因此：

`SameMoERoute + SameExperts --does_not_prove→ SameCommunicationExecution`

新增：

`CollectiveBackendGeneration`
`DispatchLayoutGeneration`
`CombineLayoutGeneration`
`EPActiveRankSetGeneration`
`ElasticEPCommitGeneration`

值得看的 current vLLM 核心檔案：
- `vllm/distributed/device_communicators/all2all.py`
- `vllm/model_executor/layers/fused_moe/all2all_utils.py`
- `vllm/config/parallel.py`
- `docs/design/fused_moe_modular_kernel.md`
- `docs/serving/expert_parallel_deployment.md`

### 3. Communicator membership 是 generation，不是常數

**已確認事實 / 官方資訊**：NCCL 2.32 提供 `ncclCommSplit`、`ncclCommShrink`、`ncclCommRevoke`；shrink 可以排除 ranks 並重新產生 contiguous rank IDs。當 communicator 發生 error 時，NCCL 官方明確指出，對該 communicator 上已 enqueue operations 的 completion/correctness 不能做任何假設。

因此：

`SameLogicalTP/EPGroup --does_not_prove→ SamePhysicalCommunicatorGeneration`

尤其 elastic EP / failure recovery：

`EP ranks {0,1,2,3} → rank 2 failure → shrink → new communicator {0,1,2}`

新的 rank 2 已不必然等於舊 rank 2 的 physical identity。

新增：

`RankIdentity = H(host, processGeneration, cudaDeviceGeneration, communicatorGeneration, communicatorRank)`

`CommunicatorMembershipWitness`
`CommunicatorShrinkGeneration`
`CommunicatorRevokeGeneration`

來源：
https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/api/comms.html

### 4. Collective ordering 必須成為 provenance；operation count mismatch 是可觀測故障

**已確認事實 / 官方資訊**：NCCL RAS 能觀測 communicator ranks 的 collective operation counts，並會報告 ranks 之間 operation count mismatch。NCCL CUDA Graph 文件也指出 captured collective 的 graph launch仍然是 collective property，所有 capture 時參與的 ranks都必須使用由該 collective capture導出的 graph。

因此 Hermes 不應只記：

`AllReduce happened`

而要記：

`CommunicatorGeneration + CollectiveOrdinal + LayerGeneration + TensorGeneration + Stream/CUDAGraphGeneration`

新增：

`CollectiveSequenceGeneration`
`CollectiveOrdinalBindingWitness`
`CollectiveCountAgreementWitness`
`DistributedCUDAGraphCollectiveGeneration`

來源：
- NCCL RAS: https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/ras.html
- NCCL CUDA Graphs: https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/usage/cudagraph.html

### 5. Semantic equality 與 bitwise determinism 必須分開

**論文結果 + 工程證據**：floating-point addition 非 associative，因此不同 reduction tree/order 可能造成不同 rounding。2025 `Deterministic Inference across Tensor Parallel Sizes That Eliminates Training-Inference Mismatch` 直接把 TP size造成的 reduction-order mismatch列為 deterministic inference 問題，並提出 Tree-Based Invariant Kernels 對齊 intra/inter-GPU reduction order。

2026-09-22 `Accelerating the Mitigation of LLM Inference Nondeterminism Across GPU Architectures` 又指出，不同 GPU architecture 的 kernel selection與 reduction order可讓 greedy inference產生不同 token；其方法固定 operation/reduction order來追求跨 architecture bitwise一致。

因此 Hermes 必須分成：

`DistributedSemanticExecutionWitness`

與

`DistributedBitwiseReplayWitness`

前者證明「正確 ranks / tensors / collective / layer causal chain」；後者才要求 reduction order / kernel / architecture等足以重播 bitwise結果。

來源：
- Zhang et al., 2025, *Deterministic Inference across Tensor Parallel Sizes That Eliminates Training-Inference Mismatch*: https://arxiv.org/abs/2511.17826
- Cooper et al., 2026, *Accelerating the Mitigation of LLM Inference Nondeterminism Across GPU Architectures*: https://arxiv.org/abs/2609.25624

---

## Architecture Breakdown

### Distributed Transformer Execution Plane

```text
Token / Residual Generation
        ↓
Layer Input
        ↓
TP/EP Partition Policy
        ↓
Rank-local tensors
        ↓
┌──────────────────────────────┐
│ MoE dispatch                 │
│ hidden/topk ids/topk weights │
└──────────────────────────────┘
        ↓
Collective Backend
  ├─ AG/RS
  ├─ NCCL A2A
  ├─ DeepEP HT/LL
  ├─ NIXL EP
  └─ FlashInfer NVLink
        ↓
Communicator Generation
        ↓
Ordered Rank Membership
        ↓
Dispatch permutation/layout
        ↓
Physical Expert Compute
        ↓
Combine collective
        ↓
Token unpermutation
        ↓
TP AllReduce / ReduceScatter
        ↓
Distributed Residual Generation
        ↓
Next Transformer Layer
```

### 必須區分的 identity planes

1. **Logical topology**：TP=8、EP=8、DP=4。
2. **Physical topology**：node/GPU/NVLink/NIC mapping。
3. **Communicator topology**：某 generation 的 ordered rank set。
4. **Collective sequence**：這個 communicator 上第 N 個 collective。
5. **Tensor semantics**：collective inputs屬於哪一層、哪一 token/request generation。
6. **Numerical execution**：algorithm/protocol/reduction ordering/kernel/hardware。

只知道 `TP=8` 完全不足以還原一次 distributed inference。

---

## Bottom-Level Logic

### Tensor Parallel row-parallel linear

簡化：

```text
X
→ shard X / W across TP ranks
→ rank0 partial Y0
→ rank1 partial Y1
→ ...
→ AllReduce SUM(Y0...Yn)
→ Y
→ residual add
```

Hermes 要驗證：

```text
LayerGeneration
→ TPGroupGeneration
→ RankLocalInputGeneration[i]
→ PhysicalWeightShardGeneration[i]
→ PartialOutputGeneration[i]
→ CollectiveOperationWitness
→ ReducedTensorGeneration
→ ResidualGeneration
```

### MoE expert parallel

```text
Token
→ logical expert route
→ token permutation
→ dispatch collective
→ physical rank/expert
→ expert output
→ combine collective
→ unpermutation
→ weighted combine
→ residual
```

因此 `ExpertDispatchWitness` 應進一步拆成：

`RouteWitness → PermutationWitness → DispatchCollectiveWitness → PhysicalExpertBinding → ExpertOutput → CombineCollectiveWitness → UnpermutationWitness`

### Failure semantics

```text
Collective enqueue
→ async execution
→ communicator error
```

不能推論：

`enqueue success → output valid`

NCCL 官方指出 communicator error 後，已 enqueue operation 的 completion/correctness不可假設。

Hermes應把 distributed output標為：

`VALID | FAILED | OUTCOME_AMBIGUOUS | RECOMPUTED_ON_NEW_COMMUNICATOR`

而 communicator shrink後必須產生新 generation，禁止把舊 collective ordinal直接續接到新 communicator identity。

---

## Visual Simulation Idea

### Distributed Transformer Collective Microscope

互動介面：

```text
Layer 17
 ├─ Token 823
 ├─ TP Group
 │   ├─ Rank0 GPU0 → partial tensor
 │   ├─ Rank1 GPU1 → partial tensor
 │   ├─ Rank2 GPU2 → partial tensor
 │   └─ Rank3 GPU3 → partial tensor
 ├─ NCCL Communicator #G42
 ├─ Collective ordinal #1873
 ├─ AllReduce SUM
 ├─ Ring/Tree/NVLS execution
 └─ Reduced residual → Layer 18
```

MoE mode可切成：

`Token → logical expert → permutation → network path → GPU rank → expert → combine → original token slot`

故障注入：

- `RANK_MEMBERSHIP_CHANGED`
- `COLLECTIVE_ORDINAL_MISMATCH`
- `WRONG_TENSOR_ENTERED_ALLREDUCE`
- `EP_ACTIVE_MASK_CHANGED_MID_STEP`
- `DISPATCH_PERMUTATION_STALE`
- `COMBINE_UNPERMUTATION_WRONG`
- `COMMUNICATOR_ERROR_AFTER_ENQUEUE`
- `SHRINK_REUSES_LOGICAL_RANK_NUMBER`
- `CUDA_GRAPH_COLLECTIVE_GENERATION_MISMATCH`
- `REDUCTION_ORDER_CHANGED`
- `TP_SIZE_CHANGED`

視覺上應同時提供：

**Semantic mode**：哪個 token / layer / tensor去了哪裡。

**Numerical mode**：reduction tree/order如何造成 rounding divergence。

---

## Code / GitHub

### vLLM

Repository: https://github.com/vllm-project/vllm

本輪已讀 current source，而非只讀 README：

- `vllm/distributed/device_communicators/all2all.py`
  - `AgRsAll2AllManager`
  - `DeepEPHTAll2AllManager`
  - `DeepEPLLAll2AllManager`
  - `NixlEPAll2AllManager`
  - FlashInfer NVLink managers
- `vllm/model_executor/layers/fused_moe/all2all_utils.py`
- `vllm/config/parallel.py`
- `docs/design/fused_moe_modular_kernel.md`
- `docs/serving/expert_parallel_deployment.md`

特別重要：current NIXL EP manager已把 scale-up/down拆成 connected/active rank state，並有 `stage_ep_size()` / `commit_ep_size()`；這非常適合直接映射為 Hermes 的 `ElasticEPCommitGeneration`。

### Megatron-Core

Repository: https://github.com/NVIDIA/Megatron-LM

值得下一輪深入：

- `megatron/core/parallel_state.py`
- `megatron/core/tensor_parallel/mappings.py`
- `megatron/core/transformer/moe/token_dispatcher.py`
- communicator overlap / fused communication paths

官方 docs已確認 TP有 reduce/all-gather/reduce-scatter/all-to-all primitives，MoE dispatcher也明確有 dispatch/combine communication與 unpermutation階段。

### NCCL

Repository: https://github.com/NVIDIA/nccl

下一輪值得讀：

- communicator lifecycle
- collective enqueue / opCount
- algorithm/protocol selection
- RAS communicator hash / collective counts
- shrink/revoke/error handling

---

## Papers

### 1. Deterministic Inference across Tensor Parallel Sizes That Eliminates Training-Inference Mismatch

- **Authors**: Ziyang Zhang, Xinheng Ding, Jiayi Yuan, Rixin Liu, Huizi Mao, Jiarong Xing, Zirui Liu
- **Year**: 2025
- **URL**: https://arxiv.org/abs/2511.17826
- **Code**: https://github.com/nanomaoli/llm_reproducibility
- **Dataset/Workloads**: LLM inference / RL training-inference pipelines
- **Architecture**: Tree-Based Invariant Kernels (TBIK), aligned hierarchical binary reduction
- **Contribution**: 將 TP-size-dependent reduction order明確定位為 inference reproducibility問題，提出跨 TP size bitwise一致 primitives。
- **Limitations**: deterministic primitives可能與 production serving使用的最快 kernel / collective路徑有 trade-off；Hermes仍需另外處理 request/rank/tensor provenance。
- **改變了什麼**: 證明「相同 model+prompt+greedy」仍不能推出跨 TP config相同結果。

### 2. Accelerating the Mitigation of LLM Inference Nondeterminism Across GPU Architectures

- **Authors**: Liam Cooper, Shinnung Jeong, Hyeran Jeon, Jeffrey Young, Hyesoon Kim
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2609.25624
- **Code**: 尚需下一輪確認正式 artifact release
- **Dataset/Workloads**: LLM inference across NVIDIA Ampere/Ada/Hopper
- **Architecture**: fixed-configuration fused-upcast GEMM kernels；reduction order由 problem shape決定
- **Contribution**: 針對 cross-GPU-architecture reproducibility固定 reduction order並回報 bitwise一致 linear-layer output。
- **Limitations**: linear-layer bitwise reproducibility不等同完整 Agent/LLM pipeline reproducibility。
- **改變了什麼**: 把 hardware architecture / kernel selection正式拉進 model semantic reproducibility graph。

---

## Unknown / Open Questions 1-3

### 1. NCCL algorithm/protocol/topology 到底要記到多細，才能建立低 overhead 的 `DistributedBitwiseReplayWitness`？

只記 Ring/Tree不夠；channel topology、protocol、chunking與 kernel generation可能都影響 reduction ordering。

### 2. Elastic EP communicator shrink 後，如何安全地處理 in-flight request？

需要區分：

`old communicator output valid` / `ambiguous` / `discarded` / `recomputed on new communicator`。

### 3. 如何證明 token permutation/unpermutation 沒有在 communication overlap / microbatch overlap 中跨 generation？

這是下一個最值得做 fault-injection test 的點。

---

## 下一輪研究

下一輪鎖定：

`DistributedResidualGeneration → Multi-layer Residual Stream → RMSNorm → Final Hidden State → LM Head / Tied Embedding → Logits`

但會補完 distributed execution最薄的一層：

`NCCL algorithm/protocol/channel topology → opCount → CUDA stream/event ordering → overlap → completion → residual visibility`

核心問題：

**即使 communicator、rank membership與 collective ordinal都正確，GPU上的 asynchronous communication/computation overlap如何證明下一個 kernel讀到的是「collective已完成的這一代 tensor」，而不是 stream/event dependency錯誤造成的 stale / partially visible state？**

---

## Knowledge Graph 新增 Node / Edge

### Nodes

- `DistributedExecutionTopologyGeneration`
- `CollectiveBackendGeneration`
- `CollectiveCommunicatorGeneration`
- `CommunicatorMembershipWitness`
- `RankIdentity`
- `CollectiveSequenceGeneration`
- `CollectiveOperationGeneration`
- `CollectiveOperationWitness`
- `CollectiveOrdinalBindingWitness`
- `CollectiveCountAgreementWitness`
- `DispatchLayoutGeneration`
- `CombineLayoutGeneration`
- `TokenPermutationGeneration`
- `TokenUnpermutationGeneration`
- `EPActiveRankSetGeneration`
- `ElasticEPCommitGeneration`
- `CommunicatorShrinkGeneration`
- `CommunicatorRevokeGeneration`
- `DistributedCUDAGraphCollectiveGeneration`
- `DistributedResidualGeneration`
- `DistributedSemanticExecutionWitness`
- `DistributedBitwiseReplayWitness`

### Edges

- `MoELayerResidualWitness --requires→ CollectiveOperationWitness`
- `CollectiveOperationWitness --uses→ CollectiveCommunicatorGeneration`
- `CollectiveCommunicatorGeneration --contains→ RankIdentity`
- `CollectiveOperationGeneration --ordered_by→ CollectiveSequenceGeneration`
- `LogicalExpertRouteWitness --permutes_via→ TokenPermutationGeneration`
- `TokenPermutationGeneration --dispatches_via→ CollectiveOperationWitness`
- `PhysicalExpertBindingWitness --produces→ ExpertContributionWitness`
- `ExpertContributionWitness --combines_via→ CollectiveOperationWitness`
- `CollectiveOperationWitness --restores_via→ TokenUnpermutationGeneration`
- `CommunicatorShrinkGeneration --invalidates→ prior CollectiveCommunicatorGeneration`
- `ElasticEPCommitGeneration --creates→ EPActiveRankSetGeneration`
- `CollectiveCountAgreementWitness --supports→ DistributedSemanticExecutionWitness`
- `DistributedBitwiseReplayWitness --stronger_than→ DistributedSemanticExecutionWitness`
- `DistributedSemanticExecutionWitness --produces→ DistributedResidualGeneration`

---

## 本輪結束檢查

- **缺哪一層**：CUDA stream/event dependency與 collective completion → consumer kernel visibility。
- **哪個節點最淺**：`DistributedBitwiseReplayWitness`。
- **哪個概念仍只是名詞**：portable、跨 NCCL/DeepEP/NIXL/FlashInfer 的 `CollectiveOperationWitness`標準格式。
- **哪個系統值得讀原始碼**：NCCL communicator/collective enqueue + vLLM All2All managers + Megatron-Core token dispatcher。
- **哪篇論文需追引用**：*Deterministic Inference across Tensor Parallel Sizes That Eliminates Training-Inference Mismatch*，並追 2026 cross-architecture deterministic inference工作。
- **哪個概念最適合視覺模擬**：Distributed Transformer Collective Microscope。
- **哪個 Agent 架構最值得實作**：`Event-sourced Agent Runtime + ModelInvocationWitness + EffectiveModelWeightStateWitness + MoERoutingWitness + CollectiveOperationWitness + DistributedResidualWitness + Runtime Attestation`。

最終端到端鏈因此再補上一層：

`User → UI → Agent → Context → Prompt Compiler → Tokens → Physical Weights → Transformer/MoE → Distributed Collectives → Residual Stream → Logits → Sampling → Output → Observation → Tool/Effect → Context Re-entry`

多模態同樣可沿：

`Camera/Image/Voice/Video → Encoder → Media Tokens → Fusion → Distributed Transformer → Agent → Action`

本輪最大的概念修正是：**「模型」不是單一 GPU 上的一組 weights；在 distributed inference 中，communicator generation、rank membership、collective sequence、token permutation與 numerical reduction order都是 model execution state 的一部分。**