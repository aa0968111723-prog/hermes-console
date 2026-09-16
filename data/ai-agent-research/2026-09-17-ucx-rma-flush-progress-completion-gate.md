# 【AI Agent × Multimodal Research Report】

時間：2026-09-17 07:50（Asia/Taipei）

主題：NIXL `postXfer` × UCX RMA `ucp_get_nbx/ucp_put_nbx` × Endpoint Flush × Progress/Completion Gate

> 本輪延續上一輪「UCX memh/rkey/SGL local registration invalidation」，避免重複 registration/VMM 主題，改追真正的 datapath：prepared descriptor 如何成為 UCP RMA operation，以及 NIXL 何時才把 transfer 判定為完成。

## 本小時新發現

- 新底層機制：NIXL UCX non-SGL READ/WRITE 直接落到 `ucp_get_nbx` / `ucp_put_nbx`，local `ucp_mem_h` 透過 `UCP_OP_ATTR_FIELD_MEMH` 傳入，remote capability 則是 `ucp_rkey_h`。
- 新 completion 模型：NIXL 在 descriptor operations 後額外 post `ucp_ep_flush_nbx`；原始碼註解明確說 flush 用來讓 request handle 在 local requests 已完成後仍維持 non-empty，直到 operation 真正完成。
- 新 SGL lifetime 約束：UCX SGL API 會 copy descriptor structure，但不 copy buffers/lengths/memhs/rkeys arrays；這些 arrays 必須活到 transfer completion。
- 新 failure boundary：endpoint `checkTxState()` 是 RMA post 前的 fail-closed gate，但它只能擋「endpoint 已知失效」，不能證明 memh/rkey/allocator generation 仍有效。
- 新 runtime failure：2026-08 NIXL #2102 指出 shared UCX progress thread 在沒有 current CUDA context 時 `worker->arm()` 可進入 `cuEventQuery` crash；因此「request 已 post」到「request 完成」之間還依賴 progress execution context。

## 本小時最重要 5 個發現

### 1. NIXL descriptor 最終會落成 UCP RMA call

**已確認事實 / 原始碼**

Non-SGL READ：

```text
NIXL local descriptor
→ local address + local nixlUcxMem.memh
→ remote address + remote rkey
→ endpoint checkTxState
→ ucp_get_nbx(..., memh, remote_addr, rkey)
→ UCS_OK | request pointer | error
```

WRITE 對稱地使用 `ucp_put_nbx`。

**為什麼重要**：Hermes Digital Twin 現在可以把「NIXL transfer」從抽象節點拆成真正 capability tuple：

```text
Endpoint
+ Local Address
+ Length
+ Local memh
+ Remote Address
+ Remote rkey
= UCP RMA Operation
```

**限制**：UCP 仍會在內部選 lane/protocol/transport，因此 `ucp_put_nbx` 不等於固定走 RDMA/NVLink。

來源：NIXL `src/plugins/ucx/ucx_utils.cpp`；OpenUCX API docs。

### 2. Local request completion 不等於 NIXL transfer completion

**已確認事實 / 原始碼**

`sendXferRange()` 逐 descriptor post READ/WRITE；之後即使 local UCP request 已經完成，NIXL 仍會 post：

```text
ucp_ep_flush_nbx(endpoint)
```

NIXL source comment：flush 讓 backend handle 保持 non-empty，直到 operation 真正完成，即使 local requests 已先完成。

因此應建模：

```text
Descriptor Post
→ Local UCP Request State
→ Endpoint Flush
→ Flush Completion
→ NIXL Backend Handle SUCCESS
```

**為什麼重要**：如果 Console 把「最後一個 put/get request completed」當成 KV 可安全消費，會低估 remote visibility / endpoint ordering gate。

### 3. SGL 是 capability-array lease，不只是 batching optimization

**官方資訊 + 工程實作交叉驗證**

UCX SGL API 說明指出 local SGL 的 buffers/lengths/memhs/counts/strides，以及 remote SGL 的 remote_addrs/lengths/rkeys arrays，不會被 library copy，必須持續有效直到 transfer request completed。

NIXL SGL path則把 prepared `memh[]` / `rkey[]` arrays 交給 `postSgl()`，最後以 SGL datatype 呼叫 `ucp_put_nbx`。

所以 SGL 的 correctness dependency 是：

```text
Prepared SGL Arrays
├ local addresses
├ lengths
├ memhs
├ remote addresses
└ rkeys
        ↓
must outlive
        ↓
UCP SGL Request Completion
```

這比上一輪單純的 `PreparedCapabilityLease` 更精確。

### 4. Endpoint state 是第一道 gate，但不是完整 generation validator

