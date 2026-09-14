# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-14 17:53（Asia/Taipei）

## 本小時研究主題
**Semantic Replay Equivalence × Minimal Sufficient Trace × Dynamic Program Slicing × Causal Responsibility**

本輪承接上一輪 `Replay Sufficiency × Hidden Nondeterminism × Deterministic State Fold × Snapshot/Event Compaction × Cross-Version Replay`，不再重複「history 是否足夠重播」；這輪往下一個問題深入：

> 如果一次 Agent run 有 500 個事件，最終答案錯了，真的需要拿 500 個事件全部 replay 嗎？
> 哪些事件只是一起發生，哪些事件真正影響了結果？
> 一個 trace slice 只是 dependency-reachable，還是能證明它對 outcome 有 causal responsibility？
> 「刪掉其他事件仍得到相同 output」到底應比較 byte equality、semantic outcome、permission decision，還是 verifier result？

本輪核心結論：

```text
Dependency
≠
Relevance
≠
Causal Responsibility
≠
Minimal Sufficient Trace
```

Hermes 下一階段不能只建立完整 provenance graph，還需要建立 **query-relative trace reduction + intervention validation**。

---

# 本小時新發現

## 新論文 / 新架構 / 新 GitHub / 新方法

### 1. CausalFlow: Causal Attribution and Counterfactual Repair for LLM Agent Failures
- Authors: Akash Bonagiri, Devang Borkar, Gerard Janno Anderias, Setareh Rafatirad, Houman Homayoun
- Year: 2026
- URL: https://arxiv.org/abs/2605.25338
- Architecture: structured trace → candidate step intervention → downstream re-execution → Causal Responsibility Score (CRS) → minimal repair → validation
- Benchmarks: GSM8K, MBPP, SealQA Hard, MedBrowseComp，超過 3,000 tasks
- Contribution: 把 agent failure attribution 從「看 log 猜哪裡錯」提升成「替換某一步後重新執行 descendants，看 final verifier 是否翻轉」。
- Reported result: aggregate 將 555/1299 failed traces（42.7%）轉成 validated minimal repairs。
- Limitation: paper 將 execution dependency 主要建成 sequential chain；對真正 concurrent event DAG、hidden side effect、不可 replay external action，仍不足。

### 2. CausalRepair: Bridging the Causality Gap in LLM-based Automated Program Repair via Dual-Slicing
- Authors: Linhao Wu, Yizhou Chen, Zhen Yang, Pengyu Xue, Dan Hao
- Institutions: Peking University / Shandong University
- Year: 2026
- URL: https://arxiv.org/abs/2608.10613
- Dataset: Defects4J V1.2、V2.0、Defects4J-Trans
- Architecture: context-aware static slice + execution-trace dynamic slice → minimal causal context → iterative LLM repair
- Contribution: 明確提出 **minimal causal context**，以 static test semantics + dynamic runtime dependency 的 dual slicing 移除不相關 context。
- Reported result: 313 Defects4J bugs correctly fixed；報告平均 repair cost 約 US$0.029/bug。
- Limitation: 主要針對 deterministic program repair；不能直接假設自然語言 reasoning、retrieval、memory、browser observation 都有傳統 source-level def-use semantics。

### 3. AgentTrace: Causal Graph Tracing for Root Cause Analysis in Deployed Multi-Agent Systems
- Author: Zhaohui Geoffrey Wang
- Year: 2026，ICLR AIWILD Workshop
- URL: https://arxiv.org/abs/2603.14688
- Architecture: execution logs → causal graph reconstruction → backward fault traversal → structural/positional ranking → root cause candidates
- Contribution: 顯示 agent debugging 可以在 post-hoc trace graph 上做 causal-style backward localization，不一定每次都用 LLM 讀全部 raw logs。
- Limitation: public project page宣稱有 GitHub source link，但目前該 linked repository URL 回傳 404；因此本輪不把其 implementation claims 當作已讀 source code，只採 paper / project page 已公開的方法與結果。

