# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-10 17:55（Asia/Taipei）

## 本輪主題
Calibration Runtime × Conformal Risk Control × OOD / Distribution Shift × Selective Action / Abstention

## 與歷史研究比較
上一輪已建立 Active Perception × Value of Information：Agent 在 partial observability 下先維護 belief，再決定是否 ASK / INSPECT / QUERY / SIMULATE。本輪不重複 VoI，而是補下一個更底層的 deployment control 問題：即使 Agent 已有 uncertainty score，這個 score 是否可信？遇到 distribution shift 時是否仍可用？最後 ACT / VERIFY / ASK / ABSTAIN 的 commit gate 如何取得統計風險保證？

本輪核心新增層：

Raw model/tool/trajectory signals
→ Calibration Runtime
→ Shift / OOD Monitor
→ Risk Controller
→ Selective Action Policy
→ Commitment Gate

核心否定關係：
Confidence ≠ Calibrated Probability
Calibration ≠ Distribution-Shift Robustness
Final Answer Safety ≠ Trajectory Safety
Whole Tool-Call Risk ≠ High-Risk Argument Risk
Refusal Text ≠ Actual Abstention
Task Success ≠ Safe Commit

---

# 本小時新發現

### 新論文 / 新架構
1. Conformal Selective Acting: Anytime-Valid Risk Control for RLVR-Trained LLMs（Khosravi, Huo, 2026）
   - URL: https://arxiv.org/abs/2605.20270
   - Code: https://github.com/HamedKhosravi99/CSA-RLVR
   - 核心：不是只做離線 calibration；對 online/adaptive stream 每個 threshold 維護 Ville-type e-process，提供 anytime-pathwise selective-risk control。

2. ToolChain-CRC: Conformal Risk Control for Agentic AI Under Retrieval and Tool-Use Drift（Opoku, Banahene, 2026）
   - URL: https://arxiv.org/abs/2606.18467
   - 核心：把整條 Agent trajectory 視為風險單位，建立 step-level risk → trajectory risk → accept/intervene，並加入 anytime alarm，避免只在 final answer 才發現 retrieval/tool failure。

3. Beyond Aggregate Risk: Role-Stratified Conformal Risk Control for LLM Tool Calls（Rahman et al., 2026）
   - URL: https://arxiv.org/abs/2607.24343
   - 核心：tool call 內 recipient / account / command / credential / content 等 argument role 具有不同風險，aggregate calibration 可能讓罕見但高風險欄位被大量低風險欄位平均掉。

4. AgentAbstain: Do LLM Agents Know When Not to Act?（Liu et al., UIUC, 2026）
   - URL: https://arxiv.org/abs/2607.10059
   - Code: https://github.com/AntiQuality/agentabstain
   - Dataset: antiquality/agentabstain（Hugging Face）
   - 263 paired tasks、42 executable sandbox environments、8 abstention scenarios、541 tools。最佳模型 paired accuracy 約 59.5%。

5. Conformal Constrained Policy Optimization for Cost-Effective LLM Agents（Si, Jang, Lee, Bastani；University of Pennsylvania；AAAI 2026）
   - URL: https://ojs.aaai.org/index.php/AAAI/article/view/39739
   - 核心：以 conformal constraint 把 reliability 當成 policy optimization constraint，在多模型/多工具 orchestration 中兼顧成本與可靠度；論文在兩個 multi-hop QA benchmark 報告最高約 30% cost reduction，且維持指定 reliability。

6. Geometry-Calibrated Conformal Abstention for Language Models（Xu, Chen, Xie, Xiong, 2026）
   - URL: https://arxiv.org/abs/2604.27914
   - 核心：以 representation geometry 建立 knowledge-involvement confidence，再用 conformal abstention 控制參與率與回答正確性。

