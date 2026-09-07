# 訊核即時情報 MCP

Hermes Console 把訊核當成外部 MCP 工具來源。GitHub 倉庫網址不是 MCP。

## 連線

1. 訊核對外提供 Streamable HTTP：`https://<訊核網域>/mcp`（備用 `/api/mcp`）。
2. 在 Console 後端或「設定 → 連線」填：
   - `XUNHE_MCP_URL`：上述 HTTPS 端點，不含帳密與查詢參數
   - `XUNHE_MCP_TOKEN`：可選，與訊核後端同一組服務憑證
3. 重新整理 MCP 清單並測試。成功條件是 initialize 與 tools/list，不是假裝已做完情報研究。

也可寫進 `CONSOLE_MCP_SERVERS_JSON`：

```json
[{"id":"xunhe","name":"訊核即時情報","endpoint":"https://YOUR_XUNHE_HOST/mcp","credentialReference":"XUNHE_MCP_TOKEN","readonly":false}]
```

若同時設定 `XUNHE_MCP_URL`，不必重複放進 JSON。

## Hermes 可呼叫的工具

- `xunhe_research`：自然語言情報目標，建立真實研究任務
- `xunhe_get_task`：查任務狀態、計畫與來源
- `xunhe_get_report`：讀已完成報告與矛盾並列
- `xunhe_list_tasks` / `xunhe_list_agents`

任務未完成時工具會說明尚未完成，不會用模型記憶冒充即時資料。
