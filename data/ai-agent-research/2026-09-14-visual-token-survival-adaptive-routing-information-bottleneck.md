# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 23:54（Asia/Taipei）**  
**本輪主題：Multimodal Connector Information Bottleneck × Visual Token Survival × Adaptive Visual Routing × Evidence Drop**

> 本輪承接上一輪「Encoder → Connector → LLM causal path」，不再重複 LLaVA / Q-Former / Perceiver 的基本拓樸，而是研究：大量 vision patches 經 projector / pruning / resampling 後，究竟哪些 evidence 活下來；固定 token budget 為何脆弱；模型如何在推理期間主動要求更多視覺資訊；以及 Hermes 如何把 token compression 變成可觀測、可介入、可驗證的 runtime contract。

---

## 0. 與歷史研究的差異

上一輪已建立：

```text
Image / Video Region
→ Vision Encoder
→ Connector
→ LLM Visual Representation
→ Cross-modal Circuit
→ Claim / Tool Call
```

本輪新增的問題不是「connector 怎麼接」，而是：

```text
原始 evidence
→ tokenization / patches
→ selection / clustering / merge / resample
→ surviving tokens
→ LLM

哪些 evidence 被保留？
哪些 evidence 被刪掉？
刪除是因為 redundancy、低 query relevance，還是錯誤 ranking？
若 low-resolution 不夠，模型能否主動重新取得 evidence？
```

因此核心區分更新為：

```text
Token Retention Rate
≠ Evidence Retention Rate
≠ Task-Sufficient Information
```

以及：

```text
Compression Error
≠ LLM Reasoning Error
```

---

# 本小時新發現

## 新論文 / 新架構 / 新 GitHub

1. **OccamToken: Efficient VLM Inference with Training-Free and Budget-Adaptive Token Pruning** (2026)  
   Authors: Geng Li, Guohao Chen, Ting Chen, Shilin Shan, Kuangji Zuo, Bofan Lyu, Tuo An, Gen Li, Jianfei Yang  
   URL: https://arxiv.org/abs/2605.29657  
   核心：不再固定 Top-K，而以 register-anchored relative evidence testing 動態決定 image-adaptive redundancy pruning 與 query-adaptive relevance pruning。論文報告 LLaVA-NeXT 可從 2,880 visual tokens 壓到約 40，仍保留超過 93% 原始 accuracy。  
   限制：relative evidence threshold 仍是 proxy，不能直接等同 source evidence 的 causal necessity。

2. **Prune Redundancy, Preserve Essence / PruneSID** (ICLR 2026)  
   Authors: Zhengyao Fang, Pengyuan Lyu, Chengquan Zhang, Guangming Lu, Jun Yu, Wenjie Pei  
   URL: https://arxiv.org/abs/2603.09480  
   Code: https://github.com/ZhengyaoFang/PruneSID  
   核心：PSCA semantic grouping → intra-group NMS → information-aware dynamic compression ratio；兼顧 importance 與 diversity。論文報告 LLaVA-1.5 在 11.1% token retention 可達 96.3% accuracy，LLaVA-NeXT 在 5.6% retention 達 92.8%。  
   限制：保留 representative token 不代表保留每個 claim 所需的 physical-region provenance。

3. **VisionThink: Smart and Efficient Vision Language Model via Reinforcement Learning** (NeurIPS 2025)  
   Authors: Senqiao Yang, Junyi Li, Xin Lai, Bei Yu, Hengshuang Zhao, Jiaya Jia  
   URL: https://arxiv.org/abs/2507.13348  
   Code: https://github.com/JIA-Lab-research/VisionThink  
   Architecture：先低解析度觀察；若模型判斷 evidence 不足，輸出特殊 token / action，取得更高解析度 visual input。以 RL 學習 accuracy 與 token cost 之間的策略。  
   改變：把 compression 從靜態 preprocessing 變成 reasoning policy / active visual acquisition。