`read()` / `write()` / `postSgl()` 在 post 前都會先呼叫 `checkTxState()`。這是可確認的 fail-closed gate：peer 已被 UCX/NIXL 標成 failure 時，不再發新 request。

但目前沒有證據顯示這一步會重新驗證：

```text
local allocator generation
local memh generation
remote rkey generation
prepared SGL generation
```

因此目前最安全的模型是：

```text
CanPostRMA
=
EndpointHealthy
AND PreparedCapabilitiesStillAlive   // runtime lifetime contract
AND RegistrationStillAlive           // lifetime contract
```

其中第一項有直接 source gate；後兩項仍主要靠 lifetime ordering，而非每次 post 的 generation counter。

### 5. Completion 還依賴 progress execution context

2026-08-17 NIXL #2102 報告 shared UCX progress thread `worker->arm()` 沒有建立 CUDA context，最終在 `cuEventQuery` crash；同類 stack 也出現在 SGLang #23489/#23499，2026-08 又有 #35189 指出問題仍可重現。

因此 distributed inference 的 transfer completion 不只是 network event：

```text
RMA Posted
→ UCX Worker
→ Progress Thread / Caller Progress
→ CUDA Transport Progress
→ CUDA Context Correctness
→ Endpoint Flush Completion
→ NIXL Completion
```

**限制**：issue 是 production bug report，不等於所有 UCX/NIXL deployment 都會觸發；是否已被後續 commit 修復需持續追蹤。

## Architecture Breakdown

### System architecture：Disaggregated KV RMA execution

```text
Prefill KV Block
→ NIXL prepared descriptors
→ Backend request
→ UCX endpoint
→ checkTxState
→ local memh + remote rkey
→ ucp_put_nbx / ucp_get_nbx
→ selected UCX lane/protocol
→ NIC / CUDA IPC / CUDA copy / fallback
→ UCP request progress
→ endpoint flush
→ backend request SUCCESS
→ Decode-side KV consumer
→ Attention kernel
```

### Control plane vs data plane

```text
CONTROL PLANE
remote agent metadata
→ endpoint / rkey construction
→ endpoint health generation

DATA PLANE
prepared descriptor
→ put/get/SGL
→ progress
→ flush
→ completion
```

兩者在 endpoint/rkey capability 交會。

## Bottom-Level Logic

### Non-SGL WRITE

```text
Intent: move KV bytes to peer
→ select descriptor i
→ laddr = local[i].addr
→ len = local[i].len
→ memh = local[i].metadataP->mem
→ raddr = remote[i].addr
→ rkey = remote[i].metadataP->getRkey(worker)
→ checkTxState()
→ ucp_put_nbx(ep,laddr,len,raddr,rkey,{memh})
→ request pointer / inline completion / error
→ retain relevant request state
→ ucp_ep_flush_nbx(ep)
→ progress
→ flush complete
→ NIXL backend handle SUCCESS
```

### SGL WRITE

```text
Prepared descriptors
→ build local SGL arrays
→ build remote SGL arrays
→ postSgl
→ ucp_put_nbx(SGL datatype)
→ arrays remain alive
→ endpoint flush
→ progress
→ request completion
→ arrays may be released
```

## Visual Simulation Idea

### UCX RMA Completion Gate Simulator

Hermes Console 顯示 6 條泳道：

```text
Agent/NIXL | prepare → post --------------------→ SUCCESS
Endpoint   | healthy → RMA =====================→ flush
UCX Worker |           queue → progress → progress
CUDA       |                    context → event
NIC/GPU    |              DMA ==================>
Consumer   |                                      Attention
```

互動控制：
- READ / WRITE
- SGL ON / OFF
- descriptor count
- endpoint healthy / failed
- memh alive / revoked
- rkey generation current / stale
- progress thread ON / OFF
- CUDA context present / missing
- flush pending / completed

應展示三個不同 completion：`Local Request Done`、`Endpoint Flush Done`、`Consumer Safe`，避免把它們視為同一事件。

## Code / GitHub

值得繼續讀：

- `ai-dynamo/nixl/src/plugins/ucx/ucx_utils.cpp`
  - `nixlUcxEp::read`
  - `nixlUcxEp::write`
  - `nixlUcxEp::flushEp`
  - `nixlUcxEp::postSgl`
- `ai-dynamo/nixl/src/plugins/ucx/ucx_backend.cpp`
  - `prepXferSgl`
  - `sendXferSgl`
  - `sendXferRange`
  - `postXfer`
  - `checkXfer`
  - `progress/progressLoop`
- 下一輪：`nixlUcxBackendReqH::status/append/release`、worker request progress internals、endpoint failure state machine。

## Papers / Technical Sources

