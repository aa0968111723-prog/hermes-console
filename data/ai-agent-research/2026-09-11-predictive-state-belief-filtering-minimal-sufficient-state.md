# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-11 10:55–11:35 Asia/Taipei  
**主題**：Predictive State Representation × Belief State Filtering × State Aliasing × Minimal Sufficient State × Predictive Compression  
**承接上一輪**：`2026-09-11-latent-state-discovery-hybrid-regime-guard-induction.md`

---

## 0. 本輪與歷史研究比較：避免重複

上一輪已建立：

```text
Observation
→ Non-Markov Evidence
→ Latent State Hypothesis
→ State Expansion
→ Hybrid Mode
→ Guard / Reset
```

但仍留下核心缺口：如果每次發現 state 不足都直接加 history / latent / mode，最終會退化成：

```text
Entire History = State
```

這雖然可能降低 state aliasing，卻會造成 memory、context、planning、GPU/latency 成本持續膨脹。

因此本輪不再研究「如何增加 state」，而是研究相反問題：

> **如何把整段 action-observation history 壓縮成一個足以預測／控制，但又盡可能小的 information state？**

本輪新分界：

```text
Observation
≠ Hidden Physical State
≠ Belief State
≠ Predictive State Representation
≠ JEPA Latent
≠ Minimal Sufficient State
≠ Task-Sufficient State
```

---

# 本小時新發現

## 新論文 / 架構

1. **VJEPA: Variational Joint Embedding Predictive Architectures as Probabilistic World Models** — Yongchao Huang, 2026-01-20.  
   Source: https://arxiv.org/abs/2601.14354  
   核心：將 deterministic JEPA 推進成 predictive distribution；作者明確把 VJEPA 與 Predictive State Representations（PSR）及 Bayesian filtering 接起來，主張 latent 可以在不重建 pixels 的情況下形成控制所需的 sufficient information state。

2. **Your Probabilistic JEPA Is Secretly a Hidden Markov Model: A State-Space Interpretation of Joint-Embedding Predictive Learning** — Yongchao Huang, 2026-08-13.  
   Source: https://arxiv.org/abs/2608.13621  
   核心：將 stochastic context encoder 解讀為 amortized filtering distribution、probabilistic predictor 解讀為 latent Markov transition，並用 MCJEPA 討論 multi-horizon Chapman–Kolmogorov consistency。

3. **Next Embedding Prediction Makes World Models Stronger (NE-Dreamer)** — George Bredis, Nikita Balagansky, Daniil Gavrilov, Ruslan Rakhimov, 2026-03-03；公開頁面標示 T-Tech。  
   Paper: https://arxiv.org/abs/2603.02765  
   Project: https://corl-team.github.io/nedreamer/  
   Code: https://github.com/corl-team/nedreamer  
   核心：Dreamer/RSSM backbone + causal temporal transformer，以 next-embedding prediction 取代 pixel reconstruction 作為主要 representation objective，在 DMLab memory/navigation 任務上強化時間一致性。

4. **Sequential Knockoffs for Variable Selection in Reinforcement Learning (SEEK)** — Tao Ma, Jin Zhu, Hengrui Cai, Zhengling Qi, Yunxiao Chen, Chengchun Shi, Eric B. Laber 等，JASA 2026 in press。  
   DOI / paper: https://www.tandfonline.com/doi/abs/10.1080/01621459.2026.2658863  
   Code: https://github.com/Mamba413/SEEK  
   核心：定義 minimal sufficient state 為原 state 的最小 subvector，使 process 仍保持 MDP 且 reward function 不變，並用 sequential knockoffs 做高維 state variable selection。

5. **Predictive Representations for Skill Transfer in Reinforcement Learning** — Ruben Vereecken, Luke Dickens, Alessandra Russo, 2026-04-08.  
   Source: https://arxiv.org/abs/2604.07016  
   核心：Outcome-Predictive State Representations（OPSRs）用未來 outcome predictions 建立 task-independent abstraction，再用 option/skill 補 transfer 能力。

