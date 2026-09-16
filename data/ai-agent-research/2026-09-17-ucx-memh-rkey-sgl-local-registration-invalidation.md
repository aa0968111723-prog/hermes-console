# 【AI Agent × Multimodal Research Report】

時間：2026-09-17 06:51（Asia/Taipei）

主題：UCX `ucp_mem_h` / rkey × SGL Prepared Snapshot × Local Registration Invalidation × Endpoint/Metadata Race

## 本小時新發現

本輪延續 05:51 的 `LocalPreparedDlist → metadataP → deregisterMem` 缺口，直接追 NIXL main commit `d24959417cefb5ab5bfb8d132020da010a323684` 的 UCX backend 與 SGL path。核心新結論：UCX registration metadata 並非抽象 bookkeeping。`registerMem()` 會建立 `nixlUcxPrivateMetadata`，其中持有 UCX memory registration handle，並立即 `packRkey()`；`deregisterMem()` 則 `memDereg(priv->mem)` 後直接 `delete priv`。更關鍵的是，SGL prepared path 會在 `sglXfer` 建構時把 local `ucp_mem_h` 與 remote `ucp_rkey_h` 從 metadata object **複製進 prepared SGL arrays**。因此 local registration invalidation 不只是 `metadataP` pointer lifetime 問題：prepared SGL 本身可能持有已 deregister 的 UCX memh snapshot。

這讓上一輪的模型可以進一步精化：`PreparedLocalState` 至少有兩種 materialization mode：一種仍經由 metadataP 解析；另一種（UCX SGL）已把 backend-native capability handle snapshot 進 prepared object。兩者都要求 RegistrationLease 活得比 Prepared/RequestLease 長，但失效型態不同。

## 本小時最重要 5 個發現

### 1. UCX registration object 真正擁有 `ucp_mem_h` 與 packed rkey

【已確認事實 / NIXL 原始碼】`nixlUcxEngine::registerMem()` 呼叫 `uc->memReg(addr,len,priv->mem,mem_type)`，成功後 `uc->packRkey(priv->mem)`，最後將 `nixlUcxPrivateMetadata*` 回傳給 NIXL core。

底層鏈：

`CUDA/DRAM Range → UCX memReg → ucp_mem_h-like wrapper → packRkey → nixlUcxPrivateMetadata → nixlBackendMD*`。

這表示 registration metadata 同時承載 local access capability 與可序列化給 remote peer 的 memory capability。

來源：`ai-dynamo/nixl/src/plugins/ucx/ucx_backend.cpp`。

### 2. `deregisterMem()` 是 capability destruction，不只是 registry delete

【已確認事實 / NIXL 原始碼】UCX backend 的 `deregisterMem(meta)` 直接取回 `nixlUcxPrivateMetadata*`，呼叫 `uc->memDereg(priv->mem)`，接著 `delete priv`。

因此：

`RegistrationLease END → UCX memh deregistered → private metadata object destroyed`。

若任何 prepared state 還依賴這個 memh 或 metadata object，單靠原始 GPU pointer 相同並不能維持有效性。

來源：同上。

### 3. UCX SGL 會把 memh/rkey materialize 成 prepared snapshot

【已確認事實 / NIXL 原始碼】`sglXfer` constructor 為每個 descriptor 建立五個 arrays：`localAddrs_ / remoteAddrs_ / lengths_ / memhs_ / rkeys_`。其中 `memhs_[out] = lmd->getMem().getMemh()`，`rkeys_[out] = rmd->getRkey(worker_id).get()`。之後 `post()` 直接把這些 prepared views 交給 `ep.postSgl()`。

所以 SGL path 是：

`metadataP → ucp_mem_h / ucp_rkey_h → copy into SGL prepared arrays → later postSgl()`。

這是本輪最重要的 bottom-level mechanism。registration 或 remote-key generation 若在 prepare 與 post 之間失效，prepared SGL 不需要再 dereference metadataP，也可能攜帶 stale backend-native handle。

來源：`ai-dynamo/nixl/src/plugins/ucx/ucx_sgl.cpp`。

### 4. Remote restart 的 endpoint/rkey coherence 也存在真實 race

【工程實作 / production issue】NIXL issue #1986（2026-07-23）記錄 surviving Decode process 在 Prefill restart 後，endpoint 被 UCX async error callback force-close，而另一 thread 同時進 `ucp_ep_rkey_unpack()`，造成 crash。這和前幾輪的 `RemoteSection weak generation guard` 並不矛盾：NIXL core metadata generation 可以 fail closed，但 backend endpoint/rkey materialization 仍有自己的 concurrency lifetime。

