# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 22:56（Asia/Taipei）**  
**主題：Multimodal Cross-Module Circuits × Encoder→Projector→LLM Causal Paths × Connector Bottlenecks × Cross-Architecture Causal Bridges**

---

## 本小時新發現

本輪承接上一輪 `Interaction-Aware Circuit Discovery × Group Attribution × Sparse Causal Subgraphs`，不再重複單一 Transformer 內部 head / feature / path 的 circuit extraction，而是處理更接近「多模態 AI 到底怎麼運作」的缺口：

> 一個 image region 到底如何穿過 vision encoder、connector/projector/resampler、LLM，再影響 reasoning token、claim 或 Agent action？

前一輪已建立：

```text
Attribution Graph
≠ Certified Causal Circuit

Low Individual Effect
≠ Low Group Importance
```

本輪新增的是跨模組版本：

```text
Image / Video Region
↓
Vision Encoder Patch Features
↓
Connector / Projector / Resampler
↓
LLM-visible Visual Tokens
↓
Cross-modal Aggregation Layers
↓
Reasoning / Generation
↓
Claim / Tool Call / Agent Action
```

### 新論文 / 新架構 / 新 GitHub

1. **FCCT — Fine-grained Cross-modal Causal Tracing (AAAI 2026)**：Qiming Li et al. 系統性追蹤 visual/text tokens、MHSA、FFN、hidden states 與所有 decoder layers；報告 middle-layer last-token MHSA 對 cross-modal aggregation 關鍵，而 FFN 呈現 visual-object representation 的階段性 storage/transfer。這使「視覺資訊進入 LLM 後在哪裡被聚合」開始有可介入的機制證據。
2. **Dual-Pathway Circuits of Object Hallucination (2026)**：跨五種 VLM 架構用 activation patching 找 visual grounding pathway 與 hallucination pathway；macro-level 深度分布一致，但 micro-level effect profiles 跨架構相關性低，說明「共同 blueprint ≠ 相同 wiring」。
3. **V-SEAM (2025)**：把 visual intervention 從粗糙 pixel noise 往 object / attribute / relation semantic edit 推進，並搭配 attention-head modulation；提醒 cross-modal circuit 驗證最好使用語義介入，而不是只用 out-of-distribution occlusion。
4. **LLaVA connector 原始碼**：`vision_tower → mm_projector → LLM input embeddings`，projector 可是 linear 或 `mlpNx_gelu`；視覺 features 在 projector 後直接插入文字 embeddings 序列，因此 connector 是可明確切割的 causal bridge。
5. **BLIP-2 / LAVIS Q-Former 原始碼**：frozen visual encoder 輸出被 learned query tokens 透過 cross-attention讀取，再經 `opt_proj` 投影成 frozen LLM 的 prefix embeddings；這不是單純 dimension mapping，而是「query-conditioned information bottleneck」。
6. **OpenFlamingo 原始碼**：vision encoder features 先經 `PerceiverResampler`，再被 condition 到 language decoder 的 gated cross-attention layers；視覺訊號不是一次性 prefix 注入，而是在多個 decoder depth 重複提供 cross-modal conditioning。

主要來源：
- FCCT / AAAI 2026: https://ojs.aaai.org/index.php/AAAI/article/view/40431
- Dual-Pathway Circuits: https://arxiv.org/abs/2605.13156
- V-SEAM: https://arxiv.org/abs/2509.14837
- LLaVA paper: https://arxiv.org/abs/2304.08485
- BLIP-2: https://arxiv.org/abs/2301.12597
- Flamingo: https://arxiv.org/abs/2204.14198
- LLaVA code: https://github.com/haotian-liu/LLaVA
- LAVIS / BLIP-2 code: https://github.com/salesforce/LAVIS
- OpenFlamingo code: https://github.com/mlfoundations/open_flamingo

---

# 本小時最重要 5 個發現

## 1. `Vision Encoder → LLM` 不是單一統一介面，而至少有三種不同的 causal bridge topology

### A. Prefix-projector topology（LLaVA 類）

```text
Image
↓
CLIP / ViT patches
↓
selected hidden layer
↓
Linear / MLP projector
↓
LLM embedding dimension
↓
insert into token embedding sequence
↓
causal decoder self-attention
```

