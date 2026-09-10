# 【AI Agent × Multimodal Research Report】

**時間：2026-09-10 08:54（Asia/Taipei）**  
**本輪主題：Preemption × Checkpointing × KV / Tool State Migration × Resume Cost × Exactly-Once Continuation**

---

## 0. 與歷史研究比較：本輪為什麼不是重複

上一輪 `2026-09-10-deadline-critical-path-multi-resource-scheduling.md` 已完成：

```text
Dynamic Workflow DAG
→ Critical Path
→ Slack / Deadline Risk
→ Multi-Resource Reservation
→ Priority Inheritance
→ Resource-local Scheduler
```

但上一輪只回答「哪一個 ready stage 應優先執行」，尚未回答一個更底層的 runtime 問題：

```text
Low-priority stage 已經跑了 40 秒
↓
High-priority critical-path stage 抵達
↓
現在怎麼辦？
```

若 runtime 只能讓舊工作「跑完」或「整個丟掉重算」，deadline-aware scheduler 的價值會被 state-loss / resume cost 吃掉。

本輪因此專注新的缺口：

```text
Execution
↓
Safe Preemption Point
↓
Checkpoint / State Capture
↓
Offload / Migration / Recompute
↓
Resume
↓
Continuation Identity
↓
Commit Fence
↓
Exactly-once Effect / At-least-once Execution
```

這輪會把 LLM GPU state、Agent state、Tool state、Browser/Sandbox state 分開，不把「checkpoint」當成單一名詞。

---

# 一、本小時新發現

## 新架構 1：vLLM V1 的 preemption 本質上仍偏向「釋放 KV → 之後重算」

**已確認官方資訊。**

vLLM 最新 Optimization/Tuning 文件明確指出：KV cache 空間不足時，scheduler 會 preempt requests 以釋放 KV；preempted requests 在有資源時重新計算。V1 預設 preemption mode 是 `RECOMPUTE`，而非舊式 `SWAP`，理由是 V1 架構下 recomputation overhead 較低。

來源：
- https://docs.vllm.ai/en/latest/configuration/optimization/
- https://docs.vllm.ai/en/latest/api/vllm/v1/core/sched/scheduler/

在最新 scheduler 原始碼中，`_preempt_request()` 會把 request 放回 waiting queue；最新 API source 還有 `drop_stale_output` 機制，用於避免 preemption + same-step resumption 或 pending KV handoff 時把失效的 in-flight token output 交出去。

這表示 vLLM 已經具備一個非常重要的 continuation primitive：

```text
RUNNING
↓ preempt
WAITING
↓ reschedule
RUNNING
```

但它的 continuation state 並不是完整 process checkpoint，而主要依賴 request metadata + 可保留/重建的 KV history。

---

## 新架構 2：vLLM Ascend 出現「preempt 但不必重做長 Prefill」的 CPU KV 保存路徑

**已確認官方資訊。**

`RecomputeCPUOffloadConnector` 的設計是：Decode HBM KV block 不足時，先把即將被搶占 request 已計算出的 KV 從 HBM 搬到 CPU DRAM，再讓 HBM block 被重用；request 重新排程時，再 H2D restore 回 GPU。

底層流程：

```text
Decode Request Running
↓
HBM KV Pressure
↓
Preemption Candidate
↓
KV Block HBM → CPU DRAM
↓
HBM Blocks Reclaimed
↓
Request WAITING
↓
Request Rescheduled
↓
CPU DRAM → HBM
↓
Model Forward Continues
```

這和純 RECOMPUTE 的差異是：

```text
RECOMPUTE
Prompt Tokens
→ Prefill Again
→ Rebuild KV
→ Resume Decode
```

vs.

```text
OFFLOAD
Existing KV
→ CPU Preserve
→ H2D Restore
→ Resume Decode
```

來源：
- https://docs.vllm.ai/projects/ascend/en/main/user_guide/feature_guide/recompute_cpu_offload.html

這是一個很重要的新 Knowledge Graph edge：

```text
Preemption
→ may_recover_by
Recompute

Preemption
→ may_recover_by
State Preservation
```

而不是把 preemption 與 recompute 綁死。

---

## 新架構 3：Llumnix 把「request + in-memory state」做成跨 model instance live migration

**已確認論文、官方專案與原始碼。**

Llumnix（OSDI 2024）把 LLM request rescheduling 類比作 OS context switching：request 不一定終生綁定在最初 instance，而可以為 load balance、defragmentation、priority/SLO 或 elasticity 在 runtime 中移動。

論文資訊：

