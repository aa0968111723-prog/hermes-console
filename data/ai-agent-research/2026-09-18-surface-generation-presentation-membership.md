# 【AI Agent × Multimodal Research Report】

時間：2026-09-18 21:51（Asia/Taipei）

## 本小時新發現

主題：Surface Frame Generation × Presentation Membership × Region Contribution Boundary。

本輪承接上一輪 SourceFrame → PresentationGroup 的 causal binding，專門驗證最淺節點 `SurfaceFrameGenerationWitness`。核心修正：`frame_token`、`SurfaceId`、`frame_index` 是不同 identity domain；PresentationHelper 保存的是 active frame 的 `frame_token`，而 SurfaceAggregator 的 contained-surface map 保存的是 aggregation 當下該 Surface 的 active-frame index。兩者需要在同一 aggregation epoch 被共同取證，不能事後只靠其中一個欄位重建。

## 本小時最重要 5 個發現

### 1. PresentationHelper 綁定 active frame token，但不是 pixel contribution proof
已確認事實：Chromium `Surface::TakePresentationHelperForPresentNotification()` 僅在 active frame 尚未被標記 presentation notification 時建立 helper，helper 保存該 active frame metadata 的 `frame_token`；`DidPresent()` 再把 feedback 回送 SurfaceClient。這形成 source-frame → presentation feedback 的 causal callback，但沒有記錄 target pixel、quad 或 clip。

來源：https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/surfaces/surface.cc

### 2. SurfaceAggregator 的 contained surface identity 包含 active-frame generation
已確認事實：`SurfaceAggregator::SurfaceIndexMap` 是 `SurfaceId → uint64_t`，註解明確定義為「每個上次 aggregation 使用的 Surface，在當時的 frame_index」。damage logic 會比較 previous index 與 `GetActiveFrameIndex()`，因此 frame index 是辨識同一 Surface 是否換了一代 active content 的實際 runtime primitive。

來源：https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/display/surface_aggregator.h
來源：https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/display/surface_aggregator.cc

### 3. PresentationGroup membership 是 aggregation-level fan-out，不等於 region-level contribution
已確認事實：`Display::DrawAndSwap()` 遍歷 `aggregator_->previous_contained_surfaces()`，從每個 Surface 取得 PresentationHelper 加入 `PresentationGroupTiming`；`OnPresent()` 對 group 中所有 helpers fan-out 同一份 PresentationFeedback。因此 group membership 證明 source active frame 屬於本次 presented aggregation 的 notification set，但不能證明該 source 對某 target region 有可見 pixel contribution。

來源：https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/service/display/display.cc

### 4. Source generation identity 應是 tuple，不應只用 frame_token
工程建模（合理推論）：Hermes 應定義：

`SurfaceFrameGeneration = (SurfaceId, ActiveFrameIndex, FrameToken)`

其中 SurfaceId 給 compositor surface identity；ActiveFrameIndex 給該 surface 的 active-content generation；FrameToken 給 producer/client presentation callback identity。三者只有在同一 aggregation epoch 一起觀察時才形成較強 witness。尚未驗證：這個 tuple 是否在所有 interpolation/fallback/activation corner cases 都足以唯一描述 rendered generation。

### 5. GUI Agent 的 observation verifier 必須辨識 transition source
論文結果：Desktop-Delta Bench（Pillai, Nayak, Chen, 2026）用 2,013 個 human-verified desktop transition instances 專測 state verification、source tracking、context-aware control；最佳 temporal-ordering exact match 約 65%，顯示「下一張 screenshot」不天然等於「上一 action 造成的 transition」。這與 compositor provenance 的結論一致：Agent 需要 source/generation/timing evidence，而不是只比較 bitmap。

Paper: Desktop-Delta Bench: Do Computer-Use Models Understand Desktop GUI Transitions?
Authors: Abhishek Pillai, Samir Kumar Nayak, Yuan Chen
Year: 2026
URL: https://arxiv.org/abs/2607.26041
Dataset: 2,013 human-verified Linux desktop transition instances
Architecture/Eval: 3-frame temporal ordering + before/after action inference
Contribution: isolates transition reconstruction/source tracking between grounding and end-task success
Limitation: offline benchmark；不直接提供 browser compositor ground truth

