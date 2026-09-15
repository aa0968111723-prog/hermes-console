# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 07:55（Asia/Taipei）

主題：RoPE × RMSNorm × SwiGLU × Tensor Parallel × AllReduce × NCCL × NVLink

## 與歷史研究比較

前輪已拆到 FlashAttention-3、TMA/WGMMA、GQA/MQA、KV quantization 與 attention roofline。本輪不重複 attention IO，而補完整 Transformer layer 的 attention 前後算子，以及單一 layer 在 tensor-parallel 多 GPU 上如何完成一次 forward。歷史庫已有 long-context/RoPE 研究，因此本輪只補 RoPE 的執行機制與 2026 長上下文幾何失效證據，再把它接到 Q/K projection 與 distributed layer execution。

## 本小時新發現

1. vLLM 的 RoPE runtime 不是抽象「加入位置資訊」：positions 先 index cos/sin cache，只旋轉 Q/K 的 rotary_dim 子空間；CUDA fast path 可原地更新 Q/K，且 backend 可切 FlashInfer/custom op/ROCm AITER。
2. vLLM 已存在 eager path 的 fused `all-reduce + residual-add + RMSNorm`；TP>1 且 fast path 可用時，一次 kernel 同時完成跨 rank reduction、residual 與 RMS normalization，否則退回顯式 tensor-model-parallel all-reduce 再 norm。
3. SwiGLU 的底層不是單一 activation：up/gate projection 產生 2d hidden，切成兩半後 `SiLU(gate) * up`，再經 down projection；vLLM 將 SiluAndMul 做成 custom op，並可與後續量化 fusion，避免 materialize 中間 tensor。
4. Tensor parallel 的真正成本不只 GEMM shard：row-parallel partial outputs 必須 collective merge。NCCL AllReduce 讓每個 rank 都取得 reduction；ReduceScatter+AllGather 可構成 AllReduce，而 NVSwitch multicast 可把某些 all-reduce protocol 的同步步數顯著降低。
5. MLSys 2026 TokenWeave 指出 low-latency TP inference 中 communication 即使在 NVLink 上仍可達約 20% overhead；其核心不是單純 overlap GEMM，而是 fused AllReduce–RMSNorm，並利用 Hopper/Blackwell NVSHARP/Multimem，只佔少量 SM 來重疊 communication 與 normalization。

## 本小時最重要 5 個發現

### 1. RoPE 是 Q/K 座標旋轉，不是把 position vector 加到 token embedding

底層：
`position -> cos/sin lookup -> Q_rot/K_rot pairwise rotation -> Q/K attention coordinates`。

對每對 channel，可寫成：
`[x1', x2'] = [x1 cosθ - x2 sinθ, x1 sinθ + x2 cosθ]`。

因此 dot-product 會帶入相對位置相位差。vLLM 原始碼只對 `rotary_dim` 做 rotation，其餘 channel passthrough；key 甚至可在 cross-layer KV sharing 情況為 None。

為什麼重要：這讓 Position Encoding 可以被畫成「Q/K latent vector 在不同頻率平面旋轉」，也解釋為何 context extension 會碰到 frequency/OOD 問題。

限制：RoPE scaling 並不自動保證長上下文可用。IBM ICLR 2026 的 Frayed RoPE 研究指出，超出 training length 時旋轉會破壞 key/query cluster separation 與 sink-token 行為；其 RoPE-ID 是一種修正方向，但結果仍是特定模型與 benchmark。

### 2. RMSNorm 是每個 token hidden vector 的尺度控制，而且非常適合 fusion

對 hidden vector x：
`rms(x)=sqrt(mean(x^2)+eps)`
`y = gamma * x / rms(x)`。

與 LayerNorm 相比，RMSNorm 不做 mean-centering。Inference runtime 的關鍵不是公式本身，而是 residual、collective 與 norm 的 memory traffic 是否能融合。

vLLM eager fast path：
`per-rank partial hidden -> AllReduce -> + residual -> RMSNorm` 可被 fused kernel 合併；fallback 才是 `tensor_model_parallel_all_reduce(hidden_states)` 後呼叫 norm。

