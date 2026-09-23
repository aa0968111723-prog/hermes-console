# 【AI Agent × Multimodal Research Report】

時間：2026-09-24 05:55（Asia/Taipei）

主題：CUDA Graph Replay × Allocation Lifetime × Static Address × Graph Update × GPUExecutionReplayWitness

## 與歷史研究比較

上一輪建立 GPUKernelInvocationWitness，將一次 launch 綁定 CUfunction、grid/block/shared memory、stream、kernel arguments 與 TensorSemanticIdentity。本輪不重複單次 launch，而是處理 replay boundary：CUDA Graph 將 kernel 與 pointer arguments 凍結成可重播 DAG；PyTorch 為維持這些位址，使用 graph-private allocator pools。新的問題不是「pointer 是否相同」，而是「相同 virtual address 在 replay 時是否仍代表被批准的 allocation generation / tensor role / graph generation」。

研究鏈：
GPUKernelInvocationWitness → Stream Capture → CUDA Graph DAG → Graph Instantiate → GraphExec → Private Memory Pool → Static Virtual Address → Replay → Graph Update → GPUExecutionReplayWitness

## 本小時新發現

1. PyTorch CUDA Graph capture 記錄 stream work，replay 使用相同 kernels 與相同 arguments；pointer arguments因此使用相同 memory addresses。官方要求 capture tensors保持 long-lived references，並將新輸入 copy 到 static input buffers後 replay。
2. PyTorch CUDACachingAllocator 原始碼明確指出 capture會 freeze CUDA work與 virtual addresses；為避免 replay時地址被其他 tensors重用，capture allocations來自 graph-private pool，且 graph存活期間不 cudaFree這些地址。
3. 這降低一般 allocator ABA/address-reuse風險，但沒有讓 pointer本身變成 semantic identity：同一 static buffer在每次 replay前可被 copy入不同 batch內容，address相同而 content generation不同。
4. CUDA GraphExec不是不可變 artifact。CUDA Runtime/Driver提供 graphExec node parameter updates與 whole-graph cudaGraphExecUpdate；kernel/memcpy等 node在限制內可更新，且修改影響未來 launches。因此 CaptureWitness 不能永久代表 GraphExec。
5. PyTorch CUDAGraph Trees會共享/恢復 private memory-pool state；官方說明 graph replay本身不更新 caching allocator state，遇到新 path時需 checkpoint allocator state。這表示 replay provenance需要同時追 GraphExecGeneration 與 GraphMemoryPoolGeneration。

## 本小時最重要 5 個發現

### 1. Static address ≠ static semantic object

已確認事實：PyTorch CUDA Graph replay會重用 capture時的 pointer addresses，通常先把新 batch copy到 static input tensor，再 replay。

底層：
real input generation → copy → static allocation address → captured kernel arg → graph replay

重要性：同一 pointer在不同 replay可以承載不同資料世代，因此 pointer equality只能證明 address topology，不證明 content identity。

限制：完整 content hashing對大型 tensors成本過高，需要 lineage/producer witness或抽樣/硬體證明策略。

### 2. Graph-private allocator pool是 replay安全性的核心

已確認事實：PyTorch CUDACachingAllocator current source的 CUDA graph interaction note說明，capture會 bake virtual addresses；allocator因此使用 graph-private memory pool，直到 graph destroyed前不開始 cudaFree這些地址。

底層：
CaptureBegin → PrivatePool → allocations/frees within pool → capture end → pool retained → repeated replay → graph destroy → pool releasable

重要性：這把一般 allocator的「free → same address reused by unrelated tensor」風險縮小到 graph lifecycle / pool topology問題。

限制：共享 private pool、graph trees、input mutation與 graph destruction/re-record仍需要 generation identity。

### 3. Captured graph ≠ immutable executable graph

已確認事實：CUDA提供 cudaGraphExecKernelNodeSetParams/cudaGraphExecNodeSetParams/cudaGraphExecUpdate 等API，允許在規則內修改 instantiated graph，修改影響 future launches。

因此：
GraphCaptureDigest --does_not_prove→ FutureGraphExecEquivalent

需要：
GraphExecGeneration++ on node parameter update / graph update / enable-disable / reinstantiate

### 4. Replay witness必須綁定「地址拓撲」與「內容世代」

Hermes architecture proposal：
AllocationGenerationIdentity = H(device, poolGeneration, allocationOrdinal, baseVA, size, lifetimeEpoch)

StaticTensorSlotIdentity = H(allocationGeneration, offset, shape, stride, dtype, semanticRole)

ReplayInputBindingWitness = H(replayGeneration, externalInputGeneration, copyNodeIdentity, destinationStaticTensorSlot, producerCompletion)

這避免把 `0x7f...` 直接當 tensor identity。

### 5. Graph replay需要新的 execution generation

Hermes architecture proposal：
GPUExecutionReplayWitness = H(
 graphExecGeneration,
 graphTopologyDigest,
 nodeParameterDigest,
 graphMemoryPoolGeneration,
 staticTensorSlotSetDigest,
 replayInputBindings,
 stream/launch identity,
 outputGeneration,
 replaySequence
)

