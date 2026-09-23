# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-23 14:56 Asia/Taipei

## 本小時新發現
本輪承接上一輪 `LocalCallerGeneration` 與 `ProofKeyBrokerIdentity → RequestingProcessIdentity`，避免重複 DPoP/HSM/MCP sender constraint，改向 Linux process-generation correctness 下鑽：`SO_PEERCRED PID → /proc handle → starttime → pidfd → exec boundary → cgroup/container selectors → signer authorization`。

新架構：**Process-Generation-Bound Signer Authorization**。新底層機制：Linux pidfd + `/proc/<pid>/stat` starttime + SPIRE peertracker 的 procfd/starttime/UID/GID liveness check。

核心結論：

`PID == identity` 是錯的；`PID + starttime` 比 PID 強，但仍不等於 executable generation；`pidfd` 能穩定指向 task、避免典型 PID reuse targeting race，但 `execve()` 不建立新 process 且 PID 不變，因此 process identity 與 code/executable identity 必須分層。

---

## 本小時最重要 5 個發現

### 1. SPIRE 已經實作了比「只記 PID」更強的 caller-generation 防線【已確認／原始碼】
Current SPIRE `pkg/common/peertracker/tracker_linux.go` 在建立 watcher 時先開啟 `/proc/<pid>` directory fd，再讀 `/proc/<pid>/stat` 的 starttime，並保存 UID/GID。`IsAlive()` 會重新讀 directory handle、重新取得 starttime，並比較 UID/GID；原始碼甚至明確說這是為避免 reused PID 與原 caller collision。

因此 SPIRE 現行模型近似：

`SO_PEERCRED → PID/UID/GID → open(/proc/PID) → starttime snapshot → later liveness/starttime/UID/GID revalidation`

這比上一輪假設的單純 PID lookup 更完整。

但限制仍存在：它主要回答「是不是同一個 process generation / caller ownership」，不直接回答「process 是否在中途 exec 成另一份程式」。

### 2. `/proc/<pid>/stat` field 22 `starttime` 是 process-generation witness，不是 executable-generation witness【已確認／官方 Linux 文檔】
Linux proc documentation定義 field 22 `starttime` 為 process 自 system boot 後開始的時間。因此 `(pid,starttime)` 可大幅降低 PID reuse ambiguity。

可形成：

`ProcessGeneration ≈ (pidNamespace, pid, starttime)`

但：

`Same(pid,starttime) --does_not_prove→ SameExecutableImage`

因為 `execve()` 會讓既有 process 執行新 program，而不是建立新 process；PID保持不變。

### 3. pidfd 是更適合 signer broker 的 kernel task handle，但不能單獨解決 exec replacement【已確認／官方 Linux 文檔】
`pidfd_open(pid)` 取得指向 task 的 file descriptor；pidfd 可被 poll/wait，且 `pidfd_send_signal()` 的設計目的之一就是避免傳統 PID interface 在 PID reuse 後誤操作另一個 process。`clone3(CLONE_PIDFD)` 更能在 child creation 時直接取得 pidfd，避免「先拿 PID、再 open pidfd」之間的 acquisition window。

因此 Hermes local broker 應優先：

`Peer PID → pidfd acquisition → process-generation checks → workload attestation → authorization`

而不是把裸 PID 長期保存。

但：

`pidfdStable --does_not_prove→ ExecutableDidNotExec`

### 4. exec 是 signer authorization 的獨立 TOCTOU boundary【已確認事實 + 工程推論】
Linux `execve()` 不產生新 process，PID可保持不變。因此即使 broker 在 socket connect 時完成：

`PID ✓ | starttime ✓ | UID ✓ | cgroup ✓`

之後 caller仍可能 exec 到另一 executable，再使用既有連線。如果 authorization只綁 connection/process generation，而不綁 executable/deployment generation，會留下 signer-oracle window。

Hermes應拆成：

`ProcessGenerationWitness`

與

`ExecutableGenerationWitness`

並要求高風險 sign operation 在簽名前重新驗：

`process alive ∧ generation same ∧ workload selectors still valid ∧ deployment/image digest expected ∧ semantic request digest current`

### 5. cgroup/container selector 是 workload mapping evidence，不應取代 process-generation handle【已確認／SPIRE工程實作】
SPIRE Kubernetes workload attestor會從 workload cgroup membership解析 pod ID，再向 kubelet取得 pod資訊；官方文件也警告 tag-based image selector可能不一致，建議可靠匹配使用 digest-based image identifier。

因此：

`SameCgroup --does_not_prove→ SameProcessGeneration`

`SameImageTag --does_not_prove→ SameArtifactDigest`

較安全組合是：

