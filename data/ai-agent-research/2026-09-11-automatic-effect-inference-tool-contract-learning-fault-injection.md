# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-11 18:55（Asia/Taipei）  
**本輪主題**：Automatic Effect Inference × Tool Contract Learning × Read/Write Footprint Discovery × Fault Injection × Effect Certification

---

## 0. 與歷史研究比較：本輪沒有重做什麼

上一輪已建立：

```text
Tool Intent
→ Effect Contract
→ Logical Operation Identity
→ Idempotency Key
→ Precondition Snapshot
→ Dispatch
→ Effect Truth
→ Postcondition Verification
→ Verify-Before-Retry
→ Commit / Saga Compensation
→ Recovery Verification
```

但上一輪仍隱含一個關鍵假設：**Effect Contract 已知**。

真實 Hermes Runtime 面對陌生 MCP / SaaS / Browser / CLI / Computer Tool 時，通常只拿得到：

```text
name
+
description
+
inputSchema
+
outputSchema
+
少量 annotations
```

卻不知道：

```text
真正讀了哪些 resource？
真正改了哪些 resource？
重試是否安全？
是否有 delayed visibility？
是否會 partial apply？
錯誤回傳後 effect 是否可能已發生？
是否存在可驗證 postcondition？
是否能 rollback / compensate？
```

因此本輪不再討論「已知 effect contract 下如何交易化執行」，而是研究：

> **Hermes 如何從陌生工具的 schema、annotations、sandbox experiment、state diff、retry probes 與 fault injection，自動學出一份可驗證 Effect Contract。**

---

# 1. 本小時新發現

## 新架構

- Effect Contract Learner
- Read/Write Footprint Discoverer
- Tool Behavioral Profiler
- Effect Annotation Verifier
- Idempotency Probe Engine
- Delayed-Visibility Detector
- Partial-Effect Detector
- Fault-Injection Harness
- Contract Confidence Model
- Effect Certificate Registry

## 新論文 / Framework

### AgentChaos: Chaos Engineering for Agent Systems via Programmatic Fault Injection

- Authors: Gou Tan et al.
- Year: 2026
- Institution: multi-institution collaboration; paper includes David Lo and Lwin Khin Shar among authors
- URL: https://arxiv.org/abs/2608.06790
- Code: https://github.com/IntelligentDDS/AgentChaos
- Architecture: HTTP-layer interception + field-level response mutation + trigger verification
- Contribution: non-intrusive runtime fault injection for agent systems
- Fault families: crash / omission / value faults
- Reported result: pass@1 can drop by up to 50 percentage points under injected faults
- Limitation: focuses primarily on LLM API response reliability rather than discovering external tool world-state semantics

### AgentCheck: A Reproduce-Intervene-Mitigate Workbench for LLM Agents over MCP

- Authors: Aritra Mazumder, Nusrat Jahan Lia
- Year: 2026
- URL: https://arxiv.org/abs/2607.11098
- Architecture: clean-run recording → MCP response cache → targeted perturbation → replay → divergence/live continuation → mitigation confirmation
- Contribution: makes MCP tool faults reproducible in the developer’s actual agent configuration
- Fault types: 12 classes including timeout, stale values, poisoned descriptions
- Reported result: best tested configuration passed 105/120 cases, weakest 77/120; retry largely fixed timeout faults but stale-data failures remained much harder
- Limitation: its primary objective is reliability diagnosis, not automatic effect-contract induction

### AgentChaos / AgentCheck 的共同意義

它們把「Tool/API 不可靠」變成可控制的 intervention surface。

Hermes 可以再往前推一步：

```text
Fault Injection
≠ only Reliability Benchmark

Fault Injection
→ Behavioral Identification
→ Effect Contract Learning
```

---

# 2. 本小時最重要 5 個發現

## 發現 1：MCP Tool Annotations 是 prior，不是 ground truth

### 已確認官方資訊

MCP ToolAnnotations 已提供：

```text
readOnlyHint
destructiveHint
idempotentHint
openWorldHint
```

官方規格與 2026 MCP Tool Annotations 說明都明確指出：**這些欄位只是 hints，不能保證 server 真實行為；來自不受信任 server 時，client 不應以它們直接做安全決策。**

