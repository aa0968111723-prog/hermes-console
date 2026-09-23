# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-23 15:53 Asia/Taipei

## 本小時新發現
本輪承接上一輪最淺的 `ExecutableGenerationWitness`，不重複 pidfd / DPoP / HSM / MCP sender constraint，改向 Linux executable/code-generation measurement 下鑽：

`exec boundary → BPRM_CHECK → IMA measurement/appraisal → file/content digest → fs-verity Merkle root → TPM PCR / measurement log → remote verifier → signer authorization revocation`。

新 system architecture：**Executable-Generation-Bound Signer Authorization**。

新 bottom-level mechanism：**Linux IMA exec hook + fs-verity content-addressed executable identity + TPM-anchored runtime measurement**。

核心結論：

`SameProcessGeneration --does_not_prove→ SameExecutableGeneration`

`MeasuredExecutable --does_not_prove→ ApprovedExecutable`

`fsVerityDigestMatch --does_not_prove→ RuntimeStateTrusted`

`TPMQuoteValid --does_not_prove→ MeasurementPolicyComplete`

因此 Hermes 必須把「process 還活著」「exec 的檔案內容是什麼」「這份內容是否被 policy 允許」「遠端 verifier 是否仍認可這個 workload generation」拆成不同證據。

---

## 本小時最重要 5 個發現

### 1. Linux IMA 的 exec measurement/appraisal hook 正好位在上一輪缺失的 exec boundary【已確認／Linux 原始碼】
Linux `security/integrity/ima/ima_main.c` 明確實作 `ima_bprm_check`、`ima_file_mmap`、`ima_file_check`。`ima_bprm_check()` 對 `bprm->file` 呼叫 `process_measurement(... MAY_EXEC, BPRM_CHECK ...)`；current source 同時說明 kernel 對正在執行檔案的 write/execute互斥，使 IMA 在該 hook 驗證/量測的內容就是將被執行的內容。

因此上一輪的：

`ProcessGenerationWitness → ? → ExecutableGenerationWitness`

可以開始補成：

`ProcessGenerationWitness → ExecTransition → IMA BPRM_CHECK → ExecutedFileMeasurement → ExecutableGenerationWitness`

但 IMA 是否真的 measure/appraise 取決於 policy，因此：

`IMAEnabled --does_not_prove→ ThisExecWasMeasured`

來源：Linux kernel `security/integrity/ima/ima_main.c`。

### 2. fs-verity 提供穩定的 content-addressed executable identity，但它只保護檔案內容【已確認／官方 Linux 文件】
fs-verity 對 read-only file 建 Merkle tree，讀取時自動驗證資料；`FS_IOC_MEASURE_VERITY` 可取得由 Merkle root、file size等 descriptor資料共同導出的 file digest。Linux文件明確把 executable列為主要 use case之一。

這非常適合 Hermes 建立：

`ExecutableArtifactIdentity = fsVerityDigest`

因為 identity 不再依賴 pathname、inode名稱或 mutable image tag。

若開啟 built-in signature verification，kernel還能驗證 fs-verity digest的簽章；IMA appraisal也可以使用 fs-verity digest。

但 fs-verity不涵蓋 owner/mode/timestamp/xattr等 metadata，也不證明 process runtime memory沒有被其他方式影響。因此：

`fsVerityDigestValid --does_not_prove→ WholeProcessRuntimeTrusted`

來源：https://docs.kernel.org/filesystems/fsverity.html

### 3. IMA measurement 與 appraisal 必須分開：measure 是 evidence，appraise 才可能 block execution【已確認／Linux 原始碼 + Keylime】
IMA architecture同時有 measurement 與 appraisal。measurement把 executable/file hash加入 measurement list，TPM存在時可把 aggregate延伸到 PCR；appraisal則依 policy / signature / xattr決定是否允許操作。

Linux current `ima_main.c` 會先由 `ima_get_action()`依 policy取得 `IMA_MEASURE / IMA_APPRAISE / IMA_AUDIT` action；`ima_appraise.c`則實作 appraisal邏輯並包含 fs-verity整合。

