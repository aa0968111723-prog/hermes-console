# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 20:55（Asia/Taipei）

主題：Multimodal Prefix Hash Chain × Extra Keys × cache_salt × Cross-Instance Reproducibility

## 本小時新發現

本輪接續上一輪 `MultiModalFeatureSpec → Encoder Identifier → Multimodal Extra Keys → Prefix Block Hash → Partial Block → cache_salt → Distributed KV Key` 缺口，直接追 vLLM `v1/core/kv_cache_utils.py`、`v1/engine/input_processor.py` 與 MooncakeStoreConnector 的 distributed prefix-cache semantics。

最重要的新確認是：multimodal prefix identity 不是單獨 `hash(prompt tokens)`，而是「parent block hash + 本 block token IDs + extra_keys」形成的鏈式 computation identity。extra_keys 會混入 LoRA、multimodal encoder identifier 與其 block-relative offset、第一 block 的 cache_salt，以及 prompt embeddings hash。因此一張相同圖片出現在不同 token-block 位置、不同 LoRA、不同 tenant salt，都可以得到不同 prefix block identity。

## 本小時最重要 5 個發現

### 1. Prefix Block Hash 是 ancestor-chained computation identity

已確認工程實作：`hash_block_tokens()` 的輸入是 `(parent_block_hash, curr_block_token_ids_tuple, extra_keys)`；第一 block 沒有 parent 時改用 `NONE_HASH`。因此第 n 個 block 的 identity 隱含所有祖先 block identity，而不是只描述當前 token block。

底層：

`Block0 = H(NONE_HASH, tokens0, extra0)`

`Block1 = H(Block0, tokens1, extra1)`

`Block2 = H(Block1, tokens2, extra2)`

重要性：修改 prefix 前方任意一個 token / media identity / salt，後續 descendant block hash 都會改變，天然形成 prefix DAG/chain invalidation。

限制：hash equality 代表 runtime identity equality，不代表不同 TP/數值執行路徑產生的 KV tensor 必然 bitwise identical。

### 2. Multimodal extra key 精確包含 `(encoder_identifier, block-relative offset)`

已確認工程實作：`_gen_mm_extra_hash_keys()` 掃描已依 token offset 排序的 `mm_features`。只要一個 multimodal item 與該 hash block 相交，就加入 `(mm_feature.identifier, offset - start_token_idx)`。

因此：

`same image + same text tokens + different image position → different block hash`

而當一個 visual span 跨越多個 hash blocks，同一 encoder identifier 可以出現在多個 block extra_keys；offset 是相對該 block 起點的位置。

這解釋上一輪的 dual-cache semantics：encoder cache reuse unit 是整個 media computation identity，但 prefix cache identity 還額外編碼「這個 media embedding 在 token prefix 的哪個位置」。

### 3. Encoder identifier 與 processor mm_hash 是兩層 identity

已確認工程實作：`MultiModalFeatureSpec` 同時保存 `mm_hash` 與 `identifier`。當 tower/connector LoRA 不影響 multimodal embedding 時 identifier=mm_hash；啟用 `enable_tower_connector_lora` 且 request 有 LoRA 時，identifier 會變成 `lora_name:mm_hash`。

底層：

`Media/Processor Identity = mm_hash`

`Encoder Computation Identity = _get_mm_identifier(mm_hash, LoRA)`

`Prefix MM Extra Key = (Encoder Computation Identity, relative token offset)`

重要性：processor output 可跨 LoRA reuse，但若 LoRA 改變 vision tower/connector，encoder embedding 與 prefix KV identity 必須分流。

限制：現行字串 namespace 直接使用 LoRA name；跨 deployment 的 model/adapter revision 是否完整進入 namespace仍值得繼續驗證。

### 4. cache_salt 只進第一個 block，但透過 parent hash 傳播到整條 descendant chain

已確認工程實作：`generate_block_hash_extra_keys()` 只在 `start_token_idx == 0` 時把 `request.cache_salt` 加進 extra_keys。因為後續 block hash包含 parent block hash，所以 salt 的 isolation effect 會沿整個 prefix hash chain傳播。

底層：

`Salt → Block0 extra_keys → Hash0 → Hash1(parent=Hash0) → Hash2 ...`

重要性：不需要每個 block 重複攜帶 tenant salt，也能讓不同 salt namespace 的所有 descendant prefix blocks 無法互相命中。

安全意義：這是 prefix-cache timing side-channel isolation boundary，而不是單純 cache busting flag。

### 5. Distributed prefix cache 的 correctness 還需要「hash reproducibility + execution compatibility」兩個條件

官方 MooncakeStoreConnector 文件確認：跨 vLLM process 共享 distributed store 時，block hash 必須可重現。現行預設固定 seed 的 hash chain可跨 process 重現；非 cryptographic `xxhash/xxhash_cbor` 路徑的 seed 行為需要一致 `PYTHONHASHSEED`。另外官方也警告：不同 tensor-parallel sizes 的 collectives/low-precision arithmetic 不保證 bitwise invariant，因此「相同 distributed key」與「重新計算會得到 bitwise 相同 KV」不是同一件事。

