# 【AI Agent × Multimodal Research Report】

**時間：2026-09-20 10:53（Asia/Taipei）**  
**主題：SemanticEpoch × SlotMapping × Physical KV Slot × Runtime KV Read Binding**

## 本小時新發現

本輪延續上一輪 `Raw cudaStream_t → CUPTI Stream ID → GraphReplayRuntimeBound`，刻意不再重複 stream identity。研究焦點下移到下一個尚未閉合的問題：**已驗證某次 Graph Replay 在正確 stream 執行，仍不等於知道 attention kernel 讀了哪個 request/token 的哪個 physical KV slot。**

新證據顯示 current vLLM 的 block table 不只是 scheduler metadata：`compute_slot_mapping()` 把 `query_start_loc + positions + block_table.gpu + block_size` 送入 GPU kernel，輸出 `slot_mapping.gpu`；`commit_block_table()` 則把 CPU block table 非同步複製到 GPU。換言之，request-level logical KV provenance 必須穿過一個 **BlockTable → SlotMapping → KV-cache update/read** 的地址轉換層，才能抵達 physical KV evidence。

同時 current vLLM attention backend 明確存在 `do_kv_cache_update(..., kv_cache, slot_mapping)` 路徑；例如 TurboQuant backend 在 attention forward 前，以 `slot_mapping` 將本 step 的 K/V 寫入 combined KV cache。這使 `slot_mapping` 成為「logical token → physical KV location」的核心 witness，而不是可忽略的中間 tensor。

CUPTI 13.4 的 per-node trace 能在 graph 內 kernel/memcpy/memset activity 上提供 `graphId + graphNodeId`，並新增 `sourceGraphId/sourceGraphNodeId` lineage；Graph-level trace則提供低成本 replay evidence但不展開 nodes。因此 production verifier 應維持兩階段：graph-level 常駐 + sampled node-level deep verification。

## 本小時最重要 5 個發現

### 1. GraphReplayRuntimeBound 不等於 RuntimeKVReadWitness
- **已確認事實**：CUPTI GraphTrace 可以證明 graphId/contextId/streamId/correlationId。
- **限制**：它不能告訴我們 attention kernel 讀取哪一個 physical KV slot。
- **結論**：新增否定 edge：`GraphReplayRuntimeBound --does_not_prove→ RuntimeKVReadWitness`。

### 2. SlotMapping 是 logical token → physical KV 的地址翻譯層
- **工程實作**：vLLM `BlockTable.compute_slot_mapping()` 使用 request count、token positions、GPU block table、block size 等輸入，寫入 `slot_mapping.gpu`。
- **底層鏈**：`Request/Token → position → block-table row/block → slot mapping → physical KV slot`。
- **重要性**：若沒有保存 slot-mapping generation/epoch，之後即使看到 attention kernel，也無法把 kernel memory semantics可靠綁回 request/token。

### 3. KV write provenance 與 KV read provenance必須分開
- **工程實作**：attention backend 可先依 `slot_mapping` 將 K/V 寫入 cache，再進入 attention read。
- **模型**：`KVWriteWitness(slot, layer, epoch)` 與 `KVReadWitness(slot, layer, replay)` 是不同事件。
- **限制**：寫入某 slot 不代表後續 consumer 一定讀該 slot；需要 attention metadata/block-table consumer evidence。

### 4. Physical address 仍不足以代表 semantic identity
同一 physical slot 可被不同 request/lease epoch 重用。因此最小 identity 應是：
`(device, cache_group, layer, physical_block, slot_offset, KVLeaseEpoch, ContentEpoch)`。
只保存 pointer/block number 會在 eviction/reuse 後產生 provenance aliasing。

### 5. Causal intervention target 必須綁定 provenance tuple
KV zero/replace/sham 不能只說「改第 91 block」。正確 target 應包含 request/token/layer/head/lease epoch/physical slot/replay epoch，否則 intervention 可能打到已重用的 cache，得到假的 causal conclusion。

## Architecture Breakdown

```text
User / Agent Step
  ↓
SchedulerStepEpoch
  ↓
RequestId + TokenPosition
  ↓
BlockTable ContentEpoch
  ↓ H2D
GPU BlockTable
  ↓ compute_slot_mapping
SlotMappingEpoch
  ↓
Physical KV Slot Identity
  ├─ KV Write Witness (new K/V)
  └─ KV Read Candidate
        ↓
SemanticEpoch
  ↓
GraphReplayRuntimeBound
  ↓ sampled CUPTI node trace
Attention GraphNode / Kernel
  ↓ join
RuntimeKVReadWitness
  ↓
Causal Intervention Target
  ↓
ΔAttention → ΔResidual → ΔLogit → ΔToken → ΔAgentAction
```

