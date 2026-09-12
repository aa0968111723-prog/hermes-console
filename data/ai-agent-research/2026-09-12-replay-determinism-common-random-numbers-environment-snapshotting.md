# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 13:56（Asia/Taipei）**  
**主題：Replay Determinism × Common Random Numbers × Event-Keyed RNG × Environment Snapshotting × Variance Reduction × Replay Fidelity Certificate**

## 本小時新發現

本輪承接上一輪「Adaptive Coalition Search × Counterfactual Validity」的缺口，不再重複 Shapley / coalition 基礎，而是研究更底層的問題：**當 factual run 與 counterfactual replay 不同時，差異到底來自 intervention，還是來自模型、GPU、tool、clock、network、environment 本身的 stochasticity？**

新論文 / 系統：

1. **Realizing Common Random Numbers: Event-Keyed Hashing for Causally Valid Stochastic Models** — Vince Buffalo, Carl A. B. Pearson, Daniel Klein, 2026。核心指出：只重用相同 base seed 並不等於建立有效 Common Random Numbers；若 intervention 改變 control flow，stateful PRNG 的 draw index 會位移，使 factual/counterfactual 後續事件實際使用不同隨機量。作者主張以 counter-based RNG + event identifier，把 exogenous randomness 綁到「語義事件」而非「第幾次 RNG call」。URL: https://arxiv.org/abs/2603.11084
2. **Using Common Random Numbers for Simulation-based Planning with Rollouts** — Sandarbh Yadav, Frederic J Maliakkal, Harshad Khadilkar, Shivaram Kalyanakrishnan, 2026。將 CRN 用於 stochastic rollout planning，比較 action utilities 時降低 relative-utility variance。URL: https://arxiv.org/abs/2605.04732
3. **CoRun: Padding is Simple and Efficient for Deterministic LLM Inference** — Shiju Zhao et al., 2026。指出動態 input shape / batch-dependent GPU execution 可讓固定 seed 仍產生輸出差異；提出 isolated prefill + fixed-shape batched decode，利用 position invariance 實現 determinism。URL: https://arxiv.org/abs/2608.14376
4. **vLLM Batch Invariance** — 官方文件目前已提供 `VLLM_BATCH_INVARIANT=1`，使用 deterministic attention/operation implementations，並停用部分會引入 nondeterminism 的 optimization。官方亦明確指出 reproducibility 與性能間存在 trade-off。URL: https://docs.vllm.ai/en/latest/features/batch_invariance/
5. **Causal Agent Replay (CAR)** — 本輪深入 `RESEARCH/phase_0_foundations.md`、`src/car/replay/deterministic.py`、`src/car/replay/forward.py`，確認其 faithful replay 與 counterfactual forward replay 的環境語義不同。

---

## 本小時最重要 5 個發現

### 1. Same Seed ≠ Same Exogenous World

**概念**：Common Random Numbers (CRN) 的真正目標不是「兩個 run 用相同 seed」，而是讓 factual 與 counterfactual 中**語義上相同的隨機事件共享相同 exogenous random variable**。

錯誤做法：

```text
seed = 42
factual RNG calls:      r1 r2 r3 r4 r5
counterfactual calls:   r1 r2    r3 r4 r5
                         ↑ control flow changed
```

若 intervention 移除一個事件，stateful PRNG 後續 draw index 全部位移。表面上 seed 相同，但：

```text
factual.event_X randomness
≠
counterfactual.event_X randomness
```

這會把「隨機數錯位」誤判成 intervention effect。

更合理的底層形式：

```text
u_event = RNG(master_seed, event_key)
```

其中：

```text
event_key =
(session_id,
 causal_entity,
 semantic_event_type,
 logical_occurrence,
 stochastic_channel)
```

例如：

```text
RNG(seed, "payment-api/latency/request-17")
RNG(seed, "planner/tool-choice/decision-9")
RNG(seed, "sensor-noise/camera-2/frame-883")
```

**為什麼重要**：這讓 factual / counterfactual 可以共享真正對齊的 noise，因果 effect estimator 才不會被 execution-path noise 淹沒。

**限制**：event identity 本身需要穩定定義；若 intervention 造成事件被創建/刪除/拆分，哪些 event 應共享 random variable 仍是因果建模問題。

