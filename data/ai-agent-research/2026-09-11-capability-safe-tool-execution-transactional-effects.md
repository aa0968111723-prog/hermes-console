# 【AI Agent × Multimodal Research Report】

**時間**：2026-09-11 16:51（Asia/Taipei）  
**本輪主題**：Capability-Safe Tool Execution × Least Privilege × Task-Scoped Authorization × Transactional Side Effects × Commit/Abort/Compensation

---

## 0. 與歷史研究比較：本輪新增了什麼？

前幾輪已建立：

```text
Semantic Taint
→ Control Influence
→ Semantic Reference Monitor
→ ALLOW / VERIFY / REWRITE / DENY
```

但仍有一個 execution-layer 缺口：**即使判斷某個 tool call「允許」，Agent 到底拿到多大的權限？副作用何時真正外部化？失敗時怎麼撤回？多步 workflow 中 losing/speculative branch 已經做出去的事情怎麼處理？**

本輪因此從「是否允許」推進到：

```text
User Intent
↓
Task-Specific Authority Derivation
↓
Minimal Capability
↓
Argument / Resource Constraints
↓
Effect Classification
↓
Preview / Prepare
↓
Transaction Epoch
↓
Commit Gate
├ COMMIT
├ ABORT
└ COMPENSATE
↓
Postcondition Verification
↓
Capability Revocation
↓
Audit / Provenance
```

本輪核心新結論：

> **Authorization ≠ Safe Execution。**
>
> 安全 Agent 需要同時回答四個問題：
> 1. 這個動作是否被使用者意圖授權？
> 2. Agent 是否只拿到完成這一步所需的最小能力？
> 3. 副作用是否在「可以安全 commit」之前被延後或隔離？
> 4. 如果已外部化，是否存在可驗證的 compensation / recovery path？

---

# 1. 本小時新發現

## 新論文 / 新架構 / 新 Runtime

### A. PAuth — Precise Task-Scoped Authorization For Agents
- **Authors**：Reshabh K Sharma, Linxi Jiang, Zhiqiang Lin, Shuo Chen
- **Institution**：Microsoft Research / academic collaborators（官方 Microsoft Research publication page）
- **Year**：2026
- **URL**：https://arxiv.org/abs/2603.17170
- **Official publication page**：https://www.microsoft.com/en-us/research/publication/pauth-precise-task-scoped-authorization-for-agents/
- **Architecture**：Natural-language task → imperative representation → per-service NL slice → signed provenance envelopes → server-side deterministic authorization check
- **Contribution**：從 OAuth 類 operator-scoped permission，改成 task-scoped concrete-operation authorization；不只驗證 tool/operator，還驗證 operand 與 operand provenance。
- **Dataset / Benchmark**：AgentDojo-based benchmark；論文摘要報告 benign 與 injected unauthorized-operation scenarios。
- **Limitation**：依賴 task interpretation / code generation 正確性；對長期、多輪、模糊 intent 與 task mutation 的授權更新仍是核心難題。

### B. HCP — Handle-Capability Protocol
- **Paper**：From Tool Connection to Execution Control: Benchmarking Security Invariants in MCP-Style Agent Runtimes
- **Year**：2026
- **URL**：https://arxiv.org/abs/2606.29073
- **Code**：https://github.com/SymbolicLight-AGI/handle-capability-protocol
- **Architecture**：Principal → Grant → Capability → Resource/Handle → Policy Decision → Invocation / Data Pipe → Audit
- **Contribution**：把 MCP-style tool connection 提升成 execution-control runtime；定義 metadata non-authority、grant-backed approval、principal binding、scoped capability invocation、source/target data-flow authorization、deny-path audit 等 invariants。
- **Limitations**：公開 runtime README 明確指出目前 grants/handles/tasks/audit 主要仍是 memory-based reference implementation，尚未包含完整 production JWT/capability tokens、persistent storage、distributed registry、multi-tenant isolation 與完整 enterprise policy language。

