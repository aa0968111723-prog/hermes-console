# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-21 09:51（Asia/Taipei）

## 本小時新發現

本輪接續前一輪 `RequiredReadableFrontier`，但不再重複 CQ / task completion，而是深入 **GPUDirect remote-write visibility 如何進入 CUDA Graph replay**。核心新發現：CUDA 13.4 已把 stream memory operations建模為 graph-capable batch memory-op nodes；`CU_STREAM_WAIT_VALUE_FLUSH` 可在 wait滿足後 flush outstanding remote writes，`CU_STREAM_MEM_OP_FLUSH_REMOTE_WRITES` 則可作為獨立 operation。支援必須透過 `CU_DEVICE_ATTRIBUTE_CAN_FLUSH_REMOTE_WRITES` 查詢。

更重要的是，CUDA Graph executable允許更新 wait-value node的 address與 value，但 **`CU_STREAM_WAIT_VALUE_FLUSH` bit不能在 instantiated executable graph上動態修改**。因此 GPUDirect visibility policy不是每次 replay都能自由切換的 request metadata，而可能是 graph specialization / graph generation的一部分。

這讓 Hermes 新增一個之前缺少的 provenance層：`GraphVisibilityContractEpoch`。若 graph capture時建立的是 plain wait，而 runtime transport / GPU ordering capability後來要求 wait+flush，僅更新 sequence value不足以讓 replay變成正確；應 fail closed、選擇另一個已具 flush semantics的 graph variant，或重新 capture/instantiate。

## 本小時最重要 5 個發現

### 1. `WAIT_VALUE_FLUSH` 是 downstream visibility primitive，不只是等待條件
**已確認官方資訊。** CUDA 13.4定義 `CU_STREAM_WAIT_VALUE_FLUSH`：wait條件成立後，flush outstanding remote writes；前提是相關 remote write保證在 wait被滿足前已到達 device。這能建立 `RemoteCompletionSignal → Wait+Flush → downstream CUDA work` 的 visibility chain。

底層：`remote data writes → remote completion/signal write → stream wait(signal) + FLUSH → downstream Attention`。

限制：signal必須真的因果地晚於資料寫入到達；若 producer先寫 signal、資料後到，flush flag不能修復錯誤的 producer protocol。

### 2. CUDA提供 standalone `FLUSH_REMOTE_WRITES` graph/memop primitive
**已確認官方資訊。** `CU_STREAM_MEM_OP_FLUSH_REMOTE_WRITES` 與 `CU_STREAM_WAIT_VALUE_FLUSH`具有相同 remote-write visibility效果，但作為獨立 batch memop。這表示 Hermes可以把 `wait` 與 `flush` 拆成兩個 provenance node，而不是永遠綁成一個操作。

### 3. Graph replay的 wait address/value可更新，但 FLUSH policy不可動態切換
**已確認官方資訊。** CUDA Graph executable node update允許修改 wait-value operation的 address與 value，以及 wait type相關 bits；官方明確指出 `CU_STREAM_WAIT_VALUE_FLUSH` bit不能修改。這是本輪最重要的新 correctness boundary。

因此：`TransferEpoch sequence` 可以每輪更新；`GraphVisibilityPolicy` 卻可能必須在 graph instantiate時固定。

### 4. Graph identity必須納入 visibility contract generation
**合理工程建模，建立於官方 API contract。** 以前 Hermes已有 CUDA Graph identity / replay provenance，但現在需增加：`GraphExecIdentity + DeviceCapabilitySnapshot + VisibilityPolicy + OrderingDomainSet + MemOpNodeTopology → GraphVisibilityContractEpoch`。同一 attention graph若在不同 GPUDirect ordering capability或不同 transport ordering domain下重用，不應只靠相同 graph hash判斷等價。

### 5. `SignalObserved` 不等於 `RemoteDataVisible`
**官方語義 + 系統推論。** `WAIT_VALUE_FLUSH`文件的條件句非常關鍵：只有 remote data write在 wait可被滿足前已經到達 device，flush才保證 downstream work看見它。因此 producer-side protocol也必須有 `DataBeforeSignalWitness`。Hermes不能只看到 semaphore sequence前進，就把所有 KV bytes標成 readable。

