# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-11 11:52 Asia/Taipei  
**主題**：State Abstraction × Bisimulation × Task-Conditional Sufficiency × Memory Retention / Eviction × Restore-Counterfactual Verification  
**承接上一輪**：`2026-09-11-predictive-state-belief-filtering-minimal-sufficient-state.md`

---

## 0. 本輪與歷史研究比較：避免重複

上一輪已建立：

```text
Full History
→ Belief / Predictive State
→ Multi-Horizon Sufficiency
→ State Aliasing Detector
→ Minimality / Redundancy Pressure
→ State Certificate
```

但仍留下核心缺口：

> 兩個不同 state 到底什麼時候可以安全合併？一段 history 到底什麼時候可以安全刪除？

如果只用「看起來相似」或 embedding cosine，可能把未來行為不同的狀態合併；如果只用 recency，可能刪掉一個很久以前、但之後工具呼叫仍需要的 token / path / identifier。

因此本輪不再研究「如何得到 predictive state」，而是研究 predictive state 之上的 **behavioral equivalence、abstraction distortion 與 deletion safety**。

本輪核心新分界：

```text
Visual Similarity
≠ Latent Similarity
≠ Predictive Similarity
≠ Bisimulation
≠ Task-Conditional Equivalence
≠ Safe-to-Evict Memory
```

---

# 本小時新發現

## 新論文 / 架構 / GitHub

### 1. Compositional Behavioral Semantics for State Abstraction in Reinforcement Learning
- **Authors**：Yivan Zhang, Ziyan Luo, Manuel Baltieri
- **Year**：2026
- **URL**：https://arxiv.org/abs/2606.25357
- **Architecture / Theory**：以 coalgebra / homomorphism 形式統一 value functions、invariants、bisimulation relations、behavioral metrics，並研究抽象系統與具體系統之間 behavioral structure 的 pushforward / pullback。
- **Contribution**：將「抽象後哪些行為性質仍可安全保留」從個別 proof，提升到 compositional semantics。
- **Limitations**：目前核心保證偏 exact homomorphism；真實 learned abstraction 多為 approximate，需要 lax / quantitative extension。
- **改變了什麼**：對 Hermes 而言，state abstraction 不應只是一個 encoder；它應是一個附帶 preservation contract 的 runtime transform。

### 2. Adaptive state-action abstractions via rate-distortion
- **Author**：Fernando E. Rosas
- **Institution**：University of Sussex（公開研究頁資訊）
- **Year**：2026
- **URL**：https://arxiv.org/abs/2606.06123
- **Architecture**：soft state/action abstraction + rate-distortion + Bellman residual + bisimulation-type abstraction error。
- **Contribution**：將 value error 拆成 learning error 與 abstraction error；當 learning error 降到 abstraction floor 附近，再提高 abstraction resolution。
- **Dataset / Domains**：tabular domains（Four Rooms、Taxi、DoorKey、SysAdmin 等）。
- **Limitations**：主要驗證仍在 tabular / controlled settings，尚不能直接等同於 multimodal long-horizon agent context。
- **改變了什麼**：state resolution 應該是動態的，不是固定 latent dimension。

### 3. Learning What Not to Forget: Long-Horizon Agent Memory from a Few Kilobytes of Learning
- **Authors**：Nusrat Jahan Lia, Aritra Mazumder
- **Year**：2026
- **URL**：https://arxiv.org/abs/2606.20954
- **Architecture**：Learned Relevance Eviction（LRE），CPU-only、小型 relevance scorer，在寫入/eviction 時預測哪些 history units 是 load-bearing，採 verbatim retention。
- **Benchmarks**：AppWorld、LoCoMo 等。
- **Contribution**：在 matched budget 下，agent task completion 接近 full history；報告 worst-case prompt peak 可降低 52%，LoCoMo 讀取 token 降低 68%。
- **Limitations**：relevance scorer 仍是資料/任務分布依賴；「未來 query 尚未出現」下的 load-bearing estimation 仍可能漏判。
- **改變了什麼**：Memory eviction 應被視為未來決策 fidelity 問題，而不只是 token compression。

