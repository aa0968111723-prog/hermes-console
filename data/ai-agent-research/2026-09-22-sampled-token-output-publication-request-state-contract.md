# 【AI Agent × Multimodal Research Report】

時間：2026-09-22 14:53（Asia/Taipei）

主題：Sampled Token Output Publication × Async D2H × Request-State Generation Contract

## 本小時新發現

本輪接續上一輪 `SchedulerOutputGeneration → pinned host input → H2D → persistent GPU buffers → CUDA Graph replay`，不再重複 input-side replay provenance，而是把 causal chain 穿過模型輸出端：

`Attention/MLP → logits → sampling → sampled_token_ids(device) → async D2H copy → completion event → CPU token list → request row mapping → scheduler/request state → next-step input token`。

這補上從 GPU inference generation 回到 Agent/serving runtime state 的第一條 output publication contract。

## 本小時最重要 5 個發現

### 1. GPU sampling completion 不等於 CPU 已取得 sampled token

**已確認工程實作。** current vLLM `AsyncGPUModelRunnerOutput` 將 `sampled_token_ids` 保留為 device tensor，另外建立 `async_output_copy_stream`；copy stream 先 `wait_stream(default_stream)`，再以 non-blocking D2H 將 sampled token、logprobs 等複製到 CPU，最後 record `async_copy_ready_event`。真正 `get_output()` 時才 synchronize event，之後才將 CPU tensor 轉成 token list。

因此新增：

`SampleKernelCompletionWitness --does_not_prove→ HostSamplePublicationWitness`

以及：

`HostSamplePublication = SamplingDeviceGenerationMatch ∧ D2HDependencyEstablished ∧ D2HCopyComplete ∧ RequestRowMappingMatch`

這與前幾輪 input-side `CopyEnqueue ≠ CopyCompletion ≠ ConsumerOrdering` 對稱，但方向相反：現在是 GPU→CPU。

### 2. sampled token 的 device tensor lifetime 本身是 correctness contract

**已確認工程實作。** vLLM 明確保留 `_sampled_token_ids` reference，直到 async D2H copy 完成後才釋放；否則 allocator 可能在 copy 完成前回收或重用 storage。

新增：

`SampledTokenDeviceLifetimeWitness`

`D2HSourceLifetimeSafe = SourceTensorAliveUntilCopyCompletion`

並新增 failure：

`SAMPLED_TOKEN_SOURCE_REUSED_BEFORE_D2H_COMPLETE`

這代表「token 已經 sample 出來」仍不是一個足夠的 serving-level witness；必須證明 token generation 的 storage 在 publication 完成前沒有失效。

### 3. CPU token list 必須與正確 request-row generation 對齊

**已確認工程實作 + 合理推論。** vLLM 的 async output path 在 D2H 完成後，依 invalid request indices 過濾 rows，再把結果放回 `ModelRunnerOutput.sampled_token_ids`。另一方面，model runner 的 request state 與 `InputBatch.req_id_to_index` 持續因新增、移除、preemption、resume、spec decode 而變化。

因此：

`CorrectSampledTokenValue --does_not_prove→ CorrectRequestAttribution`

新增 identity：

`SampledTokenPublicationIdentity = RequestID + BatchRowGeneration + DecodeStepGeneration + SampleGeneration + DeviceTensorGeneration + D2HGeneration`

若 token 值本身完全合法但 row generation 已變，可能形成 semantic misattribution，而不一定是 memory fault。

### 4. CUDA Graph padding/stale metadata 證明「合法 replay」仍可能產生錯誤 request semantics

**已確認公開工程案例。** vLLM issue #41841（2026-05-06）指出 FULL CUDA graph metadata 中 padded rows 可殘留 stale CPU request-state values；對 Mamba backend，padding rows 因此可能被誤判成 prefill，使 decode-only replay 被分類成 mixed decode/prefill。這與本輪 output attribution形成同一類 generation problem：固定 graph shape、固定 buffer address、甚至 kernel 成功執行，都不能證明 row semantics 屬於當前 batch。

新增：

`PaddedRowSemanticGeneration`

`GraphReplaySuccess --does_not_prove→ RequestRowSemanticCorrectness`

### 5. sampled token 是下一輪 inference state 的因果邊，不只是 API output

**已確認工程實作。** current vLLM 在下一輪 input preparation 中會把 previous sampled token 寫回 persistent GPU `input_ids` 對應位置；request state 同時保存 `output_token_ids`，speculative decode 甚至會先做 optimistic state extension，後續再 correction。

