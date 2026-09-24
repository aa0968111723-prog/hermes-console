# 【AI Agent × Multimodal Research Report】

時間：2026-09-24 13:53（Asia/Taipei）

主題：TokenSemanticBinding → Physical Weight Shards → Quantization → LoRA/Adapter → Embedding/Linear Execution → ModelWeightStateWitness

## 與歷史研究比較

上一輪已建立 ChatTemplateGeneration、PromptCompilationWitness、RoleControlTokenBindingWitness、TokenSemanticBinding、EmbeddingMatrixGeneration、Position/RoPE 與 multimodal placeholder lineage。本輪刻意不再研究 prompt/template，而是補其最直接的缺口：logical token/model identity 如何綁定到真正被 runtime 載入、切 shard、量化、套 adapter 後參與計算的 physical weights。

## 本小時新發現

### 新架構：Physical Model Weight State Plane

應把 model identity 拆成至少六層：

CheckpointArtifact → WeightConversion → LogicalParameter → PhysicalShard → QuantizationState → AdapterOverlay → RuntimeParameter

單一 model name / revision 不足以證明一次 forward 使用了哪一份 physical parameter state。

### 新 GitHub 原始碼：vLLM VocabParallelEmbedding

current vLLM 的 VocabParallelEmbedding 明確沿 vocabulary dimension 做 tensor parallel sharding，並把 base vocabulary 與 LoRA-added embeddings 分別 padding/shard 後放入同一 tensor。初始化時 quantization method 也直接參與 weight creation。weight_loader 再依 TP rank 的 vocab range narrow checkpoint tensor，只把該 rank 的 shard copy 到 parameter。forward 時每 rank只產生自己持有 token rows 的 embedding，其他位置 mask 成零，最後跨 TP ranks all-reduce 合成輸出。

這表示 logical `token_id = n` 到 embedding vector 之間，實際存在：

TokenID → GlobalVocabRow → TPShardOwner → LocalShardRow → Quantized/Unquantized Embedding Method → Partial Output → Collective Reduction → Initial Hidden State

### 新機制：Weight conversion is executable semantics

Transformers 的 dynamic weight loading已把 checkpoint loading建模成 conversion pipeline：checkpoint keys/tensors可以經 fused-weight conversion、MoE expert stacking、legacy rename、quantized deserialization，之後才 materialize 成 runtime parameter；on-the-fly quantization甚至在 conversion後才套用。因此 checkpoint digest相同，不代表 runtime tensor layout相同。

### 新機制：Quantization changes physical semantics

GPTQ以 approximate second-order information執行 one-shot weight quantization，原論文展示3/4-bit權重與大型模型推論；Transformers也支援 GPTQ/AWQ/bitsandbytes 等多種量化。故 provenance 不能只記 `dtype=int4`，還必須記 quantization algorithm、group/scale/zero-point layout、packing、kernel interpretation與 quantizer generation。

### 新機制：Adapter is an overlay, not a new base checkpoint

LoRA凍結 base weights並注入低秩 trainable matrices。對 linear layer可抽象成：

Y = X(W_base + scale · B·A)

因此 `BaseModelGeneration` 與 `EffectiveModelGeneration` 必須分開；adapter identity、rank、scale、target modules、activation/loading state都會改變 effective forward semantics。

## 本小時最重要 5 個發現

### 1. Same model revision ≠ same runtime weight state

是什麼：repo/model revision只是 artifact-level identity。

底層：checkpoint → loader/converter → TP/PP shard → quantization representation → adapter overlay → device tensor。

為什麼重要：Agent若只記 model name，無法證明兩次 inference使用相同 weights。

限制：不同 runtime對同 checkpoint可能有不同 packing/fusion/kernel layout。

分類：官方文件 + 工程實作 + 本研究建模。

### 2. Token ID到 embedding row中間存在 TP ownership

底層：global vocab row先依 TP rank切分；非本 rank token被 mask；owner rank lookup embedding；最後 all-reduce。

為什麼重要：`TokenSemanticBinding` 必須包含 global→local shard mapping與 collective generation。

限制：不同模型/runtime可能採 replicated embedding或其他 partition策略。

分類：已確認工程實作（vLLM source）。

### 3. Quantization config is part of model semantics

底層：FP/BF checkpoint可能轉為 int8/int4/FP8等 packed representation；runtime kernel依 scale/group/packing解碼並執行 matmul/embedding。

為什麼重要：同 logical W在不同 quantizer/kernel generation下不應視為相同 physical execution state。

限制：語意上可近似相同，但通常不 bitwise identical。

分類：論文結果 + 官方文件 + 合理系統建模。

### 4. LoRA creates an EffectiveWeightGeneration

底層：base W不變，但 forward加入低秩 ΔW；vLLM embedding甚至為 LoRA-added vocab保留獨立 padded/sharded區域。

為什麼重要：adapter hot-load/hot-swap可能讓同 request後續 token進入不同 effective model state。

限制：各 runtime的 merge/unmerge與 multi-LoRA execution不同。

分類：LoRA論文 + vLLM工程實作。

### 5. Collective reduction belongs to embedding provenance

