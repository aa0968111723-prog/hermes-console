# 【AI Agent × Multimodal Research Report】

時間：2026-09-24 04:52（Asia/Taipei）

主題：GPU Kernel Invocation Witness × Tensor Storage Binding × Shape/Stride/Dtype × CUDA Stream/Launch Geometry

## 與歷史研究比較

上一輪已建立 AutotuneDecisionWitness，回答「為什麼最後選到這個 kernel」。本輪不重複 compiler/autotune provenance，而是補下一個缺口：即使 kernel binary 與 winner 都可信，如何證明一次真實 launch 所消費的 tensor storage、metadata、stream 與 execution geometry，仍然對應被批准的 operator semantics。

研究鏈：

Autotune Winner → CUfunction → Launch Geometry → Stream → Kernel Argument Buffer → Tensor Pointer → Storage → Storage Offset → Shape/Stride/Dtype → Operator Semantic Identity → GPUKernelInvocationWitness

## 本小時新發現

1. CUDA Driver API 的 cuLaunchKernel 將 function identity、grid dimensions、block dimensions、dynamic shared memory、stream 與 kernelParams 放在同一 launch boundary；kernelParams 是 N 個 pointers，driver 從這些 host-side regions 複製真正 kernel parameters。這代表「kernel identity」與「invocation identity」必須分開。
2. PyTorch Tensor 並不等於一個獨立 allocation。官方 Storage model指出 tensor由 Storage + dtype + shape + stride + storage offset構成；tensor view可以共享同一 underlying storage。
3. 因此 data pointer/storage identity 單獨不足以證明 tensor semantic identity：同一 storage可由 transpose/as_strided/narrow/view 等 metadata產生不同 logical tensor。
4. CUDA stream 是 execution ordering identity的一部分。同一 stream中的 operations依 enqueue順序序列化，不同 streams可並行且若無 synchronization，其相對順序不受保證。因此「同一 kernel + 同一 tensors」仍可能因 stream dependency不同而具有不同 observable semantics。
5. GPU launch witness必須綁定 operator semantic contract，而不能只記錄 raw pointers。對 matmul/attention等 operator，shape、stride、dtype、device、storage range、alias/view relation與 stream dependency都會影響 invocation是否等價。

## 本小時最重要 5 個發現

### 1. Kernel provenance ≠ Invocation provenance

已確認事實：CUDA cuLaunchKernel 的 launch boundary包含 CUfunction、grid/block、sharedMemBytes、stream與 kernelParams。

底層：
Approved CUfunction → grid/block/sharedMem → stream → argument pointers → copied kernel argument values → enqueue

重要性：合法 cubin 可以被合法地以錯誤 pointer、錯誤 dimension或錯誤 stream呼叫。

限制：CUDA API本身不理解「這個 pointer應該是 attention 的 Q tensor」這種高層 semantics。

### 2. Tensor identity是 storage + metadata，不只是 pointer

已確認事實：PyTorch官方 Storage文件把 tensor描述為 Storage、dtype、shape、stride、offset的組合。Tensor Views文件確認 view與base可以共享同一 underlying data。

底層：
StorageAllocation → base address → storage offset → shape → stride → dtype → logical tensor indexing

重要性：兩個 tensors可以有相同 storage但不同 logical interpretation。

限制：仍需處理 sparse/nested/quantized tensor等特殊 layout。

### 3. View/Alias graph必須進 Knowledge Graph

工程推論：如果只 attestate data_ptr，transpose/as_strided/narrow等 view可能讓同一 allocation被不同方式解讀。因此需要 TensorViewIdentity 與 StorageAliasEdge。

提出：
TensorSemanticIdentity = H(StorageIdentity, storageOffset, shape, stride, dtype, device, layout, view/alias generation)

### 4. Stream是 invocation semantics的一部分

已確認事實：PyTorch CUDA semantics指出同一 stream內操作依建立順序序列化；不同 streams可以並行，除非用 synchronization建立 ordering。

因此：
SameKernel + SameTensorPointers --does_not_prove→ SameExecutionSemantics

需要：
StreamDependencyGeneration = stream identity + preceding events + wait edges + relevant producer generations

### 5. Operator semantic identity應與 raw launch witness做 join