- **Title**: Llumnix: Dynamic Scheduling for Large Language Model Serving
- **Authors**: Biao Sun, Ziming Huang, Hanyu Zhao, Wencong Xiao, Xinyi Zhang, Yong Li, Wei Lin
- **Institution**: Alibaba Group
- **Year**: 2024, OSDI '24
- **URL**: https://www.usenix.org/conference/osdi24/presentation/sun-biao
- **Code**: https://github.com/llumnix-project/llumnix-ray （現行專案）；OSDI artifact: https://github.com/alibaba/llm-scheduling-artifact
- **Dataset / Workload**: 專案公開評估描述使用 ShareGPT request length distribution、Poisson arrivals；OSDI artifact 提供可重現實驗腳本。
- **Architecture**: global scheduling + instance load state + request migration + KV-cache-aware rescheduling
- **Contribution**: 讓 request 已開始執行後仍能跨 instance 動態重新排程，而不只 admission-time routing。
- **Limitations**: migration 仍有 state transfer、network contention、coordination、implementation coupling；現行 llumnix-ray README 也標示 alpha stage。

USENIX 官方頁報告：Llumnix 在論文 workload 中 tail latency 改善可達 order-of-magnitude、高優先 request 最多 1.5× 加速、在相近 tail latency 下最多 36% cost saving。這些數字只能視為其特定評估結果，不可泛化為所有 GPU/模型/traffic。

### 原始碼追讀

本輪不只讀 README；現行 `llumnix-project/llumnix-ray` 值得看的目錄：

```text
llumnix/
├ backends/vllm_v1/
│  └ migration_frontend.py
├ llumlet/
│  ├ llumlet.py
│  └ local_migration_scheduler.py
├ global_scheduler/
│  ├ migration_scheduler.py
│  ├ migration_policy.py
│  └ migration_filter.py
├ manager.py
├ instance_info.py
└ config/default.py
```

`migration_frontend.py` 目前會：

```text
EngineCoreRequest
↓
寫入 SRC_INFO
↓
Msgpack encode
↓
MIGRATE_TO_REQ
↓
PeerManager 尋找 destination instance
↓
RPC
↓
等待 MIGRATE_TO_RESP
```

程式碼還有 retry loop，migration frontend 對 target naming instance 做兩次嘗試。

這說明「request migration」不是只有 scheduler 改 owner，而需要：

```text
Control-plane ownership transfer
+
Execution request serialization
+
KV / runtime state transfer
+
Destination acceptance
+
Source-side retirement
```

---

## 新底層機制 4：2026 Concordia 把 checkpoint 從 framework 下沉到 GPU persistent kernel

**已確認論文摘要；完整 artifact/code affiliation 尚未在本輪驗證，故不假設。**

- **Title**: Concordia: JIT-Compiled Persistent-Kernel Checkpointing for Fault-Tolerant LLM Inference
- **Authors**: Yuhang Gan, Yiwei Yang, Yuyi Li, Xiangyu Gao, Yichen Wang, Rain Jiang, Xiaoning Ding, Andi Quinn, Chen Qian
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2606.23521
- **Code**: 本輪未驗證公開 code URL
- **Dataset**: 本輪未確認具名 dataset；研究焦點是 fault-tolerant LLM inference runtime
- **Architecture**: device-resident persistent kernel + PTX/SASS instrumentation + JIT delta-checkpoint handler + lock-free ring buffer + CPU-visible append log
- **Contribution**: checkpoint hook 可以插在 framework/library 以下、靠近真正執行的 GPU kernels 與同步點；針對 KV blocks、adapter pages 等狀態做 delta checkpoint。
- **Limitations**: 這是 inference fault tolerance 研究，不等於完整 Agent continuation；Tool/Browser/MCP/外部 effect 並不會自動被 GPU checkpoint 捕捉。

其核心架構：

```text
CUDA / GPU Module Load
↓
PTX / SASS Instrumentation
↓
Persistent Kernel
├ compute task
├ checkpoint task
├ append-log task
└ recovery task
↓
Dirty State Detection
↓
Delta Checkpoint
↓
CPU-visible Log (CXL / Host DRAM)
↓
Recovery Apply
```

這一點對 Hermes 非常重要，因為真正的 Agent checkpoint 不應假設所有 state 都在 Python object 裡。

長時間 LLM / multimodal work 的 state 可能分散在：

```text
Host Scheduler State
GPU KV Cache
CUDA Graph / Runtime Context
Adapter State
Sampler State
RNG State
Transfer State
Tool Worker State
Artifact Store
```

所以：

```text
Python Checkpoint
≠
Execution Checkpoint
```

---

## 新機制 5：Exactly-once continuation 不能等同 exactly-once execution

**已確認分散式執行工程事實；Temporal 官方首頁 + 官方社群/文件相關說明交叉支持。**

Temporal 的核心價值是 durable workflow history：worker crash 後可以 replay history 重建 workflow state。但 Activity 外部副作用預設常是 at-least-once execution 語義，因為可能發生：

