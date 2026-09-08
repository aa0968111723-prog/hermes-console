# AI Agent × Multimodal Research Report — Computer Agent Perception → Grounding → Action

時間：2026-09-08 14:51 Asia/Taipei

## 與歷史研究比較

本輪延續既有三份研究：
- `2026-09-08-multimodal-runtime.md`
- `2026-09-08-multimodal-fusion.md`
- `2026-09-08-cross-attention-memory-topology.md`

前三輪已建立 Image/Video → Encoder → Fusion → Cache/GPU 與 Cross-Attention memory topology。本輪不重複上述內容，向 Agent OS 的下一個缺口前進：**Perception → Grounding → Action Execution → Environment Feedback**。

---

## 本小時新發現

### 新架構：Computer Agent 不是單一「看圖後點擊」模型

更完整的 runtime 應拆成：

```text
User Goal
↓
Agent Runtime
↓
Observation Acquisition
├ Screenshot
├ DOM
├ Accessibility Tree
├ OCR
└ Structured UI Elements
↓
Perception / Screen Parsing
↓
Semantic Target Selection
↓
Grounding
├ element id
├ bounding box
└ coordinates
↓
Action Representation
├ click
├ type
├ scroll
├ drag
└ keyboard shortcut
↓
Action Executor
├ Playwright
├ PyAutoGUI
├ Browser Runtime
└ OS Runtime
↓
Environment State Change
↓
New Observation
↓
Verification / Replan
```

來源：OpenAI Computer-Using Agent、BrowserGym、OSWorld、OmniParser、ScreenSpot-Pro。

### 新 benchmark：OSWorld 2.0 把 Computer Agent 問題從「會不會點」推到長任務 state tracking

OSWorld 1.0（2024）有 369 個真實電腦任務；原論文指出 GUI grounding 與 operational knowledge 是主要失敗來源之一。OSWorld 2.0（2026）進一步建立 108 個長任務工作流，每項任務的人類完成時間中位數約 1.6 小時，強調 dynamic environment、cross-source reasoning、implicit-state inference、visual-spatial precision 等問題。

這表示 Computer Agent 的核心瓶頸已經從：

```text
Can I click the correct button?
```

進一步變成：

```text
Can I preserve goal + constraints + hidden state
across hundreds of observations/actions?
```

### 新 benchmark：OSWorld-MCP 顯示 GUI Action 與 Tool Calling 應該是同一個 Action Router 的兩種 branch

OSWorld-MCP（2025）加入 158 個 MCP tools，刻意公平比較 GUI-only 與 GUI+Tool agents。論文結果顯示工具通常能提升完成率，但 strongest models 的 tool invocation rate 仍只有 36.3%。

因此 Agent OS 應新增：

```text
Action Router
├ GUI Action
│  ├ click
│  ├ type
│  └ scroll
└ Tool Action
   ├ MCP
   ├ API
   └ structured function call
```

而不是把 MCP 與 Computer Use 做成兩套互不相干的 Agent。

---

# 本小時最重要 5 個發現

## 1. Perception 與 Grounding 是兩個不同問題

**Perception** 回答：

```text
畫面上有哪些物件？
它們代表什麼？
哪一些可互動？
```

**Grounding** 回答：

```text
「登入按鈕」到底在畫面的哪裡？
```

底層流程：

```text
Screenshot
↓
Visual Encoder / Screen Parser
↓
Detected UI Elements
↓
Semantic Labels
↓
Target Selection
↓
Bounding Box / Element ID
↓
Click Coordinate
```

OmniParser 將 screenshot 解析成 interactable regions + functional semantics，核心目的是提高 VLM action grounding。ScreenSpot-Pro 則直接測高解析專業 GUI 中 textual instruction → exact target region 的能力。

因此 Knowledge Graph 必須拆開：

```text
GUI Perception
≠
GUI Grounding
≠
Action Execution
```

## 2. Browser Agent 不一定需要輸出 pixel coordinates

BrowserGym 的高階 action layer 支援 `click(bid)`。原始碼中 `click()` 接收 BrowserGym element id（bid），再由 `get_elem_by_bid()` 找到 Playwright locator，最後執行 `elem.click(...)`。

因此存在至少兩種 action grounding topology：

### Coordinate Grounding

```text
Target
↓
(x, y)
↓
Mouse Runtime
↓
Click
```

### Element Grounding

```text
Target
↓
Element / BID
↓
Locator
↓
Browser Runtime
↓
Click
```

這兩者失敗模式完全不同。

Coordinate grounding 容易受：resolution、window movement、scroll offset、tiny targets 影響。

Element grounding 則依賴：DOM/Accessibility tree 是否可取得、locator 是否穩定、frame/shadow DOM/SPA 更新。