### 3. SwiGLU 讓 FFN 成為「兩條 projection 分支 + gating + down projection」

典型流程：
`h -> [W_gate h, W_up h] -> SiLU(W_gate h) ⊙ W_up h -> W_down -> residual`。

vLLM `SiluAndMul` 明確實作 `silu(x[:d]) * x[d:]`。因此 FFN 的主要成本仍是兩側 GEMM，而 gate activation/multiply 是可 fusion 的 elementwise stage。

工程意義：若 activation 後還要 FP8/FP4 quantize，fusion 可以避免 full-precision post-activation tensor 寫回再讀出。

### 4. Tensor Parallel 把一層模型變成「local GEMM + collective」反覆交替

概念化：
`replicated hidden -> column-parallel QKV/MLP projection -> local shard compute -> row-parallel output partials -> AllReduce -> replicated hidden`。

AllReduce sum 在 k ranks 上滿足：每 rank 最終得到所有 partial tensor 的 reduction。NCCL 是 topology-aware communication library；collective 要求 participating ranks 對 count/datatype 一致，否則可能 hang/crash/data corruption。

這表示模型放進多 GPU 後，token latency 不只由 Tensor Core 決定，而由：
`GEMM compute + collective launch + NVLink/NVSwitch traffic + synchronization + residual/norm kernels` 決定。

### 5. Communication 與 RMSNorm 可以成為同一個 execution stage

TokenWeave（Microsoft Research，MLSys 2026）指出 serving 每 iteration token 數偏小，傳統把 compute 切更細來 overlap communication 反而可能增加 overhead；它選擇 RMSNorm 作為 overlap/fusion target，設計 fused AllReduce–RMSNorm，利用 NVSHARP/Multimem 在 8×H100 DGX 上只使用 2–8 SM 執行 communication+norm。論文報告最高 1.28× latency speedup、1.19× throughput improvement；這是論文 workload 下的結果，不是所有模型固定收益。

這改變 Knowledge Graph：`RMSNorm` 不應只掛在 Model Architecture；它同時是 `DistributedExecutionFusionPoint`。

## Architecture Breakdown

完整 decoder Transformer layer（典型 pre-norm + SwiGLU）可拆成：

`hidden/residual`
`-> RMSNorm`
`-> QKV Linear Projection`
`-> RoPE(Q,K)`
`-> KV state write/read`
`-> Attention`
`-> Output Projection`
`-> TP AllReduce`
`-> Residual Add`
`-> RMSNorm`
`-> Gate + Up Projection`
`-> SwiGLU = SiLU(gate) * up`
`-> Down Projection`
`-> TP AllReduce`
`-> Residual Add`
`-> next layer`

Tensor parallel execution：