```text
Activity 外部操作已完成
↓
Worker 在回報完成前 crash / network failure
↓
Server 未看到 completion
↓
Retry
↓
同一 business effect 可能再次執行
```

因此：

```text
Durable Workflow Replay
≠
Exactly-once External Side Effect
```

來源：
- https://docs.temporal.io/
- https://community.temporal.io/t/execution-guarantees-of-activities/3405

Ray object fault tolerance 也展示另一種 recovery：若 object 值遺失，Ray 可利用 lineage reconstruction 重新執行產生該 object 的 task；但文件清楚指出這依賴 task deterministic/idempotent，而且 owner failure 與 `ray.put` 物件有額外限制。

來源：
- https://docs.ray.io/en/master/ray-core/fault_tolerance/objects.html

這使 Hermes 必須把三個概念拆開：

```text
Execution Exactly Once
Continuation Exactly Once
Effect Exactly Once
```

更精確地說，現實 production system 往往應追求：

```text
Execution:
AT-LEAST-ONCE or RECOMPUTABLE

Continuation Commit:
SINGLE WINNER / FENCED

External Effect:
IDEMPOTENT or EFFECT-ID DEDUPED
```

而不是宣稱底層任何 code 都真的只跑一次。

---

# 二、本小時最重要 5 個發現

## 發現 1 — Preemption 其實有五種不同語義，不能只叫「暫停」

### 概念

Hermes 應把 Preemption Mode 分成至少：

```text
P0 WAIT_TO_FINISH
P1 ABORT_AND_RESTART
P2 RECOMPUTE_FROM_INPUT
P3 CHECKPOINT_AND_RESUME
P4 LIVE_MIGRATE
```

### 底層如何運作

#### P1 Abort

```text
RUNNING
→ CANCEL
→ release state
→ restart from beginning
```

#### P2 Recompute

```text
Request metadata retained
→ KV released
→ later schedule
→ replay prompt / prefix
→ rebuild transient state
```

vLLM V1 default preemption 大致偏這一類。

#### P3 Checkpoint

```text
Pause boundary
→ serialize sufficient continuation state
→ free active resource
→ restore state later
→ continue
```

#### P4 Live Migration

```text
Source continues / quiesces
→ copy stable state
→ copy delta state
→ destination catches up
→ ownership handoff
→ destination resumes
→ source retires
```

### 為什麼重要

因為 scheduler 的最佳 decision 不只看 urgency，還要看：

```text
PreemptionBenefit
-
CheckpointCost
-
TransferCost
-
ResumeCost
-
LostWorkCost
-
CacheLocalityLoss
```

### 限制

不同 stage 的 preemptibility 完全不同：decode token boundary 很細；GPU diffusion step 較粗；外部 API call 可能根本不可搶占。

### 來源

vLLM 官方 preemption；vLLM Ascend CPU offload；Llumnix OSDI / code。

---

## 發現 2 — Safe Preemption Point 是 continuation correctness 的核心

### 是什麼

不是任何 instruction 都可以隨便 checkpoint。

應該有：

```text
SafePreemptionPoint
=
state is internally consistent
∧ external effect boundary known
∧ enough state captured to resume
```

### LLM Decode

自然 safe point 接近 token / iteration boundary：

```text
Forward
↓
Logits
↓
Sampling
↓
Append Token
↓
Append KV
↓
COMMIT TOKEN STEP
↓
SAFE POINT
```

若在：

```text
Token 已寫 request output
但 KV 尚未一致
```

時 checkpoint，resume 後可能 duplicate token 或 KV/token index 不一致。

### Tool

對 Tool 呼叫：

```text
Intent
↓
Arguments
↓
Dispatch
↓
External Effect
↓
Observation
↓
Commit Observation
```

真正 safe point 必須分辨：

```text
NOT_STARTED
DISPATCHED_UNKNOWN
EFFECT_CONFIRMED
OBSERVATION_COMMITTED
```

其中最危險的是 `DISPATCHED_UNKNOWN`：你不知道 side effect 是否其實已成功。

### 為什麼重要

所以 Hermes 的 checkpoint 不能只是：

```text
json.dump(agent_state)
```

而需要「execution phase + effect phase」一起保存。

---

## 發現 3 — Resume State 不是 KV Cache 一份資料，而是 Continuation Capsule

本輪提出 Hermes 的新 runtime object：

```text
ContinuationCapsule
├ continuation_id
├ workflow_id
├ stage_id
├ attempt_id
├ generation
├ capability_epoch
├ input_hash
├ model_revision
├ tokenizer_revision
├ processor_revision
├ execution_phase
├ committed_output_cursor
├ model_state_ref
├ kv_state_ref
├ sampler_state
├ rng_state
├ multimodal_state_refs[]
├ tool_state_ref
├ browser_state_ref
├ sandbox_snapshot_ref
├ artifact_refs[]
├ pending_effects[]
├ checkpoint_epoch
└ integrity_hash
```

