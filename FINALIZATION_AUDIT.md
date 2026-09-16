# Hermes Console 收尾盤點

盤點基準：`main` `094a0b0` + 本 finalization 分支。評等只描述程式現況，不是行銷承諾。

評等：`live`＝已接真實路徑；`partial`＝有實作但不完整或未驗證；`legacy`＝休眠；`danger`＝仍需部署端處理。

## 本輪已收斂

| 能力 | 狀態 | 依據 |
| --- | --- | --- |
| 手機捲動擁有權 | live（契約／瀏覽器） | Chat：`conversation-scroll`；其他頁：`.secondary-page`／`.page-scroll`。靈感頁不再被 100dvh+overflow:hidden 裁切。 |
| Android 鍵盤 | live（模擬 visualViewport） | 開啟才寫 `--app-height`；關閉移除，避免殼層永久縮短。`offsetTop` 納入判斷。 |
| Bottom dock | live | 對話／專案／Hermes／靈感／Agent；設定在頭像／齒輪。 |
| AuthGate | live（正式必填） | `/` → Login → Hermes。`CONSOLE_AUTH_MODE=workspace` 僅契約／本機。 |
| Google OIDC + PKCE | live 路徑／未填 Client 則停用 | Secret 只在 server。 |
| 淡江 SSO | **partial**（OIDC 路徑 live） | issuer+client+secret 時跳轉校方 IdP（PKCE）。無校方 Client 時「淡江 SSO 尚未完成設定」。SAML／CAS 未接入。 |
| Email / Argon2id / Magic Link / Reset | live 路徑 | 寄信未設時仍可密碼進出；驗證信 Partial。 |
| Identity linking | live 契約 | 禁止 Email 相同自動合併。 |
| Membership | live | owner／admin／member；憑證 POST 限 owner／admin。 |
| MCP 誠實狀態 | live 契約 | listTools=partial；安全讀取有內容=verified；無 token/endpoint=unconfigured；不可達=failed；探測中=verifying。 |
| Atlas 進 integrations | live | `getMcp("atlas")`。 |
| Artifacts | live 契約 | artifactId／revisionId／preview／restore／fork／compare UI。 |
| Memory scopes | live 契約 | conversation／user_preference／system／project／workspace；digest 標 scope。 |
| Runtime 一般／Developer | live | 四顆狀態 + Developer 工具清單 + Advanced 詳情。 |
| 長任務中斷 | live 契約 | 啟動時 chat／無 remoteId 改 uncertain；不假裝 still running。 |
| 設定分類 | live | 帳號／外觀／連線／工作區／進階。 |
| Liveness | live | `GET /api/live`。Readiness 仍是 `/api/ready`。 |
| 錯誤分類 | live | `ApiError.category`；空工具結果為 `empty_output`／`UPSTREAM_ERROR`。 |
| 研究筆記檢索 | live 契約 | `workspace_search_research` 讀快照；沒有命中不編造；不進主 UI。 |
| 空工具結果 | live 契約 | HTTP 200 且 payload 為 `{}`／空字串不算成功。 |
| 次要畫面載入 | live | 專案／靈感／Runtime／設定等 `next/dynamic`，對話路徑維持靜態。 |
| Production auth | live 契約 | 正式環境禁止 `CONSOLE_AUTH_MODE=workspace`。 |
| GALLEY 路由 | live 契約 | 僅 registry 為 partial／verified／connected 才走 `galley_research`；未設定不假裝。 |
| 工作階段清單 | live 契約 | 帳號頁列出到期時間，不含 session digest。 |

## 仍為 Partial（禁止打綠勾）

- 淡江正式 SSO（需校方 OIDC Client／Issuer；SAML／CAS 未接入）
- Google 實機 OAuth（需部署端 Client）
- Email 驗證／Magic Link 實寄（需 Resend）
- MCP `verified`（需遠端提供可安全讀取的工具或 resources）
- 長任務遠端 resume（有 remoteId 才向 Hermes 查回；不會自動重送）
- Zeabur 本輪實機部署（無授權）
- Instagram／Pinterest 完整官方搜尋（刻意不宣稱）
- Audience Twin 代表全體學生（刻意標模擬）
- Knowledge graph 給一般使用者（僅研究／進階）

## Legacy / dormant

- `InvitationGate`／`/api/auth` 邀請模組：不得擋 AuthGate
- `CONSOLE_USERNAME`／`CONSOLE_PASSWORD_HASH` scrypt `login()`：無產品入口
- 研究 Markdown（`data/ai-agent-research/`）：不進主 UI

## 危險（部署端）

- 曾暴露金鑰必須 rotate
- 公開站若閘道未設且誤用 `workspace` 模式，等同共用 owner
- 設定頁可改 vault／Zeabur：僅 owner／admin，且仍等同能改後端，需受控網路
