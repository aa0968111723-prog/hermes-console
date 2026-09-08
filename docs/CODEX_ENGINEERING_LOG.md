# Codex 工程接續紀錄

## 2026-09-08 — SSE 累積事件大小限制

- 基準：`0c2d7a7f782d3a47ba3f299c4c902b0e628d3767`（main）。
- 分支：`codex/chat-sse-boundaries`。產出 SHA 以本紀錄所在 commit 與對應 PR 為準。
- 已讀取 AGENTS.md、README、CI、LONG_TASK_PROGRESS 與 GROK_PARALLEL_PROGRESS。
- 已核對未結 PR #42（memory provenance）、#41（runs/chat fallback）、#30、#21、#10、#4；不重複其工作，不修改 `data/tamkang/`。
- 保留免登入單一工作區，沒有新增帳號驗證或第二個 Agent。

### 問題與修復

`frames()` 原本只限制尚未解析的文字 buffer。已解析的 `data:` 行會移到陣列，因此上游可以將同一事件分成多個小 chunk，持續累積超過 2,000,000 字元的 payload 而不被拒絕。

新增獨立累積計數，包含多行資料合併時的換行字元；超限回傳既有 `502/frame_too_large`，透過既有 finally 取消 reader。每次事件 dispatch 後重設計數。保留既有 raw buffer 上限與 EOF 行為；這不是整體串流總流量限制，字元計數沿用 JavaScript UTF-16 長度，並非位元組限額。

### 實際驗證（LOCAL_CONTRACT）

- 修復前：`node --import tsx --test tests/sse.test.ts`，2 項超限測試失敗、2 項相容性測試通過。
- 修復後：同命令 4/4 通過。涵蓋跨 chunk 超限與取消、EOF 超限、精確邊界與事件重設、UTF-8/CRLF/多行資料。
- `node --import tsx --test --test-concurrency=1 tests/*.test.ts`：187/187 通過。
- `npm run lint`、`npm run typecheck`、`npm run build`、`npm run check:secrets`：通過。
- `npm audit --omit=dev`：0 vulnerabilities。
- `npm test` / `npx tsx` 的 CLI 在此環境建立 Unix IPC pipe 時遇到 EPERM；改用 Node 的 tsx import hook 執行同一組測試，沒有修改或刪除測試。
- 瀏覽器驗證阻塞：本機沒有 Chrome，`npx playwright install chrome` 因 apt/setgroups 權限失敗。CI 所要求的 UI/chat/workbench/gateway 瀏覽器驗證尚待 GitHub Actions；不能將本機契約測試視為 browser pass。
- 沒有使用正式服務憑證，沒有 LIVE_EXTERNAL 驗證；不宣稱 Hermes/Zeabur 的實際服務已通過。

### 下一輪與 Grok 交接

1. 優先讀取本 PR 的 GitHub Actions 結果，必要時續修同一分支。
2. Grok 可補上串流超限後的 UI 錯誤顯示與重試瀏覽器測試；本輪只修改 parser，不改 tasks 或介面。
3. raw buffer 上限仍可能因單次網路 chunk 包含多個合法事件而拒絕；屬既有行為，可另立精確重現案例，避免與此次累積上限修復混在一起。
4. 不合併主分支、不部署、不發布正式社群內容。
