# Hermes Console 正式化盤點

盤點基準：`main` `57b658b`（2026-09-16）。只描述倉庫與契約測試可觀察到的狀態，不是行銷承諾。評等：`usable`＝路徑完整且誠實；`partial`＝有實作但不完整；`dormant`＝程式在、產品未掛；`missing`＝目標需要但沒有；`legacy`＝舊路徑／死碼；`risk`＝安全或資料風險。

近期 `main` 幾乎全是 `data/ai-agent-research/` 報告。本輪不回退那些研究檔，也不讓研究 UI 擠掉主產品。

本輪已改：AuthGate、手機 scroll ownership、Dock（對話／專案／靈感／Agent）、誠實 MCP probe、health live/ready/agentReady、Canva artifact V1/V2 還原／分叉、文件。

本輪驗證（2026-09-16，此環境，非 Zeabur 實機）：`lint` `typecheck` `test` 382 pass / 2 skip、`build`、`check:secrets`、Playwright `test:ui` `test:chat` `test:workbench` `test:gateway` `test:entry` `test:runtime` 全過。Playwright Chrome LCP 112ms、CLS 0.00008。Axe 抽查頁面 0 violations。不是實體 Android Chrome，也不是正式域名部署。

尚未完成（必須標 Partial）：淡江 SSO 校方 Client、Google OAuth 部署密鑰、正式 Zeabur 實機部署、實體 Android Chrome 鍵盤。

## 總覽

| 區域 | 評等 | 說明 |
| --- | --- | --- |
| 免登入單一工作區 | `legacy` → 本輪改為正式 Auth | `AGENTS.md` 原不變量：`/` 直接進 Console。使用者已明確要求 AuthGate。 |
| 手機捲動 | `partial` / P0 | `.app-shell` 鎖高並 `overflow: hidden`；靈感頁沒有 scroll owner。 |
| 底部 Dock | `usable`（資訊架構不符） | 有 dock，但是「對話／靈感／Hermes／專案／任務」，不是指定的對話／專案／靈感／Agent。 |
| Hermes 執行任務 | `usable` | 真實 Hermes runs/chat；失敗與中斷走 `uncertain`，不假裝完成。 |
| MCP Registry | `partial` | 有統一 registry 與 probe；`listTools` 停在 `partial`，safe-read 未接到 probe。 |
| 規劃／路由 | `partial` | Console 產生計畫文字給 Hermes；不是逐步執行引擎。 |
| 作品版本 | `usable`（Canva／workflow）／`partial`（跨工具 graph） | 同一 `artifactId` 上保存 V1/V2、還原、分叉；空 Canva 成功不當成作品。通用跨工具 graph 仍薄。 |
| 記憶分層 | `partial` | 有 project／workspace／personal scope 與 provenance 欄位。 |
| 部署 | `partial` | Docker + `/api/health` + `/api/ready`；缺 PRODUCTION／SECURITY／ARCHITECTURE／RELEASE 專文。 |
| CI | `usable` | lint、typecheck、unit、build、secrets、audit、多套 Playwright；`test:runtime` 未進 CI。 |

## 完全可用

- 開啟 `/` 進 `HermesConsole`（本輪改為先登入）。
- 對話、專案、靈感、Agent Runtime、任務列表。
- Composer：`＋` 圖片／文件／參考／Canva／素材；IME Enter；44px 目標。
- 龜龜狀態（idle／thinking／searching／researching／designing／tool／waiting／success／error）。
- Origin 檢查、限流、確認 token、秘密遮罩、MCP／Hermes SSRF。
- Workspace MCP 工具（活動、文案、記憶、素材、客群）在 Hermes + bridge 設定後可呼叫。
- SQLite／可選 Postgres `console_records`／`console_sessions`／`console_limits`。
- 契約測試 `tests/*.test.ts` 與 Playwright UI／chat／workbench／gateway／entry。

## 部分可用

- 手機：chat／projects／tasks／agents 有 `.secondary-page` 或 `.conversation-scroll`；靈感頁沒有。
- Android 鍵盤：只寫 `--app-height`，沒寫 `visualViewport.offsetTop`。
- Dock `position: fixed` 被 `mobile-spatial.css` 的 `absolute` 覆蓋；三套 `padding-bottom` 衝突。
- MCP：Tamkang／GALLEY／Lumen／FrameLab／對稿／Planform／訊核／Atlas 多為 env 或 listTools → `partial`。
- Canva：可列設計；建立／匯出需另證。
- Atlas：設定與 probe，無 workspace 代理工具。
- 編排器：意圖／工具建議／計畫可見，步驟不隨 Hermes 推進。
- 邀請 Magic Link：模組完整，未掛首頁。
- 密碼 `login()`：scrypt，無路由。

## UI 有、後端未完成

- Instagram／Pinterest：設定列與誠實聲明；沒有完整官方搜尋 API。
- Agent OS 多角色：UI 在；任務固定 `general`。
- Runtime「可用」：發現 ≠ 執行已驗證。

## 後端有、UI 入口弱

- `assistantMode` research／admin：API only。
- `projects/router.ts` 工具目錄未接 `prepareOrchestration`。
- `/api/brain` 仍在；UI `brain={[]}`。
- 邀請管理 `MemberAccess` 未掛入。

## 只有研究內容

- `data/ai-agent-research/` 大量 Markdown。知識檢索目前是禪學社 archive／Inspiration，不是把每篇研究變成可查 Research Node。

## Dead code / Duplicate / Legacy

- `components/chat/Welcome.tsx` 未使用。
- `InvitationGate.tsx`／`MemberAccess.tsx` 休眠。
- `login()`／`CONSOLE_PASSWORD_HASH` 死路徑。
- `globals.css` 多個 `@media (max-width: 760px)` 互相覆蓋。
- Turtle CSS 有 `processing`／`completed`，程式 id 不同。

## 危險

- 未設 `CONSOLE_GATEWAY_SECRET` 時工作區 API 公開（本輪改為需 session）。
- 設定頁可寫 Zeabur token（誰進工作區誰就能改部署）— 需 membership 後仍只限 admin。
- 曾暴露的金鑰必須視為已洩漏並輪替；本輪不把秘密寫進 Git。
- Dockerfile 寫死 `CONSOLE_ADMIN_EMAILS=aa0968111723@gmail.com`（bootstrap，不是密碼）。

## 未部署 / 缺環境 / 缺測試

- 無 Google OIDC 環境變數。
- 無淡江 SSO Client／Metadata。
- 無 Argon2id 使用者密碼。
- Playwright 未涵蓋登入、帳號連結、靈感頁捲動、`visualViewport.offsetTop`。
- 無實體 Android Chrome 鍵盤證據。

## 本輪直接修的 P0（分析後立刻做）

1. 手機 scroll ownership：shell 對齊 visualViewport；靈感頁成為 scroll owner；dock 單一模型；保留 safe-area。
2. 正式 AuthGate：Google／淡江／Email 同一 User；淡江未設定時顯示「淡江 SSO 尚未完成設定」；API 驗證 session + membership。
3. 手機 Dock：對話／專案／靈感／Agent；設定走頂欄齒輪。
4. 誠實 MCP／Health／文件；禁止假成功。