因此 Hermes 不應：

```text
idempotentHint = true
→ blindly retry
```

而應：

```text
Declared Annotation
↓
Prior Belief
↓
Behavioral Probe
↓
Observed Evidence
↓
Verified / Contradicted / Unknown
```

### 底層意義

這把工具 metadata 從「contract」降級成：

```text
Hypothesis about behavior
```

Hermes 應保存：

```text
EffectClaim
├ source = tool_annotation
├ claim = IDEMPOTENT
├ trust = server_trust_level
├ evidence = []
└ status = UNVERIFIED
```

當 sandbox 中重複呼叫兩次後：

```text
state_after_call_1
≈
state_after_call_2
```

才可以增加 confidence。

### 限制

有限測試只能建立 evidence，不足以數學證明所有 input 都 idempotent。

所以：

```text
Observed Idempotency
≠ Universal Idempotency
```

---

## 發現 2：Effect Contract 應由「schema + experiment + state diff」共同學得

只讀 schema 很難知道 side effects。

例如：

```json
{
  "name": "update_profile",
  "input": {
    "name": "string"
  }
}
```

schema 只能告訴我們 argument shape。

不知道：

```text
WRITE users.profile?
WRITE audit_log?
SEND webhook?
INVALIDATE cache?
TRIGGER email?
```

因此 Hermes 應使用 black-box experimental identification：

```text
Tool Schema
↓
Generate Safe Probe Input
↓
Snapshot World State
↓
Invoke Tool
↓
Snapshot Again
↓
Structured Diff
↓
Candidate Read Set / Write Set
↓
Repeat with Perturbations
↓
Effect Contract
```

### 建議的 Footprint 類型

```text
READ(resource pattern)
WRITE(resource pattern)
CREATE(resource pattern)
DELETE(resource pattern)
EMIT(event)
NETWORK(domain)
AUTHORIZE(scope)
INVALIDATE(cache/resource)
SCHEDULE(job)
PHYSICAL(action)
```

並區分：

```text
Direct Effect
Indirect Effect
Delayed Effect
Derived Effect
External Effect
```

### 合理推論

這與 database transaction read-set / write-set 很像，但 Agent tool 的 resource address 往往是動態、語意型的，因此不能只靠 static code analysis。

---

## 發現 3：Fault Injection 不只測 robustness，也能反推 Contract 邊界

AgentChaos 已提供 runtime、field-level、non-intrusive injection；公開程式碼中的 FaultSpec 包含：

```text
intercept
operation/action
target_path
value
max_count
min_count
probability
```

且 FaultEngine 可以對 JSON path 做 set / corrupt / truncate 等 mutation，並有概率與 delayed-onset 控制。

這讓 Hermes 可以把 fault injection 變成 system-identification experiment。

例如：

```text
Tool call returns 200
but response field `id` is truncated
```

觀察 downstream：

```text
Does planner continue?
Does verification catch mismatch?
Does retry create duplicate resource?
Does tool effect already exist?
```

再例如：

```text
Inject timeout after dispatch
```

若重新查詢 provider 發現 resource 已建立：

```text
Tool has ambiguous-outcome risk
```

因此 contract 應增加：

```text
ambiguous_outcome_possible = true
verification_strategy = lookup_by_operation_id
retry_strategy = verify_before_retry
```

### 新的重要觀念

```text
Fault Response
→ Runtime Reaction
→ World-State Observation
→ Contract Evidence
```

而不只是：

```text
Fault Response
→ pass / fail
```

---

## 發現 4：Retryability 必須拆成至少四個不同概念

現在許多 Agent runtime 把 retryable 簡化成 boolean。

實際應拆為：

```text
TransportRetryable
ApplicationRetryable
EffectIdempotent
OutcomeDiscoverable
```

例：

```text
HTTP 500
```

可能代表 transport/application retryable，卻不代表 effect 沒發生。

Hermes 應學：

```text
RetryContract
├ safe_before_dispatch
├ safe_after_definite_rejection
├ safe_after_timeout
├ idempotency_scope
├ dedup_key_field
├ result_lookup
└ max_retry_window
```

### 實驗方法

