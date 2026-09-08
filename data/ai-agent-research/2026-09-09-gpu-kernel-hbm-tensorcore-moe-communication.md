# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 01:54（Asia/Taipei）**

**本輪主題：GPU Kernel × HBM × Tensor Core × Roofline × Attention/FFN/MoE × AllReduce/AllToAll**

## 與歷史研究比較

本輪直接接續 `2026-09-09-inference-serving-prefill-decode-disaggregation.md`。上一輪已回答 request queue、continuous batching、chunked prefill、P/D/E-P-D 分離與 KV transfer；本輪不再重複 Scheduler 或 KV transfer，而是把上一輪最後仍是黑盒子的：

```text
Scheduler
↓
GPU executes model
```

往晶片與 kernel 層拆成：

```text
CUDA / Triton Kernel
↓
HBM ↔ L2 ↔ Shared Memory / Registers
↓
Tensor Core / CUDA Core
↓
Attention / GEMM / Activation / Normalization
↓
Tensor Parallel collectives / Expert Parallel collectives
↓
HBM writeback
```

核心問題是：**同樣一個 Transformer layer，為什麼 prefill、decode、dense FFN、MoE、long attention 在硬體上的 bottleneck 完全不同？**

---

## 本小時新發現

1. **GPU 峰值 FLOPS 不是 LLM 速度。** Roofline 模型必須同時看 arithmetic intensity（FLOPs / bytes moved）與 HBM bandwidth；當 kernel 的 arithmetic intensity 低於 ridge point，再多 Tensor Core 峰值也無法被充分利用。
2. **FlashAttention 真正省的是 HBM↔on-chip memory 的資料移動，而不是把 exact attention 的數學 FLOPs 從 O(N²) 變掉。** FA3 更進一步利用 Hopper Tensor Core / TMA 的非同步能力，把 data movement、matmul、softmax pipeline overlap 起來。
3. **Decode 常見 memory-bound 的根本原因不是「一次只算一 token」這句口號，而是每個 decode step 的 GEMM reuse 很低：要反覆讀大量 model weights / KV，卻只替少量 token 做計算。** Batch 增大後 arithmetic intensity 才提高，因此 decode bottleneck 會隨 batch、quantization、GQA/MQA、模型形狀改變。
4. **Tensor Parallel 與 Expert Parallel 的通信型態不同。** TP 常需要 AllReduce / ReduceScatter / AllGather；MoE EP 則要把 token 按 router 決策 Dispatch 到不同 expert，再 Combine 回來，核心 bottleneck 常變成 AllToAll + token imbalance + grouped GEMM。
5. **2026 production stack 已開始把 kernel 與 communication overlap 做到更細粒度。** Megatron Core 的 TP mapping 有 async all-reduce / reduce-scatter / all-gather / all-to-all；MoE layer 明確拆 Routing→Dispatch→Expert Compute→Combine。這說明模型層的「一個 FFN」在分散式硬體上其實是 compute graph + communication graph。

---

# 本小時最重要 5 個發現

## 1. Roofline：AI kernel 到底是「算不夠快」還是「資料搬不夠快」

### 概念
Roofline model 的核心不是用一個 FLOPS 數字評價 GPU，而是：

```text
Attainable Performance
≈ min(
  Peak Compute,
  Memory Bandwidth × Arithmetic Intensity
)
```

其中：

```text
Arithmetic Intensity
= FLOPs / Bytes moved from main memory
```

如果一個 kernel 每搬 1 byte 只做很少 FLOPs，就會先撞到 HBM bandwidth ceiling；如果每 byte 能重複做大量數學運算，才可能逼近 Tensor Core compute ceiling。

### 已確認官方硬體事實
NVIDIA H100 SXM 官方規格：80 GB HBM3、3.35 TB/s GPU memory bandwidth，FP16/BF16 Tensor Core 峰值（標註 sparsity）1,979 TFLOPS；官方註記 dense 約為表列 sparse 數字的一半。

HGX B200 官方 reference architecture：每 GPU 180 GB HBM3e、最高約 8 TB/s bandwidth；8-GPU node 約 1.44 TB HBM、64 TB/s aggregate HBM bandwidth。