### 4. TokenPilot: Cache-Efficient Context Management for LLM Agents
- **Authors**：Buqiang Xu, Zirui Xue, Dianmou Chen, Chenyang Fu, Chiyu Wu, Caiying Huang, Chen Jiang, Jizhan Fang, Xinle Deng, Yijun Chen, Yunzhi Yao, Xuehai Wang, Jin Shang, Gong Yu, Ningyu Zhang
- **Year**：2026
- **URL**：https://arxiv.org/abs/2606.17016
- **Code / integration**：https://github.com/zjunlp/LightMem2 （目前 GitHub 專案路由到 LightRSI codebase）
- **Architecture**：Ingestion-Aware Compaction + Lifecycle-Aware Eviction + stable prefix / cache continuity。
- **Benchmarks**：PinchBench、Claw-Eval。
- **Contribution**：把 context compression 與 inference prompt-cache topology 一起考慮，而不是只算剩多少 tokens；論文報告不同模式下 56%–87% cost reductions。
- **限制**：runtime support 依 host 而異；repository 目前也明確存在 adapter-specific capability differences。
- **改變了什麼**：Context state 的「位置與生命週期」本身會影響 serving cost，memory policy 必須理解 runtime cache。

### 5. What Eviction Destroys: A Restore-Counterfactual Audit of Forgetting in Agent Memory
- **Author**：Chen Shen
- **Year**：2026-09-08
- **URL**：https://arxiv.org/abs/2609.08279
- **Benchmark**：LongMemEval-S
- **Architecture / Evaluation**：對每個 question 做 paired restore intervention：將 gold evidence 重新注入 context，再重跑 reader，區分 recoverable / irreversible / residual error。
- **Contribution**：第一次把 eviction 損失分成「證據仍在但 retrieval 沒拿到」與「證據真的被 eviction 毀掉」。
- **Limitations**：restore gold evidence 是 oracle audit，不是 online agent 可以直接取得的真實操作。
- **改變了什麼**：Agent memory benchmark 必須把 storage loss 與 retrieval failure 分開。

### 6. Understanding Behavioral Metric Learning: A Large-Scale Study on Distracting Reinforcement Learning Environments
- **Authors**：Ziyan Luo, Tianwei Ni, Pierre-Luc Bacon, Doina Precup, Xujie Si
- **Venue**：Reinforcement Learning Journal / RLC 2025
- **URL**：https://arxiv.org/abs/2506.00563
- **Evaluation**：20 state-based + 14 pixel-based tasks，370 configurations。
- **Contribution**：指出 bisimulation / behavioral metric learning 的理論概念與 deep implementation 之間存在大量 design gap；加入 denoising factor 與 isolated metric estimation 分析。
- **限制**：仍是 RL benchmark；尚未直接涵蓋 LLM agent context / tool lifecycle。
- **改變了什麼**：不要把「latent distance 看起來符合 bisimulation objective」直接等同於真的學會 behavioral equivalence。

---

# 本小時最重要 5 個發現

## 1. Bisimulation 的核心不是「兩個 state 很像」，而是「所有 relevant action 下的行為後果可以被互換」

### 概念

最直觀的 MDP bisimulation 條件：若兩個 states `s_i, s_j` 對每個 relevant action：

```text
Immediate reward approximately same
+
Next-state distribution over equivalence classes approximately same
```

才可以視為 behaviorally equivalent。

常見 metric 形式：

```text
d(s_i, s_j)
≈
|r_i - r_j|
+
γ · W(P_i, P_j)
```

其中 `W` 是 next-state distribution 的 Wasserstein / behavioral distance。

### 底層如何運作

```text
State pair (s_i, s_j)
↓
Same / candidate action a
↓
Reward difference
+
Transition distribution difference
↓
Recursive behavioral distance
↓
Equivalent / mergeable?
```

Deep Bisimulation for Control（DBC）將這個距離轉成 representation objective。

我本輪直接讀了 `facebookresearch/deep_bisim4control/agent/bisim_agent.py`，核心 encoder loss 實際做：

```text
h  = encoder(obs)
h2 = shuffled paired latent

z_dist = distance(h, h2)
r_dist = distance(reward, reward2)
transition_dist = distance(predicted next-latent distributions)

bisimilarity = r_dist + gamma * transition_dist
loss = (z_dist - bisimilarity)^2
```

也就是強迫：

