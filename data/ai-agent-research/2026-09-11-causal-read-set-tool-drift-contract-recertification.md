# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-11 19:54（Asia/Taipei）  
**本輪主題**：Causal Read-Set Discovery × Resource Perturbation × Tool Behavior Drift × Contract Recertification × Behavioral Fingerprinting

---

## 0. 與歷史研究比較：本輪沒有重做什麼

上一輪已建立：

```text
Unknown Tool
→ Schema / Description / MCP Annotations
→ Contract Prior
→ Safe Probe
→ Before-State Snapshot
→ Invocation
→ After-State Snapshot
→ World-State Diff
→ Retry / Idempotency Probe
→ Fault Injection
→ Postcondition / Compensation Discovery
→ Versioned Effect Certificate
```

上一輪最強的是 **write/effect discovery**：工具改了哪些 state、timeout 後 effect 是否已發生、retry 是否安全。

但它仍有兩個重要缺口：

1. **Write-set 容易觀測，Read-set 很難。** 一個 tool 可能讀了 profile、policy、inventory、memory、remote feature flag，但執行後完全沒有對這些來源留下可見 diff。
2. **一份正確的 Effect Contract 會過期。** schema 不變、tool name 不變，實際 ranking、threshold、model、remote dependency、tool description 或 server capability 都可能漂移。

因此本輪不再重做 world-state diff，而是專攻：

> **如何用 controlled perturbation 建立 causal read-set，並用 runtime drift signals 自動決定何時使 Effect Certificate 失效、隔離與重新認證。**

---

# 1. 本小時新發現（新論文 / 新架構 / 新框架 / 新 GitHub / 新模型）

## 新論文 / 新研究

### 1. Memory-Induced Tool-Drift in LLM Agents
- Authors: Mahavir Dabas, Jihyun Jeong, Ming Jin, Ruoxi Jia
- Year: 2026
- URL: https://arxiv.org/abs/2605.24941
- Dataset / Benchmark: MEMDRIFT，105 scenarios、5 bias dimensions、7 professional domains
- Real tool scan: 6,062 tools / 288 verified MCP servers，608 個 tool 被標示具有 susceptible parameters
- Contribution: 顯示長期記憶中的 personality/bias 會在不相關 task 中改變 tool-call parameters；偏差 memory 在 activation space 中可作為 implicit steering vector，並把 attention 從 task-relevant context 拉向表面關鍵字相似的 memory。
- Limitation: 研究重點是 memory-induced parameter drift，並不是一般化的 server-side behavior drift detector。

### 2. AgentDrift: Unsafe Recommendation Drift Under Tool Corruption Hidden by Ranking Metrics in LLM Agents
- Authors: Zekun Wu, Adriano Koshiyama, Sahan Bulathwela, Maria Perez-Ortiz
- Year: 2026
- URL: https://arxiv.org/abs/2603.12564
- Architecture: paired clean/contaminated trajectories + persistent memory + multiple tools
- Contribution: standard utility/ranking metric 可以保持接近正常，但 safety violations 已經大幅上升；工具污染造成的 drift 可以沿 trajectory 持續存在。
- Limitation: benchmark 聚焦金融 recommendation，而不是 general MCP contract recertification。

### 3. Formal Semantics for Agentic Tool Protocols: A Process Calculus Approach
- Year: 2026
- URL: https://www.emergentmind.com/papers/2603.24747
- Contribution: 將 schema-guided tool protocols 與 MCP 放入 process-calculus formalization；指出完整 behavioral equivalence 需要 semantic completeness、explicit action boundaries、failure mode documentation、progressive disclosure compatibility、inter-tool relationship declaration。
- Limitation: formal equivalence 不等於真實 server behavior 已被 runtime 驗證。

## 新官方協議能力

### MCP 2026-07-28 `subscriptions/listen`
官方 TypeScript SDK / protocol 已支援：

```text
subscriptions/listen
├ toolsListChanged
├ promptsListChanged
├ resourcesListChanged
└ resourceSubscriptions
```

收到：

```text
notifications/tools/list_changed
```

之後 client 可重新 `tools/list`。

這是本輪非常重要的 recertification trigger：**Tool contract 不應只是 TTL-based refresh，而應 event-driven invalidation。**

官方來源：
- https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
- https://modelcontextprotocol.io/specification/draft/server/tools

---

# 2. 本小時最重要 5 個發現

## 發現 1：Write Footprint ≠ Read Footprint

