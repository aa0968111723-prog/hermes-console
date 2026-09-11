# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 02:56（Asia/Taipei）**  
**本輪主題：Hidden-State Dependence × Belief-State Engine × HMM/HSMM × State Aliasing × Active Measurement × Dynamic Intervention Scheduling**

> 研究定位：本輪直接承接上一輪「Dependence-Aware Sequential Evidence × Dynamic Interference」留下的最大缺口：上一輪把 observable runtime state 建模成 Markov / cluster / dynamic graph，但仍隱含假設「真正重要的 state 能被直接觀測」。本輪把這個假設拆掉，正式加入 latent state / belief state 層。

---

## 本小時新發現

### 新論文 / 新架構

1. **Belief-State Engine: Augmenting LLMs for Principled Planning Under Partial Observability** — Arnab Chattopadhayay, Debdipta Halder, 2026-09-09，arXiv:2609.10036。  
   URL: https://arxiv.org/abs/2609.10036  
   核心：把 Bayesian posterior belief state 放在 LLM 外部，LLM 不直接讀 raw action-observation history，而只讀目前 belief posterior；作者提出四個 belief-consistency axioms，並聲稱在已知 POMDP model 下可把 LLM+Belief Engine 視為 belief-MDP 上的 Markov policy。  
   **證據層級：最新 preprint；非常值得研究，但不能當 production guarantee。**

2. **Seeing Isn’t Believing: Mitigating Belief Inertia via Active Intervention in Embodied Agents** — Hanlin Wang, Chak Tou Leong, Jian Wang, Wenjie Li，Findings of ACL 2026。  
   URL: https://aclanthology.org/2026.findings-acl.1884/  
   Code: https://github.com/WangHanLinHenry/EVU  
   核心：指出 embodied LLM agent 即使收到與既有信念衝突的新 observation，也可能維持舊 belief；提出 Estimate→Verify→Update（EVU）顯式 belief update loop。

3. **Active Measuring in Reinforcement Learning With Delayed Negative Effects** — Daiqi Gao, Ziping Xu, Aseel Rawashdeh, Predrag Klasnja, Susan Murphy，AISTATS 2026。  
   URL: https://proceedings.mlr.press/v300/gao26d.html  
   核心：AOMDP 讓 agent 同時決定「做什麼 action」和「現在是否值得付成本量測 latent state」；measurement 本身可能有延遲負面效果，因此 sensing 也要進 planning objective。

4. **Doubly Outlier-Robust Online Infinite Hidden Markov Model** — Horace Yiu, Leandro Sánchez-Betancourt, Álvaro Cartea, Gerardo Duran-Martin，2026。  
   URL: https://arxiv.org/abs/2604.14322  
   核心：BR-iHMM 用 robust generalized Bayesian updates 處理 streaming regime inference 的 outlier 與 model misspecification；作者明確指出 robustness 會交換成 regime-switch adaptation lag。

5. **Fact-Augmented Lookahead Planning for LLM Agents (LWM-Planner)** — Holt et al., AISTATS 2026。  
   URL: https://proceedings.mlr.press/v300/holt26a.html  
   核心：把從 trajectory 提取出的 atomic facts 當作 compact state abstraction，作者把它解釋成減少 state aliasing、降低 latent world-model simulation error；這不是 formal belief filter，但對 Hermes 的「文本式 belief compression」非常實用。

### 新 GitHub / 原始碼

- `WangHanLinHenry/EVU`：repo 不只是 README，包含 `envs/`、`eval/`、`scripts/`、`verl-agent/` 等結構，顯示 EVU 同時覆蓋 prompting/evaluation 與 agent training runtime。
- `Sherry-Xu/Deep-Switching-State-Space-Model`：實際追入 `src/DSSSMCode.py`，其 `DSSSM` 同時維護 discrete regime `d_t` 與 continuous latent state `z_t`，以 learned transition、posterior、emission networks 做 switching latent dynamics。

---

## 本小時最重要 5 個發現

