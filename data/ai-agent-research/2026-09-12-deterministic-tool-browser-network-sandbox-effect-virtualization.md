# 【AI Agent × Multimodal Research Report】

**時間：2026-09-12 14:50（Asia/Taipei）**  
**本輪主題：Deterministic Tool Sandboxing × Browser/Network Record-Replay × Replay World Boundary × External Effect Virtualization × MCP Runtime Isolation**

> 本輪承接上一輪 `Replay Determinism × Event-Keyed RNG × Environment Snapshotting`，不再重複模型端 seed / CRN，而是往外追蹤：Tool → Filesystem → Database → Browser → HTTP/WebSocket → MCP → External Side Effect。核心問題是：**如何讓 counterfactual agent branch 真的活在同一個、可重建且不會傷害真實世界的環境中？**

---

## 本小時新發現

### 新論文 / 新架構

1. **Deterministic Replay for AI Agent Systems (agrepl, 2026)**  
   - Authors: Rasheed Mudasiru  
   - Year: 2026  
   - URL: https://arxiv.org/abs/2607.16200  
   - Architecture: Agent → MITM proxy → structured trace → isolated replay with zero outbound network.  
   - Contribution: 把 LLM/API/tool 外部互動提升成 transport-level record/replay；提出 request-key matching 與 noise-aware HTTP diff。  
   - Reported result: 5 workloads / 250 replay instances，paper 報告 replay fidelity F=1.0 與 median per-step latency reduction 98.3%。  
   - Limitation: deterministic transport replay 不等於新的 counterfactual tool action 有真實可用的 response；WebSocket、browser local runtime、external irreversible effects 仍需額外處理。

2. **Branching Policy Optimization: Sandbox-Native Language Agent Reinforcement Learning (2026)**  
   - URL: https://arxiv.org/abs/2607.14171  
   - Architecture: deterministic snapshottable sandbox → backbone trajectory → high-entropy branch points → snapshot → K sibling actions → continuation rollouts.  
   - Contribution: 說明 sandbox 的 snapshot/fork 能改變 agent rollout topology，不必從初始 state 重跑 N 條獨立 trajectory。  
   - 對 Hermes 的意義：counterfactual debugging 與 RL 可以共用同一套 `Snapshot → Fork → Isolated Rollout` ABI。

3. **MCP-SandboxScan: WASM-based Secure Execution and Runtime Analysis for MCP Tools (2026)**  
   - Authors: Zhuoran Tan, Run Hao, Jeremy Singer, Yutian Tang, Christos Anagnostopoulos  
   - URL: https://arxiv.org/abs/2601.01241  
   - Architecture: untrusted MCP tool → WASM/WASI sandbox → controlled env/filesystem/HTTP exposure → source-to-sink runtime evidence.  
   - Contribution: MCP sandbox 不只是防 crash；它必須限制環境變數、掛載檔案與外部網路 capability，並留下可稽核 runtime evidence。  
   - Limitation: prototype provenance 使用 snippet matching，對 transformations 可能 false negative，也不是完整 deterministic replay engine。

4. **ComplexMCP (2026)**  
   - URL: https://arxiv.org/abs/2605.10787  
   - Architecture: >300 tools / 7 stateful sandboxes / seed-driven dynamic states / injected API failures.  
   - Contribution: 證明真正 Agent tool runtime 是 stateful、interdependent、帶 environmental noise，不是「一個 tool = 一個純函式」。  
   - Reported result: paper 報告 strongest evaluated agents 仍未超過 60% success，human 約 90%。  
   - 對 Hermes：Tool replay 必須保存跨工具 shared state 與 failure schedule，不能只 cassette 單次 function output。

### 新 GitHub / 工程實作