### 是什麼

對一個 unknown tool：

```text
S0
↓ tool(x)
S1
↓
Diff(S0,S1)
```

可以找到很多 write effects；但如果 tool 只是讀某 resource 來決定 output，resource 本身完全不會變。

### 底層如何運作

真正的 read-set discovery 應使用 causal perturbation：

```text
Candidate Resource R
↓
baseline tool invocation
↓
outcome Y0

R := perturb(R)
↓
same logical invocation
↓
outcome Y1

Compare(Y0, Y1)
```

如果在控制其他條件後：

```text
Y0 != Y1
```

才有證據支持：

```text
R --CAUSES/INFLUENCES→ ToolOutcome
```

### 為什麼重要

Read-set 是 TOCTOU、cache invalidation、selective plan repair、dependency closure、memory retention 與 contract recertification 的共同底座。

### 限制

沒有變化不代表沒有讀；工具可能對該 perturbation 不敏感、存在 threshold、fallback、cache 或 redundant source。

### 結論

```text
No Output Change
≠
Resource Was Not Read
```

---

## 發現 2：Causal Read Dependency 必須由「單一 perturbation」升級成 intervention matrix

只做：

```text
remove R
```

太脆弱。

Hermes 應對每個 candidate resource 建立：

```text
InterventionMatrix(R)
├ REMOVE
├ NULL
├ STALE_VERSION
├ VALUE_SHIFT_SMALL
├ VALUE_SHIFT_LARGE
├ TYPE_VALID_BUT_SEMANTICALLY_WRONG
├ PERMISSION_DENIED
├ DELAYED
├ ALTERNATE_SOURCE
└ CONSISTENT_REDUNDANT_COPY
```

然後觀察：

```text
ToolOutput
ToolArguments downstream
Selected branch
External side effect
Latency
Retry path
Error class
Confidence
```

這會區分：

```text
Hard Dependency
Soft Dependency
Fallback Dependency
Threshold Dependency
Redundant Dependency
Latency Dependency
Permission Dependency
```

而不是只存：

```text
READS = true/false
```

---

## 發現 3：Tool Behavior Drift 可以在 schema 完全不變時發生

Memory-Induced Tool-Drift 顯示，tool parameter selection 本身可在相同 tool surface 下被 memory steering 改變；AgentDrift 則顯示 clean/contaminated information channels 能造成 trajectory-level unsafe divergence，而一般品質 metric 仍看起來正常。

因此 Hermes 要區分至少四種 drift：

```text
Schema Drift
Description Drift
Implementation Drift
Behavioral / Decision Drift
```

再加兩個 agent-side drift：

```text
Memory-Induced Invocation Drift
Model-Induced Invocation Drift
```

重要否定關係：

```text
Same Tool Name ≠ Same Capability
Same Schema ≠ Same Semantics
Same Semantics ≠ Same Agent Usage
Same Output Shape ≠ Same Safety Behavior
```

---

## 發現 4：MCP `tools/list_changed` 應成為 Certificate Invalidation Event

MCP 2026-07-28 已把 list-change notifications 納入 `subscriptions/listen`。

Hermes 不應只是：

```text
每 24 小時重新掃描
```

而應：

```text
subscriptions/listen
↓
notifications/tools/list_changed
↓
Fetch tools/list
↓
Canonicalize descriptors
↓
Compare:
  name
  description
  inputSchema
  outputSchema
  annotations
  auth-dependent availability
↓
DescriptorHash changed?
↓ YES
Certificate → STALE
↓
Selective Recertification
```

但要注意：

```text
No list_changed
≠
Behavior unchanged
```

server-side dependency、remote model、ranking algorithm、feature flag 仍可能無聲改變。

所以需要 event-driven + scheduled + anomaly-triggered 三層 recertification。

---

## 發現 5：Recertification 應由 behavioral fingerprint 驅動，不只 hash 驅動

Hermes 應保存每個 tool 的 behavioral fingerprint：

```text
ToolBehaviorFingerprint
├ descriptor_hash
├ capability_manifest_hash
├ typical call-shape
├ argument distribution
├ output-shape distribution
├ latency distribution
├ error distribution
├ read-set signature
├ write-set signature
├ effect class
├ idempotency signature
├ consistency-delay profile
└ canary/probe outcomes
```

當 fingerprint 漂移：

```text
Baseline B
Current C
↓
Drift(B,C)
```