## Bottom-Level Logic

定義 physical KV identity：

```text
PhysicalKVIdentity = {
  device_id,
  cache_group_id,
  layer_id,
  physical_block_id,
  slot_offset,
  kv_lease_epoch,
  content_epoch
}
```

定義 read binding：

```text
RUNTIME_KV_READ_BOUND(R, K) =
  GRAPH_REPLAY_RUNTIME_BOUND(R)
  ∧ ATTENTION_NODE_BOUND(R)
  ∧ SLOT_MAPPING_EPOCH_BOUND(R)
  ∧ KV_LEASE_VALID(K, R)
  ∧ PHYSICAL_SLOT_MATCH(K, R)
```

其中 `PHYSICAL_SLOT_MATCH` 不能由 data_ptr 單獨成立。

### Evidence grade

```text
E0 LOGICAL_ONLY
E1 BLOCK_TABLE_EPOCH_BOUND
E2 SLOT_MAPPING_EPOCH_BOUND
E3 PHYSICAL_KV_SLOT_BOUND
E4 GRAPH_REPLAY_BOUND
E5 ATTENTION_NODE_BOUND
E6 RUNTIME_KV_READ_BOUND
E7 INTERVENTION_TARGET_BOUND
E8 CAUSAL_EFFECT_OBSERVED
```

## Visual Simulation Idea

### Logical Token → Physical KV → Attention Read Microscope

互動 UI 同時顯示三層：

```text
SEMANTIC
Req A / token 204 / layer 18
        ↓
ADDRESS TRANSLATION
BlockTable E207
row 3 → block 91
        ↓
SlotMapping S311
physical slot = block91:offset7
lease = L44
        ↓
GPU EXECUTION
Graph R95 / G12 / N57
Attention Kernel K910
        ↓
KV READ
layer18 / block91 / offset7 / lease L44
        ↓
VERDICT
RUNTIME_KV_READ_BOUND
```

介面應允許拖動時間軸觀察 block reuse；如果 block 91 在下一 epoch 改屬 Req C，立即顯示 `PHYSICAL_SLOT_REUSED`，禁止把舊 semantic identity 沿用。

## Code / GitHub

### vLLM 值得繼續追的核心檔案
- `vllm/v1/worker/block_table.py`：BlockTable、commit、slot mapping。
- `vllm/v1/utils.py`：`CpuGpuBuffer.copy_to_gpu()`，non-blocking H2D。
- `vllm/v1/attention/backend.py`：attention metadata / block-table update abstraction。
- `vllm/v1/attention/backends/triton_attn.py`：packed KV cache physical layout。
- `vllm/v1/attention/backends/turboquant_attn.py`：`do_kv_cache_update` 與 slot mapping write path。

### 下一個 source-reading target
1. 找出 active attention backend 如何從 block table/metadata解析 read blocks。
2. 找 attention custom op 到 Triton/CUDA kernel 的參數界線。
3. 找 layer/cache-group identity 如何進 kernel metadata。
4. 建立 attention-node classifier：kernel symbol + graphNodeId + layer execution context。

## Papers

### Identify Critical KV Cache in LLM Inference from an Output Perturbation Perspective
- Authors: Yuan Feng, Junlin Lv, Yukun Cao, Xike Xie, S. Kevin Zhou
- Year: 2025
- Architecture: 以 attention output perturbation 建立 KV criticality，而非只看 attention weight。
- Dataset/benchmark: Needle-in-a-Haystack、LongBench。
- Contribution: 指出 value state 與 pretrained parameter matrices 也影響 KV entry 對輸出的擾動。
- Limitation: criticality/perturbation 分析不等於 production runtime physical-slot provenance。
- 對 Hermes 的改變：intervention UI 不應只顯示 attention weight；應同時量測 output perturbation。

### Multi-Segment Attention: Enabling Efficient KV-Cache Management for Faster Large Language Model Serving
- Authors: Chunan Shi, Yilei Chen, Yilin Chen, Xupeng Miao, Bin Cui
- Year: 2026
- Architecture: Multi-Segment Attention + latency-aware cache eviction + adaptive chunking。
- Contribution: 把 KV residency 與 GPU attention kernel execution efficiency一起最佳化。
- Limitation: serving performance evidence不能直接作 causal attribution evidence。
- 對 Hermes 的改變：Knowledge Graph 新增 `KVResidencyDecision → AttentionKernelExecutionCost`。

