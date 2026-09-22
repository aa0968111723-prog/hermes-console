# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-22 19:51 Asia/Taipei

## 本小時新發現

本輪接續上一輪 `ContextDataLabelPropagationWitness`，專注在 Agent 的 RAG / persistent memory / summarization / consolidation 如何保存來源、信任與「可被當成什麼權威使用」的資訊。核心結論：**內容 lineage 不等於 authority lineage；摘要後文字仍然正確，也可能已經越權。**

新的端到端鏈：

`External Observation → Origin Binding → Memory Write → Integrity/Authority Metadata → Embedding/Index → Retrieval Candidate → Provenance Verification → Authority Filter → Context Injection → Summarization/Consolidation → Derived Memory → Tool Argument → Sink Policy → Side Effect`

### 新論文 / 架構

1. **Securing LLM-Agent Long-Term Memory Against Poisoning: Non-Malleable, Origin-Bound Authority with Machine-Checked Guarantees** — Yedidel Louck, 2026. 提出 TMA-NM，指出 content-based 與普通 lineage-based trust 都可被 summarization、trusted-tool echo、manufactured corroboration 洗白；主張 write-time origin binding 與 non-malleable authority。論文報告 benchmark 中 laundering attack success 可達 68%，TMA-NM 在其測試的 direct/laundering attacks 為 0%，並提供 TLA+ machine-checked models。限制：新預印本，外部 replication 與 production integration 尚需驗證。
2. **When Memory Becomes Authority: Benchmarking Authority Collapse at the Memory Consolidation Boundary** — Qiuyang Zhan et al., 2026. AuthMem-Bench 把「claim內容」固定，只改 source authority，直接測 consolidation 是否擦掉授權限制。論文報告 49 個配置中 48 個出現 authority collapse；action-grounded 評估中，缺少 authority metadata 的 collapsed memory 平均 unauthorized-action rate 50.3%；persisted authority labels 在 end-to-end 評估把觀察到的 unauthorized-action rate 從 16.9% 降到 0.0%。限制：authority labels 的預測器本身仍可能錯誤，不能視為 cryptographic proof。
3. **SMSR: Certified Defence Against Runtime Memory Poisoning in Persistent LLM Agent Systems** — Tarun Sharma, 2026. Write path 以 HMAC-SHA256 provenance 驗證合法 memory，query path用 randomized ablation + verdict majority 對 authenticated adversary 提供 bounded robustness。論文報告 unsigned attack 93–100% → 0%，authenticated single injection 約 8.0%。限制：簽章證明的是 write provenance / integrity，不自動證明內容擁有執行權威。
4. **MemoryGraft** — Saksham Sahai Srivastava, Haoyu He, 2025. 展示 poisoned experience 可以透過正常 agent memory write path持久化，之後靠 lexical/embedding retrieval重新進入 context，造成跨 session semantic imitation。這提供「memory不是被動資料庫，而是未來控制流來源」的攻擊證據。
5. **LangGraph checkpoint architecture**：current source 的 checkpoint state明確維護 `channel_values`、每channel單調增加的 `channel_versions`、node `versions_seen`、`updated_channels`；checkpointer也有 checkpoint metadata 與 pending writes。這些結構足以追 state-generation / causal execution，但目前 generic checkpoint schema本身沒有一個強制的 source-authority / information-flow label lattice。這是工程觀察，不代表 LangGraph 不允許應用層自行加入 metadata。

## 本小時最重要 5 個發現

### 1. Provenance integrity ≠ authority

**已確認事實 / 論文結果：** SMSR 顯示 HMAC write provenance 能阻擋 unsigned memory injection；TMA-NM則指出 provenance/lineage若可以被 summarization 或 trusted echo 洗白，仍不足以阻止 authority escalation。

底層拆解：

`Source → OriginID → WriterPrincipal → IntegrityTag → MemoryRecord → Retrieval`

只回答「這筆資料由誰寫、是否被竄改」。真正 action safety 還需要：

`OriginAuthority → PermittedUse → PermittedSink → DelegationDepth → Expiry → DerivedAuthority`

