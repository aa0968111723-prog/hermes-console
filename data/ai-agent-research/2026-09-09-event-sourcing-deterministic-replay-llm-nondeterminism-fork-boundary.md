# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-09 20:51（Asia/Taipei）

## 本輪研究主題
**Event Sourcing × Deterministic Replay × LLM Nondeterminism × Replay/Fork Boundary × Trace/State Separation**

本輪延續上一輪「Distributed Tool Execution × Durable Execution × Idempotency × Saga / Compensation × Effect Fencing」的缺口，不再重複 retry/compensation，而是專門處理：**當 Agent 從 checkpoint / event history 恢復時，哪些東西應重放、哪些應快取、哪些應重新推理、哪些外部效果絕對不能重新執行，以及何時必須 fork 新分支而不能假裝仍是同一條 execution history。**

---

# 本小時新發現

## 新架構 1：ActiveGraph — Event Log as Source of Truth

ActiveGraph（Yohei Nakajima, 2026）把傳統 Agent architecture 反過來：不是 LLM loop 為核心、logging 是附加層，而是 **append-only event log 成為 source of truth，working graph 是可由 event log 決定性重建的 projection**。

核心：

```text
Append-only Event Log
↓ deterministic projection
Working Graph
├ beliefs
├ evidence
├ tasks
├ decisions
└ dependencies
↓
Reactive Behaviors
↓
New Events
```

官方文件與原始碼顯示，load、fork、strict-check 都會在底層執行 replay；同一份 event log 的 replay 應生成 byte-identical graph state。LLM/tool call 不在 replay 時重新發生，而是從 event log 建立 response cache：LLM 以完整 prompt content hash（system/user/model/tool definitions/output schema）索引，tool 以 tool name + deterministic argument hash 索引。

這代表：

```text
Replay of computation history
≠
Re-execute nondeterministic model/tool call
```

而應是：

```text
Recorded nondeterministic boundary result
→ deterministic replay input
```

## 新架構 2：Shepherd — Git-like Typed Execution Trace

Shepherd（Simon Yu et al., 2026）把每次 Agent–Environment interaction 記為 typed event，形成 Git-like execution trace，使 meta-agent 可以對過去 state 做 fork / replay。論文報告其 process/filesystem fork 比 Docker full copy 快約 5×，replay prompt-cache reuse 超過 95%；CooperBench pair coding pass rate 從 28.8% 提升到 54.7%，Tree-RL TerminalBench-2 由 34.2% 到 39.4%。

重要改變：**execution history 從 debug artifact 變成可被 Agent 操作的一級 runtime object。**

## 新架構 3：DelAct — Replayable Boundary Between Deliberation and Actuation

DelAct（IWQoS 2026）提出 control/data/observability tri-plane：control plane 保持 session state 與 deliberation，不做 side effect；data plane 對 tool intent 做 commitment-hash governance；observability plane 保存 append-only log，支援 deterministic replay 與 replay-to-live fork。

它補足上一輪的 durable effect 問題：

```text
Deliberation can replay
Actuation cannot blindly replay
```

因此 replay boundary 必須位於 **reasoning intent → external effect commit** 之間。

## 新研究 4：OpenRath — Session as First-Class Runtime Value

OpenRath（2026）把 conversation chunks、tool effects、workspace placement、branch provenance、token usage、pending work、memory interactions 等統一到可 branch / inspect / replay 的 Session runtime object。這補足一般 framework 把 transcript、memory、workspace、tool trace 分散保存造成的 state fragmentation。

## 新研究 5：Replayable Financial Agents — Determinism ≠ Accuracy

2026 DFAH（Determinism-Faithfulness Assurance Harness）在 4,700+ runs、7 models、4 providers、3 financial benchmarks 下報告：decision determinism 與 task accuracy 在該樣本中沒有可檢出的相關性（r=-0.11, p=0.63）。

重要結論：

```text
Deterministic Replay
≠
Correct Reasoning
```

Replay 能保證「我們可以重建當時到底做了什麼」，不是保證「當時的決定是對的」。

---

# 本小時最重要 5 個發現

## 1. Agent Runtime 應明確切出 Deterministic / Nondeterministic Boundary

傳統程式的 deterministic replay 假設：

```text
same input + same code
→ same result
```

