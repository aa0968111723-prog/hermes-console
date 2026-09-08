# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 07:52（Asia/Taipei）**

**研究主題：Vision Feature Semantics × CLIP/SigLIP × DINOv2/DINOv3 × Dense Features × Objective Mismatch**

## 與歷史研究比較 / 去重

上一輪已拆 `RGB Pixels → Resize/Tile → Patch Embedding → 2D Position → Vision Transformer → Patch Merger`。本輪不再重複 patchify、native resolution、window attention，也不重複前一輪 projector/resampler；這輪只追一個更底層問題：**Vision Transformer 為什麼會形成可被 VLM 使用的 feature？不同 training objective 到底把 feature geometry 推向哪裡？**

歷史節點：

```text
Pixels
→ Patch Tokens
→ Vision Transformer
→ ???
→ Projector
→ LLM
```

本輪補上：

```text
Vision Transformer
→ Training Objective
→ Gradient Signal
→ Feature Geometry
→ Global Alignment / Dense Spatial Detail
→ Projector
→ VLM Reasoning
```

---

## 本小時新發現

### 新論文 / 新方向

1. **LeVLJEPA: End-to-End Vision-Language Pretraining Without Negatives (2026)**：不使用 negatives、temperature、momentum encoder 或 teacher-student schedule，而以 cross-modal prediction + stop-gradient targets + per-modality distributional regularization 訓練；作者報告 dense semantic features 對 frozen VLM backbone / segmentation 特別有利。
2. **Penguin-VL (2026)**：直接挑戰「VLM vision encoder 必須先做 CLIP/SigLIP 類 contrastive pretraining」的慣例，將 objective mismatch 明確化：discriminative/global invariance 可能抑制 dense captioning、document、spatial/temporal reasoning 需要的細節。
3. **DINOv3 (2025)**：加入 **Gram anchoring** 處理長訓練下 dense feature maps 退化；這是「global representation 繼續變好，但 dense map 可能變差」的重要反例。
4. **SigLIP 2 (2025)**：不再只依賴 image-text pair matching，而加入 captioning、self-distillation、masked prediction、active/online data curation；官方論文直接報告 localization / dense prediction 改善。
5. **CoME-VL (2026)** 等 multi-encoder 路線開始把 contrastive encoder 與 DINO 類 self-supervised encoder視為互補來源，而非互斥替代。

---

# 本小時最重要 5 個發現

## 1. 「視覺語意」不是單一性質；Global Semantic Alignment 與 Dense Spatial Fidelity 是不同目標

### 已確認事實
CLIP 類 architecture 典型訓練目標是把一張圖片的 global embedding 與正確文字 global embedding 拉近，與 batch 內其他文字拉遠。這非常適合：

```text
Image ↔ Caption alignment
Zero-shot classification
Image-text retrieval
Semantic category discrimination
```

但 VLM 實際給 LLM 的常常不是只一個 pooled image vector，而是完整 patch-token grid：

```text
Patch 0
Patch 1
...
Patch N
↓
Projector
↓
LLM
```

因此 encoder 的兩種品質必須拆開：

```text
Global Feature Quality
≠
Dense Patch Feature Quality
```

### 底層原因
若 loss 主要只觀察 pooled representation：

```text
patch grid
↓
pooling / CLS
↓
global embedding
↓
contrastive loss
```

則 gradient 的主要任務是讓**整張圖的識別性**提高，不必保證每一個 patch 都保留精準位置、邊界、文字筆畫、深度或細小 object evidence。

### 為什麼重要
GUI Agent、OCR、document agent、robot/embodied agent、spatial reasoning 所需的不是「這是一張瀏覽器畫面」而是：

```text
右上角有一個 18px 的 Submit button
第 4 列第 2 欄是一個數字
紅球位於藍盒左側
這個 boundary 屬於桌子不是牆
```

### 限制
不能因此說「contrastive encoder 一定沒有 dense feature」。SigLIP 2、EVA/CLIP variants 與 multi-loss recipes 顯示 global alignment 與 dense quality 可以同時改善；正確說法是**training signal 的 observable granularity 會影響 feature geometry**。