### 1. Observation ≠ State；History ≠ Belief State

**已確認事實 / 理論：** POMDP 的 sufficient state 不是 raw observation，也不是無限長 history，而是對 latent world state 的 posterior belief：

```text
b_t(s)
= P(S_t=s | o_1:t, a_1:t-1)
```

Bayesian filter：

```text
Prediction
b^-_t(s') = Σ_s P(s'|s,a_{t-1}) b_{t-1}(s)

Correction
b_t(s') ∝ P(o_t|s') b^-_t(s')
```

LLM agent 常見做法卻是：

```text
full trajectory
→ prompt
→ next action
```

這只是一個 history-conditioned policy，並不保證 history 已被轉成 Markov-sufficient representation。

**為什麼重要：** Hermes 如果只保存「tool call / observation / log」，就可能看到相同 observation，卻其實處於完全不同 latent runtime states。

```text
Observed:
API latency = 800ms

Hidden A:
provider degradation

Hidden B:
quota nearing limit

Hidden C:
GPU queue saturation

Hidden D:
network transient
```

四種 latent state 的最佳 action 可能完全不同。

**限制：** Belief-State Engine 的 formal guarantee 依賴正確的 POMDP model；真實 Hermes 並不知道完整 transition/emission model，因此只能做 approximate belief state。

---

### 2. State Aliasing 是 Agent failure 的核心來源之一

**概念：** 若兩個不同 latent states 產生相同或近似 observation：

```text
S=A → O=x
S=B → O=x
```

但最優 action 不同：

```text
π*(A) ≠ π*(B)
```

就發生 state aliasing。

對 Agent runtime 的例子：

```text
Observation:
"tool timeout"

Latent State 1:
request never left client
→ safe retry

Latent State 2:
request applied; response lost
→ retry dangerous
```

這直接連回前幾輪 Hermes 已建立的 `DISPATCHED_UNKNOWN` / verify-before-retry：那其實就是一個典型 **aliased observation**。

LWM-Planner 的結果也支持「compact task-critical facts 可減少 state aliasing」這個方向，但論文只把它當 abstraction proxy，不能誤解成完整 Bayesian state recovery。

**Hermes 新規則：**

```text
Same Observation
≠ Same Runtime State

Same Tool Error
≠ Same Recovery Action
```

---

### 3. HMM 不夠時，真正缺的是 duration model；因此 HSMM 應進 runtime

標準 HMM 隱含 geometric dwell-time：

```text
P(D=d | state=i)
= (a_ii)^(d-1)(1-a_ii)
```

等價於「每一步離開 state 的 hazard 大致固定」。

但很多 agent runtime state 明顯不是 memoryless：

```text
RATE_LIMITED
通常會持續 30~60 sec

PROVIDER_DEGRADED
可能持續數分鐘

MEMORY_CONTAMINATED
可能直到 context reset
```

HSMM 改為顯式：

```text
P(S_t, Duration_t)
```

並學每個 state 的 dwell distribution。

2026 的 Hidden Semi-Markov lifecycle work再次展示：顯式 duration distribution 可把「狀態是什麼」與「在此狀態已待多久」分開；這對 Hermes 的 retry/backoff/recovery 特別重要。

**新 runtime state 建議：**

```text
LatentRuntimeState
├ state_id
├ posterior
├ age
├ expected_remaining_duration
├ transition_hazard
└ evidence
```

這比單純：

```text
state = DEGRADED
```

更有決策價值。

---

### 4. Robust State Inference 有不可避免的 Adaptation-Lag trade-off

BR-iHMM 的重要訊息不是「再多一個 HMM」，而是明確指出：

```text
更抗 outlier
↔
更慢承認 regime 真正切換
```

即：

```text
Robustness ↑
False regime creation ↓
但
Change detection delay ↑
```

對 Agent production 非常實際：

```text
單一 timeout
```

不應立刻創造新 latent state `PROVIDER_DOWN`；但若過度 downweight abnormal observations，又可能錯過真正 outage。