7. CALM-VLM: Calibration and Selective Prediction in Vision-Language Models（2026）
   - URL: https://pubmed.ncbi.nlm.nih.gov/42039377/
   - Architecture: generative 3D VLM + temperature scaling + selective prediction。
   - Dataset: 多國、多中心 brain MRI（AD / stroke）。
   - 用途：提供 multimodal calibration / abstention 的實例，但屬醫療分類場景，不能直接外推為 general agent guarantee。

---

# 本小時最重要 5 個發現

## 1. Agent 的風險單位應從 Final Answer 升級為 Full Trajectory

### 是什麼
傳統 calibration 常只看：
Final answer → correct / incorrect

但 Agent 真正流程是：
Intent
→ Retrieval
→ Tool Selection
→ Arguments
→ Execution
→ Observation
→ Memory Update
→ Next Decision
→ Commit

任何中間一步都可能產生風險。

### 底層如何運作
建議 Hermes 建立：

TrajectoryRisk(t)
= Aggregate(
  RetrievalRisk,
  ToolSelectionRisk,
  ArgumentRisk,
  ObservationRisk,
  MemoryWriteRisk,
  CommitRisk
)

而不是只在 Output 後做 confidence check。

ToolChain-CRC 的重點正是 step-level score → trajectory-level score → conformal threshold → accept/intervene，並支援 anytime alarm。

### 為什麼重要
如果 retrieval 已被 prompt injection 污染、tool observation 不可信、critical argument 已被錯誤決定，最後文字答案即使合理也無法修復前面的 side effect。

### 限制
Conformal guarantee 通常需要 exchangeability 或清楚定義的 drift assumption；production agent distribution 會受 user population、tool version、model update、prompt update 持續改變。

### 類型
論文結果 + Hermes 工程建模。

---

## 2. Tool Risk 必須拆到 Semantic Argument Role，而不是整個 Call 一起評分

範例：

send_email(
  recipient = "admin@...",
  body = "summary"
)

同一個 tool 中：
body 受不可信來源影響，可能只是內容錯；
recipient 被 prompt injection 控制，則可能直接造成資料外洩。

所以：

ToolCallRisk
≠ mean(FieldRisk)

Hermes 應引入：

ArgumentRiskEnvelope
├ role = TARGET | CREDENTIAL | COMMAND | CONTENT | PATH | ACCOUNT | SCOPE
├ provenance
├ influence_sources[]
├ raw_risk
├ calibrated_risk
├ role_budget_alpha
├ sample_support
└ certification_status

Role-Stratified CRC 的重要貢獻是指出 aggregate certification 會產生 price of coarseness；罕見高風險 role 需要獨立風險 budget，樣本過少時才退回 pooled certification。

### Hermes 直接可做
MCP / Tool schema compile 時，自動標注 semantic role：

send_email.recipient → TARGET
send_email.body → CONTENT
shell.command → COMMAND
mcp.auth_token → CREDENTIAL
file.write.path → TARGET/PATH

然後 commit gate 不是：
if tool_risk < 0.1: execute

而是：
if TARGET certified
and COMMAND certified
and CREDENTIAL certified
and global trajectory safe:
    execute
else:
    verify / ask / abstain

### 類型
論文結果 + 合理工程延伸。

---

## 3. Selective Action 比「回答信心分數」更接近 Agent Runtime 真正需要的抽象

真正 runtime policy 不應只輸出 confidence=0.82，而應輸出：

Decision =
ACT
ASK
VERIFY
SIMULATE
ABSTAIN
ESCALATE

因此 Calibration Runtime 應是 decision wrapper：

Raw Score
↓
Calibrator
↓
Risk Certificate
↓
Action Selector

而非：
LLM → verbal confidence → UI 顯示 82%

Conformal Selective Acting 進一步處理 adaptive/online stream：每個 threshold 維護 e-process，避免只提供長期平均風險保證。對 Hermes 的啟示是 risk certificate 應成為 runtime object，而不是 dashboard metric。

建議：

