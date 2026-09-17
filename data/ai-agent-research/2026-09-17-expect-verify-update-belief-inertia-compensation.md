# 【AI Agent × Multimodal Research Report】

**時間：2026-09-17 21:53（Asia/Taipei）**  
**主題：Estimate–Verify–Update × Belief Inertia × Late Evidence × Compensating Action Gate**

## 與歷史研究比較

上一輪已建立 EventTime / Watermark / LateEvidence / BeliefRevision，並指出最淺節點是 `CompensatingAction`。本輪不重複 watermark 定義，而把 late evidence 往上接到 embodied Agent 的 belief-management loop：研究 ACL 2026 EVU（Seeing Isn't Believing）原始碼與論文，建立「預期→觀察→驗證→信念修訂→計畫失效→補償」的可驗證 runtime architecture。

## 本小時新發現

### 1. Belief inertia 是 Agent failure 的獨立層，不應全部歸類為 perception 或 planning error

Wang et al. (ACL Findings 2026) 將 Agent 在明確環境 feedback 已與內部 belief 衝突時仍沿用舊 belief 的現象定義為 belief inertia，並提出 Estimate-Verify-Update (EVU) 主動管理 belief。這補上 Hermes 上一輪 `LateEvidence → BeliefRevision` 的語義層：evidence 抵達不等於 belief 真的被更新。

### 2. EVU 原始碼的 prompting loop 明確要求 expectation-vs-observation comparison

`verl-agent/agent_system/environments/prompts/alfworld.py` 的 OUR_METHOD prompt 每步要求：

```text
Reason:
  last action
  → what did you expect?
  → what did you actually observe?
  → confirm or contradict previous belief?
Belief State:
  explicit updated state
Thought:
  plan from updated belief
Action:
  execute next admissible action
```

這比一般 ReAct 的 `Thought → Action → Observation` 多出一個 explicit belief transition boundary。

### 3. Hermes 應把 EVU 與 provenance/watermark 結合，而不是只保存 textual belief

EVU 的 textual belief 很適合建立可檢查 state，但 Hermes 還需要上一輪的 evidence identity：

```text
ExpectedOutcome E_t
ActualObservation O_t
EvidenceProvenance P_t
TemporalCoverage C_t
↓
Verification V_t
↓
Belief B_t → B_(t+1)
```

只有 observation freshness / provenance 可證明時，contradiction 才能成為高強度 belief-revision evidence。

### 4. FFmpeg `fps` filter 再次確認 synthetic sample grid 可能 duplicate/drop frames

FFmpeg 官方文件明確說 `fps` filter 會為達到 constant frame rate 必要時 duplicate/drop frames，並以 PTS rounding 決定輸出位置。這支持上一輪結論：ReMA 類 pipeline 若經 fps resampling，`index/fps` 只能代表 sample-grid time，不應冒充 media-native PTS。

### 5. CompensatingAction 應由 action reversibility 與 causal dependency 決定

本輪提出 Hermes Recovery Gate：

```text
Late/Contradictory Evidence
→ Verify belief conflict
→ Invalidate dependent claim/belief
→ Traverse Belief→Plan→Action dependency
→ Action not executed: CANCEL
→ Executed + reversible: COMPENSATE
→ Executed + irreversible/safety-critical: STOP + ESCALATE
→ Re-plan from revised belief
```

這是 Hermes architecture proposal，尚不是 EVU 官方實作。

## 本小時最重要 5 個發現

1. **Belief inertia**：Agent 可正確收到 observation，卻仍在 reasoning/planning 使用舊 belief；因此 observation correctness ≠ belief freshness。
2. **Explicit verification boundary**：EVU 原始碼要求 expectation vs actual observation，再輸出 updated belief，提供可觀測的 belief transition point。
3. **Evidence-backed belief revision**：Hermes 應把 textual belief 接到 provenance、event time、coverage，而非把 LLM 自述 belief 當 ground truth。
4. **Sample-grid ≠ native timeline**：FFmpeg `fps` filter 的 duplicate/drop/rounding 機制再次證明 timestamp identity 必須分層。
5. **Compensation is causal recovery**：補償不能只由「動作失敗」觸發；應由新 evidence 推翻 belief 後沿 dependency graph 找出已執行且可逆的 action。

## Architecture Breakdown

