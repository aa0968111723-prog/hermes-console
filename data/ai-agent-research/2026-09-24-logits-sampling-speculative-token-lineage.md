# 【AI Agent × Multimodal Research Report】

**時間：2026-09-24 07:56（Asia/Taipei）**  
**主題：Logits → Logit Processing → Sampling → Speculative Verification → TokenGenerationWitness**

## 與歷史研究比較
上一輪已建立 Request/Sequence → KV page/block table → position/RoPE → AttentionStateLineageWitness，缺口是 attention/hidden state 如何真正變成對外 token。本輪不重複 KV allocator，而下鑽 decode output boundary：hidden state / LM head → raw logits → processors/penalties → temperature/top-k/top-p/min-p → RNG/greedy → speculative accept/reject → committed token。

## 本小時新發現
1. vLLM V1 sampler 的順序不是抽象的「softmax 後 sampling」：raw logits 先轉 float32，再套 allowed-token mask、bad words、會改變 argmax 的 logits processors、repetition/frequency/presence penalties；之後才進 greedy/random branch，random branch再套 temperature、argmax-invariant processors、top-k/top-p並抽樣。
2. SamplingMetadata 明確把 temperature、top_p、top_k、per-request torch.Generator、penalties、prompt/output token history、allowed-token mask、bad words、logits processors、spec_token_ids 等放在 sampling boundary。因此 token provenance 必須包含 sampling-policy generation，而不能只 hash logits。
3. vLLM V2 logits processor 的 batch row 不是 request identity：rows 每 step 可重排；speculative decoding 下同一 request 有多個 draft rows。它靠 expanded_idx_mapping / idx_mapping / local position / input_ids / pos 將 row重新綁回 persistent request slot。這是新的 Row→Request binding surface。
4. Speculative decoding不是「draft token就是輸出」。Leviathan et al. 2023 的核心是 draft/proposal + target verification/rejection sampling，在保持 target distribution 的條件下加速。vLLM current rejection sampler也把 target/bonus logits與 accepted sampled token組合；因此 draft token必須與 committed token分離建模。
5. vLLM current docs 明確提醒 speculative decoding雖設計為 lossless，硬體浮點精度、batch size與數值穩定性仍可能造成 logprob/output variation。因此「相同 prompt + 相同 seed」不能在未固定 numerical/runtime generation時被視為 portable deterministic witness。

## 本小時最重要 5 個發現

### 1. RawLogitsIdentity != SamplingDistributionIdentity
**已確認事實 / 工程實作**：vLLM sampler在 raw logits之後依序施加 whitelist、bad words、processors、penalties、temperature、min-p/top-k/top-p。  
**底層鏈**：HiddenState → LMHead → RawLogits → ConstraintMask → LogitsProcessors → Penalties → Temperature → TopK/TopP/MinP → Normalized Distribution。  
**為什麼重要**：合法的 model forward並不保證最後 sampling distribution未被 runtime policy改寫。  
**限制**：不同 serving engine processor order可能不同，witness需綁 engine/version。

### 2. Sampling RNG 是 token identity 的一部分
**已確認事實**：vLLM SamplingMetadata包含 request-indexed `torch.Generator`。  
**合理工程建模**：建立 `SamplingRNGGeneration = H(engine, generator identity, seed/state commitment, request binding, sampling step)`。  
**限制**：完整 RNG state可能很大或敏感，實作可保存 commitment/sequence counter而非原始 state。

### 3. Batch row 不能冒充 request
**已確認事實**：vLLM V2 processor介面明說 logits rows每 step重排，spec decode一個 request會有多個 draft rows；`expanded_idx_mapping`等欄位負責映射。  
**新節點**：`LogitsRowBindingWitness = H(batchGeneration, row, persistentRequestSlot, localPosition, sequencePosition)`。  
**風險**：若 processor/state以 batch row當 request identity，可能把另一 request的 penalty/budget/constraint套到錯誤 logits row。

### 4. DraftTokenIdentity != CommittedTokenIdentity
**論文結果 + 工程實作**：Speculative Decoding用 draft model提出候選，再由 target distribution接受/拒絕；vLLM也有獨立 rejection sampler與 `spec_token_ids`。  
**新模型**：DraftTokenGeneration → TargetVerificationGeneration → AcceptanceDecision → CommittedTokenGeneration。  
**限制**：EAGLE、n-gram、MLP drafter、heterogeneous vocab等 proposer有不同 proposal provenance。

