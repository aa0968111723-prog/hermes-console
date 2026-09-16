# Hermes Console 正式產品化盤點

基準：`origin/main` `57b658b`（2026-09-16）。這不是新 App，也不是第二套 Dashboard。狀態以程式與測試為準，不以文件宣稱為準。

## 總覽

| 區域 | 判斷 | 說明 |
| --- | --- | --- |
| 免登入工作區入口 | 完全可用 | `/` 直接進 `HermesConsole`；工作區 API 以單一 `workspace` owner 驗證 Origin／限流／可選閘道 |
| 手機捲動 | **P0 部分可用／危險** | 文件捲動被 `.app-shell { overflow:hidden }` 關掉；內部 scrollport 被 absolute dock、padding 衝突、`<main>` transform 打斷 |
| 手機 Dock | 部分可用 | 已有底部 dock，但與 hamburger 雙軌；項目是對話／靈感／Hermes／專案／任務，不是產品指定的對話／專案／靈感／Agent |
| Android 鍵盤 | 部分可用 | 有 `visualViewport` 與 `data-composer-keyboard`；`scroll` 監聽會改 `--app-height`；鍵盤開啟後 composer 可能丢掉 safe-area |
| AuthGate / User / Identity | **未完成** | 使用者已明確要求正式登入。現況仍是免登入；邀請／magic link 休眠；無 Google／淡江 SSO |
| Runtime Inspector | 部分可用 | 已有 Normal／Advanced 拆分跡象；仍可能露出技術細節 |
| MCP Registry | 部分可用 | 已有真實狀態機；需持續禁止假成功 |
| Artifacts / 版本 | 部分可用 | 素材與任務有 ID；缺少穩定 `artifactId`／`revisionId` 與還原／fork |
| Memory 分層 | 部分可用 | 有 shared memory 與 provenance 模組；尚未清楚分成 conversation／project／workspace／preference |
| 研究 Markdown | 研究內容 | `data/ai-agent-research/` 大量報告；未變成可檢索 Research Node |
| CI | 部分可用 | lint／typecheck／unit／Playwright／build／secrets；缺獨立 auth／mobile screenshot 套件名稱 |
| 部署文件 | 部分可用 | 有 `docs/DEPLOYMENT.md`；缺 `PRODUCTION.md`／`SECURITY.md`／`ARCHITECTURE.md`／`RELEASE_CHECKLIST.md` 的正式版 |

## 完全可用

- 單一工作區 UI：`app/page.tsx` → `HermesConsole`
- Origin 驗證、rate limit、確認 token、工具權限分級（read 自動／destructive 需確認）
- SQLite／Postgres 雙後端（`console_records`／`console_sessions`／`console_limits`）
- `/api/ready` 探測 store，不回秘密
- SSRF 守衛：禁止私網／metadata／GitHub 當 MCP
- Canva Connect OAuth（整合，不是 Console 登入）
- 多個 MCP 探測：Tamkang／GALLEY／訊核／Atlas／Lumen／FrameLab／對稿／Planform
- 契約測試與 Playwright UI（模擬裝置，非正式真機）
- 龜龜狀態視覺、快捷動作、composer 附件縮圖、離線橫幅

## 部分可用

- 手機空間 UI（`app/mobile-spatial.css`）：視覺層在，捲動所有權不穩
- Runtime 同步與 inspector
- Inspiration 引擎：有 clustering／providers，UI 仍偏清單
- Audience simulation：有 persona，需標明「模擬」
- 長任務 resume／cancel：有狀態機，重啟後「仍在跑」的誠實度需再驗
- 設定頁：連線／外觀／記憶已有，尚未收成帳號／外觀／連線／工作區／進階
- Health：有 Hermes 探測，但與 liveness／readiness 語意未完全分開

## UI 有、後端未完成或未接通

- `InvitationGate`／`MemberAccess`：元件存在，首頁不引用
- 帳號連結設定（Google／淡江／Email 勾勾）
- Artifact Stage 大預覽與版本比較／還原（有預覽，缺完整 revision 模型）

## 後端有、UI 入口弱

- `login()`／`verifyPassword()`／`hermes_session`：無路由使用
- 邀請 magic link API：`/api/auth` 與 `/api/invitations`
- Knowledge／workflows／certification／recruitment 等 API：主路徑不應變成研究控制台

## 只有研究內容

- `data/ai-agent-research/*.md`（包含最新 MoE／kernel 報告）
- 不應再擴張研究 UI；優先讓 Hermes 可檢索既有節點

## Dead / Duplicate / Legacy

- 休眠邀請模組與預設管理員信箱硬編碼（`DEFAULT_ADMIN_EMAILS`）
- `CONSOLE_USERNAME`／`CONSOLE_PASSWORD_HASH` 未出現在 `.env.example`
- 雙 cookie：`hermes_session`（死）與 `hermes_invite_session`（休眠）
- CSS：三套手機 `padding-bottom`（65px／58px+safe／90px+safe）與 dock `fixed` vs `absolute`

## 危險

- 公開部署若無 `CONSOLE_GATEWAY_SECRET`，能開網站的人可改連線憑證與 Zeabur token（文件已標明）
- 設定頁曾可用 Tamkang MCP 密碼交換權杖：這不是學校 SSO，不可宣稱 SSO 完成
- 任何曾出現在 chat／issue／commit 的金鑰視為已洩漏，必須輪替

## 未部署／缺環境

正式產品化需要（實際值只存在部署端，不寫入 Git）：

- `CONSOLE_ORIGIN`、`CONSOLE_GATEWAY_SECRET` 或等效網路閘道
- `HERMES_API_URL`／`HERMES_API_KEY`（新密鑰）
- `DATABASE_URL` 或持久卷 `CONSOLE_DATA_DIR`
- `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`（Google 登入）
- `RESEND_API_KEY`／`CONSOLE_EMAIL_FROM`（Email 驗證／magic link／重設）
- 淡江 SSO：`TAMKANG_SSO_ISSUER` 與 client metadata；沒有就不能顯示成功
- 各 MCP URL／TOKEN；未設必須是 `unconfigured`

## 缺測試

- Google／淡江未設定／Email／magic link／重設／session／logout／account linking／未授權工作區
- 手機真正觸控捲動（現有測試多半 `scrollTo` 或量幾何，未證明 finger pan）
- Artifact 版本還原、MCP 假成功回歸、生產 rehearsal（fresh clone）

## 本次優先修復（依規定順序）

1. 手機捲動所有權（本輪 P0）
2. 正式 Auth（Google／淡江抽象／Email），禁止假裝 SSO 成功
3. Runtime／MCP 誠實狀態
4. 資料／記憶／artifact 連續性
5. Visual-first 收斂、測試、文件、PR
