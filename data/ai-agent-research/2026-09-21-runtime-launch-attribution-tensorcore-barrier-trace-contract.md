# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 22:51 Asia/Taipei

## 本小時新發現

本輪承接上一輪 `tcgen05.commit → TensorCoreBarrier callback`，但不再重複 completion routing 本身；研究焦點推進到 **runtime evidence 如何精準 join 回某一次 request / kernel launch / CUDA Graph node / CTA-group execution**。

核心結論：Compute Sanitizer 已經提供足夠的 launch-level identity primitives，讓 Hermes 可以把 Blackwell Tensor Core barrier evidence 從「匿名 PC + barrier + mask」提升成 **Launch-Scoped Completion Witness**；但 callback signature 本身仍不直接攜帶 CTA rank / request id，因此 CTA/request attribution 仍是下一個 instrumentation gap。

新來源：
- NVIDIA Compute Sanitizer Patching API: https://docs.nvidia.com/compute-sanitizer/api/group___s_a_n_i_t_i_z_e_r___p_a_t_c_h_i_n_g___a_p_i.html
- NVIDIA Compute Sanitizer API Guide: https://docs.nvidia.com/compute-sanitizer/SanitizerApiGuide/index.html
- NVIDIA Sanitizer_LaunchData: https://docs.nvidia.com/compute-sanitizer/api/structSanitizer__LaunchData.html
- NVIDIA Sanitizer_GraphNodeLaunchData: https://docs.nvidia.com/compute-sanitizer/api/structSanitizer__GraphNodeLaunchData.html
- CUTLASS primitives / tcgen05: https://docs.nvidia.com/cutlass/latest/media/docs/pythonDSL/primitives.html
- CUTLASS clusterMxN_2cta_mma.py: https://github.com/NVIDIA/cutlass/blob/main/examples/python/CuTeDSL/experimental/primitives/tcgen05/clusterMxN_2cta_mma.py
- FlashAttention-4 paper: https://arxiv.org/abs/2603.05451
- Hardware-Aware FP4 FlashAttention-4: https://arxiv.org/abs/2609.04105

## 本小時最重要 5 個發現

### 1. Launch identity 可以成為 GPU runtime evidence 的第一個穩定 join key
**已確認／官方資訊。** `Sanitizer_LaunchData` 提供 `gridId`、`hLaunch`、`function`、`functionName`、`module`、`stream`、grid/block/cluster dimensions；其中 `gridId` 是 grid launch identity，而 `hLaunch` 可在 launch begin/end 範圍使用。

因此 Hermes 應新增：

```text
KernelLaunchIdentity = {
  context,
  device,
  stream,
  grid_id,
  function,
  module,
  grid_dim,
  block_dim,
  cluster_dim
}
```

這比只記 kernel name 強很多：同一 compiled kernel 可以被同一 request 或不同 request 多次 launch，甚至並行 launch。

限制：`gridId` 對 graph node launch 的 uniqueness 有 graph-exec scope，因此不能脫離 graph identity單獨當全域主鍵。

### 2. `sanitizerSetLaunchCallbackData` 是 request/layer metadata 注入 runtime patch 的正式入口
**已確認／官方資訊。** Patching API 提供 `sanitizerSetLaunchCallbackData(launch, kernel, stream, userdata)`，而一般 kernel 也可用 `sanitizerSetCallbackData(function, userdata)`。

這讓 Hermes 可以在 launch callback 時建立：

```text
LaunchAttributionEnvelope = {
  request_id,
  forward_epoch,
  layer_id,
  attention_backend,
  page_table_generation,
  tensor_map_generation,
  graph_exec_identity,
  graph_launch_id
}
```

再把 pointer 交給 device patch callback。

**工程推論：** 若 vLLM/FlashInfer launch boundary 能取得 request batch / layer execution context，這條路可把 TensorCoreBarrier event join 回高層 inference provenance，而不需要從 PC 反推 request。

### 3. TensorCoreBarrier callback 已經能觀察 `PC + DSMEM barrier + multicast state + mask`
**已確認／官方資訊。** `SanitizerCallbackTensorCoreBarrier` 專門對應 Blackwell tensor-core barrier，可由 `tcgen05.commit` 產生，callback fields包含 `pc`、DSMEM barrier address、`isMulticast`、`multicastMask`。

因此可以建立：

```text
ObservedTensorCoreBarrierEvent = {
  LaunchAttributionEnvelope,
  instruction_pc,
  barrier_dsmem_address,
  is_multicast,
  multicast_mask
}
```

這已足以驗證上一輪 Knowledge Graph 的：

