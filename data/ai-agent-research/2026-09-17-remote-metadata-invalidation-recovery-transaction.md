# 【AI Agent × Multimodal Research Report】

**時間：2026-09-17 11:56（Asia/Taipei）**  
**主題：NIXL Remote Metadata Invalidation × Connection Ownership × Generation Recovery Transaction**

## 本小時新發現

本輪延續前輪 Endpoint Error Lock / Recovery Transaction，但不重複 UCX error callback 本身，而是向上一層追到 NIXL Agent 的 metadata control plane：`invalidateRemoteMD()`、`remoteSections_`、`remoteBackends_`、backend `disconnect()`、P2P `INVL`、etcd watcher，以及重新 `loadRemoteMD()` 的 publication boundary。

已確認：NIXL main 的 `invalidateRemoteMD(remote_agent)` 在 agent-wide lock 下先 erase `remoteSections_`，再遍歷 `remoteBackends_[remote_agent]` 對每個 backend 呼叫 `disconnect(remote_agent)`，最後 erase remote backend connection metadata。這是一個明確的 control-plane revocation transaction。

已確認：`loadConnInfo()` 對同一 remote/backend 若 connection info 已存在且改變，會回 `NIXL_ERR_NOT_ALLOWED`；因此新 incarnation 若 connection metadata 改變，不能在舊 generation 尚未 invalidate 時直接覆蓋。正確順序是 invalidate old → load new。

已確認：`loadRemoteSections()` 使用 `shared_ptr<nixlRemoteSection>`；prepared handles 對 remote section 使用 weak reference。partial metadata refresh 會 merge 到同一 RemoteSection，只有 explicit invalidation erase entry 時才 retire 該 registration generation。這把「refresh」與「new generation」清楚分離。

已確認：P2P metadata backend 收到 `INVL` 會呼叫同一個 metadata context `invalidateRemoteMD()`；etcd watcher 在 key DELETE 後也走同一 invalidation path。也就是 side-channel 與 central metadata path 最終匯流到相同 capability revocation primitive。

工程對照：vLLM 2026-04 issue #38840 報告 same-node worker restart 取得新 engine ID 後，舊 handshake metadata 未失效會造成 re-handshake assertion；SGLang 2026-08 issue #33789 則顯示只替換 P/D 一側後兩邊雖 Ready 仍可能 timeout。這些不是 NIXL core invariant 的證明，但支持「process readiness != metadata generation coherence」。

## 本小時最重要 5 個發現

### 1. Metadata invalidation 是 capability revocation transaction

**已確認工程實作**：

```text
invalidateRemoteMD(peer)
→ acquire agent lock
→ erase RemoteSection(peer)
→ for backend in RemoteBackends(peer): disconnect(peer)
→ erase RemoteBackends(peer)
→ peer no longer transferable
```

這不是普通 cache eviction。`RemoteSection` 承載 remote memory metadata generation，`remoteBackends_` 承載 backend connection information；兩者一起撤銷，才真正阻止舊 peer capability 繼續進 datapath。

**重要性**：Hermes Runtime 的 MCP session、browser session、remote tool、GPU endpoint 都應區分「cache miss」與「capability revoked」。

**限制**：目前還未證明所有 backend `disconnect()` 都同步完成底層 teardown；backend-specific async close 仍需分開建模。

### 2. Refresh 與 Reincarnation 必須是不同狀態

NIXL `loadRemoteSections()` 對 existing `RemoteSection` 做 merge，因此 partial metadata update 不會自動創造新 generation；comments 明確指出 weakly-bound handles 在 refresh 間保持有效，直到 explicit invalidation erase entry。

```text
same incarnation:
G7 + partial metadata → merge into G7

new incarnation:
G7 → invalidate/erase → load → G8
```

**重要性**：若 Hermes 把任何 metadata update 都當 generation bump，會造成不必要的 transfer invalidation；反之若 worker restart 仍當 refresh，則可能讓 stale capability 穿透。

