# FrameLab MCP

Hermes Console 把 [FrameLab](https://github.com/aa0968111723-prog/FrameLab) 當成外部動畫工作室 MCP。GitHub 倉庫網址不是 MCP。

## 連線

1. 在 FrameLab 工作室首頁按「產生連線權杖」，複製 `fl_…`。
2. 在 Console 後端或「設定 → 連線」填：
   - `FRAMELAB_MCP_URL`：`https://<FrameLab>/api/mcp`，不含帳密與查詢參數
   - `FRAMELAB_MCP_TOKEN`：上述 Bearer 權杖
3. 按「測試 FrameLab 連線」。成功條件是 initialize 與 tools/list，不是假裝已經修完動畫。

也可寫進 `CONSOLE_MCP_SERVERS_JSON`：

```json
[{"id":"framelab","name":"FrameLab","endpoint":"https://YOUR_FRAMELAB_HOST/api/mcp","credentialReference":"FRAMELAB_MCP_TOKEN","readonly":false}]
```

若同時設定 `FRAMELAB_MCP_URL`，不必重複放進 JSON。

本機探測需 `HERMES_ALLOW_LOOPBACK_HTTP=true`。正式環境必須 HTTPS。

## Hermes 可呼叫的工具

工作區 MCP（經 Console `/api/mcp`）：

- `framelab_list_projects` / `framelab_get_project` / `framelab_create_project` / `framelab_create_sample_project`
- `framelab_get_timeline` / `framelab_get_frame_window` / `framelab_get_keyframes`
- `framelab_analyze_consistency` / `framelab_get_problem_frames` / `framelab_suggest_repair`
- `framelab_create_inbetween_plan` / `framelab_generate_inbetweens` / `framelab_accept_generated_frames` / `framelab_undo`
- `framelab_get_job` / `framelab_get_model_status`
- `framelab_list_tools` / `framelab_call`（任意 FrameLab 工具）

Runtime 探測後還有 `mcp.framelab.<name>`，與 FrameLab 目錄一對一。

建議路徑：`list_projects` → `get_timeline` → `get_frame_window`。寫入／生成需 `confirmed=true`，並用 `get_job` 輪詢。不要把分析分數當成畫面。`linear-blend` 是快速預覽，不是 AI 中間張。
