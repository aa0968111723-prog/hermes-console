# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-09 06:20 TST）Grok 團隊 · uncertain 重試分支 UI 實際套用

- 基準 SHA：`53e8825dff09b866a351c53e8c827a5ee071c2a7`
- 分支：`grok/uncertain-retry-apply-2026-09-09`
- 目標：接續 draft #70／#68／#65，在 **current main tip** 實際套用 `docs/patches/uncertain-retry-branch.patch` 到 `components/HermesConsole.tsx`，使 LOCAL_CONTRACT 測試不再 skip。
- 使用者影響：uncertain 任務在 composer 與任務詳情可「確認並可重試」或「建立重試分支（保留原紀錄）」；與 failed/cancelled 對齊；不宣稱遠端已停止。
- 本輪不碰：PR #10、`data/tamkang/`、`feat/consistencylab*`、正式部署、不強制推送、不自動合併。

### 讀到的現況

- main tip：`53e8825`（tku kb hourly-2026-09-09-0600）。
- memory provenance 與 research-truth 已在 main。
- 開放 draft：#70（patch only，基準 c937）、#69（codex 精簡手機任務詳情，CI 全過）、#68／#65（更舊 patch）。
- 無需優先驗證的衝突 `codex/*` 開發；`codex/compact-task-usage` 對應 #69。
- 前輪 MCP 對 ~80KB 單檔寫入受限，故以 patch 交付；本輪在 sandbox 成功 `git apply`。

### 本輪變更

- `components/HermesConsole.tsx`：套用 `retryBranchFromTask`、composer 雙按鈕（確認＋建立重試分支）、任務卡／詳情含 uncertain。
- `tests/uncertain-retry-branch-ui.test.ts`：LOCAL_CONTRACT；現在應強制通過（不再 skip）。
- `docs/patches/uncertain-retry-branch.patch`：保留相對參考。

### 驗證

- 標籤：`LOCAL_CONTRACT`。sandbox 已確認 patch 乾淨套用與符號存在；**未執行**完整 `tsx --test`（依賴 GitHub Actions `npm test`）。
- 非 `LIVE_EXTERNAL`。Mock ≠ 實機 Hermes。

### 下一輪建議

- 合併本 PR 後關閉 #70／#68／#65。
- 考慮合併 #69（用量精簡，有 CI 畫面證據）。
- 不要合併 #10，不要覆蓋 `feat/consistencylab*`。
- 後續可補 CSS `.composer-uncertain-actions` 若視覺需間距（目前僅 class 存在）。

### 阻塞

- 無 Hermes 實機金鑰／網域 → 不得宣稱 LIVE 整合通過
- sandbox 完整 test suite 環境不穩定 → 以 Actions 為準

---

（歷史紀錄見完整檔案；本輪以精簡頂部為準。）
