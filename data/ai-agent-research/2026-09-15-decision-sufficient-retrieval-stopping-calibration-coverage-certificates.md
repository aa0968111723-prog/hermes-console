# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 15:03（Asia/Taipei）**  
**主題：Decision-Sufficient Retrieval × Sequential Stopping Calibration × Evidence Coverage Certificates × Cross-Modal Rehydration**

## 與歷史研究比較

前一輪已建立 `SufficiencyGate → StructuredEvidenceGap → GapGuidedRetrieval → HiddenEvidenceProbe → MinimalSufficientEvidenceSet → CompressionCertificate`。本輪不重複「怎麼找缺口」，而專注下一層：**何時停止 retrieval 才是可校準的 sequential decision？「coverage」究竟能保證什麼、不能保證什麼？**

本輪把三個常被混為一談的問題拆開：

1. **Evidence-set sufficiency**：目前 evidence set 是否足以支持／反駁候選答案？
2. **Retrieval stopping**：在成本、風險與未來可能增益下，現在是否應停止搜尋？
3. **Coverage certificate**：對特定定義的 supporting evidence，是否有統計覆蓋保證？

核心結論：`Evidence Sufficiency ≠ Safe Stopping ≠ Statistical Coverage ≠ Answer Correctness`。

---

## 本小時新發現

### 新論文 / 架構

- **SURE-RAG: Sufficiency and Uncertainty-Aware Evidence Verification for Selective Retrieval-Augmented Generation** — Jingxi Qiu, Zeyu Han, Cheng Huang, 2026. 將 sufficiency 視為 set-level property，以 pair-level claim/evidence relation 聚合 coverage、relation strength、disagreement、conflict、retrieval uncertainty，做 SUPPORT / REFUTE / INSUFFICIENT 三分決策與 abstention。URL: https://arxiv.org/abs/2605.03534
- **When Should Multi-Round RAG Stop? Structured Stopping Judgments and Retrieval Reduction in Search-R1** — Weimeng Luo, 2026. 將 stopping 明確指出為 sequential selection：真正部署的是 trajectory 上「第一個 STOP」，不是獨立 state classification。URL: https://arxiv.org/abs/2608.13237
- **Principled Context Engineering for RAG: Statistical Guarantees via Conformal Prediction** — Debashish Chakraborty, Eugene Yang, Daniel Khashabi, Dawn Lawrie, Kevin Duh, 2025/2026. 用 conformal prediction 校準 relevance filtering threshold，控制 supporting snippet retention coverage；NeuCLIR / RAGTIME 上可縮減 context 約 2–3×。URL: https://arxiv.org/abs/2511.17908  Code: https://github.com/hltcoe/conformal-context-engineering
- **Stop-RAG: Value-Based Retrieval Control for Iterative RAG** — Jaewan Park, Solbee Cho, Jay-Yoon Lee, 2025. 把 iterative retrieval stopping 建模成 finite-horizon MDP，以 value-based controller 學習 STOP / CONTINUE。URL: https://arxiv.org/abs/2510.14337
- **Do LLMs Know When Evidence is Insufficient?** — Hantian Zhang, Wentai Wu, Jinan University, 2026. 專門測 evidence insufficiency 與 abstention calibration，結論指出現有 LLM 對 insufficient / irrelevant / contradictory evidence 仍容易 over-answer。URL: https://doi.org/10.32604/cmc.2026.086343

### 新 GitHub

深入 `hltcoe/conformal-context-engineering`：repository 目前刻意維持很小，頂層只有 `README.md / prompts / examples`，不是大型 framework；因此它最值得讀的不是 runtime orchestration，而是**校準公式、scoring function、prompt contract 與資料切分方式**。README 明確給出：

```text
A_emb(q,s) = 1 - cos(emb(q), emb(s))
A_LLM(q,s) = 1 - rating

τ̂_α = Quantile_(1-α)({A(q,s): r(q,s)=1})

P(s ∈ K_q | r(q,s)=1) ≥ 1-α
```