LLM Agent 不成立，因為：

```text
same prompt
→ potentially different tokens
```

且外部世界也會變：

```text
same browser request at t1
≠ same result at t2
```

因此 production Agent runtime 應將 operation 分四類：

```text
A. PURE_DETERMINISTIC
   JSON transform / graph projection / parser

B. RECORDED_NONDETERMINISTIC
   LLM generation / random / clock / external read

C. REVERSIBLE_SIDE_EFFECT
   draft creation / temporary reservation

D. IRREVERSIBLE_OR_DURABLE_EFFECT
   payment / send email / delete / publish
```

Replay policy：

```text
A → RECOMPUTE
B → REPLAY RECORDED RESULT
C → REPLAY STATE / VERIFY BEFORE LIVE
D → NEVER REPLAY BLINDLY
```

這是本輪最核心的 runtime boundary。

---

## 2. Event Log、Trace、Checkpoint、Projection 是四種不同東西

不能再全部叫「記錄」。

```text
Event Log
= canonical append-only history

Projection
= event log 派生出的目前 state

Checkpoint / Snapshot
= 加速 state restore 的 materialized shortcut

Trace
= observability / spans / timing / token / model/tool metadata
```

OpenAI Agents SDK 的 tracing 會記錄 task/agent/turn/generation/function-tool/guardrail/handoff spans，非常適合 observability；但 trace 本身並不自動等於可驗證的 canonical event-sourced state machine。

因此：

```text
Trace ≠ Event Store
Checkpoint ≠ Event History
Projection ≠ Source of Truth
```

Hermes Console 應把這四層在視覺上分開。

---

## 3. LLM Output 應「Freeze as Event」，而不是 replay 時重新抽樣

ActiveGraph 的 replay 文件提供了非常明確的工程策略：

```text
Prompt
↓ content hash
llm.requested
↓
LLM generation
↓
llm.responded
↓
response cache
```

Replay：

```text
same prompt hash
↓
lookup recorded llm.responded
↓
return recorded output
```

不是：

```text
same prompt
↓
call LLM again
↓
hope output same
```

底層上，LLM generation 可以視為：

```text
Y ~ Pθ(y | context, decoding config, backend state)
```

即使 temperature=0，distributed kernels、model revision、provider routing、implementation version 都可能影響 bit-level / token-level reproducibility。

因此真正可靠的是：

```text
Replay Determinism
= deterministic state transition
  over recorded nondeterministic outcomes
```

而不是要求 foundation model 自身完全 deterministic。

---

## 4. Replay 與 Fork 必須是不同語義

Replay 目標：

```text
History H0...Hn
→ reconstruct same state Sn
```

Fork 目標：

```text
Shared Prefix H0...Hk
↓
Branch A → fresh decisions A(k+1...)
Branch B → fresh decisions B(k+1...)
```

因此：

```text
Replay
= preserve historical truth

Fork
= create new hypothetical future
```

ActiveGraph 的 fork 會重建 shared prefix，而 fork point 後的新 behavior fresh execute；Shepherd 也把歷史 fork 當作 meta-agent exploration primitive。

所以若 Agent restore 後發現：

```text
model changed
prompt changed
tool schema changed
authority changed
world observation changed
```

就不應宣稱「繼續原本 replay」，而應：

```text
REPLAY PREFIX
↓
FORK
↓
NEW BRANCH
```

這可避免把新的推理偷偷覆寫成舊歷史。

---

## 5. Replay Correctness 需要 Read-Set / Dependency Provenance

只有保存 output 還不夠，因為必須知道某個 decision **看過哪些 state**。

ActiveGraph v1.10 已加入 context-read tracing：記錄 behavior 實際讀了哪些 objects；read set 本身成為 event，能 replay/fork。

因此一個可驗證 decision 應至少有：

```text
DecisionEvent
├ model_id
├ model_revision
├ prompt_hash
├ context_hash
├ read_set[]
├ tool_schema_hash
├ decoding_config
├ output
├ output_hash
├ parent_events[]
└ branch_id
```

這是 causal replay 的關鍵：

```text
Decision D
was derived from
{E12, E18, E31}
```

而不是只知道「D 發生在 E31 後面」。

時間順序（happened-after）與因果依賴（depends-on）必須分開。

---