## Architecture Breakdown

```text
Renderer / Child Renderer
  → CompositorFrame(frame_token)
  → Surface pending frame
  → activation
  → Surface active frame
       ├─ SurfaceId
       ├─ ActiveFrameIndex
       └─ frame_token
  → ResolvedFrameData
  → SurfaceAggregator
       ├─ contained_surfaces[SurfaceId] = ActiveFrameIndex
       └─ quad/render-pass contribution
  → Display aggregation epoch
       ├─ PresentationHelper(frame_token)
       ├─ PresentationGroupTiming
       ├─ swap_trace_id
       └─ VSyncId/deadline
  → platform present
  → PresentationFeedback
  → helper fan-out to original frame_token
  → FrameTimingDetails
```

關鍵 invariant：

`PresentedGroupMember(source generation) != VisibleContributor(source generation, region)`

## Bottom-Level Logic

Hermes 應新增 aggregation-time witness：

```text
SurfaceFrameGenerationWitness {
  aggregationEpoch,
  surfaceId,
  activeFrameIndex,
  frameToken,
  localSurfaceId,
  presentationHelperTaken,
  presentationGroupId,
  swapTraceId?,
  vsyncId?,
  contributionState
}
```

`contributionState` 不可由 PresentationHelper 推導，應獨立取自 aggregation/render provenance：

```text
ACTIVE
→ RESOLVED
→ CONTAINED
→ QUAD_CONTRIBUTOR
→ REGION_INTERSECTING
→ VISUALLY_CONTRIBUTING
→ PRESENTED_GROUP_MEMBER
→ CAPTURE_INCLUDED
```

這些狀態不是單一線性等價鏈；例如 CONTAINED + PRESENTED_GROUP_MEMBER 仍可能因 occlusion/filter/overlay/capture boundary 而不是 target-region 的 CAPTURE_INCLUDED contributor。

## Visual Simulation Idea

### Surface Generation & Presentation Membership Microscope

左側顯示每個 Surface 的 pending/active generations；中間顯示 aggregation epoch；右側顯示 PresentationGroup 與 capture。

```text
Surface S1
 g40 F470 ─ retired
 g41 F471 ─ ACTIVE ─┐
                    ├→ Aggregate A31 → Group G31 → PRESENT
Surface S2          │
 g17 C88  ─ ACTIVE ─┘
 g18 C89  ─ pending

Target region R
  S1@g41: VISIBLE CONTRIBUTOR
  S2@g17: GROUP MEMBER / OCCLUDED AT R
```

互動注入：active-frame replacement、pending activation delay、fallback SurfaceRange、OOPIF late frame、occlusion、copy request、capture-before-next-activation。UI 每條 edge 顯示 CAUSAL / GENERATION-BOUND / GROUP-BOUND / REGION-BOUND / UNKNOWN / BROKEN。

## Code / GitHub

本輪值得持續追的 Chromium 核心檔案：

- `components/viz/service/surfaces/surface.cc` — active/pending frame lifecycle、PresentationHelper。
- `components/viz/service/display/surface_aggregator.h` — `SurfaceIndexMap` 與 contained surface generation。
- `components/viz/service/display/surface_aggregator.cc` — `ResolvedFrameData`、damage/generation comparison、surface traversal。
- `components/viz/service/display/display.cc` — `PresentationGroupTiming` 與 helper collection/fan-out。
- `components/viz/service/frame_sinks/compositor_frame_sink_support.cc` — frame_token → FrameTimingDetails。

## Papers

Desktop-Delta Bench — Pillai, Nayak, Chen — 2026 — https://arxiv.org/abs/2607.26041 。改變：把 GUI agent 評估從 static grounding/end success 補上 causal transition reconstruction/source tracking 層。

