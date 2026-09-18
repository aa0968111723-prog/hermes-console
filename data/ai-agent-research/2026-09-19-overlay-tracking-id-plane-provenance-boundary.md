# 【AI Agent × Multimodal Research Report】

時間：2026-09-19 00:54（Asia/Taipei）

主題：OverlayCandidate TrackingId × Strategy Identity × Platform Plane Provenance Boundary

## 本小時新發現

本輪延續上一輪 `AggregatedDrawQuad → OverlayCandidate → PresentedPlane` 的缺口，集中驗證 Chromium `OverlayCandidate::tracking_id` 能否作為 Hermes 的跨層 causal provenance ID。結論是否定的：它適合做 temporal/heuristic tracking，但不能單獨證明「這個 source generation / quad 就是最後被平台呈現的這個 plane」。Chromium 原始碼自己明確警告 tracking_id 只是 ideally unique，且會 collision；同一 surface、相同 DrawQuad::rect 的多個 candidate 會得到同一 tracking_id。因此 Hermes 必須把它降級為 evidence hint，而不是 causal identity。

同時找到更精確的 strategy-level identity：`ProposedCandidateKey = tracking_id + OverlayStrategy`。這可以區分同一 temporal candidate 經由不同 overlay strategy 被提議，但仍不能唯一表示 platform buffer / plane generation。

新 benchmark：WindowsWorld（ACL Findings 2026）包含 181 個跨 17 個 desktop apps 的專業工作流任務，78% 為 multi-application；領先 computer-use agents 在 multi-app 任務成功率仍低於 21%。這支持 Hermes 將 provenance/verification 放在 runtime，而不是只提升 screenshot grounding。

## 本小時最重要 5 個發現

### 1. `tracking_id` 不是 causal ID

**已確認工程事實**：Chromium `OverlayCandidate` 將 `TrackingId` 定義為 `uint32_t`，註解明確稱它只是 ideally unique；同一 surface 且 DrawQuad rect 相同的 candidates 會共享 tracking_id，並警告 collision 可能高於單純 32-bit birthday paradox 的預期。

底層含義：

```text
AggregatedDrawQuad
→ OverlayCandidate(tracking_id=T17)

T17 ≠ unique quad identity
T17 ≠ resource generation identity
T17 ≠ platform plane identity
T17 ≠ presentation identity
```

因此上一輪提出的 `RenderPrimitiveLineageId` 不能直接以 Chromium tracking_id 實作。

來源：Chromium `components/viz/service/display/overlay_candidate.h`（main，2026-09-19 讀取）；Chromium Gitiles 同檔案。

### 2. Chromium 實際存在 `tracking_id + strategy_id` 的 proposal key

**已確認工程事實**：`OverlayProposedCandidate` 保存 QuadList iterator、OverlayCandidate 與 OverlayProcessorStrategy；`ProposedCandidateKey` 由 `tracking_id` 和 `OverlayStrategy` 組成。

```text
DrawQuad
→ OverlayCandidate T17
→ Strategy S_underlay
→ ProposedCandidateKey(T17, S_underlay)
```

這比單一 tracking_id 更精確，因為同一 candidate 可以在不同 promotion strategy 下有不同 proposal identity。但它仍然只處於 **proposal/strategy domain**，沒有證明 OS compositor 最後接受了哪個 buffer/plane。

### 3. `resource_id/mailbox` 比 tracking_id 更接近 content identity，但仍有 generation 問題

**已確認工程事實**：OverlayCandidate 同時保存 `resource_id` 與由 resource 導出的 GPU mailbox，並包含 display_rect、uv_rect、clip_rect、z-order、opacity、protected-video type 等 composition semantics。

合理工程推論：Hermes plane provenance 應以複合 witness 建模，而不是單一 ID：

```text
OverlayPlaneCandidateWitness =
  source_generation
+ aggregated_quad_lineage
+ tracking_id
+ strategy_id
+ resource_id
+ mailbox
+ resource_generation?
+ display_rect
+ uv_rect
+ clip
+ z_order
+ composition_epoch
```

其中 `resource_generation` / `composition_epoch` 仍是 Hermes sidecar，尚未證明 Chromium 提供完整 native invariant。

### 4. overlay candidate 的 geometry 本身就是 pixel provenance 的必要部分

**已確認工程事實**：Chromium `ApplyClip()` 不只是裁 display rect；它會把 clipping 比例映射回 UV rect，亦即 screen-space visible region 與 buffer-space sample region共同改變。

```text
Buffer UV
→ transform
→ display_rect
→ clip intersection
→ proportional UV remap
→ presented candidate region
```

所以「哪個 resource 被呈現」仍不足以回答「target pixel 來自 buffer 的哪一塊」。Hermes 需要 `RegionMappingWitness`。

### 5. Computer Agent 的主要問題已從單點 grounding 延伸到跨介面 trajectory verification

