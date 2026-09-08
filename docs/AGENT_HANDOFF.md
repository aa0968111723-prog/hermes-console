# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-09 05:20 TST）Grok 團隊 · uncertain 重試分支 UI（相對 main c937）

- 基準 SHA：`c937a7cb5951f162132194e9d33f791bc409267a`
- 分支：`grok/uncertain-retry-ui-c937-2026-09-09`
- 目標：接續 #68／#65，在 **current main tip** 提供 uncertain 與 failed/cancelled 對齊的「建立重試分支」UI。
- 使用者影響：uncertain 任務在 composer 與任務詳情可「確認並可重試」或「建立重試分支（保留原紀錄）」；不宣稱遠端已停止。
- 本輪不碰：PR #10、`data/tamkang/`、`feat/consistencylab*`、正式部署、不強制推送。

### 讀到的現況

- main tip：`c937a7cb`（tamkang KB hourly + memory provenance 已在 main）。
- memory provenance 已合入 main，舊 #62／#60／#56／#55／#42 可關閉。
- draft #69（codex 精簡任務用量）CI 全過、有手機畫面證據。
- draft #68／#65 僅 patch + skip 測試，基準落後；本輪以 c937 重開。
- 無活躍需優先驗證的 `codex/*` 衝突；`codex/compact-task-usage` 為 #69。
- MCP 對 ~80KB 單檔 `HermesConsole.tsx` 寫入仍受限，故以 patch 交付。

### 本輪變更

- `docs/patches/uncertain-retry-branch.patch`：相對 main c937 的 unified diff（`retryBranchFromTask`、composer 雙按鈕、任務卡／詳情含 uncertain）。
- `tests/uncertain-retry-branch-ui.test.ts`：LOCAL_CONTRACT；patch 未套用時 skip。
- 勿合併：`grok/uncertain-retry-ui-apply-c937-2026-09-09`（曾誤寫 PLACEHOLDER）。

### 驗證

- 標籤：`LOCAL_CONTRACT`。sandbox **未執行** `tsx --test`。依賴 GitHub Actions。
- 非 `LIVE_EXTERNAL`。Mock ≠ 實機 Hermes。

### 下一輪建議

- 在可寫入大檔的環境 `git apply docs/patches/uncertain-retry-branch.patch` 後推送 `components/HermesConsole.tsx`，使測試不再 skip，轉 ready。
- 關閉 #68／#65 與過時 memory provenance PRs。
- 考慮合併 #69（用量精簡，有 CI 畫面證據）。
- 不要合併 #10，不要覆蓋 `feat/consistencylab*`。

### 阻塞

- MCP 單檔寫入大小限制 → 無法在此輪直接覆寫 80KB+ TSX
- 無 Hermes 實機金鑰／網域 → 不得宣稱 LIVE 整合通過
- sandbox 無法穩定跑完整 test suite → 以 Actions 為準

---

## 進行中（2026-09-08 22:10 TST）Grok 團隊第五輪

- 基準 SHA：`fac99cb6cdb72f7a867719e06fb52d6aede9fd8c`
- 分支：`grok/memory-provenance-fac99-2026-09-08`
- 目標：在 **current main tip** 落地共用記憶 provenance（取代落後的 #56／#55／#42）。
- 使用者影響：記憶列可標記來源／信心／重要度；digest 寫入 `lastUsedAt`；`synced` 仍為 false，不宣稱 Hermes 遠端鏡像。
- 本輪不碰：PR #10 / #30 / #4、`data/tamkang/`、正式部署、不覆蓋 `feat/consistencylab*`。

### 讀到的現況

- main tip：`fac99cb6`（research authorization IR + Cycle 17 research-truth 已合）。
- PR #56 基準停在 `f13b1ed`，mergeable dirty；#55／#42 更舊。本輪以 fac99 重開。
- 開放 PR：#56（draft dirty）、#55、#42、#30 ConsistencyLab、#21、#10（禁止合併）、#4。
- 無活躍 `codex/*` 開發；多個 `cursor/*`、`cubelv-*`、`grok/*` 仍在。
- `lib/server/memory.ts` 在 main 仍無 provenance；`memoryStoreId`／Postgres 後端已存在。

### 本輪變更

- `lib/server/memory.ts`：`memorySources`、provenance 欄位、`normalizeMemory`、`touchMemories`；保留 `memoryStoreId`／`memoryStoreLabel`。
- `tests/shared-memory.test.ts`：預設 provenance、更新 confidence/importance/source、digest→lastUsedAt、舊列相容、`share.provenanceFields`。
- 同一 store 列，不另開表、不改 MCP 工具名稱。

### 驗證

- 標籤：`LOCAL_CONTRACT`。本 sandbox **未執行** `tsx --test`。依賴 GitHub Actions `npm test`。
- 非 `LIVE_EXTERNAL`。Mock ≠ 實機 Hermes／Postgres。

### 下一輪建議

- 合併本 PR 後關閉 #56／#55／#42。
- 聊天中止後「建立重試分支」與 uncertain 任務的 UI 契約。
- 不要合併 #10，不要覆蓋 `feat/consistencylab-clab-framelab`。

### 阻塞

- 無 Hermes 實機金鑰／網域 → 不得宣稱 LIVE 整合通過
- sandbox 無法穩定跑完整 test suite → 以 Actions 為準

---

（歷史紀錄見 main 上完整 AGENT_HANDOFF。）