### 為什麼不是所有欄位都一定要真的 materialize？

因為部分 state 可以重建：

```text
Raw prompt retained
→ KV may recompute
```

部分 state 應保存：

```text
Video diffusion latent after 800 expensive steps
→ checkpoint may be cheaper
```

部分 state 無法安全「存檔重播」：

```text
Bank transfer already dispatched
→ need idempotency/fencing/reconciliation
```

所以 Capsule 應保存「state 或 reconstruct recipe」，而非全部 bytes。

---

## 發現 4 — Migration 應採 Stable Prefix + Evolving Delta，而不是每次停機完整搬家

Llumnix 已證實 LLM request live migration 的核心價值，而 2026 Pallas 又展示一個特別適合多模態/移動場景的概念。

- **Title**: Pallas: A Proactive KV Cache Migration Framework for LLM Inference in AI-RAN
- **Authors**: Tianhang Ding, Jianchun Liu, Hongli Xu
- **Year**: 2026
- **URL**: https://arxiv.org/abs/2608.16477
- **Code**: 本輪未驗證公開 code
- **Dataset / setup**: 論文摘要描述三種 LLM 與 100–500 Mbps inter-gNB links；具名 dataset 本輪未確認。
- **Architecture**: mobility prediction → proactive preparation → stable historical prefix local reconstruction + evolving suffix KV streaming → handover assembly
- **Contribution**: 不等 handover 發生才開始 recovery，而是在 source 還服務時先讓 target 準備 continuation state。
- **Result**: 摘要報告相對 target-side recovery，average service interruption time 改善 2.28–89.68×；相對 source forwarding，average ITL 降低 16–50%。僅代表其實驗條件。
- **Limitations**: 需要 handover prediction；錯誤 prediction 會產生 wasted work / network traffic；AI-RAN 場景不可直接等同 datacenter Agent scheduling。

這可泛化為 Hermes 的 migration pipeline：

```text
State
├ Stable Prefix
└ Mutable Tail

Stable Prefix
→ pre-copy / reconstruct at destination

Mutable Tail
→ delta log / incremental copy

Final Quiesce
→ copy final delta
→ transfer authority
→ resume
```

這和 VM live migration 的 pre-copy / delta 思維非常接近。

---

## 發現 5 — Exactly-once Continuation 最可行的定義是「單一 canonical commit lineage」

不要定義：

```text
這段工作在宇宙中只執行過一次
```

應該定義：

```text
一個 continuation generation
最多只有一條 completion lineage
可以修改 canonical Agent state
```

例如：

```text
Continuation C17
├ Attempt A on GPU0
└ Attempt B on GPU1 after recovery
```

A 可能其實在 timeout 後繼續跑完。
B 也可能完成。

Correctness 不依賴「只有一個執行成功」，而依賴：

```text
ContinuationCommitGate(C17)
↓
CAS OPEN → COMMITTED_BY(B)
↓
A later completion
↓
STALE LOSER
↓
must not advance canonical cursor
```

因此本輪正式新增：

```text
Exactly-Once Execution
≠
Exactly-Once Continuation Commit
```

後者才是 Hermes 應真正保證的 system property。

---

# 三、Architecture Breakdown

## Hermes Preemptible Continuation Runtime

```text
UI / User Goal
↓
Agent Planner
↓
Dynamic Workflow DAG
↓
Deadline / Critical Path Scheduler
↓
Running Stage
↓
Preemption Decision Engine
├ remaining service cost
├ current slack
├ victim priority
├ lost-work estimate
├ checkpoint cost
├ transfer cost
├ resume cost
├ state size
├ effect class
└ destination availability
↓
Preemption Strategy
├ LET_FINISH
├ CANCEL_RESTART
├ RECOMPUTE
├ CHECKPOINT
├ OFFLOAD
└ LIVE_MIGRATE
↓
Safe Point Coordinator
↓
Continuation Capsule Builder
├ logical execution metadata
├ output commit cursor
├ model/KV state
├ RNG/sampler state
├ multimodal artifact refs
├ tool/effect state
├ browser/sandbox state
└ generation/fencing data
↓
Checkpoint Store / State Fabric
├ GPU HBM
├ CPU DRAM
├ NVMe
├ KV Cache Store
├ Artifact Store
└ Durable Event Log
↓
Destination / Later Resume
↓
Restore Planner
├ load exact state
├ recompute state
├ fetch remote KV
└ hybrid materialization
↓
Continuation Validator
↓
Resume
↓
Completion Envelope
↓
Continuation Commit Gate
↓
Canonical Agent State
```

---

# 四、Bottom-Level Logic

## 4.1 Preempt or Finish？

本輪提出一個初始工程模型：

