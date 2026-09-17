# 【AI Agent × Multimodal Research Report】

時間：2026-09-17 08:54（Asia/Taipei）

主題：NIXL UCX Composite Request × Endpoint Flush × Request Release × Failure Generation

## 與歷史研究比較

前一輪已追到 Prepared Descriptor → memh/rkey → ucp_put_nbx/ucp_get_nbx → UCX progress → endpoint flush。本輪避免重複，專注回答：一批 KV descriptors 對應多個 UCP requests 時，NIXL 如何聚合 SUCCESS / IN_PROGRESS / ERROR；request 何時 free/cancel；endpoint failure 如何進入最終狀態；為何 flush 是 batch completion gate。

## 本小時新發現

1. NIXL UCX backend 的 request handle 本身是一個 composite request：`nixlUcxBackendReqH` 內持有 `std::vector<nixlUcxReq> requests_` 與 connection reference。每個非同步 UCP operation 都由 `append()` 加入此集合。
2. `status()` 不是單一 flag lookup。它先推進 UCX worker，再先檢查最後一個 request；若仍 IN_PROGRESS 就快速返回。若最後一個已完成，再掃描全部 requests：成功的 request 立即 release；未完成者 compact 回 vector；錯誤則經 `checkConnection()` 對照 endpoint 狀態。
3. `release()` 對仍 IN_PROGRESS 的 UCP request 呼叫 cancel，然後 request release。原始碼自己留下 TODO，指出 cancel 可能不足，因此「release = 已安全 quiesce」不能成立。
4. NIXL UCX data path 在 READ/WRITE descriptors 後 append endpoint flush request。UCX 官方語義是 endpoint flush 完成時，先前 RMA/AMO operations 在 origin 與 target 都完成；因此 flush request 是整批 RMA 的 target-completion barrier，而不是單純清空軟體 queue。
5. NIXL 1.4.1 release notes（2026）修正了一個 generation correctness bug：舊 remote xfer handle 在 peer disconnect/re-register 後可能只靠 name 驗證而錯誤套用到新 generation metadata，最終在 UCX send path segfault。這證明 endpoint/metadata generation 必須進入 request-validity gate，而不能只靠 peer name。

## 本小時最重要 5 個發現

### 1. Composite Request Aggregation

已確認工程實作：

Descriptor[0..N] → UCP Request[0..M] → `requests_` → `status()` → aggregate NIXL status。

底層：每個 `append(NIXL_IN_PROG, req, conn)` 將 request handle 保存；同步完成不進 vector；任一 append error 會觸發已啟動 operations 的 release path。

重要性：Hermes Digital Twin 不能用單一「transfer request」圓點表示實際 datapath，必須顯示一個 logical transfer 對多個 physical UCP requests。

限制：不同 backend 的 aggregation contract 不相同，本結論只直接適用 NIXL UCX backend main branch。

來源：https://github.com/ai-dynamo/nixl/blob/main/src/plugins/ucx/ucx_backend_req.h

### 2. `status()` 是 progress + reap + compact state machine

已確認工程實作：

checkXfer → backendReq.status → worker.progressLoop → check last request → scan requests → reqRelease(success) / retain(in-progress) / map(error) → resize pending set。

這表示 polling 本身會改變 request object：已完成 handles 被回收，pending vector 被 compact。

重要性：觀測系統若只讀 status 而假設是 side-effect-free query，會錯誤理解 runtime ownership。

來源：https://github.com/ai-dynamo/nixl/blob/main/src/plugins/ucx/ucx_backend_req.h

### 3. Endpoint Flush 是 target completion gate

官方資訊 + 工程實作交叉驗證：OpenUCX API 說明 endpoint flush 會等待呼叫前 outstanding RMA/AMO 在 origin 和 target 完成；NIXL UCX backend 在資料 operations 後 append `flushEp()` request。

因此：

UCP PUT/GET issued → individual request progress → endpoint flush → remote completion boundary → NIXL aggregate success。

限制：這仍不等價於任意 CUDA consumer kernel 已具備所需 memory ordering；CUDA/GPU consumer synchronization 是下一層。

來源：https://openucx.readthedocs.io/en/master/api.html
來源：https://github.com/ai-dynamo/nixl/blob/main/src/plugins/ucx/ucx_backend.cpp

### 4. Request Release 不是可靠的 quiescence abstraction

已確認工程實作：`release()` 遇到 IN_PROGRESS request 會 `reqCancel()` 後 `reqRelease()`；程式碼 TODO 明確警告 cancel 可能不足。另 NIXL POSIX backend 2026 issue #1955 實際展示 pending callback 在 request handle 被釋放後造成 use-after-free，說明 backend cancellation contract 必須明確建模。

合理推論：UCX backend 不應直接套用 POSIX bug 結論，但 Hermes 應將 `CancellationRequested`、`RequestHandleReleased`、`BackendQuiesced` 拆成不同節點。

來源：https://github.com/ai-dynamo/nixl/blob/main/src/plugins/ucx/ucx_backend_req.h
來源：https://github.com/ai-dynamo/nixl/issues/1955

### 5. Generation Validation 是 send correctness 的必要條件

官方 release engineering evidence：NIXL 1.4.1 修正舊 xfer handle 在 peer disconnect/re-register 後可能命中新 generation metadata 的 use-after-free/segfault window。

因此應建模：

PeerIdentity + EndpointGeneration + RemoteMetadataGeneration + XferHandleGeneration → ValidityGate → postXfer。

「agent name 相同」不能代表 transport capability 仍屬同一 generation。

來源：https://github.com/ai-dynamo/nixl/releases

## Architecture Breakdown