---

## 2. CLIP 與 SigLIP 的核心差異不是「有沒有 contrastive learning」，而是 normalization / pair dependency

### CLIP-style softmax contrastive objective
一批 `B` 個 image-text pairs：

```text
z_img ∈ R^(B×d)
z_txt ∈ R^(B×d)
↓
S = z_img · z_txt^T / τ
↓
B×B similarity matrix
↓
row softmax + column softmax
↓
positive diagonal high
negatives low
```

每個 pair 的 probability 依賴 batch 內其他 pair：

```text
p(text_j | image_i)
= exp(S_ij)
  / Σ_k exp(S_ik)
```

### SigLIP
SigLIP 改成每個 image-text pair 都做 binary logistic decision：

```text
S_ij = z_img_i · z_txt_j

y_ij = +1 if i=j else -1

loss_ij
= -log sigmoid(y_ij × (t S_ij + b))
```

官方 `google-research/big_vision` trainer 原始碼直接做：

```text
logits = dot(zimg, ztxt.T)
logits = logits * t + b
labels = +1 on diagonal, -1 elsewhere
loglik = log_sigmoid(labels * logits)
```

### 底層意義
SigLIP 不需要 softmax normalization 所需的「global batch-wide probability competition」。因此：

```text
CLIP softmax:
每一列/欄的相似度共同形成 normalization denominator

SigLIP:
每個 pair independently contributes logistic loss
```

這也是 SigLIP 論文能討論跨裝置 pair chunking / very large batch scaling 的原因之一。

### 為什麼重要
這改變的是**distributed training dataflow**，不只是 loss formula：

```text
Embedding compute
→ cross-device pair similarities
→ loss
→ communication / memory
```

所以 Training Objective 同時會影響 representation geometry 與 training-system architecture。

---

## 3. DINO 類 self-supervised objective 對 Dense Feature 的強項，來自「patch 本身被當成學習目標」

DINOv2 原始碼的 `SSLMetaArch` 同時建立 student/teacher backbone，並明確組合：

```text
DINOLoss
+iBOTPatchLoss
+KoLeoLoss
```

其中 teacher 會輸出：

```text
x_norm_clstoken
x_norm_patchtokens
```

而 iBOT branch 會：

```text
Patch Mask
↓
Student masked patch tokens
↓
Student head

Teacher visible/global image
↓
Teacher patch tokens
↓
Teacher head
↓
Patch-level target

Student patch prediction
↔ Teacher patch target
```

這與 global image-text contrastive learning 的 supervision topology 根本不同：

```text
CLIP/SigLIP classic:
Global Image ↔ Global Text

DINO/iBOT:
Global/View consistency
+
Patch-level masked-token consistency
```

### 為什麼重要
當 patch token 本身直接進 loss，局部表示不再只是「為最後 pooled vector 服務的中間 activation」。這使 dense segmentation、depth、correspondence、tracking 等 downstream probe 更容易直接利用 patch grid。

### 限制
DINO 類 self-supervised feature 天生不等於 language alignment；若要成為 VLM vision encoder，仍需要 projector、alignment training 或混合目標。這也解釋 2026 multi-encoder / hybrid-pretraining 路線為何開始融合 DINO 與 SigLIP 類 feature。

---

## 4. SigLIP 2 的重要性不是「SigLIP 更新版」，而是承認單一 global contrastive objective 不夠

SigLIP 2 的 recipe 加入：

```text
Sigmoid image-text loss
+
Captioning objective
+
Self-distillation
+
Masked prediction
+
Online / active data curation
+
Multilingual/debiasing data mixture
```

因此應建模成 multi-objective visual representation training：

```text
Image
↓
Vision Encoder
├→ Global embedding → image-text alignment loss
├→ Dense/local tokens → self-distillation / masked loss
└→ caption-related path → language/localization signal
```

### 改變了什麼
SigLIP 2 論文明確報告 localization 與 dense prediction improvement，這支持一個更一般化的結論：

> **Vision encoder feature quality 不是只靠 encoder architecture 決定；loss topology 同樣決定哪一種資訊會被保留。**

