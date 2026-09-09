# 【AI Agent × Multimodal Research Report】

**時間：2026-09-10 05:54（Asia/Taipei）**

**本輪主題：Speculative / Hedged Agent Execution × Winner Commit × Loser Suppression × Cost-Aware Racing × Speculative Tool/Sandbox Execution**

> 研究狀態標記：`CONFIRMED_OFFICIAL` = 官方文件/原始碼可直接確認；`PAPER_RESULT` = 論文作者在指定實驗中報告；`ENGINEERING_INFERENCE` = 基於多來源推導出的 Hermes 設計；`OPEN_HYPOTHESIS` = 尚待實驗驗證。

---

## 本小時新發現

本輪承接上一輪的 Capability Epoch / Late Result Fencing，但不再研究「單一長任務取消後晚到」，而是研究更進一步的：Runtime 主動同時啟動多份候選工作，以降低 tail latency 或提前準備下一步，之後只允許一個 winner 進入 canonical state。

核心序列：

```text
Intent
↓
Speculation Eligibility
↓
Candidate Generation
↓
Hedge Delay / Speculation Trigger
↓
Parallel Execution
├ Candidate A
├ Candidate B
└ Candidate C
↓
Candidate Result Validation
↓
Winner Selection
↓
Winner Commit Gate
↓
Loser Cancellation
↓
Late Loser Completion
↓
DISCARD / CACHE / QUARANTINE / FORK
```

本輪新追到 2026 年 Agent-specific speculative execution：

1. **PASTE — Act While Thinking: Accelerating LLM Agents via Pattern-Aware Speculative Tool Execution**（Microsoft Research, 2026）：從歷史 agent tool sequence 中挖掘 recurring control-flow / data-flow pattern，讓下一個 tool 在 LLM 還在推理時提前執行；論文報告平均 task completion time 減少 48.5%、tool throughput 提升 1.8×。來源：https://www.microsoft.com/en-us/research/publication/act-while-thinking-accelerating-llm-agents-via-pattern-aware-speculative-tool-execution/ 、https://arxiv.org/abs/2603.18897
2. **SpecBox — Speculative Sandbox Scheduling for Efficient LLM Agent Serving**（2026）：在 LLM token generation 中途根據 keyword + streaming semantic embedding 預熱 sandbox，再以 stochastic prefetch 預測後續 sandbox switch；論文報告 P99 E2E latency 最高降低 2.9×，相對永久保留 sandbox 的 baseline peak memory 減少 45.9%。來源：https://arxiv.org/abs/2607.23933
3. **Speculate with Memory: Lossless Acceleration for LLM Agents**（2026）：speculator 使用 transition table、episodic memory、confusion tracker，預測 action / observation / chained steps；作者宣稱 speculation 在 idle time 進行且不改 actor trajectory，因此是 lossless，並報告 action prediction 19–39% relative accuracy improvement。來源：https://arxiv.org/abs/2607.12236
4. **Speculative Uncertainty**（2026-09-04）：反過來用小 draft model 對大型 coding agent 已生成的 trajectory 打 cross-likelihood，建立 pre-execution veto/routing signal；作者報告 execution error rate 降低 6–8 percentage points、token cost 下降 14–19%。來源：https://arxiv.org/abs/2609.05274
5. 傳統 distributed-system hedging 仍是關鍵底座：Google《The Tail at Scale》與 gRPC request hedging 都採「啟動 duplicate request → 第一個成功 response 勝出 → cancel outstanding requests」的模式。來源：https://research.google/pubs/the-tail-at-scale/ 、https://grpc.io/docs/guides/request-hedging/

---

## 本小時最重要 5 個發現

### 1. Hedging 與 Speculation 是兩種不同的「多候選執行」

**概念**

- Hedging：同一 logical operation 的 duplicate attempts，主要目標是對抗 tail latency / straggler。
- Speculation：預測未來可能需要的 operation，提早執行，主要目標是把未來 latency 藏在現在的 reasoning/idle window 裡。

```text
HEDGING
same intent
same semantic operation
A ─┐
B ─┼→ first acceptable result wins
C ─┘

SPECULATION
current state
├ likely future A
├ likely future B
└ likely future C
   ↓
only actually selected branch may commit
```