底層：vocab-parallel embedding每 rank產生 partial output，再 all-reduce。輸出不只是某一張GPU的一列 weight lookup。

為什麼重要：需要證明 rank topology、shard set與 collective generation一致。

限制：通信 library/kernel與 fault semantics尚未深入。

分類：已確認工程實作 + 本研究推論。

## Architecture Breakdown

ModelArtifactIdentity
→ CheckpointFileSetIdentity
→ WeightLoaderGeneration
→ WeightConversionGraph
→ LogicalParameterIdentity
→ TensorParallelPartitionPolicy
→ PhysicalWeightShardGeneration
→ QuantizationGeneration
→ AdapterOverlayGeneration
→ RuntimeParameterGeneration
→ CollectiveTopologyGeneration
→ EffectiveModelWeightState
→ Embedding/Linear Kernel Invocation
→ HiddenStateGeneration

對 embedding：

TokenID
→ GlobalVocabularyRow
→ ShardOwner(rank)
→ LocalRow
→ PhysicalEmbeddingShard
→ Quantization Decode/Lookup
→ PartialEmbedding
→ TP AllReduce
→ InitialResidualStream

## Bottom-Level Logic

提出：

PhysicalWeightShardIdentity = H(
  baseCheckpointDigest,
  logicalParameterName,
  sourceTensorDigest,
  conversionGraphGeneration,
  partitionAxis,
  globalRange,
  tpRank,
  tpWorldSize,
  localShape,
  localDtype,
  deviceGeneration
)

QuantizedWeightGeneration = H(
  PhysicalWeightShardIdentity,
  quantizerAlgorithm,
  bitWidth,
  groupSize,
  scalesDigest,
  zeroPointsDigest,
  packingLayout,
  quantKernelGeneration
)

AdapterOverlayGeneration = H(
  baseModelGeneration,
  adapterArtifactDigest,
  adapterName,
  targetModules,
  rank,
  alphaScale,
  addedVocabGeneration,
  loadActivationEpoch
)

EffectiveModelWeightStateWitness = MerkleRoot(
  orderedRuntimeParameterGenerations,
  quantizationGenerations,
  adapterOverlays,
  tpTopology,
  collectiveGeneration,
  modelConfigGeneration
)

EmbeddingLookupWitness = H(
  TokenSemanticBinding,
  globalVocabRow,
  shardOwner,
  localRow,
  physicalEmbeddingShardGeneration,
  effectiveModelWeightState,
  collectiveGeneration,
  outputHiddenStateGeneration
)

重要 distinction：

CheckpointCorrect --does_not_prove→ RuntimeWeightsCorrect

RuntimeWeightsCorrect --does_not_prove→ AdapterSetCorrect

AdapterSetCorrect --does_not_prove→ CollectiveTopologyCorrect

SameTokenID --does_not_prove→ SameEmbeddingVector

## Visual Simulation Idea

### Model Weight → Hidden State Provenance Microscope

互動欄位：

Checkpoint files | Conversion DAG | Logical parameter | TP ranks | Physical shards | Quantization packing | LoRA overlays | Vocab rows | Collective | Hidden state

點 token ID 時，高亮：

Token 42 → global row 42 → TP rank owner → local row → packed/quantized bytes → dequant/lookup kernel → partial vector → all-reduce → hidden vector

故障注入：

WRONG_TP_SHARD_LOADED
CHECKPOINT_CONVERSION_RULE_CHANGED
QUANT_SCALE_FILE_MISMATCH
PACKING_LAYOUT_CHANGED
LORA_ADAPTER_HOT_SWAPPED
LORA_SCALE_CHANGED
ADDED_VOCAB_ROW_BOUND_TO_WRONG_ADAPTER
TP_WORLD_SIZE_CHANGED
COLLECTIVE_RANK_MISSING
MODEL_CONFIG_AND_WEIGHT_REVISION_MISMATCH

## Code / GitHub

vLLM值得持續追的核心檔案：

- `vllm/model_executor/layers/vocab_parallel_embedding.py`：vocab TP partition、LoRA-added vocab layout、quant method dispatch、weight_loader、all-reduce。
- `vllm/lora/layers/vocab_parallel_embedding.py`：LoRA embedding overlay。
- `vllm/lora/utils.py`：LoRA與 model layers mapping。
- `vllm/model_executor/model_loader/`：checkpoint → runtime parameter。
- `vllm/model_executor/layers/quantization/`：quantization abstraction / packing / kernels。
- `vllm/model_executor/layers/linear.py`：row/column parallel linear與 weight loader。
- `vllm/model_executor/layers/fused_moe/`：MoE expert physical state，下一階段的重要延伸。

## Papers

### LoRA: Low-Rank Adaptation of Large Language Models
Authors: Edward J. Hu, Yelong Shen, Phillip Wallis, Zeyuan Allen-Zhu, Yuanzhi Li, Shean Wang, Lu Wang, Weizhu Chen
Institution: Microsoft Research等
Year: 2021
URL: https://arxiv.org/abs/2106.09685
Code: https://github.com/microsoft/LoRA
Dataset: 多個 NLP benchmark/model adaptation實驗
Architecture: frozen base Transformer + trainable low-rank matrices
Contribution: 把 adaptation從完整 weight rewrite改成低秩 overlay
Limitations: runtime merge/hot-swap/multi-adapter provenance不是原論文目標
改變了什麼：證明 effective model state不必等於 base checkpoint state。

