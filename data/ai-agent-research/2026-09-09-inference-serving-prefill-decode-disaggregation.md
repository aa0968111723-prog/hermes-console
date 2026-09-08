# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 00:53（Asia/Taipei）**

**本輪主題：Inference Infrastructure × Continuous Batching × Chunked Prefill × Prefill/Decode Disaggregation × KV Transfer × Multimodal EPD**

## 與歷史研究比較

本輪直接接續 `2026-09-08-long-context-rope-kv-cache-context-utilization.md`。上一輪已回答「Context 經 RoPE / Attention 之後如何形成 KV Cache，以及 PagedAttention / Prefix Caching 如何管理 KV」；本輪不再重複 KV 的定義，而是往 **serving system** 下鑽：多個 Agent request 同時抵達後，Scheduler 如何組 batch、為何 long prefill 會干擾 decode、chunked prefill 如何降低 stall、為何 Prefill/Decode 需要分離、KV 如何跨 GPU/節點傳輸，以及多模態為何自然演化成 Encode→Prefill→Decode 三階段分離。

---

## 本小時新發現

1. **vLLM V1 Scheduler 已把 token budget、running/waiting queue、KV Connector、encoder cache、multimodal budget、async KV loading 放進同一個核心 Scheduler。** 這證明 production inference scheduler 已不只是「排隊器」，而是 request admission + token budgeting + KV residency + remote transfer + multimodal compute 的共同控制面。
2. **2026 vLLM 已正式具有 disaggregated encoder（E→PD 或 E→P→D）與 KV/EC transfer abstraction。** 多模態 serving 不再只是論文原型。
3. **DistServe / Splitwise 的核心不是單純「兩台 GPU 比一台快」，而是 Prefill 與 Decode 的 bottleneck 不同：Prefill 更 compute-intensive；Decode 在常見 batch 區間更受 memory/KV bandwidth 支配。** 因而兩者的最佳 parallelism、硬體、batching、SLO 都不同。
4. **2026 NSDI 的 Libra 把 request segmentation 再往前推：request 可在 token boundary 被切成 micro-request 並跨 instance 執行，配合 chunked KV transfer。** 這代表「P/D 是固定兩階段」正在演進為更一般化的 request partitioning runtime。
5. **多模態 EPD（Encode-Prefill-Decode）已成為一條獨立 serving research branch。** EPDServe、HydraInfer、2026 EPD-Serve 都顯示 vision/audio/video encoder 本身有獨立的 compute/memory/cache/parallelism 特徵，應與 language prefill/decode 分開建模。

---

# 本小時最重要 5 個發現

## 1. Continuous Batching 的底層改變，是把 scheduling granularity 從 request 降到 iteration/token step

### 已確認事實
Orca（OSDI 2022）提出 iteration-level scheduling：Scheduler 不再等一整批 request 全部完成，才換下一批；而是在每個模型 iteration 重新決定 batch 成員。已完成 request 可以退出，新 request 可以進入。

```text
Static batch
R1 ───────────── done
R2 ───────────────────── done
R3 ───── done

GPU 必須等整批生命周期
```

變成：

```text
Iteration 1: [R1 R2 R3]
Iteration 2: [R1 R2 R3]
R3 done
Iteration 3: [R1 R2 R4]
R1 done
Iteration 4: [R5 R2 R4]
```

### 底層如何運作
每輪 decode，每個 active request 通常只新增極少 token，因此 Scheduler 可以在 iteration boundary 更新：

```text
finished requests
+ waiting requests
+ KV capacity
+ token budget
+ SLO / priority
↓
next model batch
```

### 為什麼重要
Agent workload 特別適合 continuous batching，因為 output length、tool-call stop point、reasoning length 都高度不確定。Request-level static batch 會造成短 Agent call 被長 Agent call 拖住。

### 限制
Continuous batching 不代表所有 operation 都可以任意混合；不同 sequence length、prefill/decode 混合、MoE routing、multimodal encoder 等都會造成 kernel/shape/資源效率差異。

