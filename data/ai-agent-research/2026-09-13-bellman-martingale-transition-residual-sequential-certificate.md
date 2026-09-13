# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 14:52 Asia/Taipei**  
**本輪主題：Bellman Martingale × Visit-Gated Transition Residual × Markov-State Sufficiency × Likelihood-Mixing Confidence Process × Trajectory Permission Certificate**

---

## 0. 與歷史研究比較：本輪刻意不重複什麼

上一輪已經建立：

- trajectory likelihood ratio / PDIS；
- occupancy-ratio correction；
- DualDICE / FORE；
- transition confidence sequence；
- trajectory coverage certificate；
- `Bellman Martingale Candidate` 與 `Trajectory Evidence Certificate` 仍是淺節點。

因此本輪不再回答「怎麼做 MDP OPE」，而改問更底層的問題：

> **哪一個 MDP residual 可以在資料到來前被預先定義，並在正確 state semantics 下滿足 conditional-mean-zero / supermartingale contract，進而成為真正的 sequential evidence primitive？**

本輪將 MDP sequential evidence 拆成兩條不同路：

```text
A. Transition-first
visit-gated transition residual
→ martingale difference
→ transition e-process / CS
→ uncertain transition kernel
→ robust model checker / planner

B. Bellman-first
candidate value / occupancy object
→ Bellman residual
→ conditional moment contract
→ sequential test candidate
→ policy certificate
```

核心新增區分：

```text
Transition Confidence
≠ Bellman Confidence

Markov Transition Residual
≠ Mixing-Time Correction Automatically

Small Empirical Bellman Residual
≠ Martingale Validity

Offline Occupancy Estimate
≠ Sequential E-Process
```

---

# 1. 本小時新發現

## 1.1 新論文 / 新架構：MDP transition probability 可以直接做 time-uniform online model checking

**Title:** Confidence Sequences for Online Statistical Model Checking of Markov Decision Processes  
**Authors:** Konstantin Kueffner, Tobias Meggendorfer, Maximilian Weininger, Patrick Wienhöft  
**Institution:** Institute of Science and Technology Austria / Lancaster University Leipzig / Ruhr University Bochum / TU Dresden（依公開作者頁資訊）  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2606.25797  
**Code:** 論文公開資訊指出有高效實作工具；本輪未找到可可靠定位的官方 GitHub repo，因此不把第三方 mirror 當官方 code。  
**Dataset / Benchmark:** MDP statistical model checking benchmarks。  
**Architecture:** transition observations → confidence sequences for transition probabilities → uncertain MDP → solve property/value bounds。  
**Contribution:** 將 repeated sample-infer-solve 從固定時間 CI 改成真正 time-uniform CS；作者報告平均約比既有 union-bound style 方法少 50× samples。  
**Limitations:** 論文處理的是 MDP transition uncertainty / statistical model checking，不等於已解 Agent trajectory OPE，也不直接提供 occupancy-ratio e-process。

**已確認事實：**論文核心是 transition-probability confidence sequences + online statistical model checking。  
**論文結果：**作者報告平均 50× sample savings；不可直接外推到 Hermes workload。

---

## 1.2 新 bottom-level mechanism：visit-gated transition residual 本身就是自然的 martingale increment

對固定 `(z,y)`，定義：

```text
I_t(z) = 1{X_{t-1}=z}
J_t(y) = 1{X_t=y}

M_t(z,y)
= I_t(z) [ J_t(y) - P(y|z) ]
```

若 `X_{t-1}` 是真正充分的 Markov state，且 transition kernel 是 `P`：

```text
E[J_t(y) | F_{t-1}, X_{t-1}=z]
= P(y|z)
```

因此：

```text
E[M_t(z,y) | F_{t-1}] = 0
```

這個結構非常重要，因為它表示：

> **對 transition coordinate 做 sequential inference，不一定需要先把整條 Markov chain 當 IID；可以在「只有 visit 該 row 時才醒來」的 predictable gating 下建立 martingale evidence。**

FormalSLT 的 `EmpiricalTransitionConfidence.lean` 已形式化一個高度接近的架構：

```text
TransitionCoordinate(z,y, direct/complement)
↓
visit-gated score
↓
trajectory empirical Bernstein PAC-Bayes boundary
↓
direct + complement two-sided band
↓
normalized transitionCoordinateRadius
↓
row total-variation radius
```

