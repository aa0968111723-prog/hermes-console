# 【AI Agent × Multimodal Research Report】

**時間：2026-09-14 19:55（Asia/Taipei）**  
**主題：LLM Influence Estimation × Multimodal Token Attribution × Intervention-Calibrated Provenance × Attribution Safety Tiers**

---

## 本小時新發現

本輪不再重複前一輪的 Field-Level Provenance / Multimodal Taint，而是追問更底層的問題：**一條 FieldDependencyEdge 到底憑什麼成立？**

新增重點：

1. **OmniTrace（2026）**：把 decoder-only omni-modal LLM 的 attribution 定義成 generation-time tracing；支援 text / image / audio / video，將每一個生成 token 的 token-level attribution signal 聚合成 source-unit 與 span-level attribution。
2. **FlashTrace（ICML 2026 Oral）**：針對 reasoning LLM 長輸出，使用 span-wise aggregation + recursive attribution，把 final answer 的 attribution 沿 reasoning tokens 往原始 prompt/source 回溯；作者報告長序列上超過 130× 加速。
3. **NeuroTaint / Ghost in the Agent（2026）**：指出 Agent information flow 不只 literal copy，而包含 semantic transformation、decision influence、cross-session memory persistence。
4. **OpenTelemetry GenAI semantic conventions** 已可標準化模型、token usage、prompt/completion、tool call / tool result 等 telemetry，但 telemetry 本身仍不是 model-internal influence，也不是 causal proof。
5. **新架構：Attribution Safety Tier**。Hermes 不應把 attention heatmap、gradient、occlusion、counterfactual replay 混成同一種「證據」。不同 attribution 方法只能支援不同強度的使用情境。

Sources:
- OmniTrace: https://arxiv.org/abs/2604.13073
- OmniTrace code: https://github.com/UCSB-AI/OmniTrace
- FlashTrace: https://arxiv.org/abs/2602.01914
- FlashTrace code: https://github.com/wbopan/flashtrace
- Ghost in the Agent / NeuroTaint: https://arxiv.org/abs/2604.23374
- OpenTelemetry GenAI observability: https://opentelemetry.io/blog/2026/genai-observability/

---

# 本小時最重要 5 個發現

## 1. Attention / Gradient / Attribution Score ≠ Causal Influence

### 概念

OmniTrace 將底層 scoring signal 視為可替換元件。論文明確允許 attention weights、gradient-based scores 或其他 token attribution signal，再將其轉成 source-unit mapping。

底層流程：

```text
Multimodal inputs
↓
Processor
↓
Unified token sequence x
↓
Autoregressive decoding y_t
↓
Token attribution a_t(i)
↓
Aggregate attribution mass inside source unit S_j
↓
Token → source assignment
↓
Generation span chunking
↓
Confidence-aware source curation
↓
Span-level source attribution
```

OmniTrace 的實際原始碼 `src/omnitrace/core/generation.py` 目前支援：

```text
attmean
attraw
attgrads
```

其中 `attmean` 是跨 layer 對 attention 做 mean pooling；`attraw` 使用最後一層 attention；gradient method 則交給 `gradients.py`。

### 為什麼重要

這提供 Hermes 很好的 **visual explanation signal**，但不能直接當作：

```text
permission allow/deny
privacy leak proof
causal responsibility proof
knowledge admission proof
```

因此新增核心 edge：

```text
High Attribution Score
≠ Proven Causal Influence
```

### 限制

Attention 或 gradient attribution 都可能對 baseline、normalization、layer aggregation、tokenization、multimodal projection 選擇敏感。

### 來源

OmniTrace paper + official GitHub source。

---

## 2. Attribution 必須在 generation-time 對齊，而不是只對 final answer 做一次 embedding similarity

### 概念

Decoder-only LLM 的 output 不是一次性產生，而是：

```text
y1
↓
y2 conditioned on x,y1
↓
y3 conditioned on x,y1,y2
↓
...
```