**來源**：Buffalo et al. 2026；Glasserman & Yao 1992 CRN 理論。

---

### 2. Replay Determinism 至少有四層，不是一個 boolean

CAR 原始碼已經明確顯示兩種不同 replay：

#### A. Faithful policy replay

`DeterministicReplay`：

```text
Recorded State
↓
Re-issue model call
↓
RecordedEnvironment
↓
inject original observation
↓
measure action-match rate
```

它刻意**不重新呼叫真實 tool**，所以 divergence 主要量的是 policy/provider nondeterminism。

#### B. Counterfactual forward replay

`run_forward()`：

```text
Recorded Prefix
↓
Intervention at k
↓
Policy samples new action
↓
LIVE environment.observe(action)
↓
continue new trajectory
```

因此 attribution variance 同時包含：

```text
Model stochasticity
+ Environment stochasticity
+ Tool/API drift
+ Clock/network noise
+ Changed external state
```

Hermes 應正式拆成四層：

```text
L0 State Reconstruction Fidelity
L1 Policy Replay Fidelity
L2 Environment Replay Fidelity
L3 Effect Replay Fidelity
```

其中：

```text
State reconstruction faithful
≠ policy deterministic

Policy deterministic
≠ environment deterministic

Environment deterministic
≠ external effects reproducible
```

**為什麼重要**：目前很多 Agent counterfactual benchmark 把「replay 成功」講成單一概念，production runtime 必須知道到底是哪一層失真。

**來源**：CAR `deterministic.py`, `forward.py`, phase_0 foundations。

---

### 3. LLM Replay Noise 的重要來源不是只有 sampling temperature

CAR foundation 明確採用「measure-and-report, not guarantee」：hosted providers 即使最 deterministic 設定也不能保證 bit-exact output；所以它量 action signature match，而非 token identity。

2025–2026 deterministic inference 系統進一步證實：

```text
fixed prompt
+ fixed seed
+ temperature 0
```

仍可能因為：

```text
batch composition
input shape
kernel tiling
reduction order
parallelism configuration
```

產生 logits 差異。

vLLM 現在提供 Batch Invariance，會採 deterministic implementations 並犧牲部分效能；CoRun 則主張以 fixed-shape scheduling 避免全面 batch-invariant kernel 的高 overhead。

因此 Hermes `ReplayEnvironmentFingerprint` 應至少保存：

```text
model_id
model_revision
provider
serving_engine
engine_version
sampling_params
seed_if_supported
system_fingerprint_if_available
batch_invariance_mode
parallelism_config
hardware_class
quantization
prompt_digest
tool_schema_digest
```

對 hosted provider 無法取得的欄位應標為：

```text
UNKNOWN / PROVIDER_HIDDEN
```

而不是假裝已控制。

**重要否定**：

```text
temperature=0 ≠ deterministic inference
fixed seed ≠ deterministic inference
same model name ≠ same inference environment
```

---

### 4. Environment Snapshot 應保存「可重建世界」，不只是 tool output cache

如果 counterfactual action 改變，不能只回放 factual tool outputs，因為新 action 可能需要新的 observation；但如果直接打 live Internet/API，又會讓 counterfactual comparison 被世界漂移污染。

Hermes 應加入：

```text
EnvironmentSnapshot
├ filesystem snapshot
├ database snapshot / MVCC timestamp
├ browser DOM / network fixture
├ HTTP fixture store
├ MCP resource snapshot
├ memory version
├ tool implementation version
├ virtual clock
├ RNG namespace
├ permissions/policy version
├ external service mocks
└ immutable artifact hashes
```

然後 counterfactual replay 優先：

```text
Counterfactual Action
↓
Snapshot-aware Tool Runtime
↓
if request covered by snapshot/model
    deterministic / event-keyed simulated response
else
    mark ESCAPED_SNAPSHOT
↓
never silently mix with live world
```

這裡最重要的新節點是：

```text
Replay World Boundary
```

一個 replay 一旦逃出 snapshot boundary，effect estimate 的可信度必須下降。

可借鑑 deterministic benchmark environment snapshot 的方向，但 Hermes 需要擴展到 browser/MCP/memory/multimodal sensor/tool side-effects。

---

