# 【AI Agent × Multimodal Research Report】

**時間：2026-09-16 02:54（Asia/Taipei）**

**本輪主題：KV Cache × Prefix Caching × Multi-Tenant Isolation × TTFT Side Channels × Inference Runtime Trust Boundary**

## 與歷史研究比較

上一輪已將 Agent 層的資訊流拆成 content/control/metadata/termination channels，並指出下一個缺口位於 Model Router → Inference Server → KV Cache → GPU Scheduler。本輪因此不重複 Agent Tool/IFC，而把知識圖譜往 inference substrate 下推。

## 本小時新發現

1. vLLM 的 Automatic Prefix Caching（APC）不是抽象概念：request prompt 被切成 full KV blocks，每個 block 的 identity 由 parent hash + block tokens + extra hashes 組成；extra hashes 可包含 LoRA ID、multimodal input hash 與 cache salt。
2. prefix cache 的效能收益本質上會建立 timing observable：cache hit 減少 prefill，因此 TTFT 可與 cache miss 不同。vLLM 官方 security 文件已把跨 tenant prefix-cache timing leakage 明確視為安全問題，並以 cache_salt 分割共享域。
3. vLLM request/runtime 已把 cache_salt 做成 request-level field；它會進入 prefix hash chain，而不是只停留在 API gateway metadata。
4. 2026 KVGov 將防禦抽象成 per-principal cryptographic cache namespace：sigma_p = HMAC_K(secret, principal_id)。這說明 cache identity 應由 trust principal 決定，而不是讓任意 client 自己選 salt。
5. contention 會改變 side-channel reliability。2026-09 的實驗顯示共享 serving load 可大幅降低 cache-hit timing signal，但不是安全保證；noise 只降低 distinguishability，不能建立 noninterference。

## 本小時最重要 5 個發現

### 1. KV Cache 是「計算狀態」，也是跨 request 的資訊共享介面

Transformer autoregressive decoding 中，每一層 self-attention 會為歷史 token 保存 Key/Value tensors。沒有 KV cache 時，每產生新 token 都需要重算歷史 K/V；有 cache 時只計算新 token 的 Q/K/V，再讓 Q_new attention 到 K_cache + K_new。

底層鏈：

Token IDs → Embedding → Layer l → Q/K/V projection → append K,V to KV cache → Attention(Q_new, K_1:t, V_1:t) → FFN → next layer → logits → sampling。

因此 KV cache 降低的是 decode 重複計算；prefix caching 則更進一步讓「另一個 request」重用 prefill 已算好的 KV blocks。

限制：cache reuse 不改變理想模型輸出，但會改變 serving latency / GPU memory residency / scheduling 行為，因此效能最佳化可以成為 observable side channel。

### 2. vLLM Prefix Cache 的真正 identity 是 hash chain

官方設計：

BlockHash_i = H(parent_hash || block_tokens || extra_hashes)

extra_hashes 可以包含 multimodal image hash、LoRA identity、cache_salt 等。只 cache full blocks。v0.11 起預設 sha256；非 cryptographic xxhash 類選項有 collision/security trade-off。

這表示 cache hit 並不是「字串搜尋」，而是 block-chain identity matching。

### 3. cache_salt 是 trust-domain partition primitive

vLLM 將 cache_salt 混入第一個 KV block 的 hash，因此 salt 不同的 request 後續 hash chain 也不同，無法跨 salt reuse prefix blocks。

Hermes architecture inference：

cache_salt 不應由 Agent/LLM 自由產生，而應由 Inference Security Gateway 從 Tenant / Principal / Disclosure Domain 派生：

CacheNamespace = HMAC(server_secret, principal_or_trust_group_id)

這避免 attacker 指定 victim salt，也把 Agent IFC 的 principal identity一路延伸到 model-serving cache。

### 4. Multimodal Prefix Cache 也有 provenance/security implication

