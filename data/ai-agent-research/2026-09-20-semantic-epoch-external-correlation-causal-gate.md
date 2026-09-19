# 【AI Agent × Multimodal Research Report】

時間：2026-09-20 04:51（Asia/Taipei）

主題：Semantic Epoch → CUPTI External Correlation → CUDA Graph Node → Causal Intervention Gate

## 本小時新發現

本輪接續前一輪 `ConsumerOrderingProof / SemanticEpochCorrelationWitness`，不再重複 H2D stream 基礎語義，而是研究如何把 Hermes 的 scheduler/request/content epoch 語義，真正綁到 CUPTI 所觀測的 CUDA API、graph replay 與 graph node activity。

已確認：CUPTI External Correlation 維護「每 CPU thread、每 correlation kind」的 external-ID stack。client 透過 `cuptiActivityPushExternalCorrelationId` / `Pop` 建立自己的 semantic ID；當同 thread 上發生 CUDA API activity 時，CUPTI 會產生 external-correlation activity，把 client external ID 與 CUPTI correlation ID 連接。這代表 Hermes 可以建立自己的 `SemanticEpochId`，但必須自行維護 ID→scheduler/request/content-epoch 的 mapping，不能假設 CUPTI 自動理解 request semantics。

已確認：CUPTI CUDA Graph per-node tracing 可在 kernel/memcpy/memset activity 上提供 `graphId + graphNodeId`；CUDA 13.4 另提供 `sourceGraphId + sourceGraphNodeId` 追 node 的來源或最後更新 lineage。Graph-level trace 則只給 graph execution，不提供 node activity，而且與 per-node trace 模式互斥。

已確認：CUDA event activity 可提供 `eventId + streamId + deviceTimestamp + cudaEventSyncId`；synchronization activity可描述 stream/event synchronization。這補足前輪 `ConsumerOrderingProof` 的 machine-verifiable primitive。

新研究：2026 `From Correlation to Cause` 顯示 mechanistic feature detection 與 causal force 不等價；activation patching / ablation 需要 robustness test，且高度 selective feature 不一定有強 causal effect。因此 Hermes 的 runtime provenance closure 必須與 intervention evidence 分級，不能從「讀了某 KV」直接跳到「造成 action」。

## 本小時最重要 5 個發現

### 1. Semantic Epoch 必須是 Hermes 自己的 identity

**是什麼**：`SemanticEpochId` 是 scheduler step、request set、block-table content epoch、KV lease epoch、intervention arm 的 canonical semantic key。

**底層如何運作**：

`SchedulerStep → SemanticEpochId → PushExternalCorrelationId → CUDA API → CUPTI ExternalCorrelation → CUPTI correlationId`。

**為什麼重要**：沒有這層，GPU trace 只有 kernel/memcpy IDs，無法回答「這次 GPU work 屬於哪一個 request/content epoch」。

**限制**：External correlation 是 CPU-thread scoped stack；CUDA Graph capture/replay、worker thread handoff、async execution會使 naive push/pop 不足，因此 replay epoch仍需額外 mapping。

來源：NVIDIA CUPTI 13.4 Usage / External Correlation。

### 2. Graph execution identity 與 graph node identity 必須分離

`GraphReplayWitness(graphId, correlationId, streamId, start,end)`

不等於

`GraphNodeExecutionWitness(graphId, graphNodeId, kernel activity)`。

Graph-level tracing降低 overhead，但看不到 node；per-node tracing才可把 attention kernel綁到 graph node。兩模式不能同時當成同一份證據。

來源：NVIDIA CUPTI CUDA Graph tracing documentation。

### 3. Consumer ordering 可以從 event/sync records 建 machine-verifiable DAG

最小 edge：

`H2D completion → EventRecord(eventId) → EventWait/Sync → GraphReplay/Kernel`。

同 stream時可由 stream order建立 edge；跨 stream時要求 event/graph dependency/synchronization witness。若找不到 edge，狀態必須是 `CONSUMER_ORDER_UNPROVEN`。

### 4. Runtime provenance closure 仍不是 causal closure

`SemanticEpoch → GPU read → attention kernel` 只能證明 execution provenance。

因果鏈必須另外做：

`Baseline → Sham(write same value) → Zero/Replace target KV → ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction`。

並固定 model weights、precision、attention backend、batch/sequence geometry、sampling policy。2026 causal-feature研究再次顯示 detection/selectivity 與 causal force可以分離。

### 5. Hermes Console 應把 evidence 分成兩張 DAG

**Execution DAG**：誰在何時讀了什麼。

**Causal DAG**：改變它後什麼跟著改變。

