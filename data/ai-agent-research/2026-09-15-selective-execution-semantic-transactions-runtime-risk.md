# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-15 17:50（Asia/Taipei）

## 本小時新發現

本輪延續前一輪 Alignment Uncertainty → Decision Risk Gate，但刻意不再研究「confidence 怎麼校準」，而是追問更接近真實 Agent Runtime 的問題：**當模型已提出一個會改變外部世界的 action 時，Runtime 到底如何決定 EXECUTE、STAGE、CONFIRM、REFLECT、ABORT 或 ROLLBACK？**

本輪核心新架構：

```text
User Goal / Goal Lock
↓
Agent Policy proposes Action
↓
Action Intent + Arguments + Current State
↓
Runtime Contract / Specification
↓
Pre-Action Risk Estimator
↓
Selective Execution Gate
├ EXECUTE_REVERSIBLE
├ STAGE
├ VERIFY_MORE
├ CONFIRM
├ REFLECT / REPLAN
└ ABORT
↓
Semantic Transaction Boundary
├ shadow state
├ effect outbox
├ result lineage
├ delegated authority
└ recovery metadata
↓
Cross-step validation
↓
COMMIT or ROLLBACK
↓
Postcondition / evidence verification
```

新論文/架構：CORA (2026)、RefineAct (ASE 2026)、Cordon semantic transactions (2026)、AgentSpec (2025)、AgentTrust (2026)、SafeAgent (2026)、Conformal Policy Control (2026)。

---

## 本小時最重要 5 個發現

### 1. Selective Execution 比「安全分數」更接近真正的 Runtime abstraction

**已確認論文結果：** CORA 將 GUI Agent 安全建模成 post-policy / pre-action selective execution：base agent 先提出 action，Guardian 評估 action-conditional risk，再用 conformal risk control 校準 execute/abstain boundary；被拒絕的 action 交給 Diagnostician，輸出 Reflect / Abort / Ask to Confirm 等 intervention。它另外使用 Goal-Lock，把風險判斷錨定在澄清且 frozen 的 user intent，避免畫面中的 visual injection 改寫目標。

底層應拆成：

```text
Policy(state, goal)
→ proposed action a_t
→ RiskModel(goal_lock, state, a_t)
→ raw risk score r_t
→ calibrated selective threshold τ
→ execute iff admissible under calibrated rule
→ otherwise Diagnostician
→ intervention
```

**重要限制：** conformal guarantee 的 scope 必須與 calibration distribution、loss definition、executed-harm event 綁定，不能改寫成「所有未來 GUI action 都有固定失敗率上界」。

**Hermes 意義：** `DecisionRiskCertificate` 不應只是 UI 資訊，而要直接成為 `ActionExecutionGate` 的輸入。

來源：CORA, arXiv:2604.09155；官方 project page。

### 2. Per-action guardrail 不足：不可逆副作用需要 task-level transaction boundary

**已確認論文架構：** Cordon 指出目前 Tool runtime 把工具當 isolated RPC，但 Agent 任務是 stateful multi-step computation。單次 call 看似安全，不代表多步組合後安全。因此它提出 semantic transaction：把 tool intents、derived result lineage、reversible local state、staged external effects、delegated authority、audit metadata 綁成 task-level execution boundary。

底層：

```text
BEGIN semantic transaction
↓
Action 1 → mutate shadow state
↓
Action 2 → produce derived result object
↓
Action 3 → outward side effect
          ↓
          effect outbox (not released yet)
↓
Validate composed flow
↓
if valid:
   COMMIT local state
   RELEASE external effects
else:
   ROLLBACK / discard staged effects
```

這帶來重要區分：

```text
Action Safety ≠ Transaction Safety
RPC Boundary ≠ Task Boundary
Pre-action Allow ≠ Safe to Commit
```

**合理工程推論：** Hermes 對 email/send、DB write、file delete、payment、publish、MCP mutation 等不可逆或外部可見操作，應優先支援 stage/commit，而不是只有 allow/block。

來源：Cordon: Semantic Transactions for Tool-Using LLM Agents, arXiv:2606.17573。

### 3. Runtime Contract 必須在 Agent loop 的 execution boundary 被強制執行