5. **AgentReplay — gadda00/agentreplay**  
   - URL: https://github.com/gadda00/agentreplay  
   - 值得讀的目錄：
     - `src/agentreplay/cassette.py`
     - `src/agentreplay/hashing.py`
     - `src/agentreplay/mutate.py`
     - `src/agentreplay/interceptors/http.py`
     - `src/agentreplay/interceptors/clock.py`
     - `src/agentreplay/interceptors/llm.py`
     - `src/agentreplay/interceptors/streaming.py`
     - `src/agentreplay/frameworks/`
   - 實際 source observation：`hashing.py` 會 canonicalize dict、移除 request_id/id/created/system_fingerprint/trace/session/seed/user-agent 等非決定性欄位，redact UUID 與 ISO-8601 timestamp，再以 SHA-256 建立 call-site ID。  
   - 重要意義：**Replay Matching 是 deterministic replay 的第一性問題。** 沒有穩定 request identity，cassette 再完整也無法正確 join。

6. **Playwright browser replay primitives**  
   - Docs: https://playwright.dev/docs/api/class-browsercontext  
   - `BrowserContext.storageState()`：可 snapshot cookies/localStorage/IndexedDB/OPFS/WebAuthn credentials（依版本/options）。  
   - `routeFromHAR()`：可從 HAR 供應網路 request。  
   - `BrowserContext.route()`：可 fulfill/abort/continue HTTP request。  
   - `context.tracing`：記錄 browser operation / network activity / screenshots / snapshots。  
   - 關鍵限制：Playwright 官方明確指出 native route 不會攔到由 Service Worker 攔截的 request，做 network replay 時建議 `serviceWorkers: 'block'`。  
   - 因此：**Browser Trace ≠ Browser World Snapshot。**

7. **mitmproxy server-side replay**  
   - Docs/source: https://github.com/mitmproxy/mitmproxy/blob/main/docs/src/content/overview/features.md  
   - Server replay 會用 recorded HTTP conversation 配對新 request；matching 可排除 naturally-varying headers。  
   - Response replay 還可能需要 refresh cookie/date 等時間相關欄位。  
   - 已知 boundary：WebSocket/TCP replay 與普通 HTTP replay 不等價，mitmproxy issue #5248 長期明確記錄這個問題。  
   - Issue: https://github.com/mitmproxy/mitmproxy/issues/5248

---

# 本小時最重要 5 個發現

## 1. Trace ≠ Replayable World

### 是什麼

Agent observability 通常記錄：

```text
LLM call
Tool call
HTTP request
Browser click
Tool result
```

但真正可 replay 的世界至少還需要：

```text
Process state
Filesystem state
Database/MVCC state
Browser storage state
Virtual clock
RNG channels
HTTP corpus
WebSocket/event stream
Tool implementation version
MCP server version
Policy/permission state
External side-effect boundary
```

### 底層如何運作

```text
Execution
↓
Capture nondeterministic input
↓
Assign semantic/request identity
↓
Store payload + metadata + state revision
↓
Block live egress during replay
↓
Agent issues request
↓
Canonical request match
↓
Recorded/simulated response
↓
State transition inside sandbox
```

### 為什麼重要

只有 trace，你知道「當時發生什麼」；有 replay world，你才能問：

> 如果 memory/tool result 不同，Agent 後面真的會不會做不同決定？

### 限制

完整 snapshot 可能很昂貴；有些服務根本無法 snapshot，只能 record、mock、shadow 或 digital twin。

### 來源

- agrepl: https://arxiv.org/abs/2607.16200
- Playwright isolation/context: https://playwright.dev/docs/browser-contexts
- AgentReplay: https://github.com/gadda00/agentreplay

---

## 2. Request Identity 是 Replay 的底層 ABI

AgentReplay source 顯示 replay key 不能直接 hash raw request。UUID、timestamp、request ID、system fingerprint、headers 都可能漂移。

底層應是：

```text
Raw Request
↓
Semantic Canonicalizer
├ sort dictionary keys
├ strip nondeterministic metadata
├ normalize timestamps/UUID
├ normalize selected headers
└ preserve semantically relevant payload
↓
Request Identity
↓
Cassette / Fixture Lookup
```