兩者最後由 `InterventionTargetBinding` 接合，而不是把 attention heatmap、kernel read 或 correlation ID當 causal proof。

## Architecture Breakdown

```text
User / Multimodal Input
→ Agent Runtime
→ Scheduler Step
→ SemanticEpochId
   ├─ request_ids
   ├─ block_table_content_epoch
   ├─ kv_lease_epoch
   └─ intervention_arm
→ ExternalCorrelationPush
→ H2D CUDA API
→ CUPTI correlationId
→ Memcpy Activity
→ stream / timestamps
→ Event / Sync dependency
→ CUDA Graph Replay
→ graphId
→ graphNodeId
→ Attention Kernel Activity
→ exact source-level KV address mapping
→ RuntimeKVReadWitness
→ InterventionTargetBinding
→ causal experiment
→ logit/action effect
```

### System architecture：Runtime Provenance Verifier

輸入：Hermes semantic events + CUPTI activities。

1. `SemanticEventCollector`：產生 stable 128-bit semantic epoch ID。
2. `ExternalCorrelationBridge`：在 CUDA API boundary push/pop external ID。
3. `CUPTICollector`：收 runtime/driver API、memcpy、kernel、event、sync、graph activities。
4. `TraceNormalizer`：正規化 context/stream/correlation/graph/node/event identity。
5. `HappensBeforeBuilder`：建立 stream-order、event-wait、graph-dependency edges。
6. `RuntimeBinder`：把 semantic epoch綁到 graph replay/node/kernel。
7. `EvidenceGate`：只有完整 path 才標 `RUNTIME_CONTENT_EPOCH_BOUND`。
8. `CausalHarness`：在同 execution envelope 執行 sham/zero/replace。

## Bottom-Level Logic

### External correlation

```text
Hermes semantic_epoch = H(step, requests, block_epoch, lease_epoch, arm)
        ↓
cuptiActivityPushExternalCorrelationId(kind, semantic_epoch)
        ↓
CUDA runtime/driver API
        ↓
CUpti_ActivityExternalCorrelation
  externalId = semantic_epoch
  correlationId = cuda_api_correlation
        ↓
cuptiActivityPopExternalCorrelationId(...)
```

重要限制：external stack 是 host thread local semantic bridge；GPU kernel activity仍需透過 CUDA API correlation、graph identity與 runtime records繼續閉合。

### Graph replay

```text
semantic epoch
→ graph launch API correlation
→ GraphTrace(graphId, streamId, correlationId)
→ per-node activity(graphId, graphNodeId)
→ attention kernel
```

CUDA 13.4：`sourceGraphId/sourceGraphNodeId` 可用於 node clone/update lineage；這對 vLLM 重用/更新 CUDA Graph 很重要。

### Event ordering

```text
Memcpy M449 on S7
→ completes
→ Event E77 recorded on S7
→ wait/synchronization involving E77 and S2
→ Replay R89 on S2
→ Attention node N57
```

Verifier rule：若 S7 != S2 且沒有 event/graph/stronger-sync edge，拒絕升級 provenance。

## Visual Simulation Idea

### Semantic Epoch → GPU → Causal Action Microscope

三層同步 UI：

**Semantic lane**
`Step 882 / Req A / Content E204 / KV Lease E17 / Arm=SHAM`

**GPU execution lane**
`ExternalID → H2D → Event → Graph Replay G12 → Node N57 → Attention K882`

**Causal lane**
`SHAM | ZERO | REPLACE → ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAction`

點任一 node 顯示 Evidence Grade：
`SOURCE_ONLY / RUNTIME_CORRELATED / ORDER_VERIFIED / INTERVENTION_VALIDATED / ACTION_CAUSAL_BOUND`。

## Code / GitHub

Hermes Console目前研究目錄尚未找到 CUPTI external-correlation collector，因此建議下一個實作切片：

```text
runtime-provenance/
  semantic_epoch.py|ts
  cupti_bridge/
  trace_schema/
  happens_before/
  graph_binder/
  causal_harness/
```

vLLM / PyTorch 後續值得看的核心路徑：GPUModelRunner dynamic input commit、CUDAGraphWrapper replay、ATen CUDA copy、Triton attention launch；CUPTI 端則以官方 `cuda_graphs_trace` sample 作 collector reference。

## Papers

### From Correlation to Cause: A Five-Stage Methodology for Feature Analysis in Transformer Language Models
- Authors: Caleb Munigety
- Year: 2026
- URL: https://arxiv.org/abs/2605.22462
- Architecture/Method: probe → feature extraction → causal validation → robustness → deployment integration
- Contribution: 明確把 feature detection 與 causal validation分離；activation patching/ablation與 robustness evaluation結合。
- Limitation: GPT-2 small / IOI 等受控設定，不能直接外推到 production multimodal agent runtime。
- 對 Hermes 的改變：新增 `CausalEvidenceGate`，禁止 runtime read evidence直接升級為 action causality。