### 3. Connection info change 是 incarnation boundary signal

`loadConnInfo()` 若發現同一 peer/backend 已有 conn info，但新值不同，直接 `NIXL_ERR_NOT_ALLOWED`，不會 silent overwrite。

```text
peer A / UCX / Conn C7
+ incoming C8
→ reject while C7 exists

invalidate A
→ erase C7
→ load C8
→ publish new generation
```

**合理推論**：connection-info mismatch 可以作為「疑似新 incarnation」訊號，但由誰自動觸發 invalidation仍需追 metadata manager / framework integration。

### 4. P2P INVL 與 etcd DELETE 匯流到同一 revocation primitive

P2P command dispatcher 的 `INVL` 與 etcd watcher DELETE 最終都呼叫 metadata context `invalidateRemoteMD()`。

這形成：

```text
Failure Detector / Operator / Peer
        ↓
P2P INVL      etcd DELETE
        \       /
     invalidateRemoteMD
          ↓
RemoteSection revoke
Backend disconnect
Metadata purge
```

**重要性**：Hermes Knowledge Graph 應把 Failure Detection 與 Revocation Execution 分開；多種 detector 可以共享一個 idempotent revoke primitive。

### 5. Ready ≠ Generation Coherent

vLLM #38840 與 SGLang #33789 提供 framework-level failure evidence：worker/pod 已重新 Ready，並不代表 handshake、remote metadata、endpoint 與 prepared transfer 都已切換到同一 incarnation。

因此 runtime readiness 建議拆成：

```text
ProcessReady
TransportReady
MetadataReady
GenerationCoherent
TransferProbePassed
ServingReady
```

這是 Hermes 建模建議，不是宣稱現有 frameworks 已採用這組欄位。

## Architecture Breakdown

### NIXL metadata recovery architecture

```text
Peer / Metadata Producer
  │
  ├─ send metadata ──────────────┐
  ├─ send INVL ───────────┐      │
  └─ etcd key delete ─────┤      │
                         ▼      ▼
                Metadata Manager
                         │
              invalidateRemoteMD
                         │ agent lock
        ┌────────────────┴────────────────┐
        ▼                                 ▼
 remoteSections_[peer]              remoteBackends_[peer]
 shared RemoteSection               backend→conn_info
        │                                 │
        └─ erase/revoke              backend.disconnect()
                                          │
                                          ▼
                                Endpoint/transport teardown

New metadata
→ loadConnInfo
→ loadRemoteSections
→ publish new RemoteSection generation
→ prepare new dlist/xfer
→ retry
```

### Recovery Transaction v2

```text
DETECT
→ MARK peer suspect
→ REVOKE old RemoteSection
→ DISCONNECT old backend capabilities
→ RETIRE old prepared handles via weak generation
→ LOAD new connection metadata
→ LOAD/MERGE new memory metadata into fresh section
→ PREPARE new transfer handles
→ PROBE transfer
→ PUBLISH ServingReady
→ RETRY user request
```

關鍵規則：**publish 必須晚於 generation coherence，而不是晚於 process health check。**

## Bottom-Level Logic

### `invalidateRemoteMD`

```text
remote_agent
→ validate != local name
→ exclusive agent lock
→ remoteSections_.erase(remote_agent)
→ remoteBackends_.find(remote_agent)
→ backendEngine.disconnect(remote_agent) × N
→ remoteBackends_.erase(remote_agent)
→ SUCCESS / NOT_FOUND
```

### `loadConnInfo`

```text
(remote, backend, conn_info)
→ backend exists?
→ existing remoteBackends entry?
   ├ same conn_info → SUCCESS/no reload
   ├ different conn_info → NIXL_ERR_NOT_ALLOWED
   └ missing → continue
→ backend supportsRemote?
→ loadRemoteConnInfo(remote, conn_info)
→ only after success publish remoteBackends_[remote][backend]
```