### 5. Counterfactual effect 必須做 variance decomposition，而不是只有「跑 K 次」

目前常見做法：

```text
factual outcome samples
vs
counterfactual outcome samples
→ mean difference + CI
```

Hermes 應進一步估計：

```text
Observed Outcome Variance
≈
Policy Sampling Variance
+ Environment Variance
+ Tool/Network Variance
+ Inference-System Variance
+ Intervention Effect Heterogeneity
+ Interaction / residual
```

理想 paired estimator：

```text
Δ_i = Y_i(counterfactual, U_i) - Y_i(factual, U_i)
```

讓兩邊共享對齊的 exogenous randomness `U_i`，而不是：

```text
Y_cf(U_i) - Y_f(U_j)
```

CRN 成功時會讓 paired difference 的 variance 顯著下降；但經典文獻也指出 CRN **不是永遠有利**，若 induced correlation 不良甚至可能增加 variance。因此 runtime 應量測：

```text
paired_correlation
variance_independent
variance_crn
variance_reduction_ratio
```

再決定是否啟用特定 CRN channel。

---

# Architecture Breakdown

本輪建議 Hermes 增加一個完整：

## Counterfactual Replay Fidelity Runtime

```text
Factual Agent Run
↓
Execution Recorder
├ exact prompts/messages
├ tool schemas
├ model/provider metadata
├ tool outputs
├ clock reads
├ RNG/event keys
├ memory versions
├ policy versions
├ environment state hashes
└ external effects
↓
Snapshot Builder
├ Agent State Snapshot
├ Environment Snapshot
├ Tool/MCP Snapshot
└ Effect Ledger Snapshot
↓
Intervention Planner
↓
Counterfactual Validity Gate
↓
Paired Replay Coordinator
├ factual branch
└ counterfactual branch
       ↓
Common Exogenous Noise Manager
├ event-keyed RNG
├ virtual clock
├ network latency channel
├ sensor noise channel
└ policy seed where controllable
↓
Deterministic / Controlled Inference Layer
├ batch invariant local engine
├ fixed model revision
└ hosted-provider nondeterminism monitor
↓
Snapshot-Aware Tool Runtime
↓
Outcome Evaluator
↓
Variance Decomposer
↓
Replay Fidelity Certificate
↓
Influence / Shapley / Repair Engine
```

---

# Bottom-Level Logic

## A. Event-Keyed Randomness

不再：

```python
rng = Random(seed)
latency = rng.random()
noise = rng.random()
```

概念上改成：

```python
def stochastic_value(master_seed, event_key, channel):
    key = hash(master_seed, event_key, channel)
    return counter_based_rng(key)
```

底層目的不是 cryptographic security，而是：

```text
Random Variable Identity
independent_of
Execution Order
```

## B. Paired Replay

```text
for replicate i:
    U_i = ExogenousNoiseBundle(i)

    factual_i = replay(F, U_i)
    counterfactual_i = replay(CF, U_i)

    Δ_i = score(counterfactual_i) - score(factual_i)
```

再估：

```text
ATE_hat = mean(Δ_i)
SE = std(Δ_i) / sqrt(n)
CI = ATE_hat ± t*SE
```

Agent attribution 更實務的 outcome 可拆：

```text
GoalSuccess
SafetyViolation
ToolActionMatch
ExternalEffectCorrectness
Cost
Latency
```

不要把所有維度先壓成單分數。

## C. Replay Fidelity Vector

Hermes 不應只輸出：

```text
replay_fidelity = 0.91
```

而應保存：

```text
ReplayFidelityVector
├ state_reconstruction = 1.00
├ prompt_identity = 1.00
├ tool_schema_identity = 1.00
├ policy_action_match = 0.94
├ sequence_match = 0.81
├ environment_snapshot_coverage = 0.97
├ tool_fixture_coverage = 0.89
├ rng_alignment = 1.00
├ clock_control = 1.00
├ model_revision_match = UNKNOWN
├ inference_backend_match = UNKNOWN
├ external_effect_isolation = 0.76
└ replay_escape_count = 2
```

最後才依 task/safety scope 形成 certificate。

---

# Visual Simulation Idea

## Replay Fidelity & Variance Lab

### 視圖 1：雙世界 counterfactual timeline

