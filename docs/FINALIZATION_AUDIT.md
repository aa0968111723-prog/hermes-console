# Hermes Console 正式化盤點

盤點基準：`main` 最新（含研究報告 merge）與本 branch `cursor/hermes-production-finalization-0caa`。只描述倉庫與契約測試可觀察到的狀態，不是行銷承諾。評等：`usable`＝路徑完整且誠實；`partial`＝有實作但不完整；`dormant`＝程式在、產品未掛；`legacy`＝舊路徑。

近期 `main` 幾乎全是 `data/ai-agent-research/` 報告。本輪不回退那些研究檔，也不讓研究 UI 擠掉主產品。

本輪已改：AuthGate、手機 scroll ownership、Dock（對話／專案／靈感／Agent）、誠實 MCP probe（含 safe-read）、health live/ready/agentReady、Canva artifact V1/V2 還原／分叉、GALLEY 依 live MCP 可用性路由、視覺優先首頁與連線點、龜龜狀態光／姿勢、文件。

本輪驗證（此環境，非 Zeabur 實機）：`lint` `typecheck` `test` 384 pass / 2 skip。先前同環境 Playwright `test:ui` `test:chat` `test:workbench` `test:gateway` `test:entry` `test:runtime`、`build`、`check:secrets` 曾全過。Playwright Chrome LCP 112ms、CLS 0.00008。不是實體 Android Chrome，也不是正式域名部署。

尚未完成（必須標 Partial）：淡江 SSO 校方 Client、Google OAuth 部署密鑰、正式 Zeabur 實機部署、實體 Android Chrome 鍵盤。

## 總覽

| 區域 | 評等 | 說明 |
| --- | --- | --- |
| 入口 | `usable` | `/` → AuthGate → session + membership → Console。`AGENTS.md` 原免登入不變量已被使用者明確要求覆蓋。 |
| 手機捲動 | `usable`（契約）／`partial`（實機鍵盤） | Chat：conversation-scroll；其他頁：secondary-page。`--app-height` + `--app-top`。實體 Android Chrome 未測。 |
| 底部 Dock | `usable` | 對話／專案／靈感／Agent。設定走頂欄齒輪／頭像。 |
| Hermes 執行任務 | `usable` | 真實 Hermes runs/chat；失敗與中斷走 `uncertain`，不假裝完成。 |
| MCP Registry | `usable`（契約）／`partial`（部署） | 統一 registry；listTools → `partial`；safe-read 非空 → `verified`；缺 token → `unconfigured`；連不上 → `failed`。多數外部 MCP 尚未填 env。 |
| 規劃／路由 | `usable`（建議）／`partial`（執行） | Planner 讀 MCP snapshot，GALLEY／淡江不必使用者點選。步驟文字交給 Hermes，不是逐步本地執行引擎。 |
| 作品版本 | `usable`（Canva／workflow）／`partial`（跨工具 graph） | 同一 `artifactId` 上 V1/V2、還原、分叉；空 Canva 不當成作品。 |
| 記憶分層 | `partial` | project／workspace／personal + provenance。不是單一 dump。 |
| 部署 | `partial` | Docker + `/api/health` + `/api/ready` + PRODUCTION／SECURITY／ARCHITECTURE／RELEASE。未做 live Zeabur rehearsal。 |
| CI | `usable` | lint、typecheck、unit、build、secrets、audit、Playwright（含 `test:runtime`）。 |

## 完全可用（契約／本機）

- 未登入先見 AuthGate（龜龜 + Google／淡江／Email）。
- 對話、專案、靈感、Agent Runtime、任務列表。
- Composer：`＋` 圖片／文件／參考／Canva／素材；IME Enter；44px 目標。
- 龜龜狀態：idle／thinking／planning／searching／researching／creating／tool／waiting／success／error／offline。
- Origin 檢查、限流、確認 token、秘密遮罩、MCP／Hermes SSRF。
- Workspace MCP 工具在 Hermes + bridge 設定後可呼叫。
- SQLite／可選 Postgres `console_records`／`console_sessions`／`console_limits`。
- Email Argon2id、驗證、Magic Link、重設密碼。

## 部分可用

- Google OAuth：程式完整，部署缺 client／secret 時誠實顯示尚未完成設定。
- 淡江 SSO：`TamkangAuthProvider`；無校方 Client／Metadata 時顯示「淡江 SSO 尚未完成設定」。
- MCP：Tamkang／GALLEY／Lumen／FrameLab／對稿／Planform／訊核／Atlas 未設 env 即 unconfigured。
- Canva：可列設計；建立／匯出需另證。
- 編排器：意圖／工具建議／計畫可見，步驟不隨 Hermes 逐步推進。
- Audience Twin：模擬，不是民調。
- 跨工具 artifact graph 仍薄。

## UI 有、後端未完成

- Instagram／Pinterest：誠實聲明；沒有完整官方搜尋 API。
- Agent OS 多角色：UI 在；任務固定 `general`。

## 後端有、UI 入口弱

- `assistantMode` research／admin：API 為主。
- `/api/brain` 仍在；主 UI 不展示。
- 邀請管理 `MemberAccess` 未掛入（不擋工作區）。

## 只有研究內容

- `data/ai-agent-research/` 大量 Markdown。知識檢索目前是禪學社 archive／Inspiration，不是把每篇研究變成可查 Research Node。本輪不擴張研究系統。

## Dead code / Duplicate / Legacy

- `components/chat/Welcome.tsx` 未使用。
- `InvitationGate.tsx`／`MemberAccess.tsx` 休眠。
- `login()`／`CONSOLE_PASSWORD_HASH` 舊閘道路徑仍在測試中，不是帳號登入。
- `globals.css` 仍有多個 `@media (max-width: 760px)` 疊加。

## 危險

- 未設 `CONSOLE_GATEWAY_SECRET` 且未要求 gateway 時，仍需 session；正式環境應 `CONSOLE_REQUIRE_GATEWAY=true`。
- 設定頁可寫 Zeabur token：僅 admin。
- 曾暴露的金鑰必須視為已洩漏並輪替。
- Dockerfile 寫死 `CONSOLE_ADMIN_EMAILS=aa0968111723@gmail.com`（bootstrap，不是密碼）。

## 未部署 / 缺環境 / 缺測試

- 無 Google OIDC 部署密鑰。
- 無淡江 SSO Client／Metadata。
- 無實體 Android Chrome 鍵盤證據。
- 無 Zeabur 正式域名 live health。

## 本輪直接修的 P0／P1

1. 手機 scroll ownership 與 Dock。
2. 正式 AuthGate。
3. 誠實 MCP／Health／文件。
4. Planner 依 live MCP 選 GALLEY；短句校園研究不走 continue 快路徑。
5. 首頁六個短標籤；連線格子點＋ aria-label。
6. 龜龜狀態用光與姿勢區分，不是同一套 sway。
