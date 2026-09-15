# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 11:54（Asia/Taipei）**  
**主題：Active Evidence Acquisition × Critical-Step Selection × Evaluation Context Compression**

## 與歷史研究比較

上一輪已建立 Calibration Surface，並確認 Outcome Correctness ≠ Trajectory Correctness；本輪不再重複「Judge 是否需要完整 trajectory」，而是回答下一個 runtime 問題：**完整 trajectory 太貴、outcome-only 又漏 silent faults，那 Evaluation Agent 應該選哪些 step / observation / modality 進入 judge context？**

本輪結論：evaluation context 不應是固定 prompt，而應是一個主動規劃問題。Hermes 應維護 `TrajectoryEvidenceGraph`，先找可能改變 verdict 的 critical steps，再以 Verification Value of Information（VoI）決定是否展開 observation、執行 sandbox probe、載入圖片或擴張鄰近 steps。

---

## 本小時新發現

1. **Verified Critical Step Optimization for LLM Agents (CSO)** — Findings of ACL 2026。方法以 PRM 找 candidate critical steps，再由 expert model 提出替代 action，從替代點用原 policy 繼續 rollout；只有能把失敗 trajectory 翻成成功 outcome、且 policy 自己可執行到成功的 alternative 才成為 DPO supervision。報告在 GAIA-Text-103 / XBench-DeepSearch 相對 SFT 提升 37% / 26%，而 supervision 只落在約 16% trajectory steps。核心啟示：trajectory 的決策價值高度不均勻，critical-step selection 可以比 uniform step inspection 更有效率。

2. **Verifiable Process Rewards for Agentic Reasoning (VPR)** — Yuan et al., 2026。把 objective symbolic/algorithmic oracle 轉成 turn-level reward，解決 long-horizon outcome reward 的 credit assignment 稀疏性；三類實例為 search-based dynamic deduction、constraint verification、posterior-based probabilistic inference。限制是 open-ended environment 並不總有可靠 intermediate oracle。

3. **AttnCompress: Dynamic Attention-Guided Trajectory Compression for Software Engineering Agents** — Zeng et al., 2026。使用 PPL spikes 做 structure-aware segmentation、proxy attention 估 historical block relevance、dynamic rolling window 重新評估與 recall 舊 context；在 SWE-Bench-Verified / Multi-SWE-Bench 報告 53.17% pass rate，同時 token -21.6%、cost -33.6%。啟示：context compression 不應是一次性 summary，而應可隨目前 reasoning state 動態 recall。

4. **Rewarding the Scientific Process / DataPRM** — Qiu et al., 2026。指出 generic PRM 容易漏 silent errors，也可能把必要 exploration 錯判為 grounding failure；DataPRM 因此讓 verifier 主動與 environment 互動、probe intermediate execution state。啟示：critical-step evaluation 不只選文字，還可能需要主動取得新 evidence。

5. **Gaming the Judge: Unfaithful Chain-of-Thought Can Undermine Agent Evaluation** — 2026。固定 actions/observations、只改寫 reasoning trace，就能顯著操縱 judge verdict。這表示 Hermes 的 evidence planner 必須區分 `BehavioralEvidence`（actions, tool results, environment observations）與 `SelfReportedReasoning`；後者不能與環境證據同權重。

---

## 本小時最重要 5 個發現

### 1. Critical step 不是「看起來重要」，而是 counterfactual decision leverage

建議定義：

```text
Criticality(step_t)
≈
P(outcome changes | replace / remove / correct step_t)
× downstream dependency
× risk impact
```

CSO 的核心正是從 failed trajectory 找 candidate critical step，再替換 action 並重新 rollout 驗證 outcome 是否翻轉。因此：

```text
Attention Salience
≠ Causal Criticality

Long Step
≠ Important Step
```

Hermes 不應只依 token attention 或 LLM summary 選 step；應加入 counterfactual replay / dependency graph / invariant violation。

### 2. Evaluation context selection 是 active sensing，而不是 compression-only

```text
Current Judge Belief
↓
Uncertain verdict
↓
Candidate Evidence Actions
├ expand step
├ fetch raw tool result
├ inspect image crop
├ replay sandbox
├ load memory provenance
└ inspect neighbor steps
↓
Estimate Verification VoI
↓
Acquire highest-value evidence
↓
Update verdict posterior
```