### 4. A Survey for LLM Agent Trajectory Analysis: From Failure Attribution to Enhancement
- Authors: Junjie Wang et al.
- Year: 2026，IEEE Transactions on Software Engineering（accepted/in press）
- DOI: https://doi.org/10.1109/TSE.2026.3717765
- Scope: 55 papers（early 2025–April 2026）
- Key finding: trajectory analysis 已從 prompting 移向 causal inference、tracer model、dynamic intervention，但 **step-level attribution accuracy 仍有限**，benchmark diversity 也不足。
- Change: 這直接支持 Hermes 不該把「有 trace」誤認成「已能解釋 trace」。

### 5. Dynamic Program Slicing / Backward Slice as bottom-level mechanism
Foundational line:
- Korel & Laski, *Dynamic Program Slicing*, 1988
- Agrawal & Horgan, *Dynamic Program Slicing*, 1990
- modern implementation reference: `angr/angr`

GitHub:
https://github.com/angr/angr/blob/master/angr/analyses/backward_slice.py

本輪實際讀 source，不只 README。`BackwardSlice` 需要 CFG + CDG + DDG；target 可以是 `(CFGNode, stmt_idx)` / `CodeLocation`。default construction 從 target taint 起點反向走 data dependencies，再加入 control dependencies，最後 map 回 CFG。

值得看的核心檔案：
```text
angr/analyses/backward_slice.py
angr/analyses/cdg.py
angr/analyses/ddg.py
angr/analyses/cfg/
docs/analyses/backward_slice.rst
tests/analyses/test_slicing.py
```

重要工程限制：目前 `backward_slice.py` 自身含 FIXME，指出既有 BackwardSlice 與 engines refactoring 不相容、等待 DDG refactoring；因此這是一個很好的「機制參考」，但不能把它描述成 production-ready Agent slicing engine。

---

# 本小時最重要 5 個發現

## 1. Backward reachable 不等於 causally responsible

### 概念
假設 final wrong answer `Y` 的 provenance ancestors 是：

```text
UserInput
├ PromptBuild
├ MemoryRead
├ WebSearch
│  ├ PageA
│  └ PageB
├ ToolCall
├ SafetyCheck
└ FinalAnswer Y
```

Backward traversal 可能把所有 ancestor 都納入：

```text
Ancestor(Y) = {A,B,C,D,E,...}
```

但：

```text
A ∈ Ancestor(Y)
```

只代表存在 recorded dependency path，並不代表：

```text
do(A ← A')
→ Y changes
```

### Bottom-level
應分 3 階段：

```text
Outcome Query
↓
Structural Backward Slice
↓
Candidate Relevant Events
↓
Counterfactual Intervention
↓
Outcome Equivalence Test
↓
Causal Responsibility
```

CausalFlow 就是在第二與第三層之間補上 intervention：step replacement 後只 re-execute downstream affected descendants，再看 verifier 是否由 fail 翻成 pass。

### 為什麼重要
如果 Hermes 只做 DAG backward traversal，它會產生大量「可能影響」的 event；對長 research / browser / multi-agent runs 很快又回到 trace overload。

### 限制
Counterfactual replay 本身需要可替換 intervention、可重播 descendants，以及穩定 verifier；對 irreversible side effects 或 human responses 不能直接重執行。

### 狀態
- 論文結果：CausalFlow 有直接 intervention empirical evidence。
- 工程推論：Hermes 應先 slice 再 intervention，可大量降低 replay budget。
- 尚未驗證：在 Hermes 真實 trace 上可以下降多少 replay calls。

---

## 2. Minimal trace 必須是「相對於 query / observable」的，不存在單一全域最小 trace

錯誤問題：

```text
What is THE minimal trace?
```

更正：

```text
Minimal trace
relative to
(query, observable, equivalence relation)
```

例如同一 run：

