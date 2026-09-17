# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-17 10:54（Asia/Taipei）

## 本小時新發現

本輪延續前一輪 `UCP Request Cancellation × Endpoint Error Handling × Reconnect Generation`，避免重複研究 request/flush 基礎語義，改為深入 NIXL PR #1987 的 endpoint error callback、rkey unpack、close ownership 與 lock transition。

### 新架構 / 工程修正
- NIXL PR #1987（merged 2026-07-29）修復 UCX endpoint teardown 與 synchronous `ucp_ep_rkey_unpack()` 之間的 race。
- endpoint state 由一般欄位改為 `std::atomic<nixl::ucx::ep_state_t>`，保留 transfer fast-path 的 lock-free `checkTxState()`。
- error callback 不再立即 force-close endpoint；它只將 endpoint transition 到 `FAILED`。
- endpoint 的真正 close ownership 被移到 `closeImpl()`；FAILED endpoint 在 teardown path 才執行 `ucp_ep_close_nbx(... FORCE)`。
- `internalMDHelper()` 在 materialize remote public metadata / rkey 前，會檢查所有 worker endpoint 的 `checkTxState()`；FAILED endpoint fail closed。

來源：
- https://github.com/ai-dynamo/nixl/pull/1987
- https://github.com/ai-dynamo/nixl/issues/1986
- https://openucx.readthedocs.io/en/master/api.html

---

# 本小時最重要 5 個發現

## 1. Error callback 應該 revoke capability，而不是同時 destroy capability

### 是什麼
PR #1987 的核心設計改變不是單純「加 mutex」，而是重新分離 failure detection 與 resource destruction。

修正前概念：

```text
UCX error callback
→ endpoint FAILED
→ force close endpoint immediately
```

修正後：

```text
UCX error callback
→ atomic state = FAILED
→ return

later teardown owner
→ closeImpl()
→ observe FAILED
→ ucp_ep_close_nbx(FORCE)
→ endpoint pointer cleared
```

### 底層如何運作
UCX asynchronous callback 可以和 application thread 的 `loadRemoteMD()` 同時執行。若 callback 在另一 thread 正進入 `ucp_ep_rkey_unpack()` 時 destroy endpoint，就會形成 use-after-close / native crash window。

新的設計讓 callback 只做 capability revocation（state transition），不直接做 lifetime destruction。

### 為什麼重要
這是一個可以泛化到 Agent Runtime 的底層原則：

```text
Failure Detection
≠ Resource Revocation
≠ Resource Destruction
```

Agent tool session、browser session、MCP connection、GPU endpoint 都應該避免「偵測到失敗的 thread 同時直接銷毀其他 thread 正在使用的 capability」。

### 限制
FAILED → close 的完整 ownership 仍依賴 higher-level teardown 呼叫；不能僅由本 PR 推論所有 connection-map lifecycle 都已原子化。

### 證據類型
已確認工程實作：NIXL PR #1987 patch。

---

## 2. `checkTxState()` 是 capability gate，但單獨的 check 不是 synchronization

PR 將 endpoint state 改為 atomic，使 transfer path 可以低成本執行：

```text
operation
→ ep.checkTxState()
→ CONNECTED ? continue : fail
```

但 atomic state check 本身不能解決：

```text
Thread A: check CONNECTED
Thread B: close endpoint
Thread A: ucp_ep_rkey_unpack(ep)
```

因此 rkey unpack 與 close 必須共享 endpoint-level synchronization boundary。

這形成兩層防線：

```text
Fast Path Gate
atomic endpoint state
        ↓
Critical Capability Use
state validation + synchronized rkey unpack / close
```

這比「所有 operation 都上一把 global lock」更精確：讀取狀態可以 cheap，真正會 dereference endpoint capability 的 critical section 才需要 serialized lifetime protection。

---

## 3. Remote metadata materialization 現在包含 endpoint-generation validity gate

`internalMDHelper()` 在建立 `nixlUcxPublicMetadata` 之前，新增對每個 worker endpoint 的 state check。

因此 remote metadata path 應更新為：

```text
Serialized Remote Metadata Blob
→ resolve connection
→ for each worker endpoint
   → checkTxState()
   → FAILED ? NIXL_ERR_REMOTE_DISCONNECT
→ unpack rkey
→ build nixlUcxPublicMetadata
→ RemoteSection
→ Prepared Dlist
```

這代表 rkey 不應被視為只由 metadata blob 決定：

