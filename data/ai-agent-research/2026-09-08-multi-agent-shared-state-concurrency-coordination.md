# AI Agent × Multimodal Research Report

時間：2026-09-08 18:53 Asia/Taipei

主題：Multi-Agent × Shared State × Coordination Runtime × Concurrency Control

## 與歷史研究比較

本輪直接接續上一輪 `reasoning-planning-runtime-dag-scheduling`，避免再重複 ReAct / ReWOO / LLMCompiler 的基本比較。上一輪已建立：Goal → Planning IR → Dependency DAG → Scheduler → Action Router → Verification。本輪補足其中最薄弱的部分：**當多個 Agent / Worker 真正並行時，誰擁有 state、誰可以寫入、訊息如何送達、同時寫入如何合併、何時構成 race condition、何時應由模型協調、何時必須由 Runtime 使用傳統 concurrency control。**

前序研究鏈：

Agent Runtime → Memory/Context → Multimodal Runtime → Fusion/Cache → Computer Action → World State Verification → Permission/Transaction → Planning DAG → **Multi-Agent Shared-State Concurrency（本輪）**

---

## 本小時新發現

### 新架構：Multi-Agent Runtime 不等於多個聊天視窗

目前可驗證的 production-style runtime 已呈現三種底層拓撲：

1. **Message-passing runtime**：Agent 擁有私有 state，透過 Runtime 傳遞 typed messages；AutoGen Core 是明顯例子。
2. **Shared graph state + reducer**：多節點在 super-step 中產生更新，由 Runtime 依 channel/reducer semantics 合併；LangGraph Pregel 是代表。
3. **Shared mutable workspace / external world**：多 Agent 直接讀寫相同 repo、文件、DB、Kubernetes、browser state；此時傳統 lost update / stale read / deadlock 會真實出現，2026 新研究開始把它當作一級問題。

### 新論文：SILO-BENCH（ACL 2026）

研究顯示 Agent 即使積極交換資訊，也可能無法把分散資訊整合成正確答案，形成 **Communication–Reasoning Gap**。這表示「多傳訊息」不等於「分散式推理成功」。

Paper: https://aclanthology.org/2026.acl-long.1354/
Code: https://github.com/jwyjohn/acl26-silo-bench

### 新 benchmark：DPBench

DPBench 把 Dining Philosophers 型 resource contention 引入 Multi-Agent LLM，結果顯示 sequential coordination 與 simultaneous coordination 的表現差異很大；作者把部分失敗歸因於 convergent reasoning：多個 Agent 獨立得到相同策略，反而一起造成 deadlock。

Paper: https://arxiv.org/abs/2602.13255
Code: https://github.com/najmulhasan-code/dpbench

### 新系統方向：Concurrency Control as Agent Runtime primitive

2026 的 position / systems papers開始把 stale read、lost update、write-write conflict、deadlock、serializability 直接映射到 LLM multi-agent systems。這個方向比「讓 Agent 多溝通」更底層：**Runtime 必須知道 shared resource 的版本、read/write footprint、ownership 或 reducer semantics。**

Position paper: https://arxiv.org/abs/2608.18092
CoAgent: arXiv 2606.15376
S-Bus: arXiv 2605.17076

---

# 本小時最重要 5 個發現

## 1. Multi-Agent 的第一個底層分界不是角色，而是 State Ownership

必須先問：

```text
Agent A state 是否只屬於 A？
Agent B 能不能直接讀？
共享資料是 message、snapshot、channel，還是 live mutable object？
```

可建立四種 state ownership：

```text
State Ownership
├ Agent-Local State
├ Message-Carried State
├ Runtime Shared State
└ External Shared Mutable State
```

AutoGen Core 的底層更接近：

```text
Agent A private state
        ↓ message
Agent Runtime
        ↓ route
Agent B private state
```

