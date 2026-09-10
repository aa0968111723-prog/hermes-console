# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-10 18:54 Asia/Taipei

## 本輪研究主題
**Sequential Risk Budget × Risk Composition × Critical-Step Allocation × Anytime Risk Control**

本輪承接上一輪 `Calibration Runtime × Conformal Risk Control × Selective Action`。上一輪解決的是「單一步驟/角色/trajectory 如何被校準與認證」；本輪往下一層處理更困難的問題：**Agent 跑 10、100、1000 步時，風險到底如何累積？在互相依賴、共享 observation、共享 memory、共享 tool result 的情況下，能否把每一步風險直接相加？有限的安全 budget 應平均分配，還是保留給真正不可逆的 critical action？**

---

# 本小時新發現

### 新論文 / 新架構
1. **Conformal Selective Acting: Anytime-Valid Risk Control for RLVR-Trained LLMs** — Hamed Khosravi, Xiaoming Huo, 2026。提出 per-threshold e-process 與 anytime-pathwise selective-risk control，目標是讓 deployment stream 在任何 stopping time 都能維持可檢驗的風險界線，而非只看固定 horizon。
2. **Anytime-Valid Federated Conformal RAG for LLM Swarms** — Prasanjit Dubey, Xiaoming Huo, 2026。指出 naive sequential composition 失敗，因 marginal coverage 不足以讓 betting process 成為 supermartingale；提出 summable per-step calibration-deviation budget + truncated betting e-process。
3. **TRACER: Trajectory Risk Aggregation for Critical Episodes in Agentic Reasoning** — Sina Tayebati et al., ICML 2026。把 Agent uncertainty 從 single-step 擴展到 trajectory，使用 content-aware surprisal、repetition/coherence gap 與 tail-focused aggregation，重點不是平均風險，而是抓 sparse critical episodes。
4. **ToolChain-CRC: Conformal Risk Control for Agentic AI Under Retrieval and Tool-Use Drift** — Jeffery Opoku, David Banahene, 2026。將 risk unit 拉到完整 actions/observations/final-output trajectory，並加入 anytime alarm / supermartingale escalation。
5. **Beyond Aggregate Risk: Role-Stratified Conformal Risk Control for LLM Tool Calls** — Md Ashikur Rahman et al., 2026。證明 whole-tool aggregate risk 可能稀釋罕見但高危險的 TARGET/CREDENTIAL/COMMAND 等欄位風險。
6. **Unsafer in Many Turns: Benchmarking and Defending Multi-Turn Safety Risks in Tool-Using Agents** — Xu Li et al., ICML 2026。MT-AgentRisk 顯示 multi-turn tool setting 下攻擊成功率平均增加 16%，說明 horizon 本身會暴露新的組合風險。

### 新 GitHub / 原始碼
深入檢查 `sinatayebati/agent-tracer`，不是只讀 README。值得繼續追的核心包括：

```text
src/tau2/
├ agent/llm_agent.py
├ orchestrator/orchestrator.py
├ metrics/
│  ├ uncertainty.py
│  ├ agent_metrics.py
│  └ break_down_metrics.py
├ scripts/
│  ├ analyze_uncertainty.py
│  ├ diagnose_and_optimize_tracer.py
│  └ optimize_tracer_parameters.py
├ environment/
│  ├ environment.py
│  ├ tool.py
│  └ toolkit.py
└ domains/*/tools.py

tests/
└ test_uncertainty.py
```

`src/tau2/metrics/uncertainty.py` 的工程實作明確包含 token-level logprob、content-token filtering、normalized entropy、semantic distance 與 trajectory aggregation。其 normalized entropy 實作不是把所有 token 等量平均，而是先過濾高概率 structural token、stop words/filler，再用 content-bearing token 的 negative log-likelihood 建 single-step uncertainty。這個工程選擇本身很重要：**risk signal 的第一步就需要避免大量容易 token 稀釋真正的 entity/action uncertainty。**

