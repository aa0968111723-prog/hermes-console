# 【AI Agent × Multimodal Research Report】

## 時間
2026-09-18 08:52 Asia/Taipei

## 本小時新發現

本輪承接上一輪 `Browser Bounded Capture × Observation Epoch`，不再重複 DOM/AX/Screenshot 非原子性的結論，而是深入 Chromium compositor / Viz 原始碼與官方架構，回答上一輪最淺節點：**RenderedFrameWitness 到底能否用 browser-native identity 建立？**

結論：可以建立比單純 screenshot timestamp 強很多的 **rendered-frame witness chain**，但仍不能把它誤稱為 DOM/AX/Pixels 的單一 atomic world revision。Chromium 的 `LocalSurfaceId` 可與 `FrameSinkId` 組成全域唯一 SurfaceId；`CompositorFrameMetadata.frame_token` 可把 presentation feedback 對應到特定 compositor frame。這提供了「哪一個 compositor submission / surface 被呈現」的 native identity primitive，但 CDP 的 `Page.captureScreenshot` 並沒有直接回傳這些 Viz identities，因此 DevTools consumer 仍缺最後一段 binding。

新架構：

`Blink main-thread state → commit → LayerTreeHostImpl active tree → CompositorFrame(frame_token) → SurfaceId(FrameSinkId + LocalSurfaceId) → Viz aggregation → presentation feedback → pixels`

與 observation plane 分開：

`DOMSnapshot + AX Tree + Page screenshot → ObservationEpoch`

兩者只有在 Runtime 能取得/注入 native frame/surface witness 並建立 capture binding 時，才可升級為 `PRESENTATION_BOUND`；否則最多是 `BOUNDED_STRONG`。

## 本小時最重要 5 個發現

### 1. Compositor commit 是 main-thread world 與 compositor world 的版本邊界，但不是 presentation
**已確認／Chromium 官方架構。** Main thread 的 LayerTreeHost 與 compositor thread 的 LayerTreeHostImpl 是分離副本；commit 把 main-thread state 同步到 compositor，之後 compositor 可以不詢問 main thread 繼續 draw，並能自行處理 scroll、部分 CSS animation/filter。因此 `DOM state at t` 不能直接等同 `pixels at t`。

底層：`DOM/style mutation → setNeedsCommit → scheduler → rAF/layout/paint → beginCommit → tree sync → active compositor tree → draw`。

重要性：Hermes 的 observation graph 必須顯式保留 `MAIN_STATE → COMMIT → COMPOSITOR_STATE → PRESENTED_FRAME`，不能用 screenshot timestamp 直接連回 DOM revision。

限制：commit 之後仍可能有 compositor-only visual evolution。

### 2. SurfaceId 是比 screenshot timestamp 更強的 rendered-surface identity
**已確認／Chromium 原始碼。** `LocalSurfaceId` 註解明確定義：它在單一 client 內唯一；`FrameSinkId + LocalSurfaceId = SurfaceId`，可跨 clients 全域識別 surface。LocalSurfaceId 具有 parent/child sequence number 與 embed token，並有 submission trace id。

這使 Hermes 可以新增：
`RenderedSurfaceWitness { frameSinkId, localSurfaceId, embedToken, submissionTraceId }`。

限制：SurfaceId 識別 surface lifetime/version boundary，不等於每一次實際 presented frame 的唯一 pixel identity。

### 3. frame_token 可以把 compositor frame 與 presentation feedback 關聯
**已確認／Chromium 原始碼。** `CompositorFrameMetadata` 有 frame-token generator；Chromium `PresentationTimeCallbackBuffer` 明確以 `CompositorFrameMetadata::frame_token` 對應 presentation feedback；`FrameData.frame_token` 由 LayerTreeHostImpl 在 submission 時填入。

因此更精確的 witness 是：
`SurfaceId + frame_token + presentation feedback`。

