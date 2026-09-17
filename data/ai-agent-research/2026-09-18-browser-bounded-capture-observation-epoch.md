# 【AI Agent × Multimodal Research Report】

**時間：2026-09-18 07:51（Asia/Taipei）**  
**主題：Browser Bounded Capture × Observation Epoch × DOM/AX/Pixels Correspondence × Quiescence Is Not Atomicity**

## 本小時新發現

本輪承接 06:50 的 `ObservationBundle / CorrespondenceWitness / CorrespondenceAdmissionGate`，不再重複「DOM、AX、pixels 是不同 representation」。本輪專門回答上一輪最深缺口：**CDP 能否把 DOMSnapshot、Accessibility Tree、layout/paint 與 screenshot 綁成一個真正 atomic 的 browser observation？**

結論：目前公開 CDP primitives 足以建立 **bounded capture protocol**，但不足以把幾個獨立命令宣稱為真正 atomic snapshot。`DOMSnapshot.captureSnapshot`、`Accessibility.getFullAXTree`、`Page.captureScreenshot` 是不同 domain/command；Page domain另有 frame/lifecycle identity，LayerTree 有 paint/layer events。這些可以用來建立 capture epoch、mutation/paint invalidation 與 bounded correspondence，但除非 browser/runtime 提供共同 snapshot token，Hermes 不應把它升格成 `ATOMIC`。

本輪新加入：`ObservationEpoch`, `CaptureFence`, `MutationFence`, `PaintFence`, `FrameDocumentIdentity`, `CaptureBound`, `QuiescenceWitness`, `CaptureInvalidation`, `BoundedCorrespondenceProof`。

## 本小時最重要 5 個發現

### 1. CDP 有多個 observation primitives，但沒有自動提供共同 world-revision

**官方資訊：** Chrome DevTools Protocol 的 DOMSnapshot domain提供 `captureSnapshot`，資料結構包含 `DocumentSnapshot / NodeTreeSnapshot / LayoutTreeSnapshot / TextBoxSnapshot`；Accessibility domain另外提供 `getFullAXTree` 及 `nodesUpdated`；Page domain另外提供 `captureScreenshot`, `getFrameTree`, `getLayoutMetrics` 與 lifecycle/frame events。

因此實際 capture 是：

```text
Frame/Document identity
→ DOMSnapshot.captureSnapshot
→ Accessibility.getFullAXTree
→ Page.getLayoutMetrics
→ Page.captureScreenshot
```

而不是：

```text
Browser.atomicSnapshot(DOM + AX + Pixels)
```

這個差異非常重要。Hermes 應把「同一 capture request 內取得」記為 `BOUNDED/CORRELATED`，除非存在共同 native snapshot/revision witness。

來源：Chrome DevTools Protocol DOMSnapshot / Accessibility / Page 官方文件。

### 2. Layout snapshot 比普通 DOM read 更接近 rendered state，但仍不等於 final pixels

**官方資訊：** `DOMSnapshot.captureSnapshot` 不只取得 node tree，還有 layout tree snapshot；Chromium rendering pipeline則明確區分 DOM/render objects、layout、paint、compositing。Painting 產生 display-list/SkPicture 類中間表示，compositor再把 layers 組合成最終畫面；compositor甚至可在 main thread snapshot 上繼續 scroll/animation。

因此：

```text
DOMSnapshot.LayoutTreeSnapshot
≠ Paint Snapshot
≠ Compositor Frame
≠ Screenshot Pixels
```

這解釋了為什麼即使 DOM + layout 在 capture 時沒有改，CSS/compositor animation、OOPIF、video/canvas、GPU compositing仍可能使 pixels 位於不同 visual epoch。

### 3. 「等頁面安靜」只能建立 Quiescence Witness，不能證明 Atomicity

常見 browser agent 會等 `DOMContentLoaded/load/network idle` 後抓 snapshot。這能降低 capture window 內變化機率，但不能保證：timer、WebSocket、MutationObserver、animation、service-worker push、cross-origin iframe、compositor animation 都停止。

因此 Hermes 應明確區分：

```text
QUIESCENT
≠ IMMUTABLE
≠ ATOMIC
```

