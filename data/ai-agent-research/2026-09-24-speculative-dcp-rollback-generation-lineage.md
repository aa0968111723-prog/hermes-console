# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-24 23:51 Asia/Taipei

## 本小時新發現
本輪承接上一輪 `GlobalAttentionOutputWitness → DCP + speculative decoding rollback`，避免重複一般 speculative sampling、KV paging與 distributed softmax，專注 **draft window → target multi-token verification → accepted prefix → corrected global length → per-rank DCP local length/slot/attention metadata reconciliation → next proposal**。

核心命題：

`CorrectAcceptanceDecision ≠ CorrectDistributedRollback`

更精確：

`DraftWindowGeneration → TargetVerificationGeneration → AcceptedPrefixGeneration → CommittedGlobalLengthGeneration → DCPReconciliationGeneration → RankLocalSequenceGeneration → SlotMappingGeneration → NextDraftAttentionGeneration`

## 本小時最重要 5 個發現

### 1. DCP rollback不能用 local_len ± rejected_count
**已確認／vLLM RFC。** DCP依 global position、DCP size、rank與 interleave分配KV。對 global length L、DCP size D、interleave I、rank r：

`local_len(r,L)=floor(L/(D*I))*I + clamp(L%(D*I)-r*I,0,I)`

因此 speculative rejection後必須先得到 corrected global committed length，再重新計算每rank local length；直接 `local_seq_len -= num_rejected` 在一般情況不成立。

新增 `CommittedGlobalLengthGeneration`、`DCPReconciliationGeneration`、`RankLocalSequenceGeneration`。

來源：https://github.com/vllm-project/vllm/issues/50391

### 2. verifier中的每一個 speculative query都有不同的 rank-local可見KV邊界
**已確認／vLLM RFC + current FlashInfer guard。** 歷史長度H、一次驗證N個query時，第j個query只能看到 `local_len(r,H+j+1)`，不能用最後 `local_len(r,H+N)`替代。current FlashInfer backend甚至明確避免在DCP下讓q_len>1走缺乏cp_rank/global-seq-len資訊的decode kernel，因為end-aligned causal mask會錯。

因此新增 `PerQueryLocalVisibilityGeneration` 與 `SpecVerifierAttentionDomainWitness`。

來源：https://github.com/vllm-project/vllm/issues/50391 ; https://github.com/vllm-project/vllm/blob/main/vllm/v1/attention/backends/flashinfer.py

### 3. rejection不只是刪token；它是多個runtime state的generation barrier
**工程實作／current vLLM source。** current proposer明確追蹤 rejected-token mask、masked parallel-draft slots與slot mapping；在後續draft pass中會用 `num_rejected_tokens_gpu`修正sequence metadata，並重新建立attention metadata。這表示rollback至少跨：token sequence、positions、seq_lens、slot mapping、block table interpretation、draft hidden state與attention metadata。

新增 `SpecRollbackBarrierGeneration`、`RejectedDraftInvalidationWitness`、`PostRollbackMetadataWitness`。

來源：`vllm/v1/spec_decode/llm_base_proposer.py`

### 4. logical speculative window與physical query span可能分裂
**已確認／近期vLLM bug evidence。** 2026-09的Mamba/PD案例顯示，logical speculative window仍宣告1 target + 7 drafts，但physical target span因state/block boundary被clip成5；flattened batch shape仍可能合法，錯誤出現在request-local contract。這說明只驗batch tensor shape不足以證明speculation correctness。

新增：
`SpecWindowContractWitness = H(logicalDraftWindow, physicalQuerySpan, placeholderCount, rejectionWindow, cacheModeGeneration)`。

來源：https://github.com/vllm-project/vllm/issues/54392

### 5. speculative state不一定需要獨立drafter KV；但共享/重用會擴大provenance contract
**論文結果 + 工程實作。** 2026 H-Spec提出不建立獨立drafter KV cache，而重用target KV並注入last-token target hidden state；vLLM Metal的MTP也存在assistant與target共享KV的路徑。這降低memory，但使`draft state identity`不能再等同`draft KV allocation identity`，必須記錄target-KV generation與drafter read contract。

新增 `DraftContextSourceGeneration`、`TargetKVReuseByDraftWitness`。

來源：https://arxiv.org/abs/2609.24197 ; https://docs.vllm.ai/projects/vllm-metal/en/stable/speculative_decoding/

## Architecture Breakdown

