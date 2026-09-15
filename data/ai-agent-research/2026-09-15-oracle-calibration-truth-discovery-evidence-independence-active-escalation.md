# 【AI Agent × Multimodal Research Report】

**時間：2026-09-15 08:53（Asia/Taipei）**  
**主題：Oracle Calibration × Truth Discovery × Evidence Independence × Active Reality/Human Escalation**

## 與歷史研究的差異

上一輪已把 Independent Oracle 拆成 Property / Metamorphic / Differential / Symbolic / Real Execution / LLM / Human 等多種 verifier，並指出「多數決 ≠ 真實」與「不同 provider ≠ 獨立錯誤」。本輪不重複 Oracle 類型，而是補下一層：**當所有 Oracle 都可能錯、且彼此相關時，如何估計每個 Oracle 的可靠度、融合衝突證據、決定何時花成本取得 Human/Reality gold evidence。**

---

# 本小時新發現

1. **Nine Judges, Two Effective Votes: Correlated Errors Undermine LLM Evaluation Panels** — Guneet Kohli, Apple, 2026. URL: https://arxiv.org/abs/2605.29800 。九個 frontier judges、七個 model families，在三個 NLI datasets（每題 100 human annotations）上，資訊量約只等同 2 個獨立 votes；panel accuracy 比 independence ideal 低 8–22 percentage points。核心改變：應估 effective evidence，而非 nominal judge count。

2. **Dependence-Aware Label Aggregation for LLM-as-a-Judge via Ising Models** — Krishnakumar Balasubramanian, Aleksandr Podkopaev, Shiva Prasad Kasiviswanathan, 2026. URL: https://arxiv.org/abs/2601.22336 。指出 Dawid–Skene / weighted majority 的 conditional-independence assumption 在 LLM judges 上可能失效；以 class-dependent Ising / latent-factor models 顯式建模 judge coupling。核心改變：Evidence Fusion 必須能表達 pairwise / latent dependence。

3. **Noisy but Valid: Robust Statistical Evaluation of LLMs with Imperfect Judges** — Chen Feng, Minghe Shen, Ananth Balashankar, Carsten Gerner-Beuerle, Miguel Rodrigues, ICLR 2026. URL: https://proceedings.iclr.cc/paper_files/paper/2026/hash/08a67eb74bfb9ded9e949dd52973e997-Abstract-Conference.html 。用小型 human-labeled calibration set 估 judge TPR/FPR，再對大量 judge-labeled data 做 variance-corrected hypothesis testing，提供 finite-sample Type-I error control。核心改變：Judge reliability 應用 confusion matrix + calibration uncertainty 表達，而不是單一 accuracy。

4. **Can We Trust LLM Judges: A Study of Capability-Dependent Biases and Multi-Judge Ensemble for Bias Calibration** — Gemma Zhang, Prachi Badarayani, Asmi Kumar, Sadid Hasan, Sulaiman Vesal, 2026. URL: https://arxiv.org/abs/2609.12002 。在四 benchmarks、六 models、36 judge-examinee pairs 中研究 absolute scoring；提出依 online false-positive/false-negative estimates 加權的 calibrated WMV，並以 inter-judge disagreement 在無 gold labels 時估 error rates。核心改變：Judge weight 應是 class-conditional、可線上更新，而非固定 reputation score。

5. **Human-Anchored Factuality Evaluation with Strategic Annotation** — Yu Wang, Craig Erickson, Kevin Small, 2026. URL: https://arxiv.org/abs/2609.00494 。核心方向是有限 human annotation budget 下，策略性選擇最值得人工校準的 failure space。對 Hermes 的直接含義：Human/Reality escalation 應視為 active verification / value-of-information 問題。

6. **Agreement Metrics for LLM-as-Judge Evaluation: What to Report and Why** — Delip Rao, Chris Callison-Burch, 2026. URL: https://arxiv.org/abs/2606.00093 。指出 binary judge 中多個常見 correlation metrics 實際冗餘；abstention handling、coverage、confusion matrix 與 aggregation level 必須顯式報告。核心改變：Oracle certificate 不能只給 accuracy / kappa 一個數字。