官方文件明確指出 messages 是 agents 溝通的唯一方式；Agent instance 可以被 runtime 放在不同 process / machine，因此 framework 不鼓勵直接拿另一個 agent instance 呼叫方法。Runtime 管理 identity、lifecycle、delivery。

Sources:
- https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/message-and-communication.html
- https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/core-concepts/architecture.html
- https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/distributed-agent-runtime.html

**為什麼重要**：若 Hermes 未來要同時跑 Research Worker、Coding Worker、Browser Worker，不應讓它們共享一個任意可變 Python/JS object。應先明確界定 local state、message state、shared committed state。

**限制**：Message-passing 可降低 shared-memory race，但仍可能在外部 side effects 上發生競爭，例如兩個 worker 同時修改 GitHub 同一檔案。

---

## 2. Shared State 必須有 Merge Semantics，否則「平行」只是 race condition

LangGraph 的 Pregel / StateGraph 是很好的反例證據：它不是讓兩個 node 直接改同一個 dict。

State channel 可以配置 reducer。`BinaryOperatorAggregate` 的 `update(values)` 會把同一批更新透過 binary operator 合併；若同一 super-step 中出現超過一個 `Overwrite`，原始碼會直接拋 `INVALID_CONCURRENT_GRAPH_UPDATE`。

Core source:
- https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/channels/binop.py
- https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/graph/state.py
- https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/pregel/main.py

底層可以畫成：

```text
State_t
  ↓ snapshot
┌───────────────┐
│ Node A        │ → update A
│ Node B        │ → update B
│ Node C        │ → update C
└───────────────┘
         ↓
Channel / Reducer
         ↓
State_t+1
```

這與直接 shared mutation 完全不同：

```text
BAD / ambiguous
A ─┐
   ├→ same mutable object
B ─┘
```

**重要性**：多 Agent parallelism 的核心不是「一起跑」，而是 **並行產生 proposal / delta，再由 deterministic runtime 合併**。

---

## 3. Communication 不等於 Coordination；真正瓶頸可能在 Distributed State Integration

SILO-BENCH 在 30 個 algorithmic tasks、3 種 communication complexity、54 configurations / 1,620 experiments 中觀察到 Communication–Reasoning Gap：agents 會積極形成 communication topology、交換資訊，但在需要整合分散 state 時仍失敗；高複雜度與大量 agents 時 coordination overhead 甚至消除 parallelism 的效益。

這代表：

```text
Message delivered = TRUE
```

並不能推出：

```text
Shared belief converged = TRUE
Global answer correct = TRUE
```

應拆成：

```text
Communication Layer
→ Delivery
→ Information Availability
→ State Integration
→ Joint Decision
→ Coordinated Action
```

失敗可分：

```text
Delivery Failure
Information Loss
Integration Failure
Consensus Failure
Execution Conflict
```

而不是全部叫「Multi-Agent 溝通失敗」。

Source:
https://aclanthology.org/2026.acl-long.1354/

---

## 4. Concurrent Agent 需要 classical concurrency primitives，而不是期待 LLM 自發避開衝突

DPBench 的 Dining Philosophers 類設定說明：多 Agent 同時決定時，即使單體模型能力夠強，也可能一起做出局部合理、全域死鎖的選擇。

因此 Hermes Runtime 應新增：

```text
Resource Coordinator
├ Lease / Ownership
├ Version
├ Read Set
├ Write Set
├ Conflict Detector
├ Commit Order
├ Deadlock Detector
└ Retry / Replan Policy
```

最小 conflict 類型：

```text
RAW = Read After Write dependency
WAR = Write After Read hazard
WAW = Write After Write conflict
Stale Read
Lost Update
Deadlock
Duplicate Side Effect
```

例如兩個 Coding Agents：

```text
A reads README v10
B reads README v10
A writes README v11
B writes README v11b
```

如果 B 的 write 沒有 version check：A 的修改可能直接被覆蓋。

可靠版：

