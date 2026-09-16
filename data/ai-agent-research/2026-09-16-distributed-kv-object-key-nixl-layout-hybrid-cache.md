# 【AI Agent × Multimodal Research Report】

時間：2026-09-16 21:53（Asia/Taipei）

主題：Mooncake Distributed KV Object Key × NIXL Compatibility/Layout × Hybrid KV Cache Groups × Canonical Prefix Identity

## 本小時新發現

本輪延續上一輪「Multimodal Prefix Hash Chain → Distributed Physical AI State」，不再重複討論 visual-token geometry、encoder cache 或 prefix extra keys，而是追蹤 logical block hash 如何成為跨 instance 的實體 KV object，並研究 NIXL 在真正搬移 tensor 前如何判斷兩端 layout/模型/runtime 是否相容。

已確認：MooncakeStore 的 distributed key 並不是只有 block hash。vLLM `KeyMetadata` 包含 model_name、TP/PCP/DCP/PP rank、KV cache group、cache_prefix，以及目前原始碼中的 store_namespace；`PoolKey` 再把這個 namespace 與 chunk_hash 組成最終 object key。

已確認：NIXL 不把「hash 相同」視為足夠條件。握手 compatibility hash 包含 vLLM/NIXL version、model、dtype、KV heads/head size/layers、attention backend、cache dtype、HMA、speculative state 與 push/pull transfer mode。TP size、block size、KV layout 則刻意不放入 static hash，而在 runtime handshake 驗證，以允許合法 heterogeneous deployment。

已確認：Hybrid KV Cache 的 logical block 與 physical memory 並非一對一。多種 attention/cache type 會形成 KVCacheGroup；一個 logical block 可能映射到多個 layer-specific physical pieces，因此 distributed reuse 必須知道 group/layout，而不能只有 token-prefix identity。

## 本小時最重要 5 個發現

### 1. Distributed KV Object Identity = Semantic Prefix Identity + Physical Namespace

概念：Prefix hash 回答「這是哪段計算歷史」，Mooncake key 還要回答「這是哪個模型、哪個平行 rank、哪個 cache group 的實體 state」。

底層：

```text
Prompt / Multimodal Prefix
→ Prefix Hash Chain
→ Chunk Hash
→ KeyMetadata
   ├ model_name
   ├ cache_prefix
   ├ store_namespace
   ├ TP rank
   ├ PCP rank
   ├ DCP rank
   ├ PP rank
   └ group_id
→ PoolKey
→ Distributed Store Object
```

重要性：相同 semantic prefix 在不同 PP/group/rank 上代表不同 tensor slice，不能錯誤 alias。

限制：Mooncake key namespace 是 vLLM/Mooncake 的工程實作，不代表所有 KV systems 都採同一 schema。

### 2. Canonical CBOR 解決 serialization reproducibility，不等於 tensor compatibility

vLLM `sha256_cbor` 使用 canonical CBOR + SHA-256，使 prefix hash 可重現且跨語言；`xxhash_cbor` 同樣 canonical serialization，但碰撞安全性較低。MooncakeStore 又要求所有共享 store 的 process 產生一致 block hashes；非密碼學 xxhash seed 必須協調。

```text
Semantic Inputs
→ Canonical Serialization
→ Reproducible Hash
≠
Guaranteed Reusable Tensor
```

真正 remote reuse 還需要 physical/runtime compatibility。

### 3. NIXL 建立第二層 Compatibility Identity

NIXL 的 compatibility hash 是 computation-state contract，而非 prompt identity：

```text
vLLM version
+ connector version
+ model architecture
+ model dtype
+ KV heads/head size/layers
+ attention backend
+ KV cache dtype
+ HMA mode
+ speculative config
+ transfer mode
→ Compatibility Hash
```

如果不一致，transfer 在真正 tensor decode/搬移前就應拒絕。

### 4. Heterogeneous TP/Block Size 是 Layout Transformation 問題

NIXL 刻意允許某些 TP size / block size 不同的 P/D pair；這些不是被 compatibility hash 直接禁止，而由 runtime metadata 驗證。非 MLA 模型預設可用 LBHNC head-major layout；LBNHC token-major 的 heterogeneous TP head splitting 受限。Hybrid/Mamba 又有更嚴格限制。

