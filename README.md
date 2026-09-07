# Hermes Creative Intelligence

明亮的單一工作區。打開網站即可使用，不登入、不輸入電子信箱、不需要邀請連結。Hermes 執行工具；Console 保存會話、任務、活動、文案版本與學習請求，不另建模板大腦。

## 啟動

需要 Node.js 22.13+，建議 Node.js 24 LTS。此版本需要持久化磁碟與單一長駐 Node 程序，不適用無狀態 serverless 環境。

1. `npm ci`
2. 複製 `.env.example` 到 `.env.local`，依註解設定。本機可不設邀請／寄信變數。
3. 設定經確認的 `HERMES_API_URL` 與全新 `HERMES_API_KEY`。禁止使用曾公開的舊金鑰。未設定時 Console 仍應開啟，並顯示尚未連線。
4. `npm run dev` 後開啟 http://localhost:3000，應直接進入工作區。正式環境使用 `npm run build` 與 `npm start`。

## 免登入單一工作區

這是產品不變量。首頁直接進入 Hermes Console。工作區 API 使用單一 `workspace` owner；寫入仍驗證 Origin、限流，秘密只留後端。可另外設定 `CONSOLE_GATEWAY_SECRET` 作為部署層閘道，它不是帳號登入。詳見 [部署說明](docs/DEPLOYMENT.md)。

## 重要安全操作

之前提交過的金鑰與管理密碼必須在部署端撤銷／更換。移除现行檔案不會清除 Git 歷史、快取或既有部署，也不代表憑證已撤銷。此分支不重寫歷史，不強制推送，不自動部署。

後端只使用管理者設定的 HTTPS 目標，拒絕重導向與瀏覽器傳入的服務網址或金鑰。Console 密碼不會提供給 Hermes。

## 驗證與限制

最新接續見 [活動、學習地圖與邀請制](docs/LEARNING_INVITATIONS.md)。舊 PR #11／#14 文件僅為歷史紀錄，其免登入方案已由本輪要求取代。契約測試不是 Zeabur／Canva／電子郵件收件匣的實機驗證。

## FrameLab 動畫 MCP

Hermes 可呼叫 FrameLab 逐格動畫工作站。GitHub 倉庫網址不是 MCP。在「設定 → 連線」填 `FRAMELAB_MCP_URL`（`https://…/api/mcp`）與從 FrameLab 首頁產生的 `FRAMELAB_MCP_TOKEN`，再按「測試 FrameLab 連線」。探測成功後 Hermes 可用 `mcp.framelab.*` 與工作區 `framelab_*` 工具。詳見 [FrameLab MCP](docs/FRAMELAB.md)。

## ConsistencyLab 連戲 MCP

Hermes 可呼叫 ConsistencyLab 連戲工作站。GitHub 倉庫網址不是 MCP。在「設定 → 連線」填 `CONSISTENCYLAB_MCP_URL`（`https://…/api/mcp`）與從 ConsistencyLab 產生的 `CONSISTENCYLAB_MCP_TOKEN`（公開示範可省略），再按「測試 ConsistencyLab 連線」。探測成功後 Hermes 可用 `mcp.consistencylab.*` 與工作區 `clab_*` 工具讀寫角色聖經、Golden、服裝／燈光／道具連續。詳見 [ConsistencyLab MCP](docs/CONSISTENCYLAB.md)。
