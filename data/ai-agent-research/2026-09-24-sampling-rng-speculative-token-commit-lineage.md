# 【AI Agent × Multimodal Research Report】

時間：2026-09-24 19:52（Asia/Taipei）

主題：RawLogitsGeneration → Logits Processing → Sampling Policy → RNG Generation → Speculative Verification → CommittedTokenGeneration

## 與歷史研究比較
上一輪已推進到 RawLogitsWitness，並明確留下「Raw logits → sampling / RNG / speculative acceptance → committed token」缺口。本輪不重複 compiled kernel、allocator、CUDA Graph或 LM Head，而專注回答：即使 raw logits 完全可信，最後真正提交到 autoregressive history 的 token 是如何產生、哪些 runtime state 會改變它、speculative decoding 為何需要獨立的 token-commit provenance。

## 本小時新發現
1. vLLM current sampler 的 sampling pipeline 有明確順序：raw logits → float32 → allowed-token/bad-word/logit processors → penalties → greedy branch 或 temperature → argmax-invariant processors（預設 min-p）→ top-k/top-p → random sample。這證明 SamplingPolicyGeneration 必須描述完整 ordered transform DAG，而不能只保存 temperature/top-p 三個欄位。
2. vLLM native random sampling不是直接 torch.multinomial，而是對 probability tensor產生 exponential noise q，最後以 argmax(probs/q)取樣；per-request torch.Generator 會覆寫對應 request row 的 noise。RNG provenance因此至少要綁 generator identity/state、draw shape、backend與 consumption order。
3. vLLM current CUDA sampler在 per-request generators存在時會從 FlashInfer fallback到 native path；FlashInfer路徑官方原始碼註解只保證與 native sampler「statistically equivalent」，不保證同 seed / 同 logits 得到相同 token。SamplerBackendGeneration 因此是 token semantics的一部分。
4. speculative decoding的 final output不是 draft tokens本身，而是 accepted tokens + recovered tokens + bonus token；current vLLM RejectionSampler先對 target logits套 sampling constraints，再用 draft probabilities、target logits、bonus token與 sampling metadata進行 rejection sampling。CommittedToken必須標示 token origin與 acceptance lineage。
5. speculative sampling原始論文的核心保證是用 modified rejection sampling在 target model distribution不變的前提下加速；因此「draft model提出了 token」與「target distribution committed token」是兩個不同 generation。2026 vLLM Ascend還提供 Block Verify / Entropy Verify等可改 acceptance criterion的模式，並明確警告可能帶來 precision degradation，進一步證明 AcceptancePolicyGeneration不可省略。

## 本小時最重要 5 個發現

### 1. Raw logits不是 sampling distribution
已確認工程實作：vLLM Sampler會先將 logits轉 float32，再依序套 allowed-token mask、bad words、會改變 argmax的 logits processors、repetition/frequency/presence penalties；進入 sample()後才分 greedy/random，random path再套 temperature、argmax-invariant processors、top-k/top-p，最後才抽樣。

底層：
RawLogits → Float32Projection → HardMasks → NonArgmaxInvariantProcessors → Penalties → Temperature → MinP/OtherProcessors → TopK/TopP → Softmax/EquivalentSampler → TokenCandidate

因此：
RawLogitsCorrect --does_not_prove→ SamplingDistributionCorrect

新增 SamplingTransformGeneration 與 ProcessedDistributionWitness。

### 2. RNG identity必須包含 state/counter consumption，而不能只記 seed
PyTorch官方提供每GPU RNG state的 get/set API，也允許 torch.rand等操作顯式接收 torch.Generator；多GPU情況官方並警告只 seed current GPU不足以得到整體 deterministic behavior。

vLLM native sampler中，probability tensor對應一個 exponential-noise tensor q；沒有獨立 generator的 rows會走預設 generator，有 per-request generator的 row則個別重抽。這表示 batch composition、draw shape、generator assignment與 consumption order都可能影響 RNG state演進。

建議：
RNGGeneration = H(deviceGeneration, generatorIdentity, stateBeforeDigest, drawOpGeneration, drawShape, drawDtype, requestRowBinding, stateAfterDigest)

SamplingRandomnessWitness = H(RNGGeneration, noiseTensorDigest/sketch, processedDistributionGeneration)

限制：production不能每 token保存完整 RNG tensor，需研究 counter/offset級低成本 witness。

