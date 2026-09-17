# 【AI Agent × Multimodal Research Report】

時間：2026-09-17 23:55（Asia/Taipei）

主題：Semantic Recoverability × Replay-or-Fork × Effect Witness × Minimal Repair Frontier

## 與歷史研究比較

上一輪已建立 Cognitive Transaction Plane / Effect Transaction Plane、BeliefCommitBarrier、EffectCommitBarrier、CascadeRepairComplete(B)，並指出下一缺口是 multi-belief / multi-effect dependency 下的 minimal repair set、compensation ordering、authoritative post-state verification。本輪避免重複 Cordon/Saga 基礎，改追「checkpoint 可以恢復控制器狀態，為何仍不代表語義上可以安全回復？」以及「已發生的外部 effect 如何成為不可被 checkpoint 擦除的 witness」。

## 本小時新發現

1. DART（2026）把 structured tool agent 的 recovery 問題形式化為 semantic recoverability：local checkpoint restore 即使機械上可做，也可能因 downstream 已 commit 而語義非法；runtime 必須選擇 admissible restore point，否則 block。
2. ACRFence（2026）指出 checkpoint-restore 對 LLM agent 有 semantic rollback attack：restore 後模型可能重新合成語義相同但 syntactically 不同的 tool call，使普通 idempotency key 失效。其核心方向是記錄 irreversible effects，並要求 replay-or-fork。
3. Cordon 的 task-scoped semantic transaction 與 DART/ACRFence 可以接成三層：Commit Boundary → Recoverability Boundary → Replay/Fork Boundary。
4. Agentic Transaction（2026-08）把 ACID 重解為 Semantic Atomicity / Consistency / Isolation / Durability；這支持 Hermes 將「belief/effect transaction」從單一補償流程提升成 runtime invariant family。
5. ChronoMem（2026-07）顯示 memory rollback 需要真正的 versioned state，而非 prompt 說「忽略後續資訊」。但 memory rollback 與 external effect rollback 是兩種不同問題：memory 可以回版本，世界中的 payment/email/cloud mutation 不會因 memory snapshot 回復而自動消失。

## 本小時最重要 5 個發現

### 1. Controller Restore != Semantic Restore

已確認（DART 論文結果）：checkpoint 可載入，不代表 restore 後的 execution history 與已 committed downstream work 相容。

底層拆解：

Failure → Candidate Checkpoint → Dependency Scan → Downstream Commitment Scan → Effect Constraint Check → Admissibility Decision → Restore or Block

Hermes 應新增 `SemanticRestoreAdmissibility`，而不是把 `CheckpointAvailable` 直接連到 `CanRestore`。

### 2. Checkpoint State 與 Effect History 必須分離

合理架構推論，受 ACRFence/Cordon 交叉支持：

AgentCheckpoint = 可回復的 cognitive/runtime state
EffectWitnessLog = 已對外界造成、不可被 checkpoint 回復抹除的 durable history

因此：

Restore(checkpoint t0)
!=
Erase(effect after t0)

若 effect E 已完成，restore 後再次遇到相同 semantic intent 必須先查 EffectWitness，而不是重新執行。

### 3. Syntax Idempotency 不足以處理 LLM Re-synthesis

已確認（ACRFence）：LLM restore 後可能產生不同 request identifier / arguments representation，server 因此視為新 transaction。

Hermes proposed mechanism：

Tool Intent → Canonical Semantic Effect → Effect Fingerprint → Witness Lookup

若 semantic-equivalent + witnessed done：REPLAY_RESULT
若 semantic-divergent：FORK_REQUIRED
若 uncertain：ESCALATE / BLOCK

注意：semantic equivalence 若由 LLM 判定，本身不是 hard proof，必須在 IR 中標成 neural evidence。

### 4. Minimal Repair 不只是找 descendants，而是找 Recovery Frontier

Hermes 新模型：當 belief B 被撤回，不必無條件重跑整個 task；先計算受污染 descendants，再找第一個仍可語義合法銜接既有 committed effects 的 frontier。

Retracted Belief B
→ Tainted Descendants
→ Committed Effect Boundary
→ Candidate Recovery Frontiers
→ Admissibility Check
→ Minimal Valid Repair Set

這把上一輪的 `CascadeRepairComplete` 補成：

Repair 不只要 complete，還要 minimal + admissible。

### 5. Semantic Durability 應包含 Effect Witness Durability

Agentic Transaction 將 durability 提升到 semantic state。Hermes 進一步提出：對真實 tool agent，durability 至少要分：

MemoryDurability
BeliefDurability
EffectWitnessDurability
AuthorityConsumptionDurability

否則 restore 可能復活已消耗 credential/authority，或重做已完成 effect。

