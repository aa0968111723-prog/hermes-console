# Hermes Console

Hermes Agent 的正式視覺化 AI 工作空間。打開網站後先登入，再直接說想做什麼；Hermes 自己規劃、搜尋、使用 MCP、整理結果。使用者不必先選工具。

這不是工具清單 App、MCP Dashboard、或 ChatGPT clone。

## Architecture

```
Human → Hermes Console → Hermes Agent → Planner / Memory / Tools / MCP → External → Artifacts
```

詳見 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## Setup

需要 Node.js 22.13+，建議 Node.js 24 LTS。需要持久化磁碟與單一長駐 Node 程序。

1. `npm ci`
2. 複製 `.env.example` 到 `.env.local`，依註解設定。**不要**把曾公開的金鑰貼回去。
3. 本機：`CONSOLE_ORIGIN=http://localhost:3000`、`CONSOLE_ALLOW_LOCAL_ACCESS=true`（僅 loopback 可跳過寄信直接驗證 Email）。
4. `npm run dev` 後開啟 http://localhost:3000，應先看到登入（Hermes 龜龜），不是工作區。
5. 未設 `DATABASE_URL` 時使用 `CONSOLE_DATA_DIR` SQLite。設定後改用 Hermes 自有 Postgres 表。

## Env

後端專用。完整清單在 `.env.example`。重點：

| 類別 | 變數 |
| --- | --- |
| Origin / 閘道 | `CONSOLE_ORIGIN`、`CONSOLE_GATEWAY_SECRET`、`CONSOLE_REQUIRE_GATEWAY` |
| Auth | `GOOGLE_CLIENT_ID`／`SECRET`、`TAMKANG_SSO_*`、`CONSOLE_EMAIL_FROM`、`RESEND_API_KEY` |
| Hermes | `HERMES_API_URL`、`HERMES_API_KEY` |
| MCP | `MCP_BRIDGE_TOKEN`、各服務 `*_URL`／`*_TOKEN`、`CONSOLE_MCP_SERVERS_JSON` |
| Store | `CONSOLE_DATA_DIR`、`DATABASE_URL`、`CONSOLE_VAULT_KEY` |

未設定的登入或 MCP 必須顯示尚未完成設定／失敗。禁止假裝已連線。

## Auth

正式支援三種登入，同一個 User：

- **Google**：OAuth／OIDC Authorization Code + PKCE。未設 client 時按鈕顯示尚未完成設定。
- **淡江 SSO**：只跳轉校方 Identity Provider。目前沒有正式 Client／Metadata 時顯示「淡江 SSO 尚未完成設定」。Hermes 不要求學校密碼。
- **Email**：建立帳號、登入、驗證、忘記密碼、Magic Link、登出。密碼為 Argon2id。

登入成功仍需 workspace membership 才能進私人工作區。詳見 [SECURITY.md](docs/SECURITY.md)。

## MCP

統一 registry。狀態只有真實探測結果：`unconfigured`、`connected`、`partial`、`verified`、`failed`。listTools 不是 available。GitHub 倉庫網址不是 MCP。

## Development

```
npm run lint
npm run typecheck
npm test
npm run build
npm run rehearse
```

瀏覽器契約（需先 `npm run build`）：

```
npm run test:entry
npm run test:ui
npm run test:chat
npm run test:workbench
npm run test:gateway
npm run test:runtime
```

契約測試不是 Zeabur／Canva／淡江 IdP／實體 Android 的實機證明。

## Deploy

見 [PRODUCTION.md](docs/PRODUCTION.md)、[DEPLOYMENT.md](docs/DEPLOYMENT.md)、[RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)。本倉庫不自動部署。

## Tests

- Unit／integration：`tests/*.test.ts`
- Playwright：上述 `test:*` scripts
- CI：lint、typecheck、unit、build、secrets、rehearse、audit、Playwright

## 誠實限制

- 淡江 SSO 尚未完成校方設定（Partial）
- Google Login 需部署端 OAuth client（Partial，直到填入）
- 多數外部 MCP 未設定時為 unconfigured，不是已連線
- Instagram／Pinterest 沒有完整官方搜尋 API
- Audience Twin 是模擬，不代表全部學生
