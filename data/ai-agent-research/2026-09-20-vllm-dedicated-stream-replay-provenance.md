# 【AI Agent × Multimodal Research Report】

時間：2026-09-20 07:56（Asia/Taipei）

主題：vLLM Dedicated CUDA Stream × Replay Provenance × Async-First Model Runner V2

## 與歷史研究比較

上一輪已建立 `CaptureStreamIdentity ≠ ReplayStreamIdentity` 的一般 CUDA/PyTorch 證據規則，並把缺口縮到 `vLLM replay gate → PyTorch current replay stream → cudaGraphLaunch → CUPTI observed streamId`。本輪不重複 H2D、BlockTable ContentEpoch、CUPTI graphId/nodeId 基礎，而是直接追 current vLLM source，確認 vLLM 自己是否對 capture/replay stream 做了更強的約束。

本輪得到一個會修正上一輪「任意 replay stream」泛化模型的重要結果：**current vLLM CUDA path 明確設計成 capture 與 replay 使用同一條 dedicated per-process CUDA stream。** `vllm/utils/torch_utils.py::current_stream()` 以 thread-local cache 追蹤 current stream；若尚未設定，在 CUDA/ROCm 建立新的 `torch.cuda.Stream()`，先 `wait_stream(torch.cuda.current_stream())`，再設為 current stream。原始碼註解直接說明：CUDA 上 capture/replay cudagraph 使用同一 stream，因此避免 default stream，並建立 dedicated stream per process。

這不是說一般 CUDA Graph 的 replay stream identity 可以被忽略；而是 vLLM 在 current implementation 中建立了一個更強的 runtime invariant，Hermes 應把它建成「待 runtime 驗證的 implementation invariant」，而不是永遠保留最寬鬆的任意-stream假設。

---

## 本小時新發現

### 新架構：vLLM Model Runner V2 async-first execution core

current MRV2 design 將核心 model execution loop 視為 CUDA stream 上的非同步工作序列：scheduler/worker 準備 step N+1 時，GPU 可執行 step N；persistent request state 與 per-step inputs 分離，大型 bookkeeping/state 更多移往 GPU。這使 provenance 的時間單位不再只是 request，而應是 `SchedulerStepEpoch → PersistentStateEpoch → GPU Prep Epoch → ModelExecutionEpoch`。

官方 2026-03-24 MRV2文章報告，在 Qwen3-0.6B / 1×GB200 的刻意 CPU-overhead-sensitive 測試中，MRV2 約由 16K 提升到 25K output tok/s（56.2%）；GLM-4.7-FP8 + MTP=1 / 4×GB200 的 TPOT 降低 6.3%。這些是官方工程 benchmark，不應外推為所有模型/硬體的一般性能結論。

### 新底層機制：vLLM current_stream TLS + dedicated stream

current vLLM：

```text
thread-local current stream cache
→ if unset
→ create torch.cuda.Stream()
→ new_stream.wait_stream(previous current stream)
→ torch.cuda.set_stream(new_stream)
→ cache in _current_stream_tls
→ capture/replay use dedicated process stream
```

這代表 Hermes 可以新增 `VLLMDedicatedExecutionStreamInvariant`，但仍需 CUPTI runtime trace 才能把「source invariant」升級為「observed runtime fact」。

### 新 runtime distinction

```text
General CUDA rule:
CaptureStreamIdentity may differ from ReplayStreamIdentity

Current vLLM implementation rule:
DedicatedExecutionStream intended for both capture and replay
```

兩者不衝突：前者是平台能力，後者是框架實作約束。

### 新 benchmark / serving insight

2026 `Hybrid JIT-CUDA Graph Optimization for Low-Latency Large Language Model Inference` 將 static transformer regions 放進 CUDA Graph replay、dynamic regions交給 JIT kernels；在作者的 LLaMA-2 7B、single GPU、batch=1、prompt 10–500 設定中，報告 TTFT 最多降低 66%。限制是單模型、單GPU、batch-1與特定比較條件，不能直接等價於 vLLM production serving。

2026 `Memory-Bound but Not Bandwidth-Limited: The Physical AI Inference Gap in Batch-1 LLM Decode` 用 CUDA Graph A/B 將 launch-side overhead從純 bandwidth 解釋中分離；作者報告 H100 ctx=2048 有 1.259× decode latency improvement，而 L4 僅 1.028×。這支持「更快 GPU 上 CPU/launch/runtime overhead 可能更顯著」的系統層觀察，但其受控 SDPA/batch-1 設定與 vLLM continuous batching不同。

