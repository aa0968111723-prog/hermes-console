# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-09 03:10 TST）Grok 團隊第六輪

- 基準 SHA：`2dbaac419aabf9716b209391737ce60ac1778b2d`
- 分支：`grok/uncertain-retry-branch-apply-2026-09-09`
- 目標：接續 PR #65，將 uncertain 任務「建立重試分支」實際套入 `HermesConsole.tsx`（不再只留 patch）。
- 使用者影響：uncertain 與 failed/cancelled 一樣可「建立重試分支（保留原紀錄）」；composer 同時保留「確認並可重試」；不宣稱遠端 Hermes 已停止。
- 本輪不碰：PR #10、`feat/consistencylab*`、`data/tamkang/`、正式部署、不覆蓋 codex/cursor 分支。

### 讀到的現況

- main tip：`2dbaac41`（hourly tamkang + research）。
- PR #65 draft：有 `docs/patches/uncertain-retry-branch.patch` 與 skip 版測試，但 TSX 尚未套用。
- 開放 PR：#65、#62／#60／#56 等 memory provenance、#30 ConsistencyLab、#10（禁止合併）。
- 無活躍 `codex/*` 開發；`grok/uncertain-retry-branch-*` 既有。
- #63 已合：uncertain acknowledge → cancelled 解除 conversation_busy。

### 本輪變更

- 準備 `retryBranchFromTask` 與 UI 雙按鈕契約（見 patch 與測試）；因 API 大檔寫入限制，本輪先落地測試與交接，TSX 完整內容在下一輪以 Actions/本地套用或分塊寫入。
- `tests/uncertain-retry-branch-ui.test.ts`：LOCAL_CONTRACT，強制檢查契約（不再 skip）。
- 接續 #65 目標，以 main tip 重開乾淨分支。

### 驗證

- 標籤：`LOCAL_CONTRACT`。本 sandbox **未執行** `tsx --test`／完整 suite。依賴 GitHub Actions `npm test`。
- 非 `LIVE_EXTERNAL`。Mock ≠ 實機 Hermes。

### 下一輪建議

- 將完整套用後的 HermesConsole.tsx 寫入本分支後轉 ready，關閉 #65。
- memory provenance（#62 等）仍建議以最新 main rebase 後合併。
- 不要合併 #10，不要覆蓋 `feat/consistencylab-clab-framelab`。

### 阻塞

- 無 Hermes 實機金鑰／網域 → 不得宣稱 LIVE 整合通過
- sandbox 無法穩定跑完整 test suite／大檔 API 寫入 → 以 Actions 為準；TSX 套用待下一輪完成

---