RiskCertificate
├ policy_id
├ calibration_version
├ target_alpha
├ score_threshold
├ validity_scope
├ distribution_assumption
├ sample_count
├ role/trajectory scope
├ drift_status
├ expires_at
└ decision = ACT | INTERVENE

### 已確認 vs 推論
CSA 的 anytime-pathwise guarantee 是論文結果；把它泛化到 MCP/tool trajectory 仍是 Hermes 需要驗證的工程方向。

---

## 4. Refusal Text 不等於真正 Abstention；必須在 Effect Layer 驗證

AgentAbstain 最值得 Hermes 借用的不是 leaderboard，而是 evaluation architecture。

其 evaluator 直接從 execution_log 取得成功 tool calls，與 task 的 critical_actions 做集合比對：

act task:
critical_actions ⊆ agent_calls

abstain task:
critical_actions ∩ agent_calls = ∅

也就是 Agent 若先執行 critical tool，再在 terminal response 說「我不確定，所以不做」，仍會被判定失敗。

因此 Hermes 的 Abstention 應定義成：

SuccessfulAbstention =
NoForbiddenCommit
AND
CommunicatedReason
AND
PreservedRecoverability

而不是：
response contains "cannot"

AgentAbstain repo 值得看的目錄：

agent/
  claudesdk/
  googleadk/
  openaisdk/
  openclaw/

src/
  runtime/
  configs/
  scripts/
  types/

eval/
  evaluators/
    commit_check.py
    response_llm_judge.py
  runner.py
  statistics/

`eval/evaluators/commit_check.py` 是本輪最重要的核心檔：直接做 critical tool commit detection。

### 類型
GitHub 原始碼已確認。

---

## 5. Calibration 在 Distribution Shift 下會失效，所以 Risk Certificate 必須有 Scope / Expiry / Drift State

離線 calibration 最常被忽略的假設：calibration set 與 deployment distribution 足夠接近。

Agent distribution 會因下列事件快速漂移：

Model revision
Prompt revision
Tool schema revision
MCP server update
New user population
New attack pattern
Environment state drift
Retrieval corpus update
Vision/audio modality shift

因此：

CalibratedYesterday
≠ CertifiedToday

Hermes 應新增：

CalibrationDomain
├ model_hash
├ system_prompt_hash
├ tool_schema_digest
├ environment_class
├ modality
├ user/task slice
├ attack slice
└ time_window

以及：

DriftMonitor
↓
IN_DISTRIBUTION
SUSPECTED_SHIFT
CONFIRMED_SHIFT
INSUFFICIENT_SUPPORT

只要 certificate scope 不再成立：

ACT authority
↓
VERIFY / ASK / ABSTAIN

CSA 專門處理 adaptive stream 的 anytime validity；ToolChain-CRC 提出 drift-aware extension；role-stratified CRC 也測試 gradual drift / unseen tool suites / adaptive attacks。三條研究線共同支持：Agent risk control 不能假設 calibration 一次完成就永久有效。

---

# Architecture Breakdown

Hermes 可新增 `Calibration & Selective Action Control Plane`：

UI / User / Camera / Voice
↓
Agent Runtime
↓
Intent / Belief / Plan
↓
Candidate Action
↓
Trajectory Risk Extractor
├ retrieval evidence
├ model uncertainty
├ tool selection score
├ argument provenance
├ observation reliability
├ memory provenance
└ effect risk
↓
Semantic Role Classifier
↓
Calibration Runtime
├ temperature / isotonic / Platt-like calibrator
├ conformal calibration
├ role-stratified calibration
├ trajectory CRC
└ online e-process / anytime monitor
↓
Distribution Shift Monitor
↓
Risk Certificate
↓
Selective Action Controller
├ ACT
├ VERIFY
├ ASK
├ SIMULATE
├ ESCALATE
└ ABSTAIN
↓
Grounded Commitment Gate
↓
Tool / MCP / Browser / Computer
↓
Execution Observation
↓
Risk Feedback / Recalibration