---

## 本小時最重要 5 個發現

### 1. vLLM 有 dedicated execution stream invariant

**概念**：current vLLM 不只是被動使用 PyTorch current stream，而會在 CUDA/ROCm 首次需要時建立 dedicated stream。

**底層如何運作**：`_current_stream_tls` 保存 stream；patched `torch.cuda.set_stream` 同步更新 TLS；未設定時建立 `torch.cuda.Stream()`，先等待原 current stream，再設為新 current stream。

**為什麼重要**：上一輪必須把 replay stream 當未知；本輪 source evidence 顯示 vLLM 有意把 capture/replay固定到同一 execution stream，能顯著縮小 Runtime Provenance Verifier 的搜索空間。

**限制**：這是 source-level invariant；extension、C/C++直接改 stream、auxiliary streams、未覆蓋 code path 都可能破壞單純假設。vLLM source 本身也明寫其 hypothesis 是不會從 C/C++ 直接呼叫底層 `_cuda_setStream`。

**來源**：vLLM `vllm/utils/torch_utils.py`。

### 2. Stream identity 具有 thread-local component

**概念**：`_current_stream_tls = threading.local()`。

**底層如何運作**：不同 CPU threads 的 cached current stream state 可以不同；`_patched_set_stream()` 將 Python-level stream change寫入 TLS。

**為什麼重要**：上一輪建立的 `LaunchThreadIdentity` 不能刪除。即使框架說「per-process dedicated stream」，semantic epoch handoff 仍需確認真正 launch thread 看見哪個 TLS/current stream。

**限制**：TLS 是 Python bookkeeping，不等同 CUDA driver observed streamId。

### 3. Dedicated stream 建立時顯式繼承前序 ordering

`new_stream.wait_stream(torch.cuda.current_stream())` 建立舊 stream → 新 dedicated stream 的 ordering edge。這不是資料內容 provenance本身，但它是 execution-stream bootstrap 的 happens-before witness。

### 4. MRV2 將 async execution 從 optimization 升為 architecture assumption

MRV2 官方 design 指出 scheduler/worker 準備 N+1 同時 GPU 執行 N，並希望 core model execution loop沒有 CPU synchronization points。Hermes 因此不能用「CPU function return」當作 GPU step boundary；需要 `SemanticStepEpoch + CUDA stream activity + GPU completion/event`。

### 5. CUDA Graph provenance 必須兼顧 performance mode 與 evidence mode

CUPTI 官方 current documentation提供 graph-level trace與 per-node trace。graph-level trace較低 overhead但看不到 nodes；per-node trace能在 kernel/memcpy/memset activity取得 `graphId + graphNodeId`，CUDA 13.4另有 `sourceGraphId/sourceGraphNodeId`。兩種 graph trace模式互斥。因此 production verifier應採：常態 graph-level evidence + 抽樣 per-node deep trace，而非永遠開啟最大 tracing。

---

## Architecture Breakdown

### vLLM MRV2 execution/provenance model

```text
User / API request
→ Engine / Scheduler
→ Scheduler Step Epoch S_n
→ Persistent Request State
→ GPU-native / incremental input preparation
→ Per-step Input Epoch I_n
→ Dedicated vLLM CUDA Execution Stream D
→ CUDA Graph selection / eager / piecewise mode
→ Offloader replay gate (when applicable)
→ GraphExec Replay R_n
→ Attention / FFN / sampler GPU nodes
→ Output Device Epoch O_n
→ async output transfer / scheduler settlement
→ next step S_n+1
```

Hermes 不應再只建 `request → kernel`，而應建：

```text
Request
→ SchedulerStepEpoch
→ PersistentStateEpoch
→ InputPreparationEpoch
→ DedicatedExecutionStream
→ GraphReplayEpoch
→ GraphNodeExecution
→ OutputEpoch
```

### Evidence grading

```text
SOURCE_INTENT
  vLLM source says capture/replay same dedicated stream

SOURCE_INVARIANT
  current_stream() + TLS + dedicated stream creation observed in source

RUNTIME_STREAM_OBSERVED
  CUPTI graph trace streamId agrees with expected dedicated stream

RUNTIME_NODE_BOUND
  sampled per-node graph trace binds attention graphNodeId

SEMANTIC_EPOCH_BOUND
  scheduler/content epoch external ID correlates to graph replay

CAUSAL_INTERVENTION_VALIDATED
  sham/zero/replace intervention changes downstream activation/logit/action under controls
```