`CONFIRMED_OFFICIAL`：gRPC hedging 會依 `maxAttempts`、`hedgingDelay`、`nonFatalStatusCodes` 發送多個相同 RPC attempts，第一個成功 response 之後取消其餘 attempts；gRPC-java 的 `HedgingPolicy` 與 `RetriableStream` 原始碼也明確存在 `maxAttempts`、hedging delay、active hedges、`winningSubstream`、freeze hedging 與 commit 邏輯。

**為什麼重要**：Hermes 不能用一個 `speculative=true` flag 同時表示兩者。因為 hedging 的結果通常具有 semantic equivalence，而 future-action speculation 的結果可能根本不是目前 plan 所需要的。

**限制**：即使是「同一 RPC」，若 endpoint 有副作用且不具 idempotency/fence，duplicate attempt 仍可能造成 duplicate external effect。

來源：gRPC Request Hedging；grpc-java `core/src/main/java/io/grpc/internal/HedgingPolicy.java` 與 `RetriableStream.java`。

---

### 2. First Result ≠ Winner；Winner ≠ Committed Winner

傳統 hedging 常用「first successful response wins」，但 Agent Runtime 必須再多兩層：

```text
FIRST COMPLETION
↓
Candidate Validation
↓
ACCEPTABLE CANDIDATE
↓
Winner Policy
↓
PROVISIONAL WINNER
↓
Commit Fence
↓
COMMITTED WINNER
```

`ENGINEERING_INFERENCE`：對 Agent 來說，候選結果需要至少驗證：

```text
result integrity
input identity
capability epoch
task generation
branch compatibility
freshness
safety policy
external effect state
quality/confidence
```

因此推薦：

```text
Winner ≠ Fastest
Winner = argmin / argmax over admissible candidates
```

可能的 policy：

```text
Score_i =
  Quality_i
- λ_latency · Latency_i
- λ_cost · Cost_i
- λ_risk · Risk_i
```

但只有通過 commit eligibility 的 candidate 才能進 Score 比較。

**為什麼重要**：coding agent、research agent、multimodal generation 的「最快」可能只是最快產生錯誤。2026-09-04 的 Speculative Uncertainty 顯示，可在 execute 前利用 draft-model-derived signal 做 veto/routing，而不是單純最早返回就採用。

**限制**：quality/risk score 本身會有 calibration error；不能假設 verifier 永遠正確。

---

### 3. Loser Cancellation ≠ Loser Suppression

這是本輪最重要的 bottom-level correctness 機制。

```text
Winner A commits
↓
Cancel B / C
```

並不能保證：

```text
B / C 已經停止
```

而上一輪已確認 MCP Tasks / workflow activity cancellation 可能是 cooperative。因此 speculative runtime 必須做到：

```text
Winner Commit
↓
Loser Authority Revocation
↓
Cancellation Request
↓
Late Completion Can Still Arrive
↓
Result Commit Gate
↓
REJECT LOSER COMMIT
```

正式新增兩個不同 primitive：

```text
cancel_loser(execution_id)
```

和

```text
suppress_loser_commit(completion_envelope)
```

`ENGINEERING_INFERENCE`：**Winner commit 必須是 authority transition，而不只是 UI / scheduler state transition。** 一旦 generation 內 winner 被選出，該 speculative group 的 commit token 應 atomic 地轉為：

```text
OPEN
→ WON_BY(candidate_id)
```

其他 candidate 即使稍後完成，也必須從 canonical state commit path 被拒絕。

---

### 4. Agent Speculation 必須依 Effect Class 分級

PASTE 的方向非常重要：side-effect-free tool 才適合 full speculation；有副作用的 operation 應使用 dry-run / staging / warm-up 等 transformed speculation。

Hermes 應建立：

```text
SpeculationClass
├ S0 PURE_COMPUTE
├ S1 READ_ONLY
├ S2 PREPARE_ONLY
├ S3 IDEMPOTENT_EFFECT
├ S4 COMPENSABLE_EFFECT
└ S5 IRREVERSIBLE_EFFECT
```

政策：

```text
S0 → full hedge/speculation allowed
S1 → full speculation with freshness check
S2 → prewarm / prefetch / dry-run only
S3 → only with semantic-effect ID + idempotency/fence
S4 → strict effect verification + compensation budget
S5 → no speculative commit; usually prepare only
```

