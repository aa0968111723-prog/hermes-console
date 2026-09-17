# 【AI Agent × Multimodal Research Report】

**時間：2026-09-18 06:50（Asia/Taipei）**  
**主題：Cross-Modal Observation Bundle × Correspondence Proof × Structured State Boundary × Semantic Action Verification**

## 本小時新發現

本輪承接上一輪 `UnifiedObservationSet / ActionFreshnessGate / CrossModalCorrespondenceProof`，不再重複「每個 observation 要有 revision/freshness」；本輪專門追問：**DOM / Accessibility Tree / Screenshot / Program State 到底如何證明是同一個 world-state slice？如果無法證明，Agent 是否應該把它們視為不同 evidence，而不是拼成一個看似一致的 prompt？**

新來源包含 Chromium/Blink rendering pipeline、Playwright accessibility snapshots / MCP snapshots、ASIL（Agent-Software Interaction Layer, arXiv:2608.26991）及其 GitHub 原始碼 `src/asil/protocol.py`, `src/asil/adapter.py`, `docs/software-extension-architecture.md`。

## 本小時最重要 5 個發現

### 1. Cross-modal correspondence 不能用 wall-clock proximity 當 proof

**官方資訊：** Chromium/Blink 的畫面不是 DOM 的直接複製。概念鏈是：

`HTML/DOM + CSS/style → layout → paint → compositing → pixels`

而 accessibility tree 又是從 HTML semantics / ARIA / browser-computed accessibility semantics 建立的另一種 projection。不同 rendering stage 可被跳過、延遲或局部更新；JavaScript/main-thread scheduling 也會改變 observation capture 時序。

因此：

`timestamp(DOM) ≈ timestamp(AX) ≈ timestamp(Screenshot)`

不等於：

`DOM, AX, Screenshot represent exactly the same committed application state`。

Hermes 應把時間接近視為 correlation evidence，而不是 correspondence proof。

來源：https://developer.chrome.com/blog/inside-browser-part3 ; https://developer.chrome.com/docs/web-platform/blink ; https://playwright.dev/docs/aria-snapshots

### 2. Playwright MCP 已隱含「snapshot-scoped identity」語義

**官方資訊：** Playwright MCP 使用 accessibility snapshot 作為主要結構化 observation，每個 exposed element 有 snapshot-local ref；ref 只在該 snapshot/page state 有效，頁面改變後 stale ref 會失敗並要求重新 snapshot。官方也建議在需要 layout/visual context 時把 screenshot 與 snapshot 組合，而不是把 screenshot 當 interaction identity。

底層鏈：

`Page State S_t → AX Snapshot A_t → refs {e1,e2,...}`

`Page changes → A_(t+1) → old ref invalid/stale`

這支持 Hermes 將 element identity 綁定 `ObservationBundleId + RepresentationRevision`，而不是只保存 selector/ref 字串。

來源：https://playwright.dev/mcp/snapshots ; https://playwright.dev/docs/locators

### 3. ASIL 把「structured canonical state」與「rendering」刻意分開，這是 Correspondence Proof 的關鍵 architecture clue

**論文結果：** ASIL（Rui Xie, Lu Chen, Findings of EMNLP 2026）以 structured JSON observation + semantic actions 取代 screenshot-and-click，覆蓋 15 applications / 380 tasks；closed models 整體超過 80%，而 matched screenshot GUI control 在 50-step budget 下為 6.6% / 26.6%。論文本身強調 screenshot 是 state-incomplete projection。

**原始碼確認：** ASIL `Observation` 包含 `Meta / AppState / interactive_elements / Environment / Navigation / data_summary`；`Meta.observation_source` 明確區分 `file_parse | script_api | rest_api | dom_snapshot`。`ASILAdapter.observe()` 讀 canonical structured state，`execute()` 執行 semantic action並回傳 observation。

更重要的是 `adapter.py` 對 GUI scoring 明確存在 `sync_from_gui()`：GUI agent 雖操作真實視窗，但 scoring 仍透過 adapter canonical `observe()`；若 GUI action 沒有自動改到 canonical source，adapter 必須先把 live GUI state 同步回 canonical source。

因此可以建模：

`Canonical State C_r → Render R_k → Pixels P_k`

以及 GUI 反方向：

`GUI Effect → sync_from_gui → Canonical State C_(r+1)`

如果缺少 sync/commit witness，就不能假定 `P_k` 與 `C_r` 同版。

來源：https://arxiv.org/abs/2608.26991 ; https://github.com/sharryXR/ASIL/blob/main/src/asil/protocol.py ; https://github.com/sharryXR/ASIL/blob/main/src/asil/adapter.py

### 4. Structured state 仍不是「完整世界真相」；Rendering 必須保留成獨立 channel

**原始碼/官方 project docs：** ASIL 的 extension architecture 明確寫出 rendering 是 separate channel，因為 structurally correct state 仍可能需要 visible-layout inspection；opaque / primarily perceptual behavior 需要 manual 或 hybrid integration。

所以 Hermes 不應從「pixels 不完整」跳到「JSON 就是真相」。更可靠的是：