### C. Atomix — Timely, Transactional Tool Use for Reliable Agentic Workflows
- **Authors**：Bardia Mohammadi, Nearchos Potamitis, Lars Klein, Akhil Arora, Laurent Bindschaedler
- **Year**：2026
- **URL**：https://arxiv.org/abs/2602.14849
- **Architecture**：tool call epoch tagging → per-resource frontier → progress predicate → delayed/buffered effect commit；已 externalized effect 以 compensation 處理 abort。
- **Contribution**：把 database/distributed transaction 的概念帶到 Agent tool execution，處理 failure、speculative execution、retry 與 contention 下的副作用外洩。
- **Limitation**：不是所有 side effect 都可真正 rollback；compensation 是語義上的反向操作，不等同 physical rollback。

### D. Task-Conditioned Least-Privilege Learning for Executable Terminal and MCP Agents
- **Authors**：Alexander Tu, Michael Tu
- **Year**：2026
- **URL**：https://arxiv.org/abs/2608.18351
- **Architecture**：task-specific sufficient-authority envelope + deterministic pre/post action audit + post-training for learned restraint
- **Contribution**：顯示 least privilege 不只能靠 runtime gate，也能作為 policy learning objective；但作者同時明確指出 learned restraint **不能取代** sandbox / permission gates。
- **Reported result**：摘要報告 selected seed 在 held-out evaluation 達 98.48% safe success，base policy 64.36%；excess-authority events 從 4.56% 降到 0.79%。
- **Limitation**：task-specific authority envelope 仍需有可信的 ground truth / deterministic verifier。

### E. OpenAI Agents SDK Tool Guardrails（官方工程實作）
- **URL**：https://openai.github.io/openai-agents-js/guides/guardrails/
- **Confirmed behavior**：function tools 與 local MCP-converted tools 可設 input/output tool guardrails；input guardrail 可在 execution 前 reject / tripwire；human approval 與 guardrail 可組合。
- **Important limitation**：官方文件指出 hosted MCP、hosted tools，以及 built-in computer/shell/apply-patch execution paths 並不全部走相同 tool-guardrail pipeline；因此 guardrail coverage 必須被視為 runtime topology 問題，而不是「有裝 guardrail 就全部安全」。

### F. MCP 2026-07-28 Authorization 更新（官方）
- **URL**：https://blog.modelcontextprotocol.io/posts/2026-07-28/
- **Confirmed**：2026-07-28 specification 改進 OAuth/OpenID Connect alignment，包括 issuer validation 與 credential issuer binding；這強化 connection/auth identity layer。
- **Important distinction**：OAuth/MCP authorization 解決「誰可以連/使用某 server」，但不天然等於「這個具體 task 是否授權 transfer 100 給 Bob，而不是 1000 給 Eve」。這正是 PAuth/HCP 類 execution layer 要補的洞。

---

# 2. 本小時最重要 5 個發現

## 發現 1：OAuth Scope ≠ Task-Specific Authority

### 是什麼
典型 permission：

```text
bank.transfer
email.send
filesystem.write
calendar.delete
```

仍然太粗。

使用者真正授權的通常是：

```text
transfer(
  from = Chase,
  to = Bob,
  amount = 100,
  before = 18:00
)
```

而不是：

```text
ANY bank.transfer(*, *, *)
```

### Bottom-level mechanism
PAuth 的關鍵拆解：

```text
User NL Task
↓
Task Program / Symbolic Representation
↓
Per-Service Slice
↓
Expected Operator
+ Expected Operands / Symbolic Expressions
+ Path Conditions
↓
Runtime Tool Call
↓
Signed Envelope Verification
↓
Concrete Operand ↔ Symbolic Provenance Match
↓
AUTHORIZED / DEVIATION
```

如果 amount 是由上游 balance 計算而來：

```text
amount = balance / 4
```

Agent 不能自行把 amount 改成其他值；server 可利用 provenance envelope 驗證 concrete value 是否真的是合法 upstream computation 的結果。

### 為什麼重要
這把 least privilege 從：

```text
Tool-level privilege
```

推進到：

```text
Operation-instance privilege
```

### 限制
NL task 如果本身模糊，task-scoped authorization 也會變模糊。因此最終必須有：

```text
Intent Clarification
→ Intent Version
→ Capability Re-Derivation
```

而不能把第一次解析永久當成 authority truth。