```text
Trial 1: normal call
Trial 2: exact same call
Trial 3: same semantic operation, different request ID
Trial 4: timeout injected after dispatch
Trial 5: retry with same logical operation ID
Trial 6: retry with new logical operation ID
```

比較：

```text
resource_count
resource_identity
external side effects
billing
notifications
world state
```

才能區分：

```text
Idempotent by arguments
Idempotent by provider key
Deduplicated within TTL
Not idempotent
Unknown
```

---

## 發現 5：Effect Contract 需要「信心值 + 適用域」，不能假裝成絕對 truth

黑箱工具 contract 很難一次完全確定。

因此 Hermes 應把 contract 建模成：

```text
EffectContract
├ tool_identity
├ capability_version
├ schema_hash
├ observations
├ declared_annotations
├ read_footprint
├ write_footprint
├ external_domains
├ idempotency
├ ambiguity_model
├ postconditions
├ compensation
├ latency_distribution
├ consistency_model
├ fault_response_model
├ confidence
└ validity_scope
```

其中 validity_scope 應包含：

```text
argument region
resource class
provider version
time window
auth principal
environment
```

例如：

```text
create_issue
```

對同 repo、同 idempotency key 可能可 dedup；換組織、不同 GitHub App 權限或新版 API 行為後不一定成立。

所以：

```text
Effect Certificate
≠ Eternal Truth
```

而是：

```text
Versioned Evidence-Backed Contract
```

---

# 3. Architecture Breakdown

## Effect Contract Learning Runtime

```text
Unknown Tool / MCP Server
↓
Tool Descriptor Collector
├ name
├ description
├ input schema
├ output schema
├ annotations
├ server identity
└ capability/schema hash
↓
Contract Prior Builder
↓
Safe Sandbox Planner
↓
Probe Generator
├ baseline
├ input perturbation
├ repeated invocation
├ concurrency
├ timeout
├ delayed response
├ corrupt response
└ partial failure
↓
Before-State Observer
↓
Tool Execution
↓
After-State Observer
↓
World-State Diff Engine
↓
Footprint Extractor
├ reads
├ writes
├ creates
├ deletes
├ events
├ network
└ delayed effects
↓
Behavioral Property Learner
├ idempotency
├ commutativity
├ reversibility
├ compensation
├ outcome discoverability
├ consistency delay
└ ambiguous-failure behavior
↓
Fault Injection Harness
↓
Postcondition Discovery
↓
Contract Synthesizer
↓
Contract Verifier
↓
Effect Certificate Registry
↓
Transactional Agent Runtime
```

---

# 4. Bottom-Level Logic

## 4.1 Read / Write Footprint Discovery

對 probe input `x`：

```text
S0 = snapshot(resources)
y  = Tool(x)
S1 = snapshot(resources)
Δ  = Diff(S0, S1)
```

候選 write footprint：

```text
W(x) = changed_resources(S0, S1)
```

但這只找到 observable writes。

還需要 repeated querying 尋找 delayed effects：

```text
S1
S2 = snapshot(t + 1s)
S3 = snapshot(t + 10s)
S4 = snapshot(t + 60s)
```

以發現：

```text
async job
webhook
index refresh
eventual consistency
email delivery
queue mutation
```

因此：

```text
ImmediateWriteSet
≠ TotalEffectSet
```

## 4.2 Idempotency Discovery

定義 observable world projection `P(S)`：

```text
S1 = Tool(x, S0)
S2 = Tool(x, S1)
```

如果：

```text
P(S2) ≈ P(S1)
```

則提供 idempotency evidence。

但 Hermes 還需改變 operation identity：

```text
same args + same idempotency key
same args + new idempotency key
same semantics + reordered JSON
same semantics + equivalent resource identifier
```

以判定真正的 dedup boundary。

## 4.3 Compensation Discovery

如果工具存在 apparent inverse：

```text
create ↔ delete
book ↔ cancel
charge ↔ refund
add_member ↔ remove_member
```

Hermes 不應直接視為 compensation contract。

而要：

```text
Forward
↓
Observe Postcondition A
↓
Candidate Compensation
↓
Observe World
↓
Compare with Pre-State
```