```text
Q1: 為什麼 final text 是這一句？
Q2: 為什麼 Permission Gate 擋住 tool write？
Q3: 為什麼 latency > 20s？
Q4: 哪個 source 支撐 claim C？
```

會得到完全不同 slice。

因此新增：

```text
TraceSliceCriterion
├ target_event_id
├ target_field / observable
├ semantic_query
├ equivalence_relation
├ side_effect_scope
├ time_horizon
└ policy_version
```

### 重要 edge

```text
Minimal For Final Text
≠
Minimal For Safety Decision
≠
Minimal For Causal Explanation
```

這與 program slicing 的 slicing criterion 一致：slice 永遠是針對特定 program point / variable / execution；不是「整個 program 的唯一最小 subset」。

而動態 slicing 的 theoretical literature 甚至指出 minimal dynamic slices 不一定唯一。

---

## 3. Semantic replay equivalence 必須正式定義，byte equality 太強，pass/fail equality 又可能太弱

上一輪已建立 cross-version replay，但還缺：

```text
replay_equivalent(original, replay) = ?
```

建議 Hermes 分層：

```text
E0 BYTE_EQUIVALENT
E1 EVENT_SHAPE_EQUIVALENT
E2 STATE_EQUIVALENT
E3 ACTION_EQUIVALENT
E4 PERMISSION_EQUIVALENT
E5 CLAIM/EVIDENCE_EQUIVALENT
E6 TASK_OUTCOME_EQUIVALENT
```

例如：

Original:
```text
「台北今天可能下雨，建議帶傘。」
```

Replay:
```text
「今日台北有降雨機率，外出可帶傘。」
```

byte 不同，但若研究問題只是「weather recommendation 是否一致」，可以是 `TASK_OUTCOME_EQUIVALENT`。

反過來：

Original:
```text
ToolCall(send_email, recipient=A)
```

Replay:
```text
ToolCall(send_email, recipient=B)
```

最後 UI 可能都顯示 `Sent`，但 action semantics 完全不等價。

因此新增：

```text
SemanticReplayEquivalenceContract
├ level
├ observable_projection
├ normalizer_version
├ verifier
├ tolerances
├ protected_fields[]
└ side_effect_equivalence
```

### 核心 edge

```text
Same Final Verifier Result
≠
Same Agent Behavior
```

以及：

```text
Semantic Equivalence
≠
Interchangeability For Every Query
```

---

## 4. Dynamic slicing 可做 cheap candidate reduction，但 intervention 才能升級成 causal responsibility

本輪實際讀 `angr/angr/analyses/backward_slice.py`。

其核心 `_construct_default()`：

```text
Targets
↓
Initial taints
↓
while taints:
    pop tainted CodeLocation
    pick statement
    query DDG predecessors
    add data dependencies
    query CDG guardians
    add control dependencies
↓
map taint graph to CFG
```

也就是：

```text
Target
← Data Dependence
← Control Dependence
← Transitive predecessors
```

這給 Hermes 一個非常具體的對應：

```text
Program DDG
→ Agent State/Data Dependency Graph

Program CDG
→ Agent Decision/Control Dependency Graph

CodeLocation
→ EventFieldLocation
```

Agent event field 甚至應到 field-level：

```text
ToolResponse#18.body.title
MemoryWrite#22.value
Planner#31.selected_tool
FinalAnswer#44.claim[2]
```

而不是 node-level 只有：

```text
ToolResponse#18
```

否則一個 100KB tool response 只因某 12-byte field 被使用，就整包被 slice 進來。

### 新 runtime primitive

```text
EventFieldDependency
├ source_event
├ source_field
├ target_event
├ target_field
├ dependency_type
└ derivation_id
```

---

## 5. Causal responsibility 不是單純「刪掉事件看會不會失敗」；需要 contingency / repair semantics

Actual causality literature（Halpern–Pearl）指出 causal attribution 不是只有 naive but-for test；某些事件在冗餘、備援或多原因情況下，需要考慮 structural model 與 contingency。

