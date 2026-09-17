# 【AI Agent × Multimodal Research Report】

**時間：2026-09-18 05:52（Asia/Taipei）**  
**主題：Unified Observation Revision × Action Freshness Gate × Cross-Modal TOCTOU × State Grounding**

## 本小時新發現

本輪承接上一輪 `ObservableReadSet / HiddenReadSetRisk / StaleGeneration`，不再重複 DB/HTTP revision isolation，而是把 read-set 擴展到 Browser DOM、Screenshot、MCP Resource、Filesystem/Program State、Camera/Audio/Video。核心問題是：**Agent 的 reasoning 通常同時依賴不同 observation channel，但這些 channel 沒有共同 revision、共同 freshness semantics，也不一定能在 action 前重新驗證。**

新來源包括：StateAct（arXiv:2607.22798）、Temporal UI State Inconsistency（arXiv:2604.18860）、MCP 2026-07-28 subscriptions/listen、以及 vercel-labs/agent-browser 2026-09-16 新增的 snapshot delta / persistent refs。

## 本小時最重要 5 個發現

### 1. Observation 必須是一等公民的 versioned object

**已確認事實：** agent-browser v0.38.0 的 snapshot delta 有 `baseRevision → revision`，delta 包含 ref metadata changes 與 tree splice；同一 DOM element surviving same-document changes 可保留 persistent ref，而 replaced element、navigation、iframe navigation 會使 ref 失效。

底層鏈：

`Browser state → accessibility/DOM snapshot → revision r17 → ref e3 → reasoning premise → action intent`

若 action 時 snapshot 已是 r18，Runtime 不應只問 `e3 還存在嗎`，還應問 action 所依賴的 observation predicate 是否仍成立。

來源：https://github.com/vercel-labs/agent-browser ; https://agent-browser.dev/changelog

### 2. Pixel freshness 與 structural freshness 是不同證明

**論文結果：** Temporal UI State Inconsistency 測得 screenshot observation 到 action 的平均 gap 6.51 秒，提出 pre-execution UI state verification；pixel/X-window 層能攔截部分 visual TOCTOU，但對 zero-visual-footprint DOM injection 存在結構盲點。

因此：

`ScreenshotSame ≠ DOMSame ≠ ProgramStateSame`

Hermes 需要 layered freshness proof，而不是單一 screenshot hash。

來源：https://arxiv.org/abs/2604.18860

### 3. State Grounding 能補 pixels 的非單射問題，但不能完全取代 GUI

**論文結果：** StateAct 指出不同 program states 可以 render 成相同 pixels；主 Agent 優先直接操作 files/backends/DOM，只有少量需要視覺互動的 subgoal 交給 GUI agent。OSWorld 2.0 上 Claude Opus 4.8 binary success 20.6%→26.9%，partial 54.8%→61.6%；但 code-only variant partial 45.9%，低於 screenshot baseline 54.8%。

結論：可靠 observation architecture 應是 **state-first + visual fallback + cross-check**，不是「只看 DOM」或「只看 pixels」。

來源：https://arxiv.org/abs/2607.22798

### 4. MCP change notification 是 invalidation signal，不是新 state proof

**官方資訊：** MCP 2026-07-28 使用 `subscriptions/listen` multiplex `tools/prompts/resources list_changed` 與 `notifications/resources/updated`；resource updated event 是 level trigger，語義是「changed, refetch if you care」。

因此正確鏈應是：

`MCP Resource Read → ObservationRevision(local) → resources/updated → mark STALE → refetch → new observation → revalidate premise`

而不是：

`resources/updated → assume new value`

來源：https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28 ; https://py.sdk.modelcontextprotocol.io/api/mcp/shared/subscriptions/

### 5. Unified Read Set 應保存 observation identity，而非強迫所有 channel 使用同一 version type

**Hermes architecture proposal：** 不應把 DOM revision、file mtime/hash、MCP notification、video PTS、audio event time 假裝成同一 clock。應建立：

```text
ObservationRecord {
  observationId
  channel
  sourceIdentity
  nativeRevision
  observedAt
  eventTimeRange?
  contentDigest?
  structuralDigest?
  subscriptionToken?
  freshnessPolicy
  invalidationSignal?
}
```

Reasoning 的 premise 再引用 observationId：

`Observation O17 → supports → Premise P9 → Claim C4 → Plan S3 → ToolIntent T8`

## Architecture Breakdown

```text
Browser DOM ─ snapshot revision ─┐
Screenshot ─ pixel digest/time ──┤
Filesystem ─ inode/hash/mtime ───┤
MCP Resource ─ URI/change event ─┤
Camera ─ frame/PTSs ─────────────┤
Audio ─ chunk/event-time ────────┤
Tool Result ─ provider revision ─┘
              ↓
      Observation Normalizer
              ↓
      Unified Observation Set
              ↓
      Premise / Claim Lineage
              ↓
          Reasoning
              ↓
           Planning
              ↓
        Action Freshness Gate
              ↓
   Revalidate required observations
       PASS / STALE / UNKNOWN
              ↓
        Execute or Repair
```

這裡的「Unified」是共同 IR，不是共同 clock。

## Bottom-Level Logic

本輪最重要 mechanism 是 **Action Freshness Gate**：

```text
Intent T8
→ collect ancestor premises
→ collect supporting ObservationRecords
→ classify each observation by channel
→ run channel-specific freshness validator
→ propagate invalidation through premise lineage
→ compute ActionFreshnessVerdict
```

建議 invariant：