```text
read(version=10)
↓
propose patch
↓
commit(expected_version=10)
↓
A succeeds → version 11
B commit sees version mismatch
↓
REBASE / REPLAN
```

這是 **optimistic concurrency control (OCC)** 型思路。

合理工程推論：對 LLM agent，長推理時間讓 lock-based 2PL 特別昂貴；OCC 又可能因重跑模型而成本很高，所以未來需要 agent-aware conflict repair，而非單純 transaction abort。

Relevant 2026 work:
- CoAgent: arXiv:2606.15376
- S-Bus: arXiv:2605.17076
- Position: arXiv:2608.18092

---

## 5. 多 Agent 是否比單 Agent 強，必須拆成 Parallelism、Specialization、Compute 三個來源

不應看到 multi-agent benchmark 上升就直接解讀成「合作產生智慧」。

至少有三種混雜因素：

```text
Multi-Agent Gain
├ Parallelism Gain
├ Role / Tool Specialization Gain
└ Extra Test-Time Compute Gain
```

還有成本：

```text
Coordination Cost
├ Message tokens
├ State serialization
├ Synchronization wait
├ Merge / verification
├ Conflict recovery
└ Duplicate reasoning
```

SILO-BENCH 顯示 agent count 增加可使 coordination overhead 超過 parallelism gain。ALEM 2026 也把 coordination competence 與 base-task competence 分離評估，說明單體能力不代表協作能力。

Sources:
- https://aclanthology.org/2026.acl-long.1354/
- https://arxiv.org/abs/2606.08340

---

# Architecture Breakdown

## Hermes Multi-Agent Coordination Runtime v0

```text
User Goal
↓
Planner / DAG Compiler
↓
Task Graph
↓
Coordinator
├ task queue
├ worker registry
├ leases
├ dependencies
└ resource footprints
↓
Worker Pool
├ Research Worker
├ Coding Worker
├ Browser Worker
└ Verification Worker
↓
Agent-local Context / State
↓
Typed Message / Result Delta
↓
Shared State Commit Layer
├ reducer
├ version check
├ ownership
├ conflict detector
└ provenance
↓
Committed Shared State
↓
Verifier / Joiner
↓
Continue / Replan / Finish
```

對 external resources：

```text
Worker
↓
Action proposal
↓
Resource Coordinator
↓
Permission / Transaction Gate
↓
GitHub / DB / Browser / MCP
↓
Observed version / effect
↓
Commit Ledger
```

這會把上一輪的 Planning DAG 與前一輪的 Transaction / Verification 串起來。

---

# Bottom-Level Logic

## 一次 shared-state parallel step 真正怎麼跑

假設目前 state：

```json
{
  "papers": [],
  "github_findings": [],
  "summary": null
}
```

Scheduler 同時啟動：

```text
Worker A → 找 papers
Worker B → 查 GitHub
```

兩個 Worker 都讀到 State version 42。

它們不應直接 mutate state；而是產生 delta：

```json
A = {
  "base_version": 42,
  "writes": {
    "papers": ["paper-X"]
  }
}
```

```json
B = {
  "base_version": 42,
  "writes": {
    "github_findings": ["file-Y"]
  }
}
```

Commit layer：

```text
1. Compare base version
2. Calculate write sets
3. Check intersect(write_A, write_B)
4. If disjoint → merge
5. If same field and reducer exists → reducer
6. If same field no reducer → CONFLICT
7. Increment state version
8. Emit committed event
```

結果：

```json
{
  "version": 43,
  "papers": ["paper-X"],
  "github_findings": ["file-Y"],
  "summary": null
}
```

若兩者都寫 `summary`：

```text
A.write_set = {summary}
B.write_set = {summary}
↓
WAW CONFLICT
```

可選策略：

```text
Reducer merge
Priority ownership
Supervisor arbitration
Versioned replan
Human arbitration
```

而不是 last-write-wins 默默覆蓋。