Keylime runtime IMA指南的典型 policy：

`measure func=BPRM_CHECK`
`measure func=FILE_MMAP mask=MAY_EXEC`

說明 executable與 executable mmap都可進 measurement chain。

所以 Hermes Knowledge Graph 必須區分：

`ExecutableMeasurementWitness`
`ExecutableAppraisalWitness`

不能把「log 裡看到了 hash」誤當「kernel 曾阻止不可信 code」。

### 4. TPM PCR + IMA measurement list能把 runtime measurement帶到遠端 verifier，但 correctness依賴 policy coverage【已確認／經典論文 + Keylime】
Sailer、Zhang、Jaeger、van Doorn 2004 的 IMA工作將 executable content在 execution前量測，measurement保存在 ordered list，aggregate延伸到 TPM；remote challenger取得 measurement list與 TPM-signed aggregate後驗證完整性/新鮮度。

Keylime把這條路徑工程化成 runtime integrity monitoring：IMA measurement list + TPM quote + verifier policy。

因此 Hermes 可以建立：

`Exec → IMA Measurement → PCR Extend → TPM Quote → Remote Verifier → RuntimeIntegrityDecision`

但 2025 DSN 對 Keylime continuous integrity attestation 的實驗指出，實務上存在 false positive與 false negative風險，尤其 policy/update處理會影響偵測品質。

所以：

`TPMQuoteValid --does_not_prove→ RuntimeIntegrityPolicyComplete`

這是本輪最重要的反過度推論規則之一。

### 5. exec authorization不能只在 socket connect時做；Signer Broker需要 consumption-time executable witness【工程建模，建立於上述已確認機制】
上一輪已確認 `execve()` 可以在 PID不變時替換 executable。因此 signer broker若只在 UDS connect時記錄 PID/starttime，即使 pidfd仍 alive，也可能已是新 executable。

本輪提出：

`ExecutableGenerationWitness = H(processGeneration, execSequence, executableDigest, appraisalPolicyGeneration, measurementEpoch)`

其中 `execSequence` / witness envelope是 Hermes工程模型，不是 Linux現有標準欄位。

高風險 sign前要求：

`ProcessGenerationAlive ∧ ExecutableDigestExpected ∧ AppraisalSatisfied ∧ RuntimeAttestationFresh ∧ SemanticDigestMatch`

若 remote verifier後續發現 measurement違規，必須讓：

`RuntimeIntegrityFailure → revoke SignerUseAuthorizationGeneration`

而不是只在 dashboard顯示紅燈。

---

## Architecture Breakdown

### Executable-Generation-Bound Proof-Key Runtime

```text
User / Agent Planner
  ↓
SemanticCommit
  ↓
Local sign request
  ↓
UDS + kernel peer credential
  ↓
pidfd / procfd + starttime
  ↓
ProcessGenerationWitness
  ↓
exec transition
  ↓
Linux BPRM_CHECK
  ↓
IMA policy decision
  ├─ MEASURE
  │   ↓
  │ file/fs-verity digest
  │   ↓
  │ IMA measurement list
  │   ↓
  │ TPM PCR extend
  │   ↓
  │ TPM quote + measurement log
  │   ↓
  │ Keylime / remote verifier
  │
  └─ APPRAISE
      ↓
      signature / digest / policy
      ↓
      allow or deny execution

Remote RuntimeIntegrityDecision
  ↓
ExecutableGenerationWitness
  ↓
SignerUseAuthorization
  ↓
Non-exportable signer
  ↓
DPoP → MCP → tool → effect → receipt
```

### Trust decomposition

```text
Process identity        = pidfd + starttime + namespace
Executable identity     = content digest / fs-verity digest
Execution authorization = IMA appraisal policy result
Runtime evidence        = IMA measurement log + PCR quote
Remote trust decision   = verifier + reference values/policy
Signer permission       = semantic commit + fresh executable/runtime witness
```

任何一層不能替代另一層。

