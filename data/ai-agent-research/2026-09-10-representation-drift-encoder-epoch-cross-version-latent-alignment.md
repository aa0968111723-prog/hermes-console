# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-10 23:51 Asia/Taipei

## 本小時新發現

本輪承接上一輪 Event Representation × Semantic Channelization，專門處理其明確留下的缺口：Representation Drift × Encoder Epoch × Cross-Version Latent Alignment × Semantic Anchor Calibration。核心問題不是「兩個 embedding 看起來像不像」，而是：當 VLM、embedding、ASR、tool schema、ontology 或 multimodal encoder 被升級後，歷史 state、knowledge graph、memory、risk trace 與 dynamic gain matrix 是否仍然可以被正確比較。

本輪新增重點來源：
1. Multi-Way Representation Alignment (Achara et al., 2026)：GPA/GCCA/GCPA 將多個獨立模型映射至共同 universe，並明確區分 geometry preservation 與 retrieval agreement。
2. The Triangle of Similarity (Sirikova & Chan, 2026)：representation similarity 不應只看單一指標，而應同時觀察 static representation、functional behavior、sparsity/robustness。
3. CARL: Preserving Causal Structure in Representation Learning (ICLR 2026)：跨模態 alignment 若只追 statistical similarity，可能破壞 conditional independence、mediator、Markov boundary 等因果結構。
4. LatentUMM (2026)：共享 latent space 本身不足以保證 understanding ↔ generation 的雙向一致；modality transition 會發生 semantic drift。
5. DecAlign (ICLR 2026)：跨模態 alignment 應區分 modality-common 與 modality-specific feature，而不是將所有 representation 強制壓進同一幾何結構。

## 本小時最重要 5 個發現

### 1. Encoder Version Change ≠ Semantic Change

**已確認事實 / 工程事實：** 不同模型即使處理相同樣本，也可能使用不同 latent basis、維度、scale 與 geometry，因此 raw vector 不可直接逐維比較。

底層：

```text
Same semantic object x
↓
Encoder E_v1(x) = z1 ∈ R^d1
Encoder E_v2(x) = z2 ∈ R^d2

z1 != z2
```

因此 Hermes 不應把 embedding delta 直接視為 semantic drift：

```text
||z2 - z1|| large
≠
meaning changed
```

應先建立版本映射或 shared anchor space：

```text
Anchor Set A
↓
E_v1(A), E_v2(A)
↓
Alignment Mapper M_v1→v2
↓
Aligned historical state
↓
Semantic drift test
```

**為什麼重要：** 如果 Hermes 的 Memory Brain、Knowledge Graph、RAG cache、risk model、G_t 都依賴 embedding，模型一升級就可能產生「假的歷史斷裂」。

**限制：** 對 nonlinear、dimension-changing、modality-changing representations，單一線性 mapper 可能不足。

### 2. Geometry Similarity ≠ Functional Equivalence

CKA / Procrustes 可以測 representation geometry，但不能單獨證明兩模型做出同樣決策。2026 Triangle of Similarity 將 static representation similarity、functional similarity 與 sparsity/robustness 視為互補面向。

因此 Hermes 的 Encoder Migration Gate 應至少拆成：

```text
Representation Compatibility
├ geometric similarity
├ neighbor/retrieval preservation
├ downstream functional equivalence
├ calibration preservation
├ causal-structure preservation
└ modality-specific information preservation
```

也就是：

```text
High CKA
≠ Same Agent Behavior

Low raw cosine
≠ Semantic incompatibility
```

### 3. Pairwise Alignment ≠ Stable Multi-Version Universe

若 Hermes 每次升級都只建立 pairwise bridge：

```text
v1 → v2
v2 → v3
v3 → v4
```

長期會造成 transformation chain error、cycle inconsistency 與 anchor fragmentation。

Multi-Way Representation Alignment 2026 提出將多個 representation spaces 對齊至共同 universe。其官方 repository 的 `src/cycloreps/translator/` 已包含 `gpa.py`、`gcca.py`、`linear_ortho.py`、`ortho.py`、`translator.py`。`gpa.py` 實際以每個 view 的 orthogonal rotation 建立 consensus，並可加上一個 geometry-correction MLP；`to_universe()` / `_from_universe_impl()` 提供進出 universe 的明確介面。