**論文結果**：WindowsWorld（Jinchao Li et al., HITsz，ACL Findings 2026）有 181 tasks、17 apps、平均 5 sub-goals，78% multi-application；leading agents 在 multi-app tasks 成功率 <21%。WeaveBench（Microsoft Research Asia / Zhejiang / Tsinghua，2026）則以 trajectory-aware judge 檢查 screenshots、logs、deliverables 與 action traces，最佳 PassRate 41.2%。

這兩者支持 Hermes 的 runtime 設計：

```text
Perception
→ State / Pixel Provenance
→ Action
→ Transition Evidence
→ Cross-interface State
→ Verification
→ Next Decision
```

而不是只做：

```text
Screenshot → VLM → Click
```

## Architecture Breakdown

本輪 system architecture：Chromium Overlay Proposal / Strategy / Presentation Boundary。

```text
Surface Generation
→ ResolvedFrameData
→ AggregatedDrawQuad
→ OverlayCandidateFactory
→ OverlayCandidate
   ├ tracking_id
   ├ resource_id
   ├ mailbox
   ├ display_rect
   ├ uv_rect
   ├ clip_rect
   ├ plane_z_order
   └ protected_video_type
→ OverlayProposedCandidate
   ├ tracking_id
   └ strategy_id
→ Overlay Strategy Selection
→ overlay_handled / fallback
→ Renderer / Scheduled Planes
→ Platform-specific compositor
→ PresentationFeedback
```

Hermes 應插入：

```text
AggregatedQuadLineage
→ OverlayProposalWitness
→ OverlayStrategyDecisionWitness
→ ScheduledPlaneWitness
→ PlatformPlaneWitness
→ PresentationWitness
```

每一層分開，不允許 tracking_id 跨層冒充 global ID。

## Bottom-Level Logic

本輪深入機制：`ApplyClip()` 的 screen-space ↔ buffer-space mapping。

```text
candidate.display_rect = D
candidate.uv_rect      = U
clip_rect              = C

I = intersection(D, C)
U' = ScaleRectProportional(U, D, I)
D' = I
```

如果存在 overlay transform，Chromium 先將 UV 映射到與 display_rect 相同 orientation，做 proportional clipping 後再 inverse-map 回 buffer UV space。

因此 pixel provenance 應至少表示：

```text
TargetRegion R
→ intersect candidate.display_rect
→ inverse geometry mapping
→ candidate.uv_rect subset
→ GPU resource/mailbox region
```

這是 `RegionContributionProof` 從 rectangle-level 前進到 buffer-sampling-level 的必要步驟。

## Visual Simulation Idea

### Overlay Identity Collision & Plane Provenance Lab

左右兩區：

```text
SOURCE / VIZ                         PLATFORM
S1@g41 F471                          Plane P3
  ↓                                    ↑
AggregatedQuad Q17                    │
  ↓                                    │
Candidate T88 ─ strategy A ───────────┤
Candidate T88 ─ strategy B ──X        │
  ↑
S1@g42 F479 / same rect
```

互動注入：
- same surface + same DrawQuad rect → tracking_id collision
- resource/mailbox replacement
- strategy change overlay ↔ underlay
- clip / UV remap
- z-order change
- protected video requiring overlay
- copy request disabling promotion
- buffer reuse across composition epochs

UI 每條 edge 顯示：`TEMPORAL_HINT / STRATEGY_BOUND / RESOURCE_BOUND / REGION_BOUND / PLATFORM_BOUND / PRESENTED / UNKNOWN / BROKEN`。

## Code / GitHub

值得繼續讀的 Chromium 目錄／核心檔案：

- `components/viz/service/display/overlay_candidate.h`
- `components/viz/service/display/overlay_candidate.cc`
- `components/viz/service/display/overlay_proposed_candidate.h`
- `components/viz/service/display/overlay_processor_using_strategy.*`
- `components/viz/service/display/overlay_strategy_*`
- `components/viz/service/display/direct_renderer.*`
- Android SurfaceControl presenter / overlay processor
- Windows DComp presenter / layer overlay processor

本輪確認：`tracking_id` 是 temporal identification hint，原始碼明確承認 collision；`ProposedCandidateKey` 使用 `(tracking_id, strategy_id)`。

## Papers

### WindowsWorld: A Process-Centric Benchmark of Autonomous GUI Agents in Professional Cross-Application Environments
- Authors: Jinchao Li, Yunxin Li, Chenrui Zhao, Zhenran Xu, Baotian Hu, Min Zhang
- Institution: Harbin Institute of Technology, Shenzhen（作者 affiliation 依論文）
- Year: 2026
- Venue: Findings of ACL 2026
- URL: https://aclanthology.org/2026.findings-acl.750/
- Code: https://github.com/HITsz-TMG/WindowsWorld
- Dataset: 181 tasks, 17 desktop applications, avg. 5.0 sub-goals; 78% multi-app
- Architecture/Evaluation: process-centric multi-step cross-application GUI workflows with intermediate inspection
- Contribution: 把 computer-use 評估從 isolated app 推向跨應用專業工作流
- Limitation: benchmark success 無法直接證明低層 pixel/presentation provenance；它驗證的是上層 agent workflow reliability
- 改變了什麼：顯示即使 GUI grounding 進步，跨 app conditional reasoning / execution orchestration 仍是主要 failure surface。