### Tutti: Making SSD-Backed KV Cache Practical for Long-Context LLM Serving
- Authors: Shi Qiu et al.
- Year: 2026
- Architecture: GPU-centric KV object store + GPU io_uring + slack-aware I/O scheduling，並整合 vLLM。
- Contribution: 把 KV provenance 問題延伸到 HBM/DRAM/NVMe tier；physical KV identity不能假定永遠在 HBM。
- Limitation: 主要回答 serving I/O/performance，不回答 semantic provenance。

## Unknown / Open Questions 1-3

1. active vLLM attention backend 的 kernel read path 中，哪個 runtime object 最適合直接觀測「本 kernel 實際允許讀哪些 physical blocks」？
2. CUDA Graph replay 下，slot mapping/block-table metadata是否都位於 persistent static buffers；各 backend 是否有不同更新策略？
3. 如何以低 overhead 保存 `KVLeaseEpoch`，避免 block eviction/reallocation後 semantic aliasing？

## Knowledge Graph 新增 Node / Edge

### Nodes
- `SlotMappingEpoch`
- `PhysicalKVIdentity`
- `KVLeaseEpoch`
- `KVWriteWitness`
- `KVReadCandidate`
- `AttentionNodeBindingWitness`
- `RuntimeKVReadWitness`
- `PhysicalSlotReuseState`
- `InterventionTargetBinding`
- `KVStorageTierIdentity`
- `KVResidencyDecision`

### Edges
```text
BlockTableContentEpoch --generates→ SlotMappingEpoch
SlotMappingEpoch --maps→ PhysicalKVIdentity
PhysicalKVIdentity --receives→ KVWriteWitness
GraphReplayRuntimeBound --contains→ AttentionNodeBindingWitness
AttentionNodeBindingWitness --consumes_candidate→ PhysicalKVIdentity
KVLeaseEpoch --guards→ PhysicalKVIdentity
RuntimeKVReadWitness --requires→ AttentionNodeBindingWitness
RuntimeKVReadWitness --requires→ SlotMappingEpoch
RuntimeKVReadWitness --requires→ KVLeaseEpoch
RuntimeKVReadWitness --enables→ InterventionTargetBinding
PhysicalSlotReuseState --invalidates→ stale semantic binding
GraphReplayRuntimeBound --does_not_prove→ RuntimeKVReadWitness
KVResidencyDecision --affects→ AttentionKernelExecutionCost
```

## 與歷史研究比較

前幾輪已依序閉合：BlockTable ContentEpoch → H2D visibility → stream ordering → SemanticEpoch external correlation → replay thread → replay stream → raw `cudaStream_t` → CUPTI stream identity。本輪沒有重做這些層，而是把問題向真正 model semantics 推進：**從「哪一次 GPU graph 執行」進到「那次 attention 執行實際對應哪個 logical token / physical KV slot」。**

## 下一輪研究

```text
SlotMappingEpoch
→ active attention backend metadata
→ attention custom op arguments
→ Triton/CUDA kernel block-table read
→ layer/cache-group identity
→ sampled CUPTI graphNodeId
→ kernel symbol / node classifier
→ PhysicalKVIdentity join
→ RuntimeKVReadWitness
→ sham writeback
→ zero/replace KV
→ ΔAttention
→ ΔResidual
→ ΔLogit
→ ΔGeneratedToken
→ ΔAgentAction
```

## 本輪結束判定

- **缺哪一層**：attention backend metadata → exact kernel KV-read set 的 runtime evidence。
- **哪個節點最淺**：`AttentionNodeBindingWitness` production instance。
- **哪個概念仍只是名詞**：`RuntimeKVReadWitness` 與 `AgentActionCausalBound`。
- **哪個系統值得讀原始碼**：vLLM active attention backend + custom attention op + Triton/CUDA kernel。
- **哪篇論文需追引用**：`Identify Critical KV Cache in LLM Inference from an Output Perturbation Perspective`，特別追 KV perturbation / eviction 與 mechanistic causal analysis 的交集。
- **哪個概念最適合視覺模擬**：`Logical Token → BlockTable → SlotMapping → Physical KV → Attention Read`。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + Runtime Provenance Verifier + Causal Evidence Gate + Tool Executor`。

本輪最重要的模型修正：**正確 replay stream 只是 execution provenance；真正回答「AI 為什麼產生這個 token/action」還必須穿過 slot mapping 與 KV lease，把 logical request/token identity綁到 attention kernel 實際消費的 physical KV state。**