建議 `QuiescenceWitness` 保存：capture 前後的 frame/document identity、DOM mutation counter、AX update counter、paint/layer update counter、capture window duration，以及 lifecycle state。若 capture window 中任一 counter 改變，bundle 應標成 `INVALIDATED` 或重新 capture。

### 4. 最可行的 Browser Observation Bundle 是 optimistic bounded capture，而不是假裝 freeze 世界

**Hermes architecture proposal：** 建立 `ObservationEpoch`：

```text
EPOCH START
→ read FrameTree / loader identity
→ install/read mutation counters
→ capture DOM+layout snapshot
→ capture AX tree
→ capture screenshot
→ read counters again
→ verify Frame/loader unchanged
→ EPOCH END
```

判斷：

```text
if frame/document changed:
  BROKEN
elif DOM/AX/paint counters changed inside window:
  RETRY / BOUNDED-WEAK
else:
  BOUNDED-STRONG
```

這本質上像 optimistic concurrency control：先讀多個 representation，再驗證 capture window 內是否被 concurrent browser updates 污染。它不保證物理 atomicity，但能把「不知道是否同版」轉成可量測、可重試的 proof state。

### 5. Action admission 應依 action 所需 representation 決定 proof 強度，而非所有操作都要求 pixel-perfect bundle

ASIL/StateAct 顯示 structured/program state 對長任務通常比純 screenshot 更有效，但 visual-only/geometry task 仍需要 pixels。PAGER 又顯示精密幾何 GUI 即使 action-type 理解很高，座標誤差仍會造成巨大 execution gap。

因此 Hermes 不應用單一 observation policy：

```text
semantic API action
→ canonical state + semantic postcondition

DOM/AX click
→ DOM/AX identity + frame/document freshness

visual click
→ AX/DOM semantics + pixel/layout correspondence

canvas geometry
→ pixel/layout/geometry proof + tighter capture bound
```

也就是 `RequiredProofStrength(action)` 應由 action semantics 決定。

## Architecture Breakdown

```text
Browser / Renderer
│
├─ FrameTree / loaderId / document identity
├─ DOM + Layout ── DOMSnapshot.captureSnapshot
├─ Accessibility ─ Accessibility.getFullAXTree
├─ Paint/Layers ── LayerTree events/snapshot signals
└─ Surface Pixels ─ Page.captureScreenshot

          ↓
      CaptureFence
          ↓
 ObservationEpoch E17
          ↓
 pre-counters / identities
          ↓
 DOM+Layout → AX → Pixels
          ↓
 post-counters / identities
          ↓
 Correspondence Validator
          ↓
 ATOMIC?          no native proof
 BOUNDED-STRONG   no invalidation observed
 BOUNDED-WEAK     incomplete channels/signals
 BROKEN           navigation/mutation/paint crossed capture
 UNKNOWN          instrumentation gap
          ↓
 Premise Lineage
          ↓
 Reasoning / Planning
          ↓
 Action-specific Proof Requirement
          ↓
 PASS / RECAPTURE / REGROUND / BLOCK
```

### 與上一輪比較

上一輪只有：

```text
ObservationBundle
+ CorrespondenceEdges
```

本輪補上：

```text
ObservationBundle
+ Capture Protocol
+ Epoch Boundary
+ Invalidation Detection
+ Proof Strength
+ Action-specific Admission
```

所以 correspondence 不再只是資料結構，而開始變成 runtime algorithm。

## Bottom-Level Logic

### Bottom-level mechanism：Optimistic Multi-Representation Capture Validation

```text
1. epoch_id = new ObservationEpoch
2. pre = {
     frame_tree,
     loader/document identity,
     dom_mutation_seq,
     ax_update_seq,
     paint/layer_seq,
     monotonic_time
   }
3. D = DOMSnapshot.captureSnapshot()
4. A = Accessibility.getFullAXTree()
5. L = Page.getLayoutMetrics()
6. P = Page.captureScreenshot()
7. post = read same identities/counters
8. validate:
     pre.frame/document == post.frame/document
     mutation counters stable or bounded
     capture duration <= policy bound
9. emit CorrespondenceWitness
10. bind premises to exact representation ids
11. before action, revalidate only required ancestors
```

建議 IR：