對 Hermes 更好的版本架構應是：

```text
Encoder Epoch v1 ─┐
Encoder Epoch v2 ─┼→ Canonical Semantic Universe
Encoder Epoch v3 ─┤
VLM Epoch v4 ─────┘
```

而不是一直串 bridge。

### 4. Statistical Alignment ≠ Causal Preservation

CARL (ICLR 2026) 指出，cross-modal representation mapping 即使統計上對齊，也可能引入 spurious dependency 或消除重要 mediator；其方法加入 conditional-independence preservation、information bottleneck、monotonic alignment consistency 與 Markov-boundary preservation。

因此若 Hermes 未來用 aligned latent 做：

```text
Evidence Root
→ Belief
→ Causal Risk Graph
→ Dynamic G_t
```

alignment 本身若破壞 causal topology，後面的 causal graph 會被 representation layer 污染。

本輪新增工程原則：

```text
Alignment Accepted
=
Geometry Pass
AND Functional Pass
AND Anchor Pass
AND Causal-Structure Pass (when causality is used)
```

此式屬 Hermes 工程建模，不是既有論文標準公式。

### 5. Cross-Modal Shared Space ≠ Lossless Semantic Space

DecAlign 與 CodeBind 類方向都顯示 multimodal representation 同時包含 shared semantics 與 modality-specific information。若 Hermes 為了版本相容，把 Camera/Audio/Depth/Text 全部強制投影到一個單一 shared vector，可能遺失 depth、timing、prosody、texture、spatial relation 等 modality-unique signal。

因此建議：

```text
CanonicalState
├ Shared Semantic Core
├ Modality-Specific Residual
├ Encoder-Epoch Adapter
└ Provenance / Anchor IDs
```

而不是：

```text
All Modalities
→ One Vector
→ discard originals
```

## Architecture Breakdown

### Hermes Representation Compatibility Plane

```text
Raw Observation / Memory / Tool Result
↓
Versioned Encoder
↓
Encoder Epoch Registry
├ model_id
├ model_hash
├ tokenizer/preprocessor
├ dimension
├ modality
├ training/domain metadata
└ active_from/to
↓
Anchor Sampler
├ stable semantic anchors
├ hard negatives
├ boundary cases
├ modality-specific anchors
└ OOD anchors
↓
Representation Probe
├ CKA
├ Procrustes residual
├ neighborhood preservation
├ retrieval consistency
├ functional probes
├ calibration probes
└ causal probes
↓
Alignment Router
├ Identity
├ Orthogonal Procrustes
├ GPA
├ GCCA
├ GCPA
├ learned adapter
└ NO SAFE ALIGNMENT
↓
Canonical Semantic Universe
├ shared semantic core
└ modality-specific residual
↓
Migration Validator
↓
Representation Compatibility Certificate
↓
Historical State / KG / Memory / G_t Migration
```

### Encoder Epoch

```text
EncoderEpoch
├ epoch_id
├ encoder_family
├ model_version
├ weights_hash
├ tokenizer_hash
├ preprocessor_hash
├ output_dim
├ normalization
├ modality
├ schema_version
├ anchor_set_version
├ alignment_mapper_id
├ calibration_profile_id
├ active_from
└ retired_at
```

關鍵原則：同一 `semantic_channel` 不代表同一 latent coordinate system，因此 Event Envelope 需要把 `encoder_epoch` 升級成一級 lineage 欄位。

## Bottom-Level Logic

### Orthogonal Procrustes

對 matched anchors：

```text
X = old encoder anchor matrix
Y = new encoder anchor matrix
```

尋找：

```text
R* = argmin_R ||XR - Y||²_F
subject to RᵀR = I
```

典型解法：

```text
XᵀY = UΣVᵀ
R* = UVᵀ
```

作用：保留旋轉/反射下的幾何結構，不允許任意 nonlinear warping。