## Architecture Breakdown

User / Multimodal Evidence
→ Candidate Belief
→ Belief Commit Barrier
→ Committed Belief
→ Plan
→ Tool Intent
→ Semantic Effect Canonicalizer
→ Effect Commit Barrier
→ External Tool / MCP
→ External Effect
→ Effect Receipt
→ Effect Witness Log

Checkpoint plane：
Runtime State → Checkpoint C_t

Recovery plane：
Failure / Belief Retraction
→ Candidate Restore Point
→ Dependency + Commitment Analysis
→ SemanticRestoreAdmissibility
→ {RESTORE, REPLAY, FORK, COMPENSATE, BLOCK}

## Bottom-Level Logic

### Semantic replay guard

Intent I_new
→ normalize tool/schema/entity/target/effect class
→ compare against durable EffectWitness W_old
→ equivalence verdict

DETERMINISTIC_EQUIVALENT
→ return prior receipt/result without side effect

NEURAL_EQUIVALENT
→ confidence + policy gate
→ replay or human/validator escalation

DIVERGENT
→ explicit fork; new effect lineage

UNKNOWN
→ block irreversible execution

### Recovery frontier

Given dependency DAG G and invalid node b:

1. Mark descendants reachable from b.
2. Separate uncommitted nodes from externally committed effects.
3. Enumerate checkpoints before/inside tainted region.
4. Reject checkpoint if restoring it would require pretending an already committed effect never occurred.
5. Reject checkpoint if consumed authority would be resurrected.
6. Select latest admissible checkpoint that minimizes recomputation/repair cost.
7. For committed effects outside recoverable frontier, preserve witnesses and reconcile/compensate rather than replay blindly.

這是 Hermes architecture proposal；不是宣稱 DART/ACRFence 已實作同一演算法。

## Visual Simulation Idea

### Semantic Recovery & Replay/Fork Simulator

四條同步時間軸：

COGNITIVE: B1 → B2 → B3(retracted)
PLAN:      P1 → P2 → P3
EFFECT:    E1(done) → E2(done) → E3(staged)
CHECKPT:   C1 ----- C2 ----- C3

注入：crash、late contradictory evidence、checkpoint restore、semantic-equivalent retry、new UUID、consumed credential、compensation failure。

UI 顯示：
- Tainted Subgraph
- Committed Effect Boundary
- Candidate Restore Points
- Admissible / Illegal Restore
- REPLAY / FORK / COMPENSATE / BLOCK
- Effect Witness coverage
- Minimal Repair Set

## Code / GitHub

Hermes-console 歷史研究已含 Cordon/Saga/transaction 基礎。本輪值得下一步直接讀的原始碼/實作：
- DART 若公開 code：restore-boundary certification、dependency/effect constraint representation、LangGraph substrate adapter。
- ChronoMem：version index、snapshot write path、rollback API、ADK memory integration。
- Agent frameworks：LangGraph checkpoint restore 與 tool side-effect boundary，Google ADK session/memory restore semantics。

## Papers

### DART: Semantic Recoverability for Structured Tool Agents
Authors: Ke Yang, Panpan Li, Zonghan Wu, Kejin Xu, Huaxi Huang, Xiaoshui Huang
Year: 2026
URL: https://arxiv.org/abs/2605.23311
Architecture: failure localization → recoverable-boundary certification → checkpoint alignment → admissible restore selection
Contribution: 將 controller legality 與 semantic validity 分離。
Limitations: 本輪尚未取得/驗證其完整公開 code repository；需要下一輪追 code artifact 與具體 constraint schema。

### ACRFence: Preventing Semantic Rollback Attacks in Agent Checkpoint-Restore
Authors: Yusheng Zheng, Yiwei Yang, Wei Zhang, Andi Quinn
Year: 2026
URL: https://arxiv.org/abs/2603.20625
Architecture: irreversible-effect recording + semantic comparison + replay-or-fork mitigation
Contribution: 指出 LLM re-synthesis 會破壞傳統 retry/idempotency 假設，並提出 semantic rollback attack。
Limitations: semantic comparison 本身可能依賴 probabilistic analyzer；需要把 equivalence evidence strength 顯式化。

### Cordon: Semantic Transactions for Tool-Using LLM Agents
Authors: Zheng Chen, Hanqing Liu, Duling Xu, Dong Dong, Jialin Li, Bangzheng Pu, Jidong Zhai
Year: 2026
URL: https://arxiv.org/abs/2606.17573
Architecture: transaction manager + derived-result lineage + shadow state + effect outbox + recovery metadata
Contribution: task-level semantic transaction boundary。
Limitations: transaction containment 不能單獨解決 checkpoint 後 semantic re-synthesis；需和 effect witness/recovery admissibility 結合。

