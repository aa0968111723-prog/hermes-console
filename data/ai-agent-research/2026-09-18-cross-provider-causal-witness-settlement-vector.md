# 【AI Agent × Multimodal Research Report】

**時間：2026-09-18 03:55（Asia/Taipei）**

**本輪主題：Cross-Provider Causal Witness × Settlement Vector × Unresolved Cut × Proof-Carrying Workflow Completion**

## 與歷史研究比較

上一輪已建立 `WorkflowSettlementGraph / ExecutionFrontier / KnowledgeFrontier / SettlementFrontier / CompensationClosure / UnresolvedEffectCut`，缺口是：跨 Payment、DB、Email、SaaS、MCP 的 provider 沒有共同 revision 或 clock，如何證明 E1 的 settlement 真正 precedes E2，而不是僅用本地 wall-clock 猜測。本輪不重複單一 effect receipt/read-back，而研究「異質 provider 的 causal witness 如何組合」。

---

## 本小時新發現

### 新底層機制：Cross-Provider Causal Witness（Hermes proposal）

不要試圖建立一個虛假的 universal provider clock。每條跨 provider dependency 應保存一個 proof-carrying edge：

```text
CausalWitness {
  predecessor_effect_id
  predecessor_settlement_proof_id
  predecessor_native_revision?
  predecessor_receipt_hash
  consumer_effect_id
  consumer_intent_hash
  admitted_at_runtime_seq
  dependency_token
}
```

`E1 -> E2` 的含義不再是 `timestamp(E1) < timestamp(E2)`，而是「E2 被授權/建立時，明確引用一份當時已被 Runtime 接納的 E1 settlement proof」。

### 新架構：Settlement Vector

對 workflow DAG 的 required effects 保存：

```text
SV(W) = {
  E1: SETTLED@proof17,
  E2: IN_DOUBT@attempt4,
  E3: COMPENSATED@proof31,
  E4: BLOCKED_BY(E2)
}
```

它不是 vector clock 的直接替代，而是 heterogeneous effect 的 **proof-state vector**。Provider-native revision 保留在各 node；跨 provider causal relation由 witness edge 表達。

### 新 GitHub 原始碼發現：durable-agent-outbox reducer

`packages/core/src/reduce.ts` 明確把 reducer 設計為 pure/synchronous、無 I/O、無內建 clock/randomness；所有時間與 audit sequence 都由 context 注入，因此決策可 deterministic replay。它也把 imperative shell 與 correctness kernel 分離：shell 只提出 observation/command，reducer 決定該 observation 合法意味著什麼。

更關鍵的是兩條 load-bearing rules：
1. `IN_DOUBT` 只能被 authoritative receipt 解決；timeout/retry/optimistic guess 都不行。
2. outcome unknown 時收到 withdrawal，只記錄、不套用；必須等 receipt 決定 effect 是否已 crossing boundary。

另外 reducer 註解明確指出 actions 被設計成彼此獨立，cross-action concerns 留給 shell。這正是 Hermes 本輪要補的上層：**per-effect correctness kernel 之上需要 workflow causal proof composer**。

來源：
- https://github.com/mstevens843/durable-agent-outbox/blob/main/packages/core/src/reduce.ts

---

## 本小時最重要 5 個發現

### 1. 跨 provider causal order 不能靠 wall-clock 拼接

**工程推論，建立在 distributed-system causal ordering 與 provider-native settlement evidence 上。**

Payment receipt time、DB revision、Email provider message state、SaaS webhook arrival time的 clock domain/consistency 都不同。Hermes 不應宣稱有一條全域 total order；真正需要的是 required dependency 的 partial order + proof-carrying edge。

```text
E1 SETTLED
  ↓ witness(proof(E1))
E2 ADMITTED
```

只要 E2 的 admission record cryptographically/immutably references E1 proof identity，就能證明 Runtime 的 causal dependency，而不必假裝兩個 provider 有共同 clock。

背景交叉來源：
- Chrono: A Peer-to-Peer Network with Verifiable Causality, Yiqing et al., 2023, https://arxiv.org/abs/2310.08373
- Temporal consistency / logical vector-clock literature（本輪只作 distributed-systems mechanism reference，不把 permissionless/BFT claims直接套到 SaaS）。

### 2. Per-effect deterministic reducer 與 workflow proof composer 應分層

**已確認原始碼 + Hermes architecture proposal。**

`durable-agent-outbox` reducer只看一個 action，cross-action concerns 故意在 shell；這使 correctness kernel保持 pure、deterministic、replayable，但也表示 workflow completion 不能由 reducer單獨回答。

Hermes 應採：

```text
Provider Event
→ Per-Effect Reducer
→ Effect State + Audit Events
→ Workflow Proof Composer
→ Dependency Closure
→ Settlement Vector
→ Completion Verdict
```

這比讓 LLM直接看多個 tool status後自行說「完成」更可驗證。

### 3. Settlement Vector 應保存 proof identity，不只 status

**Hermes proposal。**

錯誤：
```text
E1=SETTLED, E2=SETTLED
```

