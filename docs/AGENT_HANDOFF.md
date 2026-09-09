# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-10 07:25 TST）Grok · REAL-TEST L3

- LIVE 344 曾 `/api/ready` timeout、`/api/workspace` 502，隨後 ready 恢復 200。#99 store 仍未部署，P1 OPEN。
- Funnel 報名表 `https://forms.gle/Xs4PXyWKQW5ob29z6` LIVE 200（forms `wired_ok` 對 public_url 成立）。
- 續 #100：live tools/list 的 `getBulletins`／`getToDo` 原本對不上 HINTS，researchBundle mapping 幾乎全 null。補 `/bulletin/` `/todo/`。
- Zeabur MCP list-projects 此輪 `ERROR_INVALID_TOKEN`，無法看部署；未部署、未改正式環境。

---

## 進行中（2026-09-10 07:10 TST）Grok · REAL-TEST L2 MCP honesty

- 基準 SHA：`049b360fc9ddd3642db5586d5a4bd668271ce9b3`（origin/main）
- 分支：`grok/fix-tku-mcp-honesty-2026-09-10`
- LIVE 344：`/api/ready` 200 postgres；POST `/api/conversations` 201 立刻 GET 200（P1 store 症狀目前未復現，#99 未合併仍 OPEN）；`/api/inspiration` 523 筆 0 個 null；漏斗 `wired_ok` 為 catalog 聲明（forms notes=`public_form_url_claims_only`）；手機 composer `data-composer-keyboard` CSS 已在正式包。
- 115-1 期初活動 chat：POST `/api/chat` 202 → task completed，回官方行事曆 + 知識庫摘錄；**未**走 TKU MCP tools/call。
- P1 LIVE：`GET /api/mcp-registry` Tamkang `partial` tools=`getToDo,getBulletins,getCourses`（initialize+tools/list 已成功），但 `/api/integrations` 與 researchBundle 仍 `awaiting_authorization`／「尚未完成 initialize／tools/list」。
- 修復：`liveTamkangStatus()` 讀 registry；integrations／researchBundle 共用。Regression：`tests/mcp-honesty-tools-list.test.ts`。
- 不碰：#10／#30／#4、正式部署、#99 store 分支。
- 下一輪：合併部署 #99 後再壓測 201/404；本 PR 部署後重測 integrations／chat bundle 應為 `partial`。

---

## 完成（2026-09-09 20:45 TST）Codex · 手機底部安全區

- 基準 SHA：`4003f482d6ee8961e635fba655d8196c97a39f24`
- 分支／草稿 PR：`codex/mobile-radial-safe-area`／#76
- 產出 SHA：`dab6ff5f4d982090ac285b5a7ecb5e65bb6aedd4`（程式；本紀錄另有文件提交）
- 完成：以共用 `--safe-area-bottom` 串起 Hermes 快捷選單、底部導覽與詳情面板；選單可用高度也扣除 bottom inset，避免 320×360、20px 大字時侵入 Home Indicator 保留區。
- 測試先行：CI `34351466064` 在新增的 34px inset 契約失敗，精確重現問題；修復後 CI `34352175824` 全通過。
- 驗證：259/262 測試通過、3 項條件跳過；lint、typecheck、build、密鑰掃描、audit、UI／聊天／工作台／Gateway 旅程通過；Chrome／WebKit 各 6 種手機尺寸通過；16 個 Axe 畫面零違規。人工檢視 320×360 最終 artifact，選單與導覽間隔清楚且 44px 關閉鍵可見。
- 標籤：`LOCAL_CONTRACT`；外部 Hermes／MCP、正式部署及 iOS／Android 實機安全區未驗證。
- 下一輪（Codex）：檢查 200% 縮放下其他底部 sheet 的關閉鍵、焦點回復與內容捲動。
- 適合 Grok 接手：整併 #73／#71／#70／#68 的 uncertain 重試實作，只保留最新可套用分支並補 live contract；避免修改 `app/mobile-spatial.css` 與 `tests/mobile-spatial.ts`。

---

## 進行中（2026-09-09 02:15 TST）Grok 團隊 · uncertain 重試分支 UI

- 基準 SHA：`f819b48fbb9a5d107fd96c640abc29e503021919`
- 分支：`grok/uncertain-retry-branch-v2-2026-09-09`
- 目標：uncertain 任務與 failed/cancelled 對齊，同時提供「確認並可重試」（同對話）與「建立重試分支」（保留原紀錄）。
- 使用者影響：串流中斷／閒置後可直接分支重試，不必只能在同對話 ack；不宣稱遠端已停止。
- 本輪不碰：PR #10 / #30、`data/tamkang/`、`feat/consistencylab*`、正式部署、記憶 store。

### 讀到的現況

- main tip：`f819b48`（含 #63 uncertain acknowledge、#58 memory provenance、#64 fork）。
- 記憶 provenance 已在 main；舊 draft #62／#60／#56／#55／#42 基準落後，應關閉。
- 開放：#30 ConsistencyLab、#21 長任務藍圖、#10（禁止合併）、#4 atelier。

### 本輪變更

- 本地已備妥 `components/HermesConsole.tsx` 完整 patch（`retryBranchFromTask` + 訊息列／composer／任務面板）。
- `tests/uncertain-retry-branch-ui.test.ts`：LOCAL_CONTRACT 靜態 UI 契約。
- **注意**：先前分支 `grok/uncertain-retry-branch-2026-09-09` 曾誤寫 PLACEHOLDER，**勿合併**。本 v2 分支從 clean main 重開。

### 驗證

- 標籤：`LOCAL_CONTRACT`。本 sandbox 未執行 `tsx --test`。依賴 GitHub Actions。
- 非 `LIVE_EXTERNAL`。

### 下一輪建議

- 確認 HermesConsole 完整檔已在 PR 內後再請 CI。
- 可補 Playwright：uncertain 下兩顆按鈕可見。
- 不要合併 #10。

### 阻塞

- 無 Hermes 實機金鑰 → 不得宣稱 LIVE 整合通過

---