不應直接永久封鎖，而是分級：

```text
INFO
REVERIFY
QUARANTINE
REVOKE_CERTIFICATE
```

這比只比較 JSON schema 更接近 Agent 真正需要的「tool identity」。

---

# 3. Architecture Breakdown

## Causal Read-Set & Contract Recertification Runtime

```text
                    ┌────────────────────────────┐
                    │ MCP subscriptions/listen   │
                    │ tool/resource change event │
                    └─────────────┬──────────────┘
                                  │
Tool Descriptor ──────────────────┼───────┐
                                  │       │
Runtime Telemetry ────────────────┼───────┤
                                  │       ▼
Historical Effect Certificate ────┼→ Drift Detector
                                  │       │
                                  │       ▼
                                  │ Recertification Planner
                                  │       │
                                  └───────┼───────────────┐
                                          ▼               │
                                Candidate Resource Graph   │
                                          │               │
                                          ▼               │
                                Intervention Generator     │
                                ├ remove                  │
                                ├ mutate                  │
                                ├ stale                   │
                                ├ deny                    │
                                ├ delay                   │
                                └ substitute              │
                                          │               │
                                          ▼               │
                                Sandbox / Shadow Runtime  │
                                          │               │
                                          ▼               │
                                Same Logical Tool Call    │
                                          │               │
                                          ▼               │
                                Differential Observer     │
                                ├ output                  │
                                ├ arguments downstream    │
                                ├ external effect         │
                                ├ branch                  │
                                ├ latency                 │
                                └ errors                  │
                                          │               │
                                          ▼               │
                               Causal Read-Set Learner     │
                                          │               │
                                          ▼               │
                               Behavioral Fingerprint      │
                                          │               │
                                          ▼               │
                               Contract Verifier           │
                                          │               │
                         ┌────────────────┴─────────────┐ │
                         ▼                              ▼ │
                   RECERTIFIED                      QUARANTINE
                         │                              │
                         └────────→ Certificate Registry
```

---

# 4. Bottom-Level Logic

## 4.1 Read dependency score

對 resource `r` 與 tool outcome `y`：

```text
D_read(r → y)
=
E_i [ Distance(
  Outcome(do(r = baseline)),
  Outcome(do(r = intervention_i))
) ]
```

再依 intervention coverage、repeatability、noise 做 confidence calibration：

```text
ReadDependencyConfidence
=
EffectMagnitude
× Repeatability
× InterventionCoverage
× EnvironmentControl
× IdentityStability
```

不能把單次差異直接升級成 causal truth。

---

## 4.2 Partial read-set

真實工具常見：

```text
if premium_user:
    read premium_policy
else:
    read default_policy
```

所以應保存 conditional read edge：

```text
Tool --READS_IF(condition)→ Resource
```

而不是 global edge。

這讓 read-set 變成：

```text
ReadSet(tool, args, principal, environment, version)
```

而不是：

```text
ReadSet(tool)
```

---

## 4.3 Recertification state machine

```text
CERTIFIED
   │
   ├ descriptor hash changed
   ├ list_changed event
   ├ fingerprint drift
   ├ anomaly spike
   ├ remote dependency changed
   ├ model/provider changed
   └ certificate TTL expired
   ▼
STALE
   ▼
PROBING
   ├ matches baseline → RECERTIFIED
   ├ benign extension → CERTIFIED_NEW_VERSION
   ├ ambiguous → QUARANTINE
   └ unsafe change → REVOKED
```

---

# 5. Visual Simulation Idea

## **Causal Read-Set & Tool Drift Lab**

### Scene A：找出 Tool 到底讀了什麼

```text
create_shipping_quote

Candidate resources:
[customer_profile]   ?
[inventory]          ?
[weather]            ?
[premium_policy]     ?
[currency_rate]      ?
```

按：

```text
RUN INTERVENTION MATRIX
```

畫面動態顯示：

```text
customer_profile
  remove      → price changes 18%
  stale       → price changes 11%
  substitute  → price changes 21%

READ DEPENDENCY: HIGH
```

```text
weather
  remove      → fallback source used
  stale       → ETA changes

READ DEPENDENCY: CONDITIONAL
```

```text
inventory
  perturb     → no observed change

STATUS:
UNRESOLVED
(not "NOT READ")
```

### Scene B：Tool Drift