```text
Latent Distance
≈
Reward Difference
+
Discounted Future-Dynamics Difference
```

### 為什麼重要

Hermes 的 memory merge / summary merge 也應採相似原理：

```text
Memory A
Memory B
```

不是因為語意 embedding 很近就能合併，而要問：

```text
對目前 task / future tool decisions：
它們是否會導致相同 action choice？
是否保留相同 tool arguments？
是否保留相同 safety state？
是否產生相同 future evidence distribution？
```

### 限制

2025 的大型 behavioral metric study 顯示，deep metric learning 有顯著 implementation / estimation gap；representation robustness 的提升不必然代表 metric 本身估得準。

### 驗證狀態
- Bisimulation 理論：已確認（經典 MDP theory）。
- DBC source implementation：已確認 GitHub 原始碼。
- 「直接移植到 LLM memory equivalence」：工程推論，尚未經 benchmark 驗證。

---

## 2. State abstraction 應該有「Preservation Contract」，不是只有 compression ratio

### 是什麼

Compositional Behavioral Semantics 2026 的重要點不是再提出一個 encoder，而是問：

> 把 concrete states 映射到 abstract states 後，哪些 behavioral structures 還能安全 transfer？

其 abstraction 可視為：

```text
φ : Concrete State X → Abstract State Z
```

而合格 abstraction 需讓 dynamics / observations 的映射關係一致（homomorphism-style preservation）。

### Hermes 工程轉譯

未來所有：

```text
Memory compression
Context summary
State merge
Tool-log compaction
Multimodal event aggregation
```

都應回傳：

```text
AbstractionCertificate
├ preserved_properties[]
├ non_preserved_properties[]
├ task_scope
├ action_scope
├ estimated_distortion
├ verification_tests[]
├ source_state_ids[]
├ abstract_state_id
├ model_epoch
└ evidence_roots[]
```

例如摘要可以宣告：

```text
Preserved:
- current task objective
- unresolved tool IDs
- authorization state
- latest file path

Not guaranteed:
- exact wording
- all historical rationales
```

### 為什麼重要

目前多數 agent memory 把 summary 當新事實；但 summary 本質上應是一個 **lossy state abstraction**。

### 限制

Exact homomorphism 太強；LLM / multimodal runtime 更需要 approximate preservation + explicit distortion budget。

---

## 3. 「State 要多細」不應固定；應由 learning error 與 abstraction error 動態決定

### 是什麼

Adaptive State-Action Abstraction 2026 將總 value error 拆成：

```text
Total Decision Error
≤
Learning Error
+
Abstraction Error
```

其中：

```text
Learning Error ≈ Bellman residual
Abstraction Error ≈ bisimulation / rate-distortion bound
```

核心策略：

```text
先用 coarse abstraction
↓
學習誤差下降
↓
當 learning error ≈ abstraction error floor
↓
再 refine abstraction
```

### Hermes 轉譯

```text
High uncertainty / early task
→ coarse memory state acceptable

Task converges / high-stakes decision approaching
→ refine relevant state
→ restore raw evidence / expand state resolution
```

所以應有：

```text
StateResolutionController
```

而不是永遠：

```text
固定摘要長度 = 500 tokens
```

### 底層機制

可建立 agent 版 rate-distortion：

```text
Rate = retained bytes / tokens / KV pages / memory nodes

Distortion = expected decision loss after compression
```

目標：

```text
minimize Rate
subject to DecisionDistortion <= epsilon(task, risk)
```

### 限制

如何估 LLM agent 的 decision distortion 仍是未解問題；reward / transition 不像 MDP benchmark 那麼乾淨。

---

## 4. Memory retention 應從「重要性」升級成「Load-Bearing Future Dependency」

### LRE 帶來的新觀念

一個 memory unit 是否該留，不是看：

```text
最近嗎？
很長嗎？
語意很重要嗎？
```

而是看：

```text
如果移除它，未來 task outcome 是否會壞掉？
```

LRE 把 eviction 視為 fidelity 問題，學一個便宜 relevance scorer，將 load-bearing history 原文保留。

### TokenPilot 再多補一層

Context management 還有 serving topology：

```text
任意刪除中間 tokens
→ prefix mismatch
→ prompt cache invalidation
→ GPU inference cost 上升
```