```text
ObservationEpoch {
  epochId
  targetId
  frameId
  loaderId?
  startedAt
  endedAt
  captureWindowMs
  preFence
  postFence
  representations[]
  invalidations[]
  proofStrength
}

CaptureFence {
  domMutationSeq?
  axUpdateSeq?
  paintSeq?
  frameIdentity
  documentIdentity?
}
```

核心 invariant：

```text
AtomicCaptureClaim(bundle)
REQUIRES native shared snapshot/revision witness
```

沒有 native witness 時，最高只能是 Hermes 定義的 bounded proof，例如：

```text
BoundedCorrespondence(bundle, Δt, observedSignals)
```

## Visual Simulation Idea

### Browser Observation Epoch Microscope

```text
TIME ─────────────────────────────────────────────>

FRAME     F7 ============================= F7
LOADER    L3 ============================= L3
DOM       D41 ────────────── D42
AX        A52 ─────────────────── A53
PAINT     P90 ─────────────────────── P91
SCREEN                         S18

CAPTURE      [──────── Epoch E17 ────────]

pre fence   ▲                            ▲ post fence

mutation?            X
                     ↓
              E17 = INVALIDATED
              retry capture
```

互動控制：
- DOM mutation rate
- AX update delay
- CSS/compositor animation
- iframe navigation
- screenshot latency
- capture order
- allowed capture window
- required proof strength

即時顯示：
`Frame identity / loader identity / DOM seq / AX seq / paint seq / capture Δt / proof strength / invalidation reason / action verdict / recapture cost`。

## Code / GitHub

### hermes-console 歷史研究

本輪先比對上一輪 `2026-09-18-cross-modal-observation-bundle-correspondence-proof.md`，其下一輪明確鎖定 Browser Atomic Observation Bundle；因此本輪不重複 ASIL protocol/adapter，而把 CorrespondenceWitness 往 CDP capture protocol 落地。

### Chromium / Chrome DevTools Protocol

本輪追的核心 interface：
- `DOMSnapshot.captureSnapshot` — document/node/layout/text-box structured snapshot。
- `Accessibility.getFullAXTree` / `nodesUpdated` — accessibility projection與更新訊號。
- `Page.captureScreenshot` — surface/view screenshot。
- `Page.getFrameTree` / frame navigation / lifecycle events — frame/document capture boundary線索。
- `LayerTree.layerPainted` / `layerTreeDidChange` — paint/compositor invalidation線索。

重要工程結論：這些 API 分屬不同 domain，公開介面沒有宣告它們共享同一 atomic revision。因此 Hermes Console 不應顯示假的「Atomic Snapshot ✓」。

下一輪值得讀 Chromium source tree：Blink `renderer/core/dom`, `renderer/core/layout`, `renderer/core/paint`、`cc` compositor，以及 DevTools DOMSnapshot/Accessibility agent implementation，確認是否存在可利用的 document lifecycle/update lifecycle fence。

## Papers

1. **ASIL: Replacing Screenshot-and-Click with Structured State and Semantic Actions** — Rui Xie, Lu Chen; Shanghai Jiao Tong University; 2026; arXiv:2608.26991. Code: https://github.com/sharryXR/ASIL. Benchmark: 15 apps、300 single-app + 80 multi-app tasks. Architecture: structured observation + semantic action adapters. Contribution: structured state/action interface大幅降低 screenshot-and-click brittleness。Limitation: application-specific deepest stable interface；render/perceptual semantics仍需 hybrid channel。

2. **StateAct: Program State, before Pixels, for Long-Horizon Computer-Use Agents** — Yan Yang et al.; 2026; arXiv:2607.22798. Benchmark: OSWorld 2.0. Architecture: code-first main agent + GUI specialist + independent finish gate. Contribution: state grounding改善長任務成功率與成本；同時 code-only 低於 hybrid，證明 visual channel仍必要。Limitation: program-state access availability與 task/application dependency。

3. **PAGER: Bridging the Semantic-Execution Gap in Point-Precise Geometric GUI Control** — Jingxuan Wei et al.; 2026; arXiv:2605.15963. Dataset: PAGE Bench, 4,906 problems / >224K process-supervised pixel actions. Architecture: topology-aware planning + pixel-level execution + precision-aligned RL. Contribution:指出 semantic action correctness 與 geometric execution correctness 是不同層。Limitation:聚焦 precision-sensitive geometric GUI，不代表一般 desktop workflow。