因此完整 coherence 需要兩層：

`Control-plane metadata generation coherence` AND `Backend endpoint/rkey lifetime coherence`。

### 5. Progress thread 的 CUDA context 也是 transfer correctness dependency

【工程實作 / production issue】NIXL issue #2102（2026-08-17）報告 `nixlUcxSharedThread::run()` 在沒有建立 CUDA context 的 thread 上 `worker->arm()`，UCX `cuda_copy` 最終在 `cuEventQuery` crash；報告稱 8×B200 P/D production 43 小時內出現 9 次。這顯示 transport request 的 correctness graph 還必須包含 `ProgressThread → CUDAContext → UCX CUDA transport`，不能只畫 memory/endpoint ownership。

## Architecture Breakdown

本輪把 Distributed KV transfer 的 UCX datapath更新成：

`KV Block → Local Registered Range → nixlUcxPrivateMetadata → ucp_mem_h → Prepared Descriptor → [optional SGL snapshot] → UCX Worker/Endpoint → remote rkey → RDMA/CUDA transport → completion/progress thread → GPU consumer`。

Capability/lifetime graph：

`AllocationLease → RegistrationLease(ucp_mem_h) → PreparedLease(memh snapshot) → RequestLease → EndpointLease → ProgressExecutionLease`。

Remote side則有：

`RemoteRegistration → packed rkey → metadata exchange → rkey unpack → ucp_rkey_h → Prepared/Request → endpoint`。

## Bottom-Level Logic

### Local registration

`addr,len → uc->memReg → memh → packRkey(memh) → private metadata`。

### SGL preparation

`PreparedMetaDesc[i].metadataP → nixlUcxPrivateMetadata → getMemh()`

`RemoteMetaDesc[i].metadataP → nixlUcxPublicMetadata → getRkey(worker_id)`

然後 materialize：

`{local_addr[i], remote_addr[i], len[i], memh[i], rkey[i]}`。

### SGL post

`Prepared SGL arrays → endpoint.postSgl(...) → UCX operations → completion`。

### Invalidation hazard model

`register G7 → prepare SGL(memh=H7) → deregister G7 → memDereg(H7) → post old SGL(H7)`。

【合理推論 / 尚待實測】這條錯序路徑應視為 invalid use；但具體結果（同步 error、UCX assertion、undefined behavior、driver/backend failure）仍需 ASAN/UCX test 才能定性。

## Visual Simulation Idea

### UCX Capability Lifetime Microscope

四條泳道：

`Allocator | allocate ------------------------------ free`

`NIXL      | register → prepare SGL → request → release → deregister`

`UCX       | memh H7 → packed rkey → SGL snapshot → post → complete → memDereg`

`Peer      | metadata → unpack rkey R7 → endpoint -----------------------`

互動：

1. 在 prepare 後、post 前按 `deregister`：H7 標成 REVOKED，SGL 裡的 H7 snapshot 標成 STALE。
2. 模擬 remote restart：endpoint E7 / rkey R7 變 stale；新 generation E8/R8 出現。
3. 關閉 progress-thread CUDA context：顯示 `worker.arm → cuda_copy → cuEventQuery` crash path。
4. 顯示 `metadata generation`、`endpoint generation`、`registration generation` 三種不同世代，不再合成一個 generation。

## Code / GitHub

本輪值得持續讀：

- `ai-dynamo/nixl/src/plugins/ucx/ucx_backend.cpp`：`registerMem`、`deregisterMem`、`loadRemoteMD`、`prepXfer`、worker/endpoint lifecycle。
- `ai-dynamo/nixl/src/plugins/ucx/ucx_sgl.cpp`：SGL 如何 materialize memh/rkey arrays。
- `ai-dynamo/nixl/src/plugins/ucx/ucx_thread_engine.*`：progress thread、worker arm、CUDA context dependency。
- `ai-dynamo/nixl/src/plugins/ucx/ucx_backend_req.*`：request ownership/completion。
- NIXL #1986：endpoint close vs rkey unpack race after peer restart。
- NIXL #2102：UCX progress thread missing CUDA context。

## Papers

### SmartGen: Seamless Disaggregated LLM Inference with Selective KV Cache Transfer

Authors：Xuchuan Luo, Jiacheng Shen, Xin Wang, Yangfan Zhou  
Year：2026  
Architecture：proactive essential-KV transfer + parallel on-demand fetch + speculative transfer。  
Contribution：把 full-KV transfer 拆成多路、分時的 selective transfer；論文報告 TTST 最多改善 4.3×。  
Limitations：多路 transfer 會增加 registration/prepared-state/endpoint concurrency 的複雜度；論文 performance result 不等於證明 NIXL/UCX lifetime correctness。  
URL：https://arxiv.org/abs/2607.28150