這使 PASTE / SpecBox 類「Act While Thinking」可以安全接進 Hermes，而不是為了 latency 直接讓 agent 在 LLM 還未確定意圖時就寫外部世界。

**為什麼重要**：speculative tool execution 的 latency improvement 很大，但錯誤的 speculation 會把錯誤從「浪費計算」升級成「提前修改世界」。

**限制**：side-effect classification 不是純 schema 問題；同一 HTTP POST 可能是可重複、補償式、或不可逆，需 capability metadata + provider contract。

---

### 5. Token-level Speculative Decoding 與 Agent-level Speculative Execution 共享「Draft → Verify → Accept/Reject」抽象，但 commit domain 完全不同

Speculative decoding：

```text
Draft Model
↓
propose token block
↓
Target Model verifies
↓
accept prefix
↓
reject remainder
```

Agent-level speculation：

```text
Pattern / Small Model / Scheduler
↓
predict tool / sandbox / action branch
↓
pre-execute candidate
↓
Actor / Planner later reveals actual branch
↓
validate
↓
promote or discard
```

vLLM 現在仍提供 `SpeculativeConfig`、draft model / EAGLE / n-gram 等 speculative methods；最新文件甚至支援 heterogeneous vocabulary 的 Token-Level Intersection，但 probabilistic acceptance 在該模式仍有限制。來源：https://docs.vllm.ai/en/latest/features/speculative_decoding/

Medusa 則以多 decoding heads + tree attention 同時提出多 token continuation，再由 backbone 驗證；論文報告 Medusa-1 >2.2×、Medusa-2 2.3–3.6× speedup（指定模型/測試條件）。來源：https://arxiv.org/abs/2401.10774

**核心差異**：token reject 通常只丟棄未輸出的 token；agent speculative loser 可能已消耗 CPU/GPU、啟動 sandbox、讀取外部資源，甚至產生副作用。所以：

```text
Token Acceptance Gate
≠
Agent Result Commit Gate
```

---

## Architecture Breakdown

### System Architecture：Speculative / Hedged Hermes Runtime

```text
User Goal
↓
Agent Planner
↓
Execution DAG / Current State
↓
Speculation Controller
├ Hedge Detector
├ Future-Step Predictor
├ Pattern Miner
├ Draft Model
├ Latency Predictor
└ Cost/Risk Model
↓
Speculation Eligibility Gate
├ Effect Class
├ Capability Policy
├ Resource Budget
├ Confidence Threshold
└ Branch Constraints
↓
Speculative Group
├ Candidate A
├ Candidate B
├ Candidate C
└ Candidate D
↓
Execution Plane
├ Model Provider Race
├ Tool RPC Hedge
├ MCP Tool
├ Sandbox Prewarm
├ Retrieval Prefetch
└ GPU Generation
↓
Completion Envelopes
↓
Candidate Validator
↓
Winner Selector
↓
Atomic Winner Commit Gate
↓
Canonical State / Artifact / Observation
↓
Loser Revocation
↓
Cancellation Plane
↓
Late Loser Suppression
↓
Cache / Quarantine / Delete / Fork
```

### PASTE-style path

```text
Historical Tool Trajectories
↓
Pattern Mining
├ recurring control-flow
└ argument/data dependency
↓
Pattern Pool
↓
Current Agent Events
↓
Pattern Match
↓
Predicted Tool + Argument Mapper
↓
Risk / Utility Score
↓
Speculative Tool Process
↓
LLM eventually emits actual next tool
├ MATCH → Promote / Reuse result
└ MISMATCH → Cancel / Discard / Cache
```

### SpecBox-style path

```text
Streaming LLM Tokens
↓
Keyword + Semantic Intent Signal
↓
Predicted Sandbox Type
↓
Preallocate / Prewarm Sandbox
↓
Future Tool Intent Arrives
├ MATCH → warm sandbox handoff
└ MISMATCH → release speculative sandbox
```

---

## Bottom-Level Logic

### 1. Speculation group identity

```text
SpecGroup
├ spec_group_id
├ logical_intent_id
├ branch_id
├ capability_epoch
├ task_generation
├ candidate_ids[]
├ commit_state
└ winner_id?
```

