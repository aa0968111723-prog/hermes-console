# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 完成（2026-09-13 TST）Codex · 素材預覽重開定位與長檔名

- 最新 main 基準 SHA：`cebd0719aaa5e06ae0d5240b19e39f4856461f54`（本輪新增內容皆為研究文件，無前端衝突）；續修 `codex/mobile-preview-safe-area`／草稿 PR #104。
- 產出 SHA：`244fdb5c126056d29dfb22dd60d708c43e700852`（程式；本紀錄另有文件提交）。
- 完成：手機素材預覽捲到底、關閉再開後會回到標題與圖片頂端；320×360、20px 大字下的無空白長檔名可分行，不再向右裁切。沿用既有 CSS 2.5D 與安全區，未新增 WebGL、動畫或依賴。
- 測試先行：CI `34714091308` 精確重現重新開啟仍停在 `scrollTop=266`；人工檢視其 artifact 發現長檔名仍被裁切，再以邊界測試於 CI `34715952475` 重現標題寬 `726.28125px` 超出 320px 視窗。
- 驗證：最終 CI `34716116318` 全通過；366/368 測試通過、2 項 Postgres 條件跳過，lint、typecheck、build（52 routes）、密鑰掃描、audit、UI／聊天／工作台／Gateway／入口旅程均通過；Chrome／WebKit 與 16 個 Axe 畫面零違規。已人工檢視最終 320×360 artifact：標題三行完整、圖片從頂部可見、無水平裁切；Escape 關閉後焦點回到預覽入口。
- 限制：上傳與預覽是 Console 本機 fixture，不是正式 Hermes／MCP 或外部素材服務；本地 Playwright 瀏覽器不可用，畫面證據來自 GitHub CI；iOS／Android 實機仍未驗證。
- 下一輪（Codex）：檢查設定與空間面板在 200% 等效窄畫面下，跨頁籤後的 sticky 標題、捲動起點與焦點回復。
- 適合 Grok 接手：處理 #30 ConsistencyLab dirty rebase 與 live contract；避免修改本 PR 的預覽 CSS／瀏覽器旅程。

---

## 完成（2026-09-12 TST）Codex · 橫向成果預覽與長標題

- 最新 main 基準 SHA：`8baf8a7400b3a73af7a261b2ca1b48c0229df60b`（相較 PR 基準只新增研究文件，無前端衝突）；續修 `codex/mobile-preview-safe-area`／草稿 PR #104。
- 產出 SHA：`402ab3f96b2d13e0316adba59540faa964820445`（程式；本紀錄另有文件提交）
- 完成：Canva／成果預覽的無空白長標題可在窄畫面任意斷行，不再撐出水平捲動；沿用前輪頂／底安全區與 sticky 關閉控制。
- 測試先行：CI `34686022420` 在 568×320、20px 大字、32px top／21px bottom inset 精確失敗於長標題水平溢出；修復後 CI `34686287104` 全通過。
- 驗證：366/368 測試通過、2 項 Postgres 條件跳過；lint、typecheck、build、密鑰掃描、audit、UI／聊天／工作台／Gateway／入口旅程通過；Chrome／WebKit 與 16 個 Axe 畫面零違規。人工檢視橫向短視窗 artifact：捲動後關閉鍵仍在 top inset 下、44px 觸控區完整，長標題分行且無水平溢出。
- 限制：測試使用明確標示的 UI fixture 與 CI 瀏覽器，不是正式 Canva 回傳；正式 Hermes／MCP、Canva 連線及 iOS／Android 實機未驗證。
- 下一輪（Codex）：檢查素材預覽的超長檔名與 200% 縮放，以及橫向短視窗關閉後捲動位置恢復。
- 適合 Grok 接手：處理 #30 ConsistencyLab dirty rebase 與 live contract；避免修改本 PR 的預覽 CSS／瀏覽器旅程。

---

## 完成（2026-09-12 TST）Codex · 手機全螢幕預覽頂部安全區

- 基準 SHA：`7b8add880efd1474e3836d2f60ee462fdbd9bf56`
- 分支／草稿 PR：`codex/mobile-preview-safe-area`／#104
- 產出 SHA：`4942301283c08f76f66f90fa192443508edf5e65`（程式）；`fc5573953c090a8baf23f458d4c41f476c7efe6a`（最終瀏覽器驗收）
- 完成：新增共用 `--safe-area-top`，全螢幕素材與成果預覽會避開瀏海／動態島；預覽內容高度同步扣除 inset，不影響桌面，也未新增 WebGL 或依賴。
- 測試先行：CI `34683667141` 只有 UI 旅程失敗，精確重現關閉鍵侵入 47px 頂部安全區；修復後最終 CI `34684445244` 全通過。
- 驗證：366/368 測試通過、2 項 Postgres 條件跳過；lint、typecheck、build、密鑰掃描、audit、UI／聊天／工作台／Gateway／入口旅程通過；Chrome／WebKit 手機旅程與 16 個 Axe 畫面零違規。人工檢視 320×360、20px 最終 artifact，標題、圖片與 44px 關閉鍵均在安全視窗內；Escape 焦點回到預覽入口。
- 限制：本地 Playwright 下載因 CDN 逾時，瀏覽器驗證採 GitHub CI；正式 Hermes／MCP、正式部署及 iOS／Android 實機瀏海仍未驗證。
- 下一輪（Codex）：檢查全螢幕成果預覽在橫向短視窗的內容捲動，以及 200% 縮放下長檔名截斷。
- 適合 Grok 接手：處理 #30 ConsistencyLab 的 dirty rebase 與外部 contract；避免修改 `app/mobile-spatial.css`、`tests/mobile-spatial.ts`。

---

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
