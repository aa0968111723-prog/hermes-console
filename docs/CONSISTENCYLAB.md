# ConsistencyLab MCP

Hermes Console 把 ConsistencyLab 連戲工作站當成外部 MCP。GitHub 倉庫網址不是 MCP。

## 連線

1. 在 ConsistencyLab 工作站「Inspector → MCP」按「產生連線權杖」，複製 `cl_…`（公開示範可省略）。
2. 在 Console 後端或「設定 → 連線」填：
   - `CONSISTENCYLAB_MCP_URL`：`https://<ConsistencyLab>/api/mcp`，不含帳密與查詢參數
   - `CONSISTENCYLAB_MCP_TOKEN`：上述 Bearer 權杖（選用）
3. 按「測試 ConsistencyLab 連線」。成功條件是 initialize 與 tools/list，不是假裝已經修完連戲。

也可寫進 `CONSOLE_MCP_SERVERS_JSON`：

```json
[{"id":"consistencylab","name":"ConsistencyLab 連戲工作站","endpoint":"https://YOUR_CONSISTENCYLAB_HOST/api/mcp","credentialReference":"CONSISTENCYLAB_MCP_TOKEN","readonly":false}]
```

若同時設定 `CONSISTENCYLAB_MCP_URL`，不必重複放進 JSON。公開示範沒有權杖時把 `credentialReference` 設成 `null`。

本機探測需 `HERMES_ALLOW_LOOPBACK_HTTP=true`。正式環境必須 HTTPS。

## Hermes 可呼叫的工具

工作區 MCP（經 Console `/api/mcp`）：

- `clab_list_tools` / `clab_get_project_tree` / `clab_get_shot` / `clab_get_scene`
- `clab_get_character_bible` / `clab_get_scene_bible` / `clab_get_style_bible` / `clab_get_prop_bible` / `clab_get_outfit_bible` / `clab_get_lighting_bible`
- `clab_get_golden_reference` / `clab_set_golden_reference`
- `clab_analyze_character_consistency` / `clab_analyze_face_consistency` / `clab_analyze_outfit_consistency` / `clab_analyze_scale_consistency` / `clab_analyze_scene_consistency` / `clab_analyze_style_consistency` / `clab_analyze_lighting_consistency` / `clab_analyze_prop_consistency` / `clab_analyze_prop_continuity` / `clab_analyze_cross_shot_consistency`
- `clab_get_consistency_issues` / `clab_create_outfit_transition` / `clab_create_prop_action` / `clab_create_lighting_transition` / `clab_create_repair_request`
- `clab_call`（任意 ConsistencyLab 工具）

Runtime 探測後還有 `mcp.consistencylab.<name>`，與 ConsistencyLab 目錄一對一。真正執行連戲時請走 `clab_*`。

建議路徑：`clab_get_project_tree` → `clab_get_shot` → 對應 `clab_analyze_*`。永遠不要輸出 Similarity = N%。反打、側臉、微笑、放下行李箱本身不是漂移。