## 3. Observation Space 本身就是 Agent Architecture

OSWorld 明確支援多種 observation：

```text
screenshot
a11y_tree
screenshot + a11y_tree
set-of-marks
```

BrowserGym 的 observation runtime 甚至會遞迴標記 DOM/frame，建立 BrowserGym ID，並用 Chrome DevTools Protocol 擷取 screenshot。

所以：

```text
Environment
↓
Observation Adapter
↓
Agent
```

Observation Adapter 不是單純資料轉換器，而是直接決定 Agent 能看見多少 environment state。

例如：

```text
Pure Vision Agent
Screenshot only
```

對比：

```text
Structured Browser Agent
Screenshot + DOM + A11y + element IDs
```

後者獲得額外 machine-readable affordances，因此 benchmark 比較必須確認 observation space 是否相同。

## 4. `click(x,y)` 前面其實隱藏了 Grounding Compiler

如果模型說：

```text
「點右上角的登入」
```

Runtime 不能直接執行語意文字。

必須轉成某種可執行 representation：

```text
Intent
↓
Target semantics = Login button
↓
Grounding
↓
Executable target
├ (x=1732,y=91)
└ bid='a51'
↓
Action Schema
↓
Executor
```

因此可新增一個重要 Agent OS component：

```text
Grounding Compiler
```

它負責：

```text
Semantic Action
→ Executable Action
```

這與傳統 tool calling 的：

```text
Intent
→ Tool Name + JSON Args
```

非常類似。

因此 Grounding 與 Tool Calling 可以統一成：

```text
Intent Compiler
├ Tool Compiler → function + args
└ GUI Grounding Compiler → target + action args
```

## 5. Action 成功不能靠「工具沒有報錯」判定，必須靠下一個 Observation 驗證

Computer Agent 的 loop：

```text
Observe S_t
↓
Choose Action A_t
↓
Execute
↓
Environment transition
↓
Observe S_(t+1)
↓
Compare expected vs actual
↓
Continue / Recover / Replan
```

這裡必須分開：

```text
Execution Success
```

和：

```text
Goal-State Success
```

例如 `click()` 沒有 exception，只表示 runtime 成功發出 click，不代表：
- 點到正確目標
- 頁面真的切換
- modal 沒擋住
- network request 成功
- 任務進度真的前進

因此 Computer Agent 必須有 **post-action verification**。

---

# Architecture Breakdown — BrowserGym

BrowserGym 的底層結構提供很清楚的 Agent/Environment separation：

```text
Agent
↓ action
Gym Environment
├ env.py
├ observation.py
├ action/
│  ├ functions.py
│  ├ highlevel.py
│  ├ parsers.py
│  └ python.py
└ Playwright
↓
Browser
↓
Web Environment
↓
Observation
```

重要原始碼：

```text
browsergym/core/src/browsergym/core/observation.py
browsergym/core/src/browsergym/core/action/functions.py
browsergym/core/src/browsergym/core/action/highlevel.py
browsergym/core/src/browsergym/core/env.py
```

### Observation

`observation.py` 會：
- 遞迴 frame
- 標記 DOM elements
- 建立 temporary BrowserGym IDs
- 擷取 DOM snapshot
- 透過 CDP `Page.captureScreenshot` 擷取 screenshot

### Action

`functions.py` 中：

```text
click(bid)
↓
get_elem_by_bid(page,bid)
↓
Playwright locator
↓
elem.click(...)
```

所以 BrowserGym 的 high-level click 並不是 pixel click，而是 structured element action。

---

# Bottom-Level Logic — Screenshot → Click

以 pure-vision coordinate agent 為例：

```text
Screen framebuffer
↓
PNG / RGB Tensor
↓
Vision Encoder
↓
Visual Tokens / Hidden States
↓
Multimodal Fusion
↓
Agent Hidden State
↓
Action Prediction
```

Action prediction：

```text
Action Type = CLICK
Target = Login
```

Grounding：

```text
Visual target representation
↓
Spatial localization
↓
Bounding box
(x1,y1,x2,y2)
↓
Target point
((x1+x2)/2, (y1+y2)/2)
```

Executor：

```text
click(x,y)
↓
Virtual mouse event
↓
OS / Browser event dispatch
↓
Hit testing
↓
Target DOM/native widget
↓
Event handlers
↓
Application state changes
```

重新 observation：

```text
New framebuffer / DOM
↓
Compare expected state
↓
Success / Failure / Replan
```

因此「模型會點按鈕」至少包含五個不同子能力：

```text
Recognition
Semantic Selection
Spatial Grounding
Motor Execution
State Verification
```

---

# Visual Simulation Idea — Computer Agent X-Ray

