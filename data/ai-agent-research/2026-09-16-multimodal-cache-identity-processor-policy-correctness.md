# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-16 17:56 Asia/Taipei

## 本小時新發現
本輪延續上一輪 Qwen2.5-VL `Raw Pixels → Smart Resize → grid_thw → visual tokens`，不重複 token geometry，而往下一個缺口：**同一 media bytes 在不同 processor policy / model / LoRA 下，multimodal cache 如何避免錯誤 hit？**

新架構：`Media Identity → Processing Identity → Encoder Identity` 三層 cache identity。

新 GitHub 原始碼：vLLM `vllm/multimodal/processing/inputs.py`、`vllm/multimodal/cache.py`、`vllm/v1/engine/input_processor.py`。

## 本小時最重要 5 個發現

### 1. Multimodal cache key 不是只 hash 圖片 bytes
**已確認工程實作。** vLLM `ProcessorInputs.get_mm_hashes()` 對每個 modality 建立 hash factors，包含 `model_id`、media item、該 modality 的 `media_io_kwargs` 與 `mm_processor_kwargs`。因此 resize、video sampling、processor override 等會影響處理結果的 policy 可以進入 cache identity。

底層：
`Media Item/UUID → modality scope → media_io_kwargs + mm_processor_kwargs → model_id → MultiModalHasher.hash_kwargs → mm_hash`

這直接回答上一輪 open question：目前 vLLM 主線已明確把 processor/media-I/O factors 納入 hash，而不是單純 content hash。

限制：若 processor 行為改變但 model_id / processor kwargs 沒有反映版本差異，仍需確認部署層是否以 model revision/runtime revision 做隔離。

來源：vLLM `vllm/multimodal/processing/inputs.py`；vLLM multimodal config/docs。

### 2. Client UUID 不是無條件信任
**已確認工程實作。** 即使 client 提供 `multi_modal_uuid`，只要存在 hash factors，vLLM 仍會把 UUID 當 item identity 再與 model_id / processor factors 重新 hash。只有完全沒有額外 factors 時才直接使用 UUID。

底層：
`Client UUID → has processor factors? → YES: hash(UUID + factors) / NO: UUID directly`

重要性：stable ID 能省 raw-content rehash 成本，但不能讓使用者用相同 UUID 跨不同 resize/FPS policy 誤 hit。

### 3. Processor cache 與 Encoder-output cache 是不同 correctness domain
**已確認工程實作。** vLLM processor cache 以 `mm_hash` 儲存 processor tensor/metadata；encoder feature cache同樣可由 mm_hash 分享，但 `input_processor.py` 額外處理 tower/connector LoRA：當 LoRA 能改變 multimodal embeddings 時，identifier 會變成 LoRA-specific identity。

底層：
`raw media → mm_hash → processed tensors`
`mm_hash + encoder-affecting LoRA → encoder identifier → encoder embeddings`

因此不能把所有 multimodal cache 都畫成一個盒子。

### 4. 分散式 multimodal cache 需要 stale-shadow recovery
**已確認工程實作。** vLLM 的 P0/P1 cache 可以只在 sender 保存 key/metadata、receiver 保存 tensor data。若 P0 誤以為 P1 已有 item 而送 `None`，P1 會丟出 `MultiModalCacheMissError`；sender 可 invalidate stale shadow，下一次重新傳資料。

底層：
`P0 shadow hit → omit payload → P1 lookup → miss → retryable cache-miss → invalidate P0 shadow → resend payload → repopulate P1`

重要性：cache correctness 不只關於 hash collision，也包含 distributed cache coherence。

### 5. Hashing 本身已成為可測量的 multimodal latency stage
**官方 benchmark。** vLLM multimodal processor benchmark分別量測 `get_mm_hashes_secs`、cache lookup、HF processor、prompt updates、encoder forward 與 end-to-end latency。這表示 identity 設計本身也有成本：大型 media 若每次 content hashing，CPU/IO latency 可能不可忽略；stable UUID 是效能 optimization，但必須保留 policy correctness。

## Architecture Breakdown

```text
Request
→ Media Bytes / Stable UUID
→ Modality Parser
→ Modality-scoped Processor Policy
   ├ media_io_kwargs
   └ mm_processor_kwargs
→ model_id
→ MultiModalHasher
→ mm_hash
→ Processor Cache
   ├ hit → processed tensor/metadata
   └ miss → HF Processor → cache insert
→ Encoder Identity
   ├ normal: mm_hash
   └ encoder-affecting LoRA: LoRA + mm_hash
→ Vision/Audio/Video Encoder
→ Encoder Feature Cache
→ Projector / Fusion
→ LLM Prefill
→ KV Cache
→ Decode
```

分散式 cache：

```text
API/P0
├ key / metadata shadow
└ payload only on miss
        ↓ IPC
Engine/P1
└ processed tensor cache

shadow drift
→ receiver miss
→ retryable error
→ sender invalidation
→ resend
```

## Bottom-Level Logic

建議 Hermes 將 multimodal identity 拆成：

`MediaContentIdentity = H(media bytes or trusted stable UUID)`

`ProcessingIdentity = H(model_id, MediaContentIdentity, modality, media_io_kwargs, mm_processor_kwargs)`

`EncoderIdentity = H(ProcessingIdentity, encoder_revision, encoder_affecting_adapter_state)`

這是基於 vLLM 現行實作抽象出的可移植模型；`encoder_revision` 顯式加入 key 是 Hermes 的設計建議，不代表 vLLM 現行 key 就一定有獨立此欄位。

Correctness invariant：

`CacheHit(A,B) is safe only if Process(A) == Process(B)`