限制：若新模型改變 semantic topology，而不只是 latent basis，低 Procrustes residual 不一定存在；強行 alignment 會掩蓋真實 migration incompatibility。

### CKA

底層：

```text
Anchor samples
↓
Old activations X
New activations Y
↓
Gram matrices / HSIC
↓
Normalization
↓
CKA score [0,1]
```

Linear CKA 對 orthogonal transform 與 isotropic scaling 具有 invariance，因此適合檢查「basis 改了，但關係結構是否仍近似」。但它仍不是 downstream behavioral certificate。

### Cross-Version Migration

```text
Historical state z_old
↓
Read encoder_epoch_old
↓
Find compatibility certificate(old,new)
↓
Mapper old→canonical
↓
z_canonical
↓
Optional canonical→new
↓
z_new_proxy
↓
Functional / neighbor / calibration validation
↓
ACCEPT / DUAL-READ / RE-ENCODE / QUARANTINE
```

建議 migration policy：

```text
HIGH compatibility
→ map lazily on read

MEDIUM compatibility
→ dual read + background re-encode

LOW compatibility
→ retain separate epoch namespace

UNKNOWN
→ never silently merge
```

## Visual Simulation Idea

# Representation Drift & Encoder Epoch Lab

主畫面把同一批 Semantic Anchors 同時投影到 v1、v2、canonical universe：

```text
Encoder v1                 Encoder v2
  ● cat                       ▲ cat
 ● dog                       ▲ dog
        \                    /
         \                  /
          Canonical Universe
             ● cat
             ● dog
```

切換面板：

```text
RAW SPACE
PROCRUSTES ALIGNED
GPA UNIVERSE
GCPA UNIVERSE
FUNCTIONAL PROBE
CAUSAL PROBE
```

每次模型升級顯示：

```text
Epoch v7 → v8

CKA                  0.91
Procrustes residual  0.08
Top-10 neighbor      94%
RAG retrieval        97%
Tool-routing match   91%
Calibration drift    +0.07 ECE
Causal anchor pass   82%

Status:
DUAL-READ REQUIRED
```

最適合教學的案例：

```text
CKA = HIGH
Retrieval = HIGH
Tool Routing = LOW
```

UI 顯示：

`REPRESENTATION LOOKS SIMILAR, FUNCTION CHANGED`

另一案例：

```text
Raw cosine = LOW
Procrustes-aligned cosine = HIGH
```

UI 顯示：

`COORDINATE SYSTEM CHANGED, SEMANTICS MOSTLY PRESERVED`

## Code / GitHub

### acharaakshit/multiway-alignment
值得持續閱讀：

```text
src/cycloreps/translator/
├ gpa.py       # GPA / GCPA universe alignment
├ gcca.py      # agreement-maximizing shared basis
├ linear_ortho.py
├ ortho.py
└ translator.py

src/scripts/exps/
config/alignment.yaml
metadata/
```

已驗證 `gpa.py` 的核心實作：
- 對每個 space 保存 `R_out` orthogonal map。
- 由各 view unit directions 建 consensus。
- 迭代以 SVD 更新每個 view 的 rotation。
- `to_universe` 將 encoder-specific representation 轉入共享 universe。
- GCPA 可在 GPA 後加入 gated MLP correction，但仍保留 geometry-preservation 控制。

這比 README 層級更接近 Hermes 未來可實作的 `RepresentationMapper` runtime abstraction。

### CKA implementations
工程上可參考 `ryusudol/Centered-Kernel-Alignment` 或其它 PyTorch CKA implementation 做大量 anchor layer similarity，但不應把第三方 CKA score 當 production compatibility certificate；需要 Hermes 自己的 semantic/function probes。

## Papers