Hermes Console 可新增互動模擬：

```text
Screenshot
↓
[Perception Layer]
boxes / OCR / DOM / a11y
↓
[Target Layer]
"Login button"
↓
[Grounding Layer]
BID=a51 或 (1732,91)
↓
[Action Compiler]
click(...)
↓
[Executor]
Playwright / PyAutoGUI
↓
[Environment]
↓
[New Screenshot]
↓
[Verifier]
```

可切換三個 observation modes：

1. Pixel-only
2. Screenshot + Set-of-Marks
3. Screenshot + DOM/A11y

畫面即時顯示：
- detected elements
- target confidence
- bounding box
- selected coordinate / element id
- executor backend
- action latency
- before/after screenshot diff
- expected state
- observed state
- success/failure classification

特別加入「Failure Injection」：
- UI element moved
- popup appeared
- scroll offset changed
- stale DOM element
- network delay
- click intercepted

讓使用者能看到 Agent 如何從 failure → new observation → replan。

---

# Code / GitHub

## ServiceNow/BrowserGym

Repo: https://github.com/ServiceNow/BrowserGym

值得研究：

```text
browsergym/core/src/browsergym/core/observation.py
browsergym/core/src/browsergym/core/action/functions.py
browsergym/core/src/browsergym/core/action/highlevel.py
browsergym/core/src/browsergym/core/env.py
```

用途：把 Web Agent 明確分成 Observation Space、Action Space、Environment transition。

## xlang-ai/OSWorld

Repo: https://github.com/xlang-ai/OSWorld

值得研究：

```text
mm_agents/
run.py / scripts
observation_type
pyautogui action space
computer_13 action space
```

OSWorld 支援 screenshot、a11y_tree、screenshot+a11y、SoM 等 observation，以及 pyautogui / enumerated computer actions。

## microsoft/OmniParser

Repo: https://github.com/microsoft/OmniParser

值得研究：

```text
util/
omnitool/
eval/
```

2026-07 repo 更新加入 YOLOv9-E interactive region detector；核心目的仍是 screenshot → interactable regions + semantics → grounding。

---

# Papers

## OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments

Authors: Tianbao Xie et al.
Year: 2024
URL: https://arxiv.org/abs/2404.07972
Code: https://github.com/xlang-ai/OSWorld
Dataset/Benchmark: 369 real computer tasks
Architecture relevance: Environment + Observation + Action + execution-based evaluator
Contribution: 建立跨 Ubuntu/Windows/macOS 的 real-computer benchmark。
Limitation: 早期任務長度與現代 professional workflow 相比仍較短。

Knowledge Graph:

```text
Computer Agent
→ Real Environment
→ Observation Space
→ Action Space
→ Execution Evaluation
```

## OSWorld 2.0: Benchmarking Computer Use Agents on Long-Horizon Real-World Tasks

Authors: Mengqi Yuan et al.
Year: 2026
URL: https://arxiv.org/abs/2606.29537
Dataset: 108 long-horizon workflows
Contribution: 將 computer-use 評測擴張到長任務、dynamic environment、hidden/implicit state、cross-source reasoning。
Limitations: frontier-agent benchmark 對基礎設施與成本要求很高；task suite 仍只是現實工作的一部分。

Knowledge Graph:

```text
Computer Agent
→ Long-Horizon State Tracking
→ Hidden State Recovery
→ Verification
```

## OmniParser for Pure Vision Based GUI Agent

Authors: Yadong Lu, Jianwei Yang, Yelong Shen, Ahmed Awadallah
Year: 2024
URL: https://arxiv.org/abs/2408.00203
Code: https://github.com/microsoft/OmniParser
Architecture: Screenshot → UI region detector + icon semantics/OCR → structured screen representation → VLM grounding
Contribution: 將 pure screenshot 轉成更容易被 VLM 使用的 structured elements。
Limitations: detector/caption quality會成為新的 error source；重複元素、微小 target、context-dependent icon semantics 仍困難。

Knowledge Graph:

```text
GUI Perception
→ Screen Parser
→ Interactable Region
→ Semantic Caption
→ Grounding
```

## ScreenSpot-Pro

Authors: Kaixin Li et al.
Year: 2025
URL: https://arxiv.org/abs/2504.07981
Benchmark: 23 professional applications, 5 industries, 3 OSes
Contribution: 顯示 professional high-resolution GUI 中，小 target 與複雜畫面會大幅增加 grounding difficulty；cascaded visual search 可改善精度。
Limitations: grounding benchmark 本身不等於完整 Agent task success。

Knowledge Graph:

```text
GUI Grounding
→ High-resolution Search
→ Region Reduction
→ Precise Target Localization
```

## OSWorld-MCP

