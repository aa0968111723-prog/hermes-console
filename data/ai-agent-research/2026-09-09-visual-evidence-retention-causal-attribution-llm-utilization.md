# 【AI Agent × Multimodal Research Report】

**時間：2026-09-09 09:53（Asia/Taipei）**  
**本輪主題：Visual Evidence Retention × Projector/Pruning Loss × LLM Visual Utilization × Grounding Failure Attribution**

> 本輪接續上一輪「Intermediate Vision Layers × DINOv3 Gram Anchoring × Multi-Encoder Fusion × Evidence Routing × Stateful Visual Encoder」。上一輪已回答「證據可能存在 encoder 的哪裡、如何依任務選 encoder/layer/state」；本輪刻意不重複 encoder/layer taxonomy，而專門回答：**證據進入 LLM 後到底在哪一層被保留、破壞、轉譯、利用或遺失？當 Computer/GUI/Embodied Agent 做錯 action 時，如何判斷是 perception、projector、spatial position、LLM utilization、reasoning-time evidence shift，還是 action execution 的錯？**

---

## 本小時新發現

### 新論文 / 新架構 / 新工具

1. **Causal Tracing of Object Representations in Large Vision Language Models: Mechanistic Interpretability and Hallucination Mitigation**（Qiming Li, Zekai Ye, Xiaocheng Feng, Weihong Zhong, Weitao Ma, Xiachong Feng；Harbin Institute of Technology / Peng Cheng Laboratory / HKU；AAAI 2026；arXiv:2511.05923）
   - URL: https://arxiv.org/abs/2511.05923
   - AAAI: https://ojs.aaai.org/index.php/AAAI/article/view/40431
   - Architecture / Method: Fine-grained Cross-modal Causal Tracing（FCCT）覆蓋 visual/text tokens、hidden states、MHSA、FFN 與全部 decoder layers。
   - Contribution: 找到 middle layers 的 last-token MHSA 對跨模態 object aggregation 特別重要；FFN 呈現分階段的 visual representation storage/transfer。
   - Mitigation: Intermediate Representation Injection（IRI），在特定 layer/component 注入 visual object representation，降低 hallucination。
   - 限制: 主要聚焦 object perception/hallucination；不能直接等同 GUI coordinate grounding 或 long-horizon Agent action success。

2. **Too Late to Recall: Explaining the Two-Hop Problem in Multimodal Knowledge Retrieval**（Constantin Venhoff, Ashkan Khakzar, Sonia Joseph, Philip Torr, Neel Nanda；2025；arXiv:2512.03276）
   - URL: https://arxiv.org/abs/2512.03276
   - Dataset: 約 15,000 multimodal factual-recall questions，來源包含 WIT；比較 14 個 VLM（LLaVA / native / cross-attention 類架構，7B–124B）。
   - Architecture / Method: attribution patching + activation patching + probing。
   - Contribution: 把 visual factual recall 拆為 Hop 1「形成 entity representation」與 Hop 2「啟動 LLM 已存在的 factual recall circuit」。11/14 VLM 相對 backbone 有 degradation；低表現模型的 entity representation 出現太晚，錯過早層 factual-recall mechanism。
   - 改變: 證明「vision encoder 已看見」仍不等於「LLM 在對的時間利用」。
   - 限制: factual recall ≠ spatial grounding；但提出一個非常通用的 **Representation Timing** 節點。

3. **What Do Visual Tokens Really Encode? Uncovering Sparsity and Redundancy in Multimodal Large Language Models**（Yingqi Fan, Junlong Tong, Anhao Zhao, Xiaoyu Shen；2026；arXiv:2603.00510）
   - URL: https://arxiv.org/abs/2603.00510
   - Code: https://github.com/EIT-NLP/EmbedLens
   - Architecture / Tool: EmbedLens，把 internal visual embeddings 對照 LLM embedding geometry，分析 sink / dead / alive tokens。
   - Contribution: 論文報告約 60% visual tokens 屬 alive、攜帶 image-specific semantics；alive tokens 在進 LLM 前就可包含 object/color/OCR 等細粒度線索；多數標準任務下部分 internal visual computation 具有 redundancy，但 vision-centric/spatial tasks 仍需要中間層 processing。
   - 限制: 「約 60%」是該研究模型與設定的觀察，不是通用常數；EmbedLens proximity 也不是完整 causal proof。