### 對 Hermes 的工程含義
不能只在模型 registry 寫：

```text
vision_encoder = SigLIP2
```

應擴充：

```text
Vision Encoder Capability Profile
├ Global Semantic Alignment
├ Dense Semantic Fidelity
├ OCR Fidelity
├ Spatial Fidelity
├ Temporal Fidelity
├ Native-resolution Support
├ Multilingual Alignment
└ VLM-transfer Quality
```

---

## 5. 2026 的新趨勢：VLM Vision Encoder 正從「retrieval encoder」變成「dense evidence compiler」

### 論文結果
Penguin-VL 明確提出 contrastive objective mismatch：若視覺 encoder 被訓練去忽略 category-invariant details，這些被忽略的東西可能正是後續 dense VLM reasoning 所需 evidence。

LeVLJEPA 更進一步採取非 contrastive vision-language pretraining：

```text
Image Encoder
Text Encoder
↓
Cross-modal prediction
↓
Stop-gradient target
↓
Distribution regularization
```

而不是：

```text
positive pair vs negative pairs
```

其論文報告在 frozen VLM backbone 與 segmentation 上 dense feature 更強，而 global linear-probe 類 readout 仍可保持競爭力。

### 合理推論
這代表未來 VLM encoder 的核心 KPI 可能逐步從：

```text
ImageNet zero-shot
Image-text retrieval
```

轉向：

```text
Evidence retention
Dense semantic separability
Fine-detail preservation
Spatial consistency
VLM downstream utility
```

這是**研究趨勢推論**，不是既定產業標準。

---

# Architecture Breakdown

## System Architecture：Dense-Evidence Vision Encoder Stack

```text
Camera / Image / Video
↓
Preprocessor
↓
Patch Embedding
↓
Position Encoding
↓
Vision Transformer
↓
┌──────────────────────────────────┐
│ Feature hierarchy                │
│                                  │
│ Early layers                     │
│ edges / texture / local patterns │
│          ↓                       │
│ Middle layers                    │
│ parts / regions / structures     │
│          ↓                       │
│ Late layers                      │
│ semantic/global abstractions     │
└──────────────────────────────────┘
↓
Training Objective Graph
├ CLIP softmax alignment
├ SigLIP pairwise sigmoid alignment
├ Captioning
├ Masked patch prediction
├ Self-distillation
├ DINO global-view consistency
├ iBOT patch consistency
├ Gram anchoring
└ JEPA-style predictive objective
↓
Gradient distribution across
├ CLS/global token
├ pooled embedding
├ patch tokens
└ intermediate features
↓
Learned Feature Geometry
├ global semantic axes
├ local semantic clusters
├ spatial correspondence
├ object boundary information
├ texture/detail
└ language alignment
↓
Feature Selector / Multi-layer Aggregator
↓
Projector / Resampler
↓
LLM Residual Stream
↓
Agent Perception / Reasoning / Action
```

### 關鍵系統結論
模型看到的 visual evidence 不是單由 forward architecture 決定，而是：

```text
Architecture
× Training Objective
× Data Distribution
× Resolution Policy
× Layer Selection
× Projector Compression
```

共同決定。

---

# Bottom-Level Logic

## CLIP-style gradient topology

```text
image pixels
↓
ViT patch features
↓
pool / CLS
↓
normalize z_img

caption
↓
text transformer
↓
normalize z_txt

z_img · z_txt^T
↓
softmax contrastive loss
↓
gradient
↓
image global representation
```

Dense patch token 主要透過 global representation 的 computation graph 間接得到 gradient。

## SigLIP gradient topology

```text
z_img_i × z_txt_j
↓
all pair scores
↓
positive/negative sign
↓
log sigmoid(y × score)
↓
sum pair losses
```

這移除 batch-softmax normalization，但仍主要是一個 cross-modal discriminative global objective。

## DINO/iBOT topology

```text
Original Image
├ global crop A
├ global crop B
└ local crops

Teacher
↓
Global CLS + Patch Targets

Student
↓
Different crops + masked patches
↓
Prediction heads
↓
DINO global consistency
+
iBOT patch consistency
+
regularization
```

