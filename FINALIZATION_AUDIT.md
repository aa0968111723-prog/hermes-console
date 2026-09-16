# Hermes Console 收尾盤點

盤點基準：`main` `57b658b` + 本 finalization 分支。評等只描述程式現況，不是行銷承諾。

評等：`live`＝已接真實路徑；`partial`＝有實作但不完整或未驗證；`legacy`＝休眠；`danger`＝仍需部署端處理。

## 本輪已收斂

| 能力 | 狀態 | 依據 |
| --- | --- | --- |
| 手機捲動擁有權 | live（契約／瀏覽器） | Chat：`conversation-scroll`；其他頁：`.secondary-page`／`.page-scroll`。靈感頁不再被 100dvh+overflow:hidden 裁切。 |
| Android 鍵盤 | live（模擬 visualViewport） | 開啟才寫 `--app-height`；關閉移除，避免殼層永久縮短。`offsetTop` 納入判斷。 |
| Bottom dock | live | 對話／專案／Hermes／靈感／Agent；設定在頭像／齒輪。 |
| AuthGate | live（正式必填） | `/` → Login → Hermes。`CONSOLE_AUTH_MODE=workspace` 僅契約／本機。 |
| Google OIDC + PKCE | live 路徑／未填 Client 則停用 | Secret 只在 server。 |
| 淡江 SSO | **partial** | `TamkangAuthProvider`；無校方 metadata。畫面「淡江 SSO 尚未完成設定」。 |
| Email / Argon2id / Magic Link / Reset | live 路徑 | 寄信未設時仍可密碼進出；驗證信 Partial。 |
| Identity linking | live 契約 | 禁止 Email 相同自動合併。 |
| Membership | live | owner／admin／member；憑證 POST 限 owner／admin。 |
| MCP 誠實狀態 | live 契約 | listTools=partial；無 token/endpoint=unconfigured；不可達=failed；探測中=verifying。Hermes 不因一次任務變 available。 |
| Atlas 進 integrations | live | `getMcp("atlas")`。 |
| Artifacts | live 契約 | artifactId／revisionId／restore／fork。 |
| Memory scopes | live 契約 | conversation／user_preference／system／project／workspace；digest 標 scope。 |
| Runtime 一般／Developer | live | 四顆狀態 + Developer 工具清單 + Advanced 詳情。 |
| 設定分類 | live | 帳號／外觀／連線／工作區／進階。 |
| Liveness | live | `GET /api/live`。Readiness 仍是 `/api/ready`。 |
| 錯誤分類 | live | `ApiError.category`。 |
| CI | live | lint／typecheck／test／build／Playwright（含 runtime）。 |

## 仍為 Partial（禁止打綠勾）

- 淡江正式 SSO（無校方 Client／Metadata）
- Google 實機 OAuth（需部署端 Client）
- Email 驗證／Magic Link 實寄（需 Resend）
- MCP `verified`（探測不做安全讀取）
- 長任務真正 resume（中斷仍標 uncertain）
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