其 theorem `exists_empiricalTransitionCoordinate_event` 給出一個 outer event，同時對所有 transition coordinates、所有 time index（n≥2）控制 predictable visit-gated transition mass 與 observed edge mass 的差。

**工程意義：**Hermes 可把 Tool/MCP state-transition verifier 的最底層 primitive 定義成「row 被 visit 時才更新」的 transition evidence，而不是每個 global clock 都硬更新。

---

## 1.3 新發現：mixing assumption 不是所有 transition evidence 的第一層；真正第一層是 state sufficiency + filtration

常見直覺是：

```text
Markov data dependent
→ 一定先估 mixing time
→ 才能做 concentration
```

本輪確認這不是唯一方法。

若檢驗的是單步 transition coordinate，且目前 state 真正滿足 Markov conditional law，則：

```text
predictable state visit
↓
next-state indicator
↓
conditional expectation known under candidate kernel
↓
martingale difference
```

可以直接使用 martingale / betting / likelihood-ratio machinery。

`mixing` 更常在以下目標成為必要或效率相關：

- stationary distribution；
- long-run average risk；
- single-trajectory global empirical frequency；
- state abstraction error；
- dependence not removed by conditioning；
- invariant-law sensitivity。

因此 Hermes 新增 gate：

```text
StateEvidenceRegime
├ CONDITIONAL_MARKOV
├ HISTORY_MARKOV
├ BELIEF_STATE_MARKOV
├ MIXING_REQUIRED
├ NONSTATIONARY
└ INVALID_STATE_ABSTRACTION
```

核心否定 edge：

```text
Dependent Data
≠ Mixing Correction Required First
```

但：

```text
Observed UI State
≠ Markov State
```

如果 Hermes 把過度壓縮的 memory summary 當成 `S_t`，真正 dynamics 仍依賴被遺漏歷史：

```text
P(S_{t+1}|S_t,A_t,H_{t-1})
≠ P(S_{t+1}|S_t,A_t)
```

那上述 residual 就不再是 mean-zero。

---

## 1.4 新架構來源：Sequential Likelihood Mixing 可以成為「候選 transition model → confidence process」的通用 compiler

**Title:** Confidence Estimation via Sequential Likelihood Mixing  
**Authors:** Johannes Kirschner, Andreas Krause, Michele Meziu, Mojmir Mutny  
**Institution:** Swiss Data Science Center / ETH Zurich  
**Year:** 2025  
**URL:** https://arxiv.org/abs/2502.14689  
**Code:** 本輪未把未確認的 repository 當官方 code。  
**Architecture:** conditional likelihood family → likelihood-ratio martingale → sequential mixing distribution → anytime-valid confidence set。  
**Contribution:** 可處理 non-IID / adaptive covariates，並把 approximate Bayesian / variational / sampling inference 接入 confidence construction，同時保留 frequentist coverage under stated conditions。  
**Limitations:** 需要明確 conditional model / likelihood；若 Agent state abstraction 本身 misspecified，coverage 解釋也必須落到 misspecification regime，而不能假裝 kernel 正確。

對 MDP 可直接映射：

```text
x_t := (S_t,A_t)
y_t := S_{t+1}
θ := transition-kernel parameters

p_t(y|θ)
= P_θ(S_{t+1}=y | S_t,A_t)
```

因為 `x_t` 可以依賴完整 past，只要：

```text
S_{t+1} | F_t
```

的 conditional model 被正確指定，就能走 likelihood-ratio martingale 路徑。

這為 Hermes 提供第二條 transition evidence compiler：

```text
Empirical-Bernstein / betting coordinate process
vs.
Likelihood-mixing model process
```

---

## 1.5 新限制：FORE / occupancy ratio 提供 Bellman-flow correction，但沒有自動提供 optional-stopping validity

**Title:** Fitted Occupancy-Ratio Evaluation without Bellman Completeness  
**Authors:** Lars van der Laan, Nathan Kallus  
**Year:** 2026  
**URL:** https://arxiv.org/abs/2607.05375  
**Architecture:** one-step transition data → adjoint Bellman recursion → KL projection in log-ratio class → occupancy ratio → direct / FQE / DR OPE。  
**Contribution:** 以 occupancy-ratio realizability 取代 Bellman completeness 類要求；coverage failure 下提出 coverage-stopped FORE，對 nonnegative rewards給 conservative lower bound。  
**Limitations:** finite-sample / offline evaluation guarantee 不等於 anytime-valid martingale / e-process。

