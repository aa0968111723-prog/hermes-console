# 【AI Agent × Multimodal Research Report】

時間：2026-09-20 16:55（Asia/Taipei）

主題：CUPTI External Correlation × Per-Thread Semantic Scope × Graph/Eager Provenance

## 本小時新發現

本輪承接上一輪 `SemanticCorrelationBridge`，不再重複 LayerInvocationScope / Triton 2D/3D kernel-set，而是直接拆解 CUPTI External Correlation 的真實語義與它在 vLLM graph/eager 混合 execution 中能證明什麼、不能證明什麼。

已確認的 CUPTI current documentation：External Correlation 不是「直接把 semantic ID 寫進 kernel record」，而是維護 **per CPU thread、per CUpti_ExternalCorrelationKind 的 stack**。呼叫 `cuptiActivityPushExternalCorrelationId(kind, externalId)` 後，若同一 CPU thread 在 stack 非空期間產生 CUDA Runtime/Driver API activity，CUPTI 會產生 `CUpti_ActivityExternalCorrelation {externalKind, externalId, correlationId}`，其中 `correlationId` 指向該 CUDA API activity。要生成這些 records，除了 `CUPTI_ACTIVITY_KIND_EXTERNAL_CORRELATION`，還必須啟用 Runtime/Driver API activity。

因此正確 chain 是：

`LayerInvocationSemanticEpoch -> ExternalCorrelationScope(thread, kind, externalId) -> CUDA API activity(correlationId) -> GPU activity(correlationId)`。

但 CUDA Graph 是重要例外/分支：graph-level trace 的 `CUpti_ActivityGraphTrace2.correlationId` 對應 graph launch API，而 per-node trace 用 `graphId/graphNodeId` 表示 graph node execution。也就是 semantic external correlation 在 replay path 最穩定地先綁到 **graph launch**；不能未經額外 graph topology/node binding 就宣稱 externalId 已直接等於某個 graph kernel node semantic identity。

這會修正上一輪較理想化的 `semantic scope -> kernel correlationId[]`：對 eager launch 可以直接沿 API correlation 到 kernel；對 graph replay 必須走 `semantic scope -> graph launch correlation -> graph execution -> graphId/node topology -> node execution`。

## 本小時最重要 5 個發現

### 1. External Correlation 是 per-thread stack，不是 global tag
- 是什麼：CUPTI 為每個 CPU thread、每種 external correlation kind 維護獨立 stack。
- 底層：push externalId -> 同 thread 發生 CUDA API -> 產生 external-correlation record -> pop。
- 為什麼重要：Hermes 的 semantic scope 必須和「真正呼叫 CUDA API 的 thread」對齊；把 semantic ID push 在 scheduler thread、GPU launch 卻發生在 worker thread，binding 會失效。
- 限制：async handoff / thread pool / background launch 必須顯式傳遞 semantic epoch，不能依 thread-local scope 自動跨 thread。
- 證據：NVIDIA CUPTI 官方文件。

### 2. ExternalCorrelation record 綁的是 CUDA API correlationId，不是直接綁 kernel
`CUpti_ActivityExternalCorrelation` 的核心欄位是 `{externalKind, externalId, correlationId}`。下一跳需用 Runtime/Driver API record的 `correlationId` 再連 GPU activity。這要求 verifier保留 API activity層，不能只收 kernel records。

### 3. Eager 與 CUDA Graph replay 必須使用不同 Evidence Adapter
Eager：`externalId -> CUDA launch API correlationId -> kernel activity correlationId`。
Graph：`externalId -> cudaGraphLaunch API correlationId -> GraphTrace2(graphId/contextId/streamId) -> per-node graph topology/activity`。Graph-level trace與per-node trace是不同 tracing mode；graph-level trace刻意不提供 node visibility。

### 4. Semantic scope 必須具有 balanced push/pop 與 thread ownership
如果 scope exception、early return、nested attention、recursive/custom-op path造成 push/pop失衡，後續無關 CUDA API 會被錯誤標上舊 externalId。Hermes 必須新增 `ExternalCorrelationStackIntegrityWitness`，至少驗證：push thread == pop thread、LIFO、scope depth、exception-safe cleanup、externalId uniqueness。

### 5. 最穩定的 externalId 應是 compact semantic epoch key，不是 layer_name hash單獨使用
建議 externalId 映射到 side table：`{run_id, rank, worker_id, step_epoch, microbatch_epoch, layer_invocation_epoch}`。64-bit externalId只作 key；完整 layer_name/backend/KV identity/metadata epoch保存在 host semantic table。這可避免 hash collision與字串塞入 profiler hot path。

## Architecture Breakdown