**已確認原始碼：** AgentSpec 的 `ControlledAgentExecutor` 直接覆寫 LangChain `_iter_next_step`。模型 `plan()` 後，先把 output 轉成 Action，再建立 RuleState，執行 `validate_and_enforce()`；只有通過後才進 `_perform_agent_action()`。因此真正 enforcement point 位於：

```text
LLM plan
→ AgentAction
→ RuleState
→ validate_and_enforce
→ CONTINUE / SKIP / STOP / SELF_REFLECT
→ _perform_agent_action
→ observation
```

`validate_and_enforce()` 逐條檢查 trigger，並能遞迴 self-reflect；`enforcement.py` 明確實作 CONTINUE、SKIP、STOP、SELF_REFLECT，UserInspection 則在執行前取得人工批准。

這證明：

```text
Safety Prompt ≠ Runtime Enforcement
Policy Text ≠ Enforcement Point
```

真正的 contract 必須掛在 model output 與 environment side effect 之間。

**限制：** AgentSpec 論文也顯示自動產生 rule 的 semantic correctness 不是完美；因此「有 formal rule」仍不代表自然語言 user intent 已被正確 formalize。

來源：AgentSpec arXiv:2503.18666；GitHub `src/controlled_agent_excector.py`, `src/enforcement.py`。

### 4. Local-safe steps 可以組成 global-unsafe trajectory

**論文/benchmark evidence：** AgentHazard 與 MT-AgentRisk 都把風險放在 multi-step trajectory，而不是單一 harmful prompt。MT-AgentRisk 報告 multi-turn tool setting 中 attack success rate 平均增加 16%；AgentHazard 的核心就是 individually plausible steps 逐步累積成 unauthorized/harmful behavior。

因此 Hermes risk state 應是：

```text
R_t = f(
  goal,
  a_1:o_1,
  ...,
  a_t,
  accumulated authority,
  accumulated side effects,
  unresolved obligations
)
```

而不是：

```text
R_t = classifier(a_t)
```

這也與 SafeAgent 的 stateful runtime protection、AgentTrust 的 RiskChain detection 對齊。

新增 edge：

```text
LocallyAdmissibleAction
≠ GloballySafeTrajectory

Risk
→ AccumulatesAcrossSteps
```

### 5. Safe Agent 的 unit 應從 Tool Call 升級成「Action Lifecycle」

本輪整合後，單一步驟至少應具有：

```text
PROPOSED
↓
NORMALIZED
↓
SPEC_CHECKED
↓
RISK_SCORED
↓
SELECTED
↓
STAGED
↓
SIMULATED / VERIFIED
↓
AUTHORIZED
↓
COMMITTED
↓
OBSERVED
↓
POSTCONDITION_VERIFIED
↓
AUDITED
```

任何一步都可能失敗：argument obfuscation、spec mismatch、risk calibration drift、wrong confirmation scope、TOCTOU、partial commit、tool result mismatch、postcondition false completion。

因此 Hermes 應新增 first-class `ActionLifecycleRecord`，而不是只保存 `tool_call` 與 `tool_result`。

---

## Architecture Breakdown

### Runtime Selective Execution + Semantic Transaction Architecture

```text
[UI / User]
     ↓
Goal Clarifier
     ↓
Goal Lock / Intent Contract
     ↓
[Planner / Agent Policy]
     ↓
Candidate Action
     ↓
Action Normalizer
├ decode / deobfuscate
├ canonical tool id
├ canonical args
└ side-effect classification
     ↓
Runtime Contract Engine
├ trigger
├ predicate
├ precondition
├ permission
├ authority scope
└ forbidden effect
     ↓
Trajectory Risk State
     ↓
Risk Estimator / Oracle Set
     ↓
Calibrated Selective Execution Gate
├ reversible + low risk → execute
├ uncertain → verify
├ external / irreversible → stage
├ user-bound authority → confirm
├ repairable violation → reflect
└ hard violation → abort
     ↓
Semantic Transaction Manager
├ ShadowState
├ EffectOutbox
├ ResultLineage
├ AuthorityLedger
└ RecoveryMetadata
     ↓
Cross-Step Validator
     ↓
Commit Gate
├ COMMIT
└ ROLLBACK
     ↓
Environment
     ↓
Postcondition Evidence
     ↓
Runtime Memory / Audit Graph
```