因此 sampled token 必須建模為 state transition：

`Sample_t → HostPublication_t → RequestStateCommit_t → InputTokenGeneration_(t+1) → KVWrite_(t+1) → Sample_(t+1)`

這是 autoregressive loop 的真正 runtime feedback edge。

新增最重要 invariant：

`NextDecodeStateCorrect = PreviousSampleValueCorrect ∧ PreviousSamplePublicationComplete ∧ RequestAttributionCorrect ∧ RequestStateCommitGenerationMatch ∧ NextInputPlacementCorrect`

## Architecture Breakdown

System architecture：vLLM asynchronous model-output path。

1. Model forward 產生 hidden states/logits。
2. Sampler 在 GPU 產生 `sampled_token_ids`。
3. default compute stream完成 sampling dependencies。
4. dedicated async output copy stream等待 default stream。
5. sampled token / logprobs / NaN diagnostics以 non-blocking D2H copy至 CPU。
6. copy stream record completion event。
7. CPU `get_output()` synchronize event。
8. rejection/spec-decode path解析 accepted tokens；一般 decode直接轉 list。
9. invalid/padded request rows被排除。
10. `ModelRunnerOutput` publication給 scheduler/engine。
11. request state更新 output tokens / computed-token counters。
12. 下一輪將 previous sampled token重新注入 GPU input buffer。

這條 architecture 將 `GPU result` 與 `runtime state transition` 明確分開。

## Bottom-Level Logic

Bottom-level mechanism：cross-stream asynchronous D2H publication。

`Sampling write(device buffer)`
→ `compute-stream completion order`
→ `copy-stream wait_stream(compute)`
→ `cudaMemcpyAsync-like D2H`
→ `source device tensor lifetime retained`
→ `destination host buffer pending`
→ `CUDA event record on copy stream`
→ `CPU event synchronize`
→ `host tensor readable`
→ `row filtering / rejection parse`
→ `request attribution`
→ `request state commit`。

不能簡化成「sampling → token」。

## Visual Simulation Idea

### Autoregressive Token Publication & Feedback Loop Microscope

六層互動 timeline：

- GPU Compute Stream：logits → sampler → sampled token
- GPU Output Copy Stream：wait → D2H → event
- CPU Host Output：pending → readable → parsed
- Request/Batch Mapping：row → req_id / invalid / padded
- Scheduler State：commit token / accepted count / preemption state
- Next Decode Step：input_ids → position → KV write → next sample

可注入：

- `D2H_READ_BEFORE_EVENT`
- `DEVICE_SOURCE_REUSE_BEFORE_COPY_COMPLETE`
- `STALE_BATCH_ROW_ATTRIBUTION`
- `PADDED_ROW_SEMANTIC_LEAK`
- `SPEC_ACCEPT_COUNT_GENERATION_MISMATCH`
- `NEXT_INPUT_USES_WRONG_PREVIOUS_SAMPLE`

核心 UI：

`Sample Value ✓ | D2H Publication ✓ | Request Attribution ✗ | Next-Step State ✗`

## Code / GitHub

值得繼續讀的 current vLLM 路徑：

- `vllm/v1/worker/gpu_model_runner.py`
  - `AsyncGPUModelRunnerOutput.__init__`
  - `AsyncGPUModelRunnerOutput.get_output`
  - `_update_states`
  - previous sampled-token scatter/input preparation
- `vllm/v1/sample/sampler.py`
- `vllm/v1/sample/rejection_sampler.py`
- `vllm/v1/core/sched/`
- `vllm/v1/worker/gpu_input_batch.py`
- CUDA graph dispatcher / fullgraph replay utilities

值得追蹤的工程案例：vLLM #41841 stale padded request metadata；以及 persistent/in-place drafting attention metadata RFC #49488，後者顯示 speculative draft loop仍有 per-step host metadata rebuild / slot mapping recompute 的成本與 generation boundary。

## Papers

### SAGA: Workflow-Atomic Scheduling for AI Agent Inference on GPU Clusters
Authors: Dongxin Guo, Jikun Wu, Siu Ming Yiu
Year: 2026
Architecture: Agent Execution Graph + session-affinity batching + work stealing + Agent Fair Share
Contribution: 將 schedulable unit 從單一 LLM request提升為整個 agent workflow，利用跨 tool-call 的 KV reuse與session locality。
Reported result: 在作者的64-GPU SWE-bench/WebArena實驗中，task completion time相對 vLLM v0.15.1降低1.64×（geometric mean），GPU memory utilization提升1.22×；代價是 peak throughput約下降30%。
Limitations: 這是 workflow scheduling層研究，不直接提供 sampled-token D2H provenance verifier；需要 Hermes 把 workflow identity與本輪 request/decode-step generation接起來。

