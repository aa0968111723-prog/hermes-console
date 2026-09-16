# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 18:53（Asia/Taipei）

主題：Media Canonicalization × MultiModalHasher × Prefix Cache Identity × Disaggregated Encoder Cache

## 本小時新發現

本輪接續上一輪 `Media Bytes → Decoder → Pixel/Frame Tensor → Canonicalization → Hash Identity` 缺口，直接追 vLLM 最新 `vllm/multimodal/hasher.py`、multimodal cache、安全文件、prefix caching 與 disaggregated encoder 文件。

本輪確認一個重要修正：multimodal cache identity 並不存在單一「canonical media representation」。vLLM 會依輸入物件型別選擇不同 serialization path：PIL Image 主要 hash 解碼後 mode + ndarray pixels（若有 EXIF ImageID 則可直接使用 ImageID）；MediaWithBytes<Image> 在存在 io_config 時則 hash io_config + original_bytes；video MediaWithBytes 則在 decoded frames 比 original bytes 更小時 hash frames，否則 hash original bytes。這代表 identity 是 runtime representation-aware，而不是純檔案 bytes identity。

## 本小時最重要 5 個發現

### 1. MultiModalHasher 是 typed serialization graph，不只是 `hash(bytes)`

已確認工程實作：`MultiModalHasher.serialize_item()` 對 bytes/string/numeric/PIL Image/MediaWithBytes/Tensor/ndarray 採不同 serialization。kwargs 先依 key 排序；dict/list 再遞迴加入 path key，最後才進 BLAKE3/SHA256/SHA512。

底層：

`Object → Type Dispatch → Structural Key Path → dtype/shape/mode/palette/io_config/data → byte stream → cryptographic/non-FIPS selected hash`

重要性：cache correctness 依賴「資料 + 會改變處理結果的 policy」是否真的都進 identity graph。

限制：dict traversal 保留 dict insertion order；未知 Python object fallback 到 pickle，因此不是全面 cross-language canonical format。

來源：vLLM `vllm/multimodal/hasher.py`；vLLM multimodal config/docs。

### 2. JPEG bytes 相同不等於 runtime identity 永遠相同；反過來 bytes 不同也可能得到相同 pixel identity

已確認工程實作：PIL Image path hash `mode + np.asarray(image)`，因此兩個不同 JPEG encodings 若 decode 成相同 pixels/mode，可以共享 pixel-level identity；但 MediaWithBytes<Image> 可選 original_bytes + io_config path。EXIF ImageID 若是 UUID 還能直接覆蓋 image serialization identity。

合理推論：cache identity 的 equivalence relation 取決於 media 進入 runtime 的 representation boundary。

這回答上一輪問題的一部分：EXIF orientation、decoder backend 是否影響 cache，不能只看 JPEG bytes；必須看它們在 hash 前是否已反映到 PIL pixels、io_config 或 processor hash factors。

### 3. Stable UUID 是 performance optimization，也是 security boundary

官方資訊：vLLM 允許 `multi_modal_uuids` 避免每次重新 hash 大型 media，但要求 UUID 對不同 media 唯一。最新 security 文件明確指出 UUID collision/reuse 可造成 integrity/confidentiality 問題，影響 multimodal processor cache、encoder output cache 與 prefix cache block hashes。

因此：

`Untrusted UUID → Cache Identity Alias → Wrong Encoder/Processor Reuse → Integrity/Confidentiality Failure`

在 multi-tenant 系統，UUID 必須視為 capability-like identity input，而不是普通 metadata。

### 4. Multimodal identity 最後還會進 Prefix KV Cache；cache_salt 提供 tenant isolation

官方資訊：vLLM prefix cache 支援 cache salt；salt 混入第一個 KV block hash，只有相同 salt 的 request 能共享 prefix cache。最新 prefix cache config 支援 SHA256 + Pickle，也支援 canonical CBOR + SHA256，以及 xxHash variants。

系統鏈：

`Media Identity → Visual Placeholder/Tokens → Prefix Block Identity → KV Prefix Cache`

安全鏈：

`Tenant Secret Salt → First Prefix Block Hash → Descendant Block Hash Chain → Cross-tenant Reuse Isolation`

重要性：Perception cache identity 與 decoder KV cache identity 並非兩個完全獨立世界，它們在 multimodal prompt/prefix 層重新相遇。

### 5. Encoder Cache 正在從 local optimization 變成可分散式服務層

官方資訊：vLLM Disaggregated Encoder 將 vision encoder 從 prefill/decode process 分離，可獨立擴縮並跨 process reuse encoder outputs。最新 CPU EC Connector 進一步把 `encoder_cache[mm_hash]` offload 到 `/dev/shm` CPU tier，GPU↔CPU copy 可非同步；啟用 NIXL 時 consumer instance 可從 producer CPU tier P2P 拉 encoder output，而不是重新 encode。