7. **judgepanel** — Hadi Mohammadi, 2026. Code: https://github.com/mohammadi-hadi/judgepanel 。公開工程實作以 Dawid–Skene EM 在無 gold labels 下共同估計 latent truth、class prevalence 與每個 judge confusion matrix，另提供 bootstrap uncertainty、agreement diagnostics 與 panel simulation。

---

# 本小時最重要 5 個發現

## 1. Oracle reliability 應是 confusion matrix，不是單一 accuracy

對 binary PASS/FAIL oracle，至少維護：

```text
P(judge=FAIL | truth=FAIL) = sensitivity
P(judge=PASS | truth=PASS) = specificity
P(judge=FAIL | truth=PASS) = false positive rate
P(judge=PASS | truth=FAIL) = false negative rate
```

同一個 90% accuracy judge，若 FAIL 是 rare class，可能仍漏掉大多數真正 failures。因此 Hermes 應新增 `OracleCalibrationProfile`，按 domain / task / severity / language / modality / time window 分桶保存 confusion matrix、sample size、confidence interval 與 calibration timestamp。

**已確認事實：** Noisy-but-Valid 使用小型 human calibration set 估 TPR/FPR 並把 estimation uncertainty 納入統計測試。  
**工程推論：** Hermes 的 release gate 應優先使用 class-conditional error bounds，而非 raw judge pass rate。

## 2. Dawid–Skene 能從 disagreement 反推 latent truth，但 independence assumption 是核心弱點

Dawid–Skene 模型：

```text
latent truth Y_i
↓
judge-specific confusion matrices C_j
↓
observed labels L_ij
```

E-step：

```text
P(Y_i=k | labels)
∝ prior(k) × Π_j C_j[k, L_ij]
```

M-step：

```text
用 posterior soft counts
重新估 class prior + 每個 judge confusion matrix
```

`judgepanel/src/judgepanel/em.py` 的實作正是這個 loop：posterior 初始化自 soft majority votes；E-step 將每個 judge 的 log confusion likelihood 累加；M-step 用 posterior × emitted-label one-hot 重新估 confusion matrix，並加 Laplace smoothing。它也明確在 module docstring 寫出「labels are conditionally independent across judges given the true class」。

這是很好的 baseline，但上一輪的 correlated-error evidence 表明 LLM panel 經常違反這個假設。

所以：

```text
Dawid-Skene posterior
≠ Ground truth posterior under correlated judges
```

## 3. Evidence independence 必須進模型，而不能只做 UI diversity badge

Dependence-aware Ising aggregation 的核心是把 judge votes 的 interaction 直接寫入 posterior。

independence baseline 的 log-odds 可近似：

```text
logit P(Y=1 | votes)
≈ b + Σ_i w_i v_i
```

若 judges 有 class-dependent coupling，則需要：

```text
logit P(Y=1 | votes)
≈ b + Σ_i w_i v_i + Σ_{i<j} J_ij v_i v_j
```

`J_ij` 表示「這兩個 verifier 同時這樣投票」是否提供額外資訊，或只是共享 blind spot。

因此 Hermes 應新增 `EvidenceIndependenceGraph`：

```text
Oracle A ── error corr .72 ── Oracle B
Oracle A ── error corr .11 ── Property Oracle
Oracle B ── shared evidence ── Oracle C
Reality Oracle ── independent ── others
```

並把 nominal evidence count 換成 `EffectiveEvidenceCount`。Nine Judges, Two Effective Votes 的結果顯示 9 judges 在其測試中只約等於 2 個 independent votes，正說明這一層不能省略。

## 4. Truth discovery 不能只輸出 VERIFIED / FAIL，而應輸出 posterior + epistemic state

建議：

```text
TruthDiscoveryResult
├ P(FAIL)
├ P(PASS)
├ posterior_entropy
├ effective_evidence_count
├ oracle_disagreement
├ dependence_penalty
├ gold_anchor_count
├ calibration_age
└ status
   ├ VERIFIED_FAIL
   ├ VERIFIED_PASS
   ├ DISPUTED
   ├ INCONCLUSIVE
   └ NEEDS_ESCALATION
```