```text
Hermes Semantic Table
  semantic_key E441
  -> run/rank/worker/step/microbatch/layer/invocation

Launch Thread T7
  -> cuptiActivityPushExternalCorrelationId(CUSTOM0, E441)
  -> vLLM attention dispatch

  EAGER DOMAIN
    -> CUDA launch API corr C901
    -> ExternalCorrelation(E441, C901)
    -> KernelActivity corr C901
    -> Kernel K81

  GRAPH DOMAIN
    -> cudaGraphLaunch corr C990
    -> ExternalCorrelation(E441, C990)
    -> GraphTrace2 corr C990 / graphId G12 / stream S17
    -> graph topology / node activity
    -> graphNodeId N57 ...

  -> cuptiActivityPopExternalCorrelationId(...)
  -> StackIntegrityWitness
```

## Bottom-Level Logic

### External correlation state machine

```text
IDLE
 -> PUSH(externalId, thread, kind)
 -> ACTIVE(depth=n)
 -> CUDA_API(correlationId)
 -> EMIT ExternalCorrelation(externalId, correlationId)
 -> [0..N more CUDA APIs]
 -> POP(thread, kind)
 -> IDLE / parent scope
```

### Required invariant

```text
SEMANTIC_API_BOUND(E, C) =
  PUSHED_ON_LAUNCH_THREAD(E)
  ∧ STACK_BALANCED(E)
  ∧ EXTERNAL_CORRELATION_RECORD(E, C)
  ∧ API_ACTIVITY_PRESENT(C)
```

Eager upgrade:

```text
SEMANTIC_KERNEL_BOUND(E, K) =
  SEMANTIC_API_BOUND(E, C)
  ∧ K.correlationId == C
  ∧ context/stream/rank constraints match
```

Graph upgrade:

```text
SEMANTIC_GRAPH_BOUND(E, G, R) =
  SEMANTIC_API_BOUND(E, CgraphLaunch)
  ∧ GraphTrace.correlationId == CgraphLaunch
  ∧ GraphTrace.graphId == G
  ∧ replay epoch R bound
```

然後才可用 graph topology/per-node trace建立 node-level witness。禁止：`externalId -> graphNodeId` 無中間證據直接跳接。

### Thread handoff rule

```text
SemanticScope(T_scheduler)
 --async handoff-> LaunchThread(T_gpu)
```

必須在 `T_gpu` 重新 push external correlation。CUPTI stack是 per-thread，不能假設 contextvars/thread-local semantic state會自動成為 CUPTI external scope。

## Visual Simulation Idea

### Semantic Scope Stack × GPU Correlation Microscope

左欄顯示 CPU threads 與 nested semantic scopes；中央顯示 ExternalCorrelation records與 CUDA API correlation IDs；右欄顯示 Eager kernels或 Graph replay/node topology。

```text
T7 stack
[E441 Layer18]
    |
    +-- API C901 ---- External(E441,C901) ---- K81 eager
    |
    +-- API C990 ---- External(E441,C990) ---- Graph G12 Replay R96
                                              |- N57
                                              |- N58
```

異常狀態：
- `THREAD_HANDOFF_UNBOUND`
- `CORRELATION_STACK_LEAK`
- `CORRELATION_STACK_UNDERFLOW`
- `GRAPH_NODE_SEMANTIC_UNRESOLVED`
- `API_ACTIVITY_MISSING`
- `SEMANTIC_SCOPE_CONTAMINATION`

互動上點 externalId可看到完整 semantic side-table；點 correlationId可反向找到 CPU API；點 graph replay再展開 node topology。

## Code / GitHub

值得實作/閱讀：
- NVIDIA CUPTI `cupti_external_correlation` sample：push/pop與 Activity buffer解析。
- NVIDIA CUPTI `cuda_graphs_trace` sample：graph launch、graphId、graphNodeId topology correlation。
- vLLM `attention.py` / `unified_attention_with_output`：semantic scope插入點。
- vLLM Breakable CUDA Graph：決定 attention是 eager或graph domain。
- Hermes verifier sidecar：semantic side-table、externalId allocator、CUPTI activity collector、binder。

工程上不建議第一版直接改每個 Triton kernel；先在 attention semantic boundary與 launch thread建立 external scope，讓 Eager path先閉合，再對 Graph path增加 graph topology adapter。

## Papers / Technical Sources

本輪主要突破來自 NVIDIA CUPTI 官方 tracing semantics，而非新論文；避免為滿足數量而加入與缺口無關的論文。可作工程交叉驗證的現有實作是 ONNX Runtime CUDA Plugin EP profiler設計：其 StartEvent/StopEvent 將 ORT event correlation ID push/pop到 CUPTI external correlation stack，EndProfiling再 flush/解析 GPU activities。這證明 external correlation作為框架 semantic event -> CUDA activity bridge是實際工程模式，但 ORT event模型不能直接等同 vLLM layer invocation。

## Unknown / Open Questions 1-3