因此：

```text
Context Compression
≠ Evidence Planning
```

Compression 決定「如何少放」；Evidence Planning 決定「下一份最值得取得什麼」。

### 3. Process verification 的 reward granularity 應對齊決策 granularity

VPR repository 的 `agent_system/reward_manager/turn.py` 實際把每個 turn 的 environment reward 寫到該 response 的最後有效 token，而 `dapo_turn.py` 在同一 turn-level reward 上再加入 overlong response shaping。這是一個非常具體的工程訊號：process supervision 可以在 rollout row / turn boundary 對齊，而不必把整條 episode 壓成一個 scalar。

```text
Episode Reward
→ weak localization

Turn Reward
→ localized credit

Critical-Step Reward
→ selective localized credit
```

但 verifier reliability 仍是上限；錯的 process oracle 會把錯誤 supervision 放大。

### 4. 壓縮必須保留 dependency，不只是語義摘要

Agent trajectory 是 heterogeneous graph：

```text
Goal
→ Plan
→ Tool Call
→ Tool Result
→ State Update
→ Later Claim
```

如果摘要保留「搜尋成功」但丟掉 tool result 的 exact value / provenance，Judge 可能無法驗證後續 claim。AttnCompress 的 structure-aware segmentation 與 dynamic recall 支持一個更一般化原則：

```text
Semantic Similarity
≠ Causal Dependency
```

Hermes 應保護：tool arguments、permission decisions、error codes、exact IDs、numerical outputs、provenance links、safety-relevant observations。

### 5. Agent 自己寫的 reasoning trace 不應當成高權威 evidence

若 Judge 能被只改寫 CoT 操縱，而 action / observation 沒變，則：

```text
SelfReportedReasoning
≠ Environment Evidence
```

Hermes 的 `EvidenceAuthority` 應至少分：

```text
REALITY / TOOL EXECUTION
SIGNED SYSTEM EVENT
ENVIRONMENT OBSERVATION
DERIVED STATE
MODEL INFERENCE
SELF-REPORTED REASONING
```

critical-step selector 應優先保留可重播、可驗證、可追 provenance 的 evidence。

---

## Architecture Breakdown

```text
Full Agent Trajectory
↓
Trajectory Parser
↓
TrajectoryEvidenceGraph
├ goal nodes
├ decision nodes
├ tool-call nodes
├ observation nodes
├ multimodal evidence nodes
├ memory/provenance nodes
└ outcome nodes
↓
Critical-Step Candidate Generator
├ dependency centrality
├ invariant violations
├ PRM anomaly
├ uncertainty
├ counterfactual leverage
└ risk impact
↓
Evidence Budget Controller
↓
Judge Context Builder
├ mandatory evidence
├ selected critical steps
├ exact raw artifacts
├ compressed low-risk spans
└ retrieval pointers
↓
Judge / Oracle
↓
Verdict Posterior
↓
Evidence Sufficiency Test
↓ insufficient
Active Evidence Planner
├ expand raw observation
├ retrieve historical block
├ run sandbox replay
├ inspect image/audio segment
└ request stronger oracle
↓
Posterior Update
↓
PASS / FAIL / INCONCLUSIVE / ESCALATE
```

---

## Bottom-Level Logic

### Critical-step score

```text
C_t =
  w1 * CounterfactualOutcomeFlip_t
+ w2 * DependencyCentrality_t
+ w3 * RiskImpact_t
+ w4 * OracleDisagreement_t
+ w5 * Uncertainty_t
- w6 * EvidenceCost_t
```

其中 `CounterfactualOutcomeFlip` 不能只靠 LLM 猜；高風險 case 應透過 replay / simulator / trusted oracle 實測。

### Evidence selection under budget

給 evidence candidate `e_i`：

```text
VoI(e_i)
=
ExpectedDecisionLossBefore
- E[ExpectedDecisionLossAfter e_i]
- Cost(e_i)
```

選擇：

```text
argmax_e VoI(e)
```

直到：

```text
posterior_confidence >= threshold
OR budget exhausted
OR no positive-VoI evidence remains
```