來源：
- Orca: https://www.usenix.org/conference/osdi22/presentation/yu
- vLLM Scheduler source: https://github.com/vllm-project/vllm/blob/main/vllm/v1/core/sched/scheduler.py

---

## 2. Chunked Prefill 是「把一個巨大 compute burst 切成可排程的 token work units」

### 已確認事實
Sarathi-Serve（OSDI 2024）指出完整 long-prompt prefill 雖然 GPU utilization 高，但會長時間占據 GPU，讓 ongoing decode 停頓，造成 Time-Between-Tokens / TPOT tail latency 抖動。

原本：

```text
Decode R1 R2 R3
↓
Long Prefill R4 (8192 tokens)
████████████████████
↓
Decode R1 R2 R3 resumes
```

Chunked prefill：

```text
Iteration A
Decode tokens + Prefill chunk 1

Iteration B
Decode tokens + Prefill chunk 2

Iteration C
Decode tokens + Prefill chunk 3
```

Scheduler 透過 token budget 決定每輪能塞多少 prefill token。

### 底層机制

```text
max_num_batched_tokens = B
running decode cost = D
remaining budget = B - D

prefill_chunk = min(remaining_prompt_tokens, remaining budget)
```

因此 prefill 從 atomic operation 變成 resumable work。

### vLLM 工程驗證
目前 vLLM `SchedulerConfig` 已有 `max_num_batched_tokens`、`long_prefill_token_threshold`、`max_num_scheduled_tokens`、`prefill_schedule_interval` 等控制項；V1 Scheduler 本身維護 running/waiting queues 與 token scheduling constraints。

### 為什麼重要
這其實是 Agent Runtime 與 GPU Scheduler 的鏡像：上層 Agent 把 task 切成 DAG node；下層 inference runtime 把 prompt 計算切成 token chunks。兩層都在做「把不可搶占的大工作變成可重新排程的小工作」。

### 限制
Chunking 有額外 overhead；MoE 模型還可能因 chunk boundary 造成 expert weights 重複載入。2025 的 Layered Prefill 因此提出沿 layer 維度切，而不是只沿 token 維度切。

來源：
- Sarathi-Serve: https://arxiv.org/abs/2403.02310
- vLLM Scheduler config: https://docs.vllm.ai/en/stable/api/vllm/config/scheduler/

---

## 3. Prefill 與 Decode 是兩個不同 hardware personalities，這是 P/D disaggregation 的真正理由

### 已確認事實
Splitwise 與 DistServe 都指出：

```text
Prefill
- 一次處理大量 prompt tokens
- 大矩陣運算密集
- 通常更 compute-intensive
- 主要 SLO: TTFT

Decode
- 每 request 每 iteration 通常只新增一個 token
- 反覆讀 model weights + historical KV
- 常受 memory bandwidth / KV residency 影響
- 主要 SLO: TPOT / ITL
```

如果 colocate：

```text
GPU
├ long prefill burst
└ ongoing decode

→ prefill/decode interference
```

Disaggregate：

```text
Ingress
↓
Prefill Pool
↓ KV transfer
Decode Pool
↓
Streaming Tokens
```

### DistServe 的 system architecture

```text
Request Router
↓
Prefill Worker Group
├ chosen TP/PP
├ prompt compute
└ produce KV
↓ high-bandwidth transfer
Decode Worker Group
├ independent parallelism
├ continuous batching
└ autoregressive generation
```

它的 optimization target 不是單純 throughput，而是 **goodput under TTFT + TPOT SLO**。

### 論文結果（特定實驗設定）
DistServe 論文報告最高可在其 workload/SLO 設定下服務 7.4× 更多 requests，或達成 12.6× tighter SLO；Splitwise 報告可達 1.4× throughput 且降低約 20% cost，或在相同 cost/power 下達 2.35× throughput。這些數字不可直接外推到所有模型與叢集。