LLaVA 的 `build_vision_projector()` 原始碼支援：

```text
linear:
  Linear(mm_hidden_size → hidden_size)

mlpNx_gelu:
  Linear(mm_hidden_size → hidden_size)
  → GELU
  → Linear(hidden_size → hidden_size)
  → ...
```

而 `encode_images()` 的實際 forward 是：

```text
vision_tower(images)
→ mm_projector(image_features)
```

接著 `prepare_inputs_labels_for_multimodal()` 直接把 projected image features 插入 text embeddings。

這代表 connector 的角色主要是：

```text
feature-space alignment
+
possible nonlinear remapping
```

但它不主動做 query-dependent visual selection。

### B. Query bottleneck topology（BLIP-2 類）

```text
Image
↓
Frozen ViT
↓
Patch features
↓
Learned Query Tokens
↘ cross-attention ↙
Q-Former
↓
Fixed number of query outputs
↓
Linear projection
↓
Frozen LLM prefix
```

LAVIS `blip2_opt.py` 明確執行：

```text
image_embeds = visual_encoder(image)
query_output = Qformer.bert(
    query_embeds=query_tokens,
    encoder_hidden_states=image_embeds
)
inputs_opt = opt_proj(query_output.last_hidden_state)
inputs_embeds = concat(inputs_opt, text_embeddings)
```

這裡 Q-Former 不只是轉換維度，而是在大量 vision tokens 與少量 query tokens 間建立 learned information bottleneck。

### C. Recurrent cross-attention topology（Flamingo 類）

```text
Image / Video
↓
Vision Encoder
↓
Perceiver Resampler
↓
Fixed visual latents
↓
condition decoder layers
↓
Gated Cross-Attention @ multiple depths
↓
Language hidden states
```

OpenFlamingo 的 `_encode_vision_x()` 將 vision features 經 `PerceiverResampler`，再對 language decoder layers 執行 `condition_vis_x(vision_x)`；模型訓練時主要解凍 perceiver 與 gated cross-attention layers，而 vision encoder 與大部分 LM 可保持 frozen。

### 為什麼重要

因此：

```text
Same Input Image
+
Same Base LLM
≠
Same Causal Access Pattern
```

在 LLaVA，vision information 先被投影後成為「類 token」並進入 self-attention；在 BLIP-2，Q-Former 先決定哪些視覺資訊穿過 bottleneck；在 Flamingo，visual latents 可以在多個 decoder depth 重新被讀取。

新增 Knowledge Graph edge：

```text
Connector Architecture
→ Changes Cross-Modal Causal Path Topology
```

---

## 2. Connector 不是「只負責對齊 dimension」；它可能同時是資訊瓶頸、選擇器與 causal cut

對最簡單 projector：

```text
Z_v ∈ R^(N×d_v)
W_p ∈ R^(d_v×d_l)

Z_l = Z_v W_p
```

如果加 MLP：

```text
Z_l = W_2 GELU(W_1 Z_v)
```

此時 projector 已可：

- rotate feature basis
- suppress / amplify directions
- create nonlinear feature interactions
- entangle visual concepts before LLM sees them

Q-Former 更進一步：

```text
Q learned
K,V = image features

A = softmax(QKᵀ / √d)
H_q = A V
```

這會把 N 個 image patches 壓成固定數量 query states，因此：

```text
Visual Information Missing In LLM
```

不一定代表：

```text
LLM Failed To Use Vision
```

也可能是：

```text
Encoder did not encode it
OR
Connector did not transmit it
OR
Resampler compressed it away
```

Hermes 因此新增：

```text
CrossModalLossLocalization
├ ENCODER_LOSS
├ CONNECTOR_LOSS
├ RESAMPLER_LOSS
├ LLM_ACCESS_FAILURE
├ LLM_REASONING_FAILURE
└ DECODING_FAILURE
```

這是本輪最重要的 debugging 分層之一。

---

## 3. 「LLM 中看到 visual circuit」不等於證明 upstream visual source 仍被忠實保存

FCCT 在 decoder 內找到 middle-layer MHSA / FFN 的重要 visual-object representation route；Dual-Pathway Circuit Analysis 也在不同 VLM 中找到 grounding/hallucination pathways。

但如果只從 LLM hidden states 往下做 causal tracing，會遇到一個盲點：