### Context compression contract

對每個 trajectory block：

```text
block
→ classify evidence authority
→ dependency analysis
→ criticality
→ compression mode
```

模式：

```text
BYTE_EXACT
STRUCTURED_EXTRACT
LOSSY_SUMMARY
POINTER_ONLY
DROP
```

Safety / permission / tool arguments / exact numerical evidence 預設不可 lossily summarize。

---

## Code / GitHub 深讀

### thu-nics/VPR

Repository 的 agent runtime 明確分成：

```text
agent_system/
├ environments/
├ memory/
├ multi_turn_rollout/
└ reward_manager/
```

`reward_manager/` 又包含：

```text
turn.py
dapo_turn.py
episode.py
```

`TurnRewardManager` 建立與 response 同 shape 的 reward tensor，對每筆 rollout 找 valid response length，將 `non_tensor_batch["rewards"]` 寫到最後有效 response token。`DAPOTurnRewardManager` 延續相同 turn reward placement，並可依 response length 加入 overlong penalty。

值得下一輪繼續追：

```text
agent_system/multi_turn_rollout/
agent_system/environments/
recipe/
gigpo/
```

目的：把 environment verifier 如何產生 `rewards`、state-group rollout 如何組織、turn-level reward 如何進 optimizer 的完整鏈接起來。

---

## Papers

### Verified Critical Step Optimization for LLM Agents
- Venue: Findings of ACL 2026
- Year: 2026
- URL: https://aclanthology.org/2026.findings-acl.1974/
- Architecture: failed policy trajectory → PRM candidate critical step → expert alternative → policy continuation → outcome verification → DPO
- Contribution: selective, verified critical-step supervision；約 16% steps 即可形成有效 training signal
- Limitation: candidate selection 仍依賴 PRM；counterfactual rollout 成本高；benchmark 不代表所有 open-world agents
- 改變了什麼：把 step supervision 從 uniform dense labeling 推向 causal/selective verification。

### Verifiable Process Rewards for Agentic Reasoning
- Authors: Huining Yuan, Zelai Xu, Huaijie Wang, Xiangmin Yi, Jiaxuan Gao, Xiao-Ping Zhang, Yu Wang, Chao Yu, Yi Wu
- Year: 2026
- URL: https://arxiv.org/abs/2605.10325
- Code: https://github.com/thu-nics/VPR
- Architecture: intermediate symbolic/algorithmic verifier → turn reward → RL
- Contribution: dense verifier-grounded credit assignment
- Limitation: 依賴 reliable intermediate oracle；open-ended environments 較難直接套用

### AttnCompress
- Authors: Zhengran Zeng, Yixin Li, Rui Xie, Wei Ye, Shikun Zhang
- Year: 2026
- URL: https://arxiv.org/abs/2609.08318
- Architecture: PPL segmentation → proxy-attention relevance → rolling context re-evaluation / recall
- Contribution: dynamic trajectory compression with structure preservation
- Limitation: software-engineering domain；proxy attention relevance 不等於 causal evaluation importance

### Rewarding the Scientific Process / DataPRM
- Authors: Zhisong Qiu et al.
- Year: 2026
- URL: https://arxiv.org/abs/2604.24198
- Code: https://github.com/zjunlp/DataMind
- Architecture: environment-aware active process verifier + reflection-aware ternary reward
- Contribution: verifier 主動 probe intermediate execution state，改善 silent-error detection
- Limitation: data-analysis-specific tooling / environment assumptions

---

## Visual Simulation Idea

# Critical Evidence Navigator × Evaluation Context Budget Lab

左側顯示完整 trajectory graph：

```text
Goal
 │
 ▼
Step 1 Search ── Obs A
 │
 ▼
Step 2 Parse  ── Obs B
 │
 ▼
Step 3 Tool X ── Obs C   ★ critical
 │
 ▼
Step 4 Reason
 │
 ▼
Answer
```

每個 node 顯示：

```text
Criticality
Dependency centrality
Evidence authority
Risk
Token cost
Current inclusion mode
```

右側 Context Budget slider：

```text
2K ───── 8K ───── 32K ───── FULL
```

拖動後即時看到哪些 blocks 變成：