因此：

```text
ζ_hat solves Bellman-flow approximately
≠
ζ_hat can be inserted directly into e-BH / LORD
```

真正缺的 bridge 是：

```text
F_{t-1}
↓
freeze nuisance / candidate object
↓
observe transition_t
↓
construct residual R_t
↓
prove E[R_t | F_{t-1}] = 0 or ≤ 0
↓
bounded/sub-Gamma/likelihood e-factor
↓
E_t
```

---

# 2. 本小時最重要 5 個發現

## 發現 1 — `Transition Residual` 是比 `Policy Value` 更底層的 sequential primitive

### 是什麼

```text
1{state=z}
×
(next-state indicator - candidate transition probability)
```

### 底層如何運作

只有在 state `z` 被 visit 時 score 才啟動；給定過去資訊與 current state，下一狀態 under null kernel 的 conditional mean 已知。

### 為什麼重要

它讓 Hermes 能直接檢驗：

```text
「這個 Tool/MCP/Agent state transition model 還可信嗎？」
```

不必等到整條 reward/value estimate 已經漂移。

### 限制

只在 state semantics / kernel conditional law 正確時成立。

### 來源

Kueffner et al. 2026 + FormalSLT empirical transition confidence formalization。

---

## 發現 2 — `Markov State Validity` 應該是 trajectory evidence 的前置 certificate

### 是什麼

在產生 Bellman / transition e-process 前，先判斷目前 state abstraction 是否足以屏蔽歷史。

### 底層如何運作

```text
Raw history H_t
↓
State encoder φ
↓
S_t = φ(H_t)
↓
check residual dependence on H_{t-1} beyond S_t
↓
Markov sufficiency status
```

### 為什麼重要

Hermes 的 `memory summary`、`tool status`、`UI state` 都可能只是 observation，不是真 state。

### 限制

完全驗證 causal Markov sufficiency 在高維 Agent system 很困難；production 中可能只能有 falsification / diagnostic certificate。

### 來源

MDP conditional-kernel definition + sequential likelihood formulation + FormalSLT conditional transition theorem。

---

## 發現 3 — `Mixing` 應該是 Router branch，不應成為所有 dependent-data evidence 的預設稅

### 是什麼

如果 residual 已對 filtration conditional-center，martingale evidence 可以直接工作；若目標是 stationary/invariant/global dependence quantity，再進 mixing branch。

### 為什麼重要

能避免 Hermes 在每個 Tool state verifier 都先估一個高度不穩定的 mixing time。

### 限制

若 state abstraction 不完整，表面上的 martingale residual 可能其實有 serial bias，此時不能用這條捷徑。

---

## 發現 4 — Transition-first 與 Bellman-first 是兩種不同 certificate architecture

### Transition-first

```text
transition CS
→ uncertain kernel set
→ robust Bellman / reachability solve
→ action risk bound
```

### Bellman-first

```text
candidate V/Q/ζ
→ Bellman residual
→ conditional moment test
→ direct certificate
```

### 為什麼重要

Transition-first 較可解釋、可定位哪個 state-action row 出問題；Bellman-first 可能更直接、更高效，但 theorem contract 更難。

### 限制

目前 Hermes 尚沒有已驗證 production Bellman e-process。

---

## 發現 5 — Formal theorem artifact 可以成為 Agent runtime 的證據 provenance，而不只是研究附件

FormalSLT 的 architecture 明確分：

```text
Probability / LinearAlgebra
↓
Concentration / Azuma
↓
PACBayes / AnytimeValid
↓
StochasticDynamics
↓
Application composition
```

而且要求 theorem checker、`#print axioms`、concrete witness / non-vacuity audit。

對 Hermes 的啟發是：

```text
EvidenceProcessCertificate
```

可再加入：

```text
theorem_source
formalization_status
assumption_set
proof_checker_status
implementation_hash
```

形成：

```text
STATISTICAL RESULT
≠
FORMALLY CHECKED STATISTICAL RESULT
```