### 限制
Disaggregation 新增：

```text
KV serialization / address mapping
network transfer
receiver allocation
synchronization
routing imbalance
P:D resource ratio
```

所以它不是免費優化。若 network 慢、prompt 短或 concurrency 低，transfer overhead 可能抵消收益。

來源：
- DistServe: https://arxiv.org/abs/2401.09670
- Splitwise: https://arxiv.org/abs/2311.18677
- vLLM disaggregated prefill: https://docs.vllm.ai/en/latest/features/disagg_prefill/

---

## 4. KV Transfer 是 P/D disaggregation 的資料平面，不只是「把 cache 複製過去」

### vLLM 原始碼已確認
最新 `vllm/v1/core/sched/scheduler.py` 在 Scheduler 初始化時可建立 `KVConnector`；註解明確寫明 connector 處理 P/D 與 offloading 的 remote KV push/pull。Scheduler 還要追蹤 async KV receiving 的完成/失敗狀態。

此外 source tree 已包含：

```text
vllm/distributed/kv_transfer/
└ kv_connector/v1/
   ├ nixl/
   │  ├ push_scheduler.py
   │  ├ pull_scheduler.py
   │  └ base_scheduler.py
   ├ offloading/
   └ decode_bench_connector.py
```

NIXL connector 已區分 push（WRITE-based transfer）與 pull（READ-based transfer）。

### Bottom-level data path

```text
Prefill GPU
↓
KV blocks allocated
↓
block metadata / request mapping
↓
Connector handshake
↓
RDMA / high-speed interconnect / external KV store
↓
Decode GPU reserves destination blocks
↓
KV arrives
↓
Scheduler marks request KV-ready
↓
Decode request becomes runnable
```

因此 request 在 P/D Runtime 中至少有：

```text
PREFILL_PENDING
PREFILL_RUNNING
KV_TRANSFER_PENDING
KV_READY
DECODE_RUNNING
FINISHED
```

### 新的重要區分

```text
Compute scheduling
≠ KV placement
≠ KV transport
≠ Request routing
```

它們是四個不同 control/data-plane 問題。

### 2026 新進展
vLLM 的 MooncakeStoreConnector 已能把 direct P2P KV transfer 與 shared distributed KV store 組合，讓 P/D transfer 與跨 instance prefix-cache sharing 同時存在。

來源：
- vLLM source: https://github.com/vllm-project/vllm/blob/main/vllm/v1/core/sched/scheduler.py
- NIXL / KV connector docs: https://docs.vllm.ai/en/latest/features/disagg_prefill/
- MooncakeStoreConnector: https://docs.vllm.ai/en/latest/features/mooncake_store_connector_usage/

---

## 5. 多模態 serving 的完整底層不是 P→D，而是 E→P→D

### 已確認事實
對 VLM / LMM：

```text
Image / Video / Audio
↓
Modality Encoder
↓
Encoder embeddings / modality tokens
↓
Language-model Prefill
↓
Language KV Cache
↓
Decode
```

Encode 與 Prefill 並不具有完全相同的資源特性。圖片數量、解析度、video frames、audio length 都可能使 encoder 成為獨立 bottleneck。

### EPDServe architecture
直接閱讀 `vbdi/epdserve` repository 後，可看到其核心不只 README，而是已拆成：

```text
epdserve/
├ orchestrator.py
├ engine_encoding.py
├ engine_context.py
├ engine_decoding.py
├ engine_common.py
├ block_manager.py
├ request.py
├ scheduler*.py / routing related modules
└ api_server.py
```

也就是 Encode / Context(Prefill) / Decoding 在 code level 就是不同 engine。

### vLLM 2026 現況
vLLM 的 disaggregated encoder 文件已支援：

```text
E → PD
```

或：

```text
E → P → D
```

並以 `ECConnector` 傳 encoder-cache embeddings；程式碼位於 `vllm/distributed/ec_transfer`。這表示 multimodal encoder-cache 和 language KV-cache 已成為兩個不同 transfer plane。