vLLM 對 image placeholder blocks 加入 frontend image hash，因為 tokenized prompt 中 image 會被 placeholders 取代；若不加入 image identity，不同圖片可能錯誤共享相同 placeholder prefix。

因此多模態 cache key 應理解成：

Text token identity + Modality artifact identity + Adapter/model identity + Trust namespace。

Hermes 應新增 MultimodalCacheIdentity，而不是只追 text prompt hash。

### 5. Scheduler noise 不是 confidentiality mechanism

最新 contention experiments 顯示 concurrent workers 能讓 timing effect size/AUROC 接近 random，但這是 workload-dependent empirical noise。攻擊者可以重複 probe、平均 samples，或等待較低負載窗口。

所以：

SchedulingNoise ≠ Isolation
RandomLatency ≠ Noninterference
Low AUROC under one workload ≠ Security Guarantee

## Architecture Breakdown — Inference Trust Boundary

UI / Agent Runtime
↓
Context Compiler
↓
Model Router
↓
Inference Security Gateway
├ Principal ID
├ Cache Namespace
├ Model/Adapter Scope
├ Data Classification
└ Observability Policy
↓
Tokenizer
↓
Prompt Blocks
↓
Prefix Hash Chain
↓
KV Cache Manager
├ Cached block map
├ Request block table
├ Free block queue
└ Ref counts
↓
Scheduler
↓
GPU Prefill / Decode
↓
Logits / Sampling
↓
Output Tokens
↓
Agent Runtime

安全邊界不應停在 Model Router；cache manager 與 scheduler 也必須帶 principal-aware policy。

## Bottom-Level Logic

### Decode KV cache

對 layer l：

Q_t = X_t W_Q
K_t = X_t W_K
V_t = X_t W_V

K_cache ← concat(K_cache, K_t)
V_cache ← concat(V_cache, V_t)

Attention_t = softmax(Q_t K_cache^T / sqrt(d_k)) V_cache

KV cache memory 大致隨 layers × sequence length × KV heads × head dimension × dtype bytes 成長；GQA/MQA 藉由減少 KV heads 降低 cache footprint。

### Prefix cache

Request A prefill：
Prompt tokens → blockize → compute K/V → store full blocks by hash。

Request B：
Prompt tokens → same block hash chain → lookup → matched blocks become computed prefix → skip corresponding prefill compute → TTFT decreases。

### Timing channel

Victim prefix cached
↓
Attacker sends candidate prefix
↓
Candidate hash hits victim block
↓
Less prefill compute
↓
Lower TTFT distribution
↓
Statistical distinguisher
↓
Infer whether candidate prefix existed

### Isolation

Principal → server-derived cache namespace → first-block salt → entire descendant hash chain separated。

## Visual Simulation Idea

### KV Cache & Prefix Timing Microscope

左側：Token Flow
User prompt → tokenizer → blocks B0/B1/B2 → per-layer K/V tensors。

中央：Cache Hash DAG
顯示 parent hash、token IDs、image hash、LoRA ID、principal salt，讓使用者切換 Tenant A/B 並看到相同 prompt 在不同 salt 下產生不同 block identities。

右側：GPU Timeline
Prefill kernels → KV write → decode kernels → TTFT。

互動：
- Toggle prefix cache ON/OFF
- Tenant A/B same/different namespace
- Secret prefix probe
- Cache hit/miss
- Add concurrent workers
- Add image input
- GQA vs MHA
- Block size

輸出：cache hit ratio、prefill tokens saved、KV VRAM、TTFT histogram、side-channel separability、cross-principal reuse violations。

## Code / GitHub

