# 【AI Agent × Multimodal Research Report】

時間：2026-09-23 13:55 Asia/Taipei

## 本小時新發現

主題：Local Proof-Key Broker × Unix Peer Credentials × Workload Attestation × Signer-Use Authorization。

本輪延續上一輪 Non-exportable Proof Key，但不再研究「key 能否被匯出」，而研究更底層的問題：即使 key 永遠留在 HSM/TPM/Signer Broker，另一個本機 process 是否能借用合法 signer 替惡意 MCP request 簽章。

已確認事實：SPIFFE Workload API 刻意不要求 workload 提供 bootstrap secret；實作者需用 out-of-band 方法辨識 caller。SPIRE 在 Unix 上會由本機 Workload API 連線取得 caller PID，再交給 workload attestors 取得 selectors。Linux AF_UNIX 的 SO_PEERCRED 可由 kernel 提供連線 peer 的 PID/UID/GID；SCM_CREDENTIALS 可在 message level 傳遞 credentials。

工程結論：Proof-Key Broker 不應把「能連到 socket」視為 signer authority。必須將每次 sign request 綁定 kernel-derived peer identity、attested workload identity、key handle、semantic request digest 與短生命週期 authorization generation。

## 本小時最重要 5 個發現

### 1. Socket reachability 不等於 signer authorization

底層：Process -> connect(AF_UNIX) -> kernel records peer credentials -> Broker SO_PEERCRED -> PID/UID/GID -> workload identity lookup -> policy -> sign/deny。

`CanConnectToSignerSocket --does_not_prove→ MayUseProofKey`

Unix filesystem permissions可以縮小 attack surface，但高風險 signer仍需 peer-specific authorization。

### 2. SPIFFE 已提供可借鏡的 caller bootstrap pattern

SPIFFE Workload API沒有直接 client-auth token，而由 endpoint implementation用 kernel/orchestrator metadata辨識 caller。SPIRE流程是 Workload calls API -> Agent identifies caller PID -> workload attestors derive selectors -> selectors match registration entry -> SVID returned。

SPIRE current source `pkg/agent/endpoints/middleware.go` 的 `addWatcherPID()` 從 peertracker watcher取得 PID，放入 RPC context，證實 PID 是 workload API authorization/attestation pipeline 的一級輸入。

但：
`CallerPIDKnown --does_not_prove→ CallerStillSameProcessAtLaterSignTime`

因此 signer broker應在 connection/request boundary重新取得 kernel evidence，而不是只在啟動時記一次 PID。

### 3. SO_PEERCRED 與 SCM_CREDENTIALS 是不同粒度

SO_PEERCRED 對 connected AF_UNIX stream/socketpair回傳 peer credentials，反映 connection establishment附近的 peer identity；SCM_CREDENTIALS配合 SO_PASSCRED可在訊息層取得 sender PID/UID/GID。

對長生命週期 signer connection：只有 connection-level identity可能不足以描述每次 semantic authorization，因此 Hermes應把 transport peer witness 與 per-request semantic digest分開。

`PeerCredentialValid --does_not_prove→ RequestedSignatureSemanticallyAuthorized`

### 4. Signer oracle 是 non-exportable key 架構的真正剩餘風險

即使 raw key bytes永不離開 HSM，若任意同 node process可呼叫 `Sign(arbitrary_bytes)`，攻擊者仍可把 HSM變成 signing oracle。

所以 Proof-Key Broker API 不應只接受 opaque digest；高風險模式應接受 structured signing request：

`{ callerWorkload, keyId, purpose, semanticCommitId, canonicalRequestDigest, destination, nonce, expiresAt }`

Broker canonicalize/verify policy後才建立 protocol-specific DPoP signing input。

### 5. PID 不是穩定 workload identity

PID會重用，execve後 PID也可維持，因此 PID只應是 kernel lookup handle，而非 Knowledge Graph 的永久 identity。應提升成：

`LocalCallerGeneration = H(boot_id, pid, process_start_time, uid, cgroup/container selectors, executable/image digest, connection generation)`

其中 boot_id/start_time/cgroup等是 Hermes 建議的工程 binding，需要依平台實作與驗證，不宣稱為 SPIFFE 標準。

## Architecture Breakdown

`Planner`
→ `SemanticCommit Compiler`
→ `Canonical SemanticRequestDigest`
→ `Local Sign Request`
→ `Unix Domain Socket`
→ `Kernel Peer Credential Extraction`
→ `PID -> Workload Attestation/Selectors`
→ `SPIFFE/Deployment Identity Match`
→ `Signer Authorization Policy`
→ `Key Handle / HSM`
→ `DPoP Signature`
→ `MCP Transport`
→ `Remote Replay/Semantic Binding Gate`
→ `Tool Dispatch`
→ `External Effect`
→ `Receipt`

安全 invariant：

`SafeLocalSignature = KernelPeerWitness ∧ WorkloadAttestationMatch ∧ KeyHandleScopeMatch ∧ PurposeMatch ∧ SemanticDigestMatch ∧ AuthorizationFresh ∧ NonExportableSigner`

## Bottom-Level Logic

