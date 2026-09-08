# 【AI Agent × Multimodal Research Report】

**時間：2026-09-08 23:52（Asia/Taipei）**

**本輪主題：Long-Context Attention × RoPE × KV Cache × Prefix Caching × Context Utilization**

## 與歷史研究比較

本輪直接接續上一輪 `2026-09-08-context-compiler-attention-budget-compaction.md`。上一輪回答的是「Agent Runtime 如何從大量 state 中選出 LLM-visible context」；本輪不再重複 selection / compaction，而是往模型與 inference runtime 底層追：**一旦 token 已經被編譯進 context，它如何取得位置、如何形成 Q/K/V、如何進入 KV cache、為何 1M-token capacity 不等於 1M-token reliable utilization，以及 serving runtime 如何避免每輪把相同前綴重新 prefill。**

---

## 本小時新發現

### 新論文 / 理論
1. **RoPE Distinguishes Neither Positions Nor Tokens in Long Contexts, Provably**（Du et al., 2026, arXiv:2605.15514）提出 RoPE 在極長 context 下的內在 position/token discrimination trade-off；這是本輪相對於既有 context engineering 研究最重要的新理論節點。
2. **AdaRoPE: Not All Attention Heads Should Rotate and Scale Equally**（Wang et al., 2026, arXiv:2607.19363）主張不同 attention head 的功能不同，uniform RoPE frequency / scaling 可能是長上下文利用率的結構性限制。

### 新 system architecture / runtime
3. vLLM 最新 KV runtime 已不是單純「每 request 一條 contiguous KV tensor」；`KVCacheManager` 對 scheduler 暴露 block-based allocation、prefix cache lookup、hybrid cache group、external KV connector 與 sliding-window boundary 等語義。
4. vLLM Automatic Prefix Caching（APC）把相同 prompt prefix 已計算的 KV blocks 直接重用，**只省 prefill，不省 decode**。
5. StreamingLLM 顯示「只保留最近 K 個 KV」會失效；保留少量初始 attention-sink tokens + rolling recent window 可以讓有限窗口模型做長 streaming，但這不是完整 long-term recall。

---

# 本小時最重要 5 個發現

## 1. Context Capacity ≠ Context Utilization ≠ Context Retention

### 已確認事實
模型 API 宣告能接收 N tokens，只代表 **input admission / architectural capacity**；不代表模型在所有 position 都能等品質地使用資訊。`Lost in the Middle` 在 multi-document QA / key-value retrieval 中觀察到明顯 position sensitivity：關鍵資訊位於 context 中段時，很多模型表現較差。

### 底層如何運作

```text
Context Compiler
↓
Token sequence [t0 ... tn]
↓
Position IDs
↓
RoPE(Q,K)
↓
Attention scores
↓
Layer-by-layer information routing
↓
Output logits
```

資訊即使「存在 token sequence」，仍必須經過 attention path 被後續 token 有效讀取。

所以應正式拆成：

```text
Context Capacity
= 最大可接受 token 長度

Context Residency
= 此資訊是否真的在這次 token sequence / KV 中

Context Addressability
= attention/position mechanism 是否能穩定區分它的位置與內容

Context Utilization
= 模型是否真的把它用進正確推理
```

### 為什麼重要
Hermes Console 不能把「1M context」畫成一條等強度記憶帶；應顯示 **容量、位置、attention access、retrieval success** 為不同圖層。

### 限制
Lost-in-the-middle 是經驗現象，不代表所有現代模型、所有任務都必然呈同樣 U-shape；應以模型與 task-specific evaluation 驗證。

來源：
- https://arxiv.org/abs/2307.03172
- https://arxiv.org/abs/2605.15514

---

## 2. RoPE 不是「把 position number 加進 token」，而是旋轉 Q/K

### 已確認事實
RoFormer 將位置資訊透過旋轉作用到 query / key；兩個 position 的 attention inner product 因此自然包含 relative position 差。

對每一對 2D 維度，可抽象為：