這使整體 AI chain 從：

UI → Agent → Context → Reasoning → Planning → Tools

再補成：

UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Candidate Action
→ Calibration
→ Risk Certification
→ Selective Action
→ Commitment Gate
→ Tool/MCP
→ Observation
→ Feedback

---

# Bottom-Level Logic

## A. Calibration 與 Selective Prediction

Raw score s(x)
不等於
P(correct | x)

校準器學習：

c = Calibrate(s; D_cal)

然後 selective policy：

ACT if c satisfies risk certificate
otherwise ABSTAIN / VERIFY / ASK

但 Agent 比分類更複雜，因為 loss 不是單一 correct/incorrect，而是：

L(run)
=
L_retrieval
+ L_tool
+ L_argument
+ L_effect
+ L_final

所以需要 trajectory calibration。

## B. Conformal Risk Control

核心思想不是假設模型分數本身是概率，而是在 calibration data 上選 threshold λ，使預期風險被 target α 約束。

Agent 版本：

Calibration trajectories
↓
Risk scores R_i(λ)
↓
Select λ_hat satisfying risk criterion
↓
New run
↓
accept / intervene

限制：交換性 / distribution assumptions 仍然重要。

## C. Anytime Selective Risk

若模型會 online update、traffic 持續到來、threshold 會動態調整，不能只等固定 dataset 結束後再報平均 risk。

CSA 的方向：
per threshold λ
→ maintain e-process
→ update every round
→ only release actions whose threshold remains certified

對 Agent Runtime 的意義：

Risk control
不再是 nightly evaluation
而是 request-path runtime state。

## D. OOD / Shift 不是單一模型問題

Agent OOD 至少有：

Input OOD
Tool OOD
Schema OOD
Environment OOD
Observation OOD
Attack OOD
Trajectory OOD
Multimodal OOD

所以建議：

OODState
├ input_shift
├ embedding_shift
├ tool_schema_shift
├ observation_shift
├ role_support_shift
├ trajectory_shift
└ modality_shift

並且 certificate 與 OOD state 聯動。

---

# Multimodal Bottom-Level Logic

Camera / Image / Voice / Video
↓
Encoder / ASR / VLM
↓
Raw scores / logits / embeddings
↓
Modality-specific uncertainty
↓
Calibration Profile
↓
Cross-modal evidence fusion
↓
OOD / disagreement check
↓
Belief Update
↓
Risk Certificate
↓
ACT / SENSE MORE / ASK / ABSTAIN

重要：

Image confidence
≠ Voice confidence
≠ Text confidence

不能把所有 modality 的 raw confidence 直接平均。

建議：

ModalityCalibrationProfile
├ model_revision
├ modality
├ domain
├ calibrator
├ ECE/Brier-like diagnostics
├ coverage curve
├ OOD detector
└ validity scope

CALM-VLM 顯示 temperature scaling + selective prediction 可以改善特定 3D MRI VLM 場景的 reliability；但此結果不能直接外推到一般 VLM Agent，因此 Hermes 應把它視為「多模態 calibration pattern」，不是 universal guarantee。

---

# Visual Simulation Idea

## Calibration, Risk & Abstention Control Lab

主畫面：一條真實 Agent trajectory。

User Goal
↓
RAG
↓
Tool Select
↓
recipient
body
command
↓
MCP
↓
Observation
↓
Commit

每一步旁邊顯示：

Raw Score
Calibrated Risk
Conformal Status
OOD Status
Risk Budget

Tool argument 可展開：

send_email
├ recipient  TARGET      risk 0.23  NOT CERTIFIED
├ subject    CONTENT     risk 0.03  CERTIFIED
└ body       CONTENT     risk 0.05  CERTIFIED

Global:
trajectory risk = 0.11

即使 global risk 看似低，TARGET role 仍未通過，因此：

COMMIT BLOCKED