Hermes 應將 distributed reuse eligibility 拆成：

`KeyReproducible && SemanticCompatible && TensorLayoutCompatible && NumericalPolicyAcceptable`

而不能只有 `remote_store.contains(block_hash)`。

## Architecture Breakdown

### Multimodal Prefix Identity Pipeline

```text
Media bytes / UUID
  ↓
Processor policy
  ↓
mm_hash
  ↓
_get_mm_identifier(mm_hash, LoRA)
  ↓
Encoder identifier
  ↓
MultiModalFeatureSpec
  ├ modality
  ├ token offset
  ├ token length
  ├ mm_hash
  └ identifier
  ↓
Hash Block Intersection
  ↓
(identifier, offset-within-block)
  ↓
extra_keys
  ├ LoRA
  ├ multimodal keys
  ├ first-block cache_salt
  └ prompt-embeds SHA256
  ↓
H(parent_hash, token_ids, extra_keys)
  ↓
Prefix Block Hash
  ↓
Local BlockPool / Remote KV Store
```

### Cross-instance distributed prefix path

```text
Prefill Instance A
Prompt + MM Features
→ deterministic block hash chain
→ KV tensors
→ Mooncake distributed store

Decode / Instance B
Same logical request identity
→ reproduce block hash chain
→ remote lookup
→ compatibility check
→ fetch KV
→ continue attention/decode
```

## Bottom-Level Logic

### Exact multimodal block extra-key generation

對 hash block `[start,end)` 與 multimodal span `[offset, offset+length)`：只要兩區間相交，就加入：

`(encoder_identifier, offset - start)`

若 block 已完全越過該 multimodal span，移到下一個 mm feature；若 block 尚未到達該 span，停止掃描。這使計算接近 streaming cursor，而不是每個 block 都重掃所有 multimodal inputs。

### Exact block identity

```text
extra_keys = (
  lora_name?,
  (mm_identifier, relative_offset)*,
  cache_salt_if_first_block?,
  prompt_embedding_block_hash?
)

BlockHash_n = H(
  BlockHash_{n-1} or NONE_HASH,
  tuple(token_ids_n),
  extra_keys_n
)
```

因此 prefix identity 同時描述 lexical token content、ancestor context、multimodal computation identity/position、adapter identity、tenant isolation，以及直接 prompt embedding bytes。

### Hash granularity vs physical KV block granularity

vLLM 最新 KV cache config 還區分 scheduler block size 與 hash block size；hybrid cache groups 可透過 `prefix_match_unit` 讓 prefix match boundary 比 physical KV block 更細，只要各 group block size可整除。這代表 Knowledge Graph 不能把 `HashBlock` 與 `PhysicalKVBlock` 畫成同一節點。

## Visual Simulation Idea

### Multimodal Prefix Hash Chain Microscope

Hermes Console 新增一個可拖曳的 token/block 視圖：

```text
Tokens: [sys][text][IMG IMG IMG IMG][text][text]
Blocks: |------B0------|------B1------|------B2------|
MM span:       |-------------image-------------|
```

每個 block 展開顯示：
- parent hash
- token IDs
- `(mm_identifier, relative_offset)`
- LoRA
- cache_salt
- prompt embeds hash
- final block hash
- local/remote HIT/MISS

互動：拖動圖片 placeholder 一格，立即看到相交 block 的 extra key 改變並讓該 block及所有 descendants hash cascade change；改 tenant salt，只改 Block0 input，但整條 chain 都變色；改 tower LoRA，processor mm_hash保持相同，但 encoder identifier/prefix hash改變。

## Code / GitHub

本輪直接追的核心檔案：

- `vllm/v1/core/kv_cache_utils.py`
  - `_gen_mm_extra_hash_keys`
  - `generate_block_hash_extra_keys`
  - `hash_block_tokens`
  - `resolve_kv_cache_block_sizes`
- `vllm/v1/engine/input_processor.py`
  - `_get_mm_identifier`
  - `MultiModalFeatureSpec` construction
- `docs/features/mooncake_store_connector_usage.md`
  - reproducible block hashes
  - cross-instance distributed store
  - heterogeneous TP numerical caveat
- `vllm/config/cache.py`
  - `prefix_caching_hash_algo`
  - `prefix_match_unit`

下一輪值得追：
- MooncakeStoreConnector key construction（TP/PP/group/layer namespace）
- NIXL connector KV tensor layout metadata
- block hash serialization (`sha256` Pickle vs canonical CBOR)
- hybrid Attention/Mamba cache group identity
- model revision / KV dtype / attention backend 是否完整進 distributed namespace

## Papers

### Spatial Prefix Caching for Wireless Edge LLM Inference: A Stochastic-Geometry and Queueing Framework
Authors: Le Yang, Zhouyong Liu
Year: 2026
URL: https://arxiv.org/abs/2608.01126
Code: 本輪未確認
Architecture: distributed edge prefix cache + spatial association + queue model
Contribution: 把 remote prefix reuse 建模為距離、cache depth、GPU memory、queue load 的聯合最佳化，而非「最近節點一定最好」。
Limitations: stochastic wireless-edge model，不等同 datacenter Mooncake/NIXL runtime。
改變了什麼：補上 distributed cache placement 對 TTFT 與 queue coupling 的理論視角。