`pidfd/process-generation + cgroup/container/pod identity + digest-based deployment identity`

而不是三者擇一。

---

## Architecture Breakdown

### Process-Generation-Bound Proof-Key Broker

```text
Agent Planner
  ↓
SemanticCommit
  ↓
Local Sign Request
  ↓
Unix Domain Socket
  ↓
Kernel peer credential (PID/UID/GID)
  ↓
Acquire stable task witness
  ├─ pidfd (preferred)
  └─ procfd + /proc/PID/stat starttime (SPIRE current pattern)
  ↓
ProcessGenerationWitness
  ↓
Workload Attestation
  ├─ cgroup/container/pod selectors
  ├─ image/deployment digest
  └─ SPIFFE identity
  ↓
Executable/Deployment Generation Revalidation
  ↓
SignerUseAuthorization
  ↓
SemanticRequestDigest verification
  ↓
Non-exportable HSM/TPM/PKCS#11 signer
  ↓
DPoP proof
  ↓
MCP tools/call
  ↓
Per-tool authorization / fence / idempotency
  ↓
External effect
  ↓
Receipt
```

新增 invariant：

`SafeSignerUse = PeerCredentialFresh ∧ ProcessGenerationAlive ∧ WorkloadSelectorMatch ∧ DeploymentDigestMatch ∧ SemanticDigestMatch ∧ SignerPolicyMatch ∧ AuthorizationFresh`

---

## Bottom-Level Logic

### PID reuse race
裸 PID 是 namespace-local integer，process退出後可被重用。若流程是：

`read PID → process exits → PID reused → inspect PID`

後半段可能檢查到不同 process。

### starttime
`/proc/PID/stat` field 22提供 process start time。SPIRE保存首次 starttime，之後重讀比較；若不同就視為 new process。

### procfd
SPIRE先 open `/proc/PID` directory並保存 fd，再用它做 caller liveness補強。這是對 PID reuse race 的實際 production mitigation。

### pidfd
pidfd讓 kernel提供 task handle。`pidfd_open()`適合已存在 process；若自己建立 worker，`clone3(CLONE_PIDFD)`能在建立時直接回傳 pidfd，是更乾淨的 race-resistant acquisition path。

### exec boundary
`execve()`不是 process replacement，而是同一 process改執行另一 program。因此：

`ProcessGenerationStable ≠ CodeGenerationStable`

Signer broker若允許 connection-level authorization，exec後的新程式可能繼承可用 channel/FD。高風險 signer必須將 authorization綁到 deployment/executable evidence與 per-request semantic digest，而不是只綁 PID/pidfd。

---

## Visual Simulation Idea

### Process Generation & Exec Race Microscope
泳道：

`Agent | Unix Socket | Kernel | peertracker | /proc | pidfd | cgroup/runtime | SPIRE Attestor | Signer Broker | HSM`

互動 fault injection：
- `PID_REUSED_BEFORE_PROC_LOOKUP`
- `PID_REUSED_AFTER_PEER_CREDENTIAL_CAPTURE`
- `PROCESS_EXITS_AFTER_ATTESTATION`
- `EXECVE_AFTER_SOCKET_AUTH`
- `SAME_PID_STARTTIME_NEW_EXECUTABLE`
- `SAME_CGROUP_DIFFERENT_PROCESS`
- `IMAGE_TAG_REPOINTED_SAME_TAG`
- `IMAGE_DIGEST_MISMATCH`
- `PIDFD_ALIVE_BUT_DEPLOYMENT_DIGEST_CHANGED`
- `SEMANTIC_DIGEST_CHANGED_BEFORE_SIGN`

UI證據條：

`Peer PID | pidfd | starttime | UID/GID | cgroup | pod/container | image digest | executable generation | semantic digest | signer authorization`

最重要的教學案例：

`PID ✓  starttime ✓  pidfd alive ✓  exec generation ✗  → BLOCK SIGN`

---

## Code / GitHub

### SPIRE
值得繼續讀：
- `pkg/common/peertracker/tracker_linux.go` — procfd、starttime、UID/GID、liveness/reuse檢查。
- `pkg/common/peertracker/peertracker.go` — PeerTracker/Watcher abstraction。
- `pkg/agent/endpoints/peertracker.go` — watcher進入 workload attestation path。
- `pkg/agent/endpoints/middleware.go` — caller PID進 RPC context。
- Kubernetes/Docker workload attestor — PID/cgroup → workload selectors → deployment identity。

原始碼的重要工程訊號：SPIRE current Linux watcher已經意識到 PID collision/reuse問題，並用 proc directory handle + starttime雙重補強。Hermes不應退化成較弱的 PID-only broker。

---

## Papers / Technical Sources