### HyMCache: A KV Cache Framework for Multi-Turn LLM Serving with CXL-Hybrid Memory

Authors：Hakbeom Jang, Inho Song, Sam H. Noh, Jongryool Kim  
Year：2026  
Architecture：CXL hybrid memory + device DRAM + SSD-backed KV capacity + prefix prefetch/write buffering。  
Contribution：把 reusable KV state 擴展到 TB-scale tier；論文報告在相同 DRAM budget 下相對 local LMCache 最高 3.0×。  
Limitations：與 GPU-native UCX registration 是不同 tier，但會進一步增加 heterogeneous memory capability/lifetime graph。  
URL：https://arxiv.org/abs/2607.18141

## 與歷史研究比較

05:51 輪確認 `PreparedLocalDlist` 直接引用 backend `metadataP`，但尚未回答 UCX backend metadata 的內部內容。本輪補上：private metadata 真正擁有 registered memory handle 與 packed rkey；而 SGL path 更進一步把 `ucp_mem_h / ucp_rkey_h` materialize 成 prepared arrays。因此缺口從「local prepared dlist 是否 stale」縮小成「UCX 對已 deregister memh 的 stale SGL post 有何具體 fail behavior，以及 NIXL 是否在 API 層阻止這種 ordering」。

## Unknown / Open Questions 1-3

1. `prepXferDlist → makeXferReq → UCX prepXfer` 的非-SGL path，到底在 request/post 的哪一刻 dereference local `metadataP`？是否存在 API-level registration-presence validation？
2. SGL 已 snapshot `ucp_mem_h` 後，若先 `deregisterMem()` 再 `postSgl()`，UCX 的實際 failure mode 是什麼？需要最小 reproducer + ASAN/UCX debug build。
3. Endpoint/rkey generation 與 NIXL RemoteSection generation 如何原子化協調？#1986 顯示 backend connection lifetime 仍可能跨過 core metadata guard。

## 下一輪研究

下一輪聚焦：`NIXL makeXferReq/postXfer × UCX sendXferRange × ucp_put/get_nbx × memh/rkey validation × endpoint generation × progress-thread CUDA context`。

優先建立一個最小 stale-registration experiment specification：

`cudaMalloc → registerMem → prepXferDlist → makeXferReq → deregisterMem → postXferReq`，分 SGL ON/OFF 比較，並追 NIXL/UCX source 找到第一個理論上能 fail-closed 的 gate。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：

`UCXPrivateRegistrationMetadata`、`UCXMemHandle`、`PackedRKey`、`UCXPublicRemoteMetadata`、`UCXRKeyHandle`、`SGLPreparedCapabilitySnapshot`、`EndpointGeneration`、`ProgressThreadCUDAContext`、`UCXCapabilityRevocation`、`StaleSGLHandle`、`BackendConnectionGeneration`。

新增 Edges：

`RegisteredRange → owns → UCXMemHandle`

`UCXMemHandle → serialized_as → PackedRKey`

`PackedRKey → unpacked_as → UCXRKeyHandle`

`PreparedLocalDescriptor → snapshots → UCXMemHandle`

`PreparedRemoteDescriptor → snapshots → UCXRKeyHandle`

`deregisterMem → revokes → UCXMemHandle`

`RemoteRestart → invalidates → EndpointGeneration`

`EndpointGeneration → scopes → UCXRKeyHandle`

`ProgressThread → requires → CUDAContext`

## 本輪結束判斷

缺哪一層：NIXL request/post 到 UCX `ucp_put/get_nbx` 的 exact fail-closed validation path。  
哪個節點最淺：`UCXCapabilityRevocation`。  
哪個概念仍只是名詞：跨 local registration、remote rkey、endpoint 三者的 `AtomicTransportGeneration`。  
哪個系統值得讀原始碼：NIXL UCX `backend_req / worker / ep / thread_engine` 與 OpenUCX RMA path。  
哪篇論文需追引用：SmartGen，尤其 selective/on-demand KV transfer 的 transport implementation。  
哪個概念最適合視覺模擬：UCX Capability Lifetime Microscope。  
哪個 Agent 架構最值得實作：Execution Digital Twin Agent——讓 Agent 從 request/KV block 一路追蹤 allocation、registration、prepared capability、endpoint、transfer、completion與consumer kernel，而不是只觀察高層 latency。
