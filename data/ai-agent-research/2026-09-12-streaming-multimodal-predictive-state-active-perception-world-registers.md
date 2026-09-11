# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 05:52（Asia/Taipei）**  
**本輪主題：Streaming Multimodal Predictive State × Active Perception × World-State Registers × Cross-Modal Predictive Alignment × State-Update Budget**

## 與歷史研究比較：本輪刻意不重複什麼

上一輪已建立 `Core Predictive Test → Hankel/SVD → Predictive State → Decision Sufficiency`，缺口是如何把偏離散、偏 tabular 的 PSR 推進到 production 的 camera / audio / video / tool event streaming runtime。

本輪不再重講 Hankel rank、core-test linear independence 或 belief-state basics，而專門研究三個新的工程問題：

1. **Streaming sensory input 不能全部塞進 context**：Agent 應主動決定「何時看、看哪個 modality、看哪個時間片」。
2. **Multimodal predictive state 不能只是把 audio/video embedding 串接**：跨 modality prediction 本身必須成為 representation learning 約束。
3. **世界狀態不能永遠靠 observation history 隱式承載**：長時間、多 Agent、多視角 rollout 需要顯式 persistent state register，且 state update 與 visual generation 最好解耦。

因此本輪把上一輪的 `Predictive State Compiler` 升級為：

```text
Streaming Inputs
├ Camera / Video
├ Audio / Voice
├ Tool / MCP Events
├ Memory Events
└ External Effects
      ↓
Active Perception Policy
      ↓
Selective Multimodal Encoder
      ↓
Cross-Modal Predictive Alignment
      ↓
Persistent World-State Register
      ↓
Decision-Sufficient State
      ↓
Planner / Agent Loop
```

---

# 本小時新發現

## 新論文 / 新架構

### 1. Native Active Perception as Reasoning for Omni-Modal Understanding — OmniAgent

- **Authors:** Zhenghao Xing, Ruiyang Xu, Yuxuan Wang, Jinzheng He, Ziyang Ma, Qize Yang, Yunfei Chu, Jin Xu, Junyang Lin, Chi-Wing Fu, Pheng-Ann Heng
- **Institution:** CUHK / Alibaba-Qwen 等合作團隊
- **Year:** 2026, ICML 2026
- **URL:** https://arxiv.org/abs/2606.19341
- **Code:** https://github.com/HarryHsing/OmniAgent
- **Architecture:** POMDP-style Observation → Thought → Action；actions 為 `get_frames / get_audio / get_clip / answer`；每輪把 raw multimodal percept 壓成 persistent textual memory，再丟棄 raw media。
- **Contribution:** 把 video understanding 從「watch everything」改成 active perception；推理成本跟資訊需求而非 raw video duration 成長。論文報告 7B 模型在 LVBench 達 50.5%，高於 Qwen2.5-VL-72B 的 47.3%。
- **Limitations:** persistent memory 是 textual consolidation，未顯式維護可校準的 predictive state；若摘要漏掉之後才變重要的 evidence，資訊已被不可逆地丟棄。

### 2. MJEPA: A Simple and Scalable Joint-Embedding Predictive Architecture for Audio-Visual Learning

- **Authors:** Revant Teotia, Adrien Bardes, Michael Rabbat, Sumit Chopra, Matthew J. Muckley, Nicolas Ballas
- **Institution:** Meta FAIR / NYU 等
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2606.25225
- **Code:** paper 目前未提供官方 production code；需持續追蹤
- **Dataset:** AudioSet-2M / VideoMix-2M 等
- **Architecture:** single shared encoder + shared predictor；對 audio、video、joint AV 做 intra-modal masked prediction，同時加入 cross-modal prediction/alignment。
- **Contribution:** 證明「共用 encoder」本身不等於 multimodal synergy；沒有 cross-modal predictive objective 時甚至會負遷移，有 cross-modal prediction 才真正互相提升。
- **Limitations:** 主要仍是 representation pretraining，不是 online agent world-state runtime；沒有解決 active sensing、persistent memory、tool/action feedback。

### 3. Streaming Multi-Agent Autoregressive Diffusion Model with World State Registers — WorldWeaver

