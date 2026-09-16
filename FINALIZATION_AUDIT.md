# Hermes Console 正式化盤點

基準：`origin/main` @ `57b658b`，本分支 `cursor/hermes-production-finalization-a689`。不是新 App、不是新 Dashboard。

評等：`可用`＝主路徑已接通且不假裝成功；`部分`＝有實作但缺真實憑證或校方 IdP；`研究`＝Markdown，未進主 UI。

## 已收斂（本輪）

| 項目 | 狀態 | 依據 |
| --- | --- | --- |
| 手機捲動所有權 | 可用（契約） | Chat 只捲 conversation；其他頁 `data-scroll-mode=page`。`--app-height` 只在鍵盤開啟時寫入。Android 實機仍 Partial。 |
| Bottom dock | 可用 | 對話 / 專案 / 靈感 / Agent；設定在齒輪。 |
| 手機頂欄 | 可用（契約） | Hermes 操作葉片不再蓋住標題殘字。Playwright 斷言 trigger 在選單右側。 |
| AuthGate | 可用 | `/` 先登入。Google 未設定顯示尚未完成設定。淡江未設定顯示「淡江 SSO 尚未完成設定」。Email Argon2id + magic link。 |
| 身份模型 | 可用 | User / Identity / Session / Membership。禁止 email 自動合併。 |
| API 授權 | 可用 | `authenticate()` 要 session + membership。Health/ready 仍公開且不含秘密。 |
| MCP 狀態 | 可用（契約） | `tools/list` → partial；缺 token → unconfigured；連不上 → failed；available 只在 safe-read。 |
| 設定分頁 | 可用 | 帳號 / 外觀 / 連線 / 工作區 / 進階。 |
| Agent 自然語言路由 | 可用（契約） | 「禪學社網宣靈感／這張哪裡可以改／做一張茶會宣傳」會進研究／看圖／Canva 規格計畫。未驗證看圖時不假裝已讀像素。查公告仍走 lookup。 |
| 對話進度與作品預覽 | 可用（契約） | 計畫步驟收成 理解／研究／看圖／靈感／客群／創作／完成。工具 JSON 只在「原始結果」。創作回覆帶 ArtifactStage 大圖，不是工具計數。 |
| Runtime Normal／Developer | 可用（契約） | Agent 頁只顯示 Hermes／記憶／工具／MCP 狀態與軌道。工具清單、schema、MCP 連線在 Developer。 |
| 空工具結果 | 可用（契約） | `{}`／空字串／空 content 不得標 completed；taxonomy `empty_tool_result` → TOOL_UNAVAILABLE。 |
| Memory layers | 部分 | `layer` + research digest；主 UI 不展開知識圖譜。 |
| 文件 | 可用 | README、PRODUCTION、SECURITY、ARCHITECTURE、RELEASE_CHECKLIST。 |

## 本輪驗證（2026-09-16）

- `npm test`：387 tests, 385 pass, 2 skipped, 0 fail。
- `npm run lint` / `typecheck` / `build`：通過。`/` First Load JS 238 kB（shared 103 kB）。
- Playwright Chromium：`test:ui` 與 `test:runtime` 本輪重跑通過。Agent 預設頁沒有工具清單；Developer 展開後可搜尋 300 個 fixture 工具。axe 0 violations。LCP 104ms、CLS 0.00008。
- Playwright 尺寸：360×800、375×812、390×844、393×852、412×915、430×932、768×1024、1024、1440。WebKit 同六個手機尺寸。不是實機。
- axe wcag2a/aa + 2.1：0 violations（`output/playwright/browser-report.json`）。
- 本機 Chromium LCP 136ms、CLS 0.00008。不是 field 裝置實驗室。
- 登入 bootstrap：Node 註冊後用頁內 `fetch` 登入。`APIRequestContext` / CDP cookie 在 `127.0.0.1` 不會進 document jar。

## 仍是 Partial（禁止標綠）

- 淡江 SSO：沒有校方 Client / Metadata，不能假裝成功。
- Google Login：程式有，部署未填 `GOOGLE_CLIENT_ID` 前不可用。
- 實機 Android Chrome 鍵盤：Playwright 只模擬 visualViewport。
- Hermes 對真實 MCP 工具鏈：需部署憑證；契約用 fixture。
- Instagram / Pinterest 全庫搜尋：沒有官方完整 API，不得宣稱。
- Tamkang 校園密碼交換 MCP token：仍是 MCP，不是 SSO。
- 正式 Zeabur 部署與 DB backup：本環境未授權部署。
- 帳號連結 Google↔淡江↔Email 的實機 round-trip：缺真實 IdP。

## 危險項（已處理方向）

- 未登入可改連線憑證：改為需 session。公開設定頁警告改寫。
- MCP `verified` 只因 listTools：改為 partial；舊 verified 列降為 partial。
- 測試 session 不得覆蓋偽造 cookie：無效 cookie 不再落入 `CONSOLE_TEST_SESSION`。