這是一個「supporting snippet retention」保證，而不是「答案正確率」保證。

---

## 本小時最重要 5 個發現

### 1. Retrieval stopping 是 sequential policy，不是 sufficiency classifier

**已確認（論文）**：multi-round RAG 真正執行時，一旦某一步輸出 STOP，後面 states 根本不會被看見；因此每個 state 的 classification accuracy 並不能直接等價於 deployed stopping quality。

底層：

```text
s_t = (question, evidence_memory_t, retrieval_history_t, budget_t)

a_t ∈ {STOP, RETRIEVE}

RETRIEVE:
  q_t = gap_to_query(s_t)
  d_t = retriever(q_t)
  E_(t+1) = select(E_t ∪ d_t)

STOP:
  answer = generator(question, E_t)
  terminate
```

第一個 false-positive STOP 具有吸收性：它會直接截斷所有未來可能補足的 evidence。

**為什麼重要**：Hermes 不能只訓練 `SufficiencyGate` 的 pointwise accuracy；需要 trajectory-level `StoppingRegret`。

**限制**：Search-R1 stopping 研究只證明在特定 HotpotQA / frozen pipeline 下可少量降低 retrieval calls，並不等於 safe stopping 或總 inference cost 一定下降。

來源：https://arxiv.org/abs/2608.13237 ; https://aclanthology.org/2026.acl-long.1185/

### 2. Sufficiency 是 evidence-set property，不是 passage relevance 的平均

**已確認（論文）**：SURE-RAG 強調 missing hop、conflict、unresolved relation 無法由獨立 passage score 可靠辨識。

底層應拆成：

```text
Candidate Answer
↓ claim decomposition
Claims C={c1...cm}
↓
Evidence E={e1...en}
↓ pair verifier
P(SUPPORT/REFUTE/NEUTRAL | ci, ej)
↓ set aggregation
coverage
relation strength
conflict
disagreement
retrieval uncertainty
↓
SUPPORT / REFUTE / INSUFFICIENT
```

因此：

```text
Top-K relevance high
≠
all required claims supported
```

**工程推論**：Hermes 的 `EvidenceCoverageCertificate` 必須以 required claim / dependency graph 為單位，而不是 document count。

來源：https://arxiv.org/abs/2605.03534 ; https://www.techscience.com/cmc/v89n1/68467/html

### 3. Conformal coverage 可以保證「保留支持片段的機率」，但不能直接保證答案正確

**已確認（論文 + 官方 code README）**：conformal context engineering 對 calibration set 中 relevant snippets 的 nonconformity scores 取分位數 threshold，控制新樣本下 supporting snippets 被保留的 coverage。

Bottom-level mechanism：

```text
Calibration queries
↓
Known relevant snippets
↓
Nonconformity score A(q,s)
↓
Quantile threshold τ̂_α
↓
New query candidates
↓
keep if A(q,s) ≤ τ̂_α
↓
coverage-controlled context
```

但保證是：

```text
P(relevant snippet retained) ≥ 1-α
```

不是：

```text
P(answer correct) ≥ 1-α
```

**為什麼重要**：這直接防止 Hermes 把 `CoverageCertificate` UI 誤畫成「答案 95% 正確」。

**限制**：exchangeability / calibration distribution assumptions 若遭 domain shift 破壞，coverage 可能失效；而 relevance label 本身也可能有 noise。

來源：https://arxiv.org/abs/2511.17908 ; https://github.com/hltcoe/conformal-context-engineering

### 4. Safe stopping 應該比較「再搜一次的預期決策價值」而非單看 confidence

**論文結果 + 合理系統建模**：Stop-RAG 把 retrieval control 建模為 finite-horizon MDP；這與前面 Hermes 的 Dream Budget / Verification VoI 其實是同一個底層控制問題。

Hermes 可統一成：