---

# 本小時最重要 5 個發現

## 1. Step Risk ≠ Trajectory Risk

### 是什麼
如果 Agent 每一步都有「1% error risk」，不能直接說完整 100-step Agent 也是 1%，也不能在不知道 dependence 的情況下精確說就是 100%。

### 底層如何運作
最簡單的 union upper bound 可以寫成：

```text
P(any failure over T steps)
≤ Σ_t P(failure_t)
```

但這只是保守上界，而且 Agent steps 通常不是獨立事件：

```text
Bad Retrieval
↓
Bad Context
↓
Bad Plan
↓
Bad Tool Choice
↓
Bad Observation Interpretation
↓
Bad Memory Write
↓
Bad Commit
```

同一個 upstream error 可以造成很多 downstream error，因此「每步 marginal risk」無法直接描述 causal dependence。

### 為什麼重要
Agent Runtime 需要的不是一個 static confidence，而是一個 **Sequential Risk Ledger**，知道目前 trajectory 已消耗多少風險證據、哪些風險來自共同原因、還剩多少 authority 可用於不可逆 action。

### 限制
目前沒有單一通用公式可把任意 LLM Agent 所有相關 failure 精確組合；不同 conformal/e-process 方法需要各自假設。Hermes 的統一 ledger 是工程建模，而非現成定理。

### 來源
- Conformal Selective Acting, arXiv:2605.20270
- Anytime-Valid Federated Conformal RAG, arXiv:2605.29139
- ToolChain-CRC, arXiv:2606.18467

---

## 2. Fixed-Horizon Validity ≠ Anytime Validity

### 是什麼
只證明「第 100 步時風險界線成立」不表示 Agent 可以在第 17、53、984 步任意停下仍維持同一保證。

### Bottom-level mechanism：E-process
建立 filtration `F_t` 表示到 t 時刻已看到的全部歷史，維護 nonnegative e-process：

```text
E_0 = 1
E_t = E_{t-1} × e_t
```

在 null/safe hypothesis 下要求適當的 conditional supermartingale 性質：

```text
E[E_t | F_{t-1}] ≤ E_{t-1}
```

透過 Ville-type inequality，可以把：

```text
sup_t E_t ≥ 1/δ
```

當成 anytime alarm，而不是事先固定 horizon。

### 為什麼重要
Agent horizon 本來就不固定：Planner 會 retry、branch、ask、tool call、等待外部事件；使用者也可能中斷。安全控制若綁死在固定 step count，就不符合 Agent Runtime 真實 execution model。

### 限制
e-process 並不是「直接把任意模型 confidence 乘起來」。betting factor / calibration / conditional validity 必須被正確設計；Anytime-FC-RAG 特別指出 naive marginal conformal coverage 不能直接拿來組成有效 supermartingale。

### 來源
- Conformal Selective Acting (2026)
- Anytime-Valid Federated Conformal RAG (2026)
- Howard et al., Time-uniform confidence sequences (2021)
- Ramdas et al., anytime-valid inference / nonnegative martingales

---

## 3. Average Risk ≠ Critical-Episode / Tail Risk

### 是什麼
一條 40-step trajectory 可能前 38 步都很平穩，只在：

```text
Step 39: wrong recipient
Step 40: send_email
```

出現真正危險。如果取 mean risk，38 個低風險 step 可能把最後 critical episode 稀釋。

### TRACER 的方向
TRACER 把 step uncertainty 做成多訊號 composite，再用 **tail-focused trajectory risk** 強調 top-risk episodes / max-like signal，而不是純平均。論文報告在 τ²-bench 上相對 baselines 最高提升 AUROC 37.1%、AUARC 55%。

### Hermes 推論
Hermes 應至少同時保存：

```text
Local Step Risk
Cumulative Evidence
Tail Risk
Max Critical Risk
Irreversible-Effect Risk
```

不能只留：

```text
trajectory_risk = mean(step_risk)
```