這比 `screenshot captured at 08:52:01.123` 更接近「使用者真正可能看到的 frame」。

限制：frame_token 本身不是跨所有 FrameSink 的 universal global revision。

### 4. OOPIF 讓 top-level screenshot 成為多 surface aggregation 問題
**已確認／Chromium Surfaces/OOPIF architecture。** Viz surfaces 用來嵌入 heterogeneous/untrusted clients；每個 client 可提交自己的 surface/frame，top-level display 再聚合。故含 cross-origin iframe 的 screenshot 不能只綁 root renderer 的 DOM revision。

需要：
`RootSurface → EmbeddedSurfaceRefs → Child SurfaceIds → AggregatedFrame → Screenshot`。

這把上一輪 `CrossModalCorrespondenceProof` 再細化成 **Cross-Process Render Correspondence**。

### 5. 真正可用的 Action Freshness Gate 應依 action modality 要求不同 proof strength
**Hermes architecture proposal，受 StateAct、Temporal UI State Inconsistency、OSWorld 2.0 交叉支持。** StateAct 顯示 program-state grounding 有價值但 code-only 不足；Temporal UI State Inconsistency 顯示 observation→action gap 形成 TOCTOU，且 pixel-only verification 對 zero-visual DOM mutation存在盲點；OSWorld 2.0 顯示 dynamic environment、cross-source reasoning、hidden state recovery 仍是 frontier agents 的主要失敗面。

因此：
- semantic API action：canonical state + provider revision
- DOM/AX action：document/frame identity + structural freshness
- visual coordinate action：structural freshness + RenderedFrameWitness + target-region revalidation
- OOPIF/canvas/video：surface aggregation witness + tighter recapture

## Architecture Breakdown

### Chromium Render-to-Presentation chain

```text
JavaScript / DOM / Style
        ↓
Blink lifecycle
        ↓
Layout
        ↓
Paint records
        ↓
LayerTreeHost (main)
        ↓ COMMIT
LayerTreeHostImpl (compositor)
        ↓ activation/draw
CompositorFrame
  ├─ frame_token
  ├─ metadata
  └─ referenced surfaces
        ↓
SurfaceId = FrameSinkId + LocalSurfaceId
        ↓
Viz Surface aggregation
        ↓
Display / Presentation
        ↓
Pixels
```

### Hermes Observation Proof Plane

```text
DOMSnapshot ─┐
AX Tree ─────┼→ ObservationEpoch
Screenshot ──┘       ↓
                  CaptureBound
                       ↓
Native compositor instrumentation
SurfaceId + frame_token + presentation feedback
                       ↓
                RenderedFrameWitness
                       ↓
              CorrespondenceAdmissionGate
                       ↓
          PASS / BOUNDED / UNKNOWN / BROKEN
```

### Proof levels

- `L0 TIMESTAMP_ONLY`
- `L1 DOCUMENT_BOUND`: frameId + loader/document identity
- `L2 STRUCTURE_BOUND`: DOM/AX capture + mutation fences
- `L3 SURFACE_BOUND`: SurfaceId known
- `L4 FRAME_BOUND`: SurfaceId + compositor frame_token
- `L5 PRESENTATION_BOUND`: frame token linked to presentation feedback and capture

Hermes 不應把 L0-L4 顯示成 atomic screenshot proof；只有 L5 能宣稱「這個 compositor frame 有 presentation witness」，但即使 L5 仍不自動證明 DOM/AX 是同一 revision。

## Bottom-Level Logic

### Surface identity

`SurfaceId := FrameSinkId ⊕ LocalSurfaceId`

`LocalSurfaceId := parent_sequence + child_sequence + embed_token`

它回答的是「哪個 client embedding/version 的 surface」，不是「哪一個 DOM revision」。

### Frame identity

`CompositorFrameMetadata.frame_token` 由 compositor submission 路徑產生，可用於將 presentation feedback 關聯到相關 compositor frame。

因此：