- **Authors:** Sicheng Mo, Yuheng Li, Ziyang Leng, Krishna Kumar Singh, Bolei Zhou
- **Institution:** UCLA + Adobe Research
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.21594
- **Code:** https://github.com/VAIL-UCLA/WorldWeaver
- **Architecture:** autoregressive video diffusion + persistent World State Registers (WSR) + Mixture-of-Transformers；register 會在每個 generated chunk 後更新，跨 agent / view 共用。
- **Supervision:** agent status、global BEV、scene text。
- **Contribution:** 把「世界狀態」從 pixel history 的隱式副產品變成 explicit persistent state tokens；對 multi-agent logical consistency 特別有價值。
- **Limitations:** 截至本輪查核，GitHub 只有 README/assets，README 明確寫 code/checkpoints coming soon，因此目前不能把論文結構視為已可直接重用的 runtime implementation。

### 4. Video = World + Event Stream — Wan Streamer v0.3

- **Year:** 2026-07-16
- **URL:** https://wan-streamer.com/v0.3/
- **Architecture idea:** 將 streaming video 拆成 persistent `World` 與 continuously changing `Event Stream`，以此做 general video pretraining 並支援 real-time full-duplex audio-visual interaction。
- **Engineering relevance:** 這提供 Hermes 一個比「每幀都是新 observation」更合理的 state abstraction：stable world context 與 high-frequency event delta 應分開保存與更新。
- **Limitations:** 目前公開資訊偏 project/paper level；尚不能僅由公開頁面驗證其完整 state ABI 與 training runtime。

---

# 本小時最重要 5 個發現

## 1. Streaming Multimodal Agent 的核心瓶頸不是 context window，而是「Observation Selection」

### 概念

如果 camera 30 FPS、audio 50-100 frames/sec，再加 tool/MCP/event telemetry，Agent 不可能把全部 raw stream 直接餵給 reasoning model。

因此真正 runtime 不是：

```text
Raw Stream → Context Window → LLM
```

而應是：

```text
Intent / Question
↓
Current Predictive State
↓
Perception Need Estimator
↓
Select Modality
↓
Select Time Range
↓
Select Resolution / Density
↓
Acquire Observation
↓
Encode + Consolidate
↓
State Update
↓
Next Decision
```

### 已確認工程實作

OmniAgent repo 的 `agent_system/` 已明確拆成：

```text
agent_system/
├ environments/
├ multi_turn_rollout/
└ reward_manager/
```

`environments/base.py` 定義 `reset()` / `step(text_actions)` 的 agent-environment boundary；`multi_turn_rollout/rollout_loop.py` 則真正整合 image/video/audio tensors、Qwen2.5-Omni RoPE position ids 與多輪 rollout。

repo 中明確出現的 active actions 包含：

```text
get_frames
get_audio
get_clip
answer
```

### 為什麼重要

這讓 Hermes 的「Multimodal Fusion Viewer」不能只畫 encoder attention；必須把 **perception action** 本身畫成 agent loop 的一等節點。

### 新 Knowledge Edge

```text
Perception
IS_A
Agent Action
```

而不是：

```text
Perception
IS_ONLY
Model Input
```

### 限制

OmniAgent 把 selected percept 最終壓成 textual memory；它證明 active perception 有效，但尚未證明 textual summary 是 decision-sufficient predictive state。

---

## 2. 「Shared Multimodal Encoder」≠「Multimodal State 已對齊」

### Bottom-Level Mechanism：MJEPA Cross-Modal Predictive Alignment

Audio path：

```text
waveform
↓
log-mel spectrogram
↓
2D convolution tokenizer
↓
audio tokens
```

Video path：

```text
frames
↓
tubelets (space × time)
↓
3D convolution tokenizer
↓
video tokens
```

再加入 modality + positional embedding，送進 shared encoder。

但真正關鍵不是 shared weights，而是 predictive constraints：

```text
Audio visible → predict Audio target
Video visible → predict Video target
AV visible    → predict AV target

Audio → Video representation
Video → Audio representation
Unimodal ↔ Joint AV representation
```

可抽象為：

```text
L_total
=
L_intra_audio
+ L_intra_video
+ L_joint
+ Σ L_cross_modal
```