---

# System Architecture Deep Dive：AutoGen Core Distributed Runtime

官方架構：

```text
              Host Service
             /     |      \
            /      |       \
     Worker 1   Worker 2   Worker 3
       Agent A    Agent B    Agent C
```

Host：
- 維護 worker connections
- message delivery
- direct-message sessions
- 根據 worker advertisements 找到 agent type

Worker Runtime：
- 執行 agent application code
- 向 host 註冊可提供的 agents
- 收發 message

Agent：
- 由 Runtime lifecycle 管理
- 以 AgentId 定址
- save_state/load_state 為 JSON-serializable state

Communication：
- Direct Message：1 → 1
- Topic / Subscription：publish-subscribe 1 → N

Sources:
- https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/distributed-agent-runtime.html
- https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/core-concepts/topic-and-subscription.html
- https://microsoft.github.io/autogen/stable/reference/python/autogen_core.html

### 它解決什麼

它明確解決：identity、message routing、agent lifecycle、distributed process boundary。

### 它沒有自動解決什麼

message bus 不自動解決：
- shared Git conflict
- DB lost update
- browser action conflict
- semantic merge
- global consensus

也就是：

```text
Distributed Runtime
≠
Distributed Consistency Protocol
```

---

# Visual Simulation Idea

## Multi-Agent Concurrency X-Ray

Hermes Console 建議新增一個 simulation tab：

```text
        Worker A            Worker B
        READ v42            READ v42
           │                   │
           ↓                   ↓
       write summary       write summary
           │                   │
           └──────┬────────────┘
                  ↓
             CONFLICT
                  ↓
       ┌──────────┼──────────┐
       ↓          ↓          ↓
     MERGE      REPLAN    ARBITRATE
```

畫面即時顯示：

- Agent ID / Worker ID
- local context version
- shared state version
- read set
- write set
- lease owner
- pending messages
- stale reads
- reducer used
- conflict type
- commit order
- blocked time
- retry tokens
- coordination overhead

提供 Failure Injection：

```text
Stale state
Lost update
Two agents edit same file
Message delay
Duplicate delivery
Worker crash
Deadlock
Supervisor crash
```

再加一個「單 Agent vs 多 Agent」對照：

```text
Wall-clock latency
Model calls
Message tokens
Conflict count
Useful parallelism
Coordination overhead
Final correctness
```

這能直接回答：**這次多開 5 個 Agent 到底是真的變快，還是只是用了 5 倍 token？**

---

# Code / GitHub

## LangGraph

Repo: https://github.com/langchain-ai/langgraph

值得繼續讀：

```text
libs/langgraph/langgraph/
├ channels/
│  ├ binop.py
│  └ base.py
├ graph/state.py
└ pregel/
   ├ main.py
   └ _write.py
```

本輪已直接追 `channels/binop.py`：
- `BinaryOperatorAggregate`
- `update(values)`
- reducer application
- Overwrite semantics
- `INVALID_CONCURRENT_GRAPH_UPDATE`

這是 Hermes Shared State Engine 最值得參考的實作之一。

## AutoGen

Docs/source targets：

```text
autogen_core
├ AgentRuntime
├ AgentId
├ MessageContext
├ TopicId
├ Subscription
└ save_state/load_state

autogen_ext.runtimes.grpc
├ GrpcWorkerAgentRuntimeHost
└ GrpcWorkerAgentRuntime
```

值得研究的是 **message topology / lifecycle**，而不是 AgentChat 的角色提示詞。

## 2026 concurrency research repos

DPBench:
https://github.com/najmulhasan-code/dpbench

SILO-BENCH:
https://github.com/jwyjohn/acl26-silo-bench

後續要優先追 CoAgent / S-Bus 是否有可用 reference implementation，特別查看：
- conflict detection
- read-set/write-set reconstruction
- rollback/compensation
- serialization order
- agent-aware repair

---

# Papers

