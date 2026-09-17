# 【AI Agent × Multimodal Research Report】

**時間：2026-09-17 09:53（Asia/Taipei）**

**本輪主題：NIXL UCX Request Cancellation × Endpoint Error Handling × Reconnect Generation × Stale-Xfer Fail-Closed Gate**

## 與歷史研究比較

前一輪已追到 Composite UCP Request、Endpoint Flush、Request Release 與 stale-generation xfer handle。本輪不重複描述 descriptor/memh/rkey，而是沿著失敗路徑繼續往下：`peer failure → UCX endpoint error → pending request cancellation/completion → endpoint replacement → metadata generation replacement → old xfer rejection → retry`。核心問題是：分散式 KV transfer 在 peer restart 時，哪一層真正決定「舊 capability 不再可信」。

## 本小時新發現

1. **UCX `ucp_request_cancel()` 的語義比「發出取消要求」更強，但仍不等於 transport object 已可任意釋放。** UCX API 定義：呼叫後 outstanding request 最終處於 completed 或 canceled 狀態；callback status 為 `UCS_OK` 或 `UCS_ERR_CANCELED`。NIXL 的 `reqCancel()` 只是直接呼叫 `ucp_request_cancel(worker, req)`，`reqRelease()` 則直接 `ucp_request_free(req)`。因此 Hermes 必須分開建模 Cancel API、Completion State、Handle Free 與 Endpoint Quiescence。
2. **UCX endpoint error mode 是 transport lane selection 與 failure semantics 的共同輸入。** NIXL BackendGuide 指出預設 `ucx_error_handling_mode=peer`；PEER 模式保證 send request 在 remote failure 時仍以 success/error 完成並觸發 endpoint error handler，但可能排除不支援 peer-failure 的 transport lane。`none` 可能得到更多/更快 lane，卻失去 NIXL 依賴的 failure visibility。
3. **Force-close 與 flush-close 是不同 correctness contract。** UCX `ucp_ep_close_nbx(UCP_EP_CLOSE_FLAG_FORCE)` 會無 peer confirmation 釋放 endpoint，outstanding requests 以 `UCS_ERR_CANCELED` 完成；非 force close 則會對 outstanding operations 排程 flush。這表示 reconnect state machine 必須知道舊 endpoint 是 graceful-drained 還是 force-revoked。
4. **NIXL #2027 已把 generation correctness 從抽象變成實際 fail-closed gate。** 舊 gen-N xfer handle 在 disconnect/re-register 後曾可引用已釋放的 `nixlUcxPublicMetadata`，最後在 `sendXferRangeBatch/ucp_put_nbx` segfault；修正後 stale generation 在 `postXferReq` 與 `estimateXferCost` 被拒絕為 `NIXL_ERR_NOT_FOUND`。Fault-injection reproducer 驗證修正前可穩定重現 crash、修正後不再重現。
5. **Endpoint lifetime 與 metadata lifetime仍不能合併成單一 generation。** NIXL #1986 顯示 peer restart 時，async UCX error callback force-close endpoint 可與另一 thread 的 `ucp_ep_rkey_unpack()` race。也就是 remote metadata generation 即使正確，endpoint object 本身仍可能在 unpack/use capability 時被撤銷。

## 本小時最重要 5 個發現

### 1. CancelRequested ≠ SafeToFree
**已確認工程實作：** NIXL `nixlUcxWorker::reqCancel()` 呼叫 `ucp_request_cancel`；`reqRelease()` 呼叫 `ucp_request_free`。UCX 保證 cancel 後 request 走向 completed/canceled，但 application 仍必須遵守 request completion/ownership contract。

底層鏈：
`IN_FLIGHT → ucp_request_cancel → UCX progress → {UCS_OK | UCS_ERR_CANCELED} → completion observed → ucp_request_free`。

### 2. Error-handling mode 會改變可用 transport topology
**官方資訊：** `UCP_ERR_HANDLING_MODE_PEER` 提供 remote-failure completion/error guarantees；NIXL BackendGuide 明確說它也影響 lane selection。故 performance routing 與 reliability routing 不能被 Hermes 畫成兩個互不相關模組。