### 論文結果（特定設定）
EPD 論文報告其測試中可降低 encoder 相關 memory pressure、增加 batch/image capacity，並改善 TTFT/throughput；2026 的 EPD-Serve 也在 Ascend 系統上研究 asynchronous feature prefetch + grouped KV transmission。不可將具體百分比直接泛化到 Hermes 使用的任何未指定模型/硬體。

### 為什麼重要
Hermes 最終多模態 Knowledge Graph 應從：

```text
Image → VLM → Text
```

改成：

```text
Image/Video/Audio
↓
Preprocessor
↓
Encoder Scheduler
↓
Encoder Cache
↓ transfer
Prefill Scheduler
↓
KV Cache
↓ transfer / residency
Decode Scheduler
↓
Output
```

來源：
- EPD paper: https://arxiv.org/abs/2501.05460
- EPDServe code: https://github.com/vbdi/epdserve
- vLLM disaggregated encoder: https://docs.vllm.ai/en/latest/features/disagg_encoder/

---

# Architecture Breakdown

## Monolithic serving

```text
Requests
↓
Single Scheduler
↓
GPU Pool
├ Prefill
└ Decode
↓
Output
```

## Modern text LLM serving

```text
Ingress / Router
↓
Admission Control
↓
Global Queue
↓
Prefill Scheduler
├ continuous batching
├ chunked prefill
├ prefix-cache lookup
└ token budget
↓
Prefill GPU Pool
↓
KV Transfer Plane
├ P2P / NIXL
├ RDMA
├ shared KV store
└ offload
↓
Decode Scheduler
├ active sequence set
├ iteration-level batching
├ KV block residency
└ TPOT SLO
↓
Decode GPU Pool
↓
Streaming Output
```

## Multimodal serving

```text
Camera / Image / Video / Audio
↓
Ingress
↓
Encoder Router
↓
Encoder GPU Pool
↓
Encoder Cache (EC)
↓ EC transfer
Prefill Pool
↓
Language KV
↓ KV transfer
Decode Pool
↓
Tokens / Actions
```

### 控制面 vs 資料面

```text
CONTROL PLANE
Router
Scheduler
SLO controller
Autoscaler
Placement
Admission

DATA PLANE
Tokens
Encoder embeddings
KV blocks
Model weights
Network transfer
Output tokens
```

Hermes Console 的 inference 模擬應把這兩層分開。

---

# Bottom-Level Logic：一個 Agent request 如何在 GPU cluster 中走完

```text
1. Agent Runtime 建 model request
2. API gateway 收 request
3. Router 選 serving pool
4. Scheduler 建 Request state
5. prefix cache lookup
6. 計算 remaining prefill tokens
7. token-budget admission
8. chunked prefill scheduling
9. GPU executes prefill chunk(s)
10. K/V 寫入 local KV blocks
11. prefill completes
12. connector 建 KV transfer metadata
13. destination decode worker reserve blocks
14. transfer KV blocks
15. decode scheduler 標記 KV_READY
16. request 加入 active decode batch
17. 每 iteration 產生 next token
18. finished sequence 從 batch 移除
19. 新 waiting request 補入
20. output token stream 回 Agent Runtime
21. EOS/tool-call stop
22. KV blocks free/cache/offload
```

對多模態，再在第 5 步之前加入：

```text
Image / Video
↓ preprocess
Encoder batching
↓ encoder GPU
modality embeddings
↓ EC cache / transfer
language token insertion
↓ prefill
```

---

# Visual Simulation Idea

## **Inference Cluster X-Ray**

Hermes Console 建議新增四泳道：

```text
REQUEST QUEUE | PREFILL GPUs | KV FABRIC | DECODE GPUs
```

每個 request 顯示：