### vLLM
值得繼續讀：
- `vllm/v1/core/kv_cache_utils.py` — KV block metadata、hash、free queue。
- `vllm/v1/core/kv_cache_manager.py` — computed block lookup / allocation lifecycle。
- `vllm/v1/core/block_pool.py` — block pool / cache mapping / eviction。
- `vllm/v1/request.py` — request-level `cache_salt`。
- `vllm/inputs/engine.py` — cache_salt 進 engine input。
- `docs/design/prefix_caching.md` — block hash chain、multimodal hash、cache isolation。
- `docs/usage/security.md` — prefix-cache timing mitigation。

已確認工程實作：vLLM source 中 `Request` 保存 `cache_salt`；security/design docs 說明 salt 進第一 block hash，形成 cache isolation。

## Papers

### Governing the KV Cache: Preventing Timing Side-Channel Leakage in Multi-Tenant LLM Inference
- Author: Tejasvi C. Addagada
- Year: 2026
- arXiv: 2608.09225
- Architecture: KVGov + per-principal HMAC salt + ORIGAMI audit scheduler
- Contribution: 將三類 prefix-cache attack path 統一到 principal-isolated cache namespace。
- Reported result: unprotected vLLM/SGLang attacks up to 100% under evaluated configurations；real hardware confirms cold/cached TTFT gap。Defense evaluation 部分含 simulation，因此不能把所有結果視為 production proof。
- Limitation: workload/model/stack dependent；audit scheduler不是 isolation本身。

### PrefixWall / CacheSolidarity: Preventing Prefix Caching Side Channels in Multi-tenant LLM Serving Systems
- Authors: Panagiotis Georgios Pennas, Konstantinos Papaioannou, Marco Guarnieri, Thaleia Dimitra Doudali
- Year: 2026
- arXiv: 2603.10726
- Architecture: monitor cross-user cache reuse → suspicious reuse detection → selective prefix isolation
- Contribution: 嘗試保留 cache efficiency 而不是全 tenant 隔離。
- Reported: up to 70% higher cache reuse、30% lower inference latency vs evaluated user-level isolation baselines。
- Limitation: selective detection 的 false negative / adaptive attacker boundary 仍需深入驗證。

### Characterizing Contention-Induced Reliability Collapse in KV-Cache Timing Side Channels for Multi-Tenant LLM Serving
- Author: Rana Abu Bakar
- Year: 2026
- Date: 2026-09-06
- Contribution: 實測 contention 對 timing distinguisher reliability 的影響。
- Finding: attack signal 在 loaded regime 顯著下降，但不構成 formal protection。

### Semantic Invariance in Agentic AI
- Authors: I. de Zarzà et al.
- Institutions: LIST / Barcelona Supercomputing Center / Universidad Pontificia Comillas
- Year: 2026
- arXiv: 2603.13173
- Contribution: 用 semantic-preserving metamorphic transformations 測 Agent reasoning stability。
- 與本輪關係：下一輪 counterfactual causal probes 需要先定義 semantic action equivalence，否則 input perturbation 造成的正常 stochastic variation 會被誤判為 causal influence。

## 已確認 / 推論 / 假說

**已確認官方工程資訊**：vLLM 使用 hash-based prefix caching；cache_salt 可隔離 prefix reuse；multimodal image hash 可成為 extra hash component。

**論文結果**：共享 prefix cache 可以產生 TTFT timing channel；2026 work 正在研究 principal salting、selective isolation 與 contention effects。

**Hermes 工程推論**：Agent principal / IFC trust domain 應向下傳到 inference cache namespace，避免 Agent 層安全邊界在 Model Router 後消失。

**尚未驗證假說**：同一 Hermes deployment 中 scheduler/batching/KV eviction metadata 是否能被 remote tenant 穩定反推出其他 Agent 的 tool/reasoning phase；需要實驗。

## Unknown / Open Questions

1. Prefix salt 隔離 KV reuse 後，continuous batching、queueing、GPU memory pressure 是否仍提供可利用的 cross-principal timing channel？
2. Multimodal encoder cache / image embedding cache 是否有與 text prefix cache 類似的跨 tenant reuse leakage？
3. Agent counterfactual probe 的 action difference，如何區分真正 causal dependence 與 sampling / scheduler / model stochasticity？

