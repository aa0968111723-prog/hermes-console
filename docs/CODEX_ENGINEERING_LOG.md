# Codex 工程接續紀錄

## 2026-09-08 — 任務詳情事件視覺層級（UIUX 分工）

- 基準 main：`330b1e8dddf9a6df479f83ee0d171ddf7c28c8f8`；分支 `codex/readable-task-events`，草稿 PR #59。PR #54 已由其他操作者合併，本輪自最新 main 開新分支。基準 main CI `34237305437` 全通過。
- 已核對 AGENTS、README、package/lock、CI、現有前端、未結 PR 與本紀錄。Grok #58/#56/#55/#42 均在處理 memory provenance；本輪不碰記憶資料、API、parser 或研究檔案。
- 先以測試提交 `f33275886ac278afac6a06adf404033275489266` 的 CI `34238796515` 產出基準，下載 artifact `10061142857` 並親自檢視 390×420 與 1440×1000：任務詳情只顯示 `galley_research · 摘要`，英文事件狀態要展開後才看得到。
- 將事件摘要拆成「實際工具來源／可讀狀態／事件摘要」三層，沿用真實 `toolName`、`status`、`summary`；已知工具採現有友善標籤，未知工具仍為「工具」。原始技術名稱只在展開後顯示，保留除錯資訊而不佔主要視線。
- 事件卡加入類別圖示、狀態膠囊、內光影與展開層次；這是 CSS 2.5D，不是 WebGL/真正 3D。無新依賴、常駐動畫、輪詢、API 或後端改動；reduced-motion 由全域規則停用箭頭轉場。
- 瀏覽器驗收沿用五種尺寸，新增 390×420 與 1440×1000 同名 `task-events-*` 前後圖；驗證收合時不顯示技術名稱、展開後仍能取得 `galley_research`，以及友善「研究 · GALLEY」「執行中」與真實摘要。
- 本地 `npm run lint`、`npm run typecheck`、`npm run build`、`npm run check:secrets`、`npm audit --omit=dev` 通過。`node --import tsx --test --test-concurrency=1 tests/*.test.ts`：229 項中 227 通過、2 項因未提供 Postgres 測試條件而跳過；零失敗。新狀態專項與相鄰狀態列專項 7/7 通過。
- 實作 SHA：`c83830a39f9164ea51992c2744316b036466da31`；跨尺寸原生 details 狀態隔離修正：`83a38b1ae38471f72134854b1d72097ab7fb18b6`。最終 CI `34239808084` 全通過，包含原 `npm test`、build、secrets、audit、test:ui、test:chat、test:workbench、test:gateway。
- 已下載 artifact `10061571673` 並親自對照 390×420、1440×1000：收合事件卡清楚顯示「研究 · GALLEY／執行中／摘要」，技術名稱不佔主畫面；展開互動由測試確認仍顯示原名。11 個 Axe 受測畫面零 violations；LCP 124ms、CLS 0.0000803 是 CI fixture 單次結果，不作真機效能承諾。PR head 以本紀錄所在提交為完整產出。
- fixtures 不是正式 Hermes/MCP 外部整合證據；沒有 iOS/Android 實體裝置。Grok 可續修 memory provenance；若後端新增事件狀態，請提供實際 status 樣本，前端會以「狀態未知」安全顯示直到映射完成。
- 不合併、不部署、不呼叫正式外部服務。

## 2026-09-08 — 任務列改用可讀的工具名稱（UIUX 分工）

- 基準 main：`1e9768a99ff7a62347d90c0464a25d0f0ce9f06b`；分支 `codex/friendly-tool-status`。PR #50 已由其他操作者合併，本輪自最新 main 開新分支。main CI `34215358758` 全通過。
- 已核對 AGENTS、README、package/lock、CI、現有前端、未結 PR 與本紀錄。#42 仍處理 memory provenance，#30 為 ConsistencyLab，#21 為長任務文件，#10 為舊大型功能分支；本輪不重複後端、研究或記憶工作。
- 由最新 main artifact `10051615962` 下載並親自檢視手機 390×420 與桌面 1440×1000 基準畫面：固定任務列可用，但把 `galley_research` 技術識別字直接顯示給使用者。
- 新增集中式工具顯示名稱：GALLEY、訊核、淡江、Instagram、Pinterest、Canva、Planform、FrameLab、Lumen、Atlas、對稿、目標客群、記憶、工作區及網路搜尋採短標籤。標籤只根據收到的 `toolName` 分類，不生成進度；未知名稱顯示「工具」，不把不可信或超長識別字放進可見介面，原始名稱保留在提示與任務詳情。
- 任務列的工具名稱改為有邊界、內光影的視覺膠囊，維持淺色 2.5D 層次；不是 WebGL 或真正 3D。無新依賴、動畫、輪詢、API 或後端變更。
- 單元驗收涵蓋 10 種已知/未知名稱、真實事件狀態與過時事件隱藏。瀏覽器驗收沿用五種尺寸，確認友善名稱；另用超長未知名稱確認可見文字只顯示「工具」、技術名稱留在 title、無水平溢出。
- 本地 `npm run lint`、`npm run typecheck`、`npm run build`、`npm run check:secrets`、`npm audit --omit=dev` 通過。`node --import tsx --test --test-concurrency=1 tests/*.test.ts`：224 項中 222 通過、2 項因未提供 Postgres 測試條件而跳過；零失敗。`npm test` 在此環境因 tsx Unix IPC `EPERM` 無法啟動，CI 仍會執行原腳本。
- 修改後瀏覽器畫面、Axe、chat/workbench/gateway 及最終 SHA 待草稿 PR CI；fixture 不代表正式 Hermes/MCP 外部整合。未做 iOS/Android 實體裝置驗證。
- Grok 可互補處理 #42 memory provenance 或正式工具事件契約；前端顯示名稱若新增 provider，只需把真實 `toolName` 樣本交給此映射，不需更改 API。
- 不合併、不部署、不呼叫正式外部服務。