4. **Grounding-Aware Token Pruning: Recovering from Drastic Performance Drops in Visual Grounding Caused by Pruning**（Tzu-Chun Chien et al., National Tsing Hua University；2025；arXiv:2506.21873）
   - URL: https://arxiv.org/abs/2506.21873
   - Contribution: 指出 visual token pruning 在 RefCOCO grounding 上的巨大掉點，不只來自 semantic evidence 被刪除，而是 pruning 後 **position IDs/order/value 被破壞**。GAP 重新調整 position IDs，在論文設定中將 LLaVA REC accuracy 從 pruning 後 15.34% 恢復到 51.42%，原始未 pruning 為 56.14%。
   - 改變: 正式把「Evidence Content」與「Evidence Geometry / Position」拆成兩個獨立節點。
   - 限制: 數字只適用該 paper/model/benchmark；不是所有 pruning failure 都由 position IDs 解釋。

5. **Why and When Visual Token Pruning Fails? A Study on Relevant Visual Information Shift in MLLMs Decoding**（Jiwan Kim, Kibum Kim, Wonjoong Kim, ByungKwan Lee, Chanyoung Park；NVIDIA Research Taiwan；ECCV 2026）
   - URL: https://research.nvidia.com/labs/twn/publication/eccv_2026_dstp/
   - Contribution: 提出 Relevant Visual Information Shift（RVIS）：complex reasoning 過程中「目前需要看的 visual regions」會隨 generated reasoning tokens 改變，因此 input-time 一次性 pruning 可能早期看似正確、後期卻缺證據。
   - Method: DSTP（Decoding-stage Shift-aware Token Pruning），在 decoding 階段動態配合 shifting evidence requirements。
   - 改變: visual evidence selection 從 **static preprocessing decision** 升級成 **reasoning-time control loop**。
   - 限制: 仍屬 token-pruning efficiency setting；需要驗證它是否適合 tool-use / GUI trajectories。

6. **Task-Related Token Compression in Multimodal Large Language Models from an Explainability Perspective**（Lei Lei et al.; ICLR 2026）
   - URL: https://proceedings.iclr.cc/paper_files/paper/2026/hash/b74c141c9f7bbac5f250f73b0c84a478-Abstract-Conference.html
   - Models: Qwen2-VL、LLaVA-OneVision、VILA1.5；13 個 image/video benchmarks。
   - Contribution: 用 explainability signal 評估 instruction-related visual-token importance，顯示 task-related compression 可以提前到 LLM input stage；另學習 first-layer attention → explanation importance 的 mapping，以避免完整 inference 後才知道 token importance。
   - 改變: Evidence Router 可以利用 **task-conditioned attribution proxy**，而非只靠 visual saliency。

7. **Nüwa: Mending the Spatial Integrity Torn by VLM Token Pruning**（Yihong Huang et al.; 2026；arXiv:2602.02951）
   - URL: https://arxiv.org/abs/2602.02951
   - Contribution: 指出以 global semantic similarity / attention score pruning 時可能破壞 global spatial reference frame；提出兩階段方法先保 spatial anchors、再在 LLM 內做 text-guided pruning。
   - 改變: Evidence Retention 不能只評估「保留哪些內容」，還要評估 token 之間的 **spatial topology** 是否完整。

---

# 本小時最重要 5 個發現

## 1. Visual Evidence 必須拆成 Content、Geometry、Timing、Utilization 四層

### 已確認事實 + 跨論文整合

上一輪我們已建立：

```text
Task
→ Evidence Requirement
→ Encoder / Layer / Resolution Selection
→ Visual Feature
```

本輪發現，這還不夠。Visual evidence 要成為 Agent 可用的 evidence，至少要通過四個 gate：