Hermes 應正式增加：

```text
ReplayRequestIdentity
├ channel
├ operation
├ semantic_step_id
├ canonical_input_hash
├ state_revision
├ tool_version
└ matching_policy_version
```

重要否定關係：

```text
Raw Byte Equality ≠ Semantic Request Equality

Semantic Request Equality ≠ Safe Replay Equivalence
```

例如 payment `POST /charge` 金額相同，但 idempotency context 或 account state 不同，就不能錯誤 match。

---

## 3. Browser Replay 至少包含四層，不是 HAR 就完成

### L0 — Browser Identity / Runtime

```text
browser version
engine
viewport
locale
timezone
permissions
feature flags
service worker policy
```

### L1 — Browser Persistent State

```text
cookies
localStorage
IndexedDB
OPFS
credentials / auth state
```

Playwright `storageState()` 已覆蓋其中多項。

### L2 — Network World

```text
HTTP request/response
redirects
headers
cache semantics
streaming
WebSocket
SSE
Service Worker intercepted traffic
```

Playwright `routeFromHAR()` 可以處理 HAR-covered HTTP request，但 Service Worker 與 WebSocket 形成 boundary。

### L3 — UI / Rendering / Event World

```text
DOM
layout
animation
timers
input events
popup/tab topology
downloads
clipboard
OS dialog
```

因此：

```text
HAR Replay ≠ Browser Replay
Storage Restore ≠ Browser Replay
Trace Playback ≠ Browser Replay
```

Hermes 需要一個 `BrowserReplayFidelityVector`，而不是 boolean `browser_replay=true`。

---

## 4. Tool sandbox 應同時做 Determinism、Capability Security、Effect Isolation

MCP-SandboxScan 顯示 MCP tool sandbox 要控制 filesystem/environment/network capability。ComplexMCP 則顯示 tool 之間共享 state、environment failure 也會影響結果。

Hermes Tool Runtime 應從：

```text
call(tool, args)
```

升級成：

```text
ToolInvocation
↓
Capability Manifest
↓
Sandbox Instantiate
├ filesystem namespace
├ environment namespace
├ network policy
├ virtual clock
├ RNG namespace
├ CPU/RAM/time budget
└ secret scope
↓
Tool Execute
↓
Effect Interceptor
↓
Observation
↓
State / Effect Ledger
```

Capability manifest 建議：

```text
ToolCapabilityManifest
├ fs.read[]
├ fs.write[]
├ net.connect[]
├ process.spawn
├ db.read[]
├ db.write[]
├ secrets.read[]
├ external.effect[]
└ irreversible_effect
```

關鍵：

```text
Sandboxed ≠ Deterministic
Deterministic ≠ Safe
Safe ≠ Side-Effect Free
```

三者必須獨立證明。

---

## 5. External Effect Virtualization 是 Counterfactual Debugging 的真正邊界

假設 counterfactual Agent 做：

```text
send_email()
charge_card()
publish_post()
delete_cloud_file()
book_ticket()
```

我們不能為了「重播」就再次執行真實效果。

因此需要：

```text
Effect Intent
↓
Effect Classifier
├ PURE
├ READ_ONLY
├ IDEMPOTENT_WRITE
├ REVERSIBLE_WRITE
├ COMPENSATABLE
└ IRREVERSIBLE
↓
Execution Mode
├ LIVE
├ RECORD
├ REPLAY
├ SHADOW
├ SIMULATE
└ BLOCK
↓
Virtual Effect Result
↓
Effect Ledger
```

這裡要特別區分：

```text
Virtual Effect Success
≠
Real-World Effect Would Succeed
```

例如 replay world 中「信用卡扣款成功」只是 counterfactual oracle/simulator 的結果，不代表現在真的能扣款。

這也是下一代 Hermes 最需要保存的：