所以 attribution graph 在每個 decode step 都成長。

OmniTrace 形式化：

```text
for each generated token y_t:
    obtain a_t(i)
    map attribution to source unit
    record confidence

then:
    chunk output tokens into semantic spans
    aggregate source assignments
```

這比：

```text
final sentence embedding
vs
source embedding similarity
```

更接近真正的 generation process。

### 為什麼重要

Hermes 的 claim provenance 不能只在最後成品生成完才做 fuzzy matching。更強的架構應在 token / generation-span 產生時就記錄 lineage。

新增：

```text
GenerationTimeAttributionRecord
├ generation_token_range
├ source_token_ranges[]
├ modality
├ attribution_method
├ attribution_scores[]
├ source_unit_ids[]
├ model_version
└ decoder_step_range
```

### 限制

Generation-time attribution 仍然是 attribution，不等於 counterfactual causal verification。

---

## 3. Reasoning tokens 會吸收 attribution；只看 final-output → prompt 可能漏掉真正來源

### 概念

FlashTrace 指出 reasoning LLM 的長鏈問題：

```text
Prompt source
↓
Intermediate reasoning token
↓
Intermediate reasoning token
↓
Final answer
```

若只計算：

```text
Final answer
→ current context attribution
```

大量 attribution mass 可能停留在 reasoning tokens，而沒有繼續回溯至原始 prompt / retrieved evidence。

FlashTrace 因此使用 recursive attribution：

```text
Hop 0:
Final output span
→ context

Hop 1:
important reasoning tokens
→ earlier context

Hop 2:
important earlier reasoning
→ original source
```

### 為什麼重要

對 Agent Runtime，這意味：

```text
Final claim
→ reasoning span
→ memory summary
→ retrieved chunk
→ original source field
```

不能因中間有 summary / reasoning / compression，就中斷 provenance。

新增：

```text
RecursiveInfluencePath
```

以及：

```text
Intermediate Reasoning Attribution
→ Must Be Propagated Back To External Evidence
```

### 限制

Recursive attribution 的「faithfulness」仍是方法層 approximation，不能直接等於 full causal graph。

---

## 4. Multimodal attribution 的真正 bottleneck 是 token ↔ physical source alignment

### 概念

OmniTrace 原始碼會先找 modality placeholder token boundaries：

```text
image token positions
vision token positions
audio token positions
text token positions
```

再將 token attribution 映射回來源區段。

真正 production Hermes 必須更進一步保存：

```text
Image
↓
Original pixels
↓
Resize / crop
↓
Patch grid
↓
Vision encoder tokens
↓
Projector / resampler
↓
LLM token positions

Audio
↓
Waveform sample range
↓
Frame / feature range
↓
Audio encoder token
↓
Projector
↓
LLM token position

Video
↓
Timestamp
↓
Sampled frame
↓
Image patch
↓
Vision token
↓
LLM token
```

### 為什麼重要

如果只知道：

```text
vision_token #882 influential
```

卻不知道它對應哪個 bounding box / original frame / timestamp，就無法做真正使用者可理解的 provenance。

新增：

```text
PhysicalSourceAlignment
├ original_artifact_id
├ transform_chain[]
├ physical_region
├ encoder_token_range
├ projected_token_range
├ llm_token_range
└ alignment_error
```

### 限制

Token pruning、resampling、spatial merge、temporal sampling 都會造成 many-to-one / one-to-many mapping，alignment 不能假設是 exact bijection。

---

## 5. Attribution 應被分級；只有 intervention-calibrated signal 才能逐步接近 enforcement

本輪最重要的新架構是：

# Attribution Safety Tier

```text
T0 TELEMETRY_ONLY
T1 CORRELATIONAL_HINT
T2 MODEL_INTERNAL_ATTRIBUTION
T3 PERTURBATION_VALIDATED
T4 COUNTERFACTUAL_REPLAY_VALIDATED
T5 CAUSALLY_CERTIFIED_SCOPE
```

### Tier 說明