### 限制
TRACER 是 failure prediction / selective execution metric，並不等同 formal end-to-end safety guarantee；Hermes 不能把 TRACER score 假裝成 probability。

### 來源
- TRACER, arXiv:2602.11409, ICML 2026
- Agent-Tracer GitHub original source

---

## 4. Risk Budget 不應平均分配：Critical Action 必須保留 Reserve

### 問題
若總 risk budget 為 `α_total`，直覺可能做：

```text
α_t = α_total / expected_steps
```

但 Agent steps 的 consequence 完全不同：

```text
read_file        reversible / observational
search           observational
simulate         virtual
send_email       external effect
merge_pr         external + persistent
payment          financial + irreversible
credential       security-critical
```

### Role-stratified 結果
2026 role-stratified CRC 指出，whole-action aggregate certification 會讓罕見高風險 semantic role 被常見低風險欄位稀釋。例如 body/content 可以容許較寬 budget，但 recipient/credential/command/target 需要獨立、更嚴格的 budget。

### Hermes 新模型：Critical Reserve

```text
Total Risk Authority α_total
├ Exploration / Read Budget
├ Reasoning / Planning Budget
├ Observation Budget
├ Tool Selection Budget
├ Argument-Role Budget
└ Critical Commit Reserve
    ├ TARGET
    ├ COMMAND
    ├ CREDENTIAL
    ├ ACCOUNT
    └ IRREVERSIBLE EFFECT
```

Commit 前不能因為早期步驟「很安全」就把 reserve 花掉。

### 工程 invariant

```text
Authorize(action_t) =
  LocalCertificate(action_t)
  ∧ TrajectoryCertificate(history≤t)
  ∧ RoleCertificates(arguments)
  ∧ DriftCertificate
  ∧ CriticalReserveRemaining ≥ RequiredReserve(action_t)
```

這個 invariant 是 **Hermes 工程建模 / 合理推論**，不是論文直接定理。

### 來源
- Beyond Aggregate Risk, arXiv:2607.24343
- ToolChain-CRC, 2026

---

## 5. Multi-turn 會增加「組合攻擊面」，Risk Budget 必須看 Sequence

### 是什麼
有些 action 單獨看都 harmless：

```text
Turn 1: get operation fragment
Turn 2: get target fragment
Turn 3: concatenate + execute
```

但 sequence 合起來才形成 harmful effect。

MT-AgentRisk 的 2026 結果顯示 multi-turn tool-using setting 的 attack success rate 平均增加 16%，ToolShield 則透過新 tool self-exploration / downstream effect observation 降低 ASR 約 30%。

### Hermes 推論
Risk controller 不能只做：

```text
is_this_tool_call_safe(call_t)?
```

還要做：

```text
What causal capability has the sequence accumulated?
```

也就是新增：

```text
Sequence Capability Risk
Composite Intent Risk
Cross-Turn Effect Risk
```

### 限制
MT-AgentRisk 衡量的是特定 benchmark attack success，不能直接外推成所有 production Agent 的 absolute failure probability。

### 來源
- Unsafer in Many Turns / MT-AgentRisk, arXiv:2602.13379, ICML 2026

---

# Architecture Breakdown

本輪建議 Hermes 增加 **Sequential Risk Control Plane**：

```text
UI / User / Camera / Voice
↓
Agent Runtime
↓
Context + Belief + Planner
↓
Candidate Step
↓
Step Risk Extractor
├ Model uncertainty
├ Retrieval risk
├ Observation reliability
├ Tool selection risk
├ Argument provenance
├ Memory dependency risk
├ Multimodal grounding risk
└ Effect severity
↓
Dependency / Criticality Classifier
↓
Risk Budget Allocator
├ ordinary budget
├ epistemic budget
├ branch budget
├ role budget
└ critical reserve
↓
Sequential Evidence Engine
├ e-process state
├ cumulative envelope
├ tail-risk tracker
├ max-critical risk
└ drift monitor
↓
Risk Ledger
↓
Action Gate
├ ACT
├ VERIFY
├ ASK
├ SIMULATE
├ ESCALATE
└ ABSTAIN
↓
Commitment Gate
↓
MCP / Tool / Browser / Computer / External Effect
↓
Observation
↓
Update risk + belief + memory
```