# Architecture Breakdown

```text
User Input
↓
UI Event
↓ append
Canonical Event Store
↓
Deterministic Projector
↓
Agent Working State / Graph
↓
Behavior / Agent Loop
↓
Read-Set Capture
↓
Reasoning Request
├ context hash
├ model revision
├ tool schema hash
└ branch id
↓
Nondeterministic Boundary
├ LLM
├ External Read
├ Randomness
└ Clock
↓
Recorded Outcome Event
↓
Deterministic Planner / Reducer
↓
Proposed Tool Intent
↓
Effect Boundary
├ authorization
├ semantic effect id
├ idempotency
├ commitment hash
└ precondition snapshot
↓
Tool Execution
↓
Effect Evidence
↓ append
Event Store
↓
Projection Update
↓
Next Agent State
```

Recovery path：

```text
Crash
↓
Load Event Log
↓
Optional Snapshot Restore
↓
Replay Events after Snapshot
↓
Rebuild Projection
↓
For each historical nondeterministic call:
  serve recorded result
↓
Reach Historical Frontier
↓
Check runtime compatibility
├ same code/schema/world/authority
│  → continue live
└ changed
   → fork branch
```

---

# Bottom-Level Logic

## 1. Event Reduction

設事件序列：

```text
E = [e1, e2, ..., en]
```

projection：

```text
S0 = initial_state
Si = reduce(Si-1, ei)
```

若 `reduce` 是 deterministic：

```text
Replay(E) → Sn
```

應恆等。

真正不穩定的 operation 不應藏在 `reduce()` 內，例如：

```text
reduce(...):
    result = llm(prompt)   ← wrong replay boundary
```

而應改成：

```text
e_request
↓ live only
LLM
↓
e_response(output)
↓
reduce(state, e_response)
```

這將 probabilistic computation **轉換成 recorded fact**。

## 2. Determinism Contract

ActiveGraph 明確禁止 behavior body 直接使用 `random`、`datetime.now()`、`uuid.uuid4()`、framework 外 I/O、mutable global state，因為這些會讓 replay drift。需要的 nondeterministic values 應進 event/runtime deterministic generator。

Hermes 可擴成：

```text
ReplaySafe(Function)
=
NoHiddenIO
∧ NoHiddenClock
∧ NoHiddenRandom
∧ NoMutableGlobal
∧ StableDependencies
```

## 3. Replay Hash Chain

Hermes 工程模型：

```text
H0 = genesis
Hi = Hash(
  Hi-1 ||
  event_type ||
  canonical_payload ||
  branch_id ||
  schema_version
)
```

用途：

```text
history tamper detection
branch lineage
projection verification
replay integrity
```

## 4. Replay/Fork Decision

```text
CanContinueSameHistory =
  CodeCompatible
∧ SchemaCompatible
∧ ModelContractCompatible
∧ AuthorityStillValid
∧ NoUnknownExternalEffect
```

若 false：

```text
fork(parent_event = frontier)
```

而非 mutation historical log。

---

# Visual Simulation Idea

## **Agent Time Machine — Event Sourcing / Replay / Fork Lab**

主畫面是一條 execution timeline：

```text
E001 user.input
E002 context.compiled
E003 llm.requested
E004 llm.responded
E005 tool.proposed
E006 tool.committed
E007 tool.responded
E008 belief.updated
E009 llm.requested
E010 llm.responded
```

每個 event 可點開：

```text
Event ID
Branch ID
Parent Event
Read Set
Prompt Hash
Model Revision
Tool Schema Hash
Effect ID
Payload Hash
Projection Hash
```

提供三個操作：

```text
REPLAY
FORK HERE
DIFF BRANCHES
```

### REPLAY 模式

動畫顯示：

```text
E001 → reducer → S1
E002 → reducer → S2
E003 → cached boundary
E004 → recorded LLM output
...
```

LLM 圖示應顯示：

```text
NO NEW MODEL CALL
RECORDED RESPONSE REPLAYED
```

### FORK 模式

在 E008 分叉：

```text
                 ┌─ Branch A
E001...E008 ─────┤
                 └─ Branch B
```

Branch A 使用原模型；Branch B 換新模型或 prompt。UI 顯示：

```text
Shared history = immutable
New reasoning = new branch
```