這樣「4 個 judges 說 FAIL」不再自動等於 failure，而是可追溯地回答：哪些 judges、各自 sensitivity/specificity、多大 correlation、是否有 property/reality evidence、posterior 為何。

## 5. Human / Reality escalation 應被建模成 Verification Value of Information

對候選 verifier/action `a`：

```text
VerificationVoI(a)
= Expected Decision Loss Before
- E[Decision Loss After evidence from a]
- VerificationCost(a)
```

Candidate actions：

```text
ASK_CHEAP_LLM_JUDGE
RUN_PROPERTY_TEST
RUN_REAL_SANDBOX
QUERY_TRUSTED_API
REPLAY_REAL_ENVIRONMENT
ASK_HUMAN
ABSTAIN
```

高風險 case 不一定要「多叫幾個 LLM」，因為相關 judge 可能幾乎不增加 effective evidence。真正好的 escalation policy 應挑能最大降低 posterior uncertainty / decision risk 且與既有 evidence 最獨立的 oracle。

**合理推論：** 這可直接重用前幾輪 Active Perception / VoI 架構，只是 observation source 從 Camera/Tool 改成 Oracle/Human/Reality。

---

# Architecture Breakdown

```text
Candidate Failure / Claim
↓
Oracle Contract Resolver
↓
Existing Oracle Evidence
↓
Calibration Layer
├ confusion matrix
├ domain-conditioned accuracy
├ calibration age
├ bootstrap CI
└ abstention / coverage
↓
Dependence Layer
├ pairwise error correlation
├ shared model family
├ shared prompt
├ shared evidence source
├ shared tool chain
└ latent-factor / Ising coupling
↓
Truth Discovery Engine
├ Dawid–Skene baseline
├ dependence-aware aggregation
├ gold-anchor update
└ posterior over truth
↓
Decision Risk
↓
Active Oracle Selector
├ expected information gain
├ expected loss reduction
├ independence gain
├ monetary / latency cost
└ human / reality cost
↓
Oracle / Human / Reality Action
↓
New Evidence
↓
Posterior Update
↓
Verdict / Abstain / Escalate
↓
Calibration Memory Update
```

---

# Bottom-Level Logic

## Dawid–Skene EM baseline

For item `i`, truth `k`:

```text
q_i(k)
∝ π_k ∏_j C_j[k, l_ij]
```

M-step：

```text
π_k = normalized Σ_i q_i(k)

C_j[k,l]
= normalized Σ_i q_i(k) · 1[l_ij=l]
```

`judgepanel` 原始碼還使用 smoothing 保持 probabilities > 0，少於 3 judges 時發出 weak-identification warning，binary panel 若收斂到 label-swapped mirror solution 會做 class flip。

## Bootstrap calibration uncertainty

`src/judgepanel/uncertainty.py` 會 item-level bootstrap：每輪有放回重抽 items、重新 fit Dawid–Skene，再對 per-judge accuracy、prevalence、sensitivity、specificity 取 percentile intervals。

因此 Hermes 不應只存：

```text
judge sensitivity = .91
```

而應存：

```text
sensitivity = .91
95% CI = [.82, .96]
calibration_n = 180
```

## Dependence-aware fusion

Class-dependent Ising conceptual form：

```text
P(votes | Y=y)
∝ exp(
  Σ_i h_i^(y) v_i
  + Σ_{i<j} J_ij^(y) v_i v_j
)
```

這允許「A+B 一起錯」不是被當成兩份獨立證據。

## Effective evidence

Hermes 可用 empirical error-correlation matrix `R` 建立簡化有效票數估計，或在 panel-level calibration 中使用 Kish-style effective sample size；核心原則是：

```text
NominalJudgeCount
≠ EffectiveEvidenceCount
```

---

# Visual Simulation Idea

## Oracle Truth Observatory × Active Escalation Lab

畫面左側顯示同一 case：