```text
EffectVirtualizationEnvelope
├ requested_effect
├ execution_mode
├ simulator_or_fixture
├ source_recording
├ preconditions
├ predicted_result
├ uncertainty
├ real_world_not_executed
└ fidelity_scope
```

---

# Architecture Breakdown

```text
User / UI / Agent Planner
↓
Tool / Browser / MCP Intent
↓
Replay Mode Router
├ LIVE
├ RECORD
├ STRICT_REPLAY
├ HYBRID
├ COUNTERFACTUAL
└ SHADOW
↓
Capability Sandbox
├ FS namespace
├ DB snapshot
├ BrowserContext
├ Virtual clock
├ RNG namespace
├ Secret scope
└ Egress firewall
↓
Interaction Interceptors
├ LLM
├ HTTP
├ Browser network
├ MCP JSON-RPC
├ Tool function
├ Clock
├ Streaming
└ External effects
↓
Semantic Canonicalizer
↓
ReplayRequestIdentity
↓
Fixture / Cassette / Digital Twin Resolver
↓
Controlled Observation
↓
Sandbox State Transition
↓
Effect Ledger
↓
Replay Fidelity Auditor
↓
Counterfactual Attribution / Repair / Regression Test
```

## Replay Mode 語義

### LIVE
完全連真實世界，不宣稱 replay。

### RECORD
連真實世界並 capture 所有可 capture 的 nondeterministic boundary。

### STRICT_REPLAY
任何未命中的外部 interaction 都：

```text
REPLAY_ESCAPE
→ BLOCK
```

### HYBRID
先 replay；第一個未命中 interaction 後可 live fallback。

**但 HYBRID 結果不能再宣稱 deterministic causal replay。**

### COUNTERFACTUAL
從 snapshot fork，允許 action diverge；新 action 必須經 simulator/digital-twin/safe shadow，而不是直接沿用 factual fixture。

### SHADOW
計算預期 external effect，但不真正 commit。

---

# Bottom-Level Logic

## A. Replay request matching

```text
request = {
  tool,
  args,
  state_revision,
  semantic_step
}

canonical = canonicalize(request)

key = SHA256(
  semantic_step_id
  || operation
  || canonical
  || matching_policy_version
)
```

不能永久把所有 `id` 都丟掉；需要 schema-aware canonicalization：

```text
request_id      → noise
trace_id        → noise
created_at      → usually noise
transaction_id  → MAY BE SEMANTIC
account_id      → semantic
idempotency_key → semantic depending on effect semantics
```

因此 Hermes 應從 generic redaction 升級成：

```text
SchemaAwareCanonicalizer
```

---

## B. Strict egress firewall

```text
Outbound Interaction
↓
Replay Resolver
↓
Recorded/Simulated Match?
├ YES → return controlled result
└ NO
   ↓
   Mode == STRICT_REPLAY ?
   ├ YES → BLOCK + ReplayEscape event
   └ NO  → allowed policy path
```

只有這樣才能知道 counterfactual branch 沒偷偷接回 live Internet。

---

## C. Browser network replay

```text
BrowserContext
↓
restore storage state
↓
block Service Workers (when using native request routing)
↓
install HAR/routes
↓
block unmatched egress
↓
virtualize time where possible
↓
run UI action
↓
record DOM/network/event divergence
```

需要額外 channel：

```text
HTTP
WebSocket
SSE
Service Worker
WebRTC
Download
Popup
```

不應把 `routeFromHAR()` 視為 browser world completion。

---

## D. External effect virtualization

```text
Effect call
↓
Effect Semantic ID
↓
Precondition snapshot
↓
Virtual Effect Adapter
↓
Apply to sandbox/digital twin
↓
Generate observation
↓
Append virtual effect ledger
```

例如：

```text
charge_card($100)
```

在 counterfactual world 中變成：

```text
SandboxLedger.balance -= 100
VirtualPaymentReceipt = ...
REAL_NETWORK = BLOCKED
```