只有 GraphExec generation、pool generation、static slot semantics與本次 input binding全部有效，才可把 replay結果接回 Agent effect/signing chain。

## Architecture Breakdown

User Request
→ Agent / Model
→ FX/Inductor Operator Graph
→ GPUKernelInvocationWitnesses
→ cudaStreamBeginCapture
→ Captured CUDA Graph DAG
→ cudaGraphInstantiate
→ GraphExecGeneration
→ Graph-private Memory Pool
→ Static Tensor Slots
→ New Input Copy Bindings
→ cudaGraphLaunch / replay
→ Output Tensor Generation
→ GPUExecutionReplayWitness
→ Model Output
→ Agent Decision / Tool Effect

Mutation paths：
GraphExecGeneration
← kernel-node parameter update
← memcpy/memset-node parameter update
← cudaGraphExecUpdate
← node enable/disable
← graph re-record / reinstantiate

Memory paths：
GraphMemoryPoolGeneration
← private pool create
← shared-pool topology
← allocator checkpoint/restore
← graph destroy
← CUDAGraph Tree path transition

## Bottom-Level Logic

### Capture/replay

stream work
→ capture mode
→ kernel/memcpy/event nodes + dependencies
→ cudaGraph_t
→ instantiate
→ cudaGraphExec_t
→ cudaGraphLaunch
→ same captured address topology executes again

### Allocation generation

raw address alone: VA=0xA

proposed identity:
(pool generation, allocation ordinal, lifetime epoch, VA, bytes, device)

VA equality without generation equality is not sufficient.

### Replay input semantics

ExternalTensorGeneration N
→ copy operation witness
→ StaticInputSlot S
→ producer completion edge
→ GraphExecGeneration G
→ replay R

R is approved only when S belongs to G's approved static-slot topology and the copy/producer binding belongs to R.

## Visual Simulation Idea

### CUDA Graph Replay & Memory Lifetime Microscope

Interactive lanes:
1. Eager launches
2. Stream capture
3. Graph nodes/edges
4. GraphExec generations
5. Graph-private pool
6. Virtual addresses
7. Allocation generations
8. Static tensor slots
9. Input copy/content generations
10. Replay/output generations

Fault injection:
- STATIC_ADDRESS_SAME_CONTENT_GENERATION_CHANGED
- GRAPH_EXEC_KERNEL_PARAMS_UPDATED
- GRAPH_EXEC_MEMCPY_DEST_UPDATED
- GRAPH_NODE_DISABLED
- PRIVATE_POOL_SHARED_WRONG_ORDER
- GRAPH_DESTROYED_POOL_REUSED
- CUDAGRAPH_TREE_WRONG_CHECKPOINT
- INPUT_MUTATION_NOT_PROPAGATED
- GRAPH_RECORDED_FOR_DIFFERENT_SHAPE
- REPLAY_WITH_STALE_STATIC_INPUT

UI state example:
Graph topology ✓ | GraphExec generation ✓ | private pool ✓ | static address ✓ | input binding ? | output lineage ?
→ REPLAY PROVENANCE INCOMPLETE

## Code / GitHub

PyTorch repository areas worth reading next:
- c10/cuda/CUDACachingAllocator.cpp — allocator reuse, recordStream, graph-private pool lifecycle and capture notifications.
- c10/cuda/impl/CUDAGraphMemory.* — graph memory/pool abstractions.
- aten/src/ATen/cuda/CUDAGraph.* — capture, instantiate, replay/reset boundary.
- torch/_inductor/cudagraph_trees.py — tree path recording, allocator checkpoint/restore, static inputs and re-record decisions.
- torch/_inductor/cudagraph_utils.py — graph-safe checks and mutation/liveness metadata.

Current CUDACachingAllocator source confirms allocations are stream-associated and cached blocks may be reused; recordStream prevents reuse before recorded streams complete. Its CUDA graph note explicitly describes graph-private pools to keep baked-in addresses safe through replay.

## Papers

### PyGraph: Robust Compiler Support for CUDA Graphs in PyTorch
Authors: Abhishek Ghosh, Ajay Nayak, Ashish Panwar, Arkaprava Basu
Institution: research affiliation to verify in next citation pass
Year: 2025
URL: https://arxiv.org/abs/2503.19779
Code: not verified this round
Dataset/benchmarks: multiple ML benchmarks; exact suite to extract next round if this paper becomes primary
Architecture: PyTorch2 compiler-integrated CUDA Graph deployment
Contribution: widens CUDA Graph applicability, reduces kernel-parameter copy overhead, and selects graph deployment via cost-benefit analysis.
Limitations relevant here: performance/compiler focus; does not provide cryptographic allocation-generation or replay provenance.
Changed what: shows CUDA Graph deployment itself is a compiler/runtime policy decision, not merely a transparent launch optimization.

