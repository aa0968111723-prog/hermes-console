# 【AI Agent × Multimodal Research Report】

**時間：2026-09-16 03:53（Asia/Taipei）**

**本輪主題：GPU Scheduler × Continuous Batching × KV Eviction/Preemption × Prefill/Decode Disaggregation × Agent-Aware KV Retention**

## 與歷史研究比較

上一輪已建立 KV Cache、Prefix Hash Chain、Cache Namespace 與 TTFT timing side-channel。本輪不重複 prefix-cache identity，而向下追 Scheduler 如何把多個 request 映射成 GPU work、HBM/KV block 如何成為 admission constraint，以及 Agent tool pause 為何讓傳統 serving policy 失效。

## 本小時新發現

1. vLLM V1 Scheduler 的 admission 不只是排隊：它同時受 token budget、input budget、max running requests、LoRA 限制、encoder compute、KV block allocation 等約束。
2. KV allocation 失敗時，vLLM 會依 FCFS/PRIORITY policy 選 victim preempt；被搶占 request 的已排 token budget 也會被退回，因此 scheduling 與 KV residency 是同一個 feedback loop。
3. vLLM SchedulerConfig 已出現 watermark、scheduler_reserve_full_isl、prefill_schedule_interval 等控制：watermark 保留 KV headroom 以減少 eviction/preemption；reserve-full-ISL 避免 chunked prefill 過度 admission。
4. Prefill/Decode disaggregation 把兩個計算相位放到不同 vLLM instances，透過 KV connector 搬運 prefill KV；它能分別調 TTFT/ITL，但也新增 KV transfer、remote-KV waiting 與 connector correctness 邊界。
5. Agent workload 與 chatbot workload 不同：tool call 造成短暫 pause。Continuum 以 tool-aware KV TTL + program-level scheduling 選擇是否在 pause 中保留 KV，Berkeley 2026 technical report 在 SWE-Bench/BFCL/OpenHands 類 workload 報告平均 job completion time 超過 8× 改善（依其測試設定）。

## 本小時最重要 5 個發現

### 1. Continuous batching 的核心不是「把很多 prompt 一起跑」，而是每個 engine step 重新形成可執行集合

底層鏈：Waiting/Running Requests → Scheduling Policy → token/input budget → KV block feasibility → preemption/admission → scheduled token counts → model forward → outputs → state update → next scheduling step。

因此 batch membership 會隨 request 完成、decode、prefill chunk、KV pressure、remote KV arrival 而動態變化。這是 throughput 高的來源，也是 cross-request latency coupling 的來源。

### 2. KV Cache 是 Scheduler 的資源貨幣

當新 token 需要 block 而 allocator 無法提供時，Scheduler 必須：找 victim → 確認其 blocks 可釋放 → preempt → 回收其 token/input budget → free/recompute/offload → 重新嘗試 allocation。

所以：`KV pressure → victim selection → recomputation/restore → queue delay → TTFT/ITL`。

官方 vLLM Ascend batch-invariance 文件也指出，KV 不足觸發 preemption，之後 recompute 會讓原先 decode token 重新走 prefill path，甚至破壞 batch invariance。

### 3. Prefill 與 Decode 是不同資源形狀

Prefill 對大量 prompt tokens 做高平行度矩陣計算，偏 compute-bound；Decode 每 step 通常只新增少量 token，但需讀取長 KV history，較偏 memory-bandwidth / KV-residency bound。

P/D disaggregation：Request → Prefill Instance → prompt compute + KV → KV Connector → Decode Instance → autoregressive decode。

vLLM 官方說明其主要目的為獨立調 TTFT 與 ITL、降低 prefill 插入 decode 所造成的 tail ITL；實作位於 `vllm/distributed/kv_transfer`，核心 abstraction 包含 Connector 與 LookupBuffer。

### 4. Agent Tool Pause 應成為 Inference Scheduler 的一級訊號

傳統 scheduler 看見 request 暫時沒有下一個 token request，容易把 KV 視為可犧牲資源；但 Agent 可能只是在等 300ms–3s 的 tool call，下一輪會帶著幾乎相同 prefix 回來。

Continuum：Agent turn → tool call prediction → compute reload/recompute cost + queue cost → assign KV TTL → pin temporarily → tool returns → reuse resident KV；TTL 到期則允許 eviction。

這建立新節點 `AgentProgramContinuity`：serving scheduler 不只看單次 request，而應理解同一 Agent job 的跨 turn continuity。

### 5. Scheduler 是新的資訊流與公平性邊界

即使 prefix cache 已按 principal 隔離，不同 tenant 仍共享 GPU execution slots、HBM capacity、memory bandwidth、queue。某 tenant 的長 prefill/KV pressure 可以改變另一 tenant 的 preemption、TTFT、ITL。

因此 `CacheIsolation != ResourceIsolation`。2026 contention timing 實驗也顯示 workload concurrency 會顯著改變 timing distribution；這證明 scheduler/load 是 observable coupling，但目前不能直接推論成穩定可利用的 scheduler attack。