---

## 發現 2：Approval ≠ Grant；Tool Metadata ≠ Authority

HCP 最值得 Hermes 採用的不是 protocol 名字，而是 runtime object model：

```text
Principal
Resource
Grant
Capability
Handle
Policy Decision
Task
Approval
Audit Entry
```

一個高風險操作就算拿到 approval，也不能越過 grant。

```text
Approval
AND
Grant
AND
Principal Binding
AND
Resource Match
AND
Capability Scope
AND
Policy
→ executable
```

因此：

```text
Human clicked Approve
≠ unlimited authority
```

同理：

```text
Tool description says "safe"
≠ permission
```

這和上一輪 Semantic Taint 結論直接接起來：

```text
Metadata Plane
不能直接產生 Authority Edge
```

### Hermes 應新增的 runtime primitive

```text
CapabilityGrant {
  principal,
  task_id,
  capability_id,
  resources[],
  operation_constraints,
  argument_constraints,
  expires_at,
  max_uses,
  side_effect_class,
  approval_requirement,
  provenance_root
}
```

---

## 發現 3：ALLOW Tool Call ≠ Side Effect 應立即發生

這是本輪最重要的 execution semantics。

目前大多數 agent loop 是：

```text
Model chooses tool
↓
Validate
↓
Execute immediately
↓
Observe result
```

但 speculative planning / retries / branch search 會產生：

```text
Branch A → send email
Branch B → better plan
Branch A discarded

BUT email already sent
```

也就是：

> **Logical branch abort，不會自動撤回 physical side effect。**

Atomix 將 tool call 變成 transaction-aware event：

```text
Tool Call
↓
Assign Epoch e
↓
Determine Touched Resources
↓
Effect Classify
├ bufferable
└ externalized
↓
Track Resource Frontier
↓
Progress Predicate
↓
COMMIT / ABORT
```

對 bufferable effects：

```text
prepare
→ hold
→ commit later
```

對不可延後、已 externalized effect：

```text
execute
→ register compensation
→ abort ? compensate : keep
```

### Hermes 必須新增 Effect Type

```text
PURE
READ_ONLY
BUFFERABLE_WRITE
REVERSIBLE_WRITE
COMPENSATABLE_EXTERNAL_EFFECT
IRREVERSIBLE_EFFECT
PHYSICAL_EFFECT
```

而不是只有：

```text
risk = low / high
```

因為 rollback semantics 取決於 effect type。

---

## 發現 4：Rollback ≠ Compensation

這個區分非常重要。

### 真 rollback

```text
DB transaction not committed
→ abort
→ external world never observed it
```

### Compensation

```text
book flight
→ external world saw reservation
→ abort workflow
→ call cancel flight
```

第二個不是 rollback；它是新的 external action。

因此：

```text
Compensation
≠ Erasure of History
```

例如：
- Email sent → unsend 常常不可能
- GitHub push → revert commit 不等於 push 沒發生過
- Bank transfer → refund 是另一筆 transaction
- Physical robot movement → move-back 不會讓撞擊沒發生

所以 Hermes 必須在 Planner 前就知道：

```text
Effect Reversibility
```

並把不可逆性加入 planning cost：

```text
ActionUtility
=
TaskValue
- Risk
- AuthorityCost
- IrreversibilityCost
- CompensationCost
- RecoveryUncertainty
```

### 新否定關係

```text
Compensatable ≠ Reversible
Reversible ≠ Idempotent
Idempotent ≠ Side-Effect Free
```

---

## 發現 5：Least Privilege 應同時是 Runtime Property + Learned Policy Property

2026 的 task-conditioned least-privilege learning 顯示，可以讓模型學會主動選擇更小 authority，而不只是每一步被 gate 擋。

但最安全的組合不是：

```text
Model learned restraint
```

而是：

```text
Learned Restraint
+
Capability Runtime
+
Sandbox
+
Deterministic Verifier
```

這形成兩層：

### Model layer
```text
"我應該只要求 read:fileA"
```

### Runtime layer
```text
即使模型要求 write:*
也拿不到
```

因此：

```text
Policy Alignment
≠ Security Boundary
```

