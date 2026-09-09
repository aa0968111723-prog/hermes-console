# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## LOOP 2（2026-09-10 00:30 TST）Grok 01 · Drive Knowledge · CONTINUING

- AGENT_ID：Grok 01 Drive Knowledge
- LOOP_ID：2
- 基準 SHA：`ac5a7a4140911e2496962c78ff583619ad5470dd`
- 分支：`grok/zenclub-drive-knowledge-2026-09-09`
- PR：#79
- STATE：RUNNING
- 本輪不碰：HermesConsole（#77）、靈感視覺（#78/#80）、場佈 3D（#81）、`data/tamkang/`、Drive 原檔

### DONE_THIS_LOOP

- 時間軸：`happeningOn` / `今天社博` 會打到 115-1 社博（文館左側，2026-09-10）
- detect：社博／期初茶會／挑戰營不必再寫「淡江」才會查 Drive
- 2026 皇帝殿挑戰營：7/18–19、皇帝殿東峰+天王峰、淡水捷運站 13:30；名冊不進索引
- API：`GET /api/knowledge?when=today`

### NEXT_TASK

- 茶會 docx 仍 unread_binary
- 索引 114-2、始業式／結業式、挑戰營 6–9th
- 不要重開 PR，接續 #79

---

## 進行中（2026-09-09 16:40 TST）Grok 01 · Drive Knowledge

- 基準 SHA：`5e245e79668390deef4ccfb012cee889588cb719`
- 分支：`grok/zenclub-drive-knowledge-2026-09-09`
- 目標：把禪學社 Drive 轉成 Hermes 可搜尋、可追溯的知識層（索引／圖譜／API／工具路由／UI）。
- 使用者影響：問期初茶會／社博／演講時，Hermes 會先看到 Drive 快照證據；地點未寫就標 UNKNOWN。靈感頁多一塊 Drive 知識卡。
- 本輪不碰：PR #10 / #30、`data/tamkang/`、記憶 store、正式部署、Drive 原檔。

### 讀到的現況

- main tip：`5e245e7`。`data/tamkang/` 是全校社團生態，禁止把禪學社 Drive 名冊當第二源。本輪另開 `data/zenclub/`。
- 115 即戰力：茶會 2026-09-30、演講 2026-10-07 盧玫竹老師、社博 9/10–11＋9/14–17 文館左側。場地仍待定。
- 《期初宣傳區》留有 114-2「教授沒教的大腦休息法」舊文案 → CONFLICTING。
- 講師資訊資料夾幾乎空；通訊錄／報名回覆 redacted。

### 本輪變更

- `data/zenclub/{catalog,graph}.json` + `lib/server/zenclub/*`
- `GET/POST /api/knowledge`
- intelligence prompt 注入 `zenclub_drive_knowledge`（untrusted）
- planner / tool-router：`zenclub_drive_index`
- `components/knowledge/KnowledgeArchive.tsx` 掛在靈感頁
- `tests/zenclub-knowledge.test.ts` LOCAL_CONTRACT

### 驗證

- 標籤：`LOCAL_CONTRACT`
- 非 `LIVE_EXTERNAL`。Drive 讀取本輪已做，執行期用快照。

### 下一輪建議

- 轉寫茶會 docx 企劃書正文（目前 unread_binary）。
- 索引 114 師資課程／招生組，補講師庫。
- 挑戰營 6–10th 資料夾深挖日期場地。
- 不要合併 #10。

### 阻塞

- 無 Hermes 實機金鑰 → 不得宣稱 LIVE 整合通過
- 茶會企劃書為 docx，MCP 無法抽正文

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
