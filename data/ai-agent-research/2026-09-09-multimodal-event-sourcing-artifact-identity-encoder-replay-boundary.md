# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-09 21:52（Asia/Taipei）

## 本輪研究主題
**Multimodal Event Sourcing × Artifact Identity × Preprocessing Provenance × Encoder Versioning × Visual Token Replay Boundary**

本輪延續上一輪「Event Sourcing × Deterministic Replay × LLM Nondeterminism × Replay/Fork Boundary」，刻意不再重複一般 LLM replay，而是補上前一輪最深缺口：**當 Agent 的決策依賴圖片、影片、相機、螢幕截圖、音訊或其他感測資料時，究竟應保存 raw media、processed tensor、vision encoder feature、projected visual tokens、fused tokens，還是只保存最後 LLM output，才能稱為真正可驗證的 multimodal replay？**

---

# 本小時新發現

1. **Qwen2.5-VL 的 multimodal input 並不是「image → 一組固定 tokens」**。目前 Hugging Face Transformers 實作顯示，影像/影片進入 vision stack 後至少經過 patch embedding、window permutation、vision positional encoding、32-layer vision blocks、full/window attention 切換與 patch merger；video 的 position indexing 還依賴 temporal grid / tokens-per-second / fps。這表示 raw image bytes 相同但 preprocessing / fps / processor / model revision 改變時，visual tokens 可能不同。
   - Source code: https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2_5_vl/modular_qwen2_5_vl.py
   - Qwen2.5-VL: https://github.com/QwenLM-corp/Qwen2.5-VL

2. **VLCache (2025) 已把 vision encoder output 與 decoder KV cache 都視為可以獨立 reuse 的 cache layer**，並指出非 prefix multimodal reuse 會累積 reuse error；作者提出 selective / layer-aware recomputation，在其實驗中只計算約 2–5% vision tokens，可達 1.2×–16× TTFT speedup，且維持接近 full recomputation 的 accuracy。這證明 vision representation 本身已是 production inference runtime 的一級 cache artifact，而不只是模型內部短暫 tensor。
   - Paper: https://arxiv.org/abs/2512.12977
   - Paper page: https://huggingface.co/papers/2512.12977
   - Code examined: https://github.com/Odysseusq/VLCache

3. **VLA-Cache (NeurIPS 2025) 證明 visual representation 的 identity 還具有 temporal locality**：相鄰 robot frames 可選擇性重用 unchanged visual-token KV，對 task-relevant / changed tokens 再計算。在其 LIBERO、SIMPLER 與 real-world robotics 實驗中報告最高 1.7× CUDA latency speedup、15% control-frequency increase，且 task success rate 損失很小。
   - Paper: https://arxiv.org/abs/2502.02175
   - NeurIPS: https://proceedings.neurips.cc/paper_files/paper/2025/hash/f062da1973ac9ac61fc6d44dd7fa309f-Abstract-Conference.html
   - Code/project: https://vla-cache.github.io/

4. **Q Cache (AAAI 2026) 顯示 visual computation redundancy 不只存在 token/time 軸，也存在 decoder layer 軸**。Lazy Attention / Q Cache 跨 layer 重用 query/attention patterns，在實驗中減少超過 35% KV cache，提升約 1.5× throughput，約犧牲 1% performance。這意味著「visual replay artifact」必須標記它屬於哪個 layer / stage，不能只用一個 `visual_cache` 名詞。
   - Paper: https://arxiv.org/abs/2602.01901
   - AAAI: https://ojs.aaai.org/index.php/AAAI/article/view/38414

5. 本輪建立新的工程結論：**Multimodal reproducibility 必須同時記錄 Artifact Identity 與 Transformation Lineage。** 只保存 `image_hash` 不足以重建實際 model input；至少還要記 processor revision、resize/crop policy、sampling/fps、grid metadata、dtype、encoder revision、projector revision、token layout / position metadata。

---

# 本小時最重要 5 個發現

## 1. Raw Media Identity ≠ Model Input Identity

### 是什麼
兩次 inference 即使使用完全相同 JPEG / PNG / MP4 bytes，也不代表模型實際看到相同 representation。

### 底層如何運作
以 Qwen2.5-VL 為例：

```text
Raw Image / Video
↓
Decode
↓
Resize / Pixel Budget
↓
Frame Sampling / FPS
↓
Pixel Tensor
↓
Patch Embed
↓
Vision Grid (T,H,W)
↓
Window / Full Attention
↓
Vision RoPE / Position IDs
↓
Vision Hidden States
↓
Patch Merger
↓
Projected Visual Representation
↓
LLM sequence
```

