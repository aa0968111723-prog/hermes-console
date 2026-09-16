# Security

## Secrets

- API key、OAuth secret、MCP token、SSO secret、Zeabur token **只存在伺服器**（環境變數或 `CONSOLE_DATA_DIR` 加密 vault）。
- 禁止 `NEXT_PUBLIC_*` secret、localStorage、client state、console.log、Git commit。
- GET 設定 API 只回是否已設定與末四碼。
- 曾出現在 Chat／Issue／README／Commit／Log 的憑證視為已洩漏，必須 rotate。

## Auth

- AuthGate 先驗證，再載入工作區。
- Google：Authorization Code + PKCE + server-side state。Cookie `hermes_auth`：HttpOnly、SameSite=Lax、HTTPS 時 Secure。
- 淡江：只跳轉校方 IdP。沒有 metadata 就顯示尚未完成設定。禁止保存學校密碼、禁止 Playwright 自動登入學校。
- Email：Argon2id；舊 scrypt 仍可驗證。Rate limit、單次 token、驗證／重設過期。
- 相同 email **不會**自動合併帳號。連結身份必須已登入。
- 登入成功 ≠ 進入私人工作區。需要 `owner`／`admin`／`member` membership。API 在 `CONSOLE_ALLOW_LOCAL_ACCESS` 以外會檢查 session + membership。

## Sessions

- 使用既有 `console_sessions`／SQLite `sessions` 表，owner 為 user id。
- 額外以 `console_records` kind `auth_session` 保存裝置標籤與建立時間，不另 ALTER。
- `GET/DELETE /api/auth/sessions`：列出目前使用者的有效工作階段；不能結束目前這個瀏覽器（請用登出）；DELETE 驗證 Origin。
- 登出刪除 digest、工作階段紀錄並清 cookie。
- `CONSOLE_ALLOW_LOCAL_ACCESS` 與空閘道只適用 loopback；公開部署 fail closed。

## MCP / SSRF

- 外部 URL 必須 HTTPS、無 userinfo／query／hash。
- 禁止 localhost（除非測試旗標）、`169.254.*`、私網、metadata、`file://`、`ftp://`、GitHub 當 MCP。
- MCP 橋接使用獨立 Bearer `MCP_BRIDGE_TOKEN`，不是瀏覽器 session。

## 其他

- 寫入驗證 Origin。CSRF：cookie SameSite + Origin。
- OAuth state 10 分鐘過期、單次使用。
- 錯誤分類見 `lib/server/errors.ts`（`AUTH_ERROR` 等）。回應可含 `category`，不回內部 stack 或 token。
- 確認型操作使用伺服器一次性 confirmation token，前端 `confirmed=true` 不足。
- 事故：撤銷洩漏憑證、輪替 vault key 前先備份，否則舊密文無法解密。