因此 Hermes 不應只有：

```text
posterior(state)
```

還需要：

```text
posterior(state)
+ transition confidence
+ outlier responsibility
+ adaptation lag estimate
```

**新的否定關係：**

```text
Robust Inference ≠ Fast Regime Adaptation
Outlier Rejection ≠ Drift Rejection
```

---

### 5. Sensing / Measurement 本身也應是 Agent action

AOMDP 把「是否取得更精確 state observation」變成 action，而不是免費 oracle。

Hermes 對應：

```text
Agent uncertain:
provider degraded?
quota exhausted?
network transient?
```

可以選：

```text
probe provider health
query quota
replay read-only call
sample second region
inspect queue depth
fetch memory version
```

每一個 probe 都有：

```text
Information Gain
Cost
Latency
Side-Effect Risk
Rate-Limit Cost
Privacy Cost
```

所以 action space 應拆：

```text
Control Action
vs
Measurement Action
```

並計算：

```text
MeasurementUtility(m)
=
Expected Belief Entropy Reduction
+ Expected Decision Value
- Monetary Cost
- Latency
- Side Effect Risk
```

這把前幾輪 Adaptive Causal Probing 與這輪 Belief-State Runtime 接起來：**probe 不只是為了研究 tool；也是 runtime 中降低 latent-state uncertainty 的正式 action。**

---

## Architecture Breakdown

### Hermes Hidden-State / Belief Runtime

```text
UI / User Request
↓
Agent Runtime
↓
Observable Event Stream
├ user input
├ tool return
├ latency
├ error
├ memory read/write
├ MCP status
├ queue/load
├ model route
└ external effect
↓
Observation Encoder
↓
Latent-State Inference Layer
├ HMM
├ HSMM
├ Switching State-Space Model
├ Bayesian Filter
└ Predictive-State Approximation
↓
Belief State b_t
├ regime posterior
├ continuous latent state
├ duration posterior
├ state uncertainty
└ competing hypotheses
↓
State-Aliasing Detector
↓
Decision Layer
├ act now
├ ask / sense
├ probe
├ wait
├ verify
├ rollback
└ replan
↓
Measurement Scheduler
↓
New Observation
↓
Belief Update
↺
```

### 與前幾輪 Hermes 模組接合

```text
Belief State
↓
Effect-Safe Transaction Runtime
↓
Tool / MCP
↓
Effect Truth Verification
↓
Behavioral Telemetry
↓
Hidden-State Filter
↓
Dynamic Interference Graph
↓
Evidence Validity Runtime
↓
Rollout Gate
```

也就是：前幾輪建立的是「看得到的因果 / effect / rollout world」，本輪加入的是「看不到但必須推斷的 runtime world」。

---

## Bottom-Level Logic

### A. Filtering loop

```text
belief_{t-1}
+ action_{t-1}
↓ prediction
prior_t
+ observation_t
↓ likelihood weighting
posterior_t
↓ normalize
belief_t
```

離散 HMM 形式：

```text
α_t(j)
∝
P(o_t | s_t=j)
Σ_i P(s_t=j | s_{t-1}=i) α_{t-1}(i)
```

### B. HSMM duration extension

把 transition state 擴成：

```text
(s_t, duration_t)
```

因此：

```text
P(next_state)
```

不再只依 state identity，也依已停留時間與 state-specific duration distribution。

### C. Continuous + discrete latent state

本輪實際讀 `Deep-Switching-State-Space-Model/src/DSSSMCode.py`：

```text
Discrete d_t
↓ selects regime-specific network
Continuous z_t
↓
Emission y_t
```

其原始碼實際包含：

- learned `dprior` transition matrix
- regime-specific `dposterior_list`
- regime-specific continuous `ztrainsition_*`
- regime-specific `zposterior_*`
- regime-specific `yemission_*`
- GRU forward/backward encoders
- categorical latent regime sampling
- Gaussian latent-state reparameterization
- KL category + KL Gaussian + negative log-likelihood losses