## 新核心 runtime object

```text
SequentialRiskLedger
├ trajectory_id
├ total_budget
├ ordinary_spent
├ epistemic_spent
├ branch_spent
├ role_spent{}
├ critical_reserve{}
├ e_process_state{}
├ tail_risk_window
├ max_critical_risk
├ active_dependencies[]
├ drift_state
├ certificate_scope
├ certificate_expiry
└ last_safe_commit
```

重要的是：這裡 `spent` 不一定能解讀成真正 probability 相加。它是 **policy/accounting abstraction**；formal certificate 的實際 validity 仍由 e-process / conformal / specific risk method 決定。

---

# Bottom-Level Logic

## A. Naive α-spending（保守 baseline）

如果想用最簡單的 family-wise style budget：

```text
choose δ_1, δ_2, ...
subject to Σ δ_t ≤ δ_total
```

對無限 horizon 可以使用 summable schedule，例如工程示意：

```text
δ_t ∝ 1 / t²
```

使總和有限。

優點：易審計。
缺點：長 horizon 很快變得過度保守，而且不能處理 Agent failure 的 causal correlation。

Anytime-FC-RAG 的重要提醒正是：**summable budget 可以處理某些 calibration-deviation term，但不能把 marginal coverage 無條件 naive compositionalize。**

## B. Anytime Evidence Monitoring

```text
Observation at t
↓
Risk statistic X_t
↓
Predictable betting / calibration rule
↓
e_t
↓
E_t = E_{t-1} e_t
↓
Compare threshold 1/δ
↓
continue / warn / intervene
```

這讓 Agent 不必預先知道：

```text
T = 10 ? 100 ? 10000 ?
```

## C. Tail / Critical Episode Tracker

```text
step risks r_1...r_t
↓
keep top-k / high quantile window
↓
TailMean
+
MaxRisk
↓
CriticalEpisodeRisk
```

此層是 diagnostic / selection signal，不應冒充 calibrated probability。

## D. Critical-Step Allocation

先計算 action criticality：

```text
Criticality(a) = f(
  irreversibility,
  externality,
  privilege,
  target sensitivity,
  blast radius,
  recoverability,
  user visibility,
  monetary/security impact
)
```

然後 mapping：

```text
LOW
→ ordinary certificate

MEDIUM
→ additional verification

HIGH
→ reserve + role certificate + fresh grounding

CRITICAL
→ reserve + dual evidence / user confirmation / policy-specific gate
```

這是 Hermes 工程模型；不同產品需自行定義 policy。

---

# Multimodal Risk Composition

多模態 Agent 更容易出現 **correlated evidence**：

```text
Camera Frame F1
↓
VLM says object = A
├ Planner uses A
├ Memory stores A
├ Tool target resolves to A
└ Another Agent receives A
```

如果 VLM 認錯一次，四個下游模組不是四個獨立 error，而是同一 common-cause observation error 的傳播。

所以：

```text
Image Risk + Planner Risk + Tool Risk
```

不能在沒有 dependency model 下直接當成獨立 probability composition。

同理 Voice：

```text
Audio
→ ASR token
→ intent
→ entity / account
→ tool arguments
→ external action
```

如果 ASR 對 account name 誤聽，後面「模型很有信心」也無法消除 upstream grounding error。

Hermes 應新增：

```text
EvidenceRootID
```

讓每個 derived decision 能追到共同 observation root，為下一輪 dependency-aware risk propagation 做準備。

---

# Visual Simulation Idea

## Sequential Risk Budget & Critical-Path Safety Ledger

主畫面是一條 Agent trajectory：