6. **UWM-JEPA: Predictive World Models That Imagine in Belief Space** — Santosh Kumar Radha, Oktay Goktas, 2026-05-25.  
   Source: https://arxiv.org/abs/2605.25313  
   核心：主張單一 vector latent 在 blind rollout 中不一定能保存 hidden-future uncertainty，改以 density-matrix latent 表示 belief-like structure；其 hidden-velocity experiment 顯示 predictor geometry 對 partial observability 重要。

7. **What Capable Agents Must Know: Selection Theorems for Robust Decision-Making under Uncertainty** — 2026-03.  
   Source: https://arxiv.org/abs/2603.02491  
   核心：從 decision/regret 角度證明，在某些 action-conditioned predictive task families 中，低 regret 迫使 agent internal state 保留特定 predictive distinctions，提供「能力會逼出 predictive internal state」的理論方向。

---

# 本小時最重要 5 個發現

## 1. Belief State 與 PSR 解決的是相似問題，但語義不同

### 是什麼

POMDP belief state 維持 hidden state 的 posterior：

```text
b_t(s)
=
P(s_t = s | o_1:t, a_1:t-1)
```

典型 Bayes filter：

```text
Previous belief b_{t-1}
+ action a_{t-1}
↓ prediction
P(s_t | history before o_t)
+ new observation o_t
↓ Bayes correction
b_t
```

而 Predictive State Representation 不必承諾 hidden physical state `s_t` 的 identity；它直接以「未來 tests/outcomes 的 predictions」表示 state：

```text
History h_t
↓
PSR state q_t
=
[P(test_1 | h_t), ..., P(test_k | h_t)]
```

### 底層如何運作

Belief-state view：

```text
History
→ posterior over latent causes
→ transition
→ emission likelihood
→ posterior update
```

PSR view：

```text
History
→ predictions of future observable action-observation tests
→ after action/observation
→ update predictive vector
```

### 為什麼重要

Hermes 不應把所有 memory compression 都叫「belief」。如果 Agent 無法定義可信 hidden-state ontology，PSR 類表示可能比「硬猜世界中存在一個 latent state」更可驗證，因為 predictive quantities 可以直接用未來 observations 反查。

### 限制

PSR 的 core tests 選擇與低維 factorization 本身仍是難題；belief state 如果 model misspecified，同樣會得到錯誤 posterior。

### 驗證狀態

- PSR 經典理論：已確認（Singh, James, Rudary, UAI 2004；亦被 VJEPA 2026 直接引用）。
- VJEPA 與 Bayesian filtering / PSR 的連結：論文理論主張，尚需更多獨立實證交叉驗證。

---

## 2. Minimality 不能只看「壓得多小」，必須同時測 Sufficiency

只做 compression：

```text
History H_t
→ tiny latent z_t
```

可能把關鍵變數一起刪掉。

只做 sufficiency：

```text
State = entire history
```

又失去 minimality。

因此 Hermes 的狀態學習應顯式維持兩個互相拉扯的目標：

```text
MINIMIZE retained information / state dimension / memory cost

subject to

P(Future | State, Action)
≈
P(Future | Full History, Action)
```

若是 control state，還需：

```text
Q*(State, Action)
≈
Q*(Full History, Action)
```

而 SEEK 提供另一種具體版本：在已存在的 high-dimensional MDP state variables 中，找最小 subvector，使 reduced process 仍保持 Markov property 且共享 reward function。

因此新增重要區分：

```text
Predictive Sufficiency
≠ Reward Sufficiency
≠ Control Sufficiency
≠ Planning Sufficiency
≠ Minimality
```

---

## 3. NE-Dreamer 證明「下一個 embedding」本身可以成為 state 壓縮的訓練訊號

### Architecture

NE-Dreamer 保留 Dreamer-style RSSM：

```text
Observation x_t
↓ encoder
embedding e_t
↓
RSSM
├ deterministic h_t
└ stochastic z_t
↓
feature f_t
```

新部分：

```text
[f_1, ..., f_t]
+ actions
↓
causal temporal transformer
↓
predict e_{t+k}
↓
stop-gradient encoder target
↓
Barlow Twins / cosine alignment
```

原始碼 `dreamer.py` 已確認不是只做 one-step：它對多 horizon `k` 逐一取 `embed[:, horizon:, :]` 當 target，使用 `discount ** k` 加權，並可選 cosine 或 Barlow Twins cross-correlation loss。

