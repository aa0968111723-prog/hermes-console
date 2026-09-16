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
| 身份模型 | 可用 | User / Identity / Session / Membership。禁止 email 自動合併。連結電子信箱要驗證；未設定寄件時不出現連結表單。密碼登入看 email identity 驗證旗標，不是 Google 的 user.emailVerified。 |
| API 授權 | 可用 | `authenticate()` 要 session + membership。連線／MCP／Zeabur／Canva 授權／runtime bindings 變更走 `authenticateOperator()`（owner／admin）。成員 403 `permission_denied`。GET `/api/integrations` 與 `/api/agents` 成員為 `view: normal`，不含工具名與 `*_MCP_TOKEN`。`/api/runtime/tools|mcp|agents|bindings`、`/api/certification`、`/api/usage` 僅 owner／admin。Health/ready 仍公開且不含秘密。 |
| MCP 狀態 | 可用（契約） | `tools/list` → partial；缺 token → unconfigured；連不上 → failed；available 只在 safe-read。GET `/api/mcp-registry` 成員只得 status；endpoint／schema 僅 owner／admin。 |
| 設定分頁 | 可用 | 擁有者／管理者：帳號 / 外觀 / 連線 / 工作區 / 進階。成員看不到連線與進階；API 仍拒絕。 |
| Agent 自然語言路由 | 可用（契約） | 「禪學社網宣靈感／這張哪裡可以改／做一張茶會宣傳」會進研究／看圖／Canva 規格計畫。GALLEY／Lumen／FrameLab／Planform 只有 status 為 partial 或 available 才進計畫；未設定不假裝。未驗證看圖時不假裝已讀像素。查公告仍走 lookup。 |
| 對話進度與作品預覽 | 可用（契約） | 計畫步驟收成 理解／研究／看圖／靈感／客群／創作／完成。Composer 與折疊事件只顯示這些高階進度，不顯示 GALLEY／Canva。工具 JSON 與 toolName 只在展開的技術資訊。創作回覆帶 ArtifactStage 大圖。 |
| 龜龜狀態 | 可用（契約） | Idle／思考／規劃／搜尋／研究／創作／整理／等待／完成／錯誤／離線。姿勢、光、陰影分開；標籤不出現廠商名。reduced-motion 停止動畫。 |
| 作品版本 | 可用（契約） | 文案 V1／V2 比較、還原確認、匯出、修改同一作品。不自動重建無關輸出。任務上下文會帶入專案 copy artifact 與創作方向，讓「第二版字放大」沿用同一作品。 |
| 視覺附件 | 可用（契約） | 列表與 chips 用 WebP 縮圖。PDF／連結顯示種類或 hostname。不抓取任意網頁當預覽。 |
| Runtime Normal／Developer | 可用（契約） | Agent 頁只顯示 Hermes／記憶／工具／MCP 狀態與軌道。工具清單、schema、MCP 連線在 Developer。成員 API 不含 endpoint、credentialReference、tool schema、hermesKeySource。公開 `GET /api/health` 不含 models／skills／toolsets／configSource；`POST /api/health` 僅 owner／admin。 |
| 空工具結果 | 可用（契約） | `{}`／空字串／空 content 不得標 completed；taxonomy `empty_tool_result` → TOOL_UNAVAILABLE。 |
| 首頁 | 可用（契約） | 龜龜 + 今天想做什麼？ + 六個短標籤。手機與桌面同一組。無 MCP 軌道、無英文 welcome overlay。 |
| 專案頁 | 可用（契約） | 標題為「專案」。封面架 + 作品預覽 + 素材縮圖。空狀態不再把 Instagram 文案混進專案頁。 |
| Drive 知識 | 可用（契約） | 靈感頁預設折疊「社團知識」；不顯示 `live=`。 |
| Memory layers | 可用（契約） | conversation／project／workspace／preference／runtime 分層。Runtime 不進任務上下文；conversation 只進同一對話。過期（≥30 天）標 STALE／LOW_CONFIDENCE，不得當成最新事實。設定頁仍可看全部列。 |
| 學生接續同一作品 | 可用（契約） | Composer 只放人話。copyId／workflowId／activityId 只走 `task.focus`。Canva 接續使用專案最新 workflow。 |
| 回到最新訊息 | 可用（契約） | 右側 44px 圓鈕，不再蓋住作品標題中央。 |
| 對話內長標題 | 可用（契約） | `.canva-result h3` wrap，並在手機預留右側 52px 給 jump 圓鈕。 |
| 帳號工作階段 | 可用（契約） | 列出目前／其他裝置。結束其他登入需確認。目前這次只能登出。`test:ui` 帳號頁斷言「目前這台」、Google／淡江尚未完成設定、登出，且不洩漏 session hash。 |
| 連線格 | 可用（契約） | 名稱 + 狀態點。狀態文字只在 aria-label。點卡片才開設定。工具名與 MCP 密碼交換收進「進階說明」。 |
| 文件 | 可用 | README、PRODUCTION、SECURITY、ARCHITECTURE、RELEASE_CHECKLIST。 |
| 登入包體 | 可用（契約） | `/` First Load JS 109 kB。AuthGate 先出現；工作區、設定、靈感、活動工作台進場後再載。 |
| 正式啟動檢查 | 可用（契約） | 缺 `CONSOLE_ORIGIN`、公開 HTTP、非本機 `CONSOLE_ALLOW_LOCAL_ACCESS`、測試 session 會在 production startup 直接失敗。 |
| Health liveness | 可用（契約） | `GET /api/health` 不等 Hermes。`live` 在 store／Hermes 掛掉時仍為 true。憑證在但還沒探測是 verifying，不是 available。 |
| 備份／演練 | 可用（契約） | `npm run backup` 複製 sqlite／WAL／vault.key，不印秘密。`npm run rehearse` 只報告已設定／未設定。不是 Zeabur 實機快照。 |
| 對話／記憶讀取 | 可用（契約） | 沒有 Hermes session 的對話 GET、記憶 GET、Brain GET 不等 discovery。任務提交在 unconfigured／failed 快取上立即 503。 |
| 任務提交探測 | 可用（契約） | `ensureHermesReady` 只打 `/v1/models`，逾時用 `HERMES_CONNECT_TIMEOUT_MS`（契約 hanging 1s → ~1s failed）。不跑 skills／toolsets。學生 503 為「Hermes 還沒連上。請到設定的連線頁。」或「現在沒辦法連到 Hermes。」，不含環境變數字樣。 |
| 長任務重啟 | 可用（契約） | 程序啟動立即 `recoverOrphanedTasks`。沒有 in-memory worker 的 chat 任務改 `uncertain`，訊息含「不會自動重送」。已完成任務不動。 |
| 學生連線錯誤 | 可用（契約） | 公開 health、成員 health、`POST /api/tasks`、對話錯誤都不出現金鑰／後端／環境變數。401 金鑰 →「還沒連上」。Hanging POST `/api/tasks` ~1s 503。`hermes_unconfigured`→TOOL_UNAVAILABLE，`hermes_not_ready`→UPSTREAM_ERROR。Operator `POST /api/health` 仍保留探測原文。 |
| 連線狀態點 | 可用（契約） | 頂欄只顯示 44px 狀態點。文案在 `aria-label` 與 `.sr-only`。 |

## 本輪驗證（2026-09-16）

- 本輪指令：`lint`、`typecheck`、`npm test` 通過。UI 未改，未重跑 Playwright。
- `npm test`：417 tests, 415 pass, 2 skipped, 0 fail。含程序重啟後 orphaned chat 任務改 uncertain、不重送；計畫事件不含 `budgetMode=`／token 計數。
- 已 merge `origin/main` 研究筆記 `6591e40`，未回退產品路徑。

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
