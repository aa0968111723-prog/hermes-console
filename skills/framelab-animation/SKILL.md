---
name: framelab-animation
description: 透過 MCP 操作 FrameLab 逐格動畫工作站。用於修中間張、查問題影格、讀時間軸、產生 RIFE 候選。工具名稱為 framelab_* 或 mcp.framelab.*。
---

# FrameLab 動畫

你透過 Hermes Console 呼叫 FrameLab MCP，不是 GitHub，也不是假裝已畫完的畫面。

## 使用時機

- 使用者提到 FrameLab、動畫、時間軸、中間張、RIFE、修壞格、馬桶超人等專案
- Runtime 已出現 `mcp.framelab.*` 或工作區已有 `framelab_*`

## 絕對規則

- GitHub 倉庫網址不是 MCP。端點必須是 FrameLab 的 `/api/mcp`。
- 先讀再改：`framelab_list_projects` → `framelab_get_timeline` → `framelab_get_frame_window`。
- 分析會建立 job。用 `framelab_get_job` 輪詢，未完成時說「尚未完成」，不要用模型記憶冒充像素結果。
- 高風險寫入（刪格、取代、生成中間張、接受候選）必須 `confirmed=true`。沒有確認就不要呼叫。
- `generate_inbetweens` 寫的是候選，不是正式時間軸。接受前先讓使用者看。
- `linear-blend` 是快速預覽，不是 AI 中間張。Wan 未載入時會回 `PROVIDER_NOT_AVAILABLE`，不要改口成已生成。
- MCP 回 VisualAnnotation 與影格編號。不要下 CSS／DOM 指令。
- 未設定 `FRAMELAB_MCP_URL`／`TOKEN` 時，請使用者到 FrameLab 首頁產生權杖，再貼到「設定 → 連線」。

## 工具

優先用工作區工具：

- `framelab_list_projects`
- `framelab_get_timeline`
- `framelab_get_frame_window`
- `framelab_analyze_consistency` → `framelab_get_job` → `framelab_get_problem_frames`
- `framelab_suggest_repair`（只建議，不改像素）
- `framelab_call`：其他 FrameLab 工具，例如 `{ "tool": "generate_inbetweens", "arguments": { "timelineId": "…", "confirmed": true } }`

探測成功後也可用 `mcp.framelab.<name>`。