論文的核心消融結論是：shared encoder 若沒有 cross-modal prediction，會低於 unimodal baselines；加入 cross-modal objectives 後才出現正 transfer。

### Hermes 的推論

所以 production multimodal predictive state 應驗證：

```text
Can audio predict future visual state?
Can vision predict future audio event?
Can tool event predict future screen state?
Can screen state predict expected tool outcome?
```

也就是把 modalities 從「並排特徵」提升為 **互相可驗證的 predictive tests**。

### 新否定關係

```text
Shared Encoder ≠ Cross-Modal Alignment
Feature Concatenation ≠ Predictive Fusion
High Retrieval Score ≠ Decision-Sufficient Multimodal State
```

---

## 3. Observation History ≠ Persistent World State；WorldWeaver 提供一個很重要的 architecture separation

標準 autoregressive video/world model 常是：

```text
frames_{t-k:t}
↓
Transformer / Diffusion
↓
next chunk
```

世界狀態被迫隱式存在 frame history 裡。

WorldWeaver 改成：

```text
Local Visual Tokens
        ↕
World State Registers
        ↕
Other Agent / Other View
```

每生成一個 chunk：

```text
Current Register R_t
+ Current Observation Chunk X_t
↓
State Update
↓
R_{t+1}
↓
condition next generation
```

register 另外被 agent status / BEV / scene text 監督，迫使 state token 不只記 texture，而要攜帶幾何、agent status 與 semantic state。

### 為什麼重要

這非常接近 Hermes 前幾輪一直缺的 `LatentRuntimeState ABI`。

Hermes 可以借用「register」概念，但不能直接把它當 opaque hidden vector；更合理的是：

```text
HermesWorldRegister
├ Predictive State
├ Tool / MCP State
├ Active Entities
├ Spatial / UI State
├ External Effect State
├ Agent Status
├ Uncertainty
├ Provenance
└ Last Verified Time
```

### 限制 / 驗證狀態

**已確認：**論文與 UCLA project page 都描述 WSR + MoT + multi-faceted supervision。  
**已確認：**GitHub repo 本輪只有 `README.md` 與 `assets/`。  
**尚未驗證：**實際 register update code、attention mask、KV/cache interaction、state-token commit semantics，因官方 code 尚未 release。

因此不能宣稱目前已讀到其核心 implementation。

---

## 4. Streaming state 應拆成 `World` 與 `Event Delta`，否則每次更新成本與 state drift 都會爆炸

Wan Streamer v0.3 的 `Video = World + Event Stream` 提供非常實用的 abstraction：

```text
World
├ scene layout
├ persistent people / objects
├ ambient acoustic condition
├ identity / voice characteristics
└ relatively stable context

Event Stream
├ motion
├ speech
├ tool event
├ UI mutation
├ object change
└ external action/effect
```

這可以直接轉成 Hermes Runtime：

```text
PersistentState W_t
+ EventDelta Δ_t
↓
State Transition
↓
W_{t+1}
```

而不是每次重新 summarize 整個 world。

### 底層優勢

- 減少 encoding / attention 成本；
- 更容易做 provenance：哪個 event 改了哪個 state field；
- 更容易做 causal attribution；
- 可以把 slow-changing world state 與 fast-changing event buffer 分層設定 TTL；
- 對 multi-agent shared state 更容易做 concurrency control。

### 新 Knowledge Edge

```text
Streaming Observation
DECOMPOSES_INTO
Persistent World + Event Delta
```

### 尚未驗證假說

對 Hermes 工具/GUI runtime，`World + Event` 分解是否優於完全 learned recurrent latent state，仍需實驗；它目前是強工程假說，不是已證明 universal optimal representation。

---

## 5. 下一代 Predictive State 需要新增「State Update Budget」，不只 Context Budget

前面我們一直追：

```text
Token Budget
Context Budget
Attention Budget
Probe Budget
```

這輪出現新的 bottleneck：

# State Update Budget

如果每個 camera/audio/tool event 都讓完整 predictive state 重新 encode，成本仍然不可接受。

因此 state update 應有 gating：

