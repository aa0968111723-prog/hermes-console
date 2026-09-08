# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-08 21:25 TST）Grok 團隊第四輪

- 基準 SHA：`f13b1ed87c33e919b08d80df1262b5b26ecb0cd6`
- 分支：`grok/memory-provenance-current-main-2026-09-08`
- 目標：在 **current main** 上落地共用記憶 provenance（取代落後的 #55／#42）。
- 使用者影響：記憶列可標記來源／信心／重要度；digest 寫入 `lastUsedAt`；`synced` 仍為 false，不宣稱 Hermes 遠端鏡像。
- 本輪不碰：PR #10 / #30 / #4、`data/tamkang/`、正式部署、不覆蓋 `feat/consistencylab*`。

### 讀到的現況

- main 最新：`f13b1ed`（淡江 hourly + research commits）。已含 `stream-incomplete-uncertain.test.ts`、`runs-chat-fallback.test.ts`。
- PR #55（`grok/memory-provenance-on-main-2026-09-08`）基準停在 `4d9501bf`，落後 current main；#42 更舊。本輪以 current main 重開分支，建議關閉 #55／#42。
- 開放 PR：#55（draft）、#42、#30 ConsistencyLab、#21 長任務藍圖、#10（禁止合併）、#4 atelier。
- 無活躍 `codex/*` 開發；`codex/chat-sse-boundaries`、多個 `cursor/*`、`cubelv-*` 仍在。
- `lib/server/memory.ts` 在 main 仍無 provenance 欄位；`memoryStoreId`／`storeBackend` 已存在。

### 本輪變更

- `lib/server/memory.ts`：`memorySources`、provenance 欄位、`normalizeMemory`、`touchMemories`；保留 `memoryStoreId`／`memoryStoreLabel`。
- `tests/shared-memory.test.ts`：預設 provenance、更新 confidence/importance/source、digest→lastUsedAt、舊列相容、`share.provenanceFields`。
- 同一 store 列，不另開表、不改 MCP 工具名稱。

### 驗證

- 標籤：`LOCAL_CONTRACT`。本 sandbox **未執行** `tsx --test`（環境無完整 clone／Node 專案樹）。依賴 GitHub Actions `npm test`。
- 非 `LIVE_EXTERNAL`。Mock ≠ 實機 Hermes／Postgres。

### 下一輪建議

- 合併本 PR 後關閉 #55／#42。
- 聊天中止後「建立重試分支」與 uncertain 任務的 UI 契約（verify-ui / verify-chat 延伸）。
- 考慮 `test:entry` 是否納入 CI。
- 不要合併 #10，不要覆蓋 `feat/consistencylab-clab-framelab`。

### 阻塞

- 無 Hermes 實機金鑰／網域 → 不得宣稱 LIVE 整合通過
- 無 Canva OAuth、淡江 MCP 實機、Zeabur 授權
- sandbox 無法穩定跑完整 test suite → 以 Actions 為準

---

## 進行中（2026-09-08 18:06 TST）Grok 團隊第二輪

- 基準 SHA：`1be96eb45be62f039ccce40d60ef1602028c1f3c`
- 分支：`grok/stream-incomplete-uncertain-2026-09-08`
- 目標：補 mid-stream 斷線與 idle timeout 契約測試，確認 `tasks.ts` 將 `stream_incomplete` / `idle_timeout` 結為 `uncertain`（非 definite failed）。
- 使用者影響：串流中途斷線或閒置時，UI 可誠實顯示「待確認／可查回重試」，不會誤標為確定失敗。
- 本輪不碰：`memory.ts`、PR #10 / #30 / #42、`data/tamkang/`、正式部署、不覆蓋 `feat/consistencylab*`。

### 讀到的現況

- main 已含 `tests/runs-chat-fallback.test.ts`、`tests/stream-definite-failed.test.ts`（frame_too_large / invalid_json → failed）。
- 近期合併：#51 definite stream errors、#50 手機 composer 任務狀態、#49 ready backend。
- 開放 PR：#42 記憶 provenance（grok，需相對 Postgres 遷移 rebase）、#30 ConsistencyLab、#21 長任務藍圖、#10（禁止合併）。
- 無活躍 `codex/*` 開發分支；`codex/chat-sse-boundaries` 仍在。

### 本輪變更

- 新增 `tests/stream-incomplete-uncertain.test.ts`（LOCAL_CONTRACT）
  - 案例 A：SSE 半段後 abrupt close、無 `[DONE]` → `state=uncertain`，error 含「串流中斷」
  - 案例 B：一幀後靜默至 `HERMES_IDLE_TIMEOUT_MS` → `state=uncertain`，error 含「閒置逾時」
  - 案例 C：happy path 仍 `completed`
