# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 03:54（Asia/Taipei）

## 本小時新發現

本輪承接上一輪最淺節點 `AutotuneDecisionWitness`，不再重複 Triton IR → PTX → cubin，而是追進 current Triton `runtime/autotuner.py` 與 PyTorch Inductor `runtime/triton_heuristics.py`，把「kernel winner 為什麼是這一個」拆成可驗證 decision chain：

`Graph/Schedule → Candidate Generation → Candidate Pruning → Compile → Benchmark Input → Measurement Environment → Timing Distribution → Winner Selection → Winner Cache → Launch`

核心新結論：

`Approved Candidate Set --does_not_prove→ Approved Winner`

以及：

`FastestObservedCandidate --does_not_prove→ ReproduciblyBestCandidate`

因為 winner 不只由 kernel bytes 決定，也由 pruning policy、benchmark implementation、輸入 shape/dtype/stride、GPU/device state、driver/compiler generation、cache state、warmup/repetition、measurement noise 與 cached timing artifact共同決定。

### 新架構
`AutotuneDecisionProvenanceGraph`

### 新 GitHub / 原始碼
- `triton-lang/triton/python/triton/runtime/autotuner.py`
- `pytorch/pytorch/torch/_inductor/runtime/triton_heuristics.py`
- `pytorch/benchmark`（measurement noise / machine configuration背景）

### 與歷史研究差異
上一輪已證明 compiler transformation 必須逐階段追 `FX → Triton → TTIR → TTGIR → LLVM → PTX → cubin`。本輪補的是 transformation 之前/旁邊的 **selection provenance**：為什麼這個 config 被納入、被 benchmark、勝出並被 cache，而不是另一個合法 config。

---

## 本小時最重要 5 個發現

### 1. Triton autotune key 決定何時重新選 kernel，且 dtype 也是 current key 的一部分
**已確認事實 / current Triton source。** `Autotuner.run()` 從指定 key arguments建立 tuning key，並把具有 `dtype` 的 arguments dtype加入 key；key miss後才 prune/benchmark，key hit則直接重用 winner。

底層：
`Runtime Args → Selected Key Fields + DTypes → TuningKey → Memory/Disk Cache Lookup → Hit: reuse winner | Miss: tune`

因此：
`Same Kernel Source --does_not_prove→ Same AutotuneGeneration`

Hermes新增：
`AutotuneInputIdentity = H(kernel, key fields, dtype set, shape/stride policy, device identity)`

限制：current Triton key不等於完整 measurement environment identity；Hermes仍需額外保存 GPU/driver/clock/cache/noise資訊。

來源：
https://github.com/triton-lang/triton/blob/main/python/triton/runtime/autotuner.py

### 2. Candidate set 不是固定集合：early prune + performance model + top-k 會先改變真正被 benchmark 的集合
**已確認事實 / current Triton source。** `prune_configs()` 可以先執行 `early_config_prune`，再由 `perf_model`估計時間，最後只保留 top-k configs。

底層：
`DeclaredConfigs → EarlyPrune → PerfModelScore → TopK → BenchmarkedCandidateSet`

因此：
`DeclaredCandidateSet --does_not_prove→ BenchmarkedCandidateSet`

Hermes新增：
`KernelCandidateSetIdentity`
`CandidatePruningPolicyIdentity`
`BenchmarkedCandidateSetIdentity`

重要性：若 perf model、top-k 或 pruning code改變，即使 Triton source完全相同，winner search space也已不同。

### 3. Winner 是 measurement 的函數，不是 compiler 的純函數
**已確認事實 / current Triton + PyTorch source。** Triton `_bench()` 執行實際 kernel call，預設 benchmarker量測候選 config，回傳 quantiles；PyTorch `CachingAutotuner.benchmark_all_configs()`則逐 launcher呼叫 `bench()`，保存 timing，最後 `min(timing)`選 winner。

底層：
`Candidate → Compile/Launcher → Real GPU Runs → Timing Samples/Statistic → timings[candidate] → argmin → Winner`

因此：
`CompilerInputsSame --does_not_prove→ AutotuneWinnerSame`

Hermes新增：
`AutotuneMeasurementGeneration`
`CandidateTimingWitness`
`WinnerSelectionWitness`

PyTorch TorchBench也明確提醒 interrupts、context switches、clock frequency scaling等會造成 benchmark variability，因此 measurement environment必須成為 provenance node，而不能只存「winner = config X」。

來源：
https://github.com/pytorch/pytorch/blob/main/torch/_inductor/runtime/triton_heuristics.py
https://github.com/pytorch/benchmark