```text
Visual Evidence
│
├ 1. CONTENT
│  必要 object / text / color / state 是否存在？
│
├ 2. GEOMETRY
│  patch/token 的 spatial ordering / position / topology 是否仍正確？
│
├ 3. TIMING
│  entity / relation representation 是否在「需要它的 LLM layer / reasoning step」之前形成？
│
└ 4. UTILIZATION
   模型最後是否真的讀取並把 evidence 寫入 answer / tool call / coordinate？
```

因此：

```text
Encoder saw evidence
≠ Projector preserved evidence
≠ Spatial reference preserved
≠ LLM formed representation early enough
≠ Decoder used evidence
≠ Agent executed correct action
```

這是本輪 Knowledge Graph 最重要的結構性修正。

來源交叉驗證：
- Grounding-Aware Token Pruning：Geometry / position integrity。
- Too Late to Recall：Representation timing。
- FCCT：跨 layer/component causal utilization。
- DSTP：reasoning-time evidence requirement shift。

---

## 2. Projector/Pruner 的 failure 不只叫「Information Loss」；至少有 4 種不同 loss topology

### 論文結果 + 工程建模

過去常寫：

```text
Vision Features
↓
Projector / Compressor
↓
Information Loss
```

這過度簡化。本輪應拆成：

```text
A. Semantic Content Loss
object / OCR / color / attribute 消失

B. Spatial Topology Loss
位置關係、global reference frame、position IDs 被破壞

C. Redundancy Misclassification
把對當前 task 不重要、但後續 reasoning 會需要的 token 當成 redundant

D. Temporal / Reasoning Shift Loss
Step 1 不重要的 token
在 Step 4 變成必要 evidence
但已永久 prune
```

Grounding-Aware Token Pruning 顯示一個非常重要的反例：即使 visual content 大致還在，pruning 後錯誤 position IDs 就能讓 grounding performance 崩壞。

DSTP 又補上另一個維度：

```text
RelevantVisualTokens(t=0)
≠ RelevantVisualTokens(t=8 reasoning tokens)
≠ RelevantVisualTokens(t=32)
```

所以對 Agent，更合理的 Visual Evidence Manager 應是：

```text
Observe
↓
Build Evidence Bank
↓
Reasoning Step t
↓
Query current evidence need
↓
retain / reactivate / re-encode ROI
↓
next reasoning step
```

而不是：

```text
Image
→ prune once
→ hope remaining tokens stay relevant forever
```

---

## 3. LLM Visual Utilization 有「representation timing」問題：資訊太晚變成語言可用狀態也會失敗

### 已確認論文結果

Too Late to Recall 提出非常清楚的 two-hop model：

```text
Image
↓
Hop 1: Entity Resolution
「這是 Eiffel Tower」
↓
Hop 2: Factual Recall
「它位於 Paris」
```

關鍵問題不是只有 Hop 1 正不正確，而是：

```text
EntityRepresentationLayer
```

是否早到足以啟動 backbone 原本的 factual-recall circuit。

低表現 VLM：

```text
Visual input
↓
Layer 1  ???
Layer 5  ???
Layer 10 partial entity
Layer 16 entity resolved
↓
但 factual-recall circuit 的重要 early site 已錯過
```

高表現 VLM：

```text
Visual input
↓
Early layers already contain useful entity representation
↓
Reuse existing LLM recall mechanism
```

這對 Agent 有一個重要推論：

```text
Evidence Presence
≠ Evidence Availability At Decision Time
```

例如 GUI Agent：

```text
Screenshot 中 Submit button 已被 encoder/projector 保留

但

button identity / coordinate relation
直到很晚才形成

→ earlier planning step 已選錯 action
```

這最後一段是 **合理工程推論**，尚未被 Too Late to Recall 直接驗證在 GUI Agent 上。

---

## 4. Visual Tokens 不是等價資訊單位：Sink / Dead / Alive 讓 Evidence Retention 可以被顯式量測

### 已確認論文結果 + GitHub 原始碼研究

EmbedLens 的重要性不只是「可以 prune token」，而是它提供一個新的 observability layer：

```text
Projected Visual Tokens
├ Sink
├ Dead
└ Alive
```