```text
Incoming Event e_t
↓
Novelty Score
+ Predictive Residual
+ Decision Relevance
+ Safety Relevance
↓
UPDATE FULL STATE?
├ NO → append event buffer / cheap delta update
└ YES → expensive multimodal predictive-state refresh
```

可定義：

```text
UpdateUtility(e)
=
α PredictiveResidual
+ β DecisionImpact
+ γ SafetyImpact
+ δ CrossModalNovelty
- λ ComputeCost
- μ LatencyCost
```

這把上一輪的 `Active Predictive Test Acquisition` 延伸到 streaming：

```text
不是每個 observation 都值得「看」
也不是每個看見的 observation 都值得「寫入核心 state」
```

這是 production Agent 非常重要但常被忽略的第二層 gating。

---

# Architecture Breakdown

本輪形成新的 Hermes architecture：

```text
User Goal / Question
↓
Planner
↓
Current Decision-Sufficient State
↓
Perception Policy
├ LOOK video
├ LISTEN audio
├ INSPECT UI
├ QUERY tool/MCP
├ READ memory
└ WAIT
↓
Selective Sensor / Tool Acquisition
↓
Modality Tokenizers
├ video tubelets
├ audio spectrogram tokens
├ text/tool-event tokens
└ structured state tokens
↓
Shared / Routed Multimodal Encoder
↓
Cross-Modal Predictive Heads
├ audio→video
├ video→audio
├ event→visual
├ action→effect
└ state→future event
↓
Event / World Splitter
├ persistent world
└ transient event delta
↓
World-State Register Manager
├ shared global register
├ agent-local register
├ uncertainty register
└ provenance register
↓
State Update Gate
↓
Decision-Sufficiency Auditor
↓
Planner / Tool / MCP Action
↓
External World
↺
```

這是目前最接近完整多模態鏈：

```text
Camera / Image / Voice / Video
→ selective acquisition
→ tokenizer / encoder
→ cross-modal predictive fusion
→ persistent world state
→ reasoning / planning
→ tool / MCP / action
→ new event
→ state update
```

---

# Bottom-Level Logic

## Cross-Modal Predictive Residual 作為 Streaming State Update 訊號

假設目前 state `s_t` 能預測：

```text
ŷ_video(t+1)
ŷ_audio(t+1)
ŷ_tool(t+1)
```

實際 observation 到達：

```text
y_video(t+1)
y_audio(t+1)
y_tool(t+1)
```

建立 residual：

```text
r_video = d(ŷ_video, y_video)
r_audio = d(ŷ_audio, y_audio)
r_tool  = d(ŷ_tool,  y_tool)
```

再算 cross-modal inconsistency：

```text
r_cross
=
 d(P(audio→video), observed_video)
+
 d(P(video→audio), observed_audio)
```

最後：

```text
StateUpdateScore
=
Σ w_m r_m
+ w_cross r_cross
+ w_goal GoalRelevance
+ w_safe SafetyRelevance
```

如果低於 threshold：

```text
cheap delta append
```

高於 threshold：

```text
full predictive-state refresh
+ active follow-up perception
```

這等於把 JEPA-style predictive error、PSR-style future tests、Agent active perception 合併成一個 runtime mechanism。

**注意：這是本輪提出的 Hermes 工程模型，不是上述任一論文原封不動的演算法。**

---

# Visual Simulation Idea

## Streaming Predictive State & Active Perception Lab

### 畫面 1：Live multimodal stream

```text
VIDEO  ██████████████████████████
AUDIO  ██████████████████████████
TOOLS        ▲       ▲    ▲
MCP          ▲          ▲
```

Agent 不全部讀取，而只亮出：

```text
05:42.0-05:46.0  get_clip
05:43.2-05:44.8  get_audio
05:45.1          tool_state
```

### 畫面 2：Cross-modal prediction matrix

```text
             target
           video audio tool effect
source video   ✓    0.81  0.37  0.52
       audio 0.74    ✓    0.18  0.26
       tool  0.31  0.12    ✓    0.91
```

若出現：

```text
Predicted audio: silence
Observed audio: glass breaking
Cross-modal residual: HIGH
```

畫面直接觸發：