值得看的核心檔案：

```text
corl-team/nedreamer
├ dreamer.py          ← world-model / NE loss / imagination loop
├ networks.py         ← network blocks
├ models.py
├ distributions.py
├ buffer.py
├ configs/
└ posthoc_decoder.py  ← frozen latent representation diagnostics
```

### 為什麼重要

它提供一個非常工程化的答案：

> 不一定要把 pixels 全重建回來，才能逼 latent 記住時間上重要的資訊。

但是本輪特別新增警告：

```text
Next-Embedding Predictive
≠ Minimal Predictive State
```

因為 representation 仍可能保留大量冗餘，而且一個 encoder target 本身可能包含 task-irrelevant information。

---

## 4. State Aliasing 應從「像不像」改成「future distribution 是否被錯誤合併」

Hermes 之前容易把 state aliasing 想成：

```text
兩個 observation 很像
→ 可能 alias
```

更精確的定義應是：

如果兩段不同 histories `h_i, h_j` 被 encoder 壓成相同/近似 state：

```text
φ(h_i) ≈ φ(h_j)
```

但存在某 action / policy continuation，使：

```text
P(Future | h_i, actions)
≠
P(Future | h_j, actions)
```

那就是 decision-relevant aliasing。

所以需要新的 runtime test：

```text
Candidate compressed states
↓ nearest-neighbor / cluster pairs
↓
match current latent
↓
compare conditional future distributions
├ observation future
├ reward future
├ tool outcome
├ safety event
└ action success
↓
Aliasing Score
```

可定義工程 proxy：

```text
AliasRisk(z)
=
max_{h_i,h_j: φ(h_i)≈φ(h_j)}
D(
 P(Y_future | h_i, A),
 P(Y_future | h_j, A)
)
```

其中 `D` 可先用 KL / JS / Wasserstein / calibrated classifier distinguishability。

這比 reconstruction error 更接近 Agent 真正需要的 state correctness。

---

## 5. Probabilistic JEPA / HMM interpretation 把「latent」推進成可 filtering 的 information state

VJEPA 2026 的重要改變不是「又一個 JEPA variant」，而是把：

```text
point latent
```

推向：

```text
predictive distribution over latent state
```

而 2026-08 的 HMM interpretation 更明確提出：

```text
stochastic context encoder
≈ filtering distribution

probabilistic predictor
≈ latent Markov transition

emission/inverse target direction
≈ observation relation
```

MCJEPA 再把 predictor 換成 finite transition matrix，讓 multi-step rollout 可以檢查 Chapman–Kolmogorov composition：

```text
T(2 steps)
?=
T · T
```

這帶出 Hermes 很重要的新 verifier：

```text
One-step prediction good
≠ Multi-horizon state consistency
```

未來 world-state latent 應加入：

```text
TransitionCompositionCheck
```

驗證：

```text
p(z_{t+2}|z_t)
≈
∫ p(z_{t+2}|z_{t+1}) p(z_{t+1}|z_t) dz_{t+1}
```

否則 latent 雖然 one-step 準，長 horizon 可能根本不是 coherent dynamical state。

---

# Architecture Breakdown

本輪建議 Hermes 新增 **Predictive State Compiler**：

```text
Multimodal Observation Stream
├ text
├ image / video
├ audio
├ depth / 3D
├ tool result
├ MCP event
├ runtime telemetry
└ action trace
↓
History Buffer H_t
↓
History Encoder / Belief Filter
├ recurrent filter
├ RSSM
├ transformer memory
├ probabilistic JEPA
└ explicit Bayesian filter
↓
Candidate Information State Z_t
↓
Predictive Sufficiency Verifier
├ next observation
├ multi-horizon embedding
├ reward
├ tool outcome
├ safety event
└ goal progress
↓
State Aliasing Detector
↓
Minimality / Redundancy Analyzer
├ variable selection
├ information bottleneck
├ knockoff selection
├ ablation
└ bisimulation-like merging
↓
Task Sufficiency Gate
├ prediction
├ control
├ planning
├ safety
└ transfer
↓
State Certificate
↓
Versioned Agent State Registry
↓
Planner / Memory / Tool Router / World Model
```