論文報告：
- Alive tokens 約占 60%（限該研究設定），攜帶 image-specific meaning。
- Alive token 在進 LLM 前就可能保有 object / color / OCR 等細節。
- 某些 Sink / Dead tokens 移除後影響很小。
- vision-centric / spatial tasks 仍可能需要 LLM 中間層 visual processing。

這直接挑戰：

```text
All visual tokens
→ equal context cost
→ equal evidence value
```

更合理的是：

```text
Token i
├ Semantic Utility
├ Spatial Utility
├ Task Relevance(t)
├ Redundancy
├ Position Criticality
└ Cost
```

### GitHub 不只 README

`EIT-NLP/EmbedLens` repository：
https://github.com/EIT-NLP/EmbedLens

值得看的結構：

```text
eval_scripts/
├ 03_1_sinks_pruning/
│  ├ cv_centric.sh
│  ├ general.sh
│  ├ hallucination.sh
│  └ ocr.sh
├ 03_2_mlp_2_skipping/
│  ├ cv_centric.sh
│  ├ general.sh
│  ├ hallucination.sh
│  └ ocr.sh
└ 04_dead/
   ├ cv_centric.sh
   ├ general.sh
   ├ hallucination.sh
   ├ ocr.sh
   └ textvqa.sh

llava/
├ model/
├ eval/
└ conversation.py
```

這個 repo 很值得下一輪繼續追：它不是只有一個 visualization demo，而是把 sink pruning、MLP skipping、dead-token ablation 分成不同 benchmark scripts，能直接作為 Hermes 的 Evidence Retention benchmark blueprint。

---

## 5. Visual Grounding failure 必須做 Causal Attribution，而不是只看最後 accuracy

### 已確認論文結果 + Hermes 工程模型

FCCT 提供一個非常重要的範式：

```text
corrupt / intervene representation
↓
patch selected token/component/layer
↓
measure output recovery
↓
estimate causal importance
```

它分析：

```text
Visual tokens
Text tokens
×
Hidden state
MHSA
FFN
×
All decoder layers
```

論文發現 middle-layer last-token MHSA 對 cross-modal aggregation 重要，FFN 則呈現階段化 object representation transfer。

這代表 Hermes Console 的 debugging 不應只顯示 attention heatmap，而需要：

```text
Layer 0  visual evidence present?     ✓
Layer 4  object identity decodable?   ✓
Layer 8  spatial relation decodable?  ✓
Layer 12 causal contribution?         HIGH
Layer 18 evidence overwritten?        POSSIBLE
Final   tool coordinate correct?      ✕
```

最終 failure attribution 可以變成：

```text
PERCEPTION_FAILURE
PROJECTOR_CONTENT_LOSS
SPATIAL_INTEGRITY_LOSS
REPRESENTATION_LATE
LLM_UTILIZATION_FAILURE
REASONING_EVIDENCE_SHIFT
ACTION_SERIALIZATION_FAILURE
ACTION_EXECUTION_FAILURE
```

而不是全部叫：

```text
VLM failed
```

---

# Architecture Breakdown

本輪建立新的 **Causal Visual Evidence Runtime**：

```text
Camera / Screenshot / Image / Video Frame
↓
Visual Observation Manager
↓
Vision Encoder / Layer Router
↓
Raw Evidence Bank
├ Patch feature
├ Object evidence
├ OCR evidence
├ Spatial evidence
└ Temporal delta
↓
Projector / Resampler / Token Pruner
↓
Evidence Preservation Check
├ Content retention
├ Position retention
├ Spatial topology retention
└ Token provenance
↓
Projected Visual Token Bank
├ Alive
├ Sink
├ Dead
└ Unknown
↓
LLM Input
↓
Layer-wise Evidence Trace
├ Layer 1 probe
├ Layer 4 probe
├ Layer 8 probe
├ Layer 12 probe
└ ...
↓
Cross-modal Aggregation
├ MHSA
├ FFN
└ Residual Stream
↓
Reasoning Step t
↓
Dynamic Evidence Requirement
↓
Evidence still available?
├ YES → continue
└ NO
   ├ reactivate cached token
   ├ re-encode ROI
   ├ increase resolution
   └ re-observe screen
↓
Decision Representation
↓
Tool / Coordinate Proposal
↓
Parser / Authorization
↓
Action Runtime
↓
Environment
↓
New Observation
```

