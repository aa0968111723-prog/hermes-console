# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 08:54（Asia/Taipei）**  
**本輪主題：Intermediate Vision Layers × DINOv3 Gram Anchoring × Multi-Encoder Fusion × Evidence Routing × Stateful Visual Encoder**

> 本輪接續前一輪「Vision Feature Semantics × CLIP/SigLIP × DINOv2/DINOv3 × Dense Features」。避免重複 CLIP/SigLIP 基礎與 Pixel→Patch 流程，專門回答：**視覺證據到底存在 encoder 的哪一層？長訓練如何破壞 patch 關係？不同 encoder 如何互補？Agent 是否應依任務動態選 layer / encoder / visual state？**

---

## 本小時新發現

### 新論文 / 新架構

1. **Rethinking Visual Layer Selection in Multimodal LLMs**（Chen et al., 2025, arXiv:2504.21447）
   - 系統化比較 shallow / middle / deep vision layers。
   - 實驗結果：deep layers 對 OCR 重要；shallow / middle layers 對 counting、positioning、object localization 等 reasoning 更強；跨 stage 輕量 fusion 在 10 個資料集中的 9 個取得提升。
   - 改變：把「VLM 取 final vision layer」從默認工程選擇提升為顯式 architecture decision。

2. **DINOv3**（Siméoni et al., Meta FAIR, 2025, arXiv:2508.10104）
   - 關鍵新增：Gram anchoring，用 patch-patch relational structure 抑制長訓練造成的 dense feature degradation。
   - 官方 training pipeline 明確拆成 pretraining → Gram anchoring → high-resolution adaptation。

3. **CoME-VL: Scaling Complementary Multi-Encoder Vision-Language Learning**（Deria et al., 2026, arXiv:2604.03231）
   - SigLIP2 + DINOv3 雙 encoder。
   - Entropy-guided multi-layer selection。
   - Orthogonality-constrained projection 減少 redundancy。
   - RoPE-enhanced cross-attention 對齊 heterogeneous token grids。
   - 論文報告平均 +4.9% visual understanding、+5.4% grounding（限該實驗設定）。

4. **Stateful Visual Encoders for Vision-Language Models**（Wang et al., 2026, arXiv:2606.04433）
   - 把每張圖片獨立 encode 的 stateless assumption 改成：current visual representation 可依賴 previous visual features。
   - 對 multi-image / multi-turn / visual trajectory Agent 很重要，因為微小變化可能在 stateless encoder 內就先被壓掉。

5. **GramLoop: Training-Free Gram-Gated Replay for Robust Dense Prediction**（Chen et al., 2026, arXiv:2608.29113）
   - 把 DINOv3 的 Gram consistency 概念從 training regularizer 延伸到 inference-time gating。
   - 這是一個新方向：**feature relational structure 可以成為 runtime quality guardrail**，而不只是一個 training loss。

---

# 本小時最重要 5 個發現

## 1. Vision Encoder 的「哪一層」本身就是 Evidence Router

### 已確認事實 / 論文結果

Visual encoder layer 並非只有「越深越語意」這麼簡單。

實際更接近：

```text
Image
↓
Patch Embedding
↓
Layer 1   local texture / boundaries / fine structure
↓
Layer 6   parts / relations / local geometry
↓
Layer 12  object / semantic abstraction
↓
Layer 18  language-aligned / task-biased semantics
↓
Final
```

但不同 task 需要不同 evidence：

```text
OCR
→ deeper semantic / text-aligned features often useful

Counting
→ shallow + middle spatial detail

Object Localization
→ shallow/middle dense geometry

High-level scene understanding
→ deep semantic features
```

因此 VLM pipeline 不應只寫：

```text
Vision Encoder
→ Final Hidden State
→ Projector
```

更合理是：

```text
Vision Encoder
→ Layer Bank
   ├ L4
   ├ L8
   ├ L12
   ├ L16
   └ L24
→ Layer Selector / Mixer
→ Projector
```

### 為什麼重要

