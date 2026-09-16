# Hermes Console

Hermes Agent 的視覺化 AI 工作空間。人類透過 Console 下達意圖；Hermes 規劃、使用工具與 MCP、回傳結果。這不是工具清單、MCP Dashboard，也不是 ChatGPT clone。

正式產品入口：未登入 → Login → Hermes。未設定的登入提供者必須顯示「尚未完成設定」，禁止假裝成功。

## Architecture

Human → Hermes Console → Hermes Agent → Planner / Memory / Tools / MCP → External services → Artifacts

詳見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## Setup

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
| `TAMKANG_*` | 校方正式 SSO metadata／Client。未設則顯示「淡江 SSO 尚未完成設定」。 |
| `RESEND_API_KEY` / `CONSOLE_EMAIL_FROM` | Email 驗證、Magic Link、重設密碼。未設仍可密碼註冊／登入，信箱標未驗證。 |
| `HERMES_API_URL` / `HERMES_API_KEY` | Hermes Agent。未設則聊天不能送出，UI 顯示未連線。 |
| `CONSOLE_GATEWAY_SECRET` | 可選部署閘道，不是帳號登入。 |
| `DATABASE_URL` | 可選 Postgres。空白則 SQLite。 |
| `*_MCP_URL` / `*_MCP_TOKEN` | MCP。未設為 unconfigured，探測失敗為 failed，只 listTools 為 partial。 |

曾在聊天、Issue、README、commit 或 log 出現過的金鑰一律視為 compromised，必須 rotate。

## Auth

三種登入共用同一個 User，不會因 Email 相同而自動合併。

- Google：Authorization Code + PKCE。Secret 只在 server。
- 淡江 SSO：`TamkangAuthProvider` 抽象（OIDC／OAuth／SAML／CAS）。目前沒有校方 Client／Metadata，**不能登入**。
- Email：註冊、登入、驗證、忘記密碼、重設、Magic Link。密碼 Argon2id。

登入成功不代表有權改連線設定。寫入憑證需 `owner`／`admin`。所有工作區 API 在 `required` 模式驗證 session。

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

- 淡江 SSO：**Partial／未完成設定**
- Google Login：程式路徑 live，需部署端填 Client
- Instagram／Pinterest：公開可取得來源，不是完整官方搜尋
- Audience Twin：模擬，不代表全部學生
- MCP `verified`：需要安全讀取證據；目前探測停在 partial（tools/list）
- 本環境不能代替你的 Zeabur 正式站驗證