這一層應位於：

```text
Raw Context / Memory
↓
Predictive State Compiler
↓
Reasoning / Planning
```

而不是讓 Planner 每次直接吞完整歷史。

---

# Bottom-Level Logic

## A. Bayesian belief filtering

離散 POMDP 的典型更新：

```text
prediction:
\bar b_t(s')
=
Σ_s T(s'|s,a_{t-1}) b_{t-1}(s)

correction:
b_t(s')
∝
O(o_t|s') \bar b_t(s')
```

真正底層流程：

```text
previous posterior
→ propagate through transition
→ predicted latent distribution
→ evaluate observation likelihood
→ multiply
→ normalize
→ new posterior
```

## B. Predictive state update

抽象表示：

```text
q_t = predictions of future tests
```

收到 action `a_t` 與 observation `o_{t+1}` 後：

```text
q_t
+ a_t
+ o_{t+1}
↓
update operator
↓
q_{t+1}
```

它不必把 `q_t` 解釋成世界中某個 hidden entity；只要它足以更新 future predictions。

## C. Minimal sufficient state selection

對 candidate state vector：

```text
X_t = [x1, x2, ..., xp]
```

尋找子集合 `S ⊂ {1..p}`：

```text
X_t^S
```

使：

```text
Future ⟂ removed variables
| X_t^S, Action
```

並維持 reward / policy-relevant structure。

SEEK 的 engineering pipeline 從 repository 可看到：

```text
trajectory dataset
↓
beta-mixing estimation / temporal dependence handling
↓
knockoff machinery
↓
variable-selection statistics
↓
selected state variables
↓
offline RL evaluation
```

目前 repo root 重要檔案：

```text
Mamba413/SEEK
├ simu.py
├ simu_K_select.py
├ simu_select_alpha.py
├ BetaMixingEst.py
├ AutoEncoder.py
├ utils.py
├ utils_batchRL.py
├ offline_train_eval.py
├ RealData-MIMIC3.py
└ beta-mixing/
```

`simu.py` 已確認使用 `knockpy`、`KnockoffFilter`、Gaussian-mixture beta-mixing estimation、Stable-Baselines3 DQN/PPO/TRPO 等；這不是單一 toy variable-selection script，而是把 temporal dependence、state selection 與 downstream policy evaluation 串在一起。

---

# Visual Simulation Idea

## **Predictive State & Memory Compression Lab**

### View 1：History → State

```text
Full History

O1 A1 O2 A2 O3 A3 ... O128
███████████████████████████
              ↓ COMPRESS

State z_t
[12 dims]
```

旁邊即時顯示：

```text
History tokens      12,480
State bytes          1,536
Compression ratio     98.7%
```

### View 2：Sufficiency vs Minimality Plane

```text
Predictive Sufficiency ↑
1.0 |          ● candidate C
    |       ● B
    |  ● A
    +----------------------→ State Size
```

讓使用者看到「越大不一定越好」。

### View 3：State Aliasing

兩段歷史：

```text
History A: door was unlocked 20 sec ago
History B: door was never unlocked

Current camera frame: SAME
Current latent:        almost SAME
```

但：

```text
Action: PUSH DOOR

Future A: opens       0.91
Future B: blocked     0.87
```

Console 顯示：

```text
STATE ALIASING DETECTED
JS divergence = 0.73
Missing predictive variable candidate:
lock_state / prior_tool_event
```

### View 4：Belief vs PSR

左邊：

```text
Belief State
P(hidden world state)
locked      .61
unlocked    .34
jammed      .05
```

右邊：

```text
Predictive State
P(open | push)        .39
P(click | turn)       .72
P(error | unlock)     .18
```

同一 history 用兩種 state semantics 呈現。

### View 5：Multi-horizon Consistency

```text
1-step rollout     PASS
2-step composition PASS
4-step             WARN
8-step             FAIL
```

直接可視化：

```text
Good next-state predictor
≠ coherent long-horizon state model
```

---

# Code / GitHub

## 1. corl-team/nedreamer

Repository: https://github.com/corl-team/nedreamer

值得讀：

```text
dreamer.py
networks.py
models.py
distributions.py
posthoc_decoder.py
configs/model/_base_.yaml
```

