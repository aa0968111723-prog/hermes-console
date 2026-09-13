# 【AI Agent × Multimodal Research Report】

**時間：2026-09-13 08:50（Asia/Taipei）**  
**本輪主題：Append-Only Multiplicity Ledger × Tainted-Wealth Propagation × Dependency-Guided Rollback × Selective Replay × Certificate Causality**

> 歷史比較：上一輪已建立 `DynamicHypothesisRegistry`、online FDR wealth、certificate reversal / invalidation 的區分，但留下未解問題：若一個早期 rejection 後來因 verifier bug / schema bug / future leakage 被「語意失效」，先前 rejection 所增加的 alpha wealth 已影響後續 `alpha_t`，後續 discoveries 是否也被污染？本輪不再重做 LORD/SAFFRON 基礎，而是研究 **retroactive invalidation 如何沿依賴圖傳播、如何保留歷史事實、如何 selective replay、以及哪些 guarantee 目前仍只有工程提案而沒有現成統計定理。**

---

## 一、本小時新發現

### 新論文 / 新架構

1. **From Faulty Memories to Corrected Actions: Dependency-Guided Rollback Repair for Memory-Augmented Agents**  
   Authors: Caili Yu, Yiqi Wang, Jiaqi Zhang, Yiqun Duan, Mingkai Zheng, Zhangkai Wu, Kaize Shi, Taotao Cai  
   Year: 2026  
   URL: https://arxiv.org/abs/2608.10502  
   Institution: 本輪可取得的 arXiv metadata 未直接暴露 affiliations；不要猜測。  
   Dataset / Evaluation: 150-case controlled benchmark（3 tool-use domains × 4 memory failure types）+ 50-case trajectory-derived stress test adapted from LongMemEval-V2。  
   Architecture: typed memory→claim→plan/action dependency graph；從 runtime provenance 建邊；診斷 faulty memory 後，沿 downstream dependencies 找受影響節點；保留具有 independent trusted support 的節點；只 selective replay answer-relevant affected computation。  
   Contribution: 把「刪除壞記憶」提升為「修復持久狀態 + 修復已被污染的下游行為」。  
   Results: controlled benchmark recovery 85.3% vs 77.3% best competing recovery；adapted subset 68.0% vs 54.0%；claim invalidation F1 0.669 vs 0.603。  
   Limitation: 這是 memory/action repair，不是 online-FDR alpha-wealth 的 formal rollback theorem；本輪只把其 dependency-guided recovery 原理移植到 statistical evidence runtime。

2. **MAP-Graph: Provenance-Aware Shared Memory for Multi-Agent Workflows**  
   Authors: Yiqi Wang, Zihao Yan, Jiaqi Zhang, Zhangkai Wu, Mingkai Zheng, Zequn Sun, Yanming Zhu, Taotao Cai  
   Year: 2026  
   URL: https://arxiv.org/abs/2608.10509  
   Institution: 本輪 arXiv metadata 未直接暴露 affiliations；不猜測。  
   Architecture: typed graph over agents / sources / memories / claims / actions；ancestry tracing；hard permission filter；semantic similarity + multiplicative path trust reranking；risk-sensitive action gate。  
   Dataset: controlled benchmark 2,700 synthetic tasks per method across 3 domains。  
   Contribution: provenance 不只是 audit metadata，而是 action-time control signal。  
   Limitation: 研究 provenance/trust propagation，不直接解決 multiplicity wealth 的 retroactive contamination。

3. **Feedback-Enhanced Online Multiple Testing with Applications to Conformal Selection (GAIF)**  
   Authors: Lin Lu, Yuyang Huo, Haojie Ren, Zhaojun Wang, Changliang Zou  
   Year: 2026, JMLR 27(186)  
   URL: https://www.jmlr.org/papers/v27/25-2123.html  
   Contribution: decision 後可收到 instant/delayed、full/bandit truth feedback，future thresholds 可依 feedback 調整，仍提供 finite-sample FDR/mFDR guarantees。  
   Limitation: feedback-aware 不等於「允許把一個原本合法的 historical rejection retroactively 改成從未發生」；因此不能直接拿 GAIF 當 tainted-wealth rollback theorem。