Qwen2.5-VL source code 的 vision config 明確包含 `patch_size=14`、`temporal_patch_size=2`、`spatial_merge_size=2`、`tokens_per_second`、window size 與 full-attention block indexes。其 `forward()` 根據 `grid_thw` 建立 vision position IDs、window index，再經 patch embed、vision blocks 與 merger。影片 position IDs 還依據 temporal grid / time interval。

### 為什麼重要
若 event log 只保存：

```text
image_hash = abc123
```

卻沒有保存：

```text
processor_revision
resize_policy
frame_sampler
fps
vision_model_revision
projector_revision
```

那麼未來 restore 時重新 encode，可能得到不同 visual tokens。

### 限制
目前不同 closed multimodal APIs 不一定公開 processor / encoder 版本，因此 strict feature-level replay 可能只能靠「保存 provider response / model outcome」，而不能自行重建 encoder state。

### 來源
- Qwen2.5-VL source: https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen2_5_vl/modular_qwen2_5_vl.py
- Qwen repo: https://github.com/QwenLM-corp/Qwen2.5-VL

---

## 2. Visual Artifact 其實有多個 Replay Boundary

不能再把 multimodal replay 寫成單一：

```text
Image
→ Visual Tokens
```

應拆成：

```text
A0 Raw Media
↓ T0 decode
A1 Decoded Frames
↓ T1 preprocessing
A2 Pixel Tensor
↓ T2 vision encoder
A3 Encoder Hidden State
↓ T3 merger/projector
A4 Projected Visual Tokens
↓ T4 multimodal packing
A5 Fused LLM Input
↓ T5 language model
A6 LLM Output
```

每個 `A_i` 都是不同 artifact class。

### Replay 模式

**Media Replay**
```text
save A0
re-run T0...T5
```
優點：storage 最接近原始證據、可以使用新模型重新分析。
缺點：不是 strict historical replay。

**Tensor Replay**
```text
save A2
re-run T2...T5
```
跳過 decode/preprocessing，但仍依賴 encoder implementation。

**Encoder Replay**
```text
save A3/A4
re-run later stages
```
可固定 perception representation，但 storage 很大、強烈 model-coupled。

**Outcome Replay**
```text
save A6
```
最容易重建 Agent execution history，但無法重新檢查 vision perception 過程。

因此新的結論是：

```text
Replay Fidelity
↑
需要保存更深的 execution artifacts

Portability
↑
通常需要保存更靠近 raw evidence 的 artifacts
```

兩者存在 trade-off。

---

## 3. Cache Hit ≠ Historical Replay Match

VLCache 的出現讓這個區別變得非常重要。

Inference cache 問的是：

```text
「這次計算能否安全重用之前的中間結果？」
```

Event replay 問的是：

```text
「我要不要重建『當時實際使用的結果』？」
```

因此：

```text
Cache Identity
≠
Historical Artifact Identity
```

VLCache 會在 cache hit 時選擇性 reuse / recompute，目標是效率與 accuracy trade-off；strict replay 則不能因為現在有更好的 recomputation policy，就把歷史 representation 靜默改掉。

需要兩種 key：

```text
ComputationReuseKey
= media + model + processor + stage + layout + runtime compatibility

HistoricalArtifactID
= immutable execution artifact produced in a specific run/event
```

### 來源
VLCache: https://huggingface.co/papers/2512.12977

---

## 4. Temporal Visual Identity 不是 Exact Byte Equality

VLA-Cache 處理 robot sequential frames 時，不要求兩張影像完全相同，而是找出相鄰 frames 中「變化很小」的 visual tokens，重用其計算結果，對 changed/task-sensitive token 重新算。

所以對 runtime 來說需要區分：

```text
Exact Artifact Identity
vs
Approximate Visual Equivalence
```

前者可用於 strict replay / provenance：

```text
SHA-256(bytes)
```

後者可以用於 efficiency：

```text
patch difference
visual similarity
motion / optical consistency
task relevance
```

Hermes Knowledge Graph 應明確禁止：

```text
Approximate Visual Equivalence
→ same_as
Historical Artifact
```

更合理的 edge：

```text
Artifact B
→ approximately_reuses
Artifact A
```

### 來源
VLA-Cache: https://proceedings.neurips.cc/paper_files/paper/2025/hash/f062da1973ac9ac61fc6d44dd7fa309f-Abstract-Conference.html

---