### 4. Autotune cache 是 decision replay shortcut，cache hit 不會重新證明當下 winner
**已確認事實 / current Triton + PyTorch source。** Triton disk cache key包含 Triton key、backend target hash、function cache key、cache-invalidating env vars、tuning key與 configs，並保存 configs timings；cache hit後直接從 cached timings取 `min()`。PyTorch `CachingAutotuner`也可 lookup cached config，並在 static autotuner cache load後 recheck autotune cache。

因此：
`AutotuneCacheHit --does_not_prove→ WinnerWouldStillWinNow`

這不是 cache bug，而是 cache的本質：它重播先前 decision。

Hermes新增：
`AutotuneCacheArtifactIdentity`
`AutotuneCacheOriginWitness`
`MeasurementFreshnessPolicy`

高風險模式應區分：
- `REPLAY_APPROVED_WINNER`：允許已 attested winner/cache在同一環境 generation重用。
- `RETUNE_REQUIRED`：driver/GPU/compiler/power policy/shape class等越界時強制重測。

### 5. PyTorch Inductor 已經有可利用的 winner/cache hooks，Hermes 不必從零發明 observation surface
**已確認事實 / current PyTorch source。** `CachingAutotuner`保存 device properties、size hints、compile results、launchers、benchmark failure reasons、autotune timing；`benchmark_all_configs()`記錄每個 launcher timing；`autotune_to_one_config()`以最小 timing選 winner、釋放 loser、保存 winner cache hash，並透過 `save_cache_hook`保存 config、autotune time、coordinate-descent來源與 Triton cache hash。

這提供很好的 Hermes instrumentation point：

`BeforeTune → CandidateSetDigest`
`PerCandidate → Cubin/LauncherDigest + TimingWitness`
`AfterTune → WinnerConfig + WinnerCacheHash + EnvironmentWitness`

因此可以建立：

`AutotuneDecisionWitness = H(inputIdentity, candidateSetDigest, pruningPolicy, measurementEnv, timingWitnesses, selectionRule, winnerArtifact, cacheOrigin, generation)`

這是 Hermes architecture proposal，不是 PyTorch既有 attestation格式。

---

## Architecture Breakdown

### Autotune-Provenance-Aware GPU Runtime

`FX Graph Identity`
→ `Inductor Schedule/Fusion Generation`
→ `Kernel Template / Triton Source`
→ `Declared Candidate Set`
→ `Pruning Policy`
→ `Benchmarked Candidate Set`
→ `Compile each candidate`
→ `Candidate Cubin / Launcher Identity`
→ `Benchmark Inputs`
→ `Measurement Environment`
→ `Timing Witnesses`
→ `Selection Rule (argmin / coordinate descent / cached winner)`
→ `Winner Config`
→ `Winner Cubin/Cache Hash`
→ `GPU Launch`
→ `GPUCodeClosureGeneration`

Hermes proposal：

`AutotuneDecisionProvenanceGraph` 必須至少有四類 edge：

1. **Generation edge**：graph/scheduler → candidates。
2. **Filter edge**：candidate → pruned/retained。
3. **Measurement edge**：candidate → timing distribution。
4. **Decision edge**：timings + policy → winner。

如此才能回答：

「這個 kernel為什麼跑？」

而不只是：

「這個 kernel hash是什麼？」

---

## Bottom-Level Logic

### Triton generic autotuner

`args`
→ extract configured key fields
→ append dtype identities
→ tuning key
→ in-memory cache lookup
→ prune configs
→ optional early prune
→ optional perf-model ranking
→ top-k
→ `_bench(candidate)`
→ pre-hook/reset/restore
→ kernel run
→ benchmarker returns timing quantiles
→ timing map
→ `min(timings)`
→ winner
→ optional disk cache / listener
→ winner kernel run

### PyTorch Inductor CachingAutotuner

`Inductor-generated kernel + size hints + device props`
→ cached config lookup
→ compile configs
→ launchers
→ benchmark every launcher
→ record timing + failures + resource properties
→ `min(timings)`
→ close losing static launchers
→ prune compile results to winner
→ `TritonBundler.put_winner(cache_hash)`
→ `save_cache_hook(config, autotune_time, coordesc, triton_cache_hash)`
→ steady-state launch

### 新的底層區分

`Kernel Correctness Provenance`
≠ `Kernel Compilation Provenance`
≠ `Kernel Selection Provenance`
≠ `Kernel Measurement Provenance`
≠ `Kernel Execution Provenance`

這五層不能再合成一個 `GPU kernel ✓`。

---

## Visual Simulation Idea

### Autotune Decision & Measurement Microscope

互動 UI：

`FX/Schedule | Candidate Generator | Pruner | Compiler | Candidate Kernels | Benchmark Lab | Timing Distribution | Winner | Cache | GPU Launch`