```text
Q_continue(s_t)
≈ E[DecisionUtility after one more retrieval]
  - retrieval_cost
  - latency_cost
  - context_pollution_risk

Q_stop(s_t)
≈ DecisionUtility(current evidence)
  - residual_missing_evidence_risk

STOP iff Q_stop ≥ Q_continue
```

新增重要區分：

```text
Sufficiency confidence high
≠
Expected value of more retrieval low
```

例如 high-risk action 即使目前 evidence 看似 sufficient，只要一個低成本 reality probe 有很高 VoI，仍不該停止。

來源：https://arxiv.org/abs/2510.14337 ; https://arxiv.org/abs/2608.13237

### 5. Retrieval coverage certificate 應是分層證書，不是一個百分比

**合理工程推論，尚待 production 驗證**：Hermes 應將 certificate 拆成至少四層：

```text
L0 Retrieval Coverage
  是否保留已知 relevant evidence？

L1 Claim Coverage
  required claims 是否都有 supporting evidence？

L2 Dependency Coverage
  multi-hop dependency chain 是否閉合？

L3 Decision Coverage
  是否存在 plausible hidden evidence 足以翻轉 decision？
```

其中只有 L0 最接近現有 conformal retrieval guarantee；L1/L2 可由 claim graph / SURE-style aggregation近似；L3 仍需要 HiddenEvidenceProbe、counterfactual search 或 reality verification，不能假裝已有統計完備保證。

---

## Architecture Breakdown

### Decision-Sufficient Retrieval Controller

```text
User / Agent Decision Goal
↓
Decision Requirement Graph
├ claims
├ dependencies
├ risk level
└ modality requirements
↓
Candidate Retrieval
↓
Conformal Context Filter
↓
Evidence Relation Graph
├ SUPPORT
├ REFUTE
├ CONFLICT
└ UNKNOWN
↓
Set-Level Sufficiency Verifier
↓
Coverage Certificate Builder
├ L0 retrieval coverage
├ L1 claim coverage
├ L2 dependency coverage
└ L3 hidden-gap risk
↓
Sequential Stop Controller
├ Q_stop
└ Q_continue
↓
STOP / RETRIEVE / REALITY_PROBE / ABSTAIN
↓
Answer / Action
↓
Outcome feedback
↓
Stopping Calibration Memory
```

### 與上一輪差異

上一輪：

```text
缺什麼？→ 搜什麼？→ 證據夠不夠？
```

本輪：

```text
「夠」這個判斷可信嗎？
↓
現在停止的 regret 是多少？
↓
coverage certificate 到底保證哪一層？
```

---

## Bottom-Level Logic

### Sequential stopping regret

定義 oracle trajectory 在完整 retrieval budget 下可取得最佳 decision utility `U*`，實際 stopping time 為 `τ`：

```text
StoppingRegret(τ)
=
U* - U(E_τ) + Cost(retrieval_1:τ)
```

需另外分：

```text
EarlyStopRegret
LateStopWaste
ContextPollutionCost
RealityProbeOpportunityCost
```

### Coverage calibration

對 relevant evidence 的 nonconformity score：

```text
A(q,s)=1-score(q,s)
```

在 calibration relevant set 上取得 `(1-α)` quantile `τ̂_α`，新 evidence 若 `A(q,s)≤τ̂_α` 則保留。

真正的 certificate metadata 必須包含：

```text
alpha
calibration_dataset
calibration_n
scorer_version
embedding/model_version
domain
modality
created_at
validity_window
shift_status
coverage_target
coverage_scope
```

否則 `95% coverage` 沒有可解釋性。

---

## Visual Simulation Idea

# Retrieval Stop Observatory × Evidence Coverage Certificate Lab

互動左側：

```text
Round 0 → Round 1 → Round 2 → Round 3 → Round 4
   │         │         │         │         │
Evidence   +doc      +image    +tool     +doc
```

每輪顯示：

```text
Claim coverage        55% → 72% → 81% → 96%
Dependency closure    40% → 60% → 80% → 100%
Hidden-gap risk       .52 → .31 → .18 → .07
Q_continue            .71 → .48 → .21 → -.03
Q_stop                .22 → .39 → .58 → .77
```