## SILO-BENCH: A Scalable Environment for Evaluating Distributed Coordination in Multi-Agent LLM Systems

Authors: Yuzhe Zhang, Feiran Liu, Yi Shan, Xinyi Huang, Xin Yang, Yueqi Zhu, Xuxin Cheng, Cao Liu, Ke Zeng, Terry Jingchen Zhang, Wenyuan Jiang
Venue: ACL 2026 Long Papers
Year: 2026
URL: https://aclanthology.org/2026.acl-long.1354/
Code: https://github.com/jwyjohn/acl26-silo-bench
Dataset/Benchmark: 30 algorithmic tasks, 3 communication-complexity levels
Architecture focus: distributed information silos + free-form agent communication
Contribution: 把 communication 與真正 distributed reasoning 分離評估，提出 Communication–Reasoning Gap。
Limitation: algorithmic coordination benchmark 與 GUI / coding / production side-effect workloads 有 domain gap。
改變了什麼：證明 agent 數量與訊息密度本身不是可靠 scaling law。

## DPBench: Large Language Models Struggle with Simultaneous Coordination

Authors: Najmul Hasan, Prashanth BusiReddyGari
Year: 2026
URL: https://arxiv.org/abs/2602.13255
Code: https://github.com/najmulhasan-code/dpbench
Dataset/Benchmark: Dining-Philosophers-style simultaneous resource contention
Architecture focus: concurrent decision / communication protocol / resource allocation
Contribution: 把 deadlock 與 simultaneous coordination 變成可驗證 Agent benchmark。
Limitations: synthetic resource-contention environment，不代表所有 Multi-Agent workload。
改變了什麼：強化「coordination protocol 是 system design，不只是 model intelligence」的證據。

## Position: Multi-Agent Systems Should Prioritize Concurrency Control

Authors: Xin Yang, Letian Li, Zimo Ji, Terry Jingchen Zhang, Wenyuan Jiang
Year: 2026
URL: https://arxiv.org/abs/2608.18092
Architecture: classical concurrency anomalies mapped to LLM multi-agent shared state
Contribution: 主張 conflict detection / isolation / structured state access 應成為 MAS first-class primitive。
Limitations: position paper，需透過 production benchmarks 與 systems implementation 繼續驗證。

## S-Bus: Automatic Read-Set Reconstruction for Multi-Agent LLM State Coordination

Year: 2026
URL: https://arxiv.org/abs/2605.17076
Architecture: HTTP middleware + DeliveryLog + read-set reconstruction
Contribution: 嘗試在不修改 agent SDK 的情況下從 HTTP GET traffic 重建 read set，針對 structural race conditions 提供 consistency property。
Limitations: HTTP-observable read set 不必然等於 agent 真正語義依賴的所有資訊。

## CoAgent: Concurrency Control for Multi-Agent Systems

Authors: Hongtao Lyu, Dingyan Zhang, Mingyu Wu, Xingda Wei, Haibo Chen
Institution: Shanghai Jiao Tong University
Year: 2026
arXiv: 2606.15376
Architecture: agent-aware concurrency control / speculative writes / conflict notification / repair / saga-style inverse
Contribution: 探索傳統 2PL/OCC 對長時間 LLM inference 不理想時，如何讓 Runtime 通知 Agent 做局部 repair。
Limitations: paper benchmark 結果仍需更多獨立 replication 與 heterogeneous tools 驗證。

---

# Unknown / Open Questions

1. **Shared State 的標準 IR 是什麼？**
   Event log、CRDT、versioned JSON state、graph channels、DB transaction 各自適合不同 workload；目前沒有 Agent 通用標準。

2. **如何取得可靠 semantic read/write set？**
   Tool schema 可以知道 API 層寫了哪個 resource，但模型的 reasoning 依賴了哪些舊資訊很難靜態知道。S-Bus 用 network traffic reconstruction，CoAgent 類方法則需要 tool footprint / repair semantics；這仍是關鍵研究缺口。