```text
request_id
input tokens
output tokens generated
phase
TTFT
TPOT
queue wait
prefill chunks
KV size
KV location
transfer bytes
prefix-cache hit
GPU worker
SLO status
```

### 互動模式

1. **Monolithic vs P/D Disaggregation**
2. **Full Prefill vs Chunked Prefill**
3. **Static Batch vs Continuous Batch**
4. **P/D vs E/P/D Multimodal**

### Failure / bottleneck injection

```text
Long 128K prompt arrives
KV network bandwidth drops
Decode GPU KV pool full
Prefix cache miss burst
10-image multimodal request arrives
Prefill pool overloaded
Decode pool underutilized
```

UI 直接顯示：

```text
TTFT ↑
TPOT ↑
GPU Compute Utilization
HBM Bandwidth
KV Occupancy
Network GB/s
Queue Depth
Goodput
```

最有教育價值的一個動畫：

```text
128K prompt enters monolithic GPU
→ decode requests stall

switch Chunked Prefill
→ stall 被切碎

switch P/D
→ decode interference 幾乎移到 network/KV-transfer boundary
```

讓使用者看到「效能瓶頸不是消失，而是在 architecture 中移動」。

---

# Code / GitHub

## vLLM（本輪最值得繼續讀）

```text
vllm/v1/core/sched/scheduler.py
vllm/config/scheduler.py
vllm/v1/core/kv_cache_manager.py
vllm/distributed/kv_transfer/
vllm/distributed/ec_transfer/
```

已確認 `Scheduler` 同時初始化/管理：
- running / waiting request queues
- max scheduled token budget
- KVCacheManager
- KVConnector（P/D + offload）
- ECConnector（multimodal encoder cache transfer）
- EncoderCacheManager
- multimodal encoder compute budget
- async KV receiving state

這使它成為目前最值得 Hermes 持續追蹤的 inference-control-plane 原始碼。

## DistServe

值得看的 repository：
`https://github.com/LLMServe/DistServe`

重點：
- `distserve/api_server/`
- online/offline examples
- SwiftTransformer backend
- P/D parallelism and scheduling configuration
- KV communication path

## EPDServe

值得看的目錄/檔案：

```text
epdserve/orchestrator.py
epdserve/engine_encoding.py
epdserve/engine_context.py
epdserve/engine_decoding.py
epdserve/block_manager.py
epdserve/request.py
epdserve/api_server.py
csrc/
```

它是目前很適合研究「multimodal pipeline 為何需要 stage disaggregation」的原始碼節點。

---

# Papers

## 1. Orca: A Distributed Serving System for Transformer-Based Generative Models
- **Authors:** Gyeong-In Yu, Joo Seong Jeong, Geon-Woo Kim, Soojeong Kim, Byung-Gon Chun
- **Institution:** Seoul National University 等
- **Year:** 2022
- **URL:** https://www.usenix.org/conference/osdi22/presentation/yu
- **Architecture:** iteration-level scheduling + selective batching
- **Contribution:** 將 batching 從 request lifecycle 改成 iteration granularity。
- **Limitations:** 發表時尚未包含後來 PagedAttention / P-D disaggregation 等完整現代 stack。
- **改變了什麼:** 為 continuous batching 打下 scheduling 基礎。

## 2. Taming Throughput-Latency Tradeoff in LLM Inference with Sarathi-Serve
- **Authors:** Amey Agrawal, Nitin Kedia, Ashish Panwar, Jayashree Mohan, Nipun Kwatra, Bhargav S. Gulavani, Alexey Tumanov, Ramachandran Ramjee
- **Institution:** Microsoft / Georgia Tech 等
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2403.02310
- **Code:** https://github.com/microsoft/sarathi-serve
- **Architecture:** chunked prefill + stall-free scheduling
- **Contribution:** 將 prefill 變成可切割、可與 decode 共批的 work unit。
- **Limitations:** chunking 本身有 overhead，MoE / 新硬體上的最佳 chunk strategy 仍會變動。
- **改變了什麼:** 把 TTFT vs TPOT trade-off 從「二選一」推向可調 scheduling frontier。

