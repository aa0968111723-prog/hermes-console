# 【AI Agent × Multimodal Research Report】

**時間：2026-09-11 21:51（Asia/Taipei）**  
**主題：Nonstationary Tool Behavior × Causal Change-Point Detection × Hidden Confounders × Natural Experiments × Recertification**

---

## 本小時新發現

本輪承接上一輪 `Adaptive Causal Probing × Black-Box System Identification`，不再重做「怎麼選下一個 probe」，而是處理更困難的現實問題：上一輪隱含假設 `P(y | hypothesis, intervention)` 在短期內大致穩定；但真實 MCP / SaaS / browser / model-backed tool 的 backend、feature flag、policy、ranking、region、memory 或 remote model 都可能在 schema 不變時發生行為漂移。

因此研究鏈改成：

```text
Streaming Telemetry
↓
Behavioral Fingerprint
↓
Change-Point Detector
↓
Stationary Segment Hypothesis
↓
Drift Attribution
├ mechanism changed?
├ intervention target changed?
├ hidden confounder shifted?
├ memory/context changed?
└ noise only?
↓
Adaptive Causal Probe
↓
Natural Experiment + Active Intervention
↓
Recertification / Quarantine
```

### 新論文 / 架構 / GitHub

1. **Quickest Causal Change Point Detection by Adaptive Intervention** — Haijie Xu, Chen Zhang, Tsinghua University, 2025. URL: https://arxiv.org/abs/2506.07760 . 研究線性 causal model 中的 sequential change detection；用 centralization 將因果傳播造成的多節點改變集中成一維統計量，再依 KL divergence 選介入節點與介入值，以放大 change signal。提出 exploration/exploitation 的 adaptive intervention policy，並給出 first-order optimality。
2. **MetaCaDI: A Meta-Learning Framework for Causal Discovery from Multiple Environments with Unknown Interventions** — Hans Jarett Ong, Yoichi Chikahara, Tomoharu Iwata, UAI 2026. URL: https://proceedings.mlr.press/v337/ong26a.html . 將 unknown intervention target identification 與 shared causal graph learning 放入 Bayesian meta-learning；few-shot 新環境只需少量樣本即可適應，論文報告 3 samples 下仍可辨認 intervention targets。
3. **FoundCause: Causal Discovery with Latent Confounders from Observational Data** — Patrick Blöbaum, Krishnakumar Balasubramanian, Shiva Prasad Kasiviswanathan, Amazon, 2026. URL: https://arxiv.org/abs/2606.17516 . 專門處理 latent confounder；permutation-invariant transformer encoder + statistics-conditioned attention + factorized edge/direction decoder + triangular refinement + learnable confounder tokens。Code: https://github.com/amazon-science/foundcause .
4. **Model-Agnostic Online Certificate-Driven Calibration for Time Series Forecasting Under Distribution Shift** — Chenfeng Huang, Zixuan Ma, George Michailidis, UAI 2026. URL: https://proceedings.mlr.press/v337/huang26b.html . 用 online martingale PAC-Bayesian certificate 處理 temporal dependence 與 distribution shift，採 predict-then-update，而非假設 IID/stationary。
5. **Memory-Induced Tool-Drift in LLM Agents** — Mahavir Dabas, Jihyun Jeong, Ming Jin, Ruoxi Jia, 2026. URL: https://arxiv.org/abs/2605.24941 . MEMDRIFT 顯示 memory 中不相關 personality bias 可改變 tool parameters，且 production memory architectures 無法完全消除此 drift。
6. **AgentDrift: Unsafe Recommendation Drift Under Tool Corruption Hidden by Ranking Metrics in LLM Agents** — Zekun Wu et al., 2026. URL: https://arxiv.org/abs/2603.12564 . clean/contaminated paired trajectories 顯示一般 recommendation quality 可保持接近正常，但 risk-inappropriate behavior 仍大量出現，說明「表面效能不變」不能證明 tool semantics / safety 沒漂移。
7. **BOCPD Rust implementation** — https://github.com/OctopusTakopi/bocpd . 本輪讀進 `src/core.rs`, `src/hazard.rs`, `src/calibration.rs`, `src/models/*`，確認 streaming Bayesian run-length posterior、hazard、truncation/pruning 與 recalibration 可如何映射到 Hermes Tool Drift Monitor。

---

## 本小時最重要 5 個發現

### 1. Tool Drift Detection ≠ 一般 anomaly detection；真正需要的是「機制分段」