### 合理工程推論
以 H100 dense BF16 約 989.5 TFLOPS / 3.35 TB/s 粗估，ridge point 約：

```text
~295 FLOP / byte
```

這不是實際 kernel benchmark，只是 roofline 級估算；實際有效峰值會受 kernel shape、occupancy、instruction mix、clock、quantization、cache hit、通信與軟體效率影響。

### 為什麼重要
這直接解釋：

```text
Prefill large GEMM
→ 通常 arithmetic intensity 高
→ 更容易 compute-bound

Decode tiny-batch GEMM / GEMV-like work
→ reuse 低
→ 更容易 memory-bound
```

所以「買更多 TFLOPS」並不一定等比例改善 decode；提高 HBM bandwidth、batch size、quantization、weight reuse 反而可能更重要。

### 限制
「Prefill = compute-bound、Decode = memory-bound」是常見 regime，不是宇宙定律；batch、sequence、MoE、KV dtype、GPU 世代與 kernel fusion 都可能讓 operating point 跨過 roofline ridge。

來源：
- NVIDIA H100 specs: https://www.nvidia.com/en-eu/data-center/h100/
- NVIDIA HGX H100/H200/B200 reference architecture: https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory-h100-h200-b200/latest/components.html

---

## 2. FlashAttention：真正優化的是 IO complexity，不是把 exact attention 的數學定義改掉

### 標準 Attention 的 naïve dataflow

```text
Q, K
↓ GEMM
S = QKᵀ            [N × N]
↓ write HBM
↓ read HBM
softmax(S)
↓ write HBM
↓ read HBM
P V
↓
Output
```

問題不只有 `N²` FLOPs；中間 `N×N` attention matrix 的 HBM round-trip 也非常昂貴。

### FlashAttention 底層
FlashAttention 將 Q/K/V 分塊：

```text
HBM
↓ load tile
On-chip SRAM / shared memory
↓
Q_tile × K_tile
↓
online softmax statistics
↓
accumulate O_tile
↓
next K/V tile
↓
final output write HBM
```

關鍵是 **tiling + online softmax**，避免把完整 attention matrix materialize 到 HBM。原始論文稱其為 IO-aware exact attention，並分析 HBM access complexity。

### FlashAttention-3 再往下一層
Hopper 提供 Tensor Memory Accelerator (TMA) 與更強的 asynchronous Tensor Core execution。FA3 做：

```text
Warp group A: move next tile
Warp group B: Tensor Core matmul
Warp group C / pipeline: softmax / correction

↓ overlap
Data movement ∥ compute
```

並加入 FP8 attention path。FA3 論文在 H100 報告 FP16 attention 可達約 740 TFLOPS/s、約 75% utilization，FP8 接近 1.2 PFLOPS/s；這是特定 kernel / shape 實驗結果。

### 工程驗證：vLLM
目前 vLLM `vllm/v1/attention/backends/flash_attn.py` 已不是單一 FA2 wrapper。它有：

```text
get_flash_attn_version()
FA4_HD256_PAGE_SIZE
uses_fa4_hd256_kernel()
FP8 KV cache dtype
per-head quant scales (FA>=3)
context-parallel attention ops
sliding window / attention sink
multimodal prefix support (FA4)
```

這顯示 serving runtime 的 attention backend 已同時承擔：kernel version dispatch、KV layout compatibility、quantization、context parallel 與特殊 attention semantics。

### 為什麼重要
AI Agent 的 long context latency 不只由「attention O(N²)」決定；真正 wall-clock 還取決於 attention kernel 如何在 HBM、L2、shared memory、Tensor Core 之間搬 tile。

來源：
- FlashAttention: https://arxiv.org/abs/2205.14135
- FlashAttention-3: https://arxiv.org/abs/2407.08608
- vLLM source: `vllm/v1/attention/backends/flash_attn.py`

---

## 3. Transformer layer 在 GPU 上主要是「大 GEMM + 小但頻繁的 memory / vector ops + attention」

### Dense Transformer block 的底層 dataflow

```text
Hidden State X
↓ RMSNorm / LayerNorm
↓ QKV Projection GEMM
Q, K, V
↓ RoPE
↓ Attention kernel
↓ Output Projection GEMM
↓ Residual Add
↓ RMSNorm
↓ FFN GEMM 1
↓ Activation / Gating (SiLU / GELU / SwiGLU)
↓ FFN GEMM 2
↓ Residual Add
```