```text
Original image region
↓ ???
projected visual token
↓
LLM circuit
↓
answer
```

LLM circuit 的存在只能證明：

```text
some visual-conditioned representation
influenced output
```

不能自動證明：

```text
specific physical image region
was faithfully transmitted through encoder + connector
```

因此 Hermes 必須把前幾輪建立的 `PhysicalSourceAlignment` 和本輪 circuit 接起來：

```text
ImageRegionRef
↓
VisionPatchRef
↓
EncoderFeatureRef
↓
ConnectorOutputRef
↓
LLMVisualTokenRef
↓
LLMFeatureCircuit
↓
OutputClaimRef
```

並記錄每一跳的 intervention evidence。

新增：

```text
CrossModuleCausalEdge
├ source_module
├ source_ref
├ target_module
├ target_ref
├ intervention_type
├ effect_size
├ direction
├ interaction_group
├ alignment_uncertainty
└ evidence_level
```

核心 edge：

```text
Decoder Visual Influence
≠ Source-Region Provenance
```

---

## 4. 最可靠的跨模組實驗不是只 patch 一層，而是做「階梯式 intervention localization」

若模型看錯「紅色杯子」，不要直接猜 LLM hallucination。

Hermes 應按模組逐層做 intervention：

```text
I0 Pixel / semantic edit
↓
I1 Vision patch feature patch
↓
I2 Connector input patch
↓
I3 Connector output patch
↓
I4 LLM visual-token patch
↓
I5 Mid-layer hidden/MHSA/FFN patch
↓
I6 Reasoning-span intervention
↓
I7 Output / Agent action
```

定義：

```text
Δ_k = Outcome(do(I_k = clean)) - Outcome(corrupt)
```

然後比較：

```text
encoder recovery
connector recovery
LLM entry recovery
mid-layer recovery
```

例如：

```text
Patch image region        → no recovery
Encoder feature restore   → large recovery
Connector output restore  → large recovery
LLM mid-layer restore     → large recovery
```

可能表示錯誤最早已在 vision encoder encoding stage 發生。

反之：

```text
Encoder feature restore   → little effect
Connector output restore  → large effect
```

則 connector 是更強候選 causal bottleneck。

注意：這仍受 mediator interaction、OOD intervention、clean/corrupt construction 影響；不能把單次 largest Δ 當唯一 root cause。

新增：

```text
CrossModuleInterventionLadder
```

以及：

```text
Earliest Recoverable Layer
≠ Unique Root Cause
```

---

## 5. 跨架構相同的「grounding blueprint」不代表可共享相同 circuit coordinates

2026 Dual-Pathway Circuits 的結果很重要：跨五種架構，hallucination pathway 傾向較早、visual grounding pathway傾向 mid-to-late layers；但不同模型 micro-level effect profiles 的相關性低。

這支持：

```text
Architecture-normalized mechanism class
```

而不是：

```text
Layer 17 / Head 9
is universally the visual grounding circuit
```

Hermes 應建立兩級知識圖：

```text
Level A: Architecture-Invariant Functional Role
├ visual extraction
├ visual compression
├ modality bridge
├ cross-modal aggregation
├ grounding maintenance
├ linguistic prior injection
└ answer formation

Level B: Model-Specific Coordinates
├ module path
├ layer
├ head
├ feature
├ token span
└ connector latent
```

因此新增：

```text
FunctionalCircuitRole
ModelSpecificCircuitInstance
CrossArchitectureCircuitMapping
```

核心 edge：

```text
Shared Functional Role
≠ Shared Internal Coordinates
```

---

# Architecture Breakdown

本輪將 Multimodal Agent 的 model path 明確拆成：

```text
Camera / Image / Video
↓
Preprocessor
├ resize
├ crop
├ frame sampling
└ normalization
↓
Vision Encoder
├ patch embedding
├ self-attention
└ visual hidden states
↓
Connector Topology
├ Linear / MLP Projector
├ Q-Former
├ Perceiver Resampler
├ Cross-Attention Adapter
└ Unified Native Multimodal Tokens
↓
LLM Entry Interface
├ Prefix Embeddings
├ Interleaved Visual Tokens
├ Repeated Cross-Attention
└ Hybrid
↓
LLM Cross-Modal Aggregation
├ early layers
├ middle layers
├ late layers
├ MHSA
└ FFN / feature circuits
↓
Reasoning / Planning
↓
Claim / Tool Selection / Arguments
↓
Agent Runtime / Action
```