- 對齊 `lib/server/tasks.ts` definite 正則：`stream_incomplete` / `idle_timeout` 不在其中 → submitted 後為 uncertain。

### 驗證

- 標籤：`LOCAL_CONTRACT`。本環境曾嘗試完整 clone 跑 `tsx --test`，clone 逾時阻塞；**未在本機宣告通過**。依賴 GitHub Actions `npm test`。
- 非 `LIVE_EXTERNAL`。Mock ≠ 實機 Hermes。

### 下一輪建議

- 將 PR #42（memory provenance）rebase 到含 Postgres store 的 main，補 shared_memory 欄位相容。
- 聊天中止後「建立重試分支」與 uncertain 任務的 UI 契約（verify-ui / verify-chat 延伸）。
- 考慮 `test:entry` 是否納入 CI（先觀察穩定度）。
- 不要合併 #10，不要覆蓋 `feat/consistencylab-clab-framelab`。

### 阻塞

- 無 Hermes 實機金鑰／網域 → 不得宣稱 LIVE 整合通過
- 無 Canva OAuth、淡江 MCP 實機、Zeabur 授權
- 本 sandbox git clone 緩慢／逾時 → 契約測試以 Actions 為準

---

## 進行中（2026-09-08 13:30 TST）Grok 團隊第一輪

- 基準 SHA：`043b533f989573dfb375834b2b5fec223c86c08f`
- 分支：`grok/runs-chat-fallback-test`
- 目標：驗證 CubeLV「runs 失敗改走 chat 串流」與「會話預建失敗仍續行」，補契約測試，不重寫提交路徑。
- 使用者影響：Hermes Gateway 若未實作 `/v1/runs` 或暫時 5xx，聊天不應整筆失敗。
- 本輪不碰：`memory.ts`、PR #10 / #30 / #4、淡江 hourly KB automation、正式部署。

### 讀到的 Codex / CubeLV 修改

- CubeLV AI (`ai@cubelv.com`)：runs 通道失敗降級 chat 串流；會話預建失敗以無會話模式續行；discovery 相容 data 包裝。
- PR #40 已合：malformed runtime catalogs = failed；native binding 拒絕改顯示「原生」；SSE 同步時略過 heartbeat 以免 `live_added` 飢餓。
- PR #38：session precreate typecheck TS2339。
- 沒有 `codex/*` 開發分支。既有 `feat/grok-parallel-intelligence-loop` 與空的 `grok/memory-provenance-2026-09-08`。

### 官方協定對齊（NousResearch hermes-agent API server）

- `POST /v1/runs` → 202 `{ run_id, status:"started" }`；`GET` status；`GET` events SSE；`POST` stop
- `/v1/runs` 不支援 multimodal（圖片會被丟掉）→ Console 有附件時本來就走 chat
- 舊 Gateway / Open WebUI 常見只有 `/v1/chat/completions`，沒有 `/v1/runs` → 404/501 是最真實的降級觸發
- `interrupted` / abort 不得被降級吃掉

### 驗證計畫

- 新增 `tests/runs-chat-fallback.test.ts`（node:test，獨立 mock，不改 `security-tasks.test.ts`）
- 案例 A：capabilities 宣告 `run_submission`+`run_status`，`POST /v1/runs` 回 501，chat SSE 成功 → `transport=chat`、event 含「runs 通道暫時不可用」、`state=completed`、`remoteId=null`
- 案例 B：`/v1/runs` 回 200 但缺 `run_id`/`id` → 同樣降級 chat
- 案例 C：`session_resources=true` 但 `POST /api/sessions` 500 → event 含「Hermes 會話預建未成功」，任務仍經 chat 完成
- 標籤：`LOCAL_CONTRACT`。未跑不得寫通過。非 `LIVE_EXTERNAL`。

### 下一輪建議（Codex 可接手）

- 記憶 provenance（source / createdBy / importance / lastUsedAt / confidence）不另開 store；`synced` 維持 false
- 聊天中止後重試、斷線 mid-stream 契約測試（`verify-chat` 已有 abort，斷線仍弱）
- 考慮是否把 `test:entry` 納入 CI（`test:runtime` 較重，先觀察穩定度）
- 不要合併 #10，不要覆蓋 `feat/consistencylab-clab-framelab`

### 阻塞

- 無 Hermes 實機金鑰／網域 → 不得宣稱 LIVE 整合通過
- 無 Canva OAuth、淡江 MCP 實機、Zeabur 授權
- Grok Automations 每小時是「再跑一次開發 prompt + GitHub 寫入」，不是常駐 Node worker。與既有「淡江社團生態」hourly 分開。