#### T0 — Telemetry

例如：

```text
prompt contained field X
tool response included field Y
```

只能證明「存在於 execution」。

#### T1 — Correlational hint

例如 embedding similarity / semantic match。

適合 UI suggestion，不適合 security enforcement。

#### T2 — Model internal attribution

例如：

```text
attention
attention-gradient
gradient × input
FlashTrace-style influence
OmniTrace source score
```

可以用於：

```text
visual heatmap
candidate provenance edge
trace-slice prioritization
```

但仍不應單獨作為 irreversible permission decision。

#### T3 — Perturbation validated

```text
mask field
occlude image region
remove audio span
rerun model
observe output delta
```

比 attribution score 強，但 perturbation 可能造成 out-of-distribution input，因此仍需記錄 intervention semantics。

#### T4 — Counterfactual replay validated

使用前幾輪建立的 deterministic replay + minimal trace machinery：

```text
replace source field
freeze unrelated state
replay descendants
verify target claim/action change
```

這已可支援較高風險 diagnosis / audit。

#### T5 — Causally certified scope

需要清楚 assumptions、intervention model、confounders / redundancy handling 與 certificate scope。

### 核心 edge

```text
Attribution Confidence
≠ Enforcement Confidence
```

---

# Architecture Breakdown

```text
User / Text / Image / Audio / Video / DOM
↓
Canonical Source Artifact
↓
Physical Source Alignment
↓
Model Encoder / Processor
↓
Unified Token Timeline
↓
Generation-Time Attribution
├ attention
├ gradients
├ recursive reasoning attribution
└ semantic correlation
↓
Attribution Normalizer
↓
Influence Candidate Graph
↓
Intervention Planner
├ token mask
├ span removal
├ image region occlusion
├ audio interval ablation
├ memory replacement
└ tool-field replacement
↓
Replay / Re-execution Sandbox
↓
Outcome Delta Verifier
↓
Attribution Safety Tier
↓
InfluenceCertificate
↓
Claim Provenance / Permission / Trace Slicing
```

---

# Bottom-Level Logic

## A. Attention signal

```text
Q = XW_Q
K = XW_K
V = XW_V

A = softmax(QKᵀ / √d)

output = A V
```

注意：

```text
A[i,j] high
```

只表示在該 attention computation 中 token i 對 token j 的 value aggregation 權重高。

它不自動證明：

```text
remove j
→ prediction changes
```

因為 residual stream、MLP、other heads/layers 與 redundant tokens 都可能補償。

## B. Gradient attribution

```text
score_i ≈ ∂ target / ∂ input_i
```

它描述局部 sensitivity，不等於在有限 intervention 下的實際 outcome change。

## C. Occlusion / perturbation

```text
Δ_i = f(x) - f(x without i)
```

比 attention / gradient 更接近 intervention，但：

```text
x without i
```

可能不是自然分布上的合法 input。

## D. Counterfactual replay

Hermes 可使用：

```text
Original:
State + SourceField X
→ target claim C

Counterfactual:
Same replay-safe prefix
+ replace/mask X
+ freeze protected state
→ recompute descendants
→ C'
```

若：

```text
C' ≠ C
```

則 X 的 causal evidence 明顯比單純 attention score 強。

---

# Visual Simulation Idea

# Attribution Ladder × Multimodal Influence Microscope

使用者點選 final claim：

```text
「會議從 18:00 開始」
```

左側顯示所有可能來源：

```text
Text chunk A          0.11
Image region B        0.72
Audio 03:21–03:26     0.64
Memory field C        0.49
```

中間可切換 method：

```text
Attention
Gradient
Recursive attribution
Occlusion
Counterfactual replay
```

右側顯示同一來源在不同方法的強度：

```text
Image bbox #17

Attention          HIGH
Gradient           MEDIUM
Occlusion Δ        HIGH
Replay intervention HIGH

Safety Tier: T4
```

點 image bbox 後，直接看到 lineage：