```text
q_m → R(mθ) q
k_n → R(nθ) k

attention ∝ (R(mθ)q)ᵀ(R(nθ)k)
          = qᵀR((n-m)θ)k
```

也就是 attention score 中出現 `n-m` 的相對位移資訊。

### Bottom-level mechanism

```text
Hidden State
↓ Wq / Wk
Q, K
↓ pair dimensions
(x0,x1), (x2,x3), ...
↓ position-dependent cos/sin
rotate_half + cos/sin mixing
↓
Q_rope, K_rope
↓
Q_rope · K_ropeᵀ / √d
```

Hugging Face 現代模型實作仍普遍具有 `apply_rotary_pos_emb(q, k, cos, sin, ...)` 類函式，顯示 RoPE 在工程層就是 attention 前對 Q/K 的 tensor transformation。

### 新的 2026 理論修正
Du et al. (2026) 論證，context 足夠長時，RoPE 的 locality bias 與 token relevance consistency 可能失效；增加 RoPE base 存在「位置辨識 vs token 辨識」trade-off。這不是說所有 RoPE 模型在某固定長度後必然完全失效，而是指出 mechanism 的 intrinsic limitation。

### 2026 新方向
AdaRoPE 進一步主張不同 attention heads 不應共享完全相同的 frequency / scaling 策略，因為 retrieval/locality 等 head role 不同。

來源：
- RoFormer: https://arxiv.org/abs/2104.09864
- RoPE limitations 2026: https://arxiv.org/abs/2605.15514
- AdaRoPE: https://arxiv.org/abs/2607.19363
- Transformers source: https://github.com/huggingface/transformers

---

## 3. KV Cache 是「已算過的 attention state」，不是 conversation text 本身

### 已確認事實
Autoregressive decode 在第 t 步，如果每次都重新對歷史 token 計算 K/V 會非常浪費。KV cache 保存每層歷史 token 的 K/V，使新 token 只需要算自己的 Q/K/V，再用新 Q 查舊 K/V。

```text
Prefill:
[t0 t1 t2 ... tn]
↓ Transformer
K0..Kn, V0..Vn
↓
KV Cache

Decode token n+1:
new hidden
↓
Q_new, K_new, V_new
↓
Q_new attends to cached K0..Kn + K_new
↓
append K_new,V_new
```

### 記憶量的核心關係
對 decoder-only Transformer，可用概念式：

```text
KV bytes/token
≈ 2 × layers × KV_heads × head_dim × bytes_per_element
```

因此 sequence length 與 concurrent requests 增長時，KV memory 線性增長。GQA/MQA 透過減少 KV heads 直接降低 KV cache footprint。

### 為什麼重要
Agent 長任務的「context 成本」不只 input token 價格，也會轉成 GPU inference runtime 的 **prefill compute + KV residency + scheduler concurrency pressure**。

### 限制
不同模型可能使用 sliding-window、hybrid attention、Mamba/SSM、cross-attention、KV quantization 等，不能假設所有 layer 都持有同型 full-attention KV。

來源：
- PagedAttention: https://arxiv.org/abs/2309.06180
- vLLM cache config: https://docs.vllm.ai/en/latest/api/vllm/config/cache/

---

## 4. PagedAttention 的關鍵不是改變模型「注意什麼」，而是改變 KV 如何被記憶體管理

### 已確認事實
PagedAttention 借鑑 OS paging，把每個 request 的 KV 拆成固定大小 block，logical sequence 不必對應一大塊 contiguous physical GPU memory。原論文針對 fragmentation / over-reservation / duplicated KV 提出 block-based management，並在其實驗中報告相較當時 serving baselines 有 2–4× throughput 提升。

```text
Logical KV of Request A
[A0][A1][A2][A3]

Block table
 A0 → GPU block 17
 A1 → GPU block 03
 A2 → GPU block 91
 A3 → GPU block 44
```

所以：

```text
Attention semantics
≈ unchanged

Physical KV placement
= paged / block-addressed
```