得到：

```text
fully_restored
business_compensated_but_history_remains
financially_settled_later
partially_compensated
not_compensatable
```

## 4.4 Fault-Induced Contract Discovery

```text
Normal Run
↓
Record Tool Response R
↓
Intervention I(R)
├ timeout
├ empty
├ truncate
├ corrupt
├ schema drift
├ stale data
└ delayed response
↓
Replay
↓
Observe Agent + World
↓
Infer Failure Semantics
```

AgentCheck 的 reproduce-intervene-confirm pattern 很適合作為這一層 baseline。

---

# 5. System Architecture 深入拆解：AgentChaos

## Code / GitHub

Repository:

https://github.com/IntelligentDDS/AgentChaos

### 值得看的目錄 / 檔案

```text
scripts/
├ fault_injection.py
├ main_fault_inject.py
├ fault_detect.py
├ parse_trace.py
├ parse_trace_all.py
├ bench_fi_analyze.py
├ bench_fi_overhead.py
├ run_all_eval.py
└ all_RQ*.py
```

### `fault_injection.py` 已確認的底層設計

公開 source 中 `FaultSpec` 包含：

```text
intercept
operation/action
target_path
value
max_count
min_count
probability
description
```

`FaultEngine` 則維護：

```text
fault list
seeded RNG
thread lock
fault log
last response
intercept count
```

並提供 JSON-path-like selector：

```text
jp_get()
jp_set()
```

用於指定 response field。

另外已有：

```text
corrupt JSON values
truncate JSON values
content/tool-call guards
probabilistic fire
delayed onset
max-fire count
```

這值得 Hermes 借鑑為：

```text
Universal Fault Injection Primitive
```

但 Hermes 需要從 LLM API 再擴展到：

```text
MCP request/result
HTTP SaaS
filesystem
DB
browser
computer interaction
queue/event bus
```

### AgentChaos 對 Hermes 的直接價值

AgentChaos 原本回答：

```text
Agent 在 response fault 下有多脆弱？
```

Hermes 應再多問：

```text
這個 fault 告訴我們 tool semantics 的什麼資訊？
```

---

# 6. MCP Effect Metadata：目前能知道什麼、不能知道什麼

## 官方已確認

MCP annotations：

```text
readOnlyHint
= does the tool modify environment?

destructiveHint
= destructive vs additive update

idempotentHint
= repeated same args has no additional effect

openWorldHint
= closed-domain vs external/open-world interaction
```

預設值採保守設計。

但官方明確指出：

```text
Annotations are hints
≠ security guarantee
```

### 目前缺失的 contract vocabulary

Hermes 真正需要的欄位遠多於這四個：

```text
readSet
writeSet
resourceAddressing
effectVisibility
consistencyDelay
ambiguousOutcome
postconditionQuery
idempotencyKey
idempotencyWindow
compensationTool
compensationGuarantee
concurrencySemantics
commutativity
partialFailureModel
rateLimitSemantics
retryAfterSemantics
externalSideEffects
```

因此本輪提出：

# Universal Effect ABI（候選）

```yaml
effect:
  class: COMPENSATABLE_EXTERNAL_EFFECT
  reads:
    - inventory/{sku}
  writes:
    - orders/{order_id}
  emits:
    - payment.authorized
  idempotency:
    mode: provider_key
    key_arg: operation_id
    window: 24h
  visibility:
    mode: eventual
    p95_delay_ms: 2200
  ambiguous_outcome:
    possible: true
  verify:
    tool: get_order
    match:
      operation_id: $operation_id
  compensate:
    tool: cancel_order
    guarantee: business_compensation
  evidence:
    probes: 37
    fault_runs: 18
  confidence: 0.93
```

這不是現行 MCP 官方標準；這是本輪為 Hermes 建立的工程模型。

---

# 7. Visual Simulation Idea

# **Tool Effect Discovery & Fault Injection Lab**

## Panel A：Unknown Tool

```text
Tool: create_order

Declared:
readOnlyHint      false
destructiveHint   false
idempotentHint    true
openWorldHint     true

Status:
UNVERIFIED
```

## Panel B：World-State Differential Viewer

執行前：