```text
LLM Judge A      FAIL  sens .92 spec .81
LLM Judge B      FAIL  sens .90 spec .83
LLM Judge C      FAIL  sens .91 spec .80
Property Oracle  PASS  authority HIGH
Sandbox Replay   UNKNOWN
```

中間不是 vote bar，而是：

```text
A ↔ B error corr .81
B ↔ C error corr .76
A ↔ C error corr .79
Property Oracle ↔ LLM panel corr .08

Nominal votes = 4
Effective evidence ≈ 1.9
```

右側顯示 posterior：

```text
P(FAIL) .63
P(PASS) .37
Entropy HIGH
Decision risk HIGH
```

下方列下一個 verification action：

| Action | Expected ΔEntropy | Risk reduction | Independence gain | Cost | Net VoI |
|---|---:|---:|---:|---:|---:|
| Ask LLM D | .03 | .02 | .01 | low | .01 |
| Property replay | .18 | .21 | .17 | low | .19 |
| Sandbox execution | .41 | .54 | .39 | med | **.43** |
| Human review | .47 | .60 | .48 | high | .31 |

系統選 `RUN_SANDBOX_EXECUTION`。新 reality evidence 回來後，posterior 動畫更新，並同步更新 judge calibration memory。

---

# Code / GitHub

### mohammadi-hadi/judgepanel

Repository： https://github.com/mohammadi-hadi/judgepanel

值得讀的目錄 / 檔案：

```text
src/judgepanel/em.py
  Dawid–Skene EM、confusion matrix、posterior truth

src/judgepanel/uncertainty.py
  item-level bootstrap calibration intervals

src/judgepanel/agreement.py
  panel agreement diagnostics

src/judgepanel/panel.py
  panel representation

src/judgepanel/simulate.py
  panel / failure-mode simulation

src/judgepanel/vote.py
  majority-vote baseline
```

工程判斷：很適合作為 Hermes `TruthDiscoveryEngine` 的 baseline reference，但不能直接當 production truth engine，因為其 Dawid–Skene core 明確假設 conditional independence；Hermes 必須在上層加入 dependence-aware aggregation / correlation diagnostics / gold-anchor calibration。

---

# Papers

## Nine Judges, Two Effective Votes
- Author: Guneet Kohli
- Institution: Apple
- Year: 2026
- URL: https://arxiv.org/abs/2605.29800
- Architecture: multi-judge panel → correlated-error analysis → effective sample size / Condorcet null comparison
- Contribution: 把 nominal panel size 與 effective independent evidence 分開。
- Limitation: datasets / judge configurations 仍有限，不代表所有 verifier panel 都固定縮成相同比例。

## Dependence-Aware Label Aggregation for LLM-as-a-Judge via Ising Models
- Authors: Krishnakumar Balasubramanian, Aleksandr Podkopaev, Shiva Prasad Kasiviswanathan
- Year: 2026
- URL: https://arxiv.org/abs/2601.22336
- Architecture: class-dependent / independent Ising couplings + latent-factor dependence
- Contribution: 顯式建模 judge dependence；證明 independence methods 在 latent-factor dependence 下可有 nonvanishing excess risk。
- Limitation: dependence estimation 本身需要足夠 panel data；open-world oracle types 可能不是 binary homogeneous annotators。

## Noisy but Valid
- Authors: Chen Feng, Minghe Shen, Ananth Balashankar, Carsten Gerner-Beuerle, Miguel Rodrigues
- Venue: ICLR 2026
- URL: https://proceedings.iclr.cc/paper_files/paper/2026/hash/08a67eb74bfb9ded9e949dd52973e997-Abstract-Conference.html
- Architecture: small human calibration set → estimate TPR/FPR → variance-corrected large-scale noisy testing
- Contribution: finite-sample validity despite imperfect judge calibration.
- Limitation: 需要 human calibration labels；主要處理統計 certification，不是 general heterogeneous-oracle runtime。

## Can We Trust LLM Judges
- Authors: Gemma Zhang et al.
- Year: 2026
- URL: https://arxiv.org/abs/2609.12002
- Architecture: absolute-score judges → online FP/FN estimates → calibrated weighted majority voting
- Contribution: class-conditional judge weighting與 label-free disagreement estimator。
- Limitation: label-free reliability inference 在 strongly correlated panels 下仍需特別驗證。