### Failure Injection

可注入：

```text
MODEL REVISION CHANGED
PROMPT TEMPLATE CHANGED
TOOL SCHEMA CHANGED
CLOCK READ CHANGED
RANDOM UUID CHANGED
DIRECT HTTP CALL IN BEHAVIOR
EXTERNAL EFFECT ALREADY COMMITTED
EVENT LOG TAMPERED
```

然後觀察：

```text
STRICT REPLAY PASS
STRICT REPLAY DIVERGENCE
FORK REQUIRED
EFFECT VERIFY REQUIRED
```

這個 simulator 能直接回答：

> 「Agent 復原時，到底是在回到過去，還是在重新創造一個新的未來？」

---

# Code / GitHub

## ActiveGraph
Repository: `yoheinakajima/activegraph`

值得讀的核心目錄：

```text
activegraph/
├ core/
│  └ graph.py
├ runtime/
│  ├ runtime.py
│  ├ diff.py
│  ├ promote.py
│  ├ context_reads.py
│  ├ authority.py
│  └ behavior_graph.py
├ store/
│  ├ base.py
│  ├ sqlite.py
│  └ retention.py
├ behaviors/
├ llm/
├ sandbox/
├ sinks/
└ observability/

docs/concepts/
├ replay.md
├ forking.md
├ events.md
├ graph.md
└ behaviors.md
```

最值得讀：

1. `docs/concepts/replay.md` — replay contract、LLM/tool cache key、strict/permissive replay。
2. `activegraph/runtime/runtime.py` — load/fork/replay orchestration。
3. `activegraph/core/graph.py` — event append → projection → durable store sequencing。
4. `activegraph/runtime/context_reads.py` — causal read-set tracing。
5. `activegraph/runtime/promote.py` — fork delta promotion / graph reconstruction。
6. `activegraph/store/sqlite.py` — run-scoped event identity / persistence。

本輪原始碼確認：`EventStore.append(event)` 是 store abstraction；`Graph` 會在事件進 projection / durable append 後再提供給 downstream sink；fork/promotion 透過 replay parent log 重建 fork point state。

## ESAA
ESAA 將 Agent output 限制為 structured intention，由 deterministic orchestrator 驗證、append event、再執行 state mutation；roadmap/issues/lessons 都是 projection。其設計與 ActiveGraph 在「probabilistic agent → deterministic admission/runtime」上高度一致。

## Shepherd
應追：typed execution trace、process/filesystem fork、meta-agent function model、Lean mechanization、prompt-cache reuse。

## DelAct
應追：control plane / data plane / observability plane、commitment hash、in-doubt verification、replay-to-live fork。

---

# Papers

## 1. The Log is the Agent: Event-Sourced Reactive Graphs for Auditable, Forkable Agentic Systems
- **Author:** Yohei Nakajima
- **Year:** 2026
- **arXiv:** 2605.21997
- **Code:** ActiveGraph (`yoheinakajima/activegraph`)
- **Architecture:** append-only log → deterministic graph projection → reactive behavior → new event
- **Contribution:** 把 event log 從 observability artifact 提升為 agent runtime source of truth；支援 deterministic replay、cheap fork、lineage。
- **Limitations:** deterministic contract 仍依賴 behavior discipline；framework 無法靜態阻止所有 hidden nondeterminism；外部 side-effect correctness 仍需要 effect boundary。
- **改變了什麼:** Agent state 不再主要是 prompt/memory/checkpoint，而是 immutable history 的 projection。

## 2. Shepherd: A Runtime Substrate Empowering Meta-Agents with a Formalized Execution Trace
- **Authors:** Simon Yu, Derek Chong, Ananjan Nandi, Dilara Soylu, Jiuding Sun, Christopher D. Manning, Weiyan Shi
- **Institution:** Stanford-affiliated research team（依作者公開資訊，需逐作者 institution 再核對）
- **Year:** 2026
- **arXiv:** 2605.10913
- **Architecture:** typed event execution trace + Git-like state fork/replay + process/filesystem substrate
- **Dataset/Benchmarks:** CooperBench、TerminalBench-2 等
- **Contribution:** 把 Agent trajectory 變成 meta-agent 可操作的一級 runtime state。
- **Limitations:** 目前主要是 research runtime substrate，尚非跨 provider 標準。
- **改變了什麼:** debugging/optimization 從 transcript inspection 進化成 execution-state branching。