Agent example：

```text
SearchA ──→ evidence X ─┐
                        ├→ Final Correct
SearchB ──→ evidence X ─┘
```

移除 SearchA：仍 correct。
移除 SearchB：仍 correct。

naive deletion 會說：

```text
responsibility(SearchA)=0
responsibility(SearchB)=0
```

但兩者顯然是 redundant sufficient causes。

因此 Hermes 不應只有：

```text
DeleteEvent(e)
```

還應支援：

```text
ReplaceEvent(e, alternative)
MaskEvidence(e)
FreezeSiblingPaths(...)
HoldStateConstant(...)
SwapToolObservation(...)
```

並記錄：

```text
CounterfactualInterventionContract
├ target
├ intervention_type
├ replacement
├ frozen_variables[]
├ recomputed_descendants[]
├ blocked_side_effects[]
├ verifier
└ result
```

### 重要區分

```text
But-For Cause
≠
Actual Cause Under Redundancy
≠
Degree Of Responsibility
```

CausalFlow 的 CRS 是非常實用的 outcome-flip intervention score，但它不是完整 Halpern-Pearl actual causality solver；本輪應明確保留這個差異。

---

# Architecture Breakdown

## Hermes Semantic Trace Reduction Runtime

```text
UI / Agent / Models / Tools / MCP / Memory / Sensors
↓
Canonical Event Store
↓
Field-Level Provenance Extractor
↓
Dependency Graph Builder
├ data dependence
├ control/decision dependence
├ observation dependence
├ memory dependence
├ evidence-support dependence
└ side-effect dependence
↓
Outcome Query Compiler
↓
TraceSliceCriterion
↓
Backward Structural Slicer
↓
Candidate Slice
↓
Dynamic Execution Filter
↓
Intervention Planner
↓
Replay / Counterfactual Sandbox
↓
SemanticReplayEquivalenceContract
↓
Causal Responsibility Estimator
↓
Minimal Sufficient Trace Search
↓
TraceSliceCertificate
↓
Root Cause / Explanation / Regression Artifact
```

### `TraceSliceCertificate`

```text
TraceSliceCertificate
├ query_id
├ target_observable
├ original_trace_hash
├ selected_event_ids[]
├ selected_field_refs[]
├ dependency_closure
├ excluded_event_count
├ equivalence_level
├ replay_validated
├ interventions_run[]
├ causal_candidates[]
├ responsibility_scores{}
├ known_redundancies[]
├ unsupported_counterfactuals[]
└ certificate_scope
```

---

# Bottom-Level Logic

## A. Structural slice

令 trace dependency graph：

```text
G = (V,E)
```

target observable：

```text
y ∈ V
```

先取 ancestor closure：

```text
S_struct(y) = Ancestors_G(y) ∪ {y}
```

這是 cheap over-approximation，不是 causal proof。

## B. Dynamic filter

若某 dependency edge 在本次實際 run 未 activated：

```text
active(e, τ) = false
```

則可以從 dynamic slice 移除：

```text
S_dyn ⊆ S_struct
```

## C. Semantic sufficiency test

對 candidate subset `S`：

```text
Replay(trace | S)
→ y_S
```

在 equivalence relation `≈Q` 下：

```text
y_S ≈Q y_original
```

才叫對 query Q 足夠。

## D. Minimality

希望找：

```text
S* = argmin |S|
subject to
Replay(S) ≈Q Original
```

但不要假設解唯一；dynamic slicing theory 已指出 minimal slice 可非唯一，而且 exact minimization 可能很難。

因此 production runtime 更合理：

```text
backward slice
→ greedy pruning
→ intervention validation
→ locally minimal certified slice
```

而不是宣稱 global minimum。

## E. Responsibility

針對 event `e`：

```text
Intervene(e)
↓
Recompute affected descendants only
↓
Compare target outcome
```

最簡單的 binary score可模仿 CausalFlow：