如此 Planner 後續仍能看到「扣款後世界」，但真實世界不受影響。

---

# Visual Simulation Idea

## Replay World Boundary & Effect Virtualization Lab

左側顯示 Agent：

```text
Planner
  ↓
Browser
  ↓
MCP
  ↓
Payment Tool
```

中央畫一個 Replay World Boundary：

```text
╔════════════════ REPLAY WORLD ═══════════════╗
║ FS snapshot                                 ║
║ DB snapshot                                 ║
║ Browser storage                             ║
║ HAR / HTTP fixtures                         ║
║ Virtual clock                               ║
║ RNG namespace                               ║
║ MCP fixtures                                ║
║ Effect simulator                            ║
╚═════════════════════════════════════════════╝
                  │
                  X
          LIVE INTERNET BLOCKED
```

每次 interaction 用顏色/狀態表示：

```text
LLM                REPLAYED ✓
HTTP /search       HAR HIT ✓
Browser storage    SNAPSHOT ✓
WebSocket /live    UNSUPPORTED ⚠
MCP read           FIXTURE ✓
Payment charge     VIRTUALIZED ✓
Email send         SHADOWED ✓
Unknown HTTP       BLOCKED — REPLAY ESCAPE
```

右側顯示：

```text
Replay Fidelity

Model               1.00
Clock               1.00
Filesystem          1.00
Database             .96
Browser storage     1.00
HTTP                  .93
WebSocket             .20
MCP                    .88
External effects       .71

WORLD COVERAGE       .84
REPLAY ESCAPES         1
```

並提供切換：

```text
[STRICT]
[HYBRID]
[COUNTERFACTUAL]
[SHADOW EFFECTS]
```

使用者會直接看到：一旦按 HYBRID 並命中 live 網路，`causal confidence` 立即下降。

---

# Code / GitHub

## AgentReplay
https://github.com/gadda00/agentreplay

優先閱讀：

```text
src/agentreplay/hashing.py
src/agentreplay/cassette.py
src/agentreplay/mutate.py
src/agentreplay/interceptors/http.py
src/agentreplay/interceptors/clock.py
src/agentreplay/interceptors/llm.py
src/agentreplay/interceptors/streaming.py
```

值得 Hermes 借鑑：
- canonical request identity
- cassettes
- RECORD / REPLAY / HYBRID 類模式
- structural diff
- counterfactual mutation

需要補強：
- browser state / DOM/runtime snapshot
- stateful database sandbox
- WebSocket/SSE
- MCP server state
- external effect virtualization
- semantic tool schema-aware matching

## Playwright
https://github.com/microsoft/playwright
https://playwright.dev/docs/api/class-browsercontext

優先概念：
- BrowserContext isolation
- storageState
- route / routeFromHAR
- tracing
- Service Worker boundary

## mitmproxy
https://github.com/mitmproxy/mitmproxy

優先概念：
- server replay
- request matching heuristics
- response refresh
- HTTP/TCP/WebSocket coverage gap

---

# Papers / Technical Sources

## Deterministic Replay for AI Agent Systems
- Authors: Rasheed Mudasiru
- Year: 2026
- URL: https://arxiv.org/abs/2607.16200
- Architecture: transport interception + isolated replay
- Contribution: zero-egress deterministic external-interaction replay
- Limitation: external-effect semantics與完整 browser/runtime snapshot仍需擴充

## Branching Policy Optimization: Sandbox-Native Language Agent Reinforcement Learning
- Year: 2026
- URL: https://arxiv.org/abs/2607.14171
- Architecture: snapshot → fork → sibling rollout
- Contribution: 將 deterministic snapshottable sandbox 本身變成 RL rollout primitive
- Limitation: sandbox 可 snapshot 的假設在真實 SaaS/browser/MCP 世界不一定成立