### DCP-aware speculative decode transaction
`Committed global sequence G_n`
→ derive rank-local lengths from `(G_n,D,I,r)`
→ build draft attention metadata
→ propose K draft tokens
→ reserve/write speculative KV/slots
→ target verifies K(+bonus) queries
→ each query j uses DCP-local boundary derived from `G_n+j+1`
→ rejection sampler chooses accepted prefix A
→ derive `G_{n+1}=G_n+A+committed recovery/bonus`
→ invalidate rejected draft generations
→ recompute each rank's local sequence length from `G_{n+1}`
→ reconcile slot mapping/block-table/position metadata
→ rebuild next drafter attention metadata
→ next proposal.

核心不是「rollback N tokens」，而是 **commit a new global sequence generation, then derive all rank-local state from it**。

## Bottom-Level Logic

定義global token owner：
`owner(p)=floor((p mod (D*I))/I)`（在單一interleave cycle的簡化表示）。

因此連續speculative tokens可能輪流落在不同rank。若accepted count從4變成1，某rank可能需要rollback 0個local token，另一rank需要rollback 1個；不存在普遍正確的 `rank_local_len -= global_rejected_count`。

建議Hermes invariant：

`RankLocalSequenceGeneration(r) == Derive(CommittedGlobalLengthGeneration,DCPTopologyGeneration,InterleaveGeneration,r)`

`union_r CommittedRankLocalKV(r) == CommittedGlobalKVSet`

`RejectedDraftKVSet ∩ NextAttentionVisibleKVSet == ∅`

`SpecVerifierAttentionDomain(q_j,r) == DCPProject(GlobalCausalDomain(q_j),r)`

`PostRollbackSlotMapping.tokenGeneration == CommittedTokenGeneration`

Witness：

`SpeculativeTransactionWitness = H(baseGlobalGeneration,draftWindowGeneration,targetVerificationGeneration,acceptanceDecisionGeneration,newCommittedGlobalGeneration,rollbackBarrierGeneration,dcpReconciliationGeneration)`

`DCPRollbackWitness = H(newCommittedGlobalLength,rankLocalLengths,invalidatedDraftKVGenerations,slotMappingGenerations,attentionMetadataGenerations)`

## Visual Simulation Idea
### Speculative DCP Commit / Rollback Microscope

畫面：
`Global token timeline | Draft tokens | verifier queries | accept/reject | DCP rank ownership | rank-local KV | slot map | metadata generation | next proposal`

使用者拖動acceptance boundary，可即時看到每rank local length如何非對稱改變，以及哪些physical slots從`SPECULATIVE`轉成`COMMITTED`或`INVALIDATED`。

故障注入：
`LOCAL_LEN_MINUS_GLOBAL_REJECTED`、`FUTURE_SPEC_KV_VISIBLE_TO_EARLY_QUERY`、`REJECTED_KV_REMAINS_VISIBLE`、`SLOT_MAPPING_NOT_REBUILT`、`BLOCK_TABLE_GENERATION_STALE`、`DRAFT_HIDDEN_STATE_FROM_REJECTED_TOKEN`、`CUDA_GRAPH_REPLAY_WITH_OLD_LOCAL_LEN`、`LOGICAL_WINDOW_PHYSICAL_SPAN_MISMATCH`、`TARGET_KV_REUSED_BY_DRAFT_WRONG_GENERATION`。

## Code / GitHub
### vLLM
Repo: https://github.com/vllm-project/vllm

本輪追讀/定位：
- `vllm/v1/spec_decode/llm_base_proposer.py` — rejected-token mask、padding/masked slots、slot mapping buffer、`num_rejected_tokens_gpu`、draft-step attention metadata rebuild。
- `vllm/v1/worker/gpu/spec_decode/speculator.py` — DCP local sequence lengths傳入speculator。
- `vllm/v1/worker/gpu_model_runner.py` — runtime DCP local seq lens與spec rejection plumbing。
- `vllm/v1/attention/backends/flashinfer.py` — DCP + multi-query speculative verification kernel限制與fallback。
- RFC #50391 — DCP + speculative decoding完整設計缺口與local_len公式。
- Issue #54392 — logical speculative window vs physical span contract failure案例。

值得下一步追：scheduler/KV cache manager中speculative slot從reserved→committed/free的生命週期，以及CUDA Graph replay時DCP local length如何成為graph input而不是stale capture constant。

## Papers

### H-Spec: Parallel Speculative Decoding Without a Drafter-Side KV Cache
- Authors: Weifan Jiang, Krishna Teja Chitty-Venkata, Megan Flynn, Reed Meyerson, Zhenting Qi, Tianyu Wu, Eldar Kurtic, Minlan Yu, Alexandre Marques
- Year: 2026
- URL: https://arxiv.org/abs/2609.24197
- Architecture: hybrid Mamba-attention parallel drafter；attention重用target KV；Mamba由last-token target hidden state初始化。
- Contribution: 不建立獨立drafter KV cache；論文報告mean accepted length提升5.0–13.3%，batch-1 ITL speedup提升5.3–12.6%，並降低concurrent serving KV utilization。
- Limitations: 新方法；與DCP/interleaved KV、paged allocation、production rollback的組合仍需實作層驗證。
- 改變了什麼: 將draft provenance從「自己的KV cache」改成「可引用target context state」。

