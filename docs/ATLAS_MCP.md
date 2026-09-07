# 場圖 Atlas MCP

Hermes Console 以外部 MCP 呼叫場圖（Atlas）。GitHub 倉庫網址不是 MCP。

## 場圖端點

- 協定：Streamable HTTP JSON-RPC `2025-03-26`／`2025-06-18`
- 方法：`POST`；`GET` 回 405
- 路徑：`/api/mcp`
- 完整網址必須是公開 HTTPS，例如 `https://your-atlas.example/api/mcp`
- 禁止 localhost、私網、帶帳密或查詢參數、GitHub 網址
- `Accept` 必須同時包含 `application/json` 與 `text/event-stream`
- `Authorization: Bearer <ATLAS_MCP_TOKEN>`

## Console 設定

在「設定 → 連線」填：

- `ATLAS_MCP_URL` = `https://your-atlas.example/api/mcp`
- `ATLAS_MCP_TOKEN` = 與場圖後端同一個權杖

或後端環境變數（不要把權杖寫進 JSON）：

```json
[
  {
    "id": "atlas",
    "name": "場圖 Atlas",
    "endpoint": "https://your-atlas.example/api/mcp",
    "credentialReference": "ATLAS_MCP_TOKEN",
    "readonly": false
  }
]
```

只填 `ATLAS_MCP_URL`／`ATLAS_MCP_TOKEN` 時，後端會自動建立 `id=atlas` 的核准項，不必重複寫進 `CONSOLE_MCP_SERVERS_JSON`。

儲存後按「測試場圖連線」。成功代表已完成 initialize 與 tools/list。Hermes 工具名稱會是 `mcp.atlas.<tool>`。

## Hermes 可呼叫的工具

| 工具 | 作用 |
| --- | --- |
| `list_orgs` | 列出機構 |
| `list_public_guides` | 列出公開導覽（安全唯讀） |
| `get_org_rules` | 讀機構規則與流程模板 |
| `list_org_projects` | 列出機構專案與目前階段 |
| `get_project_flow` | 目前階段、負責人、下一步、缺口 |
| `review_pack` | 文案／圖片／影片／來源／版權審核軸 |
| `delivery_checklist` | 交付檢查表（不改狀態） |
| `suggest_flow_tasks` | 建議任務；`createTasks=true` 才寫入，來源標示 AI |

場圖**沒有**交付／改階段工具。AI 不得把專案標記為已交付或已完成。

`MCP_REQUIRE_TASK_CONTEXT` 只約束 Console 自己的 `/api/mcp` 工作區工具，不要求場圖工具帶 Console taskId。