### 3. Endpoint close 是 generation transition
`E7 CONNECTED → error callback → E7 FAILED → drain/cancel → close → E7 REVOKED → connect → E8 CONNECTED`。

合理工程模型：所有綁定 E7 的 rkey/public metadata/request 必須經 validity gate，不能只依 peer name 判斷。

### 4. #2027 證明 Name Identity 不等於 Generation Identity
**已確認修正：** disconnect invalidates gen-N metadata；peer re-register 建立 gen-N+1；舊 xfer handle 若只以 remote name 驗證，可能引用 freed gen-N metadata。修正將 stale generation fail closed。

### 5. Endpoint Error Callback 是 control-plane/data-plane 的交界
#1986 的 `force-close ↔ rkey unpack` race 顯示 error callback 不是旁路 log，而會實際改變 data-plane capability lifetime。因此 Digital Twin 要把 callback 畫成會撤銷 endpoint generation 的事件。

## Architecture Breakdown

```text
Remote Prefill/Decode Peer
        │
        ▼
UCX Endpoint E7
        │
        ├── rkey / RemoteMetadata G7
        ├── Composite Requests R0..Rn
        └── Endpoint Error Handler
                    │
             remote failure
                    ▼
              E7 FAILED
                    │
          cancel / complete requests
                    │
          close / revoke endpoint
                    ▼
              E7 REVOKED
                    │
          invalidate Metadata G7
                    │
             reconnect peer
                    ▼
              Endpoint E8
                    │
          fetch Metadata G8
                    │
            re-prepare xfer
                    ▼
                 retry
```

## Bottom-Level Logic

### Request cancellation path
`Request Pointer → ucp_request_cancel(worker, req) → worker progress → request protocol state transition → callback/status = OK or CANCELED → status observation → ucp_request_free`.

### Endpoint failure path
`Transport detects peer failure → UCP endpoint error handler → endpoint state FAILED → NIXL returns NIXL_ERR_REMOTE_DISCONNECT → old connection/metadata invalidation → endpoint close → new connection generation`.

### Stale-xfer validation path
`XferHandle(gen=N) → peer disconnect → RemoteSection/metadata gen=N invalidated → peer re-register gen=N+1 → post old handle → generation validity check → NIXL_ERR_NOT_FOUND → re-fetch/re-prepare`。

## Visual Simulation Idea — Failure / Reconnect Generation Simulator

建立五條泳道：`Agent / NIXL / UCX Endpoint / UCX Worker / Remote GPU`。

互動控制：`Kill Peer`、`Cancel Request`、`Force Close`、`Graceful Close`、`Reconnect`、`Post Old Xfer`、`Fetch New Metadata`、`Retry`。

畫面狀態：
```text
E7 + G7 + X7  GREEN
Kill Peer
E7 FAILED     RED
R0..Rn        CANCEL/PENDING
G7/X7         STALE
Reconnect
E8 + G8       GREEN
Post X7       BLOCKED: stale generation
Prepare X8    GREEN
Retry         RUNNING
```

同時顯示兩個模式：`error_handling=peer` 與 `none`，讓使用者看到 failure visibility 與 lane eligibility 的取捨。

## Code / GitHub

值得繼續讀的 NIXL 原始碼：
- `src/plugins/ucx/ucx_utils.cpp`：`nixlUcxWorker::reqCancel`、`reqRelease`、`nixlUcxEp::checkTxState`、endpoint error callback/close。
- `src/plugins/ucx/ucx_backend.cpp`：Composite request `status/release`、`loadRemoteMD`、`internalMDHelper`、`prepXfer/postXfer`。
- PR #2027：stale-generation xfer handle validation。
- Issue #1986 / fix #1987：endpoint close 與 rkey unpack race。

## Papers

本輪沒有新增一篇比 UCX/NIXL 原始碼與官方 failure semantics 更直接的核心論文；為避免把相關性較弱的論文硬塞入圖譜，本輪 Papers 節點維持既有 distributed KV serving 文獻，下一輪優先找「failure-aware disaggregated inference / KV transport recovery」具實驗與 architecture 的論文並追引用。