## MCP-SandboxScan
- Authors: Zhuoran Tan, Run Hao, Jeremy Singer, Yutian Tang, Christos Anagnostopoulos
- Year: 2026
- URL: https://arxiv.org/abs/2601.01241
- Architecture: MCP tool → WASM/WASI sandbox → capability/runtime exposure analysis
- Contribution: runtime tool security與provenance evidence
- Limitation: 不是完整 counterfactual replay / world simulator

## ComplexMCP
- Year: 2026
- URL: https://arxiv.org/abs/2605.10787
- Architecture: seed-driven stateful multi-tool sandbox
- Contribution: benchmark interdependent tools + dynamic failure
- Limitation: benchmark sandbox 與 production live services仍有 sim-to-real gap

---

# 已確認事實 / 工程實作 / 推論分層

## 已確認官方/原始碼事實

- Playwright BrowserContext 可做 isolation、storage state、network routing 與 HAR replay。
- Playwright 官方指出 Service Worker 可能繞過 native request routing，network mocking 時建議 blocking SW。
- mitmproxy 支援 HTTP server-side replay，request matching 可忽略自然漂移 headers。
- AgentReplay source 具有 hashing/cassette/mutate/interceptors 結構；canonicalization 會去除多種 nondeterministic fields。
- MCP-SandboxScan 使用 WASM/WASI sandbox 檢查工具 runtime external-input exposure。

## 論文結果

- agrepl paper 報告 250 replay instances 上 F=1.0、median per-step latency reduction 98.3%。
- ComplexMCP paper 報告 strongest evaluated model success <60%，human 約90%。

## Hermes 工程推論

以下不是某篇論文直接證明，而是本輪整合提出：

- `ReplayWorldBoundary`
- `EffectVirtualizationEnvelope`
- `BrowserReplayFidelityVector`
- `SchemaAwareCanonicalizer`
- `ReplayEscape`
- `ReplayModeRouter`
- `EffectSemanticID`

---

# Unknown / Open Questions

## 1. 新 counterfactual tool action 的 observation 從哪裡來？

Recorded cassette 只能回答 factual world 曾出現的 interaction。

如果 counterfactual 產生：

```text
new URL
new SQL
new MCP args
new payment amount
```

沒有 fixture 時只能選：

```text
BLOCK
SIMULATOR
DIGITAL TWIN
SHADOW LIVE
LIVE ESCAPE
```

哪一種才有足夠 fidelity，需要建立 formal policy。

## 2. Browser/WebSocket/Service Worker 的完整 replay 如何定義？

HTTP HAR 很成熟，但 modern web app 會使用：

```text
WebSocket
SSE
Service Worker
WebRTC
push events
IndexedDB
OPFS
background timers
```

需要研究 event stream record/replay 與 virtual-time browser runtime。

## 3. External effect simulator 如何校準？

Effect virtualization 很安全，但 simulator 越假，counterfactual causal conclusion 越不可靠。

需要建立：

```text
EffectSimulatorCalibration
Real-vs-Sim divergence
Uncertainty propagation
```

---

# 下一輪研究

下一輪優先：

# **Digital Twin Tool Runtime × Stateful Database Forking × Browser Virtual Time × Effect Simulator Calibration**

研究路徑：

```text
Tool Intent
↓
Stateful Sandbox Snapshot
↓
DB / FS / Browser Fork
↓
Virtual Time
↓
New Counterfactual Tool Action
↓
Digital Twin / Simulator
↓
Synthetic Observation
↓
Sim-vs-Real Calibration
↓
Uncertainty Propagation
↓
Counterfactual Outcome Confidence
```

需要特別研究：

- database MVCC snapshot / copy-on-write fork
- browser virtual time / timers / animation / event loops
- deterministic WebSocket/SSE event scheduling
- MCP stateful server snapshot ABI
- side-effect shadow execution
- simulation fidelity benchmark
- sim-to-real calibration

---

# Knowledge Graph 新增 Node / Edge

## Nodes