```text
Original image
↓
Crop #4
↓
Patch (12,8)
↓
Vision token 884
↓
Projected token 3120
↓
Decoder steps 44–49
↓
Claim span 18:00
```

並可以按：

```text
MASK REGION
```

Hermes 只 replay descendants：

```text
Original claim: 18:00
Counterfactual: 19:00

Claim changed: YES
Tool decision changed: NO
Permission changed: NO
```

視覺上最重要的教育訊息：

```text
LOOKED AT
≠
INFLUENCED
≠
NECESSARY
≠
CAUSED
```

---

# Code / GitHub

## OmniTrace

Repo: https://github.com/UCSB-AI/OmniTrace

值得看的目錄：

```text
src/omnitrace/
├ backends/
├ core/
│  ├ generation.py
│  ├ curation.py
│  ├ text_chunking.py
│  └ types.py
├ modalities/
├ mapping/
├ audio_processing/
├ gradients.py
└ tracer.py
```

### `core/generation.py`

核心機制：

- `ATTENTION_METHODS = {attmean, attraw}`
- `GRADIENT_METHODS = {attgrads}`
- `aggregate_step_attention()` 把每個 generation step 的 attention 壓成 input-token attribution vector。
- `_attmean()`：跨 batch/head/query，再跨 layer mean。
- `_attraw()`：只取最後一層，再跨 batch/head/query mean。
- `find_source_boundaries()`：尋找 audio / vision / image placeholder token positions，建立 multimodal source region。

### `tracer.py`

`OmniTracer` 將同一 public API 分派至：

```text
trace_image_text
trace_audio
trace_video
```

這個 abstraction 很值得 Hermes 借用：

```text
InfluenceTracer
├ trace_text
├ trace_image
├ trace_audio
├ trace_video
├ trace_memory
└ trace_tool_field
```

## FlashTrace

Repo: https://github.com/wbopan/flashtrace

值得看的區域：

```text
flashtrace/
evaluations/
attribution_datasets.py
dump_exp2_hop_vh.py
```

Hermes 最值得借的是：

```text
multi-token target span
+
recursive reasoning attribution
```

而不是把每一個 output token 都當成完全獨立的 attribution task。

---

# Papers

## Paper 1 — OmniTrace: A Unified Framework for Generation-Time Attribution in Omni-Modal LLMs

- **Authors:** Qianqi Yan, Yichen Guo, Ching-Chen Kuo, Shan Jiang, Hang Yin, Yang Zhao, Xin Eric Wang
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2604.13073
- **Code:** https://github.com/UCSB-AI/OmniTrace
- **Models:** Qwen2.5-Omni-7B, MiniCPM-o-4.5-9B
- **Datasets:** Mantis-eval, MMDialog, CliConSummation, MMAU, MISP, Video-MME；論文總計 759 examples
- **Architecture:** generation-time token attribution → source unit mapping → semantic output chunking → confidence-aware source curation
- **Contribution:** 將 text / image / audio / video attribution 統一成 decoder-only open-ended generation tracing。
- **Limitations:** 底層 attribution signal 仍可能是 attention / gradients；ground-truth attribution 部分依 LLM-as-judge，雖有人類抽樣驗證。
- **改變了什麼:** 把 multimodal attribution 從 fixed-output / classifier explanation 推到 autoregressive generation-time source tracing。

## Paper 2 — Towards Long-Horizon Interpretability: Efficient and Faithful Multi-Token Attribution for Reasoning LLMs / FlashTrace

- **Authors:** Wenbo Pan, Zhichao Liu, Xianlong Wang, Haining Yu, Xiaohua Jia
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2602.01914
- **Code:** https://github.com/wbopan/flashtrace
- **Datasets:** RULER, MATH, MoreHopQA；公開 repo 亦包含 code-generation/VLM 評估路徑
- **Architecture:** span-wise aggregation + recursive attribution through reasoning spans
- **Contribution:** 長 reasoning chain 中讓 attribution 能由 final span 重新流回 original input，並大幅降低 multi-token attribution 成本。
- **Limitations:** attribution faithfulness 仍依 evaluation protocol；recursive attribution 不是正式 structural causal model。
- **改變了什麼:** 解決 long-output attribution 的 O(M×N) 效率與 reasoning-token attribution absorption 問題。