4. **e-GAI: e-value-based Generalized alpha-Investing for Online FDR Control**  
   Authors: Yifan Zhang, Zijian Wei, Haojie Ren, Changliang Zou  
   Year: 2025, ICML  
   URL: https://proceedings.mlr.press/v267/zhang25cd.html  
   Architecture: 用 valid e-values 驅動 generalized alpha-investing，提出 e-LORD / e-SAFFRON，在更一般 dependence regime 下動態配置 testing levels，並研究 alpha-death。  
   重要性：Hermes 可以把 verifier evidence 逐步移到 e-value regime，降低依賴假設脆弱度；但 retroactive semantic invalidation 仍需額外 provenance/replay 層。

### 新工程架構 / GitHub 原始碼

5. **OliverHennhoefer/online-fdr — `online_fdr/p_values/investing/lord/plus_plus.py`**  
   URL: https://github.com/OliverHennhoefer/online-fdr  
   核心檔案：`online_fdr/p_values/investing/lord/plus_plus.py`。  
   原始碼確認 `alpha_t` 顯式依賴 `first_reject` 與 `last_reject`：

```text
alpha_t = wealth0 * gamma(t)
+ contribution(first rejection)
+ Σ contribution(previous rejection)

wealth -= alpha_t
if rejected:
  wealth += reward
  record rejection index
```

這表示一個 rejection 不只是「一張 certificate」，而是 **未來所有 alpha allocation 的 parent state**。若 rejection 因 validity bug 被 invalidated，不能只改 UI status；至少要把所有依賴它的後續 testing-state 標成可能污染。

---

## 二、本小時最重要 5 個發現

### 發現 1：Certificate invalidation 與 wealth contamination 是兩個不同問題

`H_7` 被判定 verifier bug：

```text
H7 rejection
↓
reward +R
↓
alpha_8 ↑
alpha_9 ↑
...
↓
H12 rejected
```

即使把 `H7.status = INVALIDATED`，`H12` 的 testing threshold 已經在歷史上受到 `H7` 影響。

所以新增：

```text
WealthContamination
├ source_certificate_id
├ source_rejection_event_id
├ contaminated_wealth_delta
├ affected_test_events
├ affected_certificates
├ first_affected_time
├ last_affected_time
└ repair_status
```

**已確認事實：** LORD++ code 中 future alpha_t 依 prior rejection indices。  
**合理工程推論：** retroactive semantic invalidation 需要 propagation；只改 certificate 狀態不足。  
**尚未驗證假說：** 可以對任意 online-FDR procedure 做局部 subtraction 並保持原保證。不能宣稱成立。

### 發現 2：不要「刪除歷史 rejection」；應 append invalidation event

本輪採用 event-sourcing 原則：past runtime event 是「當時系統真的做過什麼」；若後來發現錯誤，應追加 correction / invalidation event，而非偷偷 mutate 歷史。

```text
REJECTION_RECORDED(H7, alpha=.004)
WEALTH_REWARD_GRANTED(H7, +.05)
...
VERIFIER_BUG_DISCOVERED(v3)
CERTIFICATE_INVALIDATED(H7)
WEALTH_TAINT_DECLARED(source=H7)
```

因此 Hermes 應建立：

```text
AppendOnlyMultiplicityLedger
├ event_id
├ logical_time
├ wall_time
├ event_type
├ hypothesis_id
├ certificate_id
├ family_id
├ alpha_before
├ alpha_spent
├ reward_granted
├ wealth_after
├ verifier_version
├ validity_contract_hash
├ parent_event_ids[]
└ supersedes_event_id?
```

重要否定關係：

```text
Historical Event Invalidated
≠
Historical Event Never Happened
```

### 發現 3：最佳 repair 單位不是整條 timeline，而是「受污染的依賴 closure」