每個 candidate顯示：
- config (`BLOCK_*`, num_warps, num_stages, num_ctas, maxnreg)
- source/IR/cubin digest
- compile generation
- benchmark input identity
- median / low / high timing
- failure reason
- retained/pruned原因
- winner/loser
- cache origin

Measurement Environment panel：
- GPU UUID/model/SM capability
- driver/runtime generation
- power/clock policy
- thermal state class
- active workload/noise class
- stream / benchmark implementation
- warmup/repetition/quantile policy
- cache state policy

可注入：
- `PERF_MODEL_CHANGED`
- `TOP_K_CHANGED`
- `EARLY_PRUNE_CHANGED`
- `BENCHMARK_INPUT_SHAPE_CHANGED`
- `GPU_CLOCK_POLICY_CHANGED`
- `BACKGROUND_GPU_LOAD_ADDED`
- `BENCHMARKER_CHANGED`
- `TIMING_NOISE_FLIPS_WINNER`
- `AUTOTUNE_CACHE_IMPORTED`
- `CACHED_WINNER_FROM_OLD_DRIVER`
- `COORDINATE_DESCENT_FINDS_NEW_CONFIG`
- `CANDIDATE_FAILS_REGISTER_SPILLING`

高風險狀態：

`Candidate provenance ✓ | Pruning policy ✓ | Measurement env ? | Winner cache old-generation ✗`
→ `AUTOTUNE PROVENANCE INCOMPLETE → RETUNE OR BLOCK HIGH-RISK MODEL AUTHORIZATION`

---

## Code / GitHub

### triton-lang/triton
核心檔案：
- `python/triton/runtime/autotuner.py`
  - tuning key
  - prune_configs
  - perf model/top-k
  - `_bench`
  - disk timing cache
  - winner listener
  - Config (`num_warps`, `num_stages`, `num_ctas`, `maxnreg`, `ir_override`)

特別值得注意：current autotuner listener已能收到 `fn/key/best_config/configs_timings/duration/cache_hit`，很適合先做 Hermes research instrumentation prototype。

### pytorch/pytorch
核心檔案：
- `torch/_inductor/runtime/triton_heuristics.py`
  - `CachingAutotuner`
  - `benchmark_all_configs`
  - `autotune_to_one_config`
  - autotune cache recheck
  - compile metadata/options
  - coordinate descent / dynamic tuning paths

Current implementation已暴露大量 witness原料：device props、size hints、compile result、launcher config、timing、failure reason、cache hash、autotune duration。

### pytorch/benchmark
值得作為 measurement reproducibility背景資料。其文件明確說明 interrupts、context switches、clock frequency scaling等都可能造成 benchmark variance，並提供 machine tuning/logging思路。

---

## Papers / 技術資料

本輪重點是 production autotuner implementation，因此主要證據使用 current source + 官方 benchmark工程資料，而不是新聞。

1. **Triton: An Intermediate Language and Compiler for Tiled Neural Network Computations** — Philippe Tillet, H. T. Kung, David Cox；Harvard / OpenAI lineage；2019；MAPL。Architecture：tile-level DSL/compiler。Contribution：以 blocked/tiled abstraction生成高效 GPU kernels。Limitations：原始論文不等於 current Triton autotune/runtime implementation。Code：https://github.com/triton-lang/triton
2. **Triton current Autotuner implementation** — 2026 current source。Contribution：直接揭露 candidate pruning、measurement、cache、winner selection production semantics。URL：https://github.com/triton-lang/triton/blob/main/python/triton/runtime/autotuner.py
3. **PyTorch Inductor CachingAutotuner** — 2026 current source。Contribution：揭露 Inductor實際 compile/launcher/benchmark/winner/cache path。URL：https://github.com/pytorch/pytorch/blob/main/torch/_inductor/runtime/triton_heuristics.py
4. **TorchBench** — PyTorch benchmark suite。Contribution：提供真實 model benchmark與 low-noise machine engineering context。URL：https://github.com/pytorch/benchmark

本輪沒有找到一篇單一論文可以完整覆蓋 current `Inductor → Triton autotune → cache → winner` production chain；因此把「論文原理」與「current工程實作」明確分開。

---

## Unknown / Open Questions 1-3

1. **Measurement Environment Attestation**：如何低成本量測 GPU clock/power/thermal/background-load/stream/cache state，使 winner可跨機器重播驗證，而不是記錄過度龐大的 telemetry？
2. **Near-tie Stability**：兩個 candidate只差 measurement noise範圍時，是否應把 winner表示成 `equivalence class / confidence interval`，而不是假裝 argmin是絕對真理？
3. **Autotune Cache Trust**：如何把 cached timing/winner與原始 candidate binaries、measurement environment、driver/compiler generation做 cryptographic binding，避免合法 cache key下的 stale/poisoned decision？

