# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-09 07:15 CST）Grok 團隊 — uncertain 重試分支 TSX 套用輪

- 基準 SHA：`179bf4baac85a5609e5e6f5404edb7e6d5e7f89d`（current main tip）
- 分支：`grok/uncertain-retry-tsx-apply-2026-09-09`
- 目標：接續 #71／#70／#68／#65，讓 **uncertain** 任務與 failed/cancelled 一樣可「建立重試分支（保留原紀錄）」，並保留「確認並可重試」。不宣稱遠端已停止。
- 使用者影響：串流中斷／閒置後標為 uncertain 的任務，可在 composer 與任務詳情建立對話分支重試。
- 本輪不碰：PR #10、`data/tamkang/`、`feat/consistencylab*`、正式部署、不強制推送、不自動合併。

### 讀到的現況

- main tip：`179bf4ba`（tku kb hourly + research commits；Cycle 19 已合）。
- 開放 PR 重點：#72 visual-first 3D（mobile）、#71 uncertain retry（draft，patch 未套進 TSX）、#69 codex compact-task-usage、#62 memory provenance（落後基準）、多個舊 grok memory/uncertain draft。
- Codex：`codex/compact-task-usage`（#69）、`codex/chat-sse-boundaries`、`codex/readable-task-events`。
- CubeLV：`cubelv-cli-*` 分支仍在。
- Cursor：多個 edu/security 研究分支。
- 先前 grok 分支多次因 MCP 單檔 ~80KB 寫入限制無法直接推送 `components/HermesConsole.tsx`；本輪在 sandbox 已 `patch -p1` 驗證 patch 可乾淨套用到 179bf4ba 的 TSX（本地確認 `retryBranchFromTask` 存在）。

### 本輪變更

- `docs/patches/uncertain-retry-branch.patch`：相對 **179bf4ba** 的 unified diff（與 #71 同源，已 dry-run + 實套驗證）。
- `tests/uncertain-retry-branch-ui.test.ts`：LOCAL_CONTRACT；有 `retryBranchFromTask` 時強制契約，否則 skip。
- **未直接推送** 完整 `HermesConsole.tsx`：GitHub MCP `create_or_update_file` / `push_files` 對 ~83KB 單檔寫入在本環境會截斷或失敗；誤寫過 PLACEHOLDER 後已以新分支避開。下一輪有大檔能力或人類請 `git apply docs/patches/uncertain-retry-branch.patch` 後推送 TSX。

### 驗證

- 標籤：`LOCAL_CONTRACT`。sandbox 已 `patch --dry-run` 與實套成功；**未** 跑完整 `npm test` / Actions。
- 非 `LIVE_EXTERNAL`。Mock ≠ 實機 Hermes。

### 下一輪建議

1. **優先**：在能寫大檔的環境對 `grok/uncertain-retry-tsx-apply-2026-09-09`（或新分支）執行 `git apply docs/patches/uncertain-retry-branch.patch` 並推送 `components/HermesConsole.tsx`，使測試不再 skip，再轉 ready。
2. 關閉舊 draft #71／#70／#68／#65。
3. 檢視 #72 mobile spatial 與 #69 compact usage 是否與 retry UI 衝突。
4. 不要合併 #10，不要覆蓋 `feat/consistencylab*`。

### 阻塞

- MCP 單檔寫入上限阻斷完整 TSX 推送
- 無 Hermes 實機金鑰 → 不得宣稱 LIVE
- sandbox 無法穩定 clone 完整 repo 跑 suite → 以 Actions 為準

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

（其餘歷史條目見 main 上的 AGENT_HANDOFF.md）