## Paper 3 — Ghost in the Agent: Redefining Information Flow Tracking for LLM Agents

- **Authors:** Yuandao Cai, Wensheng Tang, Cheng Wen, Shengchao Qin
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2604.23374
- **Dataset:** TaintBench，400 scenarios，20 agent frameworks；並測 InjecAgent / ToolEmu
- **Architecture:** execution trace audit + semantic evidence + causal reasoning + persistent-context tracking
- **Contribution:** 將 LLM Agent taint 從 literal data copying 擴充到 semantic transformation、decision influence、memory persistence。
- **Limitations:** offline audit；semantic / causal inference 仍需要 calibration，不能視為完美 ground truth。
- **改變了什麼:** Information flow 的定義從 program-memory propagation 擴張成 natural-language agent influence propagation。

---

# 已確認事實 / 工程實作 / 推論 / 假說分層

## 已確認事實

- OmniTrace 官方 code 確實實作 `attmean`、`attraw`、`attgrads` 三種 attribution 路徑。
- OmniTrace code 確實區分 image / vision / audio / text token positions。
- OmniTrace paper 的 pipeline 是 generation-time token attribution → source mapping → span aggregation。
- FlashTrace paper / repo 明確使用 multi-token attribution 與 recursive attribution。
- OpenTelemetry GenAI conventions 可記錄 model、token counts，並可選擇記錄 prompts / completions / tool arguments / results。

## 論文結果

- OmniTrace 報告在多個 image/audio/video tasks 上優於 self-attribution / embedding baselines。
- FlashTrace 報告長序列 attribution 超過 130× speedup，並改善 reasoning-chain faithfulness。
- NeuroTaint 報告對 Agent semantic information-flow detection 優於傳統 IFC-style baseline。

## 工程推論

- Hermes 應讓 attribution 先產生 Candidate Edge，再交給 perturbation / replay validator 升級 edge confidence。
- Permission gate 應基於 attribution safety tier，而不是只看 attention heatmap。

## 尚未驗證假說

- 是否可以為 production Agent 建立穩定的跨模型 `T4 Counterfactual Replay Validated` threshold。
- Attention/gradient/recursive attribution 是否可經少量 intervention calibration 後，形成便宜但可靠的 proxy estimator。
- Multimodal source alignment error 是否可以轉成 formal uncertainty budget，併入 permission decision。

---

# Unknown / Open Questions

## 1. Attribution estimator 要如何被 intervention 校準？

需要研究：

```text
raw attribution score
↓
random intervention sample
↓
observed outcome delta
↓
calibration curve
↓
P(causal-change | attribution score)
```

## 2. 多模態 transform chain 的 alignment uncertainty 如何傳遞？

例如：

```text
bounding box
→ resize
→ crop
→ patch merge
→ resampler
→ token
```

每一步都可能失真。

## 3. Security enforcement 需要哪個 attribution tier？

低風險 UI 解釋可以 T1/T2；privacy / irreversible tool write 可能至少應要求 T3/T4 或 deterministic policy rule，而不是單靠 neural attribution。

---

# 下一輪研究

下一輪應進入：

# Intervention Calibration × Attribution Benchmarks × Faithfulness Metrics × Causal Proxy Certificates

研究鏈：

```text
Attribution estimator
↓
Ground-truth synthetic dependency
↓
Controlled masking / replacement
↓
Counterfactual replay
↓
Sensitivity / specificity
↓
Calibration curve
↓
Method-by-domain reliability profile
↓
InfluenceCertificate
```

重點比較：

```text
Attention
Gradient × Input
Integrated Gradients
Occlusion
Leave-one-out
Attention rollout
Recursive attribution
Activation patching / causal tracing
Counterfactual replay
```