```text
RKey Capability
=
Serialized RKey Bytes
+
Live Endpoint Generation
+
Successful Endpoint-bound Unpack
```

相同 metadata bytes 在舊 endpoint E7 與新 endpoint E8 上，不應被 Hermes 視為同一個可執行 capability。

---

## 4. UCX endpoint close 本身也是 asynchronous request lifecycle

OpenUCX 官方 API 定義 `ucp_ep_close_nbx()` 有三種結果：

```text
NULL
→ close completed immediately

ERROR POINTER
→ close failed, but endpoint resources are released and endpoint cannot be reused

REQUEST POINTER
→ close started asynchronously
→ application must progress / observe completion
→ release request handle
```

FORCE close：

```text
Endpoint E7
→ FORCE close
→ outstanding requests complete UCS_ERR_CANCELED
→ endpoint cannot be reused
```

Graceful close：

```text
Endpoint E7
→ flush outstanding operations
→ close completion
```

因此 Hermes 不應再畫：

```text
close(E7)
→ E7 gone
```

而應畫：

```text
CloseRequested
→ Closing
→ OutstandingOpResolution
→ CloseCompletion
→ EndpointDestroyed
```

PR #1987 的 FAILED path 若 `ucp_ep_close_nbx()` 回傳 request pointer，會 free 該 request handle；這個 ownership 行為值得下一輪繼續確認是否依賴 FORCE-close immediate semantics，以及 NIXL 是否需要額外 progress/quiescence contract。

---

## 5. Production failure 顯示「peer recovery」必須是一個 compound atomic operation

NIXL #1986 已確認 endpoint close 與 rkey unpack race 可造成 Decode process native segfault。另一個 2026-08 LightLLM #1470 production report 又顯示 concurrent remove/re-add remote agent 可能和 UCX progress/reconnect 交錯，最後觸發 endpoint protocol assertion。

這支持一個更高層 recovery transaction：

```text
Detect Peer Failure
→ mark old endpoint generation FAILED
→ stop publishing old generation
→ resolve/cancel old requests
→ close old endpoint
→ invalidate old remote metadata
→ remove old peer generation
→ create new endpoint
→ load new metadata
→ prepare new transfer handles
→ publish new peer generation
→ allow new transfers
```

合理工程推論：這些步驟不應由多個 application threads 各自做 remove/add/retry，而應由 connection/recovery owner 序列化。

尚未驗證：NIXL core 是否已把上述整條流程收斂成單一 transaction；目前只能確認 #1987 對 endpoint/rkey critical race 的修正。

---

# Architecture Breakdown

## NIXL UCX Failure / Recovery Architecture

```text
                    ┌────────────────────┐
                    │ UCX Worker Progress │
                    └─────────┬──────────┘
                              │ transport error
                              ▼
                    ┌────────────────────┐
                    │ Endpoint err_cb     │
                    │ CONNECTED → FAILED │
                    └─────────┬──────────┘
                              │ atomic revocation
                ┌─────────────┴─────────────┐
                │                           │
                ▼                           ▼
        Transfer Fast Path          Metadata Load Path
        checkTxState()              internalMDHelper()
                │                           │
          fail closed                check all EP states
                │                           │
                └─────────────┬─────────────┘
                              ▼
                    NIXL_ERR_REMOTE_DISCONNECT
                              │
                              ▼
                    Recovery / Teardown Owner
                              │
                    closeImpl(E7, FORCE)
                              │
                    invalidate E7/G7/X7
                              │
                    reconnect → E8
                              │
                    load metadata G8
                              │
                    prepare X8
                              ▼
                           retry
```

### Control plane
- endpoint state
- connection map
- remote metadata generation
- remote-agent add/remove
- recovery ownership

### Data plane
- prepared descriptor
- rkey
- UCP PUT/GET/SGL request
- worker progress
- flush/completion

### 關鍵邊界
Control plane 若撤銷 E7，data plane 必須不能再 materialize 或 post 使用 E7 的 capability。

---

# Bottom-Level Logic

## Endpoint capability 的最小模型

```text
EndpointCapability = {
  ep_handle,
  state,
  generation,
  error_mode,
  worker,
  close_lifecycle
}
```

Hermes abstraction：

```text
CanUseEndpoint(Eg)
=
state(Eg) == CONNECTED
AND generation == expected_generation
AND close_lifecycle == OPEN
```

但真正 dereference endpoint 的 operation 還需要 lifetime synchronization：