這是本輪 system architecture 的新層。

---

# 3. Architecture Breakdown

## 3.1 Hermes：Markov Sequential Evidence Runtime

```text
User / Tool / MCP / Multimodal Event
↓
History H_t
↓
State Constructor
├ raw history state
├ memory-compressed state
├ belief state
└ environment state
↓
Markov-State Sufficiency Gate
├ CONDITIONAL_MARKOV
├ HISTORY_REQUIRED
├ BELIEF_STATE_REQUIRED
├ MIXING_REQUIRED
└ UNRESOLVED
↓
Evidence Router
├ Transition-first
│   ↓
│   Visit-Gated Transition Residual
│   ↓
│   Betting / Empirical-Bernstein / Likelihood-Mixing
│   ↓
│   Transition CS / E-process
│   ↓
│   Uncertain Kernel
│
└ Bellman-first
    ↓
    Frozen Candidate V/Q/ζ
    ↓
    One-Step Bellman Residual
    ↓
    Conditional-Moment Validity Check
    ↓
    Sequential Test Candidate
↓
Risk Solver
├ reachability
├ expected value
├ worst-case value
└ irreversible-state probability
↓
Trajectory Permission Certificate
↓
ALLOW / VERIFY / ASK / SIMULATE / BLOCK
```

---

## 3.2 Transition-first architecture

```text
(S_t,A_t,S_{t+1})
↓
choose coordinate (s,a,s')
↓
visit gate I_t
↓
observed edge mass
↓
expected edge mass under P0
↓
residual
↓
sequential boundary / e-process
↓
row confidence set
↓
transition kernel ambiguity set
↓
robust model checking
```

Production benefit：可以直接指出：

```text
MCP_WRITE
state = authenticated
next_state = permission_denied

predicted p = .01
observed transition evidence strongly inconsistent
```

而不是只顯示：

```text
agent confidence dropped
```

---

## 3.3 Bellman-first architecture（目前仍屬研究 bridge）

對 policy π 的 candidate `Q`：

```text
δ_t(Q)
=
R_t
+
γ E_{a'~π(.|S_{t+1})} Q(S_{t+1},a')
-
Q(S_t,A_t)
```

在 true `Q^π`、state dynamics 正確、reward / transition conditional model正確時：

```text
E[δ_t(Q^π) | F_{t-1}, S_t,A_t] = 0
```

理論上這提供一個 martingale-difference candidate。

但 production e-factor 還必須處理：

```text
Q 是估出來的？
是否在 observation 前 freeze？
reward bounded 嗎？
next-action expectation exact 嗎？
state Markov 嗎？
policy 是否在 episode 中改變？
transition 是否 nonstationary？
```

所以本輪只把它定義成：

```text
BellmanMartingaleContractCandidate
```

而不是宣稱已有完整 theorem-backed e-process。

---

# 4. Bottom-Level Logic

## 4.1 Visit-gated transition coordinate

固定 `(z,y)`：

```text
G_t(z) = 1{X_{t-1}=z}
Y_t(z,y) = G_t(z) 1{X_t=y}
μ_t(z,y) = G_t(z) P(y|z)
D_t = Y_t - μ_t
```

則 under candidate true kernel：

```text
E[D_t | F_{t-1}] = 0
```

因此可以構造 predictable betting：

```text
K_t
=
K_{t-1}(1 + λ_t D_t)
```

前提包含：

```text
λ_t ∈ F_{t-1}
nonnegative factor
candidate null semantics fixed
state semantics fixed
```

或者使用 bounded-martingale exponential / empirical-Bernstein boundary。

FormalSLT 的實作採更完整的 trajectory empirical Bernstein PAC-Bayes route，並對 direct/complement coordinates 取 max 形成 two-sided radius。

---

## 4.2 為什麼 `visit mass` 比 global time 更重要

若某 state `z` 在 10,000 global steps 只被 visit 3 次：

```text
n_global = 10000
n_row(z) = 3
```

真正支撐 `P(.|z)` 的資訊量接近 row visits，而不是 global clock。

所以 Hermes 應保存：

```text
TransitionEvidenceClock
├ global_time
├ state_visit_count
├ state_action_visit_count
├ edge_count
└ intrinsic_time
```

核心否定 edge：

```text
Long Runtime
≠ Strong Evidence For Rare State
```

