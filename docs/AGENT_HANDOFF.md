# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

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
