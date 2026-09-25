# 【AI Agent × Multimodal Research Report】

時間：2026-09-25 23:51（Asia/Taipei）

## 本小時新發現
本輪承接上一輪 GPU allocation/rkey revocation，但不重複 allocation identity；焦點推進到「memory invalidation 是一個有 completion boundary 的 capability-revocation protocol」，以及它如何映射到 Hermes Agent Runtime。

已確認：
- UCX NEWS 顯示 1.16.0 已加入 rendezvous through DC transport 的 memory invalidation；1.15.0 把 UCT_MD_MKEY_PACK_FLAG_INVALIDATE 拆為 RMA/AMO flags，代表 remote-key invalidation 不是單一布林能力，而是依 remote operation class 區分。
- UCX 目前 release notes 顯示 fault-tolerance discard/failover、rcache validity before memory-handle invalidation、CUDA IPC remote-cache destruction during endpoint destroy 都仍在持續修正，說明 revocation correctness 橫跨 request、rcache、endpoint/cache lifecycle。
- UCX repository architecture 明確指出 UCM 攔截 memory allocation/release events並服務 registration cache；因此 resource lifetime event → cache invalidation 是正式架構的一部分，而非只靠每次 access 重驗 pointer。

工程推論：
Remote capability revocation不能只建模成 delete(rkey)。它至少需要：
ResourceRevocationEvent → LocalCacheInvalidation → AccessRevocationOperation → RevocationCompletionWitness → capability redistribution / reuse。

## 本小時最重要 5 個發現

### 1. Invalidation 是 protocol，不是瞬間狀態
是什麼：remote access capability 從 ACTIVE 轉到 REVOKING，再到 REVOKED。
底層：allocation/release event 先使 registration/cache entry 失效；transport/MD 若支援 invalidation，還需要完成相應 invalidation operation。
重要性：如果新 generation 在舊 remote access 真正失效前就重用同一 locator/address，可能產生 ABA 型 stale-capability hazard。
限制：不同 MD/transport 的 invalidation semantics不同，不能假設所有 transport 都有硬體級 remote-key revoke。

### 2. Revocation 必須有 Completion Witness
刪掉本地 memh reference 並不能自動證明遠端 peer 已無法使用舊 capability。知識圖譜應加入 RevocationCompletionWitness，並要求 NewCapabilityPublication happens-after 它，除非 transport另有 generation/tag fence。

### 3. Invalidation capability 具有 operation-class granularity
UCX 1.15 將 invalidate key flags拆成 RMA與AMO，意味 capability scope應建模為：
AccessCapability = {resource_generation, access_generation, operation_class, peer/session, transport_domain}
而非單一 rkey 字串。

### 4. Cache validity 是 correctness state
近期 UCX release修正「rcache validity check before memory handle invalidation」與「CUDA IPC remote-cache destruction during endpoint destroy」。這顯示 cache entry 不只是效能最佳化，而是 resource/access generation correctness的一部分。

### 5. Hermes 應採 Lease/Capability Revocation State Machine
Tool credential、MCP session、browser handle、GPU rkey都可統一成：
ISSUED → ACTIVE → REVOKING → REVOKED → REISSUED。
retry不能只檢查 attempt epoch；還必須確認所持 capability generation仍 ACTIVE。

## Architecture Breakdown
GPU/RDMA:
CUDA Allocation Generation
→ UCM allocation/free event
→ Registration Cache Entry
→ Local Memory Handle
→ Packed Remote Capability
→ Peer Access
→ Resource Revocation Event
→ Cache Invalid
→ Access Capability REVOKING
→ transport/MD invalidation
→ Revocation Completion Witness
→ REVOKED
→ new memh/rkey generation
→ capability redistribution

Hermes:
Resource Generation
→ Capability Issue
→ Tool/MCP/Browser Attempt
→ Resource/Session Change
→ Capability REVOKING
→ outstanding operation drain/cancel
→ Revocation Completion Witness
→ capability REVOKED
→ new generation issue
→ next attempt

## Bottom-Level Logic
新增安全 invariant：

NewCapabilityPublish(G+1) MUST NOT race with unresolved stale capability G unless transport/session identity independently fences G.