### GitHub 原始碼驗證
vLLM `vllm/v1/core/kv_cache_manager.py` 中：
- `KVCacheBlocks` 將 block group 與 `block_id` 作為 Scheduler ↔ KVCacheManager 介面。
- `get_computed_blocks()` 尋找已計算 prefix blocks。
- `allocate_slots()` 會同時考慮新 token、prefix hit、external computed tokens、lookahead、encoder tokens、reserved blocks 等。
- 最新 runtime 還處理 hybrid KV cache groups / sliding-window / Mamba 類 sparse-retention case，表示 production KV runtime 已遠比「一個 tensor cache」複雜。

### 為什麼重要
Hermes 的 GPU 模擬不應只畫「KV Cache = 一條越來越長的 RAM bar」，而應畫：

```text
Request
↓ Logical Token Blocks
↓ Block Table
↓ GPU KV Block Pool
↓ Free / Cached / Pinned / Evicted / Shared
```

來源：
- https://arxiv.org/abs/2309.06180
- https://github.com/vllm-project/vllm/blob/main/vllm/v1/core/kv_cache_manager.py
- https://docs.vllm.ai/en/stable/design/prefix_caching.html

---

## 5. Prefix Caching 讓 Agent 重複 history 時不必每輪完整 prefill，但它沒有解決「模型能否記得」

### 已確認事實
vLLM Automatic Prefix Caching 以 prompt token prefix 對 KV blocks 做 hash / lookup；新 request 若共享相同前綴，可直接重用已計算 KV blocks。

```text
Round 1
System + 100k history + User A
↓ prefill 100k+
↓ cached KV blocks

Round 2
System + same 100k history + User B
↓ prefix hash match
↓ reuse cached KV
↓ only prefill suffix
```

vLLM 官方文件明確指出：APC **降低 query/prefill 計算，不能降低新 output token 的 decode cost**。

### 更重要的分層

```text
Prefix Cache Hit
= 計算可以重用

Memory Retention
= token/KV 還存在

Model Recall
= 模型是否能正確利用該資訊
```

三者完全不同。

### 安全 / 隔離注意
最新 vLLM cache config 甚至對 prefix caching hash algorithm 提醒：非 cryptographically secure hash 的 collision 理論上可能在 multi-tenant environment 造成 undefined behavior / information leakage risk。這表示 KV reuse 本身也是 security boundary 的一部分。

來源：
- https://docs.vllm.ai/en/stable/features/automatic_prefix_caching/
- https://docs.vllm.ai/en/stable/design/prefix_caching.html
- https://docs.vllm.ai/en/latest/api/vllm/config/cache/

---

# Architecture Breakdown

## Long-context Agent → Model → GPU

```text
Agent State
↓
Context Compiler
↓
LLM-visible Context
↓
Chat Template
↓
Tokenizer
↓
Token IDs
↓
Embedding
↓
Position IDs
↓
Transformer Layer 0..L
  ├ RMSNorm / LayerNorm
  ├ Wq/Wk/Wv
  ├ RoPE(Q,K)
  ├ Attention
  ├ Output Projection
  └ FFN
↓
Prefill KV
↓
KV Cache Manager
  ├ Block Pool
  ├ Prefix Cache
  ├ Block Table
  ├ Eviction
  ├ Sliding Window
  └ Offload / Connector
↓
Decode Loop
  ├ new token Q/K/V
  ├ read cached KV
  ├ attention
  ├ logits
  ├ sampling
  └ append KV
↓
Output token
```

## 必須區分的 5 層

```text
1 Context Source Layer
   Memory / RAG / History / Tool trace

2 Context Compilation Layer
   Selection / compression / ordering

3 Sequence Representation Layer
   Tokenizer / position / RoPE

4 Attention State Layer
   Q/K/V / attention / KV cache

5 Serving Memory Layer
   Paged blocks / prefix cache / GPU/HBM
```

---

# Bottom-Level Logic

## RoPE → Attention → KV 的完整一條線

```text
Token t_i
↓ embedding x_i
↓ layer hidden h_i

q_i = h_i W_Q
k_i = h_i W_K
v_i = h_i W_V

↓ RoPE
q'_i = R(i) q_i
k'_i = R(i) k_i

score(i,j)
= q'_i · k'_j / √d

↓ causal mask
↓ softmax

attn_i
= Σ_j α(i,j) v_j
```

