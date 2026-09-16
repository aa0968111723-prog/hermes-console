# Hermes Console 正式化盤點

基準：`origin/main` @ `3224208`，本分支 `cursor/hermes-production-finalization-a689`。不是新 App、不是新 Dashboard。

評等：`可用`＝主路徑已接通且不假裝成功；`部分`＝有實作但缺真實憑證或校方 IdP；`研究`＝Markdown，未進主 UI。

## 已收斂（本輪）

| 項目 | 狀態 | 依據 |
| --- | --- | --- |
| 手機捲動所有權 | 可用（契約） | Chat 只捲 conversation；其他頁 `data-scroll-mode=page`。`--app-height` 只在鍵盤開啟時寫入。Android 實機仍 Partial。 |
| Bottom dock | 可用 | 對話 / 專案 / 靈感 / Agent；設定在齒輪。 |
| 手機頂欄 | 可用（契約） | Hermes 操作葉片不再蓋住標題殘字。Playwright 斷言 trigger 在選單右側。 |
| AuthGate | 可用 | `/` 先登入。Google／淡江未設定顯示尚未完成設定。未設定寄件時不出現寄送表單，並顯示「尚未設定寄件，無法寄送登入或重設連結」。驗證按鈕為「完成驗證」。Magic／重設／驗證有 Playwright。 |
| 身份模型 | 可用 | User / Identity / Session / Membership。禁止 email 自動合併。 |
| API 授權 | 可用 | `authenticate()` 要 session + membership。Health/ready 仍公開且不含秘密。 |
| MCP 狀態 | 可用（契約） | `tools/list` → partial；缺 token → unconfigured；連不上 → failed；available 只在 safe-read。 |
| 設定分頁 | 可用 | 帳號 / 外觀 / 連線 / 工作區 / 進階。 |
| Agent 自然語言路由 | 可用（契約） | 「禪學社網宣靈感／這張哪裡可以改／做一張茶會宣傳」會進研究／看圖／Canva 規格計畫。未驗證看圖時不假裝已讀像素。查公告仍走 lookup。 |
| 對話進度與作品預覽 | 可用（契約） | 計畫步驟收成 理解／研究／看圖／靈感／客群／創作／完成。工具 JSON 只在「原始結果」。創作回覆帶 ArtifactStage 大圖，不是工具計數。 |
| 作品版本 | 可用（契約） | 文案 V1／V2 比較、還原確認、匯出、修改同一作品。不自動重建無關輸出。 |
| 視覺附件 | 可用（契約） | 列表與 chips 用 WebP 縮圖。PDF／連結顯示種類或 hostname。不抓取任意網頁當預覽。 |
| Runtime Normal／Developer | 可用（契約） | Agent 頁只顯示 Hermes／記憶／工具／MCP 狀態與軌道。工具清單、schema、MCP 連線在 Developer。 |
| 空工具結果 | 可用（契約） | `{}`／空字串／空 content 不得標 completed；taxonomy `empty_tool_result` → TOOL_UNAVAILABLE。 |
| 首頁 | 可用（契約） | 龜龜 + 今天想做什麼？ + 六個短標籤。手機與桌面同一組。無 MCP 軌道、無英文 welcome overlay。 |
| Drive 知識 | 可用（契約） | 靈感頁預設折疊「社團知識」；不顯示 `live=`。 |
| Memory layers | 部分 | `layer` + research digest；主 UI 不展開知識圖譜。 |
| 學生接續同一作品 | 可用（契約） | Composer 只放人話。copyId／workflowId／activityId 只走 `task.focus`。Canva 接續使用專案最新 workflow。 |
| 回到最新訊息 | 可用（契約） | 右側 44px 圓鈕，不再蓋住作品標題中央。 |
| 對話內長標題 | 可用（契約） | `.canva-result h3` wrap，並在手機預留右側 52px 給 jump 圓鈕。 |
| 帳號工作階段 | 可用（契約） | 列出目前／其他裝置。結束其他登入需確認。目前這次只能登出。`test:ui` 帳號頁斷言「目前這台」、Google／淡江尚未完成設定、登出，且不洩漏 session hash。 |
| 連線格 | 可用（契約） | 名稱 + 狀態點。狀態文字只在 aria-label。點卡片才開設定。工具名與 MCP 密碼交換收進「進階說明」。 |
| 文件 | 可用 | README、PRODUCTION、SECURITY、ARCHITECTURE、RELEASE_CHECKLIST。 |

## 本輪驗證（2026-09-16）

- 本輪指令：`lint`、`typecheck`、`npm test`、`build`、`test:entry` 通過。`test:ui` 未在本輪重跑（先前同分支已通過）。
- `npm test`：394 tests, 392 pass, 2 skipped, 0 fail。
- `/` First Load JS 239 kB（shared 103 kB）。
- `test:entry`：未設定 Google／淡江／寄件；無效 magic token 顯示「連結已使用、已過期或不存在」且留在登入頁；第一位擁有者註冊；magic redeem；密碼重設；第二位成員 email 驗證進工作區。
- 本輪未重跑：`test:ui`、`test:chat`、`test:workbench`、`test:gateway`、`test:runtime`、`check:secrets`。

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