這層位於：

```text
Reasoning / Planning
↓
Tool Selection
↓
*** Runtime Safety & Transaction Layer ***
↓
Tool / MCP / Browser / Computer / OS
↓
External World
```

---

## Bottom-Level Logic

### Action-conditional risk 與 selective execution

令狀態為 `s_t`、frozen goal 為 `g`、candidate action 為 `a_t`：

```text
r_t = RiskModel(g, s_t, a_t, trajectory_{≤t})
```

但 raw score 不應直接 threshold。Calibration layer 從 calibration set 得到 admissibility threshold / risk-control rule：

```text
Execute(a_t)
iff
CalibratedRisk(a_t | slice) ≤ budget(slice)
```

其中 slice 至少包含：

```text
tool class
side-effect class
reversibility
user authority
modality
risk domain
trajectory depth
model / guardian version
```

### Transactional side-effect isolation

定義：

```text
Effect e = (resource, mutation, reversibility, visibility, authority, lineage)
```

對 irreversible / outward effect：

```text
propose(e)
→ stage(e, outbox)
→ validate(transaction)
→ authorize(commit_scope)
→ release(e)
```

而不是：

```text
propose(e)
→ execute(e)
→ regret
```

### Specification bottleneck

Formal enforcement 的 correctness 上限受 specification correctness 約束：

```text
Natural Language Goal
→ Intent Formalization
→ Runtime Contract
→ Enforcement
```

若 `Intent Formalization` 錯，後面即使 verifier 100% 正確執行 contract，也可能忠實執行「錯的規格」。因此需要 `SpecificationUncertainty` 與 `IntentContractProvenance`。

---

## Visual Simulation Idea

# Action Commit Observatory × Semantic Transaction Simulator

互動左側顯示 Agent trajectory：

```text
Goal
 ↓
read_file        ✓ reversible
 ↓
edit_draft       ✓ shadow
 ↓
send_email       ⚠ external
 ↓
delete_file      ⚠ irreversible
```

中央顯示每個 Action lifecycle：

```text
PROPOSED → SPEC → RISK → STAGE → VERIFY → AUTHORIZE → COMMIT
```

使用者可拖動：

```text
Risk Budget
0.1% ───────── 10%

Confirmation Cost
LOW ───────── HIGH

Transaction Scope
PER CALL ───── TASK
```

右側即時顯示：

```text
Action: send_email
Raw risk              .18
Calibrated risk       .07
Irreversibility       HIGH
Authority scope       USER_CONFIRM
Trajectory risk       .23
Staged effects        2
Unverified obligations 1

Decision
→ CONFIRM_BEFORE_COMMIT
```

可加入 failure injection：

```text
visual prompt injection
stale permission
wrong recipient
TOCTOU state change
partial tool failure
postcondition mismatch
```

觀察 per-call guardrail 與 semantic transaction 的差異。

---

## Code / GitHub

### haoyuwang99/AgentSpec
值得繼續讀：

```text
src/controlled_agent_excector.py
src/enforcement.py
src/interpreter.py
src/rule.py
src/state.py
src/gen.py
src/low_level_controller.py
```

本輪已確認 `ControlledAgentExecutor._iter_next_step()` 在 `_action_agent.plan()` 與 `_perform_agent_action()` 之間插入 `RuleState → validate_and_enforce`；`enforcement.py` 定義 Continue/Skip/Stop/SelfReflect/UserInspection。

### ys-feng/CORA
目前官方 GitHub 仍主要是 release placeholder / README，完整 code、benchmark、model 尚標示 preparing release；因此本輪不能假裝已完成 code-level runtime audit。下一輪應追 release 狀態。

### Cordon
本輪找到論文與 architecture，但未確認官方 implementation repository；下一輪需追 code release，若無 code 則以 paper system diagram / pseudocode 做更嚴格 architecture audit。

---

## Papers