Hermes architecture proposal：
OperatorSemanticIdentity → ExpectedTensorRoles(Q/K/V/weight/input/output...) → TensorSemanticWitnesses → KernelArgumentBinding → LaunchConfiguration → GPUKernelInvocationWitness

若只知道 kernelParams[0]=0x...，無法知道它究竟代表 input、output、stride scalar或workspace。因此需要 compiler/runtime提供 argument schema，把 raw ABI position重新連回 operator role。

## Architecture Breakdown

User Request
→ Agent/Model
→ FX/Inductor Operator Semantic Identity
→ AutotuneDecisionWitness
→ CompiledGPUKernelProvenanceWitness
→ CUmodule/CUfunction
→ Kernel Argument Schema
→ Tensor Semantic Identities
→ Storage/Alias Graph
→ Stream Dependency Graph
→ Grid/Block/SharedMem
→ cuLaunchKernel
→ GPUKernelInvocationWitness
→ GPU execution
→ Output Tensor Generation

## Bottom-Level Logic

### CUDA launch

CUfunction
→ gridDim(X,Y,Z)
→ blockDim(X,Y,Z)
→ sharedMemBytes
→ hStream
→ kernelParams[]
→ driver copies parameter values according to kernel image ABI
→ launch enqueued

### PyTorch tensor

TensorImpl
→ Storage
→ storage_offset
→ sizes/shape
→ strides
→ dtype
→ device/layout
→ logical element address = storage base + metadata-derived offset

### Proposed binding

TensorSemanticWitness = H(
  storageGeneration,
  allocationIdentity,
  storageOffset,
  shape,
  stride,
  dtype,
  device,
  layout,
  aliasGeneration
)

KernelArgumentBindingWitness = H(
  compiledKernelIdentity,
  argumentSchemaIdentity,
  ABIPosition,
  semanticRole,
  scalarValue OR TensorSemanticWitness
)

GPUKernelInvocationWitness = H(
  loadedGPUFunctionIdentity,
  compiledKernelProvenanceWitness,
  autotuneDecisionWitness,
  launchGeometry,
  dynamicSharedMemory,
  streamDependencyGeneration,
  orderedArgumentBindingWitnesses,
  operatorSemanticIdentity,
  invocationGeneration
)

## Visual Simulation Idea

### GPU Kernel Invocation & Tensor Binding Microscope

Panels:
1. Operator/FX semantic node
2. Selected kernel + provenance
3. Kernel ABI argument schema
4. Tensor view/storage graph
5. Pointer + storage range map
6. shape/stride/dtype inspector
7. CUDA stream timeline
8. grid/block/shared-memory launch panel
9. final invocation witness

Fault injection:
- SAME_STORAGE_WRONG_VIEW
- TENSOR_POINTER_SWAPPED
- Q_K_ARGUMENTS_SWAPPED
- STRIDE_CHANGED
- STORAGE_OFFSET_CHANGED
- DTYPE_REINTERPRETED
- WRONG_CUDA_STREAM
- MISSING_WAIT_EVENT
- GRID_DIM_CHANGED
- SHARED_MEMORY_CHANGED
- WORKSPACE_POINTER_REUSED
- ALLOCATION_RECYCLED_SAME_ADDRESS

Important UI state:
Kernel provenance ✓ | Autotune winner ✓ | Tensor storage ✓ | Tensor semantics ✗ | Stream ordering ?
→ BLOCK HIGH-RISK EFFECT

## Code / GitHub

PyTorch current source worth continuing:
- c10/core/TensorImpl.h
- c10/core/TensorImpl.cpp
- aten/src/ATen/core/TensorBase.h
- c10/cuda/CUDACachingAllocator.*
- c10/cuda/CUDAStream.*
- torch/_inductor/runtime/triton_heuristics.py
- torch/_inductor/cudagraph_trees.py

Current GitHub source search confirms TensorBase exposes storage_offset()/stride(), while TensorImpl owns Storage and dtype/key metadata. cudagraph_trees also contains explicit data_ptr tracking, showing pointer identity is operationally important but not semantically sufficient.

## Papers / Primary technical sources

This round is primarily systems-source research rather than a new-paper round.

Primary sources:
- NVIDIA CUDA Driver API 13.4, Execution Control / cuLaunchKernel.
- NVIDIA CUDA Runtime API 13.4, kernel launch parameter structures.
- PyTorch main docs, Tensor Views, updated 2026-05-07.
- PyTorch 2.14 Storage docs, updated 2026-05-06.
- PyTorch main CUDA semantics / streams.
- PyTorch current GitHub TensorImpl/TensorBase sources.