### GPTQ: Accurate Post-Training Quantization for Generative Pre-trained Transformers
Authors: Elias Frantar, Saleh Ashkboos, Torsten Hoefler, Dan Alistarh
Institution: IST Austria / ETH Zurich等
Year: 2022
URL: https://arxiv.org/abs/2210.17323
Code: https://github.com/IST-DASLab/gptq
Dataset: OPT/BLOOM等大型模型評估
Architecture: approximate second-order one-shot post-training weight quantization
Contribution: 將大型 Transformer權重壓到3/4-bit並保持高精度
Limitations: quantized runtime kernel/packing implementation仍可能改變 numerical behavior
改變了什麼：model weight identity不能再只用 FP checkpoint tensor表示。

## Unknown / Open Questions

1. 如何低成本對數百 GB / TB級 sharded model建立 runtime Merkle witness，而不阻塞模型啟動與 hot reload？
2. multi-LoRA / adapter hot swap時，應以 request、sequence還是 token為最小 EffectiveModelGeneration boundary？
3. NCCL/all-reduce topology或某 rank的 shard錯誤，如何被端到端 HiddenStateWitness偵測，而不對每層做昂貴 hash？

## 下一輪研究

下一輪優先研究：

EffectiveModelWeightStateWitness
→ RMSNorm/LayerNorm
→ Q/K/V projection
→ tensor-parallel row/column linear
→ RoPE
→ Attention
→ output projection
→ residual add
→ MLP / SwiGLU
→ MoE router / expert selection / expert parallel
→ layer-to-layer ResidualStateWitness

特別鎖定 MoE，因為「正確 weights」仍不代表 token被送到正確 experts。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：

- ModelArtifactIdentity
- CheckpointFileSetIdentity
- WeightLoaderGeneration
- WeightConversionGraph
- LogicalParameterIdentity
- TensorParallelPartitionPolicy
- PhysicalWeightShardGeneration
- QuantizationGeneration
- QuantizedWeightGeneration
- AdapterArtifactIdentity
- AdapterOverlayGeneration
- EffectiveWeightGeneration
- AddedVocabularyWeightGeneration
- RuntimeParameterGeneration
- CollectiveTopologyGeneration
- EffectiveModelWeightStateWitness
- GlobalVocabularyRowIdentity
- LocalShardRowIdentity
- EmbeddingLookupWitness
- HiddenStateGeneration

新增 Edges：

CheckpointFileSet --converted_by→ WeightConversionGraph
LogicalParameter --partitioned_by→ TensorParallelPartitionPolicy
LogicalParameter --materializes_as→ PhysicalWeightShardGeneration
PhysicalWeightShard --quantized_by→ QuantizationGeneration
BaseWeight --overlaid_by→ AdapterOverlayGeneration
AdapterOverlayGeneration --produces→ EffectiveWeightGeneration
TokenSemanticBinding --maps_to→ GlobalVocabularyRowIdentity
GlobalVocabularyRowIdentity --owned_by→ PhysicalWeightShardGeneration
PhysicalWeightShardGeneration --lookup_produces→ PartialEmbedding
PartialEmbedding --reduced_by→ CollectiveTopologyGeneration
CollectiveTopologyGeneration --produces→ HiddenStateGeneration
EffectiveModelWeightStateWitness --constrains→ ModelInvocationWitness

## 本輪結束判斷

缺哪一層：physical weights → per-layer residual computation / MoE routing。

哪個節點最淺：CollectiveTopologyGeneration，尚未深入 NCCL algorithm、rank failure與 numerical ordering。

哪個概念仍只是名詞：portable signed EffectiveModelWeightStateWitness。

哪個系統值得讀原始碼：vLLM `model_loader + quantization + linear + fused_moe + lora`。

哪篇論文需追引用：GPTQ後續 AWQ / SmoothQuant / FP8，以及 LoRA後續 multi-adapter serving。

哪個概念最適合視覺模擬：Model Weight → Hidden State Provenance Microscope。

哪個 Agent 架構最值得實作：Event-sourced Agent Runtime + PromptCompilationWitness + EffectiveModelWeightStateWitness + per-request AdapterGeneration + LayerState lineage。

## 端到端位置

目前已可描述：

User → UI → Agent → Context → Prompt Compiler → Token IDs → TokenSemanticBinding → Physical Weight Shards → Quantization/Adapters → Embedding Collective → Initial Hidden State → Transformer layers → GPU → logits → token → transport → observation → tool/effect → next context

多模態對應：

Camera/Image/Voice/Video → Encoder/Processor → Media Tokens/Features → Text-Media Alignment → Token/Feature Semantic Binding → Physical Encoder/Projector Weights → Fusion Hidden State → Transformer → Agent → Action

本輪把「模型」從一個抽象名稱拆成真正可驗證的 physical weight state；下一輪要繼續拆 Transformer layer本身。