### Hybrid JIT-CUDA Graph Optimization for Low-Latency Large Language Model Inference
Authors: Divakar Kumar Yadav, Tian Zhao
Year: 2026
Architecture: static CUDA Graph regions + dynamic JIT regions
Contribution: 將 autoregressive inference切成可重播static區與runtime dynamic區。
Reported result: 作者在LLaMA-2 7B、single GPU、batch size 1設定報告 TTFT最高降低66%。
Limitations: 未解決 persistent buffer semantic generation / request attribution 的一般 provenance 問題。

## Unknown / Open Questions

1. `ModelRunnerOutput` publication到 scheduler state commit之間，是否有可直接觀測的 request/decode-step generation ID，而不是靠 Python object / row index隱式關聯？
2. async scheduling + speculative decoding時，optimistic output-token extension與後續 rejection correction能否形成單調、可驗證的 `RequestStateGeneration`？
3. sampled token回寫下一輪 GPU `input_ids`後，如何把該 token identity一路 join到 position generation、KV slot mapping、KV content generation？

## Knowledge Graph 新增 Node / Edge

Nodes：

- `SamplingDeviceGeneration`
- `SampledTokenDeviceLifetimeWitness`
- `D2HOutputCopyGeneration`
- `D2HOutputDependencyWitness`
- `HostSamplePublicationWitness`
- `SampledTokenPublicationIdentity`
- `RequestRowAttributionWitness`
- `PaddedRowSemanticGeneration`
- `RequestStateCommitGeneration`
- `AutoregressiveFeedbackEdge`
- `NextInputTokenGeneration`

Edges：

- `SampleKernelCompletionWitness --does_not_prove→ HostSamplePublicationWitness`
- `CorrectSampledTokenValue --does_not_prove→ CorrectRequestAttribution`
- `GraphReplaySuccess --does_not_prove→ RequestRowSemanticCorrectness`
- `HostSamplePublicationWitness --enables→ RequestStateCommitGeneration`
- `RequestStateCommitGeneration --produces→ NextInputTokenGeneration`
- `NextInputTokenGeneration --causes→ NextKVWriteGeneration`
- `NextKVWriteGeneration --conditions→ NextSamplingGeneration`

## 與歷史研究比較

前幾輪已完成 Attention numerical provenance、Split-KV merge、KV page-table identity、CPU→GPU metadata publication、CUDA stream ordering與persistent-buffer replay generation。本輪首次從 **GPU output端反向跨回 CPU/runtime**，因此不是重複 input-side H2D；它補上 autoregressive feedback loop缺失的另一半。

歷史鏈現在可連成：

`Scheduler/Request → CPU metadata → H2D → CUDA Graph / model → Attention/KV → logits → sampler → D2H → RequestStateCommit → next token input → next KV generation`。

## 本輪結束判斷

- 缺哪一層：`HostSamplePublication → scheduler commit → next-step input/KV write` 的 production request-scoped trace join。
- 哪個節點最淺：`RequestStateCommitGeneration`。
- 哪個概念仍只是名詞：跨 async/spec decode 的 `AutoregressiveFeedbackEdge` production witness。
- 哪個系統值得讀原始碼：vLLM scheduler output consumption、async scheduling、rejection sampler、spec-decode correction path。
- 哪篇論文需追引用：SAGA，因為它把 request state提升到 agent workflow state，正好是 Hermes 從 token provenance往 Agent Runtime provenance前進的橋。
- 哪個概念最適合視覺模擬：Autoregressive Token Publication & Feedback Loop Microscope。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Token Publication Verifier + Request-State Generation Tracker + Speculative-Correction Verifier + KV/Input Provenance Joiner + Workflow Identity Tracker + Causal Evidence Gate + Tool Executor`。

## 下一輪研究

`sampled_token_ids(device) → async D2H event → ModelRunnerOutput → scheduler consumption → request output_token_ids → accepted/rejected speculative tokens → num_computed_tokens → next SchedulerOutput → input_ids scatter → position generation → slot mapping → KV write generation → next attention → next sampled token`

下一輪重點不是再研究 CUDA Graph，而是建立 **token-level closed causal loop**，並開始把單次 LLM decode state提升到 Agent workflow state：`LLM token → tool-call parse → tool execution → observation → context mutation → next model request`。