對 Agent 而言，這直接影響：
- GUI click grounding
- document OCR
- map / diagram reasoning
- counting
- robot spatial action
- before/after comparison

如果 evidence 在中層存在、final layer 已被抽象掉，後面的 LLM reasoning 無法憑空重建。

### 限制

「某層對某 task 最好」高度依賴 encoder、pretraining objective、resolution、VLM projector 與 downstream finetuning；不能把單一 CLIP-ViT 結論直接泛化到所有 VLM。

---

## 2. DINOv3 Gram Anchoring 保護的不是單個 feature，而是 patch-to-patch 關係

### Bottom-level mechanism

DINOv3 官方原始碼的 GramLoss 實際執行：

```text
Student patch features
S ∈ R^(N×D)

Teacher patch features
T ∈ R^(N×D)

↓ L2 normalize

G_student = S Sᵀ
G_teacher = T Tᵀ

↓
MSE(G_student, G_teacher)
```

即：

```text
Gram Matrix[i,j]
≈ similarity(patch_i, patch_j)
```

它保護的不是：

```text
patch_i feature 必須等於 teacher patch_i
```

而是：

```text
patch_i 與 patch_j 的相對關係
應維持與 anchor teacher 類似
```

因此模型仍有自由更新 absolute representation，但不應任意破壞 spatial/dense relational geometry。

### 為什麼重要

這說明 dense feature quality 可以退化，即使 global metrics 仍在改善。

```text
Global Representation ↑
while
Patch Relational Structure ↓
```

是一個真實 training failure mode。

### 工程實作

官方 code 中：
- `dinov3/loss/gram_loss.py`
- `dinov3/train/ssl_meta_arch.py`
- `dinov3/configs/train/dinov3_vit7b16_gram_anchor.yaml`

都值得持續追。

---

## 3. Multi-Encoder Fusion 的真正問題不是「多接一個 encoder」，而是 Complementarity vs Redundancy

單純做：

```text
SigLIP tokens
+
DINO tokens
↓
concat
↓
LLM
```

會帶來：
- token explosion
- duplicated semantics
- mismatched hidden spaces
- mismatched spatial grids
- higher prefill/KV cost

CoME-VL 代表一個更完整的架構：

```text
Image
├───────────────┐
↓               ↓
SigLIP2         DINOv3
↓               ↓
Multi-layer     Multi-layer
features        features
↓               ↓
Entropy-guided layer selection
↓
Orthogonality-constrained projection
↓
RoPE-enhanced cross-attention
↓
Compact fused visual tokens
↓
LLM
```

這裡有三個不同問題：

```text
Selection
= 哪些 layer 保留？

Decorrelation
= 如何避免兩個 encoder 重複提供同樣 evidence？

Alignment
= 不同 patch grid / coordinate system 如何對齊？
```

### 為什麼重要

這讓「最佳 vision encoder」問題轉成：

```text
這個 task 需要哪些 complementary evidence sources？
```

而不是：

```text
哪個單一 encoder benchmark 最高？
```

---

## 4. Visual Evidence Routing 應同時跨 Encoder × Layer × Resolution × Time

前幾輪已建立：

```text
Task
→ Resolution Policy
→ Visual Compression Budget
```

本輪加入後應升級成：

```text
Agent Task
↓
Evidence Requirement
├ Semantic?
├ OCR?
├ Spatial?
├ Boundary?
├ Motion / change?
├ History dependent?
└ Fine-grained object state?
↓
Visual Evidence Router
├ Encoder Select
├ Layer Select
├ Resolution Select
├ Temporal State Select
└ Compression Select
↓
Evidence Bundle
↓
LLM Context
```

例如：

```text
「這是什麼網站？」
→ SigLIP2 deep layer
→ moderate resolution

「點右下角 Submit」
→ DINOv3 middle layer
→ high spatial resolution

「這一幀比上一幀哪裡改了？」
→ Stateful visual path
→ previous visual state + current dense layer
```

這目前是 **Hermes 工程推論**，不是既有標準架構。

---