`Canonical structured state`
`+ visual/render evidence`
`+ accessibility semantics`
`+ backend/provider state`
`+ correspondence metadata`

共同形成 Observation Bundle。

這也解釋為什麼 `ScreenshotSame ≠ DOMSame`，反過來也有 `DOMSame ≠ PixelSame`（例如 animation/compositor/layout/environment differences）。

來源：https://github.com/sharryXR/ASIL/blob/main/docs/software-extension-architecture.md ; https://playwright.dev/docs/next/test-snapshots

### 5. Hermes 應從 ObservationRecord 升級為 ObservationBundle + Correspondence Edges

**Hermes architecture proposal：** 不強迫不同 modality 共用 revision，而建立：

```text
ObservationBundle {
  bundleId
  captureIntentId
  canonicalStateRef?
  representations[]
  captureWindow
  correspondenceEdges[]
  completeness
}

Representation {
  observationId
  channel          // program_state | dom | ax_tree | pixels | mcp | file ...
  sourceIdentity
  nativeRevision?
  capturedAt
  digest
  derivationParent?
}

CorrespondenceEdge {
  fromObservation
  toObservation
  relation         // DERIVED_FROM | CAPTURED_AFTER | SYNCHRONIZED_WITH | PROJECTS
  witnessType
  confidenceClass  // PROVEN | BOUNDED | CORRELATED | UNKNOWN
}
```

核心 invariant：

```text
SameBundle(o1,o2)
DOES_NOT_IMPLY
SameWorldRevision(o1,o2)
```

只有有 derivation/synchronization witness 才能把 correspondence 升級為 `PROVEN/BOUNDED`。

## Architecture Breakdown

```text
Backend / Program State C17
        │
        ├── DOM D41
        │      └── AX Tree A52
        │
        └── Render Pipeline
               ↓
            Layout
               ↓
             Paint
               ↓
          Screenshot P88

C17 ──?── D41
D41 ──?── A52
D41 ──?── P88

        ↓
Correspondence Witness Builder
        ↓
Observation Bundle B9
        ↓
Premise Lineage
        ↓
Reasoning / Planning
        ↓
Action Freshness + Correspondence Gate
        ↓
Semantic Action / GUI Action
        ↓
Canonical Read-back / Verification
```

這裡 `?` 不能用「同一秒抓的」自動填成 equals；必須保存 relation + witness。

## Bottom-Level Logic

本輪 bottom-level mechanism 是 **Correspondence Admission Gate**：

```text
1. capture canonical/program observation C
2. capture DOM/AX/visual observations
3. record each native revision/capture point independently
4. build only mechanically evidenced derivation/sync edges
5. classify unresolved edges as CORRELATED/UNKNOWN
6. map reasoning premises to exact representation(s)
7. before action, validate freshness AND required cross-modal correspondence
8. if correspondence broke, targeted recapture/re-ground instead of blindly execute
```

建議 action invariant：

```text
ActionAdmissible(T)
:= FreshnessPass(T)
 ∧ CorrespondenceRequirements(T) satisfied
 ∧ NoInvalidatedPremise(T)
```

例如「點畫面上的紅色刪除按鈕」同時依賴 visual identity + semantic role，因此至少需要：

`Pixel region ↔ AX/DOM element ↔ current canonical state`

若只有 pixel 還新、AX ref 已 stale，應 BLOCK / REGROUND。

## Visual Simulation Idea

### Cross-Modal State Correspondence Microscope

```text
PROGRAM STATE   C17 ───────── C18
                   \
DOM              D41 ─────── D42
                   \
AX TREE            A52 ───── A53
                     \
PIXELS                P88 ───── P89

BUNDLE B9
C17 ─PROVEN→ D41
D41 ─PROVEN→ A52
D41 ─CORRELATED?→ P88

ACTION T7
requires: A52 + P88
              ↓
Correspondence Gate
PASS / BOUNDED / UNKNOWN / BROKEN
```

可注入：DOM mutation without visible change、CSS animation without DOM mutation、AX label change、backend state change before render、stale screenshot、GUI effect not synchronized to canonical state、canvas-only element。

Console 顯示：`Representation revisions / capture window / derivation edges / stale edge / correspondence strength / premise dependencies / action verdict / recapture plan`。

## Code / GitHub

### sharryXR/ASIL

本輪不是只讀 README，已追：

- `src/asil/protocol.py` — Observation/Meta/Element/AppState/Environment/Action IR。
- `src/asil/adapter.py` — `observe`, `execute`, `validate_action`, GUI session contract, `sync_from_gui`, canonical observation builder。
- `docs/software-extension-architecture.md` — runtime layers、15 app access paths、rendering separation、fail-closed onboarding/audit/probe。
- 值得下一輪續讀：`src/asil/rendering.py`, `src/asil/eval/`, concrete adapters（draw.io / LibreOffice / Blender / Gitea），確認 canonical-state ↔ visible-state synchronization 的實際差異。

Repo：https://github.com/sharryXR/ASIL

### Playwright / Chromium