## 3. DistServe: Disaggregating Prefill and Decoding for Goodput-optimized LLM Serving
- **Authors:** Yinmin Zhong, Shengyu Liu, Junda Chen, Jianbo Hu, Yibo Zhu, Xuanzhe Liu, Xin Jin, Hao Zhang
- **Institution:** Peking University / UC Merced 等
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2401.09670
- **Code:** https://github.com/LLMServe/DistServe
- **Architecture:** dedicated Prefill GPU pool + Decode GPU pool + KV transfer
- **Contribution:** 將 TTFT / TPOT 與 P/D resource planning 解耦。
- **Limitations:** KV network cost、P:D ratio、workload shift 會使靜態分配失衡。
- **改變了什麼:** 將 LLM serving 從單一 GPU-worker abstraction 推成 phase-specialized cluster。

## 4. Splitwise: Efficient generative LLM inference using phase splitting
- **Authors:** Pratyush Patel et al.
- **Institution:** Microsoft Research
- **Year:** 2023
- **URL:** https://arxiv.org/abs/2311.18677
- **Architecture:** prompt-compute / token-generation phase splitting，可使用不同硬體類型
- **Contribution:** 從功耗、成本與硬體特徵證明 phase specialization 的價值。
- **Limitations:** 依賴高速 interconnect 與工作負載特性。
- **改變了什麼:** 把 P/D 分離從 scheduling 問題提升成 cluster hardware provisioning 問題。

## 5. Efficiently Serving Large Multimodal Models Using EPD Disaggregation
- **Authors:** Gursimran Singh et al.
- **Year:** 2025（論文最早版本 2024-12）
- **URL:** https://arxiv.org/abs/2501.05460
- **Code:** https://github.com/vbdi/epdserve
- **Architecture:** Encode → Prefill → Decode 三階段分離
- **Contribution:** 把 multimodal encoder 從 prefill 拆出，獨立 resource allocation / batching / cache transfer。
- **Limitations:** performance gain 依模型、圖像數量、encoder/LLM ratio、GPU topology 而異。
- **改變了什麼:** 將多模態 serving 從「LLM 前多一個 vision encoder」轉成真正三階段 distributed pipeline。

## 6. Libra: Flexible Request Partitioning and Scheduling for Serving Unbalanced and Dynamic LLM Workloads
- **Authors:** Chaoyi Ruan et al.
- **Year:** 2026, NSDI
- **URL:** https://www.usenix.org/conference/nsdi26/presentation/ruan-libra
- **Architecture:** request micro-segments + global/local scheduler + chunked KV transfer
- **Contribution:** 不再把 P/D boundary 視為唯一切點，而允許 token boundary 上更彈性的跨 instance partition。
- **Limitations:** 增加 scheduling 與 KV transfer complexity。
- **改變了什麼:** 指向「phase disaggregation → general request partitioning」的新方向。

---

# Unknown / Open Questions

1. **最優 P:D:E 資源比例如何在線決定？** 靜態配置遇到 Agent workload（短工具問答、128K research context、圖片/影片輸入）會快速失衡。2025/2026 已出現 dynamic P/D ratio、token-velocity autoscaling 等工作，但尚未形成單一標準 runtime。
2. **KV transfer 何時比 recompute 更划算？** 應依 KV bytes、network bandwidth、GPU compute price、prefix hit、destination locality 做 cost model；不是所有 cache 都值得跨網路搬。
3. **Agent-aware serving 應不應把 tool-wait time 納入 GPU scheduler？** Agent 常在模型→tool→模型之間暫停，若能預測 tool latency，也許可以做跨 inference/tool runtime 的 end-to-end scheduling。這目前仍屬合理工程假說，需 benchmark 驗證。

---

# Knowledge Graph 新增 Node / Edge

新增 Node：