單純偵測 output distribution 改變只能說：

```text
P(Y) changed
```

但 Hermes 真正需要回答：

```text
P(Y | X, do(A), Context, ToolVersion)
是否改變？
```

因此 drift event 至少分成：

```text
Covariate Shift
P(X) changed

Observation Noise Shift
P(ε) changed

Policy / Invocation Shift
P(A | Context) changed

Mechanism Shift
P(Y | parents, do(A)) changed

Hidden Confounder Shift
latent U changed association between A and Y

Representation Shift
same world → different model/tool interpretation
```

重要否定：

```text
Distribution Shift ≠ Mechanism Shift
Output Drift ≠ Tool Implementation Drift
Schema Stable ≠ Behavior Stable
```

### 2. Change-point detection 要維護「run-length posterior」，不能只做 fixed-window threshold

BOCPD 的核心不是比較兩個滑動平均，而是維護：

```text
P(r_t | x_1:t)
```

其中 `r_t` 是「目前 regime 已持續多久」。每來一個 observation，對每個 run-length hypothesis 計算 predictive likelihood，再透過 hazard function 分成：

```text
Growth:
r_t = r_{t-1} + 1

Change:
r_t = 0
```

底層 recursion：

```text
P(r_t, x_1:t)
∝
P(x_t | r_{t-1}, history)
×
P(r_t | r_{t-1})
×
P(r_{t-1}, x_1:t-1)
```

本輪讀取的 Rust `src/core.rs` 實際執行：

```text
for each run_length:
  log_predictive_prob(x)

message + log_pred + log(1-hazard)
→ growth

message + log_pred + log(hazard)
→ changepoint terms

logsumexp(change terms)
→ r=0

normalize
→ posterior over run length
```

而且 code 會先建立 next states，全部成功後才 commit，並支援 tail pruning / max-run-length truncation / posterior normalization。這使它很適合作為 Hermes 的 streaming behavior segmentation primitive。

但 BOCPD 原版只回答「distribution regime 可能變了」，不自動回答「哪個 causal mechanism 變了」。Hermes 必須把 BOCPD 後接 causal attribution。

### 3. Adaptive intervention 不只用來學 causal graph，也可以主動「放大 drift」

Quickest Causal Change Point Detection 的核心新觀點：如果只是 passive observation，某些 backend change 經因果圖傳播後可能很微弱；選對 intervention node，可以讓 pre-change 與 post-change distribution 的 KL divergence 變大，縮短 detection delay。

對 Hermes：

```text
Passive Monitor
發現 weak drift evidence
↓
Candidate Changed Mechanisms
↓
choose safe probe a*
=
argmax_a Expected KL(pre || post | do(a))
      - cost
      - risk
↓
Execute minimal probe
↓
Posterior over change point / mechanism
```

因此上一輪的 `TaskWeightedEIG` 可以延伸為：

```text
DriftProbeUtility(a)
=
ExpectedChangeSeparation(a)
+ ExpectedMechanismInformation(a)
- MonetaryCost(a)
- Latency(a)
- SideEffectRisk(a)
```

重要新否定：

```text
Best Probe for Discovery
≠
Best Probe for Change Detection
```

因為前者最大化 hypothesis reduction，後者可能優先最大化 pre/post regime separation。

### 4. Hidden confounder 會讓「看似 tool drift」其實只是環境共同原因改變

假設觀察到：

```text
ToolCall A
→ Outcome Y changes
```

不能立刻推出：

```text
A's mechanism changed
```

可能存在：

```text
Hidden U
↘      ↙
 A    Y
```

例如：

```text
region load U
→ router selects backend
→ latency

region load U
→ model quality degrades
```

此時 `router choice ↔ quality` 的關聯可能是假因果。

FoundCause 的重要價值，是把 latent common cause 當成 graph recovery 的一級物件；其架構使用 learnable confounder tokens 與 higher-order motif refinement。對 Hermes 而言，不必直接把 FoundCause 當 deterministic truth oracle，而應把它當：

```text
Confounder Hypothesis Generator
```

形成：

```text
Observed Drift
↓
Candidate Direct Mechanism Change
+
Candidate Hidden Confounder
↓
Generate discriminating intervention / proxy test
↓
Update posterior
```

MetaCaDI 再補上另一個現實問題：多環境中 intervention target 本身也可能未知。因此 Hermes 不應假設「我們知道是哪個 backend flag 被改了」。