```text
NetPreemptValue =
DeadlineBenefit
+ CapacityBenefit
+ PriorityBenefit
-
CheckpointCost
-
MigrationCost
-
ResumeCost
-
LostWorkCost
-
StateLocalityPenalty
-
CorrectnessRisk
```

例如：

```text
Video Stage V
remaining = 18s
checkpoint = 7s
resume = 2s

High Priority Tool H
deadline miss without preemption = 12s
```

如果：

```text
checkpoint + resume + interference
>
let-finish wait
```

即使 H priority 較高，preempt V 也可能是錯的。

所以：

```text
Higher Priority
≠
Always Preempt Lower Priority
```

---

## 4.2 KV State Recovery 的三條路

### 路 1：Recompute

```text
Prompt / Token History
↓
Prefill Again
↓
Recreate KV
↓
Resume Decode
```

成本大致和 prefix length、model size、prefill throughput 有關。

### 路 2：Offload / Reload

```text
GPU KV Blocks
↓ D2H
CPU / Storage
↓ H2D
GPU KV Blocks
↓
Resume
```

成本和 KV bytes / bandwidth / queueing 有關。

### 路 3：Cross-instance Migration

```text
Source GPU KV
↓ serialize / block map
Network
↓
Destination KV allocation
↓
KV import
↓
Request ownership handoff
↓
Resume
```

成本額外包含：

```text
Network Transfer
Destination Allocation
Control-plane Coordination
Quiesce / Delta Catch-up
```

因此 runtime 應動態比較：

```text
Min(
  RecomputeCost,
  OffloadRestoreCost,
  MigrationCost
)
```

而不是硬編碼單一策略。

---

## 4.3 LLM continuation 必須保存 Output Commit Cursor

假設目前生成：

```text
... token[127]
```

GPU 已經推進到 token 128，但網路 streaming 還只交付到 127。

Checkpoint 如果只存 KV 128 而沒有 delivery / commit cursor：

```text
resume
→ 可能跳過 token 128
```

或重新送一次：

```text
duplicate output
```

因此至少應區分：

```text
model_progress_cursor
canonical_commit_cursor
client_delivery_cursor
```

三者不能視為同一個值。

新增：

```text
Computed Token
≠
Committed Token
≠
Delivered Token
```

這也直接呼應最新 vLLM scheduler 的 `drop_stale_output`：in-flight output 在某些 preemption / KV handoff 路徑不能直接被視為有效 canonical output。

---

## 4.4 Tool continuation 需要 Effect Journal

例如：

```text
Agent
↓
POST /create_order
↓ timeout
```

checkpoint 看到：

```text
Tool Stage = RUNNING
```

完全不夠。

應記錄：

```text
EffectJournalEntry
├ effect_id
├ tool_call_id
├ idempotency_key
├ dispatch_epoch
├ capability_epoch
├ request_hash
├ effect_class
├ phase
│  ├ PREPARED
│  ├ DISPATCHED_UNKNOWN
│  ├ ACKED
│  ├ VERIFIED
│  └ COMMITTED_TO_AGENT
├ external_reference
└ reconciliation_policy
```

Resume 時：

```text
PREPARED
→ safe to dispatch

DISPATCHED_UNKNOWN
→ query/reconcile first
→ DO NOT blindly retry irreversible effect

ACKED
→ recover observation / verify

COMMITTED_TO_AGENT
→ do not execute again
```

這是 Agent Runtime 與單純 GPU checkpoint 最大的差異。

---

## 4.5 Multimodal continuation 必須按照 modality state 分層

### Image/VLM

```text
Raw Image
→ Processor Config
→ Vision Encoder Feature
→ Projected Visual Tokens
→ Fusion Context
```

可 checkpoint 在不同邊界；越靠後越省 recompute，但 representation 對 model revision 綁得更緊。

### Video Generation / Diffusion-like Pipeline

Continuation 可能需要：

```text
latent_t
scheduler timestep t
noise / RNG state
conditioning embedding
prompt encoder revision
model weights revision
sampler config
```

如果只存 latent 不存 timestep / scheduler / RNG / model identity，就不能宣稱可 exact resume。

### Voice Streaming

需要另外處理：

```text
audio input cursor
VAD segment state
ASR decoder state
LLM context cursor
TTS synthesis cursor
client playback cursor
```

所以：

```text
Multimodal Checkpoint
≠
One Tensor Snapshot
```

---

# 五、Visual Simulation Idea

# Preemption, Checkpoint & Continuation Migration Lab

## 主畫面

左邊是一張 Agent Workflow DAG：

```text
User
 ↓
Plan
├─ LLM Decode A ───────┐
├─ MCP Search B ───────┤
└─ Video Gen C ────────┤
                        ↓
                    Synthesis
                        ↓
                      Output
```