較可靠：
```text
E1=SETTLED(proof=P17, provider_rev=R91)
E2=SETTLED(proof=P22, depends_on=P17)
```

若 P17 後來被 supersede/revoke，Runtime 可沿 `depends_on` 找到受污染的 E2/E3，而不是重新猜整條 workflow。

### 4. Tool receipt 能證明「工具確實執行/回傳」，但不自動證明整個 workflow causal closure

**論文結果 + architecture inference。**

`Tool Receipts, Not Zero-Knowledge Proofs` 提出 HMAC-signed tool execution receipts，並在 NyayaVerifyBench 報告對 fabricated tool references、count misstatements、false absence claims 的檢測能力；這支持 receipt 作為 evidence primitive。但 Hermes 還必須在 receipt之上建立 dependency/settlement graph，因為單張 receipt 不回答「這個 effect 是否在正確 predecessor settled 後才被允許」。

論文：Abhinaba Basu, 2026, https://arxiv.org/abs/2603.10060

### 5. MCP annotations 仍只能做 preflight risk hint，不能取代 EffectContract / SettlementProof

**官方 SDK / MCP 資訊。**

MCP tool annotations提供 `readOnlyHint / destructiveHint / idempotentHint / openWorldHint`；官方資料強調這些是 hints，不是安全保證。Hermes 因此維持上一輪決策：annotations 可影響 risk policy，但 external effect correctness仍需 `EffectContract + receipt/read-back + settlement proof`。

來源：
- https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/mcp.html
- https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/

---

## Architecture Breakdown

### Proof-Carrying Workflow Runtime

```text
User Intent
↓
Planner
↓
Effect DAG
↓
EffectContract per node
↓
Per-Effect Correctness Kernel
  ├ durable intent
  ├ attempt
  ├ IN_DOUBT
  ├ receipt
  └ settlement proof
↓
Causal Witness Builder
↓
Workflow Proof Composer
↓
Settlement Vector
↓
Unresolved Cut
↓
Completion / Block / Compensate / Escalate
```

跨 provider edge：

```text
Provider A
E1 → Receipt R1 → Proof P1
                  │
                  └── CausalWitness W12
                       │
Provider B             ↓
                    Intent E2
                       ↓
                    Receipt R2
                       ↓
                    Proof P2
```

`W12` 是 Runtime 可驗證的 causal admission evidence，而不是 provider clock comparison。

---

## Bottom-Level Logic

### Intent → Tool → External Effect → Causal Settlement

```text
Intent
→ Tool Schema
→ Tool Selection
→ Arguments
→ EffectContract
→ Durable Intent Commit
→ Admission Check(predecessor proofs)
→ Dependency Token
→ Execution
→ Runtime Observation
→ Receipt / Read-back
→ Provider-native Revision
→ Postcondition
→ SettlementProof
→ Per-Effect Reducer
→ Settlement Vector Update
→ Causal Closure Check
→ Next Decision
```

### Workflow completion predicate（Hermes proposal）

```text
WorkflowComplete(W) :=
  ∀ required effect e:
      Settled(e)
  ∧ ∀ dependency (p → e):
      ValidCausalWitness(p,e)
  ∧ UnresolvedCut(W) = ∅
  ∧ CompensationClosure(W) = PASS
```

其中 `ValidCausalWitness(p,e)` 不要求 provider clocks comparable；它要求 e 的 admission evidence引用一份當時有效的 predecessor proof。

---

## Visual Simulation Idea

### Causal Settlement Vector Simulator

畫面同時顯示：

```text
EFFECT DAG
E1 ─→ E2 ─→ E4
 └──→ E3 ──┘

SETTLEMENT VECTOR
E1  SETTLED P17
E2  IN_DOUBT
E3  SETTLED P23
E4  BLOCKED

CAUSAL WITNESS
P17 ──W12──> E2
P17 ──W13──> E3

UNRESOLVED CUT
      ▲ E2
```

可注入：late receipt、receipt supersession、duplicate retry、provider revision advance、stale read-back、missing dependency token、compensation settled、cross-provider concurrent execution。

互動後即時顯示：
- Execution Frontier
- Settlement Frontier
- Knowledge Frontier
- Settlement Vector
- Valid / Broken Causal Witness
- Unresolved Cut
- Completion Proof

---

## Code / GitHub

### durable-agent-outbox
Repository: https://github.com/mstevens843/durable-agent-outbox

本輪值得繼續讀：
- `packages/core/src/reduce.ts` — deterministic correctness kernel
- `packages/core/src/transitions.ts` — legal state transitions
- `packages/core/src/ports.ts` — receipt/provider boundary
- `packages/core/src/types.ts` — Receipt / Action / revision IR
- audit legality checker — 驗證 event history是否可能由合法 state machine產生

本輪確認 `reduce.ts` 的核心架構價值：I/O shell與pure reducer分離，時間/sequence顯式注入，illegal transition拒絕，`IN_DOUBT`只允許 authoritative receipt 解決。

---

## Papers

