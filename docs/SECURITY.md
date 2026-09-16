# Hermes Console 安全說明

## Secrets

只能存在：

- 部署秘密儲存
- server-side env
- `CONSOLE_DATA_DIR` vault（加密）

禁止：localStorage、client bundle、`NEXT_PUBLIC_*` secret、console.log、Git commit、健康檢查回應。

曾在 Chat、Issue、README、Commit、Log 出現的金鑰視為 compromised，必須輪替，不得重用。

`registerRedactionSecrets`／`redact()` 會遮罩 KEY／TOKEN／PASSWORD／SECRET、Bearer、以及 `sk-` 形式字串。新增秘密來源時要掛上。

## Auth

- Google：OIDC Authorization Code + PKCE。`client_secret` 只在 token exchange。
- 淡江：只跳轉校方 IdP。Hermes 不收集、不保存、不轉送學校密碼。連線設定只接受 Bearer 權杖。未設定時誠實顯示尚未完成設定。
- Email：Argon2id（`@noble/hashes`）。至少 12 字元。Rate limit + attempt limit。驗證／重設／Magic Link token 單次使用並有過期。
- Session：`hermes_session` HttpOnly、SameSite=Lax、有條件 Secure。12 小時。
- 登入成功 ≠ 進入工作區。API 驗證 session **加上** workspace membership（owner／admin／member）。
- 帳號連結必須在已登入狀態明確發起。禁止只因 Email 相同就合併。

## Sessions

- Token 只存 SHA-256。
- 登出刪除該 session。
- 設定 → 帳號顯示作用中工作階段（截斷 id），不顯示完整 cookie。

## MCP / SSRF

`assertSafeServiceUrl`：

- 正式環境僅 HTTPS、無 userinfo、無 query／hash
- 拒絕 localhost（除非明確 `HERMES_ALLOW_LOOPBACK_HTTP=true` 的隔離測試）、169.254.*、私網、metadata、file://、ftp://
- MCP 目標必須在後端核准清單；前端不能覆寫 endpoint／credential

Webhook／上游回應不得回傳到瀏覽器原文。

## CSRF / Origin / CORS

- 突變檢查 `Origin` 與 `CONSOLE_ORIGIN`。
- Cookie SameSite=Lax。
- 不使用寬鬆 CORS 把憑證交給任意站台。

## OAuth

- `state` 單次使用、短效、綁定 provider 與 PKCE verifier。
- 開連結時可帶目前 user id 作為 `linkUserId`。
- Open redirect：callback 只回 `CONSOLE_ORIGIN/`。

## Rate limit

`limited()` 以 workspace／email／login／register 等 key 計數。429 帶 `Retry-After`。

## Incident rotation

1. 撤銷曝光的 API key、OAuth client secret、MCP token、閘道 secret、vault key。
2. 視為所有使用該 secret 的 session／token 失效。
3. 重新產生並只寫入部署秘密儲存。
4. 檢查 Git 歷史與日誌是否仍含明文；不要 force-push 改歷史除非另有授權。