## Architecture Breakdown

### System architecture：Graph-Replayed GPUDirect KV Read Path

```text
Producer / NIC
  KV remote writes
  → DataArrivalFrontier
  → completion/signal remote write
  → DataBeforeSignalWitness

Consumer CUDA Graph
  wait-value node(sequence N)
  → optional WAIT_VALUE_FLUSH
     or standalone FLUSH_REMOTE_WRITES
  → VisibilityGateNode
  → Attention kernel node

Runtime provenance
  TransferEpoch
  + GraphExecIdentity
  + GraphVisibilityContractEpoch
  + KVLeaseEpoch
  + TranslationEpoch
  → RequiredReadableFrontier
```

### Bottom-Level Logic：Graph visibility specialization

```text
Device CAN_FLUSH_REMOTE_WRITES?
+ GPU_DIRECT_RDMA_WRITES_ORDERING scope
+ required visibility scope
+ transport ordering domains
+ graph memop topology
+ wait node FLUSH bit
→ GraphVisibilityContract
```

若 runtime要求：

```text
required = WAIT+FLUSH
captured graph = WAIT only
```

則：

```text
update wait value/address ≠ sufficient
→ select flush-capable graph variant
  OR re-capture/re-instantiate
  OR fail closed
```

## Visual Simulation Idea

### CUDA Graph × GPUDirect Visibility Replay Viewer

畫面同時顯示 producer timeline與 graph DAG：

```text
NIC / Producer
KV DATA W0 ─ KV DATA W1 ─ SIGNAL(seq=92)
      \________ DataBeforeSignal ________/
                         │
                         ▼
CUDA GRAPH EXEC #G17
[Wait seq>=92 + FLUSH] → [Attention L18] → [MLP]
       │
       └ GraphVisibilityContractEpoch = 7
```

互動控制：把 wait+flush改成 plain wait、更新 sequence、切換 GPU capability、加入第二個 RDMA ordering domain、讓 signal早於最後一個 data write、重用舊 graph exec。Console應輸出：`GRAPH_VISIBILITY_POLICY_MISMATCH`、`SIGNAL_WITHOUT_DATA_FRONTIER`、`FLUSH_CAPABILITY_UNAVAILABLE`、`GRAPH_RECAPTURE_REQUIRED`、`MULTI_DOMAIN_GRAPH_CONTRACT_INVALID`。

## Code / GitHub

### CUDA / NVIDIA
本輪最值得看的官方 API surface：
- CUDA Driver API 13.4 Stream Memory Operations：`cuStreamWaitValue32/64`、`CU_STREAM_WAIT_VALUE_FLUSH`。
- `CU_STREAM_MEM_OP_FLUSH_REMOTE_WRITES`：standalone remote-write flush。
- CUDA Graph Management：batch memop graph nodes與 executable-node parameter update；wait address/value可改，但 FLUSH bit不可改。
- `cuFlushGPUDirectRDMAWrites()`：host-side visibility fallback / capability-driven no-op path。

### NIXL / Mooncake
本輪重新搜尋 current source，未找到 `CU_STREAM_WAIT_VALUE_FLUSH` 的直接使用證據；這只能記為「目前未找到直接證據」，不能推論 backend沒有其他 ordering bridge。下一輪應直接追各 backend completion後 caller如何進入 CUDA graph replay / model execution。

## Papers / Technical Sources

本輪以官方 CUDA memory model/API為主，因為目前缺口已從系統概念收斂到 executable graph semantics。關鍵來源：NVIDIA CUDA Driver API 13.4 `Data types used by CUDA driver`、`Stream Memory Operations`、`Graph Management`、`Device Management`，以及 CUDA Programming Guide 的 graph capture dependency規則。

值得後續研究的論文問題：現有 disaggregated serving / KV transfer系統是否把 GPUDirect visibility primitive放入 captured CUDA Graph，或仍使用 host-side completion後才提交 graph；兩者在 TTFT、CPU overhead與 correctness上的取捨尚需實證比較。

## Unknown / Open Questions