這種 discrete-regime + continuous-state 架構很適合 Hermes：

```text
Discrete:
NORMAL / DEGRADED / RATE_LIMITED / CONTAMINATED

Continuous:
load, latency pressure, quota pressure,
confidence, hidden severity
```

### D. State-aliasing test

Hermes 應建立：

```text
O_t similar
BUT
P(O_{t+1:t+k} | intervention a)
differs
```

若相同 observation 在不同 history / probe 下有不同 future predictive distribution，就代表目前 state representation 被 alias。

可用近似判定：

```text
AliasScore(o)
=
max_{h_i,h_j mapping→o}
D_KL(
 P(future | h_i),
 P(future | h_j)
)
```

高 AliasScore → 目前 state abstraction 不夠細。

---

## Visual Simulation Idea

# Hidden State & Belief Brain Lab

### 模式 1：Belief Posterior Viewer

```text
Observed:
MCP timeout

Hidden-state posterior
NETWORK_TRANSIENT      0.18
PROVIDER_DEGRADED      0.41
RATE_LIMITED           0.31
REQUEST_APPLIED        0.10
```

拖動新 evidence：

```text
quota API says 98% consumed
```

即時動畫：

```text
RATE_LIMITED
0.31 → 0.82
```

### 模式 2：State Aliasing Viewer

畫面中央只顯示：

```text
OBSERVATION = TIMEOUT
```

底下展開四個 hidden branches：

```text
not sent
sent + failed
sent + applied
server slow
```

每個 branch 對應不同 safe action。

### 模式 3：HMM vs HSMM Timeline

```text
HMM
RATE_LIMITED
每一秒都有固定離開機率

HSMM
RATE_LIMITED
duration posterior peaks near 60 sec
```

直接顯示為什麼 HSMM 對 cooldown / outage / session phases 更自然。

### 模式 4：Active Measurement Planner

```text
Current entropy: 1.73 bits

Probe                  Info Gain   Cost   Risk
quota status              .81      low    low
second-region ping        .54      med    low
live write replay         .93      med    HIGH
wait 10 sec               .33      low    low

→ CHOOSE quota status
```

---

## Code / GitHub

### 1. WangHanLinHenry/EVU

值得繼續看的目錄：

```text
envs/
eval/
scripts/
verl-agent/
data/
docs/
```

最值得 Hermes 借用的不是 textual prompt 本身，而是其：

```text
Estimate
→ Expected outcome
→ Observe actual outcome
→ Verify contradiction
→ Update explicit belief
```

這可直接成為 Hermes 的 `BeliefUpdateEvent`。

### 2. Sherry-Xu/Deep-Switching-State-Space-Model

核心：

```text
src/DSSSMCode.py
src/utils.py
main.py
```

`DSSSMCode.py` 已實際實作 discrete regime `d` + continuous latent `z` + emission `y` + transition/posterior networks，因此是這輪最值得讀的「bottom-level latent dynamics」程式。

### 3. Belief-State Engine

最新論文非常值得追 code release，但目前本輪只把其視為 **architecture proposal + theoretical preprint evidence**；需要下一輪再確認公開 code 的實際 solver / belief update / model interfaces，不能只引用理論宣稱。

---

## Papers

### Paper A
**Title:** Belief-State Engine: Augmenting LLMs for Principled Planning Under Partial Observability  
**Authors:** Arnab Chattopadhayay, Debdipta Halder  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2609.10036  
**Architecture:** external Bayesian belief engine + LLM policy  
**Contribution:** 把 belief posterior 從 prompt-history 隱式推斷移到 LLM 外部顯式模組。  
**Limitations:** 需要已知/可指定 POMDP model；最新 preprint，尚需獨立驗證與更廣 benchmark。