---

# 3. Architecture Breakdown

本輪建議 Hermes 新增 **Least-Privilege Transactional Effect Plane**：

```text
User Request
↓
Intent Compiler
↓
Task Graph
↓
Authority Deriver
├ operation
├ operand constraints
├ resource constraints
├ time bounds
├ usage count
└ side-effect class
↓
Capability Minting / Grant
↓
Planner / LLM
↓
Proposed Tool Call
↓
Semantic Reference Monitor
↓
Capability Matcher
├ principal
├ task
├ resource
├ operation
├ arguments
├ provenance
└ expiry
↓
Effect Classifier
├ PURE
├ READ_ONLY
├ BUFFERABLE
├ REVERSIBLE
├ COMPENSATABLE
└ IRREVERSIBLE
↓
Transaction Coordinator
├ epoch
├ resource frontier
├ prepare
├ idempotency key
├ deduplication
├ commit predicate
└ abort state
↓
Tool / MCP / Computer Runtime
↓
Effect Journal
↓
Postcondition Verifier
↓
COMMIT
or
ABORT → COMPENSATION PLAN
↓
Capability Revoke / Attenuate
↓
Provenance + Audit
```

這一層應位於：

```text
Reasoning / Planning
        ↓
[Least-Privilege Transactional Effect Plane]
        ↓
MCP / Shell / Browser / Computer / External API
```

而不能只在 UI 顯示確認按鈕。

---

# 4. Bottom-Level Logic

## 4.1 Capability derivation

從 task：

```text
"把 report.pdf 上傳到 Project A"
```

不要產生：

```text
filesystem.read(*)
drive.write(*)
```

而應生成：

```text
C1 = filesystem.read(
  resource = /workspace/report.pdf,
  max_uses = 1
)

C2 = drive.upload(
  destination = Project-A,
  filename = report.pdf,
  source_provenance = C1.output,
  max_uses = 1
)
```

即 capability graph：

```text
Task T
├─C1 read report.pdf
└─C2 upload to Project-A
       ↑ requires provenance from C1
```

## 4.2 Capability attenuation

Sub-agent 不應繼承 parent 全部權限：

```text
Parent Capability Set
C_parent

Child Capability
C_child ⊆ C_parent
```

每次 delegation 都只能縮小：

```text
resource scope ↓
operation set ↓
time window ↓
max uses ↓
argument range ↓
```

需要擴權時：

```text
new authorization event
```

不能：

```text
self-escalate
```

## 4.3 Prepare / Commit

對 bufferable effect：

```text
Tool Proposal
↓
prepare()
↓
Staged Effect
↓
Postcondition Preview
↓
Commit Predicate
↓
commit()
```

Commit Predicate 可能要求：

```text
Task still active
AND
Branch still winner
AND
Capability still valid
AND
Resource version unchanged
AND
No conflicting operation
AND
Approval still valid
```

## 4.4 TOCTOU

一個很重要的缺口：

```text
Check permission at t0
↓
world changes
↓
execute at t1
```

所以：

```text
Authorized at Prepare
≠ Authorized at Commit
```

Hermes 應採：

```text
prepare-time check
+
commit-time revalidation
```

至少重新驗證：

```text
capability validity
resource version
principal
policy epoch
approval epoch
argument binding
```

## 4.5 Idempotency / Retry

Agent runtime 很常 retry。

如果：

```text
POST /charge
```

第一次已成功，但 response timeout，Agent retry：

```text
charge twice
```

因此每個 effectful invocation 應有：

```text
idempotency_key = hash(
 task_id,
 subgoal_id,
 effect_intent,
 canonical_arguments
)
```

Runtime 維持：

```text
UNKNOWN
PREPARED
COMMITTED
ABORTED
COMPENSATED
```

而不是 timeout 後直接再 call 一次。

---

# 5. System Architecture 深拆：HCP Runtime

本輪不是只讀 README，而是追進 repository structure。

值得看的公開目錄 / 核心檔案：