本輪重點偏 OS/runtime correctness，主要依官方 Linux manual、SPIRE官方文件與原始碼，而非新增模型論文。

1. **Linux pidfd API (`pidfd_open`, `clone3(CLONE_PIDFD)`, `pidfd_send_signal`)**
   - Institution/project: Linux kernel / man-pages
   - Contribution: race-resistant process handles，避免裸 PID reuse targeting。
   - Limitation: task identity不是 executable/code-generation attestation。

2. **SPIRE peertracker Linux implementation**
   - Project: SPIFFE/SPIRE, CNCF
   - Architecture: UDS caller → peer credentials → watcher → procfd/starttime → workload attestation。
   - Contribution: production-grade caller liveness/PID-reuse mitigation。
   - Limitation: process-generation witness仍需與 executable/deployment generation及 semantic authorization結合。

---

## 與歷史研究比較
上一輪已建立 `KernelPeerCredentialWitness`、`LocalCallerGeneration`、`SignerOracleRisk`；本輪沒有再論證 SO_PEERCRED 或 HSM non-exportability，而是補上它們之間最危險的時間軸問題：

`Peer credential capture → process generation → exec/reuse race → signer invocation`

因此 `LocalCallerGeneration` 從概念節點細化為：

`KernelPeerCredentialWitness → StableTaskHandle → ProcessGenerationWitness → WorkloadSelectorWitness → ExecutableGenerationWitness → SignerUseAuthorization`

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `StableTaskHandle`
- `PidfdTaskIdentity`
- `ProcDirectoryHandleWitness`
- `ProcessStarttimeWitness`
- `ProcessGenerationWitness`
- `ExecutableGenerationWitness`
- `ExecTransitionGeneration`
- `CgroupMembershipWitness`
- `ContainerDigestWitness`
- `SignerPreExecutionRevalidationWitness`

### Edges
- `KernelPeerCredentialWitness -> identifies_candidate -> ProcessGenerationWitness`
- `PidfdTaskIdentity -> stabilizes -> ProcessGenerationWitness`
- `ProcessStarttimeWitness -> detects -> PIDReuseRisk`
- `ExecTransitionGeneration -> invalidates -> ExecutableGenerationWitness`
- `ProcessGenerationWitness --does_not_prove-> ExecutableGenerationWitness`
- `CgroupMembershipWitness --does_not_prove-> ProcessGenerationWitness`
- `ImageTag --does_not_prove-> ContainerDigestWitness`
- `SignerPreExecutionRevalidationWitness -> guards -> SignerUseAuthorizationGeneration`

---

## Unknown / Open Questions
1. 如何在不引入高 overhead 的前提下，可靠偵測 socket建立後到每次 signer operation前的 `execve()` generation transition？是否以 executable inode/digest、LSM/eBPF exec event或 container immutable deployment identity作主 witness？
2. pidfd + starttime + cgroup + image digest的最小充分集合是什麼？不同 container runtime / serverless環境如何可攜？
3. Signer broker應該每次 sign都重新 workload-attest，還是使用短生命週期、generation-bound local authorization lease？其 revocation/exec invalidation如何做到近即時？

---

## 下一輪研究
鎖定：

`exec transition → executable identity → fs-verity/IMA measurement → Linux IMA appraisal/measurement → TPM PCR quote → workload code identity → signer authorization revocation`

要回答：**如果 pidfd證明「還是同一個 process」，Hermes如何證明它仍然在執行被批准的 code，而不是同 PID exec成另一份 binary？**

---

## 本輪結束判斷
- **缺哪一層：** process-generation → executable/code-generation 的可信 measurement layer。
- **哪個節點最淺：** `ExecutableGenerationWitness`。
- **哪個概念仍只是名詞：** portable `SignerPreExecutionRevalidationWitness`。
- **哪個系統值得讀原始碼：** SPIRE `peertracker` + Linux IMA/EVM measurement/appraisal path。
- **哪篇論文/技術脈絡需追引用：** Linux pidfd設計與 IMA measured boot / runtime measurement architecture。
- **哪個概念最適合視覺模擬：** `Process Generation & Exec Race Microscope`。
- **哪個 Agent 架構最值得實作：** `Risk-aware Planner + pidfd-bound Local Signer Broker + Workload/Executable Generation Revalidation + Non-exportable Proof Key + DPoP/MCP + Fenced Effect Runtime + ReceiptVerifier`。

最終總鏈新增一段：

`Reasoning → Planning → SemanticCommit → UDS → Kernel Peer → Stable Task Handle → Process Generation → Workload/Code Generation → Signer Authorization → HSM → DPoP → MCP → Tool → External Effect → Receipt`
