# 【AI Agent × Multimodal Research Report】

時間：2026-09-22 00:53（Asia/Taipei）

主題：TCGen05 MMA Issue Observability × Instrumentation Gap × Commit-Frontier Reconstruction Contract

## 本小時新發現

本輪延續上一輪 `TCGen05 Commit Frontier × MMA Lineage Reconstruction`，但不再重複 commit/barrier 語義；本輪專門驗證上一輪鎖定的最淺節點：**能否在 current NVIDIA 官方 instrumentation surface 直接取得 `tcgen05.mma` runtime issue event？**

結論：截至本輪查驗的 current Compute Sanitizer Patching API，官方公開 instruction IDs 已包含 `SANITIZER_INSTRUCTION_TENSOR_CORE_BARRIER`（對應 `tcgen05.commit` completion/barrier event）、TMA load/store、memory access、barrier、pipeline、warpgroup MMA async release 等，但公開列表中沒有一個明確標示為 Blackwell `tcgen05.mma issue` 的直接 patch point。因此 `MMAIssueEvent` 不能假定可由 Compute Sanitizer 原生 callback直接取得；必須建立「官方 callback / binary instrumentation / static reconstruction」三層 observability contract。

同時，CUTLASS CuTe DSL 官方文件確認：`cute.gemm(...)` 對應 `tcgen05.mma`，是 asynchronous；CTA_GROUP::1 是 single-thread issue，CTA_GROUP::2 是 CTA pair中的 single-thread issue。使用者 source 必須以 warp-uniform方式呼叫，且**不要**自行包 `elect_one()`，因為 compiler會處理 MMA issue election；相反地，`tcgen05.commit` 必須由使用者明確 `elect_one()`。這證明 source-level `cute.gemm` 與 generated dynamic issuer identity之間存在 compiler-lowering boundary。

本輪新增 system architecture：`CuTeDSL source → compiler issue election → PTX tcgen05.mma → SASS/runtime → tcgen05.commit callback` 的可觀測性分層架構。

本輪新增 bottom-level mechanism：`MMA Issue Evidence Ladder` —— 將 exact MMA lineage分為 static compiled evidence、binary issue evidence、commit frontier evidence與causal output evidence，而不再把任何單一 callback當成完整 proof。

## 本小時最重要 5 個發現

### 1. Compute Sanitizer current Patching API沒有明確的 tcgen05.mma issue patch point

**已確認事實 / NVIDIA 官方 API**：Patching API列出的 instrumentation IDs包含 global/shared/local memory、barrier、pipeline commit/wait、TMA load/store、`SANITIZER_INSTRUCTION_TENSOR_CORE_BARRIER` 等；Tensor Core barrier callback明確說明可由 `tcgen05.commit` 產生，提供 `pc + barrier + isMulticast + multicastMask`。

本輪在公開 instruction ID列表中未找到明確名為 tcgen05 MMA issue / Blackwell tensor-core MMA issue 的 callback。因此：

`TensorCoreBarrierCallbackAvailability --does_not_imply→ Tcgen05MMAIssueCallbackAvailability`

來源：
- https://docs.nvidia.com/compute-sanitizer/api/group___s_a_n_i_t_i_z_e_r___p_a_t_c_h_i_n_g___a_p_i.html
- https://docs.nvidia.com/compute-sanitizer/SanitizerApiGuide/index.html

限制：這是對 current公開API surface的確認，不等於硬體/內部工具不存在其他觀測方法。

### 2. CuTe source-level warp-uniform gemm不等於 dynamic issuer identity

**已確認事實 / CUTLASS官方文件**：`cute.gemm(...)` 對應 PTX `tcgen05.mma` 且為 asynchronous。CTA_GROUP::1 issue granularity為single-thread；CTA_GROUP::2為CTA pair中的single-thread。source端應 warp-uniform呼叫，compiler負責 election insertion。

因此：

`SourceCuteGemmCallsite → CompilerIssueElection → GeneratedTcgen05MMA → DynamicIssuer`

而不能寫成：

`SourceCuteGemmCallerThread == RuntimeMMAIssuerThread`

來源：https://docs.nvidia.com/cutlass/latest/media/docs/pythonDSL/cute_dsl_api/cute_nvgpu_tcgen05.html

### 3. commit與MMA的 election ownership是非對稱的

**已確認事實 / CUTLASS官方文件**：MMA source call不應手動 `elect_one()`；`tcgen05.commit` 則要求 single-thread execution，必須顯式包在 `cute.arch.elect_one()`，否則一個warp可能產生32個 redundant commit。