因此新增：

`IntegrityVerified --does_not_prove→ AuthorityToAct`

### 2. Summarization 是 authority transform，不只是 text transform

如果：

`Untrusted Web Page → Agent Observation → Summary("使用者要求匯款") → Memory`

summary的句子可能語義忠實，但若 source label從 `UNTRUSTED_EXTERNAL` 消失，下一次 retrieval 可能把它當成 `USER_INSTRUCTION`。

所以 summary 必須產生：

`DerivedMemory = f(ContentInputs, OriginSet, AuthorityMeet, TransformationID)`

保守 authority lattice建議：

`SYSTEM_POLICY > EXPLICIT_USER_AUTHORITY > ATTESTED_TOOL_FACT > USER_DATA > EXTERNAL_RETRIEVED_DATA > UNTRUSTED_CONTENT`

對多來源 derivation，authority預設取「不高於所有輸入可共同支持的 authority」，不能因模型重寫而提升。

新增：

`SemanticFidelity --does_not_prove→ AuthorityPreservation`

### 3. Retrieval ranking 與 authorization filtering 必須分離

普通 RAG：

`Query → Embedding → Vector Search → Top-K → Rerank → Context Injection`

安全 memory RAG應變成：

`Query → QueryPrincipal/TaskAuthority → Embedding → Candidate Search → Top-M → Integrity Verify → Origin/Authority Filter → Policy Filter → Rerank → Top-K → Context Injection`

相似度回答「相關嗎？」；policy回答「這個request現在有權使用嗎？」；authority回答「這段memory可以作為fact、suggestion，還是instruction？」三者不能合併。

### 4. Memory consolidation 是 security commit boundary

AuthMem-Bench指出 consolidation 可能保留 claim 卻抹掉 source constraints。因此 memory lifecycle應明確有：

`RawObservation → CandidateMemory → ProvenanceAttach → AuthorityAttach → ConsolidationProposal → AuthorityPreservationCheck → Commit → RetrievalEligible`

不是：

`Conversation → LLM Summary → Vector DB`

新增：

`MemoryConsolidationCommitWitness`
`AuthorityPreservationWitness`
`DerivedMemoryOriginSet`

### 5. Framework state versioning 不等於 semantic provenance

LangGraph checkpoint current source追蹤 channel values、versions、versions_seen與updated channels。這很好地回答「哪個state generation觸發哪個node」，但不能自動回答「這個值源自使用者、網站、tool還是模型推論，以及能否被當成授權」。

因此 Hermes 應把兩種圖疊加：

`Execution Causality Graph` + `Semantic Provenance/Authority Graph`

而不是把 checkpoint ID 當成 security provenance。

## Architecture Breakdown

### Memory Authority Runtime

1. **Ingestion Gateway**：接收 user/tool/RAG/web/sub-agent observation。
2. **Origin Binder**：建立 immutable `OriginIdentity` 與 principal/source channel。
3. **Integrity Signer / Verifier**：簽章或MAC，防止 storage tampering / unsigned injection。
4. **Authority Classifier**：決定 `FACT_ONLY / ADVISORY / USER_AUTHORITY / POLICY / UNTRUSTED`；LLM分類只能提供候選，不可自行升權。
5. **Memory Candidate Store**：未通過 commit前不可進 production retrieval pool。
6. **Consolidator**：summary/dedupe/merge；輸出 `DerivedOriginSet`。
7. **Authority Preservation Gate**：檢查 derived record authority沒有超過input authority envelope。
8. **Persistent Memory Store**：content + embedding + origin + authority + integrity + policy version + expiry。
9. **Retriever**：先 relevance candidate retrieval，再 provenance/authority/policy filtering。
10. **Context Builder**：保留來源channel標記，避免 retrieved document impersonate system/user instruction。
11. **Information-Flow Tracker**：Context → model output → tool args持續帶 data labels。
12. **Sink PEP**：在 tool/MCP side-effect 前做 final source→sink policy join。

## Bottom-Level Logic

### Memory record identity