```text
ExpectedCompletionRoutingMask
        vs
ObservedCompletionRoutingMask
```

但它仍**不能單獨證明**是哪一組 `tcgen05.mma` 被 commit；PC只標識 commit instruction site，不是 async MMA set identity。

### 4. CUDA Graph 會破壞「kernel function → userdata」的簡單 attribution 假設
**已確認／官方資訊。** Compute Sanitizer API 特別說明 device-launched CUDA Graph：device graph launch不一定產生host callback，而且不同 node 的 callback userdata可能出現歧義；API因此提供 `sanitizerSetDeviceGraphData`，並允許 patch callback透過 current graph exec取得 graph-specific data。

所以 Hermes 必須建立：

```text
GraphExecutionIdentity = {
  graph_exec,
  graph_launch_id,
  node,
  node_launch_identity
}
```

並新增否定 edge：

```text
KernelFunctionIdentity
--does_not_uniquely_identify→ RuntimeLaunchIdentity

KernelCallbackData
--does_not_always_uniquely_identify→ DeviceGraphNodeExecution
```

這對 production inference 很重要，因為 CUDA Graph capture/replay 正是高效 serving runtime 常見路徑。

### 5. CUTLASS 2-CTA source 再次證明 completion mask 必須依 cluster rank動態生成
**已確認／工程原始碼。** CUTLASS 2026 `clusterMxN_2cta_mma.py` 明確說明：CTA_2 的 `tcgen05_commit.multicast_mask` 是 cluster-rank mask；group leader rank `2G` 應使用 `3 << (2G)`。固定 `mask=3` 只會 signal ranks 0/1，後續 groups會在 `try_wait_parity` deadlock。

這給 runtime verifier 一個非常具體的 expected-model：

```text
expected_mask(group_idx G) = 0b11 << (2 * G)
```

因此 runtime TensorCoreBarrier callback 若觀察到：

```text
group_idx = 2
observed_mask = 0b00000011
```

Hermes 可以直接產生：

```text
TCGEN05_COMPLETION_MASK_ALIAS
```

而不是等 kernel hang 後才猜測原因。

---

## Architecture Breakdown

### Runtime Tensor-Core Completion Attribution Architecture

```text
Agent / User Request
  ↓
Inference Request ID
  ↓
ForwardEpoch
  ↓
Layer Execution
  ↓
Attention Backend / Kernel Variant
  ↓
CUDA Launch Begin
  ├─ gridId
  ├─ function / module
  ├─ stream
  ├─ clusterDim
  └─ hLaunch
  ↓
sanitizerSetLaunchCallbackData
  ↓
LaunchAttributionEnvelope
  ↓
Blackwell tcgen05.mma async operations
  ↓
tcgen05.commit
  ↓
SanitizerCallbackTensorCoreBarrier
  ├─ PC
  ├─ DSMEM barrier
  ├─ multicast flag
  └─ multicast mask
  ↓
ObservedTensorCoreBarrierEvent
  ↓
Expected-vs-Observed Completion Graph Diff
  ↓
Barrier replica / stage release
  ↓
Attention completion
```

### CUDA Graph variant

```text
GraphExec
  ↓
GraphLaunchId
  ↓
Kernel Node
  ↓
Node LaunchData
  ↓
DeviceGraphData / launch callback data
  ↓
Patch callback
```

不能把 graph replay 當成普通 repeated function launch。

---

## Bottom-Level Logic

本輪新增的核心 identity hierarchy：

```text
FunctionIdentity
  < KernelLaunchIdentity
  < GraphScopedKernelLaunchIdentity
  < RequestScopedKernelLaunchIdentity
  < RequestLayerStageCompletionWitness
```

一筆可用於 Hermes causal verifier 的 event 至少應包含：

```text
request_id
forward_epoch
layer_id
kernel_launch_identity
[graph_exec_identity, graph_launch_id, node]
cluster_shape
cta_group_mode
commit_pc
barrier_dsmem_address
observed_multicast_mask
expected_multicast_mask
barrier_stage_epoch
```

證據強度分級：

```text
L0 StaticSourceExpectation
L1 CompiledPCWitness
L2 LaunchScopedRuntimeWitness
L3 RequestScopedRuntimeWitness
L4 CTAGroupScopedRuntimeWitness
L5 MMASetScopedCompletionWitness
L6 CausalOutputWitness
```

目前官方 callback primitives 已讓 Hermes 從 L1/L2 開始有真實落地路徑；L4/L5仍缺 attribution instrumentation。

### 新 failure states