## 3. DelAct: A Replayable Boundary Runtime for Auditable and Governed LLM Agent Workflows
- **Venue:** IEEE/ACM IWQoS 2026
- **Year:** 2026
- **Architecture:** control plane + data plane + observability plane
- **Contribution:** 明確切開 deliberation replay 與 external actuation，加入 commitment-hash governance、in-doubt verification、compensation、append-only replay log。
- **Evaluation:** Ticket/Invoice fault-injection workflow；論文報告 full governance 消除 timeout-induced duplicate writes，rollback MTTR 平均 66.5 ms（僅限其實驗設定）。
- **Limitations:** benchmark/domain scope 有限，不能直接推論為任意 Agent exactly-once guarantee。
- **改變了什麼:** replay 不再只是「重跑 agent」，而是安全跨越 reasoning/action boundary 的 runtime operation。

## 4. OpenRath: Session-Centered Runtime State for Agent Systems
- **Year:** 2026
- **arXiv:** 2606.19409
- **Architecture:** Session first-class runtime value
- **Contribution:** 統一 transcript、tool evidence、workspace、branch provenance、pending work、usage、memory interactions；fork/merge/replay 成為顯式 runtime operations。
- **Limitations:** 新系統，產業採用與跨 framework interoperability 仍待驗證。

## 5. Replayable Financial Agents: A Determinism-Faithfulness Assurance Harness for Tool-Using LLM Agents
- **Year:** 2026
- **arXiv:** 2601.15322
- **Benchmarks:** 3 financial benchmarks、50 cases each；7 models、4 providers、4,700+ runs
- **Contribution:** 分開衡量 trajectory determinism、decision determinism、faithfulness / accuracy。
- **Key result:** 該樣本內 determinism 與 accuracy 無顯著關聯。
- **Limitation:** financial-domain harness；結果不應直接外推所有 agent benchmark。

---

# 已確認事實 / 工程推論 / 尚未驗證假說

## 已確認事實

1. ActiveGraph 公開實作與文件把 append-only event log 作為 canonical state source，working graph 為 deterministic projection。
2. ActiveGraph replay 會以 prompt hash / tool+arguments hash 重用已記錄 LLM/tool response，而不是重新呼叫相同 nondeterministic operation。
3. ActiveGraph strict replay 會在第一個 divergence event 報錯。
4. Shepherd 以 typed Git-like execution trace 支援 fork/replay。
5. DelAct 明確將 deliberation 與 actuation 分成 replay boundary。

## 工程推論

1. Hermes Agent Runtime 應定義 `ReplayClass`：PURE / RECORDED_NONDETERMINISTIC / REVERSIBLE_EFFECT / IRREVERSIBLE_EFFECT。
2. 每個 LLM call 應有 stable request hash、model revision、tool schema hash、context/read-set hash。
3. replay 到歷史 frontier 後，一旦 model/tool/schema/authority/world contract 改變，應 fork 而非繼續聲稱 same-history replay。
4. Knowledge Graph node/edge 的 materialized state 應可由 events 重建，避免把 mutable graph DB 當唯一 source of truth。

## 尚未驗證假說

1. 是否能定義跨 LangGraph / OpenAI Agents SDK / Google ADK / MCP / Temporal 的 Unified Agent Event ABI。
2. 是否能將 LLM provider 的 server-side cache / prompt cache identity 納入跨 runtime replay contract。
3. Multimodal Agent 中，image/video/audio encoder output 是否應像 LLM response 一樣 freeze 成 event artifact，或只保存 source media + encoder version 後重算。

---

# Unknown / Open Questions

## 1. Multimodal Replay Boundary

```text
Image bytes
→ vision preprocessing
→ patch/token encoding
→ fusion
→ reasoning
```

要 replay 時究竟保存：

```text
raw media?
preprocessed tensors?
visual tokens?
encoder hidden states?
LLM response?
```

每一層都涉及 storage vs reproducibility tradeoff。

## 2. Model Upgrade Replay

若原 run 用 Model v1，現在只剩 v2：

```text
Historical replay
```

應永遠讀舊 `llm.responded`，但如果要「用新模型重新評估同一歷史」應命名為：