---

## Bottom-Level Logic

### `current_stream()` provenance

```text
call current_stream()
→ inspect _current_stream_tls.value
→ missing/null?
    yes:
      CUDA/ROCm?
      → allocate new CUDA Stream D
      → D.wait_stream(previous_current)
      → torch.cuda.set_stream(D)
      → patched setter writes TLS=D
→ return TLS stream object D
```

### Runtime verifier predicate refined

Previous:

```text
CONSUMABLE_BY_REPLAY(E,R)
= CONTENT_EPOCH_BOUND(E)
∧ PRODUCER_COMPLETE(E)
∧ REPLAY_GATE_PASSED(E,R)
∧ HAPPENS_BEFORE(E,R)
```

This round adds:

```text
VLLM_REPLAY_STREAM_VALID(R)
= SOURCE_EXPECTS_DEDICATED_STREAM(D)
∧ LAUNCH_THREAD_BOUND(R,T)
∧ CUPTI_GRAPH_STREAM_OBSERVED(R,S)
∧ (S == D_runtime_id)
```

Final:

```text
RUNTIME_CONTENT_EPOCH_BOUND(E,R)
= CONSUMABLE_BY_REPLAY(E,R)
∧ VLLM_REPLAY_STREAM_VALID(R)
∧ SEMANTIC_EPOCH_CORRELATED(E,R)
```

Source expectation alone must never satisfy the final predicate.

---

## Visual Simulation Idea

### Dedicated Stream Provenance Microscope

Interactive lanes:

```text
CPU Scheduler
S913 ── PersistentState E207 ── SemanticEpoch H913
                                  │
Launch Thread T4                   │ handoff
                                  ▼
vLLM Stream State          TLS.current = D1
                                  │
Old CUDA Stream S0 ──wait_stream──┘
                                  ▼
Dedicated Stream D1       H2D / prep / replay
                                  │
CUPTI Graph Trace          streamId = 17
                                  │
GraphExec G12 / Replay R92
                                  │
Sampled Node Trace          N57 Attention
                                  │
Runtime KV Read             B91:E17
```

互動功能：
1. 點 `SemanticEpoch` 顯示 scheduler/request/content hash。
2. 點 `Dedicated Stream` 同時顯示 source expected stream 與 CUPTI observed stream。
3. 若 observed stream ≠ expected dedicated stream，顯示 `STREAM_INVARIANT_VIOLATION`。
4. 若只有 source evidence，顯示 `SOURCE_ONLY_NOT_RUNTIME_PROOF`。
5. graph-level常態模式顯示 `GRAPH_LEVEL_VERIFIED`；抽樣 node trace成功後升級 `ATTENTION_NODE_BOUND`。
6. 顯示 N 與 N+1 overlap，避免使用者誤把 CPU step順序當 GPU execution順序。

---

## Code / GitHub

### vLLM
Repository: https://github.com/vllm-project/vllm

本輪值得看的核心檔案：

- `vllm/utils/torch_utils.py`
  - `_current_stream_tls`
  - `_patched_set_stream()`
  - `current_stream()`
  - dedicated CUDA stream creation / `wait_stream`
- `vllm/v1/worker/gpu/cudagraph_utils.py`
  - graph capture
  - `get_offloader().sync_prev_onload()`
  - `self.graphs[desc].replay()`
- `docs/design/model_runner_v2.md`
  - persistent state
  - GPU-native input prep
  - async-first execution
  - removal of CPU/GPU sync barriers

下一步應再讀：

- PyTorch `aten/src/ATen/cuda/CUDAGraph.cpp` 的 replay implementation
- vLLM offloader各 backend的 `sync_prev_onload()`
- vLLM MRV2實際 model execution入口與 stream context切換點
- NVIDIA CUPTI `cuda_graphs_trace` sample

---

## Papers

### 1. Hybrid JIT-CUDA Graph Optimization for Low-Latency Large Language Model Inference