這裡有一個重要 transaction pattern：**validate/materialize first, publish cache entry last**，避免 failed load 留下 half-published connection state。

### `loadRemoteSections`

```text
remote name
→ try_emplace shared RemoteSection
→ RemoteSection.loadRemoteData()
→ success: keep/merge generation
→ failure: erase RemoteSection + RemoteBackends
```

注意：failure path 會 purge both structures，但目前仍值得追 backend resources 是否都在該 path 對稱 unload/disconnect。

## Visual Simulation Idea

### Remote Agent Incarnation & Metadata Coherence Simulator

四條泳道：

```text
Framework     Metadata Plane      NIXL Agent       Transport
Pod A7 Ready  publish G7          Section G7       Endpoint E7
    │              │                  │                │
 crash             DELETE/INVL        │                │
    │──────────────►│────invalidate───►REVOKED────────►disconnect
 Pod A8 Ready      publish G8          │                │
    │              │────load──────────►Section G8──────►Endpoint E8
 request           │                  prepare X8        │
    └────────────────────────────────►probe────────────►SUCCESS
 ServingReady
```

互動故障注入：
- `Pod Ready before INVL`
- `same peer name + changed conn_info`
- `partial metadata refresh`
- `etcd DELETE delayed`
- `duplicate INVL`
- `new generation arrives while old still published`

UI 必須同時顯示 `Process Generation / Metadata Generation / Endpoint Generation / Xfer Generation`，讓使用者看到「名字相同但世代不同」。

## Code / GitHub

值得繼續讀的 NIXL 目錄/檔案：

- `src/core/nixl_agent.cpp` — `invalidateRemoteMD`, `loadConnInfo`, `loadRemoteSections`, request creation.
- `src/core/agent_data.h` — `remoteSections_`, `remoteBackends_`, lock/destruction ordering.
- `src/core/nixl_metadata_context.h` — metadata backend 到 agent core 的 invalidation interface.
- `src/core/nixl_p2p_metadata_backend.cpp` — `INVL` dispatch.
- `src/core/nixl_etcd_metadata_backend.cpp` — watcher DELETE → invalidation.
- `src/backend/ucx/` — backend `disconnect()` / endpoint close completion semantics，下一輪核心。
- `test/gtest/metadata_exchange.cpp` — invalidation/reload behavior tests.

## Papers / Reports / Engineering Evidence

本輪主題偏 runtime source architecture，沒有用低關聯論文硬湊。新增工程證據：

1. **NIXL documentation / source, 2026 main** — dynamic agent add/remove、metadata invalidation、backend disconnect、metadata purge。限制：API contract 不等於所有 framework 已正確編排 recovery。
2. **vLLM issue #38840, 2026-04-02** — same-node NIXL worker restart/new engine ID 與 stale handshake metadata 衝突。限制：issue closed as not planned，屬 framework report。
3. **SGLang issue #33789, 2026-08-06** — NIXL P/D 單側 replacement 後 Ready 但 serving timeout。限制：尚不能把根因直接歸到 NIXL generation；作為 coherence failure signal。
4. **NIXL issue #1159, 2025-12-27** — metadata deserialize races、failed/empty metadata caching、premature backend removal。限制：較舊版本，需與 main source behavior區分。

## Unknown / Open Questions

1. `loadRemoteSections()` failure erase `remoteBackends_` 時，backend 已 materialize 的 remote conn/rkey resources 是否在所有 backend 都完整 unload/disconnect？還是可能留下 orphan capability？
2. etcd DELETE 與新 metadata PUT 若快速交錯，watcher/invalidation 與 reload 是否有 incarnation ID / revision ordering 防止 ABA？
3. Framework retry owner（vLLM/SGLang/Dynamo）如何知道 `invalidate → reload → prepare → probe` 已完成，而不是看到 pod Ready 就重送 request？