## 5. Multimodal Provenance 應該形成 Transformation DAG

本輪新的 Hermes 工程模型：

```text
Artifact
├ artifact_id
├ artifact_type
├ content_hash
├ parent_artifacts[]
├ transform_id
├ transform_version
├ model_revision
├ processor_revision
├ runtime_revision
├ dtype
├ shape
├ device/backend
├ spatial_metadata
├ temporal_metadata
├ created_by_event
└ branch_id
```

Transformation：

```text
Transform
├ transform_id
├ operation
├ code_revision
├ parameters
├ deterministic_class
├ input_artifact_ids[]
└ output_artifact_ids[]
```

因此：

```text
camera_frame_778
↓ resize(max_pixels=...)
pixel_tensor_991
↓ QwenVision@rev-X
vision_hidden_422
↓ PatchMerger@rev-X
visual_tokens_118
↓ multimodal_pack
context_774
↓ LLM
response_882
```

這張 DAG 才能回答：

> 「這個回答到底是由哪一張圖、哪一次 resize、哪一版 vision encoder、哪一組 visual tokens 所導致？」

---

# Architecture Breakdown

```text
Camera / Image / Video / Screen / Audio
↓
Capture Runtime
├ source URI / device
├ timestamp
├ world-state version
└ capture settings
↓
RAW ARTIFACT STORE
├ immutable bytes
├ content hash
└ provenance
↓
Media Decoder
↓
Decoded Artifact
↓
Preprocessor
├ resize
├ crop
├ normalize
├ pixel budget
├ frame sampler
├ fps
└ channel/layout
↓
Tensor Artifact
↓
Encoder Runtime
├ encoder model revision
├ weights hash
├ dtype
├ kernel/backend
└ position scheme
↓
Encoder Feature Artifact
↓
Projector / Merger / Resampler
↓
Visual Token Artifact
↓
Multimodal Context Compiler
├ text tokens
├ visual tokens
├ audio tokens
├ modality IDs
├ temporal/spatial IDs
└ context order
↓
Fused Context Artifact
↓
LLM
↓
Recorded Model Outcome
↓
Agent Event Store
↓
Plan / Tool / Action
```

與 event sourcing 結合後：

```text
Event E42: camera.captured
→ artifact raw_001

Event E43: media.preprocessed
raw_001 → tensor_019

Event E44: vision.encoded
tensor_019 → vision_883

Event E45: context.compiled
vision_883 + text_tokens → ctx_119

Event E46: llm.responded
ctx_119 → output_557
```

---

# Bottom-Level Logic

## Multimodal Replay Compatibility

本輪提出以下 Hermes 工程判定模型（不是現有標準公式）：

```text
StrictReplayCompatible(A, Runtime)
=
RawArtifactHashMatch
∧ TransformVersionMatch
∧ TransformParametersMatch
∧ ProcessorRevisionMatch
∧ EncoderRevisionMatch
∧ ProjectorRevisionMatch
∧ TokenLayoutMatch
∧ PositionMetadataMatch
```

若其中任何一項不同：

```text
STRICT_REPLAY
→ invalid
```

可改成：

```text
RECOMPUTE_EXPERIMENT
or
FORK
```

而不是宣稱同一歷史。

## Artifact Hash Ladder

推薦同時存：

```text
raw_hash
↓
decoded_hash
↓
preprocessed_tensor_hash
↓
encoder_feature_hash
↓
projected_token_hash
↓
fused_context_hash
↓
model_output_hash
```

這樣可以精確定位 replay divergence 首次出現在哪一層：

```text
raw_hash             MATCH
processed_hash       MATCH
encoder_feature_hash FAIL

→ divergence begins at encoder runtime
```

## Determinism Class

每個 transform 可分類：

```text
BYTE_DETERMINISTIC
NUMERICALLY_STABLE
BACKEND_DEPENDENT
STOCHASTIC
EXTERNAL_NONDETERMINISTIC
```

例如 GPU kernel / mixed precision 可能在 bitwise level 無法完全一致，因此 production replay 應分：

```text
Bitwise Replay
Numerical Replay
Semantic Replay
Decision Replay
```

不能把「語意回答差不多」和「歷史 computation 一致」混在一起。

---

# Visual Simulation Idea

## Multimodal Replay Microscope

Hermes Console 新增一個可互動 pipeline：