```text
create_shipping_quote@Certificate-v12

Baseline fingerprint
████████████████

Current fingerprint
██████████░░░░░░

Drift:
description        unchanged
schema             unchanged
latency            +4%
read-set           +premium_policy
price distribution +19%

→ BEHAVIORAL DRIFT
→ RECERTIFY
```

### Scene C：MCP live invalidation

```text
subscriptions/listen
        ↓
tools/list_changed
        ↓
create_shipping_quote
Certificate v12 → STALE
        ↓
Selective probes
        ↓
Certificate v13
```

這個視覺模擬能直接回答：

> **同一個 tool 看起來完全沒改，Hermes 為什麼仍然判斷它已經不是「同一個行為契約」？**

---

# 6. Code / GitHub

## 深入：Model Context Protocol TypeScript SDK

Repository：
https://github.com/modelcontextprotocol/typescript-sdk

本輪值得看的路徑：

```text
packages/server/src/server/serverEventBus.ts
examples/subscriptions/server.ts
examples/guides/clients/subscriptions.examples.ts
docs/servers/notifications.md
docs/migration/support-2026-07-28.md
test/e2e/scenarios/subscriptions.test.ts
packages/server/test/server/createMcpHandlerListen.test.ts
```

`serverEventBus.ts` 中的 notifier 實作包含：

```text
toolsChanged()
promptsChanged()
resourcesChanged()
resourceUpdated(uri)
```

並由 event bus publish typed change events。

`examples/subscriptions/server.ts` 則展示 HTTP handler 與 stdio pinned server 如何把 tool-list change fan-out 到 `subscriptions/listen` streams。

這對 Hermes 的直接工程意義：

```text
MCP Event Bus
→ Certificate Invalidation Bus
```

不需要另造一套 disconnected watcher。

---

# 7. Papers / Evidence Classification

## 已確認官方資訊

1. MCP tools list 可變更，server 能宣告 `listChanged`。
2. 2026-07-28 revision 中，change notifications 經 `subscriptions/listen` 流傳送。
3. client 接到 tool list change 後可重新列舉 tools。

## 論文結果

1. Memory-induced tool drift：memory bias 可以改變不相關 task 的 tool-call parameters。
2. AgentDrift：tool information corruption 可造成持續 safety drift，而一般 ranking-quality metric 可能看不出來。

## 工程實作

1. MCP TypeScript SDK 已有 event bus + subscriptions implementation。
2. Behavioral fingerprinting / agent drift monitoring 已成為 2026 工具生態中的獨立層，但第三方產品 claim 應視為工程實作資訊，不視為學術證明。

## 合理推論

1. `tools/list_changed` 非常適合用作 certificate invalidation trigger。
2. Effect Certificate 應從「工具版本文件」升級成「descriptor + causal read/write behavior + runtime fingerprint」的複合身份。

## 尚未驗證假說

1. Controlled perturbation 是否能在高比例 real-world SaaS tools 上低成本恢復 useful causal read-set。
2. 是否能用少量 adaptive probes 取代 combinatorial intervention matrix。
3. 多層 cache / remote hidden dependency 下，如何估 read-set false negative rate。

---

# 8. Unknown / Open Questions

## 1. Hidden remote read 怎麼證明？

Tool A 可能呼叫 Provider B，Provider B 再查 DB C。

Hermes 若只能觀察 A 的 input/output，最多學到 behavioral dependency，不能直接宣稱 physical read provenance。

需要區分：

```text
Observed Behavioral Read Dependency
vs
Verified Physical Read Dependency
```

## 2. 如何避免 perturbation 本身改變 execution path 太多？

例如 remove profile 讓 tool 直接 early-error，就無法知道正常路徑中它使用了 profile 的哪些欄位。

需要 local / minimal intervention 與 causal mediation 分析。

## 3. Tool drift 與 environment drift 如何分離？

如果 outcome changed：

```text
Tool implementation changed?
Remote data changed?
Model changed?
Memory changed?
Prompt changed?
Policy changed?
```

Hermes 需要多版本 identity vector 才能做 attribution。

---

# 9. Knowledge Graph 新增 Node / Edge

## Nodes

```text
Causal Read-Set
Read Dependency
Conditional Read Dependency
Observed Behavioral Read
Verified Physical Read
Resource Intervention
Intervention Matrix
Read Dependency Confidence
Tool Behavior Drift
Descriptor Drift
Implementation Drift
Semantic Drift
Invocation Drift
Memory-Induced Tool Drift
Behavioral Fingerprint
Contract Recertification
Certificate Invalidation Event
Tool List Changed Event
Drift Attribution
Probe Coverage
Hidden Remote Dependency
Recertification State Machine
```