### 2. Candidate envelope

```text
CandidateResult
├ candidate_id
├ spec_group_id
├ attempt_id
├ model/tool/provider
├ input_hash
├ effect_class
├ capability_epoch
├ generation
├ start_time
├ completion_time
├ cost
├ output_hash
├ external_effect_evidence
└ quality/risk metadata
```

### 3. Atomic winner transition

Pseudo-state machine：

```text
OPEN
  ↓ compare_exchange
WON_BY(A)
```

Candidate B 同時完成：

```text
CAS(OPEN → WON_BY(B))
FAIL
↓
B = LOSER
↓
NO CANONICAL COMMIT
```

這比「先收到 response 的 callback 就寫 state」安全很多。

### 4. Hedge trigger

傳統 delayed hedging：

```text
Primary starts
↓
wait hedge_delay
↓
if no acceptable completion:
    launch secondary
```

gRPC 官方 `hedgingDelay` 正是這個控制面；`maxAttempts` 限制 parallel attempts，non-fatal code / server pushback 又可以提前或阻止 hedge。

Hermes 應進一步改成 adaptive：

```text
launch hedge if
P(primary_latency > SLA | context) × expected_delay_saved
>
resource_cost + duplicate_effect_risk
```

### 5. Speculation utility

可作為 Hermes scheduler 的初始工程模型：

```text
ExpectedUtility(candidate) =
P(candidate_needed)
× ExpectedLatencySaved
× P(commit_eligible)
-
ComputeCost
-
MemoryCost
-
CancellationCost
-
SideEffectRisk
```

`OPEN_HYPOTHESIS`：之後可用實際 Hermes traces 學習每個 tool / model / sandbox 的 `P(candidate_needed)` 與 latency distribution，讓 hedge delay、top-k、speculation depth 動態化。

---

## Visual Simulation Idea

# Speculative Agent Race & Winner Commit Lab

中央 timeline：

```text
TIME ─────────────────────────────────────────→

Planner      ───── thinking ─────── actual tool=B

Candidate A       [tool A──────────────done]
Candidate B          [tool B────done]
Candidate C             [tool C────────────────done]

Commit Gate                     ↑
                                B WINS
                                CAS OPEN→B

Cancel A/C                     cancel ─────────→
Candidate C                                    late result
                                               ↓
                                           SUPPRESSED
```

可讓使用者調：

```text
hedge delay
max candidates
prediction confidence
GPU/CPU budget
side-effect class
provider latency distribution
quality threshold
cancellation latency
```

注入情境：

```text
PRIMARY STRAGGLER
LOSER FINISHES AFTER CANCEL
TWO RESULTS SAME MILLISECOND
FAST BUT LOW-QUALITY RESULT
STALE GENERATION RESULT
SIDE-EFFECTING TOOL
SANDBOX COLD START
MODEL PROVIDER OUTAGE
```

UI 同時顯示：

```text
Candidate A
Latency: 2.1s
Quality: 0.91
Cost: $0.020
Commit eligible: YES

Candidate B
Latency: 1.2s
Quality: 0.72
Cost: $0.008
Commit eligible: YES

Policy = FASTEST_ACCEPTABLE
Threshold = 0.80

WINNER = A
```

另一模式 `FASTEST` 則會選 B，讓使用者直接看見 latency/quality trade-off。

對副作用 tool：

```text
charge_card
Speculation Class = S5 IRREVERSIBLE

FULL SPECULATION: BLOCKED
PREPARE ONLY: ALLOWED
```

這個視覺化可以把 CPU branch prediction、LLM speculative decoding、distributed request hedging、Agent tool speculation 四種「推測執行」放在同一畫面比較，但明確區分各自的 acceptance / commit boundary。

---

## Code / GitHub

### grpc/grpc-java

值得深入：

```text
core/src/main/java/io/grpc/internal/
├ HedgingPolicy.java
├ RetriableStream.java
├ ManagedChannelServiceConfig.java
└ ServiceConfigUtil.java
```

原始碼確認：