### 5. Distribution equivalence != bitwise replay determinism
**官方資訊**：vLLM指出 speculative decoding的 lossless目標不代表跨 run logprobs bitwise穩定，浮點精度與 batch shape可造成差異。  
**結論**：Hermes應分開 `SemanticDistributionWitness` 與 `DeterministicReplayWitness`，避免把「演算法保持分布」誤寫成「每次必產生同一 token」。

## Architecture Breakdown
```text
AttentionStateLineageWitness
  → Transformer residual/MLP/final norm
  → LM Head
  → RawLogitsGeneration
  → LogitsRowBindingWitness
  → Allowed/Bad-token Constraints
  → Stateful Logits Processors
  → Repetition/Frequency/Presence Penalties
  → Temperature
  → Min-P / Top-K / Top-P
  → SamplingDistributionGeneration
  → Greedy OR RNG draw
  → Draft/Target Verification (if speculative)
  → Acceptance/Rejection
  → CommittedTokenGeneration
  → Detokenization / Output
```

## Bottom-Level Logic
### Standard random decode
`hidden_t → W_vocab·hidden_t → logits_t → processors(logits_t, token_history, request_state) → logits'_t / temperature → truncate(top-k/top-p/min-p) → softmax → RNG draw → token_t+1`

### Greedy
`processed_logits_t → argmax → token_t+1`

### Speculative
`context → draft proposer → d1..dk → target forward over proposal positions → target distributions → accept/reject policy → accepted prefix + optional bonus/resampled token → committed output tokens`

重要區分：`spec_token_ids`是暫時 proposal state；只有 acceptance/rejection後才成為 committed output history。

## Hermes Proposed Witnesses
`RawLogitsGeneration = H(modelGeneration, sequenceGeneration, hiddenStateGeneration, lmHeadGeneration, vocabGeneration, step)`

`SamplingPolicyGeneration = H(engineVersion, temperature, topK, topP, minP, penalties, allowedTokenPolicy, badWordsPolicy, logitsProcessorSet, processorOrder)`

`LogitsRowBindingWitness = H(batchGeneration, logitsRow, requestGeneration, sequenceGeneration, sequencePosition)`

`SamplingDistributionWitness = H(rawLogitsCommitment, rowBinding, samplingPolicyGeneration, tokenHistoryGeneration, processedDistributionCommitment)`

`SpeculativeVerificationWitness = H(draftModelGeneration, proposalTokens, targetModelGeneration, targetDistributionCommitment, acceptancePolicyGeneration, acceptedPrefix, bonus/resampleDecision)`

`TokenGenerationWitness = H(requestGeneration, sequenceGeneration, position, attentionStateLineageWitness, rawLogitsGeneration, samplingDistributionWitness, rngGenerationOrGreedy, speculativeVerificationWitness?, committedTokenId, tokenizerGeneration)`

以上為 Hermes architecture proposal，不是 vLLM/PyTorch既有標準。

## Visual Simulation Idea — Logits → Token Lineage Microscope
互動欄位：Raw Logits heatmap、processor stack、penalty before/after、temperature、Top-K/Top-P boundary、request-row mapping、RNG draw、draft tokens、target verification、accepted/rejected tokens、committed token timeline。

故障注入：
- WRONG_REQUEST_ROW_MAPPING
- LOGIT_BIAS_CHANGED
- PENALTY_HISTORY_FROM_OTHER_REQUEST
- TOP_P_CHANGED_AFTER_AUTH
- RNG_STATE_ADVANCED_BY_OTHER_WORK
- DRAFT_TOKEN_COMMITTED_WITHOUT_TARGET_VERIFY
- TARGET_VOCAB_MAPPING_CHANGED
- FLOATING_POINT_VARIATION_FLIPS_NEAR_TIE
- TOKENIZER_GENERATION_CHANGED_AFTER_SAMPLE

## Code / GitHub
### vLLM
值得持續讀：
- `vllm/v1/sample/sampler.py` — processor/penalty/sampling order
- `vllm/v1/sample/metadata.py` — sampling policy與generator state carrier
- `vllm/v1/sample/rejection_sampler.py` — speculative target verification/output assembly
- `vllm/v1/worker/gpu/sample/logits_processor/interface.py` — row↔request/position mapping
- `vllm/v1/worker/gpu/model_runner.py` — model output與sampler wiring
- `vllm/v1/worker/gpu/spec_decode/` — proposer implementations