### 已確認原始碼行為

`dreamer.py`：

- same-timestep grounding head 可用 cosine / Barlow Twins。
- next-timestep branch 是 multi-horizon，而不是只預測 `t+1`。
- target `embed[:, horizon:, :]` 有 `.detach()`。
- horizon loss 使用 `discount ** k`。
- world model 後續仍執行 reward / continuation prediction與 latent imagination actor-critic。

工程意義：

```text
representation learning
與
planning/control imagination
```

仍在同一 runtime loop 中被共同優化。

## 2. Mamba413/SEEK

Repository: https://github.com/Mamba413/SEEK

值得讀：

```text
simu.py
BetaMixingEst.py
simu_K_select.py
simu_select_alpha.py
offline_train_eval.py
utils_batchRL.py
```

已確認：

- 使用 `knockpy` / `KnockoffFilter`。
- 顯式處理 trajectory temporal dependence，包含 beta-mixing estimation。
- downstream 使用 DQN / PPO / TRPO 等 policy evaluation 元件。

目前限制：repository 是 research code，尚未抽象成可嵌入 Agent Runtime 的 state-pruning API。

---

# Papers

## Paper A

**Title**: VJEPA: Variational Joint Embedding Predictive Architectures as Probabilistic World Models  
**Authors**: Yongchao Huang  
**Institution**: arXiv abstract metadata /本輪公開來源未可靠確認 affiliation，標記 `NOT VERIFIED`  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2601.14354  
**Code**: 本輪未確認官方 code repository  
**Dataset**: 論文摘要描述 noisy-environment experiment；完整 dataset mapping 待下一輪追 PDF  
**Architecture**: stochastic/predictive JEPA + variational objective + BJEPA Product-of-Experts prior  
**Contribution**: 將 predictive latent、PSR、Bayesian filtering、uncertainty-aware planning 放入同一 probabilistic JEPA framing。  
**Limitations**: 新理論架構；需要更多 large-scale embodied / multimodal benchmark 驗證。  
**改變了什麼**: JEPA latent 從 deterministic target regression 推向 belief-like predictive distribution。

## Paper B

**Title**: Your Probabilistic JEPA Is Secretly a Hidden Markov Model  
**Authors**: Yongchao Huang  
**Institution**: `NOT VERIFIED`  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2608.13621  
**Code**: 本輪未確認  
**Dataset**: controlled synthetic/state-space experiments  
**Architecture**: PIB-VJEPA ↔ filtering / transition / emission interpretation；MCJEPA transition matrix  
**Contribution**: 給 temporal probabilistic JEPA 一個明確 state-space semantics，並強調 transition composition。  
**Limitations**: 「JEPA = HMM」有層級與條件，不可把弱結構對應誤寫成任意 JEPA 都是 exact HMM。  
**改變了什麼**: 把 latent-prediction model 拉回 classical filtering/state-space theory 可驗證的語言。

## Paper C

**Title**: Next Embedding Prediction Makes World Models Stronger  
**Authors**: George Bredis, Nikita Balagansky, Daniil Gavrilov, Ruslan Rakhimov  
**Institution**: T-Tech（公開 paper index 標示）  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2603.02765  
**Code**: https://github.com/corl-team/nedreamer  
**Dataset / Benchmark**: DeepMind Control Suite、DeepMind Lab Rooms  
**Architecture**: Dreamer/RSSM + causal temporal transformer + next-embedding predictive alignment  
**Contribution**: decoder-free、temporal predictive representation objective，強化 partial-observation memory/navigation。  
**Limitations**: predictive embedding quality 不等於 minimality / calibrated belief；仍需 state-aliasing tests。  
**改變了什麼**: 從 reconstruct observations 改成保留「能支持未來 embedding」的 temporal information。

## Paper D

