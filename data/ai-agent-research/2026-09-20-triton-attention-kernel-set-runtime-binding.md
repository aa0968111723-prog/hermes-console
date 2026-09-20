# 【AI Agent × Multimodal Research Report】

時間：2026-09-20 14:50（Asia/Taipei）

主題：Triton Attention Kernel-Set × 2D/3D Dispatch × Runtime KV Read Provenance

## 本小時新發現

本輪延續上一輪「Breakable CUDA Graph × Attention Execution Domain」，不再假設 Attention 必定是一個 CUDA Graph node，也不再假設一次 Attention forward 必定只 launch 一個 kernel。直接追 vLLM current `TritonAttentionImpl.forward()` 與 `triton_unified_attention.py` 後，可確認 decoder attention 的 runtime path 是：Layer/AttentionContext → KV cache views + metadata → `unified_attention(...)` → 依 runtime geometry 選擇 2D 或 3D attention path。2D path launch `kernel_unified_attention` 一次；3D path先 launch segmented `kernel_unified_attention`，再 launch `reduce_segments` 做 segment softmax/output reduction。因此 universal runtime identity 應是 `AttentionKernelSetIdentity`，不是單一 `AttentionKernelIdentity`。

同時 current source 顯示 INT4 per-token-head KV quantization會轉入專用 `unified_attention_int4`，encoder attention則直接走 `context_attention_fwd` 且不使用 decoder KV cache。這表示「backend=TRITON_ATTN」本身仍不足以唯一決定 kernel-set；還必須加入 attention type、KV quant mode、2D/3D dispatch、multimodal/sliding-window/chunk metadata 與 runtime geometry。

## 本小時最重要 5 個發現

### 1. Attention 是 runtime kernel-set，不一定是一個 kernel

已確認工程實作：`TritonAttentionImpl.forward()` 取得 `query_start_loc / seq_lens / block_table / max_query_len / max_seq_len / 3D segment buffers / multimodal prefix metadata` 後呼叫 `unified_attention`。在 unified attention 中，2D path launch `kernel_unified_attention`；3D path則 launch同一 core kernel的 segmented grid，完成後再 launch `reduce_segments`。

底層：
`Layer → MetadataEpoch → unified_attention → DispatchPredicate → {2D: CoreKernel | 3D: SegmentedCoreKernel → ReduceKernel}`。

重要性：CUPTI trace若看到兩個 kernel，不應誤判成兩個 attention layers；反之只抓 core kernel也不能宣稱完整 attention output已完成。

限制：這是 current Triton backend source-level model；不同 backend、INT4 path、encoder path必須有自己的 adapter。

### 2. 3D attention 的 causal/output boundary 在 reduction kernel之後

已確認工程實作：3D core kernel把 per-segment output、max、exp-sum寫入 intermediate buffers；`reduce_segments` 重新計算 global max，rescale segment exp sums，合併 segment outputs並寫最終 output。因此 3D path的 `AttentionOutputWitness` 必須在 reduction完成後才能成立。

底層：
`KV Read → Segment QK/Softmax/PV → {segm_output, segm_max, segm_expsum} → reduce_segments → FinalAttentionOutput`。

重要性：未來 SHAM/ZERO/REPLACE KV intervention 若只量第一個 kernel的結果，可能量到中間狀態而不是模型真正消費的 attention output。

### 3. Kernel-set dispatch 本身是 semantic provenance 的一部分

已確認工程實作：dispatch受 `seq_threshold_3D / num_par_softmax_segments / max_seqlen_q / max_seqlen_k / query shape / KV quant mode` 等條件影響。INT4 per-token-head模式直接切到專用 implementation；encoder attention甚至不走 decoder KV cache。

因此新增：
`AttentionExecutionVariant = (backend, attention_type, kv_quant_mode, dimensional_path, mask_mode, cache_layout)`。

重要性：同一 LayerName在不同 request/batch epoch可能對應不同 kernel-set，不能把一次 calibration永久套用。

### 4. CUPTI correlationId + kernel name + graph IDs 可以形成 kernel-launch witness，但仍需 layer-side scope

官方 CUPTI 13.4 Kernel activity確認 kernel execution帶 `correlationId`、kernel `name`、`gridId`；Kernel13對 graph launch還帶 `graphId/graphNodeId` 與 source graph lineage。`graphNodeId=0` 對 eager kernel是合法值。因此 verifier應統一建立 `KernelLaunchWitness`，再由 execution-domain adapter解釋 graph/eager，而不是以 graphNodeId存在與否作唯一 classifier。

限制：kernel name不是 layer semantic identity；Triton同一 compiled kernel可被多層重用，因此仍需 layer invocation scope/correlation calibration。

### 5. KV numerical path也是 causal experiment需要固定的 confounder