### WeaveBench: A Long-Horizon, Real-World Benchmark for Computer-Use Agents with Hybrid Interfaces
- Authors: Wanli Li et al.
- Institutions: Zhejiang University, Microsoft Research Asia, Tsinghua University
- Year: 2026
- URL: https://arxiv.org/abs/2606.09426
- Code: https://github.com/weavebench/WeaveBench
- Dataset: 114 tasks / 8 real-world domains
- Architecture: GUI + CLI/code hybrid trajectories; trajectory-aware judge
- Contribution: outcome-only evaluation 會高估 agent；需驗證 trajectory evidence
- Limitation: 不提供 browser compositor → capture pixel 的 causal provenance
- 改變了什麼：支持 Hermes 將 evidence graph 擴展到 action trajectory，而非只保存 final state。

## Unknown / Open Questions

1. Chromium `tracking_id` 的 producer 究竟如何由 Surface/DrawQuad rect 計算？是否還混入 render-pass / surface namespace，碰撞域多大？
2. Overlay strategy 成功後，哪一個 native structure 最接近「ScheduledPlane identity」？Android SurfaceControl / Windows DComp / Ozone overlay paths 是否能共享一個抽象 witness？
3. `resource_id + mailbox` 在 buffer reuse、SharedImage backing replacement、overlay promotion across frames 下，如何建立 generation-safe identity？

## 下一輪研究

直接追：

```text
OverlayCandidate(tracking_id, resource_id, mailbox)
→ Overlay strategy result
→ DirectRenderer overlay_list
→ OutputSurface / Presenter scheduled planes
→ Android SurfaceControl / Windows DComp concrete buffer
→ presentation feedback
```

優先找到 `ScheduledPlaneWitness` 的真實 runtime fields，並確認 resource/mailbox 是否一路保留到 platform presenter；若 platform path 重新 materialize buffer，則建立 explicit `ResourceToPlatformBufferEdge`，不可用 tracking_id 猜測。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：
- `OverlayTemporalTrackingId`
- `OverlayTrackingCollisionDomain`
- `OverlayProposalWitness`
- `OverlayStrategyIdentity`
- `OverlayStrategyDecisionWitness`
- `OverlayResourceWitness`
- `RegionMappingWitness`
- `ScheduledPlaneWitness`
- `ResourceGenerationWitness`
- `ResourceToPlatformBufferEdge`

新增 Edges：

```text
AggregatedDrawQuad --PROPOSED_AS--> OverlayCandidate
OverlayCandidate --TEMPORALLY_HINTED_BY--> OverlayTemporalTrackingId
OverlayCandidate --EVALUATED_BY--> OverlayStrategy
OverlayProposalWitness --KEYED_BY--> (tracking_id, strategy_id)
OverlayCandidate --SAMPLES_FROM--> GPUResource
GPUResource --EXPOSED_AS--> Mailbox
TargetRegion --MAPPED_THROUGH--> RegionMappingWitness
OverlayStrategyDecisionWitness --SCHEDULES?--> ScheduledPlaneWitness
ScheduledPlaneWitness --BACKED_BY?--> PlatformBuffer
PlatformBuffer --PRESENTED_BY?--> PlatformPresentationWitness
```

## 本輪結束判斷

- **缺哪一層**：Overlay strategy success → concrete scheduled plane / platform buffer identity。
- **哪個節點最淺**：`ScheduledPlaneWitness`。
- **哪個概念仍只是名詞**：跨平台 `ResourceToPlatformBufferEdge`。
- **哪個系統值得讀原始碼**：Chromium DirectRenderer + Android SurfaceControl presenter + Windows DComp presenter。
- **哪篇論文需追引用**：WindowsWorld，尤其 multi-app conditional reasoning failures 與 intermediate inspection verifier 的後續工作。
- **哪個概念最適合視覺模擬**：tracking_id collision + resource generation + overlay strategy branch 的 Plane Provenance Lab。
- **哪個 Agent 架構最值得實作**：`State-grounded Planner + Active Perception + Render/Plane Provenance DAG + Cross-interface Transition Verifier + Risk-Adaptive Action Gate`。

## 本輪核心修正

上一輪把 `tracking_id` 列為可能接起 `AggregatedDrawQuad → OverlayCandidate → ScheduledPlane` 的候選橋樑；本輪原始碼驗證後必須降級。Chromium 自己明確承認它可能碰撞，所以 Hermes 不應把它提升成 global provenance identity。正確方向是把它視為一個 temporal hint，與 source generation、resource/mailbox、strategy、geometry、composition epoch、platform buffer/presentation witness 組成 evidence bundle。這使知識圖譜從「找一個神奇 ID 串到底」進一步轉成「每一層保留可驗證 identity，跨層用有強度標記的 evidence edge 連接」。