1. workload建立 UDS connection。
2. kernel產生/保存 peer credential evidence。
3. broker取得 PID/UID/GID。
4. PID只作 lookup key；broker/attestor解析 cgroup/container/executable/UID等 selectors。
5. selectors映射到 workload identity/deployment identity。
6. request canonicalization產生 SemanticRequestDigest。
7. broker驗證 key handle允許的 workload、purpose、destination、risk tier。
8. broker檢查 nonce/expiry/replay state。
9. broker呼叫 non-exportable signer handle。
10. signature與 authorization witness一併寫入 execution evidence。
11. remote MCP resource server仍獨立驗 DPoP、OAuth、semantic binding與 replay。

## Visual Simulation Idea

### Local Signer Oracle Attack Microscope

泳道：`Malicious Process | Legit Agent | Linux Kernel | UDS | Proof-Key Broker | Workload Attestor | HSM | MCP Transport`。

故障注入：
- OTHER_PROCESS_CONNECTS_SOCKET
- SAME_UID_WRONG_CGROUP
- PID_REUSE_AFTER_AUTHORIZATION
- EXEC_AFTER_CONNECTION
- STOLEN_SIGNER_HANDLE
- VALID_PEER_WRONG_SEMANTIC_DIGEST
- EXPIRED_LOCAL_AUTHORIZATION
- DUPLICATE_NONCE
- BROKER_SIGNS_OPAQUE_ATTACKER_DIGEST

UI要分開顯示：`Socket Reachable / Kernel Peer / Workload Match / Deployment Match / Key Scope / Semantic Digest / Freshness / HSM Sign`。

## Code / GitHub

值得繼續讀：
- `spiffe/spire/pkg/agent/endpoints/middleware.go`：`addWatcherPID()` 將 peertracker PID注入 RPC context。
- 下一輪應追 `pkg/common/peertracker` 的 Linux implementation，確認 PID取得、connection lifetime與 race handling。
- 再追 workload attestor Unix/Docker/Kubernetes plugins如何由 PID建立 selectors。

## Papers / Standards / Primary Sources

- SPIFFE Workload API / Workload Endpoint specifications：caller authentication由 out-of-band kernel/orchestrator evidence完成。
- SPIRE Concepts：Workload API -> caller PID -> workload attestors -> selectors -> registration matching。
- Linux `unix(7)`：SO_PEERCRED、SO_PASSCRED、SCM_CREDENTIALS。

本輪沒有硬塞不相關新論文；這一層主要是 OS credential semantics + workload identity runtime architecture，優先使用規格、manual與原始碼。

## Unknown / Open Questions

1. 如何跨 Linux/containerd/Kubernetes/serverless 定義 portable `LocalCallerGeneration`？
2. 長生命週期 UDS connection遇到 exec/cgroup mutation時，broker應逐 request re-attest還是 event-driven invalidate？
3. signer broker如何在不接觸 model-generated arbitrary bytes的前提下安全構造 DPoP proof signing input？

## 下一輪研究

追 `SPIRE peertracker -> Linux socket peer PID -> workload attestor selectors -> process/cgroup/container identity` 原始碼；比較 pidfd/process start time/cgroup v2 作為 anti-PID-reuse binding；建立 Signer Broker 的 structured request canonicalization與 local replay cache。

## Knowledge Graph 新增 Node / Edge

Nodes：`LocalSignerBrokerIdentity`, `KernelPeerCredentialWitness`, `UnixSocketConnectionGeneration`, `LocalCallerGeneration`, `SignerUseAuthorizationGeneration`, `SignerPurposeConstraint`, `SignerKeyScope`, `LocalSemanticDigestBinding`, `SignerOracleRisk`, `PIDReuseRisk`, `PeerCredentialFreshnessWitness`。

Edges：
- `UnixSocketConnection -> produces -> KernelPeerCredentialWitness`
- `KernelPeerCredentialWitness -> identifies_for_lookup -> CallerPID`
- `CallerPID -> does_not_equal -> StableWorkloadIdentity`
- `CallerPID -> feeds -> WorkloadAttestor`
- `WorkloadAttestor -> produces -> WorkloadSelectors`
- `WorkloadSelectors -> resolve -> WorkloadIdentity`
- `WorkloadIdentity + SemanticRequestDigest -> constrain -> SignerUseAuthorization`
- `SignerUseAuthorization -> permits -> NonExportableSignerOperation`
- `NonExportableKey -> does_not_prevent -> SignerOracleAbuse`

## 本輪結束判斷

缺哪一層：kernel peer/process identity到 stable workload generation 的 anti-reuse / anti-exec binding。

最淺節點：`LocalCallerGeneration`。

仍只是名詞：portable `SignerUseAuthorizationWitness`。

最值得讀原始碼：SPIRE `pkg/common/peertracker` + Unix workload attestor。

最值得追引用：SPIFFE Workload Endpoint/Workload API 的 out-of-band caller-auth security rationale與 Linux peer credential semantics。

最適合視覺模擬：Local Signer Oracle Attack Microscope。

最值得實作的 Agent 架構：`Risk-aware Planner + SemanticCommit Compiler + Kernel-authenticated Local Proof-Key Broker + Workload Attestation + Non-exportable Signer + DPoP/OAuth + MCP Per-Tool Authorization + Fenced Effect Runtime + ReceiptVerifier`。

最終鏈新增一段：

`Reasoning -> Planning -> SemanticCommit -> Local Sign Request -> Kernel Peer Identity -> Workload Attestation -> Signer Authorization -> HSM Signature -> DPoP -> MCP -> Tool -> Effect -> Receipt`。