```text
handle-capability-protocol/
├ SPEC.md
├ docs/
├ hcp-runtime/
│  ├ src/
│  │  ├ runtime.js
│  │  ├ jsonrpc.js
│  │  ├ mcp-adapter.js
│  │  ├ mcp-config.js
│  │  ├ registry.js
│  │  ├ provider-sdk.js
│  │  ├ http-server.js
│  │  └ providers/
│  ├ docs/core-spec.md
│  ├ schemas/
│  ├ test/
│  └ examples/
├ packages/hcp-conformance/
└ paper-artifact-public/
```

### 為什麼這些檔案值得看

**`runtime.js`**  
最接近核心 execution state machine；目前是最值得 Hermes 下一輪 source-level mapping 的檔案。

**`mcp-adapter.js`**  
非常重要，因為它代表如何在不要求 MCP ecosystem 全部重寫的情況下，將 MCP-like server 包進 execution-control layer。

**`registry.js`**  
對 capability/resource/provider identity 與 discovery 有直接參考價值。

**`docs/core-spec.md`**  
已明確定義 `data.pipe(source_handle, target_capability, mapping, options)` 類操作，這對 Hermes 的「source + target authorization」與 provenance-aware data movement 很重要。

**`packages/hcp-conformance/`**  
值得注意的不只是 protocol code，而是 conformance tests：安全 invariant 如果沒有可測試的 conformance suite，很容易重新退化成「文件寫得安全」。

### 已確認工程限制

HCP runtime README 自己明列，目前 reference runtime 尚未提供完整 production：

```text
JWT / production capability token
persistent storage
distributed registry
multi-tenant isolation
complete policy language
enterprise audit storage
```

所以：

```text
HCP Reference Runtime
≠ Production-Ready Security Boundary
```

但它的 object model 與 invariants 非常值得 Hermes 採用。

---

# 6. MCP 與 Least Privilege 的正確分層

MCP 2026-07-28 authorization 強化了 OAuth/OIDC alignment，包括 issuer validation 與 credential issuer binding。

這主要屬於：

```text
Connection / Identity Authorization
```

Hermes 還需要額外：

```text
Task Authorization
Effect Authorization
Dataflow Authorization
Transaction Authorization
```

完整分層應是：

```text
Layer 1 Identity
Who is the user / client / agent?

Layer 2 Connection
Can this client connect to this MCP server?

Layer 3 Tool Scope
Can this principal call this tool family?

Layer 4 Task Scope
Does this concrete operation follow user intent?

Layer 5 Operand Scope
Are these exact arguments authorized?

Layer 6 Dataflow Scope
Can this source data move to this sink?

Layer 7 Effect Scope
Can this side effect occur now?

Layer 8 Commit Scope
Can the prepared effect become externally visible?
```

這八層不能壓成一個 `allowed=true`。

---

# 7. Visual Simulation Idea

## **Capability & Transaction Execution Lab**

### View A — Authority Cone

```text
User Task
   │
   ▼
[ Upload report.pdf to Project A ]
   │
   ├── READ
   │   /workspace/report.pdf
   │   max_use = 1
   │
   └── WRITE
       Project-A/report.pdf
       max_use = 1
```

如果 Agent 提議：

```text
DELETE Project-A/*
```

畫面直接：

```text
OUTSIDE AUTHORITY CONE

Operation mismatch      FAIL
Resource scope          FAIL
Task relevance          FAIL

DENY
```

### View B — Effect Timeline

```text
PLAN
 │
 ▼
PREPARE ────── staged upload
 │
 ├── capability valid ✓
 ├── resource version ✓
 ├── user task active ✓
 └── branch winner ✓
 │
 ▼
COMMIT
 │
 ▼
EXTERNAL EFFECT
```

### View C — Speculative Branch

```text
Branch A ── send_email PREPARED ──┐
                                  X losing branch
Branch B ── create_draft ── WINNER
```

UI 顯示：

```text
Branch A effect externalized? NO
Prevented leaked side effect: 1
```

### View D — Compensation

```text
Book Hotel
   ↓ COMMITTED
Charge Card
   ↓ FAILED

Transaction ABORT
   ↓
Compensation Plan
├ cancel hotel       SUCCESS
└ refund deposit     PENDING

Recovery State:
PARTIALLY COMPENSATED
```

這裡一定要明確顯示：