```text
Observe Image     local .02
RAG Search        local .04
Plan              local .06
Read Tool         local .05
Resolve Recipient local .18  [TARGET]
Send Email        local .08  [IRREVERSIBLE]
```

上方顯示：

```text
Total policy budget     1.00
Ordinary available      0.38
Critical reserve        0.45
Epistemic reserve       0.17
Anytime certificate     VALID
E-process               3.8 / alarm 20
Tail risk               0.18
Highest critical step   TARGET 0.18
```

使用者可以切換五種模式：

```text
1. NAIVE PER-STEP THRESHOLD
2. SUMMABLE / BONFERRONI-LIKE BUDGET
3. ANYTIME E-PROCESS
4. TAIL-FOCUSED TRACER
5. HYBRID CRITICAL-RESERVE
```

### 最重要的互動情境 1：平均值掩蓋 critical step

```text
39 safe steps
+
1 dangerous recipient resolution
```

畫面顯示：

```text
Mean Risk        LOW
Tail Risk        HIGH
Critical Reserve FAIL
→ COMMIT BLOCKED
```

### 情境 2：Common-cause failure

```text
Bad RAG Result E7
↓
Plan N8
↓
ToolCall T9
↓
Memory M10
↓
Second Agent A2
```

使用者切：

```text
INDEPENDENT ASSUMPTION
vs
DEPENDENCY-AWARE
```

讓畫面直接看到 naive independent composition 對相同 evidence 重複計算或低估 common-cause blast radius。

### 情境 3：Long Horizon
拖動 horizon：

```text
10 → 100 → 1,000 → unbounded
```

看 fixed-horizon certificate 與 anytime e-process 的差異。

---

# Code / GitHub

## TRACER / agent-tracer
Repo: https://github.com/sinatayebati/agent-tracer

值得優先讀：

```text
src/tau2/metrics/uncertainty.py
```
- token logprob / NLL uncertainty
- normalized entropy
- content-token filtering
- semantic distance
- trajectory aggregation

```text
src/tau2/orchestrator/orchestrator.py
```
- Agent/User/Environment interaction loop
- trajectory execution boundary

```text
src/tau2/scripts/analyze_uncertainty.py
src/tau2/scripts/diagnose_and_optimize_tracer.py
src/tau2/scripts/optimize_tracer_parameters.py
```
- uncertainty analysis
- parameter fitting / diagnostic path

```text
tests/test_uncertainty.py
```
- 最適合快速確認 metric assumptions 與 edge cases。

### 原始碼觀察
`uncertainty.py` 的 normalized entropy 用 content-bearing token average negative log-likelihood，並主動過濾 P>~0.95 的高概率 structural tokens、stop words/filler 與 purely numeric token。這提醒 Hermes：如果直接對所有 token 做平均，UI markup、空白、固定格式等容易 token 可能造成 **uncertainty dilution**。

---

# Papers

## 1. TRACER: Trajectory Risk Aggregation for Critical Episodes in Agentic Reasoning
- **Authors:** Sina Tayebati, Divake Kumar, Nastaran Darabi, Davide Ettori, Ranganath Krishnan, Amit Ranjan Trivedi
- **Year:** 2026, ICML 2026
- **URL:** https://arxiv.org/abs/2602.11409
- **Code:** https://github.com/sinatayebati/agent-tracer
- **Dataset/Benchmark:** τ²-bench
- **Architecture:** content-aware surprisal + situational/coherence signals + MAX-composite step risk + tail-focused trajectory aggregation
- **Contribution:** 把 uncertainty 從 single response 提升到 critical trajectory episodes。
- **Reported result:** AUROC 最高 +37.1%、AUARC 最高 +55%。
- **Limitation:** risk score 是 predictive metric，不等於 formal probability/safety certificate。
- **改變了什麼:** 讓 Agent risk evaluation 的基本單位由「一句回答」轉成「整段互動軌跡中的 critical episodes」。