```text
orders       24
payments     18
audit_log   912
queue        4
```

執行後：

```text
orders       25   +1
payments     19   +1
audit_log   914   +2
queue        5    +1
```

Hermes 自動提出：

```text
Candidate Effects

CREATE orders/{id}          0.99
CREATE payments/{id}        0.91
APPEND audit_log            0.98
EMIT fulfillment_queue      0.94
```

## Panel C：Idempotency Probe

```text
Call #1
operation_id = K42
→ order #918

Call #2
operation_id = K42
→ order #918

Call #3
operation_id = K43
→ order #919
```

顯示：

```text
Declared idempotentHint   true
Observed evidence         STRONG
Likely dedup boundary     operation_id
Confidence                0.95
```

## Panel D：Fault Injection

使用者切換：

```text
FAULT: timeout_after_dispatch
```

動畫：

```text
Agent ──create_order(K42)──→ Server
                              ↓
                           ORDER CREATED
                              ↓
                         RESPONSE DROPPED

Agent sees:
TIMEOUT
```

再顯示：

```text
Naive Retry
→ duplicate risk

Learned Contract
→ VERIFY get_order(K42)
→ existing order found
→ DO NOT RETRY
```

## Panel E：Contract Evolution

```text
Version 1
IDEMPOTENT? UNKNOWN

Version 2
IDEMPOTENT under same operation_id

Version 3
WARNING:
provider API version changed
schema hash changed

→ RE-CERTIFICATION REQUIRED
```

這能視覺化「AI 如何不是讀 README 猜工具行為，而是像科學實驗一樣測出工具到底做了什麼」。

---

# 8. Papers

## 8.1 AgentChaos

**Title**: AgentChaos: Chaos Engineering for Agent Systems via Programmatic Fault Injection  
**Authors**: Gou Tan, Zhensu Sun, Jieke Shi, Ting Zhang, Zilong He, Qingfu Wu, Shuai Liang, Weifeng Sun, Junda He, Pengfei Chen, Chuanfu Zhang, Lwin Khin Shar, David Lo  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2608.06790  
**Code**: https://github.com/IntelligentDDS/AgentChaos  
**Architecture**: HTTP interception → field-level fault injection → runtime execution → trigger verification → robustness measurement  
**Contribution**: 65 controlled fault configurations, non-intrusive injection, runtime dynamic behavior capture  
**Limitations**: centered on LLM API faults; external-tool effect inference remains outside its main scope  
**改變了什麼**: Fault injection 從 offline benchmark perturbation 變成 live agent runtime intervention surface。

## 8.2 AgentCheck

**Title**: AgentCheck: A Reproduce-Intervene-Mitigate Workbench for LLM Agents over MCP  
**Authors**: Aritra Mazumder, Nusrat Jahan Lia  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2607.11098  
**Architecture**: record clean run → cache MCP outputs → inject targeted fault → replay matching calls → diverged execution returns live → confirm mitigation  
**Contribution**: reproducible MCP failure debugging in real agent setups  
**Limitations**: does not by itself synthesize a generalized formal effect contract  
**改變了什麼**: 將 MCP 工具可靠性問題從一次性的 bug 變成可重播、可干預、可驗證的實驗。

## 8.3 TraceGrant（與本輪的安全 contract 交叉）

**Title**: TraceGrant: A Contract-Governed Security Framework for the Task-Effect Lifecycle of Networked LLM Agents  
**Authors**: Bohao Liao et al.  
**Year**: 2026  
**URL**: https://arxiv.org/abs/2608.21126  
**Architecture**: trusted user request → task-effect contract → admitted runtime evidence → constrained effects → verified completion  
**Contribution**: 把 trusted intent、runtime evidence、tool effects 與 task completion 放進統一 contract lifecycle  
**Limitations**: contract 如何從未知工具行為自動學出，仍與本輪問題不同  
**改變了什麼**: 強化「Effect 本身必須對 trusted task contract 負責」而不是只做 prompt filtering。

---

# 9. 已確認 / 推論 / 尚未驗證

## 已確認事實

