# Production

這份文件描述**目前程式實際支援**的部署方式。未完成的能力標 Partial，不標成功。

## Zeabur / 長駐 Node

- 使用倉庫 `Dockerfile` 的 standalone Node 服務，單一 replica。
- 掛載可寫持久卷到 `/app/data`（SQLite 後備）。
- 可選 `DATABASE_URL` 指向 **Console 專用** Postgres（`console_records`／`console_sessions`／`console_limits`）。不要指向 ai_os。
- 不適用無狀態 serverless。

## 必要環境

| 變數 | 用途 |
| --- | --- |
| `CONSOLE_ORIGIN` | 公開 HTTPS origin。寫入請求 Origin 驗證。啟動時必填。 |
| `CONSOLE_DATA_DIR` | SQLite／uploads／vault.key |
- `HERMES_API_URL`／`HERMES_API_KEY` | 未設時聊天顯示尚未連線，不假裝 Hermes 可用 |
- `HERMES_IMAGE_INPUT=true` | 只有部署端確認 Hermes 真的收圖後才開。未開時附圖顯示「尚未驗證讀圖」，送出會拒絕，不假裝已分析。 |

正式登入（AuthGate）至少擇一：

- Google：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`（可選 `GOOGLE_REDIRECT_URI`，預設 `${CONSOLE_ORIGIN}/api/auth/google/callback`）
- Email：`RESEND_API_KEY`、`CONSOLE_EMAIL_FROM`

`CONSOLE_ALLOW_LOCAL_ACCESS=true` 只允許 loopback 測試略過登入閘與部分環境檢查。公開部署必須為 `false`。

## 建議環境

- `CONSOLE_GATEWAY_SECRET`（≥32）或前置已驗證的閘道
- `CONSOLE_VAULT_KEY`（64 hex）；否則程序會在資料目錄寫 `vault.key`
- `DATABASE_URL`
- 各 MCP `*_URL`／`*_TOKEN`：未設必須顯示 unconfigured

## 資料庫

- 無 `DATABASE_URL`：SQLite。
- 有 Postgres：啟動時若 Postgres 空且 SQLite 有列，一次性搬移。
- Schema 變更走程式內 `CREATE TABLE IF NOT EXISTS`。此版本**沒有**獨立 SQL migration 目錄；回滾策略是還原卷／Postgres 備份，而不是 down migration。**Partial。**

## OAuth / SSO

- Google：Authorization Code + PKCE。Secret 只在伺服器。
- 淡江 SSO：需要 `TAMKANG_SSO_ISSUER`、`TAMKANG_SSO_CLIENT_ID`、`TAMKANG_SSO_CLIENT_SECRET`、`TAMKANG_SSO_PROTOCOL=oidc|oauth`。沒有校方 metadata 時畫面為「淡江 SSO 尚未完成設定」。SAML／CAS 僅預留，未實作。Console **不**收集學校密碼。設定頁 Tamkang MCP 只接受網址與 Bearer 權杖；帳號登入走 SSO 跳轉。
- Email：註冊、登入、驗證、magic link、忘記／重設密碼。`/#reset=` 開啟重設表單。已登入可連結電子信箱。密碼為 Argon2id。相同信箱不會自動合併帳號。

## Domain / HTTPS

外部必須 HTTPS。OAuth callback 與 `CONSOLE_ORIGIN` 必須一致。

## Health

- `GET /api/ready`：store 就緒（200／503）。不需登入。App 能寫資料 ≠ Hermes 可用。
- `GET /api/health`：**存活**探針。App + 最後一次 Hermes 快取／未設定狀態。`live=true` 代表行程活著；`agentReady=true` 只有在目前憑證已有成功 Agent 任務。不需登入、不回秘密、**不等待**上游 Hermes。
- `POST /api/health`：才會探測 Hermes（Origin + 授權）。未探測不得把 Agent 標成可用。

## Backup / Rollback

- 部署前備份 Postgres 或 SQLite 卷與 `uploads/`、`vault.key`。
- 回滾：還原映像＋資料卷。不要 force-push。
- 曾暴露的金鑰一律視為 compromised，必須輪替，不要重用。

## MCP

Hermes 連 Console `/api/mcp`。外部 MCP 必須是受控 HTTPS，禁止 GitHub 倉庫網址、localhost（除非明確 loopback 測試）、私網與 metadata。狀態：未設定 `unconfigured`；已填 URL 尚未探測 `awaiting_authorization`；只完成 tools/list `partial`；安全讀取通過才是 `available`／`verified`；連不到是 `failed`。缺 token 不得標成可用。GET `/api/mcp-registry` 不回 endpoint 或 schema。