重要的是：

```text
Patch token
→ directly participates in objective
```

而非永遠只透過 global pooling。

## Dense feature degradation 與 DINOv3

DINOv3 報告 long training 期間 dense feature maps 可能退化，即使其他 global capability 繼續提升，並提出 Gram anchoring 維持 dense feature structure。這證明：

```text
Training Longer
≠ Dense Feature Always Better
```

因此 Vision Training Runtime 應加入：

```text
Global Metric
+
Dense Metric
+
Feature-structure stability metric
```

不能只看 image-level accuracy。

---

# Visual Simulation Idea

## **Vision Objective → Feature Geometry X-Ray**

### 面板 A：Training Objective

可切換：

```text
CLIP Softmax
SigLIP Sigmoid
DINO + iBOT
SigLIP 2 Multi-Loss
JEPA-style
```

### 面板 B：同一張圖片的 Patch Grid

例如：桌面截圖，包含：

```text
Header
Submit Button
Tiny text
Icon
Table cells
Background
```

每一個 patch 顯示 embedding，並投影成 2D/3D feature map。

### 面板 C：Loss 直接監督到哪裡

```text
CLIP
[PATCH PATCH PATCH] → [CLS] → LOSS

DINO+iBOT
[PATCH→LOSS][PATCH→LOSS][PATCH→LOSS]
       + [CLS→LOSS]
```

用發光線顯示 gradient flow。

### 面板 D：Global vs Dense Probe

即時計算：

```text
Global classification
Image-text retrieval
Patch nearest-neighbor consistency
Boundary preservation
Small text separability
Spatial correspondence
Segmentation linear probe
```

### 面板 E：Agent Consequence

同一個 screenshot 交給 agent：

```text
Task A: 這是什麼網站？
Task B: 點右下角 Submit
Task C: 讀出第 7 列的數字
```

顯示：

```text
Global evidence sufficient? YES/NO
Dense evidence sufficient? YES/NO
Projector kept evidence? YES/NO
Agent action correct? YES/NO
```

這能直接教使用者：**「看懂圖片大意」與「保留可行動的像素級證據」不是同一種 vision ability。**

---

# Code / GitHub

## 1. google-research/big_vision

值得看的檔案：

```text
big_vision/
├ trainers/proj/image_text/siglip.py
├ trainers/proj/image_text/_deprecated_contrastive.py
├ models/
├ configs/proj/image_text/
└ evaluators/
```

核心 path：`trainers/proj/image_text/siglip.py`

現行 trainer 的 loss 核心：

```text
zimg, ztxt = model(...)
logits = dot(zimg, ztxt.T)
logits = logits * t + b
y = +1 diagonal / -1 off-diagonal
loglik = log_sigmoid(y * logits)
loss = mean(sum(-loglik))
```

值得追下一層：

```text
model forward
embedding normalization
text/image heads
multi-host pair exchange / sharding
SigLIP2 configs/loss composition
```

## 2. facebookresearch/dinov2

值得看的目錄：

```text
dinov2/
├ train/ssl_meta_arch.py
├ loss/
│  ├ dino_clstoken_loss.py
│  ├ ibot_patch_loss.py
│  └ koleo_loss.py
├ models/vision_transformer.py
├ layers/
└ data/
```

`ssl_meta_arch.py` 直接顯示 student/teacher 同時輸出 CLS 與 patch tokens，並將 `DINOLoss + iBOTPatchLoss + KoLeoLoss` 組合進 training step。

最值得繼續讀：

```text
teacher EMA update
centering vs Sinkhorn-Knopp
iBOT masking sampler
multi-crop augmentation
patch target formation
```

## 3. Penguin-VL

論文提供官方 code repository：`tencent-ailab/Penguin-VL`。本輪 GitHub code search 未穩定取得可引用的核心 implementation，因此其「LLM-initialized vision encoder」細節目前仍以論文聲明為主，下一輪若繼續追此支線，需要讀 model definition / initialization mapping / patchification 路徑後再升級為「工程實作已確認」。