1. MCP 官方有 readOnly/destructive/idempotent/openWorld tool annotations。
2. 官方明確說這些 annotations 是 hints，不是可信行為保證。
3. AgentChaos 可在 runtime HTTP layer 對特定 response fields 注入 crash / omission / value faults。
4. AgentChaos 公開 source 實作了 JSON-path targeting、probabilistic firing、delayed onset 與 fault log。
5. AgentCheck 使用 MCP record/replay/intervention 形成 reproduce-intervene-confirm workflow。
6. AgentCheck 報告 retry 對 timeout 很有效，但 stale-data fault 明顯更難修。

## 工程實作推論

1. Hermes 可以把 fault injection 從 reliability testing 升級為 behavioral system identification。
2. world-state differential + repeated probes 可作為 read/write/effect footprint discovery 的主要 baseline。
3. Tool annotations 可以作為 Bayesian-style prior，但不應作為 execution truth。
4. Contract 應帶 confidence、scope 與 version，而不是 boolean truth。

## 尚未驗證假說

1. 對多數 SaaS/MCP 工具，可否僅靠 black-box probes 學到足以安全交易化執行的 effect contract？
2. 如何低成本觀測「無法 snapshot」的 external side effects，例如 email、webhook、physical action？
3. 如何區分 genuine read dependency 與只是工具 execution 過程中碰巧讀到的 resource？

---

# 10. Unknown / Open Questions 1–3

## 1. Read-set 如何自動證明？

Write-set 通常可從 before/after diff 找到；read-set 困難得多。

需要：

```text
resource perturbation
→ same tool call
→ output/effect change?
```

才能建立：

```text
Resource R causally influences Tool T
```

因此下一階段需加入 causal perturbation。

## 2. Probe 本身怎麼保證安全？

探索陌生工具時，如果它其實是 destructive / financial / physical effect，不能直接在 production trial-and-error。

需要：

```text
sandbox
shadow account
synthetic resource
provider test mode
approval gate
hard spend/effect caps
```

Effect discovery 本身也必須受 capability system 約束。

## 3. Tool behavior drift 如何被發現？

即使 contract 今天正確：

```text
server code update
API version change
schema drift
permission change
feature flag
```

都可能讓它失效。

因此 Effect Certificate 必須有：

```text
schema_hash
server_version
capability_hash
last_verified_at
expiry
re-certification trigger
```

---

# 11. Knowledge Graph 新增 Node / Edge

## 新 Nodes

```text
Automatic Effect Inference
Effect Contract Learning
Tool Behavioral Profiling
Declared Effect Hint
Observed Effect
Verified Effect
Effect Annotation Conflict
Read Footprint
Write Footprint
Delayed Effect
Indirect Effect
World-State Differential
Behavioral Probe
Probe Input
Probe Environment
Idempotency Probe
Deduplication Boundary
Retry Contract
Ambiguous Outcome Model
Outcome Discoverability
Consistency Delay
Postcondition Discovery
Compensation Discovery
Fault Injection Surface
Fault Intervention
Fault Trigger Verification
Effect Contract Confidence
Effect Contract Validity Scope
Effect Certificate
Effect Recertification
Tool Behavior Drift
Universal Effect ABI
```

## 新 Edges

```text
ToolAnnotation --PROPOSES→ EffectClaim
BehavioralProbe --TESTS→ EffectClaim
StateDiff --SUPPORTS→ WriteFootprint
ResourcePerturbation --TESTS→ ReadDependency
FaultIntervention --REVEALS→ FailureSemantics
RepeatedInvocation --TESTS→ Idempotency
TimeoutAfterDispatch --TESTS→ AmbiguousOutcome
VerificationQuery --RESOLVES→ EffectTruth
SchemaChange --INVALIDATES→ EffectCertificate
CapabilityVersionChange --TRIGGERS→ EffectRecertification
EffectContract --GOVERNS→ TransactionalToolExecution
```

## 新的否定關係

```text
Tool Annotation ≠ Effect Truth
Declared Idempotent ≠ Verified Idempotent
Same Arguments ≠ Same Logical Operation
No Immediate Diff ≠ No Side Effect
Write-Set Discovery ≠ Read-Set Discovery
Retryable Transport Error ≠ Safe Effect Retry
Fault Injection ≠ Only Robustness Testing
Observed Idempotency ≠ Universal Idempotency
Compensation Candidate ≠ Valid Compensation
Schema Stability ≠ Behavioral Stability
Effect Certificate ≠ Eternal Truth
Sandbox Success ≠ Production Equivalence
```