Hermes 建議的新 runtime schema：

```text
CrossModalTrace
├ source_artifact_id
├ preprocessing_trace[]
├ encoder_trace
├ connector_trace
├ llm_entry_trace
├ decoder_circuit_trace
├ output_trace
└ intervention_evidence[]
```

其中：

```text
ConnectorTrace
├ connector_type
├ input_shape
├ output_shape
├ token_count_before
├ token_count_after
├ compression_ratio
├ learned_queries
├ projector_version
├ source_to_latent_alignment
└ discarded_information_tests[]
```

---

# Bottom-Level Logic

## A. Linear / MLP projector

```text
X_v ∈ R^(N×d_v)

Linear:
X_l = X_v W + b

MLP:
X_l = W_2 σ(W_1 X_v + b_1) + b_2
```

關鍵：token count N 通常保持，但 representation basis 被重映射。

## B. Q-Former bottleneck

```text
Q ∈ R^(M×d)
X_v ∈ R^(N×d)
M << N

A = softmax(QW_Q (X_vW_K)^T / √d)
H = A (X_vW_V)
```

關鍵：

```text
N patches
→ M learned query states
```

所以 token-level provenance 必須允許 many-to-many，而不是假設 1 patch = 1 LLM token。

## C. Perceiver Resampler

概念上：

```text
Learned latents L
cross-attend to vision features X_v
↓
fixed-size latent set
```

它與 Q-Former 都做 compression，但 training objective、stack structure、是否含 text/query conditioning、後續注入方式不同。

## D. Gated cross-attention

概念：

```text
h_lang
+
gate · CrossAttn(h_lang, visual_latents)
```

與一次 prefix injection 不同；visual evidence 可以在多個 decoder depth 被重新讀取。

## E. Cross-module causal path score

不應只乘各段 attribution score；比較合理的是把它當作需被介入驗證的 path hypothesis：

```text
P:
region r
→ patch p
→ connector latent z
→ decoder feature f
→ claim c
```

先由 attribution / similarity 建候選，再用：

```text
patching
semantic edit
latent replacement
activation restoration
group intervention
```

逐段驗證。

---

# Visual Simulation Idea

## **Cross-Modal Causal Bridge Lab**

Hermes Console 畫面分成 5 個垂直模組：

```text
[IMAGE]
  ↓
[VISION ENCODER]
  ↓
[CONNECTOR]
  ↓
[LLM CIRCUIT]
  ↓
[ANSWER / ACTION]
```

使用者點一個 final claim：

```text
「桌上有一個紅色杯子」
```

左側圖片自動高亮候選 bbox，中央顯示不同 architecture mode：

```text
LLaVA MODE
bbox
→ patches #120-147
→ CLIP layer -2
→ MLP projector
→ visual tokens #18-45
→ LLM middle-layer MHSA
→ FFN feature group
→ token「紅色杯子」
```

切換成：

```text
BLIP-2 MODE
bbox
→ ViT patches
→ Q-Former query #3/#11/#24
→ opt_proj
→ prefix embeddings
→ LLM circuit
```

Flamingo：

```text
bbox
→ ViT features
→ Perceiver latent #8/#27
→ gated cross-attn layer 6/12/18
→ decoder feature
→ claim
```

使用者可以按：

```text
RESTORE REGION
RESTORE ENCODER FEATURE
RESTORE CONNECTOR LATENT
RESTORE LLM TOKEN
RESTORE MID-LAYER CIRCUIT
```

右側即時顯示：

| Intervention | Claim recovery | Tool/action recovery | Confidence |
|---|---:|---:|---|
| Image semantic edit | 0.81 | 0.74 | T3 |
| Encoder patch restore | 0.77 | 0.70 | T4 |
| Connector latent restore | 0.69 | 0.65 | T4 |
| LLM visual-token restore | 0.66 | 0.63 | T4 |
| Mid-layer group restore | 0.59 | 0.56 | T4 |

並產生：

```text
CrossModalCircuitCertificate
```

而不是只顯示 heatmap。

---