**Title**: Sequential Knockoffs for Variable Selection in Reinforcement Learning  
**Authors**: Tao Ma, Jin Zhu, Hengrui Cai, Zhengling Qi, Yunxiao Chen, Chengchun Shi, Eric B. Laber et al.  
**Institution**: 多機構；UCL repository 收錄，完整 author-affiliation mapping 本輪未逐一驗證  
**Year**: 2026 (JASA in press)  
**URL**: https://www.tandfonline.com/doi/abs/10.1080/01621459.2026.2658863  
**Code**: https://github.com/Mamba413/SEEK  
**Dataset**: simulation + MIMIC-III sepsis cohort workflow  
**Architecture**: sequential knockoffs + temporal-dependence handling + variable selection + RL evaluation  
**Contribution**: 給 minimal sufficient MDP state 一個統計 variable-selection formulation。  
**Limitations**: 主要處理現有 observed state variables 的選擇；不等於從 raw video/history 自動 invent latent state。  
**改變了什麼**: 從「state 越多越安全」改成「可統計檢驗地刪除與 Markov/reward 無關的 state variables」。

---

# 已確認事實 / 論文結果 / 工程實作 / 推論 / 假說

## 已確認事實

- NE-Dreamer 官方 repository 存在，核心 training code 位於 `dreamer.py`，並實作 multi-horizon next-embedding loss。
- SEEK 官方 repository 存在，包含 knockoff、beta-mixing、simulation 與 offline policy evaluation code。
- VJEPA、MCJEPA/HMM interpretation、NE-Dreamer、SEEK 均為 2026 公開研究。

## 論文結果

- NE-Dreamer 論文報告在 DMLab memory/navigation-heavy tasks 有顯著提升，DMC 不退步或略提升。
- SEEK 論文主張 large-sample selection consistency，且 variable selection 改善 downstream policy learning。
- VJEPA 主張其 representation 可成為 optimal control sufficient information state（在論文條件下）。

## 工程實作

Hermes 可先做：

```text
HistoryStateRecord
PredictiveStateVector
BeliefStateDistribution
StateSufficiencyScore
StateAliasingScore
StateMinimalityScore
TransitionCompositionScore
```

## 合理推論

如果 Hermes Console 的 Context Compiler 只做 token summarization，卻不測 future-conditional sufficiency，可能產生「語意看起來完整，但 decision state 已 alias」的 compressed memory。

## 尚未驗證假說

可以建立跨 text/tool/multimodal 的 Universal Predictive State ABI，使：

```text
LLM agent runtime
embodied robot runtime
browser/computer agent runtime
```

共享相同 sufficiency/aliasing verifier。這目前仍是架構假說，不是已存在標準。

---

# Unknown / Open Questions

## 1. 如何知道 state 已經「最小」？

局部 ablation 可以證明某一維可刪，但 global minimality 在 nonlinear multimodal representations 中仍非常難。

## 2. Predictive sufficient 對哪個 future？

```text
next token?
next image embedding?
next reward?
tool success?
safety outcome?
long-horizon goal?
```

不同 target 會得到不同 state。不存在單一「最小 state」而不指定 task/future family 的可能性很高。

## 3. Belief state 與 predictive latent 如何在 model misspecification 下校準？

上一輪已證明 model class 可能錯。本輪即使把 history 壓成 belief / PSR，如果 predictor 本身漏機制，compressed state 仍可能錯誤地合併 histories。

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Predictive State Representation
Predictive Information State
Belief State
Belief Filter
Filtering Distribution
Predictive Sufficiency
Control Sufficiency
Planning Sufficiency
Reward Sufficiency
State Minimality
Minimal Sufficient State
State Aliasing
Decision-Relevant Aliasing
Predictive Compression
History Encoder
Future Test
Core Test
Transition Composition
Chapman-Kolmogorov Consistency
State Sufficiency Certificate
State Compression Certificate
Aliasing Counterexample
Task-Specific State
Outcome-Predictive State Representation
```

## Edges

```text
History
--COMPRESSED_INTO→
PredictiveState

BeliefState
--POSTERIOR_OVER→
LatentState

PredictiveState
--PREDICTS→
FutureTest

CompressedState
--VERIFIED_BY→
SufficiencyTest

CompressedState
--FAILS_WITH→
AliasingCounterexample

StateVariable
--REMOVABLE_IF→
FutureConditionallyIndependent

PredictiveState
--CONDITIONS→
Planner