```text
[RAW IMAGE]
 hash 81af...
     ↓
[PREPROCESS]
 1024×768 → 896×672
 hash b220...
     ↓
[PATCH GRID]
 T=1 H=48 W=36
     ↓
[VISION ENCODER]
 Qwen2.5-VL vision rev X
 hash 92cd...
     ↓
[PATCH MERGER]
 visual tokens = N
 hash 4dd8...
     ↓
[FUSED CONTEXT]
 hash a9f3...
     ↓
[LLM OUTPUT]
```

UI 提供：

```text
REPLAY HISTORICAL
RECOMPUTE CURRENT
FORK WITH NEW ENCODER
DIFF
```

### Example

Historical run：

```text
Processor v1
Encoder rev A
FPS=2
↓
visual_token_hash = AAA
```

Current runtime：

```text
Processor v2
Encoder rev B
FPS=1
↓
visual_token_hash = BBB
```

Simulator 顯示：

```text
RAW MEDIA              MATCH
PREPROCESS CONFIG       FAIL
FRAME GRID              FAIL
VISION FEATURES         FAIL
FUSED CONTEXT           FAIL

STRICT REPLAY INVALID
→ Historical artifact playback available
→ New analysis requires FORK
```

還可以加入 sliding split view：

```text
Historical Visual Tokens
vs
Current Visual Tokens
```

並用 heatmap 顯示 token divergence、spatial region、temporal frames。

這個模擬器會把「同一張圖為什麼 AI 可能得到不同 representation」直接視覺化。

---

# Code / GitHub

## 1. Hugging Face Transformers — Qwen2.5-VL
Repository:
https://github.com/huggingface/transformers

值得追的核心檔案：

```text
src/transformers/models/qwen2_5_vl/
└ modular_qwen2_5_vl.py
```

重點 class / mechanism：

```text
Qwen2_5_VLVisionConfig
Qwen2_5_VisionTransformerPretrainedModel
Qwen2_5_VLVisionBlock
Qwen2_5_VLProcessor
get_vision_position_ids
get_vision_window_index
PatchEmbed
PatchMerger
```

已確認 source code 中 vision forward：

```text
hidden_states
→ patch_embed
→ window permutation
→ rotary position embedding
→ vision blocks
→ reverse window ordering
→ patch merger
```

而 mixed image/video/text 的 position indexing 使用不同 modality token type，video temporal IDs 依據 time interval / tokens-per-second。

## 2. Qwen2.5-VL
https://github.com/QwenLM-corp/Qwen2.5-VL

Quickstart 顯示 processor 的 `min_pixels/max_pixels` 可直接改變每張圖片產生的 visual-token 數量；video decoding backend 也可切換，進一步證實 preprocessing/runtime configuration 必須進 provenance。

## 3. VLCache
https://github.com/Odysseusq/VLCache

本輪不只讀 README，已確認 repository 包含：

```text
bench.py
example.py
example_vl.py
test_partial_recompute.py
nanovllm/
├ engine/
├ layers/
├ models/
├ utils/
├ config.py
└ sampling_params.py
```

值得下一輪繼續追：

```text
nanovllm/engine/
nanovllm/models/
nanovllm/layers/
test_partial_recompute.py
```

目的是追 encoder cache 與 KV partial recomputation 的真正 identity / invalidation logic。

---

# Papers

## VLCache: Computing 2% Vision Tokens and Reusing 98% for Vision-Language Inference
- Authors: Shengling Qin, Hao Yu, Chenxin Wu, Zheng Li, Yizhong Cao, Zhengyang Zhuge, Yuxin Zhou, Wentao Yao, Yi Zhang, Zhengheng Wang, Shuai Bai, Jianwei Zhang, Junyang Lin
- Institution: Qwen Team / Alibaba Inc.; TairKVCache Team / Alibaba Cloud
- Year: 2025
- URL: https://arxiv.org/abs/2512.12977
- Code: https://github.com/Odysseusq/VLCache
- Architecture: vision encoder cache + LLM KV reuse + selective/layer-aware recomputation
- Contribution: 將 multimodal repeated-input reuse 同時延伸至 encoder 與 KV stages；分析 cumulative reuse error
- Reported result: 2–5% token recomputation、1.2×–16× TTFT speedup、接近 full recomputation accuracy
- Limitation: 它研究的是 inference reuse / approximation，不等同 event-sourced strict historical replay；reuse policy 仍與模型和 workload 高度耦合。
- 改變了什麼：證明 intermediate visual representations 值得被當成一級 runtime artifacts，而非不可見內部細節。