```text
STATE REFRESH
+ REQUEST VIDEO ZOOM
```

### 畫面 3：World register vs Event stream

```text
WORLD REGISTER
├ room = kitchen
├ person_A = near sink
├ bowl_1 = counter
├ agent_goal = clean bowl
└ confidence = .92

EVENT STREAM
05:45.100 faucet_on
05:45.402 bowl_moved
05:45.810 speech_detected
```

拖曳時間軸即可看 register 被哪一個 event 更新。

### 畫面 4：State Update Budget

```text
Incoming events/sec        84
Cheap delta updates/sec    76
Full state refresh/sec      3
Ignored redundant events    5

GPU State Cost             18%
Context Cost               24%
Perception Cost            31%
```

讓使用者直接看到：「AI 並不是一直把所有世界資訊重新想一遍，而是在判斷什麼值得觀察、什麼值得升級進核心 state。」

---

# Code / GitHub

## HarryHsing/OmniAgent

URL: https://github.com/HarryHsing/OmniAgent

本輪確認值得看的目錄：

```text
agent_system/
├ environments/
│  ├ base.py
│  ├ env_manager.py
│  ├ env_package/
│  └ prompts/
├ multi_turn_rollout/
│  ├ rollout_loop.py
│  └ utils.py
└ reward_manager/

inference/
demo/
recipe/
```

核心工程點：

- `EnvironmentManagerBase.step(text_actions)`：把 model text action 投影到 environment action。
- `rollout_loop.py`：整合 image/video/audio tensor、multi-modal data、Qwen2.5-Omni position/RoPE index 與 trajectory data。
- repo search 可確認 `get_frames / get_audio / get_clip` 被真正納入 rollout / demo，而非 README-only pseudo tools。

## VAIL-UCLA/WorldWeaver

URL: https://github.com/VAIL-UCLA/WorldWeaver

本輪確認 repository root 目前只有：

```text
README.md
assets/
```

README 表示 code/checkpoints coming soon。

**因此本輪不虛構不存在的 `models/world_register.py` 等檔案。後續必須等官方 code release 後再追 attention/update implementation。**

---

# Papers

| Title | Year | Institution | Architecture | What changed | Limitation |
|---|---:|---|---|---|---|
| Native Active Perception as Reasoning for Omni-Modal Understanding | 2026 | CUHK / collaborators | POMDP OTA active perception | perception 變成 agent action，context cost 跟 information need 而非 video duration | textual consolidation 可能丟 predictive detail |
| MJEPA | 2026 | Meta FAIR / NYU | shared AV encoder + intra/cross-modal predictive objectives | shared encoder 必須配 cross-modal prediction 才有 positive transfer | 非 online agent runtime |
| WorldWeaver | 2026 | UCLA + Adobe Research | streaming video diffusion + WSR + MoT | persistent shared world state 從 observation history 中獨立出來 | code 尚未 release |
| Video = World + Event Stream | 2026 | Wan team | persistent world + streaming event decomposition | continuous video 改以 world/state + delta event 理解 | public implementation details 尚不完整 |

---

# Knowledge Graph 新增 Node / Edge

## New Nodes

```text
Streaming Predictive State
Active Perception
Perception Action
Observation Selection Policy
Multimodal Predictive Test
Cross-Modal Predictive Alignment
Cross-Modal Residual
World State Register
Shared World Register
Agent-Local Register
Event Stream
Persistent World
Event Delta
State Update Gate
State Update Budget
Multimodal State Refresh
Predictive Residual Trigger
State Commit
State Provenance
Perception Cost
```

## New Edges

```text
Perception Action
UPDATES
Predictive State

Cross-Modal Prediction
ALIGNS
Modality Representations

World State Register
PERSISTS_ACROSS
Time / Agent / View

Event Delta
UPDATES
Persistent World

Predictive Residual
TRIGGERS
State Refresh

Agent Goal
CONDITIONS
Observation Selection
```

## New Negative / Distinction Edges