最重要問題：

> 哪一種方法只適合 explanation UI？哪一種可以當 trace slicing heuristic？哪一種經 calibration 後能進 safety decision？

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Generation-Time Attribution
Attribution Signal
Attention Attribution
Gradient Attribution
Recursive Attribution
Perturbation Attribution
Counterfactual Attribution
Attribution Safety Tier
Influence Candidate Graph
InfluenceCertificate
GenerationTimeAttributionRecord
PhysicalSourceAlignment
Alignment Uncertainty
Reasoning Attribution Absorption
RecursiveInfluencePath
Attribution Calibration Curve
Attribution Enforcement Threshold
Model-Internal Attribution
Perturbation-Validated Influence
Counterfactual-Replay-Validated Influence
```

## Edges

```text
Telemetry
≠ Attribution

Attribution
≠ Causal Influence

Attention Weight
≠ Causal Necessity

Gradient Sensitivity
≠ Finite Intervention Effect

Embedding Similarity
≠ Model Influence

Generation-Time Attribution
→ Better Aligns With Autoregressive Decoding

Reasoning Tokens
→ Can Absorb Attribution Mass

Recursive Attribution
→ Can Restore Source-Level Influence Path

Physical Source Alignment Error
→ Propagates Into Multimodal Attribution Uncertainty

Perturbation Validation
→ Strengthens Influence Claim

Counterfactual Replay Validation
→ Strengthens Causal Claim

Attribution Confidence
≠ Enforcement Confidence
```

---

# 每輪結束判定

**缺哪一層？**  
`Attribution Calibration / Faithfulness Certification Layer`。

**哪個節點最淺？**  
`AttributionCalibrationCurve`、`InfluenceCertificate`、`AlignmentUncertaintyPropagation`、`AttributionEnforcementThreshold`。

**哪個概念仍只是名詞？**  
Production 級 `Causally Certified Multimodal Influence`；目前還沒有一個通用 attribution score 能跨模型、跨 modality、跨 tool/runtime context 直接等同 causal certificate。

**哪個系統值得讀原始碼？**  
首選 OmniTrace：`core/generation.py → gradients.py → modalities/* → mapping/* → tracer.py`；其次 FlashTrace 的 recursive attribution / VLM token mapping。

**哪篇論文需追引用？**  
OmniTrace（omni-modal generation attribution）與 FlashTrace（long-horizon reasoning attribution）；下一輪需追它們引用的 faithfulness / attention rollout / gradient attribution / causal tracing benchmarks。

**哪個概念最適合視覺模擬？**  
`Attribution Ladder × Multimodal Influence Microscope`。

**哪個 Agent 架構最值得實作？**

```text
Canonical Source Artifact
↓
Physical Source Alignment
↓
Generation-Time Attribution
↓
Influence Candidate Graph
↓
Perturbation / Replay Validator
↓
Attribution Safety Tier
↓
InfluenceCertificate
↓
Claim Provenance + Trace Slicing + Permission Gate
```

---

# 對「AI 到底怎麼運作」新增的一層

上一輪已經能畫：

```text
Image region / Audio span / Tool field
→ token lineage
→ claim
```

本輪補上：

```text
Camera / Image / Voice / Video
↓
Encoder
↓
Physical source → token alignment
↓
Transformer decoding
↓
Attention / gradient / recursive attribution
↓
Candidate influence
↓
Perturbation
↓
Counterfactual replay
↓
Certified influence scope
↓
Agent action / claim / permission
```

真正成熟的 AI provenance 不能只回答：

> 「模型看了什麼？」

而要分層回答：

> 「哪些資訊存在於 context？」  
> 「哪些資訊模型內部高度 attribution？」  
> 「拿掉後哪些輸出會變？」  
> 「在 replay-controlled counterfactual 下哪些 decision 真正依賴它？」

這四層不能混成同一個 attribution heatmap。