### 5. Certificate 必須綁定 stationary regime，而不是綁定 tool name

上一輪建立的 Effect / Read-Set Certificate 如果寫成：

```text
create_order v1
→ certificate valid
```

仍太粗。

本輪應升級：

```text
BehaviorCertificate
├ tool_identity
├ schema_hash
├ observed_regime_id
├ regime_start
├ run_length_posterior
├ behavior_fingerprint
├ causal_read_set
├ effect_contract
├ hidden_confounder_hypotheses
├ environment_scope
├ model/backend hints
├ evidence_window
├ confidence
└ invalidation_policy
```

新的核心規則：

```text
Certificate Validity
=
Tool Identity
× Regime Stability
× Environment Compatibility
× Causal Assumption Validity
```

而不是：

```text
Same endpoint → certificate reusable forever
```

---

## Architecture Breakdown

### Nonstationary Causal Tool Runtime

```text
Tool / MCP / Browser / Remote Model
↓
Streaming Telemetry Collector
├ arguments
├ return shape
├ value statistics
├ latency
├ error class
├ side effects
├ selected branch
├ postconditions
├ environment tags
└ memory/context fingerprint
↓
Behavioral Fingerprint Encoder
↓
Online Change-Point Layer
├ BOCPD run-length posterior
├ conformal/CUSUM fallback
├ hazard model
└ uncertainty
↓
Regime Manager
├ stationary segment S_k
├ candidate change τ
└ regime evidence
↓
Drift Attribution Layer
├ covariate shift
├ invocation/policy drift
├ tool mechanism drift
├ hidden confounder
├ memory-induced drift
└ unknown
↓
Adaptive Causal Probe Planner
├ EIG
├ KL regime separation
├ task impact
├ cost
└ risk
↓
Natural Experiment + Controlled Intervention
↓
Causal Posterior Update
↓
Recertification Engine
├ retain
├ narrow scope
├ issue new regime certificate
├ quarantine
└ revoke
↓
Transactional Agent Runtime
```

### System architecture：BOCPD 如何落到 Hermes

`OctopusTakopi/bocpd` 值得看的核心：

```text
src/
├ core.rs          # run-length posterior engine / update loop
├ hazard.rs        # H(r), 1-H(r)
├ calibration.rs   # offline/online calibration hooks
├ models/          # predictive observation models
└ lib.rs
```

Hermes mapping：

```text
BOCPD observation x_t
=
behavior feature vector projection

run length r_t
=
time since last behavioral regime change

hazard H(r)
=
prior probability tool behavior changes after r steps/time

observation model
=
latency/error/argument/output/effect predictive model

change posterior
=
recertification trigger strength
```

工程上不要直接把所有高維 telemetry 塞進 scalar BOCPD。應先做 feature groups 或多 detector：

```text
Invocation Channel Detector
Effect Channel Detector
Latency/Error Detector
Safety Channel Detector
```

再建立：

```text
ChangeEvidenceFusion
```

否則 latency spike 可能把真正 effect drift 淹沒。

---

## Bottom-Level Logic

### 1. Streaming regime inference

設 `r_t` 為 run length：

```text
Predict:
L_r = P(x_t | D_t^(r), θ_r)

Growth:
G_{r+1} = P(r_{t-1}=r | x_1:t-1)
          × L_r
          × (1 - H(r))

Reset:
C_0 = Σ_r P(r_{t-1}=r | x_1:t-1)
          × L_r
          × H(r)

Normalize:
P(r_t | x_1:t)
```

實際 runtime 不應只用：

```text
P(r_t = 0)
```

還要看：

```text
P(r_t ≤ k)
```

因為 change evidence 常分散在短 run lengths，而不是單點 `r=0`。

### 2. Drift attribution

一旦 change posterior 上升，不直接 revoke：

```text
ChangeDetected
↓
Freeze old certificate as historical
↓
Create candidate regime S_new
↓
Compare:
P(Y|X,A,S_old)
vs
P(Y|X,A,S_new)
↓
Test covariate-only explanation
↓
Test memory/context explanation
↓
Test hidden-confounder hypothesis
↓
Active probe if unresolved
```

### 3. Hidden confounder handling

Hermes 不應聲稱「已找到 hidden U」，而應區分：

```text
LatentConfounderSuspected
LatentConfounderProxySupported
LatentConfounderModelSupported
InterventionDisambiguated
```