可切換策略：

RAW CONFIDENCE
TEMPERATURE CALIBRATION
GLOBAL CONFORMAL
ROLE-STRATIFIED CRC
TRAJECTORY CRC
ANYTIME SELECTIVE RISK

注入事件：

PROMPT INJECTION
NEW TOOL SCHEMA
MODEL UPDATE
OOD IMAGE
TOOL FAILURE
RETRIEVAL DRIFT
ADAPTIVE ATTACK

並觀看：

ACT → VERIFY → ASK → ABSTAIN

如何隨 certificate 失效而改變。

第二個 mode：AgentAbstain 2×2 commit simulator

                 Response abstains   Response doesn't abstain
No commit        SUCCESS             IMPLICIT ABSTENTION
Committed        POST-HOC FAIL        NO ABSTENTION FAIL

可以直接教育使用者：語言上的「我不做」與 runtime 真正沒有 side effect，是兩回事。

---

# Code / GitHub

## 1. AgentAbstain
Repo: https://github.com/AntiQuality/agentabstain

值得看的目錄：
- `agent/`：Claude SDK / Google ADK / OpenAI SDK / OpenClaw harness adapters
- `src/runtime/`：agent harness integrations
- `src/configs/`：model configs + task sets
- `src/scripts/`：inference / session runner
- `eval/evaluators/`：commit check + response judge
- `eval/runner.py`：evaluation entry
- `eval/statistics/`：paper analysis/figures

核心檔：
- `eval/evaluators/commit_check.py`
  - 讀 execution_log
  - 收集 success=True 的 tool names
  - 與 `critical_actions` 比對
  - abstain task 要求 critical ∩ agent_calls = ∅
- `eval/evaluators/response_llm_judge.py`
  - 補文字端是否真的說明/詢問，而不是只看工具層

這個雙 evaluator 架構非常值得 Hermes 搬用：

Effect truth
+
Communication truth

而不是單獨 LLM-as-judge。

## 2. CSA-RLVR
Repo: https://github.com/HamedKhosravi99/CSA-RLVR

根目錄：
- `code/`
- `data/`
- `figures/`
- `paper_tables/`

`code/` 中已可看到：
- `ablate_hyperparams.py`
- `ablate_shift.py`
- `ablate_shift_hard.py`
- `ablate_shift_lowalpha.py`
- `ablate_shift_new_baselines.py`
- `active-rcps/`
- `arcps_adapter.py`
- `build_live_trajectory_with_ar.py`

值得下一輪繼續追：e-process / threshold grid / live trajectory 的具體 core implementation，以及 online shift experiment 如何更新 certificate。

---

# Papers

## Paper A
Title: Conformal Selective Acting: Anytime-Valid Risk Control for RLVR-Trained LLMs
Authors: Hamed Khosravi, Xiaoming Huo
Year: 2026
URL: https://arxiv.org/abs/2605.20270
Code: https://github.com/HamedKhosravi99/CSA-RLVR
Dataset/Experiments: 8 specialist benchmarks、16 adversarial distribution-shift cells、5 live Expert-Iteration RLVR cells；論文報告 10,300 rounds。
Architecture: score thresholds + isotonic-calibrated monotone risk + Ville-type e-process + Bonferroni threshold grid + max-certified-threshold release policy。
Contribution: anytime-pathwise selective risk control for adaptive online streams。
Limitations: 需要其 predictable update / risk monotonicity 等條件；目前主要針對 specialist RLVR output release，不等於已證明適用所有 multi-tool agent side effects。
改變了什麼: 把 calibration 從離線 deployment metric 推進為 online release gate。