### VeriCache: Turning Lossy KV Cache into Lossless LLM Inference
- Authors: Jiayi Yao et al.
- Year: 2026
- URL: https://arxiv.org/abs/2605.17613
- Architecture: compressed KV負責draft；full KV負責verification；full KV可offload並與draft computation重疊。
- Contribution: 將speculative verification用於KV compression correctness，報告最高4× throughput且保持與full-KV decoding相同輸出。
- Limitations: 核心問題是lossy/full KV雙路徑，不等同DCP rollback。
- 改變了什麼: 強化「draft state可錯、commit state必須由authoritative state驗證」的generation模型。

## Unknown / Open Questions
1. vLLM最終DCP+spec實作中，rejected physical KV slots是立即free、lazy overwrite、還是僅由length/domain使其不可見？三者需要不同witness。
2. CUDA Graph下rank-local seq lengths/slot mapping是否全部作為replay-time dynamic inputs；若部分被specialize，rollback後如何防stale graph generation？
3. target-KV-reusing drafters（H-Spec/MTP類）與DCP結合時，drafter的required domain是否與target verifier完全相同，或需要獨立`DraftAttentionDomainGraph`？

## 下一輪研究
優先：
`DCPRollbackWitness → speculative KV slot lifecycle → reserved/committed/invalidated/free → block allocator reuse → CUDA Graph replay dynamic metadata → next decode visibility`。

次線：
`DraftContextSourceGeneration → target-KV reuse / MTP / H-Spec → draft attention-domain provenance → lossless acceptance contract`。

## Knowledge Graph 新增 Node / Edge

Nodes:
- `DraftWindowGeneration`
- `PerQueryLocalVisibilityGeneration`
- `SpecVerifierAttentionDomainWitness`
- `AcceptedPrefixGeneration`
- `CommittedGlobalLengthGeneration`
- `DCPReconciliationGeneration`
- `RankLocalSequenceGeneration`
- `SpecRollbackBarrierGeneration`
- `RejectedDraftInvalidationWitness`
- `PostRollbackMetadataWitness`
- `SpecWindowContractWitness`
- `DraftContextSourceGeneration`
- `TargetKVReuseByDraftWitness`
- `SpeculativeTransactionWitness`
- `DCPRollbackWitness`

Edges:
- `DraftWindowGeneration --verified_by→ TargetVerificationGeneration`
- `TargetVerificationGeneration --produces→ AcceptedPrefixGeneration`
- `AcceptedPrefixGeneration --advances→ CommittedGlobalLengthGeneration`
- `CommittedGlobalLengthGeneration --derives→ RankLocalSequenceGeneration`
- `DCPTopologyGeneration --constrains→ DCPReconciliationGeneration`
- `SpecRollbackBarrierGeneration --invalidates→ RejectedDraftKVGeneration`
- `DCPReconciliationGeneration --rebuilds→ PostRollbackMetadataWitness`
- `PerQueryLocalVisibilityGeneration --constrains→ SpecVerifierAttentionDomainWitness`
- `DraftContextSourceGeneration --may_reference→ TargetKVGeneration`
- `DCPRollbackWitness --precedes→ NextDraftAttentionGeneration`

## 本輪結束判斷
- 缺哪一層：speculative KV physical slot lifecycle與allocator transition。
- 哪個節點最淺：`RejectedDraftInvalidationWitness`，目前仍需追scheduler/KV manager實際free/retain策略。
- 哪個概念仍只是名詞：跨backend portable `SpecRollbackBarrierGeneration`。
- 哪個系統值得讀原始碼：vLLM scheduler + KV cache manager + spec proposer在accept/reject後的slot/block transition。
- 哪篇論文需追引用：H-Spec；並追其target-KV reuse與其他block-parallel drafter比較。
- 哪個概念最適合視覺模擬：Speculative DCP Commit / Rollback Microscope。
- 哪個Agent架構最值得實作：`Event-sourced Agent Runtime + SpeculativeTransactionWitness + DCPRollbackWitness + KVGenerationWitness + TokenCommitWitness`。

端到端鏈更新：
`User → UI → Agent → Context → Reasoning/Planning → Model → GPU → Attention/DCP → Logits → Sampling → Draft/Verify → Committed Global Token Generation → DCP Reconciliation → Rank-local KV/metadata → Next Decode → Output → Tool/Effect → Context Re-entry`。