# Code / GitHub

## 1. LLaVA — `haotian-liu/LLaVA`

值得看的路徑：

```text
llava/model/
├ llava_arch.py
├ multimodal_encoder/
│  └ builder.py
└ multimodal_projector/
   └ builder.py
```

核心 code path：

```text
get_vision_tower()(images)
→ mm_projector(image_features)
→ prepare_inputs_labels_for_multimodal()
→ concatenate projected image features with text embeddings
```

`builder.py` 顯示 projector 可以是 linear、`mlpNx_gelu` 或 identity。

值得在 Hermes 補的 instrumentation hook：

```text
vision_tower output
mm_projector input/output
image-token insertion positions
per-token physical alignment
```

## 2. LAVIS / BLIP-2 — `salesforce/LAVIS`

值得看的路徑：

```text
lavis/models/blip2_models/
├ blip2.py
├ blip2_opt.py
├ blip2_qformer.py
└ Qformer.py
```

`blip2_opt.py` 核心：

```text
visual_encoder
→ query_tokens
→ Qformer.bert(query_embeds, encoder_hidden_states=image_embeds)
→ opt_proj
→ concat with OPT token embeddings
```

值得 instrumentation：

```text
query-to-patch attention
query latent intervention
query redundancy
query compression loss
opt_proj directions
```

## 3. OpenFlamingo — `mlfoundations/open_flamingo`

值得看的路徑：

```text
open_flamingo/src/
├ flamingo.py
├ helpers.py
└ flamingo_lm.py
```

`flamingo.py` 明確：

```text
vision_encoder
→ PerceiverResampler
→ condition_vis_x()
→ gated_cross_attn_layers
```

並且正常 Flamingo training 主要解凍：

```text
perceiver
gated_cross_attn_layers
(optional) LM input embeddings
```

這讓 connector/cross-attention 成為天然的 causal instrumentation boundary。

---

# Papers

## 1. Causal Tracing of Object Representations in Large Vision Language Models: Mechanistic Interpretability and Hallucination Mitigation

- **Authors**：Qiming Li, Zekai Ye, Xiaocheng Feng, Weihong Zhong, Weitao Ma, Xiachong Feng
- **Institution**：Harbin Institute of Technology；Peng Cheng Laboratory；University of Hong Kong（AAAI author metadata）
- **Year**：2026（AAAI-26）
- **URL**：https://ojs.aaai.org/index.php/AAAI/article/view/40431
- **Code**：本輪未驗證官方 code release
- **Dataset / benchmarks**：論文報告於 5 個常用 benchmark / 多個 LVLM 上驗證
- **Architecture**：Fine-grained Cross-modal Causal Tracing；掃 visual/text tokens、MHSA、FFN、hidden states、full decoder depth
- **Contribution**：指出 middle-layer last-token MHSA 是 cross-modal aggregation 的重要位置，FFN 呈階段性 representation storage/transfer；提出 IRI 強化 visual information flow
- **Limitations**：主要定位 decoder-side cross-modal information flow；不等價於 end-to-end source-region→encoder→connector→LLM 的完整 causal certificate
- **改變了什麼**：把「LVLM 哪一層有 vision」從 probing / attention visualization 推向 component-level causal tracing

## 2. Dual-Pathway Circuits of Object Hallucination in Vision-Language Models

- **Authors**：Jiaxin Liu, Ding Zhong, Yue Wang, Zhidong Yang, Zhaolu Kang, Guangyuan Dong, Qishi Zhan, Pengcheng Fang, Aofan Liu
- **Institution**：本輪未從一手頁面完整驗證 affiliations，故不臆測
- **Year**：2026
- **URL**：https://arxiv.org/abs/2605.13156
- **Code**：搜尋結果顯示有 code 索引，但本輪未把第三方索引當官方 release 證據
- **Dataset**：POPE-adversarial、AMBER；5 種不同 VLM 架構
- **Architecture**：activation patching → Visual Grounding Pathway / Hallucination Pathway → Conditional Pathway Analysis
- **Contribution**：跨架構找到 grounding 與 hallucination 的 macro-level functional organization，並揭示 pathway redundancy / polarity flip
- **Limitations**：micro-level wiring 跨模型差異仍大；不能把 normalized layer position 直接視為 universal circuit coordinate
- **改變了什麼**：從「單模型 hallucination neuron/head」推進到跨架構 functional pathway comparison

