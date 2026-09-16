# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 23:54 Asia/Taipei

主題：NIXL UCX Backend × GPUDirect RDMA × rkey × Descriptor Batching × Transfer Completion

## 與歷史研究比較

上一輪已經從 Logical KV Block 追到 Physical KV Address / NIXL Descriptor / Registered VRAM。本輪不重複 address/stride，而是繼續向下追：descriptor 如何變成 UCX memory registration、remote key、RDMA READ/WRITE，以及何時才能宣告 transfer 真正完成。

## 本小時新發現

1. NIXL UCX backend 在 memory registration 時呼叫 UCX memory registration，並把已註冊 memory pack 成 rkey metadata；remote side 載入 metadata 後建立可用於 endpoint 的 remote key。
2. 真正 data movement 逐 descriptor 取得 local address/length、remote address、local registered-memory handle 與 remote rkey，然後呼叫 endpoint READ 或 WRITE。
3. NIXL 的完成語意不是「最後一個 RDMA request 已 post」；UCX backend 額外 append endpoint flush，使 request handle 維持未完成直到 endpoint operations 真正完成。
4. NIXL/UCX 可以走 GPU-to-GPU direct path，但是否真正 GPUDirect RDMA 取決於 UCX/NIC/GPU memory capability；若 UCX device 只顯示 host memory support，系統會退回 host staging。
5. GPUDirect RDMA 完成與 GPU kernel 可見性不是同一件事。NVIDIA 官方文件指出 GPU relaxed memory model 下，CPU initiated CUDA synchronization/work submission 才建立後續 GPU work 所需的 ordering。因此 TransportCompletion 與 ComputeVisibilityBarrier 應是兩個 Knowledge Graph 節點。

## 本小時最重要 5 個發現

### 1. rkey 是 Remote Memory Capability，不只是 address

已確認工程實作：NIXL UCX `registerMem()` 對 region 執行 memory registration 後，呼叫 `packRkey()` 產生可公開交換的 metadata。remote side 再將 packed metadata 轉成 endpoint-specific rkey。

底層鏈：

GPU allocation
→ UCX memReg
→ registered memory handle
→ packRkey
→ public metadata
→ remote metadata exchange
→ unpack/load remote key
→ RDMA-capable remote access

重要性：remote virtual address 本身不足以讓另一個 process/NIC 合法存取 GPU region；transport 還需要 registration/capability metadata。

限制：rkey 的具體底層表示與安全邊界依 UCX transport/device/backend 而異，不能把它簡化成永久 token。

來源：
- NIXL UCX source: https://github.com/ai-dynamo/nixl/blob/main/src/plugins/ucx/ucx_backend.cpp
- NVIDIA GPUDirect RDMA: https://docs.nvidia.com/cuda/gpudirect-rdma/

### 2. Descriptor 最後真的變成 UCX READ / WRITE

已確認工程實作：`sendXferRange()` 對每個 descriptor 讀取 local addr/len、remote addr、local memory registration metadata、remote rkey，READ 路徑呼叫 endpoint read，WRITE 路徑呼叫 endpoint write。

因此 physical execution 可以精確拆成：

NIXL descriptor
→ local.addr / len
→ remote.addr
→ local mem handle
→ remote rkey
→ UCX endpoint
→ READ / WRITE
→ NIC / local transport
→ destination memory

這證明上一輪的 `(address,length,device)` descriptor 並不是終點，而是 transport command 的輸入。

### 3. Post Completion ≠ Transfer Completion

已確認工程實作：NIXL UCX backend 在送出 descriptor requests 後還會 `flushEp()`，並把 flush request append 到同一 request handle。`checkXfer()` / request status 才代表 operation 是否仍 IN_PROG 或已成功。

模型：

prepXfer
→ postXfer
→ descriptor READ/WRITE requests
→ endpoint flush
→ progress()
→ checkXfer
→ DONE