因此：

```text
Remote KV Object
→ Compatibility Handshake
→ Rank/Head Mapping
→ Remote Block Mapping
→ Optional Layout Permute
→ NIXL Transfer
→ Local Physical Block IDs
```

### 5. Hybrid KV Cache 使「一個 prefix block」變成多組 physical state

Full attention、sliding-window、Mamba/SSM 等可被拆成不同 KVCacheGroup。Hybrid coordinator 對各 group 找 cache hit，再求可共同重用的 prefix；physical memory 可讓不同 group 的 layers 分享 backing buffers，但用不同 block pieces。

這表示 Digital Twin 必須區分：

```text
HashBlock
→ KVCacheGroup logical block
→ Layer-state pieces
→ Physical backing slab
```

不能再把 Prefix Block 畫成單一 GPU tensor。

## Architecture Breakdown

```text
User Prompt + Image/Video
→ Multimodal Processing Identity
→ Encoder Feature Identity
→ Token / Visual Prefix
→ Prefix Hash Chain
→ Hash Block
→ KVCacheGroup Coordinator
→ Chunk Hash
→ Distributed Key Builder
→ Mooncake Store Namespace
→ Remote KV Object
→ NIXL Handshake
→ Compatibility Hash
→ Rank / Group / Layout Mapping
→ Remote Memory Transfer
→ Local Physical KV Blocks
→ Attention / Decode
→ Agent Reasoning
→ Tool / MCP / Action
```

## Bottom-Level Logic

### Mooncake key construction

```text
key_prefix =
[cache_prefix@]
model_name
store_namespace
@tp_rank:X
@pcpY
@dcpZ
@pp_rank:P
@group:G

final_key = key_prefix + '@' + chunk_hash
```

因此 `chunk_hash` 是 semantic lineage，rank/group namespace 是 physical ownership/layout lineage。

### NIXL reuse gate

```text
Remote Candidate
→ Compatibility Hash Match?
  NO → reject
  YES
→ Runtime layout validation
→ block-size / TP / region mapping legal?
  NO → reject
  YES
→ compute remote/local block mapping
→ transfer KV bytes
→ install into local physical blocks
```

### Hybrid cache mapping

```text
Prefix Hash
→ Group 0: Full Attention blocks
→ Group 1: Sliding Window blocks
→ Group 2: Sliding Window blocks
→ fixed-point longest reusable prefix
→ physical backing pieces per layer/group
```

## Visual Simulation Idea

### Distributed KV State Microscope

互動輸入：prompt tokens、image position、prefix hash algorithm、cache_salt、TP/PP/DCP/PCP、KV dtype、attention backend、block size、KV layout、hybrid cache groups。

畫面分五層：

1. Semantic Hash Chain：Block0 → Block1 → Block2。
2. Namespace Builder：model/rank/group/cache_prefix/store_namespace。
3. Remote Store：顯示實際 PoolKey/object。
4. NIXL Compatibility Gate：逐項亮出 compatible / incompatible factors。
5. Physical GPU Layout：remote block → head/rank mapping → local block → layer/group backing slab。

最值得做的互動：把 TP 4 改成 TP 2，讓使用者看到 semantic hash 不變，但 physical shard mapping 改變；再把 KV dtype FP16 改成 FP8，直接讓 compatibility gate 拒絕 reuse。

## Code / GitHub

重點原始碼：

- `vllm/distributed/kv_transfer/kv_connector/v1/mooncake/store/data.py`：KeyMetadata、PoolKey、StoreLayout。
- `vllm/distributed/kv_transfer/kv_connector/v1/mooncake/store/connector.py`：distributed KV pool orchestration。
- `vllm/distributed/kv_transfer/kv_connector/v1/nixl/metadata.py`：NIXL handshake metadata 與 compatibility hash。
- `vllm/v1/core/kv_cache_utils.py`：KVCacheGroup、packed physical allocation、prefix hash extra keys。
- `vllm/v1/core/kv_cache_coordinator.py`：HybridKVCacheCoordinator 與跨 group prefix hit。