2026 DGRR 的核心直接支持 selective repair：faulty memory 之後，不應 full reset，也不應只刪 source；應沿 provenance graph 找 downstream affected nodes，保留有 independent trusted support 的節點，再 selective replay。

Hermes 映射：

```text
Invalidated verifier output
↓
Certificate dependency graph
↓
Affected closure
├ alpha allocation descendants
├ rejection descendants
├ planner certificates
├ action gates
├ memory writes
└ tool / MCP actions
↓
Independent-support test
↓
KEEP / QUARANTINE / REPLAY / COMPENSATE
```

Bottom-level traversal：

```text
queue = [invalidated_event]
while queue:
  u = pop()
  for v in outgoing_dependencies(u):
    if v has valid independent support:
       preserve(v)
    else:
       mark_tainted(v)
       queue.push(v)
```

這比「從 H7 之後所有東西全部重跑」更接近 Agent 長任務 runtime。

### 發現 4：需要分成 Counterfactual Replay 與 Operational Compensation

過去如果已經執行：

```text
MCP_WRITE
email sent
GitHub commit
payment
external API mutation
```

replay 不可能讓真實世界回到未執行狀態。

因此 repair 必須分：

```text
A. Statistical Replay
   重新計算：若 H7 當時不存在，後續 alpha_t / reject set 會是什麼？

B. State Replay
   重建 Hermes internal projections / certificates / knowledge graph。

C. Operational Compensation
   對不可逆外部 action 建 compensating action / human review。
```

新增：

```text
ActionRepairClass
├ REPLAYABLE_INTERNAL
├ COMPENSATABLE_EXTERNAL
├ IRREVERSIBLE_EXTERNAL
└ HUMAN_ADJUDICATION_REQUIRED
```

### 發現 5：Tainted wealth 目前應採「quarantine + shadow replay」，不能假裝已有正式 rollback guarantee

本輪沒有找到成熟 online-FDR 理論直接保證：

> 一個 rejection 已經賺取 wealth 並影響很多 future thresholds 後，若因 software semantic bug 被 retroactively invalidated，可以局部扣回 reward、保留其餘 rejection，且仍沿用原 FDR theorem。

所以 production-safe engineering 應是：

```text
Invalidation detected
↓
Freeze affected family wealth for new high-risk decisions
↓
Fork SHADOW_REPLAY epoch
↓
Replay event stream using corrected validity facts
↓
Compare:
  historical wealth
  corrected wealth
  historical reject set
  corrected reject set
↓
classify descendants
↓
start new forward-safe epoch
```

不能直接：

```text
wealth -= old_reward
continue as if nothing happened
```

新的狀態：

```text
WealthStatus
├ CLEAN
├ SUSPECTED_TAINT
├ CONFIRMED_TAINT
├ QUARANTINED
├ REPLAYING
├ REPAIRED_FORWARD
└ HISTORICAL_ONLY
```

---

## 三、Architecture Breakdown

```text
Verifier / Model / Tool Evidence
↓
Dynamic Hypothesis Registry
↓
Online Testing Engine
↓
Append-Only Multiplicity Ledger
↓
Certificate / Wealth / Decision Projection
↓
Agent Planner Gate
↓
Tool / MCP / Memory / External Action

           ↓ later bug / revocation / data correction

Invalidation Event
↓
Validity-Causality Graph
↓
Taint Propagation Engine
├ certificate descendants
├ wealth descendants
├ planner descendants
├ memory descendants
└ external action descendants
↓
Independent-Support Analyzer
↓
Selective Replay Planner
├ shadow statistical replay
├ state projection rebuild
└ compensating-action planner
↓
Repaired Evidence Epoch
↓
Forward-Safe Planner Gate
```

### Runtime object model

```text
EvidenceEvent
HypothesisEvent
TestingDecisionEvent
WealthEvent
CertificateEvent
PlannerDecisionEvent
ActionEvent
InvalidationEvent
CompensationEvent
```

每個 derived object 必須保存：

