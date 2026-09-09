# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 完成（2026-09-09 23:55 TST）Grok · uncertain 重試分支實作（相對 main 5e245e7）

- 基準 SHA：`5e245e79668390deef4ccfb012cee889588cb719`
- 分支：`grok/uncertain-retry-apply-5e245e7-2026-09-09`
- 目標：把 #65 只留下的 patch／skip 測試真正套進 `HermesConsole.tsx`，uncertain 與 failed/cancelled 對齊。
- 使用者影響：串流中斷後可「確認並可重試」（同對話）或「建立重試分支（保留原紀錄）」；找不到對應訊息時顯示錯誤，不宣稱遠端已停止。
- 本輪不碰：`app/mobile-spatial.css`、`tests/mobile-spatial.ts`、PR #76、#10 / #30、`data/tamkang/`、靈感板、Drive 知識、正式部署。

### 讀到的現況

- main tip：`5e245e7`。#65 已合併，但 `retryBranchFromTask` 不在 UI；契約測試會 skip。
- Codex #76 草稿處理手機安全區；Grok 02 靈感語言進行中，明確不碰 `HermesConsole.tsx`。
- 過時重試 PR：#73 / #71 / #70 / #68。過時記憶 PR：#62 / #60 / #56 / #55 / #42。應關閉，勿重做。

### 本輪變更

- `retryBranchFromTask` + 訊息列／composer／任務面板三處入口。
- composer 兩顆 44px 按鈕；`branch()` 可指定來源對話，避免跨對話誤用 `activeConv`。
- `tests/uncertain-retry-branch-ui.test.ts` 改為硬契約，缺實作即失敗。

### 驗證

- 標籤：`LOCAL_CONTRACT`。`node --import tsx --test tests/uncertain-retry-branch-ui.test.ts` 通過。
- 非 `LIVE_EXTERNAL`。未跑 Playwright；CI 瀏覽器旅程為準。
- 本機 `pg` 套件不完整，acknowledge／stream 測試無法在此環境當 LIVE 證據。

### 下一輪建議

- 關閉過時 #73/#71/#70/#68/#62/#60/#56/#55/#42。
- 接續禪學社 Drive 知識快照（`lib/server/zenclub` 未進 main）或 visual concepts MCP。
- 不要合併 #10。不要改 Codex 安全區 CSS。

### 阻塞

- 無 Hermes 實機金鑰 → 不得宣稱 LIVE 整合通過。

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

## 已由後續輪次完成（2026-09-09 02:15 TST）Grok 團隊 · uncertain 重試分支 UI（當時僅 patch）

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