---

## 4.3 Likelihood-mixing route

候選 transition model `θ`：

```text
L_t(θ)
=
∏_{i≤t}
p_θ(S_{i+1}|S_i,A_i)
```

用 sequential mixing distribution `μ_t(dθ)` 產生 mixture likelihood / ratio process；confidence set 是未被 sequential evidence 排除的 parameter set。

好處：

- 能直接處理 structured parametric transition models；
- covariates `(S_t,A_t)` 可以 adaptive；
- 可以與 approximate inference 對接。

限制：

- state / likelihood misspecification 不會因為用了 Bayesian-looking machinery 自動消失；
- model class realizability / misspecification regime 必須明記。

---

## 4.4 Markov sufficiency failure 如何破壞 evidence

假設 Hermes state：

```text
S_t = current UI page
```

但 next transition 其實還依賴：

```text
login age
prior failed attempts
hidden permission scope
recent MCP write
```

則：

```text
E[1{S_{t+1}=y}|S_t]
```

不是固定 `P(y|S_t)`。

結果：

```text
D_t = observed - expected
```

可能有系統性 drift。

這時 e-process 上升可能不表示「transition kernel 改變」，而是：

```text
state representation insufficient
```

所以異常診斷要有兩個 competing explanations：

```text
KERNEL_DRIFT
STATE_ALIASING
```

---

# 5. Visual Simulation Idea

# **Bellman Martingale × State Sufficiency Lab**

## Panel A — State abstraction switch

使用者切換：

```text
State A:
UI page only

State B:
UI page + auth scope + memory epoch + tool session

State C:
full history
```

畫面即時顯示 residual autocorrelation / conditional drift：

```text
                UI only   enriched   full-history
mean residual     .082      .011        .004
autocorr(1)       .31       .06         .02
CS violations      7         1           0

Markov sufficiency
                 FAIL      PLAUSIBLE    REFERENCE
```

## Panel B — Visit-gated transition martingale

```text
state = AUTHENTICATED
action = MCP_WRITE
next = SUCCESS

visit #     observed   expected   residual   log-wealth
1             1         .92        .08        .01
2             1         .92        .08        .02
3             0         .92       -.92        .31
4             0         .92       -.92        .68
5             0         .92       -.92       1.12 ⚠
```

UI 直接標示：

```text
GLOBAL STEP: 18,420
ROW VISITS: 5

不要誤讀 global runtime 為 evidence strength
```

## Panel C — Transition-first vs Bellman-first

```text
TRANSITION-FIRST
P(success|state,action)
[.41,.61]
→ reachability safety [.70,.84]

BELLMAN-FIRST
Bellman residual wealth = 8.2
→ candidate Q under pressure
```

## Panel D — Failure explanation

```text
Evidence alarm
    ↓
┌───────────────┬───────────────┐
│ Kernel drift  │ State aliasing│
│ likelihood .61│ likelihood .39│
└───────────────┴───────────────┘
```

這比單一 `model drift detected` 更適合 Hermes 的可視化研究目標。

---

# 6. Code / GitHub

## 6.1 FormalSLT

Repository：`Robby955/FormalSLT`

本輪不是只讀 README，實際追到：

```text
ARCHITECTURE.md
FormalSLT/
├ Probability/
├ Concentration/
├ AnytimeValid/
├ PACBayes/
└ StochasticDynamics/
    └ EmpiricalTransitionConfidence.lean
```

### 值得看的核心檔案

```text
FormalSLT/StochasticDynamics/EmpiricalTransitionConfidence.lean
```

重要 declarations：

```text
transitionCoordinateBoundary
transitionCoordinateRadius
empiricalCandidateRowTotalVariation
empiricalTransitionRowRadius
exists_empiricalTransitionCoordinate_event
exists_empiricalTransitionFrequency_event
exists_empiricalCandidateRowTotalVariation_event
```

其 architecture 還特別要求：

```text
#check
#print axioms
concrete witness
proof-debt / axiom audit
```

這種「theorem + checker + assumption provenance」模式很值得 Hermes Evidence Registry 借用。

---

## 6.2 建議 Hermes 新增程式模組