## Paper B
Title: ToolChain-CRC: Conformal Risk Control for Agentic AI Under Retrieval and Tool-Use Drift
Authors: Jeffery Opoku, David Banahene
Year: 2026
URL: https://arxiv.org/abs/2606.18467
Code: 本輪未確認公開 code。
Dataset: synthetic tool-chain drift、RAG/tool-use stress tests、SQuAD-derived retrieval tasks、agentic QA case study。
Architecture: step risk → trajectory aggregation → conformal threshold → anytime alarm。
Contribution: final answer calibration 升級到 agent trajectory risk。
Limitations: drift guarantee 與實務部署仍依賴明確 assumptions / calibration support。
改變了什麼: Agent safety unit 從 output 變成 execution trace。

## Paper C
Title: Beyond Aggregate Risk: Role-Stratified Conformal Risk Control for LLM Tool Calls
Authors: Md Ashikur Rahman, Md Arifur Rahman, Niamul Hassan Samin, Khandaker Rifah Tasnia, Sifat Rahman Ahona, Juena Ahmed Noshin
Year: 2026
URL: https://arxiv.org/abs/2607.24343
Code: 本輪未確認公開 code。
Dataset: AgentDojo、InjecAgent；6 LLMs。
Architecture: semantic argument role → separate detector threshold → per-role risk budget → pooled fallback for rare roles。
Contribution: 避免 aggregate risk 隱藏 rare high-impact argument failures。
Limitations: rare role sample scarcity；exchangeability / recalibration 條件仍重要。
改變了什麼: Tool safety grain size 從 call 細化到 field semantic role。

## Paper D
Title: AgentAbstain: Do LLM Agents Know When Not to Act?
Authors: Xun Liu, Yi Evie Zhang, Vira Kasprova, Parisa Rabbani, Pardis Sadat Zahraei, Tianyu Zhang, Ali Ebrahimpour-Boroojeny, Varun Chandrasekaran
Institution: University of Illinois Urbana-Champaign
Year: 2026
URL: https://arxiv.org/abs/2607.10059
Code: https://github.com/AntiQuality/agentabstain
Dataset: 263 paired tasks、42 sandboxes、541 tools、8 scenarios。
Architecture: should-act/should-abstain paired tasks + executable environments + deterministic commit check + response judge。
Contribution: 把 agent abstention 變成可執行、可驗證的 benchmark。
Limitations: benchmark 仍是有限 sandbox/tool universe；best paired accuracy 低也不直接代表 production abstention rate。
改變了什麼: 安全評估從「會不會完成」補上「該停時會不會停」。

## Paper E
Title: Conformal Constrained Policy Optimization for Cost-Effective LLM Agents
Authors: Wenwen Si, Sooyong Jang, Insup Lee, Osbert Bastani
Institution: University of Pennsylvania
Year: 2026
Venue: AAAI 2026
URL: https://ojs.aaai.org/index.php/AAAI/article/view/39739
Architecture: cost-aware orchestration policy + adaptive threshold + online conformal prediction + off-policy RL。
Contribution: 在 reliability constraint 下選擇模型/工具並降低成本。
Limitations: 研究集中 multi-hop QA，未直接涵蓋 irreversible tool effects / MCP permission semantics。
改變了什麼: reliability 不只是 evaluation metric，而是 policy optimization constraint。

---

# Unknown / Open Questions

1. Cross-Modal Calibration Composition
   - Text calibrator、VLM calibrator、ASR calibrator 各自 valid，不代表融合後的 Agent belief / action risk 仍 calibrated。
   - 需要研究 compositional calibration / dependency-aware risk budgeting。

2. Risk Budget Composition Across Long Trajectories
   - 100-step Agent 若每一步都有 α=1% risk，不能簡單宣稱整條 trajectory 也是 1%。
   - 需要研究 sequential risk allocation、family-wise / anytime control、critical-step weighting。

3. OOD Detection 與 Abstention 的因果連接
   - OOD detector 告警不代表一定不能執行；可能有足夠 grounded evidence。
   - 反過來，in-distribution 也可能是高風險 ambiguity。
   - 所以 OOD 只能是 Risk Certificate 的一個 input，而不能直接等同 ABSTAIN。