在 autoregressive decode 時：

```text
K'_0..K'_t
V_0..V_t
```

會被 cache；下一 token 不需重做完整歷史的 K/V projection。

但這也造成一個重要 memory/computation asymmetry：

```text
Prefill
= 大量 token 一次計算，compute-heavy

Decode
= 每步只有少量新 token，卻反覆讀取大量 KV，常更 memory-bandwidth sensitive
```

FlashAttention 解的是 attention 計算中 HBM↔SRAM IO 效率；PagedAttention 解的是 serving 階段 KV 的 dynamic memory management。兩者不能視為同一項優化。

來源：
- FlashAttention: https://arxiv.org/abs/2205.14135
- PagedAttention: https://arxiv.org/abs/2309.06180

---

# Attention Sink × Sliding Context

StreamingLLM 發現單純：

```text
keep last K tokens
```

可能導致 language modeling 崩壞；保留少量序列開頭的 attention-sink KV，加上 rolling recent window，可以穩定 streaming inference：

```text
KV Cache
├ Sink tokens [0..s]
└ Recent window [t-w .. t]
```

這個 architecture 解的是：

```text
bounded-memory streaming stability
```

而不是：

```text
perfect long-term memory / arbitrary old fact recall
```

因此對 Agent 應建立：

```text
Streaming Context
≠
Long-Term Memory
```

來源：https://arxiv.org/abs/2309.17453

---

# Visual Simulation Idea

## **Long Context Memory X-Ray**

Hermes Console 新增一個從 Context Compiler 一路穿到 GPU 的互動模擬器。

### View A — Position / RoPE Viewer

畫出 128 tokens 的 Q/K 向量旋轉：

```text
position 0    ↻ 0°
position 1    ↻ θ
position 2    ↻ 2θ
...
position N    ↻ Nθ
```

可拖曳：
- position distance
- RoPE base
- frequency band
- attention head
- scaling method（standard / YaRN-style / head-specific concept）

顯示：
- cosine phase
- relative distance
- attention score
- position collision / inversion risk indicator

### View B — Context Utilization Heatmap

```text
BEGINNING | MIDDLE | END
██████████ ░░░░░░░░ █████████
```

把同一 evidence 移到不同 context position，顯示 benchmark retrieval / answer change。

### View C — KV Cache Block Map

```text
Request A: [17][03][91][44]
Request B: [17][03][22]
                 ↑ shared prefix

GPU Pool:
[03 cached][17 cached][22 active][44 active][91 active]...
```

可觀察：
- Prefix hit ratio
- KV bytes
- block ref count
- eviction
- free blocks
- prefill saved tokens
- decode unchanged

### View D — Attention Sink Simulator

切換：

```text
Full KV
Sliding Window
Sliding + Sink
Prefix Cached
```

比較：
- retained tokens
- GPU KV footprint
- perplexity/retrieval proxy
- old-information availability

### 最重要的教育訊息

> **「token 能放進 context」、「token 的 KV 還在 GPU」、「模型能正確注意到它」是三個完全不同的狀態。**

---

# Code / GitHub

## vLLM — 最值得繼續讀

Repository: https://github.com/vllm-project/vllm

```text
vllm/v1/core/
├ kv_cache_manager.py
├ kv_cache_coordinator.py
├ single_type_kv_cache_manager.py
├ kv_cache_utils.py
└ sched/
   └ scheduler.py

vllm/v1/
├ kv_cache_interface.py
└ simple_kv_offload/
```

### 已讀核心
`vllm/v1/core/kv_cache_manager.py`

值得追的核心 function：

```text
get_computed_blocks()
allocate_slots()
prefix_cache_lookup_enabled()
```

以及 `KVCacheBlocks` / KV cache groups。

## Hugging Face Transformers — RoPE implementation

Repository: https://github.com/huggingface/transformers

搜尋節點：

```text
apply_rotary_pos_emb
RotaryEmbedding
rope_scaling
```

