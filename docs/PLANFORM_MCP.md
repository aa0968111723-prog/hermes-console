# Planform 場佈 MCP

Hermes Console 經 Streamable HTTP 呼叫 Planform。GitHub 倉庫網址不是 MCP。

## 端點

- `POST /mcp` JSON-RPC 2.0（`initialize`、`tools/list`、`tools/call`）
- `GET /mcp/health`
- `GET /.well-known/mcp.json`

協定版本：`2025-06-18`。`Accept` 同時帶 `application/json` 與 `text/event-stream`。

## Console 連線

在部署環境或「設定 → 連線」寫入：

```
PLANFORM_MCP_URL=https://your-planform.example/mcp
PLANFORM_MCP_TOKEN=至少16字元的新權杖
```

或核准清單：

```json
[{
  "id": "planform",
  "name": "Planform 場佈",
  "endpoint": "https://your-planform.example/mcp",
  "credentialReference": "PLANFORM_MCP_TOKEN",
  "readonly": false
}]
```

不可填 `https://github.com/aa0968111723-prog/planform-iso`。

本機合約測試才可設 `HERMES_ALLOW_LOOPBACK_HTTP=true` 後使用 `http://127.0.0.1:8080/mcp`。

## Hermes 應呼叫的工具

1. `planform_describe` 或 `planform_get_venue`
2. `planform_run_agent`（繁體中文口語）
3. `planform_generate_layout` 看 A/B/C
4. 使用者確認後 `planform_apply_layout`（`confirm: true`）再 `planform_confirm_preview`

找不到物件時會回 `unresolved`，不可猜最近物件。刪除專案必須 `confirm: true`。草稿未確認前正式專案不變。