### 3. Sampler backend是隱藏的 token-generation state
vLLM current TopKTopPSampler會依 platform與功能條件選 native / FlashInfer / XPU / ROCm aiter等路徑；CUDA FlashInfer在 per-request generators存在時會 fallback native。更重要的是 current source明確寫：FlashInfer與 random_sample只保證 statistically equivalent，outputs不一定一致。

因此：
SameProcessedDistribution + SameUserSeed --does_not_prove→ SameCommittedToken

除非同時綁定 SamplerBackendGeneration、generator mapping、RNG state/consumption semantics。

新增：SamplerBackendGeneration、SamplerKernelGeneration、SamplerBackendDispatchWitness。

### 4. Speculative decoding必須分 DraftToken 與 CommittedToken
vLLM current RejectionSampler定義：
- accepted token：依 raw draft / target probabilities關係接受的 draft token；
- recovered token：draft被拒後，從 draft+target導出的 adjusted distribution重新取樣；
- bonus token：所有 draft都接受時，從 target side提供的 bonus token；
- final output = accepted + recovered + bonus。

因此 token provenance必須至少有：
DraftTokenGeneration → TargetVerificationGeneration → AcceptanceDecisionGeneration → {AcceptedDraft | RecoverySample | BonusSample} → CommittedTokenGeneration

核心 edge：
DraftTokenGeneration --does_not_imply→ CommittedTokenGeneration

### 5. Acceptance policy本身會改變語意保證
Chen et al. 2023 speculative sampling使用 modified rejection sampling，以 target distribution preservation作為核心；SpecTr 2023再從 optimal transport / maximal coupling觀點推廣 acceptance設計。2026 vLLM Ascend文件則提供 Block Verify與Entropy Verify，並明確說這些 optimization會修改 token acceptance criteria且可能造成 minor precision degradation。

因此 speculative decoding不能只記 enabled=true；至少要記 proposer generation、draft length、draft distribution、target distribution、rejection method、threshold/policy、random draws與 recovery distribution。

AcceptancePolicyGeneration = H(method, targetTransformGeneration, draftTransformGeneration, thresholdPolicy, entropyPolicy, blockPolicy, numericalPolicy)

## Architecture Breakdown
System architecture：Token Commit Plane

ModelInvocationWitness
→ RawLogitsGeneration
→ SamplingTransform DAG
→ ProcessedDistributionGeneration
→ Sampling Mode Router
   ├─ Greedy: Argmax → CandidateToken
   └─ Random: RNGGeneration → SamplerBackend → CandidateToken
→ Optional Speculative Verification Plane
   ├─ DraftTokenGeneration
   ├─ TargetProbabilityGeneration
   ├─ AcceptanceRandomnessGeneration
   ├─ AcceptanceDecisionGeneration
   ├─ RecoveryDistributionGeneration
   └─ BonusTokenGeneration
→ TokenCommitGate
→ CommittedTokenGeneration
→ Append to autoregressive history / next decode step

Agent層意義：model response stream最終由 committed tokens組成；若要回答「為什麼 Agent說出這個字」，不能只回指 logits，還必須能回指 sampling transform、RNG與 speculative acceptance lineage。

## Bottom-Level Logic
深入 mechanism：Exponential-race sampling + speculative rejection sampling。

### A. vLLM native random sampling
Processed logits → softmax probabilities p → exponential random noise q → score_i = p_i / q_i → argmax(score) → sampled token。

per-request generator存在時，對該 request row使用其 generator生成 q；其他 rows可共享/default generator path。這使 request-row-to-generator binding成為 provenance的一部分。

### B. Speculative token verification
Draft model/proposer先產生 draft sequence；target model平行計算對應位置的 target logits/probabilities。標準 speculative rejection sampling逐位置判斷 draft是否接受；第一個拒絕位置需從校正後 distribution recovery sample，若全接受則可加入 bonus target token。

因此一個 output token至少應帶 origin enum：ACCEPTED_DRAFT / RECOVERY_SAMPLE / BONUS_TARGET / NON_SPECULATIVE_SAMPLE / GREEDY_ARGMAX。

## Visual Simulation Idea
「Logits → RNG → Speculative Token Commit Microscope」

面板：Raw Logits | Masks/Penalties | Temperature | Min-P | Top-K | Top-P | Processed Distribution | RNG State/Counter | Noise | Sampler Backend | Draft Tokens | Target Prob | Acceptance Ratio/Threshold | Recovery Distribution | Committed Token