---

# 12. 下一輪研究

下一輪最值得深入：

# **Causal Read-Set Discovery × Resource Perturbation × Tool Behavior Drift × Contract Recertification**

目前已可形成：

```text
Tool
↓
Declared annotations
↓
Behavioral probes
↓
State diff
↓
Write/effect footprint
↓
Retry/idempotency/fault profile
↓
Effect Contract
```

但最難的還是：

```text
它到底「讀了什麼」？
哪些 resource 真正影響 decision/effect？
```

下一輪應建立：

```text
Candidate Resource
↓
Controlled Perturbation
├ remove
├ mutate
├ stale version
├ permission deny
└ substitute
↓
Same Tool Invocation
↓
Compare
├ output
├ side effect
├ latency
├ selected branch
└ postcondition
↓
Causal Read Dependency
↓
Read-Set Certificate
↓
Behavior Drift Monitor
↓
Automatic Re-certification
```

並研究 metamorphic testing、causal testing、differential testing、contract testing、API fuzzing 與 stateful protocol inference 如何映射到 Agent/MCP 工具。

---

# 13. 本輪結束回答

**缺哪一層？**  
最缺的是 **Causal Read-Set / Resource Dependency Discovery**。Write effect 相對容易觀測，但「工具究竟依賴哪些世界狀態」仍很難可靠推斷。

**哪個節點最淺？**  
`EffectContractConfidence`。目前可以用 probe count / cross-run consistency 建 baseline，但尚未有校準良好的統計 confidence model。

**哪個概念仍只是名詞？**  
`Universal Effect ABI`、`EffectCertificate`、`ReadSetCertificate`、`BehavioralEquivalenceScope` 尚未形成正式 interoperable standard。

**哪個系統最值得讀原始碼？**  
`IntelligentDDS/AgentChaos`，優先 `scripts/fault_injection.py`、`main_fault_inject.py`、`fault_detect.py`、`parse_trace.py`；再追 AgentCheck MCP intervention / replay implementation。

**哪篇論文需追引用？**  
AgentCheck → AgentChaos → Verified Tool Calls / semantic transaction / TraceGrant 這條線最重要，因為可連成「測試 → 行為學習 → 安全執行 → task-effect contract」。

**哪個概念最適合視覺模擬？**  
**Tool Effect Discovery & Fault Injection Lab**：尤其是「Declared Annotation vs Observed Behavior」、「Before/After world diff」、「Timeout after dispatch」、「same-key retry vs new-key retry」四個互動視圖。

**哪個 Agent 架構最值得實作？**  

> **Self-Certifying Tool Runtime = Tool Descriptor Collector + Contract Prior Builder + Safe Probe Sandbox + World-State Differential Engine + Read/Write Footprint Learner + Idempotency/Retry Probe Engine + Fault Injection Harness + Postcondition/Compensation Discovery + Versioned Effect Certificate + Transactional Execution Gate**

---

# 本輪核心結論

過去 Agent 通常把工具理解成：

```text
name + description + JSON schema
```

但可靠 Agent 真正需要理解的是：

```text
Tool
=
Interface
+
World-State Transition
+
Read Dependencies
+
Write Footprint
+
Failure Semantics
+
Idempotency Boundary
+
Verification Strategy
+
Compensation Strategy
+
Evidence / Confidence / Version
```

也就是：

> **AI 不應只「相信工具說自己會做什麼」，而要能像測試一個未知系統一樣，安全地實驗、觀察、注入故障、比較世界狀態，最後建立一份有證據、有適用域、會過期、能重新驗證的 Effect Contract。**

這補上了從：

```text
UI
→ Agent
→ Context
→ Reasoning
→ Planning
→ Memory
→ Tool Selection
→ MCP
```

到真正外部世界前非常關鍵的一層：

```text
→ Tool Semantics Discovery
→ Effect Contract
→ Safe Transactional Execution
→ Verified World-State Change
```