```text
Watch Everything ≠ Better Understanding
Shared Encoder ≠ Cross-Modal Alignment
Feature Concatenation ≠ Predictive Fusion
Observation History ≠ Persistent World State
Text Summary ≠ Guaranteed Decision-Sufficient State
World-State Token ≠ Verified World Truth
Low Cross-Modal Loss ≠ Causal World Understanding
More Sensor Frames ≠ More Useful Information
Observation Acquired ≠ State Must Be Updated
Streaming Context Budget ≠ State Update Budget
```

---

# Unknown / Open Questions 1-3

## 1. World-State Register 怎麼驗證「真的表示 state」而不是另一組方便生成的 latent token？

需要：

```text
Register
↓
Counterfactual Probe
↓
Action-conditioned future prediction
↓
State intervention consistency
↓
Decision / safety preservation
```

也就是必須把上一輪 Decision-Sufficiency Certificate 接到 learned register。

## 2. Cross-modal predictive alignment 遇到 modality conflict 時，誰應該被相信？

例如：

```text
Video predicts silence
Audio detects explosion
Tool telemetry says no event
```

需要做 modality reliability posterior，而不是 average fusion。

## 3. Active perception 與 state update 是否應用同一個 utility function？

目前較合理的假說是兩階段：

```text
PerceptionUtility
→ 要不要花成本取得 observation

UpdateUtility
→ 已取得的 observation 是否值得寫進核心 state
```

但兩者是否可 joint-optimize，仍未驗證。

---

# 下一輪研究

下一輪最值得深入：

# **Multimodal State Reliability × Sensor Conflict × Learned State Registers × Streaming State Commit / Rollback**

研究鏈：

```text
Video / Audio / Tool / Memory Observations
↓
Per-Modality Reliability Estimator
↓
Conflict Detector
↓
Predictive Residual Attribution
↓
Register Update Proposal
↓
State Commit Gate
├ ACCEPT
├ PARTIAL UPDATE
├ VERIFY
└ ROLLBACK
↓
Versioned World-State Register
↓
Decision-Sufficiency Recheck
```

應優先追：

1. WorldWeaver 官方 code/checkpoint 是否 release；一旦 release，讀真正的 register attention/update path。
2. MJEPA 是否釋出 official code；若有，追 tokenization、shared encoder、cross-modal predictor 與 loss composition。
3. multimodal sensor conflict / uncertainty calibration / modality reliability gating。
4. streaming state-space / recurrent world models如何處理 state overwrite、memory corruption、rollback。
5. 研究一個可直接落地的 `VersionedWorldStateRegister` 資料結構，接 Hermes Console visual simulator。

---

# 本輪結束檢查

- **缺哪一層：** Multimodal State Reliability + State Commit/Rollback。
- **哪個節點最淺：** `StateUpdateGate`；目前有 utility 形式，但缺經驗校準與 formal validity。
- **哪個概念仍只是名詞：** `Decision-Sufficient World Register`、`VersionedWorldStateRegister`、`CrossModalReliabilityPosterior`、`StateCommitCertificate`。
- **哪個系統值得讀原始碼：** OmniAgent 已可讀，優先 `agent_system/multi_turn_rollout/rollout_loop.py`、`environments/`、video prompt/tool path；WorldWeaver 等 code release 後立即排第一優先。
- **哪篇論文需追引用：** MJEPA（multimodal predictive alignment）與 WorldWeaver（explicit persistent world state）最值得沿 citation graph 往下追。
- **哪個概念最適合視覺模擬：** `Streaming Predictive State & Active Perception Lab`。
- **哪個 Agent 架構最值得實作：** `Active-Perception Predictive-State Runtime`。

## 最值得 Hermes 實作的架構

> **Active-Perception Predictive-State Runtime = Observation Selection Policy + Multimodal Tokenizer/Encoder + Cross-Modal Predictive Alignment + World/Event Splitter + Persistent World-State Registers + Predictive-Residual Update Gate + Decision-Sufficiency Auditor + Planner/Tool/MCP Loop。**

本輪真正補上的底層觀念是：

> **多模態 AI 的問題不只是「如何把圖片、聲音、影片塞進同一個 Transformer」。真正的 Agent runtime 必須連續回答三個問題：現在值得看什麼？看完後它是否改變我對世界的 predictive state？如果改變，哪些資訊值得正式 commit 成下一步決策會依賴的世界狀態？**
