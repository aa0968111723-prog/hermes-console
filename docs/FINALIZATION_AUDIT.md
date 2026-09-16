# Hermes Console 正式化盤點

盤點基準：`main` 最新（含研究報告 merge）與本 branch `cursor/hermes-production-finalization-0caa`。只描述倉庫與契約測試可觀察到的狀態，不是行銷承諾。評等：`usable`＝路徑完整且誠實；`partial`＝有實作但不完整；`dormant`＝程式在、產品未掛；`legacy`＝舊路徑。

近期 `main` 幾乎全是 `data/ai-agent-research/` 報告。本輪不回退那些研究檔，也不讓研究 UI 擠掉主產品。

本輪已改：AuthGate、手機 scroll ownership、Dock（對話／專案／靈感／Agent）、誠實 MCP probe（含 safe-read）、health live/ready/agentReady、Canva artifact V1/V2 還原／分叉／比較、GALLEY 依 live MCP 可用性路由、倉庫研究筆記檢索（confidence 0.4）、Runtime 工具清單收入 Advanced、視覺優先首頁與連線點、龜龜狀態光／姿勢、看圖分析不假裝、重啟後不假裝任務仍在跑、文件。

本輪驗證（此環境，非 Zeabur 實機）：`npm test` 412 pass / 2 skip；`lint`／`typecheck`／`build`／`check:secrets`／`rehearse`／`test:entry`／`test:ui`／`test:chat`／`test:workbench`／`test:runtime`／`test:gateway` 全過。

尚未完成（必須標 Partial）：淡江 SSO 校方 Client、Google OAuth 部署密鑰、正式 Zeabur 實機部署、實體 Android Chrome 鍵盤、HERMES_IMAGE_INPUT 未驗證時的真實看圖、PDF 頁面封面抽取。

## 總覽

| 區域 | 評等 | 說明 |
| --- | --- | --- |
| 入口 | `usable` | `/` → AuthGate → session + membership → Console。`AGENTS.md` 原免登入不變量已被使用者明確要求覆蓋。 |
| 手機捲動 | `usable`（契約）／`partial`（實機鍵盤） | Chat：conversation-scroll；其他頁：secondary-page。`--app-height` + `--app-top`。實體 Android Chrome 未測。 |
| 底部 Dock | `usable` | 對話／專案／靈感／Agent。設定走頂欄齒輪／頭像。 |
| Hermes 執行任務 | `usable` | 真實 Hermes runs/chat；失敗與中斷走 `uncertain`。重啟後查不到遠端不得維持 `running`。停止會打後端，chat 通道無法證明遠端已停。 |
| MCP Registry | `usable`（契約）／`partial`（部署） | 統一 registry；listTools → `partial`；safe-read 非空 → `verified`；缺 token → `unconfigured`；連不上 → `failed`。多數外部 MCP 尚未填 env。 |
| 規劃／路由 | `usable`（建議）／`partial`（執行） | Planner 讀 MCP snapshot，GALLEY／淡江不必使用者點選。看圖分析走 `workspace_read_material` 或誠實 `ask_user`，不開 Canva／Lumen。步驟文字交給 Hermes，不是逐步本地執行引擎。 |
| 看圖／多模態 | `usable`（契約）／`partial`（部署） | 「這張哪裡可以改？」不再走 continue。`HERMES_IMAGE_INPUT` 未驗證不得假裝已看圖。PDF 只顯示種類圖示，沒有頁面 raster。 |
| 作品版本 | `usable`（Canva／workflow）／`partial`（跨工具 graph） | 同一 `artifactId` 上 V1/V2、還原、分叉；空 Canva 不當成作品。 |
| 記憶分層 | `partial` | project／workspace／personal + provenance。不是單一 dump。 |
| 部署 | `partial` | Docker + `/api/health` + `/api/ready` + `npm run rehearse`（本機 loopback）+ PRODUCTION／SECURITY／ARCHITECTURE／RELEASE。未做 live Zeabur rehearsal。 |
| CI | `usable` | lint、typecheck、unit、build、secrets、rehearse、audit、Playwright（含 `test:runtime`）。 |

## 完全可用（契約／本機）