```text
COUNTERFACTUAL FORK
```

而不是 replay。

## 3. Event Schema Evolution

Agent runtime 長期運作數月後，event schema、tool schema、entity ontology 都會改。如何：

```text
old event
→ migration adapter
→ deterministic projection vN
```

而不破壞 hash/lineage，仍缺跨框架標準。

---

# 下一輪研究

**Multimodal Event Sourcing × Artifact Identity × Encoder Versioning × Reproducible Perception Replay**

下一輪應直接處理上一個 open question：

```text
Camera/Image/Voice/Video
↓
Preprocessor
↓
Encoder
↓
Tokens / Features
↓
Fusion
↓
LLM
```

哪些邊界應 event-source？

預計拆：

```text
Raw Artifact ID
Content Hash
Preprocessor Version
Encoder Model Revision
Feature/Token Hash
Temporal Chunk ID
Spatial ROI ID
Fusion Config
Reasoning Request Hash
```

並比較：

- VLM replay：raw media replay vs encoded-feature replay
- audio/voice：waveform / codec / ASR transcript / acoustic embedding
- video：frame sampling / temporal chunk / keyframe / latent cache
- diffusion/video generation：seed / scheduler / model revision / latent checkpoints
- Computer Agent：screenshot hash / DOM snapshot / accessibility tree / browser state

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Agent Event Store
Event-Sourced Runtime
Deterministic Projection
Replay Frontier
Replay Class
Recorded Nondeterministic Outcome
LLM Request Hash
Tool Request Hash
Read Set
Context Read Event
Strict Replay
Replay Divergence
Counterfactual Fork
Branch Lineage
Projection Hash
Event Hash Chain
Schema Version
Replay Compatibility
Replay-to-Live Boundary
Deliberation Plane
Actuation Plane
Execution Trace
Session Runtime Value
```

## Edges

```text
Event Log
→ deterministically projects
Working State

LLM Request
→ produces
Recorded Nondeterministic Outcome

Recorded Outcome
→ substitutes for
LLM Re-execution During Replay

Read Set
→ explains dependency of
Decision Event

Replay
→ preserves
Historical Outcome

Fork
→ creates
Alternative Future

Replay Divergence
→ invalidates
Same-History Claim

Changed Runtime Contract
→ requires
Fork or Migration

Checkpoint
→ accelerates
Replay

Checkpoint
≠
Canonical History

Trace
≠
Event Store

Deterministic Replay
≠
Correct Decision

External Durable Effect
→ lies beyond
Safe Blind Replay Boundary
```

---

# 本輪收斂回答

- **缺哪一層：** Multimodal artifact/encoder replay boundary，以及 event schema evolution。
- **哪個節點最淺：** `Replay Compatibility`，目前尚缺跨 model/tool/schema/world-state 的正式 compatibility matrix。
- **哪個概念仍只是名詞：** Unified Agent Event ABI / Cross-Framework Replay Contract。
- **哪個系統值得讀原始碼：** `yoheinakajima/activegraph`，優先 `runtime/runtime.py`、`core/graph.py`、`runtime/context_reads.py`、`runtime/promote.py`、`store/sqlite.py`。
- **哪篇論文需追引用：** ActiveGraph《The Log is the Agent》與 Shepherd；DelAct 適合追 production side-effect governance 引用。
- **哪個概念最適合視覺模擬：** **Agent Time Machine — Event Sourcing / Replay / Fork Lab**。
- **哪個 Agent 架構最值得實作：** **Event-Sourced Agent Runtime + Recorded Nondeterministic Boundaries + Replay/Fork Semantics + Effect Fence**。

---

# 本輪核心結論

> **LLM Agent 的 deterministic replay 不應要求 LLM 本身每次重新生成完全相同結果。更可靠的設計，是把 LLM、外部讀取、時間與 randomness 視為 nondeterministic boundaries：第一次 live execution 時把結果寫進 append-only event log，之後 replay 只重放這些已記錄 outcome，再用 deterministic reducer 重建 Agent state。當 runtime、模型、prompt、tool schema、authority 或 world contract 改變時，那已經不是 replay，而應建立新的 fork。這使 Agent 的「記憶」進一步從可搜尋內容，升級成可驗證、可重建、可分叉的 execution history。**