底部資源 timeline：

```text
GPU0 [ Video C ................................. ]
GPU1 [ LLM A ......... ]
CPU  [ Search B ... ]
NET  [ KV transfer ..... ]
NVMe [ checkpoint write ... ]
```

使用者注入：

```text
HIGH PRIORITY REQUEST
GPU MEMORY PRESSURE
GPU FAILURE
TOOL TIMEOUT
INSTANCE SCALE-DOWN
NETWORK SLOWDOWN
MODEL HOTSWAP
```

## 模式切換

```text
NO PREEMPTION
ABORT / RESTART
RECOMPUTE
CPU OFFLOAD
CHECKPOINT / RESUME
LIVE MIGRATION
```

UI 即時計算：

```text
Lost Work          8.2s
Checkpoint Cost    1.3s
Transfer Cost      0.9s
Resume Cost        0.4s
Deadline Gain      6.7s
State Bytes        3.1 GB
Correctness Risk   LOW
```

## Continuation Capsule Viewer

點某個 stage：

```text
Continuation C-102
Generation       18
Capability Epoch 42
Execution Phase  DECODE
Model Cursor      512
Commit Cursor     509
Delivered Cursor  507
KV Blocks         65
KV Residency      GPU0
RNG Captured      YES
Tool Effects      NONE
```

## Race 模擬

```text
GPU0 Attempt A
↓ checkpoint timeout

GPU1 Attempt B
↓ resume
↓ reaches token 530

GPU0 A actually returns late
↓
Commit Gate
```

顯示：

```text
A generation 18 / attempt 1
B generation 18 / attempt 2

winner = B

A late completion
→ cache-only / discard
→ canonical state unchanged
```

這能把「preemption、checkpoint、migration、retry、exactly-once commit」五個經常混在一起的概念視覺化拆開。

---

# 六、Code / GitHub

## 6.1 vLLM

值得繼續追：

```text
vllm/v1/core/sched/scheduler.py
```

關鍵點：

```text
allocate_slots failure
→ choose preemption victim
→ _preempt_request()
→ waiting queue
```

以及 `drop_stale_output` 對 in-flight output correctness 的處理。

官方 source API：
https://docs.vllm.ai/en/latest/api/vllm/v1/core/sched/scheduler/

---

## 6.2 vLLM Ascend

值得追：

```text
RecomputeScheduler
RecomputeCPUOffloadConnector
MultiConnector
MooncakeConnectorV1
```

核心問題：

```text
HBM block ownership
D2H copy completion
block reuse fence
H2D restore completion
forward scheduling
```

文件：
https://docs.vllm.ai/projects/ascend/en/main/user_guide/feature_guide/recompute_cpu_offload.html

---

## 6.3 Llumnix

本輪已讀：

```text
llumnix/backends/vllm_v1/migration_frontend.py
```

建議下一層原始碼：

```text
llumnix/llumlet/llumlet.py
llumnix/llumlet/local_migration_scheduler.py
llumnix/global_scheduler/migration_scheduler.py
llumnix/global_scheduler/migration_policy.py
llumnix/global_scheduler/migration_filter.py
llumnix/manager.py
llumnix/instance_info.py
```

值得驗證的核心問題：

```text
Source 何時停止 decode？
Destination 何時取得 owner？
KV migration 是 blocking / pipelined / delta？
Migration failure 如何 rollback？
Old source output 如何 fence？
```

---

## 6.4 Ray

Ray Object Fault Tolerance 顯示：

```text
Object Lost
↓
Find other replica
↓ missing
Lineage Reconstruction
↓
Re-execute producer task
```

值得借用的不是 Ray API 本身，而是：

```text
State Bytes
vs
Reconstruction Recipe
```

這與 Hermes 前幾輪 Artifact Recipe / Reconstructibility Class 可以直接接起來。

---

# 七、Papers

## Paper A — Llumnix: Dynamic Scheduling for Large Language Model Serving

- Authors: Biao Sun, Ziming Huang, Hanyu Zhao, Wencong Xiao, Xinyi Zhang, Yong Li, Wei Lin
- Institution: Alibaba Group
- Year: 2024
- Venue: OSDI 2024
- URL: https://www.usenix.org/conference/osdi24/presentation/sun-biao
- Code: https://github.com/llumnix-project/llumnix-ray
- Artifact: https://github.com/alibaba/llm-scheduling-artifact
- Architecture: cross-instance dynamic request scheduling + live migration of requests/in-memory state
- Contribution: 將 LLM request rescheduling 從 dispatch-time routing 推到 runtime live migration
- Limitations: migration state cost、network、heterogeneous engines、coordination；現行 repo alpha
- Changed What: 讓 LLM inference request 更像 OS process，可在執行中重新 placement。