### Paper B
**Title:** Seeing Isn’t Believing: Mitigating Belief Inertia via Active Intervention in Embodied Agents  
**Authors:** Hanlin Wang, Chak Tou Leong, Jian Wang, Wenjie Li  
**Institution:** ACL Findings 2026 publication  
**URL:** https://aclanthology.org/2026.findings-acl.1884/  
**Code:** https://github.com/WangHanLinHenry/EVU  
**Architecture:** Estimate→Verify→Update explicit textual belief loop  
**Contribution:** 把「收到新 observation 但不更新 belief」識別成 belief inertia failure。  
**Limitations:** textual belief state 仍不是 calibrated Bayesian posterior。

### Paper C
**Title:** Active Measuring in Reinforcement Learning With Delayed Negative Effects  
**Authors:** Daiqi Gao et al.  
**Venue:** AISTATS 2026  
**URL:** https://proceedings.mlr.press/v300/gao26d.html  
**Architecture:** AOMDP + belief state + sequential Monte Carlo approximation  
**Contribution:** measurement 本身成為有 cost / delayed effect 的 action。  
**Limitations:** domain assumptions 與 latent-state model仍需要針對 agent/tool runtime重新定義。

### Paper D
**Title:** Doubly Outlier-Robust Online Infinite Hidden Markov Model  
**Authors:** Horace Yiu, Leandro Sánchez-Betancourt, Álvaro Cartea, Gerardo Duran-Martin  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2604.14322  
**Architecture:** robust online infinite HMM  
**Contribution:** 同時處理 observation outlier 與 latent-state inference robustness，明確呈現 robust/adaptation-lag trade-off。  
**Datasets:** limit order book、hourly electricity demand、synthetic high-dimensional system。  
**Limitations:** streaming time-series setting，不是直接針對 Agent tool/runtime。

### Paper E
**Title:** Fact-Augmented Lookahead Planning for LLM Agents  
**Authors:** Holt et al.  
**Venue:** AISTATS 2026  
**URL:** https://proceedings.mlr.press/v300/holt26a.html  
**Architecture:** trajectory→fact extraction→fact-conditioned world-model lookahead  
**Contribution:** compact verified facts 作為 state abstraction，減輕 history noise/state aliasing。  
**Limitations:** 不是 formal belief-state filter；作者也沒有宣稱完整 POMDP guarantee。

---

## Unknown / Open Questions

### 1. Latent state 到底應由誰定義？

```text
人工 taxonomy
vs
HMM learned states
vs
nonparametric iHMM
vs
continuous latent state
vs
predictive state
```

如果 latent state 沒有 operational semantics，posterior 很漂亮但可能無法影響 action。

### 2. 如何知道 state abstraction 發生 aliasing？

目前可用 future-prediction divergence 做 proxy，但 Hermes 仍缺 production-grade：

```text
StateAliasingDetector
```

### 3. Hidden state 與 causal hidden confounder 怎麼區分？

