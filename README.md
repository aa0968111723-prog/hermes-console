# Hermes Creative Intelligence

明亮的單一工作區。公開部署需先經 AuthGate 登入（Google／淡江 SSO／Email），通過工作區 membership 後進入 Hermes Console。InvitationGate 仍休眠，不是產品登入。本機測試可設 `CONSOLE_ALLOW_LOCAL_ACCESS=true` 略過登入閘，此開關不得用於公開正式環境。Hermes 執行工具；Console 保存會話、任務、活動、文案版本與學習請求，不另建模板大腦。

## 啟動

需要 Node.js 22.13+，建議 Node.js 24 LTS。此版本需要持久化磁碟與單一長駐 Node 程序，不適用無狀態 serverless 環境。

1. `npm ci`
2. 複製 `.env.example` 到 `.env.local`，依註解設定。本機可不設邀請／寄信變數。
3. 設定經確認的 `HERMES_API_URL` 與全新 `HERMES_API_KEY`。禁止使用曾公開的舊金鑰。未設定時 Console 仍應開啟，並顯示尚未連線。
4. `npm run dev` 後開啟 http://localhost:3000。未設定 `CONSOLE_ALLOW_LOCAL_ACCESS=true` 時會先看到登入頁。正式環境使用 `npm run build` 與 `npm start`。
5. 未設或空白 `DATABASE_URL` 時使用 `CONSOLE_DATA_DIR` SQLite（容器預設 `/app/data`）。設定後改用 Hermes 自有 Postgres 表（`console_records`／`console_sessions`／`console_limits`）；若 Postgres 為空且 SQLite 有列，啟動時一次性搬移。不要指向 ai_os 或 `cutos_memory_items`。`GET /api/ready` 回傳目前 `backend` 與 `dataDir`（200／503）；`GET /api/health` 附相同欄位，都不回傳連線字串。契約測試在沒有 `DATABASE_URL` 時略過 Postgres，只跑 SQLite。

## 登入

正式環境設定 `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`（Authorization Code + PKCE）或 Email 寄信（`RESEND_API_KEY`、`CONSOLE_EMAIL_FROM`）。淡江 SSO 需要校方 issuer／client／protocol；沒有正式 metadata 時畫面顯示「淡江 SSO 尚未完成設定」，不會假裝成功。密碼只存 Argon2id（舊 scrypt 雜湊仍可驗證）。秘密只留後端。

## 重要安全操作

之前提交過的金鑰與管理密碼必須在部署端撤銷／更換。移除现行檔案不會清除 Git 歷史、快取或既有部署，也不代表憑證已撤銷。此分支不重寫歷史，不強制推送，不自動部署。

後端只使用管理者設定的 HTTPS 目標，拒絕重導向與瀏覽器傳入的服務網址或金鑰。Console 密碼不會提供給 Hermes。

## 驗證與限制

最新接續見 [活動、學習地圖與邀請制](docs/LEARNING_INVITATIONS.md)。舊 PR #11／#14 文件僅為歷史紀錄，其免登入方案已由本輪要求取代。契約測試不是 Zeabur／Canva／電子郵件收件匣的實機驗證。部署、授權與發布步驟見 [PRODUCTION](docs/PRODUCTION.md)、[SECURITY](docs/SECURITY.md)、[ARCHITECTURE](docs/ARCHITECTURE.md)、[RELEASE_CHECKLIST](docs/RELEASE_CHECKLIST.md)。

## Lumen 創作台 MCP

Hermes 可呼叫 Lumen 創作台。GitHub 倉庫網址不是 MCP。在「設定 → 連線」填 `LUMEN_MCP_URL`（`https://…/api/mcp`）與至少 32 字元的 `LUMEN_MCP_TOKEN`，再按「測試 Lumen 連線」。探測成功後，海報／文宣／招新／茶會意圖會走工作區 `lumen_*`（Runtime `mcp.lumen.*`），口語用 `lumen_utter`。選定方向留給使用者，不要呼叫 choose。詳見 [Lumen MCP](docs/LUMEN.md)。

## FrameLab 動畫 MCP

Hermes 可呼叫 FrameLab 逐格動畫工作站。GitHub 倉庫網址不是 MCP。在「設定 → 連線」填 `FRAMELAB_MCP_URL`（`https://…/api/mcp`）與從 FrameLab 首頁產生的 `FRAMELAB_MCP_TOKEN`，再按「測試 FrameLab 連線」。探測成功後 Hermes 可用 `mcp.framelab.*` 與工作區 `framelab_*` 工具。詳見 [FrameLab MCP](docs/FRAMELAB.md)。

## 對稿工作室 MCP

Hermes 可呼叫對稿海報工作室。GitHub 倉庫網址不是 MCP。在「設定 → 連線」填 `DUIGAO_MCP_URL`（`https://…/api/mcp`）與從對稿 MCP 頁複製的 `DUIGAO_MCP_TOKEN`，再按「測試對稿連線」。探測成功後 Hermes 可用 `mcp.duigao.*` 與工作區 `duigao_*` 工具。詳見 [對稿 MCP](docs/DUIGAO.md)。