```text
FACTUAL                         COUNTERFACTUAL

State S4                        State S4
   │                               │
Planner draw U_plan_9 ────────────┼── SAME EVENT-KEYED NOISE
   │                               │
Tool A                          Tool B
   │                               │
Latency U_net_A17              Latency U_net_B22
   │                               │
Outcome BAD                     Outcome GOOD
```

UI 可以切換：

```text
[Independent RNG]
[Same Seed Stateful RNG]
[Event-Keyed CRN]
```

使用者會直接看到 same-seed 模式在 control-flow 分岔後 random draw 對齊失效。

### 視圖 2：Variance Sources

```text
Observed Counterfactual Variance

Policy sampling        ███████ 31%
Environment             █████  23%
Inference backend       ███    14%
Tool/network            ████   19%
Residual                ███    13%
```

再開啟：

```text
EVENT-KEYED CRN
```

顯示 paired-effect CI 如何收窄。

### 視圖 3：Replay Boundary

```text
Snapshot World
├ DB ✓
├ Filesystem ✓
├ Memory ✓
├ MCP resources ✓
├ Weather API ✕ LIVE ESCAPE
└ Provider backend ? HIDDEN
```

任何 live escape 用醒目邊界顯示，避免 Console 把 counterfactual result 呈現成「已證明的因果結果」。

---

# Code / GitHub

## jaineet17/causal-agent-replay

值得持續閱讀：

```text
RESEARCH/phase_0_foundations.md
src/car/replay/deterministic.py
src/car/replay/forward.py
src/car/replay/intervene.py
src/car/attribute/shapley.py
src/car/attribute/sampling.py
src/car/budget/
src/car/store/
```

### `deterministic.py`

已確認：

- 先驗證 message-state reconstruction digest。
- `RecordedEnvironment` 不打 live tool，而是依序 inject 原 observation。
- replay 多次 re-issue policy，量 `StepMatch.match_rate`。
- 同時量 full `sequence_reproduction_rate`。
- 明確把 hosted provider nondeterminism 當成 measured metric，不宣稱 1.0。

### `forward.py`

已確認：

- counterfactual branch 直接從 recorded `state_before` 繼續。
- step k 可 forced action / observation / context / policy。
- suffix 預設使用 **live Environment**。
- source comment 明確說 real-tool side effects 目前 deferred。
- `coalition_forward()` 會 factual-hold coalition 中的 action，其他 step resample；observation 仍由 environment 產生。

### 對 Hermes 的直接工程含義

CAR 是非常好的 attribution core，但 production Hermes 仍需在其外層加：

```text
Environment Snapshot Manager
Event-Keyed RNG Manager
Replay Boundary Detector
Effect Sandbox
Provider/Inference Fingerprinter
Variance Decomposition
Replay Fidelity Certificate
```

---

# Papers

## 1. Realizing Common Random Numbers: Event-Keyed Hashing for Causally Valid Stochastic Models

- **Authors**：Vince Buffalo, Carl A. B. Pearson, Daniel Klein
- **Year**：2026
- **Institution**：本輪未從 primary metadata 驗證，暫不猜測
- **URL**：https://arxiv.org/abs/2603.11084
- **Code**：本輪未確認官方 code repository
- **Dataset**：非 dataset-centric；重點是 stochastic simulation methodology
- **Architecture / Mechanism**：counter-based RNG + semantic event identifier
- **Contribution**：指出 stateful PRNG + same base seed 在 control-flow 改變後不保持 causal alignment；提出 event-keyed randomness
- **Limitations**：需要穩定 event identity；對 event creation/deletion 的 cross-world matching 仍需 domain semantics
- **改變了什麼**：把「reproducibility seed」升級成「causally aligned exogenous variable identity」

## 2. Using Common Random Numbers for Simulation-based Planning with Rollouts

- **Authors**：Sandarbh Yadav, Frederic J Maliakkal, Harshad Khadilkar, Shivaram Kalyanakrishnan
- **Year**：2026
- **Institution**：本輪未從 primary metadata 驗證
- **URL**：https://arxiv.org/abs/2605.04732
- **Code**：本輪未確認
- **Architecture**：simulation rollout planner + CRN coupling
- **Contribution**：降低相對 action utility estimator variance
- **Limitations**：CRN 效果依系統結構/相關性而變，不能盲目假設永遠降低 variance
- **改變了什麼**：說明 paired randomness 不只是 audit 技巧，也能直接改善 planning sample efficiency