為什麼重要：如果 Hermes Digital Twin 把「post 完」畫成資料已可用，就會錯誤模擬 buffer lifetime、scheduler wake-up 與下一個 GPU kernel 的 dependency。

### 4. GPUDirect RDMA 是 physical path eligibility，不是 NIXL API 保證

官方資訊：NIXL 可使用 UCX，vLLM NixlConnector 預設 backend 也是 UCX；NVIDIA Dynamo 的部署文件建議用 `ucx_info -d` 確認 memory domain 是否同時支援 host 與 cuda 的 access/reg/cache。若只有 host，KV transfer 會走 host staging。

所以：

NIXL READ
→ UCX backend
→ transport capability discovery
├ CUDA memory + RDMA capable → GPUDirect path
└ host only / unsupported → CPU staging/fallback

這代表 `TransportBackend=UCX` 與 `PhysicalPath=GPUDirectRDMA` 必須分開建模。

### 5. RDMA Completion ≠ GPU Compute Visibility

NVIDIA 官方 GPUDirect RDMA 文件指出：第三方 PCIe device 對 GPU BAR 的 RDMA write 即使已完成，並不表示正在執行或後續未正確同步的 GPU kernel必然以正確 ordering 看見更新；CUDA synchronization/work submission APIs 是 ordering boundary。

因此新增：

RDMACompletion
→ ComputeVisibilityBarrier
→ ConsumerKernelLaunch

而不是：

RDMACompletion
→ ConsumerKernel

這是本輪最重要的 bottom-level correctness node。

## Architecture Breakdown

### System Architecture：Distributed KV Transport Data Plane

Request
→ Prefix/KV ownership decision
→ logical block IDs
→ physical KV descriptors
→ NIXL agent
→ registered local/remote memory
→ UCX backend
→ rkey metadata
→ endpoint READ/WRITE
→ RDMA / CUDA IPC / shared-memory eligible transport
→ endpoint flush
→ completion polling/progress
→ CUDA ordering boundary
→ Attention kernel consumes KV

Control plane 與 data plane 必須分離：

Control Plane
- agent metadata
- remote endpoint discovery
- descriptor metadata
- ownership / lease / completion notification

Data Plane
- registered VRAM/DRAM
- addr + length
- rkey
- UCX READ/WRITE
- NIC/PCIe path

## Bottom-Level Logic

### Mechanism：Remote GPU KV Read

1. GPU allocator 建立 KV backing allocation。
2. Runtime 取得 allocation base address / byte extent。
3. NIXL 將 region 交給 UCX memory registration。
4. UCX 產生 local registered-memory handle。
5. UCX pack remote-key metadata。
6. metadata 經 control plane 傳給 consumer。
7. consumer 將 metadata 載入成 endpoint-specific remote key。
8. logical block IDs 轉為 physical descriptors。
9. 每個 descriptor 取得 local destination address、remote source address、length。
10. UCX endpoint 發出 RDMA READ（或其他可用 transport）。
11. 多 descriptor request 被掛在 NIXL request handle。
12. endpoint flush 加入 completion dependency。
13. progress engine 推進 transport。
14. checkXfer 直到 DONE / error。
15. Runtime 建立必要 CUDA ordering/synchronization。
16. Attention kernel 才安全消費新 KV state。

## Visual Simulation Idea

### RDMA KV Packet-to-Kernel Microscope

互動輸入：
- KV block IDs
- layer / TP rank
- block bytes
- descriptor count
- UCX transport
- CUDA-memory registration on/off
- GPUDirect on/off
- NIC bandwidth
- completion latency

畫面：

Logical KV Block
→ GPU virtual address
→ UCX registration region
→ packed rkey
→ remote endpoint
→ Descriptor 0..N
→ RDMA READ/WRITE queue
→ endpoint flush
→ completion state
→ CUDA visibility barrier
→ Attention kernel