### 1. Multi-Way Representation Alignment
- Title: Multi-Way Representation Alignment
- Authors: Akshit Achara, Tatiana Gaintseva, Mateo Mahaut, Pritish Chakraborty, Viktor Stenby Johansson, Melih Barsbey, Emanuele Rodolà, Donato Crisostomi
- Year: 2026
- Code: https://github.com/acharaakshit/multiway-alignment
- Architecture: Pairwise Procrustes / GPA / GCCA / GCPA shared universe
- Dataset/Tasks: CIFAR-100, Market-1501, Flickr8k multimodal retrieval 等
- Contribution: 從 pairwise mapper 推進到 scalable multi-space universe，並顯式平衡 geometry preservation 與 consensus/retrieval agreement。
- Limitations: matched anchors/sample ordering 仍很重要；geometry-corrected mapping 不等於 causal/functional equivalence。
- 改變了什麼: 提供 Encoder Epoch 不必 pairwise chain migration 的實作方向。

### 2. The Triangle of Similarity: A Multi-Faceted Framework for Comparing Neural Network Representations
- Authors: Olha Sirikova, Alvin Chan
- Year: 2026
- Architecture: CKA/Procrustes + functional similarity + sparsity similarity
- Testbeds: CNNs, ViTs, VLMs；ImageNetV2 / CIFAR-10 等
- Contribution: representation comparison 應是多面向，不應由一個 similarity scalar 決定。
- Limitations: similarity framework 仍不是 production migration protocol。
- 改變了什麼: Hermes compatibility certificate 必須同時測 representation 與 function。

### 3. CARL: Preserving Causal Structure in Representation Learning
- Venue: ICLR 2026
- Year: 2026
- Architecture: conditional-independence preservation + information bottleneck + monotonic alignment + Markov-boundary preservation
- Contribution: 指出跨模態 latent alignment 會引入 representation-induced structural drift，並把 causal invariance 納入 alignment objective。
- Limitations: 需要適合的 causal assumptions / structure probes；難直接套用所有黑箱 commercial model。
- 改變了什麼: 對 Hermes 因果 Knowledge Graph 而言，latent compatibility 不只要保 geometry，也要檢查 causal semantics。

### 4. LatentUMM: Dual Latent Alignment for Unified Multimodal Models
- Authors: Yinyi Luo, Wenwen Wang, Hayes Bai, Marios Savvides, Jindong Wang
- Year: 2026
- Architecture: cross-modal latent alignment + bidirectional capacity consistency
- Contribution: 指出 understanding → latent → generation → re-encoding 可產生 semantic drift，即使模型共享 latent space。
- Limitations: 主要處理 unified multimodal model 內部一致性，不等同跨 vendor encoder migration。
- 改變了什麼: Hermes 的 multimodal alignment 需要 round-trip consistency probe。

### 5. DecAlign: Hierarchical Cross-Modal Alignment for Decoupled Multimodal Representation Learning
- Venue: ICLR 2026
- Authors: Chengxuan Qian, Shuo Xing, Shawn Li, Yue Zhao, Zhengzhong Tu
- Year: 2026
- Architecture: modality-unique/common decomposition + prototype-guided optimal transport + MMD + multimodal transformer
- Contribution: alignment 不應消滅 modality-specific information。
- Limitations: task-level multimodal training framework，不是 runtime version migration 系統。
- 改變了什麼: Hermes Canonical State 應採 shared-core + modality-residual，而不是單一向量。

## 與歷史研究比較

前幾輪已建立：

```text
Event Envelope
→ Temporal Semantics
→ Semantic Channel
→ State Representation
→ Lag Discovery
→ Dynamic G_t
```

本輪補上其中之前被默認為固定的 `State Representation`：

```text
State Representation
↓
Encoder Epoch
↓
Compatibility Probe
↓
Semantic Anchor Alignment
↓
Canonical Universe
↓
Version-Aware State
```

因此歷史研究中的 `Dynamic G_t` 也必須升級成：

```text
G_t^{epoch}
```

若 encoder epoch 跨界但沒有 compatibility certificate，不應把 edge-weight change 解讀成真正 system dynamics change。

## Unknown / Open Questions

1. 如何建立不依賴單一模型、可跨 text/image/audio/video/depth 的 Canonical Semantic Anchor Set？
2. 如何區分「真實世界概念變了」與「encoder geometry 漂移」？需要哪些 control anchors / negative controls？
3. 當 alignment mapper 本身是 learned nonlinear model 時，如何避免 mapper hallucinate semantics 或破壞 causal structure？