1. 在 vLLM Breakable CUDA Graph 下，semantic scope應包住 `CUDAGraph.replay()` 還是更上層 layer invocation dispatcher，才能同時避免過寬 scope與漏掉 replay launch？
2. FULL CUDA Graph capture/replay時，多個 semantic layers可能已固化在同一 graph；一次 graph launch externalId是否只能代表 step/replay epoch，而 layer identity必須由 capture-time graph topology side-table補足？目前答案傾向「是」，但需直接追 vLLM FULL graph capture topology驗證。
3. Tensor parallel多 rank各自有CPU launch thread/CUDA context；externalId應全域唯一還是 `(rank, externalId)` composite key？建議全域 semantic key + rank field雙重約束，待實測。

## 下一輪研究

```text
vLLM FULL / PIECEWISE / BREAKABLE execution
-> semantic scope placement
-> capture-time layer topology
-> replay-time external correlation
-> graph launch correlationId
-> graphId / sourceGraphId
-> graphNodeId / sourceGraphNodeId
-> layer topology side-table
-> Eager/Graph CanonicalLaunchWitness
-> microbatch/rank disambiguation
-> KernelSetCompletionWitness
-> EffectiveKVReadSet
-> RuntimeKVReadWitness
-> controlled ZERO/REPLACE intervention
-> ΔAttentionOutput -> ΔResidual -> ΔLogit -> ΔToken -> ΔAgentAction
```

## Knowledge Graph 新增 Node / Edge

Nodes:
- `ExternalCorrelationScope`
- `ExternalCorrelationStack`
- `ExternalCorrelationStackIntegrityWitness`
- `LaunchThreadSemanticOwnership`
- `SemanticSideTable`
- `SemanticExternalId`
- `SemanticAPIActivityBinding`
- `EagerCorrelationAdapter`
- `GraphCorrelationAdapter`
- `GraphLaunchSemanticWitness`
- `GraphNodeSemanticUnresolvedState`
- `ThreadHandoffUnboundState`
- `CorrelationStackLeakState`
- `CanonicalLaunchWitness`

Edges:
- `LayerInvocationSemanticEpoch -> allocates -> SemanticExternalId`
- `SemanticExternalId -> indexes -> SemanticSideTable`
- `LaunchThreadSemanticOwnership -> owns -> ExternalCorrelationScope`
- `ExternalCorrelationScope -> emits -> SemanticAPIActivityBinding`
- `SemanticAPIActivityBinding -> eager_maps_to -> KernelLaunchWitness`
- `SemanticAPIActivityBinding -> graph_maps_to -> GraphLaunchSemanticWitness`
- `GraphLaunchSemanticWitness -> requires -> GraphTopologyBinding`
- `GraphTopologyBinding -> resolves -> GraphNodeSemanticIdentity`
- `SchedulerThreadScope --does_not_automatically_propagate_to-> LaunchThreadScope`
- `ExternalCorrelationId --does_not_directly_prove-> GraphNodeSemanticIdentity`

## 與歷史研究比較

上一輪已把 `LayerInvocationSemanticEpoch -> CUPTI launch correlation set` 定義成最淺缺口；本輪把這個 bridge從概念落到 CUPTI真實 state machine，並發現它不是單一路徑：Eager可以直接 API->kernel correlation，Graph replay必須先綁 graph launch再走 topology/node evidence。這避免把 External Correlation誤當成「任意 semantic tag直接出現在每個 kernel」。

### 本輪結束判斷
- 缺哪一層：FULL/Piecewise Graph中 capture-time layer topology如何與 replay-time graphId/sourceGraphNodeId穩定對接。
- 最淺節點：`GraphTopologyBinding` production instance；Eager path的設計已比上一輪明確。
- 哪個概念仍只是名詞：跨 Eager/Graph/rank 的 `CanonicalLaunchWitness`。
- 哪個系統值得讀原始碼：vLLM FULL/Piecewise CUDA Graph capture manager + NVIDIA `cuda_graphs_trace` sample。
- 哪篇論文需追引用：本輪無新增必追論文；優先把官方 tracing semantics與 production source閉合，比增加文獻數更重要。
- 最適合視覺模擬：Semantic Scope Stack × GPU Correlation Microscope。
- 最值得實作的 Agent 架構：`State-grounded Planner + Runtime Provenance Verifier + Semantic Correlation Bridge + Graph/Eager Evidence Adapter + Causal Evidence Gate + Tool Executor`。

## 證據分類

- 已確認事實：CUPTI external correlation是 per-thread/per-kind stack；ExternalCorrelation record連 externalId與CUDA API correlationId；Runtime/Driver API activity需啟用；GraphTrace2 correlationId對應graph launch。
- 官方資訊：CUPTI current tracing、CUDA Graph per-node/graph-level trace語義。
- 工程實作交叉驗證：ONNX Runtime CUDA Plugin EP使用StartEvent/StopEvent push/pop CUPTI external correlation IDs。
- 工程設計建議：semantic side-table、64-bit externalId allocator、balanced scope guard、Eager/Graph adapter。
- 合理推論：FULL graph一次 replay的 external semantic scope可能只能直接綁 replay/step，而layer identity需capture-time topology補足。
- 尚未驗證假說：在vLLM production GPU process中加入此 instrumentation可維持低 overhead且不影響 capture/replay correctness。