## 5. Stateful Visual Encoder 把 Agent Memory 往 Vision Backbone 前移

傳統 VLM：

```text
Frame t-1
→ Vision Encoder
→ tokens ┐
         │
Frame t
→ Vision Encoder
→ tokens ├→ LLM compares
         │
Frame t+1
→ Vision Encoder
→ tokens ┘
```

Vision encoder 本身完全 stateless。

Stateful Visual Encoder：

```text
Frame t-1
↓
Visual State Z(t-1)
      │
      ▼
Frame t → Vision Encoder conditioned on Z(t-1)
                    ↓
                 Z(t)
                    ↓
                   LLM
```

這是非常重要的新 architecture edge：

```text
Agent Memory
不一定只存在 LLM context / external memory

它也可能存在
Vision Encoder State
```

### 對 Agent 的意義

Browser / Computer / Robot Agent 常見任務不是「看單張圖」，而是：

```text
Observe
↓
Act
↓
Observe changed screen
↓
Compare
↓
Act
```

若每幀都被 stateless encoder 壓成高階語意，微小 UI change、button state、object displacement 可能在進 LLM 前已消失。

---

# Architecture Breakdown

## Evidence-Routed Multimodal Agent Architecture

```text
Camera / Screen / Image Stream
↓
Visual Observation Manager
├ current frame
├ previous frame
├ ROI
├ task goal
└ visual history
↓
Evidence Requirement Classifier
├ GLOBAL_SEMANTIC
├ OCR
├ SPATIAL
├ DENSE_BOUNDARY
├ CHANGE_DETECTION
└ TEMPORAL_STATE
↓
Visual Evidence Router
│
├ Encoder Route
│  ├ SigLIP2
│  ├ DINOv3
│  └ Stateful Encoder
│
├ Layer Route
│  ├ shallow
│  ├ middle
│  └ deep
│
├ Resolution Route
│  ├ low
│  ├ native
│  └ ROI high-res
│
└ Compression Route
   ├ pooling
   ├ resampler
   └ no compression
↓
Feature Bank
├ semantic features
├ dense patch features
├ spatial features
└ temporal-delta features
↓
Complementarity Filter
├ entropy
├ redundancy score
└ orthogonality / decorrelation
↓
Spatial Alignment
├ coordinates
├ RoPE
└ cross-attention
↓
Compact Evidence Tokens
↓
Multimodal Context Compiler
↓
LLM
↓
Reasoning / Planning
↓
Action
```

---

# Bottom-Level Logic

## A. Intermediate Layer Capture

```text
x0 = patch embeddings

for layer l:
    x_l = TransformerBlock_l(x_{l-1})

    if l in evidence_layers:
        FeatureBank[l] = x_l
```

不再只有：

```text
return x_L
```

而是：

```text
return {
  L4,
  L8,
  L16,
  L24
}
```

## B. Layer Utility

可建立 task-conditioned utility：

```text
U(layer, task)
=
α SemanticScore
+ β SpatialScore
+ γ OCRScore
+ δ BoundaryScore
- λ TokenCost
```

這是 Hermes 的 **尚未驗證建模假說**。

## C. Gram Anchoring

```text
S = normalize(student_patch_features)
T = normalize(anchor_teacher_patch_features)

G_s = S @ S.T
G_t = T @ T.T

L_gram = MSE(G_s, G_t)
```

因此 anchor 對象是：

```text
pairwise relation matrix
```

不是直接 feature cloning。

## D. Multi-Encoder Redundancy

若兩 encoder feature 太相似：

```text
F_A ≈ F_B
```

直接 concat 只增加成本。

理想 router 應估計：

```text
Complementary Utility
≈ New Evidence - Redundant Evidence - Compute Cost
```

---

# Visual Simulation Idea

## Vision Evidence Router Lab

使用者上傳一張 GUI / document / street scene，並輸入任務。

### Panel A — Layer X-Ray

```text
Vision Encoder
L2  [heatmap]
L6  [heatmap]
L12 [heatmap]
L18 [heatmap]
L24 [heatmap]
```