Commit(result) requires:
result.logical_generation == active.logical_generation
AND result.attempt_generation == active.attempt_generation
AND result.capability_generation == active.capability_generation
AND capability.state == ACTIVE
AND visibility/readiness witness satisfied.

Resource locator、pointer、session object、rkey value都不能單獨充當 generation identity。

## Visual Simulation Idea
Capability Revocation & ABA Simulator

欄位：
Resource Locator | Resource Generation | Access Generation | Operation Class | Peer/Session | Cache State | Outstanding Ops | Revocation State | Revocation Witness | New Capability | Commit Eligibility

故障注入：
SAME_ADDRESS_NEW_RESOURCE
OLD_RKEY_AFTER_REALLOC
NEW_CAPABILITY_BEFORE_REVOKE_COMPLETE
ENDPOINT_DESTROY_WITH_REMOTE_CACHE
RMA_REVOKED_AMO_STILL_ACTIVE
LATE_COMPLETION_WITH_STALE_CAPABILITY

核心視覺：同一 locator 上同時畫 G7=REVOKING 與 G8=PENDING，只有 G7 出現 RevocationCompletionWitness 後 G8 才變 ACTIVE。

## Code / GitHub
值得繼續讀：
- openucx/ucx UCM memory allocation/release interception
- UCP registration cache / memh invalidation
- UCT MD invalidate / mkey packing flags
- CUDA IPC remote-cache endpoint-destroy path
- fault-tolerance discard/failover flows

## Papers / Engineering Evidence
基礎：Shamis et al., “UCX: an open source framework for HPC network APIs and beyond”, IEEE HOTI 2015。
工程演進：UCX 1.15/1.16 NEWS 的 invalidation能力，以及近期 release 中 rcache validity、CUDA IPC remote-cache destruction、fault-tolerance discard/failover fixes。

## Unknown / Open Questions
1. 各 IB/DC/RC/CUDA IPC MD 的 invalidate completion 到「remote stale key必然不可用」之間，精確 source-level guarantee 是什麼？
2. endpoint failover/recreation 是否提供獨立 session generation，足以隔離未完成的舊 capability？
3. capability redistribution是否已有 ack/epoch，還是上層必須自行建立 publication fence？

## 下一輪研究
UCT MD invalidate implementation
→ IB/DC mkey/rkey invalidation
→ completion callback
→ remote stale-rkey failure mode
→ endpoint/session generation
→ capability redistribution
→ new-key publication fence
→ exactly-once logical commit。

## Knowledge Graph 新增 Node / Edge
Nodes:
CapabilityRevocationState
RevocationCompletionWitness
CapabilityOperationClass
CapabilityPublicationFence
RegistrationCacheValidityGeneration
EndpointSessionGeneration
StaleCapabilityABAHazard

Edges:
ResourceRevocationEvent → invalidates → RegistrationCacheValidityGeneration
RegistrationCacheInvalidation → starts → CapabilityRevocationState(REVOKING)
TransportInvalidationCompletion → produces → RevocationCompletionWitness
RevocationCompletionWitness → transitions → CapabilityRevocationState(REVOKED)
RevocationCompletionWitness → happens_before → CapabilityPublicationFence
CapabilityPublicationFence → permits → NewAccessGeneration
EndpointSessionGeneration → scopes → RemoteAccessGeneration
StaleCapabilityABAHazard → prevented_by → {GenerationFence, RevocationCompletionWitness}

## 本輪結論
缺的層：transport-specific remote invalidation completion semantics。
最淺節點：RevocationCompletionWitness。
仍只是名詞：跨 IB/CUDA IPC/MCP/Browser 都成立的 CapabilityPublicationFence。
最值得讀原始碼：OpenUCX UCT MD invalidate + IB/DC mkey lifecycle。
最值得追引用：UCX invalidation / registration-cache / fault-tolerance implementation history。
最適合視覺模擬：Capability Revocation & ABA Simulator。
最值得 Hermes 實作：Event-sourced Runtime + ResourceGeneration + CapabilityGeneration + RevocationStateMachine + PublicationFence + ExecutionAttemptEpoch + CommitCapability。