所以同一個source warp內：

`MMAIssueOwnershipPolicy != CommitIssueOwnershipPolicy`

這對 runtime provenance很重要：不能從 commit callback active warp的共同參數反推出「同一lane就是前面所有MMA的issuer」。

新增否定 edge：

`CommitSignalerLane --does_not_prove→ MMAIssuerLane`

### 4. Exact MMA set應由 evidence ladder重建，而不是尋找單一萬能 callback

本輪建立：

`StaticMMASequenceWitness → CompiledMMAIssuePCSet → RuntimeBinaryMMAIssueWitness → NextCompatibleCommitFrontier → CommitTrackedOperationSet → StageReleaseWitness → CausalOutputWitness`

證據強度：

1. source/CuTe callsite：知道logical MMA loop。
2. PTX/SASS：知道compiler實際產生哪些MMA instructions與PC。
3. binary instrumentation：若平台可對Blackwell SASS做安全instrumentation，可取得dynamic issue sequence。
4. Compute Sanitizer TensorCoreBarrier：取得commit frontier PC/barrier/mask。
5. causal probe：驗證該stage/MMA result是否影響attention/output。

新增 node：`MMAIssueEvidenceLevel`。

### 5. Blackwell binary instrumentation已有外部實證，但production suitability仍未證實

**工程/研究線索，非NVIDIA官方保證**：2026年的 SASS-Bench artifact宣稱其 Blackwell `sm_120` ground truth透過 NVBit dynamic binary instrumentation擷取，資料涵蓋TMA address swizzles、multi-CTA protocols與inference-style microkernels。這是「Blackwell SASS dynamic instrumentation可能可行」的重要新證據，但該artifact為匿名NeurIPS 2026 submission，且不等同已證實B200/sm_100上的 `tcgen05.mma` production tracing。

來源：https://github.com/anon-neurips-2026-ed-3552/SASS-Bench

交叉背景：NVBit原始工作提供SASS-level dynamic binary instrumentation，可對precompiled kernels插入device callbacks：
https://research.nvidia.com/publication/2019-10_nvbit-dynamic-binary-instrumentation-framework-nvidia-gpus

因此新增：

`BlackwellBinaryInstrumentationFeasibility = PARTIALLY_EVIDENCED`

而不是 `CONFIRMED_FOR_TCGEN05_PRODUCTION_TRACE`。

## Architecture Breakdown

### System architecture：MMA Issue Observability Stack

```text
CuTe DSL cute.gemm
  ↓
Compiler issue-election lowering
  ↓
PTX tcgen05.mma
  ↓
SASS instruction / PC
  ↓
[Gap A] dynamic MMA issue observation
  ↓
DynamicIssuerLineage
  ↓
MMAIssueEvent stream
  ↓
NextCompatibleCommitFrontier
  ↓
Compute Sanitizer TensorCoreBarrier callback
  ↓
Barrier / multicast mask / commit PC
  ↓
StageReleaseWitness
  ↓
Attention / residual / logits
```

Observability adapters：

```text
OfficialAdapter
  = Compute Sanitizer callbacks

BinaryAdapter
  = NVBit-like SASS instrumentation（capability-gated）

StaticAdapter
  = CuTe source + generated PTX/SASS disassembly

CausalAdapter
  = controlled input/KV/TMEM perturbation + output delta
```

Hermes必須保存 `EvidenceOrigin`，避免把static reconstruction標成runtime observation。

## Bottom-Level Logic

### MMA lineage reconstruction

對每次kernel launch建立：

```text
LaunchScope = request_id
            + forward_epoch
            + layer_id
            + kernel_launch_identity
            + graph_execution_identity
```

對compiled binary建立：

```text
CompiledMMA = {
  pc,
  cta_group,
  mma_kind,
  operand_shape,
  source_callsite_if_known
}
```

若binary instrumentation可用：

```text
RuntimeMMAIssue = {
  launch_scope,
  pc,
  dynamic_sequence,
  cta/cluster context,
  issuer context,
  timestamp_or_order_token
}
```

commit callback：

```text
RuntimeCommit = {
  launch_scope,
  commit_pc,
  barrier_dsmem,
  is_multicast,
  multicast_mask,
  dynamic_order_token
}
```

candidate join：

```text
MMAIssueEvent
  --candidate_member_of→
NearestCompatibleCommitFrontier
```

compatibility至少需要：