## 3. BLIP-2: Bootstrapping Language-Image Pre-training with Frozen Image Encoders and Large Language Models

- **Authors**：Junnan Li, Dongxu Li, Silvio Savarese, Steven Hoi
- **Institution**：Salesforce Research
- **Year**：2023
- **URL**：https://arxiv.org/abs/2301.12597
- **Code**：https://github.com/salesforce/LAVIS
- **Architecture**：Frozen vision encoder → Q-Former → frozen LLM
- **Contribution**：以 lightweight Querying Transformer 解 modality gap，兩階段 pretraining
- **Limitations**：fixed query bottleneck 也可能成為資訊遺失點；其 latent 不與 physical region 一一對應
- **改變了什麼**：證明不需 end-to-end 更新巨型 vision+LLM，即可透過 bottleneck bridge 建立強 multimodal model

## 4. Flamingo: a Visual Language Model for Few-Shot Learning

- **Authors**：Jean-Baptiste Alayrac et al.
- **Institution**：DeepMind
- **Year**：2022
- **URL**：https://arxiv.org/abs/2204.14198
- **Code**：官方原論文未以 OpenFlamingo 為官方 code；本輪工程參考使用 https://github.com/mlfoundations/open_flamingo
- **Architecture**：Vision encoder → Perceiver Resampler → gated cross-attention inserted into LM
- **Contribution**：支援 arbitrary interleaved image/text 與 few-shot multimodal prompting
- **Limitations**：cross-attention injection points 增加跨深度 causal paths，讓 attribution/provenance 比單次 prefix injection 更複雜
- **改變了什麼**：把 vision conditioning 從「一次輸入」改成「多層可重複讀取的外部視覺記憶」

## 5. Visual Instruction Tuning / LLaVA

- **Authors**：Haotian Liu, Chunyuan Li, Qingyang Wu, Yong Jae Lee
- **Institution**：University of Wisconsin–Madison / Microsoft Research（原工作主要作者 affiliations）
- **Year**：2023
- **URL**：https://arxiv.org/abs/2304.08485
- **Code**：https://github.com/haotian-liu/LLaVA
- **Architecture**：vision encoder → trainable projection → autoregressive LLM
- **Contribution**：將 vision features 直接映射進 LLM embedding space，再以 multimodal instruction tuning 建 general assistant
- **Limitations**：直接 prefix-like visual token interface 把大量 cross-modal mixing責任留給 LLM；projector 与 decoder 的 causal responsibility 需要分開測
- **改變了什麼**：建立今日大量 open-source MLLM 的簡潔 connector baseline

---

# Unknown / Open Questions 1–3

## 1. Connector 的「資訊保留率」如何定義才不只是 reconstruction metric？

一個 projector 可能無法還原完整 pixels，卻保留 task-relevant information；反之，能線性 probe 出 object label，也不代表下游 LLM實際使用。

需要：

```text
ConnectorInformationCertificate
=
source recoverability
+
behavioral recoverability
+
counterfactual transmission
+
claim/action effect
```

## 2. Q-Former / Perceiver latent 如何可靠映回 physical region？

cross-attention weight 可以做 alignment hint，但：

```text
High query→patch attention
≠ causal ownership of patch
```

需要 semantic edit + latent patch + downstream recovery calibration。

## 3. 跨架構 circuit 的共同單位到底是 layer depth、functional role，還是 information operation？

目前最有希望的是：

```text
functional operation
```

例如：

```text
visual compression
cross-modal aggregation
grounding maintenance
language-prior override
```

再映回每個 architecture-specific coordinate。

---

# 下一輪研究

下一輪應進入：

# **Multimodal Connector Information Bottleneck × Token Compression × Lost Evidence × Adaptive Visual Token Routing**

本輪已確認 connector topology 決定 cross-modal causal path；下一層要追：

```text
576 / 1024 vision patches
↓
project / query / resample / select
↓
32 / 64 / N visual latents
↓
哪些資訊被保留？
哪些資訊被丟掉？
哪些資訊只在某個 task/query 下重要？
```

應比較：

```text
Fixed MLP projector
Q-Former
Perceiver Resampler
Token pruning
Token merging
Top-down compression
Instruction-aware token selection
Dynamic visual token routing
```