互動：
- 固定 logits，只切 temperature/top-p/min-p，觀察 support與 token變化。
- 固定 sampling policy，只改 generator state/counter，觀察 token變化。
- 固定 seed但改 batch/request row ordering，顯示 RNG consumption lineage。
- 啟用 speculative decoding，逐 token標色 accepted/recovered/bonus。
- 切 native vs FlashInfer，顯示 statistically equivalent不等於 bitwise/token replay equivalent。

故障注入：RNG_STATE_REUSED、REQUEST_ROW_GENERATOR_SWAPPED、BATCH_REORDER_CONSUMES_DIFFERENT_RANDOMNESS、SAMPLER_BACKEND_CHANGED、TOP_P_APPLIED_BEFORE_TEMPERATURE、DRAFT_TARGET_PROBABILITY_MISMATCH、ACCEPTANCE_POLICY_CHANGED、RECOVERY_TOKEN_WRONG_DISTRIBUTION、BONUS_TOKEN_FROM_WRONG_TARGET_GENERATION。

## Code / GitHub
本輪實際追 current vLLM source：
- vllm/v1/sample/sampler.py：完整 sampling transform順序；greedy/random分流；temperature → argmax-invariant processors → top-k/top-p。
- vllm/v1/sample/ops/topk_topp_sampler.py：native exponential-noise sampling、per-request generators、FlashInfer/XPU/ROCm backend dispatch；FlashInfer只保證 statistical equivalence。
- vllm/v1/sample/rejection_sampler.py：speculative accepted/recovered/bonus token定義、target logits constraints與 rejection sample output。
- vllm/v1/worker/gpu/model_runner.py：Sampler與RejectionSampler都屬於 GPU model runner execution state，並與 speculative steps / LoRA / CUDA graph state並存。

下一步值得讀：sampling metadata如何建立 per-request generators；rejection_random_sample_kernel如何產生/消耗 random numbers；scheduler在batch reorder、preemption/resume時如何維持 request RNG identity。

## Papers
1. Accelerating Large Language Model Decoding with Speculative Sampling — Charlie Chen, Sebastian Borgeaud, Geoffrey Irving, Jean-Baptiste Lespiau, Laurent Sifre, John Jumper — DeepMind — 2023 — https://arxiv.org/abs/2302.01318 — Architecture：draft model + target parallel scoring + modified rejection sampling。Contribution：在不改 target distribution（hardware numerics範圍內）的前提下，以 Chinchilla 70B報告約2–2.5× decoding speedup。Limitations：實際 runtime仍受 draft quality、acceptance rate、kernel/backend與 RNG implementation影響。Code：論文頁未作為本輪主要驗證來源。
2. SpecTr: Fast Speculative Decoding via Optimal Transport — Ziteng Sun, Ananda Theertha Suresh, Jae Hun Ro, Ahmad Beirami, Himanshu Jain, Felix Yu — 2023 — https://arxiv.org/abs/2310.15141 — Architecture：以 optimal transport / maximal coupling推廣 speculative acceptance到多候選 token。Contribution：提供 acceptance的 principled framework並報告額外 speedup。Limitation：最佳 transport plan對 candidate數可能昂貴。
3. Towards Optimal Multi-draft Speculative Decoding — Zhengmian Hu et al. — 2025 — https://arxiv.org/abs/2502.18779 — Architecture：multi-draft + target verification + OT dual分析。Contribution：量化 acceptance theoretical upper bound，指出 draft sampling method本身會改變可達 acceptance rate。Limitation：理論上限與production kernel/runtime成本仍有距離。
4. Efficient Adaptive Rejection Sampling for Accelerating Speculative Decoding in Large Language Models — Chendong Sun — 2025 — https://arxiv.org/abs/2512.13194 — Architecture：以 target uncertainty調整 acceptance threshold。Contribution：嘗試降低 high-uncertainty情境的 random rejection。Limitation：它主動放寬 acceptance criterion，quality/distribution fidelity需與標準 rejection sampling分開評估；vLLM Ascend相關RFC仍屬工程演進線。

## 已確認 / 官方 / 論文 / 工程推論 / 假說
已確認工程實作：vLLM sampler transform順序、native exponential-noise sampling、per-request generator row override、FlashInfer statistical-equivalence註解、RejectionSampler accepted/recovered/bonus token組成。
官方資訊：PyTorch CUDA RNG state可讀寫；random APIs可接受顯式 Generator；多GPU deterministic seeding需處理所有GPU。
論文結果：標準 speculative sampling可透過 modified rejection維持 target distribution；後續工作從 OT與multi-draft角度分析 acceptance。
工程推論：production token provenance必須把 sampling policy、backend、RNG generation、spec acceptance generation與 token origin綁成 TokenCommitWitness。
尚未驗證假說：可以用 request-local counter-based RNG identity + processed-distribution top-K digest + acceptance trace，在低 overhead下重建足夠強的 token commit attestation，而不必保存完整 vocab distribution或完整 RNG tensor。