```text
CR(e)=1
if exists valid intervention e' such that
Verifier(Y_do(e←e')) flips
```

但 Hermes 應另外保存：

```text
responsibility_method =
CAUSALFLOW_STYLE_OUTCOME_FLIP
BUT_FOR
HP_APPROXIMATION
SHAPLEY_APPROXIMATION
DEPENDENCY_ONLY
```

避免把不同 causal semantics 混在同一個 `score`。

---

# 與歷史研究比較：本輪真正新增了什麼？

上一輪已有：

```text
ReplaySufficiencyCertificate
NondeterminismManifest
ReplayCompatibilityContract
Capability-Aware Retention
```

本輪不是再問：

```text
History 足不足？
```

而是問：

```text
足夠回答這個問題的最小 history 是什麼？
```

所以新的關係：

```text
ReplaySufficiencyCertificate
↓ constrains
TraceSliceSearch

TraceSliceCriterion
↓ selects
Relevant Projection

Relevant Projection
↓ intervention
Causal Responsibility

Causal Responsibility
↓ supports
Explanation / Repair / Regression
```

這把 Hermes 從：

```text
Record Everything
→ Replay Everything
```

推進成：

```text
Record Richly
→ Slice By Question
→ Replay Minimally
→ Intervene Selectively
→ Explain Causally
```

---

# Visual Simulation Idea

## **Trace Slice × Causal Responsibility Lab**

### 畫面 1：完整 trace

```text
User#1
 ↓
Planner#2
 ├→ MemoryRead#3 ─────────┐
 ├→ Search#4 → PageA#5 ──┤
 ├→ Search#6 → PageB#7 ──┤
 ├→ Tool#8 → Obs#9 ──────┤
 └→ Safety#10             │
                          ↓
                    FinalAnswer#11
```

顯示：

```text
11 events
37 field dependencies
4 possible causal branches
```

### 畫面 2：使用者選 query

```text
WHY is claim[2] = "X" ?
```

自動縮成 field-level slice：

```text
PageB#7.snippet[3]
↓
MemoryWrite#9.claim_source
↓
Planner#10.claim[2]
↓
FinalAnswer#11.claim[2]
```

其餘淡出。

### 畫面 3：Intervention

點擊 `PageB#7.snippet[3]`：

```text
ORIGINAL
"X happened in 2025"

INTERVENTION
"X happened in 2024"
```

Sandbox 只重算 descendants。

結果：

```text
Final claim changed
YES

Permission decision changed
NO

Causal responsibility
HIGH for claim[2]
LOW for overall task pass
```

### 畫面 4：Redundancy

若 PageA 與 PageB 同時支撐 X：

```text
Delete A → still X
Delete B → still X
Delete A+B → X disappears
```

UI 顯示：

```text
REDUNDANT CAUSAL SUPPORT
Naive but-for attribution is insufficient
```

### 畫面 5：Slice depth slider

```text
STRUCTURAL
DYNAMIC
REPLAY-SUFFICIENT
CAUSALLY VALIDATED
LOCALLY MINIMAL
```

使用者會直接看到：

```text
Structural slice       73 events
Dynamic slice          31 events
Replay-sufficient      14 events
Causally validated      8 events
Locally minimal         6 events
```

這個視覺化會把「log、dependency、relevance、cause」四個概念徹底拆開。

---

# Code / GitHub 深入

## angr/angr
Repository:
https://github.com/angr/angr

### 核心檔案
`angr/analyses/backward_slice.py`

本輪實際讀到：

1. `BackwardSlice` constructor 接受 CFG/CDG/DDG 與 targets。
2. `_construct_default()` 建 `taint_graph`，從 target `CodeLocation` 開始。
3. 對每個 tainted location：
   - 先選入 statement
   - 從 DDG 取 predecessors
   - 從 CDG 取 control guardians
   - 將 dependence edge 放入 taint graph
