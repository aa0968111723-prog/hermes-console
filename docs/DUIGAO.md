# 對稿 MCP

Hermes Console 把對稿工作室當成外部海報 MCP。GitHub 倉庫網址不是 MCP。

## 連線

1. 在對稿「MCP」頁複製端點與權杖（`dg_…`）。
2. 在 Console 後端或「設定 → 連線」填：
   - `DUIGAO_MCP_URL`：`https://<對稿>/api/mcp`，不含帳密與查詢參數
   - `DUIGAO_MCP_TOKEN`：上述 Bearer 權杖
3. 按「測試對稿連線」。成功條件是 initialize 與 tools/list，不是假裝已經發佈海報。

也可寫進 `CONSOLE_MCP_SERVERS_JSON`：

```json
[{"id":"duigao","name":"對稿工作室","endpoint":"https://YOUR_DUIGAO_HOST/api/mcp","credentialReference":"DUIGAO_MCP_TOKEN","readonly":false}]
```

若同時設定 `DUIGAO_MCP_URL`，不必重複放進 JSON。

本機探測需 `HERMES_ALLOW_LOOPBACK_HTTP=true`。正式環境必須 HTTPS。

## Hermes 可呼叫的工具

工作區 MCP（經 Console `/api/mcp`）：

- `duigao_status` / `duigao_list_tools`
- `duigao_list_templates` / `duigao_list_designs` / `duigao_get_design`
- `duigao_create_draft` / `duigao_apply_copy` / `duigao_add_text`
- `duigao_list_rooms` / `duigao_create_room`
- `duigao_list_receipts`
- `duigao_call`（任意對稿工具，例如 `create_draft`）

Runtime 探測後還有 `mcp.duigao.<name>`，與對稿目錄一對一（`create_draft`、`apply_copy`…）。

建議路徑：`duigao_list_templates` → `duigao_create_draft` → 請使用者在對稿工作室檢視。不要把草稿當成已發佈。