```text
same launch
+ same CTA-group semantics
+ correct dynamic program order
+ no intervening incompatible frontier
+ compatible pipeline/barrier role
```

只有在runtime MMA issue witness存在時，才能升級成：

`MMASetScopedCompletionWitness(runtime)`。

若只有source + compiled PC + commit callback，應標成：

`MMASetScopedCompletionWitness(reconstructed)`。

## Visual Simulation Idea

### MMA Evidence Ladder & Frontier Joiner

Hermes Console新增五層時間軸：

```text
SOURCE       cute.gemm #0 #1 #2
COMPILED     MMA_PC_A  MMA_PC_A MMA_PC_B
RUNTIME      issue#17  issue#18 issue#19   ← 可缺失
FRONTIER                               COMMIT_PC_X
CAUSAL                                  StageRelease → ΔOutput
```

每一條edge顯示 evidence badge：

`STATIC / COMPILED / RUNTIME / OFFICIAL_CALLBACK / CAUSAL`

互動故障模式：
- `MMA_RUNTIME_TRACE_GAP`
- `SOURCE_TO_BINARY_ISSUER_AMBIGUITY`
- `COMMIT_SIGNALER_MMA_ISSUER_CONFLATION`
- `MMA_FRONTIER_RECONSTRUCTION_ONLY`
- `BINARY_INSTRUMENTATION_CAPABILITY_UNVERIFIED`
- `MMA_PC_SEQUENCE_MISMATCH`

## Code / GitHub

### NVIDIA Compute Sanitizer

值得看的API：
- `Sanitizer_InstructionId`
- `SANITIZER_INSTRUCTION_TENSOR_CORE_BARRIER`
- `SanitizerCallbackTensorCoreBarrier`
- `sanitizerPatchInstructions`
- `sanitizerPatchModule`
- `sanitizerSetCallbackData` / launch-scoped callback data

URL：https://docs.nvidia.com/compute-sanitizer/api/group___s_a_n_i_t_i_z_e_r___p_a_t_c_h_i_n_g___a_p_i.html

### CUTLASS CuTe DSL

值得看的區域：
- `nvgpu.tcgen05`
- `cute.gemm`
- `tcgen05.commit`
- CTA_GROUP::1 / CTA_GROUP::2 issue rules
- compiler-inserted MMA election vs explicit commit election

URL：https://github.com/NVIDIA/cutlass

### NVBit / SASS-Bench

- NVBit：https://github.com/NVlabs/NVBit
- SASS-Bench：https://github.com/anon-neurips-2026-ed-3552/SASS-Bench

本輪對 NVBit repo搜尋 `Blackwell SM100 tcgen05` / `SM_100` 未取得直接命中，因此不能宣稱 official/current NVBit release已明確文件化 B200 tcgen05 tracing；只把SASS-Bench sm_120 artifact視為外部可行性證據。

## Papers

### SASS-Bench（匿名 NeurIPS 2026 Evaluations & Datasets submission / artifact）

- Title：SASS-Bench（artifact名稱；paper位於repo）
- Authors：匿名投稿，本輪不可可靠列名
- Institution：匿名
- Year：2026
- URL：https://github.com/anon-neurips-2026-ed-3552/SASS-Bench
- Code：同repo
- Dataset：repo指向 Hugging Face SASS-Bench dataset
- Architecture：compiled NVIDIA SASS + launch configuration + raw inputs + checkpoint queries；Blackwell sm_120 ground truth宣稱以NVBit dynamic instrumentation取得
- Contribution：建立hardware-grounded SASS execution prediction benchmark
- Limitations：匿名submission；sm_120證據不能直接外推到B200 sm_100 tcgen05 production kernel；instrumentation perturbation也需另外驗證
- 改變了什麼：提供「Blackwell binary instrumentation並非純理論」的新證據，但仍不足以關閉 Hermes 的 `MMAIssueEvent` 缺口。

### NVBit: A Dynamic Binary Instrumentation Framework for NVIDIA GPUs

- Authors：Oreste Villa et al.（NVIDIA Research工作；完整作者以論文頁為準）
- Institution：NVIDIA Research
- Year：2019
- URL：https://research.nvidia.com/publication/2019-10_nvbit-dynamic-binary-instrumentation-framework-nvidia-gpus
- Architecture：dynamic recompilation + SASS-level instrumentation + injected CUDA/C/C++ callbacks
- Contribution：允許precompiled GPU binaries/libraries的dynamic binary instrumentation
- Limitations：原始論文早於Blackwell；不能直接證明current tcgen05 opcode support
- 改變了什麼：提供 Hermes BinaryAdapter 的方法論基礎。