---

## Bottom-Level Logic

### A. exec hook
`execve()`建立 `linux_binprm`，IMA的 BPRM hook可在 executable execution path對 `bprm->file`做 measurement/appraisal。因此 executable generation的證據應從 kernel exec path取得，而不是從 `/proc/PID/exe` pathname事後猜測。

### B. content measurement
IMA依 policy對 file計算 hash / 使用可用的 integrity metadata。measurement event進 ordered measurement list；TPM存在時 aggregate可延伸至 PCR（常見為 PCR 10）。

### C. fs-verity
檔案被切成 blocks → hash leaf blocks → 逐層 hash形成 Merkle tree → root與 descriptor資料形成 fs-verity digest。read path會驗證資料對應 Merkle tree；內容被破壞時 read/mmap會失敗。

### D. appraisal
measurement回答「執行了什麼」；appraisal回答「這份東西是否符合本機允許政策」。Hermes若需要阻止 unauthorized exec，必須要求 appraisal/enforcement，而不是只有 measurement。

### E. remote attestation
IMA log是事件序列；PCR是順序敏感的 aggregate。Verifier需要驗 TPM quote、重放/驗證 measurement chain，再把 individual digest對 reference values / policy做 appraisal。

### F. consumption-time binding
即使 100ms前 executable witness有效，sign前仍應檢查 witness freshness與 authorization generation；若 exec transition或 remote verifier revocation發生，舊 signer authorization立即失效。

---

## Visual Simulation Idea

### Exec → IMA → TPM → Signer Authorization Microscope

泳道：

`Agent Process | execve | Linux BPRM | IMA Policy | fs-verity | TPM PCR | Measurement Log | Keylime Verifier | Signer Broker | HSM`

互動 fault injection：
- `EXEC_AFTER_SOCKET_AUTH`
- `IMA_POLICY_DOES_NOT_COVER_BPRM`
- `MEASURE_ONLY_NO_APPRAISAL`
- `EXECUTABLE_DIGEST_NOT_ALLOWLISTED`
- `FS_VERITY_DIGEST_MISMATCH`
- `VALID_FS_VERITY_WRONG_SIGNER`
- `TPM_QUOTE_VALID_MEASUREMENT_POLICY_INCOMPLETE`
- `IMA_LOG_EVENT_MISSING`
- `RUNTIME_VERIFIER_REVOKES_AFTER_SIGN_AUTH`
- `OLD_EXECUTABLE_WITNESS_REUSED`
- `MMAP_EXEC_LIBRARY_CHANGED`

UI evidence rail：

`Process Gen | Exec Event | IMA Coverage | Executable Digest | fs-verity | Appraisal | PCR | Quote Freshness | Verifier Decision | Signer Auth`

關鍵教學案例：

`pidfd ✓ | starttime ✓ | IMA measured ✓ | TPM quote ✓ | appraisal ? | executable allowlist ✗ → BLOCK SIGN`

這可以直觀看到「被量測」與「被允許」不是同一件事。

---

## Code / GitHub

### Linux kernel — 不只 README，本輪追到核心 implementation
Repository: `torvalds/linux`

值得看的目錄 / 檔案：
- `security/integrity/ima/ima_main.c` — `process_measurement()`、`ima_bprm_check()`、`ima_file_check()`、ToMToU / writer checks。
- `security/integrity/ima/ima_appraise.c` — appraisal、signature與 fs-verity相關判斷。
- `security/integrity/ima/ima_crypto.c` — file/template/boot aggregate hashing。
- `security/integrity/ima/ima_policy.c` — policy matching，決定 measure/appraise/audit coverage。
- `security/integrity/ima/ima_queue.c` — measurement queue / PCR extension path。
- `security/integrity/ima/ima_template*.c` — measurement event template encoding。
- `fs/verity/` — fs-verity Merkle tree / verification implementation。