### Agentic Transaction: Towards ACID-Compliant Agent Systems
Authors: Zhaoyan Sun, Xiaoxiao Wang, Guoliang Li
Year: 2026
URL: https://arxiv.org/abs/2608.13900
Contribution: Semantic Atomicity / Consistency / Isolation / Durability。
Limitations: ACID 類比仍需針對跨 SaaS、不可逆世界 effect 定義 authoritative settlement proof。

### ChronoMem: Version Control and Semantic Rollback for Large Language Model Agent Memory
Authors: Yongye Su, Wujiang Xu, Chaoji Zuo, Elisa Bertino
Year: 2026
URL: https://arxiv.org/abs/2607.27773
Contribution: whole-memory snapshots + semantic version selection + rollback-consistent evaluation。
Limitations: memory rollback 不等同 external effect rollback。

## Unknown / Open Questions

1. DART 的 dependency/effect constraints 在 code 中如何表示？admissibility certification 是 deterministic 還是含 LLM 判斷？
2. Semantic Effect Fingerprint 如何做到跨不同 request ID/argument ordering 仍能可靠判同時，不讓 attacker 利用 fuzzy equivalence？
3. Effect Receipt 如何升級成 Authoritative Settlement Proof：HTTP 200、provider object ID、subsequent read-back、external ledger confirmation各自證據強度如何分級？

## 下一輪研究

DART code/artifact discovery
→ restore boundary schema
→ checkpoint alignment
→ admissibility predicate
→ dependency/effect constraints

並追：

Effect Receipt
→ Provider Read-back
→ Authoritative State
→ Settlement Proof
→ Witness Durability
→ Safe Replay/Fork

建立最小 fixtures：
1. payment completed → crash → restore → new UUID retry
2. consumed authority → restore → attempted reuse
3. downstream effect committed → upstream checkpoint restore
4. memory rollback but external email already sent
5. semantic-equivalent retry vs genuinely changed intent
6. compensation succeeds HTTP-wise but authoritative state unchanged

## Knowledge Graph 新增 Node / Edge

Nodes:
- SemanticRestoreAdmissibility
- RecoverableBoundary
- RecoveryFrontier
- MinimalValidRepairSet
- EffectWitness
- EffectWitnessLog
- EffectFingerprint
- SemanticEffectEquivalence
- ReplayOrFork
- AuthorityConsumptionWitness
- CommittedEffectBoundary
- SettlementProof
- ControllerRestore
- SemanticRestore

Edges:
- CheckpointAvailable DOES_NOT_IMPLY SemanticRestoreAdmissibility
- EffectWitness SURVIVES ControllerRestore
- CommittedEffectBoundary CONSTRAINS RecoveryFrontier
- RetractedBelief TAINTS DownstreamDependency
- RecoveryFrontier SELECTS MinimalValidRepairSet
- SemanticEquivalentRetry REQUIRES EffectWitnessLookup
- ConsumedAuthority FORBIDS AuthorityResurrection
- EffectReceipt REQUIRES Verification TO_BECOME SettlementProof

## 本輪結束判斷

缺哪一層：External Effect → Authoritative Settlement Proof。
最淺節點：SemanticEffectEquivalence 與 SettlementProof。
仍只是名詞：跨 provider 的 Authoritative Post-State / Settlement Proof 統一 IR。
最值得讀原始碼：DART recovery runtime；其次 ChronoMem version/rollback implementation。
最需追引用：DART 與 ACRFence，因兩者分別處理 restore admissibility 與 restore security。
最適合視覺模擬：Semantic Recovery & Replay/Fork Simulator。
最值得實作的 Agent 架構：Transactional Agent Runtime + durable Effect Witness + admissible restore frontier，而不是單純 ReAct checkpoint retry。

最終鏈新增：

User / Camera / Voice / Video
→ Evidence / Provenance / Time
→ Belief Commit
→ Reasoning / Planning
→ Tool Intent
→ Effect Commit
→ MCP / Tool
→ External Effect
→ Effect Receipt
→ Settlement Proof
→ Durable Effect Witness

Failure / Late Evidence
→ Belief Retraction
→ Tainted Dependency Graph
→ Recoverable Boundary
→ Semantic Restore Admissibility
→ Restore / Replay / Fork / Compensate / Block
→ Re-plan

核心結論：checkpoint 只能回復 Agent 自己的狀態，不能回復世界。可靠 Agent Runtime 必須把「已經對世界做過什麼」保存成不隨 checkpoint 倒退的 durable effect witness，並在每次 restore 前證明 restore point 與已 committed downstream effects 相容；否則 recovery 本身就可能成為新的錯誤或攻擊面。