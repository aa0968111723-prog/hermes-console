# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 22:52（Asia/Taipei）

主題：NIXL Remote Region Registration × Memory Descriptor × Physical KV Addressing × Heterogeneous TP

## 與歷史研究比較

上一輪已建立 `Semantic Prefix Hash → Distributed Object Identity → Runtime Compatibility → KV Cache Group`。本輪不重複討論 prefix hash，而是繼續往物理層追：distributed KV state 如何從 logical block/rank 變成 `(address, length, device)` descriptor、如何註冊 VRAM/DRAM、如何依 TP head slice 與 block stride 計算真正位址，最後交給 NIXL backend 搬移。

## 本小時新發現

1. vLLM NIXL connector 的 transfer identity 最後會落成 descriptor list；每個 descriptor 本質上是 `(addr, len, device_id)`，不是抽象 block ID。
2. KV cache memory registration 與 transfer descriptor 是兩個不同層次：先把 allocation range 註冊到 NIXL backend，再為 block/rank slice 建立 transfer descriptors。
3. Heterogeneous TP 的 head splitting 直接反映在 remote address calculation：`base_addr + rank_offset + block_index * block_stride`。
4. `block_len` 與 `block_stride` 不能混為一談。BLHNC/BHLNC 等 interleaved layout 下，stride 可以大於實際 transfer length。
5. NIXL backend 對 registered memory 產生 backend-specific metadata；遠端需要交換 serialized metadata，transfer request 才能合法引用 remote region。

## 本小時最重要 5 個發現

### 1. Physical KV identity 最終是 address range

**已確認工程實作。** vLLM `_stack_descs()` 將一組 block addresses 轉成 Nx3 descriptor：address、length、device ID。NIXL 的 backend guide 也定義 transfer descriptor 為 `(addr, len, devID, metadata)`。

底層鏈：

`Logical KV Block → Region → Base Address → Block Stride → Rank Offset → Physical Address → Length → Device ID → Registered-Memory Metadata → Transfer Descriptor`

重要性：Hermes 的 Digital Twin 若只停在 `block_id`，仍無法回答「資料實際從 GPU 哪個 byte range 搬到哪裡」。

限制：address 是 process/runtime-specific，不能當成跨 instance 的 stable semantic identity。

來源：
- https://docs.vllm.ai/en/v0.29.0/api/vllm/distributed/kv_transfer/kv_connector/v1/nixl/
- https://github.com/ai-dynamo/nixl/blob/main/docs/BackendGuide.md

### 2. Registration plane 與 Transfer plane 是不同層

**已確認官方/原始碼。** vLLM 先收集 storage address + storage size，呼叫 `get_reg_descs()` / `register_memory()`；之後才建立 block-level `get_xfer_descs()` 與 prepared transfer dlist。

`torch KV allocation → storage.data_ptr() → registration range → backend registration metadata`

再：

`block selection → block descriptors → transfer descriptor list → prep transfer → post transfer → completion`

NIXL backend registration 會維護 memory-region metadata；remote-capable backend 需能 serialize public data，另一端 load remote metadata 後才能存取。

為什麼重要：這解釋了「KV block hash 命中」仍不代表可以直接 DMA；物理 memory 必須先成為 transport 可存取的 registered region。

限制：不同 backend（UCX、libfabric、GDS 等）的 registration cost/credential 不同。

### 3. Heterogeneous TP 是 address transformation

**已確認工程實作。** vLLM `_build_fa_remote()` 對 SPLIT region 計算 rank-specific offset；核心形式為：

`addr = base_addr + rank_offset + block_index × block_stride`

其中 rank offset 與 remote KV block length / TP mapping 有關。REPLICATE region 則 offset=0，只需讀一次完整 block。

因此：

`TP Mapping → Source Rank Set → Rank Offset Factor → Remote Byte Offset → Descriptor`

這比「TP4 傳給 TP2」更精確：真正發生的是每個 decode rank 依 head ownership 建 descriptor slices，從一或多個 remote rank gather 對應 byte ranges。

限制：LBNHC token-major layout 不支援 heterogeneous TP head splitting；LBHNC head-major 才適合。Hybrid Mamba/SSM 另有 homogeneous TP 限制。

來源：https://docs.vllm.ai/en/latest/features/nixl_connector_compatibility/

### 4. block_len ≠ block_stride

**已確認工程實作。** vLLM 明確保存 `block_len_per_layer` 與 `block_stride_per_layer`。註解指出在 BLHNC/BHLNC 等跨 layer/block interleave layout 中，tensor `stride(0)` 可能大於 block transfer length。

所以物理模型必須是：

`Block_i_Address = RegionBase + i × BlockStride`

`TransferRange = [Block_i_Address, Block_i_Address + BlockLen)`

而不能錯寫成：

`RegionBase + i × BlockLen`

這是本輪最重要的 bottom-level mechanism，因為錯把 len 當 stride 會直接讀錯 GPU memory。

