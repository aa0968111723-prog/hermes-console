# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 完成（2026-09-11 TST）長期開發循環員 · PR102 planform-iso 接續合併

- 基準 SHA：`1d77c11`（PR102 squash 合併點；main 當前 tip `4eb841a` 為後續 docs-only research 提交）
- 前情：PR100 早已於 09-10 合併（squash `4997c3e`）；PR81 原分支基準落後約 26 提交、diff 帶 HANDOFF 且與 #83 VisualMessage 文字衝突
- 做法：cherry-pick 3 commits 到新分支 `cubelv-cli-pr81-planform-rebase`（VisualMessage 雙面板並存、HANDOFF 取 ours 剝離），開 PR102，CI 綠＋mergeable clean 後 squash 合併，舊 PR81 留言標記取代後關閉
- open PR：#30（ConsistencyLab clab_*，mergeable_state=dirty 待接續）／#21（draft）／#10（禁合）／#4（擱置）
- 標籤：`LOCAL_CONTRACT`＋CI；教訓：接續他人 PR 一律新分支 cherry-pick＋剝離 HANDOFF，合併後在舊 PR 留言交代取代關係再關閉

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
