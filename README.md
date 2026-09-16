# Hermes Creative Intelligence

Hermes Agent 的視覺化 AI 工作空間。人類透過 Console 下達意圖；Hermes 規劃、使用工具與 MCP、回傳結果。這不是工具清單、MCP Dashboard，也不是 ChatGPT clone。

正式產品入口：未登入 → Login → Hermes。未設定的登入提供者必須顯示「尚未完成設定」，禁止假裝成功。

1. `npm ci`
2. 複製 `.env.example` 到 `.env.local`，依註解設定。本機可不設邀請／寄信變數。
3. 設定經確認的 `HERMES_API_URL` 與全新 `HERMES_API_KEY`。禁止使用曾公開的舊金鑰。未設定時 Console 仍應開啟，並顯示尚未連線。找靈感可先用工作區已收藏來源與社團視覺語言整理方向，不會假裝 Hermes 已執行。
4. `npm run dev` 後開啟 http://localhost:3000。預設免登入。只有設 `CONSOLE_AUTH_REQUIRED=true` 才會先看到登入頁。正式環境使用 `npm run build` 與 `npm start`。
5. 未設或空白 `DATABASE_URL` 時使用 `CONSOLE_DATA_DIR` SQLite（容器預設 `/app/data`）。設定後改用 Hermes 自有 Postgres 表（`console_records`／`console_sessions`／`console_limits`）；若 Postgres 為空且 SQLite 有列，啟動時一次性搬移。不要指向 ai_os 或 `cutos_memory_items`。`GET /api/ready` 回傳目前 `backend` 與 `dataDir`（200／503）；`GET /api/health` 附相同欄位，都不回傳連線字串。契約測試在沒有 `DATABASE_URL` 時略過 Postgres，只跑 SQLite。

Human → Hermes Console → Hermes Agent → Planner / Memory / Tools / MCP → External services → Artifacts

詳見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 重要安全操作

需要 Node.js 22.13+，單一長駐 Node 程序與持久化磁碟（不適用無狀態 serverless）。

1. `npm ci`
2. 複製 `.env.example` 到 `.env.local`
3. 設定 `CONSOLE_ORIGIN`。正式環境另需登入與 Hermes 連線。
4. 未設 `DATABASE_URL` 時使用 `CONSOLE_DATA_DIR` SQLite；設定後使用 Hermes 自有 Postgres 表（`console_records`／`console_sessions`／`console_limits`）。不要指向 ai_os 或 `cutos_memory_items`。
5. `npm run dev` 開 http://localhost:3000。正式環境：`npm run build` 與 `npm start`。

## Env

後端專用，禁止 `NEXT_PUBLIC` 秘密與 client bundle。完整清單見 `.env.example`。

| 變數 | 用途 |
| --- | --- |
| `CONSOLE_ORIGIN` | 正式環境必填。變更請求驗 Origin。 |
| `CONSOLE_AUTH_MODE` | `required`（production 預設）或 `workspace`（契約測試／本機單一 owner）。 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OIDC Authorization Code + PKCE。未設則 Google 按鈕停用。 |
| `TAMKANG_OIDC_ISSUER` / `TAMKANG_CLIENT_ID` / `TAMKANG_CLIENT_SECRET` | 淡江 OIDC。未設則顯示「淡江 SSO 尚未完成設定」。SAML／CAS 尚未接入。 |
| `RESEND_API_KEY` / `CONSOLE_EMAIL_FROM` | Email 驗證、Magic Link、重設密碼。未設仍可密碼註冊／登入，信箱標未驗證。 |
| `HERMES_API_URL` / `HERMES_API_KEY` | Hermes Agent。未設則聊天不能送出，UI 顯示未連線。 |
| `CONSOLE_GATEWAY_SECRET` | 可選部署閘道，不是帳號登入。 |
| `DATABASE_URL` | 可選 Postgres。空白則 SQLite。 |
| `*_MCP_URL` / `*_MCP_TOKEN` | MCP。未設為 unconfigured，探測失敗為 failed，只 listTools 為 partial。 |

曾在聊天、Issue、README、commit 或 log 出現過的金鑰一律視為 compromised，必須 rotate。

Hermes 可呼叫 FrameLab 逐格動畫工作站。GitHub 倉庫網址不是 MCP。在「設定 → 連線」填 `FRAMELAB_MCP_URL`（`https://…/api/mcp`）與從 FrameLab 首頁產生的 `FRAMELAB_MCP_TOKEN`，再按「測試 FrameLab 連線」。探測成功後 Hermes 可用 `mcp.framelab.*` 與工作區 `framelab_*` 工具。詳見 [FrameLab MCP](docs/FRAMELAB.md)。

三種登入共用同一個 User，不會因 Email 相同而自動合併。

- Google：Authorization Code + PKCE。Secret 只在 server。
- 淡江 SSO：`TamkangAuthProvider`。OIDC／OAuth 在有 issuer、client id、client secret 時走 Authorization Code + PKCE，並跳轉校方 IdP。SAML／CAS 仍顯示「淡江 SSO 尚未完成設定」。禁止收集校方密碼。
- Email：註冊、登入、驗證、忘記密碼、重設、信件登入。密碼 Argon2id。寄信未設時登入頁仍顯示忘記密碼／信件登入，並標明尚未完成設定，不會假裝已寄出。

登入成功不代表有權改連線設定。寫入憑證需 `owner`／`admin`。所有工作區 API 在 `required` 模式驗證 session **與** workspace membership。

## MCP

單一 Registry（`lib/server/mcp-registry.ts`）。狀態：`unconfigured`／`verifying`／`connected`／`partial`／`verified`／`failed`。`tools/list` 不是 available。不可達是 failed。沒有 token 是 unconfigured。

Hermes 自己決定用哪些工具。使用者不必選 GALLEY／Canva／淡江 MCP。

## Development

```
npm run lint
npm run typecheck
npm test
npm run build
npm run test:entry
npm run test:ui
```

Playwright 腳本需要先 `npm run build`。契約測試不是 Zeabur／Canva／校方 SSO 的實機驗證。

## Deploy

見 [docs/PRODUCTION.md](docs/PRODUCTION.md)、[docs/SECURITY.md](docs/SECURITY.md)、[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)。

本輪不自動部署、不輪替遠端密鑰、不重寫 Git 歷史。

## Tests

- Unit／integration：`npm test`
- Production browser：`test:entry`、`test:ui`、`test:chat`、`test:workbench`、`test:gateway`、`test:runtime`
- CI：lint、typecheck、unit、build、secret check、audit、Playwright

## Honest limitations

- 淡江 SSO：**Partial**（程式有 OIDC 路徑，缺校方 Client／Issuer 時不能登入）
- Google Login：程式路徑 live，需部署端填 Client
- Instagram／Pinterest：公開可取得來源，不是完整官方搜尋
- Audience Twin：模擬，不代表全部學生
- MCP `verified`：僅在安全讀取（read-only 工具有內容，或 resources 清單非空）之後
- 本環境不能代替你的 Zeabur 正式站驗證
