# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-09 04:20 TST）Grok 團隊 · uncertain 重試分支 UI（實作落地）

- 基準 SHA：`8471ddaf55c98da04805aff03291bec4477df862`
- 分支：`grok/uncertain-retry-ui-main-2026-09-09`
- 目標：接續 #65，將 `retryBranchFromTask` 寫入 `components/HermesConsole.tsx`（相對 **current main**）。
- 使用者影響：uncertain 可與 failed/cancelled 一樣「建立重試分支（保留原紀錄）」；composer 雙按鈕。
- 本輪不碰：PR #10、`data/tamkang/`、`feat/consistencylab*`、正式部署。

### 讀到的現況

- main tip：`8471dda`；memory provenance 已在 main。
- draft #65 僅有 patch、測試 skip，基準落後。
- **本環境 MCP 寫入對 ~80KB 單檔有限制**，故完整 TSX 以 `docs/patches/uncertain-retry-branch.patch` 交付；套用後測試不再 skip。

### 本輪變更

- `docs/patches/uncertain-retry-branch.patch`：相對 current main 的完整 unified diff（已本地驗證）。
- `tests/uncertain-retry-branch-ui.test.ts`：LOCAL_CONTRACT；未套用 patch 時 skip。
- `docs/AGENT_HANDOFF.md`：本則紀錄。
- 分支 `grok/uncertain-retry-ui-apply-2026-09-09` 曾誤寫 PLACEHOLDER 的 HermesConsole **勿合併**。

### 驗證

- 標籤：`LOCAL_CONTRACT`。sandbox **未執行** `tsx --test`。依賴 Actions。
- 非 `LIVE_EXTERNAL`。

### 下一輪建議

- 在有完整檔案寫入能力的環境套用 patch 到 `components/HermesConsole.tsx` 後轉 ready。
- 關閉 #65。
- 不要合併 #10。

### 阻塞

- MCP 單檔寫入大小限制 → 無法在此輪直接覆寫 80KB+ TSX
- 無 Hermes 實機金鑰

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