```text
COMPENSATED
≠
NEVER HAPPENED
```

### View E — Capability Decay

```text
Task start       C1 C2 C3
Step 4           C1 C2
Step 8           C2
Task complete    ∅
```

讓使用者直接看到：Agent 的權限應隨 task progress **縮小**，而不是 session 越久權限累積越多。

---

# 8. Papers

## Paper 1
**Title**：PAuth - Precise Task-Scoped Authorization For Agents  
**Authors**：Reshabh K Sharma, Linxi Jiang, Zhiqiang Lin, Shuo Chen  
**Year**：2026  
**URL**：https://arxiv.org/abs/2603.17170  
**Code**：paper abstract confirms AgentDojo prototype; public code availability should be re-checked next round before claiming a canonical repo.  
**Dataset**：AgentDojo-derived tasks + adversarial unauthorized-operation scenarios  
**Architecture**：NL task → symbolic slice → signed envelope → deterministic server validation  
**Contribution**：task-scoped implicit authorization at exact operation/operand level  
**Limitations**：task ambiguity、task mutation、long-lived conversational authority

## Paper 2
**Title**：From Tool Connection to Execution Control: Benchmarking Security Invariants in MCP-Style Agent Runtimes  
**Author**：Ting Liu  
**Year**：2026  
**URL**：https://arxiv.org/abs/2606.29073  
**Code**：https://github.com/SymbolicLight-AGI/handle-capability-protocol  
**Architecture**：principal / grant / capability / handle / task / pipe / audit  
**Contribution**：8 execution-layer invariants + HCP reference runtime  
**Limitations**：reference runtime 尚非完整 production identity/token/storage/isolation stack

## Paper 3
**Title**：Atomix: Timely, Transactional Tool Use for Reliable Agentic Workflows  
**Authors**：Bardia Mohammadi, Nearchos Potamitis, Lars Klein, Akhil Arora, Laurent Bindschaedler  
**Year**：2026  
**URL**：https://arxiv.org/abs/2602.14849  
**Architecture**：epoch → resource frontier → progress predicate → commit / compensation  
**Contribution**：transaction semantics for speculative/failing/concurrent agent tool use  
**Limitations**：externalized effects cannot always be truly rolled back

## Paper 4
**Title**：Task-Conditioned Least-Privilege Learning for Executable Terminal and MCP Agents  
**Authors**：Alexander Tu, Michael Tu  
**Year**：2026  
**URL**：https://arxiv.org/abs/2608.18351  
**Architecture**：sufficient-authority envelope + deterministic action/effect audit + post-training  
**Contribution**：least privilege as learned behavior while preserving hard gates  
**Limitations**：requires trustworthy task-specific authority labels/verifiers

## Engineering Source 5
**OpenAI Agents SDK Tool Guardrails**  
https://openai.github.io/openai-agents-js/guides/guardrails/  
**Important confirmed behavior**：per-tool input/output guardrails; local MCP conversion integration; human approvals.  
**Important limitation**：guardrail coverage differs by tool class/runtime path.

---

# 9. Known Fact / Engineering / Inference 分類

## 已確認官方資訊
- MCP 2026-07-28 對 authorization/OAuth/OIDC 部分有 issuer-validation 與 credential-binding 強化。
- OpenAI Agents SDK 支援 function/local-MCP tool input/output guardrails，但 coverage 並非所有 hosted/built-in tool execution path 完全一致。
- HCP 公開 repo 確實具有 `hcp-runtime/src/runtime.js`, `mcp-adapter.js`, `registry.js`, `provider-sdk.js`, conformance package 等結構。

## 論文結果
- PAuth 報告 task-scoped operation authorization 與 benign/adversarial benchmark results。
- HCP paper 報告 execution invariants benchmark。
- Atomix 報告 transactional retry/frontier-gated commit 對 failure/speculation/contension 的改善。
- Task-conditioned least-privilege paper 報告 post-training 對 safe success / excess-authority events 的改善。

## 工程實作
- HCP runtime：grant/capability/handle/task/data pipe/audit 的 reference object model。
- OpenAI tool guardrails：pre/post execution hooks。

