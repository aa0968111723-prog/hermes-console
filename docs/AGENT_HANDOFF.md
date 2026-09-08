# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-08 16:20 TST）Grok 串流明確失敗 = failed → PR #47

- 基準 SHA：`b581727a03323ddd6637e17248bf8fa017e25a64`（之後 main 另有 tamkang KB 提交，不碰 `data/tamkang/`）
- 分支：`grok/stream-definite-failed-on-main-2026-09-08`
- Draft PR：https://github.com/aa0968111723-prog/hermes-console/pull/47
- 目標：`empty_stream` / `invalid_stream` / `frame_too_large` / `output_limit` → definite **failed**；補 LOCAL_CONTRACT 測試。
- **已知問題**：透過 Contents API 寫入 `lib/server/tasks.ts` 時內容被截斷（缺 `observe`／停止路徑）。合併前必須以 main 完整檔為底只改 definite 正則，或從 #45 完整檔移植。測試與 HANDOFF 已就位。
- 不碰：#10 / #30 / #4、`data/tamkang/`、不部署、不強制推送。

### 下一輪優先

1. **修復 #47 的 tasks.ts 完整性**（人工或可完整推檔的環境）
2. 斷線 mid-stream / `stream_incomplete` 仍應 uncertain 的契約測試
3. #42 memory provenance rebase 到含 #46 的 main
4. 評估關閉落後的 #45

### 阻塞

- 無 Hermes 實機 → 非 LIVE_EXTERNAL
- 大檔 Contents API 截斷風險（約 18–19KB）

---

## 進行中（2026-09-08 13:30 TST）Grok 團隊第一輪（歷史）

- runs→chat fallback 測試已在 main（`tests/runs-chat-fallback.test.ts`）