---

# Unknown / Open Questions

1. **Dependence estimation under sparse heterogeneous oracles**：Property Oracle、LLM Judge、Sandbox、Human 的 evidence 型態不同，不能直接套 homogeneous Ising panel；需要 heterogeneous factor graph。
2. **Calibration drift**：模型版本、prompt、tool schema、domain distribution 改變後，舊 confusion matrix 多快失效？需要 online drift detector 與 calibration TTL。
3. **Active gold acquisition**：如何在極小 human/reality budget 下挑最能同時改善 truth posterior 與 verifier calibration 的 cases？

---

# 下一輪研究

**主題：Active Calibration × Calibration Drift × Gold-Anchor Selection × Verification Budget Allocation**

下一輪優先追：

```text
active learning for evaluator calibration
human-anchored factuality strategic annotation
calibration drift detection
conformal selective judging
verification budget allocation
adaptive gold sampling
online confusion-matrix update
```

目標新增：

```text
CalibrationDriftEvent
CalibrationTTL
GoldAnchorSelector
ActiveCalibrationPolicy
VerificationBudgetController
OracleCalibrationReplay
DomainConditionedConfusionMatrix
```

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
OracleCalibrationProfile
OracleConfusionMatrix
OracleSensitivity
OracleSpecificity
CalibrationUncertainty
CalibrationAge
TruthDiscoveryEngine
DawidSkeneAggregator
DependenceAwareAggregator
IsingJudgeGraph
EvidenceIndependenceGraph
EffectiveEvidenceCount
OraclePosteriorTruth
GoldAnchor
ActiveOracleSelector
VerificationValueOfInformation
OracleEscalationPolicy
OracleReliabilityCertificate
```

## Edges

```text
Judge Accuracy
≠ Class-Conditional Reliability

Nominal Judge Count
≠ Effective Evidence Count

Dawid-Skene
→ Assumes Conditional Independence

Correlated Judge Errors
→ Can Miscalibrate Truth Posterior

Judge Confusion Matrix
→ Conditions Evidence Weight

Gold Anchor
→ Calibrates Oracle Reliability

Verifier Dependence
→ Discounts Evidence

High Posterior Uncertainty
+
High Decision Risk
→ Triggers Active Escalation

Reality / Human Evidence
→ Updates Truth Posterior
→ Updates Oracle Calibration
```

---

# 本輪結論

**缺哪一層：** Active Calibration + Calibration Drift + Gold-Anchor Budget Layer。  
**哪個節點最淺：** `ActiveOracleSelector`、`CalibrationDrift`、`HeterogeneousEvidenceFusion`。  
**哪個概念仍只是名詞：** production 級 `Independent Evidence`；目前仍缺跨 Oracle 類型的可驗證 independence 定義。  
**哪個系統值得讀原始碼：** `mohammadi-hadi/judgepanel`，尤其 `em.py`、`uncertainty.py`；下一輪需找 dependence-aware aggregation 的公開實作。  
**哪篇論文需追引用：** `Nine Judges, Two Effective Votes` 與 `Dependence-Aware Label Aggregation...`。  
**哪個概念最適合視覺模擬：** `Oracle Truth Observatory × Active Escalation Lab`。  
**哪個 Agent 架構最值得實作：** `Calibrated Oracle Router`：Oracle Planner → Reliability/Dependence Model → Truth Discovery → VoI-based Reality/Human Escalation → Calibration Memory。

最終核心：**可靠 AI 不能把「很多模型都同意」當成真實。每個 verifier 都應被視為一個帶有 confusion matrix、domain、時間漂移與相關錯誤的 noisy sensor；系統要推理的不只是答案，而是「誰在什麼條件下值得信、這些證據是否其實重複、下一份最值得花成本取得的真實證據是什麼」。這使 Oracle layer 從投票器升級成一個可校準、可更新、會主動尋找真實錨點的 Bayesian / decision-theoretic verification runtime。