所以 TokenPilot 同時考慮：

```text
Ingestion Compaction
+
Lifecycle Eviction
+
Stable Prefix
```

我本輪也直接讀到目前 LightRSI/TokenPilot codebase：

```text
components/packages/features/eviction/src/lifecycle-planner.ts
```

其 lifecycle planner 實際包含：

```text
Task registry
Delta window
TaskStateEstimator
History blocks
Current / active / blocked / unresolved tasks
Eviction policy
Context mutation plan
```

而不是一個單純 `if age > N then delete`。

其中 `safeHistoryBlocks()` 顯式保護：

```text
current turn
active task
blocked task
unresolved-question task
closure-deferred task
```

才允許 history block 進入 eviction candidate pool。

### Hermes 應做的版本

```text
MemoryUnit
↓
Task Dependency Graph
↓
Decision-Relevance Score
↓
Lifecycle State
↓
Cache / Context Placement Cost
↓
RETain / SUMMARIZE / OFFLOAD / EVICT
```

### 限制

Task registry / estimator 若本身錯誤，仍可能把真正的 hidden dependency 判成 evictable。

---

## 5. Eviction benchmark 必須做 Restore-Counterfactual，否則不知道到底是「丟掉」還是「沒取回」

### 問題

當 agent 答錯時：

```text
Memory failure
```

其實至少有三種：

```text
1. Evidence retained, retrieval failed
2. Evidence evicted, irreversible loss
3. Evidence restored, still fails → reader/reasoner residual failure
```

### Restore-Counterfactual

2026-09 的研究採用：

```text
Original run
↓ incorrect

Gold evidence retained?
+
Restore gold evidence into read context
↓ rerun same reader
```

可分成：

```text
RECOVERABLE
IRREVERSIBLE
RESIDUAL
```

該研究在 LongMemEval-S 報告，8k token budget 下四種 eviction policies 的 restore-correctable errors 中 irreversible share 達 1.00；80k top-k retrieval 下則可同時看到 recoverable 與 irreversible error。

### 對 Hermes 的重要性

Memory Console 不應只顯示：

```text
Accuracy: 78%
```

而要顯示：

```text
Failure decomposition

Eviction destruction     11%
Retrieval miss            7%
Reasoning residual        4%
Tool observation loss     2%
```

### 限制

Gold-evidence restore 是 offline oracle audit；online runtime 需要以 replay / shadow copy / sampled restore approximation。

---

# Architecture Breakdown

## State Abstraction × Memory Lifecycle Runtime

```text
User / Camera / Voice / Tool / MCP / Runtime Events
↓
Raw Evidence & History Store
↓
Predictive State Compiler
↓
Candidate State / Memory Units
↓
Behavioral Equivalence Engine
├ reward/task-outcome equivalence
├ action-conditioned transition equivalence
├ safety equivalence
├ tool-argument equivalence
└ future-evidence equivalence
↓
Approximate Bisimulation / Distortion Metric
↓
Task-Conditional Abstraction Graph
↓
State Resolution Controller
├ MERGE
├ KEEP DISTINCT
├ REFINE
└ RESTORE RAW
↓
Memory Lifecycle Planner
├ retain
├ summarize
├ offload
└ evict
↓
Cache / Context Placement Optimizer
↓
Planner / Reasoner / Tool Router
↓
Action
↓
Outcome
↓
Restore-Counterfactual Auditor
↺ update abstraction / retention policy
```

### 建議插入 Hermes Runtime 的位置

```text
Raw Context / Memory
↓
Predictive State Compiler
↓
NEW: Behavioral Equivalence & Abstraction Plane
↓
NEW: Retention / Eviction Lifecycle Plane
↓
Context Compiler
↓
Reasoning / Planning
```

---

# Bottom-Level Logic

## A. Approximate Bisimulation

對 state pair `s_i, s_j`：

```text
for action a:
  immediate = D_outcome(r(s_i,a), r(s_j,a))
  future    = W(P(.|s_i,a), P(.|s_j,a))
  distance  = immediate + gamma * future
```

Agent-memory 版可改為：

```text
D_agent(m_i,m_j | task)
=
α · D(next_action_distribution)
+ β · D(tool_argument_distribution)
+ γ · D(future_observation_distribution)
+ δ · D(safety_constraint_state)
+ ε · D(goal_progress)
```