---

# Papers

## 1. Learning Transferable Visual Models From Natural Language Supervision
- **Authors**：Alec Radford et al.
- **Institution**：OpenAI
- **Year**：2021
- **URL**：https://arxiv.org/abs/2103.00020
- **Code**：https://github.com/openai/CLIP
- **Dataset**：400M internet image-text pairs（paper dataset, not fully released as a public dataset）
- **Architecture**：dual encoder, image encoder + text encoder, normalized embeddings, batch contrastive loss
- **Contribution**：建立大規模 natural-language supervision + zero-shot transfer 的主流 vision-language pretraining paradigm
- **Limitation**：global alignment objective 不直接要求 dense patch fidelity；dataset biases 可被 representation 繼承
- **改變了什麼**：把 vision pretraining 從固定 class label supervision 轉成 web-scale language supervision

## 2. Sigmoid Loss for Language Image Pre-Training
- **Authors**：Xiaohua Zhai, Basil Mustafa, Alexander Kolesnikov, Lucas Beyer
- **Institution**：Google Research
- **Year**：2023
- **URL**：https://arxiv.org/abs/2303.15343
- **Code**：https://github.com/google-research/big_vision
- **Dataset**：大規模 image-text training mixture（依官方 recipe/config）
- **Architecture**：dual encoder + pairwise sigmoid loss
- **Contribution**：不需 global softmax normalization，每個 pair 可獨立 logistic supervision
- **Limitation**：仍主要是 global image-text alignment；dense evidence 不一定被直接監督
- **改變了什麼**：重新設計 CLIP-style contrastive objective 的 distributed / batch scaling dependency

## 3. DINOv2: Learning Robust Visual Features without Supervision
- **Authors**：Maxime Oquab et al.
- **Institution**：Meta AI
- **Year**：2023/2024
- **URL**：https://arxiv.org/abs/2304.07193
- **Code**：https://github.com/facebookresearch/dinov2
- **Dataset**：curated large-scale image dataset constructed by automated pipeline
- **Architecture**：ViT student-teacher SSL, DINO + iBOT + regularization, multi-crop
- **Contribution**：強化可跨 image-level 與 pixel-level task 使用的 general-purpose visual features
- **Limitation**：本身沒有天然 language alignment；轉成 VLM encoder 仍需跨模態 bridge/alignment
- **改變了什麼**：證明大量 curated data + scalable SSL 可以得到非常強的 dense/general vision representation

## 4. SigLIP 2
- **Authors**：Michael Tschannen et al.
- **Institution**：Google DeepMind / Google
- **Year**：2025
- **URL**：https://arxiv.org/abs/2502.14786
- **Code/Models**：Google Big Vision / released checkpoints
- **Architecture**：SigLIP base + captioning + self-distillation + masked prediction + data curation; NaFlex variants support native aspect ratio / multiple resolutions
- **Contribution**：同時提升 image-text semantics、multilingual、localization、dense prediction、VLM-transfer
- **Limitation**：multi-objective recipe 使 attribution 更難；無法單靠總 benchmark 判斷是哪個 loss 對每種 dense ability 貢獻多少
- **改變了什麼**：主流 language-image encoder 從「單一 global alignment objective」向 multi-objective dense-aware recipe 移動

## 5. DINOv3
- **Authors**：Oriane Siméoni et al.
- **Institution**：Meta
- **Year**：2025
- **URL**：https://arxiv.org/abs/2508.10104
- **Code/Models**：Meta DINOv3 release
- **Architecture**：scaled self-supervised visual foundation model + Gram anchoring + post-hoc resolution/model/text-alignment strategies
- **Contribution**：針對長訓練 dense feature degradation 提出 Gram anchoring，並強化高解析 dense features
- **Limitation**：仍不是 native generative VLM；language alignment 主要屬 post-hoc / downstream integration 問題
- **改變了什麼**：把「dense feature stability during scale-up」升級成 foundation vision pretraining 的一級問題