4. **TokenCarve: Information-Preserving Visual Token Compression in MLLMs** (2025)  
   Authors: Xudong Tan, Peng Ye, Chongjun Tu, Jianjian Cao, Yaoxin Yang, Lin Zhang, Dongzhan Zhou, Tao Chen  
   URL: https://arxiv.org/abs/2503.10501  
   Code: https://github.com/ShawnTan86/TokenCarve  
   核心：把 performance degradation 與 attention-output information loss 建立關聯；兩階段 selection + merging，依 information-preservation criterion 壓縮。論文報告 22.2% token retention、1.23× inference speedup、64% KV-cache reduction，accuracy drop 約 1.54%。

5. **Visual Token Compression Enhances Robustness of MLLMs** (2026)  
   Authors: Shishen Gu, Jiequan Cui, Wenbo Hu, Zenglin Shi, Zhenzhen Hu, Richang Hong  
   URL: https://arxiv.org/abs/2607.22716  
   核心：研究指出某些與 language feature space 距離較大的 visual tokens 可視為 misaligned / OOD-like tokens，移除它們除了省成本，也可能降低 jailbreak / hallucination vulnerability。  
   限制：feature-space distance 與 security-causal responsibility 不能混為一談；可能存在對特定 fine-grained task 有用但語言對齊弱的 tokens。

---

# 本小時最重要 5 個發現

## 1. 固定 Top-K 是錯的抽象：visual information demand 是 sample × query dependent

**已確認事實（論文）：** OccamToken 指出 absolute-ranking + fixed Top-K 容易被 attention sinks、image redundancy 與 query-dependent evidence 破壞，因此以 register reference 做 relative evidence testing，再動態決定 pruning。

底層應拆成：

```text
Vision Tokens
→ Reference / Register Signal
→ Relative Evidence Score
→ Redundancy Test
→ Query-Relevance Test
→ Dynamic Threshold
→ Surviving Token Set
```

而不是：

```text
attention score
→ sort
→ keep first K
```

**為什麼重要：** OCR、small-object、chart、document QA 的 evidence density 與 general VQA 完全不同。同一個 10% retention ratio，在不同 query 下代表完全不同的 information loss。

**合理推論：** Hermes 不應記 `compression_ratio=0.1` 就結束，而要記 `why each token survived / died` 及 decision context。

---

## 2. Diversity preservation 與 importance preservation 是兩個不同目標

PruneSID 的原始碼確認真正的執行不是單純 attention Top-K：

```text
hidden states
→ PCA low-rank components
→ token-to-component assignment
→ CLS attention importance
→ within-group cosine similarity
→ NMS-like suppression
→ per-group lower/upper token bounds
→ dynamic quota filling
→ gather surviving hidden states
```

其 `clip_encoder.py` 中：

- `batch_pca()` 對 hidden states 做 `torch.pca_lowrank`，再用 principal component loading 將 tokens 分組；
- CLS attention 形成 token importance；
- normalized hidden states 建立 pairwise cosine similarity；
- `batch_similarity_nms()` 在每個 semantic group 中壓掉高相似 redundant tokens；
- 每個 group 有 lower / upper bound，再依剩餘 diversity 配額分配 token 數；
- 最後 `torch.gather` 直接取回 selected hidden states。

因此 PruneSID 的核心不是：

```text
keep important tokens
```

而是：

```text
cover semantic groups
+
keep strong representatives
+
remove within-group redundancy
```

**重要 edge：**

```text
High Importance
≠ High Coverage

High Coverage
≠ Claim-Specific Sufficiency
```

---

## 3. Token compression 應被視為「information survival process」而不是只看 token count

本輪提出：

```text
VisualTokenSurvivalGraph
```

每個原始 visual evidence unit 都有 survival lineage：

```text
ImageRegion
↓ patchify
PatchToken
↓ encoder
EncoderFeature
↓ group / rank / merge / resample
CompressedVisualToken
↓ projector
LLMVisualToken
↓ decoder circuit
Claim / Action
```

每個 compression operation 應記：