只有 `D_agent < threshold(task,risk)` 才允許 merge / summarize-equivalent。

## B. Rate-Distortion Memory Objective

```text
min  MemoryCost(Z)
+
λ · ExpectedDecisionDistortion(H → Z)
```

其中：

```text
MemoryCost
= tokens + KV pages + storage + retrieval cost + latency

DecisionDistortion
= action divergence
+ tool-argument error
+ safety violation probability increase
+ goal failure probability increase
```

## C. Retain / Summarize / Offload / Evict

```text
Memory Unit
↓
Is active-task dependency?
├ YES → RETAIN RAW
└ NO
   ↓
Does an abstract equivalent preserve current task behavior?
├ NO → RETAIN / OFFLOAD
└ YES
   ↓
Will deleting break restoreability?
├ YES → SUMMARIZE + ARCHIVE RAW
└ NO → EVICT
```

## D. Restore-Counterfactual Audit

```text
Failure observed
↓
Replay from same checkpoint
↓
Restore candidate evidence e
↓
Same reader / same policy
↓
Outcome changes?
├ YES + e was evicted → irreversible eviction damage
├ YES + e still existed → retrieval failure
└ NO → downstream reasoning / model / tool failure
```

---

# Visual Simulation Idea

## **State Equivalence & Memory Eviction Lab**

### View 1：Bisimulation Merge Map

```text
State A                          State B
Door unlocked                   Door unlocked
User wording X                  User wording Y
Tool token same                 Tool token same
        \                       /
         \                     /
          behavioral distance
                  0.03
                    ↓
                MERGE SAFE
```

另一組：

```text
State C                          State D
Door locked                     Door unlocked
pixels almost same              pixels almost same
embedding cosine .99

behavioral distance 0.81
↓
KEEP SEPARATE
```

### View 2：Abstraction Frontier

X 軸：Memory / Context Cost  
Y 軸：Decision Distortion

```text
Distortion ↑
1.0 | ● tiny summary
    |    ●
    |       ●
    |            ● full predictive state
0.0 +------------------------------→ memory cost
```

讓使用者調：

```text
Risk tolerance
Task horizon
Safety criticality
Tool dependency
Token budget
KV budget
```

即時看到最佳 abstraction resolution 變化。

### View 3：Eviction Lifecycle

```text
LOGIN TOKEN      ACTIVE     PIN
FILE PATH        ACTIVE     PIN
OLD TOOL LOG     DONE       OFFLOAD
OLD CHAT SMALL   EQUIV      SUMMARIZE
NOISE OUTPUT     NONE       EVICT
```

### View 4：Restore-Counterfactual Audit

```text
Question failed
↓
Restore evidence #E42
↓
Success

Classification:
IRREVERSIBLE EVICTION DAMAGE
```

並顯示全 session：

```text
Eviction destruction   18
Retrieval miss          11
Reasoning residual       5
Unknown                  3
```

---

# Code / GitHub

## 1. facebookresearch/deep_bisim4control

值得看的核心檔案：

```text
agent/bisim_agent.py
agent/deepmdp_agent.py
encoder.py
decoder.py
train.py
```

本輪確認 `agent/bisim_agent.py` 的 `update_encoder()`：

```text
z_dist = smooth_l1(h, h2)
r_dist = smooth_l1(reward, reward2)
transition_dist = distance(pred_next_distribution_1, pred_next_distribution_2)

bisimilarity = r_dist + discount * transition_dist
loss = (z_dist - bisimilarity)^2
```

這是 Hermes 未來 `BehavioralDistanceLearner` 的最小可執行 baseline。

## 2. zjunlp/LightRSI（TokenPilot / LightMem2 current codebase）

值得看的核心目錄：

```text
components/packages/features/eviction/src/
components/packages/features/eviction/src/lifecycle-planner.ts
components/packages/features/eviction/src/types.ts
components/presets/tokenpilot/
components/adapters/*/
website/plugin-catalog/tokenpilot/
```

`lifecycle-planner.ts` 已確認包含：

```text
SessionTaskRegistry
DeltaView
HistoryBlock
TaskStateEstimator
EvictionPolicy
ContextMutationPlan
```