從硬體角度：

```text
Large Linear / FFN
→ Tensor Core GEMM

Norm / RoPE / Activation / Residual
→ vector / memory-oriented kernels

Attention
→ GEMM + reduction + softmax + IO orchestration
```

如果每一小步都獨立 launch kernel：

```text
HBM read
kernel
HBM write
HBM read
next kernel
HBM write
```

會有大量 launch + memory traffic，因此 production kernels 常做 fusion，例如 RMSNorm+residual、activation+gating、quantize+GEMM preparation。

### Bottom-level mechanism：為什麼 FFN 常佔大量 compute
對 standard dense FFN：

```text
X[d]
→ W1[d × d_ff]
→ activation
→ W2[d_ff × d]
```

通常 `d_ff` 是 `d` 的數倍；因此每 token 的兩個 FFN projection 具有大量矩陣乘法。SwiGLU 還有 gate/up projections，再做 elementwise gating。

### Tensor Core 與 dtype
Tensor Core 是矩陣乘加專用 data path；FP16/BF16/FP8/FP4 等低 precision 能提升 tensor throughput、降低 weight/activation bandwidth，但 precision policy、scale、accumulation dtype 會影響 numerical error。

Blackwell 系統將 FP4/FP8 Tensor Core throughput 與 HBM3e bandwidth 同時大幅提高，代表新瓶頸會繼續往 kernel efficiency、collectives、routing、scheduler 與 data movement 移動，而不是「Tensor Core 越快就一切越快」。

### 限制
模型架構差異很大：MLA、linear attention、SSM/Mamba、MoE、hybrid blocks 都會改變 operator mix。

來源：
- NVIDIA H100 / Blackwell official specs
- vLLM attention backend source

---

## 4. Tensor Parallel 的核心不是「把模型切到多張 GPU」，而是每層 GEMM 與 collective 的交錯

### 典型 Column/Row Parallel Linear
假設線性層：

```text
Y = XW
```

Column-parallel 可把 W 的 output dimension 切到多 GPU：

```text
GPU0: W0
GPU1: W1
GPU2: W2
GPU3: W3

X → each rank
↓ local GEMM
[Y0 Y1 Y2 Y3]
```

後續視 layer layout 需要 AllGather、AllReduce 或 ReduceScatter。

Megatron Core 的 tensor-parallel mapping 已直接定義：

```text
AllReduce
AllGather
ReduceScatter
AllToAll
split / gather along sequence or hidden dim
```

而部分 communication 可以 asynchronous overlap with compute。

### Bottom-level cost model
對多 GPU layer：

```text
Layer Time
≈ max / overlap of
  Local GEMM time
  + Collective communication time
  + synchronization / launch overhead
```

communication time 粗略受：

```text
message bytes
÷ effective NVLink / InfiniBand bandwidth
+ latency
+ topology / algorithm
```

影響。

H100 SXM 官方 NVLink bandwidth 為 900 GB/s；GB200 Superchip 官方為 3.6 TB/s（2-GPU superchip aggregate specification），而 GB200 NVL72 整個 NVLink domain 更大。這些數字與 HBM bandwidth 不可混為一談：

```text
HBM bandwidth
= GPU ↔ local memory

NVLink / network bandwidth
= GPU ↔ GPU / fabric
```

### 為什麼重要
一個模型若被切得太細，local GEMM 變小，communication 比例反而提高。這也是 TP size 不是越大越好的原因。

來源：
- Megatron Core tensor parallel mappings: https://docs.nvidia.com/megatron-core/developer-guide/latest/apidocs/core/core.tensor_parallel.mappings.html
- NVIDIA H100 / GB200 specs

---

## 5. MoE 把 FFN bottleneck 變成「Router → Token Dispatch → Grouped GEMM → Combine」

### Dense FFN

```text
Every token
→ same FFN weights
```

### MoE

```text
Token hidden state
↓ Router logits
↓ Top-k expert selection
↓ Token permutation / bucket
↓ Dispatch to expert owner GPU
↓ Expert FFN
↓ Combine weighted outputs
↓ Restore token order
```