```text
EvidenceDropEvent
├ source_units[]
├ stage
├ method
├ score
├ threshold
├ kept_representative
├ merged_into
├ query_context
├ compression_budget
├ reason
└ recoverability
```

這會讓 Hermes 區分：

```text
PRUNED_REDUNDANT
PRUNED_LOW_RELATIVE_EVIDENCE
MERGED_INTO_REPRESENTATIVE
DOWNSAMPLED
RESAMPLED_TO_LATENT
BUDGET_EVICTED
QUERY_IRRELEVANT
UNKNOWN_DROP
```

**核心：** token 被刪掉不一定代表 evidence 消失；若被 merge / aggregate，部分資訊可能仍存在。反之 token 還在也不代表關鍵 feature 保留。

---

## 4. 最成熟的 adaptive routing 不是「挑 token」，而是讓 Agent 決定是否重新看一次

VisionThink 的 architecture 將視覺 token budget 提升到 policy level：

```text
Low-resolution image
↓
VLM reasoning
↓
Is evidence sufficient?
├ YES → answer
└ NO  → special visual acquisition action
          ↓
       higher-resolution image
          ↓
       re-reason
```

這是與 PruneSID / OccamToken 不同的 system-level abstraction：

```text
Token Pruning
= within-observation compression

Active Visual Acquisition
= Agent decides whether to obtain a richer observation
```

因此 Hermes 的 Agent Runtime 應將 visual acquisition 變成 tool/action：

```text
observe_low_res()
inspect_region(bbox)
request_high_res()
request_more_frames()
request_audio_segment()
```

而不是模型一次拿完所有 multimodal context。

**重要 edge：**

```text
Adaptive Token Routing
≠ Adaptive Evidence Acquisition
```

後者更接近 embodied / browser / computer Agent 的 perception loop。

---

## 5. 壓縮可能提高 robustness，但「刪更多」不是安全策略

2026 robustness work 提出：vision-language misalignment 可能讓部分 visual tokens 形成 OOD-like perturbation；依 language-space distance pruning 可改善 jailbreak defense / hallucination metrics。

但必須嚴格區分：

```text
Low language alignment
≠ malicious token
≠ useless token
```

例如 OCR、專有符號、罕見圖表元素可能天然不貼近一般 language feature manifold，卻正是答案 evidence。

因此 Hermes 未來 security gate 應至少聯合：

```text
alignment risk
× task relevance
× evidence uniqueness
× intervention effect
```

而不是：

```text
far from language space
→ drop
```

---

# Architecture Breakdown

本輪建議 Hermes 新增完整的 **Adaptive Multimodal Evidence Runtime**：

```text
Camera / Image / Video
↓
Physical Source Registry
↓
Vision Encoder
↓
Visual Evidence Inventory
↓
Compression / Routing Engine
├ semantic clustering
├ importance scoring
├ diversity preservation
├ redundancy suppression
├ token merging
├ resampling
├ query-aware pruning
└ image-complexity budget
↓
VisualTokenSurvivalGraph
↓
Evidence Sufficiency Monitor
├ coverage
├ uncertainty
├ OCR/detail demand
├ spatial evidence demand
└ provenance completeness
↓
Agent Perception Policy
├ ANSWER
├ REQUEST_HIGH_RES
├ CROP_REGION
├ REQUEST_MORE_FRAMES
└ RE-ENCODE_WITH_HIGHER_BUDGET
↓
LLM Reasoning
↓
Claim / Plan / Tool Call
↓
Counterfactual Evidence Validation
```

---

# Bottom-Level Logic

## A. Semantic grouping

對 visual hidden states `H ∈ R^(N×d)`：

```text
H
→ PCA / low-rank semantic basis
→ component assignment c_i
```

PruneSID code 的概念可寫成：

```text
U,S,V = PCA(H)
c_i = argmax_j |V_ij|
```

然後每個 token 只在自己的 semantic component group 中競爭。

## B. Importance × redundancy

Importance proxy：

```text
I_i = Σ_head Attention(CLS → token_i)
```

Similarity：