不同 modern model implementation 顯示 RoPE / rope scaling 已成為模型 configuration 與 attention implementation 的一級元件。

## StreamingLLM

Repository: https://github.com/mit-han-lab/streaming-llm

應追：
- attention sink retention
- rolling KV policy
- RoPE position handling
- cache update loop

---

# Papers

## 1. RoFormer: Enhanced Transformer with Rotary Position Embedding
- **Authors:** Jianlin Su, Yu Lu, Shengfeng Pan, Ahmed Murtadha, Bo Wen, Yunfeng Liu
- **Institution:** Zhuiyi Technology（原論文）
- **Year:** 2021
- **URL:** https://arxiv.org/abs/2104.09864
- **Code:** 已廣泛進入 Hugging Face Transformers；原論文提供 RoFormer implementation lineage
- **Dataset:** 原論文涵蓋長文本分類等實驗
- **Architecture:** Q/K position-dependent rotation
- **Contribution:** 將 absolute position rotation 與 relative-position attention 關係整合
- **Limitations:** 原始 RoPE 並未保證任意長 context 的可靠 extrapolation
- **改變了什麼:** position 從「額外 additive embedding」變成 attention geometry 的一部分

## 2. YaRN: Efficient Context Window Extension of Large Language Models
- **Authors:** Bowen Peng, Jeffrey Quesnelle, Honglu Fan, Enrico Shippole
- **Year:** 2023
- **URL:** https://arxiv.org/abs/2309.00071
- **Code:** https://github.com/jquesnelle/yarn
- **Dataset:** LLaMA context extension experiments
- **Architecture:** RoPE frequency interpolation / scaling + training recipe
- **Contribution:** 用較少 continued-training token 擴展 context window
- **Limitations:** extension quality 仍受 positional representation / training distribution 影響
- **改變了什麼:** 證明 context length 可以透過 RoPE scaling +有限 continued training 實際擴張，而不必完整重訓模型

## 3. RoPE Distinguishes Neither Positions Nor Tokens in Long Contexts, Provably
- **Authors:** Yufeng Du, Phillip Harris, Minyang Tian, Eliu A. Huerta, Srikanth Ronanki, Subendhu Rongali, Aram Galstyan, Hao Peng
- **Institution:** 作者包含 USC Information Sciences Institute 等
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2605.15514
- **Code/Dataset:** 論文以理論分析 + indexing / model experiments 驗證；需下一輪追官方 artifact
- **Architecture:** 分析 RoPE attention score
- **Contribution:** 證明長 context 下 position/token distinction 的 failure modes 與 base trade-off
- **Limitations:** 理論 abstraction 與實際 full model behavior 間仍需更多模型家族驗證
- **改變了什麼:** 把「長上下文失效」從單純 training/benchmark 問題提升為 positional mechanism 的可能內在限制

## 4. AdaRoPE: Not All Attention Heads Should Rotate and Scale Equally
- **Authors:** Shaowen Wang, Yuke Zheng, Tansheng Zhu, Shuang Chen, Shaofan Liu, Suncong Zheng, Jian Li
- **Year:** 2026
- **URL:** https://arxiv.org/abs/2607.19363
- **Code:** 需追作者公開 repository
- **Dataset:** simplified retrieval / length generalization + pretrained LLM experiments
- **Architecture:** head-specific learnable RoPE frequencies / attention scaling
- **Contribution:** 不再假設所有 head 應共享 uniform positional frequency/scaling
- **Limitations:** 新研究，需要更廣泛 production-scale reproduction
- **改變了什麼:** 將 RoPE extension 從 model-global hyperparameter 推向 head-level specialization

## 5. Efficient Memory Management for Large Language Model Serving with PagedAttention
- **Authors:** Woosuk Kwon et al.
- **Institution:** UC Berkeley / collaborators
- **Year:** 2023
- **URL:** https://arxiv.org/abs/2309.06180
- **Code:** https://github.com/vllm-project/vllm
- **Dataset/Workload:** ShareGPT / Alpaca-style serving workloads等
- **Architecture:** virtual-memory-inspired KV block management
- **Contribution:** 降低 KV fragmentation / duplication，支援共享與高 concurrency
- **Limitations:** 改善 serving memory efficiency，不直接提升模型 long-context reasoning accuracy
- **改變了什麼:** 把 KV cache 從 tensor allocation 問題轉成 OS-like memory-management problem