Megatron Core 官方 MoE layer 現在明確定義四步：

```text
1. Routing & Preprocessing
2. Dispatch
3. Expert Computation
4. Combine
```

Expert Parallel 時 Dispatch/Combine 需要 communication collective；文件明確指出可使用 All-to-All。Expert compute 則可使用 GroupedLinear / Grouped GEMM，同時處理多個不同 expert 的小矩陣。

### 為什麼 AllToAll 很關鍵
若每個 GPU 擁有不同 experts：

```text
GPU0 tokens ─┬→ Expert on GPU1
             ├→ Expert on GPU3
             └→ Expert on GPU7
GPU1 tokens ─┬→ ...
```

這不是單純 AllReduce 每張卡得到相同 result，而是每 rank 要把不同 token slice 送到不同 destination。

因此 MoE layer latency 可以拆成：

```text
Router
+ permutation
+ Dispatch AllToAll / AllGather
+ Expert Grouped GEMM
+ Combine collective
+ unpermute
```

並且有另一個非通信瓶頸：**load imbalance**。如果 router 把太多 token 指向少數 experts，某些 GPU 會成為 straggler，其他 GPU 等待。

### 2026 工程趨勢
Megatron Core 的 inference MoE token dispatcher 已提供 NCCL AllGather/ReduceScatter 與 Hopper+ NVLS variable-count dispatcher；這表示 decode 階段每 rank token 數不均的問題已進到專門 runtime path。

2026 HyperParallel-MoE 則在 Ascend NPU 探索把 communication、matrix compute、vector compute 編成 tile-level heterogeneous taskflow，顯示 MoE 最佳化正在從「選一種 collective」往 **fine-grained compute/communication overlap** 演進。

### 限制
MoE 的 routing、capacity、expert placement、quantization、EP/TP 組合與網路 topology 彼此耦合，不能只用「active parameters 比較少」判斷 inference 一定較便宜。

來源：
- Megatron Core MoE layer: https://docs.nvidia.com/megatron-core/developer-guide/latest/apidocs/core/core.transformer.moe.moe_layer.html
- Megatron Core inference token dispatcher: https://docs.nvidia.com/megatron-core/developer-guide/latest/apidocs/core/core.transformer.moe.token_dispatcher_inference.html
- HyperParallel-MoE: https://arxiv.org/abs/2605.23764

---

# Architecture Breakdown

本輪把上一輪 inference stack 的 `GPU Worker` 展開為：

```text
Request Scheduler
↓
Model Runner
↓
Layer N
│
├─ Norm / Residual kernels
│   ↓
│  HBM ↔ L2 ↔ registers
│
├─ Attention
│   ├ QKV projection GEMM
│   ├ RoPE
│   ├ FlashAttention tiles
│   ├ KV read/write
│   └ output projection GEMM
│
├─ FFN / MoE
│   ├ Dense: Tensor Core GEMM
│   │
│   └ MoE:
│       Router
│       ↓
│       Token Dispatch collective
│       ↓
│       Grouped GEMM
│       ↓
│       Combine collective
│
└─ Tensor Parallel communication
    ├ AllReduce
    ├ ReduceScatter
    ├ AllGather
    └ optional AllToAll
↓
Layer N+1
↓
Final Norm
↓
LM Head GEMM
↓
Logits
↓
Sampling
```

跨硬體層則是：

```text
HBM
↕
L2
↕
Shared Memory / Registers
↕
Tensor Core / CUDA Core
↕
NVLink / NVSwitch
↕
Other GPUs
↕
NIC / InfiniBand / Ethernet
↕
Other Nodes
```

這讓整條研究鏈第一次從：

```text
User
→ UI
→ Agent
→ Context
→ Model
→ Scheduler
→ GPU
```

進一步變成：

```text
User
→ UI
→ Agent
→ Context Compiler
→ Tokens
→ Transformer
→ GPU Kernels
→ HBM / Tensor Core
→ Multi-GPU Collectives
→ Logits
→ Sampling
→ Output
```

---

# Bottom-Level Logic

## A. Decode 一 token 的硬體路徑