論文《The Illusion of Equivalence: Systematic FP16 Divergence in KV-Cached Autoregressive Inference》(Ranjith Chodavarapu, Lei Xu, 2026) 報告 cache-ON/OFF 在FP16下可因浮點累積順序產生系統性 divergence，FP32控制大幅消除差異。這提醒 causal verifier：`KV intervention → token change` 前必須固定 precision、backend、kernel variant、cache mode、sampling，否則 numerical execution path本身可能是 confounder。

## Architecture Breakdown

本輪 system architecture：vLLM Triton decoder attention execution tape。

`LayerSemanticIdentity`
→ `get_attention_context(layer_name)`
→ `TritonAttentionImpl.forward`
→ `AttentionMetadataEpoch`
→ KV cache view / quantization view
→ `unified_attention`
→ `AttentionExecutionVariant`
→ 2D 或 3D dispatch
→ `AttentionKernelSetIdentity`
→ CUPTI KernelLaunchWitness(es)
→ `AttentionKernelSetCompletionWitness`
→ EffectiveKVReadSet
→ FinalAttentionOutput
→ residual stream。

3D path：
`kernel_unified_attention(segment grid)`
→ intermediate segment output/max/expsum
→ `reduce_segments`
→ final output。

2D path：
`kernel_unified_attention`
→ final output。

Breakable CUDA Graph環境下，上述 attention kernel-set可處於 eager execution domain；FULL graph-capable模式則可由 graph-specific witness補充，但 universal identity仍是 kernel-set。

## Bottom-Level Logic

對 decoder KV read，core kernel接受 `key_cache_ptr / value_cache_ptr / block_tables_ptr / seq_lens_ptr` 與 cache strides。讀取模型可拆為：

`seq_idx`
→ `seq_len`
→ effective mask/window/chunk/MM-prefix bounds
→ logical KV positions
→ logical block index
→ `block_table[seq, logical_block]`
→ physical block index
→ offset-in-block
→ KV head
→ cache stride arithmetic
→ K/V tile load
→ QK score
→ mask/softcap/alibi/quant scaling
→ online softmax state
→ PV accumulation。

若 3D：
→ segment partial state
→ reduction kernel
→ final attention output。

新的 RuntimeKVReadWitness predicate：

`RuntimeKVReadWitness = LayerInvocationBound ∧ MetadataEpochBound ∧ KernelSetVariantBound ∧ EffectiveReadSetDerived ∧ KernelLaunchSetObserved ∧ KernelSetCompleted ∧ PhysicalKVLeaseValid`。

## Visual Simulation Idea

### Attention Kernel-Set Execution Microscope

左欄 Semantic：Layer 18 / request epoch / metadata epoch / KV lease epoch。

中欄 Dispatch：TRITON_ATTN → decoder → FP16/FP8/INT4 → 2D or 3D → mask/window/MM-prefix。

右欄 GPU Tape：

2D：`K77 core_attention → Final Output`

3D：`K81 segmented_attention → intermediate buffers → K82 reduce_segments → Final Output`

每個 kernel顯示 CUPTI correlationId、gridId、graphId/nodeId（若存在）、stream/context與 timestamps。點選 kernel可反向顯示 logical positions → physical blocks → K/V address-set。

若只觀測到3D core而沒有 reduce kernel：`KERNEL_SET_INCOMPLETE`。
若同一 layer calibration突然從2D切3D但 binder仍套舊模板：`EXECUTION_VARIANT_MISMATCH`。
若 eager kernel graphNodeId=0：`EXPECTED_EAGER_DOMAIN`。

## Code / GitHub

vLLM：
- `vllm/v1/attention/backends/triton_attn.py`：`TritonAttentionImpl.forward()`、decoder/encoder split、KV views、metadata binding、`unified_attention` call、KV cache update。
- `vllm/v1/attention/ops/triton_unified_attention.py`：`kernel_unified_attention`、2D/3D dispatch、`reduce_segments`、mask/quant/cache pointer arithmetic。
- 下一輪應讀：INT4 `vllm/v1/attention/ops/int4_per_token_head.py`，以及 breakable CUDA graph wrapper與 layer invocation scope。

值得建立 instrumentation：
`LayerInvocationBegin(layer_name, metadata_epoch, variant)`
→ CUPTI kernel activity set
→ `LayerInvocationEnd`
→ kernel-set matcher。

## Papers

1. **The Illusion of Equivalence: Systematic FP16 Divergence in KV-Cached Autoregressive Inference** — Ranjith Chodavarapu, Lei Xu — 2026. Architecture: KV-cached autoregressive transformer inference. Contribution: 將 cache-ON/OFF divergence定位到FP16 accumulation ordering / stateful KV path。Limitation: 實驗模型與硬體/precision範圍有限，需獨立重現與更多 serving backend驗證。