### Hybrid JIT-CUDA Graph Optimization for Low-Latency Large Language Model Inference
Authors: Divakar Kumar Yadav, Tian Zhao
Institution: to verify
Year: 2026
URL: https://arxiv.org/abs/2604.23467
Code/Dataset: not verified this round
Architecture: partitions LLM inference into static CUDA-Graph replay regions and dynamic JIT regions.
Contribution: demonstrates why modern inference can mix frozen replay topology with runtime-generated kernels.
Limitations: reported evaluation is workload-specific; provenance/attestation is not its goal.
Changed what: reinforces that Hermes cannot model GPU execution as purely eager or purely static—both generations can coexist in one inference.

## Unknown / Open Questions

1. How should AllocationGenerationIdentity be implemented with sufficiently low overhead: allocator event sequence, CUDA VMM handle identity, or a runtime-maintained generation counter?
2. How can Hermes bind static-buffer content generation without hashing entire activation tensors on every replay?
3. How should GraphExec node updates, device-side graph updates and CUDAGraph Tree re-records feed CodeClosureGeneration versus a separate ExecutionGraphGeneration?

## Knowledge Graph 新增 Node / Edge

Nodes:
- CUDAGraphCaptureGeneration
- CUDAGraphTopologyIdentity
- CUDAGraphExecGeneration
- GraphNodeParameterGeneration
- GraphMemoryPoolGeneration
- AllocationLifetimeEpoch
- AllocationGenerationIdentity
- StaticTensorSlotIdentity
- ReplayInputBindingWitness
- CUDAGraphTreePathGeneration
- AllocatorCheckpointGeneration
- GPUExecutionReplayGeneration
- GPUExecutionReplayWitness

Edges:
- GPUKernelInvocationWitness --captured_into→ CUDAGraphCaptureGeneration
- CUDAGraphCaptureGeneration --instantiates→ CUDAGraphExecGeneration
- CUDAGraphExecGeneration --uses→ GraphMemoryPoolGeneration
- GraphMemoryPoolGeneration --owns→ AllocationGenerationIdentity
- AllocationGenerationIdentity --backs→ StaticTensorSlotIdentity
- ExternalInputGeneration --copied_into→ StaticTensorSlotIdentity
- ReplayInputBindingWitness --binds→ ExternalInputGeneration
- ReplayInputBindingWitness --binds→ StaticTensorSlotIdentity
- GraphNodeParameterGeneration --mutates→ CUDAGraphExecGeneration
- AllocatorCheckpointGeneration --selects_state_for→ CUDAGraphTreePathGeneration
- CUDAGraphExecGeneration --replayed_as→ GPUExecutionReplayGeneration
- GPUExecutionReplayGeneration --produces→ OutputTensorGeneration
- GPUExecutionReplayGeneration --attested_by→ GPUExecutionReplayWitness

## 事實 / 推論分層

已確認官方資訊：CUDA Graph captures/replays graph work; graph node parameters/GraphExec can be updated under documented restrictions; PyTorch replay uses fixed addresses; PyTorch allocator uses graph-private pools to preserve capture addresses.

已確認工程實作：current PyTorch CUDACachingAllocator source explicitly treats capture as freezing virtual addresses and retains private-pool addresses for graph lifetime; allocator also has stream-aware reuse semantics.

論文結果：PyGraph and 2026 hybrid JIT-CUDA-Graph work show graph deployment/replay is a meaningful compiler/runtime optimization surface.

合理工程推論：address equality must be augmented with allocation lifetime generation and semantic slot identity for attestation.

尚未驗證假說：allocator generation counters plus copy/producer lineage can replace expensive full tensor hashing while providing sufficient evidence for high-risk Agent effects.

## 本輪結束判定

缺哪一層：GPU output tensor generation → transformer semantic state（attention/KV cache/residual stream）→ model token/logit generation的資料血緣。

哪個節點最淺：ReplayInputBindingWitness，尤其低成本 content-generation binding。

哪個概念仍只是名詞：portable signed AllocationGenerationIdentity / GPUExecutionReplayWitness。

哪個系統值得讀原始碼：PyTorch CUDAGraph Trees + CUDACachingAllocator + ATen CUDAGraph。

哪篇論文需追引用：PyGraph: Robust Compiler Support for CUDA Graphs in PyTorch，尤其 compiler integration、parameter copy與graph applicability相關後續引用。

哪個概念最適合視覺模擬：CUDA Graph Replay & Memory Lifetime Microscope。

哪個 Agent 架構最值得實作：Risk-aware Agent Runtime + Tensor/Allocation Generation Graph + CUDA Graph Replay Witness + Model-State Lineage + Runtime Attestation + Non-exportable Signer + MCP SemanticCommit/Receipt。

## 下一輪研究

主題：Transformer Runtime State Lineage × KV Cache × Attention Invocation × Token/Logit Provenance

研究鏈：
GPUExecutionReplayWitness → Attention Q/K/V tensor generations → KV Cache allocation/page/block → position/sequence identity → RoPE position → attention kernel → residual stream → logits → sampling → TokenGenerationWitness

核心問題：即使 CUDA Graph replay與每個 static pointer都可信，LLM inference仍會跨 token steps持續修改 KV cache。Hermes如何證明第 t+1 個 token所讀取的 K/V pages，確實屬於同一 request、同一 sequence positions、同一 model generation，而不是合法 GPU execution讀到了錯 request、錯 page table或 stale cache？