### CORA: Conformal Risk-Controlled Agents for Safeguarded Mobile GUI Automation
- Authors: Yushi Feng, Junye Du, Qifan Wang, Zizhan Ma, Qian Niu, Yutaka Matsuo, Long Feng, Lequan Yu
- Institutions: University of Hong Kong; Chinese University of Hong Kong; University of Tokyo
- Year: 2026
- URL: https://arxiv.org/abs/2604.09155
- Code: https://github.com/ys-feng/CORA （目前完整 release 尚未公開）
- Dataset: Phone-Harm
- Architecture: Base Agent → Guardian → conformal selective gate → Diagnostician → intervention
- Contribution: action-conditional calibrated execute/abstain control for GUI agents
- Limitation: guarantee scope 依賴 calibration assumptions / distribution / risk definition；非 universal action safety proof

### RefineAct: Automatic Runtime Verification of LLM Agent Actions
- Authors: Fraol Batole, Foutse Khomh, Hridesh Rajan
- Institution: Iowa State / Polytechnique Montréal collaboration
- Year: 2026, ASE 2026
- URL: https://lab-design.github.io/papers/ASE-26/
- Dataset: 144 ToolEmu tasks, five domains
- Architecture: NL intent → first-order Prolog predicates → refinement plan → pre/postconditions → runtime action verifier
- Contribution: automatic task-specific specification + pre-execution verification
- Result: failure incidence 77% → 39%; task quality 1.0 → 1.9 / 3
- Limitation: specification derivation remains a semantic bottleneck

### Cordon: Semantic Transactions for Tool-Using LLM Agents
- Authors: Zheng Chen, Hanqing Liu, Duling Xu, Dong Dong, Jialin Li, Bangzheng Pu, Jidong Zhai
- Year: 2026
- URL: https://arxiv.org/abs/2606.17573
- Architecture: transaction manager + shadow state + effect outbox + result lineage + delegated authority + recovery metadata
- Contribution: task-level staging/validation/commit boundary for multi-step tool agents
- Limitation: transactionality cannot automatically make truly external effects reversible; adapters / staged APIs remain necessary

### AgentSpec: Customizable Runtime Enforcement for Safe and Reliable LLM Agents
- Authors: Haoyu Wang, Christopher M. Poskitt, Jun Sun
- Year: 2025
- URL: https://arxiv.org/abs/2503.18666
- Code: https://github.com/haoyuwang99/AgentSpec
- Architecture: trigger + predicates + enforcement; LangChain executor instrumentation
- Contribution: lightweight DSL/runtime enforcement across code, embodied and AV domains
- Limitation: automatically generated rule correctness is imperfect; formal enforcement inherits spec errors

### Conformal Policy Control
- Authors: Drew Prinster, Clara Fannjiang, Ji Won Park, Kyunghyun Cho, Anqi Liu, Suchi Saria, Samuel Stanton
- Year: 2026
- URL: https://arxiv.org/abs/2603.02196
- Architecture: safe reference policy + conformal calibration → regulator for optimized untested policy
- Contribution: finite-sample risk control for policy change under stated assumptions
- Limitation: not equivalent to formal verification of arbitrary tool-agent trajectories

---

## 已確認 / 推論 / 未驗證分界

**已確認事實：** CORA 是 post-policy pre-action selective execution；AgentSpec 在 LangChain action execution 前插入 enforcement；Cordon 定義 task-level semantic transaction；RefineAct 使用 formalized intent + runtime verification。

**工程推論：** Hermes 應把 irreversible tool/MCP/browser actions 轉成 stage/commit lifecycle，並建立 `ActionLifecycleRecord` 與 `SemanticTransactionManager`。

**尚未驗證假說：** 同一套 transaction abstraction 是否能跨 Gmail/Google Drive/GitHub/MCP/browser/OS 提供一致 rollback semantics。很多 external API 不提供真正 rollback，只能以 compensating action 或 delayed release 模擬。

---

## Unknown / Open Questions