切換 task：

```text
Scene Classification
OCR
Counting
Localization
GUI Click
```

顯示每層：
- evidence score
- spatial precision
- OCR recoverability
- semantic alignment
- token cost

### Panel B — Gram Geometry

顯示 patch similarity matrix：

```text
Before long training
G_anchor

After long training
G_student

Difference
|G_student - G_anchor|
```

開啟 Gram Anchoring 後動畫觀察 relational structure 被拉回。

### Panel C — Multi-Encoder Fusion

```text
SigLIP2
[semantic map]

DINOv3
[dense map]

Overlap
[redundancy]

Fusion
[retained evidence]
```

即時顯示：

```text
Semantic Gain
Grounding Gain
Redundancy
Visual Token Count
Prefill Cost
KV Footprint
```

### Panel D — Stateful Vision

```text
Frame t-1
↓
Visual State
↓
Frame t
↓
Delta-enhanced features
```

讓使用者拖動一個 UI button / object 2~10 pixels，觀察 stateless 與 stateful encoder 是否仍保留變化。

---

# Code / GitHub

## facebookresearch/dinov3

值得看的核心路徑：

```text
dinov3/
├ loss/
│  ├ gram_loss.py
│  ├ ibot_patch_loss.py
│  ├ dino_clstoken_loss.py
│  └ koleo_loss.py
├ train/
│  └ ssl_meta_arch.py
├ configs/train/
│  ├ dinov3_vit7b16_pretrain.yaml
│  ├ dinov3_vit7b16_gram_anchor.yaml
│  └ dinov3_vit7b16_high_res_adapt.yaml
└ eval/
```

核心機制：
- `GramLoss.forward()`
- student patch features / gram teacher patch features
- normalized patch similarity matrices
- scheduled gram loss weight
- optional teacher resize for patch-grid mismatch

## mbzuai-oryx/CoME-VL

值得追：

```text
CoME-VL/
├ olmo/
├ scripts/
├ config.yaml
├ launch_scripts/
└ tests/
```

官方 README 已確認三個核心模組：
1. Entropy-guided layer selection
2. Orthogonality-regularized multi-layer mixing
3. RoPE-enhanced cross-attention

下一輪原始碼追蹤應深入 `olmo/` 中實際 vision backbone / connector / fusion implementation，不只停在 README。

## Stateful Visual Encoders

Project / code：`StatefulVisualEncoders/StatefulVisualEncoders`。

下一輪應追：
- state injection point
- cross-attention location
- stop-gradient historical branch
- cache/state lifetime
- multi-frame growth control

---

# Papers

## 1. Rethinking Visual Layer Selection in Multimodal LLMs
- Authors: Haoran Chen, Junyan Lin, Xinhao Chen, Yue Fan, Xin Jin, Hui Su, Jianfeng Dong, Jinlan Fu, Xiaoyu Shen
- Year: 2025
- URL: https://arxiv.org/abs/2504.21447
- Architecture: LLaVA-style VLM + CLIP-ViT layer selection/fusion
- Dataset/Tasks: 10 datasets, OCR / counting / positioning / localization 等
- Contribution: 系統性證明不同 depth 對不同 downstream evidence 類型有差異
- Limitation: 結論依賴指定 encoder / VLM family；未必直接外推所有新型 encoder
- Changed: Final-layer-only → task-aware multi-layer selection

## 2. DINOv3
- Authors: Oriane Siméoni et al.
- Institution: Meta FAIR
- Year: 2025
- URL: https://arxiv.org/abs/2508.10104
- Code: https://github.com/facebookresearch/dinov3
- Architecture: large-scale self-supervised ViT/ConvNeXt family
- Contribution: scaling + Gram anchoring + high-resolution adaptation + distillation/text alignment
- Limitation: 主 7B 訓練資料包含非公開大型資料集；完整訓練成本極高
- Changed: dense-feature degradation 被正式當作 large-scale SSL failure mode 處理