```text
Acquire endpoint lifetime guard
→ re-check state
→ perform endpoint-bound operation
→ release guard
```

### rkey materialization

```text
Remote Metadata Blob
→ Serialized rkey bytes
→ locate Endpoint Eg
→ validate endpoint state
→ acquire lifetime protection
→ ucp_ep_rkey_unpack(Eg, bytes)
→ ucp_rkey_h
→ release lifetime protection
→ Public Metadata Capability
```

### endpoint failure

```text
transport detects failure
→ err_handler callback
→ atomic CONNECTED → FAILED
→ future fast-path operations fail
→ future metadata unpack fails
→ teardown owner closes endpoint
```

這是典型的 revoke-before-destroy pattern。

---

# Visual Simulation Idea

## Endpoint Capability Revocation & Recovery Simulator

Hermes Console 建議新增四條泳道：

```text
App Thread A     | loadRemoteMD → check E7 → rkey unpack
UCX Callback     |                 ERROR → E7 FAILED
Recovery Owner   |                           close E7 → create E8
Transfer Thread  | post X7 ✕                     prepare X8 → post ✓
```

互動控制：
- Inject Peer Failure
- Pause inside rkey unpack
- Fire UCX Error Callback
- Force Close Endpoint
- Graceful Close
- Attempt Old Xfer
- Reconnect
- Load New Metadata
- Retry

顯示的 capability：

```text
E7 endpoint
G7 metadata
R7 rkey
X7 prepared transfer
E8 endpoint
G8 metadata
R8 rkey
X8 prepared transfer
```

Failure 時 E7 先由綠色變橘色 `REVOKED`，等 close completion 才變灰色 `DESTROYED`。

這個視覺差異可以直接教會使用者：

```text
revoked ≠ destroyed
failed ≠ freed
close requested ≠ close completed
```

---

# Code / GitHub

## ai-dynamo/nixl

### PR #1987
https://github.com/ai-dynamo/nixl/pull/1987

值得看的核心檔案：

1. `src/plugins/ucx/ucx_utils.h`
   - `nixlUcxEp`
   - endpoint state 改為 atomic
   - `checkTxState()` fast-path gate

2. `src/plugins/ucx/ucx_utils.cpp`
   - `nixlUcxEp::err_cb()`
   - `nixlUcxEp::closeImpl()`
   - error callback 與 endpoint destruction ownership 分離

3. `src/plugins/ucx/ucx_backend.cpp`
   - `nixlUcxEngine::internalMDHelper()`
   - rkey/public metadata materialization 前的 endpoint state validation

4. `test/gtest/error_handling.cpp`
   - `ErrorCallbackMarksEndpointFailedWithoutClosingIt`
   - 驗證 callback 將 endpoint 標成 FAILED，但不立即清掉 native endpoint

## Issue #1986
https://github.com/ai-dynamo/nixl/issues/1986

Production crash stack：

```text
ucp_ep_rkey_unpack
→ nixl::ucx::rkey::unpackUcpRkey
→ nixlUcxEngine::internalMDHelper
→ nixlRemoteSection::loadRemoteData
→ nixlAgent::loadRemoteMD
```

這是本輪 architecture 的實際 failure evidence。

---

# Papers

本輪沒有把一般 Agent 論文硬塞進 transport correctness；核心新證據來自 production issue、merged source patch 與 UCX 官方 API。

與更高層 disaggregated inference 架構相關、後續值得追引用的研究仍包括 SmartGen / disaggregated KV-transfer 類工作，因 proactive、on-demand、speculative 多路 KV transfer 會放大 endpoint-generation 與 retry ownership 問題。

本輪研究類型標記：
- 官方 API：OpenUCX endpoint close/error semantics
- 工程實作：NIXL PR #1987
- production failure：NIXL #1986、LightLLM #1470
- Hermes abstraction：Capability Revocation / Recovery Transaction

---

# Unknown / Open Questions

## 1. Close request ownership
FAILED endpoint 呼叫 `ucp_ep_close_nbx(FORCE)` 若回傳 asynchronous request，NIXL 當前 `closeImpl()` 對 request handle 的處理與 UCX FORCE-close completion guarantee 如何精確配合？是否存在需要顯式 progress/quiescence 的情境？

## 2. Connection-map atomicity
endpoint state/rkey critical section 已修，但 `connection map → remote metadata → prepared handle → retry` 是否共享同一 generation/transaction boundary仍需讀 agent/core connection management 原始碼。