## VLA-Cache: Efficient Vision-Language-Action Manipulation via Adaptive Token Caching
- Authors: Siyu Xu, Yunke Wang, Chenghao Xia, Dihao Zhu, Tao Huang, Chang Xu
- Institution: University of Sydney / Shanghai Jiao Tong University（公開資料）
- Year: 2025, NeurIPS 2025
- URL: https://arxiv.org/abs/2502.02175
- Project/Code: https://vla-cache.github.io/
- Dataset/Environment: LIBERO, SIMPLER, real-world robot
- Architecture: cross-frame changed-token detection + static token KV reuse + task-relevant recomputation + layer-adaptive reuse
- Contribution: 利用 sequential robot frames 的 temporal redundancy
- Reported result: up to 1.7× CUDA latency speedup, +15% control frequency, negligible task-success degradation
- Limitation: approximate reuse 是 efficiency mechanism，不可直接當作 canonical perception history。
- 改變了什麼：把 visual identity 從 exact-image cache 擴展成 temporal approximate reuse。

## Q Cache: Visual Attention is Valuable in Less than Half of Decode Layers for Multimodal Large Language Model
- Authors: Jiedong Zhuang, Lu Lu, Ming Dai, Rui Hu, Jian Chen, Qiang Liu, Haoji Hu
- Institution: Zhejiang University / Alibaba Group
- Year: 2026, AAAI 2026
- URL: https://arxiv.org/abs/2602.01901
- Architecture: Lazy Attention + layer-shared Q Cache
- Contribution: 發現多個 decode layers 的 visual attention patterns 高度相似，跨層重用 attention/query information
- Reported result: >35% KV-cache reduction、~1.5× throughput improvement、約 1% performance loss
- Limitation: layer-level approximate acceleration，同樣不保證 historical bitwise equivalence。
- 改變了什麼：證明 multimodal cache identity 還需要 stage/layer dimension。

---

# 已確認事實 / 工程推論 / 未驗證假說

## 已確認事實
- Qwen2.5-VL vision stack 會根據 grid、patch、window/full-attention 與 3D position metadata 建立視覺 representation。
- Qwen2.5-VL processor 可透過 pixel-budget 設定改變 visual token 數量。
- VLCache 同時利用 encoder cache 與 KV cache reuse。
- VLA-Cache 跨 frame 重用相對穩定 visual tokens。
- Q Cache 跨 decoder layers reuse attention/query computation。

## 工程推論
- Production multimodal event store 應同時保存 raw artifact ID 與 transform lineage。
- Strict replay 的 canonical source 應優先使用「歷史已記錄 artifact」，而不是用目前 encoder 重新生成再假定相同。
- `raw_hash + encoder_revision` 還不夠，processor / sampling / token-layout metadata 也應納入。
- Artifact provenance 最自然的資料結構是 DAG，而非單一 flat record。

## 尚未驗證假說
- 是否能建立跨 VLM 的 Universal Visual Artifact ABI，讓 encoder-output level artifacts 在不同 runtime 間 portable。
- 是否可透過 canonical float quantization / hashing 建立跨 GPU backend 的 numerical feature identity。
- Closed multimodal APIs 是否未來會公開 model/vision-processor revision，讓 external event sourcing 可以做更強 replay verification。

---

# Unknown / Open Questions 1–3

1. **Replay 最合理的 canonical boundary 到底是哪一層？**
   - raw media 最 portable，visual tokens 最 faithful to historical reasoning，但 storage / coupling 最大。

2. **GPU numerical nondeterminism 怎麼定義 artifact equality？**
   - bitwise hash 太嚴格；cosine / tolerance 又可能掩蓋真正 inference drift。

3. **Multimodal stream 如何避免 artifact explosion？**
   - 30 FPS video 若每一層都永久保存 raw/frame/tensor/feature/token，storage 會爆炸，需要 keyframe / content-addressed dedup / tiered retention policy。

---

# Knowledge Graph 新增 Node / Edge

## New Nodes

```text
Multimodal Artifact
Raw Media Artifact
Decoded Frame Artifact
Preprocessed Tensor Artifact
Encoder Feature Artifact
Projected Visual Token Artifact
Fused Context Artifact
Artifact Hash Ladder
Transformation Provenance
Processor Revision
Encoder Revision
Projector Revision
Token Layout
Temporal Sampling Policy
Spatial Preprocessing Policy
Replay Boundary
Media Replay
Tensor Replay
Encoder Replay
Outcome Replay
Numerical Replay
Semantic Replay
Approximate Visual Equivalence
Visual Cache Artifact
Visual Cache Invalidation
```

## New Edges