並 fail-closed：輸入 invalid、estimator 缺失、duplicate window 等情況會 bypass / defer，而不是直接刪 context。

這一點對 Hermes 很重要：

> Eviction engine 應是 transactional / versioned / fail-closed subsystem，不應只是字串裁切函式。

---

# Papers

| Title | Authors | Institution / Venue | Year | Code | Dataset / Domain | 核心貢獻 | 主要限制 |
|---|---|---|---:|---|---|---|---|
| Compositional Behavioral Semantics for State Abstraction in RL | Y. Zhang, Z. Luo, M. Baltieri | arXiv / 2026 research | 2026 | 未確認公開 code | RL theory | 統一 behavioral semantics 與 abstraction transfer guarantees | exact abstraction 偏強 |
| Adaptive state-action abstractions via rate-distortion | Fernando E. Rosas | University of Sussex | 2026 | 未確認 | Four Rooms / Taxi / DoorKey / SysAdmin | 動態調整 abstraction resolution | tabular 為主 |
| Learning What Not to Forget | Lia, Mazumder | arXiv | 2026 | 本輪未確認官方 code | AppWorld / LoCoMo | Learned relevance eviction | task-distribution dependence |
| TokenPilot | Xu et al. | Zhejiang / collaborators, arXiv | 2026 | LightMem2 / LightRSI | PinchBench / Claw-Eval | stable prefix + lifecycle eviction | host capability differences |
| What Eviction Destroys | Chen Shen | arXiv | 2026 | 本輪未確認 | LongMemEval-S | restore-counterfactual audit | oracle restoration |
| Understanding Behavioral Metric Learning | Luo, Ni, Bacon, Precup, Si | RLJ / RLC | 2025 | modular codebase reported | 370 RL configs | 揭露 behavioral metric theory-practice gap | RL-centric |
| Learning Invariant Representations for RL without Reconstruction (DBC) | Amy Zhang, Rowan McAllister, Roberto Calandra, Yarin Gal, Sergey Levine | UC Berkeley / McGill etc. | 2020/2021 | facebookresearch/deep_bisim4control | DMControl / CARLA | latent distance ≈ bisimulation distance | metric approximation assumptions |

---

# Unknown / Open Questions

## 1. LLM Agent 的「reward」到底應該換成什麼？

Bisimulation 在 MDP 中有 reward / transition，但 Agent Runtime 同時有：

```text
goal completion
subgoal progress
tool success
permission state
safety
latency
cost
user correction
```

因此需要 **multi-objective behavioral signature**，而非單一 scalar reward。

## 2. Task-conditional equivalence 如何跨 future task？

某段 memory 對目前 task 完全無用，對未來 task 卻可能重要：

```text
Current task equivalence
≠ Global future equivalence
```

需要：

```text
TaskScope
Retention Horizon
Cross-Task Reuse Probability
```

## 3. 如何 online 估 Decision Distortion？

不能每刪一段 context 都完整 rerun 所有 future branches；需要：

