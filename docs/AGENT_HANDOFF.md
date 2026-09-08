# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-08 15:05 TST）Grok 團隊第三輪

- 基準 SHA：`e4d2486124b2941a1cdfff3f108d4f3f4f271206`
- 分支：`grok/stream-definite-failed-2026-09-08`
- 目標：串流明確失敗（`frame_too_large` / `invalid_stream` / `empty_stream` / `output_limit`）標成 `failed`，讓 UI「建立重試分支」可用；補 LOCAL_CONTRACT 測試。
- 使用者影響：超大工具事件或格式錯誤不再卡在「結果待確認」；錯誤文案維持繁中，並修正「重试」→「重試」。
- 本輪不碰：PR #10 / #30 / #4、Codex SSE parser 累積上限（#43）、淡江 hourly、`data/tamkang/`、正式部署。

### 讀到的 Codex / CubeLV / 既有 Grok 修改

- PR #43（`codex/chat-sse-boundaries`）：跨 chunk 累積 SSE 大小限制；建議 Grok 補 UI／重試旅程。本輪只處理 tasks 分類，不改 `lib/server/sse.ts`。
- PR #42（`grok/memory-provenance-fields`）：共用記憶 provenance；仍為 draft。
- PR #41（`grok/runs-chat-fallback-test`）：runs→chat 降級契約；仍為 draft。
- 勿覆蓋 `feat/consistencylab-clab-framelab`；不合併 #10。

### 本輪變更

- `lib/server/tasks.ts`：definite 錯誤碼擴充；繁中「重試」
- `tests/stream-definite-failed.test.ts`：frame_too_large、invalid_json、happy path
- `docs/AGENT_HANDOFF.md`：本交接

### 驗證計畫

- `npm test -- tests/stream-definite-failed.test.ts`（LOCAL_CONTRACT）
- 全量 CI：lint / typecheck / test / build / secrets / UI / chat / workbench / gateway
- 非 LIVE_EXTERNAL

### 下一輪建議

- 待 #43 合併後，可再補 mid-chunk 斷線重試契約
- Task Status pill + 手機 bottom sheet（不改主導覽）
- 考慮 `uncertain` 任務在對話泡泡也顯示「建立重試分支」提示（目前僅 failed/cancelled）

### 阻塞

- 無 Hermes／Canva／淡江／Zeabur 實機金鑰 → 不得宣稱 LIVE
- 本環境若無法跑 Node 測試，以 GitHub Actions 為準

---

## 進行中（2026-09-08 14:00 TST）Grok 團隊第二輪

- 基準 SHA：`9f5b1ad770348f7f0026bb27867e5f53b9928992`
- 分支：`grok/memory-provenance-fields`
- 目標：共用記憶同一 SQLite 列加上 provenance（source / createdBy / importance / lastUsedAt / confidence）；`synced` 維持 false；digest 觸發 lastUsedAt。
- 詳見 PR #42。

---

## 進行中（2026-09-08 13:30 TST）Grok 團隊第一輪

- 基準 SHA：`043b533f989573dfb375834b2b5fec223c86c08f`
- 分支：`grok/runs-chat-fallback-test`
- 目標：驗證 CubeLV「runs 失敗改走 chat 串流」與「會話預建失敗仍續行」，補契約測試。
- 詳見 PR #41。