```text
S_ij = cosine(h_i, h_j)
```

若兩 token 屬同一 semantic group 且：

```text
S_ij > τ
```

則可 suppression 較弱代表。

因此 selection 近似：

```text
maximize importance
subject to diversity / group coverage / token budget
```

## C. Survival probability 不是 token score

Hermes 應另外建：

```text
EvidenceSurvival(e, q, B, M)
```

其中：

- `e`：physical evidence / region / patch group
- `q`：query / task
- `B`：visual token budget
- `M`：compression method

真正重要的是：

```text
P(evidence recoverable downstream | q,B,M)
```

而不是 token 本身的 attention 分數。

## D. Adaptive acquisition policy

令 Agent state：

```text
s_t = {
  current visual summary,
  uncertainty,
  token cost,
  evidence gaps,
  query,
  reasoning state
}
```

action：

```text
a_t ∈ {
  answer,
  request_high_res,
  crop_region,
  request_frame,
  expand_token_budget
}
```

reward 可以建模為：

```text
R = task_quality
    - λ_token * visual_token_cost
    - λ_latency * latency
    - λ_tool * acquisition_calls
```

這把 visual token allocation 從 fixed systems knob 變成 sequential decision problem。

---

# Visual Simulation Idea

## Visual Token Survival × Adaptive Vision Lab

使用者上傳一張高解析度圖片與問題後，Console 顯示四層：

### 1. Physical Evidence Map

```text
OCR text
small object
face
chart legend
background
spatial relation
```

### 2. Token Survival Map

每個 patch 用狀態標記：

```text
GREEN   survived
BLUE    merged
GRAY    redundancy-pruned
YELLOW  low relevance
RED     lost unique evidence
```

### 3. Compression Strategy Compare

同一張圖並排比較：

```text
Fixed Top-K
PruneSID-like importance+diversity
OccamToken-like relative evidence
TokenCarve-like information preserving
Adaptive acquire / VisionThink-like
```

顯示：

```text
Token retention       10%
Evidence coverage     93%
OCR evidence          42% ⚠
Small-object evidence 61% ⚠
Prefill latency       -74%
KV cache              -68%
Claim faithfulness    89%
```

### 4. Active Acquisition Simulator

如果 evidence sufficiency 低於 threshold：

```text
Current observation insufficient
Reason: OCR evidence survival = 0.37

Suggested action:
REQUEST_HIGH_RES region=(x1,y1,x2,y2)
```

重新取得後直接看：

```text
+128 visual tokens
+22 ms prefill
OCR evidence 0.37 → 0.94
answer wrong → correct
```

這能直接讓非技術使用者理解：

> AI 不是「看整張圖」；它其實在有限 visual-token budget 下保留、壓縮、丟棄並可能重新取得視覺證據。

---

# Code / GitHub Deep Dive

## PruneSID

Repository：`ZhengyaoFang/PruneSID`

值得看的目錄：

```text
prunesid/
├ prunesid_llava/
│  ├ clip_encoder.py
│  ├ llava_arch.py
│  └ main.py
└ prunesid_qwen/
```

`prunesid_llava/clip_encoder.py` 是本輪最重要核心檔案，真正包含：

```text
batch_pca()
batch_similarity_nms()
CLIPVisionTower_PruneSID.forward()
```

執行鏈：

```text
vision_tower(... output_hidden_states=True, output_attentions=True)
↓
hidden_states[-2]
attentions[-2]
↓
batch_pca(hidden_states)
↓
CLS attention importance
↓
pairwise normalized-state similarity
↓
group-wise NMS
↓
dynamic group token quotas
↓
torch.gather(selected hidden states)
```

這證實 PruneSID 是在 **vision encoder output / connector 前** 改變 token inventory，而不是在 decoder deep layer 才 prune。

## VisionThink

Repository：`JIA-Lab-research/VisionThink`

根目錄確認為完整 veRL-based RL 專案，而非 demo wrapper：

```text
verl/
patches/
scripts/
files/
README.md
NOTE.md
```