- `HedgingPolicy` 保存 `maxAttempts`、`hedgingDelayNanos`、`nonFatalStatusCodes`。
- `RetriableStream.hasPotentialHedging()` 同時檢查 `winningSubstream == null`、attempt count 與 frozen state。
- `headersRead()` 會對該 substream 執行 `commitAndRun()`；若它成為 `winningSubstream` 才往 master listener 傳遞。
- hedging 的 close path 維護 `activeHedges`，只有當沒有 active/potential hedges 或遇到不可 hedge 狀態才進 commit。
- retry 與 hedging 是同一 transport runtime 中不同 state path。

來源：https://github.com/grpc/grpc-java

### vLLM

值得深入：

```text
vllm/config/speculative.py
speculative decoding proposer / scorer / rejection sampler path
```

重點不是直接移植 token speculative decoding，而是研究其：

```text
propose
→ verify
→ accept prefix
→ reject remainder
```

如何抽象成 Agent candidate lifecycle。

來源：https://github.com/vllm-project/vllm 、https://docs.vllm.ai/en/latest/features/speculative_decoding/

### 下一批值得找 code 的 2026 系統

- PASTE：Pattern miner / argument mapper / speculative scheduler / side-effect policy。
- SpecBox：streaming intent detector / sandbox dependency graph / semantic result cache / shared-memory transport。
- Speculate with Memory：transition table / episodic memory / confusion tracker。

若官方 code 尚未公開或搜尋不到，不把第三方重現當成官方 implementation。

---

## Papers

### The Tail at Scale
- **Title:** The Tail at Scale
- **Authors:** Jeffrey Dean, Luiz André Barroso
- **Institution:** Google
- **Year:** 2013
- **URL:** https://research.google/pubs/the-tail-at-scale/
- **Code:** N/A
- **Dataset:** production-scale systems / case studies rather than public benchmark dataset
- **Architecture:** tail-tolerant large-scale service design; includes hedged/tied requests and other latency-variability mitigation
- **Contribution:** 把 tail latency 從單節點問題提升為大規模 fan-out 系統的核心 architecture 問題
- **Limitations:** 不是 Agent / LLM system；對 speculative side effects、LLM quality verification、Agent branch semantics 無直接模型
- **改變了什麼:** 為現代 Agent model/tool/provider racing 提供 hedged execution 的底層原型

### Act While Thinking: Accelerating LLM Agents via Pattern-Aware Speculative Tool Execution
- **Authors:** Yifan Sui, Han Zhao, Rui Ma, Zhiyuan He, Hao Wang, Jianxun Li, Yuqing Yang
- **Institution:** Microsoft Research / collaborators
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2603.18897
- **Code:** 本輪未確認官方 code repository
- **Benchmarks:** 論文涵蓋 coding / deep-research / scientific-agent workloads
- **Architecture:** pattern analyzer + control/data-flow pattern pool + speculative tool scheduler + side-effect-aware speculative execution
- **Contribution:** 把 speculation 從 token / RPC 層提升至 Agent 的 tool-call sequence 層
- **Reported Result:** 平均 task completion time -48.5%，tool throughput 1.8×（作者指定實驗）
- **Limitations:** prediction accuracy、resource slack、side-effect classification 與 workload repeatability 會限制收益；不能把 paper-reported speedup 泛化到所有 Agent
- **改變了什麼:** 證明 Agent LLM-tool 串行 loop 可以透過「思考時先做下一步」被 pipeline 化

### SpecBox: Speculative Sandbox Scheduling for Efficient LLM Agent Serving
- **Authors:** Yihui Zhang, Tianyu Wo, Jinghao Wang, Xiaoyang Sun, Menghao Zhang, Cangzhou Yuan, Li Li, Chunming Hu, Albert Y. Zomaya, Renyu Yang
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.23933
- **Architecture:** streaming semantic intent → sandbox prewarm → stochastic future-sandbox prefetch → semantic result cache → shared-memory artifact transport
- **Reported Result:** P99 latency up to 2.9× lower vs on-demand baseline；peak memory -45.9% vs permanently-reserved sandbox baseline
- **Limitations:** sandbox prewarm 主要消除 resource readiness latency，不等於真正提前執行有副作用 tool
- **改變了什麼:** 把 speculation boundary 從「tool result」再往前推到「tool environment readiness」

