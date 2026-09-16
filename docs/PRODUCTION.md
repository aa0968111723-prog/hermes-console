# Production

本文件描述實際可部署狀態。未完成項目標 Partial。本輪 **沒有** 對 Zeabur 執行部署。

## Zeabur

- 單一長駐 Node 服務跑 `npm start`（`next start`）。
- 需要持久化卷給 `CONSOLE_DATA_DIR`（SQLite）或受管 Postgres（`DATABASE_URL`）。
- 一組 replica；不要無狀態多實例搶同一個 SQLite 檔。
- 公開網址必須 HTTPS，並設為 `CONSOLE_ORIGIN`（無路徑、無結尾斜線以外的多餘字元）。

關係：

```
Browser → Console (this app)
        → Hermes Agent (HERMES_API_URL)
        → MCP endpoints (server-side only)
        → SQLite volume or Postgres
```

記載中的既有站 `https://344.zeabur.app` 不是本 PR 的驗證對象。

## Env

複製 `.env.example`。正式環境最少：

- `CONSOLE_ORIGIN`（缺則啟動失敗）
- `CONSOLE_AUTH_MODE=required`（production 預設）
- `HERMES_API_URL`／`HERMES_API_KEY`（聊天才可用；未設須顯示未連線）
- Email 密碼登入不需 Resend；驗證／Magic Link／重設需要 `RESEND_API_KEY` + `CONSOLE_EMAIL_FROM`
- Google：`GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`，授權重導向 `https://<origin>/api/auth/google/callback`
- 淡江 SSO：Partial。沒有校方 Client／Metadata 時不要填假值。
- MCP：各 `*_MCP_URL`／`*_MCP_TOKEN`。Token 不要寫進 `CONSOLE_MCP_SERVERS_JSON`。
- 可選：`CONSOLE_GATEWAY_SECRET`（≥32 字元）、`DATABASE_URL`、`CONSOLE_VAULT_KEY`

禁止 `NEXT_PUBLIC_*` 秘密。禁止把 Token 寫進前端或 git。

## DB

- 空白 `DATABASE_URL` → SQLite。
- Postgres 僅使用 `console_records`／`console_sessions`／`console_limits`。
- 若 Postgres 為空且 SQLite 有列，啟動時一次性搬移。
- Schema 變更走程式內的 store 初始化，不是 production 隨興 ALTER。Rollback：保留 SQLite 卷快照或 Postgres backup，改回上一版映像。

## OAuth / SSO

- Google：Authorization Code + PKCE（S256）。Client secret 只在 token 交換。
- 淡江：`TamkangAuthProvider`。未完成設定時 API 503、按鈕停用、文案「淡江 SSO 尚未完成設定」。禁止收集校方密碼。
- Email：Argon2id、attempt limit、一次性 token。

## MCP

設定 → 連線。狀態必須是真實探測結果。Endpoint 須 HTTPS、拒絕私網／metadata（SSRF）。

## Domain / HTTPS

`CONSOLE_ORIGIN` 必須等於瀏覽器 Origin。Cookie：`HttpOnly; SameSite=Strict; Secure`（HTTPS）。

## Health

- `GET /api/live`：行程活著。不含 DB／Hermes／Secret。
- `GET /api/ready`：儲存可用。200／503。含 `backend`、`dataDir`，不含連線字串。
- `GET /api/health`：匿名可讀摘要。不含 Token、密碼、Cookie、Authorization。App 活著 ≠ Agent 可用。

## Backup

部署前備份 SQLite 檔或 Postgres。Vault key（`CONSOLE_VAULT_KEY` 或 dataDir `vault.key`）遺失會無法解密已存 OAuth token，必須當成新授權。

## Rollback

1. 改回上一版映像／commit。
2. 還原 DB 卷。
3. 不要把新 secret 寫回舊環境。
4. 健康檢查：`/api/live`、`/api/ready`、登入頁、一則聊天。

## Rehearsal（本輪）

本代理環境沒有授權對正式 Zeabur 部署。本機 rehearsal：`npm ci` → 設定 env → `npm run build` → `npm start` → 電子信箱註冊／登入 → 工作區載入。外部 Hermes／MCP／Google／淡江仍取決於你的密鑰。