## Unknown / Open Questions
1. vLLM current CUDA/native/FlashInfer各 sampling backend實際如何消耗 Philox/default generator counter；batch reorder/preemption是否能做到 request-local replay identity？
2. speculative decoding同一步中 acceptance RNG、recovery sampling RNG與bonus sampling RNG是否應分成獨立 substreams，才能避免 implementation detail改變後造成 cascading token divergence？
3. TokenCommitWitness需要保存完整 processed distribution digest，還是 top-K + sampled-token probability + RNG counter + policy digest已足以驗證？

## 下一輪研究
CommittedTokenGeneration → append/output history → KV Cache write → block/page allocation → prefix cache identity → sequence position/slot mapping → preemption/swap/recompute → next decode attention reads → KVCacheReadWitness。

重點補齊：token已 committed之後，下一個 decode step怎麼證明 Q真正讀到「這個 request、這個 layer、這個 position、這一代 model weights」對應的 K/V，而不是 stale page、prefix-cache collision、slot mapping錯誤或 preemption/reuse後的另一代 KV。

## Knowledge Graph 新增 Node / Edge
Nodes：SamplingPolicyGeneration、SamplingTransformGeneration、ProcessedLogitsGeneration、ProcessedDistributionGeneration、ProcessedDistributionWitness、GreedyDecisionGeneration、SamplerBackendGeneration、SamplerKernelGeneration、SamplerBackendDispatchWitness、RNGGeneratorIdentity、RNGGeneration、SamplingRandomnessWitness、RequestGeneratorBindingWitness、DraftTokenGeneration、DraftDistributionGeneration、TargetVerificationGeneration、AcceptancePolicyGeneration、AcceptanceRandomnessGeneration、AcceptanceDecisionGeneration、RecoveryDistributionGeneration、RecoveryTokenGeneration、BonusTokenGeneration、TokenOriginIdentity、CommittedTokenGeneration、TokenCommitWitness。

Edges：RawLogitsGeneration --transformed_by→ SamplingPolicyGeneration；SamplingPolicyGeneration --produces→ ProcessedDistributionGeneration；RNGGeneration --samples_from→ ProcessedDistributionGeneration；SamplerBackendGeneration --implements→ SamplingPolicyGeneration；DraftTokenGeneration --verified_by→ TargetVerificationGeneration；AcceptancePolicyGeneration --governs→ AcceptanceDecisionGeneration；RejectedDraft --causes→ RecoveryDistributionGeneration；AcceptedDraft/RecoveryToken/BonusToken --may_produce→ CommittedTokenGeneration；CommittedTokenGeneration --appends_to→ AutoregressiveHistoryGeneration；SameProcessedDistribution --does_not_prove→ SameCommittedToken；SameSeed --does_not_prove→ SameRNGGeneration；DraftTokenGeneration --does_not_imply→ CommittedTokenGeneration。

## 本輪結束判斷
缺哪一層：Committed token → KV cache write/read lineage。
哪個節點最淺：RNGGeneration的 portable counter/consumption identity。
哪個概念仍只是名詞：production-grade TokenCommitWitness。
哪個系統值得讀原始碼：vLLM SamplingMetadata / generator construction + rejection sampling Triton kernel + KV cache manager。
哪篇論文需追引用：Chen et al. 2023 speculative sampling，並追 SpecTr與multi-draft acceptance研究。
哪個概念最適合視覺模擬：Logits → RNG → Speculative Token Commit Microscope。
哪個 Agent 架構最值得實作：Event-sourced Agent Runtime + RawLogitsWitness + SamplingPolicyGeneration + request-local RNGWitness + SpeculativeAcceptanceWitness + TokenCommitWitness。

端到端鏈更新：User → UI → Agent → Context → Prompt Compiler → Token/Embedding → Weights → Transformer/MoE → Distributed Collective → CUDA Stream/Event → Storage/Graph → Compiled Kernel/Numerical Policy → Final Hidden/Norm → LM Head → Raw Logits → Sampling Transform → RNG/Sampler Backend → Speculative Verification → Committed Token → [KV cache lineage gap] → Decode/Stream → Observation → Tool/Effect → Context Re-entry。
