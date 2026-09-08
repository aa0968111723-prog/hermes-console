# Planform 場佈 MCP

Hermes 經 Console 的 Workspace MCP 呼叫 Planform。GitHub 倉庫網址不是 MCP。

## 呼叫路徑（確定）

```
Hermes
  → Console POST /api/mcp（Bearer MCP_BRIDGE_TOKEN）
  → 工作區工具 planform_describe / planform_run_agent / planform_confirm_preview …
  → Planform POST /mcp（可選 Bearer PLANFORM_MCP_TOKEN）
```

Hermes 不必另連第二條 MCP。`https://github.com/aa0968111723-prog/planform-iso` 會被拒絕。

## Planform 端點

- `POST /mcp` JSON-RPC 2.0（`initialize`、`tools/list`、`tools/call`）
- `GET /mcp/health`
- `GET /.well-known/mcp.json`

協定版本：`2025-06-18`。`Accept` 同時帶 `application/json` 與 `text/event-stream`。

## Console 連線

在 Zeabur / 環境變數或「設定 → 連線」寫入：

```
PLANFORM_MCP_URL=https://your-planform.example/mcp
PLANFORM_MCP_TOKEN=至少16字元的新權杖（選用，兩邊同一把）
```

有 URL 時自動列入核准清單 `id=planform`（比照淡江與訊核）。JSON 只放變數名，不要把權杖寫進清單。

本機合約測試才可設 `HERMES_ALLOW_LOOPBACK_HTTP=true` 後使用 `http://127.0.0.1:8080/mcp`。

## Hermes 應呼叫的工具

1. `planform_describe` 或 `planform_get_venue`
2. `planform_run_agent`（繁體中文口語）
3. `planform_generate_layout` 看 A/B/C
4. 使用者確認後 `planform_apply_layout`（`confirm: true`）再 `planform_confirm_preview`

工作區會沿用同一 MCP session，所以草稿預覽跨多次工具呼叫仍有效。找不到物件時回 `unresolved`，不可猜最近物件。刪除必須 `confirm: true`。草稿未確認前正式專案不變。

探測狀態為 partial（有真實工具清單）不代表每個工具都已遠端執行。