```text
Inference Serving Runtime
├ Request Router
├ Admission Control
├ Continuous Batching
├ Token Budget
├ Chunked Prefill
├ Prefill Pool
├ Decode Pool
├ Encoder Pool
├ SLO Controller
├ Autoscaler
└ Goodput

KV Transfer Runtime
├ KV Producer
├ KV Consumer
├ Connector
├ Transfer Metadata
├ Destination Reservation
├ P2P/RDMA
├ Shared KV Store
└ Transfer Completion

Multimodal Serving
├ Encoder Scheduler
├ Encoder Cache
├ EC Transfer
├ Prefill Scheduler
├ KV Transfer
└ Decode Scheduler
```

新增 Edge：

```text
Context Tokens
→ Prefill Scheduler
→ Prefill GPU
→ KV Cache
→ KV Transfer
→ Decode GPU
→ Output Tokens

Multimodal Input
→ Encoder GPU
→ Encoder Cache
→ EC Transfer
→ Language Prefill

Long Prefill
--interferes with-->
Decode TPOT

Chunked Prefill
--reduces-->
Decode Stall

P/D Disaggregation
--trades compute interference for-->
KV Network Cost

Agent Workload Mix
--changes-->
Optimal E:P:D Ratio
```

---

# 下一輪研究

下一輪最值得進入：

## **GPU Kernel × HBM × Tensor Core × Roofline × Attention/FFN/MoE Bottleneck**

把這輪的：

```text
Scheduler
↓
GPU executes prefill/decode
```

再往晶片內拆：

```text
CUDA kernel launch
↓
HBM → L2 → SRAM/Register
↓
GEMM / Tensor Core
↓
Attention QKᵀ
↓
Softmax
↓
AV
↓
FFN / MoE
↓
AllReduce / AllToAll
↓
HBM writeback
```

核心要回答：
- 為什麼 prefill 常 compute-bound、decode 常 memory-bound？
- Arithmetic intensity 到底如何決定 bottleneck？
- Attention、FFN、MoE 各自吃的是 FLOPs、HBM 還是 network？
- Tensor Parallel / Pipeline Parallel / Expert Parallel 的通信成本在哪裡？
- FlashAttention 為什麼不是「少算 attention」，而是少搬資料？
- H100/H200/B200 類 GPU 的 HBM bandwidth、Tensor Core throughput 如何映射到 TTFT/TPOT？

---

# 本輪收斂檢查

- **缺哪一層：** GPU kernel / memory hierarchy / inter-GPU communication。
- **哪個節點最淺：** KV transfer cost model 與 online E:P:D resource controller。
- **哪個概念仍只是名詞：** Goodput-aware Agent serving；目前尚未把 Agent tool-wait / multi-turn state 納入正式模型。
- **哪個系統值得讀原始碼：** vLLM `Scheduler` + `kv_transfer` + `ec_transfer`；其次 EPDServe `orchestrator.py` / 三個 engine。
- **哪篇論文需追引用：** DistServe → Libra / dynamic PD disaggregation；EPD → 2026 EPD-Serve。
- **哪個概念最適合視覺模擬：** Inference Cluster X-Ray。
- **哪個 Agent 架構最值得實作：** Hermes 不需要自己重寫 GPU serving engine；更值得實作的是 **Agent-aware Model Router + inference telemetry adapter**，讀 TTFT/TPOT/KV pressure/queue depth 後選擇 model endpoint 或 serving pool。

## 本輪核心結論

> **模型推理不是「request 送進 GPU 然後 GPU 回答案」。Production inference 是一個持續排程的資料流系統：Scheduler 將 token work 切碎並混批，Prefill 把 context 編譯成 KV，KV 再被搬到適合 Decode 的 worker；多模態則在前面再多一個獨立 Encoder/Encoder-Cache 階段。效能最佳化的本質，是讓 compute、HBM、KV memory、network 與 SLO 在不同階段各自匹配，而不是單純追求更大的 GPU utilization。**