### Tool Receipts, Not Zero-Knowledge Proofs: Practical Hallucination Detection for AI Agents
- Author: Abhinaba Basu
- Year: 2026
- URL: https://arxiv.org/abs/2603.10060
- Architecture: signed tool execution receipts + epistemic claim classification + claim/receipt cross-check
- Dataset: NyayaVerifyBench, 1,800 agent-response scenarios
- Contribution: 將 tool execution evidence變成可驗證 receipt，降低 agent fabricated execution/result claims
- Limitation for Hermes: receipt本身不是跨 provider causal settlement proof；還需要 effect identity、dependency、read-back/postcondition、workflow composition。

### Agentic Transaction: Towards ACID-Compliant Agent Systems
- Authors: Zhaoyan Sun, Xiaoxiao Wang, Guoliang Li
- Year: 2026
- URL: https://arxiv.org/abs/2608.13900
- Architecture: Semantic Atomicity / Consistency / Isolation / Durability
- Contribution: 把長期 agent execution正式提升到 transaction-level correctness問題
- Limitation for本輪問題: heterogeneous provider causal witness與 settlement vector仍需 Runtime層具體化。

### Chrono: A Peer-to-Peer Network with Verifiable Causality
- Authors: Michael Hu Yiqing, Guangda Sun, Arun Fu, Akasha Zhu, Jialin Li
- Year: 2023
- URL: https://arxiv.org/abs/2310.08373
- Architecture: verifiable logical-clock construction for decentralized network
- Contribution: 證明 causality本身可以成為可驗證 artifact
- Limitation: permissionless/P2P assumptions不能直接套到普通 SaaS/MCP；Hermes只借鑑「causal witness應可驗證」的底層思想。

---

## Unknown / Open Questions

1. `CausalWitness` 要用 runtime audit sequence、hash chain、signed receipt reference，還是更強的 cryptographic transparency log？
2. predecessor proof 被 provider後續 supersede 時，如何計算最小 tainted descendant set，而不是整個 workflow全部 invalid？
3. multi-agent concurrent workflows共享同一 external resource 時，Settlement Vector如何與 isolation/concurrency control合併？

---

## 下一輪研究

優先進入 **Multi-Agent Concurrency × Settlement Isolation**：

```text
Workflow A Settlement Vector
          ↘ shared resource
Workflow B Settlement Vector
→ conflict detection
→ semantic dependency
→ minimal invalidation
→ repair / compensation
→ serializability-like proof
```

直接追 2026 `CoAgent: Concurrency Control for Multi-Agent Systems`，並尋找原始碼/implementation，拆它如何利用 LLM判斷 conflicting write是否真的 invalidate plan；同時比較 OCC、locks、MVCC、semantic repair在長 inference agent transaction上的成本。

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `CrossProviderCausalWitness`
- `DependencyToken`
- `SettlementVector`
- `ProofStateVector`
- `ProofCarryingEffectEdge`
- `WorkflowCompletionProof`
- `CausalAdmissionRecord`
- `ProofSupersessionPropagation`
- `PerEffectCorrectnessKernel`
- `WorkflowProofComposer`

### Edges
- `SettlementProof --authorizes--> CausalAdmissionRecord`
- `CausalAdmissionRecord --admits--> EffectIntent`
- `CrossProviderCausalWitness --proves_dependency--> EffectDependency`
- `EffectNode --contributes_to--> SettlementVector`
- `SettlementVector --exposes--> UnresolvedEffectCut`
- `ProofSupersession --taints--> DependentEffect`
- `WorkflowProofComposer --produces--> WorkflowCompletionProof`

---

## 本輪結束診斷

- **缺哪一層：** Multi-Agent concurrent workflow 的 isolation / conflict correctness。
- **哪個節點最淺：** `ProofSupersessionPropagation`，尤其 provider-native proof被撤回/更新後的最小污染範圍。
- **哪個概念仍只是名詞：** `SettlementVector` 目前是 Hermes IR proposal，尚非通用標準。
- **哪個系統值得讀原始碼：** `durable-agent-outbox` 繼續讀 audit legality + worker/receipt ingestion；下一個是 CoAgent implementation。
- **哪篇論文需追引用：** CoAgent（2026）與 Agentic Transaction（2026），因為下一個缺口是 semantic isolation + transactional agent concurrency。
- **哪個概念最適合視覺模擬：** `Causal Settlement Vector Simulator`。
- **哪個 Agent 架構最值得實作：** `Per-Effect deterministic reducer + Workflow Proof Composer + Causal Witness Builder`，比單純在 LLM prompt內做 transaction reasoning更可驗證。

## 本輪核心結論

跨 provider Agent workflow 不應追求不存在的「共同真實 clock」。更可靠的做法是保留每個 provider自己的 native evidence/revision，再讓每個 downstream effect在 admission時攜帶 predecessor settlement proof的 identity，形成 proof-carrying causal edge。如此 Hermes才能從「E1/E2都顯示成功」提升到「E2確實是在一份有效的 E1 settlement proof之後才被授權」，並把整個 workflow完成條件變成可計算、可回放、可失效傳播的 causal proof graph。