```text
learned surrogate
+ sampled counterfactual replay
+ high-risk exact audit
```

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
State Abstraction
Behavioral Equivalence
Bisimulation Relation
Bisimulation Metric
Approximate Bisimulation
Behavioral Distance
State Homomorphism
Abstraction Certificate
Preservation Contract
Abstraction Distortion
State Resolution Controller
Rate-Distortion Abstraction
Decision Distortion
Task-Conditional Equivalence
Memory Lifecycle State
Load-Bearing Memory
Lifecycle-Aware Eviction
Stable Prefix
Cache Continuity
Restore Counterfactual
Irreversible Eviction Damage
Recoverable Retrieval Failure
Residual Reader Failure
Eviction Certificate
```

## 新增 Edges

```text
ConcreteState --ABSTRACTS_TO→ AbstractState
AbstractState --PRESERVES→ BehavioralProperty
StatePair --HAS_BEHAVIORAL_DISTANCE→ BisimulationMetric
Task --CONDITIONS→ StateEquivalence
MemoryUnit --SUPPORTS→ FutureDecision
MemoryUnit --HAS_LIFECYCLE→ LifecycleState
EvictionDecision --REMOVES→ MemoryUnit
EvictionDecision --HAS_EXPECTED_DISTORTION→ DecisionDistortion
RestoreIntervention --TESTS→ EvictionDamage
ContextMutation --AFFECTS→ PromptCacheContinuity
```

## 新增否定關係

```text
Visual Similarity ≠ Behavioral Equivalence
Embedding Similarity ≠ Bisimulation
Predictive Similarity ≠ Task Equivalence
Compression Ratio ≠ Abstraction Quality
Small Latent ≠ Safe Abstraction
Summary ≠ Lossless State
Old Memory ≠ Irrelevant Memory
Low Attention ≠ Safe to Evict
Low Recency ≠ Safe to Evict
Task Completed ≠ Globally Useless
Evidence Retained ≠ Evidence Retrieved
Memory Failure ≠ Eviction Failure
Eviction Failure ≠ Retrieval Failure
Cache-Efficient ≠ Decision-Safe
Exact Bisimulation ≠ Practical Deep Metric Accuracy
```

---

# 下一輪研究

本輪將：

```text
Predictive State
→ Behavioral Equivalence
→ Abstraction
→ Memory Retention / Eviction
```

接起來之後，下一個最深缺口變成：

# **Task Graph × Dependency Closure × Causal Memory Retention × Future-Use Prediction**

原因是：即使目前能計算 task-conditional equivalence，仍然必須回答：

```text
哪個舊 evidence
會透過哪條 dependency path
在未來某個 subtask / tool call 再次變成必要？
```

下一輪應研究：

```text
Task DAG
↓
Dependency Closure
↓
Evidence → Subgoal → Tool Argument → Outcome
↓
Future Use Probability
↓
Retention Value
↓
Eviction Risk
↓
Counterfactual Replay
```

並正式區分：

```text
Semantic Relevance
≠ Causal Dependency
≠ Future Utility
```

---

# 本輪收斂回答

- **缺哪一層**：Task-Dependency / Future-Use causal retention layer。
- **哪個節點最淺**：`DecisionDistortion` 的 online calibration；目前仍多靠 offline counterfactual / benchmark。
- **哪個概念仍只是名詞**：Universal `AbstractionCertificate ABI`、`EvictionCertificate ABI`、Cross-Task Behavioral Distance。
- **哪個系統值得讀原始碼**：`zjunlp/LightRSI` 的 eviction / task registry / context mutation pipeline；其次 `facebookresearch/deep_bisim4control` 的 encoder / transition objective。
- **哪篇論文需追引用**：2026 Compositional Behavioral Semantics、Adaptive State-Action Abstraction、2026-09 Restore-Counterfactual Eviction Audit。
- **哪個概念最適合視覺模擬**：State Equivalence & Memory Eviction Lab，尤其是「embedding 很像但 future behavior 不同」與 restore-counterfactual failure decomposition。
- **哪個 Agent 架構最值得實作**：

> **Behavioral-Abstraction Memory Runtime = Predictive State Compiler + Task-Conditional Bisimulation Engine + Abstraction Certificate + Dynamic Resolution Controller + Task Lifecycle Registry + Retention/Eviction Planner + Cache-Aware Context Mutator + Restore-Counterfactual Auditor**

---

# 從「使用者說一句話」到底發生什麼：本輪新增位置

```text
User says one sentence
↓
UI
↓
Agent Runtime
↓
Raw Context / Memory
↓
Predictive State Compiler
↓
NEW: Behavioral Equivalence / Bisimulation
↓
NEW: Merge / Keep-Separate / Refine Decision
↓
NEW: Retain / Summarize / Offload / Evict
↓
Context Compiler
↓
Reasoning / Planning
↓
Tool / MCP / Model
↓
GPU inference
↓
Action / Output
↓
Outcome
↓
NEW: Restore-Counterfactual Memory Audit
↺
```

**本輪核心結論**：成熟 Agent 的 memory 不應只問「這段資訊看起來重要嗎？」；它應問「如果我把這兩個 state 合併、把這段 history 摘要或刪除，對所有目前 relevant action 的未來結果會不會改變？」。Bisimulation 提供 state equivalence 的底層語言，rate-distortion 提供壓縮與決策失真的權衡，LRE / TokenPilot 提供長期 agent memory 的工程方向，而 restore-counterfactual 則提供驗證『到底是哪一次遺忘真的造成失敗』的方法。