## Papers
### Fast Inference from Transformers via Speculative Decoding
- **Authors**: Yaniv Leviathan, Matan Kalman, Yossi Matias
- **Institution**: Google Research
- **Year**: 2023 (ICML)
- **URL**: https://proceedings.mlr.press/v202/leviathan23a.html
- **Architecture**: approximation/draft model proposes several tokens; target model evaluates proposals in parallel; rejection sampling preserves target distribution.
- **Contribution**: exact speculative decoding; paper reports 2–3× speedup on T5-XXL experiments without changing output distribution.
- **Limitations**: speedup depends on draft quality/cost and target verification economics; distributional correctness does not imply bitwise reproducibility across numerical runtimes.

## Unknown / Open Questions
1. vLLM/PyTorch RNG state如何以低成本建立 per-request cryptographic commitment，而不序列化巨大 generator state？
2. Custom/stateful logits processors如何建立可重播 state transition witness，尤其 processor state跨 request batching/reordering時？
3. Speculative decoding在 heterogeneous vocab、EAGLE/MLP drafter與 distributed target model下，如何建立统一 proposal→vocab-map→verification→commit lineage？

## Knowledge Graph 新增 Node / Edge
### Nodes
- `RawLogitsGeneration`
- `VocabularyGeneration`
- `LogitsRowBindingWitness`
- `SamplingPolicyGeneration`
- `LogitsProcessorSetGeneration`
- `PenaltyStateGeneration`
- `SamplingDistributionGeneration`
- `SamplingRNGGeneration`
- `DraftTokenGeneration`
- `TargetVerificationGeneration`
- `SpeculativeAcceptanceDecision`
- `SpeculativeVerificationWitness`
- `CommittedTokenGeneration`
- `TokenGenerationWitnessV2`
- `SemanticDistributionWitness`
- `DeterministicReplayWitness`

### Edges
- `AttentionStateLineageWitness --produces→ RawLogitsGeneration`
- `RawLogitsGeneration --transformed_by→ SamplingPolicyGeneration`
- `LogitsRowBindingWitness --binds→ RequestGeneration`
- `PenaltyStateGeneration --depends_on→ CommittedTokenHistory`
- `SamplingDistributionGeneration --sampled_by→ SamplingRNGGeneration`
- `DraftTokenGeneration --verified_by→ TargetVerificationGeneration`
- `TargetVerificationGeneration --produces→ SpeculativeAcceptanceDecision`
- `SpeculativeAcceptanceDecision --commits→ CommittedTokenGeneration`
- `CommittedTokenGeneration --extends→ SequenceGeneration`

## 缺口診斷
- **缺哪一層**：Committed token → tokenizer decode/text bytes → streaming transport → UI-visible text → Agent observation/action state。
- **最淺節點**：stateful custom logits processor provenance與per-request RNG generation。
- **仍只是名詞**：portable signed `SamplingDistributionWitness / TokenGenerationWitnessV2`。
- **最值得讀原始碼**：vLLM `rejection_sampler.py`、V2 logits processors、request output processor，以及 tokenizer/output streaming path。
- **最值得追引用的論文**：Leviathan et al., *Fast Inference from Transformers via Speculative Decoding* (ICML 2023)，再追Medusa/EAGLE與lossless speculative serving後續。
- **最適合視覺模擬**：Logits → Token Lineage Microscope。
- **最值得實作的 Agent 架構**：`Risk-aware Agent Runtime + KV/Attention Lineage + Sampling/Token Witness + Output/Observation Commit + MCP SemanticCommit/Receipt`。

## 下一輪研究
鎖定：
`CommittedTokenGeneration → tokenizer vocabulary/added tokens → byte/string decode → stop criteria → streaming chunk → transport ordering → UI rendering → Agent ObservationGeneration`

核心問題：即使 model、KV、logits、sampling與 speculative verification全部可信，Hermes如何證明「使用者/Agent最後看到的文字」正是這些 committed token在指定 tokenizer generation下的 decode結果，而且沒有被 stop logic、stream chunk reorder、Unicode normalization、tool-call parser或UI transport錯綁/改寫？

## Sources
- vLLM current sampler source: https://github.com/vllm-project/vllm/blob/main/vllm/v1/sample/sampler.py
- vLLM current SamplingMetadata: https://github.com/vllm-project/vllm/blob/main/vllm/v1/sample/metadata.py
- vLLM current rejection sampler: https://github.com/vllm-project/vllm/blob/main/vllm/v1/sample/rejection_sampler.py
- vLLM V2 logits processor interface: https://docs.vllm.ai/en/latest/api/vllm/v1/worker/gpu/sample/logits_processor/interface/
- vLLM speculative decoding docs: https://docs.vllm.ai/en/latest/features/spec_decode/
- Leviathan et al. 2023: https://proceedings.mlr.press/v202/leviathan23a.html