## 6. Penguin-VL
- **Authors**：Boqiang Zhang, Lei Ke, Ruihan Yang, Qi Gao, Tianyuan Qu, Rossell Chen, Dong Yu, Leoweiliang
- **Institution**：Tencent AI Lab
- **Year**：2026
- **URL**：https://arxiv.org/abs/2603.06569
- **Code**：https://github.com/tencent-ailab/Penguin-VL
- **Architecture**：LLM-based / LLM-initialized vision encoder + compact VLM stack
- **Contribution**：直接提出 contrastive-pretraining objective mismatch，強調 fine-grained spatial/temporal evidence preservation
- **Limitations**：新架構結果仍需要更多獨立重現與跨 encoder/data-scale 比較
- **改變了什麼**：挑戰「CLIP/SigLIP initialization 是 VLM vision encoder 的必要起點」

## 7. LeVLJEPA: End-to-End Vision-Language Pretraining Without Negatives
- **Authors**：Lukas Kuhn, Giuseppe Serra, Randall Balestriero, Florian Buettner
- **Year**：2026
- **URL**：https://arxiv.org/abs/2607.00784
- **Architecture**：non-contrastive cross-modal prediction + stop-gradient targets + per-modality distributional regularization
- **Contribution**：移除 negatives / temperature 等 classic contrastive machinery，直接以 predictive representation learning 建 vision-language feature
- **Limitations**：仍屬新結果，需更多大規模、多資料集、production VLM transfer 驗證
- **改變了什麼**：提供「不靠 contrastive pair discrimination 也能建立 vision-language encoder」的可行路線

---

# 已確認 / 推論 / 假說分層

## 已確認事實
- CLIP 採 batch-level contrastive image-text alignment。
- SigLIP 使用 pairwise sigmoid logistic objective，而不使用 CLIP 式 global softmax normalization。
- Big Vision 原始碼確實以 dot-product similarity、temperature/bias、diagonal positive / off-diagonal negative 的 `log_sigmoid` 實作 SigLIP training loss。
- DINOv2 原始碼同時存在 DINO CLS-token loss、iBOT patch loss、KoLeo loss 與 student/teacher architecture。
- SigLIP 2 論文加入 captioning/self-distillation/masked prediction 等 training signals，並報告 dense/localization improvements。
- DINOv3 報告 dense feature degradation 問題並提出 Gram anchoring。

## 論文結果
- Penguin-VL 報告 contrastive-pretrained vision encoders 可能不如其 LLM-based encoder 保留 fine-grained evidence。
- LeVLJEPA 報告 non-contrastive vision-language pretraining 對 dense semantic / frozen VLM backbone 有優勢。

## 合理工程推論
- Agent runtime 應依 task type 選擇不同 vision encoder / layer / resolution，而不是固定單一 encoder policy。
- Vision model registry 應儲存 `global/dense/OCR/spatial/temporal` capability profile。
- 多 encoder fusion 可以視為 Context Compiler 在 vision domain 的「evidence-source routing」。

## 尚未驗證假說
- Hermes 若對 GUI/OCR/spatial task 動態改用 dense-oriented encoder feature，實際 action success rate 能否在相同 LLM 下穩定提升。
- Dense feature probe 分數與 computer-use benchmark success 是否存在足以做 runtime routing 的單調關係。

---

# Unknown / Open Questions

1. **哪一層 feature 最適合 VLM？** 最後一層 global semantic 最強，但 intermediate layer 可能保留更多 local geometry；需要 layer-wise probe + VLM downstream joint evaluation。
2. **Dense feature 如何量化為 Agent evidence quality？** segmentation mIoU、depth、correspondence、OCR probe 都只是 proxy；真正需要 action-grounded evidence benchmark。
3. **多目標 loss 如何做 attribution？** SigLIP 2 類 recipe 中 captioning、masked prediction、self-distillation、data curation 各自對 OCR/localization/VLM reasoning 貢獻多少仍需細讀 ablation。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Vision Training Objective
├ Global Contrastive Objective
│  ├ CLIP Softmax
│  └ SigLIP Sigmoid
├ Self-Supervised Objective
│  ├ DINO View Consistency
│  ├ iBOT Masked Patch Prediction
│  └ KoLeo Regularization
├ Captioning Objective
├ Masked Prediction
├ Self-Distillation
├ JEPA-style Predictive Objective
├ Gram Anchoring
└ Multi-Objective Vision Pretraining