使用者可拖：

```text
Retrieval Cost
Decision Risk
α Coverage Target
Context Budget
Reality Probe Cost
```

畫面必須明確分開四張 badge：

```text
Retrieval Coverage Certificate   95%
Claim Coverage                   96%
Dependency Closure               100%
Decision Completeness            UNPROVEN
```

不能把它們合成一個「Confidence 97%」。

另提供 counterfactual：點擊 `STOP @ Round 2`，系統 replay 後續 round，直接顯示 `EarlyStopRegret` 與「哪一份後續 evidence 翻轉了 decision」。

---

## Code / GitHub

### hltcoe/conformal-context-engineering

URL: https://github.com/hltcoe/conformal-context-engineering

值得看的位置：

```text
README.md
prompts/
examples/
```

目前 repository 不是完整 production runtime，核心價值是可驗證的 calibration protocol：embedding / LLM nonconformity scoring、threshold calibration、NeuCLIR / RAGTIME split 與 coverage reporting。

值得搬進 Hermes 的不是整個 repo，而是：

```text
ConformalEvidenceFilter
CoverageCertificate
CalibrationSplitRegistry
CoverageDriftMonitor
```

### 下一步值得讀原始碼

1. `hltcoe/conformal-context-engineering/prompts/`：確認 relevance labeling 與 LLM scoring contract。
2. Stop-RAG 若官方 code 可得：追 state representation、Q target、STOP action 與 rollout generation。
3. SURE-RAG 若官方 code 可得：追 claim/evidence pair verifier 與 set aggregation。

---

## Papers

### SURE-RAG
- Title: SURE-RAG: Sufficiency and Uncertainty-Aware Evidence Verification for Selective Retrieval-Augmented Generation
- Authors: Jingxi Qiu, Zeyu Han, Cheng Huang
- Year: 2026
- URL: https://arxiv.org/abs/2605.03534
- Architecture: pair-level claim/evidence verifier → set-level aggregation → three-way sufficiency decision
- Contribution: 把 evidence sufficiency 從 passage relevance 提升成 auditable set-level verification
- Limitation: controlled sufficiency verification 不等同 general hallucination detection；作者報告在 HaluBench 上與 GPT-4o 的優勢排序反轉

### When Should Multi-Round RAG Stop?
- Author: Weimeng Luo
- Year: 2026
- URL: https://arxiv.org/abs/2608.13237
- Architecture: frozen Search-R1 + structured S2G-style stopping judge
- Dataset: HotpotQA
- Contribution: 明確把 stopping 視為 first-STOP sequential selection
- Limitation: retrieval calls 下降不等於總 inference cost 或 safe stopping

### Principled Context Engineering for RAG
- Authors: Debashish Chakraborty, Eugene Yang, Daniel Khashabi, Dawn Lawrie, Kevin Duh
- Year: 2025/2026
- URL: https://arxiv.org/abs/2511.17908
- Code: https://github.com/hltcoe/conformal-context-engineering
- Datasets: NeuCLIR, RAGTIME
- Architecture: nonconformity scorer → calibration quantile → coverage-controlled filter
- Contribution: 對 relevant evidence retention 提供統計 coverage control
- Limitation: coverage scope 是 supporting snippets，不是 end-to-end answer correctness

### Stop-RAG
- Authors: Jaewan Park, Solbee Cho, Jay-Yoon Lee
- Year: 2025
- URL: https://arxiv.org/abs/2510.14337
- Architecture: finite-horizon MDP + value-based retrieval controller
- Contribution: 從「confidence stop」改成「future retrieval value」控制
- Limitation: value function 會繼承 training trajectories / domain 的 distribution assumptions

---

## Unknown / Open Questions