3. **Multi-Agent gain 怎麼公平去除 extra compute？**
   應固定 total tokens / model calls / wall-clock / tool budget，才能知道提升到底來自 coordination 還是單純算更多次。

---

# Knowledge Graph 新增 Node / Edge

```text
Multi-Agent Runtime
├ Worker Registry
├ Agent Identity
├ Message Router
├ Topic / Subscription
├ Task Lease
├ Shared State
├ State Version
├ Reducer
├ Commit Layer
├ Conflict Detector
├ Deadlock Detector
└ Result Joiner
```

```text
Concurrency Anomaly
├ Stale Read
├ Lost Update
├ WAW Conflict
├ RAW Dependency
├ WAR Hazard
├ Duplicate Effect
└ Deadlock
```

```text
Coordination Topology
├ Central Supervisor
├ Message Passing
├ Blackboard / Shared Workspace
├ DAG Worker Pool
├ Pub/Sub
└ Decentralized Shared Context
```

新增 edges：

```text
Planning IR
--creates-->
Task Graph

Task Graph
--scheduled by-->
Coordinator

Coordinator
--assigns lease to-->
Worker

Worker
--reads-->
State Version

Worker
--produces-->
State Delta

State Delta
--merged by-->
Reducer / Commit Layer

Concurrent Writes
--may cause-->
Conflict

Conflict
--triggers-->
Rebase / Replan / Arbitration

Message Delivery
--does not guarantee-->
State Integration

Agent Count
--increases-->
Potential Parallelism

Agent Count
--also increases-->
Coordination Overhead
```

---

# 下一輪研究

下一輪應進入：**Agent Communication Protocol × A2A × MCP × Event Bus × Distributed Runtime**。

不是介紹協定名稱，而是直接比較 wire-level / runtime-level semantics：

```text
Agent A
↓
message envelope
├ sender
├ receiver/topic
├ task/session id
├ causality/version
├ content
├ artifact refs
├ auth
└ trace id
↓
transport
↓
router
↓
delivery semantics
├ at-most-once
├ at-least-once
└ retry/dedup
↓
Agent B
```

需回答：
- MCP 是 tool protocol，A2A 是 agent delegation / communication，兩者底層邊界在哪？
- message delivery 是 at-most-once 還是 at-least-once？
- retry 如何避免 duplicate side effects？
- distributed tracing 如何跨 Agent / Tool / MCP / Browser？
- causal order / Lamport clock / event log 是否值得進入 Hermes？
- multi-principal agent 的 identity / authority 如何穿過 message bus？

---

# 本輪結束檢查

**缺哪一層：** Distributed message semantics（delivery / dedup / causal ordering）。

**哪個節點最淺：** Semantic Read/Write Set reconstruction。

**哪個概念仍只是名詞：** CRDT 對 LLM shared state 的實際適用邊界。

**哪個系統值得讀原始碼：** LangGraph Pregel channels / writes、AutoGen distributed runtime、CoAgent / S-Bus reference implementation。

**哪篇論文需追引用：** SILO-BENCH → concurrency-control / shared-state coordination follow-ups；DPBench → protocol-aware coordination work。

**哪個概念最適合視覺模擬：** Multi-Agent Concurrency X-Ray（State Version + Read/Write Set + Race/Deadlock + Commit Timeline）。

**哪個 Agent 架構最值得實作：** `DAG Scheduler + Agent-local State + Typed Messages + Versioned Shared State + Reducer/Conflict Detector + Verification`，而不是自由聊天式 swarm。

核心結論：

> **可靠 Multi-Agent 系統的關鍵不在於讓更多模型互相說話，而在於 Runtime 是否明確定義 State Ownership、Message Semantics、Commit Semantics 與 Conflict Resolution。多 Agent 的問題，本質上開始變成一個分散式系統問題。**