本輪原始碼最關鍵訊號：`ima_main.c` 的 `ima_bprm_check()`直接對即將執行的 `bprm->file`進入 `process_measurement()`；同檔案也包含 measurement/appraisal policy action與 ToMToU處理。因此 IMA可以成為上一輪缺失的 exec-boundary evidence source。

### Keylime
Repository: `keylime/keylime`

下一輪值得追：
- verifier 的 IMA measurement-list processing
- runtime policy parser / allowlist/reference-state evaluation
- quote + measurement list reconciliation
- revocation / notification path

---

## Papers

### 1. Design and Implementation of a TCG-based Integrity Measurement Architecture
- Authors: Reiner Sailer, Xiaolan Zhang, Trent Jaeger, Leendert van Doorn
- Institution: IBM T. J. Watson Research Center
- Year: 2004
- Venue: USENIX Security Symposium
- Architecture: execution-time measurement → ordered measurement list → TPM aggregate → remote challenge/validation
- Contribution: 將 TCG trust measurement延伸到 Linux dynamic executable content / application layer。
- Limitation: load-time code measurement本身不能完整描述後續 runtime information flow / behavior。
- URL: https://research.ibm.com/publications/design-and-implementation-of-a-tcg-based-integrity-measurement-architecture

### 2. PRIMA: Policy-Reduced Integrity Measurement Architecture
- Authors: Trent Jaeger, Reiner Sailer, Umesh Shankar
- Institution: IBM / research collaborators
- Year: 2006
- Venue: SACMAT
- Architecture: IMA + SELinux policy / information-flow-aware integrity measurement
- Contribution: 指出單純量測 loaded code不足以表示 runtime integrity，將 measurement與 information-flow policy結合。
- Limitation: 仍依賴 policy/model coverage；對現代 container/agent semantic-effect authorization不是直接解法。
- URL: https://research.ibm.com/publications/prima-policy-reduced-integrity-measurement-architecture

### 3. Towards Continuous Integrity Attestation and Its Challenges in Practice: A Case Study of Keylime
- Authors: Margie Ruffin, Chenkai Wang, Gheorghe Almasi, Abdulhamid Adebayo, Hubertus Franke, Gang Wang
- Institution: IBM Research et al.
- Year: 2025
- Venue: DSN 2025
- Architecture: TPM + Linux IMA + Keylime continuous integrity attestation
- Contribution: 實驗分析 production continuous attestation false positives/false negatives，並提出 dynamic policy generation方向。
- Limitation: node/runtime integrity不等於 application semantic authorization；仍需與 Hermes signer/tool policy串接。
- URL: https://research.ibm.com/publications/towards-continuous-integrity-attestation-and-its-challenges-in-practice-a-case-study-of-keylime
- Code noted by authors: `mruffin/Dynamic-Policy-Generator`

---

## 與歷史研究比較
上一輪已建立：

`KernelPeerCredentialWitness → StableTaskHandle → ProcessGenerationWitness → WorkloadSelectorWitness → ExecutableGenerationWitness → SignerUseAuthorization`

但 `ExecutableGenerationWitness`仍只是名稱。

本輪第一次把它具體拆成：

`ExecTransition → IMAExecCoverage → ExecutableContentDigest → LocalAppraisal → MeasurementEvent → TPMPCRState → RemoteRuntimeIntegrityDecision → ExecutableGenerationWitness`

因此沒有重複 pidfd，而是補上 process identity與 code identity之間真正缺失的 measurement layer。

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `IMAExecPolicyGeneration`
- `IMAExecMeasurementWitness`
- `IMAExecAppraisalWitness`
- `ExecutableContentDigest`
- `FsVerityArtifactIdentity`
- `FsVeritySignatureWitness`
- `IMAMeasurementLogGeneration`
- `IMAPCRGeneration`
- `TPMRuntimeQuoteWitness`
- `RuntimeIntegrityVerifierGeneration`
- `RuntimeIntegrityDecision`
- `ExecutableReferenceValueSet`
- `ExecutableGenerationWitnessV2`
- `SignerRuntimeIntegrityRevocation`