## Paper B — Concordia: JIT-Compiled Persistent-Kernel Checkpointing for Fault-Tolerant LLM Inference

- Authors: Yuhang Gan, Yiwei Yang, Yuyi Li, Xiangyu Gao, Yichen Wang, Rain Jiang, Xiaoning Ding, Andi Quinn, Chen Qian
- Institution: 本輪未完成可靠 affiliation 驗證，暫標記 unknown
- Year: 2026
- URL: https://arxiv.org/abs/2606.23521
- Code: 本輪未驗證
- Dataset: 本輪未驗證具名 dataset
- Architecture: persistent kernel + binary instrumentation + JIT delta checkpoint + append/recovery log
- Contribution: checkpoint hooks 下沉至 GPU execution context，避免 framework-specific checkpoint logic
- Limitations: 解決 GPU/inference state 不等於解決 Agent external effects
- Changed What: 把「LLM checkpoint」從 host framework object 層往實際 GPU kernel/state boundary 推進。

## Paper C — Pallas: A Proactive KV Cache Migration Framework for LLM Inference in AI-RAN

- Authors: Tianhang Ding, Jianchun Liu, Hongli Xu
- Institution: 本輪未完成 affiliation 驗證，暫標記 unknown
- Year: 2026
- URL: https://arxiv.org/abs/2608.16477
- Code: 本輪未驗證
- Dataset: 未確認具名 dataset；摘要提供 3 LLM + 100–500 Mbps links 的 evaluation setting
- Architecture: predicted target + stable prefix reconstruction + evolving suffix KV streaming + handover assembly
- Contribution: proactive rather than reactive state recovery
- Limitations: prediction error / bandwidth overhead；AI-RAN-specific
- Changed What: migration 不一定在切換發生後才開始，可讓 state preparation 與 source execution overlap。

---

# 八、Unknown / Open Questions

## 1. Agent Continuation Capsule 的最小充分狀態到底是什麼？

目前仍缺一個可跨：

```text
vLLM
SGLang
MCP
Browser
Sandbox
Video Generator
Voice Runtime
```

的 continuation ABI。

最深問題不是欄位格式，而是：

> 哪些 state 必須 byte-exact 保存，哪些能 deterministic reconstruct，哪些只能 semantic resume？

---

## 2. Tool side effect 位於 DISPATCHED_UNKNOWN 時，能否有通用 resume protocol？

對 transaction-capable DB 可以 query/reconcile。
對 email、social post、payment、physical robot action 等，語義完全不同。

可能需要：

```text
Effect Adapter Contract
├ idempotency key
├ query status
├ compensate
├ verify
└ non-repeatable declaration
```

但尚未形成統一 Agent tool standard。

---

## 3. GPU Checkpoint/Migration 與 Model Revision 如何相容？

如果：

```text
checkpoint produced by model revision A
↓
resume target runs revision B
```

KV shape、RoPE config、tokenizer、attention layout、quantization、adapter revision 任一不同，都可能讓 state 不可直接載入。

所以需要：

```text
ContinuationCompatibilityHash
=
H(
  model revision,
  tokenizer,
  processor,
  rope config,
  kv layout,
  dtype,
  tp/pp topology,
  adapter revision
)
```

這目前仍是 Hermes 工程模型。

---

# 九、Knowledge Graph 新增 Node / Edge

## Nodes

```text
Safe Preemption Point
Preemption Mode
Recompute Resume
State-Preservation Resume
CPU KV Offload
Live Request Migration
Continuation Capsule
Continuation Identity
Execution Phase
Model Progress Cursor
Canonical Commit Cursor
Client Delivery Cursor
Continuation Compatibility Hash
Checkpoint Epoch
Resume Planner
Restore Recipe
Effect Journal
Effect Phase
Dispatched-Unknown Effect
Migration Stable Prefix
Migration Mutable Tail
Migration Delta Log
Quiesce Point
Ownership Handoff
Continuation Commit Gate
Exactly-Once Continuation Commit
```

## Edges

```text
Deadline Scheduler
→ requests
Preemption

Preemption
→ selects
Preemption Mode

Preemption
→ requires
Safe Preemption Point

Safe Preemption Point
→ creates
Continuation Capsule

Continuation Capsule
→ may_reference
KV State

Continuation Capsule
→ may_reference
Artifact Recipe

Continuation Capsule
→ records
Effect Journal

Resume Planner
→ chooses
Recompute / Restore / Migrate

Live Migration
→ transfers
Continuation Ownership

Stable Prefix
→ can_pre_copy_to
Destination

Mutable Tail
→ generates
Migration Delta

Continuation Completion
→ validated_by
Continuation Commit Gate
```

## Negative / distinction edges