Authors: Hongrui Jia et al.
Year: 2025
URL: https://arxiv.org/abs/2510.24563
Tools: 158 MCP tools / 7 applications
Contribution: 同時衡量 GUI operation + tool invocation + decision-making。
Limitation: MCP tool coverage 仍有限，工具存在本身不代表模型會正確 route。

Knowledge Graph:

```text
Computer Agent
→ Action Router
├ GUI Action
└ MCP Tool Action
```

---

# Knowledge Graph 新增 Node / Edge

新增 Nodes：

```text
Computer Agent Runtime
├ Observation Acquisition
├ Observation Adapter
├ Screen Parser
├ GUI Perception
├ Semantic Target Selection
├ GUI Grounding
├ Grounding Compiler
├ Action Representation
├ Action Executor
├ Environment Transition
└ Post-Action Verification
```

新增 Observation：

```text
Observation Space
├ Screenshot
├ DOM
├ Accessibility Tree
├ OCR
├ Set-of-Marks
└ Hybrid Observation
```

新增 Action：

```text
Action Space
├ Coordinate Action
│  ├ click(x,y)
│  ├ drag(x1,y1,x2,y2)
│  └ scroll
├ Element Action
│  ├ click(bid)
│  └ fill(bid,text)
└ Tool Action
   ├ MCP
   └ API
```

新增 Edges：

```text
Environment
--produces-->
Observation

Observation Adapter
--determines-->
Visible World State

Perception
--extracts-->
UI Elements

Semantic Target Selection
--chooses-->
Target Element

Grounding Compiler
--converts-->
Semantic Action
→ Executable Action

Action Executor
--changes-->
Environment State

New Observation
--verifies-->
Action Result

Action Router
--selects-->
GUI Action / Tool Action
```

最重要的新完整鏈：

```text
Pixels / DOM
↓
Perception
↓
Grounding
↓
Action Compilation
↓
Execution
↓
Environment Transition
↓
Verification
↓
Replan
```

---

# Unknown / Open Questions

1. **Observation Memory 應保存 screenshot、parsed elements、DOM snapshot，還是抽象 world state？**
   長任務若每輪保存 raw screenshots，context / storage / retrieval 成本很高；但過度摘要可能遺失 spatial evidence。

2. **Coordinate grounding 與 element grounding 最佳 hybrid router 是什麼？**
   Browser DOM 可用時 element action 更穩，但 canvas、remote desktop、native app、video frame 則通常只能依賴 vision coordinates。

3. **Computer Agent 如何可靠判斷 state transition 成功？**
   單純 screenshot diff 不足；需要 semantic verification、DOM assertions、task-specific evaluator，甚至 multi-source evidence。

---

# 下一輪研究

下一輪深入：**World State / Observation Memory / Verification Runtime**。

核心問題：

```text
S_t
+
A_t
↓
Environment
↓
S_(t+1)
```

Agent 如何建立：

```text
Current State
Expected Next State
Observed Next State
Difference
Failure Diagnosis
Replan
```

將比較：
- state machine
- event log
- screenshot history
- structured world model
- DOM state
- task checkpoints
- verifier / critic agent

並連回 World Model：

```text
Current State
+
Candidate Action
↓
Predicted Next State
↓
Compare possible actions
↓
Execute
↓
Observed Next State
↓
Prediction Error
```

---

# 本輪進化檢查

- 最缺的一層：**Post-Action Verification → World State Update**
- 最淺節點：**Observation Memory representation**
- 仍只是名詞：**World State / GUI World Model**
- 最值得讀原始碼：**BrowserGym env.py + observation.py；OSWorld agent/environment loop；OmniTool executor**
- 最值得追引用：**OSWorld → OSWorld 2.0；OmniParser → ScreenSpot-Pro / GUI grounding 2026 models**
- 最適合視覺模擬：**Computer Agent X-Ray + Failure Injection**
- 最值得實作的 Agent 架構：**Hybrid Action Router（GUI + MCP）+ explicit verifier + checkpointed state**

---

# Sources

- OpenAI Computer-Using Agent: https://openai.com/index/computer-using-agent/
- BrowserGym paper: https://arxiv.org/abs/2412.05467
- BrowserGym repo: https://github.com/ServiceNow/BrowserGym
- OSWorld: https://arxiv.org/abs/2404.07972
- OSWorld repo: https://github.com/xlang-ai/OSWorld
- OSWorld 2.0: https://arxiv.org/abs/2606.29537
- OSWorld-MCP: https://arxiv.org/abs/2510.24563
- OmniParser: https://arxiv.org/abs/2408.00203
- OmniParser repo: https://github.com/microsoft/OmniParser
- ScreenSpot-Pro: https://arxiv.org/abs/2504.07981