```text
LAUNCH_ATTRIBUTION_MISSING
GRAPH_EXEC_SCOPE_MISMATCH
GRAPH_NODE_ATTRIBUTION_AMBIGUOUS
COMMIT_PC_EXPECTATION_MISMATCH
TCGEN05_COMPLETION_MASK_ALIAS
EXPECTED_COMPLETION_MASK_MISMATCH
BARRIER_ADDRESS_GENERATION_MISMATCH
COMPLETION_EVENT_WITHOUT_REQUEST_JOIN
```

---

## Visual Simulation Idea

### Runtime Completion Trace Joiner

Hermes Console 顯示五條同步 timeline：

```text
Request Timeline
R42 ─ Forward#918 ─ Layer18

CUDA Launch Timeline
Grid#771 ─ Kernel FA4_BWD_2CTA ─ GraphExec#12/Node#7

CTA Group Topology
G0:[CTA0 CTA1]  G1:[CTA2 CTA3]  G2:[CTA4 CTA5]

Expected Completion
G0 000011
G1 001100
G2 110000

Observed Callback
PC 0x... / barrier 0x... / mask 000011
PC 0x... / barrier 0x... / mask 001100
PC 0x... / barrier 0x... / mask 000011  ← ERROR for G2
```

互動操作：切換 graph replay、改 cluster shape、故意固定 mask=3、交換 graph node userdata、reuse barrier generation。Console應即時顯示 expected/observed diff與因果路徑。

---

## Code / GitHub

### NVIDIA CUTLASS
值得持續閱讀：

- `examples/python/CuTeDSL/experimental/primitives/tcgen05/clusterMxN_2cta_mma.py`
  - cluster rank decomposition
  - `group_lane = rank & 1`
  - `group_idx = rank >> 1`
  - `tcgen05_commit.multicast_mask`
  - persistent accumulator reuse / peer-drain barrier contract
- `python/CuTeDSL/cutlass/cute/nvgpu/tcgen05/helpers.py`
  - `tcgen05_commit` wrapper
  - multicast mask lowering
- `python/CuTeDSL/cutlass/cute/pipeline.py`
  - mbarrier arrays / pipeline stage lifecycle

### NVIDIA Compute Sanitizer
下一個 prototype 應實作：

```text
Launch callback
→ obtain Sanitizer_LaunchData
→ construct LaunchAttributionEnvelope
→ sanitizerSetLaunchCallbackData
→ patch SANITIZER_INSTRUCTION_TENSOR_CORE_BARRIER
→ callback logs PC/barrier/mask + envelope
→ compare expected mask/topology
```

### FlashAttention
- https://github.com/Dao-AILab/flash-attention
- `flash_attn/cute/`：追 2-CTA / Blackwell variant、kernel launch boundary與可注入 request/layer metadata的位置。

---

## Papers

### FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling
- **Authors:** Ted Zadouri, Markus Hoehnerbach, Jay Shah, Timmy Liu, Vijay Thakkar, Tri Dao
- **Institutions:** Princeton / Meta / Colfax Research / NVIDIA / Georgia Tech / Together AI（依公開作者 affiliations）
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2603.05451
- **Code:** https://github.com/Dao-AILab/flash-attention
- **Dataset:** 非 dataset-centric；attention kernel benchmark shapes/workloads
- **Architecture:** Blackwell B200, fully asynchronous MMA, larger tiles, TMEM, 2-CTA MMA, software exp / conditional softmax rescaling
- **Contribution:** 針對 Blackwell asymmetric scaling重新共同設計 attention algorithm與GPU pipeline；報告 BF16 B200最高 1613 TFLOP/s、71% utilization，最高1.3× cuDNN 9.13、2.7× Triton。
- **Limitations:** hardware-specific；performance result不能直接泛化至所有Blackwell SKU、shape、dtype或serving runtime。
- **改變了什麼:** Attention optimization從單純IO tiling進入 asynchronous Tensor Core + TMEM + CTA cooperation 的 execution-graph co-design。

### Hardware-Aware FP4 FlashAttention-4
- **Author:** Robert Hu
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2609.04105
- **Code baseline:** https://github.com/hao-ai-lab/flash-attention-fp4
- **Architecture:** Blackwell FP4 attention；Direct-P / FP8 or low-bit probability-value paths
- **Contribution:** 顯示 matmul變快後，softmax conversion與on-chip dependency會成為主瓶頸；Direct-P報告最高2.13× BF16 forward throughput on GB200。
- **Limitations:** 某些 MXFP4 probability/value training trajectories發散；精度/訓練穩定性不能只看kernel throughput。
- **改變了什麼:** 強化本研究的核心判斷：下一代 attention瓶頸越來越是 synchronization / dataflow / conversion，而非單純 FLOPS。