1. `CU_STREAM_MEM_OP_FLUSH_REMOTE_WRITES` graph node在不同 CUDA版本、driver與GPU平台上的 capture / instantiate / replay限制，以及它與 graph update API的完整可變欄位集合。
2. NIXL GPUNETIO、UCX與Mooncake RDMA完成後，vLLM/model runner是在 host看到 completion後才 replay graph，還是存在 device-side signal→graph memop path。
3. 多 RDMA hardware ordering domain同時寫入同一 KV region時，單一 graph flush node是否不足，應如何表示 `OrderingDomainFrontier[]` 與 external barrier。

## 下一輪研究

```text
vLLM model runner / CUDA Graph replay
→ connector completion admission
→ graph replay submission point
→ Attention graph identity

NIXL GPUNETIO / UCX
→ completion signal location
→ host/device completion bridge
→ graph replay ordering

Mooncake RDMA
→ task COMPLETED observer
→ vLLM scheduler/worker handoff
→ next CUDA graph replay

CUDA Graph
→ BatchMemOp node exact update rules
→ FLUSH_REMOTE_WRITES node mutability
→ graphExec variant strategy

最後 join：
DataBeforeSignalWitness
∧ RequiredTransferFrontier
∧ GraphVisibilityContractEpoch
∧ RequiredVisibilityFrontier
∧ KVLeaseEpoch
∧ TranslationEpoch
→ AttentionReadable
→ ExpectedPhysicalKVReadSet
→ causal ZERO/REPLACE experiment
```

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `GraphVisibilityContractEpoch`
- `GraphVisibilityPolicy`
- `VisibilityGateNode`
- `DataArrivalFrontier`
- `DataBeforeSignalWitness`
- `RemoteCompletionSignalWitness`
- `GraphFlushCapabilitySnapshot`
- `GraphRecaptureRequiredState`
- `GraphVisibilityPolicyMismatchState`
- `SignalWithoutDataFrontierState`

新增 Edges：
- `RemoteDataWrites --must_precede→ RemoteCompletionSignal`
- `DataBeforeSignalWitness + WaitValueFlush --supports→ RequiredVisibilityFrontier`
- `GraphExecIdentity + VisibilityPolicy --forms→ GraphVisibilityContractEpoch`
- `GraphWaitValue --runtime_updateable→ address/value`
- `GraphWaitValueFlushBit --not_runtime_updateable→ instantiated graph policy`
- `RuntimeVisibilityRequirementMismatch --requires→ graph variant OR recapture OR fail closed`
- `SignalObserved --does_not_prove→ RemoteDataVisible`

## 本輪結束判斷

- **缺哪一層：** transport/connector completion到 vLLM CUDA Graph replay submission的 exact control edge。
- **最淺節點：** `DataBeforeSignalWitness` 的 backend-specific production evidence。
- **仍只是名詞：** `ObservedPhysicalKVReadSet`；目前持續補的是合法可讀與 ordering proof，還不是逐 load trace。
- **最值得讀原始碼：** vLLM CUDA Graph replay/model runner + NIXL GPUNETIO completion signal path。
- **最值得追引用/技術脈絡：** CUDA Graph batch memop與 GPUDirect remote-write flush semantics。
- **最適合視覺模擬：** CUDA Graph × GPUDirect Visibility Replay Viewer。
- **最值得實作的 Agent 架構：** `State-grounded Planner + Runtime Provenance Verifier + Graph Visibility Contract Verifier + Transport Frontier Verifier + Residency/Lease Joiner + Model-Kernel Contract Verifier + Causal Evidence Gate + Tool Executor`。

## 與歷史研究相比的實質新增

前一輪把 GPUDirect visibility轉成 capability-driven `RequiredVisibilityAction`，並加入 transport object quiescence。本輪再往 execution engine下鑽，發現 **visibility policy本身會被 CUDA Graph executable固化**：sequence/address可以更新，但 `WAIT_VALUE_FLUSH` bit不能在 instantiated graph上動態切換。因此 Hermes的 provenance不能只驗證「這次 transfer需要什麼 flush」，還必須驗證「實際 replay的 graph generation是否捕捉了正確 visibility contract」。這把 `RequiredReadableFrontier` 真正接到了 CUDA Graph execution semantics。