使用者可以關掉 GPUDirect，立即看到 path 變成：
GPU → host staging → NIC → host staging → GPU，並比較 latency、CPU traffic、PCIe traffic。

另一個模式可故意讓 `postXfer` 已完成但 `flush/checkXfer` 尚未 DONE，視覺上禁止 Attention kernel 啟動，以展示 completion correctness。

## Code / GitHub

### ai-dynamo/nixl
值得繼續讀：
- `src/plugins/ucx/ucx_backend.cpp`：registration、rkey、prep/post/check transfer
- `src/plugins/ucx/rkey.cpp`：remote-key wrapper/lifetime
- `src/plugins/ucx/mem_list.cpp`：registered memory list
- `src/plugins/ucx/ucx_sgl.cpp`：scatter-gather batching path
- `src/plugins/ucx/ucx_backend_req.h`：request/completion state

Repository: https://github.com/ai-dynamo/nixl

### vllm-project/vllm
值得繼續讀：
- `vllm/distributed/kv_transfer/kv_connector/v1/nixl/base_worker.py`
- `vllm/distributed/nixl_utils.py`
- `vllm/distributed/ec_transfer/ec_connector/cpu/data/nixl.py`

Repository: https://github.com/vllm-project/vllm

vLLM 的 EC CPU/NIXL path 也明確拆成 register memory → xfer descriptors → prep dlist，與本輪 transport model 一致。

## Papers / Technical Sources

本輪主要是 system/runtime bottom layer，核心證據以官方文件與原始碼為主，而非用論文替代 implementation truth。

1. NVIDIA, GPUDirect RDMA Documentation, current CUDA documentation.
   URL: https://docs.nvidia.com/cuda/gpudirect-rdma/
   Contribution：說明 GPU BAR mapping、registration、peer device DMA 與 memory ordering。
   Limitation：描述 CUDA/GPUDirect contract，不代表特定 NIXL/vLLM deployment 一定啟用 direct path。

2. NIXL project, UCX backend implementation.
   Institution/project: NVIDIA Dynamo / NIXL open source ecosystem.
   URL: https://github.com/ai-dynamo/nixl
   Architecture：plugin backend → memory registration → metadata/rkey → descriptor transfer → request completion。
   Limitation：backend implementation持續演進，需綁定 revision 驗證。

3. vLLM NixlConnector documentation.
   URL: https://docs.vllm.ai/en/latest/features/nixl_connector_usage/
   Contribution：把 NIXL transport接到 disaggregated prefill/KV transfer，並暴露 transfer time、post time、bytes、descriptor count、failures 等 metrics。
   Limitation：metrics 描述 runtime outcome，不單獨證明 physical NIC path。

## 已確認事實 / 推論分界

已確認：NIXL UCX source 有 memory registration、rkey pack/load、per-descriptor READ/WRITE、endpoint flush、completion status。

已確認：GPUDirect RDMA 需要 GPU memory registration / platform support；UCX CUDA memory capability可用來檢查 direct-path prerequisites。

已確認：NVIDIA 文件要求正確 CUDA synchronization/work submission 才能建立 GPUDirect RDMA 與 GPU compute 間的 ordering。

合理推論：Hermes 應把 descriptor count、registration cache hit、post latency、transfer latency、flush/completion latency納入 Physical Execution Planner cost model。

尚未驗證假說：在 Hermes 目標硬體上，descriptor coalescing/SGL 的最佳粒度與 registration-cache 策略；需要真 GPU+NIC benchmark。

## Unknown / Open Questions

1. NIXL UCX SGL path 在大型 fragmented KV transfer 下，descriptor count 降低多少 CPU/post overhead，何時反而因 batching 增加 latency？
2. DMA-BUF 與 legacy `nvidia-peermem` 在 NIXL/UCX registration metadata、failure modes、registration cache 上的實際差異？
3. RDMA completion → CUDA consumer kernel 的最小安全 synchronization primitive，在 vLLM/NIXL 現行實作中精確落在哪一層？