因為 observational latent-confounder discovery 本身也依賴模型假設與 simulation-to-real generalization。

### 4. Natural experiment

若 runtime 剛好發生：

```text
region A backend changed
region B unchanged
```

不必立刻自己做高風險 intervention，可先形成自然對照：

```text
Environment A
vs
Environment B
```

但必須檢查：

```text
same user/task mix?
same model?
same policy?
same time effects?
```

否則 environment label 本身又引入 confounding。

---

## Visual Simulation Idea

# Nonstationary Tool Causal Observatory

### Mode 1 — Regime Timeline

```text
create_order behavior

S1 ─────────────────────┐
                         │
                    τ?   ▼
S2                 ─────────────

P(change now)       0.78
P(run length ≤ 3)   0.93
```

使用者可以點時間軸某點，看：

```text
Before τ
latency p50 220ms
error 1.2%
write-set {order,payment,audit}

After τ
latency p50 225ms
error 1.4%
write-set {order,payment,audit,marketing_event}
```

UI 明確提示：

```text
Performance Stable
BUT
Effect Contract Changed
```

### Mode 2 — Drift Attribution Graph

```text
                 hidden region load ?
                 ↙               ↘
router_backend ───→ latency       quality

candidate explanations:

Backend mechanism changed    0.41
Hidden confounder shift      0.46
Noise                        0.13
```

按：

```text
FIND BEST DISAMBIGUATING PROBE
```

得到：

```text
Probe:
keep task/model fixed
switch region only

Expected regime KL   0.82
Expected EIG         0.64
Risk                 LOW
```

### Mode 3 — Certificate Lifecycle

```text
Certificate C12
Regime S7
STATUS: VALID

21:44 change evidence ↑
21:45 SHORT-RUN MASS 0.91
21:46 QUARANTINE
21:47 probe
21:48 new regime confirmed

C12 → HISTORICAL
C13 → ACTIVE
```

這個視覺模擬可以把「AI 如何知道自己昨天理解的工具今天可能已經不一樣」直接呈現出來。

---

## Code / GitHub

### 1. OctopusTakopi/bocpd
https://github.com/OctopusTakopi/bocpd

值得讀：

```text
src/core.rs
src/hazard.rs
src/calibration.rs
src/models/
tests/
benches/
```

`core.rs` 的 `update_ref()` 是最值得移植概念的核心：predictive likelihood → growth/change branches → logsumexp → truncation/pruning → normalization → new model states → commit。

特別值得 Hermes 借的工程思想：

```text
State is committed only after predictive/model updates succeed.
```

這與前面研究出的 transactional runtime 思維一致。

### 2. amazon-science/foundcause
https://github.com/amazon-science/foundcause

目前 repo 很精簡：

```text
foundcause.py
predict.py
README.md
```

不是 agent runtime，而是值得用來研究「latent confounder hypothesis generation」的模型實作。核心 paper architecture 包含 sample/variable alternating attention、pairwise statistical features、edge/direction factorization、triangular refinement 與 latent confounder representation。

### 3. 需持續追蹤但本輪未發現公開 reference implementation

Quickest Causal Change Point Detection by Adaptive Intervention 目前公開頁面未提供正式 code implementation；因此其 KL-based intervention-selection 概念適合先做 Hermes prototype，而不能假稱已對照官方原始碼。

---

## Papers

### A. Quickest Causal Change Point Detection by Adaptive Intervention
- **Title:** Quickest Causal Change Point Detection by Adaptive Intervention
- **Authors:** Haijie Xu, Chen Zhang
- **Institution:** Tsinghua University
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2506.07760
- **Code:** 未確認官方公開 code
- **Dataset:** simulation + 2 real-world case studies（依論文摘要）
- **Architecture:** linear causal model + centralization + KL-based intervention node/value selection + adaptive monitoring
- **Contribution:** 把 intervention 當成 change detection 的主動 sensing mechanism
- **Limitations:** 線性 causal model 假設；tool/SaaS 的高維非線性與不可控 intervention 仍需工程延伸
- **改變了什麼:** 從「被動等待 drift 顯現」變成「主動選 probe 放大 pre/post 差異」