Logical KV Transfer
→ Descriptor List
→ Backend Prepared Request
→ per-descriptor UCP PUT/GET or SGL request
→ append async handles into CompositeRequest
→ append EndpointFlush request
→ UCX Worker Progress
→ status(): reap successes + retain pending + map errors
→ optional notification send
→ final NIXL SUCCESS / IN_PROGRESS / ERROR
→ consumer-side synchronization
→ Attention / state consumer kernel

Failure branch：

Peer disconnect
→ endpoint error callback/state
→ metadata/endpoint generation invalidation
→ status/checkConnection
→ remote-disconnect/error
→ reject stale xfer generation
→ reconnect + fetch current metadata + reprepare

## Bottom-Level Logic

CompositeStatus pseudo-model：

```
progress(worker)
if requests.empty: SUCCESS
if last_request == IN_PROGRESS: IN_PROGRESS
for req in requests:
  s = ucp_request_check_status(req)
  if s == SUCCESS:
    ucp_request_free(req)
  elif s == IN_PROGRESS:
    retain(req)
  else:
    output = map_error_with_endpoint_state(s)
compact(retained)
return output
```

注意：這是依 NIXL main source 對行為的結構化重述，不是 upstream API 規格。

## Visual Simulation Idea

### Composite KV Transfer State Machine

互動欄位：descriptor count、async request count、SGL ON/OFF、peer failure time、flush latency、progress rate、cancel time。

視覺泳道：

```
NIXL       make → append R0 R1 R2 → append FLUSH → check → SUCCESS
UCX Worker      R0==== R1====== R2=== FLUSH==========
Endpoint        E7 healthy -------------------------->
Remote GPU      writes arriving ======= target complete
Consumer                                             Attention
```

故障模式：在 R1 完成後讓 E7 斷線並建立 E8；舊 request/xfer generation 標紅，展示為何「peer name 沒變」仍不能繼續使用舊 capability。

## Code / GitHub

值得繼續讀：

- `src/plugins/ucx/ucx_backend_req.h`：composite request、status/reap/cancel ownership。
- `src/plugins/ucx/ucx_backend.cpp`：post/check/release 與 flush append。
- `src/plugins/ucx/ucx_utils.cpp`：`ucp_put_nbx` / `ucp_get_nbx` / `ucp_ep_flush_nbx`。
- `src/plugins/ucx/ucx_connection.*`：endpoint failure/reconnect generation。
- `src/plugins/ucx/ucx_worker.*`：progress、request cancel/release。
- `test/unit/plugins/ucx/ucx_worker_test.cpp`：flush completion expectations。

## Papers / System Evidence

本輪重點是 runtime source + official API，而不是新增一篇泛化論文。研究證據優先級：NIXL main source > OpenUCX official API > NIXL release notes > production bug reports。

值得後續把 SmartGen / HyMCache 等 KV transport architectures 對映到本輪 composite-request state machine，驗證多階段 KV fetch 在 failure/retry 下如何維持 state correctness。

## Unknown / Open Questions

1. UCX `ucp_request_cancel` 後，何種條件才可視為 NIC/GPU transport 已完全 quiesced，而不只是 request object 可 release？
2. NIXL endpoint reconnect 時，舊 composite request 中已完成與未完成 operations 如何區分 generation ownership；是否所有 pending handles 都必須 fail closed？
3. endpoint flush ERROR 與某個 individual RMA ERROR 同時出現時，NIXL 最終 error precedence 是否完整保留 root cause？

## 下一輪研究

鎖定：`nixlUcxWorker::reqCancel/reqRelease` × `ucp_request_cancel` × UCX endpoint error callback × reconnect generation × NIXL 1.4.1 stale-xfer fix #2027。

目標還原：

Peer E7 disconnect
→ UCX error callback
→ endpoint failed state
→ pending UCP requests
→ cancel/release
→ metadata generation invalidation
→ endpoint E8
→ old xfer rejection
→ new metadata load
→ reprepare
→ safe retry。

## Knowledge Graph 新增 Node / Edge

Nodes：`CompositeUCPRequest`、`PendingRequestSet`、`RequestReap`、`RequestCompaction`、`EndpointFlushBarrier`、`TargetCompletionBoundary`、`CancellationRequested`、`RequestHandleReleased`、`BackendQuiescence`、`EndpointGeneration`、`XferHandleGeneration`、`GenerationValidityGate`、`ErrorPrecedence`、`RetryGeneration`。

Edges：

- `LogicalKVTransfer -> expands_to -> CompositeUCPRequest`
- `CompositeUCPRequest -> contains -> PendingRequestSet`
- `WorkerProgress -> enables -> RequestReap`
- `RequestReap -> compacts -> PendingRequestSet`
- `EndpointFlushBarrier -> establishes -> TargetCompletionBoundary`
- `CancellationRequested -> does_not_imply -> BackendQuiescence`
- `EndpointGeneration -> constrains -> XferHandleGeneration`
- `GenerationValidityGate -> rejects -> StaleTransferCapability`
- `Reconnect -> creates -> RetryGeneration`

## 本輪結束判斷

缺哪一層：UCX cancellation 到 transport/NIC quiescence 的精確語義。

哪個節點最淺：`BackendQuiescence`。

哪個概念仍只是統一抽象：`ErrorPrecedence`。

哪個系統值得讀原始碼：OpenUCX request cancellation + NIXL UCX connection/reconnect path。

哪篇研究需追引用：SmartGen，尤其多階段 KV transfer 在 failure/retry 下的 correctness。

最適合視覺模擬：Composite KV Transfer State Machine。

最值得實作的 Agent 架構：在 Hermes Runtime 建立 `Execution/Transport State Inspector`，把 Agent → Model → KV transfer → composite request → flush → consumer kernel 串成同一 trace，而不是另做一個孤立網路監控頁。