## Edges

```text
Tool --READS_IF→ Resource
ResourceIntervention --TESTS→ ReadDependency
ReadDependency --CONTRIBUTES_TO→ EffectContract
MCPToolListChanged --INVALIDATES→ EffectCertificate
BehavioralFingerprint --DETECTS→ ToolBehaviorDrift
ToolBehaviorDrift --TRIGGERS→ Recertification
Memory --CAN_STEER→ ToolArguments
RemoteDependency --CAN_DRIFT_WITHOUT→ SchemaChange
Certificate --VALID_FOR→ ToolIdentityVector
```

## 否定關係

```text
Write Footprint ≠ Read Footprint
No Output Change ≠ Resource Not Read
Same Tool Name ≠ Same Tool Behavior
Same Schema ≠ Same Semantics
Same Output Shape ≠ Same Safety Behavior
Descriptor Hash Stable ≠ Behavior Stable
MCP list_changed Absent ≠ No Drift
Observed Read Dependency ≠ Physical Read Provenance
Single Perturbation ≠ Causal Proof
Certificate Valid Yesterday ≠ Certificate Valid Now
```

---

# 10. 下一輪研究

下一輪最重要缺口：

# **Adaptive Causal Probing × Black-Box System Identification × Minimal Intervention × Hidden Dependency Attribution**

目前 intervention matrix 如果對：

```text
100 resources
× 10 perturbations
× 5 repeats
```

就要 5,000 次 tool invocations，對昂貴 SaaS、physical tool、付費 API、慢速 MCP 完全不可行。

下一輪應研究：

```text
Candidate Resource Graph
↓
Information Gain Estimator
↓
Choose Most Informative Intervention
↓
Probe
↓
Bayesian / Causal Belief Update
↓
Next Probe
↓
Stop when confidence sufficient
↓
Minimal Read-Set Certificate
```

並深入：

- active learning
- Bayesian experimental design
- causal bandits
- black-box system identification
- delta debugging
- metamorphic testing
- invariant mining
- counterfactual explanation
- hidden mediator detection
- remote dependency attribution

---

# 11. 本輪結束回答

**缺哪一層？**  
Adaptive Causal Probing：目前 causal read-set 可定義，但 exhaustive intervention 太昂貴。

**哪個節點最淺？**  
`ReadDependencyConfidence`：尤其 hidden remote dependency、cache、fallback 情境的 calibration 還不足。

**哪個概念仍只是名詞？**  
`MinimalReadSetCertificate`、`ToolIdentityVector ABI`、`RecertificationCertificate`、`DriftAttributionScore`。

**哪個系統最值得讀原始碼？**  
Model Context Protocol TypeScript SDK 的 subscriptions/event-bus implementation，因為它可以直接成為 Hermes contract invalidation 的 runtime signal backbone。

**哪篇論文需追引用？**  
優先追 `Memory-Induced Tool-Drift in LLM Agents`，再追 AgentDrift 的 paired-trajectory / contamination literature，因為它們補足「schema 不變但 agent/tool behavior 已漂移」這一層。

**哪個概念最適合視覺模擬？**  
`Causal Read-Set & Tool Drift Lab`。

**哪個 Agent 架構最值得實作？**  

> **Self-Recertifying Tool Runtime = MCP Change Subscription + Tool Identity Vector + Candidate Resource Graph + Causal Intervention Engine + Read/Write Footprint Learner + Behavioral Fingerprint Monitor + Drift Attribution + Event/Anomaly/TTL Recertification Planner + Versioned Effect Certificate Registry + Transactional Execution Gate**

---

# 12. 本輪最重要的底層推進

上一輪讓 Hermes 學會：

> 「我不能只相信 tool description；我要實驗它實際改了什麼。」

本輪再往下一層：

> **「工具沒有改某個 resource，不代表它沒有依賴它；我必須透過 controlled intervention 去找出它真正讀了哪些 state。同時，一份今天驗證正確的 tool contract 也不能永久信任，我必須持續監控它的 descriptor、runtime behavior 與依賴結構，並在 drift 發生時自動失效與重新認證。」**

這讓 Hermes 的工具模型從一次性 `Effect Discovery`，開始進化成 **持續、自我驗證、自我失效、自我重新認證的 Tool Behavior Model**。