架構：

`Media → Identity → Encoder Fleet → GPU Encoder Cache → CPU Shared Cache → NIXL Remote Cache → Prefill Fleet → Decode Fleet`

這使 `mm_hash` 從 local dictionary key 升級成 distributed computation identity。

## Architecture Breakdown

### Multimodal Identity / Cache System

```text
Media Source
  ↓
Representation Boundary
  ├ raw bytes
  ├ PIL Image
  ├ decoded video ndarray/tensor
  └ stable UUID
  ↓
MultiModalHasher serialization
  ├ type
  ├ mode / dtype / shape
  ├ pixels / frames / original bytes
  ├ palette
  ├ io_config
  ├ model_id
  └ processor kwargs
  ↓
mm_hash
  ├ Processor Cache
  ├ Encoder Feature Cache
  └ Multimodal Prefix Identity
       ↓
     KV Prefix Cache
       ↓
     cache_salt isolation
```

### Disaggregated Encoder Cache

```text
Frontend / P0
→ mm_hash
→ Processor Cache
→ Encoder Scheduler
→ Encoder Worker
→ GPU Encoder Output
→ GPU EC
→ optional CPU /dev/shm EC
→ optional NIXL remote pull
→ Prefill Worker
→ visual embedding injection
→ KV Prefix Cache
→ Decode
```

## Bottom-Level Logic

### MultiModalHasher

```text
kwargs
→ sort top-level keys
→ iter_item_to_bytes(key,value)
→ recursively append structural key path
→ serialize typed value
→ hasher.update(chunk)*
→ digest
```

PIL image:

```text
Image
→ try EXIF ImageID UUID
├ hit → UUID bytes
└ miss
   → mode
   → ndarray pixels
   → optional palette/rawmode
   → hash
```

MediaWithBytes image:

```text
media + original_bytes
→ EXIF ImageID?
├ yes → UUID
└ no
   ├ io_config exists → hash(io_config + original_bytes)
   └ no io_config → hash(original_bytes)
```

Video:

```text
MediaWithBytes(video)
→ decoded frames nbytes < encoded bytes length?
├ yes → hash decoded frames
└ no → hash original encoded bytes
```

這個 size-based choice 很值得下一輪進一步驗證：它是 hashing cost optimization，但也意味同一語意 media 的 identity boundary 可能受 representation/size path 影響。

## Visual Simulation Idea

### Media Identity → Distributed Cache Simulator

互動輸入：
- JPEG/PNG bytes
- EXIF ImageID / orientation
- decode backend
- PIL vs MediaWithBytes path
- resize/max_pixels/FPS
- processor kwargs
- stable UUID
- model revision
- cache_salt / tenant
- encoder cache topology：GPU / CPU / remote

視覺流程：

```text
FILE BYTES
   ↓
DECODER
   ↓
RUNTIME REPRESENTATION
   ↓
HASH SERIALIZATION TREE
   ↓
mm_hash
 ┌─┼───────────┐
 ↓ ↓           ↓
P0 P1       Encoder Cache
             ↓
        GPU → CPU → NIXL Remote
             ↓
         Prefix KV Cache
```

畫面應顯示：哪一個欄位改變造成 hash 改變；哪些改變未被 identity 捕捉；cache hit/miss；錯誤 UUID alias；tenant salt 是否阻止 prefix reuse；remote cache transfer bytes vs recompute cost。

## Code / GitHub

重點原始碼：
- `vllm/multimodal/hasher.py`：typed serialization、EXIF ImageID、PIL pixels、MediaWithBytes、video frames、Tensor/ndarray、hash kwargs。
- `vllm/multimodal/processing/inputs.py`：model_id、media_io_kwargs、mm_processor_kwargs 與 media/UUID 組合 identity。
- `vllm/multimodal/cache.py`：P0/P1 mirrored cache、receiver feature update、miss recovery。
- encoder cache / disaggregated encoder connectors：值得下一輪繼續讀 scheduler、connector、NIXL transfer 與 cache eviction。

## Papers / Technical Sources

本輪核心證據主要是 production runtime 原始碼與官方技術文件，而非單篇論文：
- vLLM MultiModalHasher source（2026 current main）
- vLLM Multimodal Inputs / Security / Cache API
- vLLM Automatic Prefix Caching / Cache config
- vLLM Disaggregated Encoder
- vLLM CPU Encoder Cache Connector

這一輪的改變不是提出新模型，而是把「multimodal identity」從概念拆成 production serialization、security、distributed cache coherence 與 recompute avoidance。

## 已確認 / 推論 / 尚未驗證

已確認：vLLM typed hashing paths、EXIF ImageID shortcut、PIL pixel serialization、MediaWithBytes original-byte/io-config path、video frame-vs-byte choice、stable UUID security要求、cache_salt、disaggregated encoder、CPU EC/NIXL。