### Edges
- `ExecTransitionGeneration -> triggers -> IMAExecPolicyGeneration`
- `IMAExecPolicyGeneration -> may_generate -> IMAExecMeasurementWitness`
- `IMAExecPolicyGeneration -> may_enforce -> IMAExecAppraisalWitness`
- `FsVerityArtifactIdentity -> content_addresses -> ExecutableContentDigest`
- `IMAExecMeasurementWitness -> extends -> IMAPCRGeneration`
- `IMAMeasurementLogGeneration -> corroborated_by -> TPMRuntimeQuoteWitness`
- `RuntimeIntegrityVerifierGeneration -> appraises -> IMAMeasurementLogGeneration`
- `RuntimeIntegrityDecision -> contributes_to -> ExecutableGenerationWitnessV2`
- `RuntimeIntegrityDecision(fail) -> revokes -> SignerUseAuthorizationGeneration`
- `ProcessGenerationWitness --does_not_prove-> ExecutableGenerationWitnessV2`
- `IMAExecMeasurementWitness --does_not_prove-> IMAExecAppraisalWitness`
- `TPMRuntimeQuoteWitness --does_not_prove-> RuntimeIntegrityPolicyComplete`
- `FsVerityArtifactIdentity --does_not_prove-> WholeProcessRuntimeTrusted`

---

## Unknown / Open Questions 1–3
1. 如何把 IMA measurement event精確綁到「目前這個 pidfd/process generation」，而不是只有 node-global measurement log中的 executable event？
2. `exec`後的 executable digest之外，動態 loader、shared libraries、JIT code、Python/Node interpreter + script/module應如何形成完整 `CodeClosureGeneration`？
3. Keylime verifier產生的 runtime trust failure如何以低延遲、可驗證方式撤銷 local signer authorization，而不是只產生日誌/告警？

---

## 下一輪研究
下一輪優先研究最淺的新節點：**`CodeClosureGeneration`**。

路徑：

`ELF executable → PT_INTERP dynamic loader → executable mmap → shared libraries → IMA FILE_MMAP/MMAP_CHECK → interpreter/script → JIT/runtime-generated code → container image digest → CodeClosureGeneration → signer authorization`

並追 Linux IMA `FILE_MMAP` / `MMAP_CHECK`、dynamic loader、memfd/JIT executable mappings與 Keylime runtime policy coverage，回答：

**即使主 executable hash完全正確，Hermes如何證明實際執行的整個 code closure（loader、shared libraries、plugins、scripts、JIT executable pages）仍屬於被批准的 Agent generation？**

---

## 本輪結束判定
- **缺哪一層：** process-specific code closure與 node-global IMA event之間的 attribution/binding layer。
- **哪個節點最淺：** `CodeClosureGeneration`（本輪發現後新增為下一輪核心缺口）。
- **哪個概念仍只是名詞：** `ExecutableGenerationWitnessV2` 的 portable signed envelope。
- **哪個系統最值得讀原始碼：** Linux `security/integrity/ima/`，尤其 `ima_policy.c`、`ima_queue.c`、`ima_template*.c`；其次 Keylime verifier IMA path。
- **哪篇論文需追引用：** 2025 DSN Keylime continuous attestation case study，尤其其五類 false-negative問題與後續修正。
- **哪個概念最適合視覺模擬：** `Exec → IMA → fs-verity → TPM PCR → Remote Verifier → Signer Authorization Microscope`。
- **哪個 Agent 架構最值得實作：** `Risk-aware Planner + pidfd-bound Signer Broker + IMA/fs-verity Executable Generation Gate + TPM/Keylime Runtime Verifier + Non-exportable DPoP Signer + MCP SemanticCommit/Fence/Receipt Runtime`。

最終鏈條現在補到：

`UI → Agent → Context → Reasoning → Planning → SemanticCommit → Process Generation → Exec Transition → IMA/fs-verity Code Identity → TPM/Remote Runtime Attestation → Signer Authorization → DPoP → MCP → Tool → External Effect → Receipt → Observation → Output`。