4. `_handle_control_dependence()` 會找控制 target 可達性的 exit statements。
5. `_map_to_cfg()` 再把 slice 映射回 CFG，補上必要 default exits。

### 值得 Hermes 借用的 pattern

```text
Target-oriented traversal
+
Typed dependency relations
+
Transitive closure
+
Executable projection
```

### 不應直接照搬的部分

- Agent event dependency 比 binary/program statement dependency更動態。
- LLM outputs 與 natural-language state 缺少天然 def-use chain。
- tool observation 可能是 external world snapshot，不是 deterministic value。
- same semantic fact 可能來自多 sources，造成 redundancy。
- current file 自身有 FIXME，不能當 production-grade slicing implementation。

### Hermes 對應檔案建議

```text
src/replay/slicing/criterion.ts
src/replay/slicing/field-dependency-graph.ts
src/replay/slicing/backward-slicer.ts
src/replay/slicing/dynamic-filter.ts
src/replay/equivalence/semantic-equivalence.ts
src/replay/intervention/intervention-planner.ts
src/replay/intervention/counterfactual-runner.ts
src/replay/responsibility/responsibility.ts
src/replay/certificates/trace-slice-certificate.ts
```

---

# Papers

## Paper 1
**CausalFlow: Causal Attribution and Counterfactual Repair for LLM Agent Failures**  
Authors: Akash Bonagiri, Devang Borkar, Gerard Janno Anderias, Setareh Rafatirad, Houman Homayoun  
Year: 2026  
URL: https://arxiv.org/abs/2605.25338  
Code: 未在本輪確認到官方公開 repository  
Dataset: GSM8K / MBPP / SealQA Hard / MedBrowseComp  
Architecture: structured trace → step intervention → descendant re-execution → CRS → minimal repair → validation  
Contribution: 把 step-level agent debugging 做成 interventional attribution。  
Limitation: sequential trace abstraction、部分 domain 使用 predictive re-execution 而非 deterministic executor。

## Paper 2
**CausalRepair: Bridging the Causality Gap in Large Language Model-Based Automated Program Repair via Dual-Slicing**  
Authors: Linhao Wu, Yizhou Chen, Zhen Yang, Pengyu Xue, Dan Hao  
Institutions: Peking University / Shandong University  
Year: 2026  
URL: https://arxiv.org/abs/2608.10613  
Dataset: Defects4J V1.2 / V2.0 / Defects4J-Trans  
Architecture: context-aware static slicing + execution-trace dynamic slicing → minimal causal context → conversation-driven repair  
Contribution: minimal causal context + dual slicing。  
Limitation: program repair setting 比 general agent runtime 更 deterministic。

## Paper 3
**AgentTrace: Causal Graph Tracing for Root Cause Analysis in Deployed Multi-Agent Systems**  
Author: Zhaohui Geoffrey Wang  
Year: 2026  
Venue: ICLR AIWILD Workshop  
URL: https://arxiv.org/abs/2603.14688  
Code: project page指向 GitHub，但本輪該 repository link 回 404；Implementation 未驗證。  
Architecture: log → causal graph → backward trace → root cause rank。  
Contribution: lightweight LLM-free root cause localization。  
Limitation: graph ranking不是 intervention proof。

## Paper 4
**A Survey for LLM Agent Trajectory Analysis: From Failure Attribution to Enhancement**  
Authors: Junjie Wang et al.  
Year: 2026  
Venue: IEEE TSE, accepted/in press  
DOI: https://doi.org/10.1109/TSE.2026.3717765  
Scope: 55 papers  
Contribution: 系統化 failure taxonomy / attribution / enhancement / monitoring / benchmarks。  
Limitation: survey 本身不提供可執行 slicing runtime；但指出 step-level attribution 與 benchmark diversity 仍是主要缺口。