```text
new hidden state
↓
RMSNorm
↓
QKV linear
  HBM reads weights
  Tensor Core GEMM
↓
RoPE
↓
Attention
  Q_new
  × cached K
  read historical V
↓
output projection
↓
FFN / MoE
↓
LM head
↓
logits
↓
sampling
```

如果 batch 很小：

```text
Huge weight bytes read
÷
Few output-token computations

→ low arithmetic intensity
→ HBM-sensitive
```

如果 batch 增大：同一批 weight tiles 可服務更多 tokens，reuse 提高，kernel 逐漸更接近 GEMM / compute efficient regime。

## B. Prefill 的差異

```text
Many prompt tokens
×
Same weights
↓
Large matrix dimensions
↓
More reuse per weight tile
↓
Higher arithmetic intensity
↓
Tensor Core utilization ↑
```

但 sequence 很長時，attention 的 N² work 與 activation / KV write 又會變成重要成本。

## C. MoE decode 的特殊問題

每 rank decode token 數本來就少，router 再把 token 分到很多 experts 後，每個 expert 的 local batch 可能更碎：

```text
Small batch
↓
Top-k routing
↓
Even smaller tokens/expert
↓
Tiny GEMMs + communication
↓
Tensor Core utilization ↓
```

所以 MoE serving 常需要：

```text
expert batching
expert placement
grouped GEMM
communication overlap
variable-count collectives
```

而不是只靠 Tensor Core 峰值。

---

# Visual Simulation Idea

## **GPU Roofline & Kernel X-Ray**

Hermes Console 可以建立一個可互動的「從一個 token 到 GPU」模擬器。

### 左側：Transformer Layer Flow

```text
Token
↓
QKV GEMM      [COMPUTE]
↓
RoPE          [MEM/VECTOR]
↓
Attention     [IO + COMPUTE]
↓
O GEMM        [COMPUTE]
↓
MoE Router    [VECTOR]
↓
AllToAll      [NETWORK]
↓
Expert GEMM   [COMPUTE]
↓
AllToAll      [NETWORK]
```

### 中間：Memory Hierarchy

```text
HBM 180 GB
████████████████████
      ↓ 8 TB/s
L2
██████
      ↓
Shared Memory
███
      ↓
Registers
██
      ↓
Tensor Cores
```

動畫可以顯示 tile 的搬運，而非抽象「模型在想」。

### 右側：Roofline Plot

每個 kernel 變成一個點：

```text
X = arithmetic intensity
Y = achieved FLOP/s
```

使用者調整：

```text
Batch size: 1 → 8 → 64
Context: 2K → 128K
KV dtype: BF16 → FP8
Weights: BF16 → FP8 → FP4
TP: 1 → 8
EP: 1 → 64
```

觀察 kernel 從：

```text
MEMORY-BOUND
→ BALANCED
→ COMPUTE-BOUND
```

移動。

### MoE 模式
顯示每個 token 的 router path：

```text
Token 1 → Expert 3 @ GPU2
Token 2 → Expert 9 @ GPU7
Token 3 → Expert 3 @ GPU2
...
```

並即時顯示：

```text
Tokens / Expert
Load Imbalance
Dispatch Bytes
AllToAll Time
Grouped GEMM Utilization
Straggler GPU
```

### Failure / Bottleneck Injection

可手動切換：

```text
HBM bandwidth -50%
NVLink bandwidth -50%
One expert hot-spotted
Batch size = 1
Disable FlashAttention
Disable kernel fusion
TP = 16 on slow fabric
```

讓使用者直接看到 bottleneck 如何從 Tensor Core 轉移到 HBM、再轉移到 collective。

---

# Code / GitHub

## vLLM
值得繼續追：

```text
vllm/v1/attention/backends/
├ flash_attn.py
├ triton_attn.py
└ fa_utils.py

vllm/model_executor/layers/
├ attention/
├ quantization/
└ fused_moe/

vllm/distributed/
├ parallel_state.py
└ device_communicators/
```

本輪已直接確認 `flash_attn.py` 具有 FA4 kernel selection、FP8 KV support、head-size compatibility、context-parallel attention ops、sliding-window/sink 與 multimodal-prefix capability。

## Megatron Core
值得追：