### Towards Best Practices of Activation Patching in Language Models: Metrics and Methods
- Authors: Fred Zhang, Neel Nanda
- Year: 2023
- URL: https://arxiv.org/abs/2309.16042
- Contribution: 顯示 corruption method / metric選擇會顯著改變 patching 結果。
- Limitation: mechanistic interpretability benchmark與 production serving trace仍有距離。
- 對 Hermes 的改變：intervention report必須保存 metric、corruption/replacement policy、baseline與sham設定。

## Unknown / Open Questions

1. vLLM CUDA Graph replay是否會跨 host worker thread，使單純 external-correlation push/pop 無法直接覆蓋 replay API？需要實測 thread/correlation trace。
2. CUDA Graph node update / clone 後，vLLM attention semantic node 如何穩定映射到 `sourceGraphNodeId`？
3. 如何在不改變 batch geometry與kernel selection的前提下，對單一 KV slot 做 sham/zero/replace，避免 intervention本身改變 execution path？

## 下一輪研究

直接從「研究」進入最小可實作 verifier contract：

```text
SemanticEpoch schema
→ ExternalCorrelation instrumentation point
→ CUPTI activity schema
→ graph replay/thread behavior
→ graphId/nodeId binder
→ happens-before DAG algorithm
→ evidence-grade state machine
→ vLLM instrumentation patch design
→ sham intervention design
```

若環境有 NVIDIA GPU/CUPTI，再執行最小 trace；若沒有，先完成 collector/schema/test fixture，禁止把 synthetic trace宣稱為 runtime observation。

## Knowledge Graph 新增 Node / Edge

Nodes：
- `SemanticEpochId`
- `ExternalCorrelationPushWitness`
- `ExternalCorrelationPopWitness`
- `CUDAAPICorrelationWitness`
- `GraphReplayCorrelationWitness`
- `SourceGraphNodeLineageWitness`
- `EventDeviceTimestampWitness`
- `ConsumerOrderingProof`
- `RuntimeContentEpochBound`
- `InterventionTargetBinding`
- `CausalEvidenceGate`
- `ExecutionEvidenceDAG`
- `CausalEvidenceDAG`

Edges：
- `SemanticEpochId --external-correlates→ CUDAAPICorrelationWitness`
- `CUDAAPICorrelationWitness --launches→ GraphReplayCorrelationWitness`
- `GraphReplayCorrelationWitness --contains→ GraphNodeExecutionWitness`
- `EventDeviceTimestampWitness --orders-before→ GraphReplayCorrelationWitness`
- `GraphNodeExecutionWitness --reads→ RuntimeKVReadWitness`
- `RuntimeKVReadWitness --targeted-by→ InterventionTargetBinding`
- `InterventionTargetBinding --validated-by→ CausalEvidenceGate`

## 本輪結束判定

- 缺哪一層：真實 vLLM process 的 `SemanticEpoch → CUPTI external correlation → graph replay/node` 實測 trace。
- 哪個節點最淺：`ExternalCorrelationPushWitness` 在 vLLM 真實 worker/thread boundary 的 instrumentation point。
- 哪個概念仍只是名詞：`AgentActionCausalBound`。
- 哪個系統值得讀原始碼：vLLM CUDA Graph runner + PyTorch ATen CUDA copy + NVIDIA CUPTI `cuda_graphs_trace` sample。
- 哪篇論文需追引用：`From Correlation to Cause`，並與 activation/path patching、causal tracing 文獻交叉比較。
- 哪個概念最適合視覺模擬：`Semantic Epoch → GPU Happens-Before → Causal Intervention` 三層同步圖。
- 哪個 Agent 架構最值得實作：`State-grounded Planner + Runtime Provenance Verifier + Causal Evidence Gate + Tool Executor`。

最終鏈目前推進為：

`UI → Agent → Context → Multimodal Token → Sequence Slot → Logical KV → Physical KV → Semantic Content Epoch → H2D → Consumer Ordering → CUDA Graph Replay → Attention Node → Runtime KV Read → Intervention → ΔLogit → ΔAction`。

本輪的核心進展：把「scheduler/request/content epoch」第一次定義成可透過 CUPTI External Correlation進入 GPU trace 的 semantic identity，並明確把 execution provenance DAG 與 causal evidence DAG分離。下一個真正的工程里程碑不是再增加名詞，而是把這個 contract 做成可跑的 Runtime Provenance Verifier。