# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-10）Grok 02 · Loop 2 現場觀察

- 基準 SHA：`ac5a7a4140911e2496962c78ff583619ad5470dd`（origin/main）
- 分支：`grok/ig-visual-language-2026-09-09` PR #78
- 目標：社博當日把「計劃 vs 現場」寫進靈感板；9/8「明天開始」標過期；限動維持 UNKNOWN。
- 不重做：PR #80 通用 9:16 像素規格。不碰 HermesConsole。不發 IG。

### 讀到的現況

- 今日 2026-09-10 社博。Drive 限動仍「新增」。Feed 最新仍是 9/8 預告。限動看不到。
- Visual Agent PR #80 已有 ig_story 1080×1920 安全區。本線只補品牌現場狀態。

### 本輪變更

- `liveWatch()`：Feed EVIDENCE、限動 UNKNOWN、過期「明天」鉤子。
- 靈感板「現場觀察」卡。

### 下一輪

- 若限動仍 UNKNOWN：產出當日 9:16 文案分層（不重做像素契約）。
- Rebase #78 到 latest main；看 CI。
- 不要合併 #10。

---

## 進行中（2026-09-09）Grok 02 · Instagram Inspiration

- 基準 SHA：`5e245e79668390deef4ccfb012cee889588cb719`
- 分支：`grok/ig-visual-language-2026-09-09`
- 目標：把 tku_zc 從 URL 收藏牆變成 Design / Layout / Hook / CTA / Audience 模式，並交給 Visual / Copywriting Agent。
- 使用者影響：靈感板先看視覺語言、不要用的模式、代理交接；未連接 Instagram。
- 本輪不碰：`HermesConsole.tsx`、PR #10 / #30 / #76、部署、發佈 IG。

### 讀到的現況

- main tip：`5e245e7`。靈感引擎只能 URL ingest＋caption_rules，沒有讀圖。
- Drive FACT：1151滾動式調整網宣、期初宣傳區、期初演講企畫書。
- IG EVIDENCE：已讀 5 張封面（社博手搖飲、淡水生存指南、FAQ、Reels 3D 少女、3/18 社課海報）。限動／完整格狀 UNKNOWN。

### 本輪變更

- `lib/server/inspiration/visual-language.ts`：模式目錄＋caption 對應＋代理交接。
- 靈感板卡片化；GET `/api/inspiration` 回 `visualLanguage`。
- 不宣稱 Instagram Connected。

### 驗證

- 標籤：`LOCAL_CONTRACT`。`tests/visual-language.test.ts` 通過。
- 非 `LIVE_EXTERNAL`。未宣稱 Meta API。

### 下一輪建議

- 9:16 社博限動實景模板（文館左側仍需現場照片）。
- 把 115-1 網宣日曆對到模式槽。
- 不要重做 Inspiration Engine，不要合併 #10。

### 阻塞

- 無 Instagram 使用者授權 → 不得全站搜尋或讀限動。
- 茶會／演講地點 Drive 仍為待定 → 對外必須標 UNKNOWN。

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