PredictiveState
--UPDATED_BY→
ActionObservationPair
```

## 否定 / Distinction Edges

```text
Observation ≠ Belief State
Belief State ≠ PSR
PSR ≠ Hidden Physical State
JEPA Latent ≠ Automatically Sufficient State
Predictive State ≠ Minimal Predictive State
Compression ≠ Sufficiency
Reconstruction Fidelity ≠ Predictive Sufficiency
Next-Step Accuracy ≠ Long-Horizon Consistency
Full History ≠ Minimal State
Small Latent ≠ Sufficient State
Same Latent ≠ Same Decision State
Markov Sufficiency ≠ Task Sufficiency
Predictive Sufficiency ≠ Control Sufficiency
```

---

# 下一輪研究

下一個最深缺口：

# **State Abstraction × Bisimulation × Task-Conditional Sufficiency × Memory Retention/Eviction Policy**

因為本輪已建立：

```text
History
→ predictive/belief state
→ aliasing test
→ minimality pressure
```

但還沒回答：

> 兩個不同 predictive states 到底在什麼條件下可以安全 merge？

下一輪應深入：

```text
State Pair
↓
Reward Equivalence
+
Action-Conditioned Transition Equivalence
↓
Bisimulation Metric
↓
Task Relevance
↓
Merge / Keep Separate
↓
Memory Retention Policy
↓
Eviction Certificate
```

並把它接回 Hermes 既有 Context Compiler：

```text
Raw memory
↓
Predictive state
↓
Bisimulation / task-equivalence
↓
retain / merge / summarize / evict
↓
context injection
```

優先追：

- bisimulation metrics for state abstraction
- successor representations / successor measures
- causal state representations
- task-conditioned state abstraction
- memory eviction under partial observability
- continual agent memory compression
- successor-flow representation (ICLR 2026)

---

# 本輪結束回答

**缺哪一層？**  
缺 `State Equivalence / Bisimulation`：知道 state 足夠後，還不知道哪些 states 可以安全合併。

**哪個節點最淺？**  
`Minimality`。目前 variable selection、IB、dimension compression 都只是不同近似，還沒有跨 neural multimodal agent 的通用 minimality certificate。

**哪個概念仍只是名詞？**  
`Universal Predictive State ABI`、`State Sufficiency Certificate`、`Cross-Modal Aliasing Score`。

**哪個系統值得讀原始碼？**  
第一優先 `corl-team/nedreamer` 的 `dreamer.py / networks.py / posthoc_decoder.py`；第二優先 `Mamba413/SEEK` 的 `simu.py / BetaMixingEst.py / offline_train_eval.py`。

**哪篇論文需追引用？**  
VJEPA → MCJEPA/HMM interpretation → classic PSR；以及 SEEK → state abstraction / sufficient MDP state literature。

**哪個概念最適合視覺模擬？**  
`Predictive State & Memory Compression Lab`，尤其 State Aliasing view。

**哪個 Agent 架構最值得實作？**  

> **Predictive-State Agent Runtime = Multimodal History Buffer + Belief/Predictive Filter + Multi-Horizon Sufficiency Verifier + State-Aliasing Detector + Minimality/Redundancy Pruner + Task-Sufficiency Gate + Versioned State Certificate + Planner/Memory Interface**

---

# 最終鏈條更新：「AI 到底怎麼運作」

目前可以把使用者／環境進入 Agent 後的 state 層補成：

```text
User / Camera / Voice / Video / Tool / MCP Event
↓
Raw Multimodal Observation
↓
Encoder / Tokenizer
↓
Observation Embeddings
↓
History Buffer
↓
Belief / Predictive Filter
↓
Minimal Predictive Information State
↓
State Aliasing + Sufficiency Verification
↓
Reasoning
↓
Planning
↓
Memory Retrieval / Tool Selection / MCP
↓
Model / World Model
↓
GPU Inference
↓
Action / Output
↓
New Observation
↓
State Update
↺
```

本輪最核心的推進：

> **成熟 Agent 不應把「記得很多」等同於「有好 state」。真正有用的 state，是把過去壓縮掉之後，仍保留所有會改變未來預測、決策、安全與控制結果的資訊；而任何被壓成同一 state、卻會導向不同 decision-relevant future 的歷史，都是必須被抓出的 state aliasing。**