```text
ActionAdmissible(T)
:=
∀ o ∈ RequiredObservations(T):
  FreshEnough(o, policy(T,o))
∧
NoInvalidatedPremise(T)
```

其中 Browser 可用 snapshot revision/ref validity；MCP 可用 change event + refetch；filesystem 可用 stat/hash/version-control identity；video/audio 用 EventTime + coverage/watermark；external SaaS 用 provider revision/read-back。

## Visual Simulation Idea

### Unified Observation Freshness Microscope

畫面同時顯示：

```text
DOM        r17 ───── r18
Screenshot s41 ───────── s42
MCP        m7 ── UPDATED ── m8
File       hA ───────── hB
Camera     f91 f92 f93 f94
Audio      a31 a32 a33

Reasoning      [P1][P2][P3]
Plan                    [S1][S2]
Action                         [T8]
Freshness Gate                 ▲
```

可注入 DOM mutation、same-pixel state change、MCP update、file replacement、late frame、audio delay、hidden read，顯示 Observation Coverage、Premise Age、Invalidation Path、Action Gate verdict、Targeted Repair Set。

## Code / GitHub

### vercel-labs/agent-browser
值得繼續讀：
- `cli/src/commands.rs`
- `cli/src/mcp.rs`
- `cli/src/read.rs`
- snapshot delta / persistent ref implementation
- docs command semantics

Repo：https://github.com/vercel-labs/agent-browser

已確認 2026-09-16 changelog：`snapshot --delta` 具有 baseline/revision/delta，persistent refs 在 same-document changes 可延續、replacement/navigation invalidates refs。

## Papers

1. **StateAct: Program State, before Pixels, for Long-Horizon Computer-Use Agents** — Yan Yang, Xiangru Jian, Ziyang Luo, Zirui Zhao, Yutong Dai, Ziji Shi, Hanshu Yan, Jun Hao Liew, Silvio Savarese, Junnan Li; 2026; arXiv:2607.22798. Architecture: code-first main agent + GUI subagent + finish gate + fresh-context delegation. Contribution: state grounding。Limitation: render-only tasks仍需視覺，code-only 並不足夠。URL: https://arxiv.org/abs/2607.22798

2. **Temporal UI State Inconsistency in Desktop GUI Agents: Formalizing and Defending Against TOCTOU Attacks on Computer-Use Agents** — Wenpeng Xu; 2026; arXiv:2604.18860. Contribution: formalizes visual atomicity violation and pre-execution revalidation. Limitation: pixel/window verification對 zero-visual DOM mutation有盲點。URL: https://arxiv.org/abs/2604.18860

## Unknown / Open Questions

1. Browser DOM revision 與 screenshot revision 如何建立 cross-modal correspondence proof，而不假設同一時間戳即同一 state？
2. Filesystem read 若經 shell/child process 間接發生，Runtime 如何完整 reconstruct hidden read set？
3. Camera/audio continuous stream 的 `FreshEnough` 應由 age、coverage、watermark 還是 task-specific semantic predicate決定？

## 下一輪研究

下一輪優先深入 **Cross-Modal Correspondence Proof**：

`DOM revision ↔ rendered screenshot ↔ accessibility tree ↔ program/backend state`

研究同一 observation 如何證明不同 representation 屬於同一 world state，並追 `agent-browser` snapshot implementation、browser CDP lifecycle、DOM mutation/paint timing；同時研究 filesystem observation instrumentation（open/read/stat/eBPF 或 sandbox syscall tracing）以補 HiddenReadSet。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：`ObservationRecord`, `NativeRevision`, `ObservationChannel`, `ActionFreshnessGate`, `CrossModalCorrespondence`, `StructuralDigest`, `PixelDigest`, `StateGrounding`, `VisualAtomicityViolation`, `ObservationInvalidationSignal`, `ResourceChangeLevelTrigger`, `FreshnessPolicy`, `UnifiedObservationSet`。

新增 Edges：

`ObservationRecord SUPPORTS Premise`; `NativeRevision VERSION_OF Source`; `ResourceUpdated INVALIDATES ObservationRecord`; `Premise DERIVED_FROM ObservationRecord`; `ActionIntent REQUIRES_FRESH ObservationRecord`; `StateGrounding COMPLEMENTS VisualGrounding`; `CrossModalCorrespondence BINDS ObservationRecord ObservationRecord`。

## 本輪收斂判斷

- **缺哪一層：** Cross-modal correspondence / observation identity binding。
- **最淺節點：** Hidden filesystem/browser reads 的完整 reconstruction。
- **仍只是名詞：** `CrossModalCorrespondenceProof`，尚無通用標準。
- **最值得讀原始碼：** vercel-labs/agent-browser snapshot delta/ref lifecycle。
- **需追引用論文：** StateAct、Temporal UI State Inconsistency。
- **最適合視覺模擬：** Unified Observation Freshness Microscope。
- **最值得實作的 Agent 架構：** State-grounded main agent + visual specialist + Runtime-controlled Action Freshness Gate。

最終鏈因此補成：

`UI/Camera/Voice/Video/File/MCP → versioned ObservationRecord → Context → Premise lineage → Reasoning → Planning → ActionFreshnessGate → Tools/MCP/Computer → External Effect → Settlement → Output`。

核心結論：**Agent 的「我剛剛看到」不能再只是 prompt 裡的一段文字。每個 observation 都必須有來源、native revision/time、失效訊號與 freshness policy；在真正改變世界前，Runtime 必須重新證明 action 依賴的那些 observation 仍足夠新。**