值得繼續追：
- accessibility snapshot ref lifecycle
- DOM/AX update timing
- CDP `DOMSnapshot`, Accessibility domain, lifecycle events
- layout/paint/compositor synchronization points

## Papers

1. **ASIL: Replacing Screenshot-and-Click with Structured State and Semantic Actions** — Rui Xie, Lu Chen; Shanghai Jiao Tong University; 2026; Findings of EMNLP 2026; arXiv:2608.26991. Code: https://github.com/sharryXR/ASIL. Dataset/benchmark: 300 single-app + 80 multi-app tasks. Architecture: structured observation + semantic action adapters through file/native-script/service access paths. Contribution: demonstrates agent-native structured state/action contract across 15 applications. Limitation: deepest stable structured interface is application-specific; rendering/perceptual semantics still need hybrid/manual integration.

2. **ComponentBench observation modes**（engineering benchmark artifact）— compares AX-tree, SoM, Pixel, Browser-Use observation/action spaces, useful for isolating representation effects; not itself a proof of correspondence. Code/docs: https://github.com/TianchenGuan/ComponentBench/blob/main/docs/observation_modes.md

## Unknown / Open Questions

1. Browser 是否能用 CDP lifecycle / frame token / document loader identity 建立 `DOMSnapshot ↔ AXTree ↔ Screenshot` 的 bounded atomic capture，而不是只靠 capture timestamps？
2. Canvas/WebGL/remote video 等沒有 DOM-semantic parent 的 pixels，要如何建立 stable object identity 與 action correspondence？
3. Structured canonical state 與 GUI visible state 雙向同步時，如何證明 `sync_from_gui()` 已完整捕捉 GUI side effects，而不是只更新部分 state？

## 下一輪研究

下一輪優先研究 **Browser Atomic Observation Bundle**：

`Document/Frame identity → DOM snapshot → AX tree → layout/paint lifecycle → screenshot → bundle witness`

直接追 Chromium CDP 的 DOMSnapshot / Accessibility / Page lifecycle / screencast/screenshot semantics，判斷是否能形成 bounded correspondence proof。

第二條線追 ASIL concrete adapters：

`semantic action → application-native effect → sync/persist → canonical observe → evaluator`

找出哪些 adapter 可提供真正的 state revision / content hash / postcondition witness，並與 MCP resource observation contract比較。

## Knowledge Graph 新增 Node / Edge

新增 Nodes：`ObservationBundle`, `RepresentationObservation`, `CorrespondenceEdge`, `CorrespondenceWitness`, `CorrespondenceStrength`, `CanonicalProgramState`, `RenderedProjection`, `AccessibilityProjection`, `CaptureWindow`, `SemanticActionContract`, `GUICanonicalSync`, `CorrespondenceAdmissionGate`。

新增 Edges：

`CanonicalProgramState PROJECTS_TO DOMObservation`; `DOMObservation DERIVES AccessibilityProjection`; `DOMObservation CONTRIBUTES_TO RenderedProjection`; `ObservationBundle CONTAINS RepresentationObservation`; `CorrespondenceWitness BINDS RepresentationObservation`; `GUIEffect REQUIRES GUICanonicalSync`; `ActionIntent REQUIRES_CORRESPONDENCE CorrespondenceEdge`; `SemanticAction MUTATES CanonicalProgramState`。

## 本輪收斂判斷

- **缺哪一層：** Browser/GUI capture 的 bounded atomicity witness；目前知道 representations 不等價，但還缺可執行的 correspondence protocol。
- **最淺節點：** `CorrespondenceWitness`，尤其 pixels ↔ DOM/AX ↔ backend state。
- **仍只是名詞：** 通用 `CrossModalCorrespondenceProof`；目前只能做 channel/application-specific witness。
- **最值得讀原始碼：** ASIL concrete adapters + Chromium/Playwright snapshot/capture lifecycle。
- **需追引用論文：** ASIL；並繼續追上一輪 StateAct / Temporal UI State Inconsistency，形成 structured-state、visual-state、TOCTOU 三角交叉驗證。
- **最適合視覺模擬：** Cross-Modal State Correspondence Microscope。
- **最值得實作的 Agent 架構：** canonical structured-state main agent + visual/AX specialist + Runtime-owned ObservationBundle/Correspondence Gate + semantic action/postcondition verification。

最終鏈補成：

`UI/Program/Camera/Voice/Video → Representation Observations → ObservationBundle + Correspondence Witness → Context → Premise lineage → Reasoning → Planning → Freshness + Correspondence Gate → Semantic/GUI Action → Canonical Read-back → Settlement → Output`。

核心結論：**多模態 Agent 不能把「同一時間附近取得的 DOM、AX tree、Screenshot、backend state」直接當成同一份世界真相。它們是不同 projection。可靠 Runtime 必須保存每個 representation 的 native identity/revision，並把「它們為何被認為屬於同一 world-state」本身變成可驗證的 correspondence edge；沒有 witness 的地方就必須保留 UNKNOWN，而不是讓 prompt 拼接製造虛假的一致性。**