這讓 multimodal Agent loop 從：

```text
Observe → Think → Act
```

升級為：

```text
Observe
→ Build Evidence
→ Preserve Evidence
→ Trace Utilization
→ Reason
→ Detect Evidence Shift
→ Re-observe if needed
→ Decide
→ Act
→ Verify
```

---

# Bottom-Level Logic

## A. Causal evidence tracing

概念上：

```text
Clean run:
h_l^clean

Corrupted run:
h_l^corrupt

Patch selected state:
h_l^patched ← h_l^clean

Measure:
Δ target logit / probability / coordinate accuracy
```

若：

```text
patch Layer 10 visual-object state
→ answer probability strongly recovers
```

則 Layer 10 該 state 對 outcome 有較強 causal evidence。

這比：

```text
AttentionWeight high
```

更接近因果判斷，因為高 attention 不必然等於對 output 有高 causal effect。

## B. Representation timing

定義一個 Hermes 可量測的概念：

```text
Evidence Emergence Layer E(e)
= 最早能可靠 decode evidence e 的 layer

Decision Dependency Layer D(e)
= downstream circuit 開始需要 evidence e 的 layer
```

若：

```text
E(e) > D(e)
```

則可能發生：

```text
Representation-Late Failure
```

這是從 Too Late to Recall 抽象出的 **合理工程模型**。

## C. Dynamic relevance

將 visual token relevance 改成：

```text
R(token_i, task, step_t)
```

而不是：

```text
R(token_i, image)
```

因此：

```text
R(i,t0) low
R(i,t8) high
```

是一個合法而重要的 case。

這正是 RVIS / DSTP 方向對 Agent runtime 最重要的啟示。

---

# Visual Simulation Idea

## **Visual Evidence Causal Trace Lab**

這一輪最值得 Hermes Console 直接實作的互動模擬。

### Panel 1 — Evidence Provenance Map

在圖片上，每個 patch/token 都顯示：

```text
Patch 132
├ Encoder Layer: 16
├ Semantic: "Submit"
├ OCR: 0.91
├ Spatial: (x=.82, y=.91)
├ Projected Token: #388
├ Alive Score: .87
└ Position ID: 412
```

### Panel 2 — Compression / Pruning Damage

切換：

```text
No Compression
Top-K Attention Pruning
Semantic Similarity Pruning
Grounding-Aware Position Fix
Dynamic Shift-Aware Pruning
```

即時比較：

```text
Content Retention
Position Integrity
Spatial Topology
Visual Token Count
Prefill Cost
KV Cost
Grounding Accuracy
```

### Panel 3 — Layer Causal Trace

```text
Layer    Object   OCR   Spatial   Causal Δlogit
------------------------------------------------
2        .30      .15   .61       .01
6        .78      .34   .82       .09
10       .91      .66   .87       .31
14       .95      .81   .79       .18
22       .93      .90   .62       .04
```

可點擊：

```text
PATCH CLEAN ACTIVATION HERE
```

觀察 output 是否恢復。

### Panel 4 — Reasoning-Time Evidence Shift

例如任務：

```text
「找到價格最低的商品，再按它右邊的加入購物車」
```

reasoning timeline：

```text
t0: need product names
↓
t1: need prices
↓
t2: compare minimum
↓
t3: need row alignment
↓
t4: need button coordinate
```

介面顯示 visual token relevance 如何改變：

```text
Token 31  ███████░ t0
Token 97  ██░░░░░░ t0 → ████████ t2
Token 201 ░░░░░░░░ t0 → ████████ t4
```

如果 Token 201 在 t0 就被 prune：

```text
FAILURE: RELEVANCE SHIFT / EVIDENCE UNAVAILABLE
```

這是目前最能讓非專業使用者真正理解「AI 為什麼明明看過畫面，後面還是按錯」的視覺模擬。

---

# Code / GitHub

## 1. EIT-NLP/EmbedLens

URL: https://github.com/EIT-NLP/EmbedLens

值得看：