```text
megatron/core/tensor_parallel/
├ layers.py
└ mappings.py

megatron/core/transformer/moe/
├ moe_layer.py
├ router.py
├ token_dispatcher.py
├ token_dispatcher_inference.py
└ experts.py
```

這些檔案可用來還原：

```text
Model Layer
→ Tensor Parallel sharding
→ Collective
→ Router
→ Dispatch
→ Expert Compute
→ Combine
```

而不是只停在 framework API。

---

# Papers

## 1. FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness
- **Authors:** Tri Dao, Daniel Y. Fu, Stefano Ermon, Atri Rudra, Christopher Ré
- **Institution:** Stanford / SUNY Buffalo（依作者 affiliation）
- **Year:** 2022
- **URL:** https://arxiv.org/abs/2205.14135
- **Code:** https://github.com/Dao-AILab/flash-attention
- **Architecture:** tiled exact attention + online softmax + IO-aware HBM/SRAM scheduling
- **Contribution:** 將 attention optimization 的核心從 FLOPs 擴展到 memory hierarchy / IO complexity
- **Limitations:** 仍是 exact quadratic attention compute；性能高度依 GPU architecture / shape / implementation
- **改變了什麼:** 讓「attention 複雜度」不再只用 O(N²) FLOPs 解釋，而必須同時討論 HBM traffic。

## 2. FlashAttention-3: Fast and Accurate Attention with Asynchrony and Low-precision
- **Authors:** Jay Shah, Ganesh Bikshandi, Ying Zhang, Vijay Thakkar, Pradeep Ramani, Tri Dao
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2407.08608
- **Code:** FlashAttention Hopper implementation / flash-attention repo
- **Architecture:** warp-specialized async pipeline + TMA + Tensor Core + FP8
- **Contribution:** 把 Hopper-specific asynchronous hardware primitives 納入 attention kernel pipeline
- **Limitations:** hardware-specific；低精度需要額外 numerical handling
- **改變了什麼:** 從「少搬資料」進一步走向「搬資料與算數學同時進行」。

## 3. HyperParallel-MoE: Multi-Core Interleaved Scheduling for Fast MoE Training on Ascend NPUs
- **Authors:** Zewen Jin et al.
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.23764
- **Architecture:** tile-level heterogeneous taskflow，通信 / matrix / vector compute overlap
- **Contribution:** 把 MoE operator pipeline 從 kernel-by-kernel serialization 轉成 event-driven fine-grained taskflow
- **Limitations:** 主要驗證於 Ascend A3 / training；不能直接外推 NVIDIA inference
- **改變了什麼:** 證明 MoE bottleneck 已進入「kernel 與 communication 如何 interleave」的微排程層。

## 4. EPS-MoE: Expert Pipeline Scheduler for Cost-Efficient MoE Inference
- **Authors:** Yulei Qian et al.
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2410.12247
- **Architecture:** expert pipeline scheduling + GroupGemm/DenseGemm selection + communication overlap
- **Contribution:** 強調 expert workload size 不同時 kernel 選擇與 communication overlap 必須動態化
- **Limitations:** benchmark/model/hardware-specific
- **改變了什麼:** MoE inference optimization 不再只是 EP size，而是 per-load kernel strategy + pipeline。

---

# Unknown / Open Questions

## 1. Agent-aware Roofline 到底如何定義？
傳統 Roofline 衡量 kernel FLOPs/bytes，但 Agent workload 還有：

```text
Tool waiting
GPU idle gaps
context rebuild
prefix reuse
short burst inference
long reasoning decode
```

需要建立從 Agent trace → model phase → kernel roofline 的跨層 attribution。

## 2. Quantization 會把瓶頸移到哪裡？
FP8/FP4 降低 weight bytes 並提高 Tensor Core peak，但 scaling/dequant、KV precision、collectives、router precision 可能成為新成本。不能只用「4-bit = 2× faster」推論。

## 3. MoE 的 optimal expert placement 如何和 Agent workload / prefix locality / P-D disaggregation 聯合最佳化？
目前 Serving Scheduler、KV placement、expert placement 多半是不同 subsystem；長期可能需要共同 cost model。

---

# Knowledge Graph 新增 Node / Edge

新增：