## Fact / inference boundary

Confirmed official fact:
- cuLaunchKernel binds function, geometry, shared memory, stream and argument pointers at launch.
- Tensor views can share underlying storage.
- Tensor structure includes storage, dtype, shape, stride and offset.
- CUDA streams determine ordering/concurrency semantics.

Engineering implementation fact:
- Current PyTorch TensorBase exposes storage_offset and stride from TensorImpl.
- Current TensorImpl is constructed with Storage and dtype/key metadata.

Hermes architecture proposal:
- TensorSemanticWitness.
- KernelArgumentBindingWitness.
- StreamDependencyGeneration.
- GPUKernelInvocationWitness.

Unverified hypothesis:
- A portable cross-framework tensor semantic witness can be normalized across PyTorch, JAX/XLA, TensorFlow, ONNX Runtime and custom CUDA without losing alias/layout semantics.

## Unknown / Open Questions

1. 如何把 raw CUDA kernel ABI argument position可靠地重新對應到 Inductor/Triton high-level semantic role？
2. CUDACachingAllocator可能重用相同 virtual address；如何建立不依賴 pointer value的 AllocationGeneration，避免 ABA identity problem？
3. CUDA Graph capture/replay會把 launch與pointer topology固化/重播；GPUKernelInvocationWitness應在 capture時、instantiate時還是 replay時生成？

## Knowledge Graph 新增 Node / Edge

Nodes:
- OperatorSemanticIdentity
- TensorStorageGeneration
- TensorSemanticIdentity
- TensorViewIdentity
- StorageAliasGeneration
- KernelArgumentSchemaIdentity
- KernelArgumentBindingWitness
- LaunchGeometryIdentity
- CUDAStreamIdentity
- StreamDependencyGeneration
- GPUKernelInvocationGeneration
- GPUKernelInvocationWitness
- OutputTensorGeneration

Edges:
- TensorSemanticIdentity --views→ TensorStorageGeneration
- TensorViewIdentity --aliases→ TensorSemanticIdentity
- OperatorSemanticIdentity --expects_role→ KernelArgumentSchemaIdentity
- KernelArgumentBindingWitness --binds_role_to→ TensorSemanticIdentity
- GPUKernelInvocationWitness --uses→ LoadedGPUFunctionIdentity
- GPUKernelInvocationWitness --uses→ StreamDependencyGeneration
- GPUKernelInvocationWitness --implements→ OperatorSemanticIdentity
- GPUKernelInvocationWitness --produces→ OutputTensorGeneration

## 本輪結束判斷

缺哪一層：CUDA Graph capture/replay + allocator address reuse + tensor lifetime generation。

哪個節點最淺：TensorStorageGeneration，尤其 pointer reuse後如何證明「同地址、不同 allocation generation」。

哪個概念仍只是名詞：portable KernelArgumentBindingWitness。

哪個系統值得讀原始碼：PyTorch CUDACachingAllocator + CUDA Graph Trees + Triton launcher。

哪篇論文需追引用：下一輪優先補 CUDA Graph / GPU memory allocator / execution replay correctness相關系統研究；本輪核心依據為官方 runtime與原始碼。

哪個概念最適合視覺模擬：GPU Kernel Invocation & Tensor Binding Microscope。

哪個 Agent 架構最值得實作：Risk-aware Agent Runtime + OperatorSemanticWitness + Tensor/Allocation Generation Graph + GPUKernelInvocationWitness + Runtime Attestation + Non-exportable Signer + MCP SemanticCommit/Receipt。

## 下一輪研究

CUDA Graph Capture → Graph Node Parameters → Tensor/Pointer Topology → CUDACachingAllocator → Allocation Lifetime → Address Reuse/ABA → Graph Instantiate → Replay → Mutation/Update → GPUExecutionReplayWitness。

核心問題：即使某一次 cuLaunchKernel的 function、arguments、tensor metadata與stream全部被正確綁定，當 PyTorch/Inductor改用 CUDA Graph capture/replay後，Hermes如何證明 replay時那些被捕捉的 device pointers仍然指向同一 allocation generation與同一 tensor semantics，而不是只因 virtual address剛好相同就被誤認為同一份資料？