`RenderedFrameWitness := SurfaceIdentity + FrameToken + PresentationEvidence`

### Correspondence 仍需另一條證明

即使知道 `Presented(frame_token=471)`，仍需回答：

`DOMSnapshot D41 → 哪次 commit → 哪個 compositor frame 471？`

目前公開 CDP 沒有直接提供這條完整 mapping，所以 Hermes 必須標記：

`DOM_TO_PRESENTED_FRAME = UNKNOWN/BOUNDED`

除非透過 Chromium instrumentation / tracing / custom bridge 建立 witness。

## Visual Simulation Idea

### Render-to-Presentation Witness Microscope

五條 timeline：

```text
BLINK       D41 ─ layout ─ paint ─ D42
COMMIT             C17          C18
COMPOSITOR            Active17 ───── Active18
VIZ                   S7/F471 ─ S7/F472
DISPLAY                    present471   present472
SCREENSHOT                     capture X
```

互動 fault injection：
- DOM changes after commit
- compositor-only animation
- scroll on impl thread
- OOPIF child surface updates independently
- screenshot between child/root surface updates
- frame submitted but not presented
- stale presentation feedback
- navigation swaps loader/document

UI 即時顯示：`Document Revision / Commit Boundary / SurfaceId / FrameToken / Presentation Status / OOPIF Surface Set / Correspondence Strength / Action Proof Requirement`。

## Code / GitHub

### chromium/chromium
值得持續讀：
- `components/viz/common/surfaces/local_surface_id.h` — Surface identity / sequence / embed token
- `components/viz/common/quads/compositor_frame_metadata.h` — frame token / frame metadata
- `cc/trees/frame_data.h` — frame_token submission provenance
- `cc/trees/layer_tree_host_impl.cc` — active tree → compositor frame metadata
- `cc/trees/presentation_time_callback_buffer.h` — frame token ↔ presentation feedback
- `components/viz/service/` — surface aggregation / display
- `content/browser/renderer_host/frame_token_message_queue.*` — processed frame token ordering

### Hermes implementation target
新增 runtime IR：

```ts
type RenderedFrameWitness = {
  frameSinkId?: string
  localSurfaceId?: string
  frameToken?: number
  presentationTime?: number
  documentId?: string
  loaderId?: string
  captureTime: number
  strength: 'timestamp'|'document'|'structure'|'surface'|'frame'|'presentation'
  childSurfaces?: RenderedFrameWitness[]
}
```

## Papers

### StateAct: Program State, before Pixels, for Long-Horizon Computer-Use Agents
Authors: Yan Yang et al.  
Year: 2026  
Architecture: code-first main agent + GUI specialist + independent finish gate.  
Contribution: program-state grounding improves OSWorld 2.0 long-horizon execution, but code-only remains worse than hybrid state+GUI.  
Limitation: does not solve browser-native DOM→compositor→presentation correspondence.

### Temporal UI State Inconsistency in Desktop GUI Agents
Author: Wenpeng Xu  
Year: 2026  
Architecture: pre-execution layered UI verification.  
Contribution: formalizes visual TOCTOU and measures a 6.51s average observation-action gap on OSWorld workloads.  
Limitation: pixel/window checks have a structural blind spot for zero-visual-footprint DOM mutation.

### OSWorld 2.0
Authors: Mengqi Yuan et al.  
Year: 2026  
Dataset: 108 long-horizon workflows.  
Contribution: exposes dynamic environments, hidden state, cross-source reasoning and verification failures at realistic horizon.  
Limitation: benchmark diagnoses agent behavior; it does not supply a native compositor correspondence proof.

## Unknown / Open Questions

1. 能否利用 Chrome tracing/Perfetto 中 LocalSurfaceId submission trace id + frame token，自動重建 `DOM lifecycle → commit → compositor submission → presentation` 的 causal chain？
2. `Page.captureScreenshot` 的 pixels 在不同平台/headless/headful 路徑中，能否穩定綁定到某個 Viz aggregated frame token，而不修改 Chromium？目前未確認。
3. OOPIF child surfaces 更新與 root aggregation 間，如何建立一個可供 Agent 使用的 `PresentedSurfaceSet`，避免 root fresh / child stale 的假一致性？