```text
src/research-evidence/
├ state/
│  ├ state-sufficiency-gate.ts
│  └ state-semantic-hash.ts
├ markov/
│  ├ transition-residual.ts
│  ├ visit-clock.ts
│  ├ transition-eprocess.ts
│  ├ likelihood-mixing.ts
│  └ kernel-ambiguity-set.ts
├ bellman/
│  ├ bellman-residual.ts
│  ├ nuisance-freeze.ts
│  └ bellman-martingale-contract.ts
├ certificates/
│  ├ markov-state-certificate.ts
│  ├ transition-evidence-certificate.ts
│  └ trajectory-permission-certificate.ts
└ visual/
   └ bellman-martingale-lab.ts
```

這是工程建議，不代表 repo 目前已有這些檔案。

---

# 7. Papers

## Paper A

**Confidence Sequences for Online Statistical Model Checking of Markov Decision Processes**  
Kueffner, Meggendorfer, Weininger, Wienhöft, 2026.  
https://arxiv.org/abs/2606.25797

**改變了什麼：**把 MDP transition uncertainty 從 repeated fixed-time CI 改成 time-uniform sequential inference，讓 online sample-infer-solve 不需每次重新支付 naïve union-bound 成本。

**需追引用：**是。本輪最值得追它對 betting Bernstein、transition coordinate clock、reset/simulation access assumptions 的細節與後續引用。

---

## Paper B

**Confidence Estimation via Sequential Likelihood Mixing**  
Johannes Kirschner, Andreas Krause, Michele Meziu, Mojmir Mutny, 2025.  
ETH Zurich / Swiss Data Science Center.  
https://arxiv.org/abs/2502.14689

**改變了什麼：**把 likelihood-ratio martingale + sequential mixing 變成一般 confidence compiler，可容納 adaptive covariates、approximate inference 與 non-IID conditional models。

**對 Hermes 意義：**非常適合 structured Tool/MCP transition model，而不只 tabular transition count。

---

## Paper C

**Fitted Occupancy-Ratio Evaluation without Bellman Completeness (FORE)**  
Lars van der Laan, Nathan Kallus, 2026.  
https://arxiv.org/abs/2607.05375

**改變了什麼：**以 adjoint Bellman recursion + KL projection 直接估 occupancy ratio，並提供 coverage-stopped conservative value lower bound。

**對本輪的定位：**它是 occupancy correction 強基線，但同時凸顯 `offline finite-sample estimate → e-process` 仍不是自動成立。

---

# 8. Unknown / Open Questions

## Open Question 1 — Bellman residual 到底在什麼最弱條件下能變成 practical e-process？

要精確區分：

```text
true Q fixed
estimated Q predictable
estimated Q cross-fitted
online-updated Q
model-based next-state expectation
sampled next-action Q
```

每一種都會改變 filtration / nuisance contract。

---

## Open Question 2 — 如何在線檢驗「state abstraction 不足」而不是把所有 residual drift 都歸因 kernel drift？

可能方向：

```text
conditional independence tests
history augmentation comparison
predictive likelihood gain
residual autocorrelation CS
state refinement competition
```

但目前 production-safe theorem 尚未建立。

---

## Open Question 3 — transition CS 如何與 occupancy / Bellman certificate 組合，而不重複計算或 double-count uncertainty？

候選 architecture：

```text
Transition CS
↓
Kernel ambiguity set
↓
robust Bellman operator
↓
value interval

vs.

Direct Bellman e-process
```

兩者可能共享同一批 observations；不能把兩個 confidence object 當獨立 evidence 隨意相乘。

---

# 9. 下一輪研究

下一輪應收斂到：

# **State Abstraction Validity × Predictive-State / Belief-State Construction × Residual Diagnostics × POMDP Sequential Evidence**

因為本輪已經確認：

```text
Bellman / transition martingale
```

最大的前置條件不是公式，而是：

```text
你到底有沒有一個合法 state？
```

研究鏈：

```text
Raw Agent History
↓
State Compression
├ memory summary
├ tool state
├ multimodal latent
└ belief state
↓
Markov Sufficiency Diagnostics
↓
Predictive State Representation / POMDP belief
↓
Sequential residual validity
↓
Transition/Bellman e-process
↓
Permission gate
```

並需研究：

- predictive state representations；
- belief-state filtering；
- state aliasing；
- bisimulation / representation equivalence；
- history-dependent policies；
- POMDP off-policy evaluation；
- hidden confounding in Agent-human-tool interaction。