## 6. Efficient Streaming Language Models with Attention Sinks
- **Authors:** Guangxuan Xiao, Yuandong Tian, Beidi Chen, Song Han, Mike Lewis
- **Institution:** MIT / Meta 等作者背景
- **Year:** 2023
- **URL:** https://arxiv.org/abs/2309.17453
- **Code:** https://github.com/mit-han-lab/streaming-llm
- **Dataset:** language modeling / streaming evaluations
- **Architecture:** attention sinks + recent rolling KV
- **Contribution:** bounded KV memory 下維持長串流穩定
- **Limitations:** 不等於完整保留任意遠距歷史資訊
- **改變了什麼:** 揭示初始 token 可作為 attention normalization sink，不能粗暴全部滑掉

## 7. Lost in the Middle: How Language Models Use Long Contexts
- **Authors:** Nelson F. Liu et al.
- **Institution:** Stanford / collaborators
- **Year:** 2023/2024 TACL
- **URL:** https://arxiv.org/abs/2307.03172
- **Dataset:** multi-document QA + key-value retrieval
- **Architecture:** benchmark/evaluation paper
- **Contribution:** 建立 position-sensitive long-context utilization 的經典證據
- **Limitations:** 結果依模型與 task 而異；不是直接的單一機制因果證明
- **改變了什麼:** 把 long-context 評估從「能不能塞」改成「資訊放在哪裡還能不能用」

---

# 已確認事實 / 論文結果 / 工程實作 / 推論分界

### 已確認事實
- RoPE 對 Q/K 做 position-dependent rotation。
- Autoregressive KV cache 保存歷史 K/V 以避免重複計算。
- vLLM prefix caching 重用已計算 prefix KV，主要降低 prefill。
- vLLM 最新 runtime 使用 block/group-based KV management。

### 論文結果
- Lost in the Middle：多個模型對相關資訊位置敏感。
- PagedAttention：原論文在其測試條件中報告 2–4× throughput improvement。
- StreamingLLM：attention sink + rolling cache 在其模型/任務中可穩定極長 streaming。
- Du et al. 2026：提出並證明 RoPE 的長 context discrimination failure modes。
- AdaRoPE：head-specific RoPE 在其實驗中優於 uniform variants。

### 工程實作
- vLLM 的 `KVCacheManager` / coordinator / scheduler 已把 prefix hit、block allocation、hybrid groups、external KV transfer 等做成 runtime primitives。

### 合理推論
- Hermes Context Compiler 應把「prefix stability」當一個 serving optimization signal：不影響語意的前綴若保持 byte/token stable，可以提高 prefix-cache reuse。
- Agent 長任務 context policy 應同時最佳化 semantic utility 與 KV/prefill reuse，而非只最佳化 token 數。

### 尚未驗證假說
- 「將最穩定 system/task context 固定在最前面」在特定 Hermes serving stack 上能帶來多少實際 TTFT / GPU throughput 改善，需要 benchmark。
- AdaRoPE 類 head-specific position scheme 是否會顯著改善 Agent 長任務中的中段 constraint retention，尚未有直接 Hermes-style benchmark。

---

# Knowledge Graph 新增 Node / Edge

```text
Long Context Runtime
├ Context Capacity
├ Context Residency
├ Context Addressability
├ Context Utilization
├ Position Encoding
│  ├ RoPE
│  ├ RoPE Base
│  ├ Frequency Band
│  ├ Scaling
│  └ Head-Specific Scaling
├ Prefill
├ Decode
├ KV Cache
│  ├ KV Token State
│  ├ KV Block
│  ├ Block Table
│  ├ Prefix Cache
│  ├ Eviction
│  ├ Sliding Window
│  ├ Attention Sink
│  └ Offload
└ Serving Scheduler
```