## 3. CoRun: Padding is Simple and Efficient for Deterministic LLM Inference

- **Authors**：Shiju Zhao, Jiacheng Yang, Qihang Chen, Junhao Hu, Jiaqi Zheng, Guihai Chen, Xusheng Chen
- **Year**：2026
- **URL**：https://arxiv.org/abs/2608.14376
- **Code**：本輪未確認官方 repository
- **Architecture**：isolated prefill + fixed-shape batched decode + CUDA graphs
- **Contribution**：用 scheduling/shape control 取得 deterministic inference，避免全面 batch-invariant kernel 的較高 overhead
- **Limitations**：系統結果需依 hardware/model/serving stack 驗證；不能直接外推 hosted black-box APIs
- **改變了什麼**：顯示 determinism 可以是 serving scheduler 的一級設計目標，而不是只靠 sampler seed

## 4. Causal Agent Replay: Counterfactual Attribution for LLM-Agent Failures

- **Code**：https://github.com/jaineet17/causal-agent-replay
- **URL**：https://arxiv.org/abs/2606.08275
- **Architecture**：record → state reconstruction → intervention → stochastic forward replay → outcome distribution → causal attribution
- **本輪新讀重點**：faithful replay injects recorded environment；counterfactual replay uses live environment abstraction
- **限制**：production real-tool side effects / environment snapshotting 尚非其核心已解問題
- **改變了什麼**：讓 Agent debugging 從 trace reading 變成可執行的 counterfactual experiment

---

# 已確認事實 / 論文結果 / 工程實作 / 推論 / 假說

### 已確認工程實作

- CAR `RecordedEnvironment` 使用原始 observation，不重新呼叫 real tool。
- CAR deterministic replay 量 action-match 與 full-sequence reproduction rate。
- CAR forward counterfactual suffix 使用 `Environment.observe()` 取得新 observation。
- vLLM 官方已有 Batch Invariance mode。

### 論文結果

- Event-keyed CRN 工作指出 stateful PRNG 在 path-changing intervention 下會造成 draw misalignment。
- CRN planning 工作主張 paired common randomness 可降低 rollout relative-utility variance。
- CoRun 報告 fixed-shape scheduling 可實現 deterministic inference，並改善相對 batch-invariant approaches 的效率。

### Hermes 工程推論

- Replay Fidelity 應是 vector，不是 scalar。
- Counterfactual replay 應設 `Replay World Boundary`。
- Tool/MCP/browser/memory 都應有 snapshot-aware runtime。
- Attribution engine 應先控制 stochastic variance，再談 influence score。

### 尚未驗證假說

- 對 Hermes 真實 MCP/tool workload，event-keyed CRN 可把 attribution CI 降低多少？
- hosted provider 的 action-match nondeterminism 是否主要集中在低-margin tool choices？
- 能否建立跨模型統一的 `ReplayFidelityCertificate` threshold，而不過度依賴 task-specific calibration？

---

# Unknown / Open Questions

1. **Semantic Event Identity 如何穩定？** factual 中一個 tool event 在 counterfactual 中可能被拆成兩次 retry；它們和原 event 的 exogenous-noise correspondence 如何定義？
2. **Hosted LLM 的 hidden serving state 怎麼處理？** 無法控制 batch/TP/kernel 時，只能量測 residual nondeterminism；需要怎樣的 CI 才能允許 production-level causal claim？
3. **外部 side effect 如何 snapshot？** payment/email/social post 等系統不適合直接 replay；需要 digital twin、fixture、shadow endpoint、sandbox 或 compensating semantics。

---

# 下一輪研究

下一輪優先：

## Deterministic Tool Sandboxing × Network Record/Replay × Browser Replay × Effect Virtualization

研究鏈：

```text
Agent Counterfactual
↓
Tool Call
↓
Filesystem / DB / Browser / HTTP / MCP
↓
Which inputs are nondeterministic?
↓
Record/Replay Boundary
↓
Network fixture / virtual clock / deterministic scheduler
↓
External Effect Virtualization
↓
Shadow Write / Dry Run / Digital Twin
↓
Effect-equivalence check
↓
Replay Fidelity Certificate
```