2. **Back from the Future: Key-Value Cache Management by Counter-Causal Surprise** — Stephen Gould, Anton van den Hengel — 2026. Architecture: counter-causal attention pass為KV eviction評分。Contribution: 用未來上下文預測過去token來估計冗餘，並提供single-layer approximation。Limitation: eviction utility不等同於特定 runtime layer/kernel的 causal attribution。

3. **Multi-Segment Attention: Enabling Efficient KV-Cache Management for Faster Large Language Model Serving** — Chunan Shi, Yilei Chen, Yilin Chen, Xupeng Miao, Bin Cui — 2026. Architecture: MSA + cache eviction + adaptive chunking。Contribution: 把KV residency與GPU attention kernel efficiency共同建模。Limitation: 系統效能結果依 workload/hardware/configuration，不能直接外推至 Hermes runtime。

## Unknown / Open Questions

1. 如何在不顯著擾動 eager attention latency的前提下，把 `layer_name invocation` 與一組 CUPTI kernel correlations精確 join？
2. Triton JIT kernel name/signature在 shape/constexpr/quant mode變化時的穩定性如何？應使用 name、grid、launch params、source hash還是組合 fingerprint？
3. Composite backend（例如 multimodal routing在 Triton/FlashInfer間切換）如何定義跨 backend canonical `AttentionKernelSetIdentity`？

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `AttentionExecutionVariant`
- `AttentionDimensionalPath2D`
- `AttentionDimensionalPath3D`
- `SegmentedAttentionKernelWitness`
- `AttentionReductionKernelWitness`
- `AttentionKernelSetCompletionWitness`
- `LayerInvocationScopeWitness`
- `KernelSetFingerprint`
- `ExecutionVariantMismatchState`
- `KernelSetIncompleteState`
- `NumericalExecutionPathIdentity`
- `KVNumericalConfounder`

新增 Edges：
- `LayerSemanticIdentity --invokes→ AttentionExecutionVariant`
- `AttentionExecutionVariant --selects→ AttentionKernelSetIdentity`
- `AttentionDimensionalPath3D --requires→ AttentionReductionKernelWitness`
- `SegmentedAttentionKernelWitness --produces→ SegmentIntermediateState`
- `SegmentIntermediateState --consumed_by→ AttentionReductionKernelWitness`
- `AttentionReductionKernelWitness --produces→ FinalAttentionOutput`
- `AttentionKernelSetCompletionWitness --supports→ RuntimeKVReadWitness`
- `KernelName --does_not_prove→ LayerSemanticIdentity`
- `CoreKernelObserved --does_not_prove→ FinalAttentionOutput` (3D path)
- `NumericalExecutionPathIdentity --confounds→ CausalInterventionResult` unless controlled。

## 與歷史研究比較

前一輪已把 universal identity從 `GraphNode`修正為 `AttentionKernelLaunch/KernelSet`；本輪首次用 current Triton source把 `KernelSet`具體化：2D=單一 core launch，3D=segmented core + reduction，且 INT4/encoder另有分支。這避免重複前幾輪的 stream/graph identity研究，並把最淺節點從「kernel-set只是名詞」推進到可由 source-derived execution template與 CUPTI launch records驗證的結構。

## 本輪結束判定

缺哪一層：`LayerInvocationScope → CUPTI correlation set` 的 production runtime join。

哪個節點最淺：`LayerInvocationScopeWitness`。

哪個概念仍只是名詞：跨 backend 的 `CanonicalAttentionKernelSetIdentity`。

哪個系統值得讀原始碼：vLLM composite attention routing、INT4 attention path、breakable CUDA graph wrapper。

哪篇論文需追引用：`The Illusion of Equivalence`，尤其追 KV numerical equivalence / cache precision / stateful inference reproducibility。

哪個概念最適合視覺模擬：`Layer → Dispatch Variant → Kernel Set → Effective KV Read Set → Final Attention Output`。

哪個 Agent 架構最值得實作：`State-grounded Planner + Runtime Provenance Verifier + Execution-Domain/Variant Adapter + Causal Evidence Gate + Tool Executor`。

## 下一輪研究

`LayerInvocationScope`
→ active/composite backend routing
→ execution variant fingerprint
→ NVTX/external-correlation or equivalent low-overhead semantic scope
→ CUPTI kernel correlation set
→ 2D/3D kernel-set matcher
→ layer/KV tensor/metadata epoch join
→ EffectiveKVReadSet
→ PhysicalKVIdentity + lease epoch
→ RuntimeKVReadWitness
→ controlled SHAM
→ ZERO/REPLACE KV
→ ΔAttentionOutput
→ ΔResidual
→ ΔLogit
→ ΔGeneratedToken
→ ΔAgentAction。

最終目標鏈仍維持：UI → Agent → Context → Reasoning/Planning → Memory/Tools/MCP → Model → layer invocation → attention execution variant → kernel set → physical KV read → logits → sampling → output/action；多模態再把 image/audio/video encoder tokens與MM-prefix/routing epoch接入同一條可驗證 provenance graph。