1. **Decision-level conformal guarantee 能否成立？** 現有較清楚的是 snippet retention / generation-risk 類保證；從 evidence coverage 推到「不會因漏證據而做錯高風險決策」仍缺中間理論。
2. **Sequential stopping 的 calibration 如何處理 distribution shift？** Pointwise sufficiency calibration 與 first-STOP trajectory risk 不是同一個 calibration problem。
3. **跨模態 coverage 的 sample unit 是什麼？** text snippet、image region、video interval、audio span、tool event 的粒度不同，單一 α 很可能沒有一致語義。

---

## 下一輪研究

**Cross-Modal Evidence Units × Multimodal Conformal Coverage × Source Rehydration × Decision-Level Risk Certificates**

優先拆：

```text
Image → region / object / OCR span
Video → frame / temporal interval / track
Audio → timestamp span / speaker turn / event
Tool → request / response / field / side effect
MCP → resource version / tool result / permission decision
```

再研究不同 evidence units 如何進同一個 `EvidenceRequirementGraph`，以及 certificate 如何在 modality-specific coverage 與 decision-level risk 之間傳遞。

---

## Knowledge Graph 新增 Node / Edge

### Nodes

```text
DecisionSufficientRetrieval
SequentialRetrievalStopping
StoppingPolicy
StoppingRegret
EarlyStopRegret
LateStopWaste
ContextPollutionCost
EvidenceSetSufficiency
SetLevelEvidenceVerifier
ConformalEvidenceFilter
CoverageCertificate
CoverageScope
ClaimCoverage
DependencyCoverage
DecisionCoverage
CoverageDrift
RetrievalValueFunction
RealityProbeOpportunity
AbstentionPolicy
```

### Edges

```text
PassageRelevance
≠ EvidenceSetSufficiency

EvidenceSetSufficiency
≠ SafeStopping

SafeStopping
≠ AnswerCorrectness

ConformalRetrievalCoverage
≠ DecisionCorrectnessGuarantee

FirstFalsePositiveStop
→ TruncatesFutureEvidence

RetrievalCost
+ ContextPollutionRisk
+ ExpectedEvidenceGain
→ DeterminesStoppingValue

ClaimCoverage
+ DependencyClosure
+ HiddenGapRisk
→ InformsDecisionSufficiency

CoverageCertificate
→ MustDeclareCoverageScope

DistributionShift
→ CanInvalidateCoverageCalibration
```

---

## 本輪結束判定

- **缺哪一層：** Decision-level risk certificate，尤其從 retrieval coverage 到高風險 action correctness 的理論橋接。
- **哪個節點最淺：** `DecisionCoverage`、`CoverageDrift`、`CrossModalCoverageUnit`。
- **哪個概念仍只是名詞：** `Evidence Completeness Certificate`；目前不能宣稱 universal completeness。
- **哪個系統值得讀原始碼：** `hltcoe/conformal-context-engineering` 的 prompts / examples；下一優先 Stop-RAG controller code（若官方釋出）。
- **哪篇論文需追引用：** `When Should Multi-Round RAG Stop?` 與 `Principled Context Engineering for RAG`，因為兩者剛好分別處理 sequential stop 與 statistical coverage，但尚未真正統一。
- **哪個概念最適合視覺模擬：** `Retrieval Stop Observatory × Evidence Coverage Certificate Lab`。
- **哪個 Agent 架構最值得實作：** `Conformal Evidence Filter → Set-Level Sufficiency Verifier → Sequential Stop Controller → Hidden Evidence Probe → Reality/Abstain Escalation`。

## 對「AI 到底怎麼運作」新增的核心

可靠 AI 的 retrieval 不能只問「我找到的內容相關嗎？」；它還要區分「這組證據是否真的支援整條推理鏈」、「再搜尋一次是否值得」、「現在停止的錯誤代價是多少」，以及「95% coverage 到底是在保證哪一件事」。真正成熟的 Agent 應把 retrieval 當成 sequential sensing policy：每次搜尋都消耗成本、可能補足缺口，也可能帶入噪音；停止搜尋本身是一個需要校準、可 replay、可計算 regret 的決策。