## Unknown / Open Questions 1-3

1. current NVBit / CUTracer 是否能在 B200 sm_100 上可靠識別並instrument `tcgen05.mma`，而且不破壞其single-thread/CTA-pair issue semantics？
2. generated SASS中 `tcgen05.mma` 的 opcode/PC 是否能穩定映射回 CuTe `cute.gemm` callsite與 K-block iteration？需要 debug line info、disassembly mapping或compiler IR witness。
3. instrumentation callback本身是否會改變 async issue timing、barrier phase或pipeline overlap，使觀察到的execution不再等價於uninstrumented execution？需要 instrumentation perturbation contract。

## 下一輪研究

只追一條主線：

```text
CuTe cute.gemm
→ compile minimal sm_100/sm_120 kernel evidence
→ PTX tcgen05.mma PC map
→ SASS opcode map
→ NVBit/CUTracer current opcode recognition
→ instrumentation safety/perturbation
→ dynamic MMA issue schema
→ join TensorCoreBarrier callback
→ exact CommitTrackedOperationSet
→ StageReleaseWitness
```

若 direct binary instrumentation仍無法可靠證明，下一輪建立替代方案：`static compiled sequence + controlled commit insertion + causal stage probe`，並明確標示 evidence strength，不偽裝成hardware runtime trace。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `MMAIssueEvidenceLevel`
- `CompiledMMAIssuePCSet`
- `RuntimeBinaryMMAIssueWitness`
- `CompilerIssueElectionWitness`
- `MMAIssueOwnershipPolicy`
- `CommitIssueOwnershipPolicy`
- `InstrumentationCapabilityContract`
- `InstrumentationPerturbationContract`
- `BlackwellBinaryInstrumentationFeasibility`
- `ReconstructedMMASetScopedCompletionWitness`
- `RuntimeMMASetScopedCompletionWitness`

### Edges
- `SourceCuteGemmCallsite --lowered_by→ CompilerIssueElectionWitness`
- `CompilerIssueElectionWitness --emits→ CompiledMMAIssuePCSet`
- `CompiledMMAIssuePCSet --does_not_prove→ RuntimeBinaryMMAIssueWitness`
- `CommitSignalerLane --does_not_prove→ MMAIssuerLane`
- `TensorCoreBarrierCallbackAvailability --does_not_imply→ Tcgen05MMAIssueCallbackAvailability`
- `RuntimeBinaryMMAIssueWitness --candidate_member_of→ CommitTrackedOperationSet`
- `CommitTrackedOperationSet --completed_by→ Tcgen05CommitFrontier`
- `ReconstructedMMASetScopedCompletionWitness --weaker_than→ RuntimeMMASetScopedCompletionWitness`
- `BinaryInstrumentationEnabled --requires→ InstrumentationPerturbationContract`

## 本輪結束判斷

- **缺哪一層：** generated SASS `tcgen05.mma` → dynamic runtime issue event。
- **哪個節點最淺：** `RuntimeBinaryMMAIssueWitness`。
- **哪個概念仍只是名詞：** B200 production-grade `RuntimeMMASetScopedCompletionWitness`。
- **哪個系統值得讀原始碼：** NVBit/CUTracer opcode decoder與instrumentation insertion path；CUTLASS CuTeDSL tcgen05 lowering。
- **哪篇論文需追引用：** NVBit後續Blackwell instrumentation工作；SASS-Bench若正式發表，追其instrumentation methodology與artifact。
- **哪個概念最適合視覺模擬：** `MMA Evidence Ladder & Frontier Joiner`。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Static/Binary Evidence Router + Instrumentation Capability Verifier + MMA/Commit Frontier Reconstructor + Launch Attribution Joiner + Causal Evidence Gate + Tool Executor`。

## 與歷史研究相比，本輪真正新增的東西

上一輪已知道 `tcgen05.commit` 是一組prior async operations的frontier；本輪第一次把「為何 exact MMA set仍缺證據」具體定位到 instrumentation API surface：**官方 Compute Sanitizer目前能直接觀察 commit/barrier，但公開 instruction IDs沒有明確的 Blackwell tcgen05.mma issue callback。** 同時，CuTe DSL明確把 MMA election交給compiler、commit election交給source，因此 commit signaler與MMA issuer不可混為一談。Hermes下一步不應再增加抽象名詞，而應驗證 Blackwell SASS binary instrumentation能否補上這個唯一的 runtime gap。