### B. MetaCaDI
- **Title:** MetaCaDI: A Meta-Learning Framework for Causal Discovery from Multiple Environments with Unknown Interventions
- **Authors:** Hans Jarett Ong, Yoichi Chikahara, Tomoharu Iwata
- **Year:** 2026
- **URL:** https://proceedings.mlr.press/v337/ong26a.html
- **Code:** 本輪未確認官方 code
- **Dataset:** synthetic + gene expression
- **Architecture:** Bayesian shared causal graph + meta-learning + analytical adaptation
- **Contribution:** unknown intervention target / few-shot environment adaptation
- **Limitations:** 生物資料與 tool-runtime drift 的語意不同；需重新定義 environment/intervention target
- **改變了什麼:** Hermes 不再假設 drift 發生時知道「誰被改了」

### C. FoundCause
- **Title:** FoundCause: Causal Discovery with Latent Confounders from Observational Data
- **Authors:** Patrick Blöbaum, Krishnakumar Balasubramanian, Shiva Prasad Kasiviswanathan
- **Institution:** Amazon
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2606.17516
- **Code:** https://github.com/amazon-science/foundcause
- **Dataset:** paper reports 15 real-world datasets + synthetic training SCMs
- **Architecture:** amortized transformer causal discovery + latent confounder tokens
- **Contribution:** single-forward-pass graph recovery with explicit latent-confounder modeling
- **Limitations:** synthetic-training generalization is a major assumption；observational discovery 仍不等於 intervention-verified causality
- **改變了什麼:** hidden confounding 從「未知雜訊」升級成 Hermes 的顯式 hypothesis class

### D. Model-Agnostic Online Certificate-Driven Calibration Under Distribution Shift
- **Authors:** Chenfeng Huang, Zixuan Ma, George Michailidis
- **Year:** 2026
- **URL:** https://proceedings.mlr.press/v337/huang26b.html
- **Architecture:** online martingale PAC-Bayesian calibration
- **Contribution:** temporal dependence / shift 下仍產出 finite-sample certificate
- **限制:** forecasting setting，不直接處理 tool causal graph
- **Hermes relevance:** certificate confidence 不能假設 IID samples；telemetry 本身有 temporal dependence

---

## 已確認事實 / 推論 / 假說分層

### 已確認

- BOCPD 維護 run-length posterior，而不是單一 sliding-window anomaly score。
- `OctopusTakopi/bocpd` `core.rs` 實際實作 predictive probability、hazard growth/change branches、normalization、truncation/pruning、state update。
- Quickest Causal Change Point Detection 明確以 intervention node/value selection 放大 causal change signal。
- MetaCaDI 研究 unknown intervention targets across environments。
- FoundCause 明確模型化 latent confounder。
- Memory-Induced Tool-Drift 與 AgentDrift 都支持「schema/表面效能穩定時仍可能有 agent/tool behavior drift」。

### 工程推論

- BOCPD run-length posterior 適合作為 Effect Certificate 的 regime-validity signal。
- active causal probe planner 應同時優化 information gain 與 pre/post regime separation。
- tool certificate 應綁定 regime/environment，而不只綁 tool ID/schema hash。

### 尚未驗證假說

- `BOCPD + causal probe + latent-confounder hypothesis` 在真實 MCP tools 上能否以低成本穩定辨識 backend behavior drift。
- 高維 tool telemetry 最佳的 observation representation 應是多 detector fusion、learned embedding，還是 structured sufficient statistics。
- hidden confounder discovery 模型在 tool-runtime telemetry 上的 simulation-to-real transfer 是否可信。

---

## Unknown / Open Questions 1-3