並建立：

```text
VisualTokenSurvivalGraph
ConnectorInformationCertificate
EvidenceDropEvent
CompressionCausalTest
AdaptiveVisualRoutingPolicy
```

核心研究問題：

> 視覺 hallucination 到底有多少是在 LLM 裡產生，又有多少其實是「正確證據在 connector/token compression 階段已被丟掉」？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Cross-Modal Causal Bridge
Connector Topology
Prefix Projector
Query Bottleneck
Perceiver Resampler
Gated Cross-Attention Bridge
CrossModuleCausalEdge
CrossModuleInterventionLadder
CrossModalTrace
ConnectorTrace
CrossModalCircuitCertificate
CrossModalLossLocalization
Encoder Loss
Connector Loss
LLM Access Failure
PhysicalSourceToCircuitPath
FunctionalCircuitRole
ModelSpecificCircuitInstance
CrossArchitectureCircuitMapping
Visual Grounding Pathway
Hallucination Pathway
Connector Information Bottleneck
```

## Edges

```text
Connector Architecture
→ Changes Cross-Modal Causal Path Topology

Visual Information Missing In LLM
≠ LLM Failed To Use Vision

Decoder Visual Influence
≠ Source-Region Provenance

Query Bottleneck
→ Compresses Many Vision Patches Into Few Latents

Prefix Projector
→ Converts Vision Features Into LLM-Visible Embeddings

Gated Cross-Attention
→ Enables Repeated Visual Access Across Decoder Depth

Shared Functional Role
≠ Shared Internal Coordinates

Earliest Recoverable Layer
≠ Unique Root Cause

Cross-Module Patching
→ Localizes Candidate Information Loss

Connector Compression
→ Can Remove Evidence Before Reasoning Begins
```

---

# 本輪結束判定

- **缺哪一層**：`Connector Information Preservation + Visual Token Survival Layer`
- **哪個節點最淺**：`CrossModalCircuitCertificate`、`ConnectorInformationCertificate`、`CrossArchitectureCircuitMapping`、`PhysicalSourceToCircuitPath`
- **哪個概念仍只是名詞**：production 級 `End-to-End Multimodal Causal Provenance`；目前無法只靠 attention/patching 宣稱已完整證明
- **哪個系統值得讀原始碼**：下一輪優先深讀 LLaVA token merge / projector variants、LAVIS Q-Former attention、OpenFlamingo PerceiverResampler；並找現代 dynamic visual-token routing repo
- **哪篇論文需追引用**：FCCT（AAAI 2026）與 Dual-Pathway Circuits（2026）；前者適合追 decoder causal tracing，後者適合追跨架構 functional circuits
- **哪個概念最適合視覺模擬**：`Cross-Modal Causal Bridge Lab`
- **哪個 Agent 架構最值得實作**：不是單一 agent loop，而是 Hermes 的 `CrossModalTrace → Intervention Ladder → CrossModalCircuitCertificate`，之後再把 certificate 接到 Agent claim / tool-call provenance

---

# 對「AI 到底怎麼運作」新增的核心還原

```text
Camera / Image
↓
Pixels
↓
Patch Embeddings
↓
Vision Encoder
↓
Visual Hidden States
↓
Connector
├ MLP Projector
├ Q-Former
└ Perceiver Resampler
↓
LLM-visible Visual Representation
↓
Cross-modal Aggregation
↓
Sparse Feature / Attention Circuits
↓
Reasoning / Planning
↓
Claim / Tool Call
↓
Agent Action
```

真正重要的新認知是：

> **多模態 AI 的「看見」不是 image 直接進入 LLM。中間存在一個非常關鍵的 connector / bottleneck 層，它決定哪些 visual features 能以什麼形式、多少 token、什麼時機被語言模型讀取。若不把 encoder、connector 與 decoder 分開做 causal intervention，我們無法知道錯誤究竟是「沒有看見」、「看見但沒有傳過去」、「傳過去但 LLM 沒使用」，還是「LLM 使用後仍被語言先驗帶偏」。這一層是把 Camera/Image → Encoder → Tokens → Fusion → Reasoning → Agent → Action 真正還原成可驗證因果路徑的關鍵。**