## 下一輪研究

**主題：etcd revision / P2P invalidation ordering × ABA problem × NIXL metadata manager × framework ServingReady gate**

優先追：

```text
G7 published
→ DELETE revision r10
→ G8 PUT revision r11
→ delayed old INVL / watcher event
→ ???
→ 是否可能把 G8 誤撤銷？
```

並比較：

```text
NIXL metadata generation
vLLM engine_id / handshake
SGLang P/D worker identity
Dynamo service discovery identity
```

目標是建立真正可實作的 `IncarnationToken = logical peer + process/engine generation + metadata revision`，並驗證哪些欄位已有真實實作、哪些仍是 Hermes abstraction。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `RemoteAgentIncarnation`
- `RemoteSectionPublication`
- `RemoteSectionRevocation`
- `ConnectionMetadataGeneration`
- `MetadataRefresh`
- `MetadataReincarnation`
- `P2PInvalidationEvent`
- `EtcdDeleteInvalidation`
- `BackendDisconnectTransaction`
- `GenerationCoherenceGate`
- `ServingReadinessGate`
- `TransferProbe`
- `HalfPublishedConnectionState`
- `IncarnationMismatch`

### Edges

```text
P2PInvalidationEvent → triggers → RemoteSectionRevocation
EtcdDeleteInvalidation → triggers → RemoteSectionRevocation
RemoteSectionRevocation → retires → PreparedRemoteCapability
RemoteSectionRevocation → precedes → MetadataReincarnation
ConnectionMetadataGeneration → binds → BackendEndpointGeneration
MetadataRefresh → preserves → RemoteSectionGeneration
MetadataReincarnation → creates → NewRemoteSectionGeneration
GenerationCoherenceGate → precedes → ServingReadinessGate
TransferProbe → validates → ServingReadinessGate
ProcessReady → does_not_imply → GenerationCoherenceGate
```

## 本輪結束判斷

- **缺哪一層**：metadata event ordering / revision / ABA 防護，到 framework serving retry 的跨層 transaction。
- **哪個節點最淺**：`ServingReadinessGate`，目前 framework-specific 實作尚未逐一追完。
- **哪個概念仍只是名詞**：`IncarnationToken`，是 Hermes 下一輪要驗證的統一 abstraction。
- **哪個系統值得讀原始碼**：NIXL metadata manager + etcd backend，其次 vLLM NixlConnector handshake/re-registration。
- **哪篇論文需追引用**：本輪無新增核心論文；下一輪應優先找 distributed incarnation/ABA/fencing token 與 AI serving recovery 的正式研究，而非硬套一般 agent paper。
- **哪個概念最適合視覺模擬**：Remote Agent Incarnation & Metadata Coherence Simulator。
- **哪個 Agent 架構最值得實作**：在 Hermes Agent Runtime 實作 `Detect → Revoke → Rebuild → Probe → Publish → Retry` 的 capability recovery loop，先套 MCP/tool session，再映射到 GPU transport。

## 從一句話到 GPU 的新增拼圖

```text
User Input
→ UI
→ Agent Runtime
→ Context / Reasoning / Planning
→ Tool / MCP / Model Router
→ Model
→ KV / Multimodal State
→ Remote Agent Metadata
→ RemoteSection Generation
→ Backend Connection Generation
→ Prepared Transfer
→ GPU/NIC Transfer
→ failure?
   → metadata invalidation
   → capability revoke
   → disconnect
   → new incarnation metadata
   → reprepare
   → transfer probe
   → retry
→ Attention / Kernel
→ logits
→ output
```

**本輪核心結論：AI runtime 的「重連」不是重新打開 socket；它是一個 metadata capability transaction。舊 RemoteSection 必須被撤銷、backend capability 必須 disconnect、新 incarnation 的 connection/memory metadata 必須重新 materialize，並在 generation coherence 被驗證後才應重新對上層宣告可服務。**