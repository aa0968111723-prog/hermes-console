# Hermes Console 正式部署

此文件描述**實際可部署狀態**，不是尚未完成的能力清單。未設定的登入或 MCP 必須顯示未設定／失敗，禁止假裝成功。

## 產品入口

使用者打開網站 → **AuthGate**（Google／淡江 SSO／Email）→ 通過 session + workspace membership → Hermes Console → Hermes Agent → Planner／Memory／Tools／MCP → 外部服務 → Artifacts。

`CONSOLE_GATEWAY_SECRET` 是部署層閘道，不是帳號登入。兩者都要：閘道保護網路邊界，identity 保護工作區。

## Zeabur

- 使用倉庫 Dockerfile 的長駐 Node 程序，單一 replica。
- 掛載可寫卷到 `CONSOLE_DATA_DIR`（容器預設 `/app/data`）。
- 可選 `DATABASE_URL` 指向 **Console 專用** Postgres（`console_records`／`console_sessions`／`console_limits`）。不要指向 ai_os 或 `cutos_memory_items`。
- 外部必須 HTTPS。`CONSOLE_ORIGIN` 設成精確公開 origin。
- 正式環境：`CONSOLE_REQUIRE_GATEWAY=true` 且 `CONSOLE_GATEWAY_SECRET` ≥ 32 字元。閘道驗證後才覆寫 `X-Console-Gateway`。瀏覽器不能看到此值。
- `CONSOLE_ALLOW_LOCAL_ACCESS=false`。該旗標只允許 loopback 開發自動驗證電子信箱。
- 曾在 chat／issue／commit 曝光的金鑰一律視為已洩漏，部署前輪替。

## 必要環境

| 變數 | 用途 |
| --- | --- |
| `CONSOLE_ORIGIN` | 精確公開 origin；缺漏時 production 啟動失敗 |
| `CONSOLE_GATEWAY_SECRET` | 閘道標頭 |
| `CONSOLE_DATA_DIR` 或 `DATABASE_URL` | 持久化 |
| `HERMES_API_URL` / `HERMES_API_KEY` | Hermes Agent。未設時 UI 顯示未設定 |
| `CONSOLE_VAULT_KEY` | 加密已存 OAuth／MCP 憑證 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google 授權碼 + PKCE。未設＝尚未完成設定 |
| `TAMKANG_SSO_*` | 淡江正式 IdP。未設＝「淡江 SSO 尚未完成設定」 |
| `CONSOLE_EMAIL_FROM` / `RESEND_API_KEY` | Email 驗證／Magic Link／重設密碼 |
| `MCP_BRIDGE_TOKEN` | Hermes → Console `/api/mcp` |
| 各 MCP `*_URL` / `*_TOKEN` | 見 `.env.example` |

啟動時 `instrumentation.ts` 在 production 檢查：

- `CONSOLE_ORIGIN` 必須存在且可解析，不可含帳密
- 非 loopback 必須 HTTPS
- `CONSOLE_ALLOW_LOCAL_ACCESS=true` 只能用在 localhost／127.0.0.1
- `CONSOLE_REQUIRE_GATEWAY=true` 時 `CONSOLE_GATEWAY_SECRET` ≥ 32 字元

缺漏時直接啟動失敗，不要等使用者操作才發現。Google／淡江／Hermes／MCP 未設不阻擋啟動，但畫面與 health 必須顯示未設定／不可用。

## 資料庫

- SQLite：`$CONSOLE_DATA_DIR/console.sqlite`
- Postgres：啟動時若 Postgres 空且 SQLite 有列，一次性搬移。之後以 Postgres 為主。
- Schema 變更走正式 migration／store 程式；禁止 production 啟動時隨意改表。
- 部署前備份 SQLite 卷與 Postgres。回滾：停機、還原備份、再啟動同一 image。

## OAuth / SSO

- Google：Authorization Code + PKCE。callback `/api/auth/google/callback`。Secret 只在 server。
- 淡江：`TamkangAuthProvider` 支援 OIDC／OAuth；SAML／CAS 尚未接入校方中繼資料時顯示尚未完成設定。**禁止**向 Hermes 收集學校密碼、禁止 Playwright 自動登入校方。
- Email：Argon2id `passwordHash`、驗證信、Magic Link、重設密碼。本機 loopback 且 `CONSOLE_ALLOW_LOCAL_ACCESS=true` 才可跳過寄信直接驗證。
- 三種登入連結到同一個 `User`。Email 相同不會自動合併。

## MCP

統一 registry：`unconfigured` → `connected`／`partial`／`verified`／`failed`。

- 無法連線：`failed`
- 缺 token：`unconfigured`
- 只 listTools：`partial`（不是 available）
- 可安全讀取且結果非空：`verified`（Runtime 對應 `available`）

GitHub 倉庫網址不是 MCP。localhost／169.254.*／私網／metadata／file／ftp 在正式環境拒絕。

## Domain / HTTPS / Health

- 公開 URL 只走 HTTPS。
- `GET /api/health`：liveness + `live`／`ready`／`agentReady`。不回傳 secret。
- `GET /api/ready`：儲存庫探測。App 活著 ≠ Agent 可用（看 `agentReady`）。
- 兩者都不需要 session，方便負載平衡探針。

## Backup / Rollback

1. 備份 `CONSOLE_DATA_DIR` 與 Postgres。
2. 記錄目前 image／commit。
3. 出問題時還原備份並部署已知良好 image。
4. 不要用 Git 歷史裡的舊秘密。

## 尚未完成（禁止假裝）

- 淡江 SSO：需校方正式 Client／Metadata 才能跳轉 IdP。
- Google Login：需部署端填入 OAuth client。
- 正式 Zeabur 實機連線／資料卷還原：本輪未授權自動部署。