```text
eval_scripts/03_1_sinks_pruning/
eval_scripts/03_2_mlp_2_skipping/
eval_scripts/04_dead/
llava/model/
llava/eval/
```

研究價值：
- 直接做 visual-token category ablation。
- 可把 pruning / skipping / OCR / hallucination / vision-centric benchmark 做成 Hermes regression suite。

## 2. LLaVA

URL: https://github.com/haotian-liu/LLaVA

值得沿著這條 runtime path 追：

```text
llava/model/
├ multimodal_encoder/
├ multimodal_projector/
└ llava_arch.py
```

要回答的不是「projector 是 MLP」而已，而是：

```text
Vision feature tensor
→ selected vision layer
→ projector
→ image token insertion
→ position/token layout
→ LLM inputs_embeds
```

這條路徑是下一輪做 provenance instrumentation 最適合的實作入口。

## 3. Grounding-aware pruning / DSTP 類實作

下一輪值得追原始碼的具體位置：
- token selection score 如何產生；
- pruning 後 position IDs 如何重建；
- decoder step 如何重新估計 relevance；
- cache 已建立後是否允許 visual token reactivate；
- dynamic pruning 與 KV cache 是否衝突。

---

# Papers

## Paper 1
**Title:** Causal Tracing of Object Representations in Large Vision Language Models: Mechanistic Interpretability and Hallucination Mitigation  
**Authors:** Qiming Li, Zekai Ye, Xiaocheng Feng, Weihong Zhong, Weitao Ma, Xiachong Feng  
**Institution:** Harbin Institute of Technology / Peng Cheng Laboratory / University of Hong Kong  
**Year:** 2026（AAAI 2026；arXiv 2025）  
**URL:** https://arxiv.org/abs/2511.05923  
**Code:** 尚需下一輪確認官方 repository  
**Dataset/Benchmarks:** 5 個常用 LVLM benchmarks（paper）  
**Architecture:** FCCT + IRI  
**Contribution:** visual/text token × component × layer 的細粒度 causal tracing；找出 middle-layer MHSA 與 staged FFN roles。  
**Limitations:** 主要聚焦 hallucination/object perception；對 spatial/action grounding 的 generalization 尚需驗證。  
**改變了什麼:** 把 VLM interpretability 從 attention visualization 推進到 component-level causal intervention。

## Paper 2
**Title:** Too Late to Recall: Explaining the Two-Hop Problem in Multimodal Knowledge Retrieval  
**Authors:** Constantin Venhoff, Ashkan Khakzar, Sonia Joseph, Philip Torr, Neel Nanda  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2512.03276  
**Code:** 尚需確認  
**Dataset:** 約 15k WIT-derived multimodal factual recall questions  
**Architecture:** 14 VLMs；adapter/native/cross-attention  
**Contribution:** representation timing / two-hop causal explanation；activation patching 可恢復部分 backbone gap。  
**Limitations:** factual recall 為主，不等於 grounding/action。  
**改變了什麼:** 新增「Evidence 出現得太晚」這種 failure class。

## Paper 3
**Title:** What Do Visual Tokens Really Encode? Uncovering Sparsity and Redundancy in Multimodal Large Language Models  
**Authors:** Yingqi Fan, Junlong Tong, Anhao Zhao, Xiaoyu Shen  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2603.00510  
**Code:** https://github.com/EIT-NLP/EmbedLens  
**Architecture:** EmbedLens + LLaVA/InternVL/Qwen family analyses  
**Contribution:** sink/dead/alive token taxonomy；visual semantic sparsity；mid-layer injection / visual computation redundancy analysis。  
**Limitations:** token categories / percentages model-dependent。  
**改變了什麼:** Visual token 不再視為均質 context units。

## Paper 4
**Title:** Grounding-Aware Token Pruning: Recovering from Drastic Performance Drops in Visual Grounding Caused by Pruning  
**Authors:** Tzu-Chun Chien, Chieh-Kai Lin, Shiang-Feng Tsai, Ruei-Chi Lai, Hung-Jen Chen, Min Sun  
**Institution:** National Tsing Hua University  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2506.21873  
**Dataset:** RefCOCO 等 grounding benchmarks  
**Architecture:** GAP position-ID correction applied to multiple pruning strategies/VLMs  
**Contribution:** position-ID misalignment 是一類重要 grounding degradation cause。  
**Limitations:** 不能解釋所有 pruning failures。  
**改變了什麼:** 「token 被刪」與「token spatial coordinate system 被破壞」必須分開。