## Papers / Technical Sources

本輪以 production source code/官方 architecture docs 為主，因研究問題是 object identity、layout contract 與 transfer correctness；沒有把尚未直接對應這些 code paths 的論文結果硬套進實作。

值得追引用的研究線：disaggregated prefill/decode、distributed KV cache、heterogeneous parallel KV transfer、hybrid attention-state virtualization。

## 已確認 / 推論 / 假說

已確認：Mooncake PoolKey 的 rank/group namespace；canonical CBOR hash option；Mooncake cross-process hash reproducibility；NIXL compatibility factors；Hybrid KV cache group/physical mapping。

工程推論：Hermes 應把 semantic identity、compatibility identity、physical location identity 分成三個 Knowledge Graph 層級。

尚未驗證假說：跨不同 serving framework 是否能建立真正 portable 的 `CanonicalDistributedComputationIdentity`；即使 canonical prefix hash 相同，目前也沒有證據表示 vLLM/TensorRT-LLM/SGLang 的 KV tensor 可直接互換。

## Unknown / Open Questions

1. `store_namespace` 的完整生成規則如何把 payload format/model revision/layout evolution 編碼進 key namespace？
2. NIXL heterogeneous TP 在 GQA/MQA/MLA 下的 exact head→rank→remote region mapping 如何實作？
3. Dynamic FP8 KV scales 尚不能隨 NIXL KV 一起搬移時，應如何建立 scale-aware distributed state identity？

## 下一輪研究

直接追：NIXL remote region registration → memory descriptor → block offset calculation → heterogeneous TP head splitting → LBHNC/LBNHC physical address mapping → GPU DMA/NIXL transfer path；並追 Mooncake `StoreLayout` subclasses 如何把 logical chunk hash 轉成 shard keys。

下一輪目標：把

```text
Distributed Object Key
→ Remote Memory Region
→ Byte Offset
→ NIXL Descriptor
→ NIC / NVLink / PCIe
→ GPU Address
→ Attention Kernel
```

完整接起來。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：`DistributedKVObjectIdentity`、`MooncakePoolKey`、`StoreNamespace`、`KVRankNamespace`、`KVCacheGroupIdentity`、`CanonicalCBORPrefixHash`、`NIXLCompatibilityIdentity`、`NIXLHandshakePayload`、`KVLayoutCompatibility`、`HeterogeneousTPMapping`、`RemoteKVRegion`、`HybridKVPhysicalSlab`、`SemanticStateIdentity`、`PhysicalStateIdentity`、`TransferCompatibilityGate`。

新增 Edges：

```text
PrefixHash → chunkHashOf → MooncakePoolKey
MooncakePoolKey → namespacedBy → KVRankNamespace
MooncakePoolKey → scopedTo → KVCacheGroupIdentity
NIXLCompatibilityIdentity → guards → RemoteKVTransfer
KVCacheGroupIdentity → mapsTo → HybridKVPhysicalSlab
RemoteKVObject → materializesAs → LocalPhysicalKVBlock
CanonicalCBORPrefixHash → improves → CrossProcessReproducibility
KVLayoutCompatibility → constrains → HeterogeneousTPMapping
```

## 本輪結束判斷

缺哪一層：Remote object → byte-level memory region / address / transport path。

哪個節點最淺：`RemoteKVRegion`。

哪個概念仍只是名詞：跨 framework 的 `CanonicalDistributedComputationIdentity`。

哪個系統值得讀原始碼：vLLM NIXL Connector + Mooncake StoreLayout subclasses。

哪篇研究需追引用：heterogeneous TP KV transfer 與 disaggregated KV serving 系統研究。

哪個概念最適合視覺模擬：Distributed KV State Microscope。

哪個 Agent 架構最值得實作：目前不是再新增一個 Agent loop，而是讓 Hermes Agent Runtime 擁有 `Execution State Inspector`，能從 request/agent step 一路追到 cache identity、remote object、GPU physical state；這會直接服務最終「UI→Agent→Context→Reasoning→Memory→Tools→Models→GPU→Output」的可驗證 Digital Twin。