1. **Specification correctness 如何校準？** Runtime verifier 可以精準執行錯誤 contract；需要 NL goal → formal spec 的 semantic-equivalence oracle。
2. **跨工具 atomicity 如何做？** DB 可以 transaction，但 email send、social publish、payment、remote MCP mutation 未必能 rollback；需要 outbox、2PC-like adapter、saga / compensating action 的混合模型。
3. **Sequential risk bound 如何跨 trajectory 組合？** per-step calibrated risk 不可直接相加成 task-level failure probability；需要 dependence-aware trajectory risk composition。

---

## 下一輪研究

主題：**Semantic Transactions × Saga/Compensation × Cross-Tool Atomicity × TOCTOU × Task-Level Risk Composition**

優先拆：

```text
2PC vs Saga vs Outbox
Agent transaction coordinator
MCP mutation staging
Browser/GUI irreversible effects
TOCTOU between verify and commit
idempotency keys
compensating actions
partial failure recovery
trajectory-level conformal / anytime risk
```

目標建立：

```text
AgentTransactionCoordinator
EffectOutbox
CompensationPlan
CommitToken
TOCTOUDetector
IdempotencyContract
PartialCommitEvent
CrossToolAtomicityProfile
TrajectoryRiskAccumulator
TaskRiskCertificate
```

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
SelectiveExecution
ActionConditionalRisk
ActionExecutionGate
GoalLock
RuntimeContract
IntentContract
SpecificationUncertainty
ActionLifecycleRecord
SemanticTransaction
TransactionManager
ShadowState
EffectOutbox
ResultLineage
DelegatedAuthority
CommitGate
Rollback
CompensatingAction
TrajectoryRiskState
CrossStepValidator
PostconditionEvidence
IrreversibleEffect
ExternalVisibility
```

### Edges

```text
AgentPolicy → PROPOSES → Action
Action → CHECKED_BY → RuntimeContract
Action → SCORED_BY → ActionConditionalRisk
ActionExecutionGate → SELECTS → Execute/Stage/Confirm/Reflect/Abort
SemanticTransaction → CONTAINS → ToolIntent
SemanticTransaction → STAGES → ExternalEffect
ExternalEffect → RELEASED_BY → CommitGate
ResultObject → DERIVED_FROM → ToolObservation
LocallyAdmissibleAction ≠ GloballySafeTrajectory
ActionSafety ≠ TransactionSafety
RPCBoundary ≠ TaskBoundary
SafetyPrompt ≠ RuntimeEnforcement
FormalEnforcement → LIMITED_BY → SpecificationCorrectness
IrreversibleEffect → SHOULD_PASS_THROUGH → StageAndCommit
```

---

## 本輪結束判斷

- **缺哪一層：** Cross-tool transaction / recovery / task-level risk composition。
- **哪個節點最淺：** `SpecificationUncertainty`、`CompensatingAction`、`TrajectoryRiskState`。
- **哪個概念仍只是名詞：** production 級 `CrossToolAtomicity`；外部 SaaS/API 不一定支援 rollback。
- **哪個系統值得讀原始碼：** AgentSpec 已值得繼續深讀；CORA 等完整 code release；Cordon 若公開 implementation 則優先追 transaction manager/outbox。
- **哪篇論文需追引用：** Cordon，其次 CORA / RefineAct。
- **哪個概念最適合視覺模擬：** Action Commit Observatory × Semantic Transaction Simulator。
- **哪個 Agent 架構最值得實作：** `GoalLock → RuntimeContract → Calibrated Selective Gate → SemanticTransaction → CrossStepValidator → Commit/Rollback → Postcondition Evidence`。

## 對「AI 到底怎麼運作」新增的核心

從「使用者說一句話」往真實世界走時，模型輸出的 tool call 不應直接等於外部世界的 mutation。成熟 Agent Runtime 應把 **proposal 與 commit 分離**：模型負責提出 action；Runtime 把自然語言目標轉成 contract、累積 trajectory risk、檢查 authority，再把高風險副作用放進 shadow state / effect outbox。只有整段 task 的 precondition、cross-step constraint、user authority 與 postcondition 都足夠可信時，才真正 COMMIT。也就是說，AI Agent 的可靠性最終不只來自「模型有沒有想對」，而來自一個更像作業系統、資料庫 transaction manager 與安全 kernel 的 Runtime，控制模型的想法何時能成為真實世界的行動。