Vision Feature Geometry
├ Global Semantic Alignment
├ Dense Semantic Fidelity
├ Spatial Fidelity
├ Boundary Fidelity
├ OCR / Fine-detail Fidelity
├ Temporal Fidelity
├ Language Alignment
└ Feature Stability

Vision Evidence Runtime
├ Layer Selection
├ Feature Source
├ Multi-Encoder Routing
├ Dense Probe
├ Evidence Retention Score
└ Task-Adaptive Encoder Policy
```

## Edges

```text
Training Objective
→ shapes
Feature Geometry

Global Contrastive Loss
→ strongly supervises
Global Image-Text Alignment

Patch-Level SSL Loss
→ directly supervises
Dense Patch Features

Dense Feature Fidelity
→ affects
GUI / OCR / Spatial Agent Evidence

Gram Anchoring
→ preserves
Dense Feature Structure

over long training

Vision Encoder Profile
→ informs
Multimodal Context Compiler

Task Type
→ selects
Encoder / Layer / Resolution / Compression Policy
```

---

# 下一輪研究

下一輪最值得進入：

# **Vision Layer Selection × Intermediate Features × DINOv3 Gram Anchoring × Multi-Encoder Fusion × Evidence Routing**

要把本輪的：

```text
Vision Encoder
→ Feature Geometry
```

繼續拆成：

```text
Layer 2
Layer 8
Layer 16
Layer 24
↓
Which information exists where?
↓
Feature Aggregator
↓
CLIP/SigLIP global semantics
+
DINO dense semantics
↓
Fusion / Router
↓
Projector
↓
LLM
```

優先追：

```text
DINOv3 Gram Anchoring
Perception Encoder / intermediate-layer claims
CoME-VL multi-encoder fusion
LLaVA-MORE / hybrid visual encoder studies
Task-adaptive visual routing
```

最終要回答：**「如果一個 vision encoder 的不同層，以及不同 encoder，各自保存不同 evidence，Agent Runtime 應如何知道這次任務到底要拿哪一層、哪一個 encoder？」**

---

# 本輪結束診斷

- **缺哪一層**：Feature layer → Agent evidence utility 的 causal mapping。
- **哪個節點最淺**：Gram anchoring 的底層數學與 layer-wise feature stability。
- **哪個概念仍只是名詞**：`Evidence Retention Score` / `Task-Adaptive Vision Encoder Router`。
- **哪個系統值得讀原始碼**：DINOv2/DINOv3 training stack、Big Vision SigLIP/SigLIP2 recipe、Penguin-VL vision encoder initialization。
- **哪篇論文需追引用**：LeVLJEPA（2026）與 Penguin-VL（2026），因為它們直接挑戰 contrastive vision-language pretraining 的主導假設。
- **哪個概念最適合視覺模擬**：`Vision Objective → Feature Geometry X-Ray`。
- **哪個 Agent 架構最值得實作**：單一 Hermes Agent + **task-adaptive multimodal context compiler**，由 task/evidence requirement 路由 vision encoder、feature layer、resolution 與 compression；先不要為每種 vision encoder 建獨立 agent。

## 本輪核心結論

> **AI「看懂圖片」的能力不是 Vision Transformer 架構自然長出來的單一能力。Training objective 決定 gradient 在 global token、patch token與中間 feature 上如何分配，進而塑造 global semantics、dense spatial detail、language alignment 與 evidence retention。CLIP/SigLIP 擅長把整張圖放進語言語意空間；DINO/iBOT 類 objective 更直接約束 patch-level representation；SigLIP 2、DINOv3 與 2026 的 JEPA / hybrid encoder 路線則顯示，下一代 VLM 視覺前端的核心問題正從『哪個 encoder 最大』轉成『哪些 training signals 能留下 Agent 真正需要的可行動證據』。**