優先閱讀：

- rr / record-replay debugger 的 nondeterministic-input capture
- browser deterministic replay / network archive / WebReplay 類技術
- Temporal / workflow deterministic replay semantics
- DB MVCC / point-in-time snapshot
- deterministic tool sandbox / syscall virtualization
- side-effect simulation / shadow traffic / digital twins

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Replay Determinism
State Reconstruction Fidelity
Policy Replay Fidelity
Environment Replay Fidelity
Effect Replay Fidelity
Replay Fidelity Vector
Replay Fidelity Certificate
Common Random Numbers
Event-Keyed Randomness
Counter-Based RNG
Exogenous Noise Bundle
Semantic Event Identity
Randomness Alignment
Paired Counterfactual Replay
Variance Decomposition
Inference Backend Fingerprint
Batch Invariance
Replay World Boundary
Environment Snapshot
Snapshot Coverage
Replay Escape
Virtual Clock
Tool Fixture
Effect Isolation
```

## Edges

```text
Same Seed
≠ Same Exogenous World

Temperature Zero
≠ Deterministic Inference

State Reconstruction Fidelity
≠ Policy Determinism

Policy Determinism
≠ Environment Determinism

Environment Determinism
≠ Effect Reproducibility

Action Match
≠ Token Identity

Replay Executable
≠ Replay Faithful

Snapshot Coverage
≠ Full World Isolation

Common Random Numbers
MAY_REDUCE
Counterfactual Effect Variance

Event-Keyed RNG
PRESERVES_BETTER
Cross-World Randomness Alignment

Live Tool Call During Replay
MAY_CAUSE
Environment Drift

Batch-Invariant Inference
REDUCES
Inference-System Replay Noise
```

---

# 每輪結束檢查

- **缺哪一層？** Deterministic Tool/Browser/Network Sandbox + External Effect Virtualization。
- **哪個節點最淺？** `EffectReplayFidelity`、`SemanticEventIdentity`、`ReplayFidelityCertificate`。
- **哪個概念仍只是名詞？** `ReplayWorldBoundaryCertificate`、`CrossProviderInferenceFingerprint`、`EffectEquivalentReplay`。
- **哪個系統值得繼續讀原始碼？** Causal Agent Replay 的 `replay/`, `store/`, `record/`；其次 vLLM batch-invariance implementation。
- **哪篇論文需追引用？** `Realizing Common Random Numbers: Event-Keyed Hashing for Causally Valid Stochastic Models`，因為它直接決定 Agent counterfactual 是否真的在比較同一組 exogenous conditions。
- **哪個概念最適合視覺模擬？** Replay Fidelity & Variance Lab，尤其是 Stateful Same-Seed vs Event-Keyed CRN 的分岔動畫。
- **哪個 Agent 架構最值得實作？** `Paired Counterfactual Replay Runtime = Immutable Recorder + Environment Snapshot + Event-Keyed Exogenous Noise + Controlled Inference + Snapshot-Aware Tool Runtime + Variance Decomposer + Replay Fidelity Certificate`。

---

## 對「AI 到底怎麼運作」的新增一層

當使用者說一句話後，Agent 的一條實際 trajectory 可以寫成：

```text
UI
→ Context
→ Model / Reasoning
→ Action
→ Tool/MCP
→ Observation
→ Updated Context
→ Next Decision
→ External Effect
```

但如果要回答：

> 「如果其中一個記憶、tool result、policy 或模型決策不同，AI 是否仍會做同一件事？」

就不能只把 Agent 再跑一次。真正可驗證的 counterfactual 需要：

```text
Same reconstructed state
+
Controlled / aligned exogenous randomness
+
Known inference nondeterminism
+
Snapshot-bounded environment
+
Isolated effects
+
Repeated paired rollouts
↓
Effect distribution
+
Variance decomposition
+
Replay fidelity certificate
```

因此本輪最重要的結論是：**Agent 因果研究的基礎不是「能 replay」，而是能說清楚 replay 中哪些世界條件被固定、哪些隨機性被對齊、哪些條件仍不可控制，以及最後觀察到的差異有多少比例真的可以歸因於 intervention。**