- Authors: Divakar Kumar Yadav, Tian Zhao
- Institution: arXiv metadata本輪未確認作者機構，標記 `UNVERIFIED_INSTITUTION`
- Year: 2026
- URL: https://arxiv.org/abs/2604.23467
- Code: 本輪未確認官方 code，`UNVERIFIED`
- Dataset/Workload: LLaMA-2 7B, single GPU, batch size 1, prompt length 10–500
- Architecture: static regions → CUDA Graph; dynamic regions → JIT kernels
- Contribution: 在保留 dynamic flexibility 下減少 launch overhead；作者報告 TTFT最多降低66%
- Limitations: 單模型/單GPU/batch-1；不能直接外推 continuous batching、多GPU、multimodal serving
- 改變了什麼：支持把 execution architecture視為「static replay islands + dynamic execution islands」，Hermes visualizer應能畫 graph/eager boundaries。

### 2. PyGraph: Robust Compiler Support for CUDA Graphs in PyTorch

- Authors: Abhishek Ghosh, Ajay Nayak, Ashish Panwar, Arkaprava Basu
- Year: 2025
- URL: https://arxiv.org/abs/2503.19779
- Architecture: PyTorch2 compiler-integrated selective CUDA Graph deployment
- Contribution: 指出 CUDA Graph並非永遠更快；static graph限制與parameter/data copy可能造成反效果，提出cost-benefit selective deployment
- Limitations: 與 current vLLM runtime architecture不是同一系統；需避免把compiler結果直接當 serving結果
- 改變了什麼：Hermes Knowledge Graph新增 `GraphDeploymentBenefit` 與 `GraphCopyOverhead`，避免「CUDA Graph = 無條件加速」的錯誤概念。

### 3. Memory-Bound but Not Bandwidth-Limited: The Physical AI Inference Gap in Batch-1 LLM Decode

- Author: Josef Chen
- Year: 2026
- URL: https://arxiv.org/abs/2605.30571
- Workload: batch-1 decode；7–8B GQA transformers；H100/A100/L40S/L4
- Contribution: 將 launch-side overhead與memory-bandwidth floor區分；作者的 CUDA Graph A/B在H100 ctx=2048報告1.259×，L4為1.028×
- Limitations: controlled batch-1 SDPA，不等於 production continuous batching
- 改變了什麼：支持 Hermes 將 `KernelLaunchOverhead`、`MemoryTrafficFloor`、`RuntimeRealizedBandwidth` 建成不同節點。

---

## Unknown / Open Questions

1. **vLLM dedicated stream source invariant 是否在所有 MRV2 / piecewise / breakable CUDA Graph 路徑都成立？** 需要逐 path 追 stream context，不能只靠 `current_stream()` 註解。
2. **PyTorch `CUDAGraph.replay()` 最終取得哪個 stream並如何呼叫 driver/runtime graph launch？** 需要直接追 `CUDAGraph.cpp` 與 runtime trace。
3. **CUPTI observed graph `streamId` 如何穩定綁回 Python `torch.cuda.Stream` identity？** 需要記錄 CUDA stream handle / external correlation或建立 calibration event。

---

## Knowledge Graph 新增 Node / Edge

### Nodes

- `VLLMDedicatedExecutionStream`
- `VLLMCurrentStreamTLS`
- `PythonStreamIdentity`
- `CUPTIStreamIdentity`
- `StreamIdentityCalibrationWitness`
- `DedicatedStreamBootstrapWitness`
- `DedicatedStreamSourceInvariant`
- `DedicatedStreamRuntimeInvariant`
- `StreamInvariantViolationState`
- `MRV2SchedulerStepEpoch`
- `PersistentRequestStateEpoch`
- `GPUInputPreparationEpoch`
- `AsyncStepOverlapWitness`
- `GraphDeploymentBenefit`
- `GraphCopyOverhead`
- `KernelLaunchOverhead`
- `RuntimeRealizedBandwidth`

### Edges

```text
VLLMCurrentStreamTLS
--caches→ VLLMDedicatedExecutionStream

PreviousCUDAStream
--waited_by→ VLLMDedicatedExecutionStream

VLLMDedicatedExecutionStream
--intended_for→ GraphCapture

VLLMDedicatedExecutionStream
--intended_for→ GraphReplay

PythonStreamIdentity
--calibrates_to→ CUPTIStreamIdentity

MRV2SchedulerStepEpoch
--updates→ PersistentRequestStateEpoch

PersistentRequestStateEpoch
--feeds→ GPUInputPreparationEpoch

GPUInputPreparationEpoch
--enqueued_on→ VLLMDedicatedExecutionStream

MRV2SchedulerStepEpoch(N+1)
--overlaps_with→ GPUExecutionEpoch(N)

DedicatedStreamSourceInvariant
--requires_runtime_observation→ DedicatedStreamRuntimeInvariant

CUPTIStreamIdentityMismatch
--produces→ StreamInvariantViolationState
```