## Architecture Breakdown

Agent Runtime
→ Model Router
→ Inference Security Gateway
→ Program/Principal Metadata
→ Scheduler
  ├ Waiting Queue (FCFS/Priority)
  ├ Running Set
  ├ Token Budget
  ├ Input Budget
  ├ Encoder Budget
  ├ KV Admission
  ├ Watermark
  └ Preemption Policy
→ KV Cache Manager / Block Pool
→ Prefill Queue / Decode Queue
→ GPU Forward
→ Sampling
→ Output
→ Tool Pause
→ Agent Resume
→ Scheduler again

P/D mode：Scheduler/Prefill Node → KV Connector → remote KV transport → Decode Scheduler → GPU Decode。

## Bottom-Level Logic

### Admission

For request r：
`admit(r) = token_budget_ok ∧ input_budget_ok ∧ running_slots_ok ∧ KV_blocks_available ∧ adapter/encoder_constraints_ok`。

若 KV allocation failure：選 victim v → preempt(v) → reclaim blocks/budget → retry allocation。

### Watermark

保留一部分 free KV blocks，不把 HBM 壓到 100% 才處理，目標是降低 thrashing：`admit only if post-allocation free_blocks >= watermark`（概念模型；實際條件依 vLLM manager implementation）。

### P/D

Prefill：Prompt tokens → Transformer → K/V tensors → KV blocks。
Transfer：KV blocks + request metadata → connector/buffer → decode node。
Decode：load/attach remote KV → Q_new attends K/V history → next token。

### Agent-aware TTL

Tool pause duration T_tool 與 KV reload/recompute cost C_restore、memory opportunity cost C_hold 共同決定是否 pin：若預期短 pause 且 restore/queue penalty 高，保留 KV；TTL 到期釋放，避免長工具工作永久佔 HBM。

## Visual Simulation Idea

### GPU Scheduler & Agent KV Residency Simulator

三層同步時間軸：
1. Agent：LLM → Tool → LLM → Tool → LLM。
2. Scheduler：WAITING/RUNNING/PREEMPTED/REMOTE_KV_WAIT。
3. GPU/HBM：Prefill kernels、Decode kernels、KV blocks、free watermark。

互動：tenant 數、prompt/output 長度、tool pause、KV capacity、watermark、FCFS/Priority、TTL、chunked prefill、P/D disaggregation。

輸出：TTFT、ITL、job completion time、preemption count、recompute tokens、KV hit/residency、HBM pressure、per-principal slowdown/fairness。

## Code / GitHub

### vLLM
已深入：
- `vllm/v1/core/sched/scheduler.py`：KV allocation failure 後 victim selection/preemption；running/waiting admission；token/input/encoder budgets；remote KV waiting。
- `vllm/v1/core/sched/request_queue.py`：FCFS 與 Priority queues，Priority 依 `(priority, arrival_time)`。
- `vllm/v1/core/sched/async_scheduler.py`：下一輪追 async scheduling。
- `vllm/v1/core/kv_cache_manager.py` / `block_pool.py`：下一輪追 eviction/refcount/free path。
- `vllm/distributed/kv_transfer/`：P/D connector boundary。

### Continuum
Code preview: https://github.com/Hanchenli/vllm-continuum
值得追：tool-duration prediction、KV TTL decision、program-level FCFS 與 vLLM integration points。

## Papers

### Continuum: Efficient and Robust Multi-Turn LLM Agent Scheduling with KV Cache Time-to-Live
Authors: Hanchen Li, Qiuyang Mang, Huanzhi Mao, Joseph Gonzalez, Ion Stoica 等；Institution: UC Berkeley；2026 technical report UCB/EECS-2026-234（另有 2025 arXiv 版本）。Architecture: tool-aware KV TTL + program-level scheduling。Contribution: 把 Agent tool pause 與跨 turn KV continuity納入 serving scheduler。Limitations: tool-duration uncertainty、workload/hardware dependence；需追 code 與完整 evaluation。

### SwiftCache: Efficient LLM Serving for Multi-turn Conversations with Heterogeneous KV Cache Sharing
Authors: Jianmin Hu et al.; 2026; arXiv:2606.16135。Architecture: heterogeneous models 借用閒置 GPU memory/NVLink 保存高需求模型 prefix cache，active-layer KV local residency。Reported: P99 TTFT 最多降低 69%、max context 最多 3.98×（依其 workloads）。Limitations: cross-model placement/coordination complexity，需進一步檢查 isolation/fairness。

### Governing the KV Cache (KVGov)
Tejasvi C. Addagada; 2026; arXiv:2608.09225。與本輪關係：prefix identity isolation 解決 cache-sharing channel，但不等於 scheduler/HBM isolation。

### Characterizing Contention-Induced Reliability Collapse in KV-Cache Timing Side Channels
Rana Abu Bakar; 2026-09。與本輪關係：實驗證明 concurrency depth/load regime 會改變 timing observability；不能把 contention noise 當安全保證。