## 2. Conformal Selective Acting: Anytime-Valid Risk Control for RLVR-Trained LLMs
- **Authors:** Hamed Khosravi, Xiaoming Huo
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.20270
- **Architecture:** threshold-indexed e-process + selective acting + anytime-pathwise certification
- **Contribution:** 支援 adaptive online stream 任意 stopping time 的 selective-risk control。
- **Limitation:** 需要可支撐 conditional/e-process construction 的 assumptions 與 calibration。
- **改變了什麼:** 將 deployment safety 從 fixed evaluation horizon 移到 continuously monitored runtime。

## 3. Anytime-Valid Federated Conformal RAG for LLM Swarms
- **Authors:** Prasanjit Dubey, Xiaoming Huo
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.29139
- **Dataset:** MMLU, DBpedia, AG News
- **Architecture:** summable calibration-deviation budget + truncated nonnegative supermartingale betting e-process
- **Contribution:** 說明 marginal conformal validity 為何不能 naive sequential composition，並建立 arbitrary-stopping-time coverage。
- **Reported result:** adaptive bandwidth policy 節省約 14–57% communication cost，同時匹配 alarm behavior。
- **Limitation:** 問題設定是 federated RAG swarm，不是一般具不可逆 effects 的 autonomous Agent。
- **改變了什麼:** 把「risk budget 可加總」的直覺明確變成需要檢查 conditional validity / supermartingale structure 的數學問題。

## 4. ToolChain-CRC: Conformal Risk Control for Agentic AI Under Retrieval and Tool-Use Drift
- **Authors:** Jeffery Opoku, David Banahene
- **Institutions:** University of Texas Rio Grande Valley; Florida International University（公開索引資訊）
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2606.18467
- **Architecture:** step-level risk → trajectory risk → conformal accept/intervene → anytime supermartingale alarm
- **Contribution:** final-answer risk 不足，需檢查 retrieval/tool observations/intermediate trajectory。
- **Limitation:** general production effect semantics 與 arbitrary multi-agent causal dependencies 仍未完全解決。
- **改變了什麼:** 將 conformal control 從 final output 延伸到 tool-using trajectory。

## 5. Beyond Aggregate Risk: Role-Stratified Conformal Risk Control for LLM Tool Calls
- **Authors:** Md Ashikur Rahman, Md Arifur Rahman, Niamul Hassan Samin, Khandaker Rifah Tasnia, Sifat Rahman Ahona, Juena Ahmed Noshin
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.24343
- **Benchmark:** AgentDojo, InjecAgent; 6 language models
- **Architecture:** semantic argument roles + per-field nonconformity + role-specific thresholds/budgets
- **Contribution:** 防止 rare high-risk argument 被 aggregate score 稀釋。
- **Limitation:** formal guarantee依賴 exchangeability / recalibration；frozen shift 下主要為 empirical compliance。
- **改變了什麼:** 將 action risk unit 從 tool-call 細化到 TARGET/COMMAND/CREDENTIAL/CONTENT 等 semantic role。

## 6. Unsafer in Many Turns: Benchmarking and Defending Multi-Turn Safety Risks in Tool-Using Agents
- **Authors:** Xu Li, Simon Yu, Minzhou Pan, Yiyou Sun, Bo Li, Dawn Song, Xue Lin, Weiyan Shi
- **Year:** 2026, ICML 2026
- **URL:** https://arxiv.org/abs/2602.13379
- **Code:** https://github.com/CHATS-lab/ToolShield
- **Benchmark:** MT-AgentRisk
- **Architecture:** multi-turn harmful sequence taxonomy + ToolShield self-exploration defense
- **Reported result:** multi-turn ASR 平均 +16%；ToolShield 平均降低 ASR 約 30%。
- **Limitation:** benchmark attack distribution 不能直接等同 production probability。
- **改變了什麼:** 證明 Agent safety risk 具有 sequence/composition dimension，不應只逐 call 評估。

---

# Fact / Evidence Classification