### Speculate with Memory: Lossless Acceleration for LLM Agents
- **Authors:** Yu Li, Qinyuan Ye, Prafulla Kumar Choubey, Jiaxin Zhang, Chien-Sheng Wu
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.12236
- **Architecture:** contrastive transition table + episodic memory + confusion tracker + speculative predictor
- **Contribution:** 讓 speculator 從 stateless predictor 變成可由歷史 trajectory 累積改善的 memory-bearing component
- **Reported Result:** action prediction relative accuracy +19–39%；部分 repetitive observation prediction 最高 2.5× improvement
- **Limitations:** 「lossless」成立在 speculation 不改 actor trajectory 且只利用 idle window 的設計條件；不等於所有有外部 effect 的 speculation 都天然 lossless
- **改變了什麼:** 把 Agent Memory 從 reasoning memory 延伸為 execution prediction memory

### How to Speculate about Uncertainty in Agentic Coding? A Draft-Model Gate Method
- **Authors:** Konstantin Grotov, Valentin Malykh
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2609.05274
- **Code:** 本輪未確認官方 code
- **Architecture:** black-box large agent trajectory → small draft model cross-likelihood → phase-aware features → calibrated failure score → pre-execution gate/routing
- **Reported Result:** error rate -6–8 percentage points；token cost -14–19%（作者指定 coding-agent deployment）
- **Limitations:** failure score 非 correctness proof，且 calibration / OOD shift 仍需持續驗證
- **改變了什麼:** 展示 draft model 不只能「提早生成」，也能作為 Agent execution admission controller

### Medusa: Simple LLM Inference Acceleration Framework with Multiple Decoding Heads
- **Authors:** Tianle Cai, Yuhong Li, Zhengyang Geng, Hongwu Peng, Jason D. Lee, Deming Chen, Tri Dao
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2401.10774
- **Architecture:** multiple decoding heads → candidate tree → tree attention → backbone verification
- **Reported Result:** Medusa-1 >2.2×；Medusa-2 2.3–3.6× speedup（指定實驗）
- **Limitations:** token-level speculation，不處理 tool side effects / external-world commits
- **改變了什麼:** 提供「多候選同時計算、一次驗證」的模型級 analog，可用來幫助設計 Agent winner-selection simulator

---

## Unknown / Open Questions

### 1. Winner 應該什麼時候被 irreversible 地決定？

過早 winner commit：latency 低，但可能錯失稍晚且品質更高 candidate。

過晚 commit：品質較高，但失去 hedging 的 latency 目的。

需要研究：

```text
commit-on-first-valid
commit-after-quality-window
quorum verifier
anytime winner replacement
```

尤其不可逆 external effect 一旦 committed，winner replacement 幾乎不再成立。

### 2. Speculation budget 如何在多層同時存在時統一控制？

同一個 Agent request 可能同時：

```text
hedge LLM provider
+
speculative decode
+
prefetch RAG
+
prewarm sandbox
+
speculate next tool
+
spawn multi-agent branches
```

若每層自己只看局部 latency，總 resource amplification 可能爆炸。需要 unified speculation budget / admission controller。

### 3. 如何證明 speculative execution 是「semantically lossless」？

需要正式化：

```text
observable canonical trajectory(speculative)
==
observable canonical trajectory(non-speculative)
```

至少對 PURE / READ_ONLY 工具比較有可能；對會改外部世界的 action，則必須納入 effect journal、fence、dry-run/staging、compensation，否則不能宣稱 lossless。

---

## Knowledge Graph 新增 Node / Edge

### New Nodes

```text
Speculative Execution
Hedged Execution
Speculative Group
Candidate Execution
Hedge Delay
Tail Latency
Latency Distribution
Candidate Validator
Provisional Winner
Committed Winner
Winner Commit Gate
Atomic Winner Token
Loser Execution
Loser Cancellation
Loser Commit Suppression
Speculation Budget
Resource Amplification
Speculation Eligibility
Speculation Class
Pattern-Aware Tool Predictor
Argument Mapper
Sandbox Prewarm
Execution Prediction Memory
Speculative Uncertainty Gate
Quality-Latency-Cost Policy
```

### New Edges