`GPU0 W shard ---- local GEMM ---- partial0 --\`
`GPU1 W shard ---- local GEMM ---- partial1 --- AllReduce -> full hidden`
`GPU2 W shard ---- local GEMM ---- partial2 --/`

下一個 sublayer 再重複 shard compute / collective merge。

## Bottom-Level Logic

### RoPE execution
`token positions -> cos/sin cache index -> reshape Q/K into heads -> select rotary_dim -> rotate channel pairs -> concatenate passthrough dims -> attention`。

### RMSNorm execution
`hidden -> square -> reduction mean -> +eps -> rsqrt -> multiply hidden -> gamma scale`。

### SwiGLU execution
`hidden -> gate/up GEMM -> split -> SiLU(gate) -> elementwise multiply up -> down GEMM`。

### Tensor-parallel communication
`local partial tensor -> collective rendezvous -> reduce chunks -> distribute/gather result -> every rank receives merged hidden`。

NCCL ring-style AllReduce 可理解為 ReduceScatter + AllGather；NVSwitch-aware protocols 可利用 multicast 減少同步 stages。重要區分：NCCL 是 communication primitive/runtime，不是模型 parallelism planner。

## Visual Simulation Idea

### Transformer Layer × Multi-GPU Collective Microscope

畫面四層：

1. **Math Graph**：RMSNorm → QKV → RoPE → Attention → Residual → RMSNorm → SwiGLU。
2. **Tensor Shape Graph**：每個節點顯示 `[tokens, hidden]`, `[tokens, heads, head_dim]`, TP shard shape。
3. **GPU Timeline**：GPU0..GPU7 分別顯示 GEMM、RoPE、Attention、AllReduce、RMSNorm、SwiGLU。
4. **Interconnect Graph**：PCIe / NVLink / NVSwitch 流量，標記 bytes、collective type、等待時間。

互動：TP=1/2/4/8、hidden size、batch/tokens、NVLink bandwidth、fused/unfused AllReduce-RMSNorm、RoPE scaling、SwiGLU quant fusion。

指標：Compute time、Communication time、Collective fraction、NVLink bytes/token、RMSNorm bytes、kernel launches、SM occupancy、token latency。

## Code / GitHub

### vLLM
值得追：
- `vllm/model_executor/layers/rotary_embedding/base.py`：RoPE cos/sin cache、rotary_dim、native/CUDA/ROCm backend。
- `vllm/models/common/ops/fused_allreduce_rms_norm.py`：TP all-reduce + residual + RMSNorm fusion/fallback。
- `vllm/model_executor/layers/activation.py`：`SiluAndMul` / SwiGLU custom op。
- `vllm/compilation/passes/fusion/`：norm/activation/quantization fusion。
- `vllm/distributed/`：tensor model parallel collective abstraction。

### Microsoft TokenWeave
值得追：fused AllReduce–RMSNorm kernel、NVSHARP/Multimem path、SM reservation/overlap strategy，以及如何接 serving framework iteration。

## Papers

### TokenWeave: Efficient Compute-Communication Overlap for Distributed LLM Inference
Authors: Raja Gond, Nipun Kwatra, Ramachandran Ramjee
Institution: Microsoft Research
Year: 2026 / MLSys 2026
Code: https://github.com/microsoft/tokenweave
Dataset/Workloads: multiple models and distributed inference workloads on 8×H100 DGX
Architecture: Tensor Parallel + fused AllReduce–RMSNorm + NVSHARP/Multimem
Contribution: 讓小 token iteration 也能有效 compute/communication overlap。
Limitations: 結果依 GPU topology、TP degree、token count、model shape；不能把最高 speedup 外推成普遍值。
改變了什麼：把 normalization 從「小 elementwise kernel」提升成 distributed inference communication fusion point。

### Frayed RoPE and Long Inputs: A Geometric Perspective
Authors: Davis Wertheimer, Aozhong Zhang, Derrick Liu, Penghang Yin, Naigang Wang
Institution: IBM Research
Year: 2026 / ICLR 2026
Architecture: RoPE geometry analysis + RoPE-ID
Dataset: LongBench, RULER；1B/3B Transformers
Contribution: 將長上下文 RoPE failure 連到 Q/K cluster separation 與 sink-token mechanism。
Limitations: 並非所有模型/heads 都必然以同一機制失效。
改變了什麼：RoPE extrapolation 問題從「frequency OOD」進一步變成可視覺化的 latent geometry breakdown。

## 已確認 / 推論 / 假說

**已確認事實**：vLLM RoPE 實作對 Q/K rotary subspace 做 cos/sin rotation；SiluAndMul 實作 SwiGLU activation；vLLM 有 fused AllReduce-residual-RMSNorm path；NCCL AllReduce 將 reduction 結果交給每 rank。

**論文結果**：TokenWeave 的 speedup、Frayed RoPE 的長上下文幾何結論僅按其論文實驗範圍成立。

**工程推論**：Hermes 的 inference visualization 應把 collective/fusion 納入 Transformer execution graph，而非只畫 neural-network operators。

**尚未驗證假說**：對 Hermes 實際部署硬體，fused AllReduce-RMSNorm 是否比標準 NCCL path 有明顯收益，需取得 GPU/topology 並 benchmark。

## Unknown / Open Questions

1. vLLM/FlashInfer fused AllReduce-RMSNorm 在 Hopper、Blackwell 不同 TP size 的 break-even token count 是多少？
2. Tensor-parallel collective 與 paged KV/attention kernel 同時競爭 SM/L2/HBM 時，真正 bottleneck 如何由 profiler trace 自動歸因？
3. RoPE long-context geometry failure 是否能從 production attention trace 建立可在線觀測的 warning metric？

## 下一輪研究

`Tensor Parallel GEMM sharding -> ColumnParallelLinear / RowParallelLinear -> ReduceScatter/AllGather -> NCCL algorithms/protocols -> NVLink/NVSwitch topology -> Sequence/Context Parallel -> Expert Parallel / MoE AllToAll`。

優先把 dense Transformer 多 GPU 路徑補完整，再進 MoE，避免只停在名詞層。

## Knowledge Graph 新增 Node / Edge

Nodes:
`RotarySubspace`, `RoPECosSinCache`, `RoPEGeometryFailure`, `RMSNormReduction`, `ResidualNormFusion`, `SwiGLUGate`, `GateProjection`, `UpProjection`, `DownProjection`, `TensorParallelRank`, `ColumnParallelProjection`, `RowParallelProjection`, `PartialHiddenState`, `CollectiveMerge`, `NCCLAllReduce`, `ReduceScatter`, `AllGather`, `NVLinkTransport`, `NVSwitchMulticast`, `DistributedExecutionFusionPoint`, `AllReduceRMSNormFusion`, `CommunicationComputeOverlap`.

Edges:
`QKVProjection -> ROTATED_BY -> RoPE`
`RoPE -> MODIFIES -> Query/Key`
`GateProjection -> GATES -> UpProjection`
`SwiGLU -> FEEDS -> DownProjection`
`RowParallelProjection -> PRODUCES -> PartialHiddenState`
`PartialHiddenState -> MERGED_BY -> NCCLAllReduce`
`NCCLAllReduce -> TRANSPORTED_OVER -> NVLink/NVSwitch`
`CollectiveMerge -> FUSED_WITH -> RMSNorm`
`TensorParallelRank -> OWNS -> WeightShard`
`RoPEGeometryFailure -> DEGRADES -> LongContextAttention`

## 本輪結束判斷

- 缺哪一層：multi-GPU linear/GEMM sharding 到 NCCL topology-aware protocol 的逐 kernel trace。
- 哪個節點最淺：`NVSwitchMulticast`, `ColumnParallelProjection`, `CommunicationComputeOverlap` 的 runtime profiler mapping。
- 哪個概念仍只是名詞：Hermes 尚未建立可執行的 `DistributedTransformerExecutionTrace`。
- 哪個系統值得讀原始碼：Microsoft TokenWeave、vLLM distributed/parallel linear layers、NCCL collective implementation/docs。
- 哪篇論文需追引用：TokenWeave；Frayed RoPE 則追 RoPE-ID 後續長上下文工作。
- 哪個概念最適合視覺模擬：Transformer Layer × Multi-GPU Collective Microscope。
- 哪個 Agent 架構最值得實作：此輪不是 Agent loop 新架構；最值得接進 Hermes 的是 `InferenceExecutionGraph`，把 Agent model call 展開到 layer/operator/collective/GPU transport。

## 從使用者一句話到本輪補上的底層

`User -> UI -> Agent -> Context -> Model Router -> Scheduler -> Tokenizer -> Embedding -> Transformer Layer -> RMSNorm -> QKV Projection -> RoPE -> Attention/KV -> Output Projection -> TP AllReduce -> Residual -> RMSNorm -> Gate+Up -> SwiGLU -> Down Projection -> TP AllReduce -> Next Layer -> Logits -> Sampling -> Token -> Agent -> Tool/MCP -> Action`。

本輪使「AI 到底怎麼運作」多了一個關鍵答案：模型大到跨 GPU 後，一個 Transformer layer 不再只是數學函式；它是 local tensor kernels 與 distributed collectives 交錯的 execution graph。RoPE 改變 Q/K 幾何、RMSNorm控制 hidden scale、SwiGLU建立 gated FFN，而 Tensor Parallel 讓每張 GPU 只算部分矩陣，必須透過 NCCL/NVLink/NVSwitch 把 partial state 合回下一階段。