`MemoryIdentity = RecordID + ContentHash + OriginSetHash + WriterPrincipal + AuthorityClass + IntegrityGeneration + PolicyGeneration + ConsolidationGeneration`

### Derivation

`R1 + R2 + ... → Transform T → Rderived`

需要：

`DerivedOriginSet = union(Origins(R1..Rn))`

以及：

`DerivedAuthority <= ConservativeAuthorityJoin(R1..Rn)`

模型自己產生的 summary不得把 `EXTERNAL_DATA` 升成 `USER_AUTHORITY`。

### Retrieval

`q → Embed(q) → ANN Top-M → verify signature/MAC → authority filter → tenant/principal filter → task policy filter → rerank → Top-K → context rendering`

### Context rendering

每段 retrieved content至少保留：

`{record_id, source_type, origin_id, authority_class, trust/integrity status, retrieval_generation}`

模型可見文字與 runtime policy metadata應分離；untrusted document內自己聲稱的 `[SYSTEM]` / `approved=true` 只能是content，不能變成control metadata。

### Sink decision

`ToolArgs ← Model(Context)` 後：

`SinkAllow = TaskAuthority ∩ ToolCapability ∩ DataFlowPolicy(ContextOrigins → Sink) ∩ UserApproval ∩ ArgumentPolicy`

## Visual Simulation Idea

### Memory Provenance & Authority Laundering Microscope

互動層：

`Source → Observation → Memory Write → Summary → Vector Index → Retrieval → Context → Tool Call → Sink`

每個node顯示：Origin、Authority、Integrity、Transformation、Generation、Data Label。

可注入：

- `SUMMARY_AUTHORITY_LAUNDERING`
- `TRUSTED_TOOL_ECHO_LAUNDERING`
- `MANUFACTURED_CORROBORATION`
- `UNSIGNED_MEMORY_INJECTION`
- `SIGNED_BUT_MALICIOUS_MEMORY`
- `CROSS_TENANT_RETRIEVAL`
- `DOCUMENT_AUTHORED_FAKE_SYSTEM_LABEL`

最重要UI狀態：

`Content Integrity ✓ | Origin ✓ | Relevance ✓ | Authority Preservation ✗ | Tool Commit BLOCKED`

## Code / GitHub

值得讀：

- `langchain-ai/langgraph/libs/checkpoint/langgraph/checkpoint/base/__init__.py`：Checkpoint、channel_versions、versions_seen、updated_channels。
- `langchain-ai/langgraph/libs/checkpoint/langgraph/checkpoint/memory/__init__.py`：in-memory saver與pending writes。
- `langchain-ai/langgraph/libs/langgraph/langgraph/pregel/_loop.py`：runtime writes → checkpoint persistence。
- MemoryGraft artifact：`Jacobhhy/Agent-Memory-Poisoning`，後續需深入directory structure、memory insertion/retrieval與evaluation harness。

## Papers

### Securing LLM-Agent Long-Term Memory Against Poisoning
- Authors: Yedidel Louck
- Year: 2026
- URL: https://arxiv.org/abs/2606.24322
- Architecture: TMA-NM / origin-bound non-malleable authority / IFC / TLA+
- Contribution: 證明普通content/lineage trust可被laundering，提出origin-bound authority。
- Limitations: 預印本；需production replication與framework integration。

### When Memory Becomes Authority
- Authors: Qiuyang Zhan, Rui Zhang, Sheng Guo, Lepeng Zhao, Zhuotao Liu
- Year: 2026
- URL: https://arxiv.org/abs/2608.01679
- Dataset/Benchmark: AuthMem-Bench
- Contribution: 隔離memory consolidation造成authority collapse。
- Limitations: predicted authority metadata不是cryptographic authority proof。

### SMSR
- Authors: Tarun Sharma
- Year: 2026
- URL: https://arxiv.org/abs/2606.12703
- Architecture: signed memory + smoothed retrieval
- Contribution: dynamic runtime memory poisoning的certified defence方向。
- Limitations: HMAC integrity與semantic authority是不同問題。