### 5. Static compatibility 與 runtime layout validation 分工

**官方資訊 + 工程實作。** vLLM NIXL handshake compatibility hash要求 model architecture/dtype、KV heads/head size/layers、attention backend、KV dtype、speculative method、transfer mode 等一致；TP size、block size可在受支援條件下不同。這表示系統刻意把「semantic/runtime compatibility」與「dynamic physical mapping」分開。

因此 Hermes 應建立：

`Compatibility Contract → Transfer Topology → Descriptor Builder → Registered Region Validation → Transfer`

而不是單一 `can_reuse=true/false`。

## Architecture Breakdown

```text
Request Prefix
→ Prefix Hash / Remote KV Lookup
→ Remote Engine + TP Mapping
→ Compatibility Handshake
→ Agent Metadata
   ├ base addresses
   ├ block lengths
   ├ block strides
   ├ region/group IDs
   ├ layout
   └ device/memory type
→ Descriptor Builder
   ├ logical block IDs
   ├ source rank mapping
   ├ rank offset
   ├ block stride
   └ transfer length
→ NIXL Descriptor List
→ Backend Memory Metadata
→ prepXfer
→ postXfer
→ UCX / libfabric / other transport
→ NIC / PCIe / NVLink path
→ Local Registered KV Region
→ Attention Kernel
```

### Control plane

`engine metadata → compatibility hash → remote agent metadata → registered-region credentials → topology mapping`

### Data plane

`remote addr/len/dev → local addr/len/dev → transfer request → asynchronous transport → completion`

## Bottom-Level Logic

### Full-attention local descriptor

For each region:

```text
block_len = region_block_len / block_size_ratio
logical_block = repeat(0..N-1)
split_offset = 0..ratio-1
address = base + logical_block × stride + split_offset × block_len
```

### Heterogeneous TP remote descriptor

```text
replicated ?
  rank_offset = 0
  reads = 1
:
  rank_offset = rank_offset_factor × remote_block_len
  reads = number_of_source_ranks

transfer_len = local_block_len / reads
address[b] = remote_base + rank_offset + b × remote_stride
```

### Mamba/SSM

Mamba state不是普通 token-extent KV。vLLM 將 convolution state 與 SSM temporal state分成不同 sub-region descriptors；其 local page geometry不依 attention block-size ratio 同樣切分。因此 Hybrid KV 的 physical state graph 必須區分 Attention KV 與 SSM state。

## Visual Simulation Idea

### NIXL Physical KV Address Microscope

互動輸入：
- TP(P) / TP(D)
- KV heads
- block size P/D
- LBHNC / LBNHC / BLHNC
- layers
- block IDs
- VRAM/DRAM
- replicated vs split region

畫面分五層：

```text
Logical
Block 17 / Layer 8 / Head shard 1
↓
Topology
P-rank 2 → D-rank 0
↓
Address Equation
base + rank_offset + block × stride
↓
Descriptor
[0x7f..., 262144 bytes, GPU1]
↓
Transport
Registered VRAM → NIXL → UCX → NIC/NVLink/PCIe → GPU0
```

拖動 TP4→TP2 時，直接動畫顯示兩個 remote head slices如何被 gather 成 decode rank 的 local KV block。切換 LBNHC 時則顯示 hetero-TP head splitting 不合法。

## Code / GitHub

### vLLM
Repository: https://github.com/vllm-project/vllm

值得追的核心檔案：
- `vllm/distributed/kv_transfer/kv_connector/v1/nixl/base_worker.py`
  - KV allocation registration
  - `_build_fa_local`
  - `_build_fa_remote`
  - `_build_mamba_local`
  - `_build_mamba_remote`
  - `register_local_xfer_handler`
  - compatibility handshake / TP mapping
- `vllm/v1/kv_cache_layout.py`
  - logical `[L,B,H,N,C]` 到 LBHNC/LBNHC/BLHNC 等 physical permutation

### NIXL
Repository: https://github.com/ai-dynamo/nixl

值得追：
- `docs/BackendGuide.md`
- memory registration
- descriptor-list abstraction
- remote metadata serialization
- prep/post/check transfer lifecycle
- UCX / libfabric backend implementations

## Papers / Technical Sources

本輪以官方原始碼與 transport architecture 為主，沒有為湊數加入不直接相關論文。

1. NIXL Backend Guide — NVIDIA/AI-Dynamo ecosystem, current technical documentation. Contribution: 定義 registered memory、backend metadata、descriptor list、async transfer lifecycle。Limitations: API/architecture documentation，不是 end-to-end LLM benchmark。
   URL: https://github.com/ai-dynamo/nixl/blob/main/docs/BackendGuide.md

2. vLLM NixlConnector Compatibility Matrix — vLLM project. Contribution: 明確定義 heterogeneous TP/block size/layout 支援矩陣與 compatibility contract。Limitations: 隨版本快速演進。
   URL: https://docs.vllm.ai/en/latest/features/nixl_connector_compatibility/