## 3. Retry ownership
誰是唯一可以將 E7/G7/X7 換成 E8/G8/X8 並重新提交 request 的 owner？framework（vLLM/SGLang/LightLLM）與 NIXL core 的責任界線仍不夠清楚。

---

# 下一輪研究

下一輪鎖定：

**NIXL connection map × remote-agent add/remove × metadata invalidation × retry ownership × duplicate reconnect suppression × UCX close completion**

重點追：

```text
peer failure
→ E7 FAILED
→ connection map ownership
→ removeRemoteAgent / invalidate G7
→ pending X7 resolution
→ close E7 completion
→ duplicate reconnect suppression
→ create E8
→ loadRemoteMD G8
→ prep X8
→ publish generation
→ retry owner
```

並比較 vLLM / SGLang / LightLLM 在 NIXL disconnect 後的 recovery ownership，找出 runtime 應該在哪一層實作 single-flight reconnect。

---

# Knowledge Graph 新增 Node / Edge

## Nodes
- `EndpointCapability`
- `EndpointAtomicState`
- `EndpointLifetimeGuard`
- `CapabilityRevocation`
- `CapabilityDestruction`
- `RKeyUnpackCriticalSection`
- `MetadataMaterializationGate`
- `EndpointCloseRequest`
- `EndpointCloseCompletion`
- `RecoveryOwner`
- `RecoveryTransaction`
- `DuplicateReconnectSuppression`
- `RemoteMetadataPublishGate`
- `RevokeBeforeDestroy`

## Edges

```text
UCXErrorCallback
→ revokes
→ EndpointCapability

EndpointAtomicState
→ gates
→ TransferFastPath

EndpointLifetimeGuard
→ protects
→ RKeyUnpackCriticalSection

EndpointLifetimeGuard
→ serializes-with
→ EndpointDestruction

EndpointCapability
→ required-by
→ RKeyMaterialization

EndpointCloseRequest
→ precedes
→ EndpointCloseCompletion

EndpointCloseCompletion
→ permits
→ EndpointDestruction

RecoveryOwner
→ owns
→ RecoveryTransaction

RecoveryTransaction
→ replaces
→ EndpointGeneration

RemoteMetadataPublishGate
→ prevents
→ StaleGenerationPublication
```

---

# 本輪結束檢查

- **缺哪一層：** connection-map / remote-agent lifecycle 到 framework retry 的 ownership transaction。
- **哪個節點最淺：** `DuplicateReconnectSuppression`。
- **哪個概念仍只是名詞：** `RecoveryTransaction`；這是 Hermes 統一模型，尚未證明 NIXL core 已以單一 transaction 實作。
- **哪個系統最值得讀原始碼：** NIXL connection/agent management + vLLM/SGLang/LightLLM NIXL connector recovery path。
- **哪篇論文需追引用：** disaggregated KV transfer / SmartGen 類研究，尤其 failure/recovery 是否被 benchmark 忽略。
- **哪個概念最適合視覺模擬：** `Revoke → Drain/Cancel → Close → Destroy → Reconnect → Republish` endpoint capability lifecycle。
- **哪個 Agent 架構最值得實作：** Hermes Runtime 的 `Generation-Aware Recovery Supervisor`，用單一 recovery owner 管理 tool/MCP/browser/GPU transport capability generation。

---

# AI 到底怎麼運作：本輪新增的底層鏈

```text
使用者一句話
→ UI
→ Agent Runtime
→ Context / Planning / Memory
→ Model Forward
→ KV / Multimodal State
→ Prepared Transfer
→ Endpoint Capability E7
→ rkey / memh
→ UCX RMA
→ peer failure
→ Error Callback
→ E7 REVOKED
→ old metadata/xfer fail closed
→ Recovery Owner
→ E7 close/destroy
→ E8 reconnect
→ G8 metadata
→ X8 prepared transfer
→ retry
→ GPU state arrives
→ Attention / Fusion
→ logits
→ output
```

多模態對應：

```text
Camera / Image / Voice / Video
→ Encoder
→ Tokens / Latents
→ Fusion State
→ Agent / Model
→ Distributed GPU State Transfer
→ Generation-aware Capability Gate
→ GPU Compute
→ Action / Output
```

本輪核心結論：**可靠的 AI runtime 不能把「失敗」與「釋放」視為同一個動作。先 revoke capability、阻止新使用，再由明確 owner drain/cancel、close、destroy，最後建立新 generation，才是能跨 Agent Tool、MCP connection 與 GPU transport 共用的恢復模型。**