## 已確認 / 推論 / 假說

**官方/原始碼已確認**：vLLM V1 scheduler 存在 FCFS/PRIORITY queues、KV allocation driven preemption、token/input budgets、watermark/reserve controls；P/D disaggregation以獨立 instances + KV connector運作。

**論文結果**：Agent-aware KV TTL/program scheduling、heterogeneous KV sharing可在各自 benchmark 顯著改善 latency/throughput。

**Hermes 工程推論**：Model Router 應向 serving layer傳遞 `principal_id + agent_job_id + turn_id + expected_resume_class + confidentiality domain`，但不能讓 LLM 自己指定高優先級或永久 pin。

**尚未驗證假說**：跨 principal scheduler/HBM contention 是否足以穩定推論另一 Agent 的 tool-pause/reasoning phase；需要 controlled experiment。

## Unknown / Open Questions

1. Principal-isolated prefix cache 後，shared continuous batching/HBM bandwidth 能否建立可重複的 cross-tenant side channel？
2. Agent-aware KV TTL 如何避免 adversarial agent 謊報短 tool duration 來長期 pin HBM？
3. P/D disaggregation 中 KV transfer metadata、buffer occupancy、remote wait time 是否形成新的 privacy/DoS surface？

## 下一輪研究

`PagedAttention / BlockPool × KV Eviction Algorithms × Async Scheduling × Chunked Prefill × Fairness/QoS × HBM Bandwidth Contention × SGLang RadixAttention`。

## Knowledge Graph 新增 Node

ContinuousBatching, SchedulerStep, TokenBudget, InputBudget, KVAdmission, KVWatermark, RequestPreemption, RecomputePath, AgentProgramContinuity, ToolPause, KVRetentionTTL, ProgramLevelScheduling, PrefillPhase, DecodePhase, PrefillDecodeDisaggregation, KVTransferConnector, RemoteKVWait, HBMPressure, SchedulerCoupling, ResourceIsolationBoundary。

## Knowledge Graph 新增 Edge

- `KVPressure -> TRIGGERS -> RequestPreemption`
- `RequestPreemption -> CAUSES -> RecomputeOrRestore`
- `RecomputeOrRestore -> INCREASES -> JobCompletionTime`
- `ToolPause -> INTERRUPTS -> AgentInferenceSequence`
- `KVRetentionTTL -> PRESERVES -> AgentProgramContinuity`
- `KVRetentionTTL -> CONSUMES -> HBMCapacity`
- `PrefillPhase -> PRODUCES -> KVCache`
- `KVTransferConnector -> MOVES -> KVCache`
- `DecodePhase -> CONSUMES -> KVCache`
- `Watermark -> REDUCES_RISK_OF -> KVThrashing`
- `SharedScheduler -> COUPLES -> TenantLatency`
- `CacheIsolationBoundary -> DOES_NOT_IMPLY -> ResourceIsolationBoundary`

## 每輪結束檢查

- 缺哪一層：PagedAttention physical block mapping、BlockPool eviction/refcount、GPU kernel/HBM bandwidth arbitration。
- 哪個節點最淺：SchedulerCoupling、ResourceIsolationBoundary、RemoteKVWait security semantics。
- 哪個概念仍只是名詞：cross-principal scheduler noninterference。
- 哪個系統值得讀原始碼：vLLM `block_pool.py` + `kv_cache_manager.py` + `async_scheduler.py`；再比較 SGLang RadixAttention scheduler。
- 哪篇論文需追引用：Continuum，尤其 agent-program scheduling 與 KV retention baselines；其次 SwiftCache。
- 哪個概念最適合視覺模擬：GPU Scheduler & Agent KV Residency Simulator。
- 哪個 Agent 架構最值得實作：Hermes `AgentAwareInferenceSchedulerAdapter`，把 job/turn/principal metadata送到 serving policy，但由 server-side policy決定 priority/TTL。

## 從「使用者說一句話」往 GPU 再還原一層

User → UI → Agent → Context → Reasoning/Planning → Model Router → Inference Security Gateway → Scheduler Admission → KV Block Allocation → Prefill → KV Residency → Continuous Batch → Decode → Logits/Sampling → Output Token → Agent → Tool Pause → Resume → Scheduler Re-admission。

多模態：Camera/Image/Voice/Video → Encoder → modality tokens/features → encoder cache/KV-related residency → Scheduler encoder budget → fusion/attention → decode → Agent action。

**本輪核心答案**：Inference Server 不是被動地「跑模型」。它持續在 requests、token budget、KV blocks、HBM、prefill/decode phases之間做資源決策。對 Agent 而言，Tool Call 甚至會反過來改變 GPU 層的最佳 scheduling 策略；因此完整的 AI Agent 底層圖必須把 `Agent program state ↔ inference scheduler ↔ KV residency ↔ GPU resource pressure` 畫成雙向回饋，而不是單向的 Model API 呼叫。