---

## 下一輪研究

鎖定：

`Autotune Winner → CUDA stream → kernel launch parameters → tensor memory/storage → actual attention/matmul operator semantics`

優先研究：
- CUDA launch API / CUPTI activity & callback
- PyTorch Tensor storage / allocator / stream semantics
- Triton launcher grid/block/shared-memory metadata
- kernel inputs/outputs如何與 model operator identity綁定

目標新增：
- `GPUKernelInvocationWitness`
- `TensorStorageIdentity`
- `KernelArgumentBindingWitness`
- `OperatorToKernelSemanticEdge`

核心問題：**即使 winner selection與 cubin provenance都完全可信，Hermes如何證明這次 GPU launch實際吃到的 tensor pointers、shape/stride/dtype、stream與launch dimensions，確實對應到原本被批准的 attention/matmul/model operator，而不是「合法 kernel + 錯誤/被替換的資料綁定」？**

---

## Knowledge Graph 新增 Node / Edge

### Nodes
- `AutotuneInputIdentity`
- `KernelCandidateSetIdentity`
- `CandidatePruningPolicyIdentity`
- `BenchmarkedCandidateSetIdentity`
- `AutotuneMeasurementGeneration`
- `MeasurementEnvironmentIdentity`
- `CandidateTimingWitness`
- `WinnerSelectionWitness`
- `AutotuneDecisionWitness`
- `AutotuneDecisionProvenanceGraph`
- `AutotuneCacheArtifactIdentity`
- `AutotuneCacheOriginWitness`
- `MeasurementFreshnessPolicy`
- `NearTieStabilityWitness`

### Edges
- `InductorFusionGeneration --generates→ KernelCandidateSetIdentity`
- `CandidatePruningPolicyIdentity --filters→ KernelCandidateSetIdentity`
- `KernelCandidateSetIdentity --reduces_to→ BenchmarkedCandidateSetIdentity`
- `BenchmarkedCandidateSetIdentity --compiled_as→ CubinCompilerArtifactIdentity`
- `MeasurementEnvironmentIdentity --conditions→ CandidateTimingWitness`
- `CubinCompilerArtifactIdentity --measured_by→ CandidateTimingWitness`
- `CandidateTimingWitness --ranked_by→ WinnerSelectionWitness`
- `WinnerSelectionWitness --selects→ CubinCompilerArtifactIdentity`
- `AutotuneCacheOriginWitness --replays→ WinnerSelectionWitness`
- `WinnerSelectionWitness --authorizes→ GPUKernelLaunchWitness`

---

## 本輪結束判斷

- **缺哪一層：** winner kernel → launch arguments/tensor storage/operator semantics 的 binding。
- **哪個節點最淺：** `MeasurementEnvironmentIdentity`，尤其 GPU dynamic state與 noise的可驗證摘要。
- **哪個概念仍只是名詞：** portable signed `AutotuneDecisionWitness`；本輪已定義欄位，但尚無跨 Triton/Inductor標準格式。
- **哪個系統值得讀原始碼：** CUDA/CUPTI launch tracing + PyTorch allocator/stream + Triton launcher。
- **哪篇論文需追引用：** Triton MAPL 2019 的後續 compiler/autotuning工作，以及 GPU benchmark reproducibility / noise-aware autotuning研究。
- **哪個概念最適合視覺模擬：** Autotune Decision & Measurement Microscope。
- **哪個 Agent 架構最值得實作：** `Risk-aware Agent Runtime + Graph/Guard Witness + Compiler Transformation DAG + Autotune Decision Witness + GPU CodeClosure + Runtime Attestation + Non-exportable Signer + MCP SemanticCommit/Receipt`。

目前完整鏈更新為：

`使用者 → UI → Agent → Context → Reasoning → Planning → Model → Dynamo/FX → Inductor Schedule/Fusion → Candidate Set → Pruning → Autotune Measurement → Winner → Triton/IR Pipeline → PTX → ptxas → Cubin → CUDA Launch → GPU → Tensor → Output`

多模態：

`Camera/Image/Voice/Video → Encoder/Input Tensor → Graph Capture → Candidate Kernels → Autotune Winner → Compiler Transformation DAG → GPU Kernel → Fusion/Attention/Decoder → Agent Reasoning → Action`

本輪最核心答案是：**AI runtime選擇 GPU kernel不是純粹的編譯結果，而是一個受 candidate generation、pruning、真實硬體量測、noise與 cache共同影響的 runtime decision。若要回答「AI到底怎麼運作」，Hermes除了追 machine code來源，也必須能解釋「為什麼這次選的是這份 machine code」。**