```text
parents[]
validity_contract_hash
code_version
model_version
evidence_epoch
replay_key
```

---

## 四、Bottom-Level Logic

### 1. LORD++ dependency mechanism

從實際 `plus_plus.py` 可確認：

```text
alpha_t = f(
  t,
  first_reject,
  all later rejection indices,
  current wealth
)
```

所以對 rejection `r_j` 定義：

```text
Descendants(r_j)
=
{ testing event t : alpha_t depends on r_j }
```

這不是一般 provenance edge，而是會改變 future rejection probability 的 **testing-policy causal edge**。

### 2. Counterfactual corrected ledger

歷史 ledger：

```text
L = e1, e2, ..., en
```

發現 `e_k` validity 無效後，不 mutate `L`，而建立 correction set `C`，再：

```text
Replay(L, C, procedure_version)
→ corrected projection P*
```

比較：

```text
Δwealth_t = wealth_historical_t - wealth_corrected_t
Δreject_t = reject_historical_t XOR reject_corrected_t
```

若 `Δreject_t = true`：

```text
certificate_t → TAINTED_DESCENDANT
```

### 3. Independent-support preservation

若一張 planner certificate 同時由：

```text
H7 verifier
H9 independent verifier
Human approval
```

支持，H7 invalidation 不應自動刪除整張 certificate。需要 typed support semantics：

```text
ANY_OF parents
ALL_OF parents
K_OF_N parents
WEIGHTED parents
HARD_GATE parent
```

這是 selective replay 能否避免過度回滾的核心。

---

## 五、Visual Simulation Idea

# Tainted Wealth × Dependency Replay Observatory

### Panel A — Wealth Timeline

```text
H1  H2  H3  H4  H5  H6  H7  H8  H9 ...
                     ↑
                INVALIDATED

Historical wealth:  .031 ── .078 ── .061 ── .104
Corrected replay:   .031 ── .028 ── .019 ── .037
                           ↑ divergence starts
```

### Panel B — Contamination Graph

```text
Verifier v3 bug
   ↓
H7 reject
   ↓ reward
WealthEvent#88
 ↙      ↓       ↘
α8     α9      α10
        ↓
      H9 reject
        ↓
 PlannerCert#17
      ↙      ↘
 Memory#42   MCP_WRITE#9
```

節點顏色分：clean / tainted / independently-supported / replayed / irreversible。

### Panel C — Replay Diff

```text
              Historical   Corrected
H8 alpha        .0091       .0042
H8 reject       YES         NO
H9 alpha        .0120       .0045
H9 reject       YES         NO
Planner ACT     WRITE       ASK_USER
```

### Panel D — Repair policy

```text
Internal certificate  → replay
Memory write          → invalidate + regenerate
MCP read              → replay optional
MCP write             → compensating action
Email sent            → human adjudication
```

使用者可以直接看懂：**一個早期 verifier bug 如何穿過統計 wealth、Agent decision、Memory、Tool/MCP 一路污染到外部世界。**

---

## 六、Code / GitHub

### `OliverHennhoefer/online-fdr`
值得看的核心：

```text
online_fdr/
├ core/
├ p_values/
│  └ investing/
│     └ lord/
│        └ plus_plus.py
├ e_values/
└ p_values/async_methods/
```

本輪實際確認的 `plus_plus.py`：
- `first_reject`
- `last_reject`
- `wealth`
- `reward`
- `test_one()`

都是未來 testing state 的直接 state variables。

**工程缺口：**目前該 implementation 是 forward sequential state machine；未看到原生 retroactive invalidation / event replay / taint propagation abstraction。Hermes 不應 patch 它本身，而應在外層加 append-only ledger + deterministic projector。

### 建議 Hermes 新增模組

```text
src/evidence_runtime/
├ ledger/
│  ├ event_store.*
│  ├ projector.*
│  └ snapshot.*
├ provenance/
│  ├ dependency_graph.*
│  └ support_semantics.*
├ invalidation/
│  ├ taint_propagator.*
│  ├ replay_planner.*
│  └ compensation_planner.*
└ multiplicity/
   ├ procedure_adapter.*
   ├ shadow_replay.*
   └ wealth_diff.*
```