## Unknown / Open Questions

1. NIXL UCX `release()` 對 IN_PROGRESS request 的 `cancel → free` 是否在所有 UCX protocol/lane 下都等待到足以安全釋放 application request handle？需最小 fault-injection + ASAN/UCX debug 驗證。
2. Endpoint E7 error callback、remote metadata invalidation、E8 reconnect 的 lock ordering 是否已完全線性化？#1986 顯示至少歷史上曾有 race。
3. Retry policy 應由 NIXL、上層 KV connector、還是 Agent Runtime 擁有？目前 transport error 與 semantic retry ownership仍是淺節點。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：`UCPRequestCancel`、`RequestCompletionAfterCancel`、`RequestHandleFree`、`EndpointErrorHandlingMode`、`PeerFailureGuarantee`、`EndpointForceClose`、`EndpointGracefulClose`、`EndpointRevocation`、`EndpointGeneration`、`ReconnectGeneration`、`StaleXferFailClosedGate`、`GenerationMismatch`、`RetryOwnership`、`FailureVisibility`、`LaneReliabilityConstraint`。

新增 Edges：
- `EndpointErrorHandlingMode → constrains → TransportLaneSelection`
- `PeerFailure → triggers → EndpointErrorCallback`
- `EndpointErrorCallback → revokes → EndpointGeneration`
- `EndpointRevocation → invalidates → BoundRemoteCapability`
- `UCPRequestCancel → transitions → RequestCompletionAfterCancel`
- `RequestCompletionAfterCancel → permits → RequestHandleFree`
- `Reconnect → creates → NewEndpointGeneration`
- `GenerationMismatch → blocked_by → StaleXferFailClosedGate`
- `StaleXferFailClosedGate → requires → MetadataRefetchAndReprepare`

## 下一輪研究

鎖定：**NIXL endpoint error callback implementation × `checkTxState()` × #1987 locking fix × connection map ownership × `ucp_ep_close_nbx` completion × retry ownership**。

下一輪要完整回答：
`peer failure → callback thread → lock acquisition → endpoint FAILED → pending requests → close request → close completion → connection removal → metadata invalidation → reconnect E8 → loadRemoteMD G8 → reprepare X8 → retry`。

並建立可驗證的 **Failure Recovery State Machine**，確認每一個 transition 的 owner、lock、generation token、completion condition。

## 本輪結束判斷

- **缺哪一層：** endpoint error callback 到 connection/metadata invalidation 的精確 lock/ownership transition。
- **哪個節點最淺：** `RetryOwnership`。
- **哪個概念仍只是名詞：** `AtomicRecoveryGeneration`；目前不應假設 endpoint/metadata/xfer 三者共享單一 atomic generation。
- **哪個系統值得讀原始碼：** NIXL UCX endpoint/error/reconnect path，其次 OpenUCX endpoint close/error handling implementation。
- **哪篇論文需追引用：** 下一輪補 failure-aware disaggregated KV/inference recovery 文獻；本輪不為滿足格式而加入弱相關論文。
- **哪個概念最適合視覺模擬：** `Failure / Reconnect Generation Simulator`。
- **哪個 Agent 架構最值得實作：** 對 Hermes Runtime 而言是 `Failure-aware Plan-and-Execute Runtime`：把 transport failure observation 映射為可恢復 state transition，而非讓 model 自行猜測是否重試。

## 還原「AI 到底怎麼運作」新增的一段

`使用者 → Agent → Model → KV State → Prepared Xfer → UCX Request → Peer Failure → Endpoint Error Handler → Cancel/Complete Pending Request → Revoke E7/G7/X7 → Reconnect E8 → Metadata G8 → Reprepare X8 → Retry Transfer → Flush/Completion → CUDA Consumer → Attention → Logits → Output`。

本輪核心結論：**分散式 AI 的可靠性不是「網路斷了就重連」；真正需要恢復的是一整組帶 generation 的 execution capabilities。Peer 名稱相同，不代表 endpoint、remote metadata、rkey 或 xfer handle 還是同一代。**