## 下一輪研究

下一輪優先深入：

`Perfetto / Chromium tracing → submission_trace_id → frame_token → FrameTimingDetails → presentation feedback → Viz aggregation`

目標是把 `RenderedFrameWitness` 從資料結構 proposal 變成可實作的 instrumentation path，並確認能否在未修改 Chromium 的情況下透過 CDP tracing 取得足夠 evidence。

第二條：

`OOPIF root Surface → child SurfaceRange → aggregated frame → presentation`

建立 `PresentedSurfaceSet` 與 partial-staleness detection。

## Knowledge Graph 新增 Node / Edge

### Nodes
- `RenderedFrameWitness`
- `RenderedSurfaceWitness`
- `SurfaceId`
- `LocalSurfaceId`
- `FrameSinkId`
- `CompositorFrameToken`
- `PresentationFeedback`
- `PresentedSurfaceSet`
- `CompositorCommitBoundary`
- `ActiveCompositorTree`
- `VizAggregation`
- `CrossProcessRenderCorrespondence`
- `PresentationBoundObservation`

### Edges
- `BlinkState --COMMITTED_AS--> ActiveCompositorTree`
- `ActiveCompositorTree --SUBMITS--> CompositorFrame`
- `CompositorFrame --IDENTIFIED_BY--> FrameToken`
- `CompositorFrame --TARGETS--> SurfaceId`
- `SurfaceId --EMBEDS--> ChildSurfaceId`
- `FrameToken --CORRELATED_WITH--> PresentationFeedback`
- `RenderedFrameWitness --SUPPORTS--> ScreenshotObservation`
- `ScreenshotObservation --GROUNDS--> VisualAction`

## 本輪結束判斷

- **缺哪一層：** DOM/Blink lifecycle revision 到 compositor frame token 的 native causal binding，以及 screenshot capture 到 Viz presented frame 的 binding。
- **哪個節點最淺：** `PresentedSurfaceSet`，尤其 OOPIF child surface 的 partial freshness。
- **哪個概念仍只是名詞：** `DOM_TO_PRESENTED_FRAME proof`；目前只能提出 instrumentation route，尚不能宣稱公開 CDP 已直接提供。
- **哪個系統值得讀原始碼：** Chromium `cc/trees` + `components/viz/service` + `content/browser/renderer_host/frame_token_message_queue`。
- **哪篇論文需追引用：** Temporal UI State Inconsistency 與 StateAct，前者連到 TOCTOU verification，後者連到 hybrid state/pixel grounding。
- **哪個概念最適合視覺模擬：** Render-to-Presentation Witness Microscope。
- **哪個 Agent 架構最值得實作：** `State-grounded planner + visual specialist + ObservationEpoch + RenderedFrameWitness + pre-action proof gate`。

## 本輪核心結論

可靠 Computer Agent 的「我看到這個畫面」應繼續拆成：

`Program/DOM State → Blink lifecycle → Commit → Compositor Active Tree → CompositorFrame → Surface/Viz aggregation → Presentation → Screenshot Observation → Context → Reasoning → Plan → ActionFreshnessGate → Action`。

這輪找到 Chromium 內真正可用的 native identity primitives：`SurfaceId` 與 `frame_token/presentation feedback`。它們讓 Hermes 能把 pixels 從模糊 timestamp 提升成具 compositor provenance 的 evidence；但它們仍沒有自動把 DOM/AX 與 pixels變成同一 atomic revision。正確做法是保存 proof strength，證明到哪裡就顯示到哪裡，剩下的 correspondence 保持 `UNKNOWN/BOUNDED`，而不是虛構「模型看到的畫面就是現在的世界」。