```text
Raw Media
→ transformed_into
Preprocessed Tensor

Preprocessed Tensor
→ encoded_by
Vision Encoder Revision

Encoder Feature
→ projected_into
Visual Token Artifact

Visual Token Artifact
→ packed_into
Multimodal Context

Artifact
→ derived_from
Parent Artifact

Transform
→ produces
Artifact

Processor Revision
→ affects
Visual Token Identity

FPS / Frame Sampling
→ affects
Temporal Token Identity

Encoder Revision
→ affects
Feature Identity

Cache Hit
≠
Historical Replay Match

Approximate Visual Equivalence
≠
Exact Artifact Identity

Raw Media Identity
≠
Model Input Identity

Replay Divergence
→ localized_by
Artifact Hash Ladder
```

---

# 與歷史研究比較

前一輪解決：

```text
LLM / Tool / Clock / Random
→ nondeterministic boundary
→ record outcome
→ deterministic event replay
```

本輪補上：

```text
Raw Multimodal Evidence
→ preprocessing
→ encoder
→ projector
→ visual tokens
→ fused context
```

這些不是一個單一 boundary，而是一條 artifact transformation chain。

因此完整架構開始變成：

```text
Camera/Image/Voice/Video
↓
Raw Artifact
↓
Preprocessing Provenance
↓
Encoder Artifact
↓
Multimodal Tokens
↓
Context Compiler
↓
LLM Nondeterministic Outcome
↓
Agent Event Store
↓
Plan
↓
Tool / MCP
↓
External Effect
```

這把「Multimodal AI」真正接回前面已研究的 Event-Sourced Agent Runtime。

---

# 下一輪研究

下一輪最值得進入：

## **Multimodal Storage Hierarchy × Content-Addressed Artifact Store × Deduplication × Retention / Compaction × GPU Feature Cache**

核心問題：

```text
30 FPS Camera
× hours
× raw frame
× tensor
× encoder feature
× visual token
```

不可能全部永久保存。

下一輪應拆：

```text
Artifact
↓
Content Hash
↓
Dedup
↓
Retention Classifier
├ Keep Raw
├ Keep Keyframe
├ Keep Feature
├ Keep Token
├ Keep Metadata Only
└ Evict
↓
Storage Tier
├ GPU
├ CPU RAM
├ NVMe
├ Object Storage
└ Archive
↓
Replay Requirement
↓
Materialization
```

並比較：
- content-addressed stores / Merkle DAG
- CAS dedup
- video keyframe/chunking
- feature cache
- multimodal KV cache
- VLCache / VLA-Cache cache hierarchy
- vLLM / SGLang multimodal caching
- object-storage + GPU-tier promotion

---

# 本輪結束回答

- **缺哪一層：** Multimodal Artifact Store 的 storage hierarchy / retention / dedup policy。
- **哪個節點最淺：** `Numerical Replay` 與跨 GPU backend 的 feature identity。
- **哪個概念仍只是名詞：** Unified Multimodal Artifact ABI / Cross-Framework Visual Token ABI。
- **哪個系統最值得讀原始碼：** VLCache 的 `nanovllm/engine/`, `nanovllm/models/`, `nanovllm/layers/`, `test_partial_recompute.py`；其次 Hugging Face Qwen2.5-VL processor/model implementation。
- **哪篇論文需追引用：** VLCache，因為它直接把 encoder cache + KV cache 連成 multimodal inference cache hierarchy；其次 VLA-Cache。
- **哪個概念最適合視覺模擬：** **Multimodal Replay Microscope**。
- **哪個 Agent 架構最值得實作：** **Event-Sourced Multimodal Agent + Content-Addressed Artifact DAG + Versioned Encoder Boundary + Replay/Fork Verifier**。

---

# 核心結論

> **多模態 Agent 的可重播性不能只記「使用者傳了哪張圖片」與「模型回答什麼」。在 Raw Media 與 LLM 之間，還存在 Decode → Resize/Sample → Tensor → Vision Encoder → Merger/Projector → Visual Tokens → Multimodal Context 的完整 transformation chain。任何 processor、fps、grid、encoder、projector 或 token layout 改變，都可能讓相同原始媒體導向不同 model state。因此真正的 Multimodal Event Sourcing 應該把每一層都視為可版本化、可雜湊、可追 provenance 的 Artifact DAG；歷史 replay 重放的是當時的 artifact，重新用新 encoder 看同一份 raw media 則必須被視為 recomputation experiment 或 fork，而不是假裝仍是同一段歷史。**
