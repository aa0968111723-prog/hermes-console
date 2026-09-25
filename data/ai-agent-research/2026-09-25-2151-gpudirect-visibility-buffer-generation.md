# AI Agent × Multimodal Research Report

Time: 2026-09-25 21:51 Asia/Taipei
Topic: GPUDirect RDMA visibility fences, CUDA allocation identity, and retry-safe accelerator memory

## Historical delta
Previous rounds established LogicalRequest vs ExecutionAttempt, immutable input lifetime, zcopy registration lifetime, and revocable access/commit capability. This round closes the next missing layer: registration is not sufficient to prove GPU/NIC visibility, and a GPU virtual address is not a durable allocation identity.

## Five findings
1. NVIDIA GPUDirect RDMA defines an independent third-party-device data path under the GPU relaxed memory model. Proper registration is necessary, but only CUDA synchronization/work-submission APIs provide ordering of GPUDirect RDMA operations.
2. CU_POINTER_ATTRIBUTE_SYNC_MEMOPS changes CUDA behavior for an allocation so CUDA API memory operations are synchronized consistently with GPUDirect BAR mappings. Therefore RegistrationWitness and VisibilityWitness are separate graph nodes.
3. For inbound RDMA writes, cuFlushGPUDirectRDMAWrites can block until remote writes are visible to a requested CUDA scope. Hardware may make this a no-op for already-guaranteed scopes; multiple hardware paths can form separate ordering domains that software must order externally.
4. CUDA documents that the same GPU virtual address can be reused for another allocation/context/GPU. BUFFER_ID/P2P-token style metadata exists to distinguish allocation incarnations. OpenUCX CUDA IPC current source records CU_POINTER_ATTRIBUTE_BUFFER_ID in its packed handle metadata. Pointer equality therefore cannot be an allocation-generation fence.
5. Agent-runtime analogue: a resource locator/session/object pointer is only an address. Retry correctness requires ResourceGeneration + Visibility/ReadinessWitness + AttemptGeneration before granting commit/use authority.

## Architecture Breakdown
GPU producer -> CUDA stream/work -> producer completion/synchronization -> GPU allocation generation -> UCX memory-type/registration view -> GPUDirect mapping/rkey -> NIC DMA -> RDMA completion -> visibility fence/scope -> GPU consumer work -> logical commit.

The reverse receive direction is:
NIC remote write -> PCIe/BAR mapping -> RDMA completion observed by CPU/runtime -> cuFlushGPUDirectRDMAWrites or hardware ordering guarantee -> CUDA consumer submission -> GPU-visible data.

## Bottom-Level Logic
Registration(address) does not imply ProducerWritesVisibleToNIC.
RDMACompletion does not universally imply ConsumerGPUCanObserveBytes.
PointerEquality does not imply SameAllocationGeneration.

Safe consume gate:
Use(buffer) only if
AllocationGeneration == expected &&
AccessGeneration == active &&
VisibilityWitness covers consumer scope &&
AttemptGeneration has current authority.

Safe retry gate:
RetryEquivalent(A0,A1) requires same LogicalTransaction and same InputSnapshot/AllocationGeneration, not merely same pointer.

## Visual Simulation Idea
GPU Visibility & Allocation Generation Microscope.
Columns: logical tensor, VA, BUFFER_ID/allocation generation, CUDA stream event, registration/memh, rkey/access generation, NIC DMA, RDMA completion, visibility scope, cuFlushGPUDirectRDMAWrites, consumer kernel, commit eligibility.
Fault injection: SAME_VA_NEW_ALLOCATION, PRODUCER_NOT_SYNCHRONIZED, RDMA_COMPLETE_GPU_STALE, MULTI_PATH_ORDERING_DOMAIN, STALE_RKEY_AFTER_REALLOCATION.

## Code / GitHub
OpenUCX: src/uct/cuda/cuda_ipc/cuda_ipc_md.c.
Current source obtains CU_POINTER_ATTRIBUTE_BUFFER_ID while registering/exporting CUDA IPC memory and stores it in CUDA IPC key metadata. This is concrete evidence that allocation identity needs more than a raw pointer.

Next source targets: src/uct/cuda/cuda_copy/, CUDA base memory-type detection/cache, UCP memh/rkey invalidation, and IB/rdma paths consuming CUDA memory.

## Papers / primary technical sources
NVIDIA CUDA GPUDirect RDMA documentation, Synchronization and Memory Ordering.
NVIDIA CUDA Driver API, cuFlushGPUDirectRDMAWrites.
OpenUCX CUDA IPC memory-domain source.

## Unknown / Open Questions
1. Exactly where current UCX converts CUDA allocation invalidation/BUFFER_ID changes into registration-cache or rkey invalidation across each CUDA/RDMA path.
2. Whether every UCX GPU transport path establishes the producer-side synchronization needed before NIC reads, or whether the application/protocol owns part of this contract.
3. How allocation-generation and endpoint/rkey-generation fences compose during failover from one MD/lane/path to another.

## Next round
Trace CUDA allocation invalidation -> UCX memory-type/cache invalidation -> memh/rkey invalidation -> remote-key generation -> lane/MD failover -> stale-rkey rejection.

## Knowledge Graph additions
Nodes:
- GPUAllocationGeneration
- GPUVirtualAddressAlias
- RegistrationWitness
- ProducerVisibilityWitness
- ConsumerVisibilityWitness
- GPUDirectOrderingDomain
- BufferIDWitness
- RKeyAccessGeneration
- VisibilityScope
- AcceleratorReadinessWitness

Edges:
- GPUVirtualAddressAlias does_not_imply GPUAllocationGeneration
- BufferIDWitness identifies GPUAllocationGeneration
- RegistrationWitness does_not_imply ProducerVisibilityWitness
- RDMACompletion does_not_universally_imply ConsumerVisibilityWitness
- cuFlushGPUDirectRDMAWrites produces ConsumerVisibilityWitness
- GPUAllocationGeneration gates RKeyAccessGeneration
- VisibilityWitness gates AcceleratorReadinessWitness
- AcceleratorReadinessWitness gates CommitCapability

## End-of-round answers
Missing layer: CUDA allocation invalidation -> UCX memh/rkey cache invalidation.
Shallowest node: RKeyAccessGeneration.
Still mostly a name: cross-path AcceleratorReadinessWitness.
Best source to read next: OpenUCX CUDA base/cuda_copy + UCP memory/rkey lifecycle.
Citation line to pursue: GPUDirect RDMA memory-ordering semantics and current UCX CUDA allocation invalidation implementation.
Best visualization: GPU Visibility & Allocation Generation Microscope.
Agent architecture worth implementing: Event-sourced Runtime + ResourceGeneration + AccessGeneration + VisibilityWitness + ExecutionAttemptEpoch + RevocableCommitCapability.
