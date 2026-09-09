# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-09 23:40 TST）Grok 05 · Drive 真實 115-1 文案進 Twin

- 基準 SHA：`ac5a7a4` 之後的 audience 分支
- PR：https://github.com/aa0968111723-prog/hermes-console/pull/83
- 目標：用 Drive「期初宣傳區」真實文案跑第一眼模擬；地點待定標 UNKNOWN。
- 本輪不碰：PR #10、HermesConsole、正式部署。

### Drive FACT（非編造）

- 期初茶會主標：改變自己從靜定開始；2026/9/30 19:00–21:30；地點待定
- 社博攤位：9/10、11、14–17 文館左側；專注力遊戲＋手搖飲
- 來源：https://docs.google.com/document/d/1XjaU_aCX4cVX3bO9JhSRUt2MElK1Qmr4pLhn4CoRCQw

### 本輪變更

- 訊號補 文館／手搖飲；地點待定 → unknownPlace
- `tests/audience-1151-drive-copy.test.ts`

### 下一輪建議

- 讀入社單／報名表欄位（若可匯出文字）再模擬填表壓力
- 有海報圖才評 visualAttraction
- 社博文比靜定主標更能停下「沒興趣型」——可當改稿方向，不是民調

---

## 進行中（2026-09-09 23:20 TST）Grok 05 · Audience Twin 第一眼模擬

- 基準 SHA：`5e245e79668390deef4ccfb012cee889588cb719`
- 分支：`grok/audience-twin-first-reaction-2026-09-09`
- 目標：十個淡江新生人格模擬海報／IG／表單／活動／攤位／場佈／文案的第一眼；分數只做比較，不假裝民調。
- 使用者影響：Hermes 可呼叫 `workspace_simulate_audience`；對話工具結果可顯示第一眼卡片。
- 本輪不碰：PR #10 / #30、`HermesConsole.tsx`、正式部署、記憶 store、Drive 刪除。

### 讀到的現況

- main tip：`5e245e7`。Audience Twin 已有抽象五角色與共用 heuristic 分數，無法回答「這個學生為什麼停下來」。
- 共用 clone 同時被其他代理改寫，本輪改在獨立 worktree 實作。

### 本輪變更

- `lib/server/audience/personas.ts`：十人格 + 素材種類訊號 + 比較分數（12–78）。
- API `action=simulate`；`evaluate` 附 `twinPanel`。
- MCP `workspace_simulate_audience`（read-only）。
- `FirstReactionBoard` 手機橫滑卡片；`VisualMessage` 顯示真實工具結果。

### 驗證

- 標籤：`LOCAL_CONTRACT`。
- 非 `LIVE_EXTERNAL`。沒有真實新生樣本。

### 下一輪建議

- 用 Drive 已核對的真實活動文案跑一輪比較，標記 FACT vs SIMULATION。
- 有圖時才提高 visualAttraction；沒圖維持 UNKNOWN。
- 不要合併 #10。

### 阻塞

- 無 Hermes 實機金鑰 → 不得宣稱 LIVE 整合通過

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
