# Security

## Secrets

只存在 server env、加密 vault、或受控閘道。禁止：

- `localStorage`／client state
- `NEXT_PUBLIC` secret
- `console.log` 印 Token／密碼／Cookie／Authorization／個資
- Git commit

曾在 Chat、Issue、README、Commit、Log 出現的值視為 compromised，必須 rotate，不得重用。

## Auth

- Google：OIDC Authorization Code + PKCE。`state` 一次性、10 分鐘。tokeninfo 核對 `aud` 與 `nonce`。
- 淡江 SSO：OIDC Authorization Code + PKCE。Secret 只在 token 交換。未完成校方 Client／Metadata 時不得成功。SAML／CAS 尚未接入。禁止收集或保存校方密碼，禁止自動登入爬蟲。
- Email：Argon2id（`hash-wasm`）。嘗試次數鎖定。驗證／重設／Magic Link 一次性且有期限。未知與已知信箱對 Magic Link／忘記密碼回同一則訊息，避免枚舉。
- Session：`hermes_session` HttpOnly cookie，12 小時。登出可清目前或全部工作階段。
- 身分連結：Google／淡江／Email 掛在同一 User。禁止只因 Email 相同自動合併。

## Sessions and CSRF

變更請求檢查 `Origin` 與 `CONSOLE_ORIGIN`。Session cookie `SameSite=Strict`。閘道 header 由反向代理注入，瀏覽器不得自帶有效 `X-Console-Gateway`。

## Authorization

`authenticate()` 在 required 模式驗證 session **與** workspace membership。憑證寫入、MCP 測試與 Zeabur 變更另需 owner／admin。UI 隱藏不是授權。Hermes 不收集校園帳號或密碼。淡江 SSO 只走校方 IdP。

## MCP / SSRF

`assertSafeServiceUrl`／`safeMcpFetch`：

- 拒絕 `localhost`（除非明確 `HERMES_ALLOW_LOOPBACK_HTTP` 且僅本機）
- 拒絕 `169.254.*`、私網、metadata host、`file://`、`ftp://`
- 拒絕帶帳密或 query 的服務 URL
- 禁止跟隨跨 origin 重導向

MCP token 只放後端 env／vault 參照，不進 `CONSOLE_MCP_SERVERS_JSON` 明文。

使用者貼上的參考連結只保存 URL 與 hostname 磁磚，伺服器不代抓 OG 圖或任意網站預覽，避免 SSRF。

## Other

- XSS：使用者內容經既有 Markdown／結構化元件，不把 tool JSON 當 HTML。
- Open redirect：OAuth callback 只回 `CONSOLE_ORIGIN`。
- Rate limit：API 與登入／註冊分開限流。
- Webhook：本產品沒有未驗證的公開 webhook 入口可改資料。
- Health／Ready／Live 回應不得含 Secret。正式 required 模式且未登入時，`GET /api/health` 也不回 models／skills／toolsets。
- 正式 `CONSOLE_ORIGIN` 必須 https；僅 loopback 可用 http 做 rehearsal。

## Incident rotation

1. 撤銷已暴露的 API key、OAuth client secret、MCP token、閘道 secret、DB 連線字串。
2. 發新密鑰到部署端，不要寫進 git。
3. 清 session（必要時登出所有工作階段）。
4. 檢查 vault 是否用舊 key 加密；必要時重新授權 Canva 等外部帳號。