## 合理推論 / Hermes proposal
- 將 PAuth task-scope + HCP capability objects + Atomix transaction semantics 合成 Hermes `Least-Privilege Transactional Effect Plane`。
- `CapabilityGrant` / `EffectJournal` / `CommitGate` / `CompensationPlan` 為本研究提出的 Hermes IR，不代表上述系統已有完全相同 API。

## 尚未驗證假說
- Universal capability IR 能否同時覆蓋 filesystem、browser、email、database、MCP、robotics，而不變成過度複雜 policy language。
- Counterfactual / provenance constraint 能否低延遲地進 commit gate。
- Physical-world tool 的 compensation 是否能建立可泛化的安全 semantics。

---

# 10. Unknown / Open Questions 1–3

## 1. 如何自動推導「最小充分權限」？
目前 task-scoped authorization 很多仍需要 symbolic extraction / predefined sufficient-authority envelope。

真正成熟 Agent 需要：

```text
Task
↓
Required Dependency Graph
↓
Minimal Action Set
↓
Minimal Resource Set
↓
Minimal Argument Range
↓
Capability Set
```

這其實是一個 program analysis + planning + authorization synthesis 問題。

## 2. 如何在執行前知道 action 是否「真的不可逆」？

Tool metadata 可能宣稱 reversible，但 provider implementation 可能不是。

因此需要：

```text
Declared Effect Semantics
≠ Verified Effect Semantics
```

未來要加入 effect conformance test。

## 3. 跨多個 MCP / SaaS / Agent 的分散式 transaction 怎麼做？

傳統 2PC 對 autonomous tool ecosystem 太重，而且很多外部服務不支援 prepare。

Agent runtime 很可能需要混合：

```text
True Transaction
+ Saga Compensation
+ Idempotency
+ Escrow
+ Human Commit Gate
```

---

# 11. Knowledge Graph 新增 Node / Edge

## New Nodes

```text
Least Privilege
Task-Scoped Authorization
Operation-Scoped Authorization
Operand Authorization
Capability Grant
Capability Attenuation
Capability Revocation
Authority Cone
Authority Envelope
NL Slice
Signed Provenance Envelope
Effect Type
Effect Journal
Prepare Phase
Commit Gate
Abort State
Compensation Action
Compensation Plan
Transaction Epoch
Resource Frontier
Progress Predicate
Idempotency Key
TOCTOU Revalidation
Postcondition Verification
Irreversible Effect
Physical Effect
Effect Conformance
Transactional Tool Runtime
```

## New Edges

```text
UserIntent --DERIVES→ TaskAuthority
TaskAuthority --MINTS→ CapabilityGrant
CapabilityGrant --AUTHORIZES→ ToolInvocation
CapabilityGrant --CONSTRAINS→ ArgumentRange
CapabilityGrant --CONSTRAINS→ ResourceScope
CapabilityGrant --EXPIRES_AT→ TimeBoundary
CapabilityGrant --ATTENUATES_TO→ ChildCapability
ToolInvocation --HAS_EFFECT→ EffectType
ToolInvocation --PREPARES→ StagedEffect
StagedEffect --COMMITS_TO→ ExternalEffect
StagedEffect --ABORTS_TO→ NoExternalEffect
ExternalEffect --MAY_REQUIRE→ CompensationAction
TransactionEpoch --ORDERS→ ToolInvocation
ResourceFrontier --GATES→ Commit
PostconditionVerifier --VALIDATES→ CommittedEffect
TaskCompletion --TRIGGERS→ CapabilityRevocation
```

## Important Negative Edges

```text
OAuth Scope ≠ Task Authority
Tool Permission ≠ Operand Authorization
Approval ≠ Grant
Tool Metadata ≠ Authority
Authorized Call ≠ Safe Immediate Execution
Logical Abort ≠ Physical Rollback
Compensation ≠ Rollback
Compensatable ≠ Reversible
Reversible ≠ Idempotent
Idempotent ≠ Side-Effect Free
Model Restraint ≠ Security Boundary
Prepare-Time Authorization ≠ Commit-Time Authorization
Connected MCP Server ≠ Trusted Capability
Capability Possession ≠ Unlimited Delegation
```