```text
Preemption
≠
Cancellation

Preemption
≠
Recompute

Checkpoint
≠
Full Process Snapshot

Computed Token
≠
Committed Token

Committed Token
≠
Delivered Token

Durable Replay
≠
Exactly-Once External Effect

Exactly-Once Execution
≠
Exactly-Once Continuation Commit

Python State
≠
Complete GPU Execution State

KV Migration
≠
Whole Agent Migration
```

---

# 十、下一輪研究

本輪把「可以搶占」拆到 continuation correctness 後，下一個最自然的缺口是：

# **Distributed Checkpoint Consistency × Multi-Component Barrier × Channel State × Coordinated / Uncoordinated Recovery × Domino Effect**

因為真正 Hermes 一個 stage 可能同時跨：

```text
Agent Runtime
↓
LLM Server
↓
MCP Tool
↓
Artifact Store
↓
Browser Worker
↓
GPU Generator
```

如果每個 component 各自 checkpoint：

```text
Agent checkpoint @ t10
GPU checkpoint @ t14
Tool checkpoint @ t7
Artifact DB @ t12
```

拼起來不一定是任何時刻真正存在過的 consistent execution state。

下一輪應研究：

```text
Distributed Execution Graph
↓
Checkpoint Barrier
↓
In-flight Messages / Effects
↓
Consistent Cut
↓
Checkpoint Dependency Graph
↓
Failure
↓
Recovery Line
↓
Avoid Domino Rollback
```

並比較：

```text
Coordinated Checkpointing
vs
Uncoordinated Checkpointing
vs
Communication-Induced Checkpointing
vs
Message Logging
vs
Event Sourcing Replay
```

進一步接回前面已研究的 Chandy-Lamport snapshot，但這次不是只研究 GC global cut，而是研究「Agent execution continuation recovery line」。

---

# 十一、本輪結束必答

**缺哪一層？**  
目前最缺的是 `single-stage Continuation Capsule → distributed multi-component consistent checkpoint/recovery line`。

**哪個節點最淺？**  
`Tool Effect Journal / DISPATCHED_UNKNOWN reconciliation` 仍最淺，尤其不可逆外部 effect。

**哪個概念仍只是名詞？**  
`Unified Agent Continuation ABI`、`ContinuationCompatibilityHash`、`Cross-Runtime Safe Preemption Point` 尚屬工程模型，還不是成熟標準。

**哪個系統最值得讀原始碼？**  
Llumnix 的 migration path，優先順序：`migration_frontend.py → llumlet.py → local_migration_scheduler.py → migration_scheduler.py`；第二順位是 vLLM V1 scheduler + KV connector/offload paths。

**哪篇論文需追引用？**  
第一：Llumnix（OSDI 2024）後續 request/KV migration 工作；第二：Concordia（2026）後續 GPU checkpoint；第三：Pallas（2026）proactive migration。

**哪個概念最適合視覺模擬？**  
`Preemption, Checkpoint & Continuation Migration Lab`：同時展示 GPU state、Tool state、commit cursor、migration bytes 與 resume cost。

**哪個 Agent 架構最值得實作？**  

> **Preemptible Continuation Agent Runtime = Deadline Scheduler + Safe Preemption Point + Continuation Capsule + State/Recompute Planner + Live Migration + Effect Journal + Single-Winner Continuation Commit Gate**

---

# 十二、核心結論

真正的 Agent OS 不能只有：

```text
priority queue
+ cancel()
+ retry()
```

它需要像 operating system process context switch 一樣回答：

```text
現在能不能安全停？
停下來要保存什麼？
哪些 state 值得搬、哪些重算更便宜？
可以搬到哪一個 GPU / worker？
外部 Tool 是否已產生 side effect？
恢復時從哪一個 canonical cursor 接續？
舊 attempt 晚到時誰有 commit authority？
```

因此本輪最重要的底層關係是：

```text
UI
→ Agent
→ Dynamic Workflow
→ Scheduler
→ Running Stage
→ Safe Preemption Point
→ Continuation Capsule
→ KV / Tool / Multimodal State
→ Offload / Checkpoint / Migration / Recompute
→ Resume
→ Continuation Commit Gate
→ Canonical State
→ Output
```

對多模態則必須一路保留：

```text
Camera / Image / Voice / Video
→ Encoder / Generator State
→ Visual/Audio Tokens or Latent
→ Fusion / Reasoning
→ Agent State
→ Action
```

其中任何一層如果只保存「表面上的 Agent JSON」，都不足以真正回答：

> **AI 執行到一半被搶占、故障、遷移或重排時，究竟如何在不重複副作用、不遺失模型進度、不重送錯誤 output 的情況下繼續運作？**

本輪的答案是：需要把 **Safe Point、Continuation Capsule、Effect Journal、State Materialization、Migration、Commit Cursor、Capability/Generation Fence** 做成一組統一 runtime primitives，而不是把 checkpoint 當成備份檔案。