## 3. CoME-VL
- Authors: Ankan Deria, Komal Kumar, Xilin He, Imran Razzak, Hisham Cholakkal, Fahad Shahbaz Khan, Salman Khan
- Institution: MBZUAI 等
- Year: 2026
- URL: https://arxiv.org/abs/2604.03231
- Code: https://github.com/mbzuai-oryx/CoME-VL
- Dataset: PixMo / RefCOCO 等
- Architecture: SigLIP2 + DINOv3 + entropy-guided multi-layer aggregation + orthogonal mixing + RoPE cross-attention
- Contribution: 系統化融合 contrastive + self-supervised evidence
- Limitations: dual encoder 增加 vision compute / memory；收益受 fusion budget 與 downstream task 影響
- Changed: single-best-encoder → complementary evidence fusion

## 4. Stateful Visual Encoders for Vision-Language Models
- Authors: Zirui Wang, Junwei Yu, Adam Yala, David M. Chan, Joseph E. Gonzalez, Trevor Darrell
- Year: 2026
- URL: https://arxiv.org/abs/2606.04433
- Code: https://github.com/StatefulVisualEncoders/StatefulVisualEncoders
- Architecture: current visual representation conditioned on previous visual features
- Contribution: 把 cross-image comparison 從 LLM late fusion 前移到 vision encoder
- Limitations: 需要 state management；多幀累積成本與 state drift 尚需更深入研究
- Changed: stateless visual perception → stateful perception runtime

## 5. GramLoop
- Authors: Yang Chen, Canyu Shen, Xinzhe Rao, Yuanyi Yan, Yunlu Chen, Meng Tang, Teng Long, Vincent Tao Hu
- Year: 2026
- URL: https://arxiv.org/abs/2608.29113
- Code: https://github.com/cheyan9/GramLoop （論文表示將釋出）
- Architecture: training-free replay + Gram-consistency gating
- Contribution: 把 Gram relational consistency 用於 inference-time robustness
- Limitation: 目前主要驗證 dense prediction / distribution shift；是否適合 VLM Agent 尚未確認
- Changed: Gram structure 從 training regularization → runtime quality signal

---

# Unknown / Open Questions

## 1. Evidence Retention Score 如何定義？

目前仍缺：

```text
Feature exists in encoder
↓
Projector preserves it
↓
LLM can access it
↓
Agent can use it correctly
```

這四層的 causal measurement。

需要建立：

```text
Evidence Retention Score
= encoder availability
× fusion preservation
× LLM accessibility
× action utility
```

目前只是 Hermes 假說。

## 2. Layer Routing 應該 static 還是 query-dependent？

```text
Static:
always fuse L6 + L12 + L24

Dynamic:
query → choose layers
```

Dynamic routing 更節省成本，但 router 本身可能錯過 evidence。

## 3. Stateful Visual Memory 要存什麼？

可能選項：

```text
raw patch tokens
compressed visual state
delta state
object-centric state
multi-scale feature cache
```

不同方案對 memory / latency / drift 的 trade-off 還不清楚。

---

# Knowledge Graph 新增 Node / Edge

## New Nodes

```text
Vision Evidence Runtime
├ Vision Layer Bank
├ Shallow Feature
├ Middle Feature
├ Deep Feature
├ Layer Selector
├ Layer Mixer
├ Evidence Requirement
├ Evidence Retention Score
└ Evidence Router
```

```text
Dense Feature Stability
├ Patch Similarity Matrix
├ Gram Matrix
├ Gram Teacher
├ Gram Anchor
├ Dense Feature Drift
└ Gram Consistency
```

```text
Multi-Encoder Runtime
├ Contrastive Encoder
├ Self-Supervised Encoder
├ Encoder Complementarity
├ Encoder Redundancy
├ Entropy-Guided Selection
├ Orthogonal Projection
├ Heterogeneous Grid Alignment
└ RoPE Cross-Attention
```

```text
Stateful Vision Runtime
├ Previous Visual State
├ Current Visual State
├ Cross-Image Conditioning
├ Visual Delta
├ State Cache
└ State Drift
```

## New Edges