因此後續值得沿：

```text
verl/
→ rollout / reward / policy training
→ special visual resize action handling
→ token-cost reward
```

下一輪 code deep dive 可專門追 `visual acquisition action` 如何被 serialize、reward 如何計算、policy 如何區分 ordinary answer token 與 visual-tool token。

---

# Papers：改變了什麼

| Paper | Year | Architecture / Mechanism | 改變 | 限制 |
|---|---:|---|---|---|
| TokenPacker | 2024/2025 journal | coarse-to-fine projector + region-to-point injection | projector 本身變成 compression + fine-detail injection | 固定 architecture，不直接解 query-adaptive evidence demand |
| TokenCarve | 2025 | information-preserving selection + merging | 從 token saliency 轉向 attention-output information preservation | information proxy ≠ claim-level causal evidence |
| VisionThink | 2025 | RL visual acquisition policy | compression 由 static preprocessing → Agent decision | acquisition policy 的 calibration / failure semantics 仍需研究 |
| PruneSID | 2026 | semantic grouping + NMS + dynamic ratio | 同時保 importance 與 diversity | group representative ≠ physical source provenance |
| OccamToken | 2026 | register-anchored relative evidence testing | fixed Top-K → image/query-adaptive threshold | relative evidence仍是 proxy |
| Visual Token Compression Enhances Robustness | 2026 | language-space OOD token pruning | efficiency 與 robustness 連接 | alignment distance 不應被當成 causal security label |

---

# 已確認事實 / 合理推論 / 尚未驗證假說

## 已確認事實

- PruneSID 官方程式碼實作 PCA grouping、CLS-attention scoring、within-group similarity NMS 與 group token quota。
- OccamToken 論文主張 fixed Top-K 在 attention sinks / redundancy / query-dependent evidence 下脆弱，提出 relative evidence + adaptive threshold。
- VisionThink 使用 RL 讓模型 case-by-case 決定低解析度是否足夠，必要時重新取得更高解析度 visual input。
- TokenCarve 報告 visual compression 可大幅降低 KV-cache / token cost，並以 information-preserving criterion 緩解 performance loss。

## 合理推論

- Hermes 的「multimodal provenance」若不紀錄 compression / merge / prune lineage，就會在 encoder→LLM 之間出現 provenance black hole。
- Agent runtime 應將 `request_high_res / crop_region / more_frames` 視為正式 tool actions，而不是 model preprocessing hack。
- Adaptive token budget 應與 task risk 聯動：irreversible tool action 前需要更高 evidence sufficiency threshold。

## 尚未驗證假說

- `EvidenceSurvivalScore` 是否能比 token-retention ratio 更穩定預測 downstream claim faithfulness。
- 是否可用 counterfactual region restore 校準 token-pruning algorithm 的「evidence loss probability」。
- security-oriented OOD token pruning 是否會系統性傷害 OCR / scientific diagram / rare-symbol 任務。

---

# Unknown / Open Questions 1–3

1. **Evidence identity 問題：** token merge / resampler output 同時混合多個 regions 時，怎麼準確保存 source-to-latent provenance，而不是只存 approximate attention map？
2. **Sufficiency calibration：** Agent 在什麼 evidence-confidence 水位才應該 `answer`，什麼時候應 `request_high_res`？這需要 task-risk-aware calibration，而非一個 universal threshold。
3. **Budget attribution：** 一次答錯到底是模型 reasoning 不夠，還是 token budget 太小？需要 compression counterfactual：保持模型與 prompt 不變，只擴大 visual evidence budget。

---

# 下一輪研究

## Visual Evidence Sufficiency × Active Perception Policy × Risk-Aware Multimodal Acquisition

下一輪應從「哪些 token 活下來」再往 Agent 層推：

```text
Current Observation
↓
Evidence Sufficiency Estimator
↓
Task Risk
↓
Visual Acquisition Policy
↓
ANSWER / CROP / ZOOM / MORE FRAMES / HIGH RES
↓
Cost-aware sequential perception
```