## 已確認 / 推論 / 假說

**已確認事實**：vLLM descriptor builder以 base address、block stride、rank offset、transfer length形成 physical descriptors；NIXL要求 memory registration並透過 descriptor list執行 transfer。

**官方資訊**：LBHNC支援 heterogeneous TP head splitting；LBNHC不支援；quantized KV cache兩端必須使用相同 cache dtype，dynamic per-block scale目前不能隨 KV 一起 transfer。

**工程推論**：Hermes 可以把 descriptor equations當成 Execution Digital Twin 的「byte-address layer」，把 logical KV block映射成 transport cost與 physical path。

**尚未驗證假說**：在真實 GB200/NVLink fabric 上，可否僅由 descriptor count、bytes、registration state與 topology準確預測每次 KV transfer latency；需要 telemetry/benchmark 校準。

## Unknown / Open Questions

1. NIXL 在 UCX/libfabric backend 下，remote registration metadata 最終如何映射到 NIC rkey / CUDA DMA-BUF / GPUDirect RDMA，哪些成本可被 cache？
2. 多 descriptor、跨 GPU transfer request 如何被 backend 合併/並行，descriptor fragmentation 對 latency 的實際曲線為何？
3. Mooncake object-store path與 NIXL direct VRAM path如何在同一 physical state graph中統一表示 storage address、network address與 GPU address？

## 下一輪研究

`NIXL Backend → UCX / libfabric → GPUDirect RDMA → rkey / DMA-BUF → NIC queue → GPU VRAM`。

重點追：
- NIXL UCX backend registerMem / getPublicData / loadRemoteMD
- CUDA VRAM registration與 DMA-BUF / GPUDirect RDMA
- transfer request batching / completion semantics
- NVLink vs PCIe vs RDMA transport path
- descriptor fragmentation cost
- Mooncake StoreLayout 與 direct NIXL path的統一 physical state model

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `RegisteredMemoryRegion`
- `RegistrationDescriptor`
- `TransferDescriptor`
- `BackendMemoryMetadata`
- `RemoteMemoryCredential`
- `KVRegionBaseAddress`
- `KVBlockStride`
- `KVTransferLength`
- `TPRankOffset`
- `PhysicalKVAddress`
- `DescriptorList`
- `TransferTopology`
- `AsyncTransferRequest`
- `AttentionKVRegion`
- `MambaStateRegion`
- `PhysicalStateTransport`

新增 Edges：
- `LogicalKVBlock → maps_to → PhysicalKVAddress`
- `TPMapping → determines → TPRankOffset`
- `KVLayout → determines → KVBlockStride`
- `RegisteredMemoryRegion → exposes → BackendMemoryMetadata`
- `PhysicalKVAddress → encoded_as → TransferDescriptor`
- `TransferDescriptor → belongs_to → DescriptorList`
- `DescriptorList → submitted_as → AsyncTransferRequest`
- `AsyncTransferRequest → moves → DistributedPhysicalAIState`

## 本輪結束檢查

- 缺哪一層：NIXL descriptor 以下的 UCX/libfabric/GPUDirect RDMA 實際 transport mechanics。
- 哪個節點最淺：`RemoteMemoryCredential`。
- 哪個概念仍只是名詞：`DistributedPhysicalAIStatePath` 的 NIC/PCIe/NVLink 統一模型。
- 哪個系統值得讀原始碼：NIXL UCX backend，其次 vLLM NIXL worker transfer lifecycle。
- 哪篇論文需追引用：本輪沒有強行選論文；下一輪應優先追 NIXL/GPUDirect/RDMA 系統論文與 benchmark。
- 哪個概念最適合視覺模擬：`Logical KV Block → Byte Address → Descriptor → Network → GPU Address`。
- 哪個 Agent 架構最值得實作：延續 Hermes `PhysicalExecutionPlanner`，新增 `PhysicalStateTransportPlanner`，讓 Agent 能解釋並預估 KV/encoder state 的跨 GPU/跨機搬移。

## 對「AI 到底怎麼運作」新增的完整鏈

```text
使用者輸入
→ UI
→ Agent Runtime
→ Context / Planning / Memory
→ Model Prefill
→ KV Semantic Identity
→ Prefix Hash
→ Distributed Object / Remote Engine
→ KV Cache Group
→ Logical Block
→ TP Mapping
→ Base Address + Rank Offset + Block Stride
→ NIXL Transfer Descriptor
→ Registered VRAM/DRAM
→ Transport Backend
→ Local GPU KV Address
→ Attention Kernel
→ logits / sampling
→ Agent observation
→ Tool / MCP / action
→ Output
```

本輪真正補上的不是另一個 cache 名詞，而是 **「AI 的上下文狀態最後如何變成 GPU 記憶體裡的一段 byte range，並被 transport runtime 搬到另一張 GPU」**。