```text
Task Type
→ determines
Evidence Requirement

Evidence Requirement
→ routes
Vision Encoder

Evidence Requirement
→ routes
Vision Layer

Vision Layer
→ determines
Evidence Type

Long Training
→ may degrade
Patch Relational Structure

Gram Anchoring
→ constrains
Patch Relational Structure

Contrastive Encoder
→ contributes
Language-Aligned Semantics

Self-Supervised Encoder
→ contributes
Dense Spatial Evidence

Encoder Redundancy
→ increases
Token / Compute Waste

Orthogonal Mixing
→ reduces
Representation Redundancy

Previous Visual State
→ conditions
Current Vision Encoding

Visual Evidence
→ Context Compiler
→ LLM Reasoning
→ Agent Action
```

---

# 與歷史研究比較

上一輪主要回答：

```text
Training Objective
→ Feature Geometry
```

本輪往下新增：

```text
Feature Geometry
→ Layer Distribution
→ Encoder Complementarity
→ Evidence Routing
→ Agent Utility
```

同時補上一條 temporal branch：

```text
Previous Observation
→ Visual State
→ Current Encoding
```

因此知識圖譜從「模型如何看單張圖片」開始進入「Agent 如何持續看世界」。

---

# 下一輪研究

## 主題：Visual Evidence Retention × Projector Causal Loss × LLM Visual Utilization × Grounding Failure Attribution

下一輪應直接追：

```text
Vision Feature
↓
Projector
↓
Visual Token
↓
LLM Layer 1
↓
LLM Layer N
↓
Output / Tool Coordinate
```

要回答：

1. vision encoder 真的有 evidence 時，projector 是否把它壓掉？
2. visual token 進 LLM 後，在哪一層被語言化 / 被忽略？
3. grounding error 到底來自 encoder、projector、LLM utilization 還是 action parser？
4. 如何建立可測的 Evidence Retention Score？
5. agent 可否在低 confidence 時主動提高 resolution、切換 encoder 或重看 ROI？

優先追研究：
- visual token probing / causal tracing
- hidden evolution of visual context in VLMs
- projector bottleneck studies
- grounding attribution benchmarks
- query-adaptive vision routing

---

# 本輪收斂回答

**缺哪一層？**  
最缺的是 `Visual Feature → Projector → LLM → Action` 的 causal evidence retention measurement。

**哪個節點最淺？**  
`Evidence Retention Score` 與 `Dynamic Layer Router`。

**哪個概念仍只是名詞？**  
`Agent-aware Visual Evidence Utility`；目前還缺統一可計算定義。

**哪個系統值得讀原始碼？**  
`facebookresearch/dinov3` 的 Gram training path、`mbzuai-oryx/CoME-VL` 的 `olmo/` fusion runtime、`StatefulVisualEncoders/StatefulVisualEncoders` 的 temporal state injection。

**哪篇論文需追引用？**  
CoME-VL（2026）與 Stateful Visual Encoders（2026）；另外最新 GramLoop 值得追它是否從 dense prediction 延伸到 VLM/Agent。

**哪個概念最適合視覺模擬？**  
`Vision Evidence Router Lab`：同時顯示 encoder、layer、Gram geometry、fusion redundancy 與 visual-state flow。

**哪個 Agent 架構最值得實作？**  
`Task-Adaptive Multimodal Evidence Router`：Agent 先判斷需要 semantic / OCR / spatial / change evidence，再動態選 encoder、layer、resolution、history state 與 compression policy。

---

# 核心結論

> **多模態 Agent 的視覺瓶頸不只在「看不看得到」。同一張圖片的證據會分布在不同 vision layers，也會因 training objective 而在不同 encoder 中呈現不同幾何結構；長訓練甚至可能在 global score 改善的同時破壞 patch-level dense relations。下一代 Agent Runtime 因此不應把 Vision Encoder 當成單一固定函式，而應把它建模成可路由的 Evidence System：Task → Encoder → Layer → Resolution → Temporal State → Fusion → LLM → Action。**