## Paper 5
**Title:** Why and When Visual Token Pruning Fails? A Study on Relevant Visual Information Shift in MLLMs Decoding  
**Authors:** Jiwan Kim, Kibum Kim, Wonjoong Kim, ByungKwan Lee, Chanyoung Park  
**Institution:** NVIDIA Research Taiwan  
**Year:** 2026（ECCV 2026）  
**URL:** https://research.nvidia.com/labs/twn/publication/eccv_2026_dstp/  
**Architecture:** DSTP  
**Contribution:** Relevant Visual Information Shift；把 pruning relevance 從 static 變成 decoding-step-dependent。  
**Limitations:** 需要進一步測 tool-use/GUI action trajectories。  
**改變了什麼:** Evidence relevance 變成 `R(token, task, decoding_step)`。

---

# Unknown / Open Questions

## 1. 如何建立真正的 Evidence Retention Score？

目前可以量：

```text
semantic probe
OCR probe
spatial probe
position integrity
causal Δlogit
final task accuracy
```

但還缺：

```text
Evidence Retention Score
→ 是否能預測 Agent Action Success？
```

可能需要：

```text
ERS(e)
=
w1 Semantic
+ w2 Spatial
+ w3 Timing
+ w4 Causal Contribution
+ w5 Availability at Decision Step
```

這是 **尚未驗證的 Hermes 指標設計**。

## 2. Dynamic visual relevance 與 KV Cache 如何共存？

如果 input-time 已 prefill：

```text
Visual Tokens
→ KV Cache
```

後面 reasoning step 想：

```text
reactivate previously pruned token
```

runtime 是否要：

```text
re-prefill?
patch KV?
append late visual memory?
cross-attention side memory?
```

這是目前 architecture 很深的缺口，會直接連回我們前幾輪研究的 KV transfer / prefix cache / context compiler。

## 3. Agent failure attribution 能否做到 online？

FCCT / activation patching 很適合 research diagnosis，但 production Agent 不能每次都跑多次 corrupted/patched inference。

需要研究：

```text
offline causal tracing
↓
train lightweight probes / monitors
↓
online evidence-health signals
```

這可能成為下一代 Multimodal Agent observability stack。

---

# Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Visual Evidence Integrity
├ Content Integrity
├ Position Integrity
├ Spatial Topology Integrity
├ Temporal Availability
└ Provenance Integrity

Visual Evidence Utilization
├ Evidence Emergence Layer
├ Entity Resolution Timing
├ Cross-modal Aggregation
├ MHSA Causal Site
├ FFN Storage/Transfer Site
├ Decision Dependency Layer
└ Causal Contribution

Visual Token Semantics
├ Sink Token
├ Dead Token
├ Alive Token
├ Token Task Relevance
└ Token Step Relevance

Grounding Failure Attribution
├ Perception Failure
├ Projector Content Loss
├ Spatial Integrity Loss
├ Representation-Late Failure
├ Utilization Failure
├ Relevant-Information Shift
├ Action Serialization Failure
└ Execution Failure

Dynamic Visual Evidence Runtime
├ Evidence Bank
├ Evidence Reactivation
├ ROI Re-encoding
├ Resolution Escalation
├ Re-observation
└ Evidence Health Monitor
```

## 新 Edges

```text
Vision Feature
→ Projector
→ Projected Visual Token

Projector / Pruner
→ may cause
Content Loss

Token Pruning
→ may break
Position Integrity

Position Integrity
→ affects
Grounding Accuracy

Visual Token
→ may be classified as
Alive / Dead / Sink

Reasoning Step
→ changes
Visual Token Relevance

Entity Representation Timing
→ controls access to
LLM Existing Knowledge Circuit

Middle-layer MHSA
→ causally contributes to
Cross-modal Aggregation

Evidence Availability at Decision Time
→ constrains
Agent Action Accuracy