---

## 七、Papers

### Paper A
**From Faulty Memories to Corrected Actions: Dependency-Guided Rollback Repair for Memory-Augmented Agents**  
Authors: Caili Yu et al.  
Year: 2026  
URL: https://arxiv.org/abs/2608.10502  
Code: 本輪公開檢索未確認正式 code repository；CatalyzeX 顯示 Request Code。  
Dataset: 150 controlled cases + 50 LongMemEval-V2-derived stress cases。  
Architecture: typed provenance dependency graph + selective downstream invalidation/replay。  
改變了什麼：把 Agent memory correction 從 source deletion 提升為 provenance-aware state recovery。  
限制：不處理 online multiplicity theorem。

### Paper B
**MAP-Graph: Provenance-Aware Shared Memory for Multi-Agent Workflows**  
Authors: Yiqi Wang et al.  
Year: 2026  
URL: https://arxiv.org/abs/2608.10509  
Dataset: 2,700 synthetic tasks per method / 3 domains。  
Architecture: typed execution graph + ancestry eligibility + path trust + risk-sensitive gate。  
改變了什麼：provenance 從 audit-only 變成 retrieval/action-time control。  
限制：trust / permission lineage 不是 alpha-wealth rollback。

### Paper C
**Feedback-Enhanced Online Multiple Testing with Applications to Conformal Selection**  
Authors: Lin Lu et al.  
Year: 2026  
URL: https://www.jmlr.org/papers/v27/25-2123.html  
Architecture: GAIF with delayed/full/bandit feedback。  
改變了什麼：future online thresholds 可利用事後 truth feedback。  
限制：不能被誤讀成 retroactive rewrite of historical testing state。

### Paper D
**e-GAI: e-value-based Generalized alpha-Investing for Online FDR Control**  
Authors: Yifan Zhang, Zijian Wei, Haojie Ren, Changliang Zou  
Year: 2025  
URL: https://proceedings.mlr.press/v267/zhang25cd.html  
Architecture: e-LORD / e-SAFFRON, e-value wealth allocation。  
改變了什麼：讓 online FDR 在更一般 dependence 條件下使用 e-values 並提升 power。  
限制：沒有解 verifier software bug 導致的 historical invalidation。

---

## 八、Unknown / Open Questions

1. **Retroactive wealth theorem**：若 historical rejection 因 semantic/implementation bug invalidated，是否存在一般化的 online-FDR repair operator，可局部重算且對未來仍保留 finite-sample FDR guarantee？目前未找到成熟通用結果。
2. **Partial replay boundary**：若 contaminated certificate 有多個 independent support，什麼 support algebra 足以證明「不用 replay」？需要把 ANY/ALL/K-of-N 與統計 dependence 一起形式化。
3. **Irreversible action semantics**：external action 已發生時，統計 certificate 可 repair，但世界狀態不能 rollback；Planner 如何把 compensating action 的風險納入 replay optimization？

---

## 九、下一輪研究

下一輪優先：

# Replay Validity × Counterfactual Multiplicity Reconstruction × Provenance Compression × Irreversible Action Compensation

研究鏈：

```text
Append-only ledger
↓
Deterministic projector
↓
Historical procedure replay
↓
Counterfactual corrected wealth
↓
Rejection-set diff
↓
Dependency closure compression
↓
Replay cost / action-risk optimization
↓
Compensation policy
↓
Forward-safe epoch handoff
```

特別要追：
- online testing procedure 是否能 deterministic replay；
- procedure-version / gamma-sequence version 是否必須被 hash-pin；
- historical p/e-values 若被 corrected，哪些可 replay、哪些必須 quarantine；
- Replay 後如何對「當時合法、今天被 supersede」和「當時就因 bug 無效」做不同 audit classification。

---