- 未登入先見 AuthGate（龜龜 + Google／淡江／Email）。
- 對話、專案、靈感、Agent Runtime、任務列表。
- Composer：`＋` 圖片／文件／參考／Canva／素材；IME Enter；44px 目標。
- 龜龜狀態：idle／thinking／planning／searching／researching／creating／tool／waiting／success／error／offline。
- Origin 檢查、限流、確認 token、秘密遮罩、MCP／Hermes SSRF。
- Workspace MCP 工具在 Hermes + bridge 設定後可呼叫。
- SQLite／可選 Postgres `console_records`／`console_sessions`／`console_limits`。
- Email Argon2id、驗證、Magic Link、重設密碼。已登入的 Google／淡江帳號可用設定頁連結電子信箱；地址相同不會自動合併。

## 部分可用

- Google OAuth：程式完整，部署缺 client／secret 時誠實顯示尚未完成設定。
- 淡江 SSO：`TamkangAuthProvider`；無校方 Client／Metadata 時顯示「淡江 SSO 尚未完成設定」。
- MCP：Tamkang／GALLEY／Lumen／FrameLab／對稿／Planform／訊核／Atlas 未設 env 即 unconfigured。
- Canva：可列設計；建立／匯出需另證。
- 編排器：意圖／工具建議／計畫可見，步驟不隨 Hermes 逐步推進。
- Audience Twin：模擬，不是民調。
- 看圖：部署未設 `HERMES_IMAGE_INPUT=true` 時只會要求上傳／說明未驗證，不會假裝已分析像素。
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
7. 海報評論走看圖／視覺層級／修改建議，未驗證圖片輸入不假裝已看圖。
8. 重啟後無法確認的 runs 標 `uncertain`，不維持假 running。
9. 工作區輪詢：忙碌 3s、閒置 12s、背景分頁 30s；專案頁 12s。
10. `npm run rehearse` 驗證 production `next start`：`/`、`/api/health`、`/api/ready`、workspace 401、禁止秘密 JSON。
12. 登入頁未設定的 Google／淡江都顯示「尚未完成設定」，不假裝可登入。
14. Hermes 未設定時，禪學社問題改讀本地 Drive 索引；標明不是 live MCP／IG，不假裝 GALLEY。無關問題仍 503。同一任務只顯示一則助手回覆，不把已保存訊息再畫一次。
16. 自然問句「淡大禪學社茶會宣傳靈感」會命中 115-1 期初茶會索引（日期 2026-09-30，地點 UNKNOWN），不再顯示查無命中。
17. 靈感問句改走既有視覺概念卡：overlay 日期 2026-09-30、地點留空、`generatedImage: false`。不是 Markdown 牆，也不是已出圖或 Instagram。
18. 學生可在卡片上「選這個」。會寫入既有 workflow，狀態 `ready`，Canva 未授權時維持尚未出圖，不假裝草稿完成。選定後顯示由索引事實編成的貼文文案（日期 2026-09-30），不補造地點、不假裝已出圖。
19. Hermes 未連線時，「這張哪裡可以改？」回誠實未看圖，不 503、不假裝視覺層級。專案頁 `.secondary-page` 可捲到最底（390／412／430）。
20. 本地索引回覆不顯示「執行紀錄」。專案頁可上傳素材（不自動掛到下一則對話）、預覽、關閉後仍能繼續滑；Chromium `showModal()` 的 inline overflow 會清掉。補 768×1024。
21. 切回對話會清掉「素材已保存」提示；本地索引任務不顯示 Composer「完成」pill。Hermes 未連線時，附圖看圖走本地誠實回覆，不再被 `images_unverified` 409 擋成紅條。`verify-entry` 模擬 visualViewport 鍵盤與離線／重連；實體 Android 與 Zeabur 仍 Partial。
22. 手機頂欄可開新對話。「幫我做一張淡江新生茶會宣傳」走同一套視覺卡，不假裝 Canva。Agent 頁只顯示 Hermes／記憶／工具／MCP 點；工具清單在進階。
23. 未設定 Hermes／MCP 顯示「未設定」，不再把從未連線標成記憶過期或 MCP 未知。連線圖收到進階。
24. 研究／行政模式不再告訴模型這是免登入共用工作區。靈感頁 Drive 索引、招生漏斗與現場觀察收到進階。連線健康驗證也在進階。帳號工作階段不顯示 session id。
25. 首頁只留龜龜與「今天想做什麼？」；MCP 軌道不在空對話。圖片封面走 WebP 縮圖，預覽仍用原檔。PDF 沒有假裝頁面封面。
26. 連線設定與 `POST /api/settings/tamkang` 的 `login` 不再轉送校園帳密；一律 `tku_password_refused`。Agent 一般畫面只留四個狀態點，「重新同步」與 MCP 軌道在進階。龜龜面板不再放能力連線圖。