新增核心 edges：

```text
Context Compiler
→ emits
Token Sequence

Token Sequence
→ assigned
Position IDs

Position IDs
→ parameterize
RoPE

RoPE
→ transforms
Q / K

Q / K / V
→ produce
Attention

Prefill
→ materializes
KV Cache

Prefix Equality
→ enables
KV Reuse

KV Block Pool
→ constrains
Concurrent Requests

Context Length
→ increases
Prefill Work

Context Length
→ increases
KV Residency

Context Capacity
≠ guarantees
Context Utilization
```

新增一條 Agent-specific edge：

```text
Stable Agent Prefix
→ higher Prefix Cache Reuse
→ lower Repeated Prefill
→ lower TTFT / serving cost
```

但標記為 **工程假說，需 Hermes benchmark 驗證**。

---

# Unknown / Open Questions 1–3

1. **Long-context failure 的 attribution 如何做？** 同一次錯誤可能來自 Context Compiler selection miss、RoPE/addressability、attention utilization、或模型 reasoning；需要分層 benchmark 才能定位。
2. **Prefix cache 與 context compaction 如何共同設計？** 每輪重新摘要會改變大量前綴 token，可能破壞 cache hit；但不摘要又會增加 token/KV footprint。需要建立 semantic utility vs cache stability trade-off。
3. **Agent 的 KV Cache 是否值得跨 turn / worker / model instance 遷移？** 需要比較 local APC、distributed KV connector、re-prefill、offload 的 latency / bandwidth / privacy 成本。

---

# 下一輪研究

## **Inference Infrastructure × Prefill/Decode Disaggregation × Continuous Batching × KV Transfer × GPU Bottleneck**

下一輪應從：

```text
Context
↓
Prefill
↓
KV Cache
```

繼續往 deployment runtime：

```text
Request Queue
↓
Scheduler
↓
Continuous Batching
↓
Chunked Prefill
↓
Prefill GPU
↓
KV Transfer
↓
Decode GPU
↓
Continuous Decode
↓
Output Stream
```

核心問題：
- TTFT 與 TPOT 分別由什麼控制？
- Prefill 為何 compute-heavy，decode 為何 memory-bandwidth-heavy？
- Continuous batching 如何把不同 sequence 插入同一 GPU step？
- Prefill/Decode disaggregation（P/D）何時值得？
- KV 從 Prefill worker 移到 Decode worker，真正傳的是什麼 tensor / metadata？
- Tensor Parallel / Pipeline Parallel / Expert Parallel 如何影響 Agent latency？
- 長 context Agent 應如何做 GPU admission / preemption / KV eviction？

---

# 本輪結束檢查

- **缺哪一層：** Model KV runtime → distributed serving / GPU scheduler。
- **哪個節點最淺：** KV transfer / offload / distributed prefix caching。
- **哪個概念仍只是名詞：** Context Addressability，目前需要更嚴謹 operational metric。
- **哪個系統最值得讀原始碼：** vLLM scheduler + KVCacheCoordinator + prefix cache / connector path。
- **哪篇論文需追引用：** `RoPE Distinguishes Neither Positions Nor Tokens in Long Contexts, Provably`（2026），尤其追 position encoding replacements / rebuttal / reproductions。
- **哪個概念最適合視覺模擬：** Long Context Memory X-Ray（RoPE → Attention → KV block → prefix reuse）。
- **哪個 Agent 架構最值得實作：** `Context Compiler + Stable Prefix Layout + Prefix-Aware Serving + Retrieval-on-Demand`，而不是單純 Append-All 1M context。

## 本輪核心結論

> **Long context 是三個問題疊在一起：模型能容納多少 token、attention 能否可靠地找到/利用那些 token、serving runtime 能否負擔它們產生的 prefill 與 KV memory。RoPE 解位置表徵，KV cache 解重算，PagedAttention 解 KV 物理記憶體管理，Prefix Caching 解重複 prefill；它們都不能單獨保證 Agent 真的「記得」一段很久以前的資訊。**