`latent runtime state` 是用來描述 dynamics 的 hidden variable；`hidden confounder` 是同時影響 exposure/action 與 outcome、造成因果偏誤的 latent variable。兩者可能重疊，但不是同一概念。

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
Latent Runtime State
Belief State
Belief-State Engine
Bayesian Filter
Belief Update
Belief Entropy
Belief Inertia
State Aliasing
Alias Score
Observation Equivalence Class
Hidden Markov Model
Infinite HMM
Hidden Semi-Markov Model
State Duration
Dwell-Time Distribution
Transition Hazard
Switching State-Space Model
Discrete Regime
Continuous Latent State
Active Measurement
Measurement Action
Measurement Cost
Measurement Utility
Predictive State
State Abstraction
Fact State
Robust State Inference
Adaptation Lag
```

### Edges

```text
Observation ─evidence_for→ Belief State
Belief State ─conditions→ Planning
Measurement Action ─reduces_uncertainty_of→ Belief State
Latent Runtime State ─emits→ Observation
HSMM ─extends→ HMM
HSMM ─models→ State Duration
Switching State-Space Model ─contains→ Discrete Regime
Switching State-Space Model ─contains→ Continuous Latent State
State Aliasing ─causes→ Wrong Action Selection
Robust State Inference ─trades_off_with→ Adaptation Speed
Belief Inertia ─prevents→ Belief Update
```

### 新增否定關係

```text
Observation ≠ State
History ≠ Belief State
Same Observation ≠ Same Runtime State
Same Error ≠ Same Recovery Action
Textual Belief ≠ Calibrated Posterior
HMM State ≠ Causal Confounder
Robust Inference ≠ Fast Adaptation
Outlier ≠ Regime Change
State Label ≠ Operational Semantics
Measurement ≠ Free Information
```

---

## 下一輪研究

# **Predictive State Representation × Belief Compression × Latent-State Identifiability × State Aliasing Detection × Active Sensing Policy**

下一輪要解：即使有 HMM/HSMM，latent labels 常是模型自己創造的，可能不可識別，也可能換一次訓練 state ID 就對調。因此需要從「hidden-state label」進一步轉向「對未來有可驗證預測意義的 state representation」。

建議下一輪鏈：

```text
Action-Observation History
↓
Predictive Tests
↓
Future Observation Distribution
↓
Predictive State Representation
↓
Belief Compression
↓
State Aliasing Test
↓
Minimal Sufficient State
↓
Active Sensing Policy
↓
Decision-Calibrated State Certificate
```

重點比較：

```text
Bayesian Belief State
vs
HMM/HSMM Latent State
vs
Switching Continuous Latent State
vs
Predictive State Representation
vs
LLM Textual Belief
```

---

## 本輪收斂答案

- **缺哪一層：** `Latent-State Identifiability + Predictive-State / Belief Compression Layer`。
- **哪個節點最淺：** `StateAliasingDetector`，目前仍只有 future-divergence proxy。
- **哪個概念仍只是名詞：** `BeliefStateCertificate`、`DecisionSufficientState`、`AliasCertificate`、`LatentRuntimeState ABI`。
- **哪個系統值得讀原始碼：** `WangHanLinHenry/EVU` 的 training/eval belief loop；`Sherry-Xu/Deep-Switching-State-Space-Model/src/DSSSMCode.py` 的 discrete/continuous latent dynamics；下一輪應追 Belief-State Engine code。
- **哪篇論文需追引用：** `Belief-State Engine` → POMDP/belief-MDP literature；`BR-iHMM` → robust Bayesian filtering/nonparametric HMM；`AOMDP` → active sensing / value of information。
- **哪個概念最適合視覺模擬：** `Hidden State & Belief Brain Lab`。
- **哪個 Agent 架構最值得實作：**

> **Belief-Aware Agent Runtime = Observation Encoder + HMM/HSMM/Switching-State Filter + Explicit Belief Store + State-Aliasing Detector + Value-of-Information Measurement Planner + EVU Belief Correction + Belief-Conditioned Planner + Transactional Tool Runtime。**

---

## 從「使用者說一句話」到 Hidden-State Agent 的新增底層鏈

```text
User
→ UI
→ Agent
→ Context
→ Raw History
→ Observation Encoder
→ Latent-State Filter
→ Belief State
→ Reasoning
→ Planning
→ Measurement / Tool Action
→ MCP / External World
→ Observation
→ Belief Update
→ Effect Verification
→ Memory / Provenance
→ Next Decision
```

多模態版本：

```text
Camera / Image / Voice / Video / Sensor
→ Encoder
→ Multimodal Tokens / Features
→ Observation Model
→ Latent World State
→ Belief Distribution
→ Reasoning / Planning
→ Action
→ Environment
→ New Sensor Evidence
→ Belief Update
```

**本輪核心推進：AI Agent 真正需要的不是「記住更多 history」，而是把 history 壓成一個能區分決策上重要 hidden worlds 的 belief state；當目前 observation 無法判斷世界在哪個 latent state 時，Agent 應主動選擇最有價值的 measurement，而不是直接猜下一步。**