```text
User Goal
→ Agent Belief B_t
→ Expected Outcome E_t
→ Plan P_t
→ Action A_t
→ Environment
→ Observation O_t
→ Provenance / EventTime / Watermark
→ Verification(E_t, O_t)
   ├ confirm → reinforce B_t
   ├ unknown → observe/search more
   └ contradict → BeliefRevision B_(t+1)
                    → invalidate dependent plan
                    → cancel / compensate / escalate
                    → re-plan
```

### System architecture：Evidence-Backed EVU Runtime

```text
BeliefState {
  belief_id
  statement
  support_evidence_ids[]
  valid_event_time_range
  confidence
  revision
  supersedes[]
}

VerificationRecord {
  expected_claims[]
  observed_evidence_ids[]
  verdict: CONFIRM | CONTRADICT | UNKNOWN
  evidence_strength
  temporal_coverage
  provenance_status
}

ActionRecovery {
  action_id
  execution_state
  reversibility: REVERSIBLE | PARTIAL | IRREVERSIBLE
  affected_by_belief_revision
  recovery: NONE | CANCEL | COMPENSATE | STOP_ESCALATE
}
```

## Bottom-Level Logic

### EVU / belief-management loop

```text
Previous Belief
→ predict expected consequence of action
→ execute action
→ environment observation
→ compare expected vs actual
→ classify confirmation / contradiction
→ explicitly rewrite belief state
→ generate thought/plan from revised belief
→ next action
```

### Evidence-strength gate

```text
Observation
→ source identity
→ source/native timestamp
→ normalized EventTime
→ provenance chain
→ temporal coverage
→ freshness
→ verification
```

Invariant proposal:

```text
BeliefRevisionAllowed
=
ObservationProvenanceValid
∧ ObservationFreshEnough
∧ VerificationVerdict != UNKNOWN
```

Safety-critical systems may require stronger modality/tool confirmation before destructive revision/action.

## Visual Simulation Idea

### Belief Inertia & Recovery Simulator

Five synchronized lanes:

```text
EVIDENCE   E1 ---- E2(late contradiction) ---- E3
BELIEF     B1 ========== stale =======> B2
PLAN       P1 ----------------X--------> P2
ACTION     A1 ---- A2(executed) ---- compensate
VERIFY     confirm ---- CONTRADICT ---- confirm
```

Controls: observation delay, stale frame, contradictory tool result, provenance loss, temporal coverage UNKNOWN, belief inertia ON/OFF, action reversibility, safety criticality. UI highlights `Expected → Actual → Verification → Belief Delta → Plan Delta → Recovery`.

## Code / GitHub

### EVU
Repository: https://github.com/WangHanLinHenry/EVU

值得看的結構：
- `verl-agent/agent_system/environments/prompts/alfworld.py`
- `verl-agent/agent_system/environments/prompts/scienceworld.py`
- `verl-agent/agent_system/environments/prompts/virtualhome.py`
- `verl-agent/agent_system/environments/env_manager.py`
- `docs/EXPERIMENTS.md`
- `data/alfworld/`, `data/scienceworld/`, `data/virtualhome/`
- `eval/`

原始碼確認：ALFWorld OUR_METHOD prompt 明確要求 Reason（expected vs actual / confirm vs contradict）→ Belief State → Thought → Action；repo 支援 ALFWorld、ScienceWorld、VirtualHome，並包含 SFT/RL/inference 實驗結構。

## Papers / Technical Sources

1. **Seeing Isn't Believing: Mitigating Belief Inertia via Active Intervention in Embodied Agents** — Hanlin Wang, Chak Tou Leong, Jian Wang, Wenjie Li; ACL Findings 2026; paper reports EVU and experiments on three embodied benchmarks. Code: https://github.com/WangHanLinHenry/EVU. Architecture: explicit Estimate/Verify/Update belief intervention. Contribution: treats belief inertia as a distinct agent failure and actively rewrites belief after feedback. Limitation: textual belief representation does not by itself prove multimodal provenance/freshness.
2. **A Study of Belief Revision Postulates in Multi-Agent Systems (Extended Version)** — Michael Thielscher, Tran Cao Son, 2026. Formalizes generalized AGM-style revision in multi-agent epistemic models. Useful as formal correctness reference; not a streaming embodied runtime implementation.
3. **FFmpeg Filters Documentation — fps** — official documentation. Confirms CFR conversion may duplicate/drop frames and exposes PTS rounding controls; supports Hermes native-time vs sample-grid-time distinction.