所以只要任一會改變 processor tensor / encoder embedding 的因素改變，就必須形成不同 identity 或隔離 namespace。

## Visual Simulation Idea
### Multimodal Cache Identity & Coherence Simulator

左側輸入：同一圖片 bytes、UUID、max_pixels、FPS、crop、processor kwargs、model revision、LoRA。

中央即時顯示：
`Content ID → Processing ID → Encoder ID`

右側畫三層 cache：
`Processor Cache / Encoder Cache / Decoder KV Cache`

可切 P0/P1 distributed mode，故意製造 stale shadow，動畫展示：
`P0 hit → P1 miss → MultiModalCacheMissError → invalidate → resend → recover`。

關鍵指標：hash time、processor hit rate、encoder hit rate、bytes avoided、stale recoveries、false-hit risk flags。

## Code / GitHub
值得繼續追：
- `vllm/multimodal/processing/inputs.py`：`ProcessorInputs.get_mm_hashes`，真正的 multimodal hash-factor construction。
- `vllm/multimodal/hasher.py`：canonical serialization/hash implementation。
- `vllm/multimodal/cache.py`：P0/P1 processor cache、shared-memory cache、encoder feature cache coherence。
- `vllm/v1/engine/input_processor.py`：LoRA-sensitive encoder identifier。
- `vllm/config/multimodal.py`：processor kwargs/cache/hash algorithm configuration。
- `tests/multimodal/test_processing.py`：應追 processor kwargs 是否真的造成不同 hash 的 correctness tests。

## Papers / Technical Sources
本輪重點屬 runtime correctness，主要證據來自 vLLM 官方原始碼與文件，而不是以論文 benchmark 為主。下一輪再加入 multimodal prefix/embedding cache 與 semantic caching 論文比較。

## Unknown / Open Questions
1. `model_id` 在實際部署是否穩定包含 checkpoint revision/processor revision；若同 repo ID 原地更新 processor code，cache namespace 如何安全失效？
2. `MultiModalHasher` 對 PIL image、video frames、tensor、URL/downloaded bytes 的 canonicalization 是否完全一致；EXIF orientation/color profile/decode backend 是否可能造成「同 bytes、不同 tensor」？
3. Encoder-output cache、prefix cache、distributed encoder deployment之間是否共享同一 identity，哪些 adapter/connector state 必須加入 identifier？

## 下一輪研究
**MultiModalHasher canonical serialization × Model/Processor Revision × EXIF/Decode Semantics × Encoder Cache Invalidation × Prefix Cache Identity × Disaggregated Encoder Cache**。

下一輪要追到：
`JPEG bytes → decoder → pixel tensor → hash/canonical identity → processor revision → encoder identity → distributed encoder → prefix/cache reuse`，並找出所有可能讓「看似同一 media」實際產生不同 embedding 的因素。

## Knowledge Graph 新增 Node / Edge
新增 Nodes：
`MediaContentIdentity`, `ProcessingIdentity`, `EncoderIdentity`, `MultiModalHasher`, `ModalityScopedHashFactor`, `MediaIOPolicy`, `ProcessorPolicy`, `StableMediaUUID`, `ProcessorCache`, `EncoderFeatureCache`, `LoRASensitiveEncoderIdentity`, `DistributedCacheShadow`, `MultiModalCacheMissRecovery`, `CacheCoherenceInvariant`, `ProcessorRevisionNamespace`, `HashingLatencyStage`。

新增 Edges：
- `MediaBytes → MediaContentIdentity`
- `StableMediaUUID → MediaContentIdentity`
- `MediaContentIdentity + ProcessorPolicy + model_id → ProcessingIdentity`
- `ProcessingIdentity → ProcessorCacheKey`
- `ProcessingIdentity + EncoderAdapterState → EncoderIdentity`
- `EncoderIdentity → EncoderFeatureCacheKey`
- `ProcessorPolicyChange → ProcessingIdentityChange`
- `EncoderAffectingLoRA → EncoderIdentityChange`
- `P0ShadowHit + P1Miss → CacheCoherenceRecovery`
- `CacheCoherenceRecovery → ShadowInvalidation → PayloadResend`

## 本輪結束判斷
- 缺哪一層：media decoder/canonicalization 到 hash identity 的 exact semantics。
- 哪個節點最淺：`ProcessorRevisionNamespace`。
- 哪個概念仍只是名詞：跨 framework 的 `EncoderIdentity` 標準化。
- 哪個系統值得讀原始碼：vLLM `multimodal/hasher.py` + `cache.py` + `input_processor.py`。
- 哪篇論文需追引用：下一輪補 semantic/prefix multimodal cache papers，本輪不強行用論文替代 runtime source。
- 哪個概念最適合視覺模擬：`Multimodal Cache Identity & Coherence Simulator`。
- 哪個 Agent 架構最值得實作：在 Hermes Runtime 加入 `Perception Cache Identity Inspector`，讓每個 multimodal request 能解釋「為何 hit/miss、哪些 policy 進入 key、哪一層 cache 被重用」。

## 已確認 / 推論界線
已確認：vLLM hash 包含 model_id、media item/UUID、modality-scoped media I/O kwargs 與 processor kwargs；存在 processor cache、encoder feature cache、LoRA-sensitive encoder identifier與 P0/P1 stale-cache recovery。

合理工程建模：Hermes 的三層 `MediaContentIdentity → ProcessingIdentity → EncoderIdentity` 與顯式 `encoder_revision` namespace。

尚未驗證：所有 processor/runtime revision 是否已被 vLLM 的 model_id/部署 namespace完整覆蓋，以及不同 media decoder backend 的 canonicalization correctness。