合理推論：Hermes 應建立 `CanonicalPerceptionIdentity`，但它不能假設所有框架都有單一 canonical representation；應記錄 representation boundary 與 processor/runtime revision。

尚未驗證：不同 PIL/libjpeg/ffmpeg/torchvision 版本是否能在相同 source bytes 上產生 bit-identical tensors；model/processor revision 是否在所有 production cache key 中被充分 namespace；NIXL encoder cache 的完整 consistency protocol。

## Unknown / Open Questions

1. 同一 JPEG bytes 在不同 libjpeg/Pillow/EXIF handling version 下產生不同 pixel tensor時，現行 stable UUID 路徑如何防止跨版本 stale encoder reuse？
2. Disaggregated Encoder 的 remote encoder-cache identity 是否包含足夠的 model revision / vision tower revision / adapter revision namespace？
3. Prefix KV cache 中 multimodal block identity與 encoder cache identity在 partial-block、placeholder fragmentation、adapter切換時如何維持一致 correctness invariant？

## 下一輪研究

`Disaggregated Encoder × Encoder Cache Connector × NIXL × Cache Namespace/Revision × Prefix Cache Multimodal Block Hash × Partial Block Identity × Cross-Instance Correctness`

優先追：
1. vLLM encoder cache connector 原始碼與 scheduler。
2. multimodal prefix cache block hash 如何攜帶 media identity。
3. model/processor/adapter revision 如何進 cache namespace。
4. remote encoder cache stale entry / eviction / transfer failure recovery。
5. 建立 `PerceptionCacheCorrectnessInvariant`。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `RuntimeMediaRepresentation`
- `TypedMediaSerialization`
- `PILPixelIdentity`
- `OriginalByteIdentity`
- `EXIFImageIDIdentity`
- `VideoFrameIdentity`
- `RepresentationBoundary`
- `MediaIdentityAliasRisk`
- `TenantCacheSalt`
- `MultimodalPrefixIdentity`
- `DisaggregatedEncoder`
- `EncoderCacheTier`
- `CPUEncoderCache`
- `RemoteEncoderCache`
- `NIXLEncoderTransfer`
- `CanonicalPerceptionIdentity`

新增 Edges：
- `RuntimeMediaRepresentation → TypedMediaSerialization`
- `EXIFImageID → MediaIdentity`
- `ProcessorPolicy → ProcessingIdentity`
- `MediaIdentity → ProcessorCache`
- `MediaIdentity → EncoderCache`
- `MediaIdentity → PrefixBlockHash`
- `TenantCacheSalt → PrefixIsolationBoundary`
- `EncoderCache → CPUEncoderCache → RemoteEncoderCache`
- `RemoteEncoderCache → AvoidEncoderRecompute`
- `UUIDCollision → CacheIdentityAlias → IntegrityRisk`

## 本輪結束判斷

缺哪一層：`distributed encoder cache identity namespace → revision/invalidation → prefix KV identity`。

哪個節點最淺：`CanonicalPerceptionIdentity`，因為不同 representation path 並不真正 canonical。

哪個概念仍只是名詞：`ProcessorRevisionNamespace`，需要找到實際 production key/invalidation code。

哪個系統值得讀原始碼：vLLM Disaggregated Encoder + Encoder Cache Connector + NIXL path。

哪篇論文需追引用：本輪以工程原始碼為主；下一輪應補 encoder disaggregation / multimodal serving systems 相關研究，與 production implementation 交叉驗證。

哪個概念最適合視覺模擬：`Media Identity → Distributed Cache Simulator`。

哪個 Agent 架構最值得實作：對 Hermes 而言是 `Perception Cache-Aware Agent Runtime`：Agent 收到 image/video 時先建立 processing identity、估算 encoder reuse、選 local/remote/recompute path，再把 perception state 注入 reasoning context。

## 對「AI 到底怎麼運作」新增的一段

```text
JPEG / MP4
→ Runtime Representation
→ Typed Serialization / Identity
→ Processor Cache
→ Decode / Resize / Frame Sampling
→ Vision Encoder
→ Encoder Feature Cache
→ GPU / CPU / Remote Cache Tier
→ Visual Embeddings
→ Prefix Identity
→ KV Cache
→ LLM Reasoning
→ Agent Planning
→ Tool / MCP
→ Action
```

核心結論：production 多模態 AI 的「一張圖片」不是單一物件。它至少同時存在 file bytes、decoded representation、processing identity、encoder computation identity、prefix identity 與 tenant isolation identity。只有把這些 identity 與 cache tier 串起來，才能真正回答為什麼某次 request 需要重新跑 vision encoder、另一次卻能直接 reuse，以及 reuse 何時會從效能優化變成 correctness 或 security 風險。