AndroidDaily — Sui et al. — 2026 — https://arxiv.org/abs/2605.27761 。350 tasks / 94 closed-source Android apps；GRADE 以 observable process guidelines 做 step-level verification，與人類評估 87.37% agreement。限制：observable verification 仍不是 OS compositor causal identity。

OmniGUI — Henry et al. — 2026 — https://arxiv.org/abs/2605.18758 。709 episodes / 2,579 steps / 29 apps，加入 image+audio+video synchronous inputs；顯示 temporal/multimodal observation 本身是 Agent state 的一部分。限制：benchmark 不追 display/capture provenance。

## Unknown / Open Questions

1. `(SurfaceId, ActiveFrameIndex, FrameToken)` 在 interpolated frame、fallback SurfaceRange、surface eviction/recreation 下是否足以作為穩定 generation key？
2. `previous_contained_surfaces()` 的 membership 與真正 copied/drawn quad contribution之間，能否在現有 ResolvedFrameData/ResolvedPassData 中抽出 region-level witness，而不必侵入 renderer？
3. 如何把 source generation witness 接到 CopyOutput/CDP/OS capture buffer identity，形成 `PresentedSourceGeneration → CapturedRegion` causal edge？

## 下一輪研究

直接追 `ResolvedFrameData`、`ResolvedPassData`、`CopyQuadsToPass`、SurfaceDrawQuad resolution 與 `contained_surfaces_` 寫入點，建立 `SourceGenerationContributionSet`。優先驗證 fallback SurfaceRange 與 active-frame replacement：到底哪個 `(SurfaceId, frame_index, frame_token)` 的 quads 被複製到 AggregatedRenderPass，以及 PresentationHelper collection 是否與該 generation 完全同步。

## Knowledge Graph 新增 Node / Edge

Nodes:
- SurfaceFrameGeneration
- SurfaceFrameGenerationWitness
- AggregationEpoch
- ActiveFrameIndex
- SourceGenerationContributionSet
- PresentationNotificationGeneration
- RegionContributionState
- GenerationReplacementBoundary

Edges:
- `CompositorFrame --ACTIVATES_AS--> SurfaceFrameGeneration`
- `SurfaceFrameGeneration --RESOLVED_IN--> AggregationEpoch`
- `AggregationEpoch --RECORDS_FRAME_INDEX--> ActiveFrameIndex`
- `SurfaceFrameGeneration --MEMBER_OF--> PresentationGroupTiming`
- `PresentationGroupTiming --FANS_OUT_FEEDBACK_TO--> FrameToken`
- `SurfaceFrameGeneration --MAY_CONTRIBUTE_TO--> TargetRegion`
- `RegionContributionWitness --REFINES--> GroupMembershipProof`

## 本輪結束判定

缺哪一層：`Surface generation → exact quad/region contribution → capture inclusion`。

哪個節點最淺：`SourceGenerationContributionSet`。

哪個概念仍只是名詞：跨 fallback/interpolation corner cases 的 `StableSurfaceGenerationIdentity`。

哪個系統值得讀原始碼：Chromium Viz `ResolvedFrameData + SurfaceAggregator + Display::PresentationGroupTiming`。

哪篇論文需追引用：Desktop-Delta Bench，尤其 source tracking / asynchronous observation 後續工作。

哪個概念最適合視覺模擬：Surface Generation & Presentation Membership Microscope。

哪個 Agent 架構最值得實作：`State-grounded Planner + Active Visual Subagent + Generation-aware Observation Evidence DAG + TransitionEvidenceVerifier + Risk-Adaptive Action Gate`。

最終鏈目前更新為：

`使用者輸入 → UI → Agent Runtime → Context/Memory → Reasoning/Planning → Tool/Computer Intent → Browser semantic state → Renderer CompositorFrame → SurfaceFrameGeneration → Display Aggregation → PresentationGroup → Platform Present → Capture Boundary → Pixels → Vision Encoder → Visual Tokens → Multimodal Fusion → Reasoning → Action Gate → Action → Transition Verification → Output`。