## 已確認事實 / 論文結果
- TRACER 將 risk 聚合到 trajectory critical episodes，且公開 code 建於 τ²-bench。
- CSA 使用 e-process 建 anytime selective risk control。
- Anytime-FC-RAG 明確指出 naive marginal sequential composition 不足。
- ToolChain-CRC 將 step risk 合成 trajectory risk 並有 anytime alarm。
- Role-stratified CRC 將 tool arguments 依 semantic roles 分開校準。
- MT-AgentRisk 報告 multi-turn ASR 平均上升 16%。

## 工程實作確認
- `agent-tracer` 確有 `src/tau2/metrics/uncertainty.py`、`orchestrator.py`、analysis/optimization scripts、domain tool implementations 與 uncertainty tests。
- `uncertainty.py` 實際使用 token logprob/NLL 並做 content-token filtering。

## 合理推論 / Hermes 設計提案
- `SequentialRiskLedger`
- `Critical Commit Reserve`
- Risk Budget Authority 與 tool capability authority 綁定
- `EvidenceRootID` 用於辨識跨模態/common-cause dependency
- Hybrid strategy：e-process certificate + tail-risk diagnostic + role-stratified critical reserve

## 尚未驗證假說
- 何種 budget allocation schedule 對 Hermes 實際 workloads 最有效。
- TRACER tail-risk 與 conformal/e-process certificate 最佳結合方式。
- Multi-agent common-cause risk 能否用一個統一的 online dependency graph 可靠校準。

---

# Unknown / Open Questions

## 1. Correlated failure 如何 composition？
如果 RAG、Planner、Memory、Tool arguments 都依賴同一個錯誤 observation，不能當作四個 independent Bernoulli risks。需要 dependency-aware / causal risk graph。

## 2. Shared risk budget 如何跨 Multi-Agent delegation 傳遞？
Parent Agent 授權 Child Agent 時，應傳遞：

```text
Capability
+
Remaining Risk Budget
+
Critical Reserve
+
Certificate Scope
```

但多 agent 平行執行如何避免 double-spending risk authority 尚未有統一 ABI。

## 3. Cross-modal confidence 如何共同校準？
ASR、VLM、RAG、LLM、Tool Verifier 的 scores 在不同 domains，不能直接相加。需要 calibrated dependency-aware fusion。

---

# 下一輪研究

下一個最大缺口：

## **Causal Risk Propagation × Common-Cause Failure × Dependency Graph × Multi-Agent Shared Risk Budget**

下一輪應深入：

```text
Evidence Root
↓
Derived Beliefs
↓
Plans
↓
Tool Arguments
↓
Memory
↓
Child Agents
↓
External Effects
```

並建立：

```text
Risk Dependency Graph
Common-Cause Node
Risk Propagation Edge
Risk Double-Counting Detector
Risk Authority Transfer
Multi-Agent Budget Lease
Budget Fencing Token
Critical Reserve Inheritance
```

需要比較 fault tree、Bayesian network、causal DAG、reliability engineering、distributed budget/lease 與 online e-process 是否能形成一個 Agent-specific 的 compositional safety model。

---

# Knowledge Graph 新增 Node / Edge

## New Nodes

```text
Sequential Risk Budget
Sequential Risk Ledger
Anytime Risk Certificate
E-Process
Betting Factor
Stopping-Time Validity
Fixed-Horizon Certificate
Risk Spending Schedule
Calibration-Deviation Budget
Trajectory Risk
Tail Risk
Critical Episode
Critical Action
Critical Commit Reserve
Risk Authority
Risk Budget Allocation
Risk Budget Exhaustion
Role Risk Budget
Sequence Capability Risk
Cross-Turn Effect Risk
Evidence Root ID
Common-Cause Risk
Multimodal Correlated Risk
```

## New Edges