```text
Tail Latency
→ motivates
Hedged Execution

Hedged Execution
→ launches
Duplicate Candidate Execution

Speculative Execution
→ predicts
Future Candidate Execution

Candidate Result
→ validated_by
Candidate Validator

Valid Candidate
→ competes_for
Winner Commit Gate

Winner Commit Gate
→ atomically_selects
Committed Winner

Committed Winner
→ revokes
Loser Commit Authority

Loser Cancellation
≠
Loser Commit Suppression

First Completion
≠
Committed Winner

Hedging
≠
Future-Step Speculation

Speculative Decoding
→ shares_pattern_with
Agent Speculative Execution

Token Acceptance Gate
≠
Agent Result Commit Gate

Effect Class
→ constrains
Speculation Eligibility

Historical Agent Trajectory
→ improves
Execution Prediction Memory

Speculation Budget
→ constrains
Resource Amplification
```

---

## 與歷史研究比較

上一輪已建立：

```text
Capability Epoch
Task Generation
Cancellation Intent
Late Result
Result Commit Gate
```

本輪沒有重複這些 primitive，而是把它們擴展成「一開始就允許多份工作同時存在」：

```text
ONE execution
→ late-result fence
```

升級為：

```text
MANY candidate executions
→ candidate validation
→ winner election
→ atomic commit
→ loser authority revocation
→ loser suppression
```

也就是從 **stale completion safety** 進到 **speculative concurrency correctness**。

---

## 下一輪研究

下一輪建議直接進：

# Unified Speculation Budget × Admission Control × Tail-Latency Prediction × Multi-Layer Resource Amplification

真正要回答：

```text
一個 Agent request
到底值得同時花幾倍算力去換 latency？
```

拆解：

```text
Request SLA
↓
Latency Distribution Estimator
↓
Critical Path Estimator
↓
Speculation Opportunity Detector
↓
Budget Allocator
├ Model Hedge Budget
├ Tool Hedge Budget
├ Retrieval Prefetch Budget
├ Sandbox Prewarm Budget
├ GPU Generation Budget
└ Multi-Agent Branch Budget
↓
Adaptive Admission Controller
↓
Observe Tail / Cost / Quality
↓
Online Policy Update
```

應比較：

```text
fixed p95 hedge delay
vs
adaptive quantile hedge
vs
bandit policy
vs
cost-aware expected utility
vs
SLO-aware constrained optimization
```

並研究 admission control、token bucket、server pushback、backpressure 與 global resource fairness，避免 speculative execution 在高負載時反過來製造 tail collapse。

---

## 本輪結束回答

- **缺哪一層：** 缺跨 model/tool/retrieval/sandbox/multi-agent 的 Unified Speculation Budget 與 Admission Control。
- **哪個節點最淺：** `Winner Quality Policy`，目前只有 latency/quality/cost 的工程模型，尚未有 Hermes 真實 trace 校準。
- **哪個概念仍只是名詞：** `Semantically Lossless Agent Speculation`、`Cross-Runtime Speculative Group ABI`。
- **哪個系統值得讀原始碼：** grpc-java `RetriableStream.java` 是 request-level hedging winner/commit state machine 的最佳參考；下一步則應追 PASTE / SpecBox 若官方 code 可得。
- **哪篇論文需追引用：** PASTE（2603.18897）最值得追，因為它直接命中 Agent 的 LLM↔Tool serial bottleneck；其次是《The Tail at Scale》。
- **哪個概念最適合視覺模擬：** `Speculative Agent Race & Winner Commit Lab`。
- **哪個 Agent 架構最值得實作：** `Effect-Aware Speculative Agent Runtime = Speculation Controller + Eligibility Gate + Candidate Group + Validator + Atomic Winner Commit + Loser Suppression`。

## 本輪核心結論

> 真正的 Agent speculative execution 不是「多跑幾個模型，看誰先回來」。可靠設計必須把候選工作包成同一 Speculative Group，先限制哪些 capability 可以被投機，再讓多個 candidate 並行；完成後不是 first-response-wins，而是 Candidate Validation → Winner Policy → Atomic Commit Gate。Winner 一旦 commit，Loser 即使無法及時取消、甚至真的完成，也只能 cache、quarantine、discard 或 fork，不能再修改 canonical Agent state。只有把 execution plane 與 commit plane 分開，hedging、speculative tool execution、sandbox prewarm、model racing 才能同時獲得低 latency 與 correctness。