## Foundational references
- Korel, B.; Laski, J., **Dynamic Program Slicing**, Information Processing Letters, 1988. DOI: 10.1016/0020-0190(88)90054-3
- Agrawal, H.; Horgan, J., **Dynamic Program Slicing**, PLDI/SIGPLAN, 1990. DOI: 10.1145/93548.93576
- Halpern, J.; Pearl, J., **Causes and Explanations: A Structural-Model Approach. Part I: Causes**, 2005. DOI: 10.1093/bjps/axi147
- Chockler, H.; Halpern, J., **Responsibility and Blame: A Structural-Model Approach**. arXiv:cs/0312038

---

# 已確認事實 / 工程實作 / 推論 / 假說分層

## 已確認論文結果
- CausalFlow 使用 step intervention + downstream re-execution定義 CRS，報告 aggregate 42.7% failed trace repair conversion。
- CausalRepair 使用 static + dynamic dual slicing建立 minimal causal context，報告 Defects4J 313 correct fixes。
- 2026 TSE survey 彙整 55 trajectory-analysis papers，指出 step-level attribution accuracy 仍有限。

## 已確認工程實作
- angr `BackwardSlice` source 接受 CFG/CDG/DDG，從 target backward traverse data/control dependencies，再 map slice 回 CFG。
- angr source 也明示現有 BackwardSlice 有 refactoring compatibility FIXME。

## 合理工程推論
- Hermes 可把 CFG/DDG/CDG pattern映射成 Event DAG / State Dependency / Decision Dependency。
- field-level dependency 比 whole-event dependency 更適合 Agent traces。
- structural slicing 應作為 intervention candidate reduction，而不是最終 causal certificate。

## 尚未驗證假說
- `slice → intervene` 兩階段架構能在 Hermes production traces 上將 replay cost 降低 5–20x。
- semantic equivalence classifier 能穩定跨 model version 支持 locally minimal trace search。
- multi-modal evidence trace 可用相同 field/event slicing abstraction，而不需要 modality-specific causal engine。

---

# Unknown / Open Questions

## 1. Natural-language state 的「field dependency」如何可信取得？
LLM reasoning output 很少有 compiler 級 def-use。候選方法：

```text
explicit structured refs
+ runtime provenance tags
+ claim/evidence links
+ attention/attribution hints (non-causal)
+ intervention validation
```

真正可信的 dependency graph 很可能必須由 runtime instrumentation 建，而不是事後讓 LLM 猜。

## 2. Minimal sufficient trace 的 global optimum 值不值得追？
Exact search 很可能 combinatorial；而 minimal dynamic slice 也可能非唯一。
Production 更合理目標可能是：

```text
locally minimal
+
replay validated
+
causal coverage certificate
```

而不是證明 global minimum。

## 3. Counterfactual intervention 如何處理 irreversible / human / live-world descendants？
需要混合：

```text
recorded substitution
sandbox model
mock external effect
learned world model
human-in-the-loop branch
partial-identification / unsupported
```

不能把「無法安全 replay」誤記成「沒有 causal effect」。

---

# Knowledge Graph 新增 Node / Edge

## 新增 Nodes

```text
Semantic Replay Equivalence
SemanticReplayEquivalenceContract
Trace Slice Criterion
Structural Trace Slice
Dynamic Trace Slice
Replay-Sufficient Slice
Causally Validated Slice
Locally Minimal Trace
Minimal Sufficient Trace
Event Field Dependency
Field-Level Provenance
Outcome Query Compiler
CounterfactualInterventionContract
Causal Responsibility
But-For Cause
Redundant Cause
Responsibility Method
TraceSliceCertificate
Causal Coverage
Intervention Budget
Semantic Observable Projection
```

## 新增 Edges

```text
Dependency
≠ Causality

Ancestor Of Outcome
≠ Causally Responsible For Outcome

Structural Slice
→ Candidate Reduction

Dynamic Slice
→ Removes Non-Executed Dependence

Intervention
→ Tests Causal Responsibility

Same Final Verifier Result
≠ Same Agent Behavior

Byte Equality
≠ Semantic Replay Equivalence

Semantic Equivalence
→ Is Query Relative

Minimal Trace
→ Depends On Observable

Minimal Dynamic Slice
→ May Not Be Unique

Redundant Causes
→ Defeat Naive But-For Attribution

Field-Level Provenance
→ Enables Smaller Trace Slices

CausalFlow CRS
≠ Full Halpern-Pearl Actual Causality
```