```text
EXACT / STRUCTURED / SUMMARY / POINTER / DROP
```

Judge 若 verdict entropy 高，UI 自動亮出：

```text
Next best evidence
1. Expand raw Tool X observation   VoI .41 / cost 320 tok
2. Replay Step 3 in sandbox        VoI .63 / cost high
3. Expand Step 1 search log        VoI .05 / cost 900 tok
```

使用者可觀察「不是 context 越多越好，而是 evidence 選得對不對」。

---

## Unknown / Open Questions 1-3

1. Criticality 的 counterfactual ground truth 如何在不可 replay 的 real-world task 估計，而不退化成另一個 LLM 猜測？
2. 多模態 trajectory 的 critical region 如何跨 text/image/audio/video 統一比較 VoI 與 token/GPU cost？
3. Context compression 後的 Judge calibration 是否需要獨立 surface：`P(correct | compression_policy, retained_evidence)`？

---

## 下一輪研究

**Evaluation Memory × Evidence Provenance × Compression Certificates × Retrieval Failure**

下一輪要回答：即使 critical evidence 被正確保存成 pointer / memory，Judge 在需要時是否真的能取回正確版本？優先研究 post-compression retrieval failure、provenance graph、versioned tool observations、evidence freshness、retrieval calibration、compression certificate。

預計新增：

```text
EvaluationMemory
EvidencePointer
EvidenceProvenanceGraph
CompressionCertificate
EvidenceRetentionGuarantee
RetrievalFailureEvent
EvidenceFreshness
VersionedObservation
EvaluationRetrievalPolicy
```

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
EvaluationEvidencePlanner
TrajectoryEvidenceGraph
CriticalStepSelector
CriticalStep
CounterfactualDecisionLeverage
EvidenceBudgetController
JudgeEvidenceVoI
EvidenceAuthority
BehavioralEvidence
SelfReportedReasoning
EvaluationContextBuilder
EvaluationContextBudget
DynamicEvidenceRecall
EvidenceCompressionMode
ProcessOutcomeDualVerifier
EvidenceCoverageCertificate
```

### Edges

```text
Attention Salience
≠ Causal Criticality

Outcome Correctness
≠ Process Correctness

Context Compression
≠ Evidence Planning

SelfReportedReasoning
≠ Environment Evidence

Critical Step
→ Should Receive Higher Verification Budget

Counterfactual Outcome Flip
→ Evidence For Step Criticality

Trajectory Dependency
→ Constrains Safe Compression

High Verdict Entropy
→ Triggers Active Evidence Acquisition

Environment Probe
→ Can Resolve Silent Process Fault

Dynamic Recall
→ Restores Previously Compressed Evidence
```

---

## 本輪結束判定

- **缺哪一層：** Evaluation Memory / Evidence Provenance / Retrieval Reliability Layer。
- **哪個節點最淺：** `CounterfactualDecisionLeverage`、`JudgeEvidenceVoI`、`EvidenceCoverageCertificate`。
- **哪個概念仍只是名詞：** production 級跨 modality `CriticalStepSelector`。
- **哪個系統值得讀原始碼：** `thu-nics/VPR` 的 `multi_turn_rollout/`、`environments/`、`reward_manager/`；其次 AttnCompress 若公開完整 code。
- **哪篇論文需追引用：** Verified Critical Step Optimization；其次 VPR 與 AttnCompress。
- **哪個概念最適合視覺模擬：** Critical Evidence Navigator × Evaluation Context Budget Lab。
- **哪個 Agent 架構最值得實作：** `TrajectoryEvidenceGraph → CriticalStepSelector → EvidenceBudgetController → Active Evidence Planner → Calibrated Judge → Evidence Sufficiency Gate`。

本輪對「AI 到底怎麼運作」補上的核心：**成熟 Agent 的驗證器不應被動吞下整條歷史，也不應只看最後答案。它必須像主動感知系統一樣，先判斷哪個決策節點最可能左右結果、哪些 tool observation 是可驗證的高權威證據，再把有限 context / GPU / sandbox budget 花在最能降低判斷不確定性的 evidence 上。Evaluation Context 本身因此也是一個 Agent Planning 問題。**