```text
Step Risk
→ contributes_to
Trajectory Risk

Critical Episode
→ dominates
Tail Risk

E-Process
→ supports
Anytime Risk Certificate

Critical Action
→ consumes
Critical Commit Reserve

Semantic Argument Role
→ assigned
Role Risk Budget

Multi-Turn Sequence
→ accumulates
Sequence Capability Risk

Observation Evidence Root
→ propagates_to
Planner / Memory / Tool / Child Agent

Risk Budget
→ constrains
Action Authority
```

## Important Negative / Distinction Edges

```text
Step Risk ≠ Trajectory Risk
Fixed-Horizon Validity ≠ Anytime Validity
Marginal Coverage ≠ Sequential Conditional Validity
Mean Risk ≠ Tail Risk
Average Risk ≠ Critical Episode Risk
Risk Score ≠ Calibrated Probability
Per-Step Safety ≠ Sequence Safety
Whole Tool Risk ≠ Argument Role Risk
Summed Marginal Risk ≠ Exact Correlated Risk
Multiple Downstream Errors ≠ Multiple Independent Causes
Low Early Risk ≠ Permission To Spend Critical Reserve
```

---

# 本輪結束回答

**缺哪一層？** 目前最缺的是 `Causal Risk Propagation / Common-Cause Dependency`，否則 sequential ledger 只能做到保守 budget bookkeeping，還不能準確理解「同一個錯誤證據污染很多 downstream steps」。

**哪個節點最淺？** `Multi-Agent Shared Risk Budget`，尤其 delegation 後的 budget lease、double-spend prevention 與 reclaim semantics。

**哪個概念仍只是名詞？** `Unified Agent Risk Authority ABI`、`EvidenceRootID` 的跨框架語義、`Critical Reserve Inheritance`。

**哪個系統最值得讀原始碼？** `sinatayebati/agent-tracer` 的 `src/tau2/metrics/uncertainty.py`、`orchestrator.py` 與 uncertainty optimization scripts；它提供了從 token uncertainty 到 trajectory analysis 的實際工程鏈。

**哪篇論文需追引用？** 首選 TRACER（critical episodes/tail aggregation）、Conformal Selective Acting（anytime e-process）、Anytime-FC-RAG（sequential validity failure + summable budget）。

**哪個概念最適合視覺模擬？** `Sequential Risk Budget & Critical-Path Safety Ledger`，因為可以直接視覺化 mean-vs-tail、fixed-vs-anytime、ordinary-vs-critical reserve，以及 common-cause failure。

**哪個 Agent 架構最值得實作？** 

> **Anytime Critical-Risk Agent Runtime = Step Risk Extractor + Sequential E-Process + Tail-Risk Tracker + Role-Stratified Budget + Critical Commit Reserve + Drift Monitor + Effect-Level Commitment Gate**

---

# 最終整合位置

本輪把「使用者說一句話」的完整鏈再補一層：

```text
User / Camera / Voice / Video
↓
Encoder / Tokens / ASR / VLM
↓
Context
↓
Belief
↓
Reasoning
↓
Planning
↓
Candidate Action
↓
Local Risk
↓
Sequential / Tail / Dependency Risk
↓
Risk Budget + Critical Reserve
↓
Anytime Certificate
↓
ACT / VERIFY / ASK / ABSTAIN
↓
Commitment Gate
↓
MCP / Tool / Model / GPU / External World
↓
Observation
↓
Memory / Event Log / Knowledge Graph
↓
Next Decision
```

本輪核心結論：

> **成熟 Agent OS 的安全性不能用「每一步都低於某個 confidence/risk threshold」來代表。Agent 是一條會延長、分支、重試、共享證據、呼叫工具並最終改變世界的 trajectory；因此風險也必須是 trajectory-native。真正可用的 Runtime 需要一個可持續監控的 sequential evidence process，知道危險是否正在累積；同時把有限的風險 authority 保留給 TARGET、COMMAND、CREDENTIAL 與不可逆 effect 等 critical steps，而不是讓數十個低風險步驟的平均值掩蓋真正會改變世界的那一瞬間。**