## 下一輪研究

收斂到：

`UCX SGL / Descriptor Coalescing × Registration Cache × DMA-BUF vs nvidia-peermem × CUDA Memory Ordering × Async GPU/NIC Overlap × Transfer Cost Model`

目標回答：

1000 個碎片化 KV descriptors
→ 應逐一 post 還是 SGL/coalesce？
→ memory registration 是否 cache hit？
→ NIC queue 如何批次化？
→ GPU compute 能否與 RDMA overlap？
→ 哪個 event/stream/barrier 決定 Attention kernel 可安全開始？

## Knowledge Graph 新增 Node / Edge

### Nodes
- UCXMemoryRegistration
- UCXRegisteredMemoryHandle
- PackedRemoteKey
- EndpointRemoteKey
- TransportCapabilityDiscovery
- GPUDirectRDMAEligibility
- HostStagingFallback
- DescriptorBatch
- UCXSGL
- EndpointFlush
- TransportProgressEngine
- RDMACompletion
- ComputeVisibilityBarrier
- ConsumerKernelDependency
- RegistrationCache
- TransferPostLatency
- DescriptorFragmentation

### Edges
- RegisteredMemoryRegion → registered_by → UCXMemoryRegistration
- UCXMemoryRegistration → produces → UCXRegisteredMemoryHandle
- UCXRegisteredMemoryHandle → packed_as → PackedRemoteKey
- PackedRemoteKey → loaded_as → EndpointRemoteKey
- TransferDescriptor → authorized_by → EndpointRemoteKey
- DescriptorBatch → submitted_to → UCXEndpoint
- UCXEndpoint → executes → RDMAReadWrite
- RDMAReadWrite → finalized_by → EndpointFlush
- EndpointFlush → observed_by → TransportProgressEngine
- TransportProgressEngine → produces → RDMACompletion
- RDMACompletion → requires_before_compute → ComputeVisibilityBarrier
- ComputeVisibilityBarrier → enables → ConsumerKernelDependency
- TransportCapabilityDiscovery → determines → GPUDirectRDMAEligibility
- GPUDirectRDMAEligibility(false) → routes_to → HostStagingFallback

## 本輪結束判斷

缺哪一層：`CUDA/NIC concurrency + exact memory-ordering handoff`。

哪個節點最淺：`RegistrationCache` 與 `ComputeVisibilityBarrier`。

哪個概念仍只是名詞：跨 UCX transport 的 `NICQueueExecutionModel`。

哪個系統最值得讀原始碼：NIXL `src/plugins/ucx/`，尤其 `ucx_sgl.cpp`、`ucx_backend_req.h` 與 rkey lifecycle。

哪篇資料需追引用/延伸：NVIDIA GPUDirect RDMA memory-ordering章節，以及 UCX CUDA-memory registration implementation。

哪個概念最適合視覺模擬：`Descriptor → rkey → RDMA → flush → CUDA barrier → Attention`。

哪個 Agent 架構最值得實作：目前仍是 Hermes 的 `Physical Execution Planner + Telemetry Feedback Loop`，但下一步要新增 `Transport Planner`，讓 Agent Runtime能依 descriptor fragmentation、registration state、NIC/GPU topology 與 transfer size 選 transport/batching strategy。

## AI 到底怎麼運作：本輪補上的鏈

使用者輸入 / 圖像
→ Agent / Context
→ Model Prefill
→ KV State
→ Distributed KV Identity
→ Physical KV Address
→ NIXL Descriptor
→ UCX Memory Registration
→ rkey
→ RDMA READ/WRITE
→ NIC / PCIe
→ Remote GPU VRAM
→ Transfer Completion
→ CUDA Visibility Barrier
→ Attention Kernel
→ Logits / Output

這輪把「遠端 GPU 上有 KV」從抽象 distributed cache，繼續還原成真正的 memory capability、RDMA operation 與 compute-visible synchronization。