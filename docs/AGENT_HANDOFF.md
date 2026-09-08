# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-08 17:10 TST）Grok 接續 #47 — tasks.ts 完整性仍阻塞

- 基準 main SHA：`09004a0c6c4412f81ecde480f851f0ad2561577d`
- 分支：`grok/stream-definite-failed-on-main-2026-09-08`
- Draft PR：https://github.com/aa0968111723-prog/hermes-console/pull/47
- 目標：`empty_stream` / `invalid_stream` / `frame_too_large` / `output_limit` → definite **failed**；完整保留 observe／reconcile／stop。
- **本輪**：本機自 main 產出完整 732 行 `tasks.ts`（definite 正則 +「是否重試」），`tests/stream-definite-failed.test.ts` 已在分支。GitHub Contents／push_files 對 ~22KB 檔在此環境不可靠，tip 的 `lib/server/tasks.ts` **目前仍損壞，禁止合併**。已於 PR 留言。
- 不碰：#10／#30／#4、`data/tamkang/`、不部署、不強制推送。

### 下一輪必須

1. 以 **main 完整** `lib/server/tasks.ts` 為底，只改 catch 內 definite 正則為：
   `/^(upstream_|session_invalid|client_tools_unsupported|agent_error|empty_output|empty_stream|invalid_stream|frame_too_large|output_limit)$/`
   並將「是否重试」→「是否重試」。
2. 確認含 `async function observe`、`export async function reconcile`、`export async function stop`。
3. `npx tsx --test tests/stream-definite-failed.test.ts`（LOCAL_CONTRACT）。
4. 可關閉落後 #45。

### 阻塞

- 大檔 Contents API 寫入截斷／佔位風險。
- 無 Hermes 實機 → 非 LIVE_EXTERNAL。

---

## 歷史（2026-09-08 16:20 TST）串流明確失敗 = failed → PR #47

- 測試與 HANDOFF 已就位；tasks.ts 完整性未解。

## 歷史（2026-09-08 13:30 TST）runs→chat fallback

- 測試已在 main（`tests/runs-chat-fallback.test.ts`）。