## 下一輪研究

`GPU Scheduler × Continuous Batching × PagedAttention × KV Eviction × Prefill/Decode Disaggregation × Cross-Tenant Resource Contention × Semantic Action Equivalence`。

優先追：vLLM Scheduler、BlockPool、PagedAttention；SGLang RadixAttention；prefill/decode disaggregation；scheduler fairness/SLA；GPU/HBM contention side channels。

## Knowledge Graph 新增 Node

- KVCache
- KVCacheBlock
- PrefixCache
- PrefixHashChain
- CacheNamespace
- CacheSalt
- PrincipalScopedCache
- MultimodalCacheIdentity
- CacheHitObservation
- TTFTSideChannel
- PrefillCompute
- DecodeCompute
- CacheIsolationBoundary
- CrossTenantCacheReuse
- SchedulerNoise
- InferenceSecurityGateway
- ModelServingPrincipal
- CacheSideChannelDistinguisher

## Knowledge Graph 新增 Edge

- `PromptToken -> PRODUCES -> KVCacheEntry`
- `KVCacheBlock -> HASH_DEPENDS_ON -> ParentBlock`
- `KVCacheBlock -> HASH_DEPENDS_ON -> BlockTokens`
- `KVCacheBlock -> HASH_DEPENDS_ON -> CacheSalt`
- `MultimodalCacheIdentity -> HASH_DEPENDS_ON -> ImageHash`
- `ModelServingPrincipal -> DERIVES -> CacheNamespace`
- `CacheNamespace -> PARTITIONS -> PrefixCache`
- `PrefixCacheHit -> REDUCES -> PrefillCompute`
- `PrefillCompute -> INFLUENCES -> TTFT`
- `TTFT -> OBSERVABLE_BY -> RemoteTenant`
- `CrossTenantCacheReuse -> ENABLES -> TTFTSideChannel`
- `SchedulerNoise -> MODULATES -> SideChannelReliability`

## 每輪結束檢查

- **缺哪一層**：GPU scheduler / continuous batching / HBM-resource isolation。
- **哪個節點最淺**：SchedulerNoise、MultimodalCacheIdentity、InferenceSecurityGateway。
- **哪個概念仍只是名詞**：cross-principal scheduler noninterference。
- **哪個系統值得讀原始碼**：vLLM scheduler + block_pool + kv_cache_manager；下一個是 SGLang RadixAttention。
- **哪篇論文需追引用**：KVGov 2608.09225 與 PrefixWall 2603.10726，尤其它們引用的 PROMPTPEEK / EarlyBird / InputSnatch 與 SafeKV。
- **哪個概念最適合視覺模擬**：KV Cache & Prefix Timing Microscope。
- **哪個 Agent 架構最值得實作**：Hermes `InferenceSecurityGateway`，將 Agent principal、IFC label、cache namespace 與 inference observability policy 接到 model router / serving runtime。

## 從「使用者說一句話」往 GPU 再還原一層

User → UI → Agent → Context → Reasoning/Planning → Model Router → **Inference Security Gateway → Tokenizer → Prompt Blocks → Prefix Cache Lookup → KV Block Allocation → GPU Prefill → Per-layer K/V → Decode Scheduler → Attention → Logits → Sampling → Output Token** → Agent → Tool/MCP → Action。

本輪的核心答案是：**模型推理並不是一個完全封閉的函式。為了速度，serving runtime 會把過去 request 的 Transformer 中間狀態（KV tensors）留在共享 GPU/cache infrastructure 中；一旦 reuse 是否發生能改變外部可量測的 TTFT，效能狀態就成為資訊流的一部分。因此 Hermes 的 security graph 必須從 Agent/Tool/MCP 繼續延伸到 cache namespace、scheduler 與 GPU runtime。**
