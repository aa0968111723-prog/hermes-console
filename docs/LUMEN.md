# Lumen 創作台 MCP

Hermes Console 把 Lumen 當成外部 MCP 工具來源，接線方式與訊核、FrameLab 相同。GitHub 倉庫網址不是 MCP。

## 連線

1. Lumen 對外提供 Streamable HTTP：`https://<Lumen 網域>/api/mcp`。
2. 在 Console 後端或「設定 → 連線」填：
   - `LUMEN_MCP_URL`：上述 HTTPS 端點，不含帳密與查詢參數
   - `LUMEN_MCP_TOKEN`：至少 32 字元，與 Lumen 後端同一組服務憑證
3. 網址與至少 32 字元權杖都存好後，Workspace MCP 會列出 `lumen_*`。再按「測試 Lumen 連線」。成功條件是 initialize 與 tools/list，不是假裝已開畫板。

也可寫進 `CONSOLE_MCP_SERVERS_JSON`：

```json
[{"id":"lumen","name":"Lumen 創作台","endpoint":"https://YOUR_LUMEN_HOST/api/mcp","credentialReference":"LUMEN_MCP_TOKEN","readonly":false}]
```

若同時設定 `LUMEN_MCP_URL`，不必重複放進 JSON。權杖不要寫進清單。

本機預覽僅在 `HERMES_ALLOW_LOOPBACK_HTTP=true` 時允許 `http://127.0.0.1`。公開部署必須是 HTTPS。

## Hermes 怎麼呼叫

Hermes 連的是 Console 自己的 Workspace MCP（`/api/mcp`）。Console 收到 `lumen_utter` 後，用同一組權杖轉打 Lumen。不必在 Hermes 再加第二條 MCP。

Workspace MCP 名稱：

- `lumen_list_tools`：列出遠端工具，Runtime 前綴 `mcp.lumen`
- `lumen_health`：探測
- `lumen_utter`：口語開案、改畫板
- `lumen_get_session` / `lumen_list_board` / `lumen_get_research`
- `lumen_save_directions`：保存 3–5 個方向，等待使用者選定
- `lumen_lock_style` / `lumen_list_receipts`

Runtime 名稱是 `mcp.lumen.lumen_utter`。兩個都指向同一創作台。選定方向沒有模型工具。Hermes 讀得到頂層 `speech`／`name`／`cards`，不必再拆 `data`。

探測通過只代表有真實工具清單。畫板上有沒有卡片，要看 `lumen_list_receipts` 是否出現 `hermes-console` 來源。

## 意圖路由

`routeToolsets` 在使用者提到 Lumen、創作台、海報、文宣、招新、茶會、畫板、三個方向、Style DNA 時會選 `lumen`（攤位仍走 planform，動畫仍走 FrameLab，一般剪輯仍走 cutos）。Hermes 任務指示在 `LUMEN_MCP_URL`＋至少 32 字元 `TOKEN` 已設定時會注入 `lumenTaskInstructions()`，要求 Agent 真的呼叫 `lumen_*`，不得用文字假裝已開畫板。選定方向留給使用者，不要呼叫 `choose_direction`。