優先研究：

- AdaptVision：agentic visual tool use + bbox crop + DTPO；
- VisionThink veRL source：visual-resize action 與 reward；
- active perception / embodied vision 中的 value of information；
- selective prediction / abstention 與 multimodal evidence sufficiency；
- irreversible tool action 前的 perception budget escalation。

最終希望建立：

```text
PerceptionSufficiencyCertificate
AdaptiveVisualAcquisitionPolicy
VisualBudgetEscalationRule
EvidenceValueOfInformation
RiskAwarePerceptionGate
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Visual Token Survival
VisualTokenSurvivalGraph
EvidenceDropEvent
Evidence Merge Event
Token Survival Lineage
Semantic Token Group
Diversity Preservation
Query-Adaptive Token Budget
Image-Adaptive Token Budget
Relative Evidence Test
Register Reference
Evidence Sufficiency
Visual Acquisition Action
Active Visual Perception
Visual Budget Escalation
Compression Counterfactual
Connector Information Certificate
EvidenceSurvivalScore
Task-Sufficient Visual Information
Robustness-Oriented Token Pruning
```

## Edges

```text
Token Retention Rate
≠ Evidence Retention Rate

Evidence Retention Rate
≠ Task Sufficiency

High Token Importance
≠ High Semantic Coverage

High Semantic Coverage
≠ Claim-Specific Sufficiency

Token Present
≠ Feature Preserved

Token Removed
≠ Evidence Fully Lost

Fixed Top-K
→ Can Fail Under Query-Dependent Evidence Demand

Semantic Grouping
→ Improves Diversity Coverage

Within-Group NMS
→ Removes Redundant Representatives

Compression
→ Changes Provenance Topology

Adaptive Visual Acquisition
→ Turns Perception Into Agent Action

Low Language Alignment
≠ Useless Visual Evidence

Higher Visual Budget
→ Can Serve As Compression Counterfactual
```

---

# 本輪結束判定

**缺哪一層：** `Visual Evidence Sufficiency + Active Perception Policy Layer`。  
**哪個節點最淺：** `EvidenceSurvivalScore`、`ConnectorInformationCertificate`、`RiskAwarePerceptionGate`。  
**哪個概念仍只是名詞：** production 級 `Task-Sufficient Visual Information`；目前還沒有統一、可跨模型跨任務的 measurement contract。  
**哪個系統值得讀原始碼：** 第一優先 VisionThink 的 veRL policy / reward / resize action；第二優先 PruneSID Qwen 路徑；第三優先 AdaptVision。  
**哪篇論文需追引用：** OccamToken（budget-adaptive pruning）與 VisionThink（active visual acquisition），再追 PruneSID 對 importance-diversity 的後續工作。  
**哪個概念最適合視覺模擬：** `Visual Token Survival × Adaptive Vision Lab`。  
**哪個 Agent 架構最值得實作：** `Evidence Sufficiency Monitor → Active Visual Acquisition Policy → Risk-Aware Visual Budget Escalation`。

---

# 對「AI 到底怎麼運作」新增的底層答案

多模態 AI 並不是：

```text
Camera → AI 看見整張圖 → Reasoning
```

而更接近：

```text
Camera / Image
→ resize / crop / patchify
→ Vision Encoder
→ hundreds / thousands of visual features
→ grouping / projection / pruning / merge / resample
→ tens / hundreds of surviving visual tokens
→ LLM cross-modal reasoning
→ evidence sufficient?
   ├ yes → claim / plan / action
   └ no  → request more visual evidence
              ↓
           crop / zoom / higher-res / more frames
              ↓
           re-encode → re-reason
```

因此「AI 看到了什麼」必須拆成至少三個問題：

1. **物理世界 / 圖片裡存在什麼？**
2. **哪些 evidence 經視覺壓縮後仍抵達 LLM？**
3. **當 evidence 不夠時，Agent 是否知道自己需要再看一次？**

這一層把多模態 AI 從單次 fixed-context inference 推進成真正的 **active perception Agent**。