## Unknown / Open Questions

1. Chromium DevTools backend內部是否有能把 DOMSnapshot + AX + compositor frame 綁到共同 lifecycle/update token 的更低層 primitive？公開 CDP 尚未證明。
2. OOPIF / cross-process frame 如何建立跨 renderer process 的 capture fence？單一 renderer/document counter可能不足。
3. Canvas/WebGL/video 的 pixels若沒有 DOM/AX semantic parent，應使用 frame/compositor identity、application-native object graph，還是 vision tracking建立 correspondence？

## 下一輪研究

優先往 Browser capture 再下一層：

```text
Blink lifecycle
→ style/layout lifecycle state
→ paint lifecycle
→ compositor commit/activation
→ viz surface/frame
→ screenshot
```

並追：

```text
OOPIF
→ renderer process A/B
→ compositor surface aggregation
→ frame sink / surface id
→ screenshot
→ cross-process observation bundle
```

如果能找到 native compositor/frame identity，嘗試把 `BOUNDED-STRONG` 升級成更具體的 `RenderedFrameWitness`；如果找不到，就保留 UNKNOWN/BOUNDED，不虛構 atomicity。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `ObservationEpoch`
- `CaptureFence`
- `MutationFence`
- `PaintFence`
- `FrameDocumentIdentity`
- `CaptureBound`
- `QuiescenceWitness`
- `CaptureInvalidation`
- `BoundedCorrespondenceProof`
- `RenderedFrameWitness`
- `RequiredProofStrength`

新增 Edges：
- `ObservationEpoch CONTAINS RepresentationObservation`
- `CaptureFence BOUNDS ObservationEpoch`
- `FrameDocumentIdentity SCOPES ObservationEpoch`
- `MutationFence INVALIDATES ObservationEpoch`
- `PaintFence MAY_INVALIDATE PixelCorrespondence`
- `BoundedCorrespondenceProof SUPPORTS CorrespondenceEdge`
- `ToolIntent REQUIRES RequiredProofStrength`
- `RequiredProofStrength GATES CorrespondenceAdmissionGate`

## 本輪結束檢查

- **缺哪一層：** Blink lifecycle → compositor commit/activation → Viz surface/frame → screenshot 的 native rendered-frame identity。
- **哪個節點最淺：** `RenderedFrameWitness`，目前只有 LayerTree/Page 公開 signals，尚未證明可形成跨 DOM/AX/pixels 的共同 revision。
- **哪個概念仍只是名詞：** `Atomic Observation Bundle`。本輪明確降級：沒有 native shared snapshot token 就只能叫 `Bounded Observation Bundle`。
- **哪個系統值得讀原始碼：** Chromium DevTools DOMSnapshot/Accessibility implementation + Blink lifecycle + cc/Viz compositor。
- **哪篇論文需追引用：** ASIL 與 StateAct，特別是 structured-state/visual hybrid 的後續工作；PAGER則追 precision execution/verification。
- **哪個概念最適合視覺模擬：** `Browser Observation Epoch Microscope`。
- **哪個 Agent 架構最值得實作：** `State-grounded Computer Agent + action-specific Observation Proof Gate`，比純 screenshot ReAct 更適合 Hermes。

## 回到「AI 到底怎麼運作」

本輪補上的鏈是：

```text
Browser Program State
→ DOM / Layout / AX / Paint / Pixels
→ Capture Epoch
→ Correspondence Validation
→ Observation Bundle
→ Context / Premise
→ Model Reasoning
→ Plan
→ Required Observation Proof
→ Freshness + Correspondence Gate
→ Computer/Browser Action
→ External Effect
→ Read-back / Settlement
→ Output
```

核心結論：**可靠 Browser Agent 不應把「我在同一輪拿到 DOM、AX tree 和 screenshot」當成它們天然屬於同一瞬間。Browser 本身是多階段、多執行緒、甚至多 process 的動態系統。Hermes 應把 capture 視為一次 optimistic transaction：記錄 epoch 前後的 frame/document/update signals，偵測 capture window 中的變動，證明不了 atomicity 就明確標成 BOUNDED/UNKNOWN，並依 action 風險決定是否 recapture、reground 或 block。**