---

## 事實層級

**已確認官方/source事實**：current vLLM `current_stream()` 使用 thread-local cache；CUDA/ROCm 未設定時建立新 stream並 wait previous stream；source註解明確描述 CUDA Graph capture/replay same stream與 dedicated per-process stream設計。MRV2官方設計是 async-first、GPU-native input prep方向。

**官方工具能力**：CUPTI可做 graph-level trace；per-node trace可提供 graphId/graphNodeId；CUDA 13.4增加source graph/node lineage。graph-level與per-node trace是不同、互斥的收集模式。

**論文結果**：JIT-CUDA Graph、PyGraph、Physical AI inference gap 的性能數字只代表各自實驗設定。

**工程推論**：Hermes verifier可以利用 vLLM dedicated-stream invariant縮小 stream binding搜索空間。

**尚未驗證假說**：真實 Hermes/vLLM worker的每一次 graph replay都能在 CUPTI 中觀察到同一 dedicated streamId；這必須跑實際 CUDA trace才能升級。

---

## 下一輪研究

下一輪不要再停在 source註解，直接閉合 `Python stream object → CUDA stream handle → CUPTI streamId → graph replay`：

```text
vLLM current_stream()
→ torch.cuda.Stream object
→ underlying cudaStream_t / handle
→ CUDAGraph.replay()
→ PyTorch CUDAGraph.cpp
→ cudaGraphLaunch / cuGraphLaunch
→ CUPTI Driver/Runtime API Activity
→ correlationId
→ GraphTrace.streamId
→ Python↔CUPTI stream calibration
→ DedicatedStreamRuntimeInvariant
→ sampled graphNodeId
→ Attention Node
→ RuntimeContentEpochBound
```

之後才進 causal intervention：

```text
RuntimeContentEpochBound
→ baseline
→ sham same-KV writeback
→ zero target KV
→ replace target KV
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔGeneratedToken
→ ΔAgentAction
```

---

## 本輪結論回答

- **缺哪一層？** `Python torch.cuda.Stream identity → underlying CUDA stream → CUPTI graph streamId` 的 runtime calibration layer。
- **哪個節點最淺？** `StreamIdentityCalibrationWitness`。
- **哪個概念仍只是名詞？** `DedicatedStreamRuntimeInvariant` 與 `AgentActionCausalBound`；前者已有強 source evidence但尚未實測，後者尚未進 intervention。
- **哪個系統值得讀原始碼？** PyTorch `CUDAGraph.cpp` + vLLM MRV2 model runner / cudagraph manager + CUPTI cuda_graphs_trace sample。
- **哪篇論文需追引用？** `PyGraph` 最值得追 compiler/runtime CUDA Graph cost model引用；`Hybrid JIT-CUDA Graph` 值得追 static/dynamic partition後續工作。
- **哪個概念最適合視覺模擬？** `Dedicated Stream Provenance Microscope`，尤其把 N+1 CPU preparation 與 N GPU execution overlap畫在同一時間軸。
- **哪個 Agent 架構最值得實作？** `State-grounded Planner + Runtime Provenance Verifier + Causal Evidence Gate + Tool Executor`；其中 verifier先實作 stream calibration與graph replay binding。

最終鏈本輪更新為：

```text
UI
→ Agent Runtime
→ SchedulerStepEpoch
→ Context / Multimodal Token
→ Persistent Request State
→ GPU Input Preparation
→ Logical/Physical KV
→ ContentEpoch
→ vLLM Dedicated CUDA Stream
→ Replay Gate
→ CUDA Graph Replay
→ CUPTI streamId / graphId
→ Attention graphNodeId
→ Exact KV Read
→ Causal Intervention
→ Logit
→ Agent Action
```

本輪最重要的進展不是再增加一個 CUDA 名詞，而是把上一輪「Replay Stream 是未知變數」進一步收斂成：**一般 CUDA 允許 capture/replay stream identity變化，但 current vLLM 明確建立 capture/replay same dedicated stream 的 implementation invariant；Hermes 下一步只差把 Python stream identity校準到 CUPTI observed streamId，才能把這個 source invariant升級為 runtime fact。**