### MemoryGraft
- Authors: Saksham Sahai Srivastava, Haoyu He
- Year: 2025
- URL: https://arxiv.org/abs/2512.16962
- Code: https://github.com/Jacobhhy/Agent-Memory-Poisoning
- Contribution: persistent poisoned experience經retrieval造成跨session compromise。
- Limitations: 攻擊與結果依memory architecture/retrieval policy而變。

## Unknown / Open Questions

1. 如何定義跨 `summarization → memory merge → multi-agent handoff` 都不可被模型自行升級的 authority lattice，且仍保留實用性？
2. HMAC/signature證明 writer/integrity後，如何以可驗證方式證明「這筆資料可被當作 instruction」而不只是「確實由某writer寫入」？
3. 當多個來源互相矛盾且authority不同，derived memory應採 meet、join、quarantine還是 multi-record preservation？

## 下一輪研究

鎖定：

`Memory Retrieval → Context Assembly → Context Compaction/Summarization → Multi-Agent Handoff → Tool Argument Construction → Sink Classification → Information-Flow Policy → Side-Effect Commit`

重點比較：LangGraph state/checkpoint、LlamaIndex node metadata/relationships、OpenAI Agents session/context、Google ADK session/state，以及memory poisoning/authority-preservation研究。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `MemoryOriginIdentity`
- `MemoryIntegrityGeneration`
- `MemoryAuthorityClass`
- `MemoryAuthorityEnvelope`
- `DerivedMemoryOriginSet`
- `MemoryTransformationIdentity`
- `MemoryConsolidationGeneration`
- `MemoryConsolidationCommitWitness`
- `AuthorityPreservationWitness`
- `RetrievalAuthorizationGeneration`
- `ContextAuthorityGeneration`
- `DataFlowLabelGeneration`
- `MemoryToToolSinkPolicyWitness`
- `AuthorityLaunderingWitness`

### Edges
- `OriginIdentity --binds→ MemoryRecord`
- `MemoryRecord --transformed_by→ ConsolidationGeneration`
- `InputOriginSet --must_flow_to→ DerivedMemoryOriginSet`
- `InputAuthorityEnvelope --upper_bounds→ DerivedAuthority`
- `IntegrityVerified --does_not_prove→ AuthorityToAct`
- `SemanticFidelity --does_not_prove→ AuthorityPreservation`
- `VectorSimilarity --does_not_prove→ RetrievalAuthorization`
- `CheckpointGeneration --does_not_prove→ SemanticProvenance`
- `ContextOriginSet --constrains→ ToolSinkPolicy`

## 本輪結束判斷

- **缺哪一層：** Context compaction / summarization 後，authority + information-flow labels跨多Agent與tool argument的production propagation。
- **哪個節點最淺：** `AuthorityPreservationWitness` 的framework-level實作。
- **哪個概念仍只是名詞：** 可跨framework攜帶的 `MemoryAuthorityEnvelope`。
- **哪個系統值得讀原始碼：** LangGraph checkpoint/Pregel runtime + MemoryGraft artifact，下一輪再接 LlamaIndex metadata pipeline。
- **哪篇論文需追引用：** TMA-NM 與 AuthMem-Bench；前者給形式化security model，後者給consolidation boundary實證。
- **哪個概念最適合視覺模擬：** Memory Provenance & Authority Laundering Microscope。
- **哪個 Agent 架構最值得實作：** `State-grounded Planner + Origin-Bound Memory + Authority-Preserving Consolidator + Retrieval Policy Gate + Context IFC Tracker + Non-LLM Sink PEP + Side-Effect Transaction Manager`。

## 與歷史研究比較

上一輪建立 `UntrustedModelBoundary / TrustedTaskCompiler / ContextDataLabelPropagationWitness`；本輪補上的不是另一層prompt filter，而是把 `ContextDataLabelPropagationWitness` 向上游拆成 **origin binding → memory write → consolidation → retrieval authorization → context authority**。因此知識圖譜第一次能區分：

`資料是真的`、`資料沒被竄改`、`資料來源已知`、`資料相關`、`資料可以被讀`、`資料可以被當成instruction`、`資料可以授權side effect`

這七件完全不同的事。