```text
Replay World Boundary
Replay Mode Router
Strict Replay
Hybrid Replay
Counterfactual Replay World
Replay Escape
Replay Request Identity
Schema-Aware Canonicalizer
Cassette
Fixture
Browser Replay Fidelity
Browser Storage Snapshot
Network Replay
HAR Replay
Service Worker Replay Gap
WebSocket Replay Gap
MCP Sandbox
Tool Capability Manifest
Egress Firewall
Effect Virtualization
Effect Semantic ID
Virtual Effect Ledger
Shadow Effect
Digital Twin Tool
Snapshot Coverage
World Coverage
```

## Edges

```text
Trace
DOES_NOT_IMPLY
Replayable World

HAR Replay
DOES_NOT_IMPLY
Browser Replay

Browser Storage Restore
DOES_NOT_IMPLY
Browser Runtime Replay

Raw Byte Equality
DOES_NOT_EQUAL
Semantic Request Equality

Semantic Request Equality
DOES_NOT_IMPLY
Safe Effect Equivalence

Sandboxed
DOES_NOT_EQUAL
Deterministic

Deterministic
DOES_NOT_EQUAL
Safe

Safe
DOES_NOT_EQUAL
Side-Effect Free

Virtual Effect Success
DOES_NOT_EQUAL
Real-World Success

Hybrid Live Escape
REDUCES
Replay Causal Confidence

Service Worker
MAY_BYPASS
Browser Native Route Interception

Counterfactual New Action
REQUIRES
Simulator Or Controlled Environment
```

---

# 本輪結束回答

**缺哪一層？**  
Digital Twin / Stateful Fork 層：目前可以重播「看過的世界」，但對全新的 counterfactual tool action 還缺可靠的 synthetic environment response。

**哪個節點最淺？**  
`EffectSimulatorCalibration`、`StatefulMCPServerSnapshot`、`WebSocketReplayFidelity`。

**哪個概念仍主要只是工程名詞？**  
`ReplayWorldBoundaryCertificate`、`EffectVirtualizationEnvelope`、`WorldCoverageScore`。

**哪個系統最值得讀原始碼？**  
AgentReplay 的 `hashing.py / cassette.py / interceptors/http.py / mutate.py`，再接 Playwright network/storage implementation；mitmproxy replay matching 是 transport 層的重要參照。

**哪篇論文需追引用？**  
`Deterministic Replay for AI Agent Systems` 與 `Branching Policy Optimization`：前者追 transport/world capture，後者追 snapshot/fork 如何成為 Agent learning primitive。

**哪個概念最適合視覺模擬？**  
`Replay World Boundary & Effect Virtualization Lab`。

**哪個 Agent 架構最值得實作？**  

> **World-Isolated Counterfactual Agent Runtime = Replay Mode Router + Capability Sandbox + Snapshot/Fork Layer + Schema-Aware Request Identity + HTTP/Browser/MCP Interceptors + Strict Egress Firewall + External Effect Virtualizer + Replay Fidelity Auditor。**

---

## 本輪對「AI 到底怎麼運作」新增的一層

從使用者一句話出發，Agent 不只是在「模型 → tool → 回答」：

```text
User
→ UI
→ Agent State
→ Reasoning / Planning
→ Tool Intent
→ Capability Sandbox
→ Browser / Network / MCP Runtime
→ External World
→ Observation
→ State Update
→ Next Decision
```

而如果我們想真正研究「為什麼 AI 做了這個決定」，必須能把中間的外部世界也 freeze / fork / replay：

```text
Same Agent State
+
Same Exogenous World
+
Controlled Tool/Browser/Network Runtime
+
One Deliberate Intervention
→
Observed Decision Difference
```

否則看到的差異可能只是網站變了、API 回傳變了、WebSocket 晚到、cookie 過期、Service Worker 攔截、資料庫狀態漂移，甚至 counterfactual branch 偷偷碰到了真實世界。
