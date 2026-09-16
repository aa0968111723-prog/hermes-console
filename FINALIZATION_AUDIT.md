# Hermes Console 正式化盤點

基準：`origin/main` @ `57b658b`，本分支 `cursor/hermes-production-finalization-a689`。不是新 App、不是新 Dashboard。

評等：`可用`＝主路徑已接通且不假裝成功；`部分`＝有實作但缺真實憑證或校方 IdP；`研究`＝Markdown，未進主 UI。

## 已收斂（本輪）

| 項目 | 狀態 | 依據 |
| --- | --- | --- |
| 手機捲動所有權 | 可用（契約） | Chat 只捲 conversation；其他頁 `data-scroll-mode=page`。`--app-height` 只在鍵盤開啟時寫入。Android 實機仍 Partial。 |
| Bottom dock | 可用 | 對話 / 專案 / 靈感 / Agent；設定在齒輪。 |
| AuthGate | 可用 | `/` 先登入。Google 未設定顯示尚未完成設定。淡江未設定顯示「淡江 SSO 尚未完成設定」。Email Argon2id + magic link。 |
| 身份模型 | 可用 | User / Identity / Session / Membership。禁止 email 自動合併。 |
| API 授權 | 可用 | `authenticate()` 要 session + membership。Health/ready 仍公開且不含秘密。 |
| MCP 狀態 | 可用（契約） | `tools/list` → partial；缺 token → unconfigured；連不上 → failed；available 只在 safe-read。 |
| 設定分頁 | 可用 | 帳號 / 外觀 / 連線 / 工作區 / 進階。 |
| Artifact 連續 | 部分 | `/api/artifacts` restore/fork 文案版本；Canva 設計預覽仍走既有 CanvaResult。 |
| Memory layers | 部分 | `layer` + research digest；主 UI 不展開知識圖譜。 |
| 文件 | 可用 | README、PRODUCTION、SECURITY、ARCHITECTURE、RELEASE_CHECKLIST。 |

## 仍是 Partial（禁止標綠）

- 淡江 SSO：沒有校方 Client / Metadata，不能假裝成功。
- Google Login：程式有，部署未填 `GOOGLE_CLIENT_ID` 前不可用。
- 實機 Android Chrome 鍵盤 / 412×915 / 430×932：Playwright 契約有 360/390/768/1024/1440，不是實機。
- Hermes 對真實 MCP 工具鏈：需部署憑證；契約用 fixture。
- Instagram / Pinterest 全庫搜尋：沒有官方完整 API，不得宣稱。
- Tamkang 校園密碼交換 MCP token：仍是 MCP，不是 SSO。
- 正式 Zeabur 部署與 DB backup：本環境未授權部署。

## 危險項（已處理方向）

- 未登入可改連線憑證：改為需 session。公開設定頁警告改寫。
- MCP `verified` 只因 listTools：改為 partial；舊 verified 列降為 partial。
- 測試 session 不得覆蓋偽造 cookie：無效 cookie 不再落入 `CONSOLE_TEST_SESSION`。