```text
GPU Execution Runtime
├ Kernel Launch
├ CUDA / Triton Kernel
├ HBM
├ L2 Cache
├ Shared Memory
├ Register File
├ Tensor Core
├ CUDA Core
├ Kernel Fusion
├ Occupancy
└ Arithmetic Intensity
```

新增：

```text
Performance Model
├ FLOPs
├ Bytes Moved
├ Arithmetic Intensity
├ Peak Compute
├ Memory Bandwidth
├ Roofline Ridge Point
├ Compute-Bound
└ Memory-Bound
```

新增：

```text
Distributed Model Execution
├ Tensor Parallel
│  ├ AllReduce
│  ├ AllGather
│  └ ReduceScatter
├ Expert Parallel
│  ├ Router
│  ├ Token Dispatch
│  ├ AllToAll / AllGather
│  ├ Grouped GEMM
│  └ Combine
├ Context Parallel
└ Pipeline Parallel
```

新增核心 edges：

```text
Scheduler
→ Model Runner
→ Kernel

Kernel
→ reads HBM

Kernel
→ executes on Tensor Core / CUDA Core

Arithmetic Intensity
→ determines Roofline Regime

FlashAttention
→ reduces HBM traffic

Tensor Parallel
→ introduces Collectives

MoE Router
→ determines Token-to-Expert Assignment

Token Assignment
→ drives AllToAll Traffic

Expert Imbalance
→ creates Straggler

Collective Bandwidth
→ limits Multi-GPU Scaling
```

整條 AI 底層鏈現在延伸到：

```text
User
→ UI
→ Agent Runtime
→ Context Compiler
→ Tokenizer
→ Transformer
→ Prefill / Decode Scheduler
→ GPU Kernel
→ HBM / Cache Hierarchy
→ Tensor Core
→ GPU Fabric / Collectives
→ Logits
→ Sampling
→ Output
```

---

# 本輪結束檢查

- **缺哪一層：** Logits → Sampling → speculative decoding / constrained decoding / tool-call decoding 尚未深入。
- **哪個節點最淺：** Kernel fusion / occupancy / warp scheduling 目前仍停在架構層，尚未做 SASS/PTX 級拆解。
- **哪個概念仍只是名詞：** Agent-aware Roofline。
- **哪個系統最值得讀原始碼：** vLLM fused MoE + attention backend；Megatron Core token dispatcher / tensor parallel mappings。
- **哪篇論文需追引用：** FlashAttention-3 之後的 Hopper/Blackwell attention kernel研究，以及 2026 MoE compute-communication overlap 工作。
- **哪個概念最適合視覺模擬：** GPU Roofline & Kernel X-Ray。
- **哪個 Agent 架構最值得實作：** 上層仍維持 Hermes deterministic runtime；本輪不是新增一種 Agent loop，而是讓 Runtime observability 能向下 trace 到 model phase / kernel / communication bottleneck。

---

# 下一輪研究

下一輪建議進入：

# **Logits × Sampling × Speculative Decoding × Structured/Constrained Generation × Tool-Call Token Path**

沿著本輪的：

```text
Transformer Final Hidden State
↓
LM Head
↓
Logits
```

繼續拆：

```text
Logits
↓
Temperature
↓
Top-k / Top-p / Min-p
↓
Repetition / Presence Penalty
↓
Constraint Mask / Grammar
↓
Sampler
↓
Token ID
↓
Tokenizer Decode
```

再研究：

```text
Draft Model
↓ speculative tokens
Target Model
↓ parallel verification
Accept / Reject
↓
Output
```

以及最關鍵的 Agent 路徑：

```text
Model logits
↓
JSON / Tool-call constrained decoding
↓
Tool Name + Arguments Tokens
↓
Parser
↓
Tool Runtime
```

這會把「模型內部算完 hidden state」真正接回前面研究過的 Agent Tool Calling Runtime。

**本輪核心結論：**

> AI inference 的最底層瓶頸不是單一「GPU 算力」。同一個 Transformer 會在不同階段沿著 Compute、HBM、on-chip IO、NVLink、AllReduce、AllToAll 之間移動 bottleneck；FlashAttention、quantization、TP、EP、kernel fusion 分別處理不同資料流。要回答「AI 為什麼快或慢」，必須同時看到數學 operator、memory hierarchy 與 distributed communication graph。