## 已確認 / 官方 / 論文 / 工程 / 推論 / 假說

**已確認工程實作：** EVU repo prompt explicitly performs expected-vs-actual reasoning, explicit belief-state output, then planning/action. Repository contains three embodied environment pipelines and experiment assets.

**官方資訊：** FFmpeg fps filter converts to constant frame rate through frame duplication/drop as needed and applies timestamp rounding.

**論文結果：** EVU reports belief inertia and gains from active belief intervention across three embodied benchmarks; Thielscher/Son formalize multi-agent belief revision postulates.

**合理工程推論：** EVU-style textual belief transition becomes substantially more auditable when each observation is linked to provenance/time/freshness evidence.

**尚未驗證假說：** `EVU + TemporalCoverage + Provenance + ActionCompensation` will reduce stale-belief action failures under delayed/out-of-order multimodal evidence; requires a fault-injection benchmark.

## Unknown / Open Questions

1. EVU training/inference code stores belief as parseable structured state or primarily as generated text carried in prompt history?
2. How should contradiction thresholds differ for deterministic tool evidence versus VLM/audio semantic evidence?
3. How can compensation policies be learned/tested without allowing an Agent to treat irreversible actions as safely reversible?

## 下一輪研究

```text
EVU env_manager.py
→ parse model output
→ persist last-turn Reason/Belief/Thought/Action
→ identify exact belief-state carrier
→ SFT/RL reward path

Then
Action Dependency Graph
→ reversible / partial / irreversible taxonomy
→ Saga-style compensation
→ safety gate
→ fault injection benchmark
```

並建立最小 benchmark：`correct observation but stale belief`、`late contradictory frame`、`tool result supersedes visual belief`、`belief revised after action executed`。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `BeliefInertia`
- `ExpectedOutcome`
- `VerificationRecord`
- `ExplicitBeliefState`
- `BeliefFreshness`
- `BeliefRevisionGate`
- `ActionReversibility`
- `ActionDependency`
- `CompensationPolicy`
- `RecoveryEscalation`

### Edges
```text
ExpectedOutcome → compared_with → Observation
Observation → backed_by → ProvenanceEvidence
VerificationRecord → updates → BeliefState
BeliefInertia → violates → BeliefFreshness
BeliefRevision → invalidates → DependentPlan
BeliefRevision → may_invalidate → ExecutedAction
ExecutedAction → classified_by → ActionReversibility
ReversibleAction → may_trigger → CompensatingAction
IrreversibleAction → may_trigger → StopAndEscalate
```

## 本輪結束判斷

- **缺哪一層：** belief revision 後對已執行 action 的 transaction/compensation semantics。
- **哪個節點最淺：** `CompensationPolicy`。
- **哪個概念仍只是名詞：** semantic contradiction threshold 的可靠校準。
- **哪個系統值得讀原始碼：** EVU `env_manager.py` 與 RL/SFT rollout path；之後比較 durable workflow/Saga runtime。
- **哪篇論文需追引用：** EVU，尤其後續 belief inertia / active belief intervention 工作。
- **哪個概念最適合視覺模擬：** Expected→Observed→Verify→Belief Delta→Plan Delta→Compensation。
- **哪個 Agent 架構最值得實作：** Evidence-backed EVU loop，而不是單純 ReAct loop。

## 回到「AI 到底怎麼運作」

```text
Camera / Voice / Tool / Sensor
→ Native Time / Provenance
→ Encoder / Tokens / Observation
→ Expected-vs-Actual Verification
→ Explicit Belief State
→ Reasoning
→ Planning
→ Action
→ Environment Feedback
→ Belief Revision
→ Re-plan / Compensation
```

核心結論：**可靠 Agent 不只是 Observation→Reasoning→Action。它還必須顯式管理「我原本相信什麼、我預期會看到什麼、實際 evidence 是什麼、兩者是否衝突、舊 belief 是否應被撤銷，以及舊 belief 已造成的 action 是否需要取消、補償或升級處理」。這把上一輪的 late evidence 從資料流問題提升成真正的 Agent cognition + runtime recovery 問題。**