### VLCache: Computing 2% Vision Tokens and Reusing 98% for Vision-Language Inference
Authors: Shengling Qin et al.
Year: 2025
URL: https://arxiv.org/abs/2512.12977
Code: 論文稱已整合 SGLang；本輪未逐檔重驗
Architecture: vision encoder/KV reuse + layer-aware selective recomputation
Contribution: 分析非 prefix multimodal cache reuse 的 cumulative error，並以少量重算平衡 accuracy/latency。
Limitations: 它解的是 approximate/non-prefix reuse；本輪 vLLM hash chain主要討論 exact identity reuse，兩者不可混為同一 correctness contract。
改變了什麼：指出未來 cache planner 不只二元 HIT/MISS，還可能選擇 approximate reuse + selective recomputation。

## Unknown / Open Questions

1. Mooncake/NIXL distributed KV object key除了 block hash之外，究竟如何完整 namespace TP/PP/layer/KV dtype/model revision；哪些 metadata只影響 storage layout而不進 semantic key？
2. `sha256_cbor` 的 canonical cross-language serialization能否成為 Hermes 跨 Runtime（Python/Rust/TS）統一 Prefix Identity 的基礎，並避免 Pickle implementation coupling？
3. Hybrid KV groups、DCP 與 `prefix_match_unit` 下，一個 logical HashBlock 如何映射到多組 physical KV blocks與 remote objects？

## 下一輪研究

`MooncakeStoreConnector object key × NIXL KV layout × TP/PP/DCP namespace × sha256_cbor canonical identity × Hybrid KV cache groups × model/KV-dtype revision invalidation`

下一輪目標：從「可重現 prefix hash」繼續追到「remote store 中實際哪個 object/key/offset 保存哪一層 KV tensor」，建立：

`Logical Prefix Identity → Distributed Object Identity → Tensor Layout Identity → Physical Remote Address/Transfer → Local KV Block`

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `PrefixHashChain`
- `AncestorBlockIdentity`
- `MultimodalBlockExtraKey`
- `BlockRelativeMediaOffset`
- `EncoderIdentifier`
- `ProcessorMMHash`
- `FirstBlockCacheSalt`
- `SaltDescendantPropagation`
- `PromptEmbedBlockHash`
- `HashBlock`
- `PhysicalKVBlock`
- `PrefixMatchUnit`
- `CrossProcessHashReproducibility`
- `DistributedPrefixStore`
- `RemoteReuseCompatibility`
- `NumericalReusePolicy`

新增 Edges：
- `ProcessorMMHash → EncoderIdentifier`
- `LoRA → EncoderIdentifier`
- `EncoderIdentifier + BlockRelativeMediaOffset → MultimodalBlockExtraKey`
- `MultimodalBlockExtraKey → PrefixHashChain`
- `cache_salt → FirstBlockHash`
- `FirstBlockHash → DescendantBlockIdentity`
- `HashBlock → maps_to → PhysicalKVBlock`
- `PrefixHashChain → DistributedPrefixStoreKey`
- `CrossProcessHashReproducibility → enables → RemotePrefixHit`
- `RemotePrefixHit → requires → ExecutionCompatibility`

## 本輪結束檢查

缺哪一層：`Logical Prefix Block Hash → remote Mooncake/NIXL object/tensor layout/address`。

哪個節點最淺：`RemoteReuseCompatibility`，目前已知道 TP/低精度可能造成 numerical divergence，但完整 compatibility signature 尚未還原。

哪個概念仍只是名詞：跨 framework 的 `CanonicalDistributedComputationIdentity`。

哪個系統值得讀原始碼：vLLM MooncakeStoreConnector、NIXL KV connector 與 hybrid KV cache manager。

哪篇論文需追引用：VLCache，尤其 approximate visual/KV reuse 與 selective recomputation 後續工作；另追 Spatial Prefix Caching 的 distributed placement model。

哪個概念最適合視覺模擬：`Multimodal Prefix Hash Chain Microscope`。

哪個 Agent 架構最值得實作：對 Hermes 而言仍是 `Request-Aware Physical Execution Planner`，但新增 `Cache Identity/Compatibility Planner` 子系統，讓 Agent 能解釋「為什麼這個 request 可以 reuse 哪一層 state、哪一層必須重算」。

## 本輪狀態標記

- 已確認事實：vLLM block hash tuple、MM extra key、LoRA encoder identifier、first-block cache_salt、hash/scheduler block granularity。
- 官方資訊：Mooncake distributed prefix store 的 cross-process hash reproducibility與 heterogeneous TP caveat。
- 論文結果：Spatial Prefix Caching、VLCache 的各自 workload 結果。
- 工程推論：`KeyReproducible && SemanticCompatible && TensorLayoutCompatible && NumericalPolicyAcceptable` 作為 Hermes remote reuse eligibility contract。
- 尚未驗證假說：完整跨 model revision/KV dtype/backend 的 distributed object namespace已被現行 connector充分編碼；下一輪必須以原始碼驗證。