Agent Failure
→ should be attributed to
Perception / Preservation / Utilization / Action layer
```

---

# 與歷史研究的比較

前幾輪已完成：

```text
Pixels
→ Patchify
→ Vision Encoder
→ Training Objective
→ Feature Geometry
→ Layer Selection
→ Multi-Encoder Evidence Router
→ Projector / Compression
```

本輪新增的不是另一種 encoder/projector，而是：

```text
Projected Evidence
→ Integrity
→ Layer-wise Representation Timing
→ Causal Utilization
→ Reasoning-time Relevance Shift
→ Decision
→ Action
```

因此目前多模態鏈已推進到：

```text
Camera/Image/Screen
↓
Pixels
↓
Patch / Position
↓
Vision Encoder
↓
Feature Geometry
↓
Evidence Router
↓
Projector / Compressor
↓
Evidence Integrity
↓
LLM Residual Stream
↓
Evidence Emergence / Causal Sites
↓
Reasoning-time Evidence Selection
↓
Planning
↓
Tool / Coordinate Proposal
↓
Action Runtime
↓
Environment
```

---

# 下一輪研究

## **Dynamic Multimodal Memory × Visual KV / Cross-Attention Memory × Re-observation × Evidence Reactivation**

下一輪最值得接的是本輪最大 open question：

```text
Visual evidence 在 prefill 後已經被壓進 KV
↓
Agent reasoning 到一半才發現需要先前被 prune 的 patch
↓
怎麼辦？
```

要比較：

```text
1. Re-prefill full visual context
2. Append re-encoded ROI tokens
3. Cross-attention external visual memory
4. Persistent visual state cache
5. Retrieval over visual embeddings
6. Dynamic KV / memory connector
```

並把它接回先前已研究的：

```text
Context Compiler
KV Cache
Prefix Cache
Disaggregated Encoder
Stateful Vision Encoder
Agent Memory
```

這一輪之後，就能開始建立真正的：

# **Multimodal Agent Memory Architecture**

而不是只把「圖片」當一次性的 prompt input。

---

# 本輪結束回答

**缺哪一層？**  
最缺的是 `dynamic visual evidence ↔ KV/context runtime`：Agent reasoning 中途要重新取得 ROI/舊 frame 證據時，如何不整段重算。

**哪個節點最淺？**  
Evidence Retention Score 與 Online Causal Monitor。

**哪個概念仍只是名詞？**  
Agent-aware Evidence Health / Decision-time Evidence Availability，尚缺統一 benchmark 與可操作定義。

**哪個系統最值得讀原始碼？**  
`EIT-NLP/EmbedLens` 的 token ablation path、LLaVA 的 multimodal projector/input assembly，以及 DSTP / grounding-aware pruning 的 token-position update runtime。

**哪篇論文需追引用？**  
首選 `Too Late to Recall`：Representation Timing 很可能不只解釋 factual recall，也能延伸到 grounding、tool use 與 planning。第二是 FCCT，因為它提供可轉成 Agent observability 的 causal methodology。

**哪個概念最適合視覺模擬？**  
`Visual Evidence Causal Trace Lab`：把 patch provenance → projector → position → LLM layer → causal contribution → reasoning step → action 串成一條可點擊 X-Ray。

**哪個 Agent 架構最值得實作？**  
`Evidence-Aware Re-observation Agent`：Agent 不假設首次視覺 encoding 已足夠，而是在 reasoning 中檢查 evidence availability；不足時主動 ROI re-encode / re-observe，再繼續 planning。

---

# 本輪核心結論

> **「AI 看到了」不是單一事件。視覺證據必須先在 Encoder 中存在，再經 Projector/Pruner 保留內容與空間拓撲，接著要在 LLM 的正確 layer/時間形成可利用的 representation，並隨 reasoning step 持續保持 relevant。任何一層失敗，都可能讓最後的 Tool Call 或座標 action 錯誤。因此下一代 Multimodal Agent 需要的不是更大的 Vision Encoder 而已，而是一套可追蹤 evidence provenance、integrity、timing、causal utilization 與 re-observation 的完整 Visual Evidence Runtime。**