---

# 12. 下一輪研究

下一個最重要缺口：

# **Effect Semantics × Idempotency × TOCTOU × Saga/Compensation Verification × Distributed Commit**

下一輪應沿著：

```text
Tool Schema
↓
Declared Effect Metadata
↓
Static / Dynamic Effect Inference
↓
Read / Write Set
↓
Idempotency Classification
↓
Precondition
↓
Prepare
↓
World Changes
↓
TOCTOU Check
↓
Commit
↓
Postcondition
↓
Failure
↓
Compensation / Saga
↓
Recovery Verification
```

並深入比較：
- database ACID / MVCC / optimistic concurrency control
- distributed Saga pattern
- idempotency-key semantics
- external API compensation
- cloud workflow engines
- browser/computer side-effect classification
- physical/robotic irreversible effects
- multi-agent concurrent writes

目標是回答：

> **Agent 不只是「有沒有權限做」，而是「何時可以讓這個動作真正成為世界的一部分」。**

---

# 13. 本輪結束回答

**缺哪一層？**  
最缺的是 **Effect Semantics + Distributed Commit / Recovery Plane**。目前已有 authority derivation，但對 tool side effect 是否 bufferable/reversible/idempotent/compensatable 還缺可信 runtime contract。

**哪個節點最淺？**  
`Effect Conformance` 最淺。現在多數 tool effect semantics 還依賴開發者描述，尚缺通用的可驗證測試。

**哪個概念仍只是名詞？**  
`Universal Capability ABI`、`Universal Effect ABI`、`TransactionCertificate`、`CompensationCertificate`。

**哪個系統值得讀原始碼？**  
首選 HCP：`hcp-runtime/src/runtime.js`、`mcp-adapter.js`、`registry.js`、`docs/core-spec.md`、`packages/hcp-conformance/`。

**哪篇論文需追引用？**  
優先追 `Atomix` 的 distributed systems / transaction lineage，以及 `PAuth` 的 program slicing / provenance-based authorization lineage；再追 HCP 的 object-capability 與 information-flow security lineage。

**哪個概念最適合視覺模擬？**  
**Capability & Transaction Execution Lab**：Authority Cone + Prepare/Commit Timeline + Speculative Branch + Compensation Graph + Capability Decay。

**哪個 Agent 架構最值得實作？**  

> **Least-Privilege Transactional Agent Runtime = Intent Compiler + Task-Scoped Authority Deriver + Attenuatable Capability Grants + Semantic Reference Monitor + Effect Classifier + Epoch/Frontier Transaction Coordinator + Commit-Time Revalidation + Idempotency/Dedup + Compensation Planner + Postcondition Verifier + Capability Revocation + Provenance/Audit.**

---

# 14. 對「AI 到底怎麼運作」總鏈的新增位置

目前總鏈可進一步還原為：

```text
User
↓
UI
↓
Intent
↓
Agent
↓
Context Compiler
↓
Predictive / Belief State
↓
Reasoning
↓
Planning
↓
Memory / Provenance
↓
Tool Selection
↓
Semantic Authority Check
↓
Task-Scoped Capability
↓
Effect Classification
↓
Prepare / Transaction
↓
MCP / Tool / Computer / Browser
↓
Commit Gate
↓
External World Side Effect
↓
Observation
↓
Postcondition Verification
↓
Memory / World State Update
↓
Next Decision
```

對多模態/具身系統：

```text
Camera / Image / Voice / Video / Depth
↓
Encoder
↓
Multimodal Tokens / Latents
↓
Fusion
↓
Belief State
↓
Reasoning / Planning
↓
Capability-Constrained Action
↓
Transactional / Safety Gate
↓
Robot / Computer / Tool Action
↓
World
↓
Sensor Feedback
```

本輪最重要的底層推進可以濃縮成一句：

> **成熟 Agent 的安全邊界不應停在「這個 tool 可以呼叫」，而應精確到「這個 task 只授權這個 principal，對這個 resource，以這組 arguments，在這段時間內，做這一次 effect；而且 effect 必須先經 prepare / commit / postcondition，任務結束後能力立即撤銷」。**