---

# 10. Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Visit-Gated Transition Residual
Transition Martingale Difference
Transition Evidence Clock
State-Visit Intrinsic Time
State-Action Visit Clock
Markov State Sufficiency Certificate
State Aliasing
Kernel Drift
Conditional Markov Evidence Regime
History-Markov Evidence Regime
Mixing-Required Evidence Regime
Transition-First Certificate
Bellman-First Certificate
Transition Likelihood Mixing
Transition E-Process
Kernel Ambiguity Set
Bellman Residual
Bellman Martingale Contract Candidate
Nuisance Freeze Contract
Formal Theorem Provenance
Axiom Audit Status
Proof Checker Status
State Semantic Hash
```

## 新增 Edges

```text
Visit-Gated Transition Residual
→ conditional-mean-zero under Markov kernel

Conditional-Mean-Zero Residual
→ martingale / betting candidate

Transition E-Process
→ transition confidence sequence

Transition Confidence Sequence
→ kernel ambiguity set

Kernel Ambiguity Set
→ robust Bellman solve

State Aliasing
→ breaks transition residual centering

State Aliasing
→ can imitate kernel drift

Likelihood Mixing
→ anytime confidence set under conditional model

Formal Theorem Artifact
→ strengthens evidence provenance
```

## 新增否定 Edges

```text
Observed UI State
≠ Markov State

Dependent Data
≠ Mixing Correction Required First

Long Runtime
≠ Strong Evidence For Rare State

Small Bellman Residual
≠ Martingale Validity

Occupancy-Ratio Estimate
≠ E-Process

Transition Confidence
≠ Bellman Confidence

Kernel Drift Alarm
≠ Kernel Drift Proven

State Compression
≠ State Sufficiency

Formalized Theorem
≠ Production Assumptions Automatically Satisfied
```

---

# 11. 每輪結束固定回答

**缺哪一層？**  
目前最缺的是 `Markov State / Belief State Validity Layer`。沒有這層，transition residual 與 Bellman residual 的 conditional-mean contract 都可能從根部失效。

**哪個節點最淺？**  
`BellmanMartingaleContractCandidate`、`MarkovStateSufficiencyCertificate`、`NuisanceFreezeContract`。

**哪個概念仍只是名詞？**  
完整 production 級 `Trajectory E-Process` 仍不能宣稱已解；目前只能拆出可驗證子問題。

**哪個系統值得讀原始碼？**  
`Robby955/FormalSLT`，尤其 `FormalSLT/StochasticDynamics/EmpiricalTransitionConfidence.lean`，因為它把 transition coordinate、time-uniform boundary、row normalization 與 theorem audit 實際落到 code/theorem artifact。

**哪篇論文需追引用？**  
Kueffner et al. 2026，`Confidence Sequences for Online Statistical Model Checking of Markov Decision Processes`。

**哪個概念最適合視覺模擬？**  
`Bellman Martingale × State Sufficiency Lab`：同一批 trajectory 換不同 state representation，直接看 residual 是否還像 martingale。

**哪個 Agent 架構最值得實作？**  
`Markov-State Sufficiency Gate → Transition Evidence Router → Kernel Ambiguity Set → Permission Gate`。這比直接做未成熟的 Bellman e-process 更穩健，也能立刻服務 Tool/MCP 高風險 action。

---

# 12. 對「AI 到底怎麼運作」新增的一層

這輪把 Agent 的世界模型再往下拆了一層：

```text
使用者一句話
↓
UI / Context
↓
Agent 建立 state
↓
Planner 選 action
↓
Tool / MCP / Model action
↓
世界產生 next state
↓
Agent 觀察 transition
↓
transition residual
↓
sequential evidence
↓
更新 world-model / permission
↓
下一個 action
```

真正的關鍵不是「Agent 有沒有 state variable」，而是：

> **這個 state 是否真的把對未來有用的歷史資訊保留下來，使下一個 observation 的 conditional law 可以只靠 current state/action 表示。**

若可以，MDP martingale machinery 才有機會成立；若不可以，就必須升級成 history state、belief state 或 POMDP representation。這也是從「Agent 看起來像有記憶」走向「Agent 的 sequential evidence 在數學上真的合法」的分界。