## 2026-09-08 — 手機輸入區的持續任務入口（UIUX 分工）

- 基準 main：`5a3c4d3b650255171a42ac40f605679acd90ca09`；分支 `codex/mobile-task-status`，草稿 PR #50。前端實作產出 SHA：`3a2a264a043973ce8e73f8dd1961d697de5be200`；後續提交只補長對話驗收與本紀錄，PR head 為完整產出。
- 已核對 AGENTS、README、package/lock、CI、現有前端及交接。Grok #47/#45 處理後端失敗與重試，#42 為 memory provenance；本輪不改 parser、API、儲存或研究資料。
- 基準 CI `34209291264` 通過；先以 `c6ef08935df54c3d485c2a430149f30227e7c30e`（僅加畫面測試）在 CI `34210229011` 留下相同五種尺寸的 `task-access-*.png`。已下載並親自檢視基準手機/桌面與短高度畫面。
- 問題：360px 輸入區隱藏龜龜；其他尺寸也只有無文字龜龜按鈕。狀態在可捲走的對話上方，關閉寵物後更不易從输入位置查看。
- 新增獨立的 44px 任務入口，位於固定輸入區上方；文字/圖示來自既有 task/events，顯示目前狀態和實際活動工具。失敗、結果不確定、離線與 observationError 明確區別，後兩者不再呈現過時工具。無任務時不顯示入口；不綁定龜龜顯示偏好。
- 點擊或 Enter 開啟既有任務詳情，Escape 返回原焦點，草稿不變。純 CSS 淺色層次/內光影（2.5D），不是 WebGL/真正 3D；沒有新依賴、常駐動畫或額外網路輪詢。
- 本地基準：lint/typecheck/build 通過；211 項契約測試中 209 通過、2 跳過（Postgres 外部條件）。修改後 `node --import tsx --test --test-concurrency=1 tests/*.test.ts`：213 項中 211 通過、2 Postgres 條件測試跳過，零失敗；新狀態專項 2/2 通過。lint、typecheck、build、check:secrets 通過；`npm audit --omit=dev` 零漏洞。首頁 first-load JS 維持報表四捨五入的 210kB，不作真機效能承諾。
- 實作 CI `34210711055` 全通過：npm ci/lint/typecheck/test/build/check:secrets/audit，加上 test:ui、test:chat、test:workbench、test:gateway。下載 artifact `10049751894`，親自檢視五種尺寸以及 stale/離線/等待畫面；入口和輸入框未遮擋，手機 360px 也有任務文字。Axe 10 個受測畫面無 violations。瀏覽器驗證涵蓋空狀態、排隊/執行、等待/停止確認、完成、失敗/不確定、離線/過時查詢、reduced-motion、詳情開關與草稿/焦點保留。
- 另补長對話捲動、長工具名稱截斷、查看詳情不送出草稿，以及 stale 手機 Axe 驗收；此補充測試提交之 CI 以 PR Checks 為準。
- 瀏覽器策略：本地受控預覽不相容既有 Next.js dev flags；保留架構，使用 GitHub CI 真實 Chrome 旅程與可下載 screenshots。視覺任務狀態為明確標示 UI fixture，不是正式 Hermes/GALLEY 執行證據。短高度是 viewport 模擬，不等於 iOS/Android 實體鍵盤驗證。
- 下一輪：優先補 iOS/Android 真機鍵盤操作（目前只有短 viewport），再檢查等待授權的工具事件是否可直接提供恢復動作；Grok 可接手 #47 的失敗/重試後端契約與 observationError 恢復整合，本輪不代稱聯絡或執行 Grok。
- 不合併、不部署、不呼叫正式外部服務。

## 2026-09-08 — 大型網路 chunk 內的多事件相容性

- 延續 PR #43（`codex/chat-sse-boundaries`），遠端基準：`9eb8688ad765107fb45c2e18bd52f9e029f9cb15`；本輪開始時 main：`16767ab3f984358fd2453ce50aeb2bc61771656c`。
- 已確認 PR #43 首次 CI 全通過且無人工 review；main 新增的是淡江資料、研究與 composer 高度修復，PR 仍 clean。PR #45 已按上輪交接補 tasks 的 definite failure / retry，不修改 parser，本輪不重複該工作。
- 問題：原 raw buffer 檢查在剖析前執行；若 proxy 將許多各自合法的小 SSE frame 合併為單一超過 2,000,000 字元的網路 chunk，Console 會誤報 `frame_too_large`。
- 修復：逐行剖析並限制單行與同一事件累積資料；處理完所有完整行後，僅限制尚未終止的尾端。網路 chunk 邊界不再影響合法性，超大單行與超大多行事件仍拒絕。
- 新增回歸：單一大 chunk 內 2,000 個合法事件可完整讀取；超大非 data 行仍拒絕。原 4 項 SSE 邊界測試保留。
- 下一輪先看本次 CI；若 #45 合併，將 main 合併後相容性留給 CI 驗證。Grok 可繼續 tasks/UI 重試旅程，不需修改 `lib/server/sse.ts`。

### 本輪驗證

- `node --import tsx --test tests/sse.test.ts`：6/6 通過。
- `node --import tsx --test --test-concurrency=1 tests/*.test.ts`：189/189 通過。
- `npm run lint`、`npm run typecheck`、`npm run build`、`npm run check:secrets`：通過。
- `npm audit --omit=dev`：0 vulnerabilities。
- GitHub Actions browser gates 待本次遠端 commit；仍是 LOCAL_CONTRACT / browser fixture，不是 LIVE_EXTERNAL。

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
