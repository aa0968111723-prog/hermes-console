# 部署與接續整合

## Console

使用 Dockerfile 建立長駐 Node.js 服務；正式部署由擁有者明確授權後執行。不能直接沿用無狀態 serverless 部署。

- 單一 replica，掛載可寫持久化卷到 `/app/data`。
- 外部使用 HTTPS；設定 `CONSOLE_ORIGIN` 為精確外部 origin。
- # No Login：產品本身不要求 Console 帳號密碼。`CONSOLE_USERNAME`／`CONSOLE_PASSWORD_HASH` 不是啟動必要條件。
- 若網域直接暴露在公開 Internet，任何知道網址的人都可能使用 Console 並消耗 Hermes／MCP 資源。可選部署層保護：Zeabur private networking、reverse proxy access policy、Cloudflare Access、VPN、IP allowlist。不要在 Console UI 恢復登入。
- 複製 .env.example 的空白設定名稱到部署秘密儲存，填入全新憑證。撤銷所有曾公開的 Hermes API Key 並重新產生。
- 定期備份 SQLite 和 uploads；備份也必須存取受控。不要把資料卷提交 Git。
- 未實作多 replica 鎖／分散式佇列。不要水平扩展此版本。

## Hermes

1. 記錄部署 commit／版本及 API 網域，先輪替被公開過的憑證。
2. 使用設定中的「重新驗證連線」。模型清單成功不等於所有工具可用。
3. 觀察實例 capability 回應，確認 runs、status、stop、sessions、toolsets、skills 實際存在。
4. 舊版只能 chat-completions 時，Console 可以保存歷史與串流結果，但中斷不保證遠端停止；不得把此模式當可可靠取消副作用的執行器。
5. 必須在 Hermes 端限制工具。此版本 Console 不提供社群正式發佈工具；不能靠模型提示代替 Hermes 權限限制。
6. 確認 Hermes 記憶／會話資料掛載持久化卷，重啟後再查詢同一會話。尚未完成前保持「未驗證」。

## Console MCP 橋接

只在兩個後端秘密儲存配置同一個新 MCP_BRIDGE_TOKEN。Hermes 的 HTTP MCP 服務 URL 指向 Console 的 `/api/mcp`，Authorization 使用 Bearer 服務 token；不要把 token 寫入公開倉庫。

Console 支援 Streamable HTTP 的 2025-03-26／2025-06-18 協定；GET 回應 405，POST 接受 JSON-RPC。不支援舊式獨立 SSE endpoint。

初始只列出工作區參考與三方向保存工具。完成 Canva 授權及設計清單驗證後，重新連接／刷新 Hermes MCP 工具清單，才會看到 Canva 操作工具。

## Canva OAuth

在 Canva Developer Portal 建立 Connect integration，登記：

`https://你的-console-網域/api/canva/callback`

所需 scopes：

`design:meta:read design:content:read design:content:write asset:read asset:write brandtemplate:meta:read brandtemplate:content:read`

將 Client ID／Secret 放後端；CONSOLE_VAULT_KEY 是 32-byte 隨機值，以 64 個十六進位字元設定。妥善保存此金鑰，不得在每次重啟重新生成。

在 Console 設定點「前往 Canva 授權」，回來後會讀取設計清單驗證。此只代表部分可用，需實際測試上傳、製作、匯出各操作。

目前製作實作基於 Canva Autofill，需可用範本、對應帳號方案與權限。沒有這些條件時，可改接 Hermes 已授權的 Canva 設計 MCP；不將空白畫布冒充生成設計。

## 安全復原

- 任務 `uncertain`：先確認 Hermes／Canva 是否已執行。不得直接重送造成雙重副作用。
- Native runs 中断：Console 保留 remoteId，重啟後查詢，不重新提交。
- Chat 串流中断：標示不確定，不宣稱已取消上游。未實作遠端查詢時須人工核對。
- OAuth 失效：重新授權；refresh token 僅在後端序列化更新。
- 秘密疑似外洩：部署端立即撤銷／輪替，更新環境設定後再驗證。Git 程式碼移除不等於撤銷。