---

# 下一輪研究

下一輪最自然的深度方向：

## **Trace Dependence Recovery × Information Flow × Provenance Semirings × Claim-Level Evidence Lineage × Multimodal Field Taint**

因為本輪已經能說：

```text
有 dependency graph
→ 可以 slice
→ 可以 intervene
```

但真正底層的下一個問題是：

> Agent 的 dependency graph 到底從哪裡來？

下一輪應拆：

```text
LLM prompt fields
Memory records
Retrieved chunks
Tool response fields
Image regions / OCR tokens
Audio spans
DOM nodes
Sensor observations
↓
Runtime read-set / write-set
↓
Information-flow / taint propagation
↓
Claim-level provenance
↓
Field-level dependence graph
↓
Trace slicing
```

重點研究：
- dynamic information flow / taint tracking
- provenance semirings / why-provenance / where-provenance
- claim-evidence graph
- RAG citation lineage
- multimodal region/token attribution 與 causal limitation
- structured tool/MCP read-write contracts
- privacy / secret taint × action permission

---

# 每輪結束判定

**缺哪一層？**  
`Field-Level Dependency Recovery / Information-Flow Provenance Layer`。

**哪個節點最淺？**  
`NaturalLanguageFieldDependency`、`MultimodalFieldTaint`、`CausalCoverageCertificate`、`MinimalSufficientTrace`。

**哪個概念仍只是名詞？**  
production 級 `SemanticReplayEquivalenceContract`：目前有清楚架構，但跨 model/tool/version 的 verifier 還沒有成熟通用標準。

**哪個系統值得讀原始碼？**  
下一輪首選：OpenTelemetry/OpenInference 的 GenAI span/provenance semantic conventions + 一個成熟 dynamic taint / information-flow engine；本輪已深入 `angr/angr/analyses/backward_slice.py`。

**哪篇論文需追引用？**  
優先 `CausalFlow`，接著 `CausalRepair`；兩篇剛好代表 intervention 與 slicing 兩條可互補路線。

**哪個概念最適合視覺模擬？**  
`Trace Slice × Causal Responsibility Lab`。

**哪個 Agent 架構最值得實作？**

```text
Field-Level Provenance
↓
Outcome Query Compiler
↓
Backward Trace Slicer
↓
Dynamic Filter
↓
Counterfactual Intervention Planner
↓
Minimal Replay Sandbox
↓
Semantic Equivalence Verifier
↓
Causal Responsibility
↓
TraceSliceCertificate
```

---

# 對「AI 到底怎麼運作」補上的核心

上一輪已經知道 AI 執行是一張 event history / causal graph，而不是一條乾淨線性流程。本輪再補上一層：

> **要解釋 AI 的一個輸出，不需要把整個宇宙都重播。真正成熟的 Agent runtime 應該能從某個具體問題開始，例如「為什麼這個 claim 出現？」、「為什麼這個 tool 被允許？」；先沿 field-level data/control/evidence dependency 反向切出候選 trace，再透過可控 counterfactual intervention 測試哪些 event 真正改變結果。只有這樣，trace 才會從「完整紀錄」進化成「最小、可驗證、因果化的解釋」。**

最終整體鏈條因此再增加：

```text
使用者一句話
↓
UI
↓
Agent Runtime
↓
Context / Memory / Tools / MCP / Models
↓
Events + Field-Level Provenance
↓
Causal / Dependency Graph
↓
Outcome Query
↓
Trace Slice
↓
Counterfactual Intervention
↓
Causal Responsibility
↓
Minimal Sufficient Explanation
↓
Output / Repair / Audit / Learning
```