1. **Change point 與 causal mechanism change 如何精準對齊？** 同一個 observed change 可能來自 covariate shift、memory shift、backend shift 或 hidden confounder。
2. **非平穩系統的 probe evidence 可以保存多久？** 如果 probe 執行期間 regime 又變了，posterior update 可能混合兩個機制。
3. **如何處理 gradual drift？** BOCPD 偏向 regime boundary；但 SaaS model rollout 可能是 1%→10%→50%→100% traffic，並非單一 abrupt τ。

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
Nonstationary Tool Behavior
Behavioral Regime
Regime ID
Causal Change Point
Run-Length Posterior
Hazard Function
Short-Run Mass
Mechanism Shift
Covariate Shift
Invocation Shift
Hidden Confounder Shift
Latent Confounder Hypothesis
Unknown Intervention Target
Natural Experiment
Adaptive Drift Probe
Change Separation Utility
Behavior Certificate Regime Scope
Regime Recertification
Gradual Rollout
Drift Attribution
Stationary Segment
```

### Edges

```text
ToolTelemetry --EVIDENCES→ BehavioralRegime
BehavioralRegime --ENDS_AT→ CausalChangePoint
BOCPD --ESTIMATES→ RunLengthPosterior
RunLengthPosterior --TRIGGERS→ Recertification
AdaptiveIntervention --AMPLIFIES→ ChangeSignal
HiddenConfounder --CAN_MIMIC→ MechanismShift
NaturalExperiment --PROVIDES→ EnvironmentContrast
MechanismShift --INVALIDATES→ BehaviorCertificate
BehaviorCertificate --VALID_WITHIN→ BehavioralRegime
UnknownInterventionTarget --REQUIRES→ TargetInference
```

### 新增否定關係

```text
Distribution Shift ≠ Mechanism Shift
Anomaly ≠ Change Point
Change Point ≠ Root Cause
Schema Stable ≠ Behavior Stable
Same Endpoint ≠ Same Regime
Output Quality Stable ≠ Safety Stable
Observed Association Drift ≠ Causal Mechanism Drift
Latent Confounder Hypothesis ≠ Confounder Proof
Best Discovery Probe ≠ Best Detection Probe
Certificate Validity ≠ Timeless Property
```

---

## 下一輪研究

下一個最值得解的是：

# Gradual Drift × Mixture-of-Regimes × Canary Rollout × Traffic Splitting × Counterfactual Recertification

原因：本輪仍主要把 nonstationarity 建模成「一個 regime 結束、下一個 regime 開始」。但真實 production tool/model 常是：

```text
backend A 99% / B 1%
↓
A 90% / B 10%
↓
A 50% / B 50%
↓
B 100%
```

此時一個時間點可能同時存在兩套 mechanism。

下一輪應拆：

```text
Request-level Telemetry
↓
Latent Backend / Regime Mixture
↓
Mixture Identification
↓
Canary Cohort Detection
↓
Traffic Split Inference
↓
Per-Regime Effect Contract
↓
Counterfactual Routing Test
↓
Safe Cohort Recertification
↓
Global Promotion / Rollback
```

並深入：mixture change-point、switching state-space model、HMM/HSMM、mixture-of-experts routing、canary release observability、A/B causal inference、multi-environment certificate transportability。

---

## 本輪結束回答

- **缺哪一層：** mixture-of-regimes / gradual rollout identification；目前 change-point 模型仍偏單一 regime boundary。
- **哪個節點最淺：** `DriftAttribution`，尤其 HiddenConfounderShift vs MechanismShift 的 calibration。
- **哪個概念仍只是名詞：** `RegimeScopedBehaviorCertificate`、`DriftAttributionCertificate`、`CausalChangeCertificate`、`HiddenConfounderEvidence ABI`。
- **哪個系統值得讀原始碼：** `OctopusTakopi/bocpd` 的 `src/core.rs`, `hazard.rs`, `calibration.rs`, `models/*`；以及 `amazon-science/foundcause/foundcause.py`。
- **哪篇論文需追引用：** `Quickest Causal Change Point Detection by Adaptive Intervention`；它直接把 active intervention 與 sequential change detection 接起來，對 Hermes 最關鍵。
- **哪個概念最適合視覺模擬：** `Nonstationary Tool Causal Observatory`，用 regime timeline + causal attribution graph + certificate lifecycle。
- **哪個 Agent 架構最值得實作：**

> **Nonstationary Self-Recertifying Tool Runtime = Streaming Behavioral Telemetry + BOCPD/Change-Point Layer + Regime Manager + Causal Drift Attribution + Hidden-Confounder Hypothesis Generator + Adaptive Detection Probe Planner + Natural-Experiment Analyzer + Regime-Scoped Certificates + Quarantine/Recertification Gate。**

---

## 與總體「AI 到底怎麼運作」知識圖譜接合

目前可把使用者一句話後的 execution path 再補上一個以前常被忽略的時間軸：

```text
User
→ UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tool/MCP
→ External System
→ Effect
→ Observation
→ Provenance
→ Behavioral Telemetry
→ Regime Inference
→ Drift Detection
→ Causal Recertification
→ 下一次 Agent 決策
```

真正成熟的 Agent 不只要知道「這個工具過去怎麼運作」，而要持續估計：

> **我現在看到的工具，還是不是我上一次驗證過的那個行為機制？如果不是，是工具真的變了、環境變了、我的 memory 讓我用法變了，還是有隱藏共同原因在誤導我？**