---

## Unknown / Open Questions

1. **CTA rank runtime attribution**：`SanitizerCallbackTensorCoreBarrier` signature本身沒有直接列出 block/CTA rank；需要確認最乾淨的device-side attribution方式，避免只靠mask反推group。
2. **MMA-set lineage**：同一commit PC在loop中可執行多次；如何建立 `commit_epoch → exact preceding tcgen05.mma set` 的低擾動runtime witness？
3. **Graph replay identity**：production CUDA Graph replay下，request batch、graph node與patch userdata的最佳join contract仍需實測。

---

## 下一輪研究

```text
Compute Sanitizer launch callbacks
→ gridId / hLaunch / graphExec / graphLaunchId
→ sanitizerSetLaunchCallbackData
→ TensorCoreBarrier patch callback
→ runtime PC + barrier + mask
→ CTA rank / cluster rank attribution feasibility
→ commit epoch
→ exact tcgen05.mma lineage
→ stage release witness
→ request/layer join
→ Expected vs Observed completion graph
→ causal KV / Attention perturbation
→ ΔLogit
→ ΔToken
→ ΔAgentAction
```

優先建立最小 prototype contract，不再只增加抽象名詞。

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
KernelLaunchIdentity
GraphExecutionIdentity
GraphScopedKernelLaunchIdentity
LaunchAttributionEnvelope
GridLaunchIdentity
GraphNodeLaunchIdentity
CompiledCommitPCWitness
LaunchScopedTensorCoreBarrierWitness
RequestScopedTensorCoreBarrierWitness
CTAGroupScopedCompletionWitness
MMASetScopedCompletionWitness
RuntimeCompletionTraceJoiner
```

### Edges

```text
Request
--executes_in→ KernelLaunchIdentity

KernelLaunchIdentity
--carries→ LaunchAttributionEnvelope

GraphExecutionIdentity
--scopes→ GraphNodeLaunchIdentity

CompiledCommitPCWitness
--observed_as→ LaunchScopedTensorCoreBarrierWitness

LaunchScopedTensorCoreBarrierWitness
--joined_with→ LaunchAttributionEnvelope

RequestScopedTensorCoreBarrierWitness
--compared_against→ ExpectedCompletionRoutingMask

KernelFunctionIdentity
--does_not_uniquely_identify→ RuntimeLaunchIdentity

GridId
--requires_graph_scope_for→ GraphNodeLaunchUniqueness

ObservedTensorCoreBarrierEvent
--does_not_prove→ ExactTcgen05MMASetIdentity

CorrectMulticastMask
--does_not_prove→ CorrectRequestAttribution
```

---

## 本輪結束判斷

- **缺哪一層：** runtime callback event → CTA rank / exact MMA-set lineage → request/layer/stage causal join。
- **哪個節點最淺：** `MMASetScopedCompletionWitness`。
- **哪個概念仍只是名詞：** production `CTAGroupScopedCompletionWitness`，尚未在真實 serving kernel instrumentation中實測。
- **哪個系統值得讀原始碼：** NVIDIA CUTLASS `clusterMxN_2cta_mma.py` + Compute Sanitizer Patching API sample + FlashAttention-4 CuTeDSL launch path。
- **哪篇論文需追引用：** FlashAttention-4，特別是後續2-CTA / Blackwell pipeline與production integration工作；Hardware-Aware FP4 FA4用於觀察瓶頸是否從matmul持續移向同步/轉換。
- **哪個概念最適合視覺模擬：** Runtime Completion Trace Joiner。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Runtime Provenance Verifier + Launch/Graph Attribution Joiner + TensorCore Completion Verifier + CTA Topology Verifier + Causal Evidence Gate + Tool Executor`。

## 最終鏈條目前推進位置

```text
使用者一句話
→ UI
→ Agent Runtime
→ Context / Memory / Tools / MCP
→ Model Forward
→ Attention
→ KV Page Table
→ TensorMap
→ TMA
→ mbarrier
→ tcgen05.mma
→ tcgen05.commit
→ Runtime TensorCoreBarrier callback
→ Launch / Graph attribution   ← 本輪
→ CTA/MMA-set attribution      ← 下一缺口
→ Attention output
→ Residual
→ Logit
→ Sampling
→ Token
→ Agent next action
→ UI output
```

本輪的實質推進不是再增加一個GPU術語，而是把「可觀察的tcgen05 completion event」開始接回 **哪一次真正的 inference launch**。這是 Hermes 從 static kernel knowledge graph走向 request-scoped runtime evidence graph 的關鍵一步。