## Knowledge Graph 新增 Node / Edge

新增 Nodes：

```text
Representation Drift
Encoder Epoch
Encoder Epoch Registry
Cross-Version Alignment
Canonical Semantic Universe
Semantic Anchor
Anchor Set Version
Alignment Mapper
Representation Compatibility Certificate
Geometry Compatibility
Functional Compatibility
Causal Compatibility
Round-Trip Consistency
Procrustes Alignment
Generalized Procrustes Universe
GCPA Correction
CKA Similarity
Neighborhood Preservation
Modality-Specific Residual
Representation Epoch Boundary
Alignment Failure
Dual-Read Migration
Re-Encode Migration
```

新增 Edges：

```text
Encoder Epoch
→ produces
Representation Space

Semantic Anchor Set
→ calibrates
Alignment Mapper

Alignment Mapper
→ maps_to
Canonical Semantic Universe

Compatibility Certificate
→ authorizes
Historical State Migration

Representation Epoch Boundary
→ invalidates_without_certificate
Direct State Comparison

Shared Semantic Core
→ coexists_with
Modality-Specific Residual

Cross-Version Alignment
→ must_preserve_when_required
Causal Structure
```

新增否定關係：

```text
Embedding Delta ≠ Semantic Drift
High CKA ≠ Functional Equivalence
Low Raw Cosine ≠ Semantic Incompatibility
Pairwise Alignment ≠ Stable Multi-Version Universe
Shared Latent Space ≠ Bidirectional Semantic Consistency
Statistical Alignment ≠ Causal Preservation
Cross-Modal Alignment ≠ Lossless Modality Preservation
Same Semantic Channel ≠ Same Encoder Coordinate System
Alignment Mapper ≠ Ground Truth
```

## 下一輪研究

下一個最深缺口：

# Anchor Governance × Semantic Identity × Concept Drift × Ontology Migration

因為即使 Encoder Epoch 已能對齊，仍存在更高層問題：

```text
Anchor "agent"
2024 meaning
≠
2026 meaning?
```

以及：

```text
Tool ontology v1
→ schema migration
→ ontology v2
```

有些 drift 不是 representation drift，而是概念本身、工具語義、權限與世界 ontology 真正改變。

下一輪應深入：

```text
Canonical Entity Identity
Semantic Anchor Governance
Concept Drift Detection
Stable / Mutable Anchors
Ontology Version Graph
Schema Evolution
Entity Split / Merge
Relation Migration
Temporal Knowledge Graph
Anchor Provenance
Negative-Control Anchors
Drift Attribution
```

## 本輪結束回答

- **缺哪一層：** Semantic Identity / Anchor Governance / Ontology Migration。
- **哪個節點最淺：** nonlinear cross-version mapper 的 causal preservation validation。
- **哪個概念仍只是名詞：** Universal Cross-Modal Canonical Semantic Universe ABI。
- **哪個系統值得讀原始碼：** `acharaakshit/multiway-alignment` 的 `src/cycloreps/translator/gpa.py`、`gcca.py`、`translator.py` 與 geometry sweep experiments。
- **哪篇論文需追引用：** Multi-Way Representation Alignment、CARL、Triangle of Similarity。
- **哪個概念最適合視覺模擬：** Representation Drift & Encoder Epoch Lab。
- **哪個 Agent 架構最值得實作：** `Version-Aware Representation Runtime = Encoder Epoch Registry + Anchor Sampler + Multi-Metric Compatibility Probe + Canonical Semantic Universe + Dual-Read/Re-Encode Migration Gate`。

本輪核心結論：**AI 系統的「記憶」與「狀態」不能只保存 embedding vector；還必須保存它是由哪個 encoder epoch、哪套 preprocessing、哪個 anchor/calibration universe 產生。否則模型一升級，系統會把座標系變化誤認成世界變化，進而污染 RAG、Knowledge Graph、Memory、因果圖與 Agent 安全判斷。**