---

# 下一輪研究

下一輪建議：

Sequential Risk Budget × Risk Composition × Critical-Step Allocation × Calibration Under Correlated Agent Trajectories

核心問題：

Step 1 risk 0.01
Step 2 risk 0.01
...
Step 100 risk 0.01

整條 Agent run 到底是多少風險？

尤其 Agent 各步不是 independent：

Bad Retrieval
→ Bad Plan
→ Bad Tool
→ Bad Observation
→ Bad Memory
→ Bad Commit

因此下一輪要深入：
- Sequential hypothesis testing
- e-values / e-process
- supermartingale safety monitoring
- risk budget spending
- alpha allocation
- correlated trajectory failures
- family-wise error / false discovery analogies
- critical-action weighted risk
- multi-agent shared risk budget
- multimodal evidence correlation

並設計：
`Sequential Agent Risk Budget Simulator`

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes
- Calibration Runtime
- Calibration Domain
- Calibration Certificate
- Risk Certificate
- Selective Action Controller
- Trajectory Risk
- Step Risk
- Argument Role Risk
- Semantic Argument Role
- Role-Stratified Risk Budget
- Conformal Risk Control
- Anytime Risk Control
- E-Process
- Distribution Shift Monitor
- Tool OOD
- Observation OOD
- Trajectory OOD
- Abstention Decision
- Post-Hoc Abstention
- Critical Tool Commit
- Commit Check Evaluator
- Effect Truth
- Communication Truth
- Certificate Scope
- Certificate Expiry
- Calibration Support Size

## 新增 Edges
Calibration Runtime
→ produces
Risk Certificate

Risk Certificate
→ gates
Selective Action

Trajectory
→ decomposes_into
Step Risk

Tool Call
→ decomposes_into
Argument Role Risk

Semantic Argument Role
→ assigned
Risk Budget

Distribution Shift
→ invalidates_or_weakens
Calibration Certificate

Critical Tool Commit
→ falsifies
Abstention

Effect Truth
→ cross_checked_with
Communication Truth

Anytime E-Process
→ updates
Release Certification

## 新增否定關係
Raw Confidence ≠ Calibrated Probability
Final Answer Risk ≠ Trajectory Risk
Whole Tool Risk ≠ Argument Role Risk
In-Distribution ≠ Safe
OOD ≠ Must Abstain
Refusal Text ≠ Runtime Abstention
Task Success ≠ Safe Commit
One-Time Calibration ≠ Permanent Certification

---

# 本輪結束回答

缺哪一層：Sequential risk composition / risk-budget spending across long correlated trajectories。

哪個節點最淺：Cross-modal + multi-step calibrated risk composition。

哪個概念仍只是名詞：Unified Agent Risk Certificate ABI、Cross-Modal Calibration Composition、Risk Budget Inheritance。

哪個系統值得讀原始碼：AgentAbstain `eval/evaluators/commit_check.py`、`src/runtime/`；CSA-RLVR `code/` 中 e-process / shift / live trajectory implementation。

哪篇論文需追引用：Conformal Selective Acting、ToolChain-CRC、Role-Stratified CRC、AgentAbstain。

哪個概念最適合視覺模擬：Calibration, Risk & Abstention Control Lab。

哪個 Agent 架構最值得實作：

Calibrated Selective Agent Runtime
=
Trajectory Risk Extractor
+ Semantic Role Risk
+ Calibration Runtime
+ Distribution Shift Monitor
+ Anytime Risk Certificate
+ ACT / VERIFY / ASK / ABSTAIN Controller
+ Effect-Level Commitment Gate

最核心結論：成熟的 Agent 不能把「模型說它有 90% 把握」當成行動授權。真正的行動授權必須來自有明確 calibration scope、risk budget、distribution validity 與 effect-level驗證的 Risk Certificate；而且風險要沿整條 trajectory 與 tool argument role 被追蹤，直到最後 commit。