本輪核心是原始碼與官方 transport API，未硬塞與主題關聯薄弱的新論文。補充 system-level研究仍應追 disaggregated inference / KV transfer architectures，但本輪的主要增量是 completion semantics。

來源：
- OpenUCX API Documentation: https://openucx.readthedocs.io/en/master/api.html
- NIXL source: https://github.com/ai-dynamo/nixl
- NIXL issue #2102: https://github.com/ai-dynamo/nixl/issues/2102
- SGLang issue #35189: https://github.com/sgl-project/sglang/issues/35189

## Unknown / Open Questions

1. `nixlUcxBackendReqH::status()` 如何聚合 multiple UCP request + flush request？是否存在任一 request error 時的 deterministic cancellation/cleanup ordering？
2. non-SGL path 中前面 pending request 被 `ucp_request_free()` 後，UCX 對 operation completion/remote ordering的責任如何由 endpoint flush承接？需對照 UCX request-free 與 flush semantics。
3. endpoint generation、remote rkey lifetime與 connection reconnect之間，是否有原子 epoch/coherence boundary，還是仍可能出現 reconnect race？

## 下一輪研究

主題：**NIXL `nixlUcxBackendReqH` × UCP Request Free/Completion × Endpoint Flush Semantics × Reconnect Generation × Error Propagation**

要直接回答：

```text
N descriptors
→ N UCP requests
→ only selected request handles retained/freed
→ endpoint flush
→ status()
→ error / reconnect during progress
→ NIXL 到底如何決定 SUCCESS / ERROR？
```

並追 `ucp_request_free` 是否只釋放 request object handle、是否不等於 cancel operation，以及 flush 如何提供 remote completion/order boundary。

## Knowledge Graph 新增 Node / Edge

### Nodes
- UCPRMAOperation
- UCPGetNBX
- UCPPutNBX
- LocalMemHandleCapability
- RemoteRKeyCapability
- EndpointHealthGate
- UCXRequestObject
- EndpointFlushRequest
- LocalRequestCompletion
- EndpointFlushCompletion
- SGLArrayLease
- ProgressExecutionContext
- CUDAProgressContext
- ConsumerSafetyGate

### Edges

```text
PreparedDescriptor → materializes → UCPRMAOperation
UCPRMAOperation → requires → LocalMemHandleCapability
UCPRMAOperation → requires → RemoteRKeyCapability
UCPRMAOperation → guarded_by → EndpointHealthGate
UCPRMAOperation → produces → UCXRequestObject
UCXRequestObject → progressed_by → ProgressExecutionContext
ProgressExecutionContext → may_require → CUDAProgressContext
UCPRMAOperation → ordered_by → EndpointFlushRequest
EndpointFlushRequest → produces → EndpointFlushCompletion
SGLArrayLease → must_outlive → UCPRMAOperation
EndpointFlushCompletion → contributes_to → ConsumerSafetyGate
```

## 本輪結束判斷

- **缺哪一層**：UCP request-object ownership → flush completion → NIXL aggregate status 的精確 state machine。
- **哪個節點最淺**：`ConsumerSafetyGate`，尤其 RDMA completion 到 CUDA consumer ordering仍需與 CUDA memory model交叉驗證。
- **哪個概念仍只是名詞**：`AtomicTransportGeneration`，尚未看到單一跨 endpoint/rkey/memh 的原子 generation object。
- **哪個系統值得讀原始碼**：NIXL `nixlUcxBackendReqH` + OpenUCX request/progress/flush implementation。
- **哪篇論文需追引用**：下一輪回到 disaggregated inference 時，優先追 KV transfer scheduling / partial transfer papers對 completion與overlap的假設；本輪不以論文為主。
- **哪個概念最適合視覺模擬**：`Local Request Done ≠ Endpoint Flush Done ≠ Consumer Safe` 三階段 completion viewer。
- **哪個 Agent 架構最值得實作**：在 Hermes Runtime 中實作 `PhysicalExecutionTrace`，把 Agent→Model→KV→NIXL→UCX→GPU completion 事件串成可觀測 trace，而不是新增另一個高階 planner。

## 對「AI 到底怎麼運作」新增的一段

```text
使用者輸入
→ Agent Runtime
→ Model Forward
→ KV State
→ Prepared Transfer Descriptor
→ Local memh / Remote rkey
→ UCP put/get
→ UCX transport selection
→ NIC / GPU data movement
→ UCP progress
→ Endpoint Flush
→ NIXL completion
→ CUDA consumer ordering
→ Attention Kernel
→ Logits
→ Output
```

本輪最重要的修正是：**「資料已送出」不是「資料已完成」，「local request 完成」也不是「remote KV 已可安全被 Attention 消費」。Distributed AI runtime 必須把 request、progress、flush、memory visibility 與 consumer dependency分成不同節點。**