## 十、Knowledge Graph 新增 Node / Edge

### Nodes

```text
Append-Only Multiplicity Ledger
Multiplicity Event
Wealth Reward Event
Wealth Taint
Tainted Wealth Source
Taint Propagation
Validity-Causality Graph
Testing-Policy Causal Edge
Counterfactual Wealth Replay
Shadow Replay Epoch
Historical Testing Projection
Corrected Testing Projection
Rejection-Set Diff
Independent Support
Support Algebra
Selective Statistical Replay
State Projection Replay
Operational Compensation
Irreversible Action Descendant
Replay Boundary
Replay Cost
Forward-Safe Wealth Epoch
```

### Edges

```text
Prior Rejection
→ INFLUENCES_FUTURE_ALPHA
→ Future Testing Decision

Invalidated Certificate
→ TAINTS
→ Wealth Reward

Tainted Wealth Reward
→ MAY_TAINT
→ Descendant Rejection

Invalidation Event
→ DOES_NOT_DELETE
→ Historical Event

Dependency-Guided Repair
→ PRESERVES
→ Independently Supported Descendant

Corrected Replay
→ SUPERSEDES_PROJECTION_OF
→ Historical Testing State
```

### 否定關係

```text
Certificate Invalidated
≠ Historical Event Never Happened

Delayed Feedback
≠ Retroactive Wealth Rewrite

Removing Bad Source
≠ Removing Downstream Influence

Subtracting Old Reward
≠ Proven FDR Repair

Full Replay
≠ Necessary Repair

Selective Replay
≠ Automatically Statistically Valid

Internal State Rollback
≠ External World Rollback

Historical Decision Valid Then
≠ Trusted Now

Verifier Bug
≠ Statistical Reversal
```

---

## 本輪結束判定

- **缺哪一層：** formal `Retroactive Multiplicity Repair`；現在只有 forward online-FDR + provenance/selective-repair 兩套理論，尚未完全接起來。
- **哪個節點最淺：** `WealthTaintPropagation`、`ForwardSafeWealthEpoch`、`SupportAlgebra`。
- **哪個概念仍只是名詞 / 工程假說：** 「局部扣回 alpha reward 後繼續原 procedure 仍保持 FDR」——目前不能這樣宣稱。
- **哪個系統值得讀原始碼：** `OliverHennhoefer/online-fdr` 的 state / LORD / SAFFRON / ADDIS，以及下一輪應找有 event replay / persisted test-state 的 sequential testing implementation。
- **哪篇論文需追引用：** `From Faulty Memories to Corrected Actions`，因它首次把 agent persistent-state fault repair 系統化成 dependency-guided selective replay，與 Hermes 的 tainted certificate/wealth 問題高度同構。
- **哪個概念最適合視覺模擬：** `Tainted Wealth × Dependency Replay Observatory`。
- **哪個 Agent 架構最值得實作：** **Event-Sourced Evidence Runtime + Dependency-Guided Repair Agent**。

## 最終還原中的新增一層

完整鏈路現在不只：

```text
User
→ UI
→ Agent
→ Context
→ Reasoning
→ Planner
→ Memory / Tools / MCP
→ Model / GPU
→ Output / Action
```

還必須有：

```text
每個 observation / verifier / tool result
→ evidence event
→ hypothesis decision
→ multiplicity wealth
→ certificate
→ planner action
→ persistent memory / external action

若日後發現 upstream evidence 有 bug：
→ append invalidation
→ trace descendants
→ quarantine tainted wealth
→ selective counterfactual replay
→ rebuild certificates
→ compensate irreversible actions
→ start forward-safe evidence epoch
```

**核心答案：AI 不只需要知道「現在相信什麼」，還必須保存「為什麼當時會相信、那個 belief 如何改變未來測試門檻與行動、以及上游證據後來失效時，哪些下游結果其實仍可保留、哪些必須重算、哪些外部行動只能補